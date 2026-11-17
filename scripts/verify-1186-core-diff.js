// #1186 final-order-core.js 구/신 출력 대조 — 날짜 읽기 두 곳만 고쳤으므로 그 밖의 모든 출력은 바이트 같아야 한다(DB·서버·네트워크 0 · 자료 전부 가짜)
//   ① 내보낸 함수 목록·상수(HEADERS·WIDTHS·CAT_RGB·DEFAULT_MEMO) 같음
//   ② prepLines(메모 줄 다듬기) = 메모 글 묶음 × 기준일 여러 날 → JSON 같음(12/17~31 의 「n일」·없는 날은 일부러 빼고 · 그 칸은 verify-1186-date.js 가 봄)
//   ③ 날짜와 무관한 함수(sizeLines·gwaLines·boxTails·parseCash·cashCheck·fmtPhone·stripTail·partnerOf·isJeju·readSender·senderHint·memoRest) = 같은 입력 → 같은 출력
//   ④ 소스 차이 = isoOf 줄 · 「n일」 줄 · 해 넘김 판정 3줄뿐(그 밖 줄 수 0)
//   실행: node scripts/verify-1186-core-diff.js [옛 final-order-core.js 경로]   (기본 = git b754433 의 파일)
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (m, c, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 600))); };
const newPath = path.join(ROOT, 'public', 'final-order-core.js');
let oldPath = process.argv[2];
if (!oldPath) { oldPath = path.join(os.tmpdir(), 'v1186-core-old-' + process.pid + '.js'); fs.writeFileSync(oldPath, cp.execSync('git show b754433:public/final-order-core.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })); process.on('exit', () => { try { fs.unlinkSync(oldPath); } catch (e) { } }); }
const O = require(oldPath), N = require(newPath);
const J = v => JSON.stringify(v, (k, x) => x instanceof Map ? ['__map', [...x]] : x instanceof Set ? ['__set', [...x]] : x === undefined ? '__undef' : x);
const same = (name, fn) => { let a, b, ea = null, eb = null; try { a = J(fn(O)); } catch (e) { ea = String(e && e.message); } try { b = J(fn(N)); } catch (e) { eb = String(e && e.message); } return a === b && ea === eb ? null : { name, old: (ea || a || '').slice(0, 200), neu: (eb || b || '').slice(0, 200) }; };

ok('① 내보낸 이름 = 종전 + ghostDate·ghostInLine 둘뿐', Object.keys(N).filter(k => !(k in O)).sort().join() === 'ghostDate,ghostInLine' && Object.keys(O).every(k => k in N), [Object.keys(O).length, Object.keys(N).length]);
ok('① 상수 같음(HEADERS·WIDTHS·CAT_RGB·DEFAULT_MEMO)', ['HEADERS', 'WIDTHS', 'CAT_RGB', 'DEFAULT_MEMO'].every(k => J(O[k]) === J(N[k])));

// ② prepLines
const MEMO = [
    '11/18\t010-1234-5678\t입력o삭제x\t네이버', '11/20 010-2222-3333 입력o삭제x', '010-3333-4444 입력o삭제x', '11월 21일 010-5555-6666 15과로 변경', '11.22 2026110112345678 2S로',
    '금요일 010-7777-8888 발송', '오늘 010-1111-0000 입력o삭제x', '내일 010-1111-0001 입력o삭제x', '18일 010-1212-3434 입력o삭제x', '25일 010-5656-7878 발송',
    '010-9090-8080 보내는분 홍길동 010-1000-2000', '요청일자\t전화번호 또는 상품주문번호\t메모\t플랫폼', '', '아무 글', '11/19\t010-4545-6767\t배송메모 문 앞에 놓아 주세요\t쿠팡',
    '2026-11-25 010-2323-4545 입력o삭제x 자사몰', '11/18\t010-1234-5678\t박스별 1:2S 2:M\t네이버', '11/18 01012345678 입삭', '11/30\t010-0000-1111\tS로\t네이버', '12/1\t010-0000-2222\t입력o삭제x\t네이버',
];
const DAYS = ['2026-01-05', '2026-02-27', '2026-03-31', '2026-06-15', '2026-11-02', '2026-11-17', '2026-11-18', '2026-11-30', '2026-12-01', '2026-12-10', '2026-12-16', '2027-01-04', '2027-02-26', '2028-02-28'];
// #1186-b 없는 날짜 줄(달력에 없는 날) — 종전엔 다음 달로 넘겨 읽던 줄 · 지금은 'line-baddate' 안내(카드)만 더 붙고 기준일로 찍지 않는다
const GHOSTS = ['11/31\t010-1234-5678\t입력o삭제x\t네이버', '11/31 010-1234-5678 입력삭제', '010-1234-5678 11/31 개별발송', '2/30 010-1234-5678 15과로', '4월 31일 010-1234-5678 발송', '2026-06-31 010-1234-5678 입력o삭제x', '010-1234-5678\t9/31 개별발송'];
const realDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
let cells = 0, ghostCells = 0; const diffs = [], ghostBad = [];
for (const d of DAYS) {
    const shipDays = [0, 1, 2, 3, 4, 5, 6].map(n => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10)), opt = { realToday: d, shipDate: d, shipDays };
    for (const txt of [MEMO.join('\n'), ...MEMO, ...GHOSTS]) {
        cells++;
        const nw = N.prepLines(txt, opt), bad = nw.notes.filter(n => n.type === 'line-baddate');
        if (!bad.length) { const r = same('prepLines ' + d, c => c.prepLines(txt, opt)); if (r) diffs.push(Object.assign(r, { txt: txt.slice(0, 60) })); continue; }
        // 새 안내가 붙은 칸 = 정말 달력에 없는 날인지(그 해·다음 해 어느 쪽에도 없음) + 기준일로 찍지 않았는지 + 줄 글은 그대로 넘겼는지
        ghostCells++;
        const g = bad[0].ghost.split('/').map(Number), y = +d.slice(0, 4);
        const okGhost = !realDay(y, g[0], g[1]) && !(g[0] === 2 && g[1] === 29 ? false : realDay(y + 1, g[0], g[1])) || (g[0] === 2 && g[1] === 29 && !realDay(y, 2, 29));
        const stamped = nw.notes.some(n => n.type === 'indiv-today'), md = (+d.slice(5, 7)) + '/' + (+d.slice(8, 10));
        if (!okGhost || stamped || nw.v2Text.split('\n').some(l => l.startsWith(md + ' ') || l.startsWith(md + '\t'))) ghostBad.push({ d, txt: txt.slice(0, 50), ghost: bad[0].ghost, stamped, out: nw.v2Text.slice(0, 80) });
    }
}
ok('②-b 새 「없는 날짜」 안내가 붙는 칸 = 전부 정말 없는 날 · 기준일로 안 찍힘(' + ghostCells + '칸)', ghostCells > 0 && !ghostBad.length, ghostBad.slice(0, 3));
ok('②-b 멀쩡한 메모 표본(' + MEMO.length + '줄 × ' + DAYS.length + '일)에는 새 안내 0', DAYS.every(d => MEMO.every(t => !N.prepLines(t, { realToday: d, shipDate: d, shipDays: [d] }).notes.some(n => n.type === 'line-baddate') || /31일|30일|29일|\/3[01]|\/29/.test(t))));
ok(`② prepLines 구/신 같음(${cells}칸 · 기준일 ${DAYS.length}일)`, !diffs.length, diffs.slice(0, 3));

// ③ 날짜 무관 함수
const T = [];
const push = (n, fn) => { const r = same(n, fn); if (r) T.push(r); };
['2S로', '15과로 변경', 'S싸이즈로 지난번 2s는 작아서', '로얄과 M', '3번 박스만 L', '', '박스별 1:2S 2:M 3:기본'].forEach(s => { push('sizeLines', c => c.sizeLines(s)); push('gwaLines', c => c.gwaLines(s)); push('boxTails', c => c.boxTails(s, 3)); push('sizeOnlyMemo', c => c.sizeOnlyMemo(s)); push('memoRest', c => c.memoRest(s)); push('senderCue', c => c.senderCue(s)); push('senderHint', c => c.senderHint(s)); push('readSender', c => c.readSender(s)); push('sameDayOnly', c => c.sameDayOnly(s)); });
['01012345678', '010-1234-5678', '0212345678', '+82 10 1234 5678', '', '1234'].forEach(s => push('fmtPhone', c => c.fmtPhone(s)));
['고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M) 2S로!', '황금향 선물용 - 3kg 15과로!', '없는 품목'].forEach(s => { push('stripTail', c => c.stripTail(s)); push('partnerOf', c => c.partnerOf(s, { '효돈농협': ['고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)'], '대성(시온)': ['황금향 선물용 - 3kg'] })); push('shortPartner', c => c.shortPartner(s)); });
['제주특별자치도 제주시 연삼로 1', '서울특별시 가짜구 집로 1', '제주 서귀포시 가짜로 2', ''].forEach(s => push('isJeju', c => c.isJeju(s)));
const H = N.HEADERS, row = (a, b, nm, q, tel, k) => { const r = Array.from({ length: 13 }, () => ''); r[0] = a; r[1] = b; r[2] = '제주시 가짜로 1'; r[3] = nm; r[4] = '황금향 선물용 - 3kg'; r[5] = q; r[6] = tel; r[8] = '부산광역시 가짜구 가짜로 1'; r[10] = k; return r; };
const aoa = [H.slice(), row('홍길동 드림', '010-1000-2000', '가받는', 1, '010-3000-0001', '010-1000-2000'), row('김현금!', '010-1000-2001', '나받는', 2, '010-3000-0002', '010-1000-2001'), row('', '', '', '', '', '')];
push('parseCash', c => c.parseCash(aoa)); push('parseCash 빈', c => c.parseCash([H.slice()])); push('parseCash 머리 틀림', c => c.parseCash([['x'], ['y']]));
push('cashCheck', c => c.cashCheck({ orders: [{ key: 'naver:1', digits: '01010002000', qty: 1, individual: true, excluded: false, buyer: '홍', opt: '황금향 선물용 - 3kg' }, { key: 'naver:2', digits: '01099990000', qty: 2, individual: true, excluded: false, buyer: '박', opt: '황금향 선물용 - 3kg' }], cash: c.parseCash(aoa).rows }));
push('splitSignal', c => c.splitSignal('3박스 중 1박스만 먼저'));
ok(`③ 날짜와 무관한 함수 구/신 같음`, !T.length, T.slice(0, 3));

// ④ 소스 차이 줄
const a = fs.readFileSync(oldPath, 'utf8').replace(/\r\n/g, '\n').split('\n'), b = fs.readFileSync(newPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
const sa = new Set(a), sb = new Set(b), gone = a.filter(l => !sb.has(l)), came = b.filter(l => !sa.has(l));
const GONE = ['const isoOf = (y, m, d)', '일/))) { d = +m[1]; mo = tm;', 'let iso = isoOf(y, mo, d); if (!iso) return null;', 'Date.parse(iso) < Date.parse(today) - 300', 'if (indivNoDate && shipDate) { date = shipDate;', 'else if (indivNoDate) notes.push({ srcLine, raw: line, type:', 'parseDate, fmtPhone, readSender, DEFAULT_MEMO', '))?/))) { mo = +m[1]; d = +m[2]; if (m[3]) y =', '.월]'];   // 끝 2줄 = #1187(「2.5kg」 무게 · 날짜 아님)
ok('④ 소스 차이 = 사라진 줄 9(날짜 읽기 4 · 없는 날짜 처리로 조건이 붙은 2 · 내보내기 1 · #1187 kg 2)뿐 · 새 줄 ' + came.length + '(전부 날짜 읽기·없는 날짜 구간)', gone.length === 9 && GONE.every(g => gone.some(l => l.includes(g))) && came.length === 30, { gone: gone.map(l => l.trim().slice(0, 60)), came: came.length });
console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); process.exit(fail ? 1 : 0);
