/* #416 검증 — 발송안내(E) 상품명 정제: 실측 문자열 → 실함수(cleanProductName·c24OptClean 동일 정의) 실행 + 실삽입 grep */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const fs = require('fs');
const K = require(PROJ + '\\kakao-notify.js');
const c24OptClean = (v) => String(v || '').replace(/^[^=]{0,20}=\s*/, '').trim();   // server.js:9089 동일 정의(미수출)
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

// ① 네이버 발송안내 — 8/26 실발송 문면의 실제 옵션 원문 3종
const nv = [
  '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(로얄과)',
  '아꼼이네 상품선택: 1. (★행사)미니밤호박 꼬마 / 상품 및 과수: 한입밤호박 5kg(25과 전후)',
  '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: (특가)하우스감귤 가정용 - 2.5kg(소과)',
];
for (const s of nv) {
  const out = K.cleanProductName(s).slice(0, 80);
  const good = !/상품선택|상품 및 과수|^\d+\.\s|\s\d+\.\s/.test(out) && out.length >= 5;
  console.log('   네이버:', JSON.stringify(out));
  ok(good, '① 네이버 E 정제 — 시스템 문구·번호 소멸', '');
}
// ② 자사몰 발송안내 — 실측 option_value(「상품 선택=」 포함 원형) 3종
const c24 = [
  '상품 선택=1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 2.5kg(소과)',
  '상품 선택=1. (제철)과즙팡팡 황금향 · 황금향 가정용 - 5kg(중소과 27과 전후)',
  '상품 선택=2. 미니밤호박 중품못난이 · 못난이 10kg(랜덤과)',
];
for (const s of c24) {
  const out = K.cleanProductName(c24OptClean(s)).slice(0, 80);
  const good = !/상품 선택=|^\d+\.\s/.test(out) && /·/.test(out) && out.length >= 5;
  console.log('   자사몰:', JSON.stringify(out));
  ok(good, '② 자사몰 E 정제 — 「상품 선택=」·「1. 」 소멸·내용 보존', '');
}
// ③ 과잘림 폴백 무회귀 — 정제 결과가 비정상이면 원문 유지(#146 규칙)
ok(K.cleanProductName('') === '', '③ 빈 입력 안전');
ok(K.cleanProductName('최상품 청귤(풋귤) 5kg') === '최상품 청귤(풋귤) 5kg', '③ 이미 깨끗한 이름 = 무변형', '');
// ④ 실삽입 확인(grep — #178 교훈) — 발송안내 2곳에 cleanProductName 적용·주문안내/쿠팡 경로 무접촉
const src = fs.readFileSync(PROJ + '\\server.js', 'utf8');
const eN = /'상품명': kakaoNotify\.cleanProductName\(po\.productOption \|\| po\.productName \|\| '주문 상품'\)\.slice\(0, 80\),\s+\/\* #416/.test(src);
const eC = /'상품명': kakaoNotify\.cleanProductName\(c24OptClean\(it0\.option_value\) \|\| it0\.product_name \|\| '주문 상품'\)\.slice\(0, 80\),\s+\/\* #416/.test(src);
ok(eN, '④ 네이버 E 조립부 실삽입');
ok(eC, '④ 자사몰 E 조립부 실삽입');
ok((src.match(/#416/g) || []).length === 2, '④ 변경 = 정확히 2곳(무회귀)', (src.match(/#416/g) || []).length + '곳');

console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
process.exit(fail ? 1 : 0);
