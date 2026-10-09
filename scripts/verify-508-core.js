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

console.log('④-b 보내는이 미리 채움(손님 메모) · 기준일과 같은 날짜 메모');
{
    const h = (memo, buyer) => core.senderHint(memo, buyer == null ? '김구매' : buyer);
    // [메모, 구매자, 기대 이름, 기대 번호('' = 없음)]
    const HINTS = [
        ['보내는사람 가짜상사 ( 김구매 010-3333-4444 )', '김구매', '김구매', '010-3333-4444'],          // 「상호 ( 이름 번호 )」 = 괄호 안 사람 이름
        ['보내는 사람 (김구매, 010-3333-4444), 추석 잘 보내세요.', '김구매', '김구매', '010-3333-4444'],
        ['보내는사람:홍길동,김철수', '홍길동', '홍길동,김철수', ''],                                      // 두 이름은 그대로
        ['보내는이: 홍길동/김철수', '김구매', '홍길동/김철수', ''],
        ['보내는사람 :  류  현', '김구매', '류현', ''],                                                  // 띄어 쓴 두 글자 = 붙여서(완성본과 같게)
        ['보내는이: 홍길동\n추석 잘 보내세요', '김구매', '홍길동', ''],                                   // 줄바꿈 앞까지
        ['보내는 분 : (주)가짜상사 홍길동 대표', '김구매', '(주)가짜상사 홍길동 대표', ''],
        ['보내는이 홍길동으로 변경 부탁드립니다', '김구매', '홍길동', ''],
        ['보내는이 김수정', '김구매', '김수정', ''],
        ['9월17일 배송희망 보내는분 가짜상사 서울 가짜구 가짜로 12 010 3333 4444', '김구매', '가짜상사', '010-3333-4444'],   // 이름 뒤에 주소·숫자 = 첫 덩어리만
        ['개별발송 부탁드립니다 - 카톡으로 보내는분ㆍ받는분 주소 보내드림', '김구매', '', ''],              // 이름이 아닌 글
        ['추석 잘 보내세요.\n가짜상사 홍길동 올림', '김구매', '가짜상사 홍길동', ''],                      // 낱말은 없지만 줄 끝이 맺음
        ['늘 감사합니다. 홍길동 드림.', '김구매', '홍길동', ''],
        ['즐거운 명절 되세요 김구매', '김구매', '김구매', ''],                                           // 못 찾으면 메모 속 구매자 이름
        ['115동1202호\n김가짜으로 보내는사람 적어주세요', '김가짜', '김가짜', ''],                         // 이름이 보내는이 낱말 앞에 온 꼴(대표 실물 10/4)
        ['홍길동으로 보내는 사람 해주세요', '김구매', '홍길동', ''],
        ['홍길동 이름으로 보내는 사람 변경 부탁드립니다', '김구매', '홍길동', ''],
        ['꼭 (주)가짜상사로 보내는분 표기 바랍니다', '김구매', '(주)가짜상사', ''],
        ['보내는사람 적어주세요', '김구매', '', ''],                                                    // 이름이 어디에도 없으면 비움(요청 말을 이름으로 돌려주지 않는다)
        ['보내는 사람 꼭 부탁드립니다 김구매', '김구매', '김구매', ''],                                   // 요청 말뿐이면 구매자 이름 폴백
        ['선물로 보내는 사람 이름 적어주세요', '김구매', '', ''],                                         // 「선물로」의 「선물」은 이름이 아니다
        ['보내는이: 홍길동 즐거운 명절 보내세요', '김구매', '홍길동', ''],                                // 이름 뒤 인사말·덕담은 뗀다(그대로 넣으면 A칸에 들어간다)
        ['보내는이 가짜상사 홍길동 풍요로운 한가위 되세요', '김구매', '가짜상사 홍길동', ''],
        ['보내는이 김지은 감사합니다', '김구매', '김지은', ''],                                          // 「은」으로 끝나도 사람 이름이면 남긴다
        ['보내는 사람은 서울시 가짜구 김구매 으로 표기', '김구매', '김구매', ''],                          // 이름 앞 주소 낱말은 뗀다
        ['보내는분 경기도 가짜시 가짜로 12', '김구매', '', ''],                                          // 주소뿐이면 비움
        ['보내는분 경기도 가짜시 가짜로 12 김구매', '김구매', '김구매', ''],
        ['보내는이 한길 홍길동', '김구매', '한길 홍길동', ''],                                           // 상호가 「길」로 끝나도 주소로 시작한 글이 아니면 그대로
        ['문 앞에 놔주세요', '김구매', '', ''],
        ['부재시 010-3333-4444 연락주세요', '김구매', '', '010-3333-4444'],                             // 번호 하나 = 그 번호(누구 번호인지는 화면이 거른다)
        ['홍길동 010-3333-4444 / 김철수 010-5555-6666', '김구매', '', ''],                             // 번호가 둘이면 비움
        ['', '김구매', '', ''],
    ];
    const badH = HINTS.map(([m, b, nm, ph]) => { const r = h(m, b); return r.name === nm && r.phone === ph && r.nameOnly === false ? null : `${JSON.stringify(m)} → ${JSON.stringify(r)}`; }).filter(Boolean);
    ok(badH.length === 0, `senderHint 이름·번호 미리 채움 ${HINTS.length}꼴(괄호 안 이름 · 두 이름 · 줄바꿈 · 꼬리 · 맺음 · 구매자 이름)`, badH.join(' | '));
    // nameOnly: 이름·상호 한 덩어리뿐인 메모만 — [메모, 구매자, 기대 nameOnly, 기대 이름]
    const ONLY = [
        ['홍길동', '김구매', true, '홍길동'], ['남궁민수', '김구매', true, '남궁민수'], ['홍길동 드림', '김구매', true, '홍길동'], ['가짜상사 홍길동 올림', '김구매', true, '가짜상사 홍길동'],
        ['(주)가짜상사 홍길동', '김구매', true, '(주)가짜상사 홍길동'], ['주식회사 가짜상사', '김구매', true, '주식회사 가짜상사'], ['류현', '류현', true, '류현'], ['홍길동.', '김구매', true, '홍길동'],
        ['문앞', '김구매', false], ['경비실', '김구매', false], ['부재시', '김구매', false], ['조심', '김구매', false], ['안전', '김구매', false], ['배송전', '김구매', false], ['이유', '김구매', false], ['정말', '김구매', false],
        ['류현', '김구매', false], ['감사합니다', '김구매', false], ['빠른배송', '김구매', false], ['문 앞에 놔주세요', '김구매', false], ['홍길동 010-3333-4444', '김구매', false], ['홍길동 김철수', '김구매', false],
        ['가짜상사', '김구매', false], ['선물용', '김구매', false], ['천천히', '김구매', false], ['홍길동\n감사합니다', '김구매', false], ['보내는이 홍길동', '김구매', false], ['경비실에 맡겨 드림', '김구매', false],
    ];
    const badO = ONLY.map(([m, b, exp, nm]) => { const r = h(m, b); return r.nameOnly === exp && (!exp || r.name === nm) ? null : `${JSON.stringify(m)} → ${JSON.stringify(r)}`; }).filter(Boolean);
    ok(badO.length === 0, `senderHint nameOnly ${ONLY.length}꼴(성씨+이름 3~4자 · 「○○ 드림/올림」 · 법인 표식만 참 · 두 글자는 구매자 이름일 때만 · 흔한 낱말은 거짓)`, badO.join(' | '));
    // sameDayOnly: 기준일 2026-09-15(화)
    const SD = '2026-09-15';
    const YES = ['15일(화)에 출고 부탁드려요!!', '9월 15일에 발송해 주세요!!', '15일 경에 발송 바랍니다.', '추석전 15일 경에 발송 바랍니다.', '9/15 발송', '9.15. 발송 부탁', '15일 화요일 발송 부탁드립니다', '9월15일 꼭 출고요', '15일 발송 2박스 같이 보내주세요'];
    const NO = ['16일 발송', '9월 16일 발송', '15일(수) 발송', '15일 수요일 발송', '15일 도착 부탁', '15일까지 받고 싶어요', '15일~16일 발송', '15일 이후 발송', '15일 전에 발송', '15일 또는 16일 발송', '9/15, 9/17 나눠 발송',
        '다음주 15일 발송', '15일 말고 천천히', '발송 부탁드립니다', '문 앞에 놔주세요', '3일 후 발송', '15일 발송 010-3333-4444', '오늘 발송', '추석 연휴 끝나고 15일', '10월 15일 발송', '15일 발송 주말 배송 안돼요', '', '15일부터 발송'];
    const yesBad = YES.filter(m => core.sameDayOnly(m, SD) !== true), noBad = NO.filter(m => core.sameDayOnly(m, SD) !== false);
    ok(yesBad.length === 0, `sameDayOnly 참 ${YES.length}꼴(날짜가 전부 기준일 · 요일도 맞음 · 「경」「추석전」 허용)`, yesBad.join(' | '));
    ok(noBad.length === 0, `sameDayOnly 거짓 ${NO.length}꼴(다른 날짜 · 요일 불일치 · 도착·범위 말 · 다른 날짜 표현 · 날짜 없음 · 남은 숫자)`, noBad.join(' | '));
    ok(core.sameDayOnly('16일 경에 발송', '2026-09-16') === true && core.sameDayOnly('15일 발송', '') === false && core.sameDayOnly('15일 발송', '9/15') === false, '기준일이 바뀌면 그 날짜 기준 · 기준일 꼴이 틀리면 거짓');
}

console.log('④-c #517 설날 실자료 반영(전부 가짜 이름·번호) — 당일 요청 · 나눠 보내기 · 보내는이 미리 채움 · 보내는이 단서');
{
    const sd = (m, d) => core.sameDayOnly(m, d), WED = '2026-02-11';   // 2026-02-11 = 수요일
    const sdYes = ['수요일 발송 부탁 드립니다.', '수요일 발송요청', '(수) 출고 부탁드려요', '2월11일 발송 부탁드립니다~!', '11일 발송 부탁드려요~~', '2월 11일 배송 요청 부탁드립니다.', '11일(수) 배송 지정 부탁드립니다.', '2월11일에 배송되었으면 합니다.', '2월 11일 수요일에 발송 부탁드립니다. 감사합니다 ♡새해 복 많이 받으세요~'];
    const sdNo = ['목요일 발송 부탁 드립니다.', '수요일 도착 부탁', '다음주 수요일 발송', '수요일', '수요일에 문자주세요', '2월 11일~12일 발송', '11일~ 발송', '2/9~11 사이 발송', '2월 11일에 도착할수있게 배송해주세요', '11일까지 배송 부탁', '2월 11일 받고 싶어요', '수요일이나 목요일 발송'];
    ok(sdYes.every(m => sd(m, WED)), `sameDayOnly 참 ${sdYes.length}꼴: 요일만 적은 당일 발송 요청 · 문장 끝 물결 · 「배송」 낱말 · 인사말 「복 많이 받으세요」`, sdYes.filter(m => !sd(m, WED)).join(' | '));
    ok(sdNo.every(m => !sd(m, WED)), `sameDayOnly 거짓 ${sdNo.length}꼴: 다른 요일 · 도착·받·까지 · 요일만 있고 발송 낱말 없음 · 날짜 뒤 물결(범위)`, sdNo.filter(m => sd(m, WED)).join(' | '));
    const B = '01011112222', R = ['01088880001', ''];
    const sig = (memo, qty) => core.splitSignal({ memo, qty: qty == null ? 3 : qty, buyerDigits: B, recvDigits: R });
    const spYes = ['배송 주소는 메일로 보내겠습니다', '배송리스트 메일로 보내드리겠습니다.', '톡톡으로 보내드렸습니다', '담당자님께 문자드렸어요 확인부탁드립니다', '주소록 별도 발송', '배송지 명단은 따로 전달드리겠습니다.', '위 주소는 무시해 주세요. 이메일 발송했습니다.', '2개 배송지가다르니 톡톡확인바랍니다.', '배송처 7곳 주소 별도 전달 드리겠습니다', '엑셀 파일 보내드릴게요', '이 주소 말고, 다수 주소로 보낼게요.', '각 3군데 주소 나눠서보내요', '선물입니다 메일보낸 주소로 택배 부탁드립니다', '보내드린 주소로 택배 부탁드립니다'];   // 뒤 두 꼴 = 9월 실자료(고친 뒤 빠질 뻔한 것)
    const spNo = ['회사주소인데 2/13에 도착 하도록 배송부탁드려요', '상세배송지_우측공장 컨테이너', '문 앞에 두고 문자 보내주세요', '배송완료 문자 부탁드립니다', '현관 앞에 두고 문자 남겨주세요', '주소 확인 후 배송 부탁드립니다', '선물 드렸는데 맛있다고 해서 또 주문해요'];
    ok(spYes.every(m => sig(m)), `splitSignal 신호 ${spYes.length}꼴: 주소 + 따로 보냄·여러 곳·이 주소 아님 · 명단·리스트·파일 · 메일·톡톡·문자로 보냈다`, spYes.filter(m => !sig(m)).join(' | '));
    ok(spNo.every(m => !sig(m)), `splitSignal 신호 아님 ${spNo.length}꼴: 「주소」 낱말뿐 · 기사에게 문자 부탁`, spNo.filter(m => sig(m)).map(m => m + ' → ' + sig(m).why).join(' | '));
    ok(sig('배송 주소는 톡톡으로 보내드리겠습니다', 1) && sig('이 주소 말고 다른 곳으로 보내주세요', 1) && sig('배송지 별도 전달 예정입니다', 1) && sig('개별발송 부탁드립니다', 1) === null && sig('가짜시 가짜구 가짜로 77 101동 202호', 1) === null && sig('회사주소입니다', 1) === null, '수량 1: 「주소는 따로 보냄 · 이 주소 말고 · 배송지 별도 전달」만 신호(개별발송·주소 꼴·「주소」 낱말뿐은 아님)');
    const hint = (m, b) => core.senderHint(m, b || '김구매').name;
    const H = [['보낸사람 ; 김구매', '김구매'], ['(보내는이_보험담당자 김구매팀장)', '보험담당자 김구매팀장'], ['보내는사람 은 가나반찬 으로 해주세요', '가나반찬'], ['보내는사람 홍길동님 으로 부탁드려요', '홍길동'], ['발송인 변경-홍길동', '홍길동'],
        ['보내는사람 변경부탁드립니다.\n\n홍길동\n010-1234-5678\n\n으로 바꿔주세요', '홍길동'], ['홍길동 드림 으로 보내주세요', '홍길동'], ['선물용입니다.  <홍길동 드림> 으로 보내주세요.', '홍길동'], ['누나매형새해복많이받으세요-길동드림', '길동'], ['감사합니다(길동드림)', '길동'], ['홍길동 드림_', '홍길동'],
        ['가나다님, 건강한 설 명절 보내시기 바랍니다\n(홍길동 올림)', '홍길동'], ['가나다님, 건강한 설 명절 보내시기 바랍니다\n(홍길동,김구매 올림)', '홍길동,김구매'], ['홍길동&김구매 드림으로 작성해주세요!', '홍길동&김구매'], ['주문자: (주)가나다 김구매', '(주)가나다 김구매'],
        ['보내시는 분 : 홍길동 010-1234-5678', '홍길동'], ['FROM:홍길동\n(문앞에 놓아주세요)', '홍길동'], ['홍길동님이 보내셨습니다', '홍길동'], ['보내는 곳  : 가나전력(주)', '가나전력(주)'], ['보낸는이 홍길동 로 변경해주세요', '홍길동'],
        ['경비실에 보관부탁드림', ''], ['4층계단 박스옆에 길동드림', ''], ['보내는 사람 대표님으로 변경', '대표님'],
        ['가나동물병원 김구매', '가나동물병원 김구매'], ['즐거운 추석명절 보내세요^^\n충청사업팀 김구매', '충청사업팀 김구매'], ['잘 배송 부탁드립니다.[가나대학교 김구매]', '가나대학교 김구매'], ['새해 복 많이 받으십시요. 김구매', '김구매'], ['새해 복 많이 받으세요~^^  _김구매', '김구매'],   // 서명 줄: 「상호 + 구매자 이름」은 그대로 · 인사말에 붙은 이름은 이름만
        ['보내는 시람을\n홍길동(010-1234-5678)으로 메모해 주심 감사하겠습니다.', '홍길동']];
    const badH = H.filter(([m, n]) => hint(m) !== n);
    ok(badH.length === 0, `senderHint 미리 채움 ${H.length}꼴: 앞의 「; _ 은」·「변경-」 라벨 · 끝의 「님」 · 다음 줄 이름 · 「○○ 드림」 뒤 닫는 기호·요청 꼬리 · 여는 기호 뒤 이름 · 두 이름 · 「주문자:」 라벨 · 단서 낱말 뒤 이름`, badH.map(([m, n]) => JSON.stringify(m) + ' → ' + hint(m) + ' (기대 ' + n + ')').join(' | '));
    ok(core.senderHint('주문자 : 김구매', '김구매').nameOnly === false && core.senderHint('주문자: (주)가나다 김구매', '김구매').nameOnly === true && core.senderHint('강릉에서 김구매 올림', '김구매').name === '강릉에서 김구매', '「주문자 : 이름」은 새로 카드 대상이 되지 않음(라벨은 이름 칸에서만 뗌) · 「강릉에서 ○○○ 올림」은 종전 그대로(실자료에서 사람도 그대로 적음)');
    const cue = (m, b) => core.senderCue(m, b || '김구매');
    const cYes = ['보내시는 분 : 홍길동 010-1234-5678', '보내는 곳  : 가나전력(주)', '보낸는이 홍길동 로 변경해주세요', '보내는 시람을 홍길동으로 메모해 주세요', 'FROM:홍길동\n(문앞에 놓아주세요)', '홍길동님이 보내셨습니다', '홍길동님이 보내는 선물입니다.', '새해 복 많이 받으세요~^^  _김구매', '김구매\n늘 건강하세요.', '문앞배송\n(김구매)', '즐거운 명절 보내세요^^!\n-가나과학 김구매-', '새해 복 많이 받으십시요. 김구매', '잘 배송 부탁드립니다.[가나대학교 김구매]'];
    const cNo = ['주문자 : 김구매', '주문자 홍길동 (010-1234-5678) 으로 변경 요청합니다', '주문자명 홍길동 이라고 포장지에 표기 부탁드립니다', '주문자(김구매)', '보내는이 홍길동 변경', '홍길동 드림', '문 앞에 놓아주세요', '김구매 고객입니다 문 앞에 놔주세요', '받는 사람 김구매', '김구매님께 전달 부탁드립니다', '김구매', '배송 전 연락주세요', 'from now on 문앞'];
    ok(cYes.every(m => cue(m)), `senderCue 단서 ${cYes.length}꼴: 보내시는 분 · 보내는 곳 · 오타 · FROM · ○○님이 보냅니다 · 구매자 이름 서명`, cYes.filter(m => !cue(m)).join(' | '));
    ok(cNo.every(m => !cue(m)), `senderCue 아님 ${cNo.length}꼴: 「주문자」 꼴(9/18 대표 확정) · v2 가 판정하는 꼴(보내는이·드림) · 받는 분 이야기 · 이름뿐 · 일반 메모`, cNo.filter(m => cue(m)).map(m => m + ' → ' + cue(m).why).join(' | '));
    ok(cue('') === null && cue(null) === null && core.senderCue('새해 복 많이 받으세요 김구매', '') === null && /서명/.test(cue('늘 감사합니다 -김구매-').why), 'senderCue 빈 값 · 구매자 이름 없음 = null · why 에 이유 글');
    ok(sig('발송부탁드립니다 주소 확인해주세요') === null && sig('배송부탁드려요 회사주소입니다') === null && sig('주소 송부드렸습니다'), '「배송부탁」 「발송부탁」 속의 「송부」는 보냈다는 말이 아님(「주소 송부드렸습니다」는 신호)');
}

console.log('⑤ 거래처 · 제주');
const BY = { '효돈농협': [O_H1, O_H2, '고당도 하우스감귤 / 상품 및 과수: 가정용 - 4.5kg(로얄과)'], '대성(시온)': [O_G1, O_G2] };
{
    ok(core.partnerOf(O_H1, BY) === '효돈농협' && core.partnerOf(O_G1, BY) === '대성(시온)', '옵션정보가 그 거래처 목록에 정확히 있으면 그 거래처');
    ok(core.partnerOf(O_H1 + ' S사이즈로!', BY) === '효돈농협' && core.partnerOf(O_H1 + ' 2S사이즈로!', BY) === '효돈농협' && core.partnerOf(' ' + O_H1 + ' M사이즈로! ', BY) === '효돈농협', '사이즈 꼬리(2S·S·M)는 떼고 다시 찾음');
    ok(core.partnerOf('[미매칭] 가짜 5kg', BY) === null && core.partnerOf('', BY) === null && core.partnerOf(O_H1, {}) === null, '[미매칭] · 빈 값 · 단가표 없음 = 못 정함(null)');
    // #525(대표 10/5): 품목 뒤 「요청 꼬리」(빈칸 + 글 + !)는 떼고 거래처를 찾는다 — 종전엔 사이즈 꼬리만 뗐고 손글씨 꼬리는 거래처 고르기 카드였다
    ok(core.partnerOf(O_G1 + ' 15과로!', BY) === core.partnerOf(O_G1, BY) && core.partnerOf(O_G1 + ' 17과 전후로 부탁!', BY) === core.partnerOf(O_G1, BY) && core.partnerOf(O_H1 + ' 13과로!', BY) === core.partnerOf(O_H1, BY), '#525 요청 꼬리(「 15과로!」 · 꼬리 안에 빈칸이 있어도)는 떼고 거래처를 찾음');
    ok(core.partnerOf(O_G1 + ' 15과로', BY) === null && core.partnerOf('없는품목 15과로!', BY) === null && core.partnerOf(O_G1 + '15과로!', BY) === null, '#525 「!」로 안 끝나는 꼬리 · 단가표에 없는 품목 + 꼬리 · 빈칸 없이 붙은 글 = 못 정함(넓히지 않음)');
    { const has = n => !!core.partnerOf(n, BY) && Object.values(BY).some(a => a.includes(n)); ok(core.stripTail(O_G1 + ' 15과로!', has) === O_G1 && core.stripTail(O_G1, has) === O_G1 && core.stripTail('없는품목 15과로!', has) === '없는품목 15과로!' && core.stripTail(O_G1 + ' S사이즈로!', has) === O_G1, '#525 stripTail: 단가표 이름이 나오는 곳까지만 뗌 · 못 찾으면 원래 글자'); }
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
    ok(eq(out0.unknown.slice().sort(), ['[미매칭] 가짜과일 5kg'].sort()), '단가표에 없는 옵션([미매칭]) → unknown(중복 없이) · #525 요청 꼬리가 붙은 행은 꼬리를 떼고 거래처를 찾음', JSON.stringify(out0.unknown));
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

// ⑨ #516 memoRest — 택배사 양식 배송메세지에서 요청 글 떼어 내기(이름은 전부 지어낸 것 · 꼴은 9/15~9/20 실메모에서)
{
    console.log('⑨ memoRest(요청 글 떼어 내기)');
    const mr = (memo, o) => core.memoRest(memo, Object.assign({ buyerName: '김구매' }, o));
    const S = { sender: true }, D = { sameDay: true };
    // 보내는이 요청뿐 → 남는 글 없음 · 확실
    const EMPTY = ['보내는 사람: 김구매', '보내는사람 김구매으로 부탁드립니다.', '발신자: 가짜주식회사 김구매', '보내는 사람 : 김구매  010-1234-5678  변경바랍니다.', '보내는 이ㅡ 이현수', '보내는이 김구매변경', '보내는이 <한승우> 변경 부탁드려요.',
        '김구매 드림', "보내는 사람 이름 '김구매'으로 표기 부탁드립니다", '보내는이: 가짜환경 심재우\n연락처: 010-1234-5678', '보내는 이 문재우 변경\n보내는 번호 010-1234-5678 로 변경', '보내는사람 가짜세차장  홍석우010 1234 5678',
        '가짜스튜디오 드림', '주식회사 가짜 드림', '보내는사람-남효진', '보내는 사람 : 가짜스마트 ( 정 훈 ) \n으로 변경 부탁 드립니다.', '보내는 이 김구매로 변경 부탁 드립니다^^', '보내는이:  김구매\n\n기입해주세요.', '김구매 드림(010-1234-5678)', '보내는사람 :  류  현'];
    const badE = EMPTY.filter(m => { const r = mr(m, S); return !(r.sure && r.rest === '' && r.removed); });
    ok(badE.length === 0, `보내는이 요청뿐인 메모 ${EMPTY.length}꼴 → rest '' · sure · removed 있음`, badE.join(' | '));
    // 요청 줄만 빼고 다른 줄(기사·받는 분에게 전하는 글)은 그대로 남김
    const KEEP = [['배송 전 미리 연락 부탁드려요.\n보내는이 : 김구매', '배송 전 미리 연락 부탁드려요.'], ['115동 1202호\n김구매으로 보내는사람 적어주세요', '115동 1202호'], ['명절 잘 보내세요 -조카가!\n보내는이 김구매', '명절 잘 보내세요 -조카가!'],
        ['문 앞에 놔주세요\n보내는이 김구매', '문 앞에 놔주세요'], ['로비에 맡겨주세요. 보내는이 김구매', '로비에 맡겨주세요.'], ['보내는이 김구매 변경\n공동현관 #1234*\n부재 시 경비실', '공동현관 #1234*\n부재 시 경비실'], ['과수: 9과, \n보내는 사람: 김구매 드림\n배송시 연락바랍니다', '과수: 9과,\n배송시 연락바랍니다']];
    const badK = KEEP.filter(([m, want]) => { const r = mr(m, S); return !(r.sure && r.rest === want); }).map(([m]) => m + ' → ' + JSON.stringify(mr(m, S)));
    ok(badK.length === 0, `요청 줄만 빼고 다른 글은 그대로 ${KEEP.length}꼴(인사말·동호수·문 앞·공동현관) · sure`, badK.join(' | '));
    // 한 문장에 요청과 다른 글이 섞임 · 이름이 둘 · 뺄 곳을 못 찾음 → sure=false(사람에게)
    const UNSURE = ['보내는사람 김구매 맛있고 예쁜 것으로 보내주세요.', '보내는 사람 (김구매, 010-1234-5678), 추석 잘 보내세요.', '보내는사람:최영우,김구매', '보낸이: 김정우/김구매', '가짜로123로4개.나머지5곳은1개씩.발송자는 이용우010 1234 5678',
        '문 앞에 놔주세요', '보내는 사람은 충남 가짜시 가짜동 123-2 김구매 으로 표기해서 보내주세요.', '보내는 사람은 서울시 가짜구 김구매 으로 표기', '주문한 김구매입니다 개별발송부탁드립니다 ㅡ 카톡으로 보내는분 ㆍ받는분 주소 문자드렸습니다'];
    const badU = UNSURE.filter(m => mr(m, S).sure !== false);
    ok(badU.length === 0, `섞였거나 못 찾은 메모 ${UNSURE.length}꼴 → sure=false`, badU.join(' | '));
    ok(mr('보내는 사람 (김구매, 010-1234-5678), 추석 잘 보내세요.', S).rest === '추석 잘 보내세요.', '섞인 문장: 이름 뒤 인사말을 미리 채움 값으로 돌려줌(자동 적용 아님)');
    // #517 미리 채움 = 기사·받는 분에게 전하는 글만(판매자에게 한 부탁은 뺀다 · 뺐으면 sure=false — 자동 비움 조건은 그대로)
    const SELLER = [['보내는사람 김구매 맛있고 예쁜 것으로 보내주세요.', ''], ['선물입니다.\n보내는 사람 김구매으로 표기해 주세요.', ''], ["보내는 사람 '박희우'로 변경해 주세요 좋은걸로 부탁드립니다", ''], ['선물용입니다.  <박경우 드림> 으로 보내주세요.', ''],
        ['보내는사람 김구매 010-1234-5678. 꼭 기재바랍니다.빠른배송부탁드립니다.', ''], ["보내는 이 ‘김구매’로 변경 부탁드리고 과수 13-14과로 부탁드립니다! ^^", '과수 13-14과로 부탁드립니다!'], ['**(보내는 이:김구매 드림) 즐거운 명절 보내세요.**', '즐거운 명절 보내세요.']];
    const badS = SELLER.filter(([m, want]) => { const r = mr(m, S); return !(r.sure === false && r.rest === want); }).map(([m]) => m + ' → ' + JSON.stringify(mr(m, S)));
    ok(badS.length === 0, `판매자에게 한 부탁은 미리 채움에서 뺌 · 과수 지정과 받는 분 인사는 남김 ${SELLER.length}꼴 · 전부 sure=false`, badS.join(' | '));
    ok(mr('선물용 15과 전후 대과로 부탁드립니다.\n보내는사람:  김용우', S).rest === '선물용 15과 전후 대과로 부탁드립니다.', '과수 지정 글은 남김(v2 가 옵션명으로 옮기지 않아 지우면 사라진다)');
    const rv = mr('받는이 ㅡ서울시 가짜구 가짜로 12 가짜빌라 301호\n홍길순 님 010 1234 5678\n보내는이 ㅡ김구매', S);
    ok(rv.sure === false && rv.rest === '', '메모에 「받는이 ㅡ 주소」를 따로 적은 꼴 → 주소 조각을 미리 채우지 않음(rest \'\' · sure=false)', JSON.stringify(rv));
    // 내용 없는 인사(감사합니다·안녕하세요)는 남는 글이 아니다 — 요청 부분이 확실하면 sure 그대로
    const c1 = mr('2월 11일에 발송 부탁드리겠습니다!\n감사합니다..!!', D), c2 = mr('안녕하세요.\n가능하시면 2월 11일 수요일 발송 부탁드려요.\n감사합니다.', D), c3 = mr('보내는이 김구매 변경\n감사합니다 수고하세요', S), c4 = mr('보내는이 김구매 변경\n새해 복 많이 받으세요', S);
    ok(c1.sure && c1.rest === '' && c2.sure && c2.rest === '' && c3.sure && c3.rest === '' && c4.sure && c4.rest === '새해 복 많이 받으세요', '「감사합니다」「안녕하세요」「수고하세요」만 남으면 rest \'\' · 받는 분에게 전하는 덕담은 남김', JSON.stringify([c1, c2, c3, c4]));
    // 이름이 다음 줄에 오는 꼴 · 맺음 꼴 요청 · 「올림」
    const NEXT = ['보내는사람 변경부탁드립니다.\n\n김홍우\n010 1234 5678\n\n으로 바꿔주세요', '보내는이\n차태우', "‘김구매 드림’으로 변경 부탁드립니다.", '김창우 드림   으로  보내주세요'];
    const badN = NEXT.filter(m => { const r = mr(m, S); return !(r.sure && r.rest === ''); });
    ok(badN.length === 0, `이름이 다음 줄 · 「○○○ 드림(으)로 변경/보내주세요」 ${NEXT.length}꼴 → rest '' · sure`, badN.join(' | '));
    const u1 = mr('김구매 올림', S), u2 = mr('보내는사람 변경 부탁드립니다.', S), u3 = mr('보내는이\n문 앞에 놔주세요', S);
    ok(u1.sure === false && u1.rest === '김구매 올림' && u2.sure === false && u3.sure === false, '메모 전체가 「○○○ 올림」 = 그대로 두고 sure=false(완성본이 남긴 실물) · 낱말만 있고 이름 줄이 없으면 sure=false', JSON.stringify([u1, u2, u3]));
    // 당일 발송 요청 낱말 넓힘(부르는 쪽이 sameDay 를 참으로 준 경우)
    const DAY2 = ['2월 11일 배송 요청 부탁드립니다.', '2월11일에 배송되었으면 합니다.', '11일(수) 배송 지정 부탁드립니다.', '수요일 발송요청', '2월11일 발송 부탁드립니다~!', '11일 발송지정', '발송일: 2월 10일', '배송일 지정 11일', '2/11 예약발송', '발송 희망일 11일', '11일 발송 요망', '★배송메모: "2월 11일 발송" 부탁드립니다', '2/11일 발송'];
    const badD2 = DAY2.filter(m => { const r = mr(m, D); return !(r.sure && r.rest === ''); });
    ok(badD2.length === 0, `당일 요청 넓힘 ${DAY2.length}꼴(「배송」 낱말 · 지정·예약·희망일·요망 · 요일만 · 끝의 물결 · 머리 기호) → rest '' · sure`, badD2.join(' | '));
    const e1 = mr('누락분이 있었네요\n죄송합니다\n2월 11일 발송요청', D), e2 = mr('선물용이니 꼭 좋은 상품으로 11일 발송부탁드립니다.', D), e3 = mr('수요일에 받고 싶어요', D);
    ok(e1.sure === false && e1.rest === '' && e2.sure === false && e3.rest === '수요일에 받고 싶어요', '당일 요청 + 판매자에게 한 말 → 미리 채움은 빈 글이지만 sure=false · 발송 낱말 없는 요일 글은 손대지 않음', JSON.stringify([e1, e2, e3]));
    // 🔴 인사말은 요청 꼬리로 지우지 않는다 · 인사말 + 맺음은 통째로 사람에게
    const g1 = mr('보내는이: 박가짜\n즐거운 추석 보내세요~!', S), g2 = mr('풍성한 추석명절 되세요. 박가짜 드림.', S), g3 = mr('큰엄마 큰아빠 즐거운 추석명절 되셔요\n문가짜 올림', S);
    ok(g1.rest === '즐거운 추석 보내세요~!' && g1.sure === true, '인사말 줄은 남김(보내는이 줄만 뺌)', JSON.stringify(g1));
    ok(g2.sure === false && g2.rest === '풍성한 추석명절 되세요. 박가짜 드림.' && g2.removed === '' && g3.sure === false && g3.rest === '큰엄마 큰아빠 즐거운 추석명절 되셔요\n문가짜 올림', '인사말 + 「○○○ 드림」 맺음 = 아무것도 빼지 않고 sure=false(완성본은 맺음까지 둔다)', JSON.stringify([g2, g3]));
    // 당일 발송 요청
    const DAY = ['전부 15일(화)에 출고 부탁드려요!!', '마지막 발송 날짜인 9월 15일 에 발송해 주세요!!', '추석전 15일 경에 발송 바랍니다.', '9/15 발송 부탁드립니다', '15일 화요일에 보내주세요'];
    const badD = DAY.filter(m => { const r = mr(m, D); return !(r.sure && r.rest === ''); });
    ok(badD.length === 0, `당일 발송 요청뿐인 메모 ${DAY.length}꼴 → rest '' · sure`, badD.join(' | '));
    const d1 = mr('15일 발송 부탁드려요. 문 앞에 놔주세요', D), d2 = mr('15일에 꼭 문앞으로 배송해주세요', D), d3 = mr('15일 생일이라 그날 발송 부탁드려요', D);
    ok(d1.sure && d1.rest === '문 앞에 놔주세요' && d2.sure === false && d2.rest === '15일에 꼭 문앞으로 배송해주세요' && d3.sure === false, '당일 요청 문장만 빼고 다른 문장은 남김 · 한 문장에 다른 말이 섞이면 sure=false(글 그대로)', JSON.stringify([d1, d2, d3]));
    const b1 = mr('15일 발송 부탁드려요.\n보내는이 김구매', { sender: true, sameDay: true });
    ok(b1.sure && b1.rest === '', '보내는이 + 당일 요청 둘 다 뺌', JSON.stringify(b1));
    // 옵션이 없으면 아무것도 안 한다 · 빈 메모
    const n1 = mr('보내는이 김구매 변경', {}), n2 = mr('', S), n3 = mr('문 앞에 놔주세요', {});
    ok(n1.rest === '보내는이 김구매 변경' && n1.sure && n1.removed === '' && n2.rest === '' && n2.sure && n3.rest === '문 앞에 놔주세요', 'sender·sameDay 가 둘 다 꺼져 있으면 메모 그대로 · 빈 메모는 빈 글');
    // 기존 함수 무회귀: memoRest 를 넣어도 senderHint·readSender·sameDayOnly 결과는 그대로(위 ⑥·⑦ 항목이 이미 본다) — 여기서는 서로 부르지 않음만 확인
    ok(typeof core.memoRest === 'function' && core.senderHint('보내는이: 홍길동 즐거운 명절 보내세요', '김구매').name === '홍길동', 'senderHint 는 인사말을 떼고(이름 뽑기) · memoRest 는 인사말을 남긴다(서로 다른 일)');
}

console.log('⑫ #601 박스마다 다른 사이즈 — sizeLines parts · boxTails · 같은 key 두 줄');
{
    const K = '010-1234-5678', sl = x => core.sizeLines(K + ' ' + x), one = x => sl(x).sizes[0];
    const P = (...a) => { const o = []; for (let i = 0; i < a.length; i += 2) o.push({ size: a[i], n: a[i + 1] }); return o; };
    // 허용 꼴: 「사이즈 뒤 건수」 · 「건수 뒤 사이즈」 · 섞임 · 「1건만/1건은」
    const GOOD = [
        ['S사이즈 1건 M사이즈 1건', P('S', 1, 'M', 1), 'S', 2],
        ['1건 S 1건 M', P('S', 1, 'M', 1), 'S', 2],
        ['S 1건만 1건은 M사이즈', P('S', 1, 'M', 1), 'S', 2],
        ['2S사이즈로! 2건 L 1건', P('2S', 2, 'L', 1), '2S', 3],
        ['1건은 s사이즈로 2건은 m사이즈로 부탁', P('S', 1, 'M', 2), 'S', 3],
        ['S 1건 M 1건 2L 1건', P('S', 1, 'M', 1, '2L', 1), 'S', 3],
        ['m 1건씩 s 1건씩', P('M', 1, 'S', 1), 'M', 2],
    ];
    const badG = GOOD.filter(g => { const r = sl(g[0]), z = r.sizes[0]; return !(r.text === '' && r.sizes.length === 1 && eq(z.parts, g[1]) && z.size === g[2] && z.expect === g[3] && z.key === K && z.digits === '01012345678' && z.srcLine === 0 && z.raw === K + ' ' + g[0] && r.bad.length === 0); });
    ok(badG.length === 0, `「사이즈 + 건수」 짝 여러 개 ${GOOD.length}꼴 → parts(짝 순서) · size = 첫 짝 · expect = 건수 합 · 줄은 빈 줄`, badG.map(g => g[0]).join(' | '));
    const same = one('S 1건 S 1건');
    ok(eq(same.parts, P('S', 2)) && same.expect === 2 && same.size === 'S', '같은 사이즈는 합침(「S 1건 S 1건」 → S n2 · parts 1개)', JSON.stringify(same));
    const keepO = sl('10/11 네이버 S 1건 M 1건'), tab = core.sizeLines(K + '\t10/11\t네이버\tS 1건 M 1건'), mid = sl('S 1건 문앞 M 1건');
    ok(keepO.text === K + ' 10/11 네이버' && tab.text === K + '\t10/11\t네이버\t' && eq(tab.sizes[0].parts, P('S', 1, 'M', 1)) && mid.text === K + ' 문앞' && eq(mid.sizes[0].parts, P('S', 1, 'M', 1)), '날짜·플랫폼·다른 낱말은 줄에 남김 · 탭 줄은 탭 칸 그대로(비고 칸만 비움)', JSON.stringify([keepO.text, tab.text, mid.text]));
    // 짝이 안 맞으면 사이즈를 하나도 붙이지 않는다: sizes 에 없음 · 줄 그대로 · bad[] 로 따로
    const BAD = [['S M사이즈', '건수 없음'], ['S 1건 M', '건수 없음'], ['S M 1건', '건수 없음'], ['S 1건 M 1건 2건', '건수 짝 안 맞음'], ['S 0건 M 1건', '건수 0']];
    const badB = BAD.filter(x => { const r = sl(x[0]); return !(r.sizes.length === 0 && r.ups.length === 0 && r.text === K + ' ' + x[0] && eq(r.bad, [{ srcLine: 0, raw: K + ' ' + x[0], key: K, digits: '01012345678', why: x[1] }])); });
    ok(badB.length === 0, `사이즈 둘 이상인데 짝이 안 맞는 ${BAD.length}꼴 → sizes 에 없음 · 줄 그대로 · bad[{ srcLine, raw, key, digits, why }]`, badB.map(x => x[0] + ' → ' + JSON.stringify(sl(x[0]))).join(' | '));
    const bm = core.sizeLines([K + ' 2s', '010-9999-8888 S M', '그냥 글'].join('\n'));
    ok(bm.text === '\n010-9999-8888 S M\n그냥 글' &&bm.sizes.length === 1 && bm.bad.length === 1 && bm.bad[0].srcLine === 1 && Array.isArray(sl('2s').bad) && sl('2s').bad.length === 0 && Array.isArray(core.sizeLines('').bad), 'bad 는 늘 배열(없으면 빈 배열) · 여러 줄에서 줄 번호 그대로', JSON.stringify(bm));
    // 종전 줄 12개 = 결과 바이트 동일(#601 앞 코드로 뽑아 박은 값)
    const OLD = [
        ['2s', '{"text":"","sizes":[{"srcLine":0,"raw":"010-1234-5678 2s","key":"010-1234-5678","digits":"01012345678","size":"2S","expect":null}],"ups":[]}'],
        ['2S사이즈 2건', '{"text":"","sizes":[{"srcLine":0,"raw":"010-1234-5678 2S사이즈 2건","key":"010-1234-5678","digits":"01012345678","size":"2S","expect":2}],"ups":[]}'],
        ['.2S사이즈', '{"text":"","sizes":[{"srcLine":0,"raw":"010-1234-5678 .2S사이즈","key":"010-1234-5678","digits":"01012345678","size":"2S","expect":null}],"ups":[]}'],
        ['s사이즈로!', '{"text":"","sizes":[{"srcLine":0,"raw":"010-1234-5678 s사이즈로!","key":"010-1234-5678","digits":"01012345678","size":"S","expect":null}],"ups":[]}'],
        ['사이즈 S 로 부탁', '{"text":"","sizes":[{"srcLine":0,"raw":"010-1234-5678 사이즈 S 로 부탁","key":"010-1234-5678","digits":"01012345678","size":"S","expect":null}],"ups":[]}'],
        ['업그레이드', '{"text":"","sizes":[],"ups":[{"srcLine":0,"raw":"010-1234-5678 업그레이드","key":"010-1234-5678","digits":"01012345678","expect":null}]}'],
        ['업그레이드 2건', '{"text":"","sizes":[],"ups":[{"srcLine":0,"raw":"010-1234-5678 업그레이드 2건","key":"010-1234-5678","digits":"01012345678","expect":2}]}'],
        ['4kg 업그레이드', '{"text":"010-1234-5678 4kg 업그레이드","sizes":[],"ups":[]}'],
        ['10/12 L 사이즈 요청', '{"text":"010-1234-5678 10/12","sizes":[{"srcLine":0,"raw":"010-1234-5678 10/12 L 사이즈 요청","key":"010-1234-5678","digits":"01012345678","size":"L","expect":null}],"ups":[]}'],
        ['2건', '{"text":"010-1234-5678 2건","sizes":[],"ups":[]}'],
        ['S사이즈 문 앞', '{"text":"010-1234-5678 문 앞","sizes":[{"srcLine":0,"raw":"010-1234-5678 S사이즈 문 앞","key":"010-1234-5678","digits":"01012345678","size":"S","expect":null}],"ups":[]}'],
        ['2s 2건 10/13 자사몰', '{"text":"010-1234-5678 10/13 자사몰","sizes":[{"srcLine":0,"raw":"010-1234-5678 2s 2건 10/13 자사몰","key":"010-1234-5678","digits":"01012345678","size":"2S","expect":2}],"ups":[]}'],
    ];
    const old3 = r => JSON.stringify({ text: r.text, sizes: r.sizes, ups: r.ups });   // 종전 세 칸(bad 는 #601 새 칸)
    const badO = OLD.filter(o => old3(sl(o[0])) !== o[1] || sl(o[0]).bad.length);
    ok(badO.length === 0, `종전 줄 ${OLD.length}개(한 짝·업그레이드·빈칸 줄) 결과 바이트 동일 · parts 칸 없음`, badO.map(o => o[0] + ' → ' + JSON.stringify(sl(o[0]))).join(' | '));
    const t1 = core.sizeLines(K + '\t\t\tM사이즈 3건'), t2 = core.sizeLines(K + '\t10/11\t네이버\tS'), nk = core.sizeLines('홍길동 S 1건 M 1건');
    ok(old3(t1) === '{"text":"","sizes":[{"srcLine":0,"raw":"010-1234-5678\\t\\t\\tM사이즈 3건","key":"010-1234-5678","digits":"01012345678","size":"M","expect":3}],"ups":[]}' && t2.text === K + '\t10/11\t네이버\t' && t2.sizes[0].parts === undefined && nk.text === '홍길동 S 1건 M 1건' && nk.sizes.length === 0, '종전 탭 줄 바이트 동일 · 번호 없는 줄은 손대지 않음', JSON.stringify([t1, t2.text, nk]));
    const w1 = sl('S 2건만'), w2 = sl('업그레이드 1건은');
    ok(w1.text === '' && w1.sizes[0].expect === 2 && w1.sizes[0].parts === undefined && w2.ups.length === 1 && w2.ups[0].expect === 1 && w2.text === '', '「N건만·N건은」도 건수로 읽음(한 짝 줄 · 업그레이드 줄)', JSON.stringify([w1, w2]));
    const multi = core.sizeLines([K + ' S 1건 M 1건', '010-9999-8888 2s', '그냥 글', '010-7777-6666 1건 L 2건 2L'].join('\n'));
    ok(multi.text === '\n\n그냥 글\n' && eq(multi.sizes.map(z => [z.srcLine, z.size, z.expect, z.parts ? z.parts.length : 0]), [[0, 'S', 2, 2], [1, '2S', null, 0], [3, 'L', 3, 2]]), '여러 줄: 줄 수·줄 번호 그대로', JSON.stringify(multi.text));

    // boxTails
    const parts = P('S', 1, 'M', 1), keepP = JSON.stringify(parts);
    const e = core.boxTails(parts, 2), lt = core.boxTails(parts, 4), gt = core.boxTails(P('S', 2, 'M', 1), 2);
    ok(eq(e, { ok: true, boxes: [{ tail: 'S사이즈로!', qty: 1 }, { tail: 'M사이즈로!', qty: 1 }] }), 'boxTails 합 = 박스 수 → 박스별 꼬리(기본 「○사이즈로!」 · note 없음)', JSON.stringify(e));
    ok(eq(lt, { ok: true, boxes: [{ tail: 'S사이즈로!', qty: 1 }, { tail: 'M사이즈로!', qty: 1 }, { tail: null, qty: 2 }], note: '꼬리 없는 박스 2' }), 'boxTails 합 < 박스 수 → 남는 박스는 tail null(맨 뒤) + note', JSON.stringify(lt));
    ok(eq(gt, { ok: false, why: '메모 줄은 3건인데 주문은 2박스예요' }), 'boxTails 합 > 박스 수 → ok:false + 이유', JSON.stringify(gt));
    ok(eq(core.boxTails(undefined, 2), { ok: false, why: '박스별 사이즈 없음' }) && eq(core.boxTails([], 2), { ok: false, why: '박스별 사이즈 없음' }) && core.boxTails(parts, 0).ok === false && core.boxTails(parts, '둘').ok === false, 'boxTails parts 없음 · 박스 수 이상 → ok:false');
    const mkd = core.boxTails(P('2S', 2, 'L', 1), 3, s => s + ' 사이즈!');
    ok(eq(mkd.boxes, [{ tail: '2S 사이즈!', qty: 2 }, { tail: 'L 사이즈!', qty: 1 }]) && JSON.stringify(parts) === keepP && eq(core.boxTails(parts, 2), e), 'boxTails mk 바꿈 · 입력 무변경 · 두 번 불러도 같음', JSON.stringify(mkd));

    // buildRows: 화면이 한 주문(2박스)을 같은 key 로 두 줄(수량 1 · 꼬리 다름)로 떼어 넘기는 꼴
    const bt = core.boxTails(one('S사이즈 1건 M사이즈 1건').parts, 2);
    const program = bt.boxes.map(b => prog('naver:50', '구매나눔', '받나눔', O_H1 + ' ' + b.tail, b.qty, '서울시 가짜구 가짜로 50', '', 'E8F1FB')).concat([prog('naver:51', '구매다른', '받다른', O_H1, 2, '서울시 가짜구 가짜로 51', '', 'E8F1FB')]);
    const r = core.buildRows({ program, cash: [], byPartner: BY, picks: {}, senderByKey: new Map([['naver:50', { name: '홍길동', phone: '010-3333-4444', addr: null }]]), defaultMemo: core.DEFAULT_MEMO });
    const hy = r.partners.find(p => p.short === '효돈'), mine = hy ? hy.rows.filter(x => x.cells[3].v === '받나눔') : [];
    ok(r.unknown.length === 0 && r.partners.length === 1 && hy.rows.length === 3 && mine.length === 2 && eq(mine.map(x => [x.cells[4].v, x.cells[5].v]), [[O_H1 + ' M사이즈로!', 1], [O_H1 + ' S사이즈로!', 1]]), '같은 key 두 줄 → 택배사 양식 2줄(꼬리별 · 수량 1씩)', JSON.stringify(hy && hy.rows.map(x => [x.cells[3].v, x.cells[4].v, x.cells[5].v])));
    ok(mine.every(x => x.cells[0].v === '홍길동 드림' && x.cells[1].v === '010-3333-4444' && x.cells[9].v === core.DEFAULT_MEMO) && hy.rows.find(x => x.cells[3].v === '받다른').cells[0].v === '구매다른(제주아꼼이네)', '같은 key 두 줄 모두 보내는이 지정·기본 문구 적용 · 다른 주문 무접촉');
    ok(eq(hy.qty.map(q => [q.name, q.qty]), [[O_H1, 2], [O_H1 + ' M사이즈로!', 1], [O_H1 + ' S사이즈로!', 1]]) && hy.total === 4, '수량 표가 꼬리별로 갈림 · 합계 = 박스 수 합', JSON.stringify(hy.qty));
}

console.log(`\n합계: ✅ ${pass} · ❌ ${fail}`);
process.exit(fail ? 1 : 0);
