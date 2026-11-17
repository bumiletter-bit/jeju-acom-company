// #1186 날짜 읽기(parseDate · isoOf) 구/신 전수 대조 — final-order-core.js · invoice-v2.js 두 파일 · DB·서버·네트워크 0
//   고친 것 = ① 12/17~31 에 「n일」(이번 달 16일보다 더 앞 = 다음 달)이 날짜 없음(null)으로 읽히던 것 → 다음 해 1월 n일
//             ② 없는 날(2/30 · 4/31 · 「31일」인데 30일 달)이 다음 달로 조용히 넘어가던 것 → 못 읽음(null)
//   기준일 = 2026-01-01 ~ 2028-12-31 하루씩(윤년 2028 포함) × 표기 6종(n일 · M/D · M.D · M-D · M월 D일 · YYYY-MM-DD · M/D/YY)
//   달라진 칸이 위 ①②뿐인지 숫자로 본다. 「종전」 = 인자 1 로 준 옛 파일 폴더(final-order-core.js · invoice-v2.js) 또는 git 의 커밋(기본 b754433 = #1186 전)
//   실행: node scripts/verify-1186-date.js [옛 파일 폴더]
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), BASE = 'b754433';
const oldSrc = f => process.argv[2] ? fs.readFileSync(path.join(process.argv[2], f), 'utf8') : cp.execSync(`git show ${BASE}:public/${f}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const newSrc = f => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
function load(src) {
    src = src.replace(/\r\n/g, '\n');
    const cut = (a, e) => { const i = src.indexOf(a); if (i < 0) throw new Error('없음: ' + a); const j = src.indexOf(e, i); if (j < 0) throw new Error('끝 없음: ' + a); return src.slice(i, j + e.length); };
    return new Function(cut('const isoOf = ', ';\n') + '\n' + cut('function parseDate(s, today) {', '\n    }\n') + '\nreturn parseDate;')();
}
let pass = 0, fail = 0; const ok = (name, c, extra) => { if (c) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 600) : '')); } };
const real = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const days = []; for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2028, 11, 31); t += 86400e3) days.push(new Date(t).toISOString().slice(0, 10));

for (const f of ['final-order-core.js', 'invoice-v2.js']) {
    console.log('\n■ ' + f);
    const O = load(oldSrc(f)), N = load(newSrc(f));
    let cells = 0, same = 0; const kinds = { wrap: 0, ghost: 0, other: [] };
    for (const today of days) {
        const ty = +today.slice(0, 4), tm = +today.slice(5, 7), td = +today.slice(8, 10);
        const forms = [];
        for (let d = 1; d <= 31; d++) forms.push([d + '일', 'n', 0, d], [d + ' 일 오전', 'n', 0, d]);
        for (let m = 1; m <= 12; m++) for (const d of [1, 15, 28, 29, 30, 31]) forms.push([m + '/' + d, 'md', m, d], [m + '.' + d, 'md', m, d], [m + '-' + d, 'md', m, d], [m + '월 ' + d + '일', 'md', m, d], [ty + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), 'ymd', m, d], [m + '/' + d + '/' + String(ty + 1).slice(2), 'mdy', m, d]);
        forms.push(['오늘', 'w'], ['내일', 'w'], ['', 'w'], ['2.5kg', 'w'], ['13/5', 'w'], ['0/5', 'w'], ['5/0', 'w'], ['5/32', 'w']);
        for (const [s, kind, m, d] of forms) {
            cells++; const a = O(s, today), b = N(s, today);
            if (a === b) { same++; continue; }
            if (kind === 'n' && a === null && tm === 12 && td >= 17 && d < td - 15 && b === (ty + 1) + '-01-' + String(d).padStart(2, '0')) { kinds.wrap++; continue; }   // ① 12월 하순의 「n일」 → 다음 해 1월
            // ② 없는 날: 종전은 다음 달로 넘어간 날 · 지금은 null
            if (b === null && a !== null) {
                const yy = kind === 'ymd' ? ty : kind === 'mdy' ? ty + 1 : null, mm = kind === 'n' ? (d < td - 15 ? tm + 1 : tm) : m;
                const ys = yy != null ? [yy] : [ty, ty + 1];
                if (ys.every(y => !real(y, mm > 12 ? mm - 12 : mm, d)) || (kind !== 'ymd' && kind !== 'mdy' && !real(+a.slice(0, 4), mm > 12 ? mm - 12 : mm, d) && a.slice(5) !== String(mm).padStart(2, '0') + '-' + String(d).padStart(2, '0'))) { kinds.ghost++; continue; }
            }
            if (kinds.other.length < 12) kinds.other.push({ today, s, old: a, neu: b });
            else kinds.other.push(0);
        }
    }
    console.log(`  기준일 ${days.length}일 · 칸 ${cells} · 같음 ${same} · ① 12월 하순 n일 → 1월 ${kinds.wrap} · ② 없는 날 → 못 읽음 ${kinds.ghost} · 그 밖 ${kinds.other.length}`);
    ok('달라진 칸 = ①② 뿐(그 밖 0)', kinds.other.length === 0, kinds.other.filter(Boolean));
    ok('① 이 실제로 있음(12/17~31 × 3해)', kinds.wrap > 0, kinds.wrap);
    ok('② 가 실제로 있음', kinds.ghost > 0, kinds.ghost);
    // 낱개 확인
    ok('12/20 「3일」 = 다음 해 1/3', N('3일', '2026-12-20') === '2027-01-03', N('3일', '2026-12-20'));
    ok('12/31 「15일」 = 다음 해 1/15', N('15일', '2026-12-31') === '2027-01-15', N('15일', '2026-12-31'));
    ok('12/20 「5일」(16일보다 앞 아님 경계 = 4까지만 다음 달) = 12/5', N('5일', '2026-12-20') === '2026-12-05', N('5일', '2026-12-20'));
    ok('12/20 「25일」 = 12/25 그대로', N('25일', '2026-12-20') === '2026-12-25');
    ok('11/20 「3일」 = 12/3 그대로', N('3일', '2026-11-20') === '2026-12-03' && O('3일', '2026-11-20') === '2026-12-03');
    ok('12/20 「1/3」·「1월 3일」 = 다음 해 1/3 그대로(구/신 같음)', N('1/3', '2026-12-20') === '2027-01-03' && O('1/3', '2026-12-20') === '2027-01-03' && N('1월 3일', '2026-12-20') === '2027-01-03');
    ok('없는 날 11/31 · 2/30 · 4/31 = 못 읽음', N('11/31', '2026-11-17') === null && N('2/30', '2026-11-17') === null && N('4월 31일', '2026-03-01') === null, [N('11/31', '2026-11-17'), N('2/30', '2026-11-17')]);
    ok('11/20 「31일」(11월은 30일까지) = 못 읽음', N('31일', '2026-11-20') === null, N('31일', '2026-11-20'));
    ok('2/29 = 윤년(2028)만 읽음', N('2028-02-29', '2028-02-01') === '2028-02-29' && N('2027-02-29', '2027-02-01') === null);
    ok('「2.5kg」 = 종전과 같음(이 함수는 안 바꿈)', N('2.5kg', '2026-11-17') === O('2.5kg', '2026-11-17'));
}
// 두 파일의 고친 두 줄이 글자까지 같은지
const line = (src, mark) => { const l = src.replace(/\r\n/g, '\n').split('\n').find(x => x.includes(mark)); return l ? l.trim() : null; };
const A = newSrc('final-order-core.js'), B = newSrc('invoice-v2.js');
ok('두 파일 isoOf 줄 글자 같음', line(A, 'const isoOf = ') === line(B, 'const isoOf = ') && !!line(A, 'const isoOf = '));
ok('두 파일 「n일」 줄 글자 같음', line(A, "\\s*일/))) { d = +m[1]") === line(B, "\\s*일/))) { d = +m[1]") && !!line(A, "\\s*일/))) { d = +m[1]"));
console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); process.exit(fail ? 1 : 0);
