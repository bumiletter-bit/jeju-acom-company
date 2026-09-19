// #456(대표 9/19 "연락했어 지급완료 처리해줘"): 룰렛 「업그레이드 이용권」 당첨 건 지급완료 — 화면 [지급완료] 버튼과 같은 UPDATE + audit
//   업그레이드권은 카페24에 발급할 것이 없는 경품 → 대표가 손님에게 개별 연락해 처리(선례 = 메모리 jeju-mall-game-rewards). 개인정보는 기록하지 않는다.
//   사용: node scripts/apply-456-upgrade-grant.js [reward_grants id]
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ID = Number(process.argv[2] || 5), ACTOR = '클코(대표 지시 #456 업그레이드 이용권 — 대표 개별 연락 완료)';
(async () => {
    const cur = await pool.query(`SELECT g.*, m.member_key FROM reward_grants g JOIN mall_members m ON m.id=g.member_id WHERE g.id=$1`, [ID]);
    if (!cur.rows.length) throw new Error('해당 당첨 건 없음');
    const b = cur.rows[0];
    if (b.kind !== 'upgrade') throw new Error('업그레이드 이용권 건이 아님: ' + b.kind);
    if (b.status === 'granted') { console.log('이미 지급완료:', b.granted_by); return pool.end(); }
    const r = await pool.query(`UPDATE reward_grants SET status='granted', granted_at=NOW(), granted_by=$2::text WHERE id=$1 AND status='pending' RETURNING id, status, granted_by, to_char(granted_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') AS at`, [ID, ACTOR]);
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','reward_grant',$1,$2,'reward-grant',NULL,$3)`,
        [ID, JSON.stringify({ before: { status: b.status }, after: { status: 'granted', member_key: b.member_key, kind: b.kind, note: '대표 개별 연락으로 처리' } }), ACTOR]);
    const pend = await pool.query(`SELECT COUNT(*)::int AS n FROM reward_grants WHERE status='pending'`);
    console.log('지급완료:', JSON.stringify(r.rows[0]), '· 미지급 잔여', pend.rows[0].n);
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
