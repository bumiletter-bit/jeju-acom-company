// #708-B 검증: 이벤트 관리 화면(public/event-admin.js · event-admin.css) — 회사프로그램 안 메뉴 「이벤트 관리」
//   로컬 실서버(3461 · JWT_SECRET=local708 · setInterval 무력화 · 실DB 읽기만) + Playwright.
//   🔴 이벤트 API(/api/agent-office/lucky/* · /api/lucky/*)·지시 만들기·첨부 내려받기는 전부 가로채 가짜로 답한다(docs/708-api.md 꼴) → 실DB 쓰기 0.
//   /lucky.html 도 가짜 쪽(lucky:ready → 받은 lucky:preview 기록 → lucky:rendered)으로 바꿔 미리보기 메시지만 본다(손님 페이지 자체는 C 몫 검증).
//   ⓐ 390·900 밝음: 빈 새 회차 = 카드 미완/완료 · 열기 단추 잠김 → ①② 채우고 그림 올리면 풀림 · 저장 본문 · 열기 → 진행 중 · 6/6
//   ⓑ 그림 올리기 → 미리보기 메시지에 그림 주소 · AI 맡기기 → 지시 머리말 · 후보 → [이 그림 쓰기]
//   ⓒ 44px · 가로 넘침 0 · 콘솔 오류 0 · 야간 대비 · 알림 링크 event?step=3 · ⓓ 다른 메뉴 스모크
//   실행: node scripts/verify-708-ui.js [--shot=폴더]   (PORT708 로 포트 바꿈)
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path');
const ROOT = path.join(__dirname, '..'), PORT = Number(process.env.PORT708) || 3461, BASE = `http://localhost:${PORT}`;
const SHOT = (process.argv.slice(2).find(a => a.startsWith('--shot=')) || '').slice(7);
const results = [];
const ok = (name, pass, note) => { results.push(!!pass); console.log((pass ? '✅' : '❌') + ' ' + name + (note != null && note !== '' ? ' — ' + String(note).slice(0, 600) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ── 가짜 이벤트 서버(docs/708-api.md 3절 꼴) ──
const SRV_TEXTS = { prize_head_hand: '제주의 좋은 마음을 선물합니다! ♡', corner_hand: '늘 함께해 주셔서\n감사합니다! ♡', search_hand: '성함·번호로 확인해보세요! ♡', winner_hand: '함께해 주신 모든 분께 감사드립니다! ♡', winner_foot: '당첨되신 분께는 순차적으로 연락드리며, 경품은 주문 시 배송지로 보내드립니다 🍊', noitem_products: '감귤·황금향 등' };   // lucky-event.js TEXT_DEFAULTS
function fakeServer(opt) {
    opt = opt || {};
    const F = { id: opt.noRound ? null : 41, assets: [{ id: 7, slot: 'brand', label: '황금향', url: '/api/lucky/asset/7?v=aaaa1111' }], nextAsset: 100, writes: [], orders: [], order: null };
    F.db = { event: { title: '새 이벤트', start: '', end: '', announce: '', page_until: '', prizes: [], published: false, excludeProducts: [], live_mode: opt.noRound ? 'legacy' : 'draft', texts: Object.assign({}, SRV_TEXTS), guide_card: { enabled: true, custom: false }, bot_reply: { enabled: true, custom: false }, pending_art: [] }, orders: [], winners: [], excluded: [], uploads: [] };
    const stateOf = e => e.live_mode === 'down' ? 'down' : (e.live_mode === 'live' || (e.live_mode === 'scheduled' && e.start && TODAY >= e.start)) ? (e.published ? 'published' : 'live') : 'preparing';
    const checklist = () => { const e = F.db.event; const basics = !!(e.title && e.start && e.end && e.announce && e.page_until); const prizes = e.prizes.length > 0 && e.prizes.every(p => p.name && p.count > 0 && p.image_id); const missing = []; if (!basics) missing.push('기간·제목'); if (!prizes) missing.push('경품'); return { ready: basics && prizes, steps: { basics, prizes, images: true, texts: true, preview: null, open: ['live', 'published'].includes(stateOf(e)) }, missing }; };
    F.body = extra => Object.assign({ ok: true, db: F.db, id: F.id, state: stateOf(F.db.event), checklist: checklist() }, extra || {});
    F.handle = (method, p, body) => {
        if (method !== 'GET') F.writes.push({ method, p, body });
        if (p === '/api/agent-office/lucky/state') return F.body();
        if (p === '/api/agent-office/lucky/new-round') { F.id = (F.id || 41) + 1; F.db.event = { title: body.title || '새 이벤트', start: '', end: '', announce: '', page_until: '', prizes: [], published: false, excludeProducts: [], live_mode: 'draft', texts: Object.assign({}, SRV_TEXTS), guide_card: { enabled: true, custom: false }, bot_reply: { enabled: true, custom: false }, pending_art: [] }; return { ok: true, db: F.db }; }   // 실서버처럼 id·state 없음
        if (p === '/api/agent-office/lucky/assets' && method === 'GET') return { ok: true, assets: F.assets };
        if (/^\/api\/agent-office\/lucky\/assets\/\d+$/.test(p) && method === 'DELETE') { const id = +p.split('/').pop(); const e = F.db.event; const used = [e.hero_image_id, e.winner_image_id, e.result_image_id].concat((e.prizes || []).map(x => x.image_id)).includes(id); if (used) return { status: 409, json: { error: 'IN_USE' } }; F.assets = F.assets.filter(a => a.id !== id); return { ok: true }; }
        if (p === '/api/agent-office/lucky/assets') { const id = F.nextAsset++; const a = { id, slot: body.slot, label: body.label, mime: body.mime, url: `/api/lucky/asset/${id}?v=bbbb${id}`, width: body.width, height: body.height }; F.assets.push(a); return { ok: true, asset: a }; }
        if (p === '/api/agent-office/lucky/event') { const e = body.event || {}; Object.assign(F.db.event, e, { live_mode: F.db.event.live_mode }); if (!F.db.event.page_until && F.db.event.announce) F.db.event.page_until = addDays(F.db.event.announce, 3); F.db.excluded = body.excluded || []; return F.body({ synced: { card: false, bot: false } }); }
        if (p === '/api/agent-office/lucky/go-live') { if (['live', 'scheduled'].includes(body.mode) && !checklist().ready) return { status: 400, json: { error: 'NOT_READY', missing: checklist().missing } }; F.db.event.live_mode = body.mode; return F.body({ synced: { card: true, bot: true } }); }
        if (p === '/api/agent-office/lucky/rounds') return { ok: true, rounds: [{ id: 40, title: '추석 감사', start: '2026-09-10', end: '2026-09-21', orders: 0, winners: 0 }] };
        if (p === '/api/agent-office/lucky/products') { F.pc = (F.pc || 0) + 1; } if (p === '/api/agent-office/lucky/products') return { ok: true, groups: [{ name: '청귤', words: ['청귤', '풋귤'], selling: true, options: [{ name: '청귤 1kg', status: '판매중' }, { name: '청귤 2kg 선물용', status: '판매중' }] }, { name: '황금향', words: ['황금향'], selling: true, options: [{ name: '황금향 3kg', status: '판매중' }, { name: '황금향 5kg 선물용', status: '판매중' }] }, { name: '하우스감귤', words: ['하우스감귤', '하우스귤', '하우스'], selling: false, options: [{ name: '하우스감귤 가정용 - 2.5kg(소과)', status: '시즌종료' }] }, { name: '초당옥수수', words: ['초당옥수수', '옥수수'], selling: false, options: [] }] };
        if (p === '/api/agent-office/lucky/bot-preview' && F.bp429) return { status: 429, json: { error: 'LIMIT' } };
        if (p === '/api/agent-office/lucky/bot-preview') { F.bp = (F.bp || 0) + 1; const e = body.event || {}; const cp = String(e.coupon_text || '').trim(); const lines = ['응모 기간 안내', cp ? '쿠폰 ' + cp : '', '발표 안내'].filter(Boolean); return { ok: true, bot: { text: '안녕하세요 고객님 제주아꼼이네입니다 🍊\n' + (e.display_title || e.title || '') + (cp ? '\n🎟 ' + cp : '') + '\n▶ https://event.akkome.com/lucky.html', custom: false, keywords: ['이벤트'] }, card: { title: '🎁 ' + (e.title || ''), lines: lines.filter(l => !/쿠폰/.test(l)), btn: '접수·당첨 확인 바로가기', dropped: lines.filter(l => /쿠폰/.test(l)), custom: false }, state: 'preparing' }; }
        if (p === '/api/agent-office/lucky/preview-key') return { ok: true, pk: 'pk708', url: '/lucky.html?pk=pk708' };
        if (/^\/api\/agent-office\/lucky\//.test(p)) return F.body();
        if (p === '/api/agent-office/orders' && method === 'POST') { F.order = { id: 9001, content: body.content, status: '완료', result: { files: [{ label: '후보1.png', file_id: 555, size: 1000 }, { label: '메모.txt', file_id: 556 }] } }; return { message: 'ok', order: { id: 9001, status: '대기' } }; }
        if (p === '/api/agent-office/orders/9001') return { order: F.order };
        return null;
    };
    return F;
}
// 미리보기 가짜 쪽 — 부모에 lucky:ready → 받은 메시지 기록 → lucky:rendered
const STUB = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px sans-serif"><div id="o">stub</div><script>
window.__msgs=[];addEventListener('message',e=>{ if(e.origin!==location.origin||!e.data||e.data.type!=='lucky:preview') return; __msgs.push(e.data); document.getElementById('o').textContent=JSON.stringify(e.data).slice(0,200); parent.postMessage({type:'lucky:rendered',scene:e.data.scene},location.origin); });
parent.postMessage({type:'lucky:ready'},location.origin);</script>`;
const AUDIT = sel => { const P = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return { r: 0, g: 0, b: 0, a: 0 }; const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
    const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }, L = c => .2126 * lin(c.r) + .7152 * lin(c.g) + .0722 * lin(c.b), over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const page = P(getComputedStyle(document.body).backgroundColor); const bgOf = el => { const ls = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c.a > 0) { ls.push(c); if (c.a >= 1) break; } } let b = page.a ? page : { r: 255, g: 255, b: 255, a: 1 }; for (let i = ls.length - 1; i >= 0; i--) b = over(ls[i], b); return b; };
    const root = document.querySelector(sel); const out = { n: 0, bad: [], white: [], min: 99 }; if (!root) return out;
    for (const el of root.querySelectorAll('*')) { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length || el.closest('.ev-frame-wrap')) continue;
        const own = P(cs.backgroundColor); const r = el.getBoundingClientRect(); if (own.a >= .9 && Math.min(own.r, own.g, own.b) > 170 && r.width * r.height > 400 && !/IMG|IFRAME/.test(el.tagName)) out.white.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
        const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName); if (!(isField || [...el.childNodes].some(n => n.nodeType === 3 && /[0-9A-Za-z가-힣]/.test(n.nodeValue)))) continue; if (el.disabled || parseFloat(cs.opacity) < 1) continue;
        const check = col => { const bg = bgOf(el), fg = over(P(col), bg), a = L(fg), b = L(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05); const fs = parseFloat(cs.fontSize), big = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700); out.n++; out.min = Math.min(out.min, ratio); if (ratio < (big ? 3 : 4.5)) out.bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${ratio.toFixed(2)} 「${(el.value || el.textContent || '').trim().slice(0, 12)}」`); };
        if (!isField || el.value) check(cs.color); if (isField && el.placeholder && !el.value) check(getComputedStyle(el, '::placeholder').color); }
    out.min = +out.min.toFixed(2); return out; };

