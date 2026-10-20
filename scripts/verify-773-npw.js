// #773 검증 — 네이버 상품 쓰기에 더한 셋(옵션 묶음 이름 · 즉시할인 · 입력형 옵션 이름) + 링크 카드 함정(se-oglink·se-material → 코드 글자) 막기
//   server.js 「#720-B 시작」~「#720-B 끝」 러너를 떼어 가짜 deps 로 돌린다(실DB·네이버 호출 0) · 가짜 pool·가짜 네이버는 verify-720-write.js 의 것을 그대로 떼어 씀
//   + 창구 scripts/desk/naver-detail.js 의 인자·전/후 표·카드 판정(서버 판정과 같은지)
//   실행: node scripts/verify-773-npw.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('// #720-B 시작'), b = src.indexOf('// #720-B 끝');
if (a < 0 || b <= a) { console.error('server.js 에서 #720-B 구간을 못 찾음'); process.exit(1); }
const mod = new Function(src.slice(a, b) + '\nreturn { naverProductWriteRun, npwCards, npwCardRisk, npwFixCards, npwCheckPatch };')();
const v720 = fs.readFileSync(path.join(__dirname, 'verify-720-write.js'), 'utf8');
const fa = v720.indexOf('// ── 가짜 pool'), fb = v720.indexOf('const PRODUCT = {');
if (fa < 0 || fb <= fa) { console.error('verify-720-write.js 에서 가짜 pool·네이버 구간을 못 찾음'); process.exit(1); }
const F = new Function(v720.slice(fa, fb) + '\nreturn { fakePool, fakeNaver, CH, ORIGIN };')();
const ND = require('./desk/naver-detail.js');
const LINKS = require(path.join(__dirname, '..', 'naver-detail-links.js'));

let pass = 0, failN = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

// 링크 카드 3꼴 — 멀쩡한 블로그 카드(<a> 안에 div·p = PUT 하면 깨짐) · 이미 깨진 상품 카드(&lt;div 글자) · 썸네일만 남은 카드(안전)
const CARD_LIVE = `<div class="se-component se-oglink se-l-large_image" id="SE-og1"><div class="se-component-content"><div class="se-section se-section-oglink se-l-large_image se-section-align-center"><div class="se-module se-module-oglink"><a href="https://blog.naver.com/bumiletter/222317001633" class="se-oglink-thumbnail" target="_blank" data-linktype="oglink" data-linkdata="{&quot;id&quot;: &quot;SE-og1&quot;, &quot;link&quot;: &quot;https://blog.naver.com/bumiletter/222317001633&quot;}"><img src="https://dthumb-phinf.pstatic.net/x.jpg" class="se-oglink-thumbnail-resource" alt=""></a><a href="https://blog.naver.com/bumiletter/222317001633" class="se-oglink-info" target="_blank"><div class="se-oglink-info-container"><strong class="se-oglink-title">제주아꼼이네 레몬 청 만들기</strong><p class="se-oglink-summary">요약</p><p class="se-oglink-url">blog.naver.com</p></div></a></div></div></div><script type="text/data" class="__se_module_data" data-module='{"x":1}'></script></div>`;
const CARD_BROKEN = `<div class="se-component se-material se-l-material_basic" id="SE-mt1"><div class="se-component-content"><div class="se-section se-section-material se-section-align-center se-l-material_basic"><!-- Not Allowed Attribute Filtered ( target="_blank" data-linktype="material" data-linkdata="{&quot;id&quot; : &quot;SE-mt1&quot;, &quot;type&quot; : &quot;shopping&quot;, &quot;title&quot; : &quot;제주 노지 감귤 3kg&quot;, &quot;link&quot; : &quot;https://smartstore.naver.com/main/products/6400134206&quot;}" ) --><a><!-- Not Allowed Tag Filtered -->&lt;div class=&quot;se-material-content&quot;&gt;<div class="se-material-title">제주 노지 감귤 3kg</div>&lt;/div&gt;</a></div></div></div>`;
const CARD_SAFE = `<div class="se-component se-oglink se-l-large_image" id="SE-og2"><div class="se-component-content"><div class="se-section se-section-oglink"><div class="se-module se-module-oglink"><!-- Not Allowed Attribute Filtered ( data-linkdata="{&quot;link&quot;: &quot;https://blog.naver.com/bumiletter/223766181846&quot;}" ) --><a><img src="https://dthumb-phinf.pstatic.net/y.jpg" alt=""></a></div></div></div></div>`;
const wrapSe = (inner) => `<div class="se-viewer se-theme-default"><div class="se-main-container"><div class="se-component se-text" id="SE-t0"><div class="se-component-content"><p>첫 줄</p></div></div>${inner}<div class="se-component se-text" id="SE-t9"><div class="se-component-content"><p>끝 줄</p></div></div></div></div>`;

