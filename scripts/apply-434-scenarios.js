// #434(대표 9/13 "고쳐줘"): ①품절·재입고(#31) — 무관한 판매현황 14줄 나열 제거(결론 앞으로) ②레몬을 판매현황에 「시즌종료」로 복원 등록(4채널 일관) + 시기 지식 「레몬 비시즌」 ③#39 회피형 문구 교정. DB만·audit.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #434)';
async function updScenario(no, from, to, note) {
    const cur = (await pool.query('SELECT * FROM inquiry_scenarios WHERE scenario_no=$1 AND deleted_at IS NULL', [no])).rows[0];
    if (!cur) { console.log('❌ #' + no + ' 없음'); return; }
    if (cur.response.includes(to)) { console.log('  #' + no + ' 이미 반영'); return; }
    if (!cur.response.includes(from)) { console.log('❌ #' + no + ' 원문구 불일치 — 건너뜀'); return; }
    const after = (await pool.query('UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *', [cur.response.replace(from, to), ACTOR, cur.id])).rows[0];
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','inquiry_scenario',$1,$2,'inquiry-scenario',NULL,$3)`, [cur.id, JSON.stringify({ before: cur, after, note }), ACTOR]);
    console.log('✅ #' + no, cur.name, '—', note);
}
(async () => {
    // ① #31 품절·재입고: 목록 나열 → 한 줄 링크 (결론 「품절/시즌종료 + 알림받기」가 바로 보이게)
    await updScenario(31,
        '지금 판매현황 먼저 보여드릴게요!\n\n{{판매현황}}\n',
        '지금 판매 중인 다른 상품은 스토어 전체상품에서 보실 수 있어요 → https://smartstore.naver.com/akkome\n',
        '#434 무관한 판매현황 전체 나열 제거');
    // ③ #39 품목-레몬: 회피형 → 시즌 원칙 문장(연중 참)
    await updScenario(39,
        "📅 레몬은 가을~초겨울에 '그린레몬'을 시작으로 출하돼요. 지금 판매 여부는 스토어에서 실시간 확인 가능합니다!",
        "📅 레몬은 가을~초겨울에 '그린레몬'을 시작으로 출하돼요. 시즌이 아닐 땐 판매하지 않고, 출하가 시작되면 스토어에 다시 올라와요!",
        '#434 회피형 문구 교정');
    // ② 레몬 → 판매현황 「시즌종료」 복원 (7/25 매칭정리 때 삭제됐던 id 28 — 이름 「제주 레몬」·가격 없음)
    const lm = (await pool.query('SELECT * FROM bot_products WHERE id=28')).rows[0];
    if (lm && lm.deleted_at) {
        const after = (await pool.query(`UPDATE bot_products SET deleted_at=NULL, name='제주 레몬', status='시즌종료', price='', updated_at=now(), updated_by=$1 WHERE id=28 RETURNING *`, [ACTOR])).rows[0];
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','bot_product',28,$1,'bot-product',NULL,$2)`, [JSON.stringify({ before: lm, after, note: '#434 레몬 시즌종료 복원(봇 4채널 일관 응대용·가격 없음)' }), ACTOR]);
        console.log('✅ bot_products 28 복원 → 제주 레몬 · 시즌종료');
    } else console.log('  bot_products 28 상태:', lm && lm.status, lm && lm.deleted_at ? '삭제' : '활성');
    // ② 시기 지식: 레몬 비시즌(1/1~9/30) — 봇이 "지금은 시즌 아님·가을 그린레몬부터" 확답하게. 10월부턴 지식 소멸(판매현황 상태로 답함)
    const kn = (await pool.query(`SELECT id FROM product_season_knowledge WHERE deleted_at IS NULL AND item_key='레몬'`)).rows;
    if (!kn.length) {
        const r = await pool.query(`INSERT INTO product_season_knowledge (item_key, label, start_md, end_md, knowledge, sort, enabled, updated_by) VALUES ('레몬','비시즌(그린레몬 전)','01-01','09-30',$1,1,true,$2) RETURNING id`,
            ["지금은 레몬 시즌이 아니에요 — 제주 레몬은 가을(10월 말~11월)~초겨울에 '그린레몬'부터 출하돼요. 문의엔 「지금은 시즌종료(시즌 전)라 판매하지 않고, 가을 그린레몬부터 다시 판매·상품페이지 알림받기」로 확답해 주세요. 사전예약 접수 여부는 확답하지 말고 알림받기를 안내하세요.", ACTOR]);
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('create','season_knowledge',$1,$2,'season-knowledge',NULL,$3)`, [r.rows[0].id, JSON.stringify({ item_key: '레몬', note: '#434' }), ACTOR]);
        console.log('✅ 시기 지식 레몬 비시즌 id', r.rows[0].id);
    } else console.log('  시기 지식 레몬 이미 있음', kn.map(k => k.id).join(','));
    const chk = await pool.query(`SELECT scenario_no FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled AND scenario_no=31 AND response ~ '\\{\\{판매현황\\}\\}'`);
    console.log('검산: #31 {{판매현황}} 잔존', chk.rows.length);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
