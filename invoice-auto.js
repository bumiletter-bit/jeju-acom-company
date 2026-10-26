// #838-1 자동 송장 등록 — 1단계(외부 쓰기 0) · 설계 정본 docs/838/838-자동송장등록-시공설계(정본).md · 화면 계약 docs/838/838-api.md
//   POST /api/agent-office/invoice-auto/match    (로그인 누구나) = CJ(LOIS) 운송장 시트 xlsx(base64 JSON) → 3채널 「불러오기」 재조회(읽기) → 짝 맞추기 → 카드 JSON 저장
//                                                  + 같은 호출에서 delivery_shipments 색인(종전 /api/delivery/shipments/upload 와 같은 upsert · 종전 길 유지)
//   POST /api/agent-office/invoice-auto/register (직원 전부 · 세무사 X · #858) = 짝 결과 + 선택 → 멱등 열쇠로 「전송 준비」 저장 → {dry:false} + 설정 invoice_auto.send_enabled true 일 때만 3채널 발송처리(#838-4)
//   GET  /api/agent-office/invoice-auto/manual/:id (로그인) = 실패·모름·수기 줄 엑셀(네이버 시트 「발송처리」 = 센터 엑셀 일괄발송 꼴 · 그 밖 시트 「쿠팡·자사몰」)
//   #838-4 전송 단위·멱등 열쇠 = 네이버 productOrderId · 쿠팡 shipmentBoxId(상자 안 옵션마다 한 줄 · 같은 송장) · 카페24 order_id|order_item_code(보낼 때 order_id+운송장으로 묶음 · 한 주문 품목이 다른 거래처면 운송장이 달라서)
//   · 보내기 전에 줄을 집는다(state ready → sending · RETURNING) · 결과 = sent / failed(사유) / unknown(응답에 없음·연결 끊김 = 다시 안 보냄 · 사람이 채널 화면 확인) · already = sent·sending·unknown 만
//   · 공식 바디·코드값 = docs/838/838-api-외부.md(워커2) · 카페24 CJ 코드는 설정 invoice_auto.cafe24_carrier_code(코드에 안 박음 · 없으면 카페24 전송 거절)
//   표 invoice_auto_runs(실행 · 90일 · 손님 이름은 가림·번호 끝 4자리만·주소 0) · invoice_auto_items(주문당 한 줄 = 채널:주문번호 PK · 두 번 등록 막기)
//   🔴 짝 규칙 = 오매칭 > 미매칭(메모리 jeju-invoice-matching-policy): 받는분 이름+번호+주소 셋 다 같을 때만 자동 · 모르면 할 일(todo) · 최종발주 판정·산출 무접촉
'use strict';

const PLACEHOLDER = new Set(['01000000000', '0000000000', '00000000000']);
const dg = v => String(v == null ? '' : v).replace(/\D/g, '');
const normName = v => String(v == null ? '' : v).replace(/\s+/g, '');
const normAddr = v => String(v == null ? '' : v).replace(/\s+/g, '').replace(/[(),.\-]/g, '');
const validTel = d => d.length >= 8 && !PLACEHOLDER.has(d);
// 상품 글 비교 꼴 = 공백·괄호 밖 기호 제거 + 끝 요청 꼬리(「 S사이즈로!」 「 17과로!」) 뗌
const normProd = v => String(v == null ? '' : v).replace(/\s+[^\s]*로!$/, '').replace(/[\s·]/g, '').toLowerCase();
function maskName(n) { const s = String(n || '').replace(/\s+/g, ''); if (!s) return ''; if (s.length <= 1) return s; if (s.length === 2) return s[0] + '*'; return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]; }
function maskRecipient(name, tel) { const t = dg(tel); return [maskName(name), t.length >= 4 ? '끝 ' + t.slice(-4) : ''].filter(Boolean).join(' · '); }

// 채널 행 → 공통 주문 꼴(종전 불러오기 함수 출력 그대로 받음)
function normOrders(channel, rows) {
    const out = [];
    for (const r of (rows || [])) {
        let o = null;
        if (channel === 'naver') o = { order_key: String(r._pid || ''), box_id: String(r._pid || ''), name: r['수취인명'], tel: r['수취인연락처1'], tel2: r['수취인연락처2'], addr: r['통합배송지'], buyer: r['구매자연락처'], option: r['옵션정보'], qty: r['수량'] };
        else if (channel === 'coupang') o = { order_key: String(r._shipmentBoxId || r._orderId || '') + '|' + String(r._vendorItemId || ''), box_id: String(r._shipmentBoxId || ''), order_id: String(r._orderId || ''), vendor_item_id: String(r._vendorItemId || ''), name: r['수취인이름'], tel: r['수취인전화번호'], addr: r['수취인 주소'], buyer: r['구매자전화번호'], option: r['노출상품명(옵션명)'] || r['등록상품명'], qty: r['구매수(수량)'] };
        else if (channel === 'cafe24') o = { order_key: String(r._orderId || '') + '|' + String(r._itemCode || ''), box_id: String(r._orderId || ''), order_id: String(r._orderId || ''), item_code: String(r._itemCode || ''), name: r['수령인'], tel: r['수령인 휴대전화'], addr: r['수령인 주소(전체)'], buyer: r['주문자 휴대전화'], option: r['주문상품명(세트상품 포함)'], qty: r['수량'] };
        if (!o || !o.order_key || o.order_key === '|') continue;
        o.channel = channel; o.qty = Math.max(1, parseInt(o.qty, 10) || 1); o.option = String(o.option || '').trim();
        o.kName = normName(o.name); o.kTel = dg(o.tel); o.kAddr = normAddr(o.addr); o.kBuyer = dg(o.buyer);
        o.key = [o.kName, o.kTel, o.kAddr].join('|');
        out.push(o);
    }
    return out;
}
// 운송장 줄(LOIS 파서 출력 tr·nm·tel·ad·op·q·sn·stel) → 공통 꼴
function normShips(rows, partner) {
    return (rows || []).filter(x => x && dg(x.tr).length >= 10).map(x => ({
        tracking: dg(x.tr), partner: x.partner || partner || '?', name: x.nm, tel: x.tel, addr: x.ad, product: String(x.op || '').trim(), sender: String(x.sn || ''), senderTel: dg(x.stel),
        key: [normName(x.nm), dg(x.tel), normAddr(x.ad)].join('|'), cash: /[!！]/.test(String(x.sn || '')),
    }));
}
// 주문 옵션 ↔ 운송장 상품명(시트2 상품명 = 우리 양식 옵션정보 = 단가표 이름 · 채널 옵션 글은 더 길다) — 한쪽이 다른 쪽을 품을 때만 같음
function prodMatch(orderOpt, shipProd) {
    const a = normProd(orderOpt), b = normProd(shipProd);
    if (!a || !b) return false;
    if (a === b || a.includes(b)) return true;
    const tail = normProd(String(orderOpt).split(/[:：]/).pop());   // 「… / 상품 및 과수: 하우스감귤 가정용 - 3kg(소과)」 의 마지막 칸
    return !!tail && tail.length >= 4 && (tail === b || b.includes(tail));
}

