// #431-a(대표 9/11): 청귤 주문 마감 안내 — 「15일까지」→「14일까지 주문(9/15 오전 8시 마감)」 유도. 시나리오 #38·#44·#48 + 시기 지식 id 7. DB만·audit(svcUpdateScenario 동일 형식).
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #431)';
const REPL = [
    // [scenario_no, 찾을 문구, 바꿀 문구]
    [38, '🗓 청귤 판매기간은 9월 15일까지예요. 법적으로 그 이후에는 판매할 수 없으니, 청 담그실 분들은 기간 안에 주문해주세요!',
         '🗓 청귤 주문은 9월 14일까지 받아요! (9/15 오전 8시에 주문이 마감되고, 법적으로 그 이후엔 판매할 수 없어요) 청 담그실 분들은 늦어도 14일까지 주문해주세요!'],
    [44, '🗓 청귤 판매기간은 9월 15일까지예요. 청 담그실 분들은 기간 안에 주문해주세요!',
         '🗓 청귤 주문은 9월 14일까지 받아요! (9/15 오전 8시 주문 마감) 청 담그실 분들은 늦어도 14일까지 주문해주세요!'],
    [48, '8월부터 수확·판매가 가능하고, 9월 15일 이후에는 판매할 수 없습니다.',
         '8월부터 수확·판매가 가능하고, 9월 15일 이후에는 판매할 수 없습니다. 그래서 주문은 9월 14일까지 받고 있어요 (9/15 오전 8시 마감) — 늦어도 14일까지 주문해주세요!'],
];
const KNOW_ADD = ' ⏰ 주문 마감: 청귤 주문은 9월 14일까지 받아요(9/15 오전 8시에 마감·이후 판매 불가) — 손님에게는 "늦어도 14일까지 주문"으로 안내하세요. "15일까지 주문 가능"이라고 말하지 마세요.';
(async () => {
    let n = 0;
    for (const [no, from, to] of REPL) {
        const cur = (await pool.query('SELECT * FROM inquiry_scenarios WHERE scenario_no=$1 AND deleted_at IS NULL', [no])).rows[0];
        if (!cur) { console.log('❌ #' + no + ' 없음'); continue; }
        if (cur.response.includes(to)) { console.log('  #' + no + ' 이미 반영'); continue; }
        if (!cur.response.includes(from)) { console.log('❌ #' + no + ' 원문구 불일치 — 건너뜀'); continue; }
        const resp = cur.response.replace(from, to);
        const after = (await pool.query('UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *', [resp, ACTOR, cur.id])).rows[0];
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','inquiry_scenario',$1,$2,'inquiry-scenario',NULL,$3)`,
            [cur.id, JSON.stringify({ before: cur, after, note: '#431 청귤 주문 마감 14일 유도' }), ACTOR]);
        console.log('✅ #' + no, cur.name, '→ 14일 유도 문구'); n++;
    }
    const k = (await pool.query('SELECT * FROM product_season_knowledge WHERE id=7 AND deleted_at IS NULL')).rows[0];
    if (k && !k.knowledge.includes('주문 마감: 청귤')) {
        const after = (await pool.query('UPDATE product_season_knowledge SET knowledge=$1, updated_at=now(), updated_by=$2 WHERE id=7 RETURNING *', [k.knowledge + KNOW_ADD, ACTOR])).rows[0];
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','season_knowledge',7,$1,'season-knowledge',NULL,$2)`,
            [JSON.stringify({ before: k, after, note: '#431' }), ACTOR]);
        console.log('✅ 시기지식 id 7(청귤 마감기 09-01~09-15)에 주문 마감 줄 추가'); n++;
    } else console.log('  시기지식 id 7 이미 반영/없음');
    const chk = await pool.query(`SELECT scenario_no FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled AND response ~ '15일까지'`);
    console.log('검산: 활성 시나리오 중 「15일까지」 잔존', chk.rows.length ? chk.rows.map(r => '#' + r.scenario_no).join(',') : '0');
    await pool.end();
    process.exit(chk.rows.length ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
