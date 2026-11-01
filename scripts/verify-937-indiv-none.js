// #937 검증 — 자동 송장: 입력삭제(IND) 주문이 운송장 0 이면 할 일 카드(todo_indiv_none) · 새 자동 짝 없음 · 종전 규칙 무변경
//   🔴 실DB·실서버·채널 호출 0 · 순수 함수 + 가짜 api 시험 페이지(file://)만 · 종전 대조 = git HEAD 판 invoice-auto.js 를 임시 파일로
//   실행: node scripts/verify-937-indiv-none.js
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public').split(path.sep).join('/');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 500))); };
const ia = require(path.join(ROOT, 'invoice-auto.js'));
const TMP = fs.mkdtempSync(path.join(ROOT, '.v937-'));
fs.writeFileSync(path.join(TMP, 'old.js'), execSync('git show HEAD:invoice-auto.js', { cwd: ROOT, maxBuffer: 64 << 20 }));
fs.copyFileSync(path.join(ROOT, 'price-check.js'), path.join(TMP, 'price-check.js'));
const old = require(path.join(TMP, 'old.js'));

const TY = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', HG = '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)';
const BUY = '010-2600-0001', BUY2 = '010-2600-0002';
const nv = (pid, opt, q, buy, addr, nm) => ({ _pid: pid, '구매자연락처': buy || BUY, '수취인명': nm || '가구매', '수취인연락처1': buy || BUY, '통합배송지': addr || '서울 가짜구 집로 1', '옵션정보': '아꼼이네 상품선택: 1. (제철)' + opt, '수량': q });
const cf = (oid, opt, q, buy) => ({ _orderId: oid, _itemCode: 'I' + oid, '수령인': '가구매', '수령인 휴대전화': buy || BUY, '수령인 주소(전체)': '서울 가짜구 집로 1', '주문자 휴대전화': buy || BUY, '주문상품명(세트상품 포함)': opt, '수량': q });
let t = 681000900000; const sh = (nm, ad, op, st, tel) => ({ tr: String(++t), nm, tel: tel || '010-3300-' + String(t % 10000).padStart(4, '0'), ad, op, q: 1, sn: '가구매 드림', stel: st || BUY });
const run = (M, orders, ships, ind) => { const m = M.matchShipments({ ships: M.normShips(ships.map(x => ({ ...x }))), orders: orders.map(x => ({ ...x })), pricingNames: [TY, HG], indivKeys: ind }); return { m, card: M.buildCard(m, orders) }; };
const N = rows => ia.normOrders('naver', rows), rule = c => Object.fromEntries(c.rows.map(x => [x.order_key, x.rule]));

