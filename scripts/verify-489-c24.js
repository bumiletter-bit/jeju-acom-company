// #489 조사: 카페24 c92(감귤·유라 옵션 추가 대상)·c105(레몬)·레드키위 상품 존재 여부 — API 정본(raw 러너 · 읽기 전용)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
async function show(no) {
    const p = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/products/${no}`, query: { fields: 'product_no,product_name,selling,display,price,updated_date,option_type,has_option' } });
    const pd = (p.raw && p.raw.data && p.raw.data.product) || p;
    console.log(`\n■ c${no}: ${JSON.stringify(pd)}`);
    const v = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/products/${no}/variants` });
    const vs = (v.raw && v.raw.data && v.raw.data.variants) || [];
    for (const x of vs) console.log(`   ${x.variant_code} | ${(x.options || []).map(o => o.value).join(' / ')} | sell ${x.selling} disp ${x.display} | add ${x.additional_amount}`);
    return { pd, vs };
}
(async () => {
    const list = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/products', query: { limit: 100, fields: 'product_no,product_name,selling,display,price,created_date' } });
    const ps = (list.raw && list.raw.data && list.raw.data.products) || [];
    console.log('카페24 상품', ps.length, '종');
    for (const x of ps) if (/키위|레몬|감귤|노지|유라/.test(x.product_name)) console.log(`   c${x.product_no} ${x.product_name} | sell ${x.selling} disp ${x.display} | ${x.price} | ${x.created_date}`);
    for (const no of (process.argv.slice(2).length ? process.argv.slice(2) : [92, 105])) await show(no);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
