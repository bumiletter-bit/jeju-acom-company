// #450-b: 공통 시나리오 #46·#52의 「하우스감귤 선물용 사이즈 지정 불가」를 괄호 부연 → 독립 문장으로 격상
//   (qna_sim 재현에서 AI가 괄호 부연을 놓치고 「선물용 3kg S사이즈 가능」으로 답한 것을 잡음 — 톡톡 #16은 이미 독립 문장)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #450 톡톡 응대 점검 교정)';
const audit = (id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','inquiry_scenarios',$1,$2,'claude-code',NULL,$3)`, [id, JSON.stringify(changes), ACTOR]);
async function replaceOnce(id, from, to, note) {
    const row = (await pool.query(`SELECT id, scenario_no, name, response FROM inquiry_scenarios WHERE id=$1 AND deleted_at IS NULL`, [id])).rows[0];
    const n = row.response.split(from).length - 1; if (n !== 1) throw new Error(`id ${id}: 대상 ${n}회`);
    const next = row.response.replace(from, to);
    await pool.query(`UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3`, [next, ACTOR, id]);
    await audit(id, { instruction: '#450-b', note, removed: from, replaced_with: to, before: row.response, after: next });
    console.log(`✅ id ${id} #${row.scenario_no} ${row.name}: ${note}`);
}
(async () => {
    await replaceOnce(47,
        '(2S = 골프공 전후 / S = 골프공보다 조금 큰 크기 / M = 종이컵 위에 걸리는 크기 · 하우스감귤 선물용은 사이즈 지정이 어려워요)\n✏️ 원하시는 사이즈가 있으면 주문 시 배송메세지에 "예시) M사이즈로 주세요"라고 남겨주시면 그 사이즈로 맞춰 보내드립니다!',
        '(2S = 골프공 전후 / S = 골프공보다 조금 큰 크기 / M = 종이컵 위에 걸리는 크기)\n✏️ 사이즈 지정은 가정용(로얄과)만 가능해요. 원하시는 사이즈가 있으면 주문 시 배송메세지에 "예시) M사이즈로 주세요"라고 남겨주시면 그 사이즈로 맞춰 보내드립니다!\n🚫 하우스감귤 선물용(3kg)은 사이즈 지정이 불가해요 — 선물용은 사이즈 요청을 받아드릴 수 없는 점 양해 부탁드려요.',
        '선물용 지정 불가 = 독립 문장');
    await replaceOnce(53,
        '원하시는 사이즈가 있으면 주문 시 배송메세지에 남겨주세요! (하우스감귤 선물용은 사이즈 지정이 어려워요)',
        '원하시는 사이즈가 있으면 가정용(로얄과) 주문 시 배송메세지에 남겨주세요!\n🚫 하우스감귤 선물용(3kg)은 사이즈 지정이 불가해요.',
        '선물용 지정 불가 = 독립 문장');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
