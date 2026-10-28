// #905 검증 — 발주 메모함 정리 = 기동 때 1회(지연 뒤 · 실패해도 기동 무관) + keep_days 응답(for-ship·clear) · 실DB·실AI·네트워크 0
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-905.js
//   (최종발주 띠의 「지난 날짜 n줄」 = 화면 글 · 실렌더 시험은 스크래치 ui905)
'use strict';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const OM = require(path.join(ROOT, 'order-memo.js'));
(async () => {
    const PGL = process.env.PGLITE_DIR;
    if (!PGL) { console.log('  (PGLITE_DIR 없음 — 건너뜀)'); return; }
    const { PGlite } = require(path.join(PGL, 'node_modules', '@electric-sql', 'pglite')), express = require(path.join(ROOT, 'node_modules', 'express'));
    const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
    const mk = async () => {
        const db = new PGlite(), conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v, log = [];
        const q = async (sql, p = []) => { log.push(sql); const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; };
        await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
        await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false, result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
        for (const x of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(x);
        return { db, log, pool: { query: q, connect: async () => ({ query: q, release() {} }) } };
    };
    const deps = (pool, extra) => Object.assign({ pool, authMiddleware: (req, res, next) => { req.user = { id: 990905, name: '검증', position: '', role: 'staff' }; next(); }, writeAudit: async () => {}, adminActor: req => ({ id: req.user.id }),
        handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }), cfgGet: async k => (k === 'order_memo' ? { keep_days: 15, unsure_days: 10, ai: { enabled: false } } : null), deskAlive: async () => false,
        kstToday: () => '2026-10-28', anthropic: null, shipCal: async () => ({ realToday: '2026-10-28', shipDays: ['2026-10-28'], suggested: '2026-10-28' }) }, extra);
    const purged = log => log.filter(s => /DELETE FROM order_memo_rows WHERE state = 'cleared'/.test(s)).length;

    console.log('① 기동 정리 1회');
    const A = await mk(); const appA = express(); appA.use(express.json());
    const apiA = OM.mount(appA, deps(A.pool, { noTimers: false, bootPurgeMs: 30 }));
    await apiA.ensure();
    await A.db.query(`INSERT INTO order_memo_entries (raw, created_at) VALUES ('옛', NOW() - INTERVAL '40 days')`);
    const eid = (await A.db.query(`SELECT id FROM order_memo_entries`)).rows[0].id;
    await A.db.query(`INSERT INTO order_memo_rows (entry_id, kind, line_key, sure, state, cleared_at) VALUES ($1,'line','010',true,'cleared', NOW() - INTERVAL '16 days'), ($1,'line','010',true,'cleared', NOW() - INTERVAL '14 days')`, [eid]);
    await A.db.query(`INSERT INTO order_memo_rows (entry_id, kind, line_key, sure, state, updated_at) VALUES ($1,'line','010',false,'open', NOW() - INTERVAL '11 days'), ($1,'line','010',false,'open', NOW() - INTERVAL '9 days')`, [eid]);
    const before = purged(A.log);
    await new Promise(r => setTimeout(r, 600));
    ok(purged(A.log) - before === 1, '기동 뒤(지연 30ms) 정리 1번 불림', purged(A.log) - before);
    const left = (await A.db.query(`SELECT state, sure, (cleared_by LIKE '자동 정리%') AS auto FROM order_memo_rows ORDER BY id`)).rows;
    ok(left.length === 3 && left.filter(r => r.state === 'cleared').length === 2 && left.filter(r => r.auto).length === 1 && left.filter(r => r.state === 'open').length === 1, 'keep_days 15 = 비운 지 16일 줄 영구 삭제(14일 줄 남음) · unsure_days 10 = 11일 된 확인 줄 비움(9일 줄 남음)', left);
    await new Promise(r => setTimeout(r, 300));
    ok(purged(A.log) - before === 1, '그 뒤 더 안 불림(6시간 타이머 그대로)');
    const B = await mk(); const appB = express(); appB.use(express.json());
    OM.mount(appB, deps(B.pool, { noTimers: true, bootPurgeMs: 10 }));
    await new Promise(r => setTimeout(r, 200));
    ok(purged(B.log) === 0, 'noTimers(검증) = 기동 정리 안 함(종전 그대로)');
    // 정리 실패해도 기동(라우트) 그대로 = ensure 전에 표 없는 pool 이 던져도 프로세스 안 죽음
    const C = { query: async () => { throw new Error('시험 — DB 끊김'); }, connect: async () => { throw new Error('x'); } }, errs = []; const ce = console.error; console.error = (...a) => errs.push(a.join(' '));
    let threw = false; try { const appC = express(); OM.mount(appC, deps(C, { noTimers: false, bootPurgeMs: 10 })); } catch (e) { threw = true; }
    await new Promise(r => setTimeout(r, 200)); console.error = ce;
    ok(!threw && errs.some(x => /기동 정리 실패/.test(x)), '정리 실패 = 로그 한 줄만 · mount 는 안 던짐', { threw, errs: errs.slice(0, 2) });

    console.log('③ keep_days 응답');
    const PORT = Number(process.env.PORT905) || 3478, srv = await new Promise(r => { const s = http.createServer(appA).listen(PORT, () => r(s)); });
    const call = async (m, u, b) => { const r = await fetch('http://127.0.0.1:' + PORT + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
    try {
        const fsh = await call('GET', '/api/order-memo/for-ship?date=2026-10-28');
        ok(fsh.s === 200 && fsh.j.keep_days === 15, 'for-ship 응답 keep_days 15', fsh.j.keep_days);
        const cl = await call('POST', '/api/order-memo/clear', { date: '2026-10-28' });
        ok(cl.s === 200 && cl.j.keep_days === 15, 'clear 응답 keep_days 15', cl.j);
        const ls = await call('GET', '/api/order-memo');
        ok(ls.s === 200 && ls.j.keep_days === 15, '목록 응답 keep_days 15(종전부터)', ls.j.keep_days);
    } finally { srv.close(); }
})().then(() => { console.log(`\n결과 ${pass}/${pass + failN}`); process.exit(failN ? 1 : 0); }).catch(e => { console.error(e); process.exit(1); });
