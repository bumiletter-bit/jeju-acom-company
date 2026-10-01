// #496(직원 검토 10/1 13:0x · 대표 「다들 동의」): 정리표 보고 직원이 지적한 5건 반영 (DB · 멱등 · audit)
//   ① 레드키위 과수 = 범위(3kg 25~35 · 5kg 40~75 · 10kg 80~130과 전후) — 125g 미만이라 폭이 큼
//   ② 유라·하우스 소과(2S 미만) = kg당 20개 전후(3kg 약 60과) — 종전 「15개 전후」는 로얄과(11~16)와 겹침
//   ③ 유라 「왜 하우스보다 싸요」 = 하우스감귤은 시설(하우스) 재배라 노지 재배보다 가격이 높다
//   ④ 보관법 「서늘한 곳(10~15도)」 → 온도 표시 없이 「서늘한 곳」
//   ⑤ 메시지카드 = 명절·시즌과 상관없이 언제든 가능
//   node scripts/apply-496-staff-feedback.js   (조회) / apply
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv[2] === 'apply';
const ACTOR = '클코 총괄(#496 · 직원 검토 반영)';
const audit = (t, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', $1, $2, $3, 'agent_office', $4)`, [t, id, JSON.stringify(changes), ACTOR]);
const R = [
    // ① 레드키위 과수 범위
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 66',
        '대략 3kg 25과 · 5kg 40과 · 10kg 80과 전후로 들어가요(개당 무게에 따라 달라져서 정확한 개수는 조금씩 차이가 나요)',
        '대략 3kg 25~35과 · 5kg 40~75과 · 10kg 80~130과 전후로 들어가요(개당 무게 차이가 커서 범위로만 안내드려요)'],
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 26',
        '대략 3kg 25과 · 5kg 40과 · 10kg 80과 전후(개당 무게에 따라 달라지니 「대략」으로만 안내)',
        '대략 3kg 25~35과 · 5kg 40~75과 · 10kg 80~130과 전후(개당 무게 차이가 커서 반드시 범위로 안내 — 직원 검토 2026-10-01)'],
    // ② 소과 kg당 20개 전후
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 46',
        '▶ 소과: kg당 15개 전후',
        '▶ 소과(2S 미만): kg당 20개 전후 (3kg 기준 약 60과 전후)'],
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 67',
        '📦 개수도 하우스감귤과 같아요: kg당 로얄과 11~16개 · 소과 15개 전후 · 중대과 8개 전후 (3kg 로얄과 약 33~48과).',
        '📦 개수도 하우스감귤과 같아요: kg당 로얄과 11~16개 · 소과(2S 미만) 20개 전후 · 중대과 8개 전후 (3kg 기준 로얄과 약 33~48과 · 소과 약 60과 전후).\n💰 가격이 하우스감귤보다 낮은 이유: 하우스감귤은 시설(하우스) 재배라 노지 재배인 유라조생보다 가격이 높아요 — 맛·당도는 하우스가 더 좋고, 유라조생은 새콤달콤하면서 저렴한 게 장점이에요.'],
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 28',
        '개수·사이즈 지정은 하우스감귤과 동일(kg당 로얄과 11~16개·소과 15개 전후·중대과 8개 전후 · 가정용 로얄과는 배송메세지로 사이즈 지정 가능 — 대표 확정).',
        '개수·사이즈 지정은 하우스감귤과 동일(kg당 로얄과 11~16개·소과(2S 미만) 20개 전후(3kg 약 60과)·중대과 8개 전후 · 가정용 로얄과는 배송메세지로 사이즈 지정 가능 — 대표 확정 · 소과 기준은 직원 검토 2026-10-01). 「왜 하우스보다 싸냐」 = 하우스감귤은 시설(하우스) 재배라 노지 재배보다 가격이 높다고 설명하세요.'],
    // ④ 보관법 온도 표시 제거
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 22',
        '직사광선 없는 서늘한 곳(10~15도)이 최적이에요',
        '직사광선 없는 서늘한 곳이 최적이에요'],
    // ⑤ 메시지카드 상시
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 58',
        '네, 메시지카드 넣어드릴 수 있어요 💌',
        '네, 메시지카드 넣어드릴 수 있어요 💌 (명절·시즌과 상관없이 언제든 가능해요)'],
];
(async () => {
    for (const [table, ttype, col, where, a, b] of R) {
        const row = (await pool.query(`SELECT id, ${col} AS v FROM ${table} WHERE ${where} AND deleted_at IS NULL`)).rows[0];
        if (!row) { console.log('❌', table, where, '없음'); continue; }
        const done = row.v.includes(b) && !row.v.replace(b, '').includes(a), found = !done && row.v.includes(a);
        console.log(`${done ? '·' : found ? '→' : '❌'} ${table} #${row.id} ${col}: ${done ? '이미 반영' : found ? '교체' : '찾는 줄 없음'}`);
        if (APPLY && found) {
            const next = row.v.replace(a, b);
            await pool.query(`UPDATE ${table} SET ${col} = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [row.id, next, ACTOR]);
            await audit(ttype, row.id, { before: { [col]: row.v }, after: { [col]: next }, note: '#496 직원 검토' });
        }
    }
    console.log(APPLY ? '✅ 반영 완료 (톡톡봇 캐시 5분)' : '(조회만 — apply로 반영)');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
