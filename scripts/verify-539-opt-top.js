// #539 검증: 자사몰 상세 — 상세정보를 한참 내려 보다가 [구매하기](또는 옵션 선택 탭)를 누르면 옵션 목록의 「첫 줄」이 고정 머리 바로 아래에 보이는가
//   node scripts/verify-539-opt-top.js [--live]   (기본 = 실서버 akkome.com 에 로컬 정본 index.html 을 끼워 업로드 전 확인 · --live = 실서버 그대로)
const fs = require('fs'), path = require('path');
const { chromium, devices } = require('playwright');
const LIVE = process.argv.includes('--live');
const FILE = path.join(__dirname, '..', '_참고자료', '카페24스킨백업', 'scripts', 'skin6-work-final', 'index.html');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '✅ ' : '❌ ') + t + (d ? ' — ' + d : '')); };
(async () => {
  const html = fs.readFileSync(FILE, 'utf8');
  const b = await chromium.launch();
  for (const [nm, opt] of [['폰', devices['iPhone 13']], ['PC', { viewport: { width: 1280, height: 900 } }]]) {
    const ctx = await b.newContext(opt); const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0, 120)));
    if (!LIVE) await pg.route(/^https:\/\/akkome\.com\/(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await pg.goto('https://akkome.com/?v=539' + nm + Date.now() + '#p/6400134206', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await pg.waitForSelector('.pd-dim.show', { timeout: 20000 });
    await pg.waitForTimeout(2000);
    const st = () => pg.evaluate(() => { const d = document.querySelector('.pd-dim.show'), bd = d.querySelector('.pd-body'), fx = d.querySelector('.pd-fix'), pn = d.querySelector('[data-pane-body="opt"]'), rows = [...pn.querySelectorAll('.opt-row')];
      const fb = fx.getBoundingClientRect().bottom, first = rows[0] ? rows[0].getBoundingClientRect() : null;
      return { top: bd.scrollTop, on: (d.querySelector('.pd-tab.on') || {}).textContent, paneGap: Math.round(pn.getBoundingClientRect().top - fb), firstVisible: !!first && first.top >= fb - 2 && first.bottom <= innerHeight, firstTxt: rows[0] ? rows[0].innerText.replace(/\s+/g, ' ').slice(0, 30) : '', rows: rows.length }; });
    // ① 상세정보를 펼치고 깊이 내린 뒤 [구매하기]
    await pg.evaluate(() => { const d = document.querySelector('.pd-dim.show'); const m = document.getElementById('pdDetMore'); if (m) m.click(); const bd = d.querySelector('.pd-body'); bd.scrollTop = 6000; });
    await pg.waitForTimeout(600);
    const s0 = await st();
    await pg.evaluate(() => { const d = document.querySelector('.pd-dim.show'); const btn = [...d.querySelectorAll('button')].filter(x => /구매하기/.test(x.textContent) && x.getClientRects().length).pop(); btn.click(); });
    await pg.waitForTimeout(900);
    const s1 = await st();
    ok(s0.top > 2000, nm + ' 준비: 상세를 깊이 내림', 'scrollTop ' + s0.top);
    ok(/옵션/.test(s1.on || '') && s1.firstVisible && Math.abs(s1.paneGap) <= 2, nm + ' 구매하기 → 옵션 첫 줄이 고정 머리 바로 아래', JSON.stringify(s1));
    // ② 아래로 내려 마지막 옵션까지 갈 수 있다
    const s2 = await pg.evaluate(() => { const d = document.querySelector('.pd-dim.show'), bd = d.querySelector('.pd-body'); const b0 = bd.scrollTop; bd.scrollTop = bd.scrollHeight; const rows = [...d.querySelectorAll('[data-pane-body="opt"] .opt-row')]; const r = rows[rows.length - 1].getBoundingClientRect(); return { moved: bd.scrollTop > b0, lastVisible: r.top < innerHeight }; });
    ok(s2.moved && s2.lastVisible, nm + ' 아래로 내려 마지막 옵션까지 보임', JSON.stringify(s2));
    // ③ 맨 위(갤러리)를 보던 중 옵션 탭 = 위치 그대로(끌어내리지 않음)
    await pg.evaluate(() => { const d = document.querySelector('.pd-dim.show'); d.querySelector('.pd-tab[data-pane="det"]').click(); d.querySelector('.pd-body').scrollTop = 0; });
    await pg.waitForTimeout(300);
    await pg.evaluate(() => document.querySelector('.pd-dim.show .pd-tab[data-pane="opt"]').click());
    await pg.waitForTimeout(400);
    const s3 = await st();
    ok(s3.top === 0, nm + ' 맨 위에서 옵션 탭 = 위치 그대로', 'scrollTop ' + s3.top);
    // ④ 옵션 누르기·구매 흐름 무회귀: 첫 옵션 선택 → 선택 표시
    const s4 = await pg.evaluate(() => { const d = document.querySelector('.pd-dim.show'); const r = d.querySelector('[data-pane-body="opt"] .opt-row'); r.click(); return ((window.__akmPd && window.__akmPd.picks) || []).length; });
    ok(s4 === 1, nm + ' 옵션 선택 무회귀', 'picks ' + s4);
    ok(errs.length === 0, nm + ' 페이지 오류 0', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n결과 ${pass}/${pass + fail}` + (LIVE ? ' (실서버)' : ' (로컬 정본 끼움)'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
