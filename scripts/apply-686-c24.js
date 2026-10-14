// #686 카페24 황금향 추가금 직접 맞추기(품목 코드 지정 · apply-534-c24 꼴) — 기본 = 계획만(쓰기 0)
//   node scripts/apply-686-c24.js <저장소 경로> [price|priceK|hide|hide97] [apply]
//   price  = c94 C·D·E + c92 I·J + c100 B·C 추가금      priceK = c92 K(자사몰 전용 선물 5kg) 추가금
//   hide   = c94 F + c92 L 미노출(selling F · display F)   hide97 = c97 B 미노출
//   끝에 apply 가 없으면 아무것도 안 바꾼다. 지금 값이 「바꾸기 전 기대값」도 「목표값」도 아니면 그 줄에서 멈춘다(남이 먼저 바꿨을 때).
const path = require('path');
const ROOT = path.resolve(process.argv[2] || '.'), SET = process.argv[3] || 'price', APPLY = process.argv[4] === 'apply';
const M = require(path.join(ROOT, 'scripts/desk/_mall'));
const PLAN = {
    price: [
        [94, 'P00000DQ000C', '가정용 - 5kg', 49800, 57800], [94, 'P00000DQ000D', '선물용 - 3kg', 38800, 41800], [94, 'P00000DQ000E', '선물용 - 5kg', 55800, 60800],
        [92, 'P00000DO000I', '가정용 - 5kg', 49800, 57800], [92, 'P00000DO000J', '선물용 - 3kg', 38800, 41800],
        [100, 'P00000DW000B', '선물용 - 3kg', 38800, 41800], [100, 'P00000DW000C', '선물용 - 5kg', 55800, 60800],
    ],
    priceK: [[92, 'P00000DO000K', '선물용 - 5kg', 55800, 60800]],
    hide: [[94, 'P00000DQ000F', '못난이 - 5kg', null, 37800], [92, 'P00000DO000L', '못난이 - 5kg', null, 37800]],
    hide97: [[97, 'P00000DT000B', '못난이 - 10kg', null, 68800]],
}[SET];
(async () => {
    if (!PLAN) throw new Error('묶음 이름: price | priceK | hide | hide97');
    const out = [], todo = [], prod = {};
    for (const [cno, code, frag, pay, payBefore] of PLAN) {
        const c = prod[cno] || (prod[cno] = await M.c24Product(cno)); const v = c.vars.find(x => x.code === code);
        if (!v) { out.push(`멈춤 | c${cno} ${code} 품목 없음`); continue; }
        if (!v.name.includes('황금향') || !v.name.includes(frag)) { out.push(`멈춤 | c${cno} ${code} 이름이 기대와 다름: ${v.name}`); continue; }
        const cur = c.base + v.add;
        if (pay == null) {   // 미노출
            if (v.selling === 'F' && v.display === 'F') { out.push(`이미 미노출 | c${cno} ${code} ${v.name}`); continue; }
            out.push(`미노출로 | c${cno} ${code} ${v.name} | 결제가 ${cur} | ${v.selling}/${v.display} → F/F`);
            todo.push({ cno, code, name: v.name, body: { selling: 'F', display: 'F' }, before: { add: v.add, selling: v.selling, display: v.display } });
        } else {
            const add = pay - c.base;
            if (cur === pay) { out.push(`같음 | c${cno} ${code} ${v.name} | ${cur}`); continue; }
            if (cur !== payBefore) { out.push(`멈춤 | c${cno} ${code} ${v.name} | 지금 ${cur} — 기대(${payBefore})도 목표(${pay})도 아님`); continue; }
            out.push(`바꿈 | c${cno} ${code} ${v.name} | 기본가 ${c.base} · 추가금 ${v.add} → ${add} | 결제가 ${cur} → ${pay}`);
            todo.push({ cno, code, name: v.name, body: { additional_amount: String(add) }, before: { add: v.add, selling: v.selling, display: v.display } });
        }
    }
    console.log(out.join('\n'));
    const stopped = out.some(l => l.startsWith('멈춤'));
    if (!APPLY || stopped || !todo.length) { console.log(stopped ? '\n멈춘 줄이 있어 아무것도 안 바꿈' : APPLY ? '\n바꿀 것 없음' : `\n계획만 — 바꿀 것 ${todo.length}개(쓰기 0)`); await M.pool.end(); return; }
    const res = [];
    for (const t of todo) { const r = await M.c24({ action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${t.cno}/variants/${t.code}`, body: { shop_no: 1, request: t.body } }); res.push({ cno: t.cno, code: t.code, ok: M.c24Ok(r), err: M.c24Ok(r) ? undefined : JSON.stringify(r).slice(0, 160) }); console.log(M.c24Ok(r) ? 'PUT 성공' : 'PUT 실패', 'c' + t.cno, t.code); }
    await M.pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('cafe24_variant_update','cafe24_product',NULL,$1,'orchestrator','클코 총괄(대표 지시 #686)')`, [JSON.stringify({ tool: '686-c24', set: SET, todo, results: res })]);
    console.log('90초 뒤 다시 읽어 확인…'); await M.sleep(90000);
    for (const cno of [...new Set(todo.map(t => t.cno))]) { const c = await M.c24Product(cno); for (const t of todo.filter(x => x.cno === cno)) { const v = c.vars.find(x => x.code === t.code); console.log('확인', 'c' + cno, t.code, '결제가', c.base + v.add, v.selling + '/' + v.display); } }
    await M.pool.end();
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
