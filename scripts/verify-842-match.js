/* #842 검증 — 타이벡감귤 오픈(2026-10-25) 송장변환·중간발주 매칭 · 쿠팡 꼴 「…고당도 하우스감귤, 1박스, 타이벡 …」이 하우스로 오매칭되지 않게
   app.js 실코드를 떼어 실행(#406·#534 방법) · git HEAD(구코드)와 같은 입력으로 비교 — 달라지는 것은 「타이벡」 글자가 든 옵션뿐이어야 한다
   단가표 = 실DB 의 오늘·다음 기간 이름(#115 효돈 타이벡 6 포함) · 실자료 회귀 = 네이버 스냅샷 옵션 전부 · 카페24 옵션 글 · 쿠팡 연결표 옵션
   실DB 읽기만(SET default_transaction_read_only). 쓰기 0 · 서버 0. */
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 220) : '')); };
function buildMatcher(src) {
    const a = src.indexOf('// 품목명 카탈로그'), b = src.indexOf('function addSizeSuffix');
    if (a < 0 || b < 0 || b <= a) throw new Error('추출 경계 실패');
    return new Function(src.slice(a, b) + '\nreturn { matchProduct, matchProductRaw, setPricing: (arr) => { aoInvoicePricingNames = arr; } };')();
}
const T = n => '고당도 타이벡감귤 / 상품 및 과수: ' + n;
const H = n => '고당도 하우스감귤 / 상품 및 과수: ' + n;
const TN2 = ['가정용 - 3kg(소과 2S미만)', '가정용 - 3kg(로얄과 2S~M)', '가정용 - 5kg(로얄과 2S~M)', '가정용 - 10kg(로얄과 2S~M)', '가정용 - 5kg(중대과 L이상)', '선물용 - 3kg(로얄과 2S~M)'];
const CP = '제주아꼼이네 제철 고당도 하우스감귤, 1박스, ';   // 쿠팡 꼴(상품명 유지 · 옵션명만 타이벡)
(async () => {
    const NEW = buildMatcher(fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8'));
    const OLD = buildMatcher(execSync('git show HEAD:public/app.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
    await c.query('SET default_transaction_read_only = on');
    const pricing = (await c.query(`SELECT DISTINCT it->>'name' AS nm FROM pricing, jsonb_array_elements(items) it WHERE end_date >= (now() AT TIME ZONE 'Asia/Seoul')::date`)).rows.map(r => r.nm);
    const snap = (await c.query(`SELECT id, items FROM naver_product_snapshot ORDER BY id DESC LIMIT 1`)).rows[0];
    const cfg = async k => ((await c.query(`SELECT value FROM agent_office_config WHERE key = $1`, [k])).rows[0] || {}).value;
    const texts = await cfg('cafe24_option_texts'), cmap = await cfg('coupang_item_map');
    await c.end();
    NEW.setPricing(pricing); OLD.setPricing(pricing);
    console.log(`  단가표(오늘·다음 기간) ${pricing.length}종 · 네이버 스냅샷 #${snap.id}`);
    ok(TN2.every(n => pricing.includes(T(n))), '단가표에 타이벡 6 이름(유라 꼴) 있음');

    console.log('① 타이벡 — 네이버·자사몰·쿠팡 꼴 → 단가표 이름');
    for (const n2 of TN2) {
        const want = T(n2);
        ok(NEW.matchProduct('아꼼이네 상품선택: 2. (제철)고당도 타이벡감귤 / 상품 및 과수: ' + n2) === want, '네이버 ' + n2);
        ok(NEW.matchProduct('제주 감귤 상품 선택=2. (제철)고당도 타이벡감귤 · ' + n2) === want, '자사몰 ' + n2);
    }
    const CO = [   // 쿠팡 옵션명 후보 꼴(이름 확정 전 · 여러 꼴로)
        ['타이벡 가정용 3kg(소과)', TN2[0]], ['타이벡 가정용 3kg(로얄과)', TN2[1]], ['타이벡 가정용 5kg(로얄과)', TN2[2]],
        ['타이벡 가정용 10kg(로얄과)', TN2[3]], ['타이벡 가정용 5kg(중대과)', TN2[4]], ['타이벡 선물용 3kg(로얄과)', TN2[5]],
        ['타이벡감귤 가정용 - 3kg(소과 2S미만)', TN2[0]], ['타이벡감귤 선물용 - 3kg(로얄과 2S~M)', TN2[5]], ['타이벡감귤 가정용 - 5kg(중대과 L이상)', TN2[4]],
    ];
    for (const [o, n2] of CO) {
        const got = NEW.matchProduct(CP + o), was = OLD.matchProduct(CP + o);
        ok(got === T(n2), `쿠팡 「${o}」 → 타이벡(옛 코드 = ${String(was).slice(0, 40)})`, got);
    }
    ok(/하우스/.test(OLD.matchProduct(CP + '타이벡 선물용 3kg(로얄과)')), '(대조) 옛 코드 = 쿠팡 타이벡 선물용 → 하우스 선물용 오매칭 재현');
    { const g = NEW.matchProduct(CP + '타이벡 가정용 5kg'); ok(/^\[미매칭\]/.test(g), '등급 글자 없는 타이벡 옵션 = 로얄과로 짐작하지 않고 [미매칭]', g); }

    console.log('② 하우스 6 회귀(네이버·자사몰·쿠팡 꼴 = 옛 코드와 같음)');
    const HN = ['하우스감귤 가정용 - 2.5kg(로얄과)', '하우스감귤 가정용 - 2.5kg(소과)', '하우스감귤 가정용 - 4.5kg(소과)', '하우스감귤 선물용 - 3kg(로얄과)', '하우스감귤 가정용 - 4.5kg(로얄과)', '하우스감귤 가정용 - 4.5kg(중대과)'];
    const HC = ['가정용 2.5kg(로얄과)', '가정용 2.5kg(소과)', '가정용 4.5kg(소과)', '선물용 3kg(로얄과)', '가정용 4.5kg(로얄과)', '가정용 4.5kg(중대과)'];
    HN.forEach((n2, i) => {
        const a = '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: ' + n2, b = '제주 감귤 상품 선택=1. (제철)고당도 하우스감귤 · ' + n2, d = CP + HC[i];
        const r = [a, b, d].map(x => [NEW.matchProduct(x), OLD.matchProduct(x)]);
        ok(r.every(([x, y]) => x === y) && /하우스/.test(r[0][0]), '하우스 ' + HC[i] + ' (네이버·자사몰·쿠팡)', r.map(x => x[0]).join(' | '));
    });

    console.log('③ 실자료 전수 회귀(타이벡 글자 없는 옵션 = 옛 코드와 바이트 동일)');
    const all = [];
    for (const it of snap.items || []) for (const o of it.opts || []) all.push(o.n2 ? `아꼼이네 상품선택: ${o.n1} / 상품 및 과수: ${o.n2}` : `상품선택: ${o.n1}`);
    for (const list of Object.values((texts && texts.by) || {})) for (const x of list) all.push('상품 선택=' + x.t);
    for (const v of Object.values(cmap || {})) all.push(`${v.product_name || ''}, 1박스, ${v.item_name || ''}`);
    const plain = all.filter(s => !/타이벡/.test(s)), diff = plain.filter(s => NEW.matchProduct(s) !== OLD.matchProduct(s) || NEW.matchProductRaw(s) !== OLD.matchProductRaw(s));
    ok(plain.length > 150 && diff.length === 0, `실자료 ${plain.length}건 옛=새`, diff.slice(0, 3).join(' ‖ '));
    const tb = all.filter(s => /타이벡/.test(s)); console.log(`  (실자료 중 타이벡 글자 ${tb.length}건 — 네이버 옵션 열리기 전이면 0)`);
    tb.forEach(s => ok(/타이벡/.test(NEW.matchProduct(s)), '실자료 타이벡 → 타이벡 이름', s + ' → ' + NEW.matchProduct(s)));
    ok(NEW.matchProduct('아꼼이네 상품선택: 대용량 / 레드향 한라봉 천혜향 황금향 귤 타이벡 레몬 대용량 · 황금향 못난이 - 10kg(랜덤과)') === OLD.matchProduct('아꼼이네 상품선택: 대용량 / 레드향 한라봉 천혜향 황금향 귤 타이벡 레몬 대용량 · 황금향 못난이 - 10kg(랜덤과)'), '만감류 이름이 같이 있으면 타이벡 분기 양보(대용량 꼴)');
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e.stack); process.exit(1); });
