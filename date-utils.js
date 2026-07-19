// 날짜 파싱 유틸 (v5.0 1단계) — 서버가 지시 원문에서 직접 날짜를 확정한다 (모델 추출 오류 방지)
// server.js와 역량 테스트, 로컬 테스트(scripts/test-dates.js)가 공용으로 사용.

// 지시 원문에 명시된 특정일 파싱 — 모델의 날짜 하루 어긋남 방지
// 지원: '2026-04-05', '2026년 4월 5일', '4월 5일' (연도 없으면 올해, 미래면 작년)
function parseExplicitDate(text, todayStr) {
    const t = String(text || '');
    let y, mo, d;
    let m = t.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/);
    if (m) {
        y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
    } else {
        m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
        if (m) {
            mo = Number(m[1]); d = Number(m[2]); y = Number(todayStr.slice(0, 4));
            const cand = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (cand > todayStr) y -= 1; // 아직 오지 않은 날짜면 작년 (마루 규칙과 동일)
        }
    }
    if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 원문에 특정일(일 단위) 표현이 있는지 — 특정일이 있으면 월 단위 해석은 하지 않는다
function hasExplicitDay(text) {
    const t = String(text || '');
    return /\d{1,2}\s*월\s*\d{1,2}\s*일/.test(t)
        || /\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}/.test(t);
}

// 지시 원문에 명시된 월 단위 기간 파싱 → 'YYYY-MM' (해당 없으면 '')
// 지원: 'N월', 'N월달', '지난달', '저번달', '이번달', 'YYYY년 N월'
// 연도 생략 시: 가장 가까운 과거의 해당 월 (7월에 '4월'=올해 4월, 7월에 '9월'=작년 9월)
// 2025-04 오해석 사고(월 단위 지시 사각지대) 재발 방지 — 1단계 1-1
function parseExplicitMonth(text, todayStr) {
    const t = String(text || '');
    if (hasExplicitDay(t)) return ''; // 특정일 우선 (parseExplicitDate 담당)
    const curY = Number(todayStr.slice(0, 4));
    const curM = Number(todayStr.slice(5, 7));
    const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

    if (/이번\s*달|이달/.test(t)) return ym(curY, curM);
    if (/지난\s*달|저번\s*달/.test(t)) {
        return curM === 1 ? ym(curY - 1, 12) : ym(curY, curM - 1);
    }
    // 명시 연도: '2025년 4월', '2025.4월', '2025-04' (뒤에 일 없음 — 위에서 걸러짐)
    let m = t.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*월?/);
    if (m) {
        const y = Number(m[1]), mo = Number(m[2]);
        if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12) return ym(y, mo); // 명시 연도 존중
    }
    // 연도 없는 'N월'/'N월달' — 앞에 숫자가 붙은 경우(예: '2026년'은 위에서 처리) 제외
    m = t.match(/(?:^|[^\d])(\d{1,2})\s*월\s*달?/);
    if (m) {
        const mo = Number(m[1]);
        if (mo >= 1 && mo <= 12) {
            return mo > curM ? ym(curY - 1, mo) : ym(curY, mo); // 가장 가까운 과거의 해당 월
        }
    }
    return '';
}

// 월 말일 (YYYY-MM → 'YYYY-MM-DD')
function monthEnd(ym) {
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    return ym + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
}

// 조건(period/target_date)을 실제 조회 범위로 해석 → {from, to, label} / 해석 불가 시 null
// 세미(agents/세미.js resolvePeriod)와 동일 규칙 — 복창 판정용
function periodRangeOf(conditions, todayStr) {
    const target = String(conditions.target_date || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(target)) {
        return { from: target, to: target, label: `${Number(target.slice(5, 7))}월 ${Number(target.slice(8, 10))}일` };
    }
    const period = String(conditions.period || '').trim();
    if (!period) return null;
    if (period === 'this_week' || period === 'this_month') return null; // 최근 기간 — 복창 불필요
    const m = period.match(/^(\d{4})-(\d{1,2})$/);
    if (m) {
        const ym = m[1] + '-' + String(Number(m[2])).padStart(2, '0');
        const label = (m[1] === todayStr.slice(0, 4) ? '' : m[1] + '년 ') + Number(m[2]) + '월';
        return { from: ym + '-01', to: monthEnd(ym), label };
    }
    return null;
}

