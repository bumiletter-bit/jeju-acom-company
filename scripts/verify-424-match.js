/* #424 검증 — 하우스감귤 행사★(소과 2.5→중량up 4kg) 송장변환 매칭 (2026-09-02)
   방식 = #406 방법론 재사용: app.js 실코드 추출 실행 + git HEAD(구코드) 동일 입력 전수 비교.
   무회귀 목표: 달라지는 입력은 「중량up 4kg 하우스감귤」 계열뿐 — 특가 4.5(소과)는 4.5 그대로. */
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

  const P4 = '고당도 하우스감귤 / 상품 및 과수: 가정용 - 4kg(소과)';   // 대표가 품목별 금액에 등록할 이름(효돈 형식 그대로)
  const EVENT_OPT = '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 행사★하우스귤 2.5kg 소과→중량up 4kg (개수 : 1)';
  const SALE45_OPT = '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: (특가)하우스감귤 가정용 - 4.5kg(소과) (개수 : 1)';
  const REG25_OPT = '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(소과) (개수 : 1)';

  // ① 행사 옵션 — 구코드 = [미매칭] 재현 / 신코드 = 현재 pricing(4kg 없음)이면 [미매칭](안전) · 4kg 등록 시 즉시 자동 연동
  NEW.setPricing(pricing); OLD.setPricing(pricing);
  const oldEv = OLD.matchProduct(EVENT_OPT), newEvNoP = NEW.matchProduct(EVENT_OPT);
  ok(oldEv.startsWith('[미매칭]'), '① 구코드 = 행사 옵션 [미매칭] 재현', oldEv.slice(0, 60));
  ok(newEvNoP.startsWith('[미매칭]') && !/2\.5kg|4\.5kg/.test(newEvNoP.replace(EVENT_OPT, '')), '① 신코드(4kg 미등록) = [미매칭] — 2.5/4.5 오집 없음(안전)', newEvNoP.slice(0, 60));
  NEW.setPricing([...pricing, P4]);
  const newEv = NEW.matchProduct(EVENT_OPT);
  ok(newEv === P4, '① 신코드 + 품목별 금액 4kg(소과) 등록 = 즉시 자동 매칭', newEv);

  // ② 특가 4.5(소과) = 4.5 그대로 (대표 지시 핵심 무회귀 — 4kg 등록 상태에서도 오집 없음)
  const old45 = OLD.matchProduct(SALE45_OPT), new45 = NEW.matchProduct(SALE45_OPT);
  ok(old45 === new45 && /4\.5kg\(소과\)/.test(new45) && !new45.startsWith('[미매칭]'), '② 특가 4.5(소과) = 4.5 그대로(신=구·4kg 오집 없음)', new45);
  const new25 = NEW.matchProduct(REG25_OPT);
  ok(/2\.5kg\(소과\)/.test(new25) && !new25.startsWith('[미매칭]'), '② 일반 소과 2.5kg 무회귀', new25);

  // ③ 무회귀 전수 — 오늘 pricing 전 품목을 옵션 형태로 감싸 신·구 완전 동일(카탈로그 1행 추가는 기존 입력 무영향)
  NEW.setPricing(pricing); OLD.setPricing(pricing);
  const mkOpt = (nm, i) => `아꼼이네 상품선택: ${1 + (i % 3)}. ${i % 2 ? '(제철)' : ''}${nm} (개수 : ${1 + (i % 4)})`;
  const diffs = [];
  pricing.forEach((nm, i) => { const o = OLD.matchProduct(mkOpt(nm, i)), n = NEW.matchProduct(mkOpt(nm, i)); if (o !== n) diffs.push(nm); });
  ok(diffs.length === 0, '③ 오늘 pricing 전수(' + pricing.length + '종) 신=구 완전 동일', diffs.join(' | ') || '전수 일치');

  // ④ 규칙 폴백(pricing 미로드) — 전수 신=구 + 행사 옵션만 신코드에서 표준명 4kg(소과) 복귀
  NEW.setPricing([]); OLD.setPricing([]);
  const ruleDiffs = [];
  pricing.forEach((nm, i) => { const o = OLD.matchProduct(mkOpt(nm, i)), n = NEW.matchProduct(mkOpt(nm, i)); if (o !== n) ruleDiffs.push(nm); });
  ok(ruleDiffs.length === 0, '④ 규칙 폴백 전수 신=구 동일', ruleDiffs.join(' | ') || '전수 일치');
  const ruleEv = NEW.matchProduct(EVENT_OPT);
  ok(ruleEv === '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4kg(소과)', '④ 폴백 경로: 행사 옵션 = 표준명 4kg(소과)', ruleEv);

  console.log(`\n결과: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
