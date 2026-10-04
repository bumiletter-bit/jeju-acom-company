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
    await ctx.route('**/api/agent-office/coupang/canceled-since*', r => { hits.cancel++; r.fulfill({ json: { ok: true, canceled: fx.canceledCoupang } }); });
}
async function newCtx(br, fx, hits, viewport, mobile, mode) {
    const ctx = await br.newContext({ acceptDownloads: true, viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [TOKEN, USER]);
    await fakeApis(ctx, fx, hits, mode);
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
    else if (!(await pg.isChecked(SEL.cashNone))) await pg.check(SEL.cashNone);
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
            const oddOpt = fx.H[0] + ' 15과로!';   // 단가표에 없는 이름(표준 이름 + 손글씨 꼬리)
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
            await a.pg.click(SEL.saveAll); for (let i = 0; i < 40 && got.length < 5; i++) await a.pg.waitForTimeout(250); await a.pg.waitForTimeout(600); a.pg.off('download', onDl);
            ok(got.length === 5 && got.filter(x => /\.xlsx$/.test(x)).length === 3 && got.filter(x => /\.png$/.test(x)).length === 2, '⑦-6 [전부 저장] → 파일 3개 + 수량 이미지 2개', got.join(' | '));
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
        code = fail ? 1 : 0;
    } catch (e) { if (e.message !== 'STOP') { console.error('ERR', e.stack || e.message); code = 1; } }
    finally { if (br) await br.close().catch(() => { }); srv.kill(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { } }
    console.log(`\n결과: ${pass}/${pass + fail}${code === 2 ? ' (제품 파일 대기 — ⓪ 가짜 재료 점검까지만 수행)' : ''}`);
    setTimeout(() => process.exit(code), 300);
})();
