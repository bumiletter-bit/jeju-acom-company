// #437(대표 GO 9/14): 하우스감귤 시기 지식 「여름 과일이라 냉장보관…」 → 계절 단어 제거(9~10월에도 어색하지 않게). id 11(초기)·12(후기). DB만·audit.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #437)';
const CH = [
    [11, '여름 과일이라 냉장보관 후 시원하게 드시는 걸 추천해요.', '과즙이 많아 냉장 보관 후 시원하게 드시면 새콤달콤함이 더 살아나요.'],
    [12, '여름 과일이라 냉장보관 후 시원하게 드시는 걸 추천해요.', '하우스귤은 과즙이 많아 냉장 보관 후 시원하게 드시면 단맛이 더 살아나요. (새콤하게 느껴지면 상온에서 하루 이틀 두었다가 드셔도 좋아요.)'],
];
(async () => {
    for (const [id, from, to] of CH) {
        const cur = (await pool.query('SELECT * FROM product_season_knowledge WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
        if (!cur) { console.log('❌ id', id, '없음'); continue; }
        if (cur.knowledge.includes(to)) { console.log('  id', id, '이미 반영'); continue; }
        if (!cur.knowledge.includes(from)) { console.log('❌ id', id, '원문구 불일치'); continue; }
        const after = (await pool.query('UPDATE product_season_knowledge SET knowledge=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *', [cur.knowledge.replace(from, to), ACTOR, id])).rows[0];
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','season_knowledge',$1,$2,'season-knowledge',NULL,$3)`, [id, JSON.stringify({ before: cur, after, note: '#437 계절 단어 제거' }), ACTOR]);
        console.log('✅ id', id, cur.item_key, cur.label, '→', to);
    }
    const chk = await pool.query(`SELECT id FROM product_season_knowledge WHERE deleted_at IS NULL AND item_key='하우스감귤' AND knowledge ~ '여름'`);
    console.log('검산: 하우스감귤 지식에 「여름」 잔존', chk.rows.length);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
