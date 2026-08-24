/* #401-d E2E — 테스트 계정 실가입 → join_result 신호 → welcome-signup 역검증 → dry 기록 (실사이트·실가입)
   테스트 계정 1개 생성됨(이름 클로드테스트 — 대표가 관리자에서 삭제 가능·무해, #267-d 전례) */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

(async () => {
  const uid = 'akmcl' + Math.random().toString(36).slice(2, 8);
  const pw = 'Akmtest!2026';
  console.log('테스트 계정:', uid);
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; const sigCalls = []; const dialogs = [];
  pg.on('dialog', async d => { dialogs.push(d.message().slice(0, 80)); await d.accept().catch(() => {}); });   // 카페24 검증 alert 캡처
  pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
  pg.on('response', r => { if (r.url().includes('/api/public/welcome-signup')) sigCalls.push({ status: r.status(), url: r.url() }); });
  let sigBody = null;
  pg.on('request', r => { if (r.url().includes('/api/public/welcome-signup') && r.method() === 'POST') { try { sigBody = JSON.parse(r.postData() || '{}'); } catch (_) {} } });

  // ① 약관 동의
  await pg.goto('https://akkome.com/member/agreement.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => {
    const all = document.querySelector('#sAgreeAllChecked, input[id*="AgreeAll"], input[name*="agree_all"]');
    if (all && !all.checked) all.click();
    document.querySelectorAll('input[type="checkbox"]').forEach(c => { if (!c.checked) c.click(); });
  });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => {
    const btn = [...document.querySelectorAll('a,button,input[type=submit]')].find(el => /다음|동의|가입하기/.test((el.textContent || el.value || '')));
    if (btn) btn.click();
  });
  await pg.waitForTimeout(3500);
  const onJoin = /\/member\/join/.test(pg.url());
  ok(onJoin, '① 약관 → 정보입력 진입', pg.url().slice(-40));
  if (!onJoin) { console.log('가입 폼 미진입 — 중단'); await br.close(); process.exit(2); }

  // ② 정보 입력 (아이디·비번·이름·휴대폰·이메일)
  const fill = async (sels, val) => {
    for (const s of sels) { const el = await pg.$(s); if (el) { await el.fill(val); return s; } }
    return null;
  };
  await fill(['#member_id', 'input[name="member_id"]'], uid);
  // 중복확인 버튼은 이 스킨에서 전부 숨김(실측) — blur 시 자동 검사이므로 blur를 직접 발생
  await pg.evaluate(() => { const el = document.querySelector('#member_id'); if (el) { el.focus(); el.blur(); el.dispatchEvent(new Event('blur', { bubbles: true })); } });
  await pg.waitForTimeout(1500);
  await fill(['#passwd', 'input[name="passwd"]'], pw);
  await fill(['#user_passwd_confirm', 'input[name="user_passwd_confirm"]'], pw);
  await fill(['#name', 'input[name="name"]'], '클로드테스트');
  // 휴대폰 — 카페24는 3분할(select+2 input) 또는 단일
  const telDone = await pg.evaluate(() => {
    const one = document.querySelector('input[name="mobile"], #mobile');
    if (one) { one.value = '010-6687-4031'; one.dispatchEvent(new Event('input', { bubbles: true })); return 'single';
    }
    const m1 = document.querySelector('select[name="mobile1"], #mobile1');
    const m2 = document.querySelector('input[name="mobile2"], #mobile2');
    const m3 = document.querySelector('input[name="mobile3"], #mobile3');
    if (m1 && m2 && m3) {
      m1.value = '010'; m1.dispatchEvent(new Event('change', { bubbles: true }));
      m2.value = '6687'; m2.dispatchEvent(new Event('input', { bubbles: true }));
      m3.value = '4031'; m3.dispatchEvent(new Event('input', { bubbles: true }));
      return 'triple';
    }
    return null;
  });
  ok(!!telDone, '② 휴대폰 입력', telDone);
  await pg.evaluate((u) => {
    // 실측: email1 단일 입력(도메인 select 없음) — 전체 주소 입력. example.com은 카페24가 거부 → naver.com
    const e1 = document.querySelector('#email1, input[name="email1"], input[name="email"], #email');
    if (e1) { e1.value = u + '@naver.com'; e1.dispatchEvent(new Event('input', { bubbles: true })); e1.dispatchEvent(new Event('blur', { bubbles: true })); }
  }, uid);
  // 가입 제출 (재시도 루프 — #267-d 전례)
  let joined = false;
  for (let t = 0; t < 4 && !joined; t++) {
    await pg.evaluate(() => {
      // 🔴 첫 매칭이 「사업자 회원가입」 유형 전환 링크를 눌러 member_type이 바뀌던 결함 — 실 제출 버튼만 정확히
      const cands = [...document.querySelectorAll('a.btnSubmit, button.btnSubmit, input[type=submit], a, button')];
      const b = cands.find(el => {
        const t = (el.textContent || el.value || '').trim();
        if (!el.offsetParent) return false;
        if (/사업자|외국인/.test(t)) return false;
        return t === '회원가입' || t === '가입하기' || /^회원가입/.test(t) && /btnSubmit/.test(String(el.className));
      });
      if (b) b.click();
    });
    await pg.waitForTimeout(3500);
    joined = /join_result|joincomplete/i.test(pg.url());
  }
  console.log('  [검증 alert]', dialogs.length ? dialogs.join(' / ') : '없음');
  ok(joined, '③ 가입 완료 페이지 도달', pg.url().slice(-45));
  if (joined) {
    await pg.waitForTimeout(2500);   // 신호 fetch 여유
    // ④ 치환자 후보 실렌더 상태 (어느 것이 채택됐나)
    const probes = await pg.evaluate(() => [...document.querySelectorAll('[data-akm-wt]')].map(el => (el.textContent || '').trim().slice(0, 24)));
    console.log('  [휴대폰 치환자 후보]', JSON.stringify(probes));
    ok(sigBody != null, '④ 가입 신호 POST 발생', JSON.stringify(sigBody || {}).replace(/\d{4}$/, '****'));
    ok(sigCalls.length > 0 && sigCalls[0].status === 200, '⑤ 서버 응답 200 (역검증 통과)', JSON.stringify(sigCalls[0] || {}));
  }
  ok(errs.length === 0, '⑥ pageerror 0', errs.join(' | ') || '없음');
  await br.close();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과') + ' · 계정=' + uid);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
