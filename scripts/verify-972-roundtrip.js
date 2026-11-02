// #972 왕복(가짜 주문 · 실DB·채널·브라우저 0): 3채널 옵션 글 → 변환 실코드(app.js 를 invoice-v2 와 같은 구간으로 떼어) → 거래처(core.partnerOf) → 수량 합 → 사이즈 꼬리 → 자동 송장 짝(invoice-auto 실코드)
//   단가표 = 실행 때 넘긴 JSON(VERIFY_972_PRICING · read.js 가 저장한 꼴) · 없으면 코드 안 목록
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const txt = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
const core = require(path.join(ROOT, 'public/final-order-core.js')), ia = require(path.join(ROOT, 'invoice-auto.js'));
const a = txt.indexOf('function detectSize(msg)'), b = txt.indexOf('// 채널 초기화');
if (a < 0 || b < 0) throw new Error('구간 없음');
const prs = JSON.parse(fs.readFileSync(process.env.VERIFY_972_PRICING, 'utf8'));
const byPartner = {}; for (const p of prs) byPartner[p.partner] = (byPartner[p.partner] || []).concat(p.items.map(i => i.name));
const names = Object.values(byPartner).flat();
const doc = { getElementById: () => ({ value: '제주특별자치도 제주시 연삼로 1066-31' }), querySelector: () => null, querySelectorAll: () => [] };
const P = new Function('api', 'aoEsc', 'XLSX', 'document', 'aoProgressBarTicker', 'aoInvoicePricingNames', txt.slice(a, b).replace(/^let aoInvoicePricingNames.*$/m, '').replace(/^let aoInvoicePricingByPartner.*$/m, 'let aoInvoicePricingByPartner = {};') + '\nreturn { convertDataSmart, convertDataJasamol, convertDataCoupang };')(async () => ({ byPartner }), s => s, {}, doc, () => () => {}, names);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('❌ ' + m); } };
const DS = '대성(시온)';
const pIdx = Object.keys(byPartner).find(k => /대성/.test(k)); if (!pIdx) throw new Error('대성 단가표 없음');
const YU = ['3kg(로얄과 2S~M)', '5kg(소과 2S미만)', '10kg(중대과 L이상)'];
const CASES = [];
const nj = t => '새콤달콤 노지감귤 / 상품 및 과수: 가정용 - ' + t;
for (const w of ['3kg', '5kg', '10kg']) for (const g of ['로얄과 2S~M', '소과 2S미만', '중대과 L이상']) { const t = `${w}(${g})`;
    CASES.push({ ch: 'naver', raw: '아꼼이네 상품선택: 2. (제철)새콤달콤 노지감귤 / 상품 및 과수: 가정용 - ' + t, want: nj(t) });
    CASES.push({ ch: 'cafe24', raw: '제주 감귤 상품 선택=2. (제철)새콤달콤 노지감귤 · 가정용 - ' + t, want: nj(t) });
    CASES.push({ ch: 'coupang', raw: '제주아꼼이네 제철 새콤달콤 유라품종 노지감귤, 1박스, 노지감귤 가정용 ' + t, want: nj(t) });
}
const nh = t => '과즙팡팡 황금향 / 상품 및 과수: 노지 황금향 ' + t;
for (const t of ['가정용 - 5kg(혼합과)', '가정용 - 10kg(혼합과)', '못난이 - 5kg(혼합과)', '못난이 - 10kg(혼합과)']) {
    CASES.push({ ch: 'naver', raw: '아꼼이네 상품선택: 1. (제철)과즙팡팡 황금향 / 상품 및 과수: 노지 황금향 ' + t, want: nh(t) });
    CASES.push({ ch: 'cafe24', raw: '제주 황금향 상품 선택=1. (제철)과즙팡팡 황금향 · 노지 황금향 ' + t, want: nh(t) });
    CASES.push({ ch: 'coupang', raw: '제주아꼼이네 제철 과즙팡팡 황금향 출하, 1박스, 노지 황금향 ' + t.replace(' - ', ' '), want: nh(t) });
}
for (const [t, kind] of [['황금향 선물용 - 3kg(중대과 7~15과)'], ['황금향 선물용 - 5kg(중대과 13~25과)'], ['황금향 가정용 - 5kg(중소과 27과 전후)'], ['황금향 못난이 - 5kg(랜덤과)']]) CASES.push({ ch: 'naver', raw: '아꼼이네 상품선택: 1. (제철)과즙팡팡 황금향 / 상품 및 과수: ' + t, want: '과즙팡팡 황금향 / 상품 및 과수: ' + t });
for (const t of YU) { CASES.push({ ch: 'naver', raw: '아꼼이네 상품선택: 2. (제철)유라품종 노지감귤 / 상품 및 과수: 가정용 - ' + t, want: '유라품종 노지감귤 / 상품 및 과수: 가정용 - ' + t }); }
CASES.push({ ch: 'coupang', raw: '제주아꼼이네 제철 새콤달콤 유라품종 노지감귤, 1박스, 가정용 3kg(로얄과)', want: '유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)' });
const run = (c, memo) => {
    if (c.ch === 'naver') return P.convertDataSmart([{ '구매자명': '가짜', '구매자연락처': '010-2600-0001', '수취인명': '가짜수취', '옵션정보': c.raw, '수량': 2, '수취인연락처1': '010-2600-0001', '통합배송지': '서울 가짜구 1', '배송메세지': memo || '' }])[0];
    if (c.ch === 'cafe24') return P.convertDataJasamol([{ '주문자명': '가짜', '주문자 휴대전화': '010-2600-0001', '수령인': '가짜수취', '주문상품명(세트상품 포함)': c.raw, '수량': 2, '수령인 휴대전화': '010-2600-0001', '수령인 주소(전체)': '서울 가짜구 1', '배송메시지': memo || '' }])[0];
    return P.convertDataCoupang([{ '구매자': '가짜', '구매자전화번호': '010-2600-0001', '수취인이름': '가짜수취', '등록상품명': '', '등록옵션명': c.raw, '노출상품명(옵션명)': c.raw, '구매수(수량)': 2, '수취인전화번호': '010-2600-0001', '수취인 주소': '서울 가짜구 1', '배송메세지': memo || '' }])[0];
};
const qty = {}; const rowsOut = [];
for (const c of CASES) { const r = run(c); ok(r['옵션정보'] === c.want, c.ch + ' ' + c.raw + ' → ' + r['옵션정보']); const p = core.partnerOf(r['옵션정보'], byPartner); ok(p === pIdx, '거래처 ' + r['옵션정보'] + ' → ' + p); qty[r['옵션정보']] = (qty[r['옵션정보']] || 0) + r['수량']; rowsOut.push([c.ch, r['옵션정보'], p]); }
// 사이즈 꼬리: 노지귤 로얄과만
const size = (c, m) => run(c, m)['옵션정보'];
ok(size({ ch: 'naver', raw: '2. (제철)새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)' }, 'S사이즈로 부탁해요') === nj('5kg(로얄과 2S~M)') + ' S사이즈로!', '노지귤 로얄과 사이즈 꼬리');
ok(core.partnerOf(nj('5kg(로얄과 2S~M)') + ' S사이즈로!', byPartner) === pIdx, '꼬리 붙어도 거래처');
ok(size({ ch: 'naver', raw: '2. (제철)새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 5kg(소과 2S미만)' }, 'S사이즈로 부탁해요') === nj('5kg(소과 2S미만)'), '노지귤 소과 꼬리 없음');
ok(size({ ch: 'naver', raw: '1. (제철)과즙팡팡 황금향 / 상품 및 과수: 노지 황금향 가정용 - 5kg(혼합과)' }, 'S사이즈로 부탁해요') === nh('가정용 - 5kg(혼합과)'), '노지 황금향 꼬리 없음');
// 자동 송장: 같은 받는 분 두 품목(끝 칸 글자 같은 노지귤·유라·타이벡) → 맞는 주문에 · 운송장 상품명 = 양식 옵션정보
const mk = (id, opt) => ({ _pid: id, '수취인명': '가짜수취', '수취인연락처1': '010-2600-0001', '통합배송지': '서울특별시 가짜구 집로 1', '구매자연락처': '010-2600-0001', '옵션정보': opt, '수량': 1 });
const TY = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)', YR = '유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)', NJ = nj('3kg(로얄과 2S~M)');
const orders = ia.normOrders('naver', [mk('o1', '2. (제철)새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)'), mk('o2', '1. (제철)고당도 타이벡감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)'), mk('o3', '2. (제철)유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)'),
    mk('o4', '1. (제철)과즙팡팡 황금향 / 상품 및 과수: 노지 황금향 못난이 - 5kg(혼합과)'), mk('o5', '1. (제철)과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 5kg(랜덤과)')]);
