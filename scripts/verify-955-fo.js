// #955·#956 최종발주 실코드 검증 — 실제 final-order.js·core·invoice-v2 + 가짜 주문·가짜 for-ship → 받은 파일을 다시 열어 배송메시지(J칸) 대조
//   🔴 실DB 읽기만(ro-preload-711 · 쓰기 삼킴 · 타이머 0) · 불러오기·표식·기록 API = 가짜 route · 실행: node scripts/verify-955-fo.js (PORT508 · 기본 3458)
//   종전 대조 = git HEAD 의 final-order.js 를 route 로 얹어 같은 자료로 돌림 → 값 없는 줄은 카드·파일 바이트 같아야 함
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
    const hits = { naver: 0, cafe24: 0, coupang: 0, cancel: 0 }, used = [];
    const ctx = await newCtx(br, fx, hits, { width: 1400, height: 900 }, false, {});
    await ctx.route('**/api/order-memo/for-ship*', r => r.fulfill({ json: Object.assign({}, EMPTY, cfg.forShip || {}) }));
    await ctx.route('**/api/order-memo/used', r => { used.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true, n: 1 } }); });
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
    for (const n of names) { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.locator(`[data-fo-save="${n}"]`).click()]); const f = path.join(TMP, 'v955-' + Date.now() + '.xlsx'); await d.saveAs(f); const wb = XLSX.readFile(f); files[n] = {}; wb.SheetNames.forEach(sn => { files[n][sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' }); }); }
    const after = await snap(), marks = await pg.evaluate(() => { const s = window.AkmFinalOrder.state; return s.out ? Object.keys(s.out).slice(0, 8) : []; });
    await ctx.close();
    return { before, after, files, used, errs, marks, blockedBefore };
}
const rowJ = (r, name) => { for (const fn of Object.keys(r.files)) { const s = r.files[fn].Sheet1 || []; const row = s.find(x => String(x[3]) === name); if (row) return String(row[9]); } return null; };
const allRows = r => JSON.stringify(Object.keys(r.files).sort().map(fn => [fn.replace(/\d{4,}/g, ''), r.files[fn]]));

(async () => {
    process.env.LUCKY_TABLE = 'lucky_events_v955';
    const srv = spawn(process.execPath, ['-r', './scripts/ro-preload-711.js', 'server.js'], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT), LUCKY_TABLE: 'lucky_events_v955' } });
    srv.stdout.on('data', () => {}); let tail = ''; srv.stderr.on('data', d => { tail = (tail + d).slice(-400); });
    let br, code = 1;
    try {
        await waitUp();
        const cat = await apiJ('/api/invoice/catalog'), mp = await apiJ('/api/agent-office/invoice/memo-parse', 'POST', { memos: [] });
        const ship = mp.suggested, later = (mp.shipDays || []).find(d => d > ship);
        const fx = FX.build({ byPartner: cat.byPartner || {}, ship, later, realToday: mp.realToday, noShip: mp.noShip || [] });
        const by = n => fx.naver.find(o => o['수취인명'] === n);
        const { chromium } = require('playwright'); br = await chromium.launch();

        console.log('\nⅠ 값 없는 줄 = 전과 바이트 같음(HEAD final-order.js 대조)');
        const r0 = await run(br, fx, { head: true }), r1 = await run(br, fx, {});
        ok(r0.errs.length === 0 && r1.errs.length === 0, '오류 0', [r0.errs, r1.errs]);
        ok(JSON.stringify(r0.before.cards) === JSON.stringify(r1.before.cards), `카드 ${r1.before.cards.length}장 전과 같음`);
        ok(JSON.stringify(r0.before.info) === JSON.stringify(r1.before.info), `참고 ${r1.before.info.length}줄 전과 같음`);
        ok(allRows(r0) === allRows(r1), `파일 ${Object.keys(r1.files).length}개 전 시트·전 칸 같음`);

        console.log('\nⅡ 주문번호 키 · 손님 메모 대신 · 제외·카드 사람 값 우선 · 주문 없음');
        const plain = by('받는01') || by('받는1') || fx.naver.find(o => !o['배송메세지']), withMemo = by('받는05') || fx.naver.find(o => /문앞/.test(o['배송메세지']));
        const excl = fx.naver.find(o => o['수취인명'].endsWith('18')), ordC = fx.naver.find(o => o['수취인명'].endsWith('19')), ordC2 = fx.naver.find(o => o['수취인명'].endsWith('13'));
        const T1 = '1층 문 열립니다. 2층에 꼭 올려주세요', T2 = 'S사이즈로 10일 입력삭제 보내는이 홍길동 낱말이 든 메모', T3 = '제외 주문 메모', T4 = '카드 쪽 메모';
        const R2 = await run(br, fx, { forShip: { ship_memos: [sm(901, plain._pid, T1), sm(902, withMemo._pid, T2), sm(903, excl._pid, T3), sm(904, ordC._pid, T4), sm(905, '2099999999999', '없는 주문')], ids: [901, 902, 903, 904, 905] },
            fillMemo: Object.fromEntries([[`ord:__`, null]]), afterJudge: async pg => {
                const id = await pg.evaluate(k => { const s = window.AkmFinalOrder.state; const c = s.cards.find(x => x.type === 'order' && JSON.stringify(x).includes(k)); return c ? c.id : null; }, ordC['수취인명']);
                if (id) await pg.locator(`#fo-cards [data-id="${id}"] [data-f="memo"]`).fill('사람이 카드에 쓴 글');
            } });
        ok(R2.errs.length === 0, '오류 0', R2.errs);
        ok(rowJ(R2, plain['수취인명']) === T1, `빈 메모 주문 → J칸 「${T1}」`, rowJ(R2, plain['수취인명']));
        ok(rowJ(R2, withMemo['수취인명']) === T2, '손님 메모 있는 주문도 지정 글로 · 글 안 낱말을 규칙으로 안 읽음', rowJ(R2, withMemo['수취인명']));
        ok(R2.after.info.some(t => t.includes('손님 메모') && t.includes(withMemo['배송메세지'])), '참고에 「손님 메모 … 대신」 보임');
        ok(R2.after.info.some(t => t.includes('오늘 안 나감') && t.includes(T3)), '제외 주문 = 참고에 「오늘 안 나감」 · 파일엔 안 나감', R2.after.info.filter(t => t.includes('배송메모')));
        ok(rowJ(R2, excl['수취인명']) === null, '제외 주문 행 없음');
        ok(rowJ(R2, ordC['수취인명']) === '사람이 카드에 쓴 글', '카드에서 사람이 고친 글 우선', rowJ(R2, ordC['수취인명']));
        ok(R2.before.cards.some(c => c.lines.some(l => l[0] === '메모함 배송메모')), '겹친 카드에 「메모함 배송메모」 줄로 보임');
        ok(R2.after.info.some(t => t.includes('주문 없음') && t.includes('2099999999999')), '주문 없는 줄 = 참고에 「주문 없음」');
        { const base = JSON.parse(allRows(r1)), now = JSON.parse(allRows(R2)); let diff = 0; const others = []; base.forEach((b, i) => { const S0 = (b[1].Sheet1 || []), S1 = ((now[i] || [])[1] || {}).Sheet1 || []; S0.forEach((row, j) => { const nm = String(row[3]); if ([plain, withMemo, ordC].some(o => o['수취인명'] === nm)) { row.forEach((v, c) => { if (c !== 9 && String(v) !== String((S1[j] || [])[c])) others.push([nm, c]); }); return; } if (JSON.stringify(row) !== JSON.stringify(S1[j])) diff++; }); });
          ok(diff === 0 && others.length === 0, '다른 줄·수량·품목·받는 분·주소 칸 변화 0', { diff, others: others.slice(0, 5) }); }
        const posted = R2.used.filter(u => !u.undo).flatMap(u => u.ids || []);
        ok([901, 902].every(i => posted.includes(i)), '「오늘 씀」 표시에 배송메모 줄 id 포함', R2.used);
        const fsheet = Object.values(R2.files)[0]; ok(!!fsheet, '파일 있음');

        console.log('\nⅢ 전화번호 키 2건↑ = 묻기 · 같은 주문에 글 둘 = 고르기');
        const a = fx.naver.find(o => o['구매자연락처'] && fx.naver.filter(x => x['구매자연락처'] === o['구매자연락처']).length >= 2 && !/.+/.test(o['배송메세지']));
        const tel = a && a['구매자연락처'], twins = a ? fx.naver.filter(x => x['구매자연락처'] === tel) : [];
        if (ok(!!a, '가짜 자료에 같은 번호 2건↑ 있음')) {
            const idd = 'shipm:911', R3a = await run(br, fx, { forShip: { ship_memos: [sm(911, tel, '둘 다 이 글')], ids: [911] }, choose: { [idd]: 'skip' } });
            ok(R3a.before.cards.some(c => c.id === idd), '묻는 카드 뜸'); ok(!R3a.used.filter(u => !u.undo).flatMap(u => u.ids || []).includes(911), '[안 넣음] = 오늘 씀 안 찍음', R3a.used);
            ok(twins.every(t => rowJ(R3a, t['수취인명']) !== '둘 다 이 글'), '[안 넣음] = 안 들어감');
            const R3b = await run(br, fx, { forShip: { ship_memos: [sm(911, tel, '둘 다 이 글')], ids: [911] }, choose: { [idd]: 'all' } });
            const going = twins.map(t => rowJ(R3b, t['수취인명'])).filter(v => v != null);
            ok(going.length >= 1 && going.every(v => v === '둘 다 이 글'), '[모두] = 나가는 주문 전부', going);
        }
        const R3c = await run(br, fx, { forShip: { ship_memos: [sm(921, plain._pid, '첫 글'), sm(922, plain._pid, '둘째 글')], ids: [921, 922] }, choose: await (async () => ({}))() , afterJudge: null });
        const dupC = R3c.before.cards.find(c => /^shipd:/.test(c.id));
        ok(!!dupC && dupC.choices.length === 3, '같은 주문 글 둘 = 고르기 카드', R3c.before.cards.map(c => c.id).filter(x => /^ship/.test(x)));
        ok(rowJ(R3c, plain['수취인명']) === '첫 글', '첫 단추(1번 글) 고르면 그 글');

        console.log('\nⅢ-b 카드와 겹침: 안 고침 = 배송메모 · 고침 = 카드 글 · AI 닫힘 = 배송메모 · 참고 줄 = 파일 J칸');
        { const SM = '대표가 정한 메모 A', fx2 = JSON.parse(JSON.stringify(fx)), o13 = fx2.naver.find(o => o['수취인명'].endsWith('13')), o21 = fx2.naver.find(o => o['수취인명'].endsWith('21'));
          o13['배송메세지'] = '보내는이 홍길동으로 해주세요 1층 문앞';
          const base = { forShip: { ship_memos: [sm(941, o13._pid, SM), sm(942, o21._pid, SM)], ids: [941, 942] } }, mine = c => /^(memo|samb):/.test(String(c.id));
          const cardFor = (r, o) => r.before.cards.find(c => mine(c) && JSON.stringify(c).includes(o['수취인명'])), infoOf = (r, o) => r.after.info.find(x => x.includes('메모함 배송메모') && x.includes(o['구매자명']));
          const useAll = async pg => { for (let g = 0; g < 8; g++) { const b = pg.locator('#fo-cards [data-fo-card]:not([data-fo-done])[data-id^="memo:"] [data-fo-act="use"], #fo-cards [data-fo-card]:not([data-fo-done])[data-id^="samb:"] [data-fo-act="use"]').first(); if (!(await b.count())) break; await b.click(); await pg.waitForTimeout(120); } };
          const A = await run(br, fx2, Object.assign({}, base, { afterJudge: async pg => { await useAll(pg); } }));
          const c13 = cardFor(A, o13), c21 = cardFor(A, o21);
          ok(!!c13 && !!c21, 'memo-edit·보내는이 카드가 뜸', A.before.cards.map(c => c.id).slice(0, 12));
          ok(rowJ(A, o13['수취인명']) === SM, 'memo-edit 안 고치고 [이대로 넣기] = 배송메모', rowJ(A, o13['수취인명']));
          ok(rowJ(A, o21['수취인명']) === SM, 'sender-order 안 고치고 [이대로 넣기] = 배송메모', rowJ(A, o21['수취인명']));
          ok(infoOf(A, o13) && infoOf(A, o13).includes('✓') && infoOf(A, o13).includes(SM), '참고 줄 = 파일 값', infoOf(A, o13));
          ok(A.used.filter(u => !u.undo).flatMap(u => u.ids || []).includes(941), '들어간 줄 = 오늘 씀', A.used);
          const E = '사람이 카드에서 고친 글';
          const B = await run(br, fx2, Object.assign({}, base, { afterJudge: async pg => { for (const pre of ['memo:', 'samb:']) { const f = pg.locator('#fo-cards [data-id^="' + pre + '"] [data-f="memo"]').first(); if (await f.count()) await f.fill(E); } await useAll(pg); } }));
          ok(rowJ(B, o13['수취인명']) === E, 'memo-edit 고침 = 카드 글', rowJ(B, o13['수취인명']));
          ok(rowJ(B, o21['수취인명']) === E, 'sender-order 고침 = 카드 글', rowJ(B, o21['수취인명']));
          ok(infoOf(B, o13) && infoOf(B, o13).includes('카드에서 고친 글') && infoOf(B, o13).includes(E), '참고 줄 = 카드 글이 나간다고', infoOf(B, o13));
          ok(!B.used.filter(u => !u.undo).flatMap(u => u.ids || []).includes(941), '카드 글이 이긴 줄 = 오늘 씀 안 찍음', B.used);
          const C = await run(br, fx2, Object.assign({}, base, { afterJudge: async pg => { await pg.evaluate(() => { const s = window.AkmFinalOrder.state; s.cards.filter(c => /^memo:/.test(c.id)).forEach(c => { s.ai.tag.set(c.id, 'AI'); s.dec.set(c.id, { use: true, memo: 'AI가 닫은 글' }); const el = document.querySelector('#fo-cards [data-id="' + c.id + '"]'); if (el) el.setAttribute('data-fo-done', '1'); }); }); } }));
          ok(rowJ(C, o13['수취인명']) === SM, 'AI 자동 닫힘 = 배송메모', rowJ(C, o13['수취인명']));
          const D = await run(br, fx2, Object.assign({}, base, { forShip: { ship_memos: [sm(951, o13._pid, o13['배송메세지'])], ids: [951] }, memo: fx2.ship ? '' : '' , afterJudge: async pg => { await useAll(pg); } }));
          ok(rowJ(D, o13['수취인명']) === o13['배송메세지'], '배송메모 = 손님 메모 글자 같음 = 그 글', rowJ(D, o13['수취인명']));
          const shipMd = (+ship.slice(5, 7)) + '/' + (+ship.slice(8, 10));
          const F = await run(br, fx, { forShip: { ship_memos: [sm(961, withMemo._pid, withMemo['배송메세지'])], ids: [961] }, memo: shipMd + ' ' + withMemo['구매자연락처'] + ' 발송' });
          ok(rowJ(F, withMemo['수취인명']) === withMemo['배송메세지'], '🔴 오늘 날짜 줄(clearMemo)로 비운 칸도 채움 · 글자 같아도', rowJ(F, withMemo['수취인명']));
        }
        ok(!R2.used.filter(u => !u.undo).flatMap(u => u.ids || []).some(i => [903, 905].includes(i)), '오늘 안 나감·주문 없음 = 오늘 씀 안 찍음', R2.used);

        console.log('\nⅣ 빼기 = 안 나감');
        const R4 = await run(br, fx, { forShip: { ship_memos: [sm(931, plain._pid, '뺄 글')], ids: [931] }, afterJudge: async (pg, rj) => { await pg.click('[data-om="take"]'); await pg.waitForTimeout(300); await rj(); } });
        ok(rowJ(R4, plain['수취인명']) !== '뺄 글', '[빼기] 뒤 양식에 안 들어감', rowJ(R4, plain['수취인명']));

        console.log('\nⅤ #956 보내는이 줄: 받는 분 번호 / 진짜 주문 없음');
        const rcv = plain['수취인연락처1'], noTel = '010-9000-9000';
        const memo956 = `${rcv} 보내는이 김가족\n${noTel} 보내는이 박없음`;
        const R5h = await run(br, fx, { head: true, memo: memo956 }), R5 = await run(br, fx, { memo: memo956 });
        const cR = R5.before.cards.find(c => String(c.id).startsWith('snohit:') && c.title.includes(rcv)), cN = R5.before.cards.find(c => String(c.id).startsWith('snohit:') && c.title.includes(noTel));
        const hR = R5h.before.cards.find(c => c.id === (cR || {}).id), hN = R5h.before.cards.find(c => c.id === (cN || {}).id);
        ok(!!cR && cR.lines[0][1] === '이 번호는 구매자가 아니라 받는 분 번호예요. 보내는이는 구매자 번호(또는 주문번호)로 찾아서 지금은 어느 주문에도 안 붙었어요.', '받는 분 번호 = 새 이유 글', cR);
        ok(!!cR && cR.lines.some(l => String(l[1]).includes(plain['옵션정보'].slice(0, 10)) || String(l[0]).startsWith('주문')) && cR.lines.some(l => String(l[0]).startsWith('구매자 번호') && /\d{3}-\d{3,4}-\d{4}/.test(l[1])), '주문 줄·구매자 번호 표시', cR && cR.lines);
        ok(!!cR && !!hR && cR.id === hR.id && JSON.stringify(cR.choices) === JSON.stringify(hR.choices), '카드 id·[확인함] 그대로');
        ok(JSON.stringify(R5.before.cards.map(c => c.id)) === JSON.stringify(R5h.before.cards.map(c => c.id)), '카드 건수·순서 그대로');
        ok(!!cN && JSON.stringify(cN) === JSON.stringify(hN), '진짜 주문 없음 = 전과 바이트 같음', [cN, hN]);
        ok(allRows(R5) === allRows(R5h), '파일 전 칸 같음(안내만)');
        code = fail ? 1 : 0;
    } catch (e) { fail++; console.log('  ❌ 멈춤:', e.message, e.stack ? e.stack.split('\n').slice(1, 3).join(' ') : ''); console.log('서버 끝글', tail); }
    finally { try { if (br) await br.close(); } catch (_) {} srv.kill(); }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(code);
})();
