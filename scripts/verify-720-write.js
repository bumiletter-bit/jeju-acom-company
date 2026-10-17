// #720-B 검증 — 네이버 상품 쓰기 러너(server.js 「#720-B 시작」~「#720-B 끝」)를 떼어 가짜 deps 로 돌린다.
//   실DB·네이버 호출 0: pool 은 메모리 가짜(naver_product_backups·pending_orders 두 표만 흉내) · call 은 가짜 네이버
//   (채널 상품 GET/PUT · 원상품 change-status · 상품 목록 search · 그림 올리기).
//   실행: node scripts/verify-720-write.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('// #720-B 시작'), b = src.indexOf('// #720-B 끝');
if (a < 0 || b <= a) { console.error('server.js 에서 #720-B 구간을 못 찾음'); process.exit(1); }
const mod = new Function(src.slice(a, b) + '\nreturn { naverProductWriteRun, npwDiff, npwSummary, NPW_FIELDS };')();

let pass = 0, failN = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

// ── 가짜 pool ──────────────────────────────────────────
function fakePool(orders, cfg = { detail_enabled: true, put_enabled: true }) {   // cfg = 'naver_product_write' 설정 행(null = 행 없음)
    const backups = []; let seq = 0;
    const find = (id) => backups.find(x => x.id === id);
    return {
        backups,
        async query(sql, p = []) {
            if (/FROM agent_office_config WHERE key = 'naver_product_write'/.test(sql)) return { rows: cfg ? [{ value: cfg }] : [] };
            if (/FROM pending_orders WHERE id = ANY/.test(sql)) return { rows: orders.filter(o => p[0].includes(o.id)) };
            if (/FROM pending_orders o LEFT JOIN users u/.test(sql)) return { rows: orders.filter(o => o.id === p[0]).map(o => ({ ...o, approved_at: o.approved_at || null, role: o.role || null, position: o.position || null })) };
            if (/^\s*INSERT INTO naver_product_backups \(product_no, origin_product_no, order_id, before_json, created_by\)/.test(sql)) {
                const r = { id: ++seq, product_no: p[0], origin_product_no: p[1], order_id: p[2], before_json: JSON.parse(p[3]), created_by: p[4], patch_json: null, after_json: null, applied_at: null, reverted_at: null, result_json: null };
                backups.push(r); return { rows: [{ id: r.id }] };
            }
            if (/SELECT \* FROM naver_product_backups WHERE id = \$1/.test(sql)) { const r = find(p[0]); return { rows: r ? [JSON.parse(JSON.stringify(r))] : [] }; }
            if (/SET patch_json = \$2::jsonb, applied_at = COALESCE\(applied_at, NOW\(\)\)/.test(sql)) { const r = find(p[0]); r.patch_json = JSON.parse(p[1]); r.applied_at = r.applied_at || new Date(); return { rows: [] }; }
            if (/SET patch_json = \$2::jsonb, result_json = \$3::jsonb/.test(sql)) { const r = find(p[0]); r.patch_json = JSON.parse(p[1]); r.result_json = JSON.parse(p[2]); return { rows: [] }; }
            if (/SET after_json = \$2::jsonb, result_json = \$3::jsonb/.test(sql)) { const r = find(p[0]); r.after_json = JSON.parse(p[1]); r.result_json = JSON.parse(p[2]); return { rows: [] }; }
            if (/SET result_json = \$2::jsonb WHERE id = \$1/.test(sql)) { const r = find(p[0]); r.result_json = JSON.parse(p[1]); return { rows: [] }; }
            if (/SET result_json = COALESCE\(result_json, '\{\}'::jsonb\) \|\| \$2::jsonb WHERE id = \$1/.test(sql)) { const r = find(p[0]); r.result_json = { ...(r.result_json || {}), ...JSON.parse(p[1]) }; return { rows: [] }; }
            if (/SET reverted_at = NOW\(\)/.test(sql)) { const r = find(p[0]); r.reverted_at = new Date(); r.result_json = { ...(r.result_json || {}), ...JSON.parse(p[1]) }; return { rows: [] }; }
            throw new Error('가짜 pool 이 모르는 SQL: ' + sql.slice(0, 120));
        },
    };
}
// ── 가짜 네이버 ────────────────────────────────────────
const CH = '6400134206', ORIGIN = '9001';
function fakeNaver(product, opts = {}) {
    const st = { product: JSON.parse(JSON.stringify(product)), calls: [], puts: [], statusPuts: [] };
    const sum = () => { const oc = st.product.originProduct.detailAttribute.optionInfo.optionCombinations; st.product.originProduct.stockQuantity = oc.reduce((s, o) => s + o.stockQuantity, 0); };
    st.call = async (r) => {
        st.calls.push(r.method + ' ' + r.path);
        if (opts.delay) await new Promise(res => setTimeout(res, opts.delay));
        if (r.method === 'GET' && r.path === `/external/v2/products/channel-products/${CH}`) return JSON.parse(JSON.stringify(st.product));
        if (r.method === 'PUT' && r.path === `/external/v2/products/channel-products/${CH}`) {
            if (opts.putFail) { const e = new Error('naver_relay_error_400'); e.status = 400; e.data = { message: '원문', invalidInputs: [{ name: 'originProduct.foo', message: 'x' }] }; throw e; }
            // 실측(10/17 레드키위): 바디의 statusType 이 지금과 다르면 400 invalid originProduct.statusType
            if (r.body.originProduct.statusType !== st.product.originProduct.statusType) { const e = new Error('naver_relay_error_400'); e.status = 400; e.data = { message: '원문', invalidInputs: [{ name: 'originProduct.statusType' }] }; throw e; }
            st.puts.push(r.body);
            const wasOut = st.product.originProduct.statusType === 'OUTOFSTOCK';
            st.product = JSON.parse(JSON.stringify(r.body));
            if (opts.putZeroStock) for (const o of st.product.originProduct.detailAttribute.optionInfo.optionCombinations) o.stockQuantity = 0;   // 재고가 0 으로 들어간 척
            sum();
            if (st.product.originProduct.stockQuantity === 0) st.product.originProduct.statusType = 'OUTOFSTOCK';   // 문서: 조합 전부 0 = 품절
            else if (wasOut && opts.putAutoSale) st.product.originProduct.statusType = 'SALE';   // 재고 채우면 네이버가 판매로 되돌리는 척(미확정)
            if (opts.stripLinks) st.product.originProduct.detailContent = st.product.originProduct.detailContent.replace(/\shref="[^"]*"/g, '');   // 일반 href 도 지우는 네이버인 척
            if (opts.sideEffect) opts.sideEffect(st.product);   // 네이버가 다른 칸까지 바꾼 척
            return {};
        }
        if (r.method === 'POST' && r.path === '/external/v1/products/search') {
            return { contents: opts.noOrigin ? [] : [{ originProductNo: Number(ORIGIN), channelProducts: [{ channelProductNo: Number(CH) }] }] };
        }
        if (r.method === 'PUT' && r.path === `/external/v1/products/origin-products/${ORIGIN}/change-status`) {
            st.statusPuts.push(r.body);
            if (opts.statusFromOut400 && r.body.statusType === 'SALE' && st.product.originProduct.statusType === 'OUTOFSTOCK') { const e = new Error('naver_relay_error_400'); e.status = 400; e.data = { message: '재고 수량 필수' }; throw e; }
            st.product.originProduct.statusType = r.body.statusType;
            if (r.body.statusType === 'SALE' && st.product.originProduct.stockQuantity === 0) st.product.originProduct.statusType = 'OUTOFSTOCK';   // 문서: 재고 0 이면 품절 유지
            if (r.body.statusType === 'OUTOFSTOCK') { for (const o of st.product.originProduct.detailAttribute.optionInfo.optionCombinations) o.stockQuantity = 0; sum(); }
            return {};
        }
        if (r.method === 'POST' && r.path === '/external/v1/product-images/upload') {
            const f = r.body && r.body.__multipart && r.body.__multipart.files || [];
            return { images: f.map((x, i) => ({ url: `https://shop-phinf.pstatic.net/fake/${i}.jpg` })) };
        }
        throw new Error('가짜 네이버가 모르는 호출 ' + r.method + ' ' + r.path);
    };
    return st;
}
const PRODUCT = {
    originProduct: {
        statusType: 'SALE', name: '하우스감귤', stockQuantity: 50, salePrice: 29000,
        detailContent: '<p>첫 줄</p><p>둘째 줄</p>',
        images: { representativeImage: { url: 'https://x/1.jpg' }, optionalImages: [{ url: 'https://x/2.jpg' }] },
        detailAttribute: { naverShoppingSearchInfo: { catalogMatchingYn: false, modelName: 'x' },
            optionInfo: { optionCombinations: [{ id: 1, optionName1: '2.5kg', price: 0, stockQuantity: 20, usable: true }, { id: 2, optionName1: '4kg', price: 9000, stockQuantity: 30, usable: true }] } },
    },
    smartstoreChannelProduct: { channelProductDisplayStatusType: 'ON', naverShoppingRegistration: true },
};
const ORDERS = [{ id: 101, status: '처리중', is_deleted: false, created_by_id: 1, role: 'admin', position: '대표' },
    { id: 103, status: '처리중', is_deleted: false, created_by_id: 7, role: 'user', position: '사원' },
    { id: 104, status: '승인됨', is_deleted: false, created_by_id: 7, role: 'user', position: '사원', approved_at: '2026-10-17T00:00:00Z' },
    { id: 105, status: '대기', is_deleted: false, created_by_id: 990720, role: null, position: null }, { id: 102, status: '반려', is_deleted: false },
    { id: 201, status: '완료', is_deleted: false, image_data: 'data:image/png;base64,iVBORw0KGgo=', image_mime: 'image/png', file_name: null },
    { id: 202, status: '완료', is_deleted: false, image_data: 'data:application/pdf;base64,JVBER', image_mime: 'application/pdf', file_name: 'a.pdf' },
    { id: 203, status: '완료', is_deleted: false, image_data: 'data:image/jpeg;base64,' + 'A'.repeat(14 * 1024 * 1024), image_mime: 'image/jpeg', file_name: null }];
