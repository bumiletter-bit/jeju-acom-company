// #1248 화면 검증 — 메모함 현금 줄 [고치기] 판의 「🏢 도로명 건물」 줄 · [도로명으로 바꾸기]·[주소에 넣기]·[주소에서 빼기] · 저장 본문
//   🔴 실DB·server.js·네트워크 0 — 이 스크립트가 띄우는 가짜 서버(가짜 /api/*)에 public/ao-ordermemo.js·css + 앱 공통 CSS 만 얹어 Playwright(헤드리스 1개)
//   주소 나누기 = public/order-organizer.js 의 splitAddr·tidyDetail·searchBody·exactMatches 를 파일에서 떼어 그대로 씀(가짜 아님)
//   폭 = 390(터치·isMobile) · 884(펼친 폴드) · 1280 · 야간 390 · 그림 = ~/.akkome/wip-1248/shots(리포 밖)
//   사용: node scripts/verify-1248-ui.js   (PORT1248 · 기본 3458)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const SHOTS = path.join(os.homedir(), '.akkome', 'wip-1248', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const OOJ = fs.readFileSync(path.join(ROOT, 'public', 'order-organizer.js'), 'utf8');
const ooPart = (() => { const i = OOJ.indexOf('function tidyDetail(d){'), j = OOJ.indexOf('const RE_APT', i); return OOJ.slice(i, j); })();
const JS = fs.readFileSync(path.join(ROOT, 'public', 'ao-ordermemo.js'), 'utf8'), CSS = fs.readFileSync(path.join(ROOT, 'public', 'ao-ordermemo.css'), 'utf8');
const CAT = ['타이벡감귤 5kg', '타이벡감귤 3kg'];
const HS = '제주특별자치도 제주시 화삼로 166', BOO = '제주삼화사랑으로부영5차', DET = '501동, 상가동, 관리동, 515동, 514동, 513동, 512동, 511동, 510동';
const J = (p1, bdNm, bdKdcd, det, zip) => ({ roadAddrPart1: p1, bdNm: bdNm || '', bdKdcd: String(bdKdcd), detBdNmList: det || '', zipNo: zip || '63000', jibunAddr: '' });
const JUSO = [[/화삼로\s*166/, [J(HS, BOO, 1, DET, '63318')]], [/광양9길\s*10/, [J('제주특별자치도 제주시 광양9길 10', '제주시청', 0, '본관, 제2별관')]], [/연동로\s*8/, [J('제주특별자치도 제주시 연동로 8', '연동상가', 0), J('제주특별자치도 제주시 연동로 8', '연동하이츠', 1)]], [/효돈순환로\s*11/, [J('제주특별자치도 서귀포시 효돈순환로 11', '', 0)]]];
const ROWS = [
    ['A 안 적음', '화삼로 166, 511동 103호'],
    ['B 적음·같음', '화삼로 166, 삼화부영5차 511동 103호'],
    ['C 적음·다름', '화삼로 166, 한라아파트 511동 103호'],
    ['D 공동주택 아님', '광양9길 10, 본관 2층'],
    ['E 이름 여럿', '연동로 8, 201호'],
    ['F 이름 없음', '효돈순환로 11'],
    ['G 동만', '화삼로 166, 511동'],
];
const S = { puts: [], juso: 0 };
const list = () => ({ ok: true, ship_date: '2026-11-23', keep_days: 15, counts: {}, entries: [{ id: 1, created_at: new Date().toISOString(), source: 'manual', rows: ROWS.map(([nm, addr], i) => ({ id: 500 + i, kind: 'cash', state: 'open', sure: true, check_why: [], addr_ok: null, indiv: false, service: false, cells: ['보내는분 드림!', '010-3300-000' + i, '제주시 연삼로 1066-31', '손님' + nm, CAT[0], '1', '010-5500-000' + i, '', addr, '', '010-5500-000' + i, '', ''] })) }] });
const page0 = () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#EEF0F4;font-family:system-ui,"Malgun Gothic",sans-serif}*{animation:none!important;transition:none!important;caret-color:transparent!important}</style>
<link rel="stylesheet" href="/app/styles.css"><link rel="stylesheet" href="/app/theme.css"><link rel="stylesheet" href="/app/ao-desk.css"><link rel="stylesheet" href="/om.css"></head><body>
<script>localStorage.setItem('jwt_token','x');window.showToast=function(m){(window.__toasts=window.__toasts||[]).push(m)};</script>
<script src="/oo.js"></script><script src="/om.js"></script></body></html>`;
function serve(port) {
    const srv = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x'), send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
        if (u.pathname === '/') return send(200, page0(), 'text/html; charset=utf-8');
        if (u.pathname === '/om.js') return send(200, JS, 'text/javascript; charset=utf-8');
        if (u.pathname === '/oo.js') return send(200, ooPart + '\nwindow.__ooTest = { splitAddr, tidyDetail, searchBody, exactMatches };', 'text/javascript; charset=utf-8');
        if (/^\/app\/(styles|theme|ao-desk)\.css$/.test(u.pathname)) return send(200, fs.readFileSync(path.join(ROOT, 'public', path.basename(u.pathname))), 'text/css; charset=utf-8');
        if (u.pathname === '/om.css') return send(200, CSS, 'text/css; charset=utf-8');
        if (u.pathname === '/api/order-memo' && req.method === 'GET') return send(200, u.searchParams.get('state') === 'cleared' ? { ok: true, entries: [] } : list());
        if (u.pathname === '/api/order-memo/for-ship') return send(200, { ok: true, cash_ids: [], lines: [] });
        if (u.pathname === '/api/invoice/catalog') return send(200, { byPartner: { a: CAT } });
        if (u.pathname === '/api/agent-office/juso') { S.juso++; const kw = u.searchParams.get('keyword') || ''; const hit = JUSO.find(([re]) => re.test(kw)); return send(200, { results: { common: { errorCode: '0' }, juso: hit ? hit[1] : [] } }); }
        if (req.method === 'PUT') { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { S.puts.push(JSON.parse(b)); } catch (e) { } send(200, { ok: true }); }); return; }
        if (req.method !== 'GET') return send(200, { ok: true });
        return send(404, { ok: false });
    });
    return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}
const until = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 40)); } };
(async () => {
    const PORT = Number(process.env.PORT1248 || 3458), srv = await serve(PORT), base = `http://127.0.0.1:${PORT}/`;
    const browser = await chromium.launch();
    try {
        for (const [w, h, touch, dark] of [[390, 844, true, false], [884, 1000, true, false], [1280, 900, false, false], [390, 844, true, true]]) {
            const tag = w + (dark ? ' 야간' : '') + (touch ? ' 터치' : '');
            console.log(`── ${tag}`);
            const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch && w < 600 });
            const p = await ctx.newPage(); const pe = []; p.on('pageerror', e => pe.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) pe.push('console ' + m.text()); });   /* 404 = 가짜 서버에 없는 다른 화면 자료(검증 밖) */
            await p.goto(base); if (dark) await p.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
            await p.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await p.waitForSelector('#om-ctw tbody tr', { state: 'attached' }); if (await p.isVisible('#om-prev-open')) await p.click('#om-prev-open'); await p.waitForSelector('#om-ctw tbody tr');
            await p.waitForTimeout(600);
            const pills = await p.evaluate(() => document.querySelectorAll('#om-ctw .om-pill.k-addrchk').length);
            ok(pills === 0, `${tag} 표 「주소 확인 필요」 알약 0(건물명 일치·다름·확인 필요는 셈 안 함)`, pills);
            const tapOrClick = async sel => { if (touch) await p.tap(sel); else await p.click(sel); };
            const openRow = async nm => { await p.waitForTimeout(400); if (await p.evaluate(() => !document.getElementById('om-card').hidden)) { await p.locator('#om-card [data-cact="cancel"]').first().click(); await p.waitForTimeout(200); const dz = p.locator('#om-card [data-cact="discard"]'); if (await dz.count()) { await dz.first().click(); await p.waitForTimeout(200); } } await p.locator('#om-ctw tbody tr', { hasText: nm }).locator('.om-ct-open').click(); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await until(() => p.evaluate(() => { const a = document.querySelector('#om-card .om-addr'); return a && !/확인 중/.test(a.textContent) && a.textContent.trim(); })); await p.waitForTimeout(120); };
            const addrTxt = () => p.evaluate(() => (document.querySelector('#om-card .om-addr') || {}).textContent.replace(/\s+/g, ' ').trim());
            const val = () => p.evaluate(() => document.querySelector('#om-card textarea[data-fi="8"]').value);
            const probe = () => p.evaluate(() => { const card = document.querySelector('#om-card .om-rowcard') || document.getElementById('om-card'); const bs = [...document.querySelectorAll('#om-card .om-bd button')].map(b => { const r = b.getBoundingClientRect(); return Math.round(r.height); }); return { over: card.scrollWidth - card.clientWidth, docw: document.documentElement.scrollWidth, bh: bs }; });
            // A
            await openRow('A 안 적음'); let t = await addrTxt();
            ok(/도로명 건물: 제주삼화사랑으로부영5차/.test(t) && t.includes('도로명 ' + HS + ', ' + BOO + ' 511동 103호') && /도로명으로 바꾸기/.test(t), `${tag} A = 확인됨 · 도로명(건물명 끼운 글) + 🏢 도로명 건물 줄`, t);
            let pr = await probe(); ok(pr.over <= 0 && pr.docw <= w && (!touch || pr.bh.every(x => x >= 44)), `${tag} A 판 넘침 0 · 문서 폭 ≤ ${w}${touch ? ' · 🏢 줄 단추 높이 ≥ 44' : ''}`, pr);
            if (!dark) await p.locator('#om-card .om-rowcard').screenshot({ path: path.join(SHOTS, `A-${w}${touch ? '-t' : ''}.png`) }).catch(() => { });
            if (dark) await p.locator('#om-card .om-rowcard').screenshot({ path: path.join(SHOTS, `A-${w}-dark.png`) }).catch(() => { });
            await tapOrClick('#om-card [data-cact="addrset"][data-v="one"]'); await p.waitForTimeout(150);
            ok(await val() === HS + ', ' + BOO + ' 511동 103호', `${tag} A [도로명으로 바꾸기] = 칸 「…화삼로 166, 제주삼화사랑으로부영5차 511동 103호」`, await val());
            t = await addrTxt(); ok(/주소에 넣었어요/.test(t) && /주소에서 빼기/.test(t) && !/도로명으로 바꾸기/.test(t), `${tag} A 바꾼 뒤 = 「주소에 넣었어요」 + [주소에서 빼기]`, t);
            await tapOrClick('#om-card [data-cact="addrbd"][data-v="0"]'); await p.waitForTimeout(150);
            ok(await val() === HS + ', 511동 103호', `${tag} A [주소에서 빼기] = 「…화삼로 166, 511동 103호」(손님 상세 그대로)`, await val());
            await tapOrClick('#om-card [data-cact="addrbd"][data-v="0"]'); await p.waitForTimeout(150);
            ok(await val() === HS + ', ' + BOO + ' 511동 103호', `${tag} A [주소에 넣기] 다시 = 끼운 글`, await val());
            if (w === 390 && !dark) {
                S.puts = []; await tapOrClick('#om-card-save'); await until(() => S.puts.length);
                const c8 = S.puts.length && (S.puts[0].cells || (S.puts[0].row || {}).cells || [])[8];
                ok(c8 === HS + ', ' + BOO + ' 511동 103호', '390 A [저장] 본문 cells[8] = 끼운 주소(저절로 저장 없음 · 누른 뒤 저장만)', S.puts[0]);
            }
            // B
            await openRow('B 적음·같음'); t = await addrTxt();
            ok(t.includes('도로명 ' + HS + ', 삼화부영5차 511동 103호') && /도로명 건물: 제주삼화사랑으로부영5차 · 일치/.test(t) && !/확인 필요|확인해/.test(t), `${tag} B = 주소 글은 손님 글 그대로 + 「· 일치」`, t);
            await tapOrClick('#om-card [data-cact="addrset"][data-v="one"]'); await p.waitForTimeout(120);
            ok(await val() === HS + ', 삼화부영5차 511동 103호', `${tag} B [도로명으로 바꾸기] = 손님 「삼화부영5차」 그대로(공식 이름으로 안 바뀜)`, await val());
            if (w === 390 && !dark) await p.locator('#om-card .om-rowcard').screenshot({ path: path.join(SHOTS, `B-390.png`) }).catch(() => { });
            // C
            await openRow('C 적음·다름'); t = await addrTxt();
            ok(t.includes(HS + ', 한라아파트 511동 103호') && /도로명 건물: 제주삼화사랑으로부영5차/.test(t) && !/일치|확인 필요|확인해|건물명 다름/.test(t), `${tag} C = 손님 글 그대로 · 이름만 보여 줌(경고 없음)`, t);
            await tapOrClick('#om-card [data-cact="addrbd"][data-v="0"]'); await p.waitForTimeout(120);
            ok(await val() === HS + ', ' + BOO + ' 한라아파트 511동 103호', `${tag} C [주소에 넣기](옅은 단추) = 손님 글 앞에 끼움 · 손님 글 안 지움`, await val());
            // D·E·F·G
            await openRow('D 공동주택 아님'); t = await addrTxt();
            ok(/이 번지 건물 \(확인 필요\): 제주시청/.test(t) && /확인 필요/.test(t) && t.includes(', 본관 2층'), `${tag} D = 「🏢 이 번지 건물: 제주시청 (확인 필요)」 · 안 끼움`, t);
            await tapOrClick('#om-card [data-cact="addrbd"][data-v="0"]'); await p.waitForTimeout(120);
            ok(await val() === '제주특별자치도 제주시 광양9길 10, 제주시청 본관 2층', `${tag} D [주소에 넣기] = 끼움`, await val());
            if (w === 390 && !dark) await p.locator('#om-card .om-rowcard').screenshot({ path: path.join(SHOTS, `D-390.png`) }).catch(() => { });
            await openRow('E 이름 여럿'); t = await addrTxt();
            ok(/이 번지 건물 \(확인 필요\): 연동상가/.test(t) && /연동하이츠/.test(t) && /확인 필요/.test(t) && (await p.$$('#om-card .om-bd [data-cact="addrbd"]')).length === 2, `${tag} E = 이름마다 [주소에 넣기] 2개 · (확인 필요)`, t);
            await tapOrClick('#om-card [data-cact="addrbd"][data-v="1"]'); await p.waitForTimeout(120);
            ok(await val() === '제주특별자치도 제주시 연동로 8, 연동하이츠 201호', `${tag} E 둘째 이름 넣기 = 「…연동로 8, 연동하이츠 201호」`, await val());
            pr = await probe(); ok(pr.over <= 0 && pr.docw <= w && (!touch || pr.bh.every(x => x >= 44)), `${tag} E 판 넘침 0${touch ? ' · 단추 ≥ 44' : ''}`, pr);
            if (w === 390 && !dark) await p.locator('#om-card .om-rowcard').screenshot({ path: path.join(SHOTS, `E-390.png`) }).catch(() => { });
            await openRow('F 이름 없음'); t = await addrTxt();
            ok(!/🏢/.test(t) && /확인됨/.test(t), `${tag} F = 🏢 줄 없음(종전 꼴)`, t);
            await openRow('G 동만'); t = await addrTxt();
            ok(/호수를 확인해 주세요/.test(t) && !/동·호수를|없는 동/.test(t) && t.includes(BOO + ' 511동'), `${tag} G 동만 = 「호수를 확인해 주세요」 알림(경고만 · 끼우기는 그대로)`, t);
            ok(pe.length === 0, `${tag} pageerror·콘솔 오류 0`, pe);
            await ctx.close();
        }
    } catch (e) { failN++; console.log('  ❌ 실행 오류', e && e.stack || e); }
    await browser.close(); srv.close();
    console.log(`\n합계 ${pass}/${pass + failN} · 그림 ${SHOTS}`); process.exit(failN ? 1 : 0);
})();
