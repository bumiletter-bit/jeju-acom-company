// #428(대표 9/7): 황금향 선물용 옵션명 변경(대과 13~23과 → 중대과 13~25과 · 대과 7~15과 → 중대과 7~15과) — 판매현황(bot_products) 정리
//   ① 신규 행(409 3kg 중대과 · 410 5kg 중대과) = 판매중 + 판매가 + 발송안내문 + 네이버 상품번호 (옛 행에서 그대로 승계)
//   ② 옛 행(227 3kg 대과 · 228 5kg 대과 13~23과 · 396 5kg 대과 13~25과) = soft-delete (대표 "나머지는 판매중 아님 — 삭제해도 됨")
//   ③ 하우스감귤 판매가 2종 = 네이버 실시간 결제가로 (선물용 3kg 로얄과 38,800→34,500 · 가정용 4.5kg 로얄과 51,800→48,800)
//   ④ 품목 마스터(items) 10·11 이름 = 새 옵션명 (똑똑이 MCP search_items 정합)
//   전 건 audit_logs 기록(svcUpdateBotProduct/svcSoftDeleteBotProduct와 동일 형식). 재실행 안전(멱등).
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = { id: null, name: '클코(대표 지시 #428)' };
async function audit(action, targetType, targetId, changes) {
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [action, targetType, targetId, JSON.stringify(changes), 'bot-product', ACTOR.id, ACTOR.name]);
}
async function updBot(id, patch) {
    const cur = (await pool.query('SELECT * FROM bot_products WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
    if (!cur) throw new Error('bot_products ' + id + ' 없음/삭제됨');
    const sets = ['updated_at = now()']; const params = [];
    for (const [k, v] of Object.entries(patch)) { params.push(v); sets.push(`${k}=$${params.length}`); }
    params.push(ACTOR.name); sets.push(`updated_by=$${params.length}`);
    params.push(id);
    const after = (await pool.query(`UPDATE bot_products SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params)).rows[0];
    await audit('update', 'bot_product', id, { before: cur, after, note: '#428 옵션명 변경 정리' });
    return after;
}
async function delBot(id) {
    const cur = (await pool.query('SELECT * FROM bot_products WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
    if (!cur) { console.log('  (이미 삭제) id', id); return null; }
    const after = (await pool.query(`UPDATE bot_products SET deleted_at=now(), updated_by=$2, updated_at=now() WHERE id=$1 RETURNING *`, [id, ACTOR.name])).rows[0];
    await audit('delete', 'bot_product', id, { before: cur, note: '#428 옛 옵션명(대과) 행 삭제 — 새 중대과 행이 대체' });
    return after;
}
(async () => {
    const NAVER_NO = 11126666859;
    // 승계 원본(옛 행)에서 안내문 취득 — 삭제 전에 읽는다
    const old3 = (await pool.query('SELECT * FROM bot_products WHERE id=227')).rows[0];
    const old5 = (await pool.query('SELECT * FROM bot_products WHERE id=228')).rows[0];
    if (!old3 || !old5 || !old3.shipping_guide || !old5.shipping_guide) throw new Error('옛 행 227/228 안내문 확인 실패');
    const new3 = (await pool.query(`SELECT id,name FROM bot_products WHERE name='과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)' AND deleted_at IS NULL`)).rows[0];
    const new5 = (await pool.query(`SELECT id,name FROM bot_products WHERE name='과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)' AND deleted_at IS NULL`)).rows[0];
    if (!new3 || !new5) throw new Error('신규 중대과 행 없음 — 품목별 금액 저장 확인');
    console.log('신규 행', new3.id, new5.id);
    // ① 신규 행 세팅 (판매가 = 옛 행 그대로 — 네이버 실시간 42,800/62,800 검산 일치)
    const a3 = await updBot(new3.id, { status: '판매중', price: '42,800원', shipping_guide: old3.shipping_guide, notify_message: old3.notify_message, naver_product_no: NAVER_NO, reserve_ship_start: old3.reserve_ship_start });
    const a5 = await updBot(new5.id, { status: '판매중', price: '62,800원', shipping_guide: old5.shipping_guide, notify_message: old5.notify_message, naver_product_no: NAVER_NO, reserve_ship_start: old5.reserve_ship_start });
    console.log('① 판매중 전환', a3.id, a3.status, a3.price, '| guide', (a3.shipping_guide || '').length, '|', a5.id, a5.status, a5.price, '| guide', (a5.shipping_guide || '').length);
    // ② 옛 행 soft-delete
    for (const id of [227, 228, 396]) { const r = await delBot(id); if (r) console.log('② 삭제', id, r.name.slice(-22), r.deleted_at ? 'ok' : '??'); }
    // ③ 하우스감귤 판매가 (네이버 실시간 9/7)
    const g1 = await updBot(213, { price: '34,500원' });
    const g2 = await updBot(214, { price: '48,800원' });
    console.log('③ 귤 판매가', g1.name.slice(-16), g1.price, '|', g2.name.slice(-16), g2.price);
    // ④ 품목 마스터
    for (const [id, name] of [[10, '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)'], [11, '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)']]) {
        const cur = (await pool.query('SELECT * FROM items WHERE id=$1 AND is_deleted=false', [id])).rows[0];
        if (!cur) { console.log('  items', id, '없음'); continue; }
        if (cur.name === name) { console.log('  items', id, '이미 동일'); continue; }
        const after = (await pool.query('UPDATE items SET name=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [name, id])).rows[0];
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','item',$1,$2,'admin_api',NULL,$3)`, [id, JSON.stringify({ before: cur, after, note: '#428' }), ACTOR.name]);
        console.log('④ items', id, '→', after.name.slice(-20));
    }
    // 검산: 미삭제 황금향 선물용 행 = 중대과 2종만
    const chk = await pool.query(`SELECT id,name,status,price,naver_product_no,length(coalesce(shipping_guide,'')) sg FROM bot_products WHERE deleted_at IS NULL AND name LIKE '%황금향 선물용%' ORDER BY id`);
    console.log('검산(미삭제 황금향 선물용):'); for (const r of chk.rows) console.log('   ', JSON.stringify(r));
    const ok = chk.rows.length === 2 && chk.rows.every(r => /중대과/.test(r.name) && r.status === '판매중' && r.sg > 0 && String(r.naver_product_no) === String(NAVER_NO));
    console.log(ok ? '✅ 판매현황 정리 완료' : '❌ 검산 실패');
    await pool.end();
    process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
