// AGENT OFFICE 실행 스크립트 — 세미 (재무팀 · 회계조회)
// 2차: 실제 정산 DB 연결. AI 호출 없음(토큰 0원) — 순수 SQL + 코드 집계.
// 단가는 정산관리 화면과 동일한 3단계 매칭(정확명 → product_mappings → 특징 매칭)으로
// 표시 시점 재계산 (읽기 전용 — settlements/pricing에 어떤 쓰기도 하지 않음).
// 총 결제금액 = 상품 정산 합계 + CJ택배비(박스수×3,100) + CJ 이월금액 — 정산관리 월 배지와 동일 계산.

const CJ_PARTNERS = ['대성(시온)', '효돈농협', '기타거래처'];
const CJ_BOX_FEE = 3100; // 정산관리 화면과 동일 단가

function kstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }
function ymd(d) { return d.toISOString().slice(0, 10); }
function fmt(n) { return Math.round(n).toLocaleString('ko-KR'); }

function safeItems(val) {
    if (!val) return [];
    if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
    return Array.isArray(val) ? val : [];
}

// 기간 내 정산 조회 + 정산관리와 동일 방식 단가 재계산
async function fetchSettlements(pool, helpers, from, to) {
    const rs = await pool.query(
        `SELECT s.id, s.date, s.partner, s.amount, s.items,
            (SELECT jsonb_agg(p.items ORDER BY p.id ASC) FROM pricing p
             WHERE p.partner = s.partner AND p.start_date <= s.date AND p.end_date >= s.date) AS pricing_items
         FROM settlements s
         WHERE s.date >= $1::date AND s.date <= $2::date
         ORDER BY s.date, s.id`, [from, to]);
    const mp = await pool.query('SELECT partner, sales_name, pricing_name FROM product_mappings');
    const mappingsByPartner = {};
    mp.rows.forEach(m => {
        if (!mappingsByPartner[m.partner]) mappingsByPartner[m.partner] = {};
        mappingsByPartner[m.partner][m.sales_name] = m.pricing_name;
    });
    return rs.rows.map(row => {
        const items = safeItems(row.items);
        const priceMap = {};
        safeItems(row.pricing_items).forEach(pItems => {
            safeItems(pItems).forEach(it => { if (it && it.name) priceMap[it.name] = Number(it.price) || 0; });
        });
        const partnerMappings = mappingsByPartner[row.partner] || {};
        let updated = items;
        if (Object.keys(priceMap).length > 0 && items.length > 0) {
            updated = items.map(item => {
                if (!item || !item.name) return item;
                if (priceMap[item.name] !== undefined) {
                    const p = priceMap[item.name];
                    return { ...item, price: p, subtotal: p * (item.qty || 0) };
                }
                const mapped = partnerMappings[item.name];
                if (mapped && priceMap[mapped] !== undefined) {
                    const p = priceMap[mapped];
                    return { ...item, price: p, subtotal: p * (item.qty || 0) };
                }
                const fp = helpers.matchItemToPricing(item.name, priceMap);
                if (fp !== undefined) return { ...item, price: fp, subtotal: fp * (item.qty || 0) };
                return item;
            });
        }
        const amount = updated.length > 0
            ? updated.reduce((s, it) => s + ((it.price || 0) * (it.qty || 0)), 0)
            : Number(row.amount) || 0;
        return { date: row.date, partner: row.partner, amount, items: updated };
    });
}

// 합계 + 품목별 집계 (전년비 상품 기준용)
function aggregate(rows) {
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const byItem = {};
    rows.forEach(r => r.items.forEach(it => {
        if (!it || !it.name) return;
        if (!byItem[it.name]) byItem[it.name] = { name: it.name, qty: 0, amount: 0 };
        byItem[it.name].qty += Number(it.qty) || 0;
        byItem[it.name].amount += (Number(it.price) || 0) * (Number(it.qty) || 0);
    }));
    return { total, count: rows.length, items: Object.values(byItem).sort((a, b) => b.amount - a.amount) };
}

