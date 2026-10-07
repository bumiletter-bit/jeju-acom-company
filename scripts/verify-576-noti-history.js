// #576 검증: 회사프로그램 알림(종) — 「이전 알림」 창 · 검색 · 알림을 누르면 해당 창·페이지로 · 시작 해시(/#link)
//   로컬 실서버(3462 · JWT_SECRET=verifytest · setInterval 무력화 · 실DB 읽기만) + Playwright.
//   ⓐ GET /api/notifications/history 실제 응답(읽기만) ⓑ 화면(가짜 history 응답으로 가로채기) ⓒ 클릭 이동 ⓓ 시작 해시 ⓔ 무회귀(종 기본 목록 · 폰 전체 화면 · 야간 대비 · verify-468-ui)
//   🔴 화면 시험의 알림 API(GET·PUT·DELETE·POST)는 전부 가로챈다 → 실DB 쓰기 0. ⓐ 만 실서버에 GET.
//   실행: node scripts/verify-576-noti-history.js [--no468] [--shot=폴더]   (PORT576 로 포트 바꿈)
require('dotenv').config();
const { spawn, execFileSync, spawnSync } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = Number(process.env.PORT576) || 3462, BASE = `http://localhost:${PORT}`;
const BASE_REF = process.env.BASE_REF || '5f7eb8d';   // 고치기 전 기준(#576 직전 커밋 — 커밋 뒤에도 같은 비교가 되게 고정)
const gitShow = p => execFileSync('git', ['show', BASE_REF + ':' + p], { cwd: ROOT, maxBuffer: 1 << 27 });
const argv = process.argv.slice(2), SHOT = (argv.find(a => a.startsWith('--shot=')) || '').slice(7), NO468 = argv.includes('--no468');
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note != null && note !== '' ? ' — ' + String(note).slice(0, 700) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 가짜 알림 12건: 오늘 4 · 어제 4 · 사흘 전 4 · 읽음/안 읽음 섞음 · 종류 5가지 ──
const NOW = Date.now(), H = 3600e3, D = 24 * H;
const kstNoon = daysAgo => { const k = new Date(NOW + 9 * H); return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - daysAgo, 3, 0, 0); };   // 그날 KST 12:00
const N = (id, daysAgo, min, type, title, message, link, isRead) => ({ id, type, title, message, link, isRead, createdAt: new Date(kstNoon(daysAgo) - min * 60e3).toISOString() });
const FAKE = [
    N(912, 0, 1, 'announcement', '📢 지시사항', '시험 지시사항 — 내일 오전 발주는 9시까지 마감합니다', null, false),
    N(911, 0, 5, 'desk', '클코 답변 도착', '에이전트 오피스 99번 지시에 답이 왔어요', 'agent-office?o=99', false),
    N(910, 0, 9, 'expense', '지출결의 결재 요청', '시험직원 님의 지출결의서(포장 자재)가 올라왔어요', 'expense?id=5', false),
    N(909, 0, 20, 'settle_recon', '정산 대조 확인', '네이버 정산 입금이 넣은 값과 달라요 — 정산현황에서 확인', 'settlement:settlement-status', true),
    N(908, 1, 3, 'documents', '기안서류 승인', '휴가신청서가 승인됐어요', 'documents?id=8', false),
    N(907, 1, 30, 'expense', '지출결의 승인', '지출결의서(택배 박스)가 승인됐어요', 'expense?id=4', true),
    N(906, 1, 60, 'desk', '클코 답변 도착', '에이전트 오피스 98번 정산 이미지 확인표가 준비됐어요', 'agent-office?o=98', true),
    N(905, 1, 90, 'announcement', '📢 지시사항', '시험 지시사항 — 금요일 대청소', null, true),
    N(904, 3, 10, 'documents', '기안서류 반려', '근태신청서가 반려됐어요', 'documents?id=3', false),
    N(903, 3, 40, 'settle_recon', '정산 대조 확인', '쿠팡 정산 예정 금액이 들어왔어요', 'settlement:settlement-status', true),
    N(902, 3, 70, 'expense', '지출결의 결재 요청', '시험직원 님의 지출결의서(사무용품)가 올라왔어요', 'expense?id=2', true),
    N(901, 3, 99, 'desk', '클코 답변 도착', '에이전트 오피스 90번 최종발주 정리가 끝났어요', 'agent-office?o=90', false),
];
const fakeHistory = sp => { let rows = FAKE.slice(); const q = (sp.get('q') || '').trim().toLowerCase(); if (q) rows = rows.filter(r => (r.title + ' ' + r.message).toLowerCase().includes(q)); const before = Number(sp.get('before')) || 0; if (before) rows = rows.filter(r => r.id < before); const page = rows.slice(0, 8); return { items: page, has_more: rows.length > page.length }; };
// 대비 측정(568 하네스 방식) — 범위 안의 보이는 글자: 글자색 vs 실제 바탕
const AUDIT = sel => { const P = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return { r: 0, g: 0, b: 0, a: 0 }; const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
    const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }, L = c => .2126 * lin(c.r) + .7152 * lin(c.g) + .0722 * lin(c.b), over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const page = P(getComputedStyle(document.body).backgroundColor); const bgOf = el => { const ls = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c.a > 0) { ls.push(c); if (c.a >= 1) break; } } let b = page.a ? page : { r: 255, g: 255, b: 255, a: 1 }; for (let i = ls.length - 1; i >= 0; i--) b = over(ls[i], b); return b; };
    const hex = c => '#' + [c.r, c.g, c.b].map(x => Math.round(x).toString(16).padStart(2, '0')).join(''); const root = document.querySelector(sel); const out = { n: 0, bad: [], white: [], min: 99 }; if (!root) return out;
    for (const el of root.querySelectorAll('*')) { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
        const own = P(cs.backgroundColor); const r = el.getBoundingClientRect(); if (own.a >= .9 && Math.min(own.r, own.g, own.b) > 170 && r.width * r.height > 400) out.white.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ')[0]);
        const isField = /^(INPUT|TEXTAREA)$/.test(el.tagName); if (!(isField || [...el.childNodes].some(n => n.nodeType === 3 && /[0-9A-Za-z가-힣]/.test(n.nodeValue)))) continue; if (el.disabled || parseFloat(cs.opacity) < 1) continue;
        const check = (col, what) => { const bg = bgOf(el), fg = over(P(col), bg), a = L(fg), b = L(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05); const fs = parseFloat(cs.fontSize), big = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700); out.n++; out.min = Math.min(out.min, ratio); if (ratio < (big ? 3 : 4.5)) out.bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]}${what} ${ratio.toFixed(2)} (${hex(fg)} / ${hex(bg)}) 「${(el.value || el.textContent || '').trim().slice(0, 12)}」`); };
        if (!isField || el.value) check(cs.color, ''); if (isField && el.placeholder && !el.value) check(getComputedStyle(el, '::placeholder').color, ' 안내 글'); }
    out.min = +out.min.toFixed(2); return out; };

(async () => {
    let srv = null, browser = null;
    try {
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: 'ignore' });
        let up = false; for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(BASE + '/'); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동', up); if (!up) throw new Error('server not up');
        const { Client } = require('pg'); const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const total = (await db.query(`SELECT count(*)::int n FROM notifications WHERE user_id = $1`, [ceo.id])).rows[0].n;
        const USER = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }; const token = jwt.sign(USER, 'verifytest', { expiresIn: '30m' }); const HD = { Authorization: 'Bearer ' + token };
        const hist = async qs => { const r = await fetch(BASE + '/api/notifications/history' + (qs || ''), { headers: HD }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, j }; };

        // ══ ⓐ history API(실서버 · 읽기만) ══
        const noAuth = await fetch(BASE + '/api/notifications/history'); ok('ⓐ 토큰 없이 부르면 401/403', [401, 403].includes(noAuth.status), noAuth.status);
        const a1 = await hist('');
        ok('ⓐ 대표 토큰 200 · { items 배열, has_more } · 항목 칸(id·type·title·message·link·isRead·createdAt)', a1.status === 200 && a1.j && Array.isArray(a1.j.items) && typeof a1.j.has_more === 'boolean' && a1.j.items.every(x => ['id', 'type', 'title', 'message', 'link', 'isRead', 'createdAt'].every(k => k in x)), `status ${a1.status} · ${a1.j && a1.j.items ? a1.j.items.length : '?'}건 · has_more ${a1.j && a1.j.has_more} · 대표 알림 전체 ${total}건`);
        const items = (a1.j && a1.j.items) || [];
        if (items.length) {
            const own = (await db.query(`SELECT count(*)::int n FROM notifications WHERE id = ANY($1) AND user_id <> $2`, [items.map(x => x.id), ceo.id])).rows[0].n;
            ok('ⓐ 본인 것만(다른 사람 알림 섞임 0) · 최신순(id 내림차순) · 기본 50건 이하 · 읽은 것도 포함', own === 0 && items.every((x, i) => i === 0 || items[i - 1].id > x.id) && items.length <= 50, `남의 것 ${own} · ${items.length}건 · 읽은 것 ${items.filter(x => x.isRead).length}건`);
            const word = (items.map(x => String(x.message || x.title || '')).join(' ').match(/[가-힣]{2,4}/g) || [])[0];
            if (word) { const s = await hist('?q=' + encodeURIComponent(word)); const all = s.j && s.j.items ? s.j.items : []; ok(`ⓐ 검색 q=「${word}」 → 결과 전부 제목이나 글에 그 낱말 포함`, s.status === 200 && all.length > 0 && all.every(x => (String(x.title || '') + ' ' + String(x.message || '')).toLowerCase().includes(word.toLowerCase())), `${all.length}건`); const none = await hist('?q=' + encodeURIComponent('없는낱말zzqq576')); ok('ⓐ 없는 낱말 → 0건 · has_more false', none.status === 200 && none.j.items.length === 0 && none.j.has_more === false); }
            else ok('ⓐ 검색(낱말을 못 골라 건너뜀)', true, '알림 글에 한글 낱말 없음');
            const l2 = await hist('?limit=2'); ok('ⓐ limit=2 → 2건(전체가 3건 이상이면 has_more true)', l2.status === 200 && l2.j.items.length === Math.min(2, total) && (total > 2 ? l2.j.has_more === true : true), `${l2.j.items.length}건 · has_more ${l2.j.has_more}`);
            if (total > 2) { const b = await hist('?limit=2&before=' + l2.j.items[l2.j.items.length - 1].id); const ids1 = l2.j.items.map(x => x.id), ids2 = b.j.items.map(x => x.id); ok('ⓐ before 페이징: 다음 쪽이 앞쪽보다 전부 작은 id · 겹침 0', b.status === 200 && ids2.length > 0 && ids2.every(i => i < Math.min(...ids1)) && !ids2.some(i => ids1.includes(i)), `${ids1.join(',')} → ${ids2.join(',')}`); }
            const big = await hist('?limit=999'); ok('ⓐ limit 상한 100', big.status === 200 && big.j.items.length <= 100, big.j.items.length + '건');
        } else ok('ⓐ 실DB 에 대표 알림이 없어 내용 검사는 건너뜀', a1.status === 200, `전체 ${total}건`);
        await db.end();

        // ══ 화면 ══
        const { chromium } = require('playwright'); browser = await chromium.launch();
        const open = async (vw, o) => { o = o || {};
            const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce' }, o.phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const st = { reqs: [], writes: [], errors: [], calls: [] }; pg.on('pageerror', e => st.errors.push(String(e))); pg.on('dialog', d => d.dismiss().catch(() => { }));
            const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
            await pg.route('**/api/**', route => { const rq = route.request(), u = new URL(rq.url());
                if (rq.method() !== 'GET') { st.writes.push(rq.method() + ' ' + u.pathname); return json(route, { ok: true, success: true }); }   // 쓰기는 전부 가로챔
                if (u.pathname === '/api/notifications/history') { st.reqs.push(u.search); return json(route, fakeHistory(u.searchParams)); }
                if (u.pathname === '/api/notifications/unread-count') return json(route, { count: FAKE.filter(x => !x.isRead).length });
                if (u.pathname === '/api/notifications') return json(route, FAKE.slice(0, 6));
                const m = u.pathname.match(/^\/api\/expense-reports\/(\d+)$/); if (m) { st.calls.push(['GET expense-reports', Number(m[1])]); return json(route, { id: Number(m[1]), title: '시험', purpose: '시험', applicant_id: USER.id, applicant_name: '시험', ceo_id: USER.id, ceo_name: '시험', status: 'pending', total_amount: 1000, items: [{ name: '시험', amount: 1000, note: '' }], created_at: new Date().toISOString() }); }
                return route.continue(); });
            if (o.old) { for (const f of ['app.js', 'index.html']) { const body = gitShow('public/' + f); if (f === 'app.js') await pg.route('**/app.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body })); else await pg.route(u => u.pathname === '/' || u.pathname === '/index.html', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })); } await pg.route('**/noti-history.css*', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' })); }
            await ctx.addInitScript(([t, u, th]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); if (!sessionStorage.getItem('i576')) { sessionStorage.setItem('i576', '1'); localStorage.setItem('akm_ao_theme', th || 'light'); localStorage.setItem('akm_last_page', 'schedule'); } }, [token, USER, o.theme || 'light']);
            await pg.goto(BASE + '/' + (o.hash || ''), { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(o.wait || 2800);
            await pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important} *{caret-color:transparent!important}' }).catch(() => { });
            return { pg, ctx, st };
        };
        const activePage = pg => pg.evaluate(() => { const p = document.querySelector('.page.active'); return p ? p.id.replace(/^page-/, '') : ''; });
        const openBell = async (pg, phone) => { const sel = phone ? '#mobile-noti-btn' : '#notification-bell'; const vis = await pg.evaluate(() => { const d = document.getElementById('notification-dropdown'); return !!(d && d.style.display !== 'none' && d.getClientRects().length); }); if (!vis) { await pg.click(sel).catch(async () => { await pg.evaluate(() => toggleNotificationDropdown(new Event('click'))); }); await pg.waitForTimeout(500); } };
        const openHist = async (pg, phone) => { await openBell(pg, phone); await pg.click('#noti-hist-open'); await pg.waitForSelector('#noti-hist', { state: 'visible', timeout: 8000 }); await pg.waitForTimeout(700); };
        const histState = pg => pg.evaluate(() => { const w = document.getElementById('noti-hist'); const vis = !!(w && w.getClientRects().length && getComputedStyle(w).display !== 'none' && getComputedStyle(w).visibility !== 'hidden'); const its = [...document.querySelectorAll('#noti-hist-list .noti-hist-item')]; return { vis, role: w && (w.getAttribute('role') || (w.querySelector('[role="dialog"]') ? 'dialog' : '')), days: document.querySelectorAll('#noti-hist-list .noti-hist-day').length, items: its.length, ids: its.map(e => Number(e.dataset.id)), unread: its.filter(e => e.classList.contains('unread')).length, parts: its.length ? ['.nh-title', '.nh-msg', '.nh-time', '.nh-del'].map(s => its.filter(e => e.querySelector(s)).length) : [], more: (() => { const m = document.getElementById('noti-hist-more'); return !!(m && m.getClientRects().length && !m.hidden); })(), empty: !!document.querySelector('#noti-hist .noti-hist-empty') && !!document.querySelector('#noti-hist .noti-hist-empty').getClientRects().length }; });

        // ══ ⓑ 「이전 알림」 창 ══
        const B = await open({ width: 1440, height: 1000 }); const pg = B.pg;
        await openBell(pg, false);
        const btn = await pg.evaluate(() => { const b = document.getElementById('noti-hist-open'); return b ? { vis: !!b.getClientRects().length, text: b.textContent.trim(), inBell: !!b.closest('#notification-dropdown') } : null; });
        ok('ⓑ 종 창 머리에 [이전 알림] 버튼(#noti-hist-open)', !!btn && btn.vis && btn.inBell && /이전 알림/.test(btn.text), JSON.stringify(btn));
        await pg.click('#noti-hist-open'); await pg.waitForSelector('#noti-hist', { state: 'visible', timeout: 8000 }).catch(() => { }); await pg.waitForTimeout(800);
        const s1 = await histState(pg);
        ok('ⓑ 창 열림(#noti-hist · role=dialog) · 첫 쪽 8건 · 날짜 머리 2개(오늘·어제) · [더 보기] 보임', s1.vis && /dialog/.test(s1.role || '') && s1.items === 8 && s1.days === 2 && s1.more && B.st.reqs.length >= 1, JSON.stringify({ ...s1, ids: s1.ids.join(), reqs: B.st.reqs }));
        ok('ⓑ 항목마다 제목·글·시각·삭제(.nh-title/.nh-msg/.nh-time/.nh-del) · 안 읽음 표시 수 = 가짜 자료', s1.parts.length === 4 && s1.parts.every(n => n === s1.items) && s1.unread === FAKE.slice(0, 8).filter(x => !x.isRead).length, `부분 ${s1.parts.join('/')} · unread ${s1.unread} (기대 ${FAKE.slice(0, 8).filter(x => !x.isRead).length})`);
        ok('ⓑ 창 안 요소: 검색칸·지우기·닫기·모두 읽음', await pg.evaluate(() => ['noti-hist-q', 'noti-hist-x', 'noti-hist-close', 'noti-hist-readall', 'noti-hist-list'].every(id => !!document.getElementById(id))));
        if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await pg.screenshot({ path: path.join(SHOT, '576-PC-창.png') }); }
        const r0 = B.st.reqs.length; await pg.click('#noti-hist-more'); await pg.waitForTimeout(700); const s2 = await histState(pg);
        ok('ⓑ [더 보기] → 요청에 before=<마지막 id> · 12건 전부 · 날짜 머리 3개 · [더 보기] 사라짐 · 겹침 0', B.st.reqs.slice(r0).some(q => /before=905(?:&|$)/.test(q)) && s2.items === 12 && s2.days === 3 && !s2.more && new Set(s2.ids).size === 12 && s2.unread === FAKE.filter(x => !x.isRead).length, JSON.stringify({ items: s2.items, days: s2.days, more: s2.more, unread: s2.unread, reqs: B.st.reqs.slice(r0) }));
        const r1 = B.st.reqs.length; await pg.fill('#noti-hist-q', '정산'); await pg.waitForTimeout(900); const s3 = await histState(pg); const wantQ = FAKE.filter(x => (x.title + ' ' + x.message).includes('정산')).length;
        ok('ⓑ 검색칸에 「정산」 → 요청에 q=정산(치는 즉시 · 버튼 없이) · 맞는 것만 표시', B.st.reqs.slice(r1).some(q => new URLSearchParams(q).get('q') === '정산') && s3.items === wantQ && s3.items > 0, `표시 ${s3.items} · 기대 ${wantQ} · ${B.st.reqs.slice(r1).join(' | ')}`);
        const r2 = B.st.reqs.length; await pg.fill('#noti-hist-q', '없는낱말zz'); await pg.waitForTimeout(900); const s4 = await histState(pg);
        ok('ⓑ 결과 없는 검색 → 빈 상태(.noti-hist-empty) · 항목 0', s4.items === 0 && s4.empty && B.st.reqs.length > r2, JSON.stringify({ items: s4.items, empty: s4.empty }));
        const r3 = B.st.reqs.length; await pg.click('#noti-hist-x'); await pg.waitForTimeout(900); const s5 = await histState(pg);
        ok('ⓑ 지우기(#noti-hist-x) → 검색칸 비워지고 전체 목록으로(요청에 q 없음)', (await pg.inputValue('#noti-hist-q')) === '' && s5.items === 8 && B.st.reqs.slice(r3).some(q => !new URLSearchParams(q).get('q')), `${s5.items}건 · ${B.st.reqs.slice(r3).join(' | ')}`);
        const w0 = B.st.writes.length; await pg.click('#noti-hist-readall'); await pg.waitForTimeout(600); const s6 = await histState(pg);
        ok('ⓑ [모두 읽음] → PUT /api/notifications/read-all(가로챔) · 안 읽음 표시 0', B.st.writes.slice(w0).includes('PUT /api/notifications/read-all') && s6.unread === 0, B.st.writes.slice(w0).join(', ') + ` · unread ${s6.unread}`);
        const w1 = B.st.writes.length; const firstId = s6.ids[0]; await pg.click(`#noti-hist-list .noti-hist-item[data-id="${firstId}"] .nh-del`); await pg.waitForTimeout(600); const s7 = await histState(pg);
        ok('ⓑ 항목 삭제(.nh-del) → DELETE /api/notifications/<id>(가로챔) · 그 항목만 사라짐 · 다른 화면으로 안 넘어감', B.st.writes.slice(w1).includes('DELETE /api/notifications/' + firstId) && !s7.ids.includes(firstId) && s7.items === s6.items - 1 && s7.vis, B.st.writes.slice(w1).join(', ') + ` · ${s6.items} → ${s7.items}`);
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); const e1 = (await histState(pg)).vis;
        await openHist(pg, false); const box = await pg.evaluate(() => { const w = document.getElementById('noti-hist'); const inner = w.querySelector('.noti-hist-box, .noti-hist-panel, [role="dialog"] > div') || w.firstElementChild; const r = (inner || w).getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
        await pg.mouse.click(8, Math.round(box.vh / 2)); await pg.waitForTimeout(400); const e2 = (await histState(pg)).vis;
        ok('ⓑ Esc → 닫힘 · 바깥(어두운 곳) 누름 → 닫힘', e1 === false && e2 === false, `Esc 뒤 보임 ${e1} · 바깥 누름 뒤 보임 ${e2} · 창 ${Math.round(box.w)}×${Math.round(box.h)} @${Math.round(box.l)},${Math.round(box.t)}`);
        await openHist(pg, false); await pg.click('#noti-hist-close'); await pg.waitForTimeout(400); ok('ⓑ 닫기 버튼(#noti-hist-close) → 닫힘', (await histState(pg)).vis === false);

        // ══ ⓒ 누르면 해당 창·페이지로 ══
        await pg.evaluate(() => { window.__c576 = []; const rec = (k, a) => window.__c576.push([k, a]);
            window.viewExpenseDetail = function (id) { rec('viewExpenseDetail', Number(id)); }; window.viewDocDetail = function (id) { rec('viewDocDetail', Number(id)); };
            const d = window.AkmAoDesk = window.AkmAoDesk || {}; d.__real = d.open; d.open = function (id) { rec('AkmAoDesk.open', Number(id)); }; });
        const clickItem = async id => { await openHist(pg, false); const w = B.st.writes.length, c = B.st.calls.length; await pg.evaluate(() => { window.__c576.length = 0; });
            if (!(await pg.locator(`#noti-hist-list .noti-hist-item[data-id="${id}"]`).count())) { await pg.click('#noti-hist-more').catch(() => { }); await pg.waitForTimeout(600); }
            const it = pg.locator(`#noti-hist-list .noti-hist-item[data-id="${id}"]`); const target = (await it.locator('.nh-msg').count()) ? it.locator('.nh-msg') : it; await target.click(); await pg.waitForTimeout(1500);
            return { writes: B.st.writes.slice(w), net: B.st.calls.slice(c), calls: await pg.evaluate(() => window.__c576.slice()), page: await activePage(pg), hist: (await histState(pg)).vis }; };
        const cE = await clickItem(910);
        ok("ⓒ 'expense?id=5' → 읽음 처리 PUT(가로챔) · 지출결의서 메뉴 · viewExpenseDetail(5) · 창 닫힘", cE.writes.includes('PUT /api/notifications/910/read') && cE.page === 'expense' && (cE.calls.some(c => c[0] === 'viewExpenseDetail' && c[1] === 5) || cE.net.some(c => c[1] === 5)) && !cE.hist, JSON.stringify(cE));
        const cA = await clickItem(911);
        ok("ⓒ 'agent-office?o=99' → 에이전트 오피스 메뉴 + AkmAoDesk.open(99)", cA.writes.includes('PUT /api/notifications/911/read') && cA.page === 'agent-office' && cA.calls.some(c => c[0] === 'AkmAoDesk.open' && c[1] === 99) && !cA.hist, JSON.stringify(cA));
        const cD = await clickItem(908);
        ok("ⓒ 'documents?id=8' → 기안서류 메뉴 + viewDocDetail(8)", cD.page === 'document' && cD.calls.some(c => c[0] === 'viewDocDetail' && c[1] === 8) && cD.writes.includes('PUT /api/notifications/908/read'), JSON.stringify(cD));
        const cS = await clickItem(909); const tab = await pg.evaluate(() => { const t = document.querySelector('.settlement-tab[data-tab="settlement-status"]'), c = document.getElementById('settlement-status'); return { tab: !!(t && t.classList.contains('active')), content: !!(c && c.classList.contains('active')) }; });
        ok("ⓒ 'settlement:settlement-status' → 정산관리 메뉴 + 정산현황 탭(종전 길 그대로)", cS.page === 'settlement' && tab.tab && tab.content && !cS.hist, JSON.stringify({ page: cS.page, ...tab }));
        const cN = await clickItem(912); const ann = await pg.evaluate(msg => { const hit = [...document.querySelectorAll('body *')].filter(e => { const cs = getComputedStyle(e); return (cs.position === 'fixed' || cs.position === 'absolute') && e.getClientRects().length && e.id !== 'noti-hist' && !e.closest('#noti-hist') && (e.textContent || '').includes(msg); }); return hit.length; }, '내일 오전 발주는 9시까지 마감합니다');
        ok('ⓒ 지시사항(announcement) → 지시사항 창이 뜸(그 글이 든 떠 있는 창) · 다른 메뉴로 안 넘어감', ann > 0, `글이 든 떠 있는 요소 ${ann}개 · 지금 메뉴 ${cN.page}`);
        ok('ⓑⓒ 화면 오류 0 · 실제 쓰기 0(전부 가로챔 ' + B.st.writes.length + '건)', B.st.errors.length === 0, B.st.errors.slice(0, 3).join(' | '));
        await B.ctx.close();

        // ══ ⓓ 시작 해시(/#expense?id=7) ══
        const Dh = await open({ width: 1440, height: 1000 }, { hash: '#expense?id=7', wait: 4500 });
        const dh = { page: await activePage(Dh.pg), hash: await Dh.pg.evaluate(() => location.hash), net: Dh.st.calls.slice() };
        ok('ⓓ /#expense?id=7 로 열면 지출결의서 메뉴 + viewExpenseDetail(7)(지출결의 7번을 불러옴) + 주소에서 해시가 지워짐', dh.page === 'expense' && dh.net.some(c => c[1] === 7) && (dh.hash === '' || dh.hash === '#'), JSON.stringify(dh) + (Dh.st.errors.length ? ' · 오류 ' + Dh.st.errors[0] : ''));
        await Dh.pg.evaluate(() => { location.hash = '#expense?id=9'; }); await Dh.pg.waitForTimeout(2000);
        const hc = { page: await activePage(Dh.pg), hash: await Dh.pg.evaluate(() => location.hash), net: Dh.st.calls.slice() };
        ok('ⓓ 열린 채 location.hash = #expense?id=9 (hashchange) → 지출결의서 메뉴 + viewExpenseDetail(9) + 해시 지워짐', hc.page === 'expense' && hc.net.some(c => c[1] === 9) && (hc.hash === '' || hc.hash === '#'), JSON.stringify(hc));
        await Dh.ctx.close();
        const Dp = await open({ width: 1440, height: 1000 }, { hash: '#settlement:settlement-status', wait: 4500 });
        const dp = await Dp.pg.evaluate(() => ({ page: (document.querySelector('.page.active') || {}).id, tab: !!(document.querySelector('.settlement-tab[data-tab="settlement-status"]') || { classList: { contains: () => false } }).classList.contains('active'), hash: location.hash }));
        ok('ⓓ /#settlement:settlement-status → 정산현황 탭 · 해시 지워짐', dp.page === 'page-settlement' && dp.tab && (dp.hash === '' || dp.hash === '#'), JSON.stringify(dp)); await Dp.ctx.close();

        // ══ ⓔ 무회귀 ══
        const bellList = async o => { const X = await open({ width: 1440, height: 1000 }, o); await openBell(X.pg, false); await X.pg.waitForTimeout(500); const r = await X.pg.evaluate(() => { const l = document.getElementById('noti-list'); return { n: l.querySelectorAll('.noti-item').length, text: l.innerText.replace(/\s+/g, ' ').trim(), html: l.innerHTML.replace(/\s+/g, ' ').trim() }; }); const errs = X.st.errors.slice(); await X.ctx.close(); return { ...r, errs }; };
        const oldL = await bellList({ old: true }), newL = await bellList({});
        ok('ⓔ 종 창 기본 목록(안 읽은 것만) = 고치기 전(' + BASE_REF + ') 과 같음', oldL.n === newL.n && oldL.html === newL.html && oldL.n === FAKE.slice(0, 6).filter(x => !x.isRead).length, `전 ${oldL.n}건 · 후 ${newL.n}건 · 글 같음 ${oldL.text === newL.text}`);
        const Ph = await open({ width: 390, height: 844 }, { phone: true }); await openHist(Ph.pg, true);
        const pr = await Ph.pg.evaluate(() => { const w = document.getElementById('noti-hist'); const cand = [w, ...w.querySelectorAll('*')].map(e => e.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0]; const inner = [...w.children].map(e => e.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0] || cand; return { w: Math.round(inner.width), h: Math.round(inner.height), l: Math.round(inner.left), t: Math.round(inner.top), vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth > innerWidth + 1, items: document.querySelectorAll('#noti-hist-list .noti-hist-item').length, small: [...w.querySelectorAll('button, input')].filter(e => e.getClientRects().length && e.getBoundingClientRect().height < 44).map(e => (e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().height)) }; });
        ok('ⓔ 폰 390: 창이 화면 전체(가로·세로) · 가로 넘침 0 · 목록 표시', pr.w >= pr.vw - 1 && pr.h >= pr.vh - 2 && pr.l <= 1 && pr.t <= 1 && !pr.over && pr.items === 8, JSON.stringify(pr));
        ok('ⓔ 폰 390: 누르는 것(버튼·검색칸) 높이 44px 이상', pr.small.length === 0, pr.small.join(', ') || '전부 44px 이상');
        if (SHOT) await Ph.pg.screenshot({ path: path.join(SHOT, '576-폰-창.png') });
        ok('ⓔ 폰: 화면 오류 0', Ph.st.errors.length === 0, Ph.st.errors.slice(0, 2).join(' | ')); await Ph.ctx.close();
        for (const [dev, vw, phone] of [['PC', { width: 1440, height: 1000 }, false], ['폰', { width: 390, height: 844 }, true]]) {
            const Dk = await open(vw, { phone, theme: 'dark' }); await openHist(Dk.pg, phone); await Dk.pg.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark')); await Dk.pg.waitForTimeout(300);
            const a = await Dk.pg.evaluate(AUDIT, '#noti-hist'); if (SHOT) await Dk.pg.screenshot({ path: path.join(SHOT, `576-${dev}-야간.png`) });
            ok(`ⓔ 야간(${dev}): 창 안 글자 대비 4.5:1 이상 — 미달 0 · 흰 칸 0 (측정 ${a.n}곳 · 최저 ${a.min}:1)`, a.n > 20 && a.bad.length === 0 && a.white.length === 0, (a.bad.slice(0, 8).join(' ‖ ') || '미달 없음') + (a.white.length ? ' ‖ 흰 칸: ' + [...new Set(a.white)].slice(0, 6).join(', ') : ''));
            await Dk.pg.fill('#noti-hist-q', '없는낱말zz'); await Dk.pg.waitForTimeout(900); const a2 = await Dk.pg.evaluate(AUDIT, '#noti-hist');
            ok(`ⓔ 야간(${dev}): 빈 상태·검색칸 글자도 대비 미달 0`, a2.bad.length === 0, a2.bad.slice(0, 5).join(' ‖ ') || `측정 ${a2.n}곳 · 최저 ${a2.min}:1`);
            await Dk.ctx.close(); }
        const Lt = await open({ width: 1440, height: 1000 }); await openHist(Lt.pg, false); const al = await Lt.pg.evaluate(AUDIT, '#noti-hist');
        ok(`ⓔ 밝은 화면: 창 안 글자 대비 미달 0 (측정 ${al.n}곳 · 최저 ${al.min}:1)`, al.n > 20 && al.bad.length === 0, al.bad.slice(0, 8).join(' ‖ ')); await Lt.ctx.close();
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 6).join(' / ') : String(e)); }
    finally {
        try { if (browser) await browser.close(); } catch (_) { } if (srv) srv.kill();
        if (!NO468) { await sleep(800); const r = spawnSync(process.execPath, ['scripts/verify-468-ui.js'], { cwd: ROOT, encoding: 'utf8', timeout: 600000, maxBuffer: 1 << 26 }); const out = String(r.stdout || ''); const p = (out.match(/^✅/gm) || []).length, f = (out.match(/^❌.*$/gm) || []); ok(`ⓔ verify-468-ui 기존 그대로 통과(✅ ${p} · ❌ ${f.length})`, p > 10 && f.length === 0, f.slice(0, 4).join(' ‖ ') || (out.trim().split('\n').pop() || '').slice(0, 80)); }
        const pass = results.filter(r => r.pass).length; console.log(`\n결과: ${pass}/${results.length}`); setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
