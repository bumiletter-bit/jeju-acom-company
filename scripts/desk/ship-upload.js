// #594 송장 올리기 — 사용: node scripts/desk/ship-upload.js [--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD | --days 3] [--no-update] [--dry]
//   송장 색인(share-index.js · %LOCALAPPDATA%\akkome\공유폴더_색인)에서 그 날짜의 운송장 줄을 DB 표 delivery_shipments 에 올린다(있으면 덮어씀).
//   서버(에이전트 오피스 [배송조회 확인하기])가 이 표의 운송장으로 CJ 배송 상태를 묻는다 — 이 도구는 「어떤 운송장이 언제 나갔나」만 올린다. 조회·발송 0.
//   기본 = 어제 하루. --days N = 오늘까지 최근 N일(오늘 · 어제 · …). 색인이 60분 넘게 오래됐으면 share-index.js 를 먼저 돌린다(바뀐 엑셀만 다시 읽음 · 1~2분).
//   같은 운송장이 여러 줄(한 상자에 주문 줄 여럿)이면 옵션을 「 + 」로 잇고 수량을 더해 한 줄로 올린다. 번호·주소는 전체를 올린다(CS 연락용 · 화면이 가린다).
//   색인(324MB)을 통째로 읽지 않고 흘려 읽어 메모리 옵션 없이 돈다. 다른 도구(ship-status.js)가 scanRows·readAddrs 를 불러 쓴다.
//   #610-C: 구매자 번호(색인 tb)도 함께 올린다 — 표에 buyer_phone 칸이 있을 때만(없으면 종전 문장 그대로). 운송장 시트에는 구매자 번호가 없어
//   「받는 분 번호 + 이름」으로 첫 시트 줄과 맞춘다(같은 열쇠에 구매자가 둘이면 비움). 종전 9칸 값은 그대로다 — `--dry --compare` 가 DB 에 있는 줄과 견줘 준다(SELECT 만).
const fs = require('fs'), path = require('path'); const { execFileSync } = require('child_process');
const { makeBuyerIndex } = require(path.join(__dirname, '..', '..', 'sms', 'lookup.js'));
const OUT = path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'akkome', '공유폴더_색인');
const INV_JSON = path.join(OUT, 'invoices.json'), ADDR_JSON = path.join(OUT, 'invoices-addr.json');
const DDL = [
    `CREATE TABLE IF NOT EXISTS delivery_shipments (
  tracking text PRIMARY KEY, ship_date date NOT NULL, partner text, recipient text, phone text, addr text,
  option_text text, qty integer, memo text, source text DEFAULT 'index', uploaded_at timestamptz DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS idx_delivery_shipments_date ON delivery_shipments(ship_date)`,
    `CREATE TABLE IF NOT EXISTS delivery_status (
  tracking text PRIMARY KEY, bucket text, code text, label text, msg text, event_time text, branch text,
  driver_name text, driver_phone text, events jsonb, delivered boolean DEFAULT false,
  checked_at timestamptz DEFAULT now(), first_trouble_at timestamptz)`,
];
async function ensureTables(pool) { for (const q of DDL) await pool.query(q); }

