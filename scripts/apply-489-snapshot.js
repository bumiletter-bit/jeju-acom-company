// #489: 오픈 당일 상품 스냅샷 즉시 재수집 유도(last_run_at 되감기 → 60초 틱) + 신규 3품목(유라조생·레몬·레드키위)의 네이버 실옵션 문자열 출력
//   node scripts/apply-489-snapshot.js [검색어,검색어]  (기본: 레몬,키위,노지,유라)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const KEYS = (process.argv[2] || '레몬,키위,노지,유라').split(',');
const WAIT_AFTER = parseInt(process.argv[3] || '', 10); // 'wait' 모드: 이 id보다 큰 스냅샷만 기다림(되감기 없음 — 이미 되감았을 때)
(async () => {
    let lastId;
    if (Number.isFinite(WAIT_AFTER)) { lastId = WAIT_AFTER; console.log('되감기 생략 — id', lastId, '이후 스냅샷 대기(최대 6분)'); }
    else {
        const before = await pool.query(`SELECT id FROM naver_product_snapshot ORDER BY id DESC LIMIT 1`);
        lastId = before.rows[0] ? before.rows[0].id : 0;
        await pool.query(`UPDATE naver_auto_collect SET last_run_at = last_run_at - interval '2 days' WHERE key = 'product_snapshot'`);
        console.log('되감기 완료 — 직전 스냅샷 id', lastId, '· 재수집 대기(최대 6분)');
    }
    const t0 = Date.now(); let row = null;
    while (Date.now() - t0 < 360000) {
        await new Promise(r => setTimeout(r, 10000));
        const q = await pool.query(`SELECT id, total, note, items, run_at + interval '9 hours' AS k FROM naver_product_snapshot WHERE id > $1 ORDER BY id DESC LIMIT 1`, [lastId]);
        if (q.rows.length) { row = q.rows[0]; break; }
    }
    if (!row) throw new Error('6분 내 새 스냅샷 없음');
    console.log('새 스냅샷 id', row.id, '· total', row.total, '· note', row.note, '·', row.k);
    const items = Array.isArray(row.items) ? row.items : JSON.parse(row.items);
    for (const it of items) {
        const hay = String(it.name || '') + ' ' + JSON.stringify(it.opts || []);
        if (!KEYS.some(k => hay.includes(k))) continue;
        console.log(`\n■ ${it.no} ${it.name} | status ${it.statusType || ''} soldout ${it.soldout} stock ${it.stock} | sale ${it.salePrice} disc ${it.discPrice}`);
        for (const o of (it.opts || [])) console.log(`   - ${[o.n1, o.n2, o.n3].filter(Boolean).join(' / ')} | +${o.add ?? o.price ?? ''} | ${o.usable === false ? '판매X' : 'ok'} | stock ${o.stock ?? ''}`);
    }
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
