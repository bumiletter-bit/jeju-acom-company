/* #473 웹 푸시 — 회사프로그램 알림을 폰 화면으로 (앱을 안 켜도 옴)
 *
 * 쓰는 법(server.js): const push = require('./push.js')(app, { pool, authMiddleware });
 *                     그리고 알림을 만들 때 push.send(userId, { title, message, link });
 *
 * · 열쇠(VAPID)는 첫 실행 때 한 번 만들어 agent_office_config 'webpush_vapid' 에 둔다(사람이 넣을 것 없음).
 * · 구독(어느 폰으로 보낼지)은 push_subscriptions 표에 쌓인다. 폰에서 알림을 끄면 그 줄만 지운다.
 * · 무엇을 보낼지는 agent_office_config 'push_scope' 로 고른다(기본 = 꼭 필요한 것만).
 * 🔴 손님 개인정보(이름·전체 번호·주소)는 푸시 본문에 넣지 않는다 — 잠금 화면에 그대로 뜨기 때문.
 *    (#707-B · 대표 10/15: 문자 알림(type 'sms')의 손님 글·봇 답 전문은 잠금 화면에 떠도 된다고 정함 → 문자만 본문 상한 300자 · 다른 type 은 120 그대로 · sms/index.js staffBody 가 적는 글 그대로)
 * #1062(대표 11/9) 「아꼼이 문자」 앱(/sms/ · 회사폰·발주컴퓨터 PC) — 그 앱의 서비스 워커로 받은 구독은 label = 'sms-app'
 *    · send() 는 sms-app 구독을 늘 건너뛴다(창구·결재·정산·종전 문자 알림이 문자 앱으로 가지 않게 · 같은 PC 중복 0)
 *    · sendApp() 은 sms-app 구독에만 보낸다(sms/index.js appNotify · 손님 문자 1통마다 · 알림 종 표 안 씀) · push_scope.sms === false 면 안 보냄
 *    · 문자 앱 제목은 가린 이름·가린 번호(「이*화 · 010-****-2485」 · 대표 11/9 지정 꼴)
 */
'use strict';
const webpush = require('web-push');

