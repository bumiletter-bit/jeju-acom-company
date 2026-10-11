// #653-나 입력 칸 [+] 메뉴 검증 — 가짜 서버(scripts/_mock-610.js · DB·외부 호출 0)에 실제 화면을 띄워 실클릭
//   사용: node scripts/verify-653-plus.js   (포트 PORT653 · 없으면 3465 · 다른 Playwright 검증과 동시에 돌리지 말 것 · SHOTS=폴더 를 주면 그림도 남김)
//   PC · 폰 · PC 야간 · 폰 야간 × 바로가기 · 메뉴 열기(묶음·항목·높이·화면 안) · 키보드(↑↓ End Esc Enter) · 바깥 누름 · 문자 창 · 파일 고르기 · 가로 넘침 · 야간 대비
const path = require('path'), fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), W = ROOT, OUT = process.env.SHOTS || '';
const PORT = Number(process.env.PORT653 || 3465), BASE = 'http://localhost:' + PORT;
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : '  FAIL ') + m); };
(async () => {
    if (OUT) fs.mkdirSync(OUT, { recursive: true });
    const srv = spawn(process.execPath, [path.join(W, 'scripts/_mock-610.js'), String(PORT)], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch();
    try {
        for (const [name, vw, phone, theme] of [['pc', { width: 1440, height: 900 }, false, null], ['phone', { width: 390, height: 844 }, true, null], ['pc-dark', { width: 1440, height: 900 }, false, 'dark'], ['phone-dark', { width: 390, height: 844 }, true, 'dark']]) {
            await fetch(BASE + '/__mock/reset', { method: 'POST' });
            const ctx = await browser.newContext(Object.assign({ viewport: vw, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await pg.evaluate(th => { localStorage.setItem('jwt_token', 'mock.token.x'); localStorage.setItem('jwt_user', JSON.stringify({ id: 8, name: '시험직원', position: '대리', role: 'user' })); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); localStorage.removeItem('akm_desk_plus_recent'); }, theme);
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1800);
            const s0 = await pg.evaluate(() => ({ shorts: Array.from(document.querySelectorAll('#desk-shorts .desk-short')).map(b => b.textContent.trim()).join('|'), plusN: document.getElementById('desk-plus-n').textContent + '|' + document.getElementById('desk-plus-n').hidden, menu: document.getElementById('desk-plus').hidden, over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
            ok(s0.shorts === '중간발주|최종발주|문자7' && s0.plusN === '7|false' && s0.menu && s0.over <= vw.width, `[${name}] 처음: 바로가기 「${s0.shorts}」 · [+] 배지 ${s0.plusN} · 메뉴 닫힘 · 가로 ${s0.over}`);
            if (OUT) await pg.screenshot({ path: path.join(OUT, `plus-${name}-closed.png`), clip: phone ? undefined : { x: 240, y: 0, width: 1200, height: 420 } });
            await pg.click('#desk-plus-btn'); await pg.waitForTimeout(350);
            const m1 = await pg.evaluate(() => { const m = document.getElementById('desk-plus'), r = m.getBoundingClientRect(); const items = Array.from(m.querySelectorAll('.desk-mi')).filter(b => !b.hidden); return { open: !m.hidden, exp: document.getElementById('desk-plus-btn').getAttribute('aria-expanded'), names: items.map(b => b.querySelector('strong').textContent).join('|'), groups: Array.from(m.querySelectorAll('.desk-plus-g')).filter(g => !g.hidden).map(g => g.querySelector('b').textContent).join('|'), minH: Math.min(...items.map(b => Math.round(b.getBoundingClientRect().height))), inView: r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 && r.top >= 0, focus: (document.activeElement || {}).id, pos: getComputedStyle(m).position, w: Math.round(r.width), smsN: document.getElementById('sms-chip-n').textContent }; });
            ok(m1.open && m1.exp === 'true' && m1.names === '파일 · 이미지|정산 이미지|중간발주|최종발주|배송조회 확인하기|전체 가격 확인하기|문자' && m1.groups === '첨부|발주|확인|손님' && m1.minH >= (phone ? 56 : 44) && m1.inView && m1.focus === 'desk-attach' && m1.smsN === '7' && (phone ? m1.pos === 'fixed' : m1.pos === 'absolute'), `[${name}] 메뉴 열림: ${m1.groups} · 항목 ${m1.names.split('|').length}개(최소 ${m1.minH}px) · ${m1.pos} ${m1.w}px · 화면 안 ${m1.inView} · 첫 항목에 초점`);
            if (OUT) await pg.screenshot({ path: path.join(OUT, `plus-${name}-open.png`), clip: phone ? undefined : { x: 240, y: 0, width: 1200, height: 640 } });
            if (theme) { const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js')); const a = await H.audit(pg, '#desk-plus, #desk-shorts, #desk-plus-btn'); ok(a.fails.length === 0 && a.white.length === 0, `[${name}] 야간 대비 미달 ${a.fails.length} · 흰 칸 ${a.white.length}(글자 ${a.texts}개 · 최소 ${a.minR}${a.fails.length ? ' · ' + a.fails.slice(0, 3).join(' / ') : ''})`); }
            if (!phone) {
                await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown'); const f2 = await pg.evaluate(() => document.activeElement.id);
                await pg.keyboard.press('End'); const f3 = await pg.evaluate(() => document.activeElement.id);
                await pg.keyboard.press('ArrowDown'); const f4 = await pg.evaluate(() => document.activeElement.id);
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
                const f5 = await pg.evaluate(() => ({ menu: document.getElementById('desk-plus').hidden, focus: document.activeElement.id }));
                ok(f2 === 'desk-qty-now' && f3 === 'desk-sms-now' && f4 === 'desk-attach' && f5.menu && f5.focus === 'desk-plus-btn', `[${name}] 키보드: ↓↓ = ${f2} · End = ${f3} · ↓(돌아옴) = ${f4} · Esc → 닫힘 + 초점 [+]`);
                await pg.keyboard.press('ArrowDown'); await pg.waitForTimeout(200); await pg.keyboard.press('End'); await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(700);
                const p1 = await pg.evaluate(() => ({ menu: document.getElementById('desk-plus').hidden, price: !!document.getElementById('desk-price') && !document.getElementById('desk-price').hidden, shorts: Array.from(document.querySelectorAll('#desk-shorts .desk-short')).map(b => b.textContent.trim()).join('|') }));
                ok(p1.menu && p1.price && p1.shorts === '가격 확인|중간발주|문자7', `[${name}] ↓ 로 열고 Enter 로 「전체 가격 확인하기」 → 카드 열림 · 메뉴 닫힘 · 바로가기가 최근 것으로(「${p1.shorts}」)`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(250); await pg.mouse.click(1000, 700); await pg.waitForTimeout(250);
                ok(await pg.evaluate(() => document.getElementById('desk-plus').hidden), `[${name}] 바깥 누름 → 닫힘`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(250); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
                ok(await pg.evaluate(() => document.getElementById('desk-plus').hidden && document.activeElement.id === 'desk-plus-btn'), `[${name}] Tab → 메뉴 닫힘 · 초점은 [+]`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(250); await pg.click('#desk-price-now'); await pg.waitForTimeout(500);
                const pf = await pg.evaluate(() => ({ open: !!document.getElementById('desk-price') && !document.getElementById('desk-price').hidden, focusIn: !!document.activeElement.closest('#desk-price') }));
                ok(pf.open && pf.focusIn, `[${name}] 가격 카드가 열려 있을 때 메뉴에서 또 고르면 닫히지 않고 그 카드로(초점 이동)`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(250);
                const oc = await pg.evaluate(() => window.AkmAoDesk.openSms(3)); await pg.waitForTimeout(900);
                ok(oc === true && await pg.evaluate(() => document.getElementById('desk-plus').hidden && document.getElementById('desk-plus-btn').getAttribute('aria-expanded') === 'false' && !document.getElementById('desk-sms').hidden), `[${name}] 메뉴가 열린 채 문자 창이 뜨면(알림) 메뉴는 닫힘`);
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(350); await pg.keyboard.press('Escape'); await pg.waitForTimeout(450);
                const bz = await pg.evaluate(() => { const it = document.getElementById('desk-qty-now'); it.disabled = true; window.__aoDesk.plusBusy(); const sc = document.getElementById('desk-short-qty'); const r = { busy: it.dataset.busy || '', short: sc ? sc.disabled + '|' + sc.textContent.trim() : '(바로가기 없음)' }; it.disabled = false; window.__aoDesk.plusBusy(); const sc2 = document.getElementById('desk-short-qty'); r.after = (it.dataset.busy || '') + '|' + (sc2 ? sc2.disabled + '|' + sc2.textContent.trim() : ''); return r; });
                ok(bz.busy === '집계 중' && /^true\|중간발주집계 중$/.test(bz.short) && /^\|false\|중간발주$/.test(bz.after), `[${name}] 집계 중이면 메뉴 항목·바로가기 둘 다 꺼진 모양 + 「집계 중」 · 끝나면 원래대로(${JSON.stringify(bz)})`);
            } else {
                await pg.touchscreen.tap(195, 60); await pg.waitForTimeout(300);
                ok(await pg.evaluate(() => document.getElementById('desk-plus').hidden && document.getElementById('desk-plus-back').hidden), `[${name}] 시트 바깥(어두운 곳) 누름 → 닫힘`);
                await pg.waitForTimeout(300);
                ok(await pg.evaluate(() => !(history.state && history.state.deskPlus) && !document.body.classList.contains('desk-plus-open')), `[${name}] 바깥 누름으로 닫으면 뒤로가기 칸·스크롤 잠금도 풀림`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(300);
                const d1 = await pg.evaluate(() => ({ st: !!(history.state && history.state.deskPlus), lock: getComputedStyle(document.body).overflow === 'hidden' }));
                await pg.goBack().catch(() => { }); await pg.waitForTimeout(400);
                const d2 = await pg.evaluate(() => ({ menu: document.getElementById('desk-plus').hidden, page: document.getElementById('page-agent-office').classList.contains('active'), url: location.pathname, st: !!(history.state && history.state.deskPlus), lock: document.body.classList.contains('desk-plus-open') }));
                ok(d1.st && d1.lock && d2.menu && d2.page && d2.url === '/' && !d2.st && !d2.lock, `[${name}] 폰 시트: 떠 있는 동안 뒤 화면 스크롤 잠금 · 뒤로가기 = 시트만 닫힘(페이지 그대로 · ${JSON.stringify(d2)})`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(300); await pg.click('#desk-sms-now'); await pg.waitForTimeout(1100);
                const d3 = await pg.evaluate(() => ({ win: !document.getElementById('desk-sms').hidden && document.body.classList.contains('sms-win-open'), st: (history.state || {}).smsWin || '', menu: document.getElementById('desk-plus').hidden }));
                await pg.goBack().catch(() => { }); await pg.waitForTimeout(450);
                const d4 = await pg.evaluate(() => ({ win: document.getElementById('desk-sms').hidden, plus: !!(history.state && history.state.deskPlus), sms: (history.state || {}).smsWin || '', page: document.getElementById('page-agent-office').classList.contains('active') }));
                ok(d3.win && d3.st === 'win' && d3.menu && d4.win && !d4.plus && !d4.sms && d4.page, `[${name}] 시트에서 「문자」 → 시트 칸을 되돌린 뒤 문자 창이 뜸 · 뒤로가기 1번에 창 닫힘 · 남는 칸 없음(${JSON.stringify(d4)})`);
            }
            await pg.click('#desk-short-sms'); await pg.waitForTimeout(800);
            ok(await pg.evaluate(() => !document.getElementById('desk-sms').hidden && document.body.classList.contains('sms-win-open')), `[${name}] 바로가기 「문자 7」 → 문자 창 열림`);
            await pg.click('#sms-close'); await pg.waitForTimeout(400);
            ok(await pg.evaluate(() => document.activeElement.id) === 'desk-short-sms', `[${name}] 창을 닫으면 초점이 그 바로가기로`);
            await pg.click('#desk-plus-btn'); await pg.waitForTimeout(300);
            const [chooser] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null), pg.click('#desk-attach')]);
            await pg.waitForTimeout(200);
            ok(!!chooser && await pg.evaluate(() => document.getElementById('desk-plus').hidden), `[${name}] 「파일 · 이미지」 → 파일 고르기 창 · 메뉴 닫힘`);
            const over = await pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
            ok(over <= vw.width && errs.length === 0, `[${name}] 끝까지 가로 넘침 없음(${over}) · 화면 오류 ${errs.length}${errs.length ? ' ' + errs[0].slice(0, 120) : ''}`);
            await ctx.close();
        }
    } finally { await browser.close().catch(() => { }); srv.kill(); }
    console.log(`
결과: ${pass}/${pass + fail}`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
