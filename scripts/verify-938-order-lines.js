// #938 검증 — 같은 구매자 2주문(A·B) 중 B 만 나중 발송 = 주문번호 키 줄 · 최종발주(core·v2 실코드) → 자동 송장(invoice-auto 실코드) 잇기
//   🔴 서버·실DB·채널 호출·브라우저 0 · 가짜 번호만 · v2 순수 함수는 docs/838/t838c 하네스와 같은 방법으로 떼어 씀
//   실행: node scripts/verify-938-order-lines.js
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'public/final-order-core.js')), ia = require(path.join(ROOT, 'invoice-auto.js'));
const v2 = fs.readFileSync(path.join(ROOT, 'public/invoice-v2.js'), 'utf8');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 500))); };
function grab(re) { const m = v2.match(re); if (!m) throw new Error('v2 못 찾음 ' + re); if (!m[0].startsWith('function')) return v2.slice(m.index, v2.indexOf('\n', m.index)); let depth = 0, started = false; for (let j = m.index; j < v2.length; j++) { const ch = v2[j]; if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; if (started && depth === 0) return v2.slice(m.index, j + 1); } throw new Error('끝 못 찾음'); }
const code = [/const PLACEHOLDER = /, /const isoOf = /, /const rawOf = /, /const telOf = /, /const idsOf = /, /const matchKey = /, /function parseDate\(s, today\)/, /const chOfText = /, /function parseLines\(txt, boxCh, today\)/, /function applyLines\(ctx, force = true\)/].map(grab).join('\n');
const V2 = new Function(code + '\nreturn { parseLines, applyLines };')();

const TY = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', HG = '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)';
const BUY = '010-2600-0001', HOME = '서울 가짜구 집로 1', PA = '2026110100000001', PB = '2026110100000002', PC = '2026110100000003';
const nvRaw = (pid, opt, q, addr, buy) => ({ _pid: pid, '구매자연락처': buy || BUY, '수취인명': '가구매', '수취인연락처1': buy || BUY, '통합배송지': addr || HOME, '옵션정보': '아꼼이네 상품선택: 1. (제철)' + opt, '수량': q });
// 최종발주 merged 꼴(필요한 칸만)
function final(orders, memo, shipDate, cashAoa, missExcl) {
    const CAL = { realToday: shipDate, shipDays: ['2026-11-02', '2026-11-03', '2026-11-04'], noShip: [], shipDate };
    const prep = core.prepLines(memo, CAL), lines = V2.parseLines(prep.v2Text, 'naver', shipDate);
    const merged = orders.map((r, i) => ({ ch: 'naver', i, conv: { '구매자연락처': r['구매자연락처'], '수취인명': r['수취인명'], '수량': r['수량'], '옵션정보': r['옵션정보'] }, memoFlag: null, userTouched: false, excluded: false }));
    const ctx = { today: shipDate, naver: { rows: orders }, coupang: [], cafe24: [], merged, allowIndiv: true, lines: { naver: [], cafe24: [], coupang: [] }, allLines: lines };
    lines.forEach(l => { if (!l.bad) ctx.lines[l.ch].push(l); });
    V2.applyLines(ctx, true);
    (missExcl || []).forEach(pid => { const i = orders.findIndex(r => r._pid === pid); if (i >= 0) merged[i].excluded = true; });   // 입력삭제 짝 없음 카드에서 「제외」(final-order _missExcl = individual 그대로 + excluded)
    const by = {}; merged.forEach((e, i) => { by[orders[i]._pid] = e.individual ? 'indiv' : e.excluded ? 'excl' : 'go'; });
    const chk = cashAoa ? core.cashCheck({ orders: merged.map((e, i) => ({ key: orders[i]._pid, digits: String(e.conv['구매자연락처']).replace(/\D/g, ''), qty: Number(e.conv['수량']), individual: !!e.individual, excluded: !!e.excluded, buyer: '가', opt: TY })), cash: core.parseCash(cashAoa) }) : null;
    return { by, chk, ind: merged.filter(e => e.individual && !e.excluded).map((e, i) => 'naver:' + orders[merged.indexOf(e)]._pid), hold: merged.filter(e => e.excluded).map(e => 'naver:' + orders[merged.indexOf(e)]._pid), lines };
}
const HEAD = core.HEADERS ? core.HEADERS.slice() : ['보내는사람', '보내는사람연락처', '출고지', '수취인명', '옵션정보', '수량', '수취인연락처1', '수취인연락처2', '배송지', '배송메세지', '구매자연락처', '', ''];
const row = (recv, addr, opt, q, K) => ['가구매 드림', K || BUY, '제주시 연삼로 1', recv, opt, String(q), '010-3300-0001', '', addr, '', K || BUY, '', ''];
let t = 681000900000; const sh = (nm, ad, op, tel, st) => ({ tr: String(++t), nm, tel: tel || '010-3300-' + String(t % 10000).padStart(4, '0'), ad, op, q: 1, sn: '가구매 드림', stel: st || BUY });
const match = (orders, ships, F) => { const os = ia.normOrders('naver', orders); const m = ia.matchShipments({ ships: ia.normShips(ships), orders: os, pricingNames: [TY, HG], indivKeys: F.ind, holdKeys: F.hold }); const card = ia.buildCard(m, os); return { card, r: Object.fromEntries(card.rows.map(x => [x.order_key, x.rule])) }; };
const L = (date, key, note) => [date, key, note, '네이버'].join('\t');

