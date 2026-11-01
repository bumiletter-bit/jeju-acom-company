// #938 왕복 검증 — 메모함 저장(주문번호 키 줄 · 실제 order-memo.js API) → for-ship → 최종발주 판정(core·v2 실코드) → 자동 송장 짝(invoice-auto 실코드)
//   🔴 실DB·실서버·채널·브라우저 0 · DB = 이 PC 메모리 pglite · 가짜 번호만 · 포트 PORT938(기본 3468)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-938-roundtrip.js
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 600))); };
if (!process.env.PGLITE_DIR) { console.log('PGLITE_DIR 필요'); process.exit(2); }
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const OM = require(path.join(ROOT, 'order-memo.js')), core = require(path.join(ROOT, 'public', 'final-order-core.js')), ia = require(path.join(ROOT, 'invoice-auto.js'));
const TY = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', CAT = [TY], ORIGIN = '제주특별자치도 제주시 연삼로 1066-31';
const BUY = '010-2600-0001', BD = '01026000001', PA = '2026110100000001', PB = '2026110100000002', HOME = '서울특별시 가짜구 집로 1';
const D0 = '2026-11-01', D2 = '2026-11-02', D4 = '2026-11-04';
const nv = (pid, q) => ({ _pid: pid, '구매자연락처': BUY, '수취인명': '가구매', '수취인연락처1': BUY, '통합배송지': HOME, '옵션정보': TY, '수량': q });
const src = fs.readFileSync(path.join(ROOT, 'public', 'invoice-v2.js'), 'utf8').replace(/\r\n/g, '\n');
const cut = (s, a0, end) => { const a = s.indexOf(a0); if (a < 0) throw new Error('없음 ' + a0); const b = s.indexOf(end, a); return s.slice(a, b + end.length); };
const V2 = new Function('matchKey', [cut(src, 'const isoOf = ', ';\n'), cut(src, 'function parseDate(s, today) {', '\n    }\n'), cut(src, 'const chOfText = ', ';\n'), cut(src, 'function parseLines(txt, boxCh, today) {', '\n        return out;\n    }\n'), cut(src, '    function applyLines(ctx, force = true) {', '\n        });\n    }\n')].join('\n') + '\nreturn { parseLines, applyLines };');
const v2 = V2((ctx, e, digits, key) => (digits.length >= 8 && BD === digits) || (key && e.pid === key));
function day(fs1, date, orders) {   // for-ship 응답 → 최종발주 → 양식 → LOIS(보내는분전화 = K · 838B) → 자동 송장
    const prep = core.prepLines(fs1.memo_text, { realToday: date, shipDate: date, shipDays: [D2, '2026-11-03', D4] });
    const merged = orders.map(o => ({ ch: 'naver', pid: o._pid, conv: { '수량': o['수량'] }, excluded: false, userTouched: false, memoFlag: null }));
    const ctx = { today: date, allowIndiv: true, merged, lines: { naver: [], cafe24: [], coupang: [] } };
    const all = v2.parseLines(prep.v2Text, 'naver', date); all.forEach(l => { if (!l.bad) ctx.lines[l.ch].push(l); }); ctx.allLines = all; v2.applyLines(ctx);
    const cash = fs1.cash_aoa.length ? core.parseCash(fs1.cash_aoa) : { ok: true, rows: [] };
    const chk = core.cashCheck({ orders: merged.map(e => ({ key: e.pid, digits: BD, qty: Number(e.conv['수량']), individual: !!e.individual, excluded: !!e.excluded, buyer: '가', opt: TY })), cash: cash.rows });
    let i = 0; const ships = cash.rows.map(r => ({ tr: '68' + date.replace(/\D/g, '').slice(4) + '000' + String(1000 + (++i)), nm: r.cells[3], tel: r.cells[6], ad: r.cells[8], op: r.cells[4], q: 1, sn: r.cells[0], stel: r.cells[10] }));
    merged.forEach(e => { if (!e.individual && !e.excluded) for (let q = 0; q < Number(e.conv['수량']); q++) ships.push({ tr: '69' + date.replace(/\D/g, '').slice(4) + '000' + String(1000 + (++i)), nm: '가구매', tel: BUY, ad: HOME, op: TY, q: 1, sn: '가구매(제주아꼼이네)', stel: BUY }); });
    const os = ia.normOrders('naver', orders), ind = merged.filter(e => e.individual && !e.excluded).map(e => 'naver:' + e.pid), hold = merged.filter(e => e.excluded).map(e => 'naver:' + e.pid);
    const m = ia.matchShipments({ ships: ia.normShips(ships), orders: os, pricingNames: CAT, indivKeys: ind, holdKeys: hold }), card = ia.buildCard(m, os);
    const st = {}; merged.forEach(e => { st[e.pid] = e.individual ? (e.excluded ? 'indiv+excl' : 'indiv') : e.excluded ? 'excl' : 'go'; });
    return { st, chk, cash, card, r: Object.fromEntries(card.rows.map(x => [x.order_key, x.rule])), ind, hold, waiting: (fs1.waiting || []).length };
}
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) { const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }
const lineRow = (key, date) => ({ kind: 'line', key, note: '입력o삭제x', plat: '네이버', ship_date: date || null, line: [date ? (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)) : '', key, '입력o삭제x', '네이버'].join('\t'), src: 'edit', checked: { plat: '네이버', as: 'order', at: new Date().toISOString(), buyer: BUY } });
const cashRow = (nm, tel, ad, date, bang) => ({ kind: 'cash', src: 'edit', ship_date: date || null, indiv: !bang, cells: [bang ? '가구매 드림!' : '가구매 드림', BUY, ORIGIN, nm, TY, '1', tel, '', ad, '', BUY, '', ''] });
const A3 = [['받는1', '010-3300-0001', '부산광역시 가짜구 일로 1'], ['받는2', '010-3300-0002', '부산광역시 가짜구 이로 2'], ['받는3', '010-3300-0003', '부산광역시 가짜구 삼로 3']], B1 = ['받는9', '010-3300-0009', '대전광역시 가짜구 구로 9'];

