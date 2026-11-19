// #1197-B 검증 — server.js 직영몰(store:'biz') 붙이기 · 실코드를 떼어 가짜 중계서버·가짜 DB 로 실행
//   🔴 실DB·실네이버·실중계서버·실발송·실발주확인·실송장등록 호출 0 · server.js 를 띄우지 않음 · 포트 안 씀
//   비교 기준 = #1197 직전 커밋(e60b20c · 환경변수 BASE_REF 로 바꿀 수 있음)의 server.js 같은 함수 · #1197 배포 뒤 HEAD 와 비교하면 HEAD 에 이미 새 함수가 있어 못 씀(스위치 꺼짐 = 고치기 전과 같은 결과·같은 호출)
//   node scripts/verify-1197-server.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const NEW_SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HEAD_SRC = execFileSync('git', ['show', (process.env.BASE_REF || 'e60b20c') + ':server.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else fail++; console.log((cond ? '✅ ' : '❌ ') + name + (!cond && extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); };

// ── 최상위 선언 떼어내기(문자열·템플릿·주석·정규식을 건너뛰며 괄호 맞춤) ──
function scanEnd(src, start, untilSemicolon) {
    let i = start, depth = 0, seenBrace = false; const stack = [];   // 'tpl' = 템플릿 글자 안 · {saved} = ${ } 식 안
    let prevSig = '(';
    const isRegexStart = () => /[(,=:[!&|?{};+\-*%<>~^]/.test(prevSig) || prevSig === 'return';
    while (i < src.length) {
        const c = src[i], n = src[i + 1], top = stack[stack.length - 1];
        if (top === 'tpl') {
            if (c === '\\') { i += 2; continue; }
            if (c === '`') { stack.pop(); i++; prevSig = 'a'; continue; }
            if (c === '$' && n === '{') { stack.push({ saved: depth }); depth = 0; i += 2; prevSig = '{'; continue; }
            i++; continue;
        }
        if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) i = src.length; continue; }
        if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
        if (c === '"' || c === "'") { i++; while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; prevSig = 'a'; continue; }
        if (c === '`') { stack.push('tpl'); i++; continue; }
        if (c === '/' && isRegexStart()) {
            i++; let cls = false;
            while (i < src.length) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; i++; }
            i++; while (/[a-z]/i.test(src[i])) i++; prevSig = 'a'; continue;
        }
        if (c === '{' || c === '(' || c === '[') { depth++; if (c === '{') seenBrace = true; }
        else if (c === '}' || c === ')' || c === ']') {
            if (c === '}' && depth === 0 && top && typeof top === 'object') { depth = stack.pop().saved; i++; prevSig = 'a'; continue; }
            depth--;
            if (depth === 0 && c === '}' && seenBrace && !untilSemicolon) return i + 1;
        } else if (c === ';' && depth === 0 && untilSemicolon) return i + 1;
        if (!/\s/.test(c)) { if (/[a-z0-9_$]/i.test(c)) { let j = i; while (/[a-z0-9_$]/i.test(src[j])) j++; prevSig = src.slice(i, j); i = j; continue; } prevSig = c; }
        i++;
    }
    throw new Error('끝을 못 찾음 @' + start);
}
function grab(src, name) {
    const fnRe = new RegExp('^(async\\s+)?function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\(', 'm');
    let m = fnRe.exec(src);
    if (m) return src.slice(m.index, scanEnd(src, m.index, false));
    const vRe = new RegExp('^(const|let)\\s+' + name.replace(/\$/g, '\\$') + '\\s*=', 'm');
    m = vRe.exec(src);
    if (m) return src.slice(m.index, scanEnd(src, m.index, true));
    return null;
}
const COMMON = ['naverMaskPII', 'isExperienceOrder', 'isUsableTel', 'isMaskedTel', 'isBadTel', 'resolveReceiver', 'refetchReceiverTel', 'naverFetchChanges',
    'naverConfirmIsAlready', 'naverConfirmOrders', 'kakaoBrokenWhy', 'kakaoBrokenAlert', 'KAKAO_BROKEN_GAP_MS', 'naverKstIso', 'EXPERIENCE_PRODUCTS_DEFAULT',
    '_naverFetchInvoiceOrdersCore', 'collectKakaoNotify', 'collectLmsGuide', 'lmsGuideBuildAndSend'];
