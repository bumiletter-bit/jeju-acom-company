// #1235(대표 11/22 「오늘 챙길 일 · 메뉴 숫자 배지 해줘」) GET /api/today-summary — 첫 화면 띠·메뉴 배지 숫자를 한 번에
//   🔴 숫자는 새로 세지 않는다: 그 메뉴 화면이 부르는 API 를 요청한 계정의 토큰으로 서버 안에서 다시 불러(127.0.0.1 · 같은 포트)
//      화면과 같은 판정(public/today-rules.js)을 적용한다(#199 교훈 · 띠·배지 숫자 = 그 메뉴 안 숫자).
//   inq  = 문의 관리 › 응대 현황 「아직 안 답함」(response-stats?days=7 · 화면 기본 7일 · 전체 = 톡톡+상품문의+고객문의)
//   memo = 발주 메모함 빨강 줄(「확인필요」) 수(/api/order-memo · memoRowBad)
//   exp  = 체험 예약 「번호 미입력」(/api/agent-office/experience · 화면 첫 열기와 같은 범위 = 이번 달 1일 ~ 2달 뒤 말일 · expNoPhone)
//     → 셋은 누가 봐도 같은 값 = 공용 한 벌(60초) + 진행 중 요청 합치기(같은 순간 여러 계정이 불러도 안쪽 호출 1번)
//     → 자격 = 그 API 들의 조건과 같음: 로그인 + 세무사 아님(response-head.js guard = 세무사 403 · order-memo·experience 목록 = 로그인만) · 세무사는 아예 빈 값
//   appr = 창구 승인 대기(대표만 = 승인 단추가 보이는 계정 · ao-desk isOwner) · COUNT 1
//   recon = 네이버 정산 대조 최근 회차가 「차이 큼·미입금」일 때(대표만 · 대표 결정 「정산 대조 알림 가영에게 안 보냄」과 같은 선 · 10분 캐시)
//   오늘 일정 = 화면(일정)이 이미 읽은 목록으로 화면에서 셈(서버 셈 없음)
//   끄기 = agent_office_config 'today_summary' {enabled:false} → { off:true }(줄 없으면 켜짐) · 항목 하나가 실패하면 그 항목만 null(0 과 구분)
//   새 타이머·쓰기 0 · 로그 = 기동 뒤 첫 안쪽 호출 성공/실패 한 줄 + 실패는 같은 사유 10분에 1번(숫자 없음)
'use strict';
const http = require('http');
const R = require('./public/today-rules.js');

const TTL = 60e3, RECON_TTL = 10 * 60e3, SUB_TIMEOUT = 20e3, LOG_GAP = 10 * 60e3;

function subGet(port, path, auth) {
    return new Promise((resolve, reject) => {
        const rq = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { authorization: auth || '' }, timeout: SUB_TIMEOUT }, rs => {
            let s = ''; rs.setEncoding('utf8'); rs.on('data', d => { s += d; });
            rs.on('end', () => { if (rs.statusCode !== 200) return reject(new Error('HTTP ' + rs.statusCode)); try { resolve(JSON.parse(s)); } catch (e) { reject(new Error('JSON')); } });
        });
        rq.on('timeout', () => rq.destroy(new Error('timeout')));
        rq.on('error', reject); rq.end();
    });
}
function monthSpan(today) {
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const to = new Date(Date.UTC(y, m + 2, 0)).toISOString().slice(0, 10);   /* 2달 뒤 말일(ao-exp.js monthRange(shiftYm(ym, 2)).to 와 같음) */
    return { from: today.slice(0, 7) + '-01', to };
}
function reconPick(d) {
    const rows = (d && d.rows) || [], today = (d && d.today) || R.kstToday();
    let last = null; for (const r of rows) if (r && r.expect_date && r.expect_date <= today && (!last || r.expect_date > last.expect_date)) last = r;
    if (!last || (last.status !== 'warn' && last.status !== 'unpaid')) return { status: last ? last.status : null };
    return { status: last.status, basis_start: last.basis_start, basis_end: last.basis_end, expect_date: last.expect_date };
}

