// #479 카페24 적립금 — 창구 도구. 카페24 열쇠는 실서버에만 있으므로, 요청을 DB에 남기고 실서버 러너(10초 주기)의 결과를 기다린다.
// 사용:
//   node scripts/desk/points.js lookup <회원아이디 | 010-0000-0000>          → 회원 아이디·가용 적립금(한 번호에 여러 계정이면 전부)
//   node scripts/desk/points.js grant <회원아이디> <금액> "<사유>" <지시 id>  → 지급 전후 잔액 대조 결과
// 가드(서버): 지급만 · 회원 1명 · 1~50,000원 정수 · 사유 필수. 1만 원 초과는 창구 규칙상 실행 전에 question으로 1회 확인한다.
const { pool } = require('./_db');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async k => { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [k]); return r.rows[0] ? r.rows[0].value : null; };
(async () => {
    const [cmd, a1, a2, a3, a4] = process.argv.slice(2);
    let req;
    if (cmd === 'lookup' && a1) req = /^0\d/.test(a1) ? { action: 'lookup', cellphone: a1 } : { action: 'lookup', member_id: a1 };
    else if (cmd === 'grant' && a1 && a2 && a3) {
        const amt = Number(String(a2).replace(/[,원\s]/g, ''));
        let by = null, byId = null;
        if (a4) {
            const o = (await pool.query(`SELECT created_by, created_by_id FROM pending_orders WHERE id = $1`, [a4])).rows[0];
            if (o) { by = o.created_by; byId = o.created_by_id; }
        }
        req = { action: 'grant', member_id: a1, amount: amt, reason: a3, order_no: a4 ? Number(a4) : null, requested_by: by, requested_by_id: byId };
    } else throw new Error('사용: lookup <아이디|휴대폰> · grant <아이디> <금액> "<사유>" <지시 id>');
    req.rid = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
    // 앞 요청이 아직 안 집혔으면 기다린다(한 칸짜리 요청함)
    for (let i = 0; i < 30 && (await get('cafe24_points_request')) != null; i++) await sleep(2000);
    await pool.query(
        `INSERT INTO agent_office_config (key, value) VALUES ('cafe24_points_request', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    let out = null;
    for (let i = 0; i < 45; i++) {   // 최대 90초(러너 10초 주기 + 지급 뒤 잔액 재조회 최대 12초)
        await sleep(2000);
        const r = await get('cafe24_points_result');
        if (r && r.rid === req.rid) { out = r; break; }
    }
    if (!out) {
        // 아직 안 집혔으면 요청을 거둬들인다(나중에 뒤늦게 지급되지 않게)
        const left = await get('cafe24_points_request');
        if (left && left.rid === req.rid) await pool.query(`DELETE FROM agent_office_config WHERE key = 'cafe24_points_request'`);
        out = { ok: false, error: left && left.rid === req.rid ? '실서버가 요청을 집지 않아 취소했습니다(지급 안 됨)' : '결과를 기다리다 시간이 지났습니다 — 지급됐을 수 있으니 lookup으로 잔액을 확인하세요' };
    }
    console.log(JSON.stringify(out, null, 2));
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
