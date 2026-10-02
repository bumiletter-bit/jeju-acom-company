// #498 창구용 조회 도우미 — 읽기 전용 SQL 한 번에(스크립트를 새로 쓰느라 드는 시간을 줄인다)
// 사용: node scripts/desk/q.js "SELECT ..."          (한 문장 · SELECT / WITH 만)
//       node scripts/desk/q.js --file 조회.sql
//       node scripts/desk/q.js --cols 테이블이름      (컬럼 이름·형 보기)
// 읽기 전용 트랜잭션으로 돌아 값을 바꾸는 문장은 DB가 거절한다. 300행까지만 내준다.
const fs = require('fs');
const { pool } = require('./_db');
(async () => {
    const a = process.argv.slice(2);
    let sql;
    if (a[0] === '--cols') {
        if (!/^[a-z_][a-z0-9_]*$/i.test(a[1] || '')) throw new Error('테이블 이름을 적어 주세요');
        sql = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${a[1]}' ORDER BY ordinal_position`;
    } else if (a[0] === '--file') sql = fs.readFileSync(a[1], 'utf8');
    else sql = a.join(' ');
    sql = String(sql || '').trim().replace(/;\s*$/, '');
    if (!sql) throw new Error('사용: q.js "SELECT ..."');
    if (!/^(select|with)\b/i.test(sql)) throw new Error('조회(SELECT·WITH)만 됩니다 — 값을 바꾸는 일은 이 도구로 하지 않습니다');
    if (sql.includes(';')) throw new Error('한 번에 한 문장만 됩니다');
    const c = await pool.connect();
    try {
        await c.query('BEGIN READ ONLY');
        await c.query(`SET LOCAL statement_timeout = '20s'`);
        const r = await c.query(sql);
        const rows = r.rows.slice(0, 300);
        console.log(JSON.stringify({ rows: rows.length, total: r.rowCount, cut: r.rowCount > rows.length, data: rows }, null, 1));
    } finally { try { await c.query('ROLLBACK'); } catch (e) { /* 무시 */ } c.release(); }
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