// 조회 복창 필요 여부 — 기간 시작이 오늘 기준 3개월 이상 과거이거나, 연도가 작년 이전 (1단계 1-2)
function needsQueryConfirm(range, todayStr) {
    if (!range) return false;
    const y = Number(todayStr.slice(0, 4)), mo = Number(todayStr.slice(5, 7)), d = Number(todayStr.slice(8, 10));
    const threeAgo = `${mo <= 3 ? y - 1 : y}-${String(((mo - 3 - 1 + 12) % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (Number(range.from.slice(0, 4)) < y) return true;
    return range.from <= threeAgo;
}

// 기간 표현 파싱 (지시 #2 — 재현성 사고 대응): "7월 25일부터 27일까지", "25~27일", "25일-27일",
// "6월 30일부터 7월 2일까지" 등 → { from, to } / 해당 없으면 null
// future=true(일정 등록): 가장 가까운 미래 해석 / false(조회): 가장 가까운 과거 해석
function parseExplicitRange(text, todayStr, { future = false } = {}) {
    const t = String(text || '');
    const curY = Number(todayStr.slice(0, 4));
    const curM = Number(todayStr.slice(5, 7));
    const mk = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    let m1, d1, m2, d2;
    // A: 'M월 D일 부터/~/- (M월)? D일 (까지)?'
    let m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*(?:부터|에서|~|-)\s*(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일/);
    if (m) { m1 = Number(m[1]); d1 = Number(m[2]); m2 = m[3] ? Number(m[3]) : m1; d2 = Number(m[4]); }
    else {
        // B: 'D일부터 D일까지' / 'D~D일' / 'D일~D일' / 'D일-D일' (월 생략 → 오늘 기준 해석)
        m = t.match(/(\d{1,2})\s*일?\s*(?:부터|~|-)\s*(\d{1,2})\s*일/);
        if (!m) return null;
        d1 = Number(m[1]); d2 = Number(m[2]);
        m1 = m2 = curM;
        // 월 생략 시: 시작일이 이미 지났으면(미래 모드) 다음 달, (과거 모드) 이번 달 유지
        if (future && mk(curY, curM, d1) < todayStr) { m1 = m2 = curM === 12 ? 1 : curM + 1; }
    }
    // 연도 해석: 명시 월 기준 가장 가까운 미래(등록) 또는 과거(조회)
    let y1 = curY;
    if (future) { if (m1 < curM || (m1 === curM && mk(curY, m1, d1) < todayStr)) y1 = curY + 1; }
    else { if (m1 > curM || (m1 === curM && mk(curY, m1, d1) > todayStr)) y1 = curY - 1; }
    // 월 생략 B에서 다음 달로 넘겼는데 1월이 된 경우 연도 +1
    if (future && m1 === 1 && curM === 12) y1 = curY + 1;
    const y2 = m2 < m1 ? y1 + 1 : y1; // '12월 30일부터 1월 2일까지' 해 넘김
    const from = mk(y1, m1, d1), to = mk(y2, m2, d2);
    if (!isValidDateStr(from) || !isValidDateStr(to) || to < from) return null;
    return { from, to };
}

// 4.5단계: 비교 지시에서 월 단위 기간 2개 추출 ("4월 5월 비교", "이번달 지난달", "4월이랑 작년 4월")
// → { a: 'YYYY-MM', b: 'YYYY-MM' } (등장 순서 유지) / 2개가 아니면 null
function parseComparePeriods(text, todayStr) {
    const t = String(text || '');
    if (hasExplicitDay(t)) return null; // 특정일 비교는 미지원 (정직하게 단일 조회로)
    const curY = Number(todayStr.slice(0, 4));
    const curM = Number(todayStr.slice(5, 7));
    const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    const found = [];
    // 등장 순서대로 토큰 수집: 작년 N월 | YYYY년 N월 | N월(달) | 이번달 | 지난달/저번달
    const re = /(작년\s*(\d{1,2})\s*월)|((\d{4})\s*[년.\-\/]\s*(\d{1,2})\s*월)|((\d{1,2})\s*월\s*달?)|(이번\s*달|이달)|(지난\s*달|저번\s*달)/g;
    let m;
    while ((m = re.exec(t)) !== null && found.length < 3) {
        if (m[1]) { // 작년 N월
            const mo = Number(m[2]);
            if (mo >= 1 && mo <= 12) found.push(ym(curY - 1, mo));
        } else if (m[3]) { // YYYY년 N월
            const y = Number(m[4]), mo = Number(m[5]);
            if (y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12) found.push(ym(y, mo));
        } else if (m[6]) { // N월 — 가장 가까운 과거 해석
            const mo = Number(m[7]);
            if (mo >= 1 && mo <= 12) found.push(mo > curM ? ym(curY - 1, mo) : ym(curY, mo));
        } else if (m[8]) found.push(ym(curY, curM));
        else if (m[9]) found.push(curM === 1 ? ym(curY - 1, 12) : ym(curY, curM - 1));
    }
    if (found.length !== 2 || found[0] === found[1]) return null;
    return { a: found[0], b: found[1] };
}

// ===== 지시 #15: 주차 파싱 =====
// 주차 경계 = 주간 정산 현황 화면(getWeeksInMonth)과 동일 알고리즘 — 기준 이원화 금지.
// 월요일 시작 7일 주. N월의 주차 = 1일이 속한 주(월요일이 전월일 수 있음)부터 말일이 속한 주까지.
function weeksOfMonth(year, month /* 1~12 */) {
    const weeks = [];
    const first = new Date(Date.UTC(year, month - 1, 1));
    const last = new Date(Date.UTC(year, month, 0));
    const dow1 = first.getUTCDay(); // 0=일, 1=월
    const monday = new Date(first);
    if (dow1 === 0) monday.setUTCDate(first.getUTCDate() - 6);
    else if (dow1 !== 1) monday.setUTCDate(first.getUTCDate() - (dow1 - 1));
    const cur = new Date(monday);
    for (;;) {
        const s = new Date(cur), e = new Date(cur);
        e.setUTCDate(e.getUTCDate() + 6);
        weeks.push({ from: s.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) });
        if (e >= last) break;
        cur.setUTCDate(cur.getUTCDate() + 7);
    }
    return weeks;
}

// 주차 표현 → { from, to, label } / 해당 없으면 null (같은 입력 = 같은 결과, 서버 확정 전용)
// 지원: 이번주/금주, 지난주/저번주/전주, (YYYY년)? N월 N주차·N째주·N번째주·첫째~여섯째주, (월 생략) N주차
// 연도 생략 시 가장 가까운 과거의 해당 월 (parseExplicitMonth와 동일 규칙). 존재하지 않는 주차는 null
function parseWeekSpec(text, todayStr) {
    const s = String(text || '');
    const weekOfDay = (dayStr, offsetWeeks) => {
        const t = new Date(dayStr + 'T00:00:00Z');
        const dow = (t.getUTCDay() + 6) % 7; // 월=0
        const mon = new Date(t);
        mon.setUTCDate(t.getUTCDate() - dow + offsetWeeks * 7);
        const sun = new Date(mon);
        sun.setUTCDate(mon.getUTCDate() + 6);
        return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
    };
    const short = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    if (/이번\s*주|금주/.test(s)) {
        const r = weekOfDay(todayStr, 0);
        return { ...r, label: `이번주(${short(r.from)}~${short(r.to)})` };
    }
    if (/지난\s*주|저번\s*주|전주/.test(s)) {
        const r = weekOfDay(todayStr, -1);
        return { ...r, label: `지난주(${short(r.from)}~${short(r.to)})` };
    }
    const ORD = { '첫': 1, '둘': 2, '셋': 3, '넷': 4, '다섯': 5, '여섯': 6 };
    // 월 명시형: "N월 2주차" / "N월 둘째주" / "N월 2번째 주" (숫자 단독 "N월 2주"는 기간 오인 위험으로 미지원)
    let m = s.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(?:([1-6])\s*(?:주차|째\s*주|번째\s*주)|(첫|둘|셋|넷|다섯|여섯)\s*째\s*주)/);
    let year = null, month = null, n = null;
    if (m) {
        month = Number(m[2]);
        n = m[3] ? Number(m[3]) : ORD[m[4]];
        if (month < 1 || month > 12) return null;
        if (m[1]) year = Number(m[1]);
        else {
            const ty = Number(todayStr.slice(0, 4)), tm = Number(todayStr.slice(5, 7));
            year = month > tm ? ty - 1 : ty; // 가장 가까운 과거 해석 (parseExplicitMonth 동일)
        }
    } else {
        // 월 생략형: "2주차" 단독 → 오늘이 속한 달 기준
        m = s.match(/(?:^|[^\d월])([1-6])\s*주차/);
        if (!m) return null;
        n = Number(m[1]);
        year = Number(todayStr.slice(0, 4));
        month = Number(todayStr.slice(5, 7));
    }
    const weeks = weeksOfMonth(year, month);
    if (n < 1 || n > weeks.length) return null;
    const w = weeks[n - 1];
    return { ...w, label: `${month}월 ${n}주차(${short(w.from)}~${short(w.to)})` };
}

// ===== 지시 #54: 날짜 단일 소스 — 상대 요일 범위 파서 =====
// "담주/다음주/이번주 화요일부터 목요일(까지)" → { from, to, label } (요일 포함 표기).
// S1 스모크에서 글샘이 '담주 화요일'을 하루 밀려 계산한 사고 대응 — 날짜의 주인은 서버.
const _DOW_MAP = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };
const _DOW_KO = ['월', '화', '수', '목', '금', '토', '일'];
function parseWeekdayRange(text, todayStr) {
    const s = String(text || '');
    // 핫픽스(실전 첫 발현): "화~목" 축약형 지원 — 범위 기호(~·-·부터)가 있으면 '요일' 생략 허용.
    // 단독형은 '요일' 필수 유지 ("다음주 수확"의 '수' 오탐 방지)
    const m = s.match(/(담주|다음\s*주|이번\s*주|금주)\s*([월화수목금토일])(?:요일?)?\s*(?:부터|에서|~|-)\s*([월화수목금토일])(?:요일?)?/)
        || s.match(/(담주|다음\s*주|이번\s*주|금주)\s*([월화수목금토일])요일?/);
    if (!m) return null;
    const nextWeek = /담주|다음/.test(m[1]);
    const t = new Date(todayStr + 'T00:00:00Z');
    const dow = (t.getUTCDay() + 6) % 7; // 월=0
    const monday = new Date(t);
    monday.setUTCDate(t.getUTCDate() - dow + (nextWeek ? 7 : 0));
    const mk = di => { const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + di); return d.toISOString().slice(0, 10); };
    const fromIdx = _DOW_MAP[m[2]];
    const toIdx = m[3] !== undefined && m[3] !== null && _DOW_MAP[m[3]] !== undefined ? _DOW_MAP[m[3]] : fromIdx;
    if (toIdx < fromIdx) return null; // 역순 범위는 미지원 (오해석 방지)
    const from = mk(fromIdx), to = mk(toIdx);
    const fmt = (ds, di) => `${ds}(${_DOW_KO[di]})`;
    return { from, to, label: fromIdx === toIdx ? fmt(from, fromIdx) : `${fmt(from, fromIdx)}~${fmt(to, toIdx)}` };
}

// 실존 달력 날짜인지 검증 (예: 2026-04-31 → false) — 억지 조회 방지 가드용
function isValidDateStr(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

module.exports = { parseExplicitDate, parseExplicitMonth, hasExplicitDay, periodRangeOf, needsQueryConfirm, monthEnd, isValidDateStr, parseExplicitRange, parseComparePeriods, weeksOfMonth, parseWeekSpec, parseWeekdayRange };
