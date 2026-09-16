// #450-c(대표 9/16 "추석맞이 2,000원 쿠폰(9/21 08시까지)도 기간 지나면 알아서 꺼지게"): 시나리오 #60의 추석 쿠폰 줄을
//   날짜 구간이 있는 시기 지식(product_season_knowledge)으로 이전 — 09-10~09-20 구간이라 9/21 00시부터 자동 소멸(코드·사람 개입 0).
//   ⚠️ 지식은 날(日) 단위라 9/21 00:00~08:00 사이엔 봇이 추석 쿠폰을 언급하지 않음(안전한 쪽 — 만료된 쿠폰을 안내하는 것보다 낫다).
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #450-c 추석 쿠폰 자동 종료)';
const audit = (action, type, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,$2,$3,$4,'claude-code',NULL,$5)`, [action, type, id, JSON.stringify(changes), ACTOR]);
const KNOW = '스마트스토어 「추석맞이 쿠폰」 2,000원이 발급 중이에요 — 9월 21일(월) 오전 8시까지만 사용 가능(1아이디 1회). 쿠폰·할인·가격 변동 문의에는 알림받기 1,000원·등급 쿠폰과 함께 이 쿠폰도 안내하세요. 9월 21일 오전 8시가 지나면 종료된 쿠폰이니 그 뒤엔 언급하지 마세요.';
(async () => {
    // ① 시기 지식 신설(있으면 갱신)
    const ex = (await pool.query(`SELECT id, knowledge FROM product_season_knowledge WHERE deleted_at IS NULL AND item_key='쿠폰' AND label='추석맞이 2026'`)).rows[0];
    let kid;
    if (ex) {
        kid = ex.id;
        if (ex.knowledge !== KNOW) { await pool.query(`UPDATE product_season_knowledge SET knowledge=$1, start_md='09-10', end_md='09-20', enabled=true, updated_by=$2, updated_at=now() WHERE id=$3`, [KNOW, ACTOR, kid]); await audit('update', 'product_season_knowledge', kid, { before: ex.knowledge, after: KNOW }); console.log('✅ 지식 갱신 id', kid); }
        else console.log('  지식 이미 있음 id', kid);
    } else {
        const r = await pool.query(`INSERT INTO product_season_knowledge (item_key, label, start_md, end_md, knowledge, sort, enabled, updated_by, updated_at) VALUES ('쿠폰','추석맞이 2026','09-10','09-20',$1,1,true,$2,now()) RETURNING id`, [KNOW, ACTOR]);
        kid = r.rows[0].id;
        await audit('create', 'product_season_knowledge', kid, { after: { item_key: '쿠폰', label: '추석맞이 2026', start_md: '09-10', end_md: '09-20', knowledge: KNOW }, note: '#450-c — 09-20 지나면 자동 소멸' });
        console.log('✅ 시기 지식 신설 id', kid, '(09-10~09-20)');
    }
    // ② #60에서 추석 줄 제거 + 💡 줄의 「추석」 표기를 시기 무관으로
    const row = (await pool.query(`SELECT id, response FROM inquiry_scenarios WHERE scenario_no=60 AND deleted_at IS NULL`)).rows[0];
    const L1 = '· 추석맞이 쿠폰 2,000원 — 9월 21일(월) 오전 8시까지 사용 가능해요\n';
    const L2 = '지난 주문에 적용됐던 쿠폰(등급·알림받기·추석)이';
    const L2n = '지난 주문에 적용됐던 쿠폰(등급·알림받기·행사 쿠폰)이';
    let next = row.response, changed = [];
    if (next.includes(L1)) { next = next.replace(L1, ''); changed.push('추석 줄 제거'); }
    if (next.includes(L2)) { next = next.replace(L2, L2n); changed.push('💡 줄 시기 무관화'); }
    if (changed.length) {
        await pool.query(`UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3`, [next, ACTOR, row.id]);
        await audit('update', 'inquiry_scenarios', row.id, { note: '#450-c ' + changed.join('·') + ' — 추석 쿠폰은 시기 지식으로 이전', before: row.response, after: next });
        console.log('✅ #60(id ' + row.id + '):', changed.join(' · '));
    } else console.log('  #60 변경 없음');
    console.log('검산 #60 「추석」 잔존:', /추석/.test(next));
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
