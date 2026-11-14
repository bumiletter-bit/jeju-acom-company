// #1142 검증 — 발주 메모함 「메모 고치기」 매칭 판(입력삭제 줄 ④ 판)
//   ① ② [현금으로 변경] = #1125 대기 그대로(여러 줄 → [고친 대로 저장] 1번 → PUT n · 닫으면 0) · 대표 11/14 「고친 대로 저장으로」
//   ② ②·③ 줄 글 = 그 줄 고치기 카드(체크 칸은 펼침 아님) → 닫기·저장하면 판으로(대기 그대로) · 줄 카드 [현금으로 변경하기]도 대기
//   ③ 깨짐 = 1500 · 720 · 390 · 야간 · 긴 이름 두 줄 · 대기 줄 = 겹침 0 · 넘침 0 · 서비스 칸·단추 세로 선 1 · 높이 같음 · 스크립트 오류 0
//   🔴 실DB·서버(server.js)·네트워크 0 — verify-900-2b.js 의 가짜 서버·가짜 자료를 그대로 떼어 쓰고(목록이 PUT·pair 를 따라 바뀌게만 덧댐) public/ao-ordermemo.js·css 를 Playwright 로 봄
//   실행: node scripts/verify-1142-px.js   (PORT1142 로 포트 · 기본 3462)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright');
const XLSX = require('xlsx-js-style');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ''); } };

// ── verify-900-2b.js 의 가짜 서버 구간(SRC ~ jusoQuiet)을 떼어 씀 + 덧댐 3곳(목록 변형 · PUT 실패 · PUT/pair 기록)
let B = fs.readFileSync(path.join(__dirname, 'verify-900-2b.js'), 'utf8').split('\r\n').join('\n');
B = B.slice(B.indexOf('const SRC = {'), B.indexOf('(async () => {'));
const patch = (a, b) => { if (B.split(a).length !== 2) throw new Error('덧댐 자리 못 찾음: ' + a.slice(0, 60)); B = B.replace(a, () => b); };
patch('function pxList() {', 'function pxList() { const L = pxList0(); return S.mut ? S.mut(L) : L; }\nfunction pxList0() {');
patch("if (req.method === 'PUT') {", "if (req.method === 'PUT' && S.putFail) return send(500, { ok: false, error: '가짜 저장 실패' });\n        if (req.method === 'PUT') {");
patch('try { S.puts.push(JSON.parse(b)); } catch (e) { }', 'try { const j = JSON.parse(b); j._id = Number(u.pathname.split(\'/\').pop()); S.puts.push(j); (S.log = S.log || []).push([\'put\', j._id, j]); } catch (e) { }');
patch('S.pairs.push(j);', "S.pairs.push(j); if (!j.undo) (S.log = S.log || []).push(['pair', (j.ids || []).map(Number), j.key]);");
const M = new Function('require', 'ROOT', 'path', 'fs', 'http', 'execSync', 'chromium', 'XLSX', 'ok', B + '\nreturn { S, serve, until, jusoQuiet, PXL, PXK, CAT };')(require, ROOT, path, fs, http, execSync, chromium, XLSX, ok);
const { S, serve, until, PXL, CAT } = M;
const dg = s => String(s || '').replace(/\D/g, '');

// 목록 덧댐 = PXL 입력삭제에 붙은 주소 줄 2개 더(204 일반 · 205 서비스) + 로그대로 바꿈(PUT to_cash = 현금 「!」 · pair = 다시 주소 줄 · 그 밖 PUT = 칸 반영)
function mut(L) {
    const extra = (id, nm, qty, more) => Object.assign({ id, kind: 'cash', state: 'open', sure: true, check_why: [], addr_ok: null, indiv: true, service: false, cells: ['홍길동 드림', PXL, '제주시 연삼로 1066-31', nm, CAT[0], String(qty), '010-3300-0' + id, '', '경기 성남시 분당구 판교역로 ' + id + ' 아주 긴 주소 101동 1203호(삼평동 판교푸르지오그랑블)', '', PXL, '', ''] }, more || {});
    const e140 = L.entries.find(e => e.id === 140); if (e140 && !S.noExtra) e140.rows.push(extra(204, S.longName ? '둘째주소손님 아주아주 긴 이름 받는 분 선물용 회사 단체 주문 담당자 홍길동 과장님 앞' : '둘째주소손님', 2), extra(205, '서비스주소손님', 1, { service: true, indiv: false, cells: ['서비스!', PXL, '제주시 연삼로 1066-31', '서비스주소손님', CAT[0], '1', '010-3300-0205', '', '서울 중구 세종대로 1', '', PXL, '', ''] }));
    if (e140 && S.bare) e140.rows.forEach(r => { if (r.id === 204) r.cells[0] = '김철수'; });   // #1143 이름만 저장된 입력삭제 주소 줄
    if (e140 && S.mix) e140.rows.forEach(r => { if (r.id === 204) r.cells[4] = CAT[2]; });   // #1144 품목 2종 섞임
    if (e140 && S.out) e140.rows.forEach(r => { if (r.id === 204) { r.out_b = '010-2222-5315'; r.out_k = '010-2222-5316'; } if (r.id === 201) { r.out_b = PXL; r.out_k = PXL; } });   // #1146 양식 B·K(204 = 처음 값 다름 · 201 = 같음)
    if (e140 && S.outBK) e140.rows.forEach(r => { if (r.id === 204) { r.out_b = S.outBK[0]; r.out_k = S.outBK[1] === 'ROWK' ? r.cells[10] : S.outBK[1]; } });   // #1150 #1149 꼴(같은 칸 null)
    if (e140 && S.outKSet) e140.rows.forEach(r => { if (r.id === 204) { r.out_k_set = S.outKSet; r.out_k = S.outKSet; r.out_b = null; } });   // #1153 사람이 넣은 택배 양식 구매자 연락처(서버 out_k = 그 값)
    if (e140 && S.many) for (let i = 0; i < 8; i++) e140.rows.push(extra(210 + i, '여러줄손님' + i, 1));   // 대표 사진 꼴 = ② 10줄 넘음
    if (S.splitBadge) L.entries.forEach(e => e.rows.forEach(r => { if (r.id === 190) r.badge = { kind: 'line', state: 'sent_split', m: null, n: 0, later: 3, later_date: '2026-11-20', service: 0, pre: false, item_diff: false, t: '', why: '' }; }));
    const all = L.entries.flatMap(e => e.rows);
    for (const [k, a, b] of (S.log || [])) {
        if (k === 'put') { const r = all.find(x => x.id === a); if (!r) continue; if (Array.isArray(b.cells)) r.cells = b.cells.slice(); if (b.to_cash) { r.indiv = false; if (!/!/.test(r.cells[0])) r.cells[0] += '!'; } }
        if (k === 'pair') a.forEach(id => { const r = all.find(x => x.id === id); if (r) { r.indiv = true; r.cells[0] = String(r.cells[0]).replace(/!/g, ''); r.cells[10] = b; } });
    }
    return L;
}

