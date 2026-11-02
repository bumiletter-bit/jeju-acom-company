// #965 자동 송장 입력삭제 운송장 = 구매자(K) 기준 — matchShipments 실코드 · 실DB·서버·채널 0 · 번호·이름 전부 가짜 · 실행: node scripts/verify-965-buyer.js
'use strict';
const path = require('path'), ROOT = path.join(__dirname, '..');
const ia = require(path.join(ROOT, 'invoice-auto.js'));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 700))); };
const K = '01012340535', HB = '01099990535', OPT = '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)', OPT2 = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', OPT3 = '과수 및 크기: 제주 그린레몬5kg(중소과)';
const nv = (pid, buyer, opt, nm, tel, ad, q) => ({ _pid: pid, '수취인명': nm || '주문받는' + pid, '수취인연락처1': tel || '010-7000-' + String(pid).slice(-4), '통합배송지': ad || '서울 가짜구 주문로 ' + pid, '구매자연락처': buyer, '옵션정보': opt || OPT, '수량': q || 1 });
const orders = rows => ia.normOrders('naver', rows);
const ship = (tr, nm, tel, stel, ad, op, sn) => ({ tr: '6012036' + String(tr).padStart(5, '0'), nm, tel, ad: ad || '충남 가짜시 받는로 ' + tr, op: op || OPT, q: 1, sn: sn || '가족 드림', stel });
const run = (rows, sh, ind, memo) => ia.matchShipments({ ships: ia.normShips(sh, '효돈'), orders: orders(rows), pricingNames: [], indivKeys: ind, holdKeys: [], memoAddr: memo });
const summary = m => ({ a: m.assign.map(a => [a.o.order_key, a.rule, a.ships.map(s => s.tracking.slice(-3))]).sort(), ex: m.extra.map(s => s.tracking.slice(-3)).sort(), um: m.unmatched.map(s => s.tracking.slice(-3)).sort(), td: m.todos.map(t => t.rule) });
const addr = (nm, tel, k, extra) => Object.assign({ name: nm, tel, k, block: false }, extra || {});

console.log('① 11/2 재현 = 본인 번호 2 + 남편 번호 1');
{ const O = [nv(1, K)], S = [ship(1, '이하정', '010-1111-0001', K), ship(2, '최수아', '010-1111-0002', K), ship(3, '변가주', '010-1111-0003', HB)], M = [addr('이하정', '010-1111-0001', K), addr('최수아', '010-1111-0002', K), addr('변가주', '010-1111-0003', K)], ind = ['naver:1'];
  const b = summary(run(O, S, ind, [])), a = summary(run(O, S, ind, M));
  ok(b.um.join() === '003' && b.ex.length === 1, '종전 = 남편 번호 줄 unmatched', b);
  ok(a.um.length === 0 && a.ex.join() === a.ex.join() && a.ex.length === 2 && a.td.length === 0 && JSON.stringify(a.a) === JSON.stringify(b.a), '지금 = extra · 붙은 운송장 같음', a); }
console.log('② 주소 줄 전부 남편 번호 = 운송장 1장 붙음 · 할 일 없음');
{ const O = [nv(1, K)], S = [ship(1, '이하정', '010-1111-0001', HB), ship(2, '최수아', '010-1111-0002', HB)], M = [addr('이하정', '010-1111-0001', K), addr('최수아', '010-1111-0002', K)];
  const b = summary(run(O, S, ['naver:1'], [])), a = summary(run(O, S, ['naver:1'], M));
  ok(b.td.join() === 'todo_indiv_none' && b.um.length === 2, '종전 = 할 일 카드 + unmatched', b);
  ok(a.td.length === 0 && a.a.length === 1 && a.a[0][1] === 'indiv_any' && a.ex.length === 1 && a.um.length === 0, '지금 = indiv_any 1장 · 나머지 extra', a); }
