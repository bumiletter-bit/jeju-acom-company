/* #409 검증 — 쿠팡 안심번호(050) 표기: 「번호 오류(유선)」 오표기 → 「🛡️ 안심번호」 중립 뱃지.
   로컬 실서버 3457 · 실DB · 실클릭. 네이버 행 무회귀(안심번호 뱃지 미노출·유선 오류 표기 유지) 포함. */
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
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.evaluate(([t]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' })); }, [token]);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(3500);
  await pg.click('.nav-item[data-page="inquiry"]');
  await pg.waitForTimeout(1500);
  await pg.click('#inquiry-tab-btn-notify');
  await pg.waitForTimeout(6000);

  // ① 쿠팡 채널 — 050 행 = 안심번호 뱃지·번호 노출·「번호 오류」 0
  await pg.selectOption('#notify-log-ch', 'cp');
  await pg.waitForTimeout(4000);
  const cp = await pg.evaluate(() => {
    const rows = [...document.querySelectorAll('#notify-log-list tbody tr')];
    return rows.map(tr => {
      const recv = tr.querySelector('td:nth-child(6)');
      return { txt: (recv ? recv.innerText : '').replace(/\s+/g, ' ') };
    });
  });
  console.log('   [쿠팡 수신 칸]'); cp.forEach(r => console.log('    ', r.txt));
  const with050 = cp.filter(r => /050/.test(r.txt));
  ok(cp.length > 0, '① 쿠팡 행 존재', cp.length + '행');
  ok(with050.length > 0 && with050.every(r => /안심번호/.test(r.txt)), '① 050 행 전부 「🛡️ 안심번호」 표기', with050.length + '행');
  ok(!cp.some(r => /번호 오류/.test(r.txt) && /050/.test(r.txt)), '① 050 행 「번호 오류(유선)」 오표기 0');

  // ② 네이버 채널 무회귀 — 안심번호 뱃지 미노출 + 기존 표기(정상 번호·선물하기·번호 오류) 유지
  await pg.selectOption('#notify-log-ch', 'naver');
  await pg.waitForTimeout(4500);
  const nv = await pg.evaluate(() => {
    const rows = [...document.querySelectorAll('#notify-log-list tbody tr')];
    return rows.map(tr => (tr.querySelector('td:nth-child(6)') || {}).innerText || '').map(s => s.replace(/\s+/g, ' '));
  });
  ok(nv.length > 0 && !nv.some(s => /안심번호/.test(s)), '② 네이버 행 안심번호 뱃지 미노출(무회귀)', nv.length + '행');
  ok(nv.some(s => /\d{3}-\d{3,4}-\d{4}/.test(s) || /선물하기|번호 오류/.test(s)), '② 네이버 수신 표기 정상 렌더', '');
  ok(errs.length === 0, '③ pageerror 0', errs.join(' | ') || '없음');
  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