// #841(대표 10/25 첫 실등록): 채널 옵션 「…하우스감귤 가정용 - 4.5kg(로얄과)」 ↔ 운송장 상품명 = 단가표 이름 「고당도 하우스감귤 / 상품 및 과수: 가정용 - 4.5kg(로얄과)」 는 글자 포함으로 안 맞음
//   → 최종발주·송장변환과 같은 품목 변환(app.js matchProduct · price-check.js optionKey 경유 · 전체 이름 일치만)으로 단가표 이름을 구해 같을 때도 같은 품목(새 넓은 규칙 없음)
let _pc; function pcMod() { if (_pc === undefined) { try { _pc = require('./price-check.js'); } catch (e) { _pc = null; } } return _pc; }
function canonOf(text, pricingNames) {
    const m = pcMod(); if (!m || typeof m.optionKey !== 'function' || !String(text || '').trim()) return '';
    try { const r = m.optionKey([String(text)], Array.isArray(pricingNames) ? pricingNames : []); return r && r.by === 'match' ? normProd(r.label) : ''; } catch (e) { return ''; }
}
// #858(대표 10/26 김*윤 3218 · 김*수 8739): 마지막 칸 「가정용 - 3kg(로얄과 2S~M)」 은 유라·타이벡 둘 다라 글자 비교가 두 장 다 맞힘 → 양쪽 다 단가표 이름이 나오면 그것만 봄(좁히기만) · 한쪽이라도 못 읽으면 종전 글자 비교
const prodHit = (o, s) => (o.canon && s.canonReal) ? o.canon === s.canon : (prodMatch(o.option, s.product) || (!!o.canon && o.canon === s.canon));

// 짝 맞추기(순수 함수 · 검증이 바로 부름) — 정본 2절 규칙표 · pricingNames = 그날 단가표 이름(#841 · 없으면 종전 글자 비교만 + 표준명)
function matchShipments({ ships, orders, pricingNames }) {
    for (const o of orders) if (o.canon === undefined) o.canon = canonOf(o.option, pricingNames);
    for (const s of ships) if (s.canon === undefined) { const c = canonOf(s.product, pricingNames); s.canonReal = !!c; s.canon = c || normProd(s.product); }
    const byT = (a, b) => (a.tracking < b.tracking ? -1 : a.tracking > b.tracking ? 1 : 0);
    const cash = ships.filter(s => s.cash).sort(byT), live = ships.filter(s => !s.cash).sort(byT);
    const assign = new Map();   // order_key → { o, ships:[], rule, todo?:[ships] }
    const give = (o, list, rule) => { const a = assign.get(o.channel + ':' + o.order_key) || { o, ships: [], rule }; a.ships.push(...list); a.rule = a.rule || rule; assign.set(o.channel + ':' + o.order_key, a); };
    const ordersBy = new Map(); for (const o of orders) { if (!ordersBy.has(o.key)) ordersBy.set(o.key, []); ordersBy.get(o.key).push(o); }
    const shipsBy = new Map(); for (const s of live) { if (!shipsBy.has(s.key)) shipsBy.set(s.key, []); shipsBy.get(s.key).push(s); }
    const leftover = [];   // 셋 다 맞는 주문이 없는 운송장
    const todos = [];      // { o, rule, options:[ships] }
    const distribute = (os, ss, rule) => {   // 같은 품목 여러 주문 = 아무거나 1개씩(주문 수량만큼 차례로 · 남으면 마지막 주문 나머지 박스)
        let i = 0; os.forEach(o => { const take = ss.slice(i, i + o.qty); i += take.length; if (take.length) give(o, take, rule); });
        if (i < ss.length) { const last = os.filter(o => assign.has(o.channel + ':' + o.order_key)).pop() || os[os.length - 1]; give(last, ss.slice(i), rule); }
    };
    for (const [key, ss] of shipsBy) {
        const os = ordersBy.get(key) || [];
        if (!os.length) { leftover.push(...ss); continue; }
        if (os.length === 1) { const o = os[0]; give(o, ss, ss.length === o.qty ? (ss.length > 1 ? 'auto_multi' : 'auto') : 'auto_qty_diff'); continue; }
        const prods = new Set(os.map(o => normProd(o.option)));
        if (prods.size === 1) { distribute(os, ss, 'same_item_any'); continue; }
        // 같은 분 다른 품목 = 운송장 상품명으로 가름 · 운송장마다 맞는 「품목 묶음」이 정확히 하나여야(아니면 그 열쇠 주문 전부 할 일)
        const groups = new Map(); let bad = false;
        for (const s of ss) {
            const hit = os.filter(o => prodHit(o, s)); const hp = new Set(hit.map(o => normProd(o.option)));
            if (hp.size !== 1) { bad = true; break; }
            const gk = [...hp][0]; if (!groups.has(gk)) groups.set(gk, { os: hit, ss: [] }); groups.get(gk).ss.push(s);
        }
        if (bad) {   // #841 ② 그래도 모르면 할 일 — 이 주문 품목에만 맞는 운송장이 딱 1장이고 주문 수량 1 이면 미리 골라 둠(확인 필요 · 사람이 [등록] 전 봄)
            os.forEach(o => {
                const mine = ss.filter(s => prodHit(o, s) && os.every(x => !prodHit(x, s) || normProd(x.option) === normProd(o.option)));
                const solo = os.filter(x => normProd(x.option) === normProd(o.option)).length === 1;
                const sg = (o.qty === 1 && solo && mine.length === 1) ? mine[0].tracking : null;
                todos.push({ o, rule: 'todo_product', options: ss, suggest: sg, suggest_why: sg ? '확인 필요 — 품목이 같은 운송장 1장' : null });
            });
            continue;
        }
        for (const g of groups.values()) { if (g.os.length === 1) give(g.os[0], g.ss, 'by_product'); else distribute(g.os, g.ss, 'same_item_any'); }
    }
    // 입력삭제(주문 통째 개별 주소 = 현금파일 줄로 나감): 운송장이 안 붙은 주문 → 같은 구매자 번호(시트2 보내는분 전화)로 나간 남은 운송장
    const todoKeys = new Set(todos.map(t => t.o.channel + ':' + t.o.order_key));
    const trackless = orders.filter(o => !assign.has(o.channel + ':' + o.order_key) && !todoKeys.has(o.channel + ':' + o.order_key) && validTel(o.kBuyer));
    const tlByBuyer = new Map(); for (const o of trackless) { if (!tlByBuyer.has(o.kBuyer)) tlByBuyer.set(o.kBuyer, []); tlByBuyer.get(o.kBuyer).push(o); }
    const used = new Set();
    for (const [buyer, os] of tlByBuyer) {
        const cand = leftover.filter(s => s.senderTel === buyer && !used.has(s.tracking)); if (!cand.length) continue;
        for (const o of os) {
            const mine = cand.filter(s => !used.has(s.tracking) && prodHit(o, s)); if (!mine.length) continue;
            // 그 구매자의 운송장 안 붙은 주문 가운데 같은 품목이 둘 이상이면 어느 주문 것인지 모름(지정발송일 주문과 섞일 수 있음) → 할 일
            const rivals = os.filter(x => x !== o && prodHit(x, mine[0]));
            if (rivals.length) {   // #841 ② 주문 주소와 같은 운송장이 1장이고 같은 주소의 맞수 주문이 없을 때만 미리 고름
                const sameAddr = mine.filter(s => normAddr(s.addr) === o.kAddr);
                const sg = sameAddr.length === 1 && !rivals.some(x => x.kAddr === o.kAddr) ? sameAddr[0].tracking : null;
                todos.push({ o, rule: 'todo_pick', options: mine, suggest: sg, suggest_why: sg ? '확인 필요 — 주문 주소와 같은 운송장 1장' : null }); todoKeys.add(o.channel + ':' + o.order_key); continue;
            }
            const store = mine.find(s => normAddr(s.addr) === o.kAddr);
            const pick = store || mine[0]; used.add(pick.tracking);
            give(o, [pick], store ? 'indiv_store_addr' : 'indiv_any');
        }
    }
    const assignedBuyers = new Set([...assign.values()].map(a => a.o.kBuyer).filter(validTel));
    const todoTr = new Set(); todos.forEach(t => t.options.forEach(s => todoTr.add(s.tracking)));
    const extra = [], unmatched = [];
    for (const s of leftover) {
        if (used.has(s.tracking) || todoTr.has(s.tracking)) continue;
        if (validTel(s.senderTel) && assignedBuyers.has(s.senderTel)) extra.push(s); else unmatched.push(s);
    }
    // #841 손질(워커3 점검): 미리 고른 운송장이 이미 다른 주문에 붙었거나(assign·입력삭제 used) 두 할 일이 같은 장을 골랐으면 미리 고르기를 뺀다
    const taken = new Set(used); assign.forEach(a => a.ships.forEach(s => taken.add(s.tracking)));
    const sgN = new Map(); todos.forEach(t => { if (t.suggest) sgN.set(t.suggest, (sgN.get(t.suggest) || 0) + 1); });
    todos.forEach(t => { if (t.suggest && (taken.has(t.suggest) || sgN.get(t.suggest) > 1)) { t.suggest = null; t.suggest_why = null; } });
    return { assign: [...assign.values()], todos, cash, extra, unmatched };
}

