// #1155 검증 — 문자 창 구매이력 「발송 전」 줄 = 받는 분·구매자 이름 전체 + 상품주문번호(직원 화면 전용 · sms/index.js staffHistoryRead 실코드)
//   🔴 실DB·네이버·AI·발송 0 · DB = 메모리 pglite · 포트 PORT1155(기본 3458 · 이 스크립트 안에서만)
//   실행: PGLITE_DIR=<pglite 가 설치된 폴더> PORT1155=3458 node scripts/verify-1155-pre-names.js [리포 루트]
//   ① 메모함 표(order_memo_preorders)에 이름이 있으면 recipient_name = 전체 · buyer_name · order_no · order_nos · recipient_initial(성) 칸
//   ② 메모함 표에 줄이 없으면 종전(성 한 글자 · 새 칸 null) ③ 메모함 표 자체가 없는 서버 = 종전 SELECT 로 물러남(목록 그대로)
//   ④ 묶음 꼴·수량 합·발송된 줄 무변 ⑤ 한 줄 요약(order_hint)·초안 AI 글·알림에 이름 전체·주문번호 0
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = process.argv[2] || path.join(__dirname, '..'); const PORT = Number(process.env.PORT1155 || 3458);
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 900))); };
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) { const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }
const kst = off => new Date(Date.now() + 9 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
const OMSRC = fs.readFileSync(path.join(ROOT, 'order-memo.js'), 'utf8');
const MEMO_DDL = OMSRC.match(/CREATE TABLE IF NOT EXISTS order_memo_preorders \([\s\S]*?UNIQUE \(channel, order_key\)\)/)[0];

async function boot(withMemo) {
    const db = new PGlite(), pool = mkPool(db);
    await db.query(`CREATE TABLE delivery_shipments (tracking text PRIMARY KEY, ship_date date NOT NULL, partner text, recipient text, phone text, addr text, option_text text, qty integer, memo text, source text DEFAULT 'index', uploaded_at timestamptz DEFAULT now(), buyer_phone text)`);
    await db.query(`CREATE TABLE delivery_status (tracking text PRIMARY KEY, bucket text, code text, label text, msg text, event_time text, branch text, driver_name text, driver_phone text, events jsonb, delivered boolean DEFAULT false, checked_at timestamptz DEFAULT now(), first_trouble_at timestamptz)`);
    await db.query(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW())`);
    await db.query(`ALTER TABLE delivery_shipments ADD COLUMN phone_digits text GENERATED ALWAYS AS (regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) STORED`);
    await db.query(`ALTER TABLE delivery_shipments ADD COLUMN buyer_digits text GENERATED ALWAYS AS (regexp_replace(COALESCE(buyer_phone, ''), '[^0-9]', '', 'g')) STORED`);
    if (withMemo) await db.query(MEMO_DDL);
    const aiQs = [], notes = [], tg = [], cfgStore = { sms_gateway: { enabled: true, mode: 'draft', hold_sec: 0, max_chars: 1000, staff_ids: [1] } };
    const deps = { testMode: true, pool, authMiddleware: (req, res, next) => { req.user = { id: 1, name: '검증', role: 'admin' }; next(); },
        naverCfgGet: async k => cfgStore[k] === undefined ? null : cfgStore[k], naverCfgSet: async (k, v) => { cfgStore[k] = v; }, stateMerge: async o => { cfgStore.sms_gateway_state = Object.assign({}, cfgStore.sms_gateway_state || {}, o); },
        writeAudit: async () => { }, createNotification: async (...a) => { notes.push(a); }, notifyTelegram: async t => { tg.push(t); }, loadShippingHolidayInfo: async () => ({ set: new Set(), arriveOff: new Set(), reasons: new Map() }),
        qnaGenerate: async (q, pn, sd, ch) => { aiQs.push({ q, pn, sd, ch }); return { answer: '안녕하세요 고객님 ^^ 확인 후 안내드리겠습니다.', used: [] }; },
        cjTrack: null, deliveryUpsertStatus: null, log: { log() { }, error(...a) { console.log('   [모듈 오류]', ...a); } }, gatewaySend: async () => ({ id: 'x' }) };
    const app = express(); app.use(express.json());
    const SMSSRC = fs.readFileSync(path.join(ROOT, 'sms', 'index.js'), 'utf8');
    for (const t of ['sms_threads', 'sms_messages']) { const m = SMSSRC.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + t + ' \\([\\s\\S]*?\\)`')); await db.query(m[0].slice(0, -1)); }
    delete require.cache[require.resolve(path.join(ROOT, 'sms', 'index.js'))];
    const sms = require(path.join(ROOT, 'sms', 'index.js'))(app, deps); await sms.initDB();
    return { db, pool, sms, app, aiQs, notes, tg, cfgStore };
}
const preIns = (pool, ch, key, buyer, recip, init, opt, qty, paidOff) => pool.query(`INSERT INTO sms_preorders (channel, order_key, buyer_digits, recipient_digits, recipient_initial, option_text, qty, paid_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(hours => $8::int))`, [ch, key, buyer, recip, init, opt, qty, paidOff]);
const memoIns = (pool, ch, key, pno, bn, bd, rn, rd) => pool.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, paid_at) VALUES ($1, $2, $3, $4, $5, $6, $7, '제주시 어딘가 1', '옵션', 1, now())`, [ch, key, pno, bn, bd, rn, rd]);

(async () => {
    const R = '01055556666', B = '01011112222', R2 = '01077778888';
    console.log('① 메모함 표에 이름이 있는 발송 전 주문');
    const A = await boot(true);
    await preIns(A.pool, 'naver', '2026111400000001', B, R, '문', '하우스감귤 5kg', 1, 2);
    await memoIns(A.pool, 'naver', '2026111400000001', '2026111400000001', '김구매', B, '문영희', R);
    await preIns(A.pool, 'coupang', '9000111|7000222', B, R2, '이', '레몬 2kg', 2, 3);
    await memoIns(A.pool, 'coupang', '9000111|7000222', '9000111', '김 구매', B, '이  철수', R2);
    await preIns(A.pool, 'cafe24', '20261114-0000123|P0001', B, R2, '이', '황금향 3kg', 1, 4);   /* 메모함 줄 없음(수집 훅 실패 꼴) */
    const t0 = '2026-11-14';
    let h = await A.sms._staffHistory(R, await A.sms.cfg());
    const p1 = h.items.find(x => x.pre && x.channel === 'naver');
    ok(p1 && p1.recipient_name === '문영희' && p1.buyer_name === '김구매' && p1.order_no === '2026111400000001' && JSON.stringify(p1.order_nos) === '["2026111400000001"]' && p1.recipient_initial === '문' && p1.role === 'recipient', '받는 분 번호 = 받는 분 이름 전체 · 구매자 이름 · 상품주문번호 · 성 칸 · role recipient', p1);
    h = await A.sms._staffHistory(B, await A.sms.cfg());
    const pre = h.items.filter(x => x.pre);
    ok(pre.length === 3 && pre.every(x => x.role === 'buyer'), '구매자 번호 = 발송 전 3묶음(채널·받는 분·날짜 묶음 꼴 그대로)', pre.map(x => [x.channel, x.recipient_name]));
    const pc = pre.find(x => x.channel === 'coupang'), pm = pre.find(x => x.channel === 'cafe24');
    ok(pc && pc.recipient_name === '이 철수' && pc.buyer_name === '김 구매' && pc.order_no === '9000111' && pc.qty === 2, '쿠팡 = 이름 띄어쓰기 한 칸으로 · 주문번호 = 메모함 표 product_order_no · 수량 합 그대로', pc);
    ok(pm && pm.recipient_name === '이' && pm.buyer_name === null && pm.order_no === null && Array.isArray(pm.order_nos) && pm.order_nos.length === 0 && pm.recipient_initial === '이', '메모함 줄 없는 주문 = 종전(성 한 글자) · 새 칸 null/[]', pm);
    console.log('② 같은 날 같은 받는 분 두 주문 = 한 묶음 · 이름 한 번 · 주문번호 둘');
    await preIns(A.pool, 'naver', '2026111400000002', B, R, '문', '타이벡 3kg', 1, 2);
    await memoIns(A.pool, 'naver', '2026111400000002', '2026111400000002', '김구매', B, '문영희', R);
    h = await A.sms._staffHistory(R, await A.sms.cfg());
    const g2 = h.items.filter(x => x.pre);
    ok(g2.length === 1 && g2[0].recipient_name === '문영희' && g2[0].order_nos.length === 2 && g2[0].qty === 2 && /하우스감귤 5kg/.test(g2[0].option_text) && /타이벡 3kg/.test(g2[0].option_text), '묶음 1 · 수량 합 2 · 품목 둘 · 이름 중복 없음 · 주문번호 2', g2);
    console.log('③ 메모함 줄에 주문번호가 비면 네이버는 열쇠(=상품주문번호)로');
    await preIns(A.pool, 'naver', '2026111300000009', '01022223333', '01022223333', '박', '레드향 3kg', 1, 30);
    await memoIns(A.pool, 'naver', '2026111300000009', null, '박지민', '01022223333', '박지민', '01022223333');
    h = await A.sms._staffHistory('01022223333', await A.sms.cfg());
    ok(h.items[0] && h.items[0].order_no === '2026111300000009' && h.items[0].role === 'both' && h.items[0].recipient_name === '박지민', '네이버 product_order_no 빈칸 = order_key · role both', h.items[0]);
    console.log('④ 발송된 줄 · 한 줄 요약 · 대화 열기 응답 · 초안');
    await A.db.query(`INSERT INTO delivery_shipments (tracking, ship_date, recipient, phone, buyer_phone, partner, option_text, qty) VALUES ('601234567801', $1, '문영희', '010-5555-6666', '010-1111-2222', '효돈', '하우스감귤 5kg', 1)`, [kst(-1)]);
    h = await A.sms._staffHistory(R, await A.sms.cfg());
    const shp = h.items.find(x => !x.pre);
    ok(shp && shp.recipient_name === '문영희' && !('buyer_name' in shp) && !('order_no' in shp) && JSON.stringify(shp.trackings) === '["601234567801"]', '발송된 줄 = 종전 칸 그대로(새 칸 없음)', shp);
    const th = (await A.pool.query(`INSERT INTO sms_threads (phone_digits, status) VALUES ($1, 'staff_needed') RETURNING id`, [R])).rows[0].id;
    await A.pool.query(`INSERT INTO sms_messages (thread_id, direction, kind, body, sender, state, bucket) VALUES ($1, 'in', 'sms', '귤 언제 와요?', 'customer', 'received', 'other')`, [th]);
    const srv = A.app.listen(PORT); const base = 'http://127.0.0.1:' + PORT;
    try {
        const get = async u => (await fetch(base + u, { headers: { Connection: 'close' } })).json();
        const post = async (u, b) => (await fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json', Connection: 'close' }, body: JSON.stringify(b || {}) })).json();
        const j = await get('/api/sms/threads/' + th);
        const jp = (j.history || []).find(x => x.pre);
        ok(jp && jp.recipient_name === '문영희' && jp.buyer_name === '김구매' && jp.order_no && jp.order_nos.length === 2, '대화 열기 응답 history 의 발송 전 줄 = 새 칸 실림', jp);
        const hint = (await A.pool.query(`SELECT order_hint FROM sms_threads WHERE id = $1`, [th])).rows[0].order_hint || '';
        ok(!/영희|김구매|2026111400000001|2026111400000002/.test(hint), '한 줄 요약(order_hint)에 이름 전체·주문번호 0 = 「' + hint + '」');
        const d = await post(`/api/sms/threads/${th}/draft`);
        const aiTxt = JSON.stringify(A.aiQs);
        ok(!/영희|김구매|2026111400000001/.test(aiTxt) && !/영희|김구매|2026111400000001/.test(String(d.draft_text || '')), '초안 AI 에 넘긴 글·초안에 이름 전체·주문번호 0', { aiTxt: aiTxt.slice(0, 300), d: d.draft_text });
        ok(!/영희|김구매|2026111400000001/.test(JSON.stringify(A.notes) + JSON.stringify(A.tg)), '알림·텔레그램에 이름 전체·주문번호 0');
        const lst = await get('/api/sms/threads');
        ok(!/김구매|2026111400000001/.test(JSON.stringify(lst)), '대화 목록 응답에 구매자 이름·주문번호 0(목록은 손대지 않음)');
    } finally { srv.close(); }
    console.log('⑤ 메모함 표가 없는 서버 = 종전 SELECT 로 물러남');
    const Z = await boot(false);
    await preIns(Z.pool, 'naver', '2026111400000001', B, R, '문', '하우스감귤 5kg', 1, 2);
    h = await Z.sms._staffHistory(R, await Z.sms.cfg());
    ok(h.items.length === 1 && h.items[0].pre && h.items[0].recipient_name === '문' && h.items[0].buyer_name === null && h.items[0].order_no === null && h.items[0].ship_plan !== undefined, '표 없음 = 발송 전 줄 그대로(성 한 글자) · 빈 목록 아님', h.items[0]);
    console.log('⑥ 글자 검사');
    const SRC = fs.readFileSync(path.join(ROOT, 'sms', 'index.js'), 'utf8');
    const hl = SRC.slice(SRC.indexOf('function hintLineOf'), SRC.indexOf('async function saveHint'));
    ok(!/recipient_name|buyer_name|order_no/.test(hl), 'hintLineOf 는 이름·주문번호 칸을 안 읽음');
    const lk = fs.readFileSync(path.join(ROOT, 'sms', 'lookup.js'), 'utf8');
    ok(!/order_memo_preorders|buyer_name|recv_name/.test(lk), '봇 판정용 주문 찾기(sms/lookup.js)는 메모함 표·이름 칸을 안 읽음(무변)');
    void t0;
    console.log(`\n${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
