// #813 검증 — 창구 대기 프로그램(scripts/desk/launcher.js)의 ③ 로그인 만료 표시 · ④ 같은 지시 묶기
//   ①~③ = 가짜 pool(메모리) — 실DB 쓰기 0 · claude 실행 0 · ④ = 같은 지시 판정 SQL 을 실DB 에 SELECT 로만 돌려 지난 지시에서 무엇이 묶였을지 본다
//   node scripts/verify-813-desk.js
'use strict';
process.env.DESK_LOG = require('path').join(require('os').tmpdir(), 'verify-813-launcher.log');   // 실제 ~/.akkome/launcher.log 에 흔적을 남기지 않게(require 하면 종료 로그가 찍힘)
const L = require('./desk/launcher.js');
const { pool: realPool } = require('./desk/_db.js');
const T = L._t813;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };
function fakeCfgPool() {
    const cfg = new Map(), audits = [];
    return { cfg, audits, query: async (s, v = []) => {
        if (/^SELECT value FROM agent_office_config WHERE key = \$1/.test(s)) return { rows: cfg.has(v[0]) ? [{ value: cfg.get(v[0]) }] : [] };
        if (/SELECT value FROM agent_office_config WHERE key = 'owner_todo'/.test(s)) return { rows: cfg.has('owner_todo') ? [{ value: cfg.get('owner_todo') }] : [] };
        if (/INSERT INTO agent_office_config\(key, value\) VALUES\('owner_todo'/.test(s)) { cfg.set('owner_todo', JSON.parse(v[0])); return { rows: [] }; }
        if (/INSERT INTO agent_office_config \(key, value\) VALUES \(\$1, \$2::jsonb\)/.test(s)) { cfg.set(v[0], JSON.parse(v[1])); return { rows: [] }; }
        if (/INSERT INTO audit_logs/.test(s)) { audits.push(v); return { rows: [] }; }
        throw new Error('가짜 pool 이 모르는 SQL: ' + s.slice(0, 80));
    } };
}
(async () => {
    const logs = []; const log = m => logs.push(m);
    console.log('① 로그인 만료 표시');
    const P = fakeCfgPool(); P.cfg.set('owner_todo', { items: [{ n: 26, text: '다른 할 일', at: '2026-10-20' }] });
    let now = Date.parse('2026-10-21T00:48:00Z');
    T.st.loginOpen = undefined;
    const a1 = await T.loginExpiredNote('#2980', { pool: P, log, now: () => now });
    const flag1 = P.cfg.get(T.LOGIN_FLAG), todo1 = P.cfg.get('owner_todo').items;
    ok(a1.flagged && flag1 && flag1.done === false && flag1.notified === false, '만료 보면 설정 desk_login_expired {done:false, notified:false}');
    ok(todo1.length === 2 && todo1[1].n === 27 && todo1[1].text === T.LOGIN_TODO_TEXT && !todo1[1].done, '대표 할 일 27번 한 줄 추가(기존 26 그대로)');
    ok(P.audits.length === 1 && P.audits[0][0] === 'create', 'owner_todo 추가 audit 1줄');
    now += 10 * 60000;
    const a2 = await T.loginExpiredNote('#2981', { pool: P, log, now: () => now });
    ok(a2.skipped === 'cool' && P.cfg.get('owner_todo').items.length === 2, '6시간 안 재발 = 건너뜀(텔레그램·할 일 1번만)');
    console.log('② /login 뒤 내림');
    const r1 = await T.loginRecovered({ pool: P, log, now: () => now + 7 * 3600000 });
    const flag2 = P.cfg.get(T.LOGIN_FLAG), it27 = P.cfg.get('owner_todo').items.find(x => x.n === 27);
    ok(r1.cleared && flag2.done === true && it27.done === true, '대표 요금제 다시 성공 → 설정 done · 할 일 27 done');
    ok(P.cfg.get('owner_todo').items.find(x => x.n === 26).done !== true, '다른 할 일(26)은 그대로');
    const r2 = await T.loginRecovered({ pool: P, log, now: () => now });
    ok(r2.skipped === 'closed', '이미 내렸으면 다시 DB 를 안 봄(성공할 때마다 조회 0)');
    const r3 = await T.loginRecovered({ pool: P, log, now: () => now, force: true });
    ok(r3.skipped === 'none', '내린 표시는 다시 안 내림');
    now += 7 * 3600000;
    const a3 = await T.loginExpiredNote('#3001', { pool: P, log, now: () => now });
    ok(a3.flagged && P.cfg.get('owner_todo').items.filter(x => x.text === T.LOGIN_TODO_TEXT && !x.done).length === 1, '내린 뒤 다시 만료 = 새로 표시(열린 할 일 1개만)');
    const a4 = await T.loginExpiredNote('#3002', { pool: P, log, now: () => now + 7 * 3600000 });
    ok(a4.flagged && P.cfg.get('owner_todo').items.filter(x => x.text === T.LOGIN_TODO_TEXT && !x.done).length === 1, '6시간 넘어 다시 표시해도 열린 같은 할 일은 하나(중복 방지)');

    console.log('③ 같은 지시 묶기(판정 · 가짜 pool)');
    const mk = (parent) => { const up = []; return { up, query: async (s, v) => {
        if (/FROM pending_orders a JOIN pending_orders b/.test(s)) return { rows: parent ? [parent] : [] };
        if (/^UPDATE pending_orders SET status = \$2/.test(s)) { up.push({ id: v[0], status: v[1], result: JSON.parse(v[2]) }); return { rows: [{ id: v[0] }] }; }
        throw new Error('모르는 SQL ' + s.slice(0, 60));
    } }; };
    const aud = []; const audit = async (a, id, c) => { aud.push([a, id, c]); };
    T.dupGo.clear();
    const o = id => ({ id, created_by_id: 7 });
    let p = mk(null); ok(await T.dupDecide(o(100), { pool: p, log, audit }) === 'go' && T.dupGo.has(100), '같은 앞 지시 없음 → 그대로 처리(기억)');
    p = mk({ id: 101, status: '처리중' }); ok(await T.dupDecide(o(102), { pool: p, log, audit }) === 'wait' && !p.up.length, '앞 지시가 처리 중 → 안 집고 기다림');
    p = mk({ id: 101, status: '대기' }); ok(await T.dupDecide(o(102), { pool: p, log, audit }) === 'wait', '앞 지시가 대기 → 기다림');
    p = mk({ id: 101, status: '질문' }); let d = await T.dupDecide(o(102), { pool: p, log, audit });
    ok(d === 'resolved' && p.up[0].status === '질문종결' && /앞 지시\(#101\)에서 같은 내용을 묻고 있어요/.test(p.up[0].result.question) && p.up[0].result.dup_of === 101, '앞 지시 질문 → 둘째 질문종결 + 「앞 지시(#101)에서 같은 내용을 묻고 있어요」');
    p = mk({ id: 103, status: '완료' }); d = await T.dupDecide(o(104), { pool: p, log, audit });
    ok(d === 'resolved' && p.up[0].status === '완료' && p.up[0].result.type === 'desk_answer' && /#103/.test(p.up[0].result.answer), '앞 지시 완료 → 둘째 완료(「앞 지시 #103 결과」)');
    p = mk({ id: 105, status: '판독완료' }); d = await T.dupDecide(o(106), { pool: p, log, audit });
    ok(d === 'resolved' && p.up[0].status === '안내' && p.up[0].result.type === 'route', '정산 판독완료 → 둘째 안내(두 번 저장 막기)');
    p = mk({ id: 107, status: '완료', dup_of: '99' }); d = await T.dupDecide(o(108), { pool: p, log, audit });
    ok(d === 'resolved' && p.up[0].result.dup_of === 99 && /#99/.test(p.up[0].result.answer), '셋째가 와도 첫 지시(#99)를 가리킴');
    for (const s of ['오류', '취소', '반려', '질문종결']) { T.dupGo.delete(110); p = mk({ id: 109, status: s }); ok(await T.dupDecide(o(110), { pool: p, log, audit }) === 'go' && !p.up.length, `앞 지시 ${s} → 묶지 않고 그대로 처리`); }
    p = mk({ id: 111, status: '질문' }); const raceP = { query: async (s, v) => /^UPDATE/.test(s) ? { rows: [] } : p.query(s, v) };
    T.dupGo.delete(112); ok(await T.dupDecide(o(112), { pool: raceP, log, audit }) === 'wait', '둘째가 그 사이 집혔으면(UPDATE 0줄) 손대지 않음');
    ok(await T.dupDecide({ id: 113, created_by_id: null }, { pool: mk({ id: 1, status: '질문' }), log, audit }) === 'go', '만든 사람 없는 지시는 묶지 않음');
    ok(aud.filter(x => x[0] === 'desk_dup').length === 4, '닫은 둘째마다 audit desk_dup 1줄');

    console.log('④ 판정 SQL 실DB(SELECT 만) — 10/08 뒤 지시마다 앞 같은 지시 찾기');
    const ids = (await realPool.query(`SELECT id, created_by_id FROM pending_orders WHERE created_at >= '2026-10-07 15:00' AND is_deleted = false AND COALESCE(created_by_id,0) < 990000 ORDER BY id`)).rows;
    const pairs = [];
    for (const x of ids) { const a = await T.dupParent(x, realPool); if (a) pairs.push([a.id, x.id, a.status]); }
    const det = pairs.length ? (await realPool.query(`SELECT id, to_char(created_at + interval '9 hour', 'MM-DD HH24:MI:SS') t, created_by, left(regexp_replace(content, '\\s+', ' ', 'g'), 30) c, (image_data IS NOT NULL) img FROM pending_orders WHERE id = ANY($1::int[]) ORDER BY id`, [pairs.flat().filter(Number.isInteger)])).rows : [];
    const byId = Object.fromEntries(det.map(r => [r.id, r]));
    for (const [a, b, s] of pairs) console.log(`    #${a}(${s}) ← #${b} · ${byId[b] && byId[b].t} · ${byId[b] && byId[b].created_by} · 그림 ${byId[b] && byId[b].img} · 「${byId[b] && byId[b].c}」`);
    ok(ids.length > 100, `실DB 지시 ${ids.length}건 판정 SQL 실행(오류 0)`);
    const bad = pairs.filter(([a, b]) => byId[a] && byId[b] && byId[a].c.replace(/\s/g, '') !== byId[b].c.replace(/\s/g, ''));
    ok(bad.length === 0, '묶일 짝은 전부 글이 같음(다른 글 묶임 0)');
    ok(!pairs.some(([a, b]) => b === 2834), '#2834 「[최종발주 메모 읽기]」(화면이 만든 지시 · payload) = 안 묶음');
    const s2961 = await T.dupParent({ id: 2962, created_by_id: 7 }, realPool);
    ok(!s2961, '#2961 효돈 / #2962 대성(같은 글 · 다른 그림) = 안 묶음');

    console.log(`\n결과 ${pass}/${pass + fail}`);
    await realPool.end(); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error(e); try { await realPool.end(); } catch (_) { } process.exit(1); });
