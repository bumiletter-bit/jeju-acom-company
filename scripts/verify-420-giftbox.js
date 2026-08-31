// #420 검증: 박스재고 「선물용 박스 3kg·5kg」 추가 (2026-08-31)
// 로컬 실서버(3457·스케줄러 차단) + 실DB + Playwright 실렌더 — 기존 6종 무회귀 포함.
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const PORT = 3457;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass, note }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };

(async () => {
    let srv = null, browser = null;
    try {
        // ── 0. 실삽입 검산
        const sj = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        const aj = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
        ok('서버 시드 2종', sj.includes(`'선물용 박스 3kg', '선물용 박스 5kg'`));
        ok('BOX_OPTIONS 2종', aj.includes(`value: '선물용 박스 3kg'`) && aj.includes(`value: '선물용 박스 5kg'`));
        ok('배지 색상(선물=보라)', aj.includes(`boxType.indexOf('선물') === 0`));
        ok('캐시 v=378', fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').includes('app.js?v=378'));

        // ── 1. 로컬 실서버 (initDB가 시드 삽입)
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
        let srvLog = ''; srv.stdout.on('data', d => srvLog += d); srv.stderr.on('data', d => srvLog += d);
        let up = false;
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { }
            if (srv.exitCode !== null) break;
        }
        ok('로컬 실서버 기동', up, up ? '' : srvLog.slice(-300));
        if (!up) throw new Error('서버 기동 실패');
        await new Promise(r => setTimeout(r, 3000));   // initDB 시드 대기

        // ── 2. API: 8종 + 선물용 2종(재고 0 시작) + 기존 6종 무회귀
        const token = jwt.sign({ id: 1, name: 'verify420', role: 'admin' }, 'verifytest', { expiresIn: '10m' });
        const H = { Authorization: 'Bearer ' + token };
        const inv = await (await fetch(`http://localhost:${PORT}/api/box-inventory`, { headers: H })).json();
        const names = inv.map(b => b.productName);
        ok('API: 총 8종', inv.length === 8, names.join(' / '));
        const g3 = inv.find(b => b.productName === '선물용 박스 3kg'), g5 = inv.find(b => b.productName === '선물용 박스 5kg');
        ok('API: 선물용 2종 존재·재고 0 시작', !!g3 && !!g5 && (g3.companyStock + g3.daesongStock + (g3.hyodonStock || 0)) === 0 && (g5.companyStock + g5.daesongStock + (g5.hyodonStock || 0)) === 0);
        ok('API: 기존 6종 무회귀', ['귤 박스 3kg', '귤 박스 5kg', '귤 박스 10kg', '만감 박스 3kg', '만감 박스 5kg', '만감 박스 10kg'].every(n => names.includes(n)));

        // ── 3. 실렌더 (Playwright): 카드 8장·선물용 카드 양식 동일·이력 필터·에러 0
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const pg = await browser.newPage();
        const errors = []; const clogs = [];
        pg.on('pageerror', e => errors.push(String(e)));
        pg.on('console', m => { if (m.type() === 'error') clogs.push(m.text()); });
        pg.on('dialog', d => d.accept());
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, name: 'verify420', role: 'admin' })); }, [token]);
        await pg.reload({ waitUntil: 'networkidle' });
        await pg.waitForTimeout(2500);   // 자동 로그인·앱 초기화 완료 대기
        await pg.evaluate(() => switchPage('inventory'));
        try {
            await pg.waitForFunction(() => document.querySelectorAll('#box-inventory-grid .leave-summary-card').length >= 8, null, { timeout: 8000 });
        } catch (_) {
            await pg.evaluate(() => renderBoxInventory());   // 초기화 경합 재시도
            try { await pg.waitForFunction(() => document.querySelectorAll('#box-inventory-grid .leave-summary-card').length >= 8, null, { timeout: 8000 }); } catch (_2) { }
            const diag = await pg.evaluate(() => ({
                page: document.querySelector('#page-inventory')?.classList.contains('active'),
                gridLen: document.getElementById('box-inventory-grid')?.innerHTML.length,
                cards: document.querySelectorAll('#box-inventory-grid .leave-summary-card').length,
                user: typeof currentUser !== 'undefined' && currentUser ? currentUser.role : null,
                dataLen: typeof boxInventoryData !== 'undefined' ? boxInventoryData.length : -1
            }));
            console.log('진단:', JSON.stringify(diag), '| 콘솔에러:', clogs.join(' | ').slice(0, 300));
        }
        const cardCount = await pg.evaluate(() => document.querySelectorAll('#box-inventory-grid .leave-summary-card').length);
        ok('실렌더: 카드 8장', cardCount === 8, String(cardCount));
        const giftCard = await pg.evaluate(() => {
            const c = [...document.querySelectorAll('#box-inventory-grid .leave-summary-card')].find(x => x.textContent.includes('선물용 박스 3kg'));
            if (!c) return null;
            return { labels: ['총 재고', '업체재고', '대성(시온)', '효돈'].every(l => c.textContent.includes(l)), clickable: c.classList.contains('box-card-clickable'), editable: c.querySelectorAll('.box-editable').length };
        });
        ok('실렌더: 선물용 카드 양식 동일(4칸·클릭 이력·admin 편집 3칸)', !!giftCard && giftCard.labels && giftCard.clickable && giftCard.editable === 3, JSON.stringify(giftCard));
        const histOpts = await pg.evaluate(() => [...document.querySelectorAll('#box-hist-product option')].map(o => o.value));
        ok('실렌더: 입출고 필터에 선물용 2종', histOpts.includes('선물용 박스 3kg') && histOpts.includes('선물용 박스 5kg'), histOpts.length + '개 옵션');
        // 입고/이동 등록 모달의 박스 선택에도 포함되는지
        await pg.evaluate(() => document.getElementById('box-movement-btn').click());
        await pg.waitForTimeout(500);
        const modalHasGift = await pg.evaluate(() => {
            const sels = [...document.querySelectorAll('select')];
            return sels.some(s => [...s.options].some(o => o.value === '선물용 박스 5kg'));
        });
        ok('실렌더: 입고/이동 등록 선택지에 선물용', modalHasGift);
        ok('실렌더: JS 에러 0', errors.length === 0, errors.join(' | ').slice(0, 200));
    } catch (err) {
        ok('실행', false, String(err.message || err));
    } finally {
        try { if (browser) await browser.close(); } catch (_) { }
        try { if (srv) srv.kill(); } catch (_) { }
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        process.exit(pass === results.length ? 0 : 1);
    }
})();
