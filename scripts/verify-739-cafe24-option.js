// #739 검증 — 카페24 옵션 시험·이름 바꾸기(server.js 「#739 시작」~「#739 끝」)를 떼어 가짜 deps 로 돌린다.
//   실DB·카페24 호출 0: cfgGet/cfgSet 은 메모리 · apiGet/apiReq 는 가짜 카페24(상품·옵션·품목).
//   실행: node scripts/verify-739-cafe24-option.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('// #739 시작'), b = src.indexOf('// #739 끝');
if (a < 0 || b <= a) { console.error('server.js 에서 #739 구간을 못 찾음'); process.exit(1); }
const mod = new Function(src.slice(a, b) + '\nreturn { cafe24OptRun, CAF_TEST_NAME, CAF_TEST_KEY, cafVarDiff };')();

let pass = 0, failN = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };

// ── 가짜 카페24 ───────────────────────────────────────
function fake(opts = {}) {
    const st = { products: {}, seq: 900, calls: [], writes: [] };
    if (opts.live) st.products[100] = { name: '하우스감귤', display: 'T', selling: 'T', groups: [{ option_name: '상품 및 과수', values: ['2.5kg', '4kg'] }],
        variants: [{ code: 'P0000100000A', vals: ['2.5kg'], add: '0.00', selling: 'T', display: 'T' }, { code: 'P0000100000B', vals: ['4kg'], add: '9000.00', selling: 'T', display: 'T' }] };
    const err = (status, msg, detail) => { const e = new Error('cafe24_api_' + status); e.status = status; e.reason = msg; e.detail = detail || { error: { message: msg } }; return e; };
    const prodOf = (p) => { const m = p.match(/^\/api\/v2\/admin\/products\/(\d+)(\/options|\/variants)?$/); return m ? { no: Number(m[1]), sub: m[2] || '' } : null; };
    // 옵션 GET = 원문 꼴 칸(표시 꼴 · 값마다 색·그림)까지 — g.display · g.vmeta[i](있을 때)
    const optView = (pr) => ({ option: { has_option: pr.groups.length ? 'T' : 'F', option_type: 'T', option_list_type: 'S', options: pr.groups.map(g => ({ option_name: g.option_name, ...(g.display ? { option_display_type: g.display } : {}),
        option_value: g.values.map((t, i) => ({ option_text: t, value_no: null, ...((g.vmeta && g.vmeta[i]) || {}) })) })) } });
    const varView = (pr) => ({ variants: pr.variants.map(v => ({ variant_code: v.code, options: v.vals.map((x, i) => ({ name: pr.groups[i].option_name, value: x })), additional_amount: v.add, selling: v.selling, display: v.display })) });
    st.apiGet = async (p, q, h) => {
        st.calls.push('GET ' + p); (st.hdr = st.hdr || []).push({ m: 'GET', p, v: h && h['X-Cafe24-Api-Version'] || null });
        if (p === '/api/v2/admin/products') return { products: Object.entries(st.products).filter(([, x]) => !q.product_name || x.name === q.product_name).map(([n, x]) => ({ product_no: Number(n), product_name: x.name, display: x.display, selling: x.selling })) };
        const m = prodOf(p); const pr = m && st.products[m.no];
        if (!pr) throw err(404, 'No product');
        if (m.sub === '/options') return optView(pr);
        if (m.sub === '/variants') return varView(pr);
        return { product: { product_no: m.no, product_name: pr.name, display: pr.display, selling: pr.selling } };
    };
    st.apiReq = async (method, p, body, h) => {
        st.calls.push(method + ' ' + p); st.writes.push({ method, p, body }); (st.hdr = st.hdr || []).push({ m: method, p, v: h && h['X-Cafe24-Api-Version'] || null });
        if (method === 'POST' && p === '/api/v2/admin/products') { const no = ++st.seq; st.products[no] = { name: body.request.product_name, display: body.request.display, selling: body.request.selling, groups: [], variants: [] }; return { product: { product_no: no } }; }
        const m = prodOf(p); const pr = m && st.products[m.no];
        if (!pr) throw err(404, 'No product');
        if (method === 'POST' && m.sub === '/options') {
            pr.groups = body.request.options.map(g => ({ option_name: g.option_name, values: g.option_value.map(v => v.option_text) }));
            pr.variants = pr.groups[0].values.map((t, i) => ({ code: `P0000${m.no}00000${String.fromCharCode(65 + i)}`, vals: [t], add: '0.00', selling: 'T', display: 'T' }));
            return { option: {} };
        }
        if (method === 'PUT' && m.sub === '/options') {
            const o = body.request.options, org = body.request.original_options;
            if (opts.putFail) throw err(400, 'put 실패');
            // 원래 이름·값이 지금과 다르면 거절
            if (JSON.stringify(org.map(g => [g.option_name, g.option_value.map(v => v.option_text)])) !== JSON.stringify(pr.groups.map(g => [g.option_name, g.values]))) throw err(422, 'original_options 불일치');
            const addN = o.reduce((s, g) => s + g.option_value.length, 0) - org.reduce((s, g) => s + g.option_value.length, 0);
            if (addN !== 0 && !opts.addOk) throw err(422, '옵션 항목을 추가하거나 삭제할 수는 없습니다');
            o.forEach((g, gi) => {
                const old = pr.groups[gi].values, nw = g.option_value.map(v => v.option_text);
                for (const v of pr.variants) { const i = old.indexOf(v.vals[gi]); if (i >= 0 && i < nw.length) v.vals[gi] = nw[i]; }
                for (let i = old.length; i < nw.length; i++) pr.variants.push({ code: `P0000${m.no}0000N${i}`, vals: [nw[i]], add: '0.00', selling: 'T', display: 'T' });
                pr.groups[gi] = { option_name: g.option_name, values: nw };
            });
            if (opts.sideEffect) opts.sideEffect(pr);
            return { option: {} };
        }
        throw err(400, '가짜 카페24가 모르는 호출 ' + method + ' ' + p);
    };
    return st;
}
const cfgStore = () => { const m = new Map(); return { m, cfgGet: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null), cfgSet: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; };
const audits = [];
const audit = async (x) => { audits.push(x); };
const mk = (opts) => { const cp = fake(opts), cs = cfgStore(); return { cp, cs, deps: { apiGet: cp.apiGet, apiReq: cp.apiReq, cfgGet: cs.cfgGet, cfgSet: cs.cfgSet, audit } }; };
const run = (req, deps) => mod.cafe24OptRun(req, deps);
const G = (name, vals) => ({ option_name: name, option_value: vals.map(t => ({ option_text: t })) });

