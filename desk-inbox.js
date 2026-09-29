/* #474 확인 필요 문의 — 에이전트 오피스에서 톡톡·상품 Q&A·주문 문의 미처리 건을 한곳에서 본다
 *
 * 쓰는 법(server.js): require('./desk-inbox.js')(app, { pool, authMiddleware, writeAudit });
 *
 * · 보는 것만 한다. 손님에게 나가는 글은 「톡톡 보낼 글」 표(talk_outbox)에 사람이 확인한 것만 쌓이고,
 *   실서버의 배달부가 톡톡봇의 /send 통로로 넘긴다(AI를 쓰지 않는다 · 받은 글 그대로 전달).
 * · [확인]은 표시만 바꾼다(삭제 아님 · 되돌릴 수 있음).
 * · 표와 칸은 첫 요청 때 만든다 — initDB·타이머 행·설정 행은 건드리지 않는다.
 */
'use strict';

const DAYS = 3;
// 광고·업체 제안 글(손님 문의 아님) — 목록에서 뺀다. 애매하면 남긴다(사람이 [확인]으로 지우면 된다).
const AD_RE = /https?:\/\/|www\.|\.(kr|com|net|co\.kr)\b|순위\s*올리|상위\s*노출|리워드|마케팅\s*(대행|제안)|체험단|제휴\s*(문의|제안)|광고\s*(대행|문의|제안)|▰|▱/i;
const NOT_TEXT = ['[이미지 전송]', '[직원 직접답변]'];
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

