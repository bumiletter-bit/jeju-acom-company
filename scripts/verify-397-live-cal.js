/* #397 검증 — 정산현황 금액 입력 시 달력 실시간 갱신 (새로고침 없이)
   로컬 실서버(:3457)·실DB 읽기·실클릭·실타이핑. 🔴 쓰기(POST/DELETE /api/settlement-status)는
   route로 전부 가로채 실DB 무변경. */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
const jwt = require(PROJ + '\\node_modules\\jsonwebtoken');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

(async () => {
  const token = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; const writes = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
  // 🔴 정산현황 쓰기 전부 가로채기 — 실DB 무변경
  await pg.route('**/api/settlement-status**', (route) => {
    const m = route.request().method();
    if (m === 'POST' || m === 'PUT' || m === 'DELETE') {
      writes.push(m + ' ' + route.request().url());
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.continue();   // GET(조회)은 실DB
  });
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.evaluate(([t]) => {
    localStorage.setItem('jwt_token', t);
    localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }));
  }, [token]);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForTimeout(3500);

  // ① 정산관리 → 정산현황 탭
  await pg.click('.nav-item[data-page="settlement"]');
  await pg.waitForTimeout(1500);
  await pg.click('.settlement-tab[data-tab="settlement-status"]');
  await pg.waitForTimeout(2500);
  const init = await pg.evaluate(() => ({
    cur: document.getElementById('ss-date-input')?.value || null,   // ssCur는 top-level let — window 미노출
    calCells: document.querySelectorAll('#ss-cal-wrap .ss-cal-cell').length,
    hasForm: !!document.querySelector('#ss-wrap .ss-ni'),
  }));
  ok(init.calCells > 20 && init.hasForm && init.cur, '① 정산현황 렌더 (달력+입력 폼)', `선택일=${init.cur} 칸=${init.calCells}`);

  // 선택된 날짜의 달력 칸 금액 읽기 헬퍼 (ssCur 날짜의 일(day) 칸)
  const readCell = () => pg.evaluate(() => {
    const cur = document.getElementById('ss-date-input')?.value || '';
    const d = parseInt(cur.split('-')[2], 10);
    const cells = [...document.querySelectorAll('#ss-cal-wrap .ss-cal-cell:not(.ss-cal-empty)')];
    const cell = cells.find(c => parseInt(c.querySelector('.ss-cal-num')?.textContent, 10) === d);
    return cell ? {
      amt: cell.querySelector('.ss-cal-amt')?.textContent ?? null,
      diff: cell.querySelector('.ss-cal-diff')?.textContent ?? null,
    } : null;
  });
  const before = await readCell();
  ok(before && before.amt != null, '② 선택일 달력 칸에 금액 표시(기준선)', JSON.stringify(before));

  // ③ 현재 잔고(current_cash) 입력칸에 실타이핑 — 리로드 없이 달력 칸이 바뀌는가
  const navBefore = await pg.evaluate(() => performance.getEntriesByType('navigation').length);
  const inp = pg.locator('#ss-wrap input.ss-ni').first();   // 첫 칸 = current_cash
  await inp.click();
  await inp.fill('');
  await inp.type('99,999,999'.replace(/,/g, ''), { delay: 30 });   // 실타이핑
  await pg.waitForTimeout(300);   // 저장 디바운스(600ms) 전 — 즉시성 판정
  const after = await readCell();
  ok(after && after.amt !== before.amt, '③ 🔴 입력 즉시 달력 금액 변경 (새로고침 없이)', `${before.amt} → ${after && after.amt}`);
  const navAfter = await pg.evaluate(() => performance.getEntriesByType('navigation').length);
  ok(navAfter === navBefore, '④ 페이지 리로드 0회', `${navBefore}→${navAfter}`);

  // ⑤ 타이핑 도중에도 갱신되는가 (키 하나 더)
  await inp.type('1', { delay: 30 });
  await pg.waitForTimeout(200);
  const after2 = await readCell();
  ok(after2 && after2.amt !== after.amt, '⑤ 키 입력마다 갱신', `${after.amt} → ${after2 && after2.amt}`);

  // ⑥ 입력 포커스 유지 (달력 재렌더가 폼 포커스를 뺏지 않는가)
  const focused = await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains('ss-ni'));
  ok(focused, '⑥ 입력칸 포커스 유지', String(focused));

  // ⑦ 전일대비(diff)도 함께 갱신됐는가 (전일 데이터가 있으면)
  if (before && before.diff != null) {
    ok(after2.diff !== before.diff, '⑦ 전일대비도 즉시 갱신', `${before.diff} → ${after2.diff}`);
  } else console.log('  ℹ️ ⑦ 선택일에 전일대비 표시 없음 — 생략');

  // ⑧ 요약 숫자(종전 기능) 무회귀 — 합계 셀도 갱신
  const tot = await pg.evaluate(() => document.getElementById('ss_sc_tot')?.textContent || null);
  ok(tot && /9[\d,]*/.test(tot), '⑧ 요약 합계 갱신 무회귀', tot);

  // ⑨ 달력 월 이동(◀▶) 무회귀
  await pg.click('#ss-cal-wrap .ss-cal-nav');   // ◀
  await pg.waitForTimeout(400);
  const title1 = await pg.evaluate(() => document.querySelector('#ss-cal-wrap .ss-cal-title')?.textContent);
  await pg.click('#ss-cal-wrap .ss-cal-nav:last-child');   // ▶
  await pg.waitForTimeout(400);
  const title2 = await pg.evaluate(() => document.querySelector('#ss-cal-wrap .ss-cal-title')?.textContent);
  ok(title1 !== title2 && !!title2, '⑨ 달력 월 이동 무회귀', `${title1} → ${title2}`);

  // ⑩ 쓰기는 전부 가로채졌는가 + 실DB 쓰기 0 확인용 출력
  console.log('  [가로챈 쓰기]', writes.length + '건 —', writes.slice(0, 3).join(' / ') || '없음');
  ok(errs.length === 0, '⑩ pageerror 0', errs.join(' | ') || '없음');

  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + ' ' + (fail ? '❌ 실패 ' + fail : '✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
