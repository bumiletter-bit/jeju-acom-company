// #1110 문의 관리 정리 시공용 가짜 서버 — DB·외부 호출 0 · 메모리 안 지어낸 자료 · 앱 전체(public/ · 공통 CSS 전부) 그대로 제공
//   사용: node scripts/_mock-1110.js [포트=3458] [--pre=<옛 app.js 경로>,<옛 index.html 경로>]   (verify-1110-ui.js 가 스스로 띄운다)
//   · /api/auth/me = /__mock/user 로 정한 계정(직원·대표·세무사) · 문의 관리가 부르는 API 는 지어낸 자료 · 그 밖 GET = {} · 쓰기 = { ok:true }
//   · GET /__mock/log = 받은 쓰기 요청 · POST /__mock/user { role, position, name } · POST /__mock/reset
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const PORT = Number(process.argv[2] || process.env.PORT1110 || 3458);
const preArg = (process.argv.find(a => a.startsWith('--pre=')) || '').slice(6).split(',').filter(Boolean);
const OVERRIDE = preArg.length >= 2 ? Object.assign({ '/app.js': preArg[0], '/index.html': preArg[1], '/': preArg[1] }, preArg[2] ? { '/styles.css': preArg[2] } : {}) : {};   // 셋째 = 옛 styles.css(선택)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const md = d => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return md(d); };

