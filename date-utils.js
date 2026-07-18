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

// 실존 달력 날짜인지 검증 (예: 2026-04-31 → false) — 억지 조회 방지 가드용
function isValidDateStr(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

module.exports = { parseExplicitDate, parseExplicitMonth, hasExplicitDay, periodRangeOf, needsQueryConfirm, monthEnd, isValidDateStr };
