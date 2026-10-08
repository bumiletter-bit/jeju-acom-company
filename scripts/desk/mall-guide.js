// #588-c(대표 GO 10/8) 창구용 — 자사몰 상세 「드시는 법·보관법」 탭 글 바꾸기
//   node scripts/desk/mall-guide.js list                              지금 글(키별) · 어느 상품 화면에 보이는지
//   node scripts/desk/mall-guide.js preview <키> <글파일>              바꾸기 전 미리 보기(쓰기 0 · 올리기 0) — 전/후 글 · 주의할 점 · 서버 원본 = 정본인지
//   node scripts/desk/mall-guide.js set <키> <글파일> <지시 id>         백업 → 서버 원본 대조 → 올림 → 다시 받아 대조 → 실화면 확인
//   node scripts/desk/mall-guide.js restore <키> <지시 id>             바로 앞 글로 되돌림(같은 길)
//   node scripts/desk/mall-guide.js check <키>                         실화면(akkome.com)에 지금 정본 글이 보이는지만 다시 확인
//   키 = 하우스감귤 · 밤호박 · 황금향 (스킨이 상품 이름에서 이 셋만 골라 탭을 보여 준다 — 다른 품목은 탭 자체가 없다)
//   글파일 = UTF-8 글 파일(창구가 Write 로 만든 것). 탭에는 이 글이 줄바꿈까지 그대로 보인다(「{{내일요일}}」 같은 자리표는 채워지지 않는다).
//   바꾸는 것 = 스킨 정본 STORE_DATA.guides[].text 뿐(다른 바이트 무변경 검사). 알림톡·문자·/guide 의 안내문(판매현황 shipping_guide)과는 별개다.
const fs = require('fs'), path = require('path');
const M = require('./_mall');
const KEYS = ['하우스감귤', '밤호박', '황금향'];
const ALIAS = { '귤': '하우스감귤', '감귤': '하우스감귤', '하우스귤': '하우스감귤', '노지감귤': '하우스감귤', '유라': '하우스감귤', '미니밤호박': '밤호박', '단호박': '밤호박' };
const keyOf = k => { const s = String(k || '').replace(/\s+/g, ''); const r = KEYS.includes(s) ? s : ALIAS[s]; if (!r) throw new Error('키는 ' + KEYS.join(' · ') + ' 중 하나예요(자사몰 탭이 이 세 품목에만 있어요)'); return r; };
// 스킨 guideFor() 와 같은 고르기(상품 이름 → 키)
const keyForItem = it => /하우스감귤|노지 감귤/.test(it.name) ? '하우스감귤' : /밤호박/.test(it.name) ? '밤호박' : /황금향/.test(it.name) ? '황금향' : null;
const entriesOf = (D, key) => (D.guides || []).filter(g => g.name.indexOf(key) >= 0);
const pagesOf = (D, key) => (D.items || []).filter(it => keyForItem(it) === key).map(it => ({ no: String(it.no), name: it.name }));
function readText(f) {
    if (!f || !fs.existsSync(f)) throw new Error('글 파일을 못 찾았어요: ' + f);
    const t = fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
    if (t.length < 10 || t.length > 3000) throw new Error(`글 길이가 ${t.length}자예요 — 10~3000자만 받아요`);
    if (/<\/script|<!--|<script/i.test(t)) throw new Error('글에 화면을 깨뜨리는 글자(script·주석 표시)가 있어요');
    if (t.includes('�')) throw new Error('글이 깨져 있어요(인코딩) — UTF-8 로 다시 만들어 주세요');
    return t;
}
function warnings(t) {
    const w = [];
    if (/\{\{[^}]*\}\}/.test(t)) w.push('「{{…}}」 자리표가 있어요 — 자사몰 탭은 자리표를 채우지 않아 글자 그대로 보입니다(빼는 것을 권해요)');
    if (/배송 현황|오늘 출발|도착 예정/.test(t)) w.push('「오늘 출발·도착 예정」 같은 발송 안내 문장이 있어요 — 이 탭은 주문 전 손님도 보는 곳이라 맞지 않을 수 있어요');
    if (/수신거부/.test(t)) w.push('「수신거부」 문장은 문자용이에요 — 자사몰 탭에는 필요 없어요');
    if (/01\d[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(t)) w.push('휴대전화 번호가 들어 있어요 — 회사 대표번호가 맞는지 확인해 주세요');
    return w;
}
// 정본 글자에서 그 안내문만 바꾼 새 파일 내용(다른 바이트 무변경 검사 포함)
function build(src, changes) {
    const S = M.storeData(src); let L = S.L; const done = [];
    for (const [name, neo] of changes) {
        const g = S.D.guides.find(x => x.name === name); if (!g) throw new Error('정본에 없는 안내문: ' + name);
        const from = JSON.stringify(name) + ',"text":' + JSON.stringify(g.text), to = JSON.stringify(name) + ',"text":' + JSON.stringify(neo);
        const at = L.indexOf(from); if (at < 0 || L.indexOf(from, at + 1) >= 0) throw new Error('정본에서 그 안내문 자리를 하나로 못 짚었어요 — 중단(총괄에게 알려 주세요)');
        L = L.slice(0, at) + to + L.slice(at + from.length); done.push({ name, before: g.text, after: neo });
    }
    const lines = S.lines.slice(); lines[S.li] = L; const out = lines.join('\n');
    // 검사: 다시 읽어 guides[].text 말고는 전부 같아야 한다
    const N = M.storeData(out), a = JSON.parse(JSON.stringify(S.D)), b = JSON.parse(JSON.stringify(N.D));
    for (const d of done) { const x = b.guides.find(g => g.name === d.name); if (!x || x.text !== d.after) throw new Error('바꾼 글이 다시 읽은 값과 달라요 — 중단'); x.text = d.before; }
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('안내문 말고 다른 값이 달라졌어요 — 중단');
    if (N.lines.length !== S.lines.length || N.lines.some((l, i) => i !== S.li && l !== S.lines[i])) throw new Error('STORE_DATA 줄 밖이 달라졌어요 — 중단');
    if (/<\/script/i.test(L.slice(S.i0, L.lastIndexOf('}') + 1))) throw new Error('script 닫는 글자가 생겼어요 — 중단');
    return { out, done, delta: Buffer.byteLength(out) - Buffer.byteLength(src) };
}
const norm = s => String(s || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
async function liveCheck(key, D, tries, waitMs) {
    const pages = pagesOf(D, key), want = norm(entriesOf(D, key)[0].text), res = [];
    for (const p of pages) {
        let last = null;
        for (let i = 0; i < tries; i++) {
            try { const r = await M.liveRead(p.no); last = { no: p.no, name: p.name.slice(0, 16), tab: r.guide != null, same: norm(r.guide) === want, errs: r.errs.length }; } catch (e) { last = { no: p.no, name: p.name.slice(0, 16), tab: false, same: false, err: e.message.slice(0, 80) }; }
            if (last.same) break; if (i < tries - 1) await M.sleep(waitMs);
        }
        res.push(last);
    }
    return res;
}
async function apply(key, changes, orderId, mode) {
    const actor = await M.who(orderId);
    await M.stepLog(orderId, '자사몰 안내문: 서버 원본이 정본과 같은지 확인');
    const m = await M.serverMatches();
    if (!m.same) throw new Error(`서버 화면 파일이 로컬 정본과 달라요(서버 ${m.server.size}b ${m.server.sha} · 정본 ${m.local.size}b ${m.local.sha}) — 다른 창이 더 새 것을 올렸을 수 있어요. 덮지 않고 멈춥니다(총괄에게 알려 주세요)`);
    const src = M.readLocal().toString('utf8'), B = build(src, changes);
    if (!B.done.some(d => d.before !== d.after)) return { ok: true, changed: false, note: '이미 같은 글이에요 — 바꾼 것 없음' };
    const tag = 'desk' + orderId + (mode === 'restore' ? 'r' : 'g') + '_' + key, backup = M.backupTo(tag);   // 지시 하나로 여러 키를 바꿀 수 있게 백업 이름에 키를 넣는다(같은 지시·같은 키 두 번은 거절)
    const prev = (await M.cfgGet('mall_guide_prev')) || {}; const list = Array.isArray(prev[key]) ? prev[key] : [];
    list.push({ at: new Date().toISOString(), order_id: orderId, by: actor, mode, backup: path.basename(backup), entries: B.done.map(d => ({ name: d.name, text: d.before })) });
    prev[key] = list.slice(-5); await M.cfgSet('mall_guide_prev', prev);
    fs.writeFileSync(M.FILE, B.out, 'utf8');
    await M.stepLog(orderId, '자사몰 안내문: 스킨 올리는 중');
    let up;
    try { up = await M.serverPut(Buffer.from(B.out, 'utf8')); } catch (e) { fs.copyFileSync(backup, M.FILE); throw new Error('올리기 실패 — 정본을 백업으로 되돌렸어요(서버는 그대로일 가능성이 높아요 · check 로 확인): ' + e.message); }
    await M.audit('update', 'mall_guide', orderId, { key, mode, order_id: orderId, backup: path.basename(backup), entries: B.done, upload: up }, actor);
    if (!up.same) return { ok: false, uploaded: true, note: '올린 뒤 다시 받은 파일이 달라요 — 총괄에게 바로 알려 주세요(백업 ' + path.basename(backup) + ')' };
    await M.stepLog(orderId, '자사몰 안내문: 실화면 확인(캐시 때문에 몇 분 걸릴 수 있음)');
    const live = await liveCheck(key, M.storeData(B.out).D, 4, 45000);
    return { ok: true, changed: true, key, entries: B.done.map(d => ({ name: d.name, before_len: d.before.length, after_len: d.after.length })), backup: path.basename(backup), upload: up, live, live_ok: live.every(x => x.same),
        undo: `node scripts/desk/mall-guide.js restore ${key} <지시 id>`, note: live.every(x => x.same) ? '실화면에 새 글이 보여요' : '올리기는 끝났지만 실화면에 아직 옛 글이 섞여 보여요(스킨 캐시 약 10분) — 몇 분 뒤 check 로 다시 확인해 주세요' };
}
(async () => {
    const args = process.argv.slice(2), cmd = args.shift();
    const D = M.storeData(M.readLocal().toString('utf8')).D;
    if (!cmd || cmd === 'list') {
        console.log(JSON.stringify({ keys: KEYS.map(k => { const es = entriesOf(D, k); return { key: k, shown_on: pagesOf(D, k), entries: es.length, all_same: es.every(e => e.text === es[0].text), len: es[0] ? es[0].text.length : 0, warnings: es[0] ? warnings(es[0].text) : [], text: es[0] ? es[0].text : null }; }), note: '탭에 보이는 글 = 키마다 첫 안내문(text). 같은 키의 안내문은 함께 바꿉니다' }, null, 1));
    } else if (cmd === 'preview') {
        const key = keyOf(args[0]), neo = readText(args[1]), es = entriesOf(D, key); if (!es.length) throw new Error('정본에 그 키의 안내문이 없어요');
        const B = build(M.readLocal().toString('utf8'), es.map(e => [e.name, neo]));
        let srv; try { srv = await M.serverMatches(); } catch (e) { srv = { error: e.message.slice(0, 120) }; }
        console.log(JSON.stringify({ key, shown_on: pagesOf(D, key), entries: es.map(e => e.name), same_as_now: es.every(e => e.text === neo), before: es[0].text, after: neo, before_len: es[0].text.length, after_len: neo.length, bytes_delta: B.delta, warnings: warnings(neo), server_equals_local: srv.same, server: srv, note: '미리 보기 — 아직 아무것도 바꾸지 않았어요(파일·서버·DB 그대로)' }, null, 1));
    } else if (cmd === 'set') {
        const key = keyOf(args[0]), neo = readText(args[1]), orderId = parseInt(args[2], 10); if (!orderId) throw new Error('사용: mall-guide.js set <키> <글파일> <지시 id>');
        const es = entriesOf(D, key); if (!es.length) throw new Error('정본에 그 키의 안내문이 없어요');
        console.log(JSON.stringify(await apply(key, es.map(e => [e.name, neo]), orderId, 'set'), null, 1));
    } else if (cmd === 'restore') {
        const key = keyOf(args[0]), orderId = parseInt(args[1], 10); if (!orderId) throw new Error('사용: mall-guide.js restore <키> <지시 id>');
        const prev = (await M.cfgGet('mall_guide_prev')) || {}, last = (prev[key] || []).slice(-1)[0]; if (!last) throw new Error('되돌릴 앞 글 기록이 없어요(이 도구로 바꾼 적이 없는 키)');
        const r = await apply(key, last.entries.map(e => [e.name, e.text]), orderId, 'restore'); r.restored_from = { at: last.at, order_id: last.order_id, by: last.by };
        console.log(JSON.stringify(r, null, 1));
    } else if (cmd === 'check') {
        const key = keyOf(args[0]); const live = await liveCheck(key, D, 1, 0);
        console.log(JSON.stringify({ key, live, live_ok: live.every(x => x.same), note: live.every(x => x.same) ? '실화면 = 정본 글' : '실화면이 정본 글과 달라요(방금 올렸다면 캐시 · 아니면 서버 파일이 다른 것)' }, null, 1));
    } else throw new Error('사용: mall-guide.js list | preview <키> <글파일> | set <키> <글파일> <지시 id> | restore <키> <지시 id> | check <키>');
    await M.pool.end();
})().catch(async e => { console.log(JSON.stringify({ ok: false, error: e.message })); try { await M.pool.end(); } catch (_) { } process.exit(1); });
