// #678 폰 뒤로가기 = 바로 전 화면(메뉴 이동 · 메뉴 안 탭 전환 · 공통 창) — 대표 10/12
//   로컬 서버(포트 PORT678 · 없으면 3466 · 스케줄러 막음 · 실DB 읽기만) · 쓰기 요청(GET 아님)은 전부 가로채 가짜 응답 → DB 쓰기 0 · /api/auth/me 는 가짜(직원은 시험 번호 계정)
//   실행: node scripts/verify-678-back.js   (APP678=<app.js 사본 경로> 를 주면 그 파일을 app.js 로 끼워 본다 · W678=390,900 으로 폭 고르기)
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs'); const jwt = require('jsonwebtoken'); const { chromium } = require('playwright');
const PORT = Number(process.env.PORT678 || 3466), ROOT = path.join(__dirname, '..'), SECRET = 'verifytest', BASE = 'http://localhost:' + PORT;
const WIDTHS = String(process.env.W678 || '390,900,1280').split(',').map(Number).filter(Boolean);
const APP = process.env.APP678 ? fs.readFileSync(process.env.APP678, 'utf8') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + d : '')); };
const ADMIN = { id: 1, username: 'o', name: '전승범', position: '대표', role: 'admin' };
const STAFF = { id: 990678, username: 'v678', name: '시험678', position: '사원', role: 'user' };

async function open(br, w, user) {
    const ctx = await br.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, hasTouch: w < 1000, isMobile: w < 600 });
    const writes = [], errs = [];
    await ctx.route('**/api/**', r => {
        const q = r.request(), m = q.method(), u = new URL(q.url()).pathname;
        if (u === '/api/auth/me') return r.fulfill({ json: user });
        if (m !== 'GET') { if (u.indexOf('/notify-logs/enrich') < 0) writes.push(m + ' ' + u);   // 알림 이력 탭은 손으로 눌러도 이 보강 요청(POST)을 낸다 — 탭을 다시 여는 것과 같으므로 세지 않는다
            return r.fulfill({ json: { ok: true } }); }
        r.continue();
    });
    if (APP) await ctx.route('**/app.js*', r => r.fulfill({ contentType: 'application/javascript; charset=utf-8', body: APP }));
    const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(String(e.message || e)));
    const token = jwt.sign(user, SECRET, { expiresIn: '30m' });
    await pg.goto(BASE + '/'); await pg.evaluate(a => { localStorage.clear(); localStorage.setItem('jwt_token', a.t); localStorage.setItem('jwt_user', JSON.stringify(a.u)); }, { t: token, u: user });
    await pg.goto(BASE + '/'); await pg.waitForFunction(() => !!(history.state && history.state.akmNav), null, { timeout: 40000 });
    await sleep(600);
    const H = {
        pg, ctx, writes, errs, w,
        at: () => pg.evaluate(() => { const p = document.querySelector('.page.active'); const tabs = p ? [...p.querySelectorAll('.settlement-tab, .doc-main-tab, .doc-tab, .ps-tab, #schedule-view-toggle button')].filter(b => b.classList.contains('active') || b.classList.contains('on')).map(b => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 14)) : []; return (p ? p.id.replace('page-', '') : '?') + (tabs.length ? '[' + tabs.join('|') + ']' : ''); }),
        page: () => pg.evaluate(() => { const p = document.querySelector('.page.active'); return p ? p.id.replace('page-', '') : '?'; }),
        layers: () => pg.evaluate(() => { const sh = e => e && getComputedStyle(e).display !== 'none'; const dd = document.getElementById('notification-dropdown'); const nh = document.getElementById('noti-hist'); return { modal: [...document.querySelectorAll('.modal-overlay')].filter(sh).length, noti: !!(dd && dd.style.display !== 'none' && sh(dd)), hist: !!(nh && !nh.hidden), side: !!document.querySelector('.sidebar.mobile-open'), m: (history.state && history.state.akmM) || 0, len: history.length }; }),
        // 메뉴 누르기 — 폰 폭에서는 ☰ 로 사이드바를 연 뒤 누른다(실제 손 순서)
        nav: async name => { const it = pg.locator('.nav-item[data-page="' + name + '"]'); if (!(await it.isVisible().catch(() => false)) || w < 769) { const mb = pg.locator('.mobile-menu-btn'); if (await mb.isVisible().catch(() => false)) { await mb.click(); await sleep(350); } } await it.click(); await sleep(450); },
        back: async () => { await pg.goBack({ waitUntil: 'commit' }).catch(() => { }); await sleep(450); },
        fwd: async () => { await pg.goForward({ waitUntil: 'commit' }).catch(() => { }); await sleep(450); },
    };
    if (process.env.D678) for (const k of ['nav', 'back', 'fwd']) { const o = H[k]; H[k] = async x => { await o(x); console.log('     · ' + k + ' ' + (x || '') + ' → ' + await pg.evaluate(() => location.href.slice(-30) + ' len ' + history.length + ' ' + JSON.stringify(history.state)).catch(e => 'ERR ' + e.message.slice(0, 60))); }; }
    return H;
}