const NEW_ONLY = ['NAVER_BIZ_LABEL', '_naverBizCfg', 'naverBizCfg', '_naverBizRelay', 'naverBizRelayReady', '_naverBizIds', 'naverBizIdsMap', 'naverBizRemember',
    'naverReqIds', 'naverMergeResp', '_naverBizAlertAt', 'naverBizAlert', 'naverIs4xx', 'naverFailResp', 'naverCallWithRetryRaw', '_naverFetchInvoiceOrdersOne', 'collectKakaoNotifyStore', 'collectLmsGuideStore'];
function build(src, names) {
    const parts = [];
    for (const n of names.concat(['naverCallWithRetry'])) { const s = grab(src, n); if (!s) throw new Error('못 찾음: ' + n); parts.push(s); }
    return parts.join('\n\n');
}

// ── 가짜 세상 ──
const PAY = '2026-11-19T14:00:00.000+09:00';   // 14시 결제 = 8시 보류 아님
function order(id, store, extra) {
    return { productOrder: Object.assign({ productOrderId: id, productOrderStatus: 'PAYED', productName: '제주 감귤', productOption: '타이벡감귤 5kg',
        quantity: 1, productId: store === 'biz' ? '13749954158' : '6400134206', shippingAddress: { name: '받는분', tel1: '010-1111-2222', baseAddress: '제주', detailedAddress: '1' },
        expectedSettlementAmount: 10000, shippingMemo: '' }, extra || {}),
        order: { orderId: 'O' + id, ordererName: '주문자', ordererTel: '010-1234-5678', paymentDate: PAY, orderDate: PAY } };
}
function world(o) {
    o = o || {};
    const W = { calls: [], sql: [], tg: [], cfg: Object.assign({}, o.cfg || {}), guideMeta: [], health: 0 };
    const DATA = { main: { orders: ['1000000000001', '1000000000002'], changes: [{ productOrderId: '1000000000001', lastChangedType: 'PAYED' }, { productOrderId: '1000000000003', lastChangedType: 'DISPATCHED' }] },
        biz: { orders: o.oldRelay ? ['1000000000001', '1000000000002'] : ['2000000000001'], changes: o.oldRelay ? [{ productOrderId: '1000000000001', lastChangedType: 'PAYED' }, { productOrderId: '1000000000003', lastChangedType: 'DISPATCHED' }]
            : [{ productOrderId: '2000000000001', lastChangedType: 'PAYED' }, { productOrderId: '2000000000003', lastChangedType: 'DISPATCHED' }] } };
    const firstHit = new Set();
    const naverRelay = {
        configured: () => true,
        relayHealth: async () => { W.health++; if (o.healthThrow) throw new Error('down'); return { ok: true, biz_keys_set: o.bizKeys !== false }; },
        callNaver: async (req) => {
            const st = req.store === 'biz' ? 'biz' : 'main';
            W.calls.push(JSON.parse(JSON.stringify(req)));
            if (st === 'biz' && o.bizThrow) { const sc = typeof o.bizThrow === 'number' ? o.bizThrow : 500; const e = new Error('naver_relay_error_' + sc); e.status = sc; throw e; }
            if (st === 'main' && o.mainThrow && /confirm|dispatch/.test(req.path)) { const e = new Error('naver_relay_error_' + o.mainThrow); e.status = o.mainThrow; throw e; }
            if (req.path === '/external/v1/pay-order/seller/product-orders') {
                const k = st + '|' + req.query.placeOrderStatusType;
                if (firstHit.has(k)) return { data: { contents: [] } };
                firstHit.add(k);
                return { data: { contents: DATA[st].orders.map(id => ({ content: order(id, st) })) } };
            }
            if (/last-changed-statuses$/.test(req.path)) return { data: { lastChangeStatuses: DATA[st].changes } };
            if (/product-orders\/query$/.test(req.path)) return { data: (req.body.productOrderIds || []).map(id => order(id, st, /3$/.test(id) ? { productOrderStatus: 'DELIVERING', delivery: { trackingNumber: '123' } } : {})) };
            if (/product-orders\/confirm$/.test(req.path)) return { data: { successProductOrderInfos: req.body.productOrderIds.map(id => ({ productOrderId: id })), failProductOrderInfos: [] } };
            if (/product-orders\/dispatch$/.test(req.path)) return { data: { successProductOrderIds: req.body.dispatchProductOrders.map(x => x.productOrderId), failProductOrderInfos: [] } };
            return { data: {} };
        },
    };
    const pool = { query: async (sql, params) => { W.sql.push([String(sql).replace(/\s+/g, ' ').trim(), params]); return { rows: [] }; } };
    const kakaoNotify = { switchOn: () => true, matchNotifyProduct: () => null, isReserveOrder: () => false, orderTemplate: () => ({ content: 'tpl' }), buildMessage: () => 'msg',
        cleanProductName: s => String(s), maskPhone: () => '010-****-5678', sendAlimtalk: async () => ({ mode: 'real', status: 'sent' }), orderTplCode: () => 'T',
        sendShippingGuideAlimtalk: async () => ({ mode: 'real', status: 'sent', messageText: 'g' }) };
    const shippingSchedule = { isShipDay: () => true, computeShipping: () => ({ text: 'ship' }), computeArrival: () => ({ text: 'arr' }), renderGuidePlaceholders: s => s };
    const ctx = {
        console: { log() {}, error() {} }, setTimeout: (f) => setTimeout(f, 0), Promise, Date, JSON, Math, Map, Set, Object, Array, String, Number, Error, RegExp, parseInt, isNaN,
        naverRelay, pool, kakaoNotify, shippingSchedule,
        naverCfgGet: async k => (k in W.cfg ? JSON.parse(JSON.stringify(W.cfg[k])) : null),
        naverCfgSet: async (k, v) => { W.cfg[k] = JSON.parse(JSON.stringify(v)); },
        notifyTelegram: async t => { W.tg.push(String(t)); },
        experienceProductIds: async () => ['7673020911'],
        loadShippingHolidayInfo: async () => ({ set: new Set(), reasons: new Map(), arriveOff: new Set() }),
        memoShipLineSafe: () => null, alertEnabled: async () => false, alertQuietNow: async () => false, alertNightAcc: async () => {}, alertText: async () => '',
        notifyNameTailLoad: async () => {}, notifyNameWithTail: (a, b) => b, guideOrderToken: k => 'T' + k, kstMdDow: () => '11/19(목)',
        guideLogMeta: async (k, m) => { W.guideMeta.push([k, m]); },
    };
    return { W, ctx };
}
function load(src, names, o) {
    const { W, ctx } = world(o);
    vm.createContext(ctx);
    vm.runInContext(build(src, names) + '\n;this.__ = { _naverFetchInvoiceOrdersCore, collectKakaoNotify, collectLmsGuide, naverCallWithRetry, naverConfirmOrders };', ctx);
    return { W, F: ctx.__ };
}
const headLoad = o => load(HEAD_SRC, COMMON, o);
const newLoad = o => load(NEW_SRC, COMMON.concat(NEW_ONLY), o);
const ON = { cfg: { naver_biz_store: { enabled: true } } };
const strip = r => JSON.parse(JSON.stringify(r));
const sqlOf = W => W.sql.map(x => x[0]);
const callsKey = W => JSON.stringify(W.calls).replace(/"20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9:.]+\+09:00"/g, '"T"');   /* 조회 시각(지금 기준)은 실행마다 달라 지움 */

