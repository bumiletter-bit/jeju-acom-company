// #508 검증: 최종발주 순수 로직(public/final-order-core.js) — node 단독 실행(서버·DB 불요)
//   ① 메모 줄 다듬기 판정표(설계서 §5): 보통 줄 무변경 · 개별발송 · 요일 · 보내는이 지정(이름·번호·주소·수취인 한정·애매) · 줄 수 보존
//      + 다듬은 줄을 v2 실코드(invoice-v2.js 의 parseDate·parseLines 를 떼어 실행)가 기대대로 읽는지
//   ② 보내는이 지정 → 주문 맞추기 ③ 현금파일 읽기·대조 4종 ④ 나눠 보내기 신호 ⑤ 거래처·제주
//   ⑥ 행 묶음: 정렬 · 제주 맨 아래 · 같은 옵션 안 현금 먼저 · 기본 문구는 빈칸에만 · 보내는이 칸 ⑦ 시트를 xlsx 로 써서 다시 읽기(13칸·머리글·색) ⑧ 수량 시트
//   자료는 전부 가짜(이름·번호·주소) — 공개 저장소.
const path = require('path'); const fs = require('fs');
const XLSX = require('xlsx-js-style');
const core = require('../public/final-order-core.js');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 260) : '')); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const T = '\t';
// 기준: 2026-10-05(월). 발송일 = 월~금·일(토요일 제외)
const OPT = { realToday: '2026-10-05', shipDays: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-11', '2026-10-12'], noShip: [] };
const prep = (text, o) => core.prepLines(text, o || OPT);
const one = (line, o) => { const r = prep(line, o); return { out: r.v2Text, s: r.senders[0] || null, senders: r.senders, notes: r.notes, types: r.notes.map(n => n.type) }; };

// v2 실코드(줄 읽기)를 떼어 실행 — 다듬은 줄을 v2 가 어떻게 읽는지 확인하는 기준
const v2src = fs.readFileSync(path.join(__dirname, '..', 'public', 'invoice-v2.js'), 'utf8');
const a0 = v2src.indexOf('function parseDate(s, today)'), b0 = v2src.indexOf('function rebuild(ctx)');
const isoLine = (v2src.match(/const isoOf = .*\n/) || [''])[0];
const V2 = (a0 > 0 && b0 > a0 && isoLine) ? new Function(isoLine + v2src.slice(a0, b0) + '\nreturn { parseDate, parseLines };')() : null;
const v2read = (text, today) => V2.parseLines(text, 'naver', today || OPT.realToday);

console.log('① 메모 줄 다듬기');
ok(!!V2, 'v2 줄 읽기 실코드(parseDate·parseLines) 추출');
{
    const dates = ['9/20/26', '2026-09-20', '9.20', '9월 20일', '20일', '오늘', '내일', '없음', '010-1111-2222', '13/40', '1일', '10/5'];
    const diff = dates.filter(s => core.parseDate(s, '2026-10-05') !== V2.parseDate(s, '2026-10-05'));
    ok(diff.length === 0, 'core.parseDate = v2 parseDate(12가지 꼴)', diff.join(' , '));
}
// 보통 줄 = 한 글자도 안 바뀜
{
    const normal = [
        '요청일자' + T + '전화번호 또는 상품주문번호' + T + '비고' + T + '플렛폼',
        '10/5/26' + T + '010-1111-2222' + T + '입력o삭제x 2건' + T + '네이버',
        '10/6/26' + T + '010-1111-3333' + T + T + '네이버',
        '10/5/26' + T + '010-1111-4444' + T + '메모무시' + T + '네이버',
        '10/5/26' + T + '20261004-0000011' + T + '자사몰!! 입력o삭제X' + T + '자사몰',
        '',
        '010-1111-5555 21일 발송',
        '10/5 010-1111-6666 2건 중 1건(수취인 김가짜 만)',
        '  10/7/26' + T + '010-1111-7777' + T + '3건' + T + '쿠팡\r',
        '10/9' + T + '010-1111-8888' + T + '금요일 발송' + T + '네이버',
        'ex) 10박스 중 2박스 (17,19,21,22,30일)"' + T + '"플렛폼"',
        '번호가 없는 줄',
        '010-1111-9999',
    ];
    const text = normal.join('\n'); const r = prep(text);
    ok(r.v2Text === text, '보통 줄 13종(탭·공백·머리말·빈 줄·예시 줄·형식 오류 줄) = 글자 그대로', r.v2Text === text ? null : JSON.stringify(r.v2Text.split('\n').filter((l, i) => l !== normal[i])));
    ok(r.senders.length === 0 && r.notes.length === 0, '보통 줄에는 보내는이·안내가 생기지 않음(머리말 예시 「10박스 중 2박스」 포함)', JSON.stringify(r.notes));
}
// 개별발송
{
    let x = one('10/5/26' + T + '010-1111-2222' + T + '개별발송처리' + T + '네이버');
    ok(x.out === '10/5/26' + T + '010-1111-2222' + T + '개별발송처리 입력o삭제x' + T + '네이버', '탭 줄 「개별발송처리」 → 비고에 「입력o삭제x」 덧붙임(플랫폼 칸 유지)', x.out);
    const l = v2read(x.out)[0]; ok(l && l.indiv === true && l.date === '2026-10-05' && l.ch === 'naver', '  ↳ v2 가 개별발송(입력삭제)·날짜·플랫폼으로 읽음', JSON.stringify(l && { indiv: l.indiv, date: l.date, ch: l.ch }));
    x = one('10/5 010-1111-2222 개별발송');
    ok(x.out === '10/5 010-1111-2222 개별발송 입력o삭제x' && v2read(x.out)[0].indiv, '공백 줄 「개별발송」 → 덧붙임', x.out);
    x = one('10/5/26' + T + '010-1111-2222' + T + '개별발송 입력o삭제x' + T + '네이버');
    ok(x.out === '10/5/26' + T + '010-1111-2222' + T + '개별발송 입력o삭제x' + T + '네이버', '이미 「입력o삭제x」가 있으면 무변경', x.out);
    x = one('010-1111-2222 개별발송처리');
    ok(x.out === '010-1111-2222 개별발송처리 입력o삭제x' && x.types.includes('indiv-nodate'), '기준일을 안 받았을 때: 날짜 없는 개별발송 줄 → 덧붙이고 안내(indiv-nodate)', x.out + ' / ' + x.types);
    // 날짜 없는 개별발송·입력삭제 줄 = 기준 발송일(shipDate)로 읽는다
    const SD = Object.assign({}, OPT, { shipDate: '2026-10-06' });
    x = one('010-1111-2222 개별발송처리', SD);
    ok(x.out === '10/6 010-1111-2222 개별발송처리 입력o삭제x' && eq(x.types, ['indiv-today']) && x.notes[0].detail === '날짜가 없어 기준일 10/6 개별발송으로 읽었어요', '공백 줄 「번호 개별발송처리」 → 맨 앞에 「M/D 」 + 안내(indiv-today)', x.out + ' / ' + JSON.stringify(x.notes[0]));
    { const l = v2read(x.out, '2026-10-06')[0]; ok(l && l.indiv === true && l.date === '2026-10-06' && l.key === '010-1111-2222' && !l.bad, '  ↳ v2(기준일 10/6)가 그날 개별발송으로 읽음', JSON.stringify(l && { indiv: l.indiv, date: l.date, key: l.key })); }
    x = one(T + '010-1111-2222' + T + '개별발송' + T + '네이버', SD);
    ok(x.out === '10/6' + T + '010-1111-2222' + T + '개별발송 입력o삭제x' + T + '네이버' && v2read(x.out, '2026-10-06')[0].indiv && v2read(x.out, '2026-10-06')[0].ch === 'naver', '탭 줄(첫 칸 빈칸이 잘려 번호가 첫 칸) → 「M/D⇥번호⇥비고⇥플랫폼」', JSON.stringify(x.out));
    x = one('미정' + T + '010-1111-2222' + T + '입력o삭제x 2건' + T + '자사몰', SD);
    ok(x.out === '10/6' + T + '010-1111-2222' + T + '입력o삭제x 2건' + T + '자사몰' && eq(x.types, ['indiv-today']), '탭 줄 첫 칸이 날짜가 아님 + 「입력o삭제x」 → 첫 칸에 M/D', JSON.stringify(x.out));
    x = one('010-1111-2222 입력삭제', SD); ok(x.out === '10/6 010-1111-2222 입력삭제' && v2read(x.out, '2026-10-06')[0].indiv, '「입력삭제」만 적힌 줄도 같음', x.out);
    x = one('개별발송 010-1111-2222', SD); ok(x.out === '10/6 010-1111-2222 개별발송 입력o삭제x' && v2read(x.out, '2026-10-06')[0].indiv, '번호가 뒤에 온 줄', x.out);
    x = one('010-1111-2222 개별발송 보내는이 홍길동', SD); ok(x.out === '10/6 010-1111-2222 개별발송 입력o삭제x' && x.s.name === '홍길동' && eq(x.types, ['indiv-today']), '날짜 없는 개별발송 + 보내는이', x.out);
    x = one('10/7 010-1111-2222 개별발송', SD); ok(x.out === '10/7 010-1111-2222 개별발송 입력o삭제x' && x.notes.length === 0, '날짜가 적혀 있으면 그 날짜 그대로(기준일을 붙이지 않음)', x.out);
    x = one('010-1111-2222 금요일 개별발송', SD); ok(x.out === '10/9' + T + '010-1111-2222' + T + '금요일 개별발송 입력o삭제x' && eq(x.types, ['weekday']), '요일이 있으면 요일이 먼저(기준일을 붙이지 않음)', x.out);
    const plain = ['010-1111-9999', '010-1111-2222 3건', '010-1111-2222 메모무시', '10/5/26' + T + '010-1111-2222' + T + '입력o삭제x 2건' + T + '네이버', '010-1111-5555 21일 발송'];
    const r2 = prep(plain.join('\n'), SD); ok(r2.v2Text === plain.join('\n') && r2.notes.length === 0, '기준일을 받아도 개별발송이 아닌 날짜 없는 줄 · 날짜 있는 줄은 무변경', JSON.stringify(r2.v2Text.split('\n').filter((l, i) => l !== plain[i])));
    x = one('010-1111-2222 개별발송', Object.assign({}, OPT, { shipDate: '10/6' })); ok(x.types.includes('indiv-nodate') && !/^10\/6/.test(x.out), 'shipDate 가 YYYY-MM-DD 꼴이 아니면 붙이지 않음', x.out);
}
// 요일
{
    let x = one('000-0000-0000 금요일 발송');
    ok(x.out === '10/9' + T + '000-0000-0000' + T + '금요일 발송' && eq(x.types, ['weekday']) && x.notes[0].detail === '10/9 (금요일)', '대표 예시 「000-0000-0000 금요일 발송」 → 「10/9⇥번호⇥비고」', x.out + ' / ' + JSON.stringify(x.notes[0]));
    const l = v2read(x.out)[0]; ok(l && l.date === '2026-10-09' && l.key === '000-0000-0000' && !l.bad, '  ↳ v2 가 10/9 줄로 읽음', JSON.stringify(l && { date: l.date, key: l.key }));
    x = one('010-1111-2222 월요일 발송'); ok(x.out.startsWith('10/5' + T), '오늘이 그 요일이면 오늘(월요일 → 10/5)', x.out);
    x = one('010-1111-2222 화욜 발송'); ok(x.out.startsWith('10/6' + T), '「화욜」 줄임말', x.out);
    x = one('010-1111-2222 토요일 발송'); ok(x.out.startsWith('10/10' + T) && eq(x.types, ['weekday', 'line-noship']) && /토요일/.test(x.notes[1].detail), '토요일로 풀림 → 줄은 넘기고 카드(line-noship)', x.out + ' / ' + x.types);
    x = one('010-1111-2222 금요일 발송', Object.assign({}, OPT, { noShip: ['2026-10-09'] })); ok(x.out.startsWith('10/9' + T) && x.types.includes('line-noship') && /발송휴무일/.test(x.notes[1].detail), '발송휴무일로 풀림(noShip 배열) → 카드', x.types);
    x = one('010-1111-2222 금요일 발송', Object.assign({}, OPT, { noShip: new Set(['2026-10-09']) })); ok(x.types.includes('line-noship'), 'noShip 이 Set 이어도 같음', x.types);
    x = one('010-1111-2222 다음주 금요일 발송'); ok(x.out === '010-1111-2222 다음주 금요일 발송' && x.notes.length === 0, '「다음주 금요일」은 풀지 않음(무변경 → v2 가 날짜 없음으로 알림)', x.out);
    x = one('010-1111-2222 월요일 화요일'); ok(x.out === '010-1111-2222 월요일 화요일' && x.notes.length === 0, '요일이 둘이면 풀지 않음', x.out);
    x = one('금요일' + T + '010-1111-2222' + T + T + '네이버'); ok(x.out === '10/9' + T + '010-1111-2222' + T + T + '네이버', '탭 줄 첫 칸이 요일 → 그 칸만 날짜로', x.out);
    x = one('금요일 010-1111-2222 발송'); ok(x.out === '10/9' + T + '010-1111-2222' + T + '금요일 발송' && v2read(x.out)[0].date === '2026-10-09', '요일이 번호 앞에 온 줄', x.out);
    x = one('010-1111-2222 21일 금요일 발송'); ok(x.out === '010-1111-2222 21일 금요일 발송' && x.notes.length === 0, '날짜가 이미 있으면 요일을 건드리지 않음', x.out);
}
// 나눠 보내기 표시(줄은 그대로)
{
    let x = one('10/5' + T + '010-1111-2222' + T + '10박스 중 2박스' + T + '네이버'); ok(x.out === '10/5' + T + '010-1111-2222' + T + '10박스 중 2박스' + T + '네이버' && eq(x.types, ['line-split']), '「N박스 중 M박스」 → 카드(line-split) · 줄 무변경', x.types);
    x = one('10/5 010-1111-2222 2박스는 다른 곳'); ok(eq(x.types, ['line-split']), '「N박스는」', x.types);
    x = one('10/5 010-1111-2222 3건 나머지는 21일'); ok(eq(x.types, ['line-split']), '「나머지」', x.types);
    x = one('10/5 010-1111-2222 2건 중 1건'); ok(x.notes.length === 0, '「N건 중 1건」은 v2 가 이미 확인필요로 읽으므로 표시 안 함', x.types);
}
// 보내는이 지정
{
    let x = one('010-1111-2222 보내는이 홍길동');
    ok(x.out === '' && x.s && x.s.name === '홍길동' && x.s.phone === null && x.s.addr === null && x.s.digits === '01011112222' && x.s.ambiguous === false, '날짜 없는 보내는이 줄 → v2 엔 빈 줄 · 이름만', JSON.stringify(x.s));
    x = one('010-1111-2222 보내는이 홍길동 010-3333-4444 주소 제주도 제주시 가짜로 12');
    ok(x.out === '' && x.s.name === '홍길동' && x.s.phone === '010-3333-4444' && x.s.addr === '제주도 제주시 가짜로 12' && !x.s.ambiguous, '대표 예시: 이름 · 번호 · 「주소」 뒤 글자 전부', JSON.stringify(x.s));
    x = one('10/6/26' + T + '010-1111-2222' + T + '보내는이 홍길동으로 변경' + T + '네이버');
    ok(x.out === '10/6/26' + T + '010-1111-2222' + T + T + '네이버' && x.s.name === '홍길동' && !x.s.ambiguous, '날짜 있는 줄 → 보내는이 부분만 빼고 넘김(「으로 변경」 꼬리 뗌)', JSON.stringify(x.out));
    { const l = v2read(x.out)[0]; ok(l.date === '2026-10-06' && l.note === '' && l.ch === 'naver', '  ↳ v2 는 날짜·플랫폼만 읽음', JSON.stringify({ date: l.date, note: l.note, ch: l.ch })); }
    x = one('10/5/26' + T + '010-1111-2222' + T + '개별발송 보내는이 (주)가짜상사 홍길동 대표' + T + '네이버');
    ok(x.out === '10/5/26' + T + '010-1111-2222' + T + '개별발송 입력o삭제x' + T + '네이버' && x.s.name === '(주)가짜상사 홍길동 대표', '개별발송 + 보내는이 한 줄 → 둘 다 처리(회사·직함 이름 그대로)', x.out + ' / ' + x.s.name);
    x = one('10/5 010-1111-2222 수취인 김받음 보내는이 홍길동');
    ok(x.out === '10/5 010-1111-2222 수취인 김받음' && x.s.recipient === '김받음', '수취인 한정(앞) → 줄에 남기고 지정에도 담음', x.out);
    x = one('010-1111-2222 보내는이 홍길동 (수취인 김받음 만)');
    ok(x.out === '' && x.s.recipient === '김받음' && x.s.name === '홍길동' && !x.s.ambiguous, '수취인 한정(뒤) → 이름에 섞이지 않음', JSON.stringify(x.s));
    const names = [
        ['보내는이 홍길동 드림', '홍길동'], ['보내는 사람: 홍길동', '홍길동'], ['보내는분 홍길동 올림', '홍길동'], ['발신 홍길동', '홍길동'], ['보낸이 홍길동 변경', '홍길동'],
        ['보내는이는 홍길동', '홍길동'], ['보내는 사람 이름: 홍길동', '홍길동'], ['보내는이 변경 홍길동', '홍길동'], ['보내는이 「홍길동」으로 표기 부탁', '홍길동'],
        ['보내는이 김수정', '김수정'], ['보내는이 김수정 변경', '김수정'], ['보내는이 남궁수정', '남궁수정'], ['보내는이 은지원', '은지원'], ['보내는이 이순신으로 해주세요', '이순신'],
        ['보내는이 김성로 변경', '김성로'], ['보내는이 정중구로 변경', '정중구'], ['보내는이 가짜로지스 변경', '가짜로지스'], ['보내는이 홍길동변경', '홍길동'],
        ['보내는이 가짜농원 홍길동 연락처 010-3333-4444', '가짜농원 홍길동'],
    ];
    const bad = names.map(([n, exp]) => { const s = one('010-1111-2222 ' + n).s; return s && s.name === exp && !s.ambiguous ? null : `${n} → ${s && s.name}${s && s.ambiguous ? '(애매:' + s.why + ')' : ''}`; }).filter(Boolean);
    ok(bad.length === 0, `이름 읽기 ${names.length}꼴(꼬리 떼기 · 이름 속 「수정」「로」 보존 · 조사)`, bad.join(' | '));
    x = one('010-1111-2222 보내는이 가짜농원 홍길동 연락처 010-3333-4444'); ok(x.s.phone === '010-3333-4444', '「연락처」 낱말 뒤 번호', x.s.phone);
    x = one('010-1111-2222 보내는이 홍길동 02-123-4567'); ok(x.s.phone === '02-123-4567' && !x.s.ambiguous, '서울 번호(9자리)', x.s.phone);
    x = one('010-1111-2222 보내는이 홍길동 01033334444 주소: 서울시 가짜구 가짜로 1, 101호'); ok(x.s.phone === '010-3333-4444' && x.s.addr === '서울시 가짜구 가짜로 1, 101호', '붙여 쓴 번호 → 하이픈 · 「주소:」', JSON.stringify(x.s));
    x = one('010-1111-2222 보내는이 홍길동 주소 은평구 가짜로 3'); ok(x.s.addr === '은평구 가짜로 3' && x.s.phone === null && !x.s.ambiguous, '번호 없이 주소만 · 「주소 은평구」의 「은」을 먹지 않음', JSON.stringify(x.s));
    x = one('10/5' + T + '010-1111-2222' + T + '입력o삭제x 보내는분: (주)가짜 홍길동 대표 / 02-123-4567 / 주소: 서울 가짜구 가짜로 1' + T + '네이버');
    ok(x.out === '10/5' + T + '010-1111-2222' + T + '입력o삭제x' + T + '네이버' && x.s.name === '(주)가짜 홍길동 대표' && x.s.phone === '02-123-4567' && x.s.addr === '서울 가짜구 가짜로 1' && !x.s.ambiguous, '빗금(/)으로 나눠 적은 이름 / 번호 / 주소', JSON.stringify(x.s));
    x = one('010-1111-2222 내일 발송 보내는이 홍길동'); ok(x.out === '010-1111-2222 내일 발송' && x.s.name === '홍길동' && !x.s.ambiguous, '공백 줄의 날짜 글자(내일)가 보내는이 앞에 있으면 줄에 남김', x.out);
    x = one('2026100512345678 보내는이 홍길동'); ok(x.s.key === '2026100512345678' && x.out === '', '상품주문번호 줄', x.s.key);
    x = one('20261004-0000011 보내는이 홍길동'); ok(x.s.ch === 'cafe24', '자사몰 주문번호 → 플랫폼 자사몰', x.s.ch);
    x = one('010-1111-2222 보내는이 홍길동 자사몰'); ok(x.s.name === '홍길동' && x.s.ch === 'cafe24' && x.out === '', '끝의 플랫폼 낱말은 이름에 섞이지 않음', JSON.stringify(x.s));
    x = one('010-1111-2222 개별발송 보내는이 홍길동'); ok(x.out === '010-1111-2222 개별발송 입력o삭제x' && x.s.name === '홍길동' && x.types.includes('indiv-nodate'), '날짜는 없지만 다른 지시(개별발송)가 있으면 줄을 넘김', x.out);
    x = one('010-1111-2222 금요일 발송 보내는이 홍길동'); ok(x.out === '10/9' + T + '010-1111-2222' + T + '금요일 발송' && x.s.name === '홍길동', '요일 + 보내는이', x.out);
    // 애매 → 자동으로 넣지 않고 읽어낸 만큼만 담아 카드로
    const amb = [
        ['보내는이', '이름 없음'], ['보내는이 홍길동 010-3333-4444 제주도 제주시 가짜로 12', '번호 뒤 글(주소 낱말 없음)'], ['보내는이 홍길동 21일 발송', '날짜 글자'],
        ['보내는이 홍길동 보내는이 김철수', '두 번'], ['보내는이 가나다라마바사아자차카타파하가나다라마바사', '20자 넘음'], ['보내는이 홍길동 주소', '주소 뒤 빈칸'],
        ['보내는이 김미로 변경', '「로」'], ['보내는이 홍길동 서울시 가짜구', '주소 낱말 없이 주소 글'], ['보내는이 홍길동 금요일 발송 부탁', '발송 지시'],
    ];
    const notAmb = amb.filter(([n]) => { const s = one('010-1111-2222 ' + n).s; return !(s && s.ambiguous && s.why); });
    ok(notAmb.length === 0, `애매한 꼴 ${amb.length}종 → ambiguous + 사유`, notAmb.map(a => a[0]).join(' | '));
    x = one('010-1111-2222 보내는이 홍길동 010-3333-4444 제주도 제주시 가짜로 12'); ok(x.s.ambiguous && x.s.name === '홍길동' && x.s.phone === '010-3333-4444' && x.s.addr === '제주도 제주시 가짜로 12', '애매해도 읽어낸 이름·번호·주소 후보는 담음(카드 입력칸용)', JSON.stringify(x.s));
    // 「주소」 낱말 없이 이름 뒤에 글이 더 남으면 애매 — 요청 꼬리뿐이면 확실
    x = one('010-7000-1004 보내는이 최직원 꼭 부탁드립니다 빠르게'); ok(x.s.ambiguous === true && x.s.name === '최직원' && x.s.addr === null && /글이 더 있어요/.test(x.s.why), '이름 뒤에 요청 꼬리 말고 다른 글 → 애매(이름은 첫 덩어리만)', JSON.stringify(x.s));
    x = one('010-7000-1005 보내는이 이직원 부산 가짜구 가짜로 77'); ok(x.s.ambiguous === true && x.s.name === '이직원' && x.s.addr === '부산 가짜구 가짜로 77' && /주소/.test(x.s.why), '「주소」 낱말 없이 주소 글 → 애매 · 이름 = 첫 덩어리 · 나머지는 주소 후보', JSON.stringify(x.s));
    const sure = ['보내는이 홍길동으로 변경 부탁드립니다', '보내는이 홍길동으로 해주세요', '보내는이 홍길동 변경 부탁드려요!', '보내는이 홍길동이라고 적어주세요', '보내는이 홍길동으로 변경해서 보내주세요', '보내는이 홍길동 드림으로 표기 부탁드립니다.'];
    const notSure = sure.filter(n => { const s = one('010-1111-2222 ' + n).s; return !(s && s.name === '홍길동' && !s.ambiguous); });
    ok(notSure.length === 0, `요청 꼬리뿐인 ${sure.length}꼴은 확실(자동 적용)`, notSure.map(n => n + ' → ' + JSON.stringify(one('010-1111-2222 ' + n).s)).join(' | '));
    const unsure = ['보내는이 홍길동으로 변경하고 21일 발송', '보내는이 홍길동 변경 그리고 문 앞', '보내는이 홍길동 부탁드립니다 감사합니다'];
    const wrongSure = unsure.filter(n => !one('010-1111-2222 ' + n).s.ambiguous);
    ok(wrongSure.length === 0, `꼬리 뒤에 다른 글이 이어진 ${unsure.length}꼴은 애매`, wrongSure.join(' | '));
    x = one('보내는이 홍길동'); ok(x.out === '보내는이 홍길동' && x.senders.length === 0, '번호 없는 보내는이 줄 = 무변경(v2 가 형식 오류로 알림)', x.out);
    // 줄 수·줄 번호 보존
    const text = ['10/5/26' + T + '010-1111-2222' + T + '개별발송' + T + '네이버', '010-1111-3333 보내는이 홍길동', '', '010-1111-4444 금요일 발송', '10/6' + T + '010-1111-5555' + T + '보내는이 김철수 주소 서울시 가짜구 가짜로 9' + T + '네이버'].join('\n');
    const r = prep(text); const outL = r.v2Text.split('\n');
    ok(outL.length === 5 && outL[1] === '' && outL[2] === '' && eq(r.senders.map(s => s.srcLine), [1, 4]) && r.notes[0].srcLine === 3, '줄 수 = 입력 줄 수 · srcLine 유지', JSON.stringify(outL));
    const v = v2read(r.v2Text); ok(v.length === 3 && eq(v.map(l => l.srcLine), [0, 3, 4]) && v[0].indiv && v[1].date === '2026-10-09' && v[2].date === '2026-10-06' && v[2].note === '', '  ↳ v2 가 읽은 줄 번호·판정', JSON.stringify(v.map(l => [l.srcLine, l.date, l.indiv, l.note])));
}

console.log('② 보내는이 지정 → 주문');
{
    const orders = [
        { key: 'naver:0', digits: '01011112222', ids: ['2026100500000001'], recipient: '김받음', ch: 'naver' },
        { key: 'naver:1', digits: '01011112222', ids: ['2026100500000002'], recipient: '이받음', ch: 'naver' },
        { key: 'naver:2', digits: '01055556666', ids: ['2026100500000003'], recipient: '박받음', ch: 'naver' },
        { key: 'cafe24:0', digits: '01011112222', ids: ['20261004-0000011'], recipient: '최받음', ch: 'cafe24' },
        { key: 'naver:3', digits: '01000000000', ids: ['2026100500000004'], recipient: '선물', ch: 'naver' },
    ];
    const S = (o) => Object.assign({ srcLine: 0, raw: '', key: '', digits: '', recipient: null, name: '홍길동', phone: null, addr: null, ambiguous: false, ch: 'naver' }, o);
    let r = core.applySenders([S({ key: '010-1111-2222', digits: '01011112222' })], orders);
    ok(r.byKey instanceof Map && eq([...r.byKey.keys()], ['naver:0', 'naver:1']) && r.nohit.length === 0, '번호가 같은 주문 전부(같은 플랫폼만)', [...r.byKey.keys()]);
    r = core.applySenders([S({ key: '010-1111-2222', digits: '01011112222', recipient: '이받음', phone: '010-3333-4444', addr: '서울시 가짜구' })], orders);
    ok(eq([...r.byKey.entries()], [['naver:1', { name: '홍길동', phone: '010-3333-4444', addr: '서울시 가짜구' }]]), '「수취인 ○○○」 → 그 수취인만 · 번호·주소 전달', JSON.stringify([...r.byKey.entries()]));
    r = core.applySenders([S({ key: '2026100500000003', digits: '2026100500000003' })], orders); ok(eq([...r.byKey.keys()], ['naver:2']), '상품주문번호로 맞춤', [...r.byKey.keys()]);
    r = core.applySenders([S({ key: '20261004-0000011', digits: '202610040000011', ch: 'cafe24' })], orders); ok(eq([...r.byKey.keys()], ['cafe24:0']), '자사몰 주문번호', [...r.byKey.keys()]);
    r = core.applySenders([S({ key: '010-9999-8888', digits: '01099998888', srcLine: 7 })], orders); ok(r.byKey.size === 0 && r.nohit.length === 1 && r.nohit[0].srcLine === 7, '맞는 주문 0건 → nohit', r.nohit.length);
    r = core.applySenders([S({ key: '010-0000-0000', digits: '01000000000' })], orders); ok(r.byKey.size === 0 && r.nohit.length === 1, '자리표시 번호(010-0000-0000)로는 맞추지 않음', r.byKey.size);
    r = core.applySenders([S({ key: '010-1111-2222', digits: '01011112222', ambiguous: true })], orders); ok(r.byKey.size === 0 && r.nohit.length === 0, '애매한 지정은 건너뜀(카드에서 확정한 뒤 다시)', r.byKey.size);
    r = core.applySenders([S({ key: '010-1111-2222', digits: '01011112222', ch: undefined })], orders.map(o => Object.assign({}, o, { ch: undefined }))); ok(r.byKey.size === 3, '플랫폼 정보가 없으면 번호만으로', r.byKey.size);
}

console.log('③ 현금파일');
const H13 = core.HEADERS.slice();
const cashRow = (snd, name, opt, qty, addr, memo, btel, maddr) => [snd, '010-7000-0001', '제주특별자치도 제주시 가짜로 1, 제주아꼼이네', name, opt, qty, '010-8000-0001', '', addr, memo == null ? core.DEFAULT_MEMO : memo, btel, '', maddr || ''];
const O_H1 = '고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)', O_H2 = '고당도 하우스감귤 / 상품 및 과수: 선물용 - 3kg(로얄과)', O_G1 = '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)', O_G2 = '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)';
{
    const aoa = [H13,
        cashRow('홍길동 드림', '김받음', O_H2, 1, '서울시 가짜구 가짜로 1', null, '010-1111-2222'),
        cashRow('홍길동 드림', '이받음', O_H2, 2, '부산시 가짜구 가짜로 2', null, '010-1111-2222'),
        [], ['', '', '', '', '', '', '', '', '', '', '', '', ''],
        cashRow('현금손님 드림!', '박받음', O_G1, 3, '제주특별자치도 제주시 가짜로 3', '', '010-7000-0001'),
        cashRow('현금둘(제주아꼼이네!)', '최받음', O_G1, 1, '대구시 가짜구 가짜로 4', null, '010-7000-0002'),
    ];
    const c = core.parseCash(aoa);
    ok(c.ok && c.rows.length === 4 && eq(c.rows.map(r => r.no), [2, 3, 6, 7]), '13칸 현금파일 읽기 · 빈 줄 건너뜀 · no = 엑셀 행 번호', JSON.stringify(c.rows.map(r => r.no)) + ' ' + c.error);
    ok(eq(c.rows.map(r => r.bang), [false, false, true, true]) && c.rows[0].digits === '01011112222' && c.rows[1].qty === 2 && c.rows[2].opt === O_G1 && c.rows[0].cells.length === 13 && c.rows[0].cells[6] === '010-8000-0001', '「!」 = 보내는사람 칸 느낌표 · 구매자 = K칸 숫자 · 번호는 글자 그대로', JSON.stringify(c.rows.map(r => r.bang)));
    const c11 = core.parseCash(aoa.map(r => r.slice(0, 11))); ok(c11.ok && c11.rows[0].cells.length === 13 && c11.rows[0].cells[12] === '', 'L·M 없는 11칸 파일도 읽음(빈칸으로 채움)', c11.error);
    const cOld = core.parseCash([H13.map((h, i) => (i === 11 ? '박스타입' : h))].concat(aoa.slice(1, 2))); ok(cOld.ok, '머리글 「박스타입」(옛 꼴)도 허용', cOld.error);
    const bad1 = core.parseCash([['상품주문번호', '배송방법'], ['1', '택배']]); ok(!bad1.ok && /머리글/.test(bad1.error) && bad1.rows.length === 0, '머리글이 다르면 실패', bad1.error);
    const bad2 = core.parseCash([H13, cashRow('가 드림', '나', O_H2, '두개', '서울시 가짜구', null, '010-1111-2222'), cashRow('가 드림', '다', O_H2, 1, '', null, '010-1111-2222')]);
    ok(!bad2.ok && /2행 수량/.test(bad2.error) && /3행 배송지/.test(bad2.error) && bad2.rows.length === 2, '수량이 숫자가 아님 · 배송지 빈칸 → 행 번호와 함께', bad2.error);
    ok(!core.parseCash(null).ok && !core.parseCash([]).ok, '빈 입력 → 실패(예외 없음)');

    // 대조 4종
    const cash = core.parseCash([H13,
        cashRow('가 드림', '받1', O_H2, 1, '서울시 가짜구 1', null, '010-1111-0001'), cashRow('가 드림', '받2', O_H2, 1, '서울시 가짜구 2', null, '010-1111-0001'),   // 구매자 0001: 2박스
        cashRow('나 드림', '받3', O_H2, 3, '서울시 가짜구 3', null, '010-1111-0002'),   // 구매자 0002: 3박스(주문은 2)
        cashRow('다(제주아꼼이네)', '받4', O_H2, 1, '서울시 가짜구 4', null, '010-1111-0003'),   // 구매자 0003: 주문은 입력삭제 아님
        cashRow('라 드림', '받5', O_H2, 1, '서울시 가짜구 5', null, '010-1111-0009'),   // 주문에 없는 구매자
        cashRow('현금 드림!', '받6', O_H2, 5, '서울시 가짜구 6', null, '010-1111-0004'),   // 현금(!) — 대조 제외(0004 는 입력삭제인데 ! 줄뿐)
        cashRow('마 드림', '받7', O_H2, 1, '서울시 가짜구 7', null, '010-0000-0000'),   // 자리표시 번호
        cashRow('바 드림', '받8', O_H2, 1, '서울시 가짜구 8', null, '1234567'),   // 8자리 미만
    ]);
    const orders = [
        { key: 'naver:0', digits: '01011110001', qty: 2, individual: true, excluded: false, buyer: '가' },
        { key: 'naver:1', digits: '01011110002', qty: 2, individual: true, excluded: false, buyer: '나' },
        { key: 'naver:2', digits: '01011110003', qty: 1, individual: false, excluded: false, buyer: '다' },
        { key: 'naver:3', digits: '01011110004', qty: 4, individual: true, excluded: false, buyer: '라' },
        { key: 'naver:4', digits: '01011110005', qty: 1, individual: false, excluded: false, buyer: '마' },
        { key: 'naver:5', digits: '01000000000', qty: 1, individual: true, excluded: false, buyer: '선물' },
        { key: 'naver:6', digits: '1234567', qty: 1, individual: false, excluded: false, buyer: '짧음' },
    ];
    const k = core.cashCheck({ orders, cash: cash.rows });
    ok(eq(k.missing, [{ digits: '01011110004', buyer: '라', qty: 4 }]), '입력삭제인데 현금파일(「!」 없는 행)에 줄 없음 → missing(「!」 행은 세지 않음)', JSON.stringify(k.missing));
    ok(k.notIndiv.length === 1 && k.notIndiv[0].digits === '01011110003' && eq(k.notIndiv[0].cashRows, [5]) && eq(k.notIndiv[0].orderKeys, ['naver:2']), '현금파일에 있는데 입력삭제 아님 → notIndiv(행 번호·주문 키)', JSON.stringify(k.notIndiv));
    ok(eq(k.boxDiff, [{ digits: '01011110002', buyer: '나', orderQty: 2, cashQty: 3 }]), '박스 수 다름 → boxDiff(같은 구매자 0001 은 2=2 라 없음)', JSON.stringify(k.boxDiff));
    ok(k.strangers.some(s => s.digits === '01011110009' && eq(s.rows, [6])) && !k.strangers.some(s => s.digits === '01011110004'), '주문에 없는 구매자 → strangers(안내만)', JSON.stringify(k.strangers));
    ok(!k.missing.some(m => m.digits === '01000000000') && !k.notIndiv.some(m => ['01000000000', '1234567'].includes(m.digits)) && !k.boxDiff.some(m => ['01000000000', '1234567'].includes(m.digits)), '자리표시 번호·8자리 미만은 대조에서 제외', JSON.stringify([k.missing.length, k.notIndiv.length, k.boxDiff.length]));
    const k2 = core.cashCheck({ orders, cash });   // parseCash 결과를 통째로 넘겨도 같음
    ok(eq(k2.missing, k.missing) && eq(k2.boxDiff, k.boxDiff), 'cash 에 rows 배열 대신 parseCash 결과를 넘겨도 같은 결과');
    const k3 = core.cashCheck({ orders: [{ key: 'a', digits: '01011110001', qty: 2, individual: true, excluded: false, buyer: '가' }], cash: cash.rows.slice(0, 2) });
    ok(!k3.missing.length && !k3.notIndiv.length && !k3.boxDiff.length && !k3.strangers.length, '맞아떨어지면 카드 0', JSON.stringify(k3));
    const k4 = core.cashCheck({ orders: [{ key: 'a', digits: '01011110001', qty: 2, individual: false, excluded: true, buyer: '가' }], cash: cash.rows.slice(0, 2) });
    ok(k4.notIndiv.length === 1 && k4.notIndiv[0].allExcluded === true, '주문이 전부 뒤 날짜로 빠졌는데 현금파일에 줄 있음 → notIndiv(allExcluded 표시)', JSON.stringify(k4.notIndiv));
    const k5 = core.cashCheck({ orders, cash: [] }); ok(k5.missing.length === 3 && !k5.notIndiv.length, '현금파일 없음(빈 배열) → 입력삭제 주문 전부 missing', k5.missing.length);
}

console.log('④ 나눠 보내기 신호(손님 메모)');
{
    const B = '01011112222', R = ['01088880001', ''];
    const sig = (memo, qty) => core.splitSignal({ memo, qty: qty == null ? 2 : qty, buyerDigits: B, recvDigits: R });
    const yes = [
        '톡톡으로 주소 따로 보내드리겠습니다 2개는 다른 배송지로', '개별발송 부탁드립니다', '1. 가짜군 가짜면 가짜로 12 / 홍길동 010-3333-4444 2. 가짜시 가짜구 가짜로 3길 5 / 김철수 010-5555-6666',
        '보내실 주소는 가짜시 가짜구 가짜로 77 101동 202호 홍길동님 010-3333-4444', '1박스는 010-3333-4444 여기로', '2박스는 따로 보내주세요', '한 박스는 저희 집, 나머지는 사무실로', '3개는 각각 포장',
        '101동 1001호로 보내주세요',
    ];
    const no = [
        '공동현관 비밀번호 1234#', '문 앞에 놔주세요', '부재 시 경비실에 맡겨주세요', '부재시 010-3333-4444 로 연락주세요', '배송 전 연락 바랍니다 010-3333-4444', '보내는이 홍길동 010-3333-4444',
        '빠른 배송 부탁드립니다', '21일 도착 부탁드려요', '앞으로 2박스 더 주문할게요', '101동 1001호 문 앞', '010-1111-2222', '010-8888-0001 로 전화주세요', '맛있는 걸로 2박스 잘 부탁드립니다', '상품주문 2026091812345678 건',
    ];
    const miss = yes.filter(m => !sig(m)), wrong = no.filter(m => sig(m));
    ok(miss.length === 0, `신호 ${yes.length}꼴(주소 낱말 · 개별발송 · 주소 꼴 · 다른 전화번호 · 박스+나눔 낱말) 잡힘`, miss.join(' | '));
    ok(wrong.length === 0, `현관·문 앞·부재·연락·보내는이·일반 메모 ${no.length}꼴은 안 잡힘`, wrong.map(m => m + ' → ' + sig(m).why).join(' | '));
    ok(sig('개별발송 부탁드립니다', 1) === null && sig('', 3) === null, '수량 1 · 빈 메모는 신호 없음');
    ok(/주소/.test(sig('주소 따로 드릴게요').why), 'why 에 이유 글', sig('주소 따로 드릴게요').why);
    ok(core.splitSignal({ memo: '1박스는 010-8888-0001 로', qty: 2, buyerDigits: B, recvDigits: '01088880001' }) === null, '수취인 번호가 글자 하나로 와도 같은 번호는 「다른 전화번호」가 아님');
}

console.log('⑤ 거래처 · 제주');
const BY = { '효돈농협': [O_H1, O_H2, '고당도 하우스감귤 / 상품 및 과수: 가정용 - 4.5kg(로얄과)'], '대성(시온)': [O_G1, O_G2] };
{
    ok(core.partnerOf(O_H1, BY) === '효돈농협' && core.partnerOf(O_G1, BY) === '대성(시온)', '옵션정보가 그 거래처 목록에 정확히 있으면 그 거래처');
    ok(core.partnerOf(O_H1 + ' S사이즈로!', BY) === '효돈농협' && core.partnerOf(O_H1 + ' 2S사이즈로!', BY) === '효돈농협' && core.partnerOf(' ' + O_H1 + ' M사이즈로! ', BY) === '효돈농협', '사이즈 꼬리(2S·S·M)는 떼고 다시 찾음');
    ok(core.partnerOf(O_G1 + ' 15과로!', BY) === null && core.partnerOf('[미매칭] 가짜 5kg', BY) === null && core.partnerOf('', BY) === null && core.partnerOf(O_H1, {}) === null, '수기 꼬리 · [미매칭] · 빈 값 · 단가표 없음 = 못 정함(null)');
    ok(core.partnerOf(O_H1, { '효돈농협': new Set([O_H1]) }) === '효돈농협', '목록이 Set 이어도 됨');
    ok(core.shortPartner('대성(시온)') === '대성' && core.shortPartner('효돈농협') === '효돈' && core.shortPartner('기타거래처') === '기타거래처', '파일 이름용 짧은 이름', [core.shortPartner('대성(시온)'), core.shortPartner('효돈농협'), core.shortPartner('기타거래처')]);
    ok(core.isJeju('제주특별자치도 제주시 가짜로 1') && core.isJeju('  제주도 서귀포시 가짜로') && core.isJeju('제주시 가짜동') && !core.isJeju('경기도 가짜시 제주로 12') && !core.isJeju('') && !core.isJeju(null), '제주 = 앞뒤 공백을 뗀 뒤 「제주」로 시작(주소 중간의 「제주」는 아님)');
}

console.log('⑥ 행 묶음(정렬 · 제주 · 기본 문구 · 보내는이)');
const BORDER = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
const D = { border: BORDER, font: { name: '맑은 고딕', sz: 11 }, alignment: { vertical: 'center' } };
const fillSt = rgb => Object.assign({}, D, { fill: { fgColor: { rgb } } });
// v2 시트1 한 행(11칸 {v,s,t}) — 옵션 칸 거래처 색 · 「제주」가 든 주소는 v2 가 노랑으로 칠해 온다
const prog = (key, buyer, recv, opt, qty, addr, memo, optFill, extra) => ({ key, cells: [
    { v: buyer + '(제주아꼼이네)', t: 's', s: D }, { v: '010-1111-0000', t: 's', s: D }, { v: '제주특별자치도 제주시 가짜로 1, 제주아꼼이네', t: 's', s: D }, { v: recv, t: 's', s: D },
    { v: opt, t: 's', s: optFill ? fillSt(optFill) : D }, { v: qty, t: 'n', s: D }, { v: '010-8000-0002', t: 's', s: D }, { v: '', t: 's', s: D },
    { v: addr, t: 's', s: /제주/.test(addr) ? fillSt('FFFF00') : D }, { v: memo, t: 's', s: (extra && extra.memoStyle) || D }, { v: '010-1111-0000', t: 's', s: D }] });
let built;
{
    const program = [
        prog('naver:0', '구매일', '받A', O_G2, 1, '서울시 가짜구 가짜로 1', '', 'F0EAF8'),
        prog('naver:1', '구매이', '받B', O_G1, 2, '제주특별자치도 서귀포시 가짜로 2', '문 앞에 놔주세요', 'F0EAF8'),
        prog('naver:2', '구매삼', '받C', O_G1, 1, '경기도 가짜시 제주로 3', '   ', 'F0EAF8'),   // 주소 중간에 「제주」 — v2 는 노랑, 사람 기준은 제주 아님
        prog('naver:3', '구매사', '받D', O_H1, 1, '부산시 가짜구 가짜로 4', '보내는이 홍길동으로 부탁', 'E8F1FB', { memoStyle: fillSt('DDEBF7') }),
        prog('naver:4', '구매오', '받E', O_H1 + ' S사이즈로!', 1, '대전시 가짜구 가짜로 5', '작은 걸로', null),
        prog('naver:5', '구매육', '받F', O_H1, 3, '광주시 가짜구 가짜로 6', '', 'E8F1FB'),
        prog('naver:6', '구매칠', '받G', '[미매칭] 가짜과일 5kg', 1, '서울시 가짜구 가짜로 7', '', null),
        prog('naver:7', '구매팔', '받H', O_G1 + ' 15과로!', 1, '서울시 가짜구 가짜로 8', '', null),
        prog('naver:8', '구매구', '받I', O_H2, 1, '제주시 가짜동 9', '', 'E8F1FB'),
    ];
    const cash = core.parseCash([H13,
        cashRow('현금일 드림!', '받J', O_H1, 2, '서울시 가짜구 가짜로 10', '', '010-7000-0001'),
        cashRow('홍길동 드림', '받K', O_G1, 1, '서울시 가짜구 가짜로 11', null, '010-1111-2222', '서울시 보내는구 보내는로 1'),
        cashRow('현금이(제주아꼼이네!)', '받L', O_H1, 1, '제주특별자치도 제주시 가짜로 12', '직접 적은 메모', '010-7000-0002'),
        cashRow('현금삼 드림!', '받M', O_G1, 4, '인천시 가짜구 가짜로 13', null, '010-7000-0003'),
        cashRow('현금사 드림!', '받N', O_H1, 1, '울산시 가짜구 가짜로 14', null, '010-7000-0004'),
    ]).rows;
    const senderByKey = new Map([['naver:3', { name: '홍길동', phone: '010-3333-4444', addr: '서울시 보내는구 보내는로 9' }], ['naver:5', { name: '김철수 드림', phone: null, addr: null }]]);
    const out0 = core.buildRows({ program, cash, byPartner: BY, picks: {}, senderByKey, defaultMemo: core.DEFAULT_MEMO });
    ok(eq(out0.unknown.slice().sort(), [O_G1 + ' 15과로!', '[미매칭] 가짜과일 5kg'].sort()), '단가표에 없는 옵션(수기 꼬리 · [미매칭]) → unknown(중복 없이)', JSON.stringify(out0.unknown));
    const out = built = core.buildRows({ program, cash, byPartner: BY, picks: { '[미매칭] 가짜과일 5kg': '효돈농협', [O_G1 + ' 15과로!']: '대성(시온)' }, senderByKey, defaultMemo: core.DEFAULT_MEMO });
    ok(out.unknown.length === 0 && eq(out.partners.map(p => p.name), ['대성(시온)', '효돈농협']) && eq(out.partners.map(p => p.short), ['대성', '효돈']), '고른 거래처(picks) 반영 · 거래처 이름순 · 짧은 이름', JSON.stringify(out.partners.map(p => p.name)));
    const dae = out.partners[0], hyo = out.partners[1];
    const recv = p => p.rows.map(r => r.cells[3].v);
    // 대성: 제주 아닌 행(옵션순: 가정용 3kg → 선물용 3kg(현금 K·M → 프로그램 C) → 15과로!) → 제주 행(B)
    ok(eq(recv(dae), ['받A', '받K', '받M', '받C', '받H', '받B']), '대성: 옵션 글자순 · 같은 옵션은 현금 행(파일 순서) 먼저 · 제주 행 맨 아래', recv(dae).join(','));
    // 효돈: 가정용 2.5kg(현금 J·N → 프로그램 D·F) → S사이즈로!(E) → 선물용(없음: I 는 제주) → [미매칭](G) ; 제주: 가정용(현금 L) → 선물용(I)
    ok(eq(recv(hyo), ['받G', '받J', '받N', '받D', '받F', '받E', '받L', '받I']), '효돈: 사이즈 꼬리는 기본 품목 바로 뒤 · 제주 구간도 옵션순', recv(hyo).join(','));
    ok(dae.rows.every(r => r.cells.length === 13) && hyo.rows.every(r => r.cells.length === 13) && eq(dae.rows.map(r => r.src), ['program', 'cash', 'cash', 'program', 'program', 'program']), '모든 행 13칸 · src 표시', dae.rows.map(r => r.src).join(','));
    const cellOf = (p, name, c) => p.rows.find(r => r.cells[3].v === name).cells[c];
    const rgb = s => (s && s.fill && s.fill.fgColor && s.fill.fgColor.rgb) || '';
    ok(eq(dae.rows.map(r => r.jeju), [false, false, false, false, false, true]) && rgb(cellOf(dae, '받B', 8).s) === 'FFFF00' && rgb(cellOf(hyo, '받L', 8).s) === 'FFFF00' && rgb(cellOf(hyo, '받I', 8).s) === 'FFFF00', '제주 행 I칸 노랑(프로그램·현금 행 모두)');
    ok(rgb(cellOf(dae, '받C', 8).s) === '' && cellOf(dae, '받C', 8).v === '경기도 가짜시 제주로 3', '「제주」로 시작하지 않는 행의 I칸 노랑은 지움(주소 글자는 그대로)', rgb(cellOf(dae, '받C', 8).s));
    ok(cellOf(dae, '받A', 9).v === core.DEFAULT_MEMO && cellOf(dae, '받C', 9).v === core.DEFAULT_MEMO && cellOf(hyo, '받J', 9).v === core.DEFAULT_MEMO, '빈 메모(빈칸·공백뿐) → 기본 문구(프로그램·현금 행)');
    ok(cellOf(dae, '받B', 9).v === '문 앞에 놔주세요' && cellOf(hyo, '받D', 9).v === '보내는이 홍길동으로 부탁' && rgb(cellOf(hyo, '받D', 9).s) === 'DDEBF7' && cellOf(hyo, '받E', 9).v === '작은 걸로' && cellOf(hyo, '받L', 9).v === '직접 적은 메모', '글자가 있는 메모는 그대로(색 표시도 그대로)');
    const dA = cellOf(hyo, '받D', 0), dB = cellOf(hyo, '받D', 1), dM = cellOf(hyo, '받D', 12);
    ok(dA.v === '홍길동 드림' && dB.v === '010-3333-4444' && dM.v === '서울시 보내는구 보내는로 9' && [dA, dB, dM].every(c => rgb(c.s) === 'DDEBF7' && c.s.font.bold && c.s.font.color.rgb === '1F4E79'), '직원 보내는이 지정: A 「이름 드림」 · B 번호 · M 주소 · 세 칸 연파랑(남색 굵게)', [dA.v, dB.v, dM.v].join(' / '));
    ok(cellOf(hyo, '받D', 2).v === '제주특별자치도 제주시 가짜로 1, 제주아꼼이네', '출고지(C)는 그대로');
    const fA = cellOf(hyo, '받F', 0), fB = cellOf(hyo, '받F', 1), fM = cellOf(hyo, '받F', 12);
    ok(fA.v === '김철수 드림' && rgb(fA.s) === 'DDEBF7' && fB.v === '010-1111-0000' && rgb(fB.s) === '' && fM.v === '' && rgb(fM.s) === '', '이미 「드림」으로 끝나면 그대로 · 번호·주소가 없으면 B·M 은 안 바꿈', [fA.v, fB.v].join(' / '));
    ok(cellOf(dae, '받A', 0).v === '구매일(제주아꼼이네)' && rgb(cellOf(dae, '받A', 0).s) === '' && cellOf(dae, '받A', 11).v === '' && cellOf(dae, '받A', 12).v === '', '지정이 없는 프로그램 행 = A~K 그대로 + L·M 빈칸');
    ok(rgb(cellOf(dae, '받A', 4).s) === 'F0EAF8' && rgb(cellOf(hyo, '받F', 4).s) === 'E8F1FB' && cellOf(hyo, '받F', 5).v === 3 && cellOf(hyo, '받F', 5).t === 'n', '프로그램 행의 값·서식(옵션 칸 거래처 색 · 수량 숫자)은 받은 그대로');
    const kK = cellOf(dae, '받K', 0), kM = cellOf(dae, '받K', 12), kQ = cellOf(dae, '받M', 5);
    ok(kK.v === '홍길동 드림' && kM.v === '서울시 보내는구 보내는로 1' && cellOf(dae, '받M', 0).v === '현금삼 드림!' && kQ.v === 4 && kQ.t === 'n' && cellOf(dae, '받K', 6).v === '010-8000-0001' && kK.s.border.top.style === 'thin' && kK.s.font.name === '맑은 고딕' && kK.s.font.sz === 11 && rgb(kK.s) === '', '현금 행 = 13칸 값 그대로(「!」·M칸 포함 · 번호는 글자) + 기본 서식 · 수량은 숫자');
    ok(eq(dae.qty.map(q => [q.name, q.qty]), [[O_G2, 1], [O_G1, 8], [O_G1 + ' 15과로!', 1]]) && dae.total === 10, '대성 수량 표: 옵션 글자별 합(제주 행 포함) · 옵션순 · 합계', JSON.stringify(dae.qty.map(q => q.qty)) + ' = ' + dae.total);
    ok(eq(hyo.qty.map(q => [q.name, q.qty]), [['[미매칭] 가짜과일 5kg', 1], [O_H1, 8], [O_H1 + ' S사이즈로!', 1], [O_H2, 1]]) && hyo.total === 11 && hyo.total === hyo.rows.reduce((s, r) => s + r.cells[5].v, 0), '효돈 수량 표: 사이즈 꼬리는 별도 줄 · 합계 = 행 수량 합', JSON.stringify(hyo.qty.map(q => q.qty)) + ' = ' + hyo.total);
    // 받은 재료를 바꾸지 않는다(다시 판정 때 같은 재료로 또 부른다)
    ok(program[2].cells[8].s.fill.fgColor.rgb === 'FFFF00' && program[0].cells[9].v === '' && program[3].cells[0].v === '구매사(제주아꼼이네)' && program[0].cells.length === 11, '입력(program)은 바뀌지 않음');
    const again = core.buildRows({ program, cash, byPartner: BY, picks: { '[미매칭] 가짜과일 5kg': '효돈농협', [O_G1 + ' 15과로!']: '대성(시온)' }, senderByKey, defaultMemo: core.DEFAULT_MEMO });
    ok(eq(again.partners.map(p => p.rows.map(r => r.cells.map(c => c.v))), out.partners.map(p => p.rows.map(r => r.cells.map(c => c.v)))), '두 번 불러도 같은 결과');
    const objMap = core.buildRows({ program, cash: [], byPartner: BY, picks: {}, senderByKey: { 'naver:3': { name: '홍길동', phone: null, addr: null } } });
    ok(objMap.partners.find(p => p.short === '효돈').rows.find(r => r.cells[3].v === '받D').cells[0].v === '홍길동 드림' && objMap.partners.find(p => p.short === '대성').rows.find(r => r.cells[3].v === '받A').cells[9].v === core.DEFAULT_MEMO, 'senderByKey 가 일반 객체 · defaultMemo 생략 · 현금 없음');
    const empty = core.buildRows({ program: [], cash: [], byPartner: BY }); ok(empty.partners.length === 0 && empty.unknown.length === 0, '행이 0이면 거래처도 0');
    ok(core.buildOutput === core.buildRows, 'buildOutput = buildRows(설계서 §7 이름)');
}

console.log('⑦ 택배사 양식 시트(xlsx 로 써서 다시 읽기)');
{
    const hyo = built.partners[1];
    const ws = core.sheetOf(XLSX, hyo);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); XLSX.utils.book_append_sheet(wb, core.qtySheetOf(XLSX, hyo, n => (/사이즈로!/.test(n) ? 'F4B183' : /미매칭/.test(n) ? null : 'FFFF00')), '수량');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const rb = XLSX.read(buf, { type: 'buffer', cellStyles: true });
    ok(eq(rb.SheetNames, ['Sheet1', '수량']), '시트 이름 Sheet1 · 수량', rb.SheetNames);
    const s1 = rb.Sheets['Sheet1']; const aoa = XLSX.utils.sheet_to_json(s1, { header: 1, defval: '' });
    ok(eq(aoa[0], core.HEADERS) && aoa[0].length === 13 && s1['!ref'] === 'A1:M9', '머리글 13칸(… 박스타입(입력x) · 보내는이 변경주소) · 범위 A1:M9', s1['!ref']);
    const f = a => { const c = s1[a]; return (c && c.s && c.s.fgColor && c.s.fgColor.rgb) || ''; };
    ok(['A1', 'B1', 'C1', 'L1'].every(a => f(a) === '92D050') && ['D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1', 'M1'].every(a => f(a) === 'FFFF00'), '머리글 색: A~C·L 초록 · D~K·M 노랑', ['A1', 'D1', 'K1', 'L1', 'M1'].map(f).join(','));
    ok(eq(aoa.slice(1).map(r => r[3]), ['받G', '받J', '받N', '받D', '받F', '받E', '받L', '받I']) && aoa.slice(1).every(r => r.length === 13), '자료 8행 순서 유지 · 13칸', aoa.slice(1).map(r => r[3]).join(','));
    ok(f('I8') === 'FFFF00' && f('I9') === 'FFFF00' && f('I2') === '' && f('I5') === '', '제주 두 행(맨 아래) I칸 노랑 · 다른 행은 무색');
    ok(f('A5') === 'DDEBF7' && f('B5') === 'DDEBF7' && f('M5') === 'DDEBF7' && f('J5') === 'DDEBF7' && f('E5') === 'E8F1FB' && f('A6') === 'DDEBF7' && f('B6') === '', '보내는이 지정 칸 연파랑 · 옵션 칸 거래처 색 유지', ['A5', 'B5', 'M5', 'J5', 'E5'].map(f).join(','));
    ok(s1['F3'].t === 'n' && s1['F3'].v === 2 && s1['F6'].t === 'n' && s1['B3'].t === 's' && s1['G3'].v === '010-8000-0001' && s1['K3'].v === '010-7000-0001', '수량 = 숫자 · 번호 = 글자(앞자리 0 유지)');
    ok(aoa[1][9] === core.DEFAULT_MEMO && aoa[4][9] === '보내는이 홍길동으로 부탁' && aoa[7][9] === '직접 적은 메모', '배송메세지: 빈칸만 기본 문구');
    const xml = (() => { const z = XLSX.read(buf, { type: 'buffer', bookFiles: true }); const fl = z.files && z.files['xl/worksheets/sheet1.xml']; return fl ? Buffer.from(fl.content).toString('utf8') : ''; })();
    const widths = [...xml.matchAll(/<col [^>]*width="([\d.]+)"/g)].map(m => Number(m[1]));
    ok(ws['!cols'].length === 13 && eq(ws['!cols'].map(c => c.wch), core.WIDTHS) && widths.length === 13, '칸 너비 13개(20.6 / 14.9 / … / 17.3)', ws['!cols'].map(c => c.wch).join(','));
    const emptyWs = core.sheetOf(XLSX, { rows: [] }); ok(emptyWs['!ref'] === 'A1:M1' && emptyWs['A1'].v === '보내는사람', '행이 없어도 머리글만 있는 시트');

    console.log('⑧ 수량 시트');
    const q = rb.Sheets['수량']; const qa = XLSX.utils.sheet_to_json(q, { header: 1, defval: '' });
    ok(eq(qa, [['[미매칭] 가짜과일 5kg', 1], [O_H1, 8], [O_H1 + ' S사이즈로!', 1], [O_H2, 1], ['', 11]]), '머리글 없이 「품목 | 수량」 줄 + 맨 아래 합계 줄(품목 칸 빈칸)', JSON.stringify(qa.map(r => r[1])));
    const qf = a => { const c = q[a]; return (c && c.s && c.s.fgColor && c.s.fgColor.rgb) || ''; };
    ok(qf('A2') === 'FFFF00' && qf('A3') === 'F4B183' && qf('B2') === '' && qf('B3') === '' && qf('A1') === '' && qf('A5') === '' && qf('B5') === '', '색 = colorOf(이름) — 품목 칸만 · 수량 칸은 흰색 · null 이면 무색 · 합계 줄 두 칸 무색', ['A1', 'A2', 'B2', 'A3', 'B3', 'B5'].map(qf).join(','));
    const q2 = core.qtySheetOf(XLSX, hyo, n => (/사이즈로!/.test(n) ? 'orange' : 'yellow')); ok(q2['A3'].s.fill.fgColor.rgb === 'F4B183' && q2['A2'].s.fill.fgColor.rgb === 'FFFF00' && !q2['B2'].s.fill && q2['A2'].s.border.top.style === 'thin' && q2['B2'].s.border.top.style === 'thin' && q2['B2'].s.font.name === '맑은 고딕', '색 분류 낱말(yellow·orange…)도 받음 · 수량 칸은 색 없이 테두리·글꼴만');
    const q3 = core.qtySheetOf(XLSX, hyo); ok(q3['!ref'] === 'A1:B5' && !q3['A2'].s.fill && q3['B5'].v === 11, 'colorOf 없이도 동작(무색)');
}

console.log(`\n합계: ✅ ${pass} · ❌ ${fail}`);
process.exit(fail ? 1 : 0);
