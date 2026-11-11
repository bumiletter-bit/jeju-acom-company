// #1110-5 서버 모듈 검증 — 미리보기 이력(response-head.js · 표 response_preview_log · GET /api/agent-office/response-preview-log)
//   실행: node scripts/verify-1110-5-head.js   (가짜 pool · DB·외부·AI 0)
//   🔴 여기서 못 보는 것 = 실제 SQL 이 실DB 에서 도는지(가짜 pool 은 글자 꼴만 보고 줄을 돌려준다) → 실DB 1회(표 만들기·시험 줄 넣고 지우기)는 총괄에 알리고 따로
const mount = require('../response-head.js');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); } };

function world(o = {}) {
    const W = { cfg: {}, sql: [], routes: {}, now: Date.parse('2026-11-11T03:00:00Z'), tbl: o.noTable ? null : (o.rows || []), seq: 100, created: 0, failInsert: !!o.failInsert, failCreate: !!o.failCreate };
    const pool = { async query(sql, p) {
        W.sql.push(sql);
        if (/SELECT value FROM agent_office_config WHERE key = \$1/.test(sql)) return { rows: p[0] in W.cfg ? [{ value: W.cfg[p[0]] }] : [] };
        if (/INSERT INTO agent_office_config/.test(sql)) { W.cfg[p[0]] = { day: p[1], n: ((W.cfg[p[0]] || {}).n || 0) + 1 }; return { rows: [{ n: W.cfg[p[0]].n }] }; }
        if (/UPDATE agent_office_config/.test(sql)) return { rows: [] };
        if (/SELECT scenario_no, name FROM inquiry_scenarios/.test(sql)) return { rows: [{ scenario_no: '16', name: '사이즈' }].filter(s => p[0].includes(s.name)) };
        if (/CREATE TABLE IF NOT EXISTS response_preview_log /.test(sql)) { if (W.failCreate) throw new Error('create boom'); W.created++; if (!W.tbl) W.tbl = []; return { rows: [] }; }
        if (/CREATE INDEX IF NOT EXISTS response_preview_log_created_idx ON response_preview_log/.test(sql)) return { rows: [] };
        if (/INSERT INTO response_preview_log/.test(sql)) {
            if (W.failInsert) throw new Error('insert boom');
            if (p.length !== 8 || (sql.match(/\$\d+::/g) || []).length !== 8) throw new Error('자리표 수');
            W.tbl.push({ id: ++W.seq, user_id: p[0], user_name: p[1], channel: p[2], question: p[3], answer: p[4], source: p[5], scenario_nos: JSON.parse(p[6]), ms: p[7], created_at: new Date(W.now) }); return { rows: [] };
        }
        if (/DELETE FROM response_preview_log WHERE created_at < NOW\(\) - \(\$1::int \* INTERVAL '1 day'\)/.test(sql)) { W.cleaned = (W.cleaned || 0) + 1; W.keep = p[0]; return { rows: [] }; }
        if (/FROM response_preview_log\s+WHERE \(\$1::bigint IS NULL OR id < \$1::bigint\) AND \(\$2::int IS NULL OR user_id = \$2::int\) AND \(\$3::text IS NULL OR channel = \$3::text\)\s+ORDER BY id DESC LIMIT \$4::int/.test(sql)) {
            if (!W.tbl) { const e = new Error('relation does not exist'); e.code = '42P01'; throw e; }
            if (W.failSelect) throw new Error('select boom');
            W.lastSel = p;
            return { rows: W.tbl.filter(r => (p[0] == null || r.id < Number(p[0])) && (p[1] == null || r.user_id === p[1]) && (p[2] == null || r.channel === p[2])).sort((a, b) => b.id - a.id).slice(0, p[3]) };
        }
        if (/SELECT user_id AS id, max\(user_name\) AS name FROM response_preview_log/.test(sql)) { const m = new Map(); for (const r of W.tbl) if (r.user_id != null) m.set(r.user_id, r.user_name); return { rows: [...m].map(([id, name]) => ({ id, name })) }; }
        throw new Error('가짜 pool 이 모르는 SQL: ' + sql.slice(0, 90));
    } };
    const app = { get(p, ...h) { W.routes['GET ' + p] = h; }, post(p, ...h) { W.routes['POST ' + p] = h; } };
    W.api = mount(app, Object.assign({ pool, authMiddleware: (req, res, next) => next(), now: () => W.now, token: () => 'tok',
        qnaGenerate: async () => W.genThrow ? Promise.reject(new Error('ai')) : (W.genOut === undefined ? { answer: '답 글', used: ['사이즈'] } : W.genOut),
        inquiryGenerate: async () => ({ answer: '고객문의 답', used: [] }),
        fetch: async () => ({ status: 200, ok: true, json: async () => ({ ok: true, skip: false, answer: '톡톡 답', source: 'ai', scenario_nos: ['16'], scenario_names: ['사이즈'] }), text: async () => '' }) }, o.deps || {}));
    W.call = async (key, req) => { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(o2) { this.body = o2; return this; } }; const hs = W.routes[key]; let i = 0; const next = async () => { const h = hs[i++]; if (h) await h(Object.assign({ query: {}, body: {}, user: { id: 6, name: '정지현', role: 'user' } }, req), res, next); }; await next(); await W.api._plogWait(); return res; };
    return W;
}
const P = 'POST /api/agent-office/response-preview', G = 'GET /api/agent-office/response-preview-log';
const errLog = console.error; let errs = []; console.error = (...a) => errs.push(a.join(' '));

