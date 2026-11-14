// #1146 걱정거리 가상 시험(수정 0 · 총괄 11/14 배정) — 오늘 배포분(#1140~#1146 · v5.9.795)을 실자료 꼴의 가짜 자료로 「메모함 저장 → /pair → for-ship → 최종발주(core·v2·final-order.js 실코드 잘라 실행) → 택배 양식(buildRows) → 거래처 운송장(양식 B 로 찍힘) → 자동 송장 짝(invoice-auto 실코드 + 서버와 같은 memoAddr SQL)」 한 바퀴
//   A 꼴 = 입력삭제 번호 줄 1 + 주소 줄 25(처음 B=K=보내는 분 → /pair 로 묶이며 B=K=입력삭제 번호 · pair_orig {b,k:보내는 분, ab:입력삭제 번호}) · B 꼴 = 현금 「!」 10줄 60박스(뒤 날짜)
//   🔴 실DB·실서버·채널·브라우저 0 · DB = 이 PC 메모리 pglite · 번호·이름 전부 가짜 · 포트 PORT1146(기본 3461)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-1146-worry.js   (TZ=UTC 로도 한 번)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 900))); };
const note = (m, d) => console.log('   ℹ️  ' + m + (d === undefined ? '' : ' = ' + JSON.stringify(d).slice(0, 700)));
if (!process.env.PGLITE_DIR) { console.log('PGLITE_DIR 필요'); process.exit(2); }
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const OM = require(path.join(ROOT, 'order-memo.js')), core = require(path.join(ROOT, 'public', 'final-order-core.js')), ia = require(path.join(ROOT, 'invoice-auto.js'));
const dg = v => String(v == null ? '' : v).replace(/\D/g, '');
// 품목(단가표 이름 · 사람 정보 아님)
const TY = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(중대과 L이상)', TY2 = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', TYG = '고당도 타이벡감귤 / 상품 및 과수: 선물용 - 3kg(로얄과 2S~M)';
const CAT = [TY, TY2, TYG], ORIGIN = '제주특별자치도 제주시 연삼로 1066-31';
// 가짜 번호(010-2600-… = 검증 전용 꼴) · 가짜 이름
const K2 = '010-2600-2524', K2D = dg(K2);        // 입력삭제 번호(네이버 구매자)
const B5 = '010-2600-5315', B5D = dg(B5);        // 처음 넣은 보내는 분 번호(센터장)
const K1 = '010-2600-1318', B9 = '010-2600-9480'; // B 꼴 현금 줄
const SENDER = '한가짜센터 김가짜 센터장', HOME2 = '서울특별시 가짜구 주문로 24', HOME5 = '경기도 가짜시 센터로 53';
const D0 = '2026-11-14', D1 = '2026-11-15', D3 = '2026-11-17', D4 = '2026-11-18';
const PA = '2026111400002524', PX = '2026111400005315', PC = '2026111400000003';
const nv = (pid, buyer, q, opt, nm, tel, ad) => ({ _pid: pid, '구매자연락처': buyer, '수취인명': nm || '가구매', '수취인연락처1': tel || buyer, '통합배송지': ad || HOME2, '옵션정보': opt || TY, '수량': q });
// ── 실코드 잘라 실행 ──
const cut = (s, a0, end, from) => { const a = s.indexOf(a0, from || 0); if (a < 0) throw new Error('없음 ' + a0); const b = s.indexOf(end, a); if (b < 0) throw new Error('끝 없음 ' + end); return s.slice(a, b + end.length); };
const v2src = fs.readFileSync(path.join(ROOT, 'public', 'invoice-v2.js'), 'utf8').replace(/\r\n/g, '\n');
const V2 = new Function('matchKey', [cut(v2src, 'const isoOf = ', ';\n'), cut(v2src, 'function parseDate(s, today) {', '\n    }\n'), cut(v2src, 'const chOfText = ', ';\n'), cut(v2src, 'function parseLines(txt, boxCh, today) {', '\n        return out;\n    }\n'), cut(v2src, '    function applyLines(ctx, force = true) {', '\n        });\n    }\n')].join('\n') + '\nreturn { parseLines, applyLines };');
const v2 = V2((ctx, e, digits, key) => (digits.length >= 8 && e.digits === digits) || (key && e.pid === key));
const foSrc = fs.readFileSync(path.join(ROOT, 'public', 'final-order.js'), 'utf8').replace(/\r\n/g, '\n');
// (1) for-ship 응답 → OMF.cash(out 칸 포함 · #1146) = final-order.js omInsert 안 두 줄 그대로
const omCashFn = new Function('r', 'core', cut(foSrc, '        const parsed = Array.isArray(r.cash_aoa)', '{})) : [];\n').replace(/OMF\.cash = /, 'var __c = ') + '\nreturn __c;');
const omCash = r => omCashFn(r, () => core);
// (2) 양식 직전 cashOut(#1146) · (3) 사이즈 꼬리 cashRowsWithSize(#572) · (4) 박스 카드 → 참고 줄 블록(#1121) · (5) swap 글(#1145)
const cashOutFn = new Function(cut(foSrc, '        const cashOut = rows =>', ';\n') + '\nreturn cashOut;')();
const sizeItem = new Function(cut(foSrc, '    const sizeItem = s =>', ';\n') + '\nreturn sizeItem;')();
const cwsSrc = [cut(foSrc, '    const withTail = (name, t) =>', ';\n'), cut(foSrc, '    const boxGroup = tails =>', ';\n'), cut(foSrc, '    function cashRowsWithSize(rows) {', '\n    }\n')].join('\n');
const cashRowsWithSize = (rows, st, merged, byPartner) => new Function('st', 'S', 'core', 'inCatalog', 'sizeItem', 'keyOf', 'buyerTel', cwsSrc + '\nreturn cashRowsWithSize;')(st, () => ({ merged }), () => core, n => CAT.includes(n), sizeItem, e => e.pid, e => dg(e.buyer))(rows);
const blk = cut(foSrc, '            const spl = !OMF.removed', "{ info.push(`${buyer}: 오늘 ${cq}박스${splTail}`); return; }");
const boxFn = new Function('OMF', 'crow', 'd', 'es', 'buyer', 'info', 'md', 'core', 'inCatalog', 'qtyOf', 'optOf', 'ik', 'optLab', blk + '\nreturn "card";');
const swapFn = new Function('sum', 'oq', 'cq', 'table', cut(foSrc, '            const swap = sum && oq === cq && table', ';\n') + '\nreturn swap;');
const ik = o => String(o == null ? '' : o).replace(/\s+[^\s]*로!$/, '').replace(/\s+/g, ' ').trim();
const mdF = iso => iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : '';
const omfOf = fs1 => ({ removed: false, lines: (fs1.lines || []).map(x => ({ id: x.id, text: String(x.line || ''), checked: x.checked || null, lstate: x.state || null, sd: x.ship_date || null, split: x.split && typeof x.split === 'object' ? x.split : null, splitSent: /^\d{4}-\d{2}-\d{2}$/.test(String(x.split_sent || '')) ? x.split_sent : null })), splitSent: Array.isArray(fs1.split_sent) ? fs1.split_sent : [] });
// 중간발주 qtyBuild(ao-desk.js 실코드 · verify-1121-qty 와 같은 떼기)
const aoSrc = fs.readFileSync(path.join(ROOT, 'public', 'ao-desk.js'), 'utf8');
function qtyRun(input) {
    const a = aoSrc.indexOf('    const QTY_PH = new Set('), b = aoSrc.indexOf('    function qtyOpen() {'), qs = aoSrc.match(/^    const QTY_SIZE = .*$/m);
    const PR = { '효돈': CAT }, MATCH = Object.fromEntries(CAT.map(n => ['아꼼이네 상품선택: 1. (제철)' + n, n]));
    const ctx = { window: { FinalOrderCore: core }, console, QTY: { src: input.src, om: input.om || null, cash: null }, addSizeSuffix: o => o, matchProduct: o => MATCH[o] || CAT.find(n => n === o) || ('[미매칭] ' + o), qtyCategory: () => 'c', aoItemPartner: n => (CAT.includes(n) ? '효돈' : null), aoInvoicePricingByPartner: PR };
    vm.createContext(ctx); vm.runInContext(qs[0] + '\n' + aoSrc.slice(a, b) + '\n;globalThis.__r = qtyBuild();', ctx);
    return { ok: ctx.__r, base: ctx.QTY.base, stat: ctx.QTY.stat };
}
// ── 최종발주 한 바퀴(날짜 · for-ship 응답 · 주문 · 옵션) ──
//   opt.normal = 일반발송 pid · opt.sizeLines = st.sizeLines(사이즈 꼬리) · opt.extraShips = 양식 밖 운송장(다른 주문 것) · opt.memoAddr = 서버 memoAddr 대신 쓸 값(undefined = DB 에서 서버 SQL 그대로)
async function day(E, date, orders, opt) {
    const o0 = opt || {}, fs1 = await E.forShip(date);
    const prep = core.prepLines(fs1.memo_text, { realToday: date, shipDate: date, shipDays: [D1, D3, D4] });
    const merged = orders.map(o => ({ ch: o._ch || 'naver', pid: o._pid, digits: dg(o['구매자연락처']), buyer: o['구매자연락처'], conv: { '수량': o['수량'] }, excluded: false, userTouched: false, memoFlag: null, opt: o['옵션정보'], qty: Number(o['수량']) }));
    const ctx = { today: date, allowIndiv: true, merged, lines: { naver: [], cafe24: [], coupang: [] } };
    const all = v2.parseLines(prep.v2Text, 'naver', date); all.forEach(l => { if (!l.bad) ctx.lines[l.ch].push(l); }); ctx.allLines = all; v2.applyLines(ctx);
    merged.forEach(e => { if ((o0.normal || []).includes(e.pid) && e.individual) { e.individual = false; e._indivOff = true; } });
    const omc = omCash(fs1), live = omc.map((r, i) => Object.assign({}, r, { no: i + 2, om: true }));   // omApplyCash(엑셀 없음)
    const chk = core.cashCheck({ orders: merged.map(e => ({ key: e.pid, digits: e.digits, qty: e.qty, individual: !!e.individual, excluded: !!e.excluded, buyer: '가', opt: e.opt })), cash: live });
    // 박스 카드(구매자마다)
    const cards = [], info = [];
    const bd = new Map(); chk.boxDiff.forEach(m => bd.set(m.digits, { m, sum: false })); (chk.itemDiff || []).forEach(m => { if (!bd.has(m.digits)) bd.set(m.digits, { m, sum: true }); });
    bd.forEach(({ m, sum }, d) => { const es = merged.filter(e => (e.individual || e._indivOff) && !e.excluded && e.digits === d), crow = live.filter(r => !r.bang && !r.service && r.digits === d);
        const v = boxFn(omfOf(fs1), crow, d, es, '가', info, mdF, () => core, n => CAT.includes(n), e => e.qty, e => e.opt, ik, x => x);
        if (v === 'card') { const oq = es.reduce((n, e) => n + e.qty, 0), cq = crow.reduce((n, r) => n + (Number(r.qty) || 0), 0); let table = null; if (es.every(e => ik(e.opt)) && crow.every(r => ik(r.opt))) { const w = new Map(), h = new Map(); es.forEach(e => { const k = ik(e.opt); w.set(k, (w.get(k) || 0) + e.qty); }); crow.forEach(r => { const k = ik(r.opt); h.set(k, (h.get(k) || 0) + (Number(r.qty) || 0)); }); table = [...new Set([...w.keys(), ...h.keys()])].map(k => ({ it: k, lab: k, o: w.get(k) || 0, c: h.get(k) || 0 })); }
            cards.push({ d, oq, cq, sum, swap: swapFn(sum, oq, cq, table) }); } });
    // 양식 = cashOut(cashRowsWithSize(cashLive())) → buildRows
    const st = { sizeLines: o0.sizeLines || [], upLines: [], patch: new Map() };
    const cashRows = cashOutFn(cashRowsWithSize(live, st, merged.map(e => Object.assign({}, e, { individual: !!e.individual })), { '효돈': CAT }));
    const out = core.buildRows({ program: [], cash: cashRows, byPartner: { '효돈(가짜)': CAT }, picks: {}, senderByKey: new Map(), defaultMemo: '' });
    const form = out.partners.flatMap(p => p.rows).map(r => r.cells.map(c => String(c.v == null ? '' : c.v)));
    // 거래처 운송장 = 양식 줄마다 박스 수만큼 1장(보내는분전화 = 양식 B) + 주문 주소로 나가는 일반 주문(보내는분전화 = 구매자 번호 · app.js senderTel) + opt.extraShips
    let i = 0; const tr = () => '68' + date.replace(/\D/g, '').slice(4) + '0' + String(10000 + (++i)), ships = [];
    form.forEach(c => { for (let q = 0; q < (Number(c[5]) || 1); q++) ships.push({ tr: tr(), nm: c[3], tel: c[6], ad: c[8], op: c[4], q: 1, sn: c[0], stel: c[1] }); });
    merged.forEach(e => { if (!e.individual && !e.excluded) { const o = orders.find(x => x._pid === e.pid); for (let q = 0; q < e.qty; q++) ships.push({ tr: tr(), nm: o['수취인명'], tel: o['수취인연락처1'], ad: o['통합배송지'], op: o['옵션정보'], q: 1, sn: '가구매(제주아꼼이네)', stel: o['구매자연락처'] }); } });
    (o0.extraShips || []).forEach(s => ships.push(Object.assign({ tr: tr(), q: 1 }, s)));
    // 자동 송장(서버 /match 와 같은 입력) · memoAddr = 서버 SQL 그대로(used_on 은 최종발주가 omPost 로 찍음 = 여기선 /used 호출 뒤 읽음)
    const os = ia.normOrders('naver', orders.filter(o => !o._ch)).concat(ia.normOrders('cafe24', orders.filter(o => o._ch === 'cafe24')), ia.normOrders('coupang', orders.filter(o => o._ch === 'coupang')));
    const ind = merged.filter(e => e.individual && !e.excluded).map(e => e.ch + ':' + e.pid), hold = merged.filter(e => e.excluded).map(e => e.ch + ':' + e.pid);
    const memoAddr = o0.memoAddr !== undefined ? o0.memoAddr : await E.memoAddr(date), memoGuard = o0.memoGuard !== undefined ? o0.memoGuard : await E.memoGuard(date);
    const m = ia.matchShipments({ ships: ia.normShips(ships, '효돈'), orders: os, pricingNames: CAT, indivKeys: o0.noInd ? [] : ind, holdKeys: hold, memoAddr, memoGuard, ordersPartial: !!o0.partial }), card = ia.buildCard(m, os);
    const stt = {}; merged.forEach(e => { stt[e.pid] = e.individual ? (e.excluded ? 'indiv+excl' : 'indiv') : e.excluded ? 'excl' : 'go'; });
    const sum = { a: m.assign.map(a => [a.o.order_key, a.rule, a.ships.length]).sort(), ex: m.extra.length, um: m.unmatched.length, td: m.todos.map(t => [t.o.order_key, t.rule, t.options.length]), cash: m.cash.length, why: m.unmatched.slice(0, 2).map(ia.unmatchedWhy) };
    return { fs1, st: stt, chk, cards, info, omc, form, qty: out.partners.map(p => p.qty), ships, sum, card, memoAddr, memoGuard, os, ind: o0.noInd ? [] : ind };
}
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) { const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }
const lineRow = (key, date, plat) => ({ kind: 'line', key, note: '입력o삭제x', plat: plat || '네이버', ship_date: date || null, line: [date ? mdF(date) : '', key, '입력o삭제x', plat || '네이버'].join('\t'), src: 'edit', checked: { plat: plat || '네이버', as: 'buyer', at: new Date().toISOString() } });
// 현금 「!」 줄(A 꼴 처음 모습 = 보내는 분 B=K=센터장 번호) · 받는 분 n
const recv = n => ['받는' + n, '010-2600-' + String(3000 + n).padStart(4, '0'), '부산광역시 가짜구 ' + n + '로 ' + n];
const bangRow = (n, A, B, K, opt, q, date) => ({ kind: 'cash', src: 'edit', ship_date: date || null, cells: [A, B, ORIGIN, recv(n)[0], opt || TY, String(q || 1), recv(n)[1], '', recv(n)[2], '', K, '', ''] });

