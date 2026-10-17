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
const mod = new Function(src.slice(a, b) + '\nreturn { coupangItemWriteRun, cpwCheckPatch, cpwSaleCheck, cpwItemOf, CPW_PATH };')();

let pass = 0, failN = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

// ── 가짜 pool ──────────────────────────────────────────
function fakePool(orders) {
    const backups = []; let seq = 0;
    const find = (id) => backups.find(x => x.id === id);
    return {
        backups,
        async query(sql, p = []) {
            if (/FROM pending_orders WHERE id = \$1/.test(sql)) return { rows: orders.filter(o => o.id === p[0]) };
            if (/^\s*INSERT INTO coupang_item_backups \(seller_product_id, vendor_item_id, order_id, before_json, created_by\)/.test(sql)) {
                const r = { id: ++seq, seller_product_id: p[0], vendor_item_id: p[1], order_id: p[2], before_json: JSON.parse(p[3]), created_by: p[4], patch_json: null, after_json: null, applied_at: null, reverted_at: null, result_json: null };
                backups.push(r); return { rows: [{ id: r.id }] };
            }
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

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('검증 오류', e); process.exit(1); });
