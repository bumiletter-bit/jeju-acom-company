// #900-2B 검증 — 메모함 명절 화면(현금 줄 100줄 넘으면 촘촘 꼴·50줄 페이지·찾기·이 쪽 전체 선택·「찾은 n줄 전부 고르기」·보이는 쪽만 주소 검색 · 주문입력 카드 1,500줄 50장씩·빈칸 먼저·첫 빈칸으로)
//   🔴 실DB 쓰기 없음 · 서버(server.js) 안 띄움 · 네트워크 0 — 이 스크립트가 띄우는 작은 가짜 서버(가짜 /api/*)에 public/ao-ordermemo.js·css 만 얹어 Playwright 로 봄
//   무회귀 = 100줄 이하 · 50장 이하 카드는 지금 커밋(HEAD)의 같은 파일과 화면 픽셀 비교(같아야 함)
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
const XLSX_JS = fs.readFileSync(path.join(ROOT, 'node_modules', 'xlsx-js-style', 'dist', 'xlsx.bundle.js'));
const CAT = ['타이벡감귤 5kg', '타이벡감귤 3kg', '황금향 3kg'];
const SHIP = '2026-10-29';

// 가짜 목록: n 줄을 묶음 ent 개에 나눔 · 이름 손님0001… · 번호 끝 4자리 = 줄 번호 · 주소 줄마다 다름(주소 검색 수를 셀 수 있게)
function listBody(n, ent) {
    const entries = [];
    for (let e = 0; e < ent; e++) entries.push({ id: e + 1, created_at: new Date(Date.UTC(2026, 9, 28, 0, 0, 0) - e * 60000).toISOString(), source: 'manual', rows: [] });
    for (let i = 0; i < n; i++) {
        const k = String(i + 1).padStart(4, '0');
        entries[i % ent].rows.push({ id: 10000 + i, kind: 'cash', state: 'open', sure: true, check_why: [], addr_ok: null,
            cells: ['', '', '', '손님' + k, CAT[i % 2], '1', '010-55' + k.slice(0, 2) + '-' + k, '', '제주특별자치도 제주시 연동 ' + (S.multi && i % 6 === 0 ? '다중 ' : '') + (i + 1) + '번지', '', '', '', ''] });
    }
    return { ok: true, ship_date: SHIP, keep_days: 15, counts: {}, entries };
}
const S = { n: 0, ent: 1, juso: 0, calls: [], multi: false };   // multi = 6줄마다 주소 후보 둘(「주소 확인 필요」)
const page0 = v => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#EEF0F4;font-family:system-ui,"Malgun Gothic",sans-serif;-webkit-font-smoothing:antialiased}*{animation:none!important;transition:none!important;caret-color:transparent!important}</style>
<link rel="stylesheet" href="/om.css?v=${v}"></head><body>
<script>localStorage.setItem('jwt_token','x');window.showToast=function(m){(window.__toasts=window.__toasts||[]).push(m)};
window.__ooTest={splitAddr:function(r){return [r,'']},searchBody:function(b){return b},exactMatches:function(){return []}};</script>
<script src="/xlsx.js"></script><script src="/om.js?v=${v}"></script></body></html>`;
function serve(port) {
    const srv = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x'), send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
        const v = u.searchParams.get('v') === 'old' ? 'old' : 'new';
        if (u.pathname === '/') return send(200, page0(v), 'text/html; charset=utf-8');
        if (u.pathname === '/om.js') return send(200, SRC[v].js, 'text/javascript; charset=utf-8');
        if (u.pathname === '/om.css') return send(200, SRC[v].css, 'text/css; charset=utf-8');
        if (u.pathname === '/xlsx.js') return send(200, XLSX_JS, 'text/javascript; charset=utf-8');
        S.calls.push(req.method + ' ' + u.pathname);
        if (u.pathname === '/api/order-memo' && req.method === 'GET') return send(200, u.searchParams.get('state') === 'cleared' ? { ok: true, entries: [] } : listBody(S.n, S.ent));
        if (u.pathname === '/api/order-memo/for-ship') return send(200, { ok: true, cash_ids: [], lines: [] });
        if (u.pathname === '/api/invoice/catalog') return send(200, { byPartner: { a: CAT } });
        if (u.pathname === '/api/agent-office/juso') { S.juso++; const kw = u.searchParams.get('keyword') || ''; const one = n => ({ roadAddrPart1: '제주특별자치도 제주시 연동로 ' + n, zipNo: '63' + String(n).padStart(3, '0'), bdNm: '' }); return send(200, { results: { common: { errorCode: '0' }, juso: /다중/.test(kw) ? [one(kw.length), one(kw.length + 500)] : [one(kw.length)] } }); }
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
        ok(st.dense && st.rows === 50 && st.fs === '12px' && st.h >= 36 && st.h <= 46, '촘촘 꼴 · 한 쪽 50줄 · 글씨 12px · 줄 36px 안팎', st);
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
        console.log('③ 무회귀 = 100줄·60줄 · 50장 이하 카드는 종전(HEAD)과 픽셀 같음');
        for (const [w, h, phone] of [[1280, 900, false], [390, 844, true]]) {
            for (const n of [60, 100]) {
                const shots = {};
                for (const v of ['old', 'new']) {
                    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone }); const p = await c.newPage();
                    await openMemo(p, v, n, 30, phone); await jusoQuiet(); await p.waitForTimeout(150);
                    const html = await p.evaluate(() => document.getElementById('om-ctw').innerHTML + '|' + document.getElementById('om-cselbar').outerHTML);
                    shots[v] = { png: await p.locator('.om-win').screenshot(), html, juso: S.juso, rows: await p.evaluate(() => document.querySelectorAll('#om-ctw tbody tr').length) };
                    await c.close();
                }
                ok(shots.old.png.equals(shots.new.png), `${w}폭 ${n}줄 = 화면 픽셀 동일`);
                ok(shots.old.html === shots.new.html && shots.new.rows === n && shots.old.juso === shots.new.juso, `${w}폭 ${n}줄 = 표 HTML 같음 · ${n}줄 전부 · 주소 검색 수 같음(${shots.new.juso})`, { rows: shots.new.rows, juso: [shots.old.juso, shots.new.juso] });
            }
        }
        { const shots = {};
            for (const v of ['old', 'new']) {
                const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }); const p = await c.newPage();
                await openMemo(p, v, 5, 2); await p.click('.om-tag[data-tag="cash"]'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(200);
                shots[v] = await p.locator('#om-card').screenshot(); await c.close();
            }
            ok(shots.old.equals(shots.new), '빈 주문입력 카드(1줄) = 픽셀 동일'); }
        // 「주소 확인 필요 n줄」 단추(#880-b) = 종전과 같은 글·보임 · 그 줄들을 지워 n=0 이 되면 단추 사라지고 「그 줄만 보기」도 풀림(워커2 점검 #900-2B 막을 것 1)
        { const st2 = {}; S.multi = true;
            for (const v of ['old', 'new']) {
                const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }); const p = await c.newPage();
                const pe = []; p.on('pageerror', e => pe.push(String(e)));
                await openMemo(p, v, 60, 30); await jusoQuiet(); await p.waitForTimeout(150);
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
    } catch (e) { failN++; console.log('  ❌ 실행 오류', e && e.stack || e); }
    await browser.close(); srv.close();
    console.log(`\n결과 ${pass}/${pass + failN}${failN ? ' · 실패 ' + failN : ''}`);
    process.exit(failN ? 1 : 0);
})();
