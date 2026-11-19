// #1197-C 검증 — 네이버 직영몰(두 번째 네이버 스토어 · 주문 행 _store:'biz') 표시 · 시트 가르기 · 정산예정 따로
//   실제 final-order.js·invoice-v2.js + 가짜 주문(fixtures-508) · 분기 = 스마트스토어만(HEAD 대조) / 직영몰 1건 섞임(PC·폰 390 tap·폄 884) / 직영몰만 / 네이버 0건(HEAD 대조)
//   🔴 실DB 읽기만(ro-preload-711 · 쓰기 삼킴 · 타이머 0 · 단가표·달력만 읽음) · 주문 3채널·메모함 = 전부 가짜(page.route) · 서버는 HEAD 판 server.js 를 임시 파일로 떠서 띄움(다른 워커가 고치는 작업본과 무관)
//   실행: PORT508=3462 node scripts/verify-1197-fo.js · run() 도우미 = verify-1021-fo.js 와 같은 꼴
'use strict';
const path = require('path'), fs = require('fs'), { spawn, execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC508 = fs.readFileSync(path.join(__dirname, 'verify-508-ui.js'), 'utf8');
const H = path.join(__dirname, '._v1197h.js');
const headEnd = SRC508.indexOf('(async () => {\n    const srv'), plus = SRC508.slice(SRC508.indexOf('async function plusGo'));
if (headEnd < 0) throw new Error('verify-508-ui 구조가 바뀜');
fs.writeFileSync(H, SRC508.slice(0, headEnd) + '\n' + plus + '\nmodule.exports = { fakeApis, newCtx, setCash, idle, plusGo, SEL, TOKEN, USER, BASE, FX, XLSX, TMP, PORT, apiJ, waitUp };\n');
const T = require(H); fs.unlinkSync(H);
const { newCtx, setCash, idle, plusGo, SEL, BASE, FX, XLSX, TMP, PORT, apiJ, waitUp } = T;
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 900))); return !!c; };
const show = (f, enc) => execSync('git show HEAD:' + f, { cwd: ROOT, maxBuffer: 64 << 20 }).toString(enc || 'utf8');
const HEAD_FO = show('public/final-order.js'), HEAD_V2 = show('public/invoice-v2.js');
const EMPTY = { ok: true, memo_text: '', lines: [], cash_aoa: [], cash_ids: [], waiting: [], held: [], ids: [] };
const BIZ = '네이버 직영몰';

