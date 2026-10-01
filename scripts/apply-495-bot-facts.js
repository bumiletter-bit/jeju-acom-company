// #495-b(10/1 100문항 시험 후속 · 이미 확정된 사실 범위만 · DB · 멱등 · audit)
//   ① #67 유라조생 「저희 첫 노지귤」 → 「저희가 내놓는 첫 노지귤」(AI가 「저희 농장에서 수확」으로 바꿔 쓰는 것 방지 — 업무지식 1절 「전부 직접 키운다로 읽히는 문구 금지」)
//   ② 지식 23(그린레몬 10-01~12-14): 「노란 레몬은 12월 중순부터 4월 말까지」(지식 24 기간과 일치)
//   ③ 지식 9(황금향): 「판매 시작 시점(○월부터)은 말하지 않는다」(AI가 「9월부터」를 지어냄)
//   ④ #66 레드키위: 「가정용 로얄과 구성만 · 선물용 옵션 없음」(네이버 옵션 = 3/5/10kg 로얄과뿐)
//   node scripts/apply-495-bot-facts.js   (조회) / apply
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv[2] === 'apply';
const ACTOR = '클코 총괄(#495-b · 100문항 시험 후속)';
const audit = (t, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', $1, $2, $3, 'agent_office', $4)`, [t, id, JSON.stringify(changes), ACTOR]);
const R = [
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 67',
        '저희 첫 노지귤은 유라조생 귤이에요!',
        '저희가 내놓는 첫 노지귤은 유라조생 귤이에요!'],
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 23',
        null, ' 노란 레몬은 12월 중순부터 4월 말까지 판매해요 — 「언제까지 파나요」에는 「그린레몬은 12월 중순까지, 그 뒤 노란 레몬이 4월 말까지」로 답하세요(대표 확정 2026-10-01).'],
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 9',
        null, ' 판매 「시작」 시점(「○월부터 판매」)은 자료가 없으니 말하지 말고, 지금 판매 중이라는 사실과 종료(12월까지)만 안내하세요.'],
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 66',
        null, '\n🎁 레드키위는 가정용(로얄과) 3kg·5kg·10kg 구성만 있고 선물용 옵션은 따로 없어요 — 선물로 보내실 땐 가정용 구성으로 보내는 분 성함 표기(배송메세지)는 가능해요.'],
];
(async () => {
    for (const [table, ttype, col, where, a, b] of R) {
        const row = (await pool.query(`SELECT id, ${col} AS v FROM ${table} WHERE ${where} AND deleted_at IS NULL`)).rows[0];
        if (!row) { console.log('❌', table, where, '없음'); continue; }
        let next = null, label;
        if (a) { const done = row.v.includes(b) && !row.v.replace(b, '').includes(a); const found = !done && row.v.includes(a); label = done ? '이미 반영' : found ? '교체' : '찾는 줄 없음'; if (found) next = row.v.replace(a, b); }
        else { const done = row.v.includes(b.trim()); label = done ? '이미 반영' : '덧붙임'; if (!done) next = (col === 'response' ? row.v.replace(/\n\n\*추가 문의사항/, b + '\n\n*추가 문의사항') : row.v.trimEnd() + b); if (!done && col === 'response' && !/\*추가 문의사항/.test(row.v)) next = row.v.trimEnd() + b; }
        console.log(`${next ? '→' : '·'} ${table} #${row.id} ${col}: ${label}`);
        if (APPLY && next) {
            await pool.query(`UPDATE ${table} SET ${col} = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [row.id, next, ACTOR]);
            await audit(ttype, row.id, { before: { [col]: row.v }, after: { [col]: next }, note: '#495-b' });
        }
    }
    console.log(APPLY ? '✅ 반영 완료 (톡톡봇 캐시 5분)' : '(조회만 — apply로 반영)');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
