// #582 공유폴더 색인 — 사용: node scripts/desk/share-index.js [--update] [--files-only] [--status]
//   대상 = 사무실 공유 서버 \\192.168.0.10\공유폴더 (전 직원 공유 · 대표 확정 2026-10-08 「지금 자료는 다 공유돼도 돼」).
//   만드는 것(대표 PC 비공개 폴더 · 저장소 제외 · 손님 정보가 들어 있으므로 DB·리포에 넣지 않는다):
//     ★에이전트오피스/비공개/공유폴더_색인/files.json     — 공유폴더 전체 파일 이름·경로·크기·수정 시각(파일 찾기용)
//     ★에이전트오피스/비공개/공유폴더_색인/invoices.json  — ★송장 엑셀(Sheet1)의 줄 = 날짜·거래처·수취인·연락처(숫자만)·옵션·수량·주소·송장번호·파일(주문 이력 찾기용)
//   --update(기본): 파일 목록은 매번 새로 걷고, 송장 엑셀은 수정 시각이 바뀐 파일만 다시 읽는다(첫 실행 3,500여 파일 10~20분 · 그 뒤 몇 초).
//   share-find.js · invoice-find.js 가 색인이 60분 넘게 오래됐으면 이 스크립트를 먼저 부른다.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SHARE = process.env.AKM_SHARE || '\\\\192.168.0.10\\공유폴더';
const INV_DIR = path.join(SHARE, '★송장');
// 🔴 색인은 OneDrive 밖(로컬 앱 데이터)에 둔다 — 손님 이름·번호·주소 78만 줄이라 클라우드 동기화·저장소 어디에도 올리지 않는다(워커2 지적 10/8)
const OUT = path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'akkome', '공유폴더_색인');
const FILES_JSON = path.join(OUT, 'files.json'), INV_JSON = path.join(OUT, 'invoices.json'), INV_ADDR_JSON = path.join(OUT, 'invoices-addr.json');   // 주소는 따로(invoice-find 가 --addr 일 때만 읽음 · 색인 400MB → 절반)
const digits = s => String(s == null ? '' : s).replace(/\D/g, '');
const cellStr = v => { if (v == null) return ''; if (typeof v === 'object') { if (v.richText) return v.richText.map(t => t.text).join(''); if (v.result !== undefined) return cellStr(v.result); if (v.text) return String(v.text); if (v instanceof Date) return v.toISOString().slice(0, 10); } return String(v).trim(); };

