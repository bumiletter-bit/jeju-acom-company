/* #497 검증 — 송장변환·중간발주 매칭: 자사몰(「 · 」 구분)·쿠팡(단어 순서 다름) 옵션의 10/1 오픈 3품목(유라·그린레몬·레드키위) 매칭
   방식(관례): app.js 실코드(카탈로그·matchProduct·matchProductRaw·aoMatchKey·aoMatchToPricing)를 떼어 실행 + git HEAD 구코드와 동일 입력 전수 비교
   + pricing 품목명은 실DB 오늘 유효분. 실주문 옵션 원문은 scratch qty-res.json(러너 결과)이 있으면 그것도 전수 대조.
   실행: node scripts/verify-497-match.js [러너결과.json] */
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
  const factory = new Function(src.slice(a, b) + '\nreturn { matchProduct, matchProductRaw, catalog: PRODUCT_CATALOG, setPricing: (arr) => { aoInvoicePricingNames = arr; } };');
  return factory();
}

(async () => {
  const newSrc = fs.readFileSync(PROJ + '\\public\\app.js', 'utf8');
  const oldSrc = execSync('git show HEAD:public/app.js', { cwd: PROJ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const NEW = buildMatcher(newSrc), OLD = buildMatcher(oldSrc);
  // v2 슬라이스 표식 4개 보존(#463) + 매칭 구간 안에서만 수정
  ['function detectSize(msg)', '// 채널 초기화', 'let qtyAggregated = [];', 'window.resetInvoiceQty = resetInvoiceQty;'].forEach(m => ok(newSrc.includes(m), 'v2 슬라이스 표식 보존: ' + m));

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const pricing = (await c.query(`SELECT DISTINCT it->>'name' AS nm FROM pricing, jsonb_array_elements(items) it
    WHERE start_date <= (now() AT TIME ZONE 'Asia/Seoul')::date AND end_date >= (now() AT TIME ZONE 'Asia/Seoul')::date ORDER BY nm`)).rows.map(r => r.nm);
  await c.end();
  console.log('  오늘 유효 pricing 품목:', pricing.length + '종');
  NEW.setPricing(pricing); OLD.setPricing(pricing);

  console.log('\n① 10/1 실주문 옵션 원문(자사몰·쿠팡·네이버) → 신코드 매칭');
  const cases = [
    ['cafe24 유라 로얄', '제주 감귤 상품 선택=2. (제철)유라품종 노지감귤 · 가정용 - 3kg(로얄과 2S~M)', '유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)'],
    ['cafe24 유라 소과', '제주 감귤 상품 선택=2. (제철)유라품종 노지감귤 · 가정용 - 3kg(소과 2S미만)', '유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(소과 2S미만)'],
    ['cafe24 그린레몬(옵션만)', '제주 그린레몬 상품 선택=제주 그린레몬5kg(중소과)', '과수 및 크기: 제주 그린레몬5kg(중소과)'],
    ['cafe24 레드키위(옵션만)', '제주 레드키위 상품 선택=제주산 레드키위 3kg(로얄과)', '과수 및 크기: 제주산 레드키위 3kg(로얄과)'],
    ['coupang 그린레몬 10kg', '제주아꼼이네 제철 제주레몬 출하, 1박스, 그린레몬 중소과 10kg', '과수 및 크기: 제주 그린레몬10kg(중소과)'],
    ['coupang 레드키위 5kg(가상)', '제주아꼼이네 제주산 레드키위, 1박스, 레드키위 로얄과 5kg', '과수 및 크기: 제주산 레드키위 5kg(로얄과)'],
    ['coupang 유라 소과 3kg(가상)', '제주아꼼이네 유라조생 노지감귤, 1박스, 소과 2S미만 3kg', '유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(소과 2S미만)'],
    ['naver 유라 5kg', '아꼼이네 상품선택: 2. (제철)유라품종 노지감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', '유라품종 노지감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)'],
    ['naver 그린레몬 5kg', '과수 및 크기: 제주 그린레몬5kg(중소과)', '과수 및 크기: 제주 그린레몬5kg(중소과)'],
    ['naver 레드키위 5kg', '과수 및 크기: 제주산 레드키위 5kg(로얄과)', '과수 및 크기: 제주산 레드키위 5kg(로얄과)'],
    ['naver 옛 이름 레몬 3kg → 그대로 [미매칭](대표 확인 10/1 "수기")', '과수 및 크기: 제주 레몬3kg(중소과)', '[미매칭] 과수 및 크기: 제주 레몬3kg(중소과)'],
    ['cafe24 하우스 (특가)소과 2.5 → 종전과 동일', '제주 감귤 상품 선택=1. (제철)고당도 하우스감귤 · (특가)하우스감귤 가정용 - 2.5kg(소과)', OLD.matchProduct('제주 감귤 상품 선택=1. (제철)고당도 하우스감귤 · (특가)하우스감귤 가정용 - 2.5kg(소과)')],
    ['cafe24 하우스 4.5 로얄 → 종전과 동일', '제주 감귤 상품 선택=1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 4.5kg(로얄과)', OLD.matchProduct('제주 감귤 상품 선택=1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 4.5kg(로얄과)')],
    ['4.5kg 안의 5kg 오인 금지(유라 4.5kg 가상 → 미매칭)', '제주 감귤 상품 선택=2. (제철)유라품종 노지감귤 · 가정용 - 4.5kg(소과 2S미만)', '[미매칭] 제주 감귤 상품 선택=2. (제철)유라품종 노지감귤 · 가정용 - 4.5kg(소과 2S미만)'],
    ['중량up 가드 유지(유라 3kg→중량up 5kg 가상)', '유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)→중량up 5kg', '유라품종 노지감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)'],
  ];
  for (const [t, raw, exp] of cases) { const got = NEW.matchProduct(raw); ok(got === exp, t, got === exp ? got : `got ${got} / exp ${exp}`); }

  console.log('\n② 무회귀 — 구코드가 매칭하던 입력은 신코드도 같은 이름(실주문 원문 + 카탈로그 전체 옵션 꼴)');
  const srcFile = process.argv[2] || 'C:\\Users\\전승범\\AppData\\Local\\Temp\\claude\\C--Users-----OneDrive------------------\\d33e0de3-46cd-475a-8d7c-005280878106\\scratchpad\\qty-res.json';
  const inputs = [];
  if (fs.existsSync(srcFile)) { const j = JSON.parse(fs.readFileSync(srcFile, 'utf8')); (j.groups || []).forEach(g => inputs.push(g.opt)); console.log('  러너 실주문 옵션 원문 ' + inputs.length + '종 포함'); }
  const mkOpt = (nm, i) => `아꼼이네 상품선택: ${1 + (i % 3)}. ${i % 2 ? '(제철)' : ''}${nm} (개수 : ${1 + (i % 4)})`;
  [...OLD.catalog].forEach((nm, i) => { inputs.push(mkOpt(nm, i)); inputs.push(nm); });
  let regress = 0, improved = 0, unchangedUnm = 0;
  for (const raw of inputs) {
    const o = OLD.matchProduct(raw), n = NEW.matchProduct(raw);
    if (!o.startsWith('[미매칭]')) { if (o !== n) { regress++; console.log('    회귀:', raw, '|', o, '→', n); } }
    else if (!n.startsWith('[미매칭]')) { improved++; console.log('    개선:', raw.slice(0, 70), '→', n); }
    else unchangedUnm++;
  }
  ok(regress === 0, `구코드 매칭 건 전부 동일(입력 ${inputs.length}건)`, `회귀 ${regress} · 개선 ${improved} · 미매칭 유지 ${unchangedUnm}`);

  console.log('\n③ 카탈로그 신규 이름 = 오늘 pricing 이름과 바이트 동일');
  const added = [...NEW.catalog].filter(n => !OLD.catalog.has(n));
  ok(added.length === 15, '신규 카탈로그 15종', added.length);
  ok(added.every(n => pricing.includes(n)), '전부 오늘 pricing에 존재', added.filter(n => !pricing.includes(n)).join(' | ') || '0 불일치');

  console.log(`\n결과: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
