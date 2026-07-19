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

module.exports = { live: false, verifyReport }; // 검산 게이트 전용 (세미 보고 산출 직후 서버가 호출)
