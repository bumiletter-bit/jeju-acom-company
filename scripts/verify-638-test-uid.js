// #638 검증: 시험 번호 계정(created_by_id ≥ 990000)으로 들어온 지시는 실제 사용자의 목록·이력·상태 카드·실행 기록·「응/아니오」 짝짓기에 끼지 않는다
//   로컬 서버(포트 PORT638 · 없으면 3466 · 스케줄러 막음 · 실DB) — 브라우저 없음(HTTP + DB 읽기).
//   실DB 쓰기 = 시험 번호(990638) 이름의 시험 지시 3건 + 그 실행 기록 1줄뿐(끝에 지시는 취소·숨김 · 실행 기록 줄도 숨김 — 지우지 않음). 정산·발송 쓰기 0.
//   서버 파일을 바꿔 돌릴 때: SERVER638=./다른파일.js node scripts/verify-638-test-uid.js
//   실행: node scripts/verify-638-test-uid.js
require('dotenv').config();
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'); const jwt = require('jsonwebtoken'); const { Client } = require('pg');
const PORT = Number(process.env.PORT638 || 3466), ROOT = path.join(__dirname, '..'), SECRET = 'verifytest', BASE = 'http://localhost:' + PORT;
const SERVER = process.env.SERVER638 || './server.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + d : '')); };
const T = { id: 990638, name: '시험638', position: '사원', role: 'user' };          // 시험 번호 직원
const TB = { id: 990639, name: '시험638대표', position: '대표', role: 'admin' };   // 시험 번호 대표(전체 지시를 보는 자리)
const ACTIVE = "('대기','처리중','판독완료','확인표작성','질문','승인대기','승인됨')";

