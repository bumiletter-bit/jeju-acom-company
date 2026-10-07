// #578 화면 다듬기 검증 — 로컬 실서버(스케줄러 차단) · 실렌더 · 쓰기는 전부 가로챔(DB 쓰기 0) · 외부 조회는 끊음
//   node scripts/verify-578-polish.js [묶음,…]   묶음 = flow(넘침) · modal(창 닫기) · login(로그인·만료) · alert(안내 방식) · text(빈 상태·표기)
//   포트 = PORT578 || 3461
const fs = require('fs'), path = require('path');
const H = require('./ao-dark/harness.js');
const PORT = Number(process.env.PORT578) || 3461, BASE = 'http://localhost:' + PORT;
const ONLY = (process.argv[2] || 'flow,modal,login,alert,text').split(',');
const PAGES = ['agent-office', 'schedule', 'rankings', 'worklog', 'planner', 'document', 'expense', 'settlement', 'pricing', 'inventory', 'invoice', 'organizer', 'inquiry', 'data', 'myinfo'];
const TAB_SEL = '.doc-main-tab, .doc-tab, .settlement-tab, .btn-toggle, [role="tab"], [class*="tab-btn"], .desk-tab, [class*="subtab"], [class*="sub-tab"]';
const EXT = /\/api\/(agent-office\/(naver\/(test|settlements|invoice-orders|invoice-orders-v2|qnas|inquiries)|coupang\/|cafe24\/)|cafe24\/)/;
const PHONE = { width: 390, height: 844 }, PC = { width: 1440, height: 900 };
let pass = 0, fail = 0; const fails = [];
const ok = (cond, name, note) => { if (cond) pass++; else { fail++; fails.push(name); } console.log((cond ? '✅ ' : '❌ ') + name + (note !== undefined && note !== '' ? ' — ' + note : '')); };
const cur = pg => pg.evaluate(() => { const p = document.querySelector('.page.active'); return p ? p.id.replace(/^page-/, '') : ''; });
const idle = (pg, ms) => pg.waitForLoadState('networkidle', { timeout: ms || 7000 }).catch(() => { });
const extOff = pg => pg.route(u => EXT.test(u.pathname), r => r.abort());

// 이 메뉴의 탭을 하나씩 눌러 가며 fn(탭 이름) 실행 — fn 이 true 를 돌려주면 멈춤
async function eachTab(pg, page, phone, fn) {
    if (await fn('처음')) return true;
    const visited = [];
    for (let round = 0; round < 24; round++) {
        const tabs = await pg.evaluate(([sel, vs]) => { const act = document.querySelector('.page.active'); if (!act) return []; act.querySelectorAll('[data-v578-tab]').forEach(e => e.removeAttribute('data-v578-tab')); const out = []; let i = 0; for (const e of act.querySelectorAll(sel)) { if (!e.getClientRects().length) continue; const text = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16); const key = (typeof e.className === 'string' ? e.className.split(/\s+/)[0] : '') + ':' + text; if (vs.includes(key)) continue; e.setAttribute('data-v578-tab', i); out.push({ i: i++, text, key }); } return out; }, [TAB_SEL, visited]);
        if (!tabs.length) break; const tab = tabs[0]; visited.push(tab.key);
        const loc = pg.locator(`.page.active [data-v578-tab="${tab.i}"]`).first();
        const real = await loc.click({ timeout: 2500 }).then(() => true).catch(() => false);
        if (!real) await loc.evaluate(el => el.click()).catch(() => { });
        await pg.waitForTimeout(600); await idle(pg, 6000);
        if (await fn('탭 ' + tab.text, real)) return true;
        if (await cur(pg) !== page) await H.navTo(pg, page, phone);
    }
    return false;
}

// ── flow: 가로 넘침 · 가려진 탭
const measure = (pg, T) => pg.evaluate(T => {
    const sw = Math.max(document.documentElement.scrollWidth, document.scrollingElement.scrollWidth);
    // 제 칸보다 넓은데 옆으로 밀 수도 없는(잘려 안 보이는) 표
    const cut = []; const act = document.querySelector('.page.active');
    if (act) for (const t of act.querySelectorAll('table')) { if (!t.getClientRects().length) continue; const r = t.getBoundingClientRect(); if (r.width < 40) continue; let scroller = null, clipper = null; for (let e = t.parentElement; e && e !== document.body; e = e.parentElement) { const ox = getComputedStyle(e).overflowX; if (ox === 'auto' || ox === 'scroll') { scroller = e; break; } if (ox === 'hidden' || ox === 'clip') { const er = e.getBoundingClientRect(); if (r.right > er.right + 2) { clipper = e; break; } } } if (clipper && !scroller) cut.push((t.id || t.className || 'table') + ' ' + Math.round(r.width)); else if (!scroller && r.right > T + 1) cut.push((t.id || t.className || 'table') + ' →' + Math.round(r.right)); }
    return { sw, cut };
}, T);
async function flow(h) {
    for (const [who, dev] of [['대표', '폰'], ['직원', '폰'], ['대표', 'PC'], ['직원', 'PC']]) {
        const phone = dev === '폰', T = phone ? 390 : 1440;
        const P = await h.open(h.users[who], phone ? PHONE : PC, { phone, routes: extOff });
        const bad = [], cutT = [], hidTab = []; let n = 0, menus = 0;
        for (const page of PAGES) {
            const at = await H.navTo(P.pg, page, phone); if (at !== page) continue; menus++;
            await idle(P.pg, 8000); await P.pg.waitForTimeout(400);
            await eachTab(P.pg, page, phone, async (label, real) => { const m = await measure(P.pg, T); n++; if (m.sw > T) bad.push(`${page}/${label} ${m.sw}`); if (m.cut.length) cutT.push(`${page}/${label} ${m.cut.join(',')}`); if (real === false) hidTab.push(page + '/' + label); });
        }
        ok(menus >= (who === '대표' ? 15 : 11), `[flow ${who}·${dev}] 메뉴가 열림`, menus + '개 · 화면 ' + n);
        ok(bad.length === 0, `[flow ${who}·${dev}] 전 메뉴·전 탭 scrollWidth ≤ ${T}`, bad.length ? bad.slice(0, 6).join(' · ') : n + '화면');
        ok(cutT.length === 0, `[flow ${who}·${dev}] 넓은 표는 제 칸 안에서 옆으로 밀림(잘려 안 보이는 표 0)`, cutT.slice(0, 5).join(' · '));
        ok(hidTab.length === 0, `[flow ${who}·${dev}] 탭을 전부 실제 누름으로 누를 수 있음(가려진 탭 0)`, hidTab.slice(0, 6).join(' · '));
        ok(P.errors.length === 0, `[flow ${who}·${dev}] pageerror 0`, P.errors.slice(0, 2).join(' | '));
        await P.ctx.close();
    }
}

