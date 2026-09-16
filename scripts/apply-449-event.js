// #449(대표 GO 9/16 "1번(/guide 이벤트 카드) + 봇 시나리오 · 1회성 · 무회귀"): ① agent_office_config 'guide_event_card' 등록(발송안내 알림톡 버튼 페이지 상단 블록 — 코드 v5.9.321)
//   ② 시나리오 #59 「추석 이벤트 안내」(공통) 신설. 전건 audit. 이벤트 종료 후 = `node scripts/apply-449-event.js off`(설정 enabled false + #59 비활성). end(09-30) 경과 시 카드는 자동 소멸.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #449 추석 이벤트 안내)';
const audit = (action, type, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,$2,$3,$4,'claude-code',NULL,$5)`, [action, type, id, JSON.stringify(changes), ACTOR]);
const CFG = {
    enabled: true,
    title: '🎁 제주아꼼이네 추석 이벤트',
    lines: [
        '9월 10일 ~ 9월 21일(월) 오전 8시 주문 고객 대상, 기간 내 주문 건은 자동 응모됐어요.',
        '총 22명 추첨: 1등 황금향 5kg 선물용(5명) · 2등 황금향 3kg 선물용(7명) · 3등 감귤 3kg 선물용(10명)',
        '당첨자 발표 9월 21일(월). 주문하신 분 성함 또는 휴대폰 번호로 접수·당첨을 확인하실 수 있어요.',
    ],
    btn: '접수·당첨 확인 바로가기',
    url: 'https://event.akkome.com/lucky.html',
    start: '2026-09-10', end: '2026-09-30',
};
const KW = ['이벤트', '추첨', '응모', '경품', '당첨자', '이벤트 당첨', '이벤트당첨', '당첨 확인', '당첨확인', '럭키', '할인쿠폰', '할인 쿠폰', '추석 이벤트', '추석이벤트'];
const RESP = [
    '안녕하세요 고객님 제주아꼼이네입니다 🍊',
    '추석 이벤트 문의 주셔서 감사합니다 😊',
    '',
    '🎁 제주아꼼이네 추석 이벤트 (9월 10일 ~ 9월 21일(월) 오전 8시 주문 고객 대상)',
    '✅ 기간 내 주문 건은 자동 응모돼요. 따로 신청하실 필요 없어요!',
    '🏆 총 22명 추첨: 1등 황금향 5kg 선물용(5명) · 2등 황금향 3kg 선물용(7명) · 3등 감귤 3kg 선물용(10명)',
    '🎟 2,000원 할인 쿠폰 혜택도 함께 드려요 (쿠폰 적용 기간 9월 10일 ~ 9월 21일 오전 8시)',
    '📅 당첨자 발표: 9월 21일(월)',
    '🔍 접수·당첨 확인: 주문하신 분 성함 또는 휴대폰 번호로 조회하실 수 있어요 (선물하기 주문은 받는 분 연락처로도 확인 가능)',
    '▶ https://event.akkome.com/lucky.html',
    '',
    '*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.',
].join('\n');
(async () => {
    const mode = process.argv[2] || 'apply';
    if (mode === 'off') {   // 이벤트 종료용: 설정 끄기 + #59 비활성
        await pool.query(`UPDATE agent_office_config SET value = value || '{"enabled":false}'::jsonb, updated_at=NOW() WHERE key='guide_event_card'`);
        const r = await pool.query(`UPDATE inquiry_scenarios SET enabled=false, updated_at=now(), updated_by=$1 WHERE scenario_no=59 AND deleted_at IS NULL RETURNING id`, [ACTOR]);
        await audit('update', 'agent_office_config', null, { key: 'guide_event_card', enabled: false, note: '#449 이벤트 종료' });
        for (const x of r.rows) await audit('update', 'inquiry_scenarios', x.id, { enabled: false, note: '#449 이벤트 종료' });
        console.log('✅ off: 카드 설정 enabled=false · #59 비활성', r.rows.length); await pool.end(); return;
    }
    // ① 카드 설정
    const prev = (await pool.query(`SELECT value FROM agent_office_config WHERE key='guide_event_card'`)).rows[0];
    await pool.query(`INSERT INTO agent_office_config (key,value,updated_at) VALUES ('guide_event_card',$1::jsonb,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify(CFG)]);
    await audit(prev ? 'update' : 'create', 'agent_office_config', null, { key: 'guide_event_card', before: prev ? prev.value : null, after: CFG });
    console.log('✅ guide_event_card 설정', prev ? '갱신' : '신규');
    // ② 시나리오 #59
    const ex = await pool.query(`SELECT id FROM inquiry_scenarios WHERE scenario_no=59 AND deleted_at IS NULL`);
    if (ex.rows.length) { console.log('  #59 이미 있음 id', ex.rows[0].id); }
    else {
        const r = await pool.query(`INSERT INTO inquiry_scenarios (scenario_no, name, keywords, response, action, enabled, channel, updated_by) VALUES (59,'추석 이벤트 안내',$1::jsonb,$2,'자동응답',true,'공통',$3) RETURNING id`, [JSON.stringify(KW), RESP, ACTOR]);
        await audit('create', 'inquiry_scenarios', r.rows[0].id, { after: { scenario_no: 59, name: '추석 이벤트 안내', keywords: KW, response: RESP }, note: '#449 추석 이벤트(1회성) — 종료 시 비활성' });
        console.log('✅ #59 추석 이벤트 안내 생성 id', r.rows[0].id);
    }
    const chk = await pool.query(`SELECT scenario_no, name FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled AND scenario_no<>59 AND (response ~ '룰렛|이벤트|경품|추첨' OR keywords::text ~ '룰렛|이벤트|경품|추첨|당첨')`);
    console.log('검산: #59 외 이벤트/룰렛/당첨 관련 활성 시나리오', chk.rows.length ? JSON.stringify(chk.rows) : '0');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
