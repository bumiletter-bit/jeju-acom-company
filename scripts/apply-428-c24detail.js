// #428(대표 9/7 "선물용 상세페이지 변경 — 모두 긁어와줘"): 네이버 상세 스냅샷(9/7 09:12 전량 재수집) → 카페24 description 19종 이관
//   러너 = cafe24_product_request {action:'bulk-detail', map} (server.js #246 B안 — 이미지 CDN 참조+no-referrer·텍스트 블록 스타일 동봉). #399와 동일 절차.
require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');
const MAP = JSON.parse(fs.readFileSync('_참고자료/카페24스킨백업/scripts/c24-map-new-246.json', 'utf8')).map;
(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const snap = (await c.query(`SELECT value->>'at' AS at FROM agent_office_config WHERE key='product_detail_snapshot'`)).rows[0];
    console.log('상세 스냅샷', snap.at, '| 매핑', Object.keys(MAP).length + '종');
    if (Date.now() - new Date(snap.at).getTime() > 3 * 3600 * 1000) throw new Error('상세 스냅샷 3시간 초과 — 재수집 후 실행');
    await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await c.query(`INSERT INTO agent_office_config(key,value) VALUES('cafe24_product_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify({ action: 'bulk-detail', map: MAP })]);
    const t0 = Date.now(); let res = null;
    while (Date.now() - t0 < 240000) {
        await new Promise(r => setTimeout(r, 5000));
        const q = await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`);
        if (q.rows.length) { res = q.rows[0].value; break; }
    }
    if (!res) throw new Error('러너 타임아웃');
    const rows = res.detail || [];
    let okN = 0, bad = [];
    for (const r of rows) { if (r.ok) okN++; else bad.push(r); console.log(r.ok ? '  ✅' : '  ❌', `c${r.c24_no}(n${r.naver_no})`, r.ok ? `${r.blocks}블록 ${r.kb}KB` : (r.skip || r.error)); }
    await c.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name,created_at) VALUES('update','cafe24_product',NULL,$1,'cafe24-api','클코(대표 지시 #428 — 상세 전량 이관)',NOW())`,
        [JSON.stringify({ snapshot_at: snap.at, results: rows })]).catch(e => console.log('audit skip', e.message));
    console.log(bad.length ? `❌ 실패 ${bad.length}/${rows.length}` : `✅ 카페24 상세 ${okN}/${rows.length} 성공`);
    await c.end();
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
