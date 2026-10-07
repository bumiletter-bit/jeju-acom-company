// #580 창구 속도 B·C·E·F 검증 — ①fast.js 순수 함수 ②launcher.js 차례 고르기(실코드 구간을 떼어 가짜 자료로) ③화면 실렌더(로컬 3462 · 목록은 가짜 응답 · 쓰기 0)
//   node scripts/verify-580-desk-speed.js        실제 AI 시험은 따로(대표 요금제) — 보고 참조
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = 3462, BASE = 'http://localhost:' + PORT, SECRET = 'verifytest';
const fast = require('./desk/fast');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

(async () => {
    // ───────── ① fast.js
    console.log('① fast.js — 설정 · 정산 이미지 판정 · 규칙 문서 미리 넣기');
    const d = fast.settings(null);
    ok(d.inline === true && d.settlepar === true && d.poll && d.stream && d.prefetch && d.route && d.direct && d.lean && d.warm && !d.off, '기본값: 새 항목 2개(inline·settlepar) 켜짐 · 종전 7개 그대로');
    ok(fast.settings({ inline: false }).inline === false && fast.settings({ inline: false }).settlepar === true && fast.settings({ settlepar: false }).settlepar === false, '낱개로 끌 수 있음');
    const off = fast.settings({ off: true }); ok(off.off && !off.inline && !off.settlepar && !off.warm, 'off 면 전부 꺼짐');
    const O = x => Object.assign({ id: 1, status: '대기', has_image: true, file_name: null, reply_to: null, content: '대성 정산 올려줘' }, x);
    ok(fast.settleImage(O()) === true && fast.settleImage(O({ content: '오늘 발주 수량 정산 등록' })) === true, '정산 이미지(그림 + 정산 말) = 같이 돌려도 되는 일');
    ok(!fast.settleImage(O({ has_image: false })) && !fast.settleImage(O({ file_name: '표.xlsx' })) && !fast.settleImage(O({ reply_to: 5 })) && !fast.settleImage(O({ status: '승인됨' })) && !fast.settleImage(O({ content: '이 그림으로 톡톡 문구 만들어줘' })) && !fast.settleImage(O({ content: '재고 알려줘', has_image: false })), '그림 없음·파일 첨부·이어서 지시·승인된 실행·정산 아닌 그림·조회 = 아님(종전대로 한 번에 하나)');
    ok(fast.route(O(), null).model === 'sonnet' && fast.route(O({ content: '중간발주', has_image: false }), null).lane === 'direct_qty', '길 고르기는 종전 그대로(정산 이미지 = 빠른 모델 · 중간발주 = 바로)');
    // 실제 get.js 가 내주는 how 글 2개로
    const getSrc = read(path.join(__dirname, 'desk', 'get.js'));
    const hows = [...getSrc.matchAll(/how: '([^']+)'/g)].map(m => m[1]);
    ok(hows.length === 2, 'get.js 의 최종발주 안내 글 2개(메모 읽기·대화)를 찾음');
    const DESK = path.join(ROOT, '★에이전트오피스');
    for (const [i, doc, label] of [[0, '최종발주_메모읽기.md', '메모 읽기'], [1, '최종발주_대화.md', '대화']]) {
        const rules = path.join(DESK, doc), data = JSON.stringify({ type: 'x', ask: '시험 요청', orders: [{ n: 1 }] }, null, 1);
        const got = { ok: true, id: 7, content: '[최종발주] 시험', final_order_memo: { payload_path: 'P.json', count: 1, rules, how: hows[i] }, remember: [] };
        const r = fast.inlineFinalOrder(got, p => p === 'P.json' ? data : read(p));
        const docText = read(rules);
        ok(!!r && r.withData && r.text.includes(docText) && r.text.includes(data) && r.name === doc && r.cleanup === 'P.json', `${label}: 규칙 문서 전문(${docText.length}자) + 자료가 지시문에 실림`);
        const fm = r.got.final_order_memo;
        ok(!('rules' in fm) && !('payload_path' in fm) && !/rules 문서를 먼저 읽고|파일을 지웁니다|payload_path/.test(fm.how) && /아래 <규칙 문서> 대로/.test(fm.how) && /아래 <자료> 의/.test(fm.how) && /"kind":"answer"/.test(fm.how), `  안내 글에서 「먼저 읽고」「지웁니다」「payload_path」가 빠지고 결과 꼴은 그대로`);
        ok(got.final_order_memo.rules === rules && got.final_order_memo.how === hows[i], '  원래 받은 내용은 안 바뀜(사본만 고침)');
        const big = fast.inlineFinalOrder(got, p => p === 'P.json' ? 'x'.repeat(200001) : read(p));
        ok(big && !big.withData && big.got.final_order_memo.payload_path === 'P.json' && !big.text.includes('<자료>') && /payload_path 파일에 있습니다/.test(big.text), '  자료가 너무 크면(20만 자 초과) 규칙 문서만 넣고 자료는 종전대로 파일로');
    }
    const g0 = { final_order_memo: { payload_path: 'P', rules: 'R', how: hows[0] } };
    ok(fast.inlineFinalOrder({ ok: true }, read) === null && fast.inlineFinalOrder(g0, () => null) === null && fast.inlineFinalOrder({ final_order_memo: { rules: 'R', payload_path: 'P', how: '문구가 바뀐 안내' } }, () => '규칙') === null && fast.inlineFinalOrder(g0, p => p === 'R' ? 'x'.repeat(60001) : null) === null, '일반 지시·문서를 못 읽음·안내 문구가 바뀜·문서가 너무 큼 = 미리 넣지 않음(종전 방식)');

    // ───────── ② launcher.js — 차례 고르기(실코드 구간)
    console.log('② launcher.js — 같은 사람의 정산 이미지는 같이 · 그 밖은 종전대로 한 번에 하나');
    const L = read(path.join(__dirname, 'desk', 'launcher.js'));
    const a = L.indexOf('const ORDER_COLS'), b = L.indexOf('async function writeState');
    ok(a > 0 && b > a && /o\.file_name,/.test(L.slice(a, b)), '차례 고르기 구간을 찾음(조회에 file_name 포함)');
    const mk = (rows, running, f) => new Function('pool', 'st', 'fast', L.slice(a, b) + '\nreturn nextOrder;')({ query: async () => ({ rows }) }, { running: new Map(running), directBusy: false, fast: f || fast.settings(null) }, fast);
    const settle = (id, by) => O({ id, created_by_id: by }), chat = (id, by) => ({ id, created_by_id: by, status: '대기', has_image: false, file_name: null, reply_to: null, content: '이번 주 톡톡 문구 써줘' });
    const pick = async (rows, running, f) => { const o = await mk(rows, running, f)(0); return o ? o.id : null; };
    ok(await pick([settle(11, 1)], [[10, { by: 1, settle: true }]]) === 11, '정산 이미지 처리 중 + 같은 사람의 정산 이미지 → 바로 같이 집음');
    ok(await pick([settle(11, 1), settle(12, 1)], [[10, { by: 1, settle: true }], [11, { by: 1, settle: true }]]) === 12, '세 번째 장도 같이');
    ok(await pick([chat(11, 1)], [[10, { by: 1, settle: true }]]) === null, '정산 이미지 처리 중 + 같은 사람의 다른 지시 → 기다림(종전)');
    ok(await pick([settle(11, 1)], [[10, { by: 1, settle: false }]]) === null, '다른 일 처리 중 + 같은 사람의 정산 이미지 → 기다림(종전)');
    ok(await pick([settle(11, 1)], [[9, { by: 1, settle: true }], [10, { by: 1, settle: false }]]) === null, '섞여 돌고 있으면 기다림');
    ok(await pick([chat(11, 1), chat(12, 2)], [[10, { by: 1, settle: false }]]) === 12, '다른 사람 지시는 종전대로 바로');
    ok(await pick([settle(11, 1)], [[10, { by: 1, settle: true }]], fast.settings({ settlepar: false })) === null && await pick([settle(11, 1)], [[10, { by: 1, settle: true }]], fast.settings({ off: true })) === null, '설정으로 끄면(settlepar false · off) 종전대로 기다림');
    ok(await pick([O({ id: 11, created_by_id: 1, file_name: '정산.xlsx' })], [[10, { by: 1, settle: true }]]) === null && await pick([O({ id: 11, created_by_id: 1, reply_to: 10 })], [[10, { by: 1, settle: true }]]) === null, '엑셀 첨부·이어서 지시는 같이 안 돌림');
    ok(/st\.running\.set\(order\.id, \{ by: order\.created_by_id, at: Date\.now\(\), settle: fast\.settleImage\(order\) \}\)/.test(L), '처리 시작 때 「정산 이미지인지」를 적어 둠');
    ok(/const PARALLEL = Math\.max\(1, Math\.min\(8, parseInt\(process\.env\.DESK_PARALLEL, 10\) \|\| 4\)\)/.test(L) && /if \(st\.running\.size >= PARALLEL\) return false;/.test(L), '동시 처리 상한(4)은 그대로');
    ok(/promptPrefetched\(order, got, inl\)/.test(L) && /if \(got && f\.inline\)/.test(L) && /if \(inl && inl\.cleanup\) \{ try \{ fs\.unlinkSync\(inl\.cleanup\)/.test(L), '미리 넣기 배선: 설정이 켜졌을 때만 · 끝나면 자료 파일을 대기 프로그램이 지움');
    {   // promptPrefetched 실코드로 지시문 조립
        const pa = L.indexOf('function promptPrefetched'), pb = L.indexOf('const st = {');
        const pp = new Function('path', 'ROOT', L.slice(pa, pb) + '\nreturn promptPrefetched;')(path, ROOT);
        const got = { ok: true, id: 7, final_order_memo: { payload_path: 'P.json', rules: path.join(DESK, '최종발주_대화.md'), how: hows[1] } };
        const inl = fast.inlineFinalOrder(got, p => p === 'P.json' ? '{"ask":"시험"}' : read(p));
        const withInl = pp({ id: 7 }, got, inl), plain = pp({ id: 7 }, got, null);
        ok(withInl.indexOf('</지시>') < withInl.indexOf('<규칙 문서 최종발주_대화.md>') && withInl.indexOf('</자료>') < withInl.indexOf('respond.js 7') && !/"rules"/.test(withInl.split('</지시>')[0]), '지시문 순서 = 지시 → 규칙 문서 → 자료 → 결과 올리는 법');
        ok(/"rules"/.test(plain) && !/<규칙 문서/.test(plain) && plain.replace(/\s+/g, '').length < withInl.replace(/\s+/g, '').length, '미리 넣기가 없으면 지시문은 종전 꼴 그대로');
    }

    // ───────── ③ 화면
    console.log('③ 화면(ao-desk.js) — 1초 재조회 · 돌아오면 즉시 · 「생각 중 N초」 · 걸린 시간 = 보낸 때부터');
    const { pool } = require('./desk/_db.js'); const jwt = require('jsonwebtoken'); const { chromium } = require('playwright');
    const act = (await pool.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE is_deleted=false AND status IN ('처리중','확인표작성')`)).rows[0].c;
    if (act) { console.log('⚠ 처리 중인 지시가 있어 화면 대목을 건너뜁니다 — 잠시 뒤 다시 실행'); fail++; await pool.end(); }
    else {
        const ceo = (await pool.query(`SELECT id, name, username FROM users WHERE position='대표' AND role='admin' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        await pool.end();
        const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
        let br;
        try {
            let up = false; for (let i = 0; i < 90 && !up; i++) { await sleep(1000); try { const r = await fetch(BASE + '/api/agent-office/desk-status'); up = r.status === 401; } catch (_) { } }
            if (!up) throw new Error('로컬 서버 기동 실패');
            const USER = { id: ceo.id, name: ceo.name, username: ceo.username, position: '대표', role: 'admin' }; const token = jwt.sign(USER, SECRET, { expiresIn: '30m' });
            br = await chromium.launch();
            for (const [vw, vh, label] of [[1440, 900, 'PC'], [390, 844, '폰']]) {
                const ctx = await br.newContext({ viewport: { width: vw, height: vh }, serviceWorkers: 'block' });
                await ctx.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', u); }, [token, JSON.stringify(USER)]);
                const pg = await ctx.newPage();
                const errs = [], writes = [], calls = []; let list = [], delay = 0;
                pg.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
                pg.on('pageerror', e => errs.push('pageerror: ' + String(e.message).slice(0, 140)));
                await pg.route('**/api/**', async route => {
                    const rq = route.request(), u = rq.url().replace(BASE, '');
                    if (rq.method() !== 'GET') { writes.push(rq.method() + ' ' + u.slice(0, 60)); return route.fulfill({ json: { ok: true } }); }
                    if (/desk\/orders\?mine=1/.test(u)) { calls.push(Date.now()); if (delay) await sleep(delay); return route.fulfill({ json: { orders: list } }); }
                    if (/desk\/(board|inbox)/.test(u)) return route.fulfill({ json: {} });
                    return route.continue();
                });
                const iso = ms => new Date(Date.now() + ms).toISOString();
                const mkO = x => Object.assign({ id: 999001, content: '시험 지시', status: '대기', result: null, run_id: null, created_at: iso(-5000), processed_at: null, created_by: '시험', created_by_id: ceo.id, mine_hidden: false, has_image: false, file_name: null, reply_to: null, followed_by: null, steps: null }, x);
                await pg.goto(BASE + '/'); await pg.waitForSelector('.sidebar-nav', { state: 'attached', timeout: 30000 });
                await pg.evaluate(() => window.switchPage && window.switchPage('agent-office'));
                await pg.waitForSelector('#desk-input', { state: 'visible', timeout: 30000 });
                await sleep(1500);
                const gaps = () => { const g = []; for (let i = 1; i < calls.length; i++) g.push(calls[i] - calls[i - 1]); return g; };
                // 진행 중인 지시 없음 — 12초 주기 그대로(6초 동안 많아야 1번)
                calls.length = 0; await sleep(6000);
                ok(calls.length <= 1, `[${label}] 진행 중인 지시가 없으면 종전 주기 그대로(6초 동안 ${calls.length}번)`);
                // 대기 중인 지시 → 1초마다
                list = [mkO({})]; await pg.evaluate(() => window.__aoDesk.loadOrders(true)); await pg.waitForSelector('#desk-list [data-oid="999001"]');
                calls.length = 0; await sleep(6200);
                const g1 = gaps(); const avg1 = g1.reduce((x, y) => x + y, 0) / Math.max(1, g1.length);
                ok(calls.length >= 5 && calls.length <= 8 && avg1 > 800 && avg1 < 1300, `[${label}] 진행 중이면 1초마다 다시 받음(6.2초 동안 ${calls.length}번 · 평균 간격 ${Math.round(avg1)}ms · 종전 2초)`);
                // 「순서를 기다리고 있어요 · N초」 — 보낸 때(5초 전)부터, 1초마다 오름 · 목록을 다시 그리지 않음
                const el1 = await pg.evaluate(() => { const c = document.querySelector('#desk-list [data-oid="999001"]'); const w = c && c.querySelector('.desk-working'), e = c && c.querySelector('.desk-elapsed'); if (e) e.__mark = 1; return { w: w && w.textContent, e: e && e.textContent }; });
                await sleep(2100);
                const el2 = await pg.evaluate(() => { const e = document.querySelector('#desk-list [data-oid="999001"] .desk-elapsed'); return { e: e && e.textContent, same: !!(e && e.__mark) }; });
                const n1 = parseInt((el1.e || '').replace(/\D/g, ''), 10), n2 = parseInt((el2.e || '').replace(/\D/g, ''), 10);
                ok(el1.w === '순서를 기다리고 있어요' && /^ · \d+초$/.test(el1.e || '') && n1 >= 10 && n1 <= 16, `[${label}] 대기: 「${el1.w}${el1.e}」(보낸 지 5초 + 지금까지 — 기존 문구는 그대로)`);
                ok(n2 - n1 >= 2 && n2 - n1 <= 3 && el2.same, `[${label}] 숫자가 1초마다 오름(${n1} → ${n2}) · 그 칸만 바뀜(목록 다시 안 그림)`);
                // 처리중 · 아직 한 일 없음 → 「생각하고 있어요 · N초」
                list = [mkO({ status: '처리중', run_id: 1, steps: [{ t: iso(-1000), kind: 'lane', text: '🧠 깊은 답' }] })];
                await pg.waitForFunction(() => { const w = document.querySelector('#desk-list [data-oid="999001"] .desk-working'); return w && w.textContent === '생각하고 있어요'; }, null, { timeout: 5000 }).catch(() => { });
                const th = await pg.evaluate(() => { const c = document.querySelector('#desk-list [data-oid="999001"]'); return { w: (c.querySelector('.desk-working') || {}).textContent, e: (c.querySelector('.desk-elapsed') || {}).textContent }; });
                ok(th.w === '생각하고 있어요' && /^ · \d+초$/.test(th.e || ''), `[${label}] 처리 시작 · 아직 한 일 없음: 「${th.w}${th.e}」`);
                list = [mkO({ status: '처리중', run_id: 1, steps: [{ t: iso(-3000), kind: 'lane', text: '🧠 깊은 답' }, { t: iso(-500), kind: 'work', text: '🔎 회사프로그램 자료 조회 중' }] })];
                await pg.waitForFunction(() => { const w = document.querySelector('#desk-list [data-oid="999001"] .desk-working'); return w && /조회 중/.test(w.textContent); }, null, { timeout: 5000 }).catch(() => { });
                const wk = await pg.evaluate(() => { const c = document.querySelector('#desk-list [data-oid="999001"]'); return { w: (c.querySelector('.desk-working') || {}).textContent, e: (c.querySelector('.desk-elapsed') || {}).textContent }; });
                ok(/조회 중/.test(wk.w || '') && /^ · \d+초$/.test(wk.e || ''), `[${label}] 일하는 중: 「${wk.w}${wk.e}」(하는 일 + 지난 시간)`);
                // 가려진 동안은 안 받고, 돌아오면 바로
                await pg.evaluate(() => { window.__hid = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hid }); document.dispatchEvent(new Event('visibilitychange')); });
                await sleep(400); calls.length = 0; await sleep(3200);
                const hiddenCalls = calls.length;
                const t0 = Date.now(); calls.length = 0;
                await pg.evaluate(() => { window.__hid = false; document.dispatchEvent(new Event('visibilitychange')); });
                for (let i = 0; i < 40 && !calls.length; i++) await sleep(10);
                const back = calls.length ? calls[0] - t0 : -1;
                ok(hiddenCalls === 0, `[${label}] 탭이 가려진 동안은 안 받음(3.2초 동안 ${hiddenCalls}번 — 종전 그대로)`);
                ok(back >= 0 && back < 300, `[${label}] 돌아오면 바로 다시 받음(${back}ms · 종전 = 다음 차례까지 최대 2초, 진행 중이 아니면 최대 12초)`);
                // 진행 중이 아닐 때도 돌아오면 바로
                list = []; await pg.evaluate(() => window.__aoDesk.loadOrders(true)); await sleep(300);
                await pg.evaluate(() => { window.__hid = true; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(300); calls.length = 0;
                const t1 = Date.now(); await pg.evaluate(() => { window.__hid = false; document.dispatchEvent(new Event('visibilitychange')); });
                for (let i = 0; i < 40 && !calls.length; i++) await sleep(10);
                ok(calls.length === 1 && calls[0] - t1 < 300, `[${label}] 진행 중인 지시가 없어도 돌아오면 바로(${calls.length ? calls[0] - t1 : -1}ms)`);
                // 응답이 느릴 때(1.6초) — 요청이 겹쳐 쌓이지 않는다
                list = [mkO({})]; await pg.evaluate(() => window.__aoDesk.loadOrders(true)); await sleep(300);
                delay = 1600; calls.length = 0; await sleep(6500); delay = 0;
                const g2 = gaps();
                ok(calls.length >= 2 && calls.length <= 5 && g2.every(x => x >= 1500), `[${label}] 서버가 느리면(1.6초) 앞 요청이 끝난 뒤에만 다음 요청(6.5초 동안 ${calls.length}번 · 최소 간격 ${Math.min(...g2)}ms)`);
                await sleep(1800);
                // 끝난 지시의 걸린 시간 = 보낸 때부터(60초) — 길 표시(끝나기 10초 전)부터가 아님
                const done = at => mkO({ status: '완료', run_id: 1, created_at: iso(-60000 - at), processed_at: iso(-at), steps: [{ t: iso(-10000 - at), kind: 'lane', text: '🧠 깊은 답' }], result: { type: 'desk_answer', title: '시험 제목', answer: '시험 답변입니다 가나다라' } });
                list = [done(1000)]; await pg.evaluate(() => window.__aoDesk.loadOrders(true));
                await pg.waitForFunction(() => /시험 답변입니다/.test((document.querySelector('#desk-list') || {}).textContent || ''), null, { timeout: 5000 });
                const chip = await pg.evaluate(() => { const c = document.querySelector('#desk-list [data-oid="999001"] .desk-lane') || document.querySelector('#desk-list .desk-lane'); return c ? c.textContent : ''; });
                ok(/깊은 답 · 60초$/.test(chip), `[${label}] 걸린 시간 표시 「${chip}」 = 보낸 때부터 60초(종전 계산이면 10초)`);
                ok(await pg.evaluate(() => !document.querySelector('#desk-list .desk-elapsed')), `[${label}] 끝난 지시에는 지난 시간 숫자가 없음`);
                // 2분 넘으면 분 단위(종전 규칙) · 접수 시각이 없는 옛 자료는 종전 계산으로
                list = [mkO({ status: '완료', run_id: 1, created_at: iso(-200000), processed_at: iso(-1000), steps: [{ t: iso(-9000), kind: 'lane', text: '⚡ 빠른 답' }], result: { type: 'desk_answer', title: '둘째', answer: '둘째 답변입니다' } })];
                await pg.evaluate(() => window.__aoDesk.loadOrders(true)); await pg.waitForFunction(() => /둘째 답변입니다/.test((document.querySelector('#desk-list') || {}).textContent || ''), null, { timeout: 5000 });
                const chip2 = await pg.evaluate(() => (document.querySelector('#desk-list .desk-lane') || {}).textContent || '');
                ok(/빠른 답 · 3분$/.test(chip2), `[${label}] 90초를 넘으면 분으로 「${chip2}」`);
                ok(errs.length === 0 && writes.length === 0, `[${label}] 콘솔 오류 ${errs.length} · 쓰기 요청 ${writes.length}` + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
                await ctx.close();
            }
        } finally { if (br) await br.close(); srv.kill(); }
    }
    console.log(`\n결과: ${pass}/${pass + fail}` + (fail ? ' — 실패 ' + fail : ' 전부 통과'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