(async () => {
    const mk = async port => {
        const db = new PGlite();
        await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
        await db.query(`INSERT INTO pricing (partner, start_date, end_date, items) VALUES ('대성(시온)', '2026-01-01', '2026-12-31', $1)`, [JSON.stringify(CAT.map(n => ({ name: n, price: 1 })))]);
        await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false, result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
        for (const q of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(q);
        const app = express(); app.use(express.json()); const auth = (req, res, next) => { req.user = { id: 990938, name: '검증', position: '', role: 'staff' }; next(); };
        const api = OM.mount(app, { pool: mkPool(db), authMiddleware: auth, writeAudit: async () => {}, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }), cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => D0, noTimers: true, anthropic: null, shipCal: async () => ({ realToday: D0, shipDays: [D2, D4], suggested: D2 }) });
        const srv = await new Promise(r => { const s = http.createServer(app).listen(port, '127.0.0.1', () => r(s)); });
        await api.ensure(); await api.preEnsure();
        const call = async (method, url, body) => { const r = await fetch('http://127.0.0.1:' + port + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
        await db.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, paid_at) VALUES ('naver',$1,$1,'가구매',$2,'가구매',$2,$3,$4,3,NOW()), ('naver',$5,$5,'가구매',$2,'가구매',$2,$3,$4,1,NOW())`, [PA, BD, HOME, '아꼼이네 상품선택: 1. (제철)' + TY, PB]);
        return { db, srv, call, forShip: async d => (await call('GET', '/api/order-memo/for-ship?date=' + d)).j, rows: async () => (await db.query(`SELECT id, kind, cells, ship_date::text AS ship_date, line_key, line, checked, sure FROM order_memo_rows ORDER BY id`)).rows };
    };
    const orders = [nv(PA, 3), nv(PB, 1)];
    console.log('Ⅰ 한 묶음 저장(주문번호 줄 A·B + 주소 줄 · B 줄 날짜 11/4)');
    { const E = await mk(Number(process.env.PORT938) || 3468); try {
        const e = await E.call('POST', '/api/order-memo', { raw: '시험', rows: [lineRow(PA), lineRow(PB, D4), ...A3.map(a => cashRow(a[0], a[1], a[2])), cashRow(B1[0], B1[1], B1[2], D4)] });
        ok(e.s === 200 && e.j.rows.filter(r => r.kind === 'cash').every(r => r.indiv && !/!/.test(r.cells[0]) && r.cells[10] === BUY), '저장 = 주소 줄 4(「!」 없음 · K = 전화번호)', e.j);
        const R = await E.rows(); ok(R.filter(r => r.kind === 'cash' && r.ship_date === D4).length === 1 && R.filter(r => r.kind === 'cash' && !r.ship_date).length === 3, 'A 줄 날짜 없음 3 · B 줄 11/4 1(같은 구매자 줄 둘 = 날짜 자동 배정 없음)', R.map(r => r.ship_date));
        const f2 = await E.forShip(D2), d2 = day(f2, D2, orders);
        ok(d2.st[PA] === 'indiv' && d2.st[PB] === 'excl', '11/2 최종발주 = A 입력삭제 · B 오늘 안 나감', d2.st);
        ok(d2.cash.rows.length === 3 && f2.waiting.length === 1, '11/2 양식 = A 주소 줄 3 · B 줄 waiting', [d2.cash.rows.length, f2.waiting]);
        ok(!d2.chk.boxDiff.length && !d2.chk.missing.length && !d2.chk.notIndiv.length && !d2.chk.strangers.length, '11/2 박스 카드 0', d2.chk);
        ok(d2.r[PA] && /^indiv_/.test(d2.r[PA]) && !d2.r[PB] && d2.card.rows.length === 1, '11/2 자동 송장 = A 만 · B 운송장·할 일 없음', d2.r);
        ok(d2.card.orders_without_tracking === 1 && d2.card.extra.length === 2, '11/2 B = 「운송장 없는 주문」 숫자 · A 나머지 2장 = 다른 주소 박스', [d2.card.orders_without_tracking, d2.card.extra.length]);
        const li = (await E.call('GET', '/api/order-memo')).j, lines = li.entries.flatMap(x => x.rows).filter(r => r.kind === 'line'), ba = lines.find(r => r.key === PA).badge, bb = lines.find(r => r.key === PB).badge;
        ok(ba && ba.m === 3 && ba.n === 3 && ba.state === 'ok', '배지 A = 3/3 매칭완료', ba); ok(bb && bb.m === 1 && bb.n === 1 && bb.state === 'ok', '배지 B = 1/1(같은 발송일 줄만)', bb);
        const f4 = await E.forShip(D4), d4 = day(f4, D4, [orders[1]]);
        ok(d4.st[PB] === 'indiv', '11/4 최종발주 = B 입력삭제', d4.st);
        console.log('   ℹ️  11/4 for-ship 현금 줄 수(비우기 전이면 A 줄 포함) =', d4.cash.rows.length);
        const R4 = (await E.rows()).filter(r => r.kind === 'cash'); await E.call('POST', '/api/order-memo/used', { date: D2, ids: f2.ids }); await E.call('POST', '/api/order-memo/clear', { date: D2 });
        const f4b = await E.forShip(D4), d4b = day(f4b, D4, [orders[1]]);
        ok(d4b.cash.rows.length === 1 && d4b.cash.rows[0].cells[3] === B1[0], '11/2 비우기 뒤 11/4 양식 = B 줄 1', d4b.cash.rows.map(r => r.cells[3]));
        ok(!d4b.chk.boxDiff.length && !d4b.chk.missing.length, '11/4 박스 카드 0', d4b.chk); ok(d4b.r[PB] === 'indiv_any' || d4b.r[PB] === 'indiv_store_addr', '11/4 자동 송장 = B 에 운송장', d4b.r);
        const R5 = await E.rows(); ok(R5.find(r => r.line_key === PB).line.includes('11/4'), 'B 줄 원문 날짜 유지(비우기 뒤에도 그 줄 열림)', R5.find(r => r.line_key === PB).line);
    } finally { await new Promise(r => E.srv.close(r)); } }
    console.log('Ⅱ 따로 저장(현금 줄 「!」 먼저 → 주문번호 줄 → /pair 전화번호로)');
    { const E = await mk(Number(process.env.PORT938) || 3468); try {
        const e1 = await E.call('POST', '/api/order-memo', { raw: '시험', rows: A3.map(a => cashRow(a[0], a[1], a[2], null, true)).concat([cashRow(B1[0], B1[1], B1[2], D4, true)]) });
        const ids = e1.j.rows.map(r => r.id); await E.call('POST', '/api/order-memo', { raw: '시험', rows: [lineRow(PA), lineRow(PB, D4)] });
        const p = await E.call('POST', '/api/order-memo/pair', { key: BUY, ids }); ok(p.s === 200 && p.j.n === 4, '[바꾸기] /pair = 4줄', p.j);
        const R = (await E.rows()).filter(r => r.kind === 'cash');
        ok(R.every(r => r.cells[10] === BUY && !/!/.test(r.cells[0])), '🔴 K = 전화번호(주문번호 안 들어감)', R.map(r => r.cells[10]));
        ok(R.filter(r => r.ship_date === D4).length === 1 && R.filter(r => !r.ship_date).length === 3, '🔴 날짜 없는 A 줄이 B 줄 날짜(11/4)를 따라가지 않음', R.map(r => r.ship_date));
        const f2 = await E.forShip(D2), d2 = day(f2, D2, orders);
        ok(d2.st[PA] === 'indiv' && d2.st[PB] === 'excl' && d2.cash.rows.length === 3, '11/2 = A 줄 3 · B 대기', [d2.st, d2.cash.rows.length]); ok(/^indiv_/.test(d2.r[PA] || '') && !d2.r[PB], '11/2 자동 송장 = A 만', d2.r);
    } finally { await new Promise(r => E.srv.close(r)); } }
    console.log('Ⅲ #939 표식 서버 보관(최종발주 PC A → 자동 송장 PC B)');
    { const db = new PGlite(); await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
      const ExcelJS = require(path.join(ROOT, 'node_modules', 'exceljs')), wb = new ExcelJS.Workbook(); wb.addWorksheet('a'); const xlsx = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
      let t = 0; const sh = (nm, ad) => ({ tr: '6810000' + String(10000 + (++t)), nm, tel: '010-3300-' + String(t).padStart(4, '0'), ad, op: TY, q: 1, sn: '가구매 드림', stel: BUY }); let LOIS = [];
      const app = express(); app.use(express.json({ limit: '20mb' })); let role = 'staff'; let uid = 12345; const auth = (req, res, next) => { req.user = { id: uid, name: '검증', role }; next(); }; process.env.MARKS_LOCAL_WRITE = '1';
      const audits = []; const svc = ia(app, { pool: mkPool(db), authMiddleware: auth, adminOnly: auth, writeAudit: async a => { audits.push(a); }, adminActor: () => ({ id: 990939, name: '검증' }), ExcelJS, kstToday: () => D2, lois: { shipRows: () => LOIS, upsert: async () => 0 }, fetchers: { naver: async () => ({ rows: orders }), coupang: async () => ({ rows: [] }), cafe24: async () => ({ rows: [] }) }, naverCfgGet: async () => null, transport: {}, log: { error() {} } });
      await svc.initDB(); const port = Number(process.env.PORT938) || 3468, srv = await new Promise(r => { const s = http.createServer(app).listen(port, '127.0.0.1', () => r(s)); });
      const post = async (u, b) => { const r = await fetch('http://127.0.0.1:' + port + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() }; };
      const match = async (iv, date) => { t = 0; LOIS = [sh('받는1', '부산 1'), sh('받는2', '부산 2'), sh('받는3', '부산 3')]; const r = await post('/api/agent-office/invoice-auto/match', Object.assign({ ship_date: date || D2, files: [{ name: 'x.xlsx', data: xlsx }] }, iv ? { indiv: iv } : {})); return { r: Object.fromEntries((r.j.rows || []).map(x => [x.order_key, x.rule])), marks: r.j.marks, s: r.s, sum: r.j.summary }; };
      const KA = 'naver:' + PA, KB = 'naver:' + PB;
      try {
          const m0 = await match(null); ok(m0.marks.source === 'none' && m0.r[PA] && m0.r[PB], '표식 없음·브라우저 값 없음 = 종전 길(B 도 운송장 받음 = 틈 그대로)', m0);
          const p = await post('/api/agent-office/final-order/marks', { date: D2, indiv: [KA], hold: [KB] }); ok(p.s === 200 && p.j.indiv === 1 && p.j.hold === 1 && audits.some(a => a.action === 'final_order_marks'), 'PC A 최종발주 = 표식 저장 · audit', p);
          const m1 = await match(null); ok(m1.marks.source === 'server' && m1.marks.differs && /^indiv_/.test(m1.r[PA] || '') && !m1.r[PB], '🔴 PC B(브라우저 값 없음) = 서버 표식으로 A 만 · B 안 붙음 · 「서버 표식 사용」', m1);
          ok(m1.sum.marks_source === 'server', 'summary 에 출처', m1.sum);
          const m2 = await match({ date: D2, at: Date.now() - 86400e3, keys: [], hold: [] }); ok(m2.marks.source === 'server' && m2.marks.differs && !m2.r[PB], 'PC B 옛 브라우저 값 = 서버 우선 · 다름 표시', m2);
          const m3 = await match({ date: D2, at: Date.now() - 86400e3, keys: [KA], hold: [KB] }); ok(m3.marks.source === 'server' && !m3.marks.differs, '같은 값 = 다름 표시 없음', m3.marks);
          const m4 = await match({ date: D2, at: Date.now() + 3600e3, keys: [KB], hold: [KA] }); ok(m4.marks.source === 'browser' && /^indiv_/.test(m4.r[PB] || '') && !m4.r[PA], '브라우저 값이 더 새것(서버 저장 실패 뒤 재생성) = 브라우저 값', m4);
          const m5 = await match({ date: D4, at: Date.now(), keys: [KA], hold: [KB] }, D4); ok(m5.marks.source === 'browser' && !m5.r[PB], '그날 서버 표식 없음 = 브라우저 값(종전 길)', m5);
          await post('/api/agent-office/final-order/marks', { date: D2, indiv: [KB], hold: [KA] }); const m6 = await match(null); ok(/^indiv_/.test(m6.r[PB] || '') && !m6.r[PA], '같은 날 다시 만들면 통째 교체 = 마지막이 정본', m6.r);
          const n0 = await db.query(`SELECT count(*)::int AS n FROM final_order_marks WHERE ship_date = $1`, [D2]); ok(n0.rows[0].n === 1, '날짜당 한 줄', n0.rows);
          const e0 = await post('/api/agent-office/final-order/marks', { date: 'x', indiv: [], hold: [] }), e1 = await post('/api/agent-office/final-order/marks', { date: D2, indiv: 'a', hold: [] }), e2 = await post('/api/agent-office/final-order/marks', { date: D2, indiv: Array(5001).fill(KA), hold: [] }); ok(e0.s === 400 && e1.s === 400 && e2.s === 400, '날짜·꼴·5,000 초과 = 400', [e0.s, e1.s, e2.s]);
          const big = await post('/api/agent-office/final-order/marks', { date: D4, indiv: Array.from({ length: 3000 }, (_, i) => 'naver:' + (2026110000000000 + i)), hold: ['이상한꼴', 'naver:', KB] }); ok(big.s === 200 && big.j.indiv === 3000 && big.j.hold === 1, '3,000개 저장 · 꼴 틀린 열쇠 버림', big.j);
          await db.query(`INSERT INTO final_order_marks (ship_date) VALUES ('2026-01-01')`); await post('/api/agent-office/final-order/marks', { date: D2, indiv: [KA], hold: [KB] }); const old = await db.query(`SELECT count(*)::int AS n FROM final_order_marks WHERE ship_date = '2026-01-01'`); ok(old.rows[0].n === 0, '30일 지난 표식 = 저장 때 지움', old.rows);
          uid = 990939; const tu = await post('/api/agent-office/final-order/marks', { date: D2, indiv: [KB], hold: [] }); uid = 12345;
          delete process.env.MARKS_LOCAL_WRITE; const lo = await post('/api/agent-office/final-order/marks', { date: D2, indiv: [KB], hold: [] }); process.env.MARKS_LOCAL_WRITE = '1';
          const kept = (await db.query(`SELECT indiv FROM final_order_marks WHERE ship_date = $1`, [D2])).rows[0].indiv; ok(tu.j.skipped && lo.j.skipped && kept.join() === KA, '🔴 시험 번호 계정·로컬 기동 = 저장 안 함(실DB 표식 안 덮음)', [tu.j, lo.j, kept]);
          const mw = await match(null); ok(mw.marks.local === 'none' && mw.marks.updated_by === '검증' && /T/.test(mw.marks.updated_at), '응답 = 저장 시각·저장한 사람·브라우저 값 없음', mw.marks);
          role = 'accountant'; const ac = await post('/api/agent-office/final-order/marks', { date: D2, indiv: [], hold: [] }); ok(ac.s === 403, '세무사 = 403', ac.s); role = 'staff';
          const noT = await (async () => { await db.query('ALTER TABLE final_order_marks RENAME TO final_order_marks_x'); const m = await match({ date: D2, at: Date.now(), keys: [KA], hold: [KB] }); await db.query('ALTER TABLE final_order_marks_x RENAME TO final_order_marks'); return m; })(); ok(noT.s === 200 && noT.marks.source === 'browser' && !noT.r[PB], '표식 표를 못 읽어도 = 브라우저 값 · 짝 맞추기 계속', noT);
      } finally { await new Promise(r => srv.close(r)); } }
    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
