// #445(대표 9/15 실물 "예시) 9월 24일 도착 희망 — 명절 마지막 발송이 21일이라 문구 수정"): 시나리오 #26(id 27) 예시 날짜가 DB엔 「8월 25일」인데
//   AI가 오늘 기준으로 예시 날짜를 새로 지어 연휴(9/22~26) 날짜를 넣었음 → ①시나리오 예시를 날짜 중립으로(플레이북: 날짜는 시기 지식에만)
//   ②시기 지식 id 14(추석)에 「도착 희망 예시·지정 날짜 규칙」 명시(연휴 날짜 금지·명절 전 도착 = 9/20~21). DB만·코드 무접촉·audit.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #445 도착 희망 예시)';
const audit = (action, type, id, changes, source) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5,NULL,$6)`, [action, type, id, JSON.stringify(changes), source, ACTOR]);
const FROM = '📅 원하시는 수령일이 있으시면 주문하시면서 배송메세지에 "예시) 8월 25일 도착 희망"이라고 남겨주세요! 저희가 택배 일정에 맞춰 발송일을 조절해드립니다.';
const TO = '📅 원하시는 수령일이 있으시면 주문하시면서 배송메세지에 "○월 ○일 도착 희망"이라고 원하시는 날짜를 남겨주세요! 저희가 택배 일정에 맞춰 발송일을 조절해드립니다.\n(택배 휴무일·명절 연휴에는 도착이 불가하니, 연휴 전 도착을 원하시면 연휴 전 마지막 발송일에 맞춰 여유 있게 주문해주세요)';
const KN_ADD = '\n★ 도착 희망(수령일) 문의: 예시 날짜를 지어서 안내할 땐 9월 22일~26일(택배 휴무·연휴)은 절대 쓰지 말 것. 명절 전 도착 희망은 「9월 20일(일)~21일(월) 도착 희망」(9월 21일 오전 8시 이전 주문)으로, 연휴 중 날짜(9/22~26) 도착 지정을 요청하면 「연휴 중 도착은 불가 — 9월 21일 발송분으로 미리 받으시거나 9월 27일 이후 도착」으로 안내.';
(async () => {
    const cur = (await pool.query('SELECT * FROM inquiry_scenarios WHERE id=27 AND deleted_at IS NULL')).rows[0];
    if (!cur) throw new Error('시나리오 id 27 없음');
    if (cur.response.includes(TO)) console.log('  #26 이미 반영');
    else if (!cur.response.includes(FROM)) console.log('❌ #26 원문구 불일치 — 건너뜀');
    else {
        const after = (await pool.query('UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=27 RETURNING *', [cur.response.replace(FROM, TO), ACTOR])).rows[0];
        await audit('update', 'inquiry_scenario', 27, { before: { response: cur.response }, after: { response: after.response }, note: '#445 도착 희망 예시 날짜 중립화 + 연휴 도착 불가 문장' }, 'inquiry-scenario');
        console.log('✅ 시나리오 id 27 (#26) 교체');
    }
    const k = (await pool.query('SELECT * FROM product_season_knowledge WHERE id=14 AND deleted_at IS NULL')).rows[0];
    if (!k) throw new Error('지식 id 14 없음');
    if (k.knowledge.includes('도착 희망(수령일) 문의')) console.log('  지식 14 이미 반영');
    else {
        const after = (await pool.query('UPDATE product_season_knowledge SET knowledge=$1, updated_by=$2, updated_at=now() WHERE id=14 RETURNING *', [k.knowledge + KN_ADD, ACTOR])).rows[0];
        await audit('update', 'season_knowledge', 14, { before: { knowledge: k.knowledge }, after: { knowledge: after.knowledge }, note: '#445 도착 희망 예시·연휴 날짜 규칙 추가' }, 'season-knowledge');
        console.log('✅ 지식 id 14 규칙 추가');
    }
    const chk = await pool.query(`SELECT id, scenario_no FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled = true AND response ~ '9월 2[2-6]일'`);
    console.log('활성 시나리오에 9/22~26 날짜 잔존:', chk.rows.length, JSON.stringify(chk.rows));
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