console.log('③ 안전: 같은 받는 분 다른 구매자 2명 · 현금 줄 · 서비스 줄 · 다른 구매자 K');
{ const O = [nv(1, K)], S = [ship(1, '이하정', '010-1111-0001', HB)];
  let a = run(O, S, ['naver:1'], [addr('이하정', '010-1111-0001', K), addr('이하정', '010-1111-0001', '01055550000')]); let s = summary(a);
  ok(s.um.length === 1 && s.a.length === 0 && /구매자 여럿/.test(ia.unmatchedWhy(a.unmatched[0])), '구매자 둘 = 안 묶음 · 이유', { s, why: ia.unmatchedWhy(a.unmatched[0]) });
  a = run(O, S, ['naver:1'], [addr('이하정', '010-1111-0001', K), { name: '이하정', tel: '010-1111-0001', k: K, block: true }]); s = summary(a);
  ok(s.um.length === 1 && s.a.length === 0 && /현금·서비스/.test(ia.unmatchedWhy(a.unmatched[0])), '현금·서비스 줄과 같은 받는 분 = 안 묶음 · 이유', { s });
  s = summary(run(O, S, ['naver:1'], [addr('다른이름', '010-1111-0001', K)])); ok(s.um.length === 1 && s.a.length === 0, '번호만 같고 이름 다름 = 안 묶음', s);
  s = summary(run(O, S, ['naver:1'], [addr('이하정', '010-1111-0009', K)])); ok(s.um.length === 1, '이름만 같고 번호 다름 = 안 묶음', s);
  s = summary(run([nv(1, K), nv(2, '01055550000')], S, ['naver:1'], [addr('이하정', '010-1111-0001', '01055550000')])); ok(s.um.length === 1, '메모함 K 가 입력삭제 주문 구매자 아님 = 안 묶음', s);
}
console.log('③-b 🔴 다른 사람 주문의 운송장을 안 뺏음(워커3 재현)');
{ const X = '01055550000', Y = '01066660000';
  let O = [nv(1, K), nv(2, X, OPT, '부모님', '010-1111-0001', '서울 주문주소 1')], Sh = [ship(1, '부모님', '010-1111-0001', X, '서울 주문주소 1번지 고친꼴')], M = [addr('부모님', '010-1111-0001', K)];
  let m = run(O, Sh, ['naver:1'], M), s = summary(m), b = summary(run(O, Sh, ['naver:1'], []));
  ok(JSON.stringify(s) === JSON.stringify(b) && !s.a.some(x => x[0] === '1'), 'A X 주문 운송장(보내는 분 X · X 그날 주문 있음) = K 로 안 옮김 · 종전과 같음', { s, b });
  Sh = [ship(1, '부모님', '010-1111-0001', X, '서울 주문주소 1번지 고친꼴'), ship(2, '부모님', '010-1111-0001', K, '서울 메모주소 2')];
  m = run(O, Sh, ['naver:1'], M); s = summary(m); ok(s.a.some(x => x[0] === '1' && x[2].join() === '002'), 'A2 K 주문 = K 번호 운송장 · X 운송장 안 집음', s);
  O = [nv(1, K), nv(2, Y)]; Sh = [ship(1, '부모님', '010-1111-0001', K)];
  s = summary(run(O, Sh, ['naver:1', 'naver:2'], [addr('부모님', '010-1111-0001', Y)])); ok(s.a.some(x => x[0] === '1') && !s.a.some(x => x[0] === '2'), 'B K 번호로 나간 운송장 = Y 메모 줄로 안 옮김', s);
  const xm = run([nv(1, K), nv(2, X, OPT2, '다른', '010-2', '다른 주소')], [ship(9, '부모님', '010-1111-0001', X)], ['naver:1'], [addr('부모님', '010-1111-0001', K)]);
  ok(xm.unmatched.length === 1 && /그날 다른 주문의 구매자/.test(ia.unmatchedWhy(xm.unmatched[0])), '안 묶인 줄 = 이유 글로 드러남', ia.unmatchedWhy(xm.unmatched[0]));
  const hold = ia.matchShipments({ ships: ia.normShips([ship(9, '부모님', '010-1111-0001', X)], '효돈'), orders: orders([nv(1, K), nv(2, X, OPT, '다른', '010-2', '다른 주소')]), pricingNames: [], indivKeys: ['naver:1'], holdKeys: ['naver:2'], memoAddr: [addr('부모님', '010-1111-0001', K)] });
  ok(!hold.assign.some(x => x.o.order_key === '1'), '보류 주문 구매자도 다른 사람으로 셈', summary(hold));
}
console.log('③-c 🔴 종전에 쓰던 B=K 운송장이 표식 없는 주문으로 안 넘어감(워커3 재현)');
{ const O = [nv(1, K), nv(2, K)], M = [addr('남편줄', '010-1111-0001', K), addr('본인줄', '010-1111-0002', K)];
  let S = [ship(1, '남편줄', '010-1111-0001', HB), ship(2, '본인줄', '010-1111-0002', K)];
  let b = summary(run(O, S, ['naver:1'], undefined)), a = summary(run(O, S, ['naver:1'], M));
  ok(b.a.length === 1 && b.a[0][0] === '1' && b.a[0][2].join() === '002', '종전 = 주문 1 002 · 주문 2 없음', b);
  ok(a.a.length === 1 && a.a[0][0] === '1' && a.a[0][2].join() === '002' && !a.a.some(x => x[0] === '2'), '지금도 = 주문 1 002 · 주문 2 없음', a);
  S = [ship(1, '남편줄', '010-1111-0001', HB, '서울 가짜구 주문로 1'), ship(2, '본인줄', '010-1111-0002', K)];
  a = summary(run(O, S, ['naver:1'], M)); ok(a.a.length === 1 && a.a[0][0] === '1' && a.a[0][2].join() === '002', '주소 같은 B≠K 줄이 있어도 B=K 줄 먼저 · 주문 2 없음', a);
  S = [ship(1, '남편줄', '010-1111-0001', HB, '서울 가짜구 주문로 1'), ship(2, '남편줄2', '010-1111-0003', HB)];
  a = summary(run([nv(1, K)], S, ['naver:1'], [addr('남편줄', '010-1111-0001', K), addr('남편줄2', '010-1111-0003', K)])); ok(a.a[0][1] === 'indiv_store_addr' && a.a[0][2].join() === '001', '전부 B≠K = 주문 주소 같은 줄 먼저(indiv_store_addr)', a);
}
console.log('③-d #970 일반발송으로 뺀 쿠팡 주문 = 일반 짝');
{ const cp = ia.normOrders('coupang', [{ _shipmentBoxId: 'B1', _orderId: '3100000001', _vendorItemId: 'V1', '수취인이름': '쿠팡받는', '수취인전화번호': '0507-1111-0001', '수취인 주소': '서울 가짜구 쿠팡로 1', '구매자전화번호': K, '등록옵션명': OPT, '구매수(수량)': 1 }]), nvO = orders([nv(2, K)]), S = ia.normShips([ship(1, '쿠팡받는', '0507-1111-0001', K, '서울 가짜구 쿠팡로 1'), ship(2, '이하정', '010-1111-0001', HB)], '효돈');
  const m = ia.matchShipments({ ships: S, orders: cp.concat(nvO), pricingNames: [], indivKeys: ['naver:2'], holdKeys: [], memoAddr: [addr('이하정', '010-1111-0001', K)] }), a = m.assign.map(x => [x.o.channel, x.rule, x.ships.map(s => s.tracking.slice(-3)).join()]);
  ok(a.some(x => x[0] === 'coupang' && x[1] === 'auto' && x[2] === '001') && a.some(x => x[0] === 'naver' && /^indiv/.test(x[1]) && x[2] === '002'), '쿠팡 주문 = 이름+번호+주소 일반 짝 · 입력삭제 주문은 주소 줄', a); }
