// #739(대표 「자사몰 옵션도 자동으로」 · 조사 = docs/737-cafe24-option-api.md) 창구용 — 자사몰(카페24) 옵션 「이름(글자)」 바꾸기
//   node scripts/desk/mall-option.js list <상품>                                옵션 묶음·값·품목 코드·추가금·판매/진열(카페24 쓰기 0)
//   node scripts/desk/mall-option.js rename-plan <상품> "<지금 값>" "<새 값>"    전/후 표 + 막을 일 검사(카페24 쓰기 0)
//   node scripts/desk/mall-option.js rename <상품> "<지금 값>" "<새 값>" <지시 id> 실제로 바꿈(러너 op option_rename) → 다시 읽어 확인
//   node scripts/desk/mall-option.js revert <상품> <지시 id>                    이 도구로 바꾼 마지막 것을 되돌림(새 값 → 옛 값)
//   <상품> = 네이버 상품번호 · c92 같은 카페24 번호(동기화 매핑 cafe24_sync_map 에 있는 상품만)
//   규칙(🔴 바꾸면 안 되는 이유가 있다 — 송장변환 매칭·05:10 네이버↔자사몰 비교·스냅샷이 옵션 「글자」로 묶여 있음):
//     ①새 값은 **네이버의 판매 중 옵션 글자와 똑같아야** 한다(앞 번호 「1. 」 은 지금 값의 번호를 그대로 붙임) — 다르면 멈춤
//     ②지금 값이 네이버에 아직 판매 중 옵션으로 있으면 멈춤(그 옵션의 연결이 끊김)
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
    try { const nv = (await M.naverLive([nno]))[nno]; return { source: '네이버 실시간', texts: nv.opts.filter(o => o.usable).map(o => noNum(nText(o))) }; }
    catch (e) {
        const snap = await M.latestSnapshot(); const it = snap.items.find(x => String(x.no) === String(nno));
        if (!it) throw new Error('네이버 실시간 조회도 스냅샷도 안 돼요: ' + e.message.slice(0, 80));
        return { source: `스냅샷 #${snap.id}(${snap.kst} · ${snap.ageMin}분 전 · 실시간 실패)`, texts: (it.opts || []).filter(o => o.usable !== false).map(o => noNum(nText(o))) };
    }
}
async function plan(arg, from, to) {
    const R = await resolve(arg); const C = await readC24(R.cno); const N = await naverOpts(R.nno);
    const stops = [], notes = [];
    if (C.groups.length !== 1) notes.push(`옵션 묶음이 ${C.groups.length}개예요(${C.groups.map(g => g.name).join(' · ')}) — 값 글자는 묶음 안에서 찾습니다`);
    const f = nrm(from), hits = [];
    C.groups.forEach((g, gi) => g.values.forEach((v, vi) => { if (nrm(v) === f || noNum(v) === noNum(f)) hits.push({ gi, vi, v }); }));
    if (!hits.length) stops.push(`「${from}」 값을 카페24에서 못 찾았어요 — list 로 정확한 글자를 확인하세요`);
    if (hits.length > 1) stops.push(`「${from}」 와 같은 값이 ${hits.length}개예요 — 앞 번호까지 정확히 적어 주세요: ` + hits.map(h => `「${h.v}」`).join(' · '));
    const h = hits[0];
    const fromText = h ? h.v : from;
    const toText = h ? (numOf(to) ? nrm(to) : numOf(fromText) + noNum(to)) : nrm(to);
    if (h) {
        if (noNum(fromText) === noNum(toText)) stops.push('지금 값과 새 값이 같아요');
        if (!N.texts.includes(noNum(toText))) stops.push(`새 값 「${noNum(toText)}」 이 네이버 판매 중 옵션 글자와 달라요(${N.source}) — 송장 매칭·새벽 비교가 글자로 묶여 있어 네이버 글자와 똑같이만 바꿀 수 있어요. 네이버 글자: ` + N.texts.slice(0, 12).map(t => `「${t}」`).join(' · '));
        if (N.texts.includes(noNum(fromText))) stops.push(`지금 값 「${noNum(fromText)}」 은 네이버에 아직 판매 중이에요 — 바꾸면 그 옵션의 연결이 끊겨요`);
        const dup = C.groups[h.gi].values.filter((v, i) => i !== h.vi && noNum(v) === noNum(toText));
        if (dup.length) stops.push(`새 값과 같은 글자의 카페24 값이 이미 있어요(「${dup[0]}」) — 이름을 바꾸지 말고 옛 값을 미노출로: node scripts/desk/mall-price.js hide ${R.nno} ${JSON.stringify(noNum(fromText))} <지시 id>`);
        if (toText.length > 100) stops.push('새 값이 너무 길어요(서버 상한 100자)');
    }
    const ignore = ((((await M.cfgGet('cafe24_sync_ignore_opts')) || {}).keys) || []).filter(k => String(k).split('|').every(w => noNum(fromText).includes(w)));
    if (ignore.length) notes.push(`옛 값에 걸린 새벽 비교 예외 열쇠가 있어요(${ignore.join(' · ')}) — 바꾼 뒤 그 열쇠가 계속 필요한지 총괄에게 알려 주세요`);
    const variant = h ? C.vars.find(v => nrm(v.name) === nrm(fromText) || noNum(v.name) === noNum(fromText)) : null;
    if (h && !variant && C.groups.length === 1) notes.push('그 값의 품목을 못 찾았어요(품목 이름이 값 글자와 다를 수 있음) — 바꾼 뒤 list 로 확인');
    return { R, C, N, stops, notes, gi: h ? h.gi : null, vi: h ? h.vi : null, from: fromText, to: toText, variant,
        table: [`묶음 「${h ? C.groups[h.gi].name : '?'}」`, `지금: ${fromText}`, `새로: ${toText}`, variant ? `품목 ${variant.code} · 추가금 ${won(variant.add)} · 결제가 ${won(C.base + variant.add)} · 판매 ${variant.selling}/진열 ${variant.display} → 그대로` : '품목: 못 찾음'] };
}
// 러너 요청(워커1 계약 = server.js 「#739 시작~끝」 cafe24OptRun · 결과는 cafe24_product_result 의 opt 칸) — 바꿀 값 한 쌍만 보냄 · 바디 꼴(options·original_options)은 서버가 지금 값을 다시 읽어 만든다
async function runRename(P, orderId, actor, mode) {
    const req = { action: 'option_rename', product_no: Number(P.R.cno), group: P.C.groups[P.gi].name, from: P.from, to: P.to, order_id: orderId, created_by: actor };
    const res = await M.c24(req);
    return (res && res.opt) || { ok: false, error: '러너 결과에 opt 칸이 없어요(서버가 옛 버전일 수 있음)', raw: res };
}
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
        const notApplied = !!res && res.ok === true && (res.not_applied === true || (Array.isArray(res.not_applied) && res.not_applied.length > 0) || res.to_visible === false);
        const ok = !!res && res.ok === true && !notApplied;
        if (notApplied) P.notes.push('카페24 가 이름을 안 바꿨어요 — 관리자 화면에서 바꿔 주세요(상품 [수정] → 옵션/재고 설정 → 옵션값 글자 고치기 → 저장 · 품목은 그대로)');
        if (ok && res.kept === false) P.notes.push('🔴 서버 대조: 품목 값이 바뀌었어요 — ' + JSON.stringify({ removed: res.removed, changed: res.changed }).slice(0, 200));
        if (ok) { list.push(rec); prev[P.R.nno] = list.slice(-5); await M.cfgSet(LAST_KEY, prev); }
        await M.audit('cafe24_option_rename', 'cafe24_product', P.R.cno, { tool: 'mall-option', order_id: orderId, naver_no: P.R.nno, ...rec, result: res }, actor);
        await M.sleep(15000); const aft = await readC24(P.R.cno);
        const now = aft.groups[P.gi] ? aft.groups[P.gi].values : [];
        const bad = [];
        if (!now.some(v => nrm(v) === nrm(P.to))) bad.push('새 값이 아직 안 보여요');
        if (now.some(v => nrm(v) === nrm(P.from))) bad.push('옛 값이 아직 남아 있어요');
        if (P.variant) { const v = aft.vars.find(x => x.code === P.variant.code); if (!v) bad.push(`품목 ${P.variant.code} 가 사라졌어요(🔴 총괄에게 바로)`); else if (v.add !== P.variant.add || v.selling !== P.variant.selling || v.display !== P.variant.display) bad.push(`품목 ${P.variant.code} 값이 바뀌었어요(추가금 ${P.variant.add}→${v.add} · ${P.variant.selling}/${P.variant.display}→${v.selling}/${v.display})`); }
        console.log(JSON.stringify({ ok: ok && !bad.length, changed: ok, not_applied: notApplied || undefined, ...out, runner: ok ? undefined : res, recheck_bad: bad, undo: `node scripts/desk/mall-option.js revert ${P.R.nno} <지시 id>`,
            note: notApplied ? '카페24 가 이름을 안 바꿨어요 — 관리자 화면에서 바꿔 주세요(상품 [수정] → 옵션/재고 설정 → 옵션값 글자 고치기 → 저장). 바꾼 것 없음' : ok ? (bad.length ? '바꿨지만 다시 읽은 값이 아직 달라요 — 카페24 조회는 몇 분 늦을 수 있어요. 3분 뒤 list 로 확인하고 그래도 다르면 총괄에게' : '옵션 이름을 네이버와 같게 바꿨어요(품목·추가금·판매/진열 그대로). 자사몰 화면은 네이버 스냅샷으로 그려져 이미 네이버 글자예요.') : '카페24가 거절했어요 — 바꾼 것 없음' }, null, 1));
    } else if (cmd === 'revert') {
        const orderId = parseInt(args[1], 10); if (!orderId) throw new Error('사용: revert <상품> <지시 id>');
        const R = await resolve(args[0]); const actor = await M.who(orderId);
        const prev = (await M.cfgGet(LAST_KEY)) || {}; const list = Array.isArray(prev[R.nno]) ? prev[R.nno] : []; const last = list[list.length - 1];
        if (!last) throw new Error('이 도구로 바꾼 기록이 없어요');
        const C = await readC24(R.cno); const gi = C.groups.findIndex(g => g.name === last.group);
        if (gi < 0 || !C.groups[gi].values.some(v => nrm(v) === nrm(last.to))) throw new Error(`지금 카페24에 「${last.to}」 값이 없어요 — 그 뒤 누가 바꿨을 수 있어요(되돌리지 않음 · list 로 확인)`);
        if (C.groups[gi].values.some(v => nrm(v) === nrm(last.from))) throw new Error(`옛 값 「${last.from}」 과 같은 값이 이미 있어요 — 되돌리면 같은 이름이 둘이 돼요(되돌리지 않음)`);
        const raw = await M.c24({ action: 'option_rename', product_no: Number(R.cno), group: last.group, from: last.to, to: last.from, order_id: orderId, revert: true, created_by: actor });
        const res = (raw && raw.opt) || { ok: false, error: '러너 결과에 opt 칸이 없어요', raw };
        const notApplied = res.ok === true && (res.not_applied === true || (Array.isArray(res.not_applied) && res.not_applied.length > 0) || res.to_visible === false);
        const ok = res.ok === true && !notApplied;
        if (ok) { prev[R.nno] = list.slice(0, -1); await M.cfgSet(LAST_KEY, prev); }
        await M.audit('cafe24_option_rename', 'cafe24_product', R.cno, { tool: 'mall-option', mode: 'revert', order_id: orderId, naver_no: R.nno, back_from: last.to, back_to: last.from, result: res }, actor);
        console.log(JSON.stringify({ ok, reverted: ok, from: last.to, to: last.from, runner: ok ? undefined : res, not_applied: notApplied || undefined, note: notApplied ? '카페24 가 이름을 안 바꿨어요 — 관리자 화면에서 옛 이름으로 고쳐 주세요' : ok ? '옛 이름으로 되돌렸어요(품목 그대로) — 3분 뒤 list 로 확인' : '카페24가 거절했어요 — 바꾼 것 없음' }, null, 1));
    } else {
        console.log('사용: list <상품> | rename-plan <상품> "<지금 값>" "<새 값>" | rename <…> <지시 id> | revert <상품> <지시 id>\n' + ADD_GUIDE);
    }
    await M.pool.end();
})().catch(async e => { console.log(JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 300) })); try { await M.pool.end(); } catch (_) { } process.exit(1); });
