// #808 체험 예약 창 실클릭 — 수기(현금) 예약 추가 · 「수정」 · 공통 달력(akm-date) · 시간 알약 · 번호 자동 하이픈 · 나간 길 배지 · 수기 지우기 · 「번호 미입력 없음」
//   시험 페이지(가짜 fetch · 서버·실DB·발송 0) · 공통 달력은 app.js 의 AkmCal 구간을 떼어 넣음(실코드) · 폰 390 · 폴드 900 · PC 1280 야간
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public').split(path.sep).join('/');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
let pass = 0, fail = 0; const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (x !== undefined && !c ? ' — ' + JSON.stringify(x).slice(0, 220) : '')); };
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const cut = (a, b) => { const i = APP.indexOf(a), j = APP.indexOf(b, i); if (i < 0 || j < 0) throw new Error('구간 못 찾음 ' + a); return APP.slice(i, j + b.length); };
const AKMCAL = cut('function _rankFmtToday() {', '\n}') + '\n' + cut('const AkmCal = (() => {', '\n})();');
const t0 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), add = n => new Date(Date.parse(t0 + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const D1 = add(3);
const items = [
    { id: 1, source: 'store', order_no: '2026102038638821', name: '홍길동', phone: '01011112222', visit_date: D1, visit_time: '10:00', exp_count: 2, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true, sms_recv_at: '2026-10-21T00:00:00Z', sms_recv_via: 'lms' },
    { id: 2, source: 'place', order_no: '1384820445', name: '정하늘', phone: '01033334444', contact_at: 'x', visit_date: D1, visit_time: '11:00', exp_count: 1, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true, sms_recv_at: '2026-10-21T00:00:00Z', sms_recv_via: 'alimtalk' },
    { id: 3, source: 'place', order_no: '1384820446', name: '박*현', phone: null, visit_date: add(5), visit_time: '13:00', exp_count: 1, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true },
];
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="file:///${PUB}/theme.css"><link rel="stylesheet" href="file:///${PUB}/styles.css"><link rel="stylesheet" href="file:///${PUB}/ao-dark.css"><link rel="stylesheet" href="file:///${PUB}/ao-exp.css">
<style>body{margin:0;font-family:"Pretendard","Malgun Gothic",sans-serif;background:#EEF0F4}</style></head><body>
<script>${AKMCAL}</script>
<script>
window.__calls = []; window.__toasts = []; let NID = 100;
const DATA = ${JSON.stringify({ items })};
localStorage.setItem('jwt_token', 'x'); localStorage.setItem('jwt_user', JSON.stringify({ role: 'user', name: '직원' }));
window.showToast = m => { window.__toasts.push(m); };
window.fetch = async (url, o) => {
  o = o || {}; window.__calls.push((o.method || 'GET') + ' ' + url + (o.body ? ' ' + o.body : ''));
  const J = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
  const u = new URL(url, 'http://x/'), p = u.pathname;
  if (p === '/api/agent-office/experience' && (o.method || 'GET') === 'GET') return J({ items: DATA.items, summary: {}, settings_view: { sms_enabled: true, alimtalk: true } });
  if (p === '/api/agent-office/experience' && o.method === 'POST') { const b = JSON.parse(o.body); const id = NID++; const it = Object.assign({ id, source: 'manual', order_no: 'M' + id, status: 'confirmed', date_ok: true, contact_at: 'now' }, b); if (b.phone) { it.sms_recv_at = 'now'; it.sms_recv_via = 'alimtalk'; } DATA.items.push(it); return J({ ok: true, item: it, sent: b.phone ? 'sent' : null }); }
  const m = /^\\/api\\/agent-office\\/experience\\/(\\d+)$/.exec(p);
  if (m && o.method === 'PATCH') { const it = DATA.items.find(x => x.id == m[1]); Object.assign(it, JSON.parse(o.body)); return J({ ok: true, item: it, sent: null }); }
  return J({ error: 'no mock ' + p }, 404);
};
</script><script src="file:///${PUB}/ao-exp.js"></script></body></html>`;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'v808-')); const page = path.join(OUT, 'ui808.html'); fs.writeFileSync(page, html);
(async () => {
    const br = await chromium.launch();
    try {
        for (const [w, h, mob, dark] of [[390, 844, true, false], [900, 1000, true, false], [1280, 900, false, true]]) {
            const tag = `${w}${dark ? ' 야간' : ''}`;
            const ctx = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
            const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
            await pg.goto('file:///' + page.split(path.sep).join('/'));
            if (dark) await pg.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
            await pg.evaluate(() => window.AkmExp.open()); await pg.waitForSelector('.xp-cell', { timeout: 5000 }); await pg.waitForTimeout(400);
            const tap = async loc => { if (mob) await loc.tap(); else await loc.click(); };
            await tap(pg.locator(`.xp-cell[data-day="${D1}"]`)); await pg.waitForSelector('#xp-panel:not([hidden]) .xp-row', { timeout: 5000 });
            // 「수정」 · 나간 길 배지
            ok(await pg.locator('#xp-panel [data-act="edit"]').first().textContent() === '수정' && !(await pg.locator('#xp-layer').textContent()).includes('고치기'), `[${tag}] 단추 글 「수정」 · 「고치기」 0`);
            const r1 = await pg.locator('#xp-panel .xp-row[data-id="1"] .xp-sms.ok').textContent(), r2 = await pg.locator('#xp-panel .xp-row[data-id="2"] .xp-sms.ok').textContent();
            ok(r1 === '문자✓' && r2 === '알림톡✓', `[${tag}] 배지 = 실제로 나간 길(문자✓ / 알림톡✓)`, [r1, r2]);
            // [+ 예약 추가]
            const addBtn = pg.locator('#xp-panel [data-act="add"]');
            const ab = await addBtn.boundingBox();
            ok(await addBtn.isVisible() && /예약 추가/.test(await addBtn.textContent()) && ab.height >= (mob ? 44 : 30), `[${tag}] 날짜 판 머리 [+ 예약 추가](${Math.round(ab.height)}px)`);
            await tap(addBtn); await pg.waitForSelector('#xp-add', { timeout: 3000 });
            const dIn = pg.locator('#xp-a-date');
            ok(await dIn.inputValue() === D1 && /akm-date/.test(await dIn.getAttribute('class')) && await dIn.getAttribute('readonly') !== null && await dIn.getAttribute('type') === 'text', `[${tag}] 방문일 = 그 날 · 공통 달력 칸(akm-date · type=date 아님)`);
            // 공통 달력 열고 다른 날 고르기
            await dIn.click(); await pg.waitForTimeout(200);
            ok(await pg.locator('.akm-cal').isVisible(), `[${tag}] 방문일 누르면 공통 달력`);
            const zc = await pg.evaluate(() => Number(getComputedStyle(document.querySelector('.akm-cal')).zIndex));
            ok(zc > 1150, `[${tag}] 달력이 체험 창 위(z ${zc})`, zc);
            const pickD = add(4);
            await pg.locator(`.akm-cal [data-date="${pickD}"]`).click(); await pg.waitForTimeout(150);
            ok(await dIn.inputValue() === pickD && !(await pg.locator('.akm-cal').isVisible()), `[${tag}] 달력에서 고른 날 = 칸에 들어감 · 달력 닫힘`);
            // 시간 알약
            await tap(pg.locator('#xp-add .xp-tp[data-tp="11:30"]'));
            ok(await pg.locator('#xp-a-time').inputValue() === '11:30' && await pg.locator('#xp-add .xp-tp.on').textContent() === '11:30', `[${tag}] 시간 알약 11:30 = 칸에 · 켜짐 표시`);
            const tps = await pg.locator('#xp-add .xp-tp').evaluateAll(n => n.map(x => x.getBoundingClientRect().height));
            ok(tps.length === 14 && Math.min(...tps) >= (mob ? 44 : 30), `[${tag}] 시간 알약 14개(10:00~16:30) · 높이 ${Math.round(Math.min(...tps))}px`, tps.length);
            // 금액 자동 셈
            await pg.fill('#xp-a-exp', '2'); await pg.fill('#xp-a-entry', '1');
            ok(await pg.locator('#xp-a-amount').inputValue() === '46000', `[${tag}] 금액 자동 = 체험 2·입장 1 → 46,000`);
            // 번호 하이픈 · 잘못이면 빨간 줄
            await pg.fill('#xp-a-phone', '0101'); await pg.locator('#xp-a-name').focus();
            ok(await pg.locator('#xp-a-phone-err').isVisible(), `[${tag}] 번호 덜 침 = 칸 아래 빨간 한 줄`);
            await pg.fill('#xp-a-phone', ''); await pg.locator('#xp-a-phone').type('01012345678');
            ok(await pg.locator('#xp-a-phone').inputValue() === '010-1234-5678' && !(await pg.locator('#xp-a-phone-err').isVisible()), `[${tag}] 숫자만 쳐도 010-1234-5678 · 빨간 줄 사라짐`);
            // 가운데 숫자 고치기 = 커서가 끝으로 안 튐
            const ph = pg.locator('#xp-a-phone');
            await ph.evaluate(e => { e.focus(); e.setSelectionRange(5, 5); });   // 「010-1|234-5678」 (1 다음)
            await pg.keyboard.press('Backspace');
            const st = await ph.evaluate(e => ({ v: e.value, c: e.selectionStart }));
            ok(st.v === '010-234-5678' && st.c === 4, `[${tag}] 가운데 지우기 = 하이픈 다시(10자리 3-3-4) · 커서 제자리(끝으로 안 튐)`, st);
            await pg.fill('#xp-a-phone', '010 9876 5432');
            ok(await pg.locator('#xp-a-phone').inputValue() === '010-9876-5432', `[${tag}] 붙여넣기 「010 9876 5432」 → 010-9876-5432`);
            await pg.fill('#xp-a-name', '김현금'); await pg.fill('#xp-a-memo', '현금');
            await tap(pg.locator('#xp-add [data-act="add-save"]')); await pg.waitForTimeout(700);
            const post = await pg.evaluate(() => window.__calls.filter(c => c.startsWith('POST')).slice(-1)[0] || '');
            ok(/"name":"김현금"/.test(post) && /"phone":"01098765432"/.test(post) && new RegExp(`"visit_date":"${pickD}"`).test(post) && /"visit_time":"11:30"/.test(post) && /"amount":46000/.test(post) && /"exp_count":2/.test(post), `[${tag}] POST = 이름·번호(숫자만)·고른 날·시간·인원·금액`, post);
            ok((await pg.evaluate(() => window.__toasts.slice(-1)[0])) === '추가 · 접수 알림톡 보냈어요 ✓', `[${tag}] 토스트 「추가 · 접수 알림톡 보냈어요 ✓」`);
            const newRow = pg.locator('#xp-panel .xp-row.src-mn');
            ok(await pg.locator('.xp-panel-h h3').textContent() !== '' && await newRow.count() === 1 && /수기/.test(await newRow.locator('.xp-src').textContent()) && /M\d+/.test(await newRow.locator('.xp-ono').textContent()), `[${tag}] 판이 고른 날로 · 새 줄 = 「수기」 배지·남색 띠·M번호`);
            // 수기 수정: 금액 칸 · 지우기 두 번
            await tap(newRow.locator('[data-act="edit"]')); await pg.waitForTimeout(200);
            ok(await pg.locator('#xp-e-amount').count() === 1 && await pg.locator('#xp-e-name').count() === 1 && /akm-date/.test(await pg.locator('#xp-e-date').getAttribute('class')) && await pg.locator('.xp-edit .xp-tpick').count() === 1, `[${tag}] 수기 수정 = 이름·번호·금액·공통 달력·시간 알약`);
            const del = pg.locator('[data-act="del"]');
            await tap(del); ok(/한 번 더/.test(await del.textContent()), `[${tag}] 삭제 = 한 번 더 눌러 확인`);
            await tap(del); await pg.waitForTimeout(500);
            ok(/"status":"canceled"/.test(await pg.evaluate(() => window.__calls.filter(c => c.startsWith('PATCH')).slice(-1)[0] || '')), `[${tag}] 두 번째 = 취소 표시(PATCH status canceled)`);
            // 다른 출처엔 삭제 없음 · 금액 칸 없음(원래 날 판으로)
            await pg.evaluate(() => { const c = document.querySelector('[data-act="close-panel"]'); if (c) c.click(); }); await pg.waitForTimeout(300);
            await tap(pg.locator(`.xp-cell[data-day="${D1}"]`)); await pg.waitForSelector('#xp-panel:not([hidden]) .xp-row[data-id="2"]', { timeout: 5000 });
            await tap(pg.locator('#xp-panel .xp-row[data-id="2"] [data-act="edit"]')); await pg.waitForTimeout(200);
            ok(await pg.locator('[data-act="del"]').count() === 0 && await pg.locator('#xp-e-amount').count() === 0, `[${tag}] 플레이스 수정 = 삭제·금액 칸 없음`);
            // Esc 순서: 달력 → 수정 칸
            await pg.locator('#xp-e-date').scrollIntoViewIfNeeded(); await pg.waitForTimeout(150);   // #822 판 위에 현장 판매 칸이 생겨 칸이 화면 밖일 수 있음 — 스크롤을 먼저 끝내야 공통 달력이 scroll 로 안 닫힘(실제 탭은 이미 초점이 있어 스크롤 0)
            await pg.locator('#xp-e-date').click(); await pg.waitForTimeout(150);
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
            ok(!(await pg.locator('.akm-cal').isVisible()) && await pg.locator('#xp-e-date').count() === 1, `[${tag}] Esc 1 = 달력만 닫힘(수정 칸 그대로)`);
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
            ok(await pg.locator('#xp-e-date').count() === 0 && await pg.locator('#xp-panel:not([hidden])').count() === 1, `[${tag}] Esc 2 = 수정 칸 닫힘(판 그대로)`);
            // 「번호 미입력 없음」
            await pg.evaluate(() => { DATA.items.forEach(b => { if (b.source === 'place') { b.phone = '01055556666'; b.contact_at = 'x'; } }); });
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
            await tap(pg.locator('[data-nav="0"]')); await pg.waitForTimeout(600);
            const pill = pg.locator('#xp-nophone');
            ok(await pill.isVisible() && await pill.textContent() === '번호 미입력 없음' && /none/.test(await pill.getAttribute('class')), `[${tag}] 0건 = 흐린 알약 「번호 미입력 없음」`);
            await tap(pill); await pg.waitForTimeout(300);
            ok(/번호를 넣을 플레이스 예약이 없어요/.test(await pg.locator('#xp-panel').textContent()), `[${tag}] 누르면 빈 판 「없어요」`);
            // 번호 없이 넣은 수기도 「번호 미입력」에 잡힘
            await pg.evaluate(d => { DATA.items.push({ id: 900, source: 'manual', order_no: 'M900', name: '이현금', phone: null, contact_at: 'x', visit_date: d, visit_time: '10:00', exp_count: 1, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true }); }, D1);
            await pg.evaluate(() => { const c = document.querySelector('[data-act="close-panel"]'); if (c) c.click(); }); await pg.waitForTimeout(200);
            await tap(pg.locator('[data-nav="0"]')); await pg.waitForTimeout(600);
            ok(await pill.textContent() === '번호 미입력 1건', `[${tag}] 번호 없는 수기 = 「번호 미입력 1건」`, await pill.textContent());
            await tap(pill); await pg.waitForSelector('#xp-panel:not([hidden]) .xp-quick', { timeout: 3000 });
            ok(/플레이스·수기/.test(await pg.locator('.xp-panel-h h3').textContent()) && await pg.locator('#xp-panel .xp-row[data-id="900"] .xp-quick').count() === 1, `[${tag}] 판 = 「번호 미입력(플레이스·수기)」 · 수기 줄에 바로 넣기 칸`);
            const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            ok(over <= 0, `[${tag}] 가로 넘침 0`, over);
            ok(errs.length === 0, `[${tag}] 화면 오류 0`, errs);
            await pg.evaluate(() => { DATA.items.forEach(b => { if (b.id === 3) { b.phone = null; b.contact_at = null; } }); DATA.items = DATA.items.filter(b => b.source !== 'manual'); });
            await ctx.close();
        }
    } finally { await br.close(); fs.rmSync(OUT, { recursive: true, force: true }); }
    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})();
