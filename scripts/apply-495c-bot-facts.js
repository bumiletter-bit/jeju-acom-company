// #495-c(대표 확정 10/1 12:2x · DB · 멱등 · audit): SKIP 사실 4종 + ⚠️ 손보기
//   사실: 레드키위 = 그린키위와 품종 다름 · 껍질째 OK(간단 세척) / 그린레몬 = 왁스 코팅 없음 · 주문 후 수확 발송
//   손보기: #32 타이벡 11월부터 한 줄 · 지식 9 초록빛 질문 바로 답하기 · #57 VIP 선물용 페이지 링크 + 키워드 · #29 하우스·유라는 못난이 없음 한 줄
//   node scripts/apply-495c-bot-facts.js   (조회) / apply
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv[2] === 'apply';
const ACTOR = '클코 총괄(대표 확정 #495-c)';
const audit = (t, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', $1, $2, $3, 'agent_office', $4)`, [t, id, JSON.stringify(changes), ACTOR]);
const TAIL = '\n\n*추가 문의사항';
// [table, type, col, where, find(null=덧붙임), replace/append]
const R = [
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 66', null,
        '\n🥝 그린키위와는 품종이 달라요(속이 붉은 레드키위 품종). 껍질째 드셔도 돼요 — 간단히 세척한 뒤 드시면 됩니다.'],
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 26', null,
        ' 그린키위와 품종이 다르고(속이 붉은 레드키위), 껍질째 먹어도 돼요(간단히 세척 후) — 대표 확정 2026-10-01.'],
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 39', null,
        '\n🍋 왁스 코팅 없이 그대로 나가요 — 세척 후 껍질째 청·요리에 쓰셔도 돼요. 주문 후 수확해서 보내드려요.'],
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 23', null,
        ' 왁스 코팅 없음(세척 후 껍질째 사용 가능) · 주문 후 수확해서 발송 — 대표 확정 2026-10-01.'],
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 32',
        '📅 노지감귤: 10월은 첫 노지귤 유라조생, 11월~1월은 일반 조생·타이벡이에요 (고당도 타이벡은 인기가 많아 조기 마감이 잦아요)',
        '📅 노지감귤: 10월은 첫 노지귤 유라조생, 11월~1월은 일반 조생·타이벡이에요 (고당도 타이벡은 인기가 많아 조기 마감이 잦아요)\n📅 타이벡 감귤은 11월부터(유라조생 마감 뒤) 판매를 시작해요 — 정확한 날짜는 미정이라 상품페이지 "알림받기"를 눌러두시면 바로 알려드려요.'],
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 9', null,
        ' 「껍질이 초록빛/푸른빛인데 익은 거냐」는 질문은 직원에게 넘기지 말고 바로 「하우스 황금향은 겉에 푸른끼가 있어도 다 익은 것 — 걱정 없이 드셔도 된다」고 답하세요.'],
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 57',
        '두 품목 모두 지금이 딱 제철이라 가장 맛있는 시기예요! 선물박스 + 외피박스로 정성껏 포장해 보내드립니다 🎁',
        '두 품목 모두 지금이 딱 제철이라 가장 맛있는 시기예요! 선물박스 + 외피박스로 정성껏 포장해 보내드립니다 🎁\n💝 황금향·하우스감귤 선물용을 한 페이지에서 고르실 수 있는 VIP 선물용 페이지예요(일반 페이지보다 저렴) ▶ https://brand.naver.com/jejuakkome/products/10801253976\n(서로 다른 품목을 한 박스에 섞어 담는 합포장은 안 되고, 품목별로 각각 포장돼 나가요)'],
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 29',
        '집에서 드실 거면 못난이, 선물하실 거면 선물용을 추천드려요!',
        '집에서 드실 거면 못난이, 선물하실 거면 선물용을 추천드려요!\n🍊 하우스감귤·유라조생은 못난이 구성이 없어요 — 선물용(로얄과 선별 + 선물 포장)과 가정용(같은 로얄과 · 가정 포장 · 배송메세지로 사이즈 지정 가능)의 차이예요.'],
];
const KW57 = ['같이선물', '세트로있', '선물세트있', '두가지선물', '같이구성', '세트는없'];
(async () => {
    for (const [table, ttype, col, where, a, b] of R) {
        const row = (await pool.query(`SELECT id, ${col} AS v FROM ${table} WHERE ${where} AND deleted_at IS NULL`)).rows[0];
        if (!row) { console.log('❌', table, where, '없음'); continue; }
        let next = null, label;
        if (a) { const done = row.v.includes(b) && !row.v.replace(b, '').includes(a); const found = !done && row.v.includes(a); label = done ? '이미 반영' : found ? '교체' : '찾는 줄 없음'; if (found) next = row.v.replace(a, b); }
        else { const done = row.v.includes(b.trim()); label = done ? '이미 반영' : '덧붙임'; if (!done) next = (col === 'response' && row.v.includes(TAIL)) ? row.v.replace(TAIL, b + TAIL) : row.v.trimEnd() + b; }
        console.log(`${next ? '→' : '·'} ${table} #${row.id} ${col}: ${label}`);
        if (APPLY && next) {
            await pool.query(`UPDATE ${table} SET ${col} = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [row.id, next, ACTOR]);
            await audit(ttype, row.id, { before: { [col]: row.v }, after: { [col]: next }, note: '#495-c' });
        }
    }
    const s57 = (await pool.query(`SELECT id, keywords FROM inquiry_scenarios WHERE scenario_no = 57 AND deleted_at IS NULL`)).rows[0];
    const kw = Array.isArray(s57.keywords) ? s57.keywords : JSON.parse(s57.keywords || '[]');
    const add = KW57.filter(k => !kw.includes(k));
    console.log(`#57 키워드 추가 ${add.length}개: ${add.join(', ') || '(없음)'}`);
    if (APPLY && add.length) {
        const next = kw.concat(add);
        await pool.query(`UPDATE inquiry_scenarios SET keywords = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [s57.id, JSON.stringify(next), ACTOR]);
        await audit('inquiry_scenario', s57.id, { before: { keywords: kw }, after: { keywords: next }, note: '#495-c VIP 세트 키워드' });
    }
    console.log(APPLY ? '✅ 반영 완료 (톡톡봇 캐시 5분)' : '(조회만 — apply로 반영)');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
