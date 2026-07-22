// AGENT OFFICE 실행 스크립트 — 세미 (재무팀 · 회계조회)
// 2차: 실제 정산 DB 연결. AI 호출 없음(토큰 0원) — 순수 SQL + 코드 집계.
// 단가는 정산관리 화면과 동일한 3단계 매칭(정확명 → product_mappings → 특징 매칭)으로
// 표시 시점 재계산 (읽기 전용 — settlements/pricing에 어떤 쓰기도 하지 않음).
// 지시 #44: 보고 문구 톤 가이드 = docs/agents/세미_특성.md (숫자 먼저·수식어 없음·기준 명시).
// 세미는 0원 순수 코드 요원 — 특성 파일은 톤 참조용일 뿐 로직 무변경. 검산은 한수(agents/한수.js) 게이트가 수행.
// 총 결제금액 = 상품 정산 합계 + CJ택배비(박스수×3,100) + CJ 이월금액 — 정산관리 월 배지와 동일 계산.

const CJ_PARTNERS = ['대성(시온)', '효돈농협', '기타거래처'];
const CJ_BOX_FEE = 3100; // 정산관리 화면과 동일 단가
const ExcelJS = require('exceljs'); // 4단계: 보고서 xlsx 생성 (순수 코드 — AI 호출 없음)

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
    return Object.values(g).map(p => {
        const c = capList(Object.values(p.byItem).sort((a, b) => b.amount - a.amount));
        return { partner: p.partner, count: p.count, total: p.total, items: c.list, items_omitted: c.omitted };
    }).sort((a, b) => b.total - a.total);
}

// CJ택배비: 대성/효돈/기타 정산의 박스수(qty 합계) × 3,100원 (정산관리와 동일 계산)
function cjBoxCount(rows) {
    return rows.reduce((s, r) => CJ_PARTNERS.includes(r.partner)
        ? s + r.items.reduce((q, it) => q + (Number(it.qty) || 0), 0) : s, 0);
}

// ===== 지시 #5-9: 보고서 목록 통일 상한 — 초과분은 '외 N종 생략' 명시 (정직 원칙) =====
const REPORT_ITEM_CAP = 60;
function capList(arr, cap = REPORT_ITEM_CAP) {
    return { list: arr.slice(0, cap), omitted: Math.max(0, arr.length - cap) };
}
const omitNote = omitted => (omitted > 0 ? ` · 외 ${omitted}종 생략(상한 ${REPORT_ITEM_CAP})` : '');

