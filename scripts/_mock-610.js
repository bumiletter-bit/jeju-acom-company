// #610-E 에이전트 오피스 「문자」 카드 시공용 가짜 서버 — DB·외부 호출 0 · 메모리 안 고정 자료 12건
//   사용: node scripts/_mock-610.js [포트=3461]   (verify-610-ui.js 가 스스로 띄운다)
//   ① /api/sms/* = 총괄 확정 계약 그대로(GET summary · threads · threads/:id · images/:id / POST reply · handled · send-draft · close)
//   ② 화면 파일 = public/ 그대로 · 그 밖의 /api 는 화면이 뜰 만큼만 빈 값(실서버 아님)
//   ③ 시험용: GET /__mock/log(받은 쓰기 목록) · POST /__mock/reset · POST /__mock/set { alive, mode, enabled, counts:false(=summary 에서 counts 빼기), fail:'reply'|'' }
//   🔵 계약에 없는데 넣어 둔 제안 필드: summary.counts{상태별 대화 수} (없어도 화면은 목록으로 센다)
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
    const T = (id, tail, status, hint, msgs, o) => ({ id, phone_tail: tail, phone_masked: '010****' + tail, customer_hint: hint, status, staff_name: null, handled_at: null, bot_count_today: 0, draft_text: null, order: null, messages: msgs, ...(o || {}) });
    const ORD = (o) => Object.assign({ ship_date: '2026-10-09', partner: '효돈', option_text: '하우스감귤 가정용 - 4kg(로얄과)', qty: 1, tracking_tail: '4821', status_label: '배송출발', arrive_text: '오늘 도착 예정' }, o || {});
    ST = {
        enabled: true, mode: 'draft', alive: true, last_ping_at: iso(1), withCounts: true, fail: '', log: [],
        threads: [
            T(1, '1234', 'staff_needed', '효돈 · 10/9 발송 · 하우스감귤 4kg', [
                m('in', 'customer', '귤 받았는데요', 62), m('in', 'customer', '', 61, { kind: 'mms', image_ids: [901, 902] }),
                m('in', 'customer', '몇 개가 터져서 왔어요. 어떻게 하면 되나요?', 60),
            ], { order: ORD({ status_label: '배송완료', arrive_text: '10/10(토) 도착' }), draft_text: '부패과가 나왔군요, 불편드려 죄송합니다. 괜찮은 상품 드셔보시고 입맛에도 안 맞으시면 무료 수거 및 반품처리도 가능합니다.' }),
            T(2, '5678', 'staff_needed', null, [m('in', 'customer', '안녕하세요 단체 주문 견적 문의드립니다. 50박스 가능한가요?', 44)]),
            T(3, '2468', 'staff_needed', '대성 · 10/8 발송 · 황금향 3kg', [
                m('in', 'customer', '황금향 언제 오나요', 190), m('out', 'bot', '10/8(목)에 출발했어요. 송장 끝 7730, 오늘 도착 예정입니다.', 189),
                m('in', 'customer', '아직도 안 왔는데요 확인 좀 해주세요', 25),
            ], { order: ORD({ ship_date: '2026-10-08', partner: '대성', option_text: '황금향 가정용 3kg', tracking_tail: '7730', status_label: '간선상하차', arrive_text: '내일 도착 예정' }), bot_count_today: 1 }),
            T(4, '1357', 'bot_replied', '효돈 · 10/9 발송 · 하우스감귤 2.5kg(소과)', [
                m('in', 'customer', '오늘 주문하면 언제 발송되나요?', 95), m('out', 'bot', '오늘 8시 이후 주문은 내일 오전에 발송돼요. 보통 발송 다음 날 도착합니다.', 94),
            ], { order: ORD({ option_text: '하우스감귤 가정용 - 2.5kg(소과)' }), bot_count_today: 1 }),
            T(5, '9090', 'bot_replied', null, [m('in', 'customer', '귤 보관은 어떻게 해요?', 130), m('out', 'bot', '서늘하고 바람이 통하는 곳에 두시고, 오래 두실 때는 냉장 보관을 권해요.', 129)], { bot_count_today: 1 }),
            T(6, '3141', 'cooldown', '효돈 · 10/9 발송 · 하우스감귤 4kg', [
                m('in', 'customer', '송장번호 알려주세요', 20), m('out', 'bot', '송장 끝 5592 로 10/9(금)에 출발했어요.', 19), m('in', 'customer', '네 감사합니다', 18),
            ], { order: ORD({ tracking_tail: '5592' }), bot_count_today: 1 }),
            T(7, '2718', 'cooldown', null, [m('in', 'customer', '가격표 좀 보내주세요', 12), m('out', 'bot', '지금 판매 중인 상품과 가격은 스마트스토어에서 보실 수 있어요.', 11)], { bot_count_today: 1 }),
            T(8, '4444', 'staff_replied', '대성 · 10/7 발송 · 한라봉 3kg', [
                m('in', 'customer', '', 300, { kind: 'mms', image_ids: [903] }), m('in', 'customer', '크기가 저번보다 작아요', 299),
                m('out', 'staff_phone', '크기가 작았군요, 불편드려 죄송합니다. 사진 확인했어요. 다음 주문 때 배송메세지에 사이즈를 적어 주시면 맞춰 보내드릴게요.', 280),
            ], { order: ORD({ ship_date: '2026-10-07', partner: '대성', option_text: '한라봉 가정용 3kg', tracking_tail: '1180', status_label: '배송완료', arrive_text: '10/8(목) 도착' }), staff_name: '조가영', handled_at: iso(280) }),
            T(9, '8282', 'staff_replied', null, [m('in', 'customer', '전화 부탁드려요', 400), m('out', 'staff_desk', '네, 곧 전화드리겠습니다.', 395)], { staff_name: '현승협', handled_at: iso(395) }),
            T(10, '6060', 'closed', '효돈 · 10/6 발송 · 하우스감귤 4kg', [m('in', 'customer', '잘 받았습니다 맛있어요', 1500), m('out', 'staff_phone', '감사합니다. 맛있게 드세요.', 1490)], { order: ORD({ ship_date: '2026-10-06', status_label: '배송완료', arrive_text: '10/7(수) 도착' }), staff_name: '조가영', handled_at: iso(1490) }),
            T(11, '7007', 'staff_needed', '효돈 · 10/9 발송 · 하우스감귤 4kg × 2', [
                m('in', 'customer', '환불해 주세요. 상한 게 너무 많습니다.', 8), m('out', 'staff_desk', '확인하고 바로 연락드리겠습니다.', 6, { state: 'failed' }),
            ], { order: ORD({ qty: 2, tracking_tail: '3306', status_label: '배송완료', arrive_text: '10/10(토) 도착' }) }),
            T(12, '1001', 'bot_replied', null, [m('in', 'customer', '아주아주 긴 문의입니다. ' + '도착 시간과 보관 방법, 그리고 선물 포장이 되는지도 함께 알려주시면 좋겠습니다. '.repeat(4), 3), m('out', 'bot', '안내드릴게요. 발송 다음 날 도착하고, 서늘한 곳에 보관해 주세요. 선물 포장은 선물용 상품에서만 됩니다.', 2, { state: 'queued' })], { bot_count_today: 1 }),
        ],
    };
}
seed();

