// #568-B 에이전트 오피스 야간모드 — 최종발주 패널(.fo) 검증
//   ① 밝은 화면 무회귀: 전환 끈 상태에서 「HEAD 의 final-order.css 를 끼운 화면」과 「지금 파일」의 스크린샷이 픽셀 동일(PC·폰 · 주요 단계)
//   ② 어두운 화면: 글자 대비 자동 측정(본문 4.5:1 · 큰 글자 3:1) 미달 0 · 흰 바탕으로 남은 칸 목록(수량 표만 의도) · 폰 가로 넘침 0 · 화면 오류 0
//   ③ 결과물 무변경: 같은 가짜 자료로 야간모드 켠 채 만든 엑셀·수량 PNG = 끈 채 만든 것
//   주문·현금파일·메모 = 전부 가짜(scripts/fixtures-508.js) · 불러오기·AI·기록·주소 검색은 page.route 로 가짜 응답 · 단가표·달력만 실DB 읽기 · 실DB 쓰기 0
//   실행: node scripts/verify-568-fo-dark.js   (포트 3462 · setInterval 무력화) · 스크린샷 = SHOT_DIR(기본 임시폴더/verify568)
//   야간모드 켜짐 표시 = html[data-ao-theme="dark"] (ao-desk.js 가 붙인다 — 여기서는 속성을 직접 붙여 최종발주 쪽만 본다)
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn, execFileSync } = require('child_process');
const jwt = require('jsonwebtoken'); const XLSX = require('xlsx-js-style');
const FX = require('./fixtures-508.js');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 700) : '')); return !!c; };
const note = (t, d) => console.log('  ℹ️ ' + t + (d != null ? ' — ' + String(d).slice(0, 900) : ''));
const PORT = 3462, BASE = `http://localhost:${PORT}`, ROOT = path.join(__dirname, '..');
const USER = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' };
const TOKEN = jwt.sign(USER, 'verifytest', { expiresIn: '1h' });
const SHOT = process.env.SHOT_DIR || path.join(os.tmpdir(), 'verify568'); fs.mkdirSync(SHOT, { recursive: true });
const SEL = { btn: '#desk-final-now', panel: '#fo-panel', ship: '#fo-ship', cash: '#fo-cash', memo: '#fo-memo', start: '#fo-start', card: '#fo-cards [data-fo-card]', pending: '#fo-cards [data-fo-card]:not([data-fo-done])', make: '#fo-make', save: '[data-fo-save]', png: '[data-fo-png]' };
const ACT = { order: 'send', split: 'all', 'sender-memo': 'keep', line: 'ok', 'cash-boxdiff': 'ok', 'cash-notindiv': 'extra', 'cash-missing': 'skip', 'sender-line': 'skip' };
const HEAD_CSS = execFileSync('git', ['show', 'HEAD:public/final-order.css'], { cwd: ROOT, maxBuffer: 1 << 24 });
const HEAD_JS = execFileSync('git', ['show', 'HEAD:public/final-order.js'], { cwd: ROOT, maxBuffer: 1 << 24 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 두 스크린샷을 픽셀로 비교 — mask(전환 버튼 자리) 밖에서 다른 픽셀 수와 그 범위
async function pxDiff(br, a, b, mask) {
    const pg = await br.newPage();
    try { return await pg.evaluate(async ([A, B, m]) => { const ld = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; }); const [x, y] = [await ld(A), await ld(B)]; if (x.width !== y.width || x.height !== y.height) return { n: -1, size: [x.width, x.height, y.width, y.height] };
        const d = im => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; }; const p = d(x), q = d(y); let n = 0, inMask = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) { const px = (i / 4) % x.width, py = Math.floor(i / 4 / x.width); if (m && px >= m.x0 && px <= m.x1 && py >= m.y0 && py <= m.y1) { inMask++; continue; } n++; if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py; }
        return { n, inMask, box: n ? [x0, y0, x1, y1] : null }; }, [a.toString('base64'), b.toString('base64'), mask]); } finally { await pg.close(); }
}
const headRects = pg => pg.evaluate(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; }; return { close: r('#fo-close'), title: r('#fo-title'), sub: r('#fo-panel .fo-sub'), head: r('#fo-panel .fo-head'), body: r('#fo-panel .fo-body'), theme: r('#fo-theme') }; });
async function waitUp() { for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/public/version')).ok) return; } catch (_) { } await sleep(1000); } throw new Error('server not up'); }
const apiJ = async (url, method = 'GET', body) => (await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: body ? JSON.stringify(body) : undefined })).json();
const idle = async pg => { await pg.waitForTimeout(200); await pg.waitForFunction(sel => { const p = document.querySelector(sel); return p && !p.classList.contains('busy') && !(window.AkmFinalOrder && window.AkmFinalOrder.state.ai && window.AkmFinalOrder.state.ai.running); }, SEL.panel, { timeout: 120000 }); };