// ===== 4.5단계: 품목 계열 키 (규격 표기 제거 — 기존 토큰 매칭으로 구성원 검증) =====
function seriesKeyOf(name) {
    let s = String(name).replace(/\([^)]*\)/g, ' ');
    s = s.replace(/\d+(\.\d+)?\s*(kg|g|과|입|미|번)/gi, ' ');
    s = s.replace(/가정용|선물용|로얄|프리미엄|특품|못난이|중대과|대과|중과|소과|혼합|세트|박스|실속|한판|~|-|\/|\d+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

// ===== 4단계: 정산 보고서 xlsx — 시트1 요약("상품+택배=총결제" 병기), 시트2 상세(일자·품목별) =====
// 숫자는 화면 보고서와 동일 계산 경로를 그대로 사용 (1원 오차 없음 원칙)
async function buildSettlementXlsx({ label, from, to, rows, productTotal, cjFee, cjCarryover, paymentTotal, keyword }) {
    const wb = new ExcelJS.Workbook();
    const money = n => Math.round(n || 0);
    const s1 = wb.addWorksheet('요약');
    s1.columns = [{ width: 26 }, { width: 20 }];
    s1.addRow(['조회 기간', `${from} ~ ${to} (${label})`]);
    if (keyword) s1.addRow(['품목 필터', keyword]);
    s1.addRow(['상품 매출', money(productTotal)]);
    if (paymentTotal != null) {
        s1.addRow(['택배비 (박스×3,100)', money(cjFee || 0)]);
        if (cjCarryover) s1.addRow(['택배 이월금액', money(cjCarryover)]);
        s1.addRow(['총 결제금액 (상품+택배=총결제)', money(paymentTotal)]);
    } else {
        s1.addRow(['참고', '품목 필터 조회는 상품 기준 금액 (택배비 미포함)']);
    }
    s1.addRow([]);
    s1.addRow(['거래처별 합계 (상품 기준)', '']);
    const byPartner = {};
    rows.forEach(r => { byPartner[r.partner] = (byPartner[r.partner] || 0) + r.amount; });
    Object.entries(byPartner).sort((a, b) => b[1] - a[1]).forEach(([p, amt]) => s1.addRow([p, money(amt)]));
    s1.addRow(['정산 건수', rows.length]);
    s1.getColumn(1).font = { bold: false };
    s1.getColumn(2).numFmt = '#,##0';
    s1.getRow(1).font = { bold: true };

    const s2 = wb.addWorksheet('상세');
    s2.columns = [
        { header: '일자', key: 'd', width: 12 }, { header: '거래처', key: 'p', width: 14 },
        { header: '품목', key: 'n', width: 34 }, { header: '수량', key: 'q', width: 8 },
        { header: '단가', key: 'u', width: 10 }, { header: '소계', key: 's', width: 12 },
    ];
    rows.forEach(r => (r.items || []).forEach(it => {
        if (!it || !it.name) return;
        if (keyword && !matchesKeyword(it.name, keyword)) return;
        s2.addRow({
            d: String(r.date).slice(0, 10), p: r.partner, n: it.name,
            q: Number(it.qty) || 0, u: Number(it.price) || 0,
            s: (Number(it.price) || 0) * (Number(it.qty) || 0),
        });
    }));
    s2.getRow(1).font = { bold: true };
    s2.getColumn('u').numFmt = '#,##0';
    s2.getColumn('s').numFmt = '#,##0';
    return Buffer.from(await wb.xlsx.writeBuffer());
}
// 파일 요청 시 xlsx 생성·보관 후 report에 file_id 부착 — 실패는 정직하게 file_error로 표시
async function attachXlsx(helpers, wantFile, args, report) {
    if (!wantFile || typeof helpers.saveReportFile !== 'function') return null;
    try {
        const ymd = ymd2(kstNow());
        const fname = `정산보고_${args.from}~${args.to}_${ymd}.xlsx`;
        const buf = await buildSettlementXlsx(args);
        report.file_id = await helpers.saveReportFile(fname, buf);
        report.file_name = fname;
        return fname;
    } catch (e) {
        report.file_error = '파일 생성 실패: ' + e.message;
        return null;
    }
}
function ymd2(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }

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

// ===== 8차 보강: 특정 일자 통합 보고 — 일별 정산(정산관리 캘린더와 동일 기준) + 정산현황 기록 =====
async function dayReport({ pool, helpers, date }) {
    const dl = dateLabelOf(date);
    // ① 일별 정산 (settlements — 캘린더 셀과 동일: 거래처별 재계산 금액 + 박스×3,100원)
    const rows = await fetchSettlements(pool, helpers, date, date);
    const byPartner = {};
    rows.forEach(r => { byPartner[r.partner] = (byPartner[r.partner] || 0) + r.amount; });
    const partners = Object.entries(byPartner)
        .sort((a, b) => b[1] - a[1])
        .map(([partner, amount]) => ({ partner, amount }));
    const boxes = cjBoxCount(rows);
    const cjFee = boxes * CJ_BOX_FEE;
    const productTotal = rows.reduce((s, r) => s + r.amount, 0);
    const dayTotal = productTotal + cjFee;
    const hasSett = rows.length > 0;

    // ② 정산현황 기록 (재무현황 탭: 현금·광고·카드·정산항목)
    const statusRes = await statusReport({ pool, date });
    const st = statusRes.report;

    // 둘 다 없으면 가장 가까운 정산 날짜도 안내 (정직)
    let nearestSett = null;
    if (!hasSett) {
        const near = await pool.query(
            `SELECT date FROM settlements ORDER BY GREATEST(date - $1::date, $1::date - date) ASC LIMIT 1`, [date]);
        nearestSett = near.rows[0] ? String(near.rows[0].date).slice(0, 10) : null;
    }

    const settLine = hasSett
        ? `일별 정산 ${fmt(dayTotal)}원 (${partners.map(p => `${p.partner} ${fmt(p.amount)}`).join(' + ')}${cjFee ? ` + 택배 ${fmt(cjFee)}` : ''})`
        : `해당 날짜 일별 정산 기록 없음${nearestSett ? ` — 가장 가까운 정산: ${dateLabelOf(nearestSett)}` : ''}`;
    const statusLine = st.no_data
        ? `정산현황(현금·광고·카드) 기록 없음${st.nearest ? ` — 가장 가까운 기록: ${dateLabelOf(st.nearest)}` : ''}`
        : `정산현황 총 합계 ${fmt(st.totals.total)}원${st.prev ? ` (${st.prev.label} 대비 ${st.prev.diff >= 0 ? '+' : ''}${fmt(st.prev.diff)}원)` : ''}`;

    const summary = hasSett
        ? `완료: ${dl} 정산 ${fmt(dayTotal)}원 (${partners.map(p => `${p.partner} ${fmt(p.amount)}`).join(' + ')}${cjFee ? ` + 택배 ${fmt(cjFee)}` : ''})`
        : (st.no_data
            ? `${dl} 정산·정산현황 기록 없음${nearestSett ? ` — 가장 가까운 정산: ${dateLabelOf(nearestSett)}` : ''}`
            : `완료: ${dl} 일별 정산 없음 · 정산현황 총 합계 ${fmt(st.totals.total)}원`);

    return {
        summary,
        lines: [settLine, statusLine, '보고서에서 거래처별 정산 + 정산현황 상세 확인 (정산관리 화면과 동일 기준)'],
        report: {
            type: 'semi_day', date, date_label: dl,
            settlements: { has: hasSett, partners, box_count: boxes, cj_fee: cjFee, product_total: productTotal, total: dayTotal, count: rows.length, nearest: nearestSett },
            status: st,
            note: '일별 정산 = 정산관리 캘린더 셀과 동일 기준 (거래처 재계산 금액 + 박스×3,100원) · 정산현황 = 재무현황 입력 탭 기준 · 읽기 전용',
        },
    };
}

// ===== 4.5단계 ⑤: 기간 비교 보고서 (순수 코드 0원) — a=첫 언급, b=둘째 언급, 증감 = a 대비 b =====
async function loadMonthAgg(pool, helpers, ymStr) {
    const from = ymStr + '-01', to = monthEndStr(ymStr);
    const rows = await fetchSettlements(pool, helpers, from, to);
    const agg = aggregate(rows);
    const boxes = cjBoxCount(rows);
    const cjFee = boxes * CJ_BOX_FEE;
    const cj = await pool.query('SELECT amount FROM cj_carryover WHERE month = $1 LIMIT 1', [ymStr]);
    const carry = Number(cj.rows[0]?.amount) || 0;
    const label = ymStr.slice(0, 4) + '년 ' + Number(ymStr.slice(5, 7)) + '월';
    return { ym: ymStr, label, from, to, rows, agg, boxes, cjFee, carry, payment: agg.total + cjFee + carry };
}
const pctOf = (base, diff) => (base > 0 ? Math.round(diff / base * 1000) / 10 : null);

async function compareReport({ pool, helpers, a, b, wantFile }) {
    const A = await loadMonthAgg(pool, helpers, a);
    const B = await loadMonthAgg(pool, helpers, b);
    // 0건 가드: 양쪽 모두 없으면 정직 안내 (기존 0건 가드와 동일 형식)
    if (A.rows.length === 0 && B.rows.length === 0) {
        return {
            summary: `『${A.label} vs ${B.label}』 비교 결과 양쪽 모두 0건입니다 — 조회 기간이 맞나요?`,
            lines: [`${A.label}·${B.label} 모두 정산 데이터가 없습니다`, '정직 원칙: 다른 기간 데이터로 대체하지 않습니다'],
            report: { type: 'semi_compare', a: { label: A.label }, b: { label: B.label }, zero_result: true, note: '비교 대상 양쪽 0건' },
        };
    }
    // 품목 비교: 합집합 → 양쪽 최대 금액 기준 TOP 10 (+[신규]/[종료] — a에 없으면 신규, b에 없으면 종료)
    const mapA = {}, mapB = {};
    A.agg.items.forEach(i => { mapA[i.name] = i; });
    B.agg.items.forEach(i => { mapB[i.name] = i; });
    const names = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])];
    const itemsAll = names.map(n => {
        const ia = mapA[n] || { qty: 0, amount: 0 };
        const ib = mapB[n] || { qty: 0, amount: 0 };
        return {
            name: n, a_qty: ia.qty, a_amount: ia.amount, b_qty: ib.qty, b_amount: ib.amount,
            diff: ib.amount - ia.amount, pct: pctOf(ia.amount, ib.amount - ia.amount),
            tag: !mapA[n] ? '신규' : (!mapB[n] ? '종료' : ''),
        };
    }).sort((x, y) => Math.max(y.a_amount, y.b_amount) - Math.max(x.a_amount, x.b_amount));
    const itemsTop = itemsAll.slice(0, 10);
    // 거래처 비교
    const pA = {}, pB = {};
    A.rows.forEach(r => { pA[r.partner] = (pA[r.partner] || 0) + r.amount; });
    B.rows.forEach(r => { pB[r.partner] = (pB[r.partner] || 0) + r.amount; });
    const partners = [...new Set([...Object.keys(pA), ...Object.keys(pB)])].map(p => ({
        partner: p, a: pA[p] || 0, b: pB[p] || 0,
        diff: (pB[p] || 0) - (pA[p] || 0), pct: pctOf(pA[p] || 0, (pB[p] || 0) - (pA[p] || 0)),
    })).sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));

    const totalDiff = B.payment - A.payment;
    const totalPct = pctOf(A.payment, totalDiff);
    const sideLine = S => S.rows.length
        ? `${S.label} 총 ${fmt(S.payment)}원 (상품 ${fmt(S.agg.total)} + 택배 ${fmt(S.cjFee + S.carry)}) · ${S.agg.count}건`
        : `${S.label} 데이터 없음`;

    const report = {
        type: 'semi_compare',
        a: { ym: A.ym, label: A.label, from: A.from, to: A.to, product_total: A.agg.total, cj_fee: A.cjFee, cj_carryover: A.carry, payment_total: A.payment, count: A.agg.count, box_count: A.boxes, no_data: A.rows.length === 0 },
        b: { ym: B.ym, label: B.label, from: B.from, to: B.to, product_total: B.agg.total, cj_fee: B.cjFee, cj_carryover: B.carry, payment_total: B.payment, count: B.agg.count, box_count: B.boxes, no_data: B.rows.length === 0 },
        diff: { payment: totalDiff, payment_pct: totalPct, product: B.agg.total - A.agg.total, product_pct: pctOf(A.agg.total, B.agg.total - A.agg.total), count: B.agg.count - A.agg.count, boxes: B.boxes - A.boxes },
        partners, items: itemsTop, items_total: itemsAll.length,
        note: `증감 = ${A.label} 대비 ${B.label} · 한쪽 데이터 없으면 %없이 '데이터 없음' 표시 · 정산관리와 동일 단가 계산 · 읽기 전용`,
    };
    // 비교 xlsx (want_file)
    let fname = null;
    if (wantFile && typeof helpers.saveReportFile === 'function') {
        try {
            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet('비교');
            ws.columns = [
                { header: '구분', key: 'k', width: 30 }, { header: A.label, key: 'a', width: 16 },
                { header: B.label, key: 'b', width: 16 }, { header: '증감', key: 'd', width: 14 }, { header: '증감률(%)', key: 'p', width: 10 },
            ];
            const row = (k, av, bv, d, p) => ws.addRow({ k, a: av, b: bv, d, p: p === null ? '데이터 없음' : p });
            row('상품 매출', A.agg.total, B.agg.total, B.agg.total - A.agg.total, pctOf(A.agg.total, B.agg.total - A.agg.total));
            row('택배비(+이월)', A.cjFee + A.carry, B.cjFee + B.carry, (B.cjFee + B.carry) - (A.cjFee + A.carry), pctOf(A.cjFee + A.carry, (B.cjFee + B.carry) - (A.cjFee + A.carry)));
            row('총 결제금액 (상품+택배=총결제)', A.payment, B.payment, totalDiff, totalPct);
            row('정산 건수', A.agg.count, B.agg.count, B.agg.count - A.agg.count, null);
            row('택배 박스', A.boxes, B.boxes, B.boxes - A.boxes, null);
            ws.addRow({});
            ws.addRow({ k: '── 거래처별 (상품 기준) ──' });
            partners.forEach(p => row(p.partner, p.a, p.b, p.diff, p.pct));
            ws.addRow({});
            ws.addRow({ k: '── 품목 TOP ' + itemsTop.length + ' ──' });
            itemsTop.forEach(i => row(i.name + (i.tag ? ` [${i.tag}]` : ''), i.a_amount, i.b_amount, i.diff, i.pct));
            ws.getRow(1).font = { bold: true };
            ['a', 'b', 'd'].forEach(k => ws.getColumn(k).numFmt = '#,##0');
            const buf = Buffer.from(await wb.xlsx.writeBuffer());
            fname = `정산비교_${A.ym}vs${B.ym}_${ymd2(kstNow())}.xlsx`;
            report.file_id = await helpers.saveReportFile(fname, buf);
            report.file_name = fname;
        } catch (e) { report.file_error = '파일 생성 실패: ' + e.message; }
    }
    return {
        summary: `완료: ${A.label} vs ${B.label} — 총결제 ${fmt(A.payment)} → ${fmt(B.payment)}원 (${totalPct === null ? '데이터 없음' : (totalDiff >= 0 ? '+' : '') + fmt(totalDiff) + '원 / ' + (totalDiff >= 0 ? '+' : '') + totalPct + '%'})` + (fname ? ` · 📎 ${fname}` : ''),
        lines: [sideLine(A), sideLine(B), fname ? `📎 ${fname} — 보고서함에서 다운로드` : `품목 합집합 ${itemsAll.length}종 중 TOP ${itemsTop.length} 비교 (보고서에서 확인)`],
        report,
    };
}

