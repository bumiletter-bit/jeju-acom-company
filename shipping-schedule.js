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

// 도착 표현 (#335, 2026-08-10 — 대표 실물 "수~월 도착으로 뜬다"):
//   종전엔 "배달 가능일 1~2번째"를 무조건 `수~월`처럼 범위로 붙였다. 연휴가 끼면 두 후보가 6일씩 벌어져
//   손님에게 "도착까지 일주일"로 읽힌다(실측: 8/13~8/17 택배사 휴무 등록 → `수~화`).
//   → 두 후보가 **연속일 때만** 범위로 표기하고, 사이에 휴무가 끼면 **가장 빠른 도착일 하나만** 적는다.
//   → 첫 도착일이 발송 다음날이 아니면(연휴로 밀린 경우) **날짜를 함께** 적어 요일만 보고 오해하지 않게 한다.
function arrivePhrase(shipDay, a1, a2) {
    const md = d => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const gapShip = Math.round((a1 - shipDay) / 86400000);   // 발송 → 첫 도착
    const gapArr = Math.round((a2 - a1) / 86400000);         // 첫 도착 → 둘째 도착
    const d1 = DAY_KO[a1.getUTCDay()], d2 = DAY_KO[a2.getUTCDay()];
    if (gapArr === 1) return gapShip > 1 ? `${d1}(${md(a1)})~${d2} 도착 예정` : `${d1}~${d2} 도착 예정`;
    return gapShip > 1 ? `${d1}요일(${md(a1)}) 도착 예정` : `${d1}요일 도착 예정`;
}

// 발송일 상대 표현: 내일/모레/그 이후는 요일+날짜
function shipPhrase(orderDay, shipDay) {
    const diff = Math.round((shipDay - orderDay) / 86400000);
    const dow = DAY_KO[shipDay.getUTCDay()];
    if (diff === 0) return `오늘 ${dow}요일`;   // #171: 8시 前 주문 = 당일 발송
    if (diff === 1) return `내일 ${dow}요일`;
    if (diff === 2) return `모레 ${dow}요일`;
    if (diff <= 7) return `${dow}요일(${shipDay.getUTCMonth() + 1}/${shipDay.getUTCDate()})`;
    return `${shipDay.getUTCMonth() + 1}월 ${shipDay.getUTCDate()}일 ${dow}요일`;
}

/**
 * 주문일시 → 발송·도착 안내 계산
 * @param {Date|number|string} orderAt 주문일시 (기본: 현재)
 * @param {Set<string>|null} holidaySet 휴무일 'YYYY-MM-DD' 집합 (DB shipping_holidays — 미주입 시 시드 폴백)
 * @param {Map<string,string>|null} noticeByDate 휴무일별 안내 문구 (지시 #73 — 주문일이 문구 있는 휴무일이면
 *        자동 계산 대신 그 문구를 #{발송안내}로 사용. 예: 명절 발송 마감 기간)
 * @returns {{shipDate:string|null, arriveStart:string|null, arriveEnd:string|null, text:string, override:boolean}}
 */
function computeShipping(orderAt, holidaySet, noticeByDate, opts) {
    const ms = orderAt ? new Date(orderAt).getTime() : Date.now();
    const orderDay = kstDay(ms);
    // 지시 #73: 주문일이 안내 문구가 등록된 휴무 기간이면 문구로 대체 (자동 계산 생략)
    const notice = noticeByDate && noticeByDate.get ? noticeByDate.get(ymd(orderDay)) : null;
    if (notice && String(notice).trim()) {
        return { shipDate: null, arriveStart: null, arriveEnd: null, text: String(notice).trim(), override: true };
    }
    // 지시 #171(대표 확정 — 8시 마감 컷오프): 주문 ~07:59 = 당일 발송 후보, 09:00~ = 익일 후보.
    //   (08시대 주문은 홀드 구간 — 호출부(collectKakaoNotify)에서 보류. 이 함수가 직접 받으면 익일 기본)
    //   opts.forceDay: 'today'|'tomorrow' — 보류 건 [수기 발송] 시 대표 선택으로 강제.
    const kstHour = new Date(ms + KST_MS).getUTCHours();
    const force = opts && opts.forceDay;
    const cand = (force === 'today' || (!force && kstHour < 8)) ? orderDay : addDays(orderDay, 1);
    const shipDay = isShipDay(cand, holidaySet) ? cand : nextMatching(cand, d => isShipDay(d, holidaySet));   // 후보일 포함, 토·휴무일이면 밀기
    const arrive1 = nextMatching(shipDay, d => isDeliveryDay(d, holidaySet));      // 규칙6: 발송 후 첫 배달 가능일
    const arrive2 = nextMatching(arrive1, d => isDeliveryDay(d, holidaySet));      //        ~ 둘째 배달 가능일
    const text = `${shipPhrase(orderDay, shipDay)} 오전 발송, ${arrivePhrase(shipDay, arrive1, arrive2)}`;
    return { shipDate: ymd(shipDay), arriveStart: ymd(arrive1), arriveEnd: ymd(arrive2), text, override: false };
}

/**
 * 발송 안내문 요일 플레이스홀더 치환 (지시 #74) — 발송 당일 기준
 * {{내일요일}} = 발송일 이후 첫 배달 가능일 요일, {{모레요일}} = 둘째 배달 가능일 요일
 * (배달 가능일 = 월~토, 일요일·휴무일 제외 — computeShipping 도착 규칙과 동일 기준)
 * @param {string} text 안내문 원문 ({{내일요일}}·{{모레요일}} 포함 가능)
 * @param {Date|number|string} baseAt 발송(출발) 일시 — 기본: 현재
 * @param {Set<string>|null} holidaySet 휴무일 집합 (DB — 미주입 시 시드 폴백)
 */
function renderGuidePlaceholders(text, baseAt, holidaySet) {
    const ms = baseAt ? new Date(baseAt).getTime() : Date.now();
    const base = kstDay(ms);
    const d1 = nextMatching(base, d => isDeliveryDay(d, holidaySet));
    const d2 = nextMatching(d1, d => isDeliveryDay(d, holidaySet));
    return String(text || '')
        .replace(/\{\{내일요일\}\}/g, DAY_KO[d1.getUTCDay()])
        .replace(/\{\{모레요일\}\}/g, DAY_KO[d2.getUTCDay()]);
}

module.exports = { computeShipping, renderGuidePlaceholders, isShipDay, isDeliveryDay, HOLIDAYS };
