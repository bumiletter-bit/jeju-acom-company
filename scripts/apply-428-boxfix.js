/* #428-b(대표 9/7 실물 "박스재고 선물용 3kg·5kg 차감 안 됨"): 원인 2건 — 코드 아님·데이터 매핑
   ① pricing #97(대성 8/30~9/5) 황금향 선물용 2종 boxType='해당없음' → 9/1~9/5 정산 미차감 (선물용 박스 신설(8/31 #420) 뒤 그 주 단가표에 박스 매핑을 안 넣음)
   ② settlements #377(9/6) 품목명 「대과 7~15과 / 대과 13~25과」 ≠ pricing #99 현재명 「중대과 …」(대표 9/7 아침 이름 변경) → 이름 정확 일치 매핑이라 미차감
   교정 = 데이터만: #97 boxType 2종 세팅 + #377 품목명 2종을 현재 pricing 이름으로(단가·소계 무접촉). 코드 무변경 = 무회귀. 전건 audit.
   검산 = computeBoxStocks(server.js 2998~) 동일 로직으로 교정 전/후 재고 산출·비교. */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #428-b 박스재고 교정)';
const norm = d => (d instanceof Date ? new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : String(d).slice(0, 10));
async function boxMap(partner, dateStr) {
    const pr = await pool.query(`SELECT items FROM pricing WHERE partner=$1 AND start_date <= $2::date AND end_date >= $2::date ORDER BY id`, [partner, dateStr]);
    const m = {}; pr.rows.forEach(r => (r.items || []).forEach(p => { if (p.boxType && p.boxType !== '해당없음') m[p.name] = p.boxType; })); return m;
}
async function compute() {   // server.js computeBoxStocks 사본(읽기 전용) — 선물용 2종만 요약
    const inv = await pool.query('SELECT product_name, company_stock, daesong_stock, hyodon_stock, base_date, updated_at FROM box_inventory');
    const by = {}; inv.rows.forEach(r => { by[r.product_name] = { company: +r.company_stock || 0, daesong: +r.daesong_stock || 0, hyodon: +r.hyodon_stock || 0, baseDate: r.base_date ? norm(r.base_date) : null, updatedAt: r.updated_at, ded: [] }; });
    const movs = await pool.query('SELECT product_name, movement_type, qty, date, created_at FROM box_movements');
    for (const m of movs.rows) { const b = by[m.product_name]; if (!b) continue; const d = norm(m.date);
        if (b.baseDate && !(d > b.baseDate)) { const ok = d === b.baseDate && m.created_at && b.updatedAt && new Date(m.created_at) > new Date(b.updatedAt); if (!ok) continue; }
        const q = +m.qty || 0; if (m.movement_type === 'order') b.company += q; else if (m.movement_type === 'transfer_hyodon') { b.company -= q; b.hyodon += q; } else { b.company -= q; b.daesong += q; } }
    for (const { partner, field } of [{ partner: '대성(시온)', field: 'daesong' }, { partner: '효돈농협', field: 'hyodon' }]) {
        const setts = await pool.query('SELECT date, items FROM settlements WHERE partner=$1 ORDER BY date', [partner]); const cache = {};
        for (const s of setts.rows) { const d = norm(s.date); const items = s.items || []; if (!items.length) continue; if (!(d in cache)) cache[d] = await boxMap(partner, d);
            for (const it of items) { const bt = cache[d][it.name]; if (!bt) continue; const b = by[bt]; if (!b) continue; if (b.baseDate && !(d > b.baseDate)) continue; b[field] -= (+it.qty || 0); b.ded.push(d + ' x' + it.qty); } }
    }
    return { g3: by['선물용 박스 3kg'], g5: by['선물용 박스 5kg'] };
}
(async () => {
    const before = await compute();
    console.log('교정 전  3kg 업체/대성', before.g3.company, before.g3.daesong, '차감', before.g3.ded.join(',') || '없음');
    console.log('교정 전  5kg 업체/대성', before.g5.company, before.g5.daesong, '차감', before.g5.ded.join(',') || '없음');
    // ① pricing #97 boxType
    const p97 = (await pool.query('SELECT id, items FROM pricing WHERE id=97')).rows[0];
    const items97 = JSON.parse(JSON.stringify(p97.items)); let ch1 = 0;
    for (const it of items97) {
        if (/황금향 선물용 - 3kg/.test(it.name) && it.boxType !== '선물용 박스 3kg') { it.boxType = '선물용 박스 3kg'; ch1++; }
        if (/황금향 선물용 - 5kg/.test(it.name) && it.boxType !== '선물용 박스 5kg') { it.boxType = '선물용 박스 5kg'; ch1++; }
    }
    if (ch1) {
        await pool.query('UPDATE pricing SET items=$1::jsonb WHERE id=97', [JSON.stringify(items97)]);
        await pool.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','pricing',97,$1,'admin_api',$2)`, [JSON.stringify({ before: p97.items, after: items97, note: '#428-b 선물용 박스 매핑 누락 보정(8/30~9/5)' }), ACTOR]);
    }
    console.log('① pricing #97 boxType 세팅', ch1 + '건');
    // ② settlements #377 품목명 → 현재 pricing(#99) 이름
    const s377 = (await pool.query('SELECT id, items FROM settlements WHERE id=377')).rows[0];
    const items377 = JSON.parse(JSON.stringify(s377.items)); let ch2 = 0;
    const REN = { '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(대과 7~15과)': '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)',
                  '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(대과 13~25과)': '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)',
                  '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(대과 13~23과)': '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)' };
    for (const it of items377) if (REN[it.name]) { it.name = REN[it.name]; ch2++; }
    if (ch2) {
        await pool.query('UPDATE settlements SET items=$1::jsonb WHERE id=377', [JSON.stringify(items377)]);
        await pool.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','settlement',377,$1,'admin_api',$2)`, [JSON.stringify({ before: s377.items, after: items377, note: '#428-b 품목명을 현재 단가표(중대과)와 일치 — 단가·소계 무변경' }), ACTOR]);
    }
    console.log('② settlements #377 품목명 갱신', ch2 + '건 (단가·소계 무변경)');
    // 이번 주(#99 기간) 다른 정산에 옛 이름 잔존?
    const rest = await pool.query(`SELECT id, date FROM settlements WHERE partner='대성(시온)' AND date >= '2026-09-06' AND items::text ~ '황금향 선물용 - (3kg\\(대과|5kg\\(대과)'`);
    console.log('   9/6 이후 옛 이름 잔존 정산:', rest.rows.length ? rest.rows.map(r => '#' + r.id).join(',') : '없음');
    const after = await compute();
    console.log('교정 후  3kg 업체/대성', after.g3.company, after.g3.daesong, '차감', after.g3.ded.join(','));
    console.log('교정 후  5kg 업체/대성', after.g5.company, after.g5.daesong, '차감', after.g5.ded.join(','));
    const exp3 = 1500 - (4 + 9 + 11 + 6 + 1), exp5 = 1500 - (6 + 2 + 1 + 5 + 4);   // 9/1·9/2·9/3·9/5·9/6 (8/31 = 기준일 당일 제외 규칙)
    const ok = after.g3.daesong === exp3 && after.g5.daesong === exp5 && after.g3.company === 1500 && after.g5.company === 1650;
    console.log(ok ? `✅ 기대값 일치 (3kg 대성 ${exp3} · 5kg 대성 ${exp5})` : `❌ 기대값 불일치 (기대 3kg ${exp3} · 5kg ${exp5})`);
    await pool.end(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