// ===== 4.5단계 ⑥: 품목 매출 기여 순위 (순수 코드 0원) — 규격별 개별 + 계열 합계 별도 줄 =====
async function rankReport({ pool, helpers, period, topN, showAll, partner, wantFile }) {
    const range = resolvePeriod(period || '') || resolvePeriod('this_month');
    const allRows = await fetchSettlements(pool, helpers, range.from, range.to);
    const rows = partner ? allRows.filter(r => r.partner === partner) : allRows; // 대표 7/22: 거래처별 순위
    const scopeLabel = partner ? `${partner} · ${range.label}` : range.label;
    if (rows.length === 0 && partner && allRows.length > 0) {
        const partners = [...new Set(allRows.map(r => r.partner))];
        return {
            summary: `${range.label}에 '${partner}' 정산이 없습니다`,
            lines: [`${range.label}(${range.from}~${range.to})에 거래처 '${partner}' 정산 데이터가 없습니다`, `이 기간 정산이 있는 거래처: ${partners.join(', ')}`, '거래처명을 확인해 다시 지시해주세요'],
            report: { type: 'semi_rank', period: range, partner, no_match: true, note: `거래처 '${partner}' 필터 결과 0건 (기간엔 다른 거래처 있음)` },
        };
    }
    if (rows.length === 0) {
        const near = await pool.query(
            `SELECT to_char(date, 'YYYY-MM') AS ym FROM settlements
             ORDER BY GREATEST(date - $1::date, $1::date - date) ASC LIMIT 1`, [range.from]);
        const nearYm = near.rows[0]?.ym || null;
        return {
            summary: `『${range.label}』 조회 결과 0건입니다 — 조회 기간이 맞나요?${nearYm ? ` (데이터가 있는 가장 가까운 달: ${nearYm})` : ''}`,
            lines: [`${range.label}(${range.from}~${range.to}) 정산 데이터가 없습니다`, '정직 원칙: 다른 기간 데이터로 대체하지 않습니다'],
            report: { type: 'semi_rank', period: range, zero_result: true, nearest_month: nearYm, note: '조회 결과 0건 — 기간 확인 요청' },
        };
    }
    const agg = aggregate(rows);
    const total = agg.total;
    const ranked = agg.items.map((i, idx) => ({
        rank: idx + 1, name: i.name, qty: i.qty, amount: i.amount,
        share: total > 0 ? Math.round(i.amount / total * 1000) / 10 : 0,
    }));
    const shown = showAll ? ranked : ranked.slice(0, topN || 10);
    // 계열 합계 (규격 2종 이상 + 토큰 매칭 검증 — '하귤' 제외 규칙 포함)
    const groups = {};
    ranked.forEach(i => {
        const key = seriesKeyOf(i.name);
        if (!key) return;
        (groups[key] = groups[key] || []).push(i);
    });
    const series = Object.entries(groups)
        .filter(([key, members]) => members.length >= 2 && members.every(m => matchesKeyword(m.name, key)))
        .map(([key, members]) => ({
            name: key + ' 계열 합계', members: members.length,
            qty: members.reduce((s, m) => s + m.qty, 0),
            amount: members.reduce((s, m) => s + m.amount, 0),
            share: total > 0 ? Math.round(members.reduce((s, m) => s + m.amount, 0) / total * 1000) / 10 : 0,
        }))
        .sort((x, y) => y.amount - x.amount);

    const report = {
        type: 'semi_rank', period: range, partner: partner || null, product_total: total,
        rows: shown, rows_total: ranked.length, shown_all: !!showAll, top_n: showAll ? ranked.length : (topN || 10),
        series,
        note: `상품 기준 금액·정산관리와 동일 단가 계산 · 비중 = 품목 금액 / 기간 상품 총액 · 계열 합계는 규격 2종 이상 + 토큰 매칭 검증(하귤 제외 규칙 포함)${showAll ? '' : ` · 전체 ${ranked.length}종 중 TOP ${shown.length} 표시 ("전부"라고 지시하면 전 품목)`} · 읽기 전용`,
    };
    let fname = null;
    if (wantFile && typeof helpers.saveReportFile === 'function') {
        try {
            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet('품목 순위');
            ws.columns = [
                { header: '순위', key: 'r', width: 6 }, { header: '품목', key: 'n', width: 34 },
                { header: '수량', key: 'q', width: 10 }, { header: '매출액', key: 'a', width: 14 }, { header: '비중(%)', key: 's', width: 8 },
            ];
            ws.addRow({ r: '', n: `기간: ${range.from} ~ ${range.to} (${range.label}) · 상품 총액 ${Math.round(total)}` });
            ranked.forEach(i => ws.addRow({ r: i.rank, n: i.name, q: i.qty, a: i.amount, s: i.share }));
            if (series.length) {
                ws.addRow({});
                ws.addRow({ n: '── 계열 합계 ──' });
                series.forEach(s => ws.addRow({ n: s.name + ` (${s.members}종)`, q: s.qty, a: s.amount, s: s.share }));
            }
            ws.getRow(1).font = { bold: true };
            ws.getColumn('a').numFmt = '#,##0';
            const buf = Buffer.from(await wb.xlsx.writeBuffer());
            fname = `품목순위_${range.from}~${range.to}_${ymd2(kstNow())}.xlsx`;
            report.file_id = await helpers.saveReportFile(fname, buf);
            report.file_name = fname;
        } catch (e) { report.file_error = '파일 생성 실패: ' + e.message; }
    }
    const top1 = ranked[0];
    return {
        summary: `완료: ${scopeLabel} 품목 기여 순위 — 1위 ${top1.name} ${top1.qty.toLocaleString('ko-KR')}개 / ${fmt(top1.amount)}원 (${top1.share}%)` + (fname ? ` · 📎 ${fname}` : ''),
        lines: [
            `${scopeLabel}(${range.from}~${range.to}) 상품 총액 ${fmt(total)}원 · 품목 ${ranked.length}종 중 ${shown.length}종 표시`,
            `TOP3: ${ranked.slice(0, 3).map(i => `${i.rank}위 ${i.name}(${i.share}%)`).join(' / ')}`,
            fname ? `📎 ${fname} — 보고서함에서 다운로드` : (series.length ? `계열 합계 ${series.length}건 별도 표시 (보고서에서 확인)` : '계열 합계 대상 없음 (규격 2종 이상 품목 없음)'),
        ],
        report,
    };
}

