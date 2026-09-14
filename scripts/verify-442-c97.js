// #442 검증: 카페24 c97(제주 과일 대용량) 옵션값 이름 변경·판매 상태를 API 정본으로 확인 (읽기 전용)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const WANT = '1. (제철)과즙팡팡 황금향 · 황금향 못난이 - 10kg(랜덤과)';
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
(async () => {
    const p = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/products/97', query: { fields: 'product_no,product_name,selling,display,price,updated_date' } });
    const pd = (p.raw && p.raw.data && p.raw.data.product) || {};
    console.log('product:', JSON.stringify(pd));
    const v = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/products/97/variants' });
    const vs = (v.raw && v.raw.data && v.raw.data.variants) || [];
    for (const x of vs) console.log('variant:', x.variant_code, '|', (x.options || []).map(o => o.value).join(' / '), '| selling', x.selling, '| display', x.display, '| add', x.additional_amount, '| qty', x.quantity, '| use_inv', x.use_inventory);
    const hit = vs.find(x => (x.options || []).some(o => o.value === WANT));
    console.log(hit ? '✅ 옵션명 일치(정본 API)' : '❌ 옵션명 아직 미반영');
    console.log(pd.selling === 'T' ? '✅ 상품 판매함' : '❌ 상품 판매 상태 = ' + pd.selling);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
