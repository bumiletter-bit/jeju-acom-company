// #838-1 자동 송장 등록 — 1단계(외부 쓰기 0) · 설계 정본 docs/838/838-자동송장등록-시공설계(정본).md · 화면 계약 docs/838/838-api.md
//   POST /api/agent-office/invoice-auto/match    (로그인 누구나) = CJ(LOIS) 운송장 시트 xlsx(base64 JSON) → 3채널 「불러오기」 재조회(읽기) → 짝 맞추기 → 카드 JSON 저장
//                                                  + 같은 호출에서 delivery_shipments 색인(종전 /api/delivery/shipments/upload 와 같은 upsert · 종전 길 유지)
//   POST /api/agent-office/invoice-auto/register (관리자) = 짝 결과 + 선택 → 멱등 열쇠로 「전송 준비」 저장 · 🔴 1단계는 dry 고정(채널 전송 함수 0 · #838-3 relay·scope 뒤 붙임)
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
        else if (channel === 'coupang') o = { order_key: String(r._shipmentBoxId || r._orderId || '') + '|' + String(r._vendorItemId || ''), box_id: String(r._shipmentBoxId || ''), name: r['수취인이름'], tel: r['수취인전화번호'], addr: r['수취인 주소'], buyer: r['구매자전화번호'], option: r['노출상품명(옵션명)'] || r['등록상품명'], qty: r['구매수(수량)'] };
        else if (channel === 'cafe24') o = { order_key: String(r._orderId || '') + '|' + String(r._itemCode || ''), box_id: String(r._orderId || ''), item_code: String(r._itemCode || ''), name: r['수령인'], tel: r['수령인 휴대전화'], addr: r['수령인 주소(전체)'], buyer: r['주문자 휴대전화'], option: r['주문상품명(세트상품 포함)'], qty: r['수량'] };
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

// 짝 맞추기(순수 함수 · 검증이 바로 부름) — 정본 2절 규칙표
function matchShipments({ ships, orders }) {
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
            const hit = os.filter(o => prodMatch(o.option, s.product)); const hp = new Set(hit.map(o => normProd(o.option)));
            if (hp.size !== 1) { bad = true; break; }
            const gk = [...hp][0]; if (!groups.has(gk)) groups.set(gk, { os: hit, ss: [] }); groups.get(gk).ss.push(s);
        }
        if (bad) { os.forEach(o => todos.push({ o, rule: 'todo_product', options: ss })); continue; }
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
            const mine = cand.filter(s => !used.has(s.tracking) && prodMatch(o.option, s.product)); if (!mine.length) continue;
            // 그 구매자의 운송장 안 붙은 주문 가운데 같은 품목이 둘 이상이면 어느 주문 것인지 모름(지정발송일 주문과 섞일 수 있음) → 할 일
            const rivals = os.filter(x => x !== o && prodMatch(x.option, mine[0].product));
            if (rivals.length) { todos.push({ o, rule: 'todo_pick', options: mine }); todoKeys.add(o.channel + ':' + o.order_key); continue; }
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
    return { assign: [...assign.values()], todos, cash, extra, unmatched };
}