// 응답 꼴 — #841 ③ 화면용 전체 이름·번호(recipient_name·recipient_tel · 로그인 직원 응답에만) + 가림(recipient_masked) · 주소 0
//   🔴 DB(invoice_auto_runs.result)·audit 에는 stripPII 로 뺀 꼴만 저장(종전처럼 가림만)
const PII_KEYS = ['recipient_name', 'recipient_tel'];
const who = (name, tel) => ({ recipient_name: String(name == null ? '' : name).trim(), recipient_tel: String(tel == null ? '' : tel).trim() });
function stripPII(card) {
    const un = x => { const y = { ...x }; PII_KEYS.forEach(k => { delete y[k]; }); if (Array.isArray(y.pick_options)) y.pick_options = y.pick_options.map(un); return y; };
    const L = a => (Array.isArray(a) ? a.map(un) : a);
    return { ...card, rows: L(card.rows), cash: L(card.cash), extra: L(card.extra), unmatched: L(card.unmatched) };
}
function buildCard(m, orders) {
    const rows = []; let n = 0;
    const by = { naver: { auto: 0, todo: 0, cash: 0, skipped: 0 }, coupang: { auto: 0, todo: 0, cash: 0, skipped: 0 }, cafe24: { auto: 0, todo: 0, cash: 0, skipped: 0 } };
    const shipOpt = s => ({ tracking: s.tracking, recipient_masked: maskRecipient(s.name, s.tel), ...who(s.name, s.tel), product: s.product });
    const boxItems = new Map(); for (const o of orders) if (o.channel === 'coupang' && o.box_id) { if (!boxItems.has(o.box_id)) boxItems.set(o.box_id, []); if (o.vendor_item_id && !boxItems.get(o.box_id).includes(o.vendor_item_id)) boxItems.get(o.box_id).push(o.vendor_item_id); }
    const sendCols = o => ({ order_id: o.order_id || null, vendor_item_id: o.vendor_item_id || null, box_vendor_items: o.channel === 'coupang' ? (boxItems.get(o.box_id) || [o.vendor_item_id]).filter(Boolean) : null });   // #838-4 B 전송 칸(쿠팡 = 상자 안 옵션 전부)
    for (const a of m.assign) {
        const o = a.o, ss = a.ships.slice().sort((x, y) => (x.tracking < y.tracking ? -1 : 1));
        rows.push({ id: 'r' + (++n), channel: o.channel, order_key: o.order_key, box_id: o.box_id, item_code: o.item_code || null, ...sendCols(o), recipient_masked: maskRecipient(o.name, o.tel), ...who(o.name, o.tel), option: o.option, qty: o.qty,
            tracking: ss[0].tracking, tracking_all: ss.map(s => s.tracking), rule: a.rule, status: 'auto', pick_options: [] });
        by[o.channel].auto++; by[o.channel].skipped += ss.length - 1;
    }
    for (const t of m.todos) {
        const o = t.o;
        rows.push({ id: 'r' + (++n), channel: o.channel, order_key: o.order_key, box_id: o.box_id, item_code: o.item_code || null, ...sendCols(o), recipient_masked: maskRecipient(o.name, o.tel), ...who(o.name, o.tel), option: o.option, qty: o.qty,
            tracking: null, tracking_all: [], rule: t.rule, status: 'todo', pick_options: t.options.map(shipOpt), suggest: t.suggest || null, suggest_why: t.suggest ? (t.suggest_why || '확인 필요') : null });
        by[o.channel].todo++;
    }
    const assignedKeys = new Set(m.assign.map(a => a.o.channel + ':' + a.o.order_key).concat(m.todos.map(t => t.o.channel + ':' + t.o.order_key)));
    const extraByCh = new Map(m.assign.map(a => [a.o.kBuyer, a.o.channel])); m.extra.forEach(s => { const ch = extraByCh.get(s.senderTel); if (ch) by[ch].skipped++; });
    return {
        by_channel: by, rows,
        cash: m.cash.map(s => ({ ...shipOpt(s), why: '보내는이 ! = 현금 주문(송장만 · 등록 대상 아님)' })),
        extra: m.extra.map(s => ({ ...shipOpt(s), why: '같은 구매자의 다른 주소 박스(입력삭제 나머지 · 등록 안 함 · 색인에만)' })),
        unmatched: m.unmatched.map(s => ({ ...shipOpt(s), why: '그날 주문에 받는분 이름·번호·주소가 같은 주문이 없어요' })),
        orders_without_tracking: orders.filter(o => !assignedKeys.has(o.channel + ':' + o.order_key)).length,
    };
}