const PRODUCT = {
    originProduct: {
        statusType: 'SALE', name: '테스트 한라봉', stockQuantity: 50, salePrice: 62500,
        detailContent: '<p>첫 줄</p><p>둘째 줄</p>',
        images: { representativeImage: { url: 'https://x/1.jpg' }, optionalImages: [] },
        customerBenefit: { immediateDiscountPolicy: { discountMethod: { value: 30000, unitType: 'WON' } } },
        deliveryInfo: { deliveryType: 'DELIVERY', deliveryAttributeType: 'TODAY' },
        detailAttribute: { naverShoppingSearchInfo: { catalogMatchingYn: false },
            optionInfo: {
                optionCombinationGroupNames: { optionGroupName1: '아꼼이네 상품선택', optionGroupName2: '상품 및 과수' },
                optionCustom: [{ id: 8588387224, usable: true, groupName: '00월' }, { id: 8538522654, usable: true, groupName: '00일' }],
                optionCombinations: [{ id: 1, optionName1: '1. 한라봉', optionName2: '가정용 3kg', price: 0, stockQuantity: 20, usable: true }, { id: 2, optionName1: '1. 한라봉', optionName2: '가정용 5kg', price: 15000, stockQuantity: 30, usable: true }] } },
    },
    smartstoreChannelProduct: { channelProductDisplayStatusType: 'SUSPENSION', naverShoppingRegistration: false },
};
const ORDERS = [{ id: 101, status: '처리중', is_deleted: false, created_by_id: 1, role: 'admin', position: '대표' }];
const audit = async () => {};
const clone = (o) => JSON.parse(JSON.stringify(o));
const withDetail = (html) => { const p = clone(PRODUCT); p.originProduct.detailContent = html; return p; };
const mk = (product, opts) => { const db = F.fakePool(ORDERS), nv = F.fakeNaver(product || PRODUCT, opts); return { db, nv, deps: { pool: db, call: nv.call, audit, convertImageLinks: LINKS.convertImageLinks, gapMs: 0 } }; };
const run = (req, deps) => quiet(() => mod.naverProductWriteRun(req, deps));
const G = ['originProduct', 'detailAttribute', 'optionInfo', 'optionCombinationGroupNames'];
const get = (o, p) => p.reduce((c, k) => c == null ? c : c[k], o);

