// #569-B 야간 화면 — 송장변환(메뉴 안 iframe · /invoice-v2.html?embed=1) 검증
//   ① 밝은 화면 무회귀: 바깥에 켜짐 표시가 없을 때 「HEAD 의 invoice-v2.html/js 를 끼운 화면」과 「지금 파일」의 iframe 스크린샷이 바이트 동일(PC·폰 · 주요 단계)
//   ② 어두운 화면: 바깥 html 에 data-ao-theme="dark" 를 붙이면 iframe 이 따라 붙고 떼면 따라 뗀다 · 글자 대비 미달 0 · 밝은 바탕으로 남은 칸 목록 · 폰 가로 넘침 0 · 오류 0
//   ③ 결과물 무변경: 야간으로 만든 엑셀(2시트)·선택분 이미지(PNG) = 밝은 화면에서 만든 것
//   ④ 따로 연 화면(/invoice-v2.html)·최종발주의 숨은 계산용(?fo=1)은 바깥이 야간이어도 켜짐 표시가 안 붙는다
//   주문·줄 = 가짜(scripts/fixtures-508.js) · 불러오기 API 는 page.route 가짜 응답 · 단가표·달력만 실DB 읽기 · 실DB 쓰기 0
//   실행: node scripts/verify-569-invoice-dark.js   (포트 3462) · 스크린샷 = SHOT_DIR(기본 임시폴더/verify569)
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn, execFileSync } = require('child_process');
const jwt = require('jsonwebtoken'); const XLSX = require('xlsx-js-style');
const FX = require('./fixtures-508.js');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 900) : '')); return !!c; };
const note = (t, d) => console.log('  ℹ️ ' + t + (d != null ? ' — ' + String(d).slice(0, 1200) : ''));
const PORT = 3462, BASE = `http://localhost:${PORT}`, ROOT = path.join(__dirname, '..');
const USER = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' };
const TOKEN = jwt.sign(USER, 'verifytest', { expiresIn: '1h' });
const SHOT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'verify569'); fs.mkdirSync(SHOT, { recursive: true });
const BASE_REF = process.env.BASE_REF || '149f05d';   // 고치기 전 기준 = #569 직전 커밋(커밋된 뒤에도 같은 비교가 되게 고정)
const HEAD = f => execFileSync('git', ['show', BASE_REF + ':' + f], { cwd: ROOT, maxBuffer: 1 << 26 });
const HEAD_HTML = HEAD('public/invoice-v2.html'), HEAD_JS = HEAD('public/invoice-v2.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const apiJ = async (url, method = 'GET', body) => (await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: body ? JSON.stringify(body) : undefined })).json();

async function newCtx(br, fx, o) {
    const ctx = await br.newContext({ acceptDownloads: true, viewport: o.mobile ? { width: 390, height: 844 } : { width: 1400, height: 900 }, ...(o.mobile ? { isMobile: true, hasTouch: true } : {}), reducedMotion: 'reduce' });
    await ctx.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_ao_theme', 'light'); }, [TOKEN, USER]);
    await ctx.addInitScript(() => { const add = () => { const s = document.createElement('style'); s.textContent = '.ao-settle-overlay{display:none!important}'; (document.head || document.documentElement).appendChild(s); }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); });
    if (o.head) { await ctx.route('**/invoice-v2.html*', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HEAD_HTML })); await ctx.route('**/invoice-v2.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: HEAD_JS })); }
    const reply = body => r => r.fulfill({ json: body });
    await ctx.route('**/api/agent-office/naver/invoice-orders-v2*', reply({ ok: true, count: fx.naver.length, rows: fx.naver, partial_adjusted: 0 }));
    await ctx.route('**/api/agent-office/cafe24/invoice-orders*', reply({ ok: true, count: fx.cafe24.length, rows: fx.cafe24 }));
    await ctx.route('**/api/agent-office/coupang/invoice-orders*', reply({ ok: true, count: fx.coupang.length, rows: fx.coupang }));
    await ctx.route('**/api/agent-office/coupang/canceled-since*', reply({ ok: true, canceled: fx.canceledCoupang }));
    await ctx.route('**/api/agent-office/naver/invoice-orders?*', reply({ ok: true, count: fx.naver.length, rows: fx.naver, partial_adjusted: 0 }));   // 중간발주 [시작하기]
    return ctx;
}
const setTheme = (pg, dark) => pg.evaluate(d => { if (d) document.documentElement.setAttribute('data-ao-theme', 'dark'); else document.documentElement.removeAttribute('data-ao-theme'); }, dark);
// iframe 칸만 찍는다(바깥 화면은 워커1 범위 · 스스로 바뀌는 것이 있어 비교에서 뺀다). 두 번 연속 같은 그림이 나올 때까지.
const shot = async (pg, name, save) => { const fr = pg.frames().find(f => /invoice-v2\.html/.test(f.url())); await fr.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return document.fonts && document.fonts.ready; }); await pg.mouse.move(2, 2); await pg.waitForTimeout(250);
    const el = pg.locator('#invoice-v2-frame'); let b = await el.screenshot({ animations: 'disabled', caret: 'hide' }); for (let i = 0; i < 6; i++) { await pg.waitForTimeout(350); const b2 = await el.screenshot({ animations: 'disabled', caret: 'hide' }); if (b2.equals(b)) break; b = b2; }
    if (save) fs.writeFileSync(path.join(SHOT, name + '.png'), b); return b; };

