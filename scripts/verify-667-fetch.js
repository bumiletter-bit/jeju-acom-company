// 실행: node scripts/verify-667-fetch.js   (네트워크·DB·포트 0 · 옛 코드 = git HEAD 의 server.js — 커밋 뒤에는 ①③의 「옛·새 동일」이 새·새 비교가 되므로 커밋 전에 돌릴 것)
// #667 검증 — server.js 의 두 함수를 옛(HEAD)·새(디스크)에서 그대로 떼어 가짜 응답으로 돌려 견준다(네트워크·DB 0)
const fs = require('fs'), path = require('path'), cp = require('child_process'); const ROOT = process.argv[2] || path.join(__dirname, '..');
const NEW = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const OLD = cp.execSync('git show HEAD:server.js', { cwd: ROOT, maxBuffer: 1 << 28 }).toString('utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  ok   ' : '  FAIL ') + m + (c || x == null ? '' : ' :: ' + String(x).slice(0, 300))); };
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('구간 없음 ' + a); return src.slice(i, j); };
const CORE = s => s === NEW;   // #667-b: 새 코드는 본문이 _…Core 로 옮겨감(바깥 이름은 세기만 하는 껍데기)
const NAV = s => (CORE(s) ? cut(s, 'async function _naverFetchInvoiceOrdersCore(', '\n// 진단 샘플용 개인정보 마스킹').replace('_naverFetchInvoiceOrdersCore(', 'naverFetchInvoiceOrders(') : cut(s, 'async function naverFetchInvoiceOrders(', '\n// 진단 샘플용 개인정보 마스킹')) + cut(s, 'function naverMaskPII(', '\n// 대표 7/26: 송장변환 조회 4종');
const CPG = s => CORE(s) ? cut(s, 'async function _coupangFetchInvoiceOrdersCore(', "\napp.get('/api/agent-office/coupang/invoice-orders'").replace('_coupangFetchInvoiceOrdersCore(', 'coupangFetchInvoiceOrders(') : cut(s, 'async function coupangFetchInvoiceOrders(', "\napp.get('/api/agent-office/coupang/invoice-orders'");

// ── 가짜 네이버: 날(0·1)·발주 상태·쪽에 따라 응답. OK 0일차는 300건 만재 + 2쪽 5건(쪽 넘김 확인)
const mk = (pid, place, extra) => ({ content: { order: { orderId: 'O' + pid, ordererName: '구매' + pid, ordererTel: '0101111' + String(pid).padStart(4, '0'), paymentDate: '2026-10-12T08:00:00.0+09:00', ordererId: 'u' + pid }, productOrder: Object.assign({ productOrderId: String(pid), productOption: '옵션 ' + pid, productName: '상품', quantity: 2, shippingMemo: '메모' + pid, productOrderStatus: 'PAYED', placeOrderStatus: place, productId: 'P1', shippingAddress: { name: '수취' + pid, tel1: '0102222' + String(pid).padStart(4, '0'), baseAddress: '제주시', detailedAddress: pid + '호' } }, extra || {}) } });
function naverFake() {
    const calls = []; let t0 = Date.now();
    return { calls, callNaver: async (req) => {
        const q = req.query, day = Math.round((Date.now() - Date.parse(q.to)) / 86400000); calls.push({ day, place: q.placeOrderStatusType, page: q.page, st: q.productOrderStatuses, range: q.rangeType, size: q.pageSize, path: req.path, m: req.method, gap: Date.now() - t0 }); t0 = Date.now();
        let list = [];
        if (q.placeOrderStatusType === 'OK' && day === 0 && q.page === 1) list = Array.from({ length: 300 }, (_, i) => mk(1000 + i, 'OK', i === 3 ? { remainQuantity: 1 } : i === 4 ? { remainQuantity: 0 } : {}));
        else if (q.placeOrderStatusType === 'OK' && day === 0 && q.page === 2) list = Array.from({ length: 5 }, (_, i) => mk(2000 + i, 'OK'));
        else if (q.placeOrderStatusType === 'OK' && day === 1) list = [mk(3000, 'OK'), mk(1000, 'OK')];   // 1000 = 날 경계 중복
        else if (q.placeOrderStatusType === 'NOT_YET' && day === 0) list = [mk(5000, 'NOT_YET'), mk(5001, undefined), mk(2000, 'OK')];   // 5001 = 응답에 칸 없음 · 2000 = 사이에 발주확인된 중복
        else if (q.placeOrderStatusType === 'NOT_YET' && day === 1) list = [mk(5002, 'NOT_YET', { remainQuantity: 0 })];
        return { data: { contents: list, totalElements: list.length } };
    } };
}
const runNav = async (src, days, opts) => { const fk = naverFake(); const fn = new Function('naverRelay', 'notifyTelegram', 'setTimeout', NAV(src) + '\nreturn naverFetchInvoiceOrders;')(fk, async () => { }, (f, ms) => setTimeout(f, 1)); const r = opts === undefined ? await fn(days) : await fn(days, opts); return { r, calls: fk.calls }; };
const sig = c => c.map(x => [x.day, x.place, x.page, x.st, x.range, x.size, x.path, x.m].join('/')).join(' > ');

