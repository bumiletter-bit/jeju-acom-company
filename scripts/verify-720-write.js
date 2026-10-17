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
function fakePool(orders, cfg = { detail_enabled: true }) {   // cfg = 'naver_product_write' 설정 행(null = 행 없음)
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
            st.puts.push(r.body);
            st.product = JSON.parse(JSON.stringify(r.body)); sum();
            if (opts.sideEffect) opts.sideEffect(st.product);   // 네이버가 다른 칸까지 바꾼 척
            return {};
        }
        if (r.method === 'POST' && r.path === '/external/v1/products/search') {
            return { contents: opts.noOrigin ? [] : [{ originProductNo: Number(ORIGIN), channelProducts: [{ channelProductNo: Number(CH) }] }] };
        }
        if (r.method === 'PUT' && r.path === `/external/v1/products/origin-products/${ORIGIN}/change-status`) {
            st.statusPuts.push(r.body);
            st.product.originProduct.statusType = r.body.statusType;
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
const mk = (product, opts) => { const db = fakePool(ORDERS), nv = fakeNaver(product || PRODUCT, opts); return { db, nv, deps: { pool: db, call: nv.call, audit } }; };

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
        const rv4 = await run({ op: 'revert', order_id: 101, backup_id: b4.backup_id }, { pool: k2.db, call: k2.nv.call, audit });
        ok(rv4.ok && rv4.same_as_before && rv4.steps.join() === 'channel,status', '통째 PUT 이 상태를 안 되돌려도 change-status 로 마저 · 잔여 0', rv4);
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
        await t({ stock: 10 }, /옵션 상품 재고는 2차/, '재고 = 고정 문구로 거절');
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
        // 품절 → 판매(재고 입력 필요) = 1차 거절
        const s = mk(JSON.parse(JSON.stringify({ ...PRODUCT, originProduct: { ...PRODUCT.originProduct, statusType: 'OUTOFSTOCK' } })));
        const bs = await run({ op: 'backup', product_no: CH, order_id: 101 }, s.deps);
        const xs = await run({ op: 'apply', order_id: 101, backup_id: bs.backup_id, patch: { status: 'SALE' } }, s.deps);
        ok(!xs.ok && /품절 → 판매/.test(xs.error), '품절 → 판매 거절(2차)');
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

    console.log('⑨ #720-D 상세 잠금(설정 행 없음·꺼짐 = 거절 · 상태는 허용)');
    {
        for (const [cfg, name] of [[null, '설정 행 없음'], [{ detail_enabled: false }, 'detail_enabled false']]) {
            const db = fakePool(ORDERS, cfg), nv = fakeNaver(PRODUCT);
            const deps = { pool: db, call: nv.call, audit };
            const b = await run({ op: 'backup', product_no: CH, order_id: 101 }, deps);
            const x = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { detail_html: NEW_HTML } }, deps);
            ok(!x.ok && /상세 수정은 대표 확정 대기/.test(x.error) && nv.puts.length === 0 && !db.backups[0].applied_at, `${name} → 상세 apply 거절(쓰기 0 · 적용 표시 0)`, x);
            const y = await run({ op: 'apply', order_id: 101, backup_id: b.backup_id, patch: { status: 'SUSPENSION' } }, deps);
            ok(y.ok && nv.statusPuts.length === 1, `${name} → 판매 상태 apply 는 됨`, y);
        }
    }

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('검증 중단:', e); process.exit(1); });
