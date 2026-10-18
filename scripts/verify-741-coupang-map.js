// #741 쿠팡 연결표 도구(coupang-item.js map) — 가짜 pool · 가짜 러너(실DB·쿠팡 0)
//   map(빈 표) · --suggest(짝·상태·쓰기 0) · --suggest --live · --apply(손으로 정한 칸 유지) · --apply --live · --set · 지시 id 없음 거절
const path = require('path');
const CI = require(path.join(__dirname, 'desk', 'coupang-item.js'));
let pass = 0, fail = 0; const ok = (x, m, y) => { if (x) { pass++; console.log('  ✅', m); } else { fail++; console.log('  ❌', m, y === undefined ? '' : JSON.stringify(y).slice(0, 300)); } };

const LIST = { ok: true, op: 'list', truncated: false, products: [
    { sellerProductId: '111', name: '제주아꼼이네 제철 제주레몬 출하', vendorItems: [
        { vendorItemId: '9001', itemName: '그린레몬 중소과 3kg 1박스', salePrice: 36800, quantity: 50, saleStatus: 'ON_SALE' },
        { vendorItemId: '9002', itemName: '그린레몬 중소과 5kg 1박스', salePrice: 55600, quantity: 0, saleStatus: 'ON_SALE' }] },
    { sellerProductId: '222', name: '제주아꼼이네 제철 아삭아삭 초당옥수수', vendorItems: [
        { vendorItemId: '9003', itemName: '중품 초당옥수수 10개입 1박스', salePrice: 19900, quantity: 10, saleStatus: 'STOP' }] },
    { sellerProductId: '333', name: '제주아꼼이네 제철 천혜향 과즙팡팡', vendorItems: [
        { vendorItemId: '9004', itemName: '가정용 3kg 1박스', salePrice: 32500, quantity: 99, saleStatus: 'ON_SALE' }] }] };
const PRICING = ['과수 및 크기: 제주 그린레몬3kg(중소과)', '과수 및 크기: 제주 그린레몬5kg(중소과)'];

function fakePool(initMap) {
    const cfg = new Map(); if (initMap) cfg.set('coupang_item_map', JSON.parse(JSON.stringify(initMap)));
    const log = { sent: [], audits: [], mapWrites: 0 };
    return { cfg, log, async query(sql, p) {
        if (/^SELECT value FROM agent_office_config WHERE key = \$1/.test(sql)) return { rows: cfg.has(p[0]) ? [{ value: JSON.parse(JSON.stringify(cfg.get(p[0]))) }] : [] };
        if (/^DELETE FROM agent_office_config WHERE key = \$1/.test(sql)) { cfg.delete(p[0]); return { rows: [] }; }
        if (/^INSERT INTO agent_office_config/.test(sql)) {
            const v = JSON.parse(p[1]); cfg.set(p[0], v);
            if (p[0] === CI.REQ_KEY) { log.sent.push(v); cfg.delete(CI.REQ_KEY); cfg.set(CI.RES_KEY, JSON.parse(JSON.stringify(LIST))); }   // 가짜 실서버 틱
            if (p[0] === 'coupang_item_map') log.mapWrites++;
            return { rows: [] };
        }
        if (/FROM pricing/.test(sql)) return { rows: [{ items: PRICING.map(name => ({ name })) }] };
        if (/^INSERT INTO audit_logs/.test(sql)) { log.audits.push(p); return { rows: [] }; }
        throw new Error('모르는 SQL: ' + sql.slice(0, 80));
    } };
}
const run = async (argv, pool) => { let res = null; await CI.main(argv, { pool, sleep: async () => { }, now: () => Date.UTC(2026, 9, 18, 6, 0), out: o => { res = o; } }); return res; };

