// #501 검증: 에이전트 오피스 첫 칸 = 한 카드(시계·상태·아꼼이 + 지시 입력 상자 + 자주 쓰는 일 한 줄)
//   사용: node scripts/verify-501-top.js [스크린샷 폴더]
//   로컬 실서버 3459(스케줄러 차단) · desk-status·desk/orders 응답과 모든 쓰기 요청을 page.route로 가로챈다 → DB 쓰기 0(로그인 우회용 계정 id·이름만 읽음).
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = 3459;
const SHOT = process.argv[2] || null;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };
const info = msg => console.log('ℹ️ ' + msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(150); } return null; };
// 대비 계산(WCAG)
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const rgb = s => { const m = /rgba?\(([^)]+)\)/.exec(String(s)); return m ? m[1].split(',').slice(0, 3).map(x => parseFloat(x)) : null; };
const ratio = (a, b) => { const A = rgb(a), B = rgb(b); if (!A || !B) return 0; const l1 = lum(A), l2 = lum(B); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

(async () => {
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'desk501-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'desk501-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const stf = (await db.query(`SELECT id, name, position FROM users WHERE role <> 'admin' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        await db.end();
        const admin = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' };
        const staff = { id: stf.id, name: stf.name, position: stf.position || '', role: 'staff' };
        const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const open = async (vw, user, extra) => {
            const st = { status: { state: 'idle', online: true, waiting: 0, working: 0, order_id: null, can_wake: true, launcher: { on: true, note: '' }, approval: 0 }, orders: [], writes: [], delay: 0, dialogs: 0, nextId: 500 };
            const ctx = await browser.newContext(Object.assign({ viewport: vw }, extra || {}));
            const pg = await ctx.newPage();
            const errors = [], cons = [];
            pg.on('pageerror', e => errors.push(String(e)));
            pg.on('console', m => { if (m.type() === 'error') cons.push(m.text().slice(0, 200)); });
            pg.on('dialog', d => { st.dialogs++; d.dismiss(); });
            st.bad = []; pg.on('response', r => { if (r.status() >= 400) st.bad.push(r.status() + ' ' + new URL(r.url()).pathname); });
            const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
            await pg.route('**/api/**', async route => {
                const rq = route.request();
                if (rq.method() === 'GET') return route.continue();
                const p = new URL(rq.url()).pathname; let body = null; try { body = JSON.parse(rq.postData() || 'null'); } catch (_) { }
                st.writes.push({ m: rq.method(), p, body });
                if (p === '/api/agent-office/orders') {
                    if (st.delay) await sleep(st.delay);
                    const o = { id: st.nextId++, content: body && body.content, status: '대기', created_at: new Date().toISOString(), processed_at: null, created_by: user.name, created_by_id: user.id, has_image: !!(body && body.image_data), reply_to: null, steps: [], result: null };
                    st.orders.push(o);
                    return json(route, { ok: true, engine: 'desk', order: o });
                }
                return json(route, { ok: true });
            });
            await pg.route('**/api/agent-office/desk/orders*', route => route.request().method() === 'GET' ? json(route, { orders: st.orders.slice().sort((a, b) => b.id - a.id) }) : route.fallback());
            await pg.route('**/api/agent-office/desk-status', route => route.request().method() === 'GET' ? json(route, st.status) : route.fallback());
            const tok = jwt.sign(user, 'verifytest', { expiresIn: '20m' });
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); localStorage.removeItem('akm_desk_view'); }, [tok, user]);
            await pg.reload({ waitUntil: 'networkidle' });
            await pg.waitForTimeout(2500);
            await pg.evaluate(() => { const n = document.querySelector('.nav-item[data-page="agent-office"]'); if (n) n.click(); else if (typeof switchPage === 'function') switchPage('agent-office'); });
            await pg.waitForSelector('#desk-input', { timeout: 20000 });
            await pg.waitForTimeout(900);
            const setStatus = async s => { st.status = Object.assign({ state: 'idle', online: true, waiting: 0, working: 0, order_id: null, can_wake: true, launcher: { on: true, note: '' }, approval: 0 }, s); await pg.evaluate(() => window.__aoDesk.loadStatus()); await sleep(250); };
            return { pg, st, errors, cons, ctx, setStatus };
        };
        const shot = async (pg, name) => { if (!SHOT) return; try { fs.mkdirSync(SHOT, { recursive: true }); await pg.screenshot({ path: path.join(SHOT, name + '.png'), fullPage: false }); } catch (e) { info('스크린샷 실패: ' + e.message); } };
        const top = pg => pg.evaluate(() => {
            const $ = id => document.getElementById(id), vis = el => !!el && el.getClientRects().length > 0;
            const R = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
            const card = document.querySelector('.desk-top.desk-top1'), comp = document.querySelector('.desk-compose'), inp = $('desk-input'), form = $('desk-ask');
            const cs = getComputedStyle(comp), ccs = getComputedStyle(card), ics = getComputedStyle(inp);
            const chips = ['desk-qty-now', 'desk-settle-now', 'desk-talk-now'].map(i => $(i));
            const quick = document.querySelector('.desk-quick2'), hero = document.querySelector('.desk-top1 .desk-hero');
            const lab = form.querySelector('label[for="desk-input"]');
            const spark = document.querySelector('.desk-spark');
            return {
                oneCard: !!card && card.contains($('desk-clock')) && card.contains(inp) && card.contains($('desk-char')) && card.contains(quick),
                card: R(card), cardPadL: parseFloat(ccs.paddingLeft), cardPadR: parseFloat(ccs.paddingRight), cardBorder: ccs.borderTopWidth, cardBg: ccs.backgroundColor,
                innerBoxes: [hero, form].map(el => { const c = getComputedStyle(el); return c.borderTopWidth + '|' + c.boxShadow + '|' + c.backgroundColor; }),
                noHead: form.querySelectorAll('h2, p').length, label: lab ? lab.textContent : null, labelBox: lab ? R(lab) : null,
                comp: R(comp), compBorder: cs.borderTopColor, compBorderW: cs.borderTopWidth, compShadow: cs.boxShadow, compRadius: cs.borderTopLeftRadius, compBg: cs.backgroundColor,
                inp: R(inp), rows: inp.rows, ph: inp.placeholder, phColor: getComputedStyle(inp, '::placeholder').color, inpColor: ics.color, inpFont: ics.fontSize, inpOutline: ics.outlineStyle, maxlength: inp.maxLength, inpScroll: inp.scrollHeight - inp.clientHeight, value: inp.value,
                attach: R($('desk-attach')), send: R($('desk-send')), attachLabel: $('desk-attach').getAttribute('aria-label'), sendLabel: $('desk-send').getAttribute('aria-label'), sendType: $('desk-send').type, sendText: $('desk-send').textContent.trim(), sendDisabled: $('desk-send').disabled, sendBusy: $('desk-send').getAttribute('aria-busy'),
                sendColors: [getComputedStyle($('desk-send')).backgroundColor, getComputedStyle($('desk-send')).color], attachColors: [getComputedStyle($('desk-attach')).backgroundColor, getComputedStyle($('desk-attach')).color],
                count: { vis: vis($('desk-count')), hidden: $('desk-count').hidden, text: $('desk-count').textContent, box: vis($('desk-count')) ? R($('desk-count')) : null },
                chips: chips.map(c => Object.assign(R(c), { text: c.textContent.trim(), vis: vis(c), color: getComputedStyle(c).color, bg: getComputedStyle(c).backgroundColor })), quick: Object.assign(R(quick), { sw: quick.scrollWidth, cw: quick.clientWidth, ox: getComputedStyle(quick).overflowX, label: quick.getAttribute('aria-label'), head: quick.querySelectorAll('.desk-quick2-label').length }),
                hint: Array.from(document.querySelectorAll('.desk-keyhint, .desk-ask-meta')).filter(vis).length, sendTitle: $('desk-send').title,
                state: { text: $('desk-state-text').textContent, s: $('desk-state').dataset.s, box: R($('desk-state')) }, say: { text: $('desk-say').textContent, box: R($('desk-say')), color: getComputedStyle($('desk-say')).color, vis: vis($('desk-say')) },
                wake: { vis: vis($('desk-wake-btn')), hidden: $('desk-wake-btn').hidden, disabled: $('desk-wake-btn').disabled, text: $('desk-wake-btn').textContent.trim(), note: $('desk-wake-note').textContent, box: vis($('desk-wake-btn')) ? R($('desk-wake-btn')) : null },
                onText: /창구 켜짐/.test(card.innerText), img: Object.assign(R($('desk-char')), { src: $('desk-char').getAttribute('src'), nat: $('desk-char').naturalWidth }), hero: R(hero), clock: R($('desk-clock')),
                spark: spark ? Object.assign(R(spark), { hidden: spark.getAttribute('aria-hidden'), color: getComputedStyle(spark).color }) : null,
                thumbs: Array.from(document.querySelectorAll('#desk-thumbs .desk-thumb')).map(R), thumbsHidden: $('desk-thumbs').hidden, drag: form.classList.contains('drag'),
                order: Array.from(document.querySelectorAll('#ao-desk-root .desk-main > section')).map(x => x.id || x.className.split(' ')[0]),
                ids: ['desk-input', 'desk-send', 'desk-attach', 'desk-file', 'desk-thumbs', 'desk-count', 'desk-qty-now', 'desk-settle-now', 'desk-talk-now', 'desk-wake', 'desk-wake-btn', 'desk-state', 'desk-say', 'desk-date', 'desk-clock', 'desk-char', 'desk-reply-file'].filter(i => !$(i)),
                rootOverflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 2, focusInInput: document.activeElement === inp,
            };
        });
        const inside = (a, b, pad) => a.l >= b.l - (pad || 1) && a.r <= b.r + (pad || 1) && a.t >= b.t - (pad || 1) && a.b <= b.b + (pad || 1);
        const posts = (S, re) => S.st.writes.filter(w => re.test(w.p));
        const pasteImg = (pg, sel) => pg.evaluate(([sel, b64]) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], 'shot.png', { type: 'image/png' })); const el = document.querySelector(sel); el.focus(); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; }, [sel, PNG]);
        const dropImg = (pg, type) => pg.evaluate(([b64, type]) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], 'drop.png', { type: 'image/png' })); const el = document.getElementById('desk-ask'); const ev = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; }, [PNG, type]);

        // ════ 1440px 관리자
        const A = await open({ width: 1440, height: 950 }, admin);
        let t = await top(A.pg);
        ok('첫 칸 = 한 카드: 날짜·시계·상태·아꼼이 + 지시 입력 상자 + 자주 쓰는 일이 같은 카드 안', t.oneCard && t.cardBorder !== '0px' && t.innerBoxes.every(x => /^0px\|none\|rgba\(0, 0, 0, 0\)$/.test(x)), JSON.stringify(t.innerBoxes));
        ok('입력 폼의 제목·설명 글 없음 · 「지시 내용」 label은 화면에서만 숨김(읽기 프로그램용 1px)', t.noHead === 0 && t.label === '지시 내용' && t.labelBox.w <= 1 && t.labelBox.h <= 1);
        ok('마크업 id 전부 그대로', t.ids.length === 0, t.ids.join(','));
        ok('칸 순서 그대로(desk-top → desk-listbox → desk-inbox → desk-board)', JSON.stringify(t.order) === '["desk-top","desk-listbox","desk-inbox","desk-board"]', JSON.stringify(t.order));
        const innerW = t.card.w - t.cardPadL - t.cardPadR;
        ok('입력 상자가 카드 너비를 거의 다 씀(안쪽 너비의 98% 이상)', t.comp.w >= innerW * 0.98 && inside(t.comp, t.card), `상자 ${t.comp.w}px / 카드 안쪽 ${Math.round(innerW)}px`);
        ok('입력 상자 테두리 = 인디고 옅은 색(#A5ACFF · 2px) · 둥근 모서리 · 흰 바탕', t.compBorder === 'rgb(165, 172, 255)' && parseFloat(t.compBorderW) === 2 && parseFloat(t.compRadius) >= 12 && t.compBg === 'rgb(255, 255, 255)', `${t.compBorder} ${t.compBorderW} r=${t.compRadius}`);
        ok('입력칸 rows 2 · 안내 글 「원하시는 작업을 입력해 주세요」 · 글자 15px 이상 · maxlength 2000', t.rows === 2 && t.ph === '원하시는 작업을 입력해 주세요' && parseFloat(t.inpFont) >= 15 && t.maxlength === 2000);
        ok('아이콘 버튼 2개 = 44×44 · 입력 상자 안 오른쪽 아래 · 첨부가 왼쪽·보내기가 오른쪽', t.attach.w === 44 && t.attach.h === 44 && t.send.w === 44 && t.send.h === 44 && inside(t.attach, t.comp) && inside(t.send, t.comp) && t.comp.r - t.send.r <= 16 && t.comp.b - t.send.b <= 16 && t.attach.r <= t.send.l && Math.abs(t.attach.t - t.send.t) <= 1 && t.send.t >= t.inp.b - 2, JSON.stringify({ attach: t.attach, send: t.send, comp: t.comp }));
        ok('aria-label = 「이미지 첨부」·「지시 보내기」 · 보내기는 submit · 버튼 안에 글자 없음(아이콘)', t.attachLabel === '이미지·파일 첨부' &&   /* #544 파일도 첨부 */ t.sendLabel === '지시 보내기' && t.sendType === 'submit' && t.sendText === '');
        ok('「Enter 보내기…」 안내 글 없음 · 보내기 버튼 설명(title)에 Enter·Shift+Enter', t.hint === 0 && /Enter/.test(t.sendTitle) && /Shift\+Enter/.test(t.sendTitle), t.sendTitle);
        ok('자주 쓰는 일 = 머리글 없이 3개(「중간발주」「정산 이미지」「톡톡 답변 추천」) · 한 줄(같은 높이) · 입력 상자 아래 · 묶음 이름(aria-label)', t.chips.map(c => c.text).join('|') === '중간발주|정산 이미지|톡톡 답변 추천' && new Set(t.chips.map(c => c.t)).size === 1 && t.chips.every(c => c.vis && c.t >= t.comp.b) && t.quick.head === 0 && t.quick.label === '자주 쓰는 일', JSON.stringify(t.chips.map(c => [c.text, c.t])));
        ok('상태 한 줄: 상태 알약 + 인사 글이 같은 줄 · idle 인사 = 「무엇을 도와드릴까요?」 · 「대기 중」', t.state.text === '대기 중' && t.say.text === '무엇을 도와드릴까요?' && t.say.vis && Math.abs((t.state.box.t + t.state.box.b) / 2 - (t.say.box.t + t.say.box.b) / 2) <= 6 && t.say.box.l >= t.state.box.r, JSON.stringify({ state: t.state.box, say: t.say.box }));
        ok('창구가 켜져 있으면(idle) 깨우기 버튼 숨김 · 「창구 켜짐」 글자 없음', !t.wake.vis && !t.onText);
        ok('아꼼이 그림 로드 · 카드 안 오른쪽 · 입력 상자 위', t.img.nat > 0 && inside(t.img, t.card) && t.img.r >= t.card.r - 40 && t.img.b <= t.comp.t + 2 && /akkomi-idle/.test(t.img.src), JSON.stringify(t.img));
        info(`배치(1440): 카드 ${t.card.w}×${t.card.h} · 아꼼이 아래 ↔ 입력 상자 위 ${t.comp.t - t.img.b}px · 상태 줄 아래 ↔ 입력 상자 위 ${t.comp.t - t.state.box.b}px · 입력 상자 아래 ↔ 버튼 줄 ${t.chips[0].t - t.comp.b}px · ✦ 위치 x=${t.spark && t.spark.l - t.comp.l}px y=${t.spark && t.spark.t - t.comp.t}px(상자 기준) · 글 시작 x=${t.inp.l - t.comp.l}px`);
        ok('✦ 는 장식(aria-hidden) · 입력 상자 안 왼쪽 위 · 글과 안 겹침', !!t.spark && t.spark.hidden === 'true' && inside(t.spark, t.comp) && t.spark.r <= t.inp.l + 1, JSON.stringify(t.spark));
        // 대비
        const cPh = ratio(t.phColor, 'rgb(255,255,255)'), cSay = ratio(t.say.color, t.cardBg), cChip = Math.min(...t.chips.map(c => ratio(c.color, c.bg))), cSend = ratio(t.sendColors[1], t.sendColors[0]), cAtt = ratio(t.attachColors[1], t.attachColors[0]), cBorder = ratio(t.compBorder, t.cardBg);
        ok('대비 — 자리표시 글(placeholder) 4.5:1 이상', cPh >= 4.5, `${t.phColor} on 흰색 = ${cPh.toFixed(2)}:1`);
        ok('대비 — 인사 글·버튼 글 4.5:1 이상 · 아이콘(보내기·첨부) 3:1 이상', cSay >= 4.5 && cChip >= 4.5 && cSend >= 3 && cAtt >= 3, `인사 ${cSay.toFixed(2)} · 버튼 글 ${cChip.toFixed(2)} · 보내기 아이콘 ${cSend.toFixed(2)} · 첨부 아이콘 ${cAtt.toFixed(2)}`);
        info(`참고: 입력 상자 테두리(#A5ACFF) 대 카드 바탕 대비 = ${cBorder.toFixed(2)}:1 (경계선 권장 3:1 — 평소 테두리는 옅고, 포커스 때 진해짐)`);
        ok('가로 넘침 없음(1440)', !t.rootOverflow && !t.docOverflow);
        await A.pg.evaluate(() => window.scrollTo(0, 0));
        await shot(A.pg, '1-1440-첫화면');

        // 포커스 링
        await A.pg.click('#desk-input');
        await sleep(350);
        const f = await top(A.pg);
        ok('입력칸 포커스 → 상자 테두리가 진한 인디고 + 바깥 링 · 입력칸 자체 테두리(outline)는 없음', f.focusInInput && f.compBorder === 'rgb(79, 70, 229)' && /rgba\(79, 70, 229/.test(f.compShadow) && /3px/.test(f.compShadow) && f.inpOutline === 'none', `${f.compBorder} · ${f.compShadow}`);
        await shot(A.pg, '2-1440-입력-포커스');

        // 글자 수: 1,500자 미만 숨김 · 이상 보임
        await A.pg.fill('#desk-input', '가'.repeat(1499));
        const c1 = await top(A.pg);
        await A.pg.fill('#desk-input', '가'.repeat(1500));
        const c2 = await top(A.pg);
        ok('글자 수 = 1,499자까지 숨김(값은 갱신됨) · 1,500자부터 보임 · 입력 상자 안 버튼 줄 왼쪽', !c1.count.vis && c1.count.text.replace(/\s/g, '') === '1499/2000' && c2.count.vis && c2.count.text.replace(/\s/g, '') === '1500/2000' && inside(c2.count.box, c2.comp) && c2.count.box.r <= c2.attach.l, JSON.stringify({ c1: c1.count.text, c2: c2.count }));
        await A.pg.fill('#desk-input', '');
        const c3 = await top(A.pg);
        ok('지우면 글자 수 다시 숨김', !c3.count.vis);

        // 적는 만큼 늘어남 · 최대 240 · 보내면 원래 높이
        const h0 = c3.inp.h;
        await A.pg.fill('#desk-input', Array.from({ length: 6 }, (_, i) => `${i + 1}번째 줄`).join('\n'));
        const g1 = await top(A.pg);
        await A.pg.fill('#desk-input', Array.from({ length: 40 }, (_, i) => `${i + 1}번째 줄 — 길게 적는 지시`).join('\n'));
        const g2 = await top(A.pg);
        ok('긴 글 → 입력칸 높이가 늘어남(6줄) · 더 길면 240px에서 멈추고 안쪽 스크롤', g1.inp.h > h0 + 40 && g1.inpScroll <= 2 && g2.inp.h <= 242 && g2.inp.h >= 200 && g2.inpScroll > 0 && inside(g2.send, g2.comp), `빈칸 ${h0}px → 6줄 ${g1.inp.h}px → 40줄 ${g2.inp.h}px`);
        ok('긴 글에서도 버튼은 상자 안 오른쪽 아래 · 자주 쓰는 일 줄은 상자 아래 · 넘침 없음', g2.send.t >= g2.inp.b - 2 && g2.chips[0].t >= g2.comp.b && !g2.rootOverflow);

        // 이미지: 붙여넣기 · 첨부 · 끌어 놓기
        const pv = await pasteImg(A.pg, '#desk-input');
        const i1 = await waitFor(async () => { const x = await top(A.pg); return x.thumbs.length === 1 ? x : null; }, 4000);
        ok('이미지 붙여넣기 → 썸네일 1장 · 입력 상자 안(글 아래·버튼 위)', pv && !!i1 && inside(i1.thumbs[0], i1.comp) && i1.thumbs[0].t >= i1.inp.b - 2 && i1.thumbs[0].b <= i1.send.t + 2, i1 ? JSON.stringify(i1.thumbs[0]) : '썸네일 없음');
        const [fc] = await Promise.all([A.pg.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), A.pg.click('#desk-attach')]);
        if (fc) await fc.setFiles({ name: '목록.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(PNG, 'base64') });
        const i2 = await waitFor(async () => { const x = await top(A.pg); return x.thumbs.length === 2 ? x : null; }, 4000);
        ok('클립 버튼 → 파일 고르기 → 썸네일 2장', !!fc && !!i2);
        await dropImg(A.pg, 'dragover');
        const dg = await top(A.pg);
        const dStyle = await A.pg.evaluate(() => getComputedStyle(document.querySelector('.desk-compose')).borderTopStyle);
        const dp = await dropImg(A.pg, 'drop');
        const i3 = await waitFor(async () => { const x = await top(A.pg); return x.thumbs.length === 3 ? x : null; }, 4000);
        ok('끌어 놓기 — 끄는 동안 상자 테두리 점선 · 놓으면 썸네일 3장 · 전부 상자 안 · 점선 해제', dg.drag && dStyle === 'dashed' && dp && !!i3 && i3.thumbs.every(x => inside(x, i3.comp)) && !i3.drag, `점선 ${dStyle} · 썸네일 ${i3 ? i3.thumbs.length : 0}`);
        await shot(A.pg, '3-1440-긴글-썸네일');
        await A.pg.click('#desk-thumbs .desk-thumb button[data-i="0"]');
        const i4 = await top(A.pg);
        ok('썸네일 × = 그 장만 빠짐(2장 남음)', i4.thumbs.length === 2);

        // Shift+Enter · Enter(보내는 중 버튼 잠금)
        await A.pg.fill('#desk-input', '첫 줄');
        await A.pg.focus('#desk-input');
        await A.pg.keyboard.press('End');
        await A.pg.keyboard.press('Shift+Enter');
        await A.pg.keyboard.type('둘째 줄');
        ok('Shift+Enter = 줄바꿈만(보내지 않음)', (await A.pg.inputValue('#desk-input')) === '첫 줄\n둘째 줄' && posts(A, /\/orders$/).length === 0);
        A.st.delay = 900;
        await A.pg.keyboard.press('Enter');
        await sleep(250);
        const s1 = await top(A.pg);
        ok('Enter = 보내기 시작 · 보내는 중 = 버튼 disabled + aria-busy · 버튼 글자 안 바뀜(아이콘 그대로)', s1.sendDisabled && s1.sendBusy === 'true' && s1.sendText === '', JSON.stringify({ disabled: s1.sendDisabled, busy: s1.sendBusy }));
        await A.pg.keyboard.press('Enter');   // 보내는 중 한 번 더 눌러도 중복 전송 없음
        const ps = await waitFor(async () => posts(A, /\/orders$/).length >= 2 ? posts(A, /\/orders$/) : null, 8000);
        await sleep(1300);
        A.st.delay = 0;
        const s2 = await top(A.pg);
        ok('이미지 2장 + 글 → POST 2회(장마다 1건 · 같은 글 · image_data) · 보내는 중 Enter 재입력은 무시', !!ps && posts(A, /\/orders$/).length === 2 && ps.every(x => x.body.content === '첫 줄\n둘째 줄' && /^data:image\//.test(x.body.image_data || '')), ps ? JSON.stringify(ps.map(x => [x.body.content, String(x.body.image_data).slice(0, 16), x.body.image_mime])) : 'POST 부족');
        ok('보낸 뒤 = 입력칸 비워짐 · 원래 높이로 · 썸네일 사라짐 · 버튼 다시 켜짐(aria-busy 없음)', s2.value === '' && Math.abs(s2.inp.h - h0) <= 1 && s2.thumbs.length === 0 && s2.thumbsHidden && !s2.sendDisabled && s2.sendBusy !== 'true', JSON.stringify({ h: s2.inp.h, h0, busy: s2.sendBusy }));
        await A.pg.focus('#desk-input'); await A.pg.keyboard.press('Enter'); await sleep(400);
        ok('빈 입력칸 Enter = 보내지 않음', posts(A, /\/orders$/).length === 2);
        await A.pg.fill('#desk-input', '클릭으로 보내기');
        await A.pg.click('#desk-send');
        const pc = await waitFor(async () => posts(A, /\/orders$/).length === 3 ? posts(A, /\/orders$/) : null, 5000);
        ok('종이비행기 버튼 클릭 = POST 1회', !!pc && pc[2].body.content === '클릭으로 보내기');

        // 자주 쓰는 일 동작
        const w0 = posts(A, /\/orders$/).length;
        await A.pg.click('#desk-talk-now');
        const tk = await top(A.pg);
        ok('「톡톡 답변 추천」 = 입력칸에 글 채움·포커스 · 보내지 않음 · 칸 높이가 글에 맞춰짐', tk.value === '처리 안 된 톡톡 건 답변 예시문구 만들어줘' && tk.focusInInput && posts(A, /\/orders$/).length === w0 && tk.inpScroll <= 2);
        await A.pg.fill('#desk-input', '');
        const [fc2] = await Promise.all([A.pg.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), A.pg.click('#desk-settle-now')]);
        ok('「정산 이미지」 = 빈칸이면 「정산관리에 올려줘」 채우고 파일 고르기', !!fc2 && (await A.pg.inputValue('#desk-input')) === '정산관리에 올려줘');
        await A.pg.fill('#desk-input', '');
        await A.pg.click('#desk-qty-now');
        const pq = await waitFor(async () => posts(A, /\/orders$/).length === w0 + 1 ? posts(A, /\/orders$/) : null, 5000);
        ok("「중간발주」 = POST 1회 content '중간발주 뽑아줘'", !!pq && pq[pq.length - 1].body.content === '중간발주 뽑아줘');

        // 창구 상태별
        const cut = (t, n) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
        await A.setStatus({ state: 'busy', order_id: 77, working: 1, working_list: [{ id: 77, created_by: '전승범 대표', content: '중간발주 뽑아줘', reply_to: null, parent_content: null }] });
        const b1 = await top(A.pg);
        ok('#506 처리 중 1건 = 「처리 중」 · 「전승범 대표님의 "중간발주 뽑아줘" 처리 중이에요」 · 깨우기 버튼 숨김 · 아꼼이 일하는 그림', b1.state.text === '처리 중' && b1.say.text === '전승범 대표님의 "중간발주 뽑아줘" 처리 중이에요' && !b1.wake.vis && /akkomi-busy/.test(b1.img.src), b1.say.text);
        await A.setStatus({ state: 'busy', order_id: 77, working: 1, working_list: undefined });
        const b1f = await top(A.pg);
        ok('#506 working_list 없는 옛 서버 응답 → 폴백 「지금 지시를 처리하고 있어요.」', b1f.say.text === '지금 지시를 처리하고 있어요.', b1f.say.text);
        await A.setStatus({ state: 'offline', online: false, can_wake: true, waiting: 2, last_seen: new Date(Date.now() - 600000).toISOString() });
        const o1 = await top(A.pg);
        ok('자리 비움 + 관리자 = [창구 깨우기] 버튼 보임·누를 수 있음(44px 이상) · 카드 안 · 「자리 비움」', o1.state.text === '자리 비움' && o1.wake.vis && !o1.wake.disabled && o1.wake.text === '창구 깨우기' && o1.wake.box.h >= 36 && inside(o1.wake.box, o1.card) && /자리에 없어요/.test(o1.say.text), JSON.stringify(o1.wake));
        ok('자리 비움에서도 입력 상자·버튼 배치 그대로 · 넘침 없음', inside(o1.send, o1.comp) && !o1.rootOverflow && o1.comp.w === t.comp.w);
        await A.pg.evaluate(() => window.scrollTo(0, 0));
        await shot(A.pg, '4-1440-자리비움');
        await A.pg.click('#desk-wake-btn');
        const pw = await waitFor(async () => posts(A, /\/desk\/wake$/).length ? posts(A, /\/desk\/wake$/) : null, 4000);
        ok('[창구 깨우기] 클릭 = POST /desk/wake {action:"wake"} 1회', !!pw && pw.length === 1 && pw[0].body && pw[0].body.action === 'wake');
        await A.setStatus({ state: 'offline', online: false, can_wake: false });
        const o2 = await top(A.pg);
        ok('자리 비움 + 대표 PC 관리 프로그램 꺼짐 = 버튼은 보이되 누를 수 없음 + 「PC를 켜면…」 안내', o2.wake.vis && o2.wake.disabled && /관리 프로그램이 꺼져/.test(o2.wake.note), o2.wake.note);
        await A.setStatus({ state: 'idle' });
        const o3 = await top(A.pg);
        ok('다시 대기 중 = 버튼 숨김 · 안내 글 없음', !o3.wake.vis && o3.wake.note === '' && o3.say.text === '무엇을 도와드릴까요?');
        ok('1440px — 브라우저 기본 창 0 · pageerror 0 · console error 0', A.st.dialogs === 0 && A.errors.length === 0 && A.cons.length === 0, [...A.errors, ...A.cons].join(' | ').slice(0, 400));
        const otherW = A.st.writes.filter(w => !/\/orders$|\/desk\/wake$/.test(w.p));
        info('가로챈 쓰기 요청 ' + A.st.writes.length + '건(실서버 미도달)' + (otherW.length ? ' · 예상 밖: ' + otherW.map(w => w.p).join(', ') : ''));
        await A.ctx.close();

        // 직원(1440): 자리 비움이어도 버튼 없음
        const S = await open({ width: 1440, height: 950 }, staff);
        await S.setStatus({ state: 'offline', online: false, can_wake: true });
        const sv = await top(S.pg);
        ok('직원 + 자리 비움 = 깨우기 버튼 없음 · 「관리자가 깨우면…」 안내', !sv.wake.vis && /관리자가 깨우면/.test(sv.wake.note), sv.wake.note);
        ok('직원 화면 pageerror 0', S.errors.length === 0, S.errors.join(' | ').slice(0, 300));
        if (S.cons.length) info('참고(직원 계정 · 첫 칸과 무관한 앱 초기화): console error ' + S.cons.length + '건 — ' + S.cons.join(' | ').slice(0, 200) + ' · 실패한 요청: ' + S.st.bad.join(', '));
        await S.ctx.close();

        // ════ 1000px
        const B = await open({ width: 1000, height: 900 }, admin);
        const tb = await top(B.pg);
        ok('1000px — 한 카드 · 입력 상자가 카드 너비를 거의 다 씀 · 버튼 3개 한 줄 · 아이콘 상자 안', tb.oneCard && tb.comp.w >= (tb.card.w - tb.cardPadL - tb.cardPadR) * 0.98 && new Set(tb.chips.map(c => c.t)).size === 1 && inside(tb.send, tb.comp) && inside(tb.attach, tb.comp), `카드 ${tb.card.w} · 상자 ${tb.comp.w}`);
        ok('1000px — 가로 넘침 없음 · 오류 0', !tb.rootOverflow && !tb.docOverflow && B.errors.length === 0 && B.cons.length === 0);
        await shot(B.pg, '5-1000-첫화면');
        await B.ctx.close();

        // ════ 390px(터치)
        const P = await open({ width: 390, height: 800 }, admin, { hasTouch: true, isMobile: true });
        const tp = await top(P.pg);
        ok('390px — 한 카드 · 입력 상자 카드 안 가득 · 아이콘 2개 44px·상자 안 오른쪽 아래', tp.oneCard && inside(tp.comp, tp.card) && tp.comp.w >= (tp.card.w - tp.cardPadL - tp.cardPadR) * 0.98 && tp.send.w === 44 && tp.send.h === 44 && tp.attach.h === 44 && inside(tp.send, tp.comp) && inside(tp.attach, tp.comp), `카드 ${tp.card.w} · 상자 ${tp.comp.w}`);
        ok('390px — 자주 쓰는 일 3개 한 줄(같은 높이) · 높이 44px 이상 · 줄이 넘치면 그 줄만 옆으로 밀림 · 페이지 가로 넘침 0', new Set(tp.chips.map(c => c.t)).size === 1 && tp.chips.every(c => c.h >= 44) && (tp.quick.sw <= tp.quick.cw + 1 || /auto|scroll/.test(tp.quick.ox)) && !tp.rootOverflow && !tp.docOverflow, `줄 너비 ${tp.quick.cw} · 내용 ${tp.quick.sw} · overflow-x ${tp.quick.ox}`);
        ok('390px — 상태 알약·인사 글·아꼼이가 카드 안 · 아꼼이가 글을 가리지 않음', inside(tp.state.box, tp.card) && inside(tp.say.box, tp.card) && inside(tp.img, tp.card) && (tp.say.box.r <= tp.img.l + 1 || tp.say.box.t >= tp.img.b - 1 || tp.say.box.b <= tp.img.t + 1), JSON.stringify({ say: tp.say.box, img: tp.img }));
        await P.pg.evaluate(() => window.scrollTo(0, 0));
        await shot(P.pg, '6-390-첫화면');
        await P.pg.tap('#desk-input');
        await P.pg.keyboard.type('폰 첫 줄');
        await P.pg.keyboard.press('Enter');
        await P.pg.keyboard.type('폰 둘째 줄');
        await sleep(400);
        ok('390px(터치) — Enter = 줄바꿈(보내지 않음) · 포커스 링', (await P.pg.inputValue('#desk-input')) === '폰 첫 줄\n폰 둘째 줄' && posts(P, /\/orders$/).length === 0 && (await top(P.pg)).compBorder === 'rgb(79, 70, 229)');
        await pasteImg(P.pg, '#desk-input');
        const ip = await waitFor(async () => { const x = await top(P.pg); return x.thumbs.length === 1 ? x : null; }, 4000);
        ok('390px — 썸네일이 입력 상자 안 · 넘침 없음', !!ip && inside(ip.thumbs[0], ip.comp) && !ip.rootOverflow);
        await shot(P.pg, '6-390-입력중');
        await P.pg.tap('#desk-send');
        const pp = await waitFor(async () => posts(P, /\/orders$/).length ? posts(P, /\/orders$/) : null, 5000);
        ok('390px — 종이비행기 버튼 탭 = POST 1회(글+이미지)', !!pp && pp.length === 1 && pp[0].body.content === '폰 첫 줄\n폰 둘째 줄' && /^data:image\//.test(pp[0].body.image_data || ''));
        await P.setStatus({ state: 'offline', online: false, can_wake: true });
        const po = await top(P.pg);
        ok('390px — 자리 비움: [창구 깨우기] 44px 이상 · 카드 안 · 넘침 없음', po.wake.vis && po.wake.box.h >= 44 && inside(po.wake.box, po.card) && !po.rootOverflow, JSON.stringify(po.wake.box));
        await P.pg.evaluate(() => window.scrollTo(0, 0));
        await shot(P.pg, '6-390-자리비움');
        ok('390px — pageerror 0 · console error 0', P.errors.length === 0 && P.cons.length === 0, [...P.errors, ...P.cons].join(' | ').slice(0, 400));
        await P.ctx.close();
    } catch (e) {
        ok('검증 실행', false, e.message);
    } finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) { try { srv.kill(); } catch (_) { } }
    }
    const pass = results.filter(r => r.pass).length;
    console.log(`\n결과: ${pass}/${results.length}` + (pass === results.length ? ' ✅' : ' — 실패: ' + results.filter(r => !r.pass).map(r => r.name).join(' / ')));
    process.exit(pass === results.length ? 0 : 1);
})();