(async () => {
    console.log('① 시험 상품 만들기 · 재사용 · 하루 1개');
    const k = mk({ live: true });
    const c = await run({ action: 'test_product_create', created_by: '시험' }, k.deps);
    const np = k.cp.products[c.product_no];
    ok(c.ok && c.reused === false && c.product_no === 901 && np.name === mod.CAF_TEST_NAME && np.display === 'F' && np.selling === 'F', '시험 상품 = 이름 · 진열 F · 판매 F', c);
    ok(c.options.groups.length === 1 && c.options.groups[0].option_name === '테스트 옵션' && c.options.groups[0].values.join() === '테스트A,테스트B' && c.variants.length === 2, '옵션 1묶음 2값 · 품목 2', [c.options, c.variants]);
    ok(k.cp.writes[0].body.request.price === '1000' && k.cs.m.get(mod.CAF_TEST_KEY).products[0].product_no === 901, '가격 1000 · 번호를 설정 cafe24_test_products 에', k.cs.m.get(mod.CAF_TEST_KEY));
    const c2 = await run({ action: 'test_product_create' }, k.deps);
    ok(c2.ok && c2.reused === true && c2.product_no === 901 && k.cp.writes.filter(w => w.p === '/api/v2/admin/products').length === 1, '두 번째 = 재사용(새로 안 만듦)', c2);
    const k2 = mk(); k2.cp.products[555] = { name: mod.CAF_TEST_NAME, display: 'F', selling: 'F', groups: [], variants: [] };
    const c3 = await run({ action: 'test_product_create' }, k2.deps);
    ok(c3.ok && c3.reused && c3.product_no === 555 && k2.cs.m.get(mod.CAF_TEST_KEY).products[0].product_no === 555 && k2.cp.writes.length === 0, '설정에 없어도 같은 이름 상품 = 찾아서 재사용 · 설정에 적음', c3);
    const k3 = mk(); await k3.cs.cfgSet(mod.CAF_TEST_KEY, { products: [{ product_no: 777 }], last_created_at: new Date().toISOString() });
    const c4 = await run({ action: 'test_product_create' }, k3.deps);
    ok(!c4.ok && /24시간에 1개/.test(c4.error) && k3.cp.writes.length === 0, '24시간 1개(지워진 시험 상품 · 새로 못 만듦)', c4);

    console.log('② 읽기 · options_put(시험 상품만)');
    const og = await run({ action: 'options_get', product_no: 901 }, k.deps);
    const vg = await run({ action: 'variants_get', product_no: 901 }, k.deps);
    ok(og.ok && og.options.groups[0].values.length === 2 && vg.ok && vg.variants[0].code === 'P000090100000A' && vg.variants[0].opts === '테스트 옵션=테스트A', 'options_get · variants_get', [og, vg]);
    const live = await run({ action: 'options_put', product_no: 100, options: [G('상품 및 과수', ['2.5kg', '4kg'])], original_options: [G('상품 및 과수', ['2.5kg', '4kg'])] }, k.deps);
    ok(!live.ok && /시험 상품만/.test(live.error) && !k.cp.writes.some(w => w.method === 'PUT'), '운영 상품 options_put = 거절 · PUT 0', live);
    const add = await run({ action: 'options_put', product_no: 901, options: [G('테스트 옵션', ['테스트A', '테스트B', '테스트C'])], original_options: [G('테스트 옵션', ['테스트A', '테스트B'])] }, k.deps);
    ok(!add.ok && add.code === 422 && /추가하거나 삭제할 수는 없습니다/.test(add.reason) && add.variants_unchanged === true, '값 추가 PUT = 카페24 거절(문서) · 품목 그대로 보고', add);
    const kb = mk({ addOk: true }); const cb = await run({ action: 'test_product_create' }, kb.deps);
    const addOk = await run({ action: 'options_put', product_no: cb.product_no, options: [G('테스트 옵션', ['테스트A', '테스트B', '테스트C'])], original_options: [G('테스트 옵션', ['테스트A', '테스트B'])] }, kb.deps);
    ok(addOk.ok && addOk.kept === true && addOk.added.length === 1 && addOk.added[0].opts === '테스트 옵션=테스트C' && addOk.removed.length === 0, '값 추가가 되는 경우 = 새 품목 1 · 기존 품목 유지', addOk);
    const tg = async (req, re, name) => { const x = await run({ action: 'options_put', product_no: 901, ...req }, k.deps); ok(!x.ok && re.test(x.error), name, x); };
    await tg({ options: [G('테스트 옵션', ['테스트A', '테스트A'])], original_options: [G('테스트 옵션', ['테스트A', '테스트B'])] }, /같은 값이 두 번/, '같은 값 두 번 = 거절');
    await tg({ options: [], original_options: [G('테스트 옵션', ['테스트A'])] }, /1~10묶음/, '빈 options = 거절');
    await tg({ options: [G('테스트 옵션', ['테스트A'])] }, /original_options/, 'original_options 없음 = 거절');

    console.log('③ option_rename — 품목 코드·추가금·판매·진열 유지 · 되돌리기');
    const r1 = await run({ action: 'option_rename', product_no: 901, from: '테스트A', to: '테스트A2', created_by: '시험' }, k.deps);
    ok(r1.ok && r1.test === true && r1.kept === true && r1.renamed.length === 1 && r1.renamed[0].code === 'P000090100000A' && r1.renamed[0].to === '테스트 옵션=테스트A2' && r1.added.length === 0 && r1.removed.length === 0,
        '값 이름 바꾸기 = 같은 품목 코드 · 글자만 바뀜', r1);
    const put = k.cp.writes.filter(w => w.method === 'PUT').pop().body.request;
    const txt = (gs) => JSON.stringify(gs.map(g => [g.option_name, g.option_value.map(v => v.option_text)]));
    ok(txt(put.original_options) === JSON.stringify([['테스트 옵션', ['테스트A', '테스트B']]]) && txt(put.options) === JSON.stringify([['테스트 옵션', ['테스트A2', '테스트B']]]) && put.option_list_type === 'S', 'PUT 바디 = 지금 옵션(original) + 그 값만 바꾼 옵션 · option_list_type', put);
    // 꼴 칸 보존(워커3 점검 ⓐ): 원문 GET 의 표시 꼴·색·그림이 PUT 바디에 그대로 · 이름 바꾼 값도 자기 원문 칸
    {
        const kk = mk(); const cc = await run({ action: 'test_product_create' }, kk.deps);
        const pg = kk.cp.products[cc.product_no].groups[0];
        pg.display = 'P'; pg.vmeta = [{ option_color: '#ff0000', option_image_file: 'https://img/a.jpg' }, { option_color: '#00ff00', option_image_file: 'https://img/b.jpg' }];
        await run({ action: 'option_rename', product_no: cc.product_no, from: '테스트A', to: '테스트A2' }, kk.deps);
        const pb = kk.cp.writes.filter(w => w.method === 'PUT').pop().body.request;
        const nv = pb.options[0], ov = pb.original_options[0];
        ok(nv.option_display_type === 'P' && nv.option_value[0].option_text === '테스트A2' && nv.option_value[0].option_color === '#ff0000' && nv.option_value[0].option_image_file === 'https://img/a.jpg'
            && nv.option_value[1].option_color === '#00ff00' && ov.option_value[0].option_text === '테스트A' && ov.option_value[0].option_image_file === 'https://img/a.jpg',
            'PUT = 원문 객체 깊은 복사 위에 글자만(표시 꼴·색·그림 보존)', pb);
        // 새 값(options_put 시험) = 같은 묶음 첫 값의 꼴 칸 복사 · 그림 칸은 비움
        const kn = mk({ addOk: true }); const cn = await run({ action: 'test_product_create' }, kn.deps);
        const ng = kn.cp.products[cn.product_no].groups[0]; ng.vmeta = [{ option_color: '#ff0000', option_image_file: 'https://img/a.jpg' }, { option_color: '#00ff00' }];
        await run({ action: 'options_put', product_no: cn.product_no, options: [G('테스트 옵션', ['테스트A', '테스트B', '테스트C'])], original_options: [G('테스트 옵션', ['테스트A', '테스트B'])] }, kn.deps);
        const nb = kn.cp.writes.filter(w => w.method === 'PUT').pop().body.request.options[0].option_value;
        ok(nb[2].option_text === '테스트C' && nb[2].option_color === '#ff0000' && nb[2].option_image_file === '' && nb[0].option_image_file === 'https://img/a.jpg', '새 값 = 첫 값 꼴 칸 복사 · 그림 칸 비움 · 기존 값 원문 그대로', nb);
    }
    ok(r1.revert && r1.revert.from === '테스트A2' && r1.revert.to === '테스트A', '결과에 되돌리기 요청(반대 rename)', r1.revert);
    ok(r1.to_visible === true, 'rename 뒤 옵션 재조회에 새 이름 보임 · 옛 이름 사라짐(to_visible)', r1.to_visible);
    const r2 = await run(r1.revert, k.deps);
    // 창구 mall-option.js 꼴(group · order_id · revert) — group = option_name 별칭
    const rg = await run({ action: 'option_rename', product_no: 901, group: '테스트 옵션', from: '테스트B', to: '테스트B2', order_id: 3000 }, k.deps);
    const rgx = await run({ action: 'option_rename', product_no: 901, group: '없는 묶음', from: '테스트A', to: '테스트A9' }, k.deps);
    ok(rg.ok && rg.kept && rg.to_visible && !rgx.ok && /하나로 찾지 못/.test(rgx.error), 'group 칸 = 그 묶음 안에서만 찾음(다른 묶음 이름 = 거절)', [rg, rgx]);
    await run({ action: 'option_rename', product_no: 901, group: '테스트 옵션', from: '테스트B2', to: '테스트B', revert: true }, k.deps);
    ok(r2.ok && r2.kept && r2.renamed[0].to === '테스트 옵션=테스트A' && k.cp.products[901].groups[0].values.join() === '테스트A,테스트B', '되돌리기 = 원래 이름 · 품목 유지', r2);
    const tr = async (req, re, name) => { const x = await run({ action: 'option_rename', product_no: 901, ...req }, k.deps); ok(!x.ok && re.test(x.error), name, x); };
    await tr({ from: '없음', to: 'x' }, /하나로 찾지 못/, '없는 값 = 거절');
    await tr({ from: '테스트A', to: '테스트B' }, /이미 있어요/, '같은 묶음에 있는 이름 = 거절');
    await tr({ from: '테스트A', to: '테스트A' }, /같아요/, 'from = to 거절');
    await tr({ from: '테스트A', to: 'x'.repeat(101) }, /1~100자/, 'to 101자 거절');
    // 운영 상품: 설정 꺼짐 = 거절 · 켜면 됨
    const lr = await run({ action: 'option_rename', product_no: 100, from: '2.5kg', to: '2.5kg(로얄과)' }, k.deps);
    ok(!lr.ok && /cafe24_option_rename.enabled/.test(lr.error), '운영 상품 rename = 설정 꺼짐이면 거절', lr);
    await k.cs.cfgSet('cafe24_option_rename', { enabled: true });
    const lr2 = await run({ action: 'option_rename', product_no: 100, from: '2.5kg', to: '2.5kg(로얄과)' }, k.deps);
    ok(lr2.ok && lr2.test === false && lr2.kept === true && k.cp.products[100].variants[1].add === '9000.00', '설정 켜면 운영 상품 rename · 다른 품목 추가금 그대로', lr2);
    // 카페24 가 품목을 건드린 척 → kept false 로 드러남
    const kx = mk({ sideEffect: (pr) => { pr.variants[0].add = '500.00'; } });
    const cx = await run({ action: 'test_product_create' }, kx.deps);
    const rx = await run({ action: 'option_rename', product_no: cx.product_no, from: '테스트A', to: '테스트A2' }, kx.deps);
    ok(rx.ok && rx.kept === false && rx.changed.length === 1 && /add: 0.00 → 500.00/.test(rx.changed[0]), '품목 추가금이 바뀌면 kept false · changed 로 보고', rx);
    // PUT 은 오류 없이 끝났는데 이름이 안 바뀜(실측 10/18 시험 상품 120) → ok false · not_applied
    const kn2 = mk({ sideEffect: (pr) => { pr.groups[0].values = ['테스트A', '테스트B']; for (const v of pr.variants) v.vals = [v.code.endsWith('A') ? '테스트A' : '테스트B']; } });
    const cn2 = await run({ action: 'test_product_create' }, kn2.deps);
    const rn2 = await run({ action: 'option_rename', product_no: cn2.product_no, from: '테스트A', to: '테스트A2' }, kn2.deps);
    ok(!rn2.ok && rn2.not_applied === true && rn2.to_visible === false && /이름이 안 바뀌었어요/.test(rn2.error), 'PUT 통과했지만 이름 그대로 = 실패로 보고(not_applied)', rn2);
    // PUT 실패
    const kf = mk({ putFail: true });
    const cf = await run({ action: 'test_product_create' }, kf.deps);
    const rf = await run({ action: 'option_rename', product_no: cf.product_no, from: '테스트A', to: '테스트A2' }, kf.deps);
    ok(!rf.ok && rf.code === 400 && rf.variants_unchanged === true, 'PUT 실패 = 코드·사유 · 품목 그대로 확인', rf);

    console.log('④ 버전 머리글 = 옵션 길에만');
    {
        const hs = k.cp.hdr || [];
        const opt = hs.filter(x => /\/options$/.test(x.p) && (x.m === 'GET' || x.m === 'PUT'));
        const other = hs.filter(x => !(/\/options$/.test(x.p) && (x.m === 'GET' || x.m === 'PUT')));
        ok(opt.length >= 4 && opt.every(x => x.v === '2026-09-01') && other.length >= 3 && other.every(x => x.v === null),
            'X-Cafe24-Api-Version 2026-09-01 = 옵션 GET·PUT 에만 · 품목·상품·등록 길은 머리글 없음(종전)', { opt: opt.length, other: other.map(x => x.m + ' ' + x.p + ' ' + x.v) });
        // cafe24.js: 머리글 인자 안 주면 요청 머리글이 종전과 같음(송장·mall-price 무영향)
        const c24 = fs.readFileSync(path.join(__dirname, '..', 'cafe24.js'), 'utf8');
        ok(/async function apiGet\(path, query, extraHeaders\)/.test(c24) && /async function apiReq\(method, path, body, extraHeaders\)/.test(c24) && (c24.match(/\.\.\.\(extraHeaders \|\| \{\}\)/g) || []).length === 2,
            'cafe24.js apiGet·apiReq = 머리글 인자 선택(없으면 {} 펼침 = 종전 머리글)');
    }

    console.log('⑤ audit · 꼴');
    ok(audits.length >= 4 && audits.every(x => x.source === 'cafe24-option' && x.targetId === null), 'audit source cafe24-option · targetId null', audits.map(x => x.action));
    const acts = new Set(audits.map(x => x.action));
    ok(['cafe24_test_product_create', 'cafe24_options_put', 'cafe24_options_put_failed', 'cafe24_option_rename', 'cafe24_option_rename_failed'].every(x => acts.has(x)), 'audit 종류 5', [...acts]);
    const nx = await run({ action: 'options_get' }, k.deps);
    const bad = await run({ action: 'delete_all' }, k.deps);
    ok(!nx.ok && /product_no/.test(nx.error) && !bad.ok, 'product_no 없음 · 모르는 action 거절');
    ok(!k.cp.calls.some(c => c.startsWith('DELETE')), 'DELETE 호출 0(옵션 삭제·재등록 길 없음)');

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('검증 오류', e); process.exit(1); });
