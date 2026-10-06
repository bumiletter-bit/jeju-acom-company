// #508 화면 검증: 에이전트 오피스 [최종발주] — 로컬 실서버 + Playwright 실클릭 + 받은 파일을 node로 다시 열어 검사
//   설계서 = docs/superpowers/specs/2026-10-04-final-order-design.md (§4-1 조종 순서 · §6 카드 · §7 결과물 · §9 화면 id)
//   주문·현금파일·메모 = 전부 가짜(scripts/fixtures-508.js) · 불러오기 API 3종과 쿠팡 취소 재확인은 page.route 로 가짜 응답 · 단가표·달력은 실DB(읽기)
//   실행: node scripts/verify-508-ui.js   (포트 3458 · JWT_SECRET=verifytest · setInterval 무력화 — 실DB 쓰기 0)
//   순서: ⓪ 가짜 재료 자체 점검(송장변환 v2 단독) → ① 버튼·패널·시작 조건 → ② 불러오기 → ③ 카드 → ⑥ 다시 판정 → ④ 파일 → ⑤ 무회귀·390px
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn } = require('child_process');
const jwt = require('jsonwebtoken'); const XLSX = require('xlsx-js-style');
const FX = require('./fixtures-508.js');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 300) : '')); return !!c; };
const note = (t, d) => console.log('  ℹ️ ' + t + (d != null ? ' — ' + String(d).slice(0, 400) : ''));
const PORT = 3458, BASE = `http://localhost:${PORT}`;
// 검사가 길어져(10분 넘음) 둘로 나눠 돌릴 수 있게: node scripts/verify-508-ui.js A = ⓪~⑭ · B = ⓪ + ⑮~ · 인자 없으면 전부
const PART = (process.argv[2] || '').toUpperCase();
const USER = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' };
const TOKEN = jwt.sign(USER, 'verifytest', { expiresIn: '1h' });
const TMP = path.join(os.tmpdir(), 'verify508ui'); fs.mkdirSync(TMP, { recursive: true });
const fillOf = c => c && c.s && ((c.s.fgColor && c.s.fgColor.rgb) || (c.s.fill && c.s.fill.fgColor && c.s.fill.fgColor.rgb)) || null;
const V2_HDR27 = ['상품주문번호', '배송방법(구매자 요청)', '배송방법', '택배사', '송장번호', '구매자명', '수취인명', '옵션정보', '수량', '수취인연락처1', '수취인연락처2', '통합배송지', '배송메세지', '구매자연락처', '주문번호', '발송일', '주문상태', '결제일', '상품번호', '상품명', '정산예정금액', '주문일시', '발송기한', '구매자ID', '고객 등급', '1년 주문건수', '주문 유입경로'];

// ── 화면 약속(설계서 §9 + 카드 표식) — 화면 쪽과 다르면 여기만 고친다 ─────────────────────────────
const SEL = {
    btn: '#desk-final-now', panel: '#fo-panel', ship: '#fo-ship', cash: '#fo-cash', cashNone: '#fo-cash-none', memo: '#fo-memo', start: '#fo-start',
    progress: '#fo-progress', cards: '#fo-cards', rejudge: '#fo-rejudge', make: '#fo-make', sum: '#fo-sum', result: '#fo-result', save: '[data-fo-save]', saveAll: '#fo-save-all', png: '[data-fo-png]',
    card: '#fo-cards [data-fo-card]',                              // 카드 1장 = data-fo-card="종류"
    pending: '#fo-cards [data-fo-card]:not([data-fo-done])',       // 처리 끝난 카드 = data-fo-done 속성
    hidden: '#fo-frame',                                           // 최종발주가 만든 숨은 iframe(/invoice-v2.html?fo=1 · display:none)
};
// 카드 종류(data-fo-card 값) → 이 검증이 누를 버튼(data-fo-act 값)
const CARD = { order: 'order', split: 'split', senderMemo: 'sender-memo', senderLine: 'sender-line', line: 'line', cashMissing: 'cash-missing', cashNotIndiv: 'cash-notindiv', cashBoxDiff: 'cash-boxdiff', cashFormat: 'cash-format', partner: 'partner' };
const ACT = { [CARD.order]: 'send', [CARD.split]: 'all', [CARD.senderMemo]: 'keep', [CARD.line]: 'ok', [CARD.cashBoxDiff]: 'ok', [CARD.cashNotIndiv]: 'extra', [CARD.cashMissing]: 'skip', [CARD.senderLine]: 'skip' };

async function waitUp() { for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/public/version')).ok) return; } catch (_) { } await new Promise(r => setTimeout(r, 1000)); } throw new Error('server not up'); }
const apiJ = async (url, method = 'GET', body) => (await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: body ? JSON.stringify(body) : undefined })).json();

// 가짜 API(불러오기 3종 + 쿠팡 취소 재확인) — 호출 수를 센다([다시 판정]이 주문을 다시 안 불러오는지 확인용)
//   mode = { naver|cafe24|coupang: 'ok'(기본) | 'fail'(ok:false) | '401' } — 실행 중에 바꾸면 다음 호출부터 적용
async function fakeApis(ctx, fx, hits, mode = {}) {
    //   mode.delayNaver(ms) = 네이버 응답을 늦춤(실행 중 화면 확인용) · mode.memoParse = 'fail' 이면 메모 해석 API 500(키가 있을 때만 가로챔)
    if ('memoParse' in mode) await ctx.route('**/api/agent-office/invoice/memo-parse', r => mode.memoParse === 'fail' ? r.fulfill({ status: 500, json: { ok: false, message: '가짜 메모 해석 오류(시험)' } }) : r.continue());
    const reply = (ch, body) => async r => { hits[ch]++; const m = mode[ch] || 'ok'; if (ch === 'naver' && mode.delayNaver) await new Promise(z => setTimeout(z, mode.delayNaver)); if (m === '401') return r.fulfill({ status: 401, json: { error: '토큰이 만료되었거나 유효하지 않습니다' } }); if (m === 'fail') return r.fulfill({ json: { ok: false, message: '가짜 실패(시험)' } }); r.fulfill({ json: body }); };
    await ctx.route('**/api/agent-office/naver/invoice-orders-v2*', reply('naver', { ok: true, count: fx.naver.length, rows: fx.naver, partial_adjusted: 0 }));
    await ctx.route('**/api/agent-office/cafe24/invoice-orders*', reply('cafe24', { ok: true, count: fx.cafe24.length, rows: fx.cafe24 }));
    await ctx.route('**/api/agent-office/coupang/invoice-orders*', reply('coupang', { ok: true, count: fx.coupang.length, rows: fx.coupang }));
    // #520: 판정이 끝나면 AI 읽기가 자동으로 시작된다 → 기본은 「못 올림」으로 막는다(실DB에 요청이 생기거나 실제 창구가 도는 일이 없게). ⑮ 에서만 따로 가짜 창구를 붙인다.
    await ctx.route('**/api/agent-office/final-order/memo-read**', r => { hits.ai = (hits.ai || 0) + 1; r.fulfill({ json: { ok: false, message: '시험에서는 AI를 부르지 않아요' } }); });
    // #525: 정리 기록 라우트는 실DB에 줄을 만든다 → 늘 가로챈다(보낸 내용은 hits.logs 에)
    await ctx.route('**/api/agent-office/final-order/log', r => { (hits.logs = hits.logs || []).push(r.request().postDataJSON()); r.fulfill({ json: { ok: true, id: 7001 } }); });
    // #528: 주소 검색 프록시도 늘 가짜 응답(기본 0건) — 실제 도로명주소 검색을 부르지 않는다
    await ctx.route('**/api/agent-office/juso*', r => r.fulfill({ json: { results: { common: { errorCode: '0', errorMessage: '정상', totalCount: '0' }, juso: [] } } }));
    await ctx.route('**/api/agent-office/coupang/canceled-since*', r => { hits.cancel++; r.fulfill({ json: { ok: true, canceled: fx.canceledCoupang } }); });
}
async function newCtx(br, fx, hits, viewport, mobile, mode) {
    const ctx = await br.newContext({ acceptDownloads: true, viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [TOKEN, USER]);
    await fakeApis(ctx, fx, hits, mode);
    // 실DB에 대기 중인 정산 확인표가 있으면 그 창(.ao-settle-overlay)이 떠서 시험 클릭을 가린다(10/6 실사고) → 시험에서만 숨긴다
    await ctx.addInitScript(() => { const add = () => { const s = document.createElement('style'); s.textContent = '.ao-settle-overlay{display:none!important}'; (document.head || document.documentElement).appendChild(s); }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); });
    return ctx;
}
// ⑦ 묶음용: 새 창에서 패널을 열고(달력 준비까지) 돌려준다
async function openFO(br, fx, mode) {
    const hits = { naver: 0, cafe24: 0, coupang: 0, cancel: 0 }; const ctx = await newCtx(br, fx, hits, { width: 1400, height: 900 }, false, mode);
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500); await pg.evaluate(() => switchPage('agent-office')); await pg.waitForTimeout(1000);
    await pg.click(SEL.btn); await pg.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
    await pg.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await idle(pg);
    return { ctx, pg, hits, errs };
}
// 현금파일(경로) 또는 「없음」(null)을 고른다 — 이미 고른 상태에서 바꿀 때도 쓴다
async function setCash(pg, file) {
    if (file) { if (await pg.isChecked(SEL.cashNone)) await pg.uncheck(SEL.cashNone); await pg.setInputFiles(SEL.cash, file); }
    else { if (await pg.isVisible('#fo-cash-clear')) { await pg.click('#fo-cash-clear'); await pg.waitForTimeout(150); }   // #548: 파일을 고른 뒤에는 「오늘은 없음」이 잠긴다 → 먼저 [파일 빼기]
        if (!(await pg.isChecked(SEL.cashNone))) await pg.check(SEL.cashNone); }
    await pg.waitForTimeout(300);
}
const phaseOf = pg => pg.evaluate(() => window.AkmFinalOrder.state.phase);
const frameInfo = pg => pg.evaluate(sel => { const i = document.querySelector(sel).contentWindow.__ivt; return { n: i.S.merged.length, cp: i.S.merged.filter(e => e.ch === 'coupang').length, ship: i.S.shipDate }; }, SEL.hidden);
// 남은 카드를 종류별 기본 버튼으로 전부 처리(거래처 고르기 카드는 따로)
async function resolveAll(pg) { for (const t of Object.keys(ACT)) await resolveCards(pg, t); }
const writeXlsx = (file, aoa) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1'); XLSX.writeFile(wb, file); return file; };
// 송장변환 v2 화면(단독 페이지)에서 3채널을 하나씩 불러오고 줄을 넣은 뒤 판정표를 돌려준다 — 가짜 재료 점검 + 무회귀 비교의 기준
async function v2Judge(ctx, v2Text, shipDate) {
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(BASE + '/invoice-v2.html', { waitUntil: 'load' }); await pg.waitForFunction(() => window.__ivt && window.__ivt.S.calendar, null, { timeout: 30000 });
    for (const ch of ['naver', 'cafe24', 'coupang']) { await pg.click('#btn-' + ch); await pg.waitForFunction(c => { const b = document.getElementById('btn-' + c); return !b.disabled && /^(✅|⚠️)/.test(document.getElementById('msg-' + c).textContent.trim()); }, ch, { timeout: 30000 }); }
    const out = await pg.evaluate(async ([v2Text, shipDate]) => {
        const i = window.__ivt; if (shipDate) i.S.shipDate = shipDate;
        document.getElementById('ln-all').value = v2Text || ''; await i.saveLines(i.S);
        return { ship: i.S.shipDate, cal: { suggested: i.S.calendar.suggested, realToday: i.S.calendar.realToday, shipDays: i.S.calendar.shipDays, noShip: [...i.S.calendar.noShip] },
            judge: Object.fromEntries(i.S.merged.map(e => [e.conv['수취인명'], { ch: e.ch, excluded: !!e.excluded, individual: !!e.individual, flag: e.flag || null, kind: e.reqKind || null, sender: e.sender ? (e.sender.ambiguous ? 'amb' : e.sender.name) : null, opt: e.conv['옵션정보'], qty: e.conv['수량'] }])) };
    }, [v2Text || '', shipDate || null]);
    await pg.close(); out.errs = errs; return out;
}
const readJudge = pg => pg.evaluate(sel => { const f = document.querySelector(sel); const i = f && f.contentWindow && f.contentWindow.__ivt; if (!i) return null; return { ship: i.S.shipDate, v2Text: f.contentDocument.getElementById('ln-all').value, judge: Object.fromEntries(i.S.merged.map(e => [e.conv['수취인명'], { ch: e.ch, excluded: !!e.excluded, individual: !!e.individual, flag: e.flag || null, kind: e.reqKind || null, sender: e.sender ? (e.sender.ambiguous ? 'amb' : e.sender.name) : null, opt: e.conv['옵션정보'] }])) }; }, SEL.hidden);
const cardCount = pg => pg.evaluate(sel => { const o = {}; document.querySelectorAll(sel.card).forEach(c => { const k = c.getAttribute('data-fo-card'); o[k] = o[k] || { all: 0, pending: 0 }; o[k].all++; if (!c.hasAttribute('data-fo-done')) o[k].pending++; }); return o; }, SEL);
// 불러오기·판정·파일 만들기 중엔 #fo-panel 에 busy 클래스가 붙는다 — 사라질 때까지 기다린다
const idle = async pg => { await pg.waitForTimeout(200); await pg.waitForFunction(sel => { const p = document.querySelector(sel); return p && !p.classList.contains('busy') && !(window.AkmFinalOrder && window.AkmFinalOrder.state.ai && window.AkmFinalOrder.state.ai.running); }, SEL.panel, { timeout: 120000 }); };
const pendingN = pg => pg.evaluate(sel => document.querySelectorAll(sel).length, SEL.pending);
// 남은 카드 중 한 종류를 전부 누른다(재렌더 대비 — 매번 다시 찾는다)
async function resolveCards(pg, type) {
    let n = 0;
    for (let guard = 0; guard < 60; guard++) {
        const loc = pg.locator(`${SEL.pending}[data-fo-card="${type}"]`).first(); if (!(await loc.count())) break;
        const btn = loc.locator(`[data-fo-act="${ACT[type]}"]`).first(); if (!(await btn.count())) throw new Error(`카드 「${type}」에 [data-fo-act="${ACT[type]}"] 버튼이 없습니다`);
        await btn.click(); await pg.waitForTimeout(120); n++;
    }
    return n;
}

