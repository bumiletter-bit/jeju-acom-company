/* #407 검증 — 문의 관리 탭 분리(알림 발송 이력·발송 휴무일·판매현황) + 새로고침 복원(문의 관리 한정)
   로컬 실서버 3457 · 실DB 읽기 · 실클릭 · reload 실검증 */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
const jwt = require(PROJ + '\\node_modules\\jsonwebtoken');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

(async () => {
  const token = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1700, height: 950 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 100)));
  pg.on('dialog', d => d.dismiss().catch(() => {}));
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.evaluate(([t]) => {
    localStorage.setItem('jwt_token', t);
    localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }));
  }, [token]);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(3500);

  // ① 문의 관리 진입 — 탭 순서·기본 활성
  await pg.click('.nav-item[data-page="inquiry"]');
  await pg.waitForTimeout(2000);
  const bar = await pg.evaluate(() => [...document.querySelectorAll('#page-inquiry .settlement-tab-bar')[0].querySelectorAll('button')].map(b => b.textContent.trim().split(' ').slice(0, 3).join(' ')));
  ok(/알림 발송/.test(bar[0]) && /발송 휴무일/.test(bar[1]) && /판매현황·가격/.test(bar[2]) && /시나리오/.test(bar[3]), '① 탭 순서 = 알림이력→휴무일→판매현황→시나리오→…', bar.join(' | '));
  const act = await pg.evaluate(() => document.querySelector('#page-inquiry .settlement-tab.active')?.id);
  ok(act === 'inquiry-tab-btn-scenario', '① 기본 활성 = 시나리오(무회귀)', act);
  ok(await pg.evaluate(() => document.querySelectorAll('#inquiry-list tr').length > 5), '① 시나리오 목록 렌더 무회귀');

  // ② 알림 발송 이력 탭
  await pg.click('#inquiry-tab-btn-notify');
  await pg.waitForTimeout(6000);
  const nt = await pg.evaluate(() => ({
    vis: document.getElementById('inquiry-tab-notify').style.display !== 'none',
    othersHidden: document.getElementById('inquiry-tab-products').style.display === 'none' && document.getElementById('inquiry-tab-holiday').style.display === 'none',
    table: !!document.querySelector('#notify-log-list table'),
    dryText: /지금은 dry-run/.test(document.getElementById('inquiry-tab-notify').textContent),
    histCard: document.getElementById('inquiry-history-card').style.display !== 'none',
  }));
  ok(nt.vis && nt.othersHidden, '② [알림 발송 이력] 탭 단독 표시', '');
  ok(nt.table, '② 이력 표 렌더', '');
  ok(!nt.dryText, '② 낡은 「지금은 dry-run」 문구 제거', '');
  ok(!nt.histCard, '② 수정 이력 카드 숨김(이 탭 이력 대상 없음 — 기존 규칙)', '');

  // ③ 발송 휴무일 탭
  await pg.click('#inquiry-tab-btn-holiday');
  await pg.waitForTimeout(2500);
  const hd = await pg.evaluate(() => ({
    vis: document.getElementById('inquiry-tab-holiday').style.display !== 'none',
    cal: (document.getElementById('ship-holiday-cal').innerHTML || '').length > 200,
    list: !!document.getElementById('ship-holiday-list'),
  }));
  ok(hd.vis && hd.cal, '③ [발송 휴무일] 탭 — 달력 렌더', '');

  // ④ 판매현황 탭 — 분리 후에도 정상, 다른 카드 미포함, 수정 이력 카드 표시
  await pg.click('#inquiry-tab-btn-products');
  await pg.waitForTimeout(3000);
  const pr = await pg.evaluate(() => ({
    table: document.querySelectorAll('#botprod-list tr').length > 5,
    noOthers: !document.getElementById('inquiry-tab-products').querySelector('#ship-holiday-cal') && !document.getElementById('inquiry-tab-products').querySelector('#notify-log-list'),
    histCard: document.getElementById('inquiry-history-card').style.display !== 'none',
    histTitle: document.querySelector('#inquiry-history-card h2')?.textContent || '',
  }));
  ok(pr.table, '④ 판매현황 표 렌더 무회귀');
  ok(pr.noOthers, '④ 판매현황 탭에 휴무일·알림 카드 잔존 0');
  ok(pr.histCard && /판매현황·가격/.test(pr.histTitle), '④ 수정 이력 카드 표시·제목 정상', pr.histTitle.slice(0, 30));

  // ⑤ 새로고침 복원 — 발송 휴무일 탭에서 reload
  await pg.click('#inquiry-tab-btn-holiday');
  await pg.waitForTimeout(1500);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(4500);
  const rs = await pg.evaluate(() => ({
    page: document.querySelector('.page.active')?.id,
    tabBtn: document.querySelector('#page-inquiry .settlement-tab.active')?.id,
    holidayVis: document.getElementById('inquiry-tab-holiday').style.display !== 'none',
    cal: (document.getElementById('ship-holiday-cal').innerHTML || '').length > 200,
  }));
  ok(rs.page === 'page-inquiry' && rs.tabBtn === 'inquiry-tab-btn-holiday' && rs.holidayVis && rs.cal, '⑤ 새로고침 = 문의 관리 + 발송 휴무일 탭 복원(달력 렌더)', rs.page + ' / ' + rs.tabBtn);

  // ⑤-b 알림 이력 탭에서도 복원
  await pg.click('#inquiry-tab-btn-notify');
  await pg.waitForTimeout(1500);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(6000);
  const rs2 = await pg.evaluate(() => ({ tabBtn: document.querySelector('#page-inquiry .settlement-tab.active')?.id, table: !!document.querySelector('#notify-log-list table') }));
  ok(rs2.tabBtn === 'inquiry-tab-btn-notify' && rs2.table, '⑤ 알림 이력 탭 복원 + 표 렌더', rs2.tabBtn);

  // ⑥ 전 메뉴 공통 복원(대표 확장 지시) — 송장변환에서 새로고침 → 송장변환으로
  await pg.click('.nav-item[data-page="invoice"]');
  await pg.waitForTimeout(1500);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(4500);
  const rs3 = await pg.evaluate(() => document.querySelector('.page.active')?.id);
  ok(rs3 === 'page-invoice', '⑥ 송장변환 새로고침 = 송장변환 복원(전 메뉴 공통)', rs3);
  // ⑥-b 메인(일정)에서 새로고침 = 메인 유지
  await pg.click('.nav-item[data-page="schedule"]');
  await pg.waitForTimeout(1200);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(4000);
  const rs4 = await pg.evaluate(() => document.querySelector('.page.active')?.id);
  ok(rs4 === 'page-schedule', '⑥ 메인 새로고침 = 메인 유지', rs4);

  ok(errs.length === 0, '⑦ pageerror 0', errs.join(' | ') || '없음');
  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
