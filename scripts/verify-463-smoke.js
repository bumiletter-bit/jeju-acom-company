// #463 검증: 송장변환 구버전 코드 제거 뒤 — 전 메뉴 순회 스모크(로컬 3457 서버가 떠 있어야 함 · 읽기만)
//   ① app.js 끝까지 실행(뒤쪽 전역 존재) ② 구버전 전역·요소 0 ③ 메뉴 전부 switchPage → 그 페이지가 active ④ pageerror·console error 0
//   ⑤ 실번들에 구버전 심볼 0 · v2 슬라이스 표식 4개 존재(v2가 app.js를 잘라 쓰는 경계)
const { chromium } = require('playwright'); const jwt = require('jsonwebtoken'); const fs = require('fs'); const path = require('path');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 260) : '')); };
const BASE = 'http://localhost:3457';
const TOKEN = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
(async () => {
    const src = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const gone = ['invoiceDataSmart', 'setupInvoiceArea', 'updateInvoiceMergeBtn', 'showInvoiceMergedPreview', 'recheckCoupangCancellations', 'switchInvoiceMode', 'invoice-merge-btn', 'invoice-auto-smart'].filter(w => src.includes(w));
    ok(gone.length === 0, '⑤ app.js에 구버전 화면 심볼 0', gone.join(','));
    const marks = ['function detectSize(msg)', '// 채널 초기화', 'let qtyAggregated = [];', 'window.resetInvoiceQty = resetInvoiceQty;'].map(m => src.indexOf(m));
    ok(marks.every(i => i > 0) && marks[0] < marks[1] && marks[1] < marks[2] && marks[2] < marks[3], '⑤ v2 슬라이스 표식 4개 순서대로 존재', marks.join(' < '));
    const br = await chromium.launch(); const ctx = await br.newContext();
    await ctx.addInitScript(([t]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' })); localStorage.removeItem('akm_last_page'); }, [TOKEN]);
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); }); pg.on('dialog', d => d.dismiss().catch(() => { }));
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(3500);
    const g = await pg.evaluate(() => ({ tail: typeof window.resetInvoiceQty === 'function' && typeof switchPage === 'function' && typeof formatDate === 'function' && typeof init === 'function', oldFn: [typeof window.resetInvoice, typeof window.switchInvoiceMode].join('/'), oldEl: ['page-invoice-legacy', 'invoice-merge-btn', 'invoice-qty-start', 'invoice-upload-smart'].filter(id => document.getElementById(id)).join(','), app: (document.getElementById('app') || document.querySelector('.main-content')) ? 'shown' : 'none' }));
    ok(g.tail, '① app.js 끝까지 실행(송장 구간 뒤의 전역 formatDate·init·resetInvoiceQty 존재)', JSON.stringify(g));
    ok(g.oldFn === 'undefined/undefined' && g.oldEl === '', '② 구버전 전역 함수·요소 0', g.oldFn + ' · ' + (g.oldEl || '없음'));
    const pages = await pg.evaluate(() => Array.from(document.querySelectorAll('.page[id^="page-"]')).map(p => p.id.replace(/^page-/, '')));
    const bad = [];
    for (const p of pages) { const before = errs.length; const act = await pg.evaluate(n => { try { switchPage(n); } catch (e) { return 'throw:' + e.message; } const a = document.querySelector('.page.active'); return a ? a.id : 'none'; }, p); await pg.waitForTimeout(700); if (errs.length > before || /^throw/.test(act)) bad.push(p + '(' + act + ')'); }
    ok(bad.length === 0, `③ 메뉴 ${pages.length}곳 순회 — 전환 중 오류 0`, bad.join(', ') || pages.join(' '));
    await pg.evaluate(() => switchPage('invoice')); const fr = await pg.waitForFunction(() => { const f = document.getElementById('invoice-v2-frame'); return f && f.contentWindow && f.contentWindow.__ivt; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    const v2 = fr ? await pg.evaluate(() => { const w = document.getElementById('invoice-v2-frame').contentWindow; return { conv: !!w.document.getElementById('btn-naver'), qty: !!w.document.getElementById('ivt-qty-start'), sender: !!w.IvtSender }; }) : {};
    ok(fr && v2.conv && v2.qty && v2.sender, '③ 송장변환 메뉴 = v2 정상 기동(app.js 슬라이스 실행 성공 · 불러오기/중간발주 버튼 · 보내는이 해석기)', JSON.stringify(v2));
    ok(errs.length === 0, '④ pageerror·console error 0', errs.slice(0, 3).join(' | '));
    await br.close(); console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