console.log('④ IND 없는 날 · 메모함 없음 = 종전 바이트 동일');
{ const O = [nv(1, K), nv(2, K, OPT2)], S = [ship(1, '이하정', '010-1111-0001', K), ship(2, '최수아', '010-1111-0002', HB)], M = [addr('이하정', '010-1111-0001', K), addr('최수아', '010-1111-0002', K)];
  ok(JSON.stringify(summary(run(O, S, [], M))) === JSON.stringify(summary(run(O, S, [], undefined))), 'IND 없음 = 메모함 있어도 같음');
  ok(JSON.stringify(summary(run(O, S, ['naver:1'], undefined))) === JSON.stringify(summary(run(O, S, ['naver:1'], []))), 'memoAddr 없음 = 빈 목록과 같음'); }
console.log('⑤ IND 밖 같은 구매자 주문 = 메모함 줄로 안 붙음(종전 길)');
{ const O = [nv(1, K), nv(2, K)], S = [ship(1, '이하정', '010-1111-0001', HB)], M = [addr('이하정', '010-1111-0001', K)];
  const s = summary(run(O, S, ['naver:1'], M)); ok(s.a.length === 1 && s.a[0][0] === '1', 'IND 주문에만', s); }
console.log('⑥ 일반 주문 짝 무변경(받는 분이 메모함과 같아도 이름+번호+주소 짝 우선)');
{ const O = [nv(1, K), nv(5, '01077770005', OPT, '일반손님', '010-2222-0005', '서울 가짜구 일반로 5')], S = [ship(5, '일반손님', '010-2222-0005', '01077770005', '서울 가짜구 일반로 5')], M = [addr('일반손님', '010-2222-0005', K)];
  const s = summary(run(O, S, ['naver:1'], M)); ok(s.a.some(x => x[0] === '5' && x[1] === 'auto') && !s.a.some(x => x[0] === '1'), '일반 주문 그대로', s); }