(async () => {
    console.log('① 옵션 묶음 이름 — apply → 재조회 → revert');
    {
        const { db, nv, deps } = mk();
        const bk = await run({ op: 'backup', product_no: F.CH, order_id: 101 }, deps);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { group_names: { name2: '상품 및 크기' } } }, deps);
        ok(ap.ok && ap.steps.join() === 'channel', 'apply 성공 · 통째 PUT 하나', ap);
        ok(get(nv.puts[0], G).optionGroupName2 === '상품 및 크기' && get(nv.puts[0], G).optionGroupName1 === '아꼼이네 상품선택', 'PUT 바디 = 묶음 2번만 바뀜(1번 그대로)');
        ok(ap.unexpected_paths.length === 0 && ap.not_applied.length === 0 && ap.sale_ok.ok, 'unexpected 0 · not_applied 0 · 판매 정상', { u: ap.unexpected_paths, n: ap.not_applied, s: ap.sale_ok });
        ok(ap.changed_paths.join() === 'originProduct.detailAttribute.optionInfo.optionCombinationGroupNames.optionGroupName2', 'changed_paths = 묶음 2번 한 칸', ap.changed_paths);
        ok(ap.group_names_before.optionGroupName2 === '상품 및 과수' && ap.group_names_after.optionGroupName2 === '상품 및 크기', '결과에 묶음 이름 전/후');
        const rv = await run({ op: 'revert', order_id: 101, backup_id: bk.backup_id }, deps);
        ok(rv.ok && rv.same_as_before && JSON.stringify(nv.product) === JSON.stringify(PRODUCT), 'revert = 원본 그대로', rv);
        for (const [p, re, why] of [
            [{ group_names: { name3: 'x' } }, /묶음 3번이 없어요/, '없는 묶음 3번'],
            [{ group_names: { name1: '아꼼이네 상품선택' } }, /지금과 같아요/, '지금과 같은 이름'],
            [{ group_names: { name1: '' } }, /1~50자/, '빈 이름'],
            [{ group_names: { name1: 'a'.repeat(51) } }, /1~50자/, '51자'],
            [{ group_names: { title: 'x' } }, /name1·name2·name3 만/, '모르는 칸'],
        ]) ok(re.test(mod.npwCheckPatch(p, PRODUCT) || ''), '거절: ' + why, mod.npwCheckPatch(p, PRODUCT));
        ok(db.backups[0].patch_json.group_names.name2 === '상품 및 크기', '보관본 patch_json 에 묶음 이름');
    }

    console.log('② 즉시할인 — 원 · % · 50% 상한 · 결제가');
    {
        const { nv, deps } = mk();
        const bk = await run({ op: 'backup', product_no: F.CH, order_id: 101 }, deps);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { discount: { unitType: 'WON', value: 25000 } } }, deps);
        ok(ap.ok && ap.unexpected_paths.length === 0 && ap.not_applied.length === 0 && ap.sale_ok.ok, 'apply 성공 · 예상 밖 0 · 판매 정상', ap);
        const dm = nv.puts[0].originProduct.customerBenefit.immediateDiscountPolicy.discountMethod;
        ok(dm.value === 25000 && dm.unitType === 'WON', 'PUT 바디 할인 = 25,000원');
        const t = ap.options_table || [];
        ok(t.length === 2 && t[0].before.pay === 32500 && t[0].after.pay === 37500 && t[1].after.pay === 52500 && t[0].changed.includes('pay'), '옵션 표 결제가 32,500 → 37,500 · 5kg 52,500', t);
        ok(ap.discount_before.value === 30000 && ap.discount_after.value === 25000, '결과에 할인 전/후');
        const rv = await run({ op: 'revert', order_id: 101, backup_id: bk.backup_id }, deps);
        ok(rv.ok && rv.same_as_before, 'revert = 30,000원으로', rv);
        for (const [p, re, why] of [
            [{ discount: { unitType: 'WON', value: 31251 } }, /50% 넘는/, '50.0016% = 거절'],
            [{ discount: { unitType: 'PERCENT', value: 51 } }, /50% 넘는/, '51% = 거절'],
            [{ discount: { unitType: 'WON', value: 30000 } }, /지금과 같아요/, '같은 값'],
            [{ discount: { unitType: 'WON', value: 0 } }, /1 이상 정수/, '0원'],
            [{ discount: { unitType: 'FIX', value: 10 } }, /WON\(원\) 또는 PERCENT/, '모르는 방식'],
            [{ sale_price: 50000 }, /50% 넘는/, '판매가를 내려 할인율이 60% 가 되면 거절'],
        ]) ok(re.test(mod.npwCheckPatch(p, PRODUCT) || ''), '거절: ' + why, mod.npwCheckPatch(p, PRODUCT));
        ok(mod.npwCheckPatch({ discount: { unitType: 'WON', value: 31250 } }, PRODUCT) === null, '딱 50% = 통과');
        ok(mod.npwCheckPatch({ discount: { unitType: 'PERCENT', value: 20 } }, PRODUCT) === null, '20% = 통과');
        const noDisc = clone(PRODUCT); delete noDisc.originProduct.customerBenefit;
        ok(/즉시할인이 없는/.test(mod.npwCheckPatch({ discount: { unitType: 'WON', value: 1000 } }, noDisc) || ''), '거절: 할인 없는 상품에 처음 걸기(센터 몫)');
    }

    console.log('③ 입력형 옵션(optionCustom) 이름 — apply → revert');
    {
        const { nv, deps } = mk();
        const bk = await run({ op: 'backup', product_no: F.CH, order_id: 101 }, deps);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { custom_options: [{ id: 8538522654, name: '방문일(예: 15일)' }] } }, deps);
        const oc = nv.puts[0].originProduct.detailAttribute.optionInfo.optionCustom;
        ok(ap.ok && oc[1].groupName === '방문일(예: 15일)' && oc[0].groupName === '00월' && oc[1].id === 8538522654 && oc[1].usable === true, 'PUT 바디 = 그 칸 이름만(id·usable·다른 칸 그대로)', oc);
        ok(ap.unexpected_paths.length === 0 && ap.not_applied.length === 0 && ap.changed_paths.join() === 'originProduct.detailAttribute.optionInfo.optionCustom[1].groupName', '예상 밖 0 · changed = 그 칸', ap.changed_paths);
        const rv = await run({ op: 'revert', order_id: 101, backup_id: bk.backup_id }, deps);
        ok(rv.ok && rv.same_as_before, 'revert = 「00일」', rv);
        ok(/이 상품에 없어요/.test(mod.npwCheckPatch({ custom_options: [{ id: 1, name: 'x' }] }, PRODUCT) || ''), '거절: 없는 id');
        ok(/이름만/.test(mod.npwCheckPatch({ custom_options: [{ id: 8588387224, name: 'x', usable: false }] }, PRODUCT) || ''), '거절: 이름 말고 다른 칸');
        ok(/같은 이름/.test(mod.npwCheckPatch({ custom_options: [{ id: 8588387224, name: '00월' }] }, PRODUCT) || ''), '거절: 같은 이름');
    }

    console.log('④ 링크 카드 함정 — 판정');
    {
        const live = mod.npwCards(wrapSe(CARD_LIVE)), broken = mod.npwCards(wrapSe(CARD_BROKEN)), safe = mod.npwCards(wrapSe(CARD_SAFE));
        ok(live.length === 1 && live[0].risky && !live[0].broken && live[0].link === 'https://blog.naver.com/bumiletter/222317001633' && live[0].title === '제주아꼼이네 레몬 청 만들기', '멀쩡한 블로그 카드 = 깨질 카드 · 링크·제목 읽음', live);
        ok(broken.length === 1 && broken[0].broken && !broken[0].risky && broken[0].link === 'https://smartstore.naver.com/main/products/6400134206' && broken[0].title === '제주 노지 감귤 3kg', '이미 깨진 상품 카드 = broken · 주석 속 링크·제목 읽음', broken);
        ok(safe.length === 1 && !safe[0].risky && !safe[0].broken && safe[0].link === 'https://blog.naver.com/bumiletter/223766181846', '썸네일만 남은 카드 = 안전', safe);
        const fx = mod.npwFixCards(wrapSe(CARD_LIVE + CARD_BROKEN + CARD_SAFE));
        ok(fx.ok && fx.n === 2 && !/se-oglink-info-container|se-material-content/.test(fx.html) && fx.html.includes('<a href="https://blog.naver.com/bumiletter/222317001633">👉 제주아꼼이네 레몬 청 만들기</a>') && fx.html.includes('👉 제주 노지 감귤 3kg</a>'), '고치기 = 깨질·깨진 카드 2개 → 글 링크 · 안전 카드는 그대로', fx.html.slice(0, 300));
        ok(fx.html.includes('se-module-oglink') && fx.html.includes('<p>첫 줄</p>') && fx.html.includes('<p>끝 줄</p>') && mod.npwCards(fx.html).length === 1, '앞·뒤 글과 안전 카드 보존(컴포넌트 끝 = div 짝 맞춤)');
        const noLink = CARD_LIVE.replace(/https:\/\/blog\.naver\.com\/bumiletter\/222317001633/g, 'javascript:void(0)');
        ok(!mod.npwFixCards(wrapSe(noLink)).ok, '링크를 못 찾은 카드 = 고치지 않고 멈춤');
        // 창구 판정 = 서버 판정
        for (const [nm, h] of [['live', CARD_LIVE], ['broken', CARD_BROKEN], ['safe', CARD_SAFE], ['셋 다', CARD_LIVE + CARD_BROKEN + CARD_SAFE], ['카드 없음', '<p>x</p>']]) {
            const c = ND.cardRisk(wrapSe(h)), sv = mod.npwCards(wrapSe(h));
            ok(c.risky.length === sv.filter(x => x.risky).length && c.broken.length === sv.filter(x => x.broken).length, `창구 cardRisk = 서버 npwCards(${nm})`, { c, sv: sv.map(x => [x.risky, x.broken]) });
        }
    }

    console.log('⑤ 링크 카드 함정 — 상세를 안 바꾸는 apply 도 멈춤 / card_fix 면 글 링크로');
    {
        const P = withDetail(wrapSe(CARD_LIVE));
        const t1 = mk(P);
        const bk = await run({ op: 'backup', product_no: F.CH, order_id: 101 }, t1.deps);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { discount: { unitType: 'WON', value: 25000 } } }, t1.deps);
        ok(!ap.ok && /링크 카드/.test(ap.error) && (ap.risky_cards || []).length === 1, '할인만 바꿔도 카드 있으면 멈춤', ap);
        ok(t1.nv.puts.length === 0 && !t1.db.backups[0].applied_at, 'PUT 0 · 적용 표시 0(바뀐 것 없음)');
        const ap2 = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { discount: { unitType: 'WON', value: 25000 } }, card_fix: true }, t1.deps);
        const sent = t1.nv.puts[0] && t1.nv.puts[0].originProduct.detailContent;
        ok(ap2.ok && ap2.cards_fixed === 1 && sent && !/se-oglink-info-container/.test(sent) && sent.includes('👉 제주아꼼이네 레몬 청 만들기'), 'card_fix = 카드를 글 링크로 바꿔 보냄', ap2);
        ok(ap2.unexpected_paths.length === 0 && ap2.sale_ok.ok && ap2.not_applied.length === 0, '상세가 바뀐 건 기대값 · 예상 밖 0 · 판매 정상', { u: ap2.unexpected_paths, s: ap2.sale_ok, n: ap2.not_applied });
        const rv = await run({ op: 'revert', order_id: 101, backup_id: bk.backup_id }, t1.deps);
        ok(rv.ok && rv.residual_paths.length === 0 && rv.cards_kept === 1 && !rv.cards_fixed, 'revert(할인만) = 할인만 되돌림 · 카드는 글 링크로 남음(cards_kept 1) · 멈춤 없음', rv);
        ok(t1.nv.product.originProduct.customerBenefit.immediateDiscountPolicy.discountMethod.value === 30000, '되돌린 뒤 할인 30,000원');
        // 상세 patch 를 되돌리면 보관본 상세(카드 있음)가 다시 가므로 멈춤 · card_fix 면 글 링크로
        const t2 = mk(P);
        const bk2 = await run({ op: 'backup', product_no: F.CH, order_id: 101 }, t2.deps);
        const ap3 = await run({ op: 'apply', order_id: 101, backup_id: bk2.backup_id, patch: { detail_html: wrapSe('<p>새 상세</p>') } }, t2.deps);
        ok(ap3.ok && !ap3.cards_fixed, '카드 없는 새 상세 apply = 그대로 통과');
        const rv2 = await run({ op: 'revert', order_id: 101, backup_id: bk2.backup_id }, t2.deps);
        ok(!rv2.ok && /되돌리기/.test(rv2.error) && t2.nv.puts.length === 1, '보관본 상세(카드 있음)로 되돌리기 = 멈춤 · PUT 안 나감', rv2);
        const rv3 = await run({ op: 'revert', order_id: 101, backup_id: bk2.backup_id, card_fix: true }, t2.deps);
        ok(rv3.ok && rv3.cards_fixed === 1 && rv3.residual_paths.length === 0 && rv3.sale_ok.ok && t2.nv.product.originProduct.detailContent.includes('👉 제주아꼼이네 레몬 청 만들기'), 'card_fix 되돌리기 = 보관본 상세 + 카드는 글 링크 · 잔여 0', rv3);
        // 이미 깨진 카드만 = 멈추지 않음(더 나빠지지 않음)
        const t3 = mk(withDetail(wrapSe(CARD_BROKEN + CARD_SAFE)));
        const bk3 = await run({ op: 'backup', product_no: F.CH, order_id: 101 }, t3.deps);
        const ap4 = await run({ op: 'apply', order_id: 101, backup_id: bk3.backup_id, patch: { sale_price: 63000 } }, t3.deps);
        ok(ap4.ok && !ap4.cards_fixed && t3.nv.puts[0].originProduct.detailContent === wrapSe(CARD_BROKEN + CARD_SAFE), '깨진·안전 카드만 = 멈춤 없이 그대로 보냄');
        // 판매중지·재개(change-status 길)는 상세가 안 가서 카드가 있어도 통과
        const t4 = mk(P);
        const bk4 = await run({ op: 'backup', product_no: F.CH, order_id: 101 }, t4.deps);
        const ap5 = await run({ op: 'apply', order_id: 101, backup_id: bk4.backup_id, patch: { status: 'SUSPENSION' } }, t4.deps);
        ok(ap5.ok && t4.nv.puts.length === 0 && t4.nv.statusPuts.length === 1, '판매중지 = change-status 만 · 카드 있어도 통과');
    }

    console.log('⑥ 창구 인자 · 전/후 표');
    {
        const { o } = ND.parseOpts(['--group-name2', '상품 및 크기', '--discount', '20%', '--custom-name', '8538522654=방문일', '--card-fix', '--accept-impact']);
        ok(o.groupName.name2 === '상품 및 크기' && o.discount === '20%' && o.customName[0] === '8538522654=방문일' && o.cardFix && o.acceptImpact, 'parseOpts 새 인자 5개');
        const bp = (args) => ND.buildPatch(ND.parseOpts(args).o);
        ok(JSON.stringify(bp(['--discount', '20%']).patch.discount) === '{"unitType":"PERCENT","value":20}', '--discount 20% = PERCENT 20');
        ok(JSON.stringify(bp(['--discount', '5,000원']).patch.discount) === '{"unitType":"WON","value":5000}', '--discount 5,000원 = WON 5000');
        ok(bp(['--discount', '0']).errs.length === 1 && bp(['--discount', '1.5%']).errs.length === 1, '--discount 0 · 1.5% = 거절');
        ok(JSON.stringify(bp(['--custom-name', '8538522654=방문일 (예: 15일)']).patch.custom_options) === '[{"id":8538522654,"name":"방문일 (예: 15일)"}]', '--custom-name <id>=<이름>(공백·괄호 그대로)');
        ok(bp(['--custom-name', '방문일']).errs.length === 1, '--custom-name id 없음 = 거절');
        ok(JSON.stringify(bp(['--group-name1', ' 아꼼이네 상품 ']).patch.group_names) === '{"name1":"아꼼이네 상품"}', '--group-name1 = 앞뒤 공백 뺌');
        const pr = ND.planRows(PRODUCT, { discount: { unitType: 'WON', value: 25000 } });
        ok(!pr.stops.length && pr.rows.some(r => r.field === '즉시할인' && /25,000원/.test(r.after)) && pr.rows.some(r => /결제가/.test(r.field) && r.before === '32,500원' && r.after === '37,500원'), '할인 전/후 + 결제가 줄', pr);
        ok(/50% 넘는/.test(ND.planRows(PRODUCT, { discount: { unitType: 'PERCENT', value: 51 } }).stops.join()), '창구도 51% 멈춤');
        const pg = ND.planRows(PRODUCT, { group_names: { name2: '상품 및 크기' } });
        ok(!pg.stops.length && pg.rows[0].field === '옵션 묶음 이름 2번' && pg.rows[0].before === '상품 및 과수', '묶음 이름 전/후', pg);
        ok(/묶음 3번이 없어요/.test(ND.planRows(PRODUCT, { group_names: { name3: 'x' } }).stops.join()), '창구도 없는 묶음 멈춤');
        const pc = ND.planRows(PRODUCT, { custom_options: [{ id: 8538522654, name: '방문일' }] });
        ok(!pc.stops.length && pc.rows[0].before === '00일' && pc.rows[0].after === '방문일', '입력형 옵션 전/후', pc);
        const both = ND.planRows(PRODUCT, { sale_price: 70000, discount: { unitType: 'WON', value: 35000 } });
        ok(!both.stops.length && both.rows.some(r => /3kg」 결제가/.test(r.field) && r.before === '32,500원' && r.after === '35,000원'), '판매가+할인 같이 = 새 할인으로 결제가(70,000 − 35,000)', both);
        const gi = await ND.groupImpact({ query: async () => ({ rows: [] }) }, { originProduct: { deliveryInfo: {} } }, { group_names: { name1: 'x' } });
        ok(gi.na === true && !gi.reds.length && /택배 아닌 상품/.test(gi.lines[0]), '택배 아닌 상품 = 영향 점검 해당 없음');
    }

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
