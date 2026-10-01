// #495-e 검증(실AI · 상품문의 · 콘솔): 레드키위 수확 시기 · 유라 「타이벡 언제부터」 — 2문항 1배치
require('dotenv').config(); const { Pool } = require('pg');
const CASES = [
    { q: '레드키위 수확은 언제 한 거예요? 햇 거 맞아요?', product: '레드키위', t: '레드키위 수확: 10월부터 수확·햇 레드키위·12월 중순 전후 종료', chk: a => /10월/.test(a) && /(햇|지금 수확)/.test(a) && /12월/.test(a) },
    { q: '타이벡 감귤은 언제부터 팔아요?', product: '유라조생', t: '타이벡 시기: 11월부터·알림받기', chk: a => /11월/.test(a) && /(알림|확답|미정)/.test(a) },
];
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('qna_sim_request',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify({ cases: CASES.map(c => ({ q: c.q, product: c.product })) })]);
    let v = null; const t0 = Date.now();
    while (Date.now() - t0 < 560000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) { v = q.rows[0].value; await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`); break; } }
    await pool.end(); if (!v) throw new Error('runner timeout');
    const rs = v.results || []; let pass = 0;
    CASES.forEach((c, i) => { const a = String((rs[i] || {}).answer || ''); const ok = c.chk(a); if (ok) pass++; console.log(`\n${ok ? '✅' : '❌'} ${c.t}\n  Q: ${c.q}\n  A: ${a.replace(/\n/g, '⏎').replace(/\*추가 문의사항.*$/, '').slice(0, 400)}`); });
    console.log(`\n결과 ${pass}/${CASES.length}`); process.exit(pass === CASES.length ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
