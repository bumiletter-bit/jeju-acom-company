// #1120 배송 자동 재조회(하루 1회) + 직원 화면 「확인 필요」 표시 검증 — 실코드를 떼어 실행(가짜 pool·가짜 CJ · 실DB·실제 CJ 호출 0)
//   ① server.js deliveryAutoCfg·deliveryAutoDue·deliveryAutoRun(대상 고르기 SQL 조건·상한·하루 1회·3연속 실패 멈춤·수동 조회 중 건너뜀·끄기)
//   ② sms/index.js staffStatusText(7일 넘은 배송 중 꼴 = 「확인 필요 · M/D 마지막 확인」 · 7일 안·완료·미조회 = 종전 글자)
//   실행: node scripts/verify-1120-delivery.js
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (!c && d != null ? ' — ' + String(d).slice(0, 300) : '')); };
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = srv.indexOf('const DELIVERY_AUTO_DEF'), b = srv.indexOf('let _deliveryAutoBusy');
const deliveryNoTestSql = alias => ` AND ${alias ? alias + '.' : ''}tracking NOT LIKE '9996%'`;
const M = new Function('deliveryNoTestSql', srv.slice(a, b) + '\nreturn { deliveryAutoCfg, deliveryAutoDue, deliveryAutoRun, DELIVERY_AUTO_SQL, DELIVERY_AUTO_DEF };')(deliveryNoTestSql);
const smsSrc = fs.readFileSync(path.join(__dirname, '..', 'sms', 'index.js'), 'utf8');
const s0 = smsSrc.indexOf('    function staffStatusText('), s1 = smsSrc.indexOf('\n    async function staffHistoryRead', s0);
const staffStatusText = new Function(smsSrc.slice(s0, s1) + '\nreturn staffStatusText;')();
const KST = ms => new Date(ms + 9 * 3600e3).toISOString();
const at = (day, hm) => Date.parse(day + 'T' + hm + ':00+09:00');
(async () => {
    console.log('① 설정·차례');
    ok(a > 0 && b > a && s0 > 0, '실코드 떼어 옴(server.js · sms/index.js)');
    const c0 = M.deliveryAutoCfg(null);
    ok(c0.enabled === true && c0.at === '05:30' && c0.max === 3000, '설정 없음 = 켬 · 05:30 · 3,000건', JSON.stringify(c0));
    ok(M.deliveryAutoCfg({ enabled: false }).enabled === false && M.deliveryAutoCfg({ at: '25:00', max: 0 }).at === '05:30' && M.deliveryAutoCfg({ max: 0 }).max === 3000 && M.deliveryAutoCfg({ at: '06:10', max: 500 }).max === 500, '끄기 = enabled false · 틀린 시각·상한 = 기본값');
    ok(!M.deliveryAutoDue(c0, null, at('2026-11-12', '05:29')) && M.deliveryAutoDue(c0, null, at('2026-11-12', '05:30')) && M.deliveryAutoDue(c0, { day: '2026-11-11' }, at('2026-11-12', '13:00')), '05:30 전 = 안 돎 · 지나면 돎(늦게 켜진 서버도 그날 한 번)');
    ok(!M.deliveryAutoDue(c0, { day: '2026-11-12' }, at('2026-11-12', '05:31')) && !M.deliveryAutoDue({ ...c0, enabled: false }, null, at('2026-11-12', '06:00')), '오늘 기록 있으면 안 돎 · 끄면 안 돎');
    console.log('② SQL 조건');
    const q = M.DELIVERY_AUTO_SQL;
    ok(/- 14\) AND \(\(now\(\) AT TIME ZONE 'Asia\/Seoul'\)::date - 2\)/.test(q) && /t\.tracking IS NULL OR t\.delivered IS NOT TRUE/.test(q) && /checked_at < now\(\) - interval '12 hours'/.test(q) && /NOT LIKE '9996%'/.test(q) && /ORDER BY t\.checked_at NULLS FIRST/.test(q) && /LIMIT \$1/.test(q), '대상 = 발송 2~14일 · 완료 아님(미조회 포함) · 12시간 지난 줄 · 시험 송장 뺌 · 오래 확인 안 한 줄부터 · 상한');
    console.log('③ 한 번 돌리기(가짜 pool·CJ)');
    const mk = (n, opt) => {
        const store = {}; const ups = []; const qs = [];
        const d = { nowMs: at('2026-11-12', '05:31'), busy: () => !!(opt && opt.busy),
            pool: { query: async (sql, args) => { qs.push({ sql, args }); return { rows: Array.from({ length: Math.min(n, args[0]) }, (_, i) => ({ tracking: String(600000000000 + i) })) }; } },
            cfgGet: async k => store[k] === undefined ? null : store[k], cfgSet: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
            upsert: async k => { ups.push(k.tracking); },
            track: async (list, o) => { let fr = 0, asked = 0; for (const t of list) { asked++; const bad = opt && opt.failFrom != null && asked > opt.failFrom; const k = { tracking: t, bucket: bad ? '조회실패' : (asked % 2 ? '배송완료' : '배송출발'), delivered: !bad && asked % 2 === 1 }; await o.onEach(k); if (bad) { if (++fr >= 3) return { asked, stopped: { asked, of: list.length, why: '시험 실패' } }; } else fr = 0; } return { asked }; } };
        if (opt && opt.cfg) store.delivery_auto = opt.cfg;
        return { d, store, ups, qs };
    };
    { const x = mk(10); const r = await M.deliveryAutoRun(x.d);
      ok(r.ran && r.state === 'done' && r.total === 10 && r.done === 10 && r.delivered === 5 && x.ups.length === 10 && x.store.delivery_auto_last.day === '2026-11-12' && x.qs[0].args[0] === 3000, '10건 = 10건 조회·저장 · 배송완료 5 · 기록 day 오늘 · 상한 3,000 을 SQL 에 넘김', JSON.stringify(r));
      const r2 = await M.deliveryAutoRun(x.d); ok(!r2.ran && x.ups.length === 10, '같은 날 두 번째 틱 = 안 돎(하루 1회)'); }
    { const x = mk(5000); const r = await M.deliveryAutoRun(x.d); ok(r.total === 3000 && x.ups.length === 3000, '대상 5,000 → 상한 3,000 만(나머지는 다음 날 = 오래 확인 안 한 줄부터라 이어짐)', r.total); }
    { const x = mk(5000, { cfg: { max: 200 } }); const r = await M.deliveryAutoRun(x.d); ok(r.total === 200, '설정 max 200 = 200건', r.total); }
    { const x = mk(50, { failFrom: 4 }); const r = await M.deliveryAutoRun(x.d); ok(r.state === 'stopped' && r.done === 7 && /연속 조회 실패로 멈춤\(7\/50/.test(r.error) && x.store.delivery_auto_last.state === 'stopped', '연속 3건 실패 = 멈춤(7/50) · 기록 stopped · 같은 날 다시 안 돎', JSON.stringify(r));
      ok(x.ups.length === 4 && r.failed === 3, '조회실패 3건 = 저장 안 함(좋은 옛 값을 덮지 않음 · 다음 날 다시) · 성공 4건만 저장', JSON.stringify({ ups: x.ups.length, failed: r.failed })); }
    { const x = mk(10, { busy: true }); const r = await M.deliveryAutoRun(x.d); ok(!r.ran && r.busy && x.ups.length === 0 && !x.store.delivery_auto_last, '수동 [배송조회] 도는 중 = 건너뜀(기록 0 · 다음 틱에 다시)'); }
    { const x = mk(10, { cfg: { enabled: false } }); const r = await M.deliveryAutoRun(x.d); ok(!r.ran && x.ups.length === 0 && x.qs.length === 0, '끔(enabled false) = 조회·DB 읽기 0'); }
    { const x = mk(0); const r = await M.deliveryAutoRun(x.d); ok(r.ran && r.state === 'done' && r.total === 0, '대상 0 = done · 조회 0'); }
    { const x = mk(10); x.d.pool.query = async () => { throw new Error('DB 끊김'); }; const r = await M.deliveryAutoRun(x.d); ok(r.state === 'error' && /DB 끊김/.test(r.error) && x.store.delivery_auto_last.day === '2026-11-12', 'DB 오류 = error 기록(그날 다시 안 돎 · 다음 날 다시)'); }
    console.log('④ 직원 화면 글자');
    const today = KST(Date.now()).slice(0, 10), dAgo = n => KST(Date.now() - n * 86400e3).slice(0, 10);
    const chk = new Date(Date.parse(dAgo(3) + 'T10:00:00+09:00')).toISOString(), md = (() => { const x = new Date(Date.parse(dAgo(3) + 'T10:00:00+09:00') + 9 * 3600e3); return (x.getUTCMonth() + 1) + '/' + x.getUTCDate(); })();
    const T = [
        [['배송출발', dAgo(3), false, chk], '배송 중 · 배송 출발'], [['배송출발', dAgo(7), false, chk], '배송 중 · 배송 출발'], [['배송출발', dAgo(8), false, chk], '확인 필요 · ' + md + ' 마지막 확인'],
        [['간선상하차', dAgo(20), false, chk], '확인 필요 · ' + md + ' 마지막 확인'], [['집화', dAgo(9), false, null], '확인 필요'], [['배송완료', dAgo(30), true, chk], '배송완료'],
        [['배송출발', dAgo(30), true, chk], '배송완료'], [[null, dAgo(20), false, null], '조회 안 됨'], [[null, dAgo(1), false, null], '배송 중 · 집화 전'], [['미배송', dAgo(20), false, chk], '미배송'],
        [['간선상하차', dAgo(2), false, chk], '배송 중 · 이동'], [['배송출발', today, false], '배송 중 · 배송 출발'], [['사고', dAgo(10), false, chk], '사고'],
    ];
    const bad = T.filter(([a2, w]) => staffStatusText(...a2) !== w).map(([a2, w]) => JSON.stringify(a2) + ' → ' + staffStatusText(...a2) + ' (기대 ' + w + ')');
    ok(!bad.length, '13 경우 = 7일 안·완료·미조회·미배송·사고 종전 글자 · 8일↑ 배송 중 꼴 = 「확인 필요 · M/D 마지막 확인」', bad.join(' | '));
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();
