/* #473 웹 푸시 — 회사프로그램 알림을 폰 화면으로 (앱을 안 켜도 옴)
 *
 * 쓰는 법(server.js): const push = require('./push.js')(app, { pool, authMiddleware });
 *                     그리고 알림을 만들 때 push.send(userId, { title, message, link });
 *
 * · 열쇠(VAPID)는 첫 실행 때 한 번 만들어 agent_office_config 'webpush_vapid' 에 둔다(사람이 넣을 것 없음).
 * · 구독(어느 폰으로 보낼지)은 push_subscriptions 표에 쌓인다. 폰에서 알림을 끄면 그 줄만 지운다.
 * · 무엇을 보낼지는 agent_office_config 'push_scope' 로 고른다(기본 = 꼭 필요한 것만).
 * 🔴 손님 개인정보는 푸시 본문에 넣지 않는다 — 잠금 화면에 그대로 뜨기 때문.
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

    // 한 사람의 모든 기기로 보낸다. 실패해도 절대 위로 던지지 않는다(알림 때문에 본 기능이 멈추면 안 된다).
    async function send(userId, { title, message, link, type }) {
        try {
            if (!userId) return { sent: 0, skip: 'no-user' };
            if (type) { const sc = await scope(); if (sc[type] === false) return { sent: 0, skip: 'scope' }; }
            await init();
            const subs = (await pool.query(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, [userId])).rows;
            if (!subs.length) return { sent: 0, skip: 'no-sub' };
            const payload = JSON.stringify({ title: clip(title, 60) || '제주아꼼이네', body: clip(message, 120), link: clip(link, 60) || '' });
            let sent = 0, gone = 0;
            for (const s of subs) {
                try {
                    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
                    sent++;
                    await pool.query(`UPDATE push_subscriptions SET last_ok_at = NOW(), fail_count = 0 WHERE id = $1`, [s.id]);
                } catch (e) {
                    const code = e && e.statusCode;
                    if (code === 404 || code === 410) { await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]); gone++; }
                    else await pool.query(`UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = $1`, [s.id]);
                }
            }
            return { sent, gone };
        } catch (e) { console.error('[push] 보내기 실패(무시):', e.message); return { sent: 0, error: e.message }; }
    }

    // ── 화면에서 쓰는 길 ──
    app.get('/api/push/key', authMiddleware, async (req, res) => {
        try {
            await init();
            const n = (await pool.query(`SELECT COUNT(*)::int AS c FROM push_subscriptions WHERE user_id = $1`, [req.user.id])).rows[0].c;
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
                 ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, fail_count = 0`,
                [req.user.id, String(s.endpoint).slice(0, 700), String(keys.p256dh).slice(0, 200), String(keys.auth).slice(0, 100), clip(req.headers['user-agent'], 120)]);
            res.json({ message: '이 기기로 알림을 받습니다' });
        } catch (e) { res.status(500).json({ error: '알림 받기를 켜지 못했습니다' }); }
    });
    app.post('/api/push/unsubscribe', authMiddleware, async (req, res) => {
        try {
            const ep = String((req.body && req.body.endpoint) || '');
            if (ep) await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [ep, req.user.id]);
            else await pool.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [req.user.id]);
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
    let delivering = false;
    async function deliver() {
        if (delivering) return;
        delivering = true;
        try {
            await init();
            if (!deliver.colReady) { await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMP`); deliver.colReady = true; }   // 칸 만들기는 한 번만(매번 하면 표를 잠근다)
            const r = await pool.query(`UPDATE notifications SET pushed_at = NOW()
                WHERE id IN (SELECT id FROM notifications WHERE pushed_at IS NULL ORDER BY id ASC LIMIT 20)
                RETURNING id, user_id, type, title, message, link, (created_at > NOW() - interval '10 minutes') AS fresh`);
            for (const n of r.rows) {
                if (!n.fresh) continue;
                await send(n.user_id, { title: n.title, message: n.message, link: n.link, type: n.type });
            }
        } catch (e) { console.error("[push] 배달 실패(다음 주기에 다시):", e.message); }
        finally { delivering = false; }
    }
    if (process.env.RENDER) { const t = setInterval(deliver, 10000); if (t.unref) t.unref(); }

    return { send, init, deliver };
};