(async () => {
    // ① 스위치 꺼짐 = HEAD 와 같은 결과·같은 호출
    for (const opts of [undefined, { extended: true }, { extended: true, placeStatuses: ['OK', 'NOT_YET'] }]) {
        const h = headLoad(), n = newLoad();
        const rh = await h.F._naverFetchInvoiceOrdersCore(2, opts), rn = await n.F._naverFetchInvoiceOrdersCore(2, opts);
        ok('①꺼짐 수집 결과 HEAD 와 같음 ' + JSON.stringify(opts || {}), JSON.stringify(strip(rh)) === JSON.stringify(strip(rn)), { rh, rn });
        ok('①꺼짐 수집 호출 HEAD 와 같음(store 칸 없음)', callsKey(h.W) === callsKey(n.W) && n.W.calls.every(c => !('store' in c)));
        ok('①꺼짐 health 안 부름', n.W.health === 0);
    }
    {
        const h = headLoad(), n = newLoad();
        const a = await h.F.collectKakaoNotify(), b = await n.F.collectKakaoNotify();
        ok('①꺼짐 주문안내 결과 글 같음', a === b, { a, b });
        ok('①꺼짐 주문안내 중계 호출 같음', callsKey(h.W) === callsKey(n.W), { h: h.W.calls.map(c => c.path), n: n.W.calls.map(c => c.path) });
        ok('①꺼짐 주문안내 DB 문장 같음(설정 읽기 1줄 더 = 직영몰 스위치 · 등록부 읽기)', JSON.stringify(sqlOf(h.W)) === JSON.stringify(sqlOf(n.W)));
        const g1 = await h.F.collectLmsGuide(), g2 = await n.F.collectLmsGuide();
        ok('①꺼짐 발송안내 결과 글 같음', g1 === g2, { g1, g2 });
        ok('①꺼짐 발송안내 호출·구매단추 번호 같음', callsKey(h.W) === callsKey(n.W) && JSON.stringify(h.W.guideMeta) === JSON.stringify(n.W.guideMeta));
    }
    // ② 켜짐 = 직영몰 행에 표식 · 스마트스토어 행 무변
    {
        const h = headLoad(), n = newLoad(ON);
        const rh = await h.F._naverFetchInvoiceOrdersCore(2, { extended: true }), rn = await n.F._naverFetchInvoiceOrdersCore(2, { extended: true });
        const mainRows = rn.rows.filter(r => !r._store), bizRows = rn.rows.filter(r => r._store);
        ok('②켜짐 스마트스토어 행은 HEAD 와 같음', JSON.stringify(strip(mainRows)) === JSON.stringify(strip(rh.rows)));
        ok('②켜짐 직영몰 행 1줄 _store biz · _storeName 네이버 직영몰', bizRows.length === 1 && bizRows[0]._pid === '2000000000001' && bizRows[0]._store === 'biz' && bizRows[0]._storeName === '네이버 직영몰', bizRows);
        ok('②직영몰 행에도 시트2 재료(_x · 정산예정금액)', bizRows[0] && bizRows[0]._x && bizRows[0]._x.expectedSettlementAmount === 10000 && bizRows[0]._x.productId === '13749954158');
        ok('②biz 요약 칸', rn.biz && rn.biz.count === 1 && rn.fetched === rh.fetched + 1, rn.biz);
        ok('②직영몰 호출에만 store biz', n.W.calls.filter(c => c.store === 'biz').length > 0 && n.W.calls.filter(c => c.store && c.store !== 'biz').length === 0);
        ok('②등록부에 B1', n.W.cfg.naver_biz_order_ids && '2000000000001' in n.W.cfg.naver_biz_order_ids && !('1000000000001' in n.W.cfg.naver_biz_order_ids));
    }
    // ③ 직영몰 실패해도 스마트스토어 결과 그대로
    {
        const h = headLoad(), n = newLoad(Object.assign({ bizThrow: true }, ON));
        const rh = await h.F._naverFetchInvoiceOrdersCore(2), rn = await n.F._naverFetchInvoiceOrdersCore(2);
        ok('③직영몰 실패 = 스마트스토어 행 그대로 + bizError', JSON.stringify(strip(rh.rows)) === JSON.stringify(strip(rn.rows)) && !!rn.bizError && !rn.biz);
        ok('③직영몰 실패 알림 1줄(직영몰 글)', n.W.tg.length === 1 && /직영몰/.test(n.W.tg[0]), n.W.tg);
    }
    // ③-2 중계서버 직영몰 열쇠 없음(구판) / health 실패 = 직영몰 안 돎
    for (const o of [{ bizKeys: false }, { healthThrow: true }]) {
        const n = newLoad(Object.assign({}, o, ON));
        const rn = await n.F._naverFetchInvoiceOrdersCore(2);
        ok('③-2 ' + JSON.stringify(o) + ' = 직영몰 호출 0', n.W.calls.every(c => !c.store) && !rn.biz && rn.rows.every(r => !r._store));
    }
    // ③-3 구판 중계서버(store 무시 · 같은 주문이 옴) 이중 안전 = 겹친 번호 버림 · 등록부 무변
    {
        const n = newLoad(Object.assign({ oldRelay: true }, ON));
        const rn = await n.F._naverFetchInvoiceOrdersCore(2);
        ok('③-3 구판 흉내 = 직영몰 표식 0 · 등록부 비어 있음', rn.rows.every(r => !r._store) && rn.biz && rn.biz.dup === 2 && !n.W.cfg.naver_biz_order_ids);
        const t = await n.F.collectKakaoNotify();
        const confirms = n.W.calls.filter(c => /confirm$/.test(c.path));
        ok('③-3 구판 흉내 주문안내 = 직영몰 쪽 0건 · 발주확인은 스마트스토어 열쇠 1번', confirms.length === 1 && !confirms[0].store && /직영몰 신규 결제 0건/.test(t), { t, confirms });
    }
    // ④ 켜짐 주문안내 = 발주확인이 주문별로 맞는 열쇠
    {
        const n = newLoad(ON);
        const t = await n.F.collectKakaoNotify();
        const confirms = n.W.calls.filter(c => /confirm$/.test(c.path));
        ok('④주문안내 결과 글 = 종전 + 직영몰', /^알림톡 실발송 처리 1건 .* · 직영몰 알림톡 실발송 처리 1건/.test(t), t);
        ok('④발주확인 2번 = M1(store 없음) · B1(store biz)', confirms.length === 2 && JSON.stringify(confirms[0].body.productOrderIds) === '["1000000000001"]' && !confirms[0].store
            && JSON.stringify(confirms[1].body.productOrderIds) === '["2000000000001"]' && confirms[1].store === 'biz', confirms);
        const q = n.W.calls.filter(c => /query$/.test(c.path));
        ok('④상세조회도 B1 은 biz 열쇠', q.some(c => c.store === 'biz' && c.body.productOrderIds.includes('2000000000001')) && q.every(c => !(c.body.productOrderIds.includes('2000000000001') && c.store !== 'biz')));
        ok('④체크포인트 따로', !!n.W.cfg.kakao_notify_checkpoint && !!n.W.cfg.kakao_notify_checkpoint_biz);
        const g = await n.F.collectLmsGuide();
        ok('④발송안내 = 직영몰 B3 상세조회 biz', /직영몰 발송 안내 실발송 처리 1건/.test(g) && n.W.calls.some(c => /query$/.test(c.path) && c.store === 'biz' && c.body.productOrderIds.includes('2000000000003')), g);
        const gm = n.W.guideMeta.find(x => x[0] === '2000000000003'), gmM = n.W.guideMeta.find(x => x[0] === '1000000000003');
        ok('④구매 단추 번호 = 직영몰은 비움 · 스마트스토어는 그대로', gm && gm[1].pno === '' && gmM && gmM[1].pno === '6400134206');
    }
    // ⑤ 송장 등록(dispatch) · 발주확인 묶음이 섞여 와도 판매처마다 따로
    {
        const n = newLoad(ON);
        await n.F._naverFetchInvoiceOrdersCore(1);   // B1 등록
        n.W.calls.length = 0;
        const body = { dispatchProductOrders: ['1000000000001', '2000000000001', '1000000000002'].map(id => ({ productOrderId: id, deliveryMethod: 'DELIVERY', deliveryCompanyCode: 'CJGLS', trackingNumber: '1', dispatchDate: 'x' })) };
        const r = await n.F.naverCallWithRetry({ method: 'POST', path: '/external/v1/pay-order/seller/product-orders/dispatch', body });
        const d = n.W.calls;
        ok('⑤섞인 송장 등록 = 2번(M1·M2 store 없음 / B1 biz)', d.length === 2 && !d[0].store && JSON.stringify(d[0].body.dispatchProductOrders.map(x => x.productOrderId)) === '["1000000000001","1000000000002"]'
            && d[1].store === 'biz' && JSON.stringify(d[1].body.dispatchProductOrders.map(x => x.productOrderId)) === '["2000000000001"]', d);
        ok('⑤응답 합침 = 세 번호 다 성공 목록', JSON.stringify(r.data.successProductOrderIds) === '["1000000000001","1000000000002","2000000000001"]', r);
        n.W.calls.length = 0;
        const cr = await n.F.naverConfirmOrders(['2000000000001', '1000000000002']);
        ok('⑤발주확인 섞임 = 판매처마다 · 결과 둘 다 성공', n.W.calls.length === 2 && n.W.calls[1].store === 'biz' && cr.success.sort().join() === '1000000000002,2000000000001' && cr.fail.length === 0, { calls: n.W.calls, cr });
        n.W.calls.length = 0;
        const r2 = await n.F.naverCallWithRetry({ method: 'POST', path: '/external/v1/pay-order/seller/product-orders/dispatch', body: { dispatchProductOrders: [{ productOrderId: '1000000000001' }] } });
        ok('⑤스마트스토어만 = 종전 그대로 1번 · store 없음', n.W.calls.length === 1 && !('store' in n.W.calls[0]) && r2.data.successProductOrderIds[0] === '1000000000001');
        n.W.calls.length = 0;
        let err = null; try { await n.F.naverCallWithRetry({ method: 'POST', path: '/external/v1/pay-order/seller/product-orders/confirm', body: { productOrderIds: ['1000000000009'] }, store: 'biz' }); } catch (e) { err = e; }
        ok('⑤store biz 에 등록부 밖 번호 = 부르지 않고 오류', err && err.code === 'store_mismatch' && n.W.calls.length === 0);
    }
    // ⑥ 등록부에 직영몰 번호가 있는데 중계서버가 직영몰 열쇠 없음 = 직영몰 몫은 안 부름 · 스마트스토어 몫은 감
    {
        const n = newLoad({ bizKeys: false, cfg: { naver_biz_order_ids: { '2000000000001': '2026-11-19' } } });
        const r = await n.F.naverCallWithRetry({ method: 'POST', path: '/external/v1/pay-order/seller/product-orders/dispatch', body: { dispatchProductOrders: [{ productOrderId: '1000000000001' }, { productOrderId: '2000000000001' }] } });
        const fl = (r.data.failProductOrderInfos || []);
        ok('⑥직영몰 열쇠 없음 = 스마트스토어만 부름 · B1 은 실패 목록(store_not_ready · 다시 보낼 수 있음)', n.W.calls.length === 1 && !n.W.calls[0].store && JSON.stringify(r.data.successProductOrderIds) === '["1000000000001"]'
            && fl.length === 1 && fl[0].productOrderId === '2000000000001' && fl[0].code === 'store_not_ready', { calls: n.W.calls, r });
        n.W.calls.length = 0;
        let err = null; try { await n.F.naverCallWithRetry({ method: 'POST', path: '/external/v1/pay-order/seller/product-orders/confirm', body: { productOrderIds: ['2000000000001'] } }); } catch (e) { err = e; }
        ok('⑥직영몰 번호만 = 호출 0 · store_not_ready · status 409', err && err.code === 'store_not_ready' && err.status === 409 && n.W.calls.length === 0);
        let err2 = null; try { await n.F.naverCallWithRetry({ method: 'POST', path: '/external/v1/pay-order/seller/product-orders/confirm', body: { productOrderIds: ['1000000000009'] }, store: 'biz' }); } catch (e) { err2 = e; }
        ok('⑥store_mismatch 도 status 409', err2 && err2.code === 'store_mismatch' && err2.status === 409);
        const q = await n.F.naverCallWithRetry({ method: 'POST', path: '/external/v1/pay-order/seller/product-orders/query', body: { productOrderIds: ['1000000000001', '2000000000001'] } });
        ok('⑥읽기(query) 섞임 + 직영몰 못 부름 = 스마트스토어 줄만(실패 목록 없음)', Array.isArray(q.data) && q.data.length === 1 && q.data[0].productOrder.productOrderId === '1000000000001', q);
    }
    // ⑦ 섞인 송장 등록에서 한쪽 실패 = 4xx 는 실패 목록(다시 보낼 수 있음) · 5xx 는 응답에 없음(모름) · 둘 다 5xx = 던짐
    const REG = { cfg: { naver_biz_order_ids: { '2000000000001': '2026-11-19' } } };
    const MIX = { method: 'POST', path: '/external/v1/pay-order/seller/product-orders/dispatch', body: { dispatchProductOrders: [{ productOrderId: '1000000000001' }, { productOrderId: '2000000000001' }] } };
    {
        const n = newLoad(Object.assign({ bizThrow: 400 }, REG));
        const r = await n.F.naverCallWithRetry(MIX); const fl = r.data.failProductOrderInfos || [];
        ok('⑦직영몰 400 = M1 성공 · B1 실패 목록(code 400)', JSON.stringify(r.data.successProductOrderIds) === '["1000000000001"]' && fl.length === 1 && fl[0].productOrderId === '2000000000001' && fl[0].code === '400', r);
    }
    {
        const n = newLoad(Object.assign({ bizThrow: 500 }, REG));
        const r = await n.F.naverCallWithRetry(MIX);
        ok('⑦직영몰 500 = M1 성공 · B1 은 어디에도 없음(모름)', JSON.stringify(r.data.successProductOrderIds) === '["1000000000001"]' && !(r.data.failProductOrderInfos || []).some(f => f.productOrderId === '2000000000001'), r);
    }
    {
        const n = newLoad(Object.assign({ bizThrow: 500, mainThrow: 400 }, REG));
        const r = await n.F.naverCallWithRetry(MIX); const fl = r.data.failProductOrderInfos || [];
        ok('⑦스마트스토어 400 + 직영몰 500 = M1 실패 목록 · B1 없음(모름) · 안 던짐', fl.length === 1 && fl[0].productOrderId === '1000000000001' && !(r.data.successProductOrderIds || []).length, r);
    }
    {
        const n = newLoad(Object.assign({ bizThrow: 503, mainThrow: 502 }, REG));
        let err = null; try { await n.F.naverCallWithRetry(MIX); } catch (e) { err = e; }
        ok('⑦양쪽 다 5xx = 던짐(전부 모름 · 종전 꼴)', err && err.status === 502);
    }
    // ⑧ 직영몰 실패 알림 = 30분에 1통(수집 두 번 · 주문안내 한 번 = 1통) · 스마트스토어 실패 알림은 종전대로
    {
        const n = newLoad(Object.assign({ bizThrow: 500 }, ON));
        await n.F._naverFetchInvoiceOrdersCore(1); await n.F._naverFetchInvoiceOrdersCore(1); await n.F.collectKakaoNotify();
        ok('⑧직영몰 실패 3번 = 텔레그램 1통', n.W.tg.filter(t => /직영몰/.test(t)).length === 1, n.W.tg);
        ok('⑧스마트스토어 쪽 알림 0(실패 없음)', n.W.tg.filter(t => !/직영몰/.test(t)).length === 0, n.W.tg);
    }
    // ⑨ 수동 재발송 길(lms-guide/:orderKey/send)도 등록부 직영몰 번호면 구매 단추 번호 비움(라우트라 글자로 확인)
    {
        const i = NEW_SRC.indexOf("app.post('/api/agent-office/lms-guide/:orderKey/send'"), j = NEW_SRC.indexOf('\n});', i);
        const seg = i > 0 && j > i ? NEW_SRC.slice(i, j) : '';
        ok('⑨수동 재발송 guideLogMeta pno = 등록부 직영몰이면 비움', /pno: \(await naverBizIdsMap\(\)\)\.has\(String\(orderKey\)\) \? '' : \(po\.productId \|\| po\.originalProductId \|\| ''\)/.test(seg));
    }
    console.log(`\n#1197-B server.js 검증: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('검증 스크립트 오류:', e); process.exit(2); });