// ── modal: Esc · 바깥 누름 · × 크기 · 쓰던 글 보호
const MODALS = [
    ['대표', 'schedule', 'openAnnouncementModal', '지시사항 전달'],
    ['대표', 'planner', 'openDdayModal', 'D-day 추가'],
    ['대표', 'document', 'openManualDocModal', '수기 이력 추가'],
    ['대표', 'document', 'openLeaveAdjModal', '연차 조정'],
    ['대표', 'expense', 'viewExpenseDetail', '지출결의서 상세'],
    ['대표', 'settlement', 'openCjCarryoverModal', 'CJ 이월금액'],
    ['대표', 'settlement', 'viewSettlementItems', '정산 상세'],
    ['대표', 'pricing', 'editPricing', '품목별 금액 수정'],
    ['대표', 'data', '#btn-add-user', '직원 추가'],
    ['대표', 'data', 'openUserModal', '직원 수정'],
    ['직원', 'document', 'openModRequestModal', '서류 수정 요청'],
    ['대표', 'worklog', 'openWorklogModal', '업무일지'],
];
const topOv = pg => pg.evaluate(() => { const o = [...document.querySelectorAll('.modal-overlay')].filter(e => e.isConnected && getComputedStyle(e).display !== 'none' && !e.classList.contains('ao-settle-overlay')).pop(); if (!o) return null; const x = o.querySelector('.modal-close'); const xr = x && x.getClientRects().length ? x.getBoundingClientRect() : null; const p = o.firstElementChild.getBoundingClientRect(); return { x: xr ? Math.round(xr.width) + '×' + Math.round(xr.height) : '', xmin: xr ? Math.min(xr.width, xr.height) : null, xIn: xr ? xr.left >= -1 && xr.right <= innerWidth + 1 && xr.top >= -1 : null, panel: [Math.round(p.left), Math.round(p.top), Math.round(p.right), Math.round(p.bottom)], iw: innerWidth, ih: innerHeight, title: ((o.querySelector('h1,h2,h3') || {}).textContent || '').trim().slice(0, 20) }; });
async function modal(h) {
    for (const dev of ['PC', '폰']) {
        const phone = dev === '폰'; const ctxs = {};
        for (const [who, page, fn, name] of MODALS) {
            const P = ctxs[who] || (ctxs[who] = await h.open(h.users[who], phone ? PHONE : PC, { phone, routes: extOff }));
            const sel = fn[0] === '#' ? fn : `.page.active [onclick*="${fn}("]`;
            const openIt = async () => {
                if (await cur(P.pg) !== page) { await H.navTo(P.pg, page, phone); await idle(P.pg, 8000); }
                let opened = false;
                if (await topOv(P.pg)) { await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(300); }   // 앞 시험에서 늦게 뜬 창이 남아 있으면 걷고 시작
                const tryHere = async () => { const loc = P.pg.locator(sel).locator('visible=true').first(); if (!(await loc.count())) return false; await loc.scrollIntoViewIfNeeded().catch(() => { }); const real = await loc.click({ timeout: 2500 }).then(() => true).catch(() => false); if (!real) return false; for (let k = 0; k < 24 && !opened; k++) { await P.pg.waitForTimeout(250); opened = !!(await topOv(P.pg)); } return opened; };   // 상세 창은 서버 답이 온 뒤에 뜬다(느릴 때 최대 6초)
                for (let t = 0; t < 2 && !opened; t++) { if (t) { await H.navTo(P.pg, page, phone); await idle(P.pg, 8000); await P.pg.waitForTimeout(800); } if (!(await tryHere())) await eachTab(P.pg, page, phone, async () => tryHere()); }
                return opened;
            };
            const tag = `[modal ${dev}] ${name}`;
            if (!(await openIt())) { const dg = await P.pg.evaluate(sel => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); const fx = [...document.querySelectorAll('body *')].filter(x => getComputedStyle(x).position === 'fixed' && x.getClientRects().length && x.getBoundingClientRect().width > innerWidth * .5 && x.getBoundingClientRect().height > innerHeight * .5).map(x => x.id || x.className).join(','); const p = document.querySelector('.page.active'); return { page: p && p.id, n: document.querySelectorAll(sel).length, mid: e && (e.id || e.className), fixed: fx, login: getComputedStyle(document.getElementById('login-page')).display }; }, sel).catch(e => String(e)); ok(false, `${tag}: 실제 누름으로 열림`, '여는 버튼을 못 찾음(' + fn + ') ' + JSON.stringify(dg)); continue; }
            const m = await topOv(P.pg);
            ok(true, `${tag}: 실제 누름으로 열림`, m.title);
            if (m.x) ok(m.xmin >= 44 && m.xIn, `${tag}: 닫기 × 44×44 이상 · 화면 안`, m.x);
            ok(m.panel[0] >= -1 && m.panel[2] <= m.iw + 1, `${tag}: 창이 화면 너비 안`, `${m.panel[0]}~${m.panel[2]} / ${m.iw}`);
            await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(350);
            ok(!(await topOv(P.pg)), `${tag}: Esc 로 닫힘`);
            if (await topOv(P.pg)) { await P.pg.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(o => { if (!o.classList.contains('ao-settle-overlay')) { if (o.id) o.style.display = 'none'; else o.remove(); } })); }
            // 바깥(어두운 바탕) 누름
            if (!(await openIt())) { ok(false, `${tag}: 다시 열림(Esc 뒤)`); continue; }
            const m2 = await topOv(P.pg); const pt = m2.panel[1] > 14 ? [m2.iw / 2, 5] : (m2.panel[0] > 14 ? [5, m2.ih / 2] : (m2.panel[3] < m2.ih - 14 ? [m2.iw / 2, m2.ih - 5] : null));
            if (!pt) { ok(true, `${tag}: 바깥 누름 — 창이 화면을 다 채워 바깥이 없음(건너뜀)`); await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(300); continue; }
            // 쓰던 글이 있으면 바깥 누름으로는 안 닫힘
            const inp = P.pg.locator('.modal-overlay').locator('visible=true').last().locator('textarea, input[type="text"]:not([readonly]), input:not([type]):not([readonly]), input[type="number"]').locator('visible=true').first();
            if (await inp.count()) {
                await inp.click({ timeout: 2000 }).catch(() => { }); await P.pg.keyboard.type('1'); await P.pg.waitForTimeout(100);
                await P.pg.mouse.click(pt[0], pt[1]); await P.pg.waitForTimeout(350);
                ok(!!(await topOv(P.pg)), `${tag}: 글을 쓰던 중이면 바깥을 눌러도 안 닫힘`);
                await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(350);
                ok(!(await topOv(P.pg)), `${tag}: 쓰던 중에도 Esc 로는 닫힘`);
                if (!(await openIt())) { ok(false, `${tag}: 다시 열림(쓰던 글 시험 뒤)`); continue; }
            }
            await P.pg.mouse.click(pt[0], pt[1]); await P.pg.waitForTimeout(350);
            ok(!(await topOv(P.pg)), `${tag}: 바깥(어두운 바탕) 누름으로 닫힘`, `(${Math.round(pt[0])},${Math.round(pt[1])})`);
            if (await topOv(P.pg)) await P.pg.keyboard.press('Escape');
            ok(await P.pg.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden' || !!document.querySelector('.fo-open, .desk-full-open')), `${tag}: 닫은 뒤 바탕이 다시 움직임(스크롤 잠김 없음)`);
        }
        for (const who in ctxs) { ok(ctxs[who].errors.length === 0, `[modal ${dev}] ${who} pageerror 0`, ctxs[who].errors.slice(0, 2).join(' | ')); await ctxs[who].ctx.close(); }
        // Esc 는 맨 위 창만: 최종발주 창 위에 뜬 창을 Esc 로 닫아도 최종발주 창은 남는다
        if (!phone) {
            const P = await h.open(h.users['대표'], PC, { routes: extOff, page: 'agent-office' });
            await H.navTo(P.pg, 'agent-office', false); await idle(P.pg, 8000);
            const chip = P.pg.locator('.desk-chip', { hasText: '최종발주' }).first();
            if (await chip.count()) {
                await chip.click({ timeout: 3000 }).catch(() => { }); await P.pg.waitForTimeout(1200);
                const foOpen = () => P.pg.evaluate(() => { const p = document.getElementById('fo-panel'); return !!p && p.getClientRects().length > 0 && getComputedStyle(p).display !== 'none'; });
                ok(await foOpen(), '[modal PC] 최종발주 창이 열림');
                await P.pg.evaluate(() => { const o = document.createElement('div'); o.className = 'modal-overlay'; o.id = 'v578-probe'; o.innerHTML = '<div class="modal"><button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()">×</button><h3>검증</h3></div>'; o.style.zIndex = 99999; document.body.appendChild(o); });
                await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(350);
                ok(await P.pg.evaluate(() => !document.getElementById('v578-probe')) && await foOpen(), '[modal PC] Esc = 맨 위 창만 닫힘(아래 최종발주 창은 그대로)');
                await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(500);
                ok(!(await foOpen()), '[modal PC] 한 번 더 Esc → 최종발주 창이 종전대로 닫힘');
            } else ok(false, '[modal PC] 최종발주 버튼을 못 찾음');
            await P.ctx.close();
        }
    }
}