(async () => {
    const PORT = Number(process.env.PORT1142 || 3462);
    const srv = await serve(PORT), base = `http://127.0.0.1:${PORT}/`;
    const browser = await chromium.launch();
    const reset = () => { Object.assign(S, { px: true, px2: false, px3: false, pxHide: false, pxOrig: false, deleted: new Set(), puts: [], pairs: [], services: [], saves: [], log: [], putFail: false, mut, noExtra: false, splitBadge: false, longName: false, many: false, bare: false, mix: false, out: false, outBK: null, outKSet: null, listDelay: 0, badges: {} }); S.lookup = { [dg(PXL)]: [{ as: 'buyer', plat: '네이버', pno: '2026111400000011', order_no: '2026111400000001', option: '타이벡감귤 5kg', qty: 3, recv_name: '구매자손님', addr: '서울 송파구 올림픽로 1' }] }; };
    const openPanel = async p => {
        S.n = 4; S.ent = 1; await p.goto(base + '?v=new'); await p.evaluate(() => window.AkmOrderMemo.open({ noFocus: true }));
        await p.waitForSelector('#om-list .om-ml'); await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-px, .om-badge').first().click();
        await p.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await p.waitForTimeout(400);
    };
    const panel = p => p.evaluate(() => { const C = document.getElementById('om-card'), pr = C.querySelector('.om-px-paired'), sum = C.querySelector('.om-pxs-sum-t');
        return { hidden: C.hidden, title: (document.getElementById('om-card-t') || {}).textContent, wide: C.classList.contains('om-card-wide'), w: Math.round(C.getBoundingClientRect().width), h: Math.round(C.getBoundingClientRect().height),
            p2: pr ? [...pr.querySelectorAll('li')].map(li => li.querySelector('[data-cact="pxrowopen"]').dataset.v) : [], p2head: (C.querySelector('.om-pxs-paired .om-pxs-h') || {}).textContent || '', sum: sum ? sum.textContent : '',
            p3: [...C.querySelectorAll('.om-pairx-b [data-cact="pxrowopen"]')].map(b => b.dataset.v), p3on: [...C.querySelectorAll('.om-pairx-b input[data-cact="pxchk"]:checked')].map(i => i.dataset.v),
            p3none: !!C.querySelector('.om-pairx-b .om-pair-n') && /짝 없는 현금 줄이 메모함에 없어요/.test(C.querySelector('.om-pairx-b').textContent),
            svc: Object.fromEntries([...C.querySelectorAll('.om-px-paired input[data-cact="pxsvc"]')].map(i => [i.dataset.v, i.checked])), norm: [...C.querySelectorAll('input[data-cact="normchk"]:checked')].map(i => i.dataset.v),
            undo: (C.querySelector('.om-pxs-undo span') || {}).textContent || '', pend: C.querySelectorAll('.om-pxrow-pend, .om-pend-t').length, save: (document.getElementById('om-card-save') || {}).textContent || '', toasts: (window.__toasts || []).slice(-3), sw: document.documentElement.scrollWidth }; });
    const pe = [];
    const pendRows = p => p.evaluate(() => [...document.querySelectorAll('#om-card .om-px-paired li.om-pxrow-pend')].map(li => ({ id: li.querySelector('[data-cact="pxrowopen"]').dataset.v, t: (li.querySelector('.om-pend-t') || {}).textContent, b: li.querySelector('[data-cact="pxdetach"]').textContent, dis: li.querySelector('input[data-cact="pxsvc"]').disabled })));
    const sumS = p => p.textContent('#om-card .om-pxs-sum-s');
    try {
        // ── PC 1500 ────────────────────────────────
        console.log('① PC 1500 · 매칭 판(대기 → [고친 대로 저장])');
        reset();
        const c = await browser.newContext({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 }); const p = await c.newPage(); p.on('pageerror', e => pe.push('1500 ' + String(e)));
        await openPanel(p);
        let st = await panel(p);
        ok(st.title.trim() === '메모 고치기' && st.wide && st.w === 1100 && st.h >= 640 && st.h <= Math.round(940 * 0.92) + 1, '판 = 「메모 고치기」 · 넓은 꼴 폭 1100 · 높이 640~92vh', st);
        ok(st.p2.join() === '201,204,205' && /2줄 · 3박스 · 서비스 1줄/.test(st.p2head) && /매칭된 주소 줄 3박스/.test(st.sum), '② 3줄(201·204·서비스 205) · 제목 「2줄 · 3박스 · 서비스 1줄」(#1144 서비스 뺀 셈) · 요약 3박스', { p2: st.p2, h: st.p2head, s: st.sum });
        ok(/체크·변경은 아래 \[고친 대로 저장\]을 눌러야 저장돼요/.test(await sumS(p)), '요약 안내 = 종전 「체크·변경은 아래 [고친 대로 저장]을 눌러야 저장돼요」');
        // 대기 여러 줄 = 201·204 [현금으로 변경] + 서비스 205 끔 + 추가 매칭 193 체크
        await p.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="201"]'); await p.waitForTimeout(120);
        await p.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="204"]'); await p.waitForTimeout(120);
        await p.uncheck('#om-card .om-px-paired input[data-cact="pxsvc"][data-v="205"]'); await p.check('#om-card .om-pairx-b input[data-cact="pxchk"][data-v="193"]'); await p.waitForTimeout(150);
        let pr = await pendRows(p);
        ok(S.puts.length === 0 && S.services.length === 0 && S.pairs.length === 0, '[현금으로 변경]·서비스·추가 매칭 체크 = 서버 쓰기 0(대기 · #1125 그대로)', { puts: S.puts.length, svc: S.services.length, pairs: S.pairs.length });
        ok(pr.map(x => x.id).join() === '201,204' && pr.every(x => x.t === '저장하면 현금으로' && x.b === '변경 취소' && x.dis) && /저장 전 · 바뀐 것 4/.test(await sumS(p)), '대기 2줄 = 줄 안 「저장하면 현금으로」 · [변경 취소] · 서비스 칸 잠김 · 요약 「바뀐 것 4」', { pr, s: await sumS(p) });
        await p.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="204"]'); await p.waitForTimeout(120); pr = await pendRows(p);
        ok(pr.map(x => x.id).join() === '201', '[변경 취소] = 그 줄만 대기 풀림', pr);
        await p.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="204"]'); await p.waitForTimeout(120);
        // ③ 체크 칸 = 체크만 · ③ 줄 글 = 줄 카드 → 닫기 = 판(대기 그대로)
        await p.click('#om-card .om-pairx-b input[data-cact="pxchk"][data-v="191"]'); await p.waitForTimeout(150);
        st = await panel(p); ok(st.title.trim() === '메모 고치기' && !!(await p.$('#om-card .om-pxs-sum')) && st.p3on.includes('191'), '③ 체크 칸 = 체크만(줄 카드 안 열림)', st.p3on);
        await p.click('#om-card .om-pairx-b [data-cact="pxrowopen"][data-v="192"]'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(200);
        let ch = await p.evaluate(() => { const C = document.getElementById('om-card'); return { sum: !!C.querySelector('.om-pxs-sum'), wide: C.classList.contains('om-card-wide'), h: C.querySelector('.om-rowcard h4').textContent, nm: (C.querySelector('#om-f-0-c3') || {}).value, addr: (C.querySelector('#om-f-0-c8') || {}).value, tel: (C.querySelector('#om-f-0-c6') || {}).value, opt: C.querySelector('.om-rowcard').textContent.includes('타이벡감귤 3kg') }; });
        ok(!ch.sum && !ch.wide && /현금 줄/.test(ch.h) && ch.nm === '이승비' && /충남 아산시 배방읍 동천로 2/.test(ch.addr || '') && dg(ch.tel) === '01020279787' && ch.opt, '③ 줄 글 = 그 줄 고치기 카드(메모함 현금 줄 카드와 같은 꼴 · 받는 분·전체 번호·주소 전체·품목)', ch);
        await p.click('#om-card [data-cact="cancel"]'); await p.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await p.waitForTimeout(500);
        st = await panel(p); pr = await pendRows(p);
        ok(st.wide && pr.map(x => x.id).join() === '201,204' && st.svc['205'] === false && st.p3on.includes('193') && st.p3on.includes('191') && S.puts.length === 0, '줄 카드 닫기 = 판으로 · 대기(현금 2줄 · 서비스 끔 · 추가 매칭 2줄) 그대로', { pr, svc: st.svc, on: st.p3on });
        // ② 대기 줄 글 = 줄 카드 → 이름 고쳐 저장 = PUT 그 줄만(to_cash 아님) → 판 · 대기 그대로
        await p.click('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="204"]'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(200);
        await p.fill('#om-f-0-c3', '둘째주소고침'); await p.click('#om-card-save'); await until(() => S.puts.length); await p.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await p.waitForTimeout(700);
        st = await panel(p); pr = await pendRows(p); const t204 = await p.textContent('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="204"]');
        ok(S.puts.length === 1 && S.puts[0]._id === 204 && !S.puts[0].to_cash && S.puts[0].cells[3] === '둘째주소고침' && /둘째주소고침/.test(t204) && pr.map(x => x.id).join() === '201,204' && st.p3on.includes('193'), '② 줄 카드 저장 = PUT 그 줄(이름 · to_cash 아님) · 판으로 · ② 글 갱신 · 대기 그대로', { put: S.puts.map(x => [x._id, x.to_cash, x.cells && x.cells[3]]), t204, pr });
        // [고친 대로 저장] 한 번 = 현금 2줄 PUT to_cash · 서비스 205 끔 · 추가 매칭 193·191
        S.puts = []; S.services = []; S.pairs = []; await p.click('#om-card-save'); await until(() => S.puts.filter(x => x.to_cash).length >= 2 && S.pairs.length); await p.waitForTimeout(800);
        ok(S.puts.filter(x => x.to_cash).map(x => x._id).sort().join() === '201,204' && S.services.some(x => (x.ids || []).includes(205) && x.on === false) && S.pairs.some(x => (x.ids || []).includes(193) && (x.ids || []).includes(191)), '[고친 대로 저장] 1번 = PUT to_cash 2(201·204) · 서비스 205 끔 · 추가 매칭 191·193', { puts: S.puts.map(x => [x._id, !!x.to_cash]), svc: S.services, pairs: S.pairs });
        // 닫으면 버림
        reset(); await openPanel(p); await p.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="204"]'); await p.waitForTimeout(120);
        const pendN = (await pendRows(p)).length; await p.click('#om-card [data-cact="cancel"]'); await p.waitForTimeout(300); if (await p.isVisible('#om-card [data-cact="discard"]')) await p.click('#om-card [data-cact="discard"]'); await p.waitForTimeout(300);
        ok(pendN === 1 && S.puts.length === 0 && await p.evaluate(() => document.getElementById('om-card').hidden), '대기 뒤 닫기 = PUT 0(버림)', { pendN, puts: S.puts.length });
        await c.close();
        // 줄 카드 [현금으로 변경하기] = 대기 → [고친 대로 저장] 때 PUT(#1125 그대로) → 판
        reset(); const c4 = await browser.newContext({ viewport: { width: 1500, height: 940 } }); const p4 = await c4.newPage(); p4.on('pageerror', e => pe.push('tocash ' + String(e)));
        await openPanel(p4); await p4.click('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="201"]'); await p4.waitForSelector('#om-card:not([hidden]) [data-cact="tocash"]');
        await p4.click('#om-card [data-cact="tocash"]'); await p4.waitForTimeout(200); const tc0 = S.puts.length, pendTxt = await p4.textContent('#om-card [data-cact="tocash"]');
        await p4.click('#om-card-save'); await until(() => S.puts.length); await p4.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await p4.waitForTimeout(700); st = await panel(p4);
        ok(tc0 === 0 && /현금으로 변경 취소/.test(pendTxt) && S.puts.length === 1 && S.puts[0]._id === 201 && S.puts[0].to_cash === true && st.p2.join() === '204,205' && st.p3.includes('201'), '줄 카드 [현금으로 변경하기] = 대기(PUT 0 · 「현금으로 변경 취소」) → [고친 대로 저장] 때 PUT to_cash 1 → 판으로 · ② 2줄 · ③ 에 201', { tc0, pendTxt, puts: S.puts.length, p2: st.p2 });
        await c4.close();
        // #1143 입력삭제 주소 줄 보내는 분 = 현금과 같은 「드림」 판정 · 「!」 없음
        console.log('①-b #1143 입력삭제 주소 줄 보내는 분 「드림」');
        reset(); S.bare = true; const c5 = await browser.newContext({ viewport: { width: 1500, height: 940 } }); const p5 = await c5.newPage(); p5.on('pageerror', e => pe.push('drim ' + String(e)));
        await openPanel(p5); await p5.click('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="204"]'); await p5.waitForSelector('#om-card:not([hidden]) #om-f-0-c0', { state: 'attached' });
        await p5.evaluate(() => { const d = document.querySelector('#om-card details.om-more'); if (d) d.open = true; });
        const v0 = await p5.inputValue('#om-f-0-c0'), dirty0 = await p5.evaluate(() => !document.querySelector('#om-card [data-cact="reset"]').hidden);
        ok(v0 === '김철수 드림' && !dirty0, '이름만 저장된 입력삭제 주소 줄 = 카드에 「김철수 드림」(「!」 없음 · 고친 것으로 안 셈)', { v0, dirty0 });
        await p5.fill('#om-f-0-c0', '이영희'); const typing = await p5.inputValue('#om-f-0-c0'); await p5.click('#om-f-0-c3'); const left = await p5.inputValue('#om-f-0-c0');
        await p5.fill('#om-f-0-c0', '제주아꼼이네'); await p5.click('#om-f-0-c3'); const keep1 = await p5.inputValue('#om-f-0-c0');
        await p5.fill('#om-f-0-c0', '박민수 올림'); await p5.click('#om-f-0-c3'); const keep2 = await p5.inputValue('#om-f-0-c0');
        ok(typing === '이영희' && left === '이영희 드림' && keep1 === '제주아꼼이네' && keep2 === '박민수 올림', '치는 중엔 그대로 · 칸 떠날 때 「이영희 드림」 · 제주아꼼이네·「올림」은 그대로', { typing, left, keep1, keep2 });
        await p5.fill('#om-f-0-c0', '최지우'); await p5.click('#om-f-0-c3'); await p5.click('#om-card-save'); await until(() => S.puts.length); await p5.waitForTimeout(300);
        ok(S.puts[0] && S.puts[0]._id === 204 && S.puts[0].cells[0] === '최지우 드림' && !/!/.test(S.puts[0].cells[0]), '저장 = 보내는 분 「최지우 드림」(「!」 없음)', S.puts.map(x => [x._id, x.cells && x.cells[0]]));
        await p5.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await p5.click('#om-card .om-pairx-b [data-cact="pxrowopen"][data-v="191"]'); await p5.waitForSelector('#om-card:not([hidden]) #om-f-0-c0', { state: 'attached' });
        const vc = await p5.inputValue('#om-f-0-c0'); ok(vc === '강명희 드림', '현금 줄(「강명희 드림!」) = 종전대로 「강명희 드림」', vc);
        await c5.close();
        // #1144 ②·③ 고르는 대로 박스 합계(화면 셈만)
        console.log('①-c #1144 고르는 대로 품목·박스 합계');
        reset(); S.mix = true; const c6 = await browser.newContext({ viewport: { width: 1500, height: 940 } }); const p6 = await c6.newPage(); p6.on('pageerror', e => pe.push('tot ' + String(e)));
        await openPanel(p6);
        const tot = () => p6.evaluate(() => { const C = document.getElementById('om-card'); const g = s => { const e = C.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }; return { tot: g('.om-pxs-tot'), after: g('.om-pxs-after'), sum: g('.om-pxs-sum-t'), pick: g('.om-pxs-pick'), head: g('.om-pxs-paired .om-pxs-h') }; });
        let t = await tot();
        ok(t.tot === '타이벡감귤 5kg 1박스 · 황금향 3kg 2박스' && /매칭된 주소 줄 2줄 · 3박스 · 서비스 1줄/.test(t.head) && !t.after && /주문 3박스 ↔ 매칭된 주소 줄 3박스/.test(t.sum) && !t.pick, '처음 = 머리 「2줄 · 3박스 · 서비스 1줄」 + 품목 2종(타이벡 1 · 황금향 2) · 요약 「저장하면」 없음 · ③ 고른 줄 없음', t);
        await p6.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="204"]'); await p6.waitForTimeout(150); t = await tot();
        ok(/^→ 저장하면 1줄 · 1박스 \(빠짐 2박스\) 타이벡감귤 5kg 1박스$/.test(t.tot) && /→ 저장하면 1박스$/.test(t.after) && /매칭된 주소 줄 3박스/.test(t.sum), '[현금으로 변경] 대기 1줄(황금향 2박스) = 「저장하면 1줄 · 1박스(빠짐 2박스)」 · 품목 타이벡만 · 요약 「매칭 3박스 → 저장하면 1박스」(지금 값 그대로)', t);
        await p6.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="204"]'); await p6.waitForTimeout(150); t = await tot();
        ok(!/저장하면/.test(t.tot) && !t.after, '[변경 취소] = 원복', t);
        await p6.check('#om-card .om-px-paired input[data-cact="pxsvc"][data-v="201"]'); await p6.waitForTimeout(120); t = await tot();
        ok(/^→ 저장하면 1줄 · 2박스 \(빠짐 1박스\) 황금향 3kg 2박스$/.test(t.tot) && /→ 저장하면 2박스$/.test(t.after), '서비스 체크(201) = 그 줄 빠짐 · 바로 반영(다시 그리기 없이)', t);
        await p6.uncheck('#om-card .om-px-paired input[data-cact="pxsvc"][data-v="201"]'); await p6.uncheck('#om-card .om-px-paired input[data-cact="pxsvc"][data-v="205"]'); await p6.waitForTimeout(120); t = await tot();
        ok(/^→ 저장하면 3줄 · 4박스 \(더해짐 1박스\)/.test(t.tot) && /→ 저장하면 4박스$/.test(t.after), '이미 서비스인 205 체크 해제 = 더해짐 1박스', t);
        await p6.check('#om-card .om-px-paired input[data-cact="pxsvc"][data-v="205"]'); await p6.check('#om-card .om-pairx-b input[data-cact="pxchk"][data-v="191"]'); await p6.check('#om-card .om-pairx-b input[data-cact="pxchk"][data-v="203"]'); await p6.waitForTimeout(150); t = await tot();
        ok(t.pick === '고른 줄 2줄 · 타이벡감귤 3kg 1박스 · 타이벡감귤 5kg 2박스 · 합 3박스' && /→ 저장하면 6박스 \(③ 고른 2줄 3박스 포함\)$/.test(t.after) && !/저장하면/.test(t.tot), '③ 체크 2줄 = 「고른 줄 2줄 · 품목별 · 합 3박스」 · 요약 「→ 저장하면 6박스(③ 고른 2줄 3박스 포함)」', t);
        await p6.fill('#om-card .om-pairx input[data-cact="pxq"]', '이하정'); await p6.waitForTimeout(300); t = await tot(); const vis = await p6.$$eval('#om-card .om-pairx-b [data-cact="pxrowopen"]', b => b.length);
        ok(vis === 1 && /합 3박스$/.test(t.pick) && /6박스/.test(t.after), '찾기로 안 보이는 체크 줄(203)도 합계에 셈', { vis, t });
        ok(S.puts.length + S.services.length + S.pairs.length === 0, '합계 셈 = 서버 쓰기 0', { puts: S.puts.length, svc: S.services.length, pairs: S.pairs.length });
        await c6.close();
        // #1146 택배 양식에 나갈 보내는 분 번호·구매자 연락처(표시만)
        console.log('①-d #1146 택배 양식 번호 안내');
        reset(); S.out = true; const c7 = await browser.newContext({ viewport: { width: 1500, height: 940 } }); const p7 = await c7.newPage(); p7.on('pageerror', e => pe.push('out ' + String(e)));
        await openPanel(p7);
        const outs = await p7.evaluate(() => Object.fromEntries([...document.querySelectorAll('#om-card .om-px-paired li')].map(li => [li.querySelector('[data-cact="pxrowopen"]').dataset.v, (li.querySelector('.om-out-t') || {}).textContent || ''])));
        const OUTT = '택배 양식에는 보내는 분 번호 010-2222-5315 · 구매자 연락처 010-2222-5316 로 나가요';
        ok(outs['204'] === OUTT && outs['201'] === '' && outs['205'] === '', '② = 처음 값이 다른 줄(204)만 「택배 양식에는 보내는 분 번호 … · 구매자 연락처 … 로 나가요」 · 같은 줄(201)·서비스 줄(205) 없음', outs);
        await p7.click('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="204"]'); await p7.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p7.waitForTimeout(150);
        const cn = await p7.evaluate(() => (document.querySelector('#om-card .om-out') || {}).textContent || '');
        await p7.fill('#om-f-0-c1', '010-9999-0000'); await p7.waitForTimeout(100); const cn2 = await p7.evaluate(() => (document.querySelector('#om-card .om-out') || {}).textContent || '');
        await p7.click('#om-card [data-cact="cancel"]'); await p7.waitForTimeout(200); if (await p7.isVisible('#om-card [data-cact="discard"]')) await p7.click('#om-card [data-cact="discard"]'); await p7.waitForSelector('#om-card:not([hidden]) .om-pxs-sum');
        await p7.click('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="201"]'); await p7.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p7.waitForTimeout(150);
        const cn3 = await p7.evaluate(() => !!document.querySelector('#om-card .om-out'));
        ok(cn === OUTT && cn2 === OUTT && !cn3 && S.puts.length === 0, '줄 카드 안내 글 자리 = 같은 문구(치는 중엔 저장된 값 기준 그대로) · 같은 줄(201) 카드엔 없음 · 쓰기 0', { cn, cn2, cn3, puts: S.puts.length });
        await c7.close();
        // #1150 택배 양식 안내 = 줄 값과 다른 칸만(#1149 = 같은 칸은 null)
        for (const [ob, okk, want, nm] of [['010-2222-5315', null, '택배 양식에는 보내는 분 번호 010-2222-5315 로 나가요', 'B만 다름(K null)'], [null, '010-2222-5316', '택배 양식에는 구매자 연락처 010-2222-5316 로 나가요', 'K만 다름(B null)'], ['010-2222-5315', 'ROWK', '택배 양식에는 보내는 분 번호 010-2222-5315 로 나가요', 'B 다름 · K = 줄 값'], [null, null, '', '둘 다 null']]) {
            reset(); S.out = false; S.outBK = [ob, okk]; const cq = await browser.newContext({ viewport: { width: 1500, height: 940 } }); const pq = await cq.newPage(); pq.on('pageerror', e => pe.push('outbk ' + String(e)));
            await openPanel(pq); const t = await pq.evaluate(() => (document.querySelector('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="204"]').closest('li').querySelector('.om-out-t') || {}).textContent || '');
            await pq.click('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="204"]'); await pq.waitForSelector('#om-card:not([hidden]) .om-rowcard'); const t2 = await pq.evaluate(() => (document.querySelector('#om-card .om-out') || {}).textContent || '');
            ok(t === want && t2 === want, '#1150 양식 안내 ' + nm + ' = ' + (want || '안 보임') + '(판 · 줄 카드)', { t, t2 }); await cq.close();
        }
        // #1150 줄 카드 칸 정렬(대표 11/14 「보내는이 번호·구매자 연락처 넣을 때 줄이 틀어졌어」) = 칸 하나만 고쳐 「처음 값」이 그 칸에만 나와도 같은 줄 이름·입력 칸 선 하나 · 단추가 입력 칸 안 덮음 · 이름 한 줄 · 넘침 0
        console.log('①-e #1150 줄 카드 칸 정렬(칸 하나씩 고치기 · 세 폭 · 야간)');
        const ALIGN = () => { const R = e => e.getBoundingClientRect(), C = document.getElementById('om-card'), vw = document.documentElement.clientWidth, out = { row: [], cover: [], wrap: [], over: 0 };
            C.querySelectorAll('.om-rowcard .om-grid').forEach(g => { const rows = {}; [...g.children].filter(k => k.classList.contains('om-f') && R(k).height > 0).forEach(k => { const t = Math.round(R(k).top); (rows[t] = rows[t] || []).push(k); });
                Object.values(rows).forEach(fs => { if (fs.length < 2) return; const m = fs.map(f => { const c = f.querySelector('input:not([type=checkbox]), textarea, .om-combo, .om-step'); return [R(f.querySelector('.om-f-l')).top, R(f.querySelector('.om-f-l')).bottom, c ? R(c).top : null]; });
                    for (let i = 0; i < 3; i++) { const v = m.map(x => x[i]).filter(x => x != null); if (Math.max(...v) - Math.min(...v) > 1) out.row.push(fs.map(f => f.dataset.fwrap).join('|') + ' #' + i + ' ' + Math.round(Math.max(...v) - Math.min(...v))); } }); });
            C.querySelectorAll('.om-rowcard .om-undo1:not([hidden])').forEach(u => { const i = document.getElementById(u.dataset.f); if (i && R(u).bottom > R(i).top + 0.5) out.cover.push(u.dataset.f + ' ' + Math.round(R(u).bottom - R(i).top)); });
            C.querySelectorAll('.om-rowcard .om-f-l label').forEach(l => { if (R(l).height > 0 && new Set([...l.getClientRects()].map(q => Math.round(q.top))).size > 1) out.wrap.push(l.htmlFor); });
            C.querySelectorAll('*').forEach(e => { const r = R(e); if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) out.over++; }); out.sw = document.documentElement.scrollWidth; return out; };
        for (const [w, h, dark] of [[1500, 940, false], [720, 900, false], [390, 844, false], [1500, 940, true], [390, 844, true]]) {
            reset(); const cz = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w <= 720, isMobile: w <= 720 }); const pz = await cz.newPage(); pz.on('pageerror', e => pe.push('align ' + w + ' ' + String(e)));
            await openPanel(pz); if (dark) await pz.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
            const nm = w + (dark ? ' 야간' : ''), bad = [];
            for (const v of ['204', '192']) {
                await pz.click(`#om-card [data-cact="pxrowopen"][data-v="${v}"]`); await pz.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await pz.evaluate(() => document.querySelectorAll('#om-card details.om-more').forEach(d => d.open = true)); await pz.waitForTimeout(150);
                const a0 = await pz.evaluate(ALIGN); if (a0.row.length || a0.cover.length || a0.wrap.length || a0.over || a0.sw > w) bad.push([v, '처음', a0]);
                // #1152 묶음 구분 = 받는 분(이름·번호·주소) · 주문한 분(구매자 연락처) · 보내는 분(보내는이 변경) 세 묶음 · 머리 보임 · 받는 분 칸 한 단계 크게 · 바탕 다름 · 칸 차례(탭) 종전 그대로
                const G = await pz.evaluate(() => { const C = document.getElementById('om-card'), R = e => e.getBoundingClientRect(), ids = s => [...C.querySelectorAll(s + ' [id^="om-f-0-"]')].filter(e => /^om-f-0-(c\d+|date|outk)$/.test(e.id)).map(e => e.id.replace('om-f-0-', '')), cs = e => e && getComputedStyle(e);
                    const rh = C.querySelector('.om-grp-recv > .om-grp-h'), bh = C.querySelector('.om-grp-buyer > .om-grp-h'), ri = C.querySelector('#om-f-0-c3'), bi = C.querySelector('#om-f-0-c10');
                    return { recv: ids('.om-grp-recv'), buyer: ids('.om-grp-buyer'), more: ids('details.om-more'), rh: rh && R(rh).height > 0 ? rh.textContent.trim() : '', bh: bh && R(bh).height > 0 ? bh.textContent.trim() : '',
                        rH: Math.round(R(ri).height), bH: Math.round(R(bi).height), rF: parseFloat(cs(ri).fontSize), bF: parseFloat(cs(bi).fontSize), rBg: cs(C.querySelector('.om-grp-recv')).backgroundColor, bBg: cs(C.querySelector('.om-grp-buyer')).backgroundColor, cBg: cs(C.querySelector('.om-card-b') || C).backgroundColor,
                        tab: [...C.querySelectorAll('.om-rowcard [id^="om-f-0-"]')].filter(e => /^om-f-0-(c\d+|date|outk)$/.test(e.id)).map(e => e.id.replace('om-f-0-', '')),
                        k10ro: !!bi && bi.readOnly, same: !!C.querySelector('.om-grp-buyer .om-same'), lockN: (C.querySelector('.om-grp-buyer .om-lock-n:not(.om-outk-h)') || {}).textContent || '', k10L: (C.querySelector('label[for="om-f-0-c10"]') || {}).textContent || '',
                        ok_: (() => { const o = C.querySelector('#om-f-0-outk'); if (!o) return null; const a = R(bi), b = R(o); return { ph: o.placeholder, sameTop: Math.abs(a.top - b.top) <= 1, below: b.top >= a.bottom, w: Math.round(b.width) }; })() }; });
                const touch = w <= 720;
                const L4 = v === '204';   // #1153 204 = 입력삭제에 묶인 주소 줄(잠금 + 택배 양식 구매자 연락처) · 192 = 현금 줄(종전 그대로)
                ok(L4 ? G.k10ro && !G.same && /묶여 있는 동안은 못 바꿔요/.test(G.lockN) && /^구매자 번호/.test(G.k10L.trim()) && G.ok_ && /비우면 입력삭제 번호로 나가요/.test(G.ok_.ph) && (touch ? G.ok_.below : G.ok_.sameTop)
                       : !G.k10ro && G.same && !G.ok_ && G.k10L.trim() === '구매자 연락처',
                    nm + (L4 ? ' #1153 묶인 줄 = 구매자 번호 읽기 전용(자물쇠 라벨 · [수취인과 동일] 없음 · 안내 한 줄) + 「택배 양식 구매자 연락처」 ' + (touch ? '아래 쌓임' : '옆 나란히') : ' #1153 현금 줄 = 잠금·새 칸 없음(종전)'), G);
                ok(G.recv.join() === 'c3,c6,c8' && G.buyer.join() === (L4 ? 'c10,outk' : 'c10') && G.more.join() === 'c0,c1,c12' && /^받는 분 정보/.test(G.rh) && G.bh === '주문한 분 정보' && G.tab.join() === (L4 ? 'c4,c5,c3,c6,c8,c10,outk,c9,date,c0,c1,c12' : 'c4,c5,c3,c6,c8,c10,c9,date,c0,c1,c12')
                    && G.rH >= (touch ? 50 : 48) && G.rF >= (touch ? 18 : 17) && G.rF > G.bF && G.rH > G.bH && G.rBg !== G.bBg && G.rBg !== 'rgba(0, 0, 0, 0)',
                    nm + ' 줄 카드 ' + v + ' 묶음 = 받는 분(c3·c6·c8 · 머리 · 칸 ' + (touch ? '50/18px' : '48/17px') + '↑) · 주문한 분(c10) · 보내는 분(c0·c1·c12) · 바탕 다름 · 탭 순서 종전 그대로', G);
                const ids = await pz.$$eval('#om-card .om-rowcard input[id^="om-f-0-"]:not([type=checkbox]):not([readonly])', a => a.map(e => e.id));
                for (const id of ids) {
                    const v0 = await pz.inputValue('#' + id); await pz.fill('#' + id, id.endsWith('date') ? '11/30' : /-c(1|6|10)$/.test(id) ? '010-1234-56789012' : (v0 || '') + '고침'); await pz.locator('#' + id).blur(); await pz.waitForTimeout(80);
                    const a = await pz.evaluate(ALIGN); if (a.row.length || a.cover.length || a.wrap.length || a.over || a.sw > w) bad.push([v, id, a]);
                    const u = pz.locator(`#om-card [data-f="${id}"]`); if (await u.isVisible()) { await u.click(); await pz.waitForTimeout(60); }
                }
                if (v === '204') ok(ids.includes('om-f-0-c1') && ids.includes('om-f-0-outk') && !ids.includes('om-f-0-c10') && ids.includes('om-f-0-c0'), nm + ' 입력삭제 주소 줄 카드 = 보내는 분 이름·번호·택배 양식 구매자 연락처 칸 있음 · 구매자 번호(c10)는 읽기 전용', ids);
                await pz.click('#om-card [data-cact="cancel"]'); await pz.waitForTimeout(150); if (await pz.isVisible('#om-card [data-cact="discard"]')) await pz.click('#om-card [data-cact="discard"]'); await pz.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await pz.waitForTimeout(150);
            }
            ok(bad.length === 0, nm + ' 줄 카드 2장(입력삭제 주소 줄 204 · 현금 줄 192) × 칸 하나씩 고치기 = 같은 줄 이름·입력 칸 선 차 ≤1px · 「처음 값」이 입력 칸 안 덮음 · 이름 한 줄 · 넘침 0', bad.slice(0, 4));
            await cz.close();
        }
        // #1153 택배 양식 구매자 연락처 = 넣기 · 지우기 · 안 고침 PUT 본문 · 치는 중 그대로 · 떠날 때 하이픈 · 처음 값 · 400 문구 · k_kept · 양식 안내 · 풀린 줄
        console.log('①-f #1153 묶인 줄 구매자 번호 잠금 · 택배 양식 구매자 연락처');
        {
            const put = () => S.puts[S.puts.length - 1] || {};
            const open204 = async (pp) => { await openPanel(pp); await pp.click('#om-card [data-cact="pxrowopen"][data-v="204"]'); await pp.waitForSelector('#om-card:not([hidden]) #om-f-0-outk'); await pp.waitForTimeout(120); };
            reset(); const cy = await browser.newContext({ viewport: { width: 1500, height: 940 } }); const py = await cy.newPage(); py.on('pageerror', e => pe.push('outk ' + String(e)));
            await open204(py);
            await py.click('#om-f-0-outk'); await py.keyboard.type('01011112222'); const typing = await py.inputValue('#om-f-0-outk');
            const undoVis = await py.isVisible('#om-card [data-f="om-f-0-outk"]'); await py.click('#om-f-0-c3'); const left = await py.inputValue('#om-f-0-outk');
            const ro = await py.evaluate(() => { const i = document.getElementById('om-f-0-c10'); i.focus(); return { ro: i.readOnly, v: i.value }; }); await py.keyboard.type('999'); const k10 = await py.inputValue('#om-f-0-c10');
            await py.click('#om-card-save'); await until(() => S.puts.length); await py.waitForTimeout(400);
            ok(typing === '01011112222' && undoVis && left === '010-1111-2222' && ro.ro && k10 === ro.v && put().out_k === '010-1111-2222' && put()._id === 204 && dg(put().cells[10]) === dg(ro.v), '넣기 = 치는 중 그대로 · 「처음 값」 보임 · 떠날 때 010-1111-2222 · 구매자 번호 쳐도 안 바뀜 · PUT out_k 실림(cells K 그대로)', { typing, undoVis, left, ro, k10, put: { out_k: put().out_k, k: put().cells && put().cells[10] } });
            await cy.close();
            reset(); S.outKSet = '010-7777-8888'; const cy2 = await browser.newContext({ viewport: { width: 1500, height: 940 } }); const py2 = await cy2.newPage(); py2.on('pageerror', e => pe.push('outk2 ' + String(e)));
            await openPanel(py2); const panelT = await py2.evaluate(() => (document.querySelector('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="204"]').closest('li').querySelector('.om-out-t') || {}).textContent || '');
            await py2.click('#om-card [data-cact="pxrowopen"][data-v="204"]'); await py2.waitForSelector('#om-card:not([hidden]) #om-f-0-outk');
            const v0 = await py2.inputValue('#om-f-0-outk'), cardT = await py2.evaluate(() => (document.querySelector('#om-card .om-out') || {}).textContent || '');
            ok(v0 === '010-7777-8888' && panelT === '택배 양식에는 구매자 연락처 010-7777-8888 로 나가요' && cardT === panelT, '저장된 값 = 칸에 010-7777-8888 · 판 ②·줄 카드 안내 = 「택배 양식에는 구매자 연락처 010-7777-8888 로 나가요」', { v0, panelT, cardT });
            await py2.fill('#om-f-0-c3', '이름만고침'); await py2.click('#om-card-save'); await until(() => S.puts.length); await py2.waitForTimeout(1000);
            ok(!('out_k' in put()) && put().cells[3] === '이름만고침', '안 고침 = PUT 에 out_k 칸 없음(서버 그대로)', Object.keys(put()));
            await py2.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await py2.click('#om-card [data-cact="pxrowopen"][data-v="204"]'); await py2.waitForSelector('#om-card:not([hidden]) #om-f-0-outk');
            S.puts = []; const vRe = await py2.inputValue('#om-f-0-outk'); await py2.fill('#om-f-0-outk', ''); await py2.click('#om-f-0-c3'); const dirty = await py2.evaluate(() => !document.querySelector('#om-card [data-cact="reset"]').hidden);
            await py2.click('#om-card-save'); await until(() => S.puts.length); await py2.waitForTimeout(1000);
            ok(dirty && put().out_k === null && 'out_k' in put(), '지우기 = 고친 것으로 셈 · PUT out_k null', { vRe, dirty, put: put().out_k, n: S.puts.length });
            await py2.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await py2.click('#om-card [data-cact="pxrowopen"][data-v="204"]'); await py2.waitForSelector('#om-card:not([hidden]) #om-f-0-outk');
            await py2.fill('#om-f-0-outk', '010-1234-0000'); await py2.click('#om-f-0-c3'); await py2.click('#om-card [data-f="om-f-0-outk"]'); await py2.waitForTimeout(100);
            const back = await py2.inputValue('#om-f-0-outk'), clean = await py2.evaluate(() => document.querySelector('#om-card [data-cact="reset"]').hidden);
            await py2.click('#om-card [data-cact="cancel"]'); await py2.waitForTimeout(200); const asked = await py2.isVisible('#om-card [data-cact="discard"]');
            ok(back === '010-7777-8888' && clean && !asked, '「처음 값」 = 010-7777-8888 로 · 고친 것 0 · 닫을 때 안 물음', { back, clean, asked });
            await py2.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await py2.click('#om-card [data-cact="pxrowopen"][data-v="204"]'); await py2.waitForSelector('#om-card:not([hidden]) #om-f-0-outk');
            await py2.fill('#om-f-0-outk', '010-5555-6666'); await py2.click('#om-card [data-cact="cancel"]'); await py2.waitForTimeout(200); const asked2 = await py2.isVisible('#om-card [data-cact="discard"]'); if (asked2) await py2.click('#om-card [data-cact="discard"]');
            ok(asked2, '새 칸만 고치고 닫기 = 「저장 안 하고 닫을까요?」', asked2);
            // 400 · k_kept = 가짜 응답(route)
            const E400 = '택배 양식 구매자 연락처는 전화번호(010-0000-0000)로 넣어 주세요';
            await py2.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await py2.route('**/api/order-memo/rows/204', r => r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: E400 }) }) : r.continue());
            await py2.click('#om-card [data-cact="pxrowopen"][data-v="204"]'); await py2.waitForSelector('#om-card:not([hidden]) #om-f-0-outk');
            await py2.fill('#om-f-0-outk', '집전화'); await py2.click('#om-card-save'); await py2.waitForTimeout(500);
            const e4 = await py2.evaluate(() => ({ w: (document.getElementById('om-f-0-outk-w') || {}).textContent, blank: document.querySelector('[data-fwrap="om-f-0-outk"]').classList.contains('blank'), open: !document.getElementById('om-card').hidden && !!document.getElementById('om-f-0-outk') }));
            ok(e4.w === E400 && e4.blank && e4.open, '서버 400 = 그 칸 아래 문구 그대로 · 빨강 · 카드 그대로', e4);
            await py2.unroute('**/api/order-memo/rows/204'); await py2.click('#om-card [data-cact="cancel"]'); await py2.waitForTimeout(200); if (await py2.isVisible('#om-card [data-cact="discard"]')) await py2.click('#om-card [data-cact="discard"]');
            await py2.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await py2.route('**/api/order-memo/rows/204', async r => { if (r.request().method() !== 'PUT') return r.continue(); const x = await r.fetch(); const j = await x.json(); j.k_kept = true; await r.fulfill({ response: x, json: j }); });
            await py2.click('#om-card [data-cact="pxrowopen"][data-v="204"]'); await py2.waitForSelector('#om-card:not([hidden]) #om-f-0-outk'); await py2.fill('#om-f-0-c3', '열쇠시험'); await py2.click('#om-card-save'); await py2.waitForTimeout(700);
            const kn = await py2.evaluate(() => (document.getElementById('om-in-note') || {}).textContent || '');
            ok(/구매자 번호는 입력삭제 매칭 열쇠라 바꾸지 않았어요/.test(kn), 'k_kept 응답 = 「구매자 번호는 입력삭제 매칭 열쇠라 바꾸지 않았어요」', kn);
            await cy2.close();
            // 풀린 줄(메모 줄 190 지움 = 204 짝 없음) · 현금 줄 = 잠금 없음 · 새 칸 없음
            reset(); S.deleted = new Set([190]); const cy3 = await browser.newContext({ viewport: { width: 1500, height: 940 } }); const py3 = await cy3.newPage(); py3.on('pageerror', e => pe.push('lost ' + String(e)));
            S.n = 4; S.ent = 1; await py3.goto(base + '?v=new'); await py3.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await py3.waitForSelector('#om-ctw tbody tr');
            await py3.locator('#om-ctw tbody tr', { hasText: '둘째주소손님' }).locator('.om-ct-open').click(); await py3.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await py3.waitForTimeout(150);
            const lo = await py3.evaluate(() => ({ outk: !!document.getElementById('om-f-0-outk'), ro: document.getElementById('om-f-0-c10').readOnly, same: !!document.querySelector('#om-card .om-same') }));
            ok(!lo.outk && !lo.ro && lo.same, '풀린 줄 = 구매자 번호 고칠 수 있음 · 새 칸 없음 · [수취인과 동일] 그대로(종전)', lo);
            await cy3.close();
        }
        // ── 나뉜 입력삭제 · ③ 현금 줄 0 ────────────────
        console.log('② 나뉜 입력삭제(sent_split) · ③ 현금 줄 0');
        reset(); S.deleted = new Set([191, 192, 193, 203]); S.splitBadge = true;
        const c3 = await browser.newContext({ viewport: { width: 1500, height: 940 } }); const p3 = await c3.newPage(); p3.on('pageerror', e => pe.push('split ' + String(e)));
        await openPanel(p3); st = await panel(p3);
        ok(st.p2.join() === '201,204,205' && st.p3none && !st.p3.length, '나뉜 입력삭제 판 · ③ = 짝 없는 현금 줄 없음(0줄 안내)', { p2: st.p2, p3: st.p3, none: st.p3none });
        await p3.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="201"]'); await p3.click('#om-card-save'); await until(() => S.puts.length); await p3.waitForTimeout(400);
        ok(S.puts.filter(x => x.to_cash).map(x => x._id).join() === '201', '③ 0줄 판도 대기 → 저장 = PUT to_cash 1(201)', S.puts.map(x => [x._id, x.to_cash]));
        await c3.close();
        // ── 폰 390 ──────────────────────────────────
        console.log('③ 폰 390');
        reset();
        const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }); const p2 = await c2.newPage(); p2.on('pageerror', e => pe.push('390 ' + String(e)));
        await openPanel(p2); st = await panel(p2);
        ok(st.w === 390 && st.sw <= 390, '390 = 꽉 찬 꼴(폭 390) · 넘침 0', { w: st.w, sw: st.sw });
        await p2.click('#om-card .om-pairx-b [data-cact="pxrowopen"][data-v="192"]'); await p2.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p2.waitForTimeout(200);
        const sw2 = await p2.evaluate(() => document.documentElement.scrollWidth); await p2.click('#om-card [data-cact="cancel"]'); await p2.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); st = await panel(p2);
        ok(sw2 <= 390 && st.p2.join() === '201,204,205', '390 줄 카드 넘침 0 · 닫으면 판으로', { sw2, p2: st.p2 });
        await c2.close();
        // ── 깨짐 확인(총괄 · 대표 「칸이랑 깨지는 부분 없도록」) = 1500 · 폴드7 펼침 720 · 폰 390 · 야간 1번 · 긴 이름으로 두 줄 접히는 줄 · 줄 카드 펼친 상태
        console.log('④ 깨짐 확인(세 폭 · 야간 · 두 줄 줄 · 줄 카드)');
        const lay = p => p.evaluate(() => {
            const vw = document.documentElement.clientWidth, C = document.getElementById('om-card'), R = e => e.getBoundingClientRect(), out = { vw, sw: document.documentElement.scrollWidth };
            out.over = [...C.querySelectorAll('*')].filter(e => { const r = R(e); return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5); }).length;
            const lists = [...C.querySelectorAll('.om-px-paired, .om-pairx-b .om-pair-l')];
            out.liOverlap = 0; out.inOverlap = 0; out.rows = 0; out.twoLine = 0;
            lists.forEach(L => { const lis = [...L.children].filter(li => R(li).height > 0); out.rows += lis.length;
                for (let i = 1; i < lis.length; i++) if (R(lis[i]).top < R(lis[i - 1]).bottom - 0.5) out.liOverlap++;
                lis.forEach(li => { const t = li.querySelector('.om-pxrow-open'), a = li.querySelector('.om-pxrow-a') || li.querySelector('.om-pxc-ck'); if (!t || !a) return; const rt = R(t), ra = R(a); { const rg = document.createRange(); rg.selectNodeContents(t); if (new Set([...rg.getClientRects()].map(q => Math.round(q.top))).size >= 2) out.twoLine++; }
                    const x = Math.min(rt.right, ra.right) - Math.max(rt.left, ra.left), y = Math.min(rt.bottom, ra.bottom) - Math.max(rt.top, ra.top); if (x > 0.5 && y > 0.5) { out.inOverlap++; (out.why = out.why || []).push(['겹', L.className, Math.round(rt.left), Math.round(rt.right), Math.round(rt.top), Math.round(rt.bottom), Math.round(ra.left), Math.round(ra.right), Math.round(ra.top), Math.round(ra.bottom)]); }
                    if (R(li).bottom < rt.bottom - 0.5 || R(li).bottom < ra.bottom - 0.5) { out.inOverlap++; (out.why = out.why || []).push(['삐', L.className, Math.round(R(li).bottom), Math.round(rt.bottom), Math.round(ra.bottom), (() => { const g = getComputedStyle(li), q = getComputedStyle(a); return [g.display, g.height, g.maxHeight, g.overflow, g.gridTemplateRows, g.paddingTop, g.paddingBottom, q.height, q.minHeight, q.display, [...a.children].map(e => Math.round(R(e).height) + ':' + getComputedStyle(e).marginTop + '/' + getComputedStyle(e).marginBottom).join(' ')].join(' | '); })()]); } }); });
            const pl = [...C.querySelectorAll('.om-px-paired li')]; out.svcL = [...new Set(pl.map(li => Math.round(R(li.querySelector('.om-px-svc')).left)))]; out.btnL = [...new Set(pl.map(li => li.querySelector('[data-cact="pxdetach"], .om-px-ph')).filter(Boolean).map(b => Math.round(R(b).left)))];
            out.minH = Math.min(...[...C.querySelectorAll('.om-px-paired button, .om-px-paired label, .om-pairx-b button, .om-pairx-b label')].filter(e => R(e).height).map(e => Math.round(R(e).height)));
            out.pendOut = [...C.querySelectorAll('.om-pend-t, .om-out-t')].filter(e => { const r = R(e), q = R(e.closest('li')); return r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5 || r.left < q.left - 0.5 || r.right > q.right + 0.5; }).length; out.pendN = C.querySelectorAll('.om-pend-t').length;
            out.svcTop = [...new Set(pl.map(li => Math.round(R(li.querySelector('.om-px-svc')).top - R(li).top)))];
            return out; });
        const LAY = {};
        for (const [w, h, dark] of [[1500, 940, false], [720, 900, false], [390, 844, false], [1500, 940, true], [390, 844, true]]) {
            reset(); S.longName = true; S.many = true; S.out = true;
            const cx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w <= 720, isMobile: w <= 720 }); const px = await cx.newPage(); px.on('pageerror', e => pe.push(w + ' ' + String(e)));
            await openPanel(px); if (dark) { await px.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark')); await px.waitForTimeout(150); }
            const nm = w + (dark ? ' 야간' : ''); const a = await lay(px);
            const b0 = await px.evaluate(() => { const C = document.getElementById('om-card'), s = getComputedStyle(C.querySelector('.om-pxs-paired')); return { bg: s.backgroundColor, fg: getComputedStyle(C.querySelector('.om-pxrow-open')).color, w: Math.round(C.getBoundingClientRect().width) }; });
            await px.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="201"]'); await px.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="204"]'); await px.uncheck('#om-card .om-px-paired input[data-cact="pxsvc"][data-v="205"]'); await px.check('#om-card .om-pairx-b input[data-cact="pxchk"][data-v="191"]'); await px.check('#om-card .om-pairx-b input[data-cact="pxchk"][data-v="203"]'); await px.waitForTimeout(250); const b = await lay(px);
            if (process.env.SHOT1142) { await px.evaluate(() => { const q = document.querySelector('#om-card .om-card-b'); if (q) q.scrollTop = 0; }); await px.screenshot({ path: path.join(process.env.SHOT1142, 'px1142-' + w + (dark ? '-dark' : '') + '.png'), fullPage: false }); }
            await px.click('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="204"]'); await px.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await px.waitForTimeout(200);
            const cc = await px.evaluate(() => { const vw = document.documentElement.clientWidth, C = document.getElementById('om-card'), cr = C.getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, vw, out: [...C.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > cr.right + 0.5; }).length, w: Math.round(cr.width) }; });
            if (process.env.SHOT1142) await px.screenshot({ path: path.join(process.env.SHOT1142, 'px1142-' + w + (dark ? '-dark' : '') + '-card.png') });
            await px.click('#om-card [data-cact="cancel"]'); await px.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await px.waitForTimeout(300); const d = await lay(px);
            LAY[nm] = { 판폭: b0.w, 줄: a.rows, 두줄: a.twoLine, 겹침: a.liOverlap + a.inOverlap + b.liOverlap + b.inOverlap + d.liOverlap + d.inOverlap, 넘침: a.over + b.over + d.over + cc.out, 문서폭: Math.max(a.sw, b.sw, cc.sw, d.sw), 서비스선: a.svcL.length + '/' + b.svcL.length + '/' + d.svcL.length, 단추선: a.btnL.length, 최소접점: a.minH, 줄카드폭: cc.w };
            ok(a.rows >= 14 && a.liOverlap + a.inOverlap === 0 && b.liOverlap + b.inOverlap === 0 && d.liOverlap + d.inOverlap === 0, nm + ' ②·③ 줄 겹침 0(줄끼리 · 글과 조작 · 줄 밖으로 삐짐) — 처음 · 대기 2줄(+서비스 끔) · 줄 카드 닫은 뒤(대기 그대로)', { a, b, d });
            ok(a.twoLine >= 1, nm + ' 긴 이름 줄 = 두 줄 이상 접힘(그래도 겹침 0)', a.twoLine);
            ok(b.pendN === 2 && b.pendOut === 0 && d.pendN === 2 && d.pendOut === 0, nm + ' 대기 2줄 「저장하면 현금으로」 = 줄 안(다음 줄과 안 겹침)', { b: [b.pendN, b.pendOut], d: [d.pendN, d.pendOut] });
            const flat = v => Math.max(...v) - Math.min(...v) <= 1.5; if (w > 480) ok(flat(a.svcTop) && flat(b.svcTop) && flat(d.svcTop), nm + ' 서비스 칸·단추 높이 = 줄마다 같음(대기·두 줄 줄도 위로/아래로 안 어긋남)', { a: a.svcTop, b: b.svcTop, d: d.svcTop });
            ok(a.svcL.length === 1 && a.btnL.length === 1 && b.svcL.length === 1 && b.btnL.length === 1 && d.svcL.length === 1, nm + ' ② 서비스 칸·단추 = 세로 선 하나', { a: [a.svcL, a.btnL], b: b.svcL, d: d.svcL });
            ok(a.over + b.over + d.over === 0 && Math.max(a.sw, b.sw, d.sw) <= w && cc.out === 0 && cc.sw <= w, nm + ' 가로 넘침 0(판 · 대기 2줄 · 줄 카드 펼친 상태)', LAY[nm]);
            ok(w > 720 ? a.minH >= 36 : a.minH >= 44, nm + ' 접점 높이 ' + (w > 720 ? '36' : '44') + 'px↑', a.minH);
            if (dark) ok(b0.bg !== 'rgba(0, 0, 0, 0)' && b0.fg !== 'rgb(16, 24, 40)', nm + ' 야간 = 판 색·글 색 야간 값', b0);
            await cx.close();
        }
        console.log('  세 폭 수치', JSON.stringify(LAY));
        ok(LAY['1500'].판폭 === 1100 && LAY['720'].판폭 === 720 && LAY['390'].판폭 === 390 && LAY['1500'].줄카드폭 <= 700, '판 폭 = 1500 → 1100 · 720 → 720(꽉 참) · 390 → 390 · 줄 카드는 종전 폭(700 이하 = 원래 자리 카드 그대로)', LAY);
        ok(pe.length === 0, '스크립트 오류 0', pe);
    } catch (e) { failN++; console.log('  ❌ 예외', e && e.stack || e); }
    await browser.close(); srv.close();
    console.log(`\n결과 ${pass}/${pass + failN}`); process.exit(failN ? 1 : 0);
})();
let info3 = null;
