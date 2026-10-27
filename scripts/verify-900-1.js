// #900 1단계 검증 — 서버(서비스 줄·no_indiv·for-ship cash_service·짝 제외) + core(boxDiff 품목별 표) + 자동 송장(1-F·1-G) · 실DB·실AI·네트워크 0
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-900-1.js
'use strict';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ''); } };
const OM = require(path.join(ROOT, 'order-memo.js')), core = require(path.join(ROOT, 'public', 'final-order-core.js')), ia = require(path.join(ROOT, 'invoice-auto.js'));
const TY = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', HG = '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)';
const BUY = '010-2600-0167', BD = '01026000167';
const cash = (name, recv, rtel, opt, q, addr, K) => [name, K || BUY, '제주특별자치도 제주시 연삼로 1066-31', recv, opt, String(q), rtel, '', addr, '', K || BUY, '', ''];
(async () => {
    console.log('core cashCheck — 품목별 표 · 서비스 줄 제외');
    const O = [{ key: 'A', digits: BD, qty: 10, individual: true, buyer: '김', opt: TY }, { key: 'B', digits: BD, qty: 4, individual: true, buyer: '김', opt: HG }];
    const C = (opt, q, x) => Object.assign({ no: 2, bang: false, digits: BD, opt, qty: q, addr: 'a', cells: [] }, x || {});
    const b1 = core.cashCheck({ orders: O, cash: [C(TY, 10), C(HG, 3)] }).boxDiff[0];
    ok(b1 && b1.orderQty === 14 && b1.cashQty === 13 && JSON.stringify(b1.rows) === JSON.stringify([{ opt: TY, orderQty: 10, cashQty: 10 }, { opt: HG, orderQty: 4, cashQty: 3 }]), 'boxDiff.rows = 품목별 주문/입력(차이 0 줄 포함 · 주문 품목 먼저)', b1);
    const noOpt = O.map(x => Object.assign({}, x, { opt: undefined }));
    ok(!('rows' in core.cashCheck({ orders: noOpt, cash: [C(TY, 10), C(HG, 3)] }).boxDiff[0]), '주문 opt 없음(옛 호출) = rows 칸 없음(종전 꼴)');
    ok(core.cashCheck({ orders: O, cash: [C(TY, 10), C(HG, 4), C(HG, 2, { service: true })] }).boxDiff.length === 0, 'service 줄 = 대조 밖(남는 2박스가 박스 차이로 안 잡힘)');

    console.log('서버 순수 — markIndiv · pairCash · pairHint · pickForShip');
    const rows = OM.markIndiv([{ kind: 'line', key: BUY, note: '입력o삭제x', line: BUY + ' 입력o삭제x' }, { kind: 'cash', cells: cash('김가우 드림', '받는1', '010-1', TY, 1, '서울 1') }, { kind: 'cash', cells: cash('김가우 드림', '받는2', '010-2', TY, 1, '서울 2'), service: true }, { kind: 'cash', cells: cash('김가우 드림', '받는3', '010-3', TY, 1, '서울 3'), no_indiv: true }]);
    ok(rows[1].indiv === true && rows[2].indiv === false && rows[3].indiv === false, 'markIndiv = 같은 번호라도 service·no_indiv 줄은 건너뜀(주소 줄 아님)', rows.slice(1).map(r => r.indiv));
    ok(OM.pairCash({ kind: 'cash', service: true, cells: cash('김가우 드림!', '받는', '010', TY, 1, 'a') }, { line_key: BUY }, { today: '2026-10-27', catalog: null, origin: '' }) === null, 'pairCash = service 줄은 짝 안 함');
    const hr = (id, e, A, opt, q, K, svc) => ({ id, entry_id: e, kind: 'cash', state: 'open', cells: cash(A, 'r' + id, '010', opt, q, 'a', K), service: !!svc });
    const h = OM.pairHint([{ option: TY, qty: 2 }], [hr(1, 1, '김가우 드림!', TY, 2, '010-9999-0000', true), hr(2, 2, '김가우 드림!', TY, 2, '010-9999-0001')], BUY);
    ok(h.short === 2 && h.groups.length === 1 && h.groups[0].ids.join() === '2', 'pairHint 후보 묶음 = service 줄 묶음 뺌', h);
    const fs1 = OM.pickForShip([{ id: 7, kind: 'cash', state: 'open', sure: true, cells: cash('김가우 드림!', 'a', '010', TY, 1, 'x'), service: true }, { id: 8, kind: 'cash', state: 'open', sure: true, cells: cash('김가우 드림', 'b', '010', TY, 1, 'y') }], '2026-10-27');
    ok(JSON.stringify(fs1.cash_service) === '[7]' && JSON.stringify(fs1.cash_ids) === '[7,8]' && /!$/.test(fs1.cash_aoa[1][0]) && !/!/.test(fs1.cash_aoa[2][0]), 'for-ship = cash_service [7] · 서비스 줄 A칸 「!」 · 주소 줄 그대로', { cs: fs1.cash_service, ids: fs1.cash_ids, a: fs1.cash_aoa.slice(1).map(r => r[0]) });

    console.log('자동 송장 1-F·1-G(입력삭제 길)');
    const AD0 = '서울특별시 가짜구 집로 1';
    const nv = (pid, opt, q, addr) => ({ _pid: pid, '구매자연락처': BUY, '수취인명': '김가우', '수취인연락처1': BUY, '통합배송지': addr || AD0, '옵션정보': '아꼼이네 상품선택: 1. (제철)' + opt, '수량': q });
    const cf = (oid, opt, q, addr) => ({ _orderId: oid, _itemCode: 'I' + oid, '수령인': '김가우', '수령인 휴대전화': BUY, '수령인 주소(전체)': addr || AD0, '주문자 휴대전화': BUY, '주문상품명(세트상품 포함)': opt, '수량': q });
    let t = 681000900000; const sh = (nm, ad, op, sn) => ({ tr: String(++t), nm, tel: '010-3300-' + String(t % 10000).padStart(4, '0'), ad, op, q: 1, sn: sn || '김가우 드림', stel: BUY });
    const run = (orders, ships, ind) => ia.matchShipments({ ships: ia.normShips(ships), orders, pricingNames: [TY, HG], indivKeys: ind });
    const R = m => Object.fromEntries(m.assign.map(x => [x.o.order_key, x.rule + ':' + x.ships.map(s => s.tracking.slice(-2)).join('.')]));
    // F-1 같은 품목 입력삭제 주문 둘 · 주소 줄 4장 · 주소 안 맞음 → 주문마다 서로 다른 1장 · 남는 2장 extra
    t = 681000900000; const s1 = [sh('받는1', '부산 1', TY), sh('받는2', '부산 2', TY), sh('받는3', '부산 3', TY), sh('받는4', '부산 4', TY)];
    const o1 = ia.normOrders('naver', [nv('A', TY, 2), nv('B', TY, 2)]);
    const m1o = run(o1, s1);
    ok(m1o.todos.length === 2 && !m1o.assign.length, 'F 종전(목록 없음) = 할 일 2 그대로', { todo: m1o.todos.length, a: R(m1o) });
    const m1 = run(ia.normOrders('naver', [nv('A', TY, 2), nv('B', TY, 2)]), s1, ['naver:A', 'naver:B']);
    ok(!m1.todos.length && R(m1).A === 'indiv_any:01' && R(m1).B === 'indiv_any:02' && m1.extra.length === 2, 'F 목록 있음 = 주문마다 서로 다른 1장(indiv_any) · 할 일 0 · 남는 2장 extra', { a: R(m1), todo: m1.todos.length, extra: m1.extra.length });
    // F-2 한 주문만 주소 맞음 → 그 주문 = 그 줄 · 다른 주문 = 남은 줄
    t = 681000900000; const s2 = [sh('받는1', '부산 1', TY), sh('김가우', '서울특별시 가짜구 B집 2', TY), sh('받는3', '부산 3', TY)];
    const m2 = run(ia.normOrders('naver', [nv('A', TY, 1), nv('B', TY, 1, '서울특별시 가짜구 B집 2')]), s2, ['naver:A', 'naver:B']);
    ok(R(m2).B === 'indiv_store_addr:02' && R(m2).A === 'indiv_any:01' && !m2.todos.length, 'F 한 주문만 주소 맞음 = 그 줄(indiv_store_addr) · 나머지 = 남은 줄 1장', R(m2));
    // F-3 다른 품목은 그대로 품목으로 가름
    t = 681000900000; const s3 = [sh('받는1', '부산 1', HG), sh('받는2', '부산 2', TY)];
    const m3 = run(ia.normOrders('naver', [nv('A', TY, 1), nv('B', HG, 1)]), s3, ['naver:A', 'naver:B']);
    ok(R(m3).A === 'indiv_any:02' && R(m3).B === 'indiv_any:01', 'F 품목 다른 두 주문 = 품목 맞는 줄', R(m3));
    // G 자사몰 개인결제창(품목 글이 단가표에 없음 · 수량 1) · 그 번호 자사몰 입력삭제 1건 → 품목 안 보고 1장 · 나머지 extra · 현금 장 그대로
    t = 681000900000; const s4 = Array.from({ length: 5 }, (_, i) => sh('받는' + i, '대구 ' + i, '고당도 타이벡감귤 / 상품 및 과수: 선물용 - 3kg')).concat([sh('현금손님', '광주 1', TY, '현금손님 드림!')]);
    const c4 = () => ia.normOrders('cafe24', [cf('20261027-0000025', '6385님 개인결제창 타이벡감귤=선물용 3kg 20박스', 1)]);
    const m4o = run(c4(), s4);
    ok(!m4o.assign.length, 'G 종전(목록 없음) = 운송장 0(품목 안 맞음)', R(m4o));
    const m4 = run(c4(), s4, ['cafe24:20261027-0000025|I20261027-0000025']);
    ok(Object.values(R(m4)).join() === 'indiv_any:01' && m4.extra.length === 4 && m4.cash.length === 1, 'G 목록 있음 = 품목 안 보고 1장(작은 번호) · 나머지 4장 extra · 현금 1장 그대로', { a: R(m4), extra: m4.extra.length, cash: m4.cash.length });
    // G 자사몰 2건 → 품목 맞는 줄 먼저 · 없으면 아무 줄 · 서로 다른 줄
    t = 681000900000; const s5 = [sh('받는1', '대구 1', '개인결제 선물'), sh('받는2', '대구 2', TY), sh('받는3', '대구 3', '개인결제 선물')];
    const m5 = run(ia.normOrders('cafe24', [cf('X1', TY, 1), cf('X2', '개인결제창 2', 1)]), s5, ['cafe24:X1|IX1', 'cafe24:X2|IX2']);
    ok(R(m5)['X1|IX1'] === 'indiv_any:02' && R(m5)['X2|IX2'] === 'indiv_any:01', 'G 자사몰 2건 = 품목 맞는 주문은 그 줄 · 다른 주문은 남은 줄(서로 다름)', R(m5));
    // G 손질①(aa 점검) 같은 구매자의 목록 밖 운송장 없는 주문(네이버 TY · 뒤 날짜 등) 품목 운송장은 자사몰이 안 집음
    const nvX = (pid, opt) => Object.assign(nv(pid, opt, 1), { '수취인명': '딴분', '수취인연락처1': '010-7777-0001', '통합배송지': '인천 딴곳 1' });
    t = 681000900000; const s7 = [sh('받는TY', '대구 1', TY), sh('받는P', '대구 2', '개인결제 선물')];
    const o7 = ia.normOrders('naver', [nvX('N', TY)]).concat(ia.normOrders('cafe24', [cf('C1', '6385님 개인결제창', 1)]));
    const m7 = run(o7, s7, ['cafe24:C1|IC1']);
    ok(R(m7)['C1|IC1'] === 'indiv_any:02' && R(m7).N === 'indiv_any:01' && !m7.todos.length, 'G 자사몰 1건 품목 무시 = 목록 밖 네이버 주문 품목(TY) 운송장은 빼고 남은 줄 · TY 는 그 네이버 주문에', R(m7));
    t = 681000900000; const s8 = [sh('받는TY', '대구 1', TY)];
    const m8 = run(ia.normOrders('naver', [nvX('N', TY)]).concat(ia.normOrders('cafe24', [cf('C1', '6385님 개인결제창', 1)])), s8, ['cafe24:C1|IC1']);
    ok(!R(m8)['C1|IC1'] && m8.todos.some(x => x.o.order_key === 'C1|IC1' && x.rule === 'todo_pick') && R(m8).N === 'indiv_any:01', 'G 남은 게 다른 주문 품목 운송장뿐 = 자사몰 주문은 할 일(todo_pick) · 그 운송장은 네이버 주문에', { a: R(m8), todo: m8.todos.map(x => x.o.order_key + ':' + x.rule) });
    // 목록에 없는 주문 = 종전(F 안 씀) · 받는 분 짝 그대로
    t = 681000900000; const s6 = [Object.assign(sh('김가우', AD0, TY, '김가우(제주아꼼이네)'), { tel: BUY })];   // 받는 분 이름·번호·주소 = 주문과 같음
    const m6 = run(ia.normOrders('naver', [nv('H', TY, 1)]), s6, ['naver:Z']);
    ok(R(m6).H === 'auto:01', '목록 밖 일반 주문 = 받는 분 짝(auto) 그대로', R(m6));

    const PGL = process.env.PGLITE_DIR;
    if (PGL) {
        console.log('서버 API(pglite) — 저장 service/no_indiv · PUT · POST /service');
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
        let ROLE = 'staff';
        const auth = (req, res, next) => { req.user = { id: 990901, name: '검증', position: '', role: ROLE }; next(); };
        const api = OM.mount(app, { pool, authMiddleware: auth, writeAudit: async () => {}, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }),
            cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => '2026-10-27', noTimers: true, anthropic: null,
            shipCal: async () => ({ realToday: '2026-10-27', shipDays: ['2026-10-27'], suggested: '2026-10-27' }) });
        const PORT = Number(process.env.PORT901) || 3477, srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, () => r(s)); });
        const call = async (m, u, b) => { const r = await fetch('http://127.0.0.1:' + PORT + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
        try {
            await api.ensure(); await new Promise(r => setTimeout(r, 200));
            const sv = await call('POST', '/api/order-memo', { raw: '시험', rows: [{ kind: 'line', key: BUY, note: '입력o삭제x', line: BUY + ' 입력o삭제x', src: 'rule' },
                { kind: 'cash', cells: cash('김가우 드림', '받는1', '010-3300-0001', TY, 1, '서울특별시 가짜구 받는로 1') },
                { kind: 'cash', cells: cash('김가우 드림', '받는2', '010-3300-0002', TY, 1, '서울특별시 가짜구 받는로 2'), service: true },
                { kind: 'cash', cells: cash('김가우 드림', '받는3', '010-3300-0003', TY, 1, '서울특별시 가짜구 받는로 3'), no_indiv: true }] });
            const cs = (sv.j.rows || []).filter(r => r.kind === 'cash');
            ok(sv.s === 200 && cs.length === 3, '저장 200 · 현금 줄 3', sv);
            ok(cs[0].indiv === true && cs[0].service === false && !/!/.test(cs[0].cells[0]), '보통 줄 = 주소 줄(「!」 없음 · service false)', cs[0] && cs[0].cells[0]);
            ok(cs[1].indiv === false && cs[1].service === true && /드림!$/.test(cs[1].cells[0]), 'service:true = 같은 번호라도 주소 줄 아님 · A칸 「!」 · service true', cs[1] && [cs[1].cells[0], cs[1].service]);
            ok(cs[2].indiv === false && cs[2].service === false && /드림!$/.test(cs[2].cells[0]), 'no_indiv:true = 현금 「!」 그대로 · service false', cs[2] && [cs[2].cells[0], cs[2].service]);
            const fsh = await call('GET', '/api/order-memo/for-ship?date=2026-10-27');
            ok(fsh.s === 200 && JSON.stringify(fsh.j.cash_service) === JSON.stringify([cs[1].id]), 'for-ship cash_service = 서비스 줄 id 하나', fsh.j.cash_service);
            const off = await call('PUT', '/api/order-memo/rows/' + cs[1].id, { service: false });
            ok(off.s === 200 && off.j.row.service === false && off.j.row.indiv === true && !/!/.test(off.j.row.cells[0]), 'PUT service:false = 「!」 뗌 → 주소 줄', off.j.row && [off.j.row.cells[0], off.j.row.service]);
            const on = await call('PUT', '/api/order-memo/rows/' + cs[1].id, { service: true });
            ok(on.s === 200 && on.j.row.service === true && /드림!$/.test(on.j.row.cells[0]), 'PUT service:true = 다시 서비스(「!」)', on.j.row && on.j.row.cells[0]);
            const keep = await call('PUT', '/api/order-memo/rows/' + cs[1].id, { cells: Object.assign(on.j.row.cells.slice(), { 5: '2' }) });
            ok(keep.s === 200 && keep.j.row.service === true && /드림!$/.test(keep.j.row.cells[0]) && keep.j.row.cells[5] === '2', 'service 칸 없이 고치기 = 서비스 그대로', keep.j.row && [keep.j.row.cells[0], keep.j.row.cells[5], keep.j.row.service]);
            const bad = await call('PUT', '/api/order-memo/rows/' + cs[2].id, { service: true });
            ok(bad.s === 400, '현금 손님 줄(「!」)에 서비스 켜기 = 400', bad);
            const pon = await call('POST', '/api/order-memo/service', { ids: [cs[0].id, cs[2].id, cs[1].id, 999999], on: true });
            ok(pon.s === 200 && pon.j.n === 1 && pon.j.rows[0].id === cs[0].id && pon.j.rows[0].service && /드림!$/.test(pon.j.rows[0].cells[0]) && pon.j.skipped.map(x => x.why).join() === '현금 손님 줄,이미 서비스,없는 줄', 'POST /service on = 주소 줄만 켬 · 나머지 skipped(현금 손님·이미·없는 줄)', pon.j);
            const poff = await call('POST', '/api/order-memo/service', { ids: [cs[0].id, cs[1].id], on: false });
            ok(poff.s === 200 && poff.j.n === 2 && poff.j.rows.every(r => !r.service && r.indiv && !/!/.test(r.cells[0])), 'POST /service off = 두 줄 주소 줄로', poff.j);
            ok((await call('POST', '/api/order-memo/service', { ids: [cs[0].id] })).s === 400, 'on 없음 = 400');
            ROLE = 'accountant'; ok((await call('POST', '/api/order-memo/service', { ids: [cs[0].id], on: true })).s === 403, '세무사 = 403'); ROLE = 'staff';
            await call('POST', '/api/order-memo/service', { ids: [cs[0].id], on: true });
            const pr = await call('POST', '/api/order-memo/pair', { key: BUY, ids: [cs[0].id, cs[2].id] });
            ok(pr.s === 200 && pr.j.n === 1 && pr.j.rows[0].id === cs[2].id, '짝 = 서비스 줄은 건너뜀(현금 손님 줄만 짝)', pr.j);
        } finally { srv.close(); }
    } else console.log('  (PGLITE_DIR 없음 — API 건너뜀)');
})().then(() => { console.log(`\n결과 ${pass}/${pass + failN}`); process.exit(failN ? 1 : 0); }).catch(e => { console.error(e); process.exit(1); });
