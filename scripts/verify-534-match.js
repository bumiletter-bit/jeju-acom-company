/* #534 검증 — 하우스감귤 「행사★하우스귤 2.5kg로얄과→중량up 4kg」 + 소과 2종 「(특가)」 떼기 (2026-10-05)
   ① 송장변환·중간발주 매칭: app.js 실코드를 떼어 실행(#406 방법) · git HEAD(구코드)와 같은 입력으로 비교 — 달라지는 것은 행사 옵션뿐이어야 한다
   ② 알림톡·발송안내 품목 연결: kakao-notify.js matchNotifyProduct(네이버) · matchNotifyProductLoose(자사몰·쿠팡)
   실DB 읽기만(오늘 단가표 · 판매현황). 쓰기 0. */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const fs = require('fs'); const { execSync } = require('child_process');
require(PROJ + '\\node_modules\\dotenv').config({ path: PROJ + '\\.env' });
const { Client } = require(PROJ + '\\node_modules\\pg');
const KN = require(PROJ + '\\kakao-notify.js');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 200) : '')); };
function buildMatcher(src) {
    const a = src.indexOf('// 품목명 카탈로그'), b = src.indexOf('function addSizeSuffix');
    if (a < 0 || b < 0 || b <= a) throw new Error('추출 경계 실패');
    return new Function(src.slice(a, b) + '\nreturn { matchProduct, matchProductRaw, setPricing: (arr) => { aoInvoicePricingNames = arr; } };')();
}
const N1 = '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: ';
const C1 = '제주 감귤 상품 선택=1. (제철)고당도 하우스감귤 · ';   // 자사몰(카페24) 꼴
const EV = '행사★하우스귤 2.5kg로얄과→중량up 4kg';
const P = n => '고당도 하우스감귤 / 상품 및 과수: ' + n;
(async () => {
    const newSrc = fs.readFileSync(PROJ + '\\public\\app.js', 'utf8');
    const oldSrc = execSync('git show HEAD:public/app.js', { cwd: PROJ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const NEW = buildMatcher(newSrc), OLD = buildMatcher(oldSrc);
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
    const pricing = (await c.query(`SELECT DISTINCT it->>'name' AS nm FROM pricing, jsonb_array_elements(items) it WHERE start_date <= (now() AT TIME ZONE 'Asia/Seoul')::date AND end_date >= (now() AT TIME ZONE 'Asia/Seoul')::date ORDER BY nm`)).rows.map(r => r.nm);
    const bots = (await c.query(`SELECT id, name, status, price, notify_message, shipping_guide FROM bot_products WHERE deleted_at IS NULL`)).rows;
    await c.end();
    console.log(`  오늘 단가표 품목 ${pricing.length}종 · 판매현황 ${bots.length}행`);
    const P4 = P('가정용 - 4kg(로얄과)');
    ok(pricing.includes(P4), '단가표에 「가정용 - 4kg(로얄과)」 등록됨(효돈 · 대표 등록)', P4);

    console.log('① 송장변환·중간발주 매칭');
    NEW.setPricing(pricing); OLD.setPricing(pricing);
    const cases = [
        ['네이버 행사 옵션', N1 + EV, P4],
        ['네이버 행사 옵션(개수 꼬리)', N1 + EV + ' (개수 : 2)', P4],
        ['자사몰 행사 옵션', C1 + EV, P4],
        ['네이버 옛 2.5kg 로얄과(변경 전 결제분)', N1 + '하우스감귤 가정용 - 2.5kg(로얄과)', P('가정용 - 2.5kg(로얄과)')],
        ['네이버 새 소과 2.5kg', N1 + '하우스감귤 가정용 - 2.5kg(소과)', P('가정용 - 2.5kg(소과)')],
        ['네이버 옛 (특가) 소과 2.5kg', N1 + '(특가)하우스감귤 가정용 - 2.5kg(소과)', P('가정용 - 2.5kg(소과)')],
        ['네이버 새 소과 4.5kg', N1 + '하우스감귤 가정용 - 4.5kg(소과)', P('가정용 - 4.5kg(소과)')],
        ['네이버 옛 (특가) 소과 4.5kg', N1 + '(특가)하우스감귤 가정용 - 4.5kg(소과)', P('가정용 - 4.5kg(소과)')],
        ['자사몰 새 소과 2.5kg', C1 + '하우스감귤 가정용 - 2.5kg(소과)', P('가정용 - 2.5kg(소과)')],
        ['자사몰 옛 (특가) 소과 4.5kg', C1 + '(특가)하우스감귤 가정용 - 4.5kg(소과)', P('가정용 - 4.5kg(소과)')],
        ['4.5kg 로얄과(무회귀)', N1 + '하우스감귤 가정용 - 4.5kg(로얄과)', P('가정용 - 4.5kg(로얄과)')],
        ['4.5kg 중대과(무회귀)', N1 + '하우스감귤 가정용 - 4.5kg(중대과)', P('가정용 - 4.5kg(중대과)')],
        ['선물용 3kg(무회귀)', N1 + '하우스감귤 선물용 - 3kg(로얄과)', P('선물용 - 3kg(로얄과)')],
    ];
    cases.forEach(([t, opt, exp]) => { const n = NEW.matchProduct(opt); ok(n === exp, t, n); });
    const evOld = OLD.matchProduct(N1 + EV);
    console.log('     (참고) 배포본(HEAD)에서 행사 옵션 = ' + evOld.slice(0, 70));
    const diff = cases.filter(([, opt]) => !opt.includes(EV)).filter(([, opt]) => OLD.matchProduct(opt) !== NEW.matchProduct(opt));
    ok(diff.length === 0, '행사 옵션 말고는 배포본과 결과 동일', diff.map(d => d[0]).join(' | ') || '차이 0');
    // 행사 옵션이 2.5kg 품목으로 잘못 붙지 않는가(오매칭 > 미매칭 원칙) — 4kg 품목을 단가표에서 뺀 상태로도 2.5kg 로 가지 않아야 한다
    NEW.setPricing(pricing.filter(n => n !== P4));
    const evNo = NEW.matchProduct(N1 + EV);
    ok(evNo.startsWith('[미매칭]'), '단가표에 4kg(로얄과)가 없으면 [미매칭](2.5kg·4.5kg 로 잘못 붙지 않음)', evNo.slice(0, 60));
    NEW.setPricing(pricing);
    // 오늘 단가표 전수: 배포본과 같은 결과(카탈로그 한 줄 추가가 다른 품목에 영향 없음)
    const mk = (nm, i) => `아꼼이네 상품선택: ${1 + (i % 3)}. ${i % 2 ? '(제철)' : ''}${nm} (개수 : ${1 + (i % 4)})`;
    const d2 = pricing.filter((nm, i) => OLD.matchProduct(mk(nm, i)) !== NEW.matchProduct(mk(nm, i)));
    ok(d2.length === 0, `오늘 단가표 전수 ${pricing.length}종 = 배포본과 동일`, d2.join(' | ') || '차이 0');
    const self = pricing.filter((nm, i) => NEW.matchProduct(mk(nm, i)) !== nm);
    ok(self.length === 0, '오늘 단가표 전수 왕복(이름 → 같은 이름)', self.join(' | ') || '전부 일치');

    console.log('② 알림톡·발송안내 품목 연결(판매현황)');
    const live = bots.filter(b => b.status === '판매중');
    const b4 = bots.find(b => b.name === P4);
    console.log('     판매현황 4kg(로얄과) 행: ' + (b4 ? `#${b4.id} · ${b4.status} · 판매가 ${b4.price || '(없음)'} · 주문 안내문 ${b4.notify_message ? '있음' : '없음'} · 발송 안내문 ${b4.shipping_guide ? '있음' : '없음'}` : '없음'));
    const nameOf = r => r ? r.name : null;
    const all = bots;   // 서버는 판매현황 전 행으로 연결한다(상태 무관) — 아래 기대값은 이름 기준
    const nv = (opt) => nameOf(KN.matchNotifyProduct(opt, all)), lz = (opt) => nameOf(KN.matchNotifyProductLoose(opt, all));
    // 행사 옵션 글자에는 「가정용 - 4kg(로얄과)」가 통째로 들어 있지 않다 → 판매현황에 옵션 글자 그대로의 연결용 행(#555 · 준비중 = 봇 미노출)을 두어 잇는다(총괄 10/5)
    const evN = nv(N1 + EV), evC = lz(C1 + EV); const alias = bots.find(b => b.name === EV);
    ok(!!alias && !!alias.shipping_guide && alias.status !== '판매중', '판매현황에 행사 옵션 연결용 행(발송 안내문 있음 · 봇 미노출)', alias ? `#${alias.id} ${alias.status}` : '없음');
    ok(evN === EV, '네이버 행사 옵션 → 연결용 행(2.5kg·다른 품목으로 잘못 붙지 않음)', evN);
    ok(evC === EV, '자사몰 행사 옵션 → 연결용 행', evC);
    ok(!!b4 && b4.status === '판매중' && /29,000/.test(String(b4.price || '')) && !!b4.shipping_guide, '판매현황 4kg(로얄과) = 판매중 · 29,000원 · 발송 안내문 있음(봇 가격 답변용)');
    const b25 = bots.find(b => b.name === P('가정용 - 2.5kg(로얄과)'));
    ok(!!b25 && b25.status !== '판매중', '판매현황 2.5kg(로얄과) = 행사 중 봇 미노출(행사 끝나면 판매중으로)', b25 && b25.status);
    const nc = [
        ['네이버 새 소과 2.5kg', N1 + '하우스감귤 가정용 - 2.5kg(소과)', P('가정용 - 2.5kg(소과)')],
        ['네이버 옛 (특가) 소과 2.5kg', N1 + '(특가)하우스감귤 가정용 - 2.5kg(소과)', P('가정용 - 2.5kg(소과)')],
        ['네이버 새 소과 4.5kg', N1 + '하우스감귤 가정용 - 4.5kg(소과)', P('가정용 - 4.5kg(소과)')],
        ['네이버 옛 (특가) 소과 4.5kg', N1 + '(특가)하우스감귤 가정용 - 4.5kg(소과)', P('가정용 - 4.5kg(소과)')],
        ['네이버 옛 2.5kg 로얄과', N1 + '하우스감귤 가정용 - 2.5kg(로얄과)', P('가정용 - 2.5kg(로얄과)')],
        ['네이버 4.5kg 로얄과', N1 + '하우스감귤 가정용 - 4.5kg(로얄과)', P('가정용 - 4.5kg(로얄과)')],
        ['네이버 선물용 3kg', N1 + '하우스감귤 선물용 - 3kg(로얄과)', P('선물용 - 3kg(로얄과)')],
    ];
    nc.forEach(([t, opt, exp]) => { const r = nv(opt); ok(r === exp, t, r); });
    [['자사몰 새 소과 2.5kg', C1 + '하우스감귤 가정용 - 2.5kg(소과)', P('가정용 - 2.5kg(소과)')], ['자사몰 새 소과 4.5kg', C1 + '하우스감귤 가정용 - 4.5kg(소과)', P('가정용 - 4.5kg(소과)')], ['자사몰 옛 2.5kg 로얄과', C1 + '하우스감귤 가정용 - 2.5kg(로얄과)', P('가정용 - 2.5kg(로얄과)')]].forEach(([t, opt, exp]) => { const r = lz(opt); ok(r === exp, t, r); });
    console.log('     판매현황 하우스감귤 행: ' + bots.filter(b => /하우스감귤/.test(b.name)).map(b => `#${b.id} ${b.name.split(': ').pop()} ${b.status} ${b.price || '-'}`).join(' ‖ '));
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });
