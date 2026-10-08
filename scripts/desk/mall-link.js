// #589(대표 GO 10/8) 창구용 — 새 품목의 「네이버 상품 ↔ 카페24 상품」 연결
//   node scripts/desk/mall-link.js find "<이름>"                       네이버·카페24 후보와 짝 제안(이미 연결됐으면 그 사실) — 읽기만
//   node scripts/desk/mall-link.js preview <네이버번호> <카페24번호>    옵션 짝 맞춤표 · 빠진 옵션 · 기본가 계획 · 상세 가능 여부 · 스킨에서 더 필요한 것 — 읽기만
//   node scripts/desk/mall-link.js link <네이버번호> <카페24번호> <지시 id> [--then]
//        연결표(cafe24_sync_map)·상세 매핑(c24-map-new-246.json)에 한 줄씩 → audit. --then = 이어서 가격 맞추기 → 카페24 대표그림·상세 → (스킨에 상품이 있으면) 스킨 반영 → 결제창 확인
//   node scripts/desk/mall-link.js unlink <지시 id>                    그 지시가 넣은 연결을 뺌(카페24 상품·가격은 그대로 둔다)
//   연결이 하는 일(조사 #589): ①연결표 한 줄 { c24, minAdd } — 그날부터 새벽 자동 동기화가 그 카페24 상품의 기본가·품절을 네이버에 맞춘다
//                            ②상세 매핑 한 줄 — 「상세 반영」(apply-428-c24detail.js)이 그 상품의 카페24 상세도 같이 갱신한다
//   연결만으로 안 되는 것(스킨 코드 · 총괄 몫): 홈 index.html 의 상품 자료(STORE_DATA.items)·담기 연결표(AKM_C24MAP) · 장바구니/주문내역의 뒤집은 표(AKM_C24TONV) — preview 의 skin_todo 에 무엇이 빠졌는지 나온다.
//   카페24 상품을 만드는 일(상품 등록·옵션 입력)은 관리자 화면에서 사람이 한다 — 이 도구는 이미 있는 두 상품을 잇기만 한다.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const M = require('./_mall');
const DMAP = path.join(M.ROOT, '_참고자료', '카페24스킨백업', 'scripts', 'c24-map-new-246.json');
const nrm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const noNum = s => nrm(s).replace(/^\d+\.\s*/, '');
const flat = s => String(s || '').normalize('NFC').replace(/\s+/g, '');
const nText = o => (o.n1 && o.n2) ? `${o.n1} · ${o.n2}` : (o.n2 || o.n1 || '');
const won = n => Number(n).toLocaleString('ko-KR');
const PRIVATE = /결제\s*창|개인\s*결제/;   // 손님 개인결제창 상품 — 후보에서 뺀다(이름에 손님 번호 끝자리가 있다)
const syncMap = async () => (await M.cfgGet('cafe24_sync_map')) || { map: {} };
const readDmap = () => JSON.parse(fs.readFileSync(DMAP, 'utf8'));
// 스킨에 그 상품이 뜨는 데 필요한 것 — 무엇이 이미 있고 무엇이 빠졌는지(읽기만)
function skinState(nno, cno, naverName) {
    const src = M.readLocal().toString('utf8'), D = M.storeData(src).D, rd = f => { try { return fs.readFileSync(path.join(M.SKIN_DIR, f), 'utf8'); } catch (_) { return ''; } };
    const fwd = new RegExp(`'${nno}'\\s*:\\s*'${cno}'`), rev = new RegExp(`'${cno}'\\s*:\\s*'${nno}'`);
    const cat = /감귤|청귤|황금향|한라봉|천혜향|레드향|카라향|하귤|자몽|레몬|오렌지|만감|홍귤|키위/.test(naverName) || /호박|나물|양배추|브로콜리|옥수수/.test(naverName);
    const st = { item: D.items.some(x => String(x.no) === nno), detail: !!(D.detailImages && D.detailImages[nno]), cartMap: fwd.test(src.split('\n').slice(0, 40).join('\n')), basketMap: rev.test(rd('order/basket.html')), orderListMap: rev.test(rd('myshop/order/list.html')), shortName: new RegExp(`'${nno}'\\s*:`).test((src.split('\n').find(l => /var SHORT = \{/.test(l)) || '')), category: cat };
    const todo = [];
    if (!st.item) todo.push('홈 화면 상품 자료에 이 상품이 없어요(STORE_DATA.items · galleries · detailImages) — 없으면 자사몰 홈·상세에 상품이 아예 안 보여요');
    if (!st.cartMap) todo.push(`담기 연결표에 '${nno}':'${cno}' 가 없어요(index.html AKM_C24MAP) — 없으면 [구매하기]·[담기]가 안 돼요`);
    if (!st.basketMap) todo.push(`장바구니의 뒤집은 표에 '${cno}':'${nno}' 가 없어요(order/basket.html AKM_C24TONV) — 없으면 장바구니에서 상품을 눌러도 상세로 못 가요`);
    if (!st.orderListMap) todo.push(`주문내역의 뒤집은 표에 '${cno}':'${nno}' 가 없어요(myshop/order/list.html AKM_C24TONV)`);
    if (st.item && !st.shortName) todo.push('짧은 이름표(SHORT)에 없어요 — 네이버 상품명이 길게 그대로 보여요(선택)');
    if (!st.category) todo.push('상품명이 어느 카테고리 낱말에도 안 걸려요 — 홈 목록에는 보이지만 카테고리 화면에는 안 나와요(CATS)');
    return { ...st, todo };
}
async function naverOf(nno, snap) {
    try { return { nv: (await M.naverLive([nno]))[nno], source: '네이버 실시간' }; } catch (e) {
        const it = snap.items.find(x => String(x.no) === nno); if (!it) throw new Error(`네이버 상품 ${nno} 을(를) 못 읽었어요(실시간 조회 실패 · 스냅샷에도 없음): ` + e.message.slice(0, 80));
        return { nv: { no: nno, name: it.name, statusType: it.statusType, discPrice: it.discPrice != null ? Number(it.discPrice) : Number(it.salePrice), optsNone: !!it.optsNone || !(it.opts || []).length, opts: (it.opts || []).map(o => ({ n1: o.n1 || '', n2: o.n2 || '', price: Number(o.price) || 0, usable: o.usable !== false })) }, source: `스냅샷 #${snap.id}(${snap.kst} · ${snap.ageMin}분 전)` };
    }
}
async function check(nno, cno) {
    if (!/^\d{9,}$/.test(String(nno))) throw new Error('네이버 상품번호가 아니에요: ' + nno);
    cno = parseInt(String(cno).replace(/^c/i, ''), 10); if (!cno) throw new Error('카페24 상품번호가 아니에요(예: 120 또는 c120)');
    const cfg = await syncMap(), map = cfg.map || {}, stops = [], warns = [];
    const mine = map[nno], other = Object.entries(map).find(([n, m]) => String(m.c24) === String(cno) && n !== nno);
    const already = !!mine && String(mine.c24) === String(cno);
    if (mine && !already) stops.push(`네이버 ${nno} 은(는) 이미 카페24 c${mine.c24} 와 연결돼 있어요 — 바꾸는 것은 총괄 창에서`);
    if (other) stops.push(`카페24 c${cno} 은(는) 이미 네이버 ${other[0]} 와 연결돼 있어요`);
    const snap = await M.latestSnapshot(), { nv, source } = await naverOf(nno, snap), c = await M.c24Product(cno);
    if (PRIVATE.test(c.name)) stops.push('그 카페24 상품은 개인결제창이에요 — 연결 대상이 아니에요');
    const usable = nv.opts.filter(o => o.usable), rows = [], used = new Set();
    for (const o of usable) {
        const t = nText(o); let h = c.vars.filter(v => nrm(v.name) === nrm(t)); if (!h.length) h = c.vars.filter(v => noNum(v.name) === noNum(t));
        if (h.length === 1) { used.add(h[0].code); rows.push({ opt: t, naver: nv.discPrice + o.price, c24: c.base + h[0].add, state: h[0].selling === 'T' && h[0].display === 'T' ? '이름 같음' : '이름 같음(카페24 미노출)' }); }
        else rows.push({ opt: t, naver: nv.discPrice + o.price, c24: null, state: h.length ? '카페24에 같은 이름이 여러 개' : '카페24에 없음' });
    }
    const extra = c.vars.filter(v => !used.has(v.code) && v.selling === 'T' && v.display === 'T').map(v => v.name);
    const matched = rows.filter(r => r.state.startsWith('이름 같음')).length, missing = rows.filter(r => r.c24 == null).map(r => r.opt);
    const liveMin = nv.optsNone ? 0 : (usable.length ? Math.min(...usable.map(o => o.price)) : 0), targetBase = nv.discPrice + liveMin;
    if (!nv.optsNone && !usable.length) stops.push('네이버에 판매 중인 옵션이 없어요');
    if (!nv.optsNone && usable.length && !matched) stops.push('옵션 이름이 하나도 안 맞아요 — 두 상품이 같은 품목인지, 카페24 옵션 이름을 네이버와 글자까지 같게 넣었는지 확인해 주세요');
    if (missing.length && matched) warns.push(`카페24에 없는 옵션 ${missing.length}개 — 연결은 되지만 가격 맞추기가 멈춰요. 관리자 화면에서 같은 이름으로 추가해 주세요: ` + missing.map(x => `「${x}」`).join(' · '));
    if (extra.length) warns.push(`카페24에만 있는 판매 옵션 ${extra.length}개(자사몰 전용이면 그대로 둠): ` + extra.map(x => `「${x}」`).join(' · '));
    if (flat(nv.name).length && !['감귤', '귤', '황금향', '한라봉', '천혜향', '레드향', '카라향', '레몬', '키위', '호박', '청귤', '자몽', '오렌지', '하귤', '홍귤', '나물', '양배추', '브로콜리', '옥수수'].some(w => flat(nv.name).includes(w) && flat(c.name).includes(w)) && !matched) warns.push(`두 상품 이름에 같은 품목 낱말이 없어요(네이버 「${String(nv.name).slice(0, 20)}」 · 카페24 「${c.name}」)`);
    const det = await M.cfgGet('product_detail_snapshot'), hasDet = !!(det && det.items && det.items[nno] && Array.isArray(det.items[nno].blocks) && det.items[nno].blocks.length);
    let dmap = {}; try { dmap = readDmap().map || {}; } catch (_) { warns.push('상세 매핑 파일을 못 읽었어요(' + path.basename(DMAP) + ')'); }
    const skin = skinState(nno, cno, String(nv.name));
    return { nno, cno, cfg, already, stops, warns, nv, c, source, rows, matched, total: usable.length, missing, extra, liveMin, targetBase, hasDet, detAt: det && det.at, inDmap: String(dmap[nno] || '') === String(cno), dmapOther: dmap[nno] && String(dmap[nno]) !== String(cno) ? dmap[nno] : null, skin };
}
const view = K => ({ naver: `${K.nno} 「${String(K.nv.name).slice(0, 30)}」(${K.nv.statusType || '?'})`, cafe24: `c${K.cno} 「${K.c.name}」(판매 ${K.c.selling} · 진열 ${K.c.display})`, source: K.source, already_linked: K.already, options: `네이버 판매 옵션 ${K.total}개 중 이름이 같은 것 ${K.matched}개`,
    table: K.rows.map(r => `${r.state} | 네이버 ${won(r.naver)} | 자사몰 ${r.c24 == null ? '—' : won(r.c24)} | ${r.opt}`), missing_in_cafe24: K.missing, cafe24_only: K.extra,
    price_plan: K.nv.optsNone ? `옵션 없는 단일 상품 — 기본가 ${won(K.c.base)} → ${won(K.targetBase)}원(새벽 자동 동기화가 맞춤)` : `기본가 ${won(K.c.base)}${K.c.base === K.targetBase ? '(그대로)' : ' → ' + won(K.targetBase)}원 · 동기화 기준값(minAdd) ${K.liveMin} · 옵션 결제가는 연결 뒤 「자사몰 맞춰줘」(mall-price apply)가 맞춤`,
    detail: K.hasDet ? `네이버 상세 스냅샷 있음(${K.detAt}) — 카페24 상세로 옮길 수 있어요` : '네이버 상세 스냅샷에 이 상품이 없어요 — 회사프로그램 [상세 다시 불러오기] 또는 다음 새벽 수집 뒤에 상세 반영',
    detail_map: K.inDmap ? '상세 매핑에 이미 있음' : (K.dmapOther ? `상세 매핑에 다른 번호(c${K.dmapOther})로 들어 있어요` : '상세 매핑에 한 줄 추가 예정'),
    skin: { 홈_상품자료: K.skin.item, 담기_연결표: K.skin.cartMap, 장바구니_표: K.skin.basketMap, 주문내역_표: K.skin.orderListMap, 짧은이름: K.skin.shortName, 카테고리: K.skin.category }, skin_todo: K.skin.todo, stops: K.stops, warnings: K.warns });
function runTool(file, args, ms) { const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { cwd: M.ROOT, encoding: 'utf8', timeout: ms, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }); let j = null; try { j = JSON.parse(String(r.stdout || '').trim()); } catch (_) { } return { code: r.status, j, raw: j ? undefined : String(r.stdout || r.stderr || '').slice(-300) }; }
(async () => {
    const args = process.argv.slice(2), cmd = args.shift(); const ti = args.indexOf('--then'), then = ti >= 0; if (then) args.splice(ti, 1);
    if (cmd === 'find') {
        const q = nrm(args.join(' ')), words = q.split(' ').filter(w => w.length >= 2); if (!words.length) throw new Error('사용: mall-link.js find "<품목 이름>"  (예: "천혜향")');
        const hit = s => words.every(w => flat(s).includes(flat(w)));
        const map = (await syncMap()).map || {}, snap = await M.latestSnapshot();
        const r = await M.c24({ action: 'raw', method: 'GET', path: '/api/v2/admin/products', query: { sort: 'created_date', order: 'desc', fields: 'product_no,product_name,selling,display,created_date', limit: 60 } });
        if (!M.c24Ok(r)) throw new Error('카페24 조회 실패: ' + JSON.stringify(r).slice(0, 160));
        const linkedC = new Map(Object.entries(map).map(([n, m]) => [String(m.c24), n]));
        const nv = snap.items.filter(it => hit(it.name) || (it.opts || []).some(o => o.usable !== false && hit(nText(o)))).map(it => ({ no: String(it.no), name: it.name, status: it.statusType, linked: map[String(it.no)] ? 'c' + map[String(it.no)].c24 : null, by: hit(it.name) ? '상품명' : '옵션 이름' }));
        const all = (r.raw.data.products || []).filter(p => !PRIVATE.test(p.product_name));
        const c24 = all.filter(p => hit(p.product_name)).map(p => ({ no: 'c' + p.product_no, name: p.product_name, state: `판매 ${p.selling} · 진열 ${p.display}`, created: String(p.created_date).slice(0, 10), linked: linkedC.get(String(p.product_no)) || null }));
        const recent = all.filter(p => !linkedC.has(String(p.product_no))).slice(0, 5).map(p => ({ no: 'c' + p.product_no, name: p.product_name, created: String(p.created_date).slice(0, 10) }));
        const freeN = nv.filter(x => !x.linked && x.by === '상품명'), freeC = c24.filter(x => !x.linked), linked = nv.filter(x => x.linked);
        let pair = null, note;
        if (freeN.length === 1 && freeC.length === 1) { pair = { naver: freeN[0].no, cafe24: freeC[0].no, next: `node scripts/desk/mall-link.js preview ${freeN[0].no} ${freeC[0].no.slice(1)}` }; note = '짝 후보가 하나로 정해졌어요 — preview 로 옵션을 맞춰 보세요'; }
        else if (linked.some(x => x.by === '상품명') && !freeN.length) note = '이미 연결돼 있어요: ' + linked.filter(x => x.by === '상품명').map(x => `${x.no} ↔ ${x.linked}`).join(' · ') + ' — 새로 연결할 것이 없어요(판매를 다시 여는 것은 네이버에서 판매 시작 → 「자사몰 맞춰줘」·「상세 반영」)' + (freeC.length ? ' · 연결 안 된 같은 이름의 카페24 상품(' + freeC.map(x => x.no).join(', ') + ')은 옛 상품일 수 있어요 — 새로 등록한 것이 맞는지 요청자에게 확인' : '');
        else if (!freeC.length) note = '연결 안 된 카페24 상품 중 그 이름이 없어요 — 카페24 관리자에서 상품을 먼저 등록해 주세요(상품관리 → 상품 등록 → 기본가 = 네이버 가장 싼 옵션 결제가 · 옵션 이름은 네이버와 글자까지 같게 → 저장한 뒤 바로 「연결해줘」)';
        else if (!freeN.length) note = '네이버 스냅샷에 연결 안 된 그 이름 상품이 없어요 — 오늘 새로 올린 상품이면 스냅샷이 아직 몰라요. 네이버 상품번호를 알려 주시면 preview 로 바로 봅니다';
        else note = '후보가 여러 개예요 — 어느 것끼리인지 요청자에게 물어 주세요';
        console.log(JSON.stringify({ query: q, naver: nv, cafe24: c24, recent_unlinked_cafe24: recent, pair, snapshot: `#${snap.id} · ${snap.kst}`, note }, null, 1));
    } else if (cmd === 'preview') {
        const K = await check(args[0], args[1]);
        console.log(JSON.stringify({ ...view(K), can_link: !K.stops.length && !K.already, after_link: ['가격 맞추기(mall-price apply)', '카페24 대표그림·상세', K.skin.item ? '스킨 반영(mall-sync run)' : '스킨 반영은 총괄 몫(skin_todo) — 그 전에는 자사몰에 상품이 안 보여요', K.skin.item && K.skin.cartMap ? '결제창 확인(mall-price checkout)' : '결제창 확인은 스킨 연결 뒤'], note: K.already ? '이미 연결돼 있어요 — 새로 쓸 것이 없어요' : '미리 보기 — 아직 아무것도 바꾸지 않았어요' }, null, 1));
    } else if (cmd === 'link') {
        const orderId = parseInt(args[2], 10); if (!orderId) throw new Error('사용: mall-link.js link <네이버번호> <카페24번호> <지시 id> [--then]');
        const actor = await M.who(orderId), K = await check(args[0], args[1]);
        if (K.stops.length) { console.log(JSON.stringify({ ok: false, stopped: true, ...view(K), note: '멈췄어요 — 바꾼 것 없음' }, null, 1)); await M.pool.end(); return; }
        const done = [];
        if (!K.already) {
            if (K.source !== '네이버 실시간') { console.log(JSON.stringify({ ok: false, stopped: true, stops: ['네이버 실시간 조회가 안 돼 지금은 연결하지 않아요(기준값을 새벽 값으로 넣게 됨) — 잠시 뒤 다시 말씀해 주세요'], note: '멈췄어요 — 바꾼 것 없음' }, null, 1)); await M.pool.end(); return; }
            const prev = (await M.cfgGet('mall_link_prev')) || { items: [] }; prev.items = (prev.items || []).concat([{ at: new Date().toISOString(), order_id: orderId, by: actor, nno: K.nno, cno: K.cno, added_map: true, added_detail: !K.inDmap && !K.dmapOther }]).slice(-20); await M.cfgSet('mall_link_prev', prev);
            const cfg = await syncMap(); cfg.map[K.nno] = { c24: K.cno, minAdd: K.liveMin }; await M.cfgSet('cafe24_sync_map', cfg); done.push(`연결표: ${K.nno} ↔ c${K.cno} · minAdd ${K.liveMin}`);
            if (!K.inDmap && !K.dmapOther) { const d = readDmap(); d.map[K.nno] = K.cno; fs.writeFileSync(DMAP, JSON.stringify(d, null, 1), 'utf8'); done.push('상세 매핑: 한 줄 추가'); } else done.push('상세 매핑: ' + (K.inDmap ? '이미 있음' : `다른 번호(c${K.dmapOther})가 있어 건드리지 않음 — 총괄 확인`));
            await M.audit('update', 'mall_link', orderId, { order_id: orderId, naver_no: K.nno, cno: K.cno, minAdd: K.liveMin, options: `${K.matched}/${K.total}`, missing: K.missing, skin_todo: K.skin.todo }, actor);
        } else done.push('이미 연결돼 있음 — 연결표·매핑 그대로');
        const steps = {};
        if (then) {
            await M.stepLog(orderId, '자사몰 연결: 가격 맞추는 중'); const p = runTool('mall-price.js', ['apply', K.nno, String(orderId)], 600000);
            steps.price = p.j ? { ok: p.j.ok !== false && !p.j.stopped, changed: p.j.changed, stops: p.j.stops, changed_opts: p.j.changed_opts, note: p.j.note || p.j.error } : { ok: false, raw: p.raw };
            await M.stepLog(orderId, '자사몰 연결: 카페24 대표그림·상세 옮기는 중');
            try { const im = await M.c24({ action: 'bulk-image', map: { [K.nno]: K.cno } }, 240000); steps.image = im.images || im.image || im; } catch (e) { steps.image = { ok: false, error: e.message.slice(0, 120) }; }
            if (K.hasDet) { try { const de = await M.c24({ action: 'bulk-detail', map: { [K.nno]: K.cno } }, 240000); steps.detail = (de.detail || []).map(r => r.ok ? `c${r.c24_no} ${r.blocks}블록` : `c${r.c24_no} 실패 ${r.skip || r.error}`); } catch (e) { steps.detail = { ok: false, error: e.message.slice(0, 120) }; } } else steps.detail = '상세 스냅샷이 없어 건너뜀';
            if (K.skin.item) { await M.stepLog(orderId, '자사몰 연결: 스킨 반영(약 10분)'); const s = runTool('mall-sync.js', ['run', K.nno, String(orderId)], 1500000); steps.skin = s.j ? { ok: s.j.ok, changed: s.j.changed, done: s.j.done, stopped_at: s.j.stopped_at, why: s.j.why, note: s.j.note } : { ok: false, raw: s.raw }; } else steps.skin = '스킨에 상품 자료가 없어 건너뜀(총괄 몫)';
            if (K.skin.item && K.skin.cartMap && steps.price.ok) { await M.stepLog(orderId, '자사몰 연결: 결제창 확인'); const c = runTool('mall-price.js', ['checkout', K.nno], 600000); steps.checkout = c.j ? { all_ok: c.j.all_ok, results: c.j.results, error: c.j.error } : { raw: c.raw }; } else steps.checkout = '스킨 연결 전이라 건너뜀';
        }
        console.log(JSON.stringify({ ok: true, linked: !K.already, done, ...(then ? { steps } : { next: ['「자사몰 맞춰줘」 = node scripts/desk/mall-price.js preview ' + K.nno, K.skin.item ? '「상세 반영」 = node scripts/desk/mall-sync.js preview ' + K.nno : '스킨 반영은 총괄 몫'] }), warnings: K.warns, skin_todo: K.skin.todo, undo: `node scripts/desk/mall-link.js unlink ${orderId}`,
            note: '연결했어요 — 오늘부터 새벽 자동 동기화(05:10)가 이 카페24 상품의 기본가·품절을 네이버에 맞춥니다.' + (K.skin.todo.length ? ' 자사몰 화면에 뜨려면 skin_todo(총괄 몫)가 남아 있어요.' : '') }, null, 1));
    } else if (cmd === 'unlink') {
        const orderId = parseInt(args[0], 10); if (!orderId) throw new Error('사용: mall-link.js unlink <연결했던 지시 id>');
        const prev = (await M.cfgGet('mall_link_prev')) || { items: [] }, e = (prev.items || []).filter(x => x.order_id === orderId).pop(); if (!e) throw new Error('그 지시로 연결한 기록이 없어요');
        const actor = e.by, done = [], cfg = await syncMap();
        if (e.added_map && cfg.map[e.nno] && String(cfg.map[e.nno].c24) === String(e.cno)) { delete cfg.map[e.nno]; await M.cfgSet('cafe24_sync_map', cfg); done.push(`연결표에서 뺌: ${e.nno} ↔ c${e.cno}`); } else done.push('연결표: 그 줄이 없거나 달라져 있어 건드리지 않음');
        if (e.added_detail) { const d = readDmap(); if (String(d.map[e.nno] || '') === String(e.cno)) { delete d.map[e.nno]; fs.writeFileSync(DMAP, JSON.stringify(d, null, 1), 'utf8'); done.push('상세 매핑에서 뺌'); } }
        prev.items = prev.items.filter(x => x !== e); await M.cfgSet('mall_link_prev', prev);
        await M.audit('update', 'mall_link', orderId, { mode: 'unlink', order_id: orderId, naver_no: e.nno, cno: e.cno, done }, actor);
        console.log(JSON.stringify({ ok: true, done, note: '연결을 뺐어요 — 카페24 상품과 그 가격·상세는 그대로예요(새벽 자동 동기화 대상에서만 빠짐). 스킨에 이미 반영한 것이 있으면 총괄에게 알려 주세요' }, null, 1));
    } else throw new Error('사용: mall-link.js find "<이름>" | preview <네이버번호> <카페24번호> | link <네이버번호> <카페24번호> <지시 id> [--then] | unlink <지시 id>');
    await M.pool.end();
})().catch(async e => { console.log(JSON.stringify({ ok: false, error: e.message })); try { await M.pool.end(); } catch (_) { } process.exit(1); });
