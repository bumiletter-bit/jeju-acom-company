// #502 검증: 중간발주 색 규칙(qtyCategory) — 「거래처에 보내던 색 그대로 · 오로지 색만」
//   a. app.js qtyCategory 전수(오늘 단가표 품목 + 사이즈 꼬리 + 옛 품목 + [미매칭]) ↔ 기대 색표 · 「색 외 변경 0」 = git HEAD와 함수 본문 바이트 대조
//   b. 프로그램 화면(송장변환 v2 중간발주 · 로컬 3459 · 실DB 읽기만): 가짜 주문 → .qty-row 배경색 · 수량·합계 = HEAD 코드와 동일 · 선택분 이미지 표의 td 색
//   c. 창구 PNG(qty-image.js --no-run): 꼬리 옵션 그룹을 끼운 가짜 결과 → 줄 색·꼬리 줄 위치·거래처·합계
//   d. 서버 러너 size_rows 블록(server.js에서 떼어 실행 · 서버 안 띄움)
//   사용: node scripts/verify-502-qtycolor.js [unit|ui|png|server|all]   (기본 all · 러너는 실행하지 않는다)
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = 3459;
const MODE = process.argv[2] || 'all';
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };
const info = msg => console.log('ℹ️ ' + msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LF = s => s.replace(/\r\n/g, '\n');   // 줄바꿈만 맞춰 비교(파일은 CRLF · git show는 LF)
const APP = LF(fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8'));
const APP_HEAD = LF(execFileSync('git', ['show', 'HEAD:public/app.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
const BG = { yellow: '#FFFF00', orange: '#F4B183', blue: '#BDD7EE', green: '#C6E0B4', pink: '#F4CCCC', none: '#fff' };
const toRgb = hex => { const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h; return `rgb(${parseInt(f.slice(0, 2), 16)}, ${parseInt(f.slice(2, 4), 16)}, ${parseInt(f.slice(4, 6), 16)})`; };

// 대표 확정 색표(기대) — 코드와 따로 적는다
function expectColor(name) {
    if (name.startsWith('[미매칭]')) return 'none';
    if (/사이즈로!/.test(name)) return 'orange';
    if (/밤호박|호박/.test(name)) return 'orange';
    if (/블러드오렌지/.test(name)) return 'blue';
    if (/자몽/.test(name)) return 'green';
    if (/황금향/.test(name) && /선물용/.test(name)) return 'pink';
    if (/중대과/.test(name) || (/못난이/.test(name) && /10\s*kg/i.test(name))) return 'blue';
    if (/소과/.test(name) && !/중소과/.test(name)) return 'green';
    if (/못난이/.test(name)) return 'green';
    return 'yellow';
}
// app.js에서 함수 하나를 통째로 뗀다(이름으로 시작해 다음 최상위 `function`/`const`/`let`/`async function`/`window.` 선언 전까지)
function fnSlice(src, name) {
    const re = new RegExp('(?:^|\\n)(?:async )?function ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    const m = re.exec(src); if (!m) return null;
    const a = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const rest = src.slice(a + 1);
    const n = /\r?\n(?:async function |function |const |let |var |window\.|\/\/ |\/\*|class )/.exec(rest);
    return src.slice(a, n ? a + 1 + n.index : src.length).trim();
}
function buildCat(src) {
    const a = src.indexOf('function qtyCategory('), b = src.indexOf('function arrayBufferToBase64', a);
    if (a < 0 || b < 0) throw new Error('qtyCategory 구간을 못 찾음');
    return new Function(src.slice(a, b) + '\nreturn qtyCategory;')();
}
function buildMatcher(src) {   // verify-406 buildMatcher와 같은 방식 — matchProduct·규칙 파서·카탈로그
    const a = src.indexOf('function detectSize(msg)'), b = src.indexOf('// 채널 초기화', a);
    const code = src.slice(a, b);
    return new Function('document', code + '\nreturn { matchProduct, addSizeSuffix, detectSize, setPricing: (arr) => { aoInvoicePricingNames = arr; } };')({ getElementById: () => ({ value: '' }) });
}
async function pricingNames() {
    const { Client } = require('pg');
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    const r = await db.query(`SELECT p.partner, i->>'name' AS nm FROM pricing p, jsonb_array_elements(p.items) i
        WHERE p.start_date <= (now() AT TIME ZONE 'Asia/Seoul')::date AND p.end_date >= (now() AT TIME ZONE 'Asia/Seoul')::date ORDER BY p.partner, nm`);
    await db.end();
    return r.rows.filter(x => x.nm);
}

// ───────────── a. 단위
async function unit() {
    console.log('\n── a. qtyCategory 색표 · 색 외 변경 0');
    const cat = buildCat(APP), catHead = buildCat(APP_HEAD);
    const pr = await pricingNames();
    const names = [...new Set(pr.map(x => x.nm))];
    const HAND = [   // 손으로 적은 기대(대표 확정 색표 그대로)
        ['과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)', 'pink'], ['과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)', 'pink'],
        ['과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)', 'yellow'], ['과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 5kg(랜덤과)', 'green'], ['과즙팡팡 황금향 / 상품 및 과수: 황금향 못난이 - 10kg(랜덤과)', 'blue'],
        ['고당도 하우스감귤 / 상품 및 과수: 선물용 - 3kg(로얄과)', 'yellow'], ['고당도 하우스감귤 / 상품 및 과수: 가정용 - 4.5kg(중대과)', 'blue'], ['고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(소과)', 'green'], ['고당도 하우스감귤 / 상품 및 과수: 가정용 - 4.5kg(로얄과)', 'yellow'],
        ['유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(소과 2S미만)', 'green'], ['유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)', 'yellow'], ['유라품종 노지감귤 / 상품 및 과수: 가정용 - 10kg(중대과 L이상)', 'blue'],
        ['과수 및 크기: 제주 그린레몬5kg(중소과)', 'yellow'], ['과수 및 크기: 제주 레드키위3kg(로얄과)', 'yellow'], ['과수 및 크기: 제주 레몬10kg(혼합과)', 'yellow'],
        ['고당도 하우스감귤 / 상품 및 과수: 선물용 - 3kg(로얄과) S사이즈로!', 'orange'], ['과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과) M사이즈로!', 'orange'], ['유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(소과 2S미만) 2S사이즈로!', 'orange'],
        ['미니밤호박 특품최상급 / 상품 및 과수: 특품 5kg(10~20개)', 'orange'], ['블러드오렌지 3kg', 'blue'], ['자몽 5kg', 'green'],
        ['[미매칭] 개인결제창 하우스귤=선물용 3kg 21박스', 'none'], ['[미매칭] 제주 레몬3kg(중소과)', 'none'],
    ];
    let bad = [];
    for (const [n, e] of HAND) { const g = cat(n); if (g !== e) bad.push(`${n.slice(-40)} → 기대 ${e} · 실제 ${g}`); }
    ok(`손으로 적은 색표 ${HAND.length}건 전부 일치(분홍·파랑·초록·노랑·주황·없음)`, bad.length === 0, bad.join(' / '));
    const table = [];
    bad = [];
    for (const n of names) { const g = cat(n), e = expectColor(n); table.push([n, g]); if (g !== e) bad.push(n + ' → ' + g + '≠' + e); }
    ok(`오늘 단가표 품목 ${names.length}종 전수 = 기대 색표와 1:1`, names.length > 0 && bad.length === 0, bad.join(' / '));
    const tails = names.flatMap(n => ['S', 'M', '2S'].map(s => n + ' ' + s + '사이즈로!'));
    ok(`단가표 품목 + 사이즈 꼬리 ${tails.length}건 = 전부 주황`, tails.every(n => cat(n) === 'orange'));
    const old = ['미니밤호박 특품최상급 / 상품 및 과수: 특품 5kg(10~20개)', '미니밤호박 / 상품 및 과수: 상품 3kg', '블러드오렌지 / 상품 및 과수: 3kg(중과)', '제주 자몽 / 상품 및 과수: 5kg', '[미매칭] 아무거나'];
    ok('옛 품목(밤호박 주황·블러드오렌지 파랑·자몽 초록)·[미매칭] 없음 = 종전 색 그대로(HEAD와 같은 값)', old.every(n => cat(n) === expectColor(n) && cat(n) === catHead(n)), old.map(n => cat(n)).join(','));
    const counts = table.reduce((m, [, c]) => (m[c] = (m[c] || 0) + 1, m), {});
    info('오늘 단가표 색 분포: ' + JSON.stringify(counts) + ' · 거래처: ' + [...new Set(pr.map(x => x.partner))].join(', '));
    for (const [n, c] of table) console.log('   ' + c.padEnd(6) + ' ' + n);
    // 10kg 표기 변형(참고): 「10kg」·「10 kg」·「10KG」
    const v10 = ['황금향 못난이 - 10kg(랜덤과)', '황금향 못난이 - 10 kg(랜덤과)', '황금향 못난이 - 10KG'].map(n => cat(n));
    ok('못난이 10kg 표기 변형(10kg·10 kg·10KG) 전부 파랑', v10.every(c => c === 'blue'), v10.join(',') + (v10[1] !== 'blue' ? ' ← app.js 6056행 정규식 /10s*kg/i 에 역슬래시가 빠져 「10 kg」(띄어쓰기)는 파랑이 안 됨 — 단가표 이름은 「10kg」라 실제 영향 0' : ''));
    // 색 외 변경 0: 함수 본문 바이트 동일
    const FNS = ['matchProduct', 'matchProductRaw', 'recomputeQtyAggregate', 'renderQtyList', 'saveQtyImage', 'updateQtySummary', 'aoItemPartner', 'addSizeSuffix', 'detectSize', 'convertDataSmart', 'convertDataJasamol', 'convertDataCoupang'];
    const diffs = FNS.filter(f => { const a = fnSlice(APP, f), b = fnSlice(APP_HEAD, f); return !a || !b || a !== b; });
    ok(`색 외 변경 0 — 매칭·집계·화면·선택분 이미지 함수 ${FNS.length}개 본문이 git HEAD와 바이트 동일`, diffs.length === 0, diffs.length ? '다른 함수: ' + diffs.join(',') : FNS.join(' · '));
    const strip = s => { const a = s.indexOf('function qtyCategory('), b = s.indexOf('function arrayBufferToBase64', a); return s.slice(0, a) + s.slice(b); };
    ok('app.js 전체에서 qtyCategory 블록을 빼면 HEAD와 바이트 동일(= 바뀐 곳은 qtyCategory뿐)', strip(APP) === strip(APP_HEAD), `길이 ${APP.length} vs HEAD ${APP_HEAD.length}`);
    const cssHead = execFileSync('git', ['show', 'HEAD:public/styles.css'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const cssDiff = CSS.split('\n').filter(l => !cssHead.includes(l));
    ok('styles.css 변경 = .qty-cat-pink 한 줄뿐 · 색값 #F4CCCC(주황 #F4B183과 구분)', cssDiff.length === 1 && /\.qty-cat-pink\s*\{\s*background:\s*#F4CCCC/i.test(cssDiff[0]), cssDiff.join(' | ').slice(0, 200));
    const cssMap = {}; for (const [k] of Object.entries(BG)) { const m = new RegExp('\\.qty-cat-' + k + '\\s*\\{\\s*background:\\s*(#[0-9a-fA-F]{3,6})').exec(CSS); cssMap[k] = m ? m[1] : null; }
    ok('styles.css 색값 6종 = 창구 PNG CAT_BG와 동일', Object.entries(BG).every(([k, v]) => cssMap[k] && cssMap[k].toLowerCase() === v.toLowerCase()), JSON.stringify(cssMap));
    const qi = fs.readFileSync(path.join(ROOT, 'scripts', 'desk', 'qty-image.js'), 'utf8');
    const qiBg = /const CAT_BG = (\{[^}]+\})/.exec(qi);
    ok('qty-image.js CAT_BG에 pink #F4CCCC', !!qiBg && /pink: '#F4CCCC'/i.test(qiBg[1]));
    return names;
}

// ───────────── b. 프로그램 화면(송장변환 v2 중간발주)
async function ui(names) {
    console.log('\n── b. 프로그램 중간발주 화면(로컬 3459 · 가짜 주문 · 실DB 읽기만)');
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'v502-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'v502-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        await db.end();
        const user = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' };
        const tok = jwt.sign(user, 'verifytest', { expiresIn: '20m' });
        // 가짜 네이버 배송준비 주문(오늘 단가표 이름을 그대로 옵션에 · 메모로 사이즈 요청 섞음)
        const pick = (re) => names.find(n => re.test(n));
        const nGift3 = pick(/황금향.*선물용.*3kg/), nHome3 = pick(/황금향.*가정용.*3kg/), nUgly5 = pick(/못난이.*5kg/), nUgly10 = pick(/못난이.*10kg/), nRoyal = pick(/하우스감귤.*선물용.*3kg.*로얄/), nMid = pick(/하우스감귤.*4\.5kg\(중대과\)/) || pick(/중대과/), nSmall = pick(/소과 2S미만/) || pick(/\(소과\)/), nLemon = pick(/그린레몬5kg/) || pick(/레몬/), nKiwi = pick(/레드키위3kg/) || pick(/키위/);
        const base = [nGift3, nHome3, nUgly5, nUgly10, nRoyal, nMid, nSmall, nLemon, nKiwi].filter(Boolean);
        ok('가짜 주문에 쓸 오늘 단가표 품목 9종 확보(황금향 선물·가정·못난이5·못난이10 · 하우스 로얄·중대과 · 소과 · 레몬 · 키위)', base.length === 9, base.map(n => n.split(': ').pop()).join(' / '));
        const rows = [];
        let k = 0;
        const row = (opt, qty, memo) => ({ '상품주문번호': '2026100300' + String(++k).padStart(4, '0'), '주문번호': '20261003' + String(k).padStart(6, '0'), '구매자명': '시험' + k, '구매자연락처': '010-1111-' + String(1000 + k), '수취인명': '받는' + k, '옵션정보': opt, '수량': qty, '수취인연락처1': '010-2222-' + String(1000 + k), '수취인연락처2': '', '통합배송지': '제주시 시험로 ' + k, '배송메세지': memo || '', '결제일': new Date().toISOString() });
        rows.push(row(nGift3, 3), row(nGift3, 2), row(nHome3, 4), row(nUgly5, 1), row(nUgly10, 2), row(nRoyal, 5), row(nRoyal, 1, 'S사이즈로 부탁드려요'), row(nMid, 2), row(nSmall, 3), row(nSmall, 1, '문 앞에 놓아주세요'), row(nLemon, 2), row(nKiwi, 1), row(nGift3, 1, 'M 사이즈로 보내주세요'), row('아무 상품 / 상품 및 과수: 없는 옵션 3kg', 2));
        // HEAD 코드로 같은 입력을 집계(기대 수량·합계)
        const MH = buildMatcher(APP_HEAD), MN = buildMatcher(APP); MH.setPricing(names); MN.setPricing(names);
        const aggOf = M => { const m = new Map(); for (const r of rows) { const n = M.matchProduct(r['옵션정보']); m.set(n, (m.get(n) || 0) + r['수량']); } return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko')); };   // = recomputeQtyAggregate 규칙(매칭만 · 메모 꼬리 없음)
        const expH = aggOf(MH), expN = aggOf(MN);
        ok('HEAD 코드와 새 코드가 같은 입력에서 같은 품목·수량(매칭 무회귀) · 메모 사이즈 요청은 중간발주 집계에 안 섞임(종전과 같음)', JSON.stringify(expH) === JSON.stringify(expN) && !expH.some(([n]) => /사이즈로!/.test(n)), `${expH.length}행 · 합계 ${expH.reduce((s, x) => s + x[1], 0)}`);
        info('기대 집계(HEAD): ' + expH.map(([n, q]) => n.split(': ').pop() + '=' + q).join(' · '));

        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
        const pg = await ctx.newPage();
        const errors = []; pg.on('pageerror', e => errors.push(String(e))); pg.on('dialog', d => d.dismiss());
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [tok, user]);
        await pg.goto(`http://localhost:${PORT}/invoice-v2.html?embed=1`, { waitUntil: 'networkidle' });
        await pg.waitForFunction(() => window.__ivt && window.__ivt.Q, null, { timeout: 20000 });
        await pg.evaluate(() => window.__ivt.switchMode('qty'));
        await pg.evaluate(async rows => { const Q = window.__ivt.Q; Q.naver = { src: 'api', rows }; Q.coupang = []; Q.cafe24 = []; Q.merged = []; await window.__ivt.refreshQ(); }, rows);
        await pg.waitForSelector('#invoice-qty-list .qty-row', { timeout: 15000 });
        const got = await pg.evaluate(() => Array.from(document.querySelectorAll('#invoice-qty-list .qty-row')).map(r => ({ name: r.querySelector('.qty-name').textContent, qty: Number(r.querySelector('.qty-num-input').value), bg: getComputedStyle(r).backgroundColor, band: getComputedStyle(r).borderLeftColor, cls: Array.from(r.classList).find(c => c.startsWith('qty-cat-')) })));
        const gotSorted = got.map(g => [g.name, g.qty]).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
        ok('화면 중간발주 표 = HEAD 집계와 품목·수량 전부 동일(합계 포함)', JSON.stringify(gotSorted) === JSON.stringify(expH) && got.reduce((s, g) => s + g.qty, 0) === expH.reduce((s, x) => s + x[1], 0), `${got.length}행 · 합계 ${got.reduce((s, g) => s + g.qty, 0)}`);
        const sum = await pg.evaluate(() => ({ n: document.getElementById('invoice-qty-sel-count').textContent, t: document.getElementById('invoice-qty-sel-total').textContent }));
        ok('선택 요약(건수·합계) = 표와 일치', Number(sum.n) === got.length && Number(sum.t) === got.reduce((s, g) => s + g.qty, 0), JSON.stringify(sum));
        const THEME = { yellow: '#FFF3BF', orange: '#FFE3CC', blue: '#DBEAFE', green: '#DCF2D9', pink: '#FCE4EC', none: '#fff' };   // theme.css v5.9.89 파스텔(화면·선택분 이미지 캡처 공용) — pink는 theme.css에 없음
        const badCls = got.filter(g => g.cls !== 'qty-cat-' + expectColor(g.name));
        ok('화면 줄 색 class = 기대 색표 전 행(분홍·파랑·초록·노랑·없음)', badCls.length === 0, badCls.length ? badCls.map(g => g.name.split(': ').pop() + ':' + g.cls).join(' / ') : got.map(g => g.cls.replace('qty-cat-', '')).join(','));
        const pinkRows = got.filter(g => g.cls === 'qty-cat-pink'), otherRows = got.filter(g => g.cls !== 'qty-cat-pink' && g.cls !== 'qty-cat-none');
        ok('노랑·파랑·초록 행의 실제 배경 = theme.css 파스텔(#FFF3BF·#DBEAFE·#DCF2D9) + 진한 왼쪽 띠(종전 화면 그대로)', otherRows.length > 0 && otherRows.every(g => g.bg === toRgb(THEME[g.cls.replace('qty-cat-', '')]) && g.band !== toRgb('#98A0AE')), otherRows.map(g => g.cls.replace('qty-cat-', '') + ':' + g.bg).join(' · '));
        ok('분홍 행도 같은 식 — theme.css 파스텔 #FCE4EC 배경 + 분홍 띠 #EC4899', pinkRows.length > 0 && pinkRows.every(g => g.bg === toRgb(THEME.pink) && g.band === toRgb('#EC4899')), pinkRows.map(g => `배경 ${g.bg}(styles.css 원색 #F8CBAD=${toRgb(BG.pink)}) · 왼쪽 띠 ${g.band}(기본 회색=${toRgb('#98A0AE')})`).join(' · ') + ' ← theme.css 421~424·434~437·467~470행에 pink 줄이 없어 분홍만 원색+회색 띠로 보임');
        const want = { pink: got.filter(g => /황금향.*선물용/.test(g.name)), blue: got.filter(g => /중대과|못난이.*10kg/.test(g.name) && !/황금향.*선물용/.test(g.name)), green: got.filter(g => (/소과/.test(g.name) && !/중소과/.test(g.name)) || /못난이.*5kg/.test(g.name)), none: got.filter(g => g.name.startsWith('[미매칭]')), yellow: got.filter(g => /로얄과|중소과|레몬|키위/.test(g.name) && !/중대과|황금향.*선물용/.test(g.name)) };
        ok('분홍 = 황금향 선물용 · 파랑 = 중대과·못난이 10kg · 초록 = 소과·못난이 5kg · 노랑 = 로얄과·중소과·레몬·키위 · 흰색 = [미매칭] — 각 1행 이상 존재 · 주황(사이즈 꼬리) 행은 프로그램 중간발주에 없음(종전과 같음)', want.pink.length >= 1 && want.blue.length >= 2 && want.green.length >= 2 && want.none.length === 1 && want.yellow.length >= 3 && Object.entries(want).every(([c, arr]) => arr.every(g => g.cls === 'qty-cat-' + c)) && !got.some(g => /사이즈로!/.test(g.name)), JSON.stringify(Object.fromEntries(Object.entries(want).map(([c, a]) => [c, a.length]))));
        // 선택분 이미지 저장: html2canvas를 가로채 캡처 표(HTML)만 받는다
        const cap = await pg.evaluate(async () => {
            let html = null;
            window.html2canvas = async el => { html = el.outerHTML; return { toBlob: cb => cb(new Blob(['x'], { type: 'image/png' })) }; };
            const a0 = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { /* 다운로드 막음 */ };
            try { await window.saveQtyImage(); } finally { HTMLAnchorElement.prototype.click = a0; }
            if (!html) return null;
            const d = document.createElement('div'); d.innerHTML = html;
            return Array.from(d.querySelectorAll('tr')).map(tr => ({ name: tr.querySelector('.cap-name').textContent, cls: Array.from(tr.querySelector('.cap-name').classList).find(c => c.startsWith('qty-cat-')), num: tr.querySelector('.cap-num').textContent, total: tr.classList.contains('cap-total') }));
        });
        const capRows = cap ? cap.filter(r => !r.total) : [];
        ok('「선택분 이미지 저장」 캡처 표 = 화면과 같은 행·수량 · td 색 class 동일 · 합계 행 노랑', !!cap && capRows.length === got.length && capRows.every(r => { const g = got.find(x => x.name === r.name); return g && Number(r.num) === g.qty && r.cls === g.cls; }) && cap.find(r => r.total).cls === 'qty-cat-yellow' && Number(cap.find(r => r.total).num) === got.reduce((s, g) => s + g.qty, 0), cap ? `${capRows.length}행 · 합계 ${cap.find(r => r.total).num}` : 'html2canvas 호출 없음');
        ok('v2 중간발주 페이지 오류 0', errors.length === 0, errors.join(' | ').slice(0, 300));
        await ctx.close();
    } catch (e) {
        ok('화면 검증 실행', false, e.message);
    } finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) { try { srv.kill(); } catch (_) { } }
    }
}

// ───────────── c. 창구 PNG
async function png(names) {
    console.log('\n── c. 창구 중간발주 PNG(qty-image.js --no-run)');
    const dir = path.join(ROOT, '★에이전트오피스', '받은파일');
    const src = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^중간발주_러너결과_\d{4}\.json$/.test(f)).sort().pop() : null;
    if (!src) { info('받은파일에 러너결과 json이 없어 PNG 검증 건너뜀'); return; }
    const res = JSON.parse(fs.readFileSync(path.join(dir, src), 'utf8'));
    const pick = re => names.find(n => re.test(n));
    const nRoyal = pick(/하우스감귤.*선물용.*3kg.*로얄/), nGift5 = pick(/황금향.*선물용.*5kg/), nSmall = pick(/소과 2S미만/) || pick(/\(소과\)/);
    const extra = [{ ch: 'naver', opt: nRoyal + ' S사이즈로!', indiv: false, qty: 2, orders: 2 }, { ch: 'naver', opt: nGift5 + ' M사이즈로!', indiv: false, qty: 1, orders: 1 }, { ch: 'naver', opt: nSmall + ' 2S사이즈로!', indiv: false, qty: 3, orders: 3 }, { ch: 'naver', opt: nRoyal, indiv: false, qty: 4, orders: 4 }];
    const fake = Object.assign({}, res, { groups: [...(res.groups || []), ...extra], size_rows: true });
    const tmp = path.join(os.tmpdir(), 'v502-' + Date.now()); fs.mkdirSync(tmp, { recursive: true });
    const fj = path.join(tmp, 'fake.json'); fs.writeFileSync(fj, JSON.stringify(fake));
    const out = execFileSync(process.execPath, ['scripts/desk/qty-image.js', '--no-run', fj, '--out', tmp], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const J = JSON.parse(out.trim().split('\n').pop());
    const allRows = Object.entries(J.partners).flatMap(([p, v]) => v.rows.map(r => Object.assign({ partner: p }, r)));
    const tailRows = allRows.filter(r => /사이즈로!$/.test(r.name));
    const gsum = fake.groups.reduce((s, g) => s + (parseInt(g.qty, 10) || 1), 0), psum = Object.values(J.partners).reduce((s, p) => s + p.total, 0), usum = J.unmatched.reduce((s, u) => s + u.qty, 0);
    ok(`꼬리 옵션 3그룹이 거래처 표에 「… S사이즈로!」 별도 줄로(기본 품목과 합쳐지지 않음) · 미매칭으로 빠지지 않음`, tailRows.length === 3 && !J.unmatched.some(u => /사이즈로!/.test(u.name)), `꼬리 줄 ${tailRows.length}개: ${tailRows.map(r => r.name.split(': ').pop() + '=' + r.qty).join(' · ')} · 미매칭 중 꼬리 ${J.unmatched.filter(u => /사이즈로!/.test(u.name)).length}`);
    const baseRoyal = allRows.find(r => r.name === nRoyal), tailRoyal = allRows.find(r => r.name === nRoyal + ' S사이즈로!');
    const origRoyal = (res.groups || []).filter(g => g.opt && g.opt.includes(nRoyal.split(': ').pop()) && !/사이즈로!/.test(g.opt)).reduce((s, g) => s + (parseInt(g.qty, 10) || 1), 0);
    ok('기본 품목 수량 = 원래 결과 + 4 · 꼬리 줄 수량 2 (서로 섞이지 않음)', !!baseRoyal && !!tailRoyal && tailRoyal.qty === 2 && baseRoyal.qty === origRoyal + 4, `기본 ${baseRoyal && baseRoyal.qty}(원래 ${origRoyal}+4) · 꼬리 ${tailRoyal && tailRoyal.qty}`);
    ok('꼬리 줄은 기본 품목과 같은 거래처 · 기본 품목 바로 뒤', !!baseRoyal && !!tailRoyal && baseRoyal.partner === tailRoyal.partner && allRows.indexOf(tailRoyal) === allRows.indexOf(baseRoyal) + 1, `${baseRoyal && baseRoyal.partner} · 위치 ${allRows.indexOf(baseRoyal)}→${allRows.indexOf(tailRoyal)}`);
    ok('합계 = 꼬리 포함(거래처 합 + 미매칭 합 = groups 합)', psum + usum === gsum, `${psum} + ${usum} = ${gsum}`);
    // 표 HTML 재생(qty-image.js의 tableHtml과 같은 규칙으로 색 class) → PNG 픽셀 샘플링으로 줄 색 확인
    const files = J.files.filter(f => /\.png$/.test(f) && !/미매칭/.test(f));
    const { chromium } = require('playwright');
    const br = await chromium.launch(); const pg = await br.newPage();
    let colorBad = [], checked = 0;
    for (const [p, v] of Object.entries(J.partners)) {
        const f = files.find(x => path.basename(x).includes(p)); if (!f) continue;
        const b64 = fs.readFileSync(f).toString('base64');
        const px = await pg.evaluate(async ([b64, nRows]) => {
            const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
            // 줄 경계(검은 가로선)를 찾아 줄마다 이름 칸 안쪽 한 점을 샘플링
            const col = 12, lines = [];   // 이름 칸 왼쪽 여백(테두리 1px + padding 10px · 2배 배율) — 글자가 없는 자리
            for (let y = 0; y < img.height; y++) { const d = g.getImageData(col, y, 1, 1).data; if (d[0] < 60 && d[1] < 60 && d[2] < 60) { if (!lines.length || y - lines[lines.length - 1] > 3) lines.push(y); } }
            const out = [];
            for (let i = 0; i + 1 < lines.length; i++) { const y = Math.round((lines[i] + lines[i + 1]) / 2); const d = g.getImageData(col, y, 1, 1).data; out.push(`rgb(${d[0]}, ${d[1]}, ${d[2]})`); }
            return { rows: out, w: img.width, h: img.height };
        }, [b64, v.rows.length]);
        const want = v.rows.map(r => toRgb(BG[expectColor(r.name)])).concat([toRgb(BG.yellow)]);
        checked += v.rows.length;
        if (JSON.stringify(px.rows) !== JSON.stringify(want)) colorBad.push(p + ': ' + px.rows.map((c, i) => c === want[i] ? '○' : c + '≠' + want[i]).join(' '));
    }
    await br.close();
    ok(`PNG 줄 색 샘플링 = 기대 색표(거래처 ${Object.keys(J.partners).length}장 · ${checked}줄 + 합계 줄 노랑)`, colorBad.length === 0 && checked > 0, colorBad.join(' | ').slice(0, 300));
    const pinkRows = allRows.filter(r => expectColor(r.name) === 'pink');
    ok('황금향 선물용 줄이 있고 분홍으로 그려짐(위 샘플링에 포함)', pinkRows.length >= 1 && colorBad.length === 0, pinkRows.map(r => r.name.split(': ').pop()).join(' · '));
    info('PNG(눈으로 볼 것): ' + files.join(' · '));
    // 기존 verify-497(거래처 합·파일·크기) 유지
    const r497 = execFileSync(process.execPath, ['scripts/verify-497-desk-qty.js', fj], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const m497 = /결과: (\d+)\/(\d+)/.exec(r497);
    ok('verify-497-desk-qty.js(꼬리 든 가짜 결과) 전항목 통과', !!m497 && m497[1] === m497[2], m497 ? m497[0] : r497.slice(-200));
}

// ───────────── d. 서버 러너 size_rows 블록
function server() {
    console.log('\n── d. 서버 러너 size_rows 블록(server.js에서 떼어 실행)');
    const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const a = S.indexOf('let sizeFn = null, out_err;'), b = S.indexOf('const indiv = new Set(', a);
    ok('server.js에 size_rows 블록 존재', a > 0 && b > a);
    if (!(a > 0 && b > a)) return;
    const mk = req => new Function('req', 'require', 'path', '__dirname', S.slice(a, b) + '\nreturn { withSize, sizeFn, out_err };')(req, require, path, ROOT);
    const on = mk({ size_rows: true }), off = mk({}), offStr = mk({ size_rows: 'true' });
    const OPT = '고당도 하우스감귤 / 상품 및 과수: 선물용 - 3kg(로얄과)';
    ok('size_rows:true → app.js 판정 함수 추출 성공(오류 없음)', !!on.sizeFn && on.out_err === undefined, String(on.out_err || ''));
    ok('「S사이즈로 부탁」 → 꼬리 「S사이즈로!」', on.withSize(OPT, 'S사이즈로 부탁') === OPT + ' S사이즈로!', on.withSize(OPT, 'S사이즈로 부탁'));
    ok('「2에스」 → 「2S사이즈로!」 · 「엠으로」 → 「M사이즈로!」', on.withSize(OPT, '2에스로 주세요') === OPT + ' 2S사이즈로!' && on.withSize(OPT, '엠으로 보내주세요') === OPT + ' M사이즈로!');
    ok('「문 앞에 놓아주세요」·빈 메모·null → 그대로', on.withSize(OPT, '문 앞에 놓아주세요') === OPT && on.withSize(OPT, '') === OPT && on.withSize(OPT, null) === OPT);
    ok('귤 옵션 + 「작은 걸로」 → S(프로그램 송장변환과 같은 예외)', on.withSize(OPT, '작은 걸로 부탁해요') === OPT + ' S사이즈로!');
    ok('size_rows 없음(종전 요청) · 문자열 "true" → 판정 안 함 · 옵션 그대로', !off.sizeFn && off.withSize(OPT, 'S사이즈로 부탁') === OPT && !offStr.sizeFn);
    // 프로그램 convertDataSmart와 같은 결과인지(같은 함수를 쓰므로 당연하지만 기계로 확인)
    const M = buildMatcher(APP); M.setPricing([]);
    const memos = ['S사이즈로 부탁', '2에스', '엠 사이즈', 'm 사이즈로', '작게 보내주세요', '경비실에 맡겨주세요', '301동 503호', '빠른 배송 부탁'];
    ok('러너 판정 = 프로그램 addSizeSuffix 결과와 메모 8종 전부 동일', memos.every(m => on.withSize(OPT, m) === M.addSizeSuffix(OPT, m.trim())));
    // 코드 검토: 결과(groups)에 메모 원문이 안 들어감
    const blk = S.slice(a, S.indexOf('out.groups = [...agg.values()]', a));
    const addDef = /const add = \(ch, opt, qty, tel\) => \{[\s\S]*?\};/.exec(blk);
    ok('결과 groups 항목 = {ch, opt, indiv, qty, orders}뿐 — 메모(배송메세지)는 withSize 인자로만 쓰이고 저장되지 않음', !!addDef && /\{ ch, opt, indiv: isIndiv, qty: 0, orders: 0 \}/.test(addDef[0]) && !/배송메세지|배송메시지|memo/.test(addDef[0]) && (blk.match(/add\('(naver|cafe24|coupang)', withSize\(/g) || []).length === 3, addDef ? `withSize 호출 ${(blk.match(/withSize\(/g) || []).length}곳` : 'add 정의 못 찾음');
    ok('결과에 size_rows 플래그 · 추출 실패 시 errors.size_rows', /size_rows: !!sizeFn/.test(blk) && /out\.errors\.size_rows = out_err/.test(blk));
    const diff = execFileSync('git', ['diff', '--numstat', '--', 'server.js'], { cwd: ROOT, encoding: 'utf8' }).trim();
    info('server.js 변경량(git): ' + (diff || '없음'));
}

(async () => {
    let names = [];
    if (['all', 'unit', 'ui', 'png'].includes(MODE)) names = await unit().catch(e => { ok('단위 검증 실행', false, e.message); return []; });
    if (MODE === 'all' || MODE === 'ui') await ui(names);
    if (MODE === 'all' || MODE === 'png') await png(names).catch(e => ok('PNG 검증 실행', false, e.message));
    if (MODE === 'all' || MODE === 'server') server();
    const pass = results.filter(r => r.pass).length;
    console.log(`\n결과: ${pass}/${results.length}` + (pass === results.length ? ' ✅' : ' — 실패: ' + results.filter(r => !r.pass).map(r => r.name).join(' / ')));
    process.exit(pass === results.length ? 0 : 1);
})();
