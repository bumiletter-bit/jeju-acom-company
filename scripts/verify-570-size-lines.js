// #570 메모 칸 「번호 + 사이즈」 줄 읽기 — 대표가 10/7 실제로 적은 꼴(번호는 가짜)로 core.sizeLines 를 node 단독 검사
const core = require('../public/final-order-core.js');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null ? ' — ' + String(d).slice(0, 200) : '')); };
const T = ['010-1111-1005 s사이즈 2건', '010-2222-0307 메모무시 2S사이즈', '010-3333-2366 m사이즈', '010-4444-6525 .2S사이즈', '010-5555-0995 2s사이즈', '010-6666-4385 2s사이즈', '010-7777-2043 s사이즈', '010-8888-5984 2s사이즈', '010-9999-5224 2s사이즈'];
const r = core.sizeLines(T.join('\n')); const out = r.text.split('\n');
ok(r.sizes.length === 9, '9줄 전부 사이즈를 읽음', r.sizes.length);
const by = Object.fromEntries(r.sizes.map(z => [z.digits.slice(-4), z]));
ok(by['1005'] && by['1005'].size === 'S' && by['1005'].expect === 2 && out[0] === '', '「s사이즈 2건」 = S · 건수 2 · 메모 줄은 비움(「번호 2건」이 남지 않음)', JSON.stringify([by['1005'] && by['1005'].expect, out[0]]));
ok(by['0307'] && by['0307'].size === '2S' && out[1] === '010-2222-0307 메모무시', '「메모무시 2S사이즈」 = 2S · 「번호 메모무시」만 남김', out[1]);
ok(by['2366'] && by['2366'].size === 'M' && out[2] === '', '「m사이즈」 = M', out[2]);
ok(by['6525'] && by['6525'].size === '2S' && out[3] === '', '「.2S사이즈」(앞에 점) = 2S 로 읽음 · 줄 비움', out[3]);
ok(['0995', '4385', '5984', '5224'].every(k => by[k] && by[k].size === '2S') && by['2043'].size === 'S', '2s사이즈 4줄 = 2S · s사이즈 = S');
ok(r.sizes.every(z => z.expect == null || z.digits.endsWith('1005')), '건수(expect)는 적은 줄에만');
// 종전 꼴 무회귀
const r2 = core.sizeLines('010-1234-5678 2s\n2026-10-07\t010-2222-3333\t입력o삭제x\n010-3333-4444 s사이즈로 7일발송\n이름만 적은 줄');
ok(r2.sizes.length === 2 && r2.sizes[0].size === '2S' && r2.sizes[1].size === 'S', '종전: 「번호 2s」 · 「s사이즈로 + 다른 말」 읽음', r2.sizes.map(z => z.size).join(','));
ok(r2.text.split('\n')[2] === '010-3333-4444 7일발송' && r2.text.split('\n')[1] === '2026-10-07\t010-2222-3333\t입력o삭제x' && r2.text.split('\n')[3] === '이름만 적은 줄', '종전: 남은 말은 그대로 · 탭 줄·번호 없는 줄 무변경', r2.text.split('\n')[2]);
ok(core.sizeLines('010-1234-5678 3건').sizes.length === 0 && core.sizeLines('010-1234-5678 3건').text === '010-1234-5678 3건', '「번호 3건」(사이즈 없음)은 종전대로 그대로 둠');
ok(core.sizeLines('010-1234-5678 S size,').sizes[0] && core.sizeLines('010-1234-5678 S size,').sizes[0].size === 'S', '「S size,」(영문·쉼표) 읽음');
ok(core.sizeLines('010-1234-5678 2S싸이즈').sizes[0] && core.sizeLines('010-1234-5678 2S싸이즈').sizes[0].size === '2S', '「2S싸이즈」 읽음');
// 탭 줄(요청일자<TAB>번호<TAB>비고<TAB>플랫폼) — 비고 칸의 사이즈만 떼고 탭 칸은 그대로(워커2 지적: 사진→틀 줄은 비고 칸에 사이즈가 들어간다)
{ const t = core.sizeLines('10/9\t010-1234-5678\t2S사이즈\t네이버\n10/9\t010-2222-3333\t입력o삭제x S사이즈 2건\t쿠팡'); const L = t.text.split('\n');
  ok(t.sizes.length === 2 && t.sizes[0].size === '2S' && L[0] === '10/9\t010-1234-5678\t\t네이버', '탭 줄: 비고 칸의 사이즈를 떼고 탭 칸은 그대로(비고만 빔)', JSON.stringify(L[0]));
  ok(t.sizes[1].size === 'S' && t.sizes[1].expect === 2 && L[1] === '10/9\t010-2222-3333\t입력o삭제x\t쿠팡', '탭 줄: 「입력o삭제x S사이즈 2건」 → 입력o삭제x 만 남고 건수는 expect', JSON.stringify(L[1])); }
console.log(`\n#570 sizeLines: ${pass} 통과 / ${fail} 실패`); process.exit(fail ? 1 : 0);
