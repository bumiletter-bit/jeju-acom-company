// #1113-1 검증 — 에이전트 오피스 현황판 「채널별 주문」 쿼리 종전/새 대조(실DB · 한 스냅샷 READ ONLY · SELECT 만 · EXPLAIN ANALYZE 로 색인·시간)
//   실행: node scripts/verify-1113-board.js
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const OLD = `SELECT CASE WHEN order_key LIKE 'c24:%' THEN 'mall' WHEN order_key LIKE 'cp:%' THEN 'coupang' ELSE 'naver' END AS ch,
       COUNT(*) FILTER (WHERE (COALESCE(order_at, created_at) + interval '9 hours')::date = (NOW() + interval '9 hours')::date)::int AS today,
       COUNT(*) FILTER (WHERE (COALESCE(order_at, created_at) + interval '9 hours')::date = (NOW() + interval '9 hours')::date - 1)::int AS yesterday
FROM kakao_notify_log WHERE order_key NOT LIKE 'join:%' AND order_key NOT LIKE 'coupon%' AND COALESCE(order_at, created_at) > NOW() - interval '3 days' GROUP BY 1 ORDER BY 1`;
const NEW = OLD.replace(`AND COALESCE(order_at, created_at) > NOW()`, `AND created_at > NOW() - interval '3 days' AND COALESCE(order_at, created_at) > NOW()`);
(async () => {
    if (OLD === NEW) throw new Error('바꿀 자리 없음');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
    const cl = await pool.connect(); let fail = 0;
    try {
        await cl.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const a = (await cl.query(OLD)).rows, b = (await cl.query(NEW)).rows;
        const same = JSON.stringify(a) === JSON.stringify(b); if (!same) fail++;
        console.log((same ? '  ✅' : '  ❌') + ' 결과 같음 ' + JSON.stringify(b));
        const ahead = (await cl.query(`SELECT count(*)::int n FROM kakao_notify_log WHERE order_at > created_at`)).rows[0].n;
        console.log((ahead === 0 ? '  ✅' : '  ❌') + ' order_at > created_at 줄 = ' + ahead + '(0 이어야 앞 조건이 같은 뜻)'); if (ahead) fail++;
        for (const [nm, sql] of [['종전', OLD], ['새', NEW]]) {
            const ex = (await cl.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + sql)).rows[0]['QUERY PLAN'][0];
            const idx = []; const walk = n => { if (/Index/.test(n['Node Type'])) idx.push(n['Index Name']); (n.Plans || []).forEach(walk); }; walk(ex.Plan);
            console.log(`  [plan] ${nm} 실행 ${ex['Execution Time'].toFixed(0)}ms · 색인 ${[...new Set(idx)].join(', ') || '없음(표 통째)'}`);
        }
    } finally { await cl.query('ROLLBACK').catch(() => {}); cl.release(); await pool.end(); }
    console.log(fail ? '\n결과: 실패 ' + fail : '\n결과: 통과');
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
