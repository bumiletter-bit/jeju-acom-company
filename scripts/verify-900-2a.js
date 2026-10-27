// #900-2A 검증 — 명절 전 메모함 상한 ①「오늘 씀」 2,000줄 + 화면 500줄씩 나눠 보내기 ②열린 줄 목록 묶음 상한 없음(비운 것 = 200 그대로) · 실DB·실AI·네트워크 0
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-900-2a.js
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const OM = require(path.join(ROOT, 'order-memo.js'));
(async () => {
    console.log('① 화면 omPost = 500줄씩 차례로 · 실패 1회 재시도 · 그래도 실패면 띠');
    const src = fs.readFileSync(path.join(ROOT, 'public', 'final-order.js'), 'utf8');
    const mW = src.match(/const omWarn = n => \{[^\n]*\};/), m = src.match(/const omPost = async \(ids, undo\) => \{[^\n]*\};/);
    ok(!!m && !!mW, 'final-order.js 에 omWarn · 나눠 보내는 omPost 있음');
    // 가짜 띠(fo-om-band) — appendChild·querySelectorAll·hidden 만
    const mkBand = () => { const kids = []; return { hidden: true, kids, innerHTML: '<b>넣었어요</b>', appendChild(d) { kids.push(d); }, querySelectorAll() { return kids.slice().map(k => ({ remove() { kids.splice(kids.indexOf(k), 1); } })); } }; };
    const mkCtx = api => { const band = mkBand(); const c = { band, OMF: { date: '2026-10-27' }, $: id => (id === 'fo-om-band' ? band : null), document: { createElement: () => ({ className: '', textContent: '' }) }, setTimeout: (f) => setTimeout(f, 1), window: { api } };
        vm.createContext(c); vm.runInContext(mW[0].replace('const omWarn', 'this.omWarn') + '\n' + m[0].replace('const omPost', 'this.omPost').replace(/omWarn\(/g, 'this.omWarn('), c); return c; };
    if (m && mW) {
        const calls = []; let open = 0, maxOpen = 0;
        const ctx = mkCtx(async (u, meth, body) => { open++; maxOpen = Math.max(maxOpen, open); calls.push({ u, meth, n: body.ids.length, first: body.ids[0], date: body.date, undo: !!body.undo }); await new Promise(r => setTimeout(r, 5)); open--; return { ok: true }; });
        const ids = Array.from({ length: 1234 }, (_, i) => i + 1);
        const miss0 = await ctx.omPost(ids, false);
        ok(calls.map(c => c.n).join() === '500,500,234' && calls.every(c => c.u === '/api/order-memo/used' && c.meth === 'POST' && c.date === '2026-10-27' && !c.undo), '1,234줄 = 500·500·234 세 번 · 같은 날짜', calls);
        ok(calls.map(c => c.first).join() === '1,501,1001' && maxOpen === 1, '순서대로 한 번에 하나(겹침 0)', { first: calls.map(c => c.first), maxOpen });
        ok(miss0 === 0 && ctx.band.kids.length === 0 && ctx.band.innerHTML === '<b>넣었어요</b>', '다 성공 = 띠 그대로(경고 줄 0)', { miss0, kids: ctx.band.kids.length });
        calls.length = 0; await ctx.omPost(ids.slice(0, 300), true);
        ok(calls.length === 1 && calls[0].n === 300 && calls[0].undo, '500줄 이하 = 한 번(종전과 같은 요청 하나) · undo 그대로', calls);
        calls.length = 0; await ctx.omPost([], false);
        ok(calls.length === 0, '빈 목록 = 요청 0(종전과 같음)');
        // 실패 꼴 = 둘째 묶음이 첫 번 실패 → 재시도 성공 · 셋째 묶음은 두 번 다 실패
        const tries = []; const fctx = mkCtx(async (u, meth, body) => { const k = body.ids[0]; tries.push(k); const n = tries.filter(x => x === k).length; if (k === 501 && n === 1) throw new Error('x'); if (k === 1001) throw new Error('x'); return { ok: true }; });
        let threw = false, miss = -1; try { miss = await fctx.omPost(ids, false); } catch (_) { threw = true; }
        ok(!threw && tries.join() === '1,501,501,1001,1001', '실패 묶음 = 1회 재시도(501 재시도 성공 · 1001 두 번 실패) · 던지지 않음', tries);
        const w = fctx.band.kids[0];
        ok(miss === 234 && fctx.band.kids.length === 1 && !fctx.band.hidden && w && w.textContent === '⚠ 메모함 234줄은 「오늘 씀」 표시를 못 했어요 · 비우기 전에 메모함 확인' && fctx.band.innerHTML === '<b>넣었어요</b>', '그래도 실패 = 띠에 경고 한 줄(234줄 · 앞 글 유지)', { miss, kids: fctx.band.kids.map(k => k.textContent), hidden: fctx.band.hidden });
        await fctx.omPost(ids, false);
        ok(fctx.band.kids.length === 1, '다시 보내도 경고 줄은 하나(겹쳐 쌓이지 않음)', fctx.band.kids.length);
        const uctx = mkCtx(async () => { throw new Error('x'); });
        const um = await uctx.omPost(ids.slice(0, 10), true);
        ok(um === 10 && uctx.band.kids.length === 0, '되돌리기 실패 = 경고 줄 없음(이중 발송 쪽 아님)', { um, kids: uctx.band.kids.length });
    }

    const PGL = process.env.PGLITE_DIR;
    if (!PGL) { console.log('  (PGLITE_DIR 없음 — API 건너뜀)'); return; }
    console.log('② API(pglite) — 1,200줄 · 묶음 250');
    const { PGlite } = require(path.join(PGL, 'node_modules', '@electric-sql', 'pglite')), express = require(path.join(ROOT, 'node_modules', 'express'));
    const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
    const db = new PGlite(), conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
    const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; };
    const pool = { query: q, connect: async () => ({ query: q, release() {} }) };
    await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
    await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false, result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
    for (const x of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(x);
    const app = express(); app.use(express.json({ limit: '15mb' }));
    const auth = (req, res, next) => { req.user = { id: 990900, name: '검증', position: '', role: 'staff' }; next(); };
    const api = OM.mount(app, { pool, authMiddleware: auth, writeAudit: async () => {}, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }),
        cfgGet: async k => (k === 'order_memo' ? { ai: { enabled: false } } : null), deskAlive: async () => false, kstToday: () => '2026-10-27', noTimers: true, anthropic: null,
        shipCal: async () => ({ realToday: '2026-10-27', shipDays: ['2026-10-27'], suggested: '2026-10-27' }) });
    const PORT = Number(process.env.PORT900) || 3476, srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, () => r(s)); });
    const call = async (meth, u, b) => { const r = await fetch('http://127.0.0.1:' + PORT + u, { method: meth, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
    try {
        await api.ensure(); await new Promise(r => setTimeout(r, 200));
        // 열린 묶음 250 × 줄 4~6(합 1,200) + 비운 묶음 250 × 1줄
        let nOpen = 0;
        for (let e = 1; e <= 250; e++) {
            const id = (await db.query(`INSERT INTO order_memo_entries (raw) VALUES ($1) RETURNING id`, ['검증 ' + e])).rows[0].id;
            const k = e <= 100 ? 6 : 4;
            for (let j = 0; j < k; j++) { await db.query(`INSERT INTO order_memo_rows (entry_id, kind, line_key, note, sure) VALUES ($1, 'line', $2, '입력o삭제x', true)`, [id, '010-3300-' + String(1000 + nOpen % 9000)]); nOpen++; }
        }
        for (let e = 1; e <= 250; e++) {
            const id = (await db.query(`INSERT INTO order_memo_entries (raw) VALUES ($1) RETURNING id`, ['비움 ' + e])).rows[0].id;
            await db.query(`INSERT INTO order_memo_rows (entry_id, kind, line_key, note, sure, state, cleared_at) VALUES ($1, 'line', '010-3300-0001', 'x', true, 'cleared', NOW())`, [id]);
        }
        ok(nOpen === 1200, '열린 줄 1,200 · 묶음 250 넣음', nOpen);
        const lo = await call('GET', '/api/order-memo');
        const shown = lo.j.entries ? lo.j.entries.reduce((n, e) => n + e.rows.length, 0) : -1;
        ok(lo.s === 200 && lo.j.entries.length === 250 && shown === 1200 && lo.j.counts.open === 1200, '열린 줄 목록 = 묶음 250 전부 · 줄 1,200 전부(종전은 묶음 200 = 줄 1,000 · 오래된 50묶음 200줄 안 보임)', { s: lo.s, entries: lo.j.entries && lo.j.entries.length, shown, open: lo.j.counts && lo.j.counts.open });
        ok(lo.j.entries[0].id > lo.j.entries[lo.j.entries.length - 1].id, '순서 = 최근 묶음 먼저(종전 그대로)');
        const lc = await call('GET', '/api/order-memo?state=cleared');
        ok(lc.s === 200 && lc.j.entries.length === 200 && lc.j.counts.cleared === 250, '비운 것 목록 = 묶음 200 상한 그대로(세는 수는 250)', { s: lc.s, entries: lc.j.entries && lc.j.entries.length, cleared: lc.j.counts && lc.j.counts.cleared });
        console.log('   (열린 목록 응답 크기 ' + Math.round(JSON.stringify(lo.j).length / 1024) + 'KB)');
        const all = (await db.query(`SELECT id FROM order_memo_rows WHERE state = 'open' ORDER BY id`)).rows.map(r => r.id);
        // 「오늘 씀」 = 화면이 500줄씩 세 번 → 1,200 전부
        let n = 0; for (let i = 0; i < all.length; i += 500) { const r = await call('POST', '/api/order-memo/used', { date: '2026-10-27', ids: all.slice(i, i + 500) }); n += r.j.n; }
        const used = Number((await db.query(`SELECT COUNT(*)::int AS n FROM order_memo_rows WHERE used_on = '2026-10-27'`)).rows[0].n);
        ok(n === 1200 && used === 1200, '500줄씩 세 번 = 1,200줄 전부 「오늘 씀」(종전은 한 번에 보내면 501줄째부터 안 찍힘)', { n, used });
        const un = await call('POST', '/api/order-memo/used', { date: '2026-10-27', ids: all, undo: true });
        ok(un.s === 200 && un.j.n === 1200, '되돌리기 1,200줄 한 번(서버 상한 2,000 안)', un.j);
        const big = Array.from({ length: 2500 }, (_, i) => all[i % all.length] + (i >= all.length ? 100000 : 0));
        const bg = await call('POST', '/api/order-memo/used', { date: '2026-10-27', ids: big });
        ok(bg.s === 200 && bg.j.n === 1200, '2,500개 보내도 앞 2,000개까지만 봄(없는 번호는 0) = 1,200', bg.j);
        await call('POST', '/api/order-memo/used', { date: '2026-10-27', ids: all, undo: true });
        const fs2 = await call('GET', '/api/order-memo/for-ship?date=2026-10-27');
        ok(fs2.s === 200 && (fs2.j.ids || []).length === 1200, 'for-ship = 1,200줄 전부(상한 없음 · 종전 그대로)', { s: fs2.s, n: (fs2.j.ids || []).length });
    } finally { srv.close(); }
})().then(() => { console.log(`\n결과 ${pass}/${pass + failN}`); process.exit(failN ? 1 : 0); }).catch(e => { console.error(e); process.exit(1); });
