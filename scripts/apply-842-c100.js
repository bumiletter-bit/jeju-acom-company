// #842(대표 10/25): 자사몰 VIP(카페24 c100) — 하우스 선물 3kg → 타이벡 선물용 3kg(28,800) · 네이버 VIP 10801253976 기준이 33,500 → 28,800 으로 바뀐 것 맞추기
//   전제: 옵션값 「1. 고당도 타이벡감귤 · 선물용 - 3kg(로얄과 2S~M)」 은 관리자 화면에서 추가 끝(10/25 · 워커2 브라우저)
//   순서 = 추가금 먼저 올림(잠깐 비싸게) → 하우스 미노출 → 기본가 28,800(05:10 동기화 식 = 네이버 결제가 28,800 + 가장 싼 옵션 0 · minAdd 0 그대로)
//   node scripts/apply-842-c100.js          = 계획만(쓰기 0)
//   node scripts/apply-842-c100.js apply    = 실행 + audit · 되돌리기 = restore(기본가 33,500 · 황금향 5,300/22,300 · 하우스 T/T · 타이벡 F/F)
require('dotenv').config();
const { Client } = require('pg');
const CNO = 100;
const TABEK = '1. 고당도 타이벡감귤 · 선물용 - 3kg(로얄과 2S~M)', HOUSE = '2. 고당도 하우스감귤 · 하우스감귤 선물용 - 3kg(로얄과)';
const G3 = '1. 과즙팡팡 황금향 · 황금향 선물용 - 3kg(중대과 7~15과)', G5 = '1. 과즙팡팡 황금향 · 황금향 선물용 - 5kg(중대과 13~25과)';
const PLAN = { apply: { base: 28800, add: { [G3]: 10000, [G5]: 27000, [TABEK]: 0 }, show: { [HOUSE]: 'F', [TABEK]: 'T' } },
               restore: { base: 33500, add: { [G3]: 5300, [G5]: 22300 }, show: { [HOUSE]: 'T', [TABEK]: 'F' } } };
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
        const pr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${CNO}`, query: { fields: 'product_no,price,selling,display' } });
        const vr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${CNO}/variants` });
        const base = Math.round(Number(pr.raw.data.product.price));
        const vars = vr.raw.data.variants.map(v => ({ code: v.variant_code, name: nameOf(v), add: Math.round(Number(v.additional_amount)), selling: v.selling, display: v.display }));
        console.log(`c${CNO} 기본가 ${base}`); vars.forEach(v => console.log(`  ${v.code} ${v.selling}/${v.display} +${v.add} = ${base + v.add} | ${v.name}`));
        const P = PLAN[mode === 'restore' ? 'restore' : 'apply'];
        const by = n => vars.find(v => v.name === n);
        for (const n of [TABEK, HOUSE, G3, G5]) if (!by(n)) throw new Error('옵션 못 찾음: ' + n);
        const steps = [];
        for (const [n, a] of Object.entries(P.add)) if (by(n).add !== a) steps.push({ code: by(n).code, name: n, body: { additional_amount: String(a) } });
        for (const [n, t] of Object.entries(P.show)) if (by(n).selling !== t || by(n).display !== t) steps.push({ code: by(n).code, name: n, body: { selling: t, display: t } });
        steps.forEach(s => console.log(`  계획 ${s.code} ${JSON.stringify(s.body)} | ${s.name}`));
        if (base !== P.base) console.log(`  계획 기본가 ${base} → ${P.base}`);
        if (!mode) { console.log('계획만(쓰기 0) — apply 로 실행'); return; }
        for (const s of steps) { const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${CNO}/variants/${s.code}`, body: { shop_no: 1, request: s.body } }); console.log(`  PUT ${s.code} → ${putOk(r) ? 'ok' : '실패 ' + JSON.stringify(r).slice(0, 200)}`); if (!putOk(r)) throw new Error('멈춤'); }
        if (base !== P.base) { const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${CNO}`, body: { shop_no: 1, request: { price: String(P.base), supply_price: String(P.base) } } }); console.log(`  PUT 기본가 ${P.base} → ${putOk(r) ? 'ok' : '실패 ' + JSON.stringify(r).slice(0, 200)}`); }
        await c.query(`INSERT INTO audit_logs(action, target_type, target_id, changes, source, actor_name) VALUES($1,$2,$3,$4::jsonb,$5,$6)`, ['cafe24_variant_update', 'cafe24_product', String(CNO), JSON.stringify({ mode, base_before: base, base_after: P.base, steps }), 'script', '클코 워커2(#842 VIP 타이벡 선물 3kg)']).catch(e => console.log('audit 기록 실패:', e.message));
    } finally { await c.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