const audits = [];
const audit = async (x) => { audits.push(x); };
const LINKS = require(path.join(__dirname, '..', 'naver-detail-links.js'));
const mk = (product, opts) => { const db = fakePool(ORDERS), nv = fakeNaver(product || PRODUCT, opts); return { db, nv, deps: { pool: db, call: nv.call, audit, convertImageLinks: LINKS.convertImageLinks } }; };

(async () => {
    const run = (req, deps) => mod.naverProductWriteRun(req, { gapMs: 0, ...deps });
    const NEW_HTML = '<p>첫 줄</p><p>둘째 줄 — 고침</p>';

    console.log('① backup → apply(상세 한 줄) → 재조회 대조');
    {
        const { db, nv, deps } = mk();
        const b1 = await run({ op: 'backup', product_no: CH, order_id: 101, created_by: '시험' }, deps);
        ok(b1.ok && b1.backup_id === 1 && b1.origin_product_no === ORIGIN, 'backup 성공 · 원상품 번호 풀림', b1);
        ok(b1.summary && b1.summary.status === 'SALE' && b1.summary.images_n === 2 && b1.summary.options_n === 2, 'summary(status·images_n·options_n)', b1.summary);
        ok(JSON.stringify(db.backups[0].before_json) === JSON.stringify(PRODUCT) && db.backups[0].origin_product_no === ORIGIN, 'before_json = 네이버 응답 통째 · origin_product_no 저장');
        const a1 = await run({ op: 'apply', order_id: 101, backup_id: b1.backup_id, patch: { detail_html: NEW_HTML } }, deps);
        ok(a1.ok && a1.steps.join() === 'detail', 'apply 성공 · 길 = 통째 PUT 하나', a1);
        ok(a1.changed_paths.length === 1 && a1.changed_paths[0] === 'originProduct.detailContent', 'changed_paths = 1 (originProduct.detailContent)', a1.changed_paths);
        ok(a1.unexpected_paths.length === 0 && a1.not_applied.length === 0, 'unexpected 0 · not_applied 0');
        const put = nv.puts[0];
        ok(put && put.originProduct.detailContent === NEW_HTML && put.originProduct.salePrice === 29000 && put.originProduct.detailAttribute.optionInfo.optionCombinations[1].price === 9000
            && put.smartstoreChannelProduct.channelProductDisplayStatusType === 'ON', 'PUT 바디 = 보관본 통째 + 그 칸만(옵션·가격·채널 칸 그대로)');
        ok(put.originProduct.detailAttribute.naverShoppingSearchInfo, '카탈로그 매칭 아님 → naverShoppingSearchInfo 그대로 보냄');
        ok(nv.statusPuts.length === 0, '상세만 바꿀 땐 change-status 0');
        ok(db.backups[0].applied_at && db.backups[0].after_json && db.backups[0].patch_json.detail_html === NEW_HTML, '보관본에 applied_at·after_json·patch_json 저장');
        const again = await run({ op: 'apply', order_id: 101, backup_id: b1.backup_id, patch: { status: 'SUSPENSION' } }, deps);
        ok(!again.ok && /이미 적용/.test(again.error), '같은 보관본 두 번 apply 거절');

        console.log('③ revert 뒤 before 와 같음');
        const r1 = await run({ op: 'revert', order_id: 101, backup_id: b1.backup_id }, deps);
        ok(r1.ok && r1.same_as_before === true && r1.residual_paths.length === 0, 'revert 뒤 잔여 차이 0', r1);
        ok(JSON.stringify(nv.product) === JSON.stringify(PRODUCT), '가짜 네이버 상품 = 원본 그대로');
        ok(db.backups[0].reverted_at, 'reverted_at 저장');
        const r2 = await run({ op: 'revert', order_id: 101, backup_id: b1.backup_id }, deps);
        ok(!r2.ok && /이미 되돌린/.test(r2.error), '두 번 revert 거절');
        const acts = audits.map(x => x.action);
        ok(['naver_product_backup', 'naver_product_apply', 'naver_product_revert'].every(x => acts.includes(x)) && audits.every(x => x.source === 'naver-product-write'), 'audit 3종 · source naver-product-write');
    }

    console.log('②-a 판매 상태 = change-status(원상품 번호) · 되돌리기');
    {
        const { db, nv, deps } = mk();
        const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, deps);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { status: 'SUSPENSION' } }, deps);
        ok(ap.ok && ap.steps.join() === 'status' && nv.puts.length === 0, '상태만 = change-status 하나(통째 PUT 0)', ap);
        ok(nv.statusPuts.length === 1 && JSON.stringify(nv.statusPuts[0]) === '{"statusType":"SUSPENSION"}', 'change-status 바디 = statusType 하나', nv.statusPuts);
        ok(nv.calls.includes(`PUT /external/v1/products/origin-products/${ORIGIN}/change-status`), '경로 = 원상품 번호');
        ok(ap.changed_paths.join() === 'originProduct.statusType' && ap.unexpected_paths.length === 0, 'changed = statusType · unexpected 0', ap.changed_paths);
        const rv = await run({ op: 'revert', order_id: 101, backup_id: b.backup_id }, deps);
        ok(rv.ok && rv.same_as_before && rv.steps.join() === 'status' && nv.statusPuts[1].statusType === 'SALE', '되돌리기 = change-status SALE · 잔여 0', rv);
        // 품절 — 옵션 재고가 0 으로 같이 움직여도 unexpected 아님 · 되돌리면 통째 PUT 으로 옵션 재고 복구 뒤 상태
        const k = mk();
        const b2 = await run({ op: 'backup', product_no: CH, order_id: 101 }, k.deps);
        const ap2 = await run({ op: 'apply', order_id: 101, backup_id: b2.backup_id, patch: { status: 'OUTOFSTOCK' } }, k.deps);
        ok(ap2.ok && ap2.unexpected_paths.length === 0 && ap2.changed_paths.some(p => /optionCombinations\[0\]\.stockQuantity/.test(p)), '품절 → 옵션 재고 0 은 예상 범위', ap2);
        const rv2 = await run({ op: 'revert', order_id: 101, backup_id: b2.backup_id }, k.deps);
        ok(rv2.ok && rv2.same_as_before && rv2.steps[0] === 'channel', '품절 되돌리기 = 통째 PUT(옵션 재고) 먼저(상태가 남으면 change-status) · 잔여 0', rv2);
        // 통째 PUT 이 상태를 안 되돌리는 네이버라도 change-status 가 이어서 맞춤
        const k2 = mk();
        const b4 = await run({ op: 'backup', product_no: CH, order_id: 101 }, k2.deps);
        await run({ op: 'apply', order_id: 101, backup_id: b4.backup_id, patch: { status: 'OUTOFSTOCK' } }, k2.deps);
        k2.nv.call = (orig => async (req) => { if (req.method === 'PUT' && /channel-products/.test(req.path)) { const keep = k2.nv.product.originProduct.statusType; const r = await orig(req); k2.nv.product.originProduct.statusType = keep; return r; } return orig(req); })(k2.nv.call);
        const rv4 = await quiet(() => run({ op: 'revert', order_id: 101, backup_id: b4.backup_id }, { pool: k2.db, call: k2.nv.call, audit }));
        ok(rv4.ok && rv4.same_as_before && rv4.steps.join() === 'channel,status' && rv4.status_after_put === 'OUTOFSTOCK' && k2.nv.statusPuts.length === 1 && JSON.stringify(k2.nv.statusPuts[0]) === '{"statusType":"SALE"}'
            && rv4.sale_attempts.map(x => x.via + ':' + x.code + ':' + x.status_after).join() === 'channel:null:OUTOFSTOCK,change-status:null:SALE' && rv4.sale_ok.ok,
            '#721-B 안전망: 통째 PUT 뒤 품절이면 change-status SALE 1회 → 판매 · attempts 두 줄', rv4);
        // 안전망도 400 이면 오류 · attempts 에 두 code · 재고 복원 ✓ · 상태 남음
        const k3 = mk(null, { statusFromOut400: true });
        const b5 = await run({ op: 'backup', product_no: CH, order_id: 101 }, k3.deps);
        await run({ op: 'apply', order_id: 101, backup_id: b5.backup_id, patch: { status: 'OUTOFSTOCK' } }, k3.deps);
        k3.nv.call = (orig => async (req) => { if (req.method === 'PUT' && /channel-products/.test(req.path)) { const keep = k3.nv.product.originProduct.statusType; const r = await orig(req); k3.nv.product.originProduct.statusType = keep; return r; } return orig(req); })(k3.nv.call);
        const rv5 = await quiet(() => run({ op: 'revert', order_id: 101, backup_id: b5.backup_id }, { pool: k3.db, call: k3.nv.call, audit }));
        ok(!rv5.ok && rv5.steps_done.join() === 'channel' && rv5.attempts.map(x => x.via + ':' + x.code).join() === 'channel:null,change-status:400' && rv5.stock_restored === true && rv5.status_now === 'OUTOFSTOCK' && /판매중이 아님/.test(rv5.note) && !k3.db.backups[0].reverted_at,
            '안전망 400 → 오류 · attempts(channel·change-status 400) · 재고 복원 ✓ · 상태 남음 · reverted_at 없음', rv5);
        // 원상품 번호를 못 푼 보관본
        const n = mk(null, { noOrigin: true });
        const b3 = await run({ op: 'backup', product_no: CH, order_id: 101 }, n.deps);
        ok(b3.ok && b3.origin_product_no === null, '원상품 번호 못 풀어도 보관은 됨');
        const ap3 = await run({ op: 'apply', order_id: 101, backup_id: b3.backup_id, patch: { status: 'SUSPENSION' } }, n.deps);
        ok(!ap3.ok && /원상품 번호/.test(ap3.error) && n.nv.statusPuts.length === 0, '그 보관본으로 상태 변경 거절');
    }

    console.log('②-b 재조회가 다른 칸까지 바뀌면 unexpected · 신선도');
    {
        const { nv, deps } = mk(null, { sideEffect: (p) => { p.originProduct.detailAttribute.optionInfo.optionCombinations[0].price = 1000; } });
        const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, deps);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { detail_html: NEW_HTML } }, deps);
        ok(ap.ok, 'apply 자체는 성공(보고만)', ap);
        ok(ap.unexpected_paths.length === 1 && ap.unexpected_paths[0] === 'originProduct.detailAttribute.optionInfo.optionCombinations[0].price', 'unexpected = 옵션 0 가격', ap.unexpected_paths);
        const k = mk();
        const b2 = await run({ op: 'backup', product_no: CH, order_id: 101 }, k.deps);
        k.nv.product.originProduct.salePrice = 25000;   // 사람이 네이버에서 고친 척
        const ap2 = await run({ op: 'apply', order_id: 101, backup_id: b2.backup_id, patch: { detail_html: NEW_HTML } }, k.deps);
        ok(!ap2.ok && ap2.drift_paths && ap2.drift_paths[0] === 'originProduct.salePrice' && k.nv.puts.length === 0, '보관 뒤 바뀐 상품엔 PUT 안 함(drift)', ap2);
        // revert 전에 또 바뀌면 force 없이 거절
        const m = mk();
        const b3 = await run({ op: 'backup', product_no: CH, order_id: 101 }, m.deps);
        await run({ op: 'apply', order_id: 101, backup_id: b3.backup_id, patch: { detail_html: NEW_HTML } }, m.deps);
        m.nv.product.originProduct.name = '누가 고침';
        const rv = await run({ op: 'revert', order_id: 101, backup_id: b3.backup_id }, m.deps);
        ok(!rv.ok && /force/.test(rv.error) && m.nv.puts.length === 1, '적용 뒤 또 바뀌면 revert 거절(force 없이)');
        const rv2 = await run({ op: 'revert', order_id: 101, backup_id: b3.backup_id, force: true }, m.deps);
        ok(rv2.ok && m.nv.product.originProduct.detailContent === PRODUCT.originProduct.detailContent && m.nv.product.originProduct.name === '누가 고침'
            && rv2.residual_paths.join() === 'originProduct.name', 'force 면 우리 칸(상세)만 되돌리고 남의 변경(이름)은 유지 · 잔여로 보고', rv2);
    }

    console.log('④ 허용 밖 칸·재고·반려 지시·꼴 거절');
    {
        const { nv, deps } = mk();
        const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, deps);
        const t = async (patch, re, name) => { const x = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch }, deps); ok(!x.ok && re.test(x.error), name, x); };
        await t({ salePrice: 1 }, /허용되지 않은 칸/, '화이트리스트 밖 키(salePrice) 거절');
        await t({ stock: 10 }, /재고는 옵션별로/, '상품 단위 재고 = 「옵션별로」 고정 문구로 거절');
        await t({}, /비었/, '빈 patch 거절');
        await t({ status: 'DELETE' }, /판매 상태/, '판매 상태 꼴 밖 거절');
        await t({ status: 'SALE' }, /이미 SALE/, '같은 상태 거절');
        await t({ detail_html: '<html><p>x</p></html>' }, /쓸 수 없는 태그/, '상세 금지 태그(html) 거절');
        await t({ detail_html: '<script>x</script>' }, /쓸 수 없는 태그/, '상세 금지 태그(script) 거절');
        await t({ detail_html: 'a'.repeat(320001) }, /너무 길/, '상세 320,000자 초과 거절');
        const x5 = await run({ op: 'backup', product_no: CH, order_id: 102 }, deps);
        ok(!x5.ok && /반려/.test(x5.error), '반려 지시 거절');
        const x6 = await run({ op: 'backup', product_no: CH, order_id: 999 }, deps);
        ok(!x6.ok && /찾지 못/.test(x6.error), '없는 지시 거절');
        const x7 = await run({ op: 'apply', product_no: '1111', order_id: 101, backup_id: b.backup_id, patch: { detail_html: NEW_HTML } }, deps);
        ok(!x7.ok && /상품 번호/.test(x7.error), '보관본과 다른 상품 번호 거절');
        ok(nv.puts.length === 0 && nv.statusPuts.length === 0, '거절된 요청은 쓰기 0');
        // 품절 → 판매인데 보관본 재고 0 = 거절(#721-B · 옵션 재고 입력은 다음 차례)
        const out0 = JSON.parse(JSON.stringify(PRODUCT)); out0.originProduct.statusType = 'OUTOFSTOCK'; out0.originProduct.stockQuantity = 0;
        for (const o of out0.originProduct.detailAttribute.optionInfo.optionCombinations) o.stockQuantity = 0;
        const s = mk(out0);
        const bs = await run({ op: 'backup', product_no: CH, order_id: 101 }, s.deps);
        const xs = await run({ op: 'apply', order_id: 101, backup_id: bs.backup_id, patch: { status: 'SALE' } }, s.deps);
        ok(!xs.ok && /품절 → 판매는 재고가 있어야/.test(xs.error) && s.nv.statusPuts.length === 0, '품절 → 판매 · 보관본 재고 0 이면 거절(쓰기 0)', xs);
        // 카탈로그 매칭 상품은 naverShoppingSearchInfo 를 빼고 보냄
        const cat = JSON.parse(JSON.stringify(PRODUCT)); cat.originProduct.detailAttribute.naverShoppingSearchInfo.catalogMatchingYn = true;
        const c = mk(cat);
        const bc = await run({ op: 'backup', product_no: CH, order_id: 101 }, c.deps);
        await quiet(() => run({ op: 'apply', order_id: 101, backup_id: bc.backup_id, patch: { detail_html: NEW_HTML } }, c.deps));
        ok(c.nv.puts[0] && !('naverShoppingSearchInfo' in c.nv.puts[0].originProduct.detailAttribute), '카탈로그 매칭 → naverShoppingSearchInfo 빼고 PUT');
    }

    console.log('⑤ 같은 상품 동시 거절');
    {
        const { nv, deps } = mk(null, { delay: 30 });
        const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, deps);
        const [p1, p2] = await Promise.all([
            run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { detail_html: NEW_HTML } }, deps),
            run({ op: 'backup', product_no: CH, order_id: 101 }, deps),
        ]);
        const won = [p1, p2].filter(x => x.ok), lost = [p1, p2].filter(x => !x.ok);
        ok(won.length === 1 && lost.length === 1 && /진행 중/.test(lost[0].error), '동시 둘 중 하나만 · 나머지 「진행 중」 거절', [p1, p2]);
        ok(nv.puts.length <= 1, '동시 요청에도 PUT 최대 1회');
        const p3 = await run({ op: 'backup', product_no: CH, order_id: 101 }, deps);
        ok(p3.ok, '끝난 뒤엔 다시 됨(잠금 풀림)');
    }

    console.log('⑥ 그림 올리기');
    {
        const { nv, deps } = mk(null, { delay: 20 });
        const u1 = await run({ op: 'upload_image', order_id: 201, order_ids: [201] }, deps);
        ok(u1.ok && u1.urls.length === 1, '그림 1장 올림 → url 1', u1);
        ok(nv.calls[nv.calls.length - 1] === 'POST /external/v1/product-images/upload', '경로 = product-images/upload');
        const u2 = await run({ op: 'upload_image', order_id: 201, order_ids: [202] }, deps);
        ok(!u2.ok && /그림/.test(u2.error), 'PDF 첨부 거절');
        const u3 = await run({ op: 'upload_image', order_id: 201, order_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, deps);
        ok(!u3.ok && /10장/.test(u3.error), '11장 거절');
        const u4 = await run({ op: 'upload_image', order_id: 201, order_ids: [203] }, deps);
        ok(!u4.ok && /10MB/.test(u4.error), '합계 10MB 초과 거절');
        const [q1, q2] = await Promise.all([run({ op: 'upload_image', order_id: 201, order_ids: [201] }, deps), run({ op: 'upload_image', order_id: 201, order_ids: [201] }, deps)]);
        ok([q1, q2].filter(x => x.ok).length === 1 && /진행 중/.test([q1, q2].find(x => !x.ok).error), '그림 올리기 동시 1건만');
    }

    console.log('⑦ 네이버 오류 원문은 응답에 안 나감 · 칸 이름은 보관본에');
    {
        const db = fakePool(ORDERS);
        const call = async () => { const e = new Error('naver_relay_error_400'); e.status = 400; e.data = { message: '비밀 원문 SECRET' }; throw e; };
        const r = await quiet(() => run({ op: 'backup', product_no: CH, order_id: 101 }, { pool: db, call, audit }));
        ok(!r.ok && r.code === 400 && !JSON.stringify(r).includes('SECRET'), '고정 문구 + 코드만', r);
        const k = mk(null, {});
        const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, k.deps);
        k.nv.call = (orig => async (req) => { if (req.method === 'PUT') { const e = new Error('naver_relay_error_400'); e.status = 400; e.data = { message: '원문', invalidInputs: [{ name: 'originProduct.foo' }] }; throw e; } return orig(req); })(k.nv.call);
        const r2 = await quiet(() => run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { detail_html: NEW_HTML } }, { pool: k.db, call: k.nv.call, audit }));
        const row = k.db.backups.find(x => x.id === b.backup_id);
        ok(!r2.ok && r2.code === 400 && !row.applied_at && JSON.stringify(row.result_json.invalid_fields) === '["originProduct.foo"]' && !JSON.stringify(r2).includes('foo'), 'PUT 400 → 적용 안 됨 · invalid_fields 는 보관본에만', [r2, row.result_json]);
    }

    console.log('⑧ 손질 1바퀴(워커2 점검): audit targetId · 승인 강제 · 그림 60초 · revert 는 지금 값 위에 · 금지 태그 증가만 · 호출 간격');
    {
        ok(audits.length > 0 && audits.every(x => x.targetId === null || (Number.isInteger(x.targetId) && x.targetId < 2 ** 31)), 'audit targetId = null 또는 2^31 미만(INTEGER 칸)', audits.map(x => x.targetId).slice(0, 5));
        ok(audits.filter(x => x.action !== 'naver_product_image_upload').every(x => x.changes && x.changes.product_no === CH), '상품 번호는 changes.product_no 에');
        // 승인 강제
        const k = mk();
        const b = await run({ op: 'backup', product_no: CH, order_id: 103 }, k.deps);
        ok(b.ok, '직원 지시 backup(읽기)은 됨');
        const x1 = await run({ op: 'apply', order_id: 103, backup_id: b.backup_id, patch: { detail_html: NEW_HTML } }, k.deps);
        ok(!x1.ok && x1.error === '승인 뒤 실행' && k.nv.puts.length === 0, '승인 없는 직원 지시 apply 거절(쓰기 0)', x1);
        const x2 = await run({ op: 'apply', order_id: 104, backup_id: b.backup_id, patch: { detail_html: NEW_HTML } }, k.deps);
        ok(x2.ok, '[승인] 받은 직원 지시 apply 됨', x2);
        k.nv.product.originProduct.name = '누가 고침';
        const x3 = await run({ op: 'revert', order_id: 103, backup_id: b.backup_id, force: true }, k.deps);
        ok(!x3.ok && x3.error === '승인 뒤 실행', '승인 없는 revert force 거절');
        const t = mk();
        const bt = await run({ op: 'backup', product_no: CH, order_id: 105 }, t.deps);
        const xt = await run({ op: 'apply', order_id: 105, backup_id: bt.backup_id, patch: { detail_html: NEW_HTML } }, t.deps);
        ok(xt.ok, '시험 번호 계정(≥990000) 지시는 통과', xt);
        // 그림 60초
        const seen = []; const g = mk();
        const callSpy = async (r) => { seen.push(r); return g.nv.call(r); };
        await run({ op: 'upload_image', order_id: 201, order_ids: [201] }, { pool: g.db, call: callSpy, audit });
        ok(seen[0] && seen[0].timeoutMs === 60000, '그림 올리기 요청 timeoutMs 60000');
        // revert = 지금 값 위에 — 사이에 팔려 줄어든 옵션 재고는 유지, 상세만 복원
        const r = mk();
        const br = await run({ op: 'backup', product_no: CH, order_id: 101 }, r.deps);
        r.nv.product.originProduct.detailAttribute.optionInfo.optionCombinations[0].stockQuantity = 17;   // 보관 뒤 팔림
        const ar = await run({ op: 'apply', order_id: 101, backup_id: br.backup_id, patch: { detail_html: NEW_HTML } }, r.deps);
        ok(ar.ok && ar.unexpected_paths.length === 0 && r.nv.puts[0].originProduct.detailAttribute.optionInfo.optionCombinations[0].stockQuantity === 17, 'apply 바디 = 지금 값(팔린 재고 17 유지) · 재고 변동은 drift 아님', ar);
        r.nv.product.originProduct.detailAttribute.optionInfo.optionCombinations[0].stockQuantity = 15;   // 적용 뒤 또 팔림
        const rr = await run({ op: 'revert', order_id: 101, backup_id: br.backup_id }, r.deps);
        const op = r.nv.product.originProduct;
        ok(rr.ok && rr.same_as_before && op.detailContent === PRODUCT.originProduct.detailContent && op.detailAttribute.optionInfo.optionCombinations[0].stockQuantity === 15, 'revert 뒤 상세만 복원 · 줄어든 재고 15 유지', rr);
        ok(rr.stock_paths.includes('originProduct.detailAttribute.optionInfo.optionCombinations[0].stockQuantity'), '재고 차이는 stock_paths 로 따로 보고');
        // 품절 되돌림: 0 된 조합만 보관본 값 · 품절 뒤 재고가 따로 채워진 조합은 안 덮음
        const s2 = mk();
        const bs2 = await run({ op: 'backup', product_no: CH, order_id: 101 }, s2.deps);
        await run({ op: 'apply', order_id: 101, backup_id: bs2.backup_id, patch: { status: 'OUTOFSTOCK' } }, s2.deps);
        s2.nv.product.originProduct.detailAttribute.optionInfo.optionCombinations[1].stockQuantity = 5;   // 품절 중 사람이 한 조합만 채움
        const rs2 = await run({ op: 'revert', order_id: 101, backup_id: bs2.backup_id }, s2.deps);
        const oc2 = s2.nv.product.originProduct.detailAttribute.optionInfo.optionCombinations;
        ok(rs2.ok && oc2[0].stockQuantity === 20 && oc2[1].stockQuantity === 5, '품절 되돌림 = 0 된 조합만 20 복원 · 사람이 채운 5 유지', [rs2, oc2.map(o => o.stockQuantity)]);
        // 상태만(SUSPENSION) 되돌림은 통째 PUT 없음
        const s3 = mk();
        const bs3 = await run({ op: 'backup', product_no: CH, order_id: 101 }, s3.deps);
        await run({ op: 'apply', order_id: 101, backup_id: bs3.backup_id, patch: { status: 'SUSPENSION' } }, s3.deps);
        const rs3 = await run({ op: 'revert', order_id: 101, backup_id: bs3.backup_id }, s3.deps);
        ok(rs3.ok && rs3.steps.join() === 'status' && s3.nv.puts.length === 0, '판매중지 되돌림 = change-status 하나(통째 PUT 0)');
        // 금지 태그 = 보관본보다 늘었을 때만
        const styled = JSON.parse(JSON.stringify(PRODUCT)); styled.originProduct.detailContent = '<style>.a{}</style><p>본문</p>';
        const st = mk(styled);
        const bst = await run({ op: 'backup', product_no: CH, order_id: 101 }, st.deps);
        const keep = await run({ op: 'apply', order_id: 101, backup_id: bst.backup_id, patch: { detail_html: '<style>.a{}</style><p>본문 고침</p>' } }, st.deps);
        ok(keep.ok, '원래 있던 style 1개 그대로면 통과', keep);
        const st2 = mk(styled);
        const bst2 = await run({ op: 'backup', product_no: CH, order_id: 101 }, st2.deps);
        const more = await run({ op: 'apply', order_id: 101, backup_id: bst2.backup_id, patch: { detail_html: '<style>.a{}</style><style>.b{}</style><p>x</p>' } }, st2.deps);
        ok(!more.ok && /style/.test(more.error), 'style 이 늘면 거절', more);
        // 호출 간격
        const gp = mk(); const t0 = Date.now();
        await mod.naverProductWriteRun({ op: 'backup', product_no: CH, order_id: 101 }, { ...gp.deps, gapMs: 60 });   // GET + search = 2콜
        ok(Date.now() - t0 >= 55, '호출 사이 간격 적용(gapMs)', Date.now() - t0);
    }

    console.log('⑨ #720-D 상세 잠금 · #721-B 통째 PUT 잠금(put_enabled) · 판매중지/재개는 늘 열림 · 시험 계정 통과');
    {
        for (const [cfg, name, re] of [[null, '설정 행 없음', /통째 수정은 네이버가/], [{ detail_enabled: true }, 'put_enabled 없음', /통째 수정은 네이버가/], [{ put_enabled: true, detail_enabled: false }, 'put_enabled · detail_enabled false', /상세 수정은 대표 확정 대기/]]) {
            const db = fakePool(ORDERS, cfg), nv = fakeNaver(PRODUCT);
            const deps = { pool: db, call: nv.call, audit };
            const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, deps);
            const x = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { detail_html: NEW_HTML } }, deps);
            ok(!x.ok && re.test(x.error) && nv.puts.length === 0 && !db.backups[0].applied_at, `${name} → 상세 apply 거절(쓰기 0 · 적용 표시 0)`, x);
            const y = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { status: 'SUSPENSION' } }, deps);
            ok(y.ok && nv.statusPuts.length === 1, `${name} → 판매 상태 apply 는 됨`, y);
        }
        // 잠금 아래: 옵션·판매가·품목명·품절 걸기도 거절 · 판매중지만 됨
        {
            const db = fakePool(ORDERS, null), nv = fakeNaver(PRODUCT);
            const deps = { pool: db, call: nv.call, audit };
            const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, deps);
            for (const [p, nm] of [[{ options: [{ id: 1, stock: 19 }] }, '옵션 재고'], [{ sale_price: 28000 }, '판매가'], [{ name: '새 이름' }, '품목명'], [{ status: 'OUTOFSTOCK' }, '품절 걸기']]) {
                const x = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: p }, deps);
                ok(!x.ok && /통째 수정은 네이버가/.test(x.error), `잠금 → ${nm} 거절`, x);
            }
            ok(nv.puts.length === 0 && !db.backups[0].applied_at, '잠금 거절들 = 쓰기 0');
            // 시험 번호 계정(≥990000) 지시는 잠금 통과(상세 포함)
            const bt = await run({ op: 'backup', product_no: CH, order_id: 105 }, deps);
            const xt = await run({ op: 'apply', order_id: 105, backup_id: bt.backup_id, patch: { detail_html: NEW_HTML, options: [{ id: 1, stock: 19 }] } }, deps);
            ok(xt.ok && nv.puts.length === 1, '시험 계정 지시 = 잠금 통과(상세+옵션)', xt);
            const rt = await run({ op: 'revert', order_id: 105, backup_id: bt.backup_id }, deps);
            ok(rt.ok && rt.same_as_before, '잠금 아래에서도 revert 는 됨', rt);
        }
    }

    console.log('⑩ #721-B 품절 → 판매 복귀 · 「판매 정상 확인」(sale_ok)');
    {
        const first = (x) => x.originProduct.detailAttribute.optionInfo.optionCombinations;
        // backup 에 건들기 전 sale_ok
        const k = mk();
        const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, k.deps);
        ok(b.sale_ok && b.sale_ok.ok === true && b.sale_ok.bad.length === 0 && b.sale_ok.stock_total === 50 && b.sale_ok.status === 'SALE', 'backup 결과 sale_ok = ✓(판매중 · 재고 50)', b.sale_ok);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { status: 'OUTOFSTOCK' } }, k.deps);
        ok(ap.ok && ap.sale_ok.ok === false && ap.sale_ok.bad.join() === 'status,stock', '품절 apply 뒤 sale_ok = ⚠ status·stock 만(가격·상세·그림 그대로)', ap.sale_ok);
        const rv = await run({ op: 'revert', order_id: 101, backup_id: b.backup_id }, k.deps);
        const putOut = k.nv.puts[0], put0 = k.nv.puts[1];
        ok(ap.steps.join() === 'channel' && putOut.originProduct.statusType === 'SALE' && first(putOut).every(o => o.stockQuantity === 0) && ap.not_applied.length === 0 && ap.after_summary.status === 'OUTOFSTOCK', '실측 반영(10/17 레드키위 400 statusType): 품절 걸기 = 통째 PUT 재고 0 만(바디 statusType 그대로) → 재조회 OUTOFSTOCK', [ap.steps, putOut && putOut.originProduct.statusType]);
        ok(rv.ok && rv.steps.join() === 'channel,status' && rv.status_after_put === 'OUTOFSTOCK' && k.nv.statusPuts.length === 1 && JSON.stringify(k.nv.statusPuts[0]) === '{"statusType":"SALE"}', '복귀 = 통째 PUT 재고만 → 품절 그대로면 change-status SALE 안전망', [rv, k.nv.statusPuts]);
        ok(put0.originProduct.statusType === 'OUTOFSTOCK' && first(put0).map(o => o.stockQuantity).join() === '20,30' && put0.originProduct.stockQuantity === 0, '복귀 PUT 바디 = 옵션 재고 20·30 · statusType 은 지금 값(안 바꿈) · 상품 단위 재고 안 고침', put0 && put0.originProduct);
        ok(rv.same_as_before && rv.sale_ok.ok === true && JSON.stringify(k.nv.product) === JSON.stringify(PRODUCT), '복귀 뒤 sale_ok ✓ · 잔여 0 · 상품 = 원본', rv.sale_ok);
        ok(k.db.backups[0].result_json.revert_sale_ok.ok === true && k.db.backups[0].result_json.revert_status_after_put === 'OUTOFSTOCK', '보관본 result_json 에 revert_sale_ok · status_after_put');
        // change-status 로 품절 복귀를 하는 네이버(400)여도 안 씀 → 통과
        const n = mk(null, { statusFromOut400: true, putAutoSale: true });
        const bn = await run({ op: 'backup', product_no: CH, order_id: 101 }, n.deps);
        await run({ op: 'apply', order_id: 101, backup_id: bn.backup_id, patch: { status: 'OUTOFSTOCK' } }, n.deps);
        const rn = await run({ op: 'revert', order_id: 101, backup_id: bn.backup_id }, n.deps);
        ok(rn.ok && rn.sale_ok.ok && n.nv.statusPuts.length === 0 && rn.status_after_put === 'SALE' && rn.steps.join() === 'channel', '재고 채우면 네이버가 판매로 되돌리는 경우 = PUT 하나로 끝 · change-status 0', rn);
        // 판매중지 되돌림은 종전대로 change-status statusType 하나
        const u = mk();
        const bu = await run({ op: 'backup', product_no: CH, order_id: 101 }, u.deps);
        await run({ op: 'apply', order_id: 101, backup_id: bu.backup_id, patch: { status: 'SUSPENSION' } }, u.deps);
        const ru = await run({ op: 'revert', order_id: 101, backup_id: bu.backup_id }, u.deps);
        ok(ru.ok && JSON.stringify(u.nv.statusPuts[1]) === '{"statusType":"SALE"}' && u.nv.puts.length === 0 && ru.sale_ok.ok, '판매중지 → 판매 = change-status statusType 하나 · sale_ok ✓', u.nv.statusPuts);
        // 재고가 0 으로 들어가 네이버가 품절 유지 → 오류 + 「재고 0 이라 품절 유지」 · 되돌림 표시 안 함
        const fo = {}; const f = mk(null, fo);
        const bf = await run({ op: 'backup', product_no: CH, order_id: 101 }, f.deps);
        await run({ op: 'apply', order_id: 101, backup_id: bf.backup_id, patch: { status: 'OUTOFSTOCK' } }, f.deps);
        fo.putZeroStock = true;
        const rf = await quiet(() => run({ op: 'revert', order_id: 101, backup_id: bf.backup_id }, f.deps));
        const rowf = f.db.backups[0];
        ok(!rf.ok && rf.steps_done.join() === 'channel,status' && rf.attempts.length === 2 && rf.stock_restored === false && rf.status_now === 'OUTOFSTOCK' && rf.note === '재고 0 이라 품절 유지', '재고 0 → 「재고 0 이라 품절 유지」 · 재고 복원 ✗ · 상태 남음', rf);
        ok(rf.sale_ok && rf.sale_ok.bad.join() === 'status,stock' && !rowf.reverted_at && rowf.result_json.revert_failed, 'sale_ok ⚠ status·stock · reverted_at 없음 · 보관본에 revert_failed', [rf.sale_ok, rowf.result_json]);
        // 통째 PUT 400 → 지금 상태 나눠 보고 · 원문 안 나감
        const qo = {}; const q = mk(null, qo);
        const bq = await run({ op: 'backup', product_no: CH, order_id: 101 }, q.deps);
        await run({ op: 'apply', order_id: 101, backup_id: bq.backup_id, patch: { status: 'OUTOFSTOCK' } }, q.deps);
        qo.putFail = true;
        const rq = await quiet(() => run({ op: 'revert', order_id: 101, backup_id: bq.backup_id }, q.deps));
        ok(!rq.ok && rq.code === 400 && rq.steps_done.length === 0 && rq.status_now === 'OUTOFSTOCK' && rq.stock_restored === false && !JSON.stringify(rq).includes('원문'), 'PUT 400 → 쓰기 0 · 품절 그대로 · 원문 안 나감', rq);
        // apply 품절 → 판매(보관본 재고 있음) = change-status SALE + 재고 합
        const os = JSON.parse(JSON.stringify(PRODUCT)); os.originProduct.statusType = 'OUTOFSTOCK';
        const o = mk(os);
        const bo = await run({ op: 'backup', product_no: CH, order_id: 101 }, o.deps);
        ok(bo.sale_ok.ok === false && bo.sale_ok.bad.join() === 'status', '품절 상품 backup sale_ok = ⚠ status', bo.sale_ok);
        const ao = await run({ op: 'apply', order_id: 101, backup_id: bo.backup_id, patch: { status: 'SALE' } }, o.deps);
        ok(ao.ok && ao.steps.join() === 'channel,status' && o.nv.statusPuts.length === 1 && o.nv.puts[0].originProduct.statusType === 'OUTOFSTOCK' && ao.sale_ok.ok && ao.unexpected_paths.length === 0 && o.db.backups[0].applied_at, 'apply 품절 → 판매 = 통째 PUT(재고만) → change-status SALE · sale_ok ✓ · 적용 표시', [ao, o.nv.statusPuts]);
        // sale_ok 가 잡는 칸 — 옵션 가격 · 대표 그림 · 옵션 usable
        const g = mk(null, { sideEffect: (x) => { first(x)[0].price = 1000; x.originProduct.images.representativeImage.url = 'https://x/9.jpg'; first(x)[1].usable = false; } });
        const bg = await run({ op: 'backup', product_no: CH, order_id: 101 }, g.deps);
        const ag = await run({ op: 'apply', order_id: 101, backup_id: bg.backup_id, patch: { detail_html: NEW_HTML } }, g.deps);
        ok(ag.ok && ag.sale_ok.ok === false && ag.sale_ok.bad.join() === 'options_usable,option_price,rep_image', 'sale_ok ⚠ = usable·옵션 가격·대표 그림을 칸 이름으로 · 바꾼 상세는 ref(보관본+patch)와 같아 bad 아님', ag.sale_ok);
    }

    console.log('⑪ #721-B3 옵션·단가·품목명 · 재고만 넣어 판매 복귀 · 거절 상한');
    {
        const OC = (x) => x.originProduct.detailAttribute.optionInfo.optionCombinations;
        const OP = '/^originProduct\\.detailAttribute\\.optionInfo\\.optionCombinations/';
        // 판매가 + 옵션 추가금 + 품목명 = 통째 PUT 한 번 · 할인 칸 그대로 · 되돌리면 원본
        const P2 = JSON.parse(JSON.stringify(PRODUCT));
        P2.originProduct.customerBenefit = { immediateDiscountPolicy: { discountMethod: { value: 1000, unitType: 'WON' } } };
        P2.smartstoreChannelProduct.channelProductName = '하우스감귤';
        const k = mk(P2);
        const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, k.deps);
        const patch = { sale_price: 30000, name: '제주 하우스감귤', options: [{ id: 2, price: 10000 }] };
        const ap = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch }, k.deps);
        const put = k.nv.puts[0];
        ok(ap.ok && ap.steps.join() === 'channel' && k.nv.puts.length === 1 && k.nv.statusPuts.length === 0, '판매가·품목명·옵션 = 통째 PUT 한 번(change-status 0)', ap);
        ok(put.originProduct.salePrice === 30000 && put.originProduct.name === '제주 하우스감귤' && put.smartstoreChannelProduct.channelProductName === '제주 하우스감귤' && OC(put)[1].price === 10000 && OC(put)[0].price === 0
            && JSON.stringify(put.originProduct.customerBenefit) === JSON.stringify(P2.originProduct.customerBenefit) && OC(put)[1].stockQuantity === 30, 'PUT 바디 = 준 칸만(채널 상품명도 같은 글 · 할인·다른 옵션·재고 그대로)', put && put.originProduct);
        ok(['originProduct.salePrice', 'originProduct.name', 'smartstoreChannelProduct.channelProductName', 'originProduct.detailAttribute.optionInfo.optionCombinations[1].price'].every(p => ap.changed_paths.includes(p))
            && ap.unexpected_paths.length === 0 && ap.not_applied.length === 0 && ap.option_ids_kept === true, 'changed = 4칸 · unexpected 0 · not_applied 0 · 옵션 id 유지', ap.changed_paths);
        ok(ap.sale_ok.ok === true, 'sale_ok ref = 보관본+patch → 바꾼 가격은 bad 아님', ap.sale_ok);
        const row2 = ap.options_table.find(r => r.id === 2), row1 = ap.options_table.find(r => r.id === 1);
        ok(row2.before.pay === 37000 && row2.after.pay === 39000 && row2.changed.join() === 'price,pay' && row1.before.pay === 28000 && row1.after.pay === 29000 && row1.changed.join() === 'pay', '옵션 표 결제가 = 판매가 − 할인(원 1,000) + 추가금 · 전 → 후', ap.options_table);
        ok(ap.price_basis.sale_price_before === 29000 && ap.price_basis.sale_price_after === 30000 && ap.price_basis.discount.unitType === 'WON', 'price_basis', ap.price_basis);
        const rv = await run({ op: 'revert', order_id: 101, backup_id: b.backup_id }, k.deps);
        ok(rv.ok && rv.same_as_before && JSON.stringify(k.nv.product) === JSON.stringify(P2) && rv.steps.join() === 'channel' && rv.sale_ok.ok, '되돌리기 = 판매가·품목명·채널 상품명·추가금 보관본 값 · 상품 = 원본', rv);
        // 채널 상품명이 비어 있으면 원상품 이름만
        const e = mk();
        const be = await run({ op: 'backup', product_no: CH, order_id: 101 }, e.deps);
        await run({ op: 'apply', order_id: 101, backup_id: be.backup_id, patch: { name: '새 이름' } }, e.deps);
        ok(e.nv.puts[0].originProduct.name === '새 이름' && !('channelProductName' in e.nv.puts[0].smartstoreChannelProduct), '채널 상품명 빈 상품 = originProduct.name 만');
        // PERCENT 할인 결제가
        const P3 = JSON.parse(JSON.stringify(PRODUCT)); P3.originProduct.customerBenefit = { immediateDiscountPolicy: { discountMethod: { value: 10, unitType: 'PERCENT' } } };
        const pc = mk(P3);
        const bpc = await run({ op: 'backup', product_no: CH, order_id: 101 }, pc.deps);
        const apc = await run({ op: 'apply', order_id: 101, backup_id: bpc.backup_id, patch: { options: [{ id: 2, price: 9500 }] } }, pc.deps);
        ok(apc.ok && apc.options_table.find(r => r.id === 2).after.pay === 29000 - 2900 + 9500 && apc.options_table.find(r => r.id === 1).before.pay === 26100, '결제가 PERCENT = floor(판매가×10%) 차감', apc.options_table);
        // 옵션 재고 −1 → 기대 경로(stock_paths 아님) · 되돌리면 보관본 재고
        const s = mk();
        const bs = await run({ op: 'backup', product_no: CH, order_id: 101 }, s.deps);
        const as = await run({ op: 'apply', order_id: 101, backup_id: bs.backup_id, patch: { options: [{ id: 1, stock: 19 }] } }, s.deps);
        ok(as.ok && as.changed_paths.includes('originProduct.detailAttribute.optionInfo.optionCombinations[0].stockQuantity') && as.unexpected_paths.length === 0 && as.stock_paths.length === 0 && OC(s.nv.product)[0].stockQuantity === 19 && OC(s.nv.product)[1].stockQuantity === 30, '옵션 재고 −1 = 그 옵션만 · 기대 경로 · 상품 재고 합 변화도 기대', as);
        const rs = await run({ op: 'revert', order_id: 101, backup_id: bs.backup_id }, s.deps);
        ok(rs.ok && rs.same_as_before && OC(s.nv.product)[0].stockQuantity === 20 && rs.sale_ok.ok, '되돌리면 그 옵션 재고 20(보관본)', rs);
        // 숨김 = usable:false · sale_ok 는 ref 에도 숨김이라 bad 아님
        const h = mk();
        const bh = await run({ op: 'backup', product_no: CH, order_id: 101 }, h.deps);
        const ah = await run({ op: 'apply', order_id: 101, backup_id: bh.backup_id, patch: { options: [{ id: 2, usable: false }] } }, h.deps);
        ok(ah.ok && OC(h.nv.product).length === 2 && OC(h.nv.product)[1].usable === false && ah.sale_ok.ok === true, '숨김 = usable:false(배열에서 안 뺌) · 일부러 숨긴 옵션은 sale_ok bad 아님', ah.sale_ok);
        const bh2 = await run({ op: 'backup', product_no: CH, order_id: 101 }, h.deps);
        ok(bh2.sale_ok.ok === true, '숨긴 옵션이 있는 상품도 backup sale_ok ✓(영원히 ⚠ 아님)', bh2.sale_ok);
        // 재조회에서 옵션 id·관리코드가 바뀌면 unexpected 'option_regenerated'
        const g = mk(null, { sideEffect: (x) => { OC(x)[0].sellerManagerCode = 'NEW'; } });
        const bg = await run({ op: 'backup', product_no: CH, order_id: 101 }, g.deps);
        const ag = await run({ op: 'apply', order_id: 101, backup_id: bg.backup_id, patch: { options: [{ id: 2, price: 9100 }] } }, g.deps);
        ok(ag.ok && ag.option_ids_kept === false && ag.unexpected_paths.includes('option_regenerated:1'), '옵션 관리코드 바뀜 → option_regenerated · option_ids_kept false', ag);
        // 품절 상품에 재고만 넣기 = 판매 복귀 길(auto_sale) · 되돌리면 다시 품절
        const O0 = JSON.parse(JSON.stringify(PRODUCT)); O0.originProduct.statusType = 'OUTOFSTOCK'; O0.originProduct.stockQuantity = 0; for (const o of OC(O0)) o.stockQuantity = 0;
        const a0 = mk(O0);
        const ba = await run({ op: 'backup', product_no: CH, order_id: 101 }, a0.deps);
        const aa = await run({ op: 'apply', order_id: 101, backup_id: ba.backup_id, patch: { options: [{ id: 1, stock: 5 }] } }, a0.deps);
        ok(aa.ok && aa.auto_sale === true && aa.steps.join() === 'channel,status' && a0.nv.product.originProduct.statusType === 'SALE' && OC(a0.nv.product)[0].stockQuantity === 5 && OC(a0.nv.product)[1].stockQuantity === 0 && aa.unexpected_paths.length === 0, '품절 + 재고만 = auto_sale(통째 PUT 재고 → change-status SALE) · 준 옵션만 재고', aa);
        const ra = await run({ op: 'revert', order_id: 101, backup_id: ba.backup_id }, a0.deps);
        ok(ra.ok && ra.same_as_before && a0.nv.product.originProduct.statusType === 'OUTOFSTOCK' && OC(a0.nv.product).every(o => o.stockQuantity === 0) && a0.nv.statusPuts.length === 1 && a0.nv.puts[a0.nv.puts.length - 1].originProduct.statusType === 'SALE', '되돌리기 = 통째 PUT 재고 0(바디 statusType 그대로) → 네이버가 품절 · change-status 추가 0', ra);
        // 품절 → 판매(status SALE) + 재고 같이
        const a1 = mk(O0);
        const bb = await run({ op: 'backup', product_no: CH, order_id: 101 }, a1.deps);
        const ab = await run({ op: 'apply', order_id: 101, backup_id: bb.backup_id, patch: { status: 'SALE', options: [{ id: 2, stock: 7 }] } }, a1.deps);
        ok(ab.ok && ab.auto_sale === false && a1.nv.product.originProduct.statusType === 'SALE' && OC(a1.nv.product)[1].stockQuantity === 7, '품절 → 판매 + 옵션 재고 = 한 번에', ab);
        // 판매중지 + 판매가 = PUT 먼저 → change-status
        const ss = mk();
        const bss = await run({ op: 'backup', product_no: CH, order_id: 101 }, ss.deps);
        const ass = await run({ op: 'apply', order_id: 101, backup_id: bss.backup_id, patch: { status: 'SUSPENSION', sale_price: 28000 } }, ss.deps);
        ok(ass.ok && ass.steps.join() === 'channel,status' && ss.nv.product.originProduct.salePrice === 28000 && ss.nv.product.originProduct.statusType === 'SUSPENSION', '판매중지 + 판매가 = 통째 PUT → change-status', ass);
        // 원상품 번호 없어도 품절 걸기는 됨(채널 번호 통째 PUT)
        const no = mk(null, { noOrigin: true });
        const bno = await run({ op: 'backup', product_no: CH, order_id: 101 }, no.deps);
        const ano = await run({ op: 'apply', order_id: 101, backup_id: bno.backup_id, patch: { status: 'OUTOFSTOCK' } }, no.deps);
        ok(ano.ok && no.nv.product.originProduct.statusType === 'OUTOFSTOCK', '원상품 번호 없어도 품절 걸기 됨(채널 통째 PUT)', ano);
        // 전이표: 품절 → 판매중지 거절(change-status 는 SALE↔SUSPENSION 만)
        const tz = mk(O0);
        const btz = await run({ op: 'backup', product_no: CH, order_id: 101 }, tz.deps);
        const xtz = await run({ op: 'apply', order_id: 101, backup_id: btz.backup_id, patch: { status: 'SUSPENSION' } }, tz.deps);
        ok(!xtz.ok && /바꿀 수 없는 전이/.test(xtz.error), '품절 → 판매중지 거절(전이표 정정)', xtz);
        // 거절 상한
        const r = mk();
        const br = await run({ op: 'backup', product_no: CH, order_id: 101 }, r.deps);
        const t = async (patch, re, name) => { const x = await run({ op: 'apply', order_id: 101, backup_id: br.backup_id, patch }, r.deps); ok(!x.ok && re.test(x.error), name, x); };
        await t({ options: [{ price: 1000 }] }, /새 옵션 추가/, '새 옵션(id 없음) 거절');
        await t({ options: [{ id: 99, price: 1000 }] }, /이 상품에 없어요/, '없는 옵션 id 거절');
        await t({ options: [{ id: 1, price: 100 }, { id: 1, price: 200 }] }, /두 번/, '같은 id 두 번 거절');
        await t({ options: [{ id: 2, price: 9000 }] }, /지금과 같은 값/, '같은 값 거절');
        await t({ options: [{ id: 1, price: 1.5 }] }, /정수/, '추가금 소수 거절');
        await t({ options: [{ id: 1, stock: -1 }] }, /0 이상 정수/, '재고 음수 거절');
        await t({ options: [{ id: 1, foo: 1 }] }, /허용되지 않은 칸 foo/, '옵션 모르는 칸 거절');
        await t({ options: [{ id: 1, name1: '' }] }, /1~50자/, '옵션명 빈 글 거절');
        await t({ options: Array.from({ length: 21 }, (_, i) => ({ id: i + 1, price: 1 })) }, /20개까지/, '옵션 21개 거절');
        await t({ options: [{ id: 1, price: 300000 }] }, /10배/, '결제가 10배 이상 거절');
        await t({ sale_price: 2000 }, /10배/, '결제가 1/10 이하 거절');
        await t({ sale_price: 0 }, /0 보다 큰 정수/, '판매가 0 거절');
        await t({ sale_price: 29000 }, /지금과 같아요/, '판매가 같은 값 거절');
        await t({ options: [{ id: 1, price: -29500 }] }, /0 이하/, '결제가 0 이하 거절');
        await t({ name: '' }, /품목명이 비었/, '품목명 빈 글 거절');
        await t({ name: 'x'.repeat(101) }, /100자/, '품목명 100자 초과 거절');
        await t({ status: 'OUTOFSTOCK', options: [{ id: 1, stock: 3 }] }, /같이 바꿀 수 없어요/, '품절 + 옵션 재고 거절');
        await t({ customerBenefit: {} }, /허용되지 않은 칸/, '할인 칸 거절');
        ok(r.nv.puts.length === 0 && r.nv.statusPuts.length === 0, '거절된 요청은 쓰기 0');
        void OP;
    }

    console.log('⑫ #721-B 통째 PUT 상세 링크 보존 · 실패 step 이름 · 품절 판정');
    {
        // 스마트에디터 그림 링크(속성) · 이미 걸러진 링크(주석) 둘 다 → 일반 <a href> 로 PUT
        const LD = (u) => `{&quot;id&quot;:&quot;SE-1&quot;,&quot;linkUse&quot;:&quot;true&quot;,&quot;link&quot;:&quot;${u}&quot;}`;
        const PL = JSON.parse(JSON.stringify(PRODUCT));
        PL.originProduct.detailContent = `<p>글</p><a href="#" class="se-module-image-link" onclick="return false;" data-linktype="img" data-linkdata="${LD('https://smartstore.naver.com/akkome/products/1')}"><img src="https://x/a.jpg"></a>`
            + `<!-- Not Allowed Attribute Filtered ( onclick="return false;" data-linktype="img" data-linkdata="${LD('https://brand.naver.com/jejuakkome/products/2')}" ) --><a class="se-module-image-link"><img src="https://x/b.jpg"></a>`;
        const k = mk(PL);
        const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, k.deps);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { options: [{ id: 1, stock: 19 }] } }, k.deps);
        const d = k.nv.puts[0].originProduct.detailContent;
        ok(ap.ok && ap.links_converted === 2 && ap.links_after === 2 && /href="https:\/\/smartstore\.naver\.com\/akkome\/products\/1" target="_blank"/.test(d) && /href="https:\/\/brand\.naver\.com\/jejuakkome\/products\/2"/.test(d), '옵션만 바꾼 PUT 도 상세 링크 2개(속성·주석) → 일반 href · links_converted 2 · links_after 2', [ap.links_converted, ap.links_after]);
        ok(ap.unexpected_paths.includes('originProduct.detailContent'), '상세가 달라진 것은 숨기지 않고 unexpected 로 보고', ap.unexpected_paths);
        // 네이버가 일반 href 까지 지우면 links_after 0 으로 드러남
        const sk = mk(PL, { stripLinks: true });
        const bs = await run({ op: 'backup', product_no: CH, order_id: 101 }, sk.deps);
        const as = await run({ op: 'apply', order_id: 101, backup_id: bs.backup_id, patch: { options: [{ id: 1, stock: 19 }] } }, sk.deps);
        ok(as.ok && as.links_converted === 2 && as.links_after === 0, '네이버가 href 를 지우면 links_after 0(실측 판정 칸)', [as.links_converted, as.links_after]);
        // 링크 함수가 없는 deps(옛 호출)면 그대로 보냄
        const nl = mk(PL); delete nl.deps.convertImageLinks;
        const bnl = await run({ op: 'backup', product_no: CH, order_id: 101 }, nl.deps);
        const anl = await run({ op: 'apply', order_id: 101, backup_id: bnl.backup_id, patch: { options: [{ id: 1, stock: 19 }] } }, nl.deps);
        ok(anl.ok && anl.links_converted === 0 && nl.nv.puts[0].originProduct.detailContent === PL.originProduct.detailContent, 'convertImageLinks 없으면 상세 바이트 그대로', anl.links_converted);
        // 품절 걸기 PUT 실패 step 이름 = channel(종전 'detail' 오기)
        const fo = { putFail: true }; const f = mk(null, fo);
        const bf = await run({ op: 'backup', product_no: CH, order_id: 101 }, f.deps);
        await quiet(() => run({ op: 'apply', order_id: 101, backup_id: bf.backup_id, patch: { status: 'OUTOFSTOCK' } }, f.deps));
        ok(f.db.backups[0].result_json.step === 'channel' && !f.db.backups[0].applied_at, '품절 걸기 PUT 실패 step = channel · 적용 표시 0', f.db.backups[0].result_json);
        const f2 = mk(null, { putFail: true });
        const bf2 = await run({ op: 'backup', product_no: CH, order_id: 101 }, f2.deps);
        await quiet(() => run({ op: 'apply', order_id: 101, backup_id: bf2.backup_id, patch: { detail_html: NEW_HTML } }, f2.deps));
        ok(f2.db.backups[0].result_json.step === 'detail', '상세만 PUT 실패 step = detail(종전 이름 유지)', f2.db.backups[0].result_json);
        // 재고 0 으로 보냈는데 네이버가 판매중으로 두면 not_applied 'status'
        const z = mk(null, { sideEffect: (x) => { x.originProduct.statusType = 'SALE'; } });
        const bz = await run({ op: 'backup', product_no: CH, order_id: 101 }, z.deps);
        const az = await run({ op: 'apply', order_id: 101, backup_id: bz.backup_id, patch: { status: 'OUTOFSTOCK' } }, z.deps);
        ok(az.ok && az.not_applied.includes('status') && z.nv.statusPuts.length === 0, '재고 0 뒤에도 판매중이면 not_applied status(change-status 로 우회 안 함)', az);
    }

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('검증 중단:', e); process.exit(1); });
