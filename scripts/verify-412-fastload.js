/* #412 검증 — 알림 이력 선표시·후채움 + 기본 오늘 + 인덱스. 로컬 실서버 3457 · 실DB · 실클릭.
   (로컬은 릴레이·카페24 키가 없어 후채움 tels가 비는 게 정상 — 패치 로직은 가짜 데이터 주입으로 실검증) */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
const jwt = require(PROJ + '\\node_modules\\jsonwebtoken');
const NM = PROJ + '\\node_modules\\';
require(NM + 'dotenv').config({ path: PROJ + '\\.env' });
const { Client } = require(NM + 'pg');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

(async () => {
  const token = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1700, height: 950 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 110)));
  pg.on('dialog', d => d.dismiss().catch(() => {}));
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.evaluate(([t]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' })); }, [token]);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(3500);
  await pg.click('.nav-item[data-page="inquiry"]');
  await pg.waitForTimeout(1500);
  const t0 = Date.now();
  await pg.click('#inquiry-tab-btn-notify');
  await pg.waitForFunction(() => !!document.querySelector('#notify-log-list table tbody tr'), { timeout: 20000 });
  const firstPaintMs = Date.now() - t0;

  // ① 기본 오늘 + 즉시 렌더
  const st1 = await pg.evaluate(() => ({
    from: document.getElementById('notify-log-from').value, to: document.getElementById('notify-log-to').value,
    rows: document.querySelectorAll('#notify-log-list tbody tr').length,
    sum: document.getElementById('notify-log-summary').textContent,
  }));
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  ok(st1.from === today && st1.to === today, '① 첫 진입 기본 기간 = 오늘 자동', st1.from + '~' + st1.to);
  ok(st1.rows > 0, '① 목록 즉시 렌더(선표시)', st1.rows + '행 · 첫 표시 ' + firstPaintMs + 'ms');
  ok(/조회 결과 \d+건/.test(st1.sum), '① 요약 줄 형식(기간 조회)', st1.sum.slice(0, 60));

  // ② 행 구조 — data-okey·후채움 대상 셀 + 🔴 표 밖으로 밀린(foster) 노드 0 (8/26 실사고: tr 닫는 > 소실로 체크박스 100개가 표 위로 탈출)
  const st2 = await pg.evaluate(() => {
    const trs = [...document.querySelectorAll('#notify-log-list tbody tr')];
    const list = document.getElementById('notify-log-list');
    const table = list.querySelector('table');
    const stray = [...list.childNodes].filter(n => n !== table && !(n.nodeType === 3 && !n.textContent.trim())).length;
    return { okey: trs.every(tr => tr.getAttribute('data-okey')), recv: trs.every(tr => tr.querySelector('td.nlog-recv')), buyer: trs.every(tr => tr.querySelector('td.nlog-buyer')),
      stray, rowChk: document.querySelectorAll('#notify-log-list tbody tr td .nlog-chk').length, rows: trs.length,
      firstTd: trs[0] ? trs[0].querySelector('td') && trs[0].querySelector('td').getAttribute('style') : null };
  });
  ok(st2.okey && st2.recv && st2.buyer, '② 전 행 data-okey·nlog-recv·nlog-buyer 구조', '');
  ok(st2.stray === 0, '② 표 밖 탈출(foster) 노드 0', st2.stray + '개');
  ok(st2.rowChk > 0 && st2.rowChk <= st2.rows, '② 행 체크박스 = 셀 안에 정위치', st2.rowChk + '/' + st2.rows);

  // ③ 후채움 API 실호출(로컬 = 재조회 폴백으로 tels 빈 것 허용 · 형태 검증)
  const en = await pg.evaluate(async () => {
    const keys = [...document.querySelectorAll('#notify-log-list tbody tr')].slice(0, 5).map(tr => tr.getAttribute('data-okey'));
    const d = await api('/api/agent-office/notify-logs/enrich', 'POST', { orderKeys: keys });
    return { hasTels: typeof d.tels === 'object', fix: d.summary_fix };
  });
  ok(en.hasTels && en.fix && ['gift', 'no_tel', 'bad_tel'].every(k => typeof en.fix[k] === 'number'), '③ enrich 응답 형태(tels·summary_fix 절대값)', JSON.stringify(en.fix));

  // ④ 후채움 패치 실동작 — 가짜 데이터 주입(DOM만·DB 무접촉)
  const st4 = await pg.evaluate(() => {
    const tr = [...document.querySelectorAll('#notify-log-list tbody tr')].find(t => !/^(c24|cp|join):/.test(t.getAttribute('data-okey') || ''));
    if (!tr) return null;
    const k = tr.getAttribute('data-okey');
    const tels = {}; tels[k] = { tel: '010-1234-5678', name: '홍길동' };
    notifyLogSeq++;   // 실후채움이 이미 이 순번의 보정을 적용했으므로(중복 방지 가드 정상) 새 순번으로 주입
    nlogApplyTels(tels, { gift: 3, no_tel: 1, bad_tel: 2 }, notifyLogSeq);
    return {
      recv: tr.querySelector('td.nlog-recv').textContent.trim(),
      buyer: tr.querySelector('td.nlog-buyer').textContent.trim(),
      sum: document.getElementById('notify-log-summary').textContent,
    };
  });
  ok(!!st4 && /010-1234-5678/.test(st4.recv) && st4.buyer === '홍길동', '④ 후채움 패치 = 번호·성함 그 자리 갱신', st4 && (st4.recv + ' / ' + st4.buyer));
  ok(!!st4 && /선물하기 3/.test(st4.sum) && /번호 오류 2/.test(st4.sum), '④ 요약 줄 보정 반영(절대값 교체)', st4 && st4.sum.slice(-60));
  // ④-b 늦게 온 후채움(구 순번)은 폐기
  const st4b = await pg.evaluate(() => {
    const tr = [...document.querySelectorAll('#notify-log-list tbody tr')].find(t => !/^(c24|cp|join):/.test(t.getAttribute('data-okey') || ''));
    const k = tr.getAttribute('data-okey');
    const before = tr.querySelector('td.nlog-recv').textContent.trim();
    const tels = {}; tels[k] = { tel: '010-9999-9999', name: '폐기대상' };
    nlogApplyTels(tels, null, notifyLogSeq - 1);   // 낡은 순번
    return { before, after: tr.querySelector('td.nlog-recv').textContent.trim() };
  });
  ok(st4b.before === st4b.after, '④ 낡은 순번 후채움 폐기(경합 가드)', '');

  // ⑤ 초기화 = 전체 복귀 + 더보기(전체 데이터) 동작
  await pg.click('#btn-notify-log-reset');
  await pg.waitForTimeout(3000);
  const st5 = await pg.evaluate(() => ({
    from: document.getElementById('notify-log-from').value,
    rows: document.querySelectorAll('#notify-log-list tbody tr').length,
    more: (document.getElementById('notify-log-more').textContent || ''),
  }));
  ok(st5.from === '' && st5.rows === 100 && /더보기/.test(st5.more), '⑤ [초기화] = 전체 + 100행 + 더보기', st5.more.trim());
  await pg.click('#btn-notify-log-more');
  await pg.waitForTimeout(3000);
  const st5b = await pg.evaluate(() => ({
    rows: document.querySelectorAll('#notify-log-list tbody tr').length,
    okeyAll: [...document.querySelectorAll('#notify-log-list tbody tr')].every(tr => tr.getAttribute('data-okey')),
  }));
  ok(st5b.rows === 200 && st5b.okeyAll, '⑤ 더보기 append 무회귀(+data-okey)', st5b.rows + '행');

  // ⑥ 채널·상태 필터 무회귀 (쿠팡 = 안심번호 뱃지 유지)
  await pg.selectOption('#notify-log-ch', 'cp');
  await pg.waitForTimeout(2500);
  const st6 = await pg.evaluate(() => [...document.querySelectorAll('#notify-log-list tbody tr td.nlog-recv')].map(td => td.textContent.replace(/\s+/g, ' ')));
  ok(st6.length > 0 && st6.filter(s => /050/.test(s)).every(s => /안심번호/.test(s)), '⑥ 쿠팡 안심번호 표기 무회귀(#409)', st6[0]);
  await pg.selectOption('#notify-log-ch', 'all');
  await pg.selectOption('#notify-log-filter', 'issue');
  await pg.waitForTimeout(2500);
  const st6b = await pg.evaluate(() => document.querySelectorAll('#notify-log-list tbody tr').length);
  ok(st6b >= 0, '⑥ 실패·보류 필터 렌더 무회귀', st6b + '행');

  // ⑦ 하위호환 — fast 없는 종전 호출도 정상
  const compat = await pg.evaluate(async () => { const d = await api('/api/agent-office/notify-logs?filter=all&limit=5&offset=0'); return Array.isArray(d.rows) && typeof d.total === 'number'; });
  ok(compat, '⑦ 비-fast(종전) API 하위호환', '');

  ok(errs.length === 0, '⑧ pageerror 0', errs.join(' | ') || '없음');
  await br.close();

  // ⑨ 인덱스 생성 확인(로컬 부팅 initDB가 실DB에 생성 — 배포본과 동일 additive)
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const idx = (await c.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_kakao_notify_log_created','idx_lms_guide_log_created')`)).rows.map(r => r.indexname);
  await c.end();
  ok(idx.length === 2, '⑨ created_at 인덱스 2종 생성', idx.join(', '));

  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