console.log('① 주문번호 입력삭제 줄(날짜 없음) = 그 주문만 입력삭제');
{ const o = [nvRaw(PA, TY, 2), nvRaw(PB, TY, 1)], F = final(o, L('', PA, '입력o삭제x'), '2026-11-02');
  ok(F.by[PA] === 'indiv' && F.by[PB] === 'go', 'A 입력삭제 · B 그대로(양식)', F.by); ok(F.ind.join() === 'naver:' + PA, 'IND = A 만', F.ind); }
{ const o = [nvRaw(PA, TY, 2), nvRaw(PB, TY, 1)], F = final(o, L('', BUY, '입력o삭제x') + '\n' + L('11/4', PB, '입력o삭제x'), '2026-11-02');
  console.log('  ℹ️  전화번호 입력삭제 줄 + B 주문번호 뒤 날짜 줄 =', JSON.stringify(F.by)); ok(F.by[PB] === 'indiv', '섞이면 오늘 줄이 이김 = B 도 오늘 입력삭제(규칙 rank · 메모함은 전화번호 줄과 섞지 말 것)', F.by); }

console.log('② 주문번호 입력삭제 + 날짜(11/4) = 그날까지 그 주문만 빠짐');
{ const o = [nvRaw(PA, TY, 2), nvRaw(PB, TY, 1)], memo = L('', PA, '입력o삭제x') + '\n' + L('11/4', PB, '입력o삭제x');
  const F2 = final(o, memo, '2026-11-02'), F3 = final(o, memo, '2026-11-03'), F4 = final([o[1]], L('11/4', PB, '입력o삭제x'), '2026-11-04');
  ok(F2.by[PA] === 'indiv' && F2.by[PB] === 'excl', '11/2 = A 입력삭제 · B 오늘 안 나감', F2.by); ok(F3.by[PB] === 'excl', '11/3 = B 오늘 안 나감', F3.by); ok(F4.by[PB] === 'indiv', '11/4 = B 입력삭제', F4.by);
  ok(F2.ind.join() === 'naver:' + PA && F2.hold.join() === 'naver:' + PB, 'IND = A · 대기 = B', [F2.ind, F2.hold]); ok(F4.ind.join() === 'naver:' + PB, '11/4 IND = B', F4.ind); }

console.log('③ 주문번호 날짜 지정 줄(입력삭제 아님)');
{ const o = [nvRaw(PA, TY, 1), nvRaw(PB, TY, 1)], F2 = final(o, L('11/4', PB, '11/4 발송'), '2026-11-02'), F4 = final(o, L('11/4', PB, '11/4 발송'), '2026-11-04');
  ok(F2.by[PA] === 'go' && F2.by[PB] === 'excl', '11/2 = B 만 오늘 안 나감', F2.by); ok(F4.by[PB] === 'go', '11/4 = B 양식으로', F4.by); }

