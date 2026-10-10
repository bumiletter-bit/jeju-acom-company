// #612 에이전트 오피스 「전체 가격 확인하기」 카드 시공용 가짜 서버 — DB·외부 호출 0
//   사용: node scripts/_mock-612.js [포트=3465]   (verify-612-ui.js 가 스스로 띄운다) · node scripts/_mock-612.js --print = 보고 요약만 찍고 끝
//   ① 보고는 **실제 모듈 price-check.js build()** 에 가짜 스냅샷·가짜 자사몰을 넣어 만든다(모양이 실서버와 같다 · pool 없음)
//      GET /api/price-check[?refresh=1] · GET /api/price-check/pages { ok, pages, config, tiers, defaults } · POST /api/price-check/pages(통째로 갈아 끼움 · 키 naver:|cafe24: 만 · server.js 와 같은 규칙)
//   ② 화면 파일 = public/ 그대로 · 그 밖의 /api 는 화면이 뜰 만큼만 빈 값(실서버 아님) · /api/sms/* 는 404(문자 알약 숨김) · /api/auth/me = 토큰 글자에 staff 가 있으면 직원
//   ③ 시험용: GET /__mock/log · POST /__mock/reset · POST /__mock/set { fail:'report'|'pages'|'save'|'', clean:true(어긋남 0), mall:'error'|'' }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const PC = require(path.join(ROOT, 'price-check.js'));
const PRINT = process.argv.includes('--print');
const PORT = Number(process.argv.find(a => /^\d+$/.test(a)) || process.env.PORT612 || 3465);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

// ── 가짜 자료(verify-612-price.js 와 같은 꼴 · 어긋남 4종 + 참고 2종이 한 건씩 + 「안 파는 옵션끼리 다름」 1묶음) ──
const HG = '하우스감귤 선물용 - 3kg(로얄과)', GA = '황금향 가정용 - 3kg(중소과 17과 전후)', GS = '황금향 선물용 - 3kg(중대과 7~15과)', GM = '황금향 못난이 - 5kg(랜덤과)', HB = '한라봉 가정용 - 3kg(중과)';
const op = (n1, n2, price, stock) => ({ n1, n2, price, stock: stock == null ? 10 : stock, usable: true });
function items(giftHg, vipHgDisc, clean) {
    return [
        { no: 1, name: '제주 노지 감귤 타이벡 하우스', statusType: 'SALE', discPrice: 29000, salePrice: 57700, opts: [op('1. (제철)고당도 하우스감귤', HG, clean ? giftHg - 29000 : 5500), op('3. (제철)과즙팡팡 황금향', GA, 4500), op('3. (제철)과즙팡팡 황금향', GM, 8800)] },
        { no: 2, name: '제주 황금향 가정용 선물용', statusType: 'SALE', discPrice: 33500, salePrice: 64500, opts: [op('1. (제철)과즙팡팡 황금향', GA, 0), op('1. (제철)과즙팡팡 황금향', GS, 8300), op('1. (제철)과즙팡팡 황금향', GM, 4300)] },
        { no: 3, name: '명절 혼합 과일 페이지', statusType: 'SALE', discPrice: vipHgDisc, salePrice: 65500, opts: [op('1. 고당도 하우스감귤', HG, clean ? -1000 : 0), op('2. 과즙팡팡 황금향', GS, (clean ? 40800 : 42800) - vipHgDisc)] },
        { no: 4, name: '추석 과일 선물세트', statusType: 'SALE', discPrice: giftHg, salePrice: 60000, opts: [op('1. 고당도 하우스감귤', HG, 0)] },
        { no: 5, name: '품절 페이지', statusType: 'OUTOFSTOCK', discPrice: 99999, salePrice: 99999, opts: [op('1. 과즙팡팡 황금향', GA, 0, 0)] },
        { no: 6, name: '시험 페이지', statusType: 'SALE', discPrice: 11111, salePrice: 11111, opts: [op('1. 과즙팡팡 황금향', GM, 0)] },
        { no: 7, name: '제주 그린레몬', statusType: 'SALE', discPrice: 55600, salePrice: 107800, opts: [{ n1: '제주 그린레몬5kg(중소과)', n2: null, price: 0, stock: 5, usable: true }, { n1: '제주 그린레몬3kg(중소과)', n2: null, price: -18800, stock: 0, usable: true }] },
        { no: 8, name: '겨울 한라봉(시즌 종료)', statusType: 'SUSPENSION', discPrice: 36000, salePrice: 50000, opts: [op('1. 한라봉', HB, 0, 0)] },
        { no: 9, name: '만감류 모음(시즌 종료)', statusType: 'SUSPENSION', discPrice: 38000, salePrice: 52000, opts: [op('2. 한라봉', HB, 0, 0)] },
    ];
}
const v = (name, add, selling) => ({ code: 'P' + Math.abs(add), name, add, selling: selling || 'T', display: selling || 'T' });
const mallProducts = clean => [
    { cno: 10, name: '제주 황금향 가정용 선물용', base: 33500, selling: 'T', display: 'T', vars: [v('1. (제철)과즙팡팡 황금향 · ' + GA, 0), v('1. (제철)과즙팡팡 황금향 · ' + GS, clean ? 8300 : 9300), v('1. (제철)과즙팡팡 황금향 · 황금향 선물용 - 5kg(중대과 13~25과)', 27300)].concat(clean ? [v('1. (제철)과즙팡팡 황금향 · ' + GM, 4300)] : []) },
    { cno: 11, name: '제주 노지 감귤 타이벡 하우스', base: 29000, selling: 'F', display: 'F', vars: [v('1. (제철)고당도 하우스감귤 · ' + HG, 9999)] },
    { cno: 12, name: 'VIP 전용 레몬', base: 50000, selling: 'T', display: 'T', vars: [v('제주 그린레몬5kg(중소과)', 0), v('제주 그린레몬3kg(중소과)', -18800, 'F')] },
    { cno: 13, name: '옵션 안 읽은 상품', base: 1000, selling: 'F', display: 'F', vars: null },
];
const syncMap = { map: { 2: { c24: 10, minAdd: 0 }, 1: { c24: 11, minAdd: -5200 } } };
const day = n => new Date(Date.now() - n * 86400e3).toISOString();

