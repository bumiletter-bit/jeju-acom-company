// #442: 상품 스냅샷 즉시 재수집 유도(last_run_at 되감기 → 60초 틱이 재수집) + 12957301776(대용량) 옵션이 새 정본(못난이 10kg)으로 바뀌었는지 확인
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
    const before = await pool.query(`SELECT id FROM naver_product_snapshot ORDER BY id DESC LIMIT 1`);
    const lastId = before.rows[0] ? before.rows[0].id : 0;
    await pool.query(`UPDATE naver_auto_collect SET last_run_at = last_run_at - interval '2 days' WHERE key = 'product_snapshot'`);
    console.log('되감기 완료 — 직전 스냅샷 id', lastId, '· 재수집 대기(최대 5분)');
    const t0 = Date.now(); let row = null;
    while (Date.now() - t0 < 300000) {
        await new Promise(r => setTimeout(r, 10000));
        const q = await pool.query(`SELECT id, total, note, items FROM naver_product_snapshot WHERE id > $1 ORDER BY id DESC LIMIT 1`, [lastId]);
        if (q.rows.length) { row = q.rows[0]; break; }
    }
    if (!row) throw new Error('5분 내 새 스냅샷 없음');
    console.log('새 스냅샷 id', row.id, '· total', row.total, '· note', row.note);
    const items = Array.isArray(row.items) ? row.items : JSON.parse(row.items);
    const it = items.find(x => String(x.no) === '12957301776');
    console.log('12957301776:', it ? JSON.stringify({ name: it.name, salePrice: it.salePrice, discPrice: it.discPrice, soldout: it.soldout, stock: it.stock, opts: it.opts }) : '없음');
    const okOpt = it && (it.opts || []).some(o => /못난이 - 10kg/.test(o.n2));
    console.log(okOpt ? '✅ 스냅샷에 못난이 10kg 옵션 반영' : '❌ 스냅샷 옵션 미반영');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
