// #446(대표 9/15 "추석 연휴 주문 = 27일 발송으로 확실히 · 보내는 분 표기 답변 결론 먼저 · 무회귀 · 팩트 전달"): DB만·audit
//   ① 시기 지식 id 14 첫 단락 = 사실 3줄로 재작성(21일 08시 이전 = 21일 발송·22일 도착 / 그 이후~26일 주문 = 전부 27일 발송·28~29 도착 / 22일은 도착만·23~26 도착 없음)
//   ② 시나리오 #15(id 16) 보내는이 변경 = 「네, 가능해요」 결론 먼저 + 방법 + 기결제 안내 (키워드·채널 무변경)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #446 연휴 발송 팩트·보내는이 표기)';
const audit = (action, type, id, changes, source) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5,NULL,$6)`, [action, type, id, JSON.stringify(changes), source, ACTOR]);
const KN_OLD_HEAD = '추석(9/25) 발송 안내예요. 추석 전 마지막 발송 = 9월 21일(월), 9월 22일(화)~26일(토)은 택배사 휴무로 발송 없음, 발송 재개 = 9월 27일(일)부터.';
const KN_NEW_HEAD = [
    '추석(9/25) 발송 안내예요 — 아래 3가지는 확정 사실이니 그대로 확실하게 전달하세요.',
    '① 추석 전 마지막 발송 = 9월 21일(월). 9월 21일 오전 8시 이전 주문분까지 21일 발송 → 9월 22일(화) 도착.',
    '② 9월 21일 오전 8시 이후 ~ 9월 26일(토) 주문분(추석 연휴 중 주문 전부 포함) = 예외 없이 9월 27일(일) 발송 → 9월 28일(월)~29일(화) 도착. "연휴에도 배송되나요/연휴에 주문하면"류 질문엔 「연휴 중 주문은 9월 27일(일) 발송」이라고 첫 문장에서 바로 말할 것.',
    '③ 9월 22일(화)~26일(토)은 택배사 휴무로 발송 없음. 22일(화)은 21일 발송분이 도착하는 날이고, 23일(수)~26일(토)은 도착도 없음. "연휴 기간 발송·도착 모두 불가"처럼 뭉뚱그리지 말고 위 사실대로 구분해서 말할 것.',
].join('\n');
const SC_NEW = [
    '안녕하세요 제주아꼼이네입니다 🍊',
    '네, 보내는 분 성함 표기 가능해요! ✅',
    '✏️ 주문하시면서 배송메세지에 "○○○ 드림"이라고 남겨주시면, 송장의 보내는 사람 이름을 그 성함으로 넣어 보내드립니다.',
    '(구매자와 보내는 분이 같으면 구매자 성함으로 나가니 따로 적지 않으셔도 돼요)',
    '이미 결제하신 건이라면 톡톡 또는 📞 010-6687-4031 고객센터로 말씀해주시면 발송 전에 수정해드리겠습니다.',
    '늘 고객님 입장에서 만족드리도록 제주에서 최선을 다하겠습니다. 감사합니다! 🙏',
    '',
    '*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.',
].join('\n');
(async () => {
    const k = (await pool.query('SELECT * FROM product_season_knowledge WHERE id=14 AND deleted_at IS NULL')).rows[0];
    if (k.knowledge.startsWith(KN_NEW_HEAD)) console.log('  지식 14 이미 반영');
    else if (!k.knowledge.startsWith(KN_OLD_HEAD)) console.log('❌ 지식 14 원문 불일치 — 건너뜀');
    else {
        const after = (await pool.query('UPDATE product_season_knowledge SET knowledge=$1, updated_by=$2, updated_at=now() WHERE id=14 RETURNING *', [k.knowledge.replace(KN_OLD_HEAD, KN_NEW_HEAD), ACTOR])).rows[0];
        await audit('update', 'season_knowledge', 14, { before: { knowledge: k.knowledge }, after: { knowledge: after.knowledge }, note: '#446 연휴 발송 사실 3줄(연휴 중 주문 = 27일 발송·22일 도착만·23~26 도착 없음)' }, 'season-knowledge');
        console.log('✅ 지식 14 첫 단락 재작성');
    }
    const s = (await pool.query('SELECT * FROM inquiry_scenarios WHERE id=16 AND deleted_at IS NULL')).rows[0];
    if (s.response === SC_NEW) console.log('  시나리오 16 이미 반영');
    else {
        const after = (await pool.query('UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=16 RETURNING *', [SC_NEW, ACTOR])).rows[0];
        await audit('update', 'inquiry_scenario', 16, { before: { response: s.response }, after: { response: after.response }, note: '#446 보내는이 표기 — 결론(가능) 먼저·방법·기결제 안내 (키워드·채널 무변경)' }, 'inquiry-scenario');
        console.log('✅ 시나리오 id 16 (#15) 교체');
    }
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
