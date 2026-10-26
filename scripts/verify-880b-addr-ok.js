// #880-b 검증 — 메모함 현금 줄 주소 「이대로 둘게요」 서버 저장(addr_ok) · 실DB·실AI·네트워크 0
//   DB = 이 PC 메모리 안 Postgres(pglite · 실제 SQL 그대로 · ALTER 도 여기서만) · 서버 = express 를 이 스크립트 안에서 띄움(포트 3473 · 로그인 가짜)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-880b-addr-ok.js
'use strict';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const PGL = process.env.PGLITE_DIR;
if (!PGL) { console.log('PGLITE_DIR 가 없어요 — npm i @electric-sql/pglite 한 폴더를 주세요'); process.exit(2); }
const { PGlite } = require(path.join(PGL, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const OM = require(path.join(ROOT, 'order-memo.js'));
const PORT = Number(process.env.PORT880) || 3473;
const OPT = '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)';
const ADDR = '울산광역시 북구 양동5길 3-1, 1층';
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) {
    const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
    const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; };
    return { query: q, connect: async () => ({ query: q, release() {} }) };
}
(async () => {
    const T = '2026-10-27';
    const db = new PGlite();
    await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
    await db.query(`INSERT INTO pricing (partner, start_date, end_date, items) VALUES ('대성(시온)', '2026-01-01', '2026-12-31', $1)`, [JSON.stringify([{ name: OPT, price: 1 }])]);
    await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false, result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
    for (const q of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(q);
    const pool = mkPool(db), audits = [];
    const app = express(); app.use(express.json());
    let who = { id: 990880, name: '검증', position: '' };
    const auth = (req, res, next) => { req.user = Object.assign({ role: 'staff' }, who); next(); };
    const api = OM.mount(app, { pool, authMiddleware: auth, writeAudit: async a => { audits.push(a); }, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }),
        cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => T, noTimers: true, anthropic: null,
        shipCal: async () => ({ realToday: T, shipDays: [T, '2026-10-28'], suggested: T }) });
    const srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, () => r(s)); });
    const call = async (method, url, body) => { const r = await fetch('http://127.0.0.1:' + PORT + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
    const list = async () => (await call('GET', '/api/order-memo')).j.entries.flatMap(e => e.rows);
    try {
        await api.ensure();
        const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'order_memo_rows' AND column_name = 'addr_ok'`)).rows;
        ok(cols.length === 1, '기동 = addr_ok JSONB 칸 생김(ALTER ADD COLUMN IF NOT EXISTS · 이 시험 DB 에서만)');
        await api.ensure();
        const cells = ['홍가동 드림!', '010-1000-2000', 'O', '이가윤', OPT, '1', '010-3000-4000', '', ADDR, '', '010-1000-2000', '', ''];
        const sv = await call('POST', '/api/order-memo', { raw: 'x', rows: [{ kind: 'cash', cells, src: 'edit' }, { kind: 'line', key: '010-5555-6666', note: 'S사이즈로', plat: '네이버', line: '010-5555-6666 S사이즈로 네이버', src: 'rule' }] });
        const cid = sv.j.rows[0].id, lid = sv.j.rows[1].id;
        ok(sv.s === 200 && sv.j.rows[0].addr_ok === null && !('addr_ok' in sv.j.rows[1]), '저장 응답 = 현금 줄 addr_ok null · 메모 줄엔 칸 없음', sv.j.rows.map(r => r.addr_ok));
        const fs0 = (await call('GET', '/api/order-memo/for-ship?date=' + T)).j;
        const bad = await call('POST', `/api/order-memo/rows/${cid}/addr-ok`, { raw: ADDR + ' 2층' });
        ok(bad.s === 409 && (await list()).find(r => r.id === cid).addr_ok === null, '화면이 본 주소 ≠ 지금 주소 = 409 · 저장 0', bad.j);
        ok((await call('POST', `/api/order-memo/rows/${cid}/addr-ok`, { raw: '' })).s === 409, '빈 raw = 409');
        const g = await call('POST', `/api/order-memo/rows/${cid}/addr-ok`, { raw: '  ' + ADDR + ' ' });
        ok(g.s === 200 && g.j.row.addr_ok && g.j.row.addr_ok.raw === ADDR && g.j.row.addr_ok.by_name === '검증' && !isNaN(Date.parse(g.j.row.addr_ok.at)), '같은 주소(앞뒤 빈칸 무시) = 저장 {raw, at, by_name}', g.j.row.addr_ok);
        who = { id: 990881, name: '다른직원', position: '팀장' };
        const l1 = (await list()).find(r => r.id === cid);
        ok(l1.addr_ok && l1.addr_ok.raw === ADDR && l1.addr_ok.by_name === '검증', '다른 직원 목록에도 addr_ok 그대로(다시 열어도 남음)', l1.addr_ok);
        const fs1 = (await call('GET', '/api/order-memo/for-ship?date=' + T)).j;
        ok(JSON.stringify(fs1) === JSON.stringify(fs0) && !JSON.stringify(fs1).includes('addr_ok'), 'for-ship(메모 칸·cash_aoa·ids) = 저장 전과 바이트 동일 · addr_ok 안 나감');
        ok(audits.filter(a => /^addr_ok/.test(a.action)).length === 1 && JSON.stringify(audits.find(a => a.action === 'addr_ok').changes) === JSON.stringify({ after: { n: 1 } }), '감사 = addr_ok 1줄 · 숫자만(주소·이름 0)', audits.filter(a => /^addr_ok/.test(a.action)));
        // 주소가 바뀌면 = 서버는 안 지움 · raw 가 달라 화면이 무효로 봄
        const c2 = cells.slice(); c2[8] = '울산광역시 북구 양동5길 31';
        const pu = await call('PUT', `/api/order-memo/rows/${cid}`, { cells: c2 });
        ok(pu.s === 200 && pu.j.row.addr_ok && pu.j.row.addr_ok.raw === ADDR && pu.j.row.cells[8] !== pu.j.row.addr_ok.raw, '주소 고치기(PUT) 뒤 = addr_ok 그대로 · raw ≠ 새 주소(화면 무효 판정)', pu.j.row.addr_ok);
        const u = await call('POST', `/api/order-memo/rows/${cid}/addr-ok`, { undo: true });
        ok(u.s === 200 && u.j.row.addr_ok === null && (await list()).find(r => r.id === cid).addr_ok === null, '{undo:true} = 지움', u.j);
        ok((await call('POST', `/api/order-memo/rows/${lid}/addr-ok`, { raw: 'x' })).s === 400, '메모 줄 = 400');
        await call('DELETE', `/api/order-memo/rows/${cid}`);
        ok((await call('POST', `/api/order-memo/rows/${cid}/addr-ok`, { raw: c2[8] })).s === 409, '비운 줄 = 409');
        ok((await call('POST', `/api/order-memo/rows/999999/addr-ok`, { raw: 'x' })).s === 404, '없는 줄 = 404');
    } finally { srv.close(); }
    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