console.log('④ 자동 송장');
{ const o = [nvRaw(PA, TY, 3), nvRaw(PB, TY, 1)], F2 = final(o, L('', PA, '입력o삭제x') + '\n' + L('11/4', PB, '입력o삭제x'), '2026-11-02');
  // 11/2 = A 주소 줄 3장 나감(같은 품목) · B 는 안 나감
  t = 681000900000; const s = [sh('받는1', '부산 1', TY), sh('받는2', '부산 2', TY), sh('받는3', '부산 3', TY)];
  const { card, r } = match(o, s, F2);
  ok(r[PA] === 'indiv_any', 'A = 입력삭제 길로 1장', r); ok(!r[PB], '🔴 B(11/4 대기) = 오늘 운송장 안 붙음(발송처리 안 됨)·할 일 카드 없음', r);
  ok(card.extra.length === 2, '남는 2장 = 다른 주소 박스', card.extra.length);
  // A 주소 줄이 손님 집(B 주소와 같음)이어도 B 에 안 붙음
  t = 681000900000; const s2 = [sh('가구매', HOME, TY, BUY), sh('받는2', '부산 2', TY), sh('받는3', '부산 3', TY)]; const m2 = match(o, s2, F2);
  ok(!m2.r[PB] && m2.r[PA] === 'indiv_store_addr', '🔴 A 줄이 손님 집 주소여도 B 에 안 붙음 · A = 스토어 주소 줄', m2.r);
  // 11/4 = B 주소 줄(K=전화번호) → B 에 붙음
  const F4 = final([o[1]], L('11/4', PB, '입력o삭제x'), '2026-11-04'); t = 681000900000; const m4 = match([o[1]], [sh('받는9', '대전 9', TY)], F4);
  ok(m4.r[PB] === 'indiv_any', '11/4 = B 주소 줄로 B 에 운송장', m4.r);
  // 11/4 인데 파일을 안 올림 = 카드
  const m5 = match([o[1]], [], F4); ok(m5.r[PB] === 'todo_indiv_none', '11/4 운송장 0 = 할 일 카드', m5.r); }
{ // 날짜 지정(입력삭제 아님) B · A 는 일반 = 같은 집 같은 품목이어도 오늘 나간 1장은 A 에
  const o = [nvRaw(PA, TY, 1), nvRaw(PB, TY, 1)], F = final(o, L('11/4', PB, '11/4 발송'), '2026-11-02'); t = 681000900000; const m = match(o, [sh('가구매', HOME, TY, BUY)], F);
  ok(m.r[PA] === 'auto' && !m.r[PB], '③ 꼴 = 1장은 A · B 는 안 붙음', m.r); }

{ // 입력삭제 + 짝 없음 카드 「제외」 = keys 에도 없고 hold 에 있어 일반 짝으로도 안 집음
  const o = [nvRaw(PA, TY, 1), nvRaw(PB, TY, 1)], F = final(o, L('', PA, '입력o삭제x'), '2026-11-02', null, [PA]); t = 681000900000; const s = [sh('가구매', HOME, TY, BUY)];
  ok(F.ind.length === 0 && F.hold.join() === 'naver:' + PA, '입력삭제 제외 주문 = IND 밖 · 대기 안', [F.ind, F.hold]);
  const m = match(o, s, F); ok(!m.r[PA] && m.r[PB] === 'auto', '입력삭제 제외 주문 = 오늘 운송장 안 집음 · 같은 집 운송장은 나가는 B 에', m.r);
  const m0 = match([o[0]], s, F); ok(!Object.keys(m0.r).length && m0.card.unmatched.length === 1, '제외 주문만 있으면 그 운송장 = 주문 없음 칸', m0.r); }

