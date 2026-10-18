// #740(대표 10/18 「수정 요청하면 품목·옵션 수정하고 영향표 확인 체크까지 · 송장변환 매칭 잘 되게 · 애매한 건 오류 띄워」) 창구용 — 옵션 영향 점검(쓰기 0)
//   node scripts/desk/option-impact.js check naver <네이버 상품번호> [옵션 글자 조각…]
//   node scripts/desk/option-impact.js check mall  <c92 또는 네이버 상품번호> [옵션 글자 조각…]
//   node scripts/desk/option-impact.js check coupang <쿠팡 상품 번호(sellerProductId)> [옵션 글자 조각…]
//   그 상품의 지금 옵션마다 다섯 칸을 본다(✓ / 🟡 / 🔴 + 이유 + 고칠 길):
//     ①송장 매칭  = app.js matchProduct(송장변환·중간발주와 같은 함수)에 실제 주문 글 꼴을 넣어 단가표(pricing) 품목 하나에 딱 맞는가(없음·여럿 = 🔴)
//     ②발송안내   = 판매현황(bot_products) 행에 연결되는가(네이버 = 엄격 · 자사몰·쿠팡 = 느슨 + 연결표 notify_opt_alias) · 안내문까지 있는가
//     ③가격 짝    = price-check 의 옵션 열쇠(같은 매칭기)로 다른 채널의 같은 상품 옵션과 짝이 되는가
//     ④새벽 비교  = 05:10 네이버↔카페24 비교 열쇠(cafe24OptKey · 과일|용도|kg|등급)가 상대편에 있는가(자사몰과 연결된 상품만)
//     ⑤자사몰 담기 = 스킨이 고르는 「찾는 글자」로 카페24 옵션을 정확히 찾는가 — 스킨 mergeSnapshot(#393·#337)과 같은 식: 번호 프리픽스·공백을 뗀 n1|n2 가 같으면
//       **스킨 내장 STORE_DATA 의 n1·n2(= 카페24 글자)를 그대로 지킴**, 새 옵션만 네이버 글자 → 그 글자가 카페24 판매 옵션 글자와 정확히 같아야 원터치
//       🔴 #743 교훈: 네이버 글자와 직접 비교하던 첫 판정식이 틀려 멀쩡한 황금향을 「깨짐」으로 보고 → 카페24 이름을 바꿔 오히려 깨뜨렸다(되돌림). 이 칸은 실화면 확인 전까지 「참고」(요약 🔴 에 안 셈)
//   다른 창구 도구(naver-detail · coupang-item · mall-option)가 옵션 이름 바꾸기·추가 결과 끝에 require 해서 붙인다: check(channel, product, filters, deps)
const path = require('path');
const M = require('./_mall');
const ROOT = M.ROOT;
const PC = require(path.join(ROOT, 'price-check.js'));
const KN = require(path.join(ROOT, 'kakao-notify.js'));
const nrm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const noNum = s => nrm(s).replace(/^\d+\.\s*/, '');
const skinNorm = s => String(s || '').replace(/\s*\(\+[\d,]+원\)\s*$/, '').replace(/\s+/g, ' ').trim();   // 스킨 norm() 과 같은 식
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ── 매칭기(app.js 그대로 · price-check 와 같은 경계)
let _m;
function matcher(names) {
    if (!_m) {
        const src = require('fs').readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
        const a = src.indexOf('// 품목명 카탈로그'), b = src.indexOf('function addSizeSuffix');
        if (a < 0 || b <= a) throw new Error('app.js 매칭기 경계를 못 찾았어요');
        _m = new Function(src.slice(a, b) + '\nreturn { matchProduct, aoMatchKey: (typeof aoMatchKey === "function" ? aoMatchKey : null), setPricing: (arr) => { aoInvoicePricingNames = arr; } };')();
    }
    _m.setPricing(names); return _m;
}
// 송장 매칭 판정: 결과가 단가표 이름이면 ✓ · 단가표 이름이 둘 이상 「통째로」 들어 있으면(서로 포함 관계가 아닌) 🔴 애매 · [미매칭] = 🔴 없음
function invoiceCheck(raw, names) {
    const m = matcher(names), r = m.matchProduct(raw);
    const rk = m.aoMatchKey ? m.aoMatchKey(raw) : null;
    let cands = names.filter(nm => nm && (raw.includes(nm) || (rk && m.aoMatchKey(nm) && rk.includes(m.aoMatchKey(nm)))));
    const key = nm => m.aoMatchKey ? m.aoMatchKey(nm) : nm;
    cands = cands.filter(a => !cands.some(b => b !== a && key(b).includes(key(a))));   // 더 긴 이름에 포함된 짧은 이름은 뺀다(matchProduct 도 긴 이름을 고름)
    if (typeof r !== 'string' || r.startsWith('[미매칭]')) return { ok: false, mark: '🔴', got: null, why: '단가표 품목에 안 맞음(미매칭)', fix: '옵션 이름에 품목·kg·크기(로얄과·소과 등)·용도를 넣거나, 단가표(품목별 금액)에 이 품목을 등록' };
    if (cands.length > 1) return { ok: false, mark: '🔴', got: r, why: `단가표 품목 ${cands.length}개가 겹쳐 들어 있음(${cands.slice(0, 3).join(' · ')}) — 지금은 「${r}」 로 잡힘`, fix: '옵션 이름을 한 품목만 읽히게 고치기(겹치는 낱말 빼기) · 맞는 품목이 다르면 단가표 이름 확인' };
    if (!names.includes(r)) return { ok: false, mark: '🟡', got: r, why: `규칙 파서 이름 「${r}」 — 오늘 단가표에 같은 이름 없음`, fix: '단가표(품목별 금액)에 이 이름이 있는지 확인' };
    return { ok: true, mark: '✓', got: r };
}
async function pricingNames() { const r = await M.pool.query(`SELECT items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date`, [kstDay()]); const set = new Set(); r.rows.forEach(x => (x.items || []).forEach(it => { if (it && it.name) set.add(it.name); })); return [...set]; }