// ── 색인 흘려 읽기 ──  invoices.json = {"at":…,"files":{…},"rows":[{…},{…},…]} 한 줄짜리. 글자열 밖의 괄호 깊이만 세어 rows 안의 객체를 하나씩 꺼낸다.
//   want(buf) 가 참인 객체만 JSON.parse 해서 onRow(row, 순번) 에 넘긴다(순번 = rows 안 자리 · 주소 파일과 같은 순서). UTF-8 여러 바이트 글자는 " { } [ ] \ 와 겹치지 않아 바이트로 세어도 안전하다.
function scanRows(want, onRow) {
    return new Promise((resolve, reject) => {
        let depth = 0, inStr = false, esc = false, inRows = false, idx = -1, total = 0;
        let carry = null, start = -1;   // 열려 있는 객체의 앞부분(청크 경계를 넘을 때)
        const rs = fs.createReadStream(INV_JSON, { highWaterMark: 4 << 20 });
        rs.on('data', chunk => {
            let buf = chunk, i = 0;
            if (carry) { buf = Buffer.concat([carry, chunk]); i = carry.length; start = 0; carry = null; }
            for (const n = buf.length; i < n; i++) {
                const c = buf[i];
                if (inStr) { if (esc) esc = false; else if (c === 92) esc = true; else if (c === 34) inStr = false; continue; }
                if (c === 34) inStr = true;
                else if (c === 123) { if (inRows && depth === 2) { start = i; idx++; } depth++; }
                else if (c === 125) {
                    depth--;
                    if (inRows && depth === 2 && start >= 0) { const ob = buf.subarray(start, i + 1); start = -1; total++; if (want(ob)) { try { onRow(JSON.parse(ob.toString('utf8')), idx); } catch (e) { /* 깨진 줄은 건너뜀 */ } } }
                }
                else if (c === 91) { if (depth === 1) inRows = true; depth++; }
                else if (c === 93) { depth--; if (depth === 1) inRows = false; }
            }
            if (start >= 0) { carry = Buffer.from(buf.subarray(start)); start = -1; }
        });
        rs.on('end', () => resolve(total)); rs.on('error', reject);
    });
}
// invoices-addr.json = {"addr":["주소","주소",…]} — 순번이 need(Set) 에 든 것만 꺼낸다. 돌려주는 값 = Map(순번 → 주소)
function readAddrs(need) {
    return new Promise(resolve => {
        const got = new Map(); if (!need.size || !fs.existsSync(ADDR_JSON)) return resolve(got);
        let depth = 0, inStr = false, esc = false, inArr = false, idx = 0, parts = null;
        const rs = fs.createReadStream(ADDR_JSON, { highWaterMark: 4 << 20 });
        rs.on('data', buf => {
            let s = parts ? 0 : -1;
            for (let i = 0, n = buf.length; i < n; i++) {
                const c = buf[i];
                if (inStr) {
                    if (esc) esc = false; else if (c === 92) esc = true;
                    else if (c === 34) { inStr = false; if (parts) { parts.push(buf.subarray(s, i + 1)); try { got.set(idx, JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (e) { /* 건너뜀 */ } parts = null; s = -1; } }
                    continue;
                }
                if (c === 34) { inStr = true; if (inArr && depth === 2 && need.has(idx)) { parts = []; s = i; } }
                else if (c === 44) { if (inArr && depth === 2) idx++; }
                else if (c === 123 || c === 91) { if (c === 91 && depth === 1) { inArr = true; idx = 0; } depth++; }
                else if (c === 125 || c === 93) { depth--; if (depth === 1) inArr = false; }
            }
            if (parts && s >= 0) parts.push(Buffer.from(buf.subarray(s)));
        });
        rs.on('end', () => resolve(got)); rs.on('error', () => resolve(got));
    });
}
// 색인이 없으면 만들고, 60분 넘게 오래됐으면 새로 만든 뒤 읽는다(올리기는 최신 파일이 중요하다 — invoice-find 처럼 뒤에서 돌리지 않고 기다린다)
function refreshIndex(force) {
    const old = !fs.existsSync(INV_JSON) || Date.now() - fs.statSync(INV_JSON).mtimeMs > 60 * 60 * 1000;
    if (!old && !force) return { refreshed: false };
    try { execFileSync(process.execPath, [path.join(__dirname, 'share-index.js')], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30 * 60 * 1000, windowsHide: true }); return { refreshed: true }; }
    catch (e) { return { refreshed: false, index_error: String(e && e.message || e).slice(0, 160) }; }   // 공유폴더에 못 닿아도 있던 색인으로 계속
}
// 송장 엑셀의 둘째 시트(택배사 접수 목록)를 직접 읽는다 — 운송장 한 줄 = 상자 하나.
//   색인은 운송장을 「받는 분 전화+이름」으로 맞춰 붙여서, 한 분께 상자가 둘 이상 가면 운송장 하나만 남는다(10/07 실측: 실제 1,684 · 색인 1,609).
//   그래서 올릴 때는 색인으로 「그 날짜 파일이 어느 것인지」만 찾고, 운송장은 파일에서 읽는다. 둘째 시트가 없거나 운송장이 없으면 null(→ 색인 줄로 대신).
const SHARE = process.env.AKM_SHARE || '\\\\192.168.0.10\\공유폴더';
const cellStr = v => { if (v == null) return ''; if (typeof v === 'object') { if (v.richText) return v.richText.map(t => t.text).join(''); if (v.result !== undefined) return cellStr(v.result); if (v.text) return String(v.text); if (v instanceof Date) return v.toISOString().slice(0, 10); return ''; } return String(v); };
async function readSheet2(rel) {
    const ExcelJS = require(path.join(__dirname, '..', '..', 'node_modules', 'exceljs'));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(SHARE, rel));
    const ws = wb.worksheets[1]; if (!ws) return null;
    let head = 0, col = {};
    for (let r = 1; r <= Math.min(5, ws.rowCount) && !head; r++) { const m = {}; ws.getRow(r).eachCell((c, i) => { const k = cellStr(c.value).replace(/\s/g, ''); if (k) m[k] = i; }); if (m['운송장번호']) { head = r; col = m; } }
    if (!head) return null;
    const get = (row, keys) => { for (const k of keys) if (col[k]) { const v = cellStr(row.getCell(col[k]).value).trim(); if (v) return v; } return ''; };
    const out = [];
    for (let r = head + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r); const tr = get(row, ['운송장번호']).replace(/\D/g, ''); if (!/^\d{10}(\d{2})?$/.test(tr)) continue;
        out.push({ tr, nm: get(row, ['받는분']) || null, ph: get(row, ['받는분전화번호']).replace(/\D/g, '') || null, ad: get(row, ['받는분주소']) || null, op: get(row, ['상품명', '단품명']) || null, qty: parseInt(get(row, ['내품수량', '수량']), 10) || 1, ms: get(row, ['배송메시지']) || null });
    }
    return out.length ? out : null;
}
const kstDay = off => new Date(Date.now() + 9 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
function daysBetween(a, b) { const out = []; for (let t = Date.parse(a + 'T00:00:00Z'); t <= Date.parse(b + 'T00:00:00Z') && out.length < 62; t += 86400e3) out.push(new Date(t).toISOString().slice(0, 10)); return out; }

module.exports = { scanRows, readAddrs, refreshIndex, ensureTables, kstDay, INV_JSON, DDL };

if (require.main === module) (async () => {
    const args = process.argv.slice(2); const opt = {};
    for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '--date') opt.date = args[++i]; else if (a === '--from') opt.from = args[++i]; else if (a === '--to') opt.to = args[++i]; else if (a === '--days') opt.days = +args[++i]; else if (a === '--no-update') opt.noUpdate = true; else if (a === '--dry') opt.dry = true; else if (a === '--compare') opt.compare = true; }
    const say = o => console.log(JSON.stringify(o, null, 1));
    let dates;
    if (opt.date) dates = [opt.date];
    else if (opt.from || opt.to) dates = daysBetween(opt.from || opt.to, opt.to || opt.from);
    else if (opt.days > 0) dates = daysBetween(kstDay(-(Math.min(opt.days, 31) - 1)), kstDay(0));
    else dates = [kstDay(-1)];
    if (!dates.length || !dates.every(isDay)) { say({ ok: false, error: '사용: ship-upload.js [--date YYYY-MM-DD | --from A --to B | --days 3]' }); process.exit(1); }
    const t0 = Date.now(); const idxInfo = opt.noUpdate ? { refreshed: false } : refreshIndex(false);
    if (!fs.existsSync(INV_JSON)) { say({ ok: false, error: '송장 색인이 없습니다 — 공유폴더(사무실 네트워크) 연결을 확인하고 node scripts/desk/share-index.js 를 먼저 실행하세요', detail: idxInfo.index_error }); process.exit(2); }
    const needles = dates.map(d => Buffer.from('"d":"' + d + '"')); const set = new Set(dates);
    const byTr = new Map(); const perDate = {}; let rows = 0, noTr = 0; const files = new Map();   // 파일 → { d, pt }
    const bidx = makeBuyerIndex();   // #610-C 파일 안에서 「받는 분 번호 + 이름 → 구매자 번호」
    await scanRows(ob => needles.some(nd => ob.includes(nd)), (r, i) => {
        if (!set.has(r.d)) return;
        rows++; const pd = perDate[r.d] = perDate[r.d] || { rows: 0, tracking: 0, no_tracking: 0 }; pd.rows++;
        if (r.f && !files.has(r.f)) files.set(r.f, { d: r.d, pt: r.pt || null });
        bidx.add(r.f, r.t1, r.nm, r.tb);
        // 색인 줄의 운송장: trs(한 분께 상자 여럿 · #582-b) 가 있으면 전부, 없으면 tr 하나. 여럿이면 수량은 상자마다 1로 본다
        const trList = (r.trs && r.trs.length ? r.trs : [r.tr]).map(x => String(x || '').replace(/\D/g, '')).filter(x => /^\d{10}(\d{2})?$/.test(x));
        if (!trList.length) { noTr++; pd.no_tracking++; return; }
        for (const tr of trList) {
            const q = trList.length > 1 ? 1 : (parseInt(r.q, 10) || 0); const cur = byTr.get(tr);
            if (cur) { if (r.op && !cur.opts.includes(r.op)) cur.opts.push(r.op); cur.qty += q; }
            else { pd.tracking++; byTr.set(tr, { tr, f: r.f, d: r.d, pt: r.pt || null, nm: r.nm || null, ph: String(r.t1 || r.tb || '').replace(/\D/g, '') || null, opts: r.op ? [r.op] : [], qty: q, ms: r.ms || null, i, t1: r.t1 || '' }); }
        }
    });
    // 파일마다 둘째 시트를 직접 읽어 그 파일의 운송장을 통째로 바꿔 넣는다(읽히면 색인 줄은 버림 · 안 읽히면 색인 줄 그대로)
    const fileInfo = [];
    for (const [rel, meta] of files) {
        let s2 = null, err; try { s2 = await readSheet2(rel); } catch (e) { err = String(e && e.message || e).slice(0, 100); }
        const fromIdx = [...byTr.values()].filter(x => x.f === rel).length;
        if (s2) {
            for (const [k, v] of byTr) if (v.f === rel) byTr.delete(k);
            for (const x of s2) byTr.set(x.tr, { tr: x.tr, f: rel, d: meta.d, pt: meta.pt, nm: x.nm, ph: x.ph, ad: x.ad, opts: x.op ? [x.op] : [], qty: x.qty, ms: x.ms, i: -1 });
            const pd = perDate[meta.d]; pd.tracking += s2.length - fromIdx;
        }
        fileInfo.push({ file: path.basename(rel), date: meta.d, from: s2 ? '둘째 시트' : '색인', tracking: s2 ? s2.length : fromIdx, index_tracking: fromIdx, error: err });
    }
    const list = [...byTr.values()];
    // #610-C 구매자 번호 붙이기 — 색인 줄은 그 줄의 받는 분 번호(t1)로, 둘째 시트 줄은 시트의 받는 분 번호로 찾는다
    const buyer = { one: 0, ambiguous: 0, none: 0, same_as_recipient: 0, differs: 0, safe_recipient: 0, safe_recipient_with_buyer: 0 };
    for (const x of list) {
        const hit = bidx.find(x.f, x.i >= 0 ? x.t1 : x.ph, x.nm); x.bp = hit.buyer; buyer[hit.why]++;
        if (x.bp) { if (x.bp === String(x.ph || '')) buyer.same_as_recipient++; else buyer.differs++; }
        if (/^050/.test(String(x.ph || ''))) { buyer.safe_recipient++; if (x.bp) buyer.safe_recipient_with_buyer++; }
    }
    buyer.filled_pct = list.length ? +(buyer.one / list.length * 100).toFixed(1) : 0;
    const addrs = await readAddrs(new Set(list.filter(x => x.i >= 0).map(x => x.i)));
    const base = { ok: true, dates, index_refreshed: !!idxInfo.refreshed, index_error: idxInfo.index_error, rows, tracking: list.length, no_tracking_rows: noTr, by_date: perDate, files: fileInfo };
    base.buyer = buyer;
    const legacy = x => [x.tr, x.d, x.pt, x.nm, x.ph, x.ad || addrs.get(x.i) || null, x.opts.join(' + ') || null, x.qty, x.ms];   // 종전 9칸(올리는 값 그대로)
    if (opt.dry) {
        const out = Object.assign(base, { dry: true, addr_found: list.filter(x => x.ad || addrs.get(x.i)).length });
        if (opt.compare) {   // DB 에 있는 줄(종전 코드가 올린 것)과 종전 9칸을 견준다 — SELECT 만 · 값은 내지 않고 건수만
            const { pool } = require('./_db');
            try {
                const db = await pool.query(`SELECT tracking, ship_date::text AS d, partner, recipient, phone, addr, option_text, qty, memo, source FROM delivery_shipments WHERE ship_date = ANY($1::date[])`, [dates]);
                const by = new Map(db.rows.map(r => [r.tracking, r])); const cols = ['tracking', 'd', 'partner', 'recipient', 'phone', 'addr', 'option_text', 'qty', 'memo'];
                const cmp = { db_rows: db.rows.length, new_rows: list.length, same: 0, diff: 0, missing_in_db: 0, only_in_db: 0, diff_by_col: {}, diff_by_source: {} };
                const seen = new Set();
                for (const x of list) {
                    const r = by.get(x.tr); if (!r) { cmp.missing_in_db++; continue; } seen.add(x.tr);
                    const v = legacy(x); const bad = cols.filter((c, i) => (v[i] == null ? null : v[i]) !== (r[c] == null ? null : r[c]));
                    if (!bad.length) cmp.same++; else { cmp.diff++; for (const c of bad) cmp.diff_by_col[c] = (cmp.diff_by_col[c] || 0) + 1; cmp.diff_by_source[r.source || ''] = (cmp.diff_by_source[r.source || ''] || 0) + 1; }
                }
                cmp.only_in_db = db.rows.filter(r => !seen.has(r.tracking)).length;
                out.compare = cmp;
            } finally { await pool.end(); }
        }
        say(Object.assign(out, { seconds: Math.round((Date.now() - t0) / 1000) })); return;
    }
    const { pool } = require('./_db');
    try {
        await ensureTables(pool); let upserted = 0;
        // #610-C 표에 buyer_phone 칸이 생긴 뒤(서버 배포 뒤)에만 구매자 번호를 올린다 — 칸이 없으면 아래 종전 문장 그대로
        const hasBuyer = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'delivery_shipments' AND column_name = 'buyer_phone'`)).rowCount > 0;
        base.buyer_column = hasBuyer;
        for (let k = 0; k < list.length; k += 500) {
            const part = list.slice(k, k + 500);
            if (hasBuyer) {   // 종전 9칸은 아래 문장과 같고 buyer_phone 만 더한다(새로 못 찾은 날에 있던 값을 지우지 않는다)
                const res2 = await pool.query(
                    `INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, addr, option_text, qty, memo, buyer_phone, source, uploaded_at)
                     SELECT t, d::date, pt, nm, ph, ad, op, q, ms, bp, 'index', now()
                       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::text[], $10::text[]) AS x(t, d, pt, nm, ph, ad, op, q, ms, bp)
                     ON CONFLICT (tracking) DO UPDATE SET ship_date = EXCLUDED.ship_date, partner = EXCLUDED.partner, recipient = EXCLUDED.recipient, phone = EXCLUDED.phone, addr = EXCLUDED.addr,
                            option_text = EXCLUDED.option_text, qty = EXCLUDED.qty, memo = EXCLUDED.memo, buyer_phone = COALESCE(EXCLUDED.buyer_phone, delivery_shipments.buyer_phone), source = 'index', uploaded_at = now()`,
                    [...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(c => part.map(x => legacy(x)[c])), part.map(x => x.bp || null)]);
                upserted += res2.rowCount; continue;
            }
            const res = await pool.query(
                `INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, addr, option_text, qty, memo, source, uploaded_at)
                 SELECT t, d::date, pt, nm, ph, ad, op, q, ms, 'index', now()
                   FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::text[]) AS x(t, d, pt, nm, ph, ad, op, q, ms)
                 ON CONFLICT (tracking) DO UPDATE SET ship_date = EXCLUDED.ship_date, partner = EXCLUDED.partner, recipient = EXCLUDED.recipient, phone = EXCLUDED.phone, addr = EXCLUDED.addr,
                        option_text = EXCLUDED.option_text, qty = EXCLUDED.qty, memo = EXCLUDED.memo, source = 'index', uploaded_at = now()`,
                [part.map(x => x.tr), part.map(x => x.d), part.map(x => x.pt), part.map(x => x.nm), part.map(x => x.ph), part.map(x => x.ad || addrs.get(x.i) || null), part.map(x => x.opts.join(' + ') || null), part.map(x => x.qty), part.map(x => x.ms)]);
            upserted += res.rowCount;
        }
        const cnt = await pool.query(`SELECT ship_date::text AS d, count(*)::int AS n FROM delivery_shipments WHERE ship_date = ANY($1::date[]) GROUP BY 1 ORDER BY 1`, [dates]);
        say(Object.assign(base, { upserted, in_db: Object.fromEntries(cnt.rows.map(r => [r.d, r.n])), seconds: Math.round((Date.now() - t0) / 1000) }));
    } finally { await pool.end(); }
})().catch(e => { console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) })); process.exit(3); });
