// #489(대표 GO 10/1 「자사몰도 네이버와 같게 · 결제창까지 금액 확인」): 카페24 결제가 = 네이버 실시간 결제가(#426·#428 절차)
//   node scripts/apply-489-c24price.js <c24no>   (92 = 감귤+유라 · 105 = 레몬)
//   기본가 = 네이버 최저 결제가 · 각 variant 추가금 = 네이버 결제가 − 기본가 · cafe24_sync_map minAdd 갱신(안 하면 다음날 05:10 sync가 기본가를 되돌림 — #400 함정)
//   ⚠️ 카페24 GET ~1분 캐시 → PUT 후 75초 대기 재검산. 실행 후 반드시 node scripts/audit-400-priceset.js.
require('dotenv').config();
const { Client } = require('pg');
async function flag(c, req, ms = 120000) {
    await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await c.query(`INSERT INTO agent_office_config(key,value) VALUES('cafe24_product_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 4000)); const q = await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('timeout');
}
// 목표 결제가 = 네이버 스냅샷 #87(10/1 09:15) disc + 옵션 증감 · 카페24 옵션 텍스트(n1 · n2) 기준
const PLAN = {
    92: { naver: '6400134206', base: 14800, pay: {
        '1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 2.5kg(로얄과)': 29000,
        '1. (제철)고당도 하우스감귤 · (특가)하우스감귤 가정용 - 2.5kg(소과)': 23800,
        '1. (제철)고당도 하우스감귤 · 하우스감귤 선물용 - 3kg(로얄과)': 34500,
        '1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 4.5kg(로얄과)': 48800,
        '1. (제철)고당도 하우스감귤 · (특가)하우스감귤 가정용 - 4.5kg(소과)': 39800,
        '1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 4.5kg(중대과)': 41800,
        '2. (제철)과즙팡팡 황금향 · 황금향 가정용 - 3kg(중소과 17과 전후)': 33500,
        '2. (제철)과즙팡팡 황금향 · 황금향 가정용 - 5kg(중소과 27과 전후)': 57800,
        '2. (제철)과즙팡팡 황금향 · 황금향 선물용 - 3kg(중대과 7~15과)': 42800,
        '2. (제철)과즙팡팡 황금향 · 황금향 선물용 - 5kg(중대과 13~25과)': 62800,
        '2. (제철)과즙팡팡 황금향 · 황금향 못난이 - 5kg(랜덤과)': 37800,
        '2. (제철)유라품종 노지감귤 · 가정용 - 3kg(로얄과 2S~M)': 16800,
        '2. (제철)유라품종 노지감귤 · 가정용 - 3kg(소과 2S미만)': 15800,
        '2. (제철)유라품종 노지감귤 · 가정용 - 3kg(중대과 L이상)': 14800,
        '2. (제철)유라품종 노지감귤 · 가정용 - 5kg(로얄과 2S~M)': 23800,
        '2. (제철)유라품종 노지감귤 · 가정용 - 5kg(소과 2S미만)': 21800,
        '2. (제철)유라품종 노지감귤 · 가정용 - 5kg(중대과 L이상)': 19800,
        '2. (제철)유라품종 노지감귤 · 가정용 - 10kg(로얄과 2S~M)': 34800,
        '2. (제철)유라품종 노지감귤 · 가정용 - 10kg(소과 2S미만)': 31800,
        '2. (제철)유라품종 노지감귤 · 가정용 - 10kg(중대과 L이상)': 29800,
    }, naverDisc: 29000 },
    105: { naver: '5531798664', base: 36800, pay: {
        // #489-b(대표 10/1 10:00 네이버 개명 「그린레몬」 — 손님 혼동 방지). 옵션 텍스트는 네이버 n1과 글자 단위 동일해야 원터치 담기(#428)
        '제주 그린레몬5kg(중소과)': 55600,
        '제주 그린레몬3kg(중소과)': 36800,
        '제주 그린레몬10kg(중소과)': 94600,
    // 카페24는 옵션값 이름 변경이 저장 단계에서 거부됨(10/1 실측 「상품 수정 처리를 실패」) → 새 이름을 새 옵션으로 추가하고 옛 것은 미노출(jeju-option-sync-playbook 규칙)
    }, hide: ['제주 레몬5kg(혼합과)', '제주 레몬3kg(혼합과)', '제주 레몬10kg(혼합과)', '제주 못난이 레몬5kg(랜덤과)', '제주 못난이 레몬10kg(랜덤과)', '제주 레몬5kg(중소과)', '제주 레몬3kg(중소과)', '제주 레몬10kg(중소과)'], selling: 'T', naverDisc: 55600 },
};
(async () => {
    const cno = String(process.argv[2] || '');
    const p = PLAN[cno]; if (!p) throw new Error('대상 c24 번호 필요: ' + Object.keys(PLAN).join('/'));
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const pr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}`, query: { fields: 'product_no,price,selling,display' } });
    const curBase = Math.round(Number(pr.raw.data.product.price));
    const vr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}/variants` });
    const vars = vr.raw.data.variants;
    const before = { base: curBase, selling: pr.raw.data.product.selling, vars: Object.fromEntries(vars.map(v => [v.variant_code, { name: v.options[0].value, pay: curBase + Number(v.additional_amount), selling: v.selling, display: v.display }])) };
    // 선검사: 목표 옵션 전부 카페24에 있어야 한다(없으면 중단 — 관리자에서 먼저 추가/개명)
    const missing = Object.keys(p.pay).filter(n => !vars.some(v => v.options[0].value === n));
    if (missing.length) { console.log('❌ 카페24에 없는 옵션:', missing); process.exit(1); }
    const extra = vars.filter(v => !p.pay[v.options[0].value] && !(p.hide || []).includes(v.options[0].value)).map(v => v.options[0].value);
    if (extra.length) { console.log('❌ 계획에 없는 카페24 옵션(판단 필요):', extra); process.exit(1); }
    if (curBase !== p.base) {
        const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${cno}`, body: { shop_no: 1, request: { price: String(p.base), supply_price: String(p.base), ...(p.selling ? { selling: p.selling } : {}) } } });
        console.log(`c${cno} 기본가 ${curBase}→${p.base}${p.selling ? ' · selling ' + p.selling : ''}`, r.raw && r.raw.status < 300 ? '✅' : JSON.stringify(r).slice(0, 200));
    } else if (p.selling && pr.raw.data.product.selling !== p.selling) {
        const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${cno}`, body: { shop_no: 1, request: { selling: p.selling } } });
        console.log(`c${cno} selling → ${p.selling}`, r.raw && r.raw.status < 300 ? '✅' : JSON.stringify(r).slice(0, 200));
    } else console.log(`c${cno} 기본가 ${curBase} 유지`);
    for (const v of vars) {
        const name = v.options[0].value;
        if ((p.hide || []).includes(name)) {
            if (v.selling === 'F' && v.display === 'F') { console.log('·', v.variant_code, name, '이미 미노출'); continue; }
            const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${cno}/variants/${v.variant_code}`, body: { shop_no: 1, request: { selling: 'F', display: 'F' } } });
            console.log((r.raw && r.raw.status < 300) ? '✅' : '❌', `c${cno} ${v.variant_code} ${name} → 미노출(판매X·진열X)`); continue;
        }
        const pay = p.pay[name]; const add = pay - p.base; const cur = before.vars[v.variant_code].pay;
        if (cur === pay && curBase === p.base) { console.log('·', v.variant_code, name.slice(-22), '결제가', pay, '유지'); continue; }
        const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${cno}/variants/${v.variant_code}`, body: { shop_no: 1, request: { additional_amount: String(add), selling: 'T', display: 'T' } } });
        const ok = (r.raw && r.raw.status < 300) || /additional_amount/.test(JSON.stringify(r));
        console.log(ok ? '✅' : '❌', `c${cno} ${v.variant_code} ${name.slice(-26)} 결제가 ${cur}→${pay} (추가금 ${add})`, ok ? '' : JSON.stringify(r).slice(0, 200));
    }
    // sync 매핑 minAdd = 기본가 − 네이버 disc (안 하면 05:10 sync가 기본가를 옛 규칙으로 되돌림)
    const mapRow = (await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_sync_map'`)).rows[0];
    const map = mapRow.value; const prevMin = map.map[p.naver] ? map.map[p.naver].minAdd : null;
    map.map[p.naver] = { c24: Number(cno), minAdd: p.base - p.naverDisc };
    await c.query(`UPDATE agent_office_config SET value=$1::jsonb, updated_at=NOW() WHERE key='cafe24_sync_map'`, [JSON.stringify(map)]);
    console.log(`sync 매핑 ${p.naver} → c${cno} minAdd ${prevMin} → ${p.base - p.naverDisc}`);
    console.log('… 카페24 캐시 대기 75초');
    await new Promise(r => setTimeout(r, 75000));
    let bad = 0;
    const pr2 = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}`, query: { fields: 'product_no,price,selling' } });
    const base = Math.round(Number(pr2.raw.data.product.price));
    const vr2 = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}/variants` });
    for (const v of vr2.raw.data.variants) {
        const name = v.options[0].value;
        if ((p.hide || []).includes(name)) { const ok = v.selling === 'F' && v.display === 'F'; if (!ok) bad++; console.log(ok ? '✅' : '❌', v.variant_code, name, '미노출'); continue; }
        const pay = base + Number(v.additional_amount); const ok = pay === p.pay[name] && v.selling === 'T'; if (!ok) bad++;
        console.log(ok ? '✅' : '❌', `c${cno}`, v.variant_code, name.slice(-26), '결제가', pay, '목표', p.pay[name]);
    }
    if (base !== p.base) { bad++; console.log('❌ 기본가', base, '≠', p.base); }
    if (p.selling && pr2.raw.data.product.selling !== p.selling) { bad++; console.log('❌ selling', pr2.raw.data.product.selling); }
    await c.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name,created_at) VALUES('update','cafe24_product',$1,$2,'cafe24-api','클코 총괄(대표 GO — #489 10/1 오픈 · 자사몰 = 네이버)',NOW())`,
        [cno, JSON.stringify({ before, after: { base: p.base, pay: p.pay, hide: p.hide || [], selling: p.selling || before.selling, minAdd: p.base - p.naverDisc }, note: '#489 네이버 스냅샷 #87 결제가로 카페24 정합' })]).catch(e => console.log('audit skip', e.message));
    console.log(bad ? `❌ 불일치 ${bad}` : `✅ c${cno} 전 variant 결제가 = 네이버 일치`);
    await c.end();
    process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(2); });
