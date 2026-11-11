// #1108-(d) 창구 → 발주 메모함 「확인 대기 줄」 검증 — order-memo.js 를 가짜 deps 로 따로 장착(server.js 안 띄움) · 실DB 쓰기 = 시험 줄만
//   시험 줄 = order_memo_preorders(channel 'naver' · order_key 'v1108d-…' · 번호 0999108…) · order_memo_entries(created_by 'verify1108d') + 그 줄들 · 시작·끝에 지움
//   ① 꺼짐 503 · 토큰 틀림 401 ② 찾기 = 구매자 번호 · 받는 분 번호(→ 구매자 번호 · from_recv) · 선물하기(구매자 번호 없음 → 상품주문번호) · 이름(하나면 OK · 둘↑ = multi 후보만) · 주문번호
//   ③ 사이즈 = 가정용 로얄과만 · 과수 = 선물용 만감류만 · 0건 = not_found ④ dry = 저장 0 ⑤ --add = 확인 줄(sure false · 「에이전트가 넣음 · 확인 필요」 · src desk)
//   ⑥ 최종발주 for-ship = held 에만(lines·ids 에 없음) ⑦ 사람이 [고친 대로 저장](PUT) = 다시 판정 · src edit · 표시 사라짐 ⑧ memo-add.js --dry 실제 실행(같은 가짜 서버)
//   실행: node scripts/verify-1108d-memo.js   (포트 PORT1108D 또는 3459)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path'); const express = require('express'); const { Pool } = require('pg'); const { execFile } = require('child_process');   // 비동기(같은 프로세스 안 가짜 서버를 부르므로 execFileSync 면 교착)
const ROOT = path.join(__dirname, '..');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const PORT = Number(process.env.PORT1108D || 3459), TOKEN = 'v1108d-token-' + 'x'.repeat(40), BY = 'verify1108d';
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (!c && d != null ? ' — ' + String(d).slice(0, 500) : '')); };
const P = { b1: '09991080001', r1: '09991080002', b2: '09991080003', r3: '09991080004', b4: '09991080005', b5: '09991080006', b6: '09991080007' };
async function cleanup() {
    await pool.query(`DELETE FROM order_memo_preorders WHERE order_key LIKE 'v1108d-%'`).catch(() => { });
    await pool.query(`DELETE FROM order_memo_entries WHERE created_by = $1`, [BY]).catch(() => { });
}
(async () => {
    const cfg = { order_memo_desk: null };
    const app = express(); app.use(express.json());
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    require(path.join(ROOT, 'order-memo.js')).mount(app, { pool, authMiddleware: (req, res, next) => { req.user = { id: 990108, name: '시험직원', position: '대리', role: 'user' }; next(); }, writeAudit: async () => { },
        adminActor: () => ({}), handleErr: (res, e) => res.status(e.status || 500).json({ ok: false, error: e.message }), cfgGet: async k => cfg[k] === undefined ? null : cfg[k], kstToday: () => today,
        shipCal: async () => ({ realToday: today, shipDays: [today], suggested: today }), anthropic: null, noTimers: true });
    const srv = app.listen(PORT); const base = `http://127.0.0.1:${PORT}`;
    const desk = async (body, tok = TOKEN) => { const r = await fetch(base + '/api/order-memo/desk', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desk-Token': tok }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
    try {
        await new Promise(r => setTimeout(r, 1500));   // ensure()·preEnsure() 표 준비
        await cleanup();
        const ins = (k, o) => pool.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, paid_at) VALUES ('naver', $1, $2, $3, $4, $5, $6, '시험 주소', $7, $8, NOW())`,
            ['v1108d-' + k, o.pno || null, o.bn || null, o.bd || '', o.rn || null, o.rd || '', o.op, o.q || 1]);
        await ins('a', { pno: '2026111190000001', bn: '시험가', bd: P.b1, rn: '시험나', rd: P.r1, op: '제철 고당도 타이벡감귤 가정용 - 5kg(로얄과)' });
        await ins('b', { pno: '2026111190000002', bn: '시험다', bd: P.b2, rn: '시험다', rd: P.b2, op: '그린레몬 3kg' });
        await ins('c', { pno: '2026111190000003', bn: null, bd: '', rn: '시험라', rd: P.r3, op: '하우스 황금향 선물용 3kg' });   // 선물하기 = 구매자 번호 없음
        await ins('d', { pno: '2026111190000004', bn: '시험동명', bd: P.b4, rn: '시험마', rd: P.b4, op: '제철 고당도 타이벡감귤 가정용 - 5kg(로얄과)' });
        await ins('e', { pno: '2026111190000005', bn: '시험동명', bd: P.b5, rn: '시험바', rd: P.b5, op: '제철 고당도 타이벡감귤 가정용 - 5kg(로얄과)' });
        await ins('f', { pno: '2026111190000006', bn: '시험사', bd: P.b6, rn: '시험사', rd: P.b6, op: '노지 황금향 가정용 5kg' });

        console.log('① 스위치·토큰');
        ok((await desk({ items: [{ type: 'size', value: 'S', phone: P.b1 }] })).s === 503, '설정 없음 = 503');
        cfg.order_memo_desk = { enabled: false, token: TOKEN }; ok((await desk({ items: [{ type: 'size', value: 'S', phone: P.b1 }] })).s === 503, '꺼짐 = 503');
        cfg.order_memo_desk = { enabled: true, token: TOKEN }; ok((await desk({ items: [{ type: 'size', value: 'S', phone: P.b1 }] }, 'wrong')).s === 401, '토큰 틀림 = 401');

        console.log('② 찾기 · ③ 판정 (dry)');
        const R = async it => (await desk({ items: [it] })).j.results[0];
        let x = await R({ type: 'size', value: 'S', phone: P.b1 });
        ok(x.ok && x.key === '099-9108-0001'.replace(/^099-9108-0001$/, x.key) && x.key.replace(/\D/g, '') === P.b1 && x.via === 'buyer_phone' && x.note === 'S사이즈' && !x.checked.from_recv && x.checked.as === 'buyer', '구매자 번호 = 그 번호 열쇠 · S사이즈', JSON.stringify(x));
        x = await R({ type: 'size', value: 's', phone: P.r1 });
        ok(x.ok && x.key.replace(/\D/g, '') === P.b1 && x.via === 'recv_phone' && x.checked.from_recv === true, '받는 분 번호 = 구매자 번호로 바꿈(from_recv)', JSON.stringify(x));
        x = await R({ type: 'gwa', value: '13', phone: P.r3 });
        ok(x.ok && x.key === '2026111190000003' && x.checked.as === 'order' && x.checked.pno === '2026111190000003' && x.note === '13과로!', '선물하기(구매자 번호 없음) = 상품주문번호 열쇠 · 과수 선물용 만감류 OK', JSON.stringify(x));
        x = await R({ type: 'size', value: 'M', name: '시험나' });
        ok(x.ok && x.key.replace(/\D/g, '') === P.b1 && x.via === 'recv_name', '받는 분 이름 하나 = 구매자 번호', JSON.stringify(x));
        x = await R({ type: 'size', value: 'S', name: '시험동명' });
        ok(!x.ok && x.why === 'multi' && x.candidates.length === 2, '같은 이름 구매자 둘 = multi · 후보만(넣지 않음)', JSON.stringify(x));
        x = await R({ type: 'size', value: 'S', name: '시험동명', phone: P.b5 });
        ok(x.ok && x.key.replace(/\D/g, '') === P.b5, '이름 + 번호 = 좁혀짐', JSON.stringify(x));
        x = await R({ type: 'sender', value: '김철수 드림', order_no: '2026111190000001' });
        ok(x.ok && x.via === 'order_no' && x.note === '보내는이 김철수 드림', '주문번호 = 찾음 · 보내는 이 꼴', JSON.stringify(x));
        x = await R({ type: 'size', value: 'S', phone: P.b2 }); ok(!x.ok && x.why === 'not_allowed', '레몬 주문 사이즈 = not_allowed', JSON.stringify(x));
        x = await R({ type: 'gwa', value: '12', phone: P.b6 }); ok(!x.ok && x.why === 'not_allowed', '노지 황금향 가정용 과수 = not_allowed', JSON.stringify(x));
        x = await R({ type: 'size', value: 'S', phone: '09991089999' }); ok(!x.ok && x.why === 'not_found', '없는 번호 = not_found');
        x = await R({ type: 'date', value: '2026-11-20', phone: P.b1 }); ok(x.ok && x.note === '11/20 발송' && x.ship_date === '2026-11-20', '발송일 = 「M/D 발송」 + ship_date', JSON.stringify(x));
        x = await R({ type: 'size', value: 'XL', phone: P.b1 }); ok(!x.ok && x.why === 'bad_value', '읽을 수 없는 값 = bad_value');
        const d0 = (await pool.query(`SELECT count(*)::int n FROM order_memo_entries WHERE created_by = $1`, [BY])).rows[0].n; ok(d0 === 0, 'dry = 저장 0');

        console.log('④ 넣기 = 확인 줄 · 최종발주 안 들어감');
        const add = await desk({ items: [{ type: 'size', value: 'S', phone: P.r1 }, { type: 'size', value: 'S', name: '시험동명' }], dry: false, by: BY, text: '시험 원문' });
        ok(add.j.ok && add.j.saved === 1 && add.j.rows.length === 1, '좋은 것만 저장(1줄) · multi 는 안 넣음', JSON.stringify(add.j));
        const row = add.j.rows[0] || {};
        const db = (await pool.query(`SELECT sure, check_why, src, line_key, note, checked, state FROM order_memo_rows WHERE id = $1`, [row.id])).rows[0] || {};
        ok(db.sure === false && (db.check_why || []).includes('에이전트가 넣음 · 확인 필요') && db.src === 'desk' && db.line_key.replace(/\D/g, '') === P.b1 && db.note === 'S사이즈' && db.checked && db.checked.from_recv === true && db.checked.desk === true && db.state === 'open', '확인 줄 = sure false · 「에이전트가 넣음 · 확인 필요」 · src desk · 구매자 번호 열쇠', JSON.stringify(db));
        const fs1 = await (await fetch(base + '/api/order-memo/for-ship?date=' + today)).json();
        ok(fs1.ok && (fs1.held || []).some(h => h.id === row.id) && !(fs1.lines || []).some(l => l.id === row.id) && !(fs1.ids || []).includes(row.id), '최종발주 for-ship = held 에만(lines·ids 에 없음)', JSON.stringify({ held: (fs1.held || []).filter(h => h.id === row.id), inLines: (fs1.lines || []).some(l => l.id === row.id) }));
        const lst = await (await fetch(base + '/api/order-memo')).json(); const li = (lst.entries || []).flatMap(e => e.rows || []).find(r => r.id === row.id);
        ok(li && li.sure === false && (li.check_why || []).includes('에이전트가 넣음 · 확인 필요'), '메모함 목록 = 「확인」 줄로 보임(화면은 check_why 글을 보여 줌)', JSON.stringify(li && { s: li.sure, w: li.check_why }));

        console.log('④-b 손질(워커3): miss = 0 · 하루 상한');
        await pool.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, option_text, qty, paid_at, miss) VALUES ('naver', 'v1108d-g', '2026111190000007', '시험아', '09991080008', '시험아', '09991080008', '제철 고당도 타이벡감귤 가정용 - 5kg(로얄과)', 1, NOW(), 1)`);
        x = await R({ type: 'size', value: 'S', phone: '09991080008' }); ok(!x.ok && x.why === 'not_found', '수집에서 한 번 안 보인 주문(miss 1) = 안 찾음(화면 배지와 같은 기준)', JSON.stringify(x));
        cfg.order_memo_desk = { enabled: true, token: TOKEN, daily_max: 1 };
        const cap = await desk({ items: [{ type: 'size', value: 'M', phone: P.b1 }], dry: false, by: BY });
        ok(cap.s === 429 && cap.j.daily_max === 1 && cap.j.used_today >= 1 && (await pool.query(`SELECT count(*)::int n FROM order_memo_rows r JOIN order_memo_entries e ON e.id = r.entry_id WHERE e.created_by = $1`, [BY])).rows[0].n === 1, '하루 상한(설정 1) 넘음 = 429 · 저장 0', JSON.stringify(cap));
        const capDry = await desk({ items: [{ type: 'size', value: 'M', phone: P.b1 }] });
        ok(capDry.s === 200 && capDry.j.results[0].ok, '판정만(dry)은 상한을 안 셈');
        cfg.order_memo_desk = { enabled: true, token: TOKEN };
        console.log('⑤ 사람이 [고친 대로 저장] = 다시 판정');
        const put = await (await fetch(base + '/api/order-memo/rows/' + row.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: db.line_key, note: db.note, plat: '네이버' }) })).json();
        const db2 = (await pool.query(`SELECT sure, check_why, src FROM order_memo_rows WHERE id = $1`, [row.id])).rows[0] || {};
        ok(put.ok !== false && db2.src === 'edit' && !(db2.check_why || []).includes('에이전트가 넣음 · 확인 필요'), 'PUT = src edit · 「에이전트가 넣음」 표시 사라짐(사람 확인 = 다시 판정)', JSON.stringify(db2));
        const fs2 = await (await fetch(base + '/api/order-memo/for-ship?date=' + today)).json();
        ok(db2.sure !== true || (fs2.lines || []).some(l => l.id === row.id) || (fs2.ids || []).includes(row.id), '확인된 줄(sure true)이면 이제 최종발주 길에 들어감', JSON.stringify({ sure: db2.sure }));

        console.log('⑥ 창구 도구 memo-add.js --dry');
        let outTxt = '';
        outTxt = await new Promise(res2 => execFile(process.execPath, [path.join(ROOT, 'scripts/desk/memo-add.js'), '--type', 'size', '--value', 'S', '--phone', P.r1], { env: Object.assign({}, process.env, { ORDER_MEMO_API: base, ORDER_MEMO_DESK_TOKEN: TOKEN }), encoding: 'utf8', timeout: 30000 }, (e, so, se) => res2(String(so || '') + String(se || ''))));
        ok(/✅ 넣을 수 있음 · size 「S사이즈」 · 네이버 · 열쇠 .*0001 · 찾은 길 받는 분 번호/.test(outTxt), 'memo-add.js --dry = 판정 한 줄(받는 분 번호 → 구매자 번호)', outTxt);
    } catch (e) { console.error(e); fail++; }
    finally { await cleanup().catch(() => { }); srv.close(); await pool.end(); }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();
