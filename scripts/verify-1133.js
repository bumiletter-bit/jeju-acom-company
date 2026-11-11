// #1133 검증 — 뒤 날짜 박스별 줄(#1027 고객정보수정 ⓑ)만 남고 날짜 줄(ⓐ)이 지워져도 그 주문은 오늘 안 나감(실사고 11/12 · 2507)
//   order-memo.js pickForShip 실코드 → final-order-core prepLines → invoice-v2 parseLines·applyLines 실코드(잘라 실행) · DB·서버·네트워크 0
//   실행: node scripts/verify-1133.js
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 600))); };
const OM = require(path.join(ROOT, 'order-memo.js')), core = require(path.join(ROOT, 'public', 'final-order-core.js'));
const src = fs.readFileSync(path.join(ROOT, 'public', 'invoice-v2.js'), 'utf8').replace(/\r\n/g, '\n');
const cut = (s, a0, end) => { const a = s.indexOf(a0); if (a < 0) throw new Error('없음 ' + a0); const b = s.indexOf(end, a); return s.slice(a, b + end.length); };
const V2 = new Function('matchKey', [cut(src, 'const isoOf = ', ';\n'), cut(src, 'function parseDate(s, today) {', '\n    }\n'), cut(src, 'const chOfText = ', ';\n'), cut(src, 'function parseLines(txt, boxCh, today) {', '\n        return out;\n    }\n'), cut(src, '    function applyLines(ctx, force = true) {', '\n        });\n    }\n')].join('\n') + '\nreturn { parseLines, applyLines };');
const BUY = '010-6318-2507', BD = '01063182507', PNO = '2026111121606121', TODAY = '2026-11-12', LATER = '2026-11-15';
const v2 = V2((ctx, e, digits, key) => (digits.length >= 8 && BD === digits) || (key && e.pid === key));
const box = { id: 482, kind: 'line', state: 'open', sure: true, ship_date: LATER, line_key: BUY, note: '박스별 2박스 · 박스1=S · 박스2=S', plat: '네이버', line: ['11/15', BUY, '박스별 2박스 · 박스1=S · 박스2=S', '네이버'].join('\t'), boxes: [{ t: 'S사이즈로!' }, { t: 'S사이즈로!' }], checked: { plat: '네이버', as: 'buyer', at: '2026-11-11T00:20:51.901Z', buyer: BUY, pno: PNO } };
const dateLine = { id: 481, kind: 'line', state: 'open', sure: true, ship_date: LATER, line_key: PNO, note: '11/15 발송', plat: '네이버', line: ['11/15', PNO, '11/15 발송', '네이버'].join('\t'), checked: { plat: '네이버', as: 'order', at: '2026-11-11T00:20:51.901Z', buyer: BUY, pno: PNO } };
function judge(rows, date) {
    const fs1 = OM.pickForShip(rows, date);
    const prep = core.prepLines(fs1.memo_text, { realToday: date, shipDate: date, shipDays: [TODAY, '2026-11-13', '2026-11-14', LATER] });
    const merged = [{ ch: 'naver', pid: PNO, conv: { '수량': 2 }, excluded: false, userTouched: false, memoFlag: null }, { ch: 'naver', pid: '2026111199999999', conv: { '수량': 1 }, excluded: false, userTouched: false, memoFlag: null }];
    const ctx = { today: date, allowIndiv: true, merged, lines: { naver: [], cafe24: [], coupang: [] } };
    const all = v2.parseLines(prep.v2Text, 'naver', date); all.forEach(l => { if (!l.bad) ctx.lines[l.ch].push(l); }); ctx.allLines = all; v2.applyLines(ctx);
    return { fs1, st: Object.fromEntries(merged.map(e => [e.pid, e.excluded ? 'excl' : e.individual ? 'indiv' : 'go'])), bad: all.filter(l => l.bad).map(l => l.bad) };
}
console.log('Ⅰ 실사고 꼴 = 날짜 줄(481) 지움 · 박스별 줄(482 · 11/15)만');
let r = judge([box], TODAY);
ok(/11\/15\t2026111121606121\t11\/15 발송\t네이버/.test(r.fs1.memo_text) && r.fs1.lines.some(l => l.box_hold === 482 && l.id === null && l.state === 'wait'), '메모 칸에 대신 날짜 줄 1개(id 없음 · 「오늘 씀」 안 찍힘)', r.fs1.memo_text);
ok(r.st[PNO] === 'excl' && r.st['2026111199999999'] === 'go' && !r.bad.length, '11/12 = 그 주문 오늘 안 나감(hold) · 다른 주문 그대로', r);
ok(r.fs1.box_wait.length === 1 && !r.fs1.ids.includes(482), '박스별 줄 = 종전대로 대기 칸 · 오늘 씀 id 아님', r.fs1.box_wait);
ok(r.fs1.ids.every(id => id != null), 'ids 에 null 없음(메모함 「M/D 발주에 n줄」 숫자 그대로 · 워커2 점검)', r.fs1.ids);
console.log('Ⅱ 날짜 줄이 살아 있으면 = 종전 그대로(중복 0)');
r = judge([dateLine, box], TODAY);
ok((r.fs1.memo_text.match(/11\/15 발송/g) || []).length === 1 && !r.fs1.lines.some(l => l.box_hold) && r.st[PNO] === 'excl', '날짜 줄 1개만(대신 줄 안 넣음) · 주문 hold', r.fs1.memo_text);
console.log('Ⅲ 그날(11/15) = 박스별 줄이 box_rows 로 · 대신 줄 없음 · 주문 오늘 나감');
r = judge([box], LATER);
ok(r.fs1.box_rows.length === 1 && !r.fs1.lines.some(l => l.box_hold) && r.st[PNO] === 'go', '11/15 = box_rows 1 · 대신 줄 0 · 주문 나감', { rows: r.fs1.box_rows.length, st: r.st });
console.log('Ⅳ 주문번호(pno) 없는 옛 박스별 줄 = 종전(대신 줄 없음)');
r = judge([Object.assign({}, box, { checked: { plat: '네이버', as: 'buyer', buyer: BUY } })], TODAY);
ok(!r.fs1.lines.some(l => l.box_hold) && !r.fs1.memo_text, 'pno 없음 = 메모 칸 0(종전)', r.fs1.memo_text);
console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); process.exit(fail ? 1 : 0);
