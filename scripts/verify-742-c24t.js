// #742 검증 — 공개 스냅샷 옵션마다 c24t(짝 카페24 옵션 실제 글자) · storeSnapshotForMall 을 server.js 에서 떼어 가짜 자료로(실DB·카페24 0)
//   + collectCafe24Sync 가 이미 읽는 품목에서 cafe24_option_texts 를 적는 줄이 있는지(원문 대조)
//   실행: node scripts/verify-742-c24t.js
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('function cafe24OptKey('), b = src.indexOf('async function collectCafe24Sync(');
if (a < 0 || b <= a) { console.error('함수 경계를 못 찾음'); process.exit(1); }
const F = new Function(src.slice(a, b) + '\nreturn { cafe24OptKey, storeSnapshotForMall };')();
let pass = 0, failN = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✅', m); } else { failN++; console.log('  ❌', m, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };
const J = JSON.stringify;

const items = [
    { no: 6400134206, name: '하우스감귤', opts: [
        { n1: '하우스감귤 가정용', n2: '2.5kg(로얄과)', price: 0, stock: 10, usable: true },
        { n1: '하우스감귤 가정용', n2: '4.5kg(로얄과)', price: 9000, stock: 10, usable: true },
        { n1: '하우스감귤 선물용', n2: '3kg(로얄과)', price: 5000, stock: 10, usable: true },     // 카페24 짝 2개 → 안 붙임
        { n1: '하우스감귤 가정용', n2: '10kg(소과)', price: 0, stock: 10, usable: true } ] },    // 카페24 짝 없음
    { no: 5531798664, name: '레몬', opts: [
        { n1: '그린레몬 못난이5kg(랜덤과)', n2: '', price: 0, stock: 40, usable: true },          // 네이버 전용(제외 열쇠)
        { n1: '그린레몬 가정용 3kg(중소과)', n2: '', price: 0, stock: 10, usable: true } ] },
    { no: 111, name: '연결표에 없음', opts: [{ n1: '황금향 가정용 3kg', n2: '', price: 0, stock: 1 }] },
];
const mapCfg = { map: { 6400134206: { c24: 92 }, 5531798664: { c24: 95 }, 222: { c24: 99 } } };
const ignCfg = { keys: ['레몬|못난이|5kg|랜덤과'] };
const textCfg = { at: '2026-10-18T05:10:00Z', by: {
    92: [{ t: '1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 2.5kg(로얄과)' }, { t: '1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 4.5kg(로얄과)' },
         { t: '하우스감귤 선물용 3kg(로얄과) 박스A' }, { t: '하우스감귤 선물용 3kg(로얄과) 박스B' }].map(x => ({ ...x, k: F.cafe24OptKey(x.t) })),
    95: [{ t: '그린레몬 가정용 3kg(중소과)' }].map(x => ({ ...x, k: F.cafe24OptKey(x.t) })),
} };

