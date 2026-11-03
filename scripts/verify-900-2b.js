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
    const ents = [
        { id: 129, created_at: today, source: 'manual', rows: (S.pxHide ? [] : [cash(191, '강명희 드림!', PXK, '이하정', CAT[1], 1, '010-2111-9887', '010-2111-9887', '충남 천안시 동남구 일봉로 7'), cash(192, '강명희 드림!', PXK, '이승비', CAT[1], 1, '010-2027-9787', '010-2027-9787', '충남 아산시 배방읍 동천로 2'), cash(193, '이형주 드림!', PXO, '김보은', CAT[1], 1, '010-4787-4217', '010-4787-4217', '충남 보령시 동대동 8')]).concat(S.pxHide ? [cash(193, '이형주 드림!', PXO, '김보은', CAT[1], 1, '010-4787-4217', '010-4787-4217', '충남 보령시 동대동 8')] : []) },
        { id: 140, created_at: today, source: 'manual', rows: [cash(201, '홍길동 드림', PXL, '주소줄손님', CAT[0], 1, '010-3300-0001', PXL, '서울 송파구 올림픽로 1', { pair_orig: S.pxOrig ? { a: '홍길동 드림!', b: '010-1234-8247', k: '010-1234-8247', d: null, ab: PXL, ad: null } : null, indiv: true }), cash(202, '서비스!', '', '서비스손님', CAT[0], 1, '010-3300-0002', '010-3300-0002', '서울 마포구 월드컵로 2', { service: true }), cash(203, '박민수 드림!', '010-8800-1234', '최수아', CAT[0], 2, '010-8800-1234', '010-8800-1234', '서울 강남구 테헤란로 1')] },
        { id: 128, created_at: yest, source: 'manual', raw: PXL + ' 입력o삭제x 네이버', rows: [Object.assign({ id: 190, kind: 'line', state: 'open', sure: true, check_why: [], key: PXL, note: '입력o삭제x', plat: '네이버', line: ['', PXL, '입력o삭제x', '네이버'].join('\t') }, S.badges[190] ? { badge: S.badges[190] } : {})] },
    ].concat(S.lines938 ? [{ id: 141, created_at: today, source: 'manual', raw: '', rows: [Object.assign({ badge: S.badges[310] || undefined }, { id: 310, kind: 'line', state: 'open', sure: true, check_why: [], key: '9000000001', note: '입력o삭제x', plat: '네이버', line: ['', '9000000001', '입력o삭제x', '네이버'].join('\t'), checked: { plat: '네이버', as: 'order', at: '2026-11-01T03:00:00.000Z', buyer: PXL } }), { id: 311, kind: 'line', state: 'open', sure: true, check_why: [], key: '9000000002', note: '입력o삭제x', plat: S.linesPlat311 || '네이버', line: ['', '9000000002', '입력o삭제x', S.linesPlat311 || '네이버'].join('\t'), checked: { plat: '네이버', as: 'order', at: '2026-11-01T03:00:00.000Z', buyer: PXL } }] }] : []).concat(S.px2 ? [{ id: 131, created_at: today, source: 'manual', raw: PXK + ' 입력o삭제x 네이버', rows: [{ id: 195, kind: 'line', state: 'open', sure: true, check_why: [], key: PXK, note: '입력o삭제x', plat: '네이버', line: ['', PXK, '입력o삭제x', '네이버'].join('\t') }] }] : []);
    if (S.px3) ents[0].rows = ents[0].rows.map(r => r.id === 193 ? cash(193, '이형주 드림', PXO, '김보은', CAT[1], 1, '010-4787-4217', PXK, '충남 보령시 동대동 8', Object.assign({ indiv: true }, S.px3Later ? { ship_date: '2026-12-31' } : {})) : r);   // #935 193 = 「풀림」(「!」 없음 · K 3292 · 그 번호 입력삭제 줄 없음 = 11/1 12:26 실사례 꼴)
    ents.forEach(e => { e.rows = e.rows.filter(r => !S.deleted.has(r.id)); });   // #935 가짜 DELETE 반영
    return { ok: true, ship_date: SHIP, keep_days: 15, counts: {}, entries: ents };
}
function listBody(n, ent) {
    if (S.px) { const L = pxList(); if (S.px120) L.entries.push({ id: 150, created_at: new Date().toISOString(), source: 'manual', rows: Array.from({ length: 120 }, (_, i) => ({ id: 1000 + i, kind: 'cash', state: 'open', sure: true, check_why: [], addr_ok: null, indiv: false, service: false, cells: ['단체주문 드림!', '010-3300-' + String(5000 + i), '제주시 연삼로 1066-31', '단체' + i, CAT[1], '1', '010-3300-' + String(5000 + i), '', '서울 송파구 올림픽로 ' + i, '', '010-7000-8888', '', ''] })) }); return L; }
    const entries = [];
    for (let e = 0; e < ent; e++) entries.push({ id: e + 1, created_at: new Date(Date.UTC(2026, 9, 28, 0, 0, 0) - e * 60000).toISOString(), source: 'manual', rows: [] });
    for (let i = 0; i < n; i++) {
        const k = String(i + 1).padStart(4, '0');
        entries[i % ent].rows.push({ id: 10000 + i, kind: 'cash', state: 'open', sure: true, check_why: [], addr_ok: null,
            exp_site: !!(S.exp && i === 0), cells: ['', S.tel && i === 1 ? '010-7777-8888' : S.tel && i === 0 ? '010-1111-2222' : '', '', '손님' + k, CAT[i % 2], '1', '010-55' + k.slice(0, 2) + '-' + k, '', '제주특별자치도 제주시 연동 ' + (S.multi && i % 6 === 0 ? '다중 ' : '') + (i + 1) + '번지', '', S.tel && i < 2 ? '01011112222' : '', '', ''] });   // #927 tel = 0번 줄 B=K(서버가 채운 꼴) · 1번 줄 B≠K(대신 주문)
    }
    return { ok: true, ship_date: SHIP, keep_days: 15, counts: {}, entries };
}
const S = { exp: false, n: 0, ent: 1, juso: 0, calls: [], multi: false, tel: false, puts: [], px: false, px2: false, px3: false, px3Later: false, pxHide: false, deleted: new Set(), listDelay: 0, badges: {}, services: [], lookup: null, lines938: false, linesPlat311: null, preview: null, pairs: [], saves: [] };   // #934 px = 실사례 목록 · preview = 가짜 정리 답 · pairs/saves = 받은 POST 본문   // multi = 6줄마다 주소 후보 둘(「주소 확인 필요」)
const page0 = v => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#EEF0F4;font-family:system-ui,"Malgun Gothic",sans-serif;-webkit-font-smoothing:antialiased}*{animation:none!important;transition:none!important;caret-color:transparent!important}.om-tag[data-tag="smemo"]{display:none!important}</style>
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
        if (u.pathname === '/api/order-memo' && req.method === 'GET') { const body = u.searchParams.get('state') === 'cleared' ? { ok: true, entries: [] } : listBody(S.n, S.ent); if (S.listDelay) { setTimeout(() => send(200, body), S.listDelay); return; } return send(200, body); }   // #935 listDelay = 느린 목록(저장 중 재조회 시험)
        if (u.pathname === '/api/order-memo/for-ship') return send(200, { ok: true, cash_ids: [], lines: [] });
        if (u.pathname === '/api/invoice/catalog') return send(200, { byPartner: { a: CAT } });
        if (u.pathname === '/api/agent-office/juso') { S.juso++; const kw = u.searchParams.get('keyword') || ''; const one = n => ({ roadAddrPart1: '제주특별자치도 제주시 연동로 ' + n, zipNo: '63' + String(n).padStart(3, '0'), bdNm: '' }); return send(200, { results: { common: { errorCode: '0' }, juso: /다중/.test(kw) ? [one(kw.length), one(kw.length + 500)] : [one(kw.length)] } }); }
        if (u.pathname === '/api/order-memo/preview' && req.method === 'POST') return send(200, S.preview || { ok: true, rows: [] });   // #934 붙여 넣은 글 정리 = 가짜 답
        if (u.pathname === '/api/order-memo/lookup' && req.method === 'GET' && S.lookup) { const k = String(u.searchParams.get('key') || '').replace(/\D/g, ''); const m = S.lookup[k]; return send(200, { ok: true, src: 'memo', days: 7, matches: m ? JSON.parse(JSON.stringify(m)) : [] }); }   // #938 주문 찾기(가짜)
        if (u.pathname === '/api/order-memo/service' && req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch (e) { } S.services.push(j); send(200, { ok: true, n: (j.ids || []).length, rows: [], skipped: [] }); }); return; }   // #936 서비스 켜고 끄기(가짜)
        if (u.pathname === '/api/order-memo/pair' && req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch (e) { } S.pairs.push(j); const ids = Array.isArray(j.ids) ? j.ids : []; send(200, j.undo === true ? { ok: true, n: (j.rows || []).length } : { ok: true, n: ids.length, skipped: 0, rows: [], undo: ids.map(id => ({ id, entry_id: 1, cells: ['x!'], ship_date: null })) }); }); return; }
        if (u.pathname === '/api/order-memo' && req.method === 'POST') { let b = ''; req.on('data', d => b += d); req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch (e) { } S.saves.push(j); send(200, { ok: true, rows: (j.rows || []).map((r, i) => Object.assign({}, r, { id: 900 + i, state: 'open', sure: true, check_why: [] })) }); }); return; }
        if (req.method === 'DELETE' && /^\/api\/order-memo\/rows\/\d+$/.test(u.pathname)) { S.deleted.add(Number(u.pathname.split('/').pop())); return send(200, { ok: true }); }   // #935 지운 줄 기억(가짜 안에서만)
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
                shots[v] = await p.evaluate(() => { const k = document.getElementById('om-card').cloneNode(true); k.querySelectorAll('[data-fwrap$="-c1"], .om-expchk').forEach(e => e.remove()); return k.innerHTML; }).then(h => h.replace(/ fk-(?:ship|\d+)/g, '').replace(/om-grid cash(?:-more)?/g, 'om-grid').replaceAll(' <small>비우면 다음 발주</small>', '').replaceAll('placeholder="예) 10/30"', 'placeholder="비우면 다음 발주 · 예) 10/30"')); await c.close();   // #927 새 칸 「보내는 분 연락처」(c1)는 빼고 비교 · #911 카드 꼴을 일부러 바꿈 = 픽셀 대신 칸 HTML(자리 이름 fk-·cash 빼고)이 종전과 같은지
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

        // #1003 현금 줄 「체험장」 = 고치기·빈 현금·정리 결과 카드 체크칸 · 알약 「현금 · 체험장」(밝음·야간 다른 색) · 주소 줄·서비스 줄엔 칸 없음 · PUT/POST 에 exp_site
        console.log('#1003 현금 줄 체험장 표시');
        { const pe = []; const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', e => pe.push(String(e)));
            S.exp = true; await openMemo(p, 'new', 3, 1); await jusoQuiet();
            let st = await p.evaluate(() => { const ps = [...document.querySelectorAll('#om-ctw tbody tr .om-ct-p > .om-pill:first-child')]; const cs = e => { const g = getComputedStyle(e); return g.backgroundColor + '|' + g.color; }; return { t: ps.map(e => e.textContent), cls: ps.map(e => e.className), light: ps.length > 1 ? [cs(ps[0]), cs(ps[1])] : [] }; });
            ok(st.t[0] === '현금 · 체험장' && st.cls[0] === 'om-pill k-cash k-exp' && st.t.slice(1).every(t => t === '현금') && st.light[0] !== st.light[1], '체험장 줄 알약 「현금 · 체험장」(다른 색) · 나머지 「현금」 그대로', st);
            st = await p.evaluate(() => { document.documentElement.setAttribute('data-ao-theme', 'dark'); const ps = [...document.querySelectorAll('#om-ctw tbody tr .om-ct-p > .om-pill:first-child')]; const cs = e => { const g = getComputedStyle(e); return g.backgroundColor + '|' + g.color; }; const r = [cs(ps[0]), cs(ps[1])]; document.documentElement.removeAttribute('data-ao-theme'); return r; });
            ok(st[0] !== st[1] && /rgba\(251, 146, 60/.test(st[0]), '야간 = 체험장 알약 야간 색(현금과 다름)', st);
            // 고치기 카드: 체험장 줄 = 체크됨 · 끄고 저장 = PUT exp_site false / 다른 줄 켜고 저장 = true · 안 건드리면 칸 안 보냄
            await p.click('#om-ctw tbody tr:nth-child(1) .om-ct-open'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard');
            st = await p.evaluate(() => { const b = document.querySelector('#om-card input[data-cact="exprow"]'); return { has: !!b, on: b && b.checked, h: b && Math.round(b.closest('label').getBoundingClientRect().height) }; });
            ok(st.has && st.on === true && st.h >= 36, '고치기 카드 = [체험장] 체크칸(체험장 줄은 켜져 있음)', st);
            S.puts = []; await p.click('#om-card input[data-cact="exprow"]'); await p.click('#om-card-save'); await until(() => S.puts.length); await p.waitForTimeout(150);
            ok(S.puts[0].exp_site === false && Array.isArray(S.puts[0].cells) && S.puts[0].cells.length === 13, '체험장 끄고 저장 = PUT exp_site false · cells 13칸 그대로', S.puts[0]);
            await openMemo(p, 'new', 3, 1); await p.click('#om-ctw tbody tr:nth-child(2) .om-ct-open'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard');
            S.puts = []; await p.click('#om-card input[data-cact="exprow"]'); await p.click('#om-card-save'); await until(() => S.puts.length); await p.waitForTimeout(150);
            ok(S.puts[0].exp_site === true, '다른 줄 체험장 켜고 저장 = PUT exp_site true', S.puts[0]);
                                                S.exp = false;
            // 빈 현금 카드(주문입력) = 체크칸 있음 · 저장 POST 에 exp_site true
            await openMemo(p, 'new', 3, 1); await p.click('.om-tag[data-tag="cash"]'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard');
            st = await p.evaluate(() => !!document.querySelector('#om-card input[data-cact="exprow"]'));
            ok(st, '빈 현금 카드 = [체험장] 체크칸 있음', st);
            // 정리 결과 카드(붙여 넣은 글) = 현금 줄 체크 → 저장 POST rows[0].exp_site true · 메모 줄엔 칸 없음
            S.preview = { ok: true, rows: [{ kind: 'cash', sure: true, check_why: [], cells: ['체험장 드림!', '010-4400-1234', '제주시 연삼로 1066-31', '체험손님', CAT[0], '1', '010-4400-1234', '', '서울 송파구 올림픽로 9', '', '010-4400-1234', '', ''] }, { kind: 'line', key: '010-4400-5678', note: '큰 걸로', plat: '네이버', line: ['', '010-4400-5678', '큰 걸로', '네이버'].join('\t'), sure: true, check_why: [] }] };
            await openMemo(p, 'new', 3, 1); S.saves = []; await p.evaluate(t => window.AkmOrderMemo.fromText(t), '체험손님 현금 5kg 1박스'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(200);
            st = await p.evaluate(() => [...document.querySelectorAll('#om-card .om-rowcard')].map(s => !!s.querySelector('input[data-cact="exprow"]')));
            ok(st.join() === 'true,false', '정리 결과 카드 = 현금 줄만 [체험장] 칸(메모 줄 없음)', st);
            await p.click('#om-card input[data-cact="exprow"]'); await p.click('#om-card-save'); await until(() => S.saves.length); await p.waitForTimeout(200);
            ok(S.saves[0] && S.saves[0].rows[0].exp_site === true && !('exp_site' in S.saves[0].rows[1]) && S.saves[0].rows[0].cells.length === 13, '정리 결과 저장 = 현금 줄 exp_site true · 메모 줄엔 칸 없음 · cells 13칸', S.saves[0] && S.saves[0].rows);
            S.preview = null;
            // 입력삭제 주소 줄·서비스 줄 고치기 카드 = 체험장 칸 없음
            S.px = true; await openMemo(p, 'new', 4, 1);
            for (const nm of ['주소줄손님', '서비스손님']) {
                await p.locator('#om-ctw tbody tr', { hasText: nm }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard');
                st = await p.evaluate(() => !!document.querySelector('#om-card input[data-cact="exprow"]'));
                ok(!st, nm + ' 고치기 카드 = 체험장 칸 없음', st);
                await p.keyboard.press('Escape'); await p.waitForTimeout(150); if (await p.evaluate(() => !document.getElementById('om-card').hidden)) await p.click('#om-card [data-cact="close"], #om-card .om-x').catch(() => {});
            }
            S.px = false;
            ok(pe.length === 0, '#1003 스크립트 오류 0', pe); await c.close(); }
        // #1003 390·900 × 밝음·야간 = 넘침 0 · 체크칸 44px(폰) · PNG(PNG1003 폴더 있으면)
        for (const [w, h] of [[390, 844], [900, 900]]) for (const dark of [false, true]) {
            const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: dark ? 'dark' : 'light' }); const p = await c.newPage(); const pe = []; p.on('pageerror', e => pe.push(String(e)));
            S.exp = true; await openMemo(p, 'new', 3, 1, w < 700); await jusoQuiet(); if (dark) await p.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
            const tag = w + (dark ? ' 야간' : ' 밝음'), out = process.env.PNG1003;
            const pill = await p.evaluate(() => { const e = document.querySelector('.om-pill.k-exp'); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), sw: document.documentElement.scrollWidth }; });
            if (out) await p.screenshot({ path: path.join(out, 'list-' + w + (dark ? '-dark' : '') + '.png') });
            await p.click('#om-ctw tbody tr:nth-child(1) .om-ct-open'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(150);
            const st = await p.evaluate(() => { const card = document.getElementById('om-card'), cr = card.getBoundingClientRect(), l = card.querySelector('.om-expchk'); l && l.scrollIntoView({ block: 'center' }); const r = l && l.getBoundingClientRect(); return { h: r && Math.round(r.height), over: r && r.right > cr.right + 0.5, sw: document.documentElement.scrollWidth }; });
            if (out) await p.screenshot({ path: path.join(out, 'card-' + w + (dark ? '-dark' : '') + '.png') });
            ok(pill && pill.sw <= w && st.h >= (w < 700 ? 44 : 36) && !st.over && st.sw <= w && pe.length === 0, tag + ' = 알약·체크칸 넘침 0 · 체크칸 높이 · 오류 0', { pill, st, pe });
            S.exp = false; await c.close();
        }
        // #1003 for-ship = 체험장 칸 켜도 바이트 같음(순수 pickForShip)
        { const OMS = require(path.join(ROOT, 'order-memo.js')), row = (id, ex) => ({ id, kind: 'cash', state: 'open', sure: true, service: false, exp_site: ex, ship_date: null, cells: ['체험장 드림!', '', '제주시', '손님' + id, CAT[0], '1', '010-4400-1234', '', '서울', '', '010-4400-1234', '', ''] });
            const a = JSON.stringify(OMS.pickForShip([row(1, false), row(2, false)], '2026-11-04')), b = JSON.stringify(OMS.pickForShip([row(1, true), row(2, false)], '2026-11-04'));
            ok(a === b, 'for-ship 출력 = 체험장 켜기 전후 바이트 같음(양식 A칸 「!」 꼴 그대로)', { same: a === b }); }
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
            await p.click('[data-cact="pxopen"]'); await p.waitForSelector('#om-card .om-pairx');
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
            await openPx(p, 'new'); await p.click('[data-cact="pxopen"]'); await p.check('#om-card .om-pairx input[data-v="193"]'); await p.click('[data-cact="pxgo"]'); await p.waitForSelector('#om-card .om-pair.ok [data-cact="pxopen"]'); await p.click('#om-card .om-pair.ok [data-cact="pxopen"]'); await p.waitForSelector('#om-card .om-pairx');
            st = await p.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'); return { open: !!x, on: x ? [...x.querySelectorAll('input[data-cact="pxchk"]:checked')].map(i => i.dataset.v) : [] }; });
            ok(st.open && st.on.join() === '193', '[더 고르기] = 판 다시 열림 · 고른 193 체크 그대로', st);
            // ④ 메모함 입력삭제 줄 [추가 매칭] — 실사례 뒤 상태(입력삭제 줄 195 저장됨 · 같은 번호 현금 191·192 + 번호 다른 193 아직 현금 · 대표가 [바꾸기] 없이 저장)
            S.px2 = true; await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 2));
            st = await p.evaluate(() => ({ n: document.querySelectorAll('#om-list .om-ml-px').length, li: document.querySelectorAll('#om-list .om-ml').length, t: (document.querySelector('#om-list .om-ml-px') || {}).textContent }));
            ok(st.n === 2 && st.li === 2 && st.t === '추가 매칭', '④ 메모함 입력삭제 줄 2개마다 [추가 매칭] 단추', st);
            S.pairs = []; await p.locator('#om-list .om-ml', { hasText: PXK }).locator('.om-ml-px').click(); await p.waitForSelector('#om-card:not([hidden]) .om-pairx');
            st = await p.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'); return { b: x.querySelector('b').textContent, items: [...x.querySelectorAll('.om-pair-l li span')].map(s => s.textContent), on: [...x.querySelectorAll('input[data-cact="pxchk"]:checked')].map(i => i.dataset.v), head: x.querySelector('.om-pair-n').textContent, lab: x.querySelector('[data-cact="pxgo"]').textContent.replace(/\s+/g, ' ').trim() }; });
            ok(st.b === '입력삭제 010-3292-0535 주소 줄로 바꿀 현금 줄을 고르세요' && st.items.length === 4 && /^이하정 .*번호 같음$/.test(st.items[0]) && /^이승비 .*번호 같음$/.test(st.items[1]) && /^김보은 .*구매자 …4217$/.test(st.items[2]) && st.on.join() === '191,192' && st.head === '4줄 중 2줄 · 2박스' && st.lab === '이 줄도 주소 줄로 2줄', '④ 실사례 줄(3292) = 같은 번호 2줄 앞에 「같은 번호」·미리 체크 + 번호 다른 2줄 · 「4줄 중 2줄 · 2박스」', st);
            await p.check('#om-card .om-pairx input[data-v="193"]'); await p.click('[data-cact="pxgo"]'); await until(() => S.pairs.length); await p.waitForTimeout(250);
            st = await p.evaluate(() => ({ t: document.getElementById('om-undo-t').textContent, undo: !document.getElementById('om-undo').hidden, closed: document.getElementById('om-card').hidden }));
            ok(JSON.stringify(S.pairs[0]) === JSON.stringify({ key: PXK, ids: [191, 192, 193], pick: true }) && st.undo && st.closed && st.t === '현금 줄 3개를 입력삭제 010-3292-0535 주소 줄로 바꿨어요', '④ 실사례 = 셋째 줄 체크해 [이 줄도 주소 줄로] → POST pair {key 3292, ids 191·192·193, pick} 바로(저장 없이) · 되돌리기 띠', { pairs: S.pairs, st });
            S.pairs = []; await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-px').click(); await p.waitForSelector('#om-card:not([hidden]) .om-pairx');
            st = await p.evaluate(() => ({ title: document.getElementById('om-card-t').textContent.trim(), b: document.querySelector('#om-card .om-pairx b').textContent, items: [...document.querySelectorAll('#om-card .om-pairx .om-pairx-b .om-pair-l li span')].map(s => s.textContent.split(' · ')[0]) }));
            ok(/메모 고치기/.test(st.title) && st.b === '입력삭제 010-5738-4123 주소 줄로 바꿀 현금 줄을 고르세요' && st.items.join() === '이하정,이승비,김보은,최수아', '④ 누르면 고치기 카드 + 추가 매칭 판 바로 열림 · 짝 없는 현금 줄 4개(주소 줄·서비스 줄 제외 · 같은 번호 줄 0 = 체크 0)', st);
            await p.check('#om-card .om-pairx input[data-v="203"]'); await p.click('[data-cact="pxgo"]'); await until(() => S.pairs.length); await p.waitForTimeout(250);
            st = await p.evaluate(() => ({ undo: !document.getElementById('om-undo').hidden, t: document.getElementById('om-undo-t').textContent, px: !!document.querySelector('#om-card .om-pairx'), btn: !!document.querySelector('#om-card [data-cact="pxopen"]'), card: document.getElementById('om-card').hidden }));
            ok(JSON.stringify(S.pairs[0]) === JSON.stringify({ key: PXL, ids: [203], pick: true }) && st.undo && st.t === '현금 줄 1개를 입력삭제 010-5738-4123 주소 줄로 바꿨어요' && !st.px && st.card, '④ [이 줄도 주소 줄로] = 저장 없이 바로 POST pair {key 5738, ids 203, pick} · 되돌리기 띠 · 카드 닫힘(되돌리기 띠 안 가림)', { pairs: S.pairs, st });
            // #947 단체 입력삭제 120줄 = 찾기 + 「찾은 n줄 전체 선택」(표시 50줄 · 저장/바로 POST 60줄씩)
            { S.px120 = true; const c947 = await browser.newContext({ viewport: { width: 1280, height: 900 } }), q = await c947.newPage(), pe947 = []; q.on('pageerror', e => pe947.push(String(e)));
              const qq = '#om-px-q-' + PXD, all = '#om-card .om-pairx input[data-cact="pxall"]', pick = () => S.pairs.filter(j => j.pick === true).map(j => j.ids);
              await openPx(q, 'new'); await q.click('[data-cact="pxopen"]'); await q.waitForSelector('#om-card .om-pairx');
              let s9 = await q.evaluate(() => !!document.querySelector('#om-card .om-pairx input[data-cact="pxall"]')); ok(!s9, '#947 찾기 글자 없음 = 전체 선택 칸 없음(남의 줄까지 고르지 않게)');
              await q.fill(qq, '010-7000-8888'); await q.waitForSelector(all); s9 = await q.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'); return { lab: x.querySelector('.om-px-all').textContent.trim(), head: x.querySelector('.om-pair-n').textContent, li: x.querySelectorAll('input[data-cact="pxchk"]').length, go: x.querySelector('[data-cact="pxgo"]').disabled, foc: document.activeElement && document.activeElement.id }; });
              ok(s9.lab === '찾은 120줄 전체 선택' && s9.li === 50 && s9.go && /50줄까지만 보여요/.test(s9.head) && s9.foc === qq.slice(1), '#947 구매자 번호로 찾기 = 「찾은 120줄 전체 선택」 · 표시 50줄 · 초점 그대로', s9);
              await q.check(all); s9 = await q.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'); return { head: x.querySelector('.om-pair-n').textContent, on: x.querySelectorAll('input[data-cact="pxchk"]:checked').length, all: x.querySelector('input[data-cact="pxall"]').checked, go: x.querySelector('[data-cact="pxgo"]').textContent, foc: document.activeElement && document.activeElement.dataset.cact }; });
              ok(/120줄<?\/?b?>? ?/.test(s9.head) && /122줄 중|중 120줄/.test(s9.head) && /70줄 더 · 전부 선택됨/.test(s9.head) && s9.on === 50 && s9.all && /120줄/.test(s9.go) && s9.foc === 'pxall', '#947 전체 선택 = 찾은 120줄 전부 · 「70줄 더 · 전부 선택됨」 · 단추 120줄', s9);
              await q.uncheck('#om-card .om-pairx input[data-v="1000"]'); s9 = await q.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'); return { head: x.querySelector('.om-pair-n').textContent, all: x.querySelector('input[data-cact="pxall"]').checked }; });
              ok(!s9.all && /중 119줄/.test(s9.head) && /50줄까지만 보여요/.test(s9.head), '#947 한 줄 끄기 = 119줄 · 전체 칸 풀림(개별 해제)', s9);
              await q.check(all); await q.fill(qq, '단체0'); await q.waitForTimeout(100); s9 = await q.evaluate(() => document.querySelector('#om-card .om-pairx .om-pair-n').textContent); ok(/중 120줄/.test(s9), '#947 찾기를 바꿔도 고른 줄 유지 · 보내는 분·받는 분 이름으로도 찾음', s9);
              await q.fill(qq, '단체주문'); await q.waitForTimeout(100); s9 = await q.evaluate(() => (document.querySelector('#om-card .om-px-all') || {}).textContent || ''); ok(/찾은 120줄/.test(s9), '#947 보내는 분 이름으로 찾기 = 120줄', s9);
              S.pairs = []; await q.click('#om-card-save'); await until(() => pick().length >= 2); await q.waitForTimeout(250); let ps = pick(); ok(ps.length === 2 && ps[0].length === 60 && ps[1].length === 60 && new Set(ps[0].concat(ps[1])).size === 120, '#947 정리 결과 카드 저장 = pick POST 2회(60+60 · 120줄 전부)', ps.map(x => x.length));
              // ④ 메모함 입력삭제 줄 판 = 바로 POST · [고친 대로 저장]
              await openMemo(q, 'new', 4, 1); S.pairs = []; await q.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-px').click(); await q.waitForSelector('#om-card:not([hidden]) .om-pairx'); await q.fill(qq.replace(PXD, PXL.replace(/\D/g, '')), '8888'); await q.check(all); await q.click('[data-cact="pxgo"]'); await until(() => pick().length >= 2); await q.waitForTimeout(250); ps = pick();
              s9 = await q.evaluate(() => ({ t: document.getElementById('om-undo-t').textContent, undo: !document.getElementById('om-undo').hidden })); ok(ps.length === 2 && ps[0].length === 60 && ps[1].length === 60 && s9.undo && /현금 줄 120개/.test(s9.t), '#947 ④ 바로 POST = 2회(60+60) · 되돌리기 띠 120개(종전 = 60줄에서 잘림)', { n: ps.map(x => x.length), s9 });
              s9 = await q.evaluate(() => document.getElementById('om-card').hidden); ok(s9, '#947 ④ 바로 POST 뒤 카드 닫힘'); S.pairs = []; await q.click('#om-undo-b', { timeout: 4000 }); await until(() => S.pairs.some(j => j.undo === true)); await q.waitForTimeout(200); s9 = S.pairs.filter(j => j.undo === true).map(j => (j.rows || []).length); ok(s9.length >= 1 && s9.every(n => n <= 60), '#947 되돌리기 실클릭 됨 · 60줄씩', s9);
              await openMemo(q, 'new', 4, 1); S.pairs = []; await q.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-px').click(); await q.waitForSelector('#om-card:not([hidden]) .om-pairx'); await q.fill(qq.replace(PXD, PXL.replace(/\D/g, '')), '8888'); await q.check(all); await until(() => q.evaluate(() => /120줄 짝짓기/.test(document.getElementById('om-card-save').textContent))); await q.click('#om-card-save'); await until(() => pick().length >= 2); ps = pick(); ok(ps.length === 2 && ps[0].length === 60 && ps[1].length === 60, '#947 ④ [고친 대로 저장 + 120줄 짝짓기] = pick POST 2회', ps.map(x => x.length));
              await q.waitForTimeout(200); await openMemo(q, 'new', 4, 1); S.pairs = []; await q.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-px').click(); await q.waitForSelector('#om-card:not([hidden]) .om-pairx'); await q.check('#om-card .om-pairx input[data-v="203"]'); await q.route('**/api/order-memo/pair', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"시험 실패"}' })); await q.click('[data-cact="pxgo"]'); await q.waitForTimeout(400); s9 = await q.evaluate(() => ({ open: !document.getElementById('om-card').hidden, px: !!document.querySelector('#om-card .om-pairx'), undo: !document.getElementById('om-undo').hidden })); ok(s9.open && s9.px && !s9.undo, '#947 ④ 실패 = 카드·판 유지 · 되돌리기 띠 없음', s9); await q.unroute('**/api/order-memo/pair'); ok(!pe947.length, '#947 스크립트 오류 0', pe947); await c947.close();
              const c390 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), m = await c390.newPage(); await openPx(m, 'new'); await m.click('[data-cact="pxopen"]'); await m.waitForSelector('#om-card .om-pairx'); await m.fill(qq, '8888'); await m.waitForSelector(all); s9 = await m.evaluate(() => { const c = document.getElementById('om-card'), l = c.querySelector('.om-px-all').getBoundingClientRect(); return { h: Math.round(l.height), over: c.scrollWidth - c.clientWidth, doc: document.scrollingElement.scrollWidth - innerWidth }; }); ok(s9.h >= 44 && s9.over <= 0 && s9.doc <= 0, '#947 390폭 전체 선택 칸 44px · 넘침 0', s9); await c390.close(); S.px120 = false; }
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
            await p.click('[data-cact="pyopen"]'); await p.waitForSelector('#om-card .om-pairy');
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
        // ── ⑥ #935 입력삭제 풀림 · 입력삭제 줄 삭제 확인 세 갈래 · 판·카드 열 때 재조회 ──
        console.log('⑥ #935 입력삭제 풀림 · 삭제 확인 세 갈래 · 재조회');
        { S.px = true; S.px2 = true; S.px3 = false; S.deleted = new Set();
            S.preview = { ok: true, rows: [{ kind: 'line', key: PXK, note: '입력o삭제x', plat: '네이버', line: ['', PXK, '입력o삭제x', '네이버'].join('\t'), sure: true, check_why: [] }] };
            const openPx = async (p, v) => { await openMemo(p, v, 4, 1); S.pairs = []; S.saves = []; S.puts = []; await p.evaluate(t => window.AkmOrderMemo.fromText(t), PXK + ' 입력o삭제x 네이버'); await p.waitForSelector('#om-card:not([hidden]) .om-pair'); await p.waitForTimeout(150); };
            const gets = () => S.calls.filter(x => x === 'GET /api/order-memo').length;
            const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); const pe = []; p.on('pageerror', e => pe.push(String(e)));
            // 재조회
            await openPx(p, 'new'); await p.waitForTimeout(300); const g1 = gets();
            ok(g1 >= 1, '정리 결과 카드 열 때 목록 1회 재조회(GET /api/order-memo)', S.calls);
            await p.click('[data-cact="pxopen"]'); await p.waitForSelector('#om-card .om-pairx'); const g2 = gets();
            ok(g2 === g1 + 1, '[추가 매칭] 판 열 때 목록 재조회 1회', { g1, g2 });
            await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100);
            await p.locator('#om-ctw tbody tr', { hasText: '김보은' }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) [data-cact="pyopen"]'); const g3 = gets(); await p.click('[data-cact="pyopen"]'); await p.waitForSelector('#om-card .om-pairy'); const g4 = gets();
            ok(g4 === g3 + 1, '[입력삭제 주문에 붙이기] 판 열 때 목록 재조회 1회', { g3, g4 });
            await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100);
            // ① 삭제 확인 세 갈래(입력삭제 줄 5738 ← 주소 줄 201 붙어 있음)
            const ask = () => p.evaluate(() => ({ hidden: document.getElementById('om-ask').hidden, h: document.getElementById('om-ask-h').textContent, s: document.getElementById('om-ask-s').textContent, mid: !document.getElementById('om-ask-mid').hidden, yes: document.getElementById('om-ask-yes').textContent, three: document.getElementById('om-ask').classList.contains('three') }));
            await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-x').click(); let st = await ask();
            ok(!st.hidden && st.h === '입력삭제 줄을 지우면 주소 줄 1개가 짝을 잃어요' && /주소줄손님/.test(st.s) && /풀림/.test(st.s) && st.mid && st.yes === '주소 줄도 같이 지우기' && st.three, '입력삭제 줄 × = 확인 창 세 갈래 「주소 줄 1개가 짝을 잃어요」 · [줄만 지우기]/[주소 줄도 같이 지우기]/[취소]', st);
            await p.click('#om-ask-no'); st = await ask();
            ok(st.hidden && S.deleted.size === 0, '[취소] = 지운 줄 0', { st, del: [...S.deleted] });
            await p.locator('#om-list .om-ml', { hasText: PXK }).locator('.om-x').click(); st = await ask();
            ok(!st.hidden && /^1줄을 지우면 다음 발주에서 빠져요/.test(st.h) && !st.mid && st.yes === '삭제' && !st.three, '붙은 주소 줄 없는 입력삭제 줄 × = 종전 두 단추 창 그대로', st);
            await p.click('#om-ask-no');
            await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-x').click(); await p.click('#om-ask-mid'); await until(() => S.deleted.has(190)); await p.waitForTimeout(300);
            st = await p.evaluate(() => ({ p201: [...document.querySelectorAll('#om-ctw tbody tr')].filter(tr => /주소줄손님/.test(tr.textContent)).map(tr => tr.querySelector('.om-ct-p .om-pill').textContent)[0], lines: document.querySelectorAll('#om-list .om-ml').length }));
            ok(S.deleted.size === 1 && st.p201 === '입력삭제 풀림 …4123' && st.lines === 1, '[줄만 지우기] = 입력삭제 줄만 DELETE · 주소 줄 201 알약 「입력삭제 풀림 …4123」', { del: [...S.deleted], st });
            S.deleted = new Set(); await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 2));
            await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-x').click(); await p.click('#om-ask-yes'); await until(() => S.deleted.has(190) && S.deleted.has(201)); await p.waitForTimeout(200);
            ok(S.deleted.size === 2, '[주소 줄도 같이 지우기] = 입력삭제 줄 190 + 주소 줄 201 DELETE', [...S.deleted]);
            // ② 풀린 줄 = 글로만 · 알약 · 고치기 카드 안내 + [현금으로]
            S.deleted = new Set(); S.px2 = false; S.px3 = true; await openPx(p, 'new'); await p.waitForTimeout(300);
            st = await p.evaluate(() => { const b = document.querySelector('#om-card .om-pair'); return { chk: b.querySelectorAll('input[data-cact="chk"]').length, note: [...b.querySelectorAll('.om-pair-s')].map(x => x.textContent).join(' | ') }; });
            ok(st.chk === 2 && /풀린 주소 줄 1개\(김보은\)는 저장하면 저절로 붙어요/.test(st.note), '② 카드 = 같은 번호 「!」 2줄만 체크 · 풀린 줄 193 은 「저장하면 저절로 붙어요(풀림)」 글로만', st);
            await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100);
            st = await p.evaluate(() => [...document.querySelectorAll('#om-ctw tbody tr')].filter(tr => /김보은/.test(tr.textContent)).map(tr => tr.querySelector('.om-ct-p .om-pill').textContent)[0]);
            ok(st === '입력삭제 풀림 …0535', '오른쪽 표 193 알약 「입력삭제 풀림 …0535」(흰·회색)', st);
            await p.locator('#om-ctw tbody tr', { hasText: '김보은' }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(150);
            st = await p.evaluate(() => ({ note: (document.querySelector('#om-card .om-indiv') || {}).textContent, btn: !!document.querySelector('#om-card [data-cact="tocash"]'), py: !!document.querySelector('#om-card [data-cact="pyopen"]') }));
            ok(/입력삭제 줄이 없어요\(「풀림」\)/.test(st.note || '') && /다시 넣으면 저절로 붙어요/.test(st.note) && st.btn && !st.py, '풀린 줄 고치기 카드 = 안내 「입력삭제 줄이 없어요(풀림) · 다시 넣으면 저절로 붙어요 · 현금으로 두려면 [현금으로]」 + [현금으로] 단추', st);
            S.puts = []; await p.click('#om-card [data-cact="tocash"]'); await until(() => S.puts.length); await p.waitForTimeout(200);
            st = await p.evaluate(() => document.getElementById('om-card').hidden);
            ok(S.puts.length === 1 && S.puts[0].cells[0] === '이형주 드림!' && S.puts[0].cells[10] === PXO && S.puts[0].cells[1] === PXO && S.puts[0].to_cash === true && st, '[현금으로] = PUT 1(A칸 「이형주 드림!」 · to_cash:true · #949 보관값 없는 옛 줄 · B 가 입력삭제 번호 아님 = K = B) · 카드 닫힘', S.puts[0]);
            {   // 워커2 점검 ① = 서버 PUT 의 next 식 + checkRow 를 order-memo.js 그대로 떼어 실행 → 실제 저장될 A칸·indiv
                const OMS = require(path.join(ROOT, 'order-memo.js')), src = fs.readFileSync(path.join(ROOT, 'order-memo.js'), 'utf8').replace(/\r\n/g, '\n');
                const m = src.match(/\? (\{ kind: 'cash', cells: [^\n]*?\})   \/\/ #900 서비스 켬/); if (!m) throw new Error('PUT next 식을 못 찾음');
                const nextOf = (cur, b, svc) => new Function('cur', 'b', 'svc', 'toCashCells', 'toIndivCells', 'toCashDate', 'return ' + m[1])(cur, b, svc, OMS.toCashCells, OMS.toIndivCells, OMS.toCashDate), ctx = { today: '2026-11-01', catalog: new Set(CAT), origin: '제주시 연삼로 1066-31' };
                const cur = { kind: 'cash', service: false, ship_date: null, cells: ['이형주 드림', PXO, '제주시 연삼로 1066-31', '김보은', CAT[1], '1', '010-4787-4217', '', '충남 보령시 동대동 8', '', PXK, '', ''] };
                const sent = cur.cells.slice(); sent[0] = '이형주 드림!';
                const a = OMS.checkRow(nextOf(cur, { cells: sent, to_cash: true }, false), ctx), b = OMS.checkRow(nextOf(cur, { cells: sent }, false), ctx);
                const sentBK = cur.cells.slice(); sentBK[0] = '홍길동 드림!'; sentBK[1] = PXK; const ak = OMS.checkRow(nextOf(cur, { cells: sentBK, to_cash: true }, false), ctx);
                const back = cur.cells.slice(); const ri = OMS.checkRow(nextOf(Object.assign({}, cur, { cells: a.cells }), { cells: back, to_indiv: true }, false), ctx), ri0 = OMS.checkRow(nextOf(Object.assign({}, cur, { cells: a.cells }), { cells: back }, false), ctx);
                ok(ak.cells[1] === '010-4787-4217' && ri.cells[0] === '이형주 드림' && ri.indiv === true && ri.cells[10] === PXK && ri0.indiv === false && /!/.test(ri0.cells[0]), '#944 서버 = B 가 옛 K(3292)면 B 도 받는 분 4217 · 되돌리기 to_indiv = A 「!」 없음·indiv true·K 그대로(to_indiv 없이는 DB 「!」 따라 다시 현금 = 종전 결함 재현)', { ak: ak.cells[1], ri: [ri.cells[0], ri.indiv, ri.cells[10]], ri0: [ri0.cells[0], ri0.indiv] });
                ok(a.cells[0] === '이형주 드림!' && a.indiv === false && a.cells[10] === PXO && a.cells[1] === PXO && b.cells[0] === '이형주 드림' && b.indiv === true, '서버 PUT 실제 저장값 = to_cash:true → A칸 「이형주 드림!」·현금(indiv false)·#949 옛 줄 K = B · to_cash 없이는 종전대로 「!」 지워져 풀림 그대로', { a: [a.cells[0], a.cells[10], a.cells[1], a.indiv], b: [b.cells[0], b.indiv] });
            }
            st = await p.evaluate(() => ({ undo: !document.getElementById('om-undo').hidden, t: document.getElementById('om-undo-t').textContent }));
            ok(st.undo && /현금으로 변경했어요/.test(st.t), '[현금으로 변경하기] 뒤 되돌리기 띠(#944 글 통일)', st);
            await p.locator('#om-ctw tbody tr', { hasText: '주소줄손님' }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(150);
            st = await p.evaluate(() => ({ note: (document.querySelector('#om-card .om-indiv') || {}).textContent, btn: !!document.querySelector('#om-card [data-cact="tocash"]') }));
            ok(st.note === '입력삭제 주문의 주소 줄이에요 · 입력삭제 줄을 지우면 이 줄은 「풀림」이 돼요' && st.btn, '붙어 있는 주소 줄 고치기 카드 = 안내 한 줄 더 · [현금으로 변경하기] 단추(#944)', st);
            const dt = await p.evaluate(() => { const b = document.querySelector('#om-card [data-cact="tocash"]'); return { t: b.textContent.trim(), s: b.nextElementSibling && b.nextElementSibling.textContent }; });
            ok(dt.t === '현금으로 변경하기' && /구매자·보내는 분 번호는 붙이기 전으로 돌아가요/.test(dt.s || ''), '#949 [현금으로 변경하기] + 안내 「구매자·보내는 분 번호는 붙이기 전으로 돌아가요」', dt);
            S.puts = []; S.pairs = []; await p.click('#om-card [data-cact="tocash"]'); await until(() => S.puts.length); await p.waitForTimeout(250);
            st = await p.evaluate(() => ({ card: document.getElementById('om-card').hidden, undo: !document.getElementById('om-undo').hidden, t: document.getElementById('om-undo-t').textContent }));
            ok(S.puts[0].to_cash === true && S.puts[0].cells[0] === '홍길동 드림!' && S.puts[0].cells[10] === '010-3300-0001' && S.puts[0].cells[1] === '010-3300-0001' && st.card && st.undo && /현금으로 변경했어요/.test(st.t) && /구매자 번호를 확인해 주세요/.test(st.t), '#944 [현금으로 변경하기] = PUT to_cash · A 「홍길동 드림!」 · K = 받는 분 3300-0001 · B(=옛 K 꼴 빈 칸 → 서버가 새 K 로) · 카드 닫힘 · 띠 「현금으로 변경했어요」', { put: S.puts[0], st });
            await p.click('#om-undo-b'); await until(() => S.pairs.length); await p.waitForTimeout(200);
            ok(JSON.stringify(S.pairs[0]) === JSON.stringify({ key: PXL, ids: [201], pick: true }), '#944 되돌리기 = 같은 입력삭제 번호로 POST pair {key 5738, ids 201, pick}', S.pairs);
            { S.pxOrig = true; await openMemo(p, 'new', 4, 1); await p.locator('#om-ctw tbody tr', { hasText: '주소줄손님' }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) [data-cact="tocash"]'); S.puts = []; await p.click('#om-card [data-cact="tocash"]'); await until(() => S.puts.length); await p.waitForTimeout(200); const tx = await p.evaluate(() => document.getElementById('om-undo-t').textContent); ok(S.puts[0].to_cash === true && S.puts[0].cells[10] === '010-1234-8247' && S.puts[0].cells[1] === '010-1234-8247' && !/구매자 번호를 확인/.test(tx), '#949 화면 미러 = 보관값 있으면 B·K 원복 · 확인 안내 없음', { c: S.puts[0].cells, tx }); S.pxOrig = false; await openMemo(p, 'new', 4, 1); S.pairs = []; S.puts = []; }
            // ④ 판 「붙은 주소 줄」 [떼기] · 안내 한 줄
            S.puts = []; await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-px, .om-badge').first().click(); await p.waitForSelector('#om-card:not([hidden]) .om-pairx');
            st = await p.evaluate(() => { const pr = document.querySelector('#om-card .om-px-paired'); return { head: pr && pr.previousElementSibling.textContent, det: pr ? [...pr.querySelectorAll('[data-cact="pxdetach"]')].map(b => b.dataset.v) : null }; });
            ok(String(st.head || '').includes('잘못 붙였으면 [현금으로 변경]') && st.det && st.det.join() === '201', '#944 ④ 판 「붙은 주소 줄」 = 안내 「잘못 붙였으면 [현금으로 변경]…」 · 201 에 [현금으로 변경](서비스 줄엔 없음)', st);
            await p.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="201"]'); await until(() => S.puts.length); await p.waitForTimeout(250);
            ok(S.puts[0].to_cash === true && S.puts[0].cells[0] === '홍길동 드림!' && S.puts[0].cells[10] === '010-3300-0001', '#944 ④ [떼기] = 같은 PUT(to_cash · 「!」 · K 받는 분)', S.puts[0]);
            st = await p.evaluate(() => ({ closed: document.getElementById('om-card').hidden, undo: !document.getElementById('om-undo').hidden })); ok(st.closed && st.undo, '#944 ④ [현금으로 변경] 성공 = 카드 닫힘 · 되돌리기 띠(안 가림)', st); S.pairs = []; await p.click('#om-undo-b', { timeout: 4000 }); await until(() => S.pairs.length); ok(S.pairs[0].pick === true && (S.pairs[0].ids || []).join() === '201', '#944 되돌리기 실클릭 = pair pick', S.pairs[0]);
            // ③ 발송일이 뒤인 줄(날짜 대기 · #870) = 풀림 아님
            S.px3Later = true; await openMemo(p, 'new', 4, 1); await jusoQuiet();
            st = await p.evaluate(() => [...document.querySelectorAll('#om-ctw tbody tr')].filter(tr => /김보은/.test(tr.textContent)).map(tr => tr.querySelector('.om-ct-p .om-pill').textContent)[0]);
            await p.locator('#om-ctw tbody tr', { hasText: '김보은' }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(150);
            const st3 = await p.evaluate(() => ({ note: (document.querySelector('#om-card .om-indiv') || {}).textContent, btn: !!document.querySelector('#om-card [data-cact="tocash"]') }));
            ok(st === '입력삭제 …0535' && st3.note === '입력삭제 줄은 그날 나갔고 이 줄은 발송일(12/31)까지 기다려요' && st3.btn, '발송일 뒤 주소 줄(입력삭제 줄 없음) = 풀림 아님 · 알약 종전 「입력삭제 …0535」 · 카드 안내 「발송일(12/31)까지 기다려요」 · [현금으로 변경하기] 있음(#944 · 되돌리기 = 옛 칸)', { st, st3 });
            await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100); S.px3Later = false;
            // ④ 여러 줄 골라 지우기(입력삭제 줄 섞임) = 제목에 개수·이름
            S.px3 = false; S.px2 = true; S.deleted = new Set(); await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 2));
            await p.check('#om-selall'); await p.click('#om-ldel'); st = await ask();
            ok(!st.hidden && /^고른 2줄\(/.test(st.h) && /그중 입력삭제 줄 때문에 주소 줄 1개가 짝을 잃어요$/.test(st.h) && st.mid && st.three, '여러 줄 골라 지우기(입력삭제 줄 섞임) = 「고른 2줄(…) 삭제 · 그중 입력삭제 줄 때문에 주소 줄 1개가 짝을 잃어요」 세 갈래', st);
            await p.click('#om-ask-no');
            // ② 저장 중 재조회 끝나도 다시 안 그림(저장 단추 되살아남 0)
            S.px2 = false; S.listDelay = 1500; await openPx(p, 'new'); S.listDelay = 3000;   // px2 끔 = 같은 입력삭제 줄이 목록에 있으면 「같은 줄」로 저장이 빠짐   // 카드 열 때 재조회 GET 가 1.5초 뒤 답 → 그 전에 [저장]
            await p.click('#om-card-save'); await p.waitForTimeout(500);
            const s1 = await p.evaluate(() => ({ dis: document.getElementById('om-card-save').disabled, t: document.getElementById('om-card-save').textContent.trim(), card: document.getElementById('om-card').hidden }));
            await p.waitForTimeout(1500); S.listDelay = 0;   // 재조회(1.5초) 답이 온 뒤 · 저장의 dupCheck GET 은 3초라 아직 저장 중(저장은 dupCheck GET 도 1.5초 지연 → 아직 저장 중)
            const s2 = await p.evaluate(() => ({ dis: document.getElementById('om-card-save').disabled, t: document.getElementById('om-card-save').textContent.trim(), card: document.getElementById('om-card').hidden }));
            await until(() => S.saves.length); await p.waitForTimeout(300);
            ok(s1.dis && !s1.card && s2.dis && !s2.card && s2.t === s1.t && S.saves.length === 1, '저장 중 재조회가 끝나도 카드 다시 안 그림(저장 단추 잠김 그대로 · 저장 1회)', { s1, s2, saves: S.saves.length });
            ok(pe.length === 0, '#935 1280 스크립트 오류 0', pe);
            await c.close();
            // 폰 390 = 세 갈래 확인 창 넘침 0 · 44px
            { S.px3 = false; S.px2 = true; S.deleted = new Set();
                const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }); const p2 = await c2.newPage(); const pe2 = []; p2.on('pageerror', e => pe2.push(String(e)));
                await openMemo(p2, 'new', 4, 1); await until(() => p2.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 2));
                await p2.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-x').click(); await p2.waitForSelector('#om-ask:not([hidden])');
                const m = await p2.evaluate(() => { const a = document.getElementById('om-ask'), r = a.getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, right: Math.round(r.right), hs: [...a.querySelectorAll('button')].filter(b => !b.hidden).map(b => Math.round(b.getBoundingClientRect().height)), n: [...a.querySelectorAll('button')].filter(b => !b.hidden).length }; });
                ok(m.sw <= 390 && m.right <= 390 && m.n === 3 && m.hs.every(h => h >= 44), '390폭 세 갈래 확인 창 = 넘침 0 · 단추 3개 44px↑', m);
                await p2.click('#om-ask-no');
                ok(pe2.length === 0, '390폭 #935 스크립트 오류 0', pe2);
                await c2.close(); }
            S.px = false; S.px2 = false; S.px3 = false; S.deleted = new Set(); S.preview = null; }
        // ── ⑦ #936 입력삭제 줄 배지(메모함 기준 미리보기) · 서비스 체크 · 옛 서버 · A 나란히(indivBadge ↔ final-order-core cashCheck) ──
        console.log('⑦ #936 입력삭제 줄 배지 · 추가 매칭 판 서비스 체크 · 나란히 검증');
        { S.px = true; S.px2 = false; S.px3 = false; S.deleted = new Set(); S.services = [];
            const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); const pe = []; p.on('pageerror', e => pe.push(String(e)));
            const readBadge = () => p.evaluate(() => { const b = document.querySelector('#om-list .om-ml .om-badge'); return { has: !!b, t: b && b.textContent, k: b && [...b.classList].find(x => /^k-/.test(x)), px: !!document.querySelector('#om-list .om-ml-px') }; });
            const B = { ok: { m: 15, n: 15, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'ok' }, short: { m: 15, n: 12, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'short' }, over: { m: 15, n: 16, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'over' },
                unknown: { m: null, n: 15, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'unknown' }, personal: { m: 1, n: 1, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'personal' },
                tails: { m: 15, n: 14, later: 1, later_date: '2026-11-04', service: 1, pre: false, item_diff: true, state: 'split' }, shortLater: { m: 15, n: 13, later: 1, later_date: '2026-11-04', service: 0, pre: false, item_diff: false, state: 'short' }, allLater: { m: 3, n: 0, later: 3, later_date: '2026-11-04', service: 0, pre: false, item_diff: false, state: 'split' }, unsure: { m: 15, n: 15, unsure: 2, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'ok' }, fixed: { m: 15, n: 15, unsure: 0, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'ok' }, overUnsure: { m: 15, n: 16, unsure: 1, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'over' } };
            const want = { ok: ['15/15 매칭완료', 'k-ok'], short: ['12/15 · 3박스 모자람', 'k-short'], over: ['16/15 · 1박스 초과', 'k-over'], unknown: ['15/? 주문 확인 중', 'k-unk'], personal: ['개인결제창 · 주소 줄 1', 'k-pers'], tails: ['14/15 오늘 · 1박스 11/4 대기 · 서비스 1 · 품목 다름', 'k-later'], shortLater: ['13/15 오늘 · 1박스 11/4 대기 · 1박스 모자람', 'k-short'], allLater: ['0/3 오늘 · 3박스 11/4 대기', 'k-later'], unsure: ['15/15 · 확인 필요 2', 'k-short'], fixed: ['15/15 매칭완료', 'k-ok'], overUnsure: ['16/15 · 1박스 초과 · 확인 필요 1', 'k-over'] };
            for (const k of Object.keys(B)) { S.badges = { 190: B[k] }; await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 1)); const st = await readBadge(); ok(st.has && st.t === want[k][0] && st.k === want[k][1] && !st.px, `배지 ${k} = 「${want[k][0]}」 · ${want[k][1]} · 글 단추 없음`, st); }
            S.badges = {}; await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 1));
            let st = await readBadge(); ok(!st.has && st.px, '옛 서버(badge 없음) = 알약 없음 · 종전 [추가 매칭] 글 단추', st);
            // 누르면 ④ 판 + 붙은 주소 줄(201) 서비스 체크 → POST /service
            S.badges = { 190: B.short }; await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => !!document.querySelector('#om-list .om-badge')));
            await p.click('#om-list .om-badge'); await p.waitForSelector('#om-card:not([hidden]) .om-pairx');
            st = await p.evaluate(() => { const x = document.querySelector('#om-card .om-pairx'), pr = x.querySelector('.om-px-paired'); return { title: document.getElementById('om-card-t').textContent.trim(), cands: x.querySelectorAll('input[data-cact="pxchk"]').length, paired: pr ? [...pr.querySelectorAll('li > span:first-child')].map(s => s.textContent.split(' · ')[0]) : null, svc: pr ? [...pr.querySelectorAll('input[data-cact="pxsvc"]')].map(i => i.dataset.v + ':' + i.checked) : null, head: pr && pr.previousElementSibling.textContent }; });
            ok(/메모 고치기/.test(st.title) && st.cands === 4 && st.paired && st.paired.join() === '주소줄손님' && st.svc && st.svc.join() === '201:false' && /붙은 주소 줄 1줄 · 1박스/.test(st.head || ''), '배지 누르면 ④ 판(짝 없는 현금 4줄) + 「붙은 주소 줄 1줄 · 1박스」 201 서비스 체크(꺼짐)', st);
            await p.check('#om-card .om-px-paired input[data-cact="pxsvc"][data-v="201"]'); await until(() => S.services.length); await p.waitForTimeout(300);
            ok(JSON.stringify(S.services[0]) === JSON.stringify({ ids: [201], on: true }) && /서비스 줄로 바꿨어요/.test((await p.evaluate(() => (window.__toasts || []).slice(-1)[0])) || ''), '서비스 체크 = POST /api/order-memo/service { ids:[201], on:true } · 토스트 · 목록 다시', S.services);
            await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(100);
            ok(pe.length === 0, '#936 1280 스크립트 오류 0', pe);
            await c.close();
            // 폰 390 · 폴드 900(손가락) = 배지 단추 44px · 넘침 0
            for (const [w, h] of [[390, 844], [900, 900]]) {
                const c2 = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 721, deviceScaleFactor: 1 }); const p2 = await c2.newPage(); const pe2 = []; p2.on('pageerror', e => pe2.push(String(e)));
                S.badges = { 190: B.tails }; await openMemo(p2, 'new', 4, 1); await until(() => p2.evaluate(() => !!document.querySelector('#om-list .om-badge')));
                const m = await p2.evaluate(() => { const b = document.querySelector('#om-list .om-badge'), r = b.getBoundingClientRect(), li = b.closest('.om-ml'); return { sw: document.documentElement.scrollWidth, h: Math.round(r.height), right: Math.round(r.right), liOver: li.scrollWidth - li.clientWidth }; });
                ok(m.sw <= w && m.liOver <= 0 && m.right <= w && m.h >= 44, `${w}폭 긴 배지(덧말 셋) = 넘침 0 · 단추 44px↑`, m);
                ok(pe2.length === 0, `${w}폭 #936 스크립트 오류 0`, pe2);
                await c2.close();
            }
            S.badges = {};
            // A. 나란히 = indivBadge(order-memo.js) ↔ final-order-core cashCheck(+parseCash) · 같은 가짜 자료 · DB 0
            { const OMS = require(path.join(ROOT, 'order-memo.js')), core = require(path.join(ROOT, 'public', 'final-order-core.js'));
                const BASE = '2026-11-03', OPT = CAT[1], OPT2 = CAT[0], cat = new Set(CAT), K0 = '010-3292-0535', D0 = K0.replace(/\D/g, '');
                const cells = (nm, opt, qty, more) => Object.assign({ kind: 'cash', state: 'open', sure: true, service: false, ship_date: null, cells: ['강명희 드림', K0, '제주시 연삼로 1066-31', nm, opt, String(qty), '010-2111-9887', '', '충남 천안시 ' + nm, '', K0, '', ''] }, more || {});
                const order = (qty, opt, more) => Object.assign({ channel: 'naver', buyer_digits: D0, option_text: opt, qty }, more || {});
                const LINE = { line_key: K0, plat: '네이버', used_on: null };
                const side = (rows, orders, waitingIds) => {   // 최종발주 쪽 = pickForShip 과 같은 규칙으로 현금파일을 만든 뒤 cashCheck
                    // #936-b 최종발주(for-ship held)는 확인 줄 제외 = 배지와 의도된 차이(배지는 세고 「확인 필요 k」) → 나란히는 sure 줄만
                    const today = rows.filter(r => (!r.ship_date || r.ship_date === BASE) && r.sure !== false), aoa = [core.HEADERS.slice()].concat(today.map(r => r.cells.slice(0, 13)));   // pickForShip = 날짜 없음 또는 == 기준일만 현금파일(뒤 = waiting · 앞 = held)
                    const cash = core.parseCash(aoa); cash.rows.forEach((r, i) => { r.service = !!today[i].service; });
                    const chk = core.cashCheck({ orders: orders.map((o, i) => ({ key: 'o' + i, digits: D0, qty: o.qty, opt: o.option_text, individual: true, excluded: false, buyer: '강명희' })), cash: cash.rows });
                    const m = orders.reduce((t, o) => t + o.qty, 0), bd = chk.boxDiff.find(x => x.digits === D0), miss = chk.missing.find(x => x.digits === D0), str = chk.strangers.find(x => x.digits === D0);
                    return { m: orders.length ? m : null, n: miss ? 0 : bd ? bd.cashQty : str ? str.rows.length ? cash.rows.filter(r => !r.bang && !r.service && r.digits === D0).reduce((t, r) => t + r.qty, 0) : 0 : m, itemDiff: !!(chk.itemDiff && chk.itemDiff.length) };
                };
                const cases = [
                    ['1건 3박스 · 주소 줄 3', [cells('가', OPT, 1), cells('나', OPT, 1), cells('다', OPT, 1)], [order(3, OPT)], 'ok'],
                    ['2건 4+8 · 주소 줄 12', Array.from({ length: 12 }, (_, i) => cells('손' + i, i < 4 ? OPT : OPT2, 1)), [order(4, OPT), order(8, OPT2)], 'ok'],
                    ['서비스 1 = 셈 밖', [cells('가', OPT, 1), cells('나', OPT, 1), cells('다', OPT, 1), cells('서비스', OPT, 1, { cells: ['강명희 드림!', K0, '', '서비스', OPT, '1', '010-1', '', '서울', '', K0, '', ''], service: true })], [order(3, OPT)], 'ok'],
                    ['날짜 지정 1 = 대기(n 2 + 대기 1 = 3 → split 중립 · core 는 오늘 2 vs 3)', [cells('가', OPT, 1), cells('나', OPT, 1), cells('다', OPT, 1, { ship_date: '2026-11-10' })], [order(3, OPT)], 'split'],
                    ['지난 날짜 줄 1 = held(n 에서 뺌 · 3 vs 4 → short)', [cells('가', OPT, 1), cells('나', OPT, 1), cells('다', OPT, 1), cells('라', OPT, 1, { ship_date: '2026-10-30' })], [order(4, OPT)], 'short'],
                    ['B 만 그 번호인 줄 = 셈 밖(K 만 · 3 vs 3 ok)', [cells('가', OPT, 1), cells('나', OPT, 1), cells('다', OPT, 1), cells('라', OPT, 1, { cells: ['강명희 드림', K0, '제주시', '라', OPT, '1', '010-9999-0001', '', '서울', '', '010-9999-0001', '', ''] })], [order(3, OPT)], 'ok'],
                    ['주문 없음 = unknown', [cells('가', OPT, 1), cells('나', OPT, 1)], [], 'unknown'],
                    ['품목 다름(합 같음)', [cells('가', OPT, 2), cells('나', OPT2, 1)], [order(3, OPT)], 'ok'],
                ];
                for (const [name, rows, orders, state] of cases) {
                    const b = OMS.indivBadge(LINE, rows, orders, BASE, { catalog: cat }), s2 = side(rows, orders);
                    ok(b.state === state && b.m === s2.m && b.n === s2.n && b.item_diff === s2.itemDiff, `나란히 ${name} = badge m ${b.m}·n ${b.n}·${b.state}${b.item_diff ? '·품목 다름' : ''} ↔ core m ${s2.m}·n ${s2.n}${s2.itemDiff ? '·itemDiff' : ''}`, { badge: b, core: s2 });
                }
                const bw = OMS.indivBadge(LINE, cases[3][1], cases[3][2], BASE, { catalog: cat });
                ok(bw.later === 1 && bw.later_date === '2026-11-10' && bw.n === 2 && bw.state === 'split' && OMS.indivBadge(LINE, cases[2][1], cases[2][2], BASE, { catalog: cat }).service === 1, '배지 = 2 오늘 + 1 대기(11/10) = 3 → split · 서비스 1', bw);
                const bl = OMS.indivBadge(Object.assign({}, LINE, { used_on: '2026-11-01', ship_date: '2026-11-04' }), [cells('가', OPT, 1, { ship_date: '2026-11-04' }), cells('나', OPT, 1, { ship_date: '2026-11-04' }), cells('다', OPT, 1, { ship_date: '2026-11-04' })], [order(3, OPT)], '2026-11-01', { catalog: cat });
                ok(bl.state === 'split' && bl.n === 0 && bl.later === 3 && OMS.indivBadge(Object.assign({}, LINE, { used_on: '2026-11-04', ship_date: '2026-11-04' }), cases[0][1], cases[0][2], BASE, { catalog: cat }).state !== 'sent', '#948 뒤 날짜(11/4) 줄 = 「0/3 오늘 · 3박스 11/4 대기」 · used_on 있어도 발송됨 없음', bl);
                const REAL = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)', C3 = Object.assign({}, LINE, { plat: '자사몰' }), o3 = [order(1, REAL, { channel: 'cafe24' }), order(1, REAL, { channel: 'cafe24' }), order(1, REAL, { channel: 'cafe24' })];
                const bc = OMS.indivBadge(C3, [cells('가', REAL, 1)], o3, BASE, { catalog: cat }), bc2 = OMS.indivBadge(C3, [cells('가', REAL, 1), cells('나', REAL, 1), cells('다', '다른 품목 1kg', 1)], o3, BASE, { catalog: cat });
                const bu = OMS.indivBadge(LINE, [cells('가', OPT, 1), cells('나', OPT, 1), cells('다', OPT, 1, { sure: false })], [order(3, OPT)], BASE, { catalog: cat });
                const bu2 = OMS.indivBadge(LINE, [cells('가', OPT, 1), cells('나', OPT, 1), cells('다', OPT, 1, { sure: false, ship_date: '2026-11-10' })], [order(3, OPT)], BASE, { catalog: cat });
                ok(bu2.unsure === 1 && bu2.later === 1 && bu2.n === 2, '#936-b 뒤 날짜 확인 줄도 unsure 에 셈(오늘 2 + 대기 1 · 확인 필요 1)', bu2);
                ok(bu.state === 'ok' && bu.n === 3 && bu.unsure === 1, '#936-b 확인 줄(sure false) 1 = 박스는 셈(3/3 ok) + unsure 1(화면 = 호박 「3/3 · 확인 필요 1」)', bu);
                ok(bc.state === 'short' && bc.m === 3 && bc.n === 1 && bc2.state === 'ok' && bc2.item_diff === false, '자사몰 수량 1 주문 3건(단가표 품목 = optionKey match) = 개인결제창 아님 → 1/3 모자람 · 3/3 ok(자사몰은 품목 다름 안 봄)', { bc, bc2 });
                { const U0 = OMS.indivBadge(Object.assign({}, LINE), cases[0][1], cases[0][2], BASE, { catalog: cat }), U1 = OMS.indivBadge(Object.assign({}, LINE, { used_on: '2026-11-01' }), cases[0][1], cases[0][2], BASE, { catalog: cat }); ok(JSON.stringify(U0) === JSON.stringify(U1) && U1.state !== 'sent', '#948 used_on 있어도 배지 그대로(발송됨 없음 · n/m)', { U0, U1 }); }
                ok(OMS.indivBadge(Object.assign({}, LINE, { plat: '자사몰' }), [cells('가', '개인결제 1건', 1)], [order(1, '개인결제 1건', { channel: 'cafe24' })], BASE, { catalog: cat }).state === 'personal' && OMS.indivBadge(Object.assign({}, LINE, { plat: '쿠팡' }), cases[0][1], cases[0][2], BASE, { catalog: cat }).state === 'unknown', '배지 state = 발송됨(used_on) · 자사몰 수량 1 단가표 밖 = 개인결제창 · 줄 판매처(쿠팡)와 다른 채널 주문은 셈 밖(unknown)', null);
            }
            S.px = false; }
        // ── ⑧ #938 같은 구매자 주문 2건 = 주문별 발송일(나눠 저장·합치기·배지) ──
        console.log('⑧ #938 주문별 발송일 = 주문번호 줄 나눠 저장 · 합치기 · 배지');
        { S.px = true; S.px2 = false; S.px3 = false; S.deleted = new Set(); S.badges = {}; S.lines938 = false;
            const OA = '2026110146930531', OB = '2026110146930532', OPTA = '고당도 타이벡감귤 / 상품 및 과수: 선물용 - 3kg(로얄과 2S~M)', OPTB = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)';
            const mk = (no, qty, opt, more) => Object.assign({ plat: '네이버', as: 'buyer', buyer_name: '강명희', recv_name: '이하정', recv_initial: '이', addr: '충남 천안시', option: opt, qty, order_no: no, pno: no, paid_at: '2026-11-01 11:35', buyer_phone: null }, more || {});
            S.lookup = { [PXK.replace(/\D/g, '')]: [mk(OA, 4, OPTA), mk(OB, 8, OPTB)], [PXL.replace(/\D/g, '')]: [mk('9000000001', 4, OPTA), mk('9000000002', 8, OPTB)], 9000000001: [mk('9000000001', 4, OPTA, { as: 'order' })], 9000000002: [mk('9000000002', 8, OPTB, { as: 'order' })] };
            S.preview = { ok: true, rows: [{ kind: 'line', key: PXK, note: '입력o삭제x', plat: '네이버', line: ['', PXK, '입력o삭제x', '네이버'].join('\t'), sure: true, check_why: [] }] };
            const openPx = async (p, v) => { await openMemo(p, v, 4, 1); S.pairs = []; S.saves = []; S.puts = []; await p.evaluate(t => window.AkmOrderMemo.fromText(t), PXK + ' 입력o삭제x 네이버'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(150); };
            const panel = () => p.evaluate(() => { const b = document.querySelector('#om-ord-0 .om-ordbox'); return { has: !!b, items: b ? [...b.querySelectorAll('.om-ordl li')].map(li => ({ o: li.querySelector('input[data-cact="ordchk"]').dataset.o, on: li.querySelector('input[data-cact="ordchk"]').checked, d: li.querySelector('input[data-cact="orddate"]').value, dis: li.querySelector('input[data-cact="orddate"]').disabled })) : [], note: b ? b.querySelector('.om-ordn').textContent : '' }; });
            const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); const pe = []; p.on('pageerror', e => pe.push(String(e)));
            // 1 판 = 주문 2건 · 전부 체크 · 날짜 빈 칸 · 안내
            await openPx(p, 'new'); await until(() => p.evaluate(() => !!document.querySelector('#om-ord-0 .om-ordbox')));
            let st = await panel();
            ok(st.has && st.items.length === 2 && st.items.every(x => x.on && x.d === '' && !x.dis) && st.items[0].o === OA && /주문별 발송일이 다르면 주문번호 줄로 나뉘어 저장돼요/.test(st.note) && /전화번호 줄 하나로 저장돼요/.test(st.note), '전화번호 줄 + 주문 2건(A 4박스·B 8박스) = 「이 주문」 체크 2(기본 전부) + 발송일 칸 + 안내 「…주문번호 줄로 나뉘어 저장돼요」', st);
            // 2 B 만 11/4 → 저장 = 주문번호 줄 2(A 날짜 없음 · B 11/4 · note·plat 그대로 · checked.buyer = 전화번호 · 전화번호 줄 0)
            await p.fill(`#om-ord-0 input[data-cact="orddate"][data-o="${OB}"]`, '11/4'); await p.keyboard.press('Tab'); await p.waitForTimeout(100);
            st = await panel();
            ok(st.items[1].d === '11/4' && /주문번호 줄 2개로 나뉘어 저장돼요/.test(st.note) && /11\/4 주문\(8박스\)의 주소 줄 8개에는 발송일 칸에 11\/4를 직접 넣어 주세요/.test(st.note), 'B 발송일 11/4 = 안내 「주문번호 줄 2개로 나뉘어… · 11/4 주문(8박스)의 주소 줄 8개에는 발송일 칸에 11/4를 직접 넣어 주세요」', st);
            await p.click('#om-card-save'); await until(() => S.saves.length); await p.waitForTimeout(250);
            let rows = S.saves[0] && S.saves[0].rows;
            ok(rows && rows.length === 2 && rows[0].kind === 'line' && rows[0].key === OA && rows[0].ship_date === null && rows[1].key === OB && rows[1].ship_date === '2026-11-04' && rows.every(r => r.note === '입력o삭제x' && r.plat === '네이버' && r.checked && r.checked.buyer === PXK && r.checked.as === 'order') && rows[1].line === ['11/4', OB, '입력o삭제x', '네이버'].join('\t') && !rows.some(r => r.key === PXK), '저장 = 주문번호 줄 2개(A 날짜 없음 · B 2026-11-04 · note·plat 그대로 · checked.buyer = 010-3292-0535 · line 「11/4⇥주문번호⇥입력o삭제x⇥네이버」) · 전화번호 줄 0', rows);
            // 3 전부 같음 = 전화번호 줄 1(옛 js 저장 본문과 바이트 동일)
            let oldBody; { const c0 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p0 = await c0.newPage(); await openMemo(p0, 'mix', 4, 1); S.saves = []; await p0.evaluate(t => window.AkmOrderMemo.fromText(t), PXK + ' 입력o삭제x 네이버'); await p0.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p0.waitForTimeout(400); await p0.click('#om-card-save'); await until(() => S.saves.length); oldBody = JSON.stringify(S.saves[0]); await c0.close(); }
            await openPx(p, 'new'); await until(() => p.evaluate(() => !!document.querySelector('#om-ord-0 .om-ordbox'))); await p.click('#om-card-save'); await until(() => S.saves.length); await p.waitForTimeout(250);
            const noAt = s => s.replace(/"at":"[^"]*"/g, '"at":"T"'); ok(S.saves[0].rows.length === 1 && S.saves[0].rows[0].key === PXK && noAt(JSON.stringify(S.saves[0])) === noAt(oldBody), '주문별 발송일이 전부 같으면 = 전화번호 줄 1개 · 저장 본문 종전(HEAD) js 와 바이트 동일', { now: JSON.stringify(S.saves[0]).slice(0, 200), old: oldBody.slice(0, 200) });
            // 4 일부만 체크(A 끔) = B 주문번호 줄 1
            await openPx(p, 'new'); await until(() => p.evaluate(() => !!document.querySelector('#om-ord-0 .om-ordbox'))); await p.uncheck(`#om-ord-0 input[data-cact="ordchk"][data-o="${OA}"]`); st = await panel();
            ok(st.items[0].on === false && st.items[0].dis === true && /주문번호 줄 1개로 나뉘어/.test(st.note), 'A 체크 끔 = A 발송일 칸 잠김 · 안내 「주문번호 줄 1개로…」', st);
            await p.click('#om-card-save'); await until(() => S.saves.length); await p.waitForTimeout(250); rows = S.saves[0].rows;
            ok(rows.length === 1 && rows[0].key === OB && rows[0].ship_date === null && rows[0].checked.buyer === PXK, '일부 체크(B 만) 저장 = B 주문번호 줄 1(날짜 없음 = 줄 발송일) · 전화번호 줄 0', rows);
            // 5 고치기 카드(저장된 전화번호 줄 190 · 주문 2건) = 같은 판 · 나누면 PUT(첫 주문) + POST(나머지)
            await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 1)); S.puts = []; S.saves = [];
            await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-t').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await until(() => p.evaluate(() => !!document.querySelector('#om-ord-0 .om-ordbox')));
            await p.fill('#om-ord-0 input[data-cact="orddate"][data-o="9000000002"]', '11/4'); await p.keyboard.press('Tab'); await p.waitForTimeout(100);
            await until(() => p.evaluate(() => !/번호 확인 중/.test(document.getElementById('om-card-save').textContent))); await p.click('#om-card-save'); await until(() => S.puts.length && S.saves.length); await p.waitForTimeout(250);
            ok(S.puts.length === 1 && S.puts[0].key === '9000000001' && S.puts[0].ship_date === null && S.puts[0].checked && S.puts[0].checked.buyer === PXL && S.saves.length === 1 && S.saves[0].rows.length === 1 && S.saves[0].rows[0].key === '9000000002' && S.saves[0].rows[0].ship_date === '2026-11-04' && S.saves[0].rows[0].checked.buyer === PXL, '고치기 카드(전화번호 줄)에서 B 11/4 = 이 줄 PUT(키 → 주문 A · checked.buyer 전화번호) + 나머지 주문 B 새 줄 POST(11/4)', { puts: S.puts, saves: S.saves });
            // 6 저장된 주문번호 줄 2개(같은 구매자 · 날짜 같음) = 짝 번호는 구매자 · 고치기 카드 [전화번호 줄 하나로 합치기] = PUT 키 → 전화번호 + 형제 줄 DELETE · 목록 배지·추가 매칭 = 구매자 번호로
            S.lines938 = true; S.badges = { 310: { m: 4, n: 4, unsure: 0, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'ok' } }; await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 3));
            st = await p.evaluate(() => { const li = [...document.querySelectorAll('#om-list .om-ml')].find(x => /9000000001/.test(x.textContent)); return { badge: li && li.querySelector('.om-badge') && li.querySelector('.om-badge').textContent, isBtn: !!(li && li.querySelector('button.om-badge')), aria: li && li.querySelector('.om-badge') && li.querySelector('.om-badge').getAttribute('aria-label') }; });
            ok(st.badge === '4/4 매칭완료' && st.isBtn && /010-5738-4123 입력삭제 매칭/.test(st.aria || ''), '주문번호 줄(checked.buyer 있음) = 배지 단추 「4/4 매칭완료」 · 짝 번호 = 구매자 010-5738-4123', st);
            S.puts = []; S.deleted = new Set(); await p.locator('#om-list .om-ml', { hasText: '9000000001' }).locator('.om-ml-t').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(200);
            st = await p.evaluate(() => { const b = document.querySelector('#om-ord-0 .om-ordbox'); return { t: b && b.querySelector('b').textContent, go: b && b.querySelector('[data-cact="ordmerge"]') && b.querySelector('[data-cact="ordmerge"]').disabled }; });
            ok(/주문번호 줄 · 구매자 010-5738-4123 · 같은 구매자 주문번호 줄 1개 더\(다음 발주 9000000002\)/.test(st.t || '') && st.go === false, '주문번호 줄 고치기 카드 = 「구매자 … · 같은 구매자 주문번호 줄 1개 더(다음 발주 9000000002)」 · [전화번호 줄 하나로 합치기] 풀림(날짜 같음)', st);
            await p.click('[data-cact="ordmerge"]'); await until(() => S.puts.length && S.deleted.size); await p.waitForTimeout(250);
            ok(S.puts[0].key === PXL && S.puts[0].note === '입력o삭제x' && S.puts[0].checked && S.puts[0].checked.as === 'buyer' && !S.puts[0].checked.buyer && S.deleted.has(311) && (await p.evaluate(() => document.getElementById('om-card').hidden)), '[합치기] = 이 줄 PUT 키 → 010-5738-4123(checked buyer 없음) · 형제 주문번호 줄 311 DELETE · 카드 닫힘', { puts: S.puts, del: [...S.deleted] });
            // ③ 형제 줄 판매처가 다르면(쿠팡) 합치기 대상 아님 · ④ 주문번호 줄 키를 전화번호로 고쳐 저장 = checked.buyer 지움
            S.lines938 = true; S.linesPlat311 = '쿠팡'; await openMemo(p, 'new', 4, 1); await until(() => p.evaluate(() => document.querySelectorAll('#om-list .om-ml').length === 3));
            await p.locator('#om-list .om-ml', { hasText: '9000000001' }).locator('.om-ml-t').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(200);
            st = await p.evaluate(() => { const b = document.querySelector('#om-ord-0 .om-ordbox'); return { t: b && b.querySelector('b').textContent, go: b && b.querySelector('[data-cact="ordmerge"]').disabled }; });
            ok(st.t === '주문번호 줄 · 구매자 010-5738-4123' && st.go === false, '③ 판매처 다른(쿠팡) 주문번호 줄은 형제로 안 셈 = 「같은 구매자 주문번호 줄 … 더」 없음(합치기 = 이 줄만)', st);
            S.puts = []; await p.fill('#om-f-0-key', PXL); await p.keyboard.press('Tab'); await until(() => p.evaluate(() => !/번호 확인 중/.test(document.getElementById('om-card-save').textContent))); await p.waitForTimeout(800); await p.click('#om-card-save'); await until(() => S.puts.length); await p.waitForTimeout(200);
            ok(S.puts[0].key === PXL && S.puts[0].checked && !S.puts[0].checked.buyer, '④ 주문번호 줄 키를 전화번호로 고쳐 저장 = PUT checked 에 옛 buyer 없음', S.puts[0]);
            S.linesPlat311 = null; S.lines938 = false;
            // 7 옛 서버(lookup 404) = 판 없음 · 종전 저장 1줄
            S.lookup = null; S.lines938 = false; await openPx(p, 'new'); await p.waitForTimeout(300);
            st = await panel(); await p.click('#om-card-save'); await until(() => S.saves.length);
            ok(!st.has && S.saves[0].rows.length === 1 && S.saves[0].rows[0].key === PXK, '옛 서버(주문 찾기 404) = 판 없음 · 종전대로 전화번호 줄 1 저장', st);
            ok(pe.length === 0, '#938 1280 스크립트 오류 0', pe);
            await c.close();
            // 8 폰 390 = 판 넘침 0 · 44px
            S.lookup = { [PXK.replace(/\D/g, '')]: [mk(OA, 4, OPTA), mk(OB, 8, OPTB)] };
            { const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }); const p2 = await c2.newPage(); const pe2 = []; p2.on('pageerror', e => pe2.push(String(e)));
                await openMemo(p2, 'new', 4, 1); S.saves = []; await p2.evaluate(t => window.AkmOrderMemo.fromText(t), PXK + ' 입력o삭제x 네이버'); await p2.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await until(() => p2.evaluate(() => !!document.querySelector('#om-ord-0 .om-ordbox')));
                const m = await p2.evaluate(() => { const card = document.getElementById('om-card'), cr = card.getBoundingClientRect(), b = document.querySelector('#om-ord-0 .om-ordbox'); return { sw: document.documentElement.scrollWidth, over: [...b.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > cr.right + 0.5).length, hs: [...b.querySelectorAll('input')].map(i => Math.round(i.closest('label').getBoundingClientRect().height)) }; });
                ok(m.sw <= 390 && m.over === 0 && m.hs.every(h => h >= 44), '390폭 주문별 발송일 판 = 넘침 0 · 체크·날짜 칸 44px↑', m);
                ok(pe2.length === 0, '390폭 #938 스크립트 오류 0', pe2); await c2.close(); }
            // 9 배지 순수 = 주문번호 줄(orderNo) · 같은 구매자 A(날짜 없음 4) · B(11/4 8) · 주소 줄 4 + 8(11/4)
            { const OMS = require(path.join(ROOT, 'order-memo.js')), K0 = PXK, D0 = K0.replace(/\D/g, ''), cat = new Set(CAT);
                const cells = (nm, opt, qty, more) => Object.assign({ kind: 'cash', state: 'open', sure: true, service: false, ship_date: null, cells: ['강명희 드림', K0, '제주시', nm, opt, String(qty), '010-2111-9887', '', '충남 ' + nm, '', K0, '', ''] }, more || {});
                const rows = Array.from({ length: 4 }, (_, i) => cells('a' + i, OPTA, 1)).concat(Array.from({ length: 8 }, (_, i) => cells('b' + i, OPTB, 1, { ship_date: '2026-11-04' })));
                const od = [{ channel: 'naver', buyer_digits: D0, product_order_no: OA, okey: OA, option_text: OPTA, qty: 4 }, { channel: 'naver', buyer_digits: D0, product_order_no: OB, okey: OB, option_text: OPTB, qty: 8 }];
                const A = OMS.indivBadge({ line_key: OA, plat: '네이버', ship_date: null, checked: { buyer: K0 } }, rows, od.filter(o => o.product_order_no === OA), '2026-11-03', { catalog: cat, orderNo: OA, buyer: D0 });
                const B = OMS.indivBadge({ line_key: OB, plat: '네이버', ship_date: '2026-11-04', checked: { buyer: K0 } }, rows, od.filter(o => o.product_order_no === OB), '2026-11-03', { catalog: cat, orderNo: OB, buyer: D0 });
                const B2 = OMS.indivBadge({ line_key: OB, plat: '네이버', ship_date: '2026-11-04', checked: { buyer: K0 } }, rows.slice(0, 10), od.filter(o => o.product_order_no === OB), '2026-11-03', { catalog: cat, orderNo: OB, buyer: D0 });
                ok(A.state === 'ok' && A.m === 4 && A.n === 4 && A.later === 0 && B.state === 'ok' && B.m === 8 && B.n === 8 && B2.state === 'short' && B2.n === 6, '배지 주문번호 줄 = A(날짜 없음) 4/4 · B(11/4) 8/8 — 날짜로 나눠 셈(뒤 날짜 later 아님) · B 주소 줄 6 = 6/8 모자람', { A, B, B2 });
                const P = OMS.indivBadge({ line_key: K0, plat: '네이버', ship_date: null }, rows, od, '2026-11-03', { catalog: cat });
                ok(P.state === 'split' && P.m === 12 && P.n === 4 && P.later === 8, '같은 자료를 전화번호 줄로 보면 = 4/12 오늘 · 8박스 11/4 대기(split · 종전 규칙 그대로)', P); }
            S.lookup = null; S.lines938 = false; S.badges = {}; S.px = false; S.preview = null; }
    } catch (e) { failN++; console.log('  ❌ 실행 오류', e && e.stack || e); }
    await browser.close(); srv.close();
    console.log(`\n결과 ${pass}/${pass + failN}${failN ? ' · 실패 ' + failN : ''}`);
    process.exit(failN ? 1 : 0);
})();
