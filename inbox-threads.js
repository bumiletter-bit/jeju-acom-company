/* #658 문의 대화 창 — 톡톡 · 상품문의 · 주문문의를 문자 전용 창과 같은 꼴(목록 · 대화 · 보내기)로 (대표 2026-10-11)
 *
 * 쓰는 법(server.js): require('./inbox-threads.js')(app, { pool, authMiddleware, writeAudit, postQna, postInquiry, generate, kick });
 *   postQna(id, text, actor) · postInquiry(id, text, actor, opts) = server.js 의 등록 함수 그대로(여기서 네이버를 직접 부르지 않는다)
 *   generate(question, product) → { answer } | null = 자동답변 엔진 1회(톡톡 [초안 만들기] 버튼을 눌렀을 때만)
 *   kick() = 톡톡 배달부(desk-inbox.js deliver)를 바로 한 번 깨움(없으면 4초 틱을 기다림)
 *
 * · 읽는 표 = message_logs(톡톡봇과 같은 DB) · naver_qnas · naver_inquiries — 「확인 필요 문의」 칸(desk-inbox.js)·문의 관리 화면과 같은 reviewed_at 을 쓴다
 *   reviewed_at([확인] 버튼 · 「확인 필요 문의」 칸·아침 정리가 보는 칸)은 **이 창에서 답을 보내 성공했을 때만** 찍는다.
 *   이 창의 「열면 읽음」은 따로 둔 표식(inbox_thread_reads)이다 — 열어만 보고 답 안 한 글이 다른 화면에서 조용히 사라지지 않게(교차 점검 ②).
 * · 톡톡 보내기 = talk_outbox 에 넣고 배달 결과(sent/failed)를 최대 30초 기다린다. 카카오(kakao:)·자사몰(mall:) 손님은 볼 수만 있다.
 * · 상품문의·주문문의 보내기 = 누르면 바로 등록(대표 확정 — 고칠 때는 스마트스토어 센터). 둘이 같은 순간 눌러도 한 번만(posting_at 집기).
 * · 손님 식별값(톡톡 user_id)은 응답에 싣지 않는다 — 가린 열쇠(16자)로만 주고받는다.
 * · 표와 칸은 첫 요청 때 만든다(initDB·타이머 무접촉). 검증은 testMode + tables 로 시험용 표만 쓴다(라이브 표에 시험 줄을 넣지 않는다).
 */
'use strict';
const crypto = require('crypto');

