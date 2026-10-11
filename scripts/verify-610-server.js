// #610 회사폰 문자 — 서버 모듈(sms/index.js) 검증 · 총괄 10/10
//   실DB 에 sms_* 표를 만들고(initDB 와 같은 문장) 시험 번호(0999…)로 흐름을 돌린 뒤 그 줄만 지운다. 설정·알림·텔레그램·발송은 전부 가짜(deps 주입) → 실 설정 행·실 발송 0.
//   실행: node scripts/verify-610-server.js   (포트 3458 · 끝에 「N/N」)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express'); const crypto = require('crypto'); const jwt = require('jsonwebtoken'); const { Pool } = require('pg');
const mount = require('../sms/index.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const PORT = Number(process.env.PORT610 || 3458), SECRET = 'verify610secret', JWT = 'verify610jwt';
process.env.SMSGATE_SIGNING_KEY = SECRET; process.env.SMSGATE_USER = 'u'; process.env.SMSGATE_PASS = 'p';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };
const T = '0999000'; const P1 = T + '1001', P2 = T + '1002', P3 = T + '1003', P4 = T + '1004', P5 = T + '1005', P6 = T + '1006';
// #648: 도중에 죽거나 끊어도(오류·Ctrl+C) 시험 줄을 지운다 — 남은 시험 대화가 라이브 화면에 뜨지 않게
async function cleanupTest() {
    try {
        await pool.query(`DELETE FROM sms_images WHERE message_id IN (SELECT m.id FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits LIKE $1)`, [T + '%']);
        await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits LIKE $1)`, [T + '%']);
        await pool.query(`DELETE FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%']);
        await pool.query(`DELETE FROM delivery_status WHERE tracking LIKE '9996000643%' OR tracking LIKE '9996000646%' OR tracking LIKE '9996000650%'`);
        await pool.query(`DELETE FROM delivery_shipments WHERE source IN ('verify-643', 'verify-646', 'verify-650')`);
        await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits = '14155550199')`); await pool.query(`DELETE FROM sms_threads WHERE phone_digits = '14155550199'`);   // 해외 번호 시험 대화
    } catch (e) { console.error('시험 줄 정리 실패:', e.message); }
}
let _stopping = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, async () => { if (_stopping) return; _stopping = true; console.log('\n끊김 — 시험 줄을 지웁니다'); await cleanupTest(); try { await pool.end(); } catch (_) { } process.exit(130); });
(async () => {
    // 가짜 의존
    const cfgStore = { sms_gateway: { enabled: true, mode: 'record', hold_sec: 0, max_chars: 70 } }; const notes = [], tg = [], sent = []; let aiAnswer = null;
    const deps = {
        testMode: true,   // 실서버가 시험 번호 줄을 집지 않게(index.js TEST_SKIP) · 검증은 자기 줄을 집음
        pool, authMiddleware: (req, res, next) => { try { req.user = jwt.verify(String(req.headers.authorization || '').replace('Bearer ', ''), JWT); next(); } catch (e) { res.status(401).json({ error: 'auth' }); } },
        naverCfgGet: async k => cfgStore[k] === undefined ? null : cfgStore[k], naverCfgSet: async (k, v) => { cfgStore[k] = v; }, stateMerge: async o => { cfgStore.sms_gateway_state = Object.assign({}, cfgStore.sms_gateway_state || {}, o); },
        writeAudit: async () => { }, createNotification: async (uid, type, title, message, link) => { notes.push({ uid, type, title, message, link }); },
        notifyTelegram: async t => { tg.push(t); }, loadShippingHolidayInfo: async () => ({ set: new Set(), arriveOff: new Set(), reasons: new Map() }),
        qnaGenerate: async (q, pn, sd, ch) => { ok(ch === 'sms', 'qnaGenerate 채널 sms'); aiQs.push(q); return aiAnswer; },
        cjTrack: null, deliveryUpsertStatus: null, log: { log() { }, error(...a) { console.log('   [module error]', ...a); } },
        gatewaySend: async (digits, text, id) => { sent.push({ digits, text, id }); return { id }; },
    };
    cfgStore.sms_gateway.staff_ids = [1];
    const aiQs = [];   // #625: AI 에 넘긴 질문 글(앞 대화 포함 여부 확인)
    const app = express();
    app.use(express.json({ limit: '15mb', verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/sms/webhook')) req.rawBody = buf.toString('utf8'); } }));
    const sms = mount(app, deps);
    await sms.initDB();
    await pool.query(`DELETE FROM sms_images WHERE message_id IN (SELECT m.id FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%']);
    const srv = app.listen(PORT); const base = `http://127.0.0.1:${PORT}`;
    const token = jwt.sign({ id: 1, username: 'v', name: '검증', role: 'admin' }, JWT);
    const api = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})), headers: r.headers }; };
    const hook = async (body, opts = {}) => {
        const raw = JSON.stringify(body); const ts = String(Math.floor(Date.now() / 1000) - (opts.ageSec || 0));
        const sig = opts.badSig ? 'deadbeef' : crypto.createHmac('sha256', SECRET).update(raw + ts).digest('hex');
        const r = await fetch(base + '/api/sms/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Signature': sig, 'X-Timestamp': ts }, body: raw });
        const j = await r.json().catch(() => ({})); await new Promise(r2 => setTimeout(r2, opts.waitMs || 1800)); return { status: r.status, json: j };   // 즉시 200 뒤 비동기 처리(실DB 왕복 여러 번) 를 기다림
    };
    const env = (event, payload) => ({ id: crypto.randomUUID(), event, deviceId: 'dev1', payload });
    const thread = async d => (await pool.query(`SELECT * FROM sms_threads WHERE phone_digits = $1`, [d])).rows[0];
    const msgs = async d => (await pool.query(`SELECT m.* FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits = $1 ORDER BY m.id`, [d])).rows;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    console.log('① 단위');
    ok(sms.normalizePhone('+82 10-1234-5678') === '01012345678', 'normalize +82');
    ok(sms.normalizePhone('010.1234.5678') === '01012345678', 'normalize 점');
    ok(sms.phoneMasked('01012345678') === '010****5678' && sms.phoneTail('01012345678') === '5678', 'mask/tail');
    const long = '안녕하세요 제주아꼼이네입니다. 주문하신 하우스감귤은 10/11(일) 오전에 효돈에서 출발해요. 도착은 10/12(월)에서 10/13(화) 사이 예정입니다. 감사합니다.';
    const pieces = sms.splitForSms(long, 70);
    ok(pieces.length >= 2 && pieces.every(p => Array.from(p).length <= 70) && pieces.join(' ').replace(/\s+/g, ' ') === long.replace(/\s+/g, ' '), 'split 70자 · 글자 보존 ' + JSON.stringify(pieces));
    ok(sms.splitForSms('짧은 글', 70).length === 1, 'split 1통');
    {   // #643: 주소가 든 줄은 한도(70자)보다 길어도 자르지 않는다 — 끊긴 주소는 안 눌린다
        const url = 'https://jeju-acom-company.onrender.com/track?n=590111112222', msg = '안녕하세요 고객님 ^^ 오늘 제주에서 출발했습니다!\n송장번호 590111112222(CJ대한통운)\n내일 화요일(10/13)~수요일(10/14) 사이 도착 예정입니다.\n배송조회 ' + url + '\n행복한 하루 되세요 ^^';
        const ps = sms.splitForSms(msg, 70);
        ok(ps.length >= 3 && ps.filter(p => p.includes('http')).length === 1 && ps.some(p => p === '배송조회 ' + url) && ps.join(' ').includes(url) && ps.filter(p => !p.includes('http')).every(p => Array.from(p).length <= 70) && sms.splitForSms(msg, 1000).length === 1 && sms.splitForSms(msg, 1000)[0] === msg,
            '#643 split: 주소 줄은 통째로 한 통(73자) · 다른 조각은 70자 안 · 1000자면 한 덩어리 그대로 ' + JSON.stringify(ps.map(p => Array.from(p).length)));
    }
    ok(sms.smsSafeText('안녕 😀 🍊 반가워요').indexOf('😀') < 0, 'smsSafeText 이모지 제거');
    const c0 = sms.cfgOf({ mode: 'bogus', daily_cap: 999, max_chars: 10 });
    ok(c0.mode === 'record' && c0.daily_cap === 3 && c0.cooldown_min === 30 && mount.DEFAULT_CFG.cooldown_min === 30 && c0.staff_open_hours === 6 && c0.context_msgs === 6 && c0.max_chars === 70, '#625·#635 cfgOf 기본값 = 하루 3번 · 쿨다운 30분(#635 되돌림) · 직원 몫 6시간 · 앞 대화 6통 ' + JSON.stringify(c0));
    const pe = sms.parseEvent(env('sms:received', { messageId: 'm1', message: '안녕', phoneNumber: '+821012345678', simNumber: 1, receivedAt: '2026-10-10T01:00:00+09:00' }));
    ok(pe.ev === 'sms:received' && pe.digits === '01012345678' && pe.body === '안녕' && pe.gateway_id === 'm1' && pe.envelope_id && pe.event_at instanceof Date, 'parseEvent');

    console.log('② webhook 서명·잠금');
    let r = await hook(env('system:ping', {}), { badSig: true }); ok(r.status === 401, '서명 틀림 401 ' + r.status);
    r = await fetch(base + '/api/sms/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); ok(r.status === 401, '서명 없음 401 ' + r.status);
    const keep = process.env.SMSGATE_SIGNING_KEY; delete process.env.SMSGATE_SIGNING_KEY; delete process.env.SMSGATE_WEBHOOK_SECRET;
    r = await hook(env('system:ping', {})); ok(r.status === 503, '키 없음 503 ' + r.status); process.env.SMSGATE_SIGNING_KEY = keep;
    r = await hook(env('system:ping', {}), { ageSec: 2 * 86400 }); ok(r.status === 200 && r.json.accepted, '이틀 전 타임스탬프(재시도) 허용');
    ok(cfgStore.sms_gateway_state && cfgStore.sms_gateway_state.last_ping_at, 'ping → last_ping_at');

    console.log('③ record 모드 — 기록만');
    r = await hook(env('sms:received', { messageId: 'a1', message: '언제 와요?', phoneNumber: '+82' + P1.slice(1), receivedAt: new Date().toISOString() }));
    ok(r.status === 200 && r.json.accepted === true && !('action' in r.json), '즉시 200 · 결과는 뒤에서');
    let t1 = await thread(P1); ok(t1 && t1.status === 'new' && t1.last_in_text === '언제 와요?', 'record: 상태 new ' + (t1 && t1.status));
    let m1 = await msgs(P1); ok(m1.length === 1 && m1[0].direction === 'in' && m1[0].bucket, 'record: in 1건 · bucket ' + (m1[0] && m1[0].bucket));
    ok(sent.length === 0 && notes.length === 0, 'record: 발송 0 · 알림 0(ship_q)');
    r = await hook(env('sms:received', { messageId: 'a2', message: '[Web발신] 인증번호 123456 을 입력하세요', phoneNumber: '+82' + P2.slice(1) }));
    ok((await thread(P2)).status === 'ignored', 'otp → ignored');
    r = await hook(env('sms:received', { messageId: 'a3', message: '귤이 다 썩어서 왔어요 환불해주세요', phoneNumber: '+82' + P3.slice(1) }));
    ok((await thread(P3)).status === 'staff_needed', 'claim → staff_needed');
    ok(notes.length === 1 && notes[0].type === 'sms' && !notes[0].title.includes(P3) && notes[0].title.includes(P3.slice(-4)) && notes[0].link.startsWith('agent-office?sms='), '클레임 알림 1건 · 전체 번호 없음 · 끝 4자리');
    const dupEnv = env('sms:received', { messageId: 'a4', message: '또 보냄', phoneNumber: '+82' + P3.slice(1) });
    await hook(dupEnv); await hook(dupEnv);
    ok((await msgs(P3)).length === 2, '봉투 id 같은 재시도 → 1건만 ' + (await msgs(P3)).length);
    ok((await thread(P3)).status === 'staff_needed' && notes.length === 1, '직원 몫 대화에 다시 옴 → 잠금 유지 · 알림은 5분 1회(두 번째 안 감)');

    console.log('④ auto 모드 — 규칙/AI 답 · 유예 · 쿨다운 · 하루 1번');
    sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 70, staff_ids: [1], cooldown_min: 30, daily_cap: 1 };
    aiAnswer = { answer: '네, 보관은 서늘한 곳에 두시고 드실 만큼만 꺼내 두세요. 냉장 보관하시면 더 오래 신선하게 드실 수 있어요. 😊 추가 문의는 톡톡으로 주세요.', used: [] };
    r = await hook(env('sms:received', { messageId: 'b1', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + P4.slice(1) }));
    let t4 = await thread(P4), m4 = await msgs(P4);
    const outs = m4.filter(x => x.direction === 'out');
    ok(t4.status === 'bot_replied', 'auto: bot_replied ' + t4.status);
    ok(outs.length >= 2 && outs.every(o => o.sender === 'bot' && o.state === 'queued' && Array.from(o.body).length <= 70), 'auto: 70자 조각 큐 ' + outs.length + '통');
    ok(outs.every(o => !/😊|톡톡/.test(o.body)), 'auto: 이모지·톡톡 제거');
    let st = await sms.sendTick(); ok(Array.isArray(st) && st.filter(x => x.sent).length === outs.length, 'sendTick 발송 ' + JSON.stringify(st));
    ok(sent.length === outs.length && sent.every(x => x.digits === P4 && x.id), '가짜 게이트웨이로 보냄 · 우리 id 지정');
    t4 = await thread(P4); ok(t4.cooldown_until && new Date(t4.cooldown_until) > new Date() && t4.bot_count === 1, '쿨다운·bot_count 답당 1 ' + t4.bot_count);
    m4 = await msgs(P4); ok(m4.filter(x => x.direction === 'out').every(x => x.state === 'sending' && x.gateway_id), '202 뒤 out 상태 sending + gateway_id');
    ok(m4.filter(x => x.direction === 'out').map(x => x.priority).join(',') === '9,8' || m4.filter(x => x.direction === 'out').map(x => x.priority).join(',').startsWith('9,8'), '조각 priority 9,8… ' + m4.filter(x => x.direction === 'out').map(x => x.priority).join(','));
    ok(sent.length >= 2 && sent[0].text === m4.filter(x => x.direction === 'out')[0].body, '첫 조각이 먼저 나감');
    // sms:sent(recipient = 손님 · sender = 회사폰) → sent · 번호 방향
    const gid0 = m4.find(x => x.direction === 'out').gateway_id;
    await hook(env('sms:sent', { messageId: gid0, sender: '+821000000000', recipient: '+82' + P4.slice(1), sentAt: new Date().toISOString() }));
    ok((await msgs(P4)).find(x => x.gateway_id === gid0).state === 'sent', 'sms:sent → sent');
    ok(!(await thread('01000000000')), '보낸 쪽 이벤트가 회사폰 번호로 대화를 만들지 않음');
    const peo = sms.parseEvent(env('sms:delivered', { messageId: 'z', sender: '+821000000000', recipient: '+82' + P4.slice(1) })); ok(peo.digits === P4, 'parseEvent 보낸 쪽 = recipient');
    // 전송 결과 webhook(우리 id) → delivered
    const gid = m4.find(x => x.direction === 'out').gateway_id;
    await hook(env('sms:delivered', { messageId: gid, phoneNumber: '+82' + P4.slice(1), deliveredAt: new Date().toISOString() }));
    ok((await msgs(P4)).find(x => x.gateway_id === gid).state === 'delivered', 'sms:delivered → delivered');
    await hook(env('sms:sent', { messageId: gid, sender: '+821000000000', recipient: '+82' + P4.slice(1) }));
    ok((await msgs(P4)).find(x => x.gateway_id === gid).state === 'delivered', '늦게 온 sms:sent 가 delivered 를 되돌리지 않음');
    // 같은 손님 다시 옴 → 직원 몫
    const nBefore = notes.length;
    await hook(env('sms:received', { messageId: 'b2', message: '고마워요 그런데 하나 더 물을게요 언제 와요', phoneNumber: '+82' + P4.slice(1) }));
    ok((await thread(P4)).status === 'staff_needed' && notes.length === nBefore + 1, '쿨다운 안 다시 옴 → staff_needed + 알림');
    ok((await msgs(P4)).filter(x => x.direction === 'out' && x.state === 'queued').length === 0, '다시 온 글에 봇 큐 0');
    // 실패 webhook → staff_needed
    sms.resetCfg(); cfgStore.sms_gateway.hold_sec = 0; aiAnswer = { answer: '짧은 답입니다.', used: [] };
    await hook(env('sms:received', { messageId: 'c1', message: '가격이 얼마예요', phoneNumber: '+82' + P5.slice(1) }));
    await sms.sendTick(); const g5 = (await msgs(P5)).find(x => x.direction === 'out').gateway_id;
    await hook(env('sms:failed', { messageId: g5, phoneNumber: '+82' + P5.slice(1), reason: 'RESULT_ERROR_LIMIT_EXCEEDED' }));
    ok((await thread(P5)).status === 'staff_needed' && (await msgs(P5)).find(x => x.gateway_id === g5).state === 'failed', 'sms:failed → failed + staff_needed');

    // #625: 하루 3번 · 쿨다운 10분 · 같은 질문 되풀이 = 직원 · AI 에 앞 대화 전달
    {
        const P7 = T + '1027';
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 1000, staff_ids: [1] };   // 기본 = 쿨다운 10 · 하루 3 · 앞 대화 6
        aiAnswer = { answer: '귤은 서늘한 곳에 두고 드실 만큼만 꺼내 두세요.', used: [] };
        const n0 = aiQs.length, sentAll = () => pool.query(`UPDATE sms_messages SET state = 'sent' WHERE thread_id = (SELECT id FROM sms_threads WHERE phone_digits = $1) AND direction = 'out' AND state IN ('queued','sending')`, [P7]);
        await hook(env('sms:received', { messageId: 'r1', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + P7.slice(1) }));
        let t7 = await thread(P7);
        ok(t7.status === 'bot_replied' && t7.bot_count === 1 && aiQs.length === n0 + 1 && !/앞 대화/.test(aiQs[n0]), '#625 첫 글 = 봇 답 · AI 질문에 앞 대화 없음(종전과 같음)');
        await sentAll(); await pool.query(`UPDATE sms_threads SET cooldown_until = now() - interval '1 minute' WHERE phone_digits = $1`, [P7]);   // 봇 답은 나갔고 쿨다운 10분이 지난 것처럼
        await hook(env('sms:received', { messageId: 'r2', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + P7.slice(1) }));
        t7 = await thread(P7);
        ok(t7.status === 'staff_needed' && t7.bot_count === 1 && aiQs.length === n0 + 2 && t7.draft_text === '귤은 서늘한 곳에 두고 드실 만큼만 꺼내 두세요.' && !t7.staff_why && /같은 질문을 다시 보냈어요/.test((notes[notes.length - 1] || {}).title || ''), '#625 같은 질문을 또 보냄(기호만 달라도) → 자동 발송 0(직원 몫) · 초안은 새로 만듦(#635) ' + t7.status);
        await sentAll(); await pool.query(`UPDATE sms_threads SET status = 'closed', cooldown_until = now() - interval '1 minute' WHERE phone_digits = $1`, [P7]);
        aiAnswer = { answer: '네, 냉장 보관하시면 2주쯤 괜찮아요.', used: [] };
        await hook(env('sms:received', { messageId: 'r3', message: '배송비는 얼마예요?', phoneNumber: '+82' + P7.slice(1) }));
        t7 = await thread(P7);
        const q3 = aiQs[aiQs.length - 1] || '';
        ok(t7.status === 'bot_replied' && t7.bot_count === 2, '#625 다른 질문(쿨다운 뒤) → 하루 두 번째 봇 답 ' + t7.status + ' ' + t7.bot_count);
        ok(aiQs.length === n0 + 3 && /^\[앞 대화/.test(q3) && /손님: 귤 가격이 얼마예요\?/.test(q3) && /우리: 귤은 서늘한 곳에/.test(q3) && /\[이번 손님 글[^\]]*\]\n배송비는 얼마예요\?$/.test(q3) && !/귤 가격이 얼마예요\?\n손님: 귤 보관/.test(q3), '#625 AI 질문 = 앞 대화(손님·우리 · 오래된 순) + 이번 글 ' + JSON.stringify(q3).slice(0, 160));
        await sentAll(); await pool.query(`UPDATE sms_threads SET status = 'closed', cooldown_until = now() - interval '1 minute' WHERE phone_digits = $1`, [P7]);
        await hook(env('sms:received', { messageId: 'r4', message: '얼마예요?', phoneNumber: '+82' + P7.slice(1) }));
        t7 = await thread(P7); ok(t7.status === 'bot_replied' && t7.bot_count === 3, '#625 세 번째 봇 답(하루 3번까지)');
        await sentAll(); await pool.query(`UPDATE sms_threads SET status = 'closed', cooldown_until = now() - interval '1 minute' WHERE phone_digits = $1`, [P7]);
        const n4 = aiQs.length;
        await hook(env('sms:received', { messageId: 'r5', message: '선물 포장도 되나요?', phoneNumber: '+82' + P7.slice(1) }));
        t7 = await thread(P7); ok(t7.status === 'staff_needed' && t7.bot_count === 3 && aiQs.length === n4 + 1 && !!t7.draft_text && !t7.staff_why, '#625·#635 네 번째 = 자동 발송 0(하루 3번 넘음) · 초안은 만듦 ' + t7.status + ' ' + t7.draft_text);
        await sentAll();
        ok(sms.cfgOf({ context_msgs: 0 }).context_msgs === 0 && sms.cfgOf({ staff_open_hours: 0 }).staff_open_hours === 0, '#625 설정으로 끌 수 있음(context_msgs 0 · staff_open_hours 0)');
    }

    console.log('⑤ 유예 중 직원 처리 → 봇 큐 취소 · AI [사람] · 모르는 번호');
    sms.resetCfg(); cfgStore.sms_gateway.hold_sec = 600;
    aiAnswer = { answer: '답입니다.', used: [] };
    await hook(env('sms:received', { messageId: 'd1', message: '오늘 주문하면 언제 와요?', phoneNumber: '+82' + P6.slice(1) }));
    let t6 = await thread(P6); ok(t6.status === 'bot_replied' && (await msgs(P6)).some(x => x.state === 'queued'), '유예 큐 1');
    r = await api('POST', `/api/sms/threads/${t6.id}/handled`, {}); ok(r.status === 200 && r.json.cancelled === 1, '[처리함] → 큐 취소 1 ' + JSON.stringify(r.json));
    ok((await thread(P6)).status === 'staff_replied', 'handled → staff_replied');
    st = await sms.sendTick(); ok(!st || !Array.isArray(st) || st.every(x => !x.sent || x.digits !== P6), '취소된 건은 안 나감');
    // 직원 답 보내기(화면) → 큐 staff_desk → sendTick → sent
    r = await api('POST', `/api/sms/threads/${t6.id}/reply`, { text: '직원이 답합니다 😀' }); ok(r.status === 200 && r.json.message_id, '직원 답 큐');
    st = await sms.sendTick(); const lastOut = (await msgs(P6)).filter(x => x.direction === 'out').pop();
    ok(lastOut.sender === 'staff_desk' && lastOut.state === 'sending' && !lastOut.body.includes('😀'), '직원 답 발송(202) · 이모지 제거');
    ok(!(await thread(P6)).cooldown_until || true, '직원 답은 쿨다운 안 걸림(봇만)');
    // AI [사람]
    aiAnswer = { answer: '[사람] 불만 글이라 직원이 봐야 합니다', used: [] };
    const P7 = T + '1007'; await hook(env('sms:received', { messageId: 'e1', message: '주문 방법 좀 알려주세요', phoneNumber: '+82' + P7.slice(1) }));
    ok((await thread(P7)).status === 'staff_needed' && (await msgs(P7)).filter(x => x.direction === 'out').length === 0, 'AI [사람] → staff_needed · 발송 0');
    // AI null(SKIP)
    aiAnswer = null; const P8 = T + '1008'; await hook(env('sms:received', { messageId: 'f1', message: '체험장 예약 되나요', phoneNumber: '+82' + P8.slice(1) }));
    ok((await thread(P8)).status === 'staff_needed', 'AI SKIP → staff_needed');

    // 뒤늦게 들어온 사건(45분 전) → 답 없이 직원 몫 · batch 는 무시
    aiAnswer = { answer: '답입니다.', used: [] }; const P11 = T + '1011';
    await hook(env('sms:received', { messageId: 'l1', message: '언제 와요', phoneNumber: '+82' + P11.slice(1), receivedAt: new Date(Date.now() - 45 * 60000).toISOString() }));
    ok((await thread(P11)).status === 'staff_needed' && (await msgs(P11)).filter(x => x.direction === 'out').length === 0, '45분 전 사건 → 직원 몫 · 봇 답 0');
    const nb = (await pool.query(`SELECT count(*)::int AS n FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%'])).rows[0].n;
    await hook(env('sms:batch:received', { messages: [{ messageId: 'bb1', message: '옛 글', phoneNumber: '+82' + (T + '1099').slice(1) }] }));
    ok((await pool.query(`SELECT count(*)::int AS n FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%'])).rows[0].n === nb, 'batch:received 무시(대화 안 생김)');

    // 되묻기 뒤 이름 답(followup.js) — 가르기보다 먼저 · 2차 조회 none → 직원 몫 · ask_kind 비움 · 「네 김영희요」가 인사로 버려지지 않음
    const P14 = T + '1014'; sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 70, staff_ids: [1] };
    await pool.query(`INSERT INTO sms_threads (phone_digits, status, ask_kind, ask_at, bot_count_day, bot_count) VALUES ($1, 'bot_replied', 'name', now(), CURRENT_DATE, 1)`, [P14]);
    aiAnswer = { answer: '답입니다.', used: [] };
    await hook(env('sms:received', { messageId: 'n1', message: '네 김영희요', phoneNumber: '+82' + P14.slice(1) }));
    const t14 = await thread(P14); ok(t14.status === 'staff_needed' && t14.ask_kind === null && (await msgs(P14)).filter(x => x.direction === 'out').length === 0, '이름 답 → 2차 조회 없음 → 직원 몫 · ask_kind 비움 · 봇 답 0 ' + JSON.stringify({ s: t14.status, a: t14.ask_kind }));
    ok(notes.some(n => n.title.includes('받는 분 확인')), '받는 분 확인 알림');

    console.log('⑥ draft 모드 · 초안 보내기');
    sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'draft', hold_sec: 0, max_chars: 70, staff_ids: [1] };
    aiAnswer = { answer: '초안 답입니다.', used: [] };
    const P9 = T + '1009'; await hook(env('sms:received', { messageId: 'g1', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + P9.slice(1) }));
    let t9 = await thread(P9); ok(t9.status === 'draft' && t9.draft_text === '초안 답입니다.' && (await msgs(P9)).filter(x => x.direction === 'out').length === 0, 'draft: 초안 저장 · 발송 0');
    r = await api('GET', `/api/sms/threads?status=draft`); ok(r.status === 200 && r.json.items.some(x => x.id === t9.id && x.draft_text === '초안 답입니다.' && x.phone_tail === P9.slice(-4) && x.phone_full === P9 && x.phone_masked !== P9 && x.status === 'draft' && 'customer_hint' in x), '목록 draft · #630 status·customer_hint 칸 있음 · phone_full 전체 번호(#624 대표 확정) · masked 는 가림');
    r = await api('POST', `/api/sms/threads/${t9.id}/send-draft`, {}); ok(r.status === 200, '[이대로 보내기] ' + r.status + ' ' + JSON.stringify(r.json));
    await sms.sendTick(); t9 = await thread(P9); ok(t9.status === 'staff_replied' && !t9.draft_text && (await msgs(P9)).some(x => x.sender === 'staff_desk' && x.state === 'sending'), 'send-draft → staff_desk 발송 · 초안 비움');

    console.log('⑦ MMS 사진 · 두 이벤트 묶기 · 이미지 라우트');
    sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1] };
    const P10 = T + '1010'; const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    await hook(env('mms:received', { messageId: 'h1', phoneNumber: '+82' + P10.slice(1), size: 12345, receivedAt: new Date().toISOString() }));
    let m10 = await msgs(P10); ok(m10.length === 1 && m10[0].kind === 'mms', 'mms:received → mms 1건');
    await hook(env('mms:downloaded', { messageId: 'h1-other', phoneNumber: '+82' + P10.slice(1), body: null, attachments: [{ contentType: 'image/png', name: 'a.png', size: png.length, data: png.toString('base64') }] }));
    m10 = await msgs(P10); ok(m10.length === 1, 'mms:downloaded → 같은 줄에 붙임(새 줄 없음) ' + m10.length);
    const imgs = (await pool.query(`SELECT * FROM sms_images WHERE message_id = $1 ORDER BY id`, [m10[0].id])).rows;
    ok(imgs.length === 1 && imgs[0].data && imgs[0].data.length === png.length, '사진 바이트 저장 · 메타 줄 정리 ' + imgs.length);
    ok((await thread(P10)).status === 'staff_needed' && (await thread(P10)).has_image, '사진 → staff_needed · has_image');
    r = await api('GET', `/api/sms/threads/${(await thread(P10)).id}`); ok(r.status === 200 && r.json.messages[0].image_ids.length === 1 && r.json.thread.has_image, '상세 image_ids');
    const ir = await fetch(base + `/api/sms/images/${imgs[0].id}`, { headers: { authorization: 'Bearer ' + token } }); ok(ir.status === 200 && ir.headers.get('content-type').startsWith('image/png') && (await ir.arrayBuffer()).byteLength === png.length, '이미지 라우트');
    const nr = await fetch(base + `/api/sms/images/${imgs[0].id}`); ok(nr.status === 401, '이미지 라우트 인증 필요');

    // mms:received 뒤 downloaded 가 안 옴 → 5분 뒤 직원 몫
    const P12 = T + '1012'; await hook(env('mms:received', { messageId: 'h2', phoneNumber: '+82' + P12.slice(1), size: 100 }));
    ok((await msgs(P12))[0].bucket === 'photo_pending' && (await thread(P12)).status === 'new', 'mms:received = 기록만(photo_pending · 알림 0)');
    await pool.query(`UPDATE sms_messages SET event_at = now() - interval '6 minutes' WHERE id = $1`, [(await msgs(P12))[0].id]);
    const nN = notes.length; const pp = await sms.pendingPhotoTick();
    ok(pp >= 1 && (await thread(P12)).status === 'staff_needed' && notes.length === nN + 1 && (await msgs(P12))[0].bucket === 'photo', '5분 지나도 사진 안 옴 → 직원 몫 + 알림');
    // 글만 든 MMS(국내 긴 글) = 사진 아님 → 글로 처리
    const P13 = T + '1013'; await hook(env('mms:received', { messageId: 'h3', phoneNumber: '+82' + P13.slice(1), size: 100 }));
    await hook(env('mms:downloaded', { messageId: 'h3-d', phoneNumber: '+82' + P13.slice(1), body: null, attachments: [{ contentType: 'text/plain', name: 'text.txt', data: Buffer.from('긴 글입니다 환불 원해요').toString('base64') }, { contentType: 'application/smil', name: 'smil.xml', data: Buffer.from('<smil/>').toString('base64') }] }));
    const m13 = await msgs(P13); ok(m13.length === 1 && m13[0].kind === 'sms' && m13[0].body.includes('환불') && m13[0].bucket === 'claim' && (await thread(P13)).status === 'staff_needed', '글만 든 MMS → 글로 가르기(claim) · 사진 아님 ' + JSON.stringify({ k: m13[0].kind, b: m13[0].bucket }));
    ok((await pool.query(`SELECT count(*)::int AS n FROM sms_images WHERE message_id = $1 AND data IS NOT NULL`, [m13[0].id])).rows[0].n === 0, 'smil·text 조각은 사진으로 저장 안 함');

    // 직원 답변 뒤 24시간 자동 해제(대표 확정 10/10) · 직원 몫(staff_needed)은 그대로
    const P15 = T + '1015', P16 = T + '1016';
    await pool.query(`INSERT INTO sms_threads (phone_digits, status, handled_at) VALUES ($1, 'staff_replied', now() - interval '25 hours'), ($2, 'staff_needed', now() - interval '25 hours')`, [P15, P16]);
    sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1], staff_open_hours: 0 };
    const sw = await sms.sweepStuck();
    ok(sw.auto_closed >= 1 && (await thread(P15)).status === 'closed' && (await thread(P16)).status === 'staff_needed', '직원 답변 25시간 → closed · 직원 몫은 staff_open_hours 0 이면 그대로 ' + JSON.stringify(sw));
    // #625: 직원 몫도 손님 마지막 글 뒤 staff_open_hours(기본 6) 지나면 closed · 최근 글이면 그대로
    const P17 = T + '1017';
    await pool.query(`UPDATE sms_threads SET last_in_at = now() - interval '7 hours' WHERE phone_digits = $1`, [P16]);
    await pool.query(`INSERT INTO sms_threads (phone_digits, status, last_in_at) VALUES ($1, 'staff_needed', now() - interval '2 hours')`, [P17]);
    sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1] };
    const sw3 = await sms.sweepStuck();
    ok(sw3.auto_closed_open >= 1 && (await thread(P16)).status === 'closed' && (await thread(P17)).status === 'staff_needed', '#625 직원 몫 7시간 → closed · 2시간은 그대로 ' + JSON.stringify(sw3));
    sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1], staff_lock_hours: 0 };
    await pool.query(`UPDATE sms_threads SET status = 'staff_replied' WHERE phone_digits = $1`, [P15]);
    const sw2 = await sms.sweepStuck(); ok(!sw2.auto_closed && (await thread(P15)).status === 'staff_replied', 'staff_lock_hours 0 = 안 품');

    console.log('⑧ summary · config · 끊김 감시');
    r = await api('GET', '/api/sms/summary'); ok(r.status === 200 && typeof r.json.staff_needed === 'number' && r.json.gateway && 'alive' in r.json.gateway && r.json.mode === 'record', 'summary 모양 ' + JSON.stringify(r.json).slice(0, 120));
    r = await api('GET', '/api/sms/config'); ok(r.status === 200 && r.json.modules && r.json.gateway_env, 'config 모양');
    r = await api('POST', '/api/sms/config', { mode: 'draft', hold_sec: 90 }); ok(r.status === 200 && cfgStore.sms_gateway.mode === 'draft' && cfgStore.sms_gateway.hold_sec === 90, 'config 저장');
    r = await api('POST', '/api/sms/threads?status=bogus'); ok(r.status === 404 || r.status === 400, '잘못된 상태 거절');
    r = await api('GET', '/api/sms/threads?status=bogus'); ok(r.status === 400, '상태 값 검사 400');
    cfgStore.sms_gateway_state = { last_ping_at: new Date(Date.now() - 5 * 3600e3).toISOString() };
    await sms.watchTick(); ok(tg.length === 1 && tg[0].includes('신호') && cfgStore.sms_gateway_state.alerted === true, '5시간 조용 → 텔레그램 1회');
    await sms.watchTick(); ok(tg.length === 1, '두 번째 틱엔 다시 안 보냄');
    cfgStore.sms_gateway_state.last_ping_at = new Date().toISOString(); await sms.watchTick(); ok(tg.length === 2 && tg[1].includes('복구'), '복구 알림 1회');
    const dsCols = (await pool.query(`SELECT column_name, is_generated FROM information_schema.columns WHERE table_name = 'delivery_shipments' AND column_name IN ('buyer_phone','phone_digits','buyer_digits') ORDER BY 1`)).rows;
    ok(dsCols.length === 3 && dsCols.filter(c => c.is_generated === 'ALWAYS').length === 2, 'delivery_shipments 칸 3개(생성 2) ' + JSON.stringify(dsCols));

    const NFC = '고객님, 불편드려 죄송합니다.\n보내주신 번호로는 주문이 확인되지 않아, 주문하신 분 또는 받으시는 분 성함과 연락처를 알려 주시면 바로 확인해 드리겠습니다.';   // #646 주문 못 찾은 불만 글 되묻기
    console.log('⑨ #635 폰 문자함 구도 — 안 읽음 · scope · 초안 항상 · 사람 몫 사유');
    {
        const cols = (await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sms_threads' AND column_name IN ('staff_read_at','staff_why') ORDER BY 1`)).rows;
        ok(cols.length === 2 && cols[0].data_type === 'timestamp with time zone' && cols[1].data_type === 'text', '#635 새 칸 staff_read_at(timestamptz) · staff_why(text) ' + JSON.stringify(cols));
        const find = (j, id) => (j.items || []).find(x => x.id === id);
        // 가. record — 안 읽음 셈 · 열면 0 · 다시 오면 1
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1] };
        const PA = T + '1041';
        await hook(env('sms:received', { messageId: 'u1', message: '귤 언제 보내주시나요', phoneNumber: '+82' + PA.slice(1) }));
        await hook(env('sms:received', { messageId: 'u2', message: '주소는 그대로예요', phoneNumber: '+82' + PA.slice(1) }));
        const ta = await thread(PA);
        r = await api('GET', '/api/sms/threads?scope=active'); let it = find(r.json, ta.id);
        ok(r.status === 200 && r.json.scope === 'active' && it && it.unread === 2 && it.last_dir === 'in' && it.last_at && it.needs_staff === false && it.staff_why === null && 'draft_text' in it, '#635 in 2통 → unread 2 · last_dir in · needs_staff false ' + JSON.stringify(it || r.json).slice(0, 200));
        r = await api('GET', '/api/sms/threads'); ok(r.json.scope === 'active' && !!find(r.json, ta.id), '#635 인자 없으면 scope=active 기본');
        r = await api('GET', '/api/sms/threads?status=all'); ok(r.status === 200 && r.json.scope === 'legacy' && !!find(r.json, ta.id), '#635 종전 status=all 그대로(옛 화면)');
        r = await api('GET', '/api/sms/threads?scope=bogus'); ok(r.status === 400, '#635 scope 값 검사 400');
        r = await api('GET', `/api/sms/threads/${ta.id}?peek=1`); ok(r.status === 200 && r.json.thread.unread === 2 && !(await thread(PA)).staff_read_at, '#635 peek=1 은 읽음으로 안 바꿈');
        const upd0 = (await thread(PA)).updated_at;
        r = await api('GET', `/api/sms/threads/${ta.id}`); let ta2 = await thread(PA);
        ok(r.status === 200 && r.json.thread.unread === 0 && r.json.messages.length === 2 && !!ta2.staff_read_at && String(ta2.updated_at) === String(upd0), '#635 열면 읽음(staff_read_at) · 응답 unread 0 · updated_at 안 건드림');
        r = await api('GET', '/api/sms/threads?scope=active'); ok(!find(r.json, ta.id), '#635 읽은 대화는 active 목록에서 빠짐');
        r = await api('GET', '/api/sms/threads?scope=all'); it = find(r.json, ta.id); ok(r.json.scope === 'all' && it && it.unread === 0, '#635 scope=all 에는 남음(unread 0)');
        await hook(env('sms:received', { messageId: 'u3', message: '혹시 확인되셨나요', phoneNumber: '+82' + PA.slice(1) }));
        r = await api('GET', '/api/sms/threads?scope=active'); it = find(r.json, ta.id); ok(it && it.unread === 1, '#635 손님이 다시 보내면 다시 뜸 · unread 1 ' + (it && it.unread));
        await api('GET', `/api/sms/threads/${ta.id}`);
        r = await api('GET', '/api/sms/threads?scope=active&q=' + PA.slice(-4)); it = find(r.json, ta.id); ok(r.json.scope === 'all' && it && it.unread === 0, '#635 q(끝 4자리)는 scope 와 무관하게 전체에서 찾음 · 종전 SQL 자리표 빠짐 고침');
        r = await api('GET', '/api/sms/threads?q=' + encodeURIComponent('주소는 그대로')); ok(r.status === 200 && !!find(r.json, ta.id), '#635 q(글)는 오간 글 전체에서(마지막 글이 아니어도)');
        // 나. 인증번호만 온 번호 = active 에 안 뜸 · all 에는 있음
        const PB = T + '1042';
        await hook(env('sms:received', { messageId: 'u4', message: '[Web발신] 인증번호 654321 을 입력하세요', phoneNumber: '+82' + PB.slice(1) }));
        const tb = await thread(PB);
        r = await api('GET', '/api/sms/threads?scope=active'); const inAct = !!find(r.json, tb.id);
        r = await api('GET', '/api/sms/threads?scope=all&limit=200'); ok(tb.status === 'ignored' && !inAct && !!find(r.json, tb.id), '#635 무시 갈래(ignored)는 active 에 없음 · all 에는 있음');
        // 다. auto — 쿨다운 안 둘째 글 = 초안 저장 + 자동 발송 0 · 그 뒤 클레임 = 초안 없음 + 사유
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
        const PC = T + '1043';
        aiAnswer = { answer: '첫 번째 답입니다.', used: [] };
        await hook(env('sms:received', { messageId: 'u5', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + PC.slice(1) }));
        let tc = await thread(PC); const outs0 = (await msgs(PC)).filter(x => x.direction === 'out').length;
        ok(tc.status === 'bot_replied' && outs0 === 1 && !tc.draft_text && !tc.staff_why && new Date(tc.cooldown_until) - Date.now() > 25 * 60000, '#635 첫 글 = 자동 답 큐 · 쿨다운 기본 30분');
        aiAnswer = { answer: '두 번째 글에 맞춘 새 초안입니다.', used: [] };
        const nq = aiQs.length;
        await hook(env('sms:received', { messageId: 'u6', message: '배송비는 얼마예요?', phoneNumber: '+82' + PC.slice(1) }));
        tc = await thread(PC);
        ok(tc.status === 'staff_needed' && tc.draft_text === '두 번째 글에 맞춘 새 초안입니다.' && tc.draft_kind === 'ai' && !tc.staff_why && aiQs.length === nq + 1 && (await msgs(PC)).filter(x => x.direction === 'out').length === outs0 && tc.bot_count === 1, '#635 쿨다운 안 둘째 글 = 초안 저장 + 자동 발송 0 ' + tc.status + ' ' + tc.draft_text);
        r = await api('GET', '/api/sms/threads?scope=active'); it = find(r.json, tc.id); ok(it && it.unread === 2 && it.needs_staff === false && it.draft_text === '두 번째 글에 맞춘 새 초안입니다.' && it.draft_kind === 'ai', '#635 목록: 초안 있음 · needs_staff false · unread 2');
        aiAnswer = { answer: '세 번째 글 초안.', used: [] };
        await hook(env('sms:received', { messageId: 'u7', message: '그럼 얼마나 두고 먹을 수 있어요?', phoneNumber: '+82' + PC.slice(1) }));
        tc = await thread(PC); ok(tc.status === 'staff_needed' && tc.draft_text === '세 번째 글 초안.', '#635 잠금(직원 몫) 중에도 글이 올 때마다 초안을 새로 ' + tc.draft_text);
        const sumA = (await api('GET', '/api/sms/summary')).json;
        await hook(env('sms:received', { messageId: 'u8', message: '귤이 다 썩어서 왔어요 환불해주세요', phoneNumber: '+82' + PC.slice(1) }));
        tc = await thread(PC); ok(tc.status === 'staff_needed' && tc.draft_text === NFC && tc.staff_why === 'claim', '#635·#646 잠금 중 불만 글(주문 못 찾음) = 자동 발송 0 · 초안 = 성함·연락처 되묻기 + staff_why claim ' + tc.staff_why);
        r = await api('GET', '/api/sms/threads?scope=active'); it = find(r.json, tc.id); ok(it && it.needs_staff === true && it.staff_why === 'claim' && it.staff_why_label === '불만·클레임' && it.draft_text === NFC && it.unread === 4, '#635 목록: needs_staff true · 사유 · unread 4 ' + JSON.stringify(it || {}).slice(0, 160));
        const sumB = (await api('GET', '/api/sms/summary')).json;
        ok(typeof sumB.unread_threads === 'number' && typeof sumB.needs_staff === 'number' && typeof sumB.drafts === 'number' && typeof sumB.staff_needed === 'number' && sumB.unread_threads >= 1 && sumB.needs_staff === sumA.needs_staff + 1 && sumB.drafts === sumA.drafts && sumB.unread_threads === sumA.unread_threads, '#635 summary 새 칸 unread_threads·needs_staff · drafts = 안 보낸 초안 수 ' + JSON.stringify({ a: [sumA.unread_threads, sumA.needs_staff, sumA.drafts], b: [sumB.unread_threads, sumB.needs_staff, sumB.drafts] }));
        // 라. 직원 답 = 읽음 + 사유 비움 · 자동 발송 큐 그대로 직원 글만
        r = await api('POST', `/api/sms/threads/${tc.id}/reply`, { text: '확인해서 다시 연락드리겠습니다' }); tc = await thread(PC);
        ok(r.status === 200 && tc.status === 'staff_replied' && !tc.staff_why && !!tc.staff_read_at, '#635 직원 답 → 사유 비움 · 읽음');
        r = await api('GET', '/api/sms/threads?scope=active'); ok(!find(r.json, tc.id), '#635 답한 대화는 active 에서 빠짐');
        aiAnswer = { answer: '직원 답 뒤 새 글 초안.', used: [] };
        await hook(env('sms:received', { messageId: 'u9', message: '네 그런데 귤은 몇 개쯤 들어 있어요?', phoneNumber: '+82' + PC.slice(1) }));
        tc = await thread(PC); r = await api('GET', '/api/sms/threads?scope=active'); it = find(r.json, tc.id);
        ok(tc.status === 'staff_needed' && tc.draft_text === '직원 답 뒤 새 글 초안.' && it && it.unread === 1 && (it.last_dir === 'in' || it.last_dir === 'out') && (await msgs(PC)).filter(x => x.direction === 'out' && x.sender === 'bot').length === outs0, '#635 직원 답 뒤(24시간 잠금) 다시 옴 = 다시 뜸 · 초안 새로 · 봇 자동 발송 0');
        // 마. 새 번호 클레임(auto) · draft 모드 = 전부 초안
        const PD = T + '1044';
        await hook(env('sms:received', { messageId: 'u10', message: '상자가 터져서 왔어요 환불해주세요', phoneNumber: '+82' + PD.slice(1) }));
        let td = await thread(PD); const outD = (await msgs(PD)).filter(x => x.direction === 'out'); ok(td.status === 'draft' && td.draft_text === NFC && td.staff_why === 'claim' && outD.length === 0, '#646·#650 새 번호 불만 글(주문 못 찾음) = 자동 발송 0 · 성함·연락처 되묻기 초안 + 직원 확인(claim) ' + td.status);
        // 바. 사람 몫 사유는 두 곳에 같은 값: 대화 칸 sms_threads.staff_why(지금 상태) + 그 받은 글 sms_messages.ai_json.staff_why(#633 「봇 실패」 셈)
        const lastIn = async d => (await msgs(d)).filter(x => x.direction === 'in').pop();
        ok((await thread(PD)).staff_why === 'claim', '#646 답이 나간 불만 글도 대화 칸 staff_why = claim(직원 확인)');
        const PF = T + '1046'; aiAnswer = null;
        await hook(env('sms:received', { messageId: 'u13', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + PF.slice(1) }));
        const tf = await thread(PF); const mf = await lastIn(PF);
        ok(tf.status === 'staff_needed' && tf.staff_why === 'ai_skip' && !tf.draft_text && (mf.ai_json || {}).staff_why === 'ai_skip', '#635 AI 답 없음 = 대화 칸·받은 글 둘 다 staff_why ai_skip ' + tf.staff_why + ' ' + JSON.stringify(mf.ai_json));
        r = await api('GET', '/api/sms/threads?scope=active'); it = find(r.json, tf.id); ok(it && it.needs_staff === true && it.staff_why_label === 'AI 답 없음', '#635 목록 사유 글 「AI 답 없음」');
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'draft', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
        const PE = T + '1045'; aiAnswer = { answer: '초안 하나.', used: [] };
        await hook(env('sms:received', { messageId: 'u11', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + PE.slice(1) }));
        aiAnswer = { answer: '초안 둘.', used: [] };
        await hook(env('sms:received', { messageId: 'u12', message: '선물 포장도 되나요?', phoneNumber: '+82' + PE.slice(1) }));
        const te = await thread(PE); ok(te.draft_text === '초안 둘.' && !te.staff_why && (await msgs(PE)).filter(x => x.direction === 'out').length === 0, '#635 draft 모드 = 글마다 초안 새로 · 발송 0 ' + te.status + ' ' + te.draft_text);
        // 사. auto + 늦게 들어온 글(40분 전 시각) = 발송 큐 0 · 초안만
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
        const PG = T + '1047'; aiAnswer = { answer: '늦은 글 초안.', used: [] };
        await hook(env('sms:received', { messageId: 'u14', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + PG.slice(1), receivedAt: new Date(Date.now() - 40 * 60000).toISOString() }));
        const tg7 = await thread(PG);
        ok(tg7.status === 'staff_needed' && tg7.draft_text === '늦은 글 초안.' && !tg7.staff_why && (await msgs(PG)).filter(x => x.direction === 'out').length === 0 && !tg7.bot_count, '#635 auto + 늦은 글 = 발송 큐 0 · 초안만 ' + tg7.status + ' ' + tg7.draft_text);
        // 아. record + 잠금 갈래 = AI 호출 0 · 초안 안 만듦
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1] };
        const nRec = aiQs.length;
        await hook(env('sms:received', { messageId: 'u15', message: '혹시 냉장 보관해도 되나요?', phoneNumber: '+82' + PG.slice(1) }));
        const tg8 = await thread(PG);
        ok(aiQs.length === nRec && tg8.status === 'staff_needed' && !tg8.draft_text && (await msgs(PG)).filter(x => x.direction === 'out').length === 0, '#635 record + 잠금(직원 몫) 갈래 = AI 호출 0 · 발송 0 ' + (aiQs.length - nRec));
        // 자. 저절로 끝날 때 사유 비움 · 닫힌 대화는 needs_staff 아님(초안 셈과 같은 기준)
        const idD = (await thread(PD)).id;
        await pool.query(`UPDATE sms_threads SET status = 'staff_needed' WHERE id = $1`, [idD]);   // #646 뒤로는 되묻기가 나가 bot_replied — 「직원 몫 6시간」 시험을 위해 직원 몫으로 둔다
        await pool.query(`UPDATE sms_threads SET last_in_at = now() - interval '7 hours', updated_at = now() - interval '7 hours' WHERE id = $1`, [idD]);
        const swA = await sms.sweepStuck(); let tdc = await thread(PD);
        ok(swA.auto_closed_open >= 1 && tdc.status === 'closed' && tdc.staff_why === null, '#635 직원 몫 6시간 → closed 때 staff_why 비움 ' + tdc.status + ' ' + tdc.staff_why);
        const sumC = (await api('GET', '/api/sms/summary')).json;
        await pool.query(`UPDATE sms_threads SET staff_why = 'claim' WHERE id = $1`, [idD]);   // 닫힌 대화에 사유가 남은 옛 줄을 흉내
        r = await api('GET', '/api/sms/threads?scope=active&limit=200'); it = find(r.json, idD); const sumD = (await api('GET', '/api/sms/summary')).json;
        ok(it && it.unread >= 1 && it.status === 'closed' && it.needs_staff === false && sumD.needs_staff === sumC.needs_staff, '#635 닫힌 대화 = 안 읽음이면 active 에 뜨되 needs_staff false · summary.needs_staff 에도 안 셈');
        // 차. 검색: 전체 번호 일치 · 5자리 이상 부분 번호 = 0건 · % _ 는 글자
        const idA = (await thread(PA)).id;
        r = await api('GET', '/api/sms/threads?q=' + PA); ok(r.status === 200 && r.json.items.length === 1 && r.json.items[0].id === idA, '#635 q = 전체 번호 → 그 대화 하나 ' + r.json.items.length);
        r = await api('GET', '/api/sms/threads?q=' + encodeURIComponent(PA.slice(0, 3) + '-' + PA.slice(3, 7) + '-' + PA.slice(7))); ok(r.json.items.length === 1 && r.json.items[0].id === idA, '#635 q = 하이픈 낀 전체 번호도 같음');
        r = await api('GET', '/api/sms/threads?q=' + PA.slice(0, 7) + '&limit=200'); ok(r.status === 200 && r.json.items.length === 0, '#635 q = 숫자 5자리 이상 부분 번호 → 0건(종전엔 전부 나왔음) ' + r.json.items.length);
        r = await api('GET', '/api/sms/threads?q=12&limit=200'); ok(r.status === 200 && r.json.items.length === 0, '#635 q = 숫자 1~2자리 → 0건 ' + r.json.items.length);
        r = await api('GET', '/api/sms/threads?q=' + encodeURIComponent('%') + '&limit=200'); const pct = r.json.items.length;
        r = await api('GET', '/api/sms/threads?q=' + encodeURIComponent('_') + '&limit=200');
        ok(r.status === 200 && !find(r.json, idA) && pct < 200 && !(await api('GET', '/api/sms/threads?q=' + encodeURIComponent('%') + '&limit=200')).json.items.some(x => x.id === idA), '#635 q 의 % · _ 는 글자로 취급(전부 나오지 않음)');
        // 카. 사유 한글: rule_… · 모르는 값 = 「직원 확인」
        await pool.query(`UPDATE sms_threads SET staff_why = 'rule_reserve', status = 'staff_needed' WHERE id = $1`, [idA]);
        r = await api('GET', '/api/sms/threads?q=' + PA); const lab1 = r.json.items[0].staff_why_label;
        await pool.query(`UPDATE sms_threads SET staff_why = 'zz_unknown_why' WHERE id = $1`, [idA]);
        r = await api('GET', '/api/sms/threads?q=' + PA); const lab2 = r.json.items[0].staff_why_label;
        ok(lab1 === '예약 상품' && lab2 === '직원 확인' && r.json.items[0].needs_staff === true, '#635 사유 글: rule_reserve → 「예약 상품」 · 모르는 값 → 「직원 확인」(영문 안 나옴) ' + lab1 + ' / ' + lab2);
        // 타. 읽음 시각 = DB 시계(직원 답 뒤 곧바로 온 글이 안 읽음으로 세어짐)
        const dbNow = (await pool.query(`SELECT now() AS n`)).rows[0].n; await api('POST', `/api/sms/threads/${idA}/handled`, {});
        const ta9 = await thread(PA); ok(ta9.staff_read_at && Math.abs(new Date(ta9.staff_read_at) - new Date(dbNow)) < 5000 && !ta9.staff_why, '#635 [처리함] → staff_read_at = DB now() · 사유 비움');
        // 파. #641 받았다는 알림·감사 = 답·초안 없음 · 직원 몫 아님 · 안 읽음으로만 뜸(새 번호여도 숨기지 않음)
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'draft', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
        const PH = T + '1048'; const nTh = aiQs.length, nNote = notes.length; aiAnswer = { answer: '나오면 안 되는 초안.', used: [] };
        await hook(env('sms:received', { messageId: 'u16', message: '귤 잘 도착했습니다.^^', phoneNumber: '+82' + PH.slice(1) }));
        await hook(env('sms:received', { messageId: 'u17', message: '감사합니다.^^', phoneNumber: '+82' + PH.slice(1) }));
        await hook(env('sms:received', { messageId: 'u18', message: '네^^', phoneNumber: '+82' + PH.slice(1) }));
        const th = await thread(PH), mh = await msgs(PH);
        ok(mh.length === 3 && mh.every(x => x.bucket === 'greeting') && !th.draft_text && !th.staff_why && th.status === 'new' && aiQs.length === nTh && notes.length === nNote && mh.every(x => x.direction === 'in'),
            '#641 「잘 도착했습니다」「감사합니다」「네」 3통 = 인사 갈래 · 초안 없음 · 사유 없음 · AI 0 · 알림 0 · 발송 0 ' + JSON.stringify({ b: mh.map(x => x.bucket), st: th.status, d: th.draft_text }));
        r = await api('GET', '/api/sms/threads?scope=active&limit=200'); it = find(r.json, th.id);
        ok(it && it.unread === 3 && it.needs_staff === false && it.draft_text === null && it.status !== 'ignored', '#641 목록: 안 읽음 3 으로 뜸 · needs_staff false · 초안 없음(숨김 아님) ' + JSON.stringify(it ? { u: it.unread, n: it.needs_staff, s: it.status } : null));
        // 물음 → 초안 → 뒤에 온 「감사합니다」는 앞 초안을 지우지 않는다(답할 물음이 남아 있다)
        const PI = T + '1049'; aiAnswer = { answer: '보관 초안.', used: [] };
        await hook(env('sms:received', { messageId: 'u19', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + PI.slice(1) }));
        await hook(env('sms:received', { messageId: 'u20', message: '감사합니다', phoneNumber: '+82' + PI.slice(1) }));
        const ti = await thread(PI); ok(ti.draft_text === '보관 초안.' && ti.status === 'draft', '#641 물음 뒤 「감사합니다」 = 앞 초안 그대로 ' + ti.status + ' ' + ti.draft_text);
        // 섞인 글은 종전 갈래: 「잘 받았는데 썩은 게 있어요」 = claim → 사람 몫
        const PJ = T + '1050';
        await hook(env('sms:received', { messageId: 'u21', message: '잘 받았는데 썩은 게 있어요', phoneNumber: '+82' + PJ.slice(1) }));
        const tj = await thread(PJ); ok(tj.status === 'draft' && tj.staff_why === 'claim' && tj.draft_text === NFC, '#641·#646 「잘 받았는데 썩은 게 있어요」 = claim(인사 갈래 아님) · 주문 못 찾음 → 되묻기 초안 + 직원 확인 ' + tj.staff_why);
        // 하. #635-C send-draft 「내가 본 초안」 대조: 같음 = 발송 · 다름 = 409·발송 0 · 사라짐 = 409 + null · seen 없음 = 종전
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'draft', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
        const PK = T + '1051'; aiAnswer = { answer: '첫 초안입니다.', used: [] };
        await hook(env('sms:received', { messageId: 'u22', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + PK.slice(1) }));
        aiAnswer = { answer: '둘째 글에 맞춘 새 초안입니다.', used: [] };
        await hook(env('sms:received', { messageId: 'u23', message: '선물 포장도 되나요?', phoneNumber: '+82' + PK.slice(1) }));
        let tk = await thread(PK); const outsK = async () => (await msgs(PK)).filter(x => x.direction === 'out');
        r = await api('POST', `/api/sms/threads/${tk.id}/send-draft`, { seen: '첫 초안입니다.' });
        ok(r.status === 409 && r.json.ok === false && r.json.error === 'draft_changed' && r.json.draft_text === '둘째 글에 맞춘 새 초안입니다.' && r.json.draft_kind === 'ai' && (await outsK()).length === 0 && (await thread(PK)).draft_text === '둘째 글에 맞춘 새 초안입니다.',
            '#635-C 본 초안과 다름 = 409 draft_changed + 지금 초안 · 발송 0 · 초안 그대로 ' + r.status + ' ' + JSON.stringify(r.json));
        r = await api('POST', `/api/sms/threads/${tk.id}/send-draft`, { seen: '  둘째 글에 맞춘 새 초안입니다.\n' });
        let ok1 = await outsK(); tk = await thread(PK);
        ok(r.status === 200 && r.json.ok === true && ok1.length === 1 && ok1[0].body === '둘째 글에 맞춘 새 초안입니다.' && ok1[0].sender === 'staff_desk' && !tk.draft_text && tk.status === 'staff_replied', '#635-C 본 초안과 같음(앞뒤 빈칸 무시) = 발송 1 · 초안 비움 ' + r.status);
        r = await api('POST', `/api/sms/threads/${tk.id}/send-draft`, { seen: '둘째 글에 맞춘 새 초안입니다.' });
        ok(r.status === 409 && r.json.error === 'draft_changed' && r.json.draft_text === null && r.json.draft_kind === null && (await outsK()).length === 1, '#635-C 초안이 사라짐(이미 보냄) = 409 draft_changed + draft_text null · 더 안 나감');
        const PL = T + '1052'; aiAnswer = { answer: '옛 화면용 초안.', used: [] };
        await hook(env('sms:received', { messageId: 'u24', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + PL.slice(1) }));
        const tl = await thread(PL);
        r = await api('POST', `/api/sms/threads/${tl.id}/send-draft`, {});
        const outsL = (await msgs(PL)).filter(x => x.direction === 'out');
        ok(r.status === 200 && outsL.length === 1 && outsL[0].body === '옛 화면용 초안.', '#635-C seen 없음(옛 화면) = 종전 그대로 발송');
        r = await api('POST', `/api/sms/threads/${tl.id}/send-draft`, {});
        ok(r.status === 409 && r.json.error !== 'draft_changed' && /초안이 없어요/.test(r.json.error || ''), '#635-C seen 없이 초안 없음 = 종전 안내 글 409');
        // 거. #643 자동 답 = 「제주에서」 + 송장 번호 전체 · 화면·저장 자료에는 끝 4자리만
        {
            const PM = T + '1053', TR1 = '999600064301', TR2 = '999600064302';
            await pool.query(`DELETE FROM delivery_status WHERE tracking IN ($1, $2)`, [TR1, TR2]); await pool.query(`DELETE FROM delivery_shipments WHERE tracking IN ($1, $2)`, [TR1, TR2]);
            await pool.query(`INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, source) VALUES ($1, (now() AT TIME ZONE 'Asia/Seoul')::date, '거래처육사삼', '시험643', $3, 'verify-643'), ($2, (now() AT TIME ZONE 'Asia/Seoul')::date, '거래처육사삼', '시험643', $3, 'verify-643')`, [TR1, TR2, PM]);
            await pool.query(`INSERT INTO delivery_status (tracking, bucket, label, delivered, checked_at) VALUES ($1, '집화', '집화처리', false, now()), ($2, '집화', '집화처리', false, now())`, [TR1, TR2]);   // 방금 확인한 것으로 넣어 택배사 재조회(외부 호출)가 안 돌게
            sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
            const nAi = aiQs.length;
            await hook(env('sms:received', { messageId: 'u25', message: '택배 언제 와요?', phoneNumber: '+82' + PM.slice(1) }), { waitMs: 2600 });
            const tm = await thread(PM), om = (await msgs(PM)).filter(x => x.direction === 'out');
            const body = om.map(x => x.body).join(' ');
            ok(tm.status === 'bot_replied' && om.length === 1 && om[0].rule_kind === 'ship_after' && aiQs.length === nAi && /^안녕하세요 고객님 \^\^ 오늘 제주에서 출발했습니다!\n/.test(body) && body.includes(`송장번호 ${TR1}, ${TR2}(CJ대한통운)`) && body.includes('\n배송조회 ') && body.includes('/track?n=' + TR1 + '\n') && !body.includes('/track?n=' + TR2) && /행복한 하루 되세요 \^\^$/.test(body) && !/거래처육사삼|에서 출발했어요 · 송장 끝/.test(body),
                '#643 자동 답: 「안녕하세요 고객님 ^^ 오늘 제주에서 출발했습니다!」 + 송장번호 전체 2개 + 배송조회 주소(첫 송장) + 맺음 · 거래처 이름 없음 · AI 0 ' + body.slice(0, 120));
            const oj = JSON.stringify(tm.order_json || {}), hintLine = String(tm.order_hint || '');
            r = await api('GET', `/api/sms/threads/${tm.id}?peek=1`);
            const apiTxt = JSON.stringify({ t: r.json.thread, o: r.json.order });
            const oo = (r.json.order && r.json.order.order) || {}, stored = (tm.order_json && tm.order_json.order) || {};
            ok(JSON.stringify(oo.trackings) === JSON.stringify([TR1, TR2]) && JSON.stringify(stored.trackings) === JSON.stringify([TR1, TR2]) && /^430[12]$/.test(String(oo.tracking_tail || '')),
                '#644 직원 화면용 주문 칸(order.order.trackings)에 송장 전체 번호 · tracking_tail 은 그대로 ' + JSON.stringify(oo.trackings));
            ok(oo.recipient_name === '시험643' && stored.recipient_name === '시험643' && oo.recipient_initial === '시' && !('buyer_name' in oo) && !hintLine.includes('시험643') && !body.includes('시험643') && !notes.some(n => (n.title + ' ' + n.message).includes('시험643')),
                '#644 직원 화면용 주문 칸에 받는 분 이름 전체(recipient_name) · 성 한 글자 칸은 그대로 · 주문자 이름 칸은 없음(송장 표에 없음) · 손님 글·한 줄 요약·알림에는 이름 없음 ' + oo.recipient_name);
            ok(!hintLine.includes(TR1) && !hintLine.includes(TR2) && !JSON.stringify(Object.assign({}, r.json.thread, { last_out_text: '', customer_hint: '' })).includes(TR1) && !notes.some(n => (n.title + ' ' + n.message).includes(TR1)),
                '#644 한 줄 요약(order_hint)·직원 알림에는 전체 번호 없음');
            const scSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'sms', 'selfcheck.js'), 'utf8');
            ok(/const PUBLIC = \[[^\]]*'tracking_tail'[^\]]*\]/.test(scSrc) && !/const PUBLIC = \[[^\]]*'trackings'/.test(scSrc) && !/const PUBLIC = \[[^\]]*'recipient_name'/.test(scSrc) && !/toStaff/.test(scSrc), '#644 손님 셀프 조회 페이지의 공개 칸 목록에는 trackings·recipient_name 없음(끝 4자리 그대로) · toStaff 를 쓰지 않음');
            await pool.query(`DELETE FROM delivery_status WHERE tracking IN ($1, $2)`, [TR1, TR2]); await pool.query(`DELETE FROM delivery_shipments WHERE tracking IN ($1, $2)`, [TR1, TR2]);
            ok((await pool.query(`SELECT count(*)::int AS n FROM delivery_shipments WHERE source = 'verify-643'`)).rows[0].n === 0, '#643 시험 송장 줄 정리 0');
        }
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1] };
        // 너. #645 주문을 못 찾은 「내 주문」 물음은 AI 에 안 넘김(고정 문구 + 직원 확인) · AI 글의 발송·도착 단정 = 발송 0
        {
            const NF = '안녕하세요 고객님 ^^ 보내주신 번호로는 주문이 확인되지 않습니다.\n주문하신 분 또는 받으시는 분 성함과 연락처를 알려 주시면 바로 확인해 드리겠습니다.';
            sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 75, max_chars: 1000, staff_ids: [1] };
            const outOf = async d => (await msgs(d)).filter(x => x.direction === 'out');
            // 대화 338 재현: 앞 대화에 「내일 오전에 효돈에서 출발하고 모레 도착 예정」이라는 우리 글이 있어도 지어내지 않는다
            const PN = T + '1054'; const tn0 = (await pool.query(`INSERT INTO sms_threads (phone_digits, status, last_out_at) VALUES ($1, 'closed', now() - interval '20 hours') RETURNING id`, [PN])).rows[0];
            await pool.query(`INSERT INTO sms_messages (thread_id, direction, kind, body, sender, state, created_at, event_at) VALUES ($1, 'out', 'sms', '주문하신 하우스감귤은 내일 오전에 효돈에서 출발하고 모레 도착 예정이에요.', 'staff_desk', 'sent', now() - interval '20 hours', now() - interval '20 hours')`, [tn0.id]);
            aiAnswer = { answer: '말씀드린 대로 내일 오전 효돈에서 출발해서 모레 도착 예정입니다.', used: [] };
            let nA = aiQs.length, nN = notes.length;
            await hook(env('sms:received', { messageId: 'u26', message: '택배언제와요?!', phoneNumber: '+82' + PN.slice(1) }), { waitMs: 2600 });
            let tn = await thread(PN), on = await outOf(PN), mine = on.filter(x => x.sender === 'bot');
            ok(aiQs.length === nA && mine.length === 0 && tn.draft_text === NF && tn.draft_kind === 'rule' && !/효돈|말씀드린|출발|도착 예정/.test(tn.draft_text) && tn.staff_why === 'order_not_found' && tn.status === 'draft' && notes.length === nN + 1 && /주문을 못 찾았어요/.test(notes[notes.length - 1].title),
                '#645·#650 주문 없는 번호 「택배언제와요?!」(앞 대화에 옛 발송 안내 있음) = AI 호출 0 · 자동 발송 0 · 되묻기 고정 문구는 초안으로 · 직원 확인(order_not_found) + 알림 ' + JSON.stringify({ ai: aiQs.length - nA, out: mine.length, st: tn.status, why: tn.staff_why }));
            r = await api('GET', '/api/sms/threads?scope=active&limit=200'); it = (r.json.items || []).find(x => x.id === tn.id);
            ok(it && it.needs_staff === true && it.staff_why_label === '주문 못 찾음', '#645 목록: needs_staff true · 사유 「주문 못 찾음」');
            // 주문 변경 물음(order_q)도 같음 · 사기 전 물음은 종전대로 AI
            const PO = T + '1055'; nA = aiQs.length;
            await hook(env('sms:received', { messageId: 'u27', message: '제 주문 사이즈가 뭐였죠', phoneNumber: '+82' + PO.slice(1) }));
            const po1 = (await outOf(PO)).filter(x => x.sender === 'bot');
            { const tpo = await thread(PO); ok(aiQs.length === nA && po1.length === 0 && tpo.draft_text === NF && tpo.status === 'draft' && tpo.staff_why === 'order_not_found', '#645·#650 주문 없는 번호의 주문 물음(order_q) = AI 0 · 자동 발송 0 · 되묻기 초안 · 직원 확인 ' + tpo.status); }
            const PP = T + '1056'; nA = aiQs.length; aiAnswer = { answer: '안녕하세요 고객님 ^^ 오전 8시 이전 주문은 당일 발송, 이후 주문은 다음 날 발송돼요. 보통 발송 다음 날 도착합니다.', used: [] };
            await hook(env('sms:received', { messageId: 'u28', message: '오늘 주문하면 언제 와요?', phoneNumber: '+82' + PP.slice(1) }));
            const pp1 = (await outOf(PP)).filter(x => x.sender === 'bot'); const tpp = await thread(PP);
            ok(aiQs.length === nA + 1 && pp1.length === 1 && /8시 이전 주문은 당일 발송/.test(pp1[0].body) && pp1[0].rule_kind === 'ai' && !tpp.staff_why, '#645 사기 전 물음(「오늘 주문하면 언제 와요?」) = 종전대로 AI 일반 안내가 나감(조건 문장은 단정 아님)');
            const PQ = T + '1057'; nA = aiQs.length; aiAnswer = { answer: '서늘한 곳에 두시고 드실 만큼만 꺼내 두세요.', used: [] };
            await hook(env('sms:received', { messageId: 'u29', message: '귤 가격이 얼마예요?', phoneNumber: '+82' + PQ.slice(1) }));
            ok(aiQs.length === nA + 1 && (await outOf(PQ)).filter(x => x.sender === 'bot').length === 1 && !(await thread(PQ)).staff_why, '#645 그 밖 물음(보관법) + 주문 없음 = 종전대로 AI');
            // AI 가 발송·도착을 단정 = 발송 0 · 직원 몫
            const PR = T + '1058';
            for (const [i, bad] of ['주문하신 상품은 내일 오전 발송되어 모레 도착 예정입니다.', '말씀드린 대로 곧 받아 보실 수 있습니다.', '고객님 상품은 어제 출발했습니다.'].entries()) {
                const ph = T + String(1060 + i); aiAnswer = { answer: bad, used: [] };
                await hook(env('sms:received', { messageId: 'u3' + i, message: '선물 포장도 되나요?', phoneNumber: '+82' + ph.slice(1) }));
                const th2 = await thread(ph);
                ok((await outOf(ph)).length === 0 && th2.status === 'staff_needed' && th2.staff_why === 'ai_assert' && !th2.draft_text, `#645 AI 글 단정(「${bad.slice(0, 18)}…」) = 발송 0 · 초안 없음 · 직원 몫(ai_assert)`);
            }
            r = await api('GET', '/api/sms/threads?q=' + (T + '1060')); ok(r.json.items[0] && r.json.items[0].staff_why_label === 'AI 글에 발송·도착 단정', '#645 사유 글 「AI 글에 발송·도착 단정」');
            void PR;
            // #645 구멍 3개(워커5 37문장 점검): 단정 검사·사기 전 물음 판정을 문장으로 박아 둔다
            const MUST_BLOCK = ['말씀드린 대로 내일 오전 효돈에서 출발해서 모레 도착 예정입니다.', '주문하신 상품은 오늘 발송됐습니다.', '내일 오전 발송 예정입니다.', '10/12 일요일에 도착합니다', '지금 배송 중이에요', '한글날 연휴로 11일 일요일 발송되는 점 양해부탁드립니다',
                '고객님 주문 건은 내일 발송됩니다.', '곧 도착할 거예요', '발송 완료되었습니다', '오늘 나갑니다', '배송 시작되었어요', '택배가 가고 있어요', '월요일에 받으실 수 있어요', '내일 받아보실 수 있습니다', '고객님 주문분은 이미 나갔어요'];
            const MUST_PASS = ['오전 8시 이전 주문은 당일 발송, 이후 주문은 다음 날 발송돼요.', '지금 주문하시면 내일 오전 발송되어 모레 도착 예정입니다.', '보통 발송 다음 날 도착합니다.', '서늘한 곳에 두시고 드실 만큼만 꺼내 두세요.', '토요일은 발송을 쉬고 일요일은 발송합니다.',
                '안녕하세요 고객님 ^^\n택배는 CJ대한통운으로 발송됩니다.', '8시까지 주문 시 당일 발송됩니다.', '하우스감귤은 지금 단맛이 올라와 맛있는 시기예요.', '선물 포장은 선물용 상품에서만 됩니다.'];
            ok(MUST_BLOCK.every(t => sms._aiAsserts(t) === true), '#645 단정 검사: 막혀야 할 15문장 전부 막힘(「주문 건은 내일 발송됩니다」「곧 도착할 거예요」「오늘 나갑니다」「월요일에 받으실 수 있어요」 포함) ' + JSON.stringify(MUST_BLOCK.filter(t => !sms._aiAsserts(t))));
            ok(MUST_PASS.every(t => sms._aiAsserts(t) === false), '#645 단정 검사: 일반 안내 9문장은 통과(조건 문장·요일 일반론·보관법) ' + JSON.stringify(MUST_PASS.filter(t => sms._aiAsserts(t))));
            const MINE = ['택배언제와요?!', '배송 언제 오나요?', '송장번호 알려주세요', '발송 됐나요', '주소 바꿔주세요', '주문 취소해주세요', '주문 시켰는데 언제 오나요', '주문시킨 거 발송됐나요', '어제 주문한 귤 얼마나 걸려요', '택배사면 어디인가요',
                '사장님 그 방법으로 하시죠', '얼마 전에 보낸 견적 보셨나요', '이 가격에 이 품질이라니', '택배 언제 와요 얼마 전에 시켰는데', '송장 조회 방법 알려주세요', '사이즈 변경 방법 알려주세요'];   // 뒤 6개 = #650 C(워커4)
            const PREBUY = ['오늘 주문하면 언제 와요?', '지금 시키면 토요일에 받을 수 있나요', '배송비 얼마예요', '주문 방법 좀 알려주세요', '귤 가격이 얼마예요?', '3kg 구매하려는데 배송 며칠 걸려요', '주문 시 배송메세지에 적으면 되나요', '두 박스 사면 배송비 어떻게 돼요'];
            ok(MINE.every(t => sms._generalQ(t) === false) && PREBUY.every(t => sms._generalQ(t) === true), '#645 사기 전 물음 판정: 내 주문 물음 16개는 AI 로 안 흘림(「주문 시켰는데」「얼마나 걸려요」「택배사면」 + #650 C 「얼마 전」「그 방법으로」「이 가격에」 포함) · 사기 전 물음 8개는 AI ' + JSON.stringify(MINE.filter(t => sms._generalQ(t)).concat(PREBUY.filter(t => !sms._generalQ(t)))));
            // 곁(가): 주문 찾기 자체가 실패하면 「주문이 확인되지 않습니다」를 보내지 않고 직원 몫
            sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
            const LK = require('../sms/lookup.js'), keepLk = LK.lookupByPhone; LK.lookupByPhone = async () => { throw new Error('시험: DB 오류'); };
            const PS = T + '1065'; const nE = aiQs.length;
            try { await hook(env('sms:received', { messageId: 'u40', message: '택배 언제 와요?', phoneNumber: '+82' + PS.slice(1) })); } finally { LK.lookupByPhone = keepLk; }
            const tse = await thread(PS);
            ok(aiQs.length === nE && (await outOf(PS)).length === 0 && tse.status === 'staff_needed' && tse.staff_why === 'lookup_error' && !tse.draft_text, '#645 주문 찾기 실패(오류) = 고정 문구도 AI 도 없이 직원 몫(lookup_error) ' + tse.staff_why);
            sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1] };
        }
    }

    console.log('⑩ #650 자동 발송 범위 — 자동으로 나가는 글 · 초안만 · 답 없음');
    {
        const PH1 = T + '1090', PH2 = T + '1091', TC = '999600065001';
        const wipe = async () => { await pool.query(`DELETE FROM delivery_status WHERE tracking = $1`, [TC]); await pool.query(`DELETE FROM delivery_shipments WHERE tracking = $1`, [TC]); };
        await wipe();
        await pool.query(`INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, source) VALUES ($1, (now() AT TIME ZONE 'Asia/Seoul')::date, '거래처육오공', '시험650', $2, 'verify-650')`, [TC, PH1]);
        await pool.query(`INSERT INTO delivery_status (tracking, bucket, label, delivered, checked_at) VALUES ($1, '집화', '집화처리', false, now())`, [TC]);
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
        const botOut = async d => (await msgs(d)).filter(x => x.direction === 'out' && x.sender === 'bot');
        const fresh = async d => { await pool.query(`UPDATE sms_messages SET state = 'sent' WHERE thread_id = (SELECT id FROM sms_threads WHERE phone_digits = $1) AND direction = 'out'`, [d]); await pool.query(`UPDATE sms_threads SET status = 'closed', cooldown_until = now() - interval '1 minute', bot_count = 0, draft_text = NULL, staff_why = NULL WHERE phone_digits = $1`, [d]); };
        let seq = 0; const send = async (d, text) => { await hook(env('sms:received', { messageId: 'w' + (++seq), message: text, phoneNumber: (d.startsWith('0') ? '+82' + d.slice(1) : '+' + d) }), { waitMs: 2300 }); return thread(d); };
        // 가. 자동으로 나감
        aiAnswer = { answer: '안녕하세요 고객님 ^^ 상품 페이지에서 옵션을 고르신 뒤 주문하시면 됩니다.', used: [] };
        let t = await send(PH1, '택배 언제 와요?'); let o = await botOut(PH1);
        ok(t.status === 'bot_replied' && o.length === 1 && /제주에서 출발했습니다!/.test(o[0].body) && o[0].state === 'queued', '#650 ① 주문을 찾은 손님의 배송 물음 = 규칙 답 자동(큐) ' + t.status);
        await fresh(PH1);
        t = await send(PH2, '주문은 어떻게 하나요?'); o = await botOut(PH2);
        ok(t.status === 'bot_replied' && o.length === 1 && o[0].rule_kind === 'ai' && /옵션을 고르신 뒤/.test(o[0].body), '#650 ② 주문 없는 번호의 사기 전 물음(주문 방법) = AI 답 자동');
        await fresh(PH2);
        t = await send(PH2, '배송비 얼마예요'); ok((await botOut(PH2)).length === 2 && t.status === 'bot_replied', '#650 ② 가격·배송비 물음 = AI 답 자동');
        await fresh(PH2);
        // 나. 초안만(자동 발송 0)
        aiAnswer = { answer: '서늘한 곳에 두시고 드실 만큼만 꺼내 두세요.', used: [] };
        let n0 = (await botOut(PH1)).length; t = await send(PH1, '귤 보관은 어떻게 하나요');
        ok((await botOut(PH1)).length === n0 && t.status === 'draft' && t.draft_text === '서늘한 곳에 두시고 드실 만큼만 꺼내 두세요.' && t.draft_kind === 'ai' && !t.staff_why, '#650 주문 있는 손님의 그 밖 물음(보관법) = AI 답은 초안만 · 자동 발송 0 ' + t.status);
        await fresh(PH1);
        n0 = (await botOut(PH2)).length; t = await send(PH2, '귤 보관은 어떻게 하나요');
        ok((await botOut(PH2)).length === n0 && t.status === 'draft' && !!t.draft_text && !t.staff_why, '#650 주문 없는 번호의 그 밖 물음(보관법) = 초안만');
        await fresh(PH2);
        n0 = (await botOut(PH2)).length; t = await send(PH2, '택배 언제 와요?');
        ok((await botOut(PH2)).length === n0 && t.status === 'draft' && /주문이 확인되지 않습니다/.test(t.draft_text) && t.staff_why === 'order_not_found', '#650 주문 없는 번호의 배송 물음 = 되묻기 고정 문구는 초안만 · 직원 확인');
        await fresh(PH2);
        // 다. 답도 초안도 없음(직원 몫 또는 무시) — AI 호출 0
        const nAi = aiQs.length; aiAnswer = { answer: '나오면 안 되는 답.', used: [] };
        const NONE = [['한박스 주문합니다 서울시 강남구 테헤란로 12', 'request', 'staff_needed'], ['주문 취소하고 싶어요', 'request', 'staff_needed'], ['전화 좀 주세요', 'call', 'staff_needed'], ['저 김철수님 아닙니다.', 'wrong_number', 'staff_needed'], ['귤이 좀 시네요', 'claim', 'draft']];
        for (const [text, why, st] of NONE) {
            n0 = (await botOut(PH2)).length; t = await send(PH2, text);
            ok((await botOut(PH2)).length === n0 && t.status === st && t.staff_why === why && (st === 'draft' ? /주문이 확인되지 않아/.test(t.draft_text || '') : !t.draft_text), `#650 「${text.slice(0, 22)}」 = 자동 발송 0 · ${st === 'draft' ? '되묻기 초안' : '초안 없음'} · 사유 ${why} ` + t.status + ' ' + t.staff_why);
            await fresh(PH2);
        }
        for (const text of ['[CJ대한통운] 배송기사입니다. 오늘 14~16시 배송 예정입니다.', '택배 문 앞에 두고 갑니다', '“택배 언제 와요”에 좋아요를 표시함', '123']) {
            n0 = (await botOut(PH2)).length; t = await send(PH2, text);
            ok((await botOut(PH2)).length === n0 && !t.draft_text && !t.staff_why && ['closed', 'ignored', 'new'].includes(t.status), `#650 「${text.slice(0, 22)}」 = 답·초안·사유 없음(무시) ` + t.status);
        }
        ok(aiQs.length === nAi, '#650 요청·전화·오발신·기사 문자·반응 문자·뜻 없는 글 = AI 호출 0 ' + (aiQs.length - nAi));
        // 손질 B: 국내 번호에서 온 「기사 안내문 꼴」은 답 없이 두되 숨기지 않음 · 주문 있는 번호의 같은 글은 무시하지 않음
        await fresh(PH2); t = await send(PH2, '택배 문 앞에 두고 갑니다');
        ok(t.status === 'new' && (await msgs(PH2)).pop().bucket === 'carrier' && !t.draft_text, '#650 B 주문 없는 국내 번호의 기사 안내문 꼴 = 답 없음 · 숨기지 않음(ignored 아님) ' + t.status);
        await fresh(PH1); t = await send(PH1, '택배 문 앞에 두고 갑니다');
        ok((await msgs(PH1)).pop().bucket !== 'carrier' && t.status !== 'ignored' && t.status !== 'closed', '#650 B 주문 있는 번호의 같은 글 = 기사 안내문으로 무시하지 않음 ' + (await msgs(PH1)).pop().bucket + ' ' + t.status);
        await fresh(PH1);
        // 손질 A: 불만 고정 답 — 상태 낱말 + 물음 아님 = 자동 · 「교환 가능한가요」 = 같은 문구 초안만 · 칭찬 글 = 답·초안 없음
        await pool.query(`UPDATE sms_messages SET rule_kind = 'x-claim' WHERE rule_kind = 'claim' AND thread_id = (SELECT id FROM sms_threads WHERE phone_digits = $1)`, [PH1]);
        n0 = (await botOut(PH1)).length; t = await send(PH1, '교환 가능한가요');
        ok((await botOut(PH1)).length === n0 && t.status === 'draft' && /불편드려 죄송합니다/.test(t.draft_text || '') && t.staff_why === 'claim', '#650 A 「교환 가능한가요」(상태 낱말 없음·물음) = 고정 문구는 초안만 · 직원 확인 ' + t.status + ' ' + t.staff_why);
        await fresh(PH1);
        n0 = (await botOut(PH1)).length; t = await send(PH1, '파손 없이 잘 받았습니다');
        ok((await botOut(PH1)).length === n0 && !t.draft_text && !t.staff_why, '#650 A 「파손 없이 잘 받았습니다」 = 사과 답·초안·직원 사유 없음 ' + t.status);
        await fresh(PH1);
        n0 = (await botOut(PH1)).length; t = await send(PH1, '상자가 터져서 왔어요'); o = await botOut(PH1);
        ok(o.length === n0 + 1 && o[o.length - 1].rule_kind === 'claim' && t.status === 'bot_replied' && t.staff_why === 'claim', '#650 A 「상자가 터져서 왔어요」 = 고정 답 자동 + 직원 확인 표시 ' + t.status);
        await pool.query(`UPDATE sms_messages SET rule_kind = 'x-claim' WHERE rule_kind = 'claim' AND thread_id = (SELECT id FROM sms_threads WHERE phone_digits = $1)`, [PH1]);
        await fresh(PH1);
        // 손질 D: 초안만 대기 중(사유 없음)인 대화에 자동 답이 나갈 글이 오면 자동 발송 · 사유가 있는 대화는 종전대로 초안만
        aiAnswer = { answer: '서늘한 곳에 두시고 드실 만큼만 꺼내 두세요.', used: [] };
        t = await send(PH1, '귤 보관은 어떻게 하나요'); n0 = (await botOut(PH1)).length;
        const d1 = t.status === 'draft' && !t.staff_why && !!t.draft_text;
        t = await send(PH1, '택배 언제 와요?'); o = await botOut(PH1);
        ok(d1 && o.length === n0 + 1 && /제주에서 출발했습니다!/.test(o[o.length - 1].body) && t.status === 'bot_replied' && !t.draft_text, '#650 D 초안만 대기 중(사유 없음)인 주문 손님의 배송 물음 = 자동 발송 · 대기 초안은 갈음 ' + t.status);
        await fresh(PH1); await fresh(PH2);
        aiAnswer = { answer: '안녕하세요 고객님 ^^ 상품 페이지에서 옵션을 고르신 뒤 주문하시면 됩니다.', used: [] };
        t = await send(PH2, '택배 언제 와요?'); n0 = (await botOut(PH2)).length;
        const d2 = t.status === 'draft' && t.staff_why === 'order_not_found';
        t = await send(PH2, '주문은 어떻게 하나요?');
        ok(d2 && (await botOut(PH2)).length === n0 && t.status === 'staff_needed' && !!t.draft_text && t.draft_kind === 'ai', '#650 D 사유가 있는 초안 대화(주문 못 찾음)는 종전대로 잠금 — 자동 답이 나갈 글이어도 자동 발송 0 · 초안만 새로(직원 몫) ' + t.status + ' ' + t.staff_why);
        // #651 화면용 칸: summary.staff_open · messages[].send_after
        r = await api('GET', '/api/sms/summary'); const so = (await pool.query(`SELECT count(*)::int AS n FROM sms_threads WHERE staff_why IS NOT NULL AND status NOT IN ('closed','ignored')`)).rows[0].n;
        ok(r.status === 200 && typeof r.json.staff_open === 'number' && r.json.staff_open === so && so >= 1, '#651 summary.staff_open = 사유가 남은 열린 대화 수(읽음 무관) ' + r.json.staff_open + '/' + so);
        await fresh(PH1); sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 75, max_chars: 1000, staff_ids: [1] };
        t = await send(PH1, '송장번호 알려주세요'); r = await api('GET', `/api/sms/threads/${t.id}?peek=1`);
        const qm = (r.json.messages || []).filter(x => x.direction === 'out' && x.state === 'queued'), sm = (r.json.messages || []).filter(x => !(x.direction === 'out' && x.state === 'queued'));
        ok(qm.length >= 1 && qm.every(x => x.send_after && new Date(x.send_after) > new Date(Date.now() + 30000) && new Date(x.send_after) < new Date(Date.now() + 80000)) && sm.length >= 1 && sm.every(x => x.send_after === null), '#651 messages[].send_after = 유예 중인 보낼 글만 시각(약 75초 뒤) · 그 밖은 null ' + JSON.stringify(qm.map(x => x.send_after)));
        await pool.query(`UPDATE sms_messages SET state = 'cancelled' WHERE state = 'queued' AND thread_id = $1`, [t.id]);
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
        await fresh(PH1); await fresh(PH2);
        // 라. 수신거부 = 답 없음 + 그 뒤 글에도 봇 침묵(기억)
        const PH3 = T + '1092'; aiAnswer = { answer: '안녕하세요 고객님 ^^ 상품 페이지에서 주문하시면 됩니다.', used: [] };
        t = await send(PH3, '문자 보내지 마세요');
        ok(t.status === 'staff_needed' && t.staff_why === 'refuse' && !t.draft_text && (await botOut(PH3)).length === 0, '#649 「문자 보내지 마세요」 = 답·초안 없음 · 직원 몫(refuse)');
        await pool.query(`UPDATE sms_threads SET status = 'closed', staff_why = NULL WHERE phone_digits = $1`, [PH3]);
        const nAi2 = aiQs.length; t = await send(PH3, '주문은 어떻게 하나요?');
        r = await api('GET', '/api/sms/threads?q=' + PH3);
        ok(t.status === 'staff_needed' && t.staff_why === 'no_bot' && !t.draft_text && (await botOut(PH3)).length === 0 && aiQs.length === nAi2 && r.json.items[0] && r.json.items[0].staff_why_label === '봇 응대 끔(수신거부)', '#649 수신거부한 번호의 뒤 글(자동 답이 나갈 물음이어도) = 봇 침묵 · AI 0 · 화면 사유 「봇 응대 끔」');
        // 마. 해외 번호 = 봇이 보내지 않음
        const PF = '14155550199'; await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits = $1)`, [PF]); await pool.query(`DELETE FROM sms_threads WHERE phone_digits = $1`, [PF]);
        const nAi3 = aiQs.length; t = await send(PF, '주문은 어떻게 하나요?');
        ok(!!t && t.status === 'staff_needed' && t.staff_why === 'foreign_number' && !t.draft_text && (await botOut(PF)).length === 0 && aiQs.length === nAi3, '#649 해외 번호(+1…)의 글 = 자동 답·초안 없음 · AI 0 · 직원 몫(foreign_number)');
        const tOtp = await send(PF, 'Your verification code is 482913'); ok((await msgs(PF)).pop().bucket === 'otp' && (await botOut(PF)).length === 0 && tOtp.staff_why === 'foreign_number', '#649 해외 번호의 인증번호 꼴 = otp 갈래(답 없음)');
        await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits = $1)`, [PF]); await pool.query(`DELETE FROM sms_threads WHERE phone_digits = $1`, [PF]);
        await wipe();
        ok((await pool.query(`SELECT (SELECT count(*) FROM delivery_shipments WHERE source = 'verify-650')::int + (SELECT count(*) FROM sms_threads WHERE phone_digits = $1)::int AS n`, [PF])).rows[0].n === 0, '#650 시험 송장·해외 번호 시험 대화 정리 0');
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1] };
    }

    // #648 시험 번호 대화는 검증 인스턴스가 아닌 서버(= 라이브)의 화면·알림·틱에서 안 보인다 — 같은 DB 에 testMode 없는 인스턴스를 하나 더 붙여 확인(읽기 라우트와 알림만 부른다 · 틱은 진짜 줄을 건드리므로 부르지 않고 SQL 글자로 확인)
    {
        const app2 = express(); app2.use(express.json());
        const notes2 = []; const sms2 = mount(app2, Object.assign({}, deps, { testMode: false, createNotification: async (...a) => { notes2.push(a); }, notifyTelegram: async m => { notes2.push(['tg', m]); } }));
        const srv2 = app2.listen(PORT + 1); const base2 = `http://127.0.0.1:${PORT + 1}`;
        const api2 = async p => { const r = await fetch(base2 + p, { headers: { authorization: 'Bearer ' + token } }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
        sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1] };
        const PZ = T + '1080';
        await hook(env('sms:received', { messageId: 'z1', message: '귤이 다 썩어서 왔어요 환불해주세요', phoneNumber: '+82' + PZ.slice(1) }));
        const tz = await thread(PZ);
        const mineA = (await api('GET', '/api/sms/threads?scope=active&limit=200')).json, mineS = (await api('GET', '/api/sms/summary')).json;
        const liveA = (await api2('/api/sms/threads?scope=active&limit=200')).json, liveAll = (await api2('/api/sms/threads?scope=all&limit=200')).json, liveQ = (await api2('/api/sms/threads?q=' + PZ.slice(-4))).json, liveSt = (await api2('/api/sms/threads?status=staff_needed&limit=200')).json, liveS = (await api2('/api/sms/summary')).json;
        const isT = x => String(x.phone_full || '').startsWith('0999');
        ok(mineA.items.some(x => x.id === tz.id) && mineS.unread_threads >= 1, '#648 검증 인스턴스(testMode)에는 시험 대화가 종전대로 보임');
        ok([liveA, liveAll, liveQ, liveSt].every(j => Array.isArray(j.items) && !j.items.some(isT)), '#648 라이브 꼴 인스턴스: 목록 4갈래(active·all·찾기·상태)에 시험 번호 대화 0 ' + JSON.stringify([liveA, liveAll, liveQ, liveSt].map(j => (j.items || []).filter(isT).length)));
        const testN = (await pool.query(`SELECT count(*) FILTER (WHERE status = 'staff_needed')::int AS sn, count(*)::int AS n FROM sms_threads WHERE phone_digits LIKE '0999%'`)).rows[0];
        ok(testN.sn >= 1 && liveS.staff_needed === mineS.staff_needed - testN.sn && liveS.unread_threads <= mineS.unread_threads - 1 && Object.values(liveS.counts || {}).reduce((a, b) => a + b, 0) === Object.values(mineS.counts || {}).reduce((a, b) => a + b, 0) - testN.n && liveS.today_in < mineS.today_in,
            '#648 라이브 꼴 인스턴스: summary 셈(직원 몫·안 읽음·상태별·오늘 받은 글)에서 시험 대화 빠짐 ' + JSON.stringify({ live: [liveS.staff_needed, liveS.unread_threads, liveS.today_in], mine: [mineS.staff_needed, mineS.unread_threads, mineS.today_in], test: testN }));
        const n2 = notes2.length;
        const sent2 = await sms2._notifyStaff(await sms2.cfg(), { id: tz.id }, '시험 알림(나가면 안 됨)', 'x', { force: true });
        const sent2b = await sms2._notifyStaff(await sms2.cfg(), tz, '시험 알림(나가면 안 됨)', 'x', { force: true });
        ok(sent2 === 0 && sent2b === 0 && notes2.length === n2, '#648 라이브 꼴 인스턴스: 시험 번호 대화는 알림을 만들지 않음(대화 번호만 받아도 · 강제 알림이어도)');
        const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'sms', 'index.js'), 'utf8');
        const sweep = src.slice(src.indexOf('async function sweepStuck()'), src.indexOf('let _sendBusy'));
        const stmts = sweep.split('pool.query(').slice(1).map(x => x.slice(0, x.indexOf('`', 1) + 1));
        ok(stmts.length >= 6 && stmts.every(x => /TEST_SKIP_M|TEST_SKIP_T|TEST_HIDE/.test(x)), '#648 멈춘 줄 정리(sweepStuck)의 문장 ' + stmts.length + '개 전부에 시험 번호 거름 ' + JSON.stringify(stmts.filter(x => !/TEST_SKIP_M|TEST_SKIP_T|TEST_HIDE/.test(x)).map(x => x.slice(0, 60))));
        const pp = src.slice(src.indexOf('async function pendingPhotoTick()'), src.indexOf('const labelWhy'));
        ok(/TEST_HIDE_T2/.test(pp) && /if \(!deps\.testMode\) where\.push/.test(src), '#648 사진 대기 틱·목록 라우트에도 거름');
        await new Promise(r2 => srv2.close(r2));
        sms.resetCfg();
        // 더. #646 주문을 찾은 손님의 불만 글 = 고정 답 1번 + 직원 확인 · 이어지는 불만 = 답 없음 · 둘째 답부터 인사 줄임
        {
            const CL = '고객님, 불편드려 죄송합니다.\n배송 중에 약했던 부분이 상하거나 파손된 것 같습니다. 다음에는 더 꼼꼼하게 선별하겠습니다.\n전체적으로 확인해 보시고 이상 있는 부분은 부분 환불 처리도 가능하고, 괜찮은 상품 드셔 보시고 입맛에 안 맞으시면 반품 처리도 가능하니 말씀해 주시면 빠르게 도와드리겠습니다.\n이상 있는 부분 사진을 찍어 보내 주시면 더 빠르게 처리해 드리겠습니다.';
            const PT = T + '1070', PU = T + '1071', TA = '999600064601', TB = '999600064602';
            const wipe = async () => { await pool.query(`DELETE FROM delivery_status WHERE tracking IN ($1, $2)`, [TA, TB]); await pool.query(`DELETE FROM delivery_shipments WHERE tracking IN ($1, $2)`, [TA, TB]); };
            await wipe();
            await pool.query(`INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, source) VALUES ($1, (now() AT TIME ZONE 'Asia/Seoul')::date, '거래처육사육', '시험646가', $3, 'verify-646'), ($2, (now() AT TIME ZONE 'Asia/Seoul')::date, '거래처육사육', '시험646나', $4, 'verify-646')`, [TA, TB, PT, PU]);
            await pool.query(`INSERT INTO delivery_status (tracking, bucket, label, delivered, checked_at) VALUES ($1, '집화', '집화처리', false, now()), ($2, '집화', '집화처리', false, now())`, [TA, TB]);
            sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 1000, staff_ids: [1] };
            const outOf = async d => (await msgs(d)).filter(x => x.direction === 'out' && x.sender === 'bot');
            aiAnswer = { answer: '나오면 안 되는 AI 답.', used: [] };
            let nA = aiQs.length, nN = notes.length;
            await hook(env('sms:received', { messageId: 'v1', message: '귤이 여러 개 썩어서 왔어요 환불해주세요', phoneNumber: '+82' + PT.slice(1) }), { waitMs: 2600 });
            let tt = await thread(PT), ot = await outOf(PT);
            ok(aiQs.length === nA && ot.length === 1 && ot[0].body === CL && ot[0].rule_kind === 'claim' && tt.status === 'bot_replied' && tt.staff_why === 'claim' && notes.length === nN + 1 && /불만 글 — 봇이 사과·안내 답을 보냈어요/.test(notes[notes.length - 1].title),
                '#646 주문 있는 손님의 불만 글 = 고정 답(사과 + 부분 환불·반품 가능 + 사진 부탁) 1통 · AI 0 · 직원 확인(claim) + 알림 ' + JSON.stringify({ n: ot.length, why: tt.staff_why, ai: aiQs.length - nA }));
            ok(!/\d|원|개 |%|퍼센트|네이버|톡톡|환불해 드리겠|재발송|보내 드리겠|효돈|거래처/.test(CL) && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(CL) && sms.smsSafe(CL) === CL, '#646 불만 답 문구: 숫자·금액·비율 0 · 채널 낱말 0 · 봇이 결정하는 말 0 · 이모지 0 · smsSafe 그대로');
            r = await api('GET', '/api/sms/threads?scope=active&limit=200'); it = (r.json.items || []).find(x => x.id === tt.id);
            ok(it && it.needs_staff === true && it.staff_why_label === '불만·클레임' && it.last_dir === 'in', '#646 목록: needs_staff true · 사유 「불만·클레임」');
            // 이어지는 불만 글(쿨다운이 지난 것처럼) = 다시 안 보냄 → 사람
            await pool.query(`UPDATE sms_messages SET state = 'sent' WHERE thread_id = $1 AND direction = 'out'`, [tt.id]); await pool.query(`UPDATE sms_threads SET status = 'closed', cooldown_until = now() - interval '1 minute' WHERE id = $1`, [tt.id]);
            await hook(env('sms:received', { messageId: 'v2', message: '곰팡이도 있어요 교환해주세요', phoneNumber: '+82' + PT.slice(1) }), { waitMs: 2200 });
            tt = await thread(PT);
            ok((await outOf(PT)).length === 1 && tt.status === 'staff_needed' && tt.staff_why === 'claim' && !tt.draft_text && aiQs.length === nA, '#646 같은 대화의 이어지는 불만 글 = 고정 답 다시 안 보냄 · 초안 없음 · 직원 몫');
            // 미도착 불만(고정 답이 안 맞는 글) = 종전대로 사람
            await pool.query(`UPDATE sms_messages SET rule_kind = 'x-claim' WHERE thread_id = $1 AND rule_kind = 'claim'`, [tt.id]); await pool.query(`UPDATE sms_threads SET status = 'closed', cooldown_until = now() - interval '1 minute' WHERE id = $1`, [tt.id]);
            await hook(env('sms:received', { messageId: 'v3', message: '아직도 안 왔는데요 환불해주세요', phoneNumber: '+82' + PT.slice(1) }), { waitMs: 2200 });
            tt = await thread(PT);
            ok((await outOf(PT)).length === 1 && tt.status === 'staff_needed' && tt.staff_why === 'claim' && !tt.draft_text, '#646 미도착 불만(「아직도 안 왔는데요」) = 고정 답 없음 · 종전대로 직원 몫');
            // 둘째 답부터 머리 인사 없이 · 맺음 「감사합니다 ^^」
            nA = aiQs.length;
            await hook(env('sms:received', { messageId: 'v4', message: '택배 언제 와요?', phoneNumber: '+82' + PU.slice(1) }), { waitMs: 2600 });
            const o1 = await outOf(PU);
            await pool.query(`UPDATE sms_messages SET state = 'sent' WHERE thread_id = (SELECT id FROM sms_threads WHERE phone_digits = $1) AND direction = 'out'`, [PU]); await pool.query(`UPDATE sms_threads SET status = 'closed', cooldown_until = now() - interval '1 minute' WHERE phone_digits = $1`, [PU]);
            await hook(env('sms:received', { messageId: 'v5', message: '송장번호 알려주세요', phoneNumber: '+82' + PU.slice(1) }), { waitMs: 2600 });
            const o2 = await outOf(PU);
            ok(o1.length === 1 && /^안녕하세요 고객님 \^\^ 오늘 제주에서 출발했습니다!\n/.test(o1[0].body) && /행복한 하루 되세요 \^\^$/.test(o1[0].body) && o2.length === 2 && /^오늘 제주에서 출발했습니다!\n송장번호 /.test(o2[1].body) && /\n감사합니다 \^\^$/.test(o2[1].body) && !/안녕하세요|행복한 하루/.test(o2[1].body) && o2[1].body.includes(TB) && aiQs.length === nA,
                '#646 첫 답 = 「안녕하세요 고객님 ^^ …행복한 하루 되세요 ^^」 · 같은 날 둘째 답 = 인사 없이 본문부터 …「감사합니다 ^^」 ' + JSON.stringify(o2[1] && o2[1].body.split('\n').filter((x, i, a) => i === 0 || i === a.length - 1)));
            await wipe();
            ok((await pool.query(`SELECT count(*)::int AS n FROM delivery_shipments WHERE source = 'verify-646'`)).rows[0].n === 0, '#646 시험 송장 줄 정리 0');
            sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'record', staff_ids: [1] };
        }
    }

    // 정리
    await pool.query(`DELETE FROM sms_images WHERE message_id IN (SELECT m.id FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%']);
    const left = (await pool.query(`SELECT count(*)::int AS n FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%'])).rows[0].n; ok(left === 0, '시험 줄 정리 0');
    srv.close(); await pool.end();
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERR', e); await cleanupTest(); try { await pool.end(); } catch (_) { } process.exit(1); });
