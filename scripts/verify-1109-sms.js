// #1109 문자 [초안 만들기](누름 초안) + 자동 AI 초안 스위치(sms_gateway.auto_draft_ai) 검증 — verify-610-server.js 와 같은 장착(가짜 deps + 실DB 시험 번호 0999110…)
//   실DB 쓰기 = 시험 번호 대화 줄만(시작·끝에 지움) · 설정·알림·텔레그램·발송·AI 는 전부 가짜 → 실 설정 행·실 발송·실 AI 0
//   실행: node scripts/verify-1109-sms.js   (포트 PORT1109 또는 3458)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express'); const crypto = require('crypto'); const jwt = require('jsonwebtoken'); const { Pool } = require('pg');
const mount = require('../sms/index.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const PORT = Number(process.env.PORT1109 || 3458), SECRET = 'verify1109secret', JWT = 'verify1109jwt';
process.env.SMSGATE_SIGNING_KEY = SECRET; process.env.SMSGATE_USER = 'u'; process.env.SMSGATE_PASS = 'p';
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (!c && d != null ? ' — ' + String(d).slice(0, 400) : '')); };
const T = '0999110';
async function cleanup() {
    await pool.query(`DELETE FROM sms_images WHERE message_id IN (SELECT m.id FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%']);
}
(async () => {
    const cfgStore = {}; const aiQs = []; let aiDelay = 150; let aiAnswer = { answer: '안녕하세요 고객님 ^^ 냉장 보관해 주세요.', used: [] }; const sent = [];
    const deps = {
        testMode: true, pool, authMiddleware: (req, res, next) => { try { req.user = jwt.verify(String(req.headers.authorization || '').replace('Bearer ', ''), JWT); next(); } catch (e) { res.status(401).json({ error: 'auth' }); } },
        naverCfgGet: async k => cfgStore[k] === undefined ? null : cfgStore[k], naverCfgSet: async (k, v) => { cfgStore[k] = v; }, stateMerge: async o => { cfgStore.sms_gateway_state = Object.assign({}, cfgStore.sms_gateway_state || {}, o); },
        writeAudit: async () => { }, createNotification: async () => { }, notifyTelegram: async () => { },
        loadShippingHolidayInfo: async () => ({ set: new Set(), arriveOff: new Set(), reasons: new Map() }),
        qnaGenerate: async (q, pn, sd, ch) => { aiQs.push({ q, ch }); await new Promise(r => setTimeout(r, aiDelay)); return aiAnswer; },
        cjTrack: null, deliveryUpsertStatus: null, log: { log() { }, error(...a) { console.log('   [module error]', ...a); } },
        gatewaySend: async (digits, text, id) => { sent.push({ digits, text, id }); return { id }; },
    };
    const app = express();
    app.use(express.json({ limit: '15mb', verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/sms/webhook')) req.rawBody = buf.toString('utf8'); } }));
    const sms = mount(app, deps); await sms.initDB(); await cleanup();
    const srv = app.listen(PORT); const base = `http://127.0.0.1:${PORT}`;
    const token = jwt.sign({ id: 1, username: 'v', name: '검증', role: 'admin' }, JWT);
    const api = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
    const hook = async body => { const raw = JSON.stringify(body), ts = String(Math.floor(Date.now() / 1000)); const sig = crypto.createHmac('sha256', SECRET).update(raw + ts).digest('hex');
        await fetch(base + '/api/sms/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Signature': sig, 'X-Timestamp': ts }, body: raw }); await new Promise(r => setTimeout(r, 2000)); };
    const env = (event, payload) => ({ id: crypto.randomUUID(), event, deviceId: 'dev1', payload });
    const say = (d, text) => hook(env('sms:received', { messageId: 'v1109-' + crypto.randomUUID(), message: text, phoneNumber: '+82' + d.slice(1), receivedAt: new Date().toISOString() }));
    const thread = async d => (await pool.query(`SELECT * FROM sms_threads WHERE phone_digits = $1`, [d])).rows[0];
    const setCfg = o => { sms.resetCfg(); cfgStore.sms_gateway = Object.assign({ enabled: true, mode: 'draft', hold_sec: 0, max_chars: 1000, staff_ids: [1] }, o); };
    try {
        console.log('① 설정 칸');
        ok(sms.cfgOf({}).auto_draft_ai === true && sms.cfgOf({ auto_draft_ai: false }).auto_draft_ai === false && sms.cfgOf({ auto_draft_ai: 'no' }).auto_draft_ai === true, 'auto_draft_ai = 없음·그 밖 true(종전) · false 만 꺼짐');

        console.log('② 스위치 켜짐(종전) = 손님 글마다 AI 초안');
        setCfg({}); const P1 = T + '0001'; let n0 = aiQs.length;
        await say(P1, '귤 보관은 어떻게 해요?');
        let t1 = await thread(P1);
        ok(t1 && t1.status === 'draft' && t1.draft_text === aiAnswer.answer && !t1.staff_why && aiQs.length === n0 + 1 && aiQs[aiQs.length - 1].ch === 'sms', '켜짐 = status draft · AI 초안 · AI 1회(종전과 같음)', JSON.stringify(t1 && { s: t1.status, d: t1.draft_text, w: t1.staff_why, n: aiQs.length - n0 }));

        console.log('③ 스위치 꺼짐 = AI 0 · 직원 답 필요(no_draft) · 미처리에 잡힘');
        setCfg({ auto_draft_ai: false }); const P2 = T + '0002'; n0 = aiQs.length;
        await say(P2, '귤 보관은 어떻게 해요?');
        let t2 = await thread(P2);
        ok(t2 && t2.status === 'staff_needed' && t2.staff_why === 'no_draft' && !t2.draft_text && aiQs.length === n0, '꺼짐 = staff_needed · staff_why no_draft · 초안 0 · AI 0', JSON.stringify(t2 && { s: t2.status, d: t2.draft_text, w: t2.staff_why, n: aiQs.length - n0 }));
        { const l = await api('GET', '/api/sms/threads?scope=all&limit=50'); const row = (l.json.items || []).find(x => x.id === t2.id);
          ok(row && row.needs_staff === true && row.staff_why === 'no_draft' && row.staff_why_label === '직원 답 필요', '목록 줄 = needs_staff true · 칩 「직원 답 필요」', JSON.stringify(row && { n: row.needs_staff, w: row.staff_why, l: row.staff_why_label }));
          const o = await api('GET', '/api/sms/threads?scope=open&limit=50'); ok((o.json.items || []).some(x => x.id === t2.id), '「답 안 한 것만」 목록에 잡힘'); }
        { const sm = await api('GET', '/api/sms/summary'); ok(sm.status === 200 && Number(sm.json.needs_staff || (sm.json.counts && sm.json.counts.needs_staff) || 0) >= 1, '요약(카드·손님 n) 사람 몫 숫자에 잡힘', JSON.stringify(sm.json && { ns: sm.json.needs_staff, c: sm.json.counts })); }
        // 규칙 답(비용 0)은 꺼짐이어도 자동 = 주문 못 찾은 배송 물음 → 고정 문구 초안(AI 0)
        const P3 = T + '0003'; n0 = aiQs.length;
        await say(P3, '제 귤 언제 도착하나요?');
        let t3 = await thread(P3);
        ok(t3 && t3.draft_text && /주문/.test(t3.draft_text) && aiQs.length === n0, '꺼짐에도 규칙 답 = 주문 못 찾음 고정 문구 초안 · AI 0', JSON.stringify(t3 && { s: t3.status, d: t3.draft_text, w: t3.staff_why, n: aiQs.length - n0 }));

        ok(/^안녕하세요 고객님 \^\^/.test(t3.draft_text || ''), '#1109 인사: 첫 답(우리 글 없음) = 인사 유지', t3.draft_text);
        {   // 2일 전 우리 글(오늘은 아님 = #646 「오늘」 기준엔 안 걸림) 이 있는 대화 = 초안 첫머리 인사 뗌 · 뒤 본문 보존
            const P7 = T + '0007'; await say(P7, '안녕하세요'); const t7a = await thread(P7);
            await pool.query(`INSERT INTO sms_messages (thread_id, direction, kind, body, sender, state, created_at) VALUES ($1, 'out', 'sms', '네 고객님 감사합니다', 'staff_desk', 'sent', now() - interval '2 days')`, [t7a.id]);
            await say(P7, '제 귤 언제 도착하나요?'); const t7 = await thread(P7);
            ok(t7.draft_text && !/^안녕하세요/.test(t7.draft_text) && /^보내주신 번호로는 주문이 확인되지 않습니다/.test(t7.draft_text), '#1109 인사: 7일 안 우리 글 있는 대화 = 인사 뗌 · 본문 그대로', t7.draft_text);
        }
        console.log('④ [초안 만들기](누름) = AI 1회 · draft_text 만 씀 · status·staff_why 그대로 · 연타 409');
        n0 = aiQs.length; aiDelay = 1500;   // 첫 요청이 AI 를 기다리는 동안 둘째가 들어오게(실DB 연결 대기에 흔들리지 않게)
        const [a, b] = await Promise.all([api('POST', `/api/sms/threads/${t2.id}/draft`, {}), new Promise(r => setTimeout(r, 300)).then(() => api('POST', `/api/sms/threads/${t2.id}/draft`, {}))]); aiDelay = 150;
        const st = [a.status, b.status].sort().join(',');
        ok(st === '200,409' && [a, b].some(x => x.json.code === 'busy'), '같은 대화 연타 = 한 번만(200 + 409 busy)', JSON.stringify([a.status, a.json, b.status, b.json]));
        const good = a.status === 200 ? a : b;
        t2 = await thread(P2);
        ok(good.json.ok === true && good.json.draft_text === aiAnswer.answer && t2.draft_text === aiAnswer.answer && t2.status === 'staff_needed' && t2.staff_why === 'no_draft' && aiQs.length === n0 + 1, '누름 초안 = 저장 · status·staff_why 그대로 · AI 1회(꺼짐 스위치·하루 상한 무관)', JSON.stringify({ j: good.json.ok, d: t2.draft_text, s: t2.status, w: t2.staff_why, n: aiQs.length - n0 }));
        ok(good.json.thread && good.json.thread.id === t2.id && good.json.thread.draft_text === aiAnswer.answer, '응답 thread = 목록 줄 꼴 + 새 초안');
        ok(sent.length === 0, '발송 0(누름 초안은 보내지 않음)');
        // 재료 없음 = ok false no_draft · 초안 그대로
        aiAnswer = { answer: '[사람] 판단 필요', used: [] };
        const r2 = await api('POST', `/api/sms/threads/${t2.id}/draft`, {}); t2 = await thread(P2);
        ok(r2.status === 200 && r2.json.ok === false && r2.json.code === 'no_draft' && /만들지 못했어요/.test(r2.json.error) && t2.draft_text === '안녕하세요 고객님 ^^ 냉장 보관해 주세요.', 'AI 가 넘김(엔진·맥락 초안 둘 다) = ok false no_draft 「만들지 못했어요」 · 앞 초안 그대로', JSON.stringify(r2.json));
        aiAnswer = { answer: '안녕하세요 고객님 ^^ 냉장 보관해 주세요.', used: [] };
        // 꺼진 연동 = 409 · 없는 대화 = 404
        setCfg({ enabled: false }); ok((await api('POST', `/api/sms/threads/${t2.id}/draft`, {})).status === 409, '문자 연동 꺼짐 = 409');
        setCfg({}); ok((await api('POST', `/api/sms/threads/987654321/draft`, {})).status === 404, '없는 대화 = 404');
        // record 모드에서도 누름 초안은 됨(직원이 눌렀을 때만)
        setCfg({ mode: 'record' }); const r3 = await api('POST', `/api/sms/threads/${t1.id}/draft`, {}); ok(r3.status === 200 && r3.json.ok === true, 'record 모드에서도 누르면 초안', JSON.stringify(r3.json));
        console.log('⑤ 손질(워커3 점검) ①닫기 틱 ②맥락 초안 ③draft-clear ④ai_json · 자리표');
        // ① no_draft 는 staff_open_hours 지나도 안 닫힘 · 다른 사유는 종전대로 닫힘
        setCfg({ auto_draft_ai: false });
        const P5 = T + '0005'; await say(P5, '주문 취소해 주세요'); const t5 = await thread(P5);
        await pool.query(`UPDATE sms_threads SET last_in_at = now() - interval '7 hours', updated_at = now() - interval '7 hours' WHERE id = ANY($1::int[])`, [[t2.id, t5.id]]);
        await sms.sweepStuck();
        { const a2 = await thread(P2), a5 = await thread(P5); ok(a2.status === 'staff_needed' && a2.staff_why === 'no_draft' && a5.status === 'closed', '① 6시간 지난 no_draft = 안 닫힘 · 다른 사유(' + t5.staff_why + ') = 종전대로 닫힘', JSON.stringify([a2.status, a2.staff_why, t5.staff_why, a5.status])); }
        // ② 첫 불만 = 대표 확정 글(규칙) · 우리가 답한 뒤 보상 요구 = 맥락 초안(톡톡 초안 엔진 · talk_draft · 앞 대화 · 금액 자리표 · 이모지 뺌)
        setCfg({});
        const P6 = T + '0006'; await say(P6, '귤이 물러서 왔어요 상한게 많아요');
        let t6 = await thread(P6); const first6 = t6.draft_text;
        ok(!!first6 && /에고 그러셨군요/.test(first6), '② 첫 불만 글 = 대표 확정 글(#1077 claimNotFound) 초안', first6);
        await api('POST', `/api/sms/threads/${t6.id}/reply`, { text: '에고 그러셨군요 불편드려 죄송합니다 반품 또는 보상 가능합니다' });
        await say(P6, '보상해 주세요 5천원 정도요');
        aiAnswer = { answer: '[사람] 보상\n네 고객님 불편드려 다시한번 죄송하구요, 저희가 포인트 5천원 지급 도와드리겠습니다 😊 감사합니다 ^^', used: [] }; n0 = aiQs.length;
        const r6 = await api('POST', `/api/sms/threads/${t6.id}/draft`, {}); const q6 = aiQs[aiQs.length - 1] || {};
        ok(r6.json.ok === true && /0,000원 지급 도와드리겠습니다/.test(r6.json.draft_text) && !/😊|\[사람\]|5천원/.test(r6.json.draft_text) && /\^\^/.test(r6.json.draft_text), '② 보상 요구 = 맥락 초안 · 손님 금액 → 0,000원 · 「[사람]」 줄·이모지 뺌 · ^^ 유지', JSON.stringify(r6.json));
        ok(aiQs.length === n0 + 1 && q6.ch === 'talk_draft' && /^\[채널 — 이 대화는 회사 휴대폰 문자/.test(q6.q) && /\[앞 대화/.test(q6.q) && /직원: 에고 그러셨군요 불편드려 죄송합니다 반품 또는 보상/.test(q6.q) && /손님: 귤이 물러서 왔어요/.test(q6.q) && /\n보상해 주세요 5천원 정도요$/.test(q6.q), '② AI 입력 = 문자 머리 + 앞 대화(손님·직원) + 이번 손님 글 · 채널 talk_draft', q6.q);
        // 요청형(엔진이 사람 몫) = 맥락 초안으로
        aiAnswer = { answer: '네 고객님 확인해서 취소 도와드리겠습니다.', used: [] };
        const r5 = await api('POST', `/api/sms/threads/${t5.id}/draft`, {});
        ok(r5.json.ok === true && r5.json.draft_text === '네 고객님 확인해서 취소 도와드리겠습니다.' && aiQs[aiQs.length - 1].ch === 'talk_draft', '② 요청형(종전 「재료가 없어요」) = 맥락 초안', JSON.stringify(r5.json));
        // ④ 누름 길은 받은 글 ai_json 을 덮지 않음
        { const m5 = (await pool.query(`SELECT id, ai_json FROM sms_messages WHERE thread_id = $1 AND direction = 'in' ORDER BY id DESC LIMIT 1`, [t5.id])).rows[0];
          await pool.query(`UPDATE sms_messages SET ai_json = '{"photo":"판독 요약 보존"}'::jsonb WHERE id = $1`, [m5.id]);
          await api('POST', `/api/sms/threads/${t5.id}/draft`, {});
          const a = (await pool.query(`SELECT ai_json FROM sms_messages WHERE id = $1`, [m5.id])).rows[0].ai_json; ok(a && a.photo === '판독 요약 보존' && !a.staff_why, '④ 누름 뒤 받은 글 ai_json 그대로', JSON.stringify(a)); }
        // ③ draft-clear = seen 같을 때만
        { const cur = (await thread(P5)).draft_text;
          const x1 = await api('POST', `/api/sms/threads/${t5.id}/draft-clear`, { seen: '다른 글' }); const k1 = (await thread(P5)).draft_text;
          const x2 = await api('POST', `/api/sms/threads/${t5.id}/draft-clear`, { seen: cur + '\n' }); const k2 = (await thread(P5)).draft_text;
          ok(x1.json.ok && x1.json.cleared === false && k1 === cur && x2.json.ok && x2.json.cleared === true && k2 === null && (await thread(P5)).status !== 'draft', '③ draft-clear = seen 다르면 그대로 · 같으면 비움(status 그대로)', JSON.stringify([x1.json.cleared, x2.json.cleared, k2]));
          ok((await api('POST', `/api/sms/threads/${t5.id}/draft-clear`, {})).status === 400, '③ seen 없으면 400'); }
        // #1109 자리표 막기 뺌(대표 「0,000원 보내기 막기는 안 해도 돼 · 우리가 수정해서 보낼 거야」) = [이대로 보내기]·답·새 문자 전부 보내짐
        { const c = await api('POST', `/api/sms/threads/${t6.id}/send-draft`, { seen: r6.json.draft_text });
          const a = await api('POST', `/api/sms/threads/${t6.id}/reply`, { text: '포인트 0,000원 지급 도와드리겠습니다' });
          const b = await api('POST', `/api/sms/send`, { phone: T + '0006', text: '포인트 0,000원 드려요' });
          ok(c.status === 200 && a.status === 200 && b.status === 200 && ![a, b, c].some(x => x.json.code === 'placeholder'), '자리표 남은 글 = [이대로 보내기]·답·새 문자 전부 보냄(막기 0)', JSON.stringify([c.status, a.status, b.status])); }
        // 🔴 워커3 점검: 봇 자동 초안 대화(status draft · 사유 없음) → [초안 다시 만들기] → [지우기](draft-clear) = 서버 초안 안 비움(미처리·손님 n 에서 안 빠짐)
        { setCfg({}); aiAnswer = { answer: '안녕하세요 고객님 ^^ 냉장 보관해 주세요.', used: [] };
          const P8 = T + '0008'; await say(P8, '귤 보관은 어떻게 해요?'); let t8 = await thread(P8);
          const ok8a = t8.status === 'draft' && !t8.staff_why && !!t8.draft_text;
          aiAnswer = { answer: '냉장고 채소칸에 두시면 오래 드실 수 있어요.', used: [] };
          const m8 = await api('POST', `/api/sms/threads/${t8.id}/draft`, {}); t8 = await thread(P8);
          const x8 = await api('POST', `/api/sms/threads/${t8.id}/draft-clear`, { seen: m8.json.draft_text }); t8 = await thread(P8);
          const l8 = await api('GET', '/api/sms/threads?scope=open&limit=200');
          ok(ok8a && m8.json.ok && x8.json.ok && x8.json.cleared === false && t8.draft_text === m8.json.draft_text && t8.status === 'draft' && (l8.json.items || []).some(x => x.id === t8.id && x.needs_staff === true), '🔴 자동 초안 대화 → 다시 만들기 → [지우기] = 서버 초안 그대로(cleared false) · 미처리에 남음', JSON.stringify({ a: ok8a, m: m8.json.ok, c: x8.json.cleared, s: t8.status, d: !!t8.draft_text })); }
        // #1109 auto_draft_rule false = 규칙 글(주문 못 찾음 고정 문구 등)도 미리 안 만듦 · 미처리(no_draft) · 주문 찾기·주문 줄 그대로 · 누르면 종전 엔진(규칙 글)
        { setCfg({ auto_draft_rule: false, auto_draft_ai: false }); const P9 = T + '0009'; n0 = aiQs.length;
          await say(P9, '제 귤 언제 도착하나요?'); let t9 = await thread(P9);
          ok(t9.status === 'staff_needed' && t9.staff_why === 'no_draft' && !t9.draft_text && aiQs.length === n0, '규칙 꺼짐 = 규칙 글도 미리 안 만듦 · staff_needed no_draft · AI 0', JSON.stringify({ s: t9.status, w: t9.staff_why, d: t9.draft_text }));
          const l9 = await api('GET', '/api/sms/threads?scope=open&limit=200'); ok((l9.json.items || []).some(x => x.id === t9.id && x.needs_staff === true && x.staff_why_label === '직원 답 필요'), '규칙 꺼짐 = 미처리(scope=open)·칩 「직원 답 필요」에 잡힘');
          const m9 = await api('POST', `/api/sms/threads/${t9.id}/draft`, {}); t9 = await thread(P9);
          ok(m9.json.ok === true && m9.json.draft_text === aiAnswer.answer && aiQs.length === n0 + 1 && aiQs[aiQs.length - 1].ch === 'sms' && /이 번호로는 주문을 찾지 못했습니다/.test(aiQs[aiQs.length - 1].q) && t9.status === 'staff_needed' && t9.staff_why === 'no_draft', '규칙 꺼짐 + [초안 만들기] = 종전 초안 모드 엔진 그대로(주문 못 찾은 배송 물음 = #1063 「주문 못 찾음」 안내 붙은 AI 초안) · status·사유 그대로', JSON.stringify(m9.json));
          const P10 = T + '0010'; await say(P10, '감사합니다'); const t10 = await thread(P10);
          ok(t10 && t10.staff_why !== 'no_draft', '규칙 꺼짐에도 무시 갈래(인사)는 종전대로(no_draft 로 안 쌓임)', JSON.stringify(t10 && { s: t10.status, w: t10.staff_why }));
          setCfg({}); }
        aiAnswer = { answer: '안녕하세요 고객님 ^^ 냉장 보관해 주세요.', used: [] };
        // auto 모드 + 스위치 꺼짐 = 스위치는 초안 모드에만(auto 자동 발송 길 무접촉)
        setCfg({ mode: 'auto', auto_draft_ai: false }); const P4 = T + '0004'; n0 = aiQs.length;
        await say(P4, '귤 가격이 얼마예요?');
        ok(aiQs.length === n0 + 1, 'auto 모드 = 스위치 무관(AI 종전대로)', aiQs.length - n0);
    } catch (e) { console.error(e); fail++; }
    finally { await cleanup().catch(e => console.error('정리 실패', e.message)); srv.close(); await pool.end(); }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();
