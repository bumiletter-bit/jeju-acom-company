// #569 야간 화면 검증 공통 틀 — 로컬 실서버(스케줄러 차단) · GET 은 처음 응답을 저장해 모든 화면에 같은 값 · 쓰기는 전부 가로챔(DB 쓰기 0)
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const gitShow = p => execFileSync('git', ['show', 'HEAD:' + p], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');

async function start(port, tag) {
    const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(port) };
    delete env.ANTHROPIC_API_KEY; delete env.RENDER;
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
        { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), tag + '-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), tag + '-server.err'), 'w')] });
    let up = false;
    for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${port}/`); if (r.status) { up = true; break; } } catch (_) { } }
    if (!up) { srv.kill(); throw new Error('server not up'); }
    const { Client } = require('pg');
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
    const mgr = (await db.query(`SELECT id, name, position FROM users WHERE role = 'admin' AND position <> '대표' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
    const stf = (await db.query(`SELECT id, name, position FROM users WHERE role NOT IN ('admin','accountant') AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
    await db.end();
    const users = { 대표: { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, 과장: { id: mgr.id, name: mgr.name, position: mgr.position || '과장', role: 'admin' }, 직원: { id: stf.id, name: stf.name, position: stf.position || '사원', role: 'user' } };
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const jwt = require('jsonwebtoken');
    const cache = new Map();
    const OLD = { 'ao-desk.css': gitShow('public/ao-desk.css'), 'ao-desk.js': gitShow('public/ao-desk.js') };
    let INDEX_HEAD = null; try { INDEX_HEAD = gitShow('public/index.html'); } catch (_) { }
    const linked = /ao-dark\.css/.test(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));

    // opt: { phone, theme:'dark'|null, page, old:true(종전 = git HEAD 의 ao-desk.* · ao-dark.css 없음), mask:'css 선택자', pages:[…](DARK_PAGES 를 이 목록으로 바꿔 끼움 — 시공 중 묶음 시험용) }
    async function open(user, vw, opt) {
        opt = opt || {};
        const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce' }, opt.phone ? { isMobile: true, hasTouch: true } : {}));
        const pg = await ctx.newPage(); const errors = [], writes = [];
        pg.on('pageerror', e => errors.push(String(e)));
        pg.on('dialog', d => d.dismiss().catch(() => { }));
        await pg.route('**/api/**', async route => {
            const rq = route.request(), u = new URL(rq.url());
            if (rq.method() !== 'GET') { writes.push(rq.method() + ' ' + u.pathname); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }); }
            const key = user.id + ' ' + u.pathname + u.search;
            if (!cache.has(key)) cache.set(key, (async () => { const r = await route.fetch(); return { status: r.status(), headers: r.headers(), body: await r.body() }; })());
            try { return route.fulfill(await cache.get(key)); } catch (e) { cache.delete(key); return route.abort().catch(() => { }); }
        });
        if (opt.routes) await opt.routes(pg, user);
        if (opt.old) {
            for (const f of Object.keys(OLD)) await pg.route('**/' + f + '*', route => route.fulfill({ status: 200, contentType: f.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8', body: OLD[f] }));
            await pg.route('**/ao-dark.css*', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        } else {
            if (!linked) await pg.route(u => u.pathname === '/' || u.pathname === '/index.html', async route => { const r = await route.fetch(); let html = await r.text(); html = html.replace(/(<link rel="stylesheet" href="order-organizer\.css[^>]*>)/, '$1\n    <link rel="stylesheet" href="ao-dark.css?v=0">'); return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); });
            if (opt.pages) await pg.route('**/ao-desk.js*', route => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: fs.readFileSync(path.join(ROOT, 'public/ao-desk.js'), 'utf8').replace(/const DARK_PAGES = \[[^\]]*\];/, 'const DARK_PAGES = ' + JSON.stringify(opt.pages) + ';') }));
        }
        const tok = jwt.sign(user, 'verifytest', { expiresIn: '90m' });
        await pg.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t, u, th, lp]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', lp); localStorage.removeItem('akm_desk_view'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, [tok, user, opt.theme || null, opt.page || 'schedule']);
        await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(2200);
        await pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important} #desk-clock,#desk-date,.desk-caret,#desk-char{visibility:hidden!important} *{caret-color:transparent!important}' + (opt.mask ? ' ' + opt.mask + '{visibility:hidden!important}' : '') });
        return { pg, ctx, errors, writes };
    }
    const stop = async () => { await browser.close().catch(() => { }); srv.kill(); };
    return { users, open, stop, browser, linked, cache };
}

const navTo = async (pg, page, phone) => {
    if (phone && await pg.evaluate(() => !document.querySelector('.sidebar').classList.contains('mobile-open'))) { await pg.click('.mobile-menu-btn').catch(() => { }); await pg.waitForTimeout(450); }
    const ok = await pg.locator(`.sidebar-nav .nav-item[data-page="${page}"]`).click({ timeout: 5000 }).then(() => true).catch(() => false);
    if (!ok) await pg.evaluate(p => { if (typeof switchPage === 'function') switchPage(p); }, page);   // 폰 에뮬레이터에서 메뉴 클릭 좌표가 어긋날 때(#563 함정)만
    await pg.waitForTimeout(1200);
    if (phone) await pg.evaluate(() => { if (typeof closeMobileSidebar === 'function') closeMobileSidebar(); }).catch(() => { });
    await pg.waitForTimeout(300);
    return pg.evaluate(() => { const p = document.querySelector('.page.active'); return p ? p.id.replace(/^page-/, '') : ''; });
};

// 화면에 보이는 글자 전부: 글자색 vs 실제 바탕(반투명 겹침·opacity 계산) 대비 · 흰 바탕으로 남은 칸
const audit = (pg, scopeSel) => pg.evaluate(scopeSel => {
    const parse = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
    const pageBg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    const bgOf = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); let c = parse(cs.backgroundColor); if (cs.backgroundImage && /gradient/.test(cs.backgroundImage)) { const g = cs.backgroundImage.match(/rgba?\([^)]+\)/g); if (g) c = parse(g[g.length - 1]); } if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; } } let base = pageBg[3] > 0 ? [pageBg[0], pageBg[1], pageBg[2], 1] : [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };
    const visible = el => { if (!el.getClientRects().length) return false; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false; } return true; };
    const opac = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
    const name = el => { const one = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')); const p = el.parentElement; return (p && !el.id ? one(p) + ' > ' : '') + one(el); };
    const roots = scopeSel ? Array.from(document.querySelectorAll(scopeSel)) : [document.body];
    const fails = [], white = [], seen = new Set(); let texts = 0, dim = 0, minR = 99;
    const SKIP = '.desk-sr, [data-ao-legacy], script, style, option, #login-page, [data-dark-skip], noscript';
    for (const root of roots) {
        if (!root) continue;
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
            const t = n.nodeValue.trim(); if (!t || !/[0-9A-Za-z가-힣]/.test(t)) continue; const el = n.parentElement; if (!el || el.closest(SKIP) || !visible(el)) continue;
            const cs = getComputedStyle(el), fg0 = parse(cs.color); if (!fg0) continue;
            const r0 = el.getBoundingClientRect(); if (r0.width < 2 || r0.height < 2) continue;
            const bg = bgOf(el), o = opac(el), fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * o], bg);
            const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
            const px = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700, need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
            texts++;
            if (o < 0.99 || el.closest('[disabled], [aria-disabled="true"], .disabled')) { dim++; continue; }   // 꺼진 것·일부러 흐리게 한 것(opacity)은 대비 기준 예외
            minR = Math.min(minR, ratio);
            if (ratio < need) { const k = name(el) + '|' + cs.color + '|' + bg.map(Math.round).slice(0, 3).join(); if (!seen.has(k)) { seen.add(k); fails.push(`${name(el)} 「${t.slice(0, 12)}」 ${ratio.toFixed(2)} 글자 ${cs.color.replace(/\s/g, '')} 바탕 rgb(${bg.map(Math.round).slice(0, 3).join(',')})${el.closest('[style*="color"]') ? ' [style]' : ''}`); } }
        }
        for (const el of [root, ...root.querySelectorAll('*')]) {
            if (el.closest(SKIP) || /^(IMG|VIDEO|SVG|PATH|MARK|CANVAS|IFRAME)$/i.test(el.tagName) || !visible(el)) continue;
            const cs = getComputedStyle(el), c = parse(cs.backgroundColor); if (!c || c[3] < 0.9) continue;
            const r = el.getBoundingClientRect(); if (r.width * r.height < 400) continue;
            if (Math.min(c[0], c[1], c[2]) > 170) { const k = name(el); if (!seen.has('w' + k)) { seen.add('w' + k); white.push(`${k} ${cs.backgroundColor.replace(/\s/g, '')} ${Math.round(r.width)}×${Math.round(r.height)}${el.getAttribute('style') && /background/.test(el.getAttribute('style')) ? ' [style]' : ''}`); } }
        }
        for (const el of root.querySelectorAll('input, textarea')) {
            if (el.closest(SKIP) || !visible(el) || !el.placeholder || el.value) continue;
            const pc = parse(getComputedStyle(el, '::placeholder').color), bg = bgOf(el); if (!pc) continue;
            const fg = over(pc, bg), ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05); texts++;
            if (ratio < 4.5) { const k = 'p' + name(el); if (!seen.has(k)) { seen.add(k); fails.push(`${name(el)} 안내 글 ${ratio.toFixed(2)}`); } }
        }
    }
    return { fails, white, texts, dim, minR: Number(minR.toFixed(2)), dark: document.documentElement.getAttribute('data-ao-theme') || '', overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
}, scopeSel || null);

module.exports = { ROOT, sleep, start, navTo, audit, gitShow };
