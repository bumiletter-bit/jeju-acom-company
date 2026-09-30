// #488-e(대표 확정 9/30 밤): 유라조생 ①kg별 개수 = 하우스감귤과 동일(#46 기준) ②사이즈 지정 = 하우스와 동일(가정용 로얄과 · 배송메세지) ③하우스와 반반 포장 안 됨(품목별 별도 포장)
//   DB만(코드 0) · 인자 없이 = 조회 · apply = 반영+audit · 멱등.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv[2] === 'apply';
const ACTOR = '클코 총괄(대표 지시 #488-e · 유라조생 개수·사이즈·반반)';
const audit = (t, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', $1, $2, $3, 'agent_office', $4)`, [t, id, JSON.stringify(changes), ACTOR]);
const R = [
    ['inquiry_scenarios', 'inquiry_scenario', 'response', `scenario_no = 67`,
        '📏 사이즈: 소과(2S미만) / 로얄과(2S~M) / 중대과(L이상)',
        '📏 사이즈: 소과(2S미만) / 로얄과(2S~M) / 중대과(L이상) — 하우스감귤과 같은 기준이에요.\n📦 개수도 하우스감귤과 같아요: kg당 로얄과 11~16개 · 소과 15개 전후 · 중대과 8개 전후 (3kg 로얄과 약 33~48과).\n✏️ 사이즈 지정도 하우스감귤과 같이 가능해요 — 가정용(로얄과) 주문 시 배송메세지에 "예시) S사이즈로"라고 남겨 주세요.\n🚫 하우스감귤과 한 박스에 반반 담기는 어려워요(품목별로 따로 포장해요). 각각 주문해 주세요.'],
    ['product_season_knowledge', 'season_knowledge', 'knowledge', `id = 28`,
        '맛은 새콤달콤이에요(하우스감귤보다 새콤한 편) — 「저렴하고 새콤달콤」으로 안내하세요.',
        '맛은 새콤달콤이에요(하우스감귤보다 새콤한 편) — 「저렴하고 새콤달콤」으로 안내하세요. 개수·사이즈 지정은 하우스감귤과 동일(kg당 로얄과 11~16개·소과 15개 전후·중대과 8개 전후 · 가정용 로얄과는 배송메세지로 사이즈 지정 가능 — 대표 확정). 하우스감귤과 한 박스 반반 포장은 안 돼요(품목별 별도 포장) — 각각 주문 안내.'],
];
(async () => {
    for (const [table, ttype, col, where, a, b] of R) {
        const row = (await pool.query(`SELECT id, ${col} AS v FROM ${table} WHERE ${where} AND deleted_at IS NULL`)).rows[0];
        if (!row) { console.log(table, where, '없음'); continue; }
        const done = row.v.includes(b), found = row.v.includes(a);
        console.log(`${table} #${row.id}: ${done ? '이미 반영' : found ? '교체' : '찾는 줄 없음'}`);
        if (APPLY && !done && found) {
            const next = row.v.replace(a, b);
            await pool.query(`UPDATE ${table} SET ${col} = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [row.id, next, ACTOR]);
            await audit(ttype, row.id, { before: { [col]: row.v }, after: { [col]: next }, note: '#488-e' });
        }
    }
    console.log(APPLY ? '✅ 반영 완료' : '(조회만)');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
