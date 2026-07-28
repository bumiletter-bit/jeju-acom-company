// shipping-schedule.js — 발송일·도착예정일 자동 계산 (지시 #68 C3 → #69 대표 확정값 보정)
// ★ 대표 확정 규칙 (지시 #69, 2026-07-28):
//   1) 발송 가능 요일 = 월·화·수·목·금·일 (토요일만 발송 불가) + 휴무일(공휴일 등) 발송 불가
//   2) 발송일 = 주문 다음날. 그날이 토요일·휴무일이면 다음 발송 가능일로 밀기
//      · 금 주문 → 일 발송 / 토 주문 → 일 발송 / 일 주문 → 월 발송
//   3) "오전 발송" 표현 유지 (대표 승인)
//   4) 휴무일 = DB(shipping_holidays, 화면 관리 — 판매현황 탭 "🚫 발송 휴무일 관리")에서 읽음.
//      computeShipping의 holidaySet 인자로 주입 — 미주입 시 아래 시드 목록 폴백(DB 장애 대비)
//   6) 도착 = 발송 후 배달 가능일 1~2번째 (배달 가능일 = 월~토 — 일요일·휴무일 배달 제외, 토요일 도착 가능)

// 2026년 공휴일 시드 (DB shipping_holidays 초기 투입용 + DB 미주입 시 폴백)
const HOLIDAYS = [
    ['2026-01-01', '신정'],
    ['2026-02-16', '설날 연휴'], ['2026-02-17', '설날'], ['2026-02-18', '설날 연휴'],
    ['2026-03-01', '삼일절'], ['2026-03-02', '삼일절 대체공휴일'],
    ['2026-05-05', '어린이날'],
    ['2026-05-24', '부처님오신날'], ['2026-05-25', '부처님오신날 대체공휴일'],
    ['2026-06-06', '현충일'],
    ['2026-08-15', '광복절'], ['2026-08-17', '광복절 대체공휴일'],
    ['2026-09-24', '추석 연휴'], ['2026-09-25', '추석'], ['2026-09-26', '추석 연휴'],
    ['2026-10-03', '개천절'], ['2026-10-05', '개천절 대체공휴일'],
    ['2026-10-09', '한글날'],
    ['2026-12-25', '성탄절'],
];
const FALLBACK_SET = new Set(HOLIDAYS.map(h => h[0]));
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const KST_MS = 9 * 3600 * 1000;

// KST 달력일 표현: UTC ms → KST 기준 자정의 UTC Date (요일·날짜 연산용)
function kstDay(ms) {
    const k = new Date(ms + KST_MS);
    return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
}
function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
function isHoliday(d, set) { return (set || FALLBACK_SET).has(ymd(d)); }
function isShipDay(d, set) { return d.getUTCDay() !== 6 && !isHoliday(d, set); }                       // 발송: 토요일·휴무일만 불가
function isDeliveryDay(d, set) { return d.getUTCDay() !== 0 && !isHoliday(d, set); }                   // 배달: 일요일·휴무일만 불가(토 가능)
function nextMatching(d, pred) { let x = addDays(d, 1); for (let i = 0; i < 30; i++) { if (pred(x)) return x; x = addDays(x, 1); } return x; }

// 발송일 상대 표현: 내일/모레/그 이후는 요일+날짜
function shipPhrase(orderDay, shipDay) {
    const diff = Math.round((shipDay - orderDay) / 86400000);
    const dow = DAY_KO[shipDay.getUTCDay()];
    if (diff === 1) return `내일 ${dow}요일`;
    if (diff === 2) return `모레 ${dow}요일`;
    if (diff <= 7) return `${dow}요일(${shipDay.getUTCMonth() + 1}/${shipDay.getUTCDate()})`;
    return `${shipDay.getUTCMonth() + 1}월 ${shipDay.getUTCDate()}일 ${dow}요일`;
}

/**
 * 주문일시 → 발송·도착 안내 계산
 * @param {Date|number|string} orderAt 주문일시 (기본: 현재)
 * @param {Set<string>|null} holidaySet 휴무일 'YYYY-MM-DD' 집합 (DB shipping_holidays — 미주입 시 시드 폴백)
 * @returns {{shipDate:string, arriveStart:string, arriveEnd:string, text:string}}
 */
function computeShipping(orderAt, holidaySet) {
    const ms = orderAt ? new Date(orderAt).getTime() : Date.now();
    const orderDay = kstDay(ms);
    const shipDay = nextMatching(orderDay, d => isShipDay(d, holidaySet));         // 규칙2: 다음날, 토·휴무일이면 밀기
    const arrive1 = nextMatching(shipDay, d => isDeliveryDay(d, holidaySet));      // 규칙6: 발송 후 첫 배달 가능일
    const arrive2 = nextMatching(arrive1, d => isDeliveryDay(d, holidaySet));      //        ~ 둘째 배달 가능일
    const text = `${shipPhrase(orderDay, shipDay)} 오전 발송, ${DAY_KO[arrive1.getUTCDay()]}~${DAY_KO[arrive2.getUTCDay()]} 도착 예정`;
    return { shipDate: ymd(shipDay), arriveStart: ymd(arrive1), arriveEnd: ymd(arrive2), text };
}

module.exports = { computeShipping, isShipDay, isDeliveryDay, HOLIDAYS };
