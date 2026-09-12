// #433(대표 GO 9/12 "룰렛 당첨 쿠폰 5% 니가 직접 지급"): ①「5% 할인쿠폰(룰렛)」 정의 생성(선례 …0915 설정 복제 · 유효기간만 발급일부터 30일) → ②회원 1명 발급 → ③보유 검산 → ④당첨 지급 완료 표시.
//   대상 = reward_grants id 3 (kind coupon5 · mall_members 1141 = 3575099520@n). 멱등: 같은 이름·R형 정의가 있으면 재사용 / 이미 보유면 발급 생략.
//   선례 「5% 할인쿠폰」(고정 8/13~9/12 23:00)은 당일 만료라 사용 안 함(안전 정지 후 대표 GO).
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const NAME = '5% 할인쿠폰(룰렛)', DAYS = 30;
const MEMBER = '3575099520@n', GRANT_ID = 3;
const ACTOR = '클코(대표 지시 #433)';
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
const listCoupons = async () => { let all = []; for (const offset of [0, 100]) { const r = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/coupons', query: { limit: 100, offset } }); if (!(r.raw && r.raw.ok)) return { err: r }; const cs = (r.raw.data.coupons) || []; all = all.concat(cs); if (cs.length < 100) break; } return { all }; };
(async () => {
    // 0) 신버전 러너 대기(구인스턴스 소비 방지 — #398 함정) — 생성 POST 가드가 v5.9.311부터
    let lc;
    for (let i = 0; i < 20; i++) {
        lc = await listCoupons();
        if (lc.all) { const ver = null; break; }
        console.log(`  대기 ${i + 1}: ${(lc.err.raw || {}).reason || ''} (server ${lc.err.server_version})`.slice(0, 120));
        await new Promise(r => setTimeout(r, 30000));
    }
    if (!lc.all) throw new Error('쿠폰 목록 조회 실패');
    // 1) 정의 — 있으면 재사용
    let def = lc.all.find(c => c.coupon_name === NAME && c.available_period_type === 'R' && c.deleted !== 'T');
    if (def) console.log('기존 정의 재사용:', def.coupon_no, `${def.available_day_from_issued}일`);
    else {
        const body = { shop_no: 1, request: {
            coupon_name: NAME, benefit_type: 'B', issue_type: 'M', issue_sub_type: 'M',
            available_period_type: 'R', available_day_from_issued: DAYS, available_begin_datetime: null, available_end_datetime: null,
            available_site: ['W', 'M', 'P'], available_scope: 'O', available_product: 'U', available_category: 'U',
            available_amount_type: 'E', available_coupon_count_by_order: 1, available_price_type: 'U',
            discount_rate: { benefit_percentage: '5.0', benefit_percentage_round_unit: '0.1', benefit_percentage_max_price: '0.00' },
            issue_reserved: 'F', same_user_reissue: 'F', include_regional_shipping_rate: 'F', include_foreign_delivery: 'F', show_product_detail: 'F',
        } };
        const cr = await runner({ action: 'raw', method: 'POST', path: '/api/v2/admin/coupons', body });
        console.log('정의 생성 응답:', JSON.stringify(cr).slice(0, 500));
        if (!(cr.raw && cr.raw.ok)) throw new Error('정의 생성 실패 — 중단(발급 0)');
        await new Promise(r => setTimeout(r, 4000));
        const lc2 = await listCoupons();
        def = (lc2.all || []).find(c => c.coupon_name === NAME && c.deleted !== 'T');
        if (!def) throw new Error('생성 후 목록에 정의 없음 — 중단');
        console.log('✅ 정의 생성:', JSON.stringify({ coupon_no: def.coupon_no, name: def.coupon_name, pct: def.benefit_percentage, period: def.available_period_type, days: def.available_day_from_issued, scope: def.available_scope, site: def.available_site, max: def.benefit_percentage_max_price }));
        if (def.available_period_type !== 'R' || Number(def.available_day_from_issued) !== DAYS || String(def.benefit_percentage) !== '5.0') throw new Error('생성된 정의가 의도와 다름 — 발급 중단(정의 삭제는 대표 확인)');
    }
    const COUPON_NO = String(def.coupon_no);
    const mine = (r) => ((((r.raw || {}).data || {}).coupons) || []).filter(c => String(c.coupon_no) === COUPON_NO);
    // 2) 발급 (이미 보유면 생략)
    const before = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/customers/${encodeURIComponent(MEMBER)}/coupons`, query: { limit: 100 } });
    if (mine(before).length) console.log('이미 보유 — 발급 생략');
    else {
        const iss = await runner({ action: 'raw', method: 'POST', path: `/api/v2/admin/coupons/${COUPON_NO}/issues`,
            body: { shop_no: 1, request: { issued_member_scope: 'M', member_id: MEMBER, send_sms_for_issue: 'F', allow_duplication: 'F', single_issue_per_once: 'T' } } });
        console.log('발급 응답:', JSON.stringify(iss).slice(0, 400));
        if (!(iss.raw && iss.raw.ok)) throw new Error('발급 실패');
    }
    // 3) 검산
    await new Promise(r => setTimeout(r, 5000));
    const after = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/customers/${encodeURIComponent(MEMBER)}/coupons`, query: { limit: 100 } });
    const got = mine(after)[0];
    if (!got) throw new Error('발급 후 회원 보유 쿠폰에 없음 — 지급완료 표시 안 함');
    console.log('✅ 회원 보유 확인:', JSON.stringify({ issue_no: got.issue_no, name: got.coupon_name, pct: got.benefit_percentage, issued: got.issued_date, begin: got.available_begin_datetime, end: got.available_end_datetime }));
    // 4) 지급 완료 (라우트 PUT /reward-grants/:id 와 동일 SQL + audit)
    const cur = (await pool.query(`SELECT g.*, m.member_key FROM reward_grants g JOIN mall_members m ON m.id=g.member_id WHERE g.id=$1`, [GRANT_ID])).rows[0];
    if (!cur || cur.member_key !== MEMBER || cur.kind !== 'coupon5') throw new Error('당첨 행 불일치: ' + JSON.stringify(cur));
    if (cur.status === 'granted') console.log('  이미 지급완료 상태');
    else {
        await pool.query(`UPDATE reward_grants SET status='granted', granted_at=NOW(), granted_by=$2 WHERE id=$1`, [GRANT_ID, ACTOR]);
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','reward_grant',$1,$2,'reward-grant',NULL,$3)`,
            [GRANT_ID, JSON.stringify({ before: { status: cur.status }, after: { status: 'granted', member_key: MEMBER, kind: 'coupon5', coupon_no: COUPON_NO, issue_no: got.issue_no, valid_until: got.available_end_datetime }, note: '#433 API 발급(정의 신규 생성 R30일)' }), ACTOR]);
        console.log('✅ reward_grants id', GRANT_ID, '→ granted');
    }
    console.log('미지급 잔여:', (await pool.query(`SELECT count(*)::int n FROM reward_grants WHERE status='pending'`)).rows[0].n);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
