/* #404 — 자동수집 타이머 라벨 정리 실렌더 검증 (로컬 실서버 3457 · 실DB 읽기 전용 · JWT 우회) */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
const jwt = require(PROJ + '\\node_modules\\jsonwebtoken');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

(async () => {
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin', name: '검증' }, 'verifytest', { expiresIn: '1h' });
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.evaluate((tk) => { localStorage.setItem('jwt_token', tk); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'admin', role: 'admin', name: '검증' })); }, token);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2500);
  // 데이터관리 탭 실클릭
  await pg.evaluate(() => { const b = [...document.querySelectorAll('a,button,.menu-item,li')].find(el => /데이터관리/.test((el.textContent || '').trim())); if (b) b.click(); });
  await pg.waitForTimeout(3500);
  const probe = await pg.evaluate(() => {
    const tbl = [...document.querySelectorAll('table')].find(t => /주문 안내 알림톡|신규 주문 알림/.test(t.textContent || ''));
    if (!tbl) return null;
    const labels = [...tbl.querySelectorAll('tbody tr td:first-child')].map(td => (td.textContent || '').trim());
    return { labels, html: tbl.textContent.slice(0, 100) };
  });
  ok(!!probe, '① 타이머 표 렌더', probe ? probe.labels.length + '행' : '표 없음');
  if (probe) {
    const L = probe.labels;
    console.log('   [행 순서]'); L.forEach((x, i) => console.log('    ' + (i + 1) + '. ' + x));
    const rawKeys = L.filter(x => /^(cafe24_|coupang_|welcome_|kakao_notify|lms_guide|product_snapshot)/.test(x));
    ok(rawKeys.length === 0, '② 영어 키 노출 0', rawKeys.join(',') || '없음');
    // 채널 판정은 라벨 「시작부」로 — 본문 속 "네이버 기준" 같은 설명어에 걸리지 않게
    const iN = L.map((x, i) => /^🛒 네이버/.test(x) ? i : -1).filter(i => i >= 0);
    const iH = L.map((x, i) => /^🏠 자사몰/.test(x) ? i : -1).filter(i => i >= 0);
    const iC = L.map((x, i) => /^🛍️ 쿠팡/.test(x) ? i : -1).filter(i => i >= 0);
    ok(iN.length === 8 && iH.length === 3 && iC.length === 2, '③ 채널 행 수 (네이버8·자사몰3·쿠팡2)', `${iN.length}/${iH.length}/${iC.length}`);
    ok(Math.max(...iN) < Math.min(...iH) && Math.max(...iH) < Math.min(...iC), '④ 그룹 정렬 (네이버→자사몰→쿠팡)');
    const dryRows = L.filter(x => /자사몰 · (주문|발송) 안내|쿠팡 · (주문|발송) 안내/.test(x));
    ok(dryRows.length === 4 && dryRows.every(x => /🧪 검수중/.test(x)), '⑤ dry 채널 4행 = 「🧪 검수중」 표기', dryRows.filter(x => !/검수중/.test(x)).join(',') || 'OK');
    ok(L.some(x => /네이버 · 주문 안내 알림톡.*실발송 가동 중/.test(x)), '⑥ 네이버 알림톡 = 「🚀 실발송 가동 중」');
    ok(!L.some(x => /가입 환영|welcome/.test(x)), '⑦ welcome_notify(은퇴) 숨김');
    const ui = await pg.evaluate(() => {
      const tbl = [...document.querySelectorAll('table')].find(t => /신규 주문 알림/.test(t.textContent || ''));
      return { sw: tbl.querySelectorAll('input.ui-switch').length, save: [...tbl.querySelectorAll('button')].filter(b => /저장/.test(b.textContent)).length };
    });
    ok(ui.sw >= 13 && ui.save >= 13, '⑧ 토글·저장 버튼 무회귀', `switch ${ui.sw} · 저장 ${ui.save}`);
  }
  ok(errs.length === 0, '⑨ pageerror 0', errs.join(' | ') || '없음');
  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
