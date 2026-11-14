// #1156 검증 — 문자 창 [발주메모] · 받는 분이 문자를 보냈고 그 주문이 하나뿐이면 상품주문번호 줄(#938) + 현금 줄 K = 구매자 번호(order-memo.js 실코드)
//   🔴 실DB·네이버·AI·발송 0 · DB = 메모리 pglite · AI = 가짜(정해 둔 JSON) · 포트 PORT1156(기본 3458 · 이 스크립트 안에서만)
//   실행: PGLITE_DIR=<pglite 가 설치된 폴더> PORT1156=3458 node scripts/verify-1156-sms-recv-order.js [HEAD 사본 order-memo.js]
//     HEAD 사본을 주면(리포 맨 위에 git show HEAD:order-memo.js > .verify-head-order-memo.js) 보통 경우(구매자 문자·번호 적은 글·manual·주문 2건/0건·본인 주문)를 구/신 응답 바이트로 맞대 봄
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..'); const PORT = Number(process.env.PORT1156 || 3458);
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 900))); };
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) { const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }
const CAT = ['고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)'];
const HEADF = process.argv[2] ? path.resolve(process.argv[2]) : null;

async function boot(file, port) {
    const OM = require(file);
    const db = new PGlite(), pool = mkPool(db);
    await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
    await db.query(`INSERT INTO pricing (partner, start_date, end_date, items) VALUES ('대성(시온)', '2026-01-01', '2026-12-31', $1)`, [JSON.stringify(CAT.map(n => ({ name: n, price: 1 })))]);
    await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false, result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
    const st = { cfg: { ai: { direct: true } }, desk: false, ai: null, aiUser: [] };
    const app = express(); app.use(express.json());
    const auth = (req, res, next) => { req.user = { id: Number(req.headers['x-uid'] || 21), name: '검증', position: '', role: 'admin' }; next(); };   /* 미리보기 기다리기(GET)를 다른 계정으로 불러도 보이게 */
    const api = OM.mount(app, { pool, authMiddleware: auth, writeAudit: async () => {}, adminActor: req => ({ id: req.user.id }), handleErr: (res, e) => res.status(e.status || 500).json({ error: e.message }),
        cfgGet: async k => (k === 'order_memo' ? st.cfg : k === 'desk_subscription_users' ? { ids: [1] } : null), deskAlive: async () => st.desk, kstToday: () => '2026-11-14', noTimers: true,
        anthropic: { messages: { create: async p => { st.aiUser.push(p.messages[0].content); return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(st.ai || { lines: [], cash: [], unsure: [], sms_draft: '' }) }] }; } } },
        shipCal: async () => ({ realToday: '2026-11-14', shipDays: ['2026-11-15', '2026-11-16', '2026-11-17'], suggested: '2026-11-15' }) });
    await api.ensure();
    for (let i = 0; i < 50 && !(await db.query(`SELECT to_regclass('order_memo_preorders') IS NOT NULL AS y`)).rows[0].y; i++) await new Promise(r => setTimeout(r, 50));
    const srv = await new Promise(r => { const s = http.createServer(app).listen(port, () => r(s)); });
    let uid = 100;   /* 미리보기는 계정마다 분당 20번 상한 → 부를 때마다 다른 계정 */
    const call = async (method, url, body) => { const r = await fetch('http://127.0.0.1:' + port + url, { method, headers: { 'Content-Type': 'application/json', Connection: 'close', 'x-uid': String(/preview\/\d/.test(url) ? 21 : ++uid) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
    return { OM, db, pool, st, srv, call };
}
// 손님 자료 — 번호마다 sms_threads 줄 하나 · order_memo_preorders(메모함 표)
async function seed(A) {
    const th = (id, d) => A.db.query(`INSERT INTO sms_threads (id, phone_digits) VALUES ($1, $2)`, [id, d]);
    const pre = (ch, key, pno, bn, bd, rn, rd) => A.db.query(`INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, paid_at) VALUES ($1, $2, $3, $4, $5, $6, $7, '제주시 어딘가 1', '타이벡 5kg', 1, now())`, [ch, key, pno, bn, bd, rn, rd]);
    await th(61, '01055559733'); await pre('naver', '2026111457273231', '2026111457273231', '김구매', '01011112222', '이받음', '01055559733');   // 받는 분 · 주문 하나
    await th(62, '01066660002'); await pre('naver', '2026111400000021', '2026111400000021', '박구매', '01022220000', '최받음', '01066660002'); await pre('naver', '2026111400000022', '2026111400000022', '박구매', '01022220000', '최받음', '01066660002');   // 받는 분 · 주문 둘
    await th(63, '01077770003');   // 주문 0
    await th(64, '01011112222');   // 구매자 본인(위 9733 주문의 구매자)
    await th(65, '01088880005'); await pre('naver', '2026111400000051', '2026111400000051', '정구매', '01033330000', '한받음', '01088880005'); await pre('coupang', '9000111|7000222', '31000555', '한받음', '01088880005', '한받음', '01088880005');   // 받는 분 + 본인 주문
    await th(66, '01099990006'); await pre('naver', '2026111400000061', null, '선물준', '', '선물받', '01099990006');   // 선물하기 꼴(구매자 번호 없음 · 주문번호 칸 빈칸 → 열쇠)
    await th(67, '01012120007'); await pre('cafe24', '20261114-0000777|P0001', '20261114-0000777', '자구매', '01044440000', '자받음', '01012120007'); await pre('cafe24', '20261114-0000777|P0002', '20261114-0000777', '자구매', '01044440000', '자받음', '01012120007');   // 자사몰 한 주문 두 품목 = 주문 하나
}
const strip = j => JSON.parse(JSON.stringify(j, (k, v) => (k === 'at' || k === 'ms' ? '<' + k + '>' : v)));

(async () => {
    const A = await boot(path.join(ROOT, 'order-memo.js'), PORT); await seed(A);
    const pv = (raw, src, phone) => A.call('POST', '/api/order-memo/preview', Object.assign({ raw }, src ? { source: src } : {}, phone ? { phone } : {}));
    try {
        console.log('① 받는 분 문자 · 주문 하나(…9733) · 번호 없는 글 = 규칙 주문번호 줄');
        for (const [t, note, sd] of [['S사이즈로', 'S사이즈로', null], ['16일 발송', '16일 발송', '2026-11-16'], ['입력o삭제x', '입력o삭제x', null], ['보내는이 홍길동', '보내는이 홍길동', null]]) {
            const r = (await pv(t, 'sms:61')).j, x = r.rows && r.rows[0];
            ok(r.rows.length === 1 && x.kind === 'line' && x.key === '2026111457273231' && x.plat === '네이버' && x.sure === true && x.ship_date === sd && x.checked && x.checked.as === 'order' && x.checked.buyer === '010-1111-2222' && x.checked.plat === '네이버' && x.line.includes('2026111457273231') && x.line.includes(t) && /네이버$/.test(x.line) && x.note === note && r.ai.used === false,
                `「${t}」 → 「${x && x.line}」 · 네이버 · checked {as order · buyer 010-1111-2222} · 확인 대기 아님(sure)`, r);
        }
        { const r = (await pv('010-2222-3333 S사이즈로', 'sms:61')).j, x = r.rows[0]; ok(r.rows.length === 1 && x.key === '010-2222-3333' && !x.checked && x.plat === '', '글에 손님이 번호를 적음 = 그 번호 우선(주문번호 안 붙임 · checked 없음)', x); }
        { const r = (await pv('2026111499999999 M사이즈로', 'sms:61')).j, x = r.rows[0]; ok(x.key === '2026111499999999' && !x.checked, '글에 다른 주문번호 = 그 번호 그대로', x); }
        console.log('② AI 길(서버 직접 · 가짜 AI)');
        A.st.ai = { lines: [], cash: [], unsure: [{ text: '주소 바꿔주세요 제주시 연삼로 1', why: '주소 변경 · 주문번호 2026111457273231' }], sms_draft: '' }; A.st.aiUser.length = 0;
        { const r = (await pv('주소 바꿔주세요 제주시 연삼로 1', 'sms:61')).j; ok(r.ai.used && r.rows.length === 0 && /주소 변경/.test(r.leftover) && /sms_order_key 2026111457273231\(네이버\)/.test(A.st.aiUser[0] || '') && /주소 변경 요청은 cash 로 만들지 말고/.test(A.st.aiUser[0] || ''), '주소 변경 글 = AI 로(주소 낱말 = 규칙 안 탐) · AI 글에 sms_order_key · 주소 변경 = unsure 안내', { r, u: (A.st.aiUser[0] || '').slice(-200) }); }
        A.st.ai = { lines: [{ key: '', note: 'S사이즈로', plat: '', date: '' }], cash: [], unsure: [], sms_draft: '' };
        { const r = (await pv('안녕하세요~ 사이즈 S 로 보내 주실 수 있을까요', 'sms:61')).j, x = r.rows[0]; ok(r.rows.length === 1 && x.key === '2026111457273231' && x.plat === '네이버' && x.checked && x.checked.buyer === '010-1111-2222', 'AI 가 key 를 비워 보낸 지시 줄 = 그 주문번호 · checked', x); }
        A.st.ai = { lines: [], cash: [{ buyer: '', buyer_phone: '', recv: '이받음', phone1: '010-5555-9733', phone2: '', addr: '제주시 연삼로 1', option: CAT[0], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' }], unsure: [], sms_draft: '' };
        { const r = (await pv('이받음 010-5555-9733 제주시 연삼로 1 타이벡 1박스', 'sms:61')).j, c = r.rows[0]; ok(c.kind === 'cash' && c.cells[10] === '010-1111-2222' && c.cells[1] === '010-1111-2222' && c.cells[6] === '010-5555-9733', '현금 줄 = K 구매자 번호 · B 도 K(받는 분 번호 안 들어감) · 받는 분 번호 칸은 글 그대로', c.cells); }
        console.log('③ 창구 길(payload · 기다리기 결과)');
        A.st.cfg = null; A.st.desk = true;
        { const w = (await pv('사이즈 S로요 부탁드립니다', 'sms:61')).j; const p = (await A.db.query(`SELECT payload FROM pending_orders WHERE id = $1`, [w.desk.id])).rows[0].payload;
          ok(p.sms_order_key === '2026111457273231' && p.sms_order_plat === '네이버' && p.from_sms === true, '창구 payload = sms_order_key · sms_order_plat', p);
          await A.db.query(`UPDATE pending_orders SET status = '완료', result = $2 WHERE id = $1`, [w.desk.id, JSON.stringify({ data: { lines: [{ key: '2026111457273231', note: 'S사이즈로', plat: '네이버', date: '' }], cash: [{ buyer: '', buyer_phone: '', recv: '이받음', phone1: '010-5555-9733', phone2: '', addr: '제주시 1', option: CAT[0], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' }], unsure: [], sms_draft: '' } })]);
          const g = (await A.call('GET', `/api/order-memo/preview/${w.desk.id}`)).j; const l = g.rows.find(x => x.kind === 'line'), c = g.rows.find(x => x.kind === 'cash');
          ok(g.state === 'done' && l.checked && l.checked.as === 'order' && l.checked.buyer === '010-1111-2222' && c.cells[10] === '010-1111-2222' && c.cells[1] === '010-1111-2222', '기다리기 결과 = 주문번호 줄 checked · 현금 K·B 구매자 번호', g.rows); }
        A.st.cfg = { ai: { direct: true } }; A.st.desk = false;
        console.log('④ 저장 왕복 = 주문번호 줄(#938) 그대로 · checked.buyer 남음');
        { const r = (await pv('S사이즈로', 'sms:61')).j; const sv = (await A.call('POST', '/api/order-memo', { raw: 'S사이즈로', source: 'sms:61', rows: r.rows })).j; const x = sv.rows[0];
          ok(sv.ok && x.key === '2026111457273231' && x.plat === '네이버' && x.checked && x.checked.as === 'order' && x.checked.buyer === '010-1111-2222' && x.sure === true, '저장 = 주문번호 줄 · checked {as order · buyer} · 확인됨', x);
          await A.call('POST', '/api/order-memo/clear', { all: true }); }
        console.log('⑤ 선물하기 꼴(구매자 번호 없음 · 주문번호 칸 빈칸)');
        { const r = (await pv('S사이즈로', 'sms:66')).j, x = r.rows[0]; ok(x.key === '2026111400000061' && x.checked && x.checked.as === 'order' && !('buyer' in x.checked), '주문번호 = 열쇠(상품주문번호) · checked 에 buyer 없음', x); }
        A.st.ai = { lines: [], cash: [{ buyer: '', buyer_phone: '', recv: '선물받', phone1: '010-9999-0006', phone2: '', addr: '제주시 1', option: CAT[0], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' }], unsure: [], sms_draft: '' };
        { const r = (await pv('선물받 010-9999-0006 제주시 1 타이벡 1박스', 'sms:66')).j, c = r.rows[0]; ok(c.cells[10] === '' && c.cells[1] === '' && c.sure === false && c.check_why.some(w => /구매자 번호 확인/.test(w)), '현금 줄 K·B 빈칸 + 「구매자 번호 확인」(받는 분 번호를 넣지 않음)', c); }
        { const r = (await pv(['', '', '', '선물받', CAT[0], '1', '010-9999-0006', '', '제주시 1', '', '', '', ''].join('\t'), 'sms:66')).j, c = r.rows[0]; ok(c.cells[10] === '' && c.cells[1] === '' && c.check_why.some(w => /구매자 번호 확인/.test(w)), '붙여 넣은 현금 행(규칙) = 같은 규칙', c.cells); }
        console.log('⑥ 자사몰 한 주문 두 품목 = 주문 하나');
        { const r = (await pv('보내는이 홍길동', 'sms:67')).j, x = r.rows[0]; ok(x && x.key === '20261114-0000777' && x.plat === '자사몰' && x.checked.buyer === '010-4444-0000', '자사몰 주문번호 줄', x); }
        console.log('⑦ 종전 그대로 = 주문 2건 · 0건 · 구매자 본인 · 본인 주문도 있는 받는 분 · manual');
        for (const [src, phone, why] of [['sms:62', '', '주문 2건'], ['sms:63', '', '주문 0건'], ['sms:64', '', '구매자 본인'], ['sms:65', '', '본인 주문도 있음'], ['manual', '010-5555-9733', 'manual']]) {
            A.st.ai = { lines: [], cash: [], unsure: [{ text: 'S사이즈로', why: '번호 없음' }], sms_draft: '' };
            const r = (await pv('S사이즈로', src, phone)).j; ok(r.rows.length === 0 && /S사이즈로/.test(r.leftover), `${why} = 「S사이즈로」 줄 안 만듦(종전 · 남은 글)`, r);
        }
        A.st.ai = { lines: [], cash: [{ buyer: '', buyer_phone: '', recv: '최받음', phone1: '010-6666-0002', phone2: '', addr: '제주시 1', option: CAT[0], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' }], unsure: [], sms_draft: '' };
        { const r = (await pv('최받음 제주시 1 타이벡 1박스', 'sms:62')).j, c = r.rows[0]; ok(c.cells[10] === '010-6666-0002' && c.cells[1] === '010-6666-0002', '주문 2건 받는 분 현금 줄 = 종전(K·B = 문자 번호)', c.cells); }
        console.log('⑧ 글자 검사');
        const md = fs.readFileSync(path.join(ROOT, '★에이전트오피스', '발주메모_정리.md'), 'utf8');
        ok(/sms_order_key/.test(md) && /주소 변경 요청은 `cash` 로 만들지 말고/.test(md), '창구 지침(발주메모_정리.md)에 sms_order_key 규칙 · 주소 변경 = unsure');
        const HAS = A.OM.ruleLine('S사이즈로', '2026-11-14'); ok(HAS === null, 'ruleLine 자체는 무변(번호 없는 줄 = null)');
    } finally { A.srv.close(); }

    if (HEADF) {
        console.log('⑨ 구/신 맞대기(보통 경우 응답 바이트)');
        delete require.cache[path.join(ROOT, 'order-memo.js')];
        const H = await boot(HEADF, PORT + 10); await seed(H);
        const N = await boot(path.join(ROOT, 'order-memo.js') + '', PORT + 11); await seed(N);
        try {
            const cases = [['010-1234-5678 S사이즈로\n10/30\t010-2222-3333\t입력o삭제x\t네이버', 'sms:64'], ['S사이즈로', 'sms:62'], ['S사이즈로', 'sms:63'], ['S사이즈로', 'sms:64'], ['S사이즈로', 'sms:65'], ['S사이즈로', 'manual', '010-5555-9733'], ['010-2222-3333 S사이즈로', 'sms:62'],
                ['이받음 010-5555-9733 제주시 연삼로 1 타이벡 1박스', 'sms:64'], ['최받음 제주시 1 타이벡 1박스', 'sms:62'], [['', '', '', '박받음', CAT[0], '1', '010-7777-8888', '', '제주시 1', '', '', '', ''].join('\t'), 'sms:63'], ['S사이즈로', ''], ['16일 발송', 'manual']];
            const ai = { lines: [{ key: '010-3333-4444', note: 'S사이즈로', plat: '', date: '' }], cash: [{ buyer: '', buyer_phone: '', recv: '박받음', phone1: '010-7777-8888', phone2: '', addr: '제주시 1', option: CAT[0], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' }], unsure: [{ text: 'x', why: 'y' }], sms_draft: '' };
            H.st.ai = ai; N.st.ai = ai;
            let same = 0; const diff = [];
            for (const [raw, src, phone] of cases) {
                const b = { raw }; if (src) b.source = src; if (phone) b.phone = phone;
                const h = await H.call('POST', '/api/order-memo/preview', b), n = await N.call('POST', '/api/order-memo/preview', b);
                if (JSON.stringify(strip(h)) === JSON.stringify(strip(n))) same++; else diff.push({ raw: raw.slice(0, 30), src, h: h.j, n: n.j });
            }
            ok(same === cases.length, `보통 경우 ${cases.length}가지 = 구/신 응답 같음(${same}/${cases.length})`, diff);
            H.st.aiUser.length = 0; N.st.aiUser.length = 0;
            await H.call('POST', '/api/order-memo/preview', { raw: '최받음 제주시 1', source: 'sms:62' }); await N.call('POST', '/api/order-memo/preview', { raw: '최받음 제주시 1', source: 'sms:62' });
            ok(H.st.aiUser[0] === N.st.aiUser[0] && !!H.st.aiUser[0], 'AI 에 넘긴 글도 같음(주문 하나가 아닐 때)');
        } finally { H.srv.close(); N.srv.close(); }
    }
    console.log(`\n${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
