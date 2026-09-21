/* #464(대표 9/21): 이번 주 단가표(대성 #103)에 황금향 선물용 2종을 「대과」로 잘못 등록 → 대표가 「중대과」로 교정.
   그 사이 「대과」 이름으로 입력된 정산 품목명을 현재 단가표 이름으로 맞춘다 — 이름만(수량·단가·소계·행 수 무접촉).
   정산은 품목명 정확 일치로 박스 차감을 매핑하므로(#428-b) 안 고치면 선물용 박스 3kg·5kg가 그날 미차감.
   실행: node scripts/apply-464-settle-rename.js          → 대상만 보여 줌(무변경)
         node scripts/apply-464-settle-rename.js apply    → 교정 + audit */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #464 정산 품목명 대과→중대과)';
const APPLY = process.argv[2] === 'apply';
const FROM = '2026-09-21';   // 잘못된 이름이 들어간 단가표(#103) 시작일
const REN = {
    '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(대과 7~15과)': '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)',
    '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(대과 13~25과)': '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)',
};
const sum = items => items.reduce((a, it) => ({ qty: a.qty + (+it.qty || 0), amt: a.amt + (+it.subtotal || (+it.price || 0) * (+it.qty || 0)) }), { qty: 0, amt: 0 });
(async () => {
    // 현재 단가표에 새 이름이 실제로 있는지(없으면 중단 — 이름을 허공으로 바꾸지 않는다)
    const pr = await pool.query(`SELECT id, items FROM pricing WHERE partner='대성(시온)' AND start_date <= $1::date AND end_date >= $1::date ORDER BY id`, [FROM]);
    const names = new Set(); const box = {}; pr.rows.forEach(r => (r.items || []).forEach(p => { names.add(p.name); box[p.name] = p.boxType; }));
    for (const n of Object.values(REN)) if (!names.has(n)) throw new Error('현재 단가표에 없음: ' + n);
    for (const o of Object.keys(REN)) if (names.has(o)) throw new Error('단가표에 옛 이름이 아직 있음: ' + o);
    console.log('단가표 #' + pr.rows.map(r => r.id).join(',') + ' — 새 이름 2종 존재 · 박스 매핑:', Object.values(REN).map(n => box[n]).join(' / '));

    const ss = await pool.query(`SELECT id, date::text d, partner, items, total FROM settlements WHERE date >= $1::date AND items::text LIKE '%황금향 선물용%' ORDER BY date, id`, [FROM]).catch(async () =>
        pool.query(`SELECT id, date::text d, partner, items FROM settlements WHERE date >= $1::date AND items::text LIKE '%황금향 선물용%' ORDER BY date, id`, [FROM]));
    let touched = 0;
    for (const s of ss.rows) {
        const before = s.items || []; const after = JSON.parse(JSON.stringify(before)); let ch = 0;
        for (const it of after) if (REN[it.name]) { it.name = REN[it.name]; ch++; }
        if (!ch) { console.log(`정산 #${s.id} ${s.d} ${s.partner} — 옛 이름 없음(무변경)`); continue; }
        const b = sum(before), a = sum(after);
        if (before.length !== after.length || b.qty !== a.qty || b.amt !== a.amt) throw new Error('#' + s.id + ' 수량·금액이 달라짐 — 중단');
        console.log(`정산 #${s.id} ${s.d} ${s.partner} — 이름 ${ch}행 교정 대상 · 행 ${after.length} · 수량 ${a.qty} · 금액 ${a.amt.toLocaleString()}(전후 동일)`);
        after.filter((it, i) => it.name !== before[i].name).forEach((it, i) => console.log(`   → ${it.name} · ${it.qty}박스 · ${(+it.price || 0).toLocaleString()}원`));
        if (APPLY) {
            await pool.query('UPDATE settlements SET items=$1::jsonb WHERE id=$2', [JSON.stringify(after), s.id]);
            await pool.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','settlement',$1,$2,'claude-code',$3)`,
                [s.id, JSON.stringify({ note: '#464 품목명을 현재 단가표 이름(중대과)으로 — 수량·단가·소계 무접촉', before, after }), ACTOR]);
            touched++;
        }
    }
    const rest = await pool.query(`SELECT id FROM settlements WHERE date >= $1::date AND (items::text LIKE '%선물용 - 3kg(대과 %' OR items::text LIKE '%선물용 - 5kg(대과 %')`, [FROM]);
    console.log(APPLY ? `✅ 교정 ${touched}건 · 옛 이름 잔존 ${rest.rows.length}건` : `(미적용 — apply를 붙여 실행) · 옛 이름 있는 정산 ${rest.rows.length}건`);
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