console.log('⑦ 명절 꼴 = K 120줄 같은 번호 · 받는 분 줄마다 다름 · 주문 2건 3품목');
for (const [lb, bOf] of [['B 전부 다름', i => (i % 2 ? '01088880001' : '01088880002')], ['B 일부만 다름', i => (i % 3 ? K : '01088880001')]]) {
  const OPTS = [OPT, OPT2, OPT3], O = [nv(1, K, OPT), nv(2, K, OPT2)], S = [], M = [];
  for (let i = 0; i < 120; i++) { const nm = '받는' + i, tel = '010-3333-' + String(1000 + i); S.push(ship(i + 1, nm, tel, bOf(i), '부산 가짜구 명절로 ' + i, OPTS[i % 3])); M.push(addr(nm, tel, K)); }
  const t0 = Date.now(), m = run(O, S, ['naver:1', 'naver:2'], M), s = summary(m), ms = Date.now() - t0, tr = s.a.flatMap(x => x[2]);
  ok(s.a.length === 2 && new Set(tr).size === 2 && s.ex.length === 118 && s.um.length === 0 && s.td.length === 0, lb + ': 주문마다 서로 다른 1장 · 나머지 118 extra · unmatched 0 · 카드 0', { a: s.a, ex: s.ex.length, um: s.um.length, td: s.td });
  ok(ms < 500, lb + `: 계산 ${ms}ms`, ms);
}
{ const S = [], M = [], OPTS = [OPT, OPT2, OPT3], O = [nv(1, K, OPT), nv(2, K, OPT2)]; for (let i = 0; i < 120; i++) { const nm = '받는' + i, tel = '010-3333-' + String(1000 + i); S.push(ship(i + 1, nm, tel, '01088880001', '부산 가짜구 명절로 ' + i, OPTS[i % 3])); M.push(addr(nm, tel, i === 7 ? '01055550000' : K)); }
  const s = summary(run(O, S, ['naver:1', 'naver:2'], M)); ok(s.um.length === 1 && s.ex.length === 117, '안전: 그중 한 받는 분이 다른 K = 그 줄만 unmatched', { um: s.um, ex: s.ex.length }); }
console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
