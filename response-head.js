/* #1110-4 문의 관리 「응대 현황」 — 숫자 카드 + 채팅 미리보기 서버(설계 = docs/1110-4-response-head.md)
 *
 * 쓰는 법(server.js 장착 한 줄):
 *   require('./response-head.js')(app, { pool, authMiddleware, qnaGenerate, inquiryGenerate });
 *
 *   GET  /api/agent-office/response-stats?days=7|30   숫자(봇이 답함 / 직원이 답함 / 아직 안 답함 = 손님 대화 기준) + 사용 설정 상태 + 재료 수 + 미리보기 남은 횟수
 *   POST /api/agent-office/response-preview { channel:'talk'|'qna'|'inquiry'|'sms', text, item? }   답만 만들어 돌려줌
 *
 * · 둘 다 로그인한 직원 전부(세무사 계정은 403). 사용 설정을 바꾸는 주소는 여기 없다(종전 PUT 3개 = 대표만).
 * · 미리보기 = 생성만: 손님에게 보내지 않고 · 게시하지 않고 · message_logs·naver_qnas·sms_* 에 적지 않는다. 쓰는 것은 「오늘 몇 번 물었나」 한 칸(agent_office_config 'response_preview_state')뿐.
 *     talk    → 톡톡봇 POST {TALK_BOT_URL}/preview 대리 호출(Bearer SCENARIO_API_TOKEN) = 진짜 톡톡 자동 답
 *     qna     → qnaGenerate(text, item)            상품문의 지시문
 *     inquiry → inquiryGenerate({ content, product_name })   고객문의 지시문
 *     sms     → qnaGenerate(text, null, undefined, 'sms') + sms/ai-note.js parse([사람] = 넘김) — 주문 조회·규칙 답·클레임 고정 글은 안 탄다(AI 글만)
 * · 하루(KST) 회사 전체 상한 = agent_office_config 'response_preview' { daily_cap }(없으면 100 · 0 = 상한 없음 · 대표 확정 11/11) · 같은 사람 동시 1건
 * · 숫자는 30초 기억(날 수별) · 설정·남은 횟수는 매번 새로 읽는다(가벼움)
 * · 검증은 deps 를 가짜로 넣어 돌린다(scripts/verify-1110-4-head.js) — deps.fetch · deps.now · deps.tables(시험용 표 이름) · deps.cacheMs
 */
'use strict';

const AD_RE = /https?:\/\/|www\.|\.(kr|com|net|co\.kr)\b|순위\s*올리|상위\s*노출|리워드|마케팅\s*(대행|제안)|체험단|제휴\s*(문의|제안)|광고\s*(대행|문의|제안)|최상단\s*(노출|등록|가능|보장)|순위\s*(추적|보장)|▰|▱/i;   // inbox-threads.js 와 같은 거름(업체 제안 글)
const STAFF_ONLY = '[직원 직접답변]', ENTRY = '이 상품을 문의합니다.', ENTRY2 = '이 상품을 문의합니다';
const entryOnly = m => !String(m || '').split('\n').map(s => s.replace(/^\[메시지\d+\]\s*/, '').trim()).filter(s => s && s !== ENTRY && s !== ENTRY2).length;
const CHANNELS = ['talk', 'qna', 'inquiry', 'sms'];
const MAX_TEXT = 1000, DEFAULT_CAP = 100, BOT_TIMEOUT_MS = 65000;
const kstDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const zero = () => ({ total: 0, bot: 0, staff: 0, open: 0 });