(async () => {
    console.log('① map(빈 표)');
    let P = fakePool(); let r = await run(['map'], P);
    ok(r && r.ok && r.count === 0 && /map --suggest/.test(r.note), '빈 연결표 = 0 · 처음 안내', r);

    console.log('② --suggest(쓰기 0)');
    P = fakePool(); r = await run(['map', '--suggest'], P);
    ok(r.ok && r.count === 4 && r.live === 2, '옵션 4 · 지금 파는 것 2(재고 0 · 판매중지 제외)', r);
    ok(r.unmatched === 2 && r.unmatched_live === 1, '짝 못 찾음 2 · 그중 파는 것 1(천혜향)', r);
    ok(/9001 .* · 판매중 → 짝 「과수 및 크기: 제주 그린레몬3kg\(중소과\)」/.test(r.table), '레몬 3kg = 판매중 · 단가표 이름 짝', r.table);
    ok(/9002 .* · 재고 0 → /.test(r.table) && /9003 .* · 판매중지 → 짝 못 찾음/.test(r.table), '상태 글 = 재고 0 · 판매중지', r.table);
    ok(P.log.mapWrites === 0 && P.log.audits.length === 0 && !P.cfg.has('coupang_item_map'), '연결표 쓰기 0 · audit 0');
    ok(P.log.sent.length === 1 && P.log.sent[0].op === 'list' && P.log.sent[0].q === null, '요청 줄 = op list 한 번', P.log.sent);
    ok(!P.cfg.has(CI.REQ_KEY) && !P.cfg.has(CI.RES_KEY), '요청·결과 줄 정리');

    console.log('③ --suggest --live 레몬');
    P = fakePool(); r = await run(['map', '--suggest', '--live', '레몬'], P);
    ok(r.count === 2 && r.live === 2 && !/9002|9003/.test(r.table), '--live = 판매중 · 재고 > 0 만', r.table);
    ok(P.log.sent[0].q === '레몬', '검색어 전달', P.log.sent);

    console.log('④ --apply(손으로 정한 칸 유지)');
    P = fakePool({ '9004': { bot_product_id: 77, label: '천혜향 손으로', item_name: '옛 이름' } });
    r = await run(['map', '--apply', '5001'], P);
    const M = P.cfg.get('coupang_item_map');
    ok(r.ok && r.applied === 4 && r.added === 3, '4개 넣음 · 새로 3', r);
    ok(M['9004'].bot_product_id === 77 && M['9004'].label === '천혜향 손으로' && M['9004'].item_name === '가정용 3kg 1박스' && M['9004'].seller_product_id === '333', '손으로 정한 bot·label 그대로 · 이름·상품 번호만 새로', M['9004']);
    ok(M['9001'].seller_product_id === '111' && M['9001'].product_name && !M['9001'].bot_product_id, '새 칸 = 상품 번호·이름 · 짝은 가격 확인이 이름으로', M['9001']);
    ok(P.log.audits.length === 1 && P.log.audits[0][0] === 5001, 'audit 1 · 지시 id', P.log.audits);
    ok(/손으로 정함/.test(r.table), '표에 「손으로 정함」', r.table);

    console.log('⑤ --apply --live');
    P = fakePool(); r = await run(['map', '--apply', '5002', '--live'], P);
    ok(r.applied === 2 && Object.keys(P.cfg.get('coupang_item_map')).sort().join() === '9001,9004', '판매중 2개만 연결표에', P.cfg.get('coupang_item_map'));

    console.log('⑥ --set');
    P = fakePool({ '9004': { item_name: 'x' } });
    r = await run(['map', '--set', '9004', '5003', 'label=천혜향 가정용 3kg', 'separate=true'], P);
    const E = P.cfg.get('coupang_item_map')['9004'];
    ok(r.ok && E.label === '천혜향 가정용 3kg' && E.separate === true && E.item_name === 'x', 'label·separate 넣음 · 다른 칸 유지', E);
    r = await run(['map', '--set', '9004', '5003', 'clear=true'], P);
    ok(!P.cfg.get('coupang_item_map')['9004'].label && !P.cfg.get('coupang_item_map')['9004'].separate, 'clear = 손 칸 비움');
    let e1 = null; try { await run(['map', '--set', '9004', '5003', 'zzz=1'], P); } catch (e) { e1 = e.message; } ok(/모르는 칸/.test(e1 || ''), '모르는 칸 거절', e1);

    console.log('⑦ 거절');
    P = fakePool(); e1 = null; try { await run(['map', '--apply'], P); } catch (e) { e1 = e.message; }
    ok(/지시 id/.test(e1 || '') && P.log.sent.length === 0 && P.log.mapWrites === 0, '--apply 지시 id 없음 = 보내기 전 거절', e1);

    console.log('⑧ 가격 확인 쿠팡 값 왕복(서버 live → coupang_raw → 창구 coupangItems)');
    const PC = require(path.join(__dirname, '..', 'price-check.js'));
    const base = { snapshots: [{ id: 1, run_at: '2026-10-18T00:00:00Z', items: [{ no: 5531798664, name: '제주 그린레몬', statusType: 'SALE', discPrice: 36800, opts: [{ n1: '과수 및 크기: 제주 그린레몬3kg(중소과)', price: 0, stock: 9, usable: true }, { n1: '과수 및 크기: 제주 그린레몬5kg(중소과)', price: 18800, stock: 9, usable: true }] }] }],
        pricingNames: PRICING, pages: {}, syncMap: {}, ignoreKeys: [], cfg: { naverCfgGet: async () => null }, now: '2026-10-18T06:00:00Z',
        coupangMap: { '9001': { seller_product_id: '111', product_name: '제주아꼼이네 제철 제주레몬 출하', item_name: '그린레몬 중소과 3kg 1박스' }, '9002': { seller_product_id: '111', product_name: '제주아꼼이네 제철 제주레몬 출하', item_name: '그린레몬 중소과 5kg 1박스' } } };
    const V = { '9001': { price: 36800, stock: 50, on_sale: true }, '9002': { price: 55000, stock: 5, on_sale: true } };
    const live = await PC.build(Object.assign({}, base, { coupangGet: async vid => V[vid], coupangGapMs: 0 }));
    ok(live.source.coupang === 'live' && Array.isArray(live.coupang_raw) && live.coupang_raw.length === 2, 'live 면 coupang_raw 2', live.source);
    const kinds = rep => rep.groups.flatMap(g => g.issues.map(i => i.kind + ':' + (i.vid || ''))).sort().join();
    ok(/coupang_vs_naver:9002/.test(kinds(live)) && !/9001/.test(kinds(live)), '5kg 55,000 ↔ 네이버 55,600 = 쿠팡≠네이버 · 3kg 같음', kinds(live));
    const again = await PC.build(Object.assign({}, base, { coupangItems: JSON.parse(JSON.stringify(live.coupang_raw)) }));
    ok(again.source.coupang === 'given' && kinds(again) === kinds(live) && !again.coupang_raw, '다시 넣으면 같은 판정(given · raw 다시 안 냄)', kinds(again));

    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('크래시', e); process.exit(1); });
