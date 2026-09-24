// #468-c 디자인 점검용 스크린샷(폰 폭 430px · 데스크톱 1200px) — 로컬 실서버 + 가짜 대조 행 주입(실DB 무변경). 결과 = scripts/_shot-468-*.png(미커밋)
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path');
const PORT = 3457;
(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: 'ignore' });
    let browser = null;
    try {
        for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) break; } catch (_) { } }
        const { Client } = require('pg'); const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' LIMIT 1`)).rows[0]; await db.end();
        const token = jwt.sign({ id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, 'verifytest', { expiresIn: '15m' });
        const { chromium } = require('playwright'); browser = await chromium.launch();
        const fake = { today: '2026-09-24', rows: [
            { expect_date: '2026-09-18', basis_start: '2026-09-17', basis_end: '2026-09-17', complete_date: '2026-09-18', pay_amount: 34286100, commission: -2297807, benefit: -77700, return_care: -20000, deduction: 0, settle_amount: 31890593, in_period: 32054707, in_period_count: 651, carried_in: 0, carried_in_count: 0, unknown_amount: 0, unknown_count: 0, pending_out_count: 1, reversal: -66414, reversal_count: 2, input_sum: 34810387, input_dates: [{ date: '2026-09-17', scheduled: 34810387, unsettled: 0, used: true }], diff1: 2755680, status: 'warn', detail: {} },
            { expect_date: '2026-09-21', basis_start: '2026-09-18', basis_end: '2026-09-20', complete_date: '2026-09-21', pay_amount: 68035900, commission: -4494017, benefit: -230900, return_care: -61350, deduction: -6700, settle_amount: 63242933, in_period: 63344158, in_period_count: 1200, carried_in: 329872, carried_in_count: 2, unknown_amount: 0, unknown_count: 0, pending_out_count: 1, reversal: -132147, reversal_count: 4, input_sum: 63914574, input_dates: [{ date: '2026-09-18', scheduled: 23327884, unsettled: 292915 }, { date: '2026-09-20', scheduled: 23317068, unsettled: 40597506, used: true }], diff1: 570416, status: 'ok', detail: {} },
        ] };
        for (const [w, tag] of [[430, 'mobile'], [1200, 'desktop']]) {
            const ctx = await browser.newContext({ viewport: { width: w, height: 1400 }, deviceScaleFactor: 2 });
            const pg = await ctx.newPage();
            await pg.route('**/api/agent-office/settle-recon*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fake) }));
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [token, { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }]);
            await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(2500);
            await pg.evaluate(() => { const nav = document.querySelector('.nav-item[data-page="settlement"]'); nav && nav.click(); }); await pg.waitForTimeout(400);
            await pg.evaluate(() => { const tb = document.querySelector('.settlement-tab[data-tab="settlement-status"]'); tb && tb.click(); });
            await pg.waitForFunction(() => document.querySelectorAll('#ss-cal-wrap .ss-cal-cell').length > 20, null, { timeout: 15000 });
            for (const d of ['2026-09-17', '2026-09-20']) {
                await pg.evaluate((x) => ssSelectDate(x), d); await pg.waitForTimeout(500);
                const el = await pg.$('#ss-recon-card');
                await el.screenshot({ path: path.join(__dirname, `_shot-468-${tag}-${d.slice(5)}.png`) });
            }
            await ctx.close();
        }
        console.log('done');
    } catch (e) { console.error('ERR', e.message); }
    finally { if (browser) await browser.close(); srv.kill(); }
})();