// ── login: 로그인 화면 · 오류 글 · 만료 흐름
const KO_ONLY = t => !!t && /[가-힣]/.test(t) && !/[A-Za-z]{4,}/.test(t);
async function login(h) {
    for (const dev of ['PC', '폰']) {
        const phone = dev === '폰';
        const ctx = await h.browser.newContext(Object.assign({ viewport: phone ? PHONE : PC, serviceWorkers: 'block' }, phone ? { isMobile: true, hasTouch: true } : {}));
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
        let mode = '500';
        await pg.route('**/api/auth/login', r => mode === '500' ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'connect ECONNREFUSED 10.0.0.1:5432' }) }) : r.abort());
        await pg.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(700);
        const m = await pg.evaluate(() => { const r = id => { const e = document.getElementById(id) || document.querySelector(id); const b = e.getBoundingClientRect(); return Math.round(b.height); }; const er = document.getElementById('login-error'); return { u: r('login-username'), p: r('login-password'), b: r('.btn-login'), focus: document.activeElement && document.activeElement.id, err: getComputedStyle(er).display !== 'none' ? er.textContent : '', sw: document.documentElement.scrollWidth, iw: innerWidth }; });
        ok(m.u >= 44 && m.p >= 44 && m.b >= 44, `[login ${dev}] 입력칸·로그인 버튼 높이 44px 이상`, `${m.u}/${m.p}/${m.b}`);
        if (!phone) ok(m.focus === 'login-username', '[login PC] 열면 아이디 칸에 커서', m.focus || '없음');
        else ok(m.focus !== 'login-username' && m.sw <= 390, '[login 폰] 자판이 저절로 뜨지 않음 · 가로 넘침 없음', m.sw);
        ok(!m.err, `[login ${dev}] 처음 연 로그인 화면에는 만료 안내가 없음`, m.err);
        await pg.fill('#login-username', 'verify578'); await pg.fill('#login-password', 'x'); await pg.click('.btn-login'); await pg.waitForTimeout(600);
        const e1 = await pg.textContent('#login-error');
        ok(KO_ONLY(e1), `[login ${dev}] 서버 500(영어 글) → 한국어 안내`, e1);
        mode = 'abort'; await pg.click('.btn-login'); await pg.waitForTimeout(600);
        const e2 = await pg.textContent('#login-error');
        ok(/통신이 끊겼습니다/.test(e2) && KO_ONLY(e2), `[login ${dev}] 통신 끊김 → 한국어 안내`, e2);
        ok(errs.length === 0, `[login ${dev}] pageerror 0`, errs.join(' | '));
        await ctx.close();

        // 쓰던 중 만료: 창이 떠 있는 상태에서 401
        const P = await h.open(h.users['대표'], phone ? PHONE : PC, { phone, routes: extOff, page: 'planner' });
        await H.navTo(P.pg, 'planner', phone); await idle(P.pg, 6000);
        await P.pg.locator('.page.active [onclick*="openDdayModal("]').first().click({ timeout: 3000 }).catch(() => { }); await P.pg.waitForTimeout(400);
        const hadModal = await P.pg.evaluate(() => [...document.querySelectorAll('.modal-overlay')].some(o => getComputedStyle(o).display !== 'none' && !o.classList.contains('ao-settle-overlay')));
        let dialogs = 0; P.pg.on('dialog', () => dialogs++);
        await P.pg.route('**/api/**', r => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'jwt expired' }) }));
        await P.pg.evaluate(() => { const m = document.getElementById('dday-modal'); if (m) m.querySelector('.btn-outline').click(); });
        await H.navTo(P.pg, 'worklog', phone); await P.pg.waitForTimeout(900);
        const s = await P.pg.evaluate(() => { const lp = document.getElementById('login-page'), er = document.getElementById('login-error'); return { login: getComputedStyle(lp).display !== 'none', app: getComputedStyle(document.querySelector('.app')).display !== 'none', err: getComputedStyle(er).display !== 'none' ? er.textContent : '', tok: localStorage.getItem('jwt_token'), ov: [...document.querySelectorAll('.modal-overlay')].filter(o => getComputedStyle(o).display !== 'none').length, toast: [...document.querySelectorAll('.toast-message')].map(t => t.textContent).join('|') }; });
        ok(hadModal, `[login ${dev}] (준비) 만료 전에 창이 떠 있었음`);
        ok(s.login && !s.app, `[login ${dev}] 만료(가짜 401) → 로그인 화면으로`, JSON.stringify({ login: s.login, app: s.app }));
        ok(/만료/.test(s.err) && /다시 로그인/.test(s.err), `[login ${dev}] 로그인 화면에 「로그인이 만료됐어요 · 다시 로그인」 안내`, s.err);
        ok(s.tok === null && s.ov === 0, `[login ${dev}] 토큰 지움 · 떠 있던 창 0`, `창 ${s.ov}`);
        ok(dialogs === 0 && !/[A-Za-z]{5,}/.test(s.toast), `[login ${dev}] 만료 때 브라우저 확인창 0 · 영어 글 0`, s.toast);
        ok(P.errors.length === 0, `[login ${dev}] 만료 흐름 pageerror 0`, P.errors.slice(0, 2).join(' | '));
        await P.ctx.close();

        // 송장변환(iframe) 안에서 만료
        const Q = await h.open(h.users['대표'], phone ? PHONE : PC, { phone, routes: extOff, page: 'invoice' });
        await H.navTo(Q.pg, 'invoice', phone); await idle(Q.pg, 8000); await Q.pg.waitForTimeout(800);
        const fr = Q.pg.frames().find(f => /invoice-v2\.html/.test(f.url()) && /embed=1/.test(f.url())) || Q.pg.frames().find(f => /invoice-v2\.html/.test(f.url()));
        if (!fr) ok(false, `[login ${dev}] 송장변환 iframe 을 찾음`);
        else {
            await Q.pg.route('**/api/**', r => r.request().frame() !== Q.pg.mainFrame() ? r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"jwt expired"}' }) : r.fallback());
            await fr.locator('#btn-naver').click({ timeout: 4000 }).catch(() => { }); await Q.pg.waitForTimeout(1200);
            const t = await Q.pg.evaluate(() => { const lp = document.getElementById('login-page'), er = document.getElementById('login-error'); return { login: getComputedStyle(lp).display !== 'none', app: getComputedStyle(document.querySelector('.app')).display !== 'none', err: er.textContent }; });
            ok(t.login && !t.app && /만료/.test(t.err), `[login ${dev}] 송장변환 안에서 만료 → 바깥이 로그인 화면 + 만료 안내`, JSON.stringify(t));
        }
        await Q.ctx.close();
    }
}