async function newCtx(br, fx, o) {
    const ctx = await br.newContext({ acceptDownloads: true, viewport: o.mobile ? { width: 390, height: 844 } : { width: 1400, height: 900 }, ...(o.mobile ? { isMobile: true, hasTouch: true } : {}), reducedMotion: 'reduce' });
    await ctx.addInitScript(([t, u, dark]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_ao_theme', dark ? 'dark' : 'light'); }, [TOKEN, USER, !!o.dark]);
    await ctx.addInitScript(() => { const add = () => { const s = document.createElement('style'); s.textContent = '.ao-settle-overlay{display:none!important}'; (document.head || document.documentElement).appendChild(s); }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); });
    // 밝은 화면 비교에서는 패널 뒤 화면(에이전트 오피스 본체 — 창구 상태·목록이 스스로 바뀜)을 가려 최종발주 패널만 비교한다
    if (o.hideBehind) await ctx.addInitScript(() => { const add = () => { const s = document.createElement('style'); s.textContent = 'body.fo-open > *:not(#fo-panel){visibility:hidden!important}'; (document.head || document.documentElement).appendChild(s); }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); });
    if (o.headCss) { await ctx.route('**/final-order.css*', r => r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: HEAD_CSS })); await ctx.route('**/final-order.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: HEAD_JS })); }   // 고치기 전 = css·js 둘 다 HEAD
    const reply = body => r => r.fulfill({ json: body });
    await ctx.route('**/api/agent-office/naver/invoice-orders-v2*', reply({ ok: true, count: fx.naver.length, rows: fx.naver, partial_adjusted: 0 }));
    await ctx.route('**/api/agent-office/cafe24/invoice-orders*', reply({ ok: true, count: fx.cafe24.length, rows: fx.cafe24 }));
    await ctx.route('**/api/agent-office/coupang/invoice-orders*', reply({ ok: true, count: fx.coupang.length, rows: fx.coupang }));
    await ctx.route('**/api/agent-office/coupang/canceled-since*', reply({ ok: true, canceled: fx.canceledCoupang }));
    await ctx.route('**/api/agent-office/final-order/log', reply({ ok: true, id: 7001 }));
    await ctx.route('**/api/agent-office/juso*', reply({ results: { common: { errorCode: '0', errorMessage: '정상', totalCount: '0' }, juso: [] } }));
    // AI 읽기(자동)는 「못 올림」 · 대화는 가짜 창구가 글만 돌려준다(고치는 일 없음)
    await ctx.route('**/api/agent-office/final-order/memo-read', r => { if (r.request().method() !== 'POST') return r.continue(); const b = r.request().postDataJSON(); if (b.kind === 'chat') return r.fulfill({ json: { ok: true, id: 9100 } }); r.fulfill({ json: { ok: false, message: '시험에서는 AI를 부르지 않아요' } }); });
    await ctx.route('**/api/agent-office/final-order/memo-read/9100', r => r.request().method() === 'DELETE' ? r.fulfill({ json: { ok: true } }) : r.fulfill({ json: { ok: true, state: 'done', status: '완료', data: { reply: '지금 주문 목록을 봤어요. 말씀하신 손님은 받는05 한 건이고, 배송메세지는 「문앞에 놔주세요」 그대로예요. 고칠 것이 있으면 이어서 말씀해 주세요.', actions: [] }, message: '' } }));
    return ctx;
}
const setTheme = (pg, dark) => pg.evaluate(d => { if (d) document.documentElement.setAttribute('data-ao-theme', 'dark'); else document.documentElement.removeAttribute('data-ao-theme'); }, dark);
const shot = async (pg, name, save) => { await pg.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }); await pg.waitForTimeout(250); await pg.evaluate(() => document.fonts && document.fonts.ready); let b = await pg.screenshot({ animations: 'disabled', caret: 'hide' }); for (let i = 0; i < 6; i++) { await pg.waitForTimeout(350); const b2 = await pg.screenshot({ animations: 'disabled', caret: 'hide' }); if (b2.equals(b)) break; b = b2; }   /* 두 번 연속 같은 그림이 나올 때까지(글꼴·늦게 그려지는 것 대기) */ if (save) fs.writeFileSync(path.join(SHOT, name + '.png'), b); return b; };
const bodyTo = (pg, where) => pg.evaluate(w => { const b = document.querySelector('#fo-panel .fo-body'); b.scrollTop = w === 'end' ? b.scrollHeight : w === 'mid' ? Math.round((b.scrollHeight - b.clientHeight) / 2) : 0; }, where);