let ST;
function seed() { ST = { fail: '', clean: false, mall: '', log: [], last: null, cfg: { 'naver:3': { tier: 'vip', note: 'VIP' }, 'naver:6': { ignore: true }, 'cafe24:13': { tier: 'bulk', note: '메모 유지' } } }; }
seed(); if (process.argv.includes("--clean")) ST.clean = true; if (process.argv.includes("--mallerr")) ST.mall = "error";
async function report() {
    const c = ST.clean;
    const snapshots = c ? [{ id: 1, run_at: day(10), items: items(33500, 33500, true) }, { id: 3, run_at: day(0), items: items(33500, 33500, true) }]
        : [{ id: 1, run_at: day(10), items: items(34500, 34500) }, { id: 2, run_at: day(3), items: items(33500, 33500) }, { id: 3, run_at: day(0), items: items(33500, 33500) }];
    const o = { pool: null, snapshots, pages: ST.cfg, syncMap, pricingNames: [] };
    if (ST.mall === 'error') o.cafe24Get = async () => { throw new Error('카페24 토큰 만료'); }; else o.c24Products = mallProducts(c);
    const rep = await PC.build(o);
    delete rep.mall_raw;
    ST.last = rep;
    return rep;
}
const send = (res, code, body, type) => { const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': buf.length }); res.end(buf); };
const readBody = req => new Promise(r => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => { try { r(s ? JSON.parse(s) : {}); } catch (e) { r({}); } }); });
const STUB = [
    [/^\/api\/agent-office\/desk\/status/, () => ({ ok: true, state: 'idle', online: true, engine: 'desk', busy: 0, queue: 0, others_busy: 0 })],
    [/^\/api\/agent-office\/desk\/orders/, () => ({ orders: [] })],
    [/^\/api\/agent-office\/desk\/board/, () => ({ channels: [{ ch: 'naver', today: 12, yesterday: 30 }], ship: [], todo: [], live: [], today: [], progress: [], issues: [] })],
    [/^\/api\/agent-office\/desk\/inbox/, () => ({ talk: [], qna: [], inquiry: [], counts: { talk: 0, qna: 0, inquiry: 0 } })],
    [/^\/api\/version/, () => ({ version: 'mock-612' })],
];

