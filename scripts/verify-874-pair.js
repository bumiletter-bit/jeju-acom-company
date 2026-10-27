// #874 검증 — 입력삭제 번호 ↔ 현금(「!」) 줄 짝짓기(묻고 → 누를 때만) · 실DB·실AI·네트워크 0
//   DB = 이 PC 메모리 안 Postgres(pglite · 실제 SQL 그대로) · 서버 = express 를 이 스크립트 안에서 띄움(포트 3472 · 로그인 가짜)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-874-pair.js
//   자료 = 10/26 밤 실제 꼴(현금 6줄 먼저 저장 → 7분 뒤 입력삭제 줄 따로 저장 · 이름·번호는 가짜로 바꿈)
//   ① 서버 pairCash(순수) ② API: 짝 전 최종발주 = cmiss 카드 · [바꾸기] 뒤 = 카드 0 · 자동 송장 indiv_any 1장 · 안 고른/안 맞는 줄 바이트 동일 · 되돌리기 = 바이트 동일 · #868 날짜 짝 따라감
//   ③ 같은 카드(미리보기) 짝짓기 = 고른 줄만 주소 줄 · 안 고른 줄 = 손대지 않은 저장과 바이트 동일 ④ 화면 묻기 글(pairHtml · 실제 ao-ordermemo.js 를 떼어 실행) — 현금파일 놓고 입력삭제만 = 묻기 0
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ''); } };
const PGL = process.env.PGLITE_DIR;
if (!PGL) { console.log('PGLITE_DIR 가 없어요 — npm i @electric-sql/pglite 한 폴더를 주세요'); process.exit(2); }
const { PGlite } = require(path.join(PGL, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const OM = require(path.join(ROOT, 'order-memo.js'));
const core = require(path.join(ROOT, 'public', 'final-order-core.js'));
const ia = require(path.join(ROOT, 'invoice-auto.js'));
const PORT = Number(process.env.PORT874) || 3472;

const OPT = '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)';
const OTHER = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)';
const CAT = [OPT, OTHER];
const ORIGIN = '제주특별자치도 제주시 연삼로 1066-31, 제주아꼼이네';
const BUY = '010-2600-0167';   // 가짜 구매자 번호(실자료 꼴 · 끝 0167)
const RECV = [['송가윤', '010-4700-6582', '경기도 과천시 관문로 166, 1005동 505호'], ['송가기', '010-8800-6582', '대전광역시 서구 월평북로 13, 210동 103호'], ['조가환', '010-9100-6582', '충북 청주시 흥덕구 서현로 66 105동 1902호'],
    ['김가정', '010-3200-0167', '경기도 안양시 동안구 관악대로 121 106동 104호'], ['진가순', '010-3300-0255', '경기도 부천시 원미구 중동로 204, 1312동 1802호'], ['김가효', '010-2500-0167', '서울시 서초구 효령로 391 105동 701호']];
// 실DB 63~68 칸 꼴: A = 「김가우 드림!」 · B = 받는 분 번호 · K = 구매자 번호
const cashCells = ([nm, tel, ad]) => ['김가우 드림!', tel, ORIGIN, nm, OPT, '1', tel, '', ad, '문 앞에 놓아주세요', BUY, '', ''];
const OTHER_CASH = ['제주아꼼이네!', '010-7500-2233', ORIGIN, '이가식', OTHER, '1', '010-7500-2233', '', '전남 여수시 여천길 45-7', '', '010-7500-2233', '', ''];
const ORD = { pid: '2026102610968421', conv: { '구매자명': '김가우', '구매자연락처': BUY, '수취인명': '김가우', '수취인연락처1': BUY, '통합배송지': '경기도 광명시 광이로 96 209동 105호', '옵션정보': OPT, '수량': 6 } };
const ORD2 = { pid: '2026102699990001', conv: { '구매자명': '박다른', '구매자연락처': '010-5555-0001', '수취인명': '박다른', '수취인연락처1': '010-5555-0001', '통합배송지': '서울 가짜구 다른로 1', '옵션정보': OTHER, '수량': 1 } };

// 최종발주 판정(sim870 꼴 · invoice-v2 parseLines·applyLines 떼어 실행) + 현금파일 대조 + 자동 송장 짝
const src = fs.readFileSync(path.join(ROOT, 'public', 'invoice-v2.js'), 'utf8').replace(/\r\n/g, '\n');
const cut = (s, a0, end) => { const a = s.indexOf(a0); if (a < 0) throw new Error('없음 ' + a0); const b = s.indexOf(end, a); return s.slice(a, b + end.length); };
const V2 = new Function('matchKey', [cut(src, 'const isoOf = ', ';\n'), cut(src, 'function parseDate(s, today) {', '\n    }\n'), cut(src, 'const chOfText = ', ';\n'),
    cut(src, 'function parseLines(txt, boxCh, today) {', '\n        return out;\n    }\n'), cut(src, '    function applyLines(ctx, force = true) {', '\n        });\n    }\n')].join('\n') + '\nreturn { parseLines, applyLines };');
const telOf = e => String(e.conv['구매자연락처'] || '').replace(/\D/g, '');
const v2 = V2((ctx, e, digits, key) => (digits.length >= 8 && telOf(e) === digits) || (key && [e.pid].includes(key)));
function finalOrder(fs1, date) {
    const prep = core.prepLines(fs1.memo_text, { realToday: date, shipDate: date });
    const ctx = { today: date, allowIndiv: true, merged: [ORD, ORD2].map(o => Object.assign({ ch: 'naver', excluded: false, userTouched: false, memoFlag: null }, JSON.parse(JSON.stringify(o)))) };
    const all = v2.parseLines(prep.v2Text, 'naver', date); ctx.lines = { naver: [], cafe24: [], coupang: [] }; all.forEach(l => { if (!l.bad) ctx.lines[l.ch].push(l); }); ctx.allLines = all;
    v2.applyLines(ctx);
    const cash = fs1.cash_aoa.length ? core.parseCash(fs1.cash_aoa) : { ok: true, rows: [] };
    const chk = core.cashCheck({ orders: ctx.merged.map(e => ({ key: e.pid, digits: telOf(e), qty: Number(e.conv['수량']), individual: !!e.individual, excluded: !!e.excluded, buyer: e.conv['구매자명'] })), cash: cash.rows });
    let i = 0;   // 그날 택배사 양식 = 현금파일 줄(1줄 = 1박스) + 일반 주문 → LOIS 시트2(보내는분 = A칸 · 보내는분전화 = K칸 · 838B 실측)
    const ships = cash.rows.map(r => ({ tr: '68000000' + String(1000 + (++i)), partner: '대성', nm: r.cells[3], tel: r.cells[6], ad: r.cells[8], op: r.cells[4], q: 1, sn: r.cells[0], stel: r.cells[10] }));
    ships.push({ tr: '680000002001', partner: '대성', nm: '박다른', tel: '010-5555-0001', ad: '서울 가짜구 다른로 1', op: OTHER, q: 1, sn: '박다른(제주아꼼이네)', stel: '010-5555-0001' });
    const os = ia.normOrders('naver', [ORD, ORD2].map(o => Object.assign({ _pid: o.pid }, o.conv, { '옵션정보': '아꼼이네 상품선택: 3. (제철)' + o.conv['옵션정보'] })));
    const m = ia.matchShipments({ ships: ia.normShips(ships), orders: os, pricingNames: CAT });
    return { indiv: ctx.merged.find(e => e.pid === ORD.pid).individual, cash, chk, m };
}
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) {
    const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
    const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; };
    return { query: q, connect: async () => ({ query: q, release() {} }) };
}

