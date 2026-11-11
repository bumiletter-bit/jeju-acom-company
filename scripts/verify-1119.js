// #1119 왕복 검증 — 메모함에서 날짜를 나눠 둔 입력삭제(입력삭제 줄 = 뒤 날짜 · 주소 줄 일부 = 날짜 없음/오늘) → for-ship → 최종발주(core·v2 실코드) → 현금 카드 조건(final-order.js #1119 omSplitOf 실코드 잘라 실행) → 자동 송장(invoice-auto 실코드) + 배지(order-memo indivBadge · ao-ordermemo badgeText 실코드)
//   🔴 실DB·실서버·채널·브라우저 0 · DB = 이 PC 메모리 pglite · 가짜 번호만 · 포트 PORT1119(기본 3469)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-1119.js
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
    // ── #1119 final-order.js omSplitOf 실코드(한 줄) 잘라 실행 ──
    const foSrc = fs.readFileSync(path.join(ROOT, 'public', 'final-order.js'), 'utf8').replace(/\r\n/g, '\n');
    const a0 = foSrc.indexOf('const omSplitOf = m => {'), a1 = foSrc.indexOf('\n', a0); if (a0 < 0) throw new Error('omSplitOf 없음');
    const mdF = iso => iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : '';
    const mkSplit = (OMF, cashRows) => new Function('cashLive', 'OMF', 'core', 'md', foSrc.slice(a0, a1) + '\nreturn omSplitOf;')(() => cashRows, OMF, () => core, mdF);
    const omfOf = fs1 => ({ removed: false, lines: (fs1.lines || []).map(x => ({ id: x.id, text: String(x.line || ''), checked: x.checked || null, lstate: x.state || null, sd: x.ship_date || null })) });
    const omRows = cash => cash.rows.map((r, i) => Object.assign({}, r, { no: i + 2, om: true }));
    // ── 배지 글(ao-ordermemo.js badgeText · BADGE_K 실코드) ──
    const aoSrc = fs.readFileSync(path.join(ROOT, 'public', 'ao-ordermemo.js'), 'utf8').replace(/\r\n/g, '\n');
    const b0 = aoSrc.indexOf('    function badgeText(b) {'), b1 = aoSrc.indexOf('\n    }\n', b0) + 7;
    const badgeText = new Function('md', aoSrc.slice(b0, b1) + '\nreturn badgeText;')(mdF);
    const k0 = aoSrc.indexOf('    const BADGE_K = '), BK = new Function(aoSrc.slice(k0, aoSrc.indexOf('\n', k0)) + '\nreturn BADGE_K;')();

    console.log('Ⅰ 배지 = 종전 상태 글자 그대로 + 새 꼴 2');
    { const ln = x => Object.assign({ line_key: BUY, plat: '네이버' }, x || {}), cr = (q, d) => ({ kind: 'cash', state: 'open', sure: true, ship_date: d || null, cells: ['가 드림', BUY, ORIGIN, '받', TY, String(q), '010-3300-0001', '', '주소', '', BUY, '', ''] });
      const od = (q, x) => Object.assign({ channel: 'naver', buyer_digits: BD, option_text: TY, qty: q, product_order_no: '20991000' + q }, x || {});
      const t = b => badgeText(b), cat = { catalog: new Set(CAT) }, pers = od(1, { channel: 'cafe24', option_text: '1318님 - 개인결제창' });
      let b = OM.indivBadge(ln(), [cr(3)], [od(3)], D2, {}); ok(b.state === 'ok' && t(b) === '3/3 매칭완료', 'ok(종전)', [b.state, t(b)]);
      b = OM.indivBadge(ln(), [cr(2)], [od(3)], D2, {}); ok(b.state === 'short' && t(b) === '2/3 · 1박스 모자람', 'short(종전)', t(b));
      b = OM.indivBadge(ln(), [cr(4)], [od(3)], D2, {}); ok(b.state === 'over' && t(b) === '4/3 · 1박스 초과', 'over(종전)', t(b));
      b = OM.indivBadge(ln(), [cr(1), cr(2, D4)], [od(3)], D2, {}); ok(b.state === 'split' && t(b) === '1/3 오늘 · 2박스 11/4 대기', 'split(종전)', t(b));
      b = OM.indivBadge(ln({ ship_date: D4 }), [cr(1), cr(2, D4)], [od(3)], D2, {}); ok(b.state === 'split' && t(b) === '1/3 오늘 · 2박스 11/4 대기', 'split = 입력삭제 줄이 뒤 날짜여도 같은 꼴(종전 계산)', t(b));
      b = OM.indivBadge(ln(), [cr(3)], [], D2, {}); ok(b.state === 'unknown' && t(b) === '3/? 주문 확인 중', 'unknown(종전)', t(b));
      b = OM.indivBadge(ln({ plat: '자사몰' }), [cr(3)], [pers], D2, cat); ok(b.state === 'personal' && t(b) === '개인결제창 · 주소 줄 3', 'personal 날짜 나눔 없음(종전 글자)', t(b));
      b = OM.indivBadge(ln({ plat: '자사몰', ship_date: D4 }), [cr(3), cr(60, D4)], [pers], D2, cat); ok(b.state === 'personal' && t(b) === '개인결제창 · 오늘 3박스 · 60박스 11/4 대기' && BK[b.state] === 'pers', '🆕 personal + 날짜 나눔 = 「개인결제창 · 오늘 3박스 · 60박스 M/D 대기」', t(b));
      const nl = ln({ checked: { normal_orders: ['209910001'] } });
      b = OM.indivBadge(nl, [cr(3, D4)], [od(1)], D2, {}); ok(b.state === 'normal_later' && t(b) === '일반발송 1건 · 주소 줄 11/4 대기', 'normal_later(종전)', t(b));
      b = OM.indivBadge(nl, [], [od(1)], D2, {}); ok(b.state === 'allnormal' && t(b) === '전부 일반발송 1건', 'allnormal(종전)', t(b));
      b = OM.indivBadge(nl, [cr(3)], [od(1)], D2, {}); ok(b.state === 'over' && t(b) === '3/0 · 3박스 초과 · 일반발송 1건', '일반발송 + 오늘 줄만 = 종전 over 그대로', t(b));
      b = OM.indivBadge(nl, [cr(3), cr(60, D4)], [od(1)], D2, {}); ok(b.state === 'normal_split' && t(b) === '일반발송 1건 · 오늘 3박스 · 60박스 11/4 대기' && BK[b.state] === 'later', '🆕 일반발송 + 날짜 나눔 = 중립(종전 빨강 초과)', [b.state, t(b)]);
    }

    // #1121(11/11) 그 번호 입력삭제 줄이 하나뿐이면 새 규칙(첫날 발송처리 · verify-1121) → 이 절은 #1119 길이 남는 꼴(같은 번호 입력삭제 줄 2개)로 봄
    console.log('Ⅱ 왕복 = 입력삭제 줄 11/4(같은 번호 2줄 = #1121 밖) + 주소 줄 받는1(날짜 뺌 = 11/2) + 3줄(11/4) · 주문 A3·B1');
    const orders = [nv(PA, 3), nv(PB, 1)];
    { const E = await mk(Number(process.env.PORT1119) || 3469); try {
        const line = { kind: 'line', key: BUY, note: '입력o삭제x', plat: '네이버', ship_date: D4, line: ['11/4', BUY, '입력o삭제x', '네이버'].join('\t'), src: 'edit', checked: { plat: '네이버', as: 'buyer', at: new Date().toISOString() } };
        const e = await E.call('POST', '/api/order-memo', { raw: '시험', rows: [line, Object.assign({}, line), cashRow('받는1', '010-3300-0001', '부산광역시 가짜구 일로 1'), cashRow('받는2', '010-3300-0002', '부산광역시 가짜구 이로 2'), cashRow('받는3', '010-3300-0003', '부산광역시 가짜구 삼로 3'), cashRow('받는4', '010-3300-0004', '부산광역시 가짜구 사로 4')] });
        ok(e.s === 200, '저장', e.j);
        let R = await E.rows(); ok(R.filter(r => r.kind === 'cash' && r.ship_date === D4).length === 4, '저장 직후 = 주소 줄 4 전부 11/4(종전)', R.map(r => r.ship_date));
        const first = R.find(r => r.kind === 'cash' && r.cells[3] === '받는1');
        const pu = await E.call('PUT', '/api/order-memo/rows/' + first.id, { cells: first.cells, ship_date: null }); ok(pu.s === 200, '받는1 날짜 뺌(PUT)', pu.j);
        R = await E.rows(); ok(!R.find(r => r.id === first.id).ship_date, '받는1 = 날짜 없음', R.find(r => r.id === first.id));
        const li = (await E.call('GET', '/api/order-memo')).j, bl = li.entries.flatMap(x => x.rows).find(r => r.kind === 'line').badge;
        ok(bl && bl.state === 'split' && badgeText(bl) === '1/4 오늘 · 3박스 11/4 대기', '배지 = 「1/4 오늘 · 3박스 11/4 대기」(중립)', [bl, bl && badgeText(bl)]);
        const f2 = await E.forShip(D2), d2 = day(f2, D2, orders);
        ok(d2.cash.rows.length === 1 && d2.cash.rows[0].cells[3] === '받는1' && f2.waiting.length === 3, '11/2 양식 = 받는1 1줄 · 3줄 대기', [d2.cash.rows.map(r => r.cells[3]), f2.waiting.length]);
        ok(d2.st[PA] === 'excl' && d2.st[PB] === 'excl', '11/2 주문 A·B = 오늘 안 나감', d2.st);
        ok(d2.chk.notIndiv.length === 1 && d2.chk.notIndiv[0].allExcluded, '11/2 cashCheck = notIndiv allExcluded 1(종전 = 카드)', d2.chk.notIndiv);
        const sp = d2.chk.notIndiv[0] && mkSplit(omfOf(f2), omRows(d2.cash))(d2.chk.notIndiv[0]);
        ok(sp && sp.boxes === 1 && sp.date === D4, '🆕 카드 대신 참고 줄(오늘 1박스 · 주문 11/4 입력삭제)', sp);
        const formOf = d => d.cash.rows.map(r => r.cells.join('|')).concat(Object.entries(d.st).filter(([, v]) => v === 'go').map(([k]) => 'order:' + k));
        const fNo = formOf(d2), fYes = formOf(day(f2, D2, orders)); ok(JSON.stringify(fNo) === JSON.stringify(fYes) && fNo.length === 1, '카드 누름 vs 카드 없음 = 양식 줄 단위 같음(카드는 해결 표시뿐 · 양식 = 현금 줄 + 나가는 주문)', [fNo, fYes]);
        ok(d2.card.rows.length === 0 && d2.hold.length === 2, '11/2 자동 송장 = 주문 운송장 0 · hold 2', [d2.card.rows, d2.hold]);
        const nv0 = d2.chk.notIndiv[0] || {};
        ok(mkSplit(omfOf(f2), d2.cash.rows.map((r, i) => Object.assign({}, r, { no: i + 2, om: false })))(nv0) === null, '현금파일 엑셀 줄 = 종전 카드');
        ok(mkSplit({ removed: false, lines: omfOf(f2).lines.map(l => Object.assign({}, l, { lstate: 'today' })) }, omRows(d2.cash))(nv0) === null, '입력삭제 줄 대기 아님 = 종전 카드');
        ok(mkSplit(omfOf(f2), omRows(d2.cash))(Object.assign({}, nv0, { allExcluded: false })) === null, '주문이 오늘 나감(이중 발송) = 종전 카드');
        ok(mkSplit({ removed: true, lines: omfOf(f2).lines }, omRows(d2.cash))(nv0) === null, '메모함 줄 뺀 상태 = 종전 카드');
        ok(mkSplit({ removed: false, lines: [] }, omRows(d2.cash))(nv0) === null, '메모 줄 없음 = 종전 카드');
        ok(mkSplit(omfOf(f2), omRows(d2.cash))(Object.assign({}, nv0, { digits: '01099990000' })) === null, '다른 번호 = 종전 카드');
        await E.call('POST', '/api/order-memo/used', { date: D2, ids: f2.ids }); await E.call('POST', '/api/order-memo/clear', { date: D2 });
        const f4 = await E.forShip(D4), d4 = day(f4, D4, orders);
        ok(d4.cash.rows.length === 3 && !d4.cash.rows.some(r => r.cells[3] === '받는1'), '11/4 양식 = 3줄(받는1 은 11/2 에 나가고 빠짐)', d4.cash.rows.map(r => r.cells[3]));
        ok(d4.st[PA] === 'indiv' && d4.st[PB] === 'indiv', '11/4 주문 = 입력삭제', d4.st);
        console.log('   ℹ️  11/4 박스 카드(네이버 주문 4 · 주소 3 = 종전 「모자람」 카드 · 자사몰 개인결제창은 1295 안내 한 줄 · 무변경) =', JSON.stringify(d4.chk.boxDiff));
        ok(!d4.chk.notIndiv.length && !d4.chk.missing.length, '11/4 현금 카드 0 · 빠짐 0', d4.chk);
        ok(Object.values(d4.r).filter(Boolean).length >= 1, '11/4 자동 송장 = 주문에 운송장', d4.r);
    } finally { await new Promise(r => E.srv.close(r)); } }
    console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
