// #488(대표 확정 9/30): 10/1 오픈 3품목 응대 보강 — DB만(코드 0). 인자 없이 = 조회만 · `apply` = 반영+audit. 멱등(이미 반영된 줄은 건너뜀).
//   ①레드키위: 개당 125g 미만 로얄과 → kg별 대략 개수 · 「시다 = 후숙 부족」 안내(반품보다 후숙 먼저) — 시나리오 #66 + 시기 지식 26
//   ②레몬: 중소과 3kg 22과·5kg 35과·10kg 70과 전후 — #39에 개수 줄 + #39 채널 톡톡→공통(총괄 결정 5번 · 본문에 개인정보 유도 없음)
//   ③유라조생: 시기 지식 28에 「새콤달콤」 · #32 「제철 11월~1월」 줄 → 10월 유라조생 → 11월~1월 조생·타이벡
//   ④레몬만 예외: 「입맛에 안 맞으면 책임지고 처리」(#23) 맛 보증 문구를 레몬에는 붙이지 않게 — 시기 지식 23·24에 지시
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv[2] === 'apply';
const ACTOR = '클코 총괄(대표 지시 #488 · 10/1 오픈 준비)';
const audit = (t, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', $1, $2, $3, 'agent_office', $4)`, [t, id, JSON.stringify(changes), ACTOR]);

const S = [
    { no: 66, find: '📦 판매 여부·가격은 스토어에서 확인하실 수 있고',
      insert: '📦 한 개 125g 미만의 로얄과로, 3kg 약 25과 · 5kg 약 40과 · 10kg 약 80과 전후 들어가요(개당 무게에 따라 조금씩 달라져요).\n🥝 드셔 보니 시거나 딱딱하면 아직 후숙이 덜 된 거예요 — 며칠 더 두셨다가 말랑해질 때 드시면 단맛이 올라와요.\n' },
    { no: 39, find: '🧊 받으시면 냉장 보관해 주시고',
      insert: '📦 중소과 기준 3kg 약 22과 · 5kg 약 35과 · 10kg 약 70과 전후 들어가요.\n', channel: '공통' },
    { no: 32, replace: ['📅 제철: 11월~1월 (고당도 타이벡은 인기가 많아 조기 마감이 잦아요)', '📅 노지감귤: 10월은 첫 노지귤 유라조생, 11월~1월은 일반 조생·타이벡이에요 (고당도 타이벡은 인기가 많아 조기 마감이 잦아요)'] },
];
const K = [
    { id: 26, add: ' 개수 문의: 한 개 125g 미만의 로얄과라 3kg 약 25과 · 5kg 약 40과 · 10kg 약 80과 전후(개당 무게에 따라 다름). 「시다·딱딱하다·떫다」 문의는 상한 게 아니라 후숙이 덜 된 것 — 반품·보상보다 먼저 「며칠 더 두었다가 말랑할 때 드시라」고 안내하세요.' },
    { id: 28, add: ' 맛은 새콤달콤이에요(하우스감귤보다 새콤한 편) — 「저렴하고 새콤달콤」으로 안내하세요.' },
    { id: 23, add: ' 레몬은 원래 새콤하고 산도가 높은 품목이라 「입맛에 안 맞으시면 책임지고 처리」 같은 맛 보증 문구는 붙이지 마세요 — 신맛·초록빛은 정상 특성으로만 안내하세요(다른 품목은 종전대로).' },
    { id: 24, add: ' 레몬은 원래 새콤한 품목이라 「입맛에 안 맞으시면 책임지고 처리」 같은 맛 보증 문구는 붙이지 마세요(다른 품목은 종전대로).' },
];
(async () => {
    for (const s of S) {
        const r = (await pool.query(`SELECT id, scenario_no, name, channel, response FROM inquiry_scenarios WHERE scenario_no = $1 AND deleted_at IS NULL`, [s.no])).rows[0];
        if (!r) { console.log(`#${s.no} 없음`); continue; }
        let next = r.response, why = [];
        if (s.replace) { if (next.includes(s.replace[1])) why.push('이미 반영'); else if (!next.includes(s.replace[0])) why.push('찾는 줄 없음'); else next = next.replace(s.replace[0], s.replace[1]); }
        if (s.insert) { if (next.includes(s.insert.trim())) why.push('이미 반영'); else if (!next.includes(s.find)) why.push('앵커 없음'); else next = next.replace(s.find, s.insert + s.find); }
        const chg = next !== r.response, chChg = s.channel && s.channel !== r.channel;
        console.log(`#${s.no} ${r.name} [${r.channel}${chChg ? '→' + s.channel : ''}] ${chg ? '본문 변경' : '본문 그대로'} ${why.join('·')}`);
        if (chg) console.log('   + ' + (s.insert || s.replace[1]).trim().replace(/\n/g, '\n   + '));
        if (APPLY && (chg || chChg)) {
            await pool.query(`UPDATE inquiry_scenarios SET response = $2, channel = $3, updated_at = now(), updated_by = $4 WHERE id = $1`, [r.id, next, chChg ? s.channel : r.channel, ACTOR]);
            await audit('inquiry_scenario', r.id, { before: { response: r.response, channel: r.channel }, after: { response: next, channel: chChg ? s.channel : r.channel }, note: '#488 오픈 준비' });
        }
    }
    for (const k of K) {
        const r = (await pool.query(`SELECT id, item_key, label, knowledge FROM product_season_knowledge WHERE id = $1 AND deleted_at IS NULL`, [k.id])).rows[0];
        if (!r) { console.log(`지식 ${k.id} 없음`); continue; }
        const done = r.knowledge.includes(k.add.trim());
        console.log(`지식 ${k.id} ${r.item_key} · ${r.label}: ${done ? '이미 반영' : '추가'}`);
        if (!done) console.log('   +' + k.add);
        if (APPLY && !done) {
            const next = r.knowledge.replace(/\s+$/, '') + k.add;
            await pool.query(`UPDATE product_season_knowledge SET knowledge = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [r.id, next, ACTOR]);
            await audit('season_knowledge', r.id, { before: { knowledge: r.knowledge }, after: { knowledge: next }, note: '#488 오픈 준비' });
        }
    }
    console.log(APPLY ? '\n✅ 반영 완료(audit 기록)' : '\n(조회만 — apply 인자로 반영)');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
