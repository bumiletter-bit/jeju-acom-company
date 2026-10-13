// #610-E 에이전트 오피스 「문자」 카드 시공용 가짜 서버 — DB·외부 호출 0 · 메모리 안 고정 자료 12건
//   사용: node scripts/_mock-610.js [포트=3461]   (verify-610-ui.js 가 스스로 띄운다)
//   ① /api/sms/* = 총괄 확정 계약 그대로(GET summary · threads · threads/:id · images/:id / POST reply · handled · send-draft · close)
//   ② 화면 파일 = public/ 그대로 · 그 밖의 /api 는 화면이 뜰 만큼만 빈 값(실서버 아님)
//   ③ 시험용: GET /__mock/log(받은 쓰기 목록) · POST /__mock/reset · POST /__mock/set { alive, mode, enabled, counts:false(=summary 에서 counts 빼기), fail:'reply'|'', legacy:true(=#635 전 옛 서버 응답) }
//      POST /__mock/push { id, body } = 그 손님이 문자를 또 보냄(안 읽음이 다시 생긴다)
//   #635 폰 문자함 계약(docs/sms-gateway-spec.md 10-5a): threads?scope=active|all&q= · 줄의 unread·needs_staff·staff_why(_label)·last_dir·last_at · GET threads/:id = 읽음(?peek=1 은 안 바꿈) · summary.unread_threads·needs_staff·drafts(초안 있는 대화 수)
//      처음 = 안 읽은 대화 7(1·2·3·6·7·11·12) · 그중 사람 몫 3(2 AI 판단 · 3 불만·클레임 · 11 보내지 못함) · 초안 1(1) · 읽은 대화 5(4·5·8·9·10)
//   실서버(sms/index.js)와 맞춘 것(F1): 상태 = new · staff_needed · draft · bot_replied · staff_replied · closed · ignored('cooldown' 은 서버가 안 넣는다) · summary.counts·drafts · [이대로 보내기]는 직원 이름으로 나감
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const PORT = Number(process.argv[2] || process.env.PORT610 || 3461);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const iso = minAgo => new Date(Date.now() - minAgo * 60000).toISOString();
const svg = (label, c1, c2) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${c1}"/><circle cx="230" cy="250" r="120" fill="${c2}"/><circle cx="420" cy="230" r="96" fill="${c2}" opacity=".8"/><text x="24" y="52" font-family="sans-serif" font-size="30" fill="#222">${label}</text></svg>`;
const IMAGES = { 901: svg('mock 사진 901', '#F3E9D2', '#F2A33A'), 902: svg('mock 사진 902', '#E8E4DA', '#6B8E4E'), 903: svg('mock 사진 903', '#EFE6D8', '#E08A2E') };

