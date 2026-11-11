// #1113-4·5 문자 요약 숫자(시각 범위) · 대화 열기(최근 300통) 검증
//   ① 종전 식 `(시각 + 9시간)::date = 날` 과 새 식 `시각 >= 날 − 9h AND 시각 < 날 + 1일 − 9h` 를 실DB 에서 SELECT 만 해 오늘·지난 14일 날짜별 숫자 대조(today_in·today_bot·today_staff 세 칸 · 라이브 줄 포함)
//      + 경계 시각 가짜 값(KST 자정 앞뒤 1초)으로 두 식이 같은 판정인지(VALUES · 표 없음)
//   ② 시험 번호 0999113… 대화에 글 310통을 넣고 GET /api/sms/threads/:id = 최근 300통 · 오래된 → 최신 순 · 끝에 지움
//   실행: node scripts/verify-1113-sms.js   (포트 PORT1113 또는 3459 · 실DB 쓰기 = 시험 번호 줄만)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express'); const jwt = require('jsonwebtoken'); const { Pool } = require('pg');
const mount = require('../sms/index.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const PORT = Number(process.env.PORT1113 || 3459), JWT = 'verify1113jwt', T = '0999113';
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (!c && d != null ? ' — ' + String(d).slice(0, 400) : '')); };
async function cleanup() {
    await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%']);
}
(async () => {
    try {
        console.log('① 요약 숫자 = 종전 식과 같음');
        const OLD = c => `(${c} + interval '9 hours')::date = $1::date`, NEW = c => `${c} >= ($1::date::timestamptz - interval '9 hours') AND ${c} < ($1::date::timestamptz + interval '1 day' - interval '9 hours')`;
        const Q = f => `SELECT (SELECT count(*)::int FROM sms_messages WHERE direction = 'in' AND ${f('event_at')}) a,
            (SELECT count(*)::int FROM sms_messages WHERE direction = 'out' AND sender = 'bot' AND state IN ('sent','delivered') AND ${f('sent_at')}) b,
            (SELECT count(*)::int FROM sms_messages WHERE direction = 'out' AND sender IN ('gateway_other','staff_desk') AND ${f('event_at')}) c`;
        const days = (await pool.query(`SELECT to_char(((now() + interval '9 hours')::date - g), 'YYYY-MM-DD') d FROM generate_series(0, 14) g`)).rows.map(r => r.d);
        const diff = []; let tot = 0;
        for (const d of days) { const o = (await pool.query(Q(OLD), [d])).rows[0], n = (await pool.query(Q(NEW), [d])).rows[0]; tot += o.a + o.b + o.c; if (JSON.stringify(o) !== JSON.stringify(n)) diff.push({ d, o, n }); }
        ok(diff.length === 0 && tot > 0, `오늘·지난 14일 15날 × 3칸 = 종전 식과 숫자 같음(합 ${tot})`, JSON.stringify(diff));
        for (const tz of ['UTC', 'Asia/Seoul']) {
            const c = await pool.connect();
            try { await c.query(`SET TIME ZONE '${tz}'`);
                const r = (await c.query(`SELECT bool_and((${OLD('x')}) = (${NEW('x')})) same, count(*)::int n FROM (VALUES ('2026-11-10 14:59:59+00'::timestamptz), ('2026-11-10 15:00:00+00'), ('2026-11-11 14:59:59+00'), ('2026-11-11 15:00:00+00'), ('2026-11-11 00:00:00+00'), ('2026-11-10 23:59:59+00')) v(x)`, ['2026-11-11'])).rows[0];
                ok(r.same === true && r.n === 6, `경계 시각(KST 자정 앞뒤) 6개 = 두 식 같은 판정 · 세션 시간대 ${tz}`); }
            finally { c.release(); }
        }
        const plan = (await pool.query(`EXPLAIN SELECT count(*) FROM sms_messages WHERE direction = 'in' AND ${NEW('event_at')}`, [days[0]])).rows.map(r => r['QUERY PLAN']).join(' | ');
        console.log('   (참고) 새 식 실행 계획: ' + plan.slice(0, 300));

        console.log('② 대화 열기 = 최근 300통');
        const cfgStore = { sms_gateway: { enabled: true, mode: 'draft', staff_ids: [1] } };
        const deps = { testMode: true, pool, authMiddleware: (req, res, next) => { try { req.user = jwt.verify(String(req.headers.authorization || '').replace('Bearer ', ''), JWT); next(); } catch (e) { res.status(401).json({ error: 'auth' }); } },
            naverCfgGet: async k => cfgStore[k] === undefined ? null : cfgStore[k], naverCfgSet: async (k, v) => { cfgStore[k] = v; }, stateMerge: async () => { }, writeAudit: async () => { }, createNotification: async () => { }, notifyTelegram: async () => { },
            loadShippingHolidayInfo: async () => ({ set: new Set(), arriveOff: new Set(), reasons: new Map() }), qnaGenerate: async () => null, cjTrack: null, deliveryUpsertStatus: null, log: { log() { }, error() { } }, gatewaySend: async () => ({}) };
        const app = express(); app.use(express.json()); const sms = mount(app, deps); await sms.initDB(); await cleanup();
        const srv = app.listen(PORT); const token = jwt.sign({ id: 1, username: 'v', name: '검증', role: 'admin' }, JWT);
        try {
            const th = (await pool.query(`INSERT INTO sms_threads (phone_digits, status) VALUES ($1, 'new') RETURNING id`, [T + '0001'])).rows[0];
            await pool.query(`INSERT INTO sms_messages (thread_id, direction, kind, body, sender, state, event_at, created_at)
                SELECT $1, CASE WHEN g % 2 = 0 THEN 'in' ELSE 'out' END, 'sms', '글 ' || g, CASE WHEN g % 2 = 0 THEN 'customer' ELSE 'staff_desk' END, CASE WHEN g % 2 = 0 THEN 'received' ELSE 'sent' END, now() - (311 - g) * interval '1 minute', now() - (311 - g) * interval '1 minute' FROM generate_series(1, 310) g`, [th.id]);
            const r = await fetch(`http://127.0.0.1:${PORT}/api/sms/threads/${th.id}?peek=1`, { headers: { authorization: 'Bearer ' + token } }); const j = await r.json();
            const b = (j.messages || []).map(m => m.body);
            ok(r.status === 200 && b.length === 300 && b[0] === '글 11' && b[299] === '글 310' && b.every((x, i) => i === 0 || Number(x.slice(2)) === Number(b[i - 1].slice(2)) + 1), '310통 대화 = 최근 300통(글 11~310) · 오래된 → 최신 순', JSON.stringify([r.status, b.length, b[0], b[b.length - 1]]));
            await pool.query(`DELETE FROM sms_messages WHERE thread_id = $1 AND id IN (SELECT id FROM sms_messages WHERE thread_id = $1 ORDER BY id LIMIT 300)`, [th.id]);
            const j2 = await (await fetch(`http://127.0.0.1:${PORT}/api/sms/threads/${th.id}?peek=1`, { headers: { authorization: 'Bearer ' + token } })).json();
            ok((j2.messages || []).map(m => m.body).join(',') === Array.from({ length: 10 }, (_, i) => '글 ' + (301 + i)).join(','), '300통 안 되는 대화 = 전부 · 순서 종전 그대로');
        } finally { srv.close(); }
    } catch (e) { console.error(e); fail++; }
    finally { await cleanup().catch(() => { }); await pool.end(); }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();