const lastOf = (t, dir) => t.messages.filter(x => x.direction === dir).pop() || null;
function row(t) {
    const li = lastOf(t, 'in'), lo = lastOf(t, 'out');
    return { id: t.id, phone_tail: t.phone_tail, phone_masked: t.phone_masked, customer_hint: t.customer_hint, status: t.status, last_in_text: li ? String(li.body || '').slice(0, 120) : '', last_in_at: li ? li.event_at : null, last_out_text: lo ? String(lo.body || '').slice(0, 120) : null, last_out_at: lo ? lo.event_at : null, has_image: t.messages.some(x => x.image_ids && x.image_ids.length), draft_text: ST.mode === 'draft' ? t.draft_text : null, staff_name: t.staff_name, handled_at: t.handled_at, bot_count_today: t.bot_count_today };
}
const latest = t => Math.max(...t.messages.map(x => Date.parse(x.event_at)));
function summary() {
    const c = {}; ['staff_needed', 'bot_replied', 'cooldown', 'staff_replied', 'closed'].forEach(k => { c[k] = ST.threads.filter(t => t.status === k).length; });
    const day = Date.now() - 86400000, all = ST.threads.flatMap(t => t.messages).filter(x => Date.parse(x.event_at) > day);
    const s = { enabled: ST.enabled, mode: ST.mode, staff_needed: c.staff_needed, today_in: all.filter(x => x.direction === 'in').length, today_bot: all.filter(x => x.sender === 'bot').length, today_staff: all.filter(x => /^staff/.test(x.sender)).length, gateway: { last_ping_at: ST.alive ? iso(0) : iso(190), alive: ST.alive } };
    if (ST.withCounts) s.counts = c;
    return s;
}
const send = (res, code, body, type) => { const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': buf.length }); res.end(buf); };
const readBody = req => new Promise(r => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => { try { r(s ? JSON.parse(s) : {}); } catch (e) { r({}); } }); });

