// #569 검증: 화면을 찍어 만드는 결과물 — 야간 화면에서 만들어도 밝은 화면에서 만든 것과 같은 그림이어야 한다
//   대상(전부 app.js 의 html2canvas): ①휴가신청서 PDF ②재직증명서 PDF ③시말서 PDF(downloadDocPDF) ④지출결의서 PDF(downloadExpensePDF)
//   ⑤정산현황 캡처(ssCaptureScreen)는 화면에 부르는 버튼(#ss-captureBtn)이 없어 지금은 쓰이지 않는 코드다 → 버튼이 없음을 확인만 하고, 생기면 이 검증이 알려 준다
//   (중간발주 「선택분 이미지」는 송장변환 iframe 안에서 찍힌다 → verify-569-invoice-dark.js ③ 이 본다)
//   방법: html2canvas 가 돌려준 그림(canvas)을 가로채 PNG 로 받아, 밝은 화면에서 찍은 것과 바이트 비교. PDF 파일 자체는 만든 시각이 들어가 비교하지 않는다(그림이 같으면 내용이 같다).
//   문서·지출결의·정산현황 자료는 전부 가짜(가로채기 응답) · 쓰기는 공통 틀이 전부 가로챔 → DB 쓰기 0
//   사용: node scripts/verify-569-capture.js [--shot=폴더]   (포트 3462 · PORT569 로 바꿀 수 있음)
//   🔴 워커1의 html2canvas 감싸기(찍는 복제 문서에서 야간 속성 떼기)가 들어오기 전에는 어두운 쪽 그림이 달라 실패하는 것이 정상이다.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const H = require('./ao-dark/harness.js');
const arg = n => { const a = process.argv.slice(2).find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : ''; };
const SHOT = arg('shot');
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 900) : '')); };
const PAGES = ['agent-office', 'document', 'expense', 'settlement'];   // 이 시험에서는 세 메뉴를 「끝난 메뉴」로 끼워 넣어 야간 속성이 붙게 한다