module.exports = function mountInvoiceAuto(app, d) {
    const { pool, authMiddleware, adminOnly, writeAudit, adminActor, ExcelJS, lois, fetchers, kstToday } = d;
    const log = d.log || console;
    const transport = d.transport || {};   // #838-4 { naver(body) · coupang(body) · cafe24(body) } = 실제 호출(서버가 주입 · 검증은 가짜) · naverQuery(ids) = 전송 뒤 상태 확인(선택)
    const cfgGet = d.naverCfgGet || (async () => null);
    const sleep = d.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const notify = d.notifyTelegram || (async () => {});
    const kstIsoMs = d.kstIsoMs || (() => new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00'));
    const FILE_MAX = 5 * 1024 * 1024, FILES_MAX = 4;
    let _busy = false;
    // #858(대표 10/26 「발주컴퓨터부터 직원 모두 되야 함」) 등록·채널에 보내기 = 로그인 직원 전부 · 세무사(accountant)만 막음 · 누가 했는지 = audit actor 그대로
    const staffOnly = (req, res, next) => (req.user && req.user.role && req.user.role !== 'accountant') ? next() : res.status(403).json({ ok: false, error: '직원 계정만 등록할 수 있어요' });

    async function initDB() {
        await pool.query(`CREATE TABLE IF NOT EXISTS invoice_auto_runs (
            id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), created_by TEXT, ship_date DATE, file_hash TEXT,
            files JSONB, fetch_info JSONB, summary JSONB,   /* #838 핫픽스: fetch 는 PostgreSQL 예약어(v5.9.618 표 생성 실패) → fetch_info */ result JSONB, register_state TEXT, register JSONB, registered_at TIMESTAMPTZ, registered_by TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS invoice_auto_items (
            idem_key TEXT PRIMARY KEY, run_id INTEGER, channel TEXT, order_key TEXT, tracking TEXT, state TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`);
        await pool.query(`ALTER TABLE invoice_auto_items ADD COLUMN IF NOT EXISTS error_text TEXT`);       // #838-4 실패·모름 사유(채널 원문 · 손님 정보 0)
        await pool.query(`ALTER TABLE invoice_auto_items ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`);
    }

    app.post('/api/agent-office/invoice-auto/match', authMiddleware, async (req, res) => {
        // 빈 목록·개수 검사가 맨 먼저(화면이 열릴 때 {files:[]} 로 새 서버인지 봄 = 400 · 3채널 재조회·DB 쓰기 0 · 진행 중이어도 400)
        const files = Array.isArray(req.body && req.body.files) ? req.body.files : [];
        if (!files.length) return res.status(400).json({ ok: false, error: '운송장 파일이 없어요' });
        if (files.length > FILES_MAX) return res.status(400).json({ ok: false, error: '파일은 ' + FILES_MAX + '개까지' });
        if (_busy) return res.status(409).json({ ok: false, error: '다른 짝 맞추기가 진행 중이에요 — 끝난 뒤 다시 눌러 주세요' });
        _busy = true;
        try {
            const hash = require('crypto').createHash('sha256');
            const parsed = [];
            for (const f of files) {
                const name = String((f && f.name) || '').slice(0, 200), b64 = String((f && f.data) || '').replace(/^data:[^,]*,/, '');
                if (!b64) return res.status(400).json({ ok: false, error: '파일 내용이 비었어요: ' + name });
                const buf = Buffer.from(b64, 'base64'); if (buf.length > FILE_MAX) return res.status(400).json({ ok: false, error: '파일이 너무 커요(5MB): ' + name });
                hash.update(buf);
                const wb = new ExcelJS.Workbook(); try { await wb.xlsx.load(buf); } catch (e) { return res.status(400).json({ ok: false, error: '엑셀을 읽지 못했어요: ' + name }); }
                const rows = lois.shipRows(wb);
                if (!rows.length) return res.status(400).json({ ok: false, error: '「운송장번호」 머리글이 있는 시트가 없어요(CJ 운송장 시트인지 확인): ' + name });
                const pm = name.match(/\(([^)]+)\)/); const partner = pm ? pm[1] : '?';
                const dm = name.match(/(\d{1,2})\.(\d{1,2})/);
                parsed.push({ name, partner, wb, rows, md: dm ? dm[1].padStart(2, '0') + '-' + dm[2].padStart(2, '0') : null });
            }
            const today = kstToday();
            const shipDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.ship_date || '')) ? req.body.ship_date : (parsed[0].md ? today.slice(0, 4) + '-' + parsed[0].md : today);
            const days = Math.min(Math.max(parseInt(req.body.days, 10) || 30, 1), 60);
            // 3채널 재조회(읽기 · 종전 불러오기 함수 그대로) — 하나가 실패해도 나머지로
            const fetchInfo = {}, orders = [];
            for (const ch of ['naver', 'coupang', 'cafe24']) {
                try { const r = await fetchers[ch](days); const os = normOrders(ch, r && r.rows); orders.push(...os); fetchInfo[ch] = { ok: true, orders: os.length }; }
                catch (e) { fetchInfo[ch] = { ok: false, orders: 0, error: String((e && e.message) || e).slice(0, 120) }; }
            }
            const ships = []; parsed.forEach(p => ships.push(...normShips(p.rows.map(r => ({ ...r, partner: p.partner })), p.partner)));
            let pricingNames = [];   // #841 그날 단가표 이름(/api/invoice/catalog 와 같은 SQL · 읽기) · 실패하면 빈 목록(표준명·글자 비교로)
            try { const pr = await pool.query(`SELECT items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date`, [shipDate]); const set = new Set(); pr.rows.forEach(row => (row.items || []).forEach(it => { if (it && it.name) set.add(it.name); })); pricingNames = [...set]; } catch (e) { pricingNames = []; }
            const m = matchShipments({ ships, orders, pricingNames });
            const card = buildCard(m, orders);
            // 송장 색인(delivery_shipments) — 종전 LOIS 업로드와 같은 upsert(파일마다 · 같은 운송장은 합침) · 실패해도 짝 결과는 돌려줌
            let indexUp = 0, indexErr = null;
            for (const p of parsed) { try { indexUp += await lois.upsert(p.wb, p.rows, shipDate, p.partner === '?' ? '' : p.partner); } catch (e) { indexErr = String(e.message || e).slice(0, 120); } }
            const summary = { shipments: ships.length, auto: card.rows.filter(r => r.status === 'auto').length, todo: card.rows.filter(r => r.status === 'todo').length, cash: card.cash.length, extra: card.extra.length, unmatched: card.unmatched.length, index_upserted: indexUp, ...(indexErr ? { index_error: indexErr } : {}) };
            const filesOut = parsed.map(p => ({ name: p.name, partner: p.partner, rows: p.rows.length }));
            await pool.query(`DELETE FROM invoice_auto_runs WHERE created_at < now() - interval '90 days'`);
            await pool.query(`DELETE FROM invoice_auto_items WHERE created_at < now() - interval '90 days'`);   // #838-4 E
            const ins = await pool.query(`INSERT INTO invoice_auto_runs (created_by, ship_date, file_hash, files, fetch_info, summary, result) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [(adminActor(req) || {}).name || null, shipDate, hash.digest('hex').slice(0, 16), JSON.stringify(filesOut), JSON.stringify(fetchInfo), JSON.stringify(summary), JSON.stringify(stripPII(card))]);
            const runId = ins.rows[0].id;
            await writeAudit({ action: 'invoice_auto_match', targetType: 'invoice_auto_run', targetId: runId, changes: { ship_date: shipDate, files: filesOut, fetch: fetchInfo, summary, by_channel: card.by_channel }, source: 'invoice-auto', actor: adminActor(req) });
            res.json({ ok: true, run_id: runId, ship_date: shipDate, files: filesOut, fetch: fetchInfo, summary, ...card });
        } catch (e) { log.error('[#838 자동 송장] 짝 맞추기 실패:', e && e.message); res.status(500).json({ ok: false, error: '짝 맞추기에 실패했어요 — 잠시 뒤 다시 해 주세요' }); }
        finally { _busy = false; }
    });

    // ── #838-4 register = 준비(dry) → {dry:false} + send_enabled 이면 3채널 발송처리 ──
    const UNIT_KEY = row => row.channel === 'coupang' ? 'coupang:' + row.box_id : row.channel + ':' + row.order_key;   // 쿠팡 = 상자 · 그 밖 = 줄
    const BLOCK_STATES = ['sent', 'sending', 'unknown'];   // A: already 는 이 셋만(dry 준비 ready·실패 failed 는 새 실행이 덮음)
    const errCls = e => (e && e.status >= 400 && e.status < 500) ? 'failed' : 'unknown';   // 4xx = 채널·relay 가 처리 전에 거절 · 그 밖(끊김·5xx) = 모름
    const errMsg = e => String((e && ((e.data && (e.data.error || e.data.message)) || e.reason || e.message)) || e || '').slice(0, 200);
    async function sendNaver(units) {   // ≤30 · 줄마다 판정(HTTP 상태만 믿지 않음 · 두 목록 어디에도 없으면 unknown)
        const out = new Map();
        for (let i = 0; i < units.length; i += 30) {
            const chunk = units.slice(i, i + 30), when = kstIsoMs();
            const body = { dispatchProductOrders: chunk.map(u => ({ productOrderId: u.product_order_id, deliveryMethod: 'DELIVERY', deliveryCompanyCode: 'CJGLS', trackingNumber: u.tracking, dispatchDate: when })) };
            let data = null, err = null;
            try { data = await transport.naver(body); } catch (e) { err = e; data = e && e.data; }
            const dd = (data && data.data) ? data.data : (data || {});
            const okSet = new Set((dd.successProductOrderIds || []).map(String)), fail = new Map((dd.failProductOrderInfos || []).map(f => [String(f.productOrderId || ''), String((f.code || '') + ' ' + (f.message || '')).trim().slice(0, 200)]));
            for (const u of chunk) {
                if (okSet.has(u.product_order_id)) out.set(u.key, { state: 'sent' });
                else if (fail.has(u.product_order_id)) out.set(u.key, { state: 'failed', error: fail.get(u.product_order_id) || '실패' });
                else out.set(u.key, err ? { state: errCls(err), error: errMsg(err) } : { state: 'unknown', error: '응답에 처리 결과 없음' });
            }
            if (i + 30 < units.length) await sleep(350);
        }
        return out;
    }
    async function sendCoupang(units) {   // 상자마다 옵션 전부 한 줄씩 · 한 번에 50줄(상자는 안 쪼갬) · 0.5초 간격 · 번호는 글자 그대로
        const out = new Map(); const chunks = []; let cur = [], lines = 0;
        for (const u of units) { const n = u.vendor_item_ids.length; if (cur.length && lines + n > 50) { chunks.push(cur); cur = []; lines = 0; } cur.push(u); lines += n; }
        if (cur.length) chunks.push(cur);
        for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci];
            const body = { orderSheetInvoiceApplyDtos: chunk.flatMap(u => u.vendor_item_ids.map(v => ({ shipmentBoxId: u.box_id, orderId: u.order_id, vendorItemId: v, deliveryCompanyCode: 'CJGLS', invoiceNumber: u.tracking, splitShipping: false, preSplitShipped: false, estimatedShippingDate: '' }))) };
            let data = null, err = null;
            try { data = await transport.coupang(body); } catch (e) { err = e; data = e && e.data; }
            const dd = (data && data.data) ? data.data : (data || {});
            const byBox = new Map((dd.responseList || []).map(x => [String(x.shipmentBoxId), x]));
            for (const u of chunk) {
                const x = byBox.get(u.box_id);
                if (x && x.succeed === true) out.set(u.key, { state: 'sent' });
                else if (x) out.set(u.key, { state: 'failed', error: String((x.resultCode || '') + ' ' + (x.resultMessage || '') + (x.retryRequired ? ' (쿠팡: 다시 해도 됨 — 사람이 확인 뒤)' : '')).trim().slice(0, 200) });
                else out.set(u.key, err ? { state: errCls(err), error: errMsg(err) } : { state: 'unknown', error: '응답에 처리 결과 없음' });
            }
            if (ci + 1 < chunks.length) await sleep(500);
        }
        return out;
    }
    async function sendCafe24(units, carrier) {   // order_id + 운송장 으로 묶음 · 한 번에 100건 · 같은 order_id 는 한 묶음에 하나만(응답이 order_id 로 오므로)
        const out = new Map(); const groups = new Map();
        for (const u of units) { const g = u.order_id + '|' + u.tracking; if (!groups.has(g)) groups.set(g, { order_id: u.order_id, tracking: u.tracking, units: [] }); groups.get(g).units.push(u); }
        const chunks = []; for (const g of groups.values()) { let c = chunks.find(x => x.length < 100 && !x.some(y => y.order_id === g.order_id)); if (!c) { c = []; chunks.push(c); } c.push(g); }
        for (const chunk of chunks) {
            const body = { shop_no: 1, requests: chunk.map(g => ({ order_id: g.order_id, order_item_code: g.units.map(u => u.item_code), tracking_no: g.tracking, shipping_company_code: carrier, status: 'shipping' })) };
            let data = null, err = null;
            try { data = await transport.cafe24(body); } catch (e) { err = e; data = e && e.detail; }
            const list = Array.isArray(data && data.shipments) ? data.shipments : [];
            for (const g of chunk) {
                const hit = list.find(x => String(x.order_id || '') === g.order_id);
                let r;
                if (hit && !(hit.error || (hit.status && /^(4|5)\d\d$/.test(String(hit.status))))) r = { state: 'sent' };
                else if (hit) r = { state: 'failed', error: String((hit.error && (hit.error.message || hit.error.code)) || hit.message || hit.status || '실패').slice(0, 200) };
                else r = err ? { state: errCls(err), error: errMsg(err) + (err.status === 403 ? ' — 카페24 권한(write_order) 재승인 필요' : '') } : { state: 'unknown', error: '응답에 처리 결과 없음' };
                g.units.forEach(u => out.set(u.key, r));
            }
        }
        return out;
    }

    app.post('/api/agent-office/invoice-auto/register', authMiddleware, staffOnly, async (req, res) => {
        try {
            const runId = parseInt(req.body && req.body.run_id, 10); if (!runId) return res.status(400).json({ ok: false, error: 'run_id 가 없어요' });
            const r = await pool.query(`SELECT id, result, register_state FROM invoice_auto_runs WHERE id = $1`, [runId]);
            if (!r.rows.length) return res.status(404).json({ ok: false, error: '그 짝 맞추기 결과가 없어요(90일 지나 지워졌거나 번호가 틀림)' });
            if (r.rows[0].register_state === 'sent') return res.status(409).json({ ok: false, error: '이미 보낸 실행이에요 — 실패 줄은 [짝 맞추기]를 새로 해서 다시 보내세요' });
            let cfg = null; try { cfg = await cfgGet('invoice_auto'); } catch (_) { cfg = null; } cfg = cfg || {};
            const sendEnabled = cfg.send_enabled === true, wantSend = req.body.dry === false;
            const card = r.rows[0].result || {}; const picks = (req.body.picks && typeof req.body.picks === 'object') ? req.body.picks : {};
            const skip = new Set(Array.isArray(req.body.skip) ? req.body.skip.map(String) : []);
            const items = []; let manual = 0, skipped = 0;
            // ① 줄마다 운송장 정하기
            const chosen = [];
            for (const row of (card.rows || [])) {
                const base = { id: row.id, channel: row.channel, order_key: row.order_key, box_id: row.box_id };
                if (skip.has(row.id)) { skipped++; items.push({ ...base, tracking: null, idem: null, state: 'skipped' }); continue; }
                let tr = row.status === 'auto' ? row.tracking : null;
                if (row.status === 'todo') { const p = picks[row.id]; const ok = p && p !== 'manual' && (row.pick_options || []).some(x => x.tracking === dg(p)); tr = ok ? dg(p) : null; }
                if (!tr) { manual++; items.push({ ...base, tracking: null, idem: null, state: 'manual' }); continue; }
                chosen.push({ row, tr });
            }
            // #841 손질(워커3 점검): 같은 운송장이 서로 다른 주문 두 줄에 쓰이면 둘 다 보내지 않고 수기(쿠팡 같은 상자 · 카페24 같은 주문번호 = 한 상자라 제외)
            const grpOf = row => row.channel === 'coupang' ? 'coupang:' + row.box_id : row.channel === 'cafe24' ? 'cafe24:' + (row.order_id || row.box_id) : row.channel + ':' + row.order_key;
            const trGrp = new Map(); chosen.forEach(c => { if (!trGrp.has(c.tr)) trGrp.set(c.tr, new Set()); trGrp.get(c.tr).add(grpOf(c.row)); });
            for (let i = chosen.length - 1; i >= 0; i--) { const c = chosen[i]; if (trGrp.get(c.tr).size > 1) { manual++; items.push({ id: c.row.id, channel: c.row.channel, order_key: c.row.order_key, box_id: c.row.box_id, tracking: c.tr, idem: null, state: 'manual', error: '같은 운송장 두 줄 — 어느 주문 것인지 채널 화면에서 확인해 주세요' }); chosen.splice(i, 1); } }
            // ② 전송 단위(쿠팡 = 상자 · 운송장 = 상자 안 가장 작은 것 · 상자의 다른 줄이 건너뜀·수기면 상자째 수기)
            const units = new Map(); const blockedBox = new Set(items.filter(x => x.channel === 'coupang' && (x.state === 'manual' || x.state === 'skipped')).map(x => x.box_id));
            for (const c of chosen) {
                const key = UNIT_KEY(c.row);
                if (c.row.channel === 'coupang' && blockedBox.has(c.row.box_id)) { manual++; items.push({ id: c.row.id, channel: 'coupang', order_key: c.row.order_key, box_id: c.row.box_id, tracking: c.tr, idem: null, state: 'manual', error: '같은 상자의 다른 줄이 수기·건너뜀이라 상자째 수기' }); continue; }
                if (c.row.channel === 'coupang' && !c.row.order_id) { manual++; items.push({ id: c.row.id, channel: 'coupang', order_key: c.row.order_key, box_id: c.row.box_id, tracking: c.tr, idem: null, state: 'failed', error: '옛 짝 결과(쿠팡 주문번호 없음) — [짝 맞추기]를 다시 해 주세요' }); continue; }   // #838-4 손질(워커2): orderId 없이 보내지 않음
                const u = units.get(key) || { key, channel: c.row.channel, rows: [], tracking: c.tr, product_order_id: c.row.channel === 'naver' ? c.row.order_key : null, box_id: c.row.box_id, order_id: c.row.channel === 'coupang' ? c.row.order_id : (c.row.order_id || c.row.box_id), item_code: c.row.item_code || null,
                    vendor_item_ids: c.row.channel === 'coupang' ? (c.row.box_vendor_items && c.row.box_vendor_items.length ? c.row.box_vendor_items : [c.row.vendor_item_id]).filter(Boolean).map(String) : [] };
                u.rows.push(c.row); if (c.tr < u.tracking) u.tracking = c.tr; units.set(key, u);
            }
            // ③ 준비 저장(A: already = sent·sending·unknown 만 · 그 밖은 이 실행이 덮음)
            const ready = { naver: 0, coupang: 0, cafe24: 0 }; let already = 0; const readyUnits = [];
            for (const u of units.values()) {
                const prev = (await pool.query(`SELECT run_id, state, tracking FROM invoice_auto_items WHERE idem_key = $1`, [u.key])).rows[0];
                if (prev && BLOCK_STATES.includes(prev.state)) { already += u.rows.length; u.rows.forEach(row => items.push({ id: row.id, channel: u.channel, order_key: row.order_key, box_id: u.box_id, tracking: u.tracking, idem: u.key + ':' + u.tracking, state: 'already', prev_run: prev.run_id, prev_state: prev.state })); continue; }
                await pool.query(`INSERT INTO invoice_auto_items (idem_key, run_id, channel, order_key, tracking, state) VALUES ($1,$2,$3,$4,$5,'ready')
                    ON CONFLICT (idem_key) DO UPDATE SET run_id = EXCLUDED.run_id, tracking = EXCLUDED.tracking, state = 'ready', error_text = NULL, updated_at = now() WHERE invoice_auto_items.state NOT IN ('sent','sending','unknown')`, [u.key, runId, u.channel, u.key.slice(u.channel.length + 1), u.tracking]);
                ready[u.channel]++; readyUnits.push(u);
            }
            const itemOf = (u, row, extra) => ({ id: row.id, channel: u.channel, order_key: row.order_key, box_id: u.box_id, tracking: u.tracking, idem: u.key + ':' + u.tracking, ...extra });
            const actor = adminActor(req) || {};
            if (!wantSend || !sendEnabled) {
                readyUnits.forEach(u => u.rows.forEach(row => items.push(itemOf(u, row, { state: 'ready' }))));
                const reg = { dry: true, ready, already, manual, skipped, at: new Date().toISOString(), items };
                await pool.query(`UPDATE invoice_auto_runs SET register_state = 'prepared', register = $2, registered_at = now(), registered_by = $3 WHERE id = $1`, [runId, JSON.stringify(reg), actor.name || null]);
                await writeAudit({ action: 'invoice_auto_prepare', targetType: 'invoice_auto_run', targetId: runId, changes: { dry: true, ready, already, manual, skipped }, source: 'invoice-auto', actor: adminActor(req) });
                const base = { run_id: runId, dry: true, send_enabled: sendEnabled, ready, already, manual, skipped, items, manual_file: '/api/agent-office/invoice-auto/manual/' + runId };
                if (wantSend && !sendEnabled) return res.status(409).json({ ok: false, error: '자동 송장 전송이 꺼져 있어요(설정 invoice_auto.send_enabled) — 준비만 저장했어요', ...base });
                return res.json({ ok: true, ...base });
            }
            // ④ 전송 — 줄 집기(D: ready → sending · 이 실행 것만 · RETURNING) → 채널 순서 네이버 → 쿠팡 → 카페24
            const claimed = new Set((await pool.query(`UPDATE invoice_auto_items SET state = 'sending', updated_at = now() WHERE idem_key = ANY($1::text[]) AND run_id = $2 AND state = 'ready' RETURNING idem_key`, [readyUnits.map(u => u.key), runId])).rows.map(x => x.idem_key));
            const go = readyUnits.filter(u => claimed.has(u.key));
            readyUnits.filter(u => !claimed.has(u.key)).forEach(u => { already += u.rows.length; u.rows.forEach(row => items.push(itemOf(u, row, { state: 'already', error: '다른 요청이 먼저 집음' }))); });
            const results = new Map();
            const byCh = ch => go.filter(u => u.channel === ch);
            if (byCh('naver').length) { const m = typeof transport.naver === 'function' ? await sendNaver(byCh('naver')) : null; byCh('naver').forEach(u => results.set(u.key, m ? m.get(u.key) : { state: 'failed', error: '네이버 전송 함수 없음' })); }
            if (byCh('coupang').length) { const m = typeof transport.coupang === 'function' ? await sendCoupang(byCh('coupang')) : null; byCh('coupang').forEach(u => results.set(u.key, m ? m.get(u.key) : { state: 'failed', error: '쿠팡 전송 함수 없음' })); }
            if (byCh('cafe24').length) {
                const carrier = String(cfg.cafe24_carrier_code || '').trim();
                const m = (carrier && typeof transport.cafe24 === 'function') ? await sendCafe24(byCh('cafe24'), carrier) : null;
                byCh('cafe24').forEach(u => results.set(u.key, m ? m.get(u.key) : { state: 'failed', error: carrier ? '카페24 전송 함수 없음' : '카페24 CJ 배송사 코드 설정 없음(invoice_auto.cafe24_carrier_code)' }));
            }
            const cnt = { sent: { naver: 0, coupang: 0, cafe24: 0 }, failed: { naver: 0, coupang: 0, cafe24: 0 }, unknown: { naver: 0, coupang: 0, cafe24: 0 } };
            for (const u of go) {
                const rr = results.get(u.key) || { state: 'unknown', error: '결과 없음' };
                await pool.query(`UPDATE invoice_auto_items SET state = $2, error_text = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END, updated_at = now() WHERE idem_key = $1 AND run_id = $4`, [u.key, rr.state, rr.error || null, runId]);
                cnt[rr.state][u.channel]++;
                u.rows.forEach(row => items.push(itemOf(u, row, { state: rr.state, ...(rr.error ? { error: rr.error } : {}) })));
            }
            // ⑤ 전송 뒤 상태 확인(네이버만 · 선택 · 실패해도 결과 그대로)
            let confirmed = null;
            const sentNaver = go.filter(u => u.channel === 'naver' && (results.get(u.key) || {}).state === 'sent').map(u => u.product_order_id);
            if (sentNaver.length && typeof transport.naverQuery === 'function') { try { const st = await transport.naverQuery(sentNaver); confirmed = { naver: sentNaver.filter(id => /DELIVER|DISPATCH/.test(String(st[id] || ''))).length, checked: sentNaver.length }; } catch (e) { confirmed = { error: errMsg(e) }; } }
            const total = k => cnt[k].naver + cnt[k].coupang + cnt[k].cafe24;
            const reg = { dry: false, ready, already, manual, skipped, sent: cnt.sent, failed: cnt.failed, unknown: cnt.unknown, confirmed, at: new Date().toISOString(), items };
            await pool.query(`UPDATE invoice_auto_runs SET register_state = 'sent', register = $2, registered_at = now(), registered_by = $3 WHERE id = $1`, [runId, JSON.stringify(reg), actor.name || null]);
            await writeAudit({ action: 'invoice_auto_send', targetType: 'invoice_auto_run', targetId: runId, changes: { sent: cnt.sent, failed: cnt.failed, unknown: cnt.unknown, already, manual, skipped, confirmed }, source: 'invoice-auto-send', actor: adminActor(req) });
            if (total('failed') + total('unknown')) { try { await notify(`📦 자동 송장 등록 #${runId} — 보냄 ${total('sent')} · 실패 ${total('failed')} · 모름 ${total('unknown')} — 에이전트 오피스 최종발주 화면에서 실패 줄 파일을 내려받아 확인해 주세요`); } catch (_) {} }
            res.json({ ok: true, run_id: runId, dry: false, send_enabled: true, ready, already, manual, skipped, sent: cnt.sent, failed: cnt.failed, unknown: cnt.unknown, confirmed, items, manual_file: '/api/agent-office/invoice-auto/manual/' + runId });
        } catch (e) { log.error('[#838 자동 송장] 등록 실패:', e && e.message); res.status(500).json({ ok: false, error: '등록에 실패했어요 — 보낸 줄이 있을 수 있으니 채널 화면을 먼저 확인해 주세요' }); }
    });

    // #838-4 카페24 배송사 목록(읽기 · 관리자) — CJ대한통운 코드값을 설정 invoice_auto.cafe24_carrier_code 에 넣으려고(워커2 문서 3-3) · scope mall.read_shipping · 응답 원문(배송사 정보뿐 · 손님 정보 0) + CJ 후보
    const cafe24Get = d.cafe24Get || ((p, q) => require('./cafe24.js').apiGet(p, q));   // 서버와 같은 cafe24 모듈 인스턴스(토큰 공유) · 검증은 주입
    app.get('/api/agent-office/invoice-auto/cafe24-carriers', authMiddleware, adminOnly, async (req, res) => {
        try {
            const data = await cafe24Get('/api/v2/admin/carriers', { shop_no: 1 });
            const list = Array.isArray(data && data.carriers) ? data.carriers : [];
            const nameOf = c => String(c.shipping_carrier || c.shipping_carrier_name || c.carrier_name || c.name || '');
            const cj = list.filter(c => /CJ|대한통운/i.test(nameOf(c)));
            res.json({ ok: true, count: list.length, cj_candidates: cj.map(c => ({ shipping_carrier_code: c.shipping_carrier_code, carrier_id: c.carrier_id, name: nameOf(c), default: c.default_shipping_carrier != null ? c.default_shipping_carrier : (c.default != null ? c.default : null) })), raw: data });
        } catch (e) {
            const forbidden = !!(e && e.status === 403);
            res.status(forbidden ? 403 : 502).json({ ok: false, error: forbidden ? '카페24 권한(mall.read_shipping) 없음 — 재승인 확인' : '카페24 배송사 목록을 못 읽었어요: ' + String((e && (e.reason || e.message)) || e).slice(0, 120) });
        }
    });

    // 실패·모름·수기 줄 엑셀(손님 이름 가림 · 번호·주소 0) — 네이버 「발송처리」 시트 = 센터 엑셀 일괄발송 4칸 꼴
    app.get('/api/agent-office/invoice-auto/manual/:id', authMiddleware, async (req, res) => {
        try {
            const runId = parseInt(req.params.id, 10);
            const r = await pool.query(`SELECT id, ship_date, result, register FROM invoice_auto_runs WHERE id = $1`, [runId]);
            if (!r.rows.length) return res.status(404).json({ ok: false, error: '그 실행이 없어요' });
            const card = r.rows[0].result || {}, reg = r.rows[0].register || {}; const byId = new Map((card.rows || []).map(x => [x.id, x]));
            const bad = (reg.items || []).filter(x => ['failed', 'unknown', 'manual'].includes(x.state));
            const why = x => x.state === 'manual' ? (x.error || '수기(고르지 않음·수기 선택)') : x.state === 'unknown' ? '모름 — 채널 화면에서 발송됐는지 먼저 확인: ' + (x.error || '') : '실패: ' + (x.error || '');
            const wb = new ExcelJS.Workbook();
            const s1 = wb.addWorksheet('발송처리'); s1.addRow(['상품주문번호', '배송방법', '택배사', '송장번호', '받는분(가림)', '옵션', '사유']);
            const s2 = wb.addWorksheet('쿠팡·자사몰'); s2.addRow(['채널', '주문번호', '배송번호·품주코드', '운송장', '받는분(가림)', '옵션', '사유']);
            for (const x of bad) {
                const row = byId.get(x.id) || {}; const tr = x.tracking || '';
                if (x.channel === 'naver') s1.addRow([row.order_key || x.order_key, '택배,등기,소포', 'CJ대한통운', tr, row.recipient_masked || '', row.option || '', why(x)]);
                else s2.addRow([x.channel === 'coupang' ? '쿠팡' : '자사몰', row.order_id || '', x.channel === 'coupang' ? (row.box_id || '') : (row.item_code || ''), tr, row.recipient_masked || '', row.option || '', why(x)]);
            }
            [s1, s2].forEach(ws => { ws.getRow(1).font = { bold: true }; ws.columns.forEach(c => { c.width = 22; }); });
            const buf = await wb.xlsx.writeBuffer();
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('자동송장_수기확인_#' + runId + '.xlsx'));
            res.send(Buffer.from(buf));
        } catch (e) { log.error('[#838 자동 송장] 수기 파일 실패:', e && e.message); res.status(500).json({ ok: false, error: '파일을 만들지 못했어요' }); }
    });

    return { initDB };
};
module.exports.matchShipments = matchShipments;
module.exports.normOrders = normOrders;
module.exports.normShips = normShips;
module.exports.buildCard = buildCard;
module.exports.prodMatch = prodMatch;
module.exports.maskRecipient = maskRecipient;
module.exports.stripPII = stripPII;
module.exports.canonOf = canonOf;