let ST;
function seed() {
    ST = {
        user: { id: 1, username: 'owner', name: '전승범', role: 'admin', position: '대표' },
        log: [], gets: [], auto_reply: 'on', qna_auto: true, inq_auto: false,
        rv: { stats: 'ok', next: 'ok', used: 3, cap: 100, delay: 0 },   // #1110-4 응대 현황: stats = ok|404|500 · next = 다음 미리보기 응답 꼴
        notis: [],
        scenarios: [
            { id: 11, scenario_no: 2, name: '상품 파손/불량', keywords: ['파손', '불량'], response: '불편드려 죄송합니다.\n📸 사진 찍어 보내주시면 빠른 처리 도와드리겠습니다', action: '자동응답', channel: '공통', enabled: true },
            { id: 12, scenario_no: 16, name: '사이즈 지정(감귤·만감류 전용)', keywords: ['사이즈', '과수'], response: '사이즈(2S·S·M) 지정은 가정용 귤 로얄과만 가능해요', action: '자동응답', channel: '톡톡', enabled: true },
            { id: 13, scenario_no: 9, name: '감귤 체험장 안내', keywords: ['체험'], response: '체험장은 11월 1일부터 운영해요. 포토존과 전망대가 있어요.', action: '자동응답', channel: '공통', enabled: true },
            { id: 14, scenario_no: 61, name: '송장번호·배송조회 안내', keywords: ['송장'], response: '네이버 마이페이지 → 주문내역 → 배송조회', action: '자동응답', channel: '톡톡', enabled: false },
        ],
        season: [
            { id: 1, item_key: '타이벡감귤', label: '초기', start_md: day(-60), end_md: day(-20), knowledge: '초반이라 산미가 조금 있어요', sort: 1, sell_match: null, sell_rule: null },
            { id: 2, item_key: '노지감귤', label: '중기', start_md: day(-3), end_md: day(20), knowledge: '지금이 당도가 올라오는 시기예요', sort: 2, sell_match: '노지감귤', sell_rule: 'only_when_selling', sell_now: { match: 2, hidden: false } },
            { id: 3, item_key: '황금향', label: '시즌 전체', start_md: day(-1), end_md: day(1), knowledge: '노랗게 잘 익어 과즙 많고 향 좋은 순한 단맛', sort: 3, sell_match: null, sell_rule: null },
            { id: 4, item_key: '한라봉', label: '초기', start_md: day(30), end_md: day(90), knowledge: '12월부터 출하 예정', sort: 4, sell_match: null, sell_rule: null },
        ],
        products: [
            { id: 1, name: '제철 고당도 타이벡감귤 / 가정용 3kg(로얄과)', status: '판매중', price: '19,800원', shipping_guide: '서늘한 곳에 보관', reserve_ship_start: null, deletable: false, naver_product_no: '6400134206' },
            { id: 2, name: '제철 고당도 타이벡감귤 / 가정용 5kg(로얄과)', status: '판매중', price: '26,800원', shipping_guide: '', reserve_ship_start: null, deletable: false },
            { id: 3, name: '제철 고당도 타이벡감귤 / 선물용 3kg', status: '품절', price: '28,800원', shipping_guide: '', reserve_ship_start: null, deletable: false },
            { id: 4, name: '과즙팡팡 황금향 / 노지 5kg', status: '판매중', price: '30,100원', shipping_guide: '냉장 보관', reserve_ship_start: null, deletable: false },
            { id: 5, name: '최상품 청귤(풋귤) 10kg', status: '시즌종료', price: '45,000원', shipping_guide: '', reserve_ship_start: null, deletable: true },
            { id: 6, name: '제주산 레드키위 3kg', status: '시즌종료', price: '33,800원', shipping_guide: '', reserve_ship_start: null, deletable: false },
            { id: 7, name: '그린레몬 / 5kg(중소과)', status: '시즌종료', price: '50,000원', shipping_guide: '', reserve_ship_start: null, deletable: false },
        ],
    };
}
seed();
const json = (res, code, o) => { const b = Buffer.from(JSON.stringify(o)); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' }); res.end(b); };
const readBody = req => new Promise(r => { let s = ''; req.on('data', d => s += d); req.on('end', () => { try { r(s ? JSON.parse(s) : {}); } catch (e) { r({}); } }); });

http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname, M = req.method;
    if (p === '/__mock/log') return json(res, 200, { log: ST.log, user: ST.user, gets: ST.gets });
    if (p === '/__mock/set' && M === 'POST') { const b = await readBody(req); if (b.rv) Object.assign(ST.rv, b.rv); if (Array.isArray(b.notis)) ST.notis = b.notis; return json(res, 200, { ok: true }); }
    if (p === '/__mock/reset') { seed(); return json(res, 200, { ok: true }); }
    if (p === '/__mock/user' && M === 'POST') { const b = await readBody(req); ST.user = Object.assign({ id: 7, username: 'u', name: '시험', role: 'user', position: '사원' }, b); return json(res, 200, { ok: true, user: ST.user }); }
    if (p.startsWith('/api/')) {
        const body = M === 'GET' ? null : await readBody(req);
        if (M !== 'GET') ST.log.push({ m: M, p, body }); else ST.gets.push(p);
        const ownerOnly = () => ST.user.role === 'admin' && ST.user.position === '대표';
        if (p === '/api/auth/me') return json(res, 200, ST.user);
        // #1110-4 응대 현황
        if (p === '/api/agent-office/response-stats' && M === 'GET') {
            if (ST.rv.stats === '404') return json(res, 404, { error: 'not found' });
            if (ST.rv.stats === '500') return json(res, 500, { ok: false, error: '처리하지 못했어요' });
            const d30 = u.searchParams.get('days') === '30';
            const ch = d30 ? { talk: { total: 200, bot: 80, staff: 100, open: 20 }, qna: { total: 60, bot: 50, staff: 10, open: 0 }, inquiry: { total: 0, bot: 0, staff: 0, open: 0 }, sms: { total: 90, bot: 3, staff: 80, open: 7 } }
                : { talk: { total: 50, bot: 20, staff: 25, open: 5 }, qna: { total: 40, bot: 33, staff: 7, open: 0 }, inquiry: { total: 0, bot: 0, staff: 0, open: 0 }, sms: null };
            const all = { total: 0, bot: 0, staff: 0, open: 0 }; for (const k in ch) if (ch[k]) for (const f in all) all[f] += ch[k][f];
            return json(res, 200, { ok: true, days: d30 ? 30 : 7, from: '2026-11-05', to: '2026-11-11', channels: ch, all,
                settings: { auto_reply: ST.auto_reply !== 'off', qna_auto_post: ST.qna_auto, inquiry_auto_post: ST.inq_auto, sms_mode: 'draft', talk_once_until_hour: 9 },
                materials: { scenarios: ST.scenarios.length, season: ST.season.length, season_today: 2 }, preview: { left_today: ST.rv.cap - ST.rv.used, cap: ST.rv.cap } });
        }
        if (p === '/api/agent-office/response-preview' && M === 'POST') {
            const kind = ST.rv.next; ST.rv.next = 'ok';
            if (ST.rv.delay) await new Promise(r => setTimeout(r, ST.rv.delay));
            const left = () => ({ left_today: Math.max(0, ST.rv.cap - ST.rv.used), cap: ST.rv.cap });
            if (kind === '404') return json(res, 404, { error: 'not found' });
            if (kind === 'day_cap') return json(res, 429, Object.assign({ ok: false, code: 'day_cap', error: '오늘 미리보기(100번)를 다 썼어요 — 내일 다시 물어봐 주세요', channel: body.channel }, { left_today: 0, cap: ST.rv.cap }));
            if (kind === 'bot_old') return json(res, 502, Object.assign({ ok: false, code: 'bot_old', error: '톡톡 미리보기는 준비 중이에요(톡톡봇이 아직 지원하지 않아요)', channel: body.channel }, left()));
            if (kind === 'err') return json(res, 502, Object.assign({ ok: false, code: 'ai_error', error: '답을 만들지 못했어요(AI 오류) — 잠시 뒤 다시 물어봐 주세요', channel: body.channel }, left()));
            ST.rv.used++;
            if (kind === 'skip') return json(res, 200, Object.assign({ ok: true, channel: body.channel, skip: true, why: 'no_material', why_text: '봇이 답하지 않고 넘겨요(재료로 답할 수 없거나 확신 없음) → 실제로는 직원 몫', ms: 900 }, left()));
            if (kind === 'price') return json(res, 200, Object.assign({ ok: true, channel: body.channel, skip: false, answer: '🍊 타이벡감귤 가정용 3kg — 19,800원', source: 'price_direct', scenario_nos: ['2'], scenario_names: ['상품 파손/불량'], ms: 40 }, left()));
            if (kind === 'smsrule') return json(res, 200, Object.assign({ ok: true, channel: body.channel, skip: false, answer: '고객님, 불편드려 죄송합니다.', source: 'sms_rule', scenario_nos: [], scenario_names: [], note: '불만 글은 AI 없이 정해 둔 <b>사과</b> 초안이 먼저예요', ms: 3 }, left()));
            if (kind === 'two') return json(res, 200, Object.assign({ ok: true, channel: body.channel, skip: false, answer: '네 고객님 <b>굵게</b> 아님 & 그대로' + String.fromCharCode(10) + '둘째 줄', source: 'ai', scenario_nos: ['16', '99'], scenario_names: ['사이즈 지정(감귤·만감류 전용)', '없는 시나리오'], ms: 5300 }, left()));
            return json(res, 200, Object.assign({ ok: true, channel: body.channel, skip: false, answer: '[' + body.channel + '] ' + String(body.text).slice(0, 40) + ' 에 대한 답이에요.', source: 'ai', scenario_nos: ['16'], scenario_names: ['사이즈 지정(감귤·만감류 전용)'], ms: 2100 }, left()));
        }
        if (p === '/api/notifications' && M === 'GET') return json(res, 200, ST.notis);
        if (p === '/api/notifications/unread-count') return json(res, 200, { count: ST.notis.filter(n => !n.isRead).length });
        if (p === '/api/agent-office/scenarios' && M === 'GET') return json(res, 200, { scenarios: ST.scenarios, auto_reply: ST.auto_reply });
        if (p === '/api/agent-office/scenarios-auto-reply' && M === 'PUT') { if (!ownerOnly()) return json(res, 403, { error: '대표만' }); ST.auto_reply = body.value; return json(res, 200, { ok: true }); }
        let m;
        if ((m = p.match(/^\/api\/agent-office\/scenarios\/(\d+)$/)) && M === 'PUT') { const s = ST.scenarios.find(x => x.id === Number(m[1])); if (s) Object.assign(s, body); return json(res, 200, { ok: true }); }
        if (p === '/api/agent-office/season-knowledge' && M === 'GET') return json(res, 200, { rows: ST.season });
        if ((m = p.match(/^\/api\/agent-office\/season-knowledge\/(\d+)$/)) && M === 'PUT') { const s = ST.season.find(x => x.id === Number(m[1])); if (s) Object.assign(s, body); return json(res, 200, { ok: true }); }
        if (p === '/api/agent-office/bot-products' && M === 'GET') return json(res, 200, { products: ST.products });
        if ((m = p.match(/^\/api\/agent-office\/bot-products\/(\d+)$/)) && M === 'PUT') { const s = ST.products.find(x => x.id === Number(m[1])); if (s) Object.assign(s, body); return json(res, 200, { ok: true }); }
        if (p === '/api/agent-office/naver/qnas' && M === 'GET') return json(res, 200, { ok: true, auto_post: ST.qna_auto, rows: [] });
        if (p === '/api/agent-office/naver/inquiries' && M === 'GET') return json(res, 200, { ok: true, auto_post: ST.inq_auto, rows: [] });
        if (p === '/api/agent-office/naver/qna-auto-post' && M === 'PUT') { if (!ownerOnly()) return json(res, 403, { error: '대표만' }); ST.qna_auto = !!body.enabled; return json(res, 200, { ok: true, auto_post: ST.qna_auto }); }
        if (p === '/api/agent-office/naver/inquiry-auto-post' && M === 'PUT') { if (!ownerOnly()) return json(res, 403, { error: '대표만' }); ST.inq_auto = !!body.enabled; return json(res, 200, { ok: true, auto_post: ST.inq_auto }); }
        if (p === '/api/agent-office/notify-logs') return json(res, 200, { rows: [], summary: {}, total: 0, offset: 0, limit: 100, default_days: 0 });
        if (p === '/api/agent-office/season-waitlist' && M === 'GET') return json(res, 200, { rows: [], items: [] });
        if (p === '/api/agent-office/shipping-holidays' && M === 'GET') return json(res, 200, { rows: [], holidays: [] });
        if (p === '/api/agent-office/reward-grants' && M === 'GET') return json(res, 200, { rows: [], pending: 0 });
        if (M === 'GET' && ['/api/schedules', '/api/rankings', '/api/keyword', '/api/settlements', '/api/prepayments'].some(x => p.startsWith(x))) return json(res, 200, []);   // 목록을 배열로 받는 화면(일정·순위)이 빈 객체에 넘어지지 않게
        return json(res, 200, M === 'GET' ? {} : { ok: true });
    }
    let file = OVERRIDE[p] || path.join(PUB, p === '/' ? 'index.html' : decodeURIComponent(p));
    if (!OVERRIDE[p] && !path.resolve(file).startsWith(path.resolve(PUB))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, buf) => {
        if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(buf);
    });
}).listen(PORT, () => console.log('mock-1110 on ' + PORT + (preArg.length === 2 ? ' (옛 판)' : '')));