// 거래처별 그룹 (정산 데이터의 partner 구분 그대로 — 정산관리 거래처 카드와 동일 기준)
function groupByPartner(rows) {
    const g = {};
    rows.forEach(r => {
        if (!g[r.partner]) g[r.partner] = { partner: r.partner, count: 0, total: 0, byItem: {} };
        const p = g[r.partner];
        p.count += 1;
        p.total += r.amount;
        r.items.forEach(it => {
            if (!it || !it.name) return;
            if (!p.byItem[it.name]) p.byItem[it.name] = { name: it.name, qty: 0, amount: 0 };
            p.byItem[it.name].qty += Number(it.qty) || 0;
            p.byItem[it.name].amount += (Number(it.price) || 0) * (Number(it.qty) || 0);
        });
    });
    return Object.values(g).map(p => ({
        partner: p.partner, count: p.count, total: p.total,
        items: Object.values(p.byItem).sort((a, b) => b.amount - a.amount).slice(0, 40),
    })).sort((a, b) => b.total - a.total);
}

// CJ택배비: 대성/효돈/기타 정산의 박스수(qty 합계) × 3,100원 (정산관리와 동일 계산)
function cjBoxCount(rows) {
    return rows.reduce((s, r) => CJ_PARTNERS.includes(r.partner)
        ? s + r.items.reduce((q, it) => q + (Number(it.qty) || 0), 0) : s, 0);
}

