// #588-d(대표 GO 10/8) 창구용 — 자사몰(카페24) 옵션 결제가를 네이버 결제가에 맞추기
//   node scripts/desk/mall-price.js preview                       오늘 새벽 자동 점검(05:10) 결과만 빨리 보기 — 어긋난 옵션·없는 옵션
//   node scripts/desk/mall-price.js preview <상품> [--snapshot]    그 상품의 계획 표(쓰기 0) — 네이버 실시간 정본 ↔ 카페24 지금 값
//   node scripts/desk/mall-price.js apply <상품> <지시 id>         계획대로 카페24 추가금(필요하면 기본가)을 바꿈 → 90초 뒤 다시 읽어 확인
//   node scripts/desk/mall-price.js restore <상품> <지시 id>       이 도구로 바꾸기 직전 값으로 되돌림
//   node scripts/desk/mall-price.js checkout <상품> [옵션 글자]     실제 결제창(비회원 · 주문은 안 함)의 최종 금액 = 네이버 결제가인지
//   node scripts/desk/mall-price.js hide <상품> "<옵션 글자>"… [지시 id]   네이버에서 내린 옵션을 카페24에서도 미노출(판매 F · 진열 F)로 — 지시 id 를 빼면 계획만(쓰기 0)
//   node scripts/desk/mall-price.js show <상품> "<옵션 글자>"… [지시 id]   미노출 옵션을 다시 노출(되돌리기용)
//   <상품> = 네이버 상품번호 · c92 같은 카페24 번호 · 상품/옵션 이름의 낱말 하나(하나로 좁혀질 때만)
//   규칙: 카페24 결제가 = 기본가 + 옵션 추가금. 기본가 = 네이버 결제가 + 가장 싼 옵션 증감(새벽 자동 동기화와 같은 식 — 다르면 다음 날 되돌아감).
//         옵션은 이름이 글자까지 같은 것끼리만 맞춘다(앞 번호 「1. 」만 무시). 이름이 다르면 바꾸지 않고 멈춘다 — 카페24 옵션 추가·이름 변경은 관리자 화면에서 사람만 할 수 있다.
//         한 번에 50% 넘게 바뀌는 값은 막는다(총괄 확인). 미노출(F) 옵션은 건드리지 않는다.
const M = require('./_mall');
const nrm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const noNum = s => nrm(s).replace(/^\d+\.\s*/, '');
const nText = o => (o.n1 && o.n2) ? `${o.n1} · ${o.n2}` : (o.n2 || o.n1 || '');
const won = n => Number(n).toLocaleString('ko-KR');
// server.js cafe24OptKey 와 같은 생각 — 이름이 달라도 「같은 옵션일 것 같은」 후보를 알려 주는 데만 쓴다(자동 적용 안 함)
function optKey(s) {
    const t = String(s || '').replace(/\s+/g, '');
    const fruit = (t.match(/하우스감귤|황금향|한라봉|천혜향|레드향|청귤|풋귤|미니밤호박|밤호박|카라향|수라향|세미놀|자몽|레몬|블러드오렌지|하귤|취나물|옥수수|키위|노지감귤/) || [])[0] || '';
    const use = (t.match(/가정용|선물용|못난이|특품|프리미엄|한입/) || [])[0] || '';
    const weight = (t.match(/\d+\.?\d*kg/) || [])[0] || (t.match(/\d+\+\d+개/) || [])[0] || '';
    const grade = (t.match(/로얄과|중소과|중대과|소과|대과|랜덤과/) || [])[0] || '';
    return (fruit || use || weight) ? [fruit, use, weight, grade].join('|') : '';
}
async function resolve(arg, snap) {
    const map = ((await M.cfgGet('cafe24_sync_map')) || {}).map || {}; const s = String(arg || '').trim();
    if (!s) throw new Error('상품을 알려 주세요(네이버 상품번호 · c92 · 낱말)');
    let nno = null;
    if (/^\d{9,}$/.test(s)) nno = s;
    else if (/^c\d+$/i.test(s)) nno = (Object.entries(map).find(([, m]) => String(m.c24) === s.slice(1)) || [])[0];
    else { const hit = snap.items.filter(it => map[String(it.no)] && (String(it.name).includes(s) || (it.opts || []).some(o => (o.usable !== false) && nText(o).includes(s)))); if (hit.length !== 1) throw new Error(hit.length ? `「${s}」가 든 상품이 ${hit.length}개예요 — 번호로 골라 주세요: ` + hit.map(h => `${h.no}(${String(h.name).slice(0, 14)})`).join(' · ') : `「${s}」가 든 판매 상품을 못 찾았어요`); nno = String(hit[0].no); }
    if (!nno || !map[nno]) throw new Error('자사몰과 연결된 상품이 아니에요(동기화 매핑에 없음): ' + s);
    return { nno, cno: map[nno].c24, minAdd: Number(map[nno].minAdd) || 0, map };
}
// 계획 = 카페24를 어떻게 바꾸면 네이버 결제가와 같아지는가
async function plan(arg, useSnap) {
    const snap = await M.latestSnapshot(); const R = await resolve(arg, snap);
    let nv, source;
    if (!useSnap) { try { nv = (await M.naverLive([R.nno]))[R.nno]; source = '네이버 실시간'; } catch (e) { source = null; var liveErr = e.message; } }
    if (!nv) { const it = snap.items.find(x => String(x.no) === R.nno); if (!it) throw new Error('스냅샷에도 그 상품이 없어요'); nv = { no: R.nno, name: it.name, statusType: it.statusType, discPrice: it.discPrice != null ? Number(it.discPrice) : Number(it.salePrice), optsNone: !!it.optsNone || !(it.opts || []).length, opts: (it.opts || []).map(o => ({ n1: o.n1 || '', n2: o.n2 || '', price: Number(o.price) || 0, usable: o.usable !== false })) }; source = `스냅샷 #${snap.id}(${snap.kst} · ${snap.ageMin}분 전)`; }
    const c = await M.c24Product(R.cno);
    const ignore = new Set((((await M.cfgGet('cafe24_sync_ignore_opts')) || {}).keys) || []);
    const P = { nno: R.nno, cno: R.cno, name: String(nv.name).slice(0, 30), source, live_error: liveErr || undefined, naver_base: nv.discPrice, c24_base: c.base, c24_selling: c.selling, map_minAdd: R.minAdd, rows: [], stops: [], notes: [], puts: [] };
    const usable = nv.opts.filter(o => o.usable);
    if (nv.optsNone) { P.stops.push('옵션 없는 단일 상품이에요 — 기본가는 새벽 자동 동기화가 맞춥니다(이 도구 대상 아님)'); return { P, c, nv }; }
    if (!usable.length) { P.stops.push('네이버에 판매 중인 옵션이 없어요'); return { P, c, nv }; }
    const liveMin = Math.min(...usable.map(o => o.price)), targetBase = nv.discPrice + liveMin;
    P.target_base = targetBase; P.target_minAdd = liveMin;
    P.extra_live = [];   // 네이버에 없는데 카페24에서 팔리는 옵션 = 미노출(hide) 후보(구성 차이로 일부러 둔 것일 수 있다 — 사람이 정함)
    const live = c.vars.filter(v => v.selling === 'T' && v.display === 'T'), hidden =c.vars.filter(v => !(v.selling === 'T' && v.display === 'T'));
    const used = new Set();
    const find = (o) => { const t = nrm(nText(o)); let h = c.vars.filter(v => nrm(v.name) === t); if (!h.length) h = c.vars.filter(v => noNum(v.name) === noNum(t)); return h; };
    for (const o of usable) {
        const txt = nText(o), pay = nv.discPrice + o.price, h = find(o);
        if (h.length > 1) { P.stops.push(`「${txt}」와 이름이 같은 카페24 옵션이 ${h.length}개예요 — 어느 것인지 정할 수 없어 멈춥니다`); continue; }
        if (!h.length) {
            const k = optKey(txt), cand = k ? c.vars.filter(v => optKey(v.name) === k) : [];
            if (k && ignore.has(k)) { P.notes.push(`네이버에만 두기로 한 옵션(그대로 둠): ${txt}`); continue; }
            P.rows.push({ opt: txt, naver: pay, c24: null, state: '카페24에 없음', hint: cand.length ? '비슷한 카페24 옵션: ' + cand.map(v => `「${v.name}」(${v.selling}/${v.display})`).join(' · ') : undefined });
            P.stops.push(`카페24에 「${txt}」 옵션이 없어요 — 관리자 화면에서 옵션을 추가(또는 이름을 네이버와 글자까지 같게)한 뒤 다시 해 주세요`); continue;
        }
        const v = h[0]; used.add(v.code);
        if (!(v.selling === 'T' && v.display === 'T')) { P.rows.push({ opt: txt, naver: pay, c24: c.base + v.add, state: '카페24 미노출', code: v.code }); P.stops.push(`「${txt}」는 카페24에서 미노출 상태예요 — 다시 팔 것인지 총괄에게 확인해 주세요(이 도구는 노출을 바꾸지 않아요)`); continue; }
        const cur = c.base + v.add, add = pay - targetBase;
        const row = { opt: txt, code: v.code, naver: pay, c24: cur, diff: cur - pay, add_now: v.add, add_new: add, state: cur === pay && v.add === add ? '같음' : '바꿈' };
        if (cur !== pay && Math.abs(pay - cur) > cur * 0.5) { row.state = '막음(50% 넘는 변화)'; P.stops.push(`「${txt}」 ${won(cur)} → ${won(pay)}원은 한 번에 50% 넘는 변화예요 — 총괄 확인이 필요해요`); }
        else if (row.state === '바꿈') P.puts.push({ code: v.code, name: v.name, body: { additional_amount: String(add) }, before: v.add, pay_before: cur, pay_after: pay });
        P.rows.push(row);
    }
    // 네이버에 없는 카페24 판매 옵션 — 결제가를 그대로 지킨다(기본가가 바뀌면 추가금만 따라 옮김)
    for (const v of live) {
        if (used.has(v.code)) continue; const cur = c.base + v.add, add = cur - targetBase;
        const nvOff = nv.opts.find(o => !o.usable && noNum(nText(o)) === noNum(v.name));
        P.rows.push({ opt: v.name, code: v.code, naver: null, c24: cur, add_now: v.add, add_new: add, state: nvOff ? '네이버는 판매 안 함 · 카페24는 판매 중(그대로 둠)' : '카페24에만 있음(결제가 그대로 둠)' });
        P.extra_live.push({ code: v.code, opt: v.name, pay: cur, add: v.add, naver: nvOff ? '네이버 판매 안 함(목록에는 있음)' : '네이버에 없음' });
        if (add < 0) P.stops.push(`「${v.name}」는 새 기본가보다 싸서 추가금이 음수가 돼요 — 네이버에서 내린 옵션이면 먼저 미노출(hide)로 바꾼 뒤 다시 맞추세요. 계속 팔 옵션이면 총괄 확인이 필요해요`);
        else if (add !== v.add) P.puts.push({ code: v.code, name: v.name, body: { additional_amount: String(add) }, before: v.add, pay_before: cur, pay_after: cur });
    }
    if (hidden.length) P.notes.push(`미노출 옵션 ${hidden.length}개는 건드리지 않아요`);
    if (targetBase !== c.base) { P.base_change = { from: c.base, to: targetBase }; if (Math.abs(targetBase - c.base) > c.base * 0.5) P.stops.push(`기본가 ${won(c.base)} → ${won(targetBase)}원은 50% 넘는 변화예요 — 총괄 확인이 필요해요`); P.notes.push('기본가가 바뀌어요 — 바꾸는 몇 분 동안 일부 옵션 결제가가 잠깐 어긋날 수 있어요(주문이 뜸한 때 권장)'); }
    if (liveMin !== R.minAdd) P.minAdd_change = { from: R.minAdd, to: liveMin };
    if (nv.statusType && nv.statusType !== 'SALE') P.notes.push(`네이버 상품 상태 = ${nv.statusType}(판매 중 아님)`);
    P.change_count = P.puts.length + (P.base_change ? 1 : 0); P.can_apply = !P.stops.length && (P.change_count > 0 || !!P.minAdd_change);
    return { P, c, nv, R };
}
const table = P => P.rows.map(r => `${r.state.padEnd(4)} | 네이버 ${r.naver == null ? '—' : won(r.naver)} | 자사몰 ${r.c24 == null ? '—' : won(r.c24)}${r.diff ? `(${r.diff > 0 ? '+' : ''}${won(r.diff)})` : ''}${r.add_new != null && r.add_new !== r.add_now ? ` | 추가금 ${won(r.add_now)}→${won(r.add_new)}` : ''} | ${r.opt}`);
// 사람에게 보여 줄 「바뀌는 것」 — 결제가가 달라지는 옵션만 · 기본가 때문에 추가금만 옮기는 옵션은 건수로
const changes = P => P.puts.filter(t => t.pay_before !== t.pay_after).map(t => `${t.name.slice(-30)}: ${won(t.pay_before)} → ${won(t.pay_after)}원`).concat(P.puts.some(t => t.pay_before === t.pay_after) ? [`결제가는 그대로 · 추가금만 옮기는 옵션 ${P.puts.filter(t => t.pay_before === t.pay_after).length}개`] : []);
async function putAll(cno, base, puts, orderId) {
    const res = [];
    if (base != null) { const r = await M.c24({ action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${cno}`, body: { shop_no: 1, request: { price: String(base), supply_price: String(base) } } }); res.push({ what: '기본가 ' + base, ok: M.c24Ok(r), err: M.c24Ok(r) ? undefined : JSON.stringify(r).slice(0, 160) }); }
    let i = 0;
    for (const t of puts) { if (i++ % 4 === 0) await M.stepLog(orderId, `자사몰 가격: 옵션 ${i}/${puts.length} 바꾸는 중`); const r = await M.c24({ action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${cno}/variants/${t.code}`, body: { shop_no: 1, request: t.body } }); res.push({ what: t.code + ' ' + String(t.name).slice(-24), ok: M.c24Ok(r), err: M.c24Ok(r) ? undefined : JSON.stringify(r).slice(0, 160) }); }
    return res;
}
async function setMinAdd(nno, v) { const cfg = await M.cfgGet('cafe24_sync_map'); if (!cfg || !cfg.map || !cfg.map[nno]) throw new Error('동기화 매핑을 못 읽었어요'); cfg.map[nno].minAdd = v; await M.cfgSet('cafe24_sync_map', cfg); }
// 결제창 확인 — verify-428-checkout.js 와 같은 길(비회원 구매 · 주문 완료 안 함 · 매번 장바구니 비움)
async function checkout(nno, cases) {
    const { chromium } = M.NM('playwright'); const V = 'dk' + (Date.now() % 99991);
    const br = await chromium.launch(); const out = [];
    try {
        const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
        const pg = await ctx.newPage(); pg.on('dialog', d => d.accept());
        const clear = async () => {
            await pg.waitForTimeout(1500); await pg.goto('https://akkome.com/order/basket.html?v=' + V + Math.random(), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { }); await pg.waitForTimeout(2500);
            for (let k = 0; k < 4; k++) { const left = await pg.evaluate(() => document.querySelectorAll('.xans-order-list tbody tr, .xans-order-list .ec-base-prdInfo').length); if (!left) break; await pg.evaluate(() => { const chk = document.querySelector('input.allCheck, input[type="checkbox"]'); if (chk && !chk.checked) chk.click(); const a = [...document.querySelectorAll('a, button')].find(x => x.offsetParent && /전체삭제|선택삭제|삭제하기|비우기/.test((x.textContent || '').trim())); if (a) a.click(); }); await pg.waitForTimeout(2000); }
        };
        await clear();
        for (const cse of cases) {
            const row0 = { opt: cse.opt, want: cse.pay };
            try {
                await pg.goto(`https://akkome.com/?v=${V}${nno}#p/${nno}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await pg.waitForFunction(() => document.querySelector('.pd-dim.show'), null, { timeout: 30000 }); await pg.waitForTimeout(1500);
                await pg.locator('#pdOrder').tap(); await pg.waitForTimeout(1400);
                const idx = await pg.evaluate(t => { const n = s => String(s || '').normalize('NFC').replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim(); return [...document.querySelectorAll('.pd-dim .opt-row[data-opt-sel]')].findIndex(el => n(el.getAttribute('data-opt-text')) === n(t)); }, cse.opt);
                if (idx < 0) { out.push({ ...row0, ok: false, why: '자사몰 화면에 그 옵션 줄이 없어요(스냅샷이 아직 옛 값일 수 있음)' }); await clear(); continue; }
                const row = pg.locator('.pd-dim .opt-row[data-opt-sel]').nth(idx); const shown = await row.evaluate(el => parseInt(el.getAttribute('data-opt-price'), 10));
                await row.tap(); await pg.waitForTimeout(700); await pg.locator('#pdOrder').tap(); await pg.waitForTimeout(5000);
                const layer = await pg.evaluate(() => { const l = document.querySelector('#akmOptList'); return !!(l && l.offsetParent); });
                if (layer) { out.push({ ...row0, shown, ok: false, why: '옵션 확인창이 떴어요 — 자사몰 옵션 이름이 화면 글자와 달라 바로 담기지 않음' }); await clear(); continue; }
                await pg.waitForURL(/basket\.html/, { timeout: 30000 }).catch(() => { });
                if (!/basket/.test(pg.url())) await pg.goto('https://akkome.com/order/basket.html?v=' + V, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await pg.waitForTimeout(2500);
                await pg.evaluate(() => { const a = [...document.querySelectorAll('a, button')].find(x => x.offsetParent && /전체.?상품.?주문|전체.?주문|주문하기/.test((x.textContent || '').trim())); if (a) a.click(); });
                await pg.waitForTimeout(5000);
                if (/login/.test(pg.url())) { await pg.evaluate(() => { const a = [...document.querySelectorAll('a, button, input[type=button], input[type=submit]')].find(x => x.offsetParent && /비회원.?구매/.test((x.textContent || x.value || '').trim())); if (a) a.click(); }); await pg.waitForTimeout(6000); }
                const body = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')); const fin = (body.match(/최종 결제 금액\s*([\d,]+)원/) || [])[1]; const finN = fin ? Number(fin.replace(/,/g, '')) : null;
                out.push({ ...row0, shown, final: finN, ok: /orderform/.test(pg.url()) && finN === cse.pay, why: /orderform/.test(pg.url()) ? (finN === cse.pay ? undefined : '결제창 금액이 달라요') : '주문서까지 못 갔어요' });
            } catch (e) { out.push({ ...row0, ok: false, why: '확인 중 오류: ' + e.message.slice(0, 80) }); }
            await clear();
        }
    } finally { await br.close(); }
    return out;
}
(async () => {
    const args = process.argv.slice(2), cmd = args.shift();
    const fi = args.indexOf('--snapshot'); const useSnap = fi >= 0; if (useSnap) args.splice(fi, 1);
    if (cmd === 'preview' && !args[0]) {
        const last = (await M.cfgGet('cafe24_sync_last')) || {};
        console.log(JSON.stringify({ checked_at: last.at, mode: last.mode, checked: last.checked, price_mismatch: last.optMismatch || [], option_missing: last.optMissing || [], base_diffs: (last.diffs || []).concat(last.blocked || []), errors: last.errors || [], note: '새벽 자동 점검 결과예요(그 뒤 네이버에서 바꾼 것은 안 보여요) — 상품을 주면 지금 값으로 다시 봅니다: mall-price.js preview <상품>' }, null, 1));
    } else if (cmd === 'preview') {
        const { P } = await plan(args[0], useSnap);
        console.log(JSON.stringify({ ...P, puts: undefined, rows: undefined, table: table(P), will_change: changes(P), note: '미리 보기 — 아직 아무것도 바꾸지 않았어요' }, null, 1));
    } else if (cmd === 'apply') {
        const orderId = parseInt(args[1], 10); if (!orderId) throw new Error('사용: mall-price.js apply <상품> <지시 id>');
        const actor = await M.who(orderId); await M.stepLog(orderId, '자사몰 가격: 네이버·카페24 지금 값 읽는 중');
        const { P, c } = await plan(args[0], useSnap);
        if (P.stops.length) { console.log(JSON.stringify({ ok: false, stopped: true, stops: P.stops, table: table(P), note: '멈췄어요 — 바꾼 것 없음' }, null, 1)); await M.pool.end(); return; }
        if (!P.can_apply) { console.log(JSON.stringify({ ok: true, changed: false, table: table(P), note: '이미 네이버와 같아요 — 바꾼 것 없음' }, null, 1)); await M.pool.end(); return; }
        const prev = (await M.cfgGet('mall_price_prev')) || {}; const list = Array.isArray(prev[P.nno]) ? prev[P.nno] : [];
        const before = { at: new Date().toISOString(), order_id: orderId, by: actor, cno: P.cno, base: c.base, minAdd: P.map_minAdd, vars: c.vars.filter(v => P.puts.some(t => t.code === v.code)).map(v => ({ code: v.code, name: v.name, add: v.add })) };
        list.push(before); prev[P.nno] = list.slice(-5); await M.cfgSet('mall_price_prev', prev);
        const res = await putAll(P.cno, P.base_change ? P.base_change.to : null, P.puts, orderId);
        if (P.minAdd_change && res.every(r => r.ok)) await setMinAdd(P.nno, P.minAdd_change.to);
        await M.audit('cafe24_variant_update', 'cafe24_product', P.cno, { tool: 'mall-price', order_id: orderId, naver_no: P.nno, source: P.source, before, after: { base: P.target_base, minAdd: P.target_minAdd, puts: P.puts }, results: res }, actor);
        await M.stepLog(orderId, '자사몰 가격: 카페24가 새 값을 보여 줄 때까지 90초 대기'); await M.sleep(90000);
        const aft = await M.c24Product(P.cno); const bad = [];
        if (aft.base !== P.target_base) bad.push(`기본가 ${aft.base} ≠ ${P.target_base}`);
        for (const t of P.puts) { const v = aft.vars.find(x => x.code === t.code); if (!v || aft.base + v.add !== t.pay_after) bad.push(`${t.name.slice(-24)} ${v ? aft.base + v.add : '없음'} ≠ ${t.pay_after}`); }
        console.log(JSON.stringify({ ok: !bad.length && res.every(r => r.ok), changed: true, nno: P.nno, cno: P.cno, source: P.source, base: P.base_change || '그대로', changed_opts: changes(P), put_fail: res.filter(r => !r.ok), recheck_bad: bad, undo: `node scripts/desk/mall-price.js restore ${P.nno} <지시 id>`, next: `node scripts/desk/mall-price.js checkout ${P.nno}`, note: bad.length ? '다시 읽은 값이 아직 달라요 — 카페24 조회는 몇 분 늦을 수 있어요. 3분 뒤 preview 로 다시 확인하고, 그래도 다르면 총괄에게 알려 주세요' : '카페24 값이 계획대로 바뀌었어요 — checkout 으로 결제창까지 확인하세요(자사몰 화면 가격은 네이버 스냅샷을 따라 저절로 바뀝니다)' }, null, 1));
    } else if (cmd === 'restore') {
        const orderId = parseInt(args[1], 10); if (!orderId) throw new Error('사용: mall-price.js restore <상품> <지시 id>');
        const actor = await M.who(orderId); const snap = await M.latestSnapshot(); const R = await resolve(args[0], snap);
        const prev = (await M.cfgGet('mall_price_prev')) || {}, list = prev[R.nno] || [], last = list[list.length - 1]; if (!last) throw new Error('되돌릴 기록이 없어요(이 도구로 바꾼 적이 없는 상품)');
        const c = await M.c24Product(R.cno);
        const puts = last.vars.filter(v => { const x = c.vars.find(y => y.code === v.code); return x && x.add !== v.add; }).map(v => ({ code: v.code, name: v.name, body: { additional_amount: String(v.add) } }));
        const res = await putAll(R.cno, c.base !== last.base ? last.base : null, puts, orderId);
        if (res.every(r => r.ok) && R.minAdd !== last.minAdd) await setMinAdd(R.nno, last.minAdd);
        if (res.every(r => r.ok)) { prev[R.nno] = list.slice(0, -1); await M.cfgSet('mall_price_prev', prev); }
        await M.audit('cafe24_variant_update', 'cafe24_product', R.cno, { tool: 'mall-price', mode: 'restore', order_id: orderId, naver_no: R.nno, restored_to: last, results: res }, actor);
        console.log(JSON.stringify({ ok: res.every(r => r.ok), restored_to: { at: last.at, order_id: last.order_id, base: last.base, opts: last.vars.length }, put: res, note: '되돌렸어요 — 카페24 조회는 몇 분 늦게 바뀝니다. 네이버 가격이 그대로면 화면과 결제가가 다시 어긋나니 preview 로 확인하세요' }, null, 1));
    } else if (cmd === 'checkout') {
        const { P } = await plan(args[0], useSnap); const frag = args.slice(1).join(' ').trim();
        let rows = P.rows.filter(r => r.naver != null && r.code); if (frag) rows = rows.filter(r => r.opt.includes(frag));
        if (!rows.length) throw new Error('확인할 옵션이 없어요');
        const picked = rows.slice(0, 6); const res = await checkout(P.nno, picked.map(r => ({ opt: r.opt, pay: r.naver })));
        console.log(JSON.stringify({ nno: P.nno, source: P.source, checked: res.length, skipped: rows.length - picked.length, all_ok: res.every(r => r.ok), results: res, note: '결제창(비회원 주문서)의 최종 결제 금액을 읽었어요 — 주문은 하지 않았고 장바구니는 비웠어요' + (rows.length > picked.length ? ' · 한 번에 6개까지라 나머지는 옵션 글자를 붙여 다시 실행' : '') }, null, 1));
    } else if (cmd === 'hide' || cmd === 'show') {
        // #588-f(대표 GO 10/8): 네이버에서 내린 옵션을 카페24에서도 미노출(selling F · display F)로 — show 는 그 반대(되돌리기). 지시 id 를 빼면 계획만 보여 준다(쓰기 0).
        const dry = !/^\d{1,9}$/.test(String(args[args.length - 1] || '')), orderId = dry ? null : parseInt(args[args.length - 1], 10), frags = (dry ? args.slice(1) : args.slice(1, -1)).map(nrm).filter(Boolean);
        if (!args[0] || !frags.length) throw new Error(`사용: mall-price.js ${cmd} <상품> "<옵션 글자>"… [지시 id]  (지시 id 를 빼면 계획만)`);
        const actor = dry ? null : await M.who(orderId);
        const { P, c, nv } = await plan(args[0], useSnap); const stops = [], picks = [];
        const naverHas = v => nv.opts.some(o => o.usable && noNum(nText(o)) === noNum(v.name));
        for (const f of frags) {
            const h = c.vars.filter(v => nrm(v.name).includes(f));
            if (!h.length) { stops.push(`카페24에 「${f}」가 든 옵션이 없어요`); continue; }
            if (h.length > 1) { stops.push(`「${f}」가 든 카페24 옵션이 ${h.length}개예요 — 더 길게 적어 하나로 좁혀 주세요: ` + h.map(v => `「${v.name}」`).join(' · ')); continue; }
            const v = h[0], on = v.selling === 'T' && v.display === 'T';
            if (picks.some(p => p.code === v.code)) continue;
            if (cmd === 'hide') {
                if (naverHas(v)) { stops.push(`「${v.name}」는 네이버에서 아직 파는 옵션이에요 — 네이버에서 먼저 내린 뒤 다시 말씀해 주세요`); continue; }
                if (v.selling === 'F' && v.display === 'F') { stops.push(`「${v.name}」는 이미 미노출이에요`); continue; }
            } else if (on) { stops.push(`「${v.name}」는 이미 판매 중이에요`); continue; }
            picks.push(v);
        }
        const liveNow = c.vars.filter(v => v.selling === 'T' && v.display === 'T');
        if (cmd === 'hide' && picks.length && liveNow.filter(v => !picks.some(p => p.code === v.code)).length < 1) stops.push('그 상품의 마지막 판매 옵션이라 미노출로 바꾸지 않아요 — 상품 자체를 내리는 것은 총괄 창에서');
        // 가격 쪽에 미치는 것: 기본가·minAdd 는 「네이버 판매 옵션」으로만 정해지므로 네이버에 없는 옵션을 내려도 달라지지 않는다. 다만 네이버가 가장 싼 옵션을 내려 기본가가 올라야 하는 상태면 hide 뒤 apply 가 이어져야 한다.
        const after = cmd === 'hide' ? { stops: P.stops.filter(s => !picks.some(p => s.includes(`「${p.name}」`))), base_change: P.base_change || null, minAdd_change: P.minAdd_change || null, price_changes: P.puts.filter(t => !picks.some(p => p.code === t.code)).length } : null;
        const priceNext = !!after && (!!after.base_change || !!after.minAdd_change || after.price_changes > 0);
        const notes = [];
        if (cmd === 'hide') { notes.push('미노출로 바꾸면 그 옵션을 장바구니에 담아 둔 손님도 살 수 없어요'); if (priceNext) notes.push(`이 옵션을 내린 뒤 가격 맞추기(apply)가 이어져야 해요${after.base_change ? ` — 기본가 ${won(after.base_change.from)} → ${won(after.base_change.to)}원` : ''}${after.minAdd_change ? ` · 동기화 기준값 ${after.minAdd_change.from} → ${after.minAdd_change.to}` : ''}${after.price_changes ? ` · 옵션 ${after.price_changes}개 추가금` : ''}(안 하면 다음 새벽 자동 동기화 때 결제가가 어긋날 수 있어요)`); else notes.push('기본가·동기화 기준값은 네이버 판매 옵션으로 정해지므로 이 옵션을 내려도 그대로예요'); if (after.stops.length) notes.push('가격 맞추기 쪽에 따로 멈춤 사유가 있어요: ' + after.stops.join(' / ')); }
        else notes.push(...picks.filter(v => !naverHas(v)).map(v => `「${v.name}」는 네이버에 없는 옵션이에요 — 다시 노출하면 자사몰 결제창에서만 살 수 있는 옵션이 됩니다(화면에는 안 보일 수 있어요)`), '다시 노출한 뒤 preview 로 결제가가 맞는지 확인하세요(내려가 있던 동안 추가금은 안 바뀌었어요)');
        const planOut = { nno: P.nno, cno: P.cno, source: P.source, action: cmd === 'hide' ? '미노출로(판매 F · 진열 F)' : '다시 노출(판매 T · 진열 T)', targets: picks.map(v => ({ code: v.code, opt: v.name, pay: c.base + v.add, now: `${v.selling}/${v.display}` })), live_before: liveNow.length, live_after: cmd === 'hide' ? liveNow.length - picks.filter(p => p.selling === 'T' && p.display === 'T').length : liveNow.length + picks.length, stops, notes, price_follow_up: priceNext ? `node scripts/desk/mall-price.js apply ${P.nno} <지시 id>` : undefined };
        if (stops.length || !picks.length) { console.log(JSON.stringify({ ok: false, stopped: true, ...planOut, note: '멈췄어요 — 바꾼 것 없음' }, null, 1)); await M.pool.end(); return; }
        if (dry) { console.log(JSON.stringify({ ...planOut, note: '계획만 — 아직 아무것도 바꾸지 않았어요(실행하려면 끝에 지시 id)' }, null, 1)); await M.pool.end(); return; }
        // 내리는 실행은 네이버 실시간 값으로 판단했을 때만 — 스냅샷(새벽 값)으로 물러난 상태면 낮에 네이버에 새로 올린 옵션을 「네이버에 없음」으로 잘못 볼 수 있다(총괄 판단 10/8)
        if (cmd === 'hide' && P.source !== '네이버 실시간') { console.log(JSON.stringify({ ok: false, stopped: true, ...planOut, stops: ['네이버 실시간 조회가 안 돼 지금은 내리지 않아요 — 잠시 뒤 다시 말씀해 주세요'], note: '멈췄어요 — 바꾼 것 없음' }, null, 1)); await M.pool.end(); return; }
        const prev = (await M.cfgGet('mall_price_prev')) || {}, hk = 'hide:' + P.nno, list = Array.isArray(prev[hk]) ? prev[hk] : [];
        const before = { at: new Date().toISOString(), order_id: orderId, by: actor, mode: cmd, cno: P.cno, vars: picks.map(v => ({ code: v.code, name: v.name, add: v.add, selling: v.selling, display: v.display })) };
        list.push(before); prev[hk] = list.slice(-5); await M.cfgSet('mall_price_prev', prev);
        const want = cmd === 'hide' ? 'F' : 'T', res = await putAll(P.cno, null, picks.map(v => ({ code: v.code, name: v.name, body: { selling: want, display: want } })), orderId);
        await M.audit('cafe24_variant_update', 'cafe24_product', orderId, { tool: 'mall-price', mode: cmd, order_id: orderId, naver_no: P.nno, cno: P.cno, before, want, results: res }, actor);
        await M.stepLog(orderId, '자사몰 옵션 노출: 카페24가 새 값을 보여 줄 때까지 90초 대기'); await M.sleep(90000);
        const aft = await M.c24Product(P.cno), bad = picks.filter(p => { const v = aft.vars.find(x => x.code === p.code); return !v || v.selling !== want || v.display !== want; }).map(p => p.name);
        console.log(JSON.stringify({ ok: !bad.length && res.every(r => r.ok), changed: true, ...planOut, put_fail: res.filter(r => !r.ok), recheck_bad: bad, undo: `node scripts/desk/mall-price.js ${cmd === 'hide' ? 'show' : 'hide'} ${P.nno} ${picks.map(v => JSON.stringify(v.name)).join(' ')} <지시 id>`, note: bad.length ? '다시 읽은 값이 아직 달라요 — 카페24 조회는 몇 분 늦을 수 있어요. 3분 뒤 preview 로 확인하고 그래도 다르면 총괄에게' : (cmd === 'hide' ? '미노출로 바꿨어요' : '다시 노출했어요') + (priceNext ? ' — 이어서 가격 맞추기(apply)를 하세요' : '') }, null, 1));
    } else throw new Error('사용: mall-price.js preview [상품] [--snapshot] | apply <상품> <지시 id> | restore <상품> <지시 id> | checkout <상품> [옵션 글자] | hide <상품> "<옵션 글자>"… [지시 id] | show <상품> "<옵션 글자>"… [지시 id]');
    await M.pool.end();
})().catch(async e => { console.log(JSON.stringify({ ok: false, error: e.message })); try { await M.pool.end(); } catch (_) { } process.exit(1); });
