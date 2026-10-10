// #612 「전체 가격 확인하기」 — 네이버 상품 페이지 전부 + 자사몰(카페24) 상품의 옵션 결제가를 한 표로 모아 어긋난 곳을 찾는다 (읽기 전용 · 쓰기 0)
//   대표 뜻(10/10): 가격을 고칠 때 한 페이지만 고치고 같은 옵션이 걸린 다른 페이지(귤 페이지 · 선물 페이지 · 자사몰)를 빼먹는 사고를 한 눈에.
//                   예외 = VIP 페이지는 같은 옵션이 더 싼 것이 맞다(VIP 끼리 견준다 · VIP 가 일반보다 비싸면 그때만 문제).
//
//   build({ pool, cafe24Get?, cfg?, now?, c24Products?, snapshots?, pricingNames?, pages? }) → 보고 JSON
//     pool        : DB(SELECT 만 한다 — naver_product_snapshot · pricing · agent_office_config)
//     cafe24Get   : (path, query) → 응답 body   = server.js 의 cafe24.apiGet 그대로. 없으면 자사몰은 「조회 못 함」으로 두고 네이버끼리만 견준다
//     cfg         : { naverCfgGet? }  없으면 agent_office_config 를 직접 읽는다
//     c24Products / snapshots / pricingNames / pages : 시험·창구용 주입(주면 그 값을 쓰고 조회하지 않는다)
//
//   자료
//     네이버  = naver_product_snapshot(매일 새벽 스냅샷) 맨 끝 줄 items[] { no, name, statusType, discPrice(할인 뒤 기본 결제가), salePrice, opts[{ n1, n2, price(옵션 증감), stock, usable }] }
//               옵션 결제가 = discPrice + opts.price (자사몰 가격 도구 mall-price.js · 새벽 05:10 점검과 같은 식)
//               마지막 변경일 = 보관된 스냅샷(지금 약 30일치)을 날짜순으로 훑어 그 페이지·그 옵션 결제가가 마지막으로 달라진 날. 그 안에 변화가 없으면 null(「○/○ 이전부터 그대로」)
//     자사몰  = 카페24 상품(기본가) + variants(추가금) — 결제가 = 기본가 + 추가금. 변경 이력은 보관하지 않는다 → 변경일 「확인 불가」
//     쿠팡    = 🔴 제외(중계서버에 가격 조회 길이 없다 — 발주서 조회 2종뿐)
//   페이지 등급(tier) = normal | vip | gift | bulk
//     ①이름 규칙(「VIP」 = vip · 「선물세트」 = gift · 「대용량」 = bulk) ②아래 DEFAULT_PAGES(알려진 사실) ③설정 agent_office_config 'price_check_pages' { "naver:번호"|"cafe24:번호"(또는 "mall:번호"): { tier, name, note, ignore } } 가 마지막에 덮는다
//     자사몰 상품은 연결표(cafe24_sync_map)로 짝이 된 네이버 페이지의 등급을 물려받는다(설정으로 따로 줄 수 있다).
//   견주는 법 = 옵션을 「같은 상품」 열쇠로 묶는다(app.js matchProduct — 송장변환·중간발주와 같은 판정 · 못 읽는 옵션은 글자 열쇠).
//     vip 가 아닌 등급(normal·gift·bulk)은 한 무리(base) — 서로 값이 같아야 한다. vip 는 vip 끼리.
'use strict';
const fs = require('fs'); const path = require('path');

// 알려진 사실(설정이 없을 때의 기본) — 10801253976 = 「VIP 선물페이지」(이름에 VIP 글자가 없다 · CLAUDE_ARCHIVE #562)
const DEFAULT_PAGES = { 'naver:10801253976': { tier: 'vip', note: 'VIP 선물페이지' } };
const TIERS = ['normal', 'vip', 'gift', 'bulk'];
const STALE_DAYS = 7;
const NOTE_KINDS = ['missing', 'vip_same'];   // 참고(문제로 세지 않는 것)

// ── app.js 의 매칭기를 그대로 떼어 쓴다(verify-406-match 와 같은 경계) — 브라우저 파일이라 require 가 안 된다 ──
let _matcher;   // undefined = 아직 · null = 못 만듦
function getMatcher() {
    if (_matcher !== undefined) return _matcher;
    try {
        const src = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
        const a = src.indexOf('// 품목명 카탈로그'), b = src.indexOf('function addSizeSuffix');
        if (a < 0 || b <= a) throw new Error('경계 없음');
        _matcher = new Function(src.slice(a, b) + '\nreturn { matchProduct, matchProductRaw, setPricing: (arr) => { aoInvoicePricingNames = arr; } };')();
    } catch (e) { _matcher = null; }
    return _matcher;
}
// 글자 열쇠(매칭기가 못 읽는 옵션용) — 번호·행사 꼬리표·띄어쓰기만 벗긴 옵션 글자 전체. 품목 묶음 이름(n1)도 넣어 다른 품목의 같은 글자(「못난이 3kg」)가 섞이지 않게 한다
const cleanPart = s => String(s == null ? '' : s).replace(/^\s*\d+\s*[.)]\s*/, '').replace(/\((?:제철|★행사|★특가|특가|행사)\)/g, '').replace(/행사★|★행사|★특가/g, '').replace(/[\s·\/\-–—~]/g, '').toLowerCase();
const FRUIT_RE = /천혜향|레드향|한라봉|황금향|카라향|수라향|감귤|하귤|홍귤|청귤|풋귤|레몬|키위|자몽|오렌지|밤호박|옥수수|양배추|브로콜리|취나물/;
function textKey(parts) {
    const cs = parts.filter(Boolean).map(cleanPart).filter(Boolean);
    if (cs.length > 1 && FRUIT_RE.test(cs[cs.length - 1])) return 't:' + cs[cs.length - 1];   // 옵션 이름만으로 무엇인지 알 수 있으면 묶음 이름(「★추천 선물세트」 등)은 뺀다
    return 't:' + cs.join('|');
}
// 옵션 → { key, label, by }   parts = [묶음 이름, 옵션 이름] (묶음이 없으면 [옵션 이름])
function optionKey(parts, pricingNames) {
    const ps = (Array.isArray(parts) ? parts : [parts]).map(x => String(x == null ? '' : x).trim()).filter(Boolean);
    const text = ps.length > 1 ? `${ps[0]} / 상품 및 과수: ${ps.slice(1).join(' ')}` : (ps[0] || '');
    const m = getMatcher();
    if (m && text) {
        try {
            m.setPricing(Array.isArray(pricingNames) ? pricingNames : []);
            let r = pricingNames && pricingNames.length ? m.matchProduct(text) : null;
            if (typeof r !== 'string' || r.startsWith('[미매칭]')) r = m.matchProductRaw(text);
            if (typeof r === 'string' && r && !r.startsWith('[미매칭]')) return { key: 'p:' + r, label: r, by: 'match' };
        } catch (e) { /* 글자 열쇠로 */ }
    }
    return { key: textKey(ps), label: ps.map(x => x.replace(/^s*d+s*[.)]s*/, '')).join(' / '), by: 'text' };
}

const kstDate = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const won = n => (n == null || !Number.isFinite(Number(n))) ? null : Math.round(Number(n));
function tierByName(name) { const s = String(name || ''); return /VIP/i.test(s) ? 'vip' : /선물\s*세트/.test(s) ? 'gift' : /대용량/.test(s) ? 'bulk' : 'normal'; }

async function loadCfg(pool, cfg, key) {
    try { if (cfg && typeof cfg.naverCfgGet === 'function') return await cfg.naverCfgGet(key); } catch (e) { /* 직접 읽기로 */ }
    try { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [key]); return r.rows.length ? r.rows[0].value : null; } catch (e) { return null; }
}
const optText = o => [o.n1, o.n2, o.n3].filter(x => x != null && String(x).trim()).map(x => String(x).trim());

