// #588-e(대표 GO 10/8) 창구용 — 네이버 상세·옵션을 자사몰에 반영(스냅샷 재수집 → 스킨 정본 갱신 → 올림 → 카페24 상세) 한 명령
//   node scripts/desk/mall-sync.js preview <네이버 상품번호…>          지금 스냅샷 기준으로 무엇이 바뀔지(쓰기 0 · 올리기 0)
//   node scripts/desk/mall-sync.js run <네이버 상품번호…> <지시 id>     ①서버 원본 = 정본 확인 ②스냅샷 재수집(최대 6분) ③스킨 정본 갱신(apply-428-skin.js) ④올림·다시 받아 대조 ⑤카페24 상세(apply-428-c24detail.js) ⑥실화면 확인
//   node scripts/desk/mall-sync.js rollback <지시 id>                  그 지시가 만든 백업 파일로 스킨을 되돌림(카페24 상세는 네이버 상세 그대로라 되돌리지 않음)
//   node scripts/desk/mall-sync.js check <네이버 상품번호…>            실화면(akkome.com)의 옵션·가격이 정본과 같은지만 다시 확인
//   기존 절차(#537)를 그대로 부른다 — 스킨 갱신·카페24 상세의 규칙은 그 스크립트들이 정본이다. 이 도구는 순서·중단·기록만 맡는다.
//   상품번호는 공백 또는 쉼표로 여러 개. 상세 그림은 지정한 상품만이 아니라 스킨에 있는 전 상품이 함께 최신으로 바뀐다(apply-428-skin.js 동작).
//   옵션 이름이 바뀐 상품은 먼저 카페24 옵션(관리자 화면)과 mall-price.js 로 결제가를 맞춘 뒤 실행한다 — 화면만 바뀌고 결제가 안 맞으면 사고다.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const M = require('./_mall');
const nums = a => a.join(',').split(/[,\s]+/).filter(Boolean);
const onorm = v => String(v || '').normalize('NFC').replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
const okey = o => onorm(o.n1) + '|' + onorm(o.n2);
const C24MAP = () => { try { return JSON.parse(fs.readFileSync(path.join(M.ROOT, '_참고자료', '카페24스킨백업', 'scripts', 'c24-map-new-246.json'), 'utf8')).map || {}; } catch (_) { return {}; } };
function targets(args, D) {
    const nos = nums(args); if (!nos.length) throw new Error('네이버 상품번호를 하나 이상 주세요(예: 6400134206)');
    for (const n of nos) { if (!/^\d{9,}$/.test(n)) throw new Error('상품번호가 아니에요: ' + n); if (!D.items.some(x => String(x.no) === n)) throw new Error(`자사몰 스킨에 없는 상품번호예요: ${n} — 새 상품은 총괄이 먼저 스킨에 올려야 해요`); }
    return [...new Set(nos)];
}
// 스킨 정본 ↔ 스냅샷 차이(apply-428-skin.js 의 합치기 규칙과 같은 눈으로 · 읽기만)
function diff(D, snap, det, nos) {
    const out = [];
    for (const no of nos) {
        const it = D.items.find(x => String(x.no) === no), s = snap.items.find(x => String(x.no) === no);
        if (!s) { out.push({ no, name: it.name.slice(0, 20), error: '스냅샷에 없는 상품' }); continue; }
        const old = {}; (it.opts || []).forEach(o => { old[okey(o)] = o; });
        const neo = (s.opts || []).filter(o => o && o.usable !== false), seen = new Set(), ch = [];
        for (const o of neo) { const p = old[okey(o)]; seen.add(okey(o)); if (!p) ch.push(`새 옵션: ${[o.n1, o.n2].filter(Boolean).join(' · ')} (+${o.price || 0})`); else { if ((o.price || 0) !== (p.price || 0)) ch.push(`가격: ${o.n2 || o.n1} +${p.price || 0} → +${o.price || 0}`); if (o.n1 && p.n1 !== o.n1 && (p.nd || p.n1) !== o.n1) ch.push(`표시 이름: ${p.nd || p.n1} → ${o.n1}`); } }
        for (const k of Object.keys(old)) if (!seen.has(k)) ch.push(`빠지는 옵션: ${[old[k].n1, old[k].n2].filter(Boolean).join(' · ')}`);
        if (s.discPrice != null && s.discPrice !== it.discPrice) ch.push(`기준 결제가: ${it.discPrice} → ${s.discPrice}`);
        const dn = det && det.items && det.items[no], dv = dn && Array.isArray(dn.blocks) && dn.blocks.length ? { count: dn.count, imgs: dn.imgs, blocks: dn.blocks } : null;
        out.push({ no, name: it.name.slice(0, 20), opts_now: (it.opts || []).length, opts_new: neo.length, option_changes: ch, detail: !dv ? '상세 스냅샷 없음(그대로 둠)' : JSON.stringify(D.detailImages[no]) === JSON.stringify(dv) ? '같음' : `바뀜(블록 ${((D.detailImages[no] || {}).blocks || []).length} → ${dv.blocks.length})` });
    }
    const keys = Object.keys(D.detailImages || {}); let other = 0;
    for (const k of keys) { if (nos.includes(k)) continue; const n = det && det.items && det.items[k]; if (n && Array.isArray(n.blocks) && n.blocks.length && JSON.stringify(D.detailImages[k]) !== JSON.stringify({ count: n.count, imgs: n.imgs, blocks: n.blocks })) other++; }
    return { items: out, other_detail_changed: other };
}
function runScript(rel, args, ms) {
    const r = spawnSync(process.execPath, [path.join(M.ROOT, rel), ...args], { cwd: M.ROOT, encoding: 'utf8', timeout: ms, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    return { code: r.status, out: String(r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''), timedOut: !!(r.error && r.error.code === 'ETIMEDOUT') };
}
const tail = (s, n) => String(s).trim().split(/\r?\n/).slice(-n).map(l => l.slice(0, 200));
async function liveCheck(nos, tries, waitMs) {
    const D = M.storeData(M.readLocal().toString('utf8')).D, res = [];
    for (const no of nos) {
        const it = D.items.find(x => String(x.no) === no); const want = (it.opts || []).map(o => okey(o) + '|' + (o.price || 0)).sort().join('\n'); let last = null;
        for (let i = 0; i < tries; i++) {
            try { const r = await M.liveRead(no); const got = (r.opts || []).map(o => okey(o) + '|' + (o.price || 0)).sort().join('\n'); last = { no, name: it.name.slice(0, 16), same_options: got === want, live_opts: (r.opts || []).length, local_opts: (it.opts || []).length, rows_on_screen: r.rows, detail_blocks: r.detBlocks, page_errors: r.errs.length }; } catch (e) { last = { no, same_options: false, err: e.message.slice(0, 80) }; }
            if (last.same_options) break; if (i < tries - 1) await M.sleep(waitMs);
        }
        res.push(last);
    }
    return res;
}
(async () => {
    const args = process.argv.slice(2), cmd = args.shift();
    const D = M.storeData(M.readLocal().toString('utf8')).D;
    if (cmd === 'preview') {
        const nos = targets(args, D), snap = await M.latestSnapshot(), det = await M.cfgGet('product_detail_snapshot'), map = C24MAP();
        let srv; try { srv = await M.serverMatches(); } catch (e) { srv = { error: e.message.slice(0, 120) }; }
        const d = diff(D, snap, det, nos);
        console.log(JSON.stringify({ targets: d.items, other_products_detail_changed: d.other_detail_changed, snapshot: `#${snap.id} · ${snap.kst} · ${snap.ageMin}분 전`, detail_snapshot_at: det && det.at, server_equals_local: srv.same, server: srv,
            c24_detail: nos.map(n => map[n] ? `${n} → 카페24 c${map[n]} 상세 갱신 대상` : `${n} → 카페24 상세 매핑 없음(스킨 화면만 바뀜 · 카페24 상세는 총괄에게)`),
            steps: ['서버 원본 = 정본 확인', '스냅샷 재수집(최대 6분)', '스킨 정본 갱신', '올림 → 다시 받아 대조', '카페24 상세 19종 갱신', '실화면 확인'],
            note: '미리 보기 — 지금 스냅샷 기준이에요(run 은 스냅샷을 새로 받은 뒤 반영하므로 방금 네이버에서 바꾼 것은 여기 안 보일 수 있어요). 아직 아무것도 바꾸지 않았어요' }, null, 1));
    } else if (cmd === 'run') {
        const orderId = parseInt(args[args.length - 1], 10); const nos = targets(args.slice(0, -1), D); if (!orderId || /^\d{9,}$/.test(args[args.length - 1])) throw new Error('사용: mall-sync.js run <네이버 상품번호…> <지시 id>');
        const actor = await M.who(orderId), tag = 'desk' + orderId + 's', backup = path.join(M.SKIN_DIR, `index_pre${tag}_backup.html`), log = [];
        const stop = async (at, why, extra) => { await M.audit('update', 'mall_sync', orderId, { targets: nos, order_id: orderId, stopped_at: at, why, log }, actor); console.log(JSON.stringify({ ok: false, stopped_at: at, why, done: log, ...extra }, null, 1)); await M.pool.end(); };
        if (fs.existsSync(backup)) return stop('시작', `백업 파일이 이미 있어요(${path.basename(backup)}) — 같은 지시로 두 번 실행한 것 같아요`);
        await M.stepLog(orderId, '자사몰 반영 1/6: 서버 원본이 정본과 같은지 확인');
        const m = await M.serverMatches(); if (!m.same) return stop('① 서버 원본 대조', `서버 화면 파일이 로컬 정본과 달라요(서버 ${m.server.size}b · 정본 ${m.local.size}b) — 다른 창이 더 새 것을 올렸을 수 있어 덮지 않고 멈춥니다`);
        log.push('① 서버 원본 = 정본');
        let snap = await M.latestSnapshot();
        if (snap.ageMin > 20) {
            await M.stepLog(orderId, '자사몰 반영 2/6: 네이버 스냅샷 새로 받는 중(최대 6분)');
            const r = runScript('scripts/apply-489-snapshot.js', ['-'], 420000); if (r.code !== 0) return stop('② 스냅샷 재수집', '새 스냅샷이 6분 안에 오지 않았어요 — 실서버가 깨어 있는지 확인 뒤 다시 실행해 주세요(아직 바꾼 것 없음)', { output: tail(r.out, 4) });
            snap = await M.latestSnapshot();
        }
        const det = await M.cfgGet('product_detail_snapshot'); const detAge = det && det.at ? Math.round((Date.now() - new Date(det.at).getTime()) / 60000) : null;
        log.push(`② 스냅샷 #${snap.id}(${snap.kst}) · 상세 스냅샷 ${detAge == null ? '없음' : detAge + '분 전'}`);
        const before = diff(D, snap, det, nos);
        await M.stepLog(orderId, '자사몰 반영 3/6: 스킨 정본 갱신');
        const sk = runScript('scripts/apply-428-skin.js', [nos.join(','), tag], 120000);
        if (sk.code !== 0 || !/✅ 저장/.test(sk.out)) { if (fs.existsSync(backup)) fs.copyFileSync(backup, M.FILE); return stop('③ 스킨 정본 갱신', '스킨 갱신 스크립트가 멈췄어요(정본은 그대로)', { output: tail(sk.out, 5) }); }
        if (/STORE_DATA 변경 N/.test(sk.out)) { log.push('③ 스킨: 바뀐 것 없음'); await M.audit('update', 'mall_sync', orderId, { targets: nos, order_id: orderId, changed: false, log }, actor); console.log(JSON.stringify({ ok: true, changed: false, done: log, note: '스킨에 반영할 차이가 없어요(이미 최신) — 올리지 않았어요' }, null, 1)); await M.pool.end(); return; }
        log.push('③ 스킨 정본 갱신 · 백업 ' + path.basename(backup));
        await M.stepLog(orderId, '자사몰 반영 4/6: 스킨 올리는 중');
        let up; try { up = await M.serverPut(M.readLocal()); } catch (e) { fs.copyFileSync(backup, M.FILE); return stop('④ 올리기', '올리기 실패 — 정본을 백업으로 되돌렸어요: ' + e.message.slice(0, 120)); }
        if (!up.same) return stop('④ 올린 뒤 대조', '올린 뒤 다시 받은 파일이 달라요 — 총괄에게 바로 알려 주세요', { backup: path.basename(backup) });
        log.push(`④ 올림 ${up.size}b · 다시 받아 바이트 동일`);
        await M.stepLog(orderId, '자사몰 반영 5/6: 카페24 상세 갱신(최대 4분)');
        const cd = runScript('scripts/apply-428-c24detail.js', [], 300000); const cdOk = cd.code === 0;
        log.push('⑤ 카페24 상세: ' + (cdOk ? tail(cd.out, 1)[0] : '실패 — ' + tail(cd.out, 2).join(' / ')));
        await M.stepLog(orderId, '자사몰 반영 6/6: 실화면 확인(캐시 때문에 몇 분 걸릴 수 있음)');
        const live = await liveCheck(nos, 4, 45000);
        await M.cfgSet('mall_sync_last', { at: new Date().toISOString(), order_id: orderId, by: actor, targets: nos, backup: path.basename(backup), snapshot: snap.id });
        await M.audit('update', 'mall_sync', orderId, { targets: nos, order_id: orderId, changed: true, before, log, live, backup: path.basename(backup) }, actor);
        console.log(JSON.stringify({ ok: cdOk && live.every(x => x.same_options), changed: true, done: log, changes: before.items, other_products_detail_changed: before.other_detail_changed, live, undo: `node scripts/desk/mall-sync.js rollback ${orderId}`,
            note: (cdOk ? '' : '카페24 상세 갱신이 실패했어요(스킨 화면은 반영됨) — 총괄에게 알려 주세요. ') + (live.every(x => x.same_options) ? '실화면 옵션·가격이 정본과 같아요' : '실화면에 아직 옛 값이 섞여 보여요(스킨 캐시 약 10분) — 몇 분 뒤 check 로 다시 확인해 주세요') + ' · 옵션 가격이 바뀐 상품은 mall-price.js checkout 으로 결제창도 확인하세요' }, null, 1));
    } else if (cmd === 'rollback') {
        const orderId = parseInt(args[0], 10); if (!orderId) throw new Error('사용: mall-sync.js rollback <지시 id>');
        const actor = await M.who(orderId), backup = path.join(M.SKIN_DIR, `index_predesk${orderId}s_backup.html`);
        if (!fs.existsSync(backup)) throw new Error('그 지시가 만든 백업 파일이 없어요: ' + path.basename(backup));
        const m = await M.serverMatches(); if (!m.same) throw new Error('서버 화면 파일이 지금 정본과 달라요 — 그 뒤에 다른 반영이 있었을 수 있어 되돌리지 않고 멈춥니다(총괄에게 알려 주세요)');
        const keep = path.join(M.SKIN_DIR, `index_predesk${orderId}s_undone.html`); fs.copyFileSync(M.FILE, keep);
        const buf = fs.readFileSync(backup); let up; try { up = await M.serverPut(buf); } catch (e) { throw new Error('되돌리기 올리기 실패(정본·서버 그대로): ' + e.message); }
        fs.copyFileSync(backup, M.FILE);
        await M.audit('update', 'mall_sync', orderId, { mode: 'rollback', order_id: orderId, backup: path.basename(backup), kept: path.basename(keep), upload: up }, actor);
        console.log(JSON.stringify({ ok: up.same, rolled_back_to: path.basename(backup), kept_new_as: path.basename(keep), upload: up, note: '스킨을 반영 전 파일로 되돌렸어요(실화면은 약 10분 안에 바뀜). 카페24 상세는 되돌리지 않았어요. 다음 새벽 스냅샷이 오면 화면의 옵션·가격은 다시 네이버 값을 따라갑니다' }, null, 1));
    } else if (cmd === 'check') {
        const nos = targets(args, D), live = await liveCheck(nos, 1, 0);
        console.log(JSON.stringify({ live, all_same: live.every(x => x.same_options), note: live.every(x => x.same_options) ? '실화면 옵션·가격 = 정본' : '실화면이 정본과 달라요(방금 올렸다면 캐시 · 아니면 스냅샷이 정본보다 새 것)' }, null, 1));
    } else throw new Error('사용: mall-sync.js preview <네이버 상품번호…> | run <네이버 상품번호…> <지시 id> | rollback <지시 id> | check <네이버 상품번호…>');
    await M.pool.end();
})().catch(async e => { console.log(JSON.stringify({ ok: false, error: e.message })); try { await M.pool.end(); } catch (_) { } process.exit(1); });