// ===== 대표 7/22: 품목별 결제가(단가) 이력 조회 =====
// "그때 결제가가 얼마였는지" — 매출(settlements)이 아니라 pricing(품목별 금액) 테이블의 주간 단가 이력.
// 결제가는 주마다 변동되므로, 거래처별·주(날짜범위)별로 각 품목의 결제가를 그리드로 보여준다.
// pricing 행 자체가 '주(날짜범위)' 단위라 별도 주차 계산 불필요 (품목별 금액 화면과 완전 동일 데이터).
async function priceHistoryReport({ pool, period, partner, keyword }) {
    const range = resolvePeriod(period || '') || resolvePeriod('this_month');
    const short = d => String(d).slice(5, 10); // MM-DD
    const params = [range.from, range.to];
    let where = 'start_date <= $2::date AND end_date >= $1::date';
    if (partner) { params.push(partner); where += ` AND partner = $${params.length}`; }
    const pr = await pool.query(
        `SELECT partner, start_date, end_date, items FROM pricing
         WHERE ${where} ORDER BY partner, start_date`, params);
    if (pr.rows.length === 0) {
        // 정직 원칙: 다른 기간으로 대체하지 않고, 가장 가까운 단가 등록 달만 안내
        const near = await pool.query(
            `SELECT to_char(start_date, 'YYYY-MM') AS ym FROM pricing
             ORDER BY GREATEST(start_date - $1::date, $1::date - start_date) ASC LIMIT 1`, [range.from]);
        const nearYm = near.rows[0]?.ym || null;
        return {
            summary: `『${range.label}${partner ? ' ' + partner : ''}』 품목별 결제가(단가) 이력이 없습니다${nearYm ? ` (단가가 등록된 가장 가까운 달: ${nearYm})` : ''}`,
            lines: [
                `${range.label}(${range.from}~${range.to})에 저장된 품목별 금액(단가표)이 없습니다`,
                '품목별 금액 메뉴에 해당 기간 단가가 등록돼 있어야 조회됩니다',
            ],
            report: { type: 'semi_price_history', period: range, partner: partner || null, zero_result: true, nearest_month: nearYm },
        };
    }
    const kwNorm = keyword ? String(keyword).replace(/\s+/g, '').toLowerCase() : '';
    const matchKw = nm => !kwNorm || String(nm).replace(/\s+/g, '').toLowerCase().includes(kwNorm);
    const partners = {};
    pr.rows.forEach(row => {
        const p = partners[row.partner] || (partners[row.partner] = { partner: row.partner, weeks: [], byItem: {} });
        const wkKey = `${String(row.start_date).slice(0, 10)}~${String(row.end_date).slice(0, 10)}`;
        if (!p.weeks.find(w => w.key === wkKey)) {
            p.weeks.push({ key: wkKey, label: `${short(row.start_date)}~${short(row.end_date)}`, from: String(row.start_date).slice(0, 10), to: String(row.end_date).slice(0, 10) });
        }
        safeItems(row.items).forEach(it => {
            if (!it || !it.name || !matchKw(it.name)) return;
            if (!p.byItem[it.name]) p.byItem[it.name] = { name: it.name, prices: {} };
            p.byItem[it.name].prices[wkKey] = Number(it.price) || 0;
        });
    });
    const partnerSections = Object.values(partners).map(p => {
        p.weeks.sort((a, b) => (a.from < b.from ? -1 : 1));
        const items = Object.values(p.byItem).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        const capped = capList(items);
        return {
            partner: p.partner,
            weeks: p.weeks,
            items: capped.list.map(it => ({
                name: it.name,
                prices: p.weeks.map(w => (it.prices[w.key] !== undefined ? it.prices[w.key] : null)),
            })),
            items_omitted: capped.omitted,
        };
    }).sort((a, b) => a.partner.localeCompare(b.partner, 'ko'));
    const maxWeeks = Math.max(...partnerSections.map(s => s.weeks.length));
    return {
        summary: `완료: ${range.label} 품목별 결제가(단가) 이력 — 거래처 ${partnerSections.length}곳 · 주 최대 ${maxWeeks}개 (결제가는 주마다 변동)`,
        lines: [
            `${range.label}(${range.from}~${range.to}) 품목별 금액(단가표) 기준 · 결제가(단가) 조회 · 매출액 아님 · 읽기 전용`,
            `거래처: ${partnerSections.map(s => `${s.partner}(${s.weeks.length}주)`).join(' / ')}`,
            '셀이 비면 그 주에 해당 품목 단가가 등록되지 않은 것 — 내년 동기 비교용',
        ],
        report: {
            type: 'semi_price_history', period: range, partner: partner || null, keyword: keyword || null,
            partners: partnerSections,
            note: '품목별 금액(pricing) 주간 단가 이력 · 결제가(단가)이며 매출액이 아님 · 주마다 변동 · 읽기 전용',
        },
    };
}

