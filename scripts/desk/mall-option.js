// #739(대표 「자사몰 옵션도 자동으로」 · 조사 = docs/737-cafe24-option-api.md) 창구용 — 자사몰(카페24) 옵션 「이름(글자)」 바꾸기
//   node scripts/desk/mall-option.js list <상품>                                옵션 묶음·값·품목 코드·추가금·판매/진열(카페24 쓰기 0)
//   node scripts/desk/mall-option.js rename-plan <상품> "<지금 값>" "<새 값>"    전/후 표 + 막을 일 검사(카페24 쓰기 0)
//   node scripts/desk/mall-option.js rename <상품> "<지금 값>" "<새 값>" <지시 id> 실제로 바꿈(러너 op option_rename) → 다시 읽어 확인
//   node scripts/desk/mall-option.js revert <상품> <지시 id>                    이 도구로 바꾼 마지막 것을 되돌림(새 값 → 옛 값)
//   <상품> = 네이버 상품번호 · c92 같은 카페24 번호(동기화 매핑 cafe24_sync_map 에 있는 상품만)
//   규칙(🔴 바꾸면 안 되는 이유가 있다 — 송장변환 매칭·05:10 네이버↔자사몰 비교·스냅샷이 옵션 「글자」로 묶여 있음):
//     ①(#740 대표 10/18) 글자가 같을 필요는 없고 **품목 특징(품목·kg·크기·용도)이 같아야** 한다 = price-check.js 의 옵션 열쇠(app.js 매칭기 → 단가표 이름)
//       새 값 열쇠 = 네이버 판매 중 옵션 중 하나의 열쇠 · 옛 값 열쇠 = 새 값 열쇠(다른 상품으로 바뀌면 멈춤) · 열쇠를 못 읽으면(매칭기 실패) 멈춤
//     ②(앞 번호 「1. 」 은 지금 값의 번호를 그대로 붙임)
//     ③새 값과 같은 글자의 카페24 값이 이미 있으면 멈춤(관리자에서 새로 추가해 둔 값 — 옛 값은 이름을 바꾸지 말고 미노출: mall-price.js hide)
//     ④바꾸는 것은 글자뿐 — 품목 코드·추가금·재고·판매/진열은 그대로(카페24 문서 「생성되어 있는 품목은 초기화하지 않습니다」)
//     ⑤새 옵션 「추가」·옵션 삭제는 이 도구로 안 함 → 카페24 관리자 화면(아래 ADD_GUIDE) · 삭제는 mall-price.js hide(미노출)
const M = require('./_mall');
const nrm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const noNum = s => nrm(s).replace(/^\d+\.\s*/, '');
const numOf = s => (nrm(s).match(/^(\d+\.\s*)/) || [])[1] || '';
const nText = o => (o.n1 && o.n2) ? `${o.n1} · ${o.n2}` : (o.n2 || o.n1 || '');
const won = n => n == null ? '—' : Number(n).toLocaleString('ko-KR');
const ADD_GUIDE = '새 옵션 추가는 카페24 관리자에서 해 주세요: 상품관리 → 상품 목록 → 그 상품 [수정] → 옵션/재고 설정 → 옵션값 추가 → [품목 생성/추가] → 저장. '
    + '새 품목은 추가금 0 으로 생기니 저장 직후 창구에 「자사몰 가격 맞춰줘」(mall-price.js apply)를 시키세요. 옵션 삭제 대신 미노출(mall-price.js hide)을 씁니다.';
const LAST_KEY = 'mall_option_prev';
// #740 품목 특징 열쇠 = price-check.js optionKey(송장변환·중간발주와 같은 매칭기) · by 'match' 만 믿는다(by 'text' = 못 읽음)
const PC = require(require('path').join(M.ROOT, 'price-check.js'));
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
async function pricingNames() { const r = await M.pool.query(`SELECT items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date`, [kstDay()]); const set = new Set(); r.rows.forEach(x => (x.items || []).forEach(it => { if (it && it.name) set.add(it.name); })); return [...set]; }
const mallParts = v => String(v || '').split(/\s*(?:·|\/)\s*/).map(x => x.trim()).filter(Boolean);
const keyOf = (parts, names) => { const k = PC.optionKey(parts && parts.length ? parts : [''], names); return k && k.by === 'match' ? k : null; };

