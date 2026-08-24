/* #401-c 검증 — 알림 발송 이력 화면: ①dry = 「검수중」 표기(❌실패 아님) ②일시(주문) = 실제 주문일
   ③채널 배지 ④네이버 행 무회귀. 로컬 실서버(:3457)·실DB 읽기·실클릭. (풀번호 재조회는 카페24 키가 Render에만 있어
   로컬에선 마스킹 폴백 — 풀번호 실표시는 실서버에서 대표 확인) */
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
  pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
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
  await pg.waitForTimeout(6000);   // 이력 로드(네이버 재조회 포함 — 로컬은 릴레이 없어 폴백)

  const data = await pg.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')].filter(tr => tr.querySelector('td'));
    const pick = (tr) => ({ text: tr.innerText.replace(/\s+/g, ' ').slice(0, 220) });
    const c24 = rows.filter(tr => /자사몰/.test(tr.innerText));
    const cp = rows.filter(tr => /쿠팡/.test(tr.innerText));
    const naver = rows.filter(tr => !/자사몰|쿠팡|가입/.test(tr.innerText) && /알림톡|발주확인/.test(tr.innerText));
    return {
      total: rows.length, c24n: c24.length, cpn: cp.length,
      c24rows: c24.slice(0, 6).map(pick), cprow: cp.slice(0, 2).map(pick), nvrow: naver.slice(0, 2).map(pick),
    };
  });
  console.log('  [행] 전체', data.total, '· 자사몰', data.c24n, '· 쿠팡', data.cpn);
  data.c24rows.forEach(r => console.log('   c24:', r.text));
  data.cprow.forEach(r => console.log('   cp :', r.text));
  data.nvrow.forEach(r => console.log('   nv :', r.text));

  ok(data.c24n >= 3, '① 자사몰 행 노출(채널 배지)', data.c24n + '건');
  ok(data.cpn >= 1, '① 쿠팡 행 노출(채널 배지)', data.cpn + '건');
  const allNew = [...data.c24rows, ...data.cprow].map(r => r.text).join('\n');
  ok(/검수중/.test(allNew), '② dry = 「검수중」 표기', /검수중/.test(allNew) ? '있음' : '없음');
  ok(!/❌ ?실패/.test(allNew), '② 새 채널 행에 「실패」 오표기 0', /실패/.test(allNew) ? '⚠️잔존' : '없음');
  ok(/08\. ?1[89]|08\. ?2[0-3]/.test(allNew), '③ 일시 = 실제 주문일(8/18~23 백필)', (allNew.match(/08\. ?\d\d/g) || []).slice(0, 6).join(','));
  ok(!/수동 재발송/.test(allNew), '④ 새 채널 dry 행에 [수동 재발송] 버튼 없음(실패 아님)');
  const nvText = data.nvrow.map(r => r.text).join('\n');
  ok(data.nvrow.length > 0 && /알림톡/.test(nvText), '⑤ 네이버 행 무회귀(✅ 알림톡 표기)', data.nvrow.length + '건');
  ok(errs.length === 0, '⑥ pageerror 0', errs.join(' | ') || '없음');

  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + ' ' + (fail ? '❌ 실패 ' + fail : '✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
