// #442 후속(대표 "이런 경우 또 있을지 찾아보고 보고만"): 읽기 전용 감사
//  매핑 전 상품에 대해 네이버 스냅샷(최신) 판매 옵션 ↔ 카페24 판매 variant를 ①글자 그대로(자동 담기 조건) ②키(과일|용도|중량|등급) ③결제가 3단계로 대조
//  + 취소 주문(20260914-0000016) 실결제 내역 조회
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
eval(src.match(/function cafe24OptKey\(s\) \{[\s\S]*?\n\}/)[0]);
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 3000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
const strip = s => String(s || '').replace(/^\d+\.\s*/, '');
(async () => {
    const map = (await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_sync_map'`)).rows[0].value.map;
    const snap = (await pool.query(`SELECT id, run_at, items FROM naver_product_snapshot ORDER BY id DESC LIMIT 1`)).rows[0];
    const items = Array.isArray(snap.items) ? snap.items : JSON.parse(snap.items);
    console.log(`스냅샷 #${snap.id} · 매핑 ${Object.keys(map).length}종\n`);
    const c24nos = Object.values(map).map(m => String(m.c24 || m));
    const pl = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/products', query: { product_no: c24nos.join(','), limit: 100, fields: 'product_no,product_name,display,selling,price' } });
    const curBy = {}; for (const p of ((pl.raw && pl.raw.data && pl.raw.data.products) || [])) curBy[String(p.product_no)] = p;
    const issues = [];
    for (const [nno, m] of Object.entries(map)) {
        const c24 = String(m.c24 || m); const sn = items.find(x => String(x.no) === String(nno)); const cp = curBy[c24];
        if (!sn || !cp) { console.log(`c${c24}/${nno}: ${!sn ? '스냅샷 없음' : '카페24 없음'}`); continue; }
        const nOpts = (sn.opts || []).filter(o => o.usable !== false);
        const nSelling = !sn.soldout && Number(sn.stock || 0) > 0 && nOpts.length > 0;
        if (!nSelling) { console.log(`c${c24} ${cp.product_name.slice(0, 14)} — 네이버 미판매(품절/시즌) · 카페24 selling ${cp.selling}`); if (cp.selling === 'T') issues.push(`c${c24} 네이버 미판매인데 카페24 판매함`); continue; }
        const vr = await runner({ action: 'raw', method: 'GET', path: `/api/v2/admin/products/${c24}/variants`, query: { limit: 100 } });
        const vs = ((vr.raw && vr.raw.data && vr.raw.data.variants) || []).filter(v => v.display === 'T' && v.selling === 'T');
        const base = Math.round(Number(cp.price));
        const vText = vs.map(v => (v.options || []).map(o => o.value).join(' / '));
        console.log(`c${c24} ${cp.product_name.slice(0, 16)} — 상품 selling ${cp.selling}/display ${cp.display} · 기본가 ${base.toLocaleString()} · 네이버 ${nOpts.length}옵션 · 카페24 판매 variant ${vs.length}`);
        if (cp.selling !== 'T' || cp.display !== 'T') issues.push(`c${c24} 네이버 판매중인데 카페24 상품 selling ${cp.selling}/display ${cp.display}`);
        for (const o of nOpts) {
            const want = `${o.n1} · ${o.n2}`; const wantS = strip(o.n1) + ' · ' + o.n2;
            const exact = vs.find(v => (v.options || []).some(x => x.value === want || strip(x.value) === wantS));
            const k = cafe24OptKey(o.n1 + ' ' + o.n2);
            const byKey = vs.find(v => cafe24OptKey((v.options || []).map(x => x.value).join(' ')) === k);
            const nPay = Number(sn.discPrice) + Number(o.price || 0);
            const cPay = byKey ? base + Number(byKey.additional_amount) : null;
            let mark = '✅';
            if (!exact && !byKey) { mark = '🔴 카페24에 없음(이름·키 모두)'; issues.push(`c${c24} 「${want}」 카페24 판매 옵션에 없음 → 확인창/오옵션 결제 위험`); }
            else if (!exact) { mark = `🟠 글자 불일치(키는 일치) — 카페24 「${(byKey.options || []).map(x => x.value).join(' / ')}」`; issues.push(`c${c24} 「${want}」 글자 다름 → 확인창 1회(가격은 ${cPay === nPay ? '일치' : '불일치!'})`); }
            if (byKey && cPay !== nPay) { mark += ` 💰 결제가 ${cPay.toLocaleString()} ≠ 네이버 ${nPay.toLocaleString()}`; issues.push(`c${c24} 「${want}」 결제가 ${cPay} ≠ 네이버 ${nPay}`); }
            console.log(`   ${mark}  ${want}  (네이버 ${nPay.toLocaleString()})`);
        }
        const nKeys = new Set(nOpts.map(o => cafe24OptKey(o.n1 + ' ' + o.n2)));
        for (const v of vs) { const k = cafe24OptKey((v.options || []).map(x => x.value).join(' ')); if (!nKeys.has(k)) console.log(`   ⚪ 카페24만 판매중: 「${(v.options || []).map(x => x.value).join(' / ')}」 결제 ${(base + Number(v.additional_amount)).toLocaleString()} (네이버에 없음 — 자사몰 카드엔 안 보이나 카페24 직접 경로로 주문 가능)`); }
        await new Promise(r => setTimeout(r, 300));
    }
    console.log('\n=== 취소 주문 20260914-0000016 ===');
    const od = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/orders/20260914-0000016', query: { embed: 'items' } });
    const o = od.raw && od.raw.data && od.raw.data.order;
    if (o) { console.log('주문일', o.order_date, '· 결제 총액', o.payment_amount || o.actual_order_amount && JSON.stringify(o.actual_order_amount), '· 취소', o.canceled, '· 상태', (o.items || []).map(i => i.order_status).join(','));
        for (const it of (o.items || [])) console.log('  품목:', it.product_name, '|', it.option_value, '| 수량', it.quantity, '| 단가', it.product_price, '| 옵션가', it.option_price, '| 상태', it.order_status); }
    else console.log(JSON.stringify(od).slice(0, 300));
    console.log('\n=== 요약 ===');
    console.log(issues.length ? issues.map(s => ' - ' + s).join('\n') : ' 문제 0건');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