async function resolve(arg) {
    const map = ((await M.cfgGet('cafe24_sync_map')) || {}).map || {}; const s = String(arg || '').trim();
    if (!s) throw new Error('상품을 알려 주세요(네이버 상품번호 또는 c92)');
    let nno = null;
    if (/^\d{9,}$/.test(s)) nno = s;
    else if (/^c\d+$/i.test(s)) nno = (Object.entries(map).find(([, m]) => String(m.c24) === s.slice(1)) || [])[0];
    else throw new Error('상품은 네이버 상품번호 또는 c92 꼴로 알려 주세요');
    if (!nno || !map[nno]) throw new Error('자사몰과 연결된 상품이 아니에요(동기화 매핑에 없음): ' + s);
    return { nno, cno: String(map[nno].c24) };
}
// 카페24 옵션 구성 + 품목
async function readC24(cno) {
    const r = await M.c24({ action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}/options` });
    if (!M.c24Ok(r)) throw new Error(`카페24 c${cno} 옵션 구성 조회 실패: ` + JSON.stringify(r).slice(0, 160));
    const o = (r.raw.data && (r.raw.data.option || r.raw.data.options)) || {};
    const groups = (Array.isArray(o.options) ? o.options : []).map(g => ({ name: g.option_name, values: (g.option_value || []).map(v => v.option_text) }));
    const c = await M.c24Product(cno);
    return { cno, name: c.name, base: c.base, has_option: o.has_option, option_type: o.option_type, list_type: o.option_list_type, groups, vars: c.vars };
}
// 네이버 판매 중 옵션 글자(실시간 → 안 되면 스냅샷)
async function naverOpts(nno) {
    const partsOf = o => [o.n1, o.n2].filter(x => x != null && String(x).trim()).map(x => String(x).trim());
    try { const nv = (await M.naverLive([nno]))[nno]; const u = nv.opts.filter(o => o.usable); return { source: '네이버 실시간', texts: u.map(o => noNum(nText(o))), opts: u.map(o => ({ text: nText(o), parts: partsOf(o) })) }; }
    catch (e) {
        const snap = await M.latestSnapshot(); const it = snap.items.find(x => String(x.no) === String(nno));
        if (!it) throw new Error('네이버 실시간 조회도 스냅샷도 안 돼요: ' + e.message.slice(0, 80));
        const u = (it.opts || []).filter(o => o.usable !== false);
        return { source: `스냅샷 #${snap.id}(${snap.kst} · ${snap.ageMin}분 전 · 실시간 실패)`, texts: u.map(o => noNum(nText(o))), opts: u.map(o => ({ text: nText(o), parts: partsOf(o) })) };
    }
}
async function plan(arg, from, to) {
    const R = await resolve(arg); const C = await readC24(R.cno); const N = await naverOpts(R.nno);
    const stops = [], notes = []; let P_MATCH = null;
    if (C.groups.length !== 1) notes.push(`옵션 묶음이 ${C.groups.length}개예요(${C.groups.map(g => g.name).join(' · ')}) — 값 글자는 묶음 안에서 찾습니다`);
    const f = nrm(from), hits = [];
    C.groups.forEach((g, gi) => g.values.forEach((v, vi) => { if (nrm(v) === f || noNum(v) === noNum(f)) hits.push({ gi, vi, v }); }));
    if (!hits.length) stops.push(`「${from}」 값을 카페24에서 못 찾았어요 — list 로 정확한 글자를 확인하세요`);
    if (hits.length > 1) stops.push(`「${from}」 와 같은 값이 ${hits.length}개예요 — 앞 번호까지 정확히 적어 주세요: ` + hits.map(h => `「${h.v}」`).join(' · '));
    const h = hits[0];
    const fromText = h ? h.v : from;
    const toText = h ? (numOf(to) ? nrm(to) : numOf(fromText) + noNum(to)) : nrm(to);
    if (h) {
        if (nrm(fromText) === nrm(toText)) stops.push('지금 값과 새 값이 같아요');
        const names = await pricingNames();
        const kTo = keyOf(mallParts(toText), names), kFrom = keyOf(mallParts(fromText), names);
        if (!kTo) stops.push(`새 값 「${noNum(toText)}」 의 특징을 못 읽었어요 — 이름에 품목·kg·크기(로얄과·소과 등)·용도(가정용·선물용)를 넣어 주세요`);
        if (!kFrom) stops.push(`지금 값 「${noNum(fromText)}」 의 특징을 못 읽었어요 — 같은 상품인지 확인할 수 없어 멈춥니다(총괄에게)`);
        if (kTo && kFrom && kTo.key !== kFrom.key) stops.push(`다른 상품으로 바뀌어요 — 지금 「${kFrom.label}」 → 새 「${kTo.label}」 (이름 바꾸기는 같은 상품의 글자만 · 다른 상품은 관리자 화면에서 새 옵션으로)`);
        const nvHit = kTo ? (N.opts || []).filter(o => { const k = keyOf(o.parts, names); return k && k.key === kTo.key; }) : [];
        if (kTo && !nvHit.length) stops.push(`새 값의 상품 「${kTo.label}」 이 네이버 판매 중 옵션에 없어요(${N.source}) — 네이버에서 파는 상품으로만 맞출 수 있어요`);
        // #740 ① 새벽 05:10 비교 열쇠(cafe24OptKey = 과일|용도|kg|등급 낱말)가 옛 값과 같아야 — 다르면 다음 새벽 「옵션명 불일치」 경보
        const ckFrom = PC.cafe24OptKey(fromText), ckTo = PC.cafe24OptKey(toText);
        if (ckFrom !== ckTo) stops.push(`새벽 비교 열쇠가 바뀌어요(${ckFrom || '없음'} → ${ckTo || '없음'}) — 과일·용도(가정용·선물용)·kg·크기 낱말은 옛 이름과 같게 두세요`);
        // #743 교훈: 자사몰 스킨은 번호만 다른 옵션이면 내장 STORE_DATA 의 글자(= 카페24 「찾는 글자」)로 담는다 → 카페24 이름을 그 글자와 다르게 바꾸면 원터치가 깨짐
        //   (스킨 내장 글자는 스킨 갱신(#537) 때만 바뀜 · 스킨 짝 c24t 배포 전까지 이 검사로 막는다)
        if (nvHit.length) {
            let skinSearch = null; try { const SD = M.storeData(M.readLocal().toString('utf8')).D; const it = (SD.items || []).find(x => String(x.no) === String(R.nno)); const on = v => String(v || '').normalize('NFC').replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim(); const nv = nvHit[0]; const e = it ? (it.opts || []).find(x => on(x.n1) === on(nv.parts[0]) && on(x.n2) === on(nv.parts[1])) : null; skinSearch = e ? ((e.n1 && e.n2) ? `${e.n1} · ${e.n2}` : (e.n2 || e.n1)) : nv.text; } catch (_) { skinSearch = null; }
            const sk = t => String(t || '').replace(/\s*\(\+[\d,]+원\)\s*$/, '').replace(/\s+/g, ' ').trim();
            if (skinSearch && sk(skinSearch) !== sk(toText)) stops.push(`자사몰 담기 원터치가 깨져요 — 스킨이 찾는 글자는 「${skinSearch}」 인데 새 이름은 「${toText}」(스킨 내장 글자는 스킨 갱신 때만 바뀜 · 스킨 짝(c24t) 배포 전까지 이 이름으로는 못 바꿔요)`);
            if (skinSearch && sk(skinSearch) === sk(fromText)) notes.push(`지금 이름이 스킨이 찾는 글자와 같아요 — 담기는 지금 정상이에요(바꾸면 깨질 수 있음)`);
        }
        if (kTo && nvHit.length) P_MATCH = `네이버 「${noNum(nvHit[0].text)}」 ↔ 자사몰 「${noNum(toText)}」 = 같은 상품(${kTo.label} · 품목·kg·크기·용도)` + (noNum(nvHit[0].text) === noNum(toText) ? ' · 글자도 같음' : ' · 글자는 다름(괜찮음)');
        const sameKey = kTo ? C.groups[h.gi].values.filter((v, i) => i !== h.vi && (vv => !vv || (vv.selling === 'T' && vv.display === 'T'))(C.vars.find(x => nrm(x.name) === nrm(v))) && (k => k && k.key === kTo.key)(keyOf(mallParts(v), names))) : [];
        if (sameKey.length) stops.push(`같은 상품(${kTo.label})의 판매 중인 카페24 값이 이미 있어요(「${sameKey[0]}」) — 이름을 바꾸면 같은 상품이 둘이 돼요. 옛 값은 미노출로: node scripts/desk/mall-price.js hide ${R.nno} ${JSON.stringify(noNum(fromText))} <지시 id>`);
        const dup = C.groups[h.gi].values.filter((v, i) => i !== h.vi && noNum(v) === noNum(toText));
        if (dup.length) stops.push(`새 값과 같은 글자의 카페24 값이 이미 있어요(「${dup[0]}」) — 이름을 바꾸지 말고 옛 값을 미노출로: node scripts/desk/mall-price.js hide ${R.nno} ${JSON.stringify(noNum(fromText))} <지시 id>`);
        if (toText.length > 100) stops.push('새 값이 너무 길어요(서버 상한 100자)');
    }
    const ignore = ((((await M.cfgGet('cafe24_sync_ignore_opts')) || {}).keys) || []).filter(k => String(k).split('|').every(w => noNum(fromText).includes(w)));
    if (ignore.length) notes.push(`옛 값에 걸린 새벽 비교 예외 열쇠가 있어요(${ignore.join(' · ')}) — 바꾼 뒤 그 열쇠가 계속 필요한지 총괄에게 알려 주세요`);
    const variant = h ? C.vars.find(v => nrm(v.name) === nrm(fromText) || noNum(v.name) === noNum(fromText)) : null;
    if (h && !variant && C.groups.length === 1) notes.push('그 값의 품목을 못 찾았어요(품목 이름이 값 글자와 다를 수 있음) — 바꾼 뒤 list 로 확인');
    return { R, C, N, stops, notes, gi: h ? h.gi : null, vi: h ? h.vi : null, from: fromText, to: toText, variant,
        table: [`묶음 「${h ? C.groups[h.gi].name : '?'}」`, `지금: ${fromText}`, `새로: ${toText}`, ...(P_MATCH ? [P_MATCH] : []), variant ? `품목 ${variant.code} · 추가금 ${won(variant.add)} · 결제가 ${won(C.base + variant.add)} · 판매 ${variant.selling}/진열 ${variant.display} → 그대로` : '품목: 못 찾음'] };
}
// 러너 요청(워커1 계약 = server.js 「#739 시작~끝」 cafe24OptRun · 결과는 cafe24_product_result 의 opt 칸) — 바꿀 값 한 쌍만 보냄 · 바디 꼴(options·original_options)은 서버가 지금 값을 다시 읽어 만든다
async function runRename(P, orderId, actor, mode) {
    const req = { action: 'option_rename', product_no: Number(P.R.cno), group: P.C.groups[P.gi].name, from: P.from, to: P.to, order_id: orderId, created_by: actor };
    const res = await M.c24(req);
    return (res && res.opt) || { ok: false, error: '러너 결과에 opt 칸이 없어요(서버가 옛 버전일 수 있음)', raw: res };
}
// #739 실측 2차(워커1): 카페24 는 옵션 이름 반영이 약 1~1.5분 늦고 그 사이 읽기가 옛값/새값을 오락가락한다
//   → PUT 이 통과하면(서버 ok · pending_confirm) options_get 을 15초 간격으로 최대 3분 · 「새 이름 보임 + 옛 이름 없음」이 2번 연속이면 확정
//   → 확정 뒤 variants_get 으로 품목 코드·추가금·판매·진열이 그대로인지(kept) · 3분 안에 안 정해지면 「반영이 늦어요 — 다시 보내지 않기」
const CONFIRM_MS = 180000, CONFIRM_GAP = 15000, CONFIRM_NEED = 2;
async function c24Opt(req) { const r = await M.c24(req); return (r && r.opt) || { ok: false, error: '러너 결과에 opt 칸이 없어요', raw: r }; }
async function confirmRename(cno, group, from, to, before) {
    const t0 = Date.now(); let streak = 0, polls = 0, last = null;
    while (Date.now() - t0 < CONFIRM_MS) {
        await M.sleep(CONFIRM_GAP);
        const r = await c24Opt({ action: 'options_get', product_no: Number(cno) }); polls++;
        const g = r && r.ok && r.options ? (r.options.groups || []).find(x => x.option_name === group) : null;
        const vals = g ? g.values.map(nrm) : null;
        const seen = vals ? (vals.includes(nrm(to)) && !vals.includes(nrm(from)) ? 'new' : vals.includes(nrm(from)) && !vals.includes(nrm(to)) ? 'old' : 'mixed') : 'error';
        last = seen; streak = seen === 'new' ? streak + 1 : 0;
        if (streak >= CONFIRM_NEED) break;
    }
    const confirmed = streak >= CONFIRM_NEED, waited = Math.round((Date.now() - t0) / 1000);
    let kept = null, var_bad = [];
    if (confirmed && Array.isArray(before) && before.length) {
        const v = await c24Opt({ action: 'variants_get', product_no: Number(cno) });
        if (v && v.ok && Array.isArray(v.variants)) {
            const now = new Map(v.variants.map(x => [x.code, x]));
            for (const b of before) {
                const n = now.get(b.code);
                if (!n) { var_bad.push(`품목 ${b.code} 가 사라졌어요(🔴 총괄에게 바로)`); continue; }
                if (Number(n.add) !== Number(b.add) || n.selling !== b.selling || n.display !== b.display) var_bad.push(`품목 ${b.code} 값이 바뀌었어요(추가금 ${b.add}→${n.add} · ${b.selling}/${b.display}→${n.selling}/${n.display})`);
            }
            kept = var_bad.length === 0;
        } else var_bad.push('품목 다시 읽기 실패 — list 로 확인');
    }
    return { confirmed, polls, waited_sec: waited, last_seen: last, kept, var_bad };
}
const LATE_NOTE = '카페24 반영이 늦어요 — 몇 분 뒤 list 로 확인해 주세요(🔴 다시 보내지 않기 · 이미 보낸 요청이 늦게 반영되는 중일 수 있어요)';
const NOT_APPLIED_NOTE = '카페24 가 이름을 안 바꿨어요 — 관리자 화면에서 바꿔 주세요(상품 [수정] → 옵션/재고 설정 → 옵션값 글자 고치기 → 저장 · 품목은 그대로)';
const isNotApplied = res => !!res && res.ok === true && (res.not_applied === true || (Array.isArray(res.not_applied) && res.not_applied.length > 0));
(async () => {
    const [cmd, ...args] = process.argv.slice(2);
    if (cmd === 'list') {
        const R = await resolve(args[0]); const C = await readC24(R.cno);
        console.log(JSON.stringify({ ok: true, nno: R.nno, cno: 'c' + R.cno, name: C.name, base: C.base, option_type: C.option_type, list_type: C.list_type,
            groups: C.groups.map(g => ({ name: g.name, n: g.values.length, values: g.values })),
            variants: C.vars.map(v => `${v.code} | ${v.selling}/${v.display} | 추가금 ${won(v.add)} | 결제가 ${won(C.base + v.add)} | ${v.name}`), add_guide: ADD_GUIDE }, null, 1));
    } else if (cmd === 'rename-plan' || cmd === 'rename') {
        const orderId = cmd === 'rename' ? parseInt(args[3], 10) : null;
        if (args.length < 3 || (cmd === 'rename' && !orderId)) throw new Error(`사용: ${cmd} <상품> "<지금 값>" "<새 값>"${cmd === 'rename' ? ' <지시 id>' : ''}`);
        const P = await plan(args[0], args[1], args[2]);
        const out = { nno: P.R.nno, cno: 'c' + P.R.cno, source: P.N.source, table: P.table, stops: P.stops, notes: P.notes, add_guide: ADD_GUIDE };
        if (P.stops.length) { console.log(JSON.stringify({ ok: false, stopped: true, ...out, note: '멈췄어요 — 바꾼 것 없음' }, null, 1)); await M.pool.end(); return; }
        if (cmd === 'rename-plan') { console.log(JSON.stringify({ ok: true, plan_only: true, ...out, next: `node scripts/desk/mall-option.js rename ${P.R.nno} ${JSON.stringify(P.from)} ${JSON.stringify(P.to)} <지시 id>` }, null, 1)); await M.pool.end(); return; }
        const actor = await M.who(orderId);
        const prev = (await M.cfgGet(LAST_KEY)) || {}; const list = Array.isArray(prev[P.R.nno]) ? prev[P.R.nno] : [];
        const rec = { at: new Date().toISOString(), order_id: orderId, by: actor, cno: P.R.cno, group: P.C.groups[P.gi].name, from: P.from, to: P.to, variant: P.variant ? P.variant.code : null };
        await M.stepLog(orderId, `자사몰 옵션 이름: 「${noNum(P.from).slice(-24)}」 → 「${noNum(P.to).slice(-24)}」`);
        const res = await runRename(P, orderId, actor, 'rename');
        const accepted = !!res && res.ok === true && !isNotApplied(res);
        await M.audit('cafe24_option_rename', 'cafe24_product', P.R.cno, { tool: 'mall-option', order_id: orderId, naver_no: P.R.nno, ...rec, result: res }, actor);
        if (!accepted) {
            console.log(JSON.stringify({ ok: false, changed: false, not_applied: isNotApplied(res) || undefined, ...out, runner: res, note: isNotApplied(res) ? NOT_APPLIED_NOTE : '카페24가 거절했어요 — 바꾼 것 없음' }, null, 1));
            await M.pool.end(); return;
        }
        // PUT 통과 = 되돌리기 기록부터(반영이 늦어도 revert 길이 열려 있게)
        list.push({ ...rec, pending: true }); prev[P.R.nno] = list.slice(-5); await M.cfgSet(LAST_KEY, prev);
        await M.stepLog(orderId, '자사몰 옵션 이름: 카페24 반영 확인 중(15초마다 · 최대 3분)');
        const before = Array.isArray(res.variants_before) && res.variants_before.length ? res.variants_before : P.C.vars.map(v => ({ code: v.code, add: v.add, selling: v.selling, display: v.display }));
        const cf = await confirmRename(P.R.cno, P.C.groups[P.gi].name, P.from, P.to, before);
        if (cf.confirmed) { list[list.length - 1].pending = false; prev[P.R.nno] = list.slice(-5); await M.cfgSet(LAST_KEY, prev); }
        await M.audit('cafe24_option_rename_confirm', 'cafe24_product', P.R.cno, { tool: 'mall-option', order_id: orderId, naver_no: P.R.nno, from: P.from, to: P.to, ...cf }, actor);
        // #740 영향 점검(쓰기 0) — 바꾼 옵션 하나
        let impact = null;
        if (cf.confirmed) { try { const r = await require('./option-impact').check('mall', 'c' + P.R.cno, [noNum(P.to)]); impact = { summary: r.summary, reds: r.reds, table: r.table, refs_skin: r.refs, ...(r.reds.length ? { ask: '이름은 바뀌었지만 위 옵션은 송장 매칭·발송안내 등이 안 맞아요 — 옵션 이름을 다시 고칠까요?' } : {}) }; } catch (e) { impact = { error: '영향 점검 실패(반영과는 무관): ' + String(e.message || e).slice(0, 160) }; } }
        console.log(JSON.stringify({ ok: cf.confirmed && cf.kept !== false, changed: true, confirmed: cf.confirmed, confirm: cf, ...out, impact: impact || undefined, undo: `node scripts/desk/mall-option.js revert ${P.R.nno} <지시 id>`,
            note: !cf.confirmed ? LATE_NOTE : cf.kept === false ? '🔴 이름은 바뀌었는데 품목 값이 달라졌어요 — 총괄에게 바로: ' + cf.var_bad.join(' · ') : '바뀌었어요(품목 그대로) — 네이버와 같은 이름이에요. 자사몰 화면은 네이버 스냅샷으로 그려져 이미 네이버 글자예요.' }, null, 1));
    } else if (cmd === 'revert') {
        const orderId = parseInt(args[1], 10); if (!orderId) throw new Error('사용: revert <상품> <지시 id>');
        const R = await resolve(args[0]); const actor = await M.who(orderId);
        const prev = (await M.cfgGet(LAST_KEY)) || {}; const list = Array.isArray(prev[R.nno]) ? prev[R.nno] : []; const last = list[list.length - 1];
        if (!last) throw new Error('이 도구로 바꾼 기록이 없어요');
        const C = await readC24(R.cno); const gi = C.groups.findIndex(g => g.name === last.group);
        if (gi < 0 || !C.groups[gi].values.some(v => nrm(v) === nrm(last.to))) throw new Error(`지금 카페24에 「${last.to}」 값이 없어요 — 그 뒤 누가 바꿨을 수 있어요(되돌리지 않음 · list 로 확인)`);
        if (C.groups[gi].values.some(v => nrm(v) === nrm(last.from))) throw new Error(`옛 값 「${last.from}」 과 같은 값이 이미 있어요 — 되돌리면 같은 이름이 둘이 돼요(되돌리지 않음)`);
        const res = await c24Opt({ action: 'option_rename', product_no: Number(R.cno), group: last.group, from: last.to, to: last.from, order_id: orderId, revert: true, created_by: actor });
        const accepted = res.ok === true && !isNotApplied(res);
        await M.audit('cafe24_option_rename', 'cafe24_product', R.cno, { tool: 'mall-option', mode: 'revert', order_id: orderId, naver_no: R.nno, back_from: last.to, back_to: last.from, result: res }, actor);
        if (!accepted) { console.log(JSON.stringify({ ok: false, reverted: false, runner: res, not_applied: isNotApplied(res) || undefined, note: isNotApplied(res) ? '카페24 가 이름을 안 바꿨어요 — 관리자 화면에서 옛 이름으로 고쳐 주세요' : '카페24가 거절했어요 — 바꾼 것 없음' }, null, 1)); await M.pool.end(); return; }
        prev[R.nno] = list.slice(0, -1); await M.cfgSet(LAST_KEY, prev);
        const before = Array.isArray(res.variants_before) && res.variants_before.length ? res.variants_before : C.vars.map(v => ({ code: v.code, add: v.add, selling: v.selling, display: v.display }));
        const cf = await confirmRename(R.cno, last.group, last.to, last.from, before);
        await M.audit('cafe24_option_rename_confirm', 'cafe24_product', R.cno, { tool: 'mall-option', mode: 'revert', order_id: orderId, naver_no: R.nno, from: last.to, to: last.from, ...cf }, actor);
        console.log(JSON.stringify({ ok: cf.confirmed && cf.kept !== false, reverted: true, confirmed: cf.confirmed, confirm: cf, from: last.to, to: last.from,
            note: !cf.confirmed ? LATE_NOTE : cf.kept === false ? '🔴 되돌렸는데 품목 값이 달라졌어요 — 총괄에게 바로: ' + cf.var_bad.join(' · ') : '옛 이름으로 되돌렸어요(품목 그대로)' }, null, 1));
    } else {
        console.log('사용: list <상품> | rename-plan <상품> "<지금 값>" "<새 값>" | rename <…> <지시 id> | revert <상품> <지시 id>\n' + ADD_GUIDE);
    }
    await M.pool.end();
})().catch(async e => { console.log(JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 300) })); try { await M.pool.end(); } catch (_) { } process.exit(1); });
