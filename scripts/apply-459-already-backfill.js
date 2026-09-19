// #459(대표 9/19 "전에도 발주확인을 누른 게 맞아 — 이상 없음으로 메모하고 진행"): 지금까지 「104443 이미 발주확인 된 주문」으로 failed 기록된 행을 already(무해)로 정리
//   발송·주문 상태 무접촉 — 이력 표기만(알림 발송 이력의 「✍️ 발주확인 수기 필요」·실패/보류 필터에서 빠짐). audit 기록.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #459 — 이미 발주확인된 주문 = 이상 없음)';
(async () => {
    const before = await pool.query(`SELECT id, order_key, to_char(created_at + interval '9 hours','MM-DD HH24:MI') AS kst FROM kakao_notify_log WHERE confirm_status='failed' AND confirm_error LIKE '104443%' ORDER BY id`);
    console.log('대상', before.rows.length, '행:', before.rows.map(r => r.id + '(' + r.kst + ')').join(', '));
    if (!before.rows.length) return pool.end();
    const r = await pool.query(`UPDATE kakao_notify_log SET confirm_status='already' WHERE confirm_status='failed' AND confirm_error LIKE '104443%' RETURNING id`);
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','kakao_notify_log',NULL,$1,'instruction-459',NULL,$2)`,
        [JSON.stringify({ before: { confirm_status: 'failed' }, after: { confirm_status: 'already' }, ids: r.rows.map(x => x.id), reason: '네이버 104443 「이미 발주확인 된 주문」 — 대표·직원이 먼저 발주확인한 주문(알림톡은 정상 발송) · 대표 확인: 이상 없음' }), ACTOR]);
    const left = await pool.query(`SELECT confirm_status, COUNT(*)::int n FROM kakao_notify_log WHERE confirm_status IN ('failed','manual-needed') AND deleted_at IS NULL AND created_at > NOW() - INTERVAL '30 days' GROUP BY 1`);
    console.log('정리', r.rows.length, '행 → already · 최근 30일 남은 수기 필요 표기:', JSON.stringify(left.rows));
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