// 응답·저장 꼴(손님 이름 가림 · 번호 끝 4자리 · 주소 0)
function buildCard(m, orders) {
    const rows = []; let n = 0;
    const by = { naver: { auto: 0, todo: 0, cash: 0, skipped: 0 }, coupang: { auto: 0, todo: 0, cash: 0, skipped: 0 }, cafe24: { auto: 0, todo: 0, cash: 0, skipped: 0 } };
    const shipOpt = s => ({ tracking: s.tracking, recipient_masked: maskRecipient(s.name, s.tel), product: s.product });
    for (const a of m.assign) {
        const o = a.o, ss = a.ships.slice().sort((x, y) => (x.tracking < y.tracking ? -1 : 1));
        rows.push({ id: 'r' + (++n), channel: o.channel, order_key: o.order_key, box_id: o.box_id, item_code: o.item_code || null, recipient_masked: maskRecipient(o.name, o.tel), option: o.option, qty: o.qty,
            tracking: ss[0].tracking, tracking_all: ss.map(s => s.tracking), rule: a.rule, status: 'auto', pick_options: [] });
        by[o.channel].auto++; by[o.channel].skipped += ss.length - 1;
    }
    for (const t of m.todos) {
        const o = t.o;
        rows.push({ id: 'r' + (++n), channel: o.channel, order_key: o.order_key, box_id: o.box_id, item_code: o.item_code || null, recipient_masked: maskRecipient(o.name, o.tel), option: o.option, qty: o.qty,
            tracking: null, tracking_all: [], rule: t.rule, status: 'todo', pick_options: t.options.map(shipOpt) });
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
    const FILE_MAX = 5 * 1024 * 1024, FILES_MAX = 4;
    let _busy = false;

    async function initDB() {
        await pool.query(`CREATE TABLE IF NOT EXISTS invoice_auto_runs (
            id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), created_by TEXT, ship_date DATE, file_hash TEXT,
            files JSONB, fetch JSONB, summary JSONB, result JSONB, register_state TEXT, register JSONB, registered_at TIMESTAMPTZ, registered_by TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS invoice_auto_items (
            idem_key TEXT PRIMARY KEY, run_id INTEGER, channel TEXT, order_key TEXT, tracking TEXT, state TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`);
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
            const m = matchShipments({ ships, orders });
            const card = buildCard(m, orders);
            // 송장 색인(delivery_shipments) — 종전 LOIS 업로드와 같은 upsert(파일마다 · 같은 운송장은 합침) · 실패해도 짝 결과는 돌려줌
            let indexUp = 0, indexErr = null;
            for (const p of parsed) { try { indexUp += await lois.upsert(p.wb, p.rows, shipDate, p.partner === '?' ? '' : p.partner); } catch (e) { indexErr = String(e.message || e).slice(0, 120); } }
            const summary = { shipments: ships.length, auto: card.rows.filter(r => r.status === 'auto').length, todo: card.rows.filter(r => r.status === 'todo').length, cash: card.cash.length, extra: card.extra.length, unmatched: card.unmatched.length, index_upserted: indexUp, ...(indexErr ? { index_error: indexErr } : {}) };
            const filesOut = parsed.map(p => ({ name: p.name, partner: p.partner, rows: p.rows.length }));
            await pool.query(`DELETE FROM invoice_auto_runs WHERE created_at < now() - interval '90 days'`);
            const ins = await pool.query(`INSERT INTO invoice_auto_runs (created_by, ship_date, file_hash, files, fetch, summary, result) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [(adminActor(req) || {}).name || null, shipDate, hash.digest('hex').slice(0, 16), JSON.stringify(filesOut), JSON.stringify(fetchInfo), JSON.stringify(summary), JSON.stringify(card)]);
            const runId = ins.rows[0].id;
            await writeAudit({ action: 'invoice_auto_match', targetType: 'invoice_auto_run', targetId: runId, changes: { ship_date: shipDate, files: filesOut, fetch: fetchInfo, summary, by_channel: card.by_channel }, source: 'invoice-auto', actor: adminActor(req) });
            res.json({ ok: true, run_id: runId, ship_date: shipDate, files: filesOut, fetch: fetchInfo, summary, ...card });
        } catch (e) { log.error('[#838 자동 송장] 짝 맞추기 실패:', e && e.message); res.status(500).json({ ok: false, error: '짝 맞추기에 실패했어요 — 잠시 뒤 다시 해 주세요' }); }
        finally { _busy = false; }
    });

    // 1단계 = dry 고정(전송 함수 0). 멱등 열쇠 = 채널:주문번호(주문당 발송처리는 한 번뿐 · 다른 운송장으로도 두 번 안 감) · 응답 idem 글 = 채널:주문번호:운송장
    app.post('/api/agent-office/invoice-auto/register', authMiddleware, adminOnly, async (req, res) => {
        try {
            const runId = parseInt(req.body && req.body.run_id, 10); if (!runId) return res.status(400).json({ ok: false, error: 'run_id 가 없어요' });
            const r = await pool.query(`SELECT id, result, register_state FROM invoice_auto_runs WHERE id = $1`, [runId]);
            if (!r.rows.length) return res.status(404).json({ ok: false, error: '그 짝 맞추기 결과가 없어요(90일 지나 지워졌거나 번호가 틀림)' });
            if (r.rows[0].register_state === 'sent') return res.status(409).json({ ok: false, error: '이미 보낸 실행이에요' });
            const card = r.rows[0].result || {}; const picks = (req.body.picks && typeof req.body.picks === 'object') ? req.body.picks : {};
            const skip = new Set(Array.isArray(req.body.skip) ? req.body.skip.map(String) : []);
            const ready = { naver: 0, coupang: 0, cafe24: 0 }; let already = 0, manual = 0, skipped = 0; const items = [];
            for (const row of (card.rows || [])) {
                if (skip.has(row.id)) { skipped++; items.push({ id: row.id, channel: row.channel, order_key: row.order_key, tracking: null, idem: null, state: 'skipped' }); continue; }
                let tr = row.status === 'auto' ? row.tracking : null;
                if (row.status === 'todo') { const p = picks[row.id]; const ok = p && p !== 'manual' && (row.pick_options || []).some(x => x.tracking === dg(p)); tr = ok ? dg(p) : null; }
                if (!tr) { manual++; items.push({ id: row.id, channel: row.channel, order_key: row.order_key, tracking: null, idem: null, state: 'manual' }); continue; }
                const key = row.channel + ':' + row.order_key, idem = key + ':' + tr;
                const prev = (await pool.query(`SELECT run_id, state, tracking FROM invoice_auto_items WHERE idem_key = $1`, [key])).rows[0];
                if (prev && (prev.state === 'sent' || prev.run_id !== runId)) { already++; items.push({ id: row.id, channel: row.channel, order_key: row.order_key, tracking: tr, idem, state: 'already', prev_run: prev.run_id, prev_state: prev.state }); continue; }
                await pool.query(`INSERT INTO invoice_auto_items (idem_key, run_id, channel, order_key, tracking, state) VALUES ($1,$2,$3,$4,$5,'ready')
                    ON CONFLICT (idem_key) DO UPDATE SET tracking = EXCLUDED.tracking, state = 'ready', updated_at = now() WHERE invoice_auto_items.run_id = EXCLUDED.run_id AND invoice_auto_items.state <> 'sent'`, [key, runId, row.channel, row.order_key, tr]);
                ready[row.channel] = (ready[row.channel] || 0) + 1; items.push({ id: row.id, channel: row.channel, order_key: row.order_key, tracking: tr, idem, state: 'ready' });
            }
            const reg = { dry: true, ready, already, manual, skipped, at: new Date().toISOString() };
            await pool.query(`UPDATE invoice_auto_runs SET register_state = 'prepared', register = $2, registered_at = now(), registered_by = $3 WHERE id = $1`, [runId, JSON.stringify(reg), (adminActor(req) || {}).name || null]);
            await writeAudit({ action: 'invoice_auto_prepare', targetType: 'invoice_auto_run', targetId: runId, changes: reg, source: 'invoice-auto', actor: adminActor(req) });
            res.json({ ok: true, run_id: runId, dry: true, send_enabled: false, ready, already, manual, skipped, items, manual_file: null });
        } catch (e) { log.error('[#838 자동 송장] 등록 준비 실패:', e && e.message); res.status(500).json({ ok: false, error: '등록 준비에 실패했어요' }); }
    });

    return { initDB };
};
module.exports.matchShipments = matchShipments;
module.exports.normOrders = normOrders;
module.exports.normShips = normShips;
module.exports.buildCard = buildCard;
module.exports.prodMatch = prodMatch;
module.exports.maskRecipient = maskRecipient;
