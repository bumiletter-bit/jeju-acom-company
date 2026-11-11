// #1121 왕복 검증 — 날짜 나눈 입력삭제 = 「주소 줄 중 가장 이른 날 = 주문 발송처리 날」(대표 11/11)
//   입력삭제 줄 = 뒤 날짜(11/4) · 주소 줄 3박스 날짜 없음(= 11/2) + 60박스 11/4 → 11/2 주문 발송처리 1회 · 11/3 메모 줄 빠짐 · 11/4 60박스 · 카드 0
//   for-ship → 최종발주(core·v2 실코드) → 박스 카드 조건(final-order.js #1121 실코드 잘라 실행) → 자동 송장(invoice-auto 실코드) + 배지(order-memo indivBadge · ao-ordermemo badgeText 실코드)
//   🔴 실DB·실서버·채널·브라우저 0 · DB = 이 PC 메모리 pglite · 가짜 번호만 · 포트 PORT1121(기본 3471)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-1121.js
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 700))); };
const note = (m, d) => console.log('   ℹ️  ' + m + (d === undefined ? '' : ' = ' + JSON.stringify(d).slice(0, 700)));
if (!process.env.PGLITE_DIR) { console.log('PGLITE_DIR 필요'); process.exit(2); }
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const OM = require(path.join(ROOT, 'order-memo.js')), core = require(path.join(ROOT, 'public', 'final-order-core.js')), ia = require(path.join(ROOT, 'invoice-auto.js'));
const TY = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', CAT = [TY], ORIGIN = '제주특별자치도 제주시 연삼로 1066-31', PERS = '1318님 - 개인결제창';
const BUY = '010-2600-0001', BD = '01026000001', PA = '2026110100000001', PB = '2026110100000002', HOME = '서울특별시 가짜구 집로 1';
const D0 = '2026-11-01', D2 = '2026-11-02', D3 = '2026-11-03', D4 = '2026-11-04';
const nv = (pid, q, opt) => ({ _pid: pid, '구매자연락처': BUY, '수취인명': '가구매', '수취인연락처1': BUY, '통합배송지': HOME, '옵션정보': opt || TY, '수량': q });
const src = fs.readFileSync(path.join(ROOT, 'public', 'invoice-v2.js'), 'utf8').replace(/\r\n/g, '\n');
const cut = (s, a0, end) => { const a = s.indexOf(a0); if (a < 0) throw new Error('없음 ' + a0); const b = s.indexOf(end, a); if (b < 0) throw new Error('끝 없음 ' + end); return s.slice(a, b + end.length); };
const V2 = new Function('matchKey', [cut(src, 'const isoOf = ', ';\n'), cut(src, 'function parseDate(s, today) {', '\n    }\n'), cut(src, 'const chOfText = ', ';\n'), cut(src, 'function parseLines(txt, boxCh, today) {', '\n        return out;\n    }\n'), cut(src, '    function applyLines(ctx, force = true) {', '\n        });\n    }\n')].join('\n') + '\nreturn { parseLines, applyLines };');
const v2 = V2((ctx, e, digits, key) => (digits.length >= 8 && BD === digits) || (key && e.pid === key));
// opt.ch = 판매처(naver|cafe24) · opt.normal = 일반발송(#970)으로 고른 주문 pid(입력삭제 대조 밖)
function day(fs1, date, orders, opt) {
    const o0 = opt || {}, ch = o0.ch || 'naver', nm = new Set(o0.normal || []);
    const prep = core.prepLines(fs1.memo_text, { realToday: date, shipDate: date, shipDays: [D2, D3, D4] });
    const merged = orders.map(o => ({ ch, pid: o._pid, conv: { '수량': o['수량'] }, excluded: false, userTouched: false, memoFlag: null, opt: o['옵션정보'] }));
    const ctx = { today: date, allowIndiv: true, merged, lines: { naver: [], cafe24: [], coupang: [] } };
    const all = v2.parseLines(prep.v2Text, ch, date); all.forEach(l => { if (!l.bad) ctx.lines[l.ch].push(l); }); ctx.allLines = all; v2.applyLines(ctx);
    merged.forEach(e => { if (nm.has(e.pid) && e.individual) { e.individual = false; e._indivOff = true; } });   // #970 일반발송 = 주문 주소로
    const cash = fs1.cash_aoa.length ? core.parseCash(fs1.cash_aoa) : { ok: true, rows: [] };
    const chk = core.cashCheck({ orders: merged.map(e => ({ key: e.pid, digits: BD, qty: Number(e.conv['수량']), individual: !!e.individual, excluded: !!e.excluded, buyer: '가', opt: e.opt })), cash: cash.rows });
    let i = 0; const ships = cash.rows.map(r => ({ tr: '68' + date.replace(/\D/g, '').slice(4) + '000' + String(1000 + (++i)), nm: r.cells[3], tel: r.cells[6], ad: r.cells[8], op: r.cells[4], q: 1, sn: r.cells[0], stel: r.cells[10] }));
    merged.forEach(e => { if (!e.individual && !e.excluded) for (let q = 0; q < Number(e.conv['수량']); q++) ships.push({ tr: '69' + date.replace(/\D/g, '').slice(4) + '000' + String(1000 + (++i)), nm: '가구매', tel: BUY, ad: HOME, op: TY, q: 1, sn: '가구매(제주아꼼이네)', stel: BUY }); });
    let card = { rows: [] }, ind = [], hold = [];
    if (ch === 'naver') { const os = ia.normOrders('naver', orders); ind = merged.filter(e => e.individual && !e.excluded).map(e => 'naver:' + e.pid); hold = merged.filter(e => e.excluded).map(e => 'naver:' + e.pid);
        const m = ia.matchShipments({ ships: ia.normShips(ships), orders: os, pricingNames: CAT, indivKeys: ind, holdKeys: hold }); card = ia.buildCard(m, os); }
    const st = {}; merged.forEach(e => { st[e.pid] = e.individual ? (e.excluded ? 'indiv+excl' : 'indiv') : e.excluded ? 'excl' : 'go'; });
    return { st, chk, cash, card, merged, r: Object.fromEntries(card.rows.map(x => [x.order_key, x.rule])), ind, hold, prep };
}
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) { const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }
const lineRow = (date, plat, key) => ({ kind: 'line', key: key || BUY, note: '입력o삭제x', plat: plat || '네이버', ship_date: date || null, line: [date ? (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)) : '', key || BUY, '입력o삭제x', plat || '네이버'].join('\t'), src: 'edit', checked: { plat: plat || '네이버', as: 'buyer', at: new Date().toISOString() } });
const cashRow = (nm, q, date) => ({ kind: 'cash', src: 'edit', ship_date: date || null, cells: ['가구매 드림', BUY, ORIGIN, nm, TY, String(q), '010-3300-' + String(1000 + nm.length * 7).slice(-4), '', '부산광역시 가짜구 ' + nm + '로 1', '', BUY, '', ''] });