let ST;
function seed() {
    let mid = 5000;
    const m = (direction, sender, body, minAgo, o) => Object.assign({ id: ++mid, direction, kind: 'sms', body, sender, state: direction === 'in' ? 'received' : 'delivered', image_ids: [], event_at: iso(minAgo) }, o || {});
    const T = (id, tail, status, hint, msgs, o) => ({ id, phone_tail: tail, phone_masked: '010****' + tail, phone_full: '0101234' + tail,   /* #624: 서버가 주는 전체 번호(숫자만) */ customer_hint: hint, status, staff_name: null, handled_at: null, bot_count_today: 0, draft_text: null, read_at: null, staff_why: null, order: null, messages: msgs, ...(o || {}) });
    const ORD = (o) => Object.assign({ recipient_name: '홍길동', recipient_initial: '홍', ship_date: '2026-10-09', partner: '효돈', option_text: '하우스감귤 가정용 - 4kg(로얄과)', qty: 1, tracking_tail: '4821', status_label: '배송출발', arrive_text: '오늘 도착 예정' }, o || {});
    ST = {
        enabled: true, mode: 'draft', alive: true, last_ping_at: iso(1), withCounts: true, fail: '', log: [],
        threads: [
            T(1, '1234', 'draft', '효돈 · 10/9 발송 · 하우스감귤 4kg', [
                m('in', 'customer', '귤 받았는데요', 62), m('in', 'customer', '', 61, { kind: 'mms', image_ids: [901, 902] }),
                m('in', 'customer', '몇 개가 터져서 왔어요. 어떻게 하면 되나요?', 60),
            ], { order: ORD({ status_label: '배송완료', arrive_text: '10/10(토) 도착' }), draft_text: '부패과가 나왔군요, 불편드려 죄송합니다. 괜찮은 상품 드셔보시고 입맛에도 안 맞으시면 무료 수거 및 반품처리도 가능합니다.' }),
            T(2, '5678', 'staff_needed', null, [m('in', 'customer', '안녕하세요 단체 주문 견적 문의드립니다. 50박스 가능한가요?', 44)], { staff_why: 'ai_to_staff' }),
            T(3, '2468', 'staff_needed', '대성 · 10/8 발송 · 황금향 3kg', [
                m('in', 'customer', '황금향 언제 오나요', 190), m('out', 'bot', '10/8(목)에 출발했어요. 송장 끝 7730, 오늘 도착 예정입니다.', 189),
                m('in', 'customer', '아직도 안 왔는데요 확인 좀 해주세요', 25),
            ], { order: ORD({ ship_date: '2026-10-08', partner: '대성', option_text: '황금향 가정용 3kg', tracking_tail: '7730', status_label: '간선상하차', arrive_text: '내일 도착 예정' }), bot_count_today: 1, staff_why: 'claim',
                history_extra: [   // 같은 번호의 지난 구매 2건(#654 꼴 — 60일 안 · 한 건은 이 번호가 구매자였던 선물)
                    { pre: false, ship_date: '2026-09-22', recipient_name: '홍길동', option_text: '하우스감귤 가정용 - 4kg(로얄과)', qty: 1, boxes: 1, trackings: ['590123450001'], status_label: '배송완료', delivered: true, event_time: '2026-09-23 14:10', partner: '효돈', role: 'recipient' },
                    { pre: false, ship_date: '2026-08-30', recipient_name: '이순자', option_text: '미니밤호박 특품 5kg', qty: 2, boxes: 2, trackings: ['590123450002', '590123450003'], status_label: null, delivered: false, event_time: null, partner: '길영', role: 'buyer', status_text: '배송 중 · 이동',
                      boxes_detail: [{ tracking: '590123450002', option_text: '미니밤호박 특품 5kg', qty: 1, status_label: '배송완료', status_text: '배송완료', delivered: true, event_time: '2026-08-31 13:00' }, { tracking: '590123450003', option_text: '미니밤호박 보우짱 3kg', qty: 1, status_label: '정보없음', status_text: '배송 중 · 집화 전', delivered: false, event_time: null }] },
                ], history_more: true }),
            T(4, '1357', 'bot_replied', '효돈 · 10/9 발송 · 하우스감귤 2.5kg(소과)', [
                m('in', 'customer', '오늘 주문하면 언제 발송되나요?', 95), m('out', 'bot', '오늘 8시 이후 주문은 내일 오전에 발송돼요. 보통 발송 다음 날 도착합니다.', 94),
            ], { order: ORD({ option_text: '하우스감귤 가정용 - 2.5kg(소과)' }), bot_count_today: 1, read_at: iso(90) }),
            T(5, '9090', 'bot_replied', null, [m('in', 'customer', '귤 보관은 어떻게 해요?', 130), m('out', 'bot', '서늘하고 바람이 통하는 곳에 두시고, 오래 두실 때는 냉장 보관을 권해요.', 129)], { bot_count_today: 1, read_at: iso(120) }),
            T(6, '3141', 'bot_replied', '효돈 · 10/09 발송 · 하우스감귤 4kg · 배송출발 · 새 주문 1건 대기', [
                m('in', 'customer', '송장번호 알려주세요', 20), m('out', 'bot', '송장 끝 5592 로 10/9(금)에 출발했어요.', 19), m('in', 'customer', '네 감사합니다', 18),
            ], { order: ORD({ tracking_tail: '5592' }), bot_count_today: 1 }),
            T(7, '2718', 'bot_replied', null, [m('in', 'customer', '가격표 좀 보내주세요', 12), m('out', 'bot', '지금 판매 중인 상품과 가격은 스마트스토어에서 보실 수 있어요.', 11)], { bot_count_today: 1, order_raw: { line: '발송 전 · 결제 10/10 · 하우스감귤 가정용 - 4kg(로얄과) · 2개', role: 'buyer', match: 'one', candidates: 1, order: { pre: true, channel: 'naver', paid_at: '2026-10-10T03:00:00.000Z', paid_known: true, option_text: '하우스감귤 가정용 - 4kg(로얄과)', qty: 2, ship_date: null, delivered: false, status_label: null, tracking_tail: null, boxes: null, ship_plan: '10/12(월)' } } }),
            T(8, '4444', 'staff_replied', '대성 · 10/7 발송 · 한라봉 3kg', [
                m('in', 'customer', '', 300, { kind: 'mms', image_ids: [903] }), m('in', 'customer', '크기가 저번보다 작아요', 299),
                m('out', 'gateway_other', '크기가 작았군요, 불편드려 죄송합니다. 사진 확인했어요. 다음 주문 때 배송메세지에 사이즈를 적어 주시면 맞춰 보내드릴게요.', 280),
            ], { order: ORD({ ship_date: '2026-10-07', partner: '대성', option_text: '한라봉 가정용 3kg', tracking_tail: '1180', status_label: '배송완료', arrive_text: '10/8(목) 도착' }), staff_name: '조가영', handled_at: iso(280), read_at: iso(280) }),
            T(9, '8282', 'staff_replied', null, [m('in', 'customer', '전화 부탁드려요', 400), m('out', 'bot', '안녕하세요 고객님 ^^ 문의 주셔서 감사합니다.', 399, { state: 'cancelled', fail_reason: 'cancelled:staff_desk' }), m('out', 'bot', '오래돼 취소된 봇 답', 398, { state: 'cancelled', fail_reason: 'cancelled:stale' }), m('out', 'staff_desk', '네, 곧 전화드리겠습니다.', 395), m('out', 'staff_desk', '긴 글의 첫 조각입니다.', 394, { state: 'sending' }), m('out', 'staff_desk', '긴 글의 둘째 조각입니다.', 394, { state: 'sending' })], { staff_name: '현승협', handled_at: iso(395), read_at: iso(395) }),
            T(10, '6060', 'closed', '효돈 · 10/6 발송 · 하우스감귤 4kg', [m('in', 'customer', '잘 받았습니다 맛있어요', 1500), m('out', 'gateway_other', '감사합니다. 맛있게 드세요.', 1490)], { order: ORD({ ship_date: '2026-10-06', status_label: '배송완료', arrive_text: '10/7(수) 도착' }), staff_name: '조가영', handled_at: iso(1490), read_at: iso(1490) }),
            T(11, '7007', 'staff_needed', '효돈 · 10/9 발송 · 하우스감귤 4kg × 2', [
                m('in', 'customer', '환불해 주세요. 상한 게 너무 많습니다.', 8), m('out', 'staff_desk', '확인하고 바로 연락드리겠습니다.', 6, { state: 'failed', fail_reason: 'sendSMS: Sending SMS message: uid 10283 does not have android.permission.SEND_SMS.' }),
            ], { order: ORD({ qty: 2, tracking_tail: '3306', status_label: '배송완료', arrive_text: '10/10(토) 도착', recipient_name: '김영희', recipient_initial: '김' }), staff_why: 'send_failed' }),
            T(12, '1001', 'bot_replied', null, [m('in', 'customer', '아주아주 긴 문의입니다. ' + '도착 시간과 보관 방법, 그리고 선물 포장이 되는지도 함께 알려주시면 좋겠습니다. '.repeat(4), 3), m('out', 'bot', '안내드릴게요. 발송 다음 날 도착하고, 서늘한 곳에 보관해 주세요.', 2, { state: 'queued' }), m('out', 'bot', '선물 포장은 선물용 상품에서만 됩니다.', 2, { state: 'queued' })], { bot_count_today: 1 }),
            T(13, '0114', 'ignored', null, [m('in', 'customer', '[Web발신] [KT안내] 요금제 이용안내', 50)]),   // 무시 대화 — 새 문자 목록·셈에는 안 들고 이전 대화 보기에만
        ],
    };
}
seed();

