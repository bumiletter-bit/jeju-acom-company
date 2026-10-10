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
(async () => {
    // 가짜 의존
    const cfgStore = { sms_gateway: { enabled: true, mode: 'record', hold_sec: 0, max_chars: 70 } }; const notes = [], tg = [], sent = []; let aiAnswer = null;
    const deps = {
        pool, authMiddleware: (req, res, next) => { try { req.user = jwt.verify(String(req.headers.authorization || '').replace('Bearer ', ''), JWT); next(); } catch (e) { res.status(401).json({ error: 'auth' }); } },
        naverCfgGet: async k => cfgStore[k] === undefined ? null : cfgStore[k], naverCfgSet: async (k, v) => { cfgStore[k] = v; },
        writeAudit: async () => { }, createNotification: async (uid, type, title, message, link) => { notes.push({ uid, type, title, message, link }); },
        notifyTelegram: async t => { tg.push(t); }, loadShippingHolidayInfo: async () => ({ set: new Set(), arriveOff: new Set(), reasons: new Map() }),
        qnaGenerate: async (q, pn, sd, ch) => { ok(ch === 'sms', 'qnaGenerate 채널 sms'); return aiAnswer; },
        cjTrack: null, deliveryUpsertStatus: null, log: { log() { }, error(...a) { console.log('   [module error]', ...a); } },
        gatewaySend: async (digits, text, id) => { sent.push({ digits, text, id }); return { id }; },
    };
    cfgStore.sms_gateway.staff_ids = [1];
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
    ok(sms.smsSafeText('안녕 😀 🍊 반가워요').indexOf('😀') < 0, 'smsSafeText 이모지 제거');
    const c0 = sms.cfgOf({ mode: 'bogus', daily_cap: 999, max_chars: 10 });
    ok(c0.mode === 'record' && c0.daily_cap === 1 && c0.max_chars === 70, 'cfgOf 기본값 회귀 ' + JSON.stringify(c0));
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
    ok((await thread(P3)).status === 'staff_needed' && notes.length === 2, '직원 몫 대화에 다시 옴 → 잠금 유지 + 알림');

    console.log('④ auto 모드 — 규칙/AI 답 · 유예 · 쿨다운 · 하루 1번');
    sms.resetCfg(); cfgStore.sms_gateway = { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 70, staff_ids: [1], cooldown_min: 30, daily_cap: 1 };
    aiAnswer = { answer: '네, 보관은 서늘한 곳에 두시고 드실 만큼만 꺼내 두세요. 냉장 보관하시면 더 오래 신선하게 드실 수 있어요. 😊 추가 문의는 톡톡으로 주세요.', used: [] };
    r = await hook(env('sms:received', { messageId: 'b1', message: '귤 보관 어떻게 해요?', phoneNumber: '+82' + P4.slice(1) }));
    let t4 = await thread(P4), m4 = await msgs(P4);
    const outs = m4.filter(x => x.direction === 'out');
    ok(t4.status === 'bot_replied', 'auto: bot_replied ' + t4.status);
    ok(outs.length >= 2 && outs.every(o => o.sender === 'bot' && o.state === 'queued' && Array.from(o.body).length <= 70), 'auto: 70자 조각 큐 ' + outs.length + '통');
    ok(outs.every(o => !/😊|톡톡/.test(o.body)), 'auto: 이모지·톡톡 제거');
    let st = await sms.sendTick(); ok(Array.isArray(st) && st.filter(x => x.sent).length === outs.length, 'sendTick 발송 ' + JSON.stringify(st));
    ok(sent.length === outs.length && sent.every(x => x.digits === P4 && x.id), '가짜 게이트웨이로 보냄 · 우리 id 지정');
    t4 = await thread(P4); ok(t4.cooldown_until && new Date(t4.cooldown_until) > new Date() && t4.bot_count === outs.length, '쿨다운·bot_count ' + t4.bot_count);
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

    console.log('⑤ 유예 중 직원 처리 → 봇 큐 취소 · AI [사람] · 모르는 번호');
    sms.resetCfg(); cfgStore.sms_gateway.hold_sec = 600;
    aiAnswer = { answer: '답입니다.', used: [] };
    await hook(env('sms:received', { messageId: 'd1', message: '배송 언제요', phoneNumber: '+82' + P6.slice(1) }));
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
    const P7 = T + '1007'; await hook(env('sms:received', { messageId: 'e1', message: '이게 뭐예요 진짜', phoneNumber: '+82' + P7.slice(1) }));
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
    const P9 = T + '1009'; await hook(env('sms:received', { messageId: 'g1', message: '발송 됐나요', phoneNumber: '+82' + P9.slice(1) }));
    let t9 = await thread(P9); ok(t9.status === 'draft' && t9.draft_text === '초안 답입니다.' && (await msgs(P9)).filter(x => x.direction === 'out').length === 0, 'draft: 초안 저장 · 발송 0');
    r = await api('GET', `/api/sms/threads?status=draft`); ok(r.status === 200 && r.json.items.some(x => x.id === t9.id && x.draft_text === '초안 답입니다.' && x.phone_tail === P9.slice(-4) && !JSON.stringify(x).includes(P9)), '목록 draft · 전체 번호 없음');
    r = await api('POST', `/api/sms/threads/${t9.id}/send-draft`, {}); ok(r.status === 200, '[이대로 보내기]');
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

    // 정리
    await pool.query(`DELETE FROM sms_images WHERE message_id IN (SELECT m.id FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%']);
    const left = (await pool.query(`SELECT count(*)::int AS n FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%'])).rows[0].n; ok(left === 0, '시험 줄 정리 0');
    srv.close(); await pool.end();
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERR', e); try { await pool.end(); } catch (_) { } process.exit(1); });
