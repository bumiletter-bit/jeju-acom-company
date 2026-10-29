// #799 검증 — 창구 지시 「채팅 종료」 = 처리 중·순서 대기도 종결 · 돌던 창구(자식 트리) 끔 · 다음 지시 집힘 · 늦은 결과가 종결을 안 덮음
//   전부 가짜 pool(실DB·실발송 0 · server.js 를 띄우지 않음) · 프로세스 끄기만 진짜 node 자식 트리로 시험
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cut = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); if (i < 0 || j < 0) throw new Error('구간 못 찾음 ' + a.slice(0, 30)); return SRC.slice(i, j); };

// 가짜 pending_orders
function fakeOrders(rows) {
    const T = new Map(rows.map(r => [r.id, Object.assign({ is_deleted: false, result: null }, r)]));
    const q = async (sql, p) => {
        sql = String(sql);
        if (/UPDATE pending_orders SET status = '질문종결'/.test(sql)) {   // 서버 /end
            const o = T.get(Number(p[0]));
            if (!o || o.is_deleted || !p[1].includes(o.status) || !(p[4] || o.created_by_id === p[3])) return { rows: [] };
            const was = o.status; o.status = '질문종결'; o.result = { type: 'closed_by_user', text: '사람이 종료했어요(' + p[2] + ')', by: p[2], by_id: p[3], from: was };
            return { rows: [{ id: o.id, run_id: o.run_id || null, status: o.status, was }] };
        }
        if (/UPDATE agent_runs/.test(sql)) return { rows: [] };
        if (/SELECT status, result->>'type' AS t FROM pending_orders WHERE id = \$1/.test(sql)) { const o = T.get(Number(p[0])); return { rows: o ? [{ status: o.status, t: o.result && o.result.type }] : [] }; }
        if (/FROM pending_orders o\s+WHERE o.is_deleted = false AND o.status IN \('대기', '승인됨'\)/.test(sql)) {   // launcher nextOrder 목록
            const list = [...T.values()].filter(o => !o.is_deleted && ['대기', '승인됨'].includes(o.status) && !String(o.content || '').startsWith('[검증469]') && (o.created_by_id || 0) < 990000)
                .sort((a, b) => ((b.status === '승인됨') - (a.status === '승인됨')) || a.id - b.id);
            return { rows: list.map(o => Object.assign({ has_image: false }, o)) };
        }
        throw new Error('예상 밖 쿼리: ' + sql.slice(0, 80));
    };
    return { T, query: q };
}

