// 1단계 1-1 검증: 월 단위 날짜 정규식 로컬 테스트 (사고 재현 케이스 포함)
// 실행: node scripts/test-dates.js  — 전부 PASS여야 배포 가능
const { parseExplicitDate, parseExplicitMonth, periodRangeOf, needsQueryConfirm, isValidDateStr, parseExplicitRange, parseComparePeriods } = require('../date-utils.js');

const TODAY = '2026-07-18'; // 기준일 고정 (실서버는 kstTodayStr() 사용)
let pass = 0, fail = 0;
function t(name, actual, expected) {
    const ok = actual === expected;
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name} — 기대: ${JSON.stringify(expected)} / 실제: ${JSON.stringify(actual)}`);
}

console.log('=== 월 단위 파싱 (parseExplicitMonth) ===');
t('사고 재현: "4월달 매출현황" → 2026-04', parseExplicitMonth('4월달 매출현황', TODAY), '2026-04');
t('"4월 매출현황 보고해줘" → 2026-04', parseExplicitMonth('4월 매출현황 보고해줘', TODAY), '2026-04');
t('"지난달 정산" → 2026-06', parseExplicitMonth('지난달 정산 어떻게 됐어', TODAY), '2026-06');
t('"저번달 매출" → 2026-06', parseExplicitMonth('저번달 매출 알려줘', TODAY), '2026-06');
t('"이번달 정산현황" → 2026-07', parseExplicitMonth('이번달 정산현황 보여줘', TODAY), '2026-07');
t('"9월 매출" → 2025-09 (미래 월=작년)', parseExplicitMonth('9월 매출 얼마였지', TODAY), '2025-09');
t('"7월 매출" → 2026-07 (당월=올해)', parseExplicitMonth('7월 매출현황', TODAY), '2026-07');
t('"2025년 4월 매출" → 2025-04 (명시 연도 존중)', parseExplicitMonth('2025년 4월 매출 보고', TODAY), '2025-04');
t('"2025년 12월" → 2025-12', parseExplicitMonth('2025년 12월 정산 보여줘', TODAY), '2025-12');
t('특정일 있으면 월 파싱 안 함: "4월 14일 정산현황"', parseExplicitMonth('4월 14일 정산현황 얼마야', TODAY), '');
t('날짜 표현 없음: "카라향 재고 알려줘"', parseExplicitMonth('카라향 재고 알려줘', TODAY), '');
t('1월 기준 "지난달" → 작년 12월', parseExplicitMonth('지난달 매출', '2026-01-05'), '2025-12');

console.log('\n=== 특정일 파싱 회귀 (parseExplicitDate — 기존 동작 유지) ===');
t('"4월 14일 정산현황" → 2026-04-14', parseExplicitDate('4월 14일 정산현황 얼마야?', TODAY), '2026-04-14');
t('"2025년 4월 5일" → 2025-04-05', parseExplicitDate('2025년 4월 5일 정산', TODAY), '2025-04-05');
t('"9월 1일" → 2025-09-01 (미래=작년)', parseExplicitDate('9월 1일 매출', TODAY), '2025-09-01');

console.log('\n=== 조회 복창 판정 (needsQueryConfirm — 1-2) ===');
const rangeOf = (period, target) => periodRangeOf({ period: period || '', target_date: target || '' }, TODAY);
t('2026-04 (3개월 이상 과거) → 복창 필요', needsQueryConfirm(rangeOf('2026-04'), TODAY), true);
t('2025-04 (작년) → 복창 필요', needsQueryConfirm(rangeOf('2025-04'), TODAY), true);
t('2026-06 (지난달) → 즉답', needsQueryConfirm(rangeOf('2026-06'), TODAY), false);
t('2026-07 (이번달) → 즉답', needsQueryConfirm(rangeOf('2026-07'), TODAY), false);
t('this_week → 즉답', needsQueryConfirm(rangeOf('this_week'), TODAY), false);
t('this_month → 즉답', needsQueryConfirm(rangeOf('this_month'), TODAY), false);
t('특정일 2025-04-14 (작년) → 복창 필요', needsQueryConfirm(rangeOf('', '2025-04-14'), TODAY), true);
t('특정일 2026-07-01 (최근) → 즉답', needsQueryConfirm(rangeOf('', '2026-07-01'), TODAY), false);

console.log('\n=== 실존 날짜 검증 (isValidDateStr — 고난도 ④ 가드) ===');
t('2026-04-30 → 유효', isValidDateStr('2026-04-30'), true);
t('2026-04-31 → 무효 (4월은 30일까지)', isValidDateStr('2026-04-31'), false);
t('2024-02-29 → 유효 (윤년)', isValidDateStr('2024-02-29'), true);
t('2026-02-29 → 무효 (평년)', isValidDateStr('2026-02-29'), false);
t('2026-13-01 → 무효', isValidDateStr('2026-13-01'), false);

console.log('\n=== 기간 표현 파싱 (parseExplicitRange — 지시#2 재현성 사고) ===');
const rangeStr = (q, opt) => { const r = parseExplicitRange(q, TODAY, opt); return r ? r.from + '~' + r.to : null; };
t('사고 재현: "7월 25일부터 27일까지" (등록)', rangeStr('7월 25일부터 27일까지 하우스감귤 오픈 할인 일정 등록해줘', { future: true }), '2026-07-25~2026-07-27');
t('"25~27일" (등록)', rangeStr('25~27일 하우스감귤 할인 등록', { future: true }), '2026-07-25~2026-07-27');
t('"25일-27일" (등록)', rangeStr('25일-27일 할인 일정', { future: true }), '2026-07-25~2026-07-27');
t('"3일부터 5일까지" (등록, 지난 날짜→다음 달)', rangeStr('3일부터 5일까지 이벤트 등록', { future: true }), '2026-08-03~2026-08-05');
t('"6월 30일부터 7월 2일까지" (등록, 지난 월→내년)', rangeStr('6월 30일부터 7월 2일까지 할인', { future: true }), '2027-06-30~2027-07-02');
t('"4월 5일부터 10일까지" (조회=과거 해석)', rangeStr('4월 5일부터 10일까지 매출', { future: false }), '2026-04-05~2026-04-10');
t('무효 날짜 "31일부터 32일까지" → null', rangeStr('31일부터 32일까지', { future: true }), null);
t('기간 표현 없음 → null', rangeStr('카라향 재고 알려줘', { future: true }), null);
t('반복 동일성: 같은 입력 3회 동일', [1,2,3].map(() => rangeStr('7월 25일부터 27일까지 등록', { future: true })).every((v, _, a) => v === a[0]), true);

console.log('\n=== 비교 기간 추출 (parseComparePeriods — 4.5단계) ===');
const cmp = q => { const r = parseComparePeriods(q, TODAY); return r ? r.a + ' vs ' + r.b : null; };
t('"4월 5월 매출 비교해줘" → 2026-04 vs 2026-05', cmp('4월 5월 매출 비교해줘'), '2026-04 vs 2026-05');
t('"이번달 지난달 비교" → 07 vs 06', cmp('이번달 지난달 비교'), '2026-07 vs 2026-06');
t('"4월이랑 작년 4월 비교" → 2026-04 vs 2025-04', cmp('4월이랑 작년 4월 비교해줘'), '2026-04 vs 2025-04');
t('"2025년 4월과 4월 비교" → 2025-04 vs 2026-04', cmp('2025년 4월과 4월 비교'), '2025-04 vs 2026-04');
t('기간 1개뿐 → null', cmp('4월 매출 비교해줘'), null);
t('같은 기간 2번 → null', cmp('4월 4월 비교'), null);
t('특정일 포함 → null (미지원 정직)', cmp('4월 14일 5월 14일 비교'), null);

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
