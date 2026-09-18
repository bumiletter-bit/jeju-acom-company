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
const XLS = process.argv[2] || 'C:/Users/전승범/Downloads/스마트스토어_전체주문발주발송관리_20260918_0926.xlsx';   // 인자로 다른 원본 파일 지정 가능
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
        ok(/^\d{4}-\d{2}-\d{2}$/.test(mp.suggested) && Array.isArray(mp.shipDays) && mp.shipDays.length >= 5 && mp.today === mp.suggested && mp.shipDays.every(d => new Date(d + 'T00:00:00Z').getUTCDay() !== 6) && mp.today >= mp.realToday, '기준 발송일 = 달력상 다음 발송일(토요일 0·오늘 이후) · baseDate 없으면 suggested', `today ${mp.today} · real ${mp.realToday} · ${mp.shipDays.join(',')}`);
        const mpB = await apiJ('/api/agent-office/invoice/memo-parse', 'POST', { memos: ['21일 발송'], baseDate: mp.shipDays[mp.shipDays.length - 1] });
        ok(mpB.today === mp.shipDays[mp.shipDays.length - 1] && mpB.suggested === mp.suggested, 'memo-parse baseDate 지정 → 그 날 기준으로 해석(suggested는 불변)', mpB.today);
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
        await pg.goto(`${BASE}/invoice-v2.html`, { waitUntil: 'load' });
        await pg.waitForFunction(() => window.__ivt, null, { timeout: 20000 });
        await pg.setInputFiles('#file-naver', XLS);
        await pg.waitForFunction(n => document.querySelectorAll('#preview tbody tr').length === n, N, { timeout: 30000 });
        ok(true, '① 파일 업로드 → 미리보기 행수 = 원본', N);
        const st1 = await pg.evaluate(() => ({ excl: __ivt.S.merged.filter(e => e.excluded).length, review: __ivt.S.merged.filter(e => e.flag === 'review').length, today: __ivt.S.today }));
        ok(st1.excl === expExcl, '① 자동 체크(기준일 발송 아님) = memo-parse 규칙', `${st1.excl} / 기대 ${expExcl}`);
        ok((await pg.getAttribute('#ship-date', 'data-iso')) === mp.today && /다음 발송일/.test(await pg.inputValue('#ship-date')), '① 기준 발송일 입력 = suggested · 「다음 발송일」 표기', await pg.inputValue('#ship-date'));
        // 📅 달력: 열기 → 토요일·휴무일 비활성 · 다음 발송일 라벨 · 다른 발송일 클릭 → 기준일 변경·재판정 → 다음 발송일 버튼으로 복귀
        await pg.click('#ship-date'); await pg.waitForSelector('.akm-cal.ivt-cal', { state: 'visible' });
        const calInfo = await pg.evaluate(() => { const days = Array.from(document.querySelectorAll('.ivt-cal .akm-cal-day')); return { n: days.length, satOff: days.filter((b, i) => i % 7 === 6).every(b => b.disabled && b.classList.contains('off')), noShipOff: (window.__ivt.S.calendar.noShip.size ? [...window.__ivt.S.calendar.noShip] : []).every(d => { const b = days.find(x => x.dataset.date === d); return !b || b.disabled; }), nextLab: (days.find(b => b.dataset.date === window.__ivt.S.calendar.suggested) || {}).textContent || '', sel: (days.find(b => b.classList.contains('sel')) || {}).dataset?.date }; });
        ok(calInfo.n === 42 && calInfo.satOff && calInfo.noShipOff && /다음 발송일/.test(calInfo.nextLab) && calInfo.sel === mp.today, '📅 달력: 42칸 · 토요일·발송휴무일 비활성 · 다음 발송일 라벨 · 선택 = 기준일', JSON.stringify(calInfo));
        const altDay = mp.shipDays.find(d => d !== mp.today && d.slice(0, 7) === mp.today.slice(0, 7)) || mp.shipDays.find(d => d !== mp.today);
        if (altDay.slice(0, 7) !== mp.today.slice(0, 7)) { await pg.click('.ivt-cal [data-nav="1"]'); }
        await pg.click(`.ivt-cal .akm-cal-day[data-date="${altDay}"]`); await pg.waitForFunction(() => !document.getElementById('save-all').disabled); await pg.waitForTimeout(400);
        const alt = await pg.evaluate(() => ({ iso: document.getElementById('ship-date').dataset.iso, today: __ivt.S.today, txt: document.getElementById('ship-date').value, open: __ivt.ShipCal.isOpen() }));
        ok(alt.iso === altDay && alt.today === altDay && /직접 선택/.test(alt.txt) && !alt.open, '📅 다른 발송일 클릭 → 기준 발송일 변경·재판정·달력 닫힘', JSON.stringify(alt));
        await pg.click('#ship-date'); await pg.waitForSelector('.akm-cal.ivt-cal', { state: 'visible' }); await pg.click('.ivt-cal [data-next]'); await pg.waitForFunction(() => !document.getElementById('save-all').disabled); await pg.waitForTimeout(400);
        ok((await pg.getAttribute('#ship-date', 'data-iso')) === mp.today && (await pg.evaluate(() => __ivt.S.today)) === mp.today, '📅 「다음 발송일로」 버튼 → 추천값 복귀', await pg.inputValue('#ship-date'));
        ok(st1.review >= expAck, '① 확인필요 ≥ 애매(ack) 건수', `${st1.review} / ack ${expAck}`);
        const reviewRows = await pg.locator('#review tbody tr').count();
        ok(reviewRows === (await pg.evaluate(() => __ivt.S.merged.filter(e => !e.individual && (e.excluded || e.flag)).length)), '① 검토 목록 = 체크됨 + 확인필요', reviewRows);
        const ackUnchecked = await pg.evaluate(() => __ivt.S.merged.filter(e => e.flag === 'review').every(e => !e.excluded));
        ok(ackUnchecked, '① 확인필요 건은 체크 안 됨(직원이 결정)');
        // ② 정리 파일 줄 붙여넣기 → [저장하기] — 하이픈 · 날짜 해석 · 채널 분리 · 판정 6종
        const todayK = mp.today; const dPlus = (iso, n) => new Date(Date.parse(iso) + n * 86400e3).toISOString().slice(0, 10);
        const usd = iso => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(2, 4)}`;   // 엑셀 복사 형식 9/20/26
        const TODAY = usd(todayK), FUT = usd(dPlus(todayK, 3)), PAST = usd(dPlus(todayK, -1));
        const save = async (id, text) => { await pg.fill('#ln-all', text); await pg.click('#save-all'); await pg.waitForTimeout(80); await pg.waitForFunction(() => !document.getElementById('save-all').disabled); await pg.waitForTimeout(150); };
        const resTxt = async () => pg.textContent('#res-all');
        await save('naver', TODAY + '\t01011121111\t입력o삭제x\t네이버');
        ok((await pg.inputValue('#ln-all')).includes('010-1112-1111'), '② 저장 시 번호 자동 하이픈: 01011121111 → 010-1112-1111', await pg.inputValue('#ln-all'));
        const fm = await pg.evaluate(() => [__ivt.fmtTel('050512345678'), __ivt.fmtTel('0212345678'), __ivt.fmtTel('20260918-0000011'), __ivt.fmtTel('010-1112-1111')]);
        ok(fm[0] === '0505-1234-5678' && fm[1] === '02-1234-5678' && fm[2] === '20260918-0000011' && fm[3] === '010-1112-1111', '② 하이픈 규칙: 0505 4-4-4 · 02 2-4-4 · 주문번호 무변경 · 이미 하이픈은 유지', fm.join(' | '));
        const pd = await pg.evaluate(t => ['9/20/26', '2026-09-20', '9.20', '9월 20일', '20일', '오늘', '내일', '없음'].map(s => __ivt.parseDate(s, t)), todayK);
        ok(pd[0] === '2026-09-20' && pd[1] === '2026-09-20' && pd[2] === todayK.slice(0, 4) + '-09-20' && pd[3] === pd[2] && pd[4] === todayK.slice(0, 8) + '20' && pd[5] === todayK && pd[6] === dPlus(todayK, 1) && pd[7] === null, '② 요청일자 해석: 9/20/26 · 2026-09-20 · 9.20 · 9월 20일 · 20일 · 오늘 · 내일 · 없음=null', pd.join(' | '));
        ok(/주문 없음/.test(await resTxt()) && (await pg.locator('#res-all tbody tr').count()) === 1, '② 없는 번호 → 표에 「주문 없음」 1행', (await resTxt()).slice(0, 80));
        // 채널 분리: 네이버 구매자 1명과 같은 번호의 자사몰 주문을 만들어 넣고, 네이버 칸에만 → 자사몰 건은 안 빠짐 / 자사몰 칸에만 → 네이버 안 빠짐
        const sameTel = indivTels[0].replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
        const cafeRows = [{ '주문자명': '동일손님', '주문상품명(세트상품 포함)': '제주 감귤 · 1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 2.5kg(로얄과)', '배송메시지': '', '수령인': '자사몰수취', '주문자 휴대전화': sameTel, '수량': 1, '수령인 휴대전화': '010-0000-0000', '수령인 주소(전체)': '제주시 자사몰로 1', '주문번호': '20260918-0000099' }];
        await pg.evaluate(rows => __ivt.setRows('cafe24', rows), cafeRows);
        await pg.waitForFunction(n => document.querySelectorAll('#preview tbody tr').length === n, N + 1);
        const cnt = async () => pg.evaluate(() => ({ nv: __ivt.S.merged.filter(e => e.ch === 'naver' && e.individual).length, cf: __ivt.S.merged.filter(e => e.ch === 'cafe24' && e.individual).length }));
        await save('naver', TODAY + '\t' + sameTel + '\t입력o삭제x 2건\t네이버');
        const c1 = await cnt(); ok(c1.nv === byTel[indivTels[0]].length && c1.cf === 0, '② 같은 번호 — 네이버 칸에만 → 네이버만 개별발송, 자사몰 건은 시트1 유지', JSON.stringify(c1));
        ok((await pg.locator('#res-all tbody tr[data-k="0"]').count()) === byTel[indivTels[0]].length && /확인완료/.test(await resTxt()) && /입력삭제 · 시트2 노란 행/.test(await resTxt()) && /비고 2건과 다름/.test(await resTxt()), '② 저장 표: 주문 1건당 1행 · 확인완료 · 「입력삭제 · 시트2 노란 행」 · 비고 건수 불일치 경고', (await resTxt()).slice(0, 160));
        await save('cafe24', TODAY + '\t' + sameTel + '\t자사몰!! 입력o삭제X\t자사몰');
        const c2 = await cnt(); ok(c2.nv === 0 && c2.cf === 1, '② 같은 번호 — 플랫폼 「자사몰」 줄 → 자사몰만 개별발송, 네이버 건은 유지', JSON.stringify(c2));
        await save('cafe24', TODAY + '\t20260918-0000099\t입력o삭제x');
        const c3 = await cnt(); ok(c3.cf === 1, '② 자사몰 주문번호로도 개별발송 지정', JSON.stringify(c3));
        await save('naver', TODAY + '\t' + sameTel + '\t입력o삭제x\n' + TODAY + '\t20260918-0000099\t입력o삭제x\t자사몰');
        const c4 = await cnt(); ok(c4.nv === byTel[indivTels[0]].length && c4.cf === 1 && /🏠 자사몰/.test(await resTxt()) && /🛒 네이버/.test(await resTxt()), '② 플랫폼 칸 없는 줄 = 네이버 · 「자사몰」 줄 = 자사몰 — 한 칸에서 채널 자동 구분·표에 플랫폼 배지', JSON.stringify(c4));
        await save('naver', '');
        await pg.evaluate(() => __ivt.setRows('cafe24', []));
        await pg.waitForFunction(n => document.querySelectorAll('#preview tbody tr').length === n, N);
        // 요청일자 판정 — 뒤 날짜 = 제외 · 오늘(비고 없음) = 오늘 발송 · 지난 날짜 = 확인필요 · 부분 지정(수취인 이름) = 그 수취인만
        const reqTel = indivTels[1].replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3'), reqN = byTel[indivTels[1]].length;
        const reqState = async () => pg.evaluate(t => { const rows = __ivt.S.merged.filter(e => e.req && e.req.digits === t); return { n: rows.length, excl: rows.filter(e => e.excluded).length, kinds: [...new Set(rows.map(e => e.reqKind))], indiv: rows.filter(e => e.individual).length }; }, indivTels[1]);
        await save('naver', FUT + '\t' + reqTel + '\t2건\t네이버');
        const q1 = await reqState(); ok(q1.n === reqN && q1.excl === reqN && q1.kinds.join() === 'future', '☎ 요청일자 뒤 날짜 → 그 손님 주문 전부 제외 체크(손님 메모보다 우선)', JSON.stringify(q1));
        // 검토 목록: 배송메모 칸 = 손님 원문만(직원 줄은 「읽어낸 요청」 칸) · 필터 전체/제외 체크/확인필요
        const memoCol = await pg.evaluate(t => { const tr = Array.from(document.querySelectorAll('#review tbody tr')).find(r => r.children[6].textContent.includes(t)); return tr ? { memo: tr.children[5].textContent, req: tr.children[6].textContent } : null; }, reqTel);
        ok(memoCol && !/📋|\d{3}-\d{4}-\d{4}/.test(memoCol.memo) && /📋/.test(memoCol.req) && memoCol.req.includes(reqTel), '검토 목록: 배송메모 칸엔 손님 원문만 · 직원 줄(📋)은 읽어낸 요청 칸', JSON.stringify(memoCol));
        const fBtn = async f => { await pg.click(`#review-filter button[data-f="${f}"]`); await pg.waitForTimeout(100); return pg.evaluate(() => ({ rows: Array.from(document.querySelectorAll('#review tbody tr')).filter(r => r.querySelector('input[type=checkbox]')), active: document.querySelector('#review-filter button.active').dataset.f })); };
        const fR = await fBtn('review'); const fE = await fBtn('excl'); const fA = await fBtn('all');
        const fchk = await pg.evaluate(() => ({ review: Array.from(document.querySelectorAll('#review tbody tr')).length }));
        // 필터 목록 고정(대표 실물 9/18): 확인필요 보기에서 체크해도 행이 사라지지 않고 남아 다시 풀 수 있다
        await pg.click('#review-filter button[data-f="review"]'); await pg.waitForTimeout(100);
        const stick0 = await pg.evaluate(() => document.querySelectorAll('#review tbody tr input[type=checkbox]').length);
        const firstUn = pg.locator('#review tbody tr input[type=checkbox]:not(:checked)').first();
        await firstUn.click(); await pg.waitForTimeout(150);
        const stick1 = await pg.evaluate(() => ({ rows: document.querySelectorAll('#review tbody tr input[type=checkbox]').length, checked: document.querySelectorAll('#review tbody tr input[type=checkbox]:checked').length, active: document.querySelector('#review-filter button.active').dataset.f }));
        await pg.locator('#review tbody tr input[type=checkbox]:checked').first().click(); await pg.waitForTimeout(150);
        const stick2 = await pg.evaluate(() => ({ rows: document.querySelectorAll('#review tbody tr input[type=checkbox]').length, checked: document.querySelectorAll('#review tbody tr input[type=checkbox]:checked').length }));
        ok(stick0 > 0 && stick1.rows === stick0 && stick1.checked === 1 && stick1.active === 'review' && stick2.rows === stick0 && stick2.checked === 0, '검토 목록 필터 고정: 확인필요 보기에서 체크해도 행 유지 → 다시 풀기 가능', JSON.stringify({ stick0, stick1, stick2 }));
        await pg.click('#review-filter button[data-f="all"]'); await pg.waitForTimeout(100);
        ok(fR.active === 'review' && fE.active === 'excl' && fA.active === 'all' && (await pg.evaluate(() => { const rows = () => Array.from(document.querySelectorAll('#review tbody tr input[type=checkbox]')); document.querySelector('#review-filter button[data-f="review"]').click(); const r1 = rows().every(c => !c.checked) && rows().length === __ivt.S.merged.filter(e => !e.individual && !e.excluded && e.flag === 'review').length; document.querySelector('#review-filter button[data-f="excl"]').click(); const r2 = rows().every(c => c.checked) && rows().length === __ivt.S.merged.filter(e => !e.individual && e.excluded).length; document.querySelector('#review-filter button[data-f="all"]').click(); return r1 && r2; })), '검토 목록 필터: 확인필요 = 체크 안 된 행만 · 제외 체크 = 체크된 행만 · 전체 복귀', JSON.stringify({ fR: fR.rows.length, fE: fE.rows.length, fA: fA.rows.length }));
        ok(/삭제완료 · \d+\/\d+ 발송분/.test(await resTxt()) && /확인완료/.test(await resTxt()), '☎ 저장 표: 「🗑 삭제완료 · M/D 발송분」 + 확인완료', (await resTxt()).slice(0, 160));
        await save('naver', TODAY + '\t' + reqTel + '\t메모무시\t네이버');
        const q2 = await reqState(); ok(q2.n === reqN && q2.excl === 0 && q2.kinds.join() === 'today' && q2.indiv === 0, '☎ 요청일자 오늘 + 입력삭제 없음 → 오늘 발송(제외 아님·검토 목록에 정보)', JSON.stringify(q2));
        await save('naver', PAST + '\t' + reqTel + '\t입력o삭제x\t네이버\n' + TODAY + '\t099-9999-9999\t\t네이버');
        const q3 = await reqState(); ok(q3.n === reqN && q3.excl === 0 && q3.indiv === 0 && q3.kinds.join() === 'past', '☎ 지난 날짜(입력삭제여도) → 확인필요(자동 적용 안 함)', JSON.stringify(q3));
        ok(/지난 날짜 확인/.test(await resTxt()) && /주문 없음/.test(await resTxt()) && /확인필요/.test(await resTxt()), '☎ 저장 표: 지난 날짜 → 확인필요 · 없는 번호 → 주문 없음');
        const recName = String(byTel[indivTels[1]][0]['수취인명'] || '').trim(); const recN = byTel[indivTels[1]].filter(r => String(r['수취인명'] || '').trim() === recName).length;
        await save('naver', TODAY + '\t' + reqTel + '\t' + reqN + '건 중 1건(수취인 ' + recName + ' 만)\t네이버');
        const q4 = await reqState(); const q4o = await pg.evaluate(([t, nm]) => __ivt.S.merged.filter(e => e.ch === 'naver' && (e.conv['구매자연락처'] || '').replace(/\D/g, '') === t && String(e.conv['수취인명'] || '').trim() !== nm).every(e => !e.req), [indivTels[1], recName]);
        ok(q4.n === recN && q4.kinds.join() === 'today' && q4.indiv === 0 && q4o, '☎ 「n건 중 1건(수취인 ○○ 만)」 → 그 수취인 건만 오늘 발송 적용·나머지 건은 무접촉', JSON.stringify(q4) + ' / 기대 ' + recN);
        await save('naver', TODAY + '\t' + reqTel + '\t' + reqN + '건 중 1건\t네이버');
        const q5 = await reqState(); ok(q5.n === reqN && q5.indiv === 0 && q5.excl === 0 && q5.kinds.join() === 'partial', '☎ 「n건 중 1건」 수취인 이름 없음 → 자동 적용 안 함·확인필요', JSON.stringify(q5));
        await save('naver', indivTels.map(t => TODAY + '\t' + t + '\t입력o삭제x\t네이버').join('\n'));
        const indivCnt = await pg.evaluate(() => __ivt.S.merged.filter(e => e.individual).length);
        ok(indivCnt === expIndiv, '② 오늘 + 입력삭제 줄 → 개별발송 회색 분류 건수', `${indivCnt} / 기대 ${expIndiv}`);
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
        // ②-q 중간발주(v2) — 송장 변환 탭과 독립: 훅으로 3채널 행 주입 → 검토 목록 + 집계 · 체크 토글·☎ 지정일이 수량에 즉시 반영
        await pg.click('#ivt-mode-qty');
        const cafeQ = [{ '주문자명': '자사몰손님', '주문상품명(세트상품 포함)': '제주 감귤 · 1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 2.5kg(로얄과)', '배송메시지': '21일 발송 부탁드려요', '수령인': '자사몰수취', '주문자 휴대전화': '010-7777-8888', '수량': 3, '수령인 휴대전화': '010-7777-8888', '수령인 주소(전체)': '제주시 자사몰로 1', '주문번호': '20260918-0000077' }];
        await pg.evaluate(([nv, cf]) => __ivt.setQRows(nv, cf, []), [rows, cafeQ]);
        await pg.waitForFunction(() => document.querySelectorAll('#invoice-qty-list .qty-row').length > 0);
        const qs = await pg.evaluate(() => ({ n: __ivt.Q.merged.length, excl: __ivt.Q.merged.filter(e => e.excluded).length, total: __ivt.qtyTotal(), exp: __ivt.Q.merged.filter(e => !e.excluded).reduce((s, e) => s + (parseInt(e.conv['수량']) || 1), 0), all: __ivt.Q.merged.reduce((s, e) => s + (parseInt(e.conv['수량']) || 1), 0), cafeExcl: __ivt.Q.merged.filter(e => e.ch === 'cafe24').every(e => e.excluded) }));
        ok(qs.n === N + 1 && qs.total === qs.exp && qs.total < qs.all, '②-q 집계 = 제외 체크 뺀 수량(독립 상태·3채널)', JSON.stringify(qs));
        ok(qs.cafeExcl, '②-q 자사몰 「21일 발송」 메모 → 자동 제외');
        ok((await pg.locator('#qreview tbody tr').count()) >= qs.excl && (await pg.locator('#qty-partner-filter button').count()) === 4, '②-q 검토 목록·거래처 필터 렌더');
        const firstQ = pg.locator('#qreview input[type=checkbox]:checked').first(); const beforeQ = qs.total;
        await firstQ.click(); await pg.waitForTimeout(200);
        const afterQ = await pg.evaluate(() => __ivt.qtyTotal());
        ok(afterQ > beforeQ, '②-q 검토 목록 체크 해제 → 수량 즉시 증가', `${beforeQ} → ${afterQ}`);
        const tel2 = indivTels[0].replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
        await pg.fill('#qln-all', FUT + '\t' + tel2 + '\t\t네이버'); await pg.click('#qsave-all'); await pg.waitForFunction(() => !document.getElementById('qsave-all').disabled); await pg.waitForTimeout(200);
        const qq2 = await pg.evaluate(t => ({ total: __ivt.qtyTotal(), reqExcl: __ivt.Q.merged.filter(e => e.req && e.excluded).length }), indivTels[0]);
        ok(qq2.reqExcl === byTel[indivTels[0]].length && qq2.total < afterQ, '②-q ☎ 지정일(네이버 칸) → 그 손님 주문 제외·수량 감소', JSON.stringify(qq2));
        ok(await pg.evaluate(t => __ivt.S.merged.filter(e => e.req && e.req.digits === t && e.excluded).length === 0, indivTels[0]), '②-q 중간발주 탭 입력이 송장 변환 탭 상태에 영향 없음(독립)');
        await pg.fill('#qln-all', TODAY + '\t' + tel2 + '\t입력o삭제x\t네이버'); await pg.click('#qsave-all'); await pg.waitForFunction(() => !document.getElementById('qsave-all').disabled); await pg.waitForTimeout(200);
        const qq3 = await pg.evaluate(t => ({ total: __ivt.qtyTotal(), indiv: __ivt.Q.merged.filter(e => e.individual).length, excl: __ivt.Q.merged.filter(e => e.req && e.req.digits === t && e.excluded).length }), indivTels[0]);
        ok(qq3.indiv === 0 && qq3.excl === 0 && qq3.total === afterQ && /집계 포함/.test(await pg.textContent('#qres-all')), '②-q 중간발주: 오늘 + 입력삭제 줄 = 실물량이라 집계 포함(제외 0·개별 0)', JSON.stringify(qq3) + ' / ' + afterQ);
        await pg.fill('#qln-all', ''); await pg.click('#qsave-all'); await pg.waitForFunction(() => !document.getElementById('qsave-all').disabled); await pg.waitForTimeout(200);
        await pg.click('#ivt-mode-convert');
        // ③ 다운로드 (개별발송 2명 + reqTel은 「기준일 발송」 줄 → 시트1에 남되 배송메모 비움)
        await save('naver', TODAY + '\t' + indivTels[0] + '\t입력o삭제x\t네이버\n' + TODAY + '\t' + reqTel + '\t메모무시\t네이버');
        const expIndiv3 = byTel[indivTels[0]].length;   // ③부터 개별발송은 첫 번호만(둘째 번호 = 「메모무시」 발송 확정)
        const dl1 = pg.waitForEvent('download'); await pg.click('#btn-download'); const d1 = await dl1;
        const f1 = path.join(os.tmpdir(), 'ivt1.xlsx'); await d1.saveAs(f1);
        const w1 = XLSX.readFile(f1, { cellStyles: true });
        ok(w1.SheetNames.length === 2 && w1.SheetNames[0] === 'Sheet1' && w1.SheetNames[1] === '발주발송관리', '③ 시트 2개(Sheet1·발주발송관리)', w1.SheetNames.join(','));
        const s1 = w1.Sheets.Sheet1, s2 = w1.Sheets['발주발송관리'];
        const s1rows = XLSX.utils.sheet_to_json(s1, { header: 1 }).length - 1;
        const exclNow2 = await pg.evaluate(() => __ivt.S.merged.filter(e => !e.individual && e.excluded).length);
        ok(s1rows === N - expIndiv3 - exclNow2, '③ 시트1 행수 = 전체 − 개별 − 제외', `${s1rows} = ${N} − ${expIndiv3} − ${exclNow2}`);
        const s1j = XLSX.utils.sheet_to_json(s1); const memoRows = s1j.filter(r => String(r['구매자연락처'] || '').replace(/\D/g, '').endsWith(indivTels[1].slice(-8)));
        if (!memoRows.length) console.log('   시트1 헤더:', Object.keys(s1j[0] || {}).join('|'), '· 예시 연락처:', String((s1j[0] || {})['구매자연락처']));
        ok(memoRows.length === reqN && memoRows.every(r => !String(r['배송메세지'] || '').trim()) && /배송메모 비움/.test(await pg.textContent('#msg-dl')), '③ 「메모무시」 줄로 발송 확정한 주문 = 시트1에 있고 배송메모 비움(원본 메모 ' + byTel[indivTels[1]].filter(r => String(r['배송메세지'] || '').trim()).length + '건 있었음)', memoRows.length);
        const a2 = XLSX.utils.sheet_to_json(s2, { header: 1, raw: true });
        ok(String(s2.A1 && s2.A1.v) === String(ws0.A1.v) && String(s2.D1 && s2.D1.v) === String(ws0.D1.v), '③ 시트2 1행 안내문 = 원본과 동일');
        ok(JSON.stringify(a2[1]) === JSON.stringify(aoa[hdrIdx]), '③ 시트2 2행 헤더 27열 = 원본과 동일');
        ok(a2.length - 2 === s1rows + expIndiv3, '③ 시트2 행수 = 시트1 + 개별발송', a2.length - 2);
        // 순서: 시트1 k행 수취인연락처1(G) == 시트2 k행 수취인연락처1(J)
        let orderOk = true; for (let k = 0; k < s1rows; k++) { const t1 = String((s1['G' + (k + 2)] || {}).v || '').replace(/\D/g, ''); const t2 = String((s2['J' + (k + 3)] || {}).v || '').replace(/\D/g, ''); if (t1 !== t2) { orderOk = false; console.log('   순서 불일치 행', k + 1, t1, t2); break; } }
        ok(orderOk, '③ 시트1·시트2 행 순서 동일(수취인연락처 1:1)');
        const lastRows = []; for (let k = 0; k < expIndiv3; k++) { const r = a2.length - expIndiv3 + k + 1; lastRows.push(s2['A' + r]); }
        const fillOf = c => c && c.s && ((c.s.fgColor && c.s.fgColor.rgb) || (c.s.fill && c.s.fill.fgColor && c.s.fill.fgColor.rgb)) || null;   // 읽기 시 patternType/fgColor가 최상위로 온다
        ok(lastRows.every(c => fillOf(c) === 'FFF2CC'), '③ 개별발송 행 = 맨 아래 노란 배경', lastRows.map(fillOf).join(','));
        const firstDataFill = fillOf(s2.A3);
        ok(firstDataFill !== 'FFF2CC', '③ 일반 행은 노란 배경 아님');
        const indivTelsIn = lastRows.length ? new Set([indivTels[0]]) : null;
        const yellowTels = []; for (let k = 0; k < expIndiv3; k++) { const r = a2.length - expIndiv3 + k + 1; yellowTels.push(String((s2['N' + r] || {}).v || '').replace(/\D/g, '')); }
        ok(yellowTels.every(t => indivTelsIn.has(t)), '③ 노란 행의 구매자연락처 = 입력한 개별발송 번호');
        ok((s2.R3 && s2.R3.z === 'yyyy/mm/dd\\ hh:mm') && (s2.U3 && /₩/.test(s2.U3.z || '')), '③ 시트2 날짜·금액 셀 서식 유지(결제일·정산예정금액)', `${s2.R3 && s2.R3.z} / ${s2.U3 && s2.U3.z}`);
        // ③-c 쿠팡 취소 재확인(구버전 통합 변환의 안전장치 이식 #452-s): API로 불러온 쿠팡 2건 중 1건이 다운로드 전에 취소 → 자동 제외·안내
        const cpRows = [1, 2].map(n => ({ '구매자': '쿠팡손님' + n, '등록상품명': '제주 황금향', '노출상품명(옵션명)': '황금향 선물용 - 3kg(중대과 7~15과)', '배송메세지': '', '수취인이름': '쿠팡수취' + n, '구매자전화번호': '0505-1111-222' + n, '구매수(수량)': 1, '수취인전화번호': '0505-1111-222' + n, '수취인 주소': '서울시 쿠팡로 ' + n, _orderId: '2710251961537' + n }));
        await pg.evaluate(rows => __ivt.setRows('coupang', rows), cpRows); await pg.waitForFunction(n => document.querySelectorAll('#preview tbody tr').length === n, N + 2);
        await pg.evaluate(() => { __ivt.S.coupangLoadedAt = new Date(Date.now() - 60000).toISOString(); });
        await pg.route('**/api/agent-office/coupang/canceled-since*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, canceled: ['27102519615372'] }) }));
        const dlC = pg.waitForEvent('download'); await pg.click('#btn-download'); const dC = await dlC; const fC = path.join(os.tmpdir(), 'ivt-cp.xlsx'); await dC.saveAs(fC);
        const cpState = await pg.evaluate(() => ({ cp: __ivt.S.coupang.length, merged: __ivt.S.merged.filter(e => e.ch === 'coupang').length, msg: document.getElementById('msg-dl').textContent, cmsg: document.getElementById('msg-coupang').textContent }));
        const s1c = XLSX.utils.sheet_to_json(XLSX.readFile(fC).Sheets.Sheet1).map(r => String(r['수취인명']));
        ok(cpState.cp === 1 && cpState.merged === 1 && /쿠팡 취소 1건 자동 제외/.test(cpState.msg) && /취소 요청 1건/.test(cpState.cmsg) && s1c.includes('쿠팡수취1') && !s1c.includes('쿠팡수취2'), '③-c 다운로드 직전 쿠팡 취소 재확인 → 취소 건 자동 제외(시트1에 없음)·안내', JSON.stringify(cpState).slice(0, 200));
        await pg.unroute('**/api/agent-office/coupang/canceled-since*');
        await pg.evaluate(() => { __ivt.S.coupangLoadedAt = null; return __ivt.setRows('coupang', []); }); await pg.waitForFunction(n => document.querySelectorAll('#preview tbody tr').length === n, N);
        // ④ 무회귀: 개별 0·제외 0 → 시트1 = 참조본
        await save('naver', '');
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
        // ⑥ 비밀번호 파일 자동 해제: 오늘 원본을 4031로 암호화해 업로드 → 서버 복호화 → 같은 행수
        try {
            const officeCrypto = require('officecrypto-tool');
            const enc = await officeCrypto.encrypt(fs.readFileSync(XLS), { password: process.env.SMARTSTORE_FILE_PASSWORD || '4031' });
            const fenc = path.join(os.tmpdir(), 'ivt-enc.xlsx'); fs.writeFileSync(fenc, enc);
            await pg.setInputFiles('#file-naver', fenc);
            await pg.waitForFunction(n => document.querySelectorAll('#preview tbody tr').length === n && /비밀번호 자동 해제/.test(document.getElementById('msg-naver').textContent), N, { timeout: 60000 });
            ok(true, '⑥ 비밀번호 걸린 파일 업로드 → 자동 해제 → 행수 동일', N);
        } catch (e) { ok(false, '⑥ 비밀번호 파일 자동 해제', e.message.slice(0, 160)); }
        ok(errs.length === 0, 'pageerror·console error 0', errs.join(' | '));
        await br.close();
    } finally { srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