module.exports = {
    live: true, // 실전 연결됨 (2차) — 마루 라우팅 시 실제 실행 대상
    steps: ['정산 데이터 조회 중...', '거래처·품목별 집계 중...', '전년 동기대비 분석 중...'],
    stepDelayMs: 1500,
    async result({ pool, params = {}, helpers }) {
        const workplace = params.workplace || '전체';

        // 오션라운지: 매출 데이터가 아직 프로그램에 없음 — 정직하게 표시
        if (workplace === '오션라운지') {
            return {
                summary: '오션라운지 정산 데이터 없음',
                lines: [
                    '오션라운지 매출 데이터가 아직 프로그램에 등록되어 있지 않습니다',
                    '현재 조회 가능한 정산은 법인(농업회사법인) 데이터입니다',
                    '오션라운지 연동은 매출 데이터 등록 후 가능합니다',
                ],
                report: {
                    type: 'semi_settlement', workplace: '오션라운지', no_data: true,
                    note: '오션라운지 매출 데이터 없음 — 데이터 등록 후 조회 가능',
                },
            };
        }

        const now = kstNow();
        const today = ymd(now);
        const ym = today.slice(0, 7);
        const year = Number(ym.slice(0, 4));
        const monthNum = Number(ym.slice(5, 7));
        const monthLabel = monthNum + '월';
        // 이번 주: 월요일 ~ 오늘 (KST)
        const dow = (now.getUTCDay() + 6) % 7; // 월=0
        const monday = new Date(now);
        monday.setUTCDate(now.getUTCDate() - dow);
        const weekFrom = ymd(monday);
        // 이번 달: 1일 ~ 말일 (월 전체 — 정산관리 "M월 총 결제금액" 배지와 동일 범위)
        const monthFrom = ym + '-01';
        const monthTo = ym + '-' + String(new Date(Date.UTC(year, monthNum, 0)).getUTCDate()).padStart(2, '0');
        // 전년 동기: 작년 같은 달 전체
        const prevYm = (year - 1) + ym.slice(4);
        const prevFrom = prevYm + '-01';
        const prevTo = prevYm + '-' + String(new Date(Date.UTC(year - 1, monthNum, 0)).getUTCDate()).padStart(2, '0');

        const [weekRows, monthRows, prevRows, cjCarry] = await Promise.all([
            fetchSettlements(pool, helpers, weekFrom, today),
            fetchSettlements(pool, helpers, monthFrom, monthTo),
            fetchSettlements(pool, helpers, prevFrom, prevTo),
            pool.query('SELECT amount FROM cj_carryover WHERE month = $1 LIMIT 1', [ym]),
        ]);
        const week = aggregate(weekRows);
        const month = aggregate(monthRows);
        const prev = aggregate(prevRows);
        const partners = groupByPartner(monthRows);

        // CJ택배비 (정산관리와 동일: 박스수 × 3,100 + 당월 이월금액)
        const weekBoxes = cjBoxCount(weekRows);
        const monthBoxes = cjBoxCount(monthRows);
        const weekCjFee = weekBoxes * CJ_BOX_FEE;
        const monthCjFee = monthBoxes * CJ_BOX_FEE;
        const cjCarryover = Number(cjCarry.rows[0]?.amount) || 0;
        const weekPayment = week.total + weekCjFee; // 이월금액은 월 단위 항목이라 주간에는 미포함
        const monthPayment = month.total + monthCjFee + cjCarryover;

        // 전년 동기대비 품목별 증감 (상품 기준 — 올해∪작년 품목 합집합)
        const prevMap = {};
        prev.items.forEach(i => { prevMap[i.name] = i; });
        const names = new Set([...month.items.map(i => i.name), ...prev.items.map(i => i.name)]);
        const yoyItems = [...names].map(name => {
            const cur = month.items.find(i => i.name === name) || { qty: 0, amount: 0 };
            const p = prevMap[name] || { qty: 0, amount: 0 };
            const diff = cur.amount - p.amount;
            const pct = p.amount > 0 ? Math.round(diff / p.amount * 1000) / 10 : null;
            return { name, cur_qty: cur.qty, cur_amount: cur.amount, prev_qty: p.qty, prev_amount: p.amount, diff, pct };
        }).sort((a, b) => b.cur_amount - a.cur_amount).slice(0, 60);

        const totalDiff = month.total - prev.total; // 상품 기준
        const totalPct = prev.total > 0 ? Math.round(totalDiff / prev.total * 1000) / 10 : null;

        return {
            summary: `완료: ${monthLabel} 총 ${fmt(monthPayment)}원 (상품 ${fmt(month.total)} + 택배 ${fmt(monthCjFee + cjCarryover)})`,
            lines: [
                `이번 주(${weekFrom}~${today}) 총 ${fmt(weekPayment)}원 (상품 ${fmt(week.total)} + 택배 ${fmt(weekCjFee)})`,
                `${monthLabel} 전체(${monthFrom}~${monthTo}) 총 ${fmt(monthPayment)}원 · 정산 ${month.count}건 · 거래처 ${partners.length}곳`,
                prev.total > 0
                    ? `전년 동기 상품 기준 ${fmt(prev.total)}원 → ${totalPct >= 0 ? '+' : ''}${totalPct}% (${totalDiff >= 0 ? '+' : ''}${fmt(totalDiff)}원)`
                    : `전년 동기(${prevFrom.slice(0, 7)}) 정산 데이터 없음`,
            ],
            report: {
                type: 'semi_settlement', workplace: '법인', generated_at: new Date().toISOString(),
                week: { from: weekFrom, to: today, product_total: week.total, cj_fee: weekCjFee, payment_total: weekPayment, count: week.count, box_count: weekBoxes },
                month: { label: monthLabel, from: monthFrom, to: monthTo, product_total: month.total, cj_fee: monthCjFee, cj_carryover: cjCarryover, payment_total: monthPayment, count: month.count, box_count: monthBoxes },
                prev: { from: prevFrom, to: prevTo, total: prev.total, count: prev.count },
                total_diff: totalDiff, total_pct: totalPct,
                partners,
                yoy_items: yoyItems,
                note: `단가는 품목별 금액표 기준 자동 매칭 (정산관리와 동일 계산) · 택배비 = 박스수 × ${CJ_BOX_FEE.toLocaleString()}원 + 당월 이월금액 · 읽기 전용`,
            },
        };
    },
};
