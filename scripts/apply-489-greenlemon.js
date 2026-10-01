// #489-b(대표 10/1 「레몬 → 그린레몬 · 판매현황 발송안내문부터 판매중까지 옮기고 옛 레몬 행은 삭제」): bot_products 승계 + soft-delete (DB만 · 멱등 · audit)
//   node scripts/apply-489-greenlemon.js        (조회) / apply
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv[2] === 'apply';
const ACTOR = '클코 총괄(대표 지시 #489-b · 레몬→그린레몬)';
const PAIRS = [[491, 521, '10kg'], [492, 522, '3kg'], [493, 523, '5kg']]; // 옛 → 새
(async () => {
    for (const [oldId, newId, kg] of PAIRS) {
        const o = (await pool.query('SELECT * FROM bot_products WHERE id=$1', [oldId])).rows[0];
        const n = (await pool.query('SELECT * FROM bot_products WHERE id=$1', [newId])).rows[0];
        if (!o || !n) throw new Error('행 없음 ' + oldId + '/' + newId);
        if (!o.name.includes('레몬' + kg) || !n.name.includes('그린레몬' + kg)) throw new Error('kg 불일치 ' + o.name + ' / ' + n.name);
        console.log(`${oldId} ${o.name} ${o.price} ${o.status}${o.deleted_at ? ' (삭제됨)' : ''}  →  ${newId} ${n.name} ${n.price || '(빈칸)'} ${n.status}`);
        if (!APPLY) continue;
        if (n.status !== '판매중' || !n.price) {
            await pool.query(`UPDATE bot_products SET price=$2, status='판매중', shipping_guide=COALESCE(NULLIF(shipping_guide,''),$3), notify_message=COALESCE(NULLIF(notify_message,''),$4), naver_product_no=COALESCE(naver_product_no,$5), updated_at=now(), updated_by=$6 WHERE id=$1`,
                [newId, o.price, o.shipping_guide, o.notify_message, o.naver_product_no, ACTOR]);
            await pool.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','bot_product',$1,$2,'agent_office',$3)`,
                [newId, JSON.stringify({ before: { price: n.price, status: n.status, shipping_guide_len: (n.shipping_guide || '').length }, after: { price: o.price, status: '판매중', shipping_guide_len: (o.shipping_guide || '').length }, note: '#489-b 옛 레몬 ' + oldId + ' 승계' }), ACTOR]);
        }
        if (!o.deleted_at) {
            await pool.query(`UPDATE bot_products SET deleted_at=now(), updated_at=now(), updated_by=$2 WHERE id=$1`, [oldId, ACTOR]);
            await pool.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('delete','bot_product',$1,$2,'agent_office',$3)`,
                [oldId, JSON.stringify({ before: { name: o.name, status: o.status }, note: '#489-b 그린레몬 ' + newId + '로 대체 · soft-delete' }), ACTOR]);
        }
    }
    if (APPLY) {
        const r = await pool.query(`SELECT id,name,price,status,deleted_at IS NOT NULL del,length(coalesce(shipping_guide,'')) sg FROM bot_products WHERE id = ANY($1) ORDER BY id`, [PAIRS.flatMap(x => [x[0], x[1]])]);
        console.log(r.rows);
    }
    console.log(APPLY ? '✅ 반영 완료' : '(조회만 — apply로 반영)');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
