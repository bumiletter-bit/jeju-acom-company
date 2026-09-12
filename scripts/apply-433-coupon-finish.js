// #433 마무리: 발급 완료(07:56 count 1) 후 카페24 조회 캐시 지연으로 보유 검산이 늦어진 것 — 재발급 없이 보유 재조회(최대 6회×60s) → reward_grants 지급완료 + audit
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const COUPON_NO = '6086230051600000967', MEMBER = '3575099520@n', GRANT_ID = 3, ACTOR = '클코(대표 지시 #433)';
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
(async () => {
    let got = null;
    for (let i = 0; i < 6 && !got; i++) {
        const r = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/customers/${encodeURIComponent(MEMBER)}/coupons`, query: { limit: 100 } });
        const cs = ((((r.raw || {}).data || {}).coupons) || []);
        got = cs.find(c => String(c.coupon_no) === COUPON_NO) || null;
        console.log(`  조회 ${i + 1}: 보유 ${cs.length}장 — ${got ? '✅ 5%(룰렛) 있음' : '아직 없음'}`);
        if (!got) await new Promise(r => setTimeout(r, 60000));
    }
    if (!got) throw new Error('6분 후에도 보유 목록에 없음 — 카페24 관리자에서 발급 이력 확인 필요(재발급 금지: API 응답은 count 1 성공)');
    console.log('✅ 회원 보유 확인:', JSON.stringify({ issue_no: got.issue_no, name: got.coupon_name, pct: got.benefit_percentage, issued: got.issued_date, begin: got.available_begin_datetime, end: got.available_end_datetime }));
    const cur = (await pool.query(`SELECT g.*, m.member_key FROM reward_grants g JOIN mall_members m ON m.id=g.member_id WHERE g.id=$1`, [GRANT_ID])).rows[0];
    if (!cur || cur.member_key !== MEMBER || cur.kind !== 'coupon5') throw new Error('당첨 행 불일치');
    if (cur.status !== 'granted') {
        await pool.query(`UPDATE reward_grants SET status='granted', granted_at=NOW(), granted_by=$2 WHERE id=$1`, [GRANT_ID, ACTOR]);
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','reward_grant',$1,$2,'reward-grant',NULL,$3)`,
            [GRANT_ID, JSON.stringify({ before: { status: cur.status }, after: { status: 'granted', member_key: MEMBER, kind: 'coupon5', coupon_no: COUPON_NO, issue_no: got.issue_no, valid_until: got.available_end_datetime }, note: '#433 API 발급 — 정의 신규 「5% 할인쿠폰(룰렛)」 발급일+30일' }), ACTOR]);
        console.log('✅ reward_grants id', GRANT_ID, '→ granted');
    } else console.log('  이미 granted');
    console.log('미지급 잔여:', (await pool.query(`SELECT count(*)::int n FROM reward_grants WHERE status='pending'`)).rows[0].n);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