(async () => {
    // ── 기록: 답 · 넘김 · 오류 · 누가
    let W = world({ noTable: true });
    let r = await W.call(P, { body: { channel: 'qna', text: '사이즈 지정 되나요?' } });
    ok(r.code === 200 && r.body.answer === '답 글' && W.created === 1 && W.tbl.length === 1, '미리보기 한 번 = 표 만들고 한 줄 기록', { code: r.code, n: W.tbl && W.tbl.length });
    let t = W.tbl[0];
    ok(t.user_id === 6 && t.user_name === '정지현' && t.channel === 'qna' && t.question === '사이즈 지정 되나요?' && t.answer === '답 글' && t.source === 'ai' && JSON.stringify(t.scenario_nos) === '["16"]' && typeof t.ms === 'number', '기록 칸(누가·채널·물음·답·출처·재료 번호·걸린 시간)', t);
    ok(W.cleaned === 1 && W.keep === 90, '하루 첫 기록 때 90일 지난 줄 정리 1번');
    await W.call(P, { body: { channel: 'qna', text: '둘째' }, user: { id: 1, name: '전승범', role: 'admin' } });
    ok(W.created === 1 && W.cleaned === 1 && W.tbl.length === 2 && W.tbl[1].user_name === '전승범', '둘째부터 = 표 만들기·정리 다시 안 함 · 다른 사람 이름으로');
    W.now += 24 * 3600000; await W.call(P, { body: { channel: 'qna', text: '다음 날' } }); ok(W.cleaned === 2, '날이 바뀌면 정리 한 번 더');
    W.genOut = { answer: '' }; await W.call(P, { body: { channel: 'qna', text: '감사합니다' } }); t = W.tbl[W.tbl.length - 1];
    ok(t.source === 'skip' && /봇이 답하지 않고 넘겨요/.test(t.answer) && t.scenario_nos.length === 0, '넘김 = source skip · 답 칸에 까닭 글', t);
    W.genOut = undefined; W.genThrow = true; r = await W.call(P, { body: { channel: 'qna', text: '오류' } }); t = W.tbl[W.tbl.length - 1];
    ok(r.code === 502 && t.source === 'error' && /AI 오류/.test(t.answer) && t.question === '오류', '오류 = source error · 답 칸에 오류 글', t);
    W.genThrow = false; await W.call(P, { body: { channel: 'talk', text: '톡톡' } }); await W.call(P, { body: { channel: 'sms', text: '귤이 다 물러서 왔어요' } });
    ok(W.tbl[W.tbl.length - 2].channel === 'talk' && W.tbl[W.tbl.length - 2].answer === '톡톡 답' && W.tbl[W.tbl.length - 1].channel === 'sms' && W.tbl[W.tbl.length - 1].source === 'sms_rule', '톡톡(봇 경유)·문자(정해 둔 글)도 기록', W.tbl.slice(-2).map(x => x.channel + ':' + x.source));
    const n0 = W.tbl.length;
    r = await W.call(P, { body: { channel: 'qna', text: '' } }); const r2 = await W.call(P, { body: { channel: 'zzz', text: 'x' } }); const r3 = await W.call(P, { body: { channel: 'qna', text: 'x'.repeat(1001) } });
    ok(r.code === 400 && r2.code === 400 && r3.code === 400 && W.tbl.length === n0, '막힌 요청(빈 글·틀린 채널·너무 긴 글) = 기록 안 함');
    // 자름
    const row = W.api._plogRow({ id: 'abc', name: 'ㄱ'.repeat(200) }, 'qna', 'q'.repeat(5000), { status: 200, body: { ok: true, skip: false, answer: 'a'.repeat(9000), source: 's'.repeat(99), scenario_nos: Array.from({ length: 50 }, (_, i) => i) } }, 12.6);
    ok(row[0] === null && row[1].length === 60 && row[3].length === 2000 && row[4].length === 2000 && row[5].length === 30 && JSON.parse(row[6]).length === 20 && row[7] === 13, '글 2,000자·이름 60자·재료 20개로 자름 · 숫자 아닌 id = null', row.map(x => String(x).length));
    // ── 기록 실패가 답을 막지 않음
    errs = []; W = world({ failInsert: true }); r = await W.call(P, { body: { channel: 'qna', text: 'x' } });
    ok(r.code === 200 && r.body.answer === '답 글' && errs.some(e => /미리보기 이력 기록 실패/.test(e)), '기록(INSERT) 실패 = 답은 그대로 · 서버 로그만');
    errs = []; W = world({ noTable: true, failCreate: true }); r = await W.call(P, { body: { channel: 'qna', text: 'x' } });
    ok(r.code === 200 && r.body.answer === '답 글' && W.tbl === null, '표 만들기 실패 = 답은 그대로');
    W.failCreate = false; await W.call(P, { body: { channel: 'qna', text: 'y' } }); ok(W.tbl && W.tbl.length === 1, '표 만들기 실패 뒤 다음 번에 다시 시도해 기록');
    // ── 조회
    W = world({ noTable: true }); r = await W.call(G, {});
    ok(r.code === 200 && r.body.ok && r.body.rows.length === 0 && r.body.more === false && Array.isArray(r.body.users) && r.body.users.length === 0 && W.created === 0, '표가 아직 없으면 빈 목록(조회가 표를 만들지 않음)', r.body);
    const mk = (id, uid, name, ch) => ({ id, user_id: uid, user_name: name, channel: ch, question: 'q' + id, answer: 'a' + id, source: 'ai', scenario_nos: ['16'], ms: 900, created_at: new Date('2026-11-11T01:00:00Z') });
    const rows = []; for (let i = 1; i <= 120; i++) rows.push(mk(i, i % 3 === 0 ? 1 : 6, i % 3 === 0 ? '전승범' : '정지현', i % 2 ? 'talk' : 'sms'));
    W = world({ rows }); r = await W.call(G, {});
    ok(r.body.rows.length === 50 && r.body.rows[0].id === 120 && r.body.rows[49].id === 71 && r.body.more === true && r.body.keep_days === 90, '기본 50줄 · 새 것부터 · 더 있음 표시', { n: r.body.rows.length, more: r.body.more });
    ok(r.body.users.length === 2 && r.body.users.some(u => u.id === 6 && u.name === '정지현') && r.body.rows[0].created_at === '2026-11-11T01:00:00.000Z' && r.body.rows[0].scenario_nos[0] === '16', '사람 목록(거름용) · 시각은 ISO 글자', r.body.users);
    r = await W.call(G, { query: { before: '71', limit: '100' } });
    ok(r.body.rows.length === 70 && r.body.rows[0].id === 70 && r.body.more === false && r.body.users === undefined, '더 보기(before) = 그 앞 줄부터 · 끝이면 more false · 사람 목록은 첫 쪽만');
    r = await W.call(G, { query: { user: '1', channel: 'sms', limit: '500' } });
    ok(r.body.rows.length === 20 && r.body.rows.every(x => x.user_id === 1 && x.channel === 'sms') && W.lastSel[3] === 101, '사람·채널 거름 · limit 상한 100', { n: r.body.rows.length, p: W.lastSel });
    r = await W.call(G, { query: { user: '1; DROP', channel: 'x', before: 'abc', limit: '-5' } });
    ok(r.code === 200 && W.lastSel[0] === null && W.lastSel[1] === null && W.lastSel[2] === null && W.lastSel[3] === 2, '이상한 값(거름·before·limit) = 무시하고 기본', W.lastSel);
    r = await W.call(G, { user: { id: 9, name: '세무사', role: 'accountant' } });
    ok(r.code === 403, '세무사 계정 = 403');
    r = await W.call(G, { user: { id: 8, name: '직원', role: 'user' } }); ok(r.code === 200 && r.body.rows.length === 50, '일반 직원 = 전부 열람(남이 물은 것도)');
    errs = []; W.failSelect = true; r = await W.call(G, {}); ok(r.code === 500 && r.body.ok === false, '조회 오류(표 없음 말고) = 500 안내');
    // ── 장착
    W = world();
    ok(Object.keys(W.routes).join('|') === 'GET /api/agent-office/response-stats|POST /api/agent-office/response-preview|GET /api/agent-office/response-preview-log', '주소 3개', Object.keys(W.routes));
    ok(W.sql.length === 0 && W.api.tables.plog === 'response_preview_log', '장착만으로는 SQL 0(표는 첫 기록 때)');
    let threw = false; try { world({ deps: { tables: { plog: 'x; DROP' } } }); } catch (e) { threw = true; } ok(threw, '이상한 표 이름은 장착 때 멈춤');
    W = world({ noTable: true, deps: { tables: { plog: 'zz_test_plog' } } }); errs = []; await W.call(P, { body: { channel: 'qna', text: 'x' } });
    ok(W.sql.some(s => /CREATE TABLE IF NOT EXISTS zz_test_plog /.test(s)) && !W.sql.some(s => /response_preview_log/.test(s)), '시험용 표 이름을 주면 운영 표 이름은 한 번도 안 씀');

    console.error = errLog;
    console.log(`#1110-5 서버 모듈 검증: 통과 ${pass} · 실패 ${fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error = errLog; console.error('검증 오류:', e); process.exit(1); });
