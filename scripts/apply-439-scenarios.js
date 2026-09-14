// #439(대표 9/14): ①#26 「배편 일정에 맞춰」→「택배 일정에 맞춰」(#24·#27의 배편은 실제 제주 배편(결항) 맥락이라 유지)
//   ②메시지카드 = 물었을 때만 — #47 선물포장 안내에서 메시지카드 줄·키워드 제거, 신규 #58 「메시지카드 문의」(공통) 분리. DB만·audit.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #439)';
async function audit(action, id, changes) { await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,'inquiry_scenario',$2,$3,'inquiry-scenario',NULL,$4)`, [action, id, JSON.stringify(changes), ACTOR]); }
(async () => {
    // ① #26
    const s26 = (await pool.query('SELECT * FROM inquiry_scenarios WHERE scenario_no=26 AND deleted_at IS NULL')).rows[0];
    if (s26.response.includes('배편 일정에 맞춰')) {
        const after = (await pool.query('UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *', [s26.response.replace('배편 일정에 맞춰', '택배 일정에 맞춰'), ACTOR, s26.id])).rows[0];
        await audit('update', s26.id, { before: s26, after, note: '#439 배편→택배' }); console.log('✅ #26 배편→택배');
    } else console.log('  #26 이미 반영');
    // ② #47 메시지카드 줄·키워드 제거
    const s47 = (await pool.query('SELECT * FROM inquiry_scenarios WHERE scenario_no=47 AND deleted_at IS NULL')).rows[0];
    const CARD_LINE = '메시지카드도 넣어드릴 수 있어요 — 원하시는 문구를 톡톡이나 📞 010-6687-4031 고객센터로 남겨주시면 정성껏 담아 보내드릴게요 😊\n';
    const CARD_KW = ['메시지카드', '메세지카드', '카드넣어', '편지', '카드문구'];
    if (s47.response.includes(CARD_LINE)) {
        const kw = (s47.keywords || []).filter(k => !CARD_KW.includes(k));
        const after = (await pool.query('UPDATE inquiry_scenarios SET response=$1, keywords=$2::jsonb, updated_at=now(), updated_by=$3 WHERE id=$4 RETURNING *', [s47.response.replace(CARD_LINE, ''), JSON.stringify(kw), ACTOR, s47.id])).rows[0];
        await audit('update', s47.id, { before: s47, after, note: '#439 메시지카드 줄·키워드 → #58로 분리(강조 안 함)' }); console.log('✅ #47 메시지카드 줄 제거 · 키워드', kw.length + '개');
    } else console.log('  #47 이미 반영');
    // ③ 신규 #58 메시지카드 문의 (물었을 때만)
    const ex = (await pool.query(`SELECT id FROM inquiry_scenarios WHERE deleted_at IS NULL AND name='메시지카드 문의'`)).rows[0];
    if (!ex) {
        const resp = `안녕하세요 고객님 제주아꼼이네입니다 🍊
네, 메시지카드 넣어드릴 수 있어요 💌
원하시는 문구를 톡톡이나 📞 010-6687-4031 고객센터로 남겨주시면 정성껏 담아 보내드릴게요 😊
(선물 주문은 상자 안팎 어디에도 가격이 표시되지 않으니 안심하셔도 돼요!)

*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.`;
        const r = await pool.query(`INSERT INTO inquiry_scenarios (scenario_no, name, keywords, response, action, enabled, channel, updated_by) VALUES (58,'메시지카드 문의',$1::jsonb,$2,'자동응답',true,'공통',$3) RETURNING id`, [JSON.stringify(CARD_KW), resp, ACTOR]);
        await audit('create', r.rows[0].id, { after: { scenario_no: 58, name: '메시지카드 문의', keywords: CARD_KW }, note: '#439 — 손님이 카드를 물을 때만 답하는 전용 시나리오' }); console.log('✅ #58 메시지카드 문의 생성 id', r.rows[0].id);
    } else console.log('  #58 이미 있음');
    const chk = await pool.query(`SELECT scenario_no FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled AND scenario_no<>58 AND response ~ '메시지카드|메세지카드'`);
    console.log('검산: #58 외 메시지카드 언급 시나리오', chk.rows.length ? chk.rows.map(r => '#' + r.scenario_no).join(',') : '0');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