// 톡톡 한 손님의 마지막 줄 → 'bot' | 'staff' | 'open' | null(세지 않음 = 입장 글뿐·광고·직원 글만) — 손님 연락 창(inbox-threads.js talkThreadsRaw)의 판정을 옮긴 것
function talkBin(x) {
    const msg = String(x.message || '').trim();
    const hasStaff = !!String(x.staff_response || '').trim();
    const handled = hasStaff || /^\[직원응답/.test(String(x.bot_response || ''));
    if (!msg || msg === STAFF_ONLY) return handled ? 'staff' : null;
    if (!handled && !x.answered && entryOnly(msg)) return null;
    if (!x.answered && !hasStaff && AD_RE.test(msg)) return null;
    if (handled || Number(x.rid) >= Number(x.id)) return 'staff';   // 직원 답 · [확인]한 대화
    return x.answered ? 'bot' : 'open';                              // 봇이 쉰 줄([쿨다운]·[1회응대]·[SKIP])은 answered=false → 아직 안 답함
}

module.exports = function mountResponseHead(app, deps) {
    const { pool, authMiddleware } = deps;
    const T = Object.assign({ logs: 'message_logs', qnas: 'naver_qnas', inquiries: 'naver_inquiries', smsThreads: 'sms_threads', smsMessages: 'sms_messages', scenarios: 'inquiry_scenarios', season: 'product_season_knowledge', config: 'agent_office_config', plog: 'response_preview_log' }, deps.tables || {});
    for (const k of Object.keys(T)) if (!/^[a-z0-9_]{3,60}$/.test(String(T[k]))) throw new Error('response-head: 표 이름이 이상해요 — ' + k);
    const now = deps.now || (() => Date.now());
    const doFetch = deps.fetch || (typeof fetch === 'function' ? fetch : null);
    const BOT_URL = String(deps.botUrl || process.env.TALK_BOT_URL || 'https://jeju-akkomene-talktalk-bot.onrender.com').replace(/\/+$/, '');
    const token = () => (typeof deps.token === 'function' ? deps.token() : process.env.SCENARIO_API_TOKEN) || '';
    const CACHE_MS = deps.cacheMs != null ? Number(deps.cacheMs) : 30000;
    const STATE_KEY = deps.stateKey || 'response_preview_state', CFG_KEY = deps.cfgKey || 'response_preview';
    const log = { error: (...a) => console.error(...a) };
    const guard = fn => async (req, res) => {
        try {
            if (req.user && req.user.role === 'accountant') return res.status(403).json({ ok: false, error: '이 화면을 볼 수 없는 계정이에요' });
            await fn(req, res);
        } catch (e) { log.error('[응대 현황]', e && e.message); res.status(500).json({ ok: false, error: '처리하지 못했어요. 잠시 뒤 다시 해 주세요.' }); }
    };
    const cfgGet = async key => { try { const r = await pool.query(`SELECT value FROM ${T.config} WHERE key = $1`, [key]); return r.rows[0] ? r.rows[0].value : null; } catch (e) { return null; } };

    // ───────── 숫자 ─────────
    async function talkStats(days) {
        const r = await pool.query(`
            WITH w AS (SELECT id, user_id, message, answered, bot_response, staff_response, reviewed_at FROM ${T.logs}
                       WHERE received_at > (NOW() AT TIME ZONE 'UTC') - make_interval(days => $1::int) AND user_id IS NOT NULL AND user_id NOT LIKE 'kakao:%' AND user_id NOT LIKE 'mall:%'),
                 r AS (SELECT user_id, COALESCE(max(id) FILTER (WHERE reviewed_at IS NOT NULL), 0) AS rid FROM w GROUP BY user_id),
                 l AS (SELECT DISTINCT ON (user_id) * FROM w ORDER BY user_id, (btrim(COALESCE(message, '')) IN ('${ENTRY}', '${ENTRY2}') AND btrim(COALESCE(staff_response, '')) = '') ASC, id DESC)
            SELECT l.id, l.message, l.answered, l.bot_response, l.staff_response, r.rid FROM l JOIN r USING (user_id)`, [days]);
        const o = zero();
        for (const x of r.rows) { const b = talkBin(x); if (b) { o[b]++; o.total++; } }
        return o;
    }
    async function postStats(table, days) {
        const r = (await pool.query(`SELECT
              count(*) FILTER (WHERE (answered OR posted_at IS NOT NULL) AND posted_by = 'auto')::int AS bot,
              count(*) FILTER (WHERE ((answered OR posted_at IS NOT NULL) AND COALESCE(posted_by, '') <> 'auto') OR (NOT answered AND posted_at IS NULL AND reviewed_at IS NOT NULL))::int AS staff,
              count(*) FILTER (WHERE NOT answered AND posted_at IS NULL AND reviewed_at IS NULL)::int AS open
            FROM ${table} WHERE collected_at > NOW() - make_interval(days => $1::int)`, [days])).rows[0];
        return { total: r.bot + r.staff + r.open, bot: r.bot, staff: r.staff, open: r.open };
    }
    async function smsStats(days) {
        // 기간 안에 손님 글이 온 대화 · 사람 몫 판정 = sms/index.js HUMAN_SQL·OPEN_SQL 과 같은 뜻(사유 또는 초안 있음 · 끝남·무시 제외)
        const r = (await pool.query(`
            WITH act AS (SELECT DISTINCT thread_id FROM ${T.smsMessages} WHERE direction = 'in' AND event_at > NOW() - make_interval(days => $1::int) AND COALESCE(bucket, 'other') NOT IN ('otp', 'ad', 'carrier')),
                 t AS (SELECT t.id, (t.status NOT IN ('closed', 'ignored') AND (t.staff_why IS NOT NULL OR t.draft_text IS NOT NULL)) AS open,
                              (SELECT m.sender FROM ${T.smsMessages} m WHERE m.thread_id = t.id AND m.direction = 'out' AND m.state NOT IN ('cancelled', 'failed') ORDER BY m.id DESC LIMIT 1) AS last_out
                       FROM ${T.smsThreads} t JOIN act a ON a.thread_id = t.id WHERE t.status <> 'ignored' AND t.phone_digits NOT LIKE '0999%')
            SELECT count(*) FILTER (WHERE open)::int AS open, count(*) FILTER (WHERE NOT open AND last_out = 'bot')::int AS bot, count(*) FILTER (WHERE NOT open AND COALESCE(last_out, '') <> 'bot')::int AS staff FROM t`, [days])).rows[0];
        return { total: r.bot + r.staff + r.open, bot: r.bot, staff: r.staff, open: r.open };
    }
    const _cache = new Map();   // days → { at, v }
    async function counts(days) {
        const hit = _cache.get(days);
        if (hit && CACHE_MS > 0 && now() - hit.at < CACHE_MS) return hit.v;
        const one = async (name, fn) => { try { return await fn(); } catch (e) { log.error('[응대 현황] 셈 실패(' + name + '):', e.message); return null; } };
        const [talk, qna, inquiry, sms] = await Promise.all([one('talk', () => talkStats(days)), one('qna', () => postStats(T.qnas, days)), one('inquiry', () => postStats(T.inquiries, days)), one('sms', () => smsStats(days))]);
        const channels = { talk, qna, inquiry, sms };
        const all = zero(); for (const k of CHANNELS) if (channels[k]) for (const f of ['total', 'bot', 'staff', 'open']) all[f] += channels[k][f];
        const v = { channels, all };
        _cache.set(days, { at: now(), v });
        return v;
    }
    async function settings() {
        const keys = ['inquiry_auto_reply', 'qna_auto_post', 'inquiry_auto_post', 'sms_gateway', 'bot_timing'];
        const m = {}; try { for (const x of (await pool.query(`SELECT key, value FROM ${T.config} WHERE key = ANY($1::text[])`, [keys])).rows) m[x.key] = x.value; } catch (e) { log.error('[응대 현황] 설정 읽기 실패:', e.message); return null; }
        const sg = (m.sms_gateway && typeof m.sms_gateway === 'object') ? m.sms_gateway : {}, bt = (m.bot_timing && typeof m.bot_timing === 'object') ? m.bot_timing : {};
        const h = Number(bt.once_until_hour);
        return { auto_reply: m.inquiry_auto_reply !== 'off', qna_auto_post: m.qna_auto_post !== 'off', inquiry_auto_post: m.inquiry_auto_post === 'on',   // 기본값 = 서버 시드와 같게(상품문의 on · 고객문의 off)
            sms_mode: sg.enabled === false ? 'off' : (['record', 'draft', 'auto'].includes(sg.mode) ? sg.mode : 'record'),
            talk_once_until_hour: (bt.once_until_hour != null && typeof bt.once_until_hour !== 'boolean' && Number.isInteger(h) && h >= 0 && h <= 23) ? h : null };
    }
    async function materials() {
        try {
            const sc = (await pool.query(`SELECT count(*)::int AS n FROM ${T.scenarios} WHERE deleted_at IS NULL`)).rows[0].n;
            const sk = (await pool.query(`SELECT start_md, end_md FROM ${T.season} WHERE deleted_at IS NULL`)).rows;
            const md = kstDay(now()).slice(5);
            const inR = (s, e) => (s <= e) ? (md >= s && md <= e) : (md >= s || md <= e);
            return { scenarios: sc, season: sk.length, season_today: sk.filter(r => inR(String(r.start_md || '').trim(), String(r.end_md || '').trim())).length };
        } catch (e) { log.error('[응대 현황] 재료 수 읽기 실패:', e.message); return null; }
    }
    async function capOf() { const v = (await cfgGet(CFG_KEY)) || {}; const n = Number(v.daily_cap); return Number.isFinite(n) && n >= 0 && n <= 5000 ? Math.floor(n) : DEFAULT_CAP; }
    async function previewLeft() {
        const cap = await capOf(); if (!cap) return { left_today: null, cap: 0 };
        const st = (await cfgGet(STATE_KEY)) || {}; const used = st.day === kstDay(now()) ? (Number(st.n) || 0) : 0;
        return { left_today: Math.max(0, cap - used), cap };
    }

    app.get('/api/agent-office/response-stats', authMiddleware, guard(async (req, res) => {
        const days = String(req.query.days || '') === '30' ? 30 : 7;
        const [c, st, mat, pv] = await Promise.all([counts(days), settings(), materials(), previewLeft()]);
        const t = now();
        res.json({ ok: true, days, from: kstDay(t - (days - 1) * 86400e3), to: kstDay(t), channels: c.channels, all: c.all, settings: st, materials: mat, preview: pv });
    }));

    // ───────── 미리보기 ─────────
    const busy = new Set();
    // 셈과 늘리기를 한 문장으로(둘이 같은 순간 눌러도 상한을 넘지 않게 · inbox-threads.js 초안 상한과 같은 꼴) — 상한이면 줄이 안 돌아온다
    async function capTake(cap) {
        const day = kstDay(now());
        const up = await pool.query(`INSERT INTO ${T.config} (key, value) VALUES ($1, jsonb_build_object('day', $2::text, 'n', 1))
            ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('day', $2::text, 'n', CASE WHEN ${T.config}.value->>'day' = $2::text THEN COALESCE((${T.config}.value->>'n')::int, 0) + 1 ELSE 1 END), updated_at = NOW()
            WHERE $3::int = 0 OR ${T.config}.value->>'day' IS DISTINCT FROM $2::text OR COALESCE((${T.config}.value->>'n')::int, 0) < $3::int
            RETURNING (value->>'n')::int AS n`, [STATE_KEY, day, cap]);
        return up.rows.length ? up.rows[0].n : null;
    }
    async function capGiveBack() {   // AI 를 부르기 전에 막힌 경우(톡톡봇이 안 받음 등)만 한 칸 돌려줌 · 실패해도 무시
        try { await pool.query(`UPDATE ${T.config} SET value = jsonb_set(value, '{n}', to_jsonb(GREATEST(COALESCE((value->>'n')::int, 1) - 1, 0))), updated_at = NOW() WHERE key = $1 AND value->>'day' = $2`, [STATE_KEY, kstDay(now())]); } catch (e) { /* 무시 */ }
    }
    async function namesToNos(names) {
        const list = (Array.isArray(names) ? names : []).map(s => String(s || '').trim()).filter(Boolean).slice(0, 12);
        if (!list.length) return { scenario_nos: [], scenario_names: [] };
        try {
            const rows = (await pool.query(`SELECT scenario_no, name FROM ${T.scenarios} WHERE deleted_at IS NULL AND name = ANY($1::text[])`, [list])).rows;
            const by = new Map(rows.map(r => [r.name, r.scenario_no]));
            const kept = list.filter(n => by.has(n));   // 시나리오 표에 있는 이름만(시기 지식·발송 일정 같은 가상 재료는 번호가 없다)
            return { scenario_nos: kept.map(n => String(by.get(n))), scenario_names: kept };
        } catch (e) { return { scenario_nos: [], scenario_names: [] }; }
    }
    async function viaBot(text, item) {
        const tk = token();
        if (!doFetch || !tk) return { status: 502, body: { ok: false, code: 'bot_key', error: '톡톡봇 미리보기 열쇠가 없어 부르지 못했어요' }, refund: true };
        const ac = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ac ? setTimeout(() => ac.abort(), deps.botTimeoutMs || BOT_TIMEOUT_MS) : null;
        let r, j = null;
        try {
            r = await doFetch(BOT_URL + '/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ text, item: item || '' }), signal: ac ? ac.signal : undefined });
            try { j = await r.json(); } catch (e) { j = null; }
        } catch (e) {
            const timeout = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
            return { status: timeout ? 504 : 502, body: { ok: false, code: timeout ? 'timeout' : 'bot_down', error: timeout ? '답을 만드는 데 너무 오래 걸렸어요' : '톡톡봇 미리보기를 못 불렀어요' }, refund: !timeout };
        } finally { if (timer) clearTimeout(timer); }
        if (r.status === 404) return { status: 502, body: { ok: false, code: 'bot_old', error: '톡톡 미리보기는 준비 중이에요(톡톡봇이 아직 지원하지 않아요)' }, refund: true };
        if (r.status === 429) return { status: 429, body: { ok: false, code: 'bot_cap', error: '톡톡봇 미리보기가 잠깐 막혔어요 — 조금 뒤 다시 물어봐 주세요', retry_after: j && Number(j.retry_after) > 0 ? Number(j.retry_after) : undefined }, refund: true };
        if (r.status === 504) return { status: 504, body: { ok: false, code: 'timeout', error: '답을 만드는 데 너무 오래 걸렸어요' }, refund: false };
        if (r.status !== 200 || !j || j.ok !== true) return { status: 502, body: { ok: false, code: 'bot_down', error: '톡톡봇 미리보기를 못 불렀어요' }, refund: r.status === 401 || r.status === 503 || r.status === 400 };
        if (j.skip) return { status: 200, body: { ok: true, skip: true, why: clip(j.why || 'no_material', 30), why_text: clip(j.why_text || '봇이 답하지 않고 넘겨요 → 실제로는 직원 몫', 300) } };
        return { status: 200, body: { ok: true, skip: false, answer: clip(j.answer, 6000), source: j.source === 'price_direct' ? 'price_direct' : 'ai',
            scenario_nos: (Array.isArray(j.scenario_nos) ? j.scenario_nos : []).map(x => clip(x, 12)).slice(0, 12), scenario_names: (Array.isArray(j.scenario_names) ? j.scenario_names : []).map(x => clip(x, 80)).slice(0, 12) } };
    }
    // #1110-4b 문자 불만 글 = 실제 흐름(sms/index.js 499~508)처럼 AI 전에 정해 둔 글 먼저 · 순수 함수만 씀(주문 조회·DB·AI 0)
    //   주문을 찾았을 때 = rules.claimText(#1065 대표 확정 글) · 그 글이 없는 불만(미도착·누락…) = 찾으면 직원 몫 → 못 찾았을 때 글(#1077)만 보여 줌
    function smsClaim(text) {
        let cls, rules, safe = null;
        try { cls = require('./sms/classify.js'); rules = require('./sms/rules.js'); } catch (e) { return null; }
        try { safe = require('./sms/sms-safe.js'); } catch (e) { safe = null; }
        let bucket = null; try { bucket = (cls.classify(text, { from: '01000000000' }) || {}).bucket; } catch (e) { return null; }
        if (bucket !== 'claim' || typeof rules.claimText !== 'function') return null;
        const fix = t => clip((safe && typeof safe.smsSafe === 'function') ? safe.smsSafe(t) : t, 6000);
        let ct = null, nf = null;
        try { ct = rules.claimText({ text }); nf = typeof rules.notFoundText === 'function' ? rules.notFoundText({ claim: true, text }) : null; } catch (e) { return null; }
        if (ct) return { status: 200, refund: true, body: { ok: true, skip: false, answer: fix(ct), source: 'sms_rule', scenario_nos: [], scenario_names: [],
            note: '불만 글은 AI 없이 정해 둔 사과 초안이 먼저예요(주문을 찾았을 때 · 그 대화에 한 번만 · 직원이 보고 보냄). 보낸 번호로 주문을 못 찾으면 사과 뒤 주문하신 분·받는 분 성함을 묻는 글이 대신 나와요.' } };
        if (nf) return { status: 200, refund: true, body: { ok: true, skip: false, answer: fix(nf), source: 'sms_rule', scenario_nos: [], scenario_names: [],
            note: '이런 불만(미도착·누락 등)은 주문을 찾으면 봇 글 없이 직원 몫이에요. 위 글은 보낸 번호로 주문을 못 찾았을 때만 나오는 초안이에요.' } };
        return { status: 200, refund: true, body: { ok: true, skip: true, why: 'to_staff', why_text: '불만 글이라 봇이 답하지 않아요 → 실제로는 직원 몫' } };
    }
    async function viaEngine(channel, text, item) {
        let g = null;
        if (channel === 'sms') { const pre = smsClaim(text); if (pre) return pre; }
        if (channel === 'inquiry') { if (typeof deps.inquiryGenerate !== 'function') return { status: 503, body: { ok: false, code: 'no_engine', error: '고객문의 미리보기 길이 꺼져 있어요' }, refund: true }; g = await deps.inquiryGenerate({ title: '', content: text, product_name: item || '' }); }
        else { if (typeof deps.qnaGenerate !== 'function') return { status: 503, body: { ok: false, code: 'no_engine', error: '미리보기 길이 꺼져 있어요' }, refund: true }; g = channel === 'sms' ? await deps.qnaGenerate(text, null, undefined, 'sms') : await deps.qnaGenerate(text, item || null); }
        let answer = g && String(g.answer || '').trim();
        if (!answer) return { status: 200, body: { ok: true, skip: true, why: 'no_material', why_text: '봇이 답하지 않고 넘겨요(재료로 답할 수 없거나 확신 없음) → 실제로는 직원 몫' } };
        if (channel === 'sms') {
            let note = null; try { note = require('./sms/ai-note.js'); } catch (e) { note = null; }
            if (note && typeof note.parse === 'function') {
                const p = note.parse(answer);
                if (p.toStaff) return { status: 200, body: { ok: true, skip: true, why: 'to_staff', why_text: '봇이 직원에게 넘겨요' + (p.why ? '(' + clip(p.why, 60) + ')' : '') + ' → 실제로는 직원 몫' } };
                answer = typeof note.stripHandoff === 'function' ? note.stripHandoff(p.text) : p.text;
                if (!answer) return { status: 200, body: { ok: true, skip: true, why: 'to_staff', why_text: '봇이 직원에게 넘겨요 → 실제로는 직원 몫' } };
            }
        }
        const used = await namesToNos(g.used);
        return { status: 200, body: Object.assign({ ok: true, skip: false, answer: clip(answer, 6000), source: 'ai' }, used) };
    }

    app.post('/api/agent-office/response-preview', authMiddleware, guard(async (req, res) => {
        const b = req.body || {}; const channel = String(b.channel || '');
        const text = String(b.text || '').trim(), item = clip(String(b.item || '').trim(), 100);
        if (!CHANNELS.includes(channel)) return res.status(400).json({ ok: false, error: '채널 값이 틀려요' });
        if (!text) return res.status(400).json({ ok: false, error: '물어볼 글을 적어 주세요' });
        if (text.length > MAX_TEXT) return res.status(400).json({ ok: false, error: '1,000자까지 물어볼 수 있어요' });
        const uid = String(req.user && req.user.id);
        if (busy.has(uid)) return res.status(429).json({ ok: false, code: 'busy', error: '앞서 물어본 글의 답을 만드는 중이에요' });
        const cap = await capOf(); let took = null;
        if (cap > 0 || cap === 0) { took = await capTake(cap); if (took == null) return res.status(429).json({ ok: false, code: 'day_cap', error: `오늘 미리보기(${cap}번)를 다 썼어요 — 내일 다시 물어봐 주세요`, left_today: 0, cap }); }
        busy.add(uid); const t0 = now(); let out;
        try { out = channel === 'talk' ? await viaBot(text, item) : await viaEngine(channel, text, item); }
        catch (e) { log.error('[응대 현황] 미리보기 실패(' + channel + '):', e && e.message); out = { status: 502, body: { ok: false, code: 'ai_error', error: '답을 만들지 못했어요(AI 오류) — 잠시 뒤 다시 물어봐 주세요' }, refund: false }; }
        finally { busy.delete(uid); }
        if (out.refund) await capGiveBack();
        const left = await previewLeft(); const ms = now() - t0;
        res.status(out.status).json(Object.assign({ channel, ms }, out.body, left));
        plogLast = plogAdd(req.user, channel, text, out, ms);
    }));

    // ───────── #1110-5 미리보기 이력(누가 · 무엇을 물었고 · 무슨 답이 나왔나) ─────────
    // 표는 처음 기록할 때 만든다(initDB 무접촉 · 읽기만 하는 기동에서는 안 만들어짐) · 기록 실패는 미리보기 답을 막지 않는다 · 90일 보관
    const PLOG_KEEP_DAYS = 90, PLOG_MAX = 2000;
    let plogReady = null, plogCleanDay = '', plogLast = Promise.resolve();
    const plogEnsure = () => plogReady || (plogReady = (async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${T.plog} (id BIGSERIAL PRIMARY KEY, user_id INTEGER, user_name TEXT, channel TEXT NOT NULL, question TEXT NOT NULL, answer TEXT, source TEXT, scenario_nos JSONB, ms INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await pool.query(`CREATE INDEX IF NOT EXISTS ${T.plog}_created_idx ON ${T.plog} (created_at DESC)`);
    })().catch(e => { plogReady = null; throw e; }));
    function plogRow(user, channel, text, out, ms) {
        const b = (out && out.body) || {}; const good = out && out.status === 200 && b.ok;
        const source = good ? (b.skip ? 'skip' : String(b.source || 'ai')) : 'error';
        const answer = good ? (b.skip ? b.why_text : b.answer) : b.error;
        const nos = good && !b.skip && Array.isArray(b.scenario_nos) ? b.scenario_nos.slice(0, 20).map(x => clip(String(x), 20)) : [];
        const uid = Number(user && user.id);
        return [Number.isInteger(uid) ? uid : null, clip(String((user && user.name) || ''), 60), channel, clip(String(text || ''), PLOG_MAX), clip(String(answer || ''), PLOG_MAX), clip(source, 30), JSON.stringify(nos), Math.max(0, Math.min(Math.round(Number(ms) || 0), 2000000000))];
    }
    async function plogAdd(user, channel, text, out, ms) {
        try {
            await plogEnsure();
            await pool.query(`INSERT INTO ${T.plog} (user_id, user_name, channel, question, answer, source, scenario_nos, ms) VALUES ($1::int, $2::text, $3::text, $4::text, $5::text, $6::text, $7::jsonb, $8::int)`, plogRow(user, channel, text, out, ms));
            const day = new Date(now() + 9 * 3600000).toISOString().slice(0, 10);
            if (day !== plogCleanDay) { plogCleanDay = day; await pool.query(`DELETE FROM ${T.plog} WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`, [PLOG_KEEP_DAYS]); }
        } catch (e) { log.error('[응대 현황] 미리보기 이력 기록 실패:', e && e.message); }
    }
    // #1110-5b(대표 11/11): 이력 보기는 대표 계정만(관리자도 X) · 판정 = server.js isOwnerUser(deps.isOwner) · 없으면 닫힘 · 쌓기(plogAdd)는 종전대로 전 직원
    const isOwner = typeof deps.isOwner === 'function' ? deps.isOwner : () => false;
    app.get('/api/agent-office/response-preview-log', authMiddleware, guard(async (req, res) => {
        if (!isOwner(req.user)) return res.status(403).json({ ok: false, error: '대표만 볼 수 있어요' });
        const q = req.query || {};
        const limit = Math.max(1, Math.min(Number.parseInt(q.limit, 10) || 50, 100));
        const before = /^\d{1,18}$/.test(String(q.before || '')) ? String(q.before) : null;
        const user = /^\d{1,9}$/.test(String(q.user || '')) ? Number(q.user) : null;
        const channel = CHANNELS.includes(String(q.channel || '')) ? String(q.channel) : null;
        let rows = [], users = [];
        try {
            rows = (await pool.query(`SELECT id, user_id, user_name, channel, question, answer, source, scenario_nos, ms, created_at FROM ${T.plog}
                WHERE ($1::bigint IS NULL OR id < $1::bigint) AND ($2::int IS NULL OR user_id = $2::int) AND ($3::text IS NULL OR channel = $3::text)
                ORDER BY id DESC LIMIT $4::int`, [before, user, channel, limit + 1])).rows;
            if (!before) users = (await pool.query(`SELECT user_id AS id, max(user_name) AS name FROM ${T.plog} WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY max(id) DESC LIMIT 50`)).rows;
        } catch (e) { if (!(e && e.code === '42P01')) throw e; }   /* 표가 아직 없음(미리보기를 한 번도 안 씀) = 빈 목록 */
        const more = rows.length > limit; if (more) rows = rows.slice(0, limit);
        res.json({ ok: true, keep_days: PLOG_KEEP_DAYS, more, users: before ? undefined : users.map(u => ({ id: Number(u.id), name: u.name || '' })),
            rows: rows.map(r => ({ id: Number(r.id), user_id: r.user_id, user_name: r.user_name || '', channel: r.channel, question: r.question, answer: r.answer || '', source: r.source || '', scenario_nos: Array.isArray(r.scenario_nos) ? r.scenario_nos : [], ms: r.ms, created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at })) });
    }));

    return { _talkBin: talkBin, _counts: counts, _settings: settings, _materials: materials, _previewLeft: previewLeft, _plogWait: () => plogLast, _plogRow: plogRow, tables: T };
};
module.exports.talkBin = talkBin;
