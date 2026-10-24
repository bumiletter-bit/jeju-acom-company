// #832 검증 — 공개 스냅샷 거름(storeSnapshotForMall · 판매중지·시험 상품) + 공개 GET 2개(/api/public/ship-today · /api/public/season-now) · 워커3
//   🔴 실DB 쓰기 0 · 실발송 0 · server.js 기동 0 — 함수·라우트 구간을 떼어 가짜 pool·express 포트 0 으로 돈다(실DB 읽기도 0).
//   보는 것 = ① SUSPENSION·시험 번호·「테스트」 이름 제외 · OUTOFSTOCK 유지 · 원본 무변경 · 연결표 없어도 거름 · 설정 꼴 3가지
//           ② ship-today 꼴·CORS·60초 기억(pool 1회)·분당 상한 429 ③ season-now 순수 함수 = 10/24(지금 자료) · 10/26 타이벡 · 11/5 노지 · 12/10 next 노란 레몬 D-5 · 12/16 노란 레몬 · 손님 글 금지 표현 0 · 노지황금향 행 없으면 hero 아님 · img·c24 · 라우트 절대 주소
//   실행: node scripts/verify-832-public.js
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const express = require('express');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d == null ? '' : ' — ' + String(d).slice(0, 300))); return !!c; };
const J = x => JSON.stringify(x);
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('구간 못 찾음: ' + a.slice(0, 30)); return src.slice(i, j); };

