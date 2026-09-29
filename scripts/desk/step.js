// #469 진행 단계 기록(LIVE 로그) — 사용: node scripts/desk/step.js <지시 id> "지금 하는 일"
const { pool, appendStep, heartbeat } = require('./_db');
(async () => {
    const id = parseInt(process.argv[2], 10), text = process.argv.slice(3).join(' ');
    if (!id || !text) throw new Error('사용: step.js <지시 id> "내용"');
    const o = (await pool.query(`SELECT run_id FROM pending_orders WHERE id = $1`, [id])).rows[0];
    if (!o) throw new Error('없는 지시');
    await appendStep(o.run_id, 'work', text);
    await heartbeat('busy', id);
    console.log('기록됨');
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
