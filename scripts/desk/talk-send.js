// #474 확인받은 톡톡 답변 보내기 — 사용: node scripts/desk/talk-send.js <지시 id> <보낼글.json>
//   보낼글.json: { "items": [ { "talk_no": 3857, "text": "보낼 글" }, ... ] }   (한 번에 10건까지)
//
// 🔴 이 스크립트는 「보내도 된다」는 사람의 확인이 담긴 지시를 처리할 때만 쓴다(추천 문구를 만든 지시에서는 쓰지 않는다).
//   · 글을 「보낼 글」 표(talk_outbox)에 올리면 실서버가 톡톡봇 통로로 넘긴다. 결과가 올 때까지 기다렸다가 건별로 알려 준다.
//   · 그 사이 직원이 이미 답한 손님에게는 보내지 않는다(겹쳐 나가지 않게).
//   · 결제 단어(계좌·입금·이체 등)가 든 글은 보내지 않는다.
const fs = require('fs');
const { pool, audit } = require('./_db');
const PAY_WORDS = /계좌|입금|이체|무통장|송금|현금\s*결제|현금으로/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const orderId = parseInt(process.argv[2], 10), file = process.argv[3];
    if (!orderId || !file) throw new Error('사용: talk-send.js <지시 id> <보낼글.json>');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = Array.isArray(j.items) ? j.items : [];
    if (!items.length) throw new Error('보낼 글이 없습니다');
    if (items.length > 10) throw new Error('한 번에 10건까지 보낼 수 있습니다');
    const o = (await pool.query(`SELECT id, status, created_by, content FROM pending_orders WHERE id = $1 AND is_deleted = false`, [orderId])).rows[0];
    if (!o) throw new Error('없는 지시');
    if (o.status !== '처리중') throw new Error(`'${o.status}' 상태의 지시로는 보낼 수 없습니다(처리중만 가능)`);
    if (String(o.content || '').startsWith('[검증469]')) throw new Error('시험 지시로는 손님에게 보내지 않습니다');
    const has = (await pool.query(`SELECT to_regclass('public.talk_outbox') AS t`)).rows[0].t;
    if (!has) throw new Error('보낼 글 표가 아직 없습니다(회사프로그램에서 에이전트 오피스를 한 번 열면 만들어집니다)');

    const results = [];
    for (const it of items) {
        const no = parseInt(it.talk_no, 10), text = String(it.text || '').trim();
        const res = { talk_no: no, ok: false };
        results.push(res);
        if (!no || !text) { res.error = '번호나 글이 비었습니다'; continue; }
        if (text.length > 1000) { res.error = '1000자를 넘습니다'; continue; }
        if (PAY_WORDS.test(text)) { res.error = '결제 단어가 들어 있어 보내지 않았습니다'; continue; }
        const m = (await pool.query(`SELECT id, user_id, received_at FROM message_logs WHERE id = $1 AND received_at > NOW() - interval '7 days'`, [no])).rows[0];
        if (!m) { res.error = '최근 7일 안의 톡톡 글이 아닙니다'; continue; }
        if (String(m.user_id).startsWith('kakao:')) { res.error = '카카오 손님에게는 보낼 수 없습니다'; continue; }
        if (String(m.user_id).startsWith('mall:')) { res.error = '자사몰 채팅 손님에게는 이 통로로 보낼 수 없습니다'; continue; }   // #581
        // 그 손님에게 직원이 이미 답했는지(이 글 이후)
        const st = (await pool.query(
            `SELECT 1 FROM message_logs WHERE user_id = $1 AND received_at >= $2 AND COALESCE(staff_response, '') <> '' LIMIT 1`, [m.user_id, m.received_at])).rows[0];
        if (st) { res.error = '그 사이 직원이 이미 답했습니다 — 보내지 않았습니다'; continue; }
        const dup = (await pool.query(
            `SELECT 1 FROM talk_outbox WHERE log_id = $1 AND status IN ('queued', 'sending', 'sent') AND created_at > NOW() - interval '1 hour' LIMIT 1`, [no])).rows[0];
        if (dup) { res.error = '이 글에는 방금 이미 보냈습니다'; continue; }
        const q = await pool.query(
            `INSERT INTO talk_outbox (log_id, user_id, body, order_id, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [no, m.user_id, text, orderId, String(o.created_by || '').slice(0, 50)]);
        res.outbox = q.rows[0].id;
    }
    // 결과 기다리기(건당 최대 60초)
    for (const res of results) {
        if (!res.outbox) continue;
        for (let i = 0; i < 30; i++) {
            const s = (await pool.query(`SELECT status, error FROM talk_outbox WHERE id = $1`, [res.outbox])).rows[0];
            if (s.status === 'sent') { res.ok = true; break; }
            if (s.status === 'failed') { res.error = s.error || '보내지 못했습니다'; break; }
            await sleep(2000);
        }
        if (!res.ok && !res.error) {
            await pool.query(`UPDATE talk_outbox SET status = 'failed', error = '1분 안에 응답 없음(취소)' WHERE id = $1 AND status = 'queued'`, [res.outbox]);
            res.error = '1분 안에 보내지지 않아 취소했습니다';
        }
    }
    await audit('desk_talk_send', orderId, { sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, talk_nos: results.map(r => r.talk_no) });
    console.log(JSON.stringify({ sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }, null, 2));
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
