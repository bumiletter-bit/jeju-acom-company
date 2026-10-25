// #842 검증 — 네이버 상품 쓰기에 「상품 무게」(상품 속성 kg 칸 · 단위가격 총용량) 칸을 더한 것
//   server.js 「#720-B 시작」~「#720-B 끝」 러너를 떼어 가짜 deps 로 돌린다(실DB·네이버 호출 0) · 가짜 pool·가짜 네이버는 verify-720-write.js 의 것을 그대로 떼어 씀
//   + 창구 scripts/desk/naver-detail.js 의 --weight 인자·전/후 표
//   실행: node scripts/verify-842-weight.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('// #720-B 시작'), b = src.indexOf('// #720-B 끝');
if (a < 0 || b <= a) { console.error('server.js 에서 #720-B 구간을 못 찾음'); process.exit(1); }
const mod = new Function(src.slice(a, b) + '\nreturn { naverProductWriteRun, npwCheckPatch };')();
const v720 = fs.readFileSync(path.join(__dirname, 'verify-720-write.js'), 'utf8');
const fa = v720.indexOf('// ── 가짜 pool'), fb = v720.indexOf('const PRODUCT = {');
if (fa < 0 || fb <= fa) { console.error('verify-720-write.js 에서 가짜 pool·네이버 구간을 못 찾음'); process.exit(1); }
const F = new Function(v720.slice(fa, fb) + '\nreturn { fakePool, fakeNaver, CH, ORIGIN };')();
const ND = require('./desk/naver-detail.js');
const LINKS = require(path.join(__dirname, '..', 'naver-detail-links.js'));

let pass = 0, failN = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

// 감귤 상품 꼴(10/25 실조회와 같은 칸 모양 · 값은 시험용) — kg 칸 1 + 값 없는 속성 2 + 단위가격 g
const PRODUCT = {
    originProduct: {
        statusType: 'SALE', name: '테스트 감귤', stockQuantity: 50, salePrice: 52100,
        detailContent: '<p>첫 줄</p>',
        images: { representativeImage: { url: 'https://x/1.jpg' }, optionalImages: [] },
        customerBenefit: { immediateDiscountPolicy: { discountMethod: { value: 26000, unitType: 'WON' } } },
        detailAttribute: {
            productAttributes: [{ attributeSeq: 10014353, attributeValueSeq: 10443770, attributeRealValue: '2.5', attributeRealValueUnitCode: 'A02002' }, { attributeSeq: 10014442, attributeValueSeq: 10772764 }, { attributeSeq: 10020581, attributeValueSeq: 10280565 }],
            unitCapacity: { unitPriceYn: true, totalCapacityValue: 2500, unitCapacity: 100, indicationUnit: 'g' },
            optionInfo: {
                optionCombinationGroupNames: { optionGroupName1: '아꼼이네 상품선택', optionGroupName2: '상품 및 과수' },
                optionCombinations: [{ id: 1, optionName1: '1. 하우스', optionName2: '가정용 - 2.5kg(로얄과)', price: 0, stockQuantity: 20, usable: true }, { id: 2, optionName1: '2. 유라', optionName2: '가정용 - 5kg(로얄과 2S~M)', price: -2300, stockQuantity: 30, usable: true }] } },
    },
    smartstoreChannelProduct: { channelProductDisplayStatusType: 'ON', naverShoppingRegistration: true },
};
const ORDERS = [{ id: 101, status: '처리중', is_deleted: false, created_by_id: 1, role: 'admin', position: '대표' }];
const audit = async () => {};
const clone = (o) => JSON.parse(JSON.stringify(o));
const mk = (product) => { const db = F.fakePool(ORDERS), nv = F.fakeNaver(product || PRODUCT); return { db, nv, deps: { pool: db, call: nv.call, audit, convertImageLinks: LINKS.convertImageLinks, gapMs: 0 } }; };
const run = (req, deps) => quiet(() => mod.naverProductWriteRun(req, deps));
const W5 = { value: '5', value_seq: 112447, total: 5000 };
const da = (j) => j.originProduct.detailAttribute;