const shipOf = (tr, product) => { const nm = '가짜수취', tel = '010-2600-0001', ad = '서울특별시 가짜구 집로 1'; const dg = s => String(s).replace(/D/g, ''); return { tracking: '60120360000' + tr.slice(1), partner: '가짜', name: nm, tel, addr: ad, product, sender: '가짜(제주아꼼이네)', senderTel: dg(tel), key: orders[0].key, cash: false }; };
const ships = [shipOf('T1', NJ), shipOf('T2', TY), shipOf('T3', YR), shipOf('T4', nh('못난이 - 5kg(혼합과)')), shipOf('T5', '과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 5kg(랜덤과)')];
const res = ia.matchShipments({ ships, orders, pricingNames: names });
const got = {}; for (const m of res.assign) got[m.o.order_key] = m.ships.map(s => 'T' + s.tracking.slice(-1)).join(',');
ok(!res.todos.length, '할 일 카드 ' + res.todos.length + '건');
const WANT = { o1: 'T1', o2: 'T2', o3: 'T3', o4: 'T4', o5: 'T5' };
for (const k of Object.keys(WANT)) ok(got[k] === WANT[k], '자동 송장 ' + k + ' → ' + got[k] + ' (기대 ' + WANT[k] + ') 결과 칸 ' + Object.keys(res).join(','));
const outDir = process.env.VERIFY_972_OUT; if (outDir) fs.writeFileSync(path.join(outDir, 'roundtrip.json'), JSON.stringify({ rowsOut, qty, got }, null, 1));
console.log('품목별 수량(가짜 주문 줄당 2박스):'); Object.entries(qty).forEach(([k, v]) => console.log('  ' + v + ' ' + k));
console.log('자동 송장 짝:', JSON.stringify(got));
console.log('결과: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