(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    // 🔴 서버의 출력(stdout·stderr)을 읽어 내지 않으면 파이프가 차서 서버가 console 출력에서 멈춘다(모든 응답이 끊김 — 10/5 실측: 검사가 길어지며 ⑧-b 에서 화면 열기가 멈춤). 읽어서 버리고 끝부분만 남긴다.
    const srvLog = { out: 0, err: 0, tail: '' };
    srv.stdout.on('data', d => { srvLog.out += d.length; }); srv.stderr.on('data', d => { srvLog.err += d.length; srvLog.tail = (srvLog.tail + d).slice(-600); });
    let br, code = 1;
    try {
        await waitUp();
        const cat = await apiJ('/api/invoice/catalog');
        const mp = await apiJ('/api/agent-office/invoice/memo-parse', 'POST', { memos: [] });
        const ship = mp.suggested, later = (mp.shipDays || []).find(d => d > ship);
        if (!ship || !later) throw new Error('발송일 달력을 못 읽었습니다');
        const fx = FX.build({ byPartner: cat.byPartner || {}, ship, later, realToday: mp.realToday, noShip: mp.noShip || [] });
        const cashFile = path.join(TMP, '가짜_현금파일.xlsx'); { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fx.cashAoa), 'Sheet1'); XLSX.writeFile(wb, cashFile); }
        const partnerOf = opt => { const base = String(opt).replace(/\s+(2S|S|M)사이즈로!$/, ''); return Object.keys(cat.byPartner).find(p => cat.byPartner[p].includes(base)) || null; };
        const { chromium } = require('playwright'); br = await chromium.launch();

        // ⓪ 가짜 재료 자체 점검 — 송장변환 v2 단독(최종발주 파일이 없어도 돈다)
        console.log(`\n⓪ 가짜 재료 점검 (기준 발송일 ${ship} · 뒤 날짜 ${later} · 금요일 줄 → ${fx.fri} = ${fx.friKind}${fx.friNoShip ? ' · 발송 없는 날' : ''})`);
        const hits0 = { naver: 0, cafe24: 0, coupang: 0, cancel: 0 }; const ctx0 = await newCtx(br, fx, hits0, { width: 1400, height: 900 });
        const base0 = await v2Judge(ctx0, '', null); await ctx0.close();
        const J0 = base0.judge, names0 = Object.keys(J0);
        ok(names0.length === 34 && hits0.naver === 1 && hits0.cafe24 === 1 && hits0.coupang === 1, '⓪ 가짜 API로 3채널 34건 로드(네이버 30 · 자사몰 2 · 쿠팡 2)', `${names0.length}건 · 호출 ${JSON.stringify(hits0)}`);
        const unmatched = names0.filter(n => String(J0[n].opt).startsWith('[미매칭]')), noPartner = names0.filter(n => !partnerOf(J0[n].opt));
        ok(unmatched.length === 0 && noPartner.length === 0, '⓪ 가짜 주문 전부 품목 매칭 · 거래처 판정 가능', `미매칭 ${unmatched.length} · 거래처 없음 ${noPartner.length}`);
        ok(/S사이즈로!$/.test(J0['받는17'].opt) && J0['받는18'].excluded && J0['받는19'].flag === 'review' && !J0['받는19'].excluded && J0['받는20'].sender === '홍길동' && J0['받는21'].sender === 'amb',
            '⓪ 손님 메모 판정 재료: 사이즈 꼬리 · 뒤 날짜 자동 제외 · 날짜 애매 = 확인필요 · 보내는이 확실/애매', JSON.stringify({ 17: J0['받는17'].opt.slice(-8), 18: J0['받는18'].excluded, 19: J0['받는19'].flag, 20: J0['받는20'].sender, 21: J0['받는21'].sender }));
        ok(base0.errs.length === 0, '⓪ 송장변환 v2 단독 오류 0', base0.errs.join(' | '));

        if (PART !== 'B') {   // 앞부분(①~⑭)
        // ① 버튼 → 패널 → 시작 조건
        console.log('\n① 버튼 · 패널 · 시작 조건');
        const hits = { naver: 0, cafe24: 0, coupang: 0, cancel: 0 }; const ctx = await newCtx(br, fx, hits, { width: 1400, height: 900 });
        const pg = await ctx.newPage(); const errs = [], dialogs = [];
        pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) errs.push(m.text()); });
        pg.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message().slice(0, 80)); await d.accept(); });
        await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500);
        await pg.evaluate(() => switchPage('agent-office')); await pg.waitForTimeout(1200);
        const menuH0 = await pg.evaluate(() => { const f = document.getElementById('invoice-v2-frame'); return f ? (f.style.height || '') + '|' + (f.dataset.loaded || '') : 'none'; });
        if (!(await pg.locator(SEL.btn).count())) {
            ok(false, `① [최종발주] 버튼(${SEL.btn})이 에이전트 오피스 화면에 없음 — 제품 파일이 아직 올라오지 않았습니다(여기서 멈춤)`);
            code = 2; throw new Error('STOP');
        }
        await pg.click(SEL.btn);
        await pg.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
        ok(true, '① 버튼 클릭 → 패널 열림');
        await pg.waitForFunction(sel => { const f = document.querySelector(sel.hidden); return f && f.contentWindow && f.contentWindow.__ivt && f.contentWindow.__ivt.S.calendar && /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value); }, SEL, { timeout: 40000 });
        await idle(pg);
        const fr = await pg.evaluate(sel => { const f = document.querySelector(sel.hidden); return { src: f.getAttribute('src'), display: getComputedStyle(f).display, shipVal: document.querySelector(sel.ship).value, opts: [...document.querySelector(sel.ship).options].map(o => o.value) }; }, SEL);
        ok(/invoice-v2\.html/.test(fr.src) && !/embed=1/.test(fr.src) && fr.display === 'none', '① 숨은 iframe(#fo-frame) = ?embed=1 없이 · display:none', JSON.stringify({ src: fr.src, display: fr.display }));
        ok(fr.shipVal === ship && fr.opts.every(o => mp.shipDays.includes(o)), '① 기준 발송일 고르개 = 달력의 다음 발송일 · 고를 수 있는 날은 발송일만', `${fr.shipVal} · ${fr.opts.join(',')}`);
        await pg.fill(SEL.memo, fx.memo);
        ok(await pg.isDisabled(SEL.start), '① 현금파일도 「없음」도 없으면 [시작] 꺼짐');
        await pg.check(SEL.cashNone); ok(!(await pg.isDisabled(SEL.start)), '① 「없음」 체크 → [시작] 켜짐');
        await pg.uncheck(SEL.cashNone); ok(await pg.isDisabled(SEL.start), '① 「없음」 해제 → 다시 꺼짐');
        await pg.setInputFiles(SEL.cash, cashFile); await pg.waitForTimeout(300); ok(!(await pg.isDisabled(SEL.start)), '① 현금파일 선택 → [시작] 켜짐');

        // ② 불러오기
        console.log('\n② 불러오기');
        await pg.click(SEL.start); await idle(pg);
        try { await pg.waitForSelector(SEL.card, { timeout: 15000 }); }
        catch (e) { note('② 카드가 안 뜸 — 화면 안내 글', await pg.evaluate(() => ['fo-in-msg', 'fo-make-msg', 'fo-progress', 'fo-sum'].map(id => id + ': ' + ((document.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 160)).join(' ‖ '))); note('② 오류', errs.join(' | ')); throw e; }
        const prog = await pg.evaluate(sel => document.querySelector(sel).textContent, SEL.progress);
        ok(/네이버/.test(prog) && /자사몰/.test(prog) && /쿠팡/.test(prog) && hits.naver === 1 && hits.cafe24 === 1 && hits.coupang === 1, '② 진행 표시에 3채널 · 가짜 API 채널마다 1회 호출', `${JSON.stringify(hits)} · ${prog.replace(/\s+/g, ' ').slice(0, 120)}`);
        const snap = await readJudge(pg); const J = snap.judge;
        ok(Object.keys(J).length === 34 && snap.ship === ship, '② 숨은 iframe에 34건 · 기준일 = 고른 날', `${Object.keys(J).length}건 · ${snap.ship}`);
        ok(fx.expect.individual.every(n => J[n].individual) && fx.expect.excluded.every(n => J[n].excluded) && !J['받는06'].individual, '② 메모 줄 판정: 입력o삭제x·개별발송처리 = 개별발송 / 뒤 날짜 = 제외 (E는 아직 아님)', JSON.stringify({ 26: J['받는26'].kind, 28: J['받는28'].kind, 29: J['받는29'].kind }));
        ok(J['받는30'].kind === fx.friKind, '② 「번호 금요일 발송」 → 그 금요일 날짜로 풀려 판정', `${fx.fri} → ${J['받는30'].kind}`);

        // ③ 카드
        console.log('\n③ 확인 카드');
        const c0 = await cardCount(pg); const n = k => (c0[k] || { pending: 0 }).pending;
        const expOrder = Object.keys(J).filter(k => J[k].flag === 'review' && !J[k].individual && !J[k].excluded && J[k].kind !== 'today').length;
        ok(n(CARD.order) === expOrder && expOrder >= 1, '③ 주문 확인 카드 = v2 확인필요(그날 발송 확정 제외) 건수', `카드 ${n(CARD.order)} · 기대 ${expOrder}`);
        ok(n(CARD.split) === 1, '③ 나눠 보내기 카드 1(수량 3 + 「주소」 낱말)', n(CARD.split));
        ok(n(CARD.senderMemo) === 1, '③ 보내는이(손님 메모 애매) 카드 1', n(CARD.senderMemo));
        const expLine = 1 + (fx.friNoShip ? 1 : 0);
        ok(n(CARD.line) === expLine, `③ 메모 줄 카드 ${expLine}(형식 오류 1${fx.friNoShip ? ' · 발송 없는 요일 1' : ''}) — 「주문 없음」 줄은 카드 아님`, n(CARD.line));
        ok(n(CARD.senderLine) === 2, '③ 직원 보내는이 애매 카드 2', n(CARD.senderLine));
        ok(n(CARD.cashBoxDiff) === 1 && n(CARD.cashNotIndiv) === 1 && n(CARD.cashMissing) === 0 && n(CARD.cashFormat) === 0 && n(CARD.partner) === 0, '③ 현금 대조 카드: 박스 수 다름 1(B) · 현금파일에 있는데 입력삭제 아님 1(E) · 나머지 0', JSON.stringify(c0));
        ok(await pg.isDisabled(SEL.make), '③ 카드가 남으면 [파일 만들기] 꺼짐');

        // ⑥ 다시 판정 — 주문 카드 먼저 결정 → 메모에 E 입력삭제 줄 추가 → 다시 판정
        console.log('\n⑥ 다시 판정');
        const nOrder = await resolveCards(pg, CARD.order);
        const hitsBefore = JSON.stringify(hits);
        await pg.fill(SEL.memo, fx.memo + '\n' + fx.rejudgeLine);
        ok(await pg.isDisabled(SEL.make), '⑥ 메모를 바꾸면 [다시 판정] 전까지 [파일 만들기] 꺼짐');
        await pg.click(SEL.rejudge); await idle(pg);
        await pg.waitForFunction(sel => { const f = document.querySelector(sel); const i = f.contentWindow.__ivt; const e = i.S.merged.find(x => x.conv['수취인명'] === '받는06'); return e && e.individual; }, SEL.hidden, { timeout: 30000 });
        await pg.waitForTimeout(400);
        const c1 = await cardCount(pg); const n1 = k => (c1[k] || { pending: 0 }).pending;
        ok(JSON.stringify(hits) === hitsBefore, '⑥ 다시 판정은 주문을 다시 불러오지 않음(가짜 API 호출 수 그대로)', hitsBefore);
        ok(n1(CARD.cashNotIndiv) === 0, '⑥ E 입력삭제 줄 추가 → 「현금파일에 있는데 입력삭제 아님」 카드 사라짐', JSON.stringify(c1[CARD.cashNotIndiv] || {}));
        ok(n1(CARD.order) === 0 && nOrder === expOrder, '⑥ 앞서 내린 주문 카드 결정 유지(다시 남지 않음)', `결정 ${nOrder}건 · 남은 주문 카드 ${n1(CARD.order)}`);
        const J2 = (await readJudge(pg)).judge;
        ok(!J2['받는19'].excluded, '⑥ [오늘 발송]으로 정한 주문은 다시 판정 뒤에도 발송 유지');
        for (const t of [CARD.split, CARD.senderMemo, CARD.line, CARD.cashBoxDiff]) await resolveCards(pg, t);
        {   // 직원 보내는이 애매 카드: 하나는 칸을 채워 [이대로 넣기] · 하나는 [넣지 않음]
            const u = fx.expect.senderLineUse, k = fx.expect.senderLineSkip;
            const cu = pg.locator(`${SEL.pending}[data-fo-card="${CARD.senderLine}"]`, { hasText: u.find }).first();
            await cu.locator('[data-f="name"]').fill(u.name); await cu.locator('[data-f="phone"]').fill(''); await cu.locator('[data-f="addr"]').fill(u.addr);
            await pg.locator(`${SEL.pending}[data-fo-card="${CARD.senderLine}"]`, { hasText: u.find }).first().locator('[data-fo-act="use"]').click(); await pg.waitForTimeout(150);
            const ck = pg.locator(`${SEL.pending}[data-fo-card="${CARD.senderLine}"]`, { hasText: k.find }).first();
            if (await ck.count()) { await ck.locator('[data-fo-act="skip"]').click(); await pg.waitForTimeout(150); }   // 카드가 없으면 ③에서 이미 실패로 잡혔다 — 뒤 검사를 계속 돌리기 위해 건너뜀
        }
        ok((await pendingN(pg)) === 0 && !(await pg.isDisabled(SEL.make)), '③ 카드 전부 처리 → [파일 만들기] 켜짐', `남은 카드 ${await pendingN(pg)}`);
        const snapFinal = await readJudge(pg);   // 무회귀 비교용(카드 결정 전 판정은 snap · 줄 글자는 최종본)

        // ④ 파일
        console.log('\n④ 결과 파일');
        await pg.click(SEL.make); await idle(pg); await pg.waitForSelector(SEL.save, { timeout: 15000 });
        ok(hits.cancel >= 1, '④ 파일 만들기에서 쿠팡 취소 재확인 호출', hits.cancel);
        const files = {};
        const saveBtns = await pg.locator(SEL.save).count();
        for (let i = 0; i < saveBtns; i++) { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 20000 }), pg.locator(SEL.save).nth(i).click()]); const nm = d.suggestedFilename(); const f = path.join(TMP, 'out-' + i + path.extname(nm)); await d.saveAs(f); files[nm] = f; }
        const names = Object.keys(files); const md = `${ship.slice(5, 7)}.${ship.slice(8, 10)}`;
        const fH = names.find(x => x === `제주아꼼이네송장(효돈) ${md}.xlsx`), fD = names.find(x => x === `제주아꼼이네송장(대성) ${md}.xlsx`), fS = names.find(x => x === `스마트스토어 발주발송관리 ${md}.xlsx`);
        ok(!!fH && !!fD && !!fS && names.length === 3, '④ 파일 3개: 거래처별 택배사 양식 2 + 스마트스토어 1 (이름 = 설계서 §7-7)', names.join(' | '));
        const gone = [...fx.expect.excluded, ...fx.expect.canceled, ...fx.expect.individualAfterRejudge, ...(fx.friKind === 'future' ? ['받는30'] : [])];
        const sums = {};
        for (const [label, fname, P] of [['효돈', fH, FX.P_HYODON], ['대성', fD, FX.P_DAESUNG]]) {
            if (!fname) continue;
            const wb = XLSX.readFile(files[fname], { cellStyles: true }); const s1 = wb.Sheets.Sheet1; const a = XLSX.utils.sheet_to_json(s1, { header: 1, defval: '' }); const rows = a.slice(1);
            ok(wb.SheetNames.join() === 'Sheet1,수량' && JSON.stringify(a[0]) === JSON.stringify(FX.CASH_HDR), `④ [${label}] 시트 = Sheet1 + 수량 · 머리글 13칸`, `${wb.SheetNames} · ${a[0].length}칸`);
            ok(fillOf(s1.A1) === '92D050' && fillOf(s1.D1) === 'FFFF00' && fillOf(s1.L1) === '92D050' && fillOf(s1.M1) === 'FFFF00', `④ [${label}] 머리글 색(A~C·L 초록 · D~K·M 노랑)`, [s1.A1, s1.D1, s1.L1, s1.M1].map(fillOf).join(','));
            ok(rows.length > 0 && rows.every(r => partnerOf(r[4]) === P), `④ [${label}] 전 행이 이 거래처 품목`, `${rows.length}행`);
            const isJ = r => String(r[8]).trim().startsWith('제주'); const firstJ = rows.findIndex(isJ); const top = firstJ < 0 ? rows : rows.slice(0, firstJ), bot = firstJ < 0 ? [] : rows.slice(firstJ);
            const asc = arr => arr.every((r, i) => i === 0 || String(arr[i - 1][4]).localeCompare(String(r[4]), 'ko') <= 0);
            ok(bot.every(isJ) && bot.map(r => r[3]).sort().join() === [...fx.expect.jeju[P]].sort().join(), `④ [${label}] 제주 행은 맨 아래에 모여 있음`, bot.map(r => r[3]).join(','));
            ok(asc(top) && asc(bot), `④ [${label}] 옵션정보 오름차순(제주 아닌 묶음 · 제주 묶음 각각)`);
            ok(rows.every((r, i) => isJ(r) ? fillOf(s1['I' + (i + 2)]) === 'FFFF00' : fillOf(s1['I' + (i + 2)]) !== 'FFFF00'), `④ [${label}] I칸 노랑 = 「제주」로 시작하는 행에만`);
            const cashFirst = rows.every((r, i) => i === 0 || !(rows[i - 1][4] === r[4] && isJ(rows[i - 1]) === isJ(r) && /^받는|^자사받는|^쿠팡받는/.test(rows[i - 1][3]) && !/^받는|^자사받는|^쿠팡받는/.test(r[3])));
            ok(cashFirst, `④ [${label}] 같은 옵션 묶음 안에서 현금 행이 프로그램 행보다 앞`);
            ok(rows.every(r => String(r[9]).trim() !== ''), `④ [${label}] 빈 배송메세지 없음(기본 문구로 채움)`);
            ok(rows.every(r => !gone.includes(r[3])), `④ [${label}] 제외·취소·입력삭제 주문이 택배사 파일에 없음`, rows.filter(r => gone.includes(r[3])).map(r => r[3]).join(','));
            const q = XLSX.utils.sheet_to_json(wb.Sheets['수량'], { header: 1, defval: '' }).filter(r => r.some(v => v !== ''));
            const nums = q.map(r => r.filter(v => typeof v === 'number').pop()).filter(v => v != null); const total = nums[nums.length - 1], body = nums.slice(0, -1).reduce((s, v) => s + v, 0), s1sum = rows.reduce((s, r) => s + (parseInt(r[5]) || 0), 0);
            ok(nums.length >= 2 && total === body && total === s1sum, `④ [${label}] 「수량」 시트 합계 = 품목 줄 합 = Sheet1 수량 합`, `합계 ${total} · 줄 합 ${body} · Sheet1 ${s1sum}`);
            sums[P] = { wb, s1, rows };
        }
        const all = [].concat(...Object.values(sums).map(x => x.rows.map((r, i) => ({ r, ref: i + 2, s1: x.s1 }))));
        const find = nm => all.find(x => x.r[3] === nm);
        ok(fx.expect.cashNames.every(nm => !!find(nm)), '④ 현금파일 9행 전부 택배사 파일에 들어감', fx.expect.cashNames.filter(nm => !find(nm)).join(','));
        ok(all.length === 34 - gone.length + fx.expect.cashNames.length, '④ 택배사 파일 행 수 합 = 주문 34 − 빠진 건 + 현금 9', `${all.length} = 34 − ${gone.length} + 9`);
        const mid = find(fx.expect.midJeju), midRows = mid && Object.values(sums).find(x => x.s1 === mid.s1).rows;
        ok(!!mid && fillOf(mid.s1['I' + mid.ref]) !== 'FFFF00' && midRows.slice(mid.ref - 1).some(r => String(r[8]).trim().startsWith('제주')), '④ 주소 중간에 「제주」가 든 행 = 노랑 아님 · 제주 묶음보다 위');
        ok(Object.entries(fx.expect.keepMemo).every(([nm, m]) => find(nm) && find(nm).r[9] === m), '④ 손님 메모·현금파일 메모 원문 유지');
        ok(fx.expect.emptyMemo.every(nm => find(nm) && find(nm).r[9] === FX.DEFAULT_MEMO), '④ 빈 메모 = 기본 문구', fx.expect.emptyMemo.map(nm => find(nm) ? String(find(nm).r[9]).slice(0, 12) : '(없음)').join(' | '));
        const stf = Object.entries(fx.expect.staffSender).map(([nm, w]) => { const x = find(nm); if (!x) return nm + ' 없음'; const bad = []; if (x.r[0] !== w.A || fillOf(x.s1['A' + x.ref]) !== 'DDEBF7') bad.push('A'); if (w.B && (String(x.r[1]) !== w.B || fillOf(x.s1['B' + x.ref]) !== 'DDEBF7')) bad.push('B'); if (!w.B && fillOf(x.s1['B' + x.ref]) === 'DDEBF7') bad.push('B색'); if (w.M && (String(x.r[12]) !== w.M || fillOf(x.s1['M' + x.ref]) !== 'DDEBF7')) bad.push('M'); if (!w.M && String(x.r[12]) !== '') bad.push('M값'); return bad.length ? nm + ':' + bad.join('') : null; }).filter(Boolean);
        ok(stf.length === 0, '④ 직원 보내는이: A 「이름 드림」 · B 번호(적힌 때만) · M 주소(적힌 때만) + 연파랑', stf.join(' / '));
        const amb4 = find(fx.expect.senderLineSkip.row); ok(!!amb4 && /\(제주아꼼이네\)$/.test(amb4.r[0]) && String(amb4.r[12]) === '', '④ 애매한 보내는이 줄 [넣지 않음] = 보내는사람·M 안 바뀜', amb4 && amb4.r[0]);
        const use7 = find(fx.expect.senderLineUse.row), U = fx.expect.senderLineUse;
        ok(!!use7 && use7.r[0] === U.A && String(use7.r[12]) === U.M && fillOf(use7.s1['A' + use7.ref]) === 'DDEBF7' && fillOf(use7.s1['M' + use7.ref]) === 'DDEBF7', '④ 애매한 보내는이 줄 칸을 채워 [이대로 넣기] = A 「이름 드림」 · M 주소 + 연파랑', use7 && JSON.stringify([use7.r[0], use7.r[12]]));
        const c20 = find('받는20'); ok(!!c20 && c20.r[0] === '홍길동 드림' && fillOf(c20.s1['A' + c20.ref]) === 'DDEBF7', '④ 손님 메모 보내는이(v2 자동) 그대로 유지', c20 && c20.r[0]);
        const sz = find(fx.expect.sizeRow); ok(!!sz && /S사이즈로!$/.test(sz.r[4]), '④ 사이즈 요청 행 = 옵션에 꼬리 유지 · 수량 시트에 별도 줄', sz && String(sz.r[4]).slice(-10));
        if (fS) {
            const wb = XLSX.readFile(files[fS], { cellStyles: true }); const s2 = wb.Sheets['발주발송관리']; const a = s2 ? XLSX.utils.sheet_to_json(s2, { header: 1, defval: '' }) : [];
            ok(!!s2 && JSON.stringify(a[1]) === JSON.stringify(V2_HDR27), '④ [스토어] 「발주발송관리」 시트 · 머리글 27열(네이버 원본 양식)', a[1] && a[1].length);
            const body = a.slice(2), tail = body.slice(-fx.expect.individualAfterRejudge.length), yellow = body.map((r, i) => fillOf(s2['A' + (i + 3)]) === 'FFF2CC');
            ok(tail.map(r => r[6]).sort().join() === [...fx.expect.individualAfterRejudge].sort().join() && yellow.filter(Boolean).length === tail.length && yellow.slice(-tail.length).every(Boolean), '④ [스토어] 입력삭제 주문 = 노란 줄로 맨 아래', tail.map(r => r[6]).join(','));
            const nvGone = [...fx.expect.excluded, ...(fx.friKind === 'future' ? ['받는30'] : [])];
            ok(body.every(r => /^받는/.test(r[6])) && body.every(r => !nvGone.includes(r[6])) && body.length === 30 - nvGone.length, '④ [스토어] 네이버 주문만 · 오늘 안 나가는 건 없음', `${body.length}행`);
        }
        const pngN = await pg.locator(SEL.png).count(); let pngOk = pngN >= 2;
        for (let i = 0; i < pngN; i++) { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 20000 }), pg.locator(SEL.png).nth(i).click()]); const f = path.join(TMP, 'q' + i + '.png'); await d.saveAs(f); const b = fs.readFileSync(f); if (!(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b.length > 1000 && /^수량\((효돈|대성)\) \d\d\.\d\d\.png$/.test(d.suggestedFilename()))) pngOk = false; }
        ok(pngOk, '④ 수량 이미지 저장 = 거래처마다 PNG', `${pngN}개`);

        // ⑤ 무회귀
        console.log('\n⑤ 무회귀');
        const menuH1 = await pg.evaluate(() => { const f = document.getElementById('invoice-v2-frame'); return f ? (f.style.height || '') + '|' + (f.dataset.loaded || '') : 'none'; });
        ok(menuH0 === menuH1, '⑤ 송장변환 메뉴 iframe(#invoice-v2-frame) 높이·로드 상태 무변경', `${menuH0} → ${menuH1}`);
        const ref = await v2Judge(ctx, snap.v2Text, ship);
        const diff = Object.keys(snap.judge).filter(k => { const a = snap.judge[k], b = ref.judge[k]; return !b || a.excluded !== b.excluded || a.individual !== b.individual || a.flag !== b.flag || a.kind !== b.kind || a.sender !== b.sender; });
        ok(diff.length === 0 && Object.keys(ref.judge).length === 34, '⑤ 같은 주문·같은 줄을 송장변환 화면에 직접 넣은 판정 = 최종발주 숨은 iframe 판정(34건 전부)', diff.slice(0, 5).join(','));
        ok(snapFinal.v2Text.split('\n').length === (fx.memo + '\n' + fx.rejudgeLine).split('\n').length, '⑤ v2에 넘긴 줄 수 = 메모 줄 수(줄 번호 1:1)');
        ok(errs.length === 0, '⑤ pageerror·console error 0', errs.join(' | '));
        note('⑤ confirm/alert 창', dialogs.length ? dialogs.join(' | ') : '0건');
        await ctx.close();
        // 390px
        const hitsM = { naver: 0, cafe24: 0, coupang: 0, cancel: 0 }; const ctxM = await newCtx(br, fx, hitsM, { width: 390, height: 844 }, true); const pm = await ctxM.newPage(); const errM = []; pm.on('pageerror', e => errM.push(e.message));
        await pm.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pm.waitForTimeout(2500); await pm.evaluate(() => switchPage('agent-office')); await pm.waitForTimeout(1000);
        await pm.evaluate(sel => document.querySelector(sel).scrollIntoView(), SEL.btn); await pm.click(SEL.btn); await pm.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
        await pm.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await idle(pm);
        await pm.fill(SEL.memo, fx.memo); await pm.setInputFiles(SEL.cash, cashFile); await pm.click(SEL.start); await idle(pm); await pm.waitForSelector(SEL.card, { timeout: 15000 });
        const wM = await pm.evaluate(sel => { const p = document.querySelector(sel.panel); const wide = [...p.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('.table-scroll-wrapper, [data-fo-scroll]')).length; return { doc: document.documentElement.scrollWidth, panel: p.scrollWidth, inner: window.innerWidth, wide }; }, SEL);
        ok(wM.doc <= wM.inner + 1 && wM.panel <= wM.inner + 1 && wM.wide === 0 && errM.length === 0, '⑤ 390px: 패널·카드가 가로로 안 넘침 · 오류 0', JSON.stringify(wM) + ' ' + errM.join('|'));
        await ctxM.close();

        // ⑦ 그 밖의 흐름 ─────────────────────────────────────────────────────────
        const pend = async (pg2, type) => (((await cardCount(pg2))[type]) || { pending: 0 }).pending;
        const saveN = pg2 => pg2.locator(SEL.save).count();
        const txt = (pg2, id) => pg2.evaluate(i => (document.getElementById(i) || {}).textContent || '', id);
        // ⑦-1 채널 실패 → skip / retry / 전부 실패
        console.log('\n⑦-1 채널 실패');
        {
            const mode = { coupang: 'fail' }; const a = await openFO(br, fx, mode);
            await setCash(a.pg, null); await a.pg.click(SEL.start); await idle(a.pg);
            const b1 = await a.pg.evaluate(sel => ({ retry: !!document.querySelector(sel + ' [data-fo-load="retry"]'), skip: !!document.querySelector(sel + ' [data-fo-load="skip"]'), ph: window.AkmFinalOrder.state.phase }), SEL.progress);
            ok(b1.retry && b1.skip && b1.ph !== 'review', '⑦-1 쿠팡 실패 → [다시 불러오기]·[건너뛰기] 버튼 · 아직 판정 전', JSON.stringify(b1));
            await a.pg.click(SEL.progress + ' [data-fo-load="skip"]'); await idle(a.pg);
            const f1 = await frameInfo(a.pg);
            ok((await phaseOf(a.pg)) === 'review' && f1.n === 32 && f1.cp === 0, '⑦-1 건너뛰기 → 쿠팡 없이 판정 단계(32건)', JSON.stringify(f1));
            // ⑦-8 날짜 가드(같은 창): 불러온 날을 어제로 → 파일 만들기 = v2 안내 글 그대로 · 파일 없음
            await resolveAll(a.pg);
            await a.pg.evaluate(sel => { document.querySelector(sel).contentWindow.__ivt.S.fetchedOn = '2000-01-01'; }, SEL.hidden);
            const canMake = !(await a.pg.isDisabled(SEL.make)); if (canMake) { await a.pg.click(SEL.make); await idle(a.pg); }
            const m8 = await txt(a.pg, 'fo-make-msg');
            ok(canMake && /2000-01-01에 불러온 화면/.test(m8) && (await saveN(a.pg)) === 0 && (await phaseOf(a.pg)) !== 'result', '⑦-8 날짜 가드: v2 안내 글이 #fo-make-msg 에 · 파일 안 만들어짐', m8.slice(0, 80));
            ok(a.errs.length === 0, '⑦-1·8 오류 0', a.errs.join(' | ')); await a.ctx.close();

            const mode2 = { coupang: 'fail' }; const b = await openFO(br, fx, mode2);
            await setCash(b.pg, null); await b.pg.click(SEL.start); await idle(b.pg);
            mode2.coupang = 'ok'; await b.pg.click(SEL.progress + ' [data-fo-load="retry"]'); await idle(b.pg);
            const f2 = await frameInfo(b.pg);
            ok((await phaseOf(b.pg)) === 'review' && f2.n === 34 && b.hits.coupang === 2 && b.hits.naver === 1, '⑦-1 다시 불러오기 → 실패한 쿠팡만 다시 불러 34건으로 판정 단계', JSON.stringify({ ...f2, hits: b.hits }));
            await b.ctx.close();

            const c = await openFO(br, fx, { naver: 'fail', cafe24: 'fail', coupang: 'fail' });
            await setCash(c.pg, null); await c.pg.click(SEL.start); await idle(c.pg);
            const b3 = await c.pg.evaluate(sel => ({ retry: !!document.querySelector(sel + ' [data-fo-load="retry"]'), skip: !!document.querySelector(sel + ' [data-fo-load="skip"]'), ph: window.AkmFinalOrder.state.phase }), SEL.progress);
            ok(b3.retry && !b3.skip && b3.ph !== 'review', '⑦-1 3채널 전부 실패 → [건너뛰기] 없음', JSON.stringify(b3));
            await c.ctx.close();
        }
        // ⑦-7 세션 만료
        console.log('\n⑦-7 세션 만료');
        {
            const a = await openFO(br, fx, { naver: '401' });
            await setCash(a.pg, null); await a.pg.click(SEL.start); await idle(a.pg);
            const m7 = (await txt(a.pg, 'fo-in-msg')) + ' ' + (await txt(a.pg, 'fo-make-msg'));
            ok(/로그인이 풀렸어요/.test(m7) && (await saveN(a.pg)) === 0 && (await phaseOf(a.pg)) !== 'review' && (await phaseOf(a.pg)) !== 'result', '⑦-7 불러오기 401 → 「로그인이 풀렸어요」 안내 · 판정·파일로 안 넘어감', m7.trim().slice(0, 80));
            await a.ctx.close();
        }
        // ⑦-3·2 현금파일 형식 오류 → 입력삭제인데 현금 줄 없음
        console.log('\n⑦-3·2 현금파일 형식 · 입력삭제인데 줄 없음');
        {
            const bad = writeXlsx(path.join(TMP, '가짜_형식오류.xlsx'), [['이름', '전화', '주소', '품목', '수량'], ['가짜', '010-0000-0000', '가짜시', '가짜품목', 1]]);
            const T_A = fx.naver.find(r => r['수취인명'] === '받는26')['구매자연락처'];
            const noA = writeXlsx(path.join(TMP, '가짜_A없음.xlsx'), fx.cashAoa.filter((r, i) => i === 0 || r[10] !== T_A));
            const lineA = fx.memo.split('\n')[0];
            const a = await openFO(br, fx, {});
            await a.pg.fill(SEL.memo, lineA); await setCash(a.pg, bad); await a.pg.click(SEL.start); await idle(a.pg);
            const fmtBtns = await a.pg.locator(`${SEL.card}[data-fo-card="${CARD.cashFormat}"] [data-fo-act]`).count();
            ok((await pend(a.pg, CARD.cashFormat)) === 1 && fmtBtns === 0 && (await a.pg.isDisabled(SEL.make)), '⑦-3 13칸이 아닌 파일 → 현금파일 형식 카드 1 · 버튼 없음 · [파일 만들기] 꺼짐', `버튼 ${fmtBtns}`);
            await setCash(a.pg, noA); await a.pg.click(SEL.rejudge); await idle(a.pg);
            ok((await pend(a.pg, CARD.cashFormat)) === 0, '⑦-3 바른 파일로 바꾸고 [다시 판정] → 형식 카드 사라짐');
            ok((await pend(a.pg, CARD.cashMissing)) === 1 && (await a.pg.isDisabled(SEL.make)), '⑦-2 입력삭제 줄은 있는데 현금파일에 그 구매자 줄 없음 → 카드 1 · [파일 만들기] 꺼짐', JSON.stringify(await cardCount(a.pg)));
            await a.pg.setInputFiles(SEL.cash, []); await setCash(a.pg, null); await a.pg.click(SEL.rejudge); await idle(a.pg);
            const p2 = await pend(a.pg, CARD.cashMissing);
            ok(p2 === 1 && (await a.pg.isDisabled(SEL.make)), '⑦-2 「오늘은 없음」 + 입력삭제 줄 → 같은 카드가 남아 있음', JSON.stringify(await cardCount(a.pg)));
            await resolveCards(a.pg, CARD.cashMissing); await resolveAll(a.pg);
            ok((await pend(a.pg, CARD.cashMissing)) === 0 && (await pendingN(a.pg)) === 0 && !(await a.pg.isDisabled(SEL.make)), '⑦-2 [주소 줄 없이 진행](skip) → 카드 처리 · [파일 만들기] 켜짐', `남은 카드 ${await pendingN(a.pg)}`);
            ok(a.hits.naver === 1 && a.errs.length === 0, '⑦-3·2 현금파일을 바꿔도 주문은 다시 안 불러옴 · 오류 0', JSON.stringify(a.hits) + ' ' + a.errs.join('|'));
            await a.ctx.close();
        }
        // ⑦-4·5·9·6 거래처 고르기 · 모두 오늘 발송 · 기준일 바꾸기 · 전부 저장
        console.log('\n⑦-4·5·9·6 거래처 고르기 · 모두 오늘 발송 · 기준일 바꾸기 · 전부 저장');
        {
            const oddOpt = '세상에 없는 과일 5kg';   // 단가표에 없는 이름(#525 부터 「표준 이름 + 손글씨 꼬리!」는 꼬리를 떼고 거래처를 찾으므로 아예 없는 이름으로)
            const odd = writeXlsx(path.join(TMP, '가짜_거래처없음.xlsx'), [...fx.cashAoa, ['현금손님 드림!', '010-7300-0000', fx.cashAoa[1][2], '현금받는P', oddOpt, 2, '010-7400-9999', '', '인천광역시 가짜구 현금로 99', '', '', '', '']]);
            const past = new Date(Date.parse(mp.realToday + 'T00:00:00Z') - 86400e3).toISOString().slice(0, 10);
            const memo = [`${FX.usd(past)}\t${FX.tel(9)}\t\t네이버`, `${FX.usd(past)}\t${FX.tel(10)}\t\t네이버`].join('\n');   // 지난 날짜 줄 2개 → 주문 확인 카드 2장 이상
            const a = await openFO(br, fx, {});
            await a.pg.fill(SEL.memo, memo); await setCash(a.pg, odd); await a.pg.click(SEL.start); await idle(a.pg);
            const before = await cardCount(a.pg); const ordN = (before[CARD.order] || { pending: 0 }).pending;
            const others = c => Object.entries(c).filter(([k]) => k !== CARD.order).map(([k, v]) => k + ':' + v.pending).sort().join();
            ok(ordN >= 2 && (await a.pg.locator(`${SEL.cards} [data-bulk="send"]`).count()) === 1, '⑦-5 남은 주문 확인 카드 2장 이상 → [남은 주문 모두 오늘 발송] 버튼', `주문 카드 ${ordN}`);
            await a.pg.click(`${SEL.cards} [data-bulk="send"]`); await a.pg.waitForTimeout(300);
            const after = await cardCount(a.pg);
            ok(((after[CARD.order] || { pending: 0 }).pending) === 0 && others(after) === others(before), '⑦-5 누르면 주문 확인 카드 전부 처리 · 다른 종류 카드는 그대로', others(after));
            ok((await pend(a.pg, CARD.partner)) === 1, '⑦-4 단가표에 없는 옵션 이름(현금 행) → 거래처 고르기 카드 1', JSON.stringify(after[CARD.partner] || {}));
            const pickSel = a.pg.locator(`${SEL.pending}[data-fo-card="${CARD.partner}"] select[data-pick]`).first();
            await pickSel.selectOption(FX.P_HYODON); await a.pg.waitForTimeout(300);
            ok((await pend(a.pg, CARD.partner)) === 0, '⑦-4 select[data-pick] 로 거래처를 고르면 카드 처리');
            // ⑦-9 기준 발송일 바꾸기
            await a.pg.selectOption(SEL.ship, later); await a.pg.waitForTimeout(300);
            ok(await a.pg.isDisabled(SEL.make), '⑦-9 기준 발송일을 바꾸면 [다시 판정] 전까지 [파일 만들기] 꺼짐');
            await a.pg.click(SEL.rejudge); await idle(a.pg);
            ok((await frameInfo(a.pg)).ship === later && a.hits.naver === 1, '⑦-9 [다시 판정] → 숨은 iframe 기준일 = 고른 날 · 주문은 다시 안 불러옴', (await frameInfo(a.pg)).ship);
            ok((await pend(a.pg, CARD.partner)) === 0, '⑦-9 다시 판정 뒤에도 거래처 고른 결정 유지');
            await resolveAll(a.pg);
            ok((await pendingN(a.pg)) === 0 && !(await a.pg.isDisabled(SEL.make)), '⑦-9 카드 전부 처리 → [파일 만들기] 켜짐', JSON.stringify(await cardCount(a.pg)));
            await a.pg.click(SEL.make); await idle(a.pg); await a.pg.waitForSelector(SEL.save, { timeout: 15000 });
            const md2 = `${later.slice(5, 7)}.${later.slice(8, 10)}`;
            const btnNames = await a.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save);
            ok(btnNames.length === 3 && btnNames.every(nm => nm.includes(' ' + md2 + '.')), '⑦-9 파일 이름 MM.DD = 바꾼 기준 발송일', btnNames.join(' | '));
            // ⑦-6 전부 저장
            const got = []; const onDl = d => got.push(d.suggestedFilename()); a.pg.on('download', onDl);
            const allTxt = (await a.pg.textContent(SEL.saveAll)).trim();
            await a.pg.click(SEL.saveAll); for (let i = 0; i < 40 && got.length < 3; i++) await a.pg.waitForTimeout(250); await a.pg.waitForTimeout(1500); const nAll = got.slice();
            await a.pg.locator(SEL.png).first().click(); for (let i = 0; i < 20 && got.length < nAll.length + 1; i++) await a.pg.waitForTimeout(250); await a.pg.waitForTimeout(300); a.pg.off('download', onDl);
            ok(nAll.length === 3 && nAll.every(x => /\.xlsx$/.test(x)) && /파일 3개 전부 저장/.test(allTxt) && got.length === 4 && /\.png$/.test(got[3]), '⑦-6 #548 [파일 3개 전부 저장] → 엑셀 3개만(수량 이미지 0) · 수량 이미지는 낱개 버튼으로 받아짐', allTxt + ' → ' + got.join(' | '));
            // ⑦-4 고른 거래처 파일에 그 행이 들어갔는가
            const hName = btnNames.find(nm => nm.includes('(효돈)'));
            const [d] = await Promise.all([a.pg.waitForEvent('download', { timeout: 20000 }), a.pg.locator(`[data-fo-save="${hName}"]`).click()]); const fo = path.join(TMP, 'partner.xlsx'); await d.saveAs(fo);
            const rowsP = XLSX.utils.sheet_to_json(XLSX.readFile(fo).Sheets.Sheet1, { header: 1, defval: '' }).slice(1); const ip = rowsP.findIndex(r => r[3] === '현금받는P');
            const isJ = r => String(r[8]).trim().startsWith('제주'); const topP = rowsP.filter(r => !isJ(r));
            ok(ip >= 0 && rowsP[ip][4] === oddOpt && topP.every((r, i) => i === 0 || String(topP[i - 1][4]).localeCompare(String(r[4]), 'ko') <= 0), '⑦-4 고른 거래처(효돈) 파일에 그 행 · 옵션 이름 그대로 · 정렬은 그 이름 기준', ip >= 0 ? `${ip + 2}행 · ${rowsP[ip][4]}` : '없음');
            ok(a.errs.length === 0, '⑦-4·5·9·6 오류 0', a.errs.join(' | ')); await a.ctx.close();
        }

        // ⑧ 결함 검토 뒤 보탠 흐름 ───────────────────────────────────────────────
        const fState = (pg2, nm) => pg2.evaluate(([sel, nm]) => { const i = document.querySelector(sel).contentWindow.__ivt; const e = i.S.merged.find(x => x.conv['수취인명'] === nm); return e ? { excluded: !!e.excluded, kind: e.reqKind || null, individual: !!e.individual } : null; }, [SEL.hidden, nm]);
        const cardOf2 = (pg2, text) => pg2.locator(`${SEL.card}[data-fo-card="${CARD.senderMemo}"][data-fo-done]`, { hasText: text }).first();   // 처리 끝난 손님 보내는이 카드
        const cardOf = (pg2, type, text) => pg2.locator(`${SEL.pending}[data-fo-card="${type}"]`, { hasText: text }).first();
        const saveFile = async (pg2, part) => { const nm = (await pg2.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save)).find(x => x.includes(part)); const [d] = await Promise.all([pg2.waitForEvent('download', { timeout: 20000 }), pg2.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 'x-' + Date.now() + '.xlsx'); await d.saveAs(f); return XLSX.utils.sheet_to_json(XLSX.readFile(f).Sheets.Sheet1, { header: 1, defval: '' }).slice(1).map(r => r[3]); };
        // ⑧-e·a·c 실행 중 입력 잠금 · 판정 실패와 복구 · 「제외」로 정한 주문을 메모무시 줄로 되살리기
        console.log('\n⑧-e·a·c 실행 중 입력 잠금 · 판정 실패/복구 · 제외 → 메모무시');
        {
            const mode = { delayNaver: 1500, memoParse: 'ok' }; const a = await openFO(br, fx, mode);
            await setCash(a.pg, null); await a.pg.click(SEL.start); await a.pg.waitForTimeout(500);
            const lock = await a.pg.evaluate(sel => ({ busy: document.querySelector(sel.panel).classList.contains('busy'), memo: document.querySelector(sel.memo).disabled, ship: document.querySelector(sel.ship).disabled, none: document.querySelector(sel.cashNone).disabled }), SEL);
            ok(lock.busy && lock.memo && lock.ship && lock.none, '⑧-e 실행 중(busy)에는 메모·기준일·「없음」 입력이 잠김', JSON.stringify(lock));
            await idle(a.pg); await a.pg.waitForSelector(SEL.card, { timeout: 15000 });
            ok(!(await a.pg.isDisabled(SEL.memo)), '⑧-e 끝나면 메모 입력 다시 풀림');
            await cardOf(a.pg, CARD.order, '받는19').locator('[data-fo-act="excl"]').click(); await a.pg.waitForTimeout(150);
            await resolveAll(a.pg);
            ok((await fState(a.pg, '받는19')).excluded && !(await a.pg.isDisabled(SEL.make)), '⑧-c 주문 확인 [제외] → 그 주문 제외 · 카드 전부 처리 → [파일 만들기] 켜짐');
            // a. 메모 해석 API 실패
            mode.memoParse = 'fail'; await a.pg.fill(SEL.memo, ' '); await a.pg.click(SEL.rejudge); await idle(a.pg);
            const ma = (await txt(a.pg, 'fo-make-msg')) + ' ' + (await txt(a.pg, 'fo-in-msg'));
            ok(/판정을 끝내지 못했/.test(ma) && (await a.pg.isDisabled(SEL.make)) && (await saveN(a.pg)) === 0, '⑧-a 메모 해석 API 실패 → 「판정을 끝내지 못했어요」 · [파일 만들기] 꺼짐 · 저장 버튼 없음', ma.trim().slice(0, 90));
            mode.memoParse = 'ok'; await a.pg.click(SEL.rejudge); await idle(a.pg);
            ok((await pendingN(a.pg)) === 0 && !(await a.pg.isDisabled(SEL.make)) && (await fState(a.pg, '받는19')).excluded && a.hits.naver === 1, '⑧-a 정상으로 돌려 [다시 판정] → 복구(결정 유지 · 주문 재조회 없음)', `남은 카드 ${await pendingN(a.pg)}`);
            // c. 제외로 정한 주문에 기준일 메모무시 줄
            await a.pg.fill(SEL.memo, `${FX.usd(ship)}\t${FX.tel(19)}\t메모무시\t네이버`); await a.pg.click(SEL.rejudge); await idle(a.pg);
            const s19 = await fState(a.pg, '받는19');
            ok(s19 && !s19.excluded && s19.kind === 'today', '⑧-c 그 주문에 「기준일 ⇥ 번호 ⇥ 메모무시」 줄 + [다시 판정] → 그날 발송으로 바뀜(앞의 [제외] 결정보다 줄이 우선)', JSON.stringify(s19));
            await resolveAll(a.pg);
            if (!(await a.pg.isDisabled(SEL.make))) { await a.pg.click(SEL.make); await idle(a.pg); await a.pg.waitForSelector(SEL.save, { timeout: 15000 }); ok((await saveFile(a.pg, '(효돈)')).includes('받는19'), '⑧-c 그 주문이 택배사 파일(효돈)에 들어감'); }
            else ok(false, '⑧-c 파일 만들기까지 진행', `남은 카드 ${JSON.stringify(await cardCount(a.pg))} · ${await txt(a.pg, 'fo-make-msg')}`);
            ok(a.errs.length === 0, '⑧-e·a·c 오류 0', a.errs.join(' | ')); await a.ctx.close();
        }
        // ⑧-b·d 쿠팡 취소 뒤에도 남은 주문의 결정이 제 주문에 · 날이 바뀌면 막힘 → 다시 불러오기
        console.log('\n⑧-b·d 쿠팡 취소 뒤 결정 유지 · 날짜 바뀜 → 다시 불러오기');
        {
            const cp3 = [1, 2, 3].map(n => ({ ...fx.coupang[0], '구매자': '쿠팡구매' + n, '수취인이름': '쿠팡받는' + n, '구매자전화번호': '0505-700-100' + n, '수취인전화번호': '0505-700-200' + n, '수취인 주소': '대구광역시 가짜구 시험로 ' + n, '배송메세지': '다음주에 보내주세요', _orderId: 'FAKECP' + n }));
            const fxB = { ...fx, coupang: cp3, canceledCoupang: ['FAKECP2'] };   // 가운데 주문이 파일 만들기 때 취소 → 뒤 주문의 순번이 당겨진다
            const hitsB = { naver: 0, cafe24: 0, coupang: 0, cancel: 0 }; const ctxB = await newCtx(br, fxB, hitsB, { width: 1400, height: 900 }, false, {});
            let clockOk = true; try { await ctxB.clock.install(); } catch (e) { clockOk = false; }
            const pb = await ctxB.newPage(); const errB = []; pb.on('pageerror', e => errB.push(e.message)); pb.on('dialog', d => d.accept());
            await pb.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pb.waitForTimeout(2500); await pb.evaluate(() => switchPage('agent-office')); await pb.waitForTimeout(1000);
            await pb.click(SEL.btn); await pb.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
            await pb.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await idle(pb);
            await setCash(pb, null); await pb.click(SEL.start); await idle(pb); await pb.waitForSelector(SEL.card, { timeout: 15000 });
            const has3 = (await cardOf(pb, CARD.order, '쿠팡받는1').count()) && (await cardOf(pb, CARD.order, '쿠팡받는2').count()) && (await cardOf(pb, CARD.order, '쿠팡받는3').count());
            ok(!!has3, '⑧-b 쿠팡 3건 모두 주문 확인 카드(날짜 애매 메모)');
            await cardOf(pb, CARD.order, '쿠팡받는3').locator('[data-fo-act="excl"]').click(); await pb.waitForTimeout(150);
            await cardOf(pb, CARD.order, '쿠팡받는1').locator('[data-fo-act="send"]').click(); await pb.waitForTimeout(150);
            await resolveAll(pb);
            await pb.click(SEL.make); await idle(pb); await pb.waitForSelector(SEL.save, { timeout: 15000 });
            const d1 = await saveFile(pb, '(대성)');
            ok(hitsB.cancel >= 1 && d1.includes('쿠팡받는1') && !d1.includes('쿠팡받는2') && !d1.includes('쿠팡받는3'), '⑧-b 파일 만들기: 취소된 쿠팡 1건 빠짐 · [오늘 발송] 주문은 들어가고 [제외] 주문은 없음', `쿠팡 행 ${d1.filter(x => /^쿠팡/.test(x)).join(',')}`);
            await pb.fill(SEL.memo, `${FX.usd(ship)}\t010-7999-0000\t\t네이버`); await pb.click(SEL.rejudge); await idle(pb);
            const s1 = await fState(pb, '쿠팡받는1'), s2 = await fState(pb, '쿠팡받는2'), s3 = await fState(pb, '쿠팡받는3');
            ok(s2 === null && s1 && !s1.excluded && s3 && s3.excluded && (await pend(pb, CARD.order)) === 0, '⑧-b 취소 뒤 [다시 판정]: 남은 2건의 결정이 제 주문에 그대로(발송 / 제외) · 주문 카드 다시 안 뜸', JSON.stringify({ s1, s2, s3, 남은주문카드: await pend(pb, CARD.order) }));
            await resolveAll(pb);
            if (!(await pb.isDisabled(SEL.make))) { await pb.click(SEL.make); await idle(pb); await pb.waitForSelector(SEL.save, { timeout: 15000 }); const d2 = await saveFile(pb, '(대성)'); ok(d2.includes('쿠팡받는1') && !d2.includes('쿠팡받는3') && !d2.includes('쿠팡받는2'), '⑧-b 다시 만든 파일도 같은 결과', d2.filter(x => /^쿠팡/.test(x)).join(',')); }
            else ok(false, '⑧-b 다시 판정 뒤 파일 만들기 가능', `${JSON.stringify(await cardCount(pb))} · ${await txt(pb, 'fo-make-msg')}`);
            // d. 날이 바뀜
            if (clockOk) {
                const naverBefore = hitsB.naver;
                await ctxB.clock.setSystemTime(new Date(Date.now() + 26 * 3600e3)); await pb.waitForTimeout(300);
                await pb.fill(SEL.memo, ''); await pb.click(SEL.rejudge); await idle(pb);
                const md = (await txt(pb, 'fo-make-msg')) + ' ' + (await txt(pb, 'fo-in-msg'));
                ok(/불러왔어요/.test(md) && (await pb.isDisabled(SEL.make)) && hitsB.naver === naverBefore, '⑧-d 브라우저 날짜가 다음 날 → [다시 판정] 막힘(「주문을 M/D에 불러왔어요 …」) · [파일 만들기] 꺼짐', md.trim().slice(0, 90));
                const hasReload = await pb.locator('#fo-reload').isVisible();
                if (hasReload) { await pb.click('#fo-reload'); await idle(pb); }
                const mr = (await txt(pb, 'fo-make-msg')) + ' ' + (await txt(pb, 'fo-in-msg'));
                ok(hasReload && hitsB.naver === naverBefore + 1 && (await phaseOf(pb)) === 'review' && !/불러왔어요/.test(mr), '⑧-d [주문 다시 불러오기](#fo-reload) → 3채널 재조회 뒤 판정 단계로 진행', `네이버 호출 ${naverBefore} → ${hitsB.naver} · ${await phaseOf(pb)} · ${mr.trim().slice(0, 60)}`);
            } else note('⑧-d 브라우저 시계 바꾸기 불가(이 Playwright 판에 clock 없음) — 미검증');
            ok(errB.length === 0, '⑧-b·d 오류 0', errB.join(' | ')); await ctxB.close();
        }

        // ⑨ #509 손님 메모가 애매한 보내는이 카드에서 바로 적어 넣기 ─────────────────────
        console.log('\n⑨ #509 보내는이 카드(손님 메모 애매)에서 바로 적기');
        {
            const base = fx.naver.find(r => r['수취인명'] === '받는21');
            const mk9 = (n, buyer, memo) => ({ ...base, '구매자명': buyer, '구매자연락처': '010-7000-19' + n, '수취인명': '받는' + n, '수취인연락처1': '010-7100-19' + n, '통합배송지': '서울특별시 가짜구 시험로 ' + n, '배송메세지': memo, _pid: '20990101009' + n, _x: { ...base._x, productOrderId: '20990101009' + n, orderId: '209901019' + n } });
            const M91 = '보내는이: 홍길동 즐거운 명절 보내세요', M92 = '보내는 사람은 서울시 가짜구 김구매 으로 표기', M94 = '배송 전에 미리 연락주세요', M96 = '퇴근 이후 배송 부탁드립니다';
            const M97 = '115동 1202호\n박구매으로 보내는사람 적어주세요', M98 = '101동 202호\n최구매으로 보내는사람 적어주세요';   // #511 대표 예시 꼴(동호수 + 보내는이 부탁)
            const fx9 = { ...fx, naver: [mk9(91, '시험구매91', M91), mk9(92, '김구매', M92), mk9(93, '시험구매93', ''),
                mk9(94, '시험구매94', M94), mk9(95, '시험구매95', '10일까지 보내주세요'), mk9(96, '시험구매96', M96),
                mk9(97, '박구매', M97), mk9(98, '최구매', M98)], cafe24: [], coupang: [], canceledCoupang: [] };
            const a = await openFO(br, fx9, {});
            await setCash(a.pg, null); await a.pg.click(SEL.start); await idle(a.pg); await a.pg.waitForSelector(SEL.card, { timeout: 15000 });
            // #510 「전에·이전·이후·까지」만 걸린 흔한 손님 메모는 주문 확인 카드가 아니다(v2 판정은 그대로)
            const f10 = await a.pg.evaluate(sel => { const i = document.querySelector(sel).contentWindow.__ivt; const g = nm => { const e = i.S.merged.find(x => x.conv['수취인명'] === nm); return { flag: e.flag || null, excl: !!e.excluded, parse: !!e.parse }; }; return { 94: g('받는94'), 95: g('받는95'), 96: g('받는96') }; }, SEL.hidden);
            const o10 = { 94: await cardOf(a.pg, CARD.order, '받는94').count(), 95: await cardOf(a.pg, CARD.order, '받는95').count(), 96: await cardOf(a.pg, CARD.order, '받는96').count(), all: await pend(a.pg, CARD.order) };
            ok(o10[94] === 0 && o10[96] === 0 && !f10[94].excl && !f10[96].excl, '⑩ #510 「배송 전에 미리 연락주세요」·「퇴근 이후 배송 부탁」 = 주문 확인 카드 없음 · 제외도 아님', JSON.stringify({ 카드: o10, v2: f10 }));
            ok(o10[95] === 1 && o10.all === 1, '⑩ #510 「10일까지 보내주세요」(날짜 표현) = 주문 확인 카드 뜸 · 주문 카드는 이 1장뿐', JSON.stringify(o10));
            note('⑩ 참고: 같은 주문의 v2 판정(flag)', JSON.stringify(f10));
            const c91 = () => cardOf(a.pg, CARD.senderMemo, '받는91'), c92 = () => cardOf(a.pg, CARD.senderMemo, '받는92');
            const pre = { n: await pend(a.pg, CARD.senderMemo), v91: await c91().locator('[data-f="name"]').inputValue(), v92: await c92().locator('[data-f="name"]').inputValue(), use: await c91().locator('[data-fo-act="use"]').count(), keep: await c91().locator('[data-fo-act="keep"]').count() };
            ok(pre.n === 4 && pre.use === 1 && pre.keep === 1, '⑨ 손님 보내는이 애매 카드 4장 · 입력칸 + [이대로 넣기]·[안 바꿈]', JSON.stringify(pre));
            // #511 배송메세지 고쳐 넣기: 97 = 동호수만 남김 · 98 = 비움(기본 문구) · 91 = 안 건드림 · 92 = (나중에) 안 바꿈
            const c97 = () => cardOf(a.pg, CARD.senderMemo, '받는97'), c98 = () => cardOf(a.pg, CARD.senderMemo, '받는98');
            const m97 = (await c97().locator('[data-f="memo"]').inputValue()).replace(/\r/g, ''), n97 = await c97().locator('[data-f="name"]').inputValue(), lineMemo = await a.pg.locator(`${SEL.card}[data-fo-card="${CARD.senderLine}"] [data-f="memo"]`).count();
            ok(m97 === '115동 1202호' && n97 === '박구매' && lineMemo === 0, '⑪ #516 카드의 배송메세지 칸 = 보내는이 부탁 글을 뺀 나머지(「115동 1202호」)로 미리 채움 · 이름 칸 = 구매자 이름', JSON.stringify([m97, n97]));
            await c97().locator('[data-f="memo"]').fill('115동 1202호'); await c97().locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            await c98().locator('[data-f="memo"]').fill(''); await c98().locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            // #512 뒤: 이름 칸 = 「보내는이」 낱말 뒤 글자(core.senderHint) → 사람이 다듬는다. 여기서는 그 글자에 이름이 들어 있는지만 본다(정확한 값은 ⑫에서)
            ok(pre.v92 === '김구매' && pre.v91 === '홍길동', '⑨ 이름 칸 미리 채움: 메모에서 이름만(뒤 인사말·앞 주소 글 뺌)', `받는92 「${pre.v92}」 · 받는91 「${pre.v91}」`);
            await c91().locator('[data-f="name"]').fill('홍길동'); await c91().locator('[data-f="phone"]').fill('010-5555-0091'); await c91().locator('[data-f="addr"]').fill('서울 가짜구 보내는로 91');
            await c91().locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            await c92().locator('[data-f="name"]').fill('김구매');   // 미리 채운 글(「서울시 가짜구 김구매」)을 사람이 다듬는 경우 — 누르기 직전에 적는다(다른 카드를 누르면 카드 목록이 다시 그려진다)
            await c92().locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            ok((await pend(a.pg, CARD.senderMemo)) === 0, '⑨ [이대로 넣기] 2건 → 카드 처리');
            await a.pg.fill(SEL.memo, `${FX.usd(ship)}\t010-7999-0000\t\t네이버`); await a.pg.click(SEL.rejudge); await idle(a.pg);
            ok((await pend(a.pg, CARD.senderMemo)) === 0 && a.hits.naver === 1, '⑨ [다시 판정] 뒤에도 적어 넣은 결정 유지(카드 다시 안 뜸 · 주문 재조회 없음)', JSON.stringify(await cardCount(a.pg)));
            await resolveAll(a.pg);
            const grab9 = async () => { await a.pg.click(SEL.make); await idle(a.pg); await a.pg.waitForSelector(SEL.save, { timeout: 15000 }); const nm = (await a.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save)).find(x => x.includes('(효돈)')); const [d] = await Promise.all([a.pg.waitForEvent('download', { timeout: 20000 }), a.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 's9-' + Date.now() + '.xlsx'); await d.saveAs(f); const s1 = XLSX.readFile(f, { cellStyles: true }).Sheets.Sheet1; const rows = XLSX.utils.sheet_to_json(s1, { header: 1, defval: '' }); const at = nm2 => { const i = rows.findIndex(r => r[3] === nm2); return i < 0 ? null : { r: rows[i], f: c => fillOf(s1[c + (i + 1)]) }; }; return at; };
            let at = await grab9(); const r91 = at('받는91'), r92 = at('받는92'), r93 = at('받는93');
            ok(!!r91 && r91.r[0] === '홍길동 드림' && String(r91.r[1]) === '010-5555-0091' && r91.r[12] === '서울 가짜구 보내는로 91' && r91.f('A') === 'DDEBF7' && r91.f('B') === 'DDEBF7' && r91.f('M') === 'DDEBF7', '⑨ 이름·번호·주소를 적은 주문: A 「이름 드림」 · B 번호 · M 주소 + 세 칸 연파랑', r91 && JSON.stringify([r91.r[0], r91.r[1], r91.r[12], r91.f('A'), r91.f('B'), r91.f('M')]));
            ok(!!r92 && r92.r[0] === '김구매 드림' && r92.f('A') === 'DDEBF7' && String(r92.r[1]) === '010-7000-1992' && r92.f('B') !== 'DDEBF7' && String(r92.r[12]) === '', '⑨ 이름만 넣은 주문: A만 바뀜 · B(구매자 번호)·M 그대로', r92 && JSON.stringify([r92.r[0], r92.r[1], r92.r[12], r92.f('B')]));
            // #516: 카드의 배송메세지 칸은 「보내는이 부탁 글을 뺀 나머지」로 미리 채워진다 → 안 건드리고 넣으면 그 글(없으면 기본 문구) · 보통 칸 서식
            ok(!!r91 && r91.r[9] === '즐거운 명절 보내세요' && !r91.f('J') && !!r92 && r92.r[9] === FX.DEFAULT_MEMO && !r92.f('J'), '⑨ 배송메세지 칸을 안 건드리고 넣기 → J = 부탁 글을 뺀 나머지(「즐거운 명절 보내세요」) · 남는 글이 없으면 기본 문구 · 채움색 없음', r91 && r92 && JSON.stringify([r91.r[9], r91.f('J'), r92.r[9]]));
            ok(!!r93 && /\(제주아꼼이네\)$/.test(r93.r[0]) && r93.f('A') !== 'DDEBF7', '⑨ 다른 주문은 보내는사람 무변경');
            const r97 = at('받는97'), r98 = at('받는98');
            ok(!!r97 && r97.r[9] === '115동 1202호' && !r97.f('J') && r97.r[0] === '박구매 드림' && r97.f('A') === 'DDEBF7', '⑪ #511 배송메세지를 고쳐 넣은 주문: J = 고친 글 · J 채움색 없음 · A 「이름 드림」+연파랑', r97 && JSON.stringify([r97.r[9], r97.f('J'), r97.r[0], r97.f('A')]));
            ok(!!r98 && r98.r[9] === FX.DEFAULT_MEMO && !r98.f('J') && r98.r[0] === '최구매 드림', '⑪ #511 배송메세지 칸을 비우고 넣은 주문: J = 기본 문구', r98 && JSON.stringify([r98.r[9], r98.f('J')]));
            {   // 스토어 파일(v2 시트2)의 배송메세지는 어느 경우든 원문
                const nmS = (await a.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save)).find(x => x.includes('스마트스토어'));
                const [d] = await Promise.all([a.pg.waitForEvent('download', { timeout: 20000 }), a.pg.locator(`[data-fo-save="${nmS}"]`).click()]); const f = path.join(TMP, 's9-store.xlsx'); await d.saveAs(f);
                const rs = XLSX.utils.sheet_to_json(XLSX.readFile(f).Sheets['발주발송관리'], { header: 1, defval: '' }); const mOf = nm => { const r = rs.find(x => x[6] === nm); return r ? String(r[12]).replace(/\r/g, '') : null; };
                ok(mOf('받는97') === M97 && mOf('받는98') === M98 && mOf('받는91') === M91 && mOf('받는92') === M92, '⑪ #511 스토어 파일(발주발송관리)의 배송메세지는 전부 손님 원문 그대로', JSON.stringify([mOf('받는97'), mOf('받는98')]));
            }
            const r94 = at('받는94'), r96 = at('받는96');
            ok(!!r94 && r94.r[9] === M94 && !!r96 && r96.r[9] === M96, '⑩ #510 카드 없이 넘어간 두 주문이 택배사 파일에 있음 · 배송메세지 원문 그대로', r94 && r96 && `${r94.r[9]} | ${r96.r[9]}`);
            // 되돌려 [안 바꿈]
            await cardOf2(a.pg, '받는92').locator('[data-undo]').click(); await a.pg.waitForTimeout(200);
            ok((await pend(a.pg, CARD.senderMemo)) === 1, '⑨ [바꾸기] → 카드가 다시 열림', JSON.stringify((await cardCount(a.pg))[CARD.senderMemo]));
            await c92().locator('[data-fo-act="keep"]').click(); await a.pg.waitForTimeout(150);
            at = await grab9(); const k92 = at('받는92'), k91 = at('받는91');
            ok(!!k92 && k92.r[0] === '김구매(제주아꼼이네)' && k92.f('A') !== 'DDEBF7' && !!k91 && k91.r[0] === '홍길동 드림', '⑨ [안 바꿈]으로 되돌린 주문 = 보내는사람 원래 값 · 다른 주문의 결정은 그대로', k92 && k92.r[0]);
            const k97 = at('받는97');
            ok(!!k92 && k92.r[9] === M92 && k92.f('J') === 'FFF2CC' && !!k97 && k97.r[9] === '115동 1202호', '⑪ #511 [안 바꿈] 주문의 J = 원문 + 연노랑 · 고쳐 넣은 다른 주문은 다시 만들어도 고친 글', k92 && JSON.stringify([k92.r[9], k92.f('J')]));
            ok(a.errs.length === 0, '⑨ 오류 0', a.errs.join(' | ')); await a.ctx.close();
        }
        // ⑫ #512 실파일 시험 뒤 보탠 규칙: 묶음 카드 · 미리 채움 · 이름뿐인 메모 · 기준일 당일 날짜 · 자동 제외 주문 ─────────
        console.log('\n⑫ #512 묶음 카드 · 미리 채움 · 이름뿐인 메모 · 기준일 당일 날짜');
        {
            const base = fx.naver.find(r => r['수취인명'] === '받는21'); const WD = ['일', '월', '화', '수', '목', '금', '토'];
            const dOf = iso => `${+iso.slice(8, 10)}일(${WD[new Date(iso + 'T00:00:00Z').getUTCDay()]})`;
            let seq = 0; const mk = (nm, buyer, tel, memo, qty) => { seq++; return { ...base, '구매자명': buyer, '구매자연락처': tel, '수취인명': nm, '수취인연락처1': '010-7100-3' + String(100 + seq), '통합배송지': '서울특별시 가짜구 묶음로 ' + seq, '배송메세지': memo, '수량': qty || 1, _pid: '2099010200' + String(100 + seq), _x: { ...base._x, productOrderId: '2099010200' + String(100 + seq), orderId: '2099010200' + String(100 + seq) } }; };
            const MC = '보내는사람 변경요청 ( 박묶음 010-5555-0777 )';
            const fx12 = { ...fx, cafe24: [], coupang: [], canceledCoupang: [], naver: [
                mk('묶음A1', '가묶음', '010-7000-3001', '다음주에 보내주세요'), mk('묶음A2', '가묶음', '010-7000-3001', '다음주에 보내주세요'), mk('묶음A3', '가묶음', '010-7000-3001', '다음주에 보내주세요'),   // ⓐ send
                mk('묶음B1', '나묶음', '010-7000-3002', '다음주에 보내주세요'), mk('묶음B2', '나묶음', '010-7000-3002', '다음주에 보내주세요'), mk('묶음B3', '나묶음', '010-7000-3002', '다음주에 보내주세요'),   // ⓐ excl → 되돌리기
                mk('묶음C1', '박묶음', '010-7000-3003', MC), mk('묶음C2', '박묶음', '010-7000-3003', MC),                                                   // ⓑ·ⓔ 제3의 번호
                mk('본인D', '최본인', '010-7000-2004', '보내는사람 변경요청 ( 최본인 010-7000-2004 )'),                                                    // ⓔ 구매자 번호와 같음
                mk('이름E', '시험구매E', '010-7000-3005', '김민수'), mk('문앞F', '시험구매F', '010-7000-3006', '문앞'), mk('경비G', '시험구매G', '010-7000-3007', '경비실'),   // ⓒ
                mk('앞이름H', '시험구매H', '010-7000-3008', '이순신으로 보내는사람 적어주세요'),                                                         // ⓓ
                mk('당일I', '시험구매I', '010-7000-3009', `전부 ${dOf(ship)}에 출고 부탁드려요!!`), mk('다른날J', '시험구매J', '010-7000-3010', `전부 ${dOf(later)}에 출고 부탁드려요!!`),   // ⓕ
                mk('제외K', '시험구매K', '010-7000-3011', `${+later.slice(5, 7)}월 ${+later.slice(8, 10)}일 발송 부탁드려요 보내는분 가나다 서울 가짜구 가짜로 1 010-5555-0888`),   // ⓖ
            ] };
            const a = await openFO(br, fx12, {});
            await setCash(a.pg, null); await a.pg.click(SEL.start); await idle(a.pg); await a.pg.waitForSelector(SEL.card, { timeout: 15000 });
            const J12 = (await readJudge(a.pg)).judge; const cc = await cardCount(a.pg);
            const oc = t => cardOf(a.pg, CARD.order, t), sc = t => cardOf(a.pg, CARD.senderMemo, t), doneCard = (type, t) => a.pg.locator(`${SEL.card}[data-fo-card="${type}"][data-fo-done]`, { hasText: t }).first();
            const exOf = async nms => (await Promise.all(nms.map(nm => fState(a.pg, nm)))).map(s => s && s.excluded);
            // ⓐ 묶음 주문 확인 카드
            const tA = (await oc('묶음A1').count()) ? await oc('묶음A1').innerText() : '';
            const nCards = (type, t) => a.pg.locator(`${SEL.pending}[data-fo-card="${type}"]`, { hasText: t }).count();   // 그 글이 든 남은 카드 장수(묶음 카드는 본문에 묶인 주문이 다 적힌다)
            ok((await nCards(CARD.order, '가묶음')) === 1 && /외\s*2건/.test(tA) && /묶음A2/.test(tA) && /묶음A3/.test(tA) && (await nCards(CARD.order, '나묶음')) === 1, '⑫ⓐ 같은 구매자·같은 메모 3건 → 주문 확인 카드 1장(「외 2건」) · 다른 구매자는 따로', tA.replace(/\s+/g, ' ').slice(0, 90));
            await oc('묶음A1').locator('[data-fo-act="send"]').click(); await a.pg.waitForTimeout(200);
            ok((await exOf(['묶음A1', '묶음A2', '묶음A3'])).every(x => x === false) && (await oc('묶음A1').count()) === 0, '⑫ⓐ [오늘 발송] 한 번 → 묶음 3건 모두 발송 · 카드 처리');
            await oc('묶음B1').locator('[data-fo-act="excl"]').click(); await a.pg.waitForTimeout(200);
            ok((await exOf(['묶음B1', '묶음B2', '묶음B3'])).every(x => x === true), '⑫ⓐ [제외] 한 번 → 묶음 3건 모두 빠짐', JSON.stringify(await exOf(['묶음B1', '묶음B2', '묶음B3'])));
            await doneCard(CARD.order, '묶음B1').locator('[data-undo]').click(); await a.pg.waitForTimeout(200);
            ok((await oc('묶음B1').count()) === 1 && (await exOf(['묶음B1', '묶음B2', '묶음B3'])).every(x => x === false), '⑫ⓐ [바꾸기]로 되돌리면 카드가 다시 열리고 3건 모두 제외 풀림', JSON.stringify(await exOf(['묶음B1', '묶음B2', '묶음B3'])));
            await oc('묶음B1').locator('[data-fo-act="excl"]').click(); await a.pg.waitForTimeout(200);
            // ⓑ·ⓔ 묶음 보내는이 카드 + 번호 미리 채움
            const vC = { n: await nCards(CARD.senderMemo, '박묶음'), n2: 0, name: await sc('묶음C1').locator('[data-f="name"]').inputValue(), phone: await sc('묶음C1').locator('[data-f="phone"]').inputValue() };
            ok(vC.n === 1 && vC.n2 === 0 && vC.name === '박묶음' && vC.phone.replace(/\D/g, '') === '01055550777', '⑫ⓑⓔ 같은 구매자·같은 보내는이 메모 2건 → 카드 1장 · 이름 칸 = 메모의 이름 · 번호 칸 = 메모의 제3의 번호', JSON.stringify(vC));
            const vD = { name: await sc('본인D').locator('[data-f="name"]').inputValue(), phone: await sc('본인D').locator('[data-f="phone"]').inputValue() };
            ok(vD.name === '최본인' && vD.phone === '', '⑫ⓔ 메모의 번호가 구매자 번호와 같으면 번호 칸 빈칸', JSON.stringify(vD));
            // ⓒ 이름뿐인 메모
            const vE = { v2: J12['이름E'].sender, n: await sc('이름E').count(), name: (await sc('이름E').count()) ? await sc('이름E').locator('[data-f="name"]').inputValue() : null, f: await a.pg.locator(`${SEL.card}`, { hasText: '문앞F' }).count(), g: await a.pg.locator(`${SEL.card}`, { hasText: '경비G' }).count() };
            ok(vE.v2 === null && vE.n === 1 && vE.name === '김민수' && vE.f === 0 && vE.g === 0, '⑫ⓒ 이름뿐인 메모(v2는 판정 안 함) → 보내는이 카드 · 이름 칸 = 그 이름 / 「문앞」「경비실」은 카드 없음', JSON.stringify(vE));
            // ⓓ 앞에 오는 이름
            const vH = await sc('앞이름H').locator('[data-f="name"]').inputValue();
            ok(vH === '이순신', '⑫ⓓ 「○○○으로 보내는사람 적어주세요」 → 이름 칸 = ○○○(구매자 이름이 아니어도)', vH);
            // ⓕ 기준일 당일 날짜 메모
            const vI = { card: await a.pg.locator(SEL.card, { hasText: '당일I' }).count(), st: J12['당일I'], jCard: await oc('다른날J').count(), jSt: J12['다른날J'] };
            ok(vI.card === 0 && !vI.st.excluded, '⑫ⓕ 기준일 당일을 집은 날짜 메모 → 카드 없음 · 그대로 발송', JSON.stringify({ 카드: vI.card, v2: vI.st.flag }));
            ok(vI.jCard === 1 || vI.jSt.excluded, '⑫ⓕ 다른 날짜를 집은 메모 → 그냥 나가지 않음(주문 확인 카드 또는 자동 제외)', JSON.stringify({ 카드: vI.jCard, 제외: vI.jSt.excluded, flag: vI.jSt.flag }));
            // ⓖ 자동 제외 주문
            const vK = { st: J12['제외K'], card: await a.pg.locator(SEL.card, { hasText: '제외K' }).count() };
            ok(vK.st.excluded && vK.st.sender === 'amb' && vK.card === 0, '⑫ⓖ 자동 제외(오늘 안 나감) 주문의 보내는이 애매 메모 → 카드 없음', JSON.stringify(vK));
            ok(((cc[CARD.order] || {}).pending || 0) === 2 + vI.jCard && ((cc[CARD.senderMemo] || {}).pending || 0) === 4, '⑫ 카드 수: 주문 확인 = 묶음 2(+다른 날짜 카드) · 보내는이 = 4(묶음 C · 본인 D · 이름뿐 E · 앞이름 H)', JSON.stringify(cc));
            // 파일까지
            // 적다 만 글 유지: 카드 H에 주소·배송메세지를 적어 두고 다른 카드 C를 먼저 누른다
            await sc('앞이름H').locator('[data-f="addr"]').fill('적다 만 주소'); await sc('앞이름H').locator('[data-f="memo"]').fill('적다 만 메모');
            await sc('묶음C1').locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            const keepH = { addr: await sc('앞이름H').locator('[data-f="addr"]').inputValue(), memo: await sc('앞이름H').locator('[data-f="memo"]').inputValue(), name: await sc('앞이름H').locator('[data-f="name"]').inputValue() };
            ok(keepH.addr === '적다 만 주소' && keepH.memo === '적다 만 메모' && keepH.name === '이순신', '⑫ 다른 카드를 처리해도, 아직 안 누른 카드에 적어 둔 글이 그대로', JSON.stringify(keepH));
            await sc('앞이름H').locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            // [바꾸기] → 앞서 넣은 값에서 이어 고침
            await doneCard(CARD.senderMemo, '박묶음').locator('[data-undo]').click(); await a.pg.waitForTimeout(200);
            const reC = { n: await nCards(CARD.senderMemo, '박묶음'), name: await sc('묶음C1').locator('[data-f="name"]').inputValue(), phone: (await sc('묶음C1').locator('[data-f="phone"]').inputValue()).replace(/\D/g, '') };
            ok(reC.n === 1 && reC.name === '박묶음' && reC.phone === '01055550777', '⑫ [바꾸기]로 다시 연 카드 = 앞서 넣은 이름·번호가 입력칸에 그대로', JSON.stringify(reC));
            await sc('묶음C1').locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            await sc('이름E').locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            await resolveAll(a.pg);
            ok((await pendingN(a.pg)) === 0 && !(await a.pg.isDisabled(SEL.make)), '⑫ 카드 전부 처리 → [파일 만들기] 켜짐', JSON.stringify(await cardCount(a.pg)));
            await a.pg.click(SEL.make); await idle(a.pg); await a.pg.waitForSelector(SEL.save, { timeout: 15000 });
            const nmH = (await a.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save)).find(x => x.includes('(효돈)'));
            const [dH] = await Promise.all([a.pg.waitForEvent('download', { timeout: 20000 }), a.pg.locator(`[data-fo-save="${nmH}"]`).click()]); const fH12 = path.join(TMP, 's12.xlsx'); await dH.saveAs(fH12);
            const s12 = XLSX.readFile(fH12, { cellStyles: true }).Sheets.Sheet1; const r12 = XLSX.utils.sheet_to_json(s12, { header: 1, defval: '' }); const at12 = nm => { const i = r12.findIndex(r => r[3] === nm); return i < 0 ? null : { r: r12[i], f: c => fillOf(s12[c + (i + 1)]) }; };
            const c1 = at12('묶음C1'), c2 = at12('묶음C2'), e1 = at12('이름E');
            ok(!!c1 && !!c2 && [c1, c2].every(x => x.r[0] === '박묶음 드림' && String(x.r[1]).replace(/\D/g, '') === '01055550777' && x.f('A') === 'DDEBF7' && x.f('B') === 'DDEBF7'), '⑫ⓑ [이대로 넣기] 한 번 → 묶음 두 행 모두 A 「이름 드림」 · B 번호 + 연파랑', c1 && c2 && JSON.stringify([c1.r[0], c2.r[0], c2.r[1]]));
            ok(!!e1 && e1.r[0] === '김민수 드림' && e1.f('A') === 'DDEBF7', '⑫ⓒ 이름뿐인 메모 카드에서 넣기 → A 「김민수 드림」', e1 && e1.r[0]);
            const h1 = at12('앞이름H');
            ok(!!h1 && h1.r[0] === '이순신 드림' && h1.r[12] === '적다 만 주소' && h1.r[9] === '적다 만 메모', '⑫ 적어 두었던 글로 넣은 카드 → A 「이순신 드림」 · M 주소 · J 고친 배송메세지', h1 && JSON.stringify([h1.r[0], h1.r[12], h1.r[9]]));
            const names12 = r12.slice(1).map(r => r[3]);
            ok(['묶음A1', '묶음A2', '묶음A3', '당일I', '문앞F', '경비G'].every(n => names12.includes(n)) && ['묶음B1', '묶음B2', '묶음B3', '제외K'].every(n => !names12.includes(n)), '⑫ 파일: 발송으로 정한 묶음 3건·당일 메모 주문 있음 / 제외 묶음 3건·자동 제외 주문 없음', `${names12.length}행`);
            ok(a.errs.length === 0, '⑫ 오류 0', a.errs.join(' | ')); await a.ctx.close();
        }
        // ⑬ #516 택배사 양식 배송메세지 = 요청 글은 지우고 기본 문구로(확실할 때만) · 글이 남으면 배송메세지 카드 ─────────
        console.log('\n⑬ #516 배송메세지: 자동 기본 문구 · 배송메세지 카드(memo-edit)');
        {
            const MEMO_EDIT = 'memo-edit'; const base = fx.naver.find(r => r['수취인명'] === '받는21'); const WD = ['일', '월', '화', '수', '목', '금', '토'];
            const dOf = iso => `${+iso.slice(8, 10)}일(${WD[new Date(iso + 'T00:00:00Z').getUTCDay()]})`;
            let seq = 0; const mk = (nm, buyer, memo) => { seq++; return { ...base, '구매자명': buyer, '구매자연락처': '010-7000-4' + String(100 + seq), '수취인명': nm, '수취인연락처1': '010-7100-4' + String(100 + seq), '통합배송지': '서울특별시 가짜구 메모로 ' + seq, '배송메세지': memo, '수량': 1, _pid: '2099010300' + String(100 + seq), _x: { ...base._x, productOrderId: '2099010300' + String(100 + seq), orderId: '2099010300' + String(100 + seq) } }; };
            const MA = '보내는이 홍길동으로 변경 부탁드립니다', MB = '보내는이 홍길동 변경\n즐거운 추석 보내세요~!', MC2 = `전부 ${dOf(ship)}에 출고 부탁드려요!!`, MD = `${dOf(ship)}에 출고 부탁드려요. 문 앞에 놔주세요`, ME = '보내는 사람: 시험구매E', MF = '문앞에 놔주세요';
            const fx13 = { ...fx, cafe24: [], coupang: [], canceledCoupang: [], naver: [mk('자동A', '시험구매A', MA), mk('인사B1', '시험구매B1', MB), mk('인사B2', '시험구매B2', MB), mk('당일C', '시험구매C', MC2), mk('당일D', '시험구매D', MD), mk('줄E', '시험구매E', ME), mk('보통F', '시험구매F', MF), mk('빈G', '시험구매G', '')] };
            const telE = fx13.naver[5]['구매자연락처'];
            const a = await openFO(br, fx13, {});
            await a.pg.fill(SEL.memo, `${telE} 보내는이 박직원`); await setCash(a.pg, null); await a.pg.click(SEL.start); await idle(a.pg); await a.pg.waitForFunction(() => window.AkmFinalOrder.state.phase === 'review', null, { timeout: 15000 });
            const J13 = (await readJudge(a.pg)).judge; const mc = t => cardOf(a.pg, MEMO_EDIT, t); const anyCard = t => a.pg.locator(SEL.card, { hasText: t }).count();
            ok(J13['자동A'].sender === '홍길동' && J13['인사B1'].sender === '홍길동' && J13['줄E'].sender === '시험구매E', '⑬ 재료: v2 가 보내는이를 자동으로 바꾼 주문(자동A · 인사B · 줄E)', JSON.stringify([J13['자동A'].sender, J13['인사B1'].sender, J13['줄E'].sender]));
            const c13 = await cardCount(a.pg);
            ok(((c13[MEMO_EDIT] || {}).pending || 0) === 3 && (await mc('인사B1').count()) === 1 && (await mc('인사B2').count()) === 1 && (await mc('당일D').count()) === 1, '⑬ 배송메세지 카드 3장: 인사말이 남는 2건(구매자가 달라 따로) · 당일 요청 + 「문 앞」 1건', JSON.stringify(c13));
            ok((await anyCard('자동A')) === 0 && (await anyCard('당일C')) === 0 && (await anyCard('줄E')) === 0 && (await anyCard('보통F')) === 0 && (await anyCard('빈G')) === 0, '⑬ⓐⓒⓔⓕ 요청 글뿐인 메모 · 보통 메모 · 빈 메모 = 카드 없음');
            ok(await a.pg.isDisabled(SEL.make), '⑬ⓖ 배송메세지 카드가 남으면 [파일 만들기] 꺼짐');
            const vB = (await mc('인사B1').locator('[data-f="memo"]').inputValue()).replace(/\r/g, ''), vD = (await mc('당일D').locator('[data-f="memo"]').inputValue()).replace(/\r/g, '');
            ok(vB === '즐거운 추석 보내세요~!' && vD === '문 앞에 놔주세요', '⑬ⓑⓓ 카드의 칸 = 요청 글을 뺀 나머지로 미리 채움', JSON.stringify([vB, vD]));
            const info13 = await a.pg.evaluate(() => [...document.querySelectorAll('#fo-info li')].map(li => li.textContent).filter(t => /기본 문구로/.test(t)).length);
            ok(info13 === 3, '⑬ 참고 목록에 「배송메세지를 기본 문구로」 3줄(자동A · 당일C · 줄E)', info13);
            await mc('인사B1').locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            await mc('인사B2').locator('[data-fo-act="keep"]').click(); await a.pg.waitForTimeout(150);
            await mc('당일D').locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            await a.pg.fill(SEL.memo, `${telE} 보내는이 박직원\n${FX.usd(ship)}\t010-7999-0000\t\t네이버`); await a.pg.click(SEL.rejudge); await idle(a.pg);
            ok((await pendingN(a.pg)) === 0 && !(await a.pg.isDisabled(SEL.make)) && a.hits.naver === 1, '⑬ⓖ [다시 판정] 뒤 배송메세지 카드 결정 유지 → [파일 만들기] 켜짐', JSON.stringify(await cardCount(a.pg)));
            await a.pg.click(SEL.make); await idle(a.pg); await a.pg.waitForSelector(SEL.save, { timeout: 15000 });
            const saves13 = await a.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save);
            const grab13 = async part => { const nm = saves13.find(x => x.includes(part)); const [d] = await Promise.all([a.pg.waitForEvent('download', { timeout: 20000 }), a.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 's13-' + Date.now() + '.xlsx'); await d.saveAs(f); return XLSX.readFile(f, { cellStyles: true }); };
            const s13 = (await grab13('(효돈)')).Sheets.Sheet1; const r13 = XLSX.utils.sheet_to_json(s13, { header: 1, defval: '' }); const at = nm => { const i = r13.findIndex(r => r[3] === nm); return i < 0 ? null : { r: r13[i], f: c => fillOf(s13[c + (i + 1)]) }; };
            const A = at('자동A'), B1 = at('인사B1'), B2 = at('인사B2'), Cc = at('당일C'), Dd = at('당일D'), E = at('줄E'), F = at('보통F'), G = at('빈G'); const DEF = FX.DEFAULT_MEMO;
            ok(!!A && A.r[9] === DEF && !A.f('J') && A.r[0] === '홍길동 드림' && A.f('A') === 'DDEBF7', '⑬ⓐ 보내는이 요청뿐(v2 자동 변경) → J 기본 문구 · J 채움색 없음 · A 「홍길동 드림」 연파랑', A && JSON.stringify([A.r[9].slice(0, 8), A.f('J'), A.r[0], A.f('A')]));
            ok(!!B1 && B1.r[9] === '즐거운 추석 보내세요~!' && !B1.f('J') && B1.r[0] === '홍길동 드림', '⑬ⓑ 배송메세지 카드 [이대로 넣기] → J = 칸의 글(인사말만) · 보통 칸', B1 && JSON.stringify([B1.r[9], B1.f('J')]));
            ok(!!B2 && String(B2.r[9]).replace(/\r/g, '') === MB && B2.f('J') === 'DDEBF7' && B2.r[0] === '홍길동 드림', '⑬ⓑ 배송메세지 카드 [원문 그대로] → J 원문 + v2 연파랑 표시 그대로', B2 && JSON.stringify([B2.r[9], B2.f('J')]));
            ok(!!Cc && Cc.r[9] === DEF && !Cc.f('J') && /\(제주아꼼이네\)$/.test(Cc.r[0]), '⑬ⓒ 당일 발송 요청뿐 → J 기본 문구 · 날짜 빨강 표시 없음 · 보내는사람 그대로', Cc && JSON.stringify([Cc.r[9].slice(0, 8), Cc.f('J')]));
            ok(!!Dd && Dd.r[9] === '문 앞에 놔주세요' && !Dd.f('J'), '⑬ⓓ 당일 요청 + 「문 앞에 놔주세요」 → 카드에서 넣은 글', Dd && JSON.stringify([Dd.r[9], Dd.f('J')]));
            ok(!!E && E.r[0] === '박직원 드림' && E.f('A') === 'DDEBF7' && E.r[9] === DEF && !E.f('J'), '⑬ⓔ 메모 줄로 보내는이를 지정한 주문 + 손님 메모가 보내는이 요청뿐 → A 「박직원 드림」 · J 기본 문구', E && JSON.stringify([E.r[0], E.r[9].slice(0, 8), E.f('J')]));
            ok(!!F && F.r[9] === MF && !!G && G.r[9] === DEF, '⑬ⓕ 보통 메모는 원문 그대로 · 빈 메모는 기본 문구(종전과 같음)');
            const st13 = XLSX.utils.sheet_to_json((await grab13('스마트스토어')).Sheets['발주발송관리'], { header: 1, defval: '' }); const sm13 = nm => { const r = st13.find(x => x[6] === nm); return r ? String(r[12]).replace(/\r/g, '') : null; };
            ok(sm13('자동A') === MA && sm13('당일C') === MC2 && sm13('인사B1') === MB && sm13('당일D') === MD && sm13('줄E') === ME, '⑬ 스토어 파일(발주발송관리)의 배송메세지는 전부 손님 원문');
            ok(a.errs.length === 0, '⑬ 오류 0', a.errs.join(' | ')); await a.ctx.close();
        }
        // ⑭ #517 설날 실파일 시험 뒤 고친 것: 한 글자 요일 · 전화번호 든 메모 · 당일 「배송」 요청 · 오타 보내는이 · 「보관부탁드림」 · 「보내시는 분」 · 종류 칩 · 나눠 보내기 낱말 ─────────
        console.log('\n⑭ #517 카드 조건 보강 · 종류별 걸러 보기');
        {
            const base = fx.naver.find(r => r['수취인명'] === '받는21'); const WD = ['일', '월', '화', '수', '목', '금', '토']; const wdS = WD[new Date(ship + 'T00:00:00Z').getUTCDay()];
            let seq = 0; const mk = (nm, memo, qty) => { seq++; return { ...base, '구매자명': '시험구매' + nm, '구매자연락처': '010-7000-5' + String(100 + seq), '수취인명': nm, '수취인연락처1': '010-7100-5' + String(100 + seq), '통합배송지': '서울특별시 가짜구 보강로 ' + seq, '배송메세지': memo, '수량': qty || 1, _pid: '2099010400' + String(100 + seq), _x: { ...base._x, productOrderId: '2099010400' + String(100 + seq), orderId: '2099010400' + String(100 + seq) } }; };
            const MC1 = `${+ship.slice(5, 7)}월 ${+ship.slice(8, 10)}일 배송 요청 부탁드립니다.`, MC2 = `${wdS}요일 발송요청`, MB = '문앞에 두세요 010.1234.5678', ME = '4층계단 박스옆에 보관부탁드림', MH2 = '문 앞에 두고 문자 주세요';
            const fx14 = { ...fx, cafe24: [], coupang: [], canceledCoupang: [], naver: [
                mk('요일A1', '14토까지 받게 보내주세요'), mk('요일A2', '부재시문앞\nㅡ목금 ㅡ도착요망'),                    // ⓐ 한 글자 요일
                mk('번호B', MB),                                                                                  // ⓑ 전화번호(점 표기)만
                mk('당일C1', MC1), mk('당일C2', MC2),                                                              // ⓒ 당일 「배송」 요청 · 요일만
                mk('오타D', '보낸는이 정가짜 로 변경해주세요'),                                                       // ⓓ 오타 보내는이
                mk('보관E', ME),                                                                                   // ⓔ 「…보관부탁드림」
                mk('분F', '보내시는 분 : 홍길동'),                                                                  // ⓕ
                mk('명단H1', '배송리스트 메일로 보내드리겠습니다', 3), mk('문앞H2', MH2, 2),                          // ⓗ
            ] };
            const a = await openFO(br, fx14, {});
            await setCash(a.pg, null); await a.pg.click(SEL.start); await idle(a.pg); await a.pg.waitForSelector(SEL.card, { timeout: 15000 });
            const J14 = (await readJudge(a.pg)).judge; const has = (type, t) => cardOf(a.pg, type, t).count(); const any = t => a.pg.locator(SEL.card, { hasText: t }).count();
            ok((await has(CARD.order, '요일A1')) === 1 && (await has(CARD.order, '요일A2')) === 1, '⑭ⓐ 한 글자 요일 메모(「14토까지」「목금 도착요망」) → 주문 확인 카드', JSON.stringify([J14['요일A1'].flag, J14['요일A2'].flag]));
            ok((await any('번호B')) === 0 && !J14['번호B'].excluded, '⑭ⓑ 전화번호(점 표기)만 든 메모 → 카드 없음', J14['번호B'].flag);
            ok((await any('당일C1')) === 0 && (await any('당일C2')) === 0 && !J14['당일C1'].excluded && !J14['당일C2'].excluded, '⑭ⓒ 기준일 당일 「N월 N일 배송 요청」 · 「○요일 발송요청」 → 카드 없음 · 그대로 발송', JSON.stringify([J14['당일C1'].flag, J14['당일C2'].flag]));
            ok((await has(CARD.senderMemo, '오타D')) === 1, '⑭ⓓ 오타 「보낸는이 ○○○ 로 변경」 → 보내는이 카드', J14['오타D'].sender);
            ok((await any('보관E')) === 0, '⑭ⓔ 「박스옆에 보관부탁드림」 → 카드 없음', J14['보관E'].sender);
            const nF = (await has(CARD.senderMemo, '분F')) ? await cardOf(a.pg, CARD.senderMemo, '분F').locator('[data-f="name"]').inputValue() : null;
            ok(nF === '홍길동', '⑭ⓕ 「보내시는 분 : 홍길동」 → 보내는이 카드 · 이름 칸 「홍길동」', nF);
            ok((await has(CARD.split, '명단H1')) === 1 && (await any('문앞H2')) === 0, '⑭ⓗ 「배송리스트 메일로 보내드리겠습니다」(3박스) → 나눠 보내기 카드 / 「문 앞에 두고 문자 주세요」(2박스) → 카드 없음');
            // ⓖ 종류 칩
            const chips = () => a.pg.evaluate(() => [...document.querySelectorAll('#fo-cards .fo-kinds .fo-kind')].map(b => ({ kind: b.dataset.kind, text: b.textContent.trim(), on: b.classList.contains('on') })));
            const types = () => a.pg.evaluate(sel => [...new Set([...document.querySelectorAll(sel)].map(c => c.getAttribute('data-fo-card')))].sort(), SEL.card);
            const ch0 = await chips(); const total0 = await pendingN(a.pg);
            ok(ch0.length >= 4 && ch0[0].kind === '' && /^전체\s*\d+/.test(ch0[0].text) && ch0[0].on && ch0.slice(1).every(c => /\d+$/.test(c.text)), '⑭ⓖ 남은 카드 종류가 2개 이상 → 종류 칩(「전체 N」 + 종류별 N) · 처음엔 「전체」', JSON.stringify(ch0.map(c => c.text)));
            const ordChip = ch0.find(c => /^주문 확인/.test(c.text));
            await a.pg.locator(`#fo-cards .fo-kinds .fo-kind[data-kind="${ordChip.kind}"]`).click(); await a.pg.waitForTimeout(200);
            const t1 = await types(), ch1 = await chips();
            ok(t1.join() === CARD.order && ch1.find(c => c.kind === ordChip.kind).on && (await a.pg.isDisabled(SEL.make)), '⑭ⓖ 칩을 누르면 그 종류의 남은 카드만 보임 · [파일 만들기]는 전체 남은 카드 기준으로 꺼진 채', JSON.stringify(t1));
            await resolveCards(a.pg, CARD.order); await a.pg.waitForTimeout(200);
            const t2 = await types(), ch2 = await chips();
            ok(t2.length >= 2 && !ch2.some(c => /^주문 확인/.test(c.text)) && ch2[0].on && (await a.pg.isDisabled(SEL.make)), '⑭ⓖ 그 종류가 다 끝나면 자동으로 「전체」로 · 다른 종류가 남아 [파일 만들기] 꺼짐', JSON.stringify(ch2.map(c => c.text)));
            const sndChip = ch2.find(c => /^보내는이/.test(c.text)); await a.pg.locator(`#fo-cards .fo-kinds .fo-kind[data-kind="${sndChip.kind}"]`).click(); await a.pg.waitForTimeout(200);
            await a.pg.locator('#fo-cards .fo-kinds .fo-kind[data-kind=""]').click(); await a.pg.waitForTimeout(200);
            ok((await types()).length >= 2 && (await pendingN(a.pg)) === total0 - 2, '⑭ⓖ 「전체」 칩으로 복귀 → 남은 카드 전부 보임', `남은 카드 ${await pendingN(a.pg)} (처음 ${total0})`);
            await cardOf(a.pg, CARD.senderMemo, '분F').locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150);
            await resolveAll(a.pg);
            ok((await pendingN(a.pg)) === 0 && !(await a.pg.isDisabled(SEL.make)), '⑭ 카드 전부 처리 → [파일 만들기] 켜짐', JSON.stringify(await cardCount(a.pg)));
            await a.pg.click(SEL.make); await idle(a.pg); await a.pg.waitForSelector(SEL.save, { timeout: 15000 });
            const nm14 = (await a.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save)).find(x => x.includes('(효돈)'));
            const [d14] = await Promise.all([a.pg.waitForEvent('download', { timeout: 20000 }), a.pg.locator(`[data-fo-save="${nm14}"]`).click()]); const f14 = path.join(TMP, 's14.xlsx'); await d14.saveAs(f14);
            const s14 = XLSX.readFile(f14, { cellStyles: true }).Sheets.Sheet1; const r14 = XLSX.utils.sheet_to_json(s14, { header: 1, defval: '' }); const at14 = nm => { const i = r14.findIndex(r => r[3] === nm); return i < 0 ? null : { r: r14[i], f: c => fillOf(s14[c + (i + 1)]) }; };
            const C1 = at14('당일C1'), C2 = at14('당일C2'), B = at14('번호B'), E = at14('보관E'), F = at14('분F'), H2 = at14('문앞H2');
            ok(!!C1 && C1.r[9] === FX.DEFAULT_MEMO && !C1.f('J') && !!C2 && C2.r[9] === FX.DEFAULT_MEMO && !C2.f('J'), '⑭ⓒ 당일 요청 두 주문 = 택배사 파일에 있음 · J 기본 문구 · 채움색 없음', C1 && C2 && JSON.stringify([C1.r[9].slice(0, 8), C1.f('J'), C2.r[9].slice(0, 8), C2.f('J')]));
            ok(!!B && B.r[9] === MB && !!E && E.r[9] === ME && /\(제주아꼼이네\)$/.test(E.r[0]) && !!H2 && H2.r[9] === MH2, '⑭ⓑⓔⓗ 카드 없이 지나간 메모는 원문 그대로 · 「보관부탁드림」 주문의 보내는사람 무변경');
            ok(!!F && F.r[0] === '홍길동 드림' && F.f('A') === 'DDEBF7', '⑭ⓕ 「보내시는 분」 카드에서 넣기 → A 「홍길동 드림」 연파랑', F && F.r[0]);
            ok(a.errs.length === 0, '⑭ 오류 0', a.errs.join(' | ')); await a.ctx.close();
            // ⓘ 390px 칩 줄
            const hm = { naver: 0, cafe24: 0, coupang: 0, cancel: 0 }; const cm = await newCtx(br, fx14, hm, { width: 390, height: 844 }, true, {}); const pm2 = await cm.newPage(); const em2 = []; pm2.on('pageerror', e => em2.push(e.message));
            await pm2.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pm2.waitForTimeout(2500); await pm2.evaluate(() => switchPage('agent-office')); await pm2.waitForTimeout(1000);
            await pm2.evaluate(sel => document.querySelector(sel).scrollIntoView(), SEL.btn); await pm2.click(SEL.btn); await pm2.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
            await pm2.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await idle(pm2);
            await pm2.check(SEL.cashNone); await pm2.click(SEL.start); await idle(pm2); await pm2.waitForSelector('#fo-cards .fo-kinds .fo-kind', { timeout: 15000 });
            const km = await pm2.evaluate(() => { const k = document.querySelector('#fo-cards .fo-kinds'); const bs = [...k.querySelectorAll('.fo-kind')]; return { n: bs.length, right: Math.max(...bs.map(b => b.getBoundingClientRect().right)), inner: window.innerWidth, sw: k.scrollWidth, cw: k.clientWidth, minH: Math.min(...bs.map(b => b.getBoundingClientRect().height)), doc: document.documentElement.scrollWidth }; });
            ok(km.n >= 4 && km.right <= km.inner + 1 && km.sw <= km.cw + 1 && km.doc <= km.inner + 1 && km.minH >= 44 && em2.length === 0, '⑭ⓘ 390px: 칩 줄이 가로로 안 넘침(줄바꿈) · 칩 높이 44px 이상 · 오류 0', JSON.stringify(km));
            await cm.close();
        }
        }
        if (PART !== 'A') {   // 뒷부분(⑮~): AI 메모 읽기 · 대화 칸 · 주소 검색 · 초기화
        // ⑮ #518·#520 AI(창구)가 손님 메모를 읽는다 — memo-read 3개 라우트는 가짜 응답(실제 창구·AI 호출 0 · DB 쓰기 0) ─────────
        //   #520: 판정이 끝나면 자동으로 1회 시작 · 보내는이·배송메세지 카드는 AI가 닫지 않고 입력칸만 채움 · 읽는 동안에도 카드를 누를 수 있음 · 배송지 동·호수(unit) 전달
        console.log('\n⑮ #518·#520 AI 메모 읽기(가짜 창구 응답)');
        {
            const base = fx.naver.find(r => r['수취인명'] === '받는21');
            let seq = 0;
            const mk = (nm, memo, qty, buyer, unitTxt) => {
                seq++; const pid = '2099010500' + String(100 + seq);
                return { ...base, '구매자명': buyer || ('시험구매' + nm), '구매자연락처': buyer ? '010-7000-6999' : '010-7000-6' + String(100 + seq), '수취인명': nm, '수취인연락처1': '010-7100-6' + String(100 + seq),
                    '통합배송지': `서울특별시 가짜구 에이아이로 ${seq}, ${unitTxt || `101동 ${200 + seq}호`}`, '배송메세지': memo, '수량': qty || 1, _pid: pid, _x: { ...base._x, productOrderId: pid, orderId: pid } };
            };
            const M = { O1: '다음주에 보내주세요', O2: '천천히 보내주세요', O3: '나중에 보내주셔도 됩니다', O4: '늦게 보내주셔도 괜찮아요', SP: '주소 따로 안 보냅니다 3박스 다 이 주소로 보내주세요',
                SD: '보내는이: 홍길동 즐거운 명절 보내세요', SD2: '보내는 사람은 서울시 가짜구 김구매 으로 표기', ME: '보내는이 홍길동 변경\n즐거운 추석 보내세요~!',
                P1: '선물용입니다. 좋은 상품으로 부탁드려요', P2: '선물용입니다. 좋은 상품으로 부탁드려요. 문 앞에 놔주세요', P3: '문 앞에 놔주세요', P4: '보내는이 홍길동으로 변경 부탁드립니다', P5: '좋은 걸로 부탁드려요 감사합니다',
                S1: '예쁜 걸로 보내주세요', S2: '선물용이에요 문 앞에 두세요', N1: '주문자명 박가짜 이라고 포장지에 표기 부탁드립니다', N2: '명절 지나고 받고 싶어요 선물이에요',
                KH: '115동1202호 김가짜으로 보내는사람 적어주세요', KS: '115동402호 박동일으로 보내는사람 적어주세요' };
            const rows15 = [mk('에이O1', M.O1), mk('에이O2', M.O2), mk('에이O3', M.O3), mk('에이O4', M.O4), mk('에이SP', M.SP, 3), mk('에이SD', M.SD), mk('에이SD2', M.SD2, 1, '김구매'), mk('에이ME', M.ME), mk('에이P1', M.P1), mk('에이P2', M.P2), mk('에이P3', M.P3),
                mk('에이P4', M.P4), mk('에이P5a', M.P5, 1, '같은구매'), mk('에이P5b', M.P5, 1, '같은구매'), mk('에이S1', M.S1), mk('에이S2', M.S2), mk('에이N1', M.N1), mk('에이N2', M.N2), mk('에이KH', M.KH, 1, null, '115동 402호'), mk('에이KS', M.KS, 1, null, '115동 402호')];
            const fx15 = { ...fx, cafe24: [], coupang: [], canceledCoupang: [], naver: rows15 };
            // 가짜 창구: 메모 글로 판정을 골라 돌려준다
            const ANS = {
                [M.O1]: { ship: 'go', memo: '기본', sure: true, why: '다음 주 = 기준일' }, [M.O2]: { ship: 'hold', ship_date: later, memo: '기본', sure: true, why: '천천히 요청' },
                [M.O3]: { ship: 'ask', memo: '그대로', sure: false, why: '날짜 없음' }, [M.O4]: { ship: 'go', memo: '기본', sure: true, why: '오늘 보내도 됨' },
                [M.SP]: { ship: 'go', split: false, memo: '그대로', sure: true, why: '받는 곳 설명' },
                [M.SD]: { ship: 'go', sender: { name: '홍길동', phone: '', addr: '' }, memo: '즐거운 명절 보내세요', sure: true, why: '보내는이 요청' },
                [M.SD2]: { ship: 'go', sender: { name: '김구매', phone: '', addr: '' }, memo: '기본', sure: true, why: '구매자 이름' },
                [M.ME]: { ship: 'go', memo: '즐거운 추석 보내세요~!', sure: true, why: '인사말만' },
                [M.P1]: { ship: 'go', memo: '기본', sure: true, why: '판매자에게 한 말' }, [M.P2]: { ship: 'go', memo: '문 앞에 놔주세요', sure: true, why: '기사용만 남김' }, [M.P5]: { ship: 'go', memo: '기본', sure: true, why: '판매자에게 한 말' },
                [M.S1]: { ship: 'go', memo: '맛있게 드세요', sure: true, why: '지어낸 글' }, [M.S2]: { ship: 'go', memo: '기본', sure: true, why: '기사용 낱말 빠짐' },
                [M.KH]: { ship: 'go', sender: { name: '김가짜', phone: '', addr: '' }, memo: '115동1202호', sure: true, why: '보내는이 요청' }, [M.KS]: { ship: 'go', sender: { name: '박동일', phone: '', addr: '' }, memo: '115동402호', sure: true, why: '보내는이 요청' },
                [M.N1]: { ship: 'go', sender: { name: '박가짜', phone: '', addr: '' }, memo: '기본', sure: true, why: '주문자명 표기' }, [M.N2]: { ship: 'hold', ship_date: later, memo: '기본', sure: true, why: '명절 뒤 수령' } };
            const aiState = pg2 => pg2.evaluate(() => { const a = window.AkmFinalOrder.state.ai; return { running: !!a.running, id: a.id, done: !!a.done }; });
            const busyIdle = async pg2 => { await pg2.waitForTimeout(200); await pg2.waitForFunction(sel => { const p = document.querySelector(sel); return p && !p.classList.contains('busy'); }, SEL.panel, { timeout: 120000 }); };
            const aiRunning = pg2 => pg2.waitForFunction(() => { const a = window.AkmFinalOrder.state.ai; return a.running && a.id; }, null, { timeout: 15000 });
            const aiIdle = pg2 => pg2.waitForFunction(() => !window.AkmFinalOrder.state.ai.running, null, { timeout: 60000 });
            const mkAi = async (mode0, withClock) => {
                const hitsA = { naver: 0, cafe24: 0, coupang: 0, cancel: 0, ai: 0 }; const ctxA = await newCtx(br, fx15, hitsA, { width: 1400, height: 900 }, false, {});
                if (withClock) await ctxA.clock.install();
                const ai = { mode: mode0, post: [], gets: 0, dels: 0, status: '처리중' };
                await ctxA.route('**/api/agent-office/final-order/memo-read', r => { if (r.request().method() !== 'POST') return r.continue(); ai.post.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true, id: 9001, count: ai.post[ai.post.length - 1].items.length } }); });
                await ctxA.route('**/api/agent-office/final-order/memo-read/9001', r => {
                    const mth = r.request().method(); if (mth === 'DELETE') { ai.dels++; return r.fulfill({ json: { ok: true } }); }
                    ai.gets++;
                    if (ai.mode === 'wait') return r.fulfill({ json: { ok: true, state: 'wait', status: ai.status, data: null, message: '' } });
                    if (ai.mode === 'fail') return r.fulfill({ json: { ok: true, state: 'fail', status: '오류', data: null, message: '가짜 창구 오류(시험)' } });
                    const body = ai.post[ai.post.length - 1];
                    r.fulfill({ json: { ok: true, state: 'done', status: '완료', data: { items: body.items.map(it => ({ i: it.i, ship: 'go', ship_date: null, sender: null, memo: '그대로', split: false, sure: true, why: '', ...(ANS[it.memo] || {}) })) }, message: '' } });
                });
                const pgA = await ctxA.newPage(); const errsA = []; pgA.on('pageerror', e => errsA.push(e.message)); pgA.on('dialog', d => d.accept());
                await pgA.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pgA.waitForTimeout(2500); await pgA.evaluate(() => switchPage('agent-office')); await pgA.waitForTimeout(1000);
                await pgA.click(SEL.btn); await pgA.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
                await pgA.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await busyIdle(pgA);
                return { ctx: ctxA, pg: pgA, errs: errsA, ai, hits: hitsA };
            };
            const openCard = (pg2, type, t) => pg2.locator(`${SEL.pending}[data-fo-card="${type}"]`, { hasText: t }).first();
            const doneTxt = async (pg2, type, t) => { const c = pg2.locator(`${SEL.card}[data-fo-card="${type}"][data-fo-done]`, { hasText: t }).first(); return (await c.count()) ? (await c.innerText()).replace(/\s+/g, ' ') : null; };
            const fieldOf = async (pg2, type, t, f) => { const c = openCard(pg2, type, t); return (await c.count()) ? c.locator(`[data-f="${f}"]`).inputValue() : null; };
            const noteOf = async (pg2, type, t) => { const c = openCard(pg2, type, t).locator('[data-ai-note]'); return (await c.count()) ? (await c.innerText()).replace(/\s+/g, ' ') : null; };

            // ── a. 자동 시작 → 읽는 동안 사람이 카드를 고침 → 결과 반영 ─────────────────
            const a = await mkAi('wait');
            const vis0 = await a.pg.evaluate(() => { const b = document.getElementById('fo-ai'); return { has: !!b, hidden: !b || b.hidden || getComputedStyle(b).display === 'none' }; });
            ok(vis0.has && vis0.hidden && a.ai.post.length === 0, '⑮1 판정 전에는 AI 띠가 안 보이고 올린 것도 없음', JSON.stringify(vis0));
            await setCash(a.pg, null); await a.pg.click(SEL.start); await busyIdle(a.pg); await a.pg.waitForSelector(SEL.card, { timeout: 15000 });
            await aiRunning(a.pg);
            ok(a.ai.post.length === 1 && (await a.pg.isVisible('#fo-ai')), '⑮1 #520 판정이 끝나면 버튼을 누르지 않아도 AI 읽기가 1회 시작됨', `POST ${a.ai.post.length}회`);
            const pBefore = await pendingN(a.pg); const cBefore = await cardCount(a.pg);
            const lock = { make: await a.pg.isDisabled(SEL.make), rej: await a.pg.isDisabled(SEL.rejudge), stop: await a.pg.isVisible('#fo-ai-stop'), read: await a.pg.isDisabled('#fo-ai-read') };
            ok(lock.make && lock.rej && lock.stop && lock.read, '⑮7 AI가 읽는 동안: [파일 만들기]·[다시 판정]·읽기 버튼 꺼짐 · [그만두기] 보임', JSON.stringify(lock));
            // 읽는 동안 사람이 먼저 정함: 주문 확인 1장을 제외로 · 보내는이 카드에 이름을 직접 적음
            await openCard(a.pg, CARD.order, '에이O1').locator('[data-fo-act="excl"]').click(); await a.pg.waitForTimeout(200);
            await openCard(a.pg, CARD.senderMemo, '에이SD2').locator('[data-f="name"]').fill('직접적음'); await a.pg.waitForTimeout(100);
            ok((await pendingN(a.pg)) === pBefore - 1 && (await aiState(a.pg)).running, '⑮7 #520 AI가 읽는 동안에도 카드를 누르고 입력할 수 있음', `${pBefore} → ${await pendingN(a.pg)}`);
            a.ai.mode = 'done'; await aiIdle(a.pg); await a.pg.waitForTimeout(400);

            // 2. 보낸 묶음
            const body = a.ai.post[0], memos = body.items.map(it => it.memo), keys = [...new Set(body.items.flatMap(it => Object.keys(it)))].sort(), raw = JSON.stringify(body);
            ok(keys.every(k => ['i', 'memo', 'buyer', 'recv', 'qty', 'cards', 'hint', 'unit'].includes(k)) && !/에이아이로|서울특별시|010-7[01]00-6/.test(raw) && !/통합배송지|수취인연락처|구매자연락처|옵션정보/.test(raw), '⑮2 보낸 묶음에 주소 글·전화번호·옵션 칸 없음(메모 · 이름 · 수량 · 카드 종류 · 힌트 · 동호수만)', keys.join(','));
            const uSD = (body.items.find(it => it.memo === M.SD) || {}).unit;
            ok(body.items.every(it => typeof it.unit === 'string' && /^(\d+동\d+호|)$/.test(it.unit)) && uSD === '101동206호', '⑮2 #520 배송지의 동·호수 조각(unit)만 함께 보냄', uSD);
            ok(!memos.includes(M.P3) && !memos.includes(M.P4) && memos.filter(m => m === M.P5).length === 1 && memos.includes(M.P1) && memos.includes(M.O1) && body.shipDate === ship, '⑮2 기사용 말뿐인 메모 · 규칙이 기본 문구로 정한 메모는 안 보냄 · 같은 구매자·같은 메모는 1건', `${body.items.length}건`);
            ok(a.ai.dels === 1, '⑮8 결과를 받은 뒤 DELETE 1회(묶음·결과 지움)', a.ai.dels);

            // 3. 카드 반영
            const J15 = (await readJudge(a.pg)).judge;
            const dO1 = await doneTxt(a.pg, CARD.order, '에이O1'), dO2 = await doneTxt(a.pg, CARD.order, '에이O2'), dO4 = await doneTxt(a.pg, CARD.order, '에이O4'), dSP = await doneTxt(a.pg, CARD.split, '에이SP');
            ok(!!dO4 && /AI/.test(dO4) && !J15['에이O4'].excluded && !!dO2 && /AI/.test(dO2) && J15['에이O2'].excluded && !!dSP && /AI/.test(dSP), '⑮3 주문 확인·나눠 보내기 카드: AI가 확실하다고 한 것은 미리 눌러 둠(오늘 발송 / 제외 / 전부 발송) + 「AI」 표시', String(dO2).slice(-50));
            ok(!!dO1 && !/AI/.test(dO1) && J15['에이O1'].excluded, '⑮3 #520 사람이 먼저 정한 카드는 AI 결과가 덮지 않음(AI는 오늘 발송 · 사람은 제외 → 제외 유지)', String(dO1).slice(-40));
            const dSD = await doneTxt(a.pg, CARD.senderMemo, '에이SD'), dME = await doneTxt(a.pg, 'memo-edit', '에이ME'), dKS = await doneTxt(a.pg, CARD.senderMemo, '에이KS');
            ok(!!dSD && /홍길동 드림/.test(dSD) && /AI/.test(dSD) && !!dME && /AI/.test(dME) && !!dKS && /박동일 드림/.test(dKS), '⑮3 보내는이·배송메세지 카드: AI가 확실하고 메모의 동·호수가 배송지와 같으면(또는 메모에 동·호수가 없으면) AI가 끝냄 + 「AI」 표시', String(dSD).slice(-70));
            const khOpen = await openCard(a.pg, CARD.senderMemo, '에이KH').count(), khName = await fieldOf(a.pg, CARD.senderMemo, '에이KH', 'name'), khMemo = await fieldOf(a.pg, CARD.senderMemo, '에이KH', 'memo'), khNote = await noteOf(a.pg, CARD.senderMemo, '에이KH');
            ok(khOpen === 1 && khName === '김가짜' && khMemo === '115동1202호' && /달라요/.test(String(khNote)) && /115동402호/.test(String(khNote)), '⑮3 #520 실사고 재현: 메모 「115동1202호 ○○○으로 보내는사람…」 · 배송지 115동402호 → AI가 확실하다고 해도 닫지 않고 입력칸만 채움 + 「동·호수가 달라요」', JSON.stringify({ khOpen, khName, khMemo, khNote }));
            const sd2Name = await fieldOf(a.pg, CARD.senderMemo, '에이SD2', 'name'), sd2Note = await noteOf(a.pg, CARD.senderMemo, '에이SD2');
            ok(sd2Name === '직접적음' && /넣지 않았어요/.test(String(sd2Note)), '⑮3 #520 사람이 적다 만 글은 AI 값으로 덮지 않음', JSON.stringify({ sd2Name, sd2Note }));
            ok((await openCard(a.pg, CARD.order, '에이O3').count()) === 1, '⑮3 AI가 확실하지 않다고 한 주문 확인 카드는 열린 채');
            // 4. 카드 없는 주문
            const info15 = await a.pg.evaluate(() => [...document.querySelectorAll('#fo-info li')].map(li => li.textContent).filter(t => /AI가 배송메세지/.test(t)));
            ok(info15.length === 4 && (await a.pg.locator(SEL.card, { hasText: '에이P2' }).count()) === 0, '⑮4 카드 없는 주문: AI가 확실하다고 한 배송메세지는 바로 정리(참고 목록 4줄 · 카드 없음)', info15.length);
            // 5. 안전장치 · 6. 새 카드
            const anyS1 = await a.pg.locator(SEL.card, { hasText: '에이S1' }).count(), s2Has = await openCard(a.pg, 'memo-edit', '에이S2').count();
            ok(anyS1 === 0 && s2Has === 1, '⑮5 안전장치: 원문에 없는 글을 돌려주면 반영 안 됨(원문 유지) · 「문 앞」 메모를 「기본」으로 돌려주면 카드로', JSON.stringify({ S1카드: anyS1, S2카드: s2Has }));
            const dN1 = await doneTxt(a.pg, CARD.senderMemo, '에이N1'), n1Name = dN1 && /박가짜 드림/.test(dN1) && /AI/.test(dN1) ? '박가짜' : null, dN2 = await doneTxt(a.pg, CARD.order, '에이N2');
            ok(n1Name === '박가짜' && !!dN2 && /AI/.test(dN2) && J15['에이N2'].excluded, '⑮6 규칙이 못 본 주문: AI가 보내는이를 찾으면 보내는이 카드가 새로 뜸(확실하면 AI가 끝냄 · [바꾸기] 가능) · 「오늘 안 나감」(확실)이면 주문 확인 카드가 제외로', JSON.stringify({ n1Name, N2: J15['에이N2'].excluded }));
            const btnTxt = await a.pg.evaluate(() => document.getElementById('fo-ai-read').textContent);
            ok(/다시 읽히기/.test(btnTxt) && !(await a.pg.isDisabled('#fo-ai-read')), '⑮1 읽은 뒤 버튼 = 「다시 읽히기」', btnTxt);
            note('⑮ 사람이 눌러야 하는 카드: AI 전 → 후', `${pBefore} → ${await pendingN(a.pg)} · ${JSON.stringify(cBefore)} → ${JSON.stringify(await cardCount(a.pg))}`);
            // [다시 판정] — 읽을 메모가 같으면 AI를 다시 부르지 않고 앞선 결과·사람 결정·적어 둔 글을 유지
            await a.pg.fill(SEL.memo, `${FX.usd(ship)}\t010-7999-0000\t\t네이버`); await a.pg.click(SEL.rejudge); await busyIdle(a.pg); await a.pg.waitForTimeout(600);
            const J15b = (await readJudge(a.pg)).judge;
            ok(a.ai.post.length === 1 && J15b['에이O1'].excluded && J15b['에이O2'].excluded && (await doneTxt(a.pg, CARD.senderMemo, '에이SD')) !== null && (await fieldOf(a.pg, CARD.senderMemo, '에이KH', 'name')) === '김가짜' &&(await fieldOf(a.pg, CARD.senderMemo, '에이SD2', 'name')) === '직접적음',
                '⑮3 [다시 판정]: 읽을 메모가 같으면 AI를 다시 부르지 않음 · 사람 결정·AI가 채운 값·적어 둔 글 유지', `POST ${a.ai.post.length}회`);
            // 남은 카드 처리 → 파일
            for (const t of ['에이SD2', '에이KH']) { await openCard(a.pg, CARD.senderMemo, t).locator('[data-fo-act="use"]').click(); await a.pg.waitForTimeout(150); }
            for (const t of [...Object.keys(ACT), 'memo-edit']) { for (let g = 0; g < 40; g++) { const c = a.pg.locator(`${SEL.pending}[data-fo-card="${t}"]`).first(); if (!(await c.count())) break; await c.locator(`[data-fo-act="${t === 'memo-edit' ? 'keep' : ACT[t]}"]`).first().click(); await a.pg.waitForTimeout(120); } }
            ok((await pendingN(a.pg)) === 0 && !(await a.pg.isDisabled(SEL.make)), '⑮ 남은 카드 처리 → [파일 만들기] 켜짐', JSON.stringify(await cardCount(a.pg)));
            const J15c = (await readJudge(a.pg)).judge;
            await a.pg.click(SEL.make); await idle(a.pg); await a.pg.waitForSelector(SEL.save, { timeout: 15000 });
            const sv15 = await a.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save);
            const gr15 = async part => { const nmx = sv15.find(x => x.includes(part)); const [d] = await Promise.all([a.pg.waitForEvent('download', { timeout: 20000 }), a.pg.locator(`[data-fo-save="${nmx}"]`).click()]); const f = path.join(TMP, 's15-' + Date.now() + '.xlsx'); await d.saveAs(f); return XLSX.readFile(f, { cellStyles: true }); };
            const w15 = (await gr15('(효돈)')).Sheets.Sheet1; const r15 = XLSX.utils.sheet_to_json(w15, { header: 1, defval: '' });
            const at = nm => { const i = r15.findIndex(r => r[3] === nm); return i < 0 ? null : { r: r15[i], f: c => fillOf(w15[c + (i + 1)]) }; };
            const DEF = FX.DEFAULT_MEMO; const P1 = at('에이P1'), P2 = at('에이P2'), P3 = at('에이P3'), P5a = at('에이P5a'), P5b = at('에이P5b'), S1 = at('에이S1'), S2 = at('에이S2'), SD = at('에이SD'), SD2 = at('에이SD2'), ME = at('에이ME'), N1 = at('에이N1'), KH = at('에이KH'), KS = at('에이KS');
            ok(!!P1 && P1.r[9] === DEF && !!P5a && P5a.r[9] === DEF && !!P5b && P5b.r[9] === DEF && !!P3 && P3.r[9] === M.P3 && !!P2 && P2.r[9] === '문 앞에 놔주세요', '⑮4 파일: AI 「기본」 → J 기본 문구(같은 구매자 묶음 둘 다) · 안 보낸 메모는 원문 · 카드에서 [이대로 넣기]한 글', P1 && P2 && JSON.stringify([P1.r[9].slice(0, 8), P2.r[9]]));
            ok(!!S1 && S1.r[9] === M.S1 && !!S2 && S2.r[9] === M.S2, '⑮5 파일: 안전장치에 걸린 두 주문의 J = 원문 그대로');
            ok(!!SD && SD.r[0] === '홍길동 드림' && SD.r[9] === '즐거운 명절 보내세요' && SD.f('A') === 'DDEBF7' && !!SD2 && SD2.r[0] === '직접적음 드림' && !!ME && ME.r[9] === '즐거운 추석 보내세요~!' && !!N1 && N1.r[0] === '박가짜 드림' && !!KH && KH.r[0] === '김가짜 드림' && KH.r[9] === '115동1202호' && !!KS && KS.r[0] === '박동일 드림' && KS.r[9] === '115동402호', '⑮3·6 파일: AI가 끝낸 카드 · 사람이 [이대로 넣기]를 누른 카드(AI 값 · 사람이 적은 값)가 반영', SD && SD2 && JSON.stringify([SD.r[0], SD.r[9], SD2.r[0]]));
            const names15 = r15.slice(1).map(r => r[3]); const st15 = XLSX.utils.sheet_to_json((await gr15('스마트스토어')).Sheets['발주발송관리'], { header: 1, defval: '' }).slice(2).map(r => r[6]);
            ok(!names15.includes('에이O2') && !names15.includes('에이N2') && !names15.includes('에이O1') && !st15.includes('에이O2') && !st15.includes('에이N2') && st15.includes('에이SD'), '⑮6 파일: 「오늘 안 나감」 주문(AI가 미리 누른 것 · 사람이 제외한 것) = 택배사·스토어 파일 모두에 없음', `택배사 ${names15.length}행 · 스토어 ${st15.length}행`);
            // #520 무회귀: 결과 파일의 받는 분·옵션·수량·연락처·주소 칸이 원본 주문과 같은가(AI·카드가 건드리는 것은 A·B·J·M뿐)
            const src15 = new Map(rows15.map(r => [r['수취인명'], r])); const d8 = v => String(v).replace(/\D/g, '').slice(-8);
            const bad15 = r15.slice(1).filter(r => { const o = src15.get(r[3]); const j = J15c[r[3]]; return !o || !j || r[4] !== j.opt || Number(r[5]) !== Number(o['수량']) || d8(r[6]) !== d8(o['수취인연락처1']) || r[8] !== o['통합배송지']; });
            ok(r15.length - 1 === rows15.length - 3 && bad15.length === 0, '⑮ #520 무회귀: 택배사 파일 전 행의 수취인·옵션·수량·연락처·주소 = 원본 주문 그대로', `${r15.length - 1}행 · 다른 행 ${bad15.length}${bad15.length ? ' ' + bad15.map(r => r[3]).join(',') : ''}`);
            ok(a.errs.length === 0, '⑮ 오류 0', a.errs.join(' | ')); await a.ctx.close();

            // ── b. 그만두기 · 실패 · 버튼으로 다시 ─────────────────────────────
            const b = await mkAi('wait'); await setCash(b.pg, null); await b.pg.click(SEL.start); await busyIdle(b.pg); await b.pg.waitForSelector(SEL.card, { timeout: 15000 }); await aiRunning(b.pg);
            await b.pg.click('#fo-ai-stop'); for (let i = 0; i < 30 && b.ai.dels < 1; i++) await b.pg.waitForTimeout(250);
            const stopMsg = await b.pg.evaluate(() => document.getElementById('fo-ai-msg').textContent);
            ok(b.ai.dels === 1 && /그만뒀/.test(stopMsg) && !(await b.pg.isDisabled('#fo-ai-read')), '⑮7 [그만두기] → DELETE 호출 · 「그만뒀어요」 안내 · 버튼으로 다시 읽힐 수 있음', stopMsg.slice(0, 40));
            // 그만둔 뒤 남은 카드를 처리하면 [파일 만들기]가 켜진다(AI 없이도 끝까지 갈 수 있다)
            await b.pg.click(SEL.rejudge); await busyIdle(b.pg); await b.pg.waitForTimeout(800);
            ok(b.ai.post.length === 1 && !(await aiState(b.pg)).running, '⑮7 그만둔 뒤 [다시 판정]을 해도 같은 메모면 자동으로 다시 올리지 않음', `POST ${b.ai.post.length}회`);
            b.ai.mode = 'fail'; await b.pg.click('#fo-ai-read'); await aiIdle(b.pg); await b.pg.waitForTimeout(300);
            const failMsg = await b.pg.evaluate(() => document.getElementById('fo-ai-msg').textContent); const pF = await pendingN(b.pg);
            await openCard(b.pg, CARD.order, '에이O3').locator('[data-fo-act="send"]').click(); await b.pg.waitForTimeout(200);
            ok(b.ai.post.length === 2 && /못 했어요/.test(failMsg) && /가짜 창구 오류/.test(failMsg) && (await pendingN(b.pg)) === pF - 1 && b.ai.dels === 2, '⑮7 버튼으로 다시 읽힘 → 창구가 실패로 답함 → 안내 글 · 카드로 계속 처리 가능 · 묶음 지움', failMsg.slice(0, 60));
            for (const t of [...Object.keys(ACT), 'memo-edit']) { for (let g = 0; g < 40; g++) { const c = b.pg.locator(`${SEL.pending}[data-fo-card="${t}"]`).first(); if (!(await c.count())) break; await c.locator(`[data-fo-act="${t === 'memo-edit' ? 'keep' : ACT[t]}"]`).first().click(); await b.pg.waitForTimeout(120); } }
            ok((await pendingN(b.pg)) === 0 && !(await b.pg.isDisabled(SEL.make)), '⑮7 AI 없이도 카드를 다 처리하면 [파일 만들기] 켜짐');
            await b.ctx.close();

            // ── c. 창구가 안 집음(40초) ─────────────────────────────────────
            let c; try { c = await mkAi('wait', true); } catch (e) { c = null; }
            if (c) {
                c.ai.status = '대기'; await setCash(c.pg, null); await c.pg.click(SEL.start); await busyIdle(c.pg); await c.pg.waitForSelector(SEL.card, { timeout: 15000 }); await aiRunning(c.pg);
                await c.ctx.clock.fastForward(46000); await c.pg.waitForTimeout(600);
                const waitMsg = await c.pg.evaluate(() => document.getElementById('fo-ai-msg').textContent);
                ok(/아직 집지 않았어요/.test(waitMsg), '⑮7 40초 넘게 창구가 집지 않으면 안내(대표 PC가 꺼져 있으면 쓸 수 없음 · 그만두고 카드로)', waitMsg.slice(0, 60));
                await c.pg.click('#fo-ai-stop'); await c.ctx.clock.fastForward(4000); await c.pg.waitForTimeout(400); await c.ctx.close();
            } else note('⑮7 40초 안내 — 브라우저 시계 조작 불가로 미검증');
        }
        // ⑯ #525 클코와 대화하는 칸 — 말로 고치기 · 제주 건 · 정리 기록(가짜 창구 응답 · 실제 AI·DB 쓰기 0) ─────────────────
        console.log('\n⑯ #525 대화 칸(가짜 창구 응답)');
        {
            const base = fx.naver.find(r => r['수취인명'] === '받는21');
            const SHOT = process.env.SHOT_DIR || TMP; require('fs').mkdirSync(SHOT, { recursive: true });
            const target = (cat.byPartner[FX.P_DAESUNG] || [])[0];   // 품목 이름을 바꿀 때 쓸 단가표 이름(대성)
            let seq = 0; const MT = '13과로 부탁드려요 문 앞에 놔주세요';   // 손님 메모의 과수 요청 → AI가 tail 로 돌려줌(자동으로 붙이지 않고 카드로)
            const mk = (nm, o) => {
                seq++; const x = o || {}, pid = x.pid || ('2099010600' + String(100 + seq)), bs = x.base || base;
                return { ...bs, '구매자명': x.buyer || nm, '구매자연락처': x.tel || '010-7300-0' + String(100 + seq), '수취인명': x.recv || nm, '수취인연락처1': x.rtel || '010-7400-0' + String(100 + seq),
                    '통합배송지': x.addr || `서울특별시 가짜구 대화로 ${seq}, 101동 ${200 + seq}호`, '배송메세지': x.memo || '', '수량': x.qty || 1, ...(x.opt ? { '옵션정보': x.opt } : {}), _pid: pid, _x: { ...bs._x, productOrderId: pid, orderId: pid } };
            };
            const rows16 = [mk('대화가'), mk('대화나'), mk('대화다'), mk('대화라'), mk('대화마', { opt: '세상에 없는 과일 9kg' }), mk('대화바', { addr: '제주특별자치도 제주시 가짜로 7' }),
                mk('같은이', { recv: '같은받는일', tel: '010-7300-0555' }), mk('같은이', { recv: '같은받는이', tel: '010-7300-0555' }), mk('대화사'), mk('대화아'), mk('대화자', { tel: '010-7300-0777' }), mk('대화차'), mk('대화타', { memo: MT })];
            const fx16 = { ...fx, cafe24: [], coupang: [], canceledCoupang: [], naver: rows16 };
            const mkChat = async (withClock, rowsX, vp, mobile) => {
                const hitsC = { naver: 0, cafe24: 0, coupang: 0, cancel: 0, ai: 0 }; const ctxC = await newCtx(br, rowsX ? { ...fx16, naver: rowsX } : fx16, hitsC, vp || { width: 1400, height: 900 }, !!mobile, {});
                if (withClock) await ctxC.clock.install();
                const NOJUSO = { results: { common: { errorCode: '0', errorMessage: '정상', totalCount: '0' }, juso: [] } };
                const chat = { posts: [], memoPosts: [], dels: 0, mode: 'done', status: '처리중', answer: () => ({ reply: '', actions: [] }), jusoQ: [], juso: () => NOJUSO };
                // #528: 주소 검색(도로명주소 프록시)은 늘 가짜 응답 — 기본은 「0건」
                await ctxC.route('**/api/agent-office/juso*', r => { const kw = new URL(r.request().url()).searchParams.get('keyword'); chat.jusoQ.push(kw); r.fulfill({ json: chat.juso(kw) }); });
                await ctxC.route('**/api/agent-office/final-order/memo-read', r => { if (r.request().method() !== 'POST') return r.continue(); const b = r.request().postDataJSON(); if (b.kind !== 'chat') { chat.memoPosts.push(b); return r.fulfill({ json: { ok: true, id: 9200 } }); } chat.posts.push(b); r.fulfill({ json: { ok: true, id: 9100 } }); });
                await ctxC.route('**/api/agent-office/final-order/memo-read/9200', r => { if (r.request().method() === 'DELETE') return r.fulfill({ json: { ok: true } }); const b = chat.memoPosts[chat.memoPosts.length - 1];
                    r.fulfill({ json: { ok: true, state: 'done', status: '완료', data: { items: b.items.map(it => (chat.memoAns ? { i: it.i, ship: 'go', sender: null, memo: '그대로', split: false, sure: true, why: '', ...chat.memoAns(it) } : it.memo === MT ? { i: it.i, ship: 'go', sender: null, memo: '문 앞에 놔주세요', tail: '13과로!', split: false, sure: false, why: '과수 지정' } : { i: it.i, ship: rowsX ? 'ask' : 'go', sender: null, memo: '그대로', split: false, sure: !rowsX, why: '' })) }, message: '' } }); });
                await ctxC.route('**/api/agent-office/final-order/memo-read/9100', r => {
                    if (r.request().method() === 'DELETE') { chat.dels++; return r.fulfill({ json: { ok: true } }); }
                    if (chat.mode === 'wait') return r.fulfill({ json: { ok: true, state: 'wait', status: chat.status, data: null, message: '' } });
                    r.fulfill({ json: { ok: true, state: 'done', status: '완료', data: chat.answer(chat.posts[chat.posts.length - 1]), message: '' } });
                });
                const pgC = await ctxC.newPage(); const errsC = []; pgC.on('pageerror', e => errsC.push(e.message)); pgC.on('dialog', d => d.accept());
                await pgC.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pgC.waitForTimeout(2500); await pgC.evaluate(() => switchPage('agent-office')); await pgC.waitForTimeout(1000);
                await pgC.click(SEL.btn); await pgC.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
                await pgC.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await idle(pgC);
                return { ctx: ctxC, pg: pgC, errs: errsC, chat, hits: hitsC };
            };
            const chatIdle = async pg2 => { await pg2.waitForTimeout(150); await pg2.waitForFunction(() => { const s = window.AkmFinalOrder.state; return !s.chat.running && !s.busy; }, null, { timeout: 60000 }); await pg2.waitForTimeout(150); };
            const say = async (pg2, text) => { await pg2.fill('#fo-chat-input', text); await pg2.click('#fo-chat-send'); await chatIdle(pg2); };
            const lastBub = pg2 => pg2.evaluate(() => { const b = [...document.querySelectorAll('#fo-chat-log .fo-bub')].pop(); return b ? { cls: b.className, text: b.innerText.replace(/\s+/g, ' '), preview: b.getAttribute('data-chat-preview'), bad: b.querySelectorAll('li.bad').length, li: b.querySelectorAll('li').length } : null; });
            const patchN = pg2 => pg2.evaluate(() => window.AkmFinalOrder.state.patch.size);
            const nOf = (b, who) => (b.orders.find(o => o.buyer === who || o.recv === who) || {}).n;
            // 주소 검색이 0건(기본 가짜 응답)이면 「그대로 넣기」를 먼저 눌러야 [적용]이 켜진다(#528)
            const apply = async pg2 => { for (let q = 0; q < 10; q++) { const b = pg2.locator('#fo-chat-log [data-chat-preview="open"] [data-addr-pick$=":raw"]:not(.on)').first(); if (!(await b.count()) || !(await pg2.isDisabled('#fo-chat-log [data-chat="apply"]'))) break; await b.click(); await pg2.waitForTimeout(120); } await pg2.click('#fo-chat-log [data-chat="apply"]'); await chatIdle(pg2); await idle(pg2); };

            const d = await mkChat();
            ok(await d.pg.evaluate(() => document.getElementById('fo-chat').hidden), '⑯1 주문을 불러오기 전에는 대화 칸이 안 보임');
            await setCash(d.pg, null); await d.pg.click(SEL.start); await idle(d.pg); await d.pg.waitForTimeout(300);
            const jeju0 = await d.pg.evaluate(() => (document.getElementById('fo-jeju') || {}).textContent || '');
            ok((await d.pg.isVisible('#fo-chat')) && /제주도 배송/.test(jeju0) && /1건/.test(jeju0) && /없음/.test(jeju0), '⑯1 판정 뒤 대화 칸이 보이고 요약에 「제주도 배송: 거래처 N건 · 없음」', jeju0);
            ok(d.chat.posts.length === 0 && d.chat.memoPosts.length === 1 && d.chat.memoPosts[0].items.length === 1 && d.chat.memoPosts[0].items[0].memo === MT, '⑯1 말을 걸기 전에는 대화를 올리지 않음 · 과수 요청 메모는 AI 메모 읽기로 보냄', `대화 ${d.chat.posts.length} · 메모 읽기 ${d.chat.memoPosts.length}`);
            const J16a = (await readJudge(d.pg)).judge;
            // 손님 메모의 「품목 뒤에 붙일 말」 — 자동으로 붙이지 않고 카드로
            const tcard = d.pg.locator(`${SEL.pending}[data-fo-card="memo-edit"]`, { hasText: '대화타' }).first();
            const tHas = await tcard.count(), tTail = tHas ? await tcard.locator('[data-f="tail"]').inputValue() : null, tMemo = tHas ? await tcard.locator('[data-f="memo"]').inputValue() : null;
            ok(tHas === 1 && tTail === '13과로!' && tMemo === '문 앞에 놔주세요' && !/13과로!/.test(J16a['대화타'].opt), '⑯14 손님 메모의 과수 요청: AI가 준 「품목 뒤에 붙일 말」은 자동으로 붙지 않고 배송메세지 카드에 입력칸으로(13과로! · 남길 글 함께)', JSON.stringify({ tHas, tTail, tMemo }));
            await tcard.locator('[data-fo-act="use"]').click(); await d.pg.waitForTimeout(250);

            // 주소 변경 — 지시 글에 있는 글자만
            d.chat.answer = b => ({ reply: '주소를 바꿀게요.', actions: [{ op: 'addr', n: nOf(b, '대화가'), text: '서울 가짜구 새주소로 12, 301호' }] });
            await say(d.pg, '대화가 건 주소 서울 가짜구 새주소로 12, 301호로 바꿔줘');
            const b1 = d.chat.posts[0], raw1 = JSON.stringify({ o: b1.orders, c: b1.catalog, s: b1.summary });
            ok(b1.kind === 'chat' && b1.orders.length === 1 && b1.orders[0].buyer === '대화가' && Object.keys(b1.orders[0]).sort().join(',') === 'buyer,memo,n,opt,partner,qty,recv,state,unit' && b1.orders[0].unit === '101동201호' && !/대화로|서울특별시|010-7[34]00/.test(raw1), '⑯2 보낸 것: 지시 글 + 후보 주문 1건(이름·옵션·수량·메모·동호수·거래처·상태) — 주소 글·전화 없음', Object.keys(b1.orders[0]).join(','));
            ok(/제주도 배송/.test(b1.summary) && Object.keys(b1.catalog).length >= 2 && b1.shipDate === ship, '⑯2 요약(건수·제주 건)과 단가표 이름 목록을 함께 보냄', b1.summary.split('\n')[3]);
            let lb = await lastBub(d.pg);
            ok(lb.preview === 'open' && /새주소로 12, 301호/.test(lb.text) && /대화로 1/.test(lb.text) && (await patchN(d.pg)) === 0 && (await d.pg.isDisabled('#fo-chat-send')), '⑯3 바뀔 내용 미리 보기(전 → 후) — [적용]을 누르기 전에는 안 바뀜', lb.text.slice(0, 120));
            await apply(d.pg);
            ok((await patchN(d.pg)) === 1 && /주소 변경/.test(await d.pg.evaluate(() => document.getElementById('fo-patches').textContent)) && d.chat.dels === 1, '⑯3 [적용] → 「말로 바꾼 것」 목록에 주소 변경 1건 · 대화 묶음 DELETE');
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'addr', n: nOf(b, '대화나'), text: '서울 지어낸구 없는로 9' }] });
            await say(d.pg, '대화나 건 주소 좀 바꿔줘'); lb = await lastBub(d.pg);
            ok(lb.bad === 1 && lb.preview !== 'open' && /다시 적어/.test(lb.text) && (await patchN(d.pg)) === 1, '⑯3 🔴 지시 글에 없는 주소 글자를 돌려주면 거부(적용 버튼 없음 · 「주소 글자를 다시 적어 주세요」)', lb.text.slice(0, 110));

            // 품목 이름 — 단가표 이름만
            const pick0 = await d.pg.locator(`${SEL.pending}[data-fo-card="${CARD.partner}"]`).count();
            d.chat.answer = b => ({ reply: '미매칭 1건을 바꿀게요.', actions: [{ op: 'opt', n: b.orders[0].n, name: '세상에없는품목' }, { op: 'opt', n: b.orders[0].n, name: target }] });
            await say(d.pg, '미매칭 없는 과일, 대성 것으로 바꿔줘'); lb = await lastBub(d.pg);
            const b3 = d.chat.posts[d.chat.posts.length - 1];
            ok(b3.orders.length === 1 && b3.orders[0].buyer === '대화마' && b3.orders[0].partner === '미정' && lb.bad === 1 && lb.li === 2 && lb.preview === 'open', '⑯4 「미매칭」이라고 하면 거래처를 못 정한 주문만 후보로 · 단가표에 없는 이름은 거부, 있는 이름만 통과', lb.text.slice(0, 120));
            await apply(d.pg);
            ok(pick0 === 1 && (await d.pg.locator(`${SEL.pending}[data-fo-card="${CARD.partner}"]`).count()) === 0, '⑯4 품목 이름을 바꾸면 「거래처 고르기」 카드가 사라짐', `${pick0} → 0`);

            // 수량 · 받는 분 · 제외 · 취소
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'qty', n: nOf(b, '대화다'), qty: 3 }, { op: 'recv', n: nOf(b, '대화라'), name: '새받는이' }, { op: 'qty', n: nOf(b, '대화다'), qty: 0 }, { op: 'recv', n: nOf(b, '대화라'), name: '지어낸이름' }] });
            await say(d.pg, '대화다 건 3박스로 하고 대화라 건 받는 분 새받는이로 바꿔줘'); lb = await lastBub(d.pg);
            ok(lb.li === 4 && lb.bad === 2, '⑯5 수량(1~999)·받는 분(지시 글에 있는 이름)만 통과 — 0박스 · 지어낸 이름은 거부', lb.text.slice(0, 100)); await apply(d.pg);
            const ex0 = (await readJudge(d.pg)).judge;
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'exclude', n: nOf(b, '대화사') }] });
            await say(d.pg, '대화사 건 빼줘'); await apply(d.pg);
            const ex1 = (await readJudge(d.pg)).judge;
            ok(!ex0['대화사'].excluded && ex1['대화사'].excluded, '⑯5 「○○ 건 빼줘」 → 적용 뒤 오늘 안 나감');
            const pn0 = await patchN(d.pg);
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'qty', n: nOf(b, '대화아'), qty: 5 }] });
            await say(d.pg, '대화아 건 5박스로'); await d.pg.click('#fo-chat-log [data-chat="cancel"]'); await d.pg.waitForTimeout(200); lb = await lastBub(d.pg);
            ok((await patchN(d.pg)) === pn0 && /취소함/.test(lb.text) && !(await d.pg.isDisabled('#fo-chat-send')), '⑯5 미리 보기에서 [취소] → 아무것도 안 바뀜');

            // 품목 뒤 요청 꼬리(대화로) — 품목을 가리지 않고 시킨 대로
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'tail', n: nOf(b, '대화나'), text: '17과로!' }] });
            await say(d.pg, '대화나 건 17과로 해줘'); lb = await lastBub(d.pg);
            ok(lb.preview === 'open' && /17과로!/.test(lb.text), '⑯15 「○○ 건 17과로」 → 품목 뒤에 붙일 말 미리 보기(전 → 후)', lb.text.slice(0, 110)); await apply(d.pg);
            // #553: 사이즈(2S·S·M) 꼬리는 귤 품목에만 — 귤이 아닌 품목에 오면 화면이 막는다(과수 꼬리는 위 ⑯15 처럼 품목을 안 가림)
            const pnS = await patchN(d.pg);
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'tail', n: nOf(b, '대화마'), text: '2S사이즈로!' }] });
            await say(d.pg, '대화마 건 2s 사이즈로 해줘'); lb = await lastBub(d.pg);
            ok(lb.bad === 1 && /귤만 사이즈 지정/.test(lb.text) && (await patchN(d.pg)) === pnS, '⑯15-b #553 귤이 아닌 품목에 사이즈 꼬리 → 막고 이유를 보여 줌(바뀌는 것 없음)', lb.text.slice(0, 120));
            { const c = await d.pg.$('#fo-chat-log [data-chat="cancel"]'); if (c) { await c.click(); await d.pg.waitForTimeout(150); } }
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'tail', n: nOf(b, '대화사'), text: '2S사이즈로!' }] });
            await say(d.pg, '대화사 건 2s 사이즈로 해줘'); lb = await lastBub(d.pg);
            const optSa = await d.pg.evaluate(() => { const s = window.__fo && window.__fo.S ? window.__fo.S() : null; return ''; });
            ok(lb.bad === 0 && lb.preview === 'open' && /2S사이즈로!/.test(lb.text), '⑯15-c #553 귤 품목이면 사이즈 꼬리 그대로 미리 보기', lb.text.slice(0, 120) + optSa);
            await d.pg.click('#fo-chat-log [data-chat="cancel"]'); await d.pg.waitForTimeout(200);
            const pnT = await patchN(d.pg);

            // 되묻기 — 같은 이름이 여럿이면 번호로
            d.chat.answer = () => ({ reply: '같은이 님 주문이 2건이에요 — 1번 / 2번 중 어느 건인가요?', actions: [] });
            await say(d.pg, '같은이 건 빼줘'); lb = await lastBub(d.pg); const bq = d.chat.posts[d.chat.posts.length - 1];
            ok(bq.orders.length === 2 && /어느 건/.test(lb.text) && lb.preview == null && (await patchN(d.pg)) === pnT,'⑯6 같은 이름 주문이 2건 → 후보 2건을 보내고, 되묻는 답을 그대로 보여 줌(바뀌는 것 없음)');
            d.chat.answer = b => ({ reply: '2번을 뺄게요.', actions: [{ op: 'exclude', n: 2 }] });
            await say(d.pg, '2번'); const bq2 = d.chat.posts[d.chat.posts.length - 1]; await apply(d.pg);
            const ex2 = (await readJudge(d.pg)).judge;
            ok(bq2.orders.length === 2 && bq2.orders.map(o => o.n).join() === '1,2' && bq2.history.some(h => h.who === 'ai' && /어느 건/.test(h.text)) && ex2['같은받는이'].excluded && !ex2['같은받는일'].excluded, '⑯6 「2번」이라고 이어 답하면 앞의 후보 번호·대화를 그대로 보내고 그 주문만 제외');

            // 정리 줄을 대화 칸에 붙이면 규칙이 처리
            const postsBefore = d.chat.posts.length;
            await say(d.pg, `${FX.usd(later)}\t010-7300-0777\t\t네이버`); await idle(d.pg);
            const ex3 = (await readJudge(d.pg)), memoVal = await d.pg.inputValue(SEL.memo);
            ok(d.chat.posts.length === postsBefore && /010-7300-0777/.test(memoVal) && ex3.judge['대화자'].excluded, '⑯7 대화 칸에 정리 파일 줄을 붙이면 AI에게 안 보내고 메모 칸에 넣어 다시 판정(뒤 날짜 → 제외)');
            ok(ex3.judge['대화사'].excluded && ex3.judge['같은받는이'].excluded && (await patchN(d.pg)) === pnT + 1, '⑯7 다시 판정해도 말로 바꾼 것(제외 포함)은 유지');

            // 파일
            ok((await pendingN(d.pg)) === 0 && !(await d.pg.isDisabled(SEL.make)), '⑯8 남은 카드 0 → [파일 만들기] 켜짐');
            await d.pg.click(SEL.make); await idle(d.pg); await d.pg.waitForSelector(SEL.save, { timeout: 15000 }); await d.pg.waitForTimeout(400);
            const grab = async () => { const names = await d.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save); const out = {};
                for (const nm of names) { const [dl] = await Promise.all([d.pg.waitForEvent('download', { timeout: 20000 }), d.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 's16-' + Date.now() + '.xlsx'); await dl.saveAs(f); out[nm.includes('(대성)') ? '대성' : nm.includes('(효돈)') ? '효돈' : '스토어'] = XLSX.readFile(f, { cellStyles: true }); }
                return out; };
            const find = (wbs, nm) => { for (const k of ['대성', '효돈']) { const ws = wbs[k] && wbs[k].Sheets.Sheet1; if (!ws) continue; const a = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }); const i = a.findIndex(r => r[3] === nm); if (i >= 0) return { who: k, r: a[i], f: c => fillOf(ws[c + (i + 1)]) }; } return null; };
            const W1 = await grab(); const ga = find(W1, '대화가'), gm = find(W1, '대화마'), gd = find(W1, '대화다'), gr = find(W1, '새받는이'), gj = find(W1, '대화바');
            ok(!!ga && ga.r[8] === '서울 가짜구 새주소로 12, 301호' && ga.f('I') === 'E4DFEC' && !!gd && Number(gd.r[5]) === 3 && gd.f('F') === 'E4DFEC' && !!gr && gr.f('D') === 'E4DFEC' && !find(W1, '대화라'), '⑯8 파일: 주소·수량·받는 분이 말한 대로 바뀌고 그 칸은 연보라', ga && JSON.stringify([ga.r[8], gd && gd.r[5], gr && gr.r[3]]));
            const qtyD = XLSX.utils.sheet_to_json(W1['대성'].Sheets['수량'], { header: 1, defval: '' });
            ok(!!gm && gm.who === '대성' && gm.r[4] === target && gm.f('E') === 'E4DFEC' && qtyD.some(r => r[0] === target), '⑯8 파일: 품목 이름을 바꾼 주문은 새 이름의 거래처(대성) 파일과 수량 표로', gm && gm.who + ' · ' + gm.r[4]);
            ok(!find(W1, '대화사') && !find(W1, '같은받는이') && !find(W1, '대화자') && !!find(W1, '같은받는일'), '⑯8 파일: 말로 뺀 주문·정리 줄로 뺀 주문은 없음 · 같은 이름의 다른 주문은 그대로');
            const gn = find(W1, '대화나'), gt = find(W1, '대화타'), tailName = J16a['대화나'].opt + ' 17과로!';
            const qtyAll = ['대성', '효돈'].flatMap(k => (W1[k] ? XLSX.utils.sheet_to_json(W1[k].Sheets['수량'], { header: 1, defval: '' }).map((r, i) => ({ k, name: r[0], qty: r[1], fill: fillOf(W1[k].Sheets['수량']['A' + (i + 1)]) })) : []));
            const qn = qtyAll.find(q => q.name === tailName), gb = find(W1, '같은받는일');
            ok(!!gn && gn.r[4] === tailName && gn.f('E') === 'E4DFEC' && !!gb && gn.who === gb.who && !!qn && Number(qn.qty) === 1 && qn.fill === 'F4B183', '⑯15 파일: 옵션 칸 끝에 「 17과로!」 · 거래처 분류는 그대로 · 수량 표에 따로 한 줄(주황)', gn && gn.r[4].slice(-22) + ' · ' + JSON.stringify(qn));
            ok(!!gt && gt.r[4] === J16a['대화타'].opt + ' 13과로!' && gt.r[9] === '문 앞에 놔주세요', '⑯14 파일: 카드에서 [이대로 넣기]를 누른 과수 요청은 옵션 칸 끝에 붙고 배송메세지는 남길 글만', gt && gt.r[4].slice(-14) + ' / ' + gt.r[9]);
            // 🔴 무회귀: 말로 바꾼 주문 말고는 수취인·옵션·수량·연락처·주소가 원본 그대로 · 색도 없음
            const d8 = v => String(v).replace(/\D/g, '').slice(-8); const untouched = ['대화아', '대화차', '같은받는일', '대화바'];
            const badU = untouched.filter(nm => { const g = find(W1, nm), o = rows16.find(r => r['수취인명'] === nm); return !g || g.r[4] !== J16a[nm].opt || Number(g.r[5]) !== 1 || d8(g.r[6]) !== d8(o['수취인연락처1']) || g.r[8] !== o['통합배송지'] || ['D', 'E', 'F'].some(c => g.f(c) === 'E4DFEC'); });
            const gaOther = !!ga && ga.r[3] === '대화가' && ga.r[4] === J16a['대화가'].opt && Number(ga.r[5]) === 1 && ga.f('D') !== 'E4DFEC';
            ok(badU.length === 0 && gaOther, '⑯8 🔴 무회귀: 말로 바꾸지 않은 주문은 수취인·옵션·수량·연락처·주소가 원본 그대로(연보라 없음) · 바꾼 주문도 말한 칸만 바뀜', `다른 행 ${badU.join(',') || '0'}`);
            const res1 = await d.pg.evaluate(() => ({ jeju: (document.getElementById('fo-jeju-result') || {}).textContent || '', patched: (document.getElementById('fo-patched') || {}).textContent || '' }));
            ok(/제주도 배송/.test(res1.jeju) && /1건/.test(res1.jeju) && !!gj && /말로 바꾼 것 7건/.test(res1.patched), '⑯9 결과에 「제주도 배송: …」와 「말로 바꾼 것 N건」 목록', res1.jeju + ' / ' + res1.patched.slice(0, 20));
            const lg = d.hits.logs || [];
            ok(lg.length === 1 && lg[0].id == null && lg[0].shipDate === ship && Array.isArray(lg[0].lines) && lg[0].lines.some(t => /제주도 배송/.test(t)) && lg[0].lines.some(t => /주소 변경 1건/.test(t)) && lg[0].lines.some(t => /품목 이름 변경 1건/.test(t)) && lg[0].lines.some(t => /오늘 제외/.test(t)), '⑯10 [파일 만들기]가 끝나면 정리 기록 1건을 올림(거래처별 건수 · 제주 · 특이사항)', lg[0] && lg[0].lines.slice(0, 3).join(' | '));
            ok(lg[0] && !lg[0].lines.some(t => /01\d[-.\s]?\d{3,4}[-.\s]?\d{4}|새주소로|대화로/.test(t)) && lg[0].lines.every(t => t.length <= 200) && lg[0].lines.length <= 40, '⑯10 정리 기록에 전화·주소 글자 없음 · 줄 길이·줄 수 한도 안');

            // 파일이 나온 뒤 이어서 고치기 → 자동으로 다시 만들기 · 같은 기록 고쳐 씀
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'qty', n: nOf(b, '대화차'), qty: 2 }] });
            await say(d.pg, '대화차 건 2박스로'); await apply(d.pg); await d.pg.waitForSelector(SEL.save, { timeout: 20000 }); await d.pg.waitForTimeout(500);
            const W2 = await grab(); const gc = find(W2, '대화차'); const lg2 = d.hits.logs || [];
            ok(!!gc && Number(gc.r[5]) === 2 && lg2.length === 2 && lg2[1].id === 7001, '⑯11 파일이 나온 뒤 말로 고치면 자동으로 다시 만들고, 정리 기록은 같은 id 로 고쳐 씀', `기록 ${lg2.length}회 · id ${lg2[1] && lg2[1].id}`);
            await d.pg.locator('#fo-patches [data-unpatch]').last().click(); await d.pg.waitForTimeout(300); await idle(d.pg); await chatIdle(d.pg); await d.pg.waitForSelector(SEL.save, { timeout: 20000 }); await d.pg.waitForTimeout(500);
            const W3 = await grab(); const gc3 = find(W3, '대화차');
            ok(!!gc3 && Number(gc3.r[5]) === 1 && gc3.f('F') !== 'E4DFEC' && (d.hits.logs || []).length === 3, '⑯11 [되돌리기] → 원래 값으로 다시 만듦', gc3 && gc3.r[5]);
            // 꼬리 떼기
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'tail', n: nOf(b, '대화나'), text: '' }] });
            await say(d.pg, '대화나 건 17과로 붙인 것 떼줘'); await apply(d.pg); await d.pg.waitForSelector(SEL.save, { timeout: 20000 }); await d.pg.waitForTimeout(500);
            const W4 = await grab(); const gn4 = find(W4, '대화나');
            ok(!!gn4 && gn4.r[4] === J16a['대화나'].opt, '⑯15 꼬리 떼기 → 옵션 칸이 품목 이름만으로', gn4 && gn4.r[4].slice(-16));
            // 입력삭제로
            d.chat.answer = b => ({ reply: '', actions: [{ op: 'indiv', n: nOf(b, '대화아') }] });
            await say(d.pg, '대화아 건 입력삭제로'); await apply(d.pg);
            const memo2 = await d.pg.inputValue(SEL.memo), ji = (await readJudge(d.pg)).judge;
            ok(/입력o삭제x/.test(memo2) && ji['대화아'].individual && (await d.pg.locator(`${SEL.pending}[data-fo-card="${CARD.cashMissing}"]`).count()) === 1, '⑯12 「입력삭제로」 → 메모 칸에 입력삭제 줄을 넣고 다시 판정(현금파일에 주소 줄이 없다는 카드가 뜸)');
            ok(d.errs.length === 0, '⑯ 오류 0', d.errs.join(' | ')); await d.ctx.close();

            // ── ⑰ #526 실사용 반영: 라벨 · 대화 칸 모양 · 말로 정한 주문의 카드 닫기 · 거래처를 고른 미매칭도 후보로 ─────────────
            console.log('\n⑰ #526 대화 칸 모양 · 말로 정한 카드 닫기 · 미매칭 후보');
            {
                const M7 = { ME: '보내는이 홍길동 변경\n즐거운 추석 보내세요~!', OR: '다음주에 보내주세요', SD: '보내는이: 홍길동 즐거운 명절 보내세요', GR: '나중에 보내주셔도 됩니다' };
                const rows17 = [mk('일칠가', { memo: M7.ME }), mk('일칠나', { memo: M7.OR }), mk('일칠다', { memo: M7.SD }), mk('묶음이', { recv: '묶음받는일', tel: '010-7300-0666', memo: M7.GR }), mk('묶음이', { recv: '묶음받는이', tel: '010-7300-0666', memo: M7.GR }),
                    mk('일칠마', { opt: '세상에 없는 과일 9kg' }), mk('일칠바')];
                const g = await mkChat(false, rows17);
                const lab = await g.pg.evaluate(() => ({ label: document.querySelector('label[for="fo-memo"]').textContent.trim(), ph: document.getElementById('fo-memo').placeholder.split('\n').length }));
                ok(lab.label === '개별발송 처리 · 지정 발송일' && lab.ph === 3, '⑰1 메모 칸 라벨 = 「개별발송 처리 · 지정 발송일」 · 예시 3줄 그대로', JSON.stringify(lab));
                await setCash(g.pg, null); await g.pg.click(SEL.start); await idle(g.pg); await g.pg.waitForTimeout(400);
                const cOpen = (type, t) => g.pg.locator(`${SEL.pending}[data-fo-card="${type}"]`, { hasText: t }).first();
                const cChat = async (type, t) => { const c = g.pg.locator(`${SEL.card}[data-fo-card="${type}"][data-by-chat]`, { hasText: t }).first(); return (await c.count()) ? (await c.innerText()).replace(/\s+/g, ' ') : null; };
                const p0 = await pendingN(g.pg), c0 = await cardCount(g.pg);
                ok((await cOpen('memo-edit', '일칠가').count()) === 1 && (await cOpen(CARD.order, '일칠나').count()) === 1 && (await cOpen(CARD.senderMemo, '일칠다').count()) === 1 && (await cOpen(CARD.order, '묶음이').count()) === 1 && (await cOpen(CARD.partner, '세상에 없는').count()) === 1, '⑰ 준비: 배송메세지 · 주문 확인 · 보내는이 · 묶음 주문 확인 · 거래처 카드가 열려 있음', JSON.stringify(c0));
                // 새 마크업
                const mkp = await g.pg.evaluate(() => { const c = document.querySelector('#fo-chat .fo-compose'), s = document.getElementById('fo-chat-send'), ta = document.getElementById('fo-chat-input'); const cs = getComputedStyle(c), ts = getComputedStyle(ta); return { compose: !!c, border: cs.borderTopWidth + ' ' + cs.borderTopStyle, radius: cs.borderTopLeftRadius, spark: !!c.querySelector('.fo-spark'), icon: s.classList.contains('fo-icon') && !!s.querySelector('svg'), sendW: Math.round(s.getBoundingClientRect().width), taBorder: ts.borderTopWidth, threadHidden: document.getElementById('fo-chat-log').hidden, attach: !!document.querySelector('#fo-chat [id*="attach"]') }; });
                ok(mkp.compose && mkp.border === '2px solid' && mkp.spark && mkp.icon && mkp.sendW === 44 && mkp.taBorder === '0px' && mkp.threadHidden && !mkp.attach, '⑰2 입력 상자 = 인디고 2px 테두리 상자 · ✦ · 둥근 보내기 버튼(44px) · 안쪽 입력칸 테두리 없음 · 첨부 버튼 없음 · 대화가 없으면 대화 틀 숨김', JSON.stringify(mkp));
                await g.pg.focus('#fo-chat-input'); await g.pg.waitForTimeout(350); const foc = await g.pg.evaluate(() => { const ta = document.getElementById('fo-chat-input'), c = document.querySelector('#fo-chat .fo-compose'); return { ta: getComputedStyle(ta).boxShadow, taB: getComputedStyle(ta).borderTopWidth, ring: getComputedStyle(c).boxShadow }; });
                ok(foc.ta === 'none' && foc.taB === '0px' && /3px/.test(foc.ring), '⑰2 입력칸을 눌러도 안쪽에 테마 포커스 테두리가 안 생기고 바깥 상자에 링', JSON.stringify(foc).slice(0, 120));
                // 쓰는 중 · 그만두기
                g.chat.mode = 'wait'; await g.pg.fill('#fo-chat-input', '제주 건 있어?'); await g.pg.click('#fo-chat-send');
                await g.pg.waitForFunction(() => window.AkmFinalOrder.state.chat.id, null, { timeout: 15000 }); await g.pg.waitForTimeout(2600);
                const liv = await g.pg.evaluate(() => { const b = document.querySelector('#fo-chat-log [data-chat-live]'); return { live: b ? b.innerText.replace(/\s+/g, ' ') : null, stop: !document.getElementById('fo-chat-stop').hidden, me: !!document.querySelector('#fo-chat-log .fo-bub.me'), sendOff: document.getElementById('fo-chat-send').disabled }; });
                ok(/쓰는 중/.test(String(liv.live)) && /읽고 있어요|물어보는 중/.test(String(liv.live)) && liv.stop && liv.me && liv.sendOff, '⑰2 보내면 내 말풍선(오른쪽) + 클코 답 자리에 「쓰는 중」 · [그만두기]는 읽는 중에만 보임', liv.live);
                await g.pg.click('#fo-chat-stop'); await chatIdle(g.pg); for (let q = 0; q < 20 && g.chat.dels < 1; q++) await g.pg.waitForTimeout(250);
                ok(!(await g.pg.locator('#fo-chat-log [data-chat-live]').count()) && (await g.pg.evaluate(() => document.getElementById('fo-chat-stop').hidden)) && g.chat.dels === 1, '⑰2 [그만두기] → 「쓰는 중」이 사라지고 대화 묶음 DELETE');
                g.chat.mode = 'done';
                // ③ 말로 정하면 그 주문의 카드가 닫힌다
                g.chat.answer = b => ({ reply: '배송메세지를 기본 문구로 할게요.', actions: [{ op: 'memo', n: nOf(b, '일칠가'), text: '' }] });
                await say(g.pg, '일칠가 건 배송메세지는 기본 문구만'); const bubA = await g.pg.evaluate(() => { const b = [...document.querySelectorAll('#fo-chat-log .fo-bub.ai')].pop(); return { label: (b.querySelector('.fo-a-label') || {}).textContent, acts: !!b.querySelector('.fo-a-acts [data-chat="apply"]'), time: /\d{1,2}:\d{2}/.test(document.getElementById('fo-chat-log').innerText) }; });
                ok(bubA.label === '클코 답변' && bubA.acts && !bubA.time, '⑰2 클코 답 = 「클코 답변」 배지 카드 + 아래 버튼 띠([적용]/[취소]) · 시간 표시 없음', JSON.stringify(bubA));
                await apply(g.pg);
                const dA = await cChat('memo-edit', '일칠가');
                ok(!!dA && /말로 정함/.test(dA) && /기본 문구/.test(dA) && (await pendingN(g.pg)) === p0 - 1 && (await cOpen('memo-edit', '일칠가').count()) === 0, '⑰3 🔴 실사용 결함: 말로 배송메세지를 정하면 그 주문의 배송메세지 카드가 닫힘(「말로 정함」 · 확인할 것 −1)', `${p0} → ${await pendingN(g.pg)} · ${String(dA).slice(-60)}`);
                // 반대 순서: 카드를 먼저 누르고 나중에 말로 고침 → 말이 이김
                await cOpen(CARD.order, '일칠나').locator('[data-fo-act="send"]').click(); await g.pg.waitForTimeout(200);
                g.chat.answer = b => ({ reply: '', actions: [{ op: 'exclude', n: nOf(b, '일칠나') }] });
                await say(g.pg, '일칠나 건 빼줘'); await apply(g.pg);
                const dB = await cChat(CARD.order, '일칠나'), jB = (await readJudge(g.pg)).judge;
                ok(!!dB && /제외/.test(dB) && /말로 정함/.test(dB) && jB['일칠나'].excluded, '⑰3 카드에서 [오늘 발송]을 먼저 눌렀어도 나중에 말로 「빼줘」 하면 말이 이기고 카드 표시도 「제외 · 말로 정함」', String(dB).slice(-50));
                // 보내는이 + 배송메세지
                g.chat.answer = b => ({ reply: '', actions: [{ op: 'sender', n: nOf(b, '일칠다'), name: '새보낸이', phone: '', addr: '' }, { op: 'memo', n: nOf(b, '일칠다'), text: '' }] });
                await say(g.pg, '일칠다 건 보내는이 새보낸이로 하고 배송메세지는 지워줘'); await apply(g.pg);
                const dC = await cChat(CARD.senderMemo, '일칠다');
                ok(!!dC && /새보낸이 드림/.test(dC) && /기본 문구/.test(dC) && (await cOpen(CARD.senderMemo, '일칠다').count()) === 0, '⑰3 말로 보내는이·배송메세지를 정하면 보내는이 카드가 닫힘', String(dC).slice(-70));
                // 묶음 카드: 묶인 주문 전부가 정해졌을 때만
                g.chat.answer = b => ({ reply: '', actions: [{ op: 'exclude', n: nOf(b, '묶음받는일') }] });
                await say(g.pg, '묶음받는일 건 빼줘'); await apply(g.pg);
                const grpOpen1 = await cOpen(CARD.order, '묶음이').count();
                g.chat.answer = b => ({ reply: '', actions: [{ op: 'exclude', n: nOf(b, '묶음받는이') }] });
                await say(g.pg, '묶음받는이 건도 빼줘'); await apply(g.pg);
                ok(grpOpen1 === 1 && (await cOpen(CARD.order, '묶음이').count()) === 0 && !!(await cChat(CARD.order, '묶음이')), '⑰3 묶음 카드(같은 구매자 2건): 한 건만 말로 정하면 열린 채 · 둘 다 정해지면 닫힘', `한 건 뒤 열림 ${grpOpen1}`);
                // 되돌리기 두 길
                const pMid = await pendingN(g.pg);
                await g.pg.locator(`${SEL.card}[data-fo-card="memo-edit"][data-by-chat]`, { hasText: '일칠가' }).first().locator('[data-unpatch-card]').click(); await g.pg.waitForTimeout(300); await idle(g.pg);
                ok((await cOpen('memo-edit', '일칠가').count()) === 1 && (await pendingN(g.pg)) === pMid + 1, '⑰3 닫힌 카드의 [바꾸기] → 그 말을 되돌리고 카드가 다시 열림');
                const li = g.pg.locator('#fo-patches li', { hasText: '일칠다' }).first(); const liBox = await li.evaluate(el => { const b = el.querySelector('button').getBoundingClientRect(), r = el.getBoundingClientRect(); return { sameRow: b.top >= r.top - 1 && b.bottom <= r.bottom + 1, right: Math.round(r.right - b.right) }; });
                await li.locator('[data-unpatch]').click(); await g.pg.waitForTimeout(300); await idle(g.pg); await chatIdle(g.pg);
                ok((await cOpen(CARD.senderMemo, '일칠다').count()) === 1 && liBox.sameRow && liBox.right <= 14, '⑰3 「말로 바꾼 것」 목록의 [되돌리기] → 보내는이 카드가 다시 열림 · 버튼은 줄 오른쪽 끝(아래로 안 떨어짐)', JSON.stringify(liBox));
                // ④ 거래처를 골라 둔 미매칭도 후보
                await cOpen(CARD.partner, '세상에 없는').locator('select[data-pick]').selectOption(FX.P_DAESUNG); await g.pg.waitForTimeout(300);
                g.chat.answer = b => ({ reply: '', actions: [{ op: 'opt', n: b.orders[0].n, name: target }] });
                await say(g.pg, '없는 과일 미매칭 대성 것으로 변경해줘'); const b4 = g.chat.posts[g.chat.posts.length - 1];
                ok(b4.orders.length === 1 && b4.orders[0].buyer === '일칠마' && /^\[미매칭\]/.test(b4.orders[0].opt) && b4.orders[0].partner === '대성' && /미매칭\) 1건/.test(b4.summary) && /거래처만 골라/.test(b4.summary), '⑰4 🔴 실사용: 거래처 카드에서 거래처를 고른 뒤에도 「미매칭」이라고 하면 그 주문을 후보로 보내고 요약에도 1건으로', b4.summary.split('\n').find(t => /미매칭/.test(t)));
                await apply(g.pg);
                ok((await g.pg.locator(`${SEL.card}[data-fo-card="${CARD.partner}"]`).count()) === 0, '⑰4 품목 이름을 바꾸면 거래처 카드가 사라짐(골라 둔 것 포함)');
                // 파일까지
                for (const t of [...Object.keys(ACT), 'memo-edit']) { for (let q = 0; q < 40; q++) { const c = g.pg.locator(`${SEL.pending}[data-fo-card="${t}"]`).first(); if (!(await c.count())) break; await c.locator(`[data-fo-act="${t === 'memo-edit' ? 'keep' : ACT[t]}"]`).first().click(); await g.pg.waitForTimeout(120); } }
                ok((await pendingN(g.pg)) === 0 && !(await g.pg.isDisabled(SEL.make)), '⑰5 남은 카드 처리 → [파일 만들기] 켜짐');
                await g.pg.click(SEL.make); await idle(g.pg); await g.pg.waitForSelector(SEL.save, { timeout: 15000 }); await g.pg.waitForTimeout(400);
                const names7 = await g.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save); const W7 = {};
                for (const nm of names7) { const [dl] = await Promise.all([g.pg.waitForEvent('download', { timeout: 20000 }), g.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 's17-' + Date.now() + '.xlsx'); await dl.saveAs(f); W7[nm.includes('(대성)') ? '대성' : nm.includes('(효돈)') ? '효돈' : '스토어'] = XLSX.readFile(f, { cellStyles: true }); }
                const all7 = ['대성', '효돈'].flatMap(k => (W7[k] ? XLSX.utils.sheet_to_json(W7[k].Sheets.Sheet1, { header: 1, defval: '' }).slice(1).map(r => ({ k, r })) : [])); const row7 = nm => all7.find(x => x.r[3] === nm);
                ok(!row7('일칠나') && !row7('묶음받는일') && !row7('묶음받는이') && !!row7('일칠마') && row7('일칠마').k === '대성' && row7('일칠마').r[4] === target && !!row7('일칠바') && row7('일칠바').r[8] === rows17[6]['통합배송지'], '⑰5 파일: 말로 뺀 주문 없음 · 이름을 바꾼 주문은 대성 파일 · 손대지 않은 주문은 그대로');
                await g.pg.evaluate(() => document.getElementById('fo-chat').scrollIntoView({ block: 'start' })); await g.pg.waitForTimeout(400);
                await g.pg.screenshot({ path: path.join(SHOT, 'fo-chat-pc.png') });
                ok(g.errs.length === 0, '⑰ 오류 0', g.errs.join(' | ')); await g.ctx.close();
                // 폰 390px
                const h = await mkChat(false, rows17, { width: 390, height: 844 }, true);
                await setCash(h.pg, null); await h.pg.click(SEL.start); await idle(h.pg); await h.pg.waitForTimeout(400);
                h.chat.answer = b => ({ reply: '주소를 바꿀게요.', actions: [{ op: 'addr', n: nOf(b, '일칠바'), text: '서울 가짜구 아주긴주소시험로 123번길 45, 가나다라마바사아파트 101동 1201호' }] });
                await say(h.pg, '일칠바 건 주소 서울 가짜구 아주긴주소시험로 123번길 45, 가나다라마바사아파트 101동 1201호로 바꿔줘'); await apply(h.pg);
                h.chat.answer = b => ({ reply: '', actions: [{ op: 'qty', n: nOf(b, '일칠바'), qty: 2 }] }); await say(h.pg, '일칠바 건 2박스로');
                const ov = await h.pg.evaluate(() => { const W = window.innerWidth, bad = []; document.querySelectorAll('#fo-chat, #fo-chat *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push(el.className || el.tagName); }); const body = document.querySelector('#fo-panel .fo-body') || document.getElementById('fo-panel'); return { W, bad: bad.slice(0, 5), sw: body.scrollWidth, cw: body.clientWidth, send: Math.round(document.getElementById('fo-chat-send').getBoundingClientRect().width), applyH: Math.round(document.querySelector('#fo-chat-log [data-chat="apply"]').getBoundingClientRect().height) }; });
                ok(ov.bad.length === 0 && ov.sw <= ov.cw + 1 && ov.send === 44 && ov.applyH >= 44, '⑰6 폰(390px): 대화 칸 가로 넘침 0 · 보내기 44px · [적용] 터치 44px 이상', JSON.stringify(ov));
                await h.pg.evaluate(() => document.getElementById('fo-chat').scrollIntoView({ block: 'start' })); await h.pg.waitForTimeout(400);
                await h.pg.screenshot({ path: path.join(SHOT, 'fo-chat-phone.png') }); await h.ctx.close();
            }

            // ── ⑱ #528 말로 주소를 바꿀 때 도로명 주소 검색으로 확인(주소·검색 응답은 전부 가짜) ─────────────────
            console.log('\n⑱ #528 주소 변경 = 도로명 주소 검색으로 확인');
            {
                const MEMO_ADDR = '주소가 바뀌었어요 경기 가짜시 메모로 77, 202호 로 보내주세요';
                const rows18 = [mk('주팔가'), mk('주팔나'), mk('주팔다'), mk('주팔라'), mk('주팔마'), mk('주팔바', { memo: MEMO_ADDR }), mk('주팔사')];
                const J = (part, bd, zip, jibun) => ({ roadAddrPart1: part, roadAddr: part + (bd ? ` (${bd})` : ''), bdNm: bd || '', zipNo: zip || '00000', jibunAddr: jibun || '', detBdNmList: '' });
                const R = list => ({ results: { common: { errorCode: '0', errorMessage: '정상', totalCount: String(list.length) }, juso: list } }); const NOJUSO = R([]);
                const k = await mkChat(false, rows18);
                k.chat.juso = kw => /시험로 12/.test(kw) ? R([J('충청남도 가짜시 시험로 12', '가짜아파트', '31000', '충청남도 가짜시 가짜동 100')])
                    : /여러로 1/.test(kw) ? R([J('서울특별시 가짜구 여러로 1', '가짜빌딩', '06000'), J('서울특별시 다른구 여러로 1', '다른빌딩', '07000')])
                    : /실패로/.test(kw) ? { error: 'NOKEY' }
                    : /메모로 77/.test(kw) ? R([J('경기도 가짜시 메모로 77', '', '10000')]) : NOJUSO;
                await setCash(k.pg, null); await k.pg.click(SEL.start); await idle(k.pg); await k.pg.waitForTimeout(400);
                const lastPrev = () => k.pg.evaluate(() => { const b = [...document.querySelectorAll('#fo-chat-log .fo-bub.ai')].pop(); const a = b.querySelector('.fo-addr'); const ap = b.querySelector('[data-chat="apply"]'); return { text: b.innerText.replace(/\s+/g, ' '), state: a ? a.getAttribute('data-addr-state') : null, applyOff: ap ? ap.disabled : null, opts: [...b.querySelectorAll('[data-addr-pick]')].map(x => x.textContent.trim()), open: b.getAttribute('data-chat-preview') }; });
                // 1건 확정: 줄임말 → 전체 이름 · 상세는 적은 그대로
                k.chat.answer = b => ({ reply: '주소를 바꿀게요.', actions: [{ op: 'addr', n: nOf(b, '주팔가'), text: '충남 가짜시 시험로 12, 가짜아파트 101동 1201호' }] });
                await say(k.pg, '주팔가 건 주소 충남 가짜시 시험로 12, 가짜아파트 101동 1201호로 바꿔줘'); let pv = await lastPrev();
                ok(pv.state === 'one' && /도로명 주소 확인됨/.test(pv.text) && /→ 「충청남도 가짜시 시험로 12 가짜아파트 101동 1201호」/.test(pv.text) && pv.applyOff === false && k.chat.jusoQ[0] === '충남 가짜시 시험로 12', '⑱1 검색 1건: 「후」가 도로명 주소(충남 → 충청남도) + 상세(적은 그대로) · 「도로명 주소 확인됨」 · 검색어는 상세를 뗀 앞부분', pv.text.slice(-90) + ' / ' + k.chat.jusoQ[0]);
                await k.pg.click('#fo-chat-log [data-chat="apply"]'); await chatIdle(k.pg); await idle(k.pg);
                // 여러 건: 골라야 [적용]
                k.chat.answer = b => ({ reply: '', actions: [{ op: 'addr', n: nOf(b, '주팔나'), text: '서울 가짜구 여러로 1, 3층' }] });
                await say(k.pg, '주팔나 건 주소 서울 가짜구 여러로 1, 3층으로 바꿔줘'); pv = await lastPrev();
                ok(pv.state === 'multi' && pv.applyOff === true && pv.opts.length === 3 && /적은 그대로 넣기/.test(pv.opts[2]) && /다른구/.test(pv.opts[1]), '⑱2 검색 여러 건: 후보 목록 + 「적은 그대로 넣기」 · 고르기 전에는 [적용] 꺼짐', JSON.stringify(pv.opts));
                await k.pg.click('#fo-chat-log [data-addr-pick="0:1"]'); await k.pg.waitForTimeout(150); pv = await lastPrev();
                ok(pv.applyOff === false && /→ 「서울특별시 다른구 여러로 1 3층」/.test(pv.text), '⑱2 후보를 고르면 「후」가 그 주소 + 상세로 바뀌고 [적용] 켜짐', pv.text.slice(0, 110));
                await k.pg.click('#fo-chat-log [data-chat="apply"]'); await chatIdle(k.pg); await idle(k.pg);
                // 0건: 묻고 → 그대로 넣기 / 취소
                k.chat.answer = b => ({ reply: '', actions: [{ op: 'addr', n: nOf(b, '주팔다'), text: '부산 가짜구 없는길 9, 101호' }] });
                await say(k.pg, '주팔다 건 주소 부산 가짜구 없는길 9, 101호로 바꿔줘'); pv = await lastPrev();
                ok(pv.state === 'none' && /주소를 찾지 못했어요/.test(pv.text) && /그대로 넣을까요/.test(pv.text) && pv.applyOff === true && pv.opts.join() === '그대로 넣기,취소', '⑱3 검색 0건: 「주소를 찾지 못했어요 — 적은 글자 그대로 넣을까요?」 [그대로 넣기]/[취소] · 조용히 넣지 않음([적용] 꺼짐)', pv.text.slice(-70));
                await k.pg.click('#fo-chat-log [data-addr-pick="0:raw"]'); await k.pg.waitForTimeout(150); await k.pg.click('#fo-chat-log [data-chat="apply"]'); await chatIdle(k.pg); await idle(k.pg);
                const pn3 = await patchN(k.pg);
                k.chat.answer = b => ({ reply: '', actions: [{ op: 'addr', n: nOf(b, '주팔라'), text: '대구 가짜구 없는길 5, 202호' }] });
                await say(k.pg, '주팔라 건 주소 대구 가짜구 없는길 5, 202호로 바꿔줘'); await k.pg.click('#fo-chat-log [data-addr-pick="0:skip"]'); await k.pg.waitForTimeout(200); pv = await lastPrev();
                ok((await patchN(k.pg)) === pn3 && pv.open === 'closed' && /취소함/.test(pv.text) && !(await k.pg.isDisabled('#fo-chat-send')), '⑱3 0건에서 [취소] → 그 주소는 안 넣고 미리 보기가 닫힘(바뀌는 것 없음)');
                // 검색 실패
                k.chat.answer = b => ({ reply: '', actions: [{ op: 'addr', n: nOf(b, '주팔마'), text: '인천 가짜구 실패로 3, 1층' }] });
                await say(k.pg, '주팔마 건 주소 인천 가짜구 실패로 3, 1층으로 바꿔줘'); pv = await lastPrev();
                ok(pv.state === 'fail' && /주소 검색을 하지 못했어요/.test(pv.text) && pv.applyOff === true, '⑱4 검색 실패(승인키 없음 등): 이유와 함께 묻고 [적용] 꺼짐', pv.text.slice(-80));
                await k.pg.click('#fo-chat-log [data-addr-pick="0:raw"]'); await k.pg.waitForTimeout(150); await k.pg.click('#fo-chat-log [data-chat="apply"]'); await chatIdle(k.pg); await idle(k.pg);
                // 손님 메모에 적힌 주소(직원이 「메모 주소로」라고 시킴)
                k.chat.answer = b => ({ reply: '메모에 적힌 주소로 바꿀게요.', actions: [{ op: 'addr', n: nOf(b, '주팔바'), text: '경기 가짜시 메모로 77, 202호' }] });
                await say(k.pg, '주팔바 건 메모에 적힌 주소로 바꿔줘'); pv = await lastPrev();
                ok(pv.state === 'one' && /→ 「경기도 가짜시 메모로 77 202호」/.test(pv.text), '⑱5 지시 글에는 없지만 그 주문의 손님 메모에 그대로 있는 주소 글자는 통과 → 도로명 주소로', pv.text.slice(-60));
                await k.pg.click('#fo-chat-log [data-chat="apply"]'); await chatIdle(k.pg); await idle(k.pg);
                k.chat.answer = b => ({ reply: '', actions: [{ op: 'addr', n: nOf(b, '주팔사'), text: '경기 가짜시 메모로 77, 202호' }] });
                await say(k.pg, '주팔사 건 주소 바꿔줘'); pv = await lastPrev();
                ok(pv.open !== 'open' && /다시 적어/.test(pv.text), '⑱5 다른 주문의 메모에 있는 주소(이 주문 메모·지시 글에 없음)는 거부', pv.text.slice(-70));
                // 목록·기록에는 이름만 · 파일
                const ptxt = await k.pg.evaluate(() => document.getElementById('fo-patches').textContent);
                ok(/주소 변경: 주팔가/.test(ptxt) && !/시험로|여러로|없는길|실패로|메모로/.test(ptxt), '⑱6 「말로 바꾼 것」 목록에는 「주소 변경: 이름」만(주소 글자 없음)', ptxt.slice(0, 80));
                for (const t of [...Object.keys(ACT), 'memo-edit']) { for (let q = 0; q < 40; q++) { const c = k.pg.locator(`${SEL.pending}[data-fo-card="${t}"]`).first(); if (!(await c.count())) break; await c.locator(`[data-fo-act="${t === 'memo-edit' ? 'keep' : ACT[t]}"]`).first().click(); await k.pg.waitForTimeout(120); } }
                await k.pg.click(SEL.make); await idle(k.pg); await k.pg.waitForSelector(SEL.save, { timeout: 15000 }); await k.pg.waitForTimeout(400);
                const names8 = await k.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save); const all8 = [];
                for (const nm of names8.filter(x => !x.includes('스마트스토어'))) { const [dl] = await Promise.all([k.pg.waitForEvent('download', { timeout: 20000 }), k.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 's18-' + Date.now() + '.xlsx'); await dl.saveAs(f); const ws = XLSX.readFile(f, { cellStyles: true }).Sheets.Sheet1; XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).forEach((r, i) => { if (i) all8.push({ r, fill: fillOf(ws['I' + (i + 1)]) }); }); }
                const I = nm => { const x = all8.find(y => y.r[3] === nm); return x ? { v: x.r[8], fill: x.fill, qty: Number(x.r[5]), opt: x.r[4] } : null; }; const src = nm => rows18.find(r => r['수취인명'] === nm);
                ok(I('주팔가').v === '충청남도 가짜시 시험로 12 가짜아파트 101동 1201호' && I('주팔가').fill === 'E4DFEC' && I('주팔나').v === '서울특별시 다른구 여러로 1 3층' && I('주팔다').v === '부산 가짜구 없는길 9, 101호' && I('주팔마').v === '인천 가짜구 실패로 3, 1층' && I('주팔바').v === '경기도 가짜시 메모로 77 202호', '⑱7 파일 I칸: 확정·고른 주소 = 도로명 주소 + 상세 · 못 찾아 「그대로 넣기」한 것은 적은 글자 그대로 · 연보라', JSON.stringify([I('주팔가').v, I('주팔다').v]));
                ok(I('주팔라').v === src('주팔라')['통합배송지'] && I('주팔라').fill !== 'E4DFEC' && I('주팔사').v === src('주팔사')['통합배송지'] && all8.every(x => Number(x.r[5]) === 1) && !all8.some(x => /\d{5}/.test(String(x.r[8]).replace(/\d+동|\d+호/g, '')) && /31000|06000|10000/.test(x.r[8])), '⑱7 🔴 취소한 주문·손대지 않은 주문의 주소는 원본 그대로 · 수량 무변경 · 우편번호는 안 들어감');
                const lg8 = (k.hits.logs || [])[0];
                ok(!!lg8 && lg8.lines.some(t => /주소 변경 5건/.test(t)) && !lg8.lines.some(t => /시험로|여러로|없는길|실패로|메모로/.test(t)), '⑱6 정리 기록에는 「주소 변경 N건: 이름」만(주소 글자 없음)', lg8 && lg8.lines.find(t => /주소 변경/.test(t)));
                ok(k.errs.length === 0, '⑱ 오류 0', k.errs.join(' | ')); await k.ctx.close();
            }

            // ── ⑲ #530 [초기화] — 최종발주를 방금 연 상태로 ─────────────────────────────────────
            console.log('\n⑲ #530 초기화');
            {
                const rows19 = [mk('일구가', { memo: '다음주에 보내주세요' }), mk('일구나'), mk('일구다', { opt: '세상에 없는 과일 9kg' })];
                const r = await mkChat(false, rows19);
                const snap = () => r.pg.evaluate(() => { const t = window.AkmFinalOrder.state, f = document.getElementById('fo-frame'), i = f && f.contentWindow && f.contentWindow.__ivt; const vis = id => { const el = document.getElementById(id); return !!el && !el.hidden; };
                    return { phase: t.phase, loaded: t.loaded, judged: t.judged, dec: t.dec.size, draft: t.draft.size, patch: t.patch.size, chat: t.chat.log.length, logId: t.logId, files: t.files.length, cards: t.cards.length, aiDone: t.ai.done, cash: !!t.cash, cashNone: t.cashNone, noneChecked: document.getElementById('fo-cash-none').checked, memo: document.getElementById('fo-memo').value, ship: document.getElementById('fo-ship').value,
                        review: vis('fo-review'), result: vis('fo-result'), chatSec: vis('fo-chat'), progress: vis('fo-progress'), start: vis('fo-start'), rejudge: vis('fo-rejudge'), confirm: vis('fo-reset-confirm'), bubbles: document.querySelectorAll('#fo-chat-log .fo-bub').length, merged: i && i.S && i.S.merged ? i.S.merged.length : -1, lines: f && f.contentDocument && f.contentDocument.getElementById('ln-all') ? f.contentDocument.getElementById('ln-all').value : null }; });
                const first = await snap();
                const rb = await r.pg.evaluate(() => { const b = document.getElementById('fo-reset'), cs = getComputedStyle(b), row = b.parentElement.getBoundingClientRect(), bb = b.getBoundingClientRect(); return { color: cs.color, border: cs.borderTopColor, h: Math.round(bb.height), rightGap: Math.round(row.right - bb.right) }; });
                ok(rb.color === 'rgb(180, 35, 24)' && rb.h >= 44 && rb.rightGap <= 2 && !first.confirm, '⑲1 [초기화] 버튼: 빨간 글씨 · 줄 오른쪽 끝 · 44px 이상 · 확인 상자는 숨김', JSON.stringify(rb));
                await r.pg.fill(SEL.memo, `${FX.usd(later)}\t010-7999-0000\t\t네이버`); await setCash(r.pg, null); await r.pg.click(SEL.start); await idle(r.pg); await r.pg.waitForTimeout(400);
                const c0 = await cardCount(r.pg), n0 = r.hits.naver;
                await r.pg.locator(`${SEL.pending}[data-fo-card="${CARD.order}"]`).first().locator('[data-fo-act="send"]').click(); await r.pg.waitForTimeout(150);
                r.chat.answer = b => ({ reply: '', actions: [{ op: 'qty', n: nOf(b, '일구나'), qty: 2 }] }); await say(r.pg, '일구나 건 2박스로'); await apply(r.pg);
                await r.pg.locator(`${SEL.pending}[data-fo-card="${CARD.partner}"] select[data-pick]`).first().selectOption(FX.P_HYODON); await r.pg.waitForTimeout(200);
                for (const t of [...Object.keys(ACT), 'memo-edit']) { for (let q = 0; q < 20; q++) { const c = r.pg.locator(`${SEL.pending}[data-fo-card="${t}"]`).first(); if (!(await c.count())) break; await c.locator(`[data-fo-act="${t === 'memo-edit' ? 'keep' : ACT[t]}"]`).first().click(); await r.pg.waitForTimeout(120); } }
                await r.pg.click(SEL.make); await idle(r.pg); await r.pg.waitForSelector(SEL.save, { timeout: 15000 }); await r.pg.waitForTimeout(400);
                const full = await snap();
                ok(full.phase === 'result' && full.dec >= 2 && full.patch === 1 && full.chat >= 2 && full.files >= 2 && full.logId === 7001 && full.result && full.chatSec && /7999/.test(full.memo) && full.noneChecked, '⑲ 준비: 메모 · 「오늘은 없음」 · 카드 결정 · 말로 바꾼 것 · 대화 · 결과 파일 · 정리 기록이 있는 상태', JSON.stringify({ dec: full.dec, patch: full.patch, chat: full.chat, files: full.files }));
                // 취소
                let dlg = 0; r.pg.on('dialog', () => { dlg++; });
                await r.pg.click('#fo-reset'); await r.pg.waitForTimeout(150); const cf = await r.pg.evaluate(() => { const c = document.getElementById('fo-reset-confirm'); return { shown: !c.hidden, text: c.innerText.replace(/\s+/g, ' ') }; });
                ok(cf.shown && /전부 지우고 처음부터/.test(cf.text) && /메모/.test(cf.text) && /말로 바꾼 것/.test(cf.text) && dlg === 0, '⑲2 누르면 브라우저 창이 아니라 패널 안 확인 상자([초기화]/[취소])', cf.text.slice(0, 80));
                await r.pg.click('#fo-reset-no'); await r.pg.waitForTimeout(150); const kept = await snap();
                ok(!kept.confirm && JSON.stringify({ ...kept, confirm: 0 }) === JSON.stringify({ ...full, confirm: 0 }), '⑲2 [취소] → 아무것도 안 바뀜');
                // 초기화
                await r.pg.click('#fo-reset'); await r.pg.click('#fo-reset-yes'); await r.pg.waitForTimeout(300); await idle(r.pg);
                await r.pg.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await r.pg.waitForTimeout(300);
                const z = await snap();
                ok(z.phase === 'input' && !z.loaded && !z.judged && z.dec === 0 && z.draft === 0 && z.patch === 0 && z.chat === 0 && z.logId === 0 && z.files === 0 && z.cards === 0 && !z.aiDone, '⑲3 초기화: 카드 결정 · 적다 만 글 · AI 결과 · 말로 바꾼 것 · 대화 · 결과 파일 · 정리 기록 번호가 전부 비워짐', JSON.stringify({ dec: z.dec, patch: z.patch, chat: z.chat, files: z.files, logId: z.logId }));
                ok(z.memo === '' && !z.cash && !z.cashNone && !z.noneChecked && z.ship === first.ship, '⑲3 메모 빈칸 · 현금파일 해제(「오늘은 없음」도 처음 값) · 기준 발송일 = 추천값', JSON.stringify({ memo: z.memo, none: z.noneChecked, ship: z.ship }));
                ok(!z.review && !z.result && !z.chatSec && !z.progress && z.start && !z.rejudge && z.bubbles === 0 && z.merged === 0 && z.lines === '', '⑲3 화면이 처음 모양(확인·결과·대화 숨김 · [주문 불러와 시작하기] 보임) · 숨은 계산 화면도 새로(주문 0 · 줄 빈칸)', JSON.stringify({ merged: z.merged, lines: z.lines, start: z.start }));
                await setCash(r.pg, null); await r.pg.click(SEL.start); await idle(r.pg); await r.pg.waitForTimeout(400);
                const c1 = await cardCount(r.pg), z2 = await snap();
                ok(r.hits.naver === n0 + 1 && JSON.stringify(c1) !== JSON.stringify({}) && (c1[CARD.order] || {}).pending === (c0[CARD.order] || {}).pending && (c1[CARD.partner] || {}).pending === 1 && z2.patch === 0 && z2.memo === '', '⑲4 초기화 뒤 다시 시작 → 주문을 새로 불러오고 카드가 처음처럼 전부 열림(앞서 고른 것 없음)', JSON.stringify(c1));
                // 대화가 도는 중에 초기화 → 그 요청도 정리
                r.chat.mode = 'wait'; const d0 = r.chat.dels; await r.pg.fill('#fo-chat-input', '제주 건 있어?'); await r.pg.click('#fo-chat-send'); await r.pg.waitForFunction(() => window.AkmFinalOrder.state.chat.id, null, { timeout: 15000 });
                await r.pg.click('#fo-reset'); await r.pg.click('#fo-reset-yes'); await r.pg.waitForTimeout(300); await idle(r.pg); for (let q = 0; q < 24 && r.chat.dels <= d0; q++) await r.pg.waitForTimeout(250);
                const z3 = await snap();
                ok(r.chat.dels === d0 + 1 && z3.phase === 'input' && z3.chat === 0 && z3.bubbles === 0, '⑲5 대화 요청이 도는 중에 초기화해도 그 요청을 정리(DELETE)하고 처음 상태로', `DELETE ${r.chat.dels - d0}`);
                ok(r.errs.length === 0, '⑲ 오류 0', r.errs.join(' | ')); await r.ctx.close();
                const m9 = await mkChat(false, rows19, { width: 390, height: 844 }, true);
                await m9.pg.click('#fo-reset'); await m9.pg.waitForTimeout(200);
                const ov9 = await m9.pg.evaluate(() => { const W = window.innerWidth, c = document.getElementById('fo-reset-confirm'), bad = [...c.querySelectorAll('*'), c, document.getElementById('fo-reset')].filter(el => { const b = el.getBoundingClientRect(); return b.width && (b.right > W + 1 || b.left < -1); }).length; return { bad, h: [...c.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().height)), reset: Math.round(document.getElementById('fo-reset').getBoundingClientRect().height) }; });
                ok(ov9.bad === 0 && ov9.h.every(h => h >= 44) && ov9.reset >= 44, '⑲6 폰(390px): 초기화 버튼·확인 상자 가로 넘침 0 · 터치 44px 이상', JSON.stringify(ov9)); await m9.ctx.close();
            }

            // ── ⑳ #527 전화번호가 든 말 = 클코에게 · 진짜 정리 줄 = 메모 칸 · 「이건」 = 방금 그 줄의 주문 ─────────────────
            console.log('\n⑳ #527 번호가 든 말과 정리 줄 가르기');
            {
                const PID16 = '2026100512345678';
                const rows20 = [mk('이공가', { tel: '010-1111-2222' }), mk('이공나', { tel: '010-3333-4444' }), mk('이공다', { tel: '010-5555-6666' }), mk('이공라', { tel: '010-7777-8888' }), mk('이공마', { tel: '010-9999-0000' }), mk('이공바', { pid: PID16 }), mk('이공사', { tel: '010-2222-3333' }), mk('이공아')];
                const t = await mkChat(false, rows20);
                await setCash(t.pg, null); await t.pg.click(SEL.start); await idle(t.pg); await t.pg.waitForTimeout(400);
                const memoV = () => t.pg.inputValue(SEL.memo); const lastPost = () => t.chat.posts[t.chat.posts.length - 1];
                // 오늘 아침 실물 문장
                t.chat.answer = b => ({ reply: '맞아요. 품목 뒤에 10과로! 를 붙일게요.', actions: [{ op: 'tail', n: b.orders[0].n, text: '10과로!' }] });
                await say(t.pg, '010-1111-2222 주문건 황금향 3키로 선물용 맞는지 확인하고 10과로! 로 표시해줘!');
                const p1 = lastPost(), raw1 = JSON.stringify(p1);
                ok(t.chat.posts.length === 1 && (await memoV()) === '' && p1.kind === 'chat' && p1.orders.length === 1 && p1.orders[0].buyer === '이공가', '⑳1 실물 문장(번호 + 「확인하고 … 표시해줘」): 메모 칸에 안 들어가고 클코에게 감 · 후보 = 그 번호의 주문 1건', `대화 ${t.chat.posts.length} · 메모 칸 「${await memoV()}」 · 후보 ${p1.orders.map(o => o.buyer)}`);
                ok(!/010-?1111-?2222|01011112222/.test(raw1) && /\(전화 끝 2222\)/.test(p1.ask) && /10과로!/.test(p1.ask), '⑳1 클코에게 보낸 글에는 전화번호 전체가 없고 「(전화 끝 2222)」만', p1.ask.slice(0, 60));
                let lb20 = await lastBub(t.pg); ok(lb20.preview === 'open' && /10과로!/.test(lb20.text), '⑳1 응답 tail 「10과로!」 → 미리 보기', lb20.text.slice(0, 90)); await apply(t.pg);
                // 하이픈 없이
                t.chat.answer = b => ({ reply: '', actions: [{ op: 'exclude', n: b.orders[0].n }] });
                await say(t.pg, '01011112222 건 빼줘'); const p2 = lastPost();
                ok(t.chat.posts.length === 2 && (await memoV()) === '' && p2.orders.length === 1 && p2.orders[0].buyer === '이공가' && !/01011112222|010-1111-2222/.test(JSON.stringify(p2)) && p2.history.some(h => h.who === 'me' && /\(전화 끝 2222\)/.test(h.text)), '⑳2 하이픈 없이 붙여 쓴 번호 + 「빼줘」도 그 주문이 후보 · 앞 대화(history)에도 번호 전체 없음', p2.ask);
                await t.pg.click('#fo-chat-log [data-chat="cancel"]'); await t.pg.waitForTimeout(200);
                // 옵션 끝에 붙었는지(파일)
                ok((await pendingN(t.pg)) === 0, '⑳ 준비: 남은 카드 0', JSON.stringify(await cardCount(t.pg)));
                const J20 = (await readJudge(t.pg)).judge;
                await t.pg.click(SEL.make); await idle(t.pg); await t.pg.waitForSelector(SEL.save, { timeout: 15000 }); await t.pg.waitForTimeout(300);
                const n20 = await t.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save); const a20 = [];
                for (const nm of n20.filter(x => !x.includes('스마트스토어'))) { const [dl] = await Promise.all([t.pg.waitForEvent('download', { timeout: 20000 }), t.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 's20-' + Date.now() + '.xlsx'); await dl.saveAs(f); XLSX.utils.sheet_to_json(XLSX.readFile(f).Sheets.Sheet1, { header: 1, defval: '' }).slice(1).forEach(r => a20.push(r)); }
                const r20 = a20.find(r => r[3] === '이공가');
                ok(!!r20 && r20[4] === J20['이공가'].opt + ' 10과로!', '⑳1 [적용] → 그 주문 옵션 끝에 「 10과로!」', r20 && r20[4].slice(-24));
                // 진짜 정리 줄 5꼴 → 메모 칸 · 대화 호출 0
                const lines5 = [`${FX.usd(ship)}\t010-3333-4444\t입력o삭제x\t네이버`, '010-5555-6666 금요일 발송', `${FX.usd(ship)}\t010-7777-8888\t보내는이 홍길동`, '010-9999-0000 개별발송처리', `${FX.usd(ship)}\t${PID16}\t메모무시\t네이버`];
                const before5 = t.chat.posts.length; const got5 = [];
                for (const ln of lines5) { await say(t.pg, ln); await idle(t.pg); got5.push((await memoV()).split('\n').includes(ln)); }
                ok(t.chat.posts.length === before5 && got5.every(Boolean) && (await memoV()).split('\n').filter(Boolean).length === 5, '⑳3 진짜 정리 줄 5꼴(입력삭제 · 요일 발송 · 보내는이 · 개별발송처리 · 상품주문번호 메모무시)은 메모 칸으로 가고 클코 호출 0', JSON.stringify(got5));
                const J20b = (await readJudge(t.pg)).judge;
                ok(J20b['이공나'].individual && J20b['이공마'].individual && J20b['이공바'].kind === 'today', '⑳3 넣은 줄이 그대로 판정에 반영(입력삭제 2건 · 메모무시 = 그날 발송)', JSON.stringify({ 나: J20b['이공나'].individual, 마: J20b['이공마'].individual, 바: J20b['이공바'].kind }));
                // 정리 줄 직후 「이건 빼줘」
                await say(t.pg, `${FX.usd(later)}\t010-2222-3333\t\t네이버`); await idle(t.pg);
                t.chat.answer = b => ({ reply: '', actions: (b.orders || []).map(o => ({ op: 'include', n: o.n })) });
                const before6 = t.chat.posts.length; await say(t.pg, '이건 다시 넣어줘'); const p6 = lastPost();
                ok(t.chat.posts.length === before6 + 1 && p6.orders.length === 1 && p6.orders[0].buyer === '이공사' && p6.orders[0].state === '오늘 안 나감', '⑳4 정리 줄을 넣은 직후 「이건 …」 → 후보 = 방금 그 줄의 주문(상태 = 오늘 안 나감)', JSON.stringify(p6.orders.map(o => [o.buyer, o.state])));
                ok(t.errs.length === 0, '⑳ 오류 0', t.errs.join(' | ')); await t.ctx.close();
            }

            // ── ㉑ #523 옵션에 사이즈 꼬리가 붙은 주문의 메모 — AI가 사이즈 글을 정리 ─────────────────────────
            console.log('\n㉑ #523 사이즈 요청 메모');
            {
                const sizeBase = fx.naver.find(r => /사이즈/.test(String(r['배송메세지'] || '')));   // 가짜 재료의 「s사이즈로 보내주세요」 주문(옵션에 사이즈 꼬리가 붙는 품목)
                const S1 = '꼭 2S로 보내주세요', S2 = '2S로 주세요 문 앞에 놔주세요', S3 = '문 앞에 놔주세요';
                const rows21 = [mk('이일가', { base: sizeBase, memo: S1 }), mk('이일나', { base: sizeBase, memo: S2 }), mk('이일다', { base: sizeBase, memo: S3 }), mk('이일라', { base: sizeBase })];
                const u = await mkChat(false, rows21);
                u.chat.memoAns = it => (it.memo === S1 ? { memo: '기본', sure: true, why: '사이즈는 옵션에 반영됨' } : it.memo === S2 ? { memo: '문 앞에 놔주세요', sure: true, why: '사이즈 글만 뗌' } : {});
                await setCash(u.pg, null); await u.pg.click(SEL.start); await idle(u.pg); await u.pg.waitForTimeout(500);
                const J21 = (await readJudge(u.pg)).judge, mp21 = u.chat.memoPosts[0] || { items: [] };
                ok(/2S사이즈로!$/.test(J21['이일가'].opt) && /2S사이즈로!$/.test(J21['이일나'].opt) && !/사이즈로!$/.test(J21['이일다'].opt), '㉑ 준비: 「2S로」 메모 주문은 옵션에 「2S사이즈로!」 꼬리 · 사이즈 말이 없는 주문은 꼬리 없음', J21['이일가'].opt.slice(-20));
                const sent21 = mp21.items.map(it => it.memo);
                ok(sent21.includes(S1) && sent21.includes(S2) && !sent21.includes(S3) && mp21.items.filter(it => /사이즈/.test(it.memo) || it.memo === S1 || it.memo === S2).every(it => /사이즈 요청은 옵션에 반영됨/.test(it.hint)), '㉑1 사이즈 꼬리가 붙은 주문의 메모는 AI 묶음에 들어가고 hint 「사이즈 요청은 옵션에 반영됨」 · 꼬리 없는 주문의 「문 앞에 놔주세요」는 안 보냄', JSON.stringify(mp21.items.map(it => [it.memo.slice(0, 12), it.hint])));
                ok((await pendingN(u.pg)) === 0 && (await u.pg.evaluate(() => [...document.querySelectorAll('#fo-info li')].filter(li => /AI가 배송메세지 정리/.test(li.textContent)).length)) === 2, '㉑2 응답 「기본」·「남길 글」(확실) → 카드 없이 정리(참고 목록 2줄)', JSON.stringify(await cardCount(u.pg)));
                await u.pg.click(SEL.make); await idle(u.pg); await u.pg.waitForSelector(SEL.save, { timeout: 15000 }); await u.pg.waitForTimeout(300);
                const n21 = await u.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save); const a21 = []; let st21 = null;
                for (const nm of n21) { const [dl] = await Promise.all([u.pg.waitForEvent('download', { timeout: 20000 }), u.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 's21-' + Date.now() + '.xlsx'); await dl.saveAs(f); const wb = XLSX.readFile(f);
                    if (nm.includes('스마트스토어')) st21 = XLSX.utils.sheet_to_json(wb.Sheets['발주발송관리'], { header: 1, defval: '' }); else XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' }).slice(1).forEach(r => a21.push(r)); }
                const j21 = nm => (a21.find(r => r[3] === nm) || [])[9];
                ok(j21('이일가') === FX.DEFAULT_MEMO && j21('이일나') === '문 앞에 놔주세요' && j21('이일다') === S3 && j21('이일라') === FX.DEFAULT_MEMO, '㉑2 택배사 파일 J: 「꼭 2S로…」 → 기본 문구 · 「2S로 주세요 문 앞에…」 → 「문 앞에 놔주세요」 · 사이즈 말 없는 메모는 그대로', JSON.stringify([j21('이일가').slice(0, 6), j21('이일나')]));
                const hdr21 = st21 ? st21[1] : [], cM = hdr21.indexOf('배송메세지'), cR = hdr21.indexOf('수취인명'); const stMemo = nm => { const r = (st21 || []).find(x => x[cR] === nm); return r ? r[cM] : null; };
                ok(cM >= 0 && stMemo('이일가') === S1 && stMemo('이일나') === S2, '㉑2 스토어 양식의 배송메세지는 손님 원문 그대로', JSON.stringify([stMemo('이일가'), stMemo('이일나')]));
                ok(u.errs.length === 0, '㉑ 오류 0', u.errs.join(' | ')); await u.ctx.close();
            }

            // ── ㉒ #535 품목 통째로 바꾸기(optall) — 「○○ 전부 △△로」 ──────────────────────────────────────
            console.log('\n㉒ #535 품목 통째로 바꾸기');
            {
                const sizeBase22 = fx.naver.find(r => /사이즈/.test(String(r['배송메세지'] || '')));
                const D22 = cat.byPartner[FX.P_DAESUNG] || [];
                const rows22 = [mk('이이가'), mk('이이나', { base: sizeBase22, memo: '꼭 2S로 보내주세요' }), mk('이이다', { qty: 3 }), mk('이이라', { opt: D22[1] }), mk('이이마')];
                const v = await mkChat(false, rows22);
                v.chat.memoAns = () => ({ memo: '기본', sure: true });
                // 현금파일: 같은 품목(바꾸기 전 이름) 1행 — 이 행은 손대지 않는다
                const J0 = (await (async () => { await setCash(v.pg, null); await v.pg.click(SEL.start); await idle(v.pg); await v.pg.waitForTimeout(400); return readJudge(v.pg); })()).judge;
                const FROM = J0['이이가'].opt, TO = D22[0], used = new Set(Object.values(J0).map(x => x.opt.replace(/ \S+!$/, ''))), NONE = [].concat(...Object.values(cat.byPartner)).find(n => !used.has(n) && n !== TO);
                const cashRow = fx.cashAoa.find(r => r[3] === '현금받는1').slice(); cashRow[3] = '현금이이'; cashRow[4] = FROM;
                const cash22 = path.join(TMP, '가짜_현금파일_22.xlsx'); { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([fx.cashAoa[0], cashRow]), 'Sheet1'); XLSX.writeFile(wb, cash22); }
                await setCash(v.pg, cash22); await v.pg.click(SEL.rejudge).catch(() => { }); await idle(v.pg); await v.pg.waitForTimeout(400);
                const J22 = (await readJudge(v.pg)).judge;
                ok(FROM && TO && FROM !== TO && J22['이이나'].opt === FROM + ' 2S사이즈로!' && J22['이이라'].opt === D22[1] && (await pendingN(v.pg)) === 0, '㉒ 준비: 같은 품목 4건(그중 1건은 「2S사이즈로!」 꼬리 · 1건은 3박스) + 다른 품목 1건 + 현금파일 같은 품목 1행 · 남은 카드 0', JSON.stringify({ from: FROM.slice(-18), to: TO.slice(-18), cards: await cardCount(v.pg) }));
                const lastP = () => v.chat.posts[v.chat.posts.length - 1];
                // 단가표에 없는 이름 · 해당 주문 0건 → 거부
                v.chat.answer = () => ({ reply: '', actions: [{ op: 'optall', from: FROM, to: '세상에 없는 과일 9kg' }] });
                await say(v.pg, '2.5kg 로얄과 전부 없는과일로 바꿔줘'); let b22 = await lastBub(v.pg);
                ok(b22.bad === 1 && /단가표\)에 없는 이름/.test(b22.text) && b22.preview !== 'open' && (await patchN(v.pg)) === 0, '㉒1 단가표에 없는 이름으로는 못 바꿈(빨간 글 · [적용] 없음)', b22.text.slice(0, 110));
                const sum22 = lastP().summary;
                ok(/품목별\(택배사 양식으로 나가는 주문/.test(sum22) && sum22.includes(`「${FROM}」 4건(6박스)`) && sum22.includes(`「${D22[1]}」 1건(1박스)`), '㉒2 클코에게 보내는 요약에 품목별 건수(꼬리 뗀 이름 · 현금파일 행 제외)', sum22.split('\n').pop().slice(0, 140));
                if (NONE) { v.chat.answer = () => ({ reply: '', actions: [{ op: 'optall', from: NONE, to: TO }] }); await say(v.pg, '없는 품목 전부 바꿔줘'); b22 = await lastBub(v.pg);
                    ok(b22.bad === 1 && /그 품목이 없어요/.test(b22.text) && b22.preview !== 'open', '㉒3 그 품목으로 나가는 주문이 0건이면 거부', b22.text.slice(0, 110)); } else note('㉒3 주문 없는 단가표 품목을 못 찾아 건너뜀');
                // 미리 보기 → 적용
                v.chat.answer = () => ({ reply: '2.5kg 로얄과 주문을 전부 바꿀게요.', actions: [{ op: 'optall', from: FROM, to: TO }] });
                await say(v.pg, '2.5kg 로얄과 전부 다른 품목으로 바꿔줘'); b22 = await lastBub(v.pg);
                ok(b22.preview === 'open' && b22.li === 1 && b22.text.includes(`품목 통째로 바꾸기: ${FROM} 4건(6박스) → ${TO}`) && /거래처 효돈 → 대성/.test(b22.text) && /현금파일에 같은 품목 1행은 그대로예요/.test(b22.text), '㉒4 미리 보기 한 줄: 「품목 통째로 바꾸기: A 4건(6박스) → B」 + 거래처 바뀜 + 현금파일 행 안내', b22.text.slice(0, 260));
                await apply(v.pg);
                const pl22 = await v.pg.evaluate(() => ({ n: window.AkmFinalOrder.state.patch.size, txt: document.getElementById('fo-patches').innerText.replace(/\s+/g, ' '), btn: document.querySelectorAll('#fo-patches [data-unpatch]').length }));
                ok(pl22.n === 4 && pl22.btn === 1 && pl22.txt.includes(`품목 통째로 변경 4건: ${FROM} → ${TO}`), '㉒5 [적용] → 4건에 걸리고 「말로 바꾼 것」에는 한 줄([되돌리기] 1개)', pl22.txt.slice(0, 160));
                const grab = async tag => { await v.pg.waitForSelector(SEL.save, { timeout: 20000 }); await v.pg.waitForTimeout(400); const names = await v.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save); const rows = []; let store = null, qty = null;
                    for (const nm of names) { const [dl] = await Promise.all([v.pg.waitForEvent('download', { timeout: 20000 }), v.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, tag + '-' + Date.now() + '.xlsx'); await dl.saveAs(f); if (!/\.xlsx$/i.test(nm)) continue; const wb = XLSX.readFile(f);
                        if (nm.includes('스마트스토어')) store = XLSX.utils.sheet_to_json(wb.Sheets['발주발송관리'], { header: 1, defval: '' }); else if (wb.Sheets.Sheet1) { XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' }).slice(1).forEach(r => rows.push({ file: nm, r })); const s2 = wb.SheetNames.find(n => n !== 'Sheet1'); if (s2 && nm.includes('대성')) qty = XLSX.utils.sheet_to_json(wb.Sheets[s2], { header: 1, defval: '' }); } }
                    return { rows, store, qty, names }; };
                await v.pg.click(SEL.make); await idle(v.pg); const g1 = await grab('s22a');
                const R = (g, nm) => g.rows.find(x => x.r[3] === nm) || { file: '', r: [] };
                ok(R(g1, '이이가').r[4] === TO && R(g1, '이이마').r[4] === TO && R(g1, '이이다').r[4] === TO && R(g1, '이이다').r[5] === 3 && R(g1, '이이나').r[4] === TO + ' 2S사이즈로!', '㉒6 택배사 파일: 그 품목 4건 전부 새 이름 · 꼬리 「2S사이즈로!」 유지 · 수량 그대로', JSON.stringify([String(R(g1, '이이가').r[4]).slice(-16), String(R(g1, '이이나').r[4]).slice(-22), R(g1, '이이다').r[5]]));
                ok(['이이가', '이이나', '이이다', '이이마'].every(n => R(g1, n).file.includes('대성')) && R(g1, '이이라').r[4] === D22[1] && R(g1, '현금이이').r[4] === FROM && R(g1, '현금이이').file.includes('효돈'), '㉒6 바뀐 4건은 대성 파일로 옮겨 감 · 다른 품목 주문 무변경 · 현금파일 행은 옛 이름으로 효돈 파일에 그대로', JSON.stringify({ 가: R(g1, '이이가').file.slice(0, 22), 현금: R(g1, '현금이이').file.slice(0, 22) }));
                const qtxt = JSON.stringify(g1.qty || []);
                ok(g1.qty && qtxt.includes(TO) && !qtxt.includes(FROM), '㉒6 대성 수량 표에 새 품목 줄이 생김(옛 이름 줄 없음)', qtxt.slice(0, 160));
                const h22 = g1.store ? g1.store[1] : [], cO = h22.indexOf('옵션정보'), cN = h22.indexOf('수취인명'); const sRow = (g1.store || []).find(x => x[cN] === '이이가');
                ok(cO >= 0 && sRow && sRow[cO] === rows22[0]['옵션정보'], '㉒6 스토어 양식의 옵션정보는 주문 원문 그대로', sRow && String(sRow[cO]).slice(-30));
                const logs22 = (v.hits.logs || []).slice(-1)[0];
                ok(logs22 && logs22.lines.some(l => /품목 통째로 변경 1건: /.test(l) && l.includes('(4건)')), '㉒7 정리 기록에 한 줄(「품목 통째로 변경 … (4건)」)', logs22 && logs22.lines.filter(l => /통째/.test(l)).join(' | ').slice(0, 160));
                // 되돌리기 = 묶음 전부
                await v.pg.click('#fo-patches [data-unpatch^="all:"]'); await idle(v.pg); await chatIdle(v.pg); await idle(v.pg);
                const g2 = await grab('s22b');
                ok((await patchN(v.pg)) === 0 && R(g2, '이이가').r[4] === FROM && R(g2, '이이다').r[4] === FROM && R(g2, '이이나').r[4] === FROM + ' 2S사이즈로!' && R(g2, '이이가').file.includes('효돈'), '㉒8 [되돌리기] 한 번 → 4건 전부 옛 이름·옛 거래처로(파일 다시 만듦)', JSON.stringify([await patchN(v.pg), String(R(g2, '이이가').r[4]).slice(-16), R(g2, '이이가').file.slice(0, 20)]));
                ok(v.errs.length === 0, '㉒ 오류 0', v.errs.join(' | ')); await v.ctx.close();
            }

            // ── ㉓ #548 받는 분 번호로 적힌 메모 줄 → 카드 · 메모 칸 줄별 확인 표시 ───────────────────────────
            console.log('\n㉓ #548 받는 분 번호 메모 줄 · 줄별 표시');
            {
                const rows23 = [mk('이삼가', { rtel: '010-8100-1111' }), mk('이삼나', { rtel: '010-8100-2222' }), mk('이삼다', { rtel: '010-8100-2222' }), mk('이삼라', { tel: '010-8200-3333' }), mk('이삼마', { rtel: '010-8300-9999' }), mk('이삼바', { rtel: '010-8400-5555' }), mk('이삼사')];
                const pidOf = nm => rows23.find(r => r['수취인명'] === nm)._pid;
                const laterTxt = `${+later.slice(5, 7)}월 ${+later.slice(8)}일 발송`;
                const memo23 = [`010-8100-1111 ${laterTxt}`, `${FX.usd(ship)}\t010-8100-2222\t입력o삭제x\t네이버`, `010-8200-3333 ${laterTxt}`, `${FX.usd(later)}\t010-1234-9999\t\t네이버`, `010-8400-5555 ${laterTxt}`, 'ㅁㄴㅇㄹ 확인'];
                const w = await mkChat(false, rows23);
                const gut = pg => pg.evaluate(() => { const ta = document.getElementById('fo-memo'), g = document.getElementById('fo-memo-gut'), ms = g ? Array.from(g.querySelectorAll('.m')) : []; const cs = getComputedStyle(ta);
                    return { has: !!g, n: ms.length, lines: ta.value ? ta.value.split('\n').length : 0, t: ms.map(m => (m.textContent || '').trim()), k: ms.map(m => m.className.replace(/^m ?/, '').replace(' cur', '')), h: [...new Set(ms.map(m => Math.round(m.getBoundingClientRect().height)))], lh: cs.lineHeight, ws: cs.whiteSpace, padTop: [cs.paddingTop, getComputedStyle(g).paddingTop],
                        firstTop: ms[0] ? Math.round(ms[0].getBoundingClientRect().top - g.getBoundingClientRect().top) : null, stale: document.querySelector('.fo-ed').classList.contains('stale'), bar: (document.getElementById('fo-memo-bar') || {}).innerText || '', val: ta.value, sel: [ta.selectionStart, ta.selectionEnd], sameH: Math.abs(g.getBoundingClientRect().height - ta.getBoundingClientRect().height) < 2 }; });
                const recvCards = pg => pg.evaluate(sel => Array.from(document.querySelectorAll(sel + '[data-fo-card="line-recv"]')).map(c => ({ title: c.querySelector('b').textContent, text: c.innerText.replace(/\s+/g, ' '), btns: Array.from(c.querySelectorAll('[data-fo-act]')).map(b => b.textContent.trim()) })), SEL.pending);
                const info23 = pg => pg.evaluate(() => Array.from(document.querySelectorAll('#fo-info li')).map(li => li.textContent));
                let g0 = await gut(w.pg);
                ok(g0.has && g0.t.every(x => !x) && g0.bar === '', '㉓1 판정 전에는 표시 칸이 비어 있음(표시 칸은 처음부터 있음)', JSON.stringify(g0.t));
                await w.pg.fill(SEL.memo, memo23.join('\n')); await setCash(w.pg, null); await w.pg.click(SEL.start); await idle(w.pg); await w.pg.waitForTimeout(500);
                g0 = await gut(w.pg); let rc23 = await recvCards(w.pg); let J23 = (await readJudge(w.pg)).judge;
                ok(g0.n === 6 && g0.lines === 6 && g0.k.join() === 'warn,warn,ok,none,warn,warn' && /받는 분 번호/.test(g0.t[0]) && /받는 분 번호/.test(g0.t[1]) && /확인완료 1건/.test(g0.t[2]) && /주문 없음/.test(g0.t[3]) && /받는 분 번호/.test(g0.t[4]) && /형식 확인/.test(g0.t[5]), '㉓2 판정 뒤 줄마다 표시: 받는 분 번호(⚠) ×3 · 확인완료 1건(✓) · 주문 없음(✕) · 형식 확인(⚠)', JSON.stringify(g0.t));
                ok(g0.h.join() === '24' && g0.lh === '24px' && g0.ws === 'pre' && g0.padTop[0] === g0.padTop[1] && g0.firstTop === parseInt(g0.padTop[0]) && g0.sameH && !g0.stale, '㉓2 줄 높이 맞춤: 표시 한 칸 24px = 입력 칸 줄 높이 24px · 위 여백 같음 · 줄바꿈 없음(pre) · 두 칸 높이 같음', JSON.stringify({ h: g0.h, lh: g0.lh, ws: g0.ws, pad: g0.padTop, sameH: g0.sameH }));
                ok(/확인 필요 4줄/.test(g0.bar.replace(/\s+/g, ' ')) && /주문 없음 1줄/.test(g0.bar.replace(/\s+/g, ' ')) && /확인완료 1줄/.test(g0.bar.replace(/\s+/g, ' ')), '㉓2 아래 요약 칩(확인 필요 4 · 주문 없음 1 · 확인완료 1)', g0.bar.replace(/\s+/g, ' ').slice(0, 80));
                const c0 = rc23.find(c => c.title.startsWith('010-8100-1111')), c1 = rc23.find(c => /010-8100-2222/.test(c.title)), c4 = rc23.find(c => c.title.startsWith('010-8400-5555'));
                ok(rc23.length === 3 && c0 && /구매자가 아니라 받는 분 번호/.test(c0.text) && /이삼가/.test(c0.text) && c0.btns.join() === '이 주문에 적용,넘어감' && c1 && /이삼나/.test(c1.text) && /이삼다/.test(c1.text) && c1.btns[0] === '2건 모두 적용' && c4, '㉓3 받는 분 번호 줄 = 카드(그 번호의 주문 목록 · [이 주문에 적용] / [2건 모두 적용] · [넘어감])', JSON.stringify(rc23.map(c => c.btns)));
                ok(!rc23.some(c => /010-8200-3333|010-1234-9999/.test(c.title)) && J23['이삼라'].excluded && !J23['이삼마'].excluded && (await info23(w.pg)).some(t => /^주문 없음: .*010-1234-9999/.test(t)), '㉓3 구매자 번호 줄은 카드 없이 그대로 적용 · 끝 4자리만 같은 번호(…9999)는 후보로 안 띄우고 참고 목록 「주문 없음」', JSON.stringify({ 라: J23['이삼라'].excluded, 마: J23['이삼마'].excluded }));
                ok(!J23['이삼가'].excluded && !J23['이삼나'].individual, '㉓3 적용 전에는 그 주문에 아무것도 안 걸림(오늘 발송 그대로)');
                // [이 주문에 적용] → 뒤 날짜 = 제외
                await w.pg.locator(`${SEL.pending}[data-fo-card="line-recv"]`, { hasText: '010-8100-1111' }).locator('[data-fo-act="apply"]').click(); await idle(w.pg); await w.pg.waitForTimeout(500);
                g0 = await gut(w.pg); J23 = (await readJudge(w.pg)).judge; rc23 = await recvCards(w.pg);
                ok(g0.val.split('\n')[0] === `${pidOf('이삼가')} ${laterTxt}` && !/010-8100-1111/.test(g0.val) && J23['이삼가'].excluded && J23['이삼가'].kind === 'future' && /확인완료 1건/.test(g0.t[0]) && rc23.length === 2, '㉓4 [이 주문에 적용] → 메모 칸의 그 줄 번호가 주문번호로 바뀌고 다시 판정 → 뒤 날짜라 오늘 제외 · 표시 = 확인완료 1건 · 카드 사라짐', JSON.stringify({ line0: g0.val.split('\n')[0].slice(0, 30), ex: J23['이삼가'].excluded, kind: J23['이삼가'].kind }));
                ok((await info23(w.pg)).some(t => /받는 분 번호로 적은 줄을 주문번호로 바꿈: 010-8100-1111 .* → 1건/.test(t)), '㉓4 참고 목록에 「받는 분 번호로 적은 줄을 주문번호로 바꿈」(원래 적은 줄)', (await info23(w.pg)).find(t => /바꿈/.test(t)));
                // [2건 모두 적용] → 입력삭제 2건
                await w.pg.locator(`${SEL.pending}[data-fo-card="line-recv"]`, { hasText: '010-8100-2222' }).locator('[data-fo-act="apply"]').click(); await idle(w.pg); await w.pg.waitForTimeout(500);
                g0 = await gut(w.pg); J23 = (await readJudge(w.pg)).judge; const ls23 = g0.val.split('\n');
                ok(ls23.length === 7 && ls23[1] === `${FX.usd(ship)}\t${pidOf('이삼나')}\t입력o삭제x\t네이버` && ls23[2] === `${FX.usd(ship)}\t${pidOf('이삼다')}\t입력o삭제x\t네이버` && J23['이삼나'].individual && J23['이삼다'].individual && g0.n === 7 && /확인완료 1건/.test(g0.t[1]) && /확인완료 1건/.test(g0.t[2]), '㉓5 [2건 모두 적용] → 같은 날짜·비고로 줄이 2줄이 되고 두 주문 다 입력삭제(개별발송) · 표시 칸도 7줄로', JSON.stringify({ n: ls23.length, 나: J23['이삼나'].individual, 다: J23['이삼다'].individual }));
                // [넘어감]
                await w.pg.locator(`${SEL.pending}[data-fo-card="line-recv"]`, { hasText: '010-8400-5555' }).locator('[data-fo-act="ok"]').click(); await w.pg.waitForTimeout(400);
                g0 = await gut(w.pg); J23 = (await readJudge(w.pg)).judge;
                ok((await recvCards(w.pg)).length === 0 && !J23['이삼바'].excluded && (await info23(w.pg)).some(t => /^주문 없음: 010-8400-5555.*받는 분 번호 — 넘어감/.test(t)) && /주문 없음/.test(g0.t[5]) && /010-8400-5555/.test(g0.val), '㉓6 [넘어감] → 그 주문은 그대로 오늘 발송 · 참고 목록 「주문 없음 … (받는 분 번호 — 넘어감)」 · 메모 줄은 안 바뀜 · 표시 = 주문 없음', JSON.stringify(g0.t));
                // 남은 카드(형식 확인 줄 · 입력삭제 현금 줄 없음 등) 처리 → 파일
                for (let q = 0; q < 12 && (await pendingN(w.pg)) > 0; q++) { const b = w.pg.locator(SEL.pending + ' [data-fo-act]').first(); if (!(await b.count())) break; await b.click(); await w.pg.waitForTimeout(200); }
                ok((await pendingN(w.pg)) === 0, '㉓ 준비: 남은 카드 0', JSON.stringify(await cardCount(w.pg)));
                await w.pg.click(SEL.make); await idle(w.pg); await w.pg.waitForSelector(SEL.save, { timeout: 15000 }); await w.pg.waitForTimeout(300);
                const n23 = await w.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save); const a23 = [];
                for (const nm of n23.filter(x => !x.includes('스마트스토어') && /xlsx$/i.test(x))) { const [dl] = await Promise.all([w.pg.waitForEvent('download', { timeout: 20000 }), w.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 's23-' + Date.now() + '.xlsx'); await dl.saveAs(f); XLSX.utils.sheet_to_json(XLSX.readFile(f).Sheets.Sheet1, { header: 1, defval: '' }).slice(1).forEach(r => a23.push(r[3])); }
                ok(!a23.includes('이삼가') && !a23.includes('이삼나') && !a23.includes('이삼다') && !a23.includes('이삼라') && a23.includes('이삼마') && a23.includes('이삼바') && a23.includes('이삼사'), '㉓7 택배사 파일: 적용한 뒤 날짜 주문·입력삭제 2건·구매자 번호 뒤 날짜 주문은 빠지고, 넘어간 주문·끝자리만 같은 주문은 그대로 나감', JSON.stringify(a23));
                const lg23 = (w.hits.logs || []).slice(-1)[0];
                ok(lg23 && lg23.lines.some(l => /받는 분 번호로 적은 메모 줄을 주문번호로 바꿈 3건/.test(l)) && !lg23.lines.some(l => /8100-1111|8100-2222/.test(l)), '㉓7 정리 기록에는 건수만(번호 없음)', lg23 && lg23.lines.filter(l => /받는 분/.test(l)).join());
                // 표시 칸 누르기 · 입력이 바뀌면 흐리게
                await w.pg.click('#fo-memo-gut .m[data-i="3"]'); g0 = await gut(w.pg); const ls = g0.val.split('\n'), st3 = ls.slice(0, 3).reduce((a, x) => a + x.length + 1, 0);
                ok(g0.sel[0] === st3 && g0.sel[1] === st3 + ls[3].length, '㉓8 표시 칸을 누르면 그 줄이 선택됨', JSON.stringify(g0.sel));
                await w.pg.focus(SEL.memo); await w.pg.keyboard.press('End'); await w.pg.keyboard.type(' '); g0 = await gut(w.pg);
                ok(g0.stale && (await w.pg.evaluate(() => getComputedStyle(document.querySelector('#fo-memo-gut .m span')).opacity)) === '0.35', '㉓8 입력이 바뀌면 표시가 흐려짐(다시 판정 필요)');
                ok(w.errs.length === 0, '㉓ 오류 0', w.errs.join(' | ')); await w.ctx.close();
                // 폰 390px
                const wm = await mkChat(false, rows23, { width: 390, height: 844 }, true);
                await wm.pg.fill(SEL.memo, memo23.join('\n')); await setCash(wm.pg, null); await wm.pg.click(SEL.start); await idle(wm.pg); await wm.pg.waitForTimeout(500);
                const gm = await gut(wm.pg); const mm = await wm.pg.evaluate(() => { const ed = document.querySelector('.fo-ed').getBoundingClientRect(), ta = document.getElementById('fo-memo'); return { over: document.documentElement.scrollWidth > window.innerWidth + 1, edIn: ed.right <= window.innerWidth + 1, taW: Math.round(ta.getBoundingClientRect().width), scrollX: ta.scrollWidth > ta.clientWidth }; });
                ok(!mm.over && mm.edIn && mm.taW >= 150 && gm.h.join() === '24' && gm.n === 6 && gm.k.join() === 'warn,warn,ok,none,warn,warn', '㉓9 390px: 가로 넘침 0 · 긴 줄은 입력 칸 안에서 가로로 밀림(줄바꿈 없음) · 표시 6칸이 줄과 1:1', JSON.stringify(mm));
                ok(wm.errs.length === 0, '㉓9 오류 0(폰)', wm.errs.join(' | ')); await wm.ctx.close();
            }

            // ── ㉔ #548 보충: 현금파일 「오늘은 없음」 잠금 · 메모 줄 「번호 + 사이즈」 · 주문 확인 카드의 배송메세지 칸 ─────────
            console.log('\n㉔ #548 보충(현금파일 잠금 · 번호+사이즈 · 주문 확인 카드 배송메세지)');
            {
                const sizeBase24 = fx.naver.find(r => /사이즈/.test(String(r['배송메세지'] || '')));
                const D24 = cat.byPartner[FX.P_DAESUNG] || [], gold = D24.find(n => /황금향/.test(n)) || D24[0];
                const OM = '다음주쯤 보내주세요 경비실에 맡겨주세요';
                const rows24 = [mk('이사가', { buyer: '사이즈손님', tel: '010-8500-1111' }), mk('이사나', { buyer: '사이즈손님', tel: '010-8500-1111', opt: gold }), mk('이사다', { tel: '010-8500-2222' }), mk('이사라', { tel: '010-8500-3333', opt: gold }),
                    mk('이사마', { base: sizeBase24, memo: 's사이즈로 보내주세요', tel: '010-8500-4444' }), mk('이사바', { rtel: '010-8500-9999' }), mk('이사사'),
                    mk('오가', { memo: OM }), mk('오나', { memo: OM }), mk('오다', { memo: OM })];
                const memo24 = ['010-8500-1111 2s', `${FX.usd(ship)}\t010-8500-2222\t메모무시 M\t네이버`, '010-8500-3333 s', '010-8500-4444 2S 사이즈', '010-8500-9999 2s로'];
                const x = await mkChat(false, rows24);
                x.chat.memoAns = it => (it.memo === OM ? { ship: 'ask', memo: '그대로', sure: false, why: '언제인지 분명하지 않음' } : { memo: '기본', sure: true });
                // ③ 현금파일 ↔ 「오늘은 없음」
                const cs = pg => pg.evaluate(() => { const n = document.getElementById('fo-cash-none'), c = document.getElementById('fo-cash-clear'); return { dis: n.disabled, chk: n.checked, off: n.closest('.fo-check').classList.contains('off'), op: getComputedStyle(n.closest('.fo-check')).opacity, clear: c.getClientRects().length > 0, note: document.getElementById('fo-cash-note').textContent }; });
                let c0 = await cs(x.pg);
                ok(!c0.dis && !c0.clear, '㉔③ 처음에는 「오늘은 없음」을 누를 수 있음 · [파일 빼기] 없음');
                await x.pg.setInputFiles(SEL.cash, cashFile); await x.pg.waitForTimeout(400); c0 = await cs(x.pg);
                ok(c0.dis && c0.off && Number(c0.op) < 0.6 && !c0.chk && c0.clear, '㉔③ 파일을 고르면 「오늘은 없음」이 꺼지고(disabled · 흐림) [파일 빼기]가 보임', JSON.stringify(c0));
                await x.pg.click('#fo-cash-clear'); await x.pg.waitForTimeout(300); c0 = await cs(x.pg);
                ok(!c0.dis && !c0.off && !c0.clear && /없으면 「오늘은 없음」/.test(c0.note), '㉔③ [파일 빼기] → 다시 누를 수 있음', c0.note.slice(0, 40));
                await x.pg.check(SEL.cashNone); await x.pg.waitForTimeout(200); await x.pg.setInputFiles(SEL.cash, cashFile); await x.pg.waitForTimeout(400); c0 = await cs(x.pg);
                ok(!c0.chk && c0.dis && /가짜_현금파일/.test(c0.note), '㉔③ 「없음」을 누른 상태에서 파일을 고르면 「없음」이 풀리고 파일이 우선', JSON.stringify({ chk: c0.chk, dis: c0.dis }));
                await x.pg.click('#fo-cash-clear'); await x.pg.waitForTimeout(200);
                // ④ 번호 + 사이즈
                await x.pg.fill(SEL.memo, memo24.join('\n')); await setCash(x.pg, null); await x.pg.click(SEL.start); await idle(x.pg); await x.pg.waitForTimeout(600);
                const gt = pg => pg.evaluate(() => Array.from(document.querySelectorAll('#fo-memo-gut .m')).map(m => (m.textContent || '').trim()));
                const inf = pg => pg.evaluate(() => Array.from(document.querySelectorAll('#fo-info li')).map(li => li.textContent));
                let g24 = await gt(x.pg), rj = await readJudge(x.pg), i24 = await inf(x.pg);
                ok(rj.v2Text.split('\n').length === 5 && rj.v2Text.split('\n')[0] === '' && /메모무시/.test(rj.v2Text.split('\n')[1]) && !/ M(\t|$)/.test(rj.v2Text.split('\n')[1]) && rj.v2Text.split('\n').slice(2).every(l => l === ''), '㉔④ 숨은 계산 화면에는 사이즈 낱말을 빼고 넘김(사이즈뿐인 줄 = 빈 줄 · 줄 수 그대로)', JSON.stringify(rj.v2Text.split('\n')));
                ok(/사이즈 지정 1건/.test(g24[0]) && /확인완료 1건 · 사이즈/.test(g24[1]) && /귤 주문 없음/.test(g24[2]) && /사이즈 지정 1건/.test(g24[3]) && /받는 분 번호/.test(g24[4]), '㉔④ 줄별 표시: 사이즈 지정 n건 · (날짜도 적은 줄) 확인완료 · 사이즈 · 귤 주문 없음 · 받는 분 번호', JSON.stringify(g24));
                ok(i24.some(t => /사이즈 지정 대상 아님: .*황금향.* 1건/.test(t)) && i24.some(t => /사이즈를 붙일 귤 주문이 없어요: 010-8500-3333/.test(t)), '㉔④ 참고 목록: 「사이즈 지정 대상 아님: 황금향 … 1건」 · 「사이즈를 붙일 귤 주문이 없어요」', i24.filter(t => /사이즈/.test(t)).join(' | ').slice(0, 200));
                const rcv = x.pg.locator(`${SEL.pending}[data-fo-card="line-recv"]`, { hasText: '010-8500-9999' });
                ok((await rcv.count()) === 1 && rj.judge['이사다'].kind === 'today', '㉔④ 번호가 받는 분 번호인 사이즈 줄 = 확인 카드 · 날짜도 적은 줄의 나머지(메모무시)는 종전 규칙대로', String(rj.judge['이사다'].kind));
                await rcv.locator('[data-fo-act="apply"]').click(); await idle(x.pg); await x.pg.waitForTimeout(500); g24 = await gt(x.pg);
                ok(/사이즈 지정 1건/.test(g24[4]), '㉔④ 카드에서 [이 주문에 적용] → 그 줄도 「사이즈 지정 1건」', g24[4]);
                // ⑤ 주문 확인 카드의 배송메세지 칸
                const oc = nm => x.pg.locator(`#fo-cards [data-fo-card="order"]`, { hasText: nm }).first();
                const pre5 = await oc('오가').locator('[data-f="memo"]').inputValue().catch(() => null);
                ok((await x.pg.locator(`${SEL.pending}[data-fo-card="order"]`).count()) === 3 && pre5 === OM, '㉔⑤ 주문 확인 카드에 「택배사 양식에 들어갈 배송메세지」 칸(손님 메모로 미리 채움)', String(pre5));
                await oc('오가').locator('[data-f="memo"]').fill('경비실에 맡겨주세요'); await oc('오가').locator('[data-fo-act="send"]').click(); await x.pg.waitForTimeout(300);
                const done5 = await oc('오가').innerText();
                ok(/오늘 발송/.test(done5) && /배송메세지 「경비실에 맡겨주세요」/.test(done5), '㉔⑤ 글을 고치고 [오늘 발송] → 끝난 카드에 고친 배송메세지가 보임', done5.replace(/\s+/g, ' ').slice(-70));
                await oc('오가').locator('[data-undo]').click(); await x.pg.waitForTimeout(300);
                const re5 = await oc('오가').locator('[data-f="memo"]').inputValue();
                ok(re5 === '경비실에 맡겨주세요', '㉔⑤ [바꾸기]로 다시 열면 앞서 적은 글에서 이어 고침', re5);
                await oc('오가').locator('[data-fo-act="send"]').click(); await x.pg.waitForTimeout(250);
                await oc('오나').locator('[data-fo-act="send"]').click(); await x.pg.waitForTimeout(250);
                await oc('오다').locator('[data-f="memo"]').fill('이건 무시될 글'); await oc('오다').locator('[data-fo-act="excl"]').click(); await x.pg.waitForTimeout(300);
                for (let q = 0; q < 12 && (await pendingN(x.pg)) > 0; q++) { const b = x.pg.locator(SEL.pending + ' [data-fo-act]').first(); if (!(await b.count())) break; await b.click(); await x.pg.waitForTimeout(200); }
                ok((await pendingN(x.pg)) === 0, '㉔ 준비: 남은 카드 0', JSON.stringify(await cardCount(x.pg)));
                await x.pg.click(SEL.make); await idle(x.pg); await x.pg.waitForSelector(SEL.save, { timeout: 15000 }); await x.pg.waitForTimeout(300);
                const n24 = await x.pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save); const a24 = []; let st24 = null;
                for (const nm of n24.filter(v => /xlsx$/i.test(v))) { const [dl] = await Promise.all([x.pg.waitForEvent('download', { timeout: 20000 }), x.pg.locator(`[data-fo-save="${nm}"]`).click()]); const f = path.join(TMP, 's24-' + Date.now() + '.xlsx'); await dl.saveAs(f); const wb = XLSX.readFile(f);
                    if (nm.includes('스마트스토어')) st24 = XLSX.utils.sheet_to_json(wb.Sheets['발주발송관리'], { header: 1, defval: '' }); else if (wb.Sheets.Sheet1) XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' }).slice(1).forEach(r => a24.push(r)); }
                const R24 = nm => a24.find(r => r[3] === nm) || [];
                ok(/ 2S사이즈로!$/.test(R24('이사가')[4]) && R24('이사나')[4] === gold && / M사이즈로!$/.test(R24('이사다')[4]) && R24('이사라')[4] === gold && / 2S사이즈로!$/.test(R24('이사바')[4]) && !/사이즈로!$/.test(R24('이사사')[4]), '㉔④ 택배사 파일: 그 구매자의 귤 주문에만 「2S사이즈로!」 · 같은 구매자의 황금향은 그대로 · 날짜+사이즈 줄 = 「M사이즈로!」 · 받는 분 번호 줄도 적용 뒤 붙음 · 다른 주문 무변경', JSON.stringify(['이사가', '이사나', '이사다', '이사바'].map(n => String(R24(n)[4]).slice(-14))));
                ok(/ 2S사이즈로!$/.test(R24('이사마')[4]) && !/ S사이즈로!/.test(R24('이사마')[4]), '㉔④ 손님 메모로 「S사이즈로!」가 붙어 있던 주문 = 직원 줄(2S)이 이김', String(R24('이사마')[4]).slice(-16));
                ok(R24('오가')[9] === '경비실에 맡겨주세요' && R24('오나')[9] === OM && !a24.some(r => r[3] === '오다'), '㉔⑤ 택배사 파일 J: 고친 주문 = 고친 글 · 안 고친 주문 = 종전대로(손님 메모) · [제외]한 주문은 빠짐(적은 글 무시)', JSON.stringify([R24('오가')[9], R24('오나')[9]]));
                const h24 = st24 ? st24[1] : [], cM24 = h24.indexOf('배송메세지'), cR24 = h24.indexOf('수취인명'), sr24 = (st24 || []).find(r => r[cR24] === '오가');
                ok(cM24 >= 0 && sr24 && sr24[cM24] === OM, '㉔⑤ 스토어 양식의 배송메세지는 손님 원문 그대로', sr24 && sr24[cM24]);
                const lg24 = (x.hits.logs || []).slice(-1)[0];
                ok(lg24 && lg24.lines.some(l => /메모 줄로 사이즈 지정 4건/.test(l)), '㉔④ 정리 기록에 「메모 줄로 사이즈 지정 N건」', lg24 && lg24.lines.filter(l => /사이즈/.test(l)).join());
                ok(x.errs.length === 0, '㉔ 오류 0', x.errs.join(' | ')); await x.ctx.close();
            }

            // 창구가 안 집음(40초)
            let e2; try { e2 = await mkChat(true); } catch (_) { e2 = null; }
            if (e2) {
                await setCash(e2.pg, null); await e2.pg.click(SEL.start); await idle(e2.pg); await e2.pg.waitForTimeout(300);
                e2.chat.mode = 'wait'; e2.chat.status = '대기';
                await e2.pg.fill('#fo-chat-input', '제주 건 있어?'); await e2.pg.click('#fo-chat-send');
                await e2.pg.waitForFunction(() => window.AkmFinalOrder.state.chat.id, null, { timeout: 15000 });
                await e2.ctx.clock.fastForward(46000); await e2.pg.waitForTimeout(800);
                const lbw = await lastBub(e2.pg), be = e2.chat.posts[0];
                ok(/말로 고치기를 쓸 수 없어요/.test(lbw.text) && e2.chat.dels === 1 && be.orders.length === 0 && /제주도 배송/.test(be.summary), '⑯13 40초 안에 창구가 안 집으면 「지금은 말로 고치기를 쓸 수 없어요 — 정리 줄과 카드로 진행하세요」 · 질문만이면 후보 없이 요약만 보냄', lbw.text.slice(0, 70));
                await e2.ctx.close();
            } else note('⑯13 40초 안내 — 브라우저 시계 조작 불가로 미검증');
        }
        }
        code = fail ? 1 : 0;
    } catch (e) { if (e.message !== 'STOP') { console.error('ERR', e.stack || e.message); code = 1; } }
    finally { if (br) await br.close().catch(() => { }); srv.kill(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { } }
    console.log(`\n결과: ${pass}/${pass + fail}${code === 2 ? ' (제품 파일 대기 — ⓪ 가짜 재료 점검까지만 수행)' : ''}`);
    setTimeout(() => process.exit(code), 300);
})();