// 카페24 상품·옵션 읽기(읽기 조회만) → [{ cno, name, base, selling, display, vars:[{ code, name, add, selling, display }] }]
async function fetchMall(cafe24Get, wantNos, sleepMs) {
    const sleep = ms => new Promise(r => setTimeout(r, ms)); const gap = sleepMs == null ? 550 : sleepMs;
    const list = []; let off = 0;
    for (;;) {
        const body = await cafe24Get('/api/v2/admin/products', { limit: 100, offset: off, fields: 'product_no,product_name,price,selling,display' });
        const ps = (body && body.products) || []; list.push(...ps); if (ps.length < 100 || off >= 900) break; off += 100; await sleep(gap);
    }
    const out = [];
    for (const p of list) {
        const cno = Number(p.product_no); const on = p.selling === 'T' && p.display === 'T';
        const row = { cno, name: String(p.product_name || ''), base: won(p.price), selling: p.selling, display: p.display, vars: null };
        if (on || wantNos.has(cno)) {   // 파는 상품과 네이버에 연결된 상품만 옵션까지 읽는다(호출 수 아낌)
            await sleep(gap);
            try { const vr = await cafe24Get(`/api/v2/admin/products/${cno}/variants`, { limit: 100 }); row.vars = ((vr && vr.variants) || []).map(v => ({ code: v.variant_code, name: (v.options || []).map(o => o.value).join(' / '), add: won(v.additional_amount) || 0, selling: v.selling, display: v.display })); }
            catch (e) { row.error = String((e && (e.reason || e.message)) || e).slice(0, 100); }
        }
        out.push(row);
    }
    return out;
}

