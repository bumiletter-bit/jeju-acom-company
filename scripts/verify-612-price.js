// #612 검증 — 전체 가격 확인(price-check.js)
//   사용: node scripts/verify-612-price.js
//   ①가짜 스냅샷·가짜 자사몰로 어긋남 5종(+참고 1종)이 한 건씩 잡히는지 ②옵션 열쇠가 app.js matchProduct 와 같은 결과인지(실제 스냅샷 옵션 전부 · 네이버 꼴 ↔ 자사몰 꼴)
//   ③실DB(SELECT 만)로 한 번 돌려 지금 상태를 찍는다. DB 쓰기 0 · 네이버·카페24 호출 0.
const fs = require('fs'); const path = require('path'); const ROOT = path.join(__dirname, '..');
const PC = require(path.join(ROOT, 'price-check.js'));
const { pool } = require(path.join(ROOT, 'scripts', 'desk', '_db.js'));
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) pass++; else { fail++; console.log('  ✗', label, extra === undefined ? '' : JSON.stringify(extra)); } };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label, { got: a, want: b });
const NOW = Date.parse('2026-10-10T03:00:00Z'); const day = n => new Date(NOW - n * 86400e3).toISOString(); const ymd = n => new Date(NOW - n * 86400e3 + 9 * 3600e3).toISOString().slice(0, 10);

// ── 가짜 자료 ──
const HG = '하우스감귤 선물용 - 3kg(로얄과)', GA = '황금향 가정용 - 3kg(중소과 17과 전후)', GS = '황금향 선물용 - 3kg(중대과 7~15과)', GM = '황금향 못난이 - 5kg(랜덤과)';
const op = (n1, n2, price, stock) => ({ n1, n2, price, stock: stock == null ? 10 : stock, usable: true });
function items(giftHg, vipHgDisc) {
    return [
        { no: 1, name: '제주 노지 감귤 타이벡 하우스', statusType: 'SALE', discPrice: 29000, salePrice: 57700, opts: [op('1. (제철)고당도 하우스감귤', HG, 5500), op('3. (제철)과즙팡팡 황금향', GA, 4500), op('3. (제철)과즙팡팡 황금향', GM, 8800)] },
        { no: 2, name: '제주 황금향 가정용 선물용', statusType: 'SALE', discPrice: 33500, salePrice: 64500, opts: [op('1. (제철)과즙팡팡 황금향', GA, 0), op('1. (제철)과즙팡팡 황금향', GS, 8300), op('1. (제철)과즙팡팡 황금향', GM, 4300)] },
        { no: 3, name: '명절 혼합 과일 페이지', statusType: 'SALE', discPrice: vipHgDisc, salePrice: 65500, opts: [op('1. 고당도 하우스감귤', HG, 0), op('2. 과즙팡팡 황금향', GS, 42800 - vipHgDisc)] },
        { no: 4, name: '추석 과일 선물세트', statusType: 'SALE', discPrice: giftHg, salePrice: 60000, opts: [op('1. 고당도 하우스감귤', HG, 0)] },
        { no: 5, name: '품절 페이지', statusType: 'OUTOFSTOCK', discPrice: 99999, salePrice: 99999, opts: [op('1. 과즙팡팡 황금향', GA, 0, 0)] },
        { no: 6, name: '시험 페이지', statusType: 'SALE', discPrice: 11111, salePrice: 11111, opts: [op('1. 과즙팡팡 황금향', GM, 0)] },
        { no: 7, name: '제주 그린레몬', statusType: 'SALE', discPrice: 55600, salePrice: 107800, opts: [{ n1: '제주 그린레몬5kg(중소과)', n2: null, price: 0, stock: 5, usable: true }, { n1: '제주 그린레몬3kg(중소과)', n2: null, price: -18800, stock: 0, usable: true }] },
    ];
}
const snapshots = [{ id: 1, run_at: day(10), items: items(34500, 34500) }, { id: 2, run_at: day(3), items: items(33500, 33500) }, { id: 3, run_at: day(0), items: items(33500, 33500) }];
const v = (name, add, selling) => ({ code: 'P' + Math.abs(add), name, add, selling: selling || 'T', display: selling || 'T' });
const c24Products = [
    { cno: 10, name: '제주 황금향 가정용 선물용', base: 33500, selling: 'T', display: 'T', vars: [v('1. (제철)과즙팡팡 황금향 · ' + GA, 0), v('1. (제철)과즙팡팡 황금향 · ' + GS, 9300), v('1. (제철)과즙팡팡 황금향 · 황금향 선물용 - 5kg(중대과 13~25과)', 27300)] },
    { cno: 11, name: '제주 노지 감귤 타이벡 하우스', base: 29000, selling: 'F', display: 'F', vars: [v('1. (제철)고당도 하우스감귤 · ' + HG, 9999)] },
    { cno: 12, name: 'VIP 전용 레몬', base: 50000, selling: 'T', display: 'T', vars: [v('제주 그린레몬5kg(중소과)', 0), v('제주 그린레몬3kg(중소과)', -18800, 'F')] },
    { cno: 13, name: '옵션 안 읽은 상품', base: 1000, selling: 'F', display: 'F', vars: null },
];
const pages = { 'naver:3': { tier: 'vip', note: 'VIP' }, 'naver:6': { ignore: true } };
const syncMap = { map: { 2: { c24: 10, minAdd: 0 }, 1: { c24: 11, minAdd: -5200 } } };

