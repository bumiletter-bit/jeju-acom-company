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

// 실존 달력 날짜인지 검증 (예: 2026-04-31 → false) — 억지 조회 방지 가드용
function isValidDateStr(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

module.exports = { parseExplicitDate, parseExplicitMonth, hasExplicitDay, periodRangeOf, needsQueryConfirm, monthEnd, isValidDateStr, parseExplicitRange, parseComparePeriods };
