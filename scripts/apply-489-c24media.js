// #489: 카페24 대표(목록) 이미지·상세페이지를 네이버 최신 스냅샷으로 재이관(bulk-image · bulk-detail 러너 #246/#399 동일) + 상품명 변경
//   node scripts/apply-489-c24media.js            → c105(레몬→그린레몬 이름·이미지·상세) · c92(감귤 이미지·상세) · c119(키위 이미지 재시도)
require('dotenv').config();
const { Client } = require('pg');
const MAP = { '5531798664': 105, '6400134206': 92, '13782816361': 119 };
const RENAME = { 105: '제주 그린레몬' };
async function flag(c, req, ms = 240000) {
    await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await c.query(`INSERT INTO agent_office_config(key,value) VALUES('cafe24_product_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 4000)); const q = await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('timeout');
}
(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const det = (await c.query(`SELECT value FROM agent_office_config WHERE key='product_detail_snapshot'`)).rows[0].value;
    console.log('상세 스냅샷', det.at, det.count + '종');
    for (const [no, cno] of Object.entries(MAP)) { const d = det.items[no]; console.log(`  ${no} → c${cno}: 상세 ${d ? d.blocks.length + '블록' : '없음'}`); }
    for (const [cno, name] of Object.entries(RENAME)) {
        const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${cno}`, body: { shop_no: 1, request: { product_name: name } } });
        console.log(`c${cno} 상품명 → ${name}:`, r.raw && r.raw.status < 300 ? '✅' : JSON.stringify(r).slice(0, 200));
    }
    const im = await flag(c, { action: 'bulk-image', map: MAP });
    for (const row of (im.image || im.images || im.bulk || [])) console.log('image:', JSON.stringify(row).slice(0, 220));
    const de = await flag(c, { action: 'bulk-detail', map: MAP });
    for (const row of (de.detail || [])) console.log('detail:', JSON.stringify(row).slice(0, 220));
    await new Promise(r => setTimeout(r, 65000));
    for (const [no, cno] of Object.entries(MAP)) {
        const pr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}`, query: { fields: 'product_no,product_name,list_image,detail_image,updated_date' } });
        console.log('검산', JSON.stringify(pr.raw.data.product));
    }
    await c.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name,created_at) VALUES('update','cafe24_product',$1,$2,'cafe24-api','클코 총괄(대표 GO — #489 자사몰 사진·상세 = 네이버)',NOW())`, [Object.values(MAP).join(','), JSON.stringify({ map: MAP, rename: RENAME, detail_at: det.at })]).catch(() => {});
    await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
