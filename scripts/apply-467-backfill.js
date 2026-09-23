// #467(대표 GO 9/23): 기존 룰렛 쿠폰 지급 행(#433·#451·#465·#466 = id 3·4·6·7)에 쿠폰 메타 백필 — 만료 안내 타이머·화면 표시 대상이 되게.
//   카페24 발급 이력(정의별 issues)에서 issue_no·issued_date·expiration_date·used 여부를 읽어 채운다. 읽기 = 카페24 · 쓰기 = reward_grants 메타 컬럼만(status 무접촉) · audit 1건.
//   사용: node scripts/apply-467-backfill.js            (조회·계획만)
//         node scripts/apply-467-backfill.js apply      (적용)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv[2] === 'apply';
const DEFS = { coupon5: '6086230051600000967', coupon10: '6086272594000000984' };
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
(async () => {
    const grants = (await pool.query(`SELECT g.*, m.member_key FROM reward_grants g JOIN mall_members m ON m.id=g.member_id WHERE g.kind IN ('coupon5','coupon10') AND g.status='granted' AND g.issue_no IS NULL ORDER BY g.id`)).rows;
    console.log('백필 후보(granted · issue_no 없음):', grants.map(g => `#${g.id} ${g.member_key} ${g.kind}`).join(' | ') || '없음');
    if (!grants.length) return pool.end();
    const issuesByNo = {};
    for (const k of Object.keys(DEFS)) {
        const r = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/coupons/${DEFS[k]}/issues`, query: { limit: 100 } });
        if (!(r.raw && r.raw.ok)) throw new Error('발급 이력 조회 실패 ' + k);
        issuesByNo[DEFS[k]] = ((r.raw.data || {}).issues) || [];
    }
    const plan = [];
    for (const g of grants) {
        const no = DEFS[g.kind];
        // 같은 회원의 발급 이력 중 이 당첨(created_at) 이후 가장 가까운 발급 = 이 당첨의 쿠폰(#433 9/12·#451 9/17·#465 9/21·#466 9/22 전부 당첨 당일 발급)
        const cand = issuesByNo[no].filter(i => i.member_id === g.member_key && new Date(i.issued_date).getTime() >= new Date(g.created_at).getTime() - 3600000)
            .sort((a, b) => new Date(a.issued_date) - new Date(b.issued_date));
        const used = new Set(grants.filter(x => x.id !== g.id && x._issue).map(x => x._issue));
        const pick = cand.find(i => !used.has(i.issue_no));
        if (!pick) { plan.push({ id: g.id, skip: '매칭 발급 이력 없음' }); continue; }
        g._issue = pick.issue_no;
        plan.push({ id: g.id, member: g.member_key, kind: g.kind, coupon_no: no, issue_no: pick.issue_no, issued_at: pick.issued_date, expires_at: pick.expiration_date, used_at: pick.used_coupon === 'T' ? pick.used_date : null, used_order_id: pick.used_coupon === 'T' ? pick.related_order_id : null });
    }
    plan.forEach(p => console.log(p.skip ? `  #${p.id} ⏭ ${p.skip}` : `  #${p.id} ${p.member} ${p.kind} → issue ${p.issue_no} · 발급 ${String(p.issued_at).slice(0, 16)} · 만료 ${String(p.expires_at).slice(0, 10)} · ${p.used_at ? '사용됨 ' + String(p.used_at).slice(0, 10) + ' ' + p.used_order_id : '미사용'}`));
    const dup = new Set(plan.filter(p => !p.skip).map(p => p.issue_no));
    if (dup.size !== plan.filter(p => !p.skip).length) throw new Error('issue_no 중복 매칭 — 중단');
    if (!APPLY) { console.log('\n(계획만 — 적용은 `apply` 인자)'); return pool.end(); }
    for (const p of plan.filter(x => !x.skip)) {
        await pool.query(`UPDATE reward_grants SET coupon_no=$2, issue_no=$3, issued_at=$4, expires_at=$5, used_at=$6, used_order_id=$7 WHERE id=$1 AND issue_no IS NULL`,
            [p.id, p.coupon_no, p.issue_no, p.issued_at, p.expires_at, p.used_at, p.used_order_id]);
    }
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','reward_grant',NULL,$1,'reward-grant',NULL,$2)`,
        [JSON.stringify({ note: '#467 기존 쿠폰 지급 행 메타 백필(coupon_no·issue_no·issued_at·expires_at·used_at) — status 무접촉', rows: plan.filter(x => !x.skip).map(x => ({ id: x.id, issue_no: x.issue_no, expires_at: x.expires_at, used: !!x.used_at })) }), '클코(대표 지시 #467 백필)']);
    const after = (await pool.query(`SELECT id, kind, issue_no, expires_at, used_at FROM reward_grants WHERE id = ANY($1::int[]) ORDER BY id`, [plan.filter(x => !x.skip).map(x => x.id)])).rows;
    console.log('\n✅ 적용 후:', after.map(a => `#${a.id} ${a.kind} issue ${a.issue_no} 만료 ${String(a.expires_at).slice(0, 10)}${a.used_at ? ' 사용됨' : ''}`).join(' | '));
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