async function menus(H, list, label) {
    const start = await H.at(); const seen = [start];
    for (const m of list) { await H.nav(m); seen.push(await H.at()); }
    ok(list.every((m, i) => seen[i + 1].indexOf(m) === 0), label + ' 메뉴 ' + list.length + '단 이동 ' + seen.join(' → '), seen.join(' → '));
    const w0 = H.writes.length; const backs = [];
    for (let i = 0; i < list.length; i++) { await H.back(); backs.push(await H.at()); }
    const want = seen.slice(0, -1).reverse();
    ok(JSON.stringify(backs) === JSON.stringify(want), label + ' 뒤로가기 ' + list.length + '번 = 역순(' + want.join(' ← ') + ')', backs.join(' ← '));
    await H.fwd(); ok((await H.at()) === seen[1], label + ' 앞으로가기 1번 = ' + seen[1], await H.at());
    ok(H.writes.length === w0, label + ' 뒤로·앞으로 가는 동안 쓰기 요청 0', H.writes.slice(w0).join(','));
    await H.back();
}

async function tabs(H, page, sels, label) {
    await H.nav(page); const seen = [await H.at()];
    for (const s of sels) { await H.pg.locator(s).click(); await sleep(450); seen.push(await H.at()); }
    const uniq = seen.every((x, i) => i === 0 || x !== seen[i - 1]);
    ok(uniq, label + ' 탭 ' + sels.length + '번 전환 ' + seen.join(' → '), seen.join(' → '));
    const w0 = H.writes.length; const backs = [];
    for (let i = 0; i < sels.length; i++) { await H.back(); backs.push(await H.at()); }
    const want = seen.slice(0, -1).reverse();
    ok(JSON.stringify(backs) === JSON.stringify(want), label + ' 뒤로가기 ' + sels.length + '번 = 탭 역순', backs.join(' ← ') + ' (기대 ' + want.join(' ← ') + ')');
    await H.fwd(); ok((await H.at()) === seen[1], label + ' 앞으로가기 = ' + seen[1], await H.at());
    await H.back(); await H.back();
    ok((await H.page()) !== page && (await H.page()) !== '?', label + ' 한 번 더 = 이 메뉴에 오기 전 메뉴(' + (await H.page()) + ')', await H.at());
    ok(H.writes.length === w0, label + ' 뒤로가기 동안 쓰기 요청 0', H.writes.slice(w0).join(','));
}