console.log('⑤ 박스 확인 카드 = 날짜별 A 줄만');
{ const o = [nvRaw(PA, TY, 2), nvRaw(PB, TY, 1)], memo = L('', PA, '입력o삭제x') + '\n' + L('11/4', PB, '입력o삭제x');
  // for-ship 은 B 줄(날짜 11/4)을 waiting 으로 빼므로 오늘 파일 = A 줄 2
  const F = final(o, memo, '2026-11-02', [HEAD, row('받는1', '부산 1', TY, 1), row('받는2', '부산 2', TY, 1)]);
  ok(!F.chk.boxDiff.length && !F.chk.missing.length && !F.chk.notIndiv.length, '11/2 = 주문 A 2 = 줄 2 · 카드 0', F.chk);
  const F4 = final([o[1]], L('11/4', PB, '입력o삭제x'), '2026-11-04', [HEAD, row('받는9', '대전 9', TY, 1)]);
  ok(!F4.chk.boxDiff.length && !F4.chk.missing.length, '11/4 = 주문 B 1 = 줄 1 · 카드 0', F4.chk);
  const F2 = final(o, memo, '2026-11-02', [HEAD, row('받는1', '부산 1', TY, 1), row('받는2', '부산 2', TY, 1), row('받는9', '대전 9', TY, 1)]);
  ok(F2.chk.boxDiff.length === 1 && F2.chk.boxDiff[0].orderQty === 2 && F2.chk.boxDiff[0].cashQty === 3, 'B 줄에 날짜를 안 달면 = 박스 수 카드(2/3)로 잡힘', F2.chk.boxDiff); }

