// #495-e(대표 확정 10/1 12:4x): 레드키위 수확 시기 = 지금(10월)부터 수확 · 판매 종료 = 12월 중순 전후 → 지식 26 + #66 한 줄 (DB · 멱등 · audit)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코 총괄(대표 확정 #495-e · 레드키위 수확 시기)';
const audit = (t, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', $1, $2, $3, 'agent_office', $4)`, [t, id, JSON.stringify(changes), ACTOR]);
const TAIL = '\n\n*추가 문의사항';
const R = [
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 26',
        ' 수확 시기 문의: 레드키위는 10월부터 수확을 시작해 지금 수확분(햇 레드키위)이 나가요 · 판매는 12월 중순 전후 종료(대표 확정 2026-10-01).'],
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 66',
        '\n📅 레드키위는 10월부터 수확을 시작해 지금 수확한 햇 레드키위가 나가요. 판매는 12월 중순 전후까지예요(재고에 따라 조금 일찍 끝날 수 있어요).'],
];
(async () => {
    for (const [table, ttype, col, where, b] of R) {
        const row = (await pool.query(`SELECT id, ${col} AS v FROM ${table} WHERE ${where} AND deleted_at IS NULL`)).rows[0];
        if (!row) { console.log('❌', table, where, '없음'); continue; }
        if (row.v.includes(b.trim())) { console.log('·', table, row.id, '이미 반영'); continue; }
        const next = (col === 'response' && row.v.includes(TAIL)) ? row.v.replace(TAIL, b + TAIL) : row.v.trimEnd() + b;
        await pool.query(`UPDATE ${table} SET ${col} = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [row.id, next, ACTOR]);
        await audit(ttype, row.id, { before: { [col]: row.v }, after: { [col]: next }, note: '#495-e' });
        console.log('→', table, row.id, '덧붙임');
    }
    await pool.end();
    console.log('✅ 반영 완료 (톡톡봇 캐시 5분)');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