(async () => {
    const T = '2026-10-26', SHIP = '2026-10-27';
    const ctx = { today: T, catalog: new Set(CAT), origin: ORIGIN };
    console.log('① pairCash(순수)');
    const LINE = { line_key: BUY, ship_date: null };
    const base = OM.checkRow({ kind: 'cash', cells: cashCells(RECV[0]), src: 'edit' }, ctx);
    const p = OM.pairCash(Object.assign({ kind: 'cash' }, base), LINE, ctx);
    ok(p && p.indiv && p.cells[0] === '김가우 드림' && p.cells[10] === BUY && p.cells[1] === RECV[0][1] && p.sure, '「!」 현금 줄 + K = 그 번호 → 주소 줄(! 뗌 · K 그 번호 · 사람이 넣은 B 그대로)', p);
    ok(OM.pairCash(Object.assign({ kind: 'cash' }, OM.checkRow({ kind: 'cash', cells: OTHER_CASH, src: 'edit' }, ctx)), LINE, ctx) === null, '번호가 다른 현금 줄 = 안 바꿈(null)');
    ok(OM.pairCash(Object.assign({ kind: 'cash' }, p), LINE, ctx) === null, '이미 주소 줄(「!」 없음) = 안 바꿈(null)');
    const viaB = OM.checkRow({ kind: 'cash', cells: ['홍가동 드림!', BUY, ORIGIN, '받음', OPT, '1', '010-1000-2000', '', '서울 가짜구 1', '', '010-1000-2000', '', ''], src: 'edit' }, ctx);
    const pB = OM.pairCash(Object.assign({ kind: 'cash' }, viaB), LINE, ctx);
    ok(pB && pB.cells[10] === BUY && pB.cells[1] === BUY && pB.cells[0] === '홍가동 드림', 'B 번호로 맞은 줄 = K 를 그 번호로(B 그대로)', pB);
    const pD = OM.pairCash(Object.assign({ kind: 'cash' }, base), { line_key: BUY, ship_date: '2026-10-29' }, ctx);
    ok(pD && pD.ship_date === '2026-10-29', '날짜 있는 입력삭제 줄 = 날짜 없는 주소 줄도 그날(markIndiv 와 같게)', pD);

    console.log('② API(실자료 꼴 · 현금 6줄 먼저 → 입력삭제 줄 따로)');
    const db = new PGlite();
    await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
    await db.query(`INSERT INTO pricing (partner, start_date, end_date, items) VALUES ('대성(시온)', '2026-01-01', '2026-12-31', $1)`, [JSON.stringify(CAT.map(n => ({ name: n, price: 1 })))]);
    await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false,
        result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
    for (const q of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(q);
    const pool = mkPool(db), audits = [];
    const app = express(); app.use(express.json());
    const auth = (req, res, next) => { req.user = { id: 990874, name: '검증', position: '', role: 'staff' }; next(); };
    const api = OM.mount(app, { pool, authMiddleware: auth, writeAudit: async a => { audits.push(a); }, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }),
        cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => T, noTimers: true, anthropic: null,
        shipCal: async () => ({ realToday: T, shipDays: [T, SHIP], suggested: SHIP }) });
    const srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, () => r(s)); });
    const call = async (method, url, body) => { const r = await fetch('http://127.0.0.1:' + PORT + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
    const forShip = async () => (await call('GET', '/api/order-memo/for-ship?date=' + SHIP)).j;
    const allRows = async () => (await db.query(`SELECT id, entry_id, cells, ship_date::text AS ship_date, sure FROM order_memo_rows ORDER BY id`)).rows;
    try {
        await api.ensure();
        const e1 = await call('POST', '/api/order-memo', { raw: '(현금 6줄 + 다른 현금 손님)', rows: RECV.map(r => ({ kind: 'cash', cells: cashCells(r), src: 'edit' })).concat([{ kind: 'cash', cells: OTHER_CASH, src: 'edit' }]) });
        ok(e1.s === 200 && e1.j.rows.length === 7 && e1.j.rows.every(r => r.indiv === false), '현금 줄 먼저 저장 = 7줄 전부 현금(「!」) · 종전 그대로', e1.j);
        const before0 = await forShip();
        const e2 = await call('POST', '/api/order-memo', { raw: BUY + ' 입력o삭제x 네이버', rows: [{ kind: 'line', key: BUY, note: '입력o삭제x', plat: '네이버', line: BUY + ' 입력o삭제x 네이버', src: 'rule' }] });
        ok(e2.s === 200 && e2.j.rows.length === 1, '7분 뒤 입력삭제 줄 따로 저장(다른 묶음)');
        const fsBefore = await forShip(), before = await allRows();
        ok(JSON.stringify(fsBefore.cash_aoa) === JSON.stringify(before0.cash_aoa), '입력삭제 줄만 넣음(안 바꿈) = 현금파일 줄 바이트 동일(종전)');
        const fo0 = finalOrder(fsBefore, SHIP);
        ok(fo0.indiv && fo0.chk.missing.length === 1 && fo0.chk.missing[0].qty === 6, '짝 전 최종발주 = 입력삭제 주문 + cmiss 카드 1(「현금파일에 주소 줄이 없어요」) = 10/26 밤 실제와 같음', fo0.chk);
        ok(fo0.m.cash.length === 7 && fo0.m.assign.length === 1 && !fo0.m.assign.some(a => a.o.order_key === ORD.pid), '짝 전 자동 송장 = 현금 7장 · 입력삭제 주문 운송장 0', { cash: fo0.m.cash.length, assign: fo0.m.assign.map(a => a.rule) });
        const ids6 = e1.j.rows.slice(0, 6).map(r => r.id), otherId = e1.j.rows[6].id, lineEntry = e2.j.entry_id;
        const bad = await call('POST', '/api/order-memo/pair', { key: '010-9999-8888', ids: ids6 });
        ok(bad.s === 409 && (await allRows()).every((r, i) => JSON.stringify(r) === JSON.stringify(before[i])), '그 번호 입력삭제 줄이 없으면 409 · 바뀐 것 0', bad.j);
        const pr = await call('POST', '/api/order-memo/pair', { key: BUY, ids: ids6.concat([otherId]) });
        ok(pr.s === 200 && pr.j.n === 6 && pr.j.skipped === 1 && pr.j.rows.every(r => r.indiv === true && r.entry_id === lineEntry && r.cells[10] === BUY && !/!/.test(r.cells[0])), '[바꾸기] = 6줄 주소 줄(입력삭제 줄 묶음으로 옮김 · ! 뗌 · K 그 번호) · 번호 다른 줄 1 건너뜀', pr.j);
        const after = await allRows();
        ok(JSON.stringify(after.find(r => r.id === otherId)) === JSON.stringify(before.find(r => r.id === otherId)), '번호 다른 현금 줄 = 칸·묶음·날짜 바이트 동일');
        const fs1 = await forShip(); const fo1 = finalOrder(fs1, SHIP);
        ok(fo1.chk.missing.length === 0 && fo1.chk.boxDiff.length === 0 && fo1.chk.notIndiv.length === 0 && fo1.chk.strangers.length === 0, '짝 뒤 최종발주 = 현금파일 카드 0(cmiss·박스 차이·이중 발송 없음)', fo1.chk);
        const a1 = fo1.m.assign.find(a => a.o.order_key === ORD.pid);
        ok(a1 && a1.rule === 'indiv_any' && a1.ships.length === 1 && fo1.m.extra.length === 5 && fo1.m.cash.length === 1 && fo1.m.todos.length === 0, '짝 뒤 자동 송장 = 입력삭제 주문에 아무거나 1장(indiv_any) · 나머지 5장 extra · 다른 현금 1장은 현금 그대로', { a1: a1 && a1.rule, extra: fo1.m.extra.length, cash: fo1.m.cash.length });
        ok(fs1.cash_aoa.length === fsBefore.cash_aoa.length && JSON.stringify(fs1.cash_aoa.find(c => c[3] === '이가식')) === JSON.stringify(fsBefore.cash_aoa.find(c => c[3] === '이가식')), '현금파일 = 7줄 그대로 · 다른 현금 손님 줄 바이트 동일');
        const au = audits.filter(a => /^pair/.test(a.action));
        ok(au.length === 1 && !/[가-힣]{2}|0167|6582/.test(JSON.stringify(au[0].changes)), '감사 기록 1줄 · 이름·번호 0', au);
        // 되돌리기
        const un = await call('POST', '/api/order-memo/pair', { undo: true, rows: pr.j.undo });
        const back = await allRows();
        ok(un.s === 200 && un.j.n === 6 && JSON.stringify(back) === JSON.stringify(before.map(r => back.find(x => x.id === r.id) && r)), '되돌리기 = 6줄 칸·묶음·날짜 짝 전과 바이트 동일', { n: un.j.n });
        ok(JSON.stringify((await forShip()).cash_aoa) === JSON.stringify(fsBefore.cash_aoa), '되돌리기 뒤 현금파일 = 짝 전과 바이트 동일');
        const un2 = await call('POST', '/api/order-memo/pair', { undo: true, rows: pr.j.undo });
        ok(un2.s === 200 && un2.j.n === 0, '되돌리기 두 번 = 0(이미 현금 줄)');
        // #868 날짜 짝 = 같은 묶음 기준 → 옮긴 뒤엔 입력삭제 줄 날짜를 따라감
        await call('POST', '/api/order-memo/pair', { key: BUY, ids: ids6 });
        const pu = await call('PUT', '/api/order-memo/rows/' + e2.j.rows[0].id, { ship_date: '2026-10-28' });
        const moved = (await allRows()).filter(r => ids6.includes(r.id));
        ok(pu.s === 200 && pu.j.paired === 6 && moved.every(r => r.ship_date === '2026-10-28'), '짝 뒤 입력삭제 줄 날짜를 고치면 주소 줄 6개도 따라감(#850-a·#868)', pu.j);
        ok((await allRows()).find(r => r.id === otherId).ship_date === null, '다른 현금 줄 날짜 그대로');

        console.log('③ 같은 카드(미리보기) 짝짓기');
        const prev = (await call('POST', '/api/order-memo/preview', { raw: BUY + ' 입력o삭제x 네이버' })).j;
        const aiCash = RECV.slice(0, 3).map(([nm, tel, ad]) => OM.checkRow(OM.cashFromAi({ buyer: '김가우', buyer_phone: '', recv: nm, phone1: tel, phone2: '', addr: ad, option: OPT, qty: 1, memo: '', sender: '김가우', sender_phone: '', sender_addr: '', date: '' }), ctx));
        const card = prev.rows.concat(aiCash.map(r => Object.assign({}, r, { indiv: false })));   // AI 가 K 를 받는 분 번호로 준 꼴(#872-b)
        ok(card.filter(r => r.kind === 'cash').every(r => /!$/.test(r.cells[0]) && r.cells[10] !== BUY), '카드 = 입력삭제 줄 + 현금(!) 3줄(K = 받는 분 번호)');
        const untouched = JSON.parse(JSON.stringify(card));
        // 화면 pair1Go 와 같은 바꿈(아래 ④에서 실제 함수로도 확인) — 1·2번째만 고름
        const picked = JSON.parse(JSON.stringify(card));
        [1, 2].forEach(ri => { const r = picked[ri], oldK = r.cells[10].replace(/\D/g, ''); if (!r.cells[1].replace(/\D/g, '') || r.cells[1].replace(/\D/g, '') === oldK) r.cells[1] = BUY; r.cells[10] = BUY; r.cells[0] = r.cells[0].replace(/[!！]/g, '').trim(); r.indiv = true; });
        const outRow = r => r.kind === 'cash' ? { kind: 'cash', ship_date: r.ship_date || null, cells: r.cells.slice(), indiv: !!r.indiv, src: r.src } : { kind: 'line', ship_date: r.ship_date || null, key: r.key, note: r.note, plat: r.plat, line: r.line, src: r.src };
        const s1 = await call('POST', '/api/order-memo', { raw: 'x', rows: picked.map(outRow) });
        const s0 = await call('POST', '/api/order-memo', { raw: 'x', rows: untouched.map(outRow) });
        ok(s1.s === 200 && s1.j.rows[1].indiv && s1.j.rows[2].indiv && s1.j.rows[1].cells[10] === BUY && !s1.j.rows[3].indiv, '고른 2줄 = 저장 때 서버가 주소 줄로 짝 · 안 고른 1줄 = 현금', s1.j.rows.map(r => r.indiv));
        ok(JSON.stringify(s1.j.rows[3].cells) === JSON.stringify(s0.j.rows[3].cells) && s0.j.rows.filter(r => r.kind === 'cash').every(r => r.indiv === false), '안 고른 줄 = 손대지 않은 저장과 칸 바이트 동일 · 아무것도 안 고르면 전부 현금(종전)');

        console.log('⑤ 순서 반대(입력삭제 줄 먼저 · 주소 줄 나중 다른 묶음 · K = 받는 분 번호)');
        await db.query('DELETE FROM order_memo_rows'); audits.length = 0;
        const l3 = await call('POST', '/api/order-memo', { raw: BUY + ' 입력o삭제x 네이버', rows: [{ kind: 'line', key: BUY, note: '입력o삭제x', plat: '네이버', line: BUY + ' 입력o삭제x 네이버', src: 'rule' }] });
        const ai6 = RECV.map(([nm, tel, ad]) => OM.checkRow(OM.cashFromAi({ buyer: '김가우', buyer_phone: '', recv: nm, phone1: tel, phone2: '', addr: ad, option: OPT, qty: 1, memo: '', sender: '김가우', sender_phone: '', sender_addr: '', date: '' }), ctx));
        const plain = await call('POST', '/api/order-memo', { raw: 'y', rows: ai6.map(r => outRow(Object.assign({}, r, { src: 'ai' }))) });
        ok(plain.j.rows.every(r => r.indiv === false && r.cells[10] !== BUY), '[현금 그대로](안 고름) = 6줄 현금 · K = 받는 분 번호(종전 저장 그대로)');
        const foP = finalOrder(await forShip(), SHIP);
        ok(foP.chk.missing.length === 1, '그대로 두면 최종발주 cmiss 1(종전)');
        await db.query('DELETE FROM order_memo_rows WHERE kind = $1', ['cash']);
        // 화면 pair1Go(③ 저장된 입력삭제 번호 고름) = K·B(받는 분 번호였으면) = 그 번호 · ! 뗌 → 저장(서버는 같은 묶음에 줄이 없어 현금으로 둠) → POST pair
        const sent3 = ai6.map(r => { const x = JSON.parse(JSON.stringify(r)), oldK = x.cells[10].replace(/\D/g, ''); if (!x.cells[1].replace(/\D/g, '') || x.cells[1].replace(/\D/g, '') === oldK) x.cells[1] = BUY; x.cells[10] = BUY; x.cells[0] = x.cells[0].replace(/[!！]/g, '').trim(); return x; });
        const sv3 = await call('POST', '/api/order-memo', { raw: 'y', rows: sent3.map(r => outRow(Object.assign({}, r, { src: 'ai' }))) });
        ok(sv3.j.rows.every(r => r.indiv === false && /!$/.test(r.cells[0]) && r.cells[10] === BUY), '저장 직후 = 아직 현금(「!」 · 다른 묶음이라 서버 markIndiv 가 안 짝지음) · K = 구매자 번호');
        const pr3 = await call('POST', '/api/order-memo/pair', { key: BUY, ids: sv3.j.rows.map(r => r.id) });
        ok(pr3.j.n === 6 && pr3.j.rows.every(r => r.indiv && r.entry_id === l3.j.entry_id), '저장 뒤 POST pair = 6줄 주소 줄 · 입력삭제 줄 묶음으로', pr3.j);
        const fo3 = finalOrder(await forShip(), SHIP), a3 = fo3.m.assign.find(a => a.o.order_key === ORD.pid);
        ok(fo3.chk.missing.length === 0 && fo3.chk.boxDiff.length === 0 && a3 && a3.rule === 'indiv_any' && fo3.m.extra.length === 5, '순서 반대도 최종발주 카드 0 · 자동 송장 indiv_any 1장 · 나머지 5장 extra', { chk: fo3.chk, a3: a3 && a3.rule });
    } finally { srv.close(); }

    console.log('④ 화면 묻기(ao-ordermemo.js 를 떼어 실행)');
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'ao-ordermemo.js'), 'utf8').replace(/\r\n/g, '\n');
    const head = ui.slice(ui.indexOf('    const esc = s =>'), ui.indexOf('    const lineView = s =>'));
    const helpers = cut(ui, '    const nameOf = r =>', ';\n') + cut(ui, '    const INDIV_RE = ', ';\n');
    const pairSrc = ui.slice(ui.indexOf('    const pairKeys = c =>'), ui.indexOf('    function indivSync() {'));
    const toasts = [];
    const U = new Function('window', 'OM', 'renderCard', 'toastFn', 'API', 'undoShow', 'load', 'errText', head.replace(/const toast = [^\n]*\n/, '') + '\nconst toast = toastFn;\n' + helpers + pairSrc + '\nreturn { pairKeys, pairHtml, pair1Go, savedCashOf, pair2Run };');
    const OMs = { list: [] };
    const u = U({}, OMs, () => {}, m => toasts.push(m), { pair: async () => ({ ok: true, body: { n: 0, undo: [] } }) }, () => {}, () => {}, () => '');
    const lineR = { kind: 'line', key: BUY, note: '입력o삭제x', plat: '네이버', line: BUY + ' 입력o삭제x 네이버' };
    const cashR = (i, indiv) => ({ kind: 'cash', indiv: !!indiv, cells: cashCells(RECV[i]).map((v, k) => k === 10 ? RECV[i][1] : v), id: null, state: 'open' });
    let c = { mode: 'new', rows: [lineR] };
    ok(u.pairHtml(c) === '', '현금파일 놓고 입력삭제 줄만(현금 줄 0 · 메모함 현금 0) = 묻기 0(종전 화면 그대로)');
    c = { mode: 'new', rows: [cashR(0), cashR(1)] };
    ok(u.pairHtml(c) === '', '입력삭제 줄 없는 현금 줄만 = 묻기 0');
    c = { mode: 'edit', rows: [lineR, cashR(0)] };
    ok(u.pairHtml(c) === '', '고치기 카드 = 묻기 0');
    c = { mode: 'new', rows: [lineR, cashR(0), cashR(1), cashR(2, true)] };
    const h1 = u.pairHtml(c);
    ok(/이 현금 줄 2개가 입력삭제 010-2600-0167 주소 줄인가요/.test(h1) && (h1.match(/data-cact="chk"/g) || []).length === 2 && (h1.match(/ checked/g) || []).length === 3 && /2줄 중 <b>2줄<\/b>/.test(h1) && !/data-cact="p1go" disabled/.test(h1), '① 같은 카드 = 「이 현금 줄 2개가 입력삭제 … 주소 줄인가요?」 · 줄마다 체크(#900 1-H 기본 전부 · 「전부」 칸) · 짝짓기 단추 풀림', h1.slice(0, 300));
    const keep = JSON.stringify(c.rows[2]);
    c.pair1.sel.clear(); c.pair1.sel.add(c.rows[1]); u.pair1Go(c);   // 사람이 2번째 줄 체크를 끔 = 1줄만
    ok(c.rows[1].indiv && c.rows[1].cells[10] === BUY && c.rows[1].cells[0] === '김가우 드림' && JSON.stringify(c.rows[2]) === keep && c.dirty && /1줄을 입력삭제/.test(toasts.pop()), '[주소 줄로 짝짓기] = 고른 줄만 K = 그 번호 · ! 뗌 · 안 고른 줄 그대로', c.rows[1].cells);
    c = { mode: 'new', rows: [lineR, Object.assign({}, lineR, { key: '010-5555-0001', line: '010-5555-0001 입력o삭제x' }), cashR(0)] };
    const h2 = u.pairHtml(c);
    ok(/role="radiogroup" aria-label="입력삭제 번호"/.test(h2) && c.pair1.key === null && /data-cact="p1go" disabled/.test(h2), '입력삭제 줄 둘 = 번호 고르기(기본 안 고름)');
    OMs.list = [Object.assign(cashR(3), { id: 63, cells: cashCells(RECV[3]) }), Object.assign(cashR(4), { id: 64, cells: cashCells(RECV[4]) }), Object.assign({ kind: 'cash', indiv: false, state: 'open', id: 70, cells: OTHER_CASH.slice() }), Object.assign(cashR(5, true), { id: 71, cells: cashCells(RECV[5]).map((v, k) => k ? v : '김가우 드림') })];
    c = { mode: 'new', rows: [lineR] };
    const h3 = u.pairHtml(c);
    ok(/메모함에 이 번호\(010-2600-0167\) 현금 줄 2개가 있어요/.test(h3) && /data-cact="p2yes"/.test(h3) && /data-cact="p2no"/.test(h3) && u.savedCashOf(BUY.replace(/\D/g, '')).map(r => r.id).join() === '63,64', '② 저장된 현금 줄 = 「이 번호 현금 줄 2개 · 바꿀까요? [바꾸기]/[현금 그대로]」 · 다른 번호·이미 주소 줄 제외', h3.slice(0, 200));
    c.pair2 = { [BUY.replace(/\D/g, '')]: 'no' };
    ok(u.pairHtml(c) === '', '[현금 그대로] = 묻기 사라짐');
    let sent = null; const u2 = U({}, OMs, () => {}, () => {}, { pair: async b => { sent = b; return { ok: true, body: { n: 2, undo: [] } }; } }, () => {}, () => {}, () => '');
    await u2.pair2Run({ mode: 'new', rows: [lineR], pair2: { [BUY.replace(/\D/g, '')]: 'no' } });
    ok(sent === null, '[현금 그대로] 고른 뒤 저장 = 서버 짝 요청 0');
    await u2.pair2Run({ mode: 'new', rows: [lineR], pair2: { [BUY.replace(/\D/g, '')]: 'yes' } });
    ok(sent && sent.key === BUY && sent.ids.join() === '63,64', '[바꾸기] 고른 뒤 저장 = POST pair {key, ids 63·64}', sent);
    // ③ 순서 반대 — 메모함에 주소 줄 없는 열린 입력삭제 줄 · 카드 = 현금 줄만(K = 받는 분 번호)
    // #875 오늘(KST) 저장한 입력삭제 줄만 묻기 — 묶음 created_at(UTC ISO) 기준 · KST 자정 언저리 9시간 함정 꼴
    const isoAt = kstYmdHm => new Date(Date.parse(kstYmdHm + ':00+09:00')).toISOString();
    const kToday = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), kYest = new Date(Date.now() - 15 * 3600e3).toISOString().slice(0, 10);
    OMs.list = [Object.assign({ id: 68, state: 'open', entry: { created_at: isoAt(kYest + 'T23:50') } }, lineR)];
    ok(u.pairHtml({ mode: 'new', cash: true, rows: [cashR(0)] }) === '', '#875 어제(KST 23:50 = UTC 같은 날 14:50) 저장한 입력삭제 줄 = 묻기 0');
    OMs.list = [Object.assign({ id: 69, state: 'open', entry: { created_at: isoAt(kToday + 'T00:10') } }, lineR)];   // KST 00:10 = UTC 전날 15:10
    ok(/건\(메모함\)/.test(u.pairHtml({ mode: 'new', cash: true, rows: [cashR(0)] })), '#875 오늘(KST 00:10 = UTC 전날) 저장한 입력삭제 줄 = 묻기');
    {   // ①·② 는 날짜 무관(어제 줄이어도 ② 그대로)
        OMs.list = [Object.assign({ id: 68, state: 'open', entry: { created_at: isoAt(kYest + 'T10:00') } }, lineR), Object.assign(cashR(3), { id: 63, cells: cashCells(RECV[3]) })];
        ok(/메모함에 이 번호/.test(u.pairHtml({ mode: 'new', rows: [lineR] })), '#875 ②(카드에 입력삭제 줄 · 번호 맞는 현금 줄) = 날짜 무관 그대로');
        const c5 = { mode: 'new', rows: [Object.assign({}, lineR), cashR(0)] }; u.pairHtml(c5); c5.pair1.sel.add(c5.rows[1]);
        c5.rows[0].key = '010-7777-0000'; const before5 = JSON.stringify(c5.rows[1]); u.pair1Go(c5);
        ok(JSON.stringify(c5.rows[1]) === before5 && /번호가 바뀌었어요/.test(toasts.pop() || '') && c5.pair1.key === null, '#875 카드에서 입력삭제 번호를 고친 뒤 [주소 줄로 짝짓기] = 「번호가 바뀌었어요」 · 줄 안 바뀜');
    }
    OMs.list = [Object.assign({ id: 69, state: 'open', entry: { created_at: new Date().toISOString() } }, lineR)];
    c = { mode: 'new', cash: true, rows: [cashR(0), cashR(1)] };
    const h4 = u.pairHtml(c);
    ok(/이 현금 줄 2개가 입력삭제 010-2600-0167 건\(메모함\) 주소 줄인가요/.test(h4) && (h4.match(/ checked/g) || []).length === 3 && !/data-cact="p1go" disabled/.test(h4) && !/p2yes/.test(h4), '③ 「이 현금 줄 2개가 입력삭제 … 건(메모함) 주소 줄인가요?」 · 기본 전부 체크(#900 1-H)', h4.slice(0, 200));
    c.pair1.sel.clear(); c.pair1.sel.add(c.rows[0]); u.pair1Go(c);   // 1줄만 남기고 끔
    ok(c.rows[0]._pairSaved === BUY && c.rows[0].cells[10] === BUY && c.rows[0].cells[1] === BUY && !c.rows[1]._pairSaved && c.rows[1].cells[10] === RECV[1][1], '③ 고른 줄만 K·B = 그 번호(B 가 옛 K 였으므로) · 표식 _pairSaved', c.rows[0].cells);
    sent = null; await u2.pair2Run(c, c.rows, [{ id: 501, kind: 'cash' }, { id: 502, kind: 'cash' }]);
    ok(sent && sent.key === BUY && sent.ids.join() === '501', '③ 저장 뒤 = POST pair {key, ids = 방금 저장한 고른 줄만}', sent);
    OMs.list.push(Object.assign(cashR(5, true), { id: 72, cells: cashCells(RECV[5]).map((v, k) => k ? v : '김가우 드림') }));
    ok(u.pairHtml({ mode: 'new', cash: true, rows: [cashR(0)] }) === '', '③ 그 입력삭제 줄에 이미 주소 줄이 있으면 = 묻기 0');
    OMs.list = [];
    ok(u.pairHtml({ mode: 'new', cash: true, rows: [cashR(0)] }) === '', '열린 입력삭제 줄 없음 + 현금 줄 = 묻기 0(종전)');

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
