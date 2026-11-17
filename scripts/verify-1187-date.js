// #1187 「2.5kg」처럼 숫자.숫자 뒤에 무게 단위(kg · ㎏ · 키로 · 킬로)가 붙은 글을 날짜로 읽지 않는다 — 구/신 전수 대조 · DB·서버·네트워크 0
//   고친 곳 = final-order-core.js · invoice-v2.js 의 parseDate(같은 글자 한 줄) + 비고 안 날짜 찾기(core NOTE_DATE · v2 parseLines 안 같은 정규식) + core ghostDate
//   ① parseDate 격자: 기준일 2026-01-01 ~ 2028-12-31 × (표기 = #1186 격자 그대로 + 그 표기에 단위를 붙인 것) → 달라진 칸 = 「점 꼴 + 단위」 뿐이고 전부 null
//   ② 줄 읽기: core prepLines · v2 parseLines 에 메모 줄 표본 × 기준일 → 달라진 줄 = 무게 글이 든 줄뿐
//   「종전」 = git 커밋 c1d49bb(v5.9.825) 또는 인자 1 로 준 옛 파일 폴더
//   실행: node scripts/verify-1187-date.js [옛 파일 폴더]      (TZ=UTC 로도 한 번)
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.join(__dirname, '..'), BASE = 'c1d49bb';
const oldSrc = f => process.argv[2] ? fs.readFileSync(path.join(process.argv[2], f), 'utf8') : cp.execSync(`git show ${BASE}:public/${f}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const newSrc = f => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const cutter = src => (a, e) => { const i = src.indexOf(a); if (i < 0) throw new Error('없음: ' + a); const j = src.indexOf(e, i); if (j < 0) throw new Error('끝 없음: ' + a); return src.slice(i, j + e.length); };
function load(src) {   /* order-memo.js loadV2 와 같은 자르기 표식 */
    src = src.replace(/\r\n/g, '\n'); const cut = cutter(src);
    return new Function(cut('const isoOf = ', ';\n') + '\n' + cut('function parseDate(s, today) {', '\n    }\n') + '\nreturn parseDate;')();
}
function loadLines(src) {
    src = src.replace(/\r\n/g, '\n'); const cut = cutter(src);
    return new Function([cut('const isoOf = ', ';\n'), cut('function parseDate(s, today) {', '\n    }\n'), cut('const chOfText = ', ';\n'), cut('function parseLines(txt, boxCh, today) {', '\n        return out;\n    }\n')].join('\n') + '\nreturn parseLines;')();
}
let pass = 0, fail = 0; const ok = (name, c, extra) => { if (c) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const days = []; for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2028, 11, 31); t += 86400e3) days.push(new Date(t).toISOString().slice(0, 10));
const UNITS = ['kg', 'KG', 'Kg', ' kg', '㎏', '키로', ' 키로', '킬로', 'kg 로얄과 11/20'];
const NOT_UNITS = [' 로얄', '박스', 'g', 'k', ' 개별발송', '과'];   /* 단위가 아닌 꼬리 = 종전 그대로여야 함 */
const WEIGHT = /^\d{1,2}\.\d(?!\d)\s*(?:kg|㎏|키로|킬로)/i;   /* 이 검증이 따로 쓰는 판정(코드 것을 불러 쓰지 않음) */

for (const f of ['final-order-core.js', 'invoice-v2.js']) {
    console.log('\n■ ' + f + ' parseDate');
    const O = load(oldSrc(f)), N = load(newSrc(f));
    let cells = 0, same = 0, kg = 0, kgWasDate = 0; const other = [];
    for (const today of days) {
        const ty = +today.slice(0, 4), base = [];
        for (let d = 1; d <= 31; d++) base.push(d + '일', d + ' 일 오전');
        for (let m = 1; m <= 12; m++) for (const d of [1, 5, 15, 28, 29, 30, 31]) base.push(m + '/' + d, m + '.' + d, m + '-' + d, m + '월 ' + d + '일', ty + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), m + '/' + d + '/' + String(ty + 1).slice(2), m + '.' + d + '.' + String(ty + 1).slice(2));
        base.push('오늘', '내일', '', '13/5', '0/5', '5/0', '5/32', '2.5', '4.5', '10.5', '11.17', '2.15');
        const forms = base.slice();
        for (const b of base) { if (!/^\d/.test(b)) continue; for (const u of UNITS) forms.push(b + u); for (const u of NOT_UNITS) forms.push(b + u); }
        for (const s of forms) {
            cells++; const a = O(s, today), b = N(s, today);
            if (a === b) { same++; continue; }
            if (b === null && WEIGHT.test(s)) { kg++; if (a) kgWasDate++; continue; }
            if (other.length < 12) other.push({ today, s, old: a, neu: b }); else other.push(0);
        }
    }
    console.log(`  기준일 ${days.length}일 · 칸 ${cells} · 같음 ${same} · 무게 글(점 꼴 + 단위) → 못 읽음 ${kg} · 그 밖 ${other.length}`);
    ok('달라진 칸 = 「숫자.숫자 + 무게 단위」 뿐 · 전부 null(그 밖 0)', other.length === 0 && kg > 0 && kg === kgWasDate, other.filter(Boolean));
    const T = '2026-11-17';
    ok('2.5kg · 4.5kg · 2.5 kg · 2.5KG · 10.5kg = null(종전 = 날짜)', ['2.5kg', '4.5kg', '2.5 kg', '2.5KG', '10.5kg'].every(s => N(s, T) === null && O(s, T) !== null), ['2.5kg', '4.5kg', '2.5 kg', '2.5KG', '10.5kg'].map(s => [s, O(s, T), N(s, T)]));
    ok('2.5키로 · 12.5키로 · 3.5킬로 · 2.5㎏ · 「10.5kg로얄」 · 「2.5kg 로얄과 11/20」 = null', ['2.5키로', '12.5키로', '3.5킬로', '2.5㎏', '10.5kg로얄', '2.5kg 로얄과 11/20'].every(s => N(s, T) === null));
    { const KEEP = ['11.20/5kg', '11.20-5kg', '11.20.5kg', '11.20kg', '12.25kg', '2.15kg', '11.20 5kg', '11.20. 5kg 2박스', '11/20 2.5kg', '11.20/5kg 2박스', '4.30kg', '2.31kg', '1.5.27kg'], bad = KEEP.filter(s => days.some((d, i) => i % 37 === 0 && N(s, d) !== O(s, d)));
      ok('소수 두 자리·날짜 뒤 무게(' + KEEP.length + '꼴 × 기준일 30일) = 종전과 같음 · 11.20/5kg·11.20-5kg·11.20.5kg·11.20kg = 11/20 · 12.25kg = 12/25', !bad.length && ['11.20/5kg', '11.20-5kg', '11.20.5kg', '11.20kg', '11.20 5kg', '11.20. 5kg 2박스'].every(s => N(s, T) === '2026-11-20') && N('12.25kg', T) === '2026-12-25' && N('11/20 2.5kg', T) === '2026-11-20', bad); }
    ok('11.17 · 2.5 · 「2.5 로얄」(단위 없음) = 종전 그대로', N('11.17', T) === '2026-11-17' && N('2.5', T) === O('2.5', T) && N('2.5', T) !== null && N('2.5 로얄', T) === O('2.5 로얄', T) && N('2.5 로얄', T) !== null, [N('11.17', T), N('2.5', T), N('2.5 로얄', T)]);
    ok('「/」·「-」·「월」 꼴은 단위가 붙어도 종전 그대로(점 꼴만 고침)', ['2/5kg', '2-5kg', '2월 5일kg', '11/17 kg'].every(s => N(s, T) === O(s, T)));
    ok('11.17 2.5kg(날짜 뒤 칸에 무게) = 11/17 그대로', N('11.17 2.5kg', T) === '2026-11-17' && N('11/17 2.5kg', T) === '2026-11-17');
}

// ② 줄 읽기 — 비고 안 「2.5kg」
const KEY = '010-1234-5678';
const PLAIN = ['11/18\t' + KEY + '\t입력o삭제x\t네이버', '11/20 ' + KEY + ' 입력o삭제x', KEY + ' 입력o삭제x', KEY + ' 11/20 개별발송', KEY + ' 11.20 개별발송', KEY + ' 11월 20일 발송', KEY + ' 20일 발송', KEY + ' 내일 발송', KEY + ' 2S로', KEY + ' 5kg 11/20 발송', KEY + ' 11.20 2.5kg 발송', KEY + ' 3박스 11/20', '11.22 2026110112345678 2S로', KEY + '\t11/20 개별발송', KEY + ' 2.5 발송', KEY + ' 11/20 kg', KEY + '\t2.5kg 개별발송',
    KEY + ' 11.20/5kg 2박스', KEY + ' 11.20-5kg', KEY + ' 11.20.5kg 발송', '11.20/5kg\t' + KEY + '\t로얄\t네이버', '11.20.5kg\t' + KEY + '\t입력o삭제x\t네이버', KEY + ' 11.20kg 개별발송', KEY + ' 12.25kg 개별발송', KEY + ' 11.20 5kg 개별발송', KEY + ' 11.20. 5kg 2박스', KEY + ' 11/20 2.5kg 개별발송', KEY + ' 4.30kg 개별발송', KEY + ' 2.31kg 개별발송', '11.20/5kg ' + KEY + ' 입력o삭제x'];   /* 끝 줄 = 번호가 첫 칸인 탭 줄은 원래 비고에서 날짜를 안 찾음 → 구/신 같음 */
const WEIGHTY = [KEY + ' 2.5kg 개별발송', KEY + ' 2.5 kg 입력o삭제x', KEY + ' 4.5KG 로얄과 개별발송', KEY + ' 10.5kg 입력삭제', KEY + ' 3.5키로 개별발송', '2.5kg\t' + KEY + '\t입력o삭제x\t네이버', KEY + ' 2.5kg 11/20 개별발송', KEY + ' 2.5kg 11.20 개별발송', KEY + ' 12.5키로 개별발송', KEY + ' 10.5kg로얄 개별발송'];
const DAYS = ['2026-01-05', '2026-02-27', '2026-06-15', '2026-11-17', '2026-12-20', '2026-12-31', '2027-01-04', '2028-02-28'];
{
    console.log('\n■ invoice-v2.js parseLines(발주 메모함 서버 order-memo.js 가 잘라 쓰는 조각)');
    const O = loadLines(oldSrc('invoice-v2.js')), N = loadLines(newSrc('invoice-v2.js')), J = JSON.stringify; let diffP = [], sameW = [];
    for (const d of DAYS) { for (const l of PLAIN) if (J(O(l, 'naver', d)) !== J(N(l, 'naver', d))) diffP.push({ d, l }); for (const l of WEIGHTY) if (J(O(l, 'naver', d)) === J(N(l, 'naver', d))) sameW.push({ d, l }); }
    ok(`무게 글 없는 줄 ${PLAIN.length}줄 × ${DAYS.length}일 = 구/신 같음`, !diffP.length, diffP.slice(0, 4));
    ok(`무게 글 든 줄 ${WEIGHTY.length}줄 × ${DAYS.length}일 = 전부 달라짐(종전 = 2/5 꼴 날짜)`, !sameW.length, sameW.slice(0, 4));
    const T = '2026-11-17', dt = l => (N(l, 'naver', T)[0] || {}).date;
    ok('「번호 2.5kg 개별발송」 = 날짜 없음 · 「번호 2.5kg 11/20 개별발송」·「… 11.20 …」 = 11/20', dt(WEIGHTY[0]) == null && dt(WEIGHTY[6]) === '2026-11-20' && dt(WEIGHTY[7]) === '2026-11-20', [dt(WEIGHTY[0]), dt(WEIGHTY[6]), dt(WEIGHTY[7])]);
    ok('「번호 11.20 2.5kg 발송」 = 11/20 그대로', dt(PLAIN[10]) === '2026-11-20');
}
{
    console.log('\n■ final-order-core.js prepLines(최종발주 메모 줄 다듬기)');
    const tmp = path.join(os.tmpdir(), 'v1187-core-old-' + process.pid + '.js'); fs.writeFileSync(tmp, oldSrc('final-order-core.js')); process.on('exit', () => { try { fs.unlinkSync(tmp); } catch (e) { } });
    const O = require(tmp), N = require(path.join(ROOT, 'public', 'final-order-core.js')), J = JSON.stringify; let diffP = [];
    const opt = d => ({ realToday: d, shipDate: d, shipDays: [0, 1, 2, 3].map(n => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10)) });
    for (const d of DAYS) for (const l of PLAIN) if (J(O.prepLines(l, opt(d))) !== J(N.prepLines(l, opt(d)))) diffP.push({ d, l });
    ok(`무게 글 없는 줄 ${PLAIN.length}줄 × ${DAYS.length}일 = 구/신 같음`, !diffP.length, diffP.slice(0, 4));
    const T = '2026-11-17', pl = l => { const r = N.prepLines(l, opt(T)); return { out: r.v2Text, types: r.notes.map(n => n.type) }; }, po = l => { const r = O.prepLines(l, opt(T)); return { out: r.v2Text, types: r.notes.map(n => n.type) }; };
    let x = pl(WEIGHTY[0]), y = po(WEIGHTY[0]);
    ok('「번호 2.5kg 개별발송」 = 날짜 없는 개별발송 줄(기준일 11/17 로 찍힘) · 종전 = 2/5 날짜 줄로 읽어 기준일 안 찍음', x.types.includes('indiv-today') && x.out.startsWith('11/17 ') && !y.types.includes('indiv-today'), { neu: x, old: y });
    x = pl(WEIGHTY[6]); ok('「번호 2.5kg 11/20 개별발송」 = 11/20 줄(기준일 안 찍힘)', !x.types.includes('indiv-today') && !x.types.includes('line-baddate'), x);
    ok('무게 글 줄에 「없는 날짜」 안내 0 · ghostDate: 소수 한 자리 무게 = null · 소수 두 자리(4.31kg·11.31kg)·11/31 = 종전 그대로 잡음', WEIGHTY.every(l => !pl(l).types.includes('line-baddate')) && N.ghostDate('2.5kg', T) === null && N.ghostDate('10.5 kg', T) === null && ['4.31kg', '11.31kg', '11/31', '11.31', '2.30 kg'].every(s => N.ghostDate(s, T) === O.ghostDate(s, T)) && N.ghostDate('11.31kg', T) === '11/31');
    ok('ghostInLine: 무게 글 = null · 11/31·11.31·「11.31/5kg」 = 그대로 잡음', N.ghostInLine(KEY + ' 2.5kg 개별발송', T) === null && N.ghostInLine(KEY + ' 11/31 개별발송', T) === '11/31' && N.ghostInLine(KEY + ' 11.31 개별발송', T) === '11/31' && N.ghostInLine(KEY + ' 11.31/5kg 개별발송', T) === '11/31');
    { const d1 = l => { const r = N.prepLines(l, opt(T)); return r.v2Text; }, o1 = l => O.prepLines(l, opt(T)).v2Text; const B1 = [KEY + ' 11.20/5kg 2박스 개별발송', KEY + ' 11.20-5kg 개별발송', '11.20/5kg\t' + KEY + '\t입력o삭제x\t네이버', '11.20.5kg ' + KEY + ' 입력o삭제x'];
      ok('B1 「11.20/5kg」·「11.20-5kg」·「11.20.5kg」 줄 = 종전과 같은 출력 · 기준일(11/17)로 안 찍힘', B1.every(l => d1(l) === o1(l) && !/^11\/17[ \t]/.test(d1(l)) && !pl(l).types.includes('indiv-today')), B1.map(l => [d1(l), pl(l).types])); }
}
// 두 파일 고친 줄 글자 같음
const line = (src, mark) => { const l = src.replace(/\r\n/g, '\n').split('\n').find(x => x.includes(mark)); return l ? l.trim() : null; };
const A = newSrc('final-order-core.js'), B = newSrc('invoice-v2.js'), MK = '))?/))) { if (';
ok('두 파일 parseDate 「M.D」 줄 글자 같음', !!line(A, MK) && line(A, MK) === line(B, MK));
const re = s => (s.match(/\/\\d\{1,2\}\\s\*\[\\\/월\][^\n]*?내일\//) || [])[0];
ok('두 파일 비고 안 날짜 찾기 정규식 글자 같음', !!re(A) && re(A) === re(B), [re(A), re(B)]);
console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); process.exit(fail ? 1 : 0);
