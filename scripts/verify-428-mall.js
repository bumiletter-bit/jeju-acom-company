/* #428 검증 — 자사몰(akkome.com) 실화면: 옵션 표기(중대과)·가격·상세 잔재·장바구니/주문서 결제가 (2026-09-07)
   대표 요청: "주문자 입장에서 노출이름이 맞는지랑 가격 결제창까지 갔을 때도 맞는지". 주문 완료는 하지 않음(장바구니 → 주문서 확인 후 장바구니 비움). */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
const V = 'a428' + (Date.now() % 9973);

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
  pg.on('dialog', d => { console.log('    dialog:', d.message().slice(0, 100)); d.accept(); });

  const openDetail = async (no) => {
    await pg.goto(`https://akkome.com/?v=${V}${no}#p/${no}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForFunction(() => document.querySelector('.pd-dim.show'), null, { timeout: 30000 });
    await pg.waitForTimeout(1500);
  };
  const optRows = async () => {
    await pg.evaluate(() => new Promise(r => { const t = [...document.querySelectorAll('.pd-dim.show button, .pd-dim.show .pd-tab')].find(x => /옵션 선택/.test(x.textContent || '')); if (t) t.click(); setTimeout(r, 700); }));
    return pg.evaluate(() => [...document.querySelectorAll('.pd-dim.show .opt-row')].map(x => ({ t: x.innerText.replace(/\s+/g, ' ').trim(), key: x.getAttribute('data-opt-text') || '', price: x.getAttribute('data-opt-price') || '' })));
  };
  const detailText = async () => {
    await pg.evaluate(() => new Promise(r => { const t = [...document.querySelectorAll('.pd-dim.show button, .pd-dim.show .pd-tab')].find(x => /상세정보/.test(x.textContent || '')); if (t) t.click(); setTimeout(r, 900); }));
    return pg.evaluate(() => {
      const dim = document.querySelector('.pd-dim.show'); let s = '';
      const w = document.createTreeWalker(dim, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const pe = n.parentElement; if (!pe || /^(SCRIPT|STYLE)$/.test(pe.tagName) || pe.closest('.pd-rev-card, [class*="rev"]')) continue; s += n.textContent + '\n'; }
      return s;
    });
  };
  const cnt = (s, re) => (s.match(re) || []).length;

  // ① 황금향(c94) 옵션 표기·가격
  await openDetail('11126666859');
  let rows = await optRows();
  const r3 = rows.find(r => /3kg\(중대과 7~15과\)/.test(r.key)), r5 = rows.find(r => /5kg\(중대과 13~25과\)/.test(r.key));
  ok(!!r3 && r3.price === '42800', '① 황금향 선물 3kg 표기 「중대과 7~15과」 · 42,800', r3 && r3.t.slice(0, 70));
  ok(!!r5 && r5.price === '62800', '① 황금향 선물 5kg 표기 「중대과 13~25과」 · 62,800', r5 && r5.t.slice(0, 70));
  ok(!rows.some(r => /23과|\(대과/.test(r.key)), '① 황금향 옵션에 「23과」·「(대과」 잔재 0', rows.length + '행');
  ok(r5 && r5.key === '1. (제철)과즙팡팡 황금향 · 황금향 선물용 - 5kg(중대과 13~25과)', '① 담기 대조 문자열 = 카페24 옵션 텍스트와 동일', r5 && r5.key);
  let dt = await detailText();
  ok(cnt(dt, /23과/g) === 0 && cnt(dt, /중대과/g) >= 1, '① 황금향 상세정보: 「23과」 0 · 「중대과」 있음', `23과 ${cnt(dt, /23과/g)} · 중대과 ${cnt(dt, /중대과/g)} · ${dt.length}자`);

  // ② 타이벡 하우스감귤(c92) — 귤 단가 2종 + 황금향 선물 3kg 중대과
  await openDetail('6400134206');
  rows = await optRows();
  const g3 = rows.find(r => /선물용 - 3kg\(로얄과\)/.test(r.key)), g45 = rows.find(r => /4\.5kg\(로얄과\)/.test(r.key)), h3 = rows.find(r => /황금향 선물용 - 3kg/.test(r.key));
  ok(!!g3 && g3.price === '34500', '② 감귤 선물용 3kg(로얄과) 34,500(인하 반영)', g3 && g3.price);
  ok(!!g45 && g45.price === '48800', '② 감귤 가정용 4.5kg(로얄과) 48,800(인하 반영)', g45 && g45.price);
  ok(!!h3 && /중대과 7~15과/.test(h3.key) && h3.price === '42800', '② c92 안 황금향 선물 3kg 「중대과」 · 42,800', h3 && h3.key.slice(-30));
  ok(!rows.some(r => /23과|\(대과/.test(r.key)), '② c92 옵션 잔재 0', rows.length + '행');
  dt = await detailText();
  ok(cnt(dt, /23과/g) === 0, '② 감귤 상세정보 「23과」 0', `${dt.length}자`);

  // ③ VIP 세트(c100)
  await openDetail('10801253976');
  rows = await optRows();
  const v5 = rows.find(r => /5kg\(중대과 13~25과\)/.test(r.key)), v3 = rows.find(r => /3kg\(중대과 7~15과\)/.test(r.key)), vg = rows.find(r => /하우스감귤 선물용/.test(r.key));
  ok(!!v5 && v5.price === '60800' && v5.key.startsWith('1. 과즙팡팡 황금향 · '), '③ VIP 황금향 5kg 「중대과 13~25과」 60,800 · 담기 문자열 = 카페24(1. 과즙팡팡 황금향)', v5 && v5.key);
  ok(!!v3 && v3.price === '41800', '③ VIP 황금향 3kg 41,800', v3 && v3.price);
  ok(!!vg && vg.price === '33500', '③ VIP 하우스감귤 선물 3kg 33,500(인하 반영)', vg && vg.price);
  ok(!!v5 && /2\. 과즙팡팡 황금향/.test(v5.t), '③ VIP 화면 표기(nd) = 네이버 현재 「2. 과즙팡팡 황금향」', v5 && v5.t.slice(0, 60));
  dt = await detailText();
  ok(cnt(dt, /23과/g) === 0 && cnt(dt, /중대과/g) >= 1, '③ VIP 상세정보 「23과」 0 · 중대과 있음', `중대과 ${cnt(dt, /중대과/g)}`);

  // ④ 홈 노출 텍스트 「23과」 0 (리뷰 실이력·코드 제외) + 카드 무회귀
  await pg.goto(`https://akkome.com/?v=${V}home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(3500);
  const home = await pg.evaluate(() => { let n23 = 0; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const pe = n.parentElement; if (!pe || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(pe.tagName) || pe.closest('[class*="rev"], [class*="rv"]')) continue; n23 += (n.textContent.match(/23과/g) || []).length; }
    return { n23, cards: document.querySelectorAll('[data-pd]').length }; });
  ok(home.n23 === 0, '④ 홈 노출 텍스트 「23과」 0', String(home.n23));
  ok(home.cards >= 10, '④ 홈 상품 카드 무회귀', home.cards + '개');

  // ⑤ 장바구니 → 주문서 (테스트 계정 로그인 — 실주문 안 함)
  await pg.goto('https://akkome.com/member/login.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(1500);
  let logged = false;
  try {
    await pg.fill('input[name="member_id"]', 'akmcl20xuz');
    await pg.fill('input[name="member_passwd"]', 'Akmtest!2026');
    await pg.evaluate(() => { const b = [...document.querySelectorAll('a.btnSubmit')].find(x => /^로그인$/.test((x.textContent || '').trim())); if (b) b.click(); });
    await pg.waitForTimeout(4000);
    logged = !/login\.html/.test(pg.url());
  } catch (e) { console.log('    로그인 시도 실패:', e.message.slice(0, 80)); }
  console.log('    로그인:', logged ? 'ok' : '실패(비회원 장바구니로 진행)', pg.url());
  // 장바구니 비우기(사전)
  const clearBasket = async () => {
    await pg.goto('https://akkome.com/order/basket.html?v=' + V, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForTimeout(2500);
    for (let k = 0; k < 6; k++) {
      const had = await pg.evaluate(() => { const a = [...document.querySelectorAll('a, button')].find(x => /전체삭제|선택삭제|삭제/.test((x.textContent || '').trim()) && x.offsetParent); if (!a) return false; const chk = document.querySelector('input[name="basket_product_normal_type_normal"], input.allCheck, input[type="checkbox"]'); if (chk && !chk.checked) chk.click(); a.click(); return true; });
      await pg.waitForTimeout(2000);
      const left = await pg.evaluate(() => document.querySelectorAll('.xans-order-list tbody tr, .xans-order-list .ec-base-prdInfo').length);
      if (!had || left === 0) break;
    }
  };
  await clearBasket();
  const addAndCheck = async (no, hasText, expectKeyFrag, expectPay) => {
    await openDetail(no);
    await pg.locator('#pdOrder').tap(); await pg.waitForTimeout(1400);
    await pg.locator('.pd-dim .opt-row[data-opt-sel]', { hasText }).first().tap(); await pg.waitForTimeout(700);
    await pg.locator('#pdOrder').tap();
    await pg.waitForTimeout(6000);
    const st = await pg.evaluate(() => { const l = document.querySelector('#akmOptList'); return { lay: !!l, vis: !!(l && l.offsetParent), txt: l ? l.innerText.replace(/\s+/g, ' ').slice(0, 200) : '' }; });
    if (st.vis) console.log('    ⚠️ 확인 레이어 노출(자동 담기 실패):', st.txt);
    await pg.waitForURL(/basket\.html/, { timeout: 30000 }).catch(() => {});
    if (!/basket/.test(pg.url())) await pg.goto('https://akkome.com/order/basket.html?v=' + V, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForTimeout(3000);
    const bk = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    return { layer: st.vis, hasOpt: bk.includes(expectKeyFrag), hasPay: bk.includes(expectPay), snip: (bk.match(new RegExp('.{0,50}' + expectKeyFrag.replace(/[()]/g, '\\$&') + '.{0,60}')) || [''])[0] };
  };
  // 황금향 5kg (c94)
  const b1 = await addAndCheck('11126666859', '5kg(중대과 13~25과)', '5kg(중대과 13~25과)', '62,800');
  ok(!b1.layer && b1.hasOpt && b1.hasPay, '⑤ 장바구니: 황금향 선물 5kg 옵션명 「중대과 13~25과」 · 62,800 (자동 담기)', b1.snip.slice(0, 120));
  // 주문서 결제가
  await pg.evaluate(() => { const a = document.querySelector('#orderFixItem a[href*="order"], a.btnSubmit'); if (a) a.click(); });
  await pg.waitForTimeout(8000);
  const of = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const onOrder = /orderform|order\/order/.test(pg.url());
  ok(onOrder && of.includes('중대과 13~25과') && of.includes('62,800'), '⑤ 주문서: 옵션명 중대과 13~25과 · 62,800 표기', (onOrder ? '' : '(주문서 미진입 ' + pg.url().slice(0, 60) + ') ') + ((of.match(/.{0,20}(상품금액|결제예정|총 결제|최종 결제).{0,30}/g) || []).slice(0, 4).join(' | ')));
  await clearBasket();
  // VIP 황금향 5kg (n1 번호 차이 — 찾는 글자 분리 검증)
  const b2 = await addAndCheck('10801253976', '5kg(중대과 13~25과)', '5kg(중대과 13~25과)', '60,800');
  ok(!b2.layer && b2.hasOpt && b2.hasPay, '⑥ 장바구니: VIP 황금향 5kg 「중대과 13~25과」 · 60,800 (n1 번호 차이에도 자동 담기)', b2.snip.slice(0, 120));
  await clearBasket();
  // 감귤 선물 3kg 로얄과 (인하가)
  const b3 = await addAndCheck('6400134206', '선물용 - 3kg(로얄과)', '선물용 - 3kg(로얄과)', '34,500');
  ok(!b3.layer && b3.hasOpt && b3.hasPay, '⑦ 장바구니: 감귤 선물 3kg(로얄과) 34,500 인하가 반영', b3.snip.slice(0, 120));
  await clearBasket();
  ok(errs.length === 0, '⑧ pageerror 0', errs.join(' | ') || '없음');

  console.log(`\n결과: ${pass}/${pass + fail}`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
