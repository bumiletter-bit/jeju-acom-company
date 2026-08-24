/* #406 실렌더 스모크 — app.js 수정 후 렌더러 생존·송장변환 화면·품목 카탈로그 표시 (로컬 실서버 3457) */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
const jwt = require(PROJ + '\\node_modules\\jsonwebtoken');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
(async () => {
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin', name: '검증' }, 'verifytest', { expiresIn: '1h' });
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 110)));
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.evaluate((tk) => { localStorage.setItem('jwt_token', tk); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'admin', role: 'admin', name: '검증' })); }, token);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(3000);
  ok(await pg.evaluate(() => !!document.querySelector('.nav-item')), '① 렌더러 생존(메뉴 렌더)');
  await pg.evaluate(() => { const b = [...document.querySelectorAll('a,button,.menu-item,li,.nav-item')].find(el => /송장변환/.test((el.textContent || '').trim())); if (b) b.click(); });
  await pg.waitForTimeout(3500);
  const cat = await pg.evaluate(() => {
    const box = document.getElementById('invoice-catalog-list');
    return box ? { n: box.querySelectorAll('div[style*="background"]').length, has5: /황금향 못난이 - 5kg/.test(box.textContent), has10: /황금향 못난이 - 10kg/.test(box.textContent) } : null;
  });
  ok(!!cat && cat.n >= 20, '② 현재 판매 품목 카탈로그 렌더', cat ? cat.n + '항목' : '없음');
  ok(!!cat && cat.has5 && cat.has10, '② 황금향 못난이 5·10kg 카탈로그 노출', '');
  const mp = await pg.evaluate(() => matchProduct('아꼼이네 상품선택: 2. (제철)과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 5kg(랜덤과)'));
  ok(mp === '과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 5kg(랜덤과)', '③ 실화면 matchProduct = 못난이 5kg', mp);
  ok(errs.length === 0, '④ pageerror 0', errs.join(' | ') || '없음');
  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
