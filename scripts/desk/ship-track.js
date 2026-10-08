// #594 택배 배송 현황(초안) — 사용: node scripts/desk/ship-track.js --date 2026-10-07 [--partner 효돈] [--limit 10] [--gap 350] [--raw]
//   송장 색인(share-index.js · %LOCALAPPDATA%\akkome\공유폴더_색인)에서 그 날짜 운송장을 모아 CJ대한통운 배송조회를 한 건씩 물어 집계한다. 읽기만 · 쓰기 0.
//   조회 길(provider 'cjweb') = CJ대한통운 누리집 배송조회 화면이 쓰는 주소(직원이 손으로 보는 그 화면 · 키 없음). 공식 API 가 아니라 화면이 바뀌면 깨질 수 있다 —
//   조회·분류는 서버와 같은 모듈(cj-track.js)을 쓴다. 이 도구는 색인(받는 분 기준 — 한 분께 상자 둘이면 운송장 하나만 잡힘)으로 세므로 시험·점검용이다 —
//   정식 집계는 에이전트 오피스 [배송조회 확인하기](서버 · delivery_shipments 표 · 엑셀 둘째 시트 기준)가 한다.
//   결과 = 직원 카톡 양식 한 줄(summary_text) + 상태별 건수 + 미배송·사고 표(수취인 이름 · 번호 끝 4자리 · 주소 시군구 · 기사). 전체 번호·상세 주소는 내지 않는다.
const fs = require('fs'), path = require('path');
const OUT = path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'akkome', '공유폴더_색인');
const INV_JSON = path.join(OUT, 'invoices.json'), ADDR_JSON = path.join(OUT, 'invoices-addr.json');
const args = process.argv.slice(2); const opt = { gap: 350 };
for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '--date') opt.date = args[++i]; else if (a === '--partner') opt.partner = args[++i]; else if (a === '--limit') opt.limit = +args[++i]; else if (a === '--gap') opt.gap = +args[++i]; else if (a === '--raw') opt.raw = true; else if (a === '--dry') opt.dry = true; else if (a === '--out') opt.out = args[++i]; else if (a === '--concurrency') opt.conc = Math.max(1, Math.min(10, +args[++i] || 1)); else if (a === '--no-cache') opt.noCache = true; else if (a === '--offset') opt.offset = +args[++i] || 0; }
if (!opt.date) opt.date = new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);   // 기본 = 어제(KST)
// --out 이면 전체 결과는 그 파일에만 쓰고(손님 정보 포함 — 저장소·OneDrive 밖에 둘 것) 화면에는 표(trouble)·예시를 뺀 요약만
const out = o => { if (opt.out && o.ok && o.queried) { fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true }); fs.writeFileSync(opt.out, JSON.stringify(o, null, 1)); o = Object.assign({}, o, { trouble: undefined, samples: undefined, trouble_count: (o.trouble || []).length, saved: path.resolve(opt.out) }); } console.log(JSON.stringify(o, null, 1)); };
const MAIN = require.main === module;   // 다른 도구(ship-status.js)가 trackOne 만 불러 쓸 수 있게
if (MAIN && !/^\d{4}-\d{2}-\d{2}$/.test(opt.date || '')) { out({ ok: false, error: '사용: ship-track.js --date 2026-10-07 [--partner 효돈] [--limit 10]' }); process.exit(1); }
if (MAIN && !fs.existsSync(INV_JSON)) { out({ ok: false, error: '송장 색인이 없습니다 — node scripts/desk/share-index.js 를 먼저 실행하세요' }); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 색인에서 그 날짜 운송장 모으기 ──
function collect() {
    const idx = JSON.parse(fs.readFileSync(INV_JSON, 'utf8'));
    let addr = null; try { addr = JSON.parse(fs.readFileSync(ADDR_JSON, 'utf8')).addr || null; } catch (e) { /* 주소 없이 진행 */ }
    const rows = []; let noTr = 0;
    idx.rows.forEach((r, i) => {
        if (r.d !== opt.date) return;
        if (opt.partner && !String(r.pt || '').includes(opt.partner)) return;
        // 한 분께 상자가 여럿이면 운송장도 여럿(trs · #582-b) — 운송장마다 한 줄로 센다
        const trList = (r.trs && r.trs.length ? r.trs : [r.tr]).map(x => String(x || '').replace(/\D/g, '')).filter(x => /^\d{10}(\d{2})?$/.test(x));
        if (!trList.length) { noTr++; return; }
        for (const tr of trList) rows.push({ tr, nm: r.nm || '', t1: r.t1 || '', pt: r.pt || '', op: r.op || '', q: r.q, ad: addr ? (addr[i] || '') : '' });
    });
    // 같은 운송장이 여러 줄(한 상자에 주문 줄 여럿)이면 한 번만 조회 · 같은 받는 분에게 송장이 여럿이면 「중복」으로 센다
    const byTr = new Map(); rows.forEach(r => { if (!byTr.has(r.tr)) byTr.set(r.tr, r); });
    const uniq = [...byTr.values()];
    const partners = {}; uniq.forEach(r => { partners[r.pt] = (partners[r.pt] || 0) + 1; });
    return { indexed_at: idx.at, rowsN: rows.length, noTr, uniq, sameTrRows: rows.length - uniq.length, partners };
}
// 「중복」 = 조회한 집합 안에서 같은 곳으로 가는 송장이 여럿인 것. 두 가지로 센다(직원 기준 확인 전): 같은 받는 분(이름+번호) / 같은 주소
function dupCount(list) {
    const cnt = keyOf => { const m = new Map(); list.forEach(r => { const k = keyOf(r); if (k) m.set(k, (m.get(k) || 0) + 1); }); let groups = 0, extra = 0, inGroups = 0; m.forEach(v => { if (v > 1) { groups++; extra += v - 1; inGroups += v; } }); return { groups, extra, in_groups: inGroups }; };
    return { person: cnt(r => r.nm + '|' + r.t1), phone: cnt(r => r.t1), address: cnt(r => String(r.ad || '').replace(/\s+/g, '')) };
}

// ── CJ 조회 = 서버와 같은 모듈(cj-track.js · 저장소 맨 위) — 조회·분류 코드를 여기 따로 두지 않는다 ──
const cj = require(path.join(__dirname, '..', '..', 'cj-track.js'));
const sigungu = ad => String(ad || '').trim().split(/\s+/).slice(0, 2).join(' ');
const tail4 = t => { const d = String(t || '').replace(/\D/g, ''); return d ? d.slice(-4) : ''; };

module.exports = { trackOne: cj.trackOne };
if (MAIN) (async () => {
    const t0 = Date.now(); const c = collect();
    let list = c.uniq; if (opt.offset) list = list.slice(opt.offset); if (opt.limit > 0) list = list.slice(0, opt.limit);
    const dup = dupCount(list);
    const base = { ok: true, date: opt.date, partner: opt.partner || '전체', provider: 'cjweb', indexed_at: c.indexed_at, index: { rows: c.rowsN, tracking_unique: c.uniq.length, same_tracking_rows: c.sameTrRows, no_tracking_rows: c.noTr, by_partner: c.partners }, dup };
    if (opt.dry) { out(base); return; }
    if (!list.length) { out(Object.assign(base, { ok: false, error: '그 날짜 운송장이 색인에 없습니다(파일 이름 날짜·Sheet2 운송장 확인)' })); return; }
    // 저장해 둔 결과(날짜별 · 운송장별) — 이미 「배송완료」로 확정된 운송장은 다시 묻지 않는다(--no-cache 면 전부 다시)
    const CACHE = path.join(OUT, '..', '배송조회', 'cache', opt.date + '.json'); let cache = {};
    if (!opt.noCache) { try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { cache = {}; } }
    const saveCache = () => { if (opt.noCache) return; try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(cache)); } catch (e) { /* 저장 실패는 조회를 막지 않는다 */ } };
    const res = new Array(list.length); const todo = []; let reused = 0;
    list.forEach((row, i) => { const cv = cache[row.tr]; if (cv && cv.bucket === '배송완료') { res[i] = cv; reused++; } else todo.push(i); });
    let next = 0, failRun = 0, stopped = null, asked = 0; const conc = opt.conc || 1;
    const worker = async () => {
        while (next < todo.length && !stopped) {
            const i = todo[next++]; const row = list[i]; const k = await cj.trackOne(row.tr); res[i] = k; asked++;
            if (k.bucket === '조회실패') { if (++failRun >= 3) stopped = { asked, of: todo.length, why: k.label }; } else { failRun = 0; cache[row.tr] = Object.assign({ at: Date.now() }, k); }
            if (asked % 100 === 0) { saveCache(); if (!opt.limit) process.stderr.write(asked + '/' + todo.length + ' ' + Math.round((Date.now() - t0) / 1000) + 's\n'); }
            if (next < todo.length) await sleep(opt.gap);
        }
    };
    await Promise.all(Array.from({ length: Math.min(conc, todo.length) }, worker)); saveCache();
    const counts = {}, rawDist = {}, trouble = [], samples = []; let done = 0;
    list.forEach((row, i) => {
        const k = res[i]; if (!k) return;   // 멈춘 뒤 못 물은 건
        counts[k.bucket] = (counts[k.bucket] || 0) + 1; done++;
        const rk = (k.code || '-') + ' ' + (k.label || ''); (rawDist[rk] = rawDist[rk] || { n: 0, bucket: k.bucket, example: String(k.msg || '').replace(/담당사원:[^)]*/, '담당사원:○○○ ***') }).n++;
        if (['미배송', '사고', '기타', '정보없음', '조회실패'].includes(k.bucket)) trouble.push({ bucket: k.bucket, tracking: row.tr.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3'), partner: row.pt, name: row.nm, phone_tail: tail4(row.t1), area: sigungu(row.ad), option: row.op, status: k.label, message: k.msg, at: k.time, branch: k.branch, driver: k.driver });
        if (opt.raw && samples.length < 10) samples.push({ partner: row.pt, last: { code: k.code, label: k.label, msg: k.msg, at: k.time, branch: k.branch }, has_driver: !!k.driver, events: k.events });
    });
    const n = b => counts[b] || 0; const md = opt.date.slice(5).replace('-', '/');
    const etc = ['집화', '기타', '정보없음', '조회실패'].filter(b => n(b)).map(b => b + ' ' + n(b)).join(' / ');
    const summary = `${md} 발송 ${done.toLocaleString()}건 (중복 ${dup.person.extra}건)\n배송완료 ${n('배송완료')} / 배송출발 ${n('배송출발')} / 간선상하차 ${n('간선상하차')} / 미배송 ${n('미배송')} / 사고 ${n('사고')}` + (etc ? '\n(' + etc + ')' : '');
    out(Object.assign(base, { queried: done, asked, reused_delivered: reused, concurrency: conc, stopped, seconds: Math.round((Date.now() - t0) / 1000), counts, raw_status: rawDist, summary_text: summary, trouble, samples: opt.raw ? samples : undefined }));
})().catch(e => { out({ ok: false, error: String(e && e.message || e) }); process.exit(3); });
