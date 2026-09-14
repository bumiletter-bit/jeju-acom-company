// #442 검증: cafe24_sync dry 실행(텔레그램 X·값 변경 X) → 신버전(v5.9.317) optMissing(옵션명 불일치) 결과 확인
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) { await new Promise(r => setTimeout(r, 5000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
(async () => {
    const r = await runner({ action: 'sync', mode: 'dry', telegram: 'no' });
    console.log('server_version:', r.server_version);
    const rep = r.report || r.sync || r;
    console.log('summary:', JSON.stringify(rep.summary));
    const d = rep.detail || {};
    console.log('detail keys:', Object.keys(d).join(','));
    console.log('optMissing:', JSON.stringify(d.optMissing));
    console.log('optMismatch:', JSON.stringify(d.optMismatch));
    for (const k of Object.keys(d)) if (!/optMissing|optMismatch/.test(k)) console.log(' ', k, ':', JSON.stringify(d[k]).slice(0, 300));
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
