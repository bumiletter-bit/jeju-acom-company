// 1단계 1-1 검증: 월 단위 날짜 정규식 로컬 테스트 (사고 재현 케이스 포함)
// 실행: node scripts/test-dates.js  — 전부 PASS여야 배포 가능
const { parseExplicitDate, parseExplicitMonth, periodRangeOf, needsQueryConfirm } = require('../date-utils.js');

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

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
