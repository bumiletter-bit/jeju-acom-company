// 한수 (재무팀장) — 검산 게이트 (지시 #44 · 0원 순수 코드, 모델 호출 없음)
// 세미 보고서 산출물 위에서만 검산: ①총결제=상품+택배+이월 ②상세 합계 vs 요약 숫자 ③기간·라벨 정합.
// 절대 규칙: 자동 보정 금지 — 오차는 있는 그대로 보고만 (정직 원칙). 세미 로직 무변경.
const near = (a, b, tol = 1) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;
const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원';

// 세미 report(type별)를 검산 — { ok, checks: [{name, ok, note}], diff_won }
function verifyReport(report) {
    if (!report || typeof report !== 'object') return null;
    const checks = [];
    const chk = (name, ok, note) => checks.push({ name, ok: !!ok, note: note || '' });
    let diff = 0;
    const totalEq = (label, payment, product, cj, carry) => {
        const expect = (Number(product) || 0) + (Number(cj) || 0) + (Number(carry) || 0);
        const ok = near(payment, expect);
        if (!ok) diff = Math.max(diff, Math.abs((Number(payment) || 0) - expect));
        chk(`${label} 총결제=상품+택배+이월`, ok, ok ? `${won(payment)} 일치` : `보고 ${won(payment)} vs 재검산 ${won(expect)} — 원인 위치: ${label} 합산부`);
    };
    try {
        if (report.type === 'semi_settlement' && report.month) {
            const m = report.month;
            totalEq('이번달', m.payment_total, m.product_total, m.cj_fee, m.cj_carryover);
            if (Array.isArray(report.partners) && report.partners.length) {
                const psum = report.partners.reduce((s, p) => s + (Number(p.total) || 0), 0);
                const ok = near(psum, m.product_total);
                if (!ok) diff = Math.max(diff, Math.abs(psum - (Number(m.product_total) || 0)));
                chk('거래처별 합계 vs 상품 총액', ok, ok ? `${won(psum)} 일치` : `거래처 합 ${won(psum)} vs 상품 ${won(m.product_total)} — 원인 위치: 거래처 집계`);
            }
        } else if (report.type === 'semi_compare' && report.a && report.b) {
            totalEq(`A(${report.a.label || 'A'})`, report.a.payment_total, report.a.product_total, report.a.cj_fee, report.a.cj_carryover);
            totalEq(`B(${report.b.label || 'B'})`, report.b.payment_total, report.b.product_total, report.b.cj_fee, report.b.cj_carryover);
        } else if (report.type === 'semi_rank' && Array.isArray(report.rows)) {
            const rsum = report.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
            const ok = rsum <= (Number(report.product_total) || 0) + 1;
            chk('순위 합계 ≤ 상품 총액', ok, ok ? `TOP 합 ${won(rsum)}` : `TOP 합 ${won(rsum)} > 상품 ${won(report.product_total)} — 원인 위치: 순위 집계`);
            if (report.period && report.period.from && report.period.to) {
                chk('기간 라벨 정합', String(report.period.from) <= String(report.period.to), `${report.period.from}~${report.period.to}`);
            }
        } else if (report.type === 'semi_partner_week') {
            if (report.cj) {
                const ok = near(report.total, (Number(report.boxes) || 0) * 3100);
                if (!ok) diff = Math.abs((Number(report.total) || 0) - (Number(report.boxes) || 0) * 3100);
                chk('택배비=박스×3,100', ok, ok ? `${won(report.total)} 일치` : `보고 ${won(report.total)} vs 재검산 ${won((report.boxes || 0) * 3100)} — 원인 위치: CJ 계산부`);
            }
            chk('주차 기간 정합', String(report.from || '') <= String(report.to || ''), `${report.from}~${report.to}`);
        } else if (report.type === 'semi_settlement_filtered' && report.period) {
            chk('기간 라벨 정합', String(report.period.from || '') <= String(report.period.to || ''), `${report.period.from}~${report.period.to}`);
        } else {
            return null; // 검산 가능한 필드가 없는 유형 — 게이트 미적용 (억지 검산 금지)
        }
    } catch (e) {
        return { ok: false, checks: [{ name: '검산 실행', ok: false, note: '검산 오류: ' + e.message }], diff_won: 0, reviewer: '한수' };
    }
    if (!checks.length) return null;
    const ok = checks.every(c => c.ok);
    return { ok, checks, diff_won: diff, reviewer: '한수' };
}