// ── 가짜 쿠팡
const sheet = (box, st, items) => ({ shipmentBoxId: box, orderId: 'CO' + box, status: st, paidAt: '2026-10-12T08:00:00', orderer: { name: '구매' + box, safeNumber: '0503' + box }, receiver: { name: '수취' + box, safeNumber: '0504' + box, addr1: '서울', addr2: box + '동' }, parcelPrintMessage: '문앞', orderItems: items });
function coupangFake() {
    const calls = [];
    return { calls, call: async (req) => {
        const q = req.query; calls.push([q.status, q.nextToken || '', q.maxPerPage, q.createdAtFrom, q.createdAtTo, req.path, req.method].join('/'));
        if (q.status === 'INSTRUCT' && !q.nextToken) return { data: [sheet(11, 'INSTRUCT', [{ vendorItemId: 'v1', vendorItemName: '귤 3kg', sellerProductName: '귤', shippingCount: 2, cancelCount: 1 }, { vendorItemId: 'v2', vendorItemName: '귤 5kg', sellerProductName: '귤', shippingCount: 1, holdCountForCancel: 1 }])], nextToken: 'N2' };
        if (q.status === 'INSTRUCT' && q.nextToken === 'N2') return { data: [sheet(12, 'INSTRUCT', [{ vendorItemId: 'v1', vendorItemName: '귤 3kg', sellerProductName: '귤', shippingCount: 1 }])] };
        if (q.status === 'ACCEPT') return { data: [sheet(21, 'ACCEPT', [{ vendorItemId: 'v3', vendorItemName: '황금향', sellerProductName: '황금향', shippingCount: 3 }]), sheet(12, 'INSTRUCT', [{ vendorItemId: 'v1', vendorItemName: '귤 3kg', sellerProductName: '귤', shippingCount: 1 }]), sheet(22, undefined, [{ vendorItemId: 'v4', vendorItemName: '한라봉', sellerProductName: '한라봉', shippingCount: 1 }])] };
        return { data: [] };
    } };
}
const runCpg = async (src, days, opts) => { const fk = coupangFake(); const fn = new Function('coupangCallWithRetry', 'COUPANG_ORDERSHEETS_PATH', 'naverMaskPII', 'setTimeout', CPG(src) + '\nreturn coupangFetchInvoiceOrders;')(fk.call, '/v5/ordersheets', x => x, (f, ms) => setTimeout(f, 1)); const r = opts === undefined ? await fn(days) : await fn(days, opts); return { r, calls: fk.calls }; };