// 화면이 뜰 만큼만 — 실서버 값이 아니다
const STUB = [
    [/^\/api\/agent-office\/desk\/status/, () => ({ ok: true, state: 'idle', online: true, engine: 'desk', busy: 0, queue: 0, others_busy: 0 })],
    [/^\/api\/agent-office\/desk\/orders/, () => ({ orders: [] })],
    [/^\/api\/agent-office\/desk\/board/, () => ({ channels: [{ ch: 'naver', today: 12, yesterday: 30 }, { ch: 'mall', today: 2, yesterday: 4 }, { ch: 'coupang', today: 1, yesterday: 3 }], ship: [], todo: [{ key: 'talk', label: '톡톡 미답변', count: 2, where: '문의 관리 > 톡톡' }], live: [], today: [], progress: [], is_admin: false })],
    [/^\/api\/agent-office\/desk\/inbox/, () => ({ talk: [], qna: [], inquiry: [], counts: { talk: 0, qna: 0, inquiry: 0 } })],
    [/^\/api\/version/, () => ({ version: 'mock-610' })],
];

http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname), M = req.method;
    try {
        if (p === '/__mock/log') return send(res, 200, { log: ST.log });
        if (p === '/__mock/reset') { seed(); return send(res, 200, { ok: true }); }
        if (p === '/__mock/set') { const b = await readBody(req); if ('alive' in b) ST.alive = !!b.alive; if ('mode' in b) ST.mode = b.mode; if ('enabled' in b) ST.enabled = !!b.enabled; if ('counts' in b) ST.withCounts = !!b.counts; if ('fail' in b) ST.fail = b.fail || ''; return send(res, 200, { ok: true }); }
        if (p.startsWith('/api/sms/')) {
            if (!/^Bearer .+/.test(req.headers.authorization || '')) return send(res, 401, { error: '로그인이 필요합니다' });
            let m;
            if (M === 'GET' && p === '/api/sms/summary') return send(res, 200, summary());
            if (M === 'GET' && p === '/api/sms/threads') {
                const st = u.searchParams.get('status') || 'all', q = (u.searchParams.get('q') || '').trim(), lim = Math.min(200, Number(u.searchParams.get('limit')) || 50);
                let list = ST.threads.filter(t => st === 'all' || t.status === st);
                if (q) list = list.filter(t => t.phone_tail.includes(q) || t.messages.some(x => String(x.body || '').includes(q)) || String(t.customer_hint || '').includes(q));
                list = list.slice().sort((a, b) => (b.status === 'staff_needed') - (a.status === 'staff_needed') || latest(b) - latest(a));
                return send(res, 200, { items: list.slice(0, lim).map(row) });
            }
            if (M === 'GET' && (m = /^\/api\/sms\/images\/(\d+)$/.exec(p))) { const s = IMAGES[m[1]]; return s ? send(res, 200, s, 'image/svg+xml') : send(res, 404, { error: '사진이 없습니다' }); }
            if ((m = /^\/api\/sms\/threads\/(\d+)(?:\/(reply|handled|send-draft|close))?$/.exec(p))) {
                const t = ST.threads.find(x => x.id === Number(m[1]));
                if (!t) return send(res, 404, { error: '대화를 찾지 못했습니다' });
                if (M === 'GET' && !m[2]) return send(res, 200, { thread: row(t), messages: t.messages, order: t.order });
                if (M === 'POST' && m[2]) {
                    const b = await readBody(req);
                    ST.log.push({ at: Date.now(), path: p, action: m[2], id: t.id, body: b });
                    if (ST.fail === m[2]) return send(res, 500, { error: '회사폰에 보내지 못했습니다' });
                    if (m[2] === 'reply' || m[2] === 'send-draft') {
                        const text = m[2] === 'reply' ? String(b.text || '').trim() : String(t.draft_text || '');
                        if (!text) return send(res, 400, { error: '보낼 글이 없습니다' });
                        const msg = { id: 9000 + ST.log.length, direction: 'out', kind: 'sms', body: text, sender: m[2] === 'reply' ? 'staff_desk' : 'bot', state: 'queued', image_ids: [], event_at: new Date().toISOString() };
                        t.messages.push(msg); t.draft_text = null; t.status = m[2] === 'reply' ? 'staff_replied' : 'bot_replied';
                        if (m[2] === 'reply') { t.staff_name = '시험직원'; t.handled_at = msg.event_at; }
                        return send(res, 200, { ok: true, message_id: msg.id });
                    }
                    if (m[2] === 'handled') { t.status = 'staff_replied'; t.staff_name = '시험직원'; t.handled_at = new Date().toISOString(); return send(res, 200, { ok: true }); }
                    if (m[2] === 'close') { t.status = 'closed'; return send(res, 200, { ok: true }); }
                }
            }
            return send(res, 404, { error: '없는 주소입니다' });
        }
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
