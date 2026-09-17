// #451(대표 9/17 "룰렛 실물 당첨 쿠폰 10% — 회원 190931213@n 미지급 1건 처리"): #433(5%) 절차 그대로 10%판.
//   ① 「10% 할인쿠폰(룰렛)」 정의 — 있으면 재사용(R형·미삭제), 없으면 생성(선례 5%(룰렛) 설정 복제·발급일부터 30일·percentage 10)
//   ② 회원 1명에게만 발급(issued_member_scope 'M') — 이미 보유면 생략 ③ 보유 재조회 검산(카페24 조회 지연 대비 최대 6회×60s) ④ reward_grants 지급완료 + audit
//   사용: node scripts/apply-451-coupon10.js [MEMBER] [GRANT_ID]   (기본 190931213@n / 4)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const NAME = '10% 할인쿠폰(룰렛)', DAYS = 30, PCT = 10, KIND = 'coupon10';
const MEMBER = process.argv[2] || '190931213@n', GRANT_ID = Number(process.argv[3] || 4);
const KNOWN = process.env.COUPON10_NO || '';   // 생성 성공 후 번호를 여기(또는 env)에 고정하면 목록 지연 시에도 중복 생성 방지
const ACTOR = '클코(대표 지시 #451 룰렛 10% 쿠폰 지급)';
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
const listCoupons = async () => { let all = []; for (const offset of [0, 100]) { const r = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/coupons', query: { limit: 100, offset } }); if (!(r.raw && r.raw.ok)) return { err: r }; const cs = (((r.raw.data) || {}).coupons) || []; all = all.concat(cs); if (cs.length < 100) break; } return { all }; };
(async () => {
    const cur = (await pool.query(`SELECT g.*, m.member_key FROM reward_grants g JOIN mall_members m ON m.id=g.member_id WHERE g.id=$1`, [GRANT_ID])).rows[0];
    if (!cur || cur.member_key !== MEMBER || cur.kind !== KIND) throw new Error('당첨 행 불일치: ' + JSON.stringify(cur));
    if (cur.status === 'granted') { console.log('이미 지급완료 행 — 종료'); await pool.end(); return; }
    const lc = await listCoupons();
    if (!lc.all) throw new Error('쿠폰 목록 조회 실패: ' + JSON.stringify(lc.err).slice(0, 200));
    const tenPct = lc.all.filter(c => c.deleted !== 'T' && Number(c.benefit_percentage) === PCT);
    console.log('기존 10% 정의:', tenPct.map(c => `${c.coupon_no} ${c.coupon_name} [${c.available_period_type}${c.available_period_type === 'R' ? ' ' + c.available_day_from_issued + '일' : ' ' + String(c.available_begin_datetime).slice(0, 10) + '~' + String(c.available_end_datetime).slice(0, 10)}]`).join(' | ') || '없음');
    let def = (KNOWN && lc.all.find(c => String(c.coupon_no) === KNOWN)) || lc.all.find(c => c.coupon_name === NAME && c.available_period_type === 'R' && c.deleted !== 'T');
    if (def) console.log('기존 정의 재사용:', def.coupon_no, `${def.available_day_from_issued}일`);
    else {
        const body = { shop_no: 1, request: {
            coupon_name: NAME, benefit_type: 'B', issue_type: 'M', issue_sub_type: 'M',
            available_period_type: 'R', available_day_from_issued: DAYS, available_begin_datetime: null, available_end_datetime: null,
            available_site: ['W', 'M', 'P'], available_scope: 'O', available_product: 'U', available_category: 'U',
            available_amount_type: 'E', available_coupon_count_by_order: 1, available_price_type: 'U',
            discount_rate: { benefit_percentage: PCT, benefit_percentage_round_unit: '0.1', benefit_percentage_max_price: 0 },
            issue_reserved: 'F', same_user_reissue: 'F', include_regional_shipping_rate: 'F', include_foreign_delivery: 'F', show_product_detail: 'F',
        } };
        const cr = await runner({ action: 'raw', method: 'POST', path: '/api/v2/admin/coupons', body });
        console.log('정의 생성 응답:', JSON.stringify(cr).slice(0, 400));
        if (!(cr.raw && cr.raw.ok)) throw new Error('정의 생성 실패 — 중단(발급 0)');
        const created = (((cr.raw.data) || {}).coupon) || {};
        const no = created.coupon_no ? String(created.coupon_no) : null;
        console.log('🔴 생성된 coupon_no(기록 필수):', no);
        await new Promise(r => setTimeout(r, 5000));
        const lc2 = await listCoupons();
        def = (lc2.all || []).find(c => (no && String(c.coupon_no) === no) || (c.coupon_name === NAME && c.available_period_type === 'R' && c.deleted !== 'T'));
        if (!def && no) { const one = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/coupons', query: { coupon_no: no } }); def = ((((one.raw || {}).data || {}).coupons) || [])[0]; }
        if (!def && no) def = { coupon_no: no, available_period_type: 'R', available_day_from_issued: DAYS, benefit_percentage: PCT };   // 조회 지연 — 생성 응답 번호로 진행
        if (!def) throw new Error('생성 후 정의를 찾지 못함 — 중단(중복 생성 금지 · 관리자에서 확인)');
        if (def.available_period_type !== 'R' || Number(def.available_day_from_issued) !== DAYS || Number(def.benefit_percentage) !== PCT) throw new Error('생성된 정의가 의도와 다름 — 발급 중단: ' + JSON.stringify(def).slice(0, 200));
        console.log('✅ 정의 생성:', def.coupon_no);
    }
    const COUPON_NO = String(def.coupon_no);
    const mine = (r) => ((((r.raw || {}).data || {}).coupons) || []).filter(c => String(c.coupon_no) === COUPON_NO);
    const before = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/customers/${encodeURIComponent(MEMBER)}/coupons`, query: { limit: 100 } });
    if (mine(before).length) console.log('이미 보유 — 발급 생략');
    else {
        const iss = await runner({ action: 'raw', method: 'POST', path: `/api/v2/admin/coupons/${COUPON_NO}/issues`,
            body: { shop_no: 1, request: { issued_member_scope: 'M', member_id: MEMBER, send_sms_for_issue: 'F', allow_duplication: 'F', single_issue_per_once: 'T' } } });
        console.log('발급 응답:', JSON.stringify(iss).slice(0, 300));
        if (!(iss.raw && iss.raw.ok)) throw new Error('발급 실패');
    }
    let got = null;
    for (let i = 0; i < 6 && !got; i++) {
        const r = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/customers/${encodeURIComponent(MEMBER)}/coupons`, query: { limit: 100 } });
        got = mine(r)[0] || null;
        console.log(`  보유 조회 ${i + 1}: ${got ? '✅ 있음' : '아직 없음(카페24 지연)'}`);
        if (!got) await new Promise(r => setTimeout(r, 60000));
    }
    if (!got) throw new Error('6분 후에도 보유 목록에 없음 — 재발급 금지 · 관리자 발급 이력 확인 후 apply-433-coupon-finish.js 방식으로 마무리');
    console.log('✅ 회원 보유 확인:', JSON.stringify({ issue_no: got.issue_no, name: got.coupon_name, pct: got.benefit_percentage, issued: got.issued_date, end: got.available_end_datetime }));
    await pool.query(`UPDATE reward_grants SET status='granted', granted_at=NOW(), granted_by=$2 WHERE id=$1`, [GRANT_ID, ACTOR]);
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','reward_grant',$1,$2,'reward-grant',NULL,$3)`,
        [GRANT_ID, JSON.stringify({ before: { status: cur.status }, after: { status: 'granted', member_key: MEMBER, kind: KIND, coupon_no: COUPON_NO, issue_no: got.issue_no, valid_until: got.available_end_datetime }, note: '#451 API 발급(10% 룰렛)' }), ACTOR]);
    console.log('✅ reward_grants id', GRANT_ID, '→ granted');
    console.log('미지급 잔여:', (await pool.query(`SELECT count(*)::int n FROM reward_grants WHERE status='pending'`)).rows[0].n);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
