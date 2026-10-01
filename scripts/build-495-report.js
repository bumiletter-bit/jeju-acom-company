/* #495: 봇 응답 품질 시험 결과(scripts/qbank-495-results.json) → 직원 배포용 정리표 엑셀
   「이런 식으로 물으면 이렇게 답한다」 — 시트 「요약」 + 품목별 5시트(레드키위·유라조생·황금향·그린레몬·하우스감귤)
   node scripts/build-495-report.js [결과.json] [출력.xlsx]
   인자 없이 = 지금까지 쌓인 결과로 바탕화면 「봇_답변_예시_품목별(10-01).xlsx」 생성(덮어씀 · 부분 결과도 OK) */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const fs = require('fs');
const path = require('path');
const XLSX = require(PROJ + '\\node_modules\\xlsx-js-style');

const SRC = process.argv[2] || path.join(PROJ, 'scripts', 'qbank-495-results.json');
const DESKTOP = (() => {
  const od = 'C:\\Users\\전승범\\OneDrive\\바탕 화면';
  return fs.existsSync(od) ? od : 'C:\\Users\\전승범\\Desktop';
})();
const OUT = process.argv[3] || path.join(DESKTOP, '봇_답변_예시_품목별(10-01).xlsx');

const SHEETS = [
  { name: '레드키위', keys: ['레드키위', '키위'] },
  { name: '유라조생', keys: ['유라조생', '유라', '노지감귤', '극조생'] },
  { name: '황금향', keys: ['황금향'] },
  { name: '그린레몬', keys: ['그린레몬', '레몬'] },
  { name: '하우스감귤', keys: ['하우스감귤', '하우스귤', '하우스'] },
];
const sheetOf = (product) => {
  const p = String(product || '');
  for (const s of SHEETS) if (s.keys.some(k => p.includes(k))) return s.name;
  return null;
};

// 판정 정규화: ✅ / ⚠️ / ❌ / SKIP
const normVerdict = (v) => {
  const s = String(v || '').trim();
  if (/SKIP/i.test(s)) return 'SKIP';
  if (s.includes('❌') || /^(x|fail|불합격|오답)/i.test(s)) return '❌';
  if (s.includes('⚠') || /^(warn|주의|부분)/i.test(s)) return '⚠️';
  if (s.includes('✅') || /^(ok|pass|합격|정답)/i.test(s)) return '✅';
  return s || '판정 전';
};

// 답변 꼬리 「*추가 문의사항…」 제거(그 줄부터 끝까지) · 줄바꿈 유지
const cleanAnswer = (a) => {
  let s = String(a == null ? '' : a).replace(/\r\n/g, '\n');
  const i = s.search(/\n?\s*\*\s*추가 문의사항/);
  if (i >= 0) s = s.slice(0, i);
  return s.replace(/\s+$/, '');
};

// ── 스타일
const BORDER = { style: 'thin', color: { rgb: 'D0D5DD' } };
const borders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const FONT = { name: '맑은 고딕', sz: 10 };
const head = { font: { ...FONT, bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'EEF2FF' } }, alignment: { vertical: 'center', horizontal: 'center', wrapText: true }, border: borders };
const cellStyle = (fillRgb, center) => {
  const st = { font: FONT, alignment: { vertical: 'top', horizontal: center ? 'center' : 'left', wrapText: true }, border: borders };
  if (fillRgb) st.fill = { patternType: 'solid', fgColor: { rgb: fillRgb } };
  return st;
};
const FILL = { '❌': 'FDE2E7', '⚠️': 'FFF4CC' };

