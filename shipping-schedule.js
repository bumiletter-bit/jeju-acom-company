// shipping-schedule.js — 발송일·도착예정일 자동 계산 (지시 #68 C3, 신규 독립 모듈)
// 용도: 주문일시(KST) → "내일 수요일 오전 발송, 목~금 도착 예정" 형태의 안내 텍스트 생성 (알림톡 변수용)
// 규칙 (⚠️ 전부 대표 검수 대상 — 경계 케이스 표는 지시 #68 응답 참조):
//   1) 발송일 = 주문일 다음 영업일 (영업일 = 월~금, 공휴일 제외 — 톡톡봇 영업일 판정과 동일 기준 + 공휴일 추가)
//      · 주말·공휴일 주문 → 그 다음 첫 영업일 발송
//   2) 도착예정 = 발송일 이후 배송가능일 1~2번째 (배송가능일 = 월~토, 일요일·공휴일 제외 — 택배 일요일 휴무)
//   3) 제주 발송 기준 통상 D+1~D+2 (도서산간·기상 지연은 문구에 미반영 — 안내문에 "예정" 표기로 흡수)
// 봇 코드는 수정하지 않음 — 회사프로그램 쪽 독립 구현 (지시 #68 철칙 1).

// 2026년 공휴일 (⚠️ 대표 검수 필요 — 특히 추석 대체공휴일 여부. 수정은 이 배열만 고치면 됨)
const HOLIDAYS = [
    '2026-01-01',                               // 신정
    '2026-02-16', '2026-02-17', '2026-02-18',   // 설날 연휴
    '2026-03-01', '2026-03-02',                 // 삼일절(일) + 대체공휴일
    '2026-05-05',                               // 어린이날
    '2026-05-24', '2026-05-25',                 // 부처님오신날(일) + 대체공휴일
    '2026-06-06',                               // 현충일(토)
    '2026-08-15', '2026-08-17',                 // 광복절(토) + 대체공휴일
    '2026-09-24', '2026-09-25', '2026-09-26',   // 추석 연휴 (9/26 토 — 대체 여부 검수 필요)
    '2026-10-03', '2026-10-05',                 // 개천절(토) + 대체공휴일
    '2026-10-09',                               // 한글날
    '2026-12-25',                               // 성탄절
];
const HOLIDAY_SET = new Set(HOLIDAYS);
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const KST_MS = 9 * 3600 * 1000;

// KST 달력일 표현: UTC ms → KST 기준 자정의 UTC Date (요일·날짜 연산용)
function kstDay(ms) {
    const k = new Date(ms + KST_MS);
    return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
}
function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
function isHoliday(d) { return HOLIDAY_SET.has(ymd(d)); }
function isBizDay(d) { const w = d.getUTCDay(); return w >= 1 && w <= 5 && !isHoliday(d); }          // 발송 가능일
function isDeliveryDay(d) { const w = d.getUTCDay(); return w >= 1 && w <= 6 && !isHoliday(d); }    // 배송 가능일(토 포함)
function nextMatching(d, pred) { let x = addDays(d, 1); for (let i = 0; i < 30; i++) { if (pred(x)) return x; x = addDays(x, 1); } return x; }

// 발송일 상대 표현: 오늘/내일/모레/다음주 X요일/M월 D일 X요일
function shipPhrase(orderDay, shipDay) {
    const diff = Math.round((shipDay - orderDay) / 86400000);
    const dow = DAY_KO[shipDay.getUTCDay()];
    if (diff === 0) return `오늘 ${dow}요일`;
    if (diff === 1) return `내일 ${dow}요일`;
    if (diff === 2) return `모레 ${dow}요일`;
    if (diff <= 7) return `다음주 ${dow}요일(${shipDay.getUTCMonth() + 1}/${shipDay.getUTCDate()})`;
    return `${shipDay.getUTCMonth() + 1}월 ${shipDay.getUTCDate()}일 ${dow}요일`;
}

/**
 * 주문일시 → 발송·도착 안내 계산
 * @param {Date|number|string} orderAt 주문일시 (기본: 현재)
 * @returns {{shipDate:string, arriveStart:string, arriveEnd:string, text:string}}
 */
function computeShipping(orderAt) {
    const ms = orderAt ? new Date(orderAt).getTime() : Date.now();
    const orderDay = kstDay(ms);
    const shipDay = nextMatching(orderDay, isBizDay);                 // 규칙1: 다음 영업일 발송
    const arrive1 = nextMatching(shipDay, isDeliveryDay);             // 규칙2: 발송 후 첫 배송가능일
    const arrive2 = nextMatching(arrive1, isDeliveryDay);             //        ~ 둘째 배송가능일
    const text = `${shipPhrase(orderDay, shipDay)} 오전 발송, ${DAY_KO[arrive1.getUTCDay()]}~${DAY_KO[arrive2.getUTCDay()]} 도착 예정`;
    return { shipDate: ymd(shipDay), arriveStart: ymd(arrive1), arriveEnd: ymd(arrive2), text };
}

module.exports = { computeShipping, isBizDay, isDeliveryDay, HOLIDAYS };
