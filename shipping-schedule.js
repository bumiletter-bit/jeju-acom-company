// shipping-schedule.js — 발송일·도착예정일 자동 계산 (지시 #68 C3 → #69 대표 확정값 보정)
// ★ 대표 확정 규칙 (지시 #69, 2026-07-28):
//   1) 발송 가능 요일 = 월·화·수·목·금·일 (토요일만 발송 불가) + 발송 휴무일 발송 불가
//   2) 발송일 = 주문 다음날. 그날이 토요일·발송휴무일이면 다음 발송 가능일로 밀기
//      · 금 주문 → 일 발송 / 토 주문 → 일 발송 / 일 주문 → 월 발송
//   3) "오전 발송" 표현 유지 (대표 승인)
//   4) 휴무일 = DB(shipping_holidays, 화면 관리 — 판매현황 탭 "🚫 발송 휴무일 관리")에서 읽음.
//      computeShipping의 shipOffSet 인자로 주입 — 미주입 시 아래 시드 목록 폴백(DB 장애 대비)
//   6) 도착 = 발송 후 배달 가능일 1~2번째 (배달 가능일 = 월~토 — 일요일·도착불가일 제외, 토요일 도착 가능)
//
// 🔴 #336(2026-08-10 대표 확정 — 이 파일의 가장 중요한 전제):
//   **「발송 휴무」와 「도착 불가」는 별개다.** 종전엔 휴무일 하나를 발송·배달 양쪽에서 똑같이 제외했는데,
//   대표 실물 지적으로 그게 틀렸음이 확인됐다 — 8/13은 "우리가 발송을 안 하는 날"일 뿐 **택배 배달은 되는 날**이라,
//   8/12 발송분은 8/13에 정상 도착한다. 종전 계산은 이를 8/17 도착으로 잘못 안내하고 있었다.
//     · shipOffSet  = 우리가 출고하지 않는 날 (달력 「발송휴무」 체크)
//     · arriveOff   = 택배가 배달되지 않는 날 (달력 「도착불가」 체크 — 명절·공휴일 등 특수사항)
//   한 날짜가 둘 다일 수도, 하나만일 수도 있다(예: 광복절 대체휴무 = 우리는 발송 O · 택배 배달 X).
//   대표 원리: **발송일 다음날 = "내일", 그 다음날 = "모레" 도착**이 기본이고, 그 후보에 도착불가일이 끼면
//   그 날짜만 빼고 남은 날로 안내한다(둘 다 끼면 다음 배달 가능일로 밀림).

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
function isShipDay(d, set) { return d.getUTCDay() !== 6 && !isHoliday(d, set); }                       // 발송: 토요일·발송휴무일만 불가
// #336: 배달 판정은 **도착불가 집합**만 본다(발송휴무는 배달에 영향 없음 — 위 머리말 참조).
//   arriveOff 미주입 시엔 시드 공휴일로 폴백(DB 장애 대비 — 공휴일은 배달도 없다는 보수적 기본값).
function isDeliveryDay(d, arriveOff) { return d.getUTCDay() !== 0 && !isHoliday(d, arriveOff); }       // 배달: 일요일·도착불가일만 불가(토 가능)
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

// #336: 발송이 밀린 원인이 된 휴무일의 사유를 찾아준다 (고객 안내에 "왜 늦는지"를 함께 적기 위함).
//   후보일(cand)부터 실제 발송일 전날까지 훑어 **사유가 등록된 발송휴무일**의 첫 사유를 채택.
//   토요일만으로 밀린 경우(사유 없음)는 자명하므로 아무것도 붙이지 않는다.
function shipDelayReason(cand, shipDay, reasonByDate) {
    if (!reasonByDate || !reasonByDate.get || shipDay <= cand) return null;
    for (let d = cand; d < shipDay; d = addDays(d, 1)) {
        const r = reasonByDate.get(ymd(d));
        if (r && String(r).trim()) return String(r).trim();
    }
    return null;
}

/**
 * 주문일시 → 발송·도착 안내 계산
 * @param {Date|number|string} orderAt 주문일시 (기본: 현재)
 * @param {Set<string>|null} shipOffSet 발송 휴무일 'YYYY-MM-DD' 집합 (DB shipping_holidays.no_ship — 미주입 시 시드 폴백)
 * @param {Map<string,string>|null} reasonByDate 날짜별 휴무 사유 (#336 — 발송이 밀렸을 때 그 사유를 문구 끝에 병기.
 *        종전 #73의 "안내 문구로 통째 대체(override)"는 발송일이 사라져 고객이 언제 받는지 알 수 없어 폐지)
 * @param {{forceDay?:'today'|'tomorrow', arriveOff?:Set<string>}} opts
 *        arriveOff = 택배 배달이 안 되는 날 집합 (달력 「도착불가」 — 발송휴무와 별개)
 * @returns {{shipDate:string, arriveStart:string, arriveEnd:string, text:string, reason:string|null, override:boolean}}
 */
