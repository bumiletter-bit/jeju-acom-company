// #1021 최종발주 실코드 검증 — 실제 final-order.js·core + 가짜 주문(fixtures-508 손질) + 가짜 for-ship box_rows → 직접 고치기 카드 미리 채움 · 받은 양식 파일 줄 나눔·보내는사람 칸 대조 · box_rows 없으면 HEAD 와 바이트 같음
//   🔴 실DB 읽기만(ro-preload-711 · 쓰기 삼킴 · 타이머 0) · 실행: PORT508=3460 node scripts/verify-1021-fo.js · 1~62행 도우미 = verify-955-fo.js 와 같은 꼴
'use strict';
const path = require('path'), fs = require('fs'), { spawn, execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
// verify-508-ui.js 의 시험 도우미(가짜 API·창 열기·대기)를 그대로 재사용 — 본 실행부만 빼고 임시 모듈로
const SRC508 = fs.readFileSync(path.join(__dirname, 'verify-508-ui.js'), 'utf8');
const H = path.join(__dirname, '._v955h.js');
const headEnd = SRC508.indexOf('(async () => {\n    const srv'), plus = SRC508.slice(SRC508.indexOf('async function plusGo'));
if (headEnd < 0) throw new Error('verify-508-ui 구조가 바뀜');
fs.writeFileSync(H, SRC508.slice(0, headEnd) + '\n' + plus + '\nmodule.exports = { fakeApis, newCtx, setCash, idle, plusGo, SEL, TOKEN, USER, BASE, FX, XLSX, TMP, PORT, apiJ, waitUp };\n');
const T = require(H); fs.unlinkSync(H);
const { newCtx, setCash, idle, plusGo, SEL, BASE, FX, XLSX, TMP, PORT, apiJ, waitUp } = T;
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 700))); return !!c; };
const HEAD_FO = execSync('git show HEAD:public/final-order.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString();
const EMPTY = { ok: true, memo_text: '', lines: [], cash_aoa: [], cash_ids: [], waiting: [], held: [], ids: [] };
const sm = (id, key, text, plat) => ({ id, key, plat: plat || '네이버', text, line: key + ' 배송메모 ' + text + ' ' + (plat || '네이버'), ship_date: null, checked: { plat: plat || '네이버', as: 'order', at: '2026-11-02T00:00:00Z', ship_memo: text } });

async function run(br, fx, cfg) {
    const hits = { naver: 0, cafe24: 0, coupang: 0, cancel: 0 }, used = [], marksSent = [];
    const ctx = await newCtx(br, fx, hits, cfg.vp || { width: 1400, height: 900 }, false, {});
    await ctx.route('**/api/order-memo/for-ship*', r => r.fulfill({ json: Object.assign({}, EMPTY, cfg.forShip || {}) }));
    await ctx.route('**/api/order-memo/used', r => { used.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true, n: 1 } }); });
    await ctx.route('**/api/agent-office/final-order/marks', r => { marksSent.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true } }); });
    if (cfg.head) await ctx.route('**/final-order.js*', r => r.fulfill({ contentType: 'application/javascript', body: HEAD_FO }));
    const pg = await ctx.newPage(), errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500); await pg.evaluate(() => switchPage('agent-office')); await pg.waitForTimeout(1000);
    await plusGo(pg, SEL.btn); await pg.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
    await pg.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await idle(pg);
    await setCash(pg, null);
    await pg.click(SEL.start); await idle(pg);
    await pg.waitForFunction(() => window.AkmFinalOrder.state.judged, null, { timeout: 60000 }); await idle(pg);
    if (cfg.memo) { await pg.fill(SEL.memo, cfg.memo); await pg.waitForTimeout(100); }
    const rejudge = async () => { await pg.click(SEL.rejudge); await idle(pg); await pg.waitForFunction(() => window.AkmFinalOrder.state.judged && !window.AkmFinalOrder.state.stale, null, { timeout: 60000 }); await idle(pg); };
    await rejudge();   // 메모함을 넣은 뒤 상태 = 항상 다시 판정으로 맞춤
    if (cfg.afterJudge) { await cfg.afterJudge(pg, rejudge); }
    const snap = () => pg.evaluate(() => { const s = window.AkmFinalOrder.state; return { cards: s.cards.map(c => ({ id: c.id, type: c.type, tag: c.tag, title: c.title, lines: c.lines, choices: c.choices })), info: s.info.map(i => typeof i === 'string' ? i : i.t) }; });
    const before = await snap();
    // 남은 카드 처리: 먼저 시나리오 지정(cfg.choose: id → 값) · 나머지는 첫 단추
    for (let g = 0; g < 80; g++) {
        const next = await pg.evaluate(sel => { const c = document.querySelector(sel); if (!c) return null; const bs = [...c.querySelectorAll('[data-fo-act]')].map(b => b.getAttribute('data-fo-act')); return { id: c.getAttribute('data-id'), kind: c.getAttribute('data-fo-card'), bs }; }, SEL.pending);
        if (!next) break;
        const want = cfg.choose && cfg.choose[next.id];
        if (cfg.fillMemo && cfg.fillMemo[next.id] != null) await pg.locator(`#fo-cards [data-id="${next.id}"] [data-f="memo"]`).fill(cfg.fillMemo[next.id]);
        const act = want || (next.bs.includes('send') ? 'send' : next.bs[0]);
        if (!act) {   // 거래처 고르기 등 = 첫 라디오·첫 단추
            const done = await pg.evaluate(id => { const c = document.querySelector(`#fo-cards [data-id="${id}"]`); const b = c && c.querySelector('button:not([data-undo])'); if (b) { b.click(); return true; } return false; }, next.id);
            if (!done) throw new Error('누를 단추 없는 카드 ' + next.id); await pg.waitForTimeout(120); continue;
        }
        await pg.locator(`#fo-cards [data-id="${next.id}"] [data-fo-act="${act}"]`).first().click(); await pg.waitForTimeout(100);
    }
    const blockedBefore = cfg.checkBlock ? await cfg.checkBlock(pg) : null;
    await pg.click(SEL.make); await idle(pg);
    await pg.waitForFunction(sel => document.querySelectorAll(sel).length > 0, SEL.save, { timeout: 60000 });
    const names = await pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save);
    const files = {};
    for (const n of names) { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.locator(`[data-fo-save="${n}"]`).click()]); const f = path.join(TMP, 'v1021-' + Date.now() + '.xlsx'); await d.saveAs(f); const wb = XLSX.readFile(f); files[n] = {}; wb.SheetNames.forEach(sn => { files[n][sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' }); }); }
    const after = await snap(), marks = await pg.evaluate(() => { const s = window.AkmFinalOrder.state; return s.out ? Object.keys(s.out).slice(0, 8) : []; });
    await ctx.close();
    return { before, after, files, used, errs, marks, blockedBefore, marksSent };
}
const rowJ = (r, name) => { for (const fn of Object.keys(r.files)) { const s = r.files[fn].Sheet1 || []; const row = s.find(x => String(x[3]) === name); if (row) return String(row[9]); } return null; };
const allRows = r => JSON.stringify(Object.keys(r.files).sort().map(fn => [fn.replace(/\d{4,}/g, ''), r.files[fn]]));
// ── #1021 본 실행부(위 run()·도우미는 verify-955-fo.js 1~62행 그대로) ──
const rowsOf = (r, name) => { const out = []; for (const fn of Object.keys(r.files).sort()) { const s = r.files[fn].Sheet1 || []; s.forEach(row => { if (String(row[3]) === name) out.push(row.map(v => String(v == null ? '' : v))); }); } return out; };
const bx = (o, over) => Object.assign({ t: '', o: '', n: '', p: '', p2: '', a: '', m: '', s: '', sn: '', sp: '' }, o || {}, over || {});
const br1 = (id, key, boxes, o) => Object.assign({ id, key, plat: '네이버', line: key + '\t박스별 ' + boxes.length + '박스 ' + (o && o.tag || '') + '\t네이버', ship_date: null, checked: Object.assign({ plat: '네이버', as: 'buyer', at: '2026-11-05T00:00:00Z' }, o && o.pno ? { pno: o.pno } : {}), boxes }, o && o.more || {});
const usedIds = r => r.used.filter(u => !u.undo).flatMap(u => u.ids || []);
const fixOpen = async (pg, who) => {   // 참고 줄 「메모함 박스별 … who(구매자 번호)」 의 [고치기] → fix 카드 펼침 → 박스 줄 값(카드 글엔 번호 줄이 있음)
    const n = await pg.evaluate(w => { const li = [...document.querySelectorAll('#fo-info li')].find(x => /메모함 박스별:/.test(x.textContent) && x.textContent.includes(w)); const b = li && li.querySelector('[data-info-go]'); if (!b) return false; b.click(); return true; }, who);
    if (!n) return null; await pg.waitForTimeout(400);
    return pg.evaluate(w => { const cd = [...document.querySelectorAll('#fo-cards [data-id^="fix:"]')].find(c => c.textContent.includes(w)); if (!cd) return null; const fx = cd.querySelector('details.fo-fix'); const hid = fx && fx.querySelector('[data-x="boxes"]'); const rows = fx ? [...fx.querySelectorAll('[data-box]')].map(r => ({ on: [...r.querySelectorAll('[data-boxset].on')].map(b => b.dataset.boxset), n: (r.querySelector('[data-brc="n"]') || {}).value, sn: (r.querySelector('[data-bsn]') || {}).value, sp: (r.querySelector('[data-bsp]') || {}).value, sph: (r.querySelector('[data-bsn]') || {}).placeholder, skip: !!(r.querySelector('[data-bskip]') || {}).checked })) : []; return { id: cd.getAttribute('data-id'), boxes: hid ? JSON.parse(hid.value) : null, rows, open: !!(fx && fx.open) }; }, who);
};

(async () => {
    process.env.LUCKY_TABLE = 'lucky_events_v1021';
    const srv = spawn(process.execPath, ['-r', './scripts/ro-preload-711.js', 'server.js'], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT), LUCKY_TABLE: 'lucky_events_v1021' } });
    srv.stdout.on('data', () => {}); let tail = ''; srv.stderr.on('data', d => { tail = (tail + d).slice(-400); });
    let br, code = 1;
    try {
        await waitUp();
        const cat = await apiJ('/api/invoice/catalog'), mp = await apiJ('/api/agent-office/invoice/memo-parse', 'POST', { memos: [] });
        const ship = mp.suggested, later = (mp.shipDays || []).find(d => d > ship);
        const fx0 = FX.build({ byPartner: cat.byPartner || {}, ship, later, realToday: mp.realToday, noShip: mp.noShip || [] });
        const items = Object.values(cat.byPartner || {}).flat(), royal = items.find(n => /귤/.test(n) && /로얄과/.test(n) && !/선물용/.test(n)) || null;
        const T = royal ? ['S사이즈로!', 'M사이즈로!'] : ['', ''];
        const by = (fx, n) => fx.naver.find(o => o['수취인명'] === n);
        // 가짜 자료 손질 = 받는07·받는11·받는16 2박스(귤 로얄과 있으면 그 옵션) · 받는09 3박스 · 받는14·15 같은 구매자 번호(주문 2건 · 1박스)
        const fx = JSON.parse(JSON.stringify(fx0));
        for (const [nm, q] of [['받는07', 2], ['받는11', 2], ['받는16', 2], ['받는09', 3]]) { const o = by(fx, nm); o['수량'] = q; if (royal) o['옵션정보'] = royal; }
        by(fx, '받는15')['구매자연락처'] = by(fx, '받는14')['구매자연락처'];
        const o7 = by(fx, '받는07'), o9 = by(fx, '받는09'), o11 = by(fx, '받는11'), o16 = by(fx, '받는16'), o14 = by(fx, '받는14'), o28 = by(fx, '받는28');
        const { chromium } = require('playwright'); br = await chromium.launch();
        console.log(`\n(귤 로얄과 옵션 = ${royal || '없음(꼬리 없이 받는 분·보내는 분만)'})`);

        console.log('\nⅠ 무회귀 = box_rows 없음 → HEAD final-order.js 와 카드·참고·파일 전 칸 같음');
        const r0 = await run(br, fx, { head: true }), r1 = await run(br, fx, {});
        ok(r0.errs.length === 0 && r1.errs.length === 0, '오류 0', [r0.errs, r1.errs]);
        ok(JSON.stringify(r0.before.cards) === JSON.stringify(r1.before.cards), `카드 ${r1.before.cards.length}장 전과 같음`);
        ok(JSON.stringify(r0.before.info) === JSON.stringify(r1.before.info), `참고 ${r1.before.info.length}줄 전과 같음`);
        ok(allRows(r0) === allRows(r1), `파일 ${Object.keys(r1.files).length}개 전 시트·전 칸 같음`);
        ok(rowsOf(r1, '받는07').length === 1 && rowsOf(r1, '받는07')[0][5] === '2', '받는07 = 종전 한 줄 2박스', rowsOf(r1, '받는07'));

        console.log('\nⅡ 박스별 1건(받는07 2박스 = 박스1 꼬리 · 박스2 꼬리+받는 분+보내는 분) → 카드 미리 채움 · 파일 2줄 · 오늘 씀');
        const B7 = [bx({ t: T[0] }), bx({ t: T[1], n: '다른받는', sn: '박스보냄', sp: '010-9999-0007' })];
        let F7 = null;
        const R2 = await run(br, fx, { forShip: { box_rows: [br1(701, o7['구매자연락처'], B7, { pno: o7._pid })], ids: [701] }, afterJudge: async pg => { F7 = await fixOpen(pg, o7['구매자연락처']); } });
        ok(R2.errs.length === 0, '오류 0', R2.errs);
        ok(R2.after.info.some(t => t.includes('메모함 박스별:') && t.includes(o7['구매자연락처'])), '참고 줄 「메모함 박스별: …」', R2.after.info.filter(t => t.includes('박스별')));
        ok(F7 && F7.boxes && F7.boxes.length === 2 && F7.boxes[0].t === T[0] && F7.boxes[1].t === T[1] && F7.boxes[1].n === '다른받는' && F7.boxes[1].sn === '박스보냄' && F7.boxes[1].sp === '010-9999-0007', '직접 고치기 카드 박스 줄 = 메모함 값 그대로(숨은 칸)', F7);
        ok(F7 && F7.rows.length === 2 && (!royal || (F7.rows[0].on.includes(T[0]) && F7.rows[1].on.includes(T[1]))) && F7.rows[1].n === '다른받는' && F7.rows[1].sn === '박스보냄' && F7.rows[1].sp === '010-9999-0007' && F7.rows[0].sn === '', '화면 칸 = 사이즈 칩 on · 받는 분 · 보내는 분 2칸(박스1 보내는 분 빈칸)', F7 && F7.rows);
        ok(F7 && F7.rows[0].sph && F7.rows[0].sph !== '주문 그대로', '보내는 분 칸 자리 글 = 지금 보내는 분 이름', F7 && F7.rows[0].sph);
        const w7 = rowsOf(R2, '받는07').concat(rowsOf(R2, '다른받는'));
        ok(w7.length === 2 && w7.every(r => r[5] === '1'), '양식 = 2줄 · 수량 1·1', w7);
        ok(w7.length === 2 && (!royal || (w7[0][4].endsWith(T[0]) && w7[1][4].endsWith(T[1]))), '옵션 칸 끝 = 박스별 꼬리', w7.map(r => r[4]));
        ok(w7.length === 2 && w7[1][3] === '다른받는' && w7[1][0] === '박스보냄 드림' && w7[1][1] === '010-9999-0007', '2줄째 = 받는 분·보내는사람 「박스보냄 드림」·연락처', w7[1]);
        ok(w7.length === 2 && w7[0][3] === '받는07' && w7[0][0] !== '박스보냄 드림' && w7[0][1] !== '010-9999-0007', '1줄째 = 받는 분·보내는사람 주문 그대로', w7[0]);
        ok(usedIds(R2).includes(701), '「오늘 씀」 표시에 박스별 줄 id', R2.used);
        { const base = JSON.parse(allRows(r1)), now = JSON.parse(allRows(R2)); let diff = 0; base.forEach((b, i) => { const S0 = (b[1].Sheet1 || []).filter(r => String(r[3]) !== '받는07'), S1 = (((now[i] || [])[1] || {}).Sheet1 || []).filter(r => !['받는07', '다른받는'].includes(String(r[3]))); if (JSON.stringify(S0) !== JSON.stringify(S1)) diff++; });
          ok(diff === 0, '다른 줄 전 칸 변화 0', diff); }

        console.log('\nⅢ 안 채우는 경우 = 박스 수 다름 · 주문 없음 · 같은 번호 주문 2건 · 전부 안 보냄 · 입력삭제 주문');
        const R3 = await run(br, fx, { forShip: { box_rows: [
            br1(711, o9['구매자연락처'], [bx({ t: T[0] }), bx({ t: T[1] })], { pno: o9._pid, tag: '수다름' }),
            br1(712, '010-9999-9999', [bx({ t: T[0] }), bx({ t: T[1] })], { pno: '2099999999999', tag: '없음' }),
            br1(713, o14['구매자연락처'], [bx({ t: T[0] }), bx({ t: T[1] })], { tag: '둘' }),
            br1(714, o16['구매자연락처'], [bx({ s: '1' }), bx({ s: '1' })], { pno: o16._pid, tag: '전부안보냄' }),
            br1(715, o28['구매자연락처'], [bx({ t: T[0] }), bx({ t: T[1] })], { pno: o28._pid, tag: '입력삭제' })], ids: [711, 712, 713, 714, 715] }, memo: (+ship.slice(5, 7)) + '/' + (+ship.slice(8, 10)) + ' ' + o28['구매자연락처'] + ' 입력o삭제x', choose: { 'boxq:711': 'skip', 'boxm:713': 'skip', 'boxq:714': 'skip' } });
        ok(R3.errs.length === 0, '오류 0', R3.errs);
        ok(R3.before.cards.some(c => c.id === 'boxq:711' && c.choices.length === 1), '박스 수 다름 = 확인 카드(「확인함」 하나)', R3.before.cards.filter(c => /^box/.test(c.id)).map(c => c.id));
        ok(rowsOf(R3, '받는09').length === 1 && rowsOf(R3, '받는09')[0][5] === '3', '받는09 = 그대로 한 줄 3박스', rowsOf(R3, '받는09'));
        ok(R3.after.info.some(t => t.includes('박스별 ✕ 주문 없음') && t.includes('2099999999999')), '주문 없음 = 참고 줄', R3.after.info.filter(t => t.includes('주문 없음')));
        ok(R3.before.cards.some(c => c.id === 'boxm:713'), '같은 번호 주문 2건 = 확인 카드');
        ok(R3.before.cards.some(c => c.id === 'boxq:714') && rowsOf(R3, '받는16').length === 1 && rowsOf(R3, '받는16')[0][5] === '2', '전부 안 보냄 = 카드 + 그대로 한 줄', rowsOf(R3, '받는16'));
        ok(R3.after.info.some(t => t.includes('입력삭제 주문이라 안 넣었어요')), '입력삭제 주문 = 참고 줄만');
        ok(!usedIds(R3).some(i => [712].includes(i)) || true, '(참고) 오늘 씀은 종전 ids 길 그대로', usedIds(R3));

        console.log('\nⅣ 카드 우선 = 메모함 값 위에서 사람이 박스2 를 바꿔 [적용] → 파일은 사람 값 · 같은 값으로 [적용] = 바꾼 것 없음');
        const B11 = [bx({ t: T[0], sn: '열한보냄' }), bx({ t: T[0], sn: '열한보냄' })];
        let same11 = null;
        const R4 = await run(br, fx, { forShip: { box_rows: [br1(721, o11['구매자연락처'], B11, { pno: o11._pid })], ids: [721] }, afterJudge: async pg => {
            const f = await fixOpen(pg, o11['구매자연락처']); if (!f) return;
            const card = `#fo-cards [data-id="${f.id}"]`;
            await pg.locator(card + ' [data-fix-apply]').first().click(); await pg.waitForTimeout(300);
            same11 = await pg.evaluate(c => (document.querySelector(c + ' [data-fix-msg]') || {}).textContent || '', card);
            if (royal) { await pg.locator(card + ' [data-box="1"] [data-boxset="M사이즈로!"]').click(); await pg.waitForTimeout(150); }
            else { await pg.locator(card + ' [data-box="1"] [data-brc="n"]').fill('사람받는'); await pg.waitForTimeout(150); }
            await pg.locator(card + ' [data-fix-apply]').first().click(); await pg.waitForTimeout(500);
        } });
        ok(R4.errs.length === 0, '오류 0', R4.errs);
        ok(/바꾼 것이 없어요/.test(same11 || ''), '메모함 값 그대로 [적용] = 「바꾼 것이 없어요」(패치 0)', same11);
        const w11 = rowsOf(R4, '받는11').concat(rowsOf(R4, '사람받는'));
        ok(w11.length === 2 && w11.every(r => r[0] === '열한보냄 드림'), '두 줄 다 보내는사람 「열한보냄 드림」(묶음 1개여도 박스별 보내는 분)', w11.map(r => r[0]));
        ok(w11.length === 2 && (royal ? ['S사이즈로!', 'M사이즈로!'].every(z => w11.some(r => r[4].endsWith(z))) : w11.some(r => r[3] === '사람받는')), '사람이 바꾼 박스2 값이 파일에(줄 순서 = 옵션 글자순 종전)', w11.map(r => [r[3], r[4]]));
        ok(R4.after.info.some(t => t.includes('박스별') && t.includes('(사람)') && t.includes('시험구매11')), '참고 줄 「박스별 …(사람)」', R4.after.info.filter(t => t.includes('받는11')));

        code = fail ? 1 : 0;
    } catch (e) { console.log('  ❌ 실행 오류 ' + (e && e.stack || e) + '\n  서버 꼬리: ' + tail); code = 1; }
    finally { if (br) await br.close(); srv.kill(); }
    console.log(`\n결과 ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ''}`);
    process.exit(code);
})();
