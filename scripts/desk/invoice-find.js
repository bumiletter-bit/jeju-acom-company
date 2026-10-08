// #582 송장 주문 이력 찾기 — 사용: node scripts/desk/invoice-find.js "<전화번호 | 이름>" [--year 2025] [--addr] [--limit 40]
//   ★송장 엑셀 색인(share-index.js · 비공개 폴더)에서 찾는다. 번호는 숫자만 비교(「010-1234-5678」·「01012345678」·끝 4자리만 「5678」도 됨 — 끝자리만이면 여러 손님이 걸릴 수 있다).
//   이름은 수취인명 그대로(부분 일치). 결과 = 날짜 최근 순 · 날짜·거래처·수취인·옵션·수량·송장번호·파일. 주소는 --addr 를 붙였을 때만 나온다(직원이 꼭 필요할 때만).
//   한 분께 상자가 둘 이상 갔으면 송장번호가 「a, b」로 여럿 나온다(#582-b).
//   색인이 60분 넘게 오래됐으면 share-index.js 를 먼저 돌린다(바뀐 엑셀만 다시 읽어 몇 초).
const fs = require('fs'), path = require('path'); const { execFileSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'akkome', '공유폴더_색인'); const INV_JSON = path.join(OUT, 'invoices.json');   // OneDrive 밖(share-index.js 와 같은 자리)
const args = process.argv.slice(2); const opt = {}; const terms = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--year') opt.year = +args[++i]; else if (args[i] === '--addr') opt.addr = true; else if (args[i] === '--limit') opt.limit = +args[++i]; else if (args[i] === '--no-update') opt.noUpdate = true; else terms.push(args[i].trim()); }
const term = terms.join(' ').trim();
if (!term) { console.log(JSON.stringify({ ok: false, error: '사용: invoice-find.js "<전화번호 또는 이름>"' })); process.exit(1); }
// 색인이 없으면 지금 만들고(첫 실행 10~20분), 60분 넘게 오래됐으면 있던 색인으로 바로 답하고 뒤에서 새로 만든다(바뀐 엑셀만 다시 읽음 · 다음 질문부터 반영)
if (!opt.noUpdate) {
    if (!fs.existsSync(INV_JSON)) { try { execFileSync(process.execPath, [path.join(__dirname, 'share-index.js')], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 30 * 60 * 1000 }); } catch (e) { /* 아래에서 오류 안내 */ } }
    else if (Date.now() - fs.statSync(INV_JSON).mtimeMs > 60 * 60 * 1000) { try { spawn(process.execPath, [path.join(__dirname, 'share-index.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) { /* 무시 */ } }
}
if (!fs.existsSync(INV_JSON)) { console.log(JSON.stringify({ ok: false, error: '송장 색인이 없습니다 — node scripts/desk/share-index.js 를 먼저 실행하세요(첫 실행 10~20분)' })); process.exit(2); }
const idx = JSON.parse(fs.readFileSync(INV_JSON, 'utf8'));
if (opt.addr) {   // 주소는 따로 둔 파일에서(같은 순서) · --addr 일 때만 읽는다
    const ap = path.join(OUT, 'invoices-addr.json');
    if (fs.existsSync(ap)) { const addr = JSON.parse(fs.readFileSync(ap, 'utf8')).addr || []; idx.rows.forEach((r, i) => { if (r.ad === undefined) r.ad = addr[i] || ''; }); }
}
const dg = term.replace(/\D/g, '');
const byPhone = dg.length >= 4 && dg.length >= term.replace(/[\s\-()]/g, '').length;   // 숫자뿐이면 번호 찾기
const needle = byPhone ? dg : term.replace(/\s+/g, '');
const hits = [];
for (const r of idx.rows) {
    if (opt.year && r.y !== opt.year) continue;
    let how = null;
    if (byPhone) {
        const full = dg.length >= 9;
        if (full ? (r.t1 === dg || r.t2 === dg || r.tb === dg) : (r.t1.endsWith(dg) || r.t2.endsWith(dg) || r.tb.endsWith(dg))) how = r.t1.endsWith(dg) ? '수취인' : r.tb.endsWith(dg) ? '구매자' : '수취인2';
    } else if (r.nm && r.nm.replace(/\s+/g, '').includes(needle)) how = '이름';
    if (how) hits.push(Object.assign({ how }, r));
}
hits.sort((a, b) => String(b.d || '').localeCompare(String(a.d || '')) || b.f.localeCompare(a.f));
const limit = opt.limit || 40;
const mask = t => t ? t.replace(/^(\d{3})(\d+)(\d{4})$/, '$1-****-$3') : '';
const items = hits.slice(0, limit).map(r => Object.assign({ date: r.d, partner: r.pt, name: r.nm, option: r.op, qty: r.q, matched: r.how, phone_hint: mask(r.how === '구매자' ? r.tb : r.t1), tracking: (r.trs && r.trs.length ? r.trs.join(', ') : r.tr) || '', memo: r.ms, file: path.join('★송장', r.f.replace(/^★송장\\/, '')) }, opt.addr ? { address: r.ad } : {}));
const people = new Set(hits.map(r => r.nm + '|' + (r.t1 || r.tb)));
console.log(JSON.stringify({ ok: true, query: term, by: byPhone ? '전화번호' : '이름', total: hits.length, shown: items.length, distinct_people: people.size, indexed_at: idx.at, note: byPhone && dg.length < 9 ? '끝자리만으로 찾아 여러 손님이 섞일 수 있어요 — 전체 번호로 다시 찾는 것이 정확합니다' : undefined, items }, null, 1));