// ── 읽기(네이버 실시간 = 묶음 이름까지 · 카페24 · 쿠팡)
async function naverRead(nno) {
    await M.pool.query(`DELETE FROM agent_office_config WHERE key = 'naver_query_result'`);
    await M.cfgSet('naver_query_request', { calls: [{ method: 'GET', path: `/external/v2/products/channel-products/${nno}` }] });
    const t0 = Date.now(); let res = null;
    while (Date.now() - t0 < 150000) { await M.sleep(5000); const q = await M.pool.query(`SELECT value FROM agent_office_config WHERE key = 'naver_query_result'`); if (q.rows.length) { res = q.rows[0].value; await M.pool.query(`DELETE FROM agent_office_config WHERE key = 'naver_query_result'`); break; } }
    const r = res && Array.isArray(res.results) ? res.results[0] : null;
    if (!r || !r.ok) throw new Error(`네이버 ${nno} 조회 실패: ` + String((r && r.error) || '응답 없음').slice(0, 120));
    const j = JSON.parse(r.data_str), op = j.originProduct || {}, oi = ((op.detailAttribute || {}).optionInfo) || {};
    const g = oi.optionCombinationGroupNames || {};
    const groups = [g.optionGroupName1, g.optionGroupName2, g.optionGroupName3].filter(Boolean);
    const opts = (oi.optionCombinations || []).map(o => ({ id: o.id, n1: o.optionName1 || '', n2: o.optionName2 || '', n3: o.optionName3 || '', usable: o.usable !== false, stock: o.stockQuantity }));
    return { nno: String(nno), name: op.name || '', shownName: ((j.smartstoreChannelProduct || {}).channelProductName) || op.name || '', groups, opts };
}
async function mallRead(cno) {
    const r = await M.c24({ action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}/options` });
    if (!M.c24Ok(r)) throw new Error(`카페24 c${cno} 옵션 조회 실패`);
    const o = (r.raw.data && (r.raw.data.option || r.raw.data.options)) || {};
    const groups = (Array.isArray(o.options) ? o.options : []).map(g => ({ name: g.option_name, values: (g.option_value || []).map(v => v.option_text) }));
    const c = await M.c24Product(cno);
    return { cno: String(cno), name: c.name, groups, vars: c.vars };
}
// 쿠팡 주문 글(vendorItemName) — 서버의 쿠팡 송장(노출상품명(옵션명))·발송안내(optText)가 쓰는 글. 목록 응답엔 없어서
//   ①최근 60일 쿠팡 알림 기록(product_name = 매칭 실패 때 vendorItemName 원문)에서 옵션명 낱말이 다 들어 있는 글을 찾고 ②없으면 관찰된 꼴
//   「상품명, 1박스, 옵션명(「1박스」 뺀 것)」 으로 만든다(추정 표시)
let _cpSeen = null;
async function cpSeenNames() {
    if (_cpSeen) return _cpSeen;
    const set = new Set();
    for (const t of ['kakao_notify_log', 'lms_guide_log']) {
        try { const r = await M.pool.query(`SELECT DISTINCT product_name p FROM ${t} WHERE order_key LIKE 'cp:%' AND created_at > NOW() - interval '60 days'`); r.rows.forEach(x => { const p = String(x.p || '').replace(/\s*\(안내문 미등록\)\s*$/, '').trim(); if (p.includes(', ')) set.add(p); }); } catch (_) { }
    }
    return (_cpSeen = [...set]);
}
function cpVendorItemName(pname, itemName, seen) {
    const toks = String(itemName || '').split(/\s+/).filter(Boolean);
    const hit = seen.find(t => t.startsWith(pname + ',') && toks.every(w => t.includes(w)));
    if (hit) return { text: hit, guessed: false };
    const rest = String(itemName || '').replace(/\s*1박스\s*/, ' ').replace(/\s+/g, ' ').trim();
    return { text: `${pname}, 1박스, ${rest}`, guessed: true };
}
async function coupangRead(spid) {
    const CI = require('./coupang-item');
    const R = CI.makeRunner({ pool: M.pool, sleep: M.sleep, now: () => Date.now() });
    let res = await R.send({ op: 'list', q: null }, 280000);
    if (!res.ok) throw new Error('쿠팡 목록 조회 실패: ' + (res.error || ''));
    let p = (res.products || []).find(x => String(x.sellerProductId) === String(spid));
    if (p && !(p.vendorItems || []).length && res.truncated) {   // 목록이 잘려 옵션을 못 받았으면 상품명 낱말로 다시
        const q = String(p.name || '').replace(/^제주아꼼이네\s*제철\s*/, '').split(/\s+/).filter(w => w.length >= 2).slice(-2).join(' ');
        const r2 = await R.send({ op: 'list', q }, 280000);
        const p2 = r2.ok ? (r2.products || []).find(x => String(x.sellerProductId) === String(spid)) : null;
        if (p2) p = p2;
    }
    if (!p) throw new Error(`쿠팡 상품 ${spid} 를 목록에서 못 찾았어요(승인 전이면 옵션 번호가 없어요)`);
    const seen = await cpSeenNames();
    return { spid: String(spid), name: p.name || '', items: (p.vendorItems || []).map(v => { const n = CI.norm(v); const vn = cpVendorItemName(p.name || '', n.item_name || '', seen); return { vid: String(v.vendorItemId), name: n.item_name || '', vin: vn.text, vinGuessed: vn.guessed, on_sale: n.on_sale, stock: n.stock }; }) };
}
const naverOptText = o => (o.n1 && o.n2) ? `${o.n1} · ${o.n2}` : (o.n2 || o.n1 || '');
const naverProductOption = (groups, o) => [o.n1, o.n2, o.n3].map((v, i) => v ? `${groups[i] || '옵션' + (i + 1)}: ${v}` : null).filter(Boolean).join(' / ');
const mallParts = v => String(v || '').split(/\s*(?:·|\/)\s*/).map(x => x.trim()).filter(Boolean);
const pkey = (parts, names) => { const k = PC.optionKey(parts && parts.length ? parts : [''], names); return k && k.by === 'match' ? k.key : null; };

async function check(channel, product, filters, deps) {
    deps = deps || {};
    const ch = String(channel || '').toLowerCase();
    if (!['naver', 'mall', 'coupang'].includes(ch)) throw new Error('채널은 naver · mall · coupang');
    const names = deps.pricingNames || await pricingNames();
    const bp = (await M.pool.query(`SELECT id, name, shipping_guide FROM bot_products WHERE deleted_at IS NULL`)).rows;
    const alias = await M.cfgGet('notify_opt_alias');
    const ignore = new Set((((await M.cfgGet('cafe24_sync_ignore_opts')) || {}).keys) || []);
    const syncMap = ((await M.cfgGet('cafe24_sync_map')) || {}).map || {};
    const snap = await M.latestSnapshot().catch(() => null);
    const fl = (filters || []).map(nrm).filter(Boolean);
    const want = t => !fl.length || fl.some(f => nrm(t).includes(f));
    const notifyCell = (m) => !m ? { mark: '🔴', why: '판매현황 행에 연결 안 됨(안내 버튼 「(안내문 미등록)」)', fix: '연결표 notify_opt_alias 에 「이 옵션 글」 = 판매현황 id 한 줄(총괄에게) 또는 판매현황 이름을 이 옵션과 맞게' }
        : (m.shipping_guide && String(m.shipping_guide).trim()) ? { mark: '✓', got: `${m.name}(#${m.id})` } : { mark: '🟡', got: `${m.name}(#${m.id})`, why: '연결은 됐지만 안내문이 비어 있음', fix: '판매현황 그 행에 안내문 넣기' };
    const rows = [];
    let head = {};

    if (ch === 'naver' || ch === 'mall') {
        // 네이버 상품 번호 · 카페24 번호 짝
        let nno = null, cno = null; const s = String(product || '').trim();
        if (ch === 'naver') { nno = s.replace(/\D/g, ''); cno = syncMap[nno] ? String(syncMap[nno].c24) : null; }
        else if (/^c\d+$/i.test(s)) { cno = s.slice(1); nno = (Object.entries(syncMap).find(([, m]) => String(m.c24) === cno) || [])[0] || null; }
        else { nno = s.replace(/\D/g, ''); cno = syncMap[nno] ? String(syncMap[nno].c24) : null; }
        if (ch === 'mall' && !cno) throw new Error('자사몰과 연결된 상품이 아니에요(cafe24_sync_map)');
        const N = nno ? await naverRead(nno) : null;
        const C = cno ? await mallRead(cno) : null;
        head = { naver: nno, mall: cno ? 'c' + cno : null, name: (N && N.shownName) || (C && C.name) };
        const nUse = N ? N.opts.filter(o => o.usable) : [];
        const liveVars = C ? C.vars.filter(v => v.selling === 'T' && v.display === 'T') : [];
        const c24Keys = new Set(liveVars.map(v => PC.cafe24OptKey(v.name)).filter(Boolean));
        const nvKeys = new Set(nUse.filter(o => !(o.stock != null && Number(o.stock) === 0)).map(o => PC.cafe24OptKey(o.n1 + ' ' + o.n2)).filter(Boolean));
        const c24Texts = new Set(liveVars.map(v => skinNorm(v.name)));
        const snapItem = snap && nno ? (snap.items || []).find(x => String(x.no) === nno) : null;
        let embItem = null; try { const SD = M.storeData(M.readLocal().toString('utf8')).D; embItem = nno ? (SD.items || []).find(x => String(x.no) === nno) : null; } catch (_) { embItem = null; }
        const onorm = v => String(v || '').normalize('NFC').replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
        const skinText = o => { const e = embItem ? (embItem.opts || []).find(x => onorm(x.n1) === onorm(o.n1) && onorm(x.n2) === onorm(o.n2)) : null; const src = e || o; return { text: (src.n1 && src.n2) ? `${src.n1} · ${src.n2}` : (src.n2 || src.n1 || ''), from: e ? '스킨 내장 글자' : '네이버 글자(새 옵션)' }; };
        const c24tOf = o => { const so = snapItem ? (snapItem.opts || []).find(x => (x.n1 || '') === o.n1 && (x.n2 || '') === o.n2) : null; return so && so.c24t ? so.c24t : null; };
        const mallKeys = new Set(liveVars.map(v => pkey(mallParts(v.name), names)).filter(Boolean));
        const naverKeys = new Set(nUse.map(o => pkey([o.n1, o.n2].filter(Boolean), names)).filter(Boolean));

        if (ch === 'naver') for (const o of N.opts) {
            const text = naverOptText(o); if (!want(text)) continue;
            const po = naverProductOption(N.groups, o);
            const inv = invoiceCheck(po, names);
            const nt = notifyCell(KN.matchNotifyProduct(`${N.name} ${po}`, bp));
            const k = pkey([o.n1, o.n2].filter(Boolean), names);
            const price = !k ? { mark: '🔴', why: '특징(품목·kg·크기·용도)을 못 읽음', fix: '옵션 이름에 품목·kg·크기 넣기' } : !C ? { mark: '🟡', why: '자사몰과 연결 안 된 상품(짝 비교 없음)' } : mallKeys.has(k) ? { mark: '✓' } : { mark: '🔴', why: '자사몰에 같은 상품 옵션이 없음', fix: '자사몰에 옵션 추가(카페24 관리자) 또는 자사몰 전용·네이버 전용이면 그대로' };
            const ck = PC.cafe24OptKey(o.n1 + ' ' + o.n2);
            const dawn = !C ? { mark: '—' } : !o.usable || (o.stock != null && Number(o.stock) === 0) ? { mark: '—', why: '판매 안 함·재고 0 = 비교 밖' } : ignore.has(ck) ? { mark: '✓', why: '예외 열쇠(cafe24_sync_ignore_opts)' } : c24Keys.has(ck) ? { mark: '✓' } : { mark: '🔴', why: `새벽 05:10 「옵션명 불일치」 경보(열쇠 ${ck || '없음'})`, fix: '자사몰 옵션 이름에 과일·용도·kg·크기 낱말을 네이버와 같게 · 구성 차이면 예외 열쇠 등록(총괄)' };
            const st = skinText(o);
            const skin = !C || !o.usable ? { mark: '—' } : c24Texts.has(skinNorm(st.text)) ? { mark: '✓', why: st.from } : c24tOf(o) && c24Texts.has(skinNorm(c24tOf(o))) ? { mark: '✓', why: 'c24t 짝' } : { mark: '🔴', ref: true, why: `스킨이 찾는 글자 「${noNum(st.text).slice(-40)}」(${st.from})가 카페24 판매 옵션에 없음 — 원터치 깨짐 가능(참고 · 실화면 확인 필요)`, fix: '실화면에서 담기 확인 뒤 카페24 이름을 스킨 글자와 같게 · 스킨 내장 글자 갱신(#537 절차) · 또는 스킨 짝(c24t) 배포 뒤' };
            rows.push({ option: text, usable: o.usable, cells: { invoice: inv, notify: nt, price, dawn, skin } });
        }
        if (ch === 'mall') for (const g of C.groups) for (const v of g.values) {
            if (!want(v)) continue;
            const vr = C.vars.find(x => nrm(x.name) === nrm(v));
            const live = !!vr && vr.selling === 'T' && vr.display === 'T';
            const optVal = `${g.name}=${v}`;
            const inv = invoiceCheck(`${C.name} ${optVal}`, names);
            const nt = notifyCell(KN.matchNotifyProductLoose(`${C.name} ${optVal}`, bp) || KN.matchNotifyAlias(optVal, bp, alias));
            const k = pkey(mallParts(v), names);
            const price = !k ? { mark: '🔴', why: '특징을 못 읽음', fix: '옵션 이름에 품목·kg·크기 넣기' } : !N ? { mark: '🟡', why: '네이버와 연결 안 됨' } : naverKeys.has(k) ? { mark: '✓' } : { mark: live ? '🟡' : '—', why: '네이버에 같은 상품 옵션 없음(자사몰 전용이면 정상)' };
            const ck = PC.cafe24OptKey(v);
            const dawn = !N || !live ? { mark: '—', why: live ? '' : '숨김 = 비교 밖' } : ignore.has(ck) ? { mark: '✓', why: '예외 열쇠' } : nvKeys.has(ck) ? { mark: '✓' } : { mark: '🟡', why: '네이버에 같은 열쇠 없음(자사몰 전용이면 정상)' };
            const nvExact = nUse.find(o => skinNorm(skinText(o).text) === skinNorm(v));
            const nvByC24t = nUse.find(o => c24tOf(o) && skinNorm(c24tOf(o)) === skinNorm(v));
            const sameProductNv = k ? nUse.find(o => pkey([o.n1, o.n2].filter(Boolean), names) === k) : null;
            const skin = !live || !N ? { mark: '—' } : nvExact ? { mark: '✓' } : nvByC24t ? { mark: '✓', why: 'c24t 짝' } : sameProductNv ? { mark: '🔴', ref: true, why: `스킨이 찾는 글자 「${noNum(skinText(sameProductNv).text).slice(-40)}」 와 달라 원터치 깨짐 가능(참고 · 실화면 확인 필요)`, fix: '실화면 담기 확인 뒤 판단 · 스킨 짝(c24t) 배포 뒤' } : { mark: '🟡', why: '네이버에 없는 자사몰 전용 옵션(화면에 안 나옴)' };
            rows.push({ option: v, usable: live, code: vr ? vr.code : null, cells: { invoice: inv, notify: nt, price, dawn, skin } });
        }
    } else {
        const P = await coupangRead(product);
        head = { coupang: P.spid, name: P.name };
        const snapKeys = new Set(); if (snap) for (const it of snap.items || []) for (const o of (it.opts || [])) if (o.usable !== false) { const k = pkey([o.n1, o.n2].filter(Boolean), names); if (k) snapKeys.add(k); }
        for (const it of P.items) {
            if (!want(it.name)) continue;
            const inv = invoiceCheck(`${P.name} ${it.vin}`, names);   // 송장변환 = 등록상품명 + 노출상품명(옵션명)=vendorItemName
            const nt = notifyCell(KN.matchNotifyProductLoose(it.vin, bp) || KN.matchNotifyAlias(it.vin, bp, alias));   // 서버 collectCoupangGuide 와 같은 글
            if (it.vinGuessed) { inv.why = (inv.why ? inv.why + ' · ' : '') + '(주문 글 꼴 추정 — 쿠팡 주문 기록 없음)'; nt.why = (nt.why ? nt.why + ' · ' : '') + '(주문 글 꼴 추정)'; }
            const k = pkey([P.name, it.name], names);
            const price = !k ? { mark: '🔴', why: '특징을 못 읽음', fix: '옵션 이름에 품목·kg·크기 넣기 · 또는 연결표 coupang_item_map 에 짝(coupang-item.js map --set)' } : snapKeys.has(k) ? { mark: '✓' } : { mark: '🟡', why: '네이버에 같은 상품 옵션 없음' };
            rows.push({ option: it.name + (it.vinGuessed ? ' (글 꼴 추정)' : ''), usable: it.on_sale !== false, vid: it.vid, cells: { invoice: inv, notify: nt, price, dawn: { mark: '—' }, skin: { mark: '—' } } });
        }
    }
    const COLS = [['invoice', '송장 매칭'], ['notify', '발송안내'], ['price', '가격 짝'], ['dawn', '새벽 비교'], ['skin', '자사몰 담기']];
    const reds = [], refs = [];
    const table = rows.map(r => {
        const marks = COLS.map(([k, ko]) => `${ko} ${r.cells[k].mark}${r.cells[k].ref ? '(참고)' : ''}`).join(' · ');
        for (const [k, ko] of COLS) { const c = r.cells[k]; if (c.mark === '🔴' && r.usable !== false) (c.ref ? refs : reds).push(`「${noNum(r.option).slice(-40)}」 ${ko}: ${c.why}${c.fix ? ' → ' + c.fix : ''}`); }
        return `${r.usable === false ? '(숨김) ' : ''}${noNum(r.option).slice(-46)} | ${marks}`;
    });
    return { ok: true, channel: ch, ...head, n: rows.length, table, reds, refs, rows,
        summary: reds.length ? `🔴 ${reds.length}건 — 반영은 됐어도 아래 옵션은 고쳐야 해요` : '✓ 이 상품 옵션은 송장 매칭·발송안내·가격 짝·새벽 비교·자사몰 담기 모두 이상 없음(숨김 옵션 제외)' };
}
module.exports = { check, invoiceCheck };

if (require.main === module) {
    (async () => {
        const [cmd, ch, product, ...fl] = process.argv.slice(2);
        if (cmd !== 'check' || !ch || !product) { console.log('사용: check <naver|mall|coupang> <상품> [옵션 글자 조각…]'); await M.pool.end(); return; }
        const r = await check(ch, product, fl);
        console.log(JSON.stringify({ ok: r.ok, channel: r.channel, naver: r.naver, mall: r.mall, coupang: r.coupang, name: r.name, n: r.n, summary: r.summary, reds: r.reds, refs_skin: r.refs, table: r.table }, null, 1));
        await M.pool.end();
    })().catch(async e => { console.log(JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 300) })); try { await M.pool.end(); } catch (_) { } process.exit(1); });
}