if (PRINT) {
    report().then(rep => {
        console.log(JSON.stringify({ summary: rep.summary, source: rep.source, notes: rep.notes }, null, 1));
        for (const g of rep.groups) console.log(`■ ${g.label} | rows ${g.rows.length}(sold ${g.sold_rows}) | ${g.issues.map(i => i.kind).join(',') || '-'}${g.offseason_mismatch ? ' | offseason ' + g.offseason_mismatch.join('/') : ''}\n   ${g.rows.map(r => r.page_key + ':' + r.price + (r.sold ? '' : '×') + (r.ignore ? '(제외)' : '')).join('  ')}`);
    });
} else http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname), M = req.method;
    try {
        if (p === '/__mock/log') return send(res, 200, { log: ST.log, cfg: ST.cfg });
        if (p === '/__mock/reset') { seed(); return send(res, 200, { ok: true }); }
        if (p === '/__mock/set') { const b = await readBody(req); ['fail', 'clean', 'mall'].forEach(k => { if (k in b) ST[k] = b[k]; }); return send(res, 200, { ok: true }); }
        if (p.startsWith('/api/price-check')) {
            const auth = req.headers.authorization || '';
            if (!/^Bearer .+/.test(auth)) return send(res, 401, { error: '로그인이 필요합니다' });
            if (M === 'GET' && p === '/api/price-check') {
                const refresh = u.searchParams.get('refresh') === '1';
                ST.log.push({ at: Date.now(), path: p, action: refresh ? 'refresh' : 'report' });
                if (ST.fail === 'report') return send(res, 500, { ok: false, error: '네이버 스냅샷을 읽지 못했습니다' });
                return send(res, 200, Object.assign({ cached: !refresh && !!ST.last }, await report()));
            }
            if (M === 'GET' && p === '/api/price-check/pages') {
                ST.log.push({ at: Date.now(), path: p, action: 'pages' });
                if (ST.fail === 'pages') return send(res, 500, { ok: false, error: '설정을 읽지 못했습니다' });
                return send(res, 200, { ok: true, pages: ST.last ? ST.last.pages : [], config: ST.cfg, tiers: PC.TIERS, defaults: PC.DEFAULT_PAGES });
            }
            if (M === 'POST' && p === '/api/price-check/pages') {
                const b = await readBody(req);
                ST.log.push({ at: Date.now(), path: p, action: 'save', body: b });
                if (/staff/.test(auth)) return send(res, 403, { error: '관리자 권한이 필요합니다' });
                if (ST.fail === 'save') return send(res, 500, { ok: false, error: '저장하지 못했습니다' });
                const next = {};   // server.js 와 같은 규칙: 키는 naver:|cafe24: 만 · 받은 것으로 통째로 갈아 끼움
                for (const [k, val] of Object.entries(b)) { if (!/^(naver|cafe24):[A-Za-z0-9_-]{1,40}$/.test(k) || !val || typeof val !== 'object') continue; next[k] = { tier: PC.TIERS.includes(val.tier) ? val.tier : 'normal', note: String(val.note || '').slice(0, 80), ignore: val.ignore === true }; }
                ST.cfg = next;
                return send(res, 200, { ok: true, config: next });
            }
            return send(res, 404, { error: '없는 주소입니다' });
        }
        if (p.startsWith('/api/sms/')) return send(res, 404, { error: '없는 주소입니다' });
        if (p === '/api/auth/me') return send(res, 200, /staff/.test(req.headers.authorization || '') ? { id: 8, name: '시험직원', position: '대리', role: 'user' } : { id: 1, name: '시험대표', position: '대표', role: 'admin' });
        if (p.startsWith('/api/')) {
            const hit = STUB.find(([re]) => re.test(p));
            if (M !== 'GET') { ST.log.push({ at: Date.now(), path: p, action: 'other-write' }); return send(res, 200, { ok: true }); }
            return send(res, 200, hit ? hit[1]() : (/s$|list|logs|items|history|pricing/.test(p) ? [] : {}));
        }
        const file = path.join(PUB, p === '/' ? 'index.html' : p);
        if (!file.startsWith(PUB)) return send(res, 403, 'no', 'text/plain');
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
        return send(res, 200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    } catch (e) { send(res, 500, { error: String(e && e.message || e) }); }
}).listen(PORT, () => console.log('mock-612 listening on ' + PORT));
