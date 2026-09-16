// #450-c 검증: 추석 쿠폰 = 시기 지식(09-10~09-20) — local: 톡톡 채널 API에 [오늘 시기] 쿠폰 주입·#60 추석 줄 0 / sim: 실AI 날짜 시뮬(오늘 vs 9/22)
//   사용: node scripts/verify-450c-coupon.js local | sim
require('dotenv').config();
const path = require('path'); const { spawn } = require('child_process'); const { Pool } = require('pg');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 240) : '')); };
const MODE = process.argv[2] || 'local'; const PORT = 3457;
async function waitUp() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${PORT}/api/public/version`); if (r.ok) return; } catch (_) { } await new Promise(r => setTimeout(r, 1000)); } throw new Error('server not up'); }
(async () => {
    if (MODE === 'local') {
        const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', SCENARIO_API_TOKEN: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
        try {
            await waitUp();
            const talk = await (await fetch(`http://localhost:${PORT}/api/scenarios?channel=talktalk`, { headers: { Authorization: 'Bearer verifytest' } })).json();
            const T = talk.scenarios || talk;
            const k = T.find(s => /\[오늘 시기\] 쿠폰 — 추석맞이 2026/.test(s.name));
            ok(!!k && /9월 21일\(월\) 오전 8시까지/.test(k.response) && /2,000원/.test(k.response), '오늘(9/16) 톡톡 재료에 [오늘 시기] 쿠폰 — 추석맞이 2026 주입', k && k.name);
            const s60 = T.find(s => s.scenario_no === 60);
            ok(s60 && !/추석/.test(s60.response) && /알림받기 쿠폰 1,000원/.test(s60.response) && /VVIP/.test(s60.response), '#60 본문: 추석 줄 0·알림받기·등급 유지');
        } finally { srv.kill(); }
    } else {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        async function runner(reqKey, resKey, req, ms = 300000) {
            await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]);
            await pool.query(`INSERT INTO agent_office_config (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [reqKey, JSON.stringify(req)]);
            const t0 = Date.now();
            while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 5000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key=$1`, [resKey]); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]); return q.rows[0].value; } }
            throw new Error('runner timeout');
        }
        const cases = [
            { q: '지금 쓸 수 있는 할인 쿠폰 있어요?', product: '황금향' },
            { q: '지금 쓸 수 있는 할인 쿠폰 있어요?', product: '황금향', date: '2026-09-22' },
        ];
        const s = await runner('qna_sim_request', 'qna_sim_result', { cases });
        const rs = s.results || s.cases || [];
        const A = i => String((rs[i] || {}).answer || (rs[i] || {}).response || (rs[i] || {}).text || JSON.stringify(rs[i] || {}));
        console.log(`\n  Q1(오늘): ${A(0).replace(/\n/g, '⏎').slice(0, 700)}\n\n  Q2(9/22 시뮬): ${A(1).replace(/\n/g, '⏎').slice(0, 700)}`);
        ok(/추석맞이/.test(A(0)) && /2,000/.test(A(0)) && /21일/.test(A(0)), 'Q1 오늘: 추석맞이 쿠폰 2,000·21일 08시 안내');
        ok(!/추석맞이/.test(A(1)), 'Q2 9/22 시뮬: 추석 쿠폰 언급 0(자동 소멸)');
        await pool.end();
    }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
