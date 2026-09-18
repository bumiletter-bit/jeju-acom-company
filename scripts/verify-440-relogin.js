// #440 검증: 로컬 실서버(3457·스케줄러 차단·실DB) + Playwright 실클릭
//  ① 수동 로그인(폼 제출) → 실제 페이지 재로드(navigation) 발생 · 이전 메모리 상태(중간발주 집계 흔적) 초기화
//  ② [중간발주 시작하기]·[네이버 불러오기] 클릭마다 /api/invoice/catalog 재요청(단가표 품목명 매번 새로 읽음)
//  ③ pageerror 0 · 기존 화면(송장변환 카탈로그 표시) 무회귀
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path');
const PORT = 3457;
let pass = 0, fail = 0;
const ok = (name, c, note) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + name + (note ? ' — ' + note : '')); };
(async () => {
    let srv = null, browser = null;
    try {
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
        let up = false;
        for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } if (srv.exitCode !== null) break; }
        ok('로컬 실서버 기동', up, up ? '' : log.slice(-300));
        if (!up) throw new Error('서버 기동 실패');
        await new Promise(r => setTimeout(r, 2500));
        const token = jwt.sign({ id: 1, username: 'ceo', name: '전승범', role: 'admin' }, 'verifytest', { expiresIn: '10m' });
        const user = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표', annualLeave: 15, color: '#3b82f6' };
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const pg = await browser.newPage();
        const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 80)));
        pg.on('dialog', d => d.dismiss());
        let catalogReq = 0, navs = 0;
        pg.on('request', r => { if (/\/api\/invoice\/catalog/.test(r.url())) catalogReq++; });
        pg.on('framenavigated', f => { if (f === pg.mainFrame()) navs++; });
        // 로그인 POST는 route로 가로채 실계정 없이 토큰 발급(실DB 무변경)
        await pg.route('**/api/auth/login', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token, user }) }));
        // ── ① 수동 로그인 → 재로드
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.waitForTimeout(1200);
        const loginVisible = await pg.evaluate(() => { const l = document.getElementById('login-page'); return !!l && l.style.display !== 'none'; });
        ok('① 로그인 화면 표시(토큰 없음)', loginVisible);
        // 이전 세션 흔적을 흉내: 전역 변수에 값을 심어두고 로그인 후 사라지는지
        await pg.evaluate(() => { window.__prevSessionMarker = 'STALE'; });
        const navBefore = navs;
        await pg.fill('#login-username', 'ceo'); await pg.fill('#login-password', 'x');
        await Promise.all([pg.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null), pg.click('#login-form button[type=submit], #login-form [type=submit]').catch(async () => { await pg.evaluate(() => document.getElementById('login-form').requestSubmit()); })]);
        await pg.waitForTimeout(3500);
        const afterNav = navs > navBefore;
        const marker = await pg.evaluate(() => window.__prevSessionMarker || null);
        const appShown = await pg.evaluate(() => { const a = document.querySelector('.app'); return !!a && a.style.display === 'flex'; });
        ok('① 수동 로그인 = 페이지 재로드 발생', afterNav, `navigation ${navs - navBefore}회`);
        ok('① 이전 세션 메모리 초기화(심어둔 마커 소멸)', marker === null, String(marker));
        ok('① 재로드 후 자동 로그인으로 앱 화면 표시', appShown);
        // ── ② 송장변환 진입 → 카탈로그 1회, 이후 버튼 클릭마다 재요청
        await pg.evaluate(() => switchPage('invoice')); await pg.waitForTimeout(2500);
        const c0 = catalogReq;
        ok('② 송장변환 진입 시 카탈로그 로드', c0 >= 1, `요청 ${c0}회`);
        const catText = await pg.evaluate(() => (document.getElementById('invoice-catalog-list') || {}).innerText || '');
        ok('③ 카탈로그 표시 무회귀(오늘 품목 N개)', /총\s*\d+\s*개 품목/.test(catText), catText.slice(0, 40).replace(/\n/g, ' '));
        // 중간발주 탭의 시작 버튼 — 클릭 시 catalog 재요청 (채널 조회는 로컬에서 실패해도 무방)
        // #452-p: 송장변환 = iframe(v2) — 버튼은 프레임 안에서(구버전은 #page-invoice-legacy에 숨김)
        const fr = pg.frameLocator('#invoice-v2-frame'); await pg.waitForFunction(() => { const f = document.getElementById('invoice-v2-frame'); return f && f.contentWindow && f.contentWindow.__ivt; }, null, { timeout: 20000 });
        await fr.locator('#ivt-mode-qty').click(); await pg.waitForTimeout(300);
        await fr.locator('#ivt-qty-start').click({ force: true }); await pg.waitForTimeout(4000);
        const c1 = catalogReq;
        ok('② [중간발주 시작하기] 클릭 → 카탈로그 재요청', c1 > c0, `${c0}→${c1}`);
        await fr.locator('#ivt-mode-convert').click(); await pg.waitForTimeout(300);
        await fr.locator('#btn-naver').click({ force: true }); await pg.waitForTimeout(4000);
        const c2 = catalogReq;
        ok('② [네이버 배송준비 불러오기] 클릭 → 카탈로그 재요청', c2 > c1, `${c1}→${c2}`);
        // ── ④ #441 로그아웃 즉시 재로드 — 앱 상태 마커 심고 로그아웃 → navigation + 로그인 화면 + 마커 소멸
        await pg.evaluate(() => { window.__appMarker = 'LIVE'; });
        const navL = navs;
        await Promise.all([pg.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null), pg.click('#btn-logout', { force: true })]);
        await pg.waitForTimeout(2500);
        const loginAgain = await pg.evaluate(() => { const l = document.getElementById('login-page'); return !!l && l.style.display !== 'none'; });
        const markerL = await pg.evaluate(() => window.__appMarker || null);
        const tokenGone = await pg.evaluate(() => localStorage.getItem('jwt_token') === null);
        ok('④ 로그아웃 클릭 = 페이지 재로드 + 로그인 화면 + 메모리 마커 소멸 + 토큰 제거', navs > navL && loginAgain && markerL === null && tokenGone, `navigation ${navs - navL}회 · 마커 ${markerL}`);
        ok('③ pageerror 0', errs.length === 0, errs.join(' | ') || '없음');
    } catch (e) { ok('예외 없음', false, e.message.slice(0, 160)); }
    finally { if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail === 0 ? 0 : 1);
})();