module.exports = function mountTodaySummary(app, deps) {
    const { pool, authMiddleware } = deps, log = deps.log || console;
    const isOwner = deps.isOwner || (u => !!u && u.role === 'admin' && u.position === '대표');
    let shared = null, sharedP = null, reconC = null, reconP = null, firstLogged = false;
    const logAt = new Map();
    const warn = (name, e) => { const k = name + '|' + String(e && e.message || e).slice(0, 60); const t = logAt.get(k) || 0; if (Date.now() - t < LOG_GAP) return; logAt.set(k, Date.now()); if (logAt.size > 100) logAt.clear(); log.error('[#1235 오늘 챙길 일] ' + name + ' 못 읽음(그 칸만 숨김):', String(e && e.message || e).slice(0, 120)); };
    const one = async (name, fn) => { try { return await fn(); } catch (e) { warn(name, e); return null; } };
    async function enabled() {
        try { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'today_summary'`); const v = r.rows[0] && r.rows[0].value; return !(v && typeof v === 'object' && v.enabled === false); }
        catch (e) { return true; }
    }
    async function loadShared(port, auth) {
        const today = R.kstToday(), sp = monthSpan(today);
        const [inq, memo, exp] = await Promise.all([
            one('미답 문의', async () => R.inqOpen(await subGet(port, '/api/agent-office/response-stats?days=7', auth))),
            one('메모함', async () => { const d = await subGet(port, '/api/order-memo', auth); let n = 0; for (const e of (d.entries || [])) for (const r of (e.rows || [])) if (R.memoRowBad(r)) n++; return n; }),
            one('체험 번호', async () => { const d = await subGet(port, `/api/agent-office/experience?from=${sp.from}&to=${sp.to}`, auth); return (d.items || []).filter(b => R.expNoPhone(b, today)).length; }),
        ]);
        if (!firstLogged) { firstLogged = true; const okN = [inq, memo, exp].filter(v => v !== null).length; log.error('[#1235 오늘 챙길 일] 기동 뒤 첫 안쪽 호출: ' + (okN === 3 ? '성공' : okN ? '일부 실패' : '실패')); }
        return { inq, memo, exp };
    }
    function getShared(port, auth) {   /* 공용 한 벌 60초 · 진행 중이면 그 약속을 같이 기다림 */
        if (shared && Date.now() - shared.at < TTL) return Promise.resolve(shared.v);
        if (!sharedP) sharedP = loadShared(port, auth).then(v => { shared = { at: Date.now(), v }; return v; }).finally(() => { sharedP = null; });
        return sharedP;
    }
    function getRecon(port, auth) {
        if (reconC && Date.now() - reconC.at < RECON_TTL) return Promise.resolve(reconC.v);
        if (!reconP) reconP = one('정산 대조', async () => reconPick(await subGet(port, '/api/agent-office/settle-recon', auth))).then(v => { if (v) reconC = { at: Date.now(), v }; return v; }).finally(() => { reconP = null; });
        return reconP;
    }
    app.get('/api/today-summary', authMiddleware, async (req, res) => {
        try {
            if (!(await enabled())) return res.json({ ok: true, off: true });
            const u = req.user || {};
            if (u.role === 'accountant') return res.json({ ok: true, counts: {} });
            const port = req.socket && req.socket.localPort, auth = req.headers.authorization, owner = isOwner(u);
            const [sh, appr, recon] = await Promise.all([
                getShared(port, auth),
                owner ? one('승인 대기', async () => Number((await pool.query(`SELECT COUNT(*)::int AS n FROM pending_orders WHERE status = '승인대기' AND is_deleted = false AND result->>'type' = 'approval_request'`)).rows[0].n) || 0) : null,
                owner ? getRecon(port, auth) : null,
            ]);
            res.json({ ok: true, counts: { inq: sh.inq, memo: sh.memo, exp: sh.exp, appr, recon }, at: new Date().toISOString() });
        } catch (e) { warn('전체', e); res.json({ ok: false }); }
    });
    return { _t: { reconPick, monthSpan, clear: () => { shared = null; sharedP = null; reconC = null; reconP = null; } } };   /* clear = 검증용(캐시 비우기) */
};