module.exports = function mountPush(app, { pool, authMiddleware }) {
    let vapid = null, ready = null;

    async function ensureTable() {
        await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            label TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            last_ok_at TIMESTAMP,
            fail_count INTEGER DEFAULT 0
        )`);
    }
    async function init() {
        if (!ready) ready = (async () => {
            await ensureTable();
            const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'webpush_vapid'`);
            if (r.rows.length && r.rows[0].value && r.rows[0].value.publicKey) vapid = r.rows[0].value;
            else {
                const k = webpush.generateVAPIDKeys();
                vapid = { publicKey: k.publicKey, privateKey: k.privateKey, subject: 'mailto:bumiletter@naver.com', at: new Date().toISOString() };
                await pool.query(
                    `INSERT INTO agent_office_config (key, value) VALUES ('webpush_vapid', $1::jsonb)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(vapid)]);
                console.log('[push] VAPID 열쇠를 새로 만들었습니다');
            }
            webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
        })().catch(e => { ready = null; throw e; });
        return ready;
    }

    // 무엇을 폰으로 보낼지 — 기본은 꼭 필요한 것만(화면 알림은 전부 그대로 쌓인다)
    const DEFAULT_SCOPE = {
        desk: true,                  // 클코 창구: 답변·되묻기·승인 요청·오류
        document_submitted: true,    // 결재 올라옴
        document_approved: true,
        modification_requested: true,
        modification_approved: true,
        expense: false,              // 지출결의서는 건수가 많아 기본 꺼짐
        settle_recon: true,          // 정산 대조 경고
    };
    let scopeCache = null, scopeAt = 0;
    async function scope() {
        if (scopeCache && Date.now() - scopeAt < 60000) return scopeCache;
        try {
            const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'push_scope'`);
            scopeCache = Object.assign({}, DEFAULT_SCOPE, (r.rows[0] && r.rows[0].value) || {});
        } catch (e) { scopeCache = DEFAULT_SCOPE; }
        scopeAt = Date.now();
        return scopeCache;
    }

    const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
    const APP_LABEL = 'sms-app';   // #1062 문자 앱 구독 꼬리표(화면이 구독 body.label 로 보냄 · 값 고정)
    const clipKeep = (s, n) => String(s == null ? '' : s).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, n);   // 문자 앱 본문 = 줄바꿈은 살림(글 · 「주문: …」 두 줄)
    // 구독 줄들로 실제 발송 — 성공 = last_ok_at · 404/410 = 그 줄 지움 · 그 밖 실패 = fail_count +1(종전 send 와 같은 처리)
    async function pushTo(subs, payload, opts) {
        let sent = 0, gone = 0;
        for (const s of subs) {
            try {
                await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, opts || { TTL: 3600 });
                sent++;
                await pool.query(`UPDATE push_subscriptions SET last_ok_at = NOW(), fail_count = 0 WHERE id = $1`, [s.id]);
            } catch (e) {
                const code = e && e.statusCode;
                if (code === 404 || code === 410) { await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]); gone++; }
                else await pool.query(`UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = $1`, [s.id]);
            }
        }
        return { sent, gone };
    }

    // 한 사람의 모든 기기로 보낸다. 실패해도 절대 위로 던지지 않는다(알림 때문에 본 기능이 멈추면 안 된다).
    async function send(userId, { title, message, link, type }) {
        try {
            if (!userId) return { sent: 0, skip: 'no-user' };
            if (type) { const sc = await scope(); if (sc[type] === false) return { sent: 0, skip: 'scope' }; }
            await init();
            const subs = (await pool.query(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND label IS DISTINCT FROM $2`, [userId, APP_LABEL])).rows;   // #1062 문자 앱 구독은 여기서 안 보냄(sendApp 몫)
            if (!subs.length) return { sent: 0, skip: 'no-sub' };
            const payload = JSON.stringify({ title: clip(title, 60) || '제주아꼼이네', body: clip(message, type === 'sms' ? 300 : 120), link: clip(link, 60) || '' });   // #707-B(대표 10/15): 문자(type 'sms') 본문만 120 → 300(손님 글·봇 답이 실림 · 잠금 화면에 떠도 된다 = 대표 · 문자 한정) · 다른 type·제목·link 상한은 그대로
            return await pushTo(subs, payload);
        } catch (e) { console.error('[push] 보내기 실패(무시):', e.message); return { sent: 0, error: e.message }; }
    }
    // #1062-f 안 읽은 대화 목록을 payload 에 — 웹 푸시는 암호화 뒤 4KB 상한 → JSON 3,600바이트 안으로(넘치면 b 를 30자로 → 그래도 넘치면 뒤에서부터 뺌 · 뺐으면 unread_full=false = 받는 쪽은 「없는 알림 닫기」 안 함)
    const PAYLOAD_MAX = 3600;
    function fitUnread(base, unread, full) {
        if (!Array.isArray(unread)) return JSON.stringify(base);
        let list = unread.slice(0, 30).map(u => Object.assign({ id: Number(u && u.id) || 0 }, Number(u && u.tid) > 0 ? { tid: Number(u.tid) } : {}, { t: clip(u && u.t, 40), b: clip(u && u.b, 60) })).filter(u => u.id > 0), isFull = full === true && list.length === unread.length;   // #1062-h 글 단위 = id 글 · tid 대화
        const out = () => JSON.stringify(Object.assign({}, base, { unread: list, unread_full: isFull }));
        let s = out(); if (Buffer.byteLength(s) <= PAYLOAD_MAX) return s;
        list = list.map(u => Object.assign({}, u, { b: u.b.slice(0, 30) })); s = out();
        while (Buffer.byteLength(s) > PAYLOAD_MAX && list.length) { list.pop(); isFull = false; s = out(); }
        return s;
    }
    // #1062 문자 앱(label 'sms-app') 구독에만 — { title, message, link, tag } · 실패해도 던지지 않음 · urgency high(폰이 쉬고 있어도 빨리)
    async function sendApp(userId, { title, message, link, tag, badge, unread, unread_full }) {
        try {
            if (!userId) return { sent: 0, skip: 'no-user' };
            const sc = await scope(); if (sc.sms === false) return { sent: 0, skip: 'scope' };
            await init();
            const subs = (await pool.query(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND label = $2`, [userId, APP_LABEL])).rows;
            if (!subs.length) return { sent: 0, skip: 'no-sub' };
            const base = Object.assign({ title: clip(title, 60) || '아꼼이 문자', body: clipKeep(message, 300), link: clip(link, 60) || '', tag: clip(tag, 40) || '', app: 'sms' }, Number.isInteger(badge) && badge >= 0 ? { badge } : {});   // #1062-d 아이콘 숫자
            const payload = fitUnread(base, unread, unread_full);   // #1062-f 알림 맞추기 목록(웹 푸시 4KB 상한 안으로)
            return await pushTo(subs, payload, { TTL: 3600, urgency: 'high' });
        } catch (e) { console.error('[push] 문자 앱 보내기 실패(무시):', e.message); return { sent: 0, error: e.message }; }
    }

    // ── 화면에서 쓰는 길 ──
    app.get('/api/push/key', authMiddleware, async (req, res) => {
        try {
            await init();
            const app = req.query && req.query.label === APP_LABEL;   // #1062 문자 앱 화면은 ?label=sms-app 으로 자기 구독만 셈 · 본 앱 = 문자 앱 구독 뺀 수
            const n = (await pool.query(`SELECT COUNT(*)::int AS c FROM push_subscriptions WHERE user_id = $1 AND ${app ? 'label = $2' : 'label IS DISTINCT FROM $2'}`, [req.user.id, APP_LABEL])).rows[0].c;
            res.json({ key: vapid.publicKey, subscribed: n > 0, devices: n });
        } catch (e) { res.status(500).json({ error: '푸시 설정을 읽지 못했습니다' }); }
    });
    app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
        try {
            await init();
            const s = req.body || {};
            const keys = s.keys || {};
            if (!s.endpoint || !keys.p256dh || !keys.auth) return res.status(400).json({ error: '구독 정보가 모자랍니다' });
            await pool.query(
                `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, label)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, fail_count = 0${s.label === APP_LABEL ? ', label = EXCLUDED.label' : ''}`,
                [req.user.id, String(s.endpoint).slice(0, 700), String(keys.p256dh).slice(0, 200), String(keys.auth).slice(0, 100), s.label === APP_LABEL ? APP_LABEL : clip(req.headers['user-agent'], 120)]);   // #1062 문자 앱 = 'sms-app' · 그 밖 = UA(종전)
            res.json({ message: '이 기기로 알림을 받습니다' });
        } catch (e) { res.status(500).json({ error: '알림 받기를 켜지 못했습니다' }); }
    });
    app.post('/api/push/unsubscribe', authMiddleware, async (req, res) => {
        try {
            const ep = String((req.body && req.body.endpoint) || '');
            if (ep) await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [ep, req.user.id]);
            else await pool.query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND ${req.body && req.body.label === APP_LABEL ? 'label = $2' : 'label IS DISTINCT FROM $2'}`, [req.user.id, APP_LABEL]);   // #1062 endpoint 없이 끄기 = 그 앱 구독만
            res.json({ message: '이 기기 알림을 껐습니다' });
        } catch (e) { res.status(500).json({ error: '끄지 못했습니다' }); }
    });
    app.post('/api/push/test', authMiddleware, async (req, res) => {
        const r = await send(req.user.id, { title: '제주아꼼이네 알림 시험', message: '이렇게 폰으로 옵니다. 눌러 보세요.', link: 'agent-office' });
        res.json(Object.assign({ message: r.sent ? `${r.sent}개 기기로 보냈습니다` : '보낼 기기가 없습니다. 먼저 「알림 받기」를 켜 주세요.' }, r));
    });

    // ── 배달부: 아직 폰으로 안 보낸 알림을 찾아 보낸다 ──
    //   알림은 서버(createNotification)도 적고 창구(대표 PC의 respond.js)도 직접 적는다 → 표를 보고 보내야 빠짐이 없다.
    //   🔴 실서버에서만 돈다(RENDER 환경) — 로컬 검증 서버가 같은 DB를 보고 폰으로 쏘면 안 된다.
    //   시험 지시([검증469]) 결과는 보내지 않는다. 10분 넘은 알림도 보내지 않는다(서버가 쉬다 깨어나 옛 알림을 쏟아내지 않게).
    // ── #1111-B(대표 11/11 「알림은 주말·공휴일에는 가지 않도록 · 승협 화~토」) 쉬는 날 폰 푸시 보류 ──
    //   스위치 = 설정 staff_alerts.push_hold === true 일 때만(기본 꺼짐 = 종전 그대로) · 판정 = workdays.js(사람별 근무 요일 + 휴무일 달력)
    //   받는 사람의 쉬는 날에 생긴 알림 = 알림 종(notifications)에는 종전대로 바로 쌓이고 폰 푸시만 보류(push_held = true)
    //   → 그 사람의 다음 근무일 release_at(기본 09:00 KST · 대표 11/11 「근무일 오전 9시에」 · 그날 새 직원 알림은 09:01 부터라 묶음이 먼저)부터 한 통으로 묶어 「쉬는 동안 알림 n건 (M/D~M/D)」 + 종류별 건수 · 묶인 알림은 낱개 푸시 없음
    //   빼는 사람 = staff_alerts.push_hold_exempt(기본 [1, 10] = 대표·발주컴퓨터) · 문자 앱(sendApp)은 이 길을 안 지남(종전 그대로)
    const HOLD_KO = { document_submitted: '결재 요청', modification_requested: '수정 요청', document_approved: '결재 결과', document_rejected: '결재 결과', modification_approved: '수정 결과', modification_rejected: '수정 결과',
        expense: '지출결의', desk: '지시 결과', desk_login: '창구', leave_adj: '연차', payslip: '급여명세', rules: '규정', announcement: '지시사항', settle_recon: '정산 대조', sms: '문자', rank: '순위 요약' };
    let wdLoad = null;
    async function holdCfg() {
        if (!wdLoad) wdLoad = require('./workdays.js').loader(pool, console);
        const v = await wdLoad();
        const c = v.cfg || {};
        return { on: c.push_hold === true, exempt: new Set((Array.isArray(c.push_hold_exempt) ? c.push_hold_exempt : [1, 10]).map(Number)), releaseAt: /^\d{2}:\d{2}$/.test(String(c.push_release_at || '')) ? c.push_release_at : '09:00', v };
    }
    const kstNow = () => new Date(Date.now() + 9 * 3600e3).toISOString();
    function offNow(uid, h) { return require('./workdays.js').isOffFor(uid, kstNow().slice(0, 10), h.v.workdays, h.v.hol); }
    let releaseAt = 0;
    async function releaseHeld(h, force) {   // 1분에 한 번 · 근무일이 된 사람의 보류분을 한 통으로 · force = 스위치가 꺼짐(쉬는 날·시각 무관 · 끈 사람 뜻 = 보류 안 함)
        if (Date.now() - releaseAt < 60000) return; releaseAt = Date.now();
        if (!force && kstNow().slice(11, 16) < h.releaseAt) return;
        const users = (await pool.query(`SELECT DISTINCT user_id FROM notifications WHERE push_held = true`)).rows.map(r => r.user_id);
        for (const uid of users) {
            if (!force && offNow(uid, h)) continue;
            const got = (await pool.query(`UPDATE notifications SET push_held = false WHERE user_id = $1 AND push_held = true
                RETURNING type, to_char(created_at + interval '9 hours', 'FMMM/FMDD') AS md, created_at`, [uid])).rows;   // 표식 먼저 걷음 = 두 서버가 겹쳐도 한 번만 · created_at = 시간대 없는 UTC
            if (!got.length) continue;
            got.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            const cnt = {}; for (const g of got) { const k = HOLD_KO[g.type] || '그 밖'; cnt[k] = (cnt[k] || 0) + 1; }
            const span = got[0].md === got[got.length - 1].md ? got[0].md : `${got[0].md}~${got[got.length - 1].md}`;
            await send(uid, { title: `쉬는 동안 알림 ${got.length}건 (${span})`, message: Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ') + ' — 알림 종에서 확인', link: '' });
        }
    }
    let delivering = false;
    async function deliver() {
        if (delivering) return;
        delivering = true;
        try {
            await init();
            if (!deliver.colReady) { await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMP`); deliver.colReady = true; }   // 칸 만들기는 한 번만(매번 하면 표를 잠근다)
            let h = null;
            try { h = await holdCfg(); if (h.on && !deliver.holdReady) { await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS push_held BOOLEAN`); deliver.holdReady = true; } } catch (e) { console.error('[push] 쉬는 날 판정 실패(종전대로 바로 보냄):', e.message); h = null; }
            const r = await pool.query(`UPDATE notifications SET pushed_at = NOW()
                WHERE id IN (SELECT id FROM notifications WHERE pushed_at IS NULL ORDER BY id ASC LIMIT 20)
                RETURNING id, user_id, type, title, message, link, (created_at > NOW() - interval '10 minutes') AS fresh`);
            const sc = (h && h.on) ? await scope() : null;
            for (const n of r.rows) {
                if (!n.fresh) continue;
                if (h && h.on && !h.exempt.has(Number(n.user_id)) && !(n.type && sc[n.type] === false) && offNow(n.user_id, h)) {   // 쉬는 날 = 보류(폰으로 갈 종류만 · 알림 종엔 그대로)
                    await pool.query(`UPDATE notifications SET push_held = true WHERE id = $1`, [n.id]);
                    continue;
                }
                await send(n.user_id, { title: n.title, message: n.message, link: n.link, type: n.type });
            }
            if (h && h.on && deliver.holdReady) await releaseHeld(h);
            else if (h && !h.on) {   // #1111-B 스위치를 끈 뒤 = 남은 보류분을 한 번 풀어 묶음으로(영영 안 나가는 것 막기 · 칸이 없으면(한 번도 안 켬) 조회 오류 = 그냥 지나감)
                try { await releaseHeld(h, true); } catch (e) { if (!/push_held/.test(String(e.message))) console.error('[push] 보류분 풀기 실패(다음 주기):', e.message); }
            }
        } catch (e) { console.error("[push] 배달 실패(다음 주기에 다시):", e.message); }
        finally { delivering = false; }
    }
    if (process.env.RENDER) { const t = setInterval(deliver, 10000); if (t.unref) t.unref(); }

    return { send, sendApp, init, deliver };
};