function walk(dir, out, rel) {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (const e of ents) {
        if (e.name === 'Thumbs.db' || e.name === 'desktop.ini' || /^~\$/.test(e.name)) continue;
        const p = path.join(dir, e.name), r = rel ? rel + '\\' + e.name : e.name;
        if (e.isDirectory()) walk(p, out, r);
        else { let st; try { st = fs.statSync(p); } catch (_) { continue; } out.push({ p: r, n: e.name, s: st.size, m: Math.round(st.mtimeMs) }); }
    }
    return out;
}
// 파일 이름·폴더에서 날짜·거래처 뽑기 — 「제주아꼼이네송장(대성)10.07.xlsx」 + 폴더 「2026대성」 / 「2025\2025효돈」 / 「2020\…12.08일 1차」
function metaOf(rel) {
    const parts = rel.split('\\'); const name = parts[parts.length - 1];
    let year = null; for (const seg of parts) { const m = seg.match(/(20\d\d)/); if (m) { year = +m[1]; break; } }
    const md = name.match(/(\d{1,2})\s*[.\-_]\s*(\d{1,2})(?!\d)/); const ymd = name.match(/(\d{2})(\d{2})(\d{2})(?!\d)/);
    let date = null;
    if (md && year) date = `${year}-${String(+md[1]).padStart(2, '0')}-${String(+md[2]).padStart(2, '0')}`;
    else if (ymd) date = `20${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    let partner = null; const all = parts.join(' ');
    if (/효돈/.test(all)) partner = '효돈농협'; else if (/대성/.test(all)) partner = '대성(시온)'; else if (/길영/.test(all)) partner = '길영'; else if (/옥수수|초당/.test(all)) partner = '초당옥수수'; else if (/취나물/.test(all)) partner = '취나물'; else if (/산하홍/.test(all)) partner = '산하홍'; else if (/단체/.test(all)) partner = '단체'; else if (/쿠팡/.test(all)) partner = '쿠팡리뷰건';
    return { year, date, partner };
}
const FMT = 2;   // 색인 줄 형식 — 올리면 옛 형식 파일을 다시 읽는다
async function readInvoice(absPath, rel) {
    const ExcelJS = require(path.join(ROOT, 'node_modules', 'exceljs'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(absPath);
    const meta = metaOf(rel); const rows = [];
    const ws = wb.worksheets[0]; if (!ws) return rows;
    // 머리글 찾기(첫 6행 안)
    let headRow = 0, col = {};
    for (let r = 1; r <= Math.min(6, ws.rowCount) && !headRow; r++) {
        const vals = ws.getRow(r).values; const map = {};
        vals.forEach((v, i) => { const s = cellStr(v).replace(/\s/g, ''); if (s) map[s] = i; });
        if (map['수취인명'] || map['고객명/수신인'] || map['받는분']) { headRow = r; col = map; }
    }
    if (!headRow) return rows;
    const pick = (row, keys) => { for (const k of keys) if (col[k]) return cellStr(row.getCell(col[k]).value); return ''; };
    // 2번째 시트(택배사 접수 목록 · 운송장 한 줄 = 상자 하나)의 운송장번호를 받는분 전화+이름으로 모은다.
    //   #582-b: 한 분께 상자가 둘 이상 가면 운송장도 여럿이다 — 종전에는 첫 운송장만 남겨 나머지가 빠졌다(10/07 실측 75건). 이제 전부 모아 주문 줄에 나눠 붙인다.
    const tracking = {};   // 키 → [{ no, pn(상품명), used }]
    const ws2 = wb.worksheets[1];
    if (ws2) {
        let h2 = 0, c2 = {};
        for (let r = 1; r <= Math.min(6, ws2.rowCount) && !h2; r++) { const map = {}; ws2.getRow(r).values.forEach((v, i) => { const s = cellStr(v).replace(/\s/g, ''); if (s) map[s] = i; }); if (map['운송장번호']) { h2 = r; c2 = map; } }
        if (h2) {
            const telCol = c2['받는분전화번호'] || c2['수취인연락처1']; const nameCol = c2['받는분'] || c2['수취인명'];
            for (let r = h2 + 1; r <= ws2.rowCount; r++) {
                const row = ws2.getRow(r); const no = cellStr(row.getCell(c2['운송장번호']).value); if (!no) continue;
                const key = digits(telCol ? row.getCell(telCol).value : '') + '|' + (nameCol ? cellStr(row.getCell(nameCol).value) : '');
                const pnCol = c2['상품명'] || c2['단품명']; const pn = pnCol ? cellStr(row.getCell(pnCol).value).replace(/\s+/g, '') : '';
                (tracking[key] = tracking[key] || []).push({ no, pn, used: false });
            }
        }
    }
    for (let r = headRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const name = pick(row, ['수취인명', '고객명/수신인', '받는분']); const opt = pick(row, ['옵션정보', '상품명', '품목']);
        if (!name && !opt) continue;
        const t1 = digits(pick(row, ['수취인연락처1', '연락처', '받는분전화번호'])), t2 = digits(pick(row, ['수취인연락처2'])), tb = digits(pick(row, ['구매자연락처']));
        rows.push({ f: rel, d: meta.date, y: meta.year, pt: meta.partner, nm: name, t1, t2, tb, op: opt, q: pick(row, ['수량']), ad: pick(row, ['배송지', '주소']), ms: pick(row, ['배송메세지', '배송메시지']).slice(0, 80), sn: pick(row, ['보내는사람', '보내는사람/발송인']), tr: '', _k: t1 + '|' + name });
    }
    // 주문 줄에 운송장 나눠 붙이기: ①상품명이 그 줄의 옵션과 같은 운송장을 수량만큼 ②그렇게 못 붙인 줄은 그 받는 분의 남은 운송장 전부(남은 것이 없으면 = 한 상자에 여러 줄 → 그 받는 분 운송장 전부)
    //   tr = 첫 운송장(종전 칸 · 다른 도구 호환) · trs = 둘 이상일 때만 전체 목록
    const put = (r, list) => { const nos = [...new Set(list.map(t => t.no))]; r.tr = nos[0] || ''; if (nos.length > 1) r.trs = nos; };
    const later = [];
    for (const r of rows) {
        const T = tracking[r._k]; if (!T) continue;
        const want = Math.max(1, parseInt(r.q, 10) || 1); const o = String(r.op || '').replace(/\s+/g, ''); const got = [];
        for (const t of T) { if (got.length >= want) break; if (!t.used && t.pn && t.pn === o) { t.used = true; got.push(t); } }
        if (got.length) put(r, got); else later.push(r);
    }
    for (const r of later) { const T = tracking[r._k]; const rest = T.filter(t => !t.used); put(r, rest.length ? rest : T); }
    for (const r of later) for (const t of tracking[r._k]) t.used = true;
    // 어느 줄에도 못 붙은 운송장(상품명이 달라 남은 것)은 그 받는 분의 첫 줄에 보탠다 — 색인에서 운송장이 빠지지 않게
    const firstOf = {}; for (const r of rows) if (!(r._k in firstOf)) firstOf[r._k] = r;
    for (const k of Object.keys(tracking)) { const left = tracking[k].filter(t => !t.used); const r = firstOf[k]; if (left.length && r) put(r, [...(r.trs || (r.tr ? [r.tr] : [])).map(no => ({ no })), ...left]); }
    for (const r of rows) delete r._k;
    return rows;
}
async function main() {
    const args = process.argv.slice(2);
    if (!fs.existsSync(SHARE)) { console.log(JSON.stringify({ ok: false, error: '공유폴더에 닿지 않습니다(' + SHARE + ') — 사무실 네트워크 연결을 확인하세요' })); process.exit(2); }
    fs.mkdirSync(OUT, { recursive: true });
    if (args.includes('--status')) {
        const st = p => fs.existsSync(p) ? { at: new Date(fs.statSync(p).mtimeMs).toISOString(), bytes: fs.statSync(p).size } : null;
        const inv = fs.existsSync(INV_JSON) ? JSON.parse(fs.readFileSync(INV_JSON, 'utf8')) : null;
        console.log(JSON.stringify({ ok: true, files: st(FILES_JSON), invoices: st(INV_JSON), invoice_files: inv ? Object.keys(inv.files).length : 0, invoice_rows: inv ? inv.rows.length : 0 }));
        return;
    }
    const t0 = Date.now();
    const files = walk(SHARE, [], '');
    fs.writeFileSync(FILES_JSON, JSON.stringify({ at: new Date().toISOString(), share: SHARE, count: files.length, files }));
    const out = { ok: true, files: files.length, files_ms: Date.now() - t0 };
    if (!args.includes('--files-only')) {
        const prev = fs.existsSync(INV_JSON) ? JSON.parse(fs.readFileSync(INV_JSON, 'utf8')) : { files: {}, rows: [] };
        const prevAddr = fs.existsSync(INV_ADDR_JSON) ? JSON.parse(fs.readFileSync(INV_ADDR_JSON, 'utf8')).addr : [];
        prev.rows.forEach((r, i) => { if (r.ad === undefined) r.ad = prevAddr[i] || ''; });   // 주소를 다시 붙여 파일별 보존
        const keep = {}, rowsByFile = {};
        for (const r of prev.rows) (rowsByFile[r.f] = rowsByFile[r.f] || []).push(r);
        const xl = files.filter(f => f.p.startsWith('★송장\\') && /\.xlsx$/i.test(f.n));
        let read = 0, failed = 0, newRows = [];
        for (const f of xl) {
            const old = prev.files[f.p];
            // 형식 v2(#582-b 운송장 전부): 옛 형식으로 읽어 둔 파일 중 운송장이 붙어 있던 파일만 한 번 다시 읽는다(운송장 없는 파일은 달라질 것이 없어 그대로)
            const same = old && old.m === f.m && old.s === f.s;
            if (same && (old.v === FMT || !(rowsByFile[f.p] || []).some(r => r.tr))) { keep[f.p] = Object.assign({}, old, { v: FMT }); newRows.push(...(rowsByFile[f.p] || [])); continue; }
            try { const rows = await readInvoice(path.join(SHARE, f.p), f.p); keep[f.p] = { m: f.m, s: f.s, n: rows.length, v: FMT }; newRows.push(...rows); read++; }
            catch (e) { if (same) { keep[f.p] = old; newRows.push(...(rowsByFile[f.p] || [])); } else keep[f.p] = { m: f.m, s: f.s, n: 0, err: String(e.message).slice(0, 80) }; failed++; }
            if (read && read % 200 === 0) process.stderr.write(`  …송장 ${read}개 읽음\n`);
        }
        const addr = newRows.map(r => r.ad || ''); const slim = newRows.map(r => { const { ad, ...rest } = r; return rest; });
        fs.writeFileSync(INV_ADDR_JSON, JSON.stringify({ at: new Date().toISOString(), addr }));
        fs.writeFileSync(INV_JSON, JSON.stringify({ at: new Date().toISOString(), files: keep, rows: slim }));
        Object.assign(out, { invoice_files: xl.length, invoice_read_now: read, invoice_failed: failed, invoice_rows: newRows.length, total_ms: Date.now() - t0 });
    }
    console.log(JSON.stringify(out));
}
main().catch(e => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
