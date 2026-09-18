// #452 검증: 송장변환 테스트 v2(/invoice-test.html) — 로컬 실서버 + Playwright 실클릭 + 실다운로드 파일 파싱
//   ① 파일 업로드(오늘 네이버 원본 97건) → 미리보기·자동 체크·확인필요 = 서버 memo-parse 규칙과 일치
//   ② 개별발송 번호 2명 → 회색 분류 · 체크 토글 반영
//   ③ 다운로드: 시트1 행수 = 전체 − 개별 − 제외 · 시트2 = 안내 1행 + 27열 헤더 + 시트1과 같은 순서 + 개별발송 노란 행 맨 아래
//   ④ 🔴 무회귀: 개별 0·제외 0일 때 시트1 = 본 화면 실코드(node 실행 참조본)와 셀 값·스타일 전부 동일
//   ⑤ API 원본(_x) 경로: 가짜 2행 → 시트2 값·날짜 서식·₩ 서식·발송대기·ID 마스킹
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn } = require('child_process');
const jwt = require('jsonwebtoken'); const XLSX = require('xlsx-js-style');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 240) : '')); };
const PORT = 3457, BASE = `http://localhost:${PORT}`;
const XLS = 'C:/Users/전승범/Downloads/스마트스토어_전체주문발주발송관리_20260918_0926.xlsx';
const TOKEN = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
async function waitUp() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/public/version`); if (r.ok) return; } catch (_) { } await new Promise(r => setTimeout(r, 1000)); } throw new Error('server not up'); }
const apiJ = async (url, method = 'GET', body) => (await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: body ? JSON.stringify(body) : undefined })).json();
(async () => {
    if (!fs.existsSync(XLS)) { console.log('원본 파일 없음 — 중단'); process.exit(1); }
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
        { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        await waitUp();
        // 원본 파일 → 행 객체(페이지와 같은 방식)
        const wb0 = XLSX.readFile(XLS, { cellStyles: true }); const ws0 = wb0.Sheets[wb0.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws0, { header: 1, raw: true }); const hdrIdx = aoa.findIndex(r => Array.isArray(r) && r.includes('상품주문번호'));
        const H = aoa[hdrIdx]; const rows = aoa.slice(hdrIdx + 1).filter(r => Array.isArray(r) && r.some(v => v != null && v !== '')).map(r => { const o = {}; H.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; }); return o; });
        const N = rows.length; console.log('원본 주문', N, '건');
        // 참조본: 본 화면 실코드(app.js 슬라이스)를 node에서 실행 → 시트1 워크북 캡처
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
        const a = src.indexOf('function detectSize(msg)'), b = src.indexOf('// 채널 초기화');
        const catalog = await apiJ('/api/invoice/catalog');
        const docStub = { getElementById: id => ({ value: id === 'invoice-sender-address' ? '제주특별자치도 제주시 연삼로 1066-31, 제주아꼼이네' : '', innerHTML: '', style: {}, textContent: '' }) };
        const apiStub = async () => catalog;
        const aoEsc = s => String(s == null ? '' : s);
        let refWb = null; const X2 = Object.assign({}, XLSX, { writeFile: (wb) => { refWb = wb; }, utils: XLSX.utils });
        const P = new Function('api', 'aoEsc', 'XLSX', 'document', src.slice(a, b) + '\nreturn { convertDataSmart, exportInvoiceExcel, aoLoadInvoicePricing };')(apiStub, aoEsc, X2, docStub);
        await P.aoLoadInvoicePricing();
        const conv = P.convertDataSmart(rows).map((c, i) => ({ c, i })).sort((x, y) => (x.c['옵션정보'] || '').localeCompare(y.c['옵션정보'] || '', 'ko'));
        P.exportInvoiceExcel(conv.map(x => x.c));
        ok(refWb && refWb.SheetNames[0] === 'Sheet1', '참조본(본 화면 실코드) 시트1 생성', refWb && refWb.SheetNames);
        // 서버 memo-parse 기대값
        const memos = conv.map(x => String(x.c['배송메세지'] || ''));
        const mp = await apiJ('/api/agent-office/invoice/memo-parse', 'POST', { memos });
        ok(mp.ok && Array.isArray(mp.results) && mp.results.length === N, 'memo-parse API 응답', mp.today);
        const expExcl = mp.results.filter(p => p && (p.kind === 'ship' || p.kind === 'arrive') && p.reqDate && p.reqDate > mp.today).length;
        const expAck = mp.results.filter(p => p && p.kind === 'ack').length;
        console.log(`  기대: 자동 체크 ${expExcl}건 · 애매(ack) ${expAck}건 · 기준일 ${mp.today}`);
        // 개별발송 대상: 주문 2건 이상인 구매자 2명
        const byTel = {}; rows.forEach(r => { const t = String(r['구매자연락처'] || '').replace(/\D/g, ''); if (t) (byTel[t] = byTel[t] || []).push(r); });
        const multi = Object.entries(byTel).filter(([, v]) => v.length >= 2).slice(0, 2);
        const indivTels = multi.map(([t]) => t), expIndiv = multi.reduce((s, [, v]) => s + v.length, 0);
        console.log(`  개별발송 테스트 번호 ${indivTels.length}개 → 기대 ${expIndiv}건`);

        const { chromium } = require('playwright');
        const br = await chromium.launch(); const ctx = await br.newContext({ acceptDownloads: true });
        await ctx.addInitScript(t => { localStorage.setItem('jwt_token', t); }, TOKEN);
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
        await pg.goto(`${BASE}/invoice-test.html`, { waitUntil: 'load' });
        await pg.waitForFunction(() => window.__ivt, null, { timeout: 20000 });
        await pg.setInputFiles('#file', XLS);
        await pg.waitForFunction(n => document.querySelectorAll('#preview tbody tr').length === n, N, { timeout: 30000 });
        ok(true, '① 파일 업로드 → 미리보기 행수 = 원본', N);
        const st1 = await pg.evaluate(() => ({ excl: __ivt.S.merged.filter(e => e.excluded).length, review: __ivt.S.merged.filter(e => e.flag === 'review').length, today: __ivt.S.today }));
        ok(st1.excl === expExcl, '① 자동 체크(오늘 발송 아님) = memo-parse 규칙', `${st1.excl} / 기대 ${expExcl}`);
        ok(st1.review >= expAck, '① 확인필요 ≥ 애매(ack) 건수', `${st1.review} / ack ${expAck}`);
        const reviewRows = await pg.locator('#review tbody tr').count();
        ok(reviewRows === (await pg.evaluate(() => __ivt.S.merged.filter(e => !e.individual && (e.excluded || e.flag)).length)), '① 검토 목록 = 체크됨 + 확인필요', reviewRows);
        const ackUnchecked = await pg.evaluate(() => __ivt.S.merged.filter(e => e.flag === 'review').every(e => !e.excluded));
        ok(ackUnchecked, '① 확인필요 건은 체크 안 됨(직원이 결정)');
        // ② 개별발송 번호
        await pg.fill('#ex-naver', indivTels.join('\n'));
        await pg.waitForTimeout(300);
        const indivCnt = await pg.evaluate(() => __ivt.S.merged.filter(e => e.individual).length);
        ok(indivCnt === expIndiv, '② 개별발송 번호 → 회색 분류 건수', `${indivCnt} / 기대 ${expIndiv}`);
        ok((await pg.locator('#preview tr.indiv').count()) === expIndiv && (await pg.locator('#preview tr.indiv input[type=checkbox]').count()) === 0, '② 개별발송 행 = 회색·체크박스 없음');
        // ② 체크 토글: 검토 목록 첫 체크된 행 해제 → 체크 수 −1 · 확인필요 행 하나 체크 → +1
        const before = await pg.evaluate(() => __ivt.S.merged.filter(e => !e.individual && e.excluded).length);
        const firstChecked = pg.locator('#review input[type=checkbox]:checked').first();
        if (await firstChecked.count()) { await firstChecked.click(); }
        const after1 = await pg.evaluate(() => __ivt.S.merged.filter(e => !e.individual && e.excluded).length);
        ok(after1 === before - 1, '② 체크 해제 → 제외 −1', `${before} → ${after1}`);
        const firstReview = pg.locator('#review input[type=checkbox]:not(:checked)').first();
        let after2 = after1; if (await firstReview.count()) { await firstReview.click(); after2 = await pg.evaluate(() => __ivt.S.merged.filter(e => !e.individual && e.excluded).length); }
        ok(after2 === after1 + ((await pg.locator('#review input[type=checkbox]').count()) > 0 ? 1 : 0), '② 확인필요 행 체크 → 제외 +1', `${after1} → ${after2}`);
        const exclNow = after2;
        // ③ 다운로드
        const dl1 = pg.waitForEvent('download'); await pg.click('#btn-download'); const d1 = await dl1;
        const f1 = path.join(os.tmpdir(), 'ivt1.xlsx'); await d1.saveAs(f1);
        const w1 = XLSX.readFile(f1, { cellStyles: true });
        ok(w1.SheetNames.length === 2 && w1.SheetNames[0] === 'Sheet1' && w1.SheetNames[1] === '발주발송관리', '③ 시트 2개(Sheet1·발주발송관리)', w1.SheetNames.join(','));
        const s1 = w1.Sheets.Sheet1, s2 = w1.Sheets['발주발송관리'];
        const s1rows = XLSX.utils.sheet_to_json(s1, { header: 1 }).length - 1;
        ok(s1rows === N - expIndiv - exclNow, '③ 시트1 행수 = 전체 − 개별 − 제외', `${s1rows} = ${N} − ${expIndiv} − ${exclNow}`);
        const a2 = XLSX.utils.sheet_to_json(s2, { header: 1, raw: true });
        ok(String(s2.A1 && s2.A1.v) === String(ws0.A1.v) && String(s2.D1 && s2.D1.v) === String(ws0.D1.v), '③ 시트2 1행 안내문 = 원본과 동일');
        ok(JSON.stringify(a2[1]) === JSON.stringify(aoa[hdrIdx]), '③ 시트2 2행 헤더 27열 = 원본과 동일');
        ok(a2.length - 2 === s1rows + expIndiv, '③ 시트2 행수 = 시트1 + 개별발송', a2.length - 2);
        // 순서: 시트1 k행 수취인연락처1(G) == 시트2 k행 수취인연락처1(J)
        let orderOk = true; for (let k = 0; k < s1rows; k++) { const t1 = String((s1['G' + (k + 2)] || {}).v || '').replace(/\D/g, ''); const t2 = String((s2['J' + (k + 3)] || {}).v || '').replace(/\D/g, ''); if (t1 !== t2) { orderOk = false; console.log('   순서 불일치 행', k + 1, t1, t2); break; } }
        ok(orderOk, '③ 시트1·시트2 행 순서 동일(수취인연락처 1:1)');
        const lastRows = []; for (let k = 0; k < expIndiv; k++) { const r = a2.length - expIndiv + k + 1; lastRows.push(s2['A' + r]); }
        const fillOf = c => c && c.s && ((c.s.fgColor && c.s.fgColor.rgb) || (c.s.fill && c.s.fill.fgColor && c.s.fill.fgColor.rgb)) || null;   // 읽기 시 patternType/fgColor가 최상위로 온다
        ok(lastRows.every(c => fillOf(c) === 'FFF2CC'), '③ 개별발송 행 = 맨 아래 노란 배경', lastRows.map(fillOf).join(','));
        const firstDataFill = fillOf(s2.A3);
        ok(firstDataFill !== 'FFF2CC', '③ 일반 행은 노란 배경 아님');
        const indivTelsIn = lastRows.length ? new Set(indivTels) : null;
        const yellowTels = []; for (let k = 0; k < expIndiv; k++) { const r = a2.length - expIndiv + k + 1; yellowTels.push(String((s2['N' + r] || {}).v || '').replace(/\D/g, '')); }
        ok(yellowTels.every(t => indivTelsIn.has(t)), '③ 노란 행의 구매자연락처 = 입력한 개별발송 번호');
        ok((s2.R3 && s2.R3.z === 'yyyy/mm/dd\\ hh:mm') && (s2.U3 && /₩/.test(s2.U3.z || '')), '③ 시트2 날짜·금액 셀 서식 유지(결제일·정산예정금액)', `${s2.R3 && s2.R3.z} / ${s2.U3 && s2.U3.z}`);
        // ④ 무회귀: 개별 0·제외 0 → 시트1 = 참조본
        await pg.fill('#ex-naver', '');
        await pg.evaluate(() => { __ivt.S.merged.forEach(e => { e.excluded = false; e.userTouched = true; }); __ivt.render(); });
        const dl2 = pg.waitForEvent('download'); await pg.click('#btn-download'); const d2 = await dl2;
        const f2 = path.join(os.tmpdir(), 'ivt2.xlsx'); await d2.saveAs(f2);
        const w2 = XLSX.readFile(f2, { cellStyles: true }); const t1 = w2.Sheets.Sheet1;
        // 참조본을 파일로 써서 같은 파서로 읽어 비교(스타일 포함)
        const fr = path.join(os.tmpdir(), 'ivt-ref.xlsx'); XLSX.writeFile(refWb, fr); const wr = XLSX.readFile(fr, { cellStyles: true }); const tr = wr.Sheets.Sheet1;
        const keys = Object.keys(tr).filter(k => /^[A-Z]+\d+$/.test(k));
        const strip = c => c ? JSON.stringify({ v: c.v, t: c.t, s: c.s }) : null;
        const diffs = keys.filter(k => strip(tr[k]) !== strip(t1[k]));
        ok(tr['!ref'] === t1['!ref'] && diffs.length === 0, '④ 🔴 무회귀: 제외 0일 때 시트1 = 본 화면 실코드 결과(셀 값·스타일 전부 동일)', `${keys.length}셀 비교 · 차이 ${diffs.length}${diffs.length ? ' 예: ' + diffs.slice(0, 3).join(',') : ''}`);
        ok(XLSX.utils.sheet_to_json(w2.Sheets['발주발송관리'], { header: 1 }).length - 2 === N, '④ 제외 0일 때 시트2 = 전체 행');
        // ⑤ API 원본 경로(_x) — 가짜 2행
        const fake = [
            { '구매자명': '테스트A', '구매자연락처': '010-1111-2222', '수취인명': '받는A', '옵션정보': '아꼼이네 상품선택: 1. 고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)', '수량': 1, '수취인연락처1': '010-1111-2222', '수취인연락처2': '', '통합배송지': '제주시 테스트로 1', '배송메세지': '21일 발송 부탁드려요', _pid: '20260918000001', _x: { productOrderId: '20260918000001', orderId: '2026091800000', paymentDate: '2026-09-18T09:00:00.000+09:00', orderDate: '2026-09-18T08:59:00.000+09:00', ordererId: 'abcd1234', productId: '6400134206', productName: '제주 노지 감귤 타이벡 하우스', expectedSettlementAmount: 27000, shippingDueDate: '2026-09-23T23:59:59.000+09:00', inflowPath: '네이버쇼핑', deliveryMethod: 'DELIVERY', productOrderStatus: 'PAYED' } },
            { '구매자명': '테스트B', '구매자연락처': '010-3333-4444', '수취인명': '받는B', '옵션정보': '아꼼이네 상품선택: 2. 과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)', '수량': 2, '수취인연락처1': '010-3333-4444', '수취인연락처2': '', '통합배송지': '서울시 테스트로 2', '배송메세지': '문앞', _pid: '20260918000002', _x: { productOrderId: '20260918000002', orderId: '2026091800001', paymentDate: '2026-09-18T10:00:00.000+09:00', orderDate: '2026-09-18T10:00:00.000+09:00', ordererId: 'xy', productId: '11126666859', productName: '제주 황금향', expectedSettlementAmount: 40000, shippingDueDate: '2026-09-23T23:59:59.000+09:00', inflowPath: '', deliveryMethod: 'DELIVERY', productOrderStatus: 'PAYED' } },
        ];
        await pg.evaluate(rows => __ivt.setNaverApiRows(rows), fake);
        await pg.waitForFunction(() => document.querySelectorAll('#preview tbody tr').length === 2);
        const exclFake = await pg.evaluate(() => __ivt.S.merged.map(e => ({ n: e.conv['수취인명'], x: e.excluded })));
        ok(exclFake.find(e => e.n === '받는A').x === true && exclFake.find(e => e.n === '받는B').x === false, '⑤ API 경로: 「21일 발송」 자동 체크 · 「문앞」 미체크', JSON.stringify(exclFake));
        await pg.evaluate(() => { __ivt.S.merged.forEach(e => { e.excluded = false; e.userTouched = true; }); __ivt.render(); });
        const dl3 = pg.waitForEvent('download'); await pg.click('#btn-download'); const d3 = await dl3;
        const f3 = path.join(os.tmpdir(), 'ivt3.xlsx'); await d3.saveAs(f3); const w3 = XLSX.readFile(f3, { cellStyles: true }); const q = w3.Sheets['발주발송관리'];
        const rowA = XLSX.utils.sheet_to_json(q, { header: 1, raw: false }).find(r => r && r[6] === '받는A');
        ok(!!rowA && rowA[0] === '20260918000001' && rowA[2] === '택배,등기,소포' && rowA[3] === 'CJ대한통운' && rowA[16] === '발송대기' && rowA[23] === 'abcd****' && rowA[14] === '2026091800000', '⑤ 시트2(API): 상품주문번호·배송방법·택배사·주문상태·ID 마스킹·주문번호', JSON.stringify(rowA && [rowA[0], rowA[2], rowA[3], rowA[16], rowA[23]]));
        ok(/2026\/09\/18 09:00/.test(String(rowA && rowA[17])) && /₩27,000/.test(String(rowA && rowA[20])) && /2026\/09\/23 23:59/.test(String(rowA && rowA[22])), '⑤ 시트2(API): 결제일·정산예정금액·발송기한 서식', JSON.stringify(rowA && [rowA[17], rowA[20], rowA[22]]));
        ok(errs.length === 0, 'pageerror·console error 0', errs.join(' | '));
        await br.close();
    } finally { srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