(async () => {
    let srv = null, browser = null;
    try {
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'local708', PORT: String(PORT) }, stdio: 'ignore' });
        let up = false; for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(BASE + '/'); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동', up); if (!up) throw new Error('server not up');
        const USER = { id: 1, username: 'v708', name: '시험', position: '대표', role: 'admin' }; const token = jwt.sign(USER, 'local708', { expiresIn: '40m' });
        const { chromium } = require('playwright'); browser = await chromium.launch();
        const PNG = await (async () => { const pg = await browser.newPage(); const d = await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#F5A623'; x.fillRect(0, 0, 900, 600); x.fillStyle = '#4F46E5'; x.fillRect(100, 100, 300, 300); return c.toDataURL('image/png'); }); await pg.close(); return Buffer.from(d.split(',')[1], 'base64'); })();
        const open = async (vw, o) => { o = o || {};
            const F = fakeServer({ noRound: o.noRound });
            const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce' }, o.phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const st = { errors: [], console: [] };
            pg.on('pageerror', e => st.errors.push(String(e))); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) st.console.push(m.text()); }); pg.on('dialog', d => { st.errors.push('브라우저 dialog: ' + d.message()); d.dismiss().catch(() => { }); });
            await pg.route(u => /^\/api\/(agent-office\/lucky\/|lucky\/|agent-office\/orders(\/9001)?$|agent-office\/files\/555\/download)/.test(u.pathname), async route => {
                const rq = route.request(), u = new URL(rq.url());
                if (u.pathname.startsWith('/api/lucky/asset/') || u.pathname === '/api/agent-office/files/555/download') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
                if (u.pathname === '/api/agent-office/orders' && rq.method() === 'GET') return route.continue();
                let body = null; try { body = rq.postDataJSON(); } catch (_) { }
                const out = F.handle(rq.method(), u.pathname, body || {});
                if (out == null) return route.continue();
                if (out.status) return route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.json) });
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
            });
            await pg.route(u => u.pathname === '/lucky.html', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUB }));
            await ctx.addInitScript(([t, u, th]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); if (!sessionStorage.getItem('i708')) { sessionStorage.setItem('i708', '1'); localStorage.setItem('akm_ao_theme', th); localStorage.setItem('akm_last_page', 'schedule'); } }, [token, USER, o.theme || 'light']);
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2600);
            await pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important} *{caret-color:transparent!important}' }).catch(() => { });
            return { pg, ctx, st, F };
        };
        const goEvent = async (pg, phone) => {
            if (phone) { const t = await pg.$('#mobile-menu-btn, .mobile-menu-btn, #hamburger'); if (t && await t.isVisible()) { await t.click(); await pg.waitForTimeout(300); } }
            await pg.evaluate(() => document.querySelector('.nav-item[data-page="event"]').click()); await pg.waitForSelector('#event-root .ev-card, #event-root .ev-none', { timeout: 10000 }); await pg.waitForTimeout(500);
        };
        const cards = pg => pg.evaluate(() => [...document.querySelectorAll('#event-root .ev-card')].map(c => c.classList.contains('done') ? 1 : 0).join(''));
        const head = pg => pg.evaluate(() => ({ pill: (document.querySelector('.ev-head .ev-pill') || {}).textContent, ready: (document.querySelector('.ev-ready b') || {}).textContent }));
        const setVal = (pg, k, v) => pg.evaluate(([k, v]) => { const el = document.querySelector(`#event-root [data-k="${k}"]`); el.value = v; el.dispatchEvent(new Event(el.classList.contains('akm-date') ? 'change' : 'input', { bubbles: true })); }, [k, v]);
        const openCard = async (pg, k) => { const isOpen = await pg.evaluate(k => document.querySelector(`.ev-card[data-step="${k}"]`).classList.contains('open'), k); if (!isOpen) { await pg.click(`.ev-card[data-step="${k}"] .ev-card-h`); await pg.waitForTimeout(250); } };
        const upload = async (pg, sel) => { const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click(sel)]); await fc.setFiles({ name: 'test.png', mimeType: 'image/png', buffer: PNG }); await pg.waitForTimeout(1500); };
        const small44 = pg => pg.evaluate(() => [...document.querySelectorAll('#event-root button, #event-root input, #event-root select, #event-root textarea, #event-root [role="button"]')].filter(e => e.getClientRects().length && !e.hidden && e.type !== 'file').map(e => { const r = e.getBoundingClientRect(); return [e, r]; }).filter(([, r]) => r.height < 44 - 0.5).map(([e, r]) => (e.dataset.ev || e.dataset.k || e.className) + ':' + Math.round(r.height)));
        const overflow = pg => pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

        // ── #708-B 손질: 회차 없음(0행) · 서버 기본 글자 줄바꿈 · 경품 설명 줄바꿈 · 인원 숫자 ──
        for (const [label, vw, phone] of (['brand', '711'].includes(process.env.V708_ONLY) ? [] : [['390', { width: 390, height: 844 }, true], ['1280', { width: 1280, height: 900 }, false]])) {
            const X = await open(vw, { phone, noRound: true }); const { pg, F } = X; const tag = label + ' 손질';
            await goEvent(pg, phone);
            const z = await pg.evaluate(() => ({ cards: document.querySelectorAll('#event-root .ev-card').length, pill: (document.querySelector('.ev-head .ev-pill') || {}).textContent, btns: [...document.querySelectorAll('#event-root [data-ev]')].map(b => b.dataset.ev) }));
            ok(`${tag}: 회차 없음(0행) = 카드 0 · 머리띠 「회차 없음」 · 단추는 「새 회차 시작」 하나`, z.cards === 0 && /회차 없음/.test(z.pill || '') && z.btns.join() === 'new', JSON.stringify(z));
            await pg.click('[data-ev="new"]'); await pg.waitForSelector('.ev-dlg'); await pg.click('.ev-dlg [data-x="1"]'); await pg.waitForTimeout(900);
            const z2 = await pg.evaluate(() => ({ cards: document.querySelectorAll('#event-root .ev-card').length, pill: (document.querySelector('.ev-head .ev-pill') || {}).textContent.trim() }));
            ok(`${tag}: 새 회차 → 응답에 id 가 없어도 /state 로 다시 읽어 카드 6장 · 「준비 중」`, z2.cards === 6 && z2.pill === '준비 중' && F.writes.some(w => w.p.endsWith('/new-round') && w.body.confirm === 'NEW'), JSON.stringify(z2));
            await openCard(pg, 4);
            const ch = await pg.evaluate(() => { const t = document.querySelector('[data-k="texts.corner_hand"]'); return { tag: t.tagName, v: t.value }; });
            ok(`${tag}: 오른쪽 아래 손글씨 = 서버 기본 글자 그대로(줄바꿈 칸 · \\n 유지)`, ch.tag === 'TEXTAREA' && ch.v === '늘 함께해 주셔서\n감사합니다! ♡', JSON.stringify(ch));
            await openCard(pg, 2); await pg.click('[data-ev="padd"]'); await setVal(pg, 'prizes.0.name', '황금향 3kg'); await setVal(pg, 'prizes.0.count', '4');
            await pg.fill('[data-k="prizes.0.desc"]', '첫 줄\n둘째 줄'); await pg.waitForTimeout(300);
            if (label === '390') await openCard(pg, 5);
            await pg.waitForTimeout(900);
            const m = (await (pg.frames().find(fr => /lucky\.html/.test(fr.url()))).evaluate(() => window.__msgs)).pop();
            ok(`${tag}: 미리보기 메시지 = 인원 숫자(4) · 설명 줄바꿈 · 손글씨 줄바꿈`, m.event.prizes[0].count === 4 && m.event.prizes[0].desc === '첫 줄\n둘째 줄' && m.event.texts.corner_hand === '늘 함께해 주셔서\n감사합니다! ♡', JSON.stringify({ c: m.event.prizes[0].count, d: m.event.prizes[0].desc, h: m.event.texts.corner_hand }));
            await pg.click('[data-ev="save"]'); await pg.waitForTimeout(600);
            const sv = F.writes.filter(w => w.p.endsWith('/event')).pop();
            ok(`${tag}: 저장 본문 = 인원 숫자 · 설명 줄바꿈 · 손글씨 줄바꿈`, sv && sv.body.event.prizes[0].count === 4 && sv.body.event.prizes[0].desc === '첫 줄\n둘째 줄' && sv.body.event.texts.corner_hand === '늘 함께해 주셔서\n감사합니다! ♡', sv && JSON.stringify(sv.body.event.prizes[0]));
            const sm = phone ? await small44(pg) : [];
            if (phone) ok(`${tag}: 44px(줄바꿈 칸 포함)`, sm.length === 0, sm.join(', '));
            ok(`${tag}: 오류 0`, !X.st.errors.length && !X.st.console.length, X.st.errors.concat(X.st.console).slice(0, 3).join(' | '));
            await X.ctx.close();
        }
        if (process.env.V708_ONLY === 'fix') throw { done: true };   // 손질 구간만
        // ── #709 품목 사진 관리(② 카드 아래) ──
        for (const [label, vw, phone] of process.env.V708_ONLY === '711' ? [] : [['390', { width: 390, height: 844 }, true], ['1280', { width: 1280, height: 900 }, false]]) {
            const X = await open(vw, { phone }); const { pg, F } = X; const tag = label + ' 품목 사진';
            await goEvent(pg, phone); await openCard(pg, 2); await pg.waitForTimeout(1200);
            const bItems = () => pg.evaluate(() => [...document.querySelectorAll('#ev-brand .ev-bitem')].map(li => li.querySelector('b').textContent + (li.querySelector('img') ? ':img' : '')));
            const b0 = await pg.evaluate(() => { const box = document.getElementById('ev-brand'), first = box.querySelector('input, .ev-bitem, [data-ev]'); return { items: box.querySelectorAll('.ev-bitem').length, hint: (box.querySelector('.ev-bhint') || {}).textContent, firstIsSearch: !!first && first.id === 'ev-blabel', guide: box.querySelector('.ev-sub-h').textContent, opts: document.querySelectorAll('#ev-bnames option').length, btns: [...box.querySelectorAll('[data-ev]')].map(x => x.dataset.ev) }; });
            ok(`${tag}: #711 품목 사진 = 검색 칸 맨 위 · 검색 전 목록 0 + 「검색하면 사진이 보여요 · 1장」 · 안내 글 · [품목 사진 올리기]`, b0.items === 0 && /검색하면 사진이 보여요 · 1장/.test(b0.hint || '') && b0.firstIsSearch && /경품 상품을 대표상품 참고하여 이미지 제작을 합니다/.test(b0.guide) && b0.btns.join() === 'badd' && b0.opts > 6, JSON.stringify(b0));
            await pg.fill('#ev-blabel', '황금'); await pg.waitForTimeout(200);
            const b1 = await bItems();
            ok(`${tag}: #711 「황금」 검색 → 황금향 사진(썸네일 · [바꾸기][지우기]) · 지우면 다시 0`, b1.join() === '황금향:img' && await pg.evaluate(() => document.querySelectorAll('#ev-brand .ev-bitem [data-ev]').length === 2), JSON.stringify(b1));
            await pg.fill('#ev-blabel', ''); await pg.waitForTimeout(150);
            const w0 = F.writes.length; await pg.click('[data-ev="badd"]'); await pg.waitForTimeout(400);
            ok(`${tag}: 품목 이름 없이 누르면 안내만(파일 창·서버 호출 0)`, F.writes.length === w0 && await pg.evaluate(() => document.activeElement && document.activeElement.id === 'ev-blabel'));
            await pg.fill('#ev-blabel', '고당도 하우스감귤');
            { const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('[data-ev="badd"]')]); await fc.setFiles({ name: 'gyul.png', mimeType: 'image/png', buffer: PNG }); await pg.waitForTimeout(1500); }
            const ub = F.writes.filter(w => w.p.endsWith('/assets')).pop();
            ok(`${tag}: 올리기 = POST /assets {slot:brand · label · webp · 480×480 가운데 자르기}`, ub && ub.body.slot === 'brand' && ub.body.label === '고당도 하우스감귤' && ub.body.mime === 'image/webp' && ub.body.width === 480 && ub.body.height === 480, ub && JSON.stringify({ slot: ub.body.slot, label: ub.body.label, w: ub.body.width, h: ub.body.height }));
            await pg.fill('#ev-blabel', '유라조생');
            { const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('[data-ev="badd"]')]); await fc.setFiles({ name: 'yura.png', mimeType: 'image/png', buffer: PNG }); await pg.waitForTimeout(1500); }
            const yid = F.assets.find(a => a.label === '유라조생').id, hid = F.assets.find(a => a.label === '고당도 하우스감귤').id;
            await pg.click('[data-ev="padd"]'); await setVal(pg, 'prizes.0.name', '청귤 1kg'); await setVal(pg, 'prizes.0.count', '1');
            await pg.click('[data-ev="padd"]'); await setVal(pg, 'prizes.1.name', '노지감귤 5kg'); await setVal(pg, 'prizes.1.count', '1');
            await pg.click('[data-ev="padd"]'); await setVal(pg, 'prizes.2.name', '제철 감귤 3kg'); await setVal(pg, 'prizes.2.count', '1');
            await pg.click('[data-ev="save"]'); await pg.waitForTimeout(700);
            const svm = F.writes.filter(w => w.p.endsWith('/event')).pop().body.event.prizes.map(p => p.image_id);
            ok(`${tag}: 매칭 = 청귤 1kg → 사진 안 붙음 · 노지감귤 5kg → 유라조생 사진 · 맨 「감귤」 → 안 붙음(하우스 사진 금지)`, svm[0] === null && svm[1] === yid && svm[2] === null, JSON.stringify({ svm, yid, hid }));
            await pg.click('[data-ev="pdel"][data-i="2"]'); await pg.click('[data-ev="pdel"][data-i="1"]'); await pg.click('[data-ev="pdel"][data-i="0"]'); await pg.waitForTimeout(300);
            await pg.click('[data-ev="padd"]'); await setVal(pg, 'prizes.0.name', '고당도 하우스감귤 3kg 선물용'); await setVal(pg, 'prizes.0.count', '2'); await pg.click('[data-ev="save"]'); await pg.waitForTimeout(700);
            const pz = await pg.evaluate(() => (document.querySelector('.ev-prize .ev-prize-img > span') || {}).textContent);
            const sv = F.writes.filter(w => w.p.endsWith('/event')).pop();
            ok(`${tag}: 「고당도 하우스감귤 3kg」 경품 = 같은 이름 품목 사진 자동(글자 일치 · 저장 image_id = 그 사진)`, /품목 사진/.test(pz || '') && F.assets.find(a => a.label === '고당도 하우스감귤').id === sv.body.event.prizes[0].image_id, (pz || '') + ' · ' + JSON.stringify(sv.body.event.prizes[0]));
            // 바꾸기(황금향 · 안 쓰는 사진) → 새로 올리고 옛 것 지움
            await pg.fill('#ev-blabel', '황금향'); await pg.waitForTimeout(150);
            { const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#ev-brand .ev-bitem[data-id="7"] [data-ev="brep"]')]); await fc.setFiles({ name: 'hgh.png', mimeType: 'image/png', buffer: PNG }); await pg.waitForTimeout(1500); }
            const rep = F.writes.slice(-2);
            ok(`${tag}: [바꾸기] = 같은 이름으로 새로 올리고 옛 사진 DELETE · 목록 1장 유지`, rep[0].p.endsWith('/assets') && rep[0].body.label === '황금향' && rep[1].method === 'DELETE' && /assets\/7$/.test(rep[1].p) && await pg.evaluate(() => [...document.querySelectorAll('#ev-brand .ev-bitem b')].filter(b => b.textContent === '황금향').length === 1), JSON.stringify(rep.map(w => w.method + ' ' + w.p)));
            // 지우기 — 쓰는 사진(감귤)이면 409 안내 · 남아 있음
            const gid = F.assets.find(a => a.label === '고당도 하우스감귤').id; await pg.fill('#ev-blabel', '하우스'); await pg.waitForTimeout(150);
            await pg.click(`#ev-brand .ev-bitem[data-id="${gid}"] [data-ev="bdel"]`); await pg.waitForSelector('.ev-dlg'); await pg.click('.ev-dlg [data-x="1"]'); await pg.waitForTimeout(700);
            const st409 = await pg.evaluate(gid => ({ still: !!document.querySelector(`#ev-brand .ev-bitem[data-id="${gid}"]`), toast: [...document.querySelectorAll('.toast-message')].map(t => t.textContent).join(' ') }), gid);
            ok(`${tag}: 경품이 쓰는 사진 [지우기] = 409 → 「쓰고 있어 지울 수 없어요」 안내 · 목록에 남음`, st409.still && /쓰고 있어/.test(st409.toast), JSON.stringify(st409));
            const sm = phone ? await small44(pg) : [];
            if (phone) ok(`${tag}: 44px`, sm.length === 0, sm.join(', '));
            ok(`${tag}: 가로 넘침 0 · 오류 0`, !(await overflow(pg)) && !X.st.errors.length && !X.st.console.length, X.st.errors.concat(X.st.console).slice(0, 3).join(' | '));
            if (SHOT) await pg.screenshot({ path: path.join(SHOT, `709-${label}.png`), fullPage: true });
            await X.ctx.close();
        }
        if (process.env.V708_ONLY === 'brand') throw { done: true };
        // ── #711 이벤트 관리 2차 손질: ① 칩 · ④ 문장·봇 답 미리보기 · ⑤ 상태 탭·자동 전환 · ③ 쓰이는 곳 · 머리띠 초기화 ──
        for (const [label, vw, phone] of [['390', { width: 390, height: 844 }, true], ['900', { width: 900, height: 1000 }, true], ['1440', { width: 1440, height: 1000 }, false]]) {
            const X = await open(vw, { phone }); const { pg, F } = X; const tag = label + ' #711';
            F.assets.push({ id: 8, slot: 'brand', label: '초당옥수수', url: '/api/lucky/asset/8?v=cccc8888' });
            await goEvent(pg, phone); await pg.waitForTimeout(600);
            const lastMsg = async () => { await pg.waitForTimeout(500); const fr = pg.frames().find(f => /lucky\.html/.test(f.url())); return fr ? (await fr.evaluate(() => window.__msgs)).pop() || {} : {}; };
            const chipsOf = k => pg.evaluate(k => [...document.querySelectorAll(`#ev-${k} .ev-chip > span`)].map(s => s.textContent), k);
            // ① 응모 제외 품목: 빈 칸 = 품목 묶음 단추 · 치면 옵션까지 · 누르면 칩 · 직접 입력 Enter · × 로 빼기
            const pk0 = await pg.evaluate(() => [...document.querySelectorAll('#ev-xp-pick [data-ev="pick"]')].map(b => b.dataset.v));
            ok(`${tag}: ① 응모 제외 품목 = 목록(품목 묶음 4 · /lucky/products) · 칩 0`, pk0.join() === '청귤,황금향,하우스감귤,초당옥수수' && (await chipsOf('xp')).length === 0, JSON.stringify(pk0));
            await pg.fill('#ev-xp-in', '선물'); await pg.waitForTimeout(150);
            const pk1 = await pg.evaluate(() => [...document.querySelectorAll('#ev-xp-pick [data-ev="pick"]')].map(b => b.dataset.v));
            ok(`${tag}: ① 「선물」 검색 → 옵션 이름 2개만`, pk1.join() === '청귤 2kg 선물용,황금향 5kg 선물용', JSON.stringify(pk1));
            await pg.click('#ev-xp-pick [data-v="청귤 2kg 선물용"]'); await pg.waitForTimeout(150);
            await pg.fill('#ev-xp-in', '키위'); await pg.press('#ev-xp-in', 'Enter'); await pg.waitForTimeout(150);
            const c1 = await chipsOf('xp');
            ok(`${tag}: ① 목록 누름 + 직접 입력 Enter → 칩 2(입력 칸 비고 초점 유지)`, c1.join() === '청귤 2kg 선물용,키위' && await pg.evaluate(() => document.activeElement.id === 'ev-xp-in' && document.activeElement.value === ''), JSON.stringify(c1));
            await pg.click('#ev-xp .ev-chip-x[data-i="0"]'); await pg.waitForTimeout(150);
            await pg.click('#ev-xp-pick [data-v="청귤"]'); await pg.waitForTimeout(150);
            const c2 = await chipsOf('xp');
            ok(`${tag}: ① × 로 빼기 → 남은 칩 · 다시 고르면 추가(같은 글자 중복 0)`, c2.join() === '키위,청귤' && await pg.evaluate(() => document.querySelector('#ev-xp-pick [data-v="청귤"]').disabled), JSON.stringify(c2));
            await pg.fill('#ev-xp-in', '풋귤'); await pg.waitForTimeout(150);
            const gr = await pg.evaluate(() => [...document.querySelectorAll('#ev-xp-pick [data-ev="pick"]')].map(b => b.dataset.v + (b.disabled ? ':회색' : '')));
            await pg.fill('#ev-xp-in', '청귤 1'); await pg.waitForTimeout(150);
            const go = await pg.evaluate(() => [...document.querySelectorAll('#ev-xp-pick [data-ev="pick"]')].map(b => b.dataset.v + (b.disabled ? ':회색' : '')).concat([/네이버 주문에만/.test(document.getElementById('ev-xp-pick').textContent) ? '안내' : '']));
            await pg.fill('#ev-xp-in', ''); await pg.waitForTimeout(100);
            ok(`${tag}: ① 낱말(words) 「풋귤」 → 청귤 묶음 · 묶음 칩이 있으면 그 옵션은 회색 · 옵션 안내 한 줄`, gr.join() === '청귤:회색' && go.join() === '청귤:회색,청귤 1kg:회색,안내', JSON.stringify([gr, go]));
            // ① 추첨 제외 연락처: 숫자 칩 · 짧으면 안내만
            await pg.fill('#ev-xc-in', '010-1111-2222'); await pg.click('[data-ev="chipadd"][data-kind="xc"]'); await pg.waitForTimeout(150);
            await pg.fill('#ev-xc-in', '1234'); await pg.press('#ev-xc-in', 'Enter'); await pg.waitForTimeout(300);
            const x1 = await chipsOf('xc'), tst = await pg.evaluate(() => [...document.querySelectorAll('.toast-message')].map(t => t.textContent).join(' '));
            const bad = await pg.evaluate(() => [...document.querySelectorAll('#ev-xc .ev-chip')].map(li => li.classList.contains('bad') ? 1 : 0).join(''));
            ok(`${tag}: ① 연락처 [+ 추가] → 「010-1111-2222」 칩 · 4자리 = 빨간 칩 + 안내(숫자만 · docs/711 2-3)`, x1.join() === '010-1111-2222,1234' && bad === '01' && /10~11자리/.test(tst), JSON.stringify(x1) + ' ' + bad + ' ' + tst.slice(0, 80));
            await pg.click('[data-ev="save"]'); await pg.waitForTimeout(600);
            const sv = F.writes.filter(w => w.p.endsWith('/event')).pop();
            ok(`${tag}: ① 저장 꼴 = 종전 배열(excludeProducts 글자 · excluded 숫자)`, sv && JSON.stringify(sv.body.event.excludeProducts) === '["키위","청귤"]' && JSON.stringify(sv.body.excluded) === '["01011112222","1234"]', sv && JSON.stringify({ x: sv.body.event.excludeProducts, e: sv.body.excluded }));
            const pc0 = F.pc; await pg.click('.ev-card[data-step="1"] .ev-card-h'); await pg.waitForTimeout(200); await pg.click('.ev-card[data-step="1"] .ev-card-h'); await pg.waitForTimeout(500);
            ok(`${tag}: ④ ① 카드를 다시 펼치면 /products 다시 읽음(${pc0} → ${F.pc})`, F.pc === pc0 + 1, '');
            await openCard(pg, 2); await pg.click('[data-ev="padd"]'); await setVal(pg, 'prizes.0.name', '옥수수 3kg'); await setVal(pg, 'prizes.0.count', '1'); await pg.click('[data-ev="save"]'); await pg.waitForTimeout(700);
            const pzc = await pg.evaluate(() => (document.querySelector('.ev-prize .ev-prize-img > span') || {}).textContent || '');
            ok(`${tag}: ④ 「옥수수 3kg」 경품 = /products 낱말(words)로 초당옥수수 사진 자동(저장 image_id = 8)`, /품목 사진/.test(pzc) && F.writes.filter(w => w.p.endsWith('/event')).pop().body.event.prizes[0].image_id === 8, pzc + ' · ' + JSON.stringify(F.writes.filter(w => w.p.endsWith('/event')).pop().body.event.prizes[0]));
            await pg.click('[data-ev="pdel"][data-i="0"]'); await pg.waitForTimeout(200);
            // ③ 쓰이는 곳 한 줄
            await openCard(pg, 3);
            const wh = await pg.evaluate(() => [...document.querySelectorAll('.ev-slot')].map(s => s.dataset.slot + ':' + s.querySelector('.ev-slot-h b').textContent + ':' + ((s.querySelector('.ev-slot-where') || {}).textContent || '')));
            ok(`${tag}: ③ 그림 칸 3개 = 상단 · 발표 · 조회 결과 + 「쓰이는 곳」 한 줄(맨 위 · 발표 창 · 조회 결과 장)`, wh.length === 3 && /hero:상단 그림:.*맨 위/.test(wh[0]) && /winner:발표 그림:.*발표 창/.test(wh[1]) && /result:조회 결과 그림:.*조회한 결과 장/.test(wh[2]), JSON.stringify(wh));
            // ⑤ 상태 탭(폰 = ⑤ 카드 · PC = 오른쪽 판 하나)
            if (phone) await openCard(pg, 5);
            const tabs = await pg.evaluate(() => ({ n: document.querySelectorAll('#event-root [data-ev="view"]').length, v: [...document.querySelectorAll('#event-root [data-ev="view"]')].map(b => b.textContent).join(','), bars: document.querySelectorAll('#event-root .ev-pv-bar').length, frames: document.querySelectorAll('#event-root iframe#ev-frame').length, inSide: !!document.querySelector('.ev-side .ev-pv-bar') }));
            ok(`${tag}: ⑤ 상태 탭 10(docs/711 1절 순서) · 미리보기 판 하나(${phone ? '⑤ 카드' : '오른쪽 판'})`, tabs.n === 10 && tabs.v === '준비 중,접수 중,발표 뒤 첫 화면,접수 확인,당첨,미당첨,대상 아님,기간 밖,발표 창,끝남' && tabs.bars === 1 && tabs.frames === 1 && tabs.inSide === !phone, JSON.stringify(tabs));
            await pg.click('[data-ev="view"][data-v="closed"]'); const mc = await lastMsg();
            await pg.click('[data-ev="view"][data-v="preparing"]'); const mp = await lastMsg();
            await pg.click('[data-ev="view"][data-v="published"]'); const mpub = await lastMsg();
            await pg.click('[data-ev="view"][data-v="outside"]'); const mo = await lastMsg();
            ok(`${tag}: ⑤ 탭 누름 = 그 장으로(closed · preparing · 발표 뒤 첫 화면 = default + published · outside)`, mc.scene === 'closed' && mp.scene === 'preparing' && mpub.scene === 'default' && mpub.event.published === true && mo.scene === 'outside' && mo.event.published === false, JSON.stringify([mc.scene, mp.scene, mpub.scene, mpub.event && mpub.event.published, mo.scene]));
            await pg.click('[data-ev="view"][data-v="closed"]'); await pg.waitForTimeout(200); await openCard(pg, 1); await setVal(pg, 'title', '탭 고정 시험'); const pin = await lastMsg();
            ok(`${tag}: ① 탭을 손으로 고른 뒤 글 입력(제목) = 탭 그대로(closed · 60초)`, pin.scene === 'closed', pin.scene);
            // 자동 전환 — 조회 결과 그림 → 당첨 · 발표 그림 → 발표 뒤 · 대상 아님 글 → 대상 아님(그림은 손으로 고른 탭도 이김)
            await openCard(pg, 3); await upload(pg, '.ev-slot[data-slot="result"] [data-ev="upload"]'); const a1 = await lastMsg();
            await upload(pg, '.ev-slot[data-slot="winner"] [data-ev="upload"]'); const a2 = await lastMsg();
            await openCard(pg, 4); await setVal(pg, 'texts.noitem_products', '레몬·한라봉 등'); const a3 = await lastMsg();
            ok(`${tag}: 자동 전환 3 = 조회 결과 그림 → win · 발표 그림 → winners · 대상 아님 글 → noitem(탭 표시도 같이)`, a1.scene === 'win' && /asset\/\d+/.test(String(a1.event && a1.event.images.result)) && a2.scene === 'winners' && a3.scene === 'noitem' && await pg.evaluate(() => [...document.querySelectorAll('[data-ev="view"].on')].every(b => b.dataset.v === 'noitem')), JSON.stringify([a1.scene, a2.scene, a3.scene]));
            // ④ 문장 미리보기 · 봇 답 미리보기
            const sent = await pg.evaluate(() => document.getElementById('ev-noitem-pv').textContent);
            ok(`${tag}: ④ 대상 아님 문장 = 치는 대로(제외 품목 칩 + 입력값)`, sent === '주문은 확인되지만 키위, 청귤 상품은 이번 이벤트 응모 대상에서 제외돼요. 레몬·한라봉 등 다른 상품 주문은 자동 접수됩니다!', sent);
            const lab4 = await pg.evaluate(() => [...document.querySelectorAll('#ev-step-4 .ev-f-l, #ev-step-4 .ev-sub-h b')].map(x => x.textContent).join('|'));
            ok(`${tag}: ④ 라벨 = 사람 말(대상 아님 안내 · 쿠폰 안내(봇 답에만) · 알림톡 단추 페이지(/guide) 맨 위 카드 + 설명)`, /대상 아님 안내에 넣을 다른 상품 이름/.test(lab4) && /쿠폰 한 줄\(봇 답에만\)/.test(lab4) && /알림톡 단추 페이지\(\/guide\) 맨 위 카드/.test(lab4) && await pg.evaluate(() => /맛있게 드시는 법/.test(document.getElementById('ev-step-4').textContent)), lab4);
            await setVal(pg, 'coupon_text', '응모 고객께 다음 주문 쿠폰'); await pg.waitForTimeout(700);
            const bot = await pg.evaluate(() => ({ v: document.getElementById('ev-bot').value, drop: (document.getElementById('ev-gdrop-box') || {}).textContent || '', title: document.querySelector('[data-k="guide_card.title"]').value }));
            ok(`${tag}: ④ 봇 답·카드 = 서버 bot-preview 글(🎟 쿠폰 줄) · 쿠폰 줄은 「카드에 안 실려요」 · 디바운스(호출 ${F.bp}회)`, /🎟 응모 고객께 다음 주문 쿠폰/.test(bot.v) && /카드에 안 실려요/.test(bot.drop) && /쿠폰 응모 고객께/.test(bot.drop) && /^🎁 /.test(bot.title) && F.bp >= 1 && F.bp <= 6, JSON.stringify(bot).slice(0, 300));
            F.bp429 = true; await setVal(pg, 'coupon_text', '쿠폰 바뀜'); await pg.waitForTimeout(700);
            const b429 = await pg.evaluate(() => ({ note: !document.getElementById('ev-bot-note').hidden, v: document.getElementById('ev-bot').value }));
            F.bp429 = false; await setVal(pg, 'coupon_text', '응모 고객께 다음 주문 쿠폰'); await pg.waitForTimeout(700);
            const b200 = await pg.evaluate(() => document.getElementById('ev-bot-note').hidden);
            ok(`${tag}: ② bot-preview 429 = 「잠시 뒤 다시 보여 드려요」 한 줄 · 옛 글 유지 → 다음 성공에 안내 사라짐`, b429.note && /🎟 응모 고객께 다음 주문 쿠폰/.test(b429.v) && b200, JSON.stringify(b429).slice(0, 200));
            const rs = await pg.evaluate(() => { const n = document.querySelector('.ev-head [data-ev="new"]').getBoundingClientRect(), r = document.querySelector('.ev-head [data-ev="reset"]').getBoundingClientRect(); return { gap: Math.round(r.left - n.right), same: Math.abs(r.top - n.top) < 4, t: document.querySelector('.ev-head [data-ev="reset"]').textContent }; });
            await openCard(pg, 6); const r6 = await pg.evaluate(() => [...document.querySelectorAll('#ev-step-6 [data-ev="reset"]')].map(b => b.textContent).join());
            ok(`${tag}: ③ 초기화 이름 통일(머리띠·⑥ 「초기화」) · 머리띠는 [새 회차] 와 16px 이상`, rs.t === '초기화' && r6 === '초기화' && (!rs.same || rs.gap >= 16), JSON.stringify(rs) + ' ⑥ ' + r6);
            // 머리띠 [초기화] = ⑥ 과 같은 확인 창 · 취소면 변화 0
            const wr = () => F.writes.filter(w => !/bot-preview$/.test(w.p)).length; await pg.waitForTimeout(500); const r0 = wr();
            await pg.click('.ev-head [data-ev="reset"]'); await pg.waitForSelector('.ev-dlg');
            const dl = await pg.evaluate(() => document.querySelector('.ev-dlg').textContent);
            await pg.click('.ev-dlg [data-x="0"]'); await pg.waitForTimeout(300);
            ok(`${tag}: 머리띠 [초기화] = 확인 창(주문·당첨 기록 · 되돌릴 수 없어요) → 취소 = 서버 호출 0`, /초기화할까요/.test(dl) && /되돌릴 수 없어요/.test(dl) && wr() === r0 && !(await pg.$('.ev-dlg')), dl.slice(0, 120));
            const sm = phone ? await small44(pg) : [];
            if (phone) ok(`${tag}: 44px(칩 × · 목록 단추 · 탭 · 초기화 포함)`, sm.length === 0, sm.slice(0, 10).join(', '));
            ok(`${tag}: 가로 넘침 0 · 오류 0`, !(await overflow(pg)) && !X.st.errors.length && !X.st.console.length, X.st.errors.concat(X.st.console).slice(0, 3).join(' | '));
            if (SHOT) await pg.screenshot({ path: path.join(SHOT, `711-${label}.png`), fullPage: true });
            await X.ctx.close();
        }
        { const X = await open({ width: 1280, height: 900 }, { noRound: true }); await goEvent(X.pg, false);
          ok('#711 회차 없음 = 머리띠 [초기화] 없음', !(await X.pg.$('#event-root [data-ev="reset"]')));
          await X.pg.click('[data-ev="new"]'); await X.pg.waitForSelector('.ev-dlg'); await X.pg.click('.ev-dlg [data-x="1"]'); await X.pg.waitForTimeout(1200);
          const np = await X.pg.evaluate(() => document.querySelectorAll('#ev-xp-pick [data-ev="pick"]').length);
          ok('#711 회차 없음 → [새 회차] 직후 ① 품목 목록이 바로 뜸(실왕복에서 찾은 빈 목록 결함)', np === 4, np); await X.ctx.close(); }
        if (process.env.V708_ONLY === '711') throw { done: true };
        for (const [label, vw, phone] of [['390', { width: 390, height: 844 }, true], ['900', { width: 900, height: 1000 }, true], ['1440', { width: 1440, height: 1000 }, false]]) {
            const X = await open(vw, { phone }); const { pg, F } = X; const tag = label + ' 밝음';
            await goEvent(pg, phone);
            ok(`${tag}: 메뉴 「이벤트 관리」 = 회사프로그램 안 페이지(#page-event 활성 · 새 탭 아님)`, await pg.evaluate(() => document.getElementById('page-event').classList.contains('active') && !document.querySelector('.nav-item[href*="lucky-admin"]')), '');
            const h0 = await head(pg), c0 = await cards(pg);
            const want0 = label === '1440' ? ['001110', '3/6'] : ['001100', '2/6'];   // 펼침은 오른쪽 미리보기가 바로 그려져 ⑤ 완료
            ok(`${tag}: 새 회차 = 준비 중 · 카드 완료 ③④${label === '1440' ? '⑤' : ''}만(${want0[0]}) · 준비 ${want0[1]}`, h0.pill.trim() === '준비 중' && c0 === want0[0] && h0.ready === want0[1], JSON.stringify(h0) + ' ' + c0);
            const lay = await pg.evaluate(() => { const s = document.querySelector('.ev-side'); return { side: !!s, sticky: s ? getComputedStyle(s).position : '', frame: !!document.querySelector('.ev-side iframe#ev-frame') }; });
            ok(`${tag}: ${label === '1440' ? '펼침 = 왼쪽 카드 + 오른쪽 미리보기 고정(sticky)' : '폰 = 한 줄(오른쪽 미리보기 없음)'}`, label === '1440' ? lay.side && lay.sticky === 'sticky' && lay.frame : !lay.side, JSON.stringify(lay));
            await openCard(pg, 6);
            const lock0 = await pg.evaluate(() => { const b = document.querySelector('[data-ev="live"]'); return { dis: b && b.disabled, msg: (document.getElementById('ev-lockmsg') || {}).textContent || '' }; });
            ok(`${tag}: 열기 단추 잠김 + 채울 것 이름 표시`, lock0.dis === true && /기간·제목/.test(lock0.msg) && /경품/.test(lock0.msg), JSON.stringify(lock0));
            // ① 채우기
            await setVal(pg, 'title', '가을 감사 이벤트'); await setVal(pg, 'start', '2026-10-20'); await setVal(pg, 'end', '2026-10-31'); await setVal(pg, 'announce', '2026-11-01');
            const pu = await pg.evaluate(() => document.querySelector('[data-k="page_until"]').value);
            ok(`${tag}: 발표일 고르면 내리는 날 = 발표일 + 3일 자동`, pu === '2026-11-04', pu);
            ok(`${tag}: ① 완료로 바뀜 · 카드 다시 그리지 않고 상태만(입력 칸 유지)`, (await cards(pg))[0] === '1', await cards(pg));
            // ② 경품: 황금향 = 품목 사진 자동 · 사과 = 그림 없음 → 올리기
            await openCard(pg, 2);
            await pg.click('[data-ev="padd"]'); await setVal(pg, 'prizes.0.name', '황금향 5kg 선물용'); await setVal(pg, 'prizes.0.count', '5');
            await pg.click('[data-ev="padd"]'); await setVal(pg, 'prizes.1.name', '사과 3kg'); await setVal(pg, 'prizes.1.count', '7');
            const c2a = await cards(pg); await pg.click('[data-ev="save"]'); await pg.waitForTimeout(600);
            const pz = await pg.evaluate(() => [...document.querySelectorAll('.ev-prize')].map(p => (p.querySelector('.ev-prize-img img') ? 'img:' : 'none:') + (p.querySelector('.ev-prize-img > span') || {}).textContent));
            ok(`${tag}: 경품 이름에 품목이 있으면 품목 사진 자동 · 없으면 「그림 없음」 → ② 미완`, c2a[1] === '0' && /품목 사진/.test(pz[0]) && /^none/.test(pz[1]), JSON.stringify(pz) + ' ' + c2a);
            const sv = F.writes.filter(w => w.p.endsWith('/event')).pop();
            ok(`${tag}: 저장 본문 = 칸 이름 docs/708-api.md 그대로(prizes[].image_id · live_mode 안 보냄)`, sv && sv.body.event.prizes[0].image_id === 7 && sv.body.event.prizes[1].image_id === null && !('live_mode' in sv.body.event) && !('state' in sv.body.event) && sv.body.event.page_until === '2026-11-04', JSON.stringify(sv && sv.body.event.prizes));
            await upload(pg, '.ev-prize[data-i="1"] [data-ev="upload"]');
            const up = F.writes.filter(w => w.p.endsWith('/assets')).pop();
            ok(`${tag}: 그림 올리기 = 브라우저가 줄여 webp 로 POST /assets(slot prize · 480 폭 이하)`, up && up.body.slot === 'prize' && up.body.mime === 'image/webp' && up.body.width <= 480 && up.body.data.length > 100, up && JSON.stringify({ slot: up.body.slot, mime: up.body.mime, w: up.body.width, h: up.body.height, label: up.body.label }));
            ok(`${tag}: 올린 뒤 ② 완료 · 저장 안 한 변경 표시`, (await cards(pg))[1] === '1' && await pg.evaluate(() => /저장 안 한/.test(document.querySelector('.ev-dirty').textContent)), await cards(pg));
            // ③ 배너 올리기 → 미리보기 메시지
            await openCard(pg, 3); await upload(pg, '.ev-slot[data-slot="hero"] [data-ev="upload"]');
            const upH = F.writes.filter(w => w.p.endsWith('/assets')).pop();
            ok(`${tag}: 배너 올리기 = 1200 폭 이하 webp`, upH.body.slot === 'hero' && upH.body.width <= 1200, JSON.stringify({ w: upH.body.width, h: upH.body.height }));
            // 미리보기 열기(폰 = ⑤ 카드 안)
            if (label !== '1440') { await openCard(pg, 5); await pg.waitForTimeout(1200); }
            await pg.waitForTimeout(800);
            const fr = pg.frames().find(f => /lucky\.html/.test(f.url()));
            const msgs = fr ? await fr.evaluate(() => window.__msgs) : [];
            const last = msgs[msgs.length - 1] || {};
            ok(`${tag}: 미리보기 iframe 에 초안 postMessage(lucky:preview) · 배너·경품 그림 주소 · 저장 전 값`, last.type === 'lucky:preview' && /\/api\/lucky\/asset\/\d+/.test(String(last.event && last.event.images && last.event.images.hero)) && last.event.prizes.length === 2 && /asset\/\d+/.test(last.event.prizes[1].image || '') && last.event.display_title === '가을 감사 이벤트', JSON.stringify({ n: msgs.length, hero: last.event && last.event.images.hero, p1: last.event && last.event.prizes[1].image }));
            await pg.waitForTimeout(400);
            ok(`${tag}: 미리보기가 그려지면(lucky:rendered) ⑤ 완료`, (await cards(pg))[4] === '1', await cards(pg));
            // 상태 보기 단추
            if (label === '1440') await openCard(pg, 5);
            await pg.click('[data-ev="view"][data-v="winners"]'); await pg.waitForTimeout(600);
            const m2 = (await (pg.frames().find(f => /lucky\.html/.test(f.url()))).evaluate(() => window.__msgs)).pop();
            ok(`${tag}: 「발표 창」 단추 = scene winners · state published`, m2.scene === 'winners' && m2.event.state === 'published', JSON.stringify({ scene: m2.scene, state: m2.event.state }));
            // 44px · 넘침 · 그림
            const sm = phone ? await small44(pg) : [];
            if (phone) ok(`${tag}: 누르는 것 전부 44px 이상(펼친 카드 기준)`, sm.length === 0, sm.slice(0, 10).join(', '));
            ok(`${tag}: 가로 넘침 0`, !(await overflow(pg)));
            if (SHOT) await pg.screenshot({ path: path.join(SHOT, `708-${label}-채움.png`), fullPage: true });
            // ⑥ 열기
            await openCard(pg, 6);
            const lock1 = await pg.evaluate(() => document.querySelector('[data-ev="live"]').disabled);
            ok(`${tag}: ①② 채우고 그림 올리자 열기 단추 풀림`, lock1 === false);
            await pg.click('[data-ev="live"]'); await pg.waitForSelector('.ev-dlg', { timeout: 3000 });
            const dlg = await pg.evaluate(() => ({ t: document.querySelector('.ev-dlg h3').textContent, focus: document.activeElement && document.activeElement.textContent }));
            ok(`${tag}: 열기 = 확인 창 1번(화면 안 창 · 확인 단추에 초점)`, /열까요/.test(dlg.t) && /열기/.test(dlg.focus), JSON.stringify(dlg));
            await pg.click('.ev-dlg [data-x="1"]'); await pg.waitForTimeout(900);
            const gl = F.writes.filter(w => w.p.endsWith('/go-live')).pop(), evSaves = F.writes.filter(w => w.p.endsWith('/event')).length;
            const h1 = await head(pg);
            ok(`${tag}: 열기 → 저장 안 한 변경 먼저 저장 → go-live {mode:live} → 「진행 중」 · 6/6`, gl && gl.body.mode === 'live' && evSaves >= 2 && h1.pill.trim() === '진행 중' && h1.ready === '6/6', JSON.stringify(h1) + ' 저장 ' + evSaves);
            const where = await pg.evaluate(() => [...document.querySelectorAll('.ev-where li')].map(l => l.textContent.replace(/\s+/g, ' ').trim()));
            ok(`${tag}: 「어디에 보이는지」 3줄 = 손님 페이지·/guide 카드·봇 답 보임`, where.length === 3 && where.every(w => /^보임/.test(w)), where.join(' | '));
            // AI 맡기기 → 후보 → 쓰기
            await openCard(pg, 3);
            await pg.click('.ev-slot[data-slot="winner"] [data-ev="art"]'); await pg.waitForSelector('.ev-art');
            await pg.fill('.ev-art [name="ask"]', '가을 느낌'); await pg.click('.ev-art [type="submit"]'); await pg.waitForTimeout(1500);
            const ord = F.writes.find(w => w.p === '/api/agent-office/orders');
            ok(`${tag}: AI 맡기기 = 지시 1건 · 머리말 [이벤트그림] 회차 #41 · 자리 발표 · 크기 900x471 · 둘째 줄 꼴`, ord && /^\[이벤트그림\] 회차 #41 · 자리 발표 · 품목 .+ · 자세 기쁨 · 크기 900x471 · 요청: 가을 느낌\n후보 2~3장을 첨부로 답해 주세요/.test(ord.body.content), ord && ord.body.content);
            const pend = F.writes.filter(w => w.p.endsWith('/event')).pop().body.event.pending_art;
            ok(`${tag}: 맡긴 지시를 event.pending_art 에 적어 저장`, Array.isArray(pend) && pend.some(p => p.order_id === 9001 && p.slot === 'winner'), JSON.stringify(pend));
            await pg.waitForSelector('.ev-cand-it img[data-fid="555"]', { timeout: 6000 }).catch(() => { });
            const cand = await pg.evaluate(() => ({ n: document.querySelectorAll('.ev-cand-it').length, loaded: [...document.querySelectorAll('.ev-cand-it img')].every(i => i.complete && i.naturalWidth > 0) }));
            ok(`${tag}: 후보 띠 = result.files 중 그림만(file_id 555 · txt 제외) · 그림 보임`, cand.n === 1 && cand.loaded, JSON.stringify(cand));
            const aBefore = F.writes.filter(w => w.p.endsWith('/assets')).length;
            await pg.click('[data-ev="usecand"]'); await pg.waitForTimeout(1500);
            const upC = F.writes.filter(w => w.p.endsWith('/assets')).pop();
            ok(`${tag}: [이 그림 쓰기] → 줄여서 POST /assets(slot winner) → 발표 그림 자리에 들어감`, F.writes.filter(w => w.p.endsWith('/assets')).length === aBefore + 1 && upC.body.slot === 'winner' && upC.body.width <= 900 && await pg.evaluate(() => !!document.querySelector('.ev-slot[data-slot="winner"] .ev-slot-img img')), JSON.stringify({ slot: upC.body.slot, w: upC.body.width }));
            // 내리기 확인 창 · 취소하면 아무 일 없음
            await openCard(pg, 6); const gl0 = F.writes.filter(w => w.p.endsWith('/go-live')).length;
            await pg.click('[data-ev="down"]'); await pg.waitForSelector('.ev-dlg'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
            ok(`${tag}: 내리기 확인 창 Esc = 취소(서버 호출 0)`, F.writes.filter(w => w.p.endsWith('/go-live')).length === gl0 && !(await pg.$('.ev-dlg')));
            // 새 회차 확인 창(저장 안 한 변경 있으면 두 번 · 없으면 한 번) → new-round confirm NEW
            await pg.click('[data-ev="save"]').catch(() => { }); await pg.waitForTimeout(500);
            await pg.click('[data-ev="new"]'); await pg.waitForSelector('.ev-dlg'); await pg.click('.ev-dlg [data-x="1"]'); await pg.waitForTimeout(600);
            const nr = F.writes.filter(w => w.p.endsWith('/new-round')).pop();
            ok(`${tag}: 새 회차 = 확인 창 1번 뒤 confirm 'NEW' 를 대신 보냄`, nr && nr.body.confirm === 'NEW');
            ok(`${tag}: 화면 오류 0 · 콘솔 오류 0 · 브라우저 기본 창 0`, X.st.errors.length === 0 && X.st.console.length === 0, X.st.errors.concat(X.st.console).slice(0, 3).join(' | '));
            await X.ctx.close();
        }
        // 서버가 NOT_READY 로 막을 때 · 알림 링크
        {
            const X = await open({ width: 900, height: 1000 }, { phone: true }); await goEvent(X.pg, true);
            await X.pg.evaluate(() => notiGo('event?step=3')); await X.pg.waitForTimeout(800);
            const s3 = await X.pg.evaluate(() => { const c = document.querySelector('.ev-card[data-step="3"]'); return c && c.classList.contains('open') && c.getBoundingClientRect().top < 200; });
            ok('알림 링크 event?step=3 → 이벤트 관리 ③ 카드 펼쳐 보임', s3);
            await X.ctx.close();
        }
        // 야간
        for (const [label, vw] of [['390', { width: 390, height: 844 }], ['900', { width: 900, height: 1000 }]]) {
            const X = await open(vw, { phone: true, theme: 'dark' }); await goEvent(X.pg, true);
            for (const k of [1, 2, 3, 4, 6]) await openCard(X.pg, k);
            await X.pg.click('[data-ev="padd"]'); await X.pg.waitForTimeout(300);
            const th = await X.pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme'));
            const a = await X.pg.evaluate(AUDIT, '#event-root');
            ok(`야간 ${label}: 이벤트 관리에도 야간 켜짐(DARK_PAGES) · 글자 대비 4.5:1 미달 0 · 흰 칸 0 (측정 ${a.n}곳 · 최저 ${a.min})`, th === 'dark' && a.n > 40 && a.bad.length === 0 && a.white.length === 0, (a.bad.slice(0, 6).join(' ‖ ') || '') + (a.white.length ? ' ‖ 흰 칸 ' + [...new Set(a.white)].slice(0, 5).join(',') : '') + ' · theme ' + th);
            if (SHOT) await X.pg.screenshot({ path: path.join(SHOT, `708-${label}-야간.png`), fullPage: true });
            ok(`야간 ${label}: 오류 0`, X.st.errors.length === 0, X.st.errors.slice(0, 2).join(' | '));
            await X.ctx.close();
        }
        { const X = await open({ width: 1280, height: 900 }); await goEvent(X.pg, false); for (const k of [1, 2, 3, 4, 6]) await openCard(X.pg, k); await X.pg.click('[data-ev="padd"]'); const a = await X.pg.evaluate(AUDIT, '#event-root');
          ok(`밝음 1280: 글자 대비 미달 0 (측정 ${a.n}곳 · 최저 ${a.min})`, a.bad.length === 0, a.bad.slice(0, 6).join(' ‖ ')); await X.ctx.close(); }
        // 다른 메뉴 스모크(실서버 읽기 · 이벤트 API 만 가짜)
        {
            const X = await open({ width: 1280, height: 900 });
            const pages = await X.pg.evaluate(() => [...document.querySelectorAll('.nav-item[data-page]')].map(a => a.dataset.page).filter(p => p !== 'event'));
            const bad = [];
            for (const p of pages) {
                await X.pg.evaluate(p => document.querySelector(`.nav-item[data-page="${p}"]`).click(), p); await X.pg.waitForTimeout(1300);
                const r = await X.pg.evaluate(p => { const el = document.getElementById('page-' + p); return { active: !!(el && el.classList.contains('active')), h: el ? el.getBoundingClientRect().height : 0 }; }, p);
                if (!r.active || r.h < 50) bad.push(p + JSON.stringify(r));
            }
            ok(`다른 메뉴 ${pages.length}개 스모크: 전부 열림 · 화면 오류 0`, pages.length >= 14 && !bad.length && X.st.errors.length === 0, (bad.join(', ') || '') + ' ' + X.st.errors.slice(0, 2).join(' | ') + ' · ' + pages.join(','));
            await X.ctx.close();
        }
    } catch (e) { if (e && e.done) { } else ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 6).join(' / ') : String(e)); }
    finally {
        try { if (browser) await browser.close(); } catch (_) { } if (srv) srv.kill();
        const pass = results.filter(Boolean).length; console.log(`\n결과: ${pass}/${results.length}`); setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