const DAYS = 30;                 // 목록·대화가 보는 기간
const FRESH_DAYS = 3, OPEN_DAYS = 14;   // 안 읽음으로 세는 기간: 봇이 답한 글은 3일 · 아무도 안 답한 글은 14일(「확인 필요 문의」 칸과 같은 기준 — 옛 자동 답이 숫자에 쌓이지 않게)
const fresh = (state, ageDays) => ageDays <= FRESH_DAYS || (state === 'open' && ageDays <= OPEN_DAYS);
const ageOf = at => { const t = Date.parse(at); return Number.isFinite(t) ? (Date.now() - t) / 86400e3 : 999; };
const TALK_SEND_DAYS = 7;        // 톡톡봇 /send 가 받는 기간(최근 7일 안에 대화한 손님)
const TALK_MAX = 1000, POST_MAX = 2000;
const PAY_WORDS = /계좌|입금|이체|무통장|송금|현금\s*결제|현금으로/;   // 톡톡봇 /send 와 같은 낱말(네이버가 낱말만 보고 경고)
const AD_RE = /https?:\/\/|www\.|\.(kr|com|net|co\.kr)\b|순위\s*올리|상위\s*노출|리워드|마케팅\s*(대행|제안)|체험단|제휴\s*(문의|제안)|광고\s*(대행|문의|제안)|▰|▱/i;   // desk-inbox.js 와 같은 거름(업체 제안 글)
const STAFF_ONLY = '[직원 직접답변]', PHOTO_ONLY = '[이미지 전송]';
const ALREADY = '이미 답변한 문의예요 — 수정은 스마트스토어 센터에서 해 주세요';
const CHS = ['talk', 'qna', 'inquiry'];
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = c => `to_char(${c}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;   // 칸이 전부 timestamp(시간대 없음 · UTC 값)이라 글자로 받아 Z 를 붙인다(JS Date 로 받으면 9시간 어긋남)
const like = q => '%' + String(q).replace(/[\\%_]/g, m => '\\' + m) + '%';

module.exports = function mountInboxThreads(app, deps) {
    const { pool, authMiddleware, writeAudit } = deps;
    const T = { logs: 'message_logs', qnas: 'naver_qnas', inquiries: 'naver_inquiries', outbox: 'talk_outbox', drafts: 'inbox_thread_drafts', reads: 'inbox_thread_reads' };
    if (deps.testMode && deps.tables) for (const k of Object.keys(T)) if (/^[a-z0-9_]{3,60}$/.test(String(deps.tables[k] || ''))) T[k] = deps.tables[k];
    const CFG_KEY = deps.testMode ? 'inbox_threads_verify' : 'inbox_threads';
    const SALT = String(deps.salt || process.env.JWT_SECRET || 'akkome-inbox-threads');
    const KEY = `substr(md5($1::text || user_id), 1, 16)`;   // 가린 열쇠($1 = SALT)
    const keyOf = uid => crypto.createHash('md5').update(SALT + String(uid)).digest('hex').slice(0, 16);
    const log = { error: (...a) => console.error(...a) };

    let ready = null;
    // 표·칸은 없는 것만 만든다. message_logs 는 톡톡봇이 계속 쓰는 표라 잠금을 오래 기다리지 않는다(3초) — 실패하면 적어 두고 1분 뒤 다시(라우트는 계속 돈다)
    function ensure() {
        if (!ready) ready = (async () => {
            const hasCol = async (t, c) => (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`, [t, c])).rows.length > 0;
            const ddl = async sql => { const cl = await pool.connect(); try { await cl.query('BEGIN'); await cl.query(`SET LOCAL lock_timeout = '3s'`); await cl.query(sql); await cl.query('COMMIT'); } catch (e) { await cl.query('ROLLBACK').catch(() => { }); throw e; } finally { cl.release(); } };
            for (const t of [T.logs, T.qnas, T.inquiries]) {
                if (!(await hasCol(t, 'reviewed_at'))) await ddl(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`);
                if (!(await hasCol(t, 'reviewed_by'))) await ddl(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(50)`);
            }
            for (const t of [T.qnas, T.inquiries]) if (!(await hasCol(t, 'posting_at'))) await ddl(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS posting_at TIMESTAMP`);   // 집기 칸(등록하는 중)
            await pool.query(`CREATE TABLE IF NOT EXISTS ${T.outbox} (id SERIAL PRIMARY KEY, log_id INTEGER, user_id TEXT NOT NULL, body TEXT NOT NULL, order_id INTEGER, requested_by VARCHAR(50),
                status VARCHAR(12) DEFAULT 'queued', error TEXT, created_at TIMESTAMP DEFAULT NOW(), sent_at TIMESTAMP)`);
            await pool.query(`CREATE TABLE IF NOT EXISTS ${T.drafts} (ch VARCHAR(10) NOT NULL, tkey VARCHAR(40) NOT NULL, body TEXT NOT NULL, src_id BIGINT, made_by VARCHAR(50), made_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (ch, tkey))`);
            await pool.query(`CREATE TABLE IF NOT EXISTS ${T.reads} (ch VARCHAR(10) NOT NULL, tkey VARCHAR(40) NOT NULL, read_at TIMESTAMP DEFAULT NOW(), read_by VARCHAR(50), forced_unread BOOLEAN DEFAULT false, PRIMARY KEY (ch, tkey))`);
        })().catch(e => { log.error('[문의 창] 표·칸 준비 실패(1분 뒤 다시):', e.message); const t = setTimeout(() => { ready = null; }, 60000); if (t.unref) t.unref(); });
        return ready;
    }
    // 이 창의 읽음 표식(교차 점검 ②) — reviewed_at 과 따로다
    async function readMarks(ch) { const m = new Map(); for (const x of (await pool.query(`SELECT tkey, ${iso('read_at')} AS at, forced_unread FROM ${T.reads} WHERE ch = $1`, [ch])).rows) m.set(x.tkey, { at: x.at, forced: !!x.forced_unread }); return m; }
    async function readMark(ch, key) { const x = (await pool.query(`SELECT ${iso('read_at')} AS at, forced_unread FROM ${T.reads} WHERE ch = $1 AND tkey = $2`, [ch, String(key)])).rows[0]; return x ? { at: x.at, forced: !!x.forced_unread } : null; }
    async function setRead(ch, key, name, undo) {
        await pool.query(`INSERT INTO ${T.reads} (ch, tkey, read_at, read_by, forced_unread) VALUES ($1, $2, NOW(), $3, $4) ON CONFLICT (ch, tkey) DO UPDATE SET ${undo ? '' : 'read_at = NOW(), read_by = EXCLUDED.read_by, '}forced_unread = EXCLUDED.forced_unread`, [ch, String(key), clip(name, 50), !!undo]);
    }
    const who = req => ({ id: req.user.id, name: clip(req.user.name || req.user.username || '', 50) || 'staff', position: req.user.position, role: req.user.role, source: 'inbox_threads' });
    const wrap = fn => async (req, res) => {
        try { await ensure(); await fn(req, res); }
        catch (e) {
            if (e && e.status && e.message) return res.status(e.status).json(Object.assign({ ok: false, error: e.message }, e.extra || {}));
            log.error('[문의 창]', e && e.message); res.status(500).json({ ok: false, error: '처리하지 못했어요. 잠시 뒤 다시 해 주세요.' });
        }
    };
    const bad = (status, message, extra) => ({ status, message, extra });

    // ───────── 설정(초안 하루 상한) ─────────
    async function cfgGet(key) { try { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [key]); return r.rows[0] ? r.rows[0].value : null; } catch (e) { return null; } }
    async function cfgSet(key, value) { await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(value)]); }
    async function draftCap() { const v = (await cfgGet(CFG_KEY)) || {}; const n = Number(v.draft_daily_cap); return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.floor(n) : 50; }   // 0 = 상한 없음
    const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

    // ───────── 톡톡 ─────────
    const chOfUser = uid => { const u = String(uid || ''); return u.startsWith('kakao:') ? 'kakao' : u.startsWith('mall:') ? 'mall' : 'talk'; };
    const CH_NAME = { talk: '톡톡', kakao: '카카오', mall: '자사몰' };
    const staffParts = s => String(s || '').split(' | ').map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^\[에이전트오피스(?:·([^\]]{1,20}))?\]\s*/); return m ? { body: x.slice(m[0].length), by: m[1] || '', via: 'office' } : { body: x, by: '', via: 'center' }; });
    const botSilent = b => { const s = String(b || ''); return /^\[쿨다운/.test(s) ? '봇이 답한 뒤 30분 안에 다시 온 글' : /^\[AI에러/.test(s) ? '봇이 답을 만들지 못함' : /^\[이미지/.test(s) ? '사진(봇이 답하지 않음)' : /^\[직원응답/.test(s) ? '직원이 먼저 답함' : '봇이 넘긴 글'; };
    function talkCannot(uid, lastAgeDays) {
        const c = chOfUser(uid);
        if (c === 'kakao') return '카카오 손님에게는 여기서 보낼 수 없어요(카카오 채널 관리자센터에서 답해 주세요)';
        if (c === 'mall') return '자사몰 채팅 손님에게는 보낼 길이 없어요(손님이 창을 닫으면 닿지 않아요)';
        if (lastAgeDays > TALK_SEND_DAYS) return '마지막 대화가 7일을 넘어 톡톡으로 보낼 수 없어요';
        return '';
    }
    async function talkThreads({ scope, q }) {
        const params = [SALT, String(DAYS)]; let qsql = '';
        if (q) { params.push(like(q)); qsql = `WHERE l.user_id IN (SELECT user_id FROM w WHERE message ILIKE $3 OR (answered AND bot_response ILIKE $3) OR staff_response ILIKE $3 OR ${KEY} ILIKE $3)`; }
        const r = await pool.query(`
            WITH w AS (SELECT id, user_id, item, message, answered, bot_response, staff_response, received_at, reviewed_at FROM ${T.logs} WHERE received_at > NOW() - ($2 || ' days')::interval AND user_id IS NOT NULL),
                 r AS (SELECT user_id, COALESCE(max(id) FILTER (WHERE reviewed_at IS NOT NULL), 0) AS rid FROM w GROUP BY user_id),
                 u AS (SELECT w.user_id, array_agg(${iso('w.received_at')}) AS cand FROM w JOIN r USING (user_id) WHERE w.id > r.rid AND w.reviewed_at IS NULL AND btrim(COALESCE(w.message, '')) NOT IN ('', '${STAFF_ONLY}') GROUP BY w.user_id),
                 l AS (SELECT DISTINCT ON (user_id) * FROM w ORDER BY user_id, received_at DESC, id DESC)
            SELECT l.id, l.user_id, l.item, l.message, l.answered, l.bot_response, l.staff_response, ${iso('l.received_at')} AS at, u.cand,
                   ${KEY.replace('user_id', 'l.user_id')} AS tkey, EXTRACT(EPOCH FROM (NOW() - l.received_at)) / 86400 AS age
            FROM l LEFT JOIN u USING (user_id) ${qsql} ORDER BY l.received_at DESC LIMIT 200`, params);
        const dk = new Set((await pool.query(`SELECT d.tkey FROM ${T.drafts} d WHERE d.ch = 'talk'`)).rows.map(x => x.tkey));
        const marks = await readMarks('talk'); const out = [];
        for (const x of r.rows) {
            const msg = String(x.message || '').trim(); const staff = staffParts(x.staff_response); const bot = x.answered ? String(x.bot_response || '') : '';
            const ad = !x.answered && !staff.length && AD_RE.test(msg); const mk = marks.get(x.tkey) || null; const age = Number(x.age) || 0;
            x.unread = (x.cand || []).filter(t => !mk || t > mk.at).length;                               // 이 창에서 마지막으로 읽은 뒤(또는 [확인]한 줄 뒤)에 온 손님 글
            if (staff.length || !fresh(x.answered ? 'ai' : 'open', age)) x.unread = 0;                    // 마지막 글에 직원이 이미 답했으면(센터에서 친 답 포함) 안 읽음으로 세지 않는다
            if (mk && mk.forced) x.unread = Math.max(1, x.unread);                                        // 「안 읽음으로」 되돌린 대화
            const needs = !ad && !x.answered && !staff.length && !!msg && msg !== STAFF_ONLY && age <= OPEN_DAYS;   // 답이 필요한데 아직 아무도 안 답함(읽음과 무관)
            if (scope === 'active' && (x.unread <= 0 || ad)) continue;
            if (scope === 'open' && !needs) continue;
            const c = chOfUser(x.user_id);
            out.push({ ch: 'talk', id: x.tkey, sub_ch: c, title: CH_NAME[c] + ' 손님 ' + x.tkey.slice(-4), sub: x.item && x.item !== '기타' ? clip(x.item, 40) : '',
                last_text: clip(staff.length ? staff[staff.length - 1].body : (bot || (msg === PHOTO_ONLY ? '사진' : msg)), 120), last_at: x.at, last_dir: (staff.length || bot) ? 'out' : 'in',
                unread: ad ? 0 : x.unread, state: staff.length ? 'staff' : x.answered ? 'ai' : 'open', why: (x.answered || staff.length) ? '' : botSilent(x.bot_response),
                needs_reply: needs, has_draft: dk.has(x.tkey), can_send: !talkCannot(x.user_id, age) });
        }
        return out;
    }
    async function talkRows(tkey) {
        if (!/^[0-9a-f]{16}$/.test(String(tkey || ''))) return [];
        const r = await pool.query(`SELECT id, user_id, item, message, answered, bot_response, staff_response, image_url, reviewed_at, ${iso('received_at')} AS at, EXTRACT(EPOCH FROM (NOW() - received_at)) / 86400 AS age
            FROM ${T.logs} WHERE received_at > NOW() - ($2 || ' days')::interval AND user_id IS NOT NULL AND ${KEY} = $3 ORDER BY received_at DESC, id DESC LIMIT 300`, [SALT, String(DAYS), tkey]);
        return r.rows.reverse();
    }
    async function talkDraft(tkey, rows) {
        const lastIn = [...rows].reverse().find(x => { const m = String(x.message || '').trim(); return m && m !== STAFF_ONLY; });
        const d = (await pool.query(`SELECT body, src_id FROM ${T.drafts} WHERE ch = 'talk' AND tkey = $1`, [tkey])).rows[0];
        return d && lastIn && String(d.src_id) === String(lastIn.id) ? d.body : null;   // 손님이 새 글을 보내면 옛 초안은 안 보인다
    }
    async function talkDetail(tkey) {
        const rows = await talkRows(tkey); if (!rows.length) throw bad(404, '없는 대화예요(30일이 지났을 수 있어요)');
        const last = rows[rows.length - 1]; const c = chOfUser(last.user_id); const messages = [];
        for (const x of rows) {
            const msg = String(x.message || '').trim();
            if (msg && msg !== STAFF_ONLY) messages.push({ id: 'i' + x.id, direction: 'in', sender: 'customer', body: msg === PHOTO_ONLY ? '' : clip(msg, 2000), at: x.at, image_url: x.image_url || null, note: x.answered ? '' : botSilent(x.bot_response) });
            if (x.answered && x.bot_response) messages.push({ id: 'b' + x.id, direction: 'out', sender: 'bot', body: clip(x.bot_response, 3000), at: x.at });
            staffParts(x.staff_response).forEach((p, i) => messages.push({ id: 's' + x.id + '_' + i, direction: 'out', sender: 'staff', by: p.by, via: p.via, body: clip(p.body, 3000), at: x.at }));
        }
        const cannot = talkCannot(last.user_id, Number(last.age) || 0); const staffN = staffParts(last.staff_response).length;
        const rid = rows.reduce((m, x) => x.reviewed_at && x.id > m ? x.id : m, 0); const mk = await readMark('talk', tkey);
        let unread = rows.filter(x => x.id > rid && !x.reviewed_at && !['', STAFF_ONLY].includes(String(x.message || '').trim()) && (!mk || x.at > mk.at)).length * ((staffN || !fresh(last.answered ? 'ai' : 'open', Number(last.age) || 0)) ? 0 : 1);   // 목록의 셈과 같은 규칙
        if (mk && mk.forced) unread = Math.max(1, unread);
        const lastMsg = String(last.message || '').trim();
        const needs = !last.answered && !staffN && !!lastMsg && lastMsg !== STAFF_ONLY && !AD_RE.test(lastMsg) && (Number(last.age) || 0) <= OPEN_DAYS;
        return { rows, last,
            thread: { ch: 'talk', id: tkey, sub_ch: c, title: CH_NAME[c] + ' 손님 ' + tkey.slice(-4), sub: last.item && last.item !== '기타' ? clip(last.item, 40) : '', state: staffN ? 'staff' : last.answered ? 'ai' : 'open', unread, needs_reply: needs, last_at: last.at },
            messages, draft: await talkDraft(tkey, rows), can_send: !cannot, cannot_why: cannot, can_draft: !cannot, limits: { max_chars: TALK_MAX, confirm: false, time_note: '봇·직원 답의 시각은 손님 글 시각으로 보여요(톡톡은 답 시각을 따로 남기지 않아요)' } };
    }
    async function talkRead(tkey, name, undo) {
        const rows = await talkRows(tkey); if (!rows.length) throw bad(404, '없는 대화예요');
        await setRead('talk', tkey, name, undo);   // reviewed_at 은 건드리지 않는다(다른 화면의 [확인]과 따로)
    }
    async function talkSend(tkey, text, actor) {
        const d = await talkDetail(tkey);
        if (!d.can_send) throw bad(400, d.cannot_why);
        if (text.length > TALK_MAX) throw bad(400, '톡톡은 1,000자까지 보낼 수 있어요');
        if (PAY_WORDS.test(text)) throw bad(400, '결제 낱말(계좌·입금·이체·송금 등)이 든 글은 톡톡으로 보낼 수 없어요 — 네이버가 낱말만 보고 경고해요');
        // 같은 손님에게 같은 글이 아직 가는 중(10분 — 배달부가 집는 기한)이거나 방금(1분) 나갔으면 넣지 않는다(두 번 누름 · 둘이 같이 누름 · 요청이 끊긴 뒤 다시 누름)
        //   (같은 순간 두 요청이 서로를 못 보고 둘 다 넣지 않게 그 손님 열쇠로 잠근 채 넣는다)
        const cl = await pool.connect(); let ins;
        try {
            await cl.query('BEGIN'); await cl.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['inbox658:' + d.last.user_id]);
            ins = await cl.query(`INSERT INTO ${T.outbox} (log_id, user_id, body, requested_by)
                SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM ${T.outbox} WHERE user_id = $2 AND body = $3 AND ((status IN ('queued', 'sending') AND created_at > NOW() - interval '10 minutes') OR (status = 'sent' AND created_at > NOW() - interval '1 minute'))) RETURNING id`,
                [d.last.id, d.last.user_id, text, clip(actor.name, 50)]);
            await cl.query('COMMIT');
        } catch (e) { await cl.query('ROLLBACK').catch(() => { }); throw e; } finally { cl.release(); }
        if (!ins.rows.length) throw bad(409, '같은 글을 방금 보냈거나 아직 가는 중이에요 — 잠시 뒤 이 대화를 다시 열어 확인해 주세요', { code: 'duplicate' });
        const oid = ins.rows[0].id;
        if (typeof deps.kick === 'function') { try { Promise.resolve(deps.kick()).catch(() => { }); } catch (_) { } }
        const waitMs = Number(deps.talkWaitMs) > 0 ? Number(deps.talkWaitMs) : 30000; const t0 = Date.now(); let s = null;
        while (Date.now() - t0 < waitMs) {
            s = (await pool.query(`SELECT status, error FROM ${T.outbox} WHERE id = $1`, [oid])).rows[0];
            if (!s || s.status === 'sent' || s.status === 'failed') break;
            await sleep(deps.testMode ? 80 : 700);
        }
        if (s && s.status === 'sent') {
            await pool.query(`UPDATE ${T.logs} SET reviewed_at = COALESCE(reviewed_at, NOW()), reviewed_by = COALESCE(reviewed_by, $2) WHERE id = ANY($1::int[])`, [d.rows.map(x => x.id), clip(actor.name, 50)]);
            await pool.query(`DELETE FROM ${T.drafts} WHERE ch = 'talk' AND tkey = $1`, [tkey]);
            await setRead('talk', tkey, actor.name, false);
            return { ok: true, state: 'staff' };
        }
        if (s && s.status === 'failed') throw bad(502, '톡톡으로 보내지 못했어요: ' + clip(s.error || '사유 없음', 200), { code: 'send_failed' });
        const c = await pool.query(`UPDATE ${T.outbox} SET status = 'failed', error = '30초 안에 응답 없음(취소)' WHERE id = $1 AND status = 'queued' RETURNING id`, [oid]);
        if (c.rows.length) throw bad(504, '30초 안에 보내지지 않아 취소했어요. 잠시 뒤 다시 보내 주세요.', { code: 'timeout_cancelled' });
        throw bad(504, '보내는 중인데 결과를 아직 받지 못했어요 — 잠시 뒤 이 대화를 다시 열어 나갔는지 확인해 주세요(다시 보내면 두 번 나갈 수 있어요).', { code: 'timeout_unknown' });
    }
    const drafting = new Set();
    async function talkMakeDraft(tkey, actor) {
        if (typeof deps.generate !== 'function') throw bad(503, '초안을 만드는 길이 꺼져 있어요');
        const d = await talkDetail(tkey);
        if (!d.can_draft) throw bad(400, d.cannot_why);
        const ins = d.rows.filter(x => { const m = String(x.message || '').trim(); return m && m !== STAFF_ONLY && m !== PHOTO_ONLY; });
        if (!ins.length) throw bad(400, '손님 글이 없어 초안을 만들 수 없어요(사진만 온 대화는 직접 적어 주세요)');
        if (drafting.has(tkey)) throw bad(409, '초안을 만드는 중이에요', { code: 'busy' });
        drafting.add(tkey);
        try {
            const cap = await draftCap(); const day = kstDay();
            // 셈과 늘리기를 한 문장으로(둘이 같은 순간 눌러도 상한을 넘지 않게) — 상한이면 줄이 안 돌아온다
            const up = await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, jsonb_build_object('day', $2::text, 'n', 1))
                ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('day', $2::text, 'n', CASE WHEN agent_office_config.value->>'day' = $2::text THEN COALESCE((agent_office_config.value->>'n')::int, 0) + 1 ELSE 1 END), updated_at = NOW()
                WHERE $3::int = 0 OR agent_office_config.value->>'day' IS DISTINCT FROM $2::text OR COALESCE((agent_office_config.value->>'n')::int, 0) < $3::int
                RETURNING (value->>'n')::int AS n`, [CFG_KEY + '_state', day, cap]);
            if (!up.rows.length) throw bad(429, `오늘 초안 만들기 상한(${cap}번)을 다 썼어요 — 직접 적어 주세요`, { code: 'draft_cap' });
            const n = up.rows[0].n - 1;
            // 마지막 답(봇·직원) 뒤에 온 손님 글만(최대 3통) — 없으면 마지막 한 통
            let tail = []; for (let i = d.rows.length - 1; i >= 0 && tail.length < 3; i--) { const x = d.rows[i]; const m = String(x.message || '').trim(); const outed = x.answered || staffParts(x.staff_response).length; if (outed && tail.length) break; if (m && m !== STAFF_ONLY && m !== PHOTO_ONLY) tail.unshift(m); if (outed) break; }
            if (!tail.length) tail = [String(ins[ins.length - 1].message).trim()];
            let gen = null; try { gen = await deps.generate(tail.join('\n'), d.thread.sub || ''); } catch (e) { log.error('[문의 창] 초안 만들기 실패:', e.message); throw bad(502, '초안을 만들지 못했어요(AI 오류) — 직접 적어 주세요'); }
            const body = gen && String(gen.answer || '').trim();
            if (!body) return { ok: false, error: '이 글은 초안을 만들 재료가 없어요 — 직접 적어 주세요', code: 'no_draft' };
            const lastIn = [...d.rows].reverse().find(x => { const m = String(x.message || '').trim(); return m && m !== STAFF_ONLY; });
            await pool.query(`INSERT INTO ${T.drafts} (ch, tkey, body, src_id, made_by) VALUES ('talk', $1, $2, $3, $4) ON CONFLICT (ch, tkey) DO UPDATE SET body = EXCLUDED.body, src_id = EXCLUDED.src_id, made_by = EXCLUDED.made_by, made_at = NOW()`, [tkey, clip(body, TALK_MAX), lastIn.id, clip(actor.name, 50)]);
            return { ok: true, draft: clip(body, TALK_MAX), used_today: n + 1, cap };
        } finally { drafting.delete(tkey); }
    }

    // ───────── 상품문의 · 주문문의(질문 1 + 답 1) ─────────
    const POST = {
        qna: { table: () => T.qnas, id: 'question_id', okId: v => /^\d{1,15}$/.test(v), at: raw => raw.create_date, q: raw => clip(raw.question, 2000), a: raw => raw.answer, sub: () => '', why: () => '', fn: () => deps.postQna, arg: v => Number(v), opts: undefined, name: '상품문의' },
        inquiry: { table: () => T.inquiries, id: 'inquiry_id', okId: v => /^\d{1,30}$/.test(v), at: raw => raw.registered_at, q: raw => clip([raw.title, raw.content].filter(Boolean).join('\n'), 2000), a: raw => raw.answer_content, sub: raw => clip(raw.product_option, 60), why: raw => clip(raw.category, 20), fn: () => deps.postInquiry, arg: v => String(v), opts: { skipPhone: true }, name: '주문문의' },   // ⑤ 주문문의는 비공개라 전화번호 검사만 뺀다(대표 10/11)
    };
    const POST_COLS = c => `${POST[c].id}::text AS id, raw, answered, ai_status, ai_draft, posted_by, post_error, ${iso('posted_at')} AS posted_at, ${iso('reviewed_at')} AS reviewed_at, ${iso('collected_at')} AS collected_at`;
    function postShape(c, x, mk) {
        const P = POST[c], raw = x.raw || {}; const done = !!(x.answered || x.posted_at); const auto = done && x.posted_by === 'auto';
        const ans = done ? String(P.a(raw) || x.ai_draft || '') : ''; const draft = !done && x.ai_draft ? String(x.ai_draft) : null;
        const at = P.at(raw) || x.collected_at; const question = P.q(raw);
        const thread = { ch: c, id: String(x.id), title: clip(raw.product_name, 60) || P.name, sub: P.sub(raw), last_text: clip(done ? (ans || '답변함') : question, 120), last_at: done ? (x.posted_at || at) : at, last_dir: done ? 'out' : 'in',
            unread: ((mk && mk.forced) || (!mk && !x.reviewed_at && (!done || auto) && fresh(done ? 'ai' : 'open', ageOf(at)))) ? 1 : 0, needs_reply: !done && ageOf(at) <= OPEN_DAYS, state: !done ? 'open' : auto ? 'ai' : 'done', why: done ? '' : (x.post_error ? '자동 등록 실패' : x.ai_status === 'claim' ? '반품·교환·환불 분류' : x.ai_status === 'skip' ? '봇이 넘긴 글' : (P.why(raw) || '')), has_draft: !!draft, can_send: !done };
        return { thread, raw, done, auto, ans, draft, at, question };
    }
    async function postThreads(c, { scope, q }) {
        const P = POST[c];
        const r = await pool.query(`SELECT ${POST_COLS(c)} FROM ${P.table()} WHERE collected_at > NOW() - ($1 || ' days')::interval ORDER BY collected_at DESC, ${P.id} DESC LIMIT 300`, [String(DAYS)]);
        const ql = String(q || '').toLowerCase(); const out = []; const marks = await readMarks(c);
        for (const x of r.rows) {
            const s = postShape(c, x, marks.get(String(x.id)) || null);
            if (scope === 'active' && s.thread.unread <= 0) continue;
            if (scope === 'open' && !s.thread.needs_reply) continue;
            if (ql && !(s.question + '\n' + s.ans + '\n' + (s.draft || '') + '\n' + s.thread.title + '\n' + s.thread.id).toLowerCase().includes(ql)) continue;
            out.push(s.thread);
        }
        return out.sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || '')));
    }
    async function postRow(c, id) {
        const P = POST[c]; if (!P.okId(String(id || ''))) throw bad(400, '어느 문의인지 알 수 없어요');
        const x = (await pool.query(`SELECT ${POST_COLS(c)} FROM ${P.table()} WHERE ${P.id}::text = $1`, [String(id)])).rows[0];
        if (!x) throw bad(404, '없는 문의예요(수집 뒤 다시 열어 주세요)');
        return x;
    }
    async function postDetail(c, id) {
        const x = await postRow(c, id); const s = postShape(c, x, await readMark(c, id)); const messages = [{ id: 'q', direction: 'in', sender: 'customer', body: s.question, at: s.at }];
        if (s.done) messages.push({ id: 'a', direction: 'out', sender: s.auto ? 'bot' : 'staff', by: s.auto ? '' : clip(x.posted_by || '', 20), via: x.posted_at ? 'office' : 'center', body: clip(s.ans || '(답변 내용은 스마트스토어 센터에서 확인해 주세요)', 3000), at: x.posted_at || s.at });
        return { x, s, thread: s.thread, messages, draft: s.draft, can_send: !s.done, cannot_why: s.done ? ALREADY : '', can_draft: false, post_error: s.done ? '' : clip(x.post_error, 300),
            limits: { max_chars: POST_MAX, confirm: false, public: c === 'qna', pii_note: c === 'qna' ? '공개 게시판이에요 — 전화번호·주소·이메일이 들면 등록되지 않아요' : '주소·이메일이 들면 등록되지 않아요(전화번호는 돼요)' } };
    }
    async function postRead(c, id, name, undo) {
        const P = POST[c]; if (!P.okId(String(id || ''))) throw bad(400, '어느 문의인지 알 수 없어요');
        await postRow(c, id);
        await setRead(c, id, name, undo);   // reviewed_at 은 건드리지 않는다
    }
    async function postSend(c, id, text, actor) {
        const P = POST[c]; const fn = P.fn(); if (typeof fn !== 'function') throw bad(503, '등록하는 길이 꺼져 있어요');
        await postRow(c, id);
        if (text.length > POST_MAX) throw bad(400, '답변은 2,000자까지 등록할 수 있어요');
        // 집기: 아직 안 답했고 아무도 등록하는 중이 아닐 때만 한 사람이 집는다(2분 넘게 멈춘 집기는 풀린 것으로 본다)
        const claim = await pool.query(`UPDATE ${P.table()} SET posting_at = NOW() WHERE ${P.id}::text = $1 AND answered IS NOT TRUE AND posted_at IS NULL AND (posting_at IS NULL OR posting_at < NOW() - interval '2 minutes') RETURNING ${P.id}`, [String(id)]);
        if (!claim.rows.length) {
            const cur = (await pool.query(`SELECT answered, posted_at FROM ${P.table()} WHERE ${P.id}::text = $1`, [String(id)])).rows[0];
            if (cur && (cur.answered || cur.posted_at)) throw bad(409, ALREADY, { code: 'already' });
            throw bad(409, '다른 분이 지금 이 문의에 답을 등록하는 중이에요. 잠시 뒤 다시 열어 주세요.', { code: 'busy' });
        }
        try { await fn(P.arg(id), text, actor, P.opts); }
        catch (e) {
            await pool.query(`UPDATE ${P.table()} SET posting_at = NULL WHERE ${P.id}::text = $1`, [String(id)]).catch(() => { });
            const st = Number(e && e.status) || 500; const em = clip((e && e.message) || '', 400);
            if (st === 409) throw bad(409, ALREADY, { code: 'already' });
            if (st === 403 && /^개인정보 의심/.test(em)) throw bad(403, em, { code: 'pii' });                 // 우리 쪽 개인정보 검사(등록 함수 안)
            if (st === 400 || st === 404) throw bad(st, em || '등록하지 못했어요', { code: 'post_failed' });      // 빈 글 · 길이 · 없는 문의(등록 함수의 한국어 사유)
            // 그 밖(네이버·중계서버의 401·403·5xx 등)은 502 로 — 화면이 401 을 「로그인 만료」로 읽어 쓰던 답이 날아가지 않게
            throw bad(502, '네이버에 등록하지 못했어요' + (em ? ': ' + em : '') + ' — 잠시 뒤 다시 해 주세요.', { code: 'post_failed', upstream: st });
        }
        await pool.query(`UPDATE ${P.table()} SET posting_at = NULL, reviewed_at = COALESCE(reviewed_at, NOW()), reviewed_by = COALESCE(reviewed_by, $2) WHERE ${P.id}::text = $1`, [String(id), clip(actor.name, 50)]);
        await setRead(c, id, actor.name, false);
        return { ok: true, state: 'done' };
    }

    // ───────── 탭 숫자 ─────────
    let _cnt = null;
    async function countsCached() { if (_cnt && Date.now() - _cnt.at < (deps.testMode ? 0 : 8000)) return _cnt.v; const v = await counts(); _cnt = { at: Date.now(), v }; return v; }
    async function counts() {
        const one = async fn => { try { const l = await fn(); return { unread: l.filter(x => x.unread > 0).length, open: l.filter(x => x.needs_reply).length }; } catch (e) { log.error('[문의 창] 셈 실패:', e.message); return null; } };
        const [talk, qna, inquiry] = await Promise.all([one(() => talkThreads({ scope: 'all' })), one(() => postThreads('qna', { scope: 'all' })), one(() => postThreads('inquiry', { scope: 'all' }))]);
        return { talk, qna, inquiry };
    }

    // ───────── 라우트 ─────────
    const chOf = v => { const c = String(v || ''); if (!CHS.includes(c)) throw bad(400, '채널은 talk · qna · inquiry 중 하나예요'); return c; };
    app.get('/api/inbox/counts', authMiddleware, wrap(async (req, res) => res.json({ ok: true, counts: await countsCached(), at: new Date().toISOString() })));
    app.get('/api/inbox/threads', authMiddleware, wrap(async (req, res) => {
        const c = chOf(req.query.ch || 'talk'); const scope = ['all', 'open'].includes(req.query.scope) ? req.query.scope : 'active'; const q = clip(String(req.query.q || '').trim(), 60);
        const threads = c === 'talk' ? await talkThreads({ scope, q }) : await postThreads(c, { scope, q });
        res.json({ ok: true, ch: c, scope, days: DAYS, threads, counts: await countsCached(), at: new Date().toISOString() });
    }));
    app.get('/api/inbox/threads/:ch/:id', authMiddleware, wrap(async (req, res) => {
        const c = chOf(req.params.ch), id = String(req.params.id || ''), peek = req.query.peek === '1';
        const d = c === 'talk' ? await talkDetail(id) : await postDetail(c, id);
        if (!peek && d.thread.unread > 0) { _cnt = null; if (c === 'talk') await talkRead(id, who(req).name, false); else await postRead(c, id, who(req).name, false); d.thread.unread = 0; }
        res.json({ ok: true, thread: d.thread, messages: d.messages, draft: d.draft, can_send: d.can_send, cannot_why: d.cannot_why, can_draft: d.can_draft, post_error: d.post_error || '', limits: d.limits });
    }));
    const readRoute = undo => wrap(async (req, res) => {
        const c = chOf(req.params.ch), id = String(req.params.id || '');
        if (c === 'talk') await talkRead(id, who(req).name, undo); else await postRead(c, id, who(req).name, undo);
        _cnt = null; res.json({ ok: true });
    });
    app.post('/api/inbox/threads/:ch/:id/read', authMiddleware, readRoute(false));
    app.post('/api/inbox/threads/:ch/:id/unread', authMiddleware, readRoute(true));
    app.post('/api/inbox/threads/:ch/:id/send', authMiddleware, wrap(async (req, res) => {
        const c = chOf(req.params.ch), id = String(req.params.id || ''); const b = req.body || {}; const actor = who(req);
        const text = String(b.text == null ? '' : b.text).replace(/\r\n/g, '\n').trim();
        if (!text) throw bad(400, '보낼 글을 적어 주세요');
        // 순서: 보낼 수 없는 대화(이미 답함 · 카카오 등) 판정 → 화면이 본 초안(seen) 대조 → 보내기. seen 은 문자열일 때만 대조한다(문자 창 send-draft 와 같은 뜻)
        const d0 = c === 'talk' ? await talkDetail(id) : await postDetail(c, id);
        if (!d0.can_send) throw c === 'talk' ? bad(400, d0.cannot_why) : bad(409, ALREADY, { code: 'already' });
        if (typeof b.seen === 'string' && b.seen !== String(d0.draft || '')) throw bad(409, '초안이 바뀌었어요. 다시 확인하고 보내 주세요.', { code: 'draft_changed', draft: d0.draft || null });
        const r = c === 'talk' ? await talkSend(id, text, actor) : await postSend(c, id, text, actor);
        _cnt = null;
        if (writeAudit) await writeAudit({ action: 'send', targetType: 'inbox_thread', targetId: null, changes: { after: { ch: c, id: c === 'talk' ? id : String(id), length: text.length } }, source: 'inbox_threads', actor }).catch(e => log.error('[문의 창] audit 실패(무시):', e.message));
        res.json(r);
    }));
    app.post('/api/inbox/threads/:ch/:id/draft', authMiddleware, wrap(async (req, res) => {
        const c = chOf(req.params.ch); if (c !== 'talk') throw bad(400, '초안 만들기는 톡톡에서만 돼요(상품문의·주문문의는 수집할 때 만든 초안이 있어요)');
        res.json(await talkMakeDraft(String(req.params.id || ''), who(req)));
    }));

    return { ensure, counts, keyOf, tables: T, _talkThreads: talkThreads, _postThreads: postThreads };
};