// ===== 지시 #54-2: 실무 전환 (전부 0원 코드, AI 없음) =====
// ② 신규 품목 마진 계산 — 지시 원문에서 판매가·원가 항목을 파싱해 마진 자동 계산 (해석 근거 명시, 모호하면 정직 표시)
function parseWon(str) {
    // '3만원'→30000, '3,100원'→3100, '2천원'→2000, '58,000'→58000
    const m = String(str).replace(/,/g, '');
    let n = 0;
    const man = m.match(/([\d.]+)\s*만/);
    const chon = m.match(/([\d.]+)\s*천/);
    if (man) n += Math.round(parseFloat(man[1]) * 10000);
    if (chon) n += Math.round(parseFloat(chon[1]) * 1000);
    if (!man && !chon) {
        const num = m.match(/(\d+)/);
        if (num) n = Number(num[1]);
    }
    return n;
}
function computeMargin(text) {
    const t = String(text || '');
    // 판매가: '판매가 N원' 우선
    const saleM = t.match(/판매가[는가]?\s*([\d,.]+\s*(만|천)?\s*원?)/);
    const sale = saleM ? parseWon(saleM[1]) : 0;
    // 원가 항목: 결제가/원가/매입가 + 택배비 + 박스/포장 (언급된 것만 — 추측 금지)
    const items = [];
    const grab = (label, re) => { const m = t.match(re); if (m) items.push({ label, won: parseWon(m[1]) }); };
    grab('결제가(원가)', /(?:결제가|원가|매입가)[는가]?\s*(?:kg당\s*)?([\d,.]+\s*(?:만|천)?\s*원?)/);
    grab('택배비', /택배비?\s*([\d,.]+\s*(?:만|천)?\s*원?)/);
    grab('박스·포장', /(?:아이스\s*)?박스[값비]?\s*(?:포함되?)?\s*\(?([\d,.]+\s*(?:만|천)?\s*원?)/);
    const costSum = items.reduce((s, i) => s + i.won, 0);
    if (!sale || !items.length) return null; // 해석 불가 — 정직하게 계산하지 않음
    return { sale, items, costSum, margin: sale - costSum, marginPct: Math.round((sale - costSum) / sale * 1000) / 10 };
}

module.exports = {
    live: true, // 지시 #54: 실무 전환 — 마진 계산 (검산 게이트·브리핑·단가 감지는 서버 훅)
    verifyReport, computeMargin, parseWon,
    steps: ['금액 해석 중...', '마진 재계산 중...'],
    stepDelayMs: 1000,
    async result({ params = {} }) {
        const q = String(params.order_content || '').trim();
        const m = computeMargin(q);
        if (!m) {
            return {
                summary: '금액 해석 불가 — 계산하지 않았습니다 (정직 안내)',
                lines: [
                    '마진 계산에는 판매가와 원가 항목(결제가·택배비·박스값 등)이 필요합니다',
                    '예: "무늬오징어 결제가 kg당 3만원, 택배비 3,100원, 박스 2천원, 판매가 58,000원 마진 계산해줘"',
                    '모호한 금액은 추측하지 않습니다',
                ],
                report: { type: 'hansu_margin', no_parse: true, note: '금액 해석 불가 — 추측 계산 금지 (지시 #54)' },
            };
        }
        const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
        return {
            summary: `마진 ${won(m.margin)} (판매가 ${won(m.sale)} − 원가 합 ${won(m.costSum)}, ${m.marginPct}%)`,
            lines: [
                `원가 구성: ${m.items.map(i => `${i.label} ${won(i.won)}`).join(' + ')} = ${won(m.costSum)}`,
                `판매가 ${won(m.sale)} − 원가 ${won(m.costSum)} = 마진 ${won(m.margin)} (${m.marginPct}%)`,
                '해석 근거는 보고서 카드에서 — 숫자가 지시와 다르면 알려주세요 (자동 보정 없음)',
            ],
            report: { type: 'hansu_margin', ...m, instruction: q.slice(0, 300), note: '0원 코드 계산 — 언급된 원가 항목만 합산 (추측 금지)' },
        };
    },
};
