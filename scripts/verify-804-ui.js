// #804 체험 예약 창 실클릭 — 시험 페이지(가짜 fetch · 서버·실DB·발송 0) · 폰 390 · 폴드 900 · (PC 1280 · 야간 1)
//   볼 것: 출처 띠(스토어/플레이스) · 보냄 띠·배지 · 달력 「번호 미입력 n건」 알약 → 그 판에서 이름·번호 바로 넣기 → PATCH(name·phone) → 「접수 알림톡 보냈어요」 · 「*」 이름 막기
//          고치기 = 플레이스만 이름·번호 칸 · 「메일 원문」·「예약 취소로」·「확정으로 되돌리기」 없음 · 폰 칸 점(출처 색)
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public').split(path.sep).join('/');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
let pass = 0, fail = 0; const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (x !== undefined && !c ? ' — ' + JSON.stringify(x).slice(0, 200) : '')); };
const t0 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), add = n => new Date(Date.parse(t0 + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const D1 = add(2);
const items = [
    { id: 1, source: 'store', order_no: '2026102038638821', name: '홍길동', phone: '01011112222', visit_date: D1, visit_time: '10:00', exp_count: 2, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true, sms_recv_at: '2026-10-21T00:00:00Z', has_raw: false },
    { id: 2, source: 'place', order_no: '1384820445', name: '박*현', phone: null, visit_date: D1, visit_time: '11:00', exp_count: 2, entry_count: 1, infant_count: 0, status: 'confirmed', date_ok: true, has_raw: true },
    { id: 3, source: 'place', order_no: '1384820446', name: '최*리', phone: null, visit_date: D1, visit_time: '13:30', exp_count: 1, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true, has_raw: true },
    { id: 5, source: 'place', order_no: '1384820447', name: '박*현', phone: null, visit_date: add(5), visit_time: '10:30', exp_count: 1, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true, has_raw: true },   // #806 동명이인(다른 날)
    { id: 4, source: 'place', name: '정하늘', phone: '01033334444', contact_at: '2026-10-21T00:00:00Z', sms_recv_at: '2026-10-21T00:00:00Z', visit_date: D1, visit_time: '15:00', exp_count: 1, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true, has_raw: true },
];
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="file:///${PUB}/theme.css"><link rel="stylesheet" href="file:///${PUB}/ao-dark.css"><link rel="stylesheet" href="file:///${PUB}/ao-exp.css">
<style>body{margin:0;font-family:"Pretendard","Malgun Gothic",sans-serif;background:#EEF0F4}</style></head><body>
<script>
window.__calls = []; window.__toasts = [];
const DATA = ${JSON.stringify({ items })};
localStorage.setItem('jwt_token', 'x'); localStorage.setItem('jwt_user', JSON.stringify({ role: 'user', name: '직원' }));
window.showToast = m => { window.__toasts.push(m); };
window.fetch = async (url, o) => {
  o = o || {}; window.__calls.push((o.method || 'GET') + ' ' + url + (o.body ? ' ' + o.body : ''));
  const J = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
  const u = new URL(url, 'http://x/'), p = u.pathname;
  if (p === '/api/agent-office/experience') return J({ from: u.searchParams.get('from'), to: u.searchParams.get('to'), items: DATA.items, summary: { today: 0, tomorrow: 0, need_check: 0 }, settings_view: { sms_enabled: true, alimtalk: true } });
  const m = /^\\/api\\/agent-office\\/experience\\/(\\d+)$/.exec(p);
  if (m && o.method === 'PATCH') { const it = DATA.items.find(x => x.id == m[1]); const b = JSON.parse(o.body);
    if (('name' in b || 'phone' in b) && it.source !== 'place') return J({ error: '스토어 예약의 이름·번호는 주문 정보 그대로예요' }, 400);
    const nm = 'name' in b ? b.name : it.name; if (/\\*/.test(nm || '') && (b.phone || it.phone)) return J({ error: '이름에 *' }, 400);
    Object.assign(it, b); let sent = null; if (b.phone && it.source === 'place') { it.contact_at = 'now'; it.sms_recv_at = 'now'; sent = 'sent'; }
    return J({ ok: true, item: it, sent }); }
  return J({ error: 'no mock ' + p }, 404);
};
</script><script src="file:///${PUB}/ao-exp.js"></script></body></html>`;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'v804-')); const page = path.join(OUT, 'ui804.html'); fs.writeFileSync(page, html);
(async () => {
    const br = await chromium.launch();
    try {
        for (const [w, h, mob, dark] of [[390, 844, true, false], [900, 1000, true, false], [1280, 900, false, true]]) {
            const tag = `${w}${dark ? ' 야간' : ''}`;
            const ctx = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
            const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 140)));
            await pg.goto('file:///' + page.split(path.sep).join('/'));
            if (dark) await pg.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
            await pg.evaluate(() => window.AkmExp.open()); await pg.waitForSelector('.xp-cell', { timeout: 5000 }); await pg.waitForTimeout(500);
            // 알약
            const pill = pg.locator('#xp-nophone');
            ok(await pill.isVisible() && /번호 미입력 3건/.test(await pill.textContent()), `[${tag}] 달 이름 옆 「번호 미입력 3건」 알약`);
            const pb = await pill.boundingBox(), rb = await pg.locator('#xp-range').boundingBox();
            ok(pb && rb && Math.abs((pb.y + pb.height / 2) - (rb.y + rb.height / 2)) < 30 && pb.height >= (mob ? 44 : 20), `[${tag}] 알약 = 달 이름 옆 · 누르기 넉넉함(${pb && Math.round(pb.height)}px)`);
            // 달력: 출처 색(PC = 이름 띠 · 폰·폴드 = 점)
            const cell = pg.locator(`.xp-cell[data-day="${D1}"]`);
            if (w <= 960) { const dots = await cell.locator('.xp-dot').evaluateAll(n => n.map(x => x.className)); ok(dots.length === 4 && dots.filter(c => /src-pl/.test(c)).length === 3 && dots.filter(c => /src-st/.test(c)).length === 1 && dots.filter(c => /sent/.test(c)).length === 2, `[${tag}] 칸 점 4 = 스토어 1(초록)·플레이스 3(귤색) · 보냄 2`, dots); }
            else { const nms = await cell.locator('.xp-nm').evaluateAll(n => n.map(x => x.className)); ok(nms.some(c => /src-st/.test(c)) && nms.some(c => /src-pl/.test(c)), `[${tag}] 칸 이름 띠 = 스토어·플레이스 색 다름`, nms); }
            // 알약 → 번호 미입력 판 → 바로 넣기
            if (mob) await pill.tap(); else await pill.click();
            await pg.waitForSelector('#xp-panel:not([hidden]) .xp-quick', { timeout: 5000 });
            ok(/번호 미입력/.test(await pg.locator('.xp-panel-h h3').textContent()) && await pg.locator('#xp-panel .xp-row').count() === 3, `[${tag}] 판 = 번호 미입력 3건(플레이스·번호 없음만)`);
            // #806 여러 날짜 판 = 날짜순 + 날짜 구분 줄 · 줄 머리 날짜+시간 · 예약번호
            const seq = await pg.locator('#xp-panel .xp-panel-b ul > li').evaluateAll(n => n.map(x => x.classList.contains('xp-dsep') ? 'D:' + x.textContent.trim() : 'R:' + x.dataset.id));
            ok(seq.length === 5 && seq[0].startsWith('D:') && seq[1] === 'R:2' && seq[2] === 'R:3' && seq[3].startsWith('D:') && seq[4] === 'R:5' && seq[3] !== seq[0], `[${tag}] 판 = 날짜 구분 줄 2개 · 날짜순(2·3 → 5)`, seq);
            ok(/요일|\(.\)/.test(seq[0] + seq[3]) && /월 .*일/.test(seq[0]), `[${tag}] 구분 줄 = 「n월 n일(요일)」`, [seq[0], seq[3]]);
            const head5 = (await pg.locator('#xp-panel .xp-row[data-id="5"] .xp-time').textContent()).replace(/\s+/g, '');
            ok(/^\d{1,2}\/\d{1,2}\(.\)10:30$/.test(head5), `[${tag}] 줄 머리 = 「m/d(요일) 시간」`, head5);
            const ono = await pg.locator('#xp-panel .xp-row[data-id="2"] .xp-ono').textContent(), ono5 = await pg.locator('#xp-panel .xp-row[data-id="5"] .xp-ono').textContent();
            ok(/예약\s*1384820445/.test(ono) && /1384820447/.test(ono5), `[${tag}] 예약번호 = 같은 이름(박*현)도 번호로 구별`, [ono, ono5]);
            const us = await pg.locator('#xp-panel .xp-row[data-id="2"] .xp-ono').evaluate(e => getComputedStyle(e).userSelect || getComputedStyle(e).webkitUserSelect);
            ok(us === 'all', `[${tag}] 예약번호 = 한 번에 고르기(복사)`, us);
            ok(/스마트플레이스 예약자관리에서 같은 예약번호 줄의 이름·전화번호/.test(await pg.locator('.xp-panel-h small').textContent()), `[${tag}] 판 안내 = 예약자관리 · 같은 예약번호 줄`);
            const ovp = await pg.locator('#xp-panel .xp-panel-b').evaluate(e => e.scrollWidth - e.clientWidth);
            ok(ovp <= 0, `[${tag}] 판 가로 넘침 0`, ovp);
            // 가린 이름 그대로 번호만 → 화면이 막음(요청 0)
            await pg.fill('#xp-q-phone-2', '010-5555-6666'); const c0 = (await pg.evaluate(() => window.__calls.length));
            await pg.locator('#xp-panel .xp-row[data-id="2"] [data-act="qsave"]').click();
            await pg.waitForTimeout(300);
            ok((await pg.evaluate(() => window.__calls.length)) === c0 && (await pg.evaluate(() => window.__toasts.slice(-1)[0])).includes('*'), `[${tag}] 이름이 박*현 그대로 = 저장 막고 안내(요청 0)`);
            await pg.fill('#xp-q-name-2', '박지현');
            await pg.locator('#xp-panel .xp-row[data-id="2"] [data-act="qsave"]').click();
            await pg.waitForTimeout(800);
            const call = await pg.evaluate(() => window.__calls.filter(c => c.startsWith('PATCH')).slice(-1)[0]);
            ok(/experience\/2 /.test(call) && /"name":"박지현"/.test(call) && /"phone":"01055556666"/.test(call), `[${tag}] PATCH = 이름·번호(숫자만)`, call);
            ok((await pg.evaluate(() => window.__toasts.slice(-1)[0])) === '저장 · 접수 알림톡 보냈어요 ✓', `[${tag}] 토스트 「저장 · 접수 알림톡 보냈어요 ✓」`);
            ok(await pg.locator('#xp-panel .xp-row').count() === 2 && /번호 미입력 2건/.test(await pill.textContent()), `[${tag}] 넣은 건은 판·알약에서 빠짐(2건 남음)`);
            // 날짜 판: 줄 띠·배지 · 고치기 단추 정리
            await pg.evaluate(() => { const c = document.querySelector('[data-act="close-panel"]'); if (c) c.click(); }); await pg.waitForTimeout(300);
            if (mob) await cell.tap(); else await cell.click();
            await pg.waitForSelector('#xp-panel:not([hidden]) .xp-row', { timeout: 5000 });
            const rows = await pg.locator('#xp-panel .xp-row').evaluateAll(n => n.map(x => ({ id: x.dataset.id, c: x.className, sh: getComputedStyle(x).boxShadow, t: x.textContent })));
            const R = id => rows.find(x => x.id === String(id));
            ok(/src-st/.test(R(1).c) && /src-pl/.test(R(2).c) && /sent/.test(R(1).c) && /sent/.test(R(2).c) && !/sent/.test(R(3).c), `[${tag}] 줄 = 출처 띠 · 보낸 줄만 굵게(sent)`, rows.map(x => x.id + ':' + x.c));
            ok(/ 6px 0px 0px 0px inset/.test(R(2).sh) && / 3px 0px 0px 0px inset/.test(R(3).sh), `[${tag}] 띠 굵기 = 보냄 6px · 안 보냄 3px`, [R(2).sh, R(3).sh]);
            ok(/번호 미입력/.test(R(3).t) && /✓/.test(R(4).t), `[${tag}] 배지 = 번호 미입력 / 보낸 줄 ✓`, [R(3).t.slice(0, 80), R(4).t.slice(0, 80)]);
            ok(await pg.locator('#xp-panel .xp-dsep').count() === 0 && /주문\s*2026102038638821/.test(R(1).t), `[${tag}] 하루 판 = 구분 줄 없음 · 스토어는 「주문」번호`, R(1).t.slice(0, 90));
            const heads = await pg.locator('#xp-panel .xp-row .xp-time').evaluateAll(n => n.map(x => x.textContent.replace(/\s+/g, '')));
            ok(heads.length === 4 && heads.every(h => /^(오늘|내일|\d{1,2}\/\d{1,2}\(.\))\d{2}:\d{2}$/.test(h)), `[${tag}] 하루 판 줄 머리도 날짜+시간`, heads);
            // 고치기 — 플레이스 = 이름·번호 칸 · 스토어 = 없음 · 원문·취소 단추 없음
            await pg.locator('#xp-panel .xp-row[data-id="3"] [data-act="edit"]').click(); await pg.waitForTimeout(200);
            ok(await pg.locator('#xp-e-name').count() === 1 && await pg.locator('#xp-e-phone').count() === 1, `[${tag}] 플레이스 고치기 = 이름·번호 칸`);
            ok(await pg.locator('[data-act="raw"], [data-act="cancel"], [data-act="restore"]').count() === 0, `[${tag}] 「메일 원문」·「예약 취소로」·「확정으로 되돌리기」 없음`);
            await pg.locator('#xp-panel .xp-row[data-id="1"] [data-act="edit"]').click(); await pg.waitForTimeout(200);
            ok(await pg.locator('#xp-e-name').count() === 0 && await pg.locator('#xp-e-phone').count() === 0, `[${tag}] 스토어 고치기 = 이름·번호 칸 없음(주문 정보 정본)`);
            const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            ok(over <= 0, `[${tag}] 가로 넘침 0`, over);
            ok(errs.length === 0, `[${tag}] 화면 오류 0`, errs);
            await ctx.close();
        }
    } finally { await br.close(); fs.rmSync(OUT, { recursive: true, force: true }); }
    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})();
