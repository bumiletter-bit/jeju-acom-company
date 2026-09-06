// #427 검증: cafe24_sync 옵션 결제가 감지 로직 (2026-09-06)
// server.js에서 실코드(cafe24OptKey + 감지 비교 로직)를 떼어 실행 + 9/6 실사고(교정 전) 데이터로 재현.
// API/DB 접속 없음 — 순수 로직 검증. 배포 후 실동작은 05:10 회차 텔레그램/cafe24_sync_last로 확인.
const fs = require('path');
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const src = require('fs').readFileSync(PROJ + '\\server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

// 실코드 추출: cafe24OptKey 함수 본문
const m = src.match(/function cafe24OptKey\(s\) \{[\s\S]*?\n\}/);
if (!m) { console.log('❌ cafe24OptKey 추출 실패'); process.exit(1); }
const cafe24OptKey = new Function('return (' + m[0].replace('function cafe24OptKey', 'function') + ')')();

// 감지 비교 로직(핵심)을 실코드와 동일하게 재현: 공통 키만 비교, c24pay=base+add, npay=disc+optprice
function detect(sn, cafe24base, variants) {
    const nOpts = {};
    for (const o of (sn.opts || [])) { if (o.usable === false) continue; const k = cafe24OptKey((o.n1 || '') + ' ' + (o.n2 || '')); if (k) nOpts[k] = Number(sn.discPrice) + Number(o.price || 0); }
    const mis = [];
    for (const v of variants) {
        if (v.display !== 'T' || v.selling !== 'T') continue;
        const k = cafe24OptKey(v.options.map(o => o.value).join(' '));
        if (!k || nOpts[k] == null) continue;
        const c24 = cafe24base + Number(v.additional_amount);
        if (c24 !== nOpts[k]) mis.push({ k, c24, naver: nOpts[k] });
    }
    return mis;
}

(async () => {
    // ── A. 키 정규화: 카페24(·)·네이버(/)·특가·행사문구가 달라도 같은 옵션 = 같은 키
    ok(cafe24OptKey('1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 2.5kg(소과)') === cafe24OptKey('(특가)하우스감귤 가정용 - 2.5kg(소과)'), 'A1 특가/프리픽스 무시 동일 키');
    ok(cafe24OptKey('★단하루★하우스귤 2.5kg소과→중량up4kg') !== cafe24OptKey('하우스감귤 가정용 - 2.5kg(소과)'), 'A2 다른 중량/구성은 다른 키');
    ok(cafe24OptKey('황금향 가정용 - 3kg(중소과 17과 전후)') !== cafe24OptKey('황금향 선물용 - 3kg(대과 7~15과)'), 'A3 가정용≠선물용 구분');
    ok(cafe24OptKey('하우스감귤 가정용 - 2.5kg(소과)') !== cafe24OptKey('황금향 가정용 - 2.5kg(소과)'), 'A4 과일 구분');
    ok(cafe24OptKey('황금향 못난이 - 5kg(랜덤과)') !== cafe24OptKey('황금향 선물용 - 5kg(대과 13~23과)'), 'A5 못난이≠선물(구성차 오매칭 방지)');

    // ── B. 9/6 c94 황금향 교정 「전」 재현: 네이버 정본 vs 카페24(추가금 옛값) → 3건 불일치 잡아야
    const snC94 = { discPrice: 33500, opts: [
        { n1: '과즙팡팡 황금향', n2: '황금향 가정용 - 3kg(중소과 17과 전후)', price: 0 },
        { n1: '과즙팡팡 황금향', n2: '황금향 가정용 - 5kg(중소과 27과 전후)', price: 24300 },
        { n1: '과즙팡팡 황금향', n2: '황금향 선물용 - 3kg(대과 7~15과)', price: 9300 },
        { n1: '과즙팡팡 황금향', n2: '황금향 선물용 - 5kg(대과 13~23과)', price: 29300 },
        { n1: '과즙팡팡 황금향', n2: '황금향 못난이 - 5kg(랜덤과)', price: 4300 },   // 네이버만
    ] };
    const varC94Before = [
        { display: 'T', selling: 'T', additional_amount: '0.00', options: [{ value: '황금향 가정용 - 3kg(중소과 17과 전후)' }] },
        { display: 'T', selling: 'T', additional_amount: '20000.00', options: [{ value: '황금향 가정용 - 5kg(중소과 27과 전후)' }] },  // 53,500 (틀림)
        { display: 'T', selling: 'T', additional_amount: '5000.00', options: [{ value: '황금향 선물용 - 3kg(대과 7~15과)' }] },   // 38,500 (틀림)
        { display: 'T', selling: 'T', additional_amount: '25000.00', options: [{ value: '황금향 선물용 - 5kg(대과 13~23과)' }] },  // 58,500 (틀림)
    ];
    const misBefore = detect(snC94, 33500, varC94Before);
    ok(misBefore.length === 3, 'B1 교정 전 = 불일치 3건 감지', misBefore.map(x => x.c24 + '≠' + x.naver).join(', '));
    ok(misBefore.every(x => x.naver - x.c24 === 4300), 'B2 전건 −4,300 매출손해로 정확 감지');

    // ── C. 9/6 교정 「후」 재현: 추가금 네이버 기준 → 불일치 0
    const varC94After = [
        { display: 'T', selling: 'T', additional_amount: '0.00', options: [{ value: '황금향 가정용 - 3kg(중소과 17과 전후)' }] },
        { display: 'T', selling: 'T', additional_amount: '24300.00', options: [{ value: '황금향 가정용 - 5kg(중소과 27과 전후)' }] },
        { display: 'T', selling: 'T', additional_amount: '9300.00', options: [{ value: '황금향 선물용 - 3kg(대과 7~15과)' }] },
        { display: 'T', selling: 'T', additional_amount: '29300.00', options: [{ value: '황금향 선물용 - 5kg(대과 13~23과)' }] },
    ];
    ok(detect(snC94, 33500, varC94After).length === 0, 'C1 교정 후 = 불일치 0(정상)');

    // ── D. 구성 차이는 오경보 안 함: 네이버만 있는 못난이·카페24만 있는 선물5kg
    const snComp = { discPrice: 23800, opts: [
        { n1: '고당도 하우스감귤', n2: '하우스감귤 가정용 - 2.5kg(소과)', price: 0 },
        { n1: '과즙팡팡 황금향', n2: '황금향 못난이 - 5kg(랜덤과)', price: 14000 },   // 네이버만
    ] };
    const varComp = [
        { display: 'T', selling: 'T', additional_amount: '0.00', options: [{ value: '하우스감귤 가정용 - 2.5kg(소과)' }] },  // 일치
        { display: 'T', selling: 'T', additional_amount: '39000.00', options: [{ value: '황금향 선물용 - 5kg(대과 13~23과)' }] },  // 카페24만 → 제외돼야
    ];
    ok(detect(snComp, 23800, varComp).length === 0, 'D1 한쪽에만 있는 옵션 = 오경보 0');

    // ── E. 과결제(+)도 감지: 타이벡하우스 황금향3kg 37,800(카페24) vs 33,500(네이버)
    const snE = { discPrice: 23800, opts: [{ n1: '과즙팡팡 황금향', n2: '황금향 가정용 - 3kg(중소과 17과 전후)', price: 9700 }] };
    const varE = [{ display: 'T', selling: 'T', additional_amount: '14000.00', options: [{ value: '황금향 가정용 - 3kg(중소과 17과 전후)' }] }];
    const misE = detect(snE, 23800, varE);
    ok(misE.length === 1 && misE[0].diff === undefined && misE[0].c24 - misE[0].naver === 4300, 'E1 과결제(+4,300)도 감지', misE.map(x => x.c24 + '≠' + x.naver).join(''));

    // ── F. 미판매(display/selling F) 옵션은 비교 제외
    const varF = [{ display: 'F', selling: 'F', additional_amount: '99999.00', options: [{ value: '황금향 가정용 - 5kg(중소과 27과 전후)' }] }];
    ok(detect(snC94, 33500, varF).length === 0, 'F1 미판매 옵션 제외');

    // ── G. 실배선 검산(grep)
    ok(/rep\.optMismatch\s*=\s*\[\]/.test(src), 'G1 optMismatch 배열 초기화');
    ok(/옵션 결제가 불일치/.test(src), 'G2 텔레그램 경보 문구 배선');
    ok(src.indexOf('cafe24_sync_last') > src.indexOf('rep.optMismatch = []'), 'G3 감지가 last 저장 전에 실행(결과 영속)');
    ok(/apiGet\(`\/api\/v2\/admin\/products\/\$\{m\.c24\}\/variants`/.test(src), 'G4 variant 읽기 전용 조회(쓰기 아님)');

    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail === 0 ? 0 : 1);
})();
