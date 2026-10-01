// #494(대표 확정 10/1 — #492 봇 30문항 ⚠️4 후속): 시나리오·시기 지식 사실 반영 (DB만 · 코드 0 · 멱등 · audit)
//   A 합포장 불가(품목별 따로 포장 · 혼합 세트는 시즌별 별도 상품) → #19 한 줄 + 키워드
//   B 한라봉 등 만감류 비교 = 개인 취향 · 각 장점(황금향 과즙·향 / 한라봉 새콤달콤 특유의 맛·대표 제주 만감류) · 시기(한라봉·레드향 1~3월 · 천혜향 2~4월) → 지식 9
//   C 유라조생 = 10월 판매 · 11월 전쯤 마감 → 일반 조생 · 하우스감귤도 같은 시기 종료 → 타이벡 → #67 한 줄 + 지식 28
//   D 추석 → 「선물용 페이지」 표현 · 지금 시기 = 황금향 · 한라봉·천혜향·레드향은 그 시기 → #54 문구·이름 · #57 이름
//   node scripts/apply-494-bot-facts.js        (조회) / apply
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv[2] === 'apply';
const ACTOR = '클코 총괄(대표 확정 #494 · 봇 사실 반영)';
const audit = (t, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', $1, $2, $3, 'agent_office', $4)`, [t, id, JSON.stringify(changes), ACTOR]);
// [table, target_type, column, where, find, replace]  — find가 없으면 「없음」, replace가 이미 있으면 「이미 반영」
const R = [
    // A #19: 안내 끝 줄 앞에 합포장 불가 한 줄
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 19',
        '📦 개별배송 주문은 네이버 마이페이지에 대표 송장번호 1개만 표시돼요.',
        '📦 서로 다른 품목(감귤·황금향·레몬·키위 등)은 품목별로 따로 포장돼 각각 박스로 나가요 — 한 박스에 섞어 담는 합포장은 안 돼요. (여러 품목을 한 박스에 담은 혼합 선물세트는 시즌에 맞춰 따로 상품으로 나와요)\n📦 개별배송 주문은 네이버 마이페이지에 대표 송장번호 1개만 표시돼요.'],
    // C #67: 판매 기간 줄
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 67',
        '📅 짧게 나오는 품종이라, 그 뒤로는 일반 조생(새콤달콤)과 타이벡(고당도)으로 노지감귤을 출하해요.',
        '📅 유라조생은 10월에 판매하고 11월 전쯤 마감돼요(수확량에 따라 조기 마감될 수 있어요). 그 뒤로는 일반 조생(새콤달콤)과 타이벡(고당도)으로 노지감귤을 이어서 출하하고, 하우스감귤도 같은 시기에 종료돼요.'],
    // D #54: 추석 → 선물용 페이지 표현
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 54',
        '추석 선물 문의 주셔서 감사합니다 😊',
        '선물 문의 주셔서 감사합니다 😊'],
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 54',
        '⏰ 추석 전에 받으시려면',
        '⏰ 명절 전에 받으시려면'],
    ['inquiry_scenarios', 'inquiry_scenario', 'response', 'scenario_no = 54',
        '🎁 명절 선물은 지금 가장 제철인 선물용 상품으로 정성껏 준비해드려요!',
        '🎁 선물은 선물용 페이지에서 지금 가장 제철인 품목으로 정성껏 준비해드려요 — 지금 시기는 황금향이에요. 한라봉·레드향(1~3월)·천혜향(2~4월)은 그 시기에 선물용으로 나와요.'],
    ['inquiry_scenarios', 'inquiry_scenario', 'name', 'scenario_no = 54',
        '[추석] 선물 주문 마감·연휴 배송 일정',
        '명절·선물 주문 마감·연휴 배송 일정'],
    ['inquiry_scenarios', 'inquiry_scenario', 'name', 'scenario_no = 57',
        '[추석] VIP 선물세트 구성 안내',
        'VIP 선물세트 구성 안내'],
    // B 지식 9(황금향 5~11월): 만감류 비교 지시
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 9',
        '과즙이 많아 냉장 후 시원하게 드시면 좋아요.',
        '과즙이 많아 냉장 후 시원하게 드시면 좋아요. 한라봉·천혜향·레드향 등 다른 만감류와 비교 문의가 오면 직원에게 넘기지 말고 짧게 답하세요: 지금은 황금향만 판매 중이고(황금향 = 과즙이 많고 향이 좋음), 한라봉은 새콤달콤한 특유의 맛이 있는 대표 제주 만감류예요 — 어느 쪽이 더 맛있는지는 개인 취향이라 각 장점만 안내하세요. 시기는 한라봉 1~3월 · 레드향 1~3월 · 천혜향 2~4월이에요(대표 확정 2026-10-01).'],
    // C 지식 28(유라조생 10월): 판매 기간 답
    ['product_season_knowledge', 'season_knowledge', 'knowledge', 'id = 28',
        '11월부터는 일반 조생(새콤달콤)과 타이벡(고당도)으로 출하가 이어져요.',
        '판매 기간을 물으면 「10월에 판매하고 11월 전쯤 마감(수확량에 따라 조기 마감 가능)」으로 답하세요 — 날짜를 확답하지 말고 「11월 전쯤」까지만. 그 뒤로는 일반 조생(새콤달콤)과 타이벡(고당도)으로 출하가 이어지고, 하우스감귤도 같은 시기에 종료되어 타이벡으로 넘어가요(다른 농가는 더 팔기도 하지만 저희는 이 순서로 운영 — 대표 확정 2026-10-01).'],
];
const KW19 = ['같이보내', '함께보내', '합포장', '한박스에', '섞어서', '같이담아', '한상자에'];
(async () => {
    for (const [table, ttype, col, where, a, b] of R) {
        const row = (await pool.query(`SELECT id, ${col} AS v FROM ${table} WHERE ${where} AND deleted_at IS NULL`)).rows[0];
        if (!row) { console.log('❌', table, where, '없음'); continue; }
        const done = row.v.includes(b) && !row.v.replace(b, '').includes(a), found = !done && row.v.includes(a);   // 바꿀 글이 있고, 그걸 뺀 나머지에 찾는 글이 없을 때만 「이미 반영」(a⊂b · b⊂a 양쪽 함정 회피)
        console.log(`${done ? '·' : found ? '→' : '❌'} ${table} #${row.id} ${col}: ${done ? '이미 반영' : found ? '교체' : '찾는 줄 없음'}`);
        if (APPLY && !done && found) {
            const next = row.v.replace(a, b);
            await pool.query(`UPDATE ${table} SET ${col} = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [row.id, next, ACTOR]);
            await audit(ttype, row.id, { before: { [col]: row.v }, after: { [col]: next }, note: '#494' });
        }
    }
    // #19 키워드 추가(합포장 질문이 닿도록)
    const s19 = (await pool.query(`SELECT id, keywords FROM inquiry_scenarios WHERE scenario_no = 19 AND deleted_at IS NULL`)).rows[0];
    const kw = Array.isArray(s19.keywords) ? s19.keywords : JSON.parse(s19.keywords || '[]');
    const add = KW19.filter(k => !kw.includes(k));
    console.log(`#19 키워드 추가 ${add.length}개: ${add.join(', ') || '(없음)'}`);
    if (APPLY && add.length) {
        const next = kw.concat(add);
        await pool.query(`UPDATE inquiry_scenarios SET keywords = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [s19.id, JSON.stringify(next), ACTOR]);
        await audit('inquiry_scenario', s19.id, { before: { keywords: kw }, after: { keywords: next }, note: '#494 합포장 키워드' });
    }
    console.log(APPLY ? '✅ 반영 완료 (톡톡봇 캐시 5분)' : '(조회만 — apply로 반영)');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
