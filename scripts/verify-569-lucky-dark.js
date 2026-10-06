// #569-B 야간 화면 — 이벤트 관리(/lucky-admin.html · 따로 열리는 직원용 화면) 검증
//   ① 밝은 화면 무회귀: 기억 값이 없거나 light 일 때 「HEAD 의 파일」과 「지금 파일」 스크린샷 바이트 동일(PC·폰)
//   ② 어두운 화면: 기억 값 dark 면 켜짐 · 글자 대비 미달 0 · 밝은 바탕으로 남은 칸 0 · 폰 가로 넘침 0 · 오류 0 · 다른 창에서 끄면 따라 꺼짐
//   읽기만(GET /api/agent-office/lucky/state) — POST 는 전부 막는다(실DB 쓰기 0)
//   실행: node scripts/verify-569-lucky-dark.js   (포트 3462)
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn, execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 900) : '')); return !!c; };
const PORT = 3462, BASE = `http://localhost:${PORT}`, ROOT = path.join(__dirname, '..');
const USER = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' };
const TOKEN = jwt.sign(USER, 'verifytest', { expiresIn: '1h' });
const SHOT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'verify569'); fs.mkdirSync(SHOT, { recursive: true });
const HEAD_HTML = execFileSync('git', ['show', (process.env.BASE_REF || '149f05d') + ':public/lucky-admin.html'], { cwd: ROOT, maxBuffer: 1 << 24 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AUDIT = () => {
    const P = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return { r: 0, g: 0, b: 0, a: 0 }; const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
    const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }; const L = c => .2126 * lin(c.r) + .7152 * lin(c.g) + .0722 * lin(c.b);
    const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const bgOf = el => { const ls = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c.a > 0) { ls.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = ls.length - 1; i >= 0; i--) base = over(ls[i], base); return base; };
    const faded = el => { for (let e = el; e && e !== document.body; e = e.parentElement) if (parseFloat(getComputedStyle(e).opacity) < 1) return true; return false; };
    const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
    const hex = c => '#' + [c.r, c.g, c.b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
    const out = { n: 0, skipped: 0, bad: [], light: {}, min: 99 };
    const check = (el, colorStr, what) => { const cs = getComputedStyle(el); const bg = bgOf(el); const fg = over(P(colorStr), bg); const a = L(fg), b = L(bg); const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05); const fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight, 10) || 400; const big = fs >= 24 || (fs >= 18.66 && fw >= 700); out.n++; if (ratio < out.min) out.min = ratio; if (ratio < (big ? 3 : 4.5)) out.bad.push(`${name(el)}${what} ${ratio.toFixed(2)}:1 (글자 ${hex(fg)} · 바탕 ${hex(bg)}) 「${(el.value || el.textContent || '').trim().slice(0, 14)}」`); };
    for (const el of document.body.querySelectorAll('*')) {
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; if (/^(SCRIPT|STYLE|OPTION)$/.test(el.tagName)) continue;
        const own = P(cs.backgroundColor); if (own.a >= 1 && L(own) > .6 && !el.classList.contains('toast')) out.light[name(el)] = (out.light[name(el)] || 0) + 1;
        const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName); const hasText = isField ? !/^(file|checkbox|radio|hidden|color)$/.test(el.type) : [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()); if (!hasText) continue;
        if (el.disabled || el.closest(':disabled') || faded(el)) { out.skipped++; continue; }
        check(el, cs.color, ''); if (isField && el.placeholder && !el.value) check(el, getComputedStyle(el, '::placeholder').color, ' (안내 글)');
    }
    out.min = +out.min.toFixed(2); return out;
};
async function open(br, o) {
    const ctx = await br.newContext({ viewport: o.mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 }, ...(o.mobile ? { isMobile: true, hasTouch: true } : {}), reducedMotion: 'reduce' });
    await ctx.addInitScript(([t, u, th]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); if (th && !sessionStorage.getItem('th569')) { localStorage.setItem('akm_ao_theme', th); sessionStorage.setItem('th569', '1'); } }, [TOKEN, USER, o.theme || '']);
    if (o.head) await ctx.route('**/lucky-admin.html*', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HEAD_HTML }));
    await ctx.route('**/api/agent-office/lucky/**', r => r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 403, json: { error: '시험에서는 쓰기를 막습니다' } }));
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await pg.goto(BASE + '/lucky-admin.html', { waitUntil: 'load' }); await pg.waitForTimeout(1800); await pg.evaluate(() => document.fonts && document.fonts.ready);
    const shot = async () => { let b = await pg.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' }); for (let i = 0; i < 6; i++) { await pg.waitForTimeout(350); const b2 = await pg.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' }); if (b2.equals(b)) break; b = b2; } return b; };
    return { ctx, pg, errs, shot };
}
(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] }); srv.stdout.on('data', () => { }); srv.stderr.on('data', () => { });
    let br, code = 1;
    try {
        for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/public/version')).ok) break; } catch (_) { } await sleep(1000); }
        const { chromium } = require('playwright'); br = await chromium.launch();
        const now = fs.readFileSync(path.join(ROOT, 'public/lucky-admin.html'), 'utf8').replace(/\r\n/g, '\n'), old = HEAD_HTML.toString('utf8').replace(/\r\n/g, '\n');
        const cut = old.indexOf('</style>'); const tailOld = old.slice(cut + '</style>'.length);
        ok(cut > 0 && now.startsWith(old.slice(0, cut)) && now.endsWith(tailOld), '⓪ lucky-admin.html = HEAD 그대로 + </style> 앞뒤에 덧붙임(기존 줄 무수정)', `HEAD ${old.length}자 → 지금 ${now.length}자`);
        const added = now.slice(cut, now.length - tailOld.length); const rules = added.slice(0, added.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(s => s.split('{')[0].trim()).filter(Boolean);
        const loose = rules.filter(sel => !sel.split(',').every(p => p.trim().startsWith('html[data-ao-theme="dark"]')));
        ok(rules.length > 15 && loose.length === 0, `⓪ 덧붙인 CSS 규칙 ${rules.length}개 전부 html[data-ao-theme="dark"] 아래`, loose.join(' | ') || '벗어난 규칙 없음');
        for (const mobile of [false, true]) {
            const dev = mobile ? '폰' : 'PC';
            const a = await open(br, { mobile, head: true }); const A = await a.shot(); const shownA = await a.pg.evaluate(() => !document.getElementById('app').classList.contains('hidden')); await a.ctx.close();
            const b = await open(br, { mobile }); const B = await b.shot(); const attrB = await b.pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme')); await b.ctx.close();
            const c = await open(br, { mobile, theme: 'light' }); const C = await c.shot(); await c.ctx.close();
            ok(shownA && A.equals(B) && A.equals(C) && attrB === null, `① ${dev}: 밝은 화면 — HEAD 파일 = 지금 파일(기억 값 없음) = 지금 파일(기억 값 light) 스크린샷 바이트 동일 · 로그인된 본 화면`, `${A.length}b · 켜짐 표시 ${attrB}`);
            const d = await open(br, { mobile, theme: 'dark' }); fs.writeFileSync(path.join(SHOT, `lucky-dark-${dev}.png`), await d.shot());
            const st = await d.pg.evaluate(() => ({ attr: document.documentElement.getAttribute('data-ao-theme'), bg: getComputedStyle(document.body).backgroundColor, card: getComputedStyle(document.querySelector('#app .card') || document.querySelector('.card')).backgroundColor }));
            ok(st.attr === 'dark' && st.bg === 'rgb(14, 17, 34)' && st.card === 'rgb(22, 26, 46)', `② ${dev}: 기억 값 dark → 켜짐 · 바탕·카드 어두움`, JSON.stringify(st));
            const r = await d.pg.evaluate(AUDIT);
            ok(r.bad.length === 0, `② ${dev}: 글자 대비 미달 0 (측정 ${r.n}곳 · 가장 낮은 값 ${r.min}:1 · 흐린 칸 ${r.skipped}곳 제외)`, r.bad.slice(0, 10).join(' ‖ ') || '없음');
            ok(Object.keys(r.light).length === 0, `② ${dev}: 밝은 바탕으로 남은 칸 0`, Object.entries(r.light).map(([k, v]) => k + '×' + v).join(' ‖ ') || '없음');
            if (mobile) { const w = await d.pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth })); ok(w.doc <= w.inner + 1, '② 폰: 가로 넘침 0', JSON.stringify(w)); }
            // 다른 창에서 기억 값을 바꾸면(회사 프로그램의 전환 버튼) 이 화면도 따라간다
            const other = await d.ctx.newPage(); await other.goto(BASE + '/api/public/version'); await other.evaluate(() => localStorage.setItem('akm_ao_theme', 'light')); await d.pg.waitForTimeout(400); const off = await d.pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme'));
            await other.evaluate(() => localStorage.setItem('akm_ao_theme', 'dark')); await d.pg.waitForTimeout(400); const on = await d.pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme')); await other.close();
            ok(off === null && on === 'dark', `② ${dev}: 다른 창에서 끄면 따라 꺼지고 · 켜면 따라 켜짐`, `끔 ${off} · 켬 ${on}`);
            ok(a.errs.length + b.errs.length + d.errs.length === 0, `② ${dev}: 화면 오류 0`, [...a.errs, ...b.errs, ...d.errs].join(' | ') || '없음');
            await d.ctx.close();
        }
        code = fail ? 1 : 0;
    } catch (e) { console.error('ERR', e && e.stack || e); code = 2; }
    finally { try { if (br) await br.close(); } catch (_) { } srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(code);
})();
