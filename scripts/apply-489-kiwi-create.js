// #489(대표 GO 10/1): 카페24에 레드키위 상품 신규 생성(bulk-create 러너 #248-③) → 대표 이미지(bulk-image) → 상세(bulk-detail) → 진열·판매 T → sync 매핑 등록
//   node scripts/apply-489-kiwi-create.js            (조회: 이미 있으면 번호만 출력)
//   node scripts/apply-489-kiwi-create.js create     (생성 + 후속 전부)
//   네이버 13782816361 = disc 50,800(5kg) · 3kg 33,800 · 10kg 93,800 → 기본가 33,800 · 추가금 5kg +17,000 · 10kg +60,000 · minAdd = 33,800 − 50,800 = −17,000
require('dotenv').config();
const { Client } = require('pg');
const NNO = '13782816361';
const NAME = '제주 레드키위';
const BASE = 33800, DISC = 50800;
const OPTS = [
    { text: '제주산 레드키위 3kg(로얄과)', add: '0' },
    { text: '제주산 레드키위 5kg(로얄과)', add: '17000' },
    { text: '제주산 레드키위 10kg(로얄과)', add: '60000' },
];
async function flag(c, req, ms = 180000) {
    await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await c.query(`INSERT INTO agent_office_config(key,value) VALUES('cafe24_product_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 4000)); const q = await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('timeout');
}
(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const list = await flag(c, { action: 'raw', method: 'GET', path: '/api/v2/admin/products', query: { limit: 100, fields: 'product_no,product_name,selling,display,price' } });
    const ps = list.raw.data.products || [];
    const exist = ps.filter(x => /키위/.test(x.product_name));
    console.log('기존 키위 상품:', exist.length ? JSON.stringify(exist) : '없음');
    if (process.argv[2] !== 'create') { console.log('(조회만 — create 인자로 생성)'); await c.end(); return; }
    if (exist.length) throw new Error('이미 있음 — 중복 생성 중단');
    const cr = await flag(c, { action: 'bulk-create', items: [{ no: NNO, name: NAME, price: BASE, opts: OPTS }] });
    const row = (cr.bulk || [])[0] || {};
    console.log('bulk-create:', JSON.stringify(row));
    const c24 = row.c24_no; if (!c24 || row.error) throw new Error('생성 실패 ' + JSON.stringify(row));
    const im = await flag(c, { action: 'bulk-image', map: { [NNO]: c24 } });
    console.log('bulk-image:', JSON.stringify((im.image || im.images || im.bulk || im)).slice(0, 300));
    const de = await flag(c, { action: 'bulk-detail', map: { [NNO]: c24 } });
    console.log('bulk-detail:', JSON.stringify(de.detail || de).slice(0, 300));
    const on = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${c24}`, body: { shop_no: 1, request: { display: 'T', selling: 'T', price: String(BASE), supply_price: String(BASE) } } });
    console.log('진열·판매 T:', on.raw && on.raw.status < 300 ? '✅' : JSON.stringify(on).slice(0, 200));
    const mapRow = (await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_sync_map'`)).rows[0];
    const map = mapRow.value; map.map[NNO] = { c24: Number(c24), minAdd: BASE - DISC };
    await c.query(`UPDATE agent_office_config SET value=$1::jsonb, updated_at=NOW() WHERE key='cafe24_sync_map'`, [JSON.stringify(map)]);
    console.log(`sync 매핑 ${NNO} → c${c24} minAdd ${BASE - DISC}`);
    await new Promise(r => setTimeout(r, 70000));
    const pr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${c24}`, query: { fields: 'product_no,product_name,selling,display,price,detail_image,list_image' } });
    console.log('검산 상품:', JSON.stringify(pr.raw.data.product));
    const vr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${c24}/variants` });
    let bad = 0;
    for (const v of vr.raw.data.variants) { const name = v.options[0].value; const want = OPTS.find(o => o.text === name); const pay = BASE + Number(v.additional_amount); const ok = want && pay === BASE + Number(want.add); if (!ok) bad++; console.log(ok ? '✅' : '❌', v.variant_code, name, '결제가', pay, 'sell', v.selling, 'disp', v.display); }
    await c.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name,created_at) VALUES('create','cafe24_product',$1,$2,'cafe24-api','클코 총괄(대표 GO — #489 레드키위 자사몰 신규)',NOW())`, [String(c24), JSON.stringify({ naver: NNO, name: NAME, base: BASE, opts: OPTS, minAdd: BASE - DISC })]).catch(e => console.log('audit skip', e.message));
    console.log(bad ? `❌ 불일치 ${bad}` : `✅ c${c24} 레드키위 생성·결제가 일치`);
    await c.end();
    process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
