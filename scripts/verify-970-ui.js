// #970 메모함 입력삭제 줄 「일반발송」 실클릭 + 서버 실제 경로 — 실제 order-memo.js(라우트·SQL) + pglite(메모리 DB) + 실제 ao-ordermemo.js·css + 앱 공통 CSS · 실DB·실서버 0
//   3/4 → 주문 체크 → [고친 대로 저장] → 3/3 · 저장 안 하고 닫기 · 네이버·쿠팡 · 줄 고쳐도 유지 · for-ship · 옛 화면 · 390/900/1280·야간
//   실행: PGLITE_DIR=<pglite 폴더> node scripts/verify-970-ui.js (PORT970 · 기본 3471)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 600))); return !!c; };
if (!process.env.PGLITE_DIR) { console.log('PGLITE_DIR 필요'); process.exit(2); }
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const OM = require(path.join(ROOT, 'order-memo.js'));
const D0 = '2026-11-02', D2 = '2026-11-03', PORT = Number(process.env.PORT970) || 3471, BASE = 'http://127.0.0.1:' + PORT;
function mkPool(db) { const conv = v => Array.isArray(v) ? v : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#EEF0F4;font-family:system-ui,"Malgun Gothic",sans-serif}</style>
<link rel="stylesheet" href="/app/styles.css"><link rel="stylesheet" href="/app/theme.css"><link rel="stylesheet" href="/app/ao-desk.css"><link rel="stylesheet" href="/app/ao-ordermemo.css"><link rel="stylesheet" href="/app/ao-dark.css"></head><body>
<script>localStorage.setItem('jwt_token','x');window.showToast=function(m){(window.__toasts=window.__toasts||[]).push(m)};</script>
<script src="/app/ao-ordermemo.js"></script></body></html>`;
const OPT = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)';
const K = '010-5555-0001', KD = '01055550001', KC = '050-7777-0002', KCD = '05077770002';
(async () => {
    console.log('① 배지 함수');
    { const row = n => ({ kind: 'cash', state: 'open', sure: true, cells: ['가 드림', KD, '', 'a', OPT, String(n), '', '', '', '', KD, '', ''] }), line = c => ({ line_key: KD, plat: '네이버', checked: c });
      const od = [{ channel: 'naver', buyer_digits: KD, option_text: OPT, qty: 3, product_order_no: '2099100002' }, { channel: 'naver', buyer_digits: KD, option_text: '황금향', qty: 1, product_order_no: '2099100001' }];
      const b0 = OM.indivBadge(line(null), [row(3)], od, D2, {}); ok(b0.state === 'short' && b0.m === 4 && b0.normal === 0, '값 없음 = 3/4 모자람', b0);
      const b1 = OM.indivBadge(line({ normal_orders: ['2099100001'] }), [row(3)], od, D2, {}); ok(b1.state === 'ok' && b1.m === 3 && b1.n === 3 && b1.normal === 1 && !b1.item_diff, '일반발송 뺌 = 3/3 · 품목 대조도', b1);
      const b2 = OM.indivBadge(line({ normal_orders: ['2099100001', '2099100002'] }), [], od, D2, {}); ok(b2.state === 'allnormal' && b2.normal === 2, '전부 일반발송 · 주소 줄 0 = allnormal', b2);
      const b3 = OM.indivBadge(line({ normal_orders: ['2099100001', '2099100002'] }), [row(2)], od, D2, {}); ok(b3.state === 'over' && b3.m === 0, '전부 일반발송 + 주소 줄 남음 = 초과(경고)', b3);
      { const lt = Object.assign(row(2), { ship_date: '2099-01-01' }), b5 = OM.indivBadge(line({ normal_orders: ['2099100001', '2099100002'] }), [lt], od, D2, {}); ok(b5.state === 'normal_later' && b5.normal === 2 && b5.later === 2 && b5.m === 0, '점검 ⑤ 전부 일반발송 + 주소 줄 전부 뒤 날짜 = normal_later(0/0 매칭완료 아님)', b5); }
      const b4 = OM.indivBadge(line({ normal_orders: ['99999999'] }), [row(3)], od, D2, {}); ok(b4.state === 'short' && b4.normal === 0, '없어진 주문 번호 = 영향 0', b4); }
    const db = new PGlite(); await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`); await db.query(`INSERT INTO pricing (partner, start_date, end_date, items) VALUES ('a', '2026-01-01', '2027-01-01', $1)`, [JSON.stringify([{ name: OPT, price: 1 }])]);
    const app = express(); app.use(express.json());
    const audits = []; const auth = (req, res, next) => { req.user = { id: 990970, name: '검증', position: '', role: req.headers['x-t-role'] || 'staff' }; next(); };
    const api = OM.mount(app, { pool: mkPool(db), authMiddleware: auth, writeAudit: async a => { audits.push(a); }, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }), cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => D0, noTimers: true, anthropic: null, shipCal: async () => ({ realToday: D0, shipDays: [D2], suggested: D2 }) });
    app.get('/page', (req, res) => res.type('html').send(page));
    app.get(/^\/app\/(.+)$/, (req, res) => { const f = path.join(ROOT, 'public', path.basename(req.params[0])); fs.existsSync(f) ? res.sendFile(f) : res.status(404).end(); });
    app.get('/api/invoice/catalog', (req, res) => res.json({ byPartner: { a: [OPT] } }));
    app.get('/api/agent-office/juso', (req, res) => res.json({ results: { common: { errorCode: '0', totalCount: '0' }, juso: [] } }));
    const srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, '127.0.0.1', () => r(s)); });
    await api.ensure(); await api.preEnsure();
    const pre = (ch, key, pno, buyer, rn, ad, op, q) => db.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, paid_at) VALUES ($1,$2,$3,'구매',$4,$5,'01000001111',$6,$7,$8,NOW())`, [ch, key, pno, buyer, rn, ad, op, q]);
    await pre('naver', '2099110300001', '2099110300001', KD, '주문받는1', '서울 가짜구 주문로 1', OPT, 3);
    await pre('naver', '2099110300002', '2099110300002', KD, '주문받는2', '서울 가짜구 주문로 2', OPT, 1);
    await pre('coupang', 'B77|V1', '3100000077', KCD, '쿠팡받는1', '부산 가짜구 쿠팡로 1', OPT, 2);
    await pre('coupang', 'B78|V1', '3100000077', KCD, '쿠팡받는1', '부산 가짜구 쿠팡로 1', OPT, 1);
    await pre('coupang', 'B79|V1', '3100000079', KCD, '쿠팡받는2', '부산 가짜구 쿠팡로 2', OPT, 1);
    const post = async b => (await fetch(BASE + '/api/order-memo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
    const cash = (nm, tel, k, n) => ({ kind: 'cash', src: 'edit', ship_date: null, cells: ['가족 드림', k, '제주', nm, OPT, String(n || 1), tel, '', '서울 가짜구 주소줄로 ' + nm, '', k, '', ''] });
    const s1 = await post({ raw: '', rows: [{ kind: 'line', key: K, note: '입력o삭제x', plat: '네이버', ship_date: null, src: 'edit' }, cash('주소1', '010-8111-0001', K), cash('주소2', '010-8111-0002', K), cash('주소3', '010-8111-0003', K)] });
    const s2 = await post({ raw: '', rows: [{ kind: 'line', key: KC, note: '입력o삭제x', plat: '쿠팡', ship_date: null, src: 'edit' }, cash('쿠주소1', '010-8222-0001', KC), cash('쿠주소2', '010-8222-0002', KC), cash('쿠주소3', '010-8222-0003', KC)] });
    const lineId = s1.rows[0].id, cLineId = s2.rows[0].id;
    const rowOf = async id => (await db.query('SELECT checked, line, note, line_key FROM order_memo_rows WHERE id=$1', [id])).rows[0];
    const listB = async id => { const j = await (await fetch(BASE + '/api/order-memo?state=open')).json(); return j.entries.flatMap(e => e.rows).find(x => x.id === id).badge; };
    const forShip = async sm => (await fetch(BASE + '/api/order-memo/for-ship?' + (sm ? 'sm=1&' : '') + 'date=' + D2)).json();
    const br = await chromium.launch(); const errs = [];
    const open = async (vp, dark) => { const ctx = await br.newContext({ viewport: vp }), pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message)); await pg.goto(BASE + '/page'); await pg.waitForFunction(() => !!window.AkmOrderMemo); if (dark) await pg.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark')); await pg.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await pg.waitForSelector('#om-list .om-badge'); return pg; };
    const badgeOf = (pg, tel) => pg.locator('#om-list .om-item, #om-list li').filter({ hasText: tel }).locator('.om-badge').first();
    try {
        console.log('② 3/4 → 체크 → 3/3 왕복(네이버)');
        let pg = await open({ width: 1280, height: 900 });
        ok(/3\/4/.test(await badgeOf(pg, K).textContent()), '처음 배지 3/4', await badgeOf(pg, K).textContent());
        await badgeOf(pg, K).click(); await pg.waitForSelector('.om-norm input[data-cact="normchk"]');
        const txt = await pg.textContent('.om-norm');
        ok(txt.includes('이 번호의 주문 2건') && txt.includes('주문받는2') && txt.includes('서울 가짜구 주문로 2') && txt.includes('1박스'), '주문 목록 = 판매처·품목·수량·받는 분·주소', txt);
        { const li = pg.locator('.om-norm li.om-norm-li', { has: pg.locator('input[data-v="2099110300002"]') }); await li.locator(':scope > span').first().click(); ok(!(await pg.locator('.om-norm input[data-v="2099110300002"]').isChecked()) && !(await pg.textContent('#om-card-save')).includes('일반발송'), '#1119 C1 주문 글을 눌러도 일반발송 체크 안 켜짐', await pg.textContent('#om-card-save')); }
        await pg.locator('.om-norm input[data-v="2099110300002"]').check(); ok((await pg.textContent('#om-card-save')).includes('일반발송 1건'), '저장 단추에 표시', await pg.textContent('#om-card-save'));
        await pg.locator('#om-card [data-act="cancel"], #om-card .om-card-x, #om-card-x').first().click().catch(() => {}); await pg.waitForTimeout(150);
        if (await pg.locator('#om-card:not([hidden])').count()) await pg.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
        await pg.waitForTimeout(150);
        let r0 = await rowOf(lineId); ok(!(r0.checked && r0.checked.normal_orders), '저장 안 하고 닫기 = 안 저장', r0.checked);
        if (await pg.locator('#om-card:not([hidden])').count()) { await pg.reload(); await pg.waitForFunction(() => !!window.AkmOrderMemo); await pg.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await pg.waitForSelector('#om-list .om-badge'); }
        await badgeOf(pg, K).click(); await pg.waitForSelector('.om-norm input[data-cact="normchk"]');
        ok(!(await pg.locator('.om-norm input[data-v="2099110300002"]').isChecked()), '다시 열면 체크 비움');
        await pg.locator('.om-norm input[data-v="2099110300002"]').check(); await pg.click('#om-card-save'); await pg.waitForFunction(() => { const c = document.getElementById('om-card'); return !c || c.hidden; }, null, { timeout: 8000 });
        r0 = await rowOf(lineId); ok(r0.checked && r0.checked.normal_orders.join() === '2099110300002', '[고친 대로 저장] = 체크까지 저장', r0.checked);
        await pg.waitForFunction(() => /일반발송 1건/.test(document.getElementById('om-list').textContent)); const bt = await badgeOf(pg, K).textContent(); ok(/3\/3 매칭완료/.test(bt) && /일반발송 1건/.test(bt), '배지 3/3 매칭완료 · 일반발송 1건', bt);
        let F = await forShip(true); ok(F.normal_orders.length === 1 && F.normal_orders[0].orders.join() === '2099110300002' && F.normal_orders[0].buyer === KD && F.lines.some(l => l.id === lineId), 'for-ship(sm=1) = normal_orders · 입력삭제 줄 그대로', F.normal_orders);
        const Fo = await forShip(false); ok(!('normal_orders' in Fo) && Fo.lines.some(l => l.id === lineId), '옛 화면(sm 없음) = 그 칸 없음 · 종전대로 입력삭제', Object.keys(Fo));
        ok(audits.some(a => a.action === 'normal_orders'), 'audit 남음');
        console.log('③ 다시 풀기 · 줄 고쳐도 유지 · 번호 고치면 버림');
        await fetch(BASE + '/api/order-memo/rows/' + lineId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: K, note: '입력o삭제x', plat: '네이버', ship_date: null, checked: { plat: '네이버', as: 'buyer', at: new Date().toISOString() } }) });
        r0 = await rowOf(lineId); ok(r0.checked.normal_orders && r0.checked.normal_orders.length === 1, '고치기 저장(같은 번호) = 일반발송 유지', r0.checked);
        await badgeOf(pg, K).click(); await pg.waitForSelector('.om-norm input[data-cact="normchk"]'); ok(await pg.locator('.om-norm input[data-v="2099110300002"]').isChecked(), '저장된 체크 보임');
        await pg.locator('.om-norm input[data-v="2099110300002"]').uncheck(); await pg.click('#om-card-save'); await pg.waitForFunction(() => { const c = document.getElementById('om-card'); return !c || c.hidden; }, null, { timeout: 8000 });
        r0 = await rowOf(lineId); ok(!r0.checked.normal_orders, '체크 풀고 저장 = 지움', r0.checked); await pg.waitForTimeout(400);
        const b9 = await listB(lineId); ok(b9.state === 'short' && b9.m === 4, '배지 다시 3/4', b9);
        console.log('④ 쿠팡 = 같은 패턴(구매자 안심번호)');
        await pg.reload(); await pg.waitForFunction(() => !!window.AkmOrderMemo); await pg.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await pg.waitForSelector('#om-list .om-badge');
        await badgeOf(pg, KC).click(); await pg.waitForSelector('.om-norm input[data-cact="normchk"]');
        const ct = await pg.textContent('.om-norm'); ok(ct.includes('이 번호의 주문 2건') && await pg.locator('.om-norm input[data-v="3100000077"]').count() === 1 && ct.includes('3박스'), '상자 2줄 한 주문 = 한 칸 · 수량 합 · 주문번호 체크', ct);
        await pg.locator('.om-norm input[data-v="3100000079"]').check(); await pg.click('#om-card-save'); await pg.waitForFunction(() => { const c = document.getElementById('om-card'); return !c || c.hidden; }, null, { timeout: 8000 });
        const bc = await listB(cLineId); ok(bc.m === 3 && bc.normal === 1 && bc.state === 'ok', '쿠팡 배지 3/3 · 일반발송 1', bc);
        F = await forShip(true); ok(F.normal_orders.some(x => x.plat === '쿠팡' && x.orders.join() === '3100000079'), '쿠팡 for-ship = 주문번호', F.normal_orders);
        console.log('⑤ 서버 막기');
        const pn = async (id, orders) => fetch(BASE + '/api/order-memo/rows/' + id + '/normal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orders }) });
        ok((await pn(s1.rows[1].id, ['2099110300002'])).status === 400, '현금 줄 = 400'); ok((await pn(lineId, ['abc'])).status === 400, '주문번호 꼴 아님 = 400');
        ok((await fetch(BASE + '/api/order-memo/rows/' + lineId + '/normal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-t-role': 'accountant' }, body: JSON.stringify({ orders: [] }) })).status === 403, '점검 ⑥ 세무사 = 403');
        console.log('⑥ 폭·야간');
        for (const [w, h, dark, lb] of [[390, 800, false, '390'], [900, 800, false, '900'], [1280, 900, true, '1280 야간'], [390, 800, true, '390 야간']]) {
            const p = await open({ width: w, height: h }, dark); await badgeOf(p, K).click(); await p.waitForSelector('.om-norm input[data-cact="normchk"]'); await p.waitForTimeout(400);
            const m = await p.evaluate(() => { const b = document.querySelector('.om-norm'), r = b.getBoundingClientRect(), o = document.getElementById('om-card').getBoundingClientRect(), lab = b.querySelector('label').getBoundingClientRect(), cs = getComputedStyle(b.querySelector('.om-norm-li > span') || b.querySelector('label span')); return { over: r.right - o.right, lab: lab.height, fg: cs.color, dark: document.documentElement.getAttribute('data-ao-theme') }; });
            ok(m.over <= 1 && (w > 960 || m.lab >= 44), lb + ': 넘침 0 · 44px', m); await p.close();
        }
        ok(errs.length === 0, '콘솔 오류 0', errs.slice(0, 3));
    } catch (e) { fail++; console.log('  ❌ 멈춤:', e.message); }
    await br.close(); srv.close(); await db.close().catch(() => {});
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
