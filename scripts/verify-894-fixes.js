// #894 검증 — 입력삭제 길 손질 F2(자동 송장 입력삭제 주문 빼기·수량 딱 맞는 주문) · F3(현금 대조 품목별) · F4(짝 후보 pair-hint · pick 짝) · 실DB·실AI·네트워크 0
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-894-fixes.js    (F1 = 최종발주 화면 카드 = 실렌더 시험 · 스크래치 ui894.js)
'use strict';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const core = require(path.join(ROOT, 'public', 'final-order-core.js')), ia = require(path.join(ROOT, 'invoice-auto.js')), OM = require(path.join(ROOT, 'order-memo.js'));
const TY = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', HG = '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)';
const BUY = '010-2600-0167', AD = '경기도 광명시 광이로 96 209동 105호';
(async () => {
    console.log('F3 현금 대조 품목별');
    const C = (opt, q, bang) => ({ no: 2, bang: !!bang, digits: '01026000167', opt, qty: q, addr: 'x', cells: [] });
    const O = [{ key: 'A', digits: '01026000167', qty: 10, individual: true, buyer: '김', opt: TY }, { key: 'B', digits: '01026000167', qty: 4, individual: true, buyer: '김', opt: HG }];
    const d1 = core.cashCheck({ orders: O, cash: [C(TY, 11), C(HG, 3)] });
    ok(d1.itemDiff.length === 1 && d1.boxDiff.length === 0 && d1.itemDiff[0].rows.map(r => r.orderQty + '/' + r.cashQty).join() === '10/11,4/3', '합 14 = 14 · 품목 10/11·4/3 = itemDiff 1(박스 수 카드 아님)', d1.itemDiff);
    ok(core.cashCheck({ orders: O, cash: [C(TY, 10), C(HG + ' 13과로!', 4)] }).itemDiff.length === 0, '품목 같음(현금 줄 끝 꼬리 「13과로!」 뗌) = 0');
    const noOpt = core.cashCheck({ orders: O.map(x => Object.assign({}, x, { opt: undefined })), cash: [C(TY, 11), C(HG, 3)] });
    const base = core.cashCheck({ orders: O.map(x => Object.assign({}, x, { opt: undefined })), cash: [C(TY, 11), C(HG, 3)] });
    ok(noOpt.itemDiff.length === 0 && JSON.stringify(Object.assign({}, noOpt, { itemDiff: undefined })) === JSON.stringify(Object.assign({}, base, { itemDiff: undefined })), '주문에 opt 없음(옛 호출) = itemDiff 0 · 나머지 종전 그대로');
    ok(core.cashCheck({ orders: O, cash: [C(TY, 12), C(HG, 3)] }).itemDiff.length === 0, '박스 합 다르면 = boxDiff 쪽만(itemDiff 0)');

    console.log('F2 자동 송장');
    const ord = (pid, opt, q) => ({ _pid: pid, '구매자연락처': BUY, '수취인명': '김가우', '수취인연락처1': BUY, '통합배송지': AD, '옵션정보': '아꼼이네 상품선택: 1. (제철)' + opt, '수량': q });
    let t = 680000900000; const sh = (nm, tel, ad, op, sn, stel) => ({ tr: String(++t), nm, tel, ad, op, q: 1, sn, stel });
    const orders = ia.normOrders('naver', [ord('A', TY, 10), ord('B', HG, 4), ord('H', HG, 2)]);
    const ships = [];
    for (let i = 0; i < 10; i++) ships.push(sh('받는' + i, '010-3300-10' + String(i).padStart(2, '0'), '서울 가짜구 ' + i, TY, '김가우 드림', BUY));
    for (let i = 0; i < 4; i++) ships.push(sh('받는h' + i, '010-3300-20' + String(i).padStart(2, '0'), '부산 가짜구 ' + i, HG, '김가우 드림', BUY));
    ships.push(sh('김가우', BUY, AD, HG, '김가우(제주아꼼이네)', BUY), sh('김가우', BUY, AD, HG, '김가우(제주아꼼이네)', BUY));
    const rule = m => Object.fromEntries(m.assign.map(a => [a.o.order_key, a.rule + ':' + a.ships.length]));
    const m0 = ia.matchShipments({ ships: ia.normShips(ships), orders, pricingNames: [TY, HG] });
    ok(!/same_item_qty/.test(JSON.stringify(rule(m0))) && rule(m0).B === 'same_item_any:2' && rule(m0).A === 'indiv_any:1' && rule(m0).H === 'indiv_any:1', '손질① 입력삭제 목록 없음(옛 화면·빈 localStorage) = F2 전과 같음(same_item_qty 안 씀 · 집 박스는 종전 나눔 · HEAD 판과 대조함)', rule(m0));
    const m1 = ia.matchShipments({ ships: ia.normShips(ships), orders, pricingNames: [TY, HG], indivKeys: ['naver:A', 'naver:B'] });
    ok(rule(m1).H === 'auto_multi:2' && rule(m1).A === 'indiv_any:1' && rule(m1).B === 'indiv_any:1' && !m1.todos.length, '입력삭제 목록 있음 = A·B 는 받는 분 짝에서 빠짐 → H = 자기 운송장 2장(auto_multi) · A·B indiv_any', rule(m1));
    // 종전 꼴 무회귀: 같은 분 같은 품목 1박스 주문 둘 · 운송장 2장 = 그대로 나눔
    const o2 = ia.normOrders('naver', [ord('X', TY, 1), ord('Y', TY, 1)]), s2 = [sh('김가우', BUY, AD, TY, '김가우(제주아꼼이네)', BUY), sh('김가우', BUY, AD, TY, '김가우(제주아꼼이네)', BUY)];
    const r2 = rule(ia.matchShipments({ ships: ia.normShips(s2), orders: o2, pricingNames: [TY] }));
    ok(r2.X === 'same_item_any:1' && r2.Y === 'same_item_any:1', '같은 품목 1박스 둘 · 운송장 2(모자라지 않음) = 종전 나눔 그대로', r2);
    const o3 = ia.normOrders('naver', [ord('X', TY, 2), ord('Y', TY, 1)]), s3 = s2.slice();
    const r3 = rule(ia.matchShipments({ ships: ia.normShips(s3), orders: o3, pricingNames: [TY], indivKeys: ['naver:Z'] }));
    ok(r3.X === 'same_item_qty:2' && !r3.Y, '입력삭제 목록 받은 날 · 운송장이 모자라고(2 < 3) 수량 딱 맞는 주문 하나(X 2) = X 에 2장 · Y 는 운송장 없음(사람 확인)', r3);
    const r3o = rule(ia.matchShipments({ ships: ia.normShips(s3), orders: o3, pricingNames: [TY] }));
    ok(!/same_item_qty/.test(JSON.stringify(r3o)), '손질① 같은 꼴 · 입력삭제 목록 없음 = 종전 나눔(same_item_qty 0)', r3o);
    const r2i = rule(ia.matchShipments({ ships: ia.normShips(s2), orders: o2, pricingNames: [TY], indivKeys: ['naver:Z'] }));
    ok(r2i.X === 'same_item_any:1' && r2i.Y === 'same_item_any:1', '손질① 목록 있어도 운송장 안 모자라면 = 종전 나눔', r2i);

    console.log('F4 짝 후보');
    const row = (id, e, at, opt, q, bang, k) => ({ id, entry_id: e, entry_created_at: at, kind: 'cash', state: 'open', cells: [bang ? '김가우 드림!' : '김가우 드림', '', '', 'r', opt, String(q), '', '', '', '', k || '010-3300-0001', '', ''] });
    const po = [{ option: '아꼼이네 상품선택: 1. (제철)' + TY, qty: 10 }, { option: '아꼼이네 상품선택: 3. (제철)' + HG, qty: 4 }];
    const h1 = OM.pairHint(po, [row(1, 1, '2026-10-27T01:00:00Z', TY, 4, 1), row(2, 1, '2026-10-27T01:00:00Z', TY, 6, 1), row(3, 1, '2026-10-27T01:00:00Z', HG, 4, 1), row(4, 2, '2026-10-27T02:00:00Z', TY, 10, 1), row(5, 2, '2026-10-27T02:00:00Z', HG, 3, 1)], BUY);
    ok(h1.short === 14 && h1.groups.length === 1 && h1.groups[0].ids.join() === '1,2,3', '품목별 박스가 딱 맞는 묶음만 후보(1번 묶음 · 2번 묶음은 황금향 3 이라 빠짐)', h1);
    const h2 = OM.pairHint(po.concat([{ option: '1. (제철)' + TY, qty: 3 }]), [row(1, 1, 'a', TY, 10, 0, BUY), row(2, 1, 'a', HG, 4, 0, BUY), row(8, 4, 'b', TY, 1, 1), row(9, 4, 'b', TY, 2, 1)], BUY);
    ok(h2.paired_boxes === 14 && h2.short === 3 && h2.groups.length === 1 && h2.groups[0].ids.join() === '8,9', '이미 주소 줄 14 짝 · 새 주문 3 = short 3 · 남은 3박스(타이벡) 묶음 후보', h2);
    ok(OM.pairHint(po, [row(1, 1, 'a', TY, 10, 0, BUY), row(2, 1, 'a', HG, 4, 0, BUY)], BUY).short === 0, '다 짝 됨 = short 0 · 후보 0');
    const L = { line_key: BUY, ship_date: null }, ctx = { today: '2026-10-27', catalog: new Set([TY, HG]), origin: 'O' };
    const ai = { kind: 'cash', src: 'ai', cells: ['김가우 드림!', '010-3300-0009', 'O', 'r', TY, '1', '010-3300-0009', '', '서울 1', '', '010-3300-0009', '', ''] };
    ok(OM.pairCash(ai, L, ctx) === null, 'pick 없음 = 종전(번호 다르면 짝 안 함)');
    const pk = OM.pairCash(ai, L, ctx, { anyNumber: true });
    ok(pk && pk.indiv && pk.cells[10] === BUY && pk.cells[1] === BUY && pk.cells[0] === '김가우 드림', 'pick = 번호 달라도 짝(K = 그 번호 · B 가 옛 K 였으니 B 도)', pk && pk.cells);

    // API(pglite) — pair-hint 라우트 · pair pick
    const PGL = process.env.PGLITE_DIR;
    if (PGL) {
        const { PGlite } = require(path.join(PGL, 'node_modules', '@electric-sql', 'pglite')), express = require(path.join(ROOT, 'node_modules', 'express'));
        const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
        const db = new PGlite(), conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
        const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; };
        const pool = { query: q, connect: async () => ({ query: q, release() {} }) };
        await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
        await db.query(`INSERT INTO pricing (partner, start_date, end_date, items) VALUES ('대성', '2026-01-01', '2026-12-31', $1)`, [JSON.stringify([TY, HG].map(n => ({ name: n, price: 1 })))]);
        await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false, result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
        for (const x of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(x);
        const app = express(); app.use(express.json());
        const auth = (req, res, next) => { req.user = { id: 990894, name: '검증', position: '', role: 'staff' }; next(); };
        const api = OM.mount(app, { pool, authMiddleware: auth, writeAudit: async () => {}, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }),
            cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => '2026-10-27', noTimers: true, anthropic: null,
            shipCal: async () => ({ realToday: '2026-10-27', shipDays: ['2026-10-27'], suggested: '2026-10-27' }) });
        const PORT = Number(process.env.PORT894) || 3475, srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, () => r(s)); });
        const call = async (m, u, b) => { const r = await fetch('http://127.0.0.1:' + PORT + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
        try {
            await api.ensure(); await new Promise(r => setTimeout(r, 200));
            await db.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_digits, recv_digits, option_text, qty) VALUES ('naver','A','A','01026000167','01026000167',$1,10),('naver','B','B','01026000167','01026000167',$2,4)`, ['아꼼이네 상품선택: 1. (제철)' + TY, '아꼼이네 상품선택: 3. (제철)' + HG]);
            const mk = (opt, q, n) => ({ kind: 'cash', src: 'ai', cells: ['김가우 드림!', '010-3300-00' + n, 'O', '받는' + n, opt, String(q), '010-3300-00' + n, '', '서울 가짜구 ' + n, '', '010-3300-00' + n, '', ''] });
            const e1 = await call('POST', '/api/order-memo', { raw: '주문입력', rows: [mk(TY, 4, 11), mk(TY, 6, 12), mk(HG, 4, 13)] });
            const e2 = await call('POST', '/api/order-memo', { raw: BUY + ' 입력o삭제x 네이버', rows: [{ kind: 'line', key: BUY, note: '입력o삭제x', plat: '네이버', line: BUY + ' 입력o삭제x 네이버', src: 'rule' }] });
            const hh = await call('GET', '/api/order-memo/pair-hint?key=' + BUY);
            ok(hh.s === 200 && hh.j.orders.length === 2 && hh.j.short === 14 && hh.j.groups.length === 1 && hh.j.groups[0].ids.join() === e1.j.rows.map(r => r.id).join(), 'GET pair-hint = 주문 2 · 남은 14 · 후보 묶음 1(주문입력 3줄)', hh.j);
            const np = await call('POST', '/api/order-memo/pair', { key: BUY, ids: hh.j.groups[0].ids });
            ok(np.s === 200 && np.j.n === 0, 'pick 없이 POST pair = 0(번호 달라서 · 종전)', np.j);
            const pp = await call('POST', '/api/order-memo/pair', { key: BUY, ids: hh.j.groups[0].ids, pick: true });
            ok(pp.s === 200 && pp.j.n === 3 && pp.j.rows.every(r => r.indiv && r.cells[10] === BUY && r.entry_id === e2.j.entry_id), 'pick:true = 3줄 주소 줄로 짝 · 입력삭제 줄 묶음으로', pp.j);
            const h3 = await call('GET', '/api/order-memo/pair-hint?key=' + BUY);
            ok(h3.j.short === 0 && h3.j.paired_boxes === 14 && h3.j.groups.length === 0, '짝 뒤 pair-hint = 남은 0 · 후보 0', h3.j);
            ok((await call('GET', '/api/order-memo/pair-hint?key=abc')).s === 400, '번호 꼴 아님 = 400');
            const un = await call('POST', '/api/order-memo/pair', { undo: true, rows: pp.j.undo });
            ok(un.j.n === 3, 'pick 짝도 되돌리기 = 3');
        } finally { srv.close(); }
    } else console.log('  (PGLITE_DIR 없음 — API 건너뜀)');
    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