// ── alert: 브라우저 기본 alert/prompt 0 · 화면 안 안내
const spy = pg => pg.addInitScript(() => {
    window.__alerts = []; window.__notes = [];
    window.alert = m => { window.__alerts.push('alert:' + m); }; window.prompt = m => { window.__alerts.push('prompt:' + m); return null; };
    const grab = n => { if (n.nodeType !== 1) return; const els = (n.matches && n.matches('.toast-message, .akm-notice')) ? [n] : []; els.forEach(e => setTimeout(() => { const t = (e.textContent || '').trim(); if (t) window.__notes.push((e.classList.contains('akm-notice') ? '창:' : '토스트:') + t.slice(0, 80)); }, 40)); };
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(grab))).observe(document, { childList: true, subtree: true });
});
async function alertSec(h) {
    const src = fs.readFileSync(path.join(H.ROOT, 'public/app.js'), 'utf8');
    const left = (src.match(/(?<![A-Za-z0-9_$.])alert\(/g) || []).length;
    ok(left === 0, '[alert] app.js 에 브라우저 alert( 호출 0', `남은 ${left} · akmAlert ${(src.match(/akmAlert\(/g) || []).length}곳`);
    const leftP = src.split(/\r?\n/).filter(l => /(?<![A-Za-z0-9_$.])prompt\(/.test(l)).length;
    ok(leftP === 3, '[alert] 남은 prompt( = 숨겨진 옛 에이전트 오피스 3곳뿐', String(leftP));
    for (const [who, dev] of [['대표', 'PC'], ['직원', '폰']]) {
        const phone = dev === '폰';
        const P = await h.open(h.users[who], phone ? PHONE : PC, { phone, routes: async pg => { await extOff(pg); await spy(pg); } });
        await P.pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await P.pg.waitForTimeout(1500);   // 가로채기가 처음부터 걸리게
        await P.pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important}' });
        const tag = `[alert ${who}·${dev}]`;
        const fnOk = await P.pg.evaluate(() => ['akmAlert', 'akmPrompt', 'akmErrText', 'akmDate', 'akmDateTime', 'akmSessionExpired', 'akmCloseOverlay', 'showToast'].filter(n => typeof window[n] !== 'function' && !(() => { try { return typeof eval(n) === 'function'; } catch (_) { return false; } })()));
        ok(fnOk.length === 0, `${tag} 새 도우미 이름이 전부 살아 있음`, fnOk.join(','));
        const notes = () => P.pg.evaluate(() => window.__notes.splice(0));
        const emptySave = async (page, openSel, saveSel, name) => {
            if (await cur(P.pg) !== page) { await H.navTo(P.pg, page, phone); await idle(P.pg, 7000); }
            let opened = false; const tryHere = async () => { const loc = P.pg.locator(openSel).locator('visible=true').first(); if (!(await loc.count())) return false; opened = await loc.click({ timeout: 2500 }).then(() => true).catch(() => false); await P.pg.waitForTimeout(500); return opened; };
            if (!(await tryHere())) await eachTab(P.pg, page, phone, tryHere);
            if (!opened) { ok(false, `${tag} ${name}: 열림`); return; }
            await notes(); const w0 = P.writes.length;
            await P.pg.locator(saveSel).locator('visible=true').last().click({ timeout: 2500 }).catch(() => { }); await P.pg.waitForTimeout(500);
            const n = await notes();
            ok(n.length > 0 && KO_ONLY(n.join(' ').replace(/^(토스트|창):/, '')), `${tag} ${name}: 빈 양식 [저장] → 화면 안 안내`, n.join(' / '));
            ok(P.writes.length === w0, `${tag} ${name}: 빈 양식은 서버로 안 감`);
            await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(250); await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(250);
        };
        await emptySave('planner', '.page.active [onclick*="openDdayModal("]', '#dday-modal [onclick*="saveDday("]', 'D-day 추가');
        if (who === '대표') {
            await emptySave('document', '.page.active [onclick*="openManualDocModal("]', '#manual-doc-modal [onclick*="saveManualDoc("]', '수기 이력 추가');
            await emptySave('document', '.page.active [onclick*="openLeaveAdjModal("]', '#leave-adj-modal [onclick*="saveLeaveAdj("]', '연차 조정');
        }
        // 긴 안내(여러 줄) = 화면 안 안내 창
        await H.navTo(P.pg, 'rankings', phone); await idle(P.pg, 6000); await notes();
        await P.pg.locator('#rank-parse-btn').click({ timeout: 3000 }).catch(() => { }); await P.pg.waitForTimeout(500);
        const nb = await P.pg.evaluate(() => { const o = document.querySelector('.akm-notice'); if (!o) return null; const m = o.querySelector('.modal').getBoundingClientRect(), b = o.querySelector('.akm-notice-ok').getBoundingClientRect(); return { text: o.querySelector('.akm-notice-msg').textContent.slice(0, 40), in: m.left >= 0 && m.right <= innerWidth + 1, btn: Math.round(b.height), focus: document.activeElement === o.querySelector('.akm-notice-ok') }; });
        ok(!!nb && nb.in && nb.btn >= 44 && nb.focus, `${tag} 순위관리 빈 붙여넣기 → 여러 줄 안내는 화면 안 [확인] 창(화면 안 · 버튼 44px · 초점)`, nb ? JSON.stringify(nb) : '창 없음');
        await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(300);
        ok(await P.pg.evaluate(() => !document.querySelector('.akm-notice')), `${tag} 안내 창은 Esc 로 닫힘`);
        // 입력 창(종전 prompt): 습관 추가
        await H.navTo(P.pg, 'planner', phone); await idle(P.pg, 6000);
        const addBtn = P.pg.locator('.page.active [onclick*="addPlannerHabit("]').locator('visible=true').first();
        if (await addBtn.count()) {
            await addBtn.scrollIntoViewIfNeeded().catch(() => { });
            await addBtn.click({ timeout: 3000 }).catch(() => { }); await P.pg.waitForTimeout(400);
            ok(await P.pg.evaluate(() => { const o = document.querySelector('.akm-ask'); return !!o && document.activeElement === o.querySelector('.akm-ask-input'); }), `${tag} 습관 [+ 추가] → 화면 안 입력 창 · 입력칸에 커서`);
            let w0 = P.writes.length; await P.pg.locator('.akm-ask-cancel').click().catch(() => { }); await P.pg.waitForTimeout(300);
            ok(P.writes.length === w0 && await P.pg.evaluate(() => !document.querySelector('.akm-ask')), `${tag} 입력 창 [취소] → 닫히고 서버로 안 감`);
            await addBtn.click({ timeout: 3000 }).catch(() => { }); await P.pg.waitForTimeout(300); w0 = P.writes.length;
            await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(300);
            ok(P.writes.length === w0 && await P.pg.evaluate(() => !document.querySelector('.akm-ask')), `${tag} 입력 창 Esc → 취소로 끝남`);
            await addBtn.click({ timeout: 3000 }).catch(() => { }); await P.pg.waitForTimeout(300);
            await P.pg.keyboard.type('검증578'); await P.pg.keyboard.press('Enter'); await P.pg.waitForTimeout(500);
            ok(P.writes.slice(w0).some(w => /POST \/api\/planner\/habits/.test(w)), `${tag} 입력 창에 쓰고 Enter → 저장 요청(가로챔)`, P.writes.slice(w0).join(','));
        } else ok(false, `${tag} 습관 [+ 추가] 버튼을 찾음`);
        // 지출결의 [반려](대표만 · 결재 대기 건이 있을 때)
        if (who === '대표') {
            await H.navTo(P.pg, 'expense', phone); await idle(P.pg, 6000);
            let rej = null; await eachTab(P.pg, 'expense', phone, async () => { const l = P.pg.locator('.page.active [onclick*="rejectExpense("]').locator('visible=true').first(); if (await l.count()) { rej = l; return true; } return false; });
            if (rej) { const w0 = P.writes.length; await rej.click({ timeout: 3000 }).catch(() => { }); await P.pg.waitForTimeout(400); const shown = await P.pg.evaluate(() => !!document.querySelector('.akm-ask')); await P.pg.locator('.akm-ask-cancel').click().catch(() => { }); await P.pg.waitForTimeout(300); ok(shown && P.writes.length === w0, `${tag} 지출결의 [반려] → 화면 안 사유 입력 창 · 취소하면 서버로 안 감`); }
            else console.log(`   (${tag} 결재 대기 건이 없어 [반려] 입력 창은 건너뜀)`);
        }
        // 긴 토스트가 폰 화면 안에 들어오는지(모양 확인용 직접 호출)
        const tr = await P.pg.evaluate(() => { akmAlert('저장 실패: ' + '가나다라마바사아자차'.repeat(5)); const t = [...document.querySelectorAll('.toast-message')].pop(); const r = t.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), iw: innerWidth }; });
        ok(tr.l >= 0 && tr.r <= tr.iw, `${tag} 긴 토스트(55자)도 화면 너비 안`, `${tr.l}~${tr.r}/${tr.iw}`);
        const al = await P.pg.evaluate(() => window.__alerts);
        ok(al.length === 0, `${tag} 이 순회에서 window.alert/prompt 호출 0`, al.slice(0, 3).join(' | '));
        ok(P.errors.length === 0, `${tag} pageerror 0`, P.errors.slice(0, 2).join(' | '));
        await P.ctx.close();
    }
}

