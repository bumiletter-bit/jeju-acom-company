// #432-b(대표 9/11): 시나리오 #38 「지금 시기 청귤은 산도가 가장 좋을 때」 고정 문구 — 마감기 시기 지식(산도 낮아짐)과 상충 → 시기 중립 문구로. DB만·audit.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #432)';
const FROM = '🍋 지금 시기 청귤은 산도가 가장 좋을 때라 청귤청 담그기에 최적이에요.';
const TO = '🍋 청귤은 청귤청 담그기에 딱 좋은 과일이에요! 시기에 따라 산도·크기가 달라 설탕 비율을 조금씩 조절하시면 더 맛있어요.';
(async () => {
    const cur = (await pool.query('SELECT * FROM inquiry_scenarios WHERE scenario_no=38 AND deleted_at IS NULL')).rows[0];
    if (!cur) throw new Error('#38 없음');
    if (cur.response.includes(TO)) { console.log('이미 반영'); await pool.end(); return; }
    if (!cur.response.includes(FROM)) throw new Error('원문구 불일치 — 중단');
    const after = (await pool.query('UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *', [cur.response.replace(FROM, TO), ACTOR, cur.id])).rows[0];
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','inquiry_scenario',$1,$2,'inquiry-scenario',NULL,$3)`,
        [cur.id, JSON.stringify({ before: cur, after, note: '#432 시기 중립 문구' }), ACTOR]);
    console.log('✅ #38 교정:', TO);
    const chk = await pool.query(`SELECT scenario_no FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled AND response ~ '산도가 가장 좋을 때'`);
    console.log('검산: 「산도가 가장 좋을 때」 잔존', chk.rows.length);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