// ===== 3.5차: 조건 필터 (마루가 추출한 품목/기간 — AI 추가 호출 없음) =====

// ===== 지시 #15: 주차×거래처 정산 — 금액 즉답 + 화면 동일 양식 엑셀 =====
// 파일 양식 = 주간 정산 현황 화면의 거래처 셀 다운로드(downloadPartnerWeeklySettlement)와 동일 재현:
// 옵션명|단가|요일7(월~일)|총수량|금액|차감수량|차감금액|총입금금액 + 수식(차감금액=단가×차감수량,
// 총입금=금액-차감금액, 합계 SUM). 동일 데이터 경로(fetchSettlements 재계산)라 숫자도 화면과 동일
async function buildPartnerWeekXlsx({ partner, from, to, target }) {
    const days = [];
    for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
    }
    const DOW = ['일', '월', '화', '수', '목', '금', '토'];
    const byItem = {};
    target.forEach(s => {
        const ds = String(s.date).slice(0, 10);
        (s.items || []).forEach(it => {
            const name = (it && it.name) || '(미입력)';
            if (!byItem[name]) byItem[name] = { price: 0, qtyByDate: {}, totalQty: 0 };
            byItem[name].qtyByDate[ds] = (byItem[name].qtyByDate[ds] || 0) + (Number(it.qty) || 0);
            byItem[name].totalQty += (Number(it.qty) || 0);
            if (Number(it.price) > 0) byItem[name].price = Number(it.price);
        });
    });
    const names = Object.keys(byItem).sort((a, b) => a.localeCompare(b, 'ko'));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(partner.substring(0, 30));
    const COLS = 2 + days.length + 5; // 옵션명+단가+요일7+총수량+금액+차감수량+차감금액+총입금 = 14열
    ws.columns = [{ width: 32 }, { width: 11 }, ...days.map(() => ({ width: 9 })), { width: 10 }, { width: 13 }, { width: 11 }, { width: 13 }, { width: 14 }];
    ws.addRow([`${partner} — 결제금액 (${from} ~ ${to})`]);
    ws.mergeCells(1, 1, 1, COLS);
    ws.addRow([]);
    ws.addRow(['옵션명', '단가',
        ...days.map(d => `${DOW[new Date(d + 'T00:00:00Z').getUTCDay()]}\n${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`),
        '총수량', '금액', '차감수량', '차감금액', '총 입금금액']);
    const col = i => String.fromCharCode(64 + i); // 1→A (열 14개라 Z 이내)
    const PRICE = 2, QTY_TOTAL = 2 + days.length + 1, AMOUNT = QTY_TOTAL + 1, DQTY = AMOUNT + 1, DAMT = DQTY + 1, FINAL = DAMT + 1;
    const dayTotals = days.map(() => 0);
    let grandQty = 0, grandAmount = 0;
    names.forEach(name => {
        const info = byItem[name];
        const qtys = days.map(d => info.qtyByDate[d] || 0);
        qtys.forEach((q, i) => { dayTotals[i] += q; });
        const amt = info.price * info.totalQty;
        grandQty += info.totalQty;
        grandAmount += amt;
        const row = ws.addRow([name, info.price, ...qtys, info.totalQty, amt, 0, 0, amt]);
        const r = row.number;
        row.getCell(DAMT).value = { formula: `${col(PRICE)}${r}*${col(DQTY)}${r}`, result: 0 };
        row.getCell(FINAL).value = { formula: `${col(AMOUNT)}${r}-${col(DAMT)}${r}`, result: amt };
    });
    const dataStart = 4, dataEnd = 3 + names.length;
    const sumRow = ws.addRow(['합계', '', ...dayTotals, grandQty, grandAmount, 0, 0, grandAmount]);
    const sr = sumRow.number;
    [DQTY, DAMT, FINAL].forEach((c, i) => {
        sumRow.getCell(c).value = { formula: `SUM(${col(c)}${dataStart}:${col(c)}${dataEnd})`, result: i === 2 ? grandAmount : 0 };
    });

    // 스타일 (화면 다운로드와 동일 톤: 제목 FFE0B2 / 헤더 E6F0FA / 합계 FFF8E1, 전체 얇은 테두리)
    const border = { top: { style: 'thin', color: { argb: 'FF999999' } }, bottom: { style: 'thin', color: { argb: 'FF999999' } }, left: { style: 'thin', color: { argb: 'FF999999' } }, right: { style: 'thin', color: { argb: 'FF999999' } } };
    const moneyCols = [PRICE, AMOUNT, DAMT, FINAL];
    for (let r = 1; r <= sr; r++) {
        for (let c = 1; c <= COLS; c++) {
            const cell = ws.getRow(r).getCell(c);
            cell.border = border;
            cell.alignment = { vertical: 'middle', wrapText: true };
            if (r === 1) {
                cell.font = { bold: true, size: 14 };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } };
            } else if (r === 3) {
                cell.font = { bold: true, size: 11 };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F0FA' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            } else if (r >= dataStart && r <= sr) {
                if (r === sr) {
                    cell.font = { bold: true };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
                }
                if (moneyCols.includes(c)) {
                    cell.numFmt = '#,##0';
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                } else if (c > 2 || c === 1) {
                    if (c !== 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
                }
            }
        }
    }
    ws.getRow(1).height = 28;
    ws.getRow(3).height = 32;
    return Buffer.from(await wb.xlsx.writeBuffer());
}