function sheetFromRows(header, rows, widths, opts = {}) {
  const aoa = [header, ...rows.map(r => r.cells)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = widths.map(w => ({ wch: w }));
  header.forEach((_, c) => { ws[XLSX.utils.encode_cell({ r: 0, c })].s = head; });
  rows.forEach((r, i) => {
    r.cells.forEach((_, c) => {
      const ref = XLSX.utils.encode_cell({ r: i + 1, c });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      ws[ref].s = cellStyle(r.fill, (opts.center || []).includes(c));
    });
  });
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  if (rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
  return ws;
}

// ── 데이터 읽기
let data = [];
if (fs.existsSync(SRC)) {
  const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  data = Array.isArray(raw) ? raw : (raw.results || []);
} else {
  console.log('⚠️ 결과 파일 없음 — 빈 표로 생성:', SRC);
}

const by = Object.fromEntries(SHEETS.map(s => [s.name, []]));
const unknown = [];
for (const d of data) {
  const sh = sheetOf(d.product);
  const row = { no: d.no, q: d.q, answer: cleanAnswer(d.answer), verdict: normVerdict(d.verdict), reason: d.reason || '', product: d.product };
  if (sh) by[sh].push(row); else unknown.push(row);
}
const numOf = (n) => { const m = String(n == null ? '' : n).match(/\d+/); return m ? +m[0] : 1e9; };
for (const k of Object.keys(by)) by[k].sort((a, b) => numOf(a.no) - numOf(b.no));

// ── 요약 시트
const wb = XLSX.utils.book_new();
const sumRows = [];
const tot = { n: 0, '✅': 0, '⚠️': 0, '❌': 0, SKIP: 0, '판정 전': 0 };
for (const s of SHEETS) {
  const rs = by[s.name];
  const c = { '✅': 0, '⚠️': 0, '❌': 0, SKIP: 0, '판정 전': 0 };
  rs.forEach(r => { if (c[r.verdict] != null) c[r.verdict]++; });
  tot.n += rs.length; for (const k of Object.keys(c)) tot[k] += c[k];
  sumRows.push({ cells: [s.name, rs.length, c['✅'], c['⚠️'], c['❌'], c.SKIP, c['판정 전']] });
}
sumRows.push({ cells: ['합계', tot.n, tot['✅'], tot['⚠️'], tot['❌'], tot.SKIP, tot['판정 전']], fill: 'F2F4F7' });
const wsSum = sheetFromRows(['품목', '문항 수', '✅ 정상', '⚠️ 주의', '❌ 오답', 'SKIP', '판정 전'], sumRows, [14, 10, 10, 10, 10, 10, 10], { center: [1, 2, 3, 4, 5, 6] });
// 이상 징후 목록(❌·⚠️) — 요약 표 아래
const issues = [];
for (const s of SHEETS) for (const r of by[s.name]) if (r.verdict === '❌' || r.verdict === '⚠️') issues.push({ s: s.name, r });
let rr = sumRows.length + 3;
const put = (r, c, v, st) => { const ref = XLSX.utils.encode_cell({ r, c }); wsSum[ref] = { t: typeof v === 'number' ? 'n' : 's', v, s: st }; };
put(rr - 1, 0, `이상 징후 (❌·⚠️ ${issues.length}건)`, { font: { ...FONT, bold: true, sz: 11 } });
['품목', '번호', '판정', '손님 질문', '근거·고칠 점'].forEach((h, c) => put(rr, c, h, head));
issues.forEach((it, i) => {
  const st = cellStyle(FILL[it.r.verdict]); const stc = cellStyle(FILL[it.r.verdict], true);
  put(rr + 1 + i, 0, it.s, stc); put(rr + 1 + i, 1, String(it.r.no ?? ''), stc); put(rr + 1 + i, 2, it.r.verdict, stc);
  put(rr + 1 + i, 3, String(it.r.q || ''), st); put(rr + 1 + i, 4, String(it.r.reason || ''), st);
});
if (!issues.length) put(rr + 1, 0, '없음', cellStyle());
if (unknown.length) {
  const ur = rr + 3 + Math.max(issues.length, 1);
  put(ur, 0, `품목 미분류 ${unknown.length}건: ` + [...new Set(unknown.map(u => u.product))].join(', '), { font: { ...FONT, color: { rgb: 'B42318' } } });
}
const lastR = rr + 4 + Math.max(issues.length, 1);
wsSum['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastR, c: 6 } });
wsSum['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 46 }, { wch: 60 }, { wch: 10 }, { wch: 10 }];
delete wsSum['!autofilter'];
XLSX.utils.book_append_sheet(wb, wsSum, '요약');

// ── 품목별 시트
for (const s of SHEETS) {
  const rows = by[s.name].map(r => ({ cells: [String(r.no ?? ''), String(r.q || ''), r.answer, r.verdict, String(r.reason || '')], fill: FILL[r.verdict] }));
  const ws = sheetFromRows(['번호', '손님 질문', '봇 답변', '판정', '비고(근거/고칠 점)'], rows, [7, 38, 90, 8, 40], { center: [0, 3] });
  XLSX.utils.book_append_sheet(wb, ws, s.name);
}

XLSX.writeFile(wb, OUT);
console.log(`생성: ${OUT}`);
console.log(`문항 ${tot.n} (✅${tot['✅']} ⚠️${tot['⚠️']} ❌${tot['❌']} SKIP${tot.SKIP}` + (tot['판정 전'] ? ` 판정 전${tot['판정 전']}` : '') + ')' + (unknown.length ? ` · 미분류 ${unknown.length}` : ''));
SHEETS.forEach(s => console.log(`  ${s.name}: ${by[s.name].length}`));
