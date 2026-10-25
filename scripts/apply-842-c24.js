// #842(대표 10/25 타이벡 오픈): 자사몰(카페24 c92) — 하우스감귤 옵션 6개 미노출(selling/display F) + audit
//   전제: 타이벡 옵션값 6개(P00000DO000Y·Z·BA·BB·BC·BD)는 관리자 화면에서 추가·추가금 저장 끝(10/25 · 워커2 브라우저)
//   node scripts/apply-842-c24.js          = 계획만(쓰기 0)
//   node scripts/apply-842-c24.js apply    = 하우스 6개 F/F · 되돌리기 = restore(T/T)
require('dotenv').config();
const { Client } = require('pg');
const CNO = 92;
const HOUSE = ['P00000DO000B', 'P00000DO000D', 'P00000DO000E', 'P00000DO000G', 'P00000DO000W', 'P00000DO000X'];
async function flag(c, req, ms = 150000) {
    await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await c.query(`INSERT INTO agent_office_config(key,value) VALUES('cafe24_product_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 4000)); const q = await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 응답 없음(타임아웃)');
}
const putOk = r => !!r && r.ok !== false && !!r.raw && r.raw.ok !== false && !(Number(r.raw.status) >= 400) && !(r.raw.data && r.raw.data.error);
const nameOf = v => (v.options || []).map(o => o.value).join(' / ');
(async () => {
    const mode = process.argv[2] || '';
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
    try {
        const vr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${CNO}/variants` });
        const vars = vr.raw.data.variants.map(v => ({ code: v.variant_code, name: nameOf(v), selling: v.selling, display: v.display }));
        const tgt = vars.filter(v => HOUSE.includes(v.code));
        if (tgt.length !== 6 || tgt.some(v => !/하우스감귤/.test(v.name))) throw new Error('하우스 6개를 못 찾음: ' + JSON.stringify(tgt));
        const want = mode === 'restore' ? 'T' : 'F';
        const todo = tgt.filter(v => v.selling !== want || v.display !== want);
        todo.forEach(v => console.log(`  ${v.code} ${v.selling}/${v.display} → ${want}/${want} | ${v.name}`));
        if (!mode) { console.log('계획만(쓰기 0) — apply 로 실행'); return; }
        for (const t of todo) { const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${CNO}/variants/${t.code}`, body: { shop_no: 1, request: { selling: want, display: want } } }); console.log(`  PUT ${t.code} → ${putOk(r) ? 'ok' : '실패 ' + JSON.stringify(r).slice(0, 200)}`); }
        await c.query(`INSERT INTO audit_logs(action, target_type, target_id, changes, source, actor_name) VALUES($1,$2,$3,$4::jsonb,$5,$6)`, ['cafe24_variant_update', 'cafe24_product', String(CNO), JSON.stringify({ mode, before: todo, to: want }), 'script', '클코 워커2(#842 타이벡 오픈 · 하우스 미노출)']).catch(e => console.log('audit 기록 실패:', e.message));
    } finally { await c.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