async function partnerWeekReport({ pool, helpers, partner, from, to, label, wantFile }) {
    const rows = await fetchSettlements(pool, helpers, from, to);
    // CJ대한통운: 파일 없음 — 금액만 (화면 주간표와 동일: 3거래처 박스수 × 3,100원)
    if (partner === 'CJ대한통운') {
        const boxes = cjBoxCount(rows);
        const fee = boxes * 3100;
        if (!boxes) {
            return {
                summary: `『${label} CJ대한통운』 해당 주차 박스 출고 기록이 없습니다`,
                lines: [`${from} ~ ${to} 기간의 거래처 정산(박스) 기록 0건 — 택배비 계산 대상 없음`],
                report: { type: 'semi_partner_week', partner, from, to, label, cj: true, zero_result: true },
            };
        }
        const lines = [`박스 ${fmt(boxes)}개 × 3,100원 = ${fmt(fee)}원 (대성·효돈·기타 합산 — 주간 정산 현황과 동일 계산)`];
        if (wantFile) lines.push('CJ대한통운은 거래처 정산 파일이 없어 금액만 안내드립니다');
        return {
            summary: `『${label} CJ대한통운』 택배비 ${fmt(fee)}원`,
            lines,
            report: { type: 'semi_partner_week', partner, from, to, label, cj: true, boxes, total: fee,
                ...(wantFile ? { no_file: 'CJ대한통운은 정산 파일이 없습니다 — 금액만 안내' } : {}) },
        };
    }
    const target = rows.filter(r => r.partner === partner);
    if (!target.length) {
        // 0건 가드 — 대체 조회 금지, 데이터가 있는 가장 가까운 날짜 힌트만
        const near = await pool.query(
            `SELECT date FROM settlements WHERE partner = $1 ORDER BY ABS(date - $2::date) LIMIT 1`, [partner, from]);
        const hint = near.rows.length ? `가장 가까운 기록: ${String(near.rows[0].date).slice(0, 10)}` : '해당 거래처의 정산 기록이 없습니다';
        return {
            summary: `『${label} ${partner}』 정산 기록이 없습니다`,
            lines: [`${from} ~ ${to} 기간 ${partner} 정산 0건`, hint],
            report: { type: 'semi_partner_week', partner, from, to, label, zero_result: true, hint },
        };
    }
    const total = target.reduce((s, r) => s + r.amount, 0);
    const report = { type: 'semi_partner_week', partner, from, to, label, total, count: target.length };
    const lines = [`정산 ${target.length}건 · 합계 ${fmt(total)}원 (주간 정산 현황 화면과 동일 계산)`];
    if (wantFile && typeof helpers.saveReportFile === 'function') {
        try {
            const fname = `${partner}_결제금액_${from}~${to}.xlsx`; // 화면 다운로드와 동일 파일명
            const buf = await buildPartnerWeekXlsx({ partner, from, to, target });
            report.file_id = await helpers.saveReportFile(fname, buf);
            report.file_name = fname;
            lines.push(`📎 ${fname}`);
        } catch (e) {
            report.file_error = '파일 생성 실패: ' + e.message;
            lines.push(report.file_error);
        }
    }
    return { summary: `『${label} ${partner}』 정산 ${fmt(total)}원`, lines, report };
}

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
async function filteredReport({ pool, helpers, keyword, partner, period, wantFile }) {
    const parsed = resolvePeriod(period);
    const range = parsed || resolvePeriod('this_month'); // 기간 미지정/해석불가 → 이번 달
    const periodNote = (period && !parsed) ? ` · 기간 '${period}' 해석 불가 → 이번 달 기준` : '';
    const allRows = await fetchSettlements(pool, helpers, range.from, range.to);
    // 🔴 대표 7/22: 거래처(효돈농협/대성(시온)/기타거래처) 지정 시 그 거래처만 필터.
    //    기존엔 월/기간 매출에 거래처 필터가 없어 "효돈 4월 매출"이 회사 전체(306,076,600)로 나왔음.
    const rows = partner ? allRows.filter(r => r.partner === partner) : allRows;
    const scope = [partner, keyword].filter(Boolean).join(' ') || '전체';

    // 거래처 필터 결과 0건인데 기간엔 데이터가 있으면 → 그 거래처만 없다고 정직 안내 (전체 0건과 구분)
    if (rows.length === 0 && partner && allRows.length > 0) {
        const partners = [...new Set(allRows.map(r => r.partner))];
        return {
            summary: `${range.label}에 '${partner}' 정산이 없습니다`,
            lines: [
                `${range.label}(${range.from}~${range.to})에 거래처 '${partner}' 정산 데이터가 없습니다`,
                `이 기간 정산이 있는 거래처: ${partners.join(', ')}`,
                '거래처명을 확인해서 다시 지시해주세요',
            ],
            report: {
                type: 'semi_settlement_filtered', title: `${scope} · ${range.label}`,
                keyword: keyword || null, partner, period: range, no_match: true,
                note: `거래처 '${partner}' 필터 결과 0건 (기간엔 다른 거래처 데이터 있음)`,
            },
        };
    }
    // v5.0 1단계 1-3: 0건 가드 — 그대로 보고하지 않고 조건 복창 + 인접 데이터 힌트 (대체 조회 금지)
    if (rows.length === 0) {
        const near = await pool.query(
            `SELECT to_char(date, 'YYYY-MM') AS ym FROM settlements
             ORDER BY GREATEST(date - $1::date, $1::date - date) ASC LIMIT 1`, [range.from]);
        const nearYm = near.rows[0]?.ym || null;
        return {
            summary: `『${range.label}』 조회 결과 0건입니다 — 조회 기간이 맞나요?${nearYm ? ` (데이터가 있는 가장 가까운 달: ${nearYm})` : ''}`,
            lines: [
                `${range.label}(${range.from}~${range.to}) 정산 데이터가 한 건도 없습니다`,
                nearYm ? `데이터가 있는 가장 가까운 달: ${nearYm} — 그 기간으로 다시 지시하시면 조회해드립니다` : '정산 데이터가 아직 한 건도 없습니다',
                '정직 원칙: 다른 기간 데이터로 대체하지 않습니다',
            ],
            report: {
                type: 'semi_settlement_filtered', title: `${keyword || '전체'} · ${range.label}`,
                keyword: keyword || null, period: range, zero_result: true, nearest_month: nearYm,
                note: '조회 결과 0건 — 기간 확인 요청 (0건 가드)' + periodNote,
            },
        };
    }

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
        const allNamesFull = [...new Set(rows.flatMap(r => r.items.map(it => it && it.name).filter(Boolean)))];
        const cappedNames = capList(allNamesFull);
        const allNames = cappedNames.list;
        return {
            summary: `해당 품목을 찾을 수 없습니다: "${keyword}" (${range.label})`,
            lines: [
                `"${keyword}"와 매칭되는 품목이 ${range.label} 정산에 없습니다`,
                allNamesFull.length
                    ? `해당 기간 등록 품목 ${allNamesFull.length}종: ${allNames.slice(0, 4).join(', ')}${allNamesFull.length > 4 ? ' 외' : ''}`
                    : '해당 기간에는 정산 데이터 자체가 없습니다',
                '품목명을 확인해서 다시 지시해주세요',
            ],
            report: {
                type: 'semi_settlement_filtered', title: `${keyword} · ${range.label}`,
                keyword, period: range, no_match: true, available_items: allNames, available_omitted: cappedNames.omitted,
                note: '요청 품목과 매칭되는 정산 품목 없음 — 등록 품목 목록 참고' + periodNote + omitNote(cappedNames.omitted),
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
        ? `완료: ${scope} ${range.label}: ${totalQty.toLocaleString('ko-KR')}개 / ${fmt(productTotal)}원`
        : `완료: ${partner ? partner + ' ' : ''}${range.label} 총 ${fmt(paymentTotal)}원 (상품 ${fmt(productTotal)} + 택배 ${fmt(cjFee + cjCarryover)})`;

    const cappedItems = capList(items);
    const report = {
        type: 'semi_settlement_filtered', title: `${scope} · ${range.label}`,
        keyword: keyword || null, partner: partner || null, period: range,
        items: cappedItems.list, items_omitted: cappedItems.omitted, total_qty: totalQty, product_total: productTotal,
        cj_fee: cjFee, cj_carryover: cjCarryover, payment_total: paymentTotal,
        note: (keyword
            ? '품목 부분 일치 매칭 · 상품 기준 금액 (택배비 미포함)'
            : `총 결제금액 = 상품 + 택배비(박스×${CJ_BOX_FEE.toLocaleString()}원)${cjCarryover ? ' + 이월' : ''}`)
            + ' · 정산관리와 동일 단가 계산 · 읽기 전용' + periodNote + omitNote(cappedItems.omitted),
    };
    // 4단계: 파일 요청 시 xlsx 생성 (요약+상세, 화면 숫자와 동일 경로)
    const fname = await attachXlsx(helpers, wantFile, {
        label: range.label, from: range.from, to: range.to, rows,
        productTotal, cjFee, cjCarryover, paymentTotal, keyword,
    }, report);

    return {
        summary: summary + (fname ? ` · 📎 ${fname}` : (report.file_error ? ' · ⚠️ 파일 생성 실패' : '')),
        lines: [
            keyword
                ? `${scope} ${range.label}(${range.from}~${range.to}) — 규격 ${items.length}종 · ${totalQty.toLocaleString('ko-KR')}개 · ${fmt(productTotal)}원`
                : `${partner ? partner + ' ' : ''}${range.label}(${range.from}~${range.to}) 상품 ${fmt(productTotal)}원 · 정산 ${rows.length}건`,
            items.length
                ? `최다: ${items[0].name} (${items[0].qty.toLocaleString('ko-KR')}개 / ${fmt(items[0].amount)}원)`
                : '집계된 품목이 없습니다',
            fname
                ? `📎 ${fname} — 보고서함에서 다운로드`
                : (keyword
                    ? '상품 기준 금액 (택배비 미포함) · 정산관리와 동일 단가 매칭'
                    : `택배비 ${fmt(cjFee + cjCarryover)}원 포함 총 ${fmt(paymentTotal)}원`),
        ],
        report,
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

        // ===== 대표 7/22: 품목별 결제가(단가) 이력 — pricing(품목별 금액) 주간 단가 그리드 =====
        // 매출 조회보다 먼저 분기 (결제가 의도가 확정되면 매출 리포트로 새지 않게)
        if (params.price_history) {
            return priceHistoryReport({
                pool,
                period: String(params.period || '').trim(),
                partner: String(params.partner || '').trim() || null,
                keyword: String(params.item_keyword || '').trim() || null,
            });
        }

        // ===== 지시 #15: 주차×거래처 정산 (서버가 주차·거래처를 확정해 전달 — 모델 재량 없음) =====
        if (params.partner_week && params.partner_week.partner) {
            const pw = params.partner_week;
            return partnerWeekReport({
                pool, helpers, partner: pw.partner, from: pw.from, to: pw.to,
                label: pw.label || `${pw.from}~${pw.to}`, wantFile: !!params.want_file,
            });
        }

        // ===== 4.5단계: 기간 비교 / 품목 순위 (서버가 의도·기간을 확정해 전달 — 모델 재량 없음) =====
        if (params.compare && params.compare.a && params.compare.b) {
            return compareReport({ pool, helpers, a: params.compare.a, b: params.compare.b, wantFile: !!params.want_file });
        }
        if (params.rank) {
            return rankReport({
                pool, helpers, period: String(params.period || '').trim(),
                topN: Number(params.rank.topN) || 10, showAll: !!params.rank.all,
                partner: String(params.partner || '').trim(), // 대표 7/22: 거래처별 순위
                wantFile: !!params.want_file,
            });
        }

        // ===== 특정 일자 통합 조회 (8차 보강: 일별 정산 + 정산현황 기록) =====
        const targetDate = String(params.target_date || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
            return dayReport({ pool, helpers, date: targetDate });
        }

        // ===== 조건 필터 모드 — 마루가 추출한 품목/기간 조건 (없으면 기존 전체 보고서) =====
        const kw = String(params.item_keyword || '').trim();
        const partner = String(params.partner || '').trim(); // 대표 7/22: 거래처별 월/기간 매출
        const periodRaw = String(params.period || '').trim();
        if (kw || partner || periodRaw) {
            return filteredReport({ pool, helpers, keyword: kw, partner, period: periodRaw, wantFile: !!params.want_file });
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
        }).sort((a, b) => b.cur_amount - a.cur_amount);
        const cappedYoy = capList(yoyItems);

        const totalDiff = month.total - prev.total; // 상품 기준
        const totalPct = prev.total > 0 ? Math.round(totalDiff / prev.total * 1000) / 10 : null;

        const report = {
            type: 'semi_settlement', workplace: '법인', generated_at: new Date().toISOString(),
            week: { from: weekFrom, to: today, product_total: week.total, cj_fee: weekCjFee, payment_total: weekPayment, count: week.count, box_count: weekBoxes },
            month: { label: monthLabel, from: monthFrom, to: monthTo, product_total: month.total, cj_fee: monthCjFee, cj_carryover: cjCarryover, payment_total: monthPayment, count: month.count, box_count: monthBoxes },
            prev: { from: prevFrom, to: prevTo, total: prev.total, count: prev.count },
            total_diff: totalDiff, total_pct: totalPct,
            partners,
            yoy_items: cappedYoy.list, yoy_omitted: cappedYoy.omitted,
            note: `단가는 품목별 금액표 기준 자동 매칭 (정산관리와 동일 계산) · 택배비 = 박스수 × ${CJ_BOX_FEE.toLocaleString()}원 + 당월 이월금액 · 읽기 전용`
                + omitNote(cappedYoy.omitted)
                + (partners.some(p => p.items_omitted > 0) ? ` · 거래처 품목 ${partners.reduce((s, p) => s + (p.items_omitted || 0), 0)}종 생략(상한 ${REPORT_ITEM_CAP})` : ''),
        };
        // 4단계: 파일 요청 시 이번 달 기준 xlsx 생성
        const fname = await attachXlsx(helpers, !!params.want_file, {
            label: monthLabel, from: monthFrom, to: monthTo, rows: monthRows,
            productTotal: month.total, cjFee: monthCjFee, cjCarryover, paymentTotal: monthPayment, keyword: '',
        }, report);

        return {
            summary: `완료: ${monthLabel} 총 ${fmt(monthPayment)}원 (상품 ${fmt(month.total)} + 택배 ${fmt(monthCjFee + cjCarryover)})` + (fname ? ` · 📎 ${fname}` : (report.file_error ? ' · ⚠️ 파일 생성 실패' : '')),
            lines: [
                `이번 주(${weekFrom}~${today}) 총 ${fmt(weekPayment)}원 (상품 ${fmt(week.total)} + 택배 ${fmt(weekCjFee)})`,
                `${monthLabel} 전체(${monthFrom}~${monthTo}) 총 ${fmt(monthPayment)}원 · 정산 ${month.count}건 · 거래처 ${partners.length}곳`,
                fname
                    ? `📎 ${fname} — 보고서함에서 다운로드`
                    : (prev.total > 0
                        ? `전년 동기 상품 기준 ${fmt(prev.total)}원 → ${totalPct >= 0 ? '+' : ''}${totalPct}% (${totalDiff >= 0 ? '+' : ''}${fmt(totalDiff)}원)`
                        : `전년 동기(${prevFrom.slice(0, 7)}) 정산 데이터 없음`),
            ],
            report,
        };
    },
};