// 화면 안에서 도는 대비 측정 — 글자가 있는 보이는 요소 전부(패널 안). 꺼진 버튼·흐리게 한 칸(opacity<1)은 세기만 한다.
const AUDIT = () => {
    const P = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return { r: 0, g: 0, b: 0, a: 0 }; const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
    const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
    const L = c => .2126 * lin(c.r) + .7152 * lin(c.g) + .0722 * lin(c.b);
    const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
    const bgOf = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = P(getComputedStyle(e).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let base = { r: 14, g: 17, b: 34, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };
    const faded = el => { for (let e = el; e && e.id !== 'fo-panel'; e = e.parentElement) if (parseFloat(getComputedStyle(e).opacity) < 1) return true; return false; };
    const name = el => { const c = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.'); const p = el.parentElement; const pc = p && typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : ''; return (pc ? '.' + pc + ' > ' : '') + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (c ? '.' + c : '') + ([...el.attributes].filter(a => /^data-(k|state)$/.test(a.name)).map(a => `[${a.name}=${a.value}]`).join('')); };
    const hex = c => '#' + [c.r, c.g, c.b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
    const panel = document.getElementById('fo-panel'); const out = { n: 0, skipped: 0, bad: [], light: {}, min: 99 };
    const check = (el, colorStr, what) => {
        const cs = getComputedStyle(el); const fg0 = P(colorStr); const bg = bgOf(el); const fg = over(fg0, bg);
        const a = L(fg), b = L(bg); const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        const fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight, 10) || 400; const big = fs >= 24 || (fs >= 18.66 && fw >= 700); const need = big ? 3 : 4.5;
        out.n++; if (ratio < out.min) out.min = ratio;
        if (ratio < need) out.bad.push(`${name(el)}${what ? ' ' + what : ''} ${ratio.toFixed(2)}:1 (글자 ${hex(fg)} · 바탕 ${hex(bg)} · ${fs}px/${fw}) 「${(el.value || el.textContent || '').trim().slice(0, 18)}」`);
    };
    for (const el of panel.querySelectorAll('*')) {
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (el.closest('[hidden]')) continue;
        const own = P(cs.backgroundColor); if (own.a >= 1 && L(own) > .6) { const k = el.closest('.fo-qty') ? '수량 표(.fo-qty) 안' : name(el); out.light[k] = (out.light[k] || 0) + 1; }
        const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
        const hasText = isField ? (el.type !== 'file' && el.type !== 'checkbox') : [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
        if (!hasText) continue;
        if (el.disabled || el.closest(':disabled') || faded(el)) { out.skipped++; continue; }
        check(el, cs.color, '');
        if (isField && el.placeholder && !el.value) check(el, getComputedStyle(el, '::placeholder').color, '(안내 글)');
    }
    out.min = +out.min.toFixed(2); return out;
};
// 실제 흐름으로 못 가는 상태를 견본으로 끼워 넣어(어두운 화면 측정 전용) 색 규칙을 전부 밟는다
const SPECIMEN = () => {
    const body = document.querySelector('#fo-panel .fo-body'); const d = document.createElement('section'); d.className = 'fo-sec'; d.id = 'fo-specimen';
    d.innerHTML = `<h3>견본 <b>12</b> <small>측정용</small></h3>
      <ul class="fo-ch"><li data-k="work"><b>네이버</b><span>불러오는 중</span></li><li data-k="done"><b>자사몰</b><span>2건</span></li><li data-k="err"><b>쿠팡</b><span>불러오지 못했어요</span></li><li><b>대기</b><span>아직</span></li></ul>
      <p class="fo-empty">확인할 카드가 없어요</p><p class="fo-hint err">오류 안내 글</p><span class="fo-msg err">오류 메시지</span><span class="fo-wait">기다리는 중</span><span class="fo-done">처리했어요</span>
      <div class="fo-ai"><button class="fo-btn sm">AI 다시 읽기</button><span class="fo-msg">AI가 메모를 읽고 있어요</span></div>
      <div class="fo-kinds"><button class="fo-kind">전체 9</button><button class="fo-kind on">주문 확인 3</button></div>
      <div class="fo-card" data-state="open"><div class="fo-card-top"><span class="fo-tag">주문 확인</span><span class="fo-tag" data-k="cash">현금파일</span><span class="fo-tag" data-k="pick">거래처</span><span class="fo-aibadge">AI가 정함</span><span class="fo-chatbadge">대화로 바꿈</span><b>견본 카드</b></div><div class="fo-card-body"><div class="fo-line"><span>배송메세지</span><p>10일 발송 부탁드려요</p></div></div><div class="fo-edit"><label>이름<input type="text" value="홍길동"></label><label class="wide">메모<textarea>문 앞</textarea></label></div><div class="fo-card-acts"><button class="fo-btn sm primary">오늘 발송</button><button class="fo-btn sm">제외</button><button class="fo-btn sm" disabled>꺼짐</button><label class="fo-pick">거래처 <select><option>효돈농협</option></select></label></div></div>
      <div class="fo-card" data-state="done"><div class="fo-card-top"><span class="fo-tag">주문 확인</span><b>끝난 카드</b></div><div class="fo-card-acts"><span class="fo-done">오늘 발송으로 정했어요</span><button class="fo-btn sm">바꾸기</button></div></div>
      <div class="fo-thread"><div class="fo-bub me"><p>그 손님 주소 바꿔줘</p></div><div class="fo-bub ai"><div class="fo-a has-acts"><span class="fo-a-label">클코 답변</span><p>이렇게 바꿀게요</p><ul class="fo-a-list"><li>받는05 주소 → 새주소로 12</li><li class="bad">받는06 은 못 찾았어요</li></ul><div class="fo-addr"><span class="fo-addr-ok">도로명 주소 확인됨</span><span class="fo-addr-note">후보가 여러 개예요</span><div class="fo-addr-opts"><button class="fo-btn sm fo-addr-opt on">서울 가짜로 1</button><button class="fo-btn sm fo-addr-opt">서울 가짜로 2</button></div></div></div><div class="fo-a-acts"><button class="fo-btn sm primary">적용</button><button class="fo-btn sm">취소</button><span class="fo-done">적용했어요</span></div></div><div class="fo-bub ai live"><div class="fo-a"><span class="fo-a-label">클코 답변</span><p>읽는 중 12초</p></div></div></div>
      <div class="fo-patches"><b>말로 바꾼 것 2건</b><ul><li><span>받는05 주소 → 새주소로 12</span><button class="fo-btn sm">되돌리기</button></li></ul></div><div class="fo-patched"><b>적용됨</b><ul><li>받는07 수량 2 → 3</li></ul></div>
      <p class="fo-jeju">제주도 배송 <b>2</b>건</p>
      <div class="fo-acts"><button class="fo-btn fo-reset">초기화</button></div><div class="fo-reset-confirm"><p><b>전부 지우고 처음부터 할까요?</b></p><div class="fo-acts"><button class="fo-btn fo-reset solid">초기화</button><button class="fo-btn">취소</button></div></div>
      <div class="fo-ed"><div class="fo-gut"><div class="m ok"><span>✓ 확인완료 1건</span></div><div class="m warn cur"><span>⚠ 확인 필요</span></div><div class="m none"><span>✕ 주문 없음</span></div></div><textarea rows="3">줄1\n줄2\n줄3</textarea></div><div class="fo-linebar"><button class="ok">✓ 1</button><button class="warn">⚠ 1</button><button class="none">✕ 1</button></div>
      <button class="fo-icon" aria-label="첨부">＋</button><button class="fo-icon primary" aria-label="보내기">↑</button>`;
    body.appendChild(d);
};

// 한 번의 흐름: 열기 → 메모·현금파일 → 시작(카드) → 대화 1회 → 카드 전부 처리 → 파일 만들기. 단계마다 at(이름) 을 부른다.
async function flow(br, fx, cashFile, o, at) {
    const ctx = await newCtx(br, fx, o); const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR|Failed to load resource/.test(m.text())) errs.push(m.text()); }); pg.on('dialog', d => d.accept());
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500); await pg.evaluate(() => switchPage('agent-office')); await pg.waitForTimeout(1000);
    await setTheme(pg, !!o.dark);
    await pg.evaluate(sel => document.querySelector(sel).scrollIntoView(), SEL.btn); await pg.click(SEL.btn); await pg.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
    await pg.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await idle(pg);
    await setTheme(pg, !!o.dark);   // 다른 코드가 속성을 건드렸더라도 이 시험이 보려는 상태로 다시 맞춘다
    await at('1-열림', pg);
    await pg.fill(SEL.memo, fx.memo); await pg.setInputFiles(SEL.cash, cashFile); await pg.waitForTimeout(400); await at('2-입력', pg);
    await pg.click(SEL.start); await idle(pg); await pg.waitForSelector(SEL.card, { timeout: 20000 }); await pg.waitForTimeout(400); await setTheme(pg, !!o.dark);
    await bodyTo(pg, 'top'); await at('3-카드-위', pg); await bodyTo(pg, 'mid'); await at('3-카드-가운데', pg);
    // 대화 1회(가짜 창구 — 글만)
    await pg.evaluate(() => document.getElementById('fo-chat-input').scrollIntoView({ block: 'center' })); await pg.fill('#fo-chat-input', '받는05 손님 메모 뭐였지?'); await pg.click('#fo-chat-send');
    await pg.waitForFunction(() => { const s = window.AkmFinalOrder.state; return !s.chat.running && !s.busy && document.querySelectorAll('#fo-chat-log .fo-bub.ai').length > 0; }, null, { timeout: 60000 }); await pg.waitForTimeout(300);
    await pg.evaluate(() => document.getElementById('fo-chat-log').scrollIntoView({ block: 'center' })); await at('4-대화', pg);
    // 카드 전부 처리
    for (const [type, act] of Object.entries(ACT)) for (let g = 0; g < 80; g++) { const b = pg.locator(`${SEL.pending}[data-fo-card="${type}"] [data-fo-act="${act}"]`).first(); if (!(await b.count())) break; await b.click(); await pg.waitForTimeout(100); }
    for (let g = 0; g < 80; g++) { const c = pg.locator(SEL.pending).first(); if (!(await c.count())) break; const b = c.locator('[data-fo-act]:not([disabled])').first(); if (!(await b.count())) break; await b.click(); await pg.waitForTimeout(100); }
    const left = await pg.locator(SEL.pending).count(); await bodyTo(pg, 'mid'); await at('5-카드처리', pg);
    let made = false;
    if (!left && !(await pg.isDisabled(SEL.make))) { await pg.click(SEL.make); await idle(pg); await pg.waitForSelector(SEL.save, { timeout: 20000 }); await pg.waitForTimeout(600); made = true; await pg.evaluate(() => document.getElementById('fo-result').scrollIntoView({ block: 'start' })); await pg.waitForTimeout(300); await at('6-결과', pg); await bodyTo(pg, 'end'); await at('6-결과-끝', pg); }
    return { ctx, pg, errs, left, made };
}
// 결과물 받기: 엑셀(전부) + 수량 PNG(전부)
async function grab(pg, dir) {
    fs.mkdirSync(dir, { recursive: true }); const out = { xlsx: {}, png: {} };
    const nS = await pg.locator(SEL.save).count(); for (let i = 0; i < nS; i++) { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 20000 }), pg.locator(SEL.save).nth(i).click()]); const f = path.join(dir, 'x' + i + '.xlsx'); await d.saveAs(f); out.xlsx[d.suggestedFilename()] = f; await pg.waitForTimeout(150); }
    const nP = await pg.locator(SEL.png).count(); for (let i = 0; i < nP; i++) { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 20000 }), pg.locator(SEL.png).nth(i).click()]); const f = path.join(dir, 'q' + i + '.png'); await d.saveAs(f); out.png[d.suggestedFilename()] = f; await pg.waitForTimeout(150); }
    return out;
}
// 엑셀 내용(값·종류·칸 색·글꼴·테두리 · 열 너비 · 병합) — 파일 안의 만든 시각 같은 것은 빼고 비교
const sheetDump = f => { const wb = XLSX.readFile(f, { cellStyles: true }); return JSON.stringify(wb.SheetNames.map(n => { const ws = wb.Sheets[n]; const cells = {}; for (const k of Object.keys(ws)) { if (k[0] === '!') continue; const c = ws[k]; cells[k] = [c.t, c.v, c.s || null]; } return [n, ws['!ref'], ws['!cols'] || null, ws['!merges'] || null, cells]; })); };

