// #442-b 착수 직전 네이버 정본 재조회: 황금향 못난이 5kg(랜덤과) 옵션 텍스트·결제가 (c94=11126666859 · c92=6400134206)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function runner(reqKey, resKey, req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [reqKey, JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key=$1`, [resKey]); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]); return q.rows[0].value; } }
    throw new Error('러너 타임아웃 ' + reqKey);
}
(async () => {
    const nos = ['11126666859', '6400134206'];
    const nr = await runner('naver_query_request', 'naver_query_result', { calls: nos.map(no => ({ method: 'GET', path: `/external/v2/products/channel-products/${no}` })) });
    for (const no of nos) {
        const r = nr.results.find(x => x.path.endsWith('/' + no));
        if (!r || !r.ok) { console.log('❌', no, r && r.error); continue; }
        const d = JSON.parse(r.data_str); const op = d.originProduct;
        const disc = (((op.customerBenefit || {}).immediateDiscountPolicy || {}).discountMethod || {}).value || 0;
        const base = op.salePrice - disc;
        const oc = (((op.detailAttribute || {}).optionInfo || {}).optionCombinations) || [];
        console.log(`\n■ ${no} ${op.name.slice(0, 30)} — 기준가 ${base.toLocaleString()} (${op.statusType})`);
        for (const o of oc) console.log(`   ${o.usable === false ? '⛔' : '  '} ${o.optionName1} · ${o.optionName2} | +${o.price} → ${(base + o.price).toLocaleString()} | 재고 ${o.stockQuantity}`);
    }
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
