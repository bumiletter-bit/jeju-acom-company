/* #492(대표 실물 10/1 "폰에서 옵션 목록을 내리는 터치만으로 옵션이 눌린다"): 상세 옵션 행 터치 판정 검증
   방법 = 실서버 akkome.com을 폰(iPhone 13·터치)으로 열되 index.html만 로컬 파일로 바꿔치기(page.route) → 업로드 전에 새 코드로 실측.
   CDP Input.dispatchTouchEvent로 진짜 터치 시퀀스(스크롤·탭·흔들린 탭·길게 누르기)를 보낸다.
   node scripts/verify-492-opt-touch.js [index.html 경로 | --live]   (--live = 끼워 넣기 없이 실서버 그대로 · 기본 = 정본 skin6-work-final/index.html · 옛 서버본을 주면 「스크롤=선택」 결함 재현) */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium, devices } = require(PROJ + '\\node_modules\\playwright');
const fs = require('fs');
const LIVE = process.argv.includes('--live');
const FILE = process.argv.slice(2).find(a => a !== '--live') || (PROJ + '\\_참고자료\\카페24스킨백업\\scripts\\skin6-work-final\\index.html');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
async function openOptTab(p){
  // 상세 시트의 「옵션 선택」 탭을 열어 옵션 행이 보이게 한다(기본 탭 = 상세정보)
  const t = await p.$('.pd-dim.show .pd-tab[data-pane="opt"]'); if (t) { await t.click(); await p.waitForTimeout(500); }
  await p.waitForSelector('.pd-dim.show .opt-row[data-opt-sel]', { state: 'visible', timeout: 15000 });
}
(async () => {
  const html = LIVE ? null : fs.readFileSync(FILE, 'utf8');
  const br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({ ...devices['iPhone 13'] });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  if (!LIVE) await pg.route(/^https:\/\/akkome\.com\/(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await pg.goto('https://akkome.com/?v=492t#p/6400134206', { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.pd-dim.show .opt-row[data-opt-sel]', { state: 'attached', timeout: 30000 });
  await openOptTab(pg);
  await pg.waitForTimeout(1200);
  const cdp = await ctx.newCDPSession(pg);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const state = () => pg.evaluate(() => { const b = document.querySelector('.pd-dim.show .pd-body'); return { sel: document.querySelectorAll('.pd-dim.show .opt-row.sel').length, picks: (window.__akmPd && window.__akmPd.picks || []).length, scrollTop: b ? b.scrollTop : -1 }; });
  // 하단 고정 바(pd-bar)에 가려지지 않는 행만 고른다(화면 120~520px 사이) — 실폰에서도 바 아래 행은 터치가 바로 간다
  const rowBox = async (i) => pg.evaluate((i) => { const all = document.querySelectorAll('.pd-dim.show .opt-row[data-opt-sel]'); const vis = [...all].filter(r => { const b = r.getBoundingClientRect(); return b.top > 120 && b.bottom < 520; }); const r = (vis[i] || vis[0]).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, n: all.length, vis: vis.length }; }, i);
  // 옵션 목록이 보이도록 아래로 스크롤(목록이 화면 안에 들어오게)
  await pg.evaluate(() => { const row = document.querySelector('.pd-dim.show .opt-row[data-opt-sel]'); row && row.scrollIntoView({ block: 'start' }); });
  await pg.waitForTimeout(400);
  const rb = await rowBox(1);
  ok(rb.n >= 10, '옵션 행 수(감귤 페이지 유라 포함)', rb.n);
  // ① 스크롤 제스처: 옵션 행 위에서 손가락을 내려 180px 끌어올림(여러 단계) → 선택되면 안 된다
  const s0 = await state();
  await touch('touchStart', rb.x, rb.y);
  for (let k = 1; k <= 9; k++) { await touch('touchMove', rb.x, rb.y - 20 * k); await pg.waitForTimeout(16); }
  await touch('touchEnd', 0, 0);
  await pg.waitForTimeout(500);
  const s1 = await state();
  ok(s1.scrollTop !== s0.scrollTop, '스크롤 제스처로 목록이 실제로 움직임', s0.scrollTop + ' → ' + s1.scrollTop);
  ok(s1.sel === 0 && s1.picks === 0, '스크롤 제스처 뒤 선택된 옵션 0 (결함 재현 지점)', 'sel=' + s1.sel + ' picks=' + s1.picks);
  // ② 짧은 탭(흔들림 10px) → 선택
  const rb2 = await rowBox(2);
  await touch('touchStart', rb2.x, rb2.y); await pg.waitForTimeout(60); await touch('touchMove', rb2.x + 6, rb2.y + 8); await pg.waitForTimeout(40); await touch('touchEnd', 0, 0);
  await pg.waitForTimeout(400);
  const s2 = await state();
  ok(s2.sel === 1 && s2.picks === 1, '흔들린 짧은 탭 → 옵션 1개 선택', 'sel=' + s2.sel + ' picks=' + s2.picks);
  // ③ 같은 행 다시 탭 → 해제
  await touch('touchStart', rb2.x, rb2.y); await pg.waitForTimeout(50); await touch('touchEnd', 0, 0);
  await pg.waitForTimeout(400);
  const s3 = await state();
  ok(s3.sel === 0 && s3.picks === 0, '다시 탭 → 해제', 'sel=' + s3.sel);
  // ④ 길게 누르기(600ms·이동 없음) → 선택 아님
  await touch('touchStart', rb2.x, rb2.y); await pg.waitForTimeout(600); await touch('touchEnd', 0, 0);
  await pg.waitForTimeout(400);
  const s4 = await state();
  ok(s4.sel === 0, '길게 누르기(600ms) → 선택 아님', 'sel=' + s4.sel);
  // ⑤ 탭 두 번(다른 행) → 2개 선택 · 합계 표시
  const rb3 = await rowBox(3);
  await touch('touchStart', rb2.x, rb2.y); await pg.waitForTimeout(50); await touch('touchEnd', 0, 0); await pg.waitForTimeout(250);
  await touch('touchStart', rb3.x, rb3.y); await pg.waitForTimeout(50); await touch('touchEnd', 0, 0); await pg.waitForTimeout(400);
  const s5 = await state();
  ok(s5.sel === 2 && s5.picks === 2, '다른 두 행 탭 → 2개 선택', 'sel=' + s5.sel);
  ok(errs.length === 0, '페이지 오류 0', errs.join(' | ') || '');
  await ctx.close();
  // ⑥ PC(마우스 click) 무회귀
  const ctx2 = await br.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage(); const errs2 = []; p2.on('pageerror', e => errs2.push(String(e.message).slice(0, 120)));
  if (!LIVE) await p2.route(/^https:\/\/akkome\.com\/(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await p2.goto('https://akkome.com/?v=492p#p/6400134206', { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('.pd-dim.show .opt-row[data-opt-sel]', { state: 'attached', timeout: 30000 }); await openOptTab(p2); await p2.waitForTimeout(1000);
  await p2.click('.pd-dim.show .opt-row[data-opt-sel] >> nth=1'); await p2.waitForTimeout(300);
  await p2.click('.pd-dim.show .opt-row[data-opt-sel] >> nth=4'); await p2.waitForTimeout(300);
  const pc = await p2.evaluate(() => ({ sel: document.querySelectorAll('.pd-dim.show .opt-row.sel').length, picks: (window.__akmPd.picks || []).length }));
  ok(pc.sel === 2 && pc.picks === 2, 'PC 마우스 클릭 2행 선택(무회귀)', JSON.stringify(pc));
  await p2.click('.pd-dim.show .opt-row[data-opt-sel] >> nth=1'); await p2.waitForTimeout(300);
  const pc2 = await p2.evaluate(() => document.querySelectorAll('.pd-dim.show .opt-row.sel').length);
  ok(pc2 === 1, 'PC 클릭 해제(무회귀)', pc2);
  ok(errs2.length === 0, 'PC 페이지 오류 0', errs2.join(' | ') || '');
  await br.close();
  console.log(`\n결과 ${pass}/${pass + fail}  (${LIVE ? '실서버 그대로' : FILE.includes('skin6-work-final') ? '새 코드' : '지정 파일'})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