(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', () => { }); let tail = ''; srv.stderr.on('data', d => { tail = (tail + d).slice(-600); });
    let br, code = 1;
    try {
        await waitUp();
        const cat = await apiJ('/api/invoice/catalog'); const mp = await apiJ('/api/agent-office/invoice/memo-parse', 'POST', { memos: [] });
        const ship = mp.suggested, later = (mp.shipDays || []).find(d => d > ship); if (!ship || !later) throw new Error('발송일 달력을 못 읽었습니다');
        const fx = FX.build({ byPartner: cat.byPartner || {}, ship, later, realToday: mp.realToday, noShip: mp.noShip || [] });
        const cashFile = path.join(SHOT, '가짜_현금파일.xlsx'); { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fx.cashAoa), 'Sheet1'); XLSX.writeFile(wb, cashFile); }
        const { chromium } = require('playwright'); br = await chromium.launch();
        const cssNow = fs.readFileSync(path.join(ROOT, 'public/final-order.css'), 'utf8'), cssHead = HEAD_CSS.toString('utf8');

        console.log('\n⓪ 파일 자체 — 추가만 했는지');
        ok(cssNow.startsWith(cssHead.replace(/\r\n/g, '\n')) || cssNow.replace(/\r\n/g, '\n').startsWith(cssHead.replace(/\r\n/g, '\n')), '⓪ final-order.css = HEAD 내용 그대로 + 뒤에 덧붙임(기존 줄 무수정)', `HEAD ${cssHead.length}자 → 지금 ${cssNow.length}자`);
        const added = cssNow.replace(/\r\n/g, '\n').slice(cssHead.replace(/\r\n/g, '\n').length);
        const rules = added.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(s => s.trim()).filter(Boolean).map(s => s.replace(/^@media[^{]*\{\s*/, '').split('{')[0].trim()).filter(Boolean);
        // 켜짐 표시 밖 규칙은 새 요소(패널 안 전환 버튼 .fo-theme)뿐이어야 한다
        const loose = rules.filter(sel => !sel.split(',').every(p => p.trim().startsWith('html[data-ao-theme="dark"] ') || /^\.fo-theme\b/.test(p.trim())));
        const btnRules = rules.filter(sel => /^\.fo-theme\b/.test(sel));
        ok(rules.length > 30 && loose.length === 0, `⓪ 덧붙인 규칙 ${rules.length}개 = html[data-ao-theme="dark"] 아래 ${rules.length - btnRules.length}개 + 새 버튼(.fo-theme) ${btnRules.length}개`, loose.slice(0, 3).join(' | ') || '그 밖 규칙 없음');
        let jsSame = true; try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'public/final-order-core.js', 'public/invoice-v2.html', 'public/invoice-v2.js'], { cwd: ROOT }); } catch (_) { jsSame = false; }
        ok(jsSame, '⓪ final-order-core.js · invoice-v2.html/js 는 HEAD 와 같음(무수정)');
        const jd = execFileSync('git', ['diff', '-U0', 'HEAD', '--', 'public/final-order.js'], { cwd: ROOT, maxBuffer: 1 << 24 }).toString('utf8').split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
        ok(jd.length === 2 && jd.every(l => l[0] === '+' && l.includes('fo-theme')), '⓪ final-order.js 변경 = 추가 2줄뿐(전환 버튼 마크업 1 · 클릭 연결 1) · 지운 줄 0', jd.map(l => l.slice(0, 70)).join(' ‖ '));

        // ① 밝은 화면 무회귀 — HEAD css vs 지금 css (전환 끔)
        for (const mobile of [false, true]) {
            const dev = mobile ? '폰' : 'PC'; console.log(`\n① 밝은 화면 무회귀(${dev}) — HEAD 의 css 를 끼운 화면 vs 지금 파일`);
            const A = {}, B = {}; let rA = null, rB = null;
            const a = await flow(br, fx, cashFile, { mobile, headCss: true, dark: false, hideBehind: true }, async (n, pg) => { A[n] = await shot(pg, `light-head-${dev}-${n}`, false); if (!rA) rA = await headRects(pg); }); await a.ctx.close();
            const b = await flow(br, fx, cashFile, { mobile, headCss: false, dark: false, hideBehind: true }, async (n, pg) => { B[n] = await shot(pg, `light-now-${dev}-${n}`, n === '1-열림'); if (!rB) rB = await headRects(pg); });
            // 예외 = 패널 안 전환 버튼 자리(바깥으로 4px — 포커스 고리·가장자리 번짐 포함). 그 밖은 한 픽셀도 달라지면 안 된다
            const t = rB.theme; const mask = t ? { x0: Math.floor(t[0]) - 4, y0: Math.floor(t[1]) - 4, x1: Math.ceil(t[0] + t[2]) + 4, y1: Math.ceil(t[1] + t[3]) + 4 } : null;
            const names = Object.keys(A); const diff = []; let inMask = 0;
            for (const n of names) { if (!B[n]) { diff.push(n + '(없음)'); continue; } if (A[n].equals(B[n])) continue; const d = await pxDiff(br, A[n], B[n], mask); inMask += d.inMask || 0; if (d.n) { diff.push(`${n}(${d.n}px · ${JSON.stringify(d.box || d.size)})`); fs.writeFileSync(path.join(SHOT, `DIFF-head-${dev}-${n}.png`), A[n]); fs.writeFileSync(path.join(SHOT, `DIFF-now-${dev}-${n}.png`), B[n]); } }
            ok(names.length >= 8 && diff.length === 0 && a.made && b.made, `① ${dev}: 스크린샷 ${names.length}장 — 전환 버튼 자리 밖은 전부 픽셀 동일`, diff.length ? '다른 장면: ' + diff.join(', ') : `버튼 자리 ${JSON.stringify(mask)} 안에서만 ${inMask}px 다름`);
            // PC = 「닫기」 왼쪽 40px · 좁은 폰(480px 이하) = 「닫기」 바로 아래 32px(누르는 자리 44px) — 줄 안에 두면 설명 글이 한 줄 더 내려가 화면이 밀리기 때문
            const hit = await b.pg.evaluate(() => { const e = document.getElementById('fo-theme'), r = e.getBoundingClientRect(), a = getComputedStyle(e, '::after'); if (a.content === 'none') return [r.width, r.height]; const p = k => parseFloat(a[k]) || 0; return [r.width - p('left') - p('right'), r.height - p('top') - p('bottom')]; });
            const place = mobile ? (t && Math.abs(t[2] - 32) < .6 && t[1] >= rB.close[1] + rB.close[3] && t[1] + t[3] <= rB.head[1] + rB.head[3] && t[0] >= rB.sub[0] + rB.sub[2] && hit[0] >= 44 && hit[1] >= 44)
                : (t && Math.abs(t[2] - 40) < .6 && Math.abs(t[3] - 40) < .6 && t[0] + t[2] <= rB.close[0] - 8);
            ok(rA.theme === null && place, mobile ? '① 폰: 전환 버튼 = 「닫기」 바로 아래 32px(누르는 자리 44px 이상) · 머리 칸 안 · 설명 글과 안 겹침' : '① PC: 전환 버튼 = 「닫기」 왼쪽 · 40px 둥근 버튼', `버튼 ${JSON.stringify(t)} · 누르는 자리 ${JSON.stringify(hit)} · 닫기 ${JSON.stringify(rB.close)} · 머리 ${JSON.stringify(rB.head)}`);
            const same = k => JSON.stringify(rA[k]) === JSON.stringify(rB[k]);
            ok(same('close') && same('title') && same('sub') && same('head') && same('body'), `① ${dev}: 버튼이 생겨도 옆 요소(제목·설명·닫기·머리 높이·본문 시작)가 안 밀림`, ['close', 'title', 'sub', 'head', 'body'].filter(k => !same(k)).map(k => `${k} ${JSON.stringify(rA[k])} → ${JSON.stringify(rB[k])}`).join(' ‖ ') || '자리·크기 전부 같음');
            const attr = await b.pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme')); ok(attr !== 'dark', `① ${dev}: 전환 끈 상태 = 켜짐 표시 없음`, String(attr));
            ok(a.errs.length === 0 && b.errs.length === 0, `① ${dev}: 화면 오류 0`, [...a.errs, ...b.errs].join(' | ') || '없음');
            if (!mobile) { globalThis.__lightOut = await grab(b.pg, path.join(SHOT, 'out-light')); }
            await b.ctx.close();
        }

        // ② 어두운 화면 — 대비 · 흰 바탕 · 넘침 · 오류
        const lightAll = {};
        for (const mobile of [false, true]) {
            const dev = mobile ? '폰' : 'PC'; console.log(`\n② 어두운 화면(${dev})`);
            const bads = [], mins = []; let nText = 0, skipped = 0, wide = [];
            const d = await flow(br, fx, cashFile, { mobile, dark: true }, async (n, pg) => {
                await shot(pg, `dark-${dev}-${n}`, true);
                const r = await pg.evaluate(AUDIT); nText += r.n; skipped += r.skipped; mins.push(r.min); r.bad.forEach(x => bads.push(`[${n}] ${x}`)); Object.entries(r.light).forEach(([k, v]) => { lightAll[k] = Math.max(lightAll[k] || 0, v); });
                if (mobile) { const w = await pg.evaluate(() => { const p = document.getElementById('fo-panel'); const over = [...p.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('.table-scroll-wrapper, [data-fo-scroll], .fo-ed, .fo-thread, textarea')).length; return { doc: document.documentElement.scrollWidth, panel: p.scrollWidth, inner: window.innerWidth, over }; }); if (w.doc > w.inner + 1 || w.panel > w.inner + 1 || w.over) wide.push(`[${n}] ${JSON.stringify(w)}`); }
            });
            const st = await d.pg.evaluate(() => { const g = s => getComputedStyle(document.querySelector(s)); return { attr: document.documentElement.getAttribute('data-ao-theme'), box: g('#fo-panel .fo-box').backgroundColor, ink: g('#fo-panel').color, scheme: g('#fo-panel').colorScheme }; });
            ok(st.attr === 'dark' && st.box !== 'rgb(255, 255, 255)', `② ${dev}: 켜짐 표시 있음 · 패널 바탕이 어두움`, JSON.stringify(st));
            ok(d.made && d.left === 0, `② ${dev}: 어두운 화면에서도 끝(파일 만들기)까지 감`, `남은 카드 ${d.left}`);
            ok(bads.length === 0, `② ${dev}: 글자 대비 미달 0 (측정 ${nText}곳 · 가장 낮은 값 ${Math.min(...mins)}:1 · 꺼진·흐린 칸 ${skipped}곳은 제외)`, bads.slice(0, 12).join(' ‖ ') || '없음');
            // 견본(흐름으로 못 가는 상태) — 색 규칙 전부 밟기
            await d.pg.evaluate(SPECIMEN); await d.pg.evaluate(() => document.getElementById('fo-specimen').scrollIntoView({ block: 'start' })); await d.pg.waitForTimeout(300); await shot(d.pg, `dark-${dev}-7-견본`, true);
            const sp = await d.pg.evaluate(AUDIT); Object.entries(sp.light).forEach(([k, v]) => { lightAll[k] = Math.max(lightAll[k] || 0, v); });
            ok(sp.bad.length === 0, `② ${dev}: 견본(오류·불러오는 중·AI 배지·대화 답·말로 바꾼 것·주소 확인·초기화 확인·줄별 표시) 대비 미달 0 (측정 ${sp.n}곳 · 가장 낮은 값 ${sp.min}:1)`, sp.bad.slice(0, 12).join(' ‖ ') || '없음');
            // 뜻이 있는 색이 서로 구분되는지(줄별 표시 ✓/⚠/✕)
            const sem = await d.pg.evaluate(() => { const c = s => getComputedStyle(document.querySelector('#fo-specimen ' + s)).color; return { ok: c('.fo-gut .m.ok span'), warn: c('.fo-gut .m.warn span'), none: c('.fo-gut .m.none span') }; });
            const hue = s => { const [r, g, b] = s.match(/\d+/g).map(Number).map(x => x / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn; let h = 0; if (dl) h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4; return Math.round(((h * 60) + 360) % 360); };
            const H = { ok: hue(sem.ok), warn: hue(sem.warn), none: hue(sem.none) };
            ok(H.ok > 120 && H.ok < 175 && H.warn > 30 && H.warn < 60 && (H.none < 20 || H.none > 345), `② ${dev}: 줄별 표시 색 = 초록·노랑·빨강 그대로(색상 각도)`, JSON.stringify(H));
            if (mobile) ok(wide.length === 0, '② 폰: 가로 넘침 0(전 단계)', wide.join(' ‖ ') || '없음');
            {   // 패널 안 전환 버튼: 누르면 꺼지고 다시 누르면 켜짐(본체와 같은 AkmAoTheme) · 해/달 아이콘 · AkmAoTheme 이 없어도 오류 없음
                const st0 = () => d.pg.evaluate(() => ({ attr: document.documentElement.getAttribute('data-ao-theme'), api: !!(window.AkmAoTheme && window.AkmAoTheme.toggle), isDark: window.AkmAoTheme ? window.AkmAoTheme.isDark() : null, moon: /M21 12\.8A9/.test(getComputedStyle(document.getElementById('fo-theme')).getPropertyValue('--fo-theme-icon')) ? 'block' : 'none', sun: /circle/.test(getComputedStyle(document.getElementById('fo-theme')).getPropertyValue('--fo-theme-icon')) ? 'block' : 'none', mem: localStorage.getItem('akm_ao_theme'), panel: !document.getElementById('fo-panel').hidden }));
                await d.pg.evaluate(() => document.querySelector('#fo-panel .fo-body').scrollTo(0, 0));
                const s0 = await st0(); await d.pg.click('#fo-theme'); await d.pg.waitForTimeout(200); const s1 = await st0(); await d.pg.click('#fo-theme'); await d.pg.waitForTimeout(200); const s2 = await st0();
                if (s0.api) ok(s0.attr === 'dark' && s0.sun === 'block' && s0.moon === 'none' && s1.attr === null && s1.moon === 'block' && s1.sun === 'none' && s1.mem === 'light' && s1.panel && s2.attr === 'dark' && s2.mem === 'dark' && s2.panel, `② ${dev}: 패널 안 전환 버튼 — 누르면 밝게(달 아이콘 · 기억 light) → 다시 누르면 어둡게(해 아이콘 · 기억 dark) · 패널은 열린 채`, JSON.stringify([s0, s1, s2]).slice(0, 400));
                else note(`② ${dev}: AkmAoTheme 이 아직 없음(ao-desk.js 미반영) — 전환 동작은 건너뜀`, JSON.stringify(s0));
                const e0 = d.errs.length; const noApi = await d.pg.evaluate(() => { const keep = window.AkmAoTheme; try { delete window.AkmAoTheme; } catch (_) { window.AkmAoTheme = undefined; } document.getElementById('fo-theme').click(); const a = document.documentElement.getAttribute('data-ao-theme'); window.AkmAoTheme = keep; return a; }); await d.pg.waitForTimeout(150);
                ok(d.errs.length === e0 && noApi === 'dark', `② ${dev}: AkmAoTheme 이 없을 때 눌러도 오류 0 · 아무 일도 안 함`, `오류 ${d.errs.length - e0} · 속성 ${noApi}`);
                await setTheme(d.pg, true);
            }
            ok(d.errs.length === 0, `② ${dev}: 화면 오류 0`, d.errs.join(' | ') || '없음');
            if (!mobile) {
                await d.pg.evaluate(() => document.getElementById('fo-specimen').remove());
                // ③ 결과물 무변경
                console.log('\n③ 결과물 무변경 — 야간모드 켠 채 만든 엑셀·수량 PNG vs 끈 채 만든 것');
                const dk = await grab(d.pg, path.join(SHOT, 'out-dark')), lt = globalThis.__lightOut;
                const xn = Object.keys(lt.xlsx), pn = Object.keys(lt.png);
                ok(xn.length >= 2 && JSON.stringify(xn) === JSON.stringify(Object.keys(dk.xlsx)) && pn.length >= 2 && JSON.stringify(pn) === JSON.stringify(Object.keys(dk.png)), '③ 파일 이름·개수 동일', `엑셀 ${xn.length} · PNG ${pn.length} — ${[...xn, ...pn].join(' · ')}`);
                const xd = xn.filter(n => sheetDump(lt.xlsx[n]) !== sheetDump(dk.xlsx[n])); const xb = xn.filter(n => !fs.readFileSync(lt.xlsx[n]).equals(fs.readFileSync(dk.xlsx[n])));
                ok(xd.length === 0, '③ 엑셀: 칸 값·칸 색·글꼴·테두리·열 너비·병합 전부 동일', xd.join(', ') || `${xn.length}개 동일 (파일 바이트까지 같은 것 ${xn.length - xb.length}개)`);
                const pd = pn.filter(n => !fs.readFileSync(lt.png[n]).equals(fs.readFileSync(dk.png[n])));
                ok(pd.length === 0, '③ 수량 PNG: 바이트 동일(= 픽셀 동일)', pd.join(', ') || pn.map(n => `${n} ${fs.statSync(lt.png[n]).size}b`).join(' · '));
                // 화면의 수량 표는 흰 종이 표 그대로인지
                const q = await d.pg.evaluate(() => { const t = document.querySelector('#fo-result .fo-qty'); if (!t) return null; const td = t.querySelector('td'); return { color: getComputedStyle(t).color, first: getComputedStyle(td).backgroundColor, inline: td.getAttribute('style') }; });
                ok(q && q.color === 'rgb(0, 0, 0)' && /background:#[0-9A-Fa-f]{6}/.test(q.inline || ''), '③ 화면 수량 표: 검은 글자 + 품목 칸 거래처 색(인라인) 그대로', JSON.stringify(q));
            }
            await d.ctx.close();
        }
        const lk = Object.keys(lightAll); const unexpected = lk.filter(k => k !== '수량 표(.fo-qty) 안');
        note('흰(밝은) 바탕으로 남은 칸', lk.map(k => `${k} ×${lightAll[k]}`).join(' ‖ ') || '없음');
        ok(unexpected.length === 0, '② 밝은 바탕으로 남은 칸 = 수량 표(의도한 흰 종이 표)뿐', unexpected.join(' ‖ ') || '그 밖 없음');
        note('스크린샷 폴더', SHOT);
        code = fail ? 1 : 0;
    } catch (e) { console.error('ERR', e && e.stack || e, '\n서버 끝부분:', tail); code = 2; }
    finally { try { if (br) await br.close(); } catch (_) { } srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(code);
})();
