// #468 검증(단위): 네이버 정산 대조 — server.js 실코드 블록을 잘라 실행(네이버·DB·알림 스텁 — 실DB·실호출 0)
//   실행: node scripts/verify-468-unit.js
const fs = require('fs');
const path = require('path');
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('const SETTLE_RECON_ORDER_TYPES');
const b = src.indexOf("app.get('/api/agent-office/settle-recon'");
if (a < 0 || b < 0 || b < a) { console.error('블록 추출 실패'); process.exit(1); }
const block = src.slice(a, b);
ok('server.js 블록 추출', /async function settleReconRun/.test(block) && /function settleReconClassify/.test(block) && /async function settleReconNotify/.test(block));

const S = { ss: [], lms: [], recon: {}, users: [{ id: 1, role: 'admin', deleted_at: null }, { id: 3, role: 'admin', deleted_at: '2026-09-01' }, { id: 7, role: 'admin', deleted_at: null }, { id: 5, role: 'user', deleted_at: null }], notes: [], casePages: {}, calls: [], today: '2026-09-24' };
const pool = {
    async query(sql, params = []) {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (/^SELECT to_char\(date,'YYYY-MM-DD'\) AS d, COALESCE\(settlement_scheduled/.test(q)) return { rows: S.ss.filter(r => r.date >= params[0] && r.date <= params[1]).sort((x, y) => x.date.localeCompare(y.date)).map(r => ({ d: r.date, s: r.s, u: r.u })) };
        if (/^SELECT order_key, to_char\(created_at \+ interval '9 hours','YYYY-MM-DD'\) AS d FROM lms_guide_log WHERE order_key = ANY/.test(q)) return { rows: S.lms.filter(l => params[0].includes(l.key)).map(l => ({ order_key: l.key, d: l.ship })) };
        if (/^SELECT order_key FROM lms_guide_log WHERE order_key !~/.test(q)) return { rows: S.lms.filter(l => !/^(c24|cp|join):/.test(l.key) && l.status !== 'canceled-excluded' && l.ship >= params[0] && l.ship <= params[1] && !params[2].includes(l.key)).map(l => ({ order_key: l.key })) };
        if (/^INSERT INTO naver_settle_recon/.test(q)) { const r = S.recon[params[0]] || {}; S.recon[params[0]] = { ...r, expect_date: params[0], basis_start: params[1], basis_end: params[2], complete_date: params[3], settle_amount: params[9], in_period: params[11], carried_in: params[13], carried_in_count: params[14], pending_out_count: params[17], input_sum: params[19], diff1: params[21], status: params[22] }; return {}; }
        if (/^SELECT notified_at, notified_status FROM naver_settle_recon WHERE expect_date=\$1/.test(q)) { const r = S.recon[params[0]]; return { rows: r ? [{ notified_at: r.notified_at || null, notified_status: r.notified_status || null }] : [] }; }
        if (/^UPDATE naver_settle_recon SET notified_at=NOW\(\), notified_status=\$2/.test(q)) { const r = S.recon[params[0]]; if (r) { r.notified_at = new Date(); r.notified_status = params[1]; } return {}; }
        if (/^SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL/.test(q)) return { rows: S.users.filter(u => u.role === 'admin' && !u.deleted_at).map(u => ({ id: u.id })) };
        if (/^SELECT \* FROM naver_settle_recon WHERE basis_start <= \$1::date AND basis_end >= \$1::date/.test(q)) return { rows: Object.values(S.recon).filter(r => r.basis_start <= params[0] && r.basis_end >= params[0]).map(r => ({ ...r })) };
        if (/^UPDATE naver_settle_recon SET input_sum=\$2/.test(q)) { const r = S.recon[params[0]]; if (r) { r.input_sum = params[1]; r.diff1 = params[3]; r.status = params[4]; } return {}; }
        throw new Error('stub: 미지원 SQL — ' + q.slice(0, 100));
    },
};
const ctx = {
    pool, naverCallWithRetry: async (req) => { S.calls.push(req); const pages = S.casePages[req.query.searchDate] || [[]]; const p = pages[req.query.pageNumber - 1] || []; return { elements: p, pagination: { totalPages: pages.length } }; },
    createNotification: async (uid, type, title, msg, link) => { S.notes.push({ uid, type, title, msg, link }); }, kstTodayStr: () => S.today, console,
};
const fn = new Function(...Object.keys(ctx), block + '\nreturn { settleReconRun, settleReconClassify, settleReconStatus, settleReconRecomputeInputs, settleReconMessage, settleReconFetchCase };');
const R = fn(...Object.values(ctx));
const order = (pid, amt, type = 'PROD_ORDER') => ({ productOrderId: pid, productOrderType: type, settleExpectAmount: amt });
const daily = (o) => ({ settleExpectDate: o.expect, settleBasisStartDate: o.bs || o.expect, settleBasisEndDate: o.be || o.expect, settleCompleteDate: o.complete === undefined ? o.expect : o.complete, paySettleAmount: o.pay, commissionSettleAmount: -o.fee, benefitSettleAmount: -(o.benefit || 0), returnCareSettleAmount: -(o.care || 0), deductionRestoreSettleAmount: -(o.ded || 0), settleAmount: o.pay - o.fee - (o.benefit || 0) - (o.care || 0) - (o.ded || 0), quickSettleAmount: 0, normalSettleAmount: 0 });
function reset() { Object.assign(S, { ss: [], lms: [], recon: {}, notes: [], casePages: {}, calls: [] }); }

(async () => {
    // ① 9/21 발송 회차(예정 9/22): 기간 내 2건 + 전날(9/20) 집화 지연 유입 1건 + 리뷰 적립 행 + 집화 대기 1건 · 넣은 값 = 기간 내 정산 + 100 → ok · 활성 관리자 2명에게만 알림
    reset();
    S.lms = [{ key: 'A1', ship: '2026-09-21', status: 'sent' }, { key: 'A2', ship: '2026-09-21', status: 'sent' }, { key: 'B0', ship: '2026-09-20', status: 'sent' }, { key: 'P9', ship: '2026-09-21', status: 'sent' }, { key: 'X1', ship: '2026-09-21', status: 'canceled-excluded' }, { key: 'c24:1', ship: '2026-09-21', status: 'sent' }];
    S.casePages['2026-09-22'] = [[order('A1', 50000), order('A2', 30000), order('B0', 20000), order('R1', -3000, 'PURCHASE_REVIEW'), order('C9', -5000)]];
    S.ss = [{ date: '2026-09-21', s: 80100, u: 0 }];
    const r1 = await R.settleReconRun(daily({ expect: '2026-09-22', bs: '2026-09-21', be: '2026-09-21', pay: 110000, fee: 7000, benefit: 3000, care: 500 }));
    ok('① 분류 = 기간 내 80,000(2건) · 유입 20,000(1건 · 9/20) · 리뷰 행은 조정으로 · 집화 대기 1건(P9 — 취소 제외·자사몰 제외)', r1.in_period === 80000 && r1.in_period_count === 2 && r1.carried_in === 20000 && r1.carried_in_count === 1 && r1.detail.adjust.PURCHASE_REVIEW === -3000 && r1.pending_out_count === 1 && r1.pending_out_ids[0] === 'P9' && r1.reversal === -5000 && r1.reversal_count === 1, JSON.stringify({ in: r1.in_period, ci: r1.carried_in, po: r1.pending_out_ids, rev: r1.reversal }));
    ok('① 판정 ok(차이 100 = 0.12%) · diff1 100 · 실입금 99,500', r1.status === 'ok' && r1.diff1 === 100 && r1.settle_amount === 99500);
    ok('① 알림 = 활성 관리자 2명(1·7)만 · 퇴사 admin(3)·직원(5) 제외 · 링크 settlement:settlement-status · 제목에 입금액', S.notes.length === 2 && S.notes.map(n => n.uid).join(',') === '1,7' && S.notes.every(n => n.link === 'settlement:settlement-status' && /9\/22 네이버 입금 99,500원 ✅/.test(n.title)), S.notes[0] && S.notes[0].title);
    ok('① 본문 = 넣은 값·취소이월·리뷰적립·반품케어·유입·집화 대기', /넣은 값 80,100/.test(S.notes[0].msg) && /취소·이월 차이 100/.test(S.notes[0].msg) && /리뷰적립 −3,000/.test(S.notes[0].msg) && /반품케어 −500/.test(S.notes[0].msg) && /유입 \+20,000\(1건\)/.test(S.notes[0].msg) && /집화 대기 1건/.test(S.notes[0].msg) && /취소·회수 −5,000(1건)/.test(S.notes[0].msg), S.notes[0].msg);
    const n1 = S.notes.length; await R.settleReconRun(daily({ expect: '2026-09-22', bs: '2026-09-21', be: '2026-09-21', pay: 110000, fee: 7000, benefit: 3000, care: 500 }));
    ok('① 재실행(09:30 재수집) = 알림 중복 0', S.notes.length === n1);

    // ② 넣은 값 없음 → no-input 알림 → 정산현황 저장 후 재계산 → ok 전환 알림 1회 → 재저장 시 추가 알림 0
    reset();
    S.lms = [{ key: 'A1', ship: '2026-09-15', status: 'sent' }];
    S.casePages['2026-09-16'] = [[order('A1', 100000)]];
    const r2 = await R.settleReconRun(daily({ expect: '2026-09-16', bs: '2026-09-15', be: '2026-09-15', pay: 110000, fee: 10000 }));
    ok('② 미입력 = no-input · 알림 문구 「정산현황에 정산예정이 아직 없습니다」', r2.status === 'no-input' && r2.input_sum === null && S.notes.length === 2 && /정산예정이 아직 없습니다/.test(S.notes[0].msg) && /📝/.test(S.notes[0].title));
    S.ss = [{ date: '2026-09-15', s: 100200, u: 0 }];
    const rc = await R.settleReconRecomputeInputs('2026-09-15');
    ok('② 저장 훅 재계산(네이버 호출 0) = ok 전환 · 전환 알림 1회(총 4)', rc.length === 1 && rc[0].status === 'ok' && rc[0].input_sum === 100200 && S.notes.length === 4 && /✅/.test(S.notes[2].title) && S.calls.length === 1);
    await R.settleReconRecomputeInputs('2026-09-15');
    ok('② 재저장 = 추가 알림 0', S.notes.length === 4);

    // ③ warn(3% 차이) · ④ unpaid(예정일 지남·완료일 없음) · ⑤ 묶음 정산(9/18~20 두 날짜 입력 합산) · ⑥ 경계값(정확히 0.5%)
    reset(); S.lms = [{ key: 'A1', ship: '2026-09-17', status: 'sent' }]; S.casePages['2026-09-18'] = [[order('A1', 10000000)]]; S.ss = [{ date: '2026-09-17', s: 10300000, u: 0 }];
    const r3 = await R.settleReconRun(daily({ expect: '2026-09-18', bs: '2026-09-17', be: '2026-09-17', pay: 1100000, fee: 100000 }));
    ok('③ 3% 차이(30만) = warn · 본문에 0.5% 안내', r3.status === 'warn' && r3.diff1 === 300000 && /0\.5%를 넘습니다/.test(S.notes[0].msg) && /⚠️/.test(S.notes[0].title));
    reset(); S.lms = [{ key: 'A1', ship: '2026-09-22', status: 'sent' }]; S.casePages['2026-09-23'] = [[order('A1', 1000)]]; S.ss = [{ date: '2026-09-22', s: 1000, u: 0 }];
    const r4 = await R.settleReconRun(daily({ expect: '2026-09-23', bs: '2026-09-22', be: '2026-09-22', pay: 1100, fee: 100, complete: null }));
    ok('④ 예정일 지남 + 완료 기록 없음 = unpaid · 제목 「미입금」', r4.status === 'unpaid' && /미입금/.test(S.notes[0].title));
    const r4b = await R.settleReconRun(daily({ expect: '2026-09-25', bs: '2026-09-22', be: '2026-09-22', pay: 1100, fee: 100, complete: null }));
    ok('④ 예정일이 미래면 완료일 없어도 unpaid 아님', r4b.status !== 'unpaid');
    reset(); S.lms = [{ key: 'F1', ship: '2026-09-18', status: 'sent' }, { key: 'S1', ship: '2026-09-20', status: 'sent' }]; S.casePages['2026-09-21'] = [[order('F1', 400000), order('S1', 600000)]];
    S.ss = [{ date: '2026-09-18', s: 400500, u: 0 }, { date: '2026-09-20', s: 400500, u: 600000 }, { date: '2026-09-17', s: 999999, u: 0 }];
    const r5 = await R.settleReconRun(daily({ expect: '2026-09-21', bs: '2026-09-18', be: '2026-09-20', pay: 1100000, fee: 100000 }));
    ok('⑤ 묶음(9/18~20) = 넣은 값 = 마지막 기록 9/20(이월 400,500 + 미정산 600,000 = 1,000,500 · 9/18 행 중복 합산 없음) · 기간 내 2건 · ok', r5.input_sum === 1000500 && r5.input_dates.length === 2 && r5.input_dates[1].used === true && !r5.input_dates[0].used && r5.in_period_count === 2 && r5.status === 'ok' && /9\/18~9\/20 발송분/.test(S.notes[0].msg), S.notes[0].msg.slice(0, 80));
    const bnd = R.settleReconStatus({ input_sum: 100000000, in_period: 99500000, complete_date: '2026-09-21', expect_date: '2026-09-21', todayKst: '2026-09-24' });
    const bnd2 = R.settleReconStatus({ input_sum: 100000000, in_period: 99499999, complete_date: '2026-09-21', expect_date: '2026-09-21', todayKst: '2026-09-24' });
    const bnd3 = R.settleReconStatus({ input_sum: 25053, in_period: 0, complete_date: '2026-09-23', expect_date: '2026-09-23', todayKst: '2026-09-24' });
    ok('⑥ 경계 = 정확히 0.5%(50만/1억)는 ok · 초과 warn · 소액 차이(25,053 ≤ 10만)는 ok', bnd.status === 'ok' && bnd2.status === 'warn' && bnd3.status === 'ok');

    // ⑦ 건별 조회 페이지 순회(2페이지) · periodType = 정산 예정일
    reset(); S.casePages['2026-09-10'] = [[order('A1', 10)], [order('A2', 20)]];
    const rows = await R.settleReconFetchCase('2026-09-10');
    ok('⑦ 건별 조회 2페이지 취합 · periodType SCHEDULE_DATE · pageSize 1000', rows.length === 2 && S.calls.length === 2 && S.calls[0].query.periodType === 'SETTLE_CASEBYCASE_SETTLE_SCHEDULE_DATE' && S.calls[0].query.pageSize === 1000 && S.calls[0].path === '/external/v1/pay-settle/settle/case');

    const fail = results.filter(r => !r.pass).length;
    console.log(`\n결과: ${results.length - fail}/${results.length}${fail ? ' — 실패 ' + fail : ''}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