async function run(br, fx, cfg) {
    const hits = { naver: 0, cafe24: 0, coupang: 0, cancel: 0 }, vp = cfg.vp || { width: 1400, height: 900 };
    const ctx = await newCtx(br, fx, hits, vp, !!cfg.mobile, {});
    await ctx.route('**/api/order-memo/for-ship*', r => r.fulfill({ json: EMPTY }));
    await ctx.route('**/api/order-memo/used', r => r.fulfill({ json: { ok: true, n: 1 } }));
    await ctx.route('**/api/agent-office/final-order/marks', r => r.fulfill({ json: { ok: true } }));
    if (cfg.head) { await ctx.route('**/final-order.js*', r => r.fulfill({ contentType: 'application/javascript', body: HEAD_FO })); await ctx.route('**/invoice-v2.js*', r => r.fulfill({ contentType: 'application/javascript', body: HEAD_V2 })); }
    const pg = await ctx.newPage(), errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500); await pg.evaluate(() => switchPage('agent-office')); await pg.waitForTimeout(1000);
    await plusGo(pg, SEL.btn); await pg.waitForSelector(SEL.panel, { state: 'visible', timeout: 10000 });
    await pg.waitForFunction(sel => /^\d{4}-\d{2}-\d{2}$/.test(document.querySelector(sel.ship).value), SEL, { timeout: 40000 }); await idle(pg);
    await setCash(pg, null);
    await pg.click(SEL.start); await idle(pg);
    await pg.waitForFunction(() => window.AkmFinalOrder.state.judged, null, { timeout: 60000 }); await idle(pg);
    await pg.click(SEL.rejudge); await idle(pg); await pg.waitForFunction(() => window.AkmFinalOrder.state.judged && !window.AkmFinalOrder.state.stale, null, { timeout: 60000 }); await idle(pg);
    const snap = () => pg.evaluate(() => { const s = window.AkmFinalOrder.state; return { cards: s.cards.map(c => ({ id: c.id, type: c.type, tag: c.tag, title: c.title, lines: c.lines, choices: c.choices })), info: s.info.map(i => typeof i === 'string' ? i : i.t) }; });
    const before = await snap();
    // 송장변환 v2(숨은 iframe)의 판매처 칸 · 불러온 글 · 최종발주 진행 줄
    const v2 = await pg.evaluate(() => { for (const f of document.querySelectorAll('iframe')) { let d = null; try { d = f.contentDocument; } catch (e) { /* 다른 출처 */ } if (d && d.getElementById('msg-naver')) return { ch: [...d.querySelectorAll('td.ch')].map(t => t.textContent.trim()), msg: d.getElementById('msg-naver').textContent.trim(), pills: [...d.querySelectorAll('#res-all .pill')].map(t => t.textContent.trim()) }; } return null; });
    const prog = await pg.evaluate(() => [...document.querySelectorAll('#fo-progress li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()));
    const cardText = await pg.evaluate(() => (document.getElementById('fo-cards') || document.body).textContent);
    for (let g = 0; g < 80; g++) {
        const next = await pg.evaluate(sel => { const c = document.querySelector(sel); if (!c) return null; const bs = [...c.querySelectorAll('[data-fo-act]')].map(b => b.getAttribute('data-fo-act')); return { id: c.getAttribute('data-id'), bs }; }, SEL.pending);
        if (!next) break;
        const act = next.bs.includes('send') ? 'send' : next.bs[0];
        if (!act) { const done = await pg.evaluate(id => { const c = document.querySelector(`#fo-cards [data-id="${id}"]`); const b = c && c.querySelector('button:not([data-undo])'); if (b) { b.click(); return true; } return false; }, next.id); if (!done) throw new Error('누를 단추 없는 카드 ' + next.id); await pg.waitForTimeout(120); continue; }
        await pg.locator(`#fo-cards [data-id="${next.id}"] [data-fo-act="${act}"]`).first().click(); await pg.waitForTimeout(100);
    }
    await pg.click(SEL.make); await idle(pg);
    await pg.waitForFunction(sel => document.querySelectorAll(sel).length > 0, SEL.save, { timeout: 60000 }); await pg.waitForTimeout(900);
    const res = await pg.evaluate(() => { const el = document.getElementById('fo-result'), tx = id => { const e = document.getElementById(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
        const R = e => e.getBoundingClientRect(), over = [...el.querySelectorAll('*')].filter(e => R(e).width > 0 && R(e).right > innerWidth + 0.5 && !e.closest('.fo-qimg, .fo-qtable, table')).length;
        return { html: el.innerHTML, settle: tx('fo-settle-result'), biz: tx('fo-settle-biz'), stores: [...el.querySelectorAll('.fo-file.store')].map(a => ({ h: a.querySelector('h4').textContent, p: a.querySelector('header p').textContent, b: a.querySelector('[data-fo-save]').textContent, bh: Math.round(R(a.querySelector('[data-fo-save]')).height), name: a.querySelector('[data-fo-save]').getAttribute('data-fo-save') })),
            over, sw: document.documentElement.scrollWidth, iw: innerWidth, all: (document.getElementById('fo-save-all') || {}).textContent }; });
    const shot = cfg.shot ? await pg.locator('#fo-result').screenshot({ animations: 'disabled' }) : null;
    const names = await pg.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute('data-fo-save')), SEL.save);
    const files = {};
    for (const n of names) { const b = pg.locator(`[data-fo-save="${n}"]`); if (cfg.mobile) await b.scrollIntoViewIfNeeded();
        const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), cfg.mobile ? b.tap() : b.click()]); const f = path.join(TMP, 'v1197-' + Date.now() + '.xlsx'); await d.saveAs(f); const wb = XLSX.readFile(f); files[n] = {}; wb.SheetNames.forEach(sn => { files[n][sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' }); }); fs.unlinkSync(f); }
    await ctx.close();
    return { before, files, errs, v2, prog, cardText, res, shot, names };
}
const noDate = s => String(s).replace(/\d{4,}/g, '');
const allRows = r => JSON.stringify(Object.keys(r.files).sort().map(fn => [noDate(fn), r.files[fn]]));
const partnerRows = r => JSON.stringify(Object.keys(r.files).sort().filter(fn => !/발주발송관리/.test(fn)).map(fn => [noDate(fn), r.files[fn]]));
const storeOf = (r, biz) => { const fn = Object.keys(r.files).find(n => /발주발송관리/.test(n) && /직영몰/.test(n) === !!biz); return fn ? { fn, rows: (r.files[fn]['발주발송관리'] || []), sheets: Object.keys(r.files[fn]) } : null; };
const won = t => { const m = /([\d,]+)원 · (\d+)건/.exec(t || ''); return m ? { sum: Number(m[1].replace(/,/g, '')), n: Number(m[2]) } : null; };
const cnt = (s, w) => String(s).split(w).length - 1;

(async () => {
    process.env.LUCKY_TABLE = 'lucky_events_v1197';
    const SRV = path.join(ROOT, '._srv1197.js'); fs.writeFileSync(SRV, show('server.js'));
    const srv = spawn(process.execPath, ['-r', './scripts/ro-preload-711.js', '._srv1197.js'], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT), LUCKY_TABLE: 'lucky_events_v1197' } });
    srv.stdout.on('data', () => {}); let tail = ''; srv.stderr.on('data', d => { tail = (tail + d).slice(-400); });
    let br, code = 1;
    try {
        await waitUp();
        const cat = await apiJ('/api/invoice/catalog'), mp = await apiJ('/api/agent-office/invoice/memo-parse', 'POST', { memos: [] });
        const ship = mp.suggested, later = (mp.shipDays || []).find(d => d > ship);
        const fx = FX.build({ byPartner: cat.byPartner || {}, ship, later, realToday: mp.realToday, noShip: mp.noShip || [] });
        const { chromium } = require('playwright'); br = await chromium.launch();
        const clone = () => JSON.parse(JSON.stringify(fx));

        console.log(`\nⅠ 스마트스토어만(직영몰 행 0 · 네이버 ${fx.naver.length}건) = HEAD(final-order.js·invoice-v2.js) 와 같음`);
        const a0 = await run(br, fx, { head: true, shot: true }), a1 = await run(br, fx, { shot: true });
        ok(a0.errs.length === 0 && a1.errs.length === 0, '오류 0', [a0.errs, a1.errs]);
        ok(JSON.stringify(a0.before) === JSON.stringify(a1.before), `카드 ${a1.before.cards.length}장 · 참고 ${a1.before.info.length}줄 전과 같음`);
        ok(allRows(a0) === allRows(a1) && JSON.stringify(a0.names.map(noDate)) === JSON.stringify(a1.names.map(noDate)), `엑셀 파일 ${a1.names.length}개 = 이름·시트·전 칸 같음`, [a0.names, a1.names]);
        ok(a0.res.html === a1.res.html, '결과 칸 HTML 한 글자까지 같음');
        ok(a0.shot.equals(a1.shot), '결과 칸 픽셀 같음(1400 폭)');
        ok(JSON.stringify(a0.v2) === JSON.stringify(a1.v2) && JSON.stringify(a0.prog) === JSON.stringify(a1.prog), '송장변환 v2 판매처 칸·불러온 글 · 진행 줄 같음', [a0.prog, a1.prog]);
        ok(cnt(a1.res.html + a1.cardText + JSON.stringify(a1.v2) + a1.prog.join(), '직영몰') === 0 && a1.res.biz === null, '「직영몰」 글 0 · 직영몰 정산예정 줄 없음');
        const A = { store: storeOf(a1), settle: won(a1.res.settle) };
        ok(A.store && A.settle && A.settle.n === A.store.rows.length - 2, `(기준) 스토어 양식 ${A.store ? A.store.rows.length - 2 : '?'}행 · 정산예정 「${a1.res.settle}」`, a1.res.settle);

        // 직영몰로 바꿀 줄 = 스토어 양식에 실제로 나가는 주문 가운데, 카드 글에 구매자 이름이 나오는 주문(있으면) · 없으면 첫 줄
        const outPids = new Set(A.store.rows.slice(2).map(r => String(r[0])));
        const cands = fx.naver.map((o, i) => ({ o, i })).filter(x => outPids.has(String(x.o._pid)));
        const pick = cands.find(x => a1.cardText.includes(x.o['구매자명'])) || cands[0];
        const pid = String(pick.o._pid), amt = Number((pick.o._x || {}).expectedSettlementAmount) || 0;
        console.log(`\nⅡ 직영몰 1건 섞임(주문 …${pid.slice(-4)} · 정산예정 ${amt}원 · 카드에 나오는 주문 = ${a1.cardText.includes(pick.o['구매자명'])})`);
        const fxB = clone(); fxB.naver[pick.i]._store = 'biz';
        const b = await run(br, fxB, { shot: true });
        ok(b.errs.length === 0, '오류 0', b.errs);
        const bS = storeOf(b), bB = storeOf(b, true);
        ok(partnerRows(b) === partnerRows(a1), '택배사 양식(거래처 파일 Sheet1·수량) 전 칸 = 스마트스토어만일 때와 같음(직영몰 건도 같이 나감)');
        ok(bS && bS.rows.length === A.store.rows.length - 1 && !bS.rows.some(r => String(r[0]) === pid), `스마트스토어 양식 = ${A.store.rows.length - 2} → ${bS ? bS.rows.length - 2 : '?'}행(직영몰 주문 빠짐)`);
        ok(bB && bB.rows.length === 3 && String(bB.rows[2][0]) === pid && JSON.stringify(bB.rows.slice(0, 2)) === JSON.stringify(A.store.rows.slice(0, 2)) && JSON.stringify(bB.rows[2]) === JSON.stringify(A.store.rows.find(r => String(r[0]) === pid)), '직영몰 양식 파일 = 안내·머리 2행 같은 꼴 + 그 주문 1행(칸 값 = 종전 스토어 양식의 그 줄과 같음)', bB && bB.rows.length);
        ok(bB && /^네이버 직영몰 발주발송관리 /.test(bB.fn) && bS && /^스마트스토어 발주발송관리 /.test(bS.fn), '파일 이름 = 「네이버 직영몰 발주발송관리 …」 따로', b.names);
        const sS = won(b.res.settle), sB = won(b.res.biz);
        ok(sS && sB && sS.sum === A.settle.sum - amt && sS.n === A.settle.n - 1 && sB.sum === amt && sB.n === 1, `정산예정 = 스토어 「${b.res.settle}」 + 따로 「${b.res.biz}」(합 = 종전 ${A.settle.sum})`, [A.settle, sS, sB]);
        ok(b.res.stores.length === 2 && b.res.stores[0].h === '스마트스토어' && b.res.stores[1].h === BIZ && /^1행/.test(b.res.stores[1].p) && b.res.stores[1].b === '직영몰 양식 저장', '파일 카드 = 「스마트스토어 n행」 + 「네이버 직영몰 1행」[직영몰 양식 저장]', b.res.stores);
        ok(b.prog.some(t => /네이버/.test(t) && t.includes(`${fx.naver.length}건(직영몰 1건)`)) && a1.prog.some(t => /네이버/.test(t) && !/직영몰/.test(t)), '진행 줄 네이버 = 「n건(직영몰 1건)」(줄 수 3 그대로)', b.prog);
        ok(b.prog.length === a1.prog.length, `진행 줄 ${b.prog.length}줄 그대로`);
        ok(b.v2 && b.v2.ch.filter(t => t === '🛒 네이버 직영몰').length >= 1 && /직영몰 1건 포함/.test(b.v2.msg) && b.v2.ch.filter(t => t === '🛒 네이버').length === a1.v2.ch.filter(t => t === '🛒 네이버').length - b.v2.ch.filter(t => t === '🛒 네이버 직영몰').length, '송장변환 v2 = 그 주문 판매처 칸 「🛒 네이버 직영몰」 · 불러온 글 「(직영몰 1건 포함)」 · 나머지 「🛒 네이버」 그대로', b.v2 && [b.v2.msg, b.v2.ch.filter(t => /직영몰/.test(t)).length]);
        if (a1.cardText.includes(pick.o['구매자명'])) ok(b.cardText.includes(BIZ + ' · ' + pick.o['구매자명']) && cnt(b.cardText, BIZ) >= 1, '확인 카드 글 = 「네이버 직영몰 · 구매자 · …」', cnt(b.cardText, BIZ));
        else console.log('  (참고) 이 가짜 자료에서는 그 주문이 확인 카드에 안 나와 카드 글 확인은 건너뜀');
        ok(JSON.stringify(b.before.cards.map(c => [c.id, c.type])) === JSON.stringify(a1.before.cards.map(c => [c.id, c.type])), `카드 ${b.before.cards.length}장 종류·순서 = 스마트스토어만일 때와 같음(판정 무변)`);

        console.log('\nⅢ 직영몰 1건 섞임 — 폰 390(터치 tap) · 폄 884(터치 tap)');
        for (const [w, h] of [[390, 844], [884, 1104]]) {
            const m = await run(br, fxB, { vp: { width: w, height: h }, mobile: true });
            ok(m.errs.length === 0, `폭 ${w} 오류 0`, m.errs);
            ok(m.res.sw <= m.res.iw && m.res.over === 0, `폭 ${w} 가로 넘침 0(문서 폭 ${m.res.sw} ≤ ${m.res.iw} · 결과 칸 밖으로 나간 것 ${m.res.over})`, m.res);
            ok(m.res.stores.length === 2 && m.res.stores[1].h === BIZ && m.res.stores[1].bh >= 44, `폭 ${w} [직영몰 양식 저장] 누름 높이 ${m.res.stores[1] && m.res.stores[1].bh} ≥ 44`, m.res.stores);
            const mb = storeOf(m, true); ok(mb && mb.rows.length === 3 && String(mb.rows[2][0]) === pid, `폭 ${w} [직영몰 양식 저장] 을 tap = 파일 내려받음(1행)`, m.names);
            ok(won(m.res.biz) && won(m.res.biz).sum === amt, `폭 ${w} 「직영몰 정산예정」 줄 보임(${m.res.biz})`);
        }

        console.log('\nⅣ 직영몰만(네이버 행 전부 직영몰)');
        const fxC = clone(); fxC.naver.forEach(o => { o._store = 'biz'; });
        const c = await run(br, fxC, {});
        ok(c.errs.length === 0, '오류 0', c.errs);
        const cS = storeOf(c), cB = storeOf(c, true);
        ok(partnerRows(c) === partnerRows(a1), '택배사 양식 전 칸 = 스마트스토어만일 때와 같음');
        ok(cS && cS.rows.length <= 2 && cB && JSON.stringify(cB.rows) === JSON.stringify(A.store.rows), `스마트스토어 양식 0행 · 직영몰 양식 = 종전 스토어 양식과 전 칸 같음(${cB ? cB.rows.length - 2 : '?'}행)`, [cS && cS.rows.length, cB && cB.rows.length]);
        ok(won(c.res.biz) && won(c.res.biz).sum === A.settle.sum && won(c.res.biz).n === A.settle.n && won(c.res.settle) && won(c.res.settle).sum === 0, `정산예정 = 스토어 「${c.res.settle}」 · 직영몰 「${c.res.biz}」`, [c.res.settle, c.res.biz]);
        ok(c.v2 && c.v2.ch.filter(t => t === '🛒 네이버').length === 0 && c.v2.ch.filter(t => t === '🛒 네이버 직영몰').length === a1.v2.ch.filter(t => t === '🛒 네이버').length, 'v2 판매처 칸 = 네이버 줄 전부 「🛒 네이버 직영몰」', c.v2 && c.v2.ch.length);

        console.log('\nⅤ 네이버 0건(직영몰도 0) = HEAD 와 같음');
        const fxD = clone(); fxD.naver = [];
        const d0 = await run(br, fxD, { head: true, shot: true }), d1 = await run(br, fxD, { shot: true });
        ok(d0.errs.length === 0 && d1.errs.length === 0, '오류 0', [d0.errs, d1.errs]);
        ok(JSON.stringify(d0.before) === JSON.stringify(d1.before) && allRows(d0) === allRows(d1) && d0.res.html === d1.res.html && d0.shot.equals(d1.shot), `카드·참고·파일 ${d1.names.length}개 전 칸·결과 칸 HTML·픽셀 같음`, [d0.names, d1.names]);
        ok(JSON.stringify(d0.prog) === JSON.stringify(d1.prog) && JSON.stringify(d0.v2) === JSON.stringify(d1.v2), '진행 줄·v2 글 같음', [d0.prog, d1.prog]);

        code = fail ? 1 : 0;
    } catch (e) { console.log('  ❌ 실행 오류 ' + (e && e.stack || e) + '\n  서버 꼬리: ' + tail); code = 1; }
    finally { if (br) await br.close(); srv.kill(); try { fs.unlinkSync(SRV); } catch (e) { /* 이미 없음 */ } }
    console.log(`\n#1197-C 결과 ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ''}`);
    process.exit(code);
})();
