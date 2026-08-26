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

// ⑤ 🔴 전 경로 전수 검산(재발 방지의 핵심) — server.js의 모든 '상품명': 조립부는 cleanProductName을 거쳐야 한다.
//    새 채널·새 발송 경로가 추가되면 이 검사가 자동으로 잡는다(새 "품목"은 정제기가 구조 규칙이라 원래 자동 커버).
const lines = src.split('\n');
const spots = lines.map((l, i) => ({ l, n: i + 1 })).filter(x => x.l.includes("'상품명':"));
const bad = spots.filter(x => !x.l.includes('kakaoNotify.cleanProductName(') && !x.l.includes('cleanProductName('));
ok(spots.length >= 8 && bad.length === 0, `⑤ 상품명 조립부 전수(${spots.length}곳) = 정제기 통과`, bad.map(x => x.n).join(',') || '누락 0');
const inlineBad = lines.map((l, i) => ({ l, n: i + 1 })).filter(x => /님이 주문하신 \[\$\{/.test(x.l) && !x.l.includes('cleanProductName'));
ok(inlineBad.length === 0, '⑤ 인라인 [상품명] 삽입부(쿠팡 폴백 등)도 정제 통과', inlineBad.map(x => x.n).join(',') || '누락 0');
// ⑥ 쿠팡 실이름 = 무변형(자연 형식 보존 — 정제기가 멀쩡한 이름을 건드리지 않음)
const cpName = '제주아꼼이네 제철 고당도 하우스감귤, 1박스, 가정용 4.5kg(로얄과)';
ok(K.cleanProductName(cpName) === cpName, '⑥ 쿠팡 자연 형식 무변형', '');

// ⑦ 실DB 스캔 — 최근 실발송 주문안내(전 채널 30건) 문면 [상품명] 잔재 0
(async () => {
  try {
    require(PROJ + '\\node_modules\\dotenv').config({ path: PROJ + '\\.env' });
    const { Client } = require(PROJ + '\\node_modules\\pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const r = await c.query(`SELECT order_key, message FROM kakao_notify_log
      WHERE mode='real' AND status='sent' AND message IS NOT NULL AND order_key NOT LIKE 'join:%' ORDER BY id DESC LIMIT 30`);
    await c.end();
    const dirty = r.rows.filter(x => {
      const m = String(x.message).match(/\[([^\]]+)\]/); const nm = m ? m[1] : '';
      return /상품선택|상품 선택=|상품 및 과수/.test(nm) || /^\d+\.\s/.test(nm);
    });
    ok(dirty.length === 0, '⑦ 최근 실발송 주문안내 30건(전 채널) 문면 잔재 0', dirty.length ? dirty.map(d => d.order_key).join(',') : '클린');
  } catch (e) { ok(false, '⑦ DB 스캔 실패', String(e.message).slice(0, 80)); }
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})();
