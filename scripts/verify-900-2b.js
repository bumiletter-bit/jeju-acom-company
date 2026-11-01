// #900-2B 검증 — 메모함 명절 화면(현금 줄 100줄 넘으면 촘촘 꼴·50줄 페이지·찾기·이 쪽 전체 선택·「찾은 n줄 전부 고르기」·보이는 쪽만 주소 검색 · 주문입력 카드 1,500줄 50장씩·빈칸 먼저·첫 빈칸으로)
//   🔴 실DB 쓰기 없음 · 서버(server.js) 안 띄움 · 네트워크 0 — 이 스크립트가 띄우는 작은 가짜 서버(가짜 /api/*)에 public/ao-ordermemo.js·css 만 얹어 Playwright 로 봄
//   무회귀 = 100줄 이하 · 50장 이하 카드는 지금 커밋(HEAD)의 ao-ordermemo.js(+ 지금 css · #909)와 화면 픽셀 비교(같아야 함)
//   #934(11/1) ⑤ 절 = 「추가 매칭」(번호 다른 현금 줄 · ①②③ 카드 단추 · 찾기 · 저장 뒤 POST pair pick) · ④ 메모함 입력삭제 줄 단추(바로 POST) · ⑤ 현금 줄 고치기 카드 [입력삭제 주문에 붙이기] · 가짜 /preview·/pair·저장 응답은 이 스크립트 안에서만
//   실행: node scripts/verify-900-2b.js   (PORT2B 로 포트 · 기본 3458)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright');
const XLSX = require('xlsx-js-style');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const info = (name, v) => console.log('  ℹ️ ', name, v);

