// #1151 검증 — 송장번호 요청 [초안 만들기] 4채널(sms/index.js · inbox-threads.js 실코드 · invoiceReq = server.js 실코드 떼어 옴)
//   🔴 실DB·네이버·AI·발송 0 · DB = 메모리 pglite · 포트 PORT1151(기본 3461 · 이 스크립트 안에서만)
//   실행: PGLITE_DIR=<pglite 가 설치된 폴더> PORT1151=3461 node scripts/verify-1151-invoice-reply.js <리포 루트>
//   워커1 v1151.js(30) + 워커3 #1151 교차 점검 케이스(번호 꼴·회사 번호·받는 분만 맞는 번호·7일 경계·3통 창)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = process.argv[2] || path.join(__dirname, '..'); const PORT = Number(process.env.PORT1151 || 3461);
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 700))); };
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) { const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }
// server.js 의 invoiceReq 묶음(INVOICE_* 4줄 + 함수) 을 그대로 떼어 실행
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const grab = re => { const m = SRV.match(re); if (!m) throw new Error('못 찾음 ' + re); return m[0]; };
const invSrc = ['INVOICE_REQ_RE', 'INVOICE_Q_RE', 'INVOICE_VERB_RE', 'INVOICE_THANKS_RE'].map(n => grab(new RegExp('^const ' + n + ' = .*$', 'm'))).join('\n') + '\n' + grab(/^function invoiceReq\(text\) \{.*$/m);
const invoiceReq = new Function(invSrc + '\nreturn invoiceReq;')();
const INV = require(path.join(ROOT, 'invoice-reply.js'));
const EMOJI = /\p{Extended_Pictographic}/u;
const kst = off => { const d = new Date(Date.now() + 9 * 3600e3 + off * 86400e3); return d.toISOString().slice(0, 10); };

(async () => {
    const db = new PGlite(), pool = mkPool(db);
    await db.query(`CREATE TABLE delivery_shipments (tracking text PRIMARY KEY, ship_date date NOT NULL, partner text, recipient text, phone text, addr text, option_text text, qty integer, memo text, source text DEFAULT 'index', uploaded_at timestamptz DEFAULT now(), buyer_phone text)`);
    await db.query(`CREATE TABLE delivery_status (tracking text PRIMARY KEY, bucket text, code text, label text, msg text, event_time text, branch text, driver_name text, driver_phone text, events jsonb, delivered boolean DEFAULT false, checked_at timestamptz DEFAULT now(), first_trouble_at timestamptz)`);
    await db.query(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW())`);
    await db.query(`ALTER TABLE delivery_shipments ADD COLUMN phone_digits text GENERATED ALWAYS AS (regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) STORED`);
    await db.query(`ALTER TABLE delivery_shipments ADD COLUMN buyer_digits text GENERATED ALWAYS AS (regexp_replace(COALESCE(buyer_phone, ''), '[^0-9]', '', 'g')) STORED`);
    const B = '010-1111-2222', R1 = '010-3333-4444', X = '010-7777-8888', M = '010-9999-0000';
    const ins = (tr, off, rec, ph, buyer, src) => db.query(`INSERT INTO delivery_shipments (tracking, ship_date, recipient, phone, buyer_phone, partner, source) VALUES ($1, $2, $3, $4, $5, '효돈', $6)`, [tr, kst(off), rec, ph, buyer, src || 'index']);
    await ins('601234567801', -1, '홍길동', R1, B); await ins('601234567802', -3, '김철수', '010-5555-6666', B); await ins('601234567803', -10, '홍길동', R1, B);
    await ins('601234567804', -2, '홍길동', R1, X); await ins('999612345678', -1, '시험', '010-5555-6666', B); await ins('601234567805', 0, '이영희', '010-1212-3434', B);
    for (let i = 0; i < 25; i++) await ins('6012345679' + String(i).padStart(2, '0'), -(i % 5), '받는' + i, '010-4444-' + String(1000 + i), M);
    await db.query(`INSERT INTO delivery_status (tracking, delivered, label) VALUES ('601234567801', true, '배송완료'), ('601234567802', false, '배송출발')`);
    // 워커3 교차 점검 자료: 회사 번호(CO)가 구매자로 찍힌 묶음 2줄 · 구매자 빈칸 줄 · 7일 경계(-7 · -8) 묶음(E)
    const CO = '010-6687-4031', E = '010-8080-9090';
    await ins('601234567811', -1, '회사받는1', '010-2600-1111', CO); await ins('601234567812', -1, '회사받는2', '010-2600-2222', CO);
    await ins('601234567813', -1, '빈구매자', '010-2600-3333', ''); await ins('601234567814', -2, '빈구매자2', '010-2600-4444', null);
    await ins('601234567815', -7, '경계7', '010-2600-5555', E); await ins('601234567816', -8, '경계8', '010-2600-6666', E);

    console.log('Ⅰ invoiceReq 그대로(넓히지 않음)');
    for (const [t, e] of [['송장번호 알려주세요', true], ['개별 송장 알려주세요', true], ['운송장 번호 좀 주세요', true], ['송장 조회는 어디서 하나요', false], ['송장 보내주셔서 감사해요', false], ['귤 언제 와요?', false]]) ok(invoiceReq(t) === e, `「${t}」 = ${e}`);

    console.log('Ⅱ 문자 [초안 만들기]');
    const aiQs = [], cfgStore = { sms_gateway: { enabled: true, mode: 'draft', hold_sec: 0, max_chars: 1000, staff_ids: [1] } };
    const deps = { testMode: true, pool, authMiddleware: (req, res, next) => { req.user = { id: 1, name: '검증', role: 'admin' }; next(); },
        naverCfgGet: async k => cfgStore[k] === undefined ? null : cfgStore[k], naverCfgSet: async (k, v) => { cfgStore[k] = v; }, stateMerge: async o => { cfgStore.sms_gateway_state = Object.assign({}, cfgStore.sms_gateway_state || {}, o); },
        writeAudit: async () => { }, createNotification: async () => { }, notifyTelegram: async () => { }, loadShippingHolidayInfo: async () => ({ set: new Set(), arriveOff: new Set(), reasons: new Map() }),
        qnaGenerate: async (q, pn, sd, ch) => { aiQs.push({ q, ch }); return { answer: '안녕하세요 고객님 ^^ 확인 후 안내드리겠습니다.', used: [] }; },
        cjTrack: null, deliveryUpsertStatus: null, log: { log() { }, error(...a) { console.log('   [모듈 오류]', ...a); } }, gatewaySend: async () => ({ id: 'x' }), invoiceReq };
    const app = express(); app.use(express.json());
    const SMSSRC = fs.readFileSync(path.join(ROOT, 'sms', 'index.js'), 'utf8');   /* 새 DB 에선 initDB 가 sms_messages 를 만들기 전에 ALTER 하므로 같은 CREATE 글을 먼저 돌림 */
    for (const t of ['sms_threads', 'sms_messages']) { const m = SMSSRC.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + t + ' \\([\\s\\S]*?\\)`')); await db.query(m[0].slice(0, -1)); }
    const sms = require(path.join(ROOT, 'sms', 'index.js'))(app, deps); await sms.initDB();
    const srv = app.listen(PORT); const base = 'http://127.0.0.1:' + PORT;
    const api = async (u, b) => { const r = await fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json', Connection: 'close' }, body: JSON.stringify(b || {}) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
    const th = async (digits, msgs) => { await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits = $1)`, [digits]); await pool.query(`DELETE FROM sms_threads WHERE phone_digits = $1`, [digits]); const t =(await pool.query(`INSERT INTO sms_threads (phone_digits, status) VALUES ($1, 'staff_needed') RETURNING id`, [digits])).rows[0];
        for (const [dir, body] of msgs) await pool.query(`INSERT INTO sms_messages (thread_id, direction, kind, body, sender, state, bucket) VALUES ($1, $2, 'sms', $3, $4, $5, 'other')`, [t.id, dir, body, dir === 'in' ? 'customer' : 'staff', dir === 'in' ? 'received' : 'sent']);
        return t.id; };
    const smsBytes = require(path.join(ROOT, 'sms', 'sms-safe.js')).smsBytes;
    { aiQs.length = 0; const id = await th('01011112222', [['in', '송장번호 알려주세요']]); const r = await api(`/api/sms/threads/${id}/draft`); const t = r.j.draft_text || '';
      ok(r.j.ok && r.j.draft_kind === 'invoice' && !aiQs.length, '구매자 번호 = 목록 초안 · AI 0', r.j);
      ok(/6012-3456-7801/.test(t) && /6012-3456-7802/.test(t) && /6012-3456-7805/.test(t) && !/7803/.test(t) && !/7804/.test(t) && !/9996/.test(t), '최근 7일 구매자 묶음만(10일 전·남의 주문·시험 송장 0)', t);
      ok(/CJ대한통운/.test(t) && /홍길동님/.test(t) && /배송완료/.test(t) && /배송 출발/.test(t), '받는 분 성함·CJ대한통운·상태', t);
      ok(!EMOJI.test(t) && smsBytes(t) <= 2000, `문자 이모지 0 · ${smsBytes(t)}바이트`, t);
      ok(/…2222/.test(r.j.invoice_note) && !/601234/.test(r.j.invoice_note), '직원 줄 = 끝 4자리·건수만', r.j.invoice_note);
      console.log('   ── 문자 견본 ──\n' + t.split('\n').map(l => '   | ' + l).join('\n')); }
    { const id = await th('01033334444', [['in', '운송장 번호 좀 주세요']]); const t = (await api(`/api/sms/threads/${id}/draft`)).j.draft_text || '';
      ok(/7801/.test(t) && /7804/.test(t) && !/7802/.test(t) && !/7805/.test(t), '받는 분 번호 = 자기 송장만(두 구매자에게서 받은 것 · 구매자의 다른 받는 분 0)', t); }
    { aiQs.length = 0; const id = await th('01012120000', [['in', '송장번호 알려주세요']]); const r = await api(`/api/sms/threads/${id}/draft`);
      ok(r.j.draft_kind !== 'invoice' && aiQs.length > 0 && r.j.invoice_note === INV.NOTE.not_found(), '기록 없음 = 종전 초안 + 「못 찾았어요」', r.j); }
    { aiQs.length = 0; const id = await th('01011112222', [['in', '귤 언제 와요?']]); const r = await api(`/api/sms/threads/${id}/draft`);
      ok(r.j.draft_kind !== 'invoice' && !('invoice_note' in r.j) && aiQs.length > 0, '요청 아님 = 종전(invoice_note 칸 없음)', r.j); }
    { const id = await th('01099990000', [['in', '개별 송장 알려주세요']]); const t = (await api(`/api/sms/threads/${id}/draft`)).j.draft_text || '';
      const n = (t.match(/6012-3456-79/g) || []).length; ok(n === 20 && /외 5건은 따로 보내드릴게요/.test(t) && smsBytes(t) <= 2000, `25건 = 20줄 + 외 5건 · ${smsBytes(t)}바이트`, { n }); }
    { const id = await th('01011112222', [['in', '안녕하세요'], ['out', '네 고객님'], ['in', '송장번호 알려주세요'], ['in', '부탁드려요']]); const t = (await api(`/api/sms/threads/${id}/draft`)).j.draft_text || '';
      ok(/^요청하신 송장번호/.test(t), '이미 답한 대화 = 인사 뗌 · 요청 뒤 「부탁드려요」가 마지막이어도 잡힘', t.slice(0, 40)); }
    { const id = await th('01011112222', [['in', '송장번호 알려주세요'], ['out', '보내드렸어요'], ['in', '감사합니다']]); const r = await api(`/api/sms/threads/${id}/draft`);
      ok(r.j.draft_kind !== 'invoice' && !('invoice_note' in r.j), '우리 답 뒤 「감사합니다」 = 요청 아님(종전)', r.j); }
    console.log('Ⅱ-b 워커3 교차 점검(문자) · 번호 꼴·회사 번호·받는 분만·7일 경계·3통 창');
    ok((await INV.findShipments(pool, '', { testMode: true })).length === 0 && (await INV.findShipments(pool, null, { testMode: true })).length === 0, "구매자 빈칸 줄 2 있어도 '' · null 조회 = 0(lookupable 막이 · '' === '' 전부 맞는 꼴 없음)");
    ok((await INV.findShipments(pool, '821011112222', { testMode: true })).length === 0 && (await INV.findShipments(pool, '1011112222', { testMode: true })).length === 0 && (await INV.findShipments(pool, '2222', { testMode: true })).length === 0 && (await INV.findShipments(pool, '01091112222', { testMode: true })).length === 0, '+82 꼴 · 앞 0 빠짐 · 끝 4자리 · 끝 7자리만 같은 번호 = 0(안 찾음 = 안전 쪽)');
    { aiQs.length = 0; const id = await th('821011112222', [['in', '송장번호 알려주세요']]); const r = await api(`/api/sms/threads/${id}/draft`); ok(r.j.draft_kind !== 'invoice' && r.j.invoice_note === INV.NOTE.not_found() && aiQs.length > 0, '+82 꼴 대화 = 목록 없음(「못 찾았어요」 · 종전 초안)', r.j); }
    { const id = await th('01026001111', [['in', '송장번호 알려주세요']]); const t = (await api(`/api/sms/threads/${id}/draft`)).j.draft_text || ''; ok(/7811/.test(t) && !/7812/.test(t) && /회사받는1님/.test(t) && !/회사받는2/.test(t), '회사 번호가 구매자인 묶음의 받는 분 = 자기 송장만(다른 받는 분 이름·송장 0)', t); }
    { const id = await th('01066874031', [['in', '송장번호 알려주세요']]); const r = await api(`/api/sms/threads/${id}/draft`); const t = r.j.draft_text || ''; ok(r.j.draft_kind === 'invoice' && /7811/.test(t) && /7812/.test(t) && (t.match(/6012-3456-78/g) || []).length === 2, '(설계 그대로) 회사 번호에서 온 문자 = 그 번호가 구매자인 2줄만(직원 폰 · 손님 번호와 겹칠 수 없음)', t); }
    { const id = await th('01026003333', [['in', '송장번호 알려주세요']]); const t = (await api(`/api/sms/threads/${id}/draft`)).j.draft_text || ''; ok(/7813/.test(t) && (t.match(/6012-3456-78/g) || []).length === 1, '구매자 빈칸 줄의 받는 분 = 자기 송장 1(빈칸 구매자끼리 묶이지 않음)', t); }
    { const id = await th('01080809090', [['in', '송장번호 알려주세요']]); const t = (await api(`/api/sms/threads/${id}/draft`)).j.draft_text || ''; ok(/7815/.test(t) && !/7816/.test(t) && /경계7님/.test(t) && !/경계8/.test(t), '7일 창(KST) = 7일 전 포함 · 8일 전 제외', t); }
    { const id = await th('01033334444', [['in', '송장번호 알려주세요'], ['in', '네'], ['in', '네네'], ['in', '사이즈 바꿔 주세요']]); const r = await api(`/api/sms/threads/${id}/draft`); ok(r.j.draft_kind !== 'invoice' && !('invoice_note' in r.j), '요청이 마지막 3통 밖(4통 전) = 요청 아님(종전)', r.j); }
    { const id = await th('01033334444', [['in', '송장번호 알려주세요'], ['in', '아 그리고 주소 바꿔 주세요']]); const r = await api(`/api/sms/threads/${id}/draft`); ok(r.j.draft_kind === 'invoice', '요청 뒤 다른 주제 글 1통 = 아직 안 답한 요청이라 목록 초안(설계 · 직원 줄 있음)', r.j.invoice_note); }
    { const id = await th('01033334444', [['in', '송장번호 알려주세요']]); await pool.query(`UPDATE sms_messages SET created_at = now() - interval '20 days' WHERE thread_id = $1`, [id]); await pool.query(`INSERT INTO sms_messages (thread_id, direction, kind, body, sender, state, bucket) VALUES ($1, 'in', 'sms', '귤 맛있었어요', 'customer', 'received', 'other')`, [id]); const r = await api(`/api/sms/threads/${id}/draft`); ok(r.j.draft_kind !== 'invoice' && !('invoice_note' in r.j), '(손질) 20일 전 요청에 우리 문자 답이 없었고 오늘 다른 글 = 요청 아님(판정 창 = 최근 7일 글만)', r.j); }
    { const id = await th('01011112222', [['in', '송장번호 알려주세요'], ['out', '보내드렸어요'], ['in', '송장번호 다시 알려주세요']]); const r = await api(`/api/sms/threads/${id}/draft`); ok(r.j.draft_kind === 'invoice' && /^요청하신/.test(r.j.draft_text), '우리 답 뒤 다시 요청 = 목록(인사 뗌)', r.j.draft_text && r.j.draft_text.slice(0, 30)); }
    { const id = await th('01011112222', [['in', '송장번호 알려주세요'], ['out', '보내드렸어요']]); await pool.query(`UPDATE sms_messages SET state = 'failed' WHERE thread_id = $1 AND direction = 'out'`, [id]); const r = await api(`/api/sms/threads/${id}/draft`); ok(r.j.draft_kind === 'invoice', '우리 답이 실패(failed)면 아직 안 답한 요청 = 목록', r.j.invoice_note); }
    { const id = await th('01011112222', [['in', '송장번호 알려주세요']]); await pool.query(`UPDATE sms_messages SET bucket = 'ad' WHERE thread_id = $1`, [id]); const r = await api(`/api/sms/threads/${id}/draft`); ok(r.s === 400 || r.j.draft_kind !== 'invoice', '광고 꼴로 분류된 글 = 손님 글 아님(종전 400 · 목록 0)', [r.s, r.j.code]); }
    await new Promise(r => srv.close(r));

    console.log('Ⅲ 톡톡·상품문의·주문문의 [초안 만들기]');
    await db.query(`CREATE TABLE message_logs (id SERIAL PRIMARY KEY, user_id TEXT, item TEXT, message TEXT, answered BOOLEAN DEFAULT false, bot_response TEXT, staff_response TEXT, image_url TEXT, scenario_name TEXT, received_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'))`);
    for (const [t, idc, idt] of [['naver_qnas', 'question_id', 'BIGINT'], ['naver_inquiries', 'inquiry_id', 'TEXT']])
        await db.query(`CREATE TABLE ${t} (${idc} ${idt} PRIMARY KEY, raw JSONB, answered BOOLEAN DEFAULT false, ai_status VARCHAR(10), ai_scenarios JSONB, ai_draft TEXT, posted_at TIMESTAMP, posted_by VARCHAR(50), post_error TEXT, collected_at TIMESTAMP DEFAULT NOW())`);
    const gen = [], qn = [], iq = [];
    const app2 = express(); app2.use(express.json());
    const it = require(path.join(ROOT, 'inbox-threads.js'))(app2, { pool, authMiddleware: (req, res, next) => { req.user = { id: 1, name: '검증', role: 'admin' }; next(); }, writeAudit: async () => { }, testMode: true, tables: {}, salt: 'v1151',
        generate: async (q, p) => { gen.push(q); return { answer: '안녕하세요 고객님 제주아꼼이네입니다 🍊\n확인 후 안내드릴게요.' }; }, genQna: async (q) => { qn.push(q); return { answer: '상품문의 초안', used: [] }; }, genInquiry: async item => { iq.push(item); return { answer: '주문문의 초안', used: [] }; }, invoiceReq });
    if (it && it.ensure) await it.ensure();
    const srv2 = app2.listen(PORT); const b2 = 'http://127.0.0.1:' + PORT;
    const api2 = async (u, b) => { const r = await fetch(b2 + u, { method: 'POST', headers: { 'content-type': 'application/json', Connection: 'close' }, body: JSON.stringify(b || {}) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
    const keyOf = uid => require('crypto').createHash('md5').update('v1151' + uid).digest('hex').slice(0, 16);
    const talk = async (uid, rows) => { for (const r of rows) await pool.query(`INSERT INTO message_logs (user_id, item, message, answered, bot_response, staff_response) VALUES ($1, '감귤', $2, $3, $4, $5)`, [uid, r.m, !!r.bot, r.bot || null, r.staff || null]); return (await api2(`/api/inbox/threads/talk/${keyOf(uid)}/draft`)).j; };
    { gen.length = 0; const j = await talk('u1', [{ m: '송장번호 알려주세요', bot: '확인 후 톡톡으로 보내드리겠습니다' }, { m: '주문자 010-1111-2222 입니다', bot: '감사합니다' }]);
      ok(j.ok && j.kind === 'invoice' && !gen.length && /7801/.test(j.draft) && /7802/.test(j.draft) && !/7804/.test(j.draft), '톡톡 = 글에 적은 구매자 번호로 목록 · AI 0', j);
      ok(/…2222/.test(j.invoice_note) && /본인인지 확인/.test(j.invoice_note) && j.draft.length <= 1000 && /^요청하신/.test(j.draft), '직원 줄 · 1,000자 안 · 봇 답 있던 대화 = 인사 뗌', j);
      console.log('   ── 톡톡 견본 ──\n' + j.draft.split('\n').map(l => '   | ' + l).join('\n')); }
    { gen.length = 0; const j = await talk('u2', [{ m: '송장번호 알려주세요' }]); ok(j.kind !== 'invoice' && gen.length === 1 && j.invoice_note === INV.NOTE.no_number(), '번호 없음 = 종전 초안 + 「주문자를 알 수 없어요」', j); }
    { const j = await talk('u3', [{ m: '운송장 보내주세요 받는 사람 010-3333-4444 주문자 010-7777-8888' }]); ok(j.kind === 'invoice' && /7804/.test(j.draft) && !/7801/.test(j.draft), '번호 둘(받는 분·구매자) = 구매자 번호 하나로만', j); }
    { gen.length = 0; const j = await talk('u4', [{ m: '송장 알려주세요 010-1111-2222 랑 010-7777-8888' }]); ok(j.kind !== 'invoice' && gen.length === 1 && j.invoice_note === INV.NOTE.many(), '구매자 번호 둘 = 애매 · 목록 없음', j); }
    { const j = await talk('u5', [{ m: '송장번호 알려주세요 010-2323-4545' }]); ok(j.kind !== 'invoice' && j.invoice_note === INV.NOTE.not_found(), '없는 번호 = 「못 찾았어요」', j); }
    { gen.length = 0; const j = await talk('u6', [{ m: '귤 맛있어요 010-1111-2222' }]); ok(j.kind !== 'invoice' && !('invoice_note' in j) && gen.length === 1, '요청 아님 = 종전(invoice_note 칸 없음)', j); }
    { const j = await talk('u7', [{ m: '송장번호 알려주세요 010-1111-2222', staff: '[에이전트오피스·지현] 보내드렸어요' }, { m: '감사합니다' }]); ok(j.kind !== 'invoice' && !('invoice_note' in j), '직원 답 뒤 「감사합니다」 = 요청 아님', j); }
    await pool.query(`INSERT INTO naver_qnas (question_id, raw, ai_status) VALUES (11, $1, 'staff'), (12, $2, 'staff')`, [JSON.stringify({ question: '송장번호 알려주세요 010-1111-2222', product_name: '감귤', create_date: new Date().toISOString() }), JSON.stringify({ question: '귤 언제 와요', product_name: '감귤', create_date: new Date().toISOString() })]);
    await pool.query(`INSERT INTO naver_inquiries (inquiry_id, raw, ai_status) VALUES ('21', $1, 'staff'), ('22', $2, 'staff')`, [JSON.stringify({ title: '배송', content: '송장 번호 부탁드려요', registered_at: new Date().toISOString() }), JSON.stringify({ title: '배송', content: '언제 보내요', registered_at: new Date().toISOString() })]);
    { const j = (await api2('/api/inbox/threads/qna/11/draft')).j; ok(j.ok && j.kind === 'invoice' && !qn.length && !/\d{4}-\d{4}-\d{4}|010|홍길동|김철수/.test(j.draft) && j.invoice_note === INV.NOTE.qna(), '상품문의 = 송장·성함·번호 0 고정 초안 · AI 0', j);
      console.log('   ── 상품문의 견본 ──\n' + j.draft.split('\n').map(l => '   | ' + l).join('\n'));
      const s = (await pool.query(`SELECT ai_draft FROM naver_qnas WHERE question_id = 11`)).rows[0]; ok(s.ai_draft === INV.QNA_TEXT, '상품문의 저장 칸 = 고정 글'); }
    { const j = (await api2('/api/inbox/threads/qna/12/draft')).j; ok(j.draft === '상품문의 초안' && !('invoice_note' in j) && qn.length === 1, '상품문의 요청 아님 = 종전', j); }
    { const j = (await api2('/api/inbox/threads/inquiry/21/draft')).j; ok(j.draft === '주문문의 초안' && j.invoice_note === INV.NOTE.inquiry() && iq.length === 1, '주문문의 = 종전 초안 + 「주문 번호 연결 없음」', j); }
    { const j = (await api2('/api/inbox/threads/inquiry/22/draft')).j; ok(j.draft === '주문문의 초안' && !('invoice_note' in j), '주문문의 요청 아님 = 종전', j); }
    console.log('Ⅲ-b 워커3 교차 점검(톡톡) · 번호 꼴 · 받는 분 번호만 · 송장 숫자 속 01x · 봇 답 뒤 옛 요청');
    ok(JSON.stringify(INV.phonesInText(['010 1111 2222 요', '010.3333.4444', '+82 10-7777-8888', '01099990000', '6012-3456-7801 601012345678', '02-123-4567', '010-1111-22223'])) === JSON.stringify(['01011112222', '01033334444', '01099990000']), '글 속 번호 = 띄움·점·붙임 꼴 O · +82 꼴 X · 송장 숫자 속 01x X · 02 X · 12자리 붙은 숫자 X', INV.phonesInText(['010 1111 2222 요', '010.3333.4444', '+82 10-7777-8888', '01099990000', '6012-3456-7801 601012345678', '02-123-4567', '010-1111-22223']));
    { const j = await talk('u8', [{ m: '송장번호 알려주세요 010-3333-4444' }]); ok(j.kind === 'invoice' && /7801/.test(j.draft) && /7804/.test(j.draft) && !/7802/.test(j.draft) && !/7805/.test(j.draft) && /본인인지 확인/.test(j.invoice_note), '🔵 받는 분 번호만 맞는 번호 = 그 받는 분 송장 2(두 구매자에게서) · 직원 줄 「본인 확인」(받는 분으로만 맞았다는 글은 없음)', j); }
    { const j = await talk('u9', [{ m: '송장번호 알려주세요 010-2600-1111' }]); ok(j.kind === 'invoice' && /7811/.test(j.draft) && !/7812/.test(j.draft), '회사 번호 묶음의 받는 분 번호 = 자기 송장만', j.draft); }
    { const j = await talk('u10', [{ m: '송장번호 알려주세요 +82 10-1111-2222' }]); ok(j.kind !== 'invoice' && j.invoice_note === INV.NOTE.no_number(), '+82 꼴만 적은 글 = 번호 없음(종전 초안)', j.invoice_note); }
    { const j = await talk('u11', [{ m: '송장번호 알려주세요 010-3333-4444 010-2600-1111' }]); ok(j.kind !== 'invoice' && j.invoice_note === INV.NOTE.many(), '받는 분 번호 둘(구매자 0) = 애매 · 목록 없음', j.invoice_note); }
    { const j = await talk('u12', [{ m: '주문자 010-1111-2222 입니다' }, { m: '송장번호 알려주세요' }]); ok(j.kind === 'invoice' && /7801/.test(j.draft), '번호는 앞 글 · 요청은 뒤 글 = 7일 안 글에서 번호 찾음', j.invoice_note); }
    { gen.length = 0; const j = await talk('u13', [{ m: '송장번호 알려주세요 010-1111-2222', bot: '확인 후 안내드리겠습니다' }, { m: '귤 맛있어요' }]); ok(j.kind === 'invoice', '🔵 봇만 답한 요청 뒤 다른 글 = 아직 직원이 안 답한 요청이라 목록 초안(설계 · 30일 안)', j.invoice_note); }
    { const uid = 'u14'; await pool.query(`INSERT INTO message_logs (user_id, item, message, answered, bot_response, received_at) VALUES ($1, '감귤', '송장번호 알려주세요 010-1111-2222', true, '확인 후 안내드리겠습니다', (NOW() AT TIME ZONE 'UTC') - interval '20 days')`, [uid]);
      gen.length = 0; const j = await talk(uid, [{ m: '귤 맛있어요' }]); ok(j.kind !== 'invoice' && !('invoice_note' in j) && gen.length === 1, '(손질) 톡톡 20일 전 봇만 답한 요청 + 오늘 다른 글 = 요청 아님(종전 초안)', j); }
    { const j = await talk('u15', [{ m: '송장번호 알려주세요 010-3333-4444' }]); ok(/받는 분 번호로만 맞음\(구매자 아님\)/.test(j.invoice_note || ''), '(손질) 톡톡 받는 분 번호로만 맞음 = 직원 줄에 「받는 분 번호로만 맞음(구매자 아님)」', j.invoice_note); }
    { const j = await talk('u16', [{ m: '송장번호 알려주세요 010-1111-2222' }]); ok(j.kind === 'invoice' && !/받는 분 번호로만/.test(j.invoice_note || ''), '(손질) 구매자 번호로 맞음 = 그 덧말 없음', j.invoice_note); }
    srv2.close();
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
