/* #428 최종 — 결제창(주문서) 최종 결제 금액 = 네이버 결제가, 상품·옵션 골고루 (비회원 구매 경로·주문 완료 안 함·매 건 장바구니 비움)
   #400/#426 유형(화면가 맞는데 결제가 다름) 재발 여부를 실결제창에서 판정. */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
const V = 'ck428' + (Date.now() % 9973);
// [상품번호, 옵션 행 찾기 문구, 주문서에 보여야 할 옵션 조각, 네이버 결제가]
const ALL = [
  ['6400134206', '2.5kg(소과)', '2.5kg(소과)', 23800],          // 특가 소과 (네이버 「(특가)」 접두 — 카페24 텍스트와 다름: 확인 레이어 경로 검증)
  ['6400134206', '2.5kg(로얄과)', '2.5kg(로얄과)', 29000],
  ['6400134206', '선물용 - 3kg(로얄과)', '선물용 - 3kg(로얄과)', 34500],   // 오늘 인하
  ['6400134206', '4.5kg(로얄과)', '4.5kg(로얄과)', 48800],               // 오늘 인하
  ['11126666859', '가정용 - 3kg', '가정용 - 3kg', 33500],
  ['11126666859', '3kg(중대과 7~15과)', '3kg(중대과 7~15과)', 42800],   // 오늘 이름 변경
  ['11126666859', '5kg(중대과 13~25과)', '5kg(중대과 13~25과)', 62800],
  ['5731582511', '5kg', '5kg', 19800],                                   // 청귤 (#400 사고 상품)
  ['5731582511', '10kg', '10kg', 31800],
  ['10801253976', '하우스감귤 선물용', '하우스감귤 선물용', 33500],      // VIP 기본가 인하
  ['10801253976', '5kg(중대과 13~25과)', '5kg(중대과 13~25과)', 60800],
  ['6400134206', '4.5kg(소과)', '4.5kg(소과)', 39800],                    // 특가 소과 4.5 (9/7 대표 카페24 이름에 (특가) 부여 후 자동 담기 검증)
];
// 인자로 케이스 인덱스 지정 가능: node verify-428-checkout.js 0,7,8,9,10
const CASES = process.argv[2] ? process.argv[2].split(',').map(i => ALL[Number(i)]).filter(Boolean) : ALL;
(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const pg = await ctx.newPage();
  pg.on('dialog', d => d.accept());
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
  const clearBasket = async () => {
    await pg.waitForTimeout(1500);   // 직전 페이지의 자체 이동(basket 리다이렉트)과 경합 방지
    await pg.goto('https://akkome.com/order/basket.html?v=' + V + Math.random(), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await pg.waitForTimeout(2500);
    for (let k = 0; k < 4; k++) {
      const left = await pg.evaluate(() => document.querySelectorAll('.xans-order-list tbody tr, .xans-order-list .ec-base-prdInfo').length);
      if (!left) break;
      await pg.evaluate(() => { const chk = document.querySelector('input.allCheck, input[type="checkbox"]'); if (chk && !chk.checked) chk.click(); const a = [...document.querySelectorAll('a, button')].find(x => x.offsetParent && /전체삭제|선택삭제|삭제/.test((x.textContent || '').trim())); if (a) a.click(); });
      await pg.waitForTimeout(2000);
    }
  };
  await clearBasket();
  for (const [no, has, frag, want] of CASES) {
    try {
      await pg.goto(`https://akkome.com/?v=${V}${no}#p/${no}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pg.waitForFunction(() => document.querySelector('.pd-dim.show'), null, { timeout: 30000 });
      await pg.waitForTimeout(1500);
      await pg.locator('#pdOrder').tap(); await pg.waitForTimeout(1400);
      const row = has ? pg.locator('.pd-dim .opt-row[data-opt-sel]', { hasText: has }).first() : pg.locator('.pd-dim .opt-row[data-opt-sel]').first();
      const rowInfo = await row.evaluate(el => ({ t: (el.getAttribute('data-opt-text') || '').slice(-40), price: parseInt(el.getAttribute('data-opt-price'), 10) }));
      await row.tap(); await pg.waitForTimeout(700);
      await pg.locator('#pdOrder').tap();
      await pg.waitForTimeout(5000);
      const layer = await pg.evaluate(() => { const l = document.querySelector('#akmOptList'); return !!(l && l.offsetParent); });
      if (layer) {   // 확인 레이어(카페24 옵션 목록) — 손님이 고르는 경로 재현: 같은 옵션 후보 탭
        const cands = await pg.evaluate(() => [...document.querySelectorAll('#akmOptList *')].filter(x => x.children.length === 0).map(x => (x.textContent || '').trim()).filter(Boolean).slice(0, 12));
        console.log('    확인 레이어 후보:', cands.join(' / ').slice(0, 300));
        await pg.evaluate((h) => { const el = [...document.querySelectorAll('#akmOptList *')].find(x => x.children.length === 0 && (x.textContent || '').includes(h)); if (el) el.click(); }, has);
        await pg.waitForTimeout(5000);
      }
      await pg.waitForURL(/basket\.html/, { timeout: 30000 }).catch(() => {});
      if (!/basket/.test(pg.url())) await pg.goto('https://akkome.com/order/basket.html?v=' + V, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pg.waitForTimeout(2500);
      await pg.evaluate(() => { const a = [...document.querySelectorAll('a, button')].find(x => x.offsetParent && /전체.?상품.?주문|전체.?주문|주문하기/.test((x.textContent || '').trim())); if (a) a.click(); });
      await pg.waitForTimeout(5000);
      if (/login/.test(pg.url())) {
        await pg.evaluate(() => { const a = [...document.querySelectorAll('a, button, input[type=button], input[type=submit]')].find(x => x.offsetParent && /비회원.?구매/.test((x.textContent || x.value || '').trim())); if (a) a.click(); });
        await pg.waitForTimeout(6000);
      }
      const of = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      const final = (of.match(/최종 결제 금액\s*([\d,]+)원/) || [])[1];
      const finalN = final ? Number(final.replace(/,/g, '')) : NaN;
      const expect = want != null ? want : rowInfo.price;
      const onOrder = /orderform/.test(pg.url());
      ok(onOrder && !layer && finalN === expect && (!frag || of.includes(frag)), `${no.slice(-4)} ${rowInfo.t} → 결제창 최종 ${final || '?'}원 (네이버/화면 ${expect.toLocaleString()})`, (layer ? '확인창 노출 ' : '') + (onOrder ? '' : '주문서 미진입 ' + pg.url().slice(0, 50)));
    } catch (e) { ok(false, `${no.slice(-4)} ${has} 예외`, e.message.slice(0, 80)); }
    await clearBasket();
  }
  ok(errs.length === 0, 'pageerror 0', errs.join(' | ') || '없음');
  console.log(`\n결과: ${pass}/${pass + fail}`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
