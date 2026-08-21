/* #395 검증 1/3 — 파서·추출기 단위 회귀 (README 8번 중 API 무관 케이스, Node에서 이식본 실코드 실행)
   대조 기준: README_인수인계.md 8번 "완성본에서 검증된 동작" */
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
require(path.join(PUB, 'order-parser.js'));          // 이식본 그대로 로드
require(path.join(PUB, 'order-extract.js'));         // akParseAoa (XLSX는 로드 시점 미참조)
const { akParseOrders, akNormPhone } = globalThis;
const akParseAoa = globalThis.akParseAoa;

let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

/* 케이스 5: 전화 자동 하이픈 — 11자리 3-4-4 / 10자리 3-3-4 / 02는 2-(3~4)-4 */
ok(akNormPhone('01046127618') === '010-4612-7618', '케이스5: 11자리 3-4-4', akNormPhone('01046127618'));
ok(akNormPhone('0165551234') === '016-555-1234', '케이스5: 10자리 3-3-4', akNormPhone('0165551234'));
ok(akNormPhone('0212345678') === '02-1234-5678', '케이스5: 02 지역번호', akNormPhone('0212345678'));

/* 케이스 2: "김성종(태신스틸) 서울 금천구 벚꽃로 40 …" → 수취인명 "김성종(태신스틸)" 분리 */
{
  const r = akParseOrders('김성종(태신스틸) 서울 금천구 벚꽃로 40 벽산디지털밸리 5차 601호 010-1234-5678').orders;
  ok(r.length === 1, '케이스2: 1건 인식', r.length);
  ok(r[0] && /^김성종/.test(r[0].name || ''), '케이스2: 수취인명에 김성종 분리', JSON.stringify(r[0] && r[0].name));
  ok(r[0] && /서울 금천구 벚꽃로 40/.test(r[0].addr || '') && !/김성종/.test(r[0].addr || ''), '케이스2: 주소에서 이름 제거', JSON.stringify(r[0] && r[0].addr));
}

/* 케이스 3: 탭 구분 표 (순번/보내는사람/업체명/개수/성명/전화번호/주소) → 열 매핑·순번 무시·수취인명=성명 */
{
  const aoa = [
    ['순번','보내는사람','업체명','개수','성명','전화번호','주소'],
    ['1','정만웅','태신스틸','2','김성종','010-1234-5678','서울 금천구 벚꽃로 40'],
    ['2','정만웅','진영화학','1','정진영','010-8887-3813','경기도 화성시 향남읍 발안로 440-19'],
  ];
  const r = akParseAoa(aoa);
  ok(r.length === 2, '케이스3: 표 2건', r.length);
  ok(r[0].name === '김성종' && r[1].name === '정진영', '케이스3: 수취인명 = 성명 (업체명 병기 없음)', JSON.stringify([r[0].name, r[1].name]));
  ok(r[0].qty === '2' && r[1].qty === '1', '케이스3: 개수 열 = 수량 (순번 아님)', JSON.stringify([r[0].qty, r[1].qty]));
  ok(r[0].sender === '정만웅', '케이스3: 보내는사람 매핑', r[0].sender);
  ok(r[0].phone === '010-1234-5678', '케이스3: 전화 매핑+하이픈', r[0].phone);
}

/* 케이스 4-a: 헤더 "주 소"(공백 포함) 인식 */
{
  const r = akParseAoa([['성명','전화번호','주 소'], ['박순자','010-4157-3577','서울 강북구 수유동 408-28']]);
  ok(r.length === 1 && r[0].addr === '서울 강북구 수유동 408-28', '케이스4: 헤더 "주 소" 공백 무시 매핑', JSON.stringify(r[0] && r[0].addr));
}

/* 규칙 5(대표 확정): 번호(1,2,3…) 컬럼은 수량으로 취급 금지 */
{
  const aoa = [['이름','전화','주소','번호아닌헤더없음'],
    ['김일','010-1111-2222','서울 마포구 월드컵북로 400','1'],
    ['김이','010-2222-3333','서울 마포구 월드컵북로 401','2'],
    ['김삼','010-3333-4444','서울 마포구 월드컵북로 402','3'],
    ['김사','010-4444-5555','서울 마포구 월드컵북로 403','4']];
  const r = akParseAoa(aoa.slice(1).map(x=>x));   // 헤더 없는 표 → 내용 추측 경로
  const seqAllCleared = r.length === 4 && r.every(o => o.qty === '');
  ok(seqAllCleared, '규칙: 연속 순번(1,2,3,4) 컬럼은 수량 취급 금지(전부 비움)', JSON.stringify(r.map(o=>o.qty)));
}

/* 규칙 4(대표 확정): 보내는이 미입력 시 자동으로 아무것도 붙이지 않음 — 파서 산출 확인 */
{
  const r = akParseOrders('받는분: 김영희 010-5554-1234\n서울 마포구 월드컵북로 400, 101동 202호').orders;
  ok(r.length === 1 && !r[0].sender && !r[0].senderPhone, '규칙: 텍스트에 입금자 없으면 sender 공란', JSON.stringify([r[0].sender, r[0].senderPhone]));
}

/* 예시 4건(원본 샘플) — 전체 흐름 스모크 */
{
  const sample = `한라봉 선물용 5kg씩 보내주세요. 입금자 정만웅 010-9402-0886

1. 정진영 010-8887-3813 경기도 화성시 향남읍 발안로 440-19, 진영화학
2. 오승영 010-5271-3790
경기도 화성시 향남읍 동오1길 19-9 정우테크닉스
3. 김영자 01046127618 전라남도 장성군 북하면 약수리 545-4

받는분 : 박순자
연락처 : 010-4157-3577
서울 강북구 수유동 408-28 3층
문앞에 놓아주세요`;
  const { orders, context } = akParseOrders(sample);
  ok(orders.length === 4, '샘플: 4건 인식', orders.length);
  ok(context.sender === '정만웅' && context.senderPhone === '010-9402-0886', '샘플: 입금자 컨텍스트', JSON.stringify([context.sender, context.senderPhone]));
  ok(orders[3].name === '박순자' && orders[3].memo.includes('문앞'), '샘플: 라벨형 이름·메모', JSON.stringify([orders[3].name, orders[3].memo]));
  ok(orders.every(o => o.product && o.product.includes('한라봉')), '샘플: 상품 컨텍스트 보충', orders[0].product);
}

console.log('\n═══ 파서 단위: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
process.exit(fail ? 1 : 0);