async function build(opt) {
    const o = opt || {}; const pool = o.pool; const now = o.now == null ? Date.now() : new Date(o.now).getTime();
    const notes = ['쿠팡은 제외(가격 조회 길 없음)'];
    // ── 자료 모으기 ──
    let snaps = o.snapshots;
    if (!snaps) snaps = (await pool.query(`SELECT id, run_at, items FROM naver_product_snapshot WHERE items IS NOT NULL ORDER BY id`)).rows;
    snaps = (snaps || []).map(s => ({ id: s.id, at: new Date(s.run_at).getTime(), items: Array.isArray(s.items) ? s.items : (typeof s.items === 'string' ? JSON.parse(s.items) : []) })).filter(s => s.items.length).sort((a, b) => a.at - b.at);
    if (!snaps.length) return { ok: false, generated_at: new Date(now).toISOString(), error: '네이버 스냅샷이 없습니다', pages: [], groups: [], summary: { groups: 0, pages: 0, issues_by_kind: {} }, notes };
    const last = snaps[snaps.length - 1];
    let pricingNames = o.pricingNames;
    if (!pricingNames) { try { const r = await pool.query(`SELECT items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date`, [kstDate(now)]); const set = new Set(); r.rows.forEach(x => (x.items || []).forEach(it => { if (it && it.name) set.add(it.name); })); pricingNames = [...set]; } catch (e) { pricingNames = []; } }
    // 설정 키는 「naver:번호」 · 「mall:번호」 · 「cafe24:번호」(= mall 과 같은 뜻 · 설정 라우트가 이 꼴로 저장) 셋 다 읽는다. 보고의 페이지 key 는 늘 naver:/mall: 이다
    const rawCfg = o.pages || (await loadCfg(pool, o.cfg, 'price_check_pages')) || {}; const pageCfg = Object.assign({}, DEFAULT_PAGES);
    for (const [k, v] of Object.entries(rawCfg)) if (v && typeof v === 'object') pageCfg[String(k).replace(/^cafe24:/i, 'mall:')] = v;
    const syncMap = ((o.syncMap || (await loadCfg(pool, o.cfg, 'cafe24_sync_map')) || {}).map) || {};   // { 네이버번호: { c24, minAdd } }
    const c24ToNaver = {}; for (const [nno, v] of Object.entries(syncMap)) if (v && v.c24) c24ToNaver[Number(v.c24)] = String(nno);
    let mall = o.c24Products || null, mallState = mall ? 'given' : 'none';
    if (!mall && typeof o.cafe24Get === 'function') {
        try { mall = await fetchMall(o.cafe24Get, new Set(Object.keys(c24ToNaver).map(Number)), o.sleepMs); mallState = 'live'; }
        catch (e) { mall = null; mallState = 'error'; notes.push('자사몰 조회 실패: ' + String((e && (e.reason || e.message || e.code)) || e).slice(0, 100)); }
    }
    if (!mall) notes.push('자사몰은 조회하지 못해 네이버 페이지끼리만 견줬습니다');

    // ── 네이버: 옵션별 가격 이력 → 마지막 변경일 ──
    const hist = new Map();   // "번호|옵션글자" → [{ at, price }]
    for (const s of snaps) for (const it of s.items) for (const op of (it.opts || [])) {
        const k = it.no + '|' + optText(op).join(' / '); const price = won(it.discPrice) + (won(op.price) || 0);
        let a = hist.get(k); if (!a) { a = []; hist.set(k, a); } a.push({ at: s.at, price });
    }
    const changeOf = k => { const a = hist.get(k) || []; let changed = null; for (let i = 1; i < a.length; i++) if (a[i].price !== a[i - 1].price) changed = { at: a[i].at, from: a[i - 1].price }; return { changed_at: changed ? kstDate(changed.at) : null, prev_price: changed ? changed.from : null, since: a.length ? kstDate(a[0].at) : null }; };

    // ── 페이지·줄 만들기 ──
    const pages = [], rows = [];
    const tierOf = (key, name, inherit) => { const c = pageCfg[key] || {}; return TIERS.includes(c.tier) ? c.tier : (inherit || tierByName(name)); };
    const naverTier = {};
    for (const it of last.items) {
        const key = 'naver:' + it.no; const c = pageCfg[key] || {}; const tier = tierOf(key, it.name); naverTier[String(it.no)] = tier;
        const pageSold = it.statusType === 'SALE'; const linked = syncMap[String(it.no)] ? 'mall:' + syncMap[String(it.no)].c24 : null;
        const page = { key, channel: 'naver', id: String(it.no), name: c.name || it.name, tier, options: (it.opts || []).length, sold: pageSold, status: it.statusType, linked, ignore: !!c.ignore, note: c.note || undefined };
        pages.push(page);
        for (const op of (it.opts || [])) {
            const parts = optText(op); const ok = optionKey(parts, pricingNames); const ch = changeOf(it.no + '|' + parts.join(' / '));
            rows.push({ gkey: ok.key, label: ok.label, by: ok.by, page_key: key, channel: 'naver', option_text: parts.join(' / '), price: won(it.discPrice) + (won(op.price) || 0), tier,
                changed_at: ch.changed_at, prev_price: ch.prev_price, unchanged_since: ch.changed_at ? null : ch.since, sold: pageSold && op.usable !== false && Number(op.stock) > 0, ignore: page.ignore });
        }
    }
    for (const p of (mall || [])) {
        const key = 'mall:' + p.cno; const c = pageCfg[key] || {}; const nno = c24ToNaver[p.cno] || null;
        const tier = tierOf(key, p.name, nno ? naverTier[nno] : null); const pageSold = p.selling === 'T' && p.display === 'T';
        const page = { key, channel: 'mall', id: String(p.cno), name: c.name || p.name, tier, options: (p.vars || []).length, sold: pageSold, status: `판매 ${p.selling} · 진열 ${p.display}`, linked: nno ? 'naver:' + nno : null, ignore: !!c.ignore, note: c.note || undefined, error: p.error };
        pages.push(page);
        for (const v of (p.vars || [])) {
            const parts = String(v.name || '').split(/\s*(?:·|\/)\s*/).map(x => x.trim()).filter(Boolean); const ok = optionKey(parts.length ? parts : [v.name], pricingNames);
            rows.push({ gkey: ok.key, label: ok.label, by: ok.by, page_key: key, channel: 'mall', option_text: String(v.name || ''), price: won(p.base) + (won(v.add) || 0), tier,
                changed_at: null, prev_price: null, unchanged_since: null, changed_unknown: true, sold: pageSold && v.selling === 'T' && v.display === 'T', ignore: page.ignore, code: v.code });
        }
    }

    // ── 묶어서 견주기 ──
    const byKey = new Map(); for (const r of rows) { let g = byKey.get(r.gkey); if (!g) { g = { key: r.gkey, label: r.label, rows: [], issues: [] }; byKey.set(r.gkey, g); } g.rows.push(r); }
    const pageByKey = new Map(pages.map(p => [p.key, p])); const pname = k => { const p = pageByKey.get(k); return p ? `${p.channel === 'naver' ? '네이버' : '자사몰'} 「${String(p.name).slice(0, 22)}」` : k; };
    const fmt = n => Number(n).toLocaleString('ko-KR') + '원';
    const groups = []; const byKind = {};
    const add = (g, kind, detail, extra) => { g.issues.push(Object.assign({ kind, detail }, extra || {})); byKind[kind] = (byKind[kind] || 0) + 1; };
    for (const g of byKey.values()) {
        const live = g.rows.filter(r => r.sold && !r.ignore);   // 품절·미노출·제외 페이지는 표에는 두고 셈에서 뺀다
        const cls = t => t === 'vip' ? 'vip' : 'base';
        for (const c of ['base', 'vip']) {
            // 네이버 짝이 같은 묶음에 있는 자사몰 줄은 여기서 빼고 아래 「자사몰 ↔ 네이버」에서만 짚는다(같은 일을 두 번 세지 않게)
            const rs = live.filter(r => cls(r.tier) === c && !(r.channel === 'mall' && (pageByKey.get(r.page_key) || {}).linked && live.some(n => n.page_key === pageByKey.get(r.page_key).linked))); const prices = [...new Set(rs.map(r => r.price))];
            if (prices.length > 1) {
                // 가장 많은 값이 「맞는 값」일 가능성이 높다 — 다른 값을 가진 줄을 짚는다(같은 수면 최근에 바뀐 값을 기준으로)
                const cnt = p => rs.filter(r => r.price === p).length; const recent = p => rs.filter(r => r.price === p && r.changed_at).map(r => r.changed_at).sort().pop() || '';
                const major = prices.slice().sort((a, b) => cnt(b) - cnt(a) || (recent(b) > recent(a) ? 1 : -1))[0];
                const odd = rs.filter(r => r.price !== major);
                add(g, 'tier_mismatch', `${c === 'vip' ? 'VIP 페이지끼리' : '일반 페이지끼리'} 값이 달라요 — ${prices.map(p => `${fmt(p)}(${rs.filter(r => r.price === p).map(r => pname(r.page_key)).join(' · ')})`).join(' ↔ ')}`, { cls: c, prices, odd_pages: odd.map(r => r.page_key), expected: major });
            }
        }
        // 연결된 짝(네이버 ↔ 자사몰)의 같은 옵션
        for (const r of live.filter(x => x.channel === 'naver')) {
            const pg = pageByKey.get(r.page_key); if (!pg || !pg.linked || !mall) continue;
            const mate = g.rows.filter(x => x.page_key === pg.linked); const mateLive = mate.filter(x => x.sold && !x.ignore);
            if (mateLive.length) { for (const m of mateLive) if (m.price !== r.price && cls(m.tier) === cls(r.tier)) add(g, 'mall_vs_naver', `${pname(r.page_key)} ${fmt(r.price)} ↔ ${pname(m.page_key)} ${fmt(m.price)}`, { naver: r.page_key, mall: m.page_key, diff: m.price - r.price }); }
            else { const mp = pageByKey.get(pg.linked); if (mp && mp.sold && !mp.ignore && !mp.error) add(g, 'missing', `${pname(r.page_key)}에서는 파는데 ${pname(pg.linked)}에는 ${mate.length ? '미노출·판매중지' : '없어요'}(참고)`, { naver: r.page_key, mall: pg.linked }); }
        }
        // VIP 가 일반보다 비쌈
        const base = live.filter(r => r.tier !== 'vip'), vip = live.filter(r => r.tier === 'vip');
        if (base.length && vip.length) {
            const bmin = Math.min(...base.map(r => r.price));
            for (const v of vip) if (v.price > bmin) add(g, 'vip_not_lower', `${pname(v.page_key)} ${fmt(v.price)} 이 일반 ${fmt(bmin)} 보다 비싸요`, { vip: v.page_key, vip_price: v.price, base_price: bmin });
        }
        // 참고: VIP 값이 일반과 같음(더 싸지 않음) — 일부러 맞춘 것일 수 있어 문제로 세지 않는다
        if (base.length && vip.length) { const bmin = Math.min(...base.map(r => r.price)); for (const v of vip) if (v.price === bmin) add(g, 'vip_same', `${pname(v.page_key)} 와 일반 페이지 값이 같아요(${fmt(bmin)}) — VIP 가 더 싸야 하면 확인(참고)`, { vip: v.page_key, price: bmin }); }
        // 최근 7일 안에 다른 줄은 바뀌었는데 이 줄만 그대로(네이버 줄만 — 자사몰은 변경일을 모른다)
        const cut = kstDate(now - STALE_DAYS * 86400e3); const moved = live.filter(r => r.changed_at && r.changed_at >= cut);
        if (moved.length) for (const r of live.filter(x => x.channel === 'naver' && !(x.changed_at && x.changed_at >= cut))) {
            const peers = moved.filter(m => m.page_key !== r.page_key); if (!peers.length) continue;
            if (peers.every(m => m.price === r.price)) continue;   // 바뀐 쪽과 지금 값이 같으면 「안 바뀐 것」이 문제는 아니다(VIP 와 같아진 경우는 아래 vip_same 참고로)
            add(g, 'stale', `${peers.map(m => `${pname(m.page_key)}(${m.changed_at} · ${m.prev_price != null ? fmt(m.prev_price) + ' → ' : ''}${fmt(m.price)})`).join(' · ')} 은 최근 ${STALE_DAYS}일 안에 바뀌었는데 ${pname(r.page_key)} ${fmt(r.price)} 은 ${r.changed_at || (r.unchanged_since ? r.unchanged_since + ' 이전부터' : '오래')} 그대로예요`, { page: r.page_key, peers: peers.map(m => m.page_key) });
        }
        { const off = g.rows.filter(r => !r.sold && !r.ignore); const ps = [...new Set(off.filter(r => cls(r.tier) === 'base').map(r => r.price))]; if (!live.length && ps.length > 1) g.offseason_mismatch = ps; }
        g.sold_rows = live.length; g.by = g.rows.some(r => r.by === 'match') ? 'match' : 'text';
        g.rows = g.rows.map(r => ({ page_key: r.page_key, channel: r.channel, option_text: r.option_text, price: r.price, tier: r.tier, changed_at: r.changed_at, prev_price: r.prev_price, unchanged_since: r.unchanged_since, changed_unknown: r.changed_unknown || undefined, sold: r.sold, ignore: r.ignore || undefined }));
        groups.push(g);
    }
    // 문제 있는 묶음 먼저 · 그다음 여러 페이지에 걸린 묶음 · 이름순
    groups.sort((a, b) => (b.issues.filter(i => !NOTE_KINDS.includes(i.kind)).length - a.issues.filter(i => !NOTE_KINDS.includes(i.kind)).length) || (b.issues.length - a.issues.length) || (b.sold_rows - a.sold_rows) || a.label.localeCompare(b.label, 'ko'));
    return {
        ok: true, generated_at: new Date(now).toISOString(),
        source: { naver_snapshot_id: last.id, naver_snapshot_at: new Date(last.at).toISOString(), snapshots: snaps.length, history_from: kstDate(snaps[0].at), mall: mallState, mall_products: mall ? mall.length : 0, coupang: 'excluded' },
        pages, groups,
        ...(mallState === 'live' ? { mall_raw: mall.map(p => ({ cno: p.cno, name: p.name, base: p.base, selling: p.selling, display: p.display, vars: p.vars ? p.vars.map(v => ({ code: v.code, name: v.name, add: v.add, selling: v.selling, display: v.display })) : null })) } : {}),   // 서버가 price_check_last.mall 로 적어 두면 창구 도구가 읽는다(지금 조회한 때만)
        summary: { pages: pages.length, pages_naver: pages.filter(p => p.channel === 'naver').length, pages_mall: pages.filter(p => p.channel === 'mall').length, pages_sold: pages.filter(p => p.sold).length,
            groups: groups.length, groups_multi: groups.filter(g => g.sold_rows > 1).length, groups_with_issue: groups.filter(g => g.issues.some(i => !NOTE_KINDS.includes(i.kind))).length, issues_by_kind: byKind,
            offseason_mismatch: groups.filter(g => g.offseason_mismatch).length, vip_pages: pages.filter(p => p.tier === 'vip').map(p => p.key), text_keyed_groups: groups.filter(g => g.by === 'text').length },
        notes,
    };
}