(async () => {
    // ── A. 가짜 자료 — 어긋남 5종 + 참고 ──
    const rep = await PC.build({ pool: null, snapshots, c24Products, pages, syncMap, pricingNames: [], now: NOW });
    eq([rep.ok, rep.summary.pages, rep.summary.pages_naver, rep.summary.pages_mall, rep.source.mall, rep.source.coupang, rep.source.history_from], [true, 11, 7, 4, 'given', 'excluded', ymd(10)], '보고 뼈대(페이지 11 = 네이버 7 + 자사몰 4 · 쿠팡 제외 표시)');
    eq(Object.keys(rep.summary.issues_by_kind).sort().map(k => k + ":" + rep.summary.issues_by_kind[k]), ["mall_vs_naver:1", "missing:1", "stale:1", "tier_mismatch:1", "vip_not_lower:1", "vip_same:1"], '종류별 1건씩(tier_mismatch · mall_vs_naver · vip_not_lower · stale · missing + 참고 vip_same)');
    const P = k => rep.pages.find(p => p.key === k); const G = frag => rep.groups.find(g => g.label.includes(frag)); const K = (g, kind) => g.issues.filter(i => i.kind === kind);
    eq([P('naver:1').tier, P('naver:3').tier, P('naver:4').tier, P('mall:10').tier, P('mall:12').tier, P('mall:10').linked, P('naver:2').linked, P('naver:6').ignore, P('naver:5').sold], ['normal', 'vip', 'gift', 'normal', 'vip', 'naver:2', 'mall:10', true, false], '등급: 설정 vip · 이름 「선물세트」 gift · 이름 「VIP」 vip · 자사몰은 짝의 등급 · 연결 · 제외 · 품절');
    const ghg = G('선물용 - 3kg(로얄과)');
    ok(ghg && ghg.rows.length === 4, '하우스감귤 선물용: 네 페이지(귤 · VIP · 선물세트 · 자사몰 미판매)가 한 묶음', ghg && ghg.rows.map(r => r.page_key));
    eq(K(ghg, 'tier_mismatch').map(i => [i.cls, i.prices.slice().sort(), i.odd_pages, i.expected]), [['base', [33500, 34500], ['naver:1'], 33500]], '①tier_mismatch: 귤 페이지만 옛 값(34,500) — 최근에 바뀐 값(33,500)이 기준');
    eq(K(ghg, 'stale').map(i => [i.page, i.peers.slice().sort()]), [['naver:1', ['naver:3', 'naver:4']]], '②stale: 다른 페이지는 3일 전 바뀌었는데 귤 페이지만 그대로');
    eq(K(ghg, 'vip_same').length, 1, '참고 vip_same: VIP 값 = 일반 최저값');
    const rg = ghg.rows.find(r => r.page_key === 'naver:4'), ra = ghg.rows.find(r => r.page_key === 'naver:1'), rm = ghg.rows.find(r => r.page_key === 'mall:11');
    eq([rg.changed_at, rg.prev_price, rg.price, ra.changed_at, ra.unchanged_since, rm.sold, rm.changed_unknown], [ymd(3), 34500, 33500, null, ymd(10), false, true], '변경일: 바뀐 날·앞 값 · 안 바뀐 줄은 「○일 이전부터」 · 자사몰은 모름');
    ok(!ghg.issues.some(i => i.kind === 'mall_vs_naver' || i.kind === 'missing'), '판매 안 하는 자사몰 상품(c11 · 9,999 차이)은 셈에서 빠짐');
    const ggs = G('황금향 선물용 - 3kg');
    eq(K(ggs, 'mall_vs_naver').map(i => [i.naver, i.mall, i.diff]), [['naver:2', 'mall:10', 1000]], '③mall_vs_naver: 자사몰이 1,000원 비쌈');
    eq(K(ggs, 'vip_not_lower').map(i => [i.vip, i.vip_price, i.base_price]), [['naver:3', 42800, 41800]], '④vip_not_lower: VIP 42,800 > 일반 41,800');
    eq(K(ggs, 'tier_mismatch').length, 0, '자사몰 짝의 차이는 tier_mismatch 로 두 번 세지 않음');
    const ggm = G('황금향 못난이 - 5kg');
    eq(K(ggm, 'missing').map(i => [i.naver, i.mall]), [['naver:2', 'mall:10']], '⑤missing(참고): 네이버 황금향 페이지에는 있는데 자사몰 짝에는 없음');
    eq([ggm.issues.length, ggm.rows.length, ggm.rows.find(r => r.page_key === 'naver:6').ignore], [1, 3, true], '제외(ignore) 페이지 값(11,111)은 표에는 있고 셈에서 빠짐 · 귤 페이지의 자사몰 짝은 미판매라 missing 아님');
    const gga = G('황금향 가정용 - 3kg');
    eq([gga.issues.length, gga.rows.length, gga.rows.filter(r => r.sold).length], [0, 4, 3], '값 같은 묶음 = 문제 0 · 품절 페이지(99,999)는 셈에서 빠짐');
    ok(!G('선물용 - 5kg').issues.length, '자사몰에만 있는 옵션은 문제 아님(일부러 둔 것)');
    const gl = G('그린레몬5kg'); eq([gl.rows.map(r => r.page_key).sort(), gl.issues.length], [['mall:12', 'naver:7'], 0], '묶음 이름 없는 옵션(레몬)도 채널 넘어 묶임 · VIP 가 더 싸면 문제 없음');
    eq(G('그린레몬3kg').issues.length, 0, '재고 0 · 미노출 옵션은 셈에서 빠짐');
    eq([rep.summary.groups_with_issue, rep.summary.vip_pages.slice().sort(), P('mall:13').options], [2, ['mall:12', 'naver:3'], 0], '요약: 문제 묶음 2(참고만 있는 묶음 제외) · VIP 페이지 2 · 옵션 못 읽은 상품도 페이지 목록에');
    ok(rep.groups[0].issues.some(i => !PC.NOTE_KINDS.includes(i.kind)), '문제 있는 묶음이 맨 위');
    const txt = PC.toText(rep);
    ok(/페이지끼리 값 다름 1/.test(txt) && /자사몰 ↔ 네이버 다름 1/.test(txt) && /VIP 가 더 비쌈 1/.test(txt) && /한쪽만 안 바뀜 1/.test(txt) && /참고: /.test(txt) && /쿠팡 제외/.test(txt), '글 표: 종류별 건수 · 참고 줄 · 쿠팡 제외');
    ok(!/undefined|NaN|\[object/.test(txt), '글 표에 깨진 값 없음');
    // 자사몰 없이
    const r2 = await PC.build({ pool: null, snapshots, pages, syncMap, pricingNames: [], now: NOW });
    eq([r2.source.mall, r2.summary.pages_mall, r2.summary.issues_by_kind.mall_vs_naver, r2.summary.issues_by_kind.missing, r2.summary.issues_by_kind.tier_mismatch], ['none', 0, undefined, undefined, 1], '자사몰 자료 없음: 네이버끼리만(짝 비교·missing 0) · 안내 문구'); ok(r2.notes.some(n => /자사몰은 조회하지 못해/.test(n)), '자사몰 못 읽음 안내');
    // cafe24Get 로 직접 읽기(가짜) · 실패
    let calls = [];
    const fakeGet = async (p, q) => { calls.push(p); if (p === '/api/v2/admin/products') return { products: c24Products.map(x => ({ product_no: x.cno, product_name: x.name, price: String(x.base) + '.00', selling: x.selling, display: x.display })) }; const no = Number(p.split('/')[5]); const x = c24Products.find(y => y.cno === no); return { variants: (x.vars || []).map(z => ({ variant_code: z.code, options: z.name.split(' · ').map(value => ({ value })), additional_amount: String(z.add) + '.00', selling: z.selling, display: z.display })) }; };
    const r3 = await PC.build({ pool: null, snapshots, pages, syncMap, pricingNames: [], now: NOW, cafe24Get: fakeGet, sleepMs: 0 });
    eq([r3.source.mall, r3.summary.issues_by_kind, calls.length, calls.filter(p => /variants/.test(p)).length], ['live', rep.summary.issues_by_kind, 4, 3], 'cafe24Get 로 읽어도 같은 결과 · 옵션 조회는 파는 상품 + 연결 상품만(3) · GET 뿐');
    const r4 = await PC.build({ pool: null, snapshots, pages, syncMap, pricingNames: [], now: NOW, cafe24Get: async () => { const e = new Error('x'); e.code = 'reauth'; throw e; }, sleepMs: 0 });
    eq([r4.ok, r4.source.mall, r4.summary.pages_mall], [true, 'error', 0], '카페24 조회 실패 = 네이버끼리만 계속');
    eq((await PC.build({ pool: null, snapshots: [], pricingNames: [], pages: {}, syncMap: {} })).ok, false, '스냅샷 없음 = ok false');
    eq(['VIP 선물할인', '명절 과일 선물세트', '대용량 상품', '제주 황금향 가정용 선물용 3kg'].map(PC.tierByName), ['vip', 'gift', 'bulk', 'normal'], '이름 규칙(「선물용」만으로는 gift 아님)');

    // ── B. 옵션 열쇠 = app.js matchProduct 와 같은 결과(실제 스냅샷 옵션 전부) ──
    const src = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8'); const a = src.indexOf('// 품목명 카탈로그'), b = src.indexOf('function addSizeSuffix');
    const M = new Function(src.slice(a, b) + '\nreturn { matchProduct, matchProductRaw, setPricing: (arr) => { aoInvoicePricingNames = arr; } };')();
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const names = new Set(); (await pool.query(`SELECT items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date`, [today])).rows.forEach(x => (x.items || []).forEach(it => it && it.name && names.add(it.name))); const pricing = [...names];
    const snap = (await pool.query(`SELECT items FROM naver_product_snapshot WHERE items IS NOT NULL ORDER BY id DESC LIMIT 1`)).rows[0].items;
    let n = 0, same = 0, matched = 0, cross = 0, crossSame = 0; const bad = [];
    for (const it of snap) for (const o of (it.opts || [])) {
        const parts = [o.n1, o.n2].filter(Boolean); const text = parts.length > 1 ? `${parts[0]} / 상품 및 과수: ${parts[1]}` : parts[0];
        M.setPricing(pricing); let want = M.matchProduct(text); if (typeof want !== 'string' || want.startsWith('[미매칭]')) want = M.matchProductRaw(text); const wantOk = typeof want === 'string' && !want.startsWith('[미매칭]');
        const got = PC.optionKey(parts, pricing); n++;
        if (wantOk) { matched++; if (got.key === 'p:' + want) same++; else bad.push([text, want, got.key]); } else { if (got.by === 'text') same++; else bad.push([text, '미매칭', got.key]); }
        if (parts.length > 1) { cross++; const mall = PC.optionKey(`${parts[0]} · ${parts[1]}`.split(/\s*(?:·|\/)\s*/), pricing); if (mall.key === got.key) crossSame++; else bad.push(['자사몰 꼴', text, got.key, mall.key]); }
    }
    ok(n >= 50, `실제 옵션 ${n}개로 대조(50개 이상)`, n);
    eq([same, bad.filter(x => x[0] !== '자사몰 꼴').length], [n, 0], `옵션 열쇠 = app.js matchProduct 결과와 같음(${same}/${n} · 매칭기가 읽은 것 ${matched} · 글자 열쇠 ${n - matched})`); if (bad.length) console.log('   ', JSON.stringify(bad.slice(0, 5)));
    eq(crossSame, cross, `네이버 꼴(A / B) = 자사몰 꼴(A · B) 같은 열쇠(${crossSame}/${cross})`);
    eq(PC.optionKey(['1. (제철)고당도 하우스감귤', '행사★하우스귤 2.5kg로얄과→중량up 4kg'], pricing).by, 'match', '「행사★ … 중량up 4kg」 옵션도 매칭기로 읽힘');
    eq([PC.optionKey(['2. ★추천 선물세트', '천혜향 선물용 - 3kg(대과 7~13과)'], []).key, PC.optionKey(['1. 과즙팡팡 천혜향', '천혜향 선물용 - 3kg(대과 7~13과)'], []).key].every((k, i, arr) => k === arr[0]), true, '선물세트 페이지의 옵션 = 품목 페이지의 같은 옵션(묶음 이름이 달라도 같은 열쇠)');
    ok(PC.optionKey(['1. 제주 햇 브로콜리', '못난이 3kg'], []).key !== PC.optionKey(['2. 미니밤호박 중품못난이', '못난이 3kg(랜덤과)'], []).key, '품목이 다른 「못난이 3kg」은 다른 열쇠');

    // ── C. 실DB 로 한 번(SELECT 만) ──
    const live = await PC.build({ pool });
    ok(live.ok && live.summary.pages_naver === snap.length && live.summary.groups > 0, '실DB build', live.summary);
    console.log('\n[실DB 지금 상태] ' + JSON.stringify(live.summary)); console.log(JSON.stringify(live.source));
    await pool.end();
    console.log(`\n#612 가격 확인 검증: ${pass}/${pass + fail} ${fail ? '✗ 실패 ' + fail : '통과'}`);
    process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERR', e.message, (e.stack || '').split('\n')[1] || ''); try { await pool.end(); } catch (_) { } process.exit(2); });