const lastOf = (t, dir) => t.messages.filter(x => x.direction === dir).pop() || null;
const WHY = { claim: '불만·클레임', account: '계좌·입금 문의', photo: '사진', ai_to_staff: 'AI 판단', ai_error: 'AI 오류', send_failed: '보내지 못함', staff: '직원 확인' };
const unreadOf = t => t.messages.filter(x => x.direction === 'in' && (!t.read_at || Date.parse(x.event_at) > Date.parse(t.read_at))).length;
const draftOf = t => t.draft_text || null;   // 실서버처럼 모드와 무관(자동 모드에서도 잠금·쿨다운 갈래는 초안이 남는다)
// 실서버 GET /threads/:id 의 order = sms_threads.order_json = orderHintOf() = { line, role, match, candidates, order:{ … } } — 칸은 한 겹 안에 있고 arrive_text 는 없다
const md5 = x => (x ? String(x).slice(5, 10).replace('-', '/') : '');
function orderJson(t) {
    if (t.order_raw) return t.order_raw;
    if (!t.order) return null;
    const { arrive_text, ...o } = t.order; o.boxes = o.boxes || (Number(o.qty) > 1 ? Number(o.qty) : 1); o.delivered = o.status_label === '배송완료';
    if (ST.noTrk) delete o.recipient_name;   // 옛 응답 = 이름 전체·전체 번호 없음(첫 글자만)
    if (!ST.noTrk && o.tracking_tail) o.trackings = Array.from({ length: o.boxes }, (_, i) => '59012345' + String(Number(o.tracking_tail) + i).padStart(4, '0'));   // #644 전체 번호(상자마다 하나)
    return { line: [o.partner, o.ship_date ? md5(o.ship_date) + ' 발송' : '', o.option_text, o.boxes > 1 ? o.boxes + '상자' : '', o.status_label].filter(Boolean).join(' · '), role: 'recipient', match: 'one', candidates: 1, order: o };
}
const isActive = t => t.status !== 'ignored' && unreadOf(t) > 0;
function row(t, peekUnread) {
    const li = lastOf(t, 'in'), lo = lastOf(t, 'out'), last = t.messages[t.messages.length - 1] || null;
    const base = { id: t.id, phone_tail: t.phone_tail, phone_masked: t.phone_masked, ...(ST.noFull ? {} : { phone_full: t.phone_full }),   // #624: /__mock/set { full:false } = phone_full 없는 옛 서버 응답
        customer_hint: t.customer_hint, status: t.status, last_in_text: li ? String(li.body || '').slice(0, 120) : '', last_in_at: li ? li.event_at : null, last_out_text: lo ? String(lo.body || '').slice(0, 120) : null, last_out_at: lo ? lo.event_at : null, has_image: t.messages.some(x => x.image_ids && x.image_ids.length), draft_text: draftOf(t), staff_name: t.staff_name, handled_at: t.handled_at, bot_count_today: t.bot_count_today, last_out_state: lo ? lo.state : null };
    if (ST.legacy) return base;   // #635 전 옛 서버 = 새 칸 없음
    return Object.assign(base, { unread: peekUnread === 0 ? 0 : unreadOf(t), needs_staff: !!t.staff_why && !['closed', 'ignored'].includes(t.status), staff_why: t.staff_why || null, staff_why_label: t.staff_why ? (WHY[t.staff_why] || '직원 확인') : null, done: !!t.done, done_by: t.done ? '시험직원' : null, done_at: t.done ? t.done_at : null,   /* #675 */ draft_kind: draftOf(t) ? 'ai' : null, staff_read_at: t.read_at || null, last_dir: last ? last.direction : null, last_at: last ? last.event_at : null });
}
const latest = t => Math.max(...t.messages.map(x => Date.parse(x.event_at)));
const isOpen = t => !['closed', 'ignored'].includes(t.status) && (isActive(t) || !!t.staff_why);
// #661-b 손님 연락 카드 응답(실서버 꼴): 채널별 전체 대화(최근순) · needs_reply = 대기 · counts.{ch}.open = 대기 수 · more = 못 실은 줄 수
function cuOf() {
    if (!ST.cu) { const r = (kind, id, min, o) => Object.assign({ kind, id, at: iso(min), last_at: iso(min), state: 'open', seen: false, done: false, unread: 0, can_send: true, last_dir: 'in' }, o, { wait0: !!o.needs_reply });
        ST.cu = { talk: [r('talk', 9101, 5, { tkey: 't-711a', title: '톡톡 손님 711a', sub: '하우스감귤 가정용', last_text: '오늘 주문하면 언제 받나요?', needs_reply: true }), r('talk', 9102, 50, { tkey: 't-22bc', title: '톡톡 손님 22bc', sub: '', last_text: '네 감사합니다 확인했어요', state: 'staff', last_dir: 'out' }), r('talk', 9103, 400, { tkey: 't-9f01', title: '톡톡 손님 9f01', sub: '황금향', last_text: '선물 포장 되나요', needs_reply: true })],
            qna: [r('qna', 7201, 30, { title: '황금향 가정용 3kg', sub: 'kim***', last_text: '당도가 어느 정도인가요?', needs_reply: true }), r('qna', 7202, 900, { title: '하우스감귤 4kg', sub: 'lee***', last_text: '안내드린 대로 내일 출고됩니다', state: 'ai', last_dir: 'out' })],
            inquiry: [r('inquiry', 8301, 120, { title: '미니밤호박 특품 5kg', sub: '박**', last_text: '주소 변경 부탁드려요', needs_reply: true })] }; }
    return ST.cu;
}
function deskInbox() {
    const cu = cuOf(), strip = x => { const o = Object.assign({}, x); delete o.wait0; return o; };
    const sms = ST.enabled === false && ST.noSmsCard ? null : ST.threads.filter(t => t.status !== 'ignored').map(t => Object.assign(row(t), { kind: 'sms', needs_reply: isOpen(t), done: false, last_text: String((t.messages[t.messages.length - 1] || {}).body || '').slice(0, 120) })).sort((a, b) => Date.parse(b.last_at) - Date.parse(a.last_at));
    const cnt = a => ({ open: a.filter(x => x.needs_reply).length, ai: 0, staff: 0 });
    return { days: 30, talk: cu.talk.map(strip), qna: cu.qna.map(strip), inquiry: cu.inquiry.map(strip), sms, counts: { talk: Object.assign(cnt(cu.talk), ST.cuMore ? { open: cnt(cu.talk).open + 4 } : {}), qna: cnt(cu.qna), inquiry: cnt(cu.inquiry), sms: sms ? { open: sms.filter(x => x.needs_reply).length } : null }, more: { sms: 0, talk: ST.cuMore ? 4 : 0, qna: 0, inquiry: 0 }, at: new Date().toISOString() };
}
function summary() {
    const c = {}; ['new', 'staff_needed', 'draft', 'bot_replied', 'staff_replied', 'closed', 'ignored'].forEach(k => { c[k] = ST.threads.filter(t => t.status === k).length; });
    const day = Date.now() - 86400000, all = ST.threads.flatMap(t => t.messages).filter(x => Date.parse(x.event_at) > day);
    const s = { enabled: ST.enabled, mode: ST.mode, staff_needed: c.staff_needed, drafts: ST.legacy ? c.draft : ST.threads.filter(t => draftOf(t) && !['closed', 'ignored'].includes(t.status)).length, today_in: all.filter(x => x.direction === 'in').length, today_bot: all.filter(x => x.sender === 'bot').length, today_staff: all.filter(x => /^staff/.test(x.sender)).length, gateway: { last_ping_at: ST.alive ? iso(0) : iso(190), alive: ST.alive } };
    if (!ST.legacy && !ST.noStaffOpen) s.staff_open = ST.threads.filter(t => t.staff_why && !['closed', 'ignored'].includes(t.status)).length;
    if (!ST.legacy && !ST.noDone) s.done_route = true;   // #675 [처리함] 라우트가 있는 서버
    if (!ST.legacy && !ST.noOpen) s.open_threads = ST.threads.filter(isOpen).length;   // #660 답 안 한 것(끝남·무시 아님 + 안 읽음 또는 사람 몫)
    if (!ST.legacy) { s.unread_threads = ST.threads.filter(isActive).length; s.needs_staff = ST.threads.filter(t => isActive(t) && t.staff_why).length; }
    if (ST.withCounts) s.counts = c;
    return s;
}
const send = (res, code, body, type) => { const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': buf.length }); res.end(buf); };
const readBody = req => new Promise(r => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => { try { r(s ? JSON.parse(s) : {}); } catch (e) { r({}); } }); });

