// #488-c(대표 9/30 저녁): 레드키위 신맛 = 「후숙 5~10일, 말랑할 때 드시면 맛있다, 조금만 기다려 달라, 그래도 맛없으면 무료반품」 · 개수는 「대략」 표현.
//   DB만(코드 0) · 인자 없이 = 조회 · apply = 반영+audit · 멱등.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv[2] === 'apply';
const ACTOR = '클코 총괄(대표 지시 #488-c · 레드키위 신맛·개수 문구)';
const audit = (t, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', $1, $2, $3, 'agent_office', $4)`, [t, id, JSON.stringify(changes), ACTOR]);
const R = [
    ['inquiry_scenarios', 'inquiry_scenario', 'response', `scenario_no = 66`, [
        ['📦 한 개 125g 미만의 로얄과로, 3kg 약 25과 · 5kg 약 40과 · 10kg 약 80과 전후 들어가요(개당 무게에 따라 조금씩 달라져요).',
         '📦 한 개 125g 미만의 로얄과라, 대략 3kg 25과 · 5kg 40과 · 10kg 80과 전후로 들어가요(개당 무게에 따라 달라져서 정확한 개수는 조금씩 차이가 나요).'],
        ['🥝 드셔 보니 시거나 딱딱하면 아직 후숙이 덜 된 거예요 — 며칠 더 두셨다가 말랑해질 때 드시면 단맛이 올라와요.',
         '🥝 드셔 보니 시거나 딱딱하면 아직 후숙이 덜 된 거예요 — 실온에서 5~10일 정도 두셨다가 손으로 눌러 말랑해질 때 드시면 정말 맛있어져요. 조금만 기다려 주세요! 그래도 맛이 없으시면 무료수거 반품으로 처리해드리니 부담 없이 말씀해 주세요.'],
    ]],
    ['product_season_knowledge', 'season_knowledge', 'knowledge', `id = 26`, [
        ['개수 문의: 한 개 125g 미만의 로얄과라 3kg 약 25과 · 5kg 약 40과 · 10kg 약 80과 전후(개당 무게에 따라 다름). 「시다·딱딱하다·떫다」 문의는 상한 게 아니라 후숙이 덜 된 것 — 반품·보상보다 먼저 「며칠 더 두었다가 말랑할 때 드시라」고 안내하세요.',
         '개수 문의: 한 개 125g 미만의 로얄과라 대략 3kg 25과 · 5kg 40과 · 10kg 80과 전후(개당 무게에 따라 달라지니 「대략」으로만 안내). 「시다·딱딱하다·떫다」 문의는 상한 게 아니라 후숙이 덜 된 것 — 「실온에서 5~10일 후숙해 말랑할 때 드시면 맛있다, 조금만 기다려 달라」고 먼저 안내하고, 그래도 맛이 없으면 무료수거 반품해 드린다고 덧붙이세요(대표 확정).'],
    ]],
];
(async () => {
    for (const [table, ttype, col, where, reps] of R) {
        const row = (await pool.query(`SELECT id, ${col} AS v FROM ${table} WHERE ${where} AND deleted_at IS NULL`)).rows[0];
        if (!row) { console.log(table, where, '없음'); continue; }
        let next = row.v; const notes = [];
        for (const [a, b] of reps) { if (next.includes(b)) notes.push('이미 반영'); else if (!next.includes(a)) notes.push('찾는 줄 없음: ' + a.slice(0, 30)); else { next = next.replace(a, b); notes.push('교체'); } }
        console.log(`${table} #${row.id}: ${notes.join(' · ')}`);
        if (APPLY && next !== row.v) {
            await pool.query(`UPDATE ${table} SET ${col} = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [row.id, next, ACTOR]);
            await audit(ttype, row.id, { before: { [col]: row.v }, after: { [col]: next }, note: '#488-c' });
        }
    }
    console.log(APPLY ? '✅ 반영 완료' : '(조회만)');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
