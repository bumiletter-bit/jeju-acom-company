// #466(대표 9/22 "룰렛 실물 당첨 쿠폰 10% · 회원 3354900610@n 미지급 1건 처리"): 10% 룰렛 쿠폰 발급 — 재사용판(#465 5%판의 10% 이식)
//   사용: node scripts/apply-466-coupon10.js <회원ID> <reward_grants id>
//   #451과 다른 점: 「이미 보유면 발급 생략」이 아니라 **보유 장수 기준**(발급 전 n장 → 발급 후 n+1장) — 같은 회원의 재당첨도 1장 더 준다.
//   안전장치: 당첨 행이 pending·coupon10·그 회원인지 선검사 · 정의는 고정 번호(중복 생성 없음) · 발급은 회원 1명(M)만 · 장수가 +1이 아니면 지급완료 표시 안 함.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const COUPON_NO = '6086272594000000984';   // 「10% 할인쿠폰(룰렛)」 발급일부터 30일 (#451 · 2026-09-17 생성)
const PCT = 10;
const MEMBER = process.argv[2], GRANT_ID = Number(process.argv[3]);
const ACTOR = '클코(대표 지시 #466 룰렛 10% 쿠폰 지급)';
if (!MEMBER || !GRANT_ID) { console.error('사용: node scripts/apply-466-coupon10.js <회원ID> <reward_grants id>'); process.exit(1); }
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
const held = async () => { const r = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/customers/${encodeURIComponent(MEMBER)}/coupons`, query: { limit: 100 } }); if (!(r.raw && r.raw.ok)) throw new Error('보유 쿠폰 조회 실패: ' + JSON.stringify(r).slice(0, 200)); return ((r.raw.data || {}).coupons || []).filter(c => String(c.coupon_no) === COUPON_NO); };
(async () => {
    const cur = (await pool.query(`SELECT g.*, m.member_key FROM reward_grants g JOIN mall_members m ON m.id=g.member_id WHERE g.id=$1`, [GRANT_ID])).rows[0];
    if (!cur || cur.member_key !== MEMBER || cur.kind !== 'coupon10') throw new Error('당첨 행 불일치: ' + JSON.stringify(cur));
    if (cur.status !== 'pending') { console.log('이미 처리된 당첨 행(status ' + cur.status + ') — 발급하지 않음'); return pool.end(); }
    const def = ((((await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/coupons', query: { coupon_no: COUPON_NO } })).raw || {}).data || {}).coupons || [])[0];
    if (!def || def.deleted === 'T' || def.available_period_type !== 'R' || Number(def.benefit_percentage) !== PCT) throw new Error('쿠폰 정의 이상 — 중단: ' + JSON.stringify(def || null).slice(0, 200));
    console.log('정의 확인:', def.coupon_name, `· ${def.benefit_percentage}% · 발급일부터 ${def.available_day_from_issued}일`);
    const b = await held(); console.log('발급 전 보유:', b.length + '장', b.map(c => c.issue_no + '(' + String(c.issued_date).slice(0, 10) + ')').join(', '));
    const iss = await runner({ action: 'raw', method: 'POST', path: `/api/v2/admin/coupons/${COUPON_NO}/issues`,
        body: { shop_no: 1, request: { issued_member_scope: 'M', member_id: MEMBER, send_sms_for_issue: 'F', allow_duplication: b.length ? 'T' : 'F', single_issue_per_once: 'T' } } });
    console.log('발급 응답:', JSON.stringify(iss).slice(0, 400));
    if (!(iss.raw && iss.raw.ok)) throw new Error('발급 실패 — 지급완료 표시 안 함');
    let a = [];
    for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, i ? 60000 : 6000)); a = await held(); if (a.length >= b.length + 1) break; console.log(`  보유 재조회 ${i + 1}: ${a.length}장(카페24 조회 지연 대기)`); }
    if (a.length !== b.length + 1) throw new Error(`발급 후 보유 ${a.length}장(기대 ${b.length + 1}) — 지급완료 표시 안 함`);
    const got = a.filter(c => !b.some(x => String(x.issue_no) === String(c.issue_no)))[0] || a[0];
    console.log('✅ 회원 보유 확인:', JSON.stringify({ issue_no: got.issue_no, name: got.coupon_name, pct: got.benefit_percentage, issued: got.issued_date, 보유: a.length + '장' }));
    await pool.query(`UPDATE reward_grants SET status='granted', granted_at=NOW(), granted_by=$2 WHERE id=$1 AND status='pending'`, [GRANT_ID, ACTOR]);
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','reward_grant',$1,$2,'reward-grant',NULL,$3)`,
        [GRANT_ID, JSON.stringify({ before: { status: 'pending' }, after: { status: 'granted', member_key: MEMBER, kind: 'coupon10', coupon_no: COUPON_NO, issue_no: got.issue_no }, note: '#466 API 발급(정의 재사용 · 발급일부터 30일 · 보유 ' + b.length + '→' + a.length + '장)' }), ACTOR]);
    console.log('✅ reward_grants id', GRANT_ID, '→ granted · 미지급 잔여:', (await pool.query(`SELECT count(*)::int n FROM reward_grants WHERE status='pending'`)).rows[0].n);
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
