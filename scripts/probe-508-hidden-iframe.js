// #508 조사(워커1) — 버리는 시험: 에이전트 오피스 화면 안 숨은 iframe으로 송장변환 v2를 조종해 부모가 워크북을 저장할 수 있는가
//   제품 코드 수정 0 · 로컬 서버 3458(JWT_SECRET=verifytest · setInterval 무력화) · 주문은 전부 가짜 행 · DB 쓰기 0(조회 API만)
//   실행: node probe-508-hidden-iframe.js   (회사프로그램 폴더의 node_modules를 쓴다)
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn } = require('child_process');
const ROOT = 'C:/Users/전승범/OneDrive/문서/★제주아꼼이네 회사프로그램';
const req = m => require(path.join(ROOT, 'node_modules', m));
req('dotenv').config({ path: path.join(ROOT, '.env') });
const jwt = req('jsonwebtoken'); const XLSX = req('xlsx-js-style'); const { chromium } = req('playwright');
const PORT = 3458, BASE = `http://localhost:${PORT}`;
const USER = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' };
const TOKEN = jwt.sign(USER, 'verifytest', { expiresIn: '1h' });
const OUT = path.join(os.tmpdir(), 'probe508'); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 260) : '')); };
const note = (t, d) => console.log('  ℹ️ ' + t + (d != null ? ' — ' + String(d).slice(0, 300) : ''));
const usd = iso => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(2, 4)}`;
const fillOf = c => c && c.s && ((c.s.fgColor && c.s.fgColor.rgb) || (c.s.fill && c.s.fill.fgColor && c.s.fill.fgColor.rgb)) || null;
const OPT = ['아꼼이네 상품선택: 1. 고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)', '아꼼이네 상품선택: 2. 과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)'];

function fakeRows(shipDays) {
    const later = shipDays[2];
    const memoFuture = `${+later.slice(5, 7)}월 ${+later.slice(8, 10)}일 발송 부탁드려요`;
    const mk = (n, tel, memo) => ({ '구매자명': '구매' + n, '구매자연락처': tel, '수취인명': '받는' + String(n).padStart(2, '0'), '옵션정보': OPT[n % 2], '수량': 1 + (n % 2), '수취인연락처1': tel, '수취인연락처2': '',
        '통합배송지': (n === 5 ? '제주특별자치도 제주시 시험로 ' : '서울특별시 시험구 시험로 ') + n, '배송메세지': memo, _pid: '20261004000' + String(n).padStart(3, '0'),
        _x: { productOrderId: '20261004000' + String(n).padStart(3, '0'), orderId: '2026100400' + String(n).padStart(3, '0'), paymentDate: '2026-10-04T09:00:00.000+09:00', orderDate: '2026-10-04T08:59:00.000+09:00', ordererId: 'tester' + n, productId: '6400134206', productName: '시험 상품', expectedSettlementAmount: 20000 + n, shippingDueDate: '2026-10-09T23:59:59.000+09:00', inflowPath: '', deliveryMethod: 'DELIVERY', productOrderStatus: 'PAYED' } });
    const tel = n => '010-7000-' + String(1000 + n);
    const rows = [];
    for (let n = 1; n <= 10; n++) rows.push(mk(n, tel(n), n % 3 === 0 ? '문앞에 놔주세요' : ''));
    rows.push(mk(11, tel(11), memoFuture));                          // 손님 메모: 뒤 날짜 발송 요청 → 제외 후보
    rows.push(mk(12, tel(12), '보내는이 홍길동 변경'));                 // 보내는이 자동
    rows.push(mk(13, tel(13), '보내는이: 홍길동 즐거운 추석 보내세요'));   // 보내는이 애매
    rows.push(mk(14, tel(50), '')); rows.push(mk(15, tel(50), ''));  // 같은 구매자 A 2건 → 정리 줄: 기준일 + 입력o삭제x
    rows.push(mk(16, tel(60), '')); rows.push(mk(17, tel(60), ''));  // 같은 구매자 B 2건 → 정리 줄: 뒤 날짜
    rows.push(mk(18, tel(70), memoFuture));                          // 구매자 C: 메모는 뒤 날짜인데 정리 줄 = 기준일 메모무시
    rows.push(mk(19, tel(19), 's사이즈로 보내주세요'));                 // 사이즈 요청
    rows.push(mk(20, tel(20), ''));
    return { rows, A: tel(50), B: tel(60), C: tel(70) };
}

async function runOne(br, label, viewport, mobile, mode) {
    console.log(`\n── ${label} · iframe ${mode} ──`);
    const ctx = await br.newContext({ acceptDownloads: true, viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
    await ctx.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [TOKEN, USER]);
    const pg = await ctx.newPage(); const errs = [], dialogs = [], apiHits = {};
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) errs.push(m.text()); });
    pg.on('dialog', async d => { dialogs.push(d.type() + ':' + d.message().slice(0, 60)); await d.dismiss(); });
    pg.on('response', r => { const m = /\/api\/(invoice\/catalog|agent-office\/invoice\/memo-parse)/.exec(r.url()); if (m && /invoice-v2|localhost/.test(r.url())) apiHits[m[1]] = (apiHits[m[1]] || 0) + (r.status() === 200 ? 1 : 0); });
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500);
    await pg.evaluate(() => switchPage('agent-office')); await pg.waitForTimeout(1200);
    const active = await pg.evaluate(() => (document.querySelector('.page.active') || {}).id);
    ok(active === 'page-agent-office', '에이전트 오피스 화면 진입', active);
    // ① iframe 주입 + 부모가 받는 메시지 기록
    await pg.evaluate(mode => {
        window.__probeMsgs = []; window.addEventListener('message', ev => { if (ev.data && ev.data.type === 'ivt-height') window.__probeMsgs.push(Math.round(ev.data.h)); });
        const f = document.createElement('iframe'); f.id = 'fo-frame'; f.src = '/invoice-v2.html?embed=1';
        f.style.cssText = mode === 'none' ? 'display:none;' : 'position:absolute; left:-9999px; top:0; width:1200px; height:800px; border:0;';
        document.getElementById('page-agent-office').appendChild(f);
    }, mode);
    let inited = true;
    try { await pg.waitForFunction(() => { const w = document.getElementById('fo-frame').contentWindow; return w && w.__ivt && w.__ivt.S && w.__ivt.S.calendar; }, null, { timeout: 30000 }); } catch (_) { inited = false; }
    const st0 = await pg.evaluate(() => { const w = document.getElementById('fo-frame').contentWindow; const i = w && w.__ivt; return { ivt: !!i, cal: !!(i && i.S.calendar), ship: i && i.S.shipDate, days: i && i.S.calendar ? i.S.calendar.shipDays : [], xlsxIn: !!(w && w.XLSX), xlsxParent: !!window.XLSX, sender: !!(w && w.IvtSender), gate: w ? getComputedStyle(w.document.getElementById('login-gate')).display : '?' }; });
    ok(inited && st0.ivt && st0.cal && st0.days.length >= 3, '① __ivt 초기화 · 달력(S.calendar) 로드', JSON.stringify({ ship: st0.ship, days: st0.days.length, gate: st0.gate }));
    ok((apiHits['invoice/catalog'] || 0) >= 1 && (apiHits['agent-office/invoice/memo-parse'] || 0) >= 1, '① 단가표 카탈로그·memo-parse 호출 200', JSON.stringify(apiHits));
    ok(st0.xlsxIn && st0.sender, '① iframe 안 XLSX·보내는이 판정기 로드', `부모 XLSX 전역 = ${st0.xlsxParent}`);
    if (!inited) { await ctx.close(); return; }
    // ② 가짜 20행 + 정리 줄 3종
    const ship = st0.ship, later = st0.days.find(d => d > ship);
    const { rows, A, B, C } = fakeRows(st0.days);
    const lines = [`${usd(ship)}\t${A}\t입력o삭제x\t네이버`, `${usd(later)}\t${B}\t\t네이버`, `${usd(ship)}\t${C}\t메모무시\t네이버`].join('\n');
    const st2 = await pg.evaluate(async ([rows, lines]) => {
        const w = document.getElementById('fo-frame').contentWindow, i = w.__ivt;
        await i.setNaverApiRows(rows);
        w.document.getElementById('ln-all').value = lines; await i.saveLines(i.S);
        const by = n => i.S.merged.find(e => e.conv['수취인명'] === '받는' + n) || {};
        const pick = n => { const e = by(n); return { indiv: !!e.individual, excl: !!e.excluded, flag: e.flag || null, kind: e.reqKind || null, sender: e.sender ? (e.sender.ambiguous ? 'amb' : e.sender.name) : null, opt: String((e.conv || {})['옵션정보'] || '').slice(0, 30) }; };
        return { n: i.S.merged.length, today: i.S.today, r11: pick('11'), r12: pick('12'), r13: pick('13'), r14: pick('14'), r15: pick('15'), r16: pick('16'), r17: pick('17'), r18: pick('18'), r19: pick('19'), r01: pick('01'),
            lines: (i.S.allLines || []).map(l => ({ hits: l.hits, st: l._st && l._st.k })), unmatched: i.S.merged.filter(e => String(e.conv['옵션정보'] || '').startsWith('[미매칭]')).length, dl: w.document.getElementById('btn-download').disabled };
    }, [rows, lines]);
    ok(st2.n === 20 && st2.today === ship, '② 가짜 20행 주입 → S.merged 20 · 기준일 유지', `today ${st2.today} · 미매칭 ${st2.unmatched}행`);
    ok(st2.r14.indiv && st2.r15.indiv && st2.r14.kind === 'indiv', '② 기준일 + 입력o삭제x(같은 구매자 2건) → 개별발송 2건', JSON.stringify([st2.r14, st2.r15]));
    ok(st2.r16.excl && st2.r17.excl && st2.r16.kind === 'future', '② 뒤 날짜 줄(같은 구매자 2건) → 제외 2건', JSON.stringify([st2.r16, st2.r17]));
    ok(!st2.r18.excl && st2.r18.kind === 'today', '② 기준일 메모무시 줄 → 손님 메모(뒤 날짜)보다 우선 · 발송', JSON.stringify(st2.r18));
    ok(st2.r11.excl && st2.r11.flag === 'excl', '② 손님 메모 뒤 날짜 발송 요청 → 자동 제외', JSON.stringify(st2.r11));
    ok(st2.r12.sender === '홍길동' && st2.r13.sender === 'amb', '② 보내는이 요청: 확실 = 자동 · 애매 = 표시만', JSON.stringify([st2.r12.sender, st2.r13.sender]));
    ok(st2.lines.length === 3 && st2.lines.every(l => l.hits === 2 || l.hits === 1) && st2.lines.every(l => l.st === 'ok'), '② 줄별 판정(allLines._st) 3줄 확인완료', JSON.stringify(st2.lines));
    // ③ iframe 안 writeFile 을 덮고 download() → 부모가 Blob 저장  (way: parent = 부모 XLSX 로 write / frame = iframe XLSX 로 write)
    const save = async (way, cash) => {
        const dl = pg.waitForEvent('download', { timeout: 20000 });
        const info = await pg.evaluate(async ([way, cash]) => {
            const w = document.getElementById('fo-frame').contentWindow;
            const orig = w.XLSX.writeFile; let wrote = 0; w.XLSX.writeFile = () => { wrote++; };
            let wb; try { wb = await w.__ivt.download(); } finally { w.XLSX.writeFile = orig; }
            if (!wb) return { err: 'download() null — ' + w.document.getElementById('msg-dl').textContent };
            if (cash) w.XLSX.utils.sheet_add_aoa(wb.Sheets['Sheet1'], cash, { origin: -1 });
            const X = way === 'parent' ? window.XLSX : w.XLSX;
            const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = `최종발주_시험_${way}${cash ? '_현금' : ''}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
            return { sheets: wb.SheetNames, wrote, bytes: buf.byteLength || buf.length, msg: w.document.getElementById('msg-dl').textContent.slice(0, 120) };
        }, [way, cash || null]);
        if (info.err) { dl.catch(() => { }); return { info }; }
        const d = await dl; const f = path.join(OUT, `${label}-${mode}-${way}${cash ? '-cash' : ''}.xlsx`.replace(/\s+/g, '')); await d.saveAs(f);
        return { info, f, wb: XLSX.readFile(f, { cellStyles: true }) };
    };
    const check = (res, tag) => {
        if (!res.wb) { ok(false, `③ ${tag} 저장`, JSON.stringify(res.info)); return null; }
        const s1 = res.wb.Sheets['Sheet1'], s2 = res.wb.Sheets['발주발송관리'];
        const a1 = XLSX.utils.sheet_to_json(s1, { header: 1, defval: '' }), a2 = XLSX.utils.sheet_to_json(s2, { header: 1, defval: '' });
        const n1 = a1.length - 1, n2 = a2.length - 2;
        ok(res.wb.SheetNames.join(',') === 'Sheet1,발주발송관리' && n1 === 15 && n2 === 17 && res.info.wrote === 1, `③ ${tag}: 2시트 · 시트1 15행(20−개별2−제외3) · 시트2 17행 · iframe 저장은 가로챔`, `시트1 ${n1} · 시트2 ${n2} · writeFile 가로챔 ${res.info.wrote}회 · ${res.info.bytes}B`);
        const yellow = []; for (let r = 3; r <= 2 + n2; r++) if (fillOf(s2['A' + r]) === 'FFF2CC') yellow.push(r);
        const last2 = a2.slice(-2).map(r => r[6]);
        ok(yellow.length === 2 && yellow.join(',') === `${n2 + 1},${n2 + 2}` && last2.join(',') === '받는14,받는15', `③ ${tag}: 시트2 노란 줄 2개 = 맨 아래(개별발송)`, `노란 행 ${yellow} · ${last2}`);
        const order1 = a1.slice(1).map(r => r[3]), order2 = a2.slice(2, 2 + n1).map(r => r[6]);
        ok(order1.join() === order2.join(), `③ ${tag}: 시트1 ↔ 시트2 행 순서 1:1`);
        const rowOf = nm => a1.findIndex(r => r[3] === nm) + 1;
        const r12 = rowOf('받는12'), r13 = rowOf('받는13'), r19 = rowOf('받는19'), r18 = rowOf('받는18'), r05 = rowOf('받는05');
        const colors = { hA: fillOf(s1.A1), hD: fillOf(s1.D1), s2hdr: fillOf(s2.A2), A12: fillOf(s1['A' + r12]), J12: fillOf(s1['J' + r12]), J13: fillOf(s1['J' + r13]), J19: fillOf(s1['J' + r19]), I05: fillOf(s1['I' + r05]), J18v: String((s1['J' + r18] || {}).v || ''), A12v: String((s1['A' + r12] || {}).v || '') };
        ok(colors.hA === '92D050' && colors.hD === 'FFFF00' && colors.s2hdr === 'DDEBF7' && colors.A12 === 'DDEBF7' && colors.J12 === 'DDEBF7' && colors.J13 === 'FFF2CC' && colors.J19 === 'FCE4D6' && colors.I05 === 'FFFF00' && colors.J18v === '' && colors.A12v === '홍길동 드림', `③ ${tag}: 색·값 생존(머리글 · 보내는이 연파랑 · 애매 연노랑 · 사이즈 연주황 · 제주 노랑 · 메모무시 행 메모 비움)`, JSON.stringify(colors));
        return { s1, a1 };
    };
    const base = check(await save('parent'), '부모 XLSX 로 write');
    check(await save('frame'), 'iframe XLSX 로 write');
    // ④ 현금 행 3줄 덧붙이기(같은 11칸) — 기존 셀 값·스타일 보존 여부
    const cash = [1, 2, 3].map(n => ['현금' + n + ' 드림!', '010-0000-000' + n, '제주특별자치도 제주시 연삼로 1066-31, 제주아꼼이네', '현금받는' + n, '선물용 - 3kg(로얄과)', n, '010-9000-000' + n, '', '경기도 시험시 시험로 ' + n, '', '']);
    const withCash = await save('parent', cash);
    if (base && withCash.wb) {
        const c1 = withCash.wb.Sheets['Sheet1']; const keys = Object.keys(base.s1).filter(k => k[0] !== '!');
        const diff = keys.filter(k => JSON.stringify([base.s1[k].v, base.s1[k].t, base.s1[k].s]) !== JSON.stringify([(c1[k] || {}).v, (c1[k] || {}).t, (c1[k] || {}).s]));
        const aC = XLSX.utils.sheet_to_json(c1, { header: 1, defval: '' });
        ok(diff.length === 0 && aC.length === base.a1.length + 3 && aC.slice(-3).map(r => r[3]).join() === '현금받는1,현금받는2,현금받는3', '④ 메모리 워크북에 현금 3줄 덧붙여 저장 → 기존 셀 값·스타일 전부 동일 · 3줄은 맨 끝', `${keys.length}셀 비교 · 차이 ${diff.length}${diff.length ? ' 예 ' + diff.slice(0, 3) : ''} · 새 줄 스타일 ${JSON.stringify((c1['A' + aC.length] || {}).s || null)}`);
        ok(withCash.wb.SheetNames.includes('발주발송관리') && XLSX.utils.sheet_to_json(withCash.wb.Sheets['발주발송관리'], { header: 1 }).length - 2 === 17, '④ 시트2는 그대로(17행)');
    } else ok(false, '④ 현금 행 덧붙이기', JSON.stringify(withCash.info));
    // ⑤ 숨긴 상태에서 걸리는 것
    const st5 = await pg.evaluate(async () => {
        const w = document.getElementById('fo-frame').contentWindow, i = w.__ivt; const out = {};
        out.msgs = window.__probeMsgs.length; out.msgSample = window.__probeMsgs.slice(-3);
        const menu = document.getElementById('invoice-v2-frame'); out.menuFrameHeight = menu ? menu.style.height : '(없음)'; out.menuFrameLoaded = menu ? (menu.dataset.loaded || '') : '';
        // 달력: 숨긴 상태에서 열기 → 날짜 지정은 S.shipDate 직접 넣고 saveLines
        const alt = i.S.calendar.shipDays.find(d => d !== i.S.shipDate); i.S.shipDate = alt; await i.saveLines(i.S); out.shipChanged = i.S.today === alt; out.kind18 = (i.S.merged.find(e => e.conv['수취인명'] === '받는18') || {}).reqKind;
        // 토요일(발송 없는 날)을 직접 넣으면?
        const sat = (() => { for (let k = 1; k < 9; k++) { const d = new Date(Date.now() + 9 * 3600e3 + k * 86400e3); if (d.getUTCDay() === 6) return d.toISOString().slice(0, 10); } })();
        i.S.shipDate = sat; await i.saveLines(i.S); out.satAccepted = i.S.today === sat; out.sat = sat;
        // dateGuard: 불러온 날이 오늘이 아니면 download() = null
        i.S.shipDate = i.S.calendar.suggested; await i.saveLines(i.S);
        const keep = i.S.fetchedOn; i.S.fetchedOn = '2000-01-01'; const o = w.XLSX.writeFile; w.XLSX.writeFile = () => { };
        let wb; try { wb = await i.download(); } finally { w.XLSX.writeFile = o; } out.guardNull = wb === null; out.guardMsg = w.document.getElementById('msg-dl').textContent.slice(0, 60); i.S.fetchedOn = keep;
        return out;
    });
    note('⑤ 높이 postMessage(ivt-height) 부모 수신', `${st5.msgs}회 · 마지막 값 ${JSON.stringify(st5.msgSample)}`);
    note('⑤ 송장변환 메뉴 iframe(#invoice-v2-frame) 높이 — 숨은 iframe 메시지에 반응했는가', `style.height = "${st5.menuFrameHeight}" · 메뉴 iframe 로드 여부 "${st5.menuFrameLoaded}"`);
    ok(st5.shipChanged, '⑤ 기준 발송일: S.shipDate 지정 + saveLines 로 변경됨(달력 UI 없이)', `받는18 판정 → ${st5.kind18}`);
    note('⑤ 토요일을 직접 넣으면 서버·v2가 막는가', `${st5.sat} → 받아들여짐 = ${st5.satAccepted}`);
    ok(st5.guardNull, '⑤ dateGuard: 불러온 날 ≠ 오늘이면 download() 가 null(안내는 iframe 안 #msg-dl 에만)', st5.guardMsg);
    note('⑤ confirm/alert 창', dialogs.length ? dialogs.join(' | ') : '0건');
    ok(errs.length === 0, '⑤ pageerror·console error 0(부모 + iframe)', errs.join(' | ').slice(0, 300));
    await ctx.close();
}

