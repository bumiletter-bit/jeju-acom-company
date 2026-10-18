// #728 검증 — 쿠팡 옵션 쓰기 러너(server.js 「#728 시작」~「#728 끝」)를 떼어 가짜 deps 로 돌린다.
//   실DB·쿠팡 호출 0: pool 은 메모리 가짜(coupang_item_backups·pending_orders 두 표만 흉내) · call 은 가짜 쿠팡
//   (상품 목록 · 상품 하나 · 옵션 재고 조회 · 가격/재고/판매중지/재개 PUT).
//   실행: node scripts/verify-728-coupang.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('// #728 시작'), b = src.indexOf('// #728 끝');
if (a < 0 || b <= a) { console.error('server.js 에서 #728 구간을 못 찾음'); process.exit(1); }
const mod = new Function(src.slice(a, b) + '\nreturn { coupangItemWriteRun, cpwCheckPatch, cpwSaleCheck, cpwItemOf, CPW_PATH, cpwApplyFull };')();

let pass = 0, failN = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

// ── 가짜 pool ──────────────────────────────────────────
// PostgreSQL jsonb 흉내 — 객체 키를 (길이, 글자) 순으로 다시 늘어놓음(실측 10/18: 보관본 키 순서가 바뀌어 돌아와 신선도 대조가 헛걸림)
const jsonb = (v) => Array.isArray(v) ? v.map(jsonb) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((x, y) => x.length - y.length || (x < y ? -1 : x > y ? 1 : 0)).map(k => [k, jsonb(v[k])])) : v;
function fakePool(orders) {
    const backups = []; let seq = 0;
    const find = (id) => backups.find(x => x.id === id);
    return {
        backups,
        async query(sql, p = []) {
            if (/FROM pending_orders WHERE id = \$1/.test(sql)) return { rows: orders.filter(o => o.id === p[0]) };
            if (/^\s*INSERT INTO coupang_item_backups \(seller_product_id, vendor_item_id, order_id, before_json, created_by\)/.test(sql)) {
                const r = { id: ++seq, kind: 'item', seller_product_id: p[0], vendor_item_id: p[1], order_id: p[2], before_json: JSON.parse(p[3]), created_by: p[4], patch_json: null, after_json: null, applied_at: null, reverted_at: null, result_json: null };
                backups.push(r); return { rows: [{ id: r.id }] };
            }
            // #729 상품 단위
            if (/FROM agent_office_config WHERE key = 'coupang_item_write'/.test(sql)) return { rows: this.cfg ? [{ value: this.cfg }] : [] };
            if (/^\s*INSERT INTO coupang_item_backups \(kind, seller_product_id, vendor_item_id, order_id, before_json, created_by, result_json\) VALUES \('product', \$1, NULL/.test(sql)) {
                const r = { id: ++seq, kind: 'product', seller_product_id: p[0], vendor_item_id: null, order_id: p[1], before_json: jsonb(JSON.parse(p[2])), created_by: p[3], result_json: JSON.parse(p[4]), patch_json: null, after_json: null, applied_at: null, reverted_at: null, created_at: new Date() };
                backups.push(r); return { rows: [{ id: r.id }] };
            }
            if (/^\s*INSERT INTO coupang_item_backups \(kind, seller_product_id, vendor_item_id, order_id, before_json, created_by\) VALUES \('product', \$1, NULL/.test(sql)) {
                const r = { id: ++seq, kind: 'product', seller_product_id: p[0], vendor_item_id: null, order_id: p[1], before_json: jsonb(JSON.parse(p[2])), created_by: p[3], result_json: null, patch_json: null, after_json: null, applied_at: null, reverted_at: null, created_at: new Date() };
                backups.push(r); return { rows: [{ id: r.id }] };
            }
            if (/count\(\*\)::int AS n FROM coupang_item_backups WHERE kind = 'product' AND result_json->>'op' IN \('create_saved', 'create_unknown'\)/.test(sql))
                return { rows: [{ n: backups.filter(x => x.kind === 'product' && x.result_json && ['create_saved', 'create_unknown'].includes(x.result_json.op)).length }] };
            if (/SET patch_json = \$2::jsonb, applied_at = NOW\(\), after_json = \$3::jsonb, result_json = \$4::jsonb/.test(sql)) { const r = find(p[0]); r.patch_json = JSON.parse(p[1]); r.applied_at = new Date(); r.after_json = JSON.parse(p[2]); r.result_json = JSON.parse(p[3]); return { rows: [] }; }
            if (/SELECT \* FROM coupang_item_backups WHERE id = \$1/.test(sql)) { const r = find(p[0]); return { rows: r ? [JSON.parse(JSON.stringify(r))] : [] }; }
            if (/SET patch_json = \$2::jsonb, applied_at = COALESCE\(applied_at, NOW\(\)\)/.test(sql)) { const r = find(p[0]); r.patch_json = JSON.parse(p[1]); r.applied_at = r.applied_at || new Date(); return { rows: [] }; }
            if (/SET patch_json = \$2::jsonb, result_json = \$3::jsonb/.test(sql)) { const r = find(p[0]); r.patch_json = JSON.parse(p[1]); r.result_json = JSON.parse(p[2]); return { rows: [] }; }
            if (/SET after_json = \$2::jsonb, result_json = \$3::jsonb/.test(sql)) { const r = find(p[0]); r.after_json = JSON.parse(p[1]); r.result_json = JSON.parse(p[2]); return { rows: [] }; }
            if (/SET reverted_at = NOW\(\)/.test(sql)) { const r = find(p[0]); r.reverted_at = new Date(); r.result_json = { ...(r.result_json || {}), ...JSON.parse(p[1]) }; return { rows: [] }; }
            if (/SET result_json = COALESCE\(result_json, '\{\}'::jsonb\) \|\| \$2::jsonb WHERE id = \$1/.test(sql)) { const r = find(p[0]); r.result_json = { ...(r.result_json || {}), ...JSON.parse(p[1]) }; return { rows: [] }; }
            throw new Error('가짜 pool 이 모르는 SQL: ' + sql.slice(0, 120));
        },
    };
}
// ── 가짜 쿠팡 ─────────────────────────────────────────
const P = mod.CPW_PATH;
const SP = '15000001', VID = '70000001', VID2 = '70000002';
function fakeCoupang(opts = {}) {
    const st = {
        items: { [VID]: { salePrice: 29000, amountInStock: 500, onSale: true }, [VID2]: { salePrice: 39000, amountInStock: 0, onSale: false } },
        calls: [], puts: [],
    };
    const wrap = (data, extra) => ({ code: 'SUCCESS', message: '', data, ...(extra || {}) });
    st.call = async (r) => {
        st.calls.push(r.method + ' ' + r.path);
        if (r.method === 'GET' && r.path === P.list) {
            if (opts.listFail) { const e = new Error('coupang_relay_error_403'); e.status = 403; e.data = { message: 'path_not_allowed' }; throw e; }
            if (!r.query.nextToken) return wrap([{ sellerProductId: Number(SP), sellerProductName: '하우스감귤', statusName: '승인완료' }], { nextToken: opts.twoPages ? 'n2' : '' });
            return wrap([{ sellerProductId: 15000002, sellerProductName: '황금향', statusName: '승인완료' }], { nextToken: '' });
        }
        if (r.method === 'GET' && r.path === P.product(SP)) return wrap({ sellerProductName: '하우스감귤', items: [{ vendorItemId: Number(VID), itemName: '2.5kg' }, { vendorItemId: Number(VID2), itemName: '4kg' }] });
        if (r.method === 'GET' && r.path === P.product('15000002')) return wrap({ items: [] });
        const inv = Object.keys(st.items).find(v => r.path === P.inventory(v));
        if (r.method === 'GET' && inv) {
            if (opts.getFail) { const e = new Error('coupang_relay_error_500'); e.status = 500; throw e; }
            return wrap({ sellerItemId: 1, ...st.items[inv] });
        }
        if (r.method === 'PUT') {
            st.puts.push(r.path);
            if (opts.putFail) { const e = new Error('coupang_relay_error_400'); e.status = 400; e.data = { code: 'ERROR', message: '가격 변경 범위 초과' }; throw e; }
            if (opts.putCodeError) return { code: 'ERROR', message: '판매중지 상태입니다', data: null };
            for (const v of Object.keys(st.items)) {
                const it = st.items[v];
                const m = r.path.match(/\/vendor-items\/(\d+)\/(prices|quantities)\/(\d+)$/);
                if (m && m[1] === v) {
                    if (opts.ignorePut) return wrap(null);
                    if (m[2] === 'prices') it.salePrice = Number(m[3]); else it.amountInStock = Number(m[3]);
                    if (opts.sideEffect) opts.sideEffect(it);
                    return wrap(null);
                }
                if (r.path === P.stop(v)) { it.onSale = false; return wrap(null); }
                if (r.path === P.resume(v)) { it.onSale = true; return wrap(null); }
            }
        }
        throw new Error('가짜 쿠팡이 모르는 호출 ' + r.method + ' ' + r.path);
    };
    return st;
}
const ORDERS = [{ id: 101, status: '처리중', is_deleted: false, created_by_id: 1 },
    { id: 103, status: '처리중', is_deleted: false, created_by_id: 7 },
    { id: 105, status: '대기', is_deleted: false, created_by_id: 990728 },
    { id: 102, status: '반려', is_deleted: false, created_by_id: 7 },
    { id: 106, status: '처리중', is_deleted: true, created_by_id: 7 }];
const audits = [];
const audit = async (x) => { audits.push(x); };
const mk = (opts) => { const db = fakePool(ORDERS), cp = fakeCoupang(opts); return { db, cp, deps: { pool: db, call: cp.call, audit, gapMs: 0, rereadMs: 0, reread2Ms: 0 } }; };
const run = (req, deps) => mod.coupangItemWriteRun(req, deps);

(async () => {
    console.log('① list = 상품 → 옵션(지금 가격·재고·판매 여부)');
    {
        const k = mk({ twoPages: true });
        const l = await run({ op: 'list' }, k.deps);
        ok(l.ok && l.products.length === 2 && l.products[0].sellerProductId === SP && l.products[0].name === '하우스감귤' && l.products[0].status === '승인완료', '상품 2개(두 쪽) · 번호·이름·승인 상태', l);
        const v = l.ok && l.products[0].vendorItems;
        ok(v && v.length === 2 && v[0].vendorItemId === VID && v[0].itemName === '2.5kg' && v[0].salePrice === 29000 && v[0].quantity === 500 && v[0].saleStatus === 'ON_SALE' && v[1].saleStatus === 'STOP' && v[1].quantity === 0, '옵션 = 이름·가격·재고·판매 상태', v);
        ok(k.cp.puts.length === 0 && audits.length === 0, 'list 는 쓰기 0 · audit 0');
        const k2 = mk(); await run({ op: 'list', q: '감귤' }, { ...k2.deps, call: async (r) => { if (r.path === P.list) ok(r.query.sellerProductName === '감귤', 'q → sellerProductName'); return k2.cp.call(r); } });
        // (a) 목록·단건·재고 조회 모두 간격(gap) 안에서 — 호출 시각 간격 ≥ gap
        const kg = mk({ twoPages: true }); const at = [];
        await run({ op: 'list' }, { ...kg.deps, gapMs: 40, call: async (r) => { at.push(Date.now()); return kg.cp.call(r); } });
        const gaps = at.slice(1).map((t, i) => t - at[i]);
        ok(at.length >= 6 && gaps.every(g => g >= 35), 'list 의 목록·단건·재고 GET 전부 간격 지킴(nextToken 두 쪽)', gaps);
        const lf = await quiet(() => run({ op: 'list' }, mk({ listFail: true }).deps));
        ok(!lf.ok && lf.code === 403 && lf.coupang_message === 'path_not_allowed', '목록 실패 = 코드·쿠팡 글', lf);
    }

    console.log('② backup → apply(가격) → 재조회 대조 → revert');
    {
        const k = mk();
        const bk = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101, created_by: '시험' }, k.deps);
        ok(bk.ok && bk.backup_id === 1 && bk.before.price === 29000 && bk.before.stock === 500 && bk.before.on_sale === true && bk.sale_ok.ok, 'backup = 지금 값 · sale_ok ✓', bk);
        ok(k.db.backups[0].seller_product_id === SP && k.db.backups[0].vendor_item_id === VID, '표에 상품·옵션 번호');
        ok(bk.before.item_name === '2.5kg' && bk.before.seller_product_id === SP && bk.before.product_name === '하우스감귤', 'before = 재고 조회 + 단건 상품의 그 옵션(이름·상품 번호)', bk.before);
        const ns = await run({ op: 'backup', vendor_item_id: VID, order_id: 101 }, k.deps);
        ok(!ns.ok && /seller_product_id/.test(ns.error), 'seller_product_id 없으면 거절', ns);
        const ws = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: '15000002', order_id: 101 }, k.deps);
        ok(!ws.ok && /옵션 번호가 없어요/.test(ws.error), '다른 상품 번호면 거절', ws);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { price: 29010 } }, k.deps);
        ok(ap.ok && ap.after.price === 29010 && JSON.stringify(ap.changed) === '["price"]' && ap.unexpected.length === 0 && ap.not_applied.length === 0, 'apply 가격 → 재조회 29,010 · changed price · unexpected 0', ap);
        ok(k.cp.puts.length === 1 && k.cp.puts[0] === P.price(VID, 29010), '전용 가격 PUT 하나', k.cp.puts);
        ok(ap.sale_ok.ok && ap.sale_ok_before.ok, '건들기 전·후 sale_ok ✓', [ap.sale_ok_before, ap.sale_ok]);
        const again = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { price: 29020 } }, k.deps);
        ok(!again.ok && /이미 적용/.test(again.error), '같은 보관본 두 번 apply 거절');
        const rv = await run({ op: 'revert', order_id: 101, backup_id: bk.backup_id }, k.deps);
        ok(rv.ok && rv.put && rv.now.price === 29000 && rv.same_as_before === true && rv.unexpected.length === 0 && rv.sale_ok.ok, 'revert = 29,000 · same_as_before', rv);
        ok(k.cp.puts[1] === P.price(VID, 29000), 'revert 도 같은 가격 PUT');
        const rv2 = await run({ op: 'revert', order_id: 101, backup_id: bk.backup_id }, k.deps);
        ok(!rv2.ok && /이미 되돌린/.test(rv2.error), '두 번 revert 거절');
        const ap3 = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { price: 29010 } }, k.deps);
        ok(!ap3.ok, '되돌린 보관본 apply 거절', ap3);
        const row = k.db.backups[0];
        ok(row.applied_at && row.reverted_at && row.after_json.price === 29010 && row.patch_json.price === 29010 && row.result_json.reverted === true, '표에 patch·after·적용·되돌린 시각', row);
    }

    console.log('③ 재고 · 판매중지/재개');
    {
        const k = mk();
        const bk = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k.deps);
        const ap = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { stock: 501 } }, k.deps);
        ok(ap.ok && ap.after.stock === 501 && k.cp.puts[0] === P.stock(VID, 501) && JSON.stringify(ap.changed) === '["stock"]', '재고 501 · 전용 재고 PUT', ap);
        const rv = await run({ op: 'revert', order_id: 101, backup_id: bk.backup_id }, k.deps);
        ok(rv.ok && rv.now.stock === 500 && rv.same_as_before, '재고 되돌림 500', rv);
        const b2 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k.deps);
        const s1 = await run({ op: 'apply', order_id: 101, backup_id: b2.backup_id, patch: { sales: 'stop' } }, k.deps);
        ok(s1.ok && s1.after.on_sale === false && k.cp.puts.includes(P.stop(VID)) && JSON.stringify(s1.changed) === '["on_sale"]', '판매중지 → on_sale false', s1);
        ok(s1.sale_ok && !s1.sale_ok.ok && s1.sale_ok.bad.includes('on_sale'), '중지 뒤 sale_ok ⚠ on_sale(정직하게 보고)', s1.sale_ok);
        const r1 = await run({ op: 'revert', order_id: 101, backup_id: b2.backup_id }, k.deps);
        ok(r1.ok && r1.now.on_sale === true && k.cp.puts.includes(P.resume(VID)) && r1.sale_ok.ok, '되돌림 = 재개 · sale_ok ✓', r1);
        // 이미 판매중지인 옵션(비시즌) → 재개 → 되돌림 = 다시 중지
        const b3 = await run({ op: 'backup', vendor_item_id: VID2, seller_product_id: SP, order_id: 101 }, k.deps);
        ok(b3.ok && !b3.sale_ok.ok && b3.sale_ok.bad.includes('on_sale') && b3.sale_ok.bad.includes('stock'), '비시즌 옵션 backup sale_ok ⚠(중지·재고 0)', b3.sale_ok);
        const s3 = await run({ op: 'apply', order_id: 101, backup_id: b3.backup_id, patch: { sales: 'resume' } }, k.deps);
        ok(s3.ok && s3.after.on_sale === true, '비시즌 옵션 재개', s3);
        const r3 = await run({ op: 'revert', order_id: 101, backup_id: b3.backup_id }, k.deps);
        ok(r3.ok && r3.now.on_sale === false && k.cp.puts.filter(x => x === P.stop(VID2)).length === 1, '되돌림 = 다시 중지', r3);
    }

    console.log('④ patch 거절(한 칸 · 10배 · 0 이하 · 음수 · 10원 단위 · 같은 값)');
    {
        const k = mk();
        const bk = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k.deps);
        const t = async (patch, re, name) => { const x = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch }, k.deps); ok(!x.ok && re.test(x.error), name, x); };
        await t({ price: 29010, stock: 1 }, /한 칸만/, '두 칸 거절');
        await t({}, /한 칸만/, '빈 patch 거절');
        await t({ name: 'x' }, /허용되지 않은 칸 name/, '허용 밖 칸 거절');
        await t({ price: 58010 }, /−50%~\+100%.*윙에서/, '+100% 넘음 거절(윙에서)');
        await t({ price: 14490 }, /−50%~\+100%.*윙에서/, '−50% 넘음 거절(윙에서)');
        await t({ name: '새 이름' }, /승인 필요 칸.*2차/, '상품명 = 승인 필요 칸 2차 안내');
        await t({ price: 0 }, /0 보다 큰/, '가격 0 거절');
        await t({ price: -100 }, /0 보다 큰/, '가격 음수 거절');
        await t({ price: 29001 }, /10원 단위/, '10원 단위 아님 거절');
        await t({ price: 29000 }, /같아요/, '같은 가격 거절');
        await t({ price: '29010' }, /정수/, '가격 글자 거절');
        await t({ stock: -1 }, /0 이상/, '재고 음수 거절');
        await t({ stock: 1.5 }, /0 이상 정수/, '재고 소수 거절');
        await t({ stock: 100000 }, /99999 이하/, '재고 상한 거절');
        await t({ sales: 'pause' }, /stop.*resume/, 'sales 값 거절');
        await t({ sales: 'resume' }, /이미 판매중/, '판매중에 재개 거절');
        ok(k.cp.puts.length === 0, '거절 동안 PUT 0');
        const st0 = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { stock: 0 } }, k.deps);
        ok(st0.ok && st0.after.stock === 0, '재고 0 은 허용', st0);
        // 경계(정확히 −50% · +100%)는 통과 · forceSalePriceUpdate 안 보냄
        const kb = mk(); const sent = [];
        const db1 = { ...kb.deps, call: async (r) => { if (r.method === 'PUT') sent.push(r); return kb.cp.call(r); } };
        const bb = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, db1);
        const hi = await run({ op: 'apply', order_id: 101, backup_id: bb.backup_id, patch: { price: 58000 } }, db1);
        ok(hi.ok && hi.after.price === 58000, '+100% 경계 통과', hi);
        ok(sent.every(r => !r.query), 'forceSalePriceUpdate 등 쿼리 안 보냄', sent.map(r => r.query));
        await run({ op: 'revert', order_id: 101, backup_id: bb.backup_id }, db1);
        const bb2 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, db1);
        const lo = await run({ op: 'apply', order_id: 101, backup_id: bb2.backup_id, patch: { price: 14500 } }, db1);
        ok(lo.ok && lo.after.price === 14500 && lo.scope_note && /2차/.test(lo.scope_note), '−50% 경계 통과 · 결과에 2차 안내', lo);
    }

    console.log('⑤ 지시·보관본·동시 실행');
    {
        const k = mk();
        const x1 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP }, k.deps);
        ok(!x1.ok && /order_id/.test(x1.error), 'order_id 없으면 거절');
        const x2 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 102 }, k.deps);
        ok(!x2.ok && /반려/.test(x2.error), '반려 지시 거절');
        const x3 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 106 }, k.deps);
        ok(!x3.ok && /찾지 못/.test(x3.error), '삭제된 지시 거절');
        const x4 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 999 }, k.deps);
        ok(!x4.ok && /찾지 못/.test(x4.error), '없는 지시 거절');
        // 승인 검사 없음(#727 과 같음) — 직원 지시·시험 계정 지시 모두 실행
        const b5 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 103 }, k.deps);
        const a5 = await run({ op: 'apply', order_id: 103, backup_id: b5.backup_id, patch: { price: 29010 } }, k.deps);
        ok(a5.ok, '직원 지시도 apply 실행(서버 승인 검사 0)', a5);
        const r5 = await run({ op: 'revert', order_id: 103, backup_id: b5.backup_id }, k.deps);
        ok(r5.ok, '직원 지시 revert');
        const b6 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 105 }, k.deps);
        const a6 = await run({ op: 'apply', order_id: 105, backup_id: b6.backup_id, patch: { stock: 499 } }, k.deps);
        ok(a6.ok, '시험 번호 계정 지시 통과');
        await run({ op: 'revert', order_id: 105, backup_id: b6.backup_id }, k.deps);
        const x7 = await run({ op: 'apply', order_id: 101, backup_id: 999, patch: { price: 29010 } }, k.deps);
        ok(!x7.ok && /보관본을 찾지/.test(x7.error), '없는 보관본 거절');
        const x8 = await run({ op: 'apply', order_id: 101, backup_id: b6.backup_id, vendor_item_id: VID2, patch: { price: 29010 } }, k.deps);
        ok(!x8.ok && /옵션 번호/.test(x8.error), '보관본과 다른 옵션 번호 거절');
        const x9 = await run({ op: 'apply', order_id: 101 }, k.deps);
        ok(!x9.ok && /backup_id/.test(x9.error), 'backup_id 없으면 거절');
        const x10 = await run({ op: 'delete', order_id: 101 }, k.deps);
        ok(!x10.ok && /op 는/.test(x10.error), '모르는 op 거절');
        const x11 = await run({ op: 'revert', order_id: 101, backup_id: (await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k.deps)).backup_id }, k.deps);
        ok(!x11.ok && /아직 적용/.test(x11.error), '적용 전 revert 거절');
        // 동시 실행
        const s = mk();
        const slow = { ...s.deps, call: async (r) => { await new Promise(res => setTimeout(res, 30)); return s.cp.call(r); } };
        const [p1, p2] = await Promise.all([run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, slow), run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, slow)]);
        ok([p1, p2].filter(x => x.ok).length === 1 && [p1, p2].some(x => /진행 중/.test(x.error || '')), '같은 옵션 동시 작업 하나만', [p1, p2]);
    }

    console.log('⑥ 신선도 · 재조회 대조');
    {
        // 보관 뒤 Wing 에서 가격을 고침 → apply 거절(PUT 0)
        const k = mk();
        const bk = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k.deps);
        k.cp.items[VID].salePrice = 31000;
        const x = await run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { stock: 400 } }, k.deps);
        ok(!x.ok && /바뀐 곳/.test(x.error) && JSON.stringify(x.drift) === '["price"]' && k.cp.puts.length === 0, '보관 뒤 가격 바뀜 = 거절 · PUT 0', x);
        // 주문으로 재고만 줄었으면 통과
        const k2 = mk();
        const b2 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k2.deps);
        k2.cp.items[VID].amountInStock = 497;
        const y = await run({ op: 'apply', order_id: 101, backup_id: b2.backup_id, patch: { price: 29010 } }, k2.deps);
        ok(y.ok && y.unexpected.length === 0 && y.before.stock === 497, '주문으로 재고가 준 것은 통과 · 지금 값 기준', y);
        // 재고가 늘었으면 거절
        const k3 = mk();
        const b3 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k3.deps);
        k3.cp.items[VID].amountInStock = 900;
        const z = await run({ op: 'apply', order_id: 101, backup_id: b3.backup_id, patch: { price: 29010 } }, k3.deps);
        ok(!z.ok && JSON.stringify(z.drift) === '["stock"]', '재고가 늘었으면 거절', z);
        // PUT 은 받았는데 값이 안 바뀜 → not_applied
        const k4 = mk({ ignorePut: true });
        const b4 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k4.deps);
        const n = await run({ op: 'apply', order_id: 101, backup_id: b4.backup_id, patch: { price: 29010 } }, k4.deps);
        ok(n.ok && JSON.stringify(n.not_applied) === '["price"]' && n.changed.length === 0 && !n.sale_ok.ok, '반영 안 됨 = not_applied · sale_ok ⚠ price', n);
        // 다른 칸까지 바뀜 → unexpected
        const k5 = mk({ sideEffect: (it) => { it.onSale = false; } });
        const b5 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k5.deps);
        const u = await run({ op: 'apply', order_id: 101, backup_id: b5.backup_id, patch: { price: 29010 } }, k5.deps);
        ok(u.ok && JSON.stringify(u.unexpected) === '["on_sale"]' && !u.sale_ok.ok, '다른 칸 변화 = unexpected', u);
        // 적용 뒤 그 칸을 누가 또 바꿈 → revert 거절 · force 면 덮음
        const k6 = mk();
        const b6 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k6.deps);
        await run({ op: 'apply', order_id: 101, backup_id: b6.backup_id, patch: { price: 29010 } }, k6.deps);
        k6.cp.items[VID].salePrice = 30000;
        const rv = await run({ op: 'revert', order_id: 101, backup_id: b6.backup_id }, k6.deps);
        ok(!rv.ok && /force/.test(rv.error) && k6.cp.puts.length === 1, '적용 뒤 또 바뀜 = revert 거절', rv);
        const rf = await run({ op: 'revert', order_id: 101, backup_id: b6.backup_id, force: true }, k6.deps);
        ok(rf.ok && rf.now.price === 29000, 'force revert 는 덮음', rf);
        // 이미 원래 값이면 PUT 없이 끝
        const k7 = mk();
        const b7 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k7.deps);
        await run({ op: 'apply', order_id: 101, backup_id: b7.backup_id, patch: { price: 29010 } }, k7.deps);
        k7.cp.items[VID].salePrice = 29000;
        const r7 = await run({ op: 'revert', order_id: 101, backup_id: b7.backup_id, force: true }, k7.deps);
        ok(r7.ok && r7.put === false && r7.same_as_before && k7.cp.puts.length === 1, '이미 원래 값 = PUT 없이 되돌림 기록', r7);
        // 적용 뒤 주문으로 재고만 줄었으면 revert 통과
        const k8 = mk();
        const b8 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k8.deps);
        await run({ op: 'apply', order_id: 101, backup_id: b8.backup_id, patch: { stock: 501 } }, k8.deps);
        k8.cp.items[VID].amountInStock = 499;
        const r8 = await run({ op: 'revert', order_id: 101, backup_id: b8.backup_id }, k8.deps);
        ok(r8.ok && r8.now.stock === 500, '재고 적용 뒤 주문으로 준 것은 revert 통과', r8);
    }

    console.log('⑦ 쿠팡 실패 · code ERROR · 재조회 실패');
    {
        const k = mk({ putFail: true });
        const bk = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k.deps);
        const x = await quiet(() => run({ op: 'apply', order_id: 101, backup_id: bk.backup_id, patch: { price: 29010 } }, k.deps));
        ok(!x.ok && x.code === 400 && x.coupang_message === '가격 변경 범위 초과' && /가격 변경 실패/.test(x.error), 'PUT 400 = 코드·쿠팡 글', x);
        const row = k.db.backups[0];
        ok(!row.applied_at && row.result_json.ok === false && row.result_json.step === 'price', '실패는 applied_at 없이 result_json 에', row);
        const k2 = mk({ putCodeError: true });
        const b2 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k2.deps);
        const y = await quiet(() => run({ op: 'apply', order_id: 101, backup_id: b2.backup_id, patch: { sales: 'stop' } }, k2.deps));
        ok(!y.ok && y.coupang_message === '판매중지 상태입니다' && /판매중지 실패/.test(y.error), 'HTTP 200 이어도 code ERROR = 실패', y);
        const g = await quiet(() => run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, mk({ getFail: true }).deps));
        ok(!g.ok && g.code === 500 && /옵션 조회 실패/.test(g.error), '조회 실패 backup 거절', g);
        // 재조회만 실패 → ok · error_note
        const k3 = mk();
        const b3 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k3.deps);
        let n = 0;
        const d3 = { ...k3.deps, call: async (r) => { if (r.method === 'GET' && ++n === 2) { const e = new Error('x'); e.status = 500; throw e; } return k3.cp.call(r); } };
        const z = await quiet(() => run({ op: 'apply', order_id: 101, backup_id: b3.backup_id, patch: { price: 29010 } }, d3));
        ok(z.ok && z.after === null && /재조회 실패/.test(z.error_note), '재조회 실패 = ok + error_note', z);
        // 429 = 그 요청 실패 + 「몇 분 뒤」(재시도 없음)
        const k5 = mk(); let puts5 = 0;
        const b5 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k5.deps);
        const d5 = { ...k5.deps, call: async (r) => { if (r.method === 'PUT') { puts5++; const e = new Error('coupang_relay_error_429'); e.status = 429; e.data = {}; throw e; } return k5.cp.call(r); } };
        const v5 = await quiet(() => run({ op: 'apply', order_id: 101, backup_id: b5.backup_id, patch: { stock: 400 } }, d5));
        ok(!v5.ok && v5.code === 429 && /몇 분 뒤/.test(v5.note) && puts5 === 1 && !v5.resume_note, '429 = 실패 + 「몇 분 뒤」 · PUT 1번', v5);
        // 재개 실패 = 모니터링 중지 안내
        const k6 = mk();
        const b6 = await run({ op: 'backup', vendor_item_id: VID2, seller_product_id: SP, order_id: 101 }, k6.deps);
        const d6 = { ...k6.deps, call: async (r) => { if (r.method === 'PUT') { const e = new Error('x'); e.status = 400; e.data = { message: '판매 재개 불가' }; throw e; } return k6.cp.call(r); } };
        const v6 = await quiet(() => run({ op: 'apply', order_id: 101, backup_id: b6.backup_id, patch: { sales: 'resume' } }, d6));
        ok(!v6.ok && /모니터링.*윙에서/.test(v6.resume_note) && v6.coupang_message === '판매 재개 불가', '재개 실패 = 모니터링 안내', v6);
        // 반영 지연: 첫 재조회는 옛 값 → 두 번째(5초 자리)에 새 값
        const k7 = mk(); let lag = 0;
        const b7 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k7.deps);
        const d7 = { ...k7.deps, call: async (r) => {
            if (r.method === 'PUT') { lag = 1; return k7.cp.call(r); }
            if (r.method === 'GET' && lag === 1 && r.path === P.inventory(VID)) { lag = 2; return { code: 'SUCCESS', data: { salePrice: 29000, amountInStock: 500, onSale: true } }; }
            return k7.cp.call(r); } };
        const v7 = await run({ op: 'apply', order_id: 101, backup_id: b7.backup_id, patch: { price: 29010 } }, d7);
        ok(v7.ok && v7.after.price === 29010 && v7.not_applied.length === 0 && lag === 2, '첫 재조회 옛 값 → 한 번 더 보고 새 값', v7);
        // (c) backup 때 판매 여부(onSale) 없는 응답 = 거절
        const kc = mk();
        const dc = { ...kc.deps, call: async (r) => r.method === 'GET' && r.path === P.inventory(VID) ? { code: 'SUCCESS', data: { salePrice: 29000, amountInStock: 5 } } : kc.cp.call(r) };
        const vc = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, dc);
        ok(!vc.ok && /옵션 값이 없어요/.test(vc.error) && kc.db.backups.length === 0, 'backup onSale 없음 = 거절 · 표 0', vc);
        // (b) apply·revert 때 빈 응답(data null) = 거절(TypeError 없음 · PUT 0)
        const kb = mk();
        const bb = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, kb.deps);
        const db0 = { ...kb.deps, call: async (r) => r.method === 'GET' && r.path === P.inventory(VID) ? { code: 'SUCCESS', data: null } : kb.cp.call(r) };
        const vb = await run({ op: 'apply', order_id: 101, backup_id: bb.backup_id, patch: { price: 29010 } }, db0);
        ok(!vb.ok && /옵션 값이 없어요/.test(vb.error) && kb.cp.puts.length === 0, 'apply 때 빈 응답 = 거절 · PUT 0', vb);
        await run({ op: 'apply', order_id: 101, backup_id: bb.backup_id, patch: { price: 29010 } }, kb.deps);
        const vr = await run({ op: 'revert', order_id: 101, backup_id: bb.backup_id }, db0);
        ok(!vr.ok && /옵션 값이 없어요/.test(vr.error) && kb.cp.puts.length === 1, 'revert 때 빈 응답 = 거절 · PUT 없음', vr);
        // revert PUT 실패 → result_json.revert_failed
        const k4 = mk();
        const b4 = await run({ op: 'backup', vendor_item_id: VID, seller_product_id: SP, order_id: 101 }, k4.deps);
        await run({ op: 'apply', order_id: 101, backup_id: b4.backup_id, patch: { price: 29010 } }, k4.deps);
        const d4 = { ...k4.deps, call: async (r) => { if (r.method === 'PUT') { const e = new Error('x'); e.status = 400; e.data = { message: 'm' }; throw e; } return k4.cp.call(r); } };
        const w = await quiet(() => run({ op: 'revert', order_id: 101, backup_id: b4.backup_id }, d4));
        ok(!w.ok && /되돌리기 실패/.test(w.error) && k4.db.backups[0].result_json.revert_failed.code === 400 && !k4.db.backups[0].reverted_at, 'revert 실패 기록 · reverted_at 없음', w);
    }

    console.log('⑧ audit · 응답 꼴');
    {
        ok(audits.length > 0 && audits.every(x => x.targetId === null && x.source === 'coupang-item-write' && x.targetType === 'coupang_item'), 'audit = source coupang-item-write · targetId null');
        const acts = new Set(audits.map(x => x.action));
        ok(['coupang_item_backup', 'coupang_item_apply', 'coupang_item_revert', 'coupang_item_apply_failed', 'coupang_item_revert_failed'].every(x => acts.has(x)), 'audit 종류 5', [...acts]);
        ok(audits.filter(x => x.action !== 'coupang_item_backup').every(x => x.changes && x.changes.vendor_item_id && x.changes.order_id && x.changes.backup_id), '번호는 changes 에(옵션·지시·보관본)');
        ok(mod.cpwItemOf({ salePrice: '1000', amountInStock: '3', onSale: 'false' }).on_sale === false && mod.cpwItemOf({ salePrice: 1000, quantity: 2, saleStatus: 'ON_SALE' }).stock === 2, 'cpwItemOf 글자·다른 칸 이름도 읽음');
        ok(/\/vendor-items\/1\/prices\/1000$/.test(mod.CPW_PATH.price('1', 1000)) && /\/vendor-items\/1\/sales\/stop$/.test(mod.CPW_PATH.stop('1')), '경로 꼴');
    }

    console.log('⑨ #729 상품 단위 — get_full · update_full · revert_full · create_saved · approval · delete_saved · request_approval');
    {
        const SPC = '16109702671', SAVEDID = '17000000001';
        const FULL = { sellerProductId: Number(SPC), sellerProductName: '제주아꼼이네 제철 새콤달콤 카라향', displayProductName: '제주아꼼이네 제철 새콤달콤 카라향', statusName: '승인완료', requested: true,
            mdId: 'md', saleStartedAt: '2026-01-01T00:00:00', deliveryMethod: 'SEQUENCIAL',
            items: [
                { sellerProductItemId: 501, vendorItemId: 95059733579, itemName: '카라향 3kg', salePrice: 29800, originalPrice: 35000, maximumBuyCount: 0,
                    images: [{ imageOrder: 0, imageType: 'REPRESENTATION', cdnPath: 'vendor_inventory/a.jpg' }, { imageOrder: 1, imageType: 'DETAIL', cdnPath: 'vendor_inventory/b.jpg' }],
                    contents: [{ contentsType: 'TEXT', contentDetails: [{ content: '<p>카라향 상세</p>', detailType: 'TEXT' }] }] },
                { sellerProductItemId: 502, vendorItemId: 95059733604, itemName: '카라향 5kg', salePrice: 43800, originalPrice: 50000, maximumBuyCount: 0,
                    images: [{ imageOrder: 0, imageType: 'REPRESENTATION', cdnPath: 'vendor_inventory/a.jpg' }],
                    contents: [{ contentsType: 'TEXT', contentDetails: [{ content: '<p>카라향 상세</p>', detailType: 'TEXT' }] }] },
            ] };
        const prodFake = (opts = {}) => {
            const st = { prods: { [SPC]: JSON.parse(JSON.stringify(FULL)) }, posts: [], puts: [], deletes: [], approvals: [] };
            const w = (data) => ({ code: 'SUCCESS', message: '', data });
            st.call = async (r) => {
                const m = r.path.match(/\/seller-products\/(\d+)(\/histories|\/approvals)?$/);
                if (r.method === 'GET' && m && !m[2]) {
                    if (!st.prods[m[1]]) { const e = new Error('x'); e.status = 400; e.data = { message: '상품 없음' }; throw e; }
                    return w(JSON.parse(JSON.stringify(st.prods[m[1]])));
                }
                if (r.method === 'GET' && m && m[2] === '/histories') return w([{ status: '승인반려', comment: '상세에 금지 문구', createdAt: '2026-10-18T10:00:00', createdBy: 'SYSTEM' }, { status: '심사중', comment: null }]);
                if (r.method === 'PUT' && m && m[2] === '/approvals') { st.approvals.push(m[1]); st.prods[m[1]].statusName = '심사중'; return w(null); }
                if (r.method === 'DELETE' && m) { st.deletes.push(m[1]); delete st.prods[m[1]]; return w(null); }
                if (r.method === 'POST' && r.path === P.products) {
                    if (opts.postFail) { const e = new Error('x'); e.status = 400; e.data = { code: 'ERROR', message: '필수 속성 누락' }; throw e; }
                    if (opts.postNet) { const e = new Error('relay_unreachable'); throw e; }
                    st.posts.push(r.body);
                    st.prods[SAVEDID] = { ...JSON.parse(JSON.stringify(r.body)), sellerProductId: Number(SAVEDID), statusName: '임시저장' };
                    return { code: 'SUCCESS', message: '', data: Number(SAVEDID) };
                }
                if (r.method === 'PUT' && r.path === P.products) {
                    if (opts.putFail) { const e = new Error('x'); e.status = 400; e.data = { code: 'ERROR', message: '수정 실패' }; throw e; }
                    st.puts.push(r.body);
                    const id = String(r.body.sellerProductId);
                    if (cpwSavedName(st.prods[id])) st.prods[id] = { ...JSON.parse(JSON.stringify(r.body)), statusName: '임시저장' };   // 임시저장 = 바로 저장
                    else st.prods[id].statusName = '심사중';   // 승인된 상품 = 심사행(조회는 옛 값 · 상태만)
                    return { code: '200', data: { code: 'SUCCESS', data: Number(id) } };
                }
                throw new Error('가짜 쿠팡(상품)이 모르는 호출 ' + r.method + ' ' + r.path);
            };
            return st;
        };
        const cpwSavedName = (j) => j && ['임시저장', 'SAVED'].includes(j.statusName);
        const mkp = (opts) => { const db = fakePool(ORDERS), cp = prodFake(opts); return { db, cp, deps: { pool: db, call: cp.call, audit, gapMs: 0, rereadMs: 0, reread2Ms: 0 } }; };
        const base = { order_id: 101, created_by: '시험' };

        // get_full
        const k = mkp();
        const g = await run({ op: 'get_full', ...base, seller_product_id: SPC }, k.deps);
        ok(g.ok && g.backup_id && g.summary.name === FULL.sellerProductName && g.summary.status === '승인완료' && g.summary.items.length === 2 && g.summary.items[0].contents === 'TEXT:TEXT' && g.saved === false, 'get_full = 보관 · 요약(이름·상태·옵션·상세 꼴)', g);
        ok(k.db.backups[0].kind === 'product' && k.db.backups[0].vendor_item_id === null && k.db.backups[0].before_json.items.length === 2, '표 kind product · 옵션 번호 없음 · 조회 JSON 통째');
        const ng = await run({ op: 'get_full', seller_product_id: SPC }, k.deps);
        ok(!ng.ok && /order_id/.test(ng.error), 'get_full 도 지시 필요');
        // 1차 op 에 상품 보관본을 넣으면 거절
        const x1 = await run({ op: 'apply', ...base, backup_id: g.backup_id, patch: { price: 29810 } }, k.deps);
        ok(!x1.ok && /상품 보관본/.test(x1.error), '1차 apply 에 상품 보관본 = 거절', x1);

        // update_full 검사
        const t = async (patch, re, name) => { const x = await run({ op: 'update_full', ...base, backup_id: g.backup_id, patch }, k.deps); ok(!x.ok && re.test(x.error), name, x); };
        await t({ price: 1 }, /허용되지 않은 칸 price/, '가격은 1차 op 로(거절)');
        await t({}, /바꿀 칸이 없어요/, '빈 patch 거절');
        await t({ name: 'x'.repeat(101) }, /1~100자/, '상품명 101자 거절');
        await t({ name: FULL.sellerProductName }, /같아요/, '같은 상품명 거절');
        await t({ item_names: { '없는 옵션': '새' } }, /하나로 찾지 못/, '없는 옵션명 거절');
        await t({ item_names: { '카라향 3kg': 'y'.repeat(151) } }, /1~150자/, '옵션명 151자 거절');
        await t({ item_names: { '카라향 3kg': '카라향 5kg' } }, /겹쳐요/, '다른 옵션과 같은 이름 거절');
        await t({ detail_html: '<script>x</script>' }, /script/, '상세 script 거절');
        await t({ images: ['https://evil.example/x.jpg'] }, /allow_external_images 가 켜져 있을 때만/, '외부 그림 주소 = 설정 꺼짐이면 거절(기본)');
        await t({ images: ['vendor_inventory/b.jpg'] }, /남는 그림이 없어요/, '그림이 하나도 안 남는 옵션 거절');
        ok(k.cp.puts.length === 0, '거절 동안 PUT 0');

        // update_full 성공(승인된 상품 = requested true · 승인행)
        const u = await run({ op: 'update_full', ...base, backup_id: g.backup_id, patch: { name: '테스트 카라향', item_names: { '95059733579': '카라향 3kg 새' }, detail_html: '<p>새 상세</p>', images: ['vendor_inventory/a.jpg'] } }, k.deps);
        const pb = k.cp.puts[0];
        ok(u.ok && u.saved === false && u.requested === true && u.status_after === '심사중' && /승인 전까지 손님 화면은 옛 모습/.test(u.approval_note), 'update_full = 승인행(requested true · 상태 심사중 · 안내)', u);
        ok(pb && pb.sellerProductId === Number(SPC) && pb.sellerProductName === '테스트 카라향' && pb.displayProductName === '테스트 카라향' && pb.items[0].itemName === '카라향 3kg 새' && pb.items[1].itemName === '카라향 5kg'
            && pb.items.every(it => it.contents[0].contentDetails[0].content === '<p>새 상세</p>') && pb.items[0].images.length === 1 && pb.items[0].images[0].imageType === 'REPRESENTATION'
            && pb.items[0].vendorItemId === 95059733579 && pb.items[0].sellerProductItemId === 501 && pb.deliveryMethod === 'SEQUENCIAL', '바디 = 조회 JSON 통째 위에 그 칸만(번호·다른 칸 유지)', pb);
        ok(k.cp.puts.length === 1 && P.products === mod.CPW_PATH.list, '전체 수정 = PUT …/seller-products(경로에 id 없음) 한 번');
        const u2 = await run({ op: 'update_full', ...base, backup_id: g.backup_id, patch: { name: '또' } }, k.deps);
        ok(!u2.ok && /이미 적용/.test(u2.error), '같은 보관본 두 번 update 거절');
        // revert_full = 보관본 그대로 같은 PUT(조회가 아직 옛 값 = 통과)
        const rv = await run({ op: 'revert_full', ...base, backup_id: g.backup_id }, k.deps);
        ok(rv.ok && k.cp.puts.length === 2 && k.cp.puts[1].sellerProductName === FULL.sellerProductName && k.cp.puts[1].items[0].itemName === '카라향 3kg' && k.cp.puts[1].requested === true, 'revert_full = 보관본 그대로 PUT(역시 승인행)', rv);
        const rv2 = await run({ op: 'revert_full', ...base, backup_id: g.backup_id }, k.deps);
        ok(!rv2.ok && /이미 되돌린/.test(rv2.error), '두 번 revert 거절');
        // 신선도: 보관 뒤 Wing 에서 이름이 바뀜 → update 거절
        const k2 = mkp();
        const g2 = await run({ op: 'get_full', ...base, seller_product_id: SPC }, k2.deps);
        k2.cp.prods[SPC].sellerProductName = '누가 고침';
        const d2 = await run({ op: 'update_full', ...base, backup_id: g2.backup_id, patch: { name: '테스트' } }, k2.deps);
        ok(!d2.ok && /바뀐 곳/.test(d2.error) && k2.cp.puts.length === 0, '보관 뒤 바뀜 = update 거절 · PUT 0', d2);
        // revert: 적용 뒤 제3의 값 → 거절 · force 면 덮음
        const k3 = mkp();
        const g3 = await run({ op: 'get_full', ...base, seller_product_id: SPC }, k3.deps);
        await run({ op: 'update_full', ...base, backup_id: g3.backup_id, patch: { name: '테스트' } }, k3.deps);
        k3.cp.prods[SPC].sellerProductName = '제3의 이름';
        const r3 = await run({ op: 'revert_full', ...base, backup_id: g3.backup_id }, k3.deps);
        ok(!r3.ok && /force/.test(r3.error), '적용 뒤 또 바뀜 = revert 거절', r3);
        const r3f = await run({ op: 'revert_full', ...base, backup_id: g3.backup_id, force: true }, k3.deps);
        ok(r3f.ok, 'force revert 는 덮음', r3f);
        // 가격·재고 = 지금 값(cur)으로 덮음 — 주문으로 준 재고 · 1차로 바꾼 가격 유지
        const k5 = mkp();
        const g5 = await run({ op: 'get_full', ...base, seller_product_id: SPC }, k5.deps);
        k5.cp.prods[SPC].items[0].maximumBuyCount = 0; k5.cp.prods[SPC].items[1].maximumBuyCount = 7;   // 보관 뒤 주문으로 재고 변화(보관본 0 → 지금 7 처럼 다른 값)
        k5.cp.prods[SPC].items[0].salePrice = 29810; k5.cp.prods[SPC].items[0].originalPrice = 36000;   // 보관 뒤 1차 op 로 가격 바꿈
        const u5 = await run({ op: 'update_full', ...base, backup_id: g5.backup_id, patch: { name: '테스트 카라향' } }, k5.deps);
        const b5 = k5.cp.puts[0];
        ok(u5.ok && b5.items[1].maximumBuyCount === 7 && b5.items[0].maximumBuyCount === 0, 'update 바디 재고 = 지금 값(주문으로 준 재고 유지 · 보관본 재고 안 실림)', b5 && b5.items.map(it => it.maximumBuyCount));
        ok(b5.items[0].salePrice === 29810 && b5.items[0].originalPrice === 36000 && b5.items[1].salePrice === 43800, 'update 바디 가격 = 지금 값(1차로 바꾼 가격 유지)', b5 && b5.items.map(it => [it.salePrice, it.originalPrice]));
        k5.cp.prods[SPC].items[1].maximumBuyCount = 3;
        const r5 = await run({ op: 'revert_full', ...base, backup_id: g5.backup_id }, k5.deps);
        ok(r5.ok && k5.cp.puts[1].items[1].maximumBuyCount === 3 && k5.cp.puts[1].items[0].salePrice === 29810 && k5.cp.puts[1].sellerProductName === FULL.sellerProductName, 'revert 바디도 가격·재고 = 지금 값 · 이름만 보관본', k5.cp.puts[1] && k5.cp.puts[1].items.map(it => [it.salePrice, it.maximumBuyCount]));
        // 보관 뒤 옵션이 늘면 거절
        const k6 = mkp();
        const g6 = await run({ op: 'get_full', ...base, seller_product_id: SPC }, k6.deps);
        k6.cp.prods[SPC].items.push({ sellerProductItemId: 503, vendorItemId: 95059733563, itemName: '선물용 2kg', salePrice: 24800, maximumBuyCount: 0, images: [], contents: [] });
        const x6 = await run({ op: 'update_full', ...base, backup_id: g6.backup_id, patch: { name: '테스트' } }, k6.deps);
        ok(!x6.ok && /옵션이 늘었어요|바뀐 곳/.test(x6.error) && k6.cp.puts.length === 0, '보관 뒤 옵션 늘어남 = 거절 · PUT 0', x6);
        // PUT 실패 → 기록 · applied 안 됨
        const k4 = mkp({ putFail: true });
        const g4 = await run({ op: 'get_full', ...base, seller_product_id: SPC }, k4.deps);
        const f4 = await quiet(() => run({ op: 'update_full', ...base, backup_id: g4.backup_id, patch: { name: '테스트' } }, k4.deps));
        ok(!f4.ok && f4.coupang_message === '수정 실패' && !k4.db.backups[0].applied_at && k4.db.backups[0].result_json.update_failed.code === 400, '전체 수정 실패 = 기록 · applied 없음', f4);

        // create_saved
        const kc = mkp();
        const c = await run({ op: 'create_saved', ...base, from_seller_product_id: SPC, name: '테스트 카라향(시험용)' }, kc.deps);
        const cb = kc.cp.posts[0];
        ok(c.ok && c.seller_product_id === SAVEDID && /임시저장/.test(c.saved_note) && c.items.length === 2, 'create_saved = 새 번호 · 임시저장 안내', c);
        ok(cb.requested === false && cb.sellerProductName === '테스트 카라향(시험용)' && cb.displayProductName === '테스트 카라향(시험용)' && !('sellerProductId' in cb) && !('statusName' in cb) && !('mdId' in cb)
            && cb.items.every(it => !('vendorItemId' in it) && !('sellerProductItemId' in it)) && cb.deliveryMethod === 'SEQUENCIAL' && cb.items[0].images.length === 2, '등록 바디 = requested false · 번호·승인 칸 빠짐 · 나머지 복사', cb);
        const c2 = await run({ op: 'create_saved', ...base, from_seller_product_id: SPC, name: '테스트2', items: [{ itemName: '3kg', price: 20000, stock: 10 }, { itemName: '5kg', price: 30000 }] }, kc.deps);
        const cb2 = kc.cp.posts[1];
        ok(c2.ok && cb2.items.length === 2 && cb2.items[0].itemName === '3kg' && cb2.items[0].salePrice === 20000 && cb2.items[0].maximumBuyCount === 10 && cb2.items[1].maximumBuyCount === 99999 && cb2.items[1].originalPrice === 50000, 'items 지정 = 이름·가격·재고(기본 99999) · 할인 기준가 유지', cb2.items);
        const cbad = async (req, re, name) => { const x = await run({ op: 'create_saved', ...base, from_seller_product_id: SPC, name: '테스트', ...req }, kc.deps); ok(!x.ok && re.test(x.error), name, x); };
        await cbad({ name: '' }, /1~100자/, '이름 없음 거절');
        await cbad({ items: [{ itemName: 'a', price: 1005 }] }, /10원 단위/, '옵션 가격 10원 단위 거절');
        await cbad({ items: [{ itemName: 'a', price: 1000, id: 1 }] }, /허용되지 않은 칸 id/, '옵션 id 칸 거절');
        await cbad({ items: [{ itemName: 'a', price: 1000 }, { itemName: 'a', price: 2000 }] }, /겹쳐요/, '옵션명 겹침 거절');
        await run({ op: 'create_saved', ...base, from_seller_product_id: SPC, name: '테스트3' }, kc.deps);
        const c4 = await run({ op: 'create_saved', ...base, from_seller_product_id: SPC, name: '테스트4' }, kc.deps);
        ok(!c4.ok && /3개까지/.test(c4.error) && kc.cp.posts.length === 3, '24시간 3개 상한', c4);
        const kf = mkp({ postFail: true });
        const cf = await quiet(() => run({ op: 'create_saved', ...base, from_seller_product_id: SPC, name: '테스트' }, kf.deps));
        ok(!cf.ok && cf.coupang_message === '필수 속성 누락' && kf.db.backups[0].result_json.op === 'create_failed', '등록 400 = create_failed(상한에 안 셈)', cf);
        const kn = mkp({ postNet: true });
        const cn = await quiet(() => run({ op: 'create_saved', ...base, from_seller_product_id: SPC, name: '테스트' }, kn.deps));
        ok(!cn.ok && /모름/.test(cn.unknown_note) && kn.db.backups[0].result_json.op === 'create_unknown', '연결 실패 = create_unknown(상한에 셈)', cn);
        const kcs = mkp(); kcs.db.cfg = { create_strip: ['sellerProductId', 'statusName', 'items.sellerProductItemId', 'items.vendorItemId'] };
        await run({ op: 'create_saved', ...base, from_seller_product_id: SPC, name: '테스트' }, kcs.deps);
        ok('mdId' in kcs.cp.posts[0], '설정 create_strip 이 기본 목록을 덮음(mdId 남음)');
        // create_set = strip 뒤에 덮음(brand 를 strip 해도 GENERIC 이 들어감) · items.칸 = 모든 옵션 · 이름·requested 는 못 덮음
        const kset = mkp(); kset.cp.prods[SPC].brand = '제주아꼼이네'; kset.cp.prods[SPC].brandId = null;
        kset.db.cfg = { create_strip: ['sellerProductId', 'statusName', 'items.sellerProductItemId', 'items.vendorItemId', 'brand', 'brandId'],
            create_set: { brand: 'GENERIC', 'items.adultOnly': 'EVERYONE', requested: true, sellerProductName: '덮기' } };
        const cs = await run({ op: 'create_saved', ...base, from_seller_product_id: SPC, name: '테스트 카라향(시험용)', items: [{ itemName: '시험 3kg', price: 29800, stock: 0 }] }, kset.deps);
        const sb = kset.cp.posts[0];
        ok(cs.ok && sb.brand === 'GENERIC' && !('brandId' in sb), 'create_set brand GENERIC 이 strip 뒤에 덮임(brandId 빠짐)', sb && [sb.brand, sb.brandId]);
        ok(sb.items.every(it => it.adultOnly === 'EVERYONE') && sb.requested === false && sb.sellerProductName === '테스트 카라향(시험용)' && sb.items[0].maximumBuyCount === 0, 'items.칸 = 모든 옵션 · requested·이름은 못 덮음', sb && [sb.requested, sb.sellerProductName]);

        // 등록 보관행으로 update 거절
        const xc = await run({ op: 'update_full', ...base, backup_id: kc.db.backups[0].id, patch: { name: '테스트' } }, kc.deps);
        ok(!xc.ok && /get_full 로 만든/.test(xc.error), '등록 기록 행으로 update 거절', xc);

        // 임시저장 상품: get_full → update_full(requested false · 바로 저장) → approval → delete_saved
        const gs = await run({ op: 'get_full', ...base, seller_product_id: SAVEDID }, kc.deps);
        ok(gs.ok && gs.saved === true, '임시저장 get_full saved true', gs);
        const us = await run({ op: 'update_full', ...base, backup_id: gs.backup_id, patch: { name: '테스트 카라향(시험용) 고침', detail_html: '<p>한 줄 고침</p>' } }, kc.deps);
        const pu = kc.cp.puts[kc.cp.puts.length - 1];
        ok(us.ok && us.saved === true && us.requested === false && pu.requested === false && us.status_after === '임시저장' && /임시저장/.test(us.approval_note), '임시저장 update = requested false(승인 요청 안 함)', us);
        // 실측 10/18: 임시저장 수정 직후 상태 = 「임시저장중」 → 되돌리기도 requested false(심사에 안 올라감) · 삭제도 됨
        kc.cp.prods[SAVEDID].statusName = '임시저장중';
        const rs = await run({ op: 'revert_full', ...base, backup_id: gs.backup_id }, kc.deps);
        ok(rs.ok && rs.saved === true && rs.requested === false && kc.cp.puts[kc.cp.puts.length - 1].requested === false, '「임시저장중」 되돌리기 = requested false(승인 요청 안 함)', rs);
        // 보관 때 상태를 모르는 상품 = 전체 수정 거절(뜻밖의 승인 요청 방지)
        const kq = mkp(); kq.cp.prods[SPC].statusName = '이상한상태';
        const gq = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kq.deps);
        const uq = await run({ op: 'update_full', ...base, backup_id: gq.backup_id, patch: { name: '테스트' } }, kq.deps);
        ok(!uq.ok && /상태\(이상한상태\)를 몰라/.test(uq.error) && kq.cp.puts.length === 0, '모르는 상태 = 전체 수정 거절 · PUT 0', uq);
        kc.cp.prods[SAVEDID].statusName = '임시저장중';
        const ap = await run({ op: 'approval', seller_product_id: SAVEDID }, kc.deps);
        ok(ap.ok && ap.status === '임시저장중' && ap.saved === true && ap.histories.length === 2 && kc.cp.approvals.length === 0, 'approval = 상태 + 이력 읽기만(승인 요청 PUT 0) · 지시 불필요', ap);
        const kd = mkp(); kd.cp.prods[SPC].statusName = '승인반려';
        const apd = await run({ op: 'approval', seller_product_id: SPC }, kd.deps);
        ok(apd.ok && apd.denied === true && apd.deny_reason === '상세에 금지 문구', '반려 = 사유(histories comment)', apd);
        const del0 = await run({ op: 'delete_saved', ...base, seller_product_id: SPC }, kc.deps);
        ok(!del0.ok && /임시저장 상품만/.test(del0.error) && kc.cp.deletes.length === 0, '승인완료 상품 삭제 거절', del0);
        const del = await run({ op: 'delete_saved', ...base, seller_product_id: SAVEDID }, kc.deps);
        ok(del.ok && del.deleted && kc.cp.deletes[0] === SAVEDID, '임시저장 삭제', del);
        // request_approval: 승인완료 = 거절 · 반려 = 올림
        const ra0 = await run({ op: 'request_approval', ...base, seller_product_id: SPC }, mkp().deps);
        ok(!ra0.ok && /임시저장·승인반려 상품만/.test(ra0.error), '승인완료 상품 승인 요청 거절', ra0);
        const kr = mkp(); kr.cp.prods[SPC].statusName = '승인반려';
        const ra = await run({ op: 'request_approval', ...base, seller_product_id: SPC }, kr.deps);
        ok(ra.ok && kr.cp.approvals[0] === SPC && ra.status_after === '심사중', '반려 상품 승인 요청 = PUT approvals', ra);
        // #733-B 상세 블록 · 외부 그림 · 옵션 추가
        {
            const BL = [{ type: 'html', html: '<p>타이벡 감귤</p>' }, { type: 'image', url: 'vendor_inventory/x.jpg' }, { type: 'image', url: 'https://shop-phinf.pstatic.net/a.jpg' }];
            const kb = mkp(); kb.cp.prods[SPC].statusName = '임시저장';
            const gb = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kb.deps);
            const off = await run({ op: 'update_full', ...base, backup_id: gb.backup_id, patch: { detail_blocks: BL } }, kb.deps);
            ok(!off.ok && /detail_blocks 3: 외부 그림 주소는 설정 allow_external_images/.test(off.error) && kb.cp.puts.length === 0, '외부 그림 블록 = 설정 꺼짐이면 거절 · 쿠팡 그림은 통과(3번째에서 걸림)', off);
            kb.db.cfg = { allow_external_images: true };
            const tb = async (patch, re, name) => { const x = await run({ op: 'update_full', ...base, backup_id: gb.backup_id, patch }, kb.deps); ok(!x.ok && re.test(x.error), name, x); };
            await tb({ detail_blocks: [{ type: 'image', url: 'http://x.example/a.jpg' }] }, /https:\/\/ 공개 주소만/, 'http 그림 거절(설정 켜도)');
            await tb({ detail_blocks: [{ type: 'html', html: '<script>x</script>' }] }, /script/, '블록 html script 거절');
            await tb({ detail_blocks: [{ type: 'video', url: 'https://a/b' }] }, /image · html · html_raw/, '블록 type 거절');
            await tb({ detail_blocks: BL, detail_html: '<p>x</p>' }, /하나만/, 'detail_html + detail_blocks 같이 거절');
            await tb({ detail_blocks: Array.from({ length: 121 }, () => ({ type: 'html', html: '<p>x</p>' })) }, /1~120개/, '#746 상한 120 — 121블록 거절');
            ok(!mod.cpwApplyFull(kb.cp.prods[SPC], { detail_blocks: Array.from({ length: 68 }, (_, i) => ({ type: 'html', html: '<p>' + i + '</p>' })) }, { allowExternal: true }).error, '#746 68블록(감귤 상세) = 통과');
            const on = await run({ op: 'update_full', ...base, backup_id: gb.backup_id, patch: { detail_blocks: BL } }, kb.deps);
            const pc = kb.cp.puts[0];
            ok(on.ok && on.requested === false && pc.items.every(it => it.contents.length === 3 && it.contents[0].contentsType === 'TEXT' && it.contents[1].contentsType === 'IMAGE_NO_SPACE' && it.contents[2].contentDetails[0].content === 'https://shop-phinf.pstatic.net/a.jpg'),
                '그림 구성 상품도 contents 통째 교체(글 1 · 그림 2 · 모든 옵션 같게)', pc && pc.items.map(it => it.contents));
            ok(on.items_after && on.items_after[0].contents === 'TEXT:TEXT,IMAGE_NO_SPACE:IMAGE,IMAGE_NO_SPACE:IMAGE' && on.items_after[0].content_images.length === 2, '결과 items_after = 상세 꼴·상세 그림 주소', on.items_after);
            // 대표·추가 그림 외부 주소 → vendorPath
            const kv = mkp(); kv.cp.prods[SPC].statusName = '임시저장'; kv.db.cfg = { allow_external_images: true };
            const gv = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kv.deps);
            const iv = await run({ op: 'update_full', ...base, backup_id: gv.backup_id, patch: { images: ['https://cdn.example.com/new.jpg', 'vendor_inventory/a.jpg'] } }, kv.deps);
            const im = kv.cp.puts[0] && kv.cp.puts[0].items[0].images;
            ok(iv.ok && im && im[0].vendorPath === 'https://cdn.example.com/new.jpg' && im[0].imageType === 'REPRESENTATION' && im[1].cdnPath === 'vendor_inventory/a.jpg' && im[1].imageType === 'DETAIL', '새 외부 대표 그림 = vendorPath · 있던 그림 = cdnPath 그대로', im);
            // 변환 모듈(워커2) 꽂기
            const kmod = mkp(); kmod.cp.prods[SPC].statusName = '임시저장';
            const gm = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kmod.deps);
            const conv = (bl) => [{ contentsType: 'HTML', contentDetails: [{ content: 'M:' + bl.length, detailType: 'TEXT' }] }];
            const um = await run({ op: 'update_full', ...base, backup_id: gm.backup_id, patch: { detail_blocks: [{ type: 'html', html: '<p>a</p>' }] } }, { ...kmod.deps, detailBlocksToContents: conv });
            ok(um.ok && kmod.cp.puts[0].items[0].contents[0].contentsType === 'HTML' && kmod.cp.puts[0].items[0].contents[0].contentDetails[0].content === 'M:1', 'deps.detailBlocksToContents 가 있으면 그 변환을 씀', kmod.cp.puts[0] && kmod.cp.puts[0].items[0].contents);
            // 실제 모듈(워커2 detail-blocks.js toCoupangContents)을 꽂은 꼴 = 러너와 같음
            const DB = require(path.join(__dirname, '..', 'detail-blocks.js'));
            const kr = mkp(); kr.cp.prods[SPC].statusName = '임시저장'; kr.db.cfg = { allow_external_images: true };
            const gr = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kr.deps);
            const ur = await run({ op: 'update_full', ...base, backup_id: gr.backup_id, patch: { detail_blocks: BL } }, { ...kr.deps, detailBlocksToContents: (bl) => DB.toCoupangContents(bl) });
            const rc = kr.cp.puts[0] && kr.cp.puts[0].items[0].contents;
            ok(ur.ok && rc && rc.length === 3 && rc[0].contentsType === 'TEXT' && rc[2].contentsType === 'IMAGE_NO_SPACE' && rc[2].contentDetails[0].content === 'https://shop-phinf.pstatic.net/a.jpg', '실제 detail-blocks.js 변환 = 글 TEXT · 그림 IMAGE_NO_SPACE(모듈 꼴)', rc);
            // 옵션 추가(임시저장) → 되돌리기 = 빠짐
            const ka = mkp(); ka.cp.prods[SPC].statusName = '임시저장';
            const ga = await run({ op: 'get_full', ...base, seller_product_id: SPC }, ka.deps);
            const ta = async (patch, re, name) => { const x = await run({ op: 'update_full', ...base, backup_id: ga.backup_id, patch }, ka.deps); ok(!x.ok && re.test(x.error), name, x); };
            await ta({ items_add: [{ itemName: '카라향 3kg', price: 10000, stock: 1 }] }, /겹쳐요/, '옵션 추가 이름 겹침 거절');
            await ta({ items_add: [{ itemName: '새', price: 10005, stock: 1 }] }, /10원 단위/, '옵션 추가 10원 단위 거절');
            await ta({ items_add: [{ itemName: '새', price: 10000, stock: 1, vendorItemId: 1 }] }, /허용되지 않은 칸 vendorItemId/, '옵션 추가 번호 칸 거절');
            const ua = await run({ op: 'update_full', ...base, backup_id: ga.backup_id, patch: { items_add: [{ itemName: '타이벡 3kg', price: 25800, stock: 99999 }] } }, ka.deps);
            const pa2 = ka.cp.puts[0];
            const nw = pa2 && pa2.items[2];
            ok(ua.ok && pa2.items.length === 3 && nw.itemName === '타이벡 3kg' && nw.salePrice === 25800 && nw.maximumBuyCount === 99999 && !('sellerProductItemId' in nw) && !('vendorItemId' in nw) && nw.originalPrice === 50000 && /승인 뒤/.test(ua.items_add_note),
                '옵션 추가 = 마지막 옵션 틀 · 번호 칸 없이 · 가격·재고 · 결과 안내', [nw, ua.items_add_note]);
            const ra = await run({ op: 'revert_full', ...base, backup_id: ga.backup_id }, ka.deps);
            ok(ra.ok && ka.cp.puts[1].items.length === 2 && ka.cp.puts[1].requested === false, '임시저장 옵션 추가 되돌리기 = 보관본(옵션 빠짐) · 승인 요청 안 함', ra);
            // 구매옵션 값(attributes): 틀 복사 그대로면 다른 옵션과 같아 거절 · 주면 그 칸만 바꿈
            const kt = mkp(); kt.cp.prods[SPC].statusName = '임시저장';
            kt.cp.prods[SPC].items[0].attributes = [{ attributeTypeName: '중량', attributeValueName: '3kg' }, { attributeTypeName: '등급', attributeValueName: '' }];
            kt.cp.prods[SPC].items[1].attributes = [{ attributeTypeName: '중량', attributeValueName: '5kg' }, { attributeTypeName: '등급', attributeValueName: '' }];
            const gt = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kt.deps);
            const xt = await run({ op: 'update_full', ...base, backup_id: gt.backup_id, patch: { items_add: [{ itemName: '카라향 10kg', price: 69800, stock: 1 }] } }, kt.deps);
            ok(!xt.ok && /구매옵션 값\(중량 등\)을 같이 주세요/.test(xt.error) && kt.cp.puts.length === 0, 'attributes 안 주면(틀 복사 = 5kg 중복) 거절', xt);
            const yt = await run({ op: 'update_full', ...base, backup_id: gt.backup_id, patch: { items_add: [{ itemName: '카라향 10kg', price: 69800, stock: 1, attributes: [{ attributeTypeName: '중량', attributeValueName: '10kg' }] }] } }, kt.deps);
            const at3 = kt.cp.puts[0] && kt.cp.puts[0].items[2].attributes;
            ok(yt.ok && at3 && at3.length === 2 && at3[0].attributeValueName === '10kg' && at3[1].attributeTypeName === '등급' && kt.cp.puts[0].items[1].attributes[0].attributeValueName === '5kg', 'attributes 주면 그 칸만 10kg · 틀(5kg 옵션)은 그대로', at3);
            // #749 images_replace — 그 그림이 있는 옵션에서만 · 자리·종류 그대로 · 없는 그림·외부 꺼짐 거절
            {
                const kr = mkp(); kr.db.cfg = { allow_external_images: true };
                kr.cp.prods[SPC].items[1].images = [{ imageOrder: 0, imageType: 'REPRESENTATION', cdnPath: 'vendor_inventory/r5.jpg' }, { imageOrder: 1, imageType: 'DETAIL', cdnPath: 'vendor_inventory/c.jpg' }];
                const gr = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kr.deps);
                const ur = await run({ op: 'update_full', ...base, backup_id: gr.backup_id, patch: { images_replace: { 'vendor_inventory/b.jpg': 'https://shop-phinf.pstatic.net/new-b.jpg', 'vendor_inventory/c.jpg': 'https://shop-phinf.pstatic.net/new-c.jpg' } } }, kr.deps);
                const pi = kr.cp.puts[0] && kr.cp.puts[0].items.map(it => it.images.map(im => [im.imageType, im.cdnPath || im.vendorPath]));
                ok(ur.ok && JSON.stringify(pi) === JSON.stringify([[['REPRESENTATION', 'vendor_inventory/a.jpg'], ['DETAIL', 'https://shop-phinf.pstatic.net/new-b.jpg']], [['REPRESENTATION', 'vendor_inventory/r5.jpg'], ['DETAIL', 'https://shop-phinf.pstatic.net/new-c.jpg']]]),
                    'images_replace = 그 그림 있는 옵션만 제자리 교체(대표·순서·종류 그대로 · 다른 옵션에 안 섞임)', pi);
                const tr2 = async (patch, re, name) => { const x = await run({ op: 'update_full', ...base, backup_id: gr.backup_id, patch }, kr.deps); ok(!x.ok && re.test(x.error), name, x); };
                const kr2 = mkp(); const gr2 = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kr2.deps);
                const x1 = await run({ op: 'update_full', ...base, backup_id: gr2.backup_id, patch: { images_replace: { 'vendor_inventory/zz.jpg': 'https://shop-phinf.pstatic.net/x.jpg' } } }, kr2.deps);
                ok(!x1.ok && /그림이 이 상품에 없어요/.test(x1.error), 'images_replace 없는 그림 = 거절', x1);
                const x2 = await run({ op: 'update_full', ...base, backup_id: gr2.backup_id, patch: { images_replace: { 'vendor_inventory/a.jpg': 'https://evil.example/x.jpg' } } }, kr2.deps);
                ok(!x2.ok && /allow_external_images/.test(x2.error) && kr2.cp.puts.length === 0, 'images_replace 외부 주소 = 설정 꺼짐이면 거절 · PUT 0', x2);
                void tr2;
            }
            // #745 기존 옵션 구매옵션 값(item_attrs) — 이름 칸만 · 새 칸 거절 · 겹침 거절 · 되돌리기 = 보관본 값
            {
                const ka = mkp();
                ka.cp.prods[SPC].items[0].attributes = [{ attributeTypeName: '농산물 중량', attributeValueName: '선물용 - 3kg(대과 7~15과)', exposed: 'EXPOSED' }, { attributeTypeName: '수량', attributeValueName: '1박스' }];
                ka.cp.prods[SPC].items[1].attributes = [{ attributeTypeName: '농산물 중량', attributeValueName: '선물용 - 5kg(대과 13~23과)', exposed: 'EXPOSED' }, { attributeTypeName: '수량', attributeValueName: '1박스' }];
                const ga = await run({ op: 'get_full', ...base, seller_product_id: SPC }, ka.deps);
                const tx = async (patch, re, name) => { const x = await run({ op: 'update_full', ...base, backup_id: ga.backup_id, patch }, ka.deps); ok(!x.ok && re.test(x.error), name, x); };
                await tx({ item_attrs: { '95059733579': { '등급': '특' } } }, /칸이 이 옵션에 없어요/, 'item_attrs 없는 칸 = 거절(새 칸 추가 안 함)');
                await tx({ item_attrs: { '95059733579': { '농산물 중량': '선물용 - 5kg(대과 13~23과)' } } }, /다른 옵션.*같아져요/, 'item_attrs 다른 옵션과 묶음 겹침 = 거절');
                await tx({ item_attrs: { '카라향 3kg': { '농산물 중량': 'x' } } }, /번호로만/, 'item_attrs 옵션은 번호로만');
                await tx({ item_attrs: { '95059733579': { '농산물 중량': '선물용 - 3kg(대과 7~15과)' } } }, /지금과 같아요/, 'item_attrs 같은 값 = 거절');
                ok(ka.cp.puts.length === 0, 'item_attrs 거절 동안 PUT 0');
                const ua = await run({ op: 'update_full', ...base, backup_id: ga.backup_id, patch: { item_names: { '95059733579': '선물용 - 3kg(중대과 7~15과) 1박스' }, item_attrs: { '95059733579': { '농산물 중량': '선물용 - 3kg(중대과 7~15과)' } } } }, ka.deps);
                const pa = ka.cp.puts[0] && ka.cp.puts[0].items;
                ok(ua.ok && pa[0].itemName === '선물용 - 3kg(중대과 7~15과) 1박스' && pa[0].attributes[0].attributeValueName === '선물용 - 3kg(중대과 7~15과)' && pa[0].attributes[0].exposed === 'EXPOSED' && pa[0].attributes[1].attributeValueName === '1박스' && pa[1].attributes[0].attributeValueName === '선물용 - 5kg(대과 13~23과)',
                    'itemName + 구매옵션 값 한 PUT · 다른 칸(exposed·수량)·다른 옵션 그대로', pa && pa.map(it => [it.itemName, it.attributes]));
                const ra = await run({ op: 'revert_full', ...base, backup_id: ga.backup_id }, ka.deps);
                ok(ra.ok && ka.cp.puts[1].items[0].attributes[0].attributeValueName === '선물용 - 3kg(대과 7~15과)' && ka.cp.puts[1].items[0].itemName === '카라향 3kg', 'revert_full = 보관본 구매옵션 값·옵션명으로', ra);
                // 보관 뒤 Wing 에서 구매옵션 값만 바뀜 = update 신선도 거절
                const kw = mkp(); kw.cp.prods[SPC].items[0].attributes = [{ attributeTypeName: '농산물 중량', attributeValueName: 'A' }];
                const gw = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kw.deps);
                kw.cp.prods[SPC].items[0].attributes[0].attributeValueName = 'B';
                const uw = await run({ op: 'update_full', ...base, backup_id: gw.backup_id, patch: { name: '테스트' } }, kw.deps);
                ok(!uw.ok && /바뀐 곳/.test(uw.error) && kw.cp.puts.length === 0, '보관 뒤 구매옵션 값만 바뀜 = 신선도 거절(지문에 attributes)', uw);
            }
            // revert 느슨 비교 = 상세 꼴·그림 장수까지 — 임시저장 이름 수정 뒤 Wing 에서 상세만 바꾸면 force 없이 거절
            const kl = mkp(); kl.cp.prods[SPC].statusName = '임시저장';
            const gl = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kl.deps);
            await run({ op: 'update_full', ...base, backup_id: gl.backup_id, patch: { name: '테스트 카라향' } }, kl.deps);
            kl.cp.prods[SPC].items[0].contents.push({ contentsType: 'IMAGE', contentDetails: [{ content: 'vendor_inventory/z.jpg', detailType: 'IMAGE' }] });
            const rl = await run({ op: 'revert_full', ...base, backup_id: gl.backup_id }, kl.deps);
            ok(!rl.ok && /force/.test(rl.error) && kl.cp.puts.length === 1, 'Wing 에서 상세만 바뀜 = 느슨 비교도 걸림(force 필요)', rl);
            // 그림 주소만 CDN 으로 바뀐 것은 통과(장수·꼴 같음)
            const kc2 = mkp(); kc2.cp.prods[SPC].statusName = '임시저장';
            const gc2 = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kc2.deps);
            await run({ op: 'update_full', ...base, backup_id: gc2.backup_id, patch: { name: '테스트 카라향' } }, kc2.deps);
            kc2.cp.prods[SPC].items[0].images[0].cdnPath = 'vendor_inventory/changed.jpg';
            const rc2 = await run({ op: 'revert_full', ...base, backup_id: gc2.backup_id }, kc2.deps);
            ok(rc2.ok, '그림 주소만 바뀐 것(장수·꼴 같음) = 느슨 비교 통과', rc2);
            // 승인된 상품: 옵션 추가는 승인행 · 되돌리기는 추가 옵션이 번호를 받으면 거절(승인 옵션 삭제 불가)
            const kp = mkp();
            const gp = await run({ op: 'get_full', ...base, seller_product_id: SPC }, kp.deps);
            const up = await run({ op: 'update_full', ...base, backup_id: gp.backup_id, patch: { items_add: [{ itemName: '타이벡 3kg', price: 25800, stock: 10 }] } }, kp.deps);
            ok(up.ok && up.requested === true && /승인 전까지/.test(up.approval_note), '승인된 상품 옵션 추가 = 승인행(requested true)', up);
            kp.cp.prods[SPC].sellerProductName = kp.cp.puts[0].sellerProductName;   // 승인 뒤 = 보낸 값이 반영된 모습
            kp.cp.prods[SPC].items.push({ ...JSON.parse(JSON.stringify(kp.cp.puts[0].items[2])), sellerProductItemId: 509, vendorItemId: null });   // 승인 뒤 새 옵션이 번호를 받은 모습(틀 복사 그대로)
            const rp = await run({ op: 'revert_full', ...base, backup_id: gp.backup_id }, kp.deps);
            ok(!rp.ok && /승인된 상품에선 되돌리기로 못 빼요/.test(rp.error) && kp.cp.puts.length === 1, '승인된 상품의 추가 옵션 = 되돌리기 거절(Wing 판매중지 안내)', rp);
        }
        // 동시 · audit
        const ks = mkp();
        const slow = { ...ks.deps, call: async (r) => { await new Promise(res => setTimeout(res, 20)); return ks.cp.call(r); } };
        const [q1, q2] = await Promise.all([run({ op: 'get_full', ...base, seller_product_id: SPC }, slow), run({ op: 'get_full', ...base, seller_product_id: SPC }, slow)]);
        ok([q1, q2].filter(x => x.ok).length === 1, '같은 상품 동시 작업 하나만', [q1.error, q2.error]);
        const pa = new Set(audits.map(x => x.action));
        ok(['coupang_product_backup', 'coupang_product_update', 'coupang_product_revert', 'coupang_product_create_saved', 'coupang_product_create_failed', 'coupang_product_create_unknown', 'coupang_product_delete_saved', 'coupang_product_request_approval', 'coupang_product_update_failed'].every(x => pa.has(x))
            && audits.every(x => x.targetId === null && x.source === 'coupang-item-write'), '상품 audit 9종 · targetId null', [...pa]);
    }

    console.log('⑩ #732 brand_search(읽기 · 지시 불필요)');
    {
        const seen = [];
        const call = async (r) => { seen.push(r); if (r.method === 'POST' && /\/marketplace\/brands\/search$/.test(r.path)) return { code: 'SUCCESS', data: { page: 1, countPerPage: 10, totalCount: 2, items: [{ brandId: 'KR-77001', brandName: '제주아꼼이네', brandLogoUrl: null, isUIDRequired: false }, { brandId: 'KR-77002', brandName: '제주아꼼이네몰' }] } }; throw new Error('모르는 호출 ' + r.path); };
        const bs = await run({ op: 'brand_search', q: '제주아꼼이네' }, { pool: fakePool(ORDERS), call, audit, gapMs: 0 });
        ok(bs.ok && bs.total === 2 && bs.brands.length === 2 && bs.brands[0].brandId === 'KR-77001' && bs.exact.length === 1 && bs.exact[0].brandId === 'KR-77001' && seen.length === 1 && seen[0].method === 'POST' && !seen[0].query
            && JSON.stringify(seen[0].body) === JSON.stringify({ brandName: '제주아꼼이네', countPerPage: 10, page: 1 }) && bs.brands[0].uid_required === false,
            'brand_search = POST …/brands/search 하나 · 바디 3칸 · 쿼리 없음 · brandId 글자(KR-…) · exact', bs);
        const nq = await run({ op: 'brand_search', q: ' ' }, { pool: fakePool(ORDERS), call, audit, gapMs: 0 });
        const arr = await run({ op: 'brand_search', q: 'akkome' }, { pool: fakePool(ORDERS), call: async () => ({ code: 'SUCCESS', data: [{ id: 5, name: 'AKKOME' }] }), audit, gapMs: 0 });
        ok(!nq.ok && /q/.test(nq.error) && arr.ok && arr.brands[0].brandId === '5' && arr.brands[0].brandName === 'AKKOME' && arr.exact.length === 0, '빈 q 거절 · 배열 응답·다른 칸 이름도 읽음', [nq, arr]);
    }

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('검증 오류', e); process.exit(1); });