(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
    let br;
    try {
        let up = false; for (let i = 0; i < 90; i++) { await sleep(1000); try { const r = await fetch(BASE + '/track-order'); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('로컬 서버가 안 떴어요');
        br = await chromium.launch();
        for (const w of WIDTHS) {
            console.log('\n━━ 관리자 · 폭 ' + w + ' ━━');
            let H = await open(br, w, ADMIN); const L = '[' + w + ' 관리자]';
            ok((await H.page()) === 'schedule', L + ' 처음 = 일정표 · 기록 칸에 메뉴 적힘', await H.at());
            await menus(H, ['settlement', 'pricing', 'worklog'], L);
            await tabs(H, 'settlement', ['.settlement-tab[data-tab="settlement-status"]', '.settlement-tab[data-tab="settlement-main"]', '.settlement-tab[data-tab="settlement-status"]'], L + ' 정산관리');
            await tabs(H, 'inquiry', ['#inquiry-tab-btn-products', '#inquiry-tab-btn-notify', '#inquiry-tab-btn-unanswered', '#unans-sub-btn-skip'], L + ' 문의 관리');
            await tabs(H, 'document', ['.doc-tab[data-doc-type="attendance"]', '.doc-main-tab[data-doc-main="history"]', '.doc-main-tab[data-doc-main="list"]'], L + ' 전자결재');
            await tabs(H, 'expense', ['#expense-tab-my', '#expense-tab-write', '#expense-tab-my'], L + ' 지출결의서');
            await tabs(H, 'myinfo', ['.ps-tab[data-pstab="pay"]', '.ps-tab[data-pstab="info"]'], L + ' 내 정보');
            await H.nav('schedule');
            { // 일정표 보기 전환(주간·월간·연간)
                await H.nav('worklog'); await H.nav('schedule'); const a0 = await H.at();
                await H.pg.locator('#schedule-view-toggle button[data-view="week"]').click(); await sleep(400); await H.pg.locator('#schedule-view-toggle button[data-view="year"]').click(); await sleep(400);
                await H.back(); const a1 = await H.at(); await H.back(); const a2 = await H.at();
                ok(/주간/.test(a1) && a2 === a0, L + ' 일정표 주간 → 연간 뒤 뒤로가기 2번 = 주간 → ' + a0, a1 + ' / ' + a2);
            }

            console.log('  · 공통 창');
            { // 알림 종 판
                const before = await H.at(); const bell = w < 769 ? '#mobile-noti-btn' : '#notification-bell';
                await H.pg.locator(bell).click(); await sleep(600); const o = await H.layers();
                await H.back(); const c = await H.layers();
                ok(o.noti && o.m === 1 && !c.noti && (await H.at()) === before, L + ' 알림 종 판 열고 뒤로가기 = 판만 닫힘(화면 그대로)', JSON.stringify({ o, c, at: await H.at() }));
                await H.pg.locator(bell).click(); await sleep(500); if (await H.pg.locator('.noti-close-btn').isVisible()) await H.pg.locator('.noti-close-btn').click(); else await H.pg.locator(bell).click();   // PC 폭에는 × 가 없다 → 종을 다시 눌러 닫는다
                await sleep(600); const x = await H.layers();
                ok(!x.noti && x.m === 0, L + ' 판을 화면에서(×·종 다시 누름) 닫으면 그 칸을 되돌림(akmM 0)', JSON.stringify(x));
                await H.pg.locator(bell).click(); await sleep(500); await H.pg.locator('#noti-hist-open').click(); await sleep(700); const h1 = await H.layers();
                await H.back(); const h2 = await H.layers();
                ok(h1.hist && !h1.noti && !h2.hist && (await H.at()) === before, L + ' 이전 알림 창 뒤로가기 = 창만 닫힘', JSON.stringify({ h1, h2 }));
                ok((await H.layers()).m === 0, L + ' 창이 다 닫힌 뒤 기록 칸 akmM 0', JSON.stringify(await H.layers()));
            }
            { // 정산 달력 날짜 창(.modal-overlay) — 뒤로가기 / × / 그 뒤 뒤로가기
                await H.nav('settlement'); await H.pg.waitForSelector('td[onclick*="showSettlementDayModal"]', { timeout: 40000 }); const before = await H.at();
                await H.pg.locator('td[onclick*="showSettlementDayModal"]').first().click(); await sleep(700); const o = await H.layers();
                const w0 = H.writes.length; await H.back(); const c = await H.layers();
                ok(o.modal === 1 && o.m === 1 && c.modal === 0 && (await H.at()) === before, L + ' 정산 날짜 창 열고 뒤로가기 = 창만 닫힘(정산관리 그대로)', JSON.stringify({ o, c, at: await H.at() }));
                ok(H.writes.length === w0, L + ' 창 닫히는 동안 쓰기 요청 0', H.writes.slice(w0).join(','));
                await H.pg.locator('td[onclick*="showSettlementDayModal"]').first().click(); await sleep(600); await H.pg.locator('.modal-overlay .modal-close').last().click(); await sleep(700); const x = await H.layers();
                ok(x.modal === 0 && x.m === 0, L + ' 창을 ×로 닫으면 그 칸을 되돌림', JSON.stringify(x));
                await H.pg.locator('td[onclick*="showSettlementDayModal"]').first().click(); await sleep(600); await H.pg.keyboard.press('Escape'); await sleep(700); const e = await H.layers();
                ok(e.modal === 0 && e.m === 0, L + ' Esc 로 닫아도 같음', JSON.stringify(e));
                await H.back(); ok((await H.page()) !== 'settlement', L + ' 그 뒤 뒤로가기 1번 = 헛돌지 않고 앞 메뉴(' + (await H.page()) + ')', await H.at());
            }
            if (w < 769) { // 폰 사이드바
                const before = await H.at(); await H.pg.locator('.mobile-menu-btn').click(); await sleep(500); const o = await H.layers();
                await H.back(); const c = await H.layers();
                ok(o.side && !c.side && (await H.at()) === before, L + ' 폰 사이드바 열고 뒤로가기 = 사이드바만 닫힘', JSON.stringify({ o, c }));
            }

            console.log('  · 새로고침 · 알림 해시');
            {
                await H.nav('settlement'); await H.pg.locator('.settlement-tab[data-tab="settlement-status"]').click(); await sleep(500); const before = await H.at();
                await H.pg.reload(); await H.pg.waitForFunction(() => !!(window.akmNavInit && history.state && history.state.akmNav && document.querySelector('#page-settlement.active')), null, { timeout: 40000 }); await sleep(900);
                ok((await H.at()) === before, L + ' 새로고침 뒤 같은 메뉴·같은 탭(' + before + ')', await H.at());
                await H.back(); ok(/^settlement\[정산관리/.test(await H.at()), L + ' 새로고침 뒤에도 뒤로가기 = 직전 탭(정산관리)', await H.at());
                await H.pg.evaluate(() => { location.hash = '#myinfo?pay=1'; }); await sleep(1600);
                const a = await H.at(), hash = await H.pg.evaluate(() => location.hash);
                ok(/^myinfo\[급여명세서/.test(a) && !hash, L + ' 알림 해시(#myinfo?pay=1) = 내 정보 > 급여명세서 · 해시 지워짐', a + ' ' + hash);
                await H.back(); const b1 = await H.at(); let hops = 1; if (!/^settlement/.test(b1)) { await H.back(); hops++; }
                ok(/^settlement/.test(await H.at()) && hops <= 2, L + ' 해시로 온 뒤 뒤로가기 = 오기 전 메뉴(정산관리 · ' + hops + '번)', b1 + ' → ' + await H.at());
                await H.pg.goto(BASE + '/#settlement:settlement-status'); await H.pg.waitForFunction(() => !!(history.state && history.state.akmNav), null, { timeout: 40000 }); await sleep(1500);
                ok(/^settlement\[정산현황/.test(await H.at()), L + ' 주소에 해시를 달고 직접 진입(#settlement:settlement-status) = 정산현황', await H.at());
            }

            console.log('  · 에이전트 오피스(ao-desk 겹과 같이)');
            {
                await H.nav('schedule'); await H.nav('agent-office'); await H.pg.waitForSelector('#desk-tabs .desk-tab', { timeout: 30000 }).catch(() => { }); await sleep(1200);
                const bell = w < 769 ? '#mobile-noti-btn' : '#notification-bell';
                const bellOk = await H.pg.locator(bell).isVisible().catch(() => false);   // PC 폭의 에이전트 오피스에는 알림 종이 없다(일정표 머리에만) → 그 폭에서는 종 항목을 건너뛴다
                if (bellOk) { await H.pg.locator(bell).click(); await sleep(600); const o = await H.layers(); await H.back(); const c = await H.layers();
                    ok(o.noti && !c.noti && (await H.page()) === 'agent-office', L + ' 에이전트 오피스에서 알림 종 판 뒤로가기 = 판만 닫힘', JSON.stringify({ o, c, p: await H.page() })); }
                const hasHb = await H.pg.evaluate(() => !!(window.AkmAoDesk && window.AkmAoDesk.histDepth));
                if (hasHb && await H.pg.locator('#desk-tab-all').isVisible().catch(() => false)) {
                    await H.pg.locator('#desk-tab-all').click(); await sleep(700); const d1 = await H.pg.evaluate(() => ({ d: window.AkmAoDesk.histDepth(), s: history.state }));
                    ok(d1.d === 1 && d1.s && d1.s.aoDesk === 1 && d1.s.akmNav && d1.s.akmNav.p === 'agent-office', L + ' ao-desk 겹 칸이 내 키(akmNav)를 이어 실음', JSON.stringify(d1));
                    if (bellOk) { await H.pg.locator(bell).click(); await sleep(600); const s2 = await H.pg.evaluate(() => history.state);
                        ok(s2 && s2.akmM === 1 && s2.aoDesk === 1, L + ' 그 위 공통 창 칸은 aoDesk 를 그대로 이어 실음', JSON.stringify(s2));
                        await H.back(); }
                    const d2 = await H.pg.evaluate(() => ({ d: window.AkmAoDesk.histDepth(), tab: document.querySelector('#desk-tabs .desk-tab[aria-selected="true"]').dataset.tab }));
                    ok(d2.d === 1 && d2.tab === 'all' && !(await H.layers()).noti, L + (bellOk ? ' 뒤로가기 1번 = 알림 종 판만(ao-desk 탭 겹은 그대로)' : ' ao-desk 탭 겹 열림(이전 채팅 이력)'), JSON.stringify(d2));
                    await H.back(); await sleep(300); const d3 = await H.pg.evaluate(() => ({ d: window.AkmAoDesk.histDepth(), tab: document.querySelector('#desk-tabs .desk-tab[aria-selected="true"]').dataset.tab }));
                    ok(d3.d === 0 && d3.tab === 'mine' && (await H.page()) === 'agent-office', L + ' 한 번 더 = ao-desk 탭 겹이 닫힘(에이전트 오피스 그대로)', JSON.stringify(d3));
                    await H.pg.locator('#desk-tab-all').click(); await sleep(700); await H.nav('worklog'); await sleep(1500);
                    let hops = 0; for (; hops < 4 && (await H.page()) !== 'agent-office'; hops++) await H.back(); await sleep(1500);
                    ok((await H.page()) === 'agent-office' && hops === 1, L + ' 겹을 연 채 다른 메뉴로 갔다가 뒤로가기 1번 = 에이전트 오피스', 'hops ' + hops + ' ' + await H.at());
                    for (hops = 0; hops < 4 && (await H.page()) !== 'schedule'; hops++) await H.back();
                    ok((await H.page()) === 'schedule' && hops <= 2, L + ' 거기서 뒤로가기(' + hops + '번) = 그 전 메뉴(일정표)', 'hops ' + hops + ' ' + await H.at());
                } else console.log('  ℹ️ ao-desk 뒤로가기(#677)가 아직 없는 본 — 겹 항목 건너뜀');
                await H.back();
            }
            ok(H.errs.length === 0, L + ' 화면 오류 0', H.errs.join(' | '));
            await H.ctx.close();

            console.log('\n━━ 직원 · 폭 ' + w + ' ━━');
            H = await open(br, w, STAFF); const S = '[' + w + ' 직원]';
            await menus(H, ['document', 'expense', 'myinfo'], S);
            await tabs(H, 'document', ['.doc-tab[data-doc-type="attendance"]', '.doc-tab[data-doc-type="reason"]', '.doc-tab[data-doc-type="vacation"]'], S + ' 전자결재');
            await tabs(H, 'inquiry', ['#inquiry-tab-btn-products', '#inquiry-tab-btn-holiday'], S + ' 문의 관리');
            ok(H.errs.length === 0, S + ' 화면 오류 0', H.errs.join(' | '));
            await H.ctx.close();
        }
    } catch (e) { fail++; console.log('  ❌ 중단: ' + (e && e.stack || e)); try { for (const x of br.contexts()) for (const p of x.pages()) console.log('     그때 화면: ' + p.url() + ' · ' + await p.evaluate(() => JSON.stringify({ st: history.state, len: history.length, login: !!document.querySelector('#login-page') && getComputedStyle(document.querySelector('#login-page')).display, nav: document.querySelectorAll('.nav-item').length, body: document.body.innerText.slice(0, 80) }))); } catch (_) { } }
    finally { try { if (br) await br.close(); } catch (_) { } try { srv.kill(); } catch (_) { } }
    console.log('\n결과 ' + pass + '/' + (pass + fail)); process.exit(fail ? 1 : 0);
})();
