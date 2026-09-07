/* #428 검증 — 황금향 선물용 옵션명 변경(대과 7~15과→중대과 7~15과 · 대과 13~23과→중대과 13~25과) 송장변환·중간발주 매칭 (2026-09-07)
   방식 = #406·#424 방법론 재사용: app.js 실코드 추출 실행 + git HEAD(구코드) 동일 입력 전수 비교.
   목표: ①새 옵션 문구 → pricing 중대과 품목 ②옛 문구(변경 전 결제분 — 배송준비에 남아 있음) → 같은 중대과 품목(규칙 경로 수렴) ③나머지 전수 신=구. */
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
  const factory = new Function(chunk + '\nreturn { matchProduct, matchProductRaw, PRODUCT_CATALOG, setPricing: (arr) => { aoInvoicePricingNames = arr; } };');
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
  const P3 = '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)';
  const P5 = '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)';
  ok(pricing.includes(P3) && pricing.includes(P5), '⓪ 오늘 pricing에 중대과 2종 존재(대표 등록)', '3kg·5kg');
  ok(!pricing.some(n => /황금향 선물용.*\(대과/.test(n)), '⓪ 오늘 pricing에 옛 「대과」 황금향 선물용 없음');
  ok(NEW.PRODUCT_CATALOG.has(P3) && NEW.PRODUCT_CATALOG.has(P5) && !NEW.PRODUCT_CATALOG.has(P5.replace('중대과 13~25과', '대과 13~23과')), '⓪ 신코드 카탈로그 = 중대과 2종 있음·옛 5kg(대과 13~23과) 없음');

  const wrap = (n2, n1 = '1. (제철)과즙팡팡 황금향') => `아꼼이네 상품선택: ${n1} / 상품 및 과수: ${n2} (개수 : 1)`;
  const NEW3 = wrap('황금향 선물용 - 3kg(중대과 7~15과)'), NEW5 = wrap('황금향 선물용 - 5kg(중대과 13~25과)');
  const OLD3 = wrap('황금향 선물용 - 3kg(대과 7~15과)'), OLD5a = wrap('황금향 선물용 - 5kg(대과 13~23과)'), OLD5b = wrap('황금향 선물용 - 5kg(대과 13~25과)');
  const C92_3 = wrap('황금향 선물용 - 3kg(중대과 7~15과)', '2. (제철)과즙팡팡 황금향');   // 타이벡 상품(c92) 안의 황금향 옵션(번호 2)

  NEW.setPricing(pricing); OLD.setPricing(pricing);
  // ① 새 문구 = 선매칭(통째 포함)으로 pricing 중대과 품목
  ok(NEW.matchProduct(NEW3) === P3, '① 새 문구 3kg(중대과 7~15과) → pricing 3kg 중대과', NEW.matchProduct(NEW3));
  ok(NEW.matchProduct(NEW5) === P5, '① 새 문구 5kg(중대과 13~25과) → pricing 5kg 중대과', NEW.matchProduct(NEW5));
  ok(NEW.matchProduct(C92_3) === P3, '① 타이벡(c92) 안 황금향 선물 3kg(번호 2) → 동일 품목', NEW.matchProduct(C92_3));
  // ② 옛 문구(변경 전 결제·배송준비 잔존) = 규칙 경로로 같은 품목에 수렴 — 오집·미매칭 0
  ok(NEW.matchProduct(OLD3) === P3, '② 옛 문구 3kg(대과 7~15과) → pricing 3kg 중대과(수렴)', NEW.matchProduct(OLD3));
  ok(NEW.matchProduct(OLD5a) === P5, '② 옛 문구 5kg(대과 13~23과) → pricing 5kg 중대과(수렴)', NEW.matchProduct(OLD5a));
  ok(NEW.matchProduct(OLD5b) === P5, '② 옛 문구 5kg(대과 13~25과) → pricing 5kg 중대과(수렴)', NEW.matchProduct(OLD5b));
  // ②-b 🔴 배포 필요성 증명: 구코드(HEAD)는 옛 문구를 규칙 경로에서 「대과」 표준명으로 만들어 pricing 「중대과」와 grade 불일치 → [미매칭].
  //     = 코드 미배포 상태에서 변경 전 결제분(배송준비 잔존)이 송장변환·중간발주에서 전부 [미매칭]으로 떨어진다(실측 9/7).
  const oldMiss = [OLD3, OLD5a, OLD5b].filter(x => OLD.matchProduct(x).startsWith('[미매칭]'));
  ok(oldMiss.length === 3, '②-b 구코드 = 옛 문구 3종 전부 [미매칭] 재현(배포 필요 근거)', oldMiss.length + '/3');
  const sameNew = [NEW3, NEW5, C92_3].filter(x => OLD.matchProduct(x) !== NEW.matchProduct(x));
  ok(sameNew.length === 0, '②-c 새 문구 3종은 신=구 동일(선매칭 경로 — 무회귀)', sameNew.length ? '차이' : '동일');
  // ③ 오늘 pricing 전수 무회귀 — 신=구
  const mkOpt = (nm, i) => `아꼼이네 상품선택: ${1 + (i % 3)}. ${i % 2 ? '(제철)' : ''}${nm} (개수 : ${1 + (i % 4)})`;
  const diffs = [];
  pricing.forEach((nm, i) => { const o = OLD.matchProduct(mkOpt(nm, i)), n = NEW.matchProduct(mkOpt(nm, i)); if (o !== n) diffs.push(nm); });
  ok(diffs.length === 0, '③ 오늘 pricing 전수(' + pricing.length + '종) 신=구 완전 동일', diffs.join(' | ') || '전수 일치');
  ok(pricing.every(nm => !NEW.matchProduct(wrap(nm.replace(/^.*상품 및 과수: /, ''))).startsWith('[미매칭]') || !/황금향/.test(nm)), '③ 황금향 전 품목 미매칭 0');
  // ④ 규칙 폴백(pricing 미로드) — 표준명이 중대과로(신) / 구코드는 옛 이름(의도한 차이 2종만)
  NEW.setPricing([]); OLD.setPricing([]);
  ok(NEW.matchProduct(NEW3) === P3 && NEW.matchProduct(OLD3) === P3, '④ 폴백: 3kg 새·옛 문구 → 표준명 중대과 7~15과', NEW.matchProduct(OLD3));
  ok(NEW.matchProduct(NEW5) === P5 && NEW.matchProduct(OLD5a) === P5, '④ 폴백: 5kg 새·옛 문구 → 표준명 중대과 13~25과', NEW.matchProduct(OLD5a));
  const ruleDiffs = [];
  pricing.forEach((nm, i) => { const o = OLD.matchProduct(mkOpt(nm, i)), n = NEW.matchProduct(mkOpt(nm, i)); if (o !== n) ruleDiffs.push(nm.slice(-22) + ': ' + o.slice(-22) + ' → ' + n.slice(-22)); });
  ok(ruleDiffs.length === 2 && ruleDiffs.every(d => /중대과/.test(d)), '④ 폴백 전수 차이 = 황금향 선물용 2종뿐(의도)', ruleDiffs.join(' | '));

  console.log(`\n결과: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
