/* #428 보충 — 결제창(주문서)까지 옵션명·금액 확인 (비회원 주문 경로 — 테스트 계정 소멸 8/24). 주문 완료 안 함 · 장바구니 비움. */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
const V = 'o428' + (Date.now() % 9973);
(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const pg = await ctx.newPage();
  pg.on('dialog', d => { console.log('    dialog:', d.message().slice(0, 80)); d.accept(); });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
  // 담기
  await pg.goto(`https://akkome.com/?v=${V}#p/11126666859`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => document.querySelector('.pd-dim.show'), null, { timeout: 30000 });
  await pg.waitForTimeout(1500);
  await pg.locator('#pdOrder').tap(); await pg.waitForTimeout(1400);
  await pg.locator('.pd-dim .opt-row[data-opt-sel]', { hasText: '5kg(중대과 13~25과)' }).first().tap(); await pg.waitForTimeout(700);
  await pg.locator('#pdOrder').tap();
  await pg.waitForURL(/basket\.html/, { timeout: 40000 }).catch(() => {});
  if (!/basket/.test(pg.url())) await pg.goto('https://akkome.com/order/basket.html?v=' + V, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(3000);
  const bk = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok(bk.includes('5kg(중대과 13~25과)') && bk.includes('62,800'), '① 장바구니 옵션명·62,800', (bk.match(/.{0,40}중대과 13~25과.{0,50}/) || [''])[0]);
  // 전체주문 → (비회원이면 로그인 페이지) → 비회원 구매
  const orderBtns = await pg.evaluate(() => [...document.querySelectorAll('a, button')].filter(x => x.offsetParent && /전체.?주문|주문하기|바로.?구매|선택.?주문/.test((x.textContent || '').trim())).map(x => (x.textContent || '').trim().slice(0, 20)));
  console.log('    주문 버튼 후보:', orderBtns.join(' / '));
  await pg.evaluate(() => { const a = [...document.querySelectorAll('a, button')].find(x => x.offsetParent && /전체.?주문|주문하기/.test((x.textContent || '').trim())); if (a) a.click(); });
  await pg.waitForTimeout(6000);
  console.log('    url1:', pg.url().slice(0, 90));
  if (/login/.test(pg.url())) {
    const guestBtns = await pg.evaluate(() => [...document.querySelectorAll('a, button, input[type=button], input[type=submit]')].filter(x => x.offsetParent).map(x => ((x.textContent || x.value || '').trim()).slice(0, 20)).filter(t => /비회원/.test(t)));
    console.log('    비회원 버튼 후보:', guestBtns.join(' / '));
    await pg.evaluate(() => { const a = [...document.querySelectorAll('a, button, input[type=button], input[type=submit]')].find(x => x.offsetParent && /비회원.?(구매|주문)/.test((x.textContent || x.value || '').trim())); if (a) a.click(); });
    await pg.waitForTimeout(7000);
    console.log('    url2:', pg.url().slice(0, 90));
  }
  const of = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const onOrder = /orderform/.test(pg.url());
  const lines = (of.match(/.{0,24}(상품금액|주문 상품|결제예정|총 결제|최종 결제|결제금액).{0,36}/g) || []).slice(0, 6);
  ok(onOrder && of.includes('중대과 13~25과') && of.includes('62,800'), '② 주문서(결제창): 옵션명 「중대과 13~25과」 · 62,800', (onOrder ? '' : '(주문서 미진입 ' + pg.url().slice(0, 70) + ') ') + lines.join(' | '));
  // 장바구니 비움
  await pg.goto('https://akkome.com/order/basket.html?v=' + V, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const chk = document.querySelector('input.allCheck, input[type="checkbox"]'); if (chk && !chk.checked) chk.click(); const a = [...document.querySelectorAll('a, button')].find(x => x.offsetParent && /전체삭제|선택삭제|삭제/.test((x.textContent || '').trim())); if (a) a.click(); });
  await pg.waitForTimeout(2500);
  ok(errs.length === 0, '③ pageerror 0', errs.join(' | ') || '없음');
  console.log(`\n결과: ${pass}/${pass + fail}`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
