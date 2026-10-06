// #563 검증: 왼쪽 메뉴 스크롤 막대 = 인디고 · 「CS처리방」 메뉴 제거
//   사용: node scripts/verify-563-nav.js [스크린샷 폴더]
//   로컬 실서버 3461(스케줄러 차단) · GET 은 실서버(읽기) · GET 이 아닌 요청은 전부 가로채 { ok:true } → DB 쓰기 0.
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT563) || 3461;
const SHOT = process.argv[2] || null;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 1500) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'nav563-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'nav563-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const mgr = (await db.query(`SELECT id, name, position FROM users WHERE role = 'admin' AND position <> '대표' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        const stf = (await db.query(`SELECT id, name, position FROM users WHERE role NOT IN ('admin','accountant') AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        await db.end();
        const users = {
            대표: { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' },
            과장: { id: mgr.id, name: mgr.name, position: mgr.position || '과장', role: 'admin' },
            직원: { id: stf.id, name: stf.name, position: stf.position || '사원', role: 'user' },
        };

        // 테마 토큰 실값(파일에서 읽음 — 숫자를 검증에 박지 않는다)
        const css = fs.readFileSync(path.join(ROOT, 'public/theme.css'), 'utf8');
        const tok = n => { const m = new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})').exec(css); return m ? m[1] : null; };
        const rgb = h => { const v = parseInt(h.slice(1), 16); return `rgb(${v >> 16}, ${(v >> 8) & 255}, ${v & 255})`; };
        const PRIMARY = rgb(tok('primary')), PLIGHT = rgb(tok('primary-light')), BORDER = rgb(tok('border'));
        ok('테마 토큰 읽음(--primary ' + tok('primary') + ' · --primary-light ' + tok('primary-light') + ')', !!tok('primary') && !!tok('primary-light') && !!tok('border'));

        const LINES = css.split(/\r?\n/);
        const OLD_CSS = LINES.filter(l => !/#563|\.sidebar-nav::-webkit-scrollbar|scrollbar-color/.test(l)).join('\n');
        ok('종전 CSS 만들기(#563 줄 5개만 뺌)', LINES.length - OLD_CSS.split('\n').length === 5);
        const { chromium } = require('playwright');
        browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });   // 헤드리스 기본값은 스크롤 막대를 숨긴다 → 실제 자리(굵기)를 재려면 꺼야 한다
        const open = async (user, vw, extra, lastPage, oldCss) => {
            const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block' }, extra || {}));   // 서비스 워커가 CSS 를 대신 내주면 종전 CSS 끼우기가 안 먹는다
            const pg = await ctx.newPage(); const errors = [], writes = [];
            pg.on('pageerror', e => errors.push(String(e)));
            pg.on('dialog', d => d.dismiss());
            await pg.route('**/api/**', route => {
                const rq = route.request();
                if (rq.method() === 'GET') return route.continue();
                writes.push(rq.method() + ' ' + new URL(rq.url()).pathname);
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
            });
            if (oldCss) await pg.route('**/theme.css*', route => route.fulfill({ status: 200, contentType: 'text/css', body: OLD_CSS }));   // #563 줄만 뺀 종전 CSS
            const t = jwt.sign(user, 'verifytest', { expiresIn: '30m' });
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([tk, u, lp]) => { localStorage.setItem('jwt_token', tk); localStorage.setItem('jwt_user', JSON.stringify(u)); if (lp) localStorage.setItem('akm_last_page', lp); else localStorage.removeItem('akm_last_page'); }, [t, user, lastPage || null]);
            await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(2500);
            await pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important}' });   // 실DB 대기 확인표 창이 클릭을 가리지 않게(#548 함정)
            return { pg, ctx, errors, writes };
        };
        const shot = async (pg, name) => { if (!SHOT) return; try { fs.mkdirSync(SHOT, { recursive: true }); await pg.screenshot({ path: path.join(SHOT, name + '.png') }); } catch (_) { } };
        const navList = pg => pg.evaluate(() => Array.from(document.querySelectorAll('.sidebar-nav .nav-item[data-page]')).filter(a => getComputedStyle(a).display !== 'none').map(a => ({ page: a.dataset.page, text: (a.querySelector('.nav-text') || a).textContent.trim() })));
        const activePage = pg => pg.evaluate(() => { const p = document.querySelector('.page.active'); return p ? p.id.replace(/^page-/, '') : ''; });
        const bar = pg => pg.evaluate(() => {
            const nav = document.querySelector('.sidebar-nav'), g = (el, ps, p) => getComputedStyle(el, ps)[p];
            const items = Array.from(nav.querySelectorAll('.nav-item')).filter(a => getComputedStyle(a).display !== 'none');
            return { scrolls: nav.scrollHeight > nav.clientHeight + 1, thumb: g(nav, '::-webkit-scrollbar-thumb', 'backgroundColor'), track: g(nav, '::-webkit-scrollbar-track', 'backgroundColor'), w: g(nav, '::-webkit-scrollbar', 'width'), gutter: nav.offsetWidth - nav.clientWidth,
                other: g(document.querySelector('.main-content') || document.body, '::-webkit-scrollbar-thumb', 'backgroundColor'), otherW: g(document.body, '::-webkit-scrollbar', 'width'),
                rects: items.map(a => { const r = a.getBoundingClientRect(), t = a.querySelector('.nav-text').getBoundingClientRect(); return [Math.round(r.left * 10), Math.round(r.width * 10), Math.round(t.left * 10)].join(); }).join('|') };
        });
        const openMenu = async pg => { if (await pg.evaluate(() => !document.querySelector('.sidebar').classList.contains('mobile-open'))) { await pg.click('.mobile-menu-btn'); await pg.waitForTimeout(450); } };

        // ══ 세 계정 × PC(1400) · 폰(390) ═══════════════════════════════════════════════════════
        const want = { 대표: true, 과장: false, 직원: false };   // 데이터관리 메뉴가 보이는가(#561)
        for (const [who, user] of Object.entries(users)) {
            for (const dev of ['PC', '폰']) {
                const phone = dev === '폰', tag = `${who}·${dev}`;
                // 높이를 낮춰 메뉴가 넘치게 한다(스크롤 막대가 실제로 생기는 조건)
                const vwBar = phone ? { width: 390, height: 560 } : { width: 1400, height: 520 };
                const P = await open(user, vwBar, phone ? { isMobile: true, hasTouch: true } : null);
                if (phone) await openMenu(P.pg);
                const nav = await navList(P.pg);
                ok(`[${tag}] 메뉴에 「CS처리방」 없음 · 메뉴 ${nav.length}개`, nav.length >= 5 && !nav.some(n => n.page === 'cs-room' || /CS처리방/.test(n.text)), nav.map(n => n.text).join(' · '));
                ok(`[${tag}] 데이터관리 메뉴 = ${want[who] ? '있음' : '없음'}(#561 그대로)`, nav.some(n => n.page === 'data') === want[who]);
                const b = await bar(P.pg);
                ok(`[${tag}] 메뉴가 넘쳐 스크롤이 생김(시험 조건)`, b.scrolls, JSON.stringify([b.scrolls, b.gutter]));
                ok(`[${tag}] 메뉴 스크롤 막대 = 인디고(--primary) · 길 = --primary-light`, b.thumb === PRIMARY && b.track === PLIGHT, `${b.thumb} / ${b.track}`);
                ok(`[${tag}] 막대 굵기 9px 그대로 · 다른 화면의 막대는 종전 회색(--border)`, b.w === '9px' && b.otherW === '9px' && b.other === BORDER, `${b.w} · ${b.other}`);
                // #563 줄을 뺀 종전 CSS 로 같은 화면을 열어 메뉴 글자 자리를 비교 → 밀림 0
                const P0 = await open(user, vwBar, phone ? { isMobile: true, hasTouch: true } : null, null, true);
                if (phone) await openMenu(P0.pg);
                const b0 = await bar(P0.pg); await P0.ctx.close();
                ok(`[${tag}] 종전 CSS(회색 막대)와 메뉴 글자 자리·너비 같음(밀림 0) · 막대가 차지하는 자리 9px 그대로`, b0.thumb === BORDER && b0.rects === b.rects && b0.gutter === b.gutter && b.gutter === 9, `종전 색 ${b0.thumb} · 자리 차이 ${b0.rects === b.rects ? 0 : 'O'} · 막대 자리 ${b0.gutter}→${b.gutter}px`);
                await shot(P.pg, `563-${who}-${phone ? 'phone' : 'pc'}`);
                // 나머지 메뉴 전부 실클릭 → 각 화면 열림
                //   폰 에뮬레이터는 가로로 넘치는 화면(정산관리 등 · #487 때부터 있던 것)을 다녀오면 화면 배율이 바뀌어 고정 메뉴의 클릭 좌표가 어긋난다
                //   → 클릭이 막히면 새 폰 화면(390×844)을 열어 그 메뉴만 다시 눌러 본다(fresh 로 센다)
                const stOf = (pg, p) => pg.evaluate(p => { const el = document.getElementById('page-' + p), a = document.querySelector('.page.active'); return { on: !!el && el.classList.contains('active') && el.getClientRects().length > 0, only: document.querySelectorAll('.page.active').length === 1, act: a ? a.id : '', nav: !!document.querySelector(`.nav-item.active[data-page="${p}"]`), body: el ? el.innerText.trim().length : 0 }; }, p);
                const miss = []; let fresh = 0;
                for (const n of nav) {
                    const sel = `.sidebar-nav .nav-item[data-page="${n.page}"]`; let pg = P.pg, F = null;
                    if (phone) await openMenu(pg);
                    try { await pg.locator(sel).scrollIntoViewIfNeeded({ timeout: 5000 }); await pg.click(sel, { timeout: 5000 }); }
                    catch (e) {
                        if (!phone) { miss.push(n.text + ' 클릭 불가'); continue; }
                        fresh++; F = await open(user, { width: 390, height: 844 }, { isMobile: true, hasTouch: true }); pg = F.pg;
                        try { await openMenu(pg); await pg.locator(sel).scrollIntoViewIfNeeded({ timeout: 5000 }); await pg.tap(sel, { timeout: 8000 }); }
                        catch (e2) { miss.push(n.text + ' 새 화면에서도 클릭 불가'); await F.ctx.close(); continue; }
                    }
                    await pg.waitForTimeout(700);
                    const st = await stOf(pg, n.page);
                    if (!(st.on && st.only && st.nav && st.body > 0)) miss.push(n.text + JSON.stringify(st));
                    if (F) { if (F.errors.length) miss.push(n.text + ' 오류 ' + F.errors[0]); await F.ctx.close(); }
                }
                ok(`[${tag}] 메뉴 ${nav.length}개 전부 클릭 → 각 화면이 열림(화면 하나만 · 메뉴 표시 · 내용 있음)${fresh ? ' · 새 폰 화면에서 다시 누른 메뉴 ' + fresh + '개' : ''}`, miss.length === 0, miss.join(' / '));
                // 숨긴 화면으로 직접 들어가기
                const direct = await P.pg.evaluate(() => { try { switchPage('cs-room'); } catch (e) { return 'ERR ' + e.message; } const a = document.querySelector('.page.active'), cs = document.getElementById('page-cs-room'); return (a ? a.id : '') + '|' + (cs ? cs.getClientRects().length : 'none'); });
                ok(`[${tag}] switchPage('cs-room') → 일정표 · CS처리방 화면은 안 보임`, direct === 'page-schedule|0', direct);
                ok(`[${tag}] 화면 오류 0`, P.errors.length === 0, P.errors.slice(0, 3).join(' | '));
                await P.ctx.close();
            }
        }

        // ══ 마지막에 보던 화면이 CS처리방이던 사람 — 새로고침 복원 ══════════════════════════════════
        for (const [who, vw, extra] of [['직원', { width: 1400, height: 900 }, null], ['직원', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }]]) {
            const R = await open(users[who], vw, extra, 'cs-room');
            const act = await activePage(R.pg), last = await R.pg.evaluate(() => localStorage.getItem('akm_last_page'));
            const navOk = await R.pg.evaluate(() => !!document.querySelector('.nav-item.active[data-page="schedule"]'));
            ok(`[복원·${vw.width}] 저장된 마지막 화면 = cs-room → 일정표로 열림 · 저장값도 일정표로 · 오류 0`, act === 'schedule' && last === 'schedule' && navOk && R.errors.length === 0, `${act} · ${last} · ${R.errors.join(' | ')}`);
            await R.ctx.close();
        }
        // 남긴 것 확인
        const src = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'), app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
        ok('index.html: 메뉴 항목(data-page="cs-room") 0 · 화면 마크업(#page-cs-room)은 hidden 으로 남김', !/data-page="cs-room"/.test(src) && /id="page-cs-room" class="page" data-legacy="563" hidden/.test(src));
        ok('app.js: CS 문구 함수(renderCsTemplates 등)는 남김 · switchPage 의 진입 호출만 없앰', /async function renderCsTemplates\(/.test(app) && !/pageName === 'cs-room'\) renderCsTemplates/.test(app) && /pageName === 'cs-room'\) pageName = 'schedule'/.test(app));
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 14).join(' / ') : String(e)); }
    finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) srv.kill();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
