// #474 미처리 톡톡 건 뽑기 — 사용: node scripts/desk/talk-pending.js [--seen]
//   손님마다 마지막 글을 보고, 직원이 아직 답하지 않은 건만 내준다(최근 3일 · 광고/업체 제안 글 제외 · [확인]한 건 제외).
//   #581: 톡톡만(kakao: 카카오 · mall: 자사몰 채팅은 제외 — 둘 다 톡톡 발송 길로 답을 보낼 수 없다).
//   state: open = 아무도 답하지 않음 / ai = 봇이 답함(사람 확인 전)
//   talk_no 는 message_logs 의 번호다 — 보낼 때 talk-send.js 에 이 번호를 준다(손님 식별값은 밖으로 내지 않는다).
const { pool } = require('./_db');
const AD_RE = /https?:\/\/|www\.|\.(kr|com|net|co\.kr)\b|순위\s*올리|상위\s*노출|리워드|마케팅\s*(대행|제안)|체험단|제휴\s*(문의|제안)|광고\s*(대행|문의|제안)|▰|▱/i;
(async () => {
    const seen = process.argv.includes('--seen');
    const r = await pool.query(`
        WITH last AS (
            SELECT DISTINCT ON (user_id) id, user_id, item, message, answered, bot_response, staff_response, scenario_name, received_at,
                   (SELECT to_regclass('public.talk_outbox') IS NOT NULL) AS has_outbox
            FROM message_logs
            WHERE received_at > NOW() - interval '3 days' AND user_id NOT LIKE 'kakao:%' AND user_id NOT LIKE 'mall:%'
            ORDER BY user_id, received_at DESC, id DESC)
        SELECT l.*, to_char(l.received_at + interval '9 hours', 'MM-DD HH24:MI') AS at_kst,
               (SELECT json_agg(json_build_object('at', to_char(p.received_at + interval '9 hours', 'MM-DD HH24:MI'), 'q', LEFT(p.message, 300),
                        'bot', CASE WHEN p.answered THEN LEFT(p.bot_response, 400) ELSE NULL END, 'staff', LEFT(p.staff_response, 300)) ORDER BY p.received_at)
                FROM (SELECT * FROM message_logs m WHERE m.user_id = l.user_id AND m.received_at > NOW() - interval '7 days' AND m.id <> l.id ORDER BY m.received_at DESC LIMIT 4) p) AS earlier
        FROM last l WHERE COALESCE(l.staff_response, '') = '' ORDER BY l.received_at ASC`);
    let rev = new Set();
    try { rev = new Set((await pool.query(`SELECT id FROM message_logs WHERE reviewed_at IS NOT NULL AND received_at > NOW() - interval '3 days'`)).rows.map(x => x.id)); } catch (e) { /* 칸이 아직 없으면 전부 미확인 */ }
    const out = [];
    for (const x of r.rows) {
        const msg = String(x.message || '').trim();
        if (!msg || msg === '[이미지 전송]' || msg === '[직원 직접답변]') continue;
        if (!x.answered && AD_RE.test(msg)) continue;
        if (rev.has(x.id) && !seen) continue;
        out.push({
            talk_no: x.id, at: x.at_kst, product: x.item && x.item !== '기타' ? x.item : null,
            state: x.answered ? 'ai' : 'open',
            why: x.answered ? '봇이 답함(사람 확인 전)' : /^\[쿨다운/.test(String(x.bot_response || '')) ? '봇이 답한 뒤 30분 안에 다시 온 글' : '봇이 답하지 않음',
            question: msg.slice(0, 800), bot_answer: x.answered ? String(x.bot_response || '').slice(0, 800) : null,
            scenario: x.scenario_name || null, earlier_talk: x.earlier || [],
        });
    }
    console.log(JSON.stringify({ count: out.length, open: out.filter(x => x.state === 'open').length, ai: out.filter(x => x.state === 'ai').length, items: out }, null, 2));
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
