// #534(대표 GO 10/5): 하우스감귤 「로얄과 2.5kg → 4kg 업그레이드 행사」 — 자사몰(카페24 c92) 옵션 맞추기
//   node scripts/apply-534-c24.js            = 조회만(카페24 variants · 최신 스냅샷 옵션 · 어긋난 곳 표)
//   node scripts/apply-534-c24.js apply      = 새 옵션 3개 추가금 맞추기 + 옛 옵션 3개 미노출(selling/display F) + audit
//   node scripts/apply-534-c24.js restore    = 행사 종료 때: 옛 「2.5kg(로얄과)」 다시 판매 · 행사 옵션 미노출(소과 2종은 새 이름 유지)
//   전제: 새 옵션값 3개는 카페24 관리자 화면에서 먼저 추가돼 있어야 한다(API로 옵션값 추가·이름 변경 불가 — 422 · #489).
//   기본가(14,800)·minAdd(−14,200)는 건드리지 않는다 — 네이버 최저 결제가(유라 3kg 중대과 14,800)가 그대로라서.
require('dotenv').config();
const { Client } = require('pg');
const CNO = 92, NAVER = '6400134206';
const G = '1. (제철)고당도 하우스감귤 · ';
// 새 이름(= 네이버 옵션 텍스트 n1 · n2 와 글자 단위 동일) → 결제가 · 물려받을 옛 이름
const PLAN = [
    { neo: G + '행사★하우스귤 2.5kg로얄과→중량up 4kg', old: G + '하우스감귤 가정용 - 2.5kg(로얄과)', pay: 29000 },
    { neo: G + '하우스감귤 가정용 - 2.5kg(소과)', old: G + '(특가)하우스감귤 가정용 - 2.5kg(소과)', pay: 23800 },
    { neo: G + '하우스감귤 가정용 - 4.5kg(소과)', old: G + '(특가)하우스감귤 가정용 - 4.5kg(소과)', pay: 39800 },
];
async function flag(c, req, ms = 150000) {
    await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await c.query(`INSERT INTO agent_office_config(key,value) VALUES('cafe24_product_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 4000)); const q = await c.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await c.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 응답 없음(타임아웃)');
}
// 러너 응답: { ok, raw: { ok, status, data } } — 판에 따라 status 가 없을 수 있어 ok·status·오류 본문을 함께 본다
const putOk = r => !!r && r.ok !== false && !!r.raw && r.raw.ok !== false && !(Number(r.raw.status) >= 400) && !(r.raw.data && r.raw.data.error);
const nameOf = v => (v.options || []).map(o => o.value).join(' / ');
async function load(c) {
    const pr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${CNO}`, query: { fields: 'product_no,price,selling,display' } });
    const vr = await flag(c, { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${CNO}/variants` });
    const base = Math.round(Number(pr.raw.data.product.price));
    return { base, selling: pr.raw.data.product.selling, vars: vr.raw.data.variants.map(v => ({ code: v.variant_code, name: nameOf(v), add: Math.round(Number(v.additional_amount)), selling: v.selling, display: v.display })) };
}
(async () => {
    const mode = process.argv[2] || '';
    const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
    try {
        const cur = await load(c);
        console.log(`카페24 c${CNO} 기본가 ${cur.base} · 판매 ${cur.selling} · variants ${cur.vars.length}종`);
        cur.vars.forEach(v => console.log(`  ${v.code} | ${v.selling}/${v.display} | +${v.add} = ${cur.base + v.add} | ${v.name}`));
        const snap = await c.query("SELECT id, to_char(run_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') at, items FROM naver_product_snapshot ORDER BY id DESC LIMIT 1").catch(e => { console.log('스냅샷 조회 실패:', e.message); return null; });
        if (snap && snap.rows.length) { const items = Array.isArray(snap.rows[0].items) ? snap.rows[0].items : JSON.parse(snap.rows[0].items); const p = items.find(x => String(x.no) === NAVER); console.log('최신 스냅샷 #' + snap.rows[0].id + '(' + snap.rows[0].at + ' KST) 감귤 페이지 옵션:'); ((p && p.opts) || []).forEach(o => console.log('  ', JSON.stringify(o).slice(0, 220))); }
        const by = n => cur.vars.find(v => v.name === n);
        console.log('\n계획 대조:'); PLAN.forEach(p => { const n = by(p.neo), o = by(p.old); console.log(`  새 「${p.neo}」 ${n ? `있음(${n.code} · ${n.selling}/${n.display} · 결제가 ${cur.base + n.add})` : '없음 ← 관리자 화면에서 추가 필요'} | 옛 ${o ? `${o.code} ${o.selling}/${o.display} 결제가 ${cur.base + o.add}` : '없음'} | 목표 ${p.pay}`); });
        if (mode !== 'apply' && mode !== 'restore') return;
        const todo = [];
        if (mode === 'apply') {
            const miss = PLAN.filter(p => !by(p.neo)); if (miss.length) { console.log('❌ 카페24에 새 옵션이 아직 없습니다 — 중단:', miss.map(p => p.neo)); process.exit(1); }
            PLAN.forEach(p => { const n = by(p.neo), o = by(p.old); const add = p.pay - cur.base; if (n.add !== add || n.selling !== 'T' || n.display !== 'T') todo.push({ code: n.code, name: n.name, body: { additional_amount: String(add), selling: 'T', display: 'T' } }); if (o && (o.selling !== 'F' || o.display !== 'F')) todo.push({ code: o.code, name: o.name, body: { selling: 'F', display: 'F' } }); });
        } else {
            const p = PLAN[0], n = by(p.neo), o = by(p.old); if (!o) { console.log('❌ 옛 2.5kg(로얄과) 옵션이 없습니다 — 중단'); process.exit(1); }
            const add = p.pay - cur.base; if (o.add !== add || o.selling !== 'T' || o.display !== 'T') todo.push({ code: o.code, name: o.name, body: { additional_amount: String(add), selling: 'T', display: 'T' } });
            if (n && (n.selling !== 'F' || n.display !== 'F')) todo.push({ code: n.code, name: n.name, body: { selling: 'F', display: 'F' } });
        }
        if (!todo.length) { console.log('\n바꿀 것 없음(이미 반영).'); return; }
        for (const t of todo) { const r = await flag(c, { action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${CNO}/variants/${t.code}`, body: { shop_no: 1, request: t.body } }); console.log(`  PUT ${t.code} ${JSON.stringify(t.body)} → ${!putOk(r) ? '실패 ' + JSON.stringify(r).slice(0, 200) : 'ok'} | ${t.name}`); }
        await c.query(`INSERT INTO audit_logs(action, target_type, target_id, changes, source, actor_name) VALUES($1,$2,$3,$4::jsonb,$5,$6)`, ['cafe24_variant_update', 'cafe24_product', String(CNO), JSON.stringify({ mode, before: cur.vars.filter(v => todo.some(t => t.code === v.code)), after: todo }), 'script', '클코(대표 GO #534 하우스감귤 4kg 행사)']).catch(e => console.log('audit 기록 실패:', e.message));
        console.log('\n카페24 조회는 약 1분 늦게 바뀝니다 — 75초 뒤 재조회…'); await new Promise(r => setTimeout(r, 75000));
        const aft = await load(c); const b2 = n => aft.vars.find(v => v.name === n);
        PLAN.forEach(p => { const n = b2(p.neo), o = b2(p.old); console.log(`  새 ${n ? `${n.selling}/${n.display} 결제가 ${aft.base + n.add}` : '없음'} · 옛 ${o ? `${o.selling}/${o.display}` : '없음'} | ${p.neo}`); });
    } finally { await c.end(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
