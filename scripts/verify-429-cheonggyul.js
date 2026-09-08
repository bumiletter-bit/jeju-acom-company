/* #429 검증 — 청귤 네이버 옵션명 「(★라스트특가)」 접두 + 가격 인하(18,800/29,800): 품목별 금액·판매현황 이름은 그대로 — 매칭 무이상 확인
   ① 송장변환·중간발주 matchProduct(app.js 실코드) ② 알림톡·발송안내 matchNotifyProduct(kakao-notify.js 실함수·실DB bot_products) ③ 판매현황 가격 반영 */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const fs = require('fs');
const NM = PROJ + '\\node_modules\\';
require(NM + 'dotenv').config({ path: PROJ + '\\.env' });
const { Client } = require(NM + 'pg');
const kn = require(PROJ + '\\kakao-notify.js');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
function buildMatcher(src) {
  const a = src.indexOf('// 품목명 카탈로그'), b = src.indexOf('function addSizeSuffix');
  return new Function(src.slice(a, b) + '\nreturn { matchProduct, setPricing: (arr) => { aoInvoicePricingNames = arr; } };')();
}
(async () => {
  const M = buildMatcher(fs.readFileSync(PROJ + '\\public\\app.js', 'utf8'));
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  const pricing = (await c.query(`SELECT DISTINCT it->>'name' AS nm FROM pricing, jsonb_array_elements(items) it WHERE start_date <= (now() AT TIME ZONE 'Asia/Seoul')::date AND end_date >= (now() AT TIME ZONE 'Asia/Seoul')::date`)).rows.map(r => r.nm);
  M.setPricing(pricing);
  const NEW5 = '아꼼이네 상품선택: (★라스트특가)최상품 청귤(풋귤) 5kg (개수 : 1)', NEW10 = '아꼼이네 상품선택: (★라스트특가)최상품 청귤(풋귤) 10kg (개수 : 2)';
  const OLD5 = '아꼼이네 상품선택: 최상품 청귤(풋귤) 5kg (개수 : 1)', OLD10 = '아꼼이네 상품선택: 최상품 청귤(풋귤) 10kg (개수 : 1)';
  ok(M.matchProduct(NEW5) === '최상품 청귤(풋귤) 5kg', '① 송장변환: 새 문구 (★라스트특가) 5kg → 품목별 금액 「최상품 청귤(풋귤) 5kg」', M.matchProduct(NEW5));
  ok(M.matchProduct(NEW10) === '최상품 청귤(풋귤) 10kg', '① 송장변환: 새 문구 10kg → 「최상품 청귤(풋귤) 10kg」(5kg 오집 없음)', M.matchProduct(NEW10));
  ok(M.matchProduct(OLD5) === '최상품 청귤(풋귤) 5kg' && M.matchProduct(OLD10) === '최상품 청귤(풋귤) 10kg', '① 송장변환: 옛 문구(변경 전 결제분) 무회귀');
  M.setPricing([]);
  ok(!M.matchProduct(NEW5).startsWith('[미매칭]') && !M.matchProduct(NEW10).startsWith('[미매칭]'), '① 규칙 폴백(pricing 미로드)도 매칭', M.matchProduct(NEW10));
  const bp = (await c.query(`SELECT id, name, status, price, shipping_guide FROM bot_products WHERE deleted_at IS NULL AND status='판매중'`)).rows;
  const raw = n => `제주 청귤 풋귤 5kg 10kg 산지직송 아꼼이네 상품선택: ${n}`;
  const m5 = kn.matchNotifyProduct(raw('(★라스트특가)최상품 청귤(풋귤) 5kg'), bp), m10 = kn.matchNotifyProduct(raw('(★라스트특가)최상품 청귤(풋귤) 10kg'), bp);
  ok(m5 && m5.id === 48 && m10 && m10.id === 49 && m5.shipping_guide && m10.shipping_guide, '② 알림톡·발송안내: 새 문구 → 행 48/49 · 안내문 있음', `${m5 && m5.id}/${m10 && m10.id}`);
  ok(m5.price === '18,800원' && m10.price === '29,800원', '③ 판매현황 가격 = 네이버 인하가(18,800 / 29,800)', `${m5.price} / ${m10.price}`);
  await c.end();
  console.log(`\n결과: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