(async () => {
    let port = Number(process.env.PORT1121) || 3471;
    // pre = order_memo_preorders 줄 [{ch, pid, qty, opt}]
    const mk = async pre => {
        const db = new PGlite();
        await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
        await db.query(`INSERT INTO pricing (partner, start_date, end_date, items) VALUES ('대성(시온)', '2026-01-01', '2026-12-31', $1)`, [JSON.stringify(CAT.map(n => ({ name: n, price: 1 })))]);
        await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false, result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
        for (const q of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(q);
        const app = express(); app.use(express.json()); const auth = (req, res, next) => { req.user = { id: 991121, name: '검증', position: '', role: 'staff' }; next(); };
        const api = OM.mount(app, { pool: mkPool(db), authMiddleware: auth, writeAudit: async () => {}, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }), cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => D0, noTimers: true, anthropic: null, shipCal: async () => ({ realToday: D0, shipDays: [D2, D3, D4], suggested: D2 }) });
        const p = port++; const srv = await new Promise(r => { const s = http.createServer(app).listen(p, '127.0.0.1', () => r(s)); });
        await api.ensure(); await api.preEnsure();
        const call = async (method, url, body) => { const r = await fetch('http://127.0.0.1:' + p + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
        const setPre = async list => { await db.query('DELETE FROM order_memo_preorders'); for (const o of list) await db.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, paid_at) VALUES ($1,$2,$2,'가구매',$3,'가구매',$3,$4,$5,$6,NOW())`, [o.ch || 'naver', o.pid, BD, HOME, o.ch === 'cafe24' ? o.opt : '아꼼이네 상품선택: 1. (제철)' + (o.opt || TY), o.qty]); };
        await setPre(pre);
        return { db, srv, call, setPre, forShip: async d => (await call('GET', '/api/order-memo/for-ship?sm=1&date=' + d)).j, rows: async () => (await db.query(`SELECT id, kind, state, cells, ship_date::text AS ship_date, used_on::text AS used_on, line_key, line, checked, sure FROM order_memo_rows ORDER BY id`)).rows,
            badge: async () => { const li = (await call('GET', '/api/order-memo')).j; return li.entries.flatMap(x => x.rows).filter(r => r.kind === 'line').map(r => r.badge); }, close: () => new Promise(r => srv.close(r)) };
    };
    const mdF = iso => iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : '';
    // ── final-order.js #1121 박스 카드 → 참고 줄(실코드 잘라 실행 · undefined = 참고 줄로 넘김 · 'card' = 종전 카드) ──
    const foSrc = fs.readFileSync(path.join(ROOT, 'public', 'final-order.js'), 'utf8').replace(/\r\n/g, '\n');
    const blk = cut(foSrc, '            const spl = !OMF.removed', "{ info.push(`${buyer}: 오늘 ${cq}박스${splTail}`); return; }");
    const ik = o => String(o == null ? '' : o).replace(/\s+[^\s]*로!$/, '').replace(/\s+/g, ' ').trim();
    const boxFn = new Function('OMF', 'crow', 'd', 'es', 'buyer', 'info', 'md', 'core', 'inCatalog', 'qtyOf', 'optOf', 'ik', 'optLab', blk + '\nreturn "card";');
    const omfOf = fs1 => ({ removed: false, lines: (fs1.lines || []).map(x => ({ id: x.id, text: String(x.line || ''), checked: x.checked || null, lstate: x.state || null, sd: x.ship_date || null, split: x.split && typeof x.split === 'object' ? x.split : null, splitSent: /^\d{4}-\d{2}-\d{2}$/.test(String(x.split_sent || '')) ? x.split_sent : null })), splitSent: Array.isArray(fs1.split_sent) ? fs1.split_sent : [] });
    const crowOf = d => d.cash.rows.filter(r => !r.bang && !r.service && r.digits === BD).map(r => Object.assign({}, r, { om: true }));
    const box = (fs1, d, chOpt) => { const info = []; const es = d.merged.filter(e => e.individual && !e.excluded).map(e => ({ ch: e.ch, qty: Number(e.conv['수량']), opt: e.opt }));
        const v = boxFn(omfOf(fs1), crowOf(d), BD, es, '가', info, mdF, () => core, n => CAT.includes(n), e => e.qty, e => e.opt, ik, x => x); return { card: v === 'card', info }; };
    const stBlk = cut(foSrc, '        (chk.strangers || []).forEach(x => { const ss', "행`); });");
    const strangersInfo = (fs1, d, removed) => { const info = []; new Function('OMF', 'chk', 'info', 'md', 'cashLive', stBlk)(Object.assign(omfOf(fs1), { removed: !!removed }), d.chk, info, mdF, () => d.cash.rows); return info; };
    // ── 배지 글(ao-ordermemo.js badgeText · BADGE_K 실코드) ──
    const aoSrc = fs.readFileSync(path.join(ROOT, 'public', 'ao-ordermemo.js'), 'utf8').replace(/\r\n/g, '\n');
    const b0 = aoSrc.indexOf('    function badgeText(b) {'), b1 = aoSrc.indexOf('\n    }\n', b0) + 7;
    const badgeText = new Function('md', aoSrc.slice(b0, b1) + '\nreturn badgeText;')(mdF);
    const k0 = aoSrc.indexOf('    const BADGE_K = '), BK = new Function(aoSrc.slice(k0, aoSrc.indexOf('\n', k0)) + '\nreturn BADGE_K;')();
    // final-order.js omSplitDone 실코드(메모 칸 i번째 줄 글로 찾음)
    const sdSrc = cut(foSrc, '    function omSplitDone(i) {', ' return x ? x.splitSent : null; }');
    const omDone = (fs1, i) => { const txt = (fs1.lines || []).map(l => l.line).join('\n'); return new Function('OMF', 'document', sdSrc + '\nreturn omSplitDone;')(omfOf(fs1), { getElementById: () => ({ value: txt }) })(i); };
    const formOf = d => d.cash.rows.map(r => r.cells.join('|')).concat(Object.entries(d.st).filter(([, v]) => v === 'go').map(([k]) => 'order:' + k));
    const save = async (E, rows) => { const e = await E.call('POST', '/api/order-memo', { raw: '시험', rows }); if (e.s !== 200) throw new Error('저장 ' + JSON.stringify(e.j)); return E.rows(); };
    const dropDate = async (E, nm) => { const R = await E.rows(); const r = R.find(x => x.kind === 'cash' && x.cells[3] === nm); const pu = await E.call('PUT', '/api/order-memo/rows/' + r.id, { cells: r.cells, ship_date: null }); if (pu.s !== 200) throw new Error('PUT ' + JSON.stringify(pu.j)); };
    const del = async (E, ids) => { for (const id of ids) await E.call('DELETE', '/api/order-memo/rows/' + id); };
    const used = (E, d, f) => E.call('POST', '/api/order-memo/used', { date: d, ids: f.ids });
    // 8480 꼴 = 입력삭제 줄 11/4 · 받는1·2·3(1박스씩 · 날짜 뺌) · 받는60(60박스 · 11/4)
    const setup8480 = async (E, plat) => { await save(E, [lineRow(D4, plat), cashRow('받는1', 1), cashRow('받는2', 1), cashRow('받는3', 1), cashRow('받는육십', 60)]); for (const n of ['받는1', '받는2', '받는3']) await dropDate(E, n); };

    console.log('Ⅰ 네이버 주문 1건 63박스(오늘 3 + 11/4 60) — 대표 습관 a) 나간 주소 줄만 손으로 지움');
    { const E = await mk([{ pid: PA, qty: 63 }]); try {
        await setup8480(E, '네이버'); const orders = [nv(PA, 63)];
        let bg = (await E.badge())[0]; ok(bg && bg.state === 'split' && bg.ship_now && badgeText(bg) === '3/63 오늘 · 60박스 11/4 대기 · 주문 오늘 발송처리' && BK[bg.state] === 'later', '첫날 전 배지 = 「3/63 오늘 · 60박스 11/4 대기 · 주문 오늘 발송처리」(중립)', [bg, bg && badgeText(bg)]);
        const f2 = await E.forShip(D2), d2 = day(f2, D2, orders), L = f2.lines[0];
        ok(L && L.state === 'today' && L.split && L.split.today === 3 && L.split.later === 60 && L.split.later_date === D4 && /^11\/2\t/.test(L.line), '11/2 for-ship = 입력삭제 줄을 오늘 줄로(머리 11/2 · split 칸)', L);
        ok(d2.cash.rows.length === 3 && f2.waiting.length === 1 && f2.waiting[0].qty === 60 && f2.waiting[0].k === BD, '11/2 양식 = 3줄 · 60박스 대기(waiting k·qty)', [d2.cash.rows.map(r => r.cells[3]), f2.waiting]);
        ok(d2.st[PA] === 'indiv', '11/2 주문 = 입력삭제(오늘 발송처리 대상)', d2.st);
        ok(d2.chk.boxDiff.length === 1 && d2.chk.boxDiff[0].orderQty === 63 && d2.chk.boxDiff[0].cashQty === 3, '11/2 cashCheck = 63 vs 3(종전이면 모자람 카드)', d2.chk.boxDiff);
        let bx = box(f2, d2); ok(!bx.card && bx.info[0] === '가: 오늘 3박스 · 주문은 오늘 발송처리 · 나머지 60박스는 11/4', '🆕 11/2 박스 카드 0 → 참고 줄', bx);
        ok(!d2.chk.notIndiv.length && !d2.chk.missing.length, '11/2 현금 카드 0', d2.chk);
        ok(d2.card.rows.length === 1 && d2.r[PA] && d2.hold.length === 0, '11/2 자동 송장 = 주문에 운송장 1장(발송처리 1회)', [d2.card.rows, d2.r]);
        ok(JSON.stringify(formOf(d2)) === JSON.stringify(formOf(day(f2, D2, orders))) && formOf(d2).length === 3, '카드 누름 vs 없음 = 양식 줄 단위 같음(3줄 · 주문 주소 줄 0)', formOf(d2));
        const u = await used(E, D2, f2); ok(u.s === 200, '11/2 「오늘 씀」 POST', u.j);
        let R = await E.rows(), ln = R.find(r => r.kind === 'line'); ok(ln.checked && ln.checked.split_sent === D2 && ln.used_on === D2, '줄에 첫날 표식 split_sent 11/2', ln.checked);
        const ff = await E.forShip(D2); ok(ff.lines.length === 1 && ff.lines[0].state === 'today' && ff.lines[0].split, '같은 날 다시 불러와도 오늘 줄 그대로(표식 = 그날)', ff.lines);
        // 되돌리기 → 표식 지움 → 다시 씀
        await E.call('POST', '/api/order-memo/used', { date: D2, ids: f2.ids, undo: true }); R = await E.rows(); ok(!(R.find(r => r.kind === 'line').checked || {}).split_sent, '되돌리기 = 표식 지움', R.find(r => r.kind === 'line').checked);
        await used(E, D2, f2);
        // 첫날 지나 = 주문 발송 → 발송 전 주문 표에서 빠짐 · 대표 습관 a) 나간 3줄 손으로 지움
        await E.setPre([]); R = await E.rows(); await del(E, R.filter(r => r.kind === 'cash' && ['받는1', '받는2', '받는3'].includes(r.cells[3])).map(r => r.id));
        bg = (await E.badge())[0]; ok(bg && bg.state === 'sent_split' && badgeText(bg) === '발송처리 끝 · 60박스 11/4 대기' && BK[bg.state] === 'later', '③ 주문 사라진 뒤 배지 = 「발송처리 끝 · 60박스 11/4 대기」(중립 · 풀림·현금·빨강 아님)', [bg, bg && badgeText(bg)]);
        const lnB = OM.indivBadge(Object.assign({ line_key: BUY, plat: '네이버' }, ln, { checked: { split_sent: D2 } }), (await E.rows()).filter(r => r.state === 'open'), [], D4, { solo: true });
        ok(lnB.state === 'sent_split' && badgeText(lnB) === '발송처리 끝 · 오늘 60박스', '11/4 기준 배지 = 「발송처리 끝 · 오늘 60박스」', badgeText(lnB));
        const f3 = await E.forShip(D3), d3 = day(f3, D3, []);
        ok(f3.lines.length === 1 && f3.lines[0].state === 'wait' && f3.lines[0].split_sent === D2 && !f3.lines[0].split && /^11\/4\t/.test(f3.lines[0].line) && f3.split_sent.length === 1 && d3.cash.rows.length === 0 && f3.waiting.length === 1, '11/3 = 줄은 원래 날짜(11/4 대기) 그대로 + split_sent 꼬리표 · 양식 0 · 60 대기', f3.lines);
        ok(!d3.chk.notIndiv.length && !d3.chk.missing.length && !d3.chk.boxDiff.length && !d3.chk.strangers.length, '11/3 현금 카드·경고 0', d3.chk);
        ok(omDone(f3, 0) === D2, '11/3 「주문 없음」 → 「발송처리 끝(11/2)」 글로(주문이 실제로 없을 때만 · omSplitDone 실코드)', omDone(f3, 0));
        const f4 = await E.forShip(D4), d4 = day(f4, D4, []);
        ok(f4.lines.length === 1 && f4.lines[0].state === 'today' && f4.lines[0].split_sent === D2 && d4.cash.rows.length === 1 && d4.cash.rows[0].qty === 60, '11/4 양식 = 60박스 1줄 · 줄은 오늘(주문 없음 → 글만 바뀜)', [f4.lines, d4.cash.rows.map(r => [r.cells[3], r.qty])]);
        ok(omDone(f4, 0) === D2, '11/4 줄 글도 「발송처리 끝」', omDone(f4, 0));
        ok(!d4.chk.notIndiv.length && !d4.chk.missing.length && !d4.chk.boxDiff.length && d4.card.rows.length === 0, '11/4 카드 0 · 운송장 주문에 안 붙음(주문 없음)', [d4.chk, d4.card.rows]);
        const si = strangersInfo(f4, d4); ok(si.length === 1 && si[0] === '입력삭제 구매자(끝 0001): 첫날(11/2) 발송처리 끝 · 오늘 60박스(운송장은 주문에 안 붙음)', '🆕 11/4 참고 줄 = 「첫날(11/2) 발송처리 끝 · 오늘 60박스」', si);
        await used(E, D4, f4); const cl = await E.call('POST', '/api/order-memo/clear', { date: D4 }); R = await E.rows();
        ok(cl.j.cleared === 2 && R.every(r => r.state === 'cleared'), '11/4 [비우기] = 60줄 + 입력삭제 줄 같이 비움(남은 주소 줄 0)', [cl.j, R.map(r => [r.kind, r.state])]);
    } finally { await E.close(); } }

    console.log('Ⅱ 같은 꼴 — 대표 습관 b) 나간 주소 줄 + 번호 줄까지 지움');
    { const E = await mk([{ pid: PA, qty: 63 }]); try {
        await setup8480(E, '네이버'); const f2 = await E.forShip(D2); await used(E, D2, f2); await E.setPre([]);
        let R = await E.rows(); await del(E, R.filter(r => r.kind === 'line' || (r.kind === 'cash' && ['받는1', '받는2', '받는3'].includes(r.cells[3]))).map(r => r.id));
        R = await E.rows(); const left = R.filter(r => r.state === 'open');
        ok(left.length === 1 && left[0].checked && left[0].checked.split_done === D2 && left[0].checked.k === BD && left[0].cells[0] === '가구매 드림', '🆕 번호 줄 지움 = 남은 60줄에 「발송처리 끝(11/2)」 표식 옮김(A칸 「!」 없음 그대로)', left.map(r => [r.cells[3], r.checked, r.cells[0]]));
        const lo = (await E.call('GET', '/api/order-memo')).j.entries.flatMap(x => x.rows).find(r => r.kind === 'cash'); ok(lo && lo.split_done === D2 && lo.indiv === true, '목록 = split_done 칸(화면 알약 「입력삭제 · 발송처리 끝 …0001」 · #935 풀림 아님)', lo && [lo.split_done, lo.indiv]);
        // 화면 판정(ao-ordermemo cashPill·lostOf 실코드 잘라 실행)
        { const a0 = aoSrc.indexOf('    const cashPill = r => {'), a1 = aoSrc.indexOf('\n', a0), l0 = aoSrc.indexOf('    const lostOf = (r, keys) => {'), l1 = aoSrc.indexOf('\n', l0);
          const mkPill = OMlist => new Function('OM', 'esc', 'md', 'digits', 'last4', 'noLine', aoSrc.slice(l0, l1) + '\n' + aoSrc.slice(a0, a1) + '\nreturn { cashPill, lostOf };')(OMlist, x => String(x), mdF, x => String(x == null ? '' : x).replace(/\D/g, ''), x => String(x || '').replace(/\D/g, '').slice(-4), () => true);
          const P = mkPill({ list: [lo], shipDate: D4 }); ok(/입력삭제 · 발송처리 끝 …0001/.test(P.cashPill(Object.assign({ state: 'open' }, lo))) && !P.lostOf(Object.assign({ state: 'open' }, lo)), '알약 = 「입력삭제 · 발송처리 끝 …0001」 · 풀림 아님', P.cashPill(Object.assign({ state: 'open' }, lo)));
          const lo2 = Object.assign({ state: 'open' }, lo, { split_done: undefined }); ok(/입력삭제 풀림/.test(P.cashPill(lo2)) && P.lostOf(lo2), '표식 없는 줄 = 종전 「입력삭제 풀림」(#935 그대로)', P.cashPill(lo2)); }
        const f3 = await E.forShip(D3), d3 = day(f3, D3, []); ok(f3.lines.length === 0 && f3.split_sent.length === 1 && f3.split_sent[0].k === BD && f3.split_sent[0].later === 60 && f3.waiting.length === 1 && d3.cash.rows.length === 0, '11/3 = 메모 줄 0 · 양식 0 · 60 대기 · split_sent(주소 줄 표식)', f3.split_sent);
        const f4 = await E.forShip(D4), d4 = day(f4, D4, []);
        ok(d4.cash.rows.length === 1 && d4.cash.rows[0].qty === 60 && d4.cash.rows[0].cells[0] === '가구매 드림' && !d4.cash.rows[0].bang && !d4.chk.notIndiv.length && !d4.chk.boxDiff.length && d4.card.rows.length === 0, '11/4 양식 = 60박스 1줄(「!」 없는 주소 줄 · 종전과 같은 칸) · 카드 0 · 운송장 주문에 안 붙음', [d4.cash.rows[0].cells, d4.chk]);
        const si = strangersInfo(f4, d4); ok(si[0] === '입력삭제 구매자(끝 0001): 첫날(11/2) 발송처리 끝 · 오늘 60박스(운송장은 주문에 안 붙음)', '🆕 b) 11/4 참고 줄도 (b) 글', si);
        // 60줄을 고쳐 저장 = 표식 유지 · 번호(K) 바꾸면 표식 버림
        const r60 = left[0], c2 = r60.cells.slice(); c2[9] = '문 앞'; let pu = await E.call('PUT', '/api/order-memo/rows/' + r60.id, { cells: c2, ship_date: D4 }); R = await E.rows();
        ok(pu.s === 200 && R.find(r => r.id === r60.id).checked && R.find(r => r.id === r60.id).checked.split_done === D2, '60줄 메모 고쳐 저장 = 표식 유지', [pu.s, R.find(r => r.id === r60.id).checked]);
        const c3 = c2.slice(); c3[10] = '010-2600-0099'; pu = await E.call('PUT', '/api/order-memo/rows/' + r60.id, { cells: c3, ship_date: D4 }); R = await E.rows();
        ok(pu.s === 200 && !R.find(r => r.id === r60.id).checked, '번호(K) 바꿈 = 표식 버림(종전 꼴)', R.find(r => r.id === r60.id).checked);
    } finally { await E.close(); } }

    console.log('Ⅱ-가 첫날 「오늘 씀」만 찍히고 실제 발송처리 안 됨(운송장 못 붙음·[등록] 안 누름) → 과발송 0 · 사람 눈에 보임');
    { const E = await mk([{ pid: PA, qty: 63 }]); try {
        await setup8480(E, '네이버'); const orders = [nv(PA, 63)];
        const f2 = await E.forShip(D2); await used(E, D2, f2); await used(E, D2, await E.forShip(D2));   // (다) 같은 날 두 번 열기
        let R = await E.rows(); ok(R.find(r => r.kind === 'line').checked.split_sent === D2, '(다) 같은 날 두 번 = 표식 그대로 11/2', R.find(r => r.kind === 'line').checked);
        await del(E, R.filter(r => r.kind === 'cash' && ['받는1', '받는2', '받는3'].includes(r.cells[3])).map(r => r.id));   // 3박스는 나갔다고 보고 지움 · 주문은 그대로(발송처리 안 됨)
        const f3 = await E.forShip(D3), d3 = day(f3, D3, orders);
        ok(f3.lines[0].state === 'wait' && d3.st[PA] === 'excl' && d3.cash.rows.length === 0 && formOf(d3).length === 0 && d3.hold.length === 1, '(가) 11/3 = 주문 오늘 안 나감(원래 날짜 11/4 까지 뺌) · 양식 0 · 자동 송장 hold', [d3.st, formOf(d3)]);
        const bg = (await E.badge())[0]; ok(bg && bg.state === 'short' && !bg.ship_now && badgeText(bg) === '0/63 오늘 · 60박스 11/4 대기 · 3박스 모자람', '(가) 배지 = 주문 남아 있음 → 「0/63 … · 3박스 모자람」(빨강 · 발송처리 끝 아님)', [bg && bg.state, bg && badgeText(bg)]);
        const f4 = await E.forShip(D4), d4 = day(f4, D4, orders);
        ok(f4.lines[0].state === 'today' && d4.st[PA] === 'indiv' && d4.cash.rows.length === 1 && formOf(d4).length === 1, '(가) 11/4 = 주문 입력삭제 · 양식 60 1줄(주문 63 통째 안 나감 = 과발송 0)', [d4.st, formOf(d4)]);
        const bx = box(f4, d4); ok(bx.card && d4.chk.boxDiff.length === 1 && d4.chk.boxDiff[0].orderQty === 63 && d4.chk.boxDiff[0].cashQty === 60, '(가) 11/4 = 「63 vs 60」 박스 카드 뜸(사람 눈)', [bx, d4.chk.boxDiff]);
    } finally { await E.close(); } }

    console.log('Ⅲ ① 자사몰 개인결제창(수량 1 · 단가표 밖) — 첫날 발송처리 · 카드 0');
    { const E = await mk([{ ch: 'cafe24', pid: PB, qty: 1, opt: PERS }]); try {
        await setup8480(E, '자사몰'); const orders = [nv(PB, 1, PERS)];
        const bg = (await E.badge())[0]; ok(bg && bg.state === 'personal' && badgeText(bg) === '개인결제창 · 오늘 3박스 · 60박스 11/4 대기 · 주문 오늘 발송처리' && BK[bg.state] === 'pers', '배지 = 「개인결제창 · 오늘 3박스 · 60박스 11/4 대기 · 주문 오늘 발송처리」', [bg && bg.state, bg && badgeText(bg)]);
        const f2 = await E.forShip(D2), d2 = day(f2, D2, orders, { ch: 'cafe24' });
        ok(f2.lines[0] && f2.lines[0].state === 'today' && /^11\/2\t/.test(f2.lines[0].line) && d2.st[PB] === 'indiv', '11/2 = 오늘 줄 · 주문 입력삭제(첫날 발송처리)', [f2.lines[0], d2.st]);
        const bx = box(f2, d2); ok(!bx.card && bx.info[0] === '가: 개인결제창입니다! · 주소 줄 3줄 · 주문은 오늘 발송처리 · 나머지 60박스는 11/4', '11/2 박스 카드 0 · 개인결제창 안내 한 줄 + 꼬리', bx);
        ok(!d2.chk.notIndiv.length && !d2.chk.missing.length && d2.cash.rows.length === 3, '11/2 현금 카드 0 · 양식 3', d2.chk);
        await used(E, D2, f2); await E.setPre([]);
        const b2 = (await E.badge())[0]; ok(b2.state === 'sent_split' && badgeText(b2) === '발송처리 끝 · 60박스 11/4 대기', '주문 사라진 뒤 = 「발송처리 끝 · 60박스 11/4 대기」(3줄은 안 지운 상태라 오늘 몫으로도 셈 = 지우기 전 꼴)', badgeText(b2));
        note('자사몰 자동 송장 = 입력삭제 주문(indiv)이면 첫날 운송장 1장 → 발송처리 1회(자사몰 주문 꼴 normOrders 는 이 검증 밖 · 종전 B꼴과 같은 길)');
    } finally { await E.close(); } }

    console.log('Ⅳ ② 네이버 추가 주문(같은 번호 · 주문 2건 63+2) → 카드 · 일반발송(#970)으로 돌리면 맞음');
    { const E = await mk([{ pid: PA, qty: 63 }, { pid: PB, qty: 2 }]); try {
        await setup8480(E, '네이버'); const orders = [nv(PA, 63), nv(PB, 2)];
        let bg = (await E.badge())[0]; ok(bg.state === 'short' && badgeText(bg) === '3/65 오늘 · 60박스 11/4 대기 · 2박스 모자람 · 주문 오늘 발송처리', '배지 = 「3/65 … 2박스 모자람」(빨강 계열 short)', badgeText(bg));
        const f2 = await E.forShip(D2), d2 = day(f2, D2, orders);
        ok(f2.lines[0].state === 'today' && d2.st[PA] === 'indiv' && d2.st[PB] === 'indiv', '입력삭제 줄 하나 = 번호 기준(주문 수 무관) · 두 주문 다 오늘 입력삭제', d2.st);
        let bx = box(f2, d2); ok(bx.card, '65 vs 3+60 = 종전 박스 카드 그대로', bx);
        // 추가 주문을 메모함에서 일반발송으로(#970 · checked.normal_orders)
        let R = await E.rows(); const ln = R.find(r => r.kind === 'line'); const nr = await E.call('POST', '/api/order-memo/rows/' + ln.id + '/normal', { orders: [PB] }); ok(nr.s === 200, '메모함 일반발송 고름(PB)', nr.j);
        bg = (await E.badge())[0]; ok(bg.state === 'split' && badgeText(bg) === '3/63 오늘 · 60박스 11/4 대기 · 주문 오늘 발송처리 · 일반발송 1건', '배지 = 「3/63 … · 일반발송 1건」(중립)', [bg.state, badgeText(bg)]);
        const g2 = await E.forShip(D2), e2 = day(g2, D2, orders, { normal: [PB] });
        ok(e2.st[PA] === 'indiv' && e2.st[PB] === 'go', '11/2 = PA 입력삭제 · PB 주문 주소로(일반발송)', e2.st);
        bx = box(g2, e2); ok(!bx.card && bx.info[0] === '가: 오늘 3박스 · 주문은 오늘 발송처리 · 나머지 60박스는 11/4', '일반발송 뒤 = 카드 0 · 참고 줄', bx);
    } finally { await E.close(); } }

    console.log('Ⅴ 종전 불변');
    { const E = await mk([{ pid: PA, qty: 61 }]); try {   // 보통 날짜 지정(주소 줄 전부 11/4)
        await save(E, [lineRow(D4), cashRow('받는1', 1), cashRow('받는육십', 60)]);
        const f2 = await E.forShip(D2), d2 = day(f2, D2, [nv(PA, 61)]);
        ok(f2.lines[0].state === 'wait' && !f2.lines[0].split && /^11\/4\t/.test(f2.lines[0].line) && d2.st[PA] === 'excl' && d2.cash.rows.length === 0, '보통 날짜 지정 줄 = 11/2 주문 안 나감 · 양식 0(종전)', [f2.lines[0], d2.st]);
        await used(E, D2, f2); const R = await E.rows(); ok(!(R.find(r => r.kind === 'line').checked || {}).split_sent, '표식 안 찍힘', R.find(r => r.kind === 'line').checked);
        const f3 = await E.forShip(D3); ok(f3.lines.length === 1 && f3.lines[0].state === 'wait', '11/3 = 줄 그대로 대기(used_on 찍혀도 · 종전)', f3.lines);
        const bg = (await E.badge())[0]; ok(!bg.ship_now && badgeText(bg) === '0/61 오늘 · 61박스 11/4 대기', '배지 꼬리 없음(종전 글)', badgeText(bg));
    } finally { await E.close(); } }
    { const E = await mk([{ pid: PA, qty: 63 }]); try {   // 같은 번호 입력삭제 줄 2개
        await save(E, [lineRow(D4), lineRow(D4, '네이버'), cashRow('받는1', 1), cashRow('받는육십', 60)]); await dropDate(E, '받는1');
        const f2 = await E.forShip(D2); ok(f2.lines.length === 2 && f2.lines.every(l => l.state === 'wait' && !l.split), '같은 번호 줄 2개 = 종전(오늘 줄로 안 바꿈)', f2.lines);
    } finally { await E.close(); } }
    { const E = await mk([{ pid: PA, qty: 63 }]); try {   // #938 주문번호 키 줄
        const ol = Object.assign(lineRow(D4, '네이버', PA), { checked: { plat: '네이버', as: 'order', at: new Date().toISOString(), buyer: BUY } });
        await save(E, [ol, cashRow('받는1', 1), cashRow('받는육십', 60)]); await dropDate(E, '받는1');
        const f2 = await E.forShip(D2); ok(f2.lines.length === 1 && f2.lines[0].state === 'wait' && !f2.lines[0].split, '#938 주문번호 줄 = 종전', f2.lines);
    } finally { await E.close(); } }
    { const E = await mk([{ pid: PA, qty: 4 }]); try {   // 오늘 줄(B꼴) = 바이트 동일
        await save(E, [lineRow(null), cashRow('받는1', 1), cashRow('받는셋', 3, D4)]);
        const f2 = await E.forShip(D2); const keep = JSON.stringify(OM.pickForShip((await E.rows()).map(r => Object.assign({ state: 'open' }, r, { sure: true })).filter(r => r.state === 'open'), D2).lines);
        ok(f2.lines.length === 1 && f2.lines[0].state === 'nodate' && !f2.lines[0].split && f2.split_sent.length === 0, '날짜 없는 입력삭제 줄 = 종전(split 칸 없음)', f2.lines);
        await used(E, D2, f2); const R = await E.rows(); ok(!(R.find(r => r.kind === 'line').checked || {}).split_sent, '표식 안 찍힘', keep.length > 0);
    } finally { await E.close(); } }
    console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