(async () => {
    // ── ① 서버 /end ──
    console.log('① 서버 POST /api/agent-office/orders/:id/end');
    const block = cut('const DESK_END_FROM =', '// 쌓인 지시 재처리');
    const routes = {}, audits = [], steps = [];
    const app = { post: (p, ...h) => { routes[p] = h[h.length - 1]; } };
    const P1 = fakeOrders([
        { id: 2980, status: '처리중', created_by_id: 7, run_id: 55 },
        { id: 2983, status: '대기', created_by_id: 7 },
        { id: 2990, status: '승인대기', created_by_id: 7 },
        { id: 2991, status: '처리중', created_by_id: 9 },
        { id: 2992, status: '완료', created_by_id: 7 },
        { id: 2993, status: '질문', created_by_id: 7 },
    ]);
    new Function('app', 'pool', 'authMiddleware', 'writeAudit', 'adminActor', 'agentRunAppendStep', 'agentStep', 'handleAdminErr', block)(
        app, P1, (q, r, n) => n(), async a => { audits.push(a); }, req => ({ id: req.user.id, name: req.user.name }),
        async (id, s) => { steps.push({ id, s }); }, (k, a, t) => ({ k, a, t }), (res, e) => res.status(e.status || 500).json({ error: e.message }));
    const call = async (id, user) => { let out = null, code = 200; await routes['/api/agent-office/orders/:id/end']({ params: { id: String(id) }, user, body: {} }, { json: v => { out = v; }, status: c => { code = c; return { json: v => { out = v; } }; } }); return { code, out }; };
    const me = { id: 7, name: '김민주', role: 'staff' }, boss = { id: 1, name: '전승범', role: 'admin', position: '대표' };
    let r = await call(2980, me);
    ok(r.code === 200 && P1.T.get(2980).status === '질문종결' && P1.T.get(2980).result.type === 'closed_by_user' && /사람이 종료/.test(P1.T.get(2980).result.text), '처리 중 지시 종료 = 질문종결 + result 「사람이 종료」');
    ok(audits.some(a => a.action === 'desk_order_close' && a.targetId === 2980 && a.changes.before.status === '처리중' && a.changes.after.by_id === 7), 'audit desk_order_close(누가 · 전 상태)');
    ok(steps.some(s => s.id === 55 && /채팅 종료/.test(s.s.t)), '실행 기록(run)에 「사람이 채팅 종료」 한 줄');
    r = await call(2983, me);
    ok(r.code === 200 && P1.T.get(2983).status === '질문종결', '순서 대기 지시 종료 = 바로 종결');
    r = await call(2990, me);
    ok(r.code === 400 && P1.T.get(2990).status === '승인대기', '승인 대기는 이 길로 안 끝남(무변경)');
    r = await call(2992, me);
    ok(r.code === 400 && P1.T.get(2992).status === '완료', '이미 끝난 지시 = 400(덮지 않음)');
    r = await call(2991, me);
    ok(r.code === 400 && P1.T.get(2991).status === '처리중', '남의 지시는 직원이 못 끝냄');
    r = await call(2991, boss);
    ok(r.code === 200 && P1.T.get(2991).status === '질문종결', '관리자는 남의 지시도 끝냄');
    r = await call(2993, me);
    ok(r.code === 200 && P1.T.get(2993).result.from === '질문', '질문도 이 길로 끝남(화면은 종전처럼 /close 를 씀)');

    // ── ② launcher: 종료 감시 · 트리 끄기 · 다음 지시 ──
    console.log('② launcher');
    const L = require('./desk/launcher.js')._t799;
    ok(L && typeof L.endWatcher === 'function' && typeof L.killTree === 'function', 'launcher 시험 고리');
    // 감시: 처리중 동안 안 끔 → 종결되면 끔(한 번) → 같은 지시로 다시 켠 창구도 끔
    const P2 = fakeOrders([{ id: 3000, status: '처리중', created_by_id: 7 }]);
    const kids = new Map(), killed = [], logs = [];
    const c1 = { pid: 111, exitCode: null };
    kids.set(3000, c1);
    const w = L.endWatcher(3000, { pool: P2, kids, ms: 40, killTree: c => { killed.push(c); return !!c; }, log: m => logs.push(m) });
    await sleep(150);
    ok(killed.length === 0, '처리 중인 동안은 안 끔');
    P2.T.get(3000).status = '완료'; P2.T.get(3000).result = { type: 'answer' };
    await sleep(120);
    ok(killed.length === 0 && !w.fired, '정상 완료(완료)는 사람 종료가 아님 → 안 끔');
    P2.T.get(3000).status = '질문종결'; P2.T.get(3000).result = { type: 'closed_by_user' };
    await sleep(150);
    ok(w.fired && killed.length === 1 && killed[0] === c1 && logs.some(l => /사람이 채팅 종료 — 돌던 창구를 끔/.test(l)), '사람 종료 → 그 자식 한 번 끔 · 로그');
    const c2 = { pid: 222, exitCode: null }; kids.set(3000, c2);
    await sleep(150);
    ok(killed.length === 2 && killed[1] === c2, '로그인 만료로 다시 켠 창구도 끔(한 번씩)');
    w.stop();
    // 진짜 트리 끄기(Windows taskkill /T /F · 리눅스 = spawnG 프로세스 그룹째 #917) — node 자식이 손자 node 를 띄운 채 기다림
    const kid = require('./desk/launcher.js')._t916.spawnG(process.execPath, ['-e', "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const gpid = await new Promise(res => kid.stdout.once('data', d => res(Number(String(d).trim()))));
    const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
    ok(alive(kid.pid) && alive(gpid), `시험 자식(${kid.pid})·손자(${gpid}) 살아 있음`);
    const exited = new Promise(res => kid.on('exit', () => res(true)));
    ok(L.killTree(kid) === true, 'killTree 호출 = true');
    await Promise.race([exited, sleep(5000)]); await sleep(800);
    ok(!alive(kid.pid) && !alive(gpid), '자식·손자 둘 다 꺼짐(트리)');
    ok(L.killTree(kid) === false, '이미 끝난 자식 = false(다시 안 끔)');
    const calls = []; L.killTree({ pid: 9, exitCode: null, kill: s => calls.push(s) }, { platform: 'linux' });
    ok(calls[0] === 'SIGKILL', 'Windows 가 아니면 SIGKILL');
    const sp = []; L.killTree({ pid: 77, exitCode: null, kill: () => { } }, { platform: 'win32', spawn: (c, a) => { sp.push([c, a]); return { on: () => { } }; } });
    ok(sp[0][0] === 'taskkill' && sp[0][1].join(' ') === '/PID 77 /T /F', 'Windows = taskkill /PID n /T /F');
    // 다음 지시: 종결된 건 안 집고 다음 대기 건을 집음
    const db = require('./desk/_db.js'); const realQ = db.pool.query;
    const P3 = fakeOrders([{ id: 2980, status: '질문종결', created_by_id: 1, content: '메일', result: { type: 'closed_by_user' } }, { id: 2983, status: '대기', created_by_id: 1, content: '[아침 정리]' }, { id: 2984, status: '대기', created_by_id: 990001, content: '시험' }]);
    db.pool.query = P3.query;
    try {
        let n = await L.nextOrder();
        ok(n && n.id === 2983, '종결된 2980 대신 다음 대기 2983 을 집음 · 시험 계정(≥990000) 건은 안 집음(#638)');
        P3.T.get(2983).status = '질문종결';
        n = await L.nextOrder();
        ok(n === null, '순서 대기였던 2983 을 종결하면 안 집힘');
    } finally { db.pool.query = realQ; }
    const LSRC = fs.readFileSync(path.join(__dirname, 'desk', 'launcher.js'), 'utf8');
    ok(/SET status = '오류', result = \$2, processed_at = NOW\(\) WHERE id = \$1 AND status IN \('대기', '처리중', '승인됨'\)/.test(LSRC), '3번 실패 → 오류 갱신도 열린 상태일 때만(종결 안 덮음)');
    ok((LSRC.match(/isAuthFail\(r\) && !ender\.fired/g) || []).length === 2, '사람이 끝낸 지시는 로그인 만료 재시도 안 함');
    ok(/WHERE id = \$1 AND status = '처리중' RETURNING id/.test(LSRC), '고아 복구(#701)는 처리중만 = 종결은 대상 아님(무변경)');

    // ── ③ respond.js: 늦게 온 결과가 종결을 안 덮음 ──
    console.log('③ respond.js(가짜 pool · 따로 띄움)');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v799-'));
    const pre = path.join(tmp, 'pre.js'), res = path.join(tmp, 'r.json');
    fs.writeFileSync(res, JSON.stringify({ kind: 'answer', title: '시험', answer: '늦게 온 답' }));
    const preSrc = (rowCount) => `const M=require('module');const p=require.resolve(${JSON.stringify(path.join(__dirname, 'desk', '_db.js'))});
const ups=[];const pool={query:async(s,a)=>{s=String(s);if(/SELECT id, status, run_id/.test(s))return{rows:[{id:1,status:'처리중',run_id:null,created_by_id:990001,content:'[검증469] x'}]};
if(/UPDATE pending_orders SET status = \\$2/.test(s)){ups.push(s);if(!/AND status IN \\('처리중', '대기'\\)/.test(s))throw new Error('조건 없음');return{rowCount:${rowCount},rows:[]};}if(/INSERT INTO report_files/.test(s))return{rows:[{id:77}],rowCount:1};if(/UPDATE report_files SET is_deleted = true/.test(s)){require('fs').writeFileSync(process.env.V799_MARK,JSON.stringify(a));return{rowCount:1,rows:[]};}return{rows:[],rowCount:0};},end:async()=>{}};
require.cache[p]={id:p,filename:p,loaded:true,exports:{pool,appendStep:async()=>{},heartbeat:async()=>{},audit:async()=>{}}};`;
    fs.writeFileSync(pre, preSrc(0));
    let rr = spawnSync(process.execPath, ['-r', pre, path.join(__dirname, 'desk', 'respond.js'), '1', res], { encoding: 'utf8', cwd: ROOT });
    ok(rr.status === 1 && /결과를 올리지 않았습니다/.test(rr.stderr), '읽은 뒤 사람이 종료(갱신 0줄) = 결과 안 올림 · 오류로 끝남');
    fs.writeFileSync(pre, preSrc(1));
    rr = spawnSync(process.execPath, ['-r', pre, path.join(__dirname, 'desk', 'respond.js'), '1', res], { encoding: 'utf8', cwd: ROOT });
    ok(rr.status === 0 && /"ok":true/.test(rr.stdout), '보통(처리중) = 종전처럼 결과 올림');
    // 첨부를 올린 뒤 사람이 종료(갱신 0줄) = 그 첨부를 숨김(고아 0)
    const att = path.join(tmp, '첨부.txt'), mark = path.join(tmp, 'mark.json'); fs.writeFileSync(att, '시험 첨부');
    fs.writeFileSync(res, JSON.stringify({ kind: 'answer', title: '시험', answer: '늦게 온 답', attachments: [att] }));
    fs.writeFileSync(pre, preSrc(0));
    rr = spawnSync(process.execPath, ['-r', pre, path.join(__dirname, 'desk', 'respond.js'), '1', res], { encoding: 'utf8', cwd: ROOT, env: Object.assign({}, process.env, { V799_MARK: mark }) });
    ok(rr.status === 1 && fs.existsSync(mark) && JSON.parse(fs.readFileSync(mark, 'utf8'))[0].includes(77), '첨부 올린 뒤 종결이면 그 첨부(id 77) 숨김 · 결과 안 올림');
    fs.rmSync(tmp, { recursive: true, force: true });

    // ── ④ 화면(코드) ──
    console.log('④ ao-desk.js');
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'ao-desk.js'), 'utf8');
    ok(/const ENDABLE = \['대기', '처리중'\];/.test(UI) && /o\.status === '질문' \|\| ENDABLE\.includes\(o\.status\)/.test(UI), '대화 [채팅 종료] = 처리 중·순서 대기에도 보임');
    ok(/else if \(ENDABLE\.includes\(it\.status\)\) \{ await endOrder\(it\)/.test(UI) && /'\/end', 'POST'/.test(UI), '누르면 /end 뒤 내 목록에서 숨김(종전 hide-mine 그대로)');
    ok(/if \(it\.status === '질문'\) \{ await api\('\/api\/agent-office\/orders\/' \+ it\.id \+ '\/close'/.test(UI), '질문은 종전 /close 그대로(되묻기 흐름 무변경)');
    ok(/busyEnd = !canHide && t\.items\.some\(o => \['판독완료', '확인표작성', '승인대기'\]/.test(UI), '승인 대기·확인표 작성은 종전처럼 「끝난 뒤 종료」');

    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