// 화면(iframe 문서) 안에서 도는 대비 측정 — 글자가 있는 보이는 요소 전부. 꺼진 버튼·흐리게 한 칸(opacity<1)은 세기만.
const AUDIT = () => {
    const P = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return { r: 0, g: 0, b: 0, a: 0 }; const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
    const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
    const L = c => .2126 * lin(c.r) + .7152 * lin(c.g) + .0722 * lin(c.b);
    const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
    const bgOf = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let base = { r: 14, g: 17, b: 34, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };   // 바탕이 없으면 바깥 화면의 야간 바탕(#0E1122)
    const faded = el => { for (let e = el; e && e !== document.body; e = e.parentElement) if (parseFloat(getComputedStyle(e).opacity) < 1) return true; return false; };
    const name = el => { const c = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.'); const p = el.parentElement; const pc = p && typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : ''; const pid = p && p.id ? '#' + p.id : ''; return ((pc || pid) ? (pid || '.' + pc) + ' > ' : '') + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (c ? '.' + c : ''); };
    const hex = c => '#' + [c.r, c.g, c.b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
    const out = { n: 0, skipped: 0, bad: [], light: {}, min: 99 };
    const check = (el, colorStr, what) => { const cs = getComputedStyle(el); const bg = bgOf(el); const fg = over(P(colorStr), bg); const a = L(fg), b = L(bg); const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05); const fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight, 10) || 400; const big = fs >= 24 || (fs >= 18.66 && fw >= 700); out.n++; if (ratio < out.min) out.min = ratio;
        if (ratio < (big ? 3 : 4.5)) out.bad.push(`${name(el)}${what ? ' ' + what : ''} ${ratio.toFixed(2)}:1 (글자 ${hex(fg)} · 바탕 ${hex(bg)} · ${fs}px/${fw}) 「${(el.value || el.textContent || '').trim().slice(0, 16)}」`); };
    for (const el of document.body.querySelectorAll('*')) {
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; if (/^(SCRIPT|STYLE|OPTION)$/.test(el.tagName)) continue;
        const own = P(cs.backgroundColor); if (own.a >= 1 && L(own) > .6) { const k = el.closest('.qty-row') ? '중간발주 수량 줄(품목 색)' : /\btag\b|\bnote\b/.test(el.className) ? '표시 칩 ' + name(el).split(' > ').pop() : name(el); out.light[k] = (out.light[k] || 0) + 1; }
        const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
        const hasText = isField ? !/^(file|checkbox|radio|hidden|color)$/.test(el.type) : [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
        if (!hasText) continue;
        if (el.disabled || el.closest(':disabled') || faded(el)) { out.skipped++; continue; }
        check(el, cs.color, '');
        if (isField && el.placeholder && !el.value) check(el, getComputedStyle(el, '::placeholder').color, '(안내 글)');
    }
    out.min = +out.min.toFixed(2); return out;
};
const sheetDump = f => { const wb = XLSX.readFile(f, { cellStyles: true }); return JSON.stringify(wb.SheetNames.map(n => { const ws = wb.Sheets[n]; const cells = {}; for (const k of Object.keys(ws)) { if (k[0] === '!') continue; const c = ws[k]; cells[k] = [c.t, c.v, c.s || null]; } return [n, ws['!ref'], ws['!cols'] || null, ws['!merges'] || null, cells]; })); };

// 한 번의 흐름(송장변환 메뉴 안): 진입 → 3채널 불러오기 → 줄 붙여넣기·저장 → 검토·미리보기 → 달력 → (엑셀) → 중간발주 탭 → (선택분 이미지)
async function flow(br, fx, o, at) {
    const ctx = await newCtx(br, fx, o); const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR|Failed to load resource/.test(m.text())) errs.push(m.text()); }); pg.on('dialog', d => d.accept());
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500);
    if (o.dark) { await setTheme(pg, true); await pg.addStyleTag({ content: 'body, .main-content, #page-invoice { background:#0E1122 !important; }' }); }   // 바깥 바탕은 워커1 범위 — 스크린샷이 실제처럼 보이게만 어둡게
    await pg.evaluate(() => switchPage('invoice')); await pg.waitForTimeout(500);
    await pg.waitForFunction(() => { const f = document.getElementById('invoice-v2-frame'); return f && /invoice-v2\.html\?embed=1/.test(f.src) && f.contentWindow && f.contentWindow.__ivt && f.contentWindow.__ivt.S.calendar; }, null, { timeout: 40000 });
    if (o.dark) await setTheme(pg, true);
    const fr = pg.frames().find(f => /invoice-v2\.html/.test(f.url())); const F = pg.frameLocator('#invoice-v2-frame'); await pg.waitForTimeout(600);
    await at('1-진입', pg, fr);
    for (const ch of ['naver', 'cafe24', 'coupang']) { await F.locator('#btn-' + ch).click(); await fr.waitForFunction(c => !document.getElementById('btn-' + c).disabled && window.__ivt.S.merged.some(e => e.ch === c), ch, { timeout: 30000 }); await pg.waitForTimeout(200); }
    await fr.waitForFunction(() => document.querySelectorAll('#preview tbody tr').length > 10, null, { timeout: 30000 }); await pg.waitForTimeout(500);
    await at('2-불러옴', pg, fr);
    await F.locator('#ln-all').fill(fx.memo); await F.locator('#save-all').click(); await pg.waitForTimeout(150); await fr.waitForFunction(() => !document.getElementById('save-all').disabled); await pg.waitForTimeout(500);
    await at('3-줄판정', pg, fr);
    await F.locator('#ship-date').click(); await pg.waitForTimeout(500); const calOpen = await fr.evaluate(() => { const p = document.querySelector('.akm-cal.ivt-cal'); return !!(p && p.style.display !== 'none'); });
    await at('4-달력', pg, fr); await pg.keyboard.press('Escape'); await F.locator('h3, .ivt-note').first().click({ force: true }).catch(() => { }); await pg.waitForTimeout(300);
    await fr.evaluate(() => { const p = document.querySelector('.akm-cal.ivt-cal'); if (p && p.style.display !== 'none') document.body.click(); }); await pg.waitForTimeout(300);
    const out = {};
    if (o.grab) { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), F.locator('#btn-download').click()]); out.xlsx = path.join(SHOT, `송장-${o.grab}.xlsx`); await d.saveAs(out.xlsx); out.xlsxName = d.suggestedFilename(); await pg.waitForTimeout(400); }
    await F.locator('#ivt-mode-qty').click(); await pg.waitForTimeout(300); await F.locator('#ivt-qty-start').click();
    await fr.waitForFunction(() => document.querySelectorAll('#invoice-qty-list .qty-row').length > 0, null, { timeout: 40000 }); await pg.waitForTimeout(600);
    await at('5-중간발주', pg, fr);
    if (o.grab) { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), F.locator('button[onclick="saveQtyImage()"]').click()]); out.png = path.join(SHOT, `중간발주-${o.grab}.png`); await d.saveAs(out.png); out.pngName = d.suggestedFilename(); await pg.waitForTimeout(400); }
    await F.locator('#ivt-mode-convert').click(); await pg.waitForTimeout(300);
    return { ctx, pg, fr, errs, out, calOpen };
}

