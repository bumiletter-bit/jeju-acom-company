// 자사몰 2,000원 쿠폰 손님 반영 실측(읽기 전용 — 주문 완료 안 함)
const { chromium } = require('playwright');
(async () => {
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const pg = await ctx.newPage();
  pg.on('dialog', d => { console.log('dialog:', d.message().slice(0, 120)); d.accept(); });
  await pg.goto('https://akkome.com/member/login.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(1500);
  await pg.fill('input[name="member_id"]', 'akmcl20xuz');
  await pg.fill('input[name="member_passwd"]', 'Akmtest!2026');
  await pg.evaluate(() => { const b = [...document.querySelectorAll('a.btnSubmit')].find(x => /^로그인$/.test((x.textContent || '').trim())); if (b) b.click(); });
  await pg.waitForTimeout(4000);
  console.log('after login url:', pg.url());
  // 1) 쿠폰함
  await pg.goto('https://akkome.com/myshop/coupon/coupon.html?vv=' + (Date.now() % 9973), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(3000);
  const ct = await pg.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n'));
  console.log('=== 쿠폰함 ===\n' + ct.slice(0, 1500));
  // 2) 상품 상세 — 쿠폰 다운로드 UI 존재?
  await pg.goto('https://akkome.com/?cp=' + (Date.now() % 9973) + '#p/6400134206', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => document.querySelector('.pd-dim.show'), null, { timeout: 30000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  const pd = await pg.evaluate(() => { const d = document.querySelector('.pd-dim.show'); const t = d ? d.innerText : ''; return { hasCoupon: /쿠폰/.test(t), snippet: (t.match(/.{0,40}쿠폰.{0,40}/g) || []).slice(0, 5), opts: [...document.querySelectorAll('.opt-row')].map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 60)).slice(0, 8) }; });
  console.log('=== 상세 ===', JSON.stringify(pd, null, 1));
  // 3) 소과 2.5kg 담기 (#393 동선: 구매하기 → 옵션 행 → 구매하기)
  await pg.locator('#pdOrder').tap(); await pg.waitForTimeout(1400);
  const rowLoc = pg.locator('.pd-dim .opt-row[data-opt-sel]', { hasText: '2.5kg(소과)' }).first();
  await rowLoc.tap(); await pg.waitForTimeout(700);
  await pg.locator('#pdOrder').tap();
  await pg.waitForTimeout(6000);
  const st = await pg.evaluate(() => { const l = document.querySelector('#akmOptList'); const dim = l && l.closest('[id$="Dim"], .akm-dim, .pd-dim'); return { lay: !!l, vis: !!(l && l.offsetParent), txt: l ? l.innerText.replace(/s+/g,' ').slice(0,300) : '', toast: (document.querySelector('#akmC24Toast')||{}).innerText||'' }; });
  console.log('레이어 상태:', JSON.stringify(st));
  if (st.vis) { const cand = pg.locator('#akmOptList >> text=2.5kg(소과)').first(); await cand.tap().catch(async()=>{ await pg.evaluate(()=>{ const el=[...document.querySelectorAll('#akmOptList *')].find(x=>/2.5kg(소과)/.test(x.textContent||'')&&x.children.length===0); if(el) el.click(); }); }); }
  await pg.waitForURL(/basket.html/, { timeout: 60000 }).catch(() => {});
  await pg.waitForTimeout(5000);
  console.log('url after buy:', pg.url());
  await pg.screenshot({ path: 'scripts/coupon_afterbuy.png' }).catch(()=>{});
  if (!/basket/.test(pg.url())) await pg.goto('https://akkome.com/order/basket.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(3000);
  const bk = await pg.evaluate(() => ({ items: [...document.querySelectorAll('.xans-order-list .ec-base-prdInfo, .xans-order-list tbody tr, .xans-order-list .description')].map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 90)).slice(0, 4), txt: document.body.innerText.match(/.{0,30}(쿠폰|결제예정|총 상품).{0,40}/g) }));
  console.log('=== 장바구니 ===', JSON.stringify(bk, null, 1));
  // 주문서 진입 (전체주문)
  await pg.evaluate(() => { const a = document.querySelector('#orderFixItem a[href*="order"], a.btnSubmit'); if (a) a.click(); });
  await pg.waitForTimeout(8000);
  console.log('url orderform:', pg.url());
  const of = await pg.evaluate(() => { const t = document.body.innerText.replace(/\n{2,}/g, '\n'); return { coupon: (t.match(/.{0,60}쿠폰.{0,80}/g) || []).slice(0, 12), price: (t.match(/.{0,20}(상품금액|할인|결제예정|최종 결제|총 결제).{0,40}/g) || []).slice(0, 12), couponBtn: [...document.querySelectorAll('a,button')].map(x => x.innerText.trim()).filter(x => /쿠폰/.test(x)).slice(0, 8) }; });
  console.log('=== 주문서 ===', JSON.stringify(of, null, 1));
  await pg.screenshot({ path: 'scripts/coupon_orderform.png', fullPage: true }).catch(() => {});
  await br.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