(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require(${JSON.stringify(SERVER)});`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const made = []; let runId = null;
    try {
        let up = false; for (let i = 0; i < 90; i++) { await sleep(1000); try { const r = await fetch(BASE + '/track-order'); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('로컬 서버가 안 떴어요');
        await db.connect();
        const SRC = fs.readFileSync(path.join(ROOT, SERVER), 'utf8');
        const maxUser = (await db.query(`SELECT COALESCE(MAX(id), 0)::int m FROM users`)).rows[0].m;
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND role='admin' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const stf = (await db.query(`SELECT id, name, position FROM users WHERE role <> 'admin' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        const tok = u => jwt.sign(u, SECRET, { expiresIn: '20m' });
        const tokCeo = tok({ id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }), tokStf = tok({ id: stf.id, name: stf.name, position: stf.position || '', role: 'user' }), tokT = tok(T), tokTB = tok(TB);
        const get = async (t, url) => { const r = await fetch(BASE + url, { headers: { Authorization: 'Bearer ' + t, Connection: 'close' } }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, j }; };

        console.log('① 규칙 한 곳 · 실제 계정 번호');
        const m = SRC.match(/const DESK_TEST_UID_MIN = (\d+);/);
        ok(!!m && Number(m[1]) === 990000 && /const deskIsTestUid = /.test(SRC) && /const deskNoTestSql = /.test(SRC) && /const deskRunNoTestSql = /.test(SRC) && /const deskSameSideSql = /.test(SRC), '상수 DESK_TEST_UID_MIN = 990000 + 도우미 4개가 한 곳에');
        ok(maxUser < 990000 && maxUser > 0, '실제 계정 번호는 전부 990000 미만(최대 ' + maxUser + ')');
        ok((SRC.match(/COALESCE\([a-z.]*created_by_id, 0\) (<|>=) 9900/g) || []).length === 0, '서버 SQL 에 990000 숫자를 직접 적은 곳 0(전부 도우미로)');

        // 시험 지시 3건: 끝난 것(실행 기록 붙음) · 처리중 · 정산 확인표(질문)
        await db.query(`UPDATE pending_orders SET status = CASE WHEN status IN ${ACTIVE} THEN '취소' ELSE status END, is_deleted = true, mine_hidden = true, hist_hidden = true WHERE created_by_id IN ($1, $2) AND is_deleted = false`, [T.id, TB.id]);   // 앞선 실행이 끊겨 남은 것
        const agent = (await db.query(`SELECT id FROM agents WHERE role = 'chief' AND is_deleted = false LIMIT 1`)).rows[0] || (await db.query(`SELECT id FROM agents ORDER BY id LIMIT 1`)).rows[0];
        runId = (await db.query(`INSERT INTO agent_runs (agent_id, status, steps, result, finished_at, is_test) VALUES ($1, 'done', '[]', $2, NOW(), FALSE) RETURNING id`, [agent.id, JSON.stringify({ summary: '[시험638] 실행 기록' })])).rows[0].id;
        const mk = async (content, status, result, extra) => { const r = await db.query(`INSERT INTO pending_orders (content, status, result, created_by, created_by_id, run_id, processed_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, ['[시험638] ' + content, status, result ? JSON.stringify(result) : null, T.name, T.id, (extra && extra.run) || null, status === '완료' ? new Date() : null]); made.push(r.rows[0].id); return r.rows[0].id; };
        const O1 = await mk('끝난 지시', '완료', { type: 'desk_answer', answer: '[시험638] 답' }, { run: runId });
        const O2 = await mk('처리중 지시', '처리중', { type: 'live', text: '쓰는 중' });
        const O3 = await mk('정산 확인표', '질문', { type: 'settlement_ocr_confirm', order_id: 0, partner: '시험638거래처', date: '2031-01-06', box_total: 1, total: 1000, rows: [] });
        const has = (j, id) => !!(j && Array.isArray(j.orders) && j.orders.some(o => o.id === id));
        const any = j => [O1, O2, O3].some(id => has(j, id)), all = j => [O1, O2, O3].every(id => has(j, id));

        console.log('② 지시 목록 · 이전 채팅 이력 · 대표 확인함(GET /api/agent-office/desk/orders)');
        let r = await get(tokCeo, '/api/agent-office/desk/orders?limit=200');
        ok(r.status === 200 && Array.isArray(r.j.orders) && !any(r.j), '실제 대표 「전체 지시」에 시험 번호 지시 0');
        r = await get(tokCeo, '/api/agent-office/desk/orders?history=1&limit=200&q=' + encodeURIComponent('시험638'));
        ok(r.status === 200 && Array.isArray(r.j.orders) && r.j.orders.length === 0, '실제 대표 「이전 채팅 이력」 검색(시험638) = 0줄', String(r.j && r.j.orders && r.j.orders.length));
        r = await get(tokCeo, '/api/agent-office/desk/orders?limit=200&status=' + encodeURIComponent('질문'));
        ok(r.status === 200 && !has(r.j, O3), '실제 대표 상태 고르개(질문)에 시험 확인표 없음');
        r = await get(tokStf, '/api/agent-office/desk/orders?limit=200');
        ok(r.status === 200 && !any(r.j), '실제 직원 목록에 시험 번호 지시 0');
        r = await get(tokT, '/api/agent-office/desk/orders?mine=1&limit=200');
        ok(r.status === 200 && all(r.j), '시험 번호 본인 「내 지시」에는 3건 다 보임(검증이 자기 것을 볼 수 있어야 함)');
        r = await get(tokTB, '/api/agent-office/desk/orders?limit=200');
        ok(r.status === 200 && all(r.j), '시험 번호 대표 「전체 지시」에는 보임(시험끼리는 보임)');
        r = await get(tokTB, '/api/agent-office/desk/orders?history=1&limit=200&q=' + encodeURIComponent('시험638'));
        ok(r.status === 200 && has(r.j, O1), '시험 번호 대표 「이전 채팅 이력」에는 보임');

        console.log('③ 상태 카드(GET /api/agent-office/desk-status)');
        const realOthers = async id => (await db.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE is_deleted=false AND created_by_id IS DISTINCT FROM $1 AND COALESCE(created_by_id,0) < 990000 AND status IN ('처리중','판독완료','확인표작성')`, [id])).rows[0].c;
        r = await get(tokStf, '/api/agent-office/desk-status');
        ok(r.status === 200 && r.j.others_busy === ((await realOthers(stf.id)) > 0) && !/시험638/.test(JSON.stringify(r.j)), '실제 직원: 시험 지시가 처리중이어도 others_busy 는 실제 지시만으로 셈', JSON.stringify({ ob: r.j && r.j.others_busy }));
        r = await get(tokCeo, '/api/agent-office/desk-status');
        ok(r.status === 200 && r.j.others_busy === ((await realOthers(ceo.id)) > 0) && !(r.j.working_list || []).some(w => w.id === O2), '실제 대표: 같은 기준 · 처리 중 목록에 시험 지시 없음');
        r = await get(tokTB, '/api/agent-office/desk-status');
        ok(r.status === 200 && r.j.others_busy === true, '시험 번호 대표: 시험 번호 직원의 처리중이 others_busy 로 보임(시험끼리는 종전 동작)');
        r = await get(tokT, '/api/agent-office/desk-status');
        ok(r.status === 200 && r.j.working >= 1, '시험 번호 본인: 자기 처리 중 건수 ≥ 1', String(r.j && r.j.working));

        console.log('④ 옛 화면 경로 · 실행 기록 · 요원 화면');
        r = await get(tokCeo, '/api/agent-office/orders?include_hidden=true&limit=200');
        ok(r.status === 200 && Array.isArray(r.j.orders) && !any(r.j), '옛 목록 경로(GET /orders): 실제 대표에게 시험 지시 0');
        r = await get(tokTB, '/api/agent-office/orders?include_hidden=true&limit=200');
        ok(r.status === 200 && has(r.j, O1), '옛 목록 경로: 시험 번호 대표에게는 보임');
        r = await get(tokCeo, '/api/agent-office/runs?limit=300');
        ok(r.status === 200 && Array.isArray(r.j.runs) && !r.j.runs.some(x => x.id === runId), '실행 기록 목록(GET /runs): 실제 대표에게 시험 실행 기록 없음');
        r = await get(tokTB, '/api/agent-office/runs?limit=300');
        ok(r.status === 200 && r.j.runs.some(x => x.id === runId), '실행 기록 목록: 시험 번호 대표에게는 보임');
        r = await get(tokCeo, '/api/agent-office/agents');
        const ags = r.j && (r.j.agents || r.j);
        ok(r.status === 200 && Array.isArray(ags) && !ags.some(a => a.last_run && a.last_run.id === runId), '요원 목록(GET /agents)의 「마지막 실행」이 시험 실행 기록이 아님');
        r = await get(tokCeo, '/api/agent-office/agents/' + agent.id);
        ok(r.status === 200 && !JSON.stringify(r.j).includes('[시험638] 실행 기록'), '요원 상세(GET /agents/:id) 최근 실행에 시험 실행 기록 없음');

        console.log('⑤ 「응/아니오」 짝짓기 — 서버가 실제로 쓰는 SQL 을 떼어 SELECT 만 실행(실정산 쓰기 0)');
        {
            const fnSame = new Function('DESK_TEST_UID_MIN', 'deskIsTestUid', 'return (' + SRC.match(/const deskSameSideSql = (\(alias, viewerId\) => `[^`]*`);/)[1] + ');')(990000, id => Number(id) >= 990000);
            const body = SRC.slice(SRC.indexOf('async function maruTrySettlementOcrConfirm('));
            const tpl = body.match(/`(SELECT \* FROM pending_orders WHERE status='질문' AND is_deleted=false\s+AND result->>'type' = 'settlement_ocr_confirm'[^`]*)`/)[1];
            ok(/\$\{deskSameSideSql\('', order\.created_by_id\)\}/.test(tpl), '확인표 고르기 SQL 에 「같은 편」 조건이 들어 있음');
            const pick = async viewerId => (await db.query(tpl.replace(/\$\{deskSameSideSql\('', order\.created_by_id\)\}/, fnSame('', viewerId)), [0])).rows[0];
            const pReal = await pick(ceo.id), pNull = await pick(null), pTest = await pick(T.id);
            ok(!pReal || (pReal.id !== O3 && Number(pReal.created_by_id || 0) < 990000), '실제 대표가 「응」을 보내도 시험 확인표를 집지 않음(집을 대상 = ' + (pReal ? '#' + pReal.id + ' 실제 것' : '없음') + ')');
            ok(!pNull || pNull.id !== O3, '만든 사람 번호가 없는 지시(옛 것)도 시험 확인표를 집지 않음');
            ok(!!pTest && pTest.id === O3, '시험 번호가 「아니오」를 보내면 시험 확인표만 집음(실제 확인표를 건드리지 않음)', pTest && String(pTest.id));
            const st0 = (await db.query(`SELECT COUNT(*)::int c FROM settlements WHERE partner = '시험638거래처'`)).rows[0].c;
            const post = await fetch(BASE + '/api/agent-office/orders', { method: 'POST', headers: { Authorization: 'Bearer ' + tokT, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ content: '아니오' }) }).then(async x => ({ status: x.status, j: await x.json().catch(() => null) }));
            if (post.j && post.j.order) made.push(post.j.order.id);
            const o3 = (await db.query(`SELECT status FROM pending_orders WHERE id = $1`, [O3])).rows[0];
            const madeBy = post.j && post.j.order ? (await db.query(`SELECT created_by_id FROM pending_orders WHERE id = $1`, [post.j.order.id])).rows[0].created_by_id : null;
            ok(post.status === 200 && o3.status === '취소' && madeBy === T.id && (await db.query(`SELECT COUNT(*)::int c FROM settlements WHERE partner = '시험638거래처'`)).rows[0].c === st0, '실제 라우트: 시험 번호의 「아니오」 → 시험 확인표 취소 · 정산 저장 0', post.status + ' ' + o3.status);
        }

        console.log('⑥ HTTP 로 못 부르는 자리(대표 폰 관찰 도구 · 알림 · 창구 집기) — 코드에 거름이 들어 있는지');
        ok(/FROM pending_orders WHERE TRUE\$\{deskNoTestSql\('', null\)\} ORDER BY id DESC LIMIT \$1/.test(SRC), 'get_live_log(대표 폰 관찰 도구) = 시험 번호 지시 제외');
        ok((SRC.match(/COALESCE\(r\.is_test, false\) = false\$\{deskRunNoTestSql\('r', null\)\}/g) || []).length === 2, 'get_reports(목록·한 건) = 시험 실행 기록 제외');
        ok(/if \(o\.created_by_id && !deskIsTestUid\(o\.created_by_id\)\) await createNotification\(o\.created_by_id, 'desk', '📋 정산 확인표가 준비됐어요'/.test(SRC), '정산 확인표 알림 = 시험 번호에게는 만들지 않음');
        ok((SRC.match(/is_deleted = false\$\{deskNoTestSql\('', null\)\}/g) || []).length === 2, '주간 집계(misroute-stats) 두 셈 = 시험 번호 지시 제외');
        ok((SRC.match(/status = 'running' AND is_deleted = false\$\{deskRunNoTestSql\('', null\)\} LIMIT 1/g) || []).length === 2, '「그 요원이 실행 중인가」 두 곳 = 시험 실행은 안 셈');
        ok((SRC.match(/\$\{deskSameSideSql\((''|'o'), order\.created_by_id\)\}/g) || []).length === 7, '「같은 편만」 조건 7곳(확인표 응/아니오 · 거래처 답 · 옛 길 응 · 되묻기 답 · 열린 답변 · 대체됨 2)', String((SRC.match(/\$\{deskSameSideSql\((''|'o'), order\.created_by_id\)\}/g) || []).length));
        const rd = n => fs.readFileSync(path.join(ROOT, 'scripts', 'desk', n), 'utf8');
        ok(/COALESCE\(o\.created_by_id, 0\) < 990000/.test(rd('launcher.js')) && /COALESCE\(created_by_id, 0\) < 990000/.test(rd('watch.js')), '대기 프로그램·감시가 스스로 집는 길 = 시험 번호 지시 제외');
        ok(/WHERE o\.id = \$1 AND o\.is_deleted = false AND o\.status IN \('대기', '승인됨'\)`, \[onlyId\]\)/.test(rd('launcher.js')), '번호를 집어 주는 길(--ids · 503 검증이 씀)은 그대로');
        ok(/startsWith\('\[검증469\]'\) \|\| Number\(o\.created_by_id\) >= 990000/.test(rd('respond.js')), '창구 답변 알림 = 시험 번호 지시면 생략(승인 요청이 실제 관리자에게 안 감)');

        console.log('⑦ 실행 도중 실제 계정 이름의 시험 지시 0');
        ok((await db.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE id = ANY($1::int[]) AND created_by_id IN (SELECT id FROM users)`, [made])).rows[0].c === 0, '이 검증이 만든 지시 ' + made.length + '건 전부 시험 번호 이름');
    } catch (e) { fail++; console.log('  ✗ 중단: ' + (e && e.stack || e)); }
    finally {
        try {
            if (made.length) await db.query(`UPDATE pending_orders SET status = CASE WHEN status IN ${ACTIVE} THEN '취소' ELSE status END, is_deleted = true, mine_hidden = true, hist_hidden = true WHERE id = ANY($1::int[])`, [made]);   // run_id 는 그대로 — 실행 기록 거름이 이 줄(만든 사람 = 시험 번호)로 이어지기 때문
            await db.query(`UPDATE pending_orders SET status = CASE WHEN status IN ${ACTIVE} THEN '취소' ELSE status END, is_deleted = true, mine_hidden = true, hist_hidden = true WHERE created_by_id IN ($1, $2) AND is_deleted = false`, [T.id, TB.id]);
            if (runId) await db.query(`UPDATE agent_runs SET is_deleted = true WHERE id = $1 AND result->>'summary' = '[시험638] 실행 기록'`, [runId]);   // 물리 삭제 금지 — 숨김만(이 검증이 방금 넣은 시험 줄)
            const left = (await db.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE created_by_id IN ($1, $2) AND (is_deleted = false OR status IN ${ACTIVE})`, [T.id, TB.id])).rows[0].c;
            const leftRun = runId ? (await db.query(`SELECT COUNT(*)::int c FROM agent_runs WHERE id = $1 AND is_deleted = false`, [runId])).rows[0].c : 0;
            ok(left === 0 && leftRun === 0, '정리: 시험 지시 ' + made.length + '건 취소·숨김 · 시험 실행 기록 줄 숨김(is_deleted)', left + ' / ' + leftRun);
        } catch (e) { fail++; console.log('  ✗ 정리 실패: ' + e.message); }
        await db.end().catch(() => { }); srv.kill();
    }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
