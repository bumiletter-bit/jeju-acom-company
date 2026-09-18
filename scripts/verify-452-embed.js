// #452-p 검증: 회사프로그램 「송장변환」 메뉴 = v2 iframe — 로컬 실서버 + Playwright 실클릭
//   ① 메뉴 진입 → iframe 로드(?embed=1) · 구버전 숨김 · app.js 구버전 요소는 남아 있어 초기화 에러 0
//   ② 프레임 안: 파일 업로드 → 미리보기 N행 · 붙여넣기 저장 → 표 · 다운로드(2시트) · 중간발주 탭 집계(훅) · 토글 반영
//   ③ 다른 메뉴 왕복 후 송장변환 상태 유지(프레임 재로드 없음) · iframe 높이 자동 확장 · #invoice-legacy 해시 → 구버전 노출/복귀
//   ④ 무회귀 스모크: 다른 페이지 5곳 전환 · pageerror 0
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn } = require('child_process');
const jwt = require('jsonwebtoken'); const XLSX = require('xlsx-js-style');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 200) : '')); };
const PORT = 3459, BASE = `http://localhost:${PORT}`;
const XLS = process.argv[2] || 'C:/Users/전승범/Downloads/스마트스토어_전체주문발주발송관리_20260918_0926.xlsx';
const USER = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' };
const TOKEN = jwt.sign(USER, 'verifytest', { expiresIn: '1h' });
(async () => {
    if (!fs.existsSync(XLS)) { console.log('원본 파일 없음 — 중단'); process.exit(1); }
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/public/version')).ok) break; } catch (_) { } await new Promise(r => setTimeout(r, 1000)); }
        const wb0 = XLSX.readFile(XLS); const aoa = XLSX.utils.sheet_to_json(wb0.Sheets[wb0.SheetNames[0]], { header: 1, raw: true }); const hdrIdx = aoa.findIndex(r => Array.isArray(r) && r.includes('상품주문번호'));
        const N = aoa.slice(hdrIdx + 1).filter(r => Array.isArray(r) && r.some(v => v != null && v !== '')).length;
        const { chromium } = require('playwright'); const br = await chromium.launch(); const ctx = await br.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
        await ctx.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [TOKEN, USER]);
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
        await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(2500);
        // ① 진입
        const loadedBefore = await pg.evaluate(() => document.getElementById('invoice-v2-frame').dataset.loaded || '');
        ok(loadedBefore === '', '① 진입 전엔 iframe 미로드(다른 메뉴에 부담 0)', loadedBefore);
        await pg.evaluate(() => switchPage('invoice')); await pg.waitForTimeout(500);
        await pg.waitForFunction(() => { const f = document.getElementById('invoice-v2-frame'); return f && /invoice-v2\.html\?embed=1/.test(f.src) && f.contentWindow && f.contentWindow.__ivt; }, null, { timeout: 30000 });
        const fr = pg.frameLocator('#invoice-v2-frame'); const frame = pg.frames().find(f => /invoice-v2\.html/.test(f.url()));
        ok(!!frame, '① 송장변환 메뉴 진입 → v2 iframe 로드(?embed=1)', frame && frame.url());
        const vis = await pg.evaluate(() => ({ legacy: getComputedStyle(document.getElementById('page-invoice-legacy')).display, wrap: getComputedStyle(document.getElementById('invoice-v2-wrap')).display, mergeBtn: !!document.getElementById('invoice-merge-btn'), qtyStart: !!document.getElementById('invoice-qty-start') }));
        ok(vis.legacy === 'none' && vis.wrap !== 'none' && vis.mergeBtn && vis.qtyStart, '① 구버전 숨김 · 구버전 요소는 DOM에 남아 app.js 초기화 무사', JSON.stringify(vis));
        const emb = await frame.evaluate(() => ({ embed: document.body.classList.contains('embed'), h1: getComputedStyle(document.querySelector('#page-invoice-test > h1')).display }));
        ok(emb.embed && emb.h1 === 'none', '① embed 모드: 안쪽 제목 숨김(바깥 「송장변환」 제목만)', JSON.stringify(emb));
        // ② 프레임 안 실사용
        await fr.locator('#file-naver').setInputFiles(XLS);
        await frame.waitForFunction(n => document.querySelectorAll('#preview tbody tr').length === n, N, { timeout: 30000 });
        ok(true, '② 프레임 안 파일 업로드 → 미리보기 행수 = 원본', N);
        const shipIso = await frame.evaluate(() => document.getElementById('ship-date').dataset.iso);
        ok(/^\d{4}-\d{2}-\d{2}$/.test(shipIso), '② 기준 발송일 계산·표시', shipIso);
        const usd = `${+shipIso.slice(5, 7)}/${+shipIso.slice(8, 10)}/${shipIso.slice(2, 4)}`;
        const tel = await frame.evaluate(() => { const e = __ivt.S.merged.find(e => e.ch === 'naver' && (e.conv['구매자연락처'] || '').replace(/\D/g, '').length === 11 && !/^0100000/.test((e.conv['구매자연락처'] || '').replace(/\D/g, ''))); return e ? e.conv['구매자연락처'] : ''; });
        await fr.locator('#ln-all').fill(`${usd}\t${tel}\t입력o삭제x\t네이버`); await fr.locator('#save-all').click(); await pg.waitForTimeout(100); await frame.waitForFunction(() => !document.getElementById('save-all').disabled); await pg.waitForTimeout(300);
        const res = await frame.evaluate(() => ({ rows: document.querySelectorAll('#res-all tbody tr').length, ok: /확인완료/.test(document.getElementById('res-all').textContent), indiv: __ivt.S.merged.filter(e => e.individual).length }));
        ok(res.rows >= 1 && res.ok && res.indiv >= 1, '② 붙여넣기 저장 → 결과 표 · 개별발송 분류', JSON.stringify(res));
        const dl = pg.waitForEvent('download'); await fr.locator('#btn-download').click(); const d = await dl; const f1 = path.join(os.tmpdir(), 'ivt-embed.xlsx'); await d.saveAs(f1);
        const w1 = XLSX.readFile(f1); const s1n = XLSX.utils.sheet_to_json(w1.Sheets.Sheet1, { header: 1 }).length - 1;
        ok(w1.SheetNames.join(',') === 'Sheet1,발주발송관리' && s1n > 0 && s1n < N, '② 프레임 안 다운로드 → 2시트(시트1 = 전체 − 개별 − 제외)', `${w1.SheetNames} · 시트1 ${s1n}행`);
        // 중간발주 탭(프레임)
        await fr.locator('#ivt-mode-qty').click(); await pg.waitForTimeout(200);
        const rowsN = await frame.evaluate(() => __ivt.S.naver.rows); await frame.evaluate(rows => __ivt.setQRows(rows, [], []), rowsN);
        await frame.waitForFunction(() => document.querySelectorAll('#invoice-qty-list .qty-row').length > 0, null, { timeout: 20000 });
        const q0 = await frame.evaluate(() => ({ total: __ivt.qtyTotal(), rows: document.querySelectorAll('#invoice-qty-list .qty-row').length, filter: document.querySelectorAll('#qty-partner-filter button').length }));
        const chk = fr.locator('#qreview input[type=checkbox]:checked').first(); if (await chk.count()) await chk.click(); await pg.waitForTimeout(200);
        const q1 = await frame.evaluate(() => __ivt.qtyTotal());
        ok(q0.rows > 0 && q0.filter === 4 && q1 >= q0.total, '② 중간발주 탭(프레임): 집계 렌더·거래처 필터·체크 토글 반영', JSON.stringify({ ...q0, after: q1 }));
        await fr.locator('#ivt-mode-convert').click();
        // ③ 메뉴 왕복 → 상태 유지 · 높이 · 레거시 해시
        await pg.evaluate(() => switchPage('pricing')); await pg.waitForTimeout(800); await pg.evaluate(() => switchPage('invoice')); await pg.waitForTimeout(800);
        const keep = await pg.evaluate(() => { const f = document.getElementById('invoice-v2-frame'); return { same: /invoice-v2\.html\?embed=1$/.test(f.src), n: f.contentWindow.__ivt ? f.contentWindow.__ivt.S.merged.length : -1, h: parseInt(f.style.height) || 0 }; });
        ok(keep.same && keep.n === N && keep.h > 600, '③ 다른 메뉴 다녀와도 프레임 재로드 없이 상태 유지 · iframe 높이 자동 확장', JSON.stringify(keep));
        await pg.evaluate(() => { location.hash = '#invoice-legacy'; }); await pg.waitForTimeout(300);
        const leg = await pg.evaluate(() => ({ legacy: getComputedStyle(document.getElementById('page-invoice-legacy')).display, wrap: getComputedStyle(document.getElementById('invoice-v2-wrap')).display, btn: !!document.querySelector('#page-invoice-legacy #invoice-merge-btn') }));
        await pg.evaluate(() => { location.hash = ''; }); await pg.waitForTimeout(300);
        const leg2 = await pg.evaluate(() => ({ legacy: getComputedStyle(document.getElementById('page-invoice-legacy')).display, wrap: getComputedStyle(document.getElementById('invoice-v2-wrap')).display }));
        ok(leg.legacy === 'block' && leg.wrap === 'none' && leg.btn && leg2.legacy === 'none' && leg2.wrap !== 'none', '③ #invoice-legacy 해시 → 구버전 노출(비상용) · 해시 제거 → v2 복귀', JSON.stringify({ leg, leg2 }));
        // ④ 무회귀 스모크
        for (const p of ['schedule', 'pricing', 'inquiry', 'inventory', 'settlement', 'organizer', 'invoice']) { await pg.evaluate(n => switchPage(n), p); await pg.waitForTimeout(600); }
        const active = await pg.evaluate(() => (document.querySelector('.page.active') || {}).id);
        ok(active === 'page-invoice', '④ 다른 메뉴 5곳 전환 후 송장변환 복귀', active);
        ok(errs.length === 0, '④ pageerror·console error 0(바깥 페이지 + 프레임)', errs.join(' | ').slice(0, 300));
        await br.close();
    } finally { srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