(async () => {
    let port = Number(process.env.PORT1146) || 3461;
    const mk = async pre => {
        const db = new PGlite();
        await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
        await db.query(`INSERT INTO pricing (partner, start_date, end_date, items) VALUES ('효돈(가짜)', '2026-01-01', '2026-12-31', $1)`, [JSON.stringify(CAT.map(n => ({ name: n, price: 1 })))]);
        await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false, result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
        for (const q of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(q);
        const app = express(); app.use(express.json()); const auth = (req, res, next) => { req.user = { id: 991146, name: '검증', position: '', role: 'staff' }; next(); };
        const api = OM.mount(app, { pool: mkPool(db), authMiddleware: auth, writeAudit: async () => {}, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }), cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => D0, noTimers: true, anthropic: null, shipCal: async () => ({ realToday: D0, shipDays: [D1, D3, D4], suggested: D1 }) });
        const p = port; const srv = await new Promise(r => { const s = http.createServer(app).listen(p, '127.0.0.1', () => r(s)); });
        await api.ensure(); await api.preEnsure();
        const call = async (method, url, body) => { const r = await fetch('http://127.0.0.1:' + p + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
        const setPre = async list => { await db.query('DELETE FROM order_memo_preorders'); for (const o of list) await db.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, paid_at) VALUES ($1,$2,$2,'가구매',$3,'가구매',$3,$4,$5,$6,NOW())`, [o.ch || 'naver', o.pid, dg(o.buyer || K2), HOME2, o.ch === 'cafe24' ? o.opt : '아꼼이네 상품선택: 1. (제철)' + (o.opt || TY), o.qty]); };
        await setPre(pre || []);
        const E = { db, srv, call, setPre,
            forShip: async d => (await call('GET', '/api/order-memo/for-ship?sm=1&date=' + d)).j,
            rows: async () => (await db.query(`SELECT id, entry_id, kind, state, cells, ship_date::text AS ship_date, used_on::text AS used_on, line_key, line, checked, sure, service, pair_orig FROM order_memo_rows ORDER BY id`)).rows,
            list: async () => (await call('GET', '/api/order-memo')).j.entries.flatMap(x => x.rows),
            save: async rows => { const e = await call('POST', '/api/order-memo', { raw: '시험', rows }); if (e.s !== 200) throw new Error('저장 ' + JSON.stringify(e.j)); return e.j.rows; },
            pair: async (key, ids, pick, origs) => call('POST', '/api/order-memo/pair', Object.assign({ key, ids }, pick ? { pick: true } : {}, origs ? { origs } : {})),
            put: async (id, body) => call('PUT', '/api/order-memo/rows/' + id, body),
            del: async ids => { for (const id of [].concat(ids)) await call('DELETE', '/api/order-memo/rows/' + id); },
            used: async (d, f) => call('POST', '/api/order-memo/used', { date: d, ids: f.ids }),
            // 서버 invoice-auto.js /match 의 memoAddr 읽기(SQL·꼴 그대로 · 바뀌면 여기도 고칠 것)
            memoAddr: async d => { const mr = await db.query(`SELECT kind, cells, service, pair_orig FROM order_memo_rows WHERE kind = 'cash' AND (ship_date = $1::date OR (ship_date IS NULL AND used_on = $1::date)) AND (state = 'open' OR used_on = $1::date)`, [d]);
                return (mr.rows || []).filter(r => Array.isArray(r.cells)).map(r => ({ name: r.cells[3], tel: r.cells[6], k: r.cells[10], opt: r.cells[4], ob: (() => { try { const x = OM.outBK(r); return x ? x.b : ''; } catch (e) { return ''; } })(), block: !!r.service || /[!！]/.test(String(r.cells[0] || '')) })); },
            // #1147 막이용 memoGuard(서버 SQL 그대로 · 표식·채널 무관)
            memoGuard: async d => { const gr = await db.query(`SELECT kind, cells, service, pair_orig FROM order_memo_rows WHERE kind = 'cash' AND pair_orig IS NOT NULL AND (ship_date = $1::date OR (ship_date IS NULL AND (used_on = $1::date OR (used_on IS NULL AND state = 'open'))))`, [d]);
                return (gr.rows || []).filter(r => Array.isArray(r.cells)).map(r => ({ name: r.cells[3], tel: r.cells[6], k: r.cells[10], opt: r.cells[4], ob: (() => { try { const x = OM.outBK(r); return x ? x.b : ''; } catch (e) { return ''; } })(), block: !!r.service || /[!！]/.test(String(r.cells[0] || '')) })); },
            close: () => new Promise(r => srv.close(r)) };
        return E;
    };
    // A 꼴 만들기 = 「!」 현금 줄 25(B=K=센터장 번호) 저장 → 입력삭제 줄 저장 → /pair(② 판 [바꾸기]) → 실DB 와 같은 pair_orig {b,k:센터장 · ab:입력삭제 번호}
    //   = 화면(ao-ordermemo.js 2622~2629 · 1744) 그대로: 매칭 판에서 K(·B 가 K 와 같으면 B 도)를 입력삭제 번호로 바꿔 저장 → /pair { key, ids, origs:{id:{a,b:처음 B,k:처음 K,d}} }
    const pairUI = async (E, key, saved, orig) => E.pair(key, saved.map(r => r.id), false, Object.fromEntries(saved.map(r => [String(r.id), Object.assign({ a: SENDER, b: B5, k: B5, d: r.ship_date || null }, orig || {})])));
    const setupA = async (E, n, lineDate, opt) => { const o = opt || {}; const cash = await E.save(Array.from({ length: n }, (_, i) => bangRow(i + 1, o.A !== undefined ? o.A : SENDER + '!', o.B0 !== undefined ? o.B0 : K2, K2, o.opt, 1, o.cashDate))); const ln = await E.save([lineRow(K2, lineDate)]); const p = await pairUI(E, K2, cash, o.orig); return { cash, line: ln[0], pair: p.j }; };
    const vals = (rows, i) => [...new Set(rows.map(r => r[i]))];

    console.log('Ⅰ A 꼴(입력삭제 25줄 · 처음 B=K=센터장 → 묶이며 B=K=입력삭제 번호) 한 바퀴');
    { const E = await mk([{ pid: PA, qty: 25 }]); try {
        const S0 = await setupA(E, 25, null); ok(S0.pair.n === 25, '/pair = 25줄 묶임', S0.pair);
        const R = (await E.rows()).filter(r => r.kind === 'cash');
        ok(R.every(r => dg(r.cells[1]) === K2D && dg(r.cells[10]) === K2D && !/!/.test(r.cells[0]) && r.pair_orig && dg(r.pair_orig.b) === B5D && dg(r.pair_orig.k) === B5D && dg(r.pair_orig.ab) === K2D), '저장값 = B·K 입력삭제 번호 · pair_orig {b,k 센터장 · ab 입력삭제}(실DB 꼴)', R.slice(0, 1).map(r => [r.cells[0], r.cells[1], r.cells[10], r.pair_orig]));
        ok(R.every(r => r.cells[0] === SENDER + ' 드림'), '#1143 A칸 = 「… 센터장 드림」(「!」 없음 · 저장값)', vals(R.map(r => r.cells), 0));
        const li = (await E.list()).filter(r => r.kind === 'cash'); ok(li.every(r => r.out_b === B5 && r.out_k === B5 && r.cells[0] === SENDER + ' 드림'), '목록 out_b·out_k = 센터장 번호 · 화면 A칸 드림 한 번', li.slice(0, 1).map(r => [r.out_b, r.out_k, r.cells[0]]));
        const orders = [nv(PA, K2, 25)];
        const d = await day(E, D1, orders);
        ok(d.st[PA] === 'indiv', '최종발주 = 주문 입력삭제(양식에서 빠짐)', d.st);
        ok(d.fs1.cash_aoa.length === 26 && d.fs1.cash_out.length === 25 && d.fs1.cash_out.every(x => x && x.b === B5 && x.k === B5) && d.fs1.cash_ids.length === 25, 'for-ship = cash_aoa 25 · cash_out 25 전부 {센터장,센터장} · cash_ids 같은 길이', [d.fs1.cash_aoa.length, d.fs1.cash_out.slice(0, 2)]);
        ok(d.fs1.cash_aoa.slice(1).every(c => c[0] === SENDER + ' 드림' && c[1] === K2 && c[10] === K2), 'cash_aoa(짝짓기용) = A 드림 한 번 · B·K 입력삭제 번호 그대로', d.fs1.cash_aoa[1]);
        ok(d.omc.length === 25 && d.omc.every(r => r.out && r.out.b === B5 && r.out.k === B5 && r.digits === K2D && !r.bang), '최종발주 OMF.cash = out 칸 25 · digits(짝 열쇠) 입력삭제 번호 · bang 아님', d.omc[0] && [d.omc[0].out, d.omc[0].digits]);
        ok(!d.chk.boxDiff.length && !d.chk.notIndiv.length && !d.chk.missing.length && !d.chk.strangers.length && !(d.chk.itemDiff || []).length && !d.cards.length, '카드 0(25 vs 25)', d.chk);
        ok(d.form.length === 25 && vals(d.form, 1).join() === B5 && vals(d.form, 10).join() === B5 && vals(d.form, 0).join() === SENDER + ' 드림', '🔴 양식 25행 = B·K 전부 센터장 번호 · 보내는 분 「… 드림」', [d.form.length, vals(d.form, 1), vals(d.form, 10), vals(d.form, 0)]);
        ok(d.qty.length === 1 && d.qty[0].length === 1 && d.qty[0][0].qty === 25 && d.qty[0][0].name === TY, '수량표 = 거래처 1 · 품목 1 · 25박스', d.qty);
        ok(d.ships.length === 25 && d.ships.every(s => s.stel === B5), '운송장 25장 · 보내는분전화 = 센터장 번호(양식 B)', d.ships.length);
        ok(d.memoAddr.length === 0, '최종발주가 「오늘 씀」을 찍기 전 = memoAddr 0(주소 줄 날짜 없음 · used_on 없음)', d.memoAddr.length);
        note('used_on 전 자동 송장(memoAddr 0)', d.sum);
        const u = await E.used(D1, d.fs1); ok(u.s === 200 && u.j.n === 26, '「오늘 씀」 26줄(최종발주 omPost 와 같음)', u.j);
        const d2 = await day(E, D1, orders);
        ok(d2.memoAddr.length === 25 && d2.memoAddr.every(x => dg(x.k) === K2D && dg(x.ob) === B5D && !x.block), 'memoAddr 25 = k 입력삭제 번호 · ob 센터장 번호(#1146 obs)', d2.memoAddr[0]);
        ok(d2.sum.a.length === 1 && d2.sum.a[0][0] === PA && /^indiv_/.test(d2.sum.a[0][1]) && d2.sum.a[0][2] === 1 && d2.sum.ex === 24 && d2.sum.um === 0 && d2.sum.td.length === 0, '🔴 자동 송장 = 주문에 1장(발송처리 1회) · 나머지 24 extra · unmatched 0 · 할 일 0', d2.sum);
        ok(d2.card.rows.length === 1 && d2.card.orders_without_tracking === 0, '카드 = 주문 1줄 · 운송장 없는 주문 0', [d2.card.rows.length, d2.card.orders_without_tracking]);
        // 종전(#1146 전 = 양식 B=K=입력삭제 번호) 운송장이면 memoAddr 없어도 붙었음 → 지금은 memoAddr 에 기댐
        const old = ia.matchShipments({ ships: ia.normShips(d2.ships.map(s => Object.assign({}, s, { stel: K2 })), '효돈'), orders: ia.normOrders('naver', orders), pricingNames: CAT, indivKeys: ['naver:' + PA], holdKeys: [], memoAddr: [] });
        ok(d2.memoGuard.length === 25 && d2.memoGuard.every(x => dg(x.ob) === B5D && dg(x.k) === K2D), '#1147 memoGuard 25(그날 짝 줄 · ob 센터장)', d2.memoGuard.length);
        const now0 = ia.matchShipments({ ships: ia.normShips(d2.ships, '효돈'), orders: ia.normOrders('naver', orders), pricingNames: CAT, indivKeys: ['naver:' + PA], holdKeys: [], memoAddr: [], memoGuard: d2.memoGuard });
        ok(old.assign.length === 1 && now0.assign.length === 0 && now0.todos.length === 1 && now0.todos[0].rule === 'todo_indiv_none' && now0.unmatched.length === 25 && /처음 넣은 보내는 분 번호/.test(ia.unmatchedWhy(now0.unmatched[0])), '🟠(#1147 뒤도 남는 틈 · 안전 쪽) memoAddr 못 읽음(표식·used_on 없음) = 입력삭제 주문 「운송장 못 찾음」 할 일 + 25 unmatched(막이 이유 글 · 등록 안 막힘)', { old: old.assign.length, now: [now0.assign.length, now0.todos.map(t => t.rule), now0.unmatched.length], why: ia.unmatchedWhy(now0.unmatched[0]) });
        const noInd = ia.matchShipments({ ships: ia.normShips(d2.ships, '효돈'), orders: ia.normOrders('naver', orders), pricingNames: CAT, indivKeys: [], holdKeys: [], memoAddr: d2.memoAddr, memoGuard: d2.memoGuard });
        ok(noInd.assign.length === 0 && noInd.unmatched.length === 25, '🟠 표식(IND) 없는 날 = 안 붙음(unmatched 25 · 「운송장 없는 주문」 숫자만 · 종전과 같은 미매칭)', [noInd.assign.length, noInd.unmatched.length, noInd.todos.length]);
        const pF = await day(E, D1, orders, { partial: true }); ok(pF.sum.a.length === 1 && pF.sum.a[0][2] === 1 && pF.sum.ex === 24 && pF.sum.um === 0 && pF.sum.td.length === 0, '#1147 채널 실패 + memoAddr 읽힘 = 그대로 1장 붙음(obs 일치 묶기 유지) · 24 extra', pF.sum);
        const pN = await day(E, D1, orders, { partial: true, memoAddr: [] }); ok(pN.sum.a.length === 0 && pN.sum.td.length === 1 && pN.sum.um === 25, '#1147 채널 실패 + memoAddr 없음(막이만) = 할 일 1 + 25 unmatched(안전)', pN.sum);
        const pZ = await day(E, D1, orders, { partial: true, memoAddr: [], memoGuard: [] }); ok(pZ.sum.a.length === 0 && pZ.sum.td.length === 1 && pZ.sum.um === 25, '메모함 표 자체 못 읽음 = 같은 미매칭(남는 틈 · 오매칭 아님)', pZ.sum);
        // 중간발주 qtyBuild = 최종발주 수량표와 같은 25
        const q = qtyRun({ src: { nv: { ok: true, rows: [{ 구매자연락처: K2, 옵션정보: '아꼼이네 상품선택: 1. (제철)' + TY, 배송메세지: '', 수량: '25', 수취인명: '가구매', _pid: PA }] }, cp: { ok: true, rows: [] }, cf: { ok: true, rows: [] } }, om: { ok: true, date: D1, lines: d2.fs1.lines, cash_aoa: d2.fs1.cash_aoa } });
        ok(q.ok && (q.base.items || []).filter(x => x.name === TY).reduce((s, x) => s + x.qty, 0) === 25 && !(q.base.urows || []).length, '중간발주 qtyBuild = 25(주소 줄 박스 · 수량표와 같음 · 미매칭 0)', q.base);
        // 만든 양식을 현금파일로 다시 올리면(정상 흐름 아님)
        const pc = core.parseCash([core.HEADERS.slice(), ...d2.form]), chk2 = core.cashCheck({ orders: [{ key: PA, digits: K2D, qty: 25, individual: true, excluded: false, buyer: '가', opt: TY }], cash: pc.rows });
        ok(pc.ok && pc.rows.every(r => !r.bang && r.digits === B5D) && chk2.missing.length === 1 && chk2.strangers.length === 1, '🔵 만든 양식을 현금파일로 다시 읽으면 K = 센터장 번호라 입력삭제 번호와 짝이 안 맞음 → 「주소 줄 없음」+「현금파일에만 있는 구매자」 카드(종전엔 그대로 짝 · 재업로드는 정상 흐름 아님)', { digits: [...new Set(pc.rows.map(r => r.digits))], missing: chk2.missing.length, strangers: chk2.strangers.length });
        // TZ 확인용 날짜 글
        ok(d2.fs1.lines.length === 1 && d2.fs1.lines[0].state === 'nodate' && d2.fs1.date === D1, 'for-ship 날짜 = 11/15 · 줄 nodate(종전)', d2.fs1.lines);
    } finally { await E.close(); } }

    console.log('Ⅱ 센터장 번호 주인이 그날 자기 네이버 주문도 있음 · 같은 보내는 분의 두 묶음 · 받는 분 겹침');
    { const E = await mk([{ pid: PA, qty: 25 }, { pid: PX, buyer: B5, qty: 1 }]); try {
        await setupA(E, 25, null); const f = await E.forShip(D1); await E.used(D1, f);
        const self = nv(PX, B5, 1, TY, '센터장본인', B5, HOME5), orders = [nv(PA, K2, 25), self];
        // (a) 자기 주문 운송장 있음(양식 B = 구매자 번호 = 센터장 번호 · 받는 분 = 본인)
        let d = await day(E, D1, orders);
        ok(d.st[PX] === 'go' && d.ships.length === 26 && d.ships.every(s => s.stel === B5), '양식 밖 일반 주문 1 · 운송장 26장 전부 보내는분전화 = 센터장 번호', [d.st, d.ships.length]);
        ok(d.sum.a.length === 2 && d.sum.a.find(x => x[0] === PX)[1] === 'auto' && /^indiv_/.test(d.sum.a.find(x => x[0] === PA)[1]) && d.sum.ex === 24 && d.sum.um === 0 && d.sum.td.length === 0, '(a) 본인 주문 auto 1장 · 입력삭제 주문 1장 · 24 extra · 0 unmatched', d.sum);
        // (b) 자기 주문 운송장 아직 없음 → 묶음 운송장을 뺏지 않음
        const d0 = await day(E, D1, orders); const m2 = ia.matchShipments({ ships: ia.normShips(d0.ships.filter(s => s.nm !== '센터장본인'), '효돈'), orders: ia.normOrders('naver', orders), pricingNames: CAT, indivKeys: ['naver:' + PA], holdKeys: [], memoAddr: d0.memoAddr });
        ok(m2.assign.length === 1 && m2.assign[0].o.order_key === PA && !m2.assign.some(a => a.o.order_key === PX) && m2.extra.length === 24 && m2.unmatched.length === 0, '(b) 본인 운송장 없음 = 본인 주문은 「운송장 없음」 · 묶음 운송장 안 뺏음', { a: m2.assign.map(a => [a.o.order_key, a.rule]), ex: m2.extra.length, um: m2.unmatched.length, td: m2.todos.map(t => t.rule) });
        for (const [lb, o] of [['memoAddr 없음(막이만)', {}], ['채널 실패 + memoAddr 없음', { partial: true }], ['표식 없음 + memoAddr 없음', { noInd: true }]]) {
            const dd = await day(E, D1, orders, o); const mm = ia.matchShipments({ ships: ia.normShips(dd.ships.filter(s => s.nm !== '센터장본인'), '효돈'), orders: dd.os, pricingNames: CAT, indivKeys: dd.ind, holdKeys: [], memoAddr: [], memoGuard: dd.memoGuard, ordersPartial: !!o.partial });
            ok(!mm.assign.some(a => a.o.order_key === PX) && mm.unmatched.length === 25, '#1147 핵심 · (b) ' + lb + ' = 본인 주문에 묶음 운송장 안 붙음(unmatched 25)', { a: mm.assign.map(a => [a.o.order_key, a.rule]), um: mm.unmatched.length, td: mm.todos.map(t => t.rule) }); }
        { const dd = await day(E, D1, orders); const mm = ia.matchShipments({ ships: ia.normShips(dd.ships, '효돈'), orders: dd.os, pricingNames: CAT, indivKeys: dd.ind, holdKeys: [], memoAddr: [], memoGuard: dd.memoGuard });
          ok(mm.assign.length === 1 && mm.assign[0].o.order_key === PX && mm.assign[0].rule === 'auto', '(a) memoAddr 없음 · 본인 운송장 있음 = 본인 주문 자기 운송장 auto 그대로(막이가 보통 주문을 안 뗌)', mm.assign.map(a => [a.o.order_key, a.rule])); }
        // (c) 센터장 번호 자기 입력삭제 묶음도 있음(B=K=센터장 · 같은 저장 묶음 markIndiv 길) + 받는 분 한 명(받는3) 겹침
        await E.setPre([{ pid: PA, qty: 25 }, { pid: PX, buyer: B5, qty: 5 }]);
        const own = await E.save([lineRow(B5, null), ...[3, 101, 102, 103, 104].map(n => Object.assign(bangRow(n, SENDER, B5, B5), { cells: bangRow(n, SENDER, B5, B5).cells }))]);
        const ownRows = (await E.rows()).filter(r => r.entry_id === own[0].entry_id && r.kind === 'cash');
        ok(ownRows.length === 5 && ownRows.every(r => dg(r.cells[10]) === B5D && !/!/.test(r.cells[0]) && r.pair_orig && dg(r.pair_orig.ab) === B5D), '자기 묶음 5줄 = 주소 줄(markIndiv) · pair_orig ab = 자기 번호', ownRows[0] && [ownRows[0].cells[0], ownRows[0].pair_orig]);
        const f2 = await E.forShip(D1); await E.used(D1, f2);
        const orders2 = [nv(PA, K2, 25), nv(PX, B5, 5)]; d = await day(E, D1, orders2);
        ok(d.st[PA] === 'indiv' && d.st[PX] === 'indiv' && d.form.length === 30 && vals(d.form, 1).join() === B5 && vals(d.form, 10).join() === B5, '두 묶음 다 입력삭제 · 양식 30행 B·K 전부 센터장 번호', [d.st, d.form.length, vals(d.form, 1), vals(d.form, 10)]);
        ok(!d.cards.length && !d.chk.boxDiff.length && !d.chk.missing.length, '카드 0(25 vs 25 · 5 vs 5)', d.chk);
        ok(d.sum.a.length === 2 && d.sum.a.every(x => /^indiv_/.test(x[1]) && x[2] === 1) && d.sum.td.length === 0 && d.sum.um + d.sum.ex === 28, '(c) 두 입력삭제 주문 각 1장 · 할 일 0 · 나머지 28 = extra/unmatched', d.sum);
        ok(d.sum.um <= 2, '(c) 겹친 받는 분(받는3) 2장만 구매자 둘이라 안 묶임(unmatched ≤ 2 · 등록 안 막음)', [d.sum.um, d.sum.why]);
    } finally { await E.close(); } }

    console.log('Ⅲ 묶인 뒤 B 고침 · 처음 B 빈칸 · pair_orig 없는 옛 줄 · rekey · 번호 줄 지움(풀림) · 풀림 → [현금으로 변경]');
    { const E = await mk([{ pid: PA, qty: 6 }]); try {
        const S0 = await setupA(E, 5, null); let R = (await E.rows()).filter(r => r.kind === 'cash');
        // 사람이 B 고침
        const c1 = R[0].cells.slice(); c1[1] = '010-2600-7777'; let pu = await E.put(R[0].id, { cells: c1, ship_date: null }); ok(pu.s === 200 && pu.j.row.out_b === '010-2600-7777' && pu.j.row.out_k === B5 && dg(pu.j.row.cells[10]) === K2D, '묶인 뒤 사람이 B 고침 = 양식 B 고친 번호 · K 센터장 · 저장 K 입력삭제(설계)', [pu.j.row.out_b, pu.j.row.out_k, pu.j.row.cells[10]]);
        // pair_orig 없는 옛 줄(DB 직접)
        await E.db.query('UPDATE order_memo_rows SET pair_orig = NULL WHERE id = $1', [R[1].id]);
        // 처음 B 빈칸(「!」 줄 B='' K=센터장) → pair
        const bl = await E.save([bangRow(9, SENDER + '!', '', K2)]); const pb = await pairUI(E, K2, bl, { b: '' }); ok(pb.j.n === 1, 'B 빈칸 줄 /pair(origs b 빈칸)', pb.j);
        let d = await day(E, D1, [nv(PA, K2, 6)]); const fm = new Map(d.form.map(c => [c[3], c]));
        ok(fm.get('받는1')[1] === '010-2600-7777' && fm.get('받는1')[10] === B5, '양식 받는1 = B 고친 번호 · K 센터장', fm.get('받는1').slice(0, 2).concat(fm.get('받는1')[10]));
        ok(fm.get('받는2')[1] === K2 && fm.get('받는2')[10] === K2, 'pair_orig 없는 옛 줄 = 종전(B·K 입력삭제 번호)', [fm.get('받는2')[1], fm.get('받는2')[10]]);
        ok(fm.get('받는9')[1] === B5 && fm.get('받는9')[10] === B5, '처음 B 빈칸 = 양식 B·K 센터장 번호(K 로 채움)', [fm.get('받는9')[1], fm.get('받는9')[10]]);
        ok(!d.cards.length && d.form.length === 6 && !d.chk.boxDiff.length, '6 vs 6 카드 0', d.chk.boxDiff);
        // rekey: 번호 줄 번호 고침 K2 → K3
        const K3 = '010-2600-3333'; const ln = (await E.rows()).find(r => r.kind === 'line'); pu = await E.put(ln.id, { key: K3 }); ok(pu.s === 200 && pu.j.rekeyed === 6, 'rekey = 「!」 없는 짝 줄 6(B 고친 줄은 K 만)', pu.j);
        R = (await E.rows()).filter(r => r.kind === 'cash');
        ok(R.every(r => dg(r.cells[10]) === dg(K3)) && R.filter(r => dg(r.cells[1]) === dg(K3)).length === 5 && R.find(r => r.cells[3] === '받는1').cells[1] === '010-2600-7777', 'rekey 뒤 K 전부 새 번호 · B 는 따라간 5 · 사람이 고친 B 그대로', R.map(r => [r.cells[3], r.cells[1], r.cells[10]]));
        const li = (await E.list()).filter(r => r.kind === 'cash'); ok(li.filter(r => r.out_b === B5 && r.out_k === B5).length === 5 && li.find(r => r.cells[3] === '받는2').out_b === null, 'rekey 뒤 out = 센터장 번호 그대로 5 · 옛 줄 null', li.map(r => [r.cells[3], r.out_b]));
        await E.setPre([{ pid: PC, buyer: K3, qty: 6 }]); d = await day(E, D1, [nv(PC, K3, 6)]); await E.used(D1, d.fs1); d = await day(E, D1, [nv(PC, K3, 6)]);
        ok(d.st[PC] === 'indiv' && !d.cards.length && d.sum.a.length === 1 && d.sum.a[0][0] === PC && d.sum.um === 0, 'rekey 뒤 한 바퀴 = 입력삭제 · 카드 0 · 운송장 1장 붙음', [d.st, d.sum]);
        // 번호 줄 지움 = 풀림
        await E.del(ln.id); d = await day(E, D1, [nv(PC, K3, 6)]);
        ok(d.st[PC] === 'go' && d.form.length === 6 && d.chk.notIndiv.length === 1 && d.chk.notIndiv[0].cashRows.length === 6, '풀림 = 주문이 양식(주문 주소)으로도 나가고 주소 줄 6 도 나감 → 「현금파일 줄이 있는데 입력삭제 아님」 카드(종전 · 이중 발송 경고)', [d.st, d.form.length, d.chk.notIndiv.length]);
        ok(fm.get('받는9') && d.form.find(c => c[3] === '받는9')[1] === B5 && d.form.find(c => c[3] === '받는9')[10] === B5, '풀림 줄도 양식 B·K = 센터장 번호(pair_orig 남아 있음)', d.form.find(c => c[3] === '받는9').slice(0, 2));
        const lp = (await E.list()).filter(r => r.kind === 'cash'); ok(lp.every(r => r.indiv === true && r.split_done === undefined), '목록 = 풀림(indiv true · 번호 줄 없음 · split_done 없음 = 화면 「입력삭제 풀림」 알약)', lp.slice(0, 1).map(r => [r.indiv, r.split_done]));
        // 풀림 줄 [현금으로 변경](PUT to_cash)
        R = (await E.rows()).filter(r => r.kind === 'cash'); const r9 = R.find(r => r.cells[3] === '받는9'), r1 = R.find(r => r.cells[3] === '받는1'), r2 = R.find(r => r.cells[3] === '받는2');
        for (const r of [r9, r1, r2]) { pu = await E.put(r.id, { to_cash: true }); ok(pu.s === 200, '[현금으로 변경] ' + r.cells[3], pu.j); }
        R = (await E.rows()).filter(r => r.kind === 'cash'); const g = n => R.find(r => r.cells[3] === n);
        ok(/!$/.test(g('받는9').cells[0]) && g('받는9').cells[1] === B5 && g('받는9').cells[10] === B5 && g('받는9').pair_orig === null, '받는9(B 빈칸 출신) = 「… 드림!」 B·K 센터장 · pair_orig 비움', [g('받는9').cells[0], g('받는9').cells[1], g('받는9').cells[10]]);
        ok(g('받는1').cells[1] === B5 && g('받는1').cells[10] === B5, '🔵 재현: 사람이 B 를 고친 뒤 번호 줄 번호를 고치면(rekey) pair_orig.ab 가 고친 B 로 덮여 「사람이 고친 B」 표가 사라짐 → 양식·[현금으로 변경] 둘 다 처음 B 로 돌아감(#949 rekey 길 · 오늘 변경 아님 · 번호 고침 + B 고침이 겹칠 때만)', [g('받는1').cells[1], g('받는1').cells[10]]);
        ok(g('받는2').cells[1] === dg(K3) || g('받는2').cells[1] === K3 || g('받는2').cells[1] === recv(2)[1], 'pair_orig 없는 옛 줄 = B 가 옛 K → 받는 분 번호로(종전 추측 규칙)', [g('받는2').cells[1], g('받는2').cells[10]]);
        d = await day(E, D1, [nv(PC, K3, 6)]);
        ok(d.fs1.cash_out.filter(x => x === null).length === 3 && d.form.find(c => c[3] === '받는9')[1] === B5 && d.form.find(c => c[3] === '받는9')[10] === B5 && /!$/.test(d.form.find(c => c[3] === '받는9')[0]), '현금 줄 3 = cash_out null · 양식 B·K 센터장(저장값) · 「!」 유지', d.fs1.cash_out);
        ok(d.sum.cash === 3 && d.sum.a.length === 1 && d.sum.a[0][0] === PC && d.sum.a[0][2] === 6 && d.sum.um === 3 && d.sum.td.length === 0, '자동 송장 = 현금 운송장 3 따로(m.cash) · 주문엔 자기(주문 주소) 운송장 6 · 풀린 주소 줄 3 = unmatched(종전)', d.sum);
    } finally { await E.close(); } }

    console.log('Ⅳ #1121 나뉜 입력삭제(오늘 3 + 11/17 22) + #1146');
    { const E = await mk([{ pid: PA, qty: 25 }]); try {
        const cash = await E.save(Array.from({ length: 25 }, (_, i) => bangRow(i + 1, SENDER + '!', K2, K2, TY, 1, i < 3 ? null : D3))); await E.save([lineRow(K2, D3)]); const p = await pairUI(E, K2, cash); ok(p.j.n === 25, '/pair 25(날짜 줄 3 없음 · 22 = 11/17)', p.j);
        { const R0 = (await E.rows()).filter(r => r.kind === 'cash'); for (const r of R0.filter(x => ['받는1', '받는2', '받는3'].includes(x.cells[3]))) { const pu = await E.put(r.id, { cells: r.cells, ship_date: null }); if (pu.s !== 200) throw new Error(JSON.stringify(pu.j)); } }   // /pair 는 줄 날짜를 따라감(#850-a) → 첫날 3줄은 사람이 날짜를 뺌(verify-1121 setup8480 과 같음)
        let R = (await E.rows()).filter(r => r.kind === 'cash'); ok(R.filter(r => !r.ship_date).length === 3 && R.filter(r => r.ship_date === D3).length === 22 && R.every(r => r.pair_orig && dg(r.pair_orig.b) === B5D), '날짜 3 없음(=첫날) · 22 11/17 · pair_orig 전부', R.map(r => r.ship_date).filter((v, i, a) => a.indexOf(v) === i));
        const orders = [nv(PA, K2, 25)];
        let d = await day(E, D1, orders);
        ok(d.fs1.lines[0].state === 'today' && d.fs1.lines[0].split && d.fs1.lines[0].split.today === 3 && d.fs1.lines[0].split.later === 22 && d.fs1.cash_out.length === 3 && d.fs1.cash_out.every(x => x && x.b === B5), '11/15 for-ship = 오늘 줄(split 3/22) · cash_out 3 센터장', [d.fs1.lines[0].split, d.fs1.cash_out]);
        ok(d.st[PA] === 'indiv' && !d.cards.length && d.info[0] === '가: 오늘 3박스 · 주문은 오늘 발송처리 · 나머지 22박스는 11/17', '11/15 = 입력삭제 · 카드 0 · 참고 줄', [d.st, d.cards, d.info]);
        ok(d.form.length === 3 && vals(d.form, 1).join() === B5 && vals(d.form, 10).join() === B5, '11/15 양식 3행 B·K 센터장', d.form.map(c => [c[1], c[10]]));
        await E.used(D1, d.fs1); d = await day(E, D1, orders);
        ok(d.sum.a.length === 1 && d.sum.a[0][2] === 1 && d.sum.ex === 2 && d.sum.um === 0 && d.sum.td.length === 0, '11/15 자동 송장 = 주문 1장(발송처리 1회) · 2 extra', d.sum);
        R = await E.rows(); ok(R.find(r => r.kind === 'line').checked.split_sent === D1, 'split_sent 11/15', R.find(r => r.kind === 'line').checked);
        await E.setPre([]); d = await day(E, D3, []);
        ok(d.fs1.cash_out.length === 25 || d.fs1.cash_out.length === 22, '11/17 for-ship cash_out 길이 = 주소 줄 수(첫날 줄을 안 지웠으면 25)', d.fs1.cash_out.length);
        ok(d.fs1.cash_out.every(x => x && x.b === B5 && x.k === B5) && d.form.every(c => c[1] === B5 && c[10] === B5), '11/17 양식 전부 B·K 센터장', [d.form.length, vals(d.form, 1)]);
        ok(!d.chk.notIndiv.length && !d.chk.boxDiff.length && d.chk.strangers.length === 1 && d.sum.a.length === 0 && d.sum.td.length === 0, '11/17 = 주문 없음 → 카드 0 · 참고 줄(strangers) · 운송장 주문에 안 붙음', [d.chk.strangers.length, d.sum]);
    } finally { await E.close(); } }

    console.log('Ⅴ 서비스 줄 섞임 · 사이즈 꼬리 복사본 · 품목 바꾼 묶음(#1145) · 자사몰·쿠팡 입력삭제 · 두 주문');
    { const E = await mk([{ pid: PA, qty: 4 }]); try {
        await setupA(E, 5, null, { opt: TY2 }); let R = (await E.rows()).filter(r => r.kind === 'cash');
        let pu = await E.put(R[4].id, { service: true }); ok(pu.s === 200 && pu.j.row.service === true && /!$/.test(pu.j.row.cells[0]) && pu.j.row.out_b === null, '서비스 켬 = 「!」 꼴 · out null', [pu.j.row.cells[0], pu.j.row.out_b]);
        let d = await day(E, D1, [nv(PA, K2, 4, TY2)], { sizeLines: [{ digits: K2D, size: 'S' }] });
        ok(d.fs1.cash_out.filter(Boolean).length === 4 && d.fs1.cash_service.length === 1 && !d.cards.length && !d.chk.boxDiff.length, '서비스 1 + 주소 4 vs 주문 4 = 카드 0 · cash_out 4', [d.fs1.cash_service, d.chk.boxDiff]);
        const sv = d.form.find(c => /!$/.test(c[0])), ad = d.form.filter(c => !/!$/.test(c[0]));
        ok(sv && sv[1] === K2 && sv[10] === K2 && ad.length === 4 && ad.every(c => c[1] === B5 && c[10] === B5), '양식 = 서비스 줄 B·K 그대로(입력삭제 번호 · 종전) · 주소 줄 4 센터장', [sv && [sv[1], sv[10]], ad.map(c => c[1])]);
        ok(ad.every(c => c[4] === TY2 + ' S사이즈로!'), '사이즈 꼬리 붙은 복사본에도 out 유지(옵션 끝 「S사이즈로!」 + B·K 센터장)', ad.map(c => c[4]));
        await E.used(D1, d.fs1); d = await day(E, D1, [nv(PA, K2, 4, TY2)], { sizeLines: [{ digits: K2D, size: 'S' }] });
        ok(d.sum.a.length === 1 && d.sum.a[0][2] === 1 && d.sum.td.length === 0 && d.sum.um === 0, '자동 송장(품목 꼬리 운송장) = 1장 · 서비스 운송장은 주문에 안 붙음', d.sum);
        // 품목 바꾼 묶음(#1145): 주문 TY · 주소 줄 TY2
        await E.put(R[4].id, { service: false }); d = await day(E, D1, [nv(PA, K2, 5, TY)]);
        ok(d.chk.boxDiff.length === 0 && (d.chk.itemDiff || []).length === 1 && d.cards.length === 1 && d.cards[0].swap && /가정용 - 5kg\(중대과 L이상\)/.test(d.cards[0].swap.o) && /로얄과/.test(d.cards[0].swap.c), '#1145 카드 = 박스 합 같고 품목 다름 → swap 글(주문 품목 · 주소 줄 품목)', d.cards);
        ok(d.form.length === 5 && d.form.every(c => c[4] === TY2 && c[1] === B5), '양식 = 주소 줄 품목 5 · B 센터장', d.form.map(c => c[4]).filter((v, i, a) => a.indexOf(v) === i));
        await E.used(D1, d.fs1); d = await day(E, D1, [nv(PA, K2, 5, TY)]);
        ok(d.sum.a.length === 1 && d.sum.a[0][1] === 'indiv_any' && d.sum.ex === 4 && d.sum.td.length === 0 && d.sum.um === 0, '#1145 + #1146 자동 송장 = memoHit 1장(주문 하나) · 4 extra', d.sum);
        const two = await day(E, D1, [nv(PA, K2, 3, TY), nv(PC, K2, 2, TYG)]);
        ok(two.sum.td.length === 2 && two.sum.td.every(t => t[1] === 'todo_indiv_none') && two.sum.a.length === 0, '같은 구매자 주문 둘 + 품목 다 다름 = 좁게(할 일 2 · 자동 0 · 오매칭 0)', two.sum);
        // 자사몰 개인결제창 · 쿠팡(순수 matchShipments · 양식 B 센터장 · memoAddr obs)
        const M = d.memoAddr, S = ia.normShips(d.ships, '효돈');
        const cf = ia.matchShipments({ ships: S, orders: ia.normOrders('cafe24', [{ _orderId: '20261114-0000001', _itemCode: 'A1', '수령인': '가구매', '수령인 휴대전화': K2, '수령인 주소(전체)': HOME2, '주문자 휴대전화': K2, '주문상품명(세트상품 포함)': '2524님 - 개인결제창', '수량': 1 }]), pricingNames: CAT, indivKeys: ['cafe24:20261114-0000001|A1'], holdKeys: [], memoAddr: M });
        ok(cf.assign.length === 1 && cf.assign[0].ships.length === 1 && cf.todos.length === 0, '자사몰 개인결제창 입력삭제 = 품목 안 보고 1장', cf.assign.map(a => [a.rule, a.ships.length]));
        const cp = ia.matchShipments({ ships: S, orders: ia.normOrders('coupang', [{ _shipmentBoxId: 'B1', _orderId: '3100000001', _vendorItemId: 'V1', '수취인이름': '가구매', '수취인전화번호': K2, '수취인 주소': HOME2, '구매자전화번호': K2, '등록옵션명': TY2, '구매수(수량)': 5 }]), pricingNames: CAT, indivKeys: ['coupang:B1|V1'], holdKeys: [], memoAddr: M });
        ok(cp.assign.length === 1 && cp.assign[0].ships.length === 1 && cp.todos.length === 0, '쿠팡 입력삭제 = 1장', cp.assign.map(a => [a.rule, a.ships.length]));
    } finally { await E.close(); } }

    console.log('Ⅵ 「드림」 판정 — 이름 꼴 × 주소 줄·현금 줄 · 왕복 · 현금파일로 다시 읽기');
    { const E = await mk([{ pid: PA, qty: 9 }]); try {
        const names = ['홍가짜', '홍가짜 드림', '홍가짜 올림', '제주아꼼이네', '홍가짜(제주아꼼이네)', '', '홍가짜 드림!', '!홍가짜', SENDER];
        const want = ['홍가짜 드림', '홍가짜 드림', '홍가짜 올림', '제주아꼼이네', '홍가짜(제주아꼼이네)', '제주아꼼이네', '홍가짜 드림', '홍가짜 드림', SENDER + ' 드림'];
        const saved = await E.save([lineRow(K2, null), ...names.map((A, i) => bangRow(i + 1, A, B5, K2))]);
        const sv = saved.filter(r => r.kind === 'cash'); ok(sv.map(r => r.cells[0]).join('|') === want.join('|'), '주소 줄(같은 묶음 저장) A칸 = 드림 한 번·올림·아꼼이네 그대로·빈칸 아꼼이네', sv.map(r => r.cells[0]));
        const cs = await E.save(names.map((A, i) => bangRow(i + 20, A + '!', B9, K1, TYG, 1, D3)));
        ok(cs.map(r => r.cells[0]).join('|') === want.map(x => x + '!').join('|'), '현금 줄 A칸 = 같은 판정 + 「!」 맨 뒤(「드림 드림!」 없음)', cs.map(r => r.cells[0]));
        // 왕복: 주소 줄 → [현금으로 변경] → 되돌리기(to_indiv) → 다시 현금
        const r0 = sv[0]; let pu = await E.put(r0.id, { to_cash: true }); ok(pu.j.row.cells[0] === '홍가짜 드림!' , '주소 → 현금 = 「홍가짜 드림!」', pu.j.row.cells[0]);
        pu = await E.put(r0.id, { to_indiv: true }); ok(pu.j.row.cells[0] === '홍가짜 드림', '현금 → 주소(되돌리기) = 「홍가짜 드림」(두 번 안 붙음)', pu.j.row.cells[0]);
        pu = await E.put(r0.id, { to_cash: true }); ok(pu.j.row.cells[0] === '홍가짜 드림!', '다시 현금 = 「홍가짜 드림!」', pu.j.row.cells[0]);
        pu = await E.put(r0.id, { to_indiv: true, cells: pu.j.row.cells }); ok(pu.j.row.cells[0] === '홍가짜 드림', '화면 값 그대로 보내도 「홍가짜 드림」', pu.j.row.cells[0]);
        // 고쳐 저장(PUT cells 그대로) = 그대로
        pu = await E.put(sv[1].id, { cells: sv[1].cells, ship_date: null }); ok(pu.j.row.cells[0] === '홍가짜 드림', '고쳐 저장 = 그대로', pu.j.row.cells[0]);
        // 양식 → 현금파일(parseCash)로 다시 읽기
        const d = await day(E, D1, [nv(PA, K2, 9)]);
        const pc = core.parseCash([core.HEADERS.slice(), ...d.form]);
        ok(d.form.length === 9 && d.form.every(c => c[1] === B5 && c[10] === K2), '처음부터 주소 줄로 적은 묶음(B 센터장 · K 입력삭제 번호 입력) = 양식 B 센터장 · K 입력삭제 번호(입력한 값 그대로 = 설계)', d.form.map(c => [c[1], c[10]]).slice(0, 2));
        ok(pc.ok && pc.rows.every(r => !r.bang && r.digits === K2D), '  → 이 꼴은 현금파일로 다시 읽어도 짝 그대로', [...new Set(pc.rows.map(r => r.digits))]);
        const li = (await E.list()).filter(r => r.kind === 'cash' && !/!/.test(r.cells[0])); ok(li.every(r => /(?:드림|올림)$|제주아꼼이네\)?$/.test(r.cells[0])), '목록(rowOut) 주소 줄 A칸 전부 드림/올림/아꼼이네 끝', li.map(r => r.cells[0]));
    } finally { await E.close(); } }

    console.log('Ⅶ B 꼴 = 현금 「!」 10줄 60박스(11/15 · 9줄 B≠K + 1줄 B=K) · 입력삭제에서 [현금으로 변경]한 줄');
    { const E = await mk([{ pid: PA, qty: 60 }]); try {
        // 입력삭제 묶음으로 저장 → 10줄 전부 [현금으로 변경](to_cash) = 실제 B 꼴 만들어진 길
        const qs = [18, 13, 7, 6, 6, 4, 2, 1, 2, 1];
        const cash = await E.save(qs.map((q, i) => bangRow(i + 1, i < 9 ? '백가짜 드림!' : '최가짜 드림!', i < 9 ? B9 : K1, K1, TYG, q, D1))); await E.save([lineRow(K1, D1)]); const p = await E.pair(K1, cash.map(r => r.id)); ok(p.j.n === 10, '/pair 10(K = 입력삭제 번호 그대로 · B 9줄은 사람 번호)', p.j);
        let R = (await E.rows()).filter(r => r.kind === 'cash'); for (const r of R) { const pu = await E.put(r.id, { to_cash: true }); if (pu.s !== 200) throw new Error(JSON.stringify(pu.j)); }
        R = (await E.rows()).filter(r => r.kind === 'cash');
        ok(R.every(r => /!$/.test(r.cells[0]) && r.pair_orig === null && dg(r.cells[10]) === dg(K1)) && R.filter(r => dg(r.cells[1]) === dg(B9)).length === 9 && R.filter(r => dg(r.cells[1]) === dg(K1)).length === 1, '[현금으로 변경] 10 = 「!」 · B 9480 9줄 + 1318 1줄 · K 1318 · pair_orig null(실DB 꼴)', R.map(r => [r.cells[0], r.cells[1], r.cells[10]]).slice(0, 2));
        const ln = (await E.rows()).find(r => r.kind === 'line'); await E.del(ln.id);
        const orders = [nv(PA, K1, 60, TYG, '가구매', K1, HOME5), nv(PC, K1, 1, TY, '가구매', K1, HOME5)];   // 1318 이 그날 네이버 주문도 있다고 치고(현금 운송장이 거기 붙으려 하지 않는지)
        let d = await day(E, D1, orders);
        ok(d.fs1.cash_aoa.length === 11 && d.fs1.cash_out.every(x => x === null) && d.fs1.cash_aoa.slice(1).every(c => /!$/.test(c[0]) && !/드림 드림/.test(c[0])), 'for-ship = 현금 10 · cash_out 전부 null · 「!」 맨 뒤 · 드림 한 번', d.fs1.cash_aoa.slice(1, 3).map(c => c[0]));
        ok(d.form.length === 10 && d.form.reduce((n, c) => n + Number(c[5]), 0) === 60 && d.form.filter(c => c[1] === B9).length === 9 && d.form.filter(c => c[1] === K1).length === 1 && d.form.every(c => c[10] === K1), '양식 10행 60박스 · B 9480 9 + 1318 1 · K 1318 그대로', d.form.map(c => [c[1], c[10], c[5]]).slice(0, 2));
        ok(d.st[PA] === 'go' && d.st[PC] === 'go' && !d.chk.notIndiv.length && !d.chk.boxDiff.length && !d.chk.missing.length && !d.cards.length, '주문은 입력삭제 아님(일반) · 「!」 줄은 대조 밖 = 카드 0', [d.st, d.chk]);
        await E.used(D1, d.fs1); d = await day(E, D1, orders);
        ok(d.sum.cash === 60 && d.sum.a.length === 2 && d.sum.a.reduce((n, x) => n + x[2], 0) === 61 && d.sum.um === 0 && d.sum.td.length === 0, '자동 송장 = 현금 운송장 60 따로(m.cash) · 두 주문은 자기(주문 주소) 운송장 61 만 · 현금이 주문에 안 붙음', d.sum);
        const pc = core.parseCash(d.fs1.cash_aoa); ok(pc.ok && pc.rows.every(r => r.bang), 'parseCash bang 10/10', pc.rows.filter(r => r.bang).length);
    } finally { await E.close(); } }

    console.log('Ⅷ 옛 화면 · 옛 서버 조합');
    { // 새 화면 + cash_out 없는 응답(옛 서버) = out 없음 → cashOut 그대로
        const aoa = [core.HEADERS.slice(), [SENDER + ' 드림', K2, ORIGIN, '받는1', TY, '1', recv(1)[1], '', recv(1)[2], '', K2, '', '']];
        const c1 = omCash({ cash_aoa: aoa, cash_ids: [1], cash_service: [] }); ok(c1.length === 1 && !c1[0].out, '옛 서버 응답(cash_out 없음) = out 칸 없음', c1[0] && Object.keys(c1[0]));
        const f1 = cashOutFn(c1.map(r => Object.assign({}, r, { om: true }))); ok(f1[0].cells[1] === K2 && f1[0].cells[10] === K2, '  → 양식 B·K 종전(입력삭제 번호)', [f1[0].cells[1], f1[0].cells[10]]);
        const c2 = omCash({ cash_aoa: aoa, cash_ids: [1], cash_service: [], cash_out: [null] }); ok(!c2[0].out, 'cash_out null(pair_orig 없는 줄) = out 없음');
        const c3 = omCash({ cash_aoa: aoa, cash_ids: [1], cash_service: [], cash_out: [{ b: B5, k: '' }] }); ok(!c3[0].out, 'k 빈 out = 안 씀(둘 다 있어야)');
        const f4 = cashOutFn([Object.assign({}, c1[0], { out: { b: B5, k: B5 } })]); ok(f4[0].cells[1] === K2, '엑셀 현금파일 줄(om 아님) = out 있어도 안 바꿈', f4[0].cells[1]);
        note('옛 화면(final-order.js 옛 판) + 새 서버 = cash_out 칸을 읽지 않아 종전 그대로(코드 읽기 · 옛 판에 cash_out 참조 0)');
        ok(!/cash_out/.test(require('child_process').execSync('git show 30c5bcc:public/final-order.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })), '옛 final-order.js(30c5bcc) 에 cash_out 참조 0');
    }
    console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
