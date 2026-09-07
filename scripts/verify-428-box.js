// #428-b 검증: 박스재고 선물용 3kg·5kg 차감 복원 — 로컬 실서버(3457·스케줄러 차단) + 실DB + 실렌더 (코드 무변경 · 데이터 교정 검산)
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path');
const PORT = 3457;
let pass = 0, fail = 0;
const ok = (name, c, note) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + name + (note ? ' — ' + note : '')); };
// 기대값 = 실DB 정산(대성) 9/1 #367·9/2 #368·9/3 #371·9/4 #372·9/6 #374·9/7 #377 (8/31 #364 = 기준일 당일 → 제외 규칙). 업체 = 입고 − 대성이동, 대성 = 이동 − 정산
//   ⚠️ 날짜 함정: DATE 컬럼을 toISOString().slice(0,10)으로 찍으면 KST 프로세스에서 하루 전으로 보인다(1차 기대값 오산의 원인) — 서버 normDateSafe(로컬 getter)가 정본.
const EXP = { '선물용 박스 3kg': { company: 3000 - 1500, daesong: 1500 - (4 + 4 + 9 + 11 + 6 + 1) }, '선물용 박스 5kg': { company: 3150 - 1500, daesong: 1500 - (7 + 6 + 2 + 1 + 5 + 4) } };
(async () => {
    let srv = null, browser = null;
    try {
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
        let up = false;
        for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } if (srv.exitCode !== null) break; }
        ok('로컬 실서버 기동', up, up ? '' : log.slice(-300));
        if (!up) throw new Error('서버 기동 실패');
        await new Promise(r => setTimeout(r, 2500));
        const token = jwt.sign({ id: 1, name: 'verify428', role: 'admin' }, 'verifytest', { expiresIn: '10m' });
        const H = { Authorization: 'Bearer ' + token };
        const inv = await (await fetch(`http://localhost:${PORT}/api/box-inventory`, { headers: H })).json();
        ok('API: 8종', inv.length === 8, inv.map(b => `${b.productName} 업체${b.companyStock}/대성${b.daesongStock}`).join(' · '));
        for (const [nm, e] of Object.entries(EXP)) {
            const b = inv.find(x => x.productName === nm);
            ok(`API: ${nm} 대성 재고 = 이동 1,500 − 정산 차감 = ${e.daesong}`, !!b && b.daesongStock === e.daesong, b && String(b.daesongStock));
            ok(`API: ${nm} 업체 재고 ${e.company} 무변동`, !!b && b.companyStock === e.company, b && String(b.companyStock));
        }
        // 입출고현황 — 선물용 미매칭 정산 품목 0
        const hist = await (await fetch(`http://localhost:${PORT}/api/box-inventory/history?from=2026-08-30&to=2026-09-07`, { headers: H })).json().catch(() => ({}));
        const un = (hist.unmatchedItems || []).filter(u => /황금향 선물용/.test(u.name));
        ok('입출고현황: 황금향 선물용 미매칭 정산 품목 0', un.length === 0, un.length ? un.slice(0, 5).map(u => u.date + ' ' + String(u.name).slice(-20)).join(' | ') : '없음');
        // 실렌더
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const pg = await browser.newPage();
        const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 80))); pg.on('dialog', d => d.accept());
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, name: 'verify428', role: 'admin' })); }, [token]);
        await pg.reload({ waitUntil: 'networkidle' });
        await pg.waitForTimeout(2500);
        await pg.evaluate(() => switchPage('inventory'));
        try { await pg.waitForFunction(() => document.querySelectorAll('#box-inventory-grid .leave-summary-card').length >= 8, null, { timeout: 8000 }); }
        catch (_) { await pg.evaluate(() => renderBoxInventory()); await pg.waitForFunction(() => document.querySelectorAll('#box-inventory-grid .leave-summary-card').length >= 8, null, { timeout: 8000 }).catch(() => {}); }   // #420 초기화 경합 재시도
        const cards = await pg.evaluate(() => [...document.querySelectorAll('#box-inventory-grid .leave-summary-card')].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
        const card = nm => cards.find(c => c.includes(nm)) || '';
        const hasV = (nm, v) => new RegExp('대성\\(시온\\)\\s*' + String(v) + '(?!\\d)').test(card(nm)) || card(nm).includes('대성(시온)' + v.toLocaleString());   // 카드는 천단위 구분 없이 표기
        ok('실렌더: 선물용 박스 3kg 카드에 대성 ' + EXP['선물용 박스 3kg'].daesong.toLocaleString(), hasV('선물용 박스 3kg', EXP['선물용 박스 3kg'].daesong), card('선물용 박스 3kg').slice(0, 140));
        ok('실렌더: 선물용 박스 5kg 카드에 대성 ' + EXP['선물용 박스 5kg'].daesong.toLocaleString(), hasV('선물용 박스 5kg', EXP['선물용 박스 5kg'].daesong), card('선물용 박스 5kg').slice(0, 140));
        ok('실렌더: 카드 8장·기존 6종 존재(무회귀)', cards.length === 8 && ['귤 박스 3kg', '귤 박스 5kg', '귤 박스 10kg', '만감 박스 3kg', '만감 박스 5kg', '만감 박스 10kg'].every(n => cards.some(c => c.includes(n))), cards.length + '장');
        ok('pageerror 0', errs.length === 0, errs.join(' | ') || '없음');
    } catch (e) { ok('예외 없음', false, e.message.slice(0, 120)); }
    finally { if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail === 0 ? 0 : 1);
})();