console.log('⑤-2 쿠팡·자사몰 꼴(메모함 저장 줄 = order-memo checkLine 실코드)');
{ const OM = require(path.join(ROOT, 'order-memo.js'));
  const lineOf = (key, date, plat) => OM.checkLine({ key, note: '입력o삭제x', plat, ship_date: date || null, src: 'edit' }, '2026-11-01').line;
  const cp = (oid, box, q, buy) => ({ _orderId: oid, _shipmentBoxId: box, _vendorItemId: 'V' + box, '수취인이름': '가구매', '수취인전화번호': buy || BUY, '수취인 주소': HOME, '구매자전화번호': buy || BUY, '노출상품명(옵션명)': TY, '구매수(수량)': q });
  const c24 = (oid, q) => ({ _orderId: oid, _itemCode: 'I' + oid.slice(-3), '수령인': '가구매', '수령인 휴대전화': BUY, '수령인 주소(전체)': HOME, '주문자 휴대전화': BUY, '주문상품명(세트상품 포함)': TY, '수량': q });
  const ikOf = (ch, r) => ch === 'coupang' ? r._shipmentBoxId + '|' + r._vendorItemId : r._orderId + '|' + r._itemCode;
  const run = (ch, rows, memo, date, ships) => {
      const prep = core.prepLines(memo, { realToday: date, shipDays: ['2026-11-02', '2026-11-04'], noShip: [], shipDate: date }), lines = V2.parseLines(prep.v2Text, 'naver', date);
      const merged = rows.map((r, i) => ({ ch, i, conv: { '구매자연락처': BUY }, memoFlag: null, userTouched: false, excluded: false }));
      const ctx = { today: date, naver: { rows: [] }, coupang: ch === 'coupang' ? rows : [], cafe24: ch === 'cafe24' ? rows : [], merged, allowIndiv: true, lines: { naver: [], cafe24: [], coupang: [] }, allLines: lines };
      lines.forEach(l => { if (!l.bad) ctx.lines[l.ch].push(l); }); V2.applyLines(ctx, true);
      const st = {}; merged.forEach((e, i) => { st[rows[i]._orderId] = e.individual ? 'indiv' : e.excluded ? 'excl' : 'go'; });
      const ind = merged.filter(e => e.individual && !e.excluded).map(e => ch + ':' + ikOf(ch, rows[e.i])), hold = merged.filter(e => e.excluded).map(e => ch + ':' + ikOf(ch, rows[e.i]));
      const os = ia.normOrders(ch, rows), card = ia.buildCard(ia.matchShipments({ ships: ia.normShips(ships), orders: os, pricingNames: [TY, HG], indivKeys: ind, holdKeys: hold }), os);
      return { st, ind, hold, r: Object.fromEntries(card.rows.map(x => [x.order_key, x.rule])), lineChs: lines.map(l => l.ch), card };
  };
  const OA = '12000000000001', OB = '12000000000002', S = () => { t = 681000900000; return [sh('받는1', '부산 1', TY), sh('받는2', '부산 2', TY)]; };
  const cpRows = [cp(OA, '9001', 2), cp(OB, '9002', 1)];
  const k1 = run('coupang', cpRows, lineOf(OA, null, '쿠팡') + '\n' + lineOf(OB, '2026-11-04', '쿠팡'), '2026-11-02', S());
  ok(k1.st[OA] === 'indiv' && k1.st[OB] === 'excl' && /^indiv_/.test(k1.r['9001|V9001'] || '') && !k1.r['9002|V9002'], '쿠팡 주문번호(_orderId) 줄 + 쿠팡 칸 = A 오늘 · B 대기 · B 운송장 없음', k1);
  const k2 = run('coupang', cpRows, lineOf(BUY, null, '쿠팡'), '2026-11-02', S());
  ok(k2.st[OA] === 'indiv' && k2.st[OB] === 'indiv' && Object.keys(k2.r).length === 2 && Object.values(k2.r).every(v => /^indiv_/.test(v)), '쿠팡 pno 없음 = 전화번호 줄 그대로 = 두 주문 다 입력삭제 · 1장씩', k2);
  const k3 = run('coupang', cpRows, lineOf(OA, null, '') + '\n' + lineOf(OB, '2026-11-04', ''), '2026-11-02', S());
  ok(k3.st[OA] === 'go' && k3.st[OB] === 'go', '(주의) 쿠팡인데 판매처 칸 빈 주문번호 줄 = 네이버 줄로 읽혀 안 먹음(메모함이 칸을 채워야 함)', k3.st);
  const CA = '20261101-0000001', CB = '20261101-0000002', c24Rows = [c24(CA, 2), c24(CB, 1)];
  const k4 = run('cafe24', c24Rows, lineOf(CA, null, '자사몰') + '\n' + lineOf(CB, '2026-11-04', '자사몰'), '2026-11-02', S());
  ok(k4.st[CA] === 'indiv' && k4.st[CB] === 'excl' && /^indiv_/.test(k4.r[CA + '|I001'] || '') && !k4.r[CB + '|I002'], '자사몰 주문번호 줄 = A 오늘 · B 대기 · B 운송장 없음', k4);
  const k5 = run('cafe24', [c24Rows[1]], lineOf(CB, '2026-11-04', '자사몰'), '2026-11-04', [S()[0]]);
  ok(k5.st[CB] === 'indiv' && /^indiv_/.test(k5.r[CB + '|I002'] || ''), '자사몰 11/4 = B 입력삭제 · 운송장', k5);
  const k6 = run('cafe24', c24Rows, [ '', CA, '입력o삭제x', '' ].join('\t'), '2026-11-02', S());
  ok(k6.st[CA] === 'indiv' && k6.st[CB] === 'go', '자사몰 번호 꼴 = 판매처 칸 없어도 자사몰로', k6.st); }

console.log('⑥ 종전 자료(대기 목록 없음) = 그대로');
{ const o = [nvRaw(PA, TY, 1), nvRaw(PB, TY, 1)]; const run = hold => { t = 681000900000; const os = ia.normOrders('naver', o); return JSON.stringify(ia.buildCard(ia.matchShipments({ ships: ia.normShips([sh('가구매', HOME, TY, BUY)]), orders: os, pricingNames: [TY], indivKeys: [], holdKeys: hold }), os)); };
  ok(run(undefined) === run([]), '대기 목록 없음 = 빈 목록과 같음'); }

console.log(`\n결과 ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
