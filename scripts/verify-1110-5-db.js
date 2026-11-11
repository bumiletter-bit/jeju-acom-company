// #1110-5 실DB 1회 확인 — 미리보기 이력 SQL 이 실제 DB 에서 도는지(가짜 pool 검증이 못 보는 부분)
//   🔴 실DB 쓰기: 표 response_preview_log 만들기(없을 때만 · 배포 뒤 서버가 첫 기록 때 만드는 것과 같은 문장) + 시험 줄 2개 넣고 지움 + 시험용 상한 셈 칸 1개 넣고 지움
//      → 돌리기 전에 총괄에 알릴 것(실DB 검증은 한 번에 하나) · AI·외부 호출 0(답 만드는 길은 가짜)
//   실행: node scripts/verify-1110-5-db.js --run      (.env 의 DATABASE_URL)
const path = require('path'); const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });
const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
if (!process.argv.includes('--run')) { console.log('실DB 에 표를 만들고 시험 줄을 넣었다 지웁니다. 총괄에 알린 뒤 --run 을 붙여 실행하세요.'); process.exit(0); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 이 없어요(.env)'); process.exit(1); }
const mount = require(path.join(ROOT, 'response-head.js'));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); } };
const MARK = '[검증1110-5] ', STATE = 'response_preview_state_verify1110_5', UID = 990000 + 11105;

(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }, max: 1, application_name: 'verify-1110-5-db' });
    const routes = {}; const app = { get(p, ...h) { routes['GET ' + p] = h; }, post(p, ...h) { routes['POST ' + p] = h; } };
    const api = mount(app, { pool, authMiddleware: (req, res, next) => next(), stateKey: STATE, token: () => '',
        qnaGenerate: async () => ({ answer: '시험 답 첫 줄\n둘째 줄', used: [] }), inquiryGenerate: async () => ({ answer: '' }) });
    const call = async (key, req) => { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } }; const hs = routes[key]; let i = 0; const next = async () => { const h = hs[i++]; if (h) await h(Object.assign({ query: {}, body: {}, user: { id: UID, name: '검증1110-5', role: 'user' } }, req), res, next); }; await next(); await api._plogWait(); return res; };
    try {
        const had = (await pool.query(`SELECT to_regclass('public.response_preview_log') IS NOT NULL AS y`)).rows[0].y;
        const n0 = had ? (await pool.query('SELECT count(*)::int AS n FROM response_preview_log')).rows[0].n : 0;
        console.log('시작: 표 ' + (had ? '있음 · ' + n0 + '줄' : '없음(이번에 만듦)'));
        let r = await call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: MARK + '사이즈 지정 되나요?' } });
        ok(r.code === 200 && r.body.ok && /시험 답/.test(r.body.answer || ''), '미리보기 응답(가짜 답)', r.body);
        r = await call('POST /api/agent-office/response-preview', { body: { channel: 'inquiry', text: MARK + '넘김 꼴' } });
        ok(r.code === 200 && r.body.skip === true, '넘김 응답', r.body);
        const cols = (await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'response_preview_log' ORDER BY ordinal_position`)).rows.map(x => x.column_name + ':' + x.data_type).join(' ');
        ok(/^id:bigint user_id:integer user_name:text channel:text question:text answer:text source:text scenario_nos:jsonb ms:integer created_at:timestamp with time zone$/.test(cols), '표 칸 10개', cols);
        ok((await pool.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'response_preview_log' AND indexname = 'response_preview_log_created_idx'`)).rows[0].n === 1, 'created_at 색인');
        r = await call('GET /api/agent-office/response-preview-log', { query: { user: String(UID) } });
        ok(r.code === 200 && r.body.rows.length === 2 && r.body.rows[0].source === 'skip' && r.body.rows[1].source === 'ai' && r.body.rows[1].answer === '시험 답 첫 줄\n둘째 줄' && r.body.rows[1].user_name === '검증1110-5' && Array.isArray(r.body.rows[1].scenario_nos) && /^\d{4}-\d\d-\d\dT/.test(r.body.rows[0].created_at) && r.body.users.some(u => u.id === UID), '조회(사람 거름) = 방금 2줄 · 새 것부터 · 칸 꼴', r.body.rows);
        ok(Math.abs(Date.now() - Date.parse(r.body.rows[0].created_at)) < 120000, '시각 = 지금(시간대 어긋남 0)', r.body.rows[0].created_at);
        const top = r.body.rows[0].id;
        r = await call('GET /api/agent-office/response-preview-log', { query: { user: String(UID), channel: 'qna', before: String(top), limit: '1' } });
        ok(r.code === 200 && r.body.rows.length === 1 && r.body.rows[0].channel === 'qna' && r.body.more === false && r.body.users === undefined, '조회(채널·before·limit)', r.body);
        r = await call('GET /api/agent-office/response-preview-log', {});
        ok(r.code === 200 && r.body.rows.length >= 2 && r.body.rows.length <= 50, '조회(거름 없음)', r.body.rows.length);
        const del = await pool.query(`DELETE FROM response_preview_log WHERE user_id = $1::int AND question LIKE $2::text`, [UID, MARK + '%']);
        ok(del.rowCount === 2, '시험 줄 2개 지움', del.rowCount);
        await pool.query(`DELETE FROM agent_office_config WHERE key = $1::text`, [STATE]);
        const n1 = (await pool.query('SELECT count(*)::int AS n FROM response_preview_log')).rows[0].n;
        const left = (await pool.query(`SELECT count(*)::int AS n FROM agent_office_config WHERE key = $1::text`, [STATE])).rows[0].n;
        ok(n1 === n0 && left === 0, '끝: 줄 수 처음과 같음 · 시험 상한 칸 없음', { n0, n1, left });
        console.log('끝: 표 response_preview_log ' + n1 + '줄(시험 줄 0 · 표는 남김 = 배포 뒤 서버가 그대로 씀)');
    } catch (e) { fail++; console.error('검증 오류:', e && e.message); try { await pool.query(`DELETE FROM response_preview_log WHERE user_id = $1::int`, [UID]); await pool.query(`DELETE FROM agent_office_config WHERE key = $1::text`, [STATE]); } catch (_) { /* 정리 실패는 위 오류와 함께 보고 */ } }
    finally { await pool.end(); }
    console.log(`#1110-5 실DB 확인: 통과 ${pass} · 실패 ${fail}`);
    process.exit(fail ? 1 : 0);
})();
