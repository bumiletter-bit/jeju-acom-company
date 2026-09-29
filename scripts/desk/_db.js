// #469 클코 창구 공용 — DB 연결·heartbeat·단계 기록 (AI 호출 없음)
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });
const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

async function heartbeat(state, orderId) {
    const v = { at: new Date().toISOString(), state, order_id: orderId || null };
    await pool.query(
        `INSERT INTO agent_office_config (key, value) VALUES ('desk_heartbeat', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(v)]);
}
function step(kind, text) { return { t: new Date().toISOString(), kind, actor: '클코', text: String(text).slice(0, 300) }; }
async function appendStep(runId, kind, text) {
    if (!runId) return;
    await pool.query(`UPDATE agent_runs SET steps = steps || $2::jsonb WHERE id = $1`, [runId, JSON.stringify([step(kind, text)])]);
}
async function audit(action, targetId, after) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ($1, 'pending_order', $2, $3, 'desk', '클코(창구)')`,
            [action, targetId, JSON.stringify({ after })]);
    } catch (e) { console.error('audit 기록 실패(무시):', e.message); }
}
module.exports = { pool, ROOT, heartbeat, step, appendStep, audit };
