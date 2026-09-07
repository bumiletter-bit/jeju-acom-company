// #428(대표 9/7 "네이버랑 자사몰 귤 단가 변경 — 스토어 적용가로 매칭"): 카페24 결제가 = 네이버 실시간 결제가 (#426 절차)
//   네이버 정본(9/7 origin/channel 직접 조회): c92 기준가 29,000 · c100(VIP) 기준가 33,500(종전 37,800 → 하우스감귤 선물 3kg 인하) · c94 무변경
//   대상 = 어긋난 것만: c92 선물용3kg로얄 38,800→34,500 · 가정용4.5kg로얄 51,800→48,800 / c100 기본가 37,800→33,500 + variants 재계산(황금향 3kg 41,800·5kg 60,800·감귤선물3kg 33,500 결제가 유지)
//   ⚠️ 카페24 GET ~1분 캐시 → PUT 후 70초 대기 재검산. 실행 후 반드시 node scripts/audit-400-priceset.js.
require('dotenv').config();
const { Client } = require('pg');
async function flag(c, req, ms = 120000) {
    await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await c.query(`INSERT INTO agent_office_config(key,value) VALUES('cafe24_product_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 4000)); const q = await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) return q.rows[0].value; }
    throw new Error('timeout');
}
// 목표 결제가(네이버 9/7 실시간) — 기본가는 네이버 최저 결제가(minAdd 0 규칙과 동일 결과)
const PLAN = {
    92: { base: 23800, vars: { P00000DO000D: 34500, P00000DO000E: 48800 } },            // 변경 2종만 PUT (나머지 8종은 이미 일치 — 무접촉)
    100: { base: 33500, vars: { P00000DW000B: 41800, P00000DW000C: 60800, P00000DW000D: 33500 } },
};
(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const before = {};
    for (const [cno, p] of Object.entries(PLAN)) {
        const pr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}`, query: { fields: 'product_no,price' } });
        const curBase = Math.round(Number(pr.raw.data.product.price));
        const vr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}/variants` });
        before[cno] = { base: curBase, vars: Object.fromEntries(vr.raw.data.variants.map(v => [v.variant_code, curBase + Number(v.additional_amount)])) };
        if (curBase !== p.base) {
            const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${cno}`, body: { shop_no: 1, request: { price: String(p.base), supply_price: String(p.base) } } });
            console.log(`c${cno} 기본가 ${curBase}→${p.base}`, r.raw && r.raw.status < 300 ? '✅' : JSON.stringify(r).slice(0, 200));
        } else console.log(`c${cno} 기본가 ${curBase} 유지`);
        for (const [code, pay] of Object.entries(p.vars)) {
            const add = pay - p.base;
            const cur = before[cno].vars[code];
            const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${cno}/variants/${code}`, body: { shop_no: 1, request: { additional_amount: String(add) } } });
            const ok = (r.raw && r.raw.status < 300) || /additional_amount/.test(JSON.stringify(r));
            console.log(ok ? '✅' : '❌', `c${cno} ${code} 결제가 ${cur}→${pay} (추가금 ${add})`, ok ? '' : JSON.stringify(r).slice(0, 200));
        }
    }
    console.log('… 카페24 캐시 대기 75초');
    await new Promise(r => setTimeout(r, 75000));
    let bad = 0;
    for (const [cno, p] of Object.entries(PLAN)) {
        const pr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}`, query: { fields: 'product_no,price' } });
        const base = Math.round(Number(pr.raw.data.product.price));
        const vr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}/variants` });
        for (const v of vr.raw.data.variants) {
            const pay = base + Number(v.additional_amount);
            const want = p.vars[v.variant_code] != null ? p.vars[v.variant_code] : before[cno].vars[v.variant_code];   // 미대상 = 종전 결제가 유지 검산
            const ok = pay === want; if (!ok) bad++;
            console.log(ok ? '✅' : '❌', `c${cno}`, v.variant_code, v.options[0].value.slice(-24), '결제가', pay, '목표', want);
        }
        if (base !== p.base) { bad++; console.log('❌ 기본가', base, '≠', p.base); }
    }
    await c.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name,created_at) VALUES('update','cafe24_product','92,100',$1,'cafe24-api','클코(대표 GO — #428 귤 단가 네이버 정합)',NOW())`,
        [JSON.stringify({ before, after: PLAN, note: '#428 네이버 9/7 실시간 결제가로 카페24 정합(c92 2종·c100 기본가+3종)' })]).catch(e => console.log('audit skip', e.message));
    console.log(bad ? `❌ 불일치 ${bad}` : '✅ c92·c100 전 variant 결제가 = 목표 일치');
    await c.end();
    process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(2); });