// 글 표(창구·텔레그램용) — 문제 묶음과 여러 페이지에 걸린 묶음만 적는다
function toText(rep, optx) {
    const x = optx || {}; if (!rep || !rep.ok) return '가격 확인을 하지 못했어요: ' + ((rep && rep.error) || '알 수 없음');
    const s = rep.summary; const fmt = n => Number(n).toLocaleString('ko-KR'); const pk = new Map(rep.pages.map(p => [p.key, p]));
    const nm = k => { const p = pk.get(k); return p ? `${p.channel === 'naver' ? '네이버' : '자사몰'} ${String(p.name).slice(0, 18)}${p.tier !== 'normal' ? `[${p.tier === 'vip' ? 'VIP' : p.tier === 'gift' ? '선물' : '대용량'}]` : ''}` : k; };
    const L = [];
    L.push(`━━━ 전체 가격 확인 (${new Date(new Date(rep.generated_at).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}) ━━━`);
    L.push(`페이지 ${s.pages}곳(네이버 ${s.pages_naver} · 자사몰 ${s.pages_mall} · 파는 중 ${s.pages_sold}) · 옵션 묶음 ${s.groups}개(여러 페이지에 걸린 것 ${s.groups_multi})`);
    const k = s.issues_by_kind || {}; const KO = { tier_mismatch: '페이지끼리 값 다름', mall_vs_naver: '자사몰 ↔ 네이버 다름', vip_not_lower: 'VIP 가 더 비쌈', stale: '한쪽만 안 바뀜', missing: '자사몰에 없음(참고)', vip_same: 'VIP 와 일반 값 같음(참고)' };
    const bad = Object.keys(KO).filter(n => k[n] && !NOTE_KINDS.includes(n)).map(n => `${KO[n]} ${k[n]}`); const ref = NOTE_KINDS.filter(n => k[n]).map(n => `${KO[n]} ${k[n]}`);
    L.push(bad.length ? '👉 ' + bad.join(' · ') : '👉 어긋난 곳 없음'); if (ref.length) L.push('   참고: ' + ref.join(' · '));
    for (const g of rep.groups.filter(g => g.issues.length)) {
        L.push(''); L.push(`■ ${g.label}`);
        for (const r of g.rows) L.push(`   ${r.sold ? ' ' : '×'} ${fmt(r.price)}원 · ${nm(r.page_key)}${r.changed_at ? ` · ${r.changed_at} 바뀜` : r.changed_unknown ? '' : r.unchanged_since ? ` · ${r.unchanged_since} 이전부터` : ''}`);
        for (const i of g.issues) L.push(`   → [${KO[i.kind] || i.kind}] ${i.detail}`);
    }
    if (x.all) { L.push(''); L.push('━━━ 여러 페이지에 걸린 옵션(값 같음) ━━━'); for (const g of rep.groups.filter(g => !g.issues.length && g.sold_rows > 1)) L.push(`  ${g.label} — ${fmt(g.rows.find(r => r.sold).price)}원 · ${g.rows.filter(r => r.sold).map(r => nm(r.page_key)).join(' / ')}`); }
    const offs = rep.groups.filter(g => g.offseason_mismatch);
    if (offs.length) { L.push(''); L.push(`━━━ 지금은 안 파는 옵션인데 페이지끼리 값이 다른 것 ${offs.length}개(다시 팔기 전에 확인) ━━━`); for (const g of offs) L.push(`  ${g.label} — ${g.rows.map(r => `${fmt(r.price)}원(${nm(r.page_key)})`).join(' / ')}`); }
    L.push(''); L.push(`자료: 네이버 스냅샷 ${rep.source.naver_snapshot_at.slice(0, 10)} 새벽(그 뒤에 바꾼 값은 내일 반영) · 변경일은 ${rep.source.history_from} 이후만 · 자사몰 ${rep.source.mall === 'live' ? '지금 조회' : rep.source.mall === 'given' ? '받은 자료' : '조회 못 함'} · 쿠팡 제외`);
    for (const n of (rep.notes || []).slice(1)) L.push('※ ' + n);
    return L.join('\n');
}

module.exports = { build, toText, optionKey, tierByName, fetchMall, DEFAULT_PAGES, TIERS, STALE_DAYS, NOTE_KINDS };
