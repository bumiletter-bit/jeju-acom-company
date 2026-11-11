/* #1111-B 직원별 근무일(대표 11/11 「알림은 주말·공휴일에는 가지 않도록 · 단 승협 근무는 화~토 · 나머지는 월~금」)
 *
 *   근무 요일 = 설정 agent_office_config 'staff_alerts'.workdays = { default: [1,2,3,4,5], users: { "<user id>": [2,3,4,5,6] } }
 *               (요일 숫자 0 = 일 … 6 = 토 · 없으면 월~금)
 *   휴무일(누구나 쉼 · 사람별 근무 요일보다 우선) = ①shipping-schedule.js HOLIDAYS(2026 공휴일·대체공휴일 시드) ②staff_alerts.holidays [YYYY-MM-DD]
 *                      ③staff_alerts.holidays_from_shipping = 발송 휴무일 달력(shipping_holidays)
 *                         기본(없음·true·'no_ship') = 발송 휴무 체크한 날 전부(대표 11/11 「우리가 발송 휴무일 체크한 건도 휴무」 · 도착 불가(no_arrive)만 체크된 날은 휴무 아님)
 *                         'names' = 사유가 공휴일 이름인 줄만 · false = 안 봄
 *   쓰는 곳 = staff-alerts.js(새 직원 알림 6종 · 받는 사람 근무일에만) · push.js(종전 알림의 폰 푸시 = 쉬는 날 보류 → 다음 근무일 아침 1통)
 *   순수 함수(isOffFor·prevWorkdayFor·holidaySetOf) + 설정 읽기 load(pool)(1분 기억)
 */
'use strict';
const DAY = 86400e3, KST = 9 * 3600e3;
const HOLIDAY_NAME_RE = /공휴|신정|설날|설\s*연휴|삼일절|어린이날|부처님|석가|현충일|광복절|추석|개천절|한글날|성탄|크리스마스|선거|임시공휴/;
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const dayMs = d => Date.parse(d + 'T00:00:00Z');
const ymdOf = ms => new Date(ms).toISOString().slice(0, 10);
const kstDate = ms => new Date(ms + KST).toISOString().slice(0, 10);

function holidaySetOf({ seed, cfgDays, shippingRows, fromShipping }) {
    const s = new Set();
    for (const h of (seed || [])) s.add(Array.isArray(h) ? String(h[0]) : String(h));
    for (const d of (cfgDays || [])) if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) s.add(String(d));
    if (fromShipping === false) return s;
    const namesOnly = fromShipping === 'names';
    for (const r of (shippingRows || [])) {
        if (namesOnly ? HOLIDAY_NAME_RE.test(String(r.reason || '')) : r.no_ship !== false) s.add(String(r.d));   // no_ship 비어 있음(옛 줄) = 발송 휴무로 봄(서버 loadShippingHolidayInfo 의 COALESCE(no_ship, TRUE) 와 같게)
    }
    return s;
}
function daysOf(workdays, uid) {
    const w = workdays && typeof workdays === 'object' ? workdays : {};
    const pick = v => Array.isArray(v) ? v.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : null;
    const own = w.users && uid != null ? pick(w.users[String(uid)]) : null;
    if (own && own.length) return own;
    const def = pick(w.default);
    return def && def.length ? def : DEFAULT_DAYS;
}
// day = 'YYYY-MM-DD'(KST 날짜) · uid 없음 = 기본 요일로 판정
function isOffFor(uid, day, workdays, holidaySet) {
    if (holidaySet && holidaySet.has(day)) return true;
    return !daysOf(workdays, uid).includes(new Date(dayMs(day)).getUTCDay());
}
function prevWorkdayFor(uid, day, workdays, holidaySet) {
    let ms = dayMs(day);
    for (let i = 0; i < 30; i++) { ms -= DAY; const d = ymdOf(ms); if (!isOffFor(uid, d, workdays, holidaySet)) return d; }
    return ymdOf(dayMs(day) - DAY);
}

// 설정·휴무일 표 읽기(1분 기억) → { cfg, workdays, hol }
function loader(pool, log) {
    let cache = null;
    return async function load() {
        if (cache && Date.now() - cache.at < 60000) return cache.v;
        let cfg = {};
        try { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'staff_alerts'`); cfg = (r.rows[0] && r.rows[0].value) || {}; } catch (e) { if (log) log.error('[근무일] 설정 읽기 실패(기본 월~금):', e.message); }
        let rows = [];
        if (cfg.holidays_from_shipping !== false) { try { rows = (await pool.query(`SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d, reason, COALESCE(no_ship, TRUE) AS no_ship FROM shipping_holidays WHERE deleted_at IS NULL`)).rows; } catch (e) { if (log) log.error('[근무일] 발송 휴무일 읽기 실패(시드·설정만):', e.message); } }
        let seed = []; try { seed = require('./shipping-schedule.js').HOLIDAYS; } catch (_) { /* 시드 없음 */ }
        const v = { cfg, workdays: cfg.workdays || null, hol: holidaySetOf({ seed, cfgDays: cfg.holidays, shippingRows: rows, fromShipping: cfg.holidays_from_shipping }) };
        cache = { at: Date.now(), v };
        return v;
    };
}

module.exports = { isOffFor, prevWorkdayFor, holidaySetOf, daysOf, loader, kstDate, DEFAULT_DAYS, HOLIDAY_NAME_RE };
