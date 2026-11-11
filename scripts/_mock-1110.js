// #1110 문의 관리 정리 시공용 가짜 서버 — DB·외부 호출 0 · 메모리 안 지어낸 자료 · 앱 전체(public/ · 공통 CSS 전부) 그대로 제공
//   사용: node scripts/_mock-1110.js [포트=3458] [--pre=<옛 app.js 경로>,<옛 index.html 경로>]   (verify-1110-ui.js 가 스스로 띄운다)
//   · /api/auth/me = /__mock/user 로 정한 계정(직원·대표·세무사) · 문의 관리가 부르는 API 는 지어낸 자료 · 그 밖 GET = {} · 쓰기 = { ok:true }
//   · GET /__mock/log = 받은 쓰기 요청 · POST /__mock/user { role, position, name } · POST /__mock/reset
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const PORT = Number(process.argv[2] || process.env.PORT1110 || 3458);
const preArg = (process.argv.find(a => a.startsWith('--pre=')) || '').slice(6).split(',').filter(Boolean);
const OVERRIDE = preArg.length === 2 ? { '/app.js': preArg[0], '/index.html': preArg[1], '/': preArg[1] } : {};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const md = d => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return md(d); };

let ST;
function seed() {
    ST = {
        user: { id: 1, username: 'owner', name: '전승범', role: 'admin', position: '대표' },
        log: [], auto_reply: 'on', qna_auto: true, inq_auto: false,
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
    if (p === '/__mock/log') return json(res, 200, { log: ST.log, user: ST.user });
    if (p === '/__mock/reset') { seed(); return json(res, 200, { ok: true }); }
    if (p === '/__mock/user' && M === 'POST') { const b = await readBody(req); ST.user = Object.assign({ id: 7, username: 'u', name: '시험', role: 'user', position: '사원' }, b); return json(res, 200, { ok: true, user: ST.user }); }
    if (p.startsWith('/api/')) {
        const body = M === 'GET' ? null : await readBody(req);
        if (M !== 'GET') ST.log.push({ m: M, p, body });
        const ownerOnly = () => ST.user.role === 'admin' && ST.user.position === '대표';
        if (p === '/api/auth/me') return json(res, 200, ST.user);
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
        return json(res, 200, M === 'GET' ? {} : { ok: true });
    }
    let file = OVERRIDE[p] || path.join(PUB, p === '/' ? 'index.html' : decodeURIComponent(p));
    if (!OVERRIDE[p] && !path.resolve(file).startsWith(path.resolve(PUB))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, buf) => {
        if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(buf);
    });
}).listen(PORT, () => console.log('mock-1110 on ' + PORT + (preArg.length === 2 ? ' (옛 판)' : '')));
