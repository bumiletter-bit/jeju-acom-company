/* #443 검증 — 자사몰 청귤 시즌 종료 실화면: 홈 카드 「시즌 준비중」 전환·특가/가격 소멸 · 상세 = 시즌 대기 CTA·담기 불가 · 타 상품 카드 무회귀 · 에러 0 */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 220) : '')); };
const V = 'm443' + (Date.now() % 9973);
(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
  // ① 홈 → 카테고리 화면(#c/citrus): 품절은 「지금은 시즌이 아니에요」 구분선 아래 「시즌 준비중」 카드로 이사(#107·#411 구조)
  await pg.goto(`https://akkome.com/?v=${V}home#c/citrus`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => document.querySelector('#cvGrid [data-pd]'), null, { timeout: 30000 });
  await pg.waitForTimeout(1500);
  const home = await pg.evaluate(() => {
    const cards = [...document.querySelectorAll('#cvGrid [data-pd]')];
    const cg = cards.filter(x => /청귤/.test(x.textContent || ''));
    const txt = c => c.innerText.replace(/\s+/g, ' ').trim();
    const seen = new Set(); const live = cards.filter(c => !c.classList.contains('cv-so') && !/시즌 준비중/.test(c.textContent || '')).map(c => c.getAttribute('data-pd')).filter(n => !seen.has(n) && seen.add(n));
    return { total: cards.length, cg: cg.map(c => ({ so: c.classList.contains('cv-so') || /시즌 준비중/.test(c.textContent || ''), t: txt(c).slice(0, 160) })), liveNos: live };
  });
  ok(home.cg.length > 0, '① 감귤류 카테고리 화면에 청귤 카드 존재', home.cg.length + '장');
  ok(home.cg.length > 0 && home.cg.every(c => c.so), '① 청귤 카드 전부 「시즌 준비중」 표시', JSON.stringify(home.cg));
  ok(home.cg.every(c => !/18,800|29,800|라스트특가|특가/.test(c.t)), '① 청귤 카드에 가격·특가 딱지 잔재 0');
  ok(!home.liveNos.includes('5731582511') && home.liveNos.length >= 4, '① 판매중 카드 목록에서 청귤 제외 · 타 상품 카드 유지', home.liveNos.join(','));
  const body = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  
  // ② 상세
  await pg.goto(`https://akkome.com/?v=${V}#p/5731582511`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => document.querySelector('.pd-dim.show'), null, { timeout: 30000 });
  await pg.waitForTimeout(1500);
  const pd = await pg.evaluate(() => {
    const d = document.querySelector('.pd-dim.show');
    const t = (d.innerText || '').replace(/\s+/g, ' ');
    const cta = [...d.querySelectorAll('button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const optRows = [...d.querySelectorAll('.opt-row')].map(r => ({ so: r.classList.contains('soldout'), sel: r.hasAttribute('data-opt-sel'), t: r.innerText.replace(/\s+/g, ' ').slice(0, 60) }));
    return { t: t.slice(0, 500), cta, optRows };
  });
  ok(pd.cta.some(c => /시즌 대기 신청/.test(c)), '② 상세 CTA = 「시즌 대기 신청」', pd.cta.join(' | '));
  ok(!pd.cta.some(c => /담기|구매하기|바로구매/.test(c)), '② 상세에 담기·구매 버튼 없음');
  ok(pd.optRows.every(r => r.so || !r.sel), '② 옵션 행 전부 품절 처리(선택 불가)', JSON.stringify(pd.optRows));
  ok(!/무료배송 ·/.test(pd.t) || /시즌 준비중|시즌 대기/.test(pd.t), '② 상세 상단 품절 표기', pd.t.slice(0, 160));
  // ③ 무회귀: 황금향 상세 담기 버튼 존재
  await pg.goto(`https://akkome.com/?v=${V}b#p/11126666859`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => document.querySelector('.pd-dim.show'), null, { timeout: 30000 });
  await pg.waitForTimeout(1200);
  const other = await pg.evaluate(() => { const d = document.querySelector('.pd-dim.show'); return { cta: [...d.querySelectorAll('button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean), rows: d.querySelectorAll('.opt-row:not(.soldout)').length }; });
  ok(other.rows >= 2 && !other.cta.some(c => /시즌 대기 신청/.test(c)), '③ 황금향 상세 무회귀(판매 옵션 행 ≥2 · 시즌 대기 CTA 없음)', other.rows + '행 / ' + other.cta.slice(0, 4).join(' | '));
  ok(errs.length === 0, '④ pageerror 0', errs.join(' | ') || '없음');
  console.log(`\n결과: ${pass}/${pass + fail}`);
  await br.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