(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let br;
    try {
        let up = false; for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/public/version')).ok) { up = true; break; } } catch (_) { } await new Promise(r => setTimeout(r, 1000)); }
        if (!up) throw new Error('server not up');
        br = await chromium.launch();
        for (const mode of ['none', 'offscreen']) await runOne(br, 'PC1400', { width: 1400, height: 900 }, false, mode);
        for (const mode of ['none', 'offscreen']) await runOne(br, '폰390', { width: 390, height: 844 }, true, mode);
        // ④-b 파일을 다시 읽어서 덧붙이는 길(#496 함정) — node 에서 재읽기 → 재쓰기
        const f = path.join(OUT, 'PC1400-none-parent.xlsx');
        if (fs.existsSync(f)) {
            const wb = XLSX.readFile(f, { cellStyles: true }); XLSX.utils.sheet_add_aoa(wb.Sheets['Sheet1'], [['다시쓰기 드림', '', '', '재쓰기받는', '', 1, '', '', '', '', '']], { origin: -1 });
            const f2 = path.join(OUT, 'rewrite.xlsx'); XLSX.writeFile(wb, f2); const w2 = XLSX.readFile(f2, { cellStyles: true });
            console.log('\n── ④-b 저장된 파일을 다시 읽어 덧붙여 쓰기(xlsx-js-style) ──');
            note('머리글·표시 색 생존 여부', JSON.stringify({ 전_A1: fillOf(XLSX.readFile(f, { cellStyles: true }).Sheets.Sheet1.A1), 후_A1: fillOf(w2.Sheets.Sheet1.A1), 후_D1: fillOf(w2.Sheets.Sheet1.D1), 후_시트2_A2: fillOf(w2.Sheets['발주발송관리'].A2) }));
        }
    } finally { if (br) await br.close().catch(() => { }); srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}  · 저장 폴더 ${OUT}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
