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

// ===== 8차: 특정 일자 정산현황 조회 (settlement_status — 읽기 전용) =====
const SS_LABELS = {
    current_cash: '현재 현금', settlement_scheduled: '스토어 정산예정', unsettled: '스토어 미정산',
    coupang_unpaid: '쿠팡 미정산', selfmall_unpaid: '자사몰 미정산',
    ad_naver: '네이버 광고', ad_gfa: 'GFA 광고',
    card_fee: '카드이용금액', corp_card: '법인카드',
    daesong: '대성', hyodong: '효돈', aewol: '애월', delivery: '택배',
};
function ssTotalRow(row) {
    const n = k => Number(row[k]) || 0;
    return n('current_cash') + n('settlement_scheduled') + n('unsettled') + n('coupang_unpaid') + n('selfmall_unpaid')
        + n('ad_naver') + n('ad_gfa') - n('card_fee') - n('corp_card')
        - n('daesong') - n('hyodong') - n('aewol') - n('delivery');
}
function dateLabelOf(ds) {
    const s = String(ds).slice(0, 10);
    const dt = new Date(s + 'T00:00:00Z');
    return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}(${['일', '월', '화', '수', '목', '금', '토'][dt.getUTCDay()]})`;
}

// 특정 날짜 정산현황 보고 (총합계·섹션 요약·직전 기록 대비)
async function statusReport({ pool, date }) {
    const cur = await pool.query('SELECT * FROM settlement_status WHERE date = $1', [date]);
    const dl = dateLabelOf(date);
    if (cur.rows.length === 0) {
        // 정직 안내: 기록 없음 + 가장 가까운 기록
        const near = await pool.query(
            `SELECT date FROM settlement_status
             ORDER BY GREATEST(date - $1::date, $1::date - date) ASC LIMIT 1`, [date]);
        const nearest = near.rows[0] ? String(near.rows[0].date).slice(0, 10) : null;
        return {
            summary: `${dl} 정산현황 기록 없음${nearest ? ` — 가장 가까운 기록: ${dateLabelOf(nearest)}` : ''}`,
            lines: [
                `${date}에는 정산현황이 입력되어 있지 않습니다`,
                nearest ? `가장 가까운 기록: ${dateLabelOf(nearest)} (${nearest}) — 그 날짜로 다시 물어보시면 조회해드립니다` : '정산현황 기록이 아직 한 건도 없습니다',
                '입력은 마루에게: "오늘 정산현황 입력할게. 대성 283만..." 형식으로 지시 가능',
            ],
            report: { type: 'semi_status', date, date_label: dl, no_data: true, nearest,
                note: '해당 날짜 정산현황 기록 없음 — 정직 안내' },
        };
    }
    const row = cur.rows[0];
    const n = k => Number(row[k]) || 0;
    const settleTot = n('current_cash') + n('settlement_scheduled') + n('unsettled') + n('coupang_unpaid') + n('selfmall_unpaid');
    const adTot = n('ad_naver') + n('ad_gfa');
    const cardTot = n('card_fee') + n('corp_card');
    const itemsTot = n('daesong') + n('hyodong') + n('aewol') + n('delivery');
    const total = settleTot + adTot - cardTot - itemsTot;
    const prevQ = await pool.query(
        `SELECT * FROM settlement_status WHERE date < $1 ORDER BY date DESC LIMIT 1`, [date]);
    const prev = prevQ.rows[0] || null;
    const prevTotal = prev ? ssTotalRow(prev) : null;
    const diff = prevTotal !== null ? total - prevTotal : null;
    const prevLabel = prev ? dateLabelOf(prev.date) : null;
    const fields = Object.entries(SS_LABELS)
        .map(([f, label]) => ({ label, value: n(f) }))
        .filter(v => v.value !== 0);
    return {
        summary: `완료: ${dl} 정산현황 총 합계 ${fmt(total)}원${diff !== null ? ` (${prevLabel} 대비 ${diff >= 0 ? '+' : ''}${fmt(diff)}원)` : ''}`,
        lines: [
            `정산현황 ${fmt(settleTot)} + 광고 ${fmt(adTot)} − 카드 ${fmt(cardTot)} − 정산항목 ${fmt(itemsTot)} = ${fmt(total)}원`,
            diff !== null
                ? `직전 기록(${prevLabel}) 총 합계 ${fmt(prevTotal)}원 → ${diff >= 0 ? '+' : ''}${fmt(diff)}원`
                : '이전 기록이 없어 대비 계산 불가',
            '항목별 상세는 보고서에서 확인 (정산관리 화면과 동일 공식)',
        ],
        report: {
            type: 'semi_status', date, date_label: dl,
            totals: { settle: settleTot, ad: adTot, card: cardTot, items: itemsTot, total },
            fields,
            prev: prev ? { date: String(prev.date).slice(0, 10), label: prevLabel, total: prevTotal, diff } : null,
            memo: row.memo || '',
            note: '정산관리 정산현황과 동일 계산 공식 · 읽기 전용',
        },
    };
}

// ===== 3.5차: 조건 필터 (마루가 추출한 품목/기간 — AI 추가 호출 없음) =====

function monthEndStr(ym) {
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    return ym + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
}

// 기간 문자열 해석 → {from, to, label} / 해석 불가 시 null
function resolvePeriod(period) {
    const now = kstNow();
    const today = ymd(now);
    const ym = today.slice(0, 7);
    if (period === 'this_week') {
        const dow = (now.getUTCDay() + 6) % 7; // 월=0
        const monday = new Date(now);
        monday.setUTCDate(now.getUTCDate() - dow);
        return { from: ymd(monday), to: today, label: `이번 주(${ymd(monday)}~${today})` };
    }
    if (period === 'this_month') {
        return { from: ym + '-01', to: monthEndStr(ym), label: Number(ym.slice(5, 7)) + '월' };
    }
    const m = period.match(/^(\d{4})-(\d{1,2})$/);
    if (m) {
        const target = m[1] + '-' + String(Number(m[2])).padStart(2, '0');
        const label = (m[1] === ym.slice(0, 4) ? '' : m[1] + '년 ') + Number(m[2]) + '월';
        return { from: target + '-01', to: monthEndStr(target), label };
    }
    return null;
}

// 품목 키워드 매칭 — 정규화 부분일치 + 재배형 토큰 분해
// ("하우스귤" → [하우스, 귤] → '하우스감귤' 계열 전부 매칭, '하귤'은 하우스 없음 → 제외)
function matchesKeyword(itemName, keyword) {
    const norm = s => String(s).replace(/\s+/g, '').toLowerCase();
    const name = norm(itemName);
    let kw = norm(keyword);
    if (!kw) return true;
    if (name.includes(kw)) return true; // 1차: 그대로 부분 일치
    const tokens = [];
    for (const g of ['하우스', '노지', '비가림', '블러드']) { // 2차: 재배형 토큰 분해 (정산관리 특징 매칭과 동일 분류)
        if (kw.includes(g)) { tokens.push(g); kw = kw.split(g).join(''); }
    }
    if (kw) tokens.push(kw);
    return tokens.length > 0 && tokens.every(t => name.includes(t));
}

// 조건 필터 보고서 (품목 키워드 and/or 기간)
async function filteredReport({ pool, helpers, keyword, period }) {
    const parsed = resolvePeriod(period);
    const range = parsed || resolvePeriod('this_month'); // 기간 미지정/해석불가 → 이번 달
    const periodNote = (period && !parsed) ? ` · 기간 '${period}' 해석 불가 → 이번 달 기준` : '';
    const rows = await fetchSettlements(pool, helpers, range.from, range.to);

    // 품목 집계 (키워드 있으면 매칭 품목만, 없으면 전체)
    const byItem = {};
    let totalQty = 0, productTotal = 0;
    rows.forEach(r => r.items.forEach(it => {
        if (!it || !it.name) return;
        if (keyword && !matchesKeyword(it.name, keyword)) return;
        const qty = Number(it.qty) || 0;
        const amt = (Number(it.price) || 0) * qty;
        if (!byItem[it.name]) byItem[it.name] = { name: it.name, qty: 0, amount: 0 };
        byItem[it.name].qty += qty;
        byItem[it.name].amount += amt;
        totalQty += qty;
        productTotal += amt;
    }));
    const items = Object.values(byItem).sort((a, b) => b.amount - a.amount);

    // 키워드가 어떤 품목과도 매칭 안 됨 → 정직하게 표시 (등록 품목 목록 제시)
    if (keyword && items.length === 0) {
        const allNames = [...new Set(rows.flatMap(r => r.items.map(it => it && it.name).filter(Boolean)))].slice(0, 40);
        return {
            summary: `해당 품목을 찾을 수 없습니다: "${keyword}" (${range.label})`,
            lines: [
                `"${keyword}"와 매칭되는 품목이 ${range.label} 정산에 없습니다`,
                allNames.length
                    ? `해당 기간 등록 품목 ${allNames.length}종: ${allNames.slice(0, 4).join(', ')}${allNames.length > 4 ? ' 외' : ''}`
                    : '해당 기간에는 정산 데이터 자체가 없습니다',
                '품목명을 확인해서 다시 지시해주세요',
            ],
            report: {
                type: 'semi_settlement_filtered', title: `${keyword} · ${range.label}`,
                keyword, period: range, no_match: true, available_items: allNames,
                note: '요청 품목과 매칭되는 정산 품목 없음 — 등록 품목 목록 참고' + periodNote,
            },
        };
    }

    // 전체(키워드 없음) 기간 조회 → 택배비/이월 포함 총 결제금액 (정산관리 배지와 동일 공식)
    let cjFee = null, cjCarryover = null, paymentTotal = null;
    if (!keyword) {
        cjFee = cjBoxCount(rows) * CJ_BOX_FEE;
        cjCarryover = 0;
        const isFullMonth = range.from.endsWith('-01') && range.to === monthEndStr(range.from.slice(0, 7));
        if (isFullMonth) {
            const cj = await pool.query('SELECT amount FROM cj_carryover WHERE month = $1 LIMIT 1', [range.from.slice(0, 7)]);
            cjCarryover = Number(cj.rows[0]?.amount) || 0;
        }
        paymentTotal = productTotal + cjFee + cjCarryover;
    }

    const summary = keyword
        ? `완료: ${keyword} ${range.label}: ${totalQty.toLocaleString('ko-KR')}개 / ${fmt(productTotal)}원`
        : `완료: ${range.label} 총 ${fmt(paymentTotal)}원 (상품 ${fmt(productTotal)} + 택배 ${fmt(cjFee + cjCarryover)})`;

    return {
        summary,
        lines: [
            keyword
                ? `${keyword} ${range.label}(${range.from}~${range.to}) — 규격 ${items.length}종 · ${totalQty.toLocaleString('ko-KR')}개 · ${fmt(productTotal)}원`
                : `${range.label}(${range.from}~${range.to}) 상품 ${fmt(productTotal)}원 · 정산 ${rows.length}건`,
            items.length
                ? `최다: ${items[0].name} (${items[0].qty.toLocaleString('ko-KR')}개 / ${fmt(items[0].amount)}원)`
                : '집계된 품목이 없습니다',
            keyword
                ? '상품 기준 금액 (택배비 미포함) · 정산관리와 동일 단가 매칭'
                : `택배비 ${fmt(cjFee + cjCarryover)}원 포함 총 ${fmt(paymentTotal)}원`,
        ],
        report: {
            type: 'semi_settlement_filtered', title: `${keyword || '전체'} · ${range.label}`,
            keyword: keyword || null, period: range,
            items: items.slice(0, 60), total_qty: totalQty, product_total: productTotal,
            cj_fee: cjFee, cj_carryover: cjCarryover, payment_total: paymentTotal,
            note: (keyword
                ? '품목 부분 일치 매칭 · 상품 기준 금액 (택배비 미포함)'
                : `총 결제금액 = 상품 + 택배비(박스×${CJ_BOX_FEE.toLocaleString()}원)${cjCarryover ? ' + 이월' : ''}`)
                + ' · 정산관리와 동일 단가 계산 · 읽기 전용' + periodNote,
        },
    };
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

        // ===== 특정 일자 정산현황 조회 (8차) =====
        const targetDate = String(params.target_date || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
            return statusReport({ pool, date: targetDate });
        }

        // ===== 조건 필터 모드 — 마루가 추출한 품목/기간 조건 (없으면 기존 전체 보고서) =====
        const kw = String(params.item_keyword || '').trim();
        const periodRaw = String(params.period || '').trim();
        if (kw || periodRaw) {
            return filteredReport({ pool, helpers, keyword: kw, period: periodRaw });
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