(async () => {
    console.log('① storeSnapshotForMall — 판매중지·시험 상품 제외');
    const F = new Function(cut('function cafe24OptKey(', 'async function collectCafe24Sync(') + '\nreturn { cafe24OptKey, storeSnapshotForMall, storeSnapshotHideItem, storeSnapshotTestNos };')();
    const items = [
        { no: 13817259794, name: '테스트 한라봉(시험용 · 구매 금지)', statusType: 'SUSPENSION', stock: 199998, opts: [{ n1: 'a', price: 0, stock: 9, usable: true }] },
        { no: 13782816361, name: '제주 레드키위', statusType: 'OUTOFSTOCK', stock: 0, opts: [{ n1: '3kg', price: 0, stock: 0, usable: true }] },
        { no: 6400134206, name: '제주 노지 감귤 타이벡 하우스', statusType: 'SALE', stock: 10, opts: [{ n1: '하우스감귤 가정용 - 2.5kg(로얄과)', price: 0, stock: 5, usable: true }] },
        { no: 99900000001, name: '테스트 카라향', statusType: 'SALE', stock: 10, opts: [] },
        { no: 99900000002, name: '제주 자몽', statusType: 'SUSPENSION', stock: 10, opts: [] },
        { no: 99900000003, name: '제주 레몬', statusType: 'SALE', stock: 10, opts: [] },
    ];
    const raw = J(items);
    let out = F.storeSnapshotForMall(items, null, null, null, null);
    ok(J(items) === raw, '원본 items 무변경');
    ok(out.map(x => x.no).join() === '13782816361,6400134206,99900000003', '연결표 없어도 SUSPENSION 2·시험 번호·「테스트」 이름 빠짐 · OUTOFSTOCK·SALE 유지', out.map(x => x.no).join());
    out = F.storeSnapshotForMall(items, { map: { '6400134206': { c24: 92 } } }, { keys: [] }, null, undefined);
    ok(out.map(x => x.no).join() === '13782816361,6400134206,99900000003', 'testCfg undefined(옛 호출 꼴)도 기본 시험 번호로 거름');
    out = F.storeSnapshotForMall(items, null, null, null, ['99900000003']);
    ok(!out.some(x => x.no === 99900000003) && out.some(x => x.no === 13817259794) === false, '설정 배열 = 그 번호 빠짐 · 테스트 한라봉은 이름(「테스트」)으로도 빠짐', out.map(x => x.no).join());
    out = F.storeSnapshotForMall(items, null, null, null, { ids: ['99900000003'] });
    ok(!out.some(x => x.no === 99900000003), '설정 {ids:[…]} 꼴도 됨');
    ok(F.storeSnapshotTestNos(null).has('13817259794') && F.storeSnapshotTestNos(['abc']).has('13817259794'), '설정이 비었거나 글자가 틀리면 기본 [13817259794]');
    ok(F.storeSnapshotHideItem({ no: 1, name: '제주 레몬', statusType: 'OUTOFSTOCK' }, new Set()) === false, '품절(OUTOFSTOCK) 행은 안 숨김');
    ok(F.storeSnapshotForMall([], null, null, null, null).length === 0 && F.storeSnapshotForMall(null, null, null, null, null) === null, '빈 배열·null 입력 그대로');
    // #689 종전 거름(네이버 전용 옵션)도 그대로 — 같은 호출에서
    const it2 = [{ no: 5531798664, name: '제주 레몬', statusType: 'SALE', stock: 9, opts: [{ n1: '그린레몬3kg(중소과)', price: 0, stock: 5, usable: true }, { n1: '제주 그린레몬 못난이5kg(랜덤과)', price: 0, stock: 5, usable: true }] }];
    out = F.storeSnapshotForMall(it2, { map: { '5531798664': { c24: 105 } } }, { keys: ['레몬|못난이|5kg|랜덤과'] }, null, null);
    ok(out[0].opts.length === 1 && /3kg/.test(out[0].opts[0].n1), '#689 네이버 전용 옵션 거름 종전과 같음');
    ok(/naverCfgGet\('naver_test_products'\)\]\); mallItems = storeSnapshotForMall\(r\.rows\[0\]\.items, mapCfg, ignoreCfg, textCfg, testCfg\)/.test(src), '공개 라우트가 testCfg 를 넘김');

    console.log('② 공개 GET — 라우트');
    const pubSrc = cut('function publicClientIp(req) {', 'const _chatRate = new Map();') + '\n' + cut('function kstTodayStr() {', '// 표기 규칙') + '\n' + cut('// ── #836 판매 연동 시작', '// ── #836 판매 연동 끝') + '\n' + cut('// ── #832 공개 GET 시작', '// ── #832 공개 GET 끝') + '\nreturn { seasonNowCompute, SEASON_NOW_CATALOG };';
    let poolCalls = []; let todayOverride = null;
    const KST = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const fixture = {
        rows: [
            { item_key: '레몬', label: '그린레몬', start_md: '10-01', end_md: '12-14', knowledge: '그린레몬 시기', enabled: true },
            { item_key: '레몬', label: '노란 레몬', start_md: '12-15', end_md: '04-30', knowledge: '노란 레몬 시기', enabled: true },
            { item_key: '레몬', label: '비시즌', start_md: '05-01', end_md: '09-30', knowledge: '비시즌', enabled: true },
            { item_key: '타이벡', label: '오픈 예정', start_md: '10-18', end_md: '10-27', knowledge: '타이벡감귤은 10/26(월)~27(화) 중 판매 시작 예정이에요.', enabled: true },
            { item_key: '유라조생', label: '판매', start_md: '10-01', end_md: '10-31', knowledge: '유라조생 시기', enabled: true },
            { item_key: '유라조생', label: '시즌종료(비시즌)', start_md: '11-01', end_md: '09-30', knowledge: '종료', enabled: true },
            { item_key: '노지황금향', label: '시즌 전체', start_md: '11-01', end_md: '12-31', knowledge: '노지황금향 시기예요(11월부터 출하 예정)', enabled: true },
            { item_key: '하우스감귤', label: '초기', start_md: '05-01', end_md: '07-31', knowledge: '', enabled: true },
            { item_key: '하우스감귤', label: '후기', start_md: '08-01', end_md: '10-31', knowledge: '', enabled: true },
            { item_key: '하우스황금향', label: '시즌 전체', start_md: '05-01', end_md: '11-30', knowledge: '', enabled: true },
            { item_key: '레드키위', label: '판매', start_md: '10-01', end_md: '10-18', knowledge: '', enabled: true },
            { item_key: '레드키위', label: '비시즌', start_md: '10-19', end_md: '09-30', knowledge: '', enabled: true },
            { item_key: '자사몰', label: '[네이버] 공통', start_md: '01-01', end_md: '12-31', knowledge: '', enabled: true },
            { item_key: '하우스감귤', label: '로얄과 중량UP 행사 2026-10', start_md: '10-05', end_md: '10-11', knowledge: '', enabled: false },
        ],
        productsNow: ['고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)', '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg', '유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)', '과수 및 크기: 제주 그린레몬3kg(중소과)'],
        map: { map: { '6400134206': { c24: 92 }, '5531798664': { c24: 105 }, '11126666859': { c24: 94 } } },
        assets: [{ id: 3, label: '그린레몬', sha1: 'abcdef0123456789' }, { id: 4, label: '노란레몬', sha1: 'ffff0000aaaa' }, { id: 5, label: '노지감귤', sha1: '1234567890ab' }, { id: 9, label: '타이벡감귤', sha1: 'tttt1111' }],
    };
    let dbDown = false;
    const pool = { query: async (sql) => { poolCalls.push(String(sql).slice(0, 60)); if (dbDown) throw new Error('connection refused');
        if (/FROM lms_guide_log/.test(sql)) return { rows: [{ today: 240, yesterday: 261 }] };
        if (/FROM product_season_knowledge/.test(sql)) return { rows: fixture.rows.filter(r => r.enabled) };
        if (/FROM bot_products/.test(sql)) return { rows: fixture.productsNow.map(name => ({ name })) };
        if (/FROM lucky_assets/.test(sql)) return { rows: fixture.assets };
        throw new Error('가짜 pool: 모르는 SQL ' + String(sql).slice(0, 80)); } };
    const naverCfgGet = async k => k === 'cafe24_sync_map' ? fixture.map : null;
    const app = express();
    const P = new Function('app', 'pool', 'naverCfgGet', pubSrc)(app, pool, naverCfgGet);
    const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const BASE = 'http://127.0.0.1:' + srv.address().port;
    const get = async (p, hdr) => { const r = await fetch(BASE + p, { headers: hdr || {} }); return { status: r.status, h: Object.fromEntries(r.headers.entries()), body: await r.json().catch(() => null) }; };
    let r = await get('/api/public/ship-today');
    ok(r.status === 200 && r.body.today === 240 && r.body.yesterday === 261 && /^\d{4}-\d{2}-\d{2}T/.test(r.body.asof), 'ship-today {today, yesterday, asof}', J(r.body));
    ok(r.h['access-control-allow-origin'] === '*' && /max-age=60/.test(r.h['cache-control']), 'CORS * · Cache-Control 60');
    ok(Object.keys(r.body).join() === 'today,yesterday,asof', '개인정보 칸 0(세 칸만)');
    const n0 = poolCalls.length; await get('/api/public/ship-today'); await get('/api/public/ship-today');
    ok(poolCalls.length === n0, '60초 기억 — 다시 불러도 pool 0회');
    r = await get('/api/public/season-now', { 'x-forwarded-proto': 'https' });
    ok(r.status === 200 && r.body.hero && r.body.next !== undefined && r.body.asof, 'season-now {hero, next, asof}', J(r.body).slice(0, 200));
    ok(r.body.hero.img && /^https:\/\/127\.0\.0\.1:\d+\/api\/lucky\/asset\/\d+\?v=/.test(r.body.hero.img), 'img = 요청 host 기준 절대 주소(x-forwarded-proto https · fetch 는 Host 를 못 바꿔 127.0.0.1)', r.body.hero.img);
    { const rr = await get('/api/public/season-now', { 'x-forwarded-proto': 'javascript:', 'x-forwarded-host': 'evil.example' }); ok(rr.status === 200 && /^https:\/\/127\.0\.0\.1:/.test(rr.body.hero.img), '꾸민 x-forwarded-proto·x-forwarded-host 는 안 믿음(https · 원래 host)', rr.body.hero.img); }
    ok(r.h['access-control-allow-origin'] === '*', 'season-now CORS *');
    const n1 = poolCalls.length; await get('/api/public/season-now'); ok(poolCalls.length === n1, 'season-now 60초 기억');
    let got429 = 0; for (let i = 0; i < 40; i++) { const x = await get('/api/public/ship-today', { 'cf-connecting-ip': '203.0.113.9' }); if (x.status === 429) got429++; }
    ok(got429 >= 1 && got429 <= 12, '같은 IP 분당 30 넘으면 429(40회 중 ' + got429 + '회)', got429);
    const x2 = await get('/api/public/season-now', { 'cf-connecting-ip': '203.0.113.9' }); ok(x2.status === 429, '상한은 두 길 공용(한 IP)');
    const x3 = await get('/api/public/ship-today', { 'cf-connecting-ip': '198.51.100.7' }); ok(x3.status === 200, '다른 IP 는 200');
    ok(!(await get('/api/public/ship-today', { 'cf-connecting-ip': '203.0.113.9' })).h['cache-control'], '429 응답엔 Cache-Control 없음');
    // DB 오류 = 200 + null(기억 안 함 · Cache-Control 없음)
    { const P2 = new Function('app', 'pool', 'naverCfgGet', pubSrc); const app2 = express(); P2(app2, pool, naverCfgGet); const srv2 = http.createServer(app2); await new Promise(r => srv2.listen(0, '127.0.0.1', r)); const B2 = 'http://127.0.0.1:' + srv2.address().port;
      const g2 = async (q) => { const r = await fetch(B2 + q); return { status: r.status, h: Object.fromEntries(r.headers.entries()), body: await r.json() }; };
      dbDown = true; let e1 = await g2('/api/public/ship-today'); ok(e1.status === 200 && e1.body.today === null && e1.body.yesterday === null && e1.body.asof && e1.body.error === true && !e1.h['cache-control'] && e1.h['access-control-allow-origin'] === '*', 'ship-today DB 오류 = 200 {today:null,yesterday:null,asof,error} · Cache-Control 없음 · CORS 유지', J(e1));
      let e2 = await g2('/api/public/season-now'); ok(e2.status === 200 && e2.body.hero === null && e2.body.next === null && e2.body.error === true && !e2.h['cache-control'], 'season-now DB 오류 = 200 {hero:null,next:null}', J(e2.body));
      dbDown = false; e1 = await g2('/api/public/ship-today'); ok(e1.status === 200 && e1.body.today === 240 && /max-age=60/.test(e1.h['cache-control']), '오류 응답은 기억 안 함 → DB 살면 바로 값 + Cache-Control 60'); srv2.close(); }
    srv.close();

    console.log('③ season-now 순수 함수 — 날짜 바꿔 보기');
    const C = P.seasonNowCompute, CAT = P.SEASON_NOW_CATALOG;
    const base = { rows: fixture.rows, map: fixture.map, assets: fixture.assets };
    let s = C({ ...base, today: '2026-10-24', products: fixture.productsNow });
    ok(s.hero && s.hero.key === 'noji' && s.hero.product_no === '6400134206' && s.hero.c24 === 92 && /\/api\/lucky\/asset\/5\?v=12345678$/.test(s.hero.img), '10/24(지금 자료) hero = 노지 감귤(유라조생 · 10/1 열림) · c24 92 · 사진 노지감귤', J(s.hero));
    ok(s.next && s.next.key === 'tyvek' && s.next.open_md === '10-26' && s.next.dday === 2 && s.next.waitlist_item === '타이벡 감귤' && /asset\/9/.test(s.next.img), '10/24 next = 타이벡 10-26 D-2(「10/26(월)~27(화)」 글에서 읽음)', J(s.next));
    const withTyvek = [...fixture.productsNow, '타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과)'];
    s = C({ ...base, today: '2026-10-26', products: withTyvek });
    ok(s.hero && s.hero.key === 'tyvek' && s.hero.open_md === '10-26' && s.hero.cta_text === '타이벡 감귤 주문하기', '10/26 + 판매현황 타이벡 행 = hero 타이벡', J(s.hero));
    ok(s.next && ['noji_gold', 'experience'].includes(s.next.key) && s.next.open_md === '11-01' && s.next.dday === 6, '10/26 next = 11/1 열리는 것(노지황금향·체험 동률 → 목록 순) D-6', J(s.next));
    s = C({ ...base, today: '2026-10-26', products: fixture.productsNow });
    ok(s.hero.key === 'noji' && s.next.key === 'tyvek' && s.next.dday === 0, '10/26 인데 판매현황 타이벡 행이 아직 없으면 hero 그대로 · next 타이벡 D-0(단정 안 함)', J(s));
    const rowsNov = [...fixture.rows, { item_key: '노지감귤', label: '판매', start_md: '11-01', end_md: '01-31', knowledge: '일반 노지감귤 시기', enabled: true }];
    s = C({ ...base, rows: rowsNov, today: '2026-11-05', products: [...withTyvek, '노지감귤 / 상품 및 과수: 가정용 - 5kg'] });
    ok(s.hero && s.hero.key === 'noji' && s.hero.open_md === '11-01', '11/5(시기 지식 노지감귤 11/1 판매 + 판매현황 행) = hero 노지 감귤(가장 최근에 열림 · 타이벡보다 앞)', J(s.hero));
    s = C({ ...base, rows: rowsNov, today: '2026-11-05', products: withTyvek });
    ok(s.hero.key === 'noji' && s.hero.open_md === '11-01', '11/5 노지감귤 행 = 유라 행(「노지감귤」 글자)으로도 판매 중', J(s.hero));
    s = C({ ...base, rows: rowsNov, today: '2026-12-10', products: withTyvek });
    ok(s.next && s.next.key === 'yellow_lemon' && s.next.open_md === '12-15' && s.next.dday === 5, '12/10 next = 노란 레몬 12-15 D-5', J(s.next));
    ok(s.hero && s.hero.key !== 'yellow_lemon' && s.hero.key !== 'green_lemon', '12/10 hero 는 레몬 아님(그린레몬은 10/1 열려 노지보다 오래됨)', J(s.hero));
    s = C({ ...base, rows: rowsNov, today: '2026-12-16', products: withTyvek });
    ok(s.hero && s.hero.key === 'yellow_lemon' && /asset\/4/.test(s.hero.img) && s.hero.c24 === 105, '12/16 hero = 노란 레몬(12/15 열림 · 사진 노란레몬 · c24 105)', J(s.hero));
    ok(!(s.next && s.next.key === 'green_lemon'), '12/16 next 에 그린레몬(지난 시즌) 없음', J(s.next));
    s = C({ ...base, today: '2026-11-20', products: fixture.productsNow });
    ok(!(s.hero && s.hero.key === 'noji_gold'), '노지황금향 = 판매현황 행 없으면 hero 아님(시기 지식 9 예외)', J(s.hero));
    s = C({ ...base, today: '2026-11-20', products: [...fixture.productsNow, '노지황금향 가정용 3kg'] });
    ok(s.hero && s.hero.key === 'noji_gold', '노지황금향 행이 생기면 hero 됨(11/1 열림)', J(s.hero));
    s = C({ ...base, today: '2026-10-24', products: [] });
    ok(s.hero === null && s.next && s.next.key === 'tyvek', '판매현황 판매중 0 = hero null · next 는 그대로', J(s));
    s = C({ rows: [], products: [], map: null, assets: [], today: '2026-10-24' });
    ok(s.hero === null && s.next && s.next.key === 'experience', '시기 지식 0 = hero null · next = 고정 오픈일(체험 11/1)만', J(s));
    s = C({ ...base, today: '2026-10-24', products: fixture.productsNow, catalog: [{ key: 'x', title: '시험 품목', sub: '설명', sk: ['레몬'], skLabel: '그린', prod: '레몬', pno: '5531798664', img: '그린레몬', cta: '사기' }] });
    ok(s.hero && s.hero.key === 'x' && s.hero.c24 === 105 && /asset\/3/.test(s.hero.img) && s.next === null, '설정 season_now.items 로 목록 덮기', J(s));
    const bad = CAT.filter(e => /\d{1,3}(,\d{3})+\s*원|\d+\s*원|최고|가장|보장|1위|국내\s*최초|제일|당도\s*보장/.test(e.title + ' ' + (e.sub || '') + ' ' + (e.cta || '')));
    ok(bad.length === 0, '손님 글(title·sub·cta)에 가격·최고·보장·비교 표현 0', bad.map(e => e.key).join());
    ok(CAT.every(e => e.key && e.title && (e.sk || []).length >= 0) && new Set(CAT.map(e => e.key)).size === CAT.length, '목록 키 중복 0');
    ok(/13817259794/.test(src.slice(src.indexOf('const NAVER_TEST_PRODUCTS_DEFAULT'), src.indexOf('const NAVER_TEST_PRODUCTS_DEFAULT') + 200)), '시험 상품 기본 번호 = 테스트 한라봉');

    console.log(`\n결과 ${pass}/${pass + fail}` + (fail ? ` — 실패 ${fail}` : ''));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