// ── 가짜 자료 ─────────────────────────────────────────────────────────────────────────
const DOCS = [
    { id: 9001, type: 'vacation', subType: '연차', applicantId: 801, applicantName: '시험직원', applicantPosition: '사원', startDate: '2026-10-12T00:00:00.000Z', endDate: '2026-10-13T00:00:00.000Z', startTime: null, endTime: null, reason: '개인 사정(시험 문서)', status: 'approved', processedAt: '2026-10-06T03:00:00.000Z', approverId: 802, approverName: '시험대표', deductedDays: 2, createdAt: '2026-10-05T01:00:00.000Z' },
    { id: 9002, type: 'employment', subType: '은행 제출용', applicantId: 801, applicantName: '시험직원', applicantPosition: '사원', startDate: null, endDate: null, reason: '발급 매수: 2부', status: 'approved', processedAt: '2026-10-06T03:00:00.000Z', approverId: 802, approverName: '시험대표', createdAt: '2026-10-05T01:00:00.000Z', applicantBirth: '1990-01-01', applicantJoinDate: '2024-03-02', applicantAddress: '제주특별자치도 제주시 시험로 1', hireDate: '2024-03-02', birthDate: '1990-01-01', address: '제주특별자치도 제주시 시험로 1' },
    { id: 9003, type: 'reason', subType: '지각', applicantId: 801, applicantName: '시험직원', applicantPosition: '사원', startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-01T00:00:00.000Z', reason: '시험용 시말서 내용입니다.\n두 번째 줄.', status: 'rejected', processedAt: '2026-10-06T03:00:00.000Z', approverId: 802, approverName: '시험대표', createdAt: '2026-10-05T01:00:00.000Z' },
];
const EXPENSE = { id: 9101, title: '시험 지출결의', purpose: '포장 자재 구입(시험)', applicant_id: 801, applicant_name: '시험직원', applicant_position: '사원', manager_id: 803, manager_name: '시험부장', manager_status: 'approved', ceo_id: 802, ceo_name: '시험대표', ceo_status: 'approved', status: 'approved', total_amount: 165000, expense_date: '2026-10-05', created_at: '2026-10-05T01:00:00.000Z', processed_at: '2026-10-06T03:00:00.000Z', payment_method: '법인카드', items: [{ name: '박스 테이프', amount: 45000, note: '20개' }, { name: '완충재', amount: 120000, note: '' }] };
const SS = ['2026-10-05', '2026-10-02'].map((d, i) => ({ date: d + 'T00:00:00.000Z', current_cash: 12345000 + i, settlement_scheduled: 6540000, unsettled: 1230000, coupang_unpaid: 450000, selfmall_unpaid: 120000, ad_naver: 300000, ad_gfa: 150000, card_fee: 80000, corp_card: 950000, hyodong: 4200000, daesong: 2100000, aewol: 0, delivery: 870000, memo: i ? '' : '시험 메모' }));
const routes = async pg => {
    const J = body => r => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    await pg.route('**/api/documents/history*', J(DOCS));
    await pg.route('**/api/users/*/signature*', J({ signatureImage: null }));
    await pg.route('**/api/expense-reports/9101*', J(EXPENSE));
    await pg.route(u => u.pathname === '/api/settlement-status', J(SS));
};
// html2canvas 가 돌려준 그림을 받아 둔다(워커1의 감싸기 바깥에서) · PDF 저장(내려받기)은 막는다
const RECORD = () => {
    const h = window.html2canvas; window.__caps = [];
    window.html2canvas = async function (el, o) { const c = await h.call(this, el, o); try { window.__caps.push({ w: c.width, h: c.height, url: c.toDataURL('image/png'), attrAfter: document.documentElement.getAttribute('data-ao-theme') || '' }); } catch (e) { window.__caps.push({ err: String(e) }); } return c; };
    if (window.jspdf && window.jspdf.jsPDF) { window.__pdfs = []; window.jspdf.jsPDF.API.save = function (name) { window.__pdfs.push(name); return this; }; }
    window.__guard = /data-ao-theme/.test(String(h)) || h.__aoDarkGuard === true;   // 감싸기가 들어와 있는지(참고 표시)
};
async function run(h, user, dark, tag) {
    const P = await h.open(user, { width: 1440, height: 1000 }, { theme: dark ? 'dark' : null, page: 'document', pages: PAGES, routes });
    const { pg } = P; const names = [], attrs = {};
    const waitCap = async n => { for (let i = 0; i < 80; i++) { if (await pg.evaluate(k => (window.__caps || []).length >= k, n)) return true; await pg.waitForTimeout(250); } return false; };
    await H.navTo(pg, 'document', false); attrs.document = await pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme') || '');
    await pg.evaluate(RECORD);
    for (const [id, nm] of [[9001, '휴가신청서 PDF'], [9002, '재직증명서 PDF'], [9003, '시말서 PDF']]) { const before = names.length; await pg.evaluate(i => window.downloadDocPDF(i), id).catch(e => P.errors.push(nm + ': ' + e.message)); if (await waitCap(before + 1)) names.push(nm); else names.push(nm + '(안 찍힘)'); }
    await H.navTo(pg, 'expense', false); attrs.expense = await pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme') || '');
    { const before = names.length; await pg.evaluate(() => window.downloadExpensePDF(9101)).catch(e => P.errors.push('지출결의: ' + e.message)); names.push(await waitCap(before + 1) ? '지출결의서 PDF' : '지출결의서 PDF(안 찍힘)'); }
    await H.navTo(pg, 'settlement', false);
    await pg.click('.settlement-tab[data-tab="settlement-status"]').catch(() => { }); await pg.waitForTimeout(1500);
    attrs.settlement = await pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme') || '');
    const ssReady = await pg.evaluate(() => { const w = document.getElementById('ss-wrap'), b = document.getElementById('ss-captureBtn'); return !!(w && b && w.getClientRects().length && b.getClientRects().length); });
    if (ssReady) { await pg.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, 0); }); await pg.waitForTimeout(300); if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await pg.screenshot({ path: path.join(SHOT, `569-capture-정산현황-${tag}-화면.png`) }); }
        const before = names.length; await pg.click('#ss-captureBtn').catch(e => P.errors.push('정산현황 캡처: ' + e.message)); names.push(await waitCap(before + 1) ? '정산현황 캡처' : '정산현황 캡처(안 찍힘)'); await pg.waitForTimeout(600); }
    
    const caps = await pg.evaluate(() => (window.__caps || []).map(c => c));
    const guard = await pg.evaluate(() => !!window.__guard);
    const end = await pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme') || '');
    const out = caps.map((c, i) => { if (c.err) return { name: names[i], err: c.err }; const buf = Buffer.from(c.url.split(',')[1], 'base64'); if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); fs.writeFileSync(path.join(SHOT, `569-capture-${i + 1}-${(names[i] || '').replace(/[^가-힣A-Za-z0-9]/g, '')}-${tag}.png`), buf); } return { name: names[i], w: c.w, h: c.h, bytes: buf.length, sha: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16), attrAfter: c.attrAfter }; });
    await P.ctx.close();
    return { out, names, attrs, guard, end, ssReady, errors: P.errors, writes: P.writes };
}
(async () => {
    let h = null;
    try {
        h = await H.start(Number(process.env.PORT569) || 3462, 'cap569');
        const L = await run(h, h.users.대표, false, '밝은'), D = await run(h, h.users.대표, true, '야간');
        const N = L.ssReady ? 5 : 4;
        ok('준비: 정산현황 캡처는 부르는 버튼이 화면에 없어 대상에서 뺌(쓰이지 않는 코드) — 버튼이 생기면 5번째로 같이 비교한다', true, L.ssReady ? '버튼이 생겼음 → 5개 비교' : '#ss-captureBtn 없음 → 4개 비교');
        ok('준비: 밝은 화면에서 ' + N + '개 결과물이 전부 찍힘(휴가신청서·재직증명서·시말서·지출결의서 PDF' + (L.ssReady ? ' · 정산현황 캡처' : '') + ')', L.out.length === N && L.out.every(c => !c.err && c.bytes > 3000) && L.names.every(n => !/안 찍힘|안 보임/.test(n)), L.names.join(' · ') + ' | ' + L.out.map(c => c.err || `${c.w}×${c.h} ${c.bytes}b`).join(' · '));
        ok('준비: 야간 쪽은 세 메뉴에서 켜짐 표시가 붙은 채로 찍음(기안서류·지출결의서·정산관리)', D.attrs.document === 'dark' && D.attrs.expense === 'dark' && D.attrs.settlement === 'dark' && L.attrs.document === '', JSON.stringify(D.attrs));
        ok('준비: 야간 쪽도 ' + N + '개가 전부 찍힘', D.out.length === N && D.out.every(c => !c.err && c.bytes > 3000), D.names.join(' · '));
        for (let i = 0; i < N; i++) { const a = L.out[i], b = D.out[i]; const nm = (L.names[i] || '?'); ok(`${i + 1} ${nm}: 야간에서 찍은 그림 = 밝은 화면에서 찍은 그림(PNG 바이트 동일)`, !!a && !!b && !a.err && !b.err && a.sha === b.sha && a.w === b.w && a.h === b.h, a && b ? `밝은 ${a.w}×${a.h} ${a.bytes}b ${a.sha} · 야간 ${b.w}×${b.h} ${b.bytes}b ${b.sha}` : '없음'); }
        ok('찍은 뒤에도 보이는 화면은 야간 그대로(찍는 동안 화면을 밝게 바꾸지 않음)', D.end === 'dark' && D.out.every(c => c.attrAfter === 'dark'), `끝 ${D.end} · 찍은 직후 ${D.out.map(c => c.attrAfter || '없음').join(',')}`);
        ok('화면 오류 0 · 쓰기 요청은 전부 가로챔', L.errors.length + D.errors.length === 0, [...L.errors, ...D.errors].slice(0, 4).join(' | ') || `가로챈 쓰기 ${L.writes.length + D.writes.length}건`);
        console.log('ℹ️ html2canvas 감싸기(야간 속성 떼기) 감지: ' + (D.guard ? '있음' : '못 찾음(함수 글자에 data-ao-theme 없음 — 다른 방식이면 무시)'));
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 6).join(' / ') : String(e)); }
    finally { if (h) await h.stop(); const pass = results.filter(r => r.pass).length; console.log(`\n결과: ${pass}/${results.length}`); setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300); }
})();