module.exports = function mountDeskInbox(app, { pool, authMiddleware, writeAudit }) {
    let ready = null;
    function ensure() {
        if (!ready) ready = (async () => {
            await pool.query(`ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`);
            await pool.query(`ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(50)`);
            await pool.query(`ALTER TABLE naver_qnas ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`);
            await pool.query(`ALTER TABLE naver_qnas ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(50)`);
            await pool.query(`ALTER TABLE naver_inquiries ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`);
            await pool.query(`ALTER TABLE naver_inquiries ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(50)`);
            await pool.query(`CREATE TABLE IF NOT EXISTS talk_outbox (
                id SERIAL PRIMARY KEY,
                log_id INTEGER,
                user_id TEXT NOT NULL,
                body TEXT NOT NULL,
                order_id INTEGER,
                requested_by VARCHAR(50),
                status VARCHAR(12) DEFAULT 'queued',
                error TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                sent_at TIMESTAMP
            )`);
        })().catch(e => { ready = null; throw e; });
        return ready;
    }

    // 톡톡: 손님마다 마지막 줄을 본다. 직원이 답했으면 끝난 건, 봇이 답했으면 「AI 답변 확인」, 아무도 안 했으면 「미답변」
    async function talkItems(includeSeen) {
        const r = await pool.query(`
            WITH last AS (
                SELECT DISTINCT ON (user_id) id, user_id, item, message, answered, bot_response, staff_response,
                       scenario_name, received_at, reviewed_at, reviewed_by
                FROM message_logs
                WHERE received_at > NOW() - ($1 || ' days')::interval AND user_id NOT LIKE 'kakao:%'
                ORDER BY user_id, received_at DESC, id DESC)
            SELECT * FROM last WHERE COALESCE(staff_response, '') = '' ORDER BY received_at DESC LIMIT 60`, [String(DAYS)]);
        const out = [];
        for (const x of r.rows) {
            const msg = String(x.message || '');
            if (!msg.trim() || NOT_TEXT.includes(msg.trim())) continue;
            if (!x.answered && AD_RE.test(msg)) continue;
            if (x.reviewed_at && !includeSeen) continue;
            const bot = x.answered ? String(x.bot_response || '') : '';
            out.push({
                kind: 'talk', id: x.id, at: x.received_at, item: x.item && x.item !== '기타' ? x.item : '',
                state: x.answered ? 'ai' : 'open',
                why: x.answered ? '' : /^\[쿨다운/.test(String(x.bot_response || '')) ? '봇이 답한 뒤 30분 안에 다시 온 글' : /^\[AI에러/.test(String(x.bot_response || '')) ? '봇이 답을 만들지 못함' : '봇이 넘긴 글',
                question: clip(msg, 600), answer: clip(bot, 1200), scenario: x.scenario_name || '',
                seen: !!x.reviewed_at, seen_by: x.reviewed_by || '',
            });
        }
        return out;
    }
    async function qnaItems(includeSeen) {
        const r = await pool.query(`
            SELECT question_id, raw, answered, posted_by, ai_draft, reviewed_at, reviewed_by, collected_at
            FROM naver_qnas
            WHERE COALESCE(NULLIF(raw->>'create_date','')::timestamptz, collected_at) > NOW() - ($1 || ' days')::interval
               OR (NOT answered AND collected_at > NOW() - interval '14 days')
            ORDER BY collected_at DESC LIMIT 60`, [String(DAYS)]);
        const out = [];
        for (const x of r.rows) {
            const raw = x.raw || {};
            const auto = x.answered && x.posted_by === 'auto';
            if (x.answered && !auto) continue;                     // 사람이 답한 건은 끝난 건
            if (x.reviewed_at && !includeSeen) continue;
            out.push({
                kind: 'qna', id: String(x.question_id), at: raw.create_date || x.collected_at, item: clip(raw.product_name, 60),
                state: x.answered ? 'ai' : 'open', why: '',
                question: clip(raw.question, 600), answer: clip(x.answered ? (raw.answer || x.ai_draft) : '', 1200),
                draft: x.answered ? '' : clip(x.ai_draft, 1200),
                seen: !!x.reviewed_at, seen_by: x.reviewed_by || '',
            });
        }
        return out;
    }
    async function inquiryItems(includeSeen) {
        const r = await pool.query(`
            SELECT inquiry_id, raw, answered, posted_by, ai_draft, reviewed_at, reviewed_by, collected_at
            FROM naver_inquiries
            WHERE collected_at > NOW() - ($1 || ' days')::interval OR (NOT answered AND collected_at > NOW() - interval '14 days')
            ORDER BY collected_at DESC LIMIT 60`, [String(DAYS)]);
        const out = [];
        for (const x of r.rows) {
            const raw = x.raw || {};
            const auto = x.answered && x.posted_by === 'auto';
            if (x.answered && !auto) continue;
            if (x.reviewed_at && !includeSeen) continue;
            out.push({
                kind: 'inquiry', id: String(x.inquiry_id), at: raw.registered_at || x.collected_at, item: clip(raw.product_name, 60),
                state: x.answered ? 'ai' : 'open', why: clip(raw.category, 20),
                question: clip([raw.title, raw.content].filter(Boolean).join('\n'), 600),
                answer: clip(x.answered ? (raw.answer_content || x.ai_draft) : '', 1200),
                draft: x.answered ? '' : clip(x.ai_draft, 1200),
                seen: !!x.reviewed_at, seen_by: x.reviewed_by || '',
            });
        }
        return out;
    }

    app.get('/api/agent-office/desk/inbox', authMiddleware, async (req, res) => {
        try {
            await ensure();
            const seen = req.query.seen === '1';
            const safe = async fn => { try { return await fn(seen); } catch (e) { console.error('[inbox]', e.message); return null; } };
            const [talk, qna, inquiry] = await Promise.all([safe(talkItems), safe(qnaItems), safe(inquiryItems)]);
            const count = list => Array.isArray(list) ? { open: list.filter(x => x.state === 'open' && !x.seen).length, ai: list.filter(x => x.state === 'ai' && !x.seen).length } : null;
            res.json({ days: DAYS, talk, qna, inquiry, counts: { talk: count(talk), qna: count(qna), inquiry: count(inquiry) }, at: new Date().toISOString() });
        } catch (e) { console.error('[inbox]', e.message); res.status(500).json({ error: '문의 현황을 읽지 못했습니다' }); }
    });

    // [확인] — 표시만 바꾼다. undo=true 면 되돌린다.
    app.post('/api/agent-office/desk/inbox/review', authMiddleware, async (req, res) => {
        try {
            await ensure();
            const kind = String((req.body && req.body.kind) || ''), undo = !!(req.body && req.body.undo);
            const id = String((req.body && req.body.id) || '');
            const who = clip(req.user.name || req.user.username, 50);
            const T = { talk: ['message_logs', 'id', v => parseInt(v, 10)], qna: ['naver_qnas', 'question_id', v => v], inquiry: ['naver_inquiries', 'inquiry_id', v => v] }[kind];
            if (!T || !id) return res.status(400).json({ error: '어느 문의인지 알 수 없습니다' });
            const r = await pool.query(
                `UPDATE ${T[0]} SET reviewed_at = ${undo ? 'NULL' : 'NOW()'}, reviewed_by = $2 WHERE ${T[1]} = $1 RETURNING ${T[1]}`,
                [T[2](id), undo ? null : who]);
            if (!r.rows.length) return res.status(404).json({ error: '없는 문의입니다' });
            if (writeAudit) await writeAudit({ action: 'update', targetType: 'desk_inbox', targetId: kind === 'talk' ? parseInt(id, 10) : null,
                changes: { after: { kind, id, reviewed: !undo } }, source: 'agent_office', actor: { id: req.user.id, name: who } });
            res.json({ message: undo ? '다시 목록에 올렸습니다' : '확인했습니다' });
        } catch (e) { console.error('[inbox/review]', e.message); res.status(500).json({ error: '처리하지 못했습니다' }); }
    });

    // ── 배달부: 사람이 확인한 톡톡 글을 톡톡봇 통로로 넘긴다 (실서버에서만) ──
    const BOT_URL = (process.env.TALK_BOT_URL || 'https://jeju-akkomene-talktalk-bot.onrender.com').replace(/\/+$/, '');
    let sending = false;
    async function deliver() {
        if (sending) return;
        sending = true;
        try {
            await ensure();
            const token = process.env.SCENARIO_API_TOKEN;
            // 「보내는 중」에 2분 넘게 멈춘 건은 결과를 모르는 건이다 — 다시 보내지 않고 「확인 필요」로 닫는다(두 번 나가는 것보다 낫다)
            await pool.query(`UPDATE talk_outbox SET status = 'failed', error = '결과를 확인하지 못했습니다 — 톡톡 화면에서 나갔는지 확인해 주세요' WHERE status = 'sending' AND created_at < NOW() - interval '2 minutes'`);
            const c = await pool.query(
                `UPDATE talk_outbox SET status = 'sending'
                 WHERE id = (SELECT id FROM talk_outbox WHERE status = 'queued' AND created_at > NOW() - interval '10 minutes' ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
                 RETURNING id, user_id, body, requested_by, log_id`);
            const o = c.rows[0];
            if (!o) return;
            let ok = false, err = '';
            try {
                if (!token) throw new Error('보내기 열쇠(SCENARIO_API_TOKEN)가 없습니다');
                const r = await fetch(BOT_URL + '/send', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                    body: JSON.stringify({ user_id: o.user_id, text: o.body, by: o.requested_by || '' }),
                    signal: AbortSignal.timeout(25000),
                });
                const j = await r.json().catch(() => ({}));
                ok = r.ok && j.ok === true;
                if (!ok) err = j.error || ('응답 ' + r.status);
            } catch (e) { err = e.message; }
            // 🔴 같은 자리표시($2)를 값과 비교에 함께 쓰면 PostgreSQL이 형을 못 정해 실패한다(실측 9/30 — 결과가 「보내는 중」에 멈춤) → 경우를 나눠 쓴다
            if (ok) await pool.query(`UPDATE talk_outbox SET status = 'sent', error = NULL, sent_at = NOW() WHERE id = $1`, [o.id]);
            else await pool.query(`UPDATE talk_outbox SET status = 'failed', error = $2::text WHERE id = $1`, [o.id, clip(err, 300)]);
            if (ok && o.log_id) await pool.query(`UPDATE message_logs SET reviewed_at = COALESCE(reviewed_at, NOW()), reviewed_by = COALESCE(reviewed_by, $2) WHERE id = $1`, [o.log_id, clip(o.requested_by, 50)]);
        } catch (e) { console.error('[talk_outbox] 배달 실패(다음 주기에 다시):', e.message); }
        finally { sending = false; }
    }
    if (process.env.RENDER) { const t = setInterval(deliver, 4000); if (t.unref) t.unref(); }

    return { ensure, deliver, talkItems, AD_RE };
};