(async () => {
    console.log('① 종전 결과 바이트 동일(IND 운송장 0 이 없는 자료)');
    const sets = [
        ['IND 없음 · 일반 짝', N([nv('A', TY, 1)]), [sh('가구매', '서울 가짜구 집로 1', TY, BUY, BUY)], undefined],
        ['IND 없음 · 운송장 없는 주문 그대로', N([nv('A', TY, 1), nv('B', HG, 1, BUY2)]), [sh('가구매', '서울 가짜구 집로 1', TY, BUY, BUY)], []],
        ['IND 1건 · 주소 줄 있음(1차 길)', N([nv('A', TY, 2)]), [sh('받는1', '부산 1', TY), sh('받는2', '부산 2', TY)], ['naver:A']],
        ['IND 2건 · 스토어 주소 먼저', N([nv('A', TY, 1), nv('C', TY, 1)]), [sh('받는1', '부산 1', TY), sh('가구매', '서울 가짜구 집로 1', TY)], ['naver:A', 'naver:C']],
        ['목록에 없는 IND 열쇠(주문 없음)', N([nv('A', TY, 1)]), [sh('가구매', '서울 가짜구 집로 1', TY, BUY, BUY)], ['naver:없는주문']],
    ];
    for (const [name, os_, ss, ind] of sets) { t = 681000900000; const n = JSON.stringify(run(ia, os_, ss, ind).card); t = 681000900000; const o = JSON.stringify(run(old, os_, ss, ind).card); ok(n === o, name + ' = HEAD 판과 카드 JSON 같음', { n: n.slice(0, 200), o: o.slice(0, 200) }); }

    console.log('② IND 운송장 0 → 할 일 카드');
    { const o = N([nv('A', TY, 3)]), { card } = run(ia, o, [], ['naver:A']), x = card.rows[0];
      ok(card.rows.length === 1 && x.status === 'todo' && x.rule === 'todo_indiv_none' && x.suggest === null && x.pick_options.length === 0 && /거래처 파일/.test(x.why) && card.by_channel.naver.todo === 1, '운송장 0 · 옵션 0 카드 + 사유 글', x);
      ok(card.orders_without_tracking === 0, '카드가 된 주문은 「운송장 없는 주문」 숫자에서 빠짐', card.orders_without_tracking);
      const { card: o2 } = run(old, o, [], ['naver:A']); ok(o2.rows.length === 0 && o2.orders_without_tracking === 1, '(대조) 종전 = 카드 0 · 숫자에만', o2.orders_without_tracking); }

    console.log('③ 거래처 파일 하나만 → 그 거래처 빠진 IND 만 카드 · 일반 무운송장 주문은 카드 없음');
    { const o = N([nv('A', TY, 1), nv('B', HG, 1, BUY2), nv('C', HG, 1, '010-2600-0003', '대전 1')]);
      const { card } = run(ia, o, [sh('받는1', '부산 1', TY)], ['naver:A', 'naver:B']), r = rule(card);
      ok(r.A === 'indiv_any' && r.B === 'todo_indiv_none' && !r.C, 'A = 1차 그대로 · B(파일 안 올린 쪽 IND) = 카드 · C(IND 아님) = 카드 없음', r);
      ok(card.orders_without_tracking === 1, 'C 는 「운송장 없는 주문」 숫자 유지', card.orders_without_tracking); }

    console.log('④ 옵션 · 새 자동 짝 없음 · 다른 줄 그대로');
    { // 줄은 있는데 품목이 다름 = 자동 짝 안 함 · 품목 맞는 후보 0 → 빈 목록 · 그 운송장은 「주문 없음」에 그대로
      const o = N([nv('A', TY, 1)]); const { card } = run(ia, o, [sh('받는1', '부산 1', HG)], ['naver:A']);
      ok(rule(card).A === 'todo_indiv_none' && card.rows[0].pick_options.length === 0 && card.unmatched.length === 1, '품목 다른 줄 = 자동 안 붙음 · 후보 0 · 운송장은 주문 없음 칸', card.rows[0]);
      // 같은 품목 IND 2건 · 줄 1장 = 한 건 붙고 다른 건 카드
      const o2 = N([nv('A', TY, 1), nv('C', TY, 1)]); const { card: c2 } = run(ia, o2, [sh('받는1', '부산 1', TY)], ['naver:A', 'naver:C']), r2 = rule(c2);
      ok(Object.values(r2).sort().join() === 'indiv_any,todo_indiv_none', '같은 품목 2건 · 1장 = 한 건 1차 · 한 건 카드(같은 운송장 두 번 0)', r2);
      // 선물하기(번호 가림) IND = 후보 0 카드
      const o3 = N([nv('G', TY, 1, '010-9***-9***')]); const { card: c3 } = run(ia, o3, [sh('받는1', '부산 1', TY)], ['naver:G']);
      ok(rule(c3).G === 'todo_indiv_none' && c3.rows[0].pick_options.length === 0, '번호 가린 IND = 빈 후보 카드', c3.rows[0].rule);
      // 자사몰 입력삭제 = 종전 todo_pick 길 그대로(남은 줄이 다른 주문 품목뿐)
      const o4 = ia.normOrders('cafe24', [cf('K1', '개인결제창 20박스', 1)]).concat(N([nv('A', TY, 1)])); t = 681000900000; const s4 = [sh('받는1', '부산 1', TY)];
      const n4 = JSON.stringify(run(ia, o4, s4, ['cafe24:K1|IK1']).card); t = 681000900000; const o4j = JSON.stringify(run(old, o4, s4, ['cafe24:K1|IK1']).card);
      ok(n4 === o4j, '자사몰 todo_pick 길 = HEAD 판과 같음'); }

    console.log('⑤ PII·저장 꼴');
    { const { card } = run(ia, N([nv('A', TY, 1)]), [], ['naver:A']), st = ia.stripPII(card);
      ok(!JSON.stringify(st).includes('가구매') && st.rows[0].why && st.rows[0].rule === 'todo_indiv_none', 'stripPII 뒤 이름 0 · why 남음'); }

    console.log('⑤-2 등록 = 수기 줄에 카드 사유(가짜 pool · 외부 0)');
    { const express = require(path.join(ROOT, 'node_modules', 'express')), http = require('http'), { card } = run(ia, N([nv('A', TY, 1)]), [], ['naver:A']), st = ia.stripPII(card);
      const run0 = { id: 1, ship_date: '2026-11-02', result: st, register_state: null, register: null };
      const pool = { query: async (sql, p) => { const q = String(sql).replace(/\s+/g, ' ').trim(); if (/^SELECT id, result, register_state FROM invoice_auto_runs/.test(q)) return { rows: [run0] }; if (/^UPDATE invoice_auto_runs SET register_state = 'prepared'/.test(q)) { run0.register = JSON.parse(p[1]); return { rowCount: 1 }; } if (/^SELECT id, ship_date, result, register FROM invoice_auto_runs/.test(q)) return { rows: [run0] }; if (/^(CREATE|ALTER)/.test(q)) return { rows: [] }; throw new Error('모르는 SQL ' + q.slice(0, 80)); } };
      const app = express(); app.use(express.json({ limit: '5mb' })); const auth = (req, res, next) => { req.user = { id: 990937, name: '검증', role: 'staff' }; next(); };
      ia(app, { pool, authMiddleware: auth, adminOnly: auth, writeAudit: async () => {}, adminActor: () => ({ id: 990937, name: '검증' }), ExcelJS: require(path.join(ROOT, 'node_modules', 'exceljs')), lois: {}, fetchers: {}, kstToday: () => '2026-11-02', naverCfgGet: async () => ({ send_enabled: false }), transport: {}, log: console });
      const srv = await new Promise(r => { const x = http.createServer(app).listen(3458, '127.0.0.1', () => r(x)); });
      const res = await fetch('http://127.0.0.1:3458/api/agent-office/invoice-auto/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: 1, picks: { r1: 'manual' } }) }), j = await res.json();
      const it = (j.items || [])[0] || {}; ok(it.state === 'manual' && /거래처 파일/.test(it.error || ''), '등록 응답 수기 줄 error = 카드 사유', j);
      const xl = await fetch('http://127.0.0.1:3458/api/agent-office/invoice-auto/manual/1'); const wb = new (require(path.join(ROOT, 'node_modules', 'exceljs')).Workbook)(); await wb.xlsx.load(Buffer.from(await xl.arrayBuffer())); const why = wb.getWorksheet('발송처리').getRow(2).getCell(7).value;
      ok(/거래처 파일/.test(String(why)), '수기 엑셀 사유 칸 = 카드 사유', why);
      await new Promise(r => srv.close(r)); }

    console.log('⑥ 화면(가짜 api · 390·1280)');
    const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
    const row = (id, rule, more) => Object.assign({ id, channel: 'naver', order_key: '20261101' + id, box_id: '20261101' + id, qty: 1, option: TY, status: 'todo', rule, tracking: null, tracking_all: [], recipient_masked: '가*매 · 끝 0001', recipient_name: '가구매', recipient_tel: BUY, suggest: null, suggest_why: null, pick_options: [] }, more);
    const WHY = '입력삭제 주문인데 운송장을 못 찾았어요 · 거래처 파일을 다 올렸는지·그날 주소 줄이 나갔는지 확인';
    const MK = rows => ({ ok: true, run_id: 9, ship_date: '2026-11-02', files: [{ name: 'x.xlsx', partner: '효돈', rows: 3 }], fetch: { naver: { ok: true, orders: 3 } }, by_channel: { naver: { auto: 1, todo: rows.length, cash: 0, skipped: 0 } }, summary: { shipments: 3, auto: 1, todo: rows.length, cash: 0, extra: 0, unmatched: 0, todo_indiv_none: rows.length, orders_without_tracking: 0, index_upserted: 3 }, rows: [row('r1', 'auto', { status: 'auto', tracking: '612345670001', tracking_all: ['612345670001'] })].concat(rows), cash: [], extra: [], unmatched: [], orders_without_tracking: 0 });
    const page = M => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="file:///${PUB}/styles.css"><link rel="stylesheet" href="file:///${PUB}/theme.css"><link rel="stylesheet" href="file:///${PUB}/final-order.css"></head><body><script>var currentUser={role:'admin',name:'시험'};window.__calls=[];localStorage.setItem('jwt_token','x');localStorage.setItem('jwt_user',JSON.stringify(currentUser));window.showToast=()=>{};window.XLSX={utils:{}};const M=${JSON.stringify(M)};window.api=async(u,m,b)=>{window.__calls.push({u,b});if(/invoice-auto\\/match/.test(u)){if(!b.files||!b.files.length){const e=new Error('없음');e.status=400;throw e;}return M;}if(/invoice-auto\\/register/.test(u))return{ok:true,run_id:9,dry:true,send_enabled:false,ready:{naver:1,coupang:0,cafe24:0},already:0,manual:1,skipped:0,items:[],manual_file:null};const e=new Error('없음');e.status=404;throw e;};</script><script src="file:///${PUB}/final-order-core.js"></script><script src="file:///${PUB}/final-order.js"></script></body></html>`;
    const write = (n, s) => { const p = path.join(TMP, n); fs.writeFileSync(p, s); return 'file:///' + p.split(path.sep).join('/'); };
    const U0 = write('zero.html', page(MK([row('r2', 'todo_indiv_none', { why: WHY })]))), U1 = write('one.html', page(MK([row('r2', 'todo_indiv_none', { why: WHY, pick_options: [{ tracking: '612345670009', recipient_masked: '받*1 · 끝 1111', recipient_name: '받는1', recipient_tel: '010', product: TY }] })])));
    const br = await chromium.launch();
    try {
        for (const [w, h] of [[390, 844], [1280, 900]]) {
            const ctx = await br.newContext({ viewport: { width: w, height: h } }), pg = await ctx.newPage(), errs = [];
            pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
            const go = async u => { await pg.goto(u); await pg.waitForFunction(() => window.AkmFinalOrder && window.AkmInvoiceAuto, null, { timeout: 15000 }); await pg.evaluate(() => window.AkmFinalOrder.open && window.AkmFinalOrder.open()); await pg.waitForSelector('#fo-ia-file', { state: 'attached', timeout: 15000 }); await pg.setInputFiles('#fo-ia-file', [{ name: '제주아꼼이네송장(효돈)11.02.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK fake') }]); await pg.click('#fo-ia-match'); await pg.waitForSelector('[data-ia-id="r2"]', { timeout: 15000 }); };
            await go(U0);
            let s = await pg.evaluate(() => { const c = document.querySelector('[data-ia-id="r2"]'), reg = document.getElementById('fo-ia-reg'); return { sel: !!c.querySelector('select'), t: c.textContent.replace(/\s+/g, ' '), reg: reg && reg.disabled, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
            ok(!s.sel && /채널에서 직접/.test(s.t) && /거래처 파일을 다 올렸는지/.test(s.t), w + ' 옵션 0 카드 = 고르기 없음 · 채널에서 직접 · 사유 글', s.t);
            ok(s.reg === false, w + ' 옵션 0 카드는 [등록] 안 막음', s.reg);
            const s2 = await pg.evaluate(() => { const c = document.querySelector('[data-ia-id="r2"]'); return { st: c.dataset.state, wait: !!c.querySelector('.fo-card-acts .fo-wait'), done: !!c.querySelector('.fo-card-acts .fo-done') }; });
            ok(s2.st === 'open' && s2.wait && !s2.done, w + ' 옵션 0 카드 = 처리됨처럼 안 보임(열림 · 초록 글 0)', s2);
            ok(s.sw <= s.iw, w + ' 가로 넘침 0', [s.sw, s.iw]);
            await pg.click('#fo-ia-reg'); await pg.waitForTimeout(200);
            const body = await pg.evaluate(() => (window.__calls.filter(c => /register/.test(c.u)).pop() || {}).b);
            ok(body && body.picks && body.picks.r2 === 'manual', w + ' 등록 요청 = 그 줄 수기(manual)', body);
            await go(U1);
            s = await pg.evaluate(() => { const c = document.querySelector('[data-ia-id="r2"]'), reg = document.getElementById('fo-ia-reg'); return { sel: !!c.querySelector('select'), n: c.querySelectorAll('select option').length, reg: reg && reg.disabled }; });
            ok(s.sel && s.n === 3 && s.reg === true, w + ' 후보 있는 카드 = 고르기(종전 꼴) · 고르기 전 [등록] 꺼짐', s);
            await pg.selectOption('select[data-ia-pick="r2"]', '612345670009'); s = await pg.evaluate(() => document.getElementById('fo-ia-reg').disabled);
            ok(s === false, w + ' 고르면 [등록] 풀림', s);
            ok(!errs.length, w + ' 스크립트 오류 0', errs);
            await ctx.close();
        }
    } finally { await br.close(); }
    console.log(`\n결과 ${pass}/${pass + fail}`);
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
