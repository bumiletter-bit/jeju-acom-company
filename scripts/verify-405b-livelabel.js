/* #405 후속 — live 전환 후 타이머 라벨 동적 전환 검증 (로컬 실서버 3457 · 실DB 읽기 전용 · JWT 우회)
   기대: 자사몰·쿠팡 4행 = 「🚀 실발송 가동 중」(검수중 소멸) · 네이버 라벨 무회귀 · welcome 숨김 유지 */
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
  await pg.evaluate(() => { const b = [...document.querySelectorAll('a,button,.menu-item,li')].find(el => /데이터관리/.test((el.textContent || '').trim())); if (b) b.click(); });
  await pg.waitForTimeout(3500);
  const probe = await pg.evaluate(() => {
    const tbl = [...document.querySelectorAll('table')].find(t => /주문 안내 알림톡|신규 주문 알림/.test(t.textContent || ''));
    if (!tbl) return null;
    return { labels: [...tbl.querySelectorAll('tbody tr td:first-child')].map(td => (td.textContent || '').trim()) };
  });
  ok(!!probe, '① 타이머 표 렌더', probe ? probe.labels.length + '행' : '표 없음');
  if (probe) {
    const L = probe.labels;
    console.log('   [행 순서]'); L.forEach((x, i) => console.log('    ' + (i + 1) + '. ' + x));
    const newCh = L.filter(x => /^(🏠 자사몰|🛍️ 쿠팡) · (주문|발송) 안내/.test(x));
    ok(newCh.length === 4, '② 자사몰·쿠팡 안내 4행 존재', newCh.length + '행');
    ok(newCh.every(x => /실발송 가동 중/.test(x)), '③ 4행 전부 「🚀 실발송 가동 중」', newCh.filter(x => !/실발송 가동 중/.test(x)).join(' | ') || 'OK');
    ok(!newCh.some(x => /검수중/.test(x)), '④ 「검수중」 표기 소멸', '');
    ok(L.some(x => /^🛒 네이버 · 주문 안내 알림톡.*실발송 가동 중/.test(x)), '⑤ 네이버 라벨 무회귀');
    ok(!L.some(x => /가입 환영|welcome/.test(x)), '⑥ welcome(가입·dry 유지) 숨김 그대로');
  }
  ok(errs.length === 0, '⑦ pageerror 0', errs.join(' | ') || '없음');
  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
