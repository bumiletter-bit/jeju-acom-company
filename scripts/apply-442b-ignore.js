// #442-b(대표 9/14 "a로 진행"): 카페24 c94·c92에 못난이 5kg 옵션을 추가했으므로 옵션명 불일치 경보 제외 목록에서 그 키를 제거
//  → 이후 네이버에만 있는 옵션은 전부 새벽 cafe24_sync 텔레그램 경보 대상. audit 기록.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const KEY = '황금향|못난이|5kg|랜덤과';
(async () => {
    const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_sync_ignore_opts'`);
    const before = q.rows[0] ? q.rows[0].value : null;
    const keys = Array.isArray(before && before.keys) ? before.keys : [];
    if (!keys.includes(KEY)) { console.log('이미 없음 — 변경 0:', JSON.stringify(before)); await pool.end(); return; }
    const after = { keys: keys.filter(k => k !== KEY), note: '#442 옵션명 불일치 경보 제외 목록 — 네이버에만 두기로 확정한 구성 차이만 등록(키 = cafe24OptKey 과일|용도|중량|등급). 9/14 못난이 5kg는 카페24에 추가해 제거.' };
    await pool.query(`UPDATE agent_office_config SET value=$1::jsonb, updated_at=NOW() WHERE key='cafe24_sync_ignore_opts'`, [JSON.stringify(after)]);
    await pool.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','agent_office_config',NULL,$1,'cafe24-api','클코(대표 지시 #442-b)')`, [JSON.stringify({ key: 'cafe24_sync_ignore_opts', before, after, note: 'c94/c92 못난이 5kg 카페24 옵션 추가 완료 → 경보 제외 해제' })]);
    console.log('제거 완료 — before:', JSON.stringify(before.keys), '→ after:', JSON.stringify(after.keys));
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
