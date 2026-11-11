// #1130 검증 — 상품문의·주문문의 [초안 만들기]·[지우기] 서버(inbox-threads.js 실코드 · 가짜 deps)
//   🔴 실DB·네이버·AI 호출 0 · DB = 이 PC 메모리 pglite · 포트 PORT1130(기본 3473)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-1130.js
'use strict';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 500))); };
if (!process.env.PGLITE_DIR) { console.log('PGLITE_DIR 필요'); process.exit(2); }
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) { const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const db = new PGlite(), pool = mkPool(db);
    await db.query(`CREATE TABLE message_logs (id SERIAL PRIMARY KEY, user_id TEXT, message TEXT, response TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await db.query(`CREATE TABLE talk_outbox (id SERIAL PRIMARY KEY)`);
    await db.query(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW())`);
    for (const [t, idc, idt] of [['naver_qnas', 'question_id', 'BIGINT'], ['naver_inquiries', 'inquiry_id', 'TEXT']])
        await db.query(`CREATE TABLE ${t} (${idc} ${idt} PRIMARY KEY, raw JSONB, answered BOOLEAN DEFAULT false, ai_status VARCHAR(10), ai_scenarios JSONB, ai_draft TEXT, posted_at TIMESTAMP, posted_by VARCHAR(50), post_error TEXT, collected_at TIMESTAMP DEFAULT NOW())`);
    await db.query(`INSERT INTO naver_qnas (question_id, raw, ai_status) VALUES (101, $1, 'staff'), (102, $2, 'draft')`, [JSON.stringify({ question: '귤 언제 와요?', product_name: '타이벡 5kg', create_date: new Date().toISOString() }), JSON.stringify({ question: '이미 답한 글', product_name: '타이벡', create_date: new Date().toISOString(), answer: '답' })]);
    await db.query(`UPDATE naver_qnas SET answered = true, posted_at = NOW(), posted_by = '직원' WHERE question_id = 102`);
    await db.query(`INSERT INTO naver_inquiries (inquiry_id, raw, ai_status, ai_draft) VALUES ('5001', $1, 'staff', NULL), ('5002', $2, 'draft', '옛 초안 그대로')`, [JSON.stringify({ title: '배송', content: '언제 보내요', product_name: '노지감귤', registered_at: new Date().toISOString() }), JSON.stringify({ title: '옛', content: '옛 글', registered_at: new Date().toISOString() })]);
    const calls = { qna: [], inq: [] };
    const genQna = async (q, p) => { calls.qna.push([q, p]); await sleep(50); return { answer: '상품문의 초안: ' + q, used: ['배송'] }; };
    const genInquiry = async item => { calls.inq.push(item); await sleep(400); return { answer: '주문문의 초안: ' + item.content, used: ['발송'] }; };
    const auth = (req, res, next) => { req.user = { id: 991130, name: '검증', role: 'user' }; next(); };
    const mount = async (port, gens) => { const app = express(); app.use(express.json()); const api = require(path.join(ROOT, 'inbox-threads.js'))(app, Object.assign({ pool, authMiddleware: auth, writeAudit: async () => {}, testMode: true, tables: {} }, gens)); if (api.ensure) await api.ensure(); const srv = await new Promise(r => { const s = http.createServer(app).listen(port, '127.0.0.1', () => r(s)); });
        const call = async (method, url, body) => { const r = await fetch('http://127.0.0.1:' + port + url, { method, headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
        return { srv, call }; };
    const P = Number(process.env.PORT1130) || 3473;
    const A = await mount(P, { genQna, genInquiry });
    try {
        console.log('Ⅰ 상세 = 답 안 된 건만 [초안 만들기]');
        let r = await A.call('GET', '/api/inbox/threads/qna/101?peek=1'); ok(r.s === 200 && r.j.can_draft === true && !r.j.draft && r.j.thread.why === '직원 답 필요', '상품문의 101(사람 몫 · 초안 없음) = can_draft true · 초안 없음 · 「직원 답 필요」', [r.s, r.j.can_draft, r.j.draft, r.j.thread && r.j.thread.why]);
        r = await A.call('GET', '/api/inbox/threads/qna/102?peek=1'); ok(r.j.can_draft === false && r.j.can_send === false, '답한 상품문의 = can_draft false', [r.j.can_draft, r.j.can_send]);
        r = await A.call('GET', '/api/inbox/threads/inquiry/5002?peek=1'); ok(r.j.can_draft === true && r.j.draft === '옛 초안 그대로', '옛 미리 만든 초안(5002) = 종전대로 draft 채움 + 다시 만들기 가능', [r.j.can_draft, r.j.draft]);
        console.log('Ⅱ 초안 만들기');
        r = await A.call('POST', '/api/inbox/threads/qna/101/draft', {}); let row = (await db.query(`SELECT ai_draft, ai_status, ai_scenarios FROM naver_qnas WHERE question_id = 101`)).rows[0];
        ok(r.s === 200 && r.j.ok && r.j.draft === '상품문의 초안: 귤 언제 와요?' && row.ai_draft === r.j.draft && row.ai_status === 'staff' && JSON.stringify(row.ai_scenarios) === '["배송"]' && JSON.stringify(calls.qna[0]) === JSON.stringify(['귤 언제 와요?', '타이벡 5kg']), '상품문의 = genQna(질문, 상품) 1회 · ai_draft 저장 · ai_status 그대로(staff) · used 저장', [r.s, r.j, row, calls.qna]);
        r = await A.call('GET', '/api/inbox/threads/qna/101?peek=1'); ok(r.j.draft === '상품문의 초안: 귤 언제 와요?', '다시 열면 그 초안', r.j.draft);
        const [x1, x2] = await Promise.all([A.call('POST', '/api/inbox/threads/inquiry/5001/draft', {}), (async () => { await sleep(60); return A.call('POST', '/api/inbox/threads/inquiry/5001/draft', {}); })()]);
        ok(x1.s === 200 && x1.j.draft === '주문문의 초안: 언제 보내요' && x2.s === 409 && x2.j.code === 'busy' && calls.inq.length === 1, '주문문의 = genInquiry(raw) · 같은 문의 동시 누름 = 둘째 409 busy · 생성 1회', [x1.s, x1.j, x2.s, x2.j, calls.inq.length]);
        r = await A.call('POST', '/api/inbox/threads/qna/102/draft', {}); ok(r.s === 409 && calls.qna.length === 1, '답한 문의 = 409 · 생성 0', [r.s, r.j, calls.qna.length]);
        const st = (await db.query(`SELECT value FROM agent_office_config WHERE key = 'inbox_threads_verify_state'`)).rows[0]; ok(st && st.value.n === 2, '하루 셈 = 톡톡과 같은 칸에 +1씩(성공 2)', st);
        await db.query(`INSERT INTO agent_office_config (key, value) VALUES ('inbox_threads_verify', '{"draft_daily_cap":2}')`);
        r = await A.call('POST', '/api/inbox/threads/qna/101/draft', {}); ok(r.s === 429 && r.j.code === 'draft_cap', '상한 2 다 씀 = 429 draft_cap', [r.s, r.j]);
        await db.query(`DELETE FROM agent_office_config WHERE key = 'inbox_threads_verify'`);
        console.log('Ⅲ 지우기 = 본 글 그대로일 때만');
        r = await A.call('POST', '/api/inbox/threads/qna/101/draft-clear', { seen: '다른 글' }); row = (await db.query(`SELECT ai_draft FROM naver_qnas WHERE question_id = 101`)).rows[0];
        ok(r.s === 200 && r.j.cleared === false && row.ai_draft, '다른 글 = 안 지움', [r.j, row]);
        r = await A.call('POST', '/api/inbox/threads/qna/101/draft-clear', { seen: '  상품문의 초안: 귤 언제 와요?\n' }); row = (await db.query(`SELECT ai_draft, ai_status FROM naver_qnas WHERE question_id = 101`)).rows[0];
        ok(r.j.cleared === true && row.ai_draft === null && row.ai_status === 'staff', '같은 글(앞뒤 빈칸 무시) = ai_draft NULL · 상태 그대로', [r.j, row]);
        r = await A.call('POST', '/api/inbox/threads/qna/102/draft-clear', { seen: '' }); ok(r.j.cleared === false, '답한 문의 = 안 지움', r.j);
        r = await A.call('POST', '/api/inbox/threads/inquiry/5001/draft-clear', {}); ok(r.s === 400, 'seen 없음 = 400', r.s);
        console.log('Ⅳ 톡톡 길 종전');
        r = await A.call('POST', '/api/inbox/threads/talk/zzz/draft-clear', { seen: 'x' }); ok(r.s === 404 && /없는 대화/.test(r.j.error || r.j.message || JSON.stringify(r.j)), '톡톡 지우기 = 종전 검사(404 없는 대화)', [r.s, r.j]);
    } finally { await new Promise(r => A.srv.close(r)); }
    console.log('Ⅴ server.js 가 생성 함수를 안 넘긴 옛 꼴');
    const B = await mount(P + 1, {});
    try {
        let r = await B.call('GET', '/api/inbox/threads/qna/101?peek=1'); ok(r.j.can_draft === false, '생성 함수 없음 = can_draft false(단추 안 보임)', r.j.can_draft);
        r = await B.call('POST', '/api/inbox/threads/qna/101/draft', {}); ok(r.s === 400 && /지금은 초안을 만들 수 없어요/.test(JSON.stringify(r.j)), '누르면 400 「지금은 초안을 만들 수 없어요」', [r.s, r.j]);
    } finally { await new Promise(r => B.srv.close(r)); }
    console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
