// 질문 은행 결과 파일의 특정 문항만 실AI로 다시 돌려 갱신 (qna_sim · 3문항씩 · before 보존)
//   node scripts/rerun-495-questions.js "레드키위:5,6,7" "유라조생:4,5,8,14" "황금향:11"   → verdict는 비워 두고(판정은 사람) answer·rerun_at 갱신
require('dotenv').config(); const fs = require('fs'), path = require('path'); const { Pool } = require('pg');
const F = path.join(__dirname, 'qbank-495-results.json');
const targets = [];
for (const arg of process.argv.slice(2)) { const [p, nums] = arg.split(':'); for (const n of nums.split(',')) targets.push({ product: p, no: Number(n) }); }
async function run(pool, cases) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('qna_sim_request',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify({ cases })]);
    const t0 = Date.now();
    while (Date.now() - t0 < 560000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`); return q.rows[0].value.results || []; } }
    throw new Error('runner timeout');
}
(async () => {
    const rows = JSON.parse(fs.readFileSync(F, 'utf8'));
    const picked = targets.map(t => rows.find(r => r.product === t.product && r.no === t.no)).filter(Boolean);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    for (let i = 0; i < picked.length; i += 3) {
        const batch = picked.slice(i, i + 3);
        const rs = await run(pool, batch.map(b => ({ q: b.q, product: b.product })));
        batch.forEach((b, k) => { const a = String((rs[k] || {}).answer || ''); b.before_answer_496 = b.answer; b.before_verdict_496 = b.verdict; b.answer = a; b.used = (rs[k] || {}).used || b.used; b.rerun_at = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' KST'; b.verdict = ''; b.reason = '(재실행 — 판정 대기)'; console.log(`\n[${b.product} #${b.no}] ${b.q}\n  A: ${a.replace(/\n/g, '⏎').replace(/\*추가 문의사항.*$/, '').slice(0, 500)}`); });
        fs.writeFileSync(F, JSON.stringify(rows, null, 1));
    }
    await pool.end();
    console.log(`\n재실행 ${picked.length}건 저장`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
