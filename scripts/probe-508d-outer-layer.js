// #508 조사 D(워커1) — 버리는 시험: v2 판정 코드를 안 건드리고 「조종하는 쪽」에서 할 수 있는 범위
//   제품 코드 수정 0 · 로컬 3458(JWT_SECRET=verifytest · setInterval 무력화) · 가짜 행만 · DB는 조회 API(카탈로그·memo-parse)만
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn } = require('child_process');
const ROOT = 'C:/Users/전승범/OneDrive/문서/★제주아꼼이네 회사프로그램';
const req = m => require(path.join(ROOT, 'node_modules', m));
req('dotenv').config({ path: path.join(ROOT, '.env') });
const jwt = req('jsonwebtoken'); const XLSX = req('xlsx-js-style'); const { chromium } = req('playwright');
const PORT = 3458, BASE = `http://localhost:${PORT}`;
const USER = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' };
const TOKEN = jwt.sign(USER, 'verifytest', { expiresIn: '1h' });
const OUT = path.join(os.tmpdir(), 'probe508d'); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 320) : '')); };
const note = (t, d) => console.log('  ℹ️ ' + t + (d != null ? ' — ' + String(d).slice(0, 700) : ''));
const usd = iso => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(2, 4)}`;
const fillOf = c => c && c.s && ((c.s.fgColor && c.s.fgColor.rgb) || (c.s.fill && c.s.fill.fgColor && c.s.fill.fgColor.rgb)) || null;
const OPT = ['아꼼이네 상품선택: 1. 고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)', '아꼼이네 상품선택: 2. 과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)'];
const mk = (n, tel, memo) => ({ '구매자명': '구매' + n, '구매자연락처': tel, '수취인명': '받는' + String(n).padStart(2, '0'), '옵션정보': OPT[n % 2], '수량': 1, '수취인연락처1': tel, '수취인연락처2': '', '통합배송지': '서울특별시 시험구 시험로 ' + n, '배송메세지': memo, _pid: '20261004000' + String(n).padStart(3, '0'),
    _x: { productOrderId: '20261004000' + String(n).padStart(3, '0'), orderId: '2026100400' + String(n).padStart(3, '0'), paymentDate: '2026-10-04T09:00:00.000+09:00', orderDate: '2026-10-04T08:59:00.000+09:00', ordererId: 'tester' + n, productId: '1', productName: '시험', expectedSettlementAmount: 20000, shippingDueDate: '2026-10-09T23:59:59.000+09:00', inflowPath: '', deliveryMethod: 'DELIVERY', productOrderStatus: 'PAYED' } });
const tel = n => '010-7000-' + String(1000 + n);
const naverRows = () => Array.from({ length: 10 }, (_, i) => mk(i + 1, tel(i + 1), i === 6 ? '배송 전 연락주세요 21일 발송' : ''));

async function open(br, src, mode) {
    const ctx = await br.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [TOKEN, USER]);
    const pg = await ctx.newPage(); const errs = [], dialogs = [];
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) errs.push(m.text()); });
    pg.on('dialog', async d => { dialogs.push(d.message().slice(0, 50)); await d.dismiss(); });
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500);
    await pg.evaluate(() => switchPage('agent-office')); await pg.waitForTimeout(800);
    await pg.evaluate(([src, mode]) => {
        window.__probeMsgs = []; window.addEventListener('message', ev => { if (ev.data && ev.data.type === 'ivt-height') window.__probeMsgs.push(Math.round(ev.data.h)); });
        const f = document.createElement('iframe'); f.id = 'fo-frame'; f.src = src; f.style.cssText = mode === 'none' ? 'display:none;' : 'position:absolute; left:-9999px; top:0; width:1200px; height:800px; border:0;';
        document.getElementById('page-agent-office').appendChild(f);
    }, [src, mode]);
    await pg.waitForFunction(() => { const w = document.getElementById('fo-frame').contentWindow; return w && w.__ivt && w.__ivt.S.calendar; }, null, { timeout: 30000 });
    return { ctx, pg, errs, dialogs };
}
// iframe 저장을 가로채고 download() → 부모가 저장 → node 로 다시 읽기
async function grab(pg, name) {
    const dl = pg.waitForEvent('download', { timeout: 20000 });
    const info = await pg.evaluate(async name => {
        const w = document.getElementById('fo-frame').contentWindow; const o = w.XLSX.writeFile; w.XLSX.writeFile = () => { };
        let wb; try { wb = await w.__ivt.download(); } finally { w.XLSX.writeFile = o; }
        if (!wb) return { err: w.document.getElementById('msg-dl').textContent };
        const buf = window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf])); a.download = name; document.body.appendChild(a); a.click(); a.remove();
        return { ok: true, msg: w.document.getElementById('msg-dl').textContent.slice(0, 200) };
    }, name);
    if (info.err) { dl.catch(() => { }); return { info }; }
    const d = await dl; const f = path.join(OUT, name); await d.saveAs(f); const wb = XLSX.readFile(f, { cellStyles: true });
    const s1 = wb.Sheets.Sheet1; const a1 = XLSX.utils.sheet_to_json(s1, { header: 1, defval: '' });
    const s2 = wb.Sheets['발주발송관리']; const a2 = s2 ? XLSX.utils.sheet_to_json(s2, { header: 1, defval: '' }) : [];
    return { info, wb, s1, a1, s2, a2, row: nm => a1.findIndex(r => r[3] === nm) + 1 };
}

(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let br;
    try {
        let up = false; for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/public/version')).ok) { up = true; break; } } catch (_) { } await new Promise(r => setTimeout(r, 1000)); }
        if (!up) throw new Error('server not up');
        br = await chromium.launch();

        // ───────── 1·2: 보내는이 직접 넣기 / 필드 직접 바꾸기 vs 정리 줄 ─────────
        console.log('\n── 1·2 보내는이 주입 · 직접 변경 vs 정리 줄 (display:none · embed=1) ──');
        let { ctx, pg, errs } = await open(br, '/invoice-v2.html?embed=1', 'none');
        const r1 = await pg.evaluate(async rows => {
            const w = document.getElementById('fo-frame').contentWindow, i = w.__ivt; await i.setNaverApiRows(rows);
            const by = n => i.S.merged.find(e => e.conv['수취인명'] === '받는' + n);
            by('01').sender = { name: '김직원', phone: '010-1234-5678', ambiguous: false };       // 보내는이 주입(번호 포함)
            by('02').sender = { name: '(주)시험상사', ambiguous: false };                         // 번호 없음
            by('03').excluded = true; by('03').userTouched = true;                                // 직접 제외(+userTouched)
            by('04').excluded = true;                                                             // 직접 제외(userTouched 없이)
            by('05').individual = true;                                                           // 직접 개별발송
            by('06').reqKind = 'today'; by('06').reqToday = true;                                 // 직접 「그날 발송」
            return { ship: i.S.shipDate, days: i.S.calendar.shipDays };
        }, naverRows());
        const g1 = await grab(pg, 'd1.xlsx');
        const names1 = g1.a1.slice(1).map(r => r[3]);
        const rA = g1.row('받는01'), rB = g1.row('받는02');
        ok(String(g1.s1['A' + rA].v) === '김직원 드림' && String(g1.s1['B' + rA].v) === '010-1234-5678' && fillOf(g1.s1['A' + rA]) === 'DDEBF7' && fillOf(g1.s1['B' + rA]) === 'DDEBF7', '1 바깥에서 e.sender 주입 → 시트1 A 「이름 드림」 · B 번호 · 연파랑', JSON.stringify({ A: g1.s1['A' + rA].v, B: g1.s1['B' + rA].v, fA: fillOf(g1.s1['A' + rA]), fB: fillOf(g1.s1['B' + rA]), fJ: fillOf(g1.s1['J' + rA]) }));
        ok(String(g1.s1['A' + rB].v) === '(주)시험상사 드림' && String(g1.s1['B' + rB].v) === tel(2) && fillOf(g1.s1['B' + rB]) !== 'DDEBF7', '1 번호 없이 주입 → A만 바뀌고 B는 구매자 번호 그대로·무색', JSON.stringify({ A: g1.s1['A' + rB].v, B: g1.s1['B' + rB].v }));
        note('1 메모가 빈 행은 J(배송메세지)에 연파랑이 안 들어감(markSheet1 hasMemo 조건)', `J 색 = ${fillOf(g1.s1['J' + rA])}`);
        ok(!names1.includes('받는03'), '2 직접 excluded=true + userTouched=true → download 뒤에도 제외 유지');
        ok(names1.includes('받는04'), '2 직접 excluded=true 만(userTouched 없음) → download 안 applyLines 가 되돌림(시트1에 다시 들어감)');
        ok(names1.includes('받는05') && !g1.a2.slice(-1)[0].includes('받는05') || fillOf(g1.s2['A' + (g1.a2.length)]) !== 'FFF2CC', '2 직접 individual=true → download 안 applyLines 가 지움(개별발송 안 됨 · 시트1에 남음)', `시트1 포함 = ${names1.includes('받는05')}`);
        const after = await pg.evaluate(() => { const i = document.getElementById('fo-frame').contentWindow.__ivt; const by = n => i.S.merged.find(e => e.conv['수취인명'] === '받는' + n); return { s01: by('01').sender, k06: by('06').reqKind, i05: by('05').individual, x04: by('04').excluded }; });
        ok(after.k06 === null && after.i05 === false, '2 직접 넣은 reqKind·individual 은 applyLines 가 매번 초기화', JSON.stringify(after));
        // 주입한 보내는이가 지워지는 시점
        const wipe = await pg.evaluate(async () => {
            const w = document.getElementById('fo-frame').contentWindow, i = w.__ivt; const by = n => i.S.merged.find(e => e.conv['수취인명'] === '받는' + n); const out = {};
            out.afterDownload = !!(by('01').sender && by('01').sender.name === '김직원');
            await i.saveLines(i.S); out.afterSaveLines = by('01').sender;
            by('01').sender = { name: '김직원', ambiguous: false }; by('03').excluded = true; by('03').userTouched = true;
            const alt = i.S.calendar.shipDays.find(d => d !== i.S.shipDate); const keep = i.S.shipDate; i.S.shipDate = alt; await i.saveLines(i.S); out.afterShipChange = by('01').sender; out.x03AfterRefresh = by('03').excluded; i.S.shipDate = keep; await i.saveLines(i.S);
            return out;
        });
        ok(wipe.afterDownload && wipe.afterSaveLines === null && wipe.afterShipChange === null, '1 주입한 sender: download 뒤엔 남고, saveLines·기준일 변경(=rebuild) 때 지워짐', JSON.stringify(wipe));
        ok(wipe.x03AfterRefresh === true, '2 직접 제외(+userTouched)는 saveLines·기준일 변경 뒤에도 유지(정리 줄이 안 잡은 주문일 때)');
        // 정리 줄로 넣는 길
        const lines = [`${usd(r1.ship)}\t${tel(5)}\t입력o삭제x\t네이버`, `${usd(r1.days.find(d => d > r1.ship))}\t${tel(8)}\t\t네이버`, `${usd(r1.ship)}\t${tel(7)}\t메모무시\t네이버`].join('\n');
        await pg.evaluate(async lines => { const w = document.getElementById('fo-frame').contentWindow; w.document.getElementById('ln-all').value = lines; await w.__ivt.saveLines(w.__ivt.S); const by = n => w.__ivt.S.merged.find(e => e.conv['수취인명'] === '받는' + n); by('01').sender = { name: '김직원', ambiguous: false }; }, lines);
        const g2 = await grab(pg, 'd2.xlsx'); const names2 = g2.a1.slice(1).map(r => r[3]);
        const last2 = g2.a2[g2.a2.length - 1];
        ok(!names2.includes('받는05') && last2[6] === '받는05' && fillOf(g2.s2['A' + g2.a2.length]) === 'FFF2CC' && !names2.includes('받는08') && names2.includes('받는07') && String(g2.s1['J' + g2.row('받는07')].v || '') === '', '2 정리 줄로 넣으면: 개별발송(시트2 노란 맨 아래)·뒤 날짜 제외·메모무시(메모 비움) 모두 download 뒤에도 유지', `시트1 ${names2.length}행 · 시트2 끝 ${last2[6]}`);
        ok(String(g2.s1['A' + g2.row('받는01')].v) === '김직원 드림', '1 saveLines 뒤에 다시 주입하면 download 에 반영(주입은 항상 마지막에)');
        ok(errs.length === 0, '1·2 오류 0', errs.join(' | '));
        await ctx.close();

        // ───────── 3: 숨은 iframe에서 불러오기 버튼(응답 가짜) + 쿠팡 취소 재확인 ─────────
        console.log('\n── 3 숨은 iframe 불러오기 버튼(가짜 응답) ──');
        ({ ctx, pg, errs } = await open(br, '/invoice-v2.html?embed=1', 'none'));
        const hits = { naver: [], cafe24: [], coupang: [], cancel: [] };
        const c24 = [1, 2].map(n => ({ '주문자명': '자사' + n, '주문상품명(세트상품 포함)': '제주 감귤 상품 선택=1. (제철)고당도 하우스감귤 · 가정용 - 2.5kg(로얄과)', '배송메시지': '', '수령인': '자사받는' + n, '주문자 휴대전화': '010-8000-000' + n, '수량': 1, '수령인 휴대전화': '010-8000-000' + n, '수령인 주소(전체)': '부산 시험로 ' + n, _orderId: '20261004-000000' + n }));
        const cp = [1, 2, 3].map(n => ({ '구매자': '쿠팡' + n, '등록상품명': '제주아꼼이네 황금향', '노출상품명(옵션명)': '황금향 가정용 3kg', '배송메세지': '', '수취인이름': '쿠팡받는' + n, '구매자전화번호': '0505-000-000' + n, '구매수(수량)': 1, '수취인전화번호': '0505-000-000' + n, '수취인 주소': '대구 시험로 ' + n, _orderId: 'CP' + n }));
        await pg.route('**/api/agent-office/naver/invoice-orders-v2*', r => { hits.naver.push(r.request().url().split('?')[1]); r.fulfill({ json: { ok: true, count: 10, rows: naverRows(), partial_adjusted: 0 } }); });
        await pg.route('**/api/agent-office/cafe24/invoice-orders*', r => { hits.cafe24.push(r.request().url().split('?')[1]); r.fulfill({ json: { ok: true, count: 2, rows: c24 } }); });
        await pg.route('**/api/agent-office/coupang/invoice-orders*', r => { hits.coupang.push(r.request().url().split('?')[1]); r.fulfill({ json: { ok: true, count: 3, rows: cp } }); });
        await pg.route('**/api/agent-office/coupang/canceled-since*', r => { hits.cancel.push(1); r.fulfill({ json: { ok: true, canceled: ['CP2'] } }); });
        const t0 = Date.now();
        await pg.evaluate(() => { const d = document.getElementById('fo-frame').contentDocument; d.getElementById('days-naver').value = '7'; d.getElementById('btn-naver').click(); d.getElementById('btn-cafe24').click(); d.getElementById('btn-coupang').click(); });
        let loaded = true; try { await pg.waitForFunction(() => { const w = document.getElementById('fo-frame').contentWindow, i = w.__ivt, d = w.document; return i.S.naver && i.S.cafe24.length && i.S.coupang.length && i.S.merged.length === 15 && !d.getElementById('btn-naver').disabled && !d.getElementById('btn-cafe24').disabled && !d.getElementById('btn-coupang').disabled; }, null, { timeout: 30000 }); } catch (_) { loaded = false; }
        const st3 = await pg.evaluate(() => { const w = document.getElementById('fo-frame').contentWindow, i = w.__ivt, d = w.document; return { merged: i.S.merged.length, by: ['naver', 'cafe24', 'coupang'].map(c => i.S.merged.filter(e => e.ch === c).length), cpAt: !!i.S.coupangLoadedAt, msgs: ['naver', 'cafe24', 'coupang'].map(c => d.getElementById('msg-' + c).textContent.slice(0, 40)), dlDisabled: d.getElementById('btn-download').disabled, unmatched: i.S.merged.filter(e => String(e.conv['옵션정보']).startsWith('[미매칭]')).map(e => e.ch) }; });
        ok(loaded && st3.merged === 15 && st3.by.join() === '10,2,3' && st3.cpAt, '3 display:none iframe에서 버튼 3개 .click() → 3채널 15건 로드 · coupangLoadedAt 찍힘', JSON.stringify({ ...st3, ms: Date.now() - t0 }));
        ok(hits.naver[0] === 'days=7' && /days=50/.test(hits.cafe24[0]) && /days=31/.test(hits.coupang[0]), '3 조회 기간 = #days-naver/#days-cafe24/#days-coupang 입력값이 그대로 쿼리로', JSON.stringify(hits));
        note('3 같은 순간 버튼 3개를 누르면 refreshC 가 겹쳐 돈다(마지막 것이 끝난 뒤 상태로 판정해야 함)', `미매칭 채널 ${JSON.stringify(st3.unmatched)}`);
        const g3 = await grab(pg, 'd3.xlsx'); const names3 = g3.a1.slice(1).map(r => r[3]);
        ok(hits.cancel.length === 1 && !names3.includes('쿠팡받는2') && names3.includes('쿠팡받는1') && !names3.includes('받는07') && names3.length === 13, '3 download() 안 쿠팡 취소 재확인이 숨은 상태에서도 돈다(15 − 쿠팡 취소 1 − 손님 메모 뒤 날짜 1 = 13행)', g3.info.msg);
        ok(g3.a2.length - 2 === 9 && g3.a2.slice(2).every(r => /^받는/.test(r[6])), '3 시트2 = 네이버만 9건(10 − 메모 제외 1 · 자사몰·쿠팡 없음)');
        // 실패 응답
        await pg.unroute('**/api/agent-office/cafe24/invoice-orders*'); await pg.route('**/api/agent-office/cafe24/invoice-orders*', r => r.fulfill({ json: { ok: false, message: '카페24 재승인 필요(시험)' } }));
        await pg.evaluate(() => document.getElementById('fo-frame').contentDocument.getElementById('btn-cafe24').click()); await pg.waitForTimeout(800);
        const f3 = await pg.evaluate(() => { const w = document.getElementById('fo-frame').contentWindow; return { msg: w.document.getElementById('msg-cafe24').textContent, still: w.__ivt.S.cafe24.length }; });
        ok(/^⚠️/.test(f3.msg) && f3.still === 2, '3 실패 응답: #msg-cafe24 가 「⚠️ …」로 시작 · 앞서 불러온 자사몰 행은 그대로 남음(실패가 상태를 안 지움)', JSON.stringify(f3));
        ok(errs.length === 0, '3 오류 0', errs.join(' | '));
        await ctx.close();

        // ───────── 4: ?embed=1 없이 ─────────
        console.log('\n── 4 ?embed=1 없이 숨은 iframe ──');
        for (const mode of ['none', 'offscreen']) {
            ({ ctx, pg, errs } = await open(br, '/invoice-v2.html', mode));
            await pg.evaluate(async rows => { const w = document.getElementById('fo-frame').contentWindow; await w.__ivt.setNaverApiRows(rows); }, naverRows());
            await pg.waitForTimeout(3500);
            const st4 = await pg.evaluate(() => { const w = document.getElementById('fo-frame').contentWindow, d = w.document; const m = document.getElementById('invoice-v2-frame'); return { msgs: window.__probeMsgs.length, menuH: m.style.height || '(없음)', embed: d.body.classList.contains('embed'), gate: getComputedStyle(d.getElementById('login-gate')).display, n: w.__ivt.S.merged.length, excl: w.__ivt.S.merged.filter(e => e.excluded).length, review: w.__ivt.S.merged.filter(e => e.flag === 'review').length }; });
            const g4 = await grab(pg, `d4-${mode}.xlsx`);
            ok(st4.msgs === 0 && st4.menuH === '(없음)' && !st4.embed, `4 (${mode}) 높이 메시지 0회 · 송장변환 메뉴 iframe 높이 무변경`, JSON.stringify(st4));
            ok(g4.wb && g4.wb.SheetNames.join() === 'Sheet1,발주발송관리' && g4.a1.length - 1 === st4.n - st4.excl && fillOf(g4.s1.A1) === '92D050', `4 (${mode}) 판정·다운로드 정상(시트 2장 · 머리글 색)`, `시트1 ${g4.a1.length - 1}행 · 제외 ${st4.excl} · 확인필요 ${st4.review}`);
            ok(errs.length === 0, `4 (${mode}) 오류 0`, errs.join(' | '));
            await ctx.close();
        }
    } finally { if (br) await br.close().catch(() => { }); }

    // ───────── 5·6: 거래처 판정 · 수량 표 색 (실코드 추출 · node) ─────────
    try {
        console.log('\n── 5 거래처 판정(오늘 단가표 전 품목) ──');
        const cat = await (await fetch(BASE + '/api/invoice/catalog', { headers: { Authorization: 'Bearer ' + TOKEN } })).json();
        const src = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
        const a = src.indexOf('function detectSize(msg)'), b = src.indexOf('// 채널 초기화'), c = src.indexOf('function qtyCategory'), d = src.indexOf('function arrayBufferToBase64');
        const doc = { getElementById: () => ({ value: '출고지', style: {}, innerHTML: '' }) };
        const P = new Function('api', 'aoEsc', 'XLSX', 'document', src.slice(a, b) + '\n' + src.slice(c, d) + '\nreturn { convertDataSmart, aoLoadInvoicePricing, aoItemPartner, matchProduct, qtyCategory };')(async () => cat, s => String(s), XLSX, doc);
        await P.aoLoadInvoicePricing();
        const partners = Object.keys(cat.byPartner); const all = []; partners.forEach(p => cat.byPartner[p].forEach(n => all.push({ p, n })));
        const dup = all.filter(x => all.some(y => y.n === x.n && y.p !== x.p)).map(x => x.n);
        note('오늘 단가표', partners.map(p => `${p} ${cat.byPartner[p].length}종`).join(' · ') + ` · 두 거래처에 같은 이름 ${new Set(dup).size}종`);
        const strip = nm => String(nm).replace(/\s+(2S|S|M)사이즈로!$/, '');
        const partnerOf = nm => { const base = strip(nm); return partners.find(p => cat.byPartner[p].includes(base)) || null; };
        let plainOk = 0, sizeRows = 0, sizeNowNull = 0, sizeStripOk = 0, wrong = [];
        for (const { p, n } of all) {
            for (const memo of ['', 's사이즈로 보내주세요', '작은 걸로 부탁드려요', 'M 사이즈']) {
                const conv = P.convertDataSmart([{ '구매자명': '시험', '옵션정보': n, '배송메세지': memo, '수량': 1 }])[0]; const opt = conv['옵션정보'];
                const now = P.aoItemPartner(opt), mine = partnerOf(opt); const suffixed = /사이즈로!$/.test(opt);
                if (!suffixed) { if (now === p && mine === p) plainOk++; else if (memo === '') wrong.push(`${n} → ${opt} (${now}/${mine})`); }
                else { sizeRows++; if (now === null) sizeNowNull++; if (mine === p) sizeStripOk++; else wrong.push(`[꼬리] ${opt} → ${mine} (기대 ${p})`); }
            }
        }
        ok(wrong.length === 0, '5 단가표 전 품목: 표준 이름 그대로 = 지금 코드·꼬리 떼기 둘 다 정답 / 꼬리 붙은 이름 = 꼬리 떼고 찾으면 전부 정답', `일치 ${plainOk} · 꼬리 행 ${sizeRows}건 중 지금 코드 null ${sizeNowNull} · 꼬리 떼기 정답 ${sizeStripOk}${wrong.length ? ' · 틀림 ' + wrong.slice(0, 3).join(' / ') : ''}`);
        const um = P.convertDataSmart([{ '구매자명': '시험', '옵션정보': '개인결제창 하우스귤=선물용 3kg 21박스', '배송메세지': '', '수량': 1 }])[0]['옵션정보'];
        ok(um.startsWith('[미매칭]') && P.aoItemPartner(um) === null && partnerOf(um) === null, '5 [미매칭]·단가표에 없는 이름 = 거래처 없음(null) → 따로 모을 칸이 필요', um.slice(0, 60));
        // 현금파일 행: 표준 이름 / 줄인 이름(「 / 」 뒤만 · 「상품 및 과수: 」 뒤만)
        let std = 0, tail1 = 0, tail1Wrong = [], tail2 = 0, tail2Wrong = [];
        for (const { p, n } of all) {
            if (partnerOf(n) === p) std++;
            const t1 = n.includes(' / ') ? n.split(' / ').slice(1).join(' / ') : null, t2 = n.includes(': ') ? n.split(': ').slice(1).join(': ') : null;
            for (const [t, bag, cnt] of [[t1, tail1Wrong, 1], [t2, tail2Wrong, 2]]) { if (!t) continue; const m = P.matchProduct(t); const pp = partnerOf(m); if (pp === p && m === n) { cnt === 1 ? tail1++ : tail2++; } else bag.push(`${t} → ${String(m).slice(0, 40)}`); }
        }
        note('5 현금파일 행을 같은 함수로 나눌 수 있나', `표준 이름 그대로 = ${std}/${all.length} 정답 · 「상품 및 과수: …」꼴(앞 상품명 뗌) → matchProduct 로 되찾음 ${tail1}건 · 실패 ${tail1Wrong.length}건 · 「가정용 - 3kg(로얄과)」꼴(옵션만) → 되찾음 ${tail2}건 · 실패 ${tail2Wrong.length}건`);
        if (tail2Wrong.length) note('  옵션만 적힌 이름 실패 예', tail2Wrong.slice(0, 6).join(' | '));
        if (tail1Wrong.length) note('  「상품 및 과수」꼴 실패 예', tail1Wrong.slice(0, 4).join(' | '));

        console.log('\n── 6 수량 표 색(qtyCategory 실코드 · 오늘 단가표) ──');
        const RGB = { yellow: 'FFFF00', orange: 'F4B183', blue: 'BDD7EE', green: 'C6E0B4', pink: 'F4CCCC', none: 'FFFFFF' };
        for (const p of partners) { console.log(`  [${p}]`); [...cat.byPartner[p]].sort((x, y) => x.localeCompare(y, 'ko')).forEach(n => { const k = P.qtyCategory(n); console.log(`     ${k.padEnd(6)} ${RGB[k]}  ${n}`); }); }
        console.log(`     ${P.qtyCategory('아무 품목 S사이즈로!')} ${RGB[P.qtyCategory('아무 품목 S사이즈로!')]}  (… S사이즈로! 꼬리 행)`);
    } finally { srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_) { }
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
