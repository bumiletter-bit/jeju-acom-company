/* #399 검증 — 자사몰 상세페이지 20종 새 스냅샷 교체 (실서비스 akkome.com 실렌더)
   핵심: 청귤 상세정보에 「사전예약」 잔존 0 + 새 문구 · 황금향 등 실렌더 · 홈/구매 동선 무회귀 */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));

  const openDetail = async (no) => {
    await pg.goto(`https://akkome.com/?v=399${no}#p/${no}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await pg.waitForFunction(() => document.querySelector('.pd-dim.show'), null, { timeout: 20000 });
    await pg.waitForTimeout(1200);
  };
  const detailInfo = () => pg.evaluate(() => {
    // 상세정보 탭 클릭 후 본문 텍스트·블록 수.
    // 🔴 「사전예약」 검사는 리뷰 영역(.pd-rev-card — 과거 구매 옵션 실이력, #392 의도 보존) 제외하고
    //    우리가 교체한 상세 블록·안내 텍스트에서만 센다 (1차 검증이 리뷰까지 세어 거짓 실패 21회).
    const tabs = [...document.querySelectorAll('.pd-dim.show button, .pd-dim.show [role="tab"], .pd-dim.show .pd-tab')];
    const t = tabs.find(x => /상세정보/.test(x.textContent || ''));
    if (t) t.click();
    return new Promise(r => setTimeout(() => {
      const dim = document.querySelector('.pd-dim.show');
      const txt = dim ? dim.innerText : '';
      let preNonRev = 0;
      if (dim) {
        const walker = document.createTreeWalker(dim, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          if (!/사전예약/.test(n.textContent)) continue;
          if (n.parentElement && n.parentElement.closest('.pd-rev-card, [class*="rev"]')) continue;
          preNonRev += (n.textContent.match(/사전예약/g) || []).length;
        }
      }
      const imgs = dim ? dim.querySelectorAll('.pd-det img, [class*="det"] img').length : 0;
      r({ len: txt.length, pre: preNonRev, imgs });
    }, 900));
  });

  // ① 청귤 상세 — 사전예약 잔존 0 + 새 상세 렌더
  await openDetail('5731582511');
  const cg = await detailInfo();
  ok(cg.pre === 0, '① 청귤 상세정보 「사전예약」 잔존 0', `발견 ${cg.pre}회 · 본문 ${cg.len}자`);
  ok(cg.len > 300 && cg.imgs > 5, '② 청귤 상세 실렌더(텍스트+이미지)', `${cg.len}자 · img ${cg.imgs}장`);

  // ③ 황금향 상세 실렌더 (내용 실변경 15종 대표)
  await openDetail('11126666859');
  const hg = await detailInfo();
  ok(hg.len > 300 && hg.imgs > 5, '③ 황금향 상세 실렌더', `${hg.len}자 · img ${hg.imgs}장`);

  // ④ 감귤(블록 52→53) 상세 실렌더
  await openDetail('6400134206');
  const gg = await detailInfo();
  ok(gg.len > 300 && gg.imgs > 5, '④ 감귤 상세 실렌더', `${gg.len}자 · img ${gg.imgs}장`);

  // ⑤ 홈 화면 「사전예약」 — 리뷰 카드(실구매 이력·#392 의도 보존) 제외하고 0이어야 함
  await pg.goto('https://akkome.com/?v=399home', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await pg.waitForTimeout(3500);
  const home = await pg.evaluate(() => {
    let pre = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!/사전예약/.test(n.textContent)) continue;
      const pe = n.parentElement;
      if (pe && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(pe.tagName)) continue;   // 코드 텍스트 = 화면 미노출
      if (pe && pe.closest('[class*="rev"], [class*="rv"]')) continue;
      pre += (n.textContent.match(/사전예약/g) || []).length;
    }
    return { pre, cards: document.querySelectorAll('[data-pd]').length };
  });
  ok(home.pre === 0, '⑤ 홈 노출 텍스트 「사전예약」 0 (리뷰 실이력 제외)', String(home.pre));
  ok(home.cards >= 10, '⑥ 홈 상품 카드 무회귀', home.cards + '개');

  // ⑦ 구매 동선 무회귀 — 청귤 옵션 탭 열림·옵션 행 존재
  await openDetail('5731582511');
  const opt = await pg.evaluate(() => new Promise(r => {
    const tabs = [...document.querySelectorAll('.pd-dim.show button, .pd-dim.show .pd-tab')];
    const t = tabs.find(x => /옵션 선택/.test(x.textContent || ''));
    if (t) t.click();
    setTimeout(() => r({ rows: document.querySelectorAll('.pd-dim.show .opt-row').length,
      cta: !!document.getElementById('pdOrder') }), 800);
  }));
  ok(opt.rows >= 2 && opt.cta, '⑦ 옵션 행·구매하기 무회귀', `옵션 ${opt.rows}행 · 구매하기 ${opt.cta}`);

  ok(errs.length === 0, '⑧ pageerror 0', errs.join(' | ') || '없음');
  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + ' ' + (fail ? '❌ 실패 ' + fail : '✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
