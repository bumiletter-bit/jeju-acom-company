// #459 검증: 네이버 발주확인 응답 「이미 발주확인됨」 판정 — server.js 실코드를 떼어 실제 값으로 실행
//   104443 「이미 발주확인 된 주문입니다」 = already(무해·알림 없음) · 105306 무회귀 · 그 밖의 실패는 종전대로 failed
const fs = require('fs'); const path = require('path');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 200) : '')); };
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const m = src.match(/const naverConfirmIsAlready = [^\n]+/);
ok(!!m, '판정 함수가 server.js에 있음');
const isAlready = new Function(m[0] + '\nreturn naverConfirmIsAlready;')();
const CASES = [
    [{ id: '1', code: '104443', message: '이미 발주확인 된 주문입니다.' }, true, '104443 실응답(9/19 실기록)'],
    [{ id: '2', code: '105306', message: '변경을 요청한 상태가 기존과 동일합니다.' }, true, '105306 무회귀'],
    [{ id: '3', code: '999999', message: '이미 발주 확인된 주문' }, true, '코드가 달라도 문구가 「이미 발주확인」'],
    [{ id: '4', code: '104441', message: '취소 요청 중인 주문입니다.' }, false, '다른 실패는 실패로'],
    [{ id: '5', code: '', message: '응답에 처리 결과 없음' }, false, '응답 누락 = 실패(#83 무언 통과 금지)'],
    [{ id: '6', code: '', message: 'relay 403 forbidden' }, false, '통신 오류 = 실패'],
    [{ id: '7', code: '104443', message: '' }, true, '104443 · 문구 없음'],
    [null, false, 'null 방어'],
];
for (const [f, exp, t] of CASES) ok(isAlready(f) === exp, t + ' → ' + (exp ? 'already' : 'failed'), isAlready(f));
// 두 호출부(본선 수집기·소급/수동 경로)가 전부 공용 함수를 쓰는지 + 옛 직접 비교가 남지 않았는지
const uses = (src.match(/cr\.fail\.filter\(naverConfirmIsAlready\)/g) || []).length, neg = (src.match(/cr\.fail\.filter\(f => !naverConfirmIsAlready\(f\)\)/g) || []).length;
ok(uses === 2 && neg === 2, '호출부 2곳 모두 공용 함수 사용(already·realFail 짝)', `already ${uses} · realFail ${neg}`);
ok(!/f\.code [!=]== '105306'\)/.test(src), '옛 「105306만」 직접 비교 잔존 0');
// already로 분류된 건은 confirmFailed 집계에 안 들어가 텔레그램(confirmneed)이 안 뜬다 — 집계식 확인
ok(/confirmed = cr\.success\.length; confirmFailed = realFail\.length;/.test(src) && /const manualTotal = kakaoNotify\.switchOn\(\) \? manualKeys\.length \+ confirmFailed : 0;/.test(src), '알림 집계 = 발송 실패 + realFail만(already 제외)');
console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
