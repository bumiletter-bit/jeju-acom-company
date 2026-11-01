// #955 메모함 「메모 수정」 실클릭 + 서버 실제 경로 — 실제 order-memo.js(라우트·SQL) + pglite(메모리 DB) + 실제 ao-ordermemo.js·css + 앱 공통 CSS · 실DB·실서버 0
//   번호 → 주문 카드 → 저장 → GET /api/order-memo/for-ship 응답에 ship_memos(메모 칸 밖) · 2건 고르기 · 주문 없음 · 빈 칸 · 고쳐 저장 · 기존 꼬리표 그대로 · 390/900/1280·야간
//   실행: PGLITE_DIR=<pglite 폴더> node scripts/verify-955-ui.js (PORT955 · 기본 3469)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 600))); return !!c; };
if (!process.env.PGLITE_DIR) { console.log('PGLITE_DIR 필요'); process.exit(2); }
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const OM = require(path.join(ROOT, 'order-memo.js'));
const D0 = '2026-11-02', D2 = '2026-11-03', PORT = Number(process.env.PORT955) || 3469, BASE = 'http://127.0.0.1:' + PORT;
const arr = v => v; function mkPool(db) { const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#EEF0F4;font-family:system-ui,"Malgun Gothic",sans-serif}</style>
<link rel="stylesheet" href="/app/styles.css"><link rel="stylesheet" href="/app/theme.css"><link rel="stylesheet" href="/app/ao-desk.css"><link rel="stylesheet" href="/app/ao-ordermemo.css"><link rel="stylesheet" href="/app/ao-dark.css"></head><body>
<script>localStorage.setItem('jwt_token','x');window.showToast=function(m){(window.__toasts=window.__toasts||[]).push(m)};</script>
<script src="/app/ao-ordermemo.js"></script></body></html>`;
(async () => {
    const db = new PGlite(); await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`); const app = express(); app.use(express.json());
    const auth = (req, res, next) => { req.user = { id: 990955, name: '검증', position: '', role: 'staff' }; next(); };
    const audits = [];
    const api = OM.mount(app, { pool: mkPool(db), authMiddleware: auth, writeAudit: async a => { audits.push(a); }, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }), cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => D0, noTimers: true, anthropic: null, shipCal: async () => ({ realToday: D0, shipDays: [D2], suggested: D2 }) });
    app.get('/page', (req, res) => res.type('html').send(page));
    app.get(/^\/app\/(.+)$/, (req, res) => { const f = path.join(ROOT, 'public', path.basename(req.params[0])); fs.existsSync(f) ? res.sendFile(f) : res.status(404).end(); });
    app.get('/api/invoice/catalog', (req, res) => res.json({ byPartner: { a: ['고당도 타이벡감귤 / 가정용 - 5kg'] } }));
    app.get('/api/agent-office/juso', (req, res) => res.json({ results: { common: { errorCode: '0', totalCount: '0' }, juso: [] } }));
    const srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, '127.0.0.1', () => r(s)); });
    await api.ensure(); await api.preEnsure();
    const pre = (pno, buyer, recv, bn, rn, ad, op, q) => db.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, paid_at) VALUES ('naver',$1,$1,$2,$3,$4,$5,$6,$7,$8,NOW())`, [pno, bn, buyer, rn, recv, ad, op, q]);
    const ONE = '01055550001', TWO = '01055550002', GONE = '01055550009';
    await pre('2099110200001', ONE, '05022570001', '가구매', '나받는', '서울 가짜구 일로 1', '상품: 타이벡 / 과수: 가정용 - 5kg', 1);
    await pre('2099110200002', TWO, TWO, '다구매', '다구매', '서울 가짜구 이로 2', '상품: 타이벡 / 과수: 가정용 - 3kg', 1);
    await pre('2099110200003', TWO, '01066660003', '다구매', '라받는', '서울 가짜구 삼로 3', '상품: 황금향 / 과수: 선물 - 5kg', 2);
    const forShip = async () => (await (await fetch(BASE + '/api/order-memo/for-ship?sm=1&date=' + D2)).json());
    const rows = async () => (await db.query(`SELECT id, line_key, note, plat, line, checked, sure, kind, ship_date::text AS ship_date, state FROM order_memo_rows ORDER BY id`)).rows;
    const br = await chromium.launch(); const errs = [];
    const fmt = d => d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
    async function open(vp, dark) {
        const ctx = await br.newContext({ viewport: vp, colorScheme: 'light' }); const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message));
        await pg.goto(BASE + '/page'); await pg.waitForFunction(() => !!window.AkmOrderMemo);
        if (dark) await pg.evaluate(() => { document.documentElement.setAttribute('data-ao-theme', 'dark'); });
        await pg.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await pg.waitForSelector('.om-tag[data-tag="smemo"]'); await pg.waitForTimeout(300); return pg;
    }
    try {
        console.log('Ⅰ 꼬리표');
        let pg = await open({ width: 1280, height: 900 });
        const tags = await pg.$$eval('.om-tag', b => b.map(x => x.textContent));
        ok(JSON.stringify(tags) === JSON.stringify(['주문입력', '입력삭제', '사이즈·과수', '날짜 지정', '보내는이', '메모 수정']), '꼬리표 = 기존 5 + 메모 수정(맨 뒤)', tags);
        // 기존 꼬리표: 날짜 지정·보내는이 무변경
        await pg.click('.om-tag[data-tag="sender"]'); ok(await pg.textContent('#om-tp-go') === '넣기' && await pg.isVisible('#om-tp-name'), '보내는이 = 종전 입력판 · [넣기]');
        await pg.fill('#om-tp-tel', fmt(ONE)); await pg.fill('#om-tp-name', '홍길동'); await pg.click('#om-tp-go');
        ok((await pg.inputValue('#om-raw')).includes(fmt(ONE) + ' 보내는이 홍길동'), '보내는이 줄 그대로 입력 칸에');
        await pg.click('.om-tag[data-tag="date"]'); ok(await pg.textContent('#om-tp-go') === '넣기' && await pg.isVisible('#om-tp-date'), '날짜 지정 = 종전 입력판');
        await pg.evaluate(() => { document.getElementById('om-raw').value = ''; document.getElementById('om-raw').dispatchEvent(new Event('input', { bubbles: true })); });

        console.log('Ⅱ 번호 → 카드 → 저장 → for-ship');
        await pg.click('.om-tag[data-tag="smemo"]');
        ok(await pg.textContent('#om-tp-go') === '주문 찾기' && (await pg.textContent('#om-tp-s')).includes('원본은 그대로'), '입력판 = [주문 찾기] · 원본 안 바뀐다는 글');
        await pg.fill('#om-tp-tel', ''); await pg.click('#om-tp-go'); ok((await pg.textContent('#om-tp-note')).includes('넣어 주세요') && await pg.isHidden('#om-sm'), '빈 번호 = 안내만');
        await pg.locator('#om-tp-tel').pressSequentially(ONE, { delay: 5 });
        ok(await pg.inputValue('#om-tp-tel') === ONE, '치는 중 값 안 바뀜(하이픈 안 끼움)', await pg.inputValue('#om-tp-tel'));
        await pg.click('#om-tp-go'); await pg.waitForSelector('#om-sm-t');
        ok(await pg.inputValue('#om-tp-tel') === fmt(ONE), '[주문 찾기] 때 한 번 다듬음');
        const card = await pg.textContent('#om-sm');
        ok(card.includes('나받는') && card.includes('가정용 - 5kg') && card.includes('서울 가짜구 일로 1') && card.includes('넣어 둔 배송메모 없음') && card.includes('주문 원본은 바뀌지 않아요'), '주문 카드 내용·원본 안내', card);
        ok(await pg.$eval('input[name="om-sm-o"]', i => i.checked), '1건 = 미리 고름');
        await pg.click('[data-smact="save"]'); ok((await pg.textContent('#om-tp-note')).includes('배송 메모를 넣어'), '빈 메모 = 저장 막음'); ok((await rows()).length === 0, '서버 줄 0');
        const T1 = '1층 문 열립니다. 2층에 꼭 올려주세요';
        await pg.fill('#om-sm-t', T1); await pg.click('[data-smact="save"]'); await pg.waitForFunction(() => document.getElementById('om-sm').hidden);
        let R = await rows();
        ok(R.length === 1 && R[0].line_key === '2099110200001' && R[0].note === '배송메모 ' + T1 && R[0].checked.ship_memo === T1 && R[0].checked.plat === '네이버' && R[0].sure === true, '서버 줄 = 주문번호 키 · checked.ship_memo', R);
        ok(R[0].checked.buyer === ONE, '구매자 번호 보관', R[0].checked);
        let F = await forShip();
        ok(F.ship_memos.length === 1 && F.ship_memos[0].text === T1 && F.ship_memos[0].key === '2099110200001' && F.ship_memos[0].id === R[0].id, '실제 for-ship 응답에 ship_memos', F);
        ok(F.lines.length === 0 && F.memo_text === '' && F.ids.includes(R[0].id), 'lines·memo_text 밖(메모 칸·중간발주 영향 0) · ids 안(오늘 씀)', F);
        { const o = await (await fetch(BASE + '/api/order-memo/for-ship?date=' + D2)).json(); ok(!('ship_memos' in o) && o.ids.length === 0 && o.lines.length === 0 && o.held.length === 0, '옛 화면(sm 없음) = 배송메모 줄 모름 · HEAD 와 같은 칸', o); }
        const listed = await (await fetch(BASE + '/api/order-memo?state=open')).json();
        ok(listed.counts.next === 1 && listed.entries[0].rows[0].checked.ship_memo === T1, '목록 응답에 그대로 · 다음 발주 1줄', listed.counts);
        await pg.waitForFunction(t => document.getElementById('om-list').textContent.includes(t), T1);
        ok(true, '왼쪽 목록에 저장된 줄 보임');

        console.log('Ⅲ 같은 주문 다시 = 고쳐 저장(줄 안 늘어남)');
        await pg.click('#om-tp-go'); await pg.waitForSelector('#om-sm-t');
        ok(await pg.inputValue('#om-sm-t') === T1 && (await pg.textContent('#om-sm')).includes('지금 넣어 둔 배송메모'), '넣어 둔 메모 보임');
        await pg.fill('#om-sm-t', T1 + ' 감사합니다'); await pg.click('[data-smact="save"]'); await pg.waitForFunction(() => document.getElementById('om-sm').hidden);
        R = await rows(); ok(R.length === 1 && R[0].checked.ship_memo === T1 + ' 감사합니다' && R[0].note === '배송메모 ' + T1 + ' 감사합니다' && R[0].checked.buyer === ONE, '같은 줄 고침', R);

        console.log('Ⅳ 2건 = 고르기 · 고른 주문만');
        await pg.fill('#om-tp-tel', TWO); await pg.click('#om-tp-go'); await pg.waitForSelector('#om-sm-t');
        ok((await pg.textContent('#om-sm')).includes('주문이 2건이에요') && await pg.locator('input[name="om-sm-o"]:checked').count() === 0, '2건 = 안 고른 상태');
        await pg.fill('#om-sm-t', '둘째 주문 메모'); await pg.click('[data-smact="save"]'); ok((await pg.textContent('#om-tp-note')).includes('주문을 골라'), '안 고르면 저장 막음'); ok((await rows()).length === 1, '서버 줄 그대로');
        await pg.locator('input[name="om-sm-o"]').nth(1).check(); ok(await pg.inputValue('#om-sm-t') === '둘째 주문 메모', '고른 뒤 적던 글 유지');
        const chosenAddr = await pg.locator('.om-sm .om-ordl li').nth(1).textContent();
        await pg.click('[data-smact="save"]'); await pg.waitForFunction(() => document.getElementById('om-sm').hidden);
        R = await rows(); const r2 = R[1], m2 = (await db.query(`SELECT addr FROM order_memo_preorders WHERE product_order_no=$1`, [r2.line_key])).rows[0];
        ok(R.length === 2 && /^20991102/.test(r2.line_key) && chosenAddr.includes(m2.addr), '고른 주문번호 줄만', [r2.line_key, chosenAddr]);

        console.log('Ⅴ 주문 없음·주문번호로 찾기');
        await pg.fill('#om-tp-tel', GONE); await pg.click('#om-tp-go'); await pg.waitForFunction(() => /못 찾았어요/.test(document.getElementById('om-sm').textContent));
        ok(await pg.locator('#om-sm-t').count() === 0, '주문 없음 = 안내만 · 저장 칸 없음');
        await pg.waitForFunction(() => /잠시 뒤/.test(document.getElementById('om-sm').textContent), null, { timeout: 9000 }); ok(true, '6초 뒤 한 번 더 찾고 안내');
        await pg.fill('#om-tp-tel', '2099110200001'); await pg.click('#om-tp-go'); await pg.waitForSelector('#om-sm-t'); ok(await pg.inputValue('#om-tp-tel') === '2099110200001' && await pg.inputValue('#om-sm-t') === T1 + ' 감사합니다', '주문번호로도 찾음·넣어 둔 글');
        await pg.click('[data-smact="close"]'); ok(await pg.isHidden('#om-tp'), '[닫기]');

        console.log('Ⅵ 서버 규칙');
        const post = async rowsB => (await fetch(BASE + '/api/order-memo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: '', rows: rowsB }) })).json();
        const ck = t => ({ plat: '네이버', as: 'order', at: new Date().toISOString(), ship_memo: t });
        const w = await post([{ kind: 'line', key: '2099110200002', note: '배송메모 뒤날짜', plat: '네이버', ship_date: '2026-11-20', src: 'edit', checked: ck('뒤날짜') }, { kind: 'line', key: '01055550002', note: '배송메모 S사이즈로 10일 입력삭제', plat: '네이버', ship_date: null, src: 'edit', checked: ck('S사이즈로 10일 입력삭제') }, { kind: 'line', key: '01055550001', note: '입력o삭제x', plat: '네이버', ship_date: null, src: 'edit' }]);
        ok(w.ok && w.rows[1].sure === true, '낱말 든 메모 = 규칙 줄 아님·확인 줄 아님', w.rows && w.rows[1]);
        F = await forShip();
        ok(F.ship_memo_wait.some(x => x.ship_date === '2026-11-20') && !F.ship_memos.some(m => m.text === '뒤날짜') && !F.ids.includes(w.rows[0].id), '뒤 날짜 = 그날까지 대기', F.ship_memo_wait);
        ok(F.lines.length === 1 && F.lines[0].id === w.rows[2].id && F.lines[0].line.includes('입력o삭제x'), '일반 메모 줄은 종전대로 lines', F.lines);
        const listed2 = await (await fetch(BASE + '/api/order-memo?state=open')).json(), r3 = listed2.entries.flatMap(e => e.rows).find(x => x.id === w.rows[1].id);
        ok(r3 && !r3.badge, '배송메모 줄 = 입력삭제 배지 없음', r3 && r3.badge);
        const put1 = await (await fetch(BASE + '/api/order-memo/rows/' + w.rows[1].id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: '배송메모 고친 글', key: '01055550002', plat: '네이버', checked: null }) })).json();
        ok(put1.row ? put1.row.checked.ship_memo === '고친 글' : (await rows()).find(x => x.id === w.rows[1].id).checked.ship_memo === '고친 글', '고치기 카드(note) = ship_memo 따라감', put1);
        const put2 = await fetch(BASE + '/api/order-memo/rows/' + w.rows[1].id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: '배송메모 ' }) }); ok(put2.status === 400, '메모 비우면 400', put2.status);
        const plain = OM.pickForShip([{ id: 1, kind: 'line', state: 'open', sure: true, line: 'x', line_key: '010', ship_date: null, checked: { plat: '네이버', as: 'buyer' } }], D2);
        ok(plain.lines.length === 1 && plain.ship_memos.length === 0 && JSON.stringify(plain.ids) === '[1]', '값 없는 줄 = 종전 lines · ids 그대로');
        ok(!OM.markIndiv || OM.indivKeysOf([{ kind: 'line', key: '01055550002', note: '배송메모 입력삭제', line: '01055550002 배송메모 입력삭제' }]).size === 0, '글에 「입력삭제」 있어도 입력삭제 줄 아님');

        console.log('Ⅶ 폭·야간');
        for (const [w0, h0, dark, lb] of [[390, 800, false, '390'], [900, 800, false, '900'], [1280, 900, true, '1280 야간'], [390, 800, true, '390 야간']]) {
            const p = await open({ width: w0, height: h0 }, dark);
            await p.click('.om-tag[data-tag="smemo"]'); await p.fill('#om-tp-tel', TWO); await p.click('#om-tp-go'); await p.waitForSelector('#om-sm-t');
            const m = await p.evaluate(() => { const sm = document.getElementById('om-tp'), o = document.scrollingElement; const r = sm.getBoundingClientRect(); const kids = [...sm.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > r.right + 1).length; const low = [...sm.querySelectorAll('input:not([type=radio]),textarea,[data-smact],#om-tp-go')].filter(x => x.getBoundingClientRect().height < 40).map(x => x.id || x.textContent); const cs = getComputedStyle(document.getElementById('om-sm-t')); const col = c => c; return { over: o.scrollWidth - o.clientWidth, kids, low, bg: col(cs.backgroundColor), fg: col(cs.color), tags: [...document.querySelectorAll('.om-tag')].filter(t => t.getBoundingClientRect().right > innerWidth).length }; });
            const lum = c => { const v = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; }, cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
            ok(m.kids === 0 && m.tags === 0 && m.low.length === 0, `${lb}: 넘침 0 · 40px 미만 0 · 꼬리표 안 잘림`, m);
            ok(!/rgba?\(0, 0, 0, 0\)/.test(m.bg) ? cr(m.bg, m.fg) >= 4.5 : true, `${lb}: 입력 글 대비 4.5↑`, m);
            await p.close();
        }
        ok(errs.length === 0, '콘솔 오류 0', errs.slice(0, 3));
    } catch (e) { fail++; console.log('  ❌ 멈춤:', e.message); }
    await br.close(); srv.close(); await db.close().catch(() => {});
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