// 화면이 뜰 만큼만 — 실서버 값이 아니다
const STUB = [
    [/^\/api\/agent-office\/desk\/status/, () => ({ ok: true, state: 'idle', online: true, engine: 'desk', busy: 0, queue: 0, others_busy: 0 })],
    [/^\/api\/agent-office\/desk\/orders/, () => ({ orders: [] })],
    [/^\/api\/agent-office\/desk\/board/, () => ({ channels: [{ ch: 'naver', today: 12, yesterday: 30 }, { ch: 'mall', today: 2, yesterday: 4 }, { ch: 'coupang', today: 1, yesterday: 3 }], ship: [], todo: [{ key: 'talk', label: '톡톡 미답변', count: 2, where: '문의 관리 > 톡톡' }, { key: 'botfail', label: '봇 실패', count: 3, talk: 2, sms: 1, where: '톡톡 2 · 문자 1' }], live: [], today: [], progress: [], is_admin: false })],
    [/^\/api\/agent-office\/desk\/inbox/, () => ({ talk: [], qna: [], inquiry: [], counts: { talk: 0, qna: 0, inquiry: 0 } })],
    [/^\/api\/version/, () => ({ version: 'mock-610' })],
];

http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname), M = req.method;
    try {
        if (p === '/__mock/log') return send(res, 200, { log: ST.log, typPosts: ST.typPosts || [], typGets: ST.typGets || 0, typing: ST.typing || [] });
        if (p === '/__mock/typing') { const b = await readBody(req); ST.typing = (ST.typing || []).filter(x => !(x.tid === Number(b.thread) && x.id === Number(b.id))); if (b.on !== false) ST.typing.push({ tid: Number(b.thread), id: Number(b.id), name: String(b.name || ''), at: Date.now() }); return send(res, 200, { ok: true }); }   // #683 다른 사람 입력 상태 끼워 넣기
        if (p === '/__mock/reset') { seed(); return send(res, 200, { ok: true }); }
        if (p === '/__mock/set') { const b = await readBody(req); if ('many' in b) ST.many = !!b.many; if ('noOpen' in b) ST.noOpen = !!b.noOpen; if ('noTyping' in b) ST.noTyping = !!b.noTyping; if ('typTtl' in b) ST.typTtl = Number(b.typTtl) || 0; if ('noDone' in b) ST.noDone = !!b.noDone; if ('cuMore' in b) ST.cuMore = !!b.cuMore; if (b.clearWhy) ST.threads.forEach(t => { t.staff_why = null; }); if ('alive' in b) ST.alive = !!b.alive; if ('mode' in b) ST.mode = b.mode; if ('enabled' in b) ST.enabled = !!b.enabled; if ('counts' in b) ST.withCounts = !!b.counts; if ('fail' in b) ST.fail = b.fail || ''; if ('full' in b) ST.noFull = !b.full; if ('legacy' in b) ST.legacy = !!b.legacy; if ('trk' in b) ST.noTrk = !b.trk; if ('staffOpen' in b) ST.noStaffOpen = !b.staffOpen; if ('history' in b) ST.noHistory = !b.history; return send(res, 200, { ok: true }); }
        if (p === '/__mock/draft') { const b = await readBody(req), t = ST.threads.find(x => x.id === Number(b.id)); if (!t) return send(res, 404, { error: 'no thread' }); t.draft_text = b.text ? String(b.text) : null; return send(res, 200, { ok: true }); }   // 봇 초안이 뒤늦게 생김
        if (p === '/__mock/push') { const b = await readBody(req), t = ST.threads.find(x => x.id === Number(b.id)); if (!t) return send(res, 404, { error: 'no thread' }); t.messages.push({ id: 7000 + t.messages.length + t.id * 10, direction: 'in', kind: 'sms', body: String(b.body || '또 보냅니다'), sender: 'customer', state: 'received', image_ids: [], event_at: new Date().toISOString() }); if (t.status === 'closed') t.status = 'new'; return send(res, 200, { ok: true }); }
        if (p.startsWith('/api/sms/')) {
            if (!/^Bearer .+/.test(req.headers.authorization || '')) return send(res, 401, { error: '로그인이 필요합니다' });
            let m;
            // #683 입력 중 표시(워커3 계약) — POST /api/sms/threads/:id/typing {on} → { ok, typing:[{id,name}] }(나를 뺀 그 대화) · GET /api/sms/typing → { ok, ttl_sec, threads:{id:[…]} }(나를 뺀 전체)
            //   누구인지 = 토큰 끝 글자(mock.token.u9 → 김대리 …) · 모르는 토큰은 시험직원(8). /__mock/set { noTyping:true } = 옛 서버(404) · { typTtl: 초 }
            const ME = ({ u9: { id: 9, name: '김대리' }, u7: { id: 7, name: '박주임' } })[String(req.headers.authorization || '').split('.').pop()] || { id: 8, name: '시험직원' };
            const typLive = tid => { const ttl = (ST.typTtl || 30) * 1000, now = Date.now(); ST.typing = (ST.typing || []).filter(x => now - x.at < ttl); return ST.typing.filter(x => (tid == null || x.tid === tid) && x.id !== ME.id); };
            if (M === 'GET' && p === '/api/sms/typing') { if (ST.noTyping || ST.legacy) return send(res, 404, { error: '없는 주소입니다' }); ST.typGets = (ST.typGets || 0) + 1; const th = {}; typLive(null).forEach(x => { (th[x.tid] = th[x.tid] || []).push({ id: x.id, name: x.name }); }); return send(res, 200, { ok: true, ttl_sec: ST.typTtl || 30, threads: th }); }
            if (M === 'POST' && (m = /^\/api\/sms\/threads\/(\d+)\/typing$/.exec(p))) {
                if (ST.noTyping || ST.legacy) return send(res, 404, { error: '없는 주소입니다' });
                const b = await readBody(req), tid = Number(m[1]); ST.typPosts = (ST.typPosts || []).concat({ at: Date.now(), tid, id: ME.id, on: !!b.on });
                ST.typing = (ST.typing || []).filter(x => !(x.tid === tid && x.id === ME.id)); if (b.on) ST.typing.push({ tid, id: ME.id, name: ME.name, at: Date.now() });
                return send(res, 200, { ok: true, typing: typLive(tid).map(x => ({ id: x.id, name: x.name })) });
            }
            if (M === 'GET' && p === '/api/sms/summary') return send(res, 200, summary());
            if (M === 'GET' && p === '/api/sms/threads') {
                const hasSt = !!u.searchParams.get('status'), st = u.searchParams.get('status') || 'all', q = (u.searchParams.get('q') || '').trim(), lim = Math.min(200, Number(u.searchParams.get('limit')) || 50);
                const scope = ST.legacy ? '' : (u.searchParams.get('scope') || (hasSt ? '' : 'active'));
                let list;
                if (hasSt && st !== 'all') list = ST.threads.filter(t => t.status === st);
                else if (q || scope === 'all') list = ST.threads.slice();
                else if (scope === 'active') list = ST.threads.filter(isActive);
                else if (scope === 'open' && !ST.noOpen) list = ST.threads.filter(isOpen);
                else if (scope === 'open') return send(res, 400, { ok: false, error: '범위 값이 틀려요' });   // 옛 서버
                else list = ST.threads.filter(t => t.status !== 'ignored');   // 종전 status=all · 옛 서버
                if (q) {   // 실서버와 같게: 숫자 3~4자리 = 끝자리 일치 · 5자리 이상 = 전체 번호 일치만 · 1~2자리 = 0건 · 글은 숫자를 뺀 글로
                    const dg = q.replace(/\D/g, ''), txt = q.replace(/\d/g, '').trim();
                    if (/^[\d\s-]+$/.test(q)) list = dg.length >= 5 ? list.filter(t => t.phone_full === dg) : dg.length >= 3 ? list.filter(t => t.phone_full.endsWith(dg)) : [];
                    else list = txt ? list.filter(t => t.messages.some(x => String(x.body || '').includes(txt))) : [];
                }
                list = list.slice().sort((a, b) => latest(b) - latest(a));
                const items = list.slice(0, lim).map(t => row(t));
                return send(res, 200, ST.legacy ? { items } : { scope: (hasSt && st !== 'all') ? 'status' : q ? 'all' : (scope || 'legacy'), items });
            }
            if (M === 'GET' && (m = /^\/api\/sms\/images\/(\d+)$/.exec(p))) { const s = IMAGES[m[1]]; return s ? send(res, 200, s, 'image/svg+xml') : send(res, 404, { error: '사진이 없습니다' }); }
            if ((m = /^\/api\/sms\/threads\/(\d+)(?:\/(reply|handled|send-draft|close|done))?$/.exec(p))) {
                const t = ST.threads.find(x => x.id === Number(m[1]));
                if (!t) return send(res, 404, { error: '대화를 찾지 못했습니다' });
                if (M === 'GET' && !m[2]) {
                    const peek = u.searchParams.get('peek') === '1';
                    if (!peek && !ST.legacy) t.read_at = new Date().toISOString();   // 여는 순간 읽음
                    const oj = orderJson(t), out = { thread: row(t, peek ? undefined : 0), messages: t.messages, order: oj };
                    if (!ST.noHistory && !ST.noTrk && !ST.legacy) {   // #654: 최근 60일 구매이력(발송 전 먼저 → 발송일 최신순) · order 와 같은 건이 맨 위쪽에 또 들어 있다
                        const first = oj && oj.order ? Object.assign({ role: oj.role || 'recipient' }, oj.order) : null; if (first) delete first.tracking_tail;
                        out.history = [].concat(first ? [first] : [], t.history_extra || []); out.history_days = 60; out.history_more = !!t.history_more;
                        if (ST.many) out.history = out.history.concat(Array.from({ length: 9 }, (_, i) => ({ pre: false, ship_date: '2026-08-' + String(20 - i).padStart(2, '0'), recipient_name: '홍길동', option_text: '하우스감귤 가정용 - 2.5kg(소과)', qty: 1, boxes: 1, trackings: ['5901234511' + String(i).padStart(2, '0')], status_label: '배송완료', status_text: '배송완료', delivered: true, partner: '효돈', role: 'recipient', boxes_detail: [{ tracking: '5901234511' + String(i).padStart(2, '0'), option_text: '하우스감귤 가정용 - 2.5kg(소과)', qty: 1, status_text: '배송완료', delivered: true }] })));   // #657 수십 건 손님(5건씩 더보기)
                    }
                    return send(res, 200, out);
                }
                if (M === 'POST' && m[2]) {
                    const b = await readBody(req);
                    ST.log.push({ at: Date.now(), path: p, action: m[2], id: t.id, body: b });
                    if (ST.fail === m[2]) return send(res, 500, { error: '회사폰에 보내지 못했습니다' });
                    if ((m[2] === 'reply' || m[2] === 'send-draft') && !ST.enabled) return send(res, 409, { ok: false, error: m[2] === 'reply' ? '문자 연동이 꺼져 있어요(설정 sms_gateway.enabled)' : '문자 연동이 꺼져 있어요' });
                    if (m[2] === 'send-draft' && !t.draft_text) return send(res, 409, { ok: false, error: '보낼 초안이 없어요(이미 보냈을 수 있어요)' });
                    if (m[2] === 'send-draft' && !ST.legacy && typeof b.seen === 'string' && String(t.draft_text || '') && b.seen.trim() !== String(t.draft_text).trim()) return send(res, 409, { ok: false, error: 'draft_changed', draft_text: t.draft_text });   // #635-C: 내가 본 초안과 다르면 보내지 않는다
                    if (m[2] === 'reply' || m[2] === 'send-draft') {
                        ST.typing = (ST.typing || []).filter(x => !(x.tid === t.id && x.id === ME.id));   // #683 보냄 = 내 입력 표시 지움
                        const text = m[2] === 'reply' ? String(b.text || '').trim() : String(t.draft_text || '');
                        if (!text) return send(res, 400, { error: '보낼 글이 없습니다' });
                        const msg = { id: 9000 + ST.log.length, direction: 'out', kind: 'sms', body: text, sender: 'staff_desk', state: 'queued', image_ids: [], event_at: new Date().toISOString() };
                        t.messages.push(msg); t.draft_text = null; t.status = 'staff_replied'; t.staff_name = '시험직원'; t.handled_at = msg.event_at; t.staff_why = null; t.read_at = msg.event_at;
                        return send(res, 200, { ok: true, message_id: msg.id });
                    }
                    if (m[2] === 'handled') { let cancelled = 0; t.messages.forEach(x => { if (x.direction === 'out' && x.state === 'queued') { x.state = 'cancelled'; x.fail_reason = 'cancelled:handled'; cancelled++; } }); t.status = 'staff_replied'; t._cancelled = cancelled; t.staff_name = '시험직원'; t.handled_at = new Date().toISOString(); t.staff_why = null; t.read_at = t.handled_at; return send(res, 200, { ok: true, cancelled: t._cancelled }); }
                    if (m[2] === 'done') {   // #675 계약(워커3): { undo? } → { ok, done, thread, open_threads, cancelled } · 사람 몫이 아니면 noop · 되돌릴 것이 없으면 409
                        if (ST.noDone || ST.legacy) return send(res, 404, { error: '없는 주소입니다' });
                        if (b.undo) { if (!t.done) return send(res, 409, { ok: false, error: '되돌릴 것이 없어요' }); t.done = false; t.staff_why = t._why; t.status = t._st; return send(res, 200, { ok: true, done: false, thread: row(t), open_threads: ST.threads.filter(isOpen).length, cancelled: 0 }); }
                        if (!t.staff_why || ['closed', 'ignored'].includes(t.status)) return send(res, 200, { ok: true, done: false, noop: true });
                        t._why = t.staff_why; t._st = t.status; t.staff_why = null; t.status = 'staff_replied'; t.done = true; t.done_at = new Date().toISOString(); t.read_at = t.done_at;
                        return send(res, 200, { ok: true, done: true, thread: row(t), open_threads: ST.threads.filter(isOpen).length, cancelled: 0 });
                    }
                    if (m[2] === 'close') { t.status = 'closed'; t.staff_why = null; t.read_at = new Date().toISOString(); return send(res, 200, { ok: true }); }
                }
            }
            return send(res, 404, { error: '없는 주소입니다' });
        }
        if (p === '/api/agent-office/desk/inbox' && M === 'GET') return send(res, 200, deskInbox());
        if (p === '/api/agent-office/desk/inbox/review' && M === 'POST') { const b = await readBody(req); const x = (cuOf()[b.kind] || []).find(r => String(r.id) === String(b.id)); if (!x) return send(res, 404, { error: '없는 문의입니다' }); x.done = x.seen = !b.undo; x.needs_reply = b.undo ? !!x.wait0 : false; ST.log.push({ at: Date.now(), path: p, action: b.undo ? 'review-undo' : 'review', kind: b.kind, id: b.id }); return send(res, 200, { ok: true, message: b.undo ? '다시 대기로 돌렸어요' : '확인했습니다' }); }
        if (p.startsWith('/api/inbox/')) return send(res, 404, { error: '없는 주소입니다' });   // #658 뒤: 이 가짜 서버는 문자만(빈 200 을 주면 화면이 톡톡·문의 창이 있는 서버로 안다)
        if (p.startsWith('/api/')) {
            const hit = STUB.find(([re]) => re.test(p));
            if (M !== 'GET') { ST.log.push({ at: Date.now(), path: p, action: 'other-write' }); return send(res, 200, { ok: true }); }
            return send(res, 200, hit ? hit[1]() : (/s$|list|logs|items|history|pricing/.test(p) ? [] : {}));
        }
        let file = path.join(PUB, p === '/' ? 'index.html' : p);
        if (!file.startsWith(PUB)) return send(res, 403, 'no', 'text/plain');
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
        return send(res, 200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    } catch (e) { send(res, 500, { error: String(e && e.message || e) }); }
}).listen(PORT, () => console.log('mock-610 listening on ' + PORT));
