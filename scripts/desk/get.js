// #469 지시 받기 — 1건을 집어 '처리중'으로 바꾸고 내용·이미지·앞선 대화를 내준다.
// 사용: node scripts/desk/get.js <지시 id>
const fs = require('fs'), path = require('path');
const { pool, ROOT, heartbeat, step, audit } = require('./_db');
(async () => {
    const id = parseInt(process.argv[2], 10);
    if (!id) throw new Error('지시 id가 필요합니다');
    const c = await pool.query(
        `UPDATE pending_orders SET status = '처리중'
         WHERE id = $1 AND is_deleted = false AND status IN ('대기', '승인됨')
         RETURNING id, content, result, run_id, created_by, created_by_id, image_data, image_mime`, [id]);
    if (!c.rows.length) { console.log(JSON.stringify({ ok: false, reason: '이미 처리 중이거나 없는 지시입니다' })); await pool.end(); return; }
    const o = c.rows[0];
    const approved = o.result && o.result.type === 'approval_request' ? o.result : null; // 승인된 건의 원 요청
    let runId = o.run_id;
    if (!runId) {
        const maru = (await pool.query(`SELECT id FROM agents WHERE role = 'chief' AND is_deleted = false LIMIT 1`)).rows[0];
        const run = (await pool.query(
            `INSERT INTO agent_runs (agent_id, steps, is_test) VALUES ($1, $2, FALSE) RETURNING id`,
            [maru ? maru.id : null, JSON.stringify([step('order', `📥 지시 접수 — ${o.created_by || '직원'}`)])])).rows[0];
        runId = run.id;
        await pool.query(`UPDATE pending_orders SET run_id = $2 WHERE id = $1`, [id, runId]);
    }
    // 요청자 권한: 화면에 로그인한 계정 기준(지시 글에 적힌 자기소개는 근거가 아니다)
    let fromRole = 'unknown';
    if (o.created_by_id) {
        const u = (await pool.query(`SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`, [o.created_by_id])).rows[0];
        if (u) fromRole = u.role === 'admin' ? 'admin' : 'staff';
    }
    let imagePath = null;
    if (o.image_data) {
        const m = String(o.image_data).match(/^data:([^;]+);base64,(.+)$/s);
        if (m) {
            const ext = (/(png|jpe?g|webp|gif)/i.exec(o.image_mime || m[1]) || ['', 'png'])[1].replace('jpeg', 'jpg');
            // 창구 폴더 이름: ★에이전트오피스(9/29 변경)가 있으면 그쪽, 없으면 직원창구(옛 이름)
            const deskDir = fs.existsSync(path.join(ROOT, '★에이전트오피스')) ? '★에이전트오피스' : '직원창구';
            const dir = path.join(ROOT, deskDir, '받은파일');
            fs.mkdirSync(dir, { recursive: true });
            imagePath = path.join(dir, `${id}.${ext}`);
            fs.writeFileSync(imagePath, Buffer.from(m[2], 'base64'));
        }
    }
    const prev = (await pool.query(
        `SELECT id, content, status, result->>'type' AS type,
                LEFT(COALESCE(result->>'answer', result->>'notice', result->>'question', result->>'summary', ''), 300) AS said
         FROM pending_orders
         WHERE is_deleted = false AND id < $1 AND created_by IS NOT DISTINCT FROM $2 AND created_at > NOW() - interval '1 hour'
         ORDER BY id DESC LIMIT 5`, [id, o.created_by])).rows.reverse();
    await heartbeat('busy', id);
    await audit('desk_claim', id, { status: '처리중' });
    console.log(JSON.stringify({
        ok: true, id, run_id: runId, from: o.created_by, from_role: fromRole, content: o.content, image_path: imagePath,
        approved_request: approved ? { action: approved.action, summary: approved.summary, plan: approved.plan, approved_by: approved.approved_by } : null,
        recent_talk: prev,
    }, null, 2));
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