// ── text: 메뉴=제목 · 내부 표기 · 영어 오류 글 · 날짜 표기 · 빈 상태 · 말줄임 · 대비 · 누름 크기 · 90일 안내
async function textSec(h) {
    // 메뉴 이름 = 화면 제목 · 내부 표기 · 날짜 표기 (대표 PC + 직원 PC)
    for (const who of ['대표', '직원']) {
        const P = await h.open(h.users[who], PC, { routes: extOff });
        const diff = [], leak = [], dots = [], eng = []; let menus = 0;
        for (const page of PAGES) {
            if (await H.navTo(P.pg, page, false) !== page) continue; menus++; await idle(P.pg, 8000);
            const t = await P.pg.evaluate(() => { const act = document.querySelector('.page.active'); const vis = e => e.getClientRects().length > 0; const hd = [...act.querySelectorAll('h1')].find(vis); const nav = document.querySelector('.sidebar-nav .nav-item.active .nav-text'); const own = hd ? [...hd.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').replace(/\s+/g, ' ').trim() : ''; return { h: own || (hd ? hd.textContent.trim() : ''), m: nav ? nav.textContent.trim() : '' }; });
            if (page !== 'schedule' && t.h !== t.m) diff.push(`${page}: 메뉴「${t.m}」≠제목「${t.h}」`);
            await eachTab(P.pg, page, false, async label => {
                const r = await P.pg.evaluate(() => { const act = document.querySelector('.page.active'); const out = { leak: [], dots: [], eng: [] }; const tw = document.createTreeWalker(act, NodeFilter.SHOW_TEXT); for (let n = tw.nextNode(); n; n = tw.nextNode()) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); const el = n.parentElement; if (!t || !el || !el.getClientRects().length || el.closest('[data-ao-legacy], script, style, textarea, option')) continue; if (/알림톡\(#\d+\)/.test(t)) out.leak.push(t.slice(0, 40)); if (/톡톡봇 답변\(\{\{/.test(t)) out.leak.push(t.slice(0, 40)); if (/\b20\d\d\. \d{1,2}\. \d{1,2}/.test(t)) out.dots.push(t.slice(0, 30)); if (/Failed to fetch|NetworkError|Load failed/.test(t)) out.eng.push(t.slice(0, 50)); } return out; });
                r.leak.forEach(x => leak.push(page + '/' + label + ' ' + x)); r.dots.forEach(x => dots.push(page + '/' + label + ' ' + x)); r.eng.forEach(x => eng.push(page + '/' + label + ' ' + x));
            });
        }
        ok(diff.length === 0, `[text ${who}] 메뉴 이름 = 화면 제목(${menus}개 · 일정표 인사말 제외)`, diff.join(' · '));
        ok(leak.length === 0, `[text ${who}] 내부 표기(#156 · 답변({{…}})) 0`, leak.slice(0, 4).join(' · '));
        ok(dots.length === 0, `[text ${who}] 화면 날짜에 「2026. 10. 8.」 꼴 0(2026-10-08 로 통일)`, dots.slice(0, 5).join(' · '));
        ok(eng.length === 0, `[text ${who}] 외부 조회가 끊겨도 영어 오류 글(Failed to fetch) 0`, eng.slice(0, 4).join(' · '));
        if (who === '대표') {
            await H.navTo(P.pg, 'inquiry', false); await idle(P.pg, 6000);
            await P.pg.locator('#inquiry-tab-btn-qna').click({ timeout: 3000 }).catch(() => { }); await P.pg.waitForTimeout(1500);
            const t = await P.pg.evaluate(() => (document.getElementById('inquiry-tab-qna') || document.body).innerText);
            ok(/통신이 끊겼습니다/.test(t), '[text 대표] 상품문의 조회가 끊기면 「통신이 끊겼습니다 …」', t.replace(/\s+/g, ' ').slice(0, 70));
        }
        ok(P.errors.length === 0, `[text ${who}] pageerror 0`, P.errors.slice(0, 2).join(' | '));
        await P.ctx.close();
    }
    // 빈 상태: 목록 응답을 전부 빈 값으로 바꿔 끼움
    {
        const strip = v => Array.isArray(v) ? [] : (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) ? [] : x])) : v);
        const P = await h.open(h.users['대표'], PC, { routes: async pg => { await pg.route('**/api/**', async r => { const q = r.request(); if (q.method() !== 'GET' || /\/api\/auth\//.test(q.url())) return r.fallback(); try { const x = await r.fetch(); const j = strip(JSON.parse(await x.text())); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); } catch (_) { return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); } }); await extOff(pg); } });
        const bare = []; let tables = 0; const seen = {};
        for (const page of PAGES) {
            if (await H.navTo(P.pg, page, false) !== page) continue; await idle(P.pg, 8000);
            await eachTab(P.pg, page, false, async label => {
                const r = await P.pg.evaluate(() => { const act = document.querySelector('.page.active'); const out = { n: 0, bare: [], msg: [] }; for (const tb of act.querySelectorAll('table > tbody')) { const t = tb.parentElement; if (!t.getClientRects().length) continue; out.n++; if (tb.querySelector('tr')) { const e = tb.querySelector('.empty-row, td[colspan]'); if (e && tb.querySelectorAll('tr').length === 1) out.msg.push(e.textContent.trim().slice(0, 24)); continue; } const c = getComputedStyle(tb, '::after').content; if (!c || c === 'none' || c === '""') out.bare.push((t.id || tb.id || t.className || 'table') + ''); else out.msg.push(c.replace(/"/g, '')); } return out; });
                tables += r.n; r.bare.forEach(b => bare.push(page + '/' + label + ' ' + b)); r.msg.forEach(m => { seen[m] = 1; });
            });
        }
        ok(bare.length === 0, `[text 빈 상태] 줄이 없는 표에 안내 글이 없는 곳 0(표 ${tables}개)`, bare.slice(0, 6).join(' · '));
        ok(Object.keys(seen).some(m => /등록된 시나리오가 없습니다/.test(m)) && Object.keys(seen).some(m => /등록된 품목이 없습니다/.test(m)), '[text 빈 상태] 시나리오 표 · 판매현황 표의 빈 안내가 실제로 뜸', Object.keys(seen).slice(0, 12).join(' | '));
        ok(P.errors.length === 0, '[text 빈 상태] 전 메뉴가 빈 값이어도 pageerror 0', P.errors.slice(0, 2).join(' | '));
        await P.ctx.close();
    }
    // 90일 안내(알림 발송 이력) — 서버 응답의 default_days 를 끼워 넣어 확인
    {
        let dd = 90, calls = 0;
        const P = await h.open(h.users['대표'], PC, { routes: async pg => { await extOff(pg); await pg.route(u => /\/api\/agent-office\/notify-logs$/.test(u.pathname), async r => { if (r.request().method() !== 'GET') return r.fallback(); calls++; let x; try { x = await r.fetch(); } catch (_) { return r.abort().catch(() => { }); } let j = {}; try { j = JSON.parse(await x.text()); } catch (_) { } j.default_days = /[?&]from=/.test(r.request().url()) ? 0 : dd; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }).catch(() => { }); }); } });
        await H.navTo(P.pg, 'inquiry', false); await idle(P.pg, 6000);
        await P.pg.locator('#inquiry-tab-btn-notify').click({ timeout: 3000 }); await P.pg.waitForTimeout(1500); await idle(P.pg, 8000);
        // 이 탭은 처음엔 오늘 날짜가 들어가 있다 → [초기화]로 날짜를 비운 상태가 「날짜를 안 고름」
        await P.pg.locator('#btn-notify-log-reset').click({ timeout: 3000 }); await P.pg.waitForTimeout(1500); await idle(P.pg, 8000);
        const st = () => P.pg.evaluate(() => { const n = document.getElementById('notify-log-range-note'); return { vis: !!n && n.getClientRects().length > 0, text: n ? n.textContent : '', size: n ? getComputedStyle(n).fontSize : '' }; });
        // 날짜를 비운 90일 조회(100행)는 PC 에 따라 10초 넘게 걸린다(총괄 재검증에서 1.5s+idle 8s 안에 응답이 안 와 어긋남) → 보일 때까지 최대 25초
        await P.pg.waitForFunction(() => { const n = document.getElementById('notify-log-range-note'); return !!n && n.getClientRects().length > 0; }, null, { timeout: 25000 }).catch(() => { });
        const a = await st();
        ok(calls > 0 && a.vis && /최근 90일 기록이에요/.test(a.text) && /날짜를 고르세요/.test(a.text), '[text 90일] 날짜를 안 고르면 「최근 90일 기록이에요 · 더 오래된 것은 날짜를 고르세요」 보임', a.text + ' · ' + a.size + ' · 조회 ' + calls + ' · 보임 ' + a.vis);
        await P.pg.locator('#btn-notify-log-week').click({ timeout: 3000 }); await P.pg.waitForTimeout(1500); await idle(P.pg, 8000);
        await P.pg.waitForFunction(() => { const n = document.getElementById('notify-log-range-note'); return !!n && n.getClientRects().length === 0; }, null, { timeout: 25000 }).catch(() => { });
        const b = await st();
        ok(!b.vis, '[text 90일] 날짜를 고르면(최근 7일) 안내가 안 보임');
        await P.ctx.close();
        const D = await h.open(h.users['대표'], PC, { theme: 'dark', routes: async pg => { await extOff(pg); await pg.route(u => /\/api\/agent-office\/notify-logs$/.test(u.pathname), async r => { let x; try { x = await r.fetch(); } catch (_) { return r.abort().catch(() => { }); } let j = {}; try { j = JSON.parse(await x.text()); } catch (_) { } j.default_days = 90; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }).catch(() => { }); }); } });
        await H.navTo(D.pg, 'inquiry', false); await idle(D.pg, 6000); await D.pg.locator('#inquiry-tab-btn-notify').click({ timeout: 3000 }); await D.pg.waitForTimeout(1500); await D.pg.locator('#btn-notify-log-reset').click({ timeout: 3000 }); await D.pg.waitForTimeout(1500);
        await D.pg.waitForFunction(() => { const n = document.getElementById('notify-log-range-note'); return !!n && n.getClientRects().length > 0; }, null, { timeout: 25000 }).catch(() => { });
        const au = await H.audit(D.pg, '#notify-log-range-note');
        ok(au.dark === 'dark' && au.texts > 0 && au.fails.length === 0, '[text 90일] 야간 화면에서 안내 글 대비 4.5:1 이상', au.fails.join(' | ') || '최저 ' + au.minR);
        // 야간: 화면 안 안내 창 · [수정요청] 대비
        await D.pg.evaluate(() => { akmAlert('첫 줄 안내입니다.\n둘째 줄 안내입니다.'); const b = document.createElement('table'); b.id = 'v578-mod'; b.innerHTML = '<tbody><tr><td><button class="btn-mod-request">수정요청</button></td></tr></tbody>'; document.querySelector('.page.active').appendChild(b); });
        await D.pg.waitForTimeout(200);
        const an = await H.audit(D.pg, '.akm-notice .modal');
        ok(an.texts > 0 && an.fails.length === 0, '[text 야간] 화면 안 안내 창 글자 대비 미달 0', an.fails.join(' | ') || '최저 ' + an.minR);
        await D.pg.keyboard.press('Escape');
        const am = await H.audit(D.pg, '#v578-mod');
        ok(am.texts > 0 && am.fails.length === 0, '[text 야간] [수정요청] 글자 대비 4.5:1 이상', am.fails.join(' | ') || '최저 ' + am.minR);
        await D.ctx.close();
    }
    // 말줄임 · [수정요청] 대비(밝은 화면) · 폰 누름 크기
    {
        const P = await h.open(h.users['대표'], PHONE, { phone: true, routes: extOff });
        await H.navTo(P.pg, 'document', true); await idle(P.pg, 6000);
        await P.pg.evaluate(() => { const w = document.createElement('div'); w.id = 'v578-box'; w.innerHTML = '<div class="qna-clip" id="v578-clip">' + '안녕하세요 제주아꼼이네입니다. 네, 맞아요. '.repeat(30) + '</div><table><tbody><tr><td><button class="btn-mod-request" id="v578-btn">수정요청</button></td></tr></tbody></table>'; document.querySelector('.page.active').appendChild(w); });
        const c = await P.pg.evaluate(() => { const e = document.getElementById('v578-clip'), cs = getComputedStyle(e); return { clamp: cs.webkitLineClamp, disp: cs.display, cut: e.scrollHeight > e.clientHeight + 2, h: e.clientHeight }; });
        ok(c.clamp === '4' && /box|flow-root/.test(c.disp) && c.cut, '[text 말줄임] 접힌 긴 글(.qna-clip)은 4줄에서 …으로 끝남', JSON.stringify(c));
        await P.pg.evaluate(() => document.getElementById('v578-clip').classList.add('open'));
        ok(await P.pg.evaluate(() => { const e = document.getElementById('v578-clip'); return e.scrollHeight <= e.clientHeight + 2; }), '[text 말줄임] 펼치면(.open) 전체가 보임');
        const am = await H.audit(P.pg, '#v578-box table');
        const bs = await P.pg.evaluate(() => { const r = document.getElementById('v578-btn').getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); });
        ok(am.fails.length === 0 && am.minR >= 4.5, '[text 대비] [수정요청] 글자 대비 4.5:1 이상(밝은 화면)', '최저 ' + am.minR);
        ok(bs >= 44, '[text 누름] 폰: 표 안 [수정요청] 44px 이상', bs + 'px');
        await P.pg.evaluate(() => document.getElementById('v578-box').remove());
        // 실제 화면의 자주 누르는 것
        const small = [], sw = []; let seenN = 0, chk = 0, chkSmall = 0;
        for (const page of ['schedule', 'rankings', 'document', 'expense', 'settlement', 'pricing', 'inquiry', 'data']) {
            if (await H.navTo(P.pg, page, true) !== page) continue; await idle(P.pg, 8000);
            await eachTab(P.pg, page, true, async label => {
                const r = await P.pg.evaluate(() => { const act = document.querySelector('.page.active'); const out = { n: 0, small: [], chk: 0, chkSmall: 0, sw: [] }; const vis = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
                    for (const e of act.querySelectorAll('td > .btn-view, td > .btn-view-items, td > .btn-danger, td > .btn-mod-request, .rank-del-btn, .settlement-tab, .doc-main-tab, #schedule-view-toggle > button')) { if (!vis(e)) continue; out.n++; const b = e.getBoundingClientRect(); if (Math.min(b.width, b.height) < 43.5) out.small.push((e.className || e.tagName) + ' 「' + e.textContent.trim().slice(0, 8) + '」 ' + Math.round(b.width) + '×' + Math.round(b.height)); }
                    for (const e of act.querySelectorAll('td > input[type="checkbox"]:not(.ui-switch), th > input[type="checkbox"]:not(.ui-switch)')) { if (!vis(e)) continue; out.chk++; const b = e.getBoundingClientRect(); if (Math.min(b.width, b.height) < 23.5) out.chkSmall++; }
                    for (const e of [...act.querySelectorAll('input.ui-switch')].filter(vis).slice(0, 3)) { const b = e.getBoundingClientRect(); const sc = e.closest('.table-scroll-wrapper, .card'); const cr = sc ? sc.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight }; const x = b.left + b.width / 2; if (x < Math.max(0, cr.left) || x > Math.min(innerWidth, cr.right) || b.top - 10 < 0 || b.bottom + 10 > innerHeight) continue; const up = document.elementFromPoint(x, b.top - 10), dn = document.elementFromPoint(x, b.bottom + 10); out.sw.push(up === e && dn === e); }
                    return out; });
                seenN += r.n; chk += r.chk; chkSmall += r.chkSmall; r.small.forEach(s => small.push(page + '/' + label + ' ' + s)); r.sw.forEach(s => sw.push(s));
            });
        }
        ok(seenN > 20 && small.length === 0, `[text 누름] 폰: 표 안 [상세·삭제·수정·취소]·탭·주간/월간 44px 이상(${seenN}개)`, [...new Set(small)].slice(0, 6).join(' · '));
        ok(chk === 0 || chkSmall === 0, `[text 누름] 폰: 표 체크칸 24px 이상(${chk}개 · 44 는 아님)`, chkSmall + '개 미달');
        ok(sw.length === 0 || sw.every(Boolean), `[text 누름] 폰: 스위치는 위아래 10px 밖을 눌러도 눌림(${sw.length}개 확인)`);
        ok(P.errors.length === 0, '[text 누름] pageerror 0', P.errors.slice(0, 2).join(' | '));
        await P.ctx.close();
    }
}

(async () => {
    const h = await H.start(PORT, 'verify578');
    try {
        if (ONLY.includes('flow')) await flow(h);
        if (ONLY.includes('modal')) await modal(h);
        if (ONLY.includes('login')) await login(h);
        if (ONLY.includes('alert')) await alertSec(h);
        if (ONLY.includes('text')) await textSec(h);
    } catch (e) { console.error(e); fail++; fails.push('중단: ' + String(e).slice(0, 120)); }
    await h.stop();
    console.log(`\n결과: ${pass}/${pass + fail}` + (fail ? ' ❌ ' + fails.join(' ‖ ') : ' ✅'));
    process.exit(fail ? 1 : 0);
})();
