/* #405 검증 — 알림 발송 이력 개편: ①[플랫폼] 컬럼(네이버 포함 전 행) ②컬럼 순서/구매자 컬럼 신설
   ③발주확인·문면 컬럼 폐지(수기 필요 예외 뱃지만) ④칸별 문면 보기(주문안내/발송안내) ⑤채널 필터(단독+상태 조합)
   ⑥수동 재발송 기능 보존 ⑦체크박스·일괄바 무회귀 ⑧에러 0. 로컬 실서버(:3457)·실DB 읽기·실클릭.
   (구매자 성함 실표시는 네이버 릴레이·카페24 키가 Render에만 있어 로컬은 '-' 폴백 — 실서버에서 확인) */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
const jwt = require(PROJ + '\\node_modules\\jsonwebtoken');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

(async () => {
  const token = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1750, height: 950 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
  pg.on('dialog', d => d.dismiss().catch(() => {}));   // 검증 중 수동 발송 confirm은 전부 거부(실발송·기록 0)
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.evaluate(([t]) => {
    localStorage.setItem('jwt_token', t);
    localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }));
  }, [token]);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForTimeout(3500);
  await pg.click('.nav-item[data-page="inquiry"]');
  await pg.waitForTimeout(1500);
  await pg.click('#inquiry-tab-btn-products');
  await pg.waitForTimeout(7000);   // 이력 로드(재조회 폴백 대기)

  const grab = () => pg.evaluate(() => {
    const tbl = document.querySelector('#notify-log-list table');
    if (!tbl) return null;
    const heads = [...tbl.querySelectorAll('thead th')].map(th => th.innerText.trim());
    const rows = [...tbl.querySelectorAll('tbody tr')].map(tr => {
      const tds = [...tr.querySelectorAll('td')];
      return {
        plat: tds[1] ? tds[1].innerText.trim() : '',
        buyer: tds[3] ? tds[3].innerText.trim() : '',
        order: tds[6] ? tds[6].innerText.replace(/\s+/g, ' ') : '',
        ship: tds[7] ? tds[7].innerText.replace(/\s+/g, ' ') : '',
        nTds: tds.length,
        kDetails: tds[6] ? tds[6].querySelectorAll('details').length : 0,
        lDetails: tds[7] ? tds[7].querySelectorAll('details').length : 0,
      };
    });
    return { heads, rows };
  });

  // ① 헤더: 새 8컬럼·발주확인/문면 폐지
  let d = await grab();
  ok(!!d && d.heads.join('|').includes('플랫폼|일시(주문)|구매자|품목|수신|주문안내|발송안내'), '① 헤더 = 플랫폼·일시·구매자·품목·수신·주문안내·발송안내', d && d.heads.join('|'));
  ok(!!d && !d.heads.includes('발주확인') && !d.heads.includes('문면'), '① 발주확인·문면 컬럼 폐지', '');
  ok(!!d && d.rows.every(r => r.nTds === 8), '① 전 행 8칸 정렬', d && d.rows[0] ? d.rows[0].nTds + '칸' : '');

  // ② 플랫폼 배지 — 전 행(네이버 포함) 4종 중 하나
  const isPlat = (s) => /네이버|자사몰|쿠팡|가입/.test(s);
  ok(!!d && d.rows.length > 0 && d.rows.every(r => isPlat(r.plat)), '② 전 행 플랫폼 배지(네이버 포함)', d ? d.rows.length + '행 · 예: ' + (d.rows[0] || {}).plat : '');
  const nNaver = d ? d.rows.filter(r => /네이버/.test(r.plat)).length : 0;
  ok(nNaver > 0, '② 네이버 행 배지 표기(1페이지)', `네이버 ${nNaver}행`);   /* 자사몰 행은 오늘 네이버 654건에 밀려 1페이지 밖 — 아래 채널 필터로 검증 */

  // ③ 구매자 컬럼 렌더(로컬은 '-' 폴백 허용 — 값 존재만 확인)
  ok(!!d && d.rows.every(r => r.buyer.length > 0), '③ 구매자 칸 렌더(폴백 - 포함)', (d.rows.filter(r => r.buyer !== '-').length) + '건 실성함');

  // ④ 칸별 문면 보기 — 주문안내 details 존재 + 펼치면 템플릿 라벨·본문
  const kRows = d ? d.rows.filter(r => r.kDetails > 0).length : 0;
  ok(kRows > 0, '④ 주문안내 칸 문면 보기(details) 존재', kRows + '행');
  const openRes = await pg.evaluate(() => {
    const det = document.querySelector('#notify-log-list tbody tr td:nth-child(7) details');
    if (!det) return null;
    det.open = true;
    return { label: (det.querySelector('div') || {}).innerText || '', body: ((det.querySelector('pre') || {}).innerText || '').slice(0, 60) };
  });
  ok(!!openRes && /템플릿|가입 환영/.test(openRes.label) && openRes.body.length > 10, '④ 문면 펼침 = 템플릿 라벨 + 본문', openRes ? openRes.label + ' / ' + openRes.body.slice(0, 30) + '…' : '없음');
  const lRows = d ? d.rows.filter(r => r.lDetails > 0).length : 0;
  const shipOpen = lRows > 0 ? await pg.evaluate(() => {
    const tr = [...document.querySelectorAll('#notify-log-list tbody tr')].find(t => t.querySelector('td:nth-child(8) details'));
    const det = tr.querySelector('td:nth-child(8) details'); det.open = true;
    return { hasBtn: !!det.querySelector('button'), btnTxt: (det.querySelector('button') || {}).innerText || '' };
  }) : null;
  ok(lRows === 0 || (shipOpen && shipOpen.hasBtn && /수동 재발송/.test(shipOpen.btnTxt)), '⑥ 발송안내 문면 안 [수동 재발송] 보존', lRows ? shipOpen.btnTxt : '발송안내 행 없음(생략)');
  const kBtn = await pg.evaluate(() => {
    const det = [...document.querySelectorAll('#notify-log-list tbody tr td:nth-child(7) details')].find(dd => dd.querySelector('button'));
    return det ? (det.querySelector('button').innerText || '') : '';
  });
  ok(/수동 발송/.test(kBtn), '⑥ 발송 전 행 = 주문안내 문면 안 [발송안내 수동 발송] 보존', kBtn || '버튼 미발견');

  // ⑤ 채널 필터 — 자사몰만
  await pg.selectOption('#notify-log-ch', 'c24');
  await pg.waitForTimeout(4000);
  d = await grab();
  ok(!!d && d.rows.length > 0 && d.rows.every(r => /자사몰/.test(r.plat)), '⑤ 채널 필터 [자사몰] = 전 행 자사몰', d ? d.rows.length + '행' : '0');
  // ⑥-b 발송안내 문면 실검증 — 자사몰엔 발송안내(dry) 행이 있다(1페이지 네이버엔 없어 생략됐던 경로)
  const shipOpen2 = await pg.evaluate(() => {
    const tr = [...document.querySelectorAll('#notify-log-list tbody tr')].find(t => t.querySelector('td:nth-child(8) details'));
    if (!tr) return null;
    const det = tr.querySelector('td:nth-child(8) details'); det.open = true;
    return { label: (det.querySelector('div') || {}).innerText || '', body: ((det.querySelector('pre') || {}).innerText || '').slice(0, 40), btn: (det.querySelector('button') || {}).innerText || '' };
  });
  ok(!!shipOpen2 && /발송안내/.test(shipOpen2.label) && shipOpen2.body.length > 10 && /수동 재발송/.test(shipOpen2.btn), '⑥-b 발송안내 칸 문면 펼침 + [수동 재발송]', shipOpen2 ? shipOpen2.label.slice(0, 30) + ' / ' + shipOpen2.btn : '발송안내 행 미발견');
  // ⑤ 채널 필터 — 네이버만 (c24/cp/join 배제)
  await pg.selectOption('#notify-log-ch', 'naver');
  await pg.waitForTimeout(4000);
  d = await grab();
  ok(!!d && d.rows.length > 0 && d.rows.every(r => /네이버/.test(r.plat)), '⑤ 채널 필터 [네이버] = 전 행 네이버', d ? d.rows.length + '행' : '0');
  // ⑤ 조합: 자사몰 + 발송안내 미도래 (수기 체크 대상 찾기 시나리오) — 0건이면 빈 안내가 정상이라 API로 논리 직접 검증
  await pg.selectOption('#notify-log-ch', 'c24');
  await pg.selectOption('#notify-log-filter', 'pending');
  await pg.waitForTimeout(4000);
  d = await grab();
  const emptyMsg = await pg.evaluate(() => (document.getElementById('notify-log-list').innerText || '').includes('기록이 없습니다'));
  const uiCombo = d ? d.rows.every(r => /자사몰/.test(r.plat) && /발송 전|발송 예정/.test(r.ship)) : emptyMsg;
  const apiCombo = await pg.evaluate(async () => {
    const j = await api('/api/agent-office/notify-logs?filter=pending&ch=c24&limit=100&offset=0');
    const rows = j.rows || [];
    return { n: rows.length, allC24: rows.every(r => String(r.order_key || '').startsWith('c24:')), allPending: rows.every(r => r.l_id == null) };
  });
  ok(uiCombo && apiCombo.allC24 && apiCombo.allPending, '⑤ 조합 필터 [자사몰+발송안내 미도래] 정상', `API ${apiCombo.n}건 (전건 c24·미도래) · UI ${d ? d.rows.length + '행' : '빈 안내 문구'}`);
  const apiNaver = await pg.evaluate(async () => {
    const j = await api('/api/agent-office/notify-logs?filter=all&ch=naver&limit=100&offset=0');
    return (j.rows || []).every(r => !/^(c24|cp|join):/.test(String(r.order_key || '')));
  });
  ok(apiNaver, '⑤ API [네이버] = c24/cp/join 프리픽스 0', '');
  // 초기화 버튼 = 채널 필터도 전체 복귀
  await pg.click('#btn-notify-log-reset');
  await pg.waitForTimeout(3500);
  const chVal = await pg.evaluate(() => document.getElementById('notify-log-ch').value);
  ok(chVal === 'all', '⑤ [초기화] = 채널 필터 전체 복귀', chVal);

  // ⑦ 무회귀: 체크박스 → 일괄바 표시
  await pg.selectOption('#notify-log-filter', 'all');
  await pg.waitForTimeout(3500);
  const chk = await pg.evaluate(() => {
    const c = document.querySelector('.nlog-chk');
    if (!c) return null;
    c.click();
    const bar = document.getElementById('nlogBulkBar');
    return { shown: bar && bar.style.display !== 'none', cnt: (document.getElementById('nlogSelCnt') || {}).textContent };
  });
  ok(!!chk && chk.shown && chk.cnt === '1', '⑦ 체크박스·일괄바 무회귀', chk ? '선택 ' + chk.cnt + '건 표시' : '체크박스 없음');

  ok(errs.length === 0, '⑧ pageerror 0', errs.join(' | ') || '없음');

  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + ' ' + (fail ? '❌ 실패 ' + fail : '✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