function computeShipping(orderAt, shipOffSet, reasonByDate, opts) {
    const ms = orderAt ? new Date(orderAt).getTime() : Date.now();
    const orderDay = kstDay(ms);
    const arriveOff = (opts && opts.arriveOff) || null;
    // 지시 #171(대표 확정 — 8시 마감 컷오프): 주문 ~07:59 = 당일 발송 후보, 09:00~ = 익일 후보.
    //   (08시대 주문은 홀드 구간 — 호출부(collectKakaoNotify)에서 보류. 이 함수가 직접 받으면 익일 기본)
    //   opts.forceDay: 'today'|'tomorrow' — 보류 건 [수기 발송] 시 대표 선택으로 강제.
    const kstHour = new Date(ms + KST_MS).getUTCHours();
    const force = opts && opts.forceDay;
    const cand = (force === 'today' || (!force && kstHour < 8)) ? orderDay : addDays(orderDay, 1);
    const shipDay = isShipDay(cand, shipOffSet) ? cand : nextMatching(cand, d => isShipDay(d, shipOffSet));   // 후보일 포함, 토·발송휴무일이면 밀기
    const arrive1 = nextMatching(shipDay, d => isDeliveryDay(d, arriveOff));       // 규칙6: 발송 후 첫 배달 가능일
    const arrive2 = nextMatching(arrive1, d => isDeliveryDay(d, arriveOff));       //        ~ 둘째 배달 가능일
    const reason = shipDelayReason(cand, shipDay, reasonByDate);
    const text = `${shipPhrase(orderDay, shipDay)} 오전 발송, ${arrivePhrase(shipDay, arrive1, arrive2)}`
        + (reason ? ` (${reason})` : '');
    return { shipDate: ymd(shipDay), arriveStart: ymd(arrive1), arriveEnd: ymd(arrive2), text, reason, override: false };
}

// ── #336: 발송 안내(E·LMS)용 도착 표기 — 발송 당일 기준 "내일/모레"
//   🔴 종전엔 '내일 {{내일요일}}요일~모레 {{모레요일}}요일'을 **문자열로 박아** 요일만 갈아끼웠다.
//      그래서 도착불가일이 끼어 닷새 뒤에 도착하는 건에도 "내일"이 그대로 붙었다(대표 지적).
//      → 실제 간격을 재서 "내일"이 맞을 때만 "내일"이라 쓰고, 아니면 요일+날짜로 적는다.
function arriveGuidePhrase(shipDay, a1, a2) {
    const md = d => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const g1 = Math.round((a1 - shipDay) / 86400000);   // 발송 → 첫 도착
    const gA = Math.round((a2 - a1) / 86400000);        // 첫 도착 → 둘째 도착
    const d1 = DAY_KO[a1.getUTCDay()], d2 = DAY_KO[a2.getUTCDay()];
    const first = g1 === 1 ? `내일 ${d1}요일` : `${d1}요일(${md(a1)})`;
    if (gA !== 1) return `${first} 도착 예정`;                                   // 둘째 후보가 떨어져 있으면 최단 도착일만
    return `${first}~${g1 === 1 ? `모레 ${d2}요일` : `${d2}요일`} 사이 도착 예정`;
}
/**
 * 발송(출고) 시점 → 도착 안내 문구
 * @param {Date|number|string} shipAt 발송처리 일시 (기본: 현재)
 * @param {Set<string>|null} arriveOff 도착 불가일 집합
 * @param {Map<string,string>|null} reasonByDate 날짜별 사유 — 도착이 다음날보다 밀렸을 때 사유 병기
 */
function computeArrival(shipAt, arriveOff, reasonByDate) {
    const ms = shipAt ? new Date(shipAt).getTime() : Date.now();
    const shipDay = kstDay(ms);
    const a1 = nextMatching(shipDay, d => isDeliveryDay(d, arriveOff));
    const a2 = nextMatching(a1, d => isDeliveryDay(d, arriveOff));
    // 도착이 발송 다음날이 아니면(중간에 도착불가일) 그 사유를 함께 알린다
    let reason = null;
    if (reasonByDate && reasonByDate.get && Math.round((a1 - shipDay) / 86400000) > 1) {
        for (let d = addDays(shipDay, 1); d < a1; d = addDays(d, 1)) {
            const r = reasonByDate.get(ymd(d));
            if (r && String(r).trim()) { reason = String(r).trim(); break; }
        }
    }
    return { arriveStart: ymd(a1), arriveEnd: ymd(a2), reason,
             text: arriveGuidePhrase(shipDay, a1, a2) + (reason ? ` (${reason})` : '') };
}

/**
 * 발송 안내문 요일 플레이스홀더 치환 (지시 #74) — 발송 당일 기준
 * {{내일요일}} = 발송일 이후 첫 배달 가능일 요일, {{모레요일}} = 둘째 배달 가능일 요일
 * (배달 가능일 = 월~토, 일요일·휴무일 제외 — computeShipping 도착 규칙과 동일 기준)
 * @param {string} text 안내문 원문 ({{내일요일}}·{{모레요일}} 포함 가능)
 * @param {Date|number|string} baseAt 발송(출발) 일시 — 기본: 현재
 * @param {Set<string>|null} arriveOff 도착 불가일 집합 (#336 — 발송휴무가 아니라 배달 불가 기준)
 */
function renderGuidePlaceholders(text, baseAt, arriveOff) {
    const ms = baseAt ? new Date(baseAt).getTime() : Date.now();
    const base = kstDay(ms);
    const d1 = nextMatching(base, d => isDeliveryDay(d, arriveOff));
    const d2 = nextMatching(d1, d => isDeliveryDay(d, arriveOff));
    return String(text || '')
        .replace(/\{\{내일요일\}\}/g, DAY_KO[d1.getUTCDay()])
        .replace(/\{\{모레요일\}\}/g, DAY_KO[d2.getUTCDay()]);
}

module.exports = { computeShipping, computeArrival, renderGuidePlaceholders, isShipDay, isDeliveryDay, HOLIDAYS };