(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', () => { }); let tail = ''; srv.stderr.on('data', d => { tail = (tail + d).slice(-600); });
    let br, code = 1;
    try {
        for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/public/version')).ok) break; } catch (_) { } await sleep(1000); }
        const cat = await apiJ('/api/invoice/catalog'); const mp = await apiJ('/api/agent-office/invoice/memo-parse', 'POST', { memos: [] });
        const ship = mp.suggested, later = (mp.shipDays || []).find(d => d > ship); if (!ship || !later) throw new Error('발송일 달력을 못 읽었습니다');
        const fx = FX.build({ byPartner: cat.byPartner || {}, ship, later, realToday: mp.realToday, noShip: mp.noShip || [] });
        const { chromium } = require('playwright'); br = await chromium.launch();

        console.log('\n⓪ 파일 자체 — 추가만 했는지');
        const now = fs.readFileSync(path.join(ROOT, 'public/invoice-v2.html'), 'utf8').replace(/\r\n/g, '\n'), old = HEAD_HTML.toString('utf8').replace(/\r\n/g, '\n');
        const cut = old.indexOf('</style>\n</head>'); const headSame = now.startsWith(old.slice(0, cut)); const tailOld = old.slice(cut + '</style>'.length); const tailSame = now.endsWith(tailOld);
        const added = now.slice(cut, now.length - tailOld.length);
        ok(cut > 0 && headSame && tailSame, '⓪ invoice-v2.html = HEAD 그대로 + </style> 앞뒤에 덧붙임(기존 줄 무수정)', `HEAD ${old.length}자 → 지금 ${now.length}자 · 덧붙인 ${added.length}자`);
        const cssAdded = added.slice(0, added.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, ''); const rules = cssAdded.split('}').map(s => s.trim()).filter(Boolean).map(s => s.replace(/^@media[^{]*\{\s*/, '').split('{')[0].trim()).filter(Boolean);
        const loose = rules.filter(sel => !sel.split(',').every(p => p.trim().startsWith('html[data-ao-theme="dark"]')));
        ok(rules.length > 20 && loose.length === 0, `⓪ 덧붙인 CSS 규칙 ${rules.length}개 전부 html[data-ao-theme="dark"] 아래`, loose.slice(0, 3).join(' | ') || '벗어난 규칙 없음');
        let same = true; try { execFileSync('git', ['diff', '--quiet', BASE_REF, '--', 'public/invoice-v2.js', 'public/invoice-sender.js', 'public/app.js', 'public/final-order-core.js'], { cwd: ROOT }); } catch (_) { same = false; }
        ok(same, '⓪ invoice-v2.js · invoice-sender.js · app.js · final-order-core.js 는 HEAD 와 같음(무수정)');

        let lightOut = null;
        for (const mobile of [false, true]) {
            const dev = mobile ? '폰' : 'PC'; console.log(`\n① 밝은 화면 무회귀(${dev}) — HEAD 의 invoice-v2.html/js 를 끼운 화면 vs 지금 파일`);
            const A = {}, B = {};
            const a = await flow(br, fx, { mobile, head: true }, async (n, pg) => { A[n] = await shot(pg, `light-head-${dev}-${n}`, false); }); await a.ctx.close();
            const b = await flow(br, fx, { mobile, grab: mobile ? null : 'light' }, async (n, pg) => { B[n] = await shot(pg, `light-now-${dev}-${n}`, false); });
            const names = Object.keys(A); const diff = names.filter(n => !B[n] || !A[n].equals(B[n]));
            ok(names.length >= 5 && diff.length === 0 && a.calOpen && b.calOpen, `① ${dev}: iframe 스크린샷 ${names.length}장 전부 바이트 동일`, diff.length ? '다른 장면: ' + diff.join(', ') : names.join(' · '));
            for (const n of diff) { fs.writeFileSync(path.join(SHOT, `DIFF-head-${dev}-${n}.png`), A[n]); if (B[n]) fs.writeFileSync(path.join(SHOT, `DIFF-now-${dev}-${n}.png`), B[n]); }
            const attr = await b.fr.evaluate(() => document.documentElement.getAttribute('data-ao-theme')); ok(attr === null, `① ${dev}: 바깥에 켜짐 표시가 없으면 iframe 에도 없음`, String(attr));
            ok(a.errs.length === 0 && b.errs.length === 0, `① ${dev}: 화면 오류 0`, [...a.errs, ...b.errs].join(' | ') || '없음');
            if (!mobile) lightOut = b.out;
            await b.ctx.close();
        }

        const lightAll = {};
        for (const mobile of [false, true]) {
            const dev = mobile ? '폰' : 'PC'; console.log(`\n② 어두운 화면(${dev})`);
            const bads = [], mins = []; let nText = 0, skipped = 0; const wide = [];
            const d = await flow(br, fx, { mobile, dark: true, grab: mobile ? null : 'dark' }, async (n, pg, fr) => {
                await shot(pg, `dark-${dev}-${n}`, true);
                const r = await fr.evaluate(AUDIT); nText += r.n; skipped += r.skipped; mins.push(r.min); r.bad.forEach(x => bads.push(`[${n}] ${x}`)); Object.entries(r.light).forEach(([k, v]) => { lightAll[k] = Math.max(lightAll[k] || 0, v); });
                if (mobile) { const w = await fr.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth, over: [...document.body.querySelectorAll('*')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.right > window.innerWidth + 1 && !el.closest('.table-scroll-wrapper, .ivt-ed, textarea, .akm-cal'); }).length })); if (w.doc > w.inner + 1 || w.over) wide.push(`[${n}] ${JSON.stringify(w)}`); }
            });
            const st = await d.fr.evaluate(() => ({ attr: document.documentElement.getAttribute('data-ao-theme'), card: getComputedStyle(document.querySelector('.card')).backgroundColor, ink: getComputedStyle(document.body).color }));
            ok(st.attr === 'dark' && st.card !== 'rgb(255, 255, 255)', `② ${dev}: 바깥이 야간이면 iframe 도 켜짐 · 카드 바탕이 어두움`, JSON.stringify(st));
            { const u = {}; bads.forEach(x => { const k = x.replace(/^\[[^\]]+\] /, '').replace(/ 「.*$/, ''); u[k] = (u[k] || 0) + 1; }); fs.writeFileSync(path.join(SHOT, `audit-${dev}.json`), JSON.stringify({ bad: u, light: lightAll }, null, 1)); }   // 고칠 때 보는 전체 목록
            ok(bads.length === 0, `② ${dev}: 글자 대비 미달 0 (측정 ${nText}곳 · 가장 낮은 값 ${Math.min(...mins)}:1 · 꺼진·흐린 칸 ${skipped}곳 제외)`, bads.slice(0, 14).join(' ‖ ') || '없음');
            if (mobile) ok(wide.length === 0, '② 폰: 가로 넘침 0(전 단계)', wide.join(' ‖ ') || '없음');
            // 줄별 표시 색(뜻) — 초록·노랑·빨강
            const sem = await d.fr.evaluate(() => { const c = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; }; return { ok: c('.ivt-gut .m.ok span'), warn: c('.ivt-gut .m.warn span'), none: c('.ivt-gut .m.none span') }; });
            const hue = s => { if (!s) return -1; const [r, g, b] = s.match(/\d+/g).map(Number).map(x => x / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn; let h = 0; if (dl) h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4; return Math.round(((h * 60) + 360) % 360); };
            const H = { ok: hue(sem.ok), warn: hue(sem.warn), none: hue(sem.none) };
            ok(H.ok > 120 && H.ok < 175 && H.warn > 25 && H.warn < 60 && (H.none < 20 || H.none > 345), `② ${dev}: 줄별 표시 색 = 초록·노랑·빨강 그대로(색상 각도)`, JSON.stringify(H));
            // 바깥에서 속성을 떼면 따라 떼고, 다시 붙이면 따라 붙는다
            await setTheme(d.pg, false); await d.pg.waitForTimeout(200); const off = await d.fr.evaluate(() => document.documentElement.getAttribute('data-ao-theme')); await setTheme(d.pg, true); await d.pg.waitForTimeout(200); const on = await d.fr.evaluate(() => document.documentElement.getAttribute('data-ao-theme'));
            ok(off === null && on === 'dark', `② ${dev}: 바깥 속성을 떼면 iframe 도 떼고 · 붙이면 다시 붙음(새로고침 없이)`, `뗌 ${off} · 붙임 ${on}`);
            ok(d.errs.length === 0, `② ${dev}: 화면 오류 0`, d.errs.join(' | ') || '없음');
            if (!mobile) {
                console.log('\n③ 결과물 무변경 — 야간으로 만든 엑셀·선택분 이미지 vs 밝은 화면에서 만든 것');
                ok(lightOut.xlsxName === d.out.xlsxName && lightOut.pngName === d.out.pngName, '③ 파일 이름 동일', `${d.out.xlsxName} · ${d.out.pngName}`);
                const xs = sheetDump(lightOut.xlsx) === sheetDump(d.out.xlsx); const xb = fs.readFileSync(lightOut.xlsx).equals(fs.readFileSync(d.out.xlsx));
                ok(xs, '③ 엑셀(시트1·발주발송관리): 칸 값·칸 색·글꼴·테두리·열 너비·병합 전부 동일', `파일 바이트까지 동일 = ${xb} · ${fs.statSync(d.out.xlsx).size}b`);
                const pa = fs.readFileSync(lightOut.png), pb = fs.readFileSync(d.out.png);
                ok(pa.equals(pb) && pa.length > 1000, '③ 선택분 이미지(PNG): 바이트 동일(= 픽셀 동일)', `${pa.length}b / ${pb.length}b`);
                // ④ 따로 연 화면 · 숨은 계산용
                console.log('\n④ 따로 연 화면 · 최종발주의 숨은 계산용(?fo=1)');
                const fo = await d.pg.evaluate(async () => { const mk = src => new Promise(res => { const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px'; f.src = src; f.onload = () => setTimeout(() => { const de = f.contentDocument.documentElement; const r = { attr: de.getAttribute('data-ao-theme'), bg: f.contentWindow.getComputedStyle(f.contentDocument.body).backgroundColor, card: f.contentWindow.getComputedStyle(f.contentDocument.querySelector('.card')).backgroundColor }; f.remove(); res(r); }, 600); document.body.appendChild(f); }); return { parent: document.documentElement.getAttribute('data-ao-theme'), fo: await mk('/invoice-v2.html?fo=1'), plain: await mk('/invoice-v2.html') }; });
                ok(fo.parent === 'dark' && fo.fo.attr === null && fo.fo.card === 'rgb(255, 255, 255)', '④ 숨은 계산용(?fo=1): 바깥이 야간이어도 켜짐 표시 없음 · 카드 흰색', JSON.stringify(fo.fo));
                ok(fo.plain.attr === null && fo.plain.card === 'rgb(255, 255, 255)', '④ embed 표시 없이 끼운 문서: 켜짐 표시 없음', JSON.stringify(fo.plain));
                const solo = await d.ctx.newPage(); await solo.goto(BASE + '/invoice-v2.html', { waitUntil: 'load' }); await solo.waitForTimeout(800); const sa = await solo.evaluate(() => ({ attr: document.documentElement.getAttribute('data-ao-theme'), card: getComputedStyle(document.querySelector('.card')).backgroundColor })); await solo.close();
                ok(sa.attr === null && sa.card === 'rgb(255, 255, 255)', '④ 따로 연 화면(/invoice-v2.html): 늘 밝음', JSON.stringify(sa));
            }
            await d.ctx.close();
        }
        const lk = Object.keys(lightAll); const expected = k => /^중간발주 수량 줄|^표시 칩 /.test(k);
        note('밝은 바탕으로 남은 칸', lk.map(k => `${k} ×${lightAll[k]}`).join(' ‖ ') || '없음');
        ok(lk.filter(k => !expected(k)).length === 0, '② 밝은 바탕으로 남은 칸 = 의도한 것뿐(중간발주 수량 줄 · 엑셀 칸 색과 같은 표시 칩)', lk.filter(k => !expected(k)).join(' ‖ ') || '그 밖 없음');
        note('스크린샷 폴더', SHOT);
        code = fail ? 1 : 0;
    } catch (e) { console.error('ERR', e && e.stack || e, '\n서버 끝부분:', tail); code = 2; }
    finally { try { if (br) await br.close(); } catch (_) { } srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(code);
})();
