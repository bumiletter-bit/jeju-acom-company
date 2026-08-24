/* #406 검증 — 송장변환·중간발주 매칭: 황금향 못난이 교정 + pricing 선매칭(품목별 금액 = 자동 연동)
   방식: app.js에서 실코드(카탈로그·matchProduct·matchProductRaw·aoMatchToPricing)를 떼어 실행(관례 준수)
   + git HEAD(구코드)와 동일 입력 전수 비교(무회귀 = 달라지는 것은 황금향 못난이 2종뿐이어야 함)
   + pricing 품목명은 실DB에서 오늘 유효분 로드. */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const fs = require('fs');
const { execSync } = require('child_process');
const NM = PROJ + '\\node_modules\\';
require(NM + 'dotenv').config({ path: PROJ + '\\.env' });
const { Client } = require(NM + 'pg');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

function buildMatcher(src) {
  const a = src.indexOf('// 품목명 카탈로그');
  const b = src.indexOf('function addSizeSuffix');
  if (a < 0 || b < 0 || b <= a) throw new Error('추출 경계 실패');
  const chunk = src.slice(a, b);
  // 정의만 평가 — api/document는 호출 안 하므로 스텁 불요. 반환: matchProduct + pricing 주입 함수
  const factory = new Function(chunk + '\nreturn { matchProduct, matchProductRaw, setPricing: (arr) => { aoInvoicePricingNames = arr; } };');
  return factory();
}

(async () => {
  const newSrc = fs.readFileSync(PROJ + '\\public\\app.js', 'utf8');
  const oldSrc = execSync('git show HEAD:public/app.js', { cwd: PROJ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const NEW = buildMatcher(newSrc), OLD = buildMatcher(oldSrc);

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const pricing = (await c.query(`SELECT DISTINCT it->>'name' AS nm FROM pricing, jsonb_array_elements(items) it
    WHERE start_date <= (now() AT TIME ZONE 'Asia/Seoul')::date AND end_date >= (now() AT TIME ZONE 'Asia/Seoul')::date ORDER BY nm`)).rows.map(r => r.nm);
  await c.end();
  console.log('  오늘 유효 pricing 품목:', pricing.length + '종');

  const mkOpt = (nm, i) => `아꼼이네 상품선택: ${1 + (i % 3)}. ${i % 2 ? '(제철)' : ''}${nm} (개수 : ${1 + (i % 4)})`;

  // ① 실사고 재현·교정 — 실주문 옵션 문자열 그대로
  NEW.setPricing(pricing); OLD.setPricing(pricing);
  const realOpt = '아꼼이네 상품선택: 2. (제철)과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 5kg(랜덤과)';
  const oldR = OLD.matchProduct(realOpt), newR = NEW.matchProduct(realOpt);
  ok(/가정용 - 5kg/.test(oldR), '① 구코드 오매칭 재현(못난이→가정용 5kg)', oldR);
  ok(newR === '과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 5kg(랜덤과)', '① 신코드 = 못난이 5kg 정확', newR);
  const opt10 = '아꼼이네 상품선택: 2. (제철)과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 10kg(랜덤과)';
  ok(NEW.matchProduct(opt10) === '과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 10kg(랜덤과)', '① 못난이 10kg 정확', NEW.matchProduct(opt10));

  // ② 오늘 pricing 전수(24종) — 네이버 옵션 형태로 감싸도 전부 자기 이름으로 복귀 (품목별 금액 = 자동 연동 실증)
  const missNew = pricing.filter((nm, i) => NEW.matchProduct(mkOpt(nm, i)) !== nm);
  ok(missNew.length === 0, '② 신코드: pricing 전수 자기 이름 복귀 ' + (pricing.length - missNew.length) + '/' + pricing.length, missNew.join(' | ') || '전수 통과');
  const missOld = pricing.filter((nm, i) => OLD.matchProduct(mkOpt(nm, i)) !== nm);
  console.log('     (참고) 구코드 전수 결과: ' + (pricing.length - missOld.length) + '/' + pricing.length + (missOld.length ? ' — 실패: ' + missOld.join(' | ') : ''));

  // ③ 무회귀 — 같은 입력 전수에서 신≠구인 것은 「황금향 못난이」 계열뿐이어야 함
  const diffs = [];
  pricing.forEach((nm, i) => { const o = OLD.matchProduct(mkOpt(nm, i)), n = NEW.matchProduct(mkOpt(nm, i)); if (o !== n) diffs.push(nm + ' :: 구[' + o + '] → 신[' + n + ']'); });
  ok(diffs.every(d => /황금향 못난이/.test(d)) && diffs.length <= 2, '③ 신·구 차이 = 황금향 못난이 2종뿐', diffs.length + '건\n     ' + diffs.join('\n     '));

  // ④ 규칙 경로 무회귀(pricing 미로드 폴백) — 구코드와 동일해야 함(못난이 제외)
  NEW.setPricing([]); OLD.setPricing([]);
  const ruleDiffs = [];
  pricing.forEach((nm, i) => { const o = OLD.matchProduct(mkOpt(nm, i)), n = NEW.matchProduct(mkOpt(nm, i)); if (o !== n) ruleDiffs.push(nm + ' :: 구[' + o + '] → 신[' + n + ']'); });
  ok(ruleDiffs.every(d => /황금향 못난이/.test(d)), '④ pricing 미로드(규칙 폴백) 무회귀 — 차이는 못난이뿐', ruleDiffs.length + '건');
  ok(NEW.matchProductRaw('황금향 못난이 - 5kg(랜덤과)') === '과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 5kg(랜덤과)', '④ 규칙 파서 단독도 못난이 정확(카탈로그 등재)');

  // ⑤ 중량up 가드 — 선매칭이 옛 중량(3kg)을 집지 않고 종전 규칙(5kg) 유지
  NEW.setPricing(pricing); OLD.setPricing(pricing);
  const upOpt = '아꼼이네 상품선택: 1. 미니밤호박 특품최상급 / 상품 및 과수: 특품 3kg(6~12개) 중량up 5kg';
  const upOld = OLD.matchProduct(upOpt), upNew = NEW.matchProduct(upOpt);
  ok(upNew === upOld && /5kg/.test(upNew), '⑤ 중량up 옵션 = 종전 규칙 결과 유지(5kg)', '구[' + upOld + '] 신[' + upNew + ']');

  // ⑥ 가정용·선물용 오염 없음 — 가정용 옵션이 못난이로 새지 않는다
  const homeOpt = '아꼼이네 상품선택: 2. (제철)과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 5kg(중소과 27과 전후)';
  ok(NEW.matchProduct(homeOpt) === '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 5kg(중소과 27과 전후)', '⑥ 가정용 5kg 무회귀', NEW.matchProduct(homeOpt));

  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
