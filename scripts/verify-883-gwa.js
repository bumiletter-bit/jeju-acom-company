// #883 검증 — 메모 칸 과수 줄 「번호 13과로」(최종발주 core.gwaLines · 메모함 서버 ruleLine/checkLine) · 실DB·실AI·네트워크 0
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-883-gwa.js
//   ① core gwaLines(받는 꼴·못 읽는 꼴·안 읽는 꼴·사이즈 줄 뒤) ② 메모함 ruleLine·checkRow ③ API(pglite) 미리보기 = 규칙 줄 · AI 0 · 저장 · for-ship 메모 칸 글 그대로
//   최종발주 화면 쪽(만감류만 꼬리 · 카드 · 파일 · 자동 송장 짝)은 실렌더 시험(스크래치 ui883.js) · 무회귀는 508-ui A·B 와 과수 줄 없을 때 결과 파일 바이트 비교
'use strict';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const core = require(path.join(ROOT, 'public', 'final-order-core.js'));
const OM = require(path.join(ROOT, 'order-memo.js'));
(async () => {
    console.log('① core gwaLines');
    const G = t => core.gwaLines(t);
    const one = t => { const g = G(t); return g.gwas[0] || null; };
    ok(['010-1234-5678 13과로', '010-1234-5678 13과로!', '010-1234-5678 13과', '010-1234-5678 13과!', '010-1234-5678 과수 13', '010-1234-5678 과수13', '010-1234-5678 13과로 네이버', '010-1234-5678 13과로 부탁드려요'].every(t => { const g = G(t); return g.gwas.length === 1 && g.gwas[0].tail === '13과로!' && g.text === ''; }), '받는 꼴 8가지 = 「13과로!」 · 줄은 빈 줄(판매처·부탁 말만 남음)');
    const p2 = one('010-1234-5678 13과로 1건 15과로 2건');
    ok(p2 && JSON.stringify(p2.parts) === JSON.stringify([{ size: '13과로!', n: 1 }, { size: '15과로!', n: 2 }]) && JSON.stringify(core.boxTails(p2.parts, 3, x => x)) === JSON.stringify({ ok: true, boxes: [{ tail: '13과로!', qty: 1 }, { tail: '15과로!', qty: 2 }] }), '박스마다 = parts → boxTails 그대로(13과로! 1 · 15과로! 2)', p2);
    ok(one('010-1234-5678 15과로 2건').expect === 2, '「15과로 2건」 = 건수 2(사이즈 줄과 같게)');
    const b1 = G('010-1234-5678 13과로 15과로'), b2 = G('010-1234-5678 99과로');
    ok(!b1.gwas.length && b1.bad.length === 1 && b1.text === '010-1234-5678 13과로 15과로' && !b2.gwas.length && /1~40/.test(b2.bad[0].why), '못 읽는 꼴(건수 없는 박스별 · 41 이상) = bad · 줄 그대로', [b1, b2]);
    ok(['010-1234-5678 13과로 문앞', '010-1234-5678 13과 이상 큰걸로', '그냥 13과로 글', '010-1234-5678 S사이즈로'].every(t => { const g = G(t); return !g.gwas.length && !g.bad.length && g.text === t; }), '안 읽는 꼴(다른 한글 낱말 · 번호 없음 · 과수 아님) = 줄 그대로(오매칭 막기)');
    const d = G('010-1234-5678 13과로 10/30 발송');
    ok(d.gwas.length === 1 && d.text === '010-1234-5678 10/30 발송', '날짜 말은 남겨 v2 가 읽음(「번호 10/30 발송」)', d);
    const t = G('10/30\t010-1234-5678\t13과로\t네이버');
    ok(t.gwas.length === 1 && t.text === '10/30\t010-1234-5678\t\t네이버', '탭 줄 = 비고 칸만 비움(사이즈 줄과 같게)', t);
    const both = core.sizeLines('010-1234-5678 S사이즈로 13과로'), g2 = G(both.text);
    ok(both.sizes.length === 1 && g2.gwas.length === 1 && g2.text === '', '한 줄에 사이즈+과수 = 사이즈 줄이 먼저 떼고 과수 줄이 나머지를 읽음', [both, g2]);
    const none = '010-1234-5678 S사이즈로 네이버\n010-2222-3333 보내는이 홍길동\n10/30\t010-4444-5555\t입력o삭제x\t네이버\n010-6666-7777 오늘 발송';
    ok(G(none).text === none && !G(none).gwas.length, '과수 줄 없는 메모 칸 = 글 바이트 그대로');

    console.log('② 메모함 ruleLine · checkRow');
    const ctx = { today: '2026-10-27', catalog: new Set() };
    const rl = t => { const r = OM.ruleLine(t, ctx.today); return r && OM.checkRow(Object.assign({}, r), ctx); };
    const r1 = rl('010-1234-5678 13과로');
    ok(r1 && r1.kind === 'line' && r1.sure && r1.src === 'rule' && r1.line === '010-1234-5678 13과로' && r1.key === '010-1234-5678', '「번호 13과로」 = 규칙 줄 ✅(확인 없음) · 원문 그대로', r1);
    const r2 = rl('010-1234-5678 13과로 네이버');
    ok(r2 && r2.sure && r2.plat === '네이버' && r2.line === '010-1234-5678 13과로 네이버', '판매처 붙은 꼴도 ✅', r2);
    const r3 = rl('10/30\t010-1234-5678\t13과로\t네이버');
    ok(r3 && r3.sure && r3.ship_date === '2026-10-30' && r3.src === 'rule' && r3.line === '10/30\t010-1234-5678\t13과로\t네이버', '탭·날짜 줄 = 날짜 10/30 · 원문 그대로', r3);
    const r4 = rl('010-1234-5678 13과로 15과로'), r5 = rl('010-1234-5678 99과로');
    ok(r4 && !r4.sure && /건수를 같이/.test(r4.check_why.join()) && r5 && !r5.sure && /1~40/.test(r5.check_why.join()), '못 읽는 과수 줄 = 🟠 확인(이유 그대로)', [r4.check_why, r5.check_why]);
    ok(OM.ruleLine('010-1234-5678 13과로 문앞', ctx.today) === null, '다른 낱말 섞인 과수 줄 = AI 몫(null · 종전)');
    const ed = OM.checkRow({ kind: 'line', key: '010-1234-5678', note: '13과로 15과로', plat: '', src: 'edit', _bad: [] }, ctx);
    ok(!ed.sure && /건수를 같이/.test(ed.check_why.join()), '사람이 고친 줄도 checkLine 이 과수 bad 를 「확인」');
    ok(['010-1234-5678 S사이즈로', '010-1111-2222 보내는이 홍길동', '010-2222-3333 30일 발송'].every(x => JSON.stringify(OM.ruleLine(x, ctx.today)) === JSON.stringify(OM.ruleLine(x, ctx.today)) && OM.ruleLine(x, ctx.today) && OM.ruleLine(x, ctx.today).src === 'rule'), '사이즈·보내는이·날짜 줄 = 종전대로 규칙 줄');

    console.log('③ API(pglite) 미리보기 · 저장 · for-ship');
    const PGL = process.env.PGLITE_DIR;
    if (!PGL) { console.log('  (PGLITE_DIR 없음 — ③ 건너뜀)'); }
    else {
        const { PGlite } = require(path.join(PGL, 'node_modules', '@electric-sql', 'pglite'));
        const express = require(path.join(ROOT, 'node_modules', 'express'));
        const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
        const db = new PGlite();
        const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
        const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; };
        const pool = { query: q, connect: async () => ({ query: q, release() {} }) };
        await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
        await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false, result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
        for (const x of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(x);
        let aiCalls = 0;
        const app = express(); app.use(express.json());
        const auth = (req, res, next) => { req.user = { id: 990883, name: '검증', position: '', role: 'staff' }; next(); };
        const api = OM.mount(app, { pool, authMiddleware: auth, writeAudit: async () => {}, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }),
            cfgGet: async k => (k === 'order_memo' ? { ai: { direct: true } } : null), deskAlive: async () => false, kstToday: () => '2026-10-27', noTimers: true,
            anthropic: { messages: { create: async () => { aiCalls++; return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ lines: [], cash: [], unsure: [], sms_draft: '' }) }] }; } } },
            shipCal: async () => ({ realToday: '2026-10-27', shipDays: ['2026-10-27', '2026-10-28'], suggested: '2026-10-27' }) });
        const PORT = Number(process.env.PORT883) || 3474;
        const srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, () => r(s)); });
        const call = async (m, u, b) => { const r = await fetch('http://127.0.0.1:' + PORT + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
        try {
            await api.ensure();
            const pv = await call('POST', '/api/order-memo/preview', { raw: '010-1234-5678 13과로\n010-2222-3333 S사이즈로 네이버' });
            ok(pv.s === 200 && pv.j.rule_count === 2 && aiCalls === 0 && pv.j.rows.every(r => r.kind === 'line' && r.sure), '미리보기 = 과수 줄·사이즈 줄 둘 다 규칙 ✅ · AI 0', pv.j);
            const sv = await call('POST', '/api/order-memo', { raw: 'x', rows: pv.j.rows });
            const fs1 = (await call('GET', '/api/order-memo/for-ship?date=2026-10-27')).j;
            ok(sv.s === 200 && fs1.memo_text === '010-1234-5678 13과로\n010-2222-3333 S사이즈로 네이버' && fs1.lines.every(l => l.state === 'nodate'), 'for-ship 메모 칸 = 적은 그대로 두 줄(최종발주가 과수·사이즈를 읽음)', fs1);
            const fo = core.gwaLines(core.sizeLines(fs1.memo_text).text);
            ok(fo.gwas.length === 1 && fo.gwas[0].tail === '13과로!' && fo.text === '\n', '그 메모 칸을 최종발주 core 가 = 과수 1 · 사이즈 1 · 남는 글 없음');
            const pv2 = await call('POST', '/api/order-memo/preview', { raw: '010-1234-5678 13과로 문앞' });
            ok(pv2.j.rule_count === 0 && aiCalls === 1, '다른 낱말 섞인 과수 줄 = 미리보기에서 AI 로(종전 길)');
        } finally { srv.close(); }
    }
    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