const SRC = {
    new: { js: fs.readFileSync(path.join(ROOT, 'public', 'ao-ordermemo.js'), 'utf8'), css: fs.readFileSync(path.join(ROOT, 'public', 'ao-ordermemo.css'), 'utf8') },
    old: { js: execSync('git show HEAD:public/ao-ordermemo.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString(), css: execSync('git show HEAD:public/ao-ordermemo.css', { cwd: ROOT, maxBuffer: 64 << 20 }).toString() },
};
SRC.mix = { js: SRC.old.js, css: SRC.new.css };   // #909 현금 표 CSS 를 바꿨으니 ≤100줄 픽셀 비교 = 종전(HEAD) js + 지금 css(그리는 js 무회귀만 봄 · CSS 꼴은 #909 PNG 로 눈 확인)
const XLSX_JS = fs.readFileSync(path.join(ROOT, 'node_modules', 'xlsx-js-style', 'dist', 'xlsx.bundle.js'));
const CAT = ['타이벡감귤 5kg', '타이벡감귤 3kg', '황금향 3kg'];
const SHIP = '2026-10-29';

// 가짜 목록: n 줄을 묶음 ent 개에 나눔 · 이름 손님0001… · 번호 끝 4자리 = 줄 번호 · 주소 줄마다 다름(주소 검색 수를 셀 수 있게)
// #934 실사례 꼴(11/1 · 이름·번호 가짜) = 입력삭제 010-3292-0535 3박스 · 현금 줄 3(2줄 B = 그 번호 · 1줄 B = 다른 번호 010-9511-0535) + 다른 묶음(주소 줄 1 · 서비스 1 · 다른 번호 현금 1) + 어제 저장한 입력삭제 줄 010-5738-4123(주소 줄 1 붙음)
const PXK = '010-3292-0535', PXO = '010-9511-0535', PXL = '010-5738-4123';
function pxList() {
    const today = new Date().toISOString(), yest = new Date(Date.now() - 86400e3).toISOString();
    const cash = (id, A, B, nm, opt, qty, recv, K, addr, more) => Object.assign({ id, kind: 'cash', state: 'open', sure: true, check_why: [], addr_ok: null, indiv: false, service: false, cells: [A, B, '제주시 연삼로 1066-31', nm, opt, String(qty), recv, '', addr, '', K, '', ''] }, more || {});
    return { ok: true, ship_date: SHIP, keep_days: 15, counts: {}, entries: [
        { id: 129, created_at: today, source: 'manual', rows: (S.pxHide ? [] : [cash(191, '강명희 드림!', PXK, '이하정', CAT[1], 1, '010-2111-9887', '010-2111-9887', '충남 천안시 동남구 일봉로 7'), cash(192, '강명희 드림!', PXK, '이승비', CAT[1], 1, '010-2027-9787', '010-2027-9787', '충남 아산시 배방읍 동천로 2'), cash(193, '이형주 드림!', PXO, '김보은', CAT[1], 1, '010-4787-4217', '010-4787-4217', '충남 보령시 동대동 8')]).concat(S.pxHide ? [cash(193, '이형주 드림!', PXO, '김보은', CAT[1], 1, '010-4787-4217', '010-4787-4217', '충남 보령시 동대동 8')] : []) },
        { id: 140, created_at: today, source: 'manual', rows: [cash(201, '홍길동 드림', PXL, '주소줄손님', CAT[0], 1, '010-3300-0001', PXL, '서울 송파구 올림픽로 1', { indiv: true }), cash(202, '서비스!', '', '서비스손님', CAT[0], 1, '010-3300-0002', '010-3300-0002', '서울 마포구 월드컵로 2', { service: true }), cash(203, '박민수 드림!', '010-8800-1234', '최수아', CAT[0], 2, '010-8800-1234', '010-8800-1234', '서울 강남구 테헤란로 1')] },
        { id: 128, created_at: yest, source: 'manual', raw: PXL + ' 입력o삭제x 네이버', rows: [{ id: 190, kind: 'line', state: 'open', sure: true, check_why: [], key: PXL, note: '입력o삭제x', plat: '네이버', line: ['', PXL, '입력o삭제x', '네이버'].join('\t') }] },
    ].concat(S.px2 ? [{ id: 131, created_at: today, source: 'manual', raw: PXK + ' 입력o삭제x 네이버', rows: [{ id: 195, kind: 'line', state: 'open', sure: true, check_why: [], key: PXK, note: '입력o삭제x', plat: '네이버', line: ['', PXK, '입력o삭제x', '네이버'].join('\t') }] }] : []) };
}
function listBody(n, ent) {
    if (S.px) return pxList();
    const entries = [];
    for (let e = 0; e < ent; e++) entries.push({ id: e + 1, created_at: new Date(Date.UTC(2026, 9, 28, 0, 0, 0) - e * 60000).toISOString(), source: 'manual', rows: [] });
    for (let i = 0; i < n; i++) {
        const k = String(i + 1).padStart(4, '0');
        entries[i % ent].rows.push({ id: 10000 + i, kind: 'cash', state: 'open', sure: true, check_why: [], addr_ok: null,
            cells: ['', S.tel && i === 1 ? '010-7777-8888' : S.tel && i === 0 ? '010-1111-2222' : '', '', '손님' + k, CAT[i % 2], '1', '010-55' + k.slice(0, 2) + '-' + k, '', '제주특별자치도 제주시 연동 ' + (S.multi && i % 6 === 0 ? '다중 ' : '') + (i + 1) + '번지', '', S.tel && i < 2 ? '01011112222' : '', '', ''] });   // #927 tel = 0번 줄 B=K(서버가 채운 꼴) · 1번 줄 B≠K(대신 주문)
    }
    return { ok: true, ship_date: SHIP, keep_days: 15, counts: {}, entries };
}
const S = { n: 0, ent: 1, juso: 0, calls: [], multi: false, tel: false, puts: [], px: false, px2: false, pxHide: false, preview: null, pairs: [], saves: [] };   // #934 px = 실사례 목록 · preview = 가짜 정리 답 · pairs/saves = 받은 POST 본문   // multi = 6줄마다 주소 후보 둘(「주소 확인 필요」)
const page0 = v => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#EEF0F4;font-family:system-ui,"Malgun Gothic",sans-serif;-webkit-font-smoothing:antialiased}*{animation:none!important;transition:none!important;caret-color:transparent!important}</style>
<link rel="stylesheet" href="/app/styles.css"><link rel="stylesheet" href="/app/theme.css"><link rel="stylesheet" href="/app/ao-desk.css"><link rel="stylesheet" href="/om.css?v=${v}"></head><body>
<script>localStorage.setItem('jwt_token','x');window.showToast=function(m){(window.__toasts=window.__toasts||[]).push(m)};
window.__ooTest={splitAddr:function(r){return [r,'']},searchBody:function(b){return b},exactMatches:function(){return []}};</script>
<script src="/xlsx.js"></script><script src="/om.js?v=${v}"></script></body></html>`;
function serve(port) {
    const srv = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x'), send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
        const v = ['old', 'mix'].includes(u.searchParams.get('v')) ? u.searchParams.get('v') : 'new';
        if (u.pathname === '/') return send(200, page0(v), 'text/html; charset=utf-8');
        if (u.pathname === '/om.js') return send(200, SRC[v].js, 'text/javascript; charset=utf-8');
        if (/^\/app\/(styles|theme|ao-desk)\.css$/.test(u.pathname)) return send(200, fs.readFileSync(path.join(ROOT, 'public', path.basename(u.pathname))), 'text/css; charset=utf-8');   // #911 앱 공통 CSS(box-sizing 등)도 실어 실화면 꼴로(빠지면 입력 칸이 10px 넘쳐 보임)
        if (u.pathname === '/om.css') return send(200, SRC[v].css, 'text/css; charset=utf-8');
        if (u.pathname === '/xlsx.js') return send(200, XLSX_JS, 'text/javascript; charset=utf-8');
        S.calls.push(req.method + ' ' + u.pathname);
        if (u.pathname === '/api/order-memo' && req.method === 'GET') return send(200, u.searchParams.get('state') === 'cleared' ? { ok: true, entries: [] } : listBody(S.n, S.ent));
        if (u.pathname === '/api/order-memo/for-ship') return send(200, { ok: true, cash_ids: [], lines: [] });
        if (u.pathname === '/api/invoice/catalog') return send(200, { byPartner: { a: CAT } });
        if (u.pathname === '/api/agent-office/juso') { S.juso++; const kw = u.searchParams.get('keyword') || ''; const one = n => ({ roadAddrPart1: '제주특별자치도 제주시 연동로 ' + n, zipNo: '63' + String(n).padStart(3, '0'), bdNm: '' }); return send(200, { results: { common: { errorCode: '0' }, juso: /다중/.test(kw) ? [one(kw.length), one(kw.length + 500)] : [one(kw.length)] } }); }
        if (u.pathname === '/api/order-memo/preview' && req.method === 'POST') return send(200, S.preview || { ok: true, rows: [] });   // #934 붙여 넣은 글 정리 = 가짜 답
        if (u.pathname === '/api/order-memo/pair' && req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch (e) { } S.pairs.push(j); const ids = Array.isArray(j.ids) ? j.ids : []; send(200, j.undo === true ? { ok: true, n: (j.rows || []).length } : { ok: true, n: ids.length, skipped: 0, rows: [], undo: ids.map(id => ({ id, entry_id: 1, cells: ['x!'], ship_date: null })) }); }); return; }
        if (u.pathname === '/api/order-memo' && req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch (e) { } S.saves.push(j); send(200, { ok: true, rows: (j.rows || []).map((r, i) => Object.assign({}, r, { id: 900 + i, state: 'open', sure: true, check_why: [] })) }); }); return; }
        if (req.method === 'PUT') { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { S.puts.push(JSON.parse(b)); } catch (e) { } send(200, { ok: true }); }); return; }   // #927 고친 줄 본문 기록(가짜 서버 안에서만)
        if (req.method !== 'GET') return send(200, { ok: true });   // 쓰기 꼴 요청 = 이 가짜 서버 안에서만(아무 데도 안 감)
        return send(404, { ok: false });
    });
    return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}
const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 40)); } };
const jusoQuiet = async () => { let last = -1, same = 0; for (let i = 0; i < 200 && same < 6; i++) { await new Promise(r => setTimeout(r, 50)); if (S.juso === last) same++; else { same = 0; last = S.juso; } } };

(async () => {
    const PORT = Number(process.env.PORT2B || 3458);
    const srv = await serve(PORT), base = `http://127.0.0.1:${PORT}/`;
    const browser = await chromium.launch();
    const openMemo = async (pg, v, n, ent, phone) => {
        S.n = n; S.ent = ent;
        await pg.goto(base + '?v=' + v); await jusoQuiet();   // 앞 화면에서 날아가던 주소 검색이 다 끝난 뒤 셈
        S.juso = 0; S.calls = [];
        const t = await pg.evaluate(async () => { const t0 = performance.now(); window.AkmOrderMemo.open({ noFocus: true }); for (;;) { if (document.querySelector('#om-ctw tbody tr')) return performance.now() - t0; await new Promise(r => setTimeout(r, 5)); } });
        if (phone) await pg.click('#om-prev-open');
        return t;
    };
    try {
        // ── ① 1,000줄(묶음 300) 넓은 화면 ─────────────────
        console.log('① 현금 1,000줄(묶음 300) · 넓은 화면 1280');
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage();
        const errs = []; pg.on('pageerror', e => errs.push(String(e)));
        const tOld = await openMemo(pg, 'old', 1000, 300); await jusoQuiet(); const jOld = S.juso;
        const tNew = await openMemo(pg, 'new', 1000, 300); await jusoQuiet();
        info('첫 그림 시간(ms) 종전 → 지금', `${Math.round(tOld)} → ${Math.round(tNew)} (주소 검색 종전 ${jOld}번)`);
        ok(tNew < 1500, '첫 그림 1.5초 안', Math.round(tNew));
        let st = await pg.evaluate(() => { const t = document.querySelector('#om-ctw table'), td = t && t.querySelector('tbody td.nm'); return { dense: t && t.classList.contains('dense'), rows: document.querySelectorAll('#om-ctw tbody tr').length, fs: td && getComputedStyle(td).fontSize, h: td && Math.round(td.getBoundingClientRect().height), pg: !!document.querySelector('#om-ctw .om-pg'), nums: [...document.querySelectorAll('.om-pg-nums > *')].map(x => x.textContent).join(' '), n: (document.querySelector('.om-pg-n') || {}).textContent, first: (document.querySelector('#om-ctw tbody .om-ct-open') || {}).textContent }; });
        ok(st.dense && st.rows === 50 && st.fs === '11px' && st.h >= 36 && st.h <= 46, '촘촘 꼴 · 한 쪽 50줄 · 글씨 11px · 줄 36px 안팎', st);
        ok(st.pg && st.nums === '1 2 3 4 5 … 20' && st.n === '1–50 / 1,000줄', '쪽 단추 「‹ 1 2 3 4 5 … 20 ›」 · 1–50 / 1,000줄', st);
        ok(S.juso > 0 && S.juso <= 50, '주소 검색 = 보이는 쪽 줄만(50 이하)', S.juso);
        await pg.click('.om-pg-b[data-pg="next"]');
        st = await pg.evaluate(() => ({ rows: document.querySelectorAll('#om-ctw tbody tr').length, cur: (document.querySelector('.om-pg-b[aria-current]') || {}).textContent, n: (document.querySelector('.om-pg-n') || {}).textContent, foc: document.activeElement && document.activeElement.dataset.pg }));
        ok(st.rows === 50 && st.cur === '2' && st.n === '51–100 / 1,000줄' && st.foc === 'next', '다음 쪽 = 2쪽 51–100 · 초점은 다음 단추에', st);
        await pg.click('.om-pg-b[data-pg="19"]');
        st = await pg.evaluate(() => ({ rows: document.querySelectorAll('#om-ctw tbody tr').length, cur: (document.querySelector('.om-pg-b[aria-current]') || {}).textContent, nextOff: document.querySelector('.om-pg-b[data-pg="next"]').disabled, nums: [...document.querySelectorAll('.om-pg-nums > *')].map(x => x.textContent).join(' ') }));
        ok(st.rows === 50 && st.cur === '20' && st.nextOff && st.nums === '1 … 16 17 18 19 20', '마지막 쪽 20 · 다음 단추 꺼짐 · 「1 … 16 17 18 19 20」', st);
        await jusoQuiet(); ok(S.juso <= 150, '쪽을 넘겨도 그 쪽 줄만 더 검색(3쪽 본 뒤 150 이하)', S.juso);
        // 찾기 = 전체에서 · 결과도 페이지 · 1쪽부터
        await pg.fill('#om-cash-q', '손님01');   // 손님0100~0199 = 100줄 + 손님0010~0019 는 「손님001」이라 안 맞음
        st = await pg.evaluate(() => ({ rows: [...document.querySelectorAll('#om-ctw tbody .om-ct-open')].map(b => b.textContent), cur: (document.querySelector('.om-pg-b[aria-current]') || {}).textContent, n: (document.querySelector('.om-pg-n') || {}).textContent, all: (document.getElementById('om-callfound') || {}).textContent }));
        ok(st.rows.length === 50 && st.rows.every(t => t.startsWith('손님01')) && st.cur === '1' && st.n === '1–50 / 100줄', '찾기 「손님01」 = 전체 100줄 찾음 · 2쪽 · 1쪽부터', st);
        ok(st.all === '찾은 100줄 전부 고르기', '「찾은 100줄 전부 고르기」 단추', st.all);
        await pg.check('#om-cselall2');
        st = await pg.evaluate(() => ({ picked: document.querySelectorAll('#om-ctw tbody tr.picked').length, del: document.getElementById('om-del').textContent, lab: document.getElementById('om-cselall').parentNode.textContent.trim() }));
        ok(st.picked === 50 && st.del === '현금 줄 삭제 50' && st.lab === '이 쪽 전체 선택', '머리 전체 선택 = 이 쪽 50줄만 · [현금 줄 삭제 50]', st);
        await pg.click('.om-pg-b[data-pg="next"]');
        st = await pg.evaluate(() => ({ picked: document.querySelectorAll('#om-ctw tbody tr.picked').length, head: document.getElementById('om-cselall2').checked, del: document.getElementById('om-del').textContent }));
        ok(st.picked === 0 && !st.head && st.del === '현금 줄 삭제 50', '2쪽 = 고른 줄 0 · 머리 칸 꺼짐 · 고른 수 50 그대로', st);
        await pg.click('#om-callfound');
        st = await pg.evaluate(() => ({ picked: document.querySelectorAll('#om-ctw tbody tr.picked').length, head: document.getElementById('om-cselall2').checked, del: document.getElementById('om-del').textContent, all: document.getElementById('om-callfound').textContent }));
        ok(st.picked === 50 && st.head && st.del === '현금 줄 삭제 100' && st.all === '찾은 100줄 전부 풀기', '「찾은 100줄 전부 고르기」 = 100줄 · 단추는 「전부 풀기」로', st);
        st = await pg.evaluate(() => document.getElementById('om-cseln').textContent);
        ok(st === '100줄 고름 · 다른 쪽 50줄 포함', '큰 표 고른 수 글 = 「100줄 고름 · 다른 쪽 50줄 포함」', st);
        await pg.click('#om-del');
        st = await pg.evaluate(() => ({ h: document.getElementById('om-ask-h').textContent, s: document.getElementById('om-ask-s').textContent }));
        ok(/^100줄을 지우면/.test(st.h) && /손님01/.test(st.s), '삭제 확인 창 = 찾은 100줄(찾기 밖 줄 없음)', st);
        await pg.click('#om-ask-no');
        await pg.click('#om-callfound');
        st = await pg.evaluate(() => ({ del: document.getElementById('om-del').textContent }));
        ok(st.del === '현금 줄 삭제', '「전부 풀기」 = 다 풂', st);
        await pg.focus('#om-cash-q'); await pg.keyboard.press('Escape');
        st = await pg.evaluate(() => ({ cur: (document.querySelector('.om-pg-b[aria-current]') || {}).textContent, n: (document.querySelector('.om-pg-n') || {}).textContent, open: !document.getElementById('desk-om').hidden }));
        ok(st.open && st.cur === '1' && st.n === '1–50 / 1,000줄', '찾기 칸 Esc = 찾기만 비움 · 1쪽 · 메모함 그대로', st);
        await pg.fill('#om-cash-q', '0777');
        st = await pg.evaluate(() => ({ rows: [...document.querySelectorAll('#om-ctw tbody .om-ct-open')].map(b => b.textContent), pg: !!document.querySelector('#om-ctw .om-pg'), all: !!document.getElementById('om-callfound') }));
        ok(st.rows.join() === '손님0777' && !st.pg && !st.all, '번호 끝 4자리 0777 = 1줄 · 쪽 단추·전부 고르기 없음', st);
        ok(errs.length === 0, '스크립트 오류 0', errs);
        await ctx.close();

        // ── 폰 390 ──────────────────────────────────
        console.log('② 폰 390 · 1,000줄');
        const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); const pp = await pctx.newPage();
        const perr = []; pp.on('pageerror', e => perr.push(String(e)));
        await openMemo(pp, 'new', 1000, 300, true); await jusoQuiet();
        st = await pp.evaluate(() => {
            const win = document.querySelector('.om-win'), small = [];
            document.querySelectorAll('#om-ctw .om-ck, #om-ctw .om-x, .om-pg-b, #om-callfound, #om-cselbar .om-selall').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && (r.height < 44 || (el.matches('.om-pg-b, .om-x, .om-ck') && r.width < 44))) small.push(el.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
            const of = (document.querySelector('.om-pg-of') || {}).textContent, nums = document.querySelector('.om-pg-nums');
            return { sw: document.documentElement.scrollWidth, winOver: win.scrollWidth - win.clientWidth, small, of, numsShown: nums && getComputedStyle(nums).display !== 'none', rows: document.querySelectorAll('#om-ctw tbody tr').length, lab: document.getElementById('om-cselall').parentNode.textContent.trim() };
        });
        ok(st.sw <= 390 && st.winOver <= 0, '가로 넘침 0', st);
        ok(st.small.length === 0, '누름 칸 44px 이상(체크·×·쪽 단추·전부 고르기)', st.small);
        ok(st.of === '1 / 20' && !st.numsShown && st.rows === 50 && st.lab === '이 쪽 전체 선택', '폰 쪽 표시 「‹ 1 / 20 ›」 · 50줄 · 「이 쪽 전체 선택」', st);
        await pp.tap('.om-pg-b[data-pg="next"]');
        st = await pp.evaluate(() => ({ of: document.querySelector('.om-pg-of').textContent, sw: document.documentElement.scrollWidth }));
        ok(st.of === '2 / 20' && st.sw <= 390, '폰 다음 쪽 = 2 / 20 · 넘침 0', st);
        ok(perr.length === 0, '폰 스크립트 오류 0', perr);
        await pctx.close();

        // ── ③ 100줄 이하 = 종전과 픽셀 같음 ─────────────
        console.log('③ 무회귀 = 100줄·60줄 · 50장 이하 카드는 종전(HEAD) js 와 픽셀 같음(css 는 지금 것 · #909)');
        for (const [w, h, phone] of [[1280, 900, false], [390, 844, true]]) {
            for (const n of [60, 100]) {
                const shots = {};
                for (const v of ['old', 'new']) {
                    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone }); const p = await c.newPage();
                    await openMemo(p, v === 'old' ? 'mix' : v, n, 30, phone); await jusoQuiet(); await p.waitForTimeout(150);
                    const html = await p.evaluate(() => document.getElementById('om-ctw').innerHTML + '|' + document.getElementById('om-cselbar').outerHTML);
                    shots[v] = { png: await p.locator('.om-win').screenshot(), html, juso: S.juso, rows: await p.evaluate(() => document.querySelectorAll('#om-ctw tbody tr').length) };
                    await c.close();
                }
                ok(shots.old.png.equals(shots.new.png), `${w}폭 ${n}줄 = 화면 픽셀 동일`);
                ok(shots.old.html === shots.new.html && shots.new.rows === n && shots.old.juso === shots.new.juso, `${w}폭 ${n}줄 = 표 HTML 같음 · ${n}줄 전부 · 주소 검색 수 같음(${shots.new.juso})`, { rows: shots.new.rows, juso: [shots.old.juso, shots.new.juso] });
            }
        }
        // #909 보통 꼴(≥721 표) = 창 가로 넘침 0 · 체크·× 칸 높이 ≥36(손가락 화면 44) · PC 1280 60줄 · 폴드 펼침(880 · 손가락 · 덮개 창 꼴)
        for (const [w, h, coarse] of [[1280, 900, false], [880, 1000, true]]) {
            const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: coarse, isMobile: coarse }); const p = await c.newPage();
            await openMemo(p, 'new', 60, 30, coarse); await jusoQuiet();
            const st = await p.evaluate(() => { const win = document.querySelector('.om-win'), tw = document.querySelector('#om-ctw .om-prev-tw'), hs = [...document.querySelectorAll('#om-ctw tbody label.om-ck, #om-ctw tbody .om-x')].map(e => Math.round(e.getBoundingClientRect().height)); return { dense: document.querySelector('#om-ctw table').classList.contains('dense'), winOver: win.scrollWidth - win.clientWidth, twOver: tw.scrollWidth - tw.clientWidth, minH: Math.min(...hs), n: hs.length }; });
            const need = coarse ? 44 : 36;
            ok(!st.dense && st.winOver <= 0 && st.twOver <= 0, `${w}폭${coarse ? '(손가락)' : ''} 60줄 보통 꼴 = 창·표 가로 넘침 0`, st);
            ok(st.n === 120 && st.minH >= need, `${w}폭 60줄 체크·× 칸 높이 ≥${need}`, st);
            await c.close();
        }
        { const shots = {};
            for (const v of ['old', 'new']) {
                const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }); const p = await c.newPage();
                await openMemo(p, v === 'old' ? 'mix' : v, 5, 2); await p.click('.om-tag[data-tag="cash"]'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(200);
                shots[v] = await p.evaluate(() => { const k = document.getElementById('om-card').cloneNode(true); k.querySelectorAll('[data-fwrap$="-c1"]').forEach(e => e.remove()); return k.innerHTML; }).then(h => h.replace(/ fk-(?:ship|\d+)/g, '').replace(/om-grid cash(?:-more)?/g, 'om-grid').replaceAll(' <small>비우면 다음 발주</small>', '').replaceAll('placeholder="예) 10/30"', 'placeholder="비우면 다음 발주 · 예) 10/30"')); await c.close();   // #927 새 칸 「보내는 분 연락처」(c1)는 빼고 비교 · #911 카드 꼴을 일부러 바꿈 = 픽셀 대신 칸 HTML(자리 이름 fk-·cash 빼고)이 종전과 같은지
            }
            // #911 카드 꼴 = 넘침 0 · 수량 묶음 좁게 · 입력 칸 높이(폰 44)
            for (const [w, h, phone] of [[1280, 900, false], [390, 844, true]]) {
                const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone }); const p = await c.newPage();
                await openMemo(p, 'new', 12, 1, phone); await jusoQuiet(); await p.click('#om-ctw tbody tr:nth-child(2) .om-ct-open'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(200);
                const st = await p.evaluate(() => { const card = document.getElementById('om-card'), cr = card.getBoundingClientRect(), b = card.querySelector('.om-card-b'); const ins = [...card.querySelectorAll('input, textarea')].filter(e => e.offsetParent && e.type !== 'checkbox'); return { over: [...card.querySelectorAll('input, textarea, button')].filter(e => e.offsetParent && e.getBoundingClientRect().right > cr.right + 0.5).length, bodyX: b.scrollWidth - b.clientWidth, step: Math.round(card.querySelector('.om-step').getBoundingClientRect().width), minH: Math.min(...ins.map(e => Math.round(e.getBoundingClientRect().height))), scroll: b.scrollHeight - b.clientHeight }; });
                ok(st.over === 0 && st.bodyX <= 0, `${w}폭 메모 고치기 카드 = 가로 넘침 0`, st);
                ok(st.step <= (phone ? 180 : 160) && st.minH >= (phone ? 44 : 36), `${w}폭 수량 묶음 ≤${phone ? 180 : 160} · 입력 칸 높이 ≥${phone ? 44 : 36}`, st);
                if (phone) ok(st.scroll <= 0, '390폭 카드 본문 스크롤 0(저장 단추까지 한 화면)', st);
                await c.close();
            }
            ok(shots.old === shots.new, '빈 주문입력 카드(1줄) = 칸 HTML 종전과 같음(#911 자리 이름·발송일 안내 글 빼고)', (() => { let i = 0; while (i < shots.old.length && shots.old[i] === shots.new[i]) i++; return [shots.old.slice(i - 40, i + 80), shots.new.slice(i - 40, i + 80)]; })()); }   // 다르면 처음 어긋난 곳 앞뒤 글을 보여 줌
        // #927 「보내는 분 연락처」(B) 칸 = 「보내는이 변경」 묶음 안 · B=K 면 빈 칸(안내 글) · B≠K 면 값 보이고 묶음 열림 · 저장 때 빈 칸 = '' · 세 폭 넘침 0 + PNG
        { S.tel = true; const outDir = process.env.PNG927 || require('os').tmpdir();
            for (const [w, h, phone] of [[1280, 900, false], [900, 900, true], [390, 844, true]]) {
                const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone && w < 721 }); const p = await c.newPage();
                const pe = []; p.on('pageerror', e => pe.push(String(e)));
                await openMemo(p, 'new', 4, 1, w < 721); await jusoQuiet();
                const openRow = async nm => { if (await p.evaluate(() => !document.getElementById('om-card').hidden)) { await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100); } await p.locator('#om-ctw tbody tr', { hasText: nm }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(150); };
                const read = () => p.evaluate(() => { const i = document.getElementById('om-f-0-c1'), d = document.querySelector('#om-card details.om-more'); return { v: i && i.value, ph: i && i.placeholder, tel: i && i.getAttribute('inputmode'), open: d && d.open, inMore: !!(i && i.closest('details.om-more')), order: [...document.querySelectorAll('#om-card .cash-more > .om-f label')].map(l => l.firstChild.textContent.trim()) }; });
                await openRow('손님0001'); const a = await read();
                ok(a.v === '' && /비우면 구매자 번호/.test(a.ph) && a.tel === 'tel' && a.open === false && a.inMore && a.order.join('|') === '보내는 분(선물)|보내는 분 연락처|보내는 분 주소', w + '폭 B=K 줄 = 보내는 분 연락처 빈 칸(「비우면 구매자 연락처」) · 묶음 닫힘 · 이름 다음·주소 앞', a);
                await p.click('#om-card details.om-more summary'); await p.locator('#om-card details.om-more').screenshot({ path: path.join(outDir, '927-' + w + '-empty.png') });   // 빈 칸 안내 글 눈 확인
                await openRow('손님0002'); const b = await read();
                ok(b.v === '010-7777-8888' && b.open === true, w + '폭 B≠K 줄 = 번호 보임 · 「보내는이 변경」 묶음 저절로 열림', b);
                const st = await p.evaluate(() => { const card = document.getElementById('om-card'), cr = card.getBoundingClientRect(), b = card.querySelector('.om-card-b'), m = card.querySelector('.cash-more'); return { over: [...card.querySelectorAll('input, textarea, button')].filter(e => e.offsetParent && e.getBoundingClientRect().right > cr.right + 0.5).length, bodyX: b.scrollWidth - b.clientWidth, moreX: m.scrollWidth - m.clientWidth, telW: Math.round(document.getElementById('om-f-0-c1').getBoundingClientRect().width) }; });
                ok(st.over === 0 && st.bodyX <= 0 && st.moreX <= 0, w + '폭 「보내는이 변경」 묶음 가로 넘침 0', st);
                await p.locator('#om-card details.om-more').scrollIntoViewIfNeeded(); await p.locator('#om-card .om-rowcard').first().screenshot({ path: path.join(outDir, '927-' + w + '.png') });
                if (w === 1280) {   // 고쳐 저장 = 칸 값 그대로 · 빈 칸은 ''(서버가 K 로 채움)
                    S.puts = []; await p.fill('#om-f-0-c1', ''); await p.click('#om-card-save'); await until(() => S.puts.length);
                    ok(S.puts[0] && S.puts[0].cells && S.puts[0].cells[1] === '' && S.puts[0].cells[10] === '010-1111-2222', '1280폭 B 비우고 저장 = cells[1] \'\' · K 그대로', S.puts[0] && S.puts[0].cells); await until(() => p.evaluate(() => document.getElementById('om-card').hidden)); await p.waitForTimeout(150);
                    await openRow('손님0001'); S.puts = []; await p.click('#om-card details.om-more summary'); await p.fill('#om-f-0-c1', '01099998888'); await p.locator('#om-f-0-c1').blur();
                    const tv = await p.inputValue('#om-f-0-c1'); await p.click('#om-card-save'); await until(() => S.puts.length);
                    ok(tv === '010-9999-8888' && S.puts[0] && S.puts[0].cells[1] === '010-9999-8888', '1280폭 B 새로 넣음 = 하이픈 꼴 · 저장 cells[1] 그 번호', { tv, cells: S.puts[0] && S.puts[0].cells });
                }
                ok(pe.length === 0, w + '폭 #927 스크립트 오류 0', pe);
                await c.close();
            }
            info('#927 PNG', outDir + '/927-{1280,900,390}.png'); S.tel = false; }
        // 「주소 확인 필요 n줄」 단추(#880-b) = 종전과 같은 글·보임 · 그 줄들을 지워 n=0 이 되면 단추 사라지고 「그 줄만 보기」도 풀림(워커2 점검 #900-2B 막을 것 1)
        { const st2 = {}; S.multi = true;
            for (const v of ['old', 'new']) {
                const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }); const p = await c.newPage();
                const pe = []; p.on('pageerror', e => pe.push(String(e)));
                await openMemo(p, v === 'old' ? 'mix' : v, 60, 30); await jusoQuiet(); await p.waitForTimeout(150);
                const b0 = await p.evaluate(() => { const b = document.getElementById('om-cneed'); return { hidden: b.hidden, text: b.textContent, png: null }; });
                const png = await p.locator('.om-win').screenshot();
                await p.click('#om-cneed'); await p.waitForTimeout(150);
                if (await p.evaluate(() => !document.getElementById('om-card').hidden)) { await p.keyboard.press('Escape'); await p.waitForTimeout(100); }   // 이어서 확인 카드 닫음
                const b1 = await p.evaluate(() => ({ text: document.getElementById('om-cneed').textContent, rows: document.querySelectorAll('#om-ctw tbody tr').length }));
                await p.check('#om-cselall2'); await p.click('#om-del'); await p.click('#om-ask-yes');
                await until(() => p.evaluate(() => document.querySelectorAll('#om-ctw tbody tr').length === 50));
                const b2 = await p.evaluate(() => { const b = document.getElementById('om-cneed'); return { hidden: b.hidden, text: b.textContent, pressed: b.getAttribute('aria-pressed'), rows: document.querySelectorAll('#om-ctw tbody tr').length }; });
                st2[v] = { b0, b1, b2, png, pe }; await c.close();
            }
            S.multi = false;
            ok(!st2.new.b0.hidden && st2.new.b0.text === '주소 확인 필요 10줄' && JSON.stringify(st2.old.b0) === JSON.stringify(st2.new.b0) && st2.old.png.equals(st2.new.png), '주소 확인 필요 10줄 단추 = 종전과 같은 글·보임 · 화면 픽셀 동일', { old: st2.old.b0, new: st2.new.b0 });
            ok(st2.new.b1.rows === 10 && /10줄만 보는 중/.test(st2.new.b1.text) && JSON.stringify(st2.old.b1) === JSON.stringify(st2.new.b1), '누르면 그 10줄만 보기(종전과 같음)', { old: st2.old.b1, new: st2.new.b1 });
            ok(st2.new.b2.hidden && st2.new.b2.pressed === 'false' && st2.new.b2.rows === 50 && JSON.stringify(st2.old.b2) === JSON.stringify(st2.new.b2), '그 10줄 지워 n=0 = 단추 사라짐 · 보기 풀림 · 남은 50줄(종전과 같음)', { old: st2.old.b2, new: st2.new.b2 });
            ok(!st2.old.pe.length && !st2.new.pe.length, '주소 확인 흐름 스크립트 오류 0', st2.new.pe); }

        // ── ④ 파일 1,500줄 카드 ─────────────────────────
        console.log('④ 주문입력 파일 1,600줄 → 1,500줄 · 카드 50장씩 · 빈칸 먼저 · 첫 빈칸으로');
        const H = ['보내는사람', '보내는사람연락처', '출고지', '수취인명', '옵션정보', '수량', '수취인연락처1', '수취인연락처2', '배송지', '배송메세지', '구매자연락처', '박스타입(입력x)', '보내는이 변경주소'];
        const aoa = [H]; for (let i = 0; i < 1600; i++) { const k = String(i + 1).padStart(4, '0'); aoa.push(['', '', '', '파일' + k, i % 10 === 9 ? '없는품목 9kg' : CAT[i % 3], '1', '010-66' + k.slice(0, 2) + '-' + k, '', '제주시 노형동 ' + (i + 1), '', '', '', '']); }
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
        const fp = path.join(require('os').tmpdir(), 'verify-900-2b-1600.xlsx'); XLSX.writeFile(wb, fp);
        for (const [w, h, phone] of [[1280, 900, false], [390, 844, true]]) {
            const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone }); const p = await c.newPage();
            const ce = []; p.on('pageerror', e => ce.push(String(e)));
            await openMemo(p, 'new', 3, 1); await p.click('.om-tag[data-tag="cash"]'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard');
            await p.fill('#om-f-0-c3', '손님수기'); await p.fill('#om-f-0-c6', '010-7777-0001'); await p.fill('#om-f-0-c8', '제주시 수기로 1'); await p.fill('#om-f-0-c5', '2');   // 손으로 먼저 넣은 줄(품목 빈칸 = 빈칸 줄) = 파일 정렬에 안 섞이고 맨 앞 그대로
            await p.click('body', { position: { x: 2, y: 2 } }).catch(() => {});
            const t0 = Date.now(); await p.setInputFiles('#om-file', fp);
            await until(() => p.evaluate(() => /넣었어요/.test((document.getElementById('om-file-n') || {}).textContent || '')));
            const tLoad = Date.now() - t0;
            st = await p.evaluate(() => ({ note: document.getElementById('om-file-n').textContent, cards: document.querySelectorAll('#om-card .om-rowcard').length, more: (document.querySelector('[data-cact="morerows"]') || {}).textContent, jump: (document.getElementById('om-jump-t') || {}).textContent, jb: (document.querySelector('[data-cact="jumpblank"]') || {}).textContent, firstBlank: !!document.querySelector('#om-card .om-rowcard .om-f.blank'), h50: (document.querySelectorAll('#om-card .om-rowcard h4')[49] || {}).textContent, sw: document.documentElement.scrollWidth }));
            info(`${w}폭 파일 읽고 카드 그림(ms)`, tLoad);
            ok(/1499줄을 넣었어요/.test(st.note) && /1500줄이 넘어 101줄은 못 넣었어요/.test(st.note), `${w}폭 손 1줄 + 1,600줄 파일 = 합쳐 1,500줄(파일 1,499) · 101줄 못 넣음 안내`, st.note);
            const hand = await p.evaluate(() => [0, 1].map(i => (document.getElementById('om-f-' + i + '-c3') || {}).value));
            ok(hand[0] === '손님수기' && hand[1] === '파일0010', `${w}폭 손으로 넣은 줄 = 맨 앞 자리 그대로 · 그 뒤 = 파일 빈칸 줄 먼저(파일0010)`, hand);
            ok(st.cards === 50 && /^줄 50개 더 보기/.test(st.more) && /50 \/ 1,500줄/.test(st.more), `${w}폭 카드 50장 · 「줄 50개 더 보기 50 / 1,500줄」`, st);
            ok(/^빈칸 있는 줄 150개/.test(st.jump) && st.jb === '빈칸 150줄 → 첫 빈칸으로' && st.firstBlank, `${w}폭 빈칸 줄 150개 앞으로 · 「빈칸 150줄 → 첫 빈칸으로」`, st);
            ok(st.sw <= w, `${w}폭 가로 넘침 0`, st.sw);
            await p.click('[data-cact="morerows"]');
            st = await p.evaluate(() => ({ cards: document.querySelectorAll('#om-card .om-rowcard').length, foc: document.activeElement && document.activeElement.id, more: (document.querySelector('[data-cact="morerows"]') || {}).textContent }));
            ok(st.cards === 100 && /^om-f-50-/.test(st.foc || '') && /100 \/ 1,500줄/.test(st.more), `${w}폭 더 보기 = 100장 · 초점 = 51번째 줄 첫 칸`, st);
            // 빈칸 고치기 → 숫자 줄어듦 · 첫 빈칸으로 = 그 다음 빈 줄
            await p.click('[data-cact="jumpblank"]');
            st = await p.evaluate(() => { const a = document.activeElement; return { id: a && a.id, blank: !!(a && a.closest('.om-f.blank')) }; });
            ok(st.id === 'om-f-0-c4' || (st.blank && /^om-f-0-/.test(st.id || '')), `${w}폭 첫 빈칸으로 = 1번째 줄 빈 칸에 초점`, st);
            if (phone) { const sm = await p.evaluate(() => [...document.querySelectorAll('[data-cact="jumpblank"], [data-cact="morerows"]')].map(b => Math.round(b.getBoundingClientRect().height))); ok(sm.every(x => x >= 44), '폰 「첫 빈칸으로」·「더 보기」 44px 이상', sm); }
            ok(ce.length === 0, `${w}폭 스크립트 오류 0`, ce);
            await c.close();
        }
        // ── ⑤ #934 추가 매칭(번호 다른 현금 줄) · ④ 메모함 입력삭제 줄 단추 · ⑤ 현금 줄 → 입력삭제 주문에 붙이기 ──
        console.log('⑤ #934 추가 매칭 · 메모함 입력삭제 줄 단추 · 현금 줄 → 입력삭제 주문에 붙이기');
        { S.px = true; const PXD = PXK.replace(/\D/g, '');
            S.preview = { ok: true, rows: [{ kind: 'line', key: PXK, note: '입력o삭제x', plat: '네이버', line: ['', PXK, '입력o삭제x', '네이버'].join('\t'), sure: true, check_why: [] }] };
            const openPx = async (p, v) => { await openMemo(p, v, 4, 1); S.pairs = []; S.saves = []; await p.evaluate(t => window.AkmOrderMemo.fromText(t), PXK + ' 입력o삭제x 네이버'); await p.waitForSelector('#om-card:not([hidden]) .om-pair'); await p.waitForTimeout(150); };
            const pairsHtml = () => [...document.querySelectorAll('#om-card .om-pair')].map(e => e.outerHTML).join('|');
            let oldHtml;
            { const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); await openPx(p, 'mix'); oldHtml = await p.evaluate(pairsHtml); await c.close(); }
            const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); const pe = []; p.on('pageerror', e => pe.push(String(e)));
            await openPx(p, 'new');
            let st = await p.evaluate(() => { const ps = [...document.querySelectorAll('#om-card .om-pair')]; return { n: ps.length, b: (ps[0].querySelector('b') || {}).textContent, btns: [...ps[0].querySelectorAll('.om-acts button')].map(b => b.dataset.cact + ':' + b.textContent.trim()) }; });
            ok(st.n === 1 && st.b === '메모함에 이 번호(010-3292-0535) 현금 줄 2개가 있어요 · 입력삭제 주소 줄로 바꿀까요?' && st.btns.join() === 'p2yes:바꾸기,p2no:현금 그대로,pxopen:추가 매칭', '② 실사례 = 같은 번호 현금 줄 2개 묻기 + 세 번째 단추 [추가 매칭]', st);
            const strip934 = h => h.replace(/<button type="button" class="om-btn sm" data-cact="pxopen"[^>]*>추가 매칭<\/button>/g, '').replace(/<p class="om-pair-s">체크한 줄은 저장하면[^<]*<\/p>/g, ''); const newHtml = await p.evaluate(pairsHtml), stripped = strip934(newHtml); oldHtml = strip934(oldHtml);   // HEAD 에도 #934 단추가 있을 수 있어 양쪽 다 뺌
            ok(stripped === oldHtml && stripped !== newHtml, '② 카드 = [추가 매칭] 단추·안내 한 줄만 빼면 종전(HEAD) HTML 바이트 동일([바꾸기]/[현금 그대로] 글자·자리 그대로)', (() => { let i = 0; while (i < oldHtml.length && oldHtml[i] === stripped[i]) i++; return [oldHtml.slice(i - 40, i + 80), stripped.slice(i - 40, i + 80)]; })());
            await p.click('[data-cact="pxopen"]');
            st = await p.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'); return { has: !!x, items: x ? [...x.querySelectorAll('.om-pair-l li span')].map(s => s.textContent) : [], go: x && x.querySelector('[data-cact="pxgo"]').disabled, foc: document.activeElement && document.activeElement.id, head: x && x.querySelector('.om-pair-n').textContent }; });
            ok(st.has && st.items.length === 2 && /김보은.*구매자 …4217/.test(st.items[0]) && /최수아.*2박스.*구매자 …1234/.test(st.items[1]) && st.go && st.foc === 'om-px-q-' + PXD && st.head === '2줄 중 0줄 · 0박스', '[추가 매칭] = 번호 다른 짝 없는 현금 줄 2개(같은 번호 2줄·주소 줄·서비스 줄 제외) · 기본 체크 0 · 단추 잠김 · 초점 = 찾기 칸', st);
            await p.type('#om-px-q-' + PXD, '4217');
            st = await p.evaluate(() => ({ items: [...document.querySelectorAll('#om-card .om-pairx .om-pair-l li span')].map(s => s.textContent), foc: document.activeElement && document.activeElement.id, v: document.activeElement && document.activeElement.value }));
            ok(st.items.length === 1 && /김보은/.test(st.items[0]) && st.foc === 'om-px-q-' + PXD && st.v === '4217', '찾기 「4217」(끝 4자리) = 1줄 · 치는 중 초점·글자 그대로(칸 안 다시 그림)', st);
            await p.fill('#om-px-q-' + PXD, '최수아'); st = await p.evaluate(() => [...document.querySelectorAll('#om-card .om-pairx .om-pair-l li span')].map(s => s.textContent));
            ok(st.length === 1 && /최수아/.test(st[0]), '찾기 「최수아」(이름) = 1줄', st);
            await p.fill('#om-px-q-' + PXD, ''); await p.check('#om-card .om-pairx input[data-v="193"]');
            st = await p.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'); return { head: x.querySelector('.om-pair-n').textContent, go: x.querySelector('[data-cact="pxgo"]').disabled, lab: x.querySelector('[data-cact="pxgo"]').textContent.replace(/\s+/g, ' ').trim(), foc: document.activeElement && document.activeElement.dataset.v }; });
            ok(st.head === '2줄 중 1줄 · 1박스' && !st.go && st.lab === '이 줄도 주소 줄로 1줄' && st.foc === '193', '한 줄 체크 = 「2줄 중 1줄 · 1박스」 · [이 줄도 주소 줄로 1줄] 풀림 · 초점 그 칸', st);
            await p.click('[data-cact="pxgo"]');
            st = await p.evaluate(() => { const ps = [...document.querySelectorAll('#om-card .om-pair')]; return { n: ps.length, ok: ps.map(e => (e.querySelector('b') || {}).textContent), btns: ps.map(e => [...e.querySelectorAll('.om-acts button')].map(b => b.dataset.cact).join()), toast: (window.__toasts || []).slice(-1)[0] }; });
            ok(st.n === 2 && st.ok[1] === '저장하면 번호가 다른 현금 줄 1개도 입력삭제 010-3292-0535 주소 줄로 바꿔요' && st.btns[1] === 'pxundo,pxopen' && st.btns[0] === 'p2yes,p2no,pxopen' && /1줄을 더 골랐어요/.test(st.toast || ''), '[이 줄도 주소 줄로] = 「저장하면 … 1개도 … 바꿔요」 + [안 바꿀래요]/[더 고르기] · ② 묻기는 그대로', st);
            await p.click('[data-cact="p2yes"]'); await p.click('#om-card-save');
            await until(() => S.pairs.length >= 2); await p.waitForTimeout(250);
            st = await p.evaluate(() => ({ undo: !document.getElementById('om-undo').hidden, t: document.getElementById('om-undo-t').textContent, card: document.getElementById('om-card').hidden }));
            ok(S.saves.length === 1 && S.saves[0].rows.length === 1 && S.saves[0].rows[0].kind === 'line', '저장 = POST /api/order-memo 1회(입력삭제 줄 1)', S.saves[0] && S.saves[0].rows);
            ok(S.pairs.length === 2 && JSON.stringify(S.pairs[0]) === JSON.stringify({ key: PXK, ids: [191, 192] }) && JSON.stringify(S.pairs[1]) === JSON.stringify({ key: PXK, ids: [193], pick: true }), '저장 뒤 POST pair 2회 = ② {key, ids 191·192}(종전 꼴 · pick 없음) → 추가 매칭 {key, ids 193, pick:true}(번호 다른 줄)', S.pairs);
            ok(st.card && st.undo && st.t === '현금 줄 3개를 입력삭제 주소 줄로 바꿨어요', '되돌리기 띠 「현금 줄 3개를 …」(2+1) · 카드 닫힘', st);
            // #934-b(총괄 결정) ② 체크 그대로 [저장] = 바꾸기 · [현금 그대로] = 0 · 추가 매칭 체크만(단추 안 누름) = pick POST
            await openPx(p, 'new'); await p.click('#om-card-save'); await until(() => S.pairs.length); await p.waitForTimeout(250);
            st = await p.evaluate(() => ({ undo: !document.getElementById('om-undo').hidden, t: document.getElementById('om-undo-t').textContent }));
            ok(S.pairs.length === 1 && JSON.stringify(S.pairs[0]) === JSON.stringify({ key: PXK, ids: [191, 192] }) && st.undo && st.t === '현금 줄 2개를 입력삭제 주소 줄로 바꿨어요', '② 체크 그대로 [바꾸기] 없이 [저장] = POST pair ids 191·192 + 되돌리기 띠(12:00 실사례 구멍 막음)', { pairs: S.pairs, st });
            await openPx(p, 'new'); await p.click('[data-cact="p2no"]'); await p.click('#om-card-save'); await until(() => S.saves.length); await p.waitForTimeout(400);
            ok(S.saves.length === 1 && S.pairs.length === 0, '② [현금 그대로] 뒤 [저장] = POST pair 0(종전)', { pairs: S.pairs });
            await openPx(p, 'new'); await p.click('[data-cact="pxopen"]'); await p.check('#om-card .om-pairx input[data-v="193"]'); await p.click('#om-card-save'); await until(() => S.pairs.length >= 2); await p.waitForTimeout(250);
            ok(S.pairs.length === 2 && JSON.stringify(S.pairs[1]) === JSON.stringify({ key: PXK, ids: [193], pick: true }), '추가 매칭 판에서 체크만 하고(단추 안 누름) [저장] = ② 2줄 뒤 POST pair {ids 193, pick}', S.pairs);
            // 워커2 점검 4 = [안 바꿀래요] 뒤 저장 0 · 안 그린 번호 건너뜀 · [더 고르기] 판 열림 · (④ 닫기 뒤 저장 = 아래 ④ 절)
            await openPx(p, 'new'); await p.click('[data-cact="p2yes"]'); await p.click('[data-cact="p2undo"]');
            st = await p.evaluate(() => ({ on: document.querySelectorAll('#om-card .om-pair input[data-cact="chk"]:checked').length, n: document.querySelectorAll('#om-card .om-pair input[data-cact="chk"]').length, yes: !!document.querySelector('#om-card [data-cact="p2yes"]') }));
            await p.click('#om-card-save'); await until(() => S.saves.length); await p.waitForTimeout(400);
            ok(st.n === 2 && st.on === 0 && st.yes && S.pairs.length === 0, '[바꾸기] → [안 바꿀래요] = 체크 다 풀림(다시 고를 수 있음) → [저장] = POST pair 0', { st, pairs: S.pairs });
            S.pxHide = true; await openPx(p, 'new'); S.pxHide = false;   // 카드 그릴 때는 같은 번호 줄 0(② 안 그림) → 저장 직전 목록에 191·192 생김
            st = await p.evaluate(() => ({ p2: !!document.querySelector('#om-card [data-cact="p2yes"]') }));
            await p.click('#om-card-save'); await until(() => S.saves.length); await p.waitForTimeout(400);
            ok(!st.p2 && S.saves.length === 1 && S.pairs.length === 0, '② 체크 목록을 안 그린 번호(저장 전 목록 바뀜) = 「전부」로 안 보냄 · POST pair 0', { st, pairs: S.pairs });
            await openPx(p, 'new'); await p.click('[data-cact="pxopen"]'); await p.check('#om-card .om-pairx input[data-v="193"]'); await p.click('[data-cact="pxgo"]'); await p.waitForSelector('#om-card .om-pair.ok [data-cact="pxopen"]'); await p.click('#om-card .om-pair.ok [data-cact="pxopen"]');
            st = await p.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'); return { open: !!x, on: x ? [...x.querySelectorAll('input[data-cact="pxchk"]:checked')].map(i => i.dataset.v) : [] }; });
            ok(st.open && st.on.join() === '193', '[더 고르기] = 판 다시 열림 · 고른 193 체크 그대로', st);
            // ④ 메모함 입력삭제 줄 [추가 매칭] — 실사례 뒤 상태(입력삭제 줄 195 저장됨 · 같은 번호 현금 191·192 + 번호 다른 193 아직 현금 · 대표가 [바꾸기] 없이 저장)
            S.px2 = true; await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 2));
            st = await p.evaluate(() => ({ n: document.querySelectorAll('#om-list .om-ml-px').length, li: document.querySelectorAll('#om-list .om-ml').length, t: (document.querySelector('#om-list .om-ml-px') || {}).textContent }));
            ok(st.n === 2 && st.li === 2 && st.t === '추가 매칭', '④ 메모함 입력삭제 줄 2개마다 [추가 매칭] 단추', st);
            S.pairs = []; await p.locator('#om-list .om-ml', { hasText: PXK }).locator('.om-ml-px').click(); await p.waitForSelector('#om-card:not([hidden]) .om-pairx');
            st = await p.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'); return { b: x.querySelector('b').textContent, items: [...x.querySelectorAll('.om-pair-l li span')].map(s => s.textContent), on: [...x.querySelectorAll('input[data-cact="pxchk"]:checked')].map(i => i.dataset.v), head: x.querySelector('.om-pair-n').textContent, lab: x.querySelector('[data-cact="pxgo"]').textContent.replace(/\s+/g, ' ').trim() }; });
            ok(st.b === '입력삭제 010-3292-0535 주소 줄로 바꿀 현금 줄을 고르세요' && st.items.length === 4 && /^이하정 .*같은 번호$/.test(st.items[0]) && /^이승비 .*같은 번호$/.test(st.items[1]) && /^김보은 .*구매자 …4217$/.test(st.items[2]) && st.on.join() === '191,192' && st.head === '4줄 중 2줄 · 2박스' && st.lab === '이 줄도 주소 줄로 2줄', '④ 실사례 줄(3292) = 같은 번호 2줄 앞에 「같은 번호」·미리 체크 + 번호 다른 2줄 · 「4줄 중 2줄 · 2박스」', st);
            await p.check('#om-card .om-pairx input[data-v="193"]'); await p.click('[data-cact="pxgo"]'); await until(() => S.pairs.length); await p.waitForTimeout(250);
            st = await p.evaluate(() => ({ t: document.getElementById('om-undo-t').textContent, undo: !document.getElementById('om-undo').hidden }));
            ok(JSON.stringify(S.pairs[0]) === JSON.stringify({ key: PXK, ids: [191, 192, 193], pick: true }) && st.undo && st.t === '현금 줄 3개를 입력삭제 010-3292-0535 주소 줄로 바꿨어요', '④ 실사례 = 셋째 줄 체크해 [이 줄도 주소 줄로] → POST pair {key 3292, ids 191·192·193, pick} 바로(저장 없이) · 되돌리기 띠', { pairs: S.pairs, st });
            await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100);
            S.pairs = []; await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-px').click(); await p.waitForSelector('#om-card:not([hidden]) .om-pairx');
            st = await p.evaluate(() => ({ title: document.getElementById('om-card-t').textContent.trim(), b: document.querySelector('#om-card .om-pairx b').textContent, items: [...document.querySelectorAll('#om-card .om-pairx .om-pair-l li span')].map(s => s.textContent.split(' · ')[0]) }));
            ok(/메모 고치기/.test(st.title) && st.b === '입력삭제 010-5738-4123 주소 줄로 바꿀 현금 줄을 고르세요' && st.items.join() === '이하정,이승비,김보은,최수아', '④ 누르면 고치기 카드 + 추가 매칭 판 바로 열림 · 짝 없는 현금 줄 4개(주소 줄·서비스 줄 제외 · 같은 번호 줄 0 = 체크 0)', st);
            await p.check('#om-card .om-pairx input[data-v="203"]'); await p.click('[data-cact="pxgo"]'); await until(() => S.pairs.length); await p.waitForTimeout(250);
            st = await p.evaluate(() => ({ undo: !document.getElementById('om-undo').hidden, t: document.getElementById('om-undo-t').textContent, px: !!document.querySelector('#om-card .om-pairx'), btn: !!document.querySelector('#om-card [data-cact="pxopen"]'), card: document.getElementById('om-card').hidden }));
            ok(JSON.stringify(S.pairs[0]) === JSON.stringify({ key: PXL, ids: [203], pick: true }) && st.undo && st.t === '현금 줄 1개를 입력삭제 010-5738-4123 주소 줄로 바꿨어요' && !st.px && st.btn && !st.card, '④ [이 줄도 주소 줄로] = 저장 없이 바로 POST pair {key 5738, ids 203, pick} · 되돌리기 띠 · 판 닫히고 단추 남음', { pairs: S.pairs, st });
            await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100);
            // #934-b ④ 판에서 체크한 뒤 [고친 대로 저장] = PUT 1 + POST pair(체크 줄) · 체크 0 = PUT 만(대표 12:48 실사례)
            S.pairs = []; S.puts = []; await p.locator('#om-list .om-ml', { hasText: PXK }).locator('.om-ml-px').click(); await p.waitForSelector('#om-card:not([hidden]) .om-pairx');
            await until(() => p.evaluate(() => !/번호 확인 중/.test(document.getElementById('om-card-save').textContent))); st = await p.evaluate(() => document.getElementById('om-card-save').textContent.replace(/\s+/g, ' ').trim());
            ok(st === '고친 대로 저장 + 2줄 짝짓기', '#934-b ④ 같은 번호 2줄 미리 체크 = 저장 단추 「고친 대로 저장 + 2줄 짝짓기」', st);
            await p.click('#om-card-save'); await until(() => S.pairs.length && S.puts.length); await p.waitForTimeout(250);
            st = await p.evaluate(() => ({ card: document.getElementById('om-card').hidden, undo: !document.getElementById('om-undo').hidden, t: document.getElementById('om-undo-t').textContent }));
            ok(S.puts.length === 1 && S.pairs.length === 1 && JSON.stringify(S.pairs[0]) === JSON.stringify({ key: PXK, ids: [191, 192], pick: true }) && st.card && st.undo && st.t === '현금 줄 2개를 입력삭제 010-3292-0535 주소 줄로 바꿨어요', '#934-b [고친 대로 저장] = PUT 1 → POST pair {key 3292, ids 191·192, pick} · 카드 닫힘 · 되돌리기 띠', { puts: S.puts.length, pairs: S.pairs, st });
            S.pairs = []; S.puts = []; await p.locator('#om-list .om-ml', { hasText: PXK }).locator('.om-ml-px').click(); await p.waitForSelector('#om-card:not([hidden]) .om-pairx'); await p.click('[data-cact="pxclose"]'); await p.waitForTimeout(100);
            await until(() => p.evaluate(() => !/번호 확인 중/.test(document.getElementById('om-card-save').textContent))); const lab2 = await p.evaluate(() => document.getElementById('om-card-save').textContent.replace(/\s+/g, ' ').trim());
            await p.click('#om-card-save'); await until(() => S.puts.length); await p.waitForTimeout(250);
            ok(lab2 === '고친 대로 저장' && S.puts.length === 1 && S.pairs.length === 0, '④ 미리 체크 2 → 판 [닫기] → 단추 「고친 대로 저장」 · PUT 만 · POST pair 0', { lab2, puts: S.puts.length, pairs: S.pairs });
            S.pairs = []; S.puts = []; await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-px').click(); await p.waitForSelector('#om-card:not([hidden]) .om-pairx');
            await until(() => p.evaluate(() => !/번호 확인 중/.test(document.getElementById('om-card-save').textContent))); st = await p.evaluate(() => document.getElementById('om-card-save').textContent.replace(/\s+/g, ' ').trim());
            await p.click('#om-card-save'); await until(() => S.puts.length); await p.waitForTimeout(250);
            ok(st === '고친 대로 저장' && S.puts.length === 1 && S.pairs.length === 0, '#934-b 체크 0 = 단추 「고친 대로 저장」 · PUT 만 · POST pair 0(종전)', { st, puts: S.puts.length, pairs: S.pairs });
            // ⑤ 현금 줄 고치기 카드 → [입력삭제 주문에 붙이기]
            S.pairs = []; await p.locator('#om-ctw tbody tr', { hasText: '김보은' }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(150);
            st = await p.evaluate(() => { const b = document.querySelector('#om-card [data-cact="pyopen"]'); return { has: !!b, t: b && b.textContent.trim(), b: b && b.closest('.om-pair').querySelector('b').textContent }; });
            ok(st.has && st.t === '입력삭제 주문에 붙이기' && st.b === '이 현금 줄이 입력삭제 주문의 주소 줄이면 그 주문에 붙일 수 있어요', '⑤ 현금 줄 고치기 카드 = [입력삭제 주문에 붙이기] 단추', st);
            await p.click('[data-cact="pyopen"]');
            st = await p.evaluate(() => { const y = document.querySelector('#om-card .om-pairy'); return { has: !!y, items: y ? [...y.querySelectorAll('.om-pair-l li span')].map(s => s.textContent) : [], go: y && y.querySelector('[data-cact="pygo"]').disabled, foc: document.activeElement && document.activeElement.dataset.cact }; });
            ok(st.has && st.items.length === 2 && /^010-3292-0535 · 입력o삭제x · \d+\/\d+ \d\d:\d\d 저장 · 주소 줄 없음$/.test(st.items[0]) && /^010-5738-4123 · 입력o삭제x · \d+\/\d+ \d\d:\d\d 저장 · 주소 줄 1줄\(1박스\)$/.test(st.items[1]) && st.go && st.foc === 'pypick', '⑤ 열린 입력삭제 줄 목록 = 2(오늘 3292 「주소 줄 없음」 먼저 · 어제 5738 「주소 줄 1줄(1박스)」 · 날짜·번호 무관) · 고르기 전 단추 잠김', st);
            await p.check('#om-card .om-pairy input[data-cact="pypick"][data-k="' + PXL.replace(/\D/g, '') + '"]');
            st = await p.evaluate(() => document.querySelector('#om-card [data-cact="pygo"]').disabled);
            ok(st === false, '⑤ 하나 고르면 [이 주문에 붙이기] 풀림');
            await p.click('[data-cact="pygo"]'); await until(() => S.pairs.length); await p.waitForTimeout(250);
            st = await p.evaluate(() => ({ card: document.getElementById('om-card').hidden, undo: !document.getElementById('om-undo').hidden, t: document.getElementById('om-undo-t').textContent }));
            ok(JSON.stringify(S.pairs[0]) === JSON.stringify({ key: PXL, ids: [193], pick: true }) && st.card && st.undo && st.t === '이 현금 줄을 입력삭제 010-5738-4123 주소 줄로 바꿨어요', '⑤ = POST pair {key 그 입력삭제 번호, ids [이 줄], pick:true} · 카드 닫힘 · 되돌리기 띠', { pairs: S.pairs, st });
            // 2) 고친 글이 있으면 [이 주문에 붙이기] 안 보냄
            S.pairs = []; await p.locator('#om-ctw tbody tr', { hasText: '김보은' }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) [data-cact="pyopen"]'); await p.fill('#om-f-0-c9', '문 앞'); await p.click('[data-cact="pyopen"]'); await p.check('#om-card .om-pairy input[data-cact="pypick"][data-k="' + PXL.replace(/\D/g, '') + '"]'); await p.click('[data-cact="pygo"]'); await p.waitForTimeout(300);
            st = await p.evaluate(() => ({ toast: (window.__toasts || []).slice(-1)[0], card: document.getElementById('om-card').hidden, go: (document.querySelector('#om-card [data-cact="pygo"]') || {}).disabled }));
            ok(S.pairs.length === 0 && /같이 붙여요/.test(st.toast || '') && !st.card && st.go === false, '⑤ 카드 칸을 고친 뒤 [이 주문에 붙이기] = 「[고친 대로 저장]을 누르면 같이 붙여요」 토스트 · POST 0 · 카드 그대로', { pairs: S.pairs, st });
            await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100); if (await p.evaluate(() => !document.getElementById('om-card').hidden)) { await p.click('#om-card [data-cact="discard"]'); await p.waitForTimeout(100); }
            // 1) 서버 pairCash pick 길(순수 · order-memo.js 그대로 · DB 0)
            { const OMS = require(path.join(ROOT, 'order-memo.js')), ctx = { today: '2026-11-01', catalog: new Set(CAT), origin: '제주시 연삼로 1066-31' }, LINE = { line_key: PXK, ship_date: null };
                const mk = cells => Object.assign({ kind: 'cash' }, OMS.checkRow({ kind: 'cash', cells, src: 'edit' }, ctx)), cellsOf = (B, recv, K) => ['이형주 드림!', B, '제주시 연삼로 1066-31', '김보은', CAT[1], '1', recv, '', '충남 보령시 동대동 8', '', K, '', ''];
                const a = OMS.pairCash(mk(cellsOf(PXO, '010-4787-4217', PXO)), LINE, ctx, { anyNumber: true });
                ok(a && a.cells[1] === PXO && a.cells[10] === PXK && a.indiv && !/!/.test(a.cells[0]), '서버 pick 길 = B=K(다른 손님 번호 9511)≠받는 분 4217 → 보내는 분 번호 B 유지 · 구매자 K 만 입력삭제 번호 · ! 뗌', a && a.cells);
                const b = OMS.pairCash(mk(cellsOf('010-4787-4217', '010-4787-4217', '010-4787-4217')), LINE, ctx, { anyNumber: true });
                ok(b && b.cells[1] === PXK && b.cells[10] === PXK, '서버 pick 길 = B=K=받는 분 번호(AI 꼴) → 종전대로 B·K 둘 다 입력삭제 번호', b && b.cells);
                const c0 = OMS.pairCash(mk(cellsOf('', '010-2111-9887', PXK)), LINE, ctx), c1 = OMS.pairCash(mk(cellsOf(PXO, '010-4787-4217', PXO)), LINE, ctx);
                ok(c0 && c0.cells[1] === PXK && c0.cells[10] === PXK && c1 === null, '종전 길(pick 없음) = B 빈칸 → 그 번호 · 번호 다른 줄 = null(종전과 같음)', [c0 && c0.cells, c1]); }
            for (const [nm, why] of [['서비스손님', '서비스 알약 켜진 줄'], ['주소줄손님', '이미 주소 줄']]) { await p.locator('#om-ctw tbody tr', { hasText: nm }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(100); const has = await p.evaluate(() => !!document.querySelector('#om-card [data-cact="pyopen"], #om-card .om-pairy')); ok(!has, `⑤ ${why} = 단추·목록 안 보임`); await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100); }
            ok(pe.length === 0, '#934 1280 스크립트 오류 0', pe);
            await c.close();
            // 폰 390 · 폴드 900(손가락) = 넘침 0 · 44px
            for (const [w, h] of [[390, 844], [900, 900]]) {
                const c2 = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 721, deviceScaleFactor: 1 }); const p2 = await c2.newPage(); const pe2 = []; p2.on('pageerror', e => pe2.push(String(e)));
                await openPx(p2, 'new'); await p2.click('[data-cact="pxopen"]'); await p2.waitForSelector('#om-card .om-pairx'); await p2.waitForTimeout(100);
                const m = await p2.evaluate(() => { const card = document.getElementById('om-card'), cr = card.getBoundingClientRect(), x = card.querySelector('.om-pairx'); const small = []; x.querySelectorAll('label:not(.om-sr), input[type="search"], .om-acts button').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.height < (el.matches('button') ? 36 : 44)) small.push(el.tagName + ' ' + Math.round(r.height)); }); return { sw: document.documentElement.scrollWidth, over: [...x.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > cr.right + 0.5).length, small }; });
                ok(m.sw <= w && m.over === 0 && m.small.length === 0, `${w}폭 추가 매칭 판 = 가로 넘침 0 · 찾기 칸·체크 줄 44px · 단추 36px↑`, m);
                if (w === 390) {
                    await p2.click('#om-card [data-cact="cancel"]'); await p2.waitForTimeout(100); const po = await p2.$('#om-prev-open'); if (po && await po.isVisible()) await po.click();
                    await p2.locator('#om-ctw tbody tr', { hasText: '김보은' }).locator('.om-ct-open').click(); await p2.waitForSelector('#om-card:not([hidden]) [data-cact="pyopen"]'); await p2.click('[data-cact="pyopen"]'); await p2.waitForSelector('#om-card .om-pairy');
                    const m2 = await p2.evaluate(() => { const card = document.getElementById('om-card'), cr = card.getBoundingClientRect(), y = card.querySelector('.om-pairy'); return { sw: document.documentElement.scrollWidth, over: [...y.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > cr.right + 0.5).length, lh: Math.min(...[...y.querySelectorAll('label')].map(l => Math.round(l.getBoundingClientRect().height))) }; });
                    ok(m2.sw <= 390 && m2.over === 0 && m2.lh >= 44, '390폭 ⑤ 붙이기 목록 = 넘침 0 · 줄 44px', m2);
                }
                ok(pe2.length === 0, `${w}폭 #934 스크립트 오류 0`, pe2);
                await c2.close();
            }
            S.px = false; S.px2 = false; S.preview = null; }
    } catch (e) { failN++; console.log('  ❌ 실행 오류', e && e.stack || e); }
    await browser.close(); srv.close();
    console.log(`\n결과 ${pass}/${pass + failN}${failN ? ' · 실패 ' + failN : ''}`);
    process.exit(failN ? 1 : 0);
})();
