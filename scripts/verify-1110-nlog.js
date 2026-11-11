/* #1110 검증 — 알림 발송 이력(/api/agent-office/notify-logs) 쿼리 바꾸기 전/후 대조
 *   실행: node scripts/verify-1110-nlog.js [--plan] [--quick]
 *   🔴 실DB 읽기만 = BEGIN READ ONLY 안에서 SELECT 만(쓰기 0 · 서버 안 띄움 · AI·발송 0)
 *   HEAD 의 server.js(종전)와 지금 server.js(새)에서 라우트의 「const filter = …」 ~ 목록 쿼리 끝 구간을 그대로 떼어
 *   같은 req.query 로 돌려 total · 줄 수 · 줄 내용(칸 이름·순서·값)까지 같은지 본다 · 한 번에 하나씩 · 걸린 시간 기록
 *   --plan = 갈래마다 새 쿼리 EXPLAIN 에 created_at 색인 스캔이 있는지 · 종전/새 EXPLAIN ANALYZE 실행 시간
 */
'use strict';
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { Pool } = require('pg');
const ROOT = path.join(__dirname, '..');
const norm = s => s.replace(/\r\n/g, '\n');
const OLD_SRC = norm(execSync('git show HEAD:server.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString());
const NEW_SRC = norm(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
function seg(src, endMark) {
    const a = src.indexOf("        const filter = String(req.query.filter || 'all');");
    const b = src.indexOf(endMark, a);
    if (a < 0 || b < 0) throw new Error('구간 없음: ' + endMark.slice(0, 30));
    return src.slice(a, src.indexOf('\n', b));
}
const OLD = seg(OLD_SRC, '/* 동일 시각 행의 순서 고정(타이브레이커) — 없으면 페이지 경계에서 중복·누락 발생 */');
const NEW = seg(NEW_SRC, 'for (const r of rows) delete r.nlog_n;') + '\n        }';   // 날짜 갈래(else) 닫는 괄호까지
if (OLD === NEW) throw new Error('종전과 새 구간이 같음(바꾼 게 없음)');
const AF = Object.getPrototypeOf(async function () {}).constructor;
const NLOG_DEFAULT_DAYS = 90;
const mk = (body) => new AF('pool', 'req', 'NLOG_DEFAULT_DAYS', body + '\nreturn { rows, total, defaultDays };');
const runOld = mk(OLD), runNew = mk(NEW);

const kst = (d) => new Date(Date.now() + 9 * 3600e3 - d * 86400e3).toISOString().slice(0, 10);
const today = kst(0), yday = kst(1), d7 = kst(6), d90 = kst(89);
const cases = [];
const add = (q) => cases.push(q);
for (const filter of ['all', 'issue', 'pending']) for (const ch of ['all', 'naver', 'c24', 'cp', 'join', 'coupon']) add({ filter, ch });
for (const filter of ['all', 'issue', 'pending']) for (const [from, to] of [[today, today], [yday, yday], [d7, today], [d90, today]]) add({ filter, ch: 'all', from, to });
for (const qv of ['4031', '010-6687-4031', '01066874031', '감귤', '타이벡', '12', '9']) { add({ filter: 'all', ch: 'all', q: qv }); add({ filter: 'all', ch: 'all', q: qv, from: d7, to: today }); }
add({ filter: 'issue', ch: 'naver', q: '4031' }); add({ filter: 'all', ch: 'cp', from: d7, to: today, q: '감귤' });
for (const offset of [100, 200, 1000]) add({ filter: 'all', ch: 'all', offset });
add({ filter: 'all', ch: 'all', from: today, to: today, offset: 100 }); add({ filter: 'all', ch: 'all', from: today, to: today, offset: 100000 });
add({ filter: 'all', ch: 'all', all: '1' }); add({ filter: 'issue', ch: 'all', all: '1' });
add({ filter: 'all', ch: 'all', from: '2026-08-01', to: '2026-08-31' }); add({ filter: 'all', ch: 'all', from: today, to: yday });
const QUICK = process.argv.includes('--quick'), PLAN = process.argv.includes('--plan') || process.argv.includes('--plan-only');

(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
    const cl = await pool.connect();
    let pass = 0, fail = 0; const times = [];
    try {
        await cl.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');   // 종전·새 쿼리가 같은 시점 자료를 보게(돌리는 사이 새 알림이 들어와 건수가 달라 보이는 것 막음)
        await cl.query("SET LOCAL statement_timeout = '180s'");
        const db = { query: (s, p) => cl.query(s, p) };
        const ONLY = (process.argv.find(a => a.startsWith('--cases=')) || '').slice(8);
        const list = ONLY ? JSON.parse(ONLY) : process.argv.includes('--plan-only') ? [] : (QUICK ? cases.slice(0, 6) : cases);
        for (const q0 of list) {
            const req = { query: Object.assign({ fast: '1', limit: '100' }, q0) };
            const t0 = Date.now(); const o = await runOld(db, req, NLOG_DEFAULT_DAYS); const t1 = Date.now();
            const n = await runNew(db, req, NLOG_DEFAULT_DAYS); const t2 = Date.now();
            const same = o.total === n.total && o.rows.length === n.rows.length && o.defaultDays === n.defaultDays
                && JSON.stringify(o.rows) === JSON.stringify(n.rows)
                && o.rows.every((r, i) => Object.keys(r).join() === Object.keys(n.rows[i]).join());
            same ? pass++ : fail++;
            const tag = JSON.stringify(q0);
            times.push({ tag, oldMs: t1 - t0, newMs: t2 - t1, total: n.total, shown: n.rows.length });
            console.log((same ? '  ✅ ' : '  ❌ ') + tag + ` total ${o.total}/${n.total} · 줄 ${o.rows.length}/${n.rows.length} · ${t1 - t0}ms → ${t2 - t1}ms`);
            if (!same) {
                const i = o.rows.findIndex((r, j) => JSON.stringify(r) !== JSON.stringify(n.rows[j]));
                console.log('     첫 다른 줄', i, JSON.stringify(o.rows[i] || null).slice(0, 300), '\n     ', JSON.stringify(n.rows[i] || null).slice(0, 300));
            }
            await new Promise(r => setTimeout(r, 300));
        }
        if (PLAN) {
            for (const q0 of [{ filter: 'all', ch: 'all', from: today, to: today }, { filter: 'all', ch: 'all' }, { filter: 'issue', ch: 'all', from: d7, to: today }, { filter: 'all', ch: 'all', q: '4031' }]) {
                for (const [nm, fn] of [['종전', runOld], ['새', runNew]]) {
                    const seen = [];
                    const spy = { query: (s, p) => { seen.push([s, p]); return cl.query(s, p); } };
                    await fn(spy, { query: Object.assign({ fast: '1', limit: '100' }, q0) }, NLOG_DEFAULT_DAYS);
                    let ms = 0, idx = [];
                    for (const [s, p] of seen) {
                        const ex = (await cl.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + s, p)).rows[0]['QUERY PLAN'][0];
                        ms += ex['Execution Time'];
                        const walk = (nd) => { if (/Index/.test(nd['Node Type']) && /created/.test(nd['Index Name'] || '')) idx.push(nd['Index Name']); (nd.Plans || []).forEach(walk); };
                        walk(ex.Plan);
                    }
                    console.log(`  [plan] ${nm} ${JSON.stringify(q0)} 쿼리 ${seen.length}개 · 실행 ${ms.toFixed(0)}ms · created 색인 ${[...new Set(idx)].join(', ') || '없음'}`);
                }
            }
        }
    } finally { await cl.query('ROLLBACK').catch(() => {}); cl.release(); await pool.end(); }
    const sum = (k) => times.reduce((a, x) => a + x[k], 0);
    console.log(`\n#1110 대조: ${pass}/${pass + fail} 같음 · 걸린 시간 합 종전 ${sum('oldMs')}ms → 새 ${sum('newMs')}ms`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
