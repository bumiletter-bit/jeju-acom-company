// #443 검증: c93 selling 재조회(조회 지연 대비) → 스냅샷 재수집 대기(id>69) → 공개 store-snapshot 청귤 품절 → qna_sim 6문항 → cafe24_sync dry
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 300) : '')); };
async function runner(reqKey, resKey, req, ms = 240000) {
    await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]);
    await pool.query(`INSERT INTO agent_office_config (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [reqKey, JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 5000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key=$1`, [resKey]); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]); return q.rows[0].value; } }
    throw new Error('runner timeout ' + reqKey);
}
(async () => {
    await new Promise(r => setTimeout(r, 45000));
    // ① c93 재조회
    const g = await runner('cafe24_product_request', 'cafe24_product_result', { action: 'raw', method: 'GET', path: '/api/v2/admin/products/93', query: { fields: 'product_no,selling,display,updated_date' } });
    const p = g.raw && g.raw.data && g.raw.data.product;
    ok(p && p.selling === 'F', '① 카페24 c93 selling F (재조회)', JSON.stringify(p));
    // ② 스냅샷 재수집 대기
    let snap = null; const t0 = Date.now();
    while (Date.now() - t0 < 420000) { const r = await pool.query(`SELECT id, run_at, note, items FROM naver_product_snapshot WHERE id > 69 ORDER BY id DESC LIMIT 1`); if (r.rows.length) { snap = r.rows[0]; break; } await new Promise(r => setTimeout(r, 10000)); }
    ok(!!snap, '② 스냅샷 재수집 회차 생성(id>69)', snap && ('id ' + snap.id + ' ' + snap.note));
    if (snap) {
        const arr = Array.isArray(snap.items) ? snap.items : (snap.items.items || Object.values(snap.items));
        const it = arr.find(x => String(x.no) === '5731582511');
        ok(it && it.statusType === 'OUTOFSTOCK', '② 스냅샷 청귤 statusType OUTOFSTOCK', it && JSON.stringify({ st: it.statusType, stock: it.stock, opts: (it.opts || []).map(o => o.n1) }));
        const tm = (await pool.query(`SELECT last_status, last_error FROM naver_auto_collect WHERE key='product_snapshot'`)).rows[0];
        ok(tm && tm.last_status === 'ok', '② 스냅샷 타이머 상태 ok', JSON.stringify(tm));
    }
    // ③ 공개 API
    try {
        const res = await fetch('https://jeju-acom-company.onrender.com/api/public/store-snapshot');
        const j = await res.json();
        const items = j.items || j.products || [];
        const it = items.find(x => String(x.no || x.productNo) === '5731582511');
        ok(it && (String(it.statusType).toUpperCase() === 'OUTOFSTOCK' || Number(it.stock) === 0), '③ 공개 store-snapshot 청귤 품절', it && JSON.stringify({ st: it.statusType, stock: it.stock }));
    } catch (e) { ok(false, '③ 공개 store-snapshot 조회', e.message); }
    // ④ qna_sim
    const cases = [
        { q: '청귤 얼마예요?', product: '청귤' },
        { q: '청귤 지금 주문 가능한가요? 오늘 발송되나요?', product: '청귤' },
        { q: '청귤 언제까지 팔아요?', product: null },
        { q: '청귤 사전예약 했는데 언제 와요?', product: '청귤' },
        { q: '청귤청 어떻게 담가요?', product: null },
        { q: '하우스감귤 얼마예요?', product: '하우스감귤' },
        { q: '같은 상품인데 왜 가격이 달라요?', product: null },
    ];
    const s = await runner('qna_sim_request', 'qna_sim_result', { cases }, 300000);
    const rs = s.results || s.cases || [];
    for (let i = 0; i < cases.length; i++) {
        const r = rs[i] || {}; const a = String(r.answer || r.response || r.text || JSON.stringify(r)).replace(/\n/g, '⏎');
        console.log(`\n  Q${i + 1}: ${cases[i].q}\n  A: ${a.slice(0, 700)}`);
    }
    const A = i => String((rs[i] || {}).answer || (rs[i] || {}).response || (rs[i] || {}).text || JSON.stringify(rs[i] || {}));
    ok(/마감|종료/.test(A(0)) && !/18,800|29,800/.test(A(0)), '④ Q1 청귤 가격 → 종료 안내·가격 미노출');
    ok(/마감|종료|판매할 수 없/.test(A(1)) && !/오늘 (바로 )?발송 가능|지금 주문하시면/.test(A(1)), '④ Q2 주문 가능? → 불가·오늘발송 표현 0');
    ok(/9월 15일|마감/.test(A(2)), '④ Q3 언제까지 → 9/15 마감');
    ok(/발송/.test(A(3)) && !/사전예약이 시작/.test(A(3)), '④ Q4 기주문 → 순차 발송 안내');
    ok(/설탕|슬라이스|세척/.test(A(4)), '④ Q5 청귤청 담그기 무회귀');
    ok(/하우스감귤|귤/.test(A(5)) && !/청귤/.test(A(5)), '④ Q6 하우스감귤 무회귀(청귤 언급 0)');
    ok(!/사전예약특가/.test(A(6)), '④ Q7 범용 키워드 → 청귤 특가 시나리오(#44) 미발화');
    // ⑤ cafe24_sync dry
    const d = await runner('cafe24_product_request', 'cafe24_product_result', { action: 'sync', mode: 'dry', telegram: 'no' }, 240000);
    const rep = d.report || d.rep || d;
    console.log('\n  sync dry:', JSON.stringify(rep).slice(0, 600));
    const sell = (rep.sellState || []).filter(x => String(x.tag).includes('93') || /청귤/.test(x.name));
    ok(sell.length === 0, '⑤ sync dry: c93 품절 동기 대상 아님(이미 F)', JSON.stringify(rep.sellState || []).slice(0, 200));
    ok((rep.optMissing || []).length === 0 && (rep.optMismatch || []).length === 0 && (rep.errors || []).length === 0, '⑤ sync dry: optMissing 0·optMismatch 0·오류 0', `${(rep.optMissing || []).length}/${(rep.optMismatch || []).length}/${(rep.errors || []).length}`);
    console.log(`\n결과: ${pass}/${pass + fail}`);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
