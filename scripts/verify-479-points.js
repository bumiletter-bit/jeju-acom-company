// #479 검증: 적립금 러너 — server.js의 실제 러너 코드를 떼어 가짜 카페24·가짜 DB로 실행(실발송·실DB 0).
//   node scripts/verify-479-points.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('const POINTS_MAX = 50000;'), b = src.indexOf('// 지시 #177: 주문 역조회 진단 러너');
if (a < 0 || b < 0) throw new Error('러너 구간을 찾지 못함');
const body = src.slice(a, b);
const results = [];
const ok = (n, p, note) => { results.push(p); console.log((p ? '✅' : '❌') + ' ' + n + (note ? ' — ' + note : '')); };

function harness({ render = true, members = { mem1: 1000 }, failPost = null, lag = 0 } = {}) {
    const cfg = {}, calls = [], audits = [];
    let tick = null, lagLeft = lag;
    const bal = Object.assign({}, members), shown = Object.assign({}, members);
    const cafe24 = {
        apiGet: async (p, q) => {
            calls.push(['GET', p, q]);
            if (q.member_id) {
                if (!(q.member_id in bal)) return { customers: [] };
                if (lagLeft > 0) { lagLeft--; return { customers: [{ member_id: q.member_id, available_points: String(shown[q.member_id]) + '.00' }] }; }
                shown[q.member_id] = bal[q.member_id];
                return { customers: [{ member_id: q.member_id, available_points: String(bal[q.member_id]) + '.00' }] };
            }
            if (q.cellphone) return { customers: q.cellphone === '010-1234-5678' ? [{ member_id: 'mem1', available_points: '1000.00' }, { member_id: 'mem2', available_points: '0.00' }] : [] };
            return { customers: [] };
        },
        apiReq: async (m, p, body) => {
            calls.push([m, p, body]);
            if (failPost) { const e = new Error('x'); e.status = failPost; e.reason = 'cafe24 ' + failPost; throw e; }
            bal[body.request.member_id] = (bal[body.request.member_id] || 0) + Number(body.request.amount);
            return { points: { amount: body.request.amount + '.00', type: body.request.type } };
        },
    };
    const pool = { query: async (sql) => { if (/DELETE FROM agent_office_config/.test(sql)) delete cfg.cafe24_points_request; return { rows: [] }; } };
    const env = { RENDER: render ? '1' : undefined };
    const fn = new Function('cafe24', 'pool', 'naverCfgGet', 'naverCfgSet', 'writeAudit', 'VERSION', 'setInterval', 'process',
        body + '\nreturn null;');
    const origTimeout = global.setTimeout;
    fn(cafe24, pool, async k => cfg[k] == null ? null : cfg[k], async (k, v) => { cfg[k] = v; }, async x => audits.push(x), 'test',
        (f) => { tick = f; return 0; }, { env });
    return { cfg, calls, audits, bal, run: async req => { cfg.cafe24_points_request = req; global.setTimeout = (f) => origTimeout(f, 0); try { await tick(); } finally { global.setTimeout = origTimeout; } return cfg.cafe24_points_result; } };
}

(async () => {
    let h = harness();
    let r = await h.run({ rid: 'r1', action: 'grant', member_id: 'mem1', amount: 3000, reason: '배송 지연 보상', order_no: 9, requested_by: '직원' });
    ok('지급 = POST /points increase·문자열 금액·사유 · 전후 1000→4000 확인 · audit 1건', r.ok && r.grant.before === 1000 && r.grant.after === 4000 && r.grant.confirmed
        && h.calls.some(c => c[0] === 'POST' && c[1] === '/api/v2/admin/points' && c[2].request.type === 'increase' && c[2].request.amount === '3000' && c[2].shop_no === 1)
        && h.audits.length === 1 && h.audits[0].changes.after.amount === 3000 && !h.cfg.cafe24_points_request, JSON.stringify(r.grant));
    h = harness();
    for (const [req, why] of [
        [{ action: 'grant', member_id: 'mem1', amount: 50001, reason: 'x' }, '상한 초과'],
        [{ action: 'grant', member_id: 'mem1', amount: 0, reason: 'x' }, '0원'],
        [{ action: 'grant', member_id: 'mem1', amount: 1.5, reason: 'x' }, '소수'],
        [{ action: 'grant', member_id: 'mem1', amount: 100, reason: '' }, '사유 없음'],
        [{ action: 'grant', member_id: 'nobody', amount: 100, reason: 'x' }, '없는 회원'],
        [{ action: 'grant', member_id: 'a b', amount: 100, reason: 'x' }, '아이디 형식'],
        [{ action: 'decrease', member_id: 'mem1', amount: 100, reason: 'x' }, '차감 액션'],
    ]) {
        const n = h.calls.filter(c => c[0] === 'POST').length;
        const rr = await h.run(Object.assign({ rid: 'x' }, req));
        ok('거부: ' + why + ' → 지급 호출 0', rr.ok === false && h.calls.filter(c => c[0] === 'POST').length === n && !!rr.error, rr.error);
    }
    ok('거부 건 audit 0', h.audits.length === 0);
    h = harness({ lag: 2 });
    r = await h.run({ rid: 'r3', action: 'grant', member_id: 'mem1', amount: 500, reason: '보상' });
    ok('카페24 조회가 늦어도 재조회로 확인(1000→1500)', r.ok && r.grant.after === 1500 && r.grant.confirmed, JSON.stringify(r.grant));
    h = harness({ failPost: 403 });
    r = await h.run({ rid: 'r4', action: 'grant', member_id: 'mem1', amount: 500, reason: '보상' });
    ok('권한 없음(403) = 실패로 기록 · audit 0', r.ok === false && r.status === 403 && h.audits.length === 0, r.error);
    h = harness();
    r = await h.run({ rid: 'r5', action: 'lookup', cellphone: '01012345678' });
    ok('휴대폰 조회 = 하이픈 형식으로 · 한 번호 여러 계정 전부', r.ok && r.members.length === 2 && h.calls.some(c => c[2] && c[2].cellphone === '010-1234-5678'), JSON.stringify(r.members));
    r = await h.run({ rid: 'r6', action: 'lookup', member_id: 'mem1' });
    ok('아이디 조회 = 가용 적립금 숫자', r.ok && r.members[0].available_points === 1000);
    h = harness({ render: false });
    h.cfg.cafe24_points_request = { rid: 'r7', action: 'lookup', member_id: 'mem1' };
    await (async () => { const t = h; })();
    const hr = harness({ render: false });
    const rr = await hr.run({ rid: 'r7', action: 'lookup', member_id: 'mem1' });
    ok('실서버(RENDER)가 아니면 요청을 집지 않음(로컬 검증 서버가 먹지 않게)', rr === undefined && hr.cfg.cafe24_points_request && hr.calls.length === 0);
    const scope = fs.readFileSync(path.join(__dirname, '..', 'cafe24.js'), 'utf8');
    ok('앱 스코프에 적립금 읽기·쓰기 추가', /mall\.read_mileage/.test(scope) && /mall\.write_mileage/.test(scope));
    console.log(`\n결과 ${results.filter(Boolean).length}/${results.length}`);
    process.exit(results.every(Boolean) ? 0 : 1);
})();
