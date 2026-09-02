// #423 검증: 지출결의서 결재 대기 탭 — 체크박스 일괄 승인 (2026-09-02)
// 로컬 실서버 + Playwright 실클릭. 🔴 승인 PUT은 라우트 가로채기 = 실DB 결재 무변경(#397 방식).
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path');

const PORT = 3457;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass, note }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };

(async () => {
    let srv = null, browser = null;
    try {
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: 'ignore' });
        let up = false;
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { }
        }
        ok('로컬 실서버 기동', up);
        if (!up) throw new Error('서버 기동 실패');

        // 대표 계정 실 id 조회 (pending 목록이 대표 기준으로 나오게)
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' LIMIT 1`)).rows[0];
        const pendCnt = Number((await db.query(
            `SELECT count(*) FROM expense_reports WHERE (status='manager_approved' OR (status='pending' AND manager_id IS NULL)) `)).rows[0].count);
        await db.end();
        ok('대표 계정·대기 건 확인', !!ceo && pendCnt >= 2, `대기 후보 ${pendCnt}건`);

        const token = jwt.sign({ id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, 'verifytest', { expiresIn: '15m' });
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const pg = await browser.newPage();
        const errors = []; const approved = [];
        pg.on('pageerror', e => errors.push(String(e)));
        pg.on('dialog', d => d.accept());   // confirm 자동 수락 (#395 교훈: evaluate 내 click은 confirm이 조용히 거부됨)
        // 🔴 승인 PUT 가로채기 — 실DB 결재 무변경
        await pg.route('**/api/expense-reports/*/approve', route => {
            const m = route.request().url().match(/expense-reports\/(\d+)\/approve/);
            if (m) approved.push(Number(m[1]));
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
        });
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [token, { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }]);
        await pg.reload({ waitUntil: 'networkidle' });
        await pg.waitForTimeout(2500);
        // 프론트 주기 폴링 정지(테스트 한정) — 목록 재렌더가 체크 상태와 경합해 거짓 실패를 내는 것 차단
        await pg.evaluate(() => { const h = setInterval(() => {}, 1e9); for (let i = 1; i <= h; i++) clearInterval(i); });
        await pg.evaluate(() => switchPage('expense'));
        await pg.waitForTimeout(500);
        // 결재 대기 탭 클릭 (실클릭)
        await pg.evaluate(() => {
            const tabs = [...document.querySelectorAll('.tab-btn, [data-tab], button, a')].filter(e => e.textContent.trim() === '결재 대기');
            if (tabs[0]) tabs[0].click();
        });
        await pg.waitForFunction(() => document.querySelectorAll('#expense-pending-list tr:not(.empty-row)').length > 0, null, { timeout: 15000 });

        const state = await pg.evaluate(() => ({
            rows: document.querySelectorAll('#expense-pending-list tr').length,
            checks: document.querySelectorAll('#expense-pending-list .expense-pending-check').length,
            checkAllVisible: document.getElementById('expense-pending-check-all').style.display !== 'none',
            batchVisible: document.getElementById('expense-pending-batch-approve').style.display !== 'none',
            singleBtns: document.querySelectorAll('#expense-pending-list .btn-primary').length,
            headCols: document.querySelectorAll('#expense-section-pending thead th').length,
        }));
        ok('행마다 체크박스 + 전체선택·[선택 승인] 노출', state.checks === state.rows && state.checkAllVisible && state.batchVisible, JSON.stringify(state));
        ok('무회귀: 개별 [승인] 버튼·헤더 7칸 유지', state.singleBtns === state.rows && state.headCols === 7);

        // 전체선택 토글 실클릭
        await pg.click('#expense-pending-check-all');
        const allChecked = await pg.evaluate(() => [...document.querySelectorAll('.expense-pending-check')].every(c => c.checked));
        await pg.click('#expense-pending-check-all');
        const allUnchecked = await pg.evaluate(() => [...document.querySelectorAll('.expense-pending-check')].every(c => !c.checked));
        ok('전체선택 체크/해제 동작', allChecked && allUnchecked);

        // 부분 선택(2건) → [선택 승인] 실클릭 → 가로챈 PUT = 정확히 그 2건 (체크도 실클릭 — 재렌더 경합 회피)
        await pg.locator('.expense-pending-check').nth(0).check();
        await pg.locator('.expense-pending-check').nth(1).check();
        const picked = await pg.evaluate(() =>
            [...document.querySelectorAll('.expense-pending-check:checked')].map(c => Number(c.value)));
        await pg.click('#expense-pending-batch-approve');
        await pg.waitForTimeout(1500);
        ok('부분 선택 승인 = 체크한 2건만 PUT', approved.length === 2 && picked.every(id => approved.includes(id)), JSON.stringify({ picked, approved }));

        // 선택 0건이면 안내만 (PUT 0)
        approved.length = 0;
        await pg.waitForFunction(() => document.querySelectorAll('#expense-pending-list tr').length > 0, null, { timeout: 15000 });   // 재렌더 대기
        await pg.click('#expense-pending-batch-approve');
        await pg.waitForTimeout(800);
        ok('선택 0건 = 승인 호출 0(안내만)', approved.length === 0);

        // 전체선택 → 승인 = 전 행 PUT
        approved.length = 0;
        await pg.click('#expense-pending-check-all');
        const total = await pg.evaluate(() => document.querySelectorAll('.expense-pending-check').length);
        await pg.click('#expense-pending-batch-approve');
        await pg.waitForTimeout(2500);
        ok('전체선택 승인 = 전 행 PUT', approved.length === total && total > 0, `${approved.length}/${total}`);
        ok('JS 에러 0', errors.length === 0, errors.join(' | ').slice(0, 200));
    } catch (err) {
        ok('실행', false, String(err.message || err).slice(0, 300));
    } finally {
        try { if (browser) await browser.close(); } catch (_) { }
        try { if (srv) srv.kill(); } catch (_) { }
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
