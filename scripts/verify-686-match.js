/* #686 검증 — 그린레몬 못난이 5kg(네이버 전용 신규 옵션 · 「제주 그린레몬 못난이5kg(랜덤과)」) 송장변환·중간발주 매칭 (2026-10-14)
   app.js 실코드를 떼어 실행(#406·#534 방법) · #686 앞 커밋 deec612~1(구코드 · #829 고정 · Windows cmd 는 ^ 를 지워 ~1 로 — HEAD 는 이미 새 코드)와 같은 입력으로 비교 — 달라지는 것은 못난이 옵션뿐이어야 한다.
   단가표는 실DB 를 읽지 않고 두 가지 가짜 목록으로 돈다(① 못난이 이름이 있는 날 ② 빠진 날). 쓰기 0 · 서버 0. */
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 220) : '')); };
function buildMatcher(src) {
    const a = src.indexOf('// 품목명 카탈로그'), b = src.indexOf('function addSizeSuffix');
    if (a < 0 || b < 0 || b <= a) throw new Error('추출 경계 실패');
    return new Function(src.slice(a, b) + '\nreturn { matchProduct, matchProductRaw, setPricing: (arr) => { aoInvoicePricingNames = arr; }, catalogHas: (n) => PRODUCT_CATALOG.has(n) };')();
}
const NEW = buildMatcher(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8'));
const OLD = buildMatcher(execSync('git show deec612~1:public/app.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const UG = '과수 및 크기: 제주 그린레몬 못난이5kg(랜덤과)';   // 네이버 옵션 글자 그대로(워커1 지도 · 품목별 금액에도 이 글자로)
const G3 = '과수 및 크기: 제주 그린레몬3kg(중소과)', G5 = '과수 및 크기: 제주 그린레몬5kg(중소과)', G10 = '과수 및 크기: 제주 그린레몬10kg(중소과)';
const BASE = [G3, G5, G10, '과수 및 크기: 제주산 레드키위 5kg(로얄과)', '고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)'];
const N = s => '제주 레몬 상품선택: ' + s;   // 네이버 레몬 페이지 주문 옵션정보 꼴(「과수 및 크기: …」 가 옵션 글자)

console.log('① 단가표에 못난이 이름이 있는 날(정상 운영) — 새 코드 = 옛 코드 = 그대로 매칭');
{
    const P = BASE.concat([UG]); NEW.setPricing(P); OLD.setPricing(P);
    for (const [label, input, want] of [['네이버 못난이 5kg', N(UG), UG], ['네이버 못난이 5kg(개수 꼬리)', N(UG) + ' (개수 : 2)', UG], ['네이버 그린레몬 3kg', N(G3), G3], ['네이버 그린레몬 5kg', N(G5), G5], ['네이버 그린레몬 10kg', N(G10), G10]]) {
        const n = NEW.matchProduct(input), o = OLD.matchProduct(input); ok(n === want && o === want, `${label} → ${want.slice(9)}`, JSON.stringify([n, o]));
    }
}
console.log('② 단가표에 못난이 이름이 빠진 날 — 옛 코드는 「5kg(중소과)」로 조용히 오매칭 · 새 코드는 [미매칭](오매칭 > 미매칭 원칙)');
{
    NEW.setPricing(BASE); OLD.setPricing(BASE);
    const n = NEW.matchProduct(N(UG)), o = OLD.matchProduct(N(UG));
    ok(o === G5, '옛 코드(deec612~1): 못난이 5kg → 그린레몬5kg(중소과) 로 오매칭(고치는 이유)', o);
    ok(typeof n === 'string' && n.startsWith('[미매칭]'), '새 코드: 못난이 5kg → [미매칭](사람이 봄)', n);
    ok(NEW.matchProductRaw(N(UG)) === UG && NEW.catalogHas(UG) && !OLD.catalogHas(UG), '새 코드 표준명 = 네이버 글자 그대로 · PRODUCT_CATALOG 에 등록(옛 코드엔 없음)', NEW.matchProductRaw(N(UG)));
    for (const [label, input, want] of [['그린레몬 3kg', N(G3), G3], ['그린레몬 5kg', N(G5), G5], ['그린레몬 10kg', N(G10), G10], ['옛 이름 레몬 못난이', N('과수 및 크기: 제주 못난이 레몬5kg(랜덤과)'), null], ['옛 이름 레몬 혼합과', N('과수 및 크기: 제주 레몬3kg(혼합과)'), null]]) {
        const n2 = NEW.matchProduct(input), o2 = OLD.matchProduct(input); ok(n2 === o2 && (want == null || n2 === want), `${label}: 새 = 옛(무회귀)`, JSON.stringify([n2, o2]));
    }
}
console.log('③ 쿠팡·자사몰 꼴은 네이버 전용이라 안 들어온다 — 들어와도 못난이가 「중소과」로 붙지 않는지만 본다');
{
    NEW.setPricing(BASE.concat([UG]));
    const cp = NEW.matchProduct('제주아꼼이네 제철 제주레몬 출하, 1박스, 그린레몬 못난이 랜덤과 5kg'); ok(cp === UG, '쿠팡 꼴(단어 순서 다름) → 규칙 파서로 못난이 표준명', cp);
    NEW.setPricing(BASE); const cp2 = NEW.matchProduct('제주아꼼이네 제철 제주레몬 출하, 1박스, 그린레몬 못난이 랜덤과 5kg'); ok(cp2.startsWith('[미매칭]'), '단가표에 없으면 쿠팡 꼴도 [미매칭]', cp2);
}
console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