(async () => {
    console.log('① 무게 — apply → 재조회 → revert');
    {
        const { db, nv, deps } = mk();
        const bk = await run({ op: 'backup', product_no: F.CH, order_id: 101 }, deps);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { weight: W5 } }, deps);
        ok(ap.ok && ap.steps.join() === 'channel', 'apply 성공 · 통째 PUT 하나', ap);
        const pa = da(nv.puts[0]).productAttributes;
        ok(pa[0].attributeRealValue === '5' && pa[0].attributeValueSeq === 112447 && pa[0].attributeSeq === 10014353 && pa[0].attributeRealValueUnitCode === 'A02002', 'PUT 바디 = kg 칸 값·구간만 바뀜');
        ok(JSON.stringify(pa.slice(1)) === JSON.stringify(da(PRODUCT).productAttributes.slice(1)), '다른 속성 2개 그대로');
        ok(da(nv.puts[0]).unitCapacity.totalCapacityValue === 5000 && da(nv.puts[0]).unitCapacity.unitCapacity === 100 && da(nv.puts[0]).unitCapacity.indicationUnit === 'g', '단위가격 총용량 5000 · 나머지 칸 그대로');
        ok(JSON.stringify(da(nv.puts[0]).optionInfo) === JSON.stringify(da(PRODUCT).optionInfo) && nv.puts[0].originProduct.salePrice === 52100, '옵션·판매가 무접촉');
        ok(ap.unexpected_paths.length === 0 && ap.not_applied.length === 0 && ap.sale_ok.ok, 'unexpected 0 · not_applied 0 · 판매 정상', { u: ap.unexpected_paths, n: ap.not_applied, s: ap.sale_ok });
        ok(ap.changed_paths.sort().join() === ['originProduct.detailAttribute.productAttributes[0].attributeRealValue', 'originProduct.detailAttribute.productAttributes[0].attributeValueSeq', 'originProduct.detailAttribute.unitCapacity.totalCapacityValue'].sort().join(), 'changed_paths = 세 칸', ap.changed_paths);
        ok(db.backups[0].patch_json.weight.value === '5', '보관본 patch_json 에 무게');
        const rv = await run({ op: 'revert', order_id: 101, backup_id: bk.backup_id }, deps);
        ok(rv.ok && rv.same_as_before && JSON.stringify(nv.product) === JSON.stringify(PRODUCT), 'revert = 원본 그대로', rv);
    }

    console.log('② 무게 + 판매가 + 할인 + 옵션 한 번에(#842 실제 꼴)');
    {
        const { nv, deps } = mk();
        const bk = await run({ op: 'backup', product_no: F.CH, order_id: 101 }, deps);
        const patch = { sale_price: 63000, discount: { unitType: 'WON', value: 31200 }, weight: W5, options: [{ id: 1, name1: '1. 유라', name2: '가정용 - 5kg(로얄과 2S~M)', price: -8000 }, { id: 2, name1: '2. 타이벡', name2: '로얄과 - 5kg(가정용 2S~M)', price: 0 }] };
        const ap = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch }, deps);
        ok(ap.ok && ap.unexpected_paths.length === 0 && ap.not_applied.length === 0, 'apply 성공 · unexpected 0 · not_applied 0', { u: ap.unexpected_paths, n: ap.not_applied, e: ap.error });
        const p = nv.product.originProduct, oc = p.detailAttribute.optionInfo.optionCombinations;
        ok(p.salePrice === 63000 && p.customerBenefit.immediateDiscountPolicy.discountMethod.value === 31200 && oc[1].price === 0 && oc[0].price === -8000, '판매가·할인·추가금 반영 → 기준 31,800 · 유라 5kg 23,800');
        ok(p.detailAttribute.productAttributes[0].attributeRealValue === '5' && p.detailAttribute.unitCapacity.totalCapacityValue === 5000, '무게 5 · 5000g');
        const rv = await run({ op: 'revert', order_id: 101, backup_id: bk.backup_id }, deps);
        ok(rv.ok && JSON.stringify(nv.product) === JSON.stringify(PRODUCT), 'revert = 원본 그대로', rv);
    }

    console.log('③ 거절');
    const noKg = clone(PRODUCT); noKg.originProduct.detailAttribute.productAttributes = [{ attributeSeq: 1, attributeValueSeq: 2 }];
    const twoKg = clone(PRODUCT); twoKg.originProduct.detailAttribute.productAttributes.push({ attributeSeq: 9, attributeValueSeq: 9, attributeRealValue: '3', attributeRealValueUnitCode: 'A02002' });
    const noCap = clone(PRODUCT); delete noCap.originProduct.detailAttribute.unitCapacity;
    const otherSeq = clone(PRODUCT); otherSeq.originProduct.detailAttribute.productAttributes[0].attributeSeq = 10014376;   // 레몬 분류 꼴
    for (const [p, before, re, why] of [
        [{ weight: W5 }, noKg, /kg 무게 칸이 하나가 아니에요/, 'kg 칸 없음'],
        [{ weight: W5 }, twoKg, /kg 무게 칸이 하나가 아니에요/, 'kg 칸 둘'],
        [{ weight: W5 }, noCap, /단위가격 총용량 칸이 없어요/, '단위가격 칸 없음'],
        [{ weight: W5 }, otherSeq, /감귤 분류만/, '다른 무게 속성(레몬 10014376)'],
        [{ weight: { value: '5', value_seq: 112447, total: 500 } }, PRODUCT, /안 맞아요/, '무게·총용량 어긋남'],
        [{ weight: { value: 5, value_seq: 112447, total: 5000 } }, PRODUCT, /kg 글/, '숫자 값(글 아님)'],
        [{ weight: { value: '5kg', value_seq: 112447, total: 5000 } }, PRODUCT, /kg 글/, '「5kg」 글'],
        [{ weight: { value: '5', value_seq: 0, total: 5000 } }, PRODUCT, /구간 번호/, '구간 번호 0'],
        [{ weight: { value: '5', value_seq: 112447, total: 5000, x: 1 } }, PRODUCT, /value·value_seq·total 만/, '모르는 칸'],
        [{ weight: { value: '2.5', value_seq: 10443770, total: 2500 } }, PRODUCT, /지금과 같아요/, '지금과 같음'],
        [{ weight: null }, PRODUCT, /value, value_seq, total/, '빈 값'],
    ]) ok(re.test(mod.npwCheckPatch(p, before) || ''), '거절: ' + why, mod.npwCheckPatch(p, before));
    ok(mod.npwCheckPatch({ weight: W5 }, PRODUCT) === null, '받음: 5kg');

    console.log('④ 창구 naver-detail --weight');
    {
        const r = ND.buildPatch(ND.parseOpts(['--weight', '5']).o);
        ok(!r.errs.length && JSON.stringify(r.patch.weight) === JSON.stringify(W5), '--weight 5 → { 5, 112447, 5000 }', r);
        const r2 = ND.buildPatch(ND.parseOpts(['--weight', '5kg']).o);
        ok(!r2.errs.length && r2.patch.weight.value === '5', '--weight 5kg 도 같음', r2);
        const r3 = ND.buildPatch(ND.parseOpts(['--weight', '4']).o);
        ok(r3.errs.length === 1 && /센터에서/.test(r3.errs[0]) && !r3.patch.weight, '모르는 무게(4kg) = 멈춤', r3);
        const pr = ND.planRows(PRODUCT, { weight: W5 });
        ok(!pr.stops.length && pr.rows.some(x => x.field === '상품 무게(상품 속성)' && x.before === '2.5kg' && x.after === '5kg') && pr.rows.some(x => x.field === '단위가격 총용량' && x.after === '5000g'), '전/후 표 = 무게 2.5 → 5 · 2500g → 5000g', pr);
        const pr2 = ND.planRows(PRODUCT, { weight: { value: '2.5', value_seq: 10443770, total: 2500 } });
        ok(pr2.stops.length === 1 && /이미/.test(pr2.stops[0]), '같은 무게 = 멈춤', pr2);
        const kgUnit = clone(PRODUCT); kgUnit.originProduct.detailAttribute.unitCapacity.indicationUnit = 'kg';
        ok(ND.planRows(kgUnit, { weight: W5 }).stops.some(s => /g 단위가 아니에요/.test(s)), '단위가 kg 인 상품 = 멈춤');
        ok(ND.usesPut ? ND.usesPut(PRODUCT, { weight: W5 }) : true, '무게는 통째 PUT 길(put_enabled 잠금 대상)');
    }

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
