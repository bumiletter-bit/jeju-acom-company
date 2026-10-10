// #610-G 검증 — 「발송 전 주문」 짧은 보관(sms/preorders.js) + lookup 연결
//   사용: node scripts/verify-610-preorders.js
//   실DB 의 표는 건드리지 않는다: 임시 표(pg_temp — 이 접속에서만 진짜 표를 가린다) + BEGIN READ ONLY + ROLLBACK + 임시 표 삭제. 3채널 API 호출 0(가짜 rows).
//   가짜 번호는 010-0000-…/0503-0000-… 꼴(실제 손님 번호 아님).
const path = require('path'); const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'sms', 'preorders.js')); const L = require(path.join(ROOT, 'sms', 'lookup.js')); const rules = require(path.join(ROOT, 'sms', 'rules.js'));
const { pool } = require(path.join(ROOT, 'scripts', 'desk', '_db.js'));
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) pass++; else { fail++; console.log('  ✗', label, extra === undefined ? '' : JSON.stringify(extra)); } };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label, { got: a, want: b });
const kst = off => new Date(Date.now() + 9 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
const GEN = col => `text GENERATED ALWAYS AS (regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g')) STORED`;
const DDL = [
    ...P.DDL.map(q => q.replace('CREATE TABLE IF NOT EXISTS sms_preorders', 'CREATE TEMP TABLE sms_preorders').replace(/CREATE INDEX IF NOT EXISTS (\w+)/, 'CREATE INDEX $1_t')),
    `CREATE TEMP TABLE delivery_shipments (tracking text PRIMARY KEY, ship_date date NOT NULL, partner text, recipient text, phone text, addr text, option_text text, qty integer, memo text,
        source text DEFAULT 'index', uploaded_at timestamptz DEFAULT now(), buyer_phone text, phone_digits ${GEN('phone')}, buyer_digits ${GEN('buyer_phone')})`,
    `CREATE TEMP TABLE delivery_status (tracking text PRIMARY KEY, bucket text, code text, label text, msg text, event_time text, branch text, driver_name text, driver_phone text, events jsonb,
        delivered boolean DEFAULT false, checked_at timestamptz DEFAULT now(), first_trouble_at timestamptz, handled_at timestamptz, handled_by text)`,
];
const ADDR = '가짜시 시험구 검증로 610';
// 채널 조회 함수가 내는 줄 꼴 그대로(주소·이름 전체·메모가 들어 있다 — 표에는 안 남아야 한다)
const nv = (pid, buyer, rname, rtel, opt, qty, paid, bname) => ({ '구매자명': bname || rname, '구매자연락처': buyer, '수취인명': rname, '옵션정보': opt, '수량': qty, '수취인연락처1': rtel, '수취인연락처2': '', '통합배송지': ADDR, '배송메세지': '문 앞 메모', _pid: pid, _x: { paymentDate: paid, orderDate: paid } });
const cp = (oid, buyer, rname, rtel, opt, qty) => ({ '구매자': rname, '구매자전화번호': buyer, '수취인이름': rname, '수취인전화번호': rtel, '수취인 주소': ADDR, '배송메세지': '문 앞 메모', '등록상품명': '하우스감귤', '노출상품명(옵션명)': opt, '구매수(수량)': qty, _orderId: oid });
const c24 = (oid, item, buyer, rname, rtel, opt, qty) => ({ '주문자명': rname, '주문자 휴대전화': buyer, '수령인': rname, '수령인 휴대전화': rtel, '수령인 주소(전체)': ADDR, '배송메시지': '문 앞 메모', '주문상품명(세트상품 포함)': opt, '수량': qty, _orderId: oid, _itemCode: item });
const NAVER1 = [
    nv('N001', '010-0000-0101', '김하나', '010-0000-0101', '하우스감귤 가정용 - 4kg(로얄과)', 1, ago(3)),                 // ① 본인 주문
    nv('N002', '010-0000-0112', '이두리', '010-0000-0102', '황금향 3kg', 1, ago(5), '보낸이'),                          // ② 선물(보낸 분 0112)
    nv('N003', '010-0000-0103', '박세찌', '010-0000-0103', '하우스감귤 가정용 - 4kg(로얄과)', 1, ago(2)),                 // ③ 같은 날 두 줄 = 한 건
    nv('N004', '010-0000-0103', '박세찌', '010-0000-0103', '황금향 3kg', 2, ago(2)),
    nv('N005', '010-0000-0104', '최네모', '010-0000-0104', '하우스감귤 가정용 - 4kg(로얄과)', 1, ago(50)),                // ④ 이틀 전 + 오늘 = 2건
    nv('N006', '010-0000-0104', '최네모', '010-0000-0104', '황금향 3kg', 1, ago(1)),
    nv('N007', '010-0000-0105', '정오성', '010-0000-0105', '하우스감귤 가정용 - 4kg(로얄과)', 1, ago(4)),                 // ⑤ 송장 표에도 있는 번호
    nv('N008', '', '강육각', '010-0000-0106', '하우스감귤 가정용 - 4kg(로얄과)', 1, ago(4)),                             // ⑥ 구매자 번호 빈칸(네이버가 늦게 채움)
    nv('N009', '010-0000-0109', '장구슬', '010-0000-0121', '황금향 3kg', 1, ago(6), '보낸이'),                          // ⑦ 한 분이 선물 2건
    nv('N010', '010-0000-0109', '임열매', '010-0000-0122', '황금향 3kg', 1, ago(6), '보낸이'),
    nv('N011', '010-0000-0107', '조칠성', '010-0000-0107', '예약★레드향 3kg', 1, ago(3)),                               // ⑧ 예약 상품
    nv('', '010-0000-0199', '열쇠없음', '010-0000-0199', 'x', 1, ago(1)),                                               // 열쇠 없는 줄 = 버림
];
const COUPANG1 = [cp('C001', '0503-0000-0201', '윤팔도', '0503-0000-0202', '하우스감귤 4kg 로얄과', 2), cp('C001', '0503-0000-0201', '윤팔도', '0503-0000-0202', '황금향 3kg', 1)];
const CAFE1 = [c24('M001', 'i1', '010-0000-0301', '한자사', '010-0000-0301', '하우스감귤 4kg(로얄과)', 1), c24('M001', 'i2', '010-0000-0301', '한자사', '010-0000-0301', '황금향 선물용 5kg', 1)];

(async () => {
    // ── A. 줄 옮기기(순수) ──
    let m = P.mapRows('naver', NAVER1);
    eq(m.length, 11, 'mapRows 네이버: 열쇠 없는 줄 빼고 11');
    eq(Object.keys(m[0]).sort(), ['buyer_digits', 'channel', 'option_text', 'order_key', 'paid_at', 'qty', 'recipient_digits', 'recipient_initial'], 'mapRows: 칸은 8개뿐(주소·이름·메모 없음)');
    eq([m[0].order_key, m[0].buyer_digits, m[0].recipient_digits, m[0].recipient_initial, m[0].qty], ['N001', '01000000101', '01000000101', '김', 1], 'mapRows 네이버: 번호는 숫자만 · 이름은 성 한 글자');
    ok(/^\d{4}-\d{2}-\d{2}T/.test(m[0].paid_at), 'mapRows 네이버: 결제 시각(_x.paymentDate)');
    eq(m.find(x => x.order_key === 'N008').buyer_digits, '', 'mapRows: 빈 번호 = 빈 글자');
    m = P.mapRows('coupang', COUPANG1); eq([m.length, m[0].order_key, m[0].recipient_digits, m[0].paid_at, m[1].order_key], [2, 'C001|하우스감귤 4kg 로얄과', '050300000202', null, 'C001|황금향 3kg'], 'mapRows 쿠팡: 열쇠 = 주문번호|옵션 · 안심번호 · 결제 시각 없음');
    m = P.mapRows('cafe24', CAFE1); eq([m.length, m[0].order_key, m[1].order_key, m[0].recipient_initial], [2, 'M001|i1', 'M001|i2', '한'], 'mapRows 자사몰: 열쇠 = 주문번호|품목코드');
    m = P.mapRows('naver', [nv('D1', '010****0101', ' 김 하나', '***', 'a', 1, 'garbage'), nv('D1', '010****0101', '김하나', '***', 'a', 2, '')]);
    eq([m.length, m[0].buyer_digits, m[0].recipient_digits, m[0].recipient_initial, m[0].qty, m[0].paid_at], [1, '', '', '김', 3, null], 'mapRows: 가림값 번호 = 빈 글자 · 같은 열쇠 수량 합 · 이상한 시각 = null');
    eq(P.mapRows('naver', [nv('T1', '', 'a', '', 'o', 1, '2026-10-10 09:30:00')])[0].paid_at, '2026-10-10T00:30:00.000Z', 'mapRows: 시간대 없는 시각 = 한국 시각');
    eq([P.mapRows('naver', null), P.mapRows('없는채널', NAVER1)], [[], []], 'mapRows: 빈 입력·모르는 채널');

    const c = await pool.connect();
    try {
        for (const q of DDL) await c.query(q);
        await c.query('BEGIN READ ONLY');
        eq((await c.query(`SELECT count(*)::int n FROM sms_preorders`)).rows[0].n, 0, '임시 표(진짜 표를 가림 · 0줄에서 시작)');
        let calls = { naver: 0, coupang: 0, cafe24: 0 }, daysSeen = [];
        let naverRows = NAVER1, coupangRows = COUPANG1, cafeRows = CAFE1, coupangFail = false;
        const deps = { fetchNaver: async d => { calls.naver++; daysSeen.push(d); return { rows: naverRows, fetched: naverRows.length }; },
            fetchCoupang: async d => { calls.coupang++; if (coupangFail) throw new Error('coupang_relay_error_500'); return { rows: coupangRows }; },
            fetchCafe24: async d => { calls.cafe24++; return cafeRows; } };   // 자사몰은 배열로 돌려줘 본다(둘 다 받는지)

        // ── B. 첫 수집 ──
        let r = await P.collect(c, deps);
        eq([r.ok, r.days, r.total, r.channels.naver.rows, r.channels.coupang.rows, r.channels.cafe24.rows, daysSeen], [true, 3, 15, 11, 2, 2, [3]], '수집 1회: 15줄(네이버 11 · 쿠팡 2 · 자사몰 2 · 배열 반환도 받음) · days 3');
        const cols = (await c.query(`SELECT * FROM sms_preorders LIMIT 1`)).fields.map(f => f.name).sort();
        eq(cols, ['buyer_digits', 'channel', 'created_at', 'id', 'miss', 'option_text', 'order_key', 'paid_at', 'qty', 'recipient_digits', 'recipient_initial', 'seen_at'], '표 칸 12개(주소·이름·메모·전체 번호 글자 칸 없음)');
        const dump = JSON.stringify((await c.query(`SELECT * FROM sms_preorders`)).rows);
        ok(!dump.includes('검증로') && !dump.includes('메모') && !dump.includes('하나') && !dump.includes('보낸이') && !/\d{3}-\d{4}-\d{4}/.test(dump), '저장값에 주소·메모·이름 전체·하이픈 번호 없음');
        eq((await c.query(`SELECT max(char_length(recipient_initial))::int n FROM sms_preorders`)).rows[0].n, 1, '이름은 한 글자만');

        // ── C. lookup 발송 전 갈래 ──
        await c.query(`INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, addr, option_text, qty, buyer_phone) VALUES ('900000000101', $1::date, '효돈농협', '정오성', '01000000105', $2, '하우스감귤 4kg', 1, '01000000105')`, [kst(-5), ADDR]);
        await c.query(`INSERT INTO delivery_status (tracking, bucket, label, delivered) VALUES ('900000000101', '배송완료', '배송완료', true)`);
        const look = (p, o) => L.lookupByPhone(c, p, o);
        r = await look('010-0000-0101');
        eq([r.match, r.role, r.candidates, r.order.pre, r.order.channel, r.order.ship_date, r.order.delivered, r.order.tracking_tail, r.order.recipient_initial, r.order.qty, r.order.paid_known], ['one', 'recipient', 1, true, 'naver', null, false, null, '김', 1, true], '①송장 없음 + 발송 전 1건 = one/recipient(pre)');
        ok(Math.abs(Date.parse(r.order.paid_at) - Date.parse(ago(3))) < 5000, '①paid_at = 결제 시각');
        r = await look('01000000112'); eq([r.match, r.role, r.order.pre, r.order.recipient_initial], ['one', 'buyer', true, '이'], '②선물 — 보낸 분 번호 = one/buyer');
        r = await look('01000000102'); eq([r.match, r.role], ['one', 'recipient'], '②선물 — 받는 분 번호');
        r = await look('01000000103'); eq([r.match, r.candidates, r.order.qty], ['one', 1, 3], '③같은 날 두 줄 = 한 건(수량 합)'); ok(/4kg/.test(r.order.option_text) && /황금향/.test(r.order.option_text), '③옵션 두 가지', r.order.option_text);
        r = await look('01000000104'); eq([r.match, r.candidates, r.why, r.pre, r.order], ['many', 2, 'multi-orders', true, null], '④결제일 다른 2건 = many');
        r = await look('01000000105'); eq([r.match, r.order.pre, r.order.ship_date, r.order.tracking_tail, r.pre_pending, r.order.delivered], ['one', undefined, kst(-5), '0101', 1, true], '⑤송장 표에 있으면 송장 우선 + pre_pending 1');
        eq(L.toPublic(r).pre_pending, 1, '⑤toPublic 에 pre_pending');
        r = await look('01000000105', { pre: false }); eq([r.match, r.pre_pending], ['one', undefined], '⑤opts.pre false = 송장 표만');
        r = await look('01000000106'); eq([r.match, r.role], ['one', 'recipient'], '⑥구매자 빈칸 줄 — 받는 분 번호로 찾음');
        r = await look('01000000109'); eq([r.match, r.why], ['many', 'multi-orders'], '⑦선물 2건 = many');
        r = await look('01000000109', { recipientName: '임열매님' }); eq([r.match, r.role, r.narrowed, r.order.recipient_initial], ['one', 'buyer', 'surname', '임'], '⑦이름으로 좁히기(발송 전은 성 한 글자 비교)');
        r = await look('01000000109', { recipientName: '홍길동' }); eq([r.match, r.why], ['many', 'name-no-match'], '⑦안 맞는 이름 = many');
        r = await look('0503-0000-0202'); eq([r.match, r.order.channel, r.order.paid_known, r.order.qty], ['one', 'coupang', false, 3], '쿠팡 안심번호로는 찾힘(실제 손님 번호와는 안 맞음) · 결제 시각 모름 표시');
        r = await look('01000000301'); eq([r.match, r.order.channel, r.order.qty], ['one', 'cafe24', 2], '자사몰 주문');
        r = await look('01000000999'); eq([r.match, r.candidates, r.pre_pending], ['none', 0, undefined], '모르는 번호 = none');
        for (const bad of ['', '1234', null]) { r = await look(bad); eq([r.match, r.why], ['none', 'bad-phone'], '못 쓰는 번호 ' + JSON.stringify(bad) + ' — 빈 번호 줄(⑥)에 안 걸림'); }
        // 밖으로 나가는 것 · 새로 묻기 · 규칙 답
        r = await look('01000000103'); const pub = L.toPublic(r); const pj = JSON.stringify(pub);
        ok(Object.keys(pub.order).every(k => L.PUBLIC_ORDER.includes(k)) && pub.order.pre === true && pub.order.channel === 'naver' && !!pub.order.paid_at, 'toPublic: pre · channel · paid_at 허용', Object.keys(pub.order));
        ok(!/0100000\d{4}/.test(pj) && !pj.includes('세찌') && !pj.includes('검증로') && !/N00\d/.test(pj), 'toPublic: 번호·이름 전체·주소·주문번호 없음');
        let cjCalls = 0; const r2 = await L.refreshOrder(c, r, { cj: { trackOne: async () => { cjCalls++; return { bucket: '배송완료' }; } } });
        eq([cjCalls, r2.match, r2.order.pre], [0, 'one', true], '새로 묻기: 발송 전 주문은 CJ 를 안 부름(오류 없음)');
        const lk = Object.assign({}, r, { order: Object.assign({}, r.order, { option: r.order.option_text }) });
        let a = rules.answer({ text: '언제 와요?', bucket: 'ship_q', order: lk, holidays: {}, now: Date.now() });
        ok(a && (a.kind === 'ship_before' || a.staff === true) && (a.staff || /발송/.test(a.text)), '규칙(sms/rules.js): 발송 전 주문 = ship_before 글 또는 사람', a && { kind: a.kind, staff: a.staff, why: a.why });
        r = await look('01000000107'); a = rules.answer({ text: '언제 와요?', bucket: 'ship_q', order: r, holidays: {}, now: Date.now() });
        eq([r.match, a && a.staff, a && a.why], ['one', true, 'reserve'], '규칙: 예약 상품 = 사람에게');

        // ── D. 다시 수집 — 갱신 · 사라진 주문 ──
        const seen0 = (await c.query(`SELECT seen_at::text AS seen_at FROM sms_preorders WHERE order_key = 'N001'`)).rows[0].seen_at;
        naverRows = NAVER1.filter(x => x._pid !== 'N001').map(x => x._pid === 'N008' ? nv('N008', '010-0000-0116', '강육각', '010-0000-0106', x['옵션정보'], 5, ago(4)) : x);
        r = await P.collect(c, deps);
        eq([r.total, r.channels.naver.rows, r.channels.naver.missed, r.channels.naver.removed], [15, 10, 1, 0], '수집 2회: 안 보인 1줄 = miss 1(아직 안 지움)');
        eq((await c.query(`SELECT miss, seen_at::text = $1 AS same FROM sms_preorders WHERE order_key = 'N001'`, [seen0])).rows[0], { miss: 1, same: true }, '안 보인 줄: miss 1 · seen_at 그대로');
        eq((await c.query(`SELECT buyer_digits, qty, miss FROM sms_preorders WHERE order_key = 'N008'`)).rows[0], { buyer_digits: '01000000116', qty: 5, miss: 0 }, '다시 보인 줄: 늦게 온 구매자 번호·수량 갱신');
        eq((await look('01000000101')).match, 'none', '한 번 안 보인 주문은 바로 답에서 빠짐(miss 0 만 본다)');
        eq((await look('01000000116')).role, 'buyer', '늦게 채워진 구매자 번호로 찾힘');
        naverRows = NAVER1;   // 다시 나타남 → miss 0
        r = await P.collect(c, deps); eq([(await c.query(`SELECT miss FROM sms_preorders WHERE order_key = 'N001'`)).rows[0].miss, r.total], [0, 15], '다시 보이면 miss 0');
        naverRows = NAVER1.filter(x => x._pid !== 'N001'); await P.collect(c, deps); r = await P.collect(c, deps);
        eq([r.channels.naver.removed, r.total, (await c.query(`SELECT count(*)::int n FROM sms_preorders WHERE order_key = 'N001'`)).rows[0].n], [1, 14, 0], '두 번 연속 안 보이면 삭제');
        // 채널 실패 — 그 채널은 손대지 않음
        coupangFail = true; coupangRows = []; r = await P.collect(c, deps);
        eq([r.ok, r.channels.coupang.error, (await c.query(`SELECT count(*)::int n, max(miss)::int m FROM sms_preorders WHERE channel = 'coupang'`)).rows[0]], [false, 'coupang_relay_error_500', { n: 2, m: 0 }], '쿠팡 조회 실패: 줄 그대로 · miss 안 올림 · 다른 채널은 계속');
        ok(r.channels.naver.rows === 10 && r.channels.cafe24.rows === 2, '실패해도 네이버·자사몰은 수집');
        coupangFail = false; await P.collect(c, deps); r = await P.collect(c, deps); eq(r.channels.coupang.removed, 2, '쿠팡 0건이 두 번 = 삭제');
        // collect(deps) 꼴 · DB 없음
        r = await P.collect(Object.assign({ pool: c }, deps), { days: 2 }); eq([r.days, daysSeen[daysSeen.length - 1]], [2, 2], 'collect(deps, opts) 꼴도 받음 · days 전달');
        let threw = ''; try { await P.collect(deps); } catch (e) { threw = e.message; } ok(/DB/.test(threw), 'DB 없으면 분명한 오류');

        // ── E. 7일 정리 ──
        await c.query(`UPDATE sms_preorders SET seen_at = now() - interval '8 days' WHERE order_key IN ('N002', 'N003')`);
        eq([await P.purge(c, 7), (await c.query(`SELECT count(*)::int n FROM sms_preorders WHERE order_key IN ('N002','N003','N004')`)).rows[0].n], [2, 1], '7일 넘게 안 보인 줄 삭제(2줄) · 나머지 그대로');
        await c.query(`UPDATE sms_preorders SET paid_at = now() - interval '20 days' WHERE order_key = 'N006'`);
        eq((await look('01000000104')).match, 'one', '조회 창(14일) 밖 결제 건은 안 봄 → 남은 1건으로 one');

        // ── F. 주기 실행(tick) ──
        const store = {}; const cfgDeps = Object.assign({ cfgGet: async k => store[k] || null, cfgSet: async (k, v) => { store[k] = v; } }, deps);
        const noon = Date.parse(kst(0) + 'T03:00:00Z');   // 한국 낮 12시
        calls = { naver: 0, coupang: 0, cafe24: 0 };
        eq(await P.tick(c, cfgDeps, { now: noon }), { ran: false, why: 'off' }, 'tick: 설정이 없으면 안 돎(기본 꺼짐)');
        store.sms_gateway = { enabled: true, preorders: false }; eq((await P.tick(c, cfgDeps, { now: noon })).why, 'off', 'tick: preorders false = 안 돎'); eq(calls.naver, 0, 'tick: 꺼져 있으면 조회 0');
        store.sms_gateway.preorders = true; r = await P.tick(c, cfgDeps, { now: noon });
        eq([r.ran, calls, !!store.sms_preorders_last.at, store.sms_preorders_last.started_at, typeof store.sms_preorders_last.result.total], [true, { naver: 1, coupang: 1, cafe24: 1 }, true, new Date(noon).toISOString(), 'number'], 'tick: 켜면 1회 · 채널마다 1번 · 시각 기록');
        ok(!JSON.stringify(store.sms_preorders_last).match(/0100000\d{4}/), 'tick: 기록에 번호 없음');
        store.sms_preorders_last.at = new Date(noon).toISOString();
        eq([(await P.tick(c, cfgDeps, { now: noon + 59 * 60000 })).why, calls.naver], ['not-due', 1], 'tick: 59분 뒤 = 아직');
        eq([(await P.tick(c, cfgDeps, { now: noon + 61 * 60000 })).ran, calls.naver], [true, 2], 'tick: 61분 뒤 = 돎');
        store.sms_preorders_last = {}; eq([(await P.tick(c, cfgDeps, { now: Date.parse(kst(0) + 'T19:30:00Z') })).why, calls.naver], ['quiet', 2], 'tick: 새벽 4시 반(한국) = 쉼');
        eq((await P.tick(Object.assign({ pool: c }, cfgDeps), { now: noon + 5 * 3600e3 })).ran, true, 'tick(deps, opts) 꼴도 받음');
    } finally {
        try { await c.query('ROLLBACK'); } catch (e) { /* 무시 */ }
        for (const t of ['sms_preorders', 'delivery_shipments', 'delivery_status']) { try { await c.query('DROP TABLE IF EXISTS pg_temp.' + t); } catch (e) { /* 반드시 pg_temp. */ } }
        c.release();
    }
    // 표가 아직 없을 때(배포 전) — 조회가 조용히 none
    const has = (await pool.query(`SELECT to_regclass('public.sms_preorders') IS NOT NULL AS y`)).rows[0].y;
    if (!has) eq((await P.lookupPre(pool, '01000000101')).why, 'no-table', '진짜 표가 아직 없으면 none(no-table) — 오류 아님');
    else eq((await pool.query(`SELECT count(*)::int n FROM sms_preorders WHERE order_key ~ '^(N0|C0|M0)\\d\\d'`)).rows[0].n, 0, '검증 뒤 진짜 표에 가짜 줄 0');
    await pool.end();
    console.log(`\n#610-G preorders 검증: ${pass}/${pass + fail} ${fail ? '✗ 실패 ' + fail : '통과'}`);
    process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERR', e.message, (e.stack || '').split('\n')[1] || ''); try { await pool.end(); } catch (_) { } process.exit(2); });