(async () => {
    console.log('① 네이버 — 종전 호출은 옛 코드와 요청·결과가 같다');
    for (const [nm, o] of [['미지정', undefined], ['extended', { extended: true }], ['빈 객체', {}]]) {
        const a = await runNav(OLD, 2, o), b = await runNav(NEW, 2, o);
        ok(sig(a.calls) === sig(b.calls) && a.calls.length === 3, `${nm}: 요청 순서·인자 동일(3번 · 전부 OK)`, sig(b.calls));
        ok(JSON.stringify(a.r) === JSON.stringify(b.r) && b.r.rows.length === 305, `${nm}: 결과 글자 그대로 동일(행 ${b.r.rows.length} · fetched ${b.r.fetched} · 부분취소 ${b.r.partialAdjusted})`);
        ok(!/placeOrderStatus"|_place"/.test(JSON.stringify(b.r.rows)), `${nm}: 행에 발주 상태 칸 없음`);
    }
    { const a = await runNav(OLD, 2, { extended: true }), b = await runNav(NEW, 2, { extended: true, placeStatuses: [] }), c = await runNav(NEW, 2, { extended: true, placeStatuses: ['이상한값'] });
      ok(JSON.stringify(a.r) === JSON.stringify(b.r) && JSON.stringify(a.r) === JSON.stringify(c.r) && sig(c.calls) === sig(a.calls), '빈 배열·모르는 값만 주면 종전과 동일(OK 한 번)'); }
    console.log('② 네이버 — 옵션을 켜면 발주확인 전 주문 포함');
    { const base = await runNav(NEW, 2, { extended: true }), n = await runNav(NEW, 2, { extended: true, placeStatuses: ['OK', 'NOT_YET'] });
      ok(sig(n.calls) === '0/OK/1/PAYED/PAYED_DATETIME/300/' + n.calls[0].path + '/GET > 0/OK/2/PAYED/PAYED_DATETIME/300/' + n.calls[0].path + '/GET > 0/NOT_YET/1/PAYED/PAYED_DATETIME/300/' + n.calls[0].path + '/GET > 1/OK/1/PAYED/PAYED_DATETIME/300/' + n.calls[0].path + '/GET > 1/NOT_YET/1/PAYED/PAYED_DATETIME/300/' + n.calls[0].path + '/GET', '요청 = 날마다 OK(쪽 넘김 포함) → NOT_YET · 그 밖 인자 동일', sig(n.calls));
      const ids = n.r.rows.map(r => r._pid), add = ids.filter(i => !base.r.rows.some(r => r._pid === i));
      ok(add.join() === '5000,5001' && n.r.rows.length === base.r.rows.length + 2 && new Set(ids).size === ids.length, '더해진 행 = 발주 미확인 2건(5000·5001) · 사이에 발주확인된 중복(2000)·남은 수량 0(5002)은 안 겹침·안 들어감', add.join());
      const strip = r => { const o = JSON.parse(JSON.stringify(r)); delete o._x.placeOrderStatus; return JSON.stringify(o); };
      ok(base.r.rows.every((r, i) => JSON.stringify(r) === strip(n.r.rows.find(x => x._pid === r._pid))), '종전 행들은 발주 상태 칸 하나만 더해지고 나머지는 같음');
      const P = id => n.r.rows.find(r => r._pid === id)._x.placeOrderStatus;
      ok(P('1000') === 'OK' && P('5000') === 'NOT_YET' && P('5001') === 'NOT_YET' && P('2000') === 'OK', '_x.placeOrderStatus: 응답 값 · 응답에 없으면 조회에 쓴 값(5001 → NOT_YET)');
      ok(n.r.rows.every(r => !('_place' in r)) && n.r.sample && n.r.sample.content && !('__place' in n.r.sample) && n.r.rawKeys.join() === 'content', 'extended 면 _place 없음 · 진단 sample·rawKeys 는 원래 꼴');
      const p = await runNav(NEW, 1, { placeStatuses: ['NOT_YET', 'OK', 'NOT_YET', 'CANCEL'] });
      ok(sig(p.calls).split(' > ').map(s => s.split('/')[1]).join() === 'NOT_YET,OK,OK,CANCEL' && p.r.rows.find(r => r._pid === '5000')._place === 'NOT_YET' && !p.r.rows[0]._x, 'extended 아님: 행에 _place · 값 중복 제거 · 준 순서대로(쪽 넘김 포함)', sig(p.calls)); }
    console.log('③ 쿠팡 — 종전 호출 동일 · 옵션 켜면 결제완료 포함');
    { for (const [nm, o] of [['미지정', undefined], ['빈 객체', {}], ['모르는 값', { statuses: ['DEPARTURE'] }]]) { const a = await runCpg(OLD, 3), b = await runCpg(NEW, 3, o); ok(a.calls.join(' > ') === b.calls.join(' > ') && a.calls.length === 2 && JSON.stringify(a.r) === JSON.stringify(b.r) && b.r.rows.length === 2, `${nm}: 요청(INSTRUCT 2쪽)·결과 글자 그대로 동일(행 2 · 부분취소 ${b.r.partialAdjusted})`, b.calls.join(' > ')); }
      const base = await runCpg(NEW, 3), n = await runCpg(NEW, 3, { statuses: ['ACCEPT', 'INSTRUCT'] });
      ok(n.calls.map(s => s.split('/').slice(0, 2).join(':')).join() === 'ACCEPT:,INSTRUCT:,INSTRUCT:N2', '요청 = ACCEPT → INSTRUCT(다음 쪽 표식은 상태마다 새로)', n.calls.join(' > '));
      const key = r => r._shipmentBoxId + '|' + r._vendorItemId, ks = n.r.rows.map(key);
      ok(ks.slice().sort().join() === '11|v1,12|v1,21|v3,22|v4' && new Set(ks).size === ks.length, '행 = 상품준비중 2 + 결제완료 2 · 두 조회에 다 온 줄(12)은 한 번만', ks.join());
      const S = k => n.r.rows.find(r => key(r) === k)._status;
      ok(S('21|v3') === 'ACCEPT' && S('11|v1') === 'INSTRUCT' && S('12|v1') === 'INSTRUCT' && S('22|v4') === 'ACCEPT', '_status: 응답 값 · 없으면 조회에 쓴 값(22 → ACCEPT) · 사이에 발주확인된 줄은 응답 값(INSTRUCT)');
      const strip = r => { const o = Object.assign({}, r); delete o._status; return JSON.stringify(o); };
      ok(base.r.rows.every(r => JSON.stringify(r) === strip(n.r.rows.find(x => key(x) === key(r)))) && base.r.rows.every(r => !('_status' in r)), '종전 행은 _status 칸만 더해짐 · 미지정 결과에는 _status 없음'); }
    console.log('④ 켜는 곳은 문자 수집 한 줄뿐');
    { const uses = NEW.split('\n').filter(l => /naverFetchInvoiceOrders\(|coupangFetchInvoiceOrders\(/.test(l) && !/^async function/.test(l));
      const all = NEW.split('\n').filter(l => /placeStatuses: \[|[{ ]statuses: \[/.test(l) && !/^\s*\/\//.test(l));
      ok(uses.length === 5 && uses.every(l => !/placeStatuses|statuses:/.test(l)) && all.length === 1 && /fetchNaver: d => _naverFetchInvoiceOrdersCore\(d, \{ extended: true, placeStatuses: \['OK', 'NOT_YET'\] \}\), fetchCoupang: d => _coupangFetchInvoiceOrdersCore\(d, \{ statuses: \['ACCEPT', 'INSTRUCT'\] \}\)/.test(all[0]), `바깥 이름을 부르는 ${uses.length}줄은 옵션 없음(종전 그대로) · 옵션을 준 곳 1줄(sms 장착 줄 · Core 직행)`, all.length);
      // #667-b 조회 중 표식 — 껍데기 두 줄 + 본문 + 장착 줄의 ordersBusy 식을 그대로 떼어 돌린다
      const wrapN = NEW.split('\n').find(l => /^async function naverFetchInvoiceOrders\(days, opts\) \{ _ordersBusy\+\+;/.test(l)), wrapC = NEW.split('\n').find(l => /^async function coupangFetchInvoiceOrders\(days, opts\) \{ _ordersBusy\+\+;/.test(l));
      const busyExpr = (NEW.match(/\n\s*ordersBusy: (\(\) => _ordersBusy > 0),/) || [])[1];
      ok(!!wrapN && !!wrapC && !!busyExpr && /^let _ordersBusy = 0;$/m.test(NEW), '껍데기 2줄 · let _ordersBusy = 0 · 장착 줄 deps.ordersBusy 있음');
      if (wrapN && wrapC && busyExpr) {
          const seenBusy = []; let probe = () => false;
          const nav = { callNaver: async (req) => { seenBusy.push(probe()); if (req.query.page === 9) { const e = new Error('x'); e.status = 500; throw e; } return { data: { contents: [] } }; } };
          const cpgCall = async () => { seenBusy.push(probe()); return { data: [] }; };
          const core = s => cut(s, 'async function _naverFetchInvoiceOrdersCore(', '\n// 진단 샘플용 개인정보 마스킹') + cut(s, 'function naverMaskPII(', '\n// 대표 7/26: 송장변환 조회 4종') + cut(s, 'async function _coupangFetchInvoiceOrdersCore(', "\napp.get('/api/agent-office/coupang/invoice-orders'");
          const M = new Function('naverRelay', 'notifyTelegram', 'coupangCallWithRetry', 'COUPANG_ORDERSHEETS_PATH', 'setTimeout', 'let _ordersBusy = 0;\n' + wrapN + '\n' + wrapC + '\n' + core(NEW) + '\nreturn { nav: naverFetchInvoiceOrders, cpg: coupangFetchInvoiceOrders, navCore: _naverFetchInvoiceOrdersCore, cpgCore: _coupangFetchInvoiceOrdersCore, busy: ' + busyExpr + ' };')(nav, async () => { }, cpgCall, '/p', (f) => setTimeout(f, 1));
          probe = M.busy;
          const b0 = M.busy(); await M.nav(1); const n1 = seenBusy.splice(0); await M.cpg(1); const c1 = seenBusy.splice(0); const b1 = M.busy();
          ok(b0 === false && n1.length === 1 && n1[0] === true && c1.length === 1 && c1[0] === true && b1 === false, '바깥 이름으로 조회하는 동안 busy true(네이버·쿠팡) · 끝나면 false', JSON.stringify([b0, n1, c1, b1]));
          await M.navCore(1, { extended: true, placeStatuses: ['OK', 'NOT_YET'] }); const n2 = seenBusy.splice(0); await M.cpgCore(1, { statuses: ['ACCEPT', 'INSTRUCT'] }); const c2 = seenBusy.splice(0);
          ok(n2.length === 2 && n2.every(x => x === false) && c2.length === 2 && c2.every(x => x === false), '문자 수집 길(Core 직행)은 세지 않음 — 조회 중에도 busy false', JSON.stringify([n2, c2]));
          const p = Promise.all([M.nav(1), M.cpg(1)]); const mid = M.busy(); await p;
          const bad = { callNaver: async () => { const e = new Error('boom'); e.status = 500; throw e; } };
          const M2 = new Function('naverRelay', 'notifyTelegram', 'coupangCallWithRetry', 'COUPANG_ORDERSHEETS_PATH', 'setTimeout', 'let _ordersBusy = 0;\n' + wrapN + '\n' + wrapC + '\n' + core(NEW) + '\nreturn { nav: naverFetchInvoiceOrders, busy: ' + busyExpr + ' };')(bad, async () => { }, cpgCall, '/p', (f) => setTimeout(f, 1));
          let threw = false; try { await M2.nav(1); } catch (e) { threw = true; }
          ok(mid === true && M.busy() === false && threw && M2.busy() === false, '두 조회가 겹쳐도 다 끝나야 false · 조회가 실패(throw)해도 숫자가 남지 않음');
      }
      const d = cp.execSync('git diff --numstat HEAD -- server.js', { cwd: ROOT }).toString().trim(); console.log('     server.js diff: ' + d); }
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack); process.exit(1); });