(async () => {
    console.log('① c24t 붙이기');
    const raw = J(items);
    const out = F.storeSnapshotForMall(items, mapCfg, ignCfg, textCfg);
    ok(J(items) === raw, '원본 items 무변경(복사본)');
    const h = out[0].opts;
    ok(h[0].c24t === '1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 2.5kg(로얄과)' && h[1].c24t === '1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 4.5kg(로얄과)', '같은 열쇠 카페24 옵션 하나 = c24t 에 그 실제 글자', h.map(o => o.c24t));
    ok(!('c24t' in h[2]) && !('c24t' in h[3]), '짝이 둘 이상 · 없음 = c24t 안 붙임', [h[2], h[3]]);
    ok(J(Object.keys(h[0]).filter(k => k !== 'c24t')) === J(Object.keys(items[0].opts[0])) && h[0].price === 0 && h[0].n2 === '2.5kg(로얄과)', '다른 칸 그대로(c24t 만 더함)', h[0]);
    const l = out[1].opts;
    ok(l.length === 1 && l[0].n1 === '그린레몬 가정용 3kg(중소과)' && !('c24t' in l[0]), '네이버 전용 빼기(#689) 그대로 + 글자 같으면 c24t 안 붙임(바이트 절약)', l);
    ok(out[2] === items[2], '연결표에 없는 상품 = 그대로(같은 참조)');
    console.log('② 설정 없음·빈 값 = 종전과 같음');
    const o2 = F.storeSnapshotForMall(items, mapCfg, ignCfg, null), o689 = F.storeSnapshotForMall(items, mapCfg, ignCfg);
    ok(J(o2) === J(o689) && !J(o2).includes('c24t'), 'textCfg 없음 = #689 결과와 바이트 동일');
    ok(F.storeSnapshotForMall(items, mapCfg, null, null) === items && F.storeSnapshotForMall(items, mapCfg, { keys: [] }, { by: {} }) === items, '제외 열쇠·글자 둘 다 없음 = 원본(같은 참조)');
    const o3 = F.storeSnapshotForMall(items, mapCfg, null, textCfg);
    ok(o3[0].opts[0].c24t && o3[1].opts.length === 2, '제외 열쇠 없어도 c24t 는 붙음(레몬 못난이는 안 빠짐)', o3[1].opts.length);
    const changedNo = out.map((it, i) => J(it) === J(items[i]) ? null : it.no).filter(Boolean);
    ok(J(changedNo) === J([6400134206, 5531798664]), '바뀐 상품 = 짝 있는 것·전용 뺀 것만', changedNo);
    console.log('③ 05:10 동기화 원문 — 새 호출 없이 이미 읽은 품목에서 적음');
    const c = src.slice(src.indexOf('async function collectCafe24Sync('), src.indexOf("await naverCfgSet('cafe24_sync_last'"));
    ok(/optTexts\[String\(m\.c24\)\] = \(vr\.variants \|\| \[\]\)\.filter\(v => v\.display === 'T' && v\.selling === 'T' && \(v\.options \|\| \[\]\)\.length === 1\)/.test(c), '판매·진열 중 · 옵션 묶음 하나인 품목만 { t, k }');
    ok(/naverCfgSet\('cafe24_option_texts', \{ at: .*by: \{ \.\.\.\(\(prev && prev\.by\) \|\| \{\}\), \.\.\.optTexts \} \}\)/.test(c), '읽은 상품만 덮어씀(어제 값 유지) · 설정 cafe24_option_texts');
    ok((c.match(/cafe24\.apiGet\(/g) || []).length === 2, 'collectCafe24Sync 의 카페24 호출 수 그대로(상품 목록 1 + 품목 1 자리 = 2)', (c.match(/cafe24\.apiGet\(/g) || []).length);
    const route = src.slice(src.indexOf("app.get('/api/public/store-snapshot'"), src.indexOf('let _naverTickBusy'));
    ok(/naverCfgGet\('cafe24_option_texts'\)/.test(route) && /storeSnapshotForMall\(r\.rows\[0\]\.items, mapCfg, ignoreCfg, textCfg\)/.test(route) && /res\.json\(\{ at: r\.rows\[0\]\.run_at, total: r\.rows\[0\]\.total, items: mallItems, reviews:/.test(route), '공개 라우트 = 설정 하나 더 읽기 · 응답 다른 칸 무변경');
    console.log('④ #741 price_check_last — live 인 칸만 덮기(쿠팡 · coupang_at)');
    {
        const i0 = src.indexOf('#741 쿠팡도(coupang · coupang_at)'), s0 = src.indexOf('try {', i0), e0 = src.indexOf('} catch (_) { }', s0);
        if (i0 < 0 || s0 < 0 || e0 < 0) { ok(false, 'server.js 에서 #741 구간을 못 찾음'); }
        else {
            const body = src.slice(s0 + 5, e0);
            const runIt = new Function('report', 'naverCfgGet', 'naverCfgSet', `return (async () => { ${body} })();`);
            const mk = (init) => { const m = new Map(init ? [['price_check_last', init]] : []); return { m, get: async (k) => m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null, set: async (k, v) => { m.set(k, v); } }; };
            const c1 = mk({ at: 'OLD', mall: ['m0'], coupang: ['c0'], coupang_at: 'OLDC' });
            await runIt({ source: { mall: 'none', coupang: 'live' }, coupang_raw: ['c1'] }, c1.get, c1.set);
            const v1 = c1.m.get('price_check_last');
            ok(J(v1.coupang) === '["c1"]' && v1.coupang_at && v1.coupang_at !== 'OLDC' && v1.at === 'OLD' && J(v1.mall) === '["m0"]', '쿠팡만 live = coupang·coupang_at 만 바뀜 · mall·at 앞 값 유지', v1);
            const c2 = mk({ at: 'OLD', mall: ['m0'], coupang: ['c0'], coupang_at: 'OLDC' });
            await runIt({ source: { mall: 'live', coupang: 'none' }, mall_raw: ['m1'] }, c2.get, c2.set);
            const v2 = c2.m.get('price_check_last');
            ok(J(v2.mall) === '["m1"]' && v2.at !== 'OLD' && J(v2.coupang) === '["c0"]' && v2.coupang_at === 'OLDC', '자사몰만 live = 종전처럼 mall·at · 쿠팡 칸 유지', v2);
            const c3 = mk(null);
            await runIt({ source: { mall: 'error', coupang: 'given' }, mall_raw: ['x'], coupang_raw: ['y'] }, c3.get, c3.set);
            const c4 = mk(null);
            await runIt({ source: { mall: 'live', coupang: 'live' }, mall_raw: ['m'], coupang_raw: ['c'] }, c4.get, c4.set);
            const v4 = c4.m.get('price_check_last');
            ok(!c3.m.has('price_check_last') && J(v4.mall) === '["m"]' && J(v4.coupang) === '["c"]' && v4.at && v4.coupang_at, '둘 다 live 아님 = 안 씀 · 둘 다 live = 둘 다(첫 기록)', [c3.m.size, v4]);
        }
    }

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})();
