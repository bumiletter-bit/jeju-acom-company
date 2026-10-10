// #610-C 검증 — 「발신 번호 → 최근 주문 하나」(sms/lookup.js)
//   사용: node scripts/verify-610-lookup.js [--live]      (--live = CJ 배송조회 실제 1건 · 임시 표에만 적음)
//   실DB 의 표는 건드리지 않는다: 임시 표(pg_temp · 같은 이름이라 이 접속에서만 진짜 표를 가린다)를 만들고, 읽기 전용 트랜잭션(BEGIN READ ONLY) 안에서
//   가짜 주문을 넣고 끝에 ROLLBACK + 임시 표 삭제. 읽기 전용 트랜잭션은 임시 표에만 쓰기를 허용하므로 진짜 표에 쓰려 하면 DB 가 거절한다(㉮에서 확인).
//   가짜 번호는 전부 010-0000-…/0503-0000-… 꼴(실제 손님 번호 아님).
const path = require('path'); const ROOT = path.join(__dirname, '..');
const L = require(path.join(ROOT, 'sms', 'lookup.js'));
const { pool } = require(path.join(ROOT, 'scripts', 'desk', '_db.js'));
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) pass++; else { fail++; console.log('  ✗', label, extra === undefined ? '' : JSON.stringify(extra)); } };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label, { got: a, want: b });
const kst = off => new Date(Date.now() + 9 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);

// 총괄이 server.js initDB 에 넣을 문장과 같은 꼴(임시 표에 그대로 적용해 생성 칸이 도는지 본다)
const GEN = col => `text GENERATED ALWAYS AS (regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g')) STORED`;
const DDL = [
    `CREATE TEMP TABLE delivery_shipments (tracking text PRIMARY KEY, ship_date date NOT NULL, partner text, recipient text, phone text, addr text,
        option_text text, qty integer, memo text, source text DEFAULT 'index', uploaded_at timestamptz DEFAULT now())`,
    `ALTER TABLE delivery_shipments ADD COLUMN IF NOT EXISTS buyer_phone text`,
    `ALTER TABLE delivery_shipments ADD COLUMN IF NOT EXISTS phone_digits ${GEN('phone')}`,
    `ALTER TABLE delivery_shipments ADD COLUMN IF NOT EXISTS buyer_digits ${GEN('buyer_phone')}`,
    `CREATE INDEX idx_ds_phone_digits_t ON delivery_shipments(phone_digits) WHERE phone_digits <> ''`,
    `CREATE INDEX idx_ds_buyer_digits_t ON delivery_shipments(buyer_digits) WHERE buyer_digits <> ''`,
    `CREATE TEMP TABLE delivery_status (tracking text PRIMARY KEY, bucket text, code text, label text, msg text, event_time text, branch text,
        driver_name text, driver_phone text, events jsonb, delivered boolean DEFAULT false, checked_at timestamptz DEFAULT now(), first_trouble_at timestamptz,
        handled_at timestamptz, handled_by text)`,
];
const ADDR = '가짜시 시험구 검증로 610';
// [tracking, 며칠 전, 거래처, 받는 분, 받는 분 번호, 옵션, 수량, 구매자 번호]
const SHIP = [
    ['900000000001', 2, '효돈농협', '김하나', '01000000001', '하우스감귤 4kg(로얄과)', 1, '01000000001'],          // ① 본인 주문 1건
    ['900000000002', 3, '효돈농협', '이두리', '01000000002', '황금향 3kg', 1, '01000000012'],                        // ② 선물 — 받는 분 002 · 보낸 분 012
    ['900000000003', 3, '대성(시온)', '박세찌', '050300000003', '하우스감귤 2.5kg(소과)', 1, '01000000013'],        // ③ 받는 분이 안심번호 · 보낸 분 013
    ['900000000004', 2, '효돈농협', '최네모', '01000000004', '하우스감귤 4kg(로얄과)', 1, '01000000004'],           // ④ 한 분께 상자 2개(이름 띄어쓰기만 다름)
    ['900000000005', 2, '효돈농협', '최 네모', '01000000004', '황금향 3kg', 1, '01000000004'],
    ['900000000006', 9, '효돈농협', '정오성', '01000000005', '하우스감귤 4kg(로얄과)', 1, '01000000005'],           // ⑤ 같은 번호 주문 2건(날짜 다름)
    ['900000000007', 2, '효돈농협', '정오성', '01000000005', '하우스감귤 4.5kg(소과)', 1, '01000000005'],
    ['900000000008', 4, '효돈농협', '강육각', '01000000006', '하우스감귤 4kg(로얄과)', 1, '01000000006'],           // ⑥ 본인 주문 + 선물도 보냄
    ['900000000009', 4, '효돈농협', '강어머니', '01000000016', '황금향 3kg', 1, '01000000006'],
    ['900000000010', 1, '효돈농협', '조칠성', '010-0000-0007', '하우스감귤 4kg(로얄과)', 2, '010-0000-0007'],       // ⑦ 하이픈으로 저장된 번호
    ['900000000011', 20, '효돈농협', '윤팔도', '01000000008', '하우스감귤 4kg(로얄과)', 1, '01000000008'],          // ⑧ 14일보다 오래됨
    ['900000000012', 5, '효돈농협', '장구슬', '01000000021', '황금향 3kg', 1, '01000000009'],                        // ⑨ 한 분이 선물 2건(받는 분 둘)
    ['900000000013', 5, '효돈농협', '임열매', '01000000022', '황금향 3kg', 1, '01000000009'],
    ['900000000014', 2, '효돈농협', '한빈칸', '01000000010', '하우스감귤 4kg(로얄과)', 1, null],                    // ⑩ 구매자 번호를 못 붙인 줄(빈칸)
    ['900000000015', 2, '효돈농협', '오빈칸', '', '하우스감귤 4kg(로얄과)', 1, ''],                                 // ⑪ 번호가 아예 빈 줄
    ['900000000016', 6, '대성(시온)', '서열여섯', '01000000011', '레드키위 2kg', 1, '01000000011'],                 // ⑫ 상태 줄 없음
    ['900000000017', 3, '효돈농협', '신열일곱', '01000000014', '하우스감귤 4kg(로얄과)', 1, '01000000014'],         // ⑬ 같은 날 두 거래처에서 한 상자씩
    ['900000000018', 3, '대성(시온)', '신열일곱', '01000000014', '레드키위 2kg', 1, '01000000014'],
    ['900000000019', 1, '효돈농협', '권열아홉', '01000000015', '하우스감귤 4kg(로얄과)', 1, '01000000015'],         // ⑭ 미배송(섬지역)
    ['900000000020', 14, '효돈농협', '황스물', '01000000017', '하우스감귤 4kg(로얄과)', 1, '01000000017'],          // ⑮ 딱 14일 전(창 안)
];
// [tracking, bucket, label, delivered, 확인한 지 몇 분]
const STAT = [
    ['900000000001', '배송완료', '배송완료', true, 600], ['900000000002', '배송출발', '배송출발', false, 30], ['900000000003', '간선상하차', '간선상차', false, 300],
    ['900000000004', '배송완료', '배송완료', true, 600], ['900000000005', '간선상하차', '간선하차', false, 10], ['900000000010', '배송완료', '배송완료', true, 60],
    ['900000000017', '배송완료', '배송완료', true, 60], ['900000000018', '배송완료', '배송완료', true, 60], ['900000000019', '미배송', '배송출발', false, 500],
];

(async () => {
    // ── A. 번호 정리 10건 ──
    const N = [['010-1234-5678', '01012345678'], ['01012345678', '01012345678'], ['+82 10-1234-5678', '01012345678'], ['+82-010-1234-5678', '01012345678'], ['821012345678', '01012345678'],
        ['0503-1234-5678', '050312345678'], [' 010 1234 5678 ', '01012345678'], ['(010)1234.5678', '01012345678'], ['', ''], [null, '']];
    for (const [a, b] of N) eq(L.normalizePhone(a), b, 'normalizePhone ' + JSON.stringify(a));
    eq([L.lookupable('01012345678'), L.lookupable('050312345678'), L.lookupable(''), L.lookupable('1234'), L.lookupable('15881234'), L.lookupable('0212345678')], [true, true, false, false, false, true], 'lookupable 6종');

    // ── B. 구매자 번호 짝짓기 ──
    const bi = L.makeBuyerIndex();
    bi.add('f1', '010-0000-0001', '김 하나', '01000000091'); bi.add('f1', '01000000002', '이두리', '01000000092'); bi.add('f1', '01000000002', '이두리', '010-0000-0093');
    bi.add('f1', '01000000003', '박세찌', ''); bi.add('f2', '01000000001', '김하나', '01000000094'); bi.add('f1', '01000000001', '김하나', '010-0000-0091');
    eq(bi.find('f1', '01000000001', '김하나'), { buyer: '01000000091', why: 'one' }, '짝짓기: 이름 띄어쓰기·하이픈 무시 · 같은 번호 두 번 = one');
    eq(bi.find('f1', '01000000002', '이두리'), { buyer: null, why: 'ambiguous' }, '짝짓기: 구매자 둘 = 비움');
    eq(bi.find('f1', '01000000003', '박세찌'), { buyer: null, why: 'none' }, '짝짓기: 구매자 번호 빈칸 = none');
    eq(bi.find('f2', '01000000001', '김하나'), { buyer: '01000000094', why: 'one' }, '짝짓기: 파일이 다르면 따로');
    eq(bi.find('f3', '01000000001', '김하나'), { buyer: null, why: 'none' }, '짝짓기: 없는 파일');

    const c = await pool.connect();
    try {
        for (const q of DDL) await c.query(q);   // 임시 표 만들기는 읽기 전용 트랜잭션 밖에서(DB 가 그 안에서는 CREATE 를 막는다) — 이 접속에서만 보이고 접속이 끝나면 사라진다
        await c.query('BEGIN READ ONLY');
        for (const s of SHIP) await c.query(`INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, addr, option_text, qty, memo, buyer_phone) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [s[0], kst(-s[1]), s[2], s[3], s[4], ADDR, s[5], s[6], '부재 시 문 앞 메모', s[7]]);
        for (const t of STAT) await c.query(`INSERT INTO delivery_status (tracking, bucket, code, label, msg, event_time, branch, driver_name, driver_phone, events, delivered, checked_at)
            VALUES ($1,$2,'',$3,'(담당사원:가짜기사 ***)','2026-10-09 10:00','가짜지점','가짜기사','010-9999-9999','[]'::jsonb,$4, now() - ($5 || ' minutes')::interval)`, t);
        // ㉮ 임시 표가 진짜 표를 가리고 있는지 · 진짜 표에는 못 쓰는지
        eq((await c.query(`SELECT count(*)::int n FROM delivery_shipments`)).rows[0].n, SHIP.length, '임시 표가 진짜 표를 가림(가짜 20줄만 보임)');
        await c.query('SAVEPOINT w'); let denied = false;
        try { await c.query(`UPDATE public.delivery_shipments SET memo = memo WHERE false`); } catch (e) { denied = /read-only/i.test(e.message); }
        await c.query('ROLLBACK TO SAVEPOINT w'); ok(denied, '진짜 표 쓰기는 DB 가 거절(읽기 전용 트랜잭션)');
        eq((await c.query(`SELECT phone_digits, buyer_digits FROM delivery_shipments WHERE tracking = '900000000010'`)).rows[0], { phone_digits: '01000000007', buyer_digits: '01000000007' }, '생성 칸: 하이픈 번호 → 숫자만');
        eq((await c.query(`SELECT phone_digits, buyer_digits FROM delivery_shipments WHERE tracking = '900000000014'`)).rows[0], { phone_digits: '01000000010', buyer_digits: '' }, '생성 칸: 구매자 NULL → 빈 글자');

        // ── C. 8갈래 + 경계 ──
        const look = (p, o) => L.lookupByPhone(c, p, o);
        let r = await look('010-0000-0001');
        eq([r.match, r.role, r.candidates, r.order && r.order.ship_date, r.order && r.order.boxes, r.order && r.order.tracking_tail, r.order && r.order.recipient_initial, r.order && r.order.delivered, r.order && r.order.status_label],
            ['one', 'recipient', 1, kst(-2), 1, '0001', '김', true, '배송완료'], '①본인 주문 1건 = one/recipient');
        r = await look('01000000012'); eq([r.match, r.role, r.order && r.order.recipient_initial, r.order && r.order.status_label, r.order && r.order.delivered], ['one', 'buyer', '이', '배송출발', false], '②선물 — 보낸 분 번호 = one/buyer · 받는 분은 성만');
        r = await look('01000000002'); eq([r.match, r.role], ['one', 'recipient'], '②선물 — 받는 분 번호 = one/recipient');
        r = await look('01000000013'); eq([r.match, r.role, r.order && r.order.partner], ['one', 'buyer', '대성(시온)'], '③안심번호 수취인 — 구매자 번호로 찾음');
        r = await look('0503-0000-0003'); eq([r.match, r.role], ['one', 'recipient'], '③안심번호 자체로도(하이픈 입력) 찾음');
        r = await look('01000000004');
        eq([r.match, r.role, r.candidates, r.order && r.order.boxes, r.order && r.order.boxes_delivered, r.order && r.order.delivered, r.order && r.order.tracking_tail, r.order && r.order.status_label, r.order && r.order.qty],
            ['one', 'recipient', 1, 2, 1, false, '0005', '간선상하차', 2], '④상자 2개 = 한 건 · 안 끝난 상자가 대표');
        ok(r.order && /4kg/.test(r.order.option_text) && /황금향/.test(r.order.option_text), '④옵션 두 가지가 한 글로', r.order && r.order.option_text);
        r = await look('01000000005'); eq([r.match, r.role, r.order, r.candidates, r.why], ['many', null, null, 2, 'multi-orders'], '⑤같은 번호 2건 = many');
        r = await look('01000000006'); eq([r.match, r.candidates, r.why], ['many', 2, 'both-roles'], '⑥본인 주문 + 보낸 선물 = many');
        r = await look('01000000016'); eq([r.match, r.role], ['one', 'recipient'], '⑥그 선물을 받은 분은 one');
        r = await look('+82 10-0000-0007'); eq([r.match, r.role, r.order && r.order.qty, r.order && r.order.boxes], ['one', 'recipient', 2, 1], '⑦하이픈 저장 번호 · +82 입력');
        r = await look('01000000099'); eq([r.match, r.candidates, r.order], ['none', 0, null], '⑧모르는 번호 = none');
        r = await look('01000000008'); eq(r.match, 'none', '⑧14일보다 오래된 주문 = none');
        r = await look('01000000008', { days: 30 }); eq([r.match, r.role], ['one', 'recipient'], '⑧days 30 이면 찾음');
        r = await look('01000000017'); eq(r.match, 'one', '⑮딱 14일 전 = 창 안');
        r = await look('01000000017', { days: 13 }); eq(r.match, 'none', '⑮days 13 이면 창 밖');
        r = await look('01000000009'); eq([r.match, r.candidates, r.why], ['many', 2, 'multi-orders'], '⑨선물 2건 보낸 분 = many');
        r = await look('01000000010'); eq([r.match, r.role], ['one', 'recipient'], '⑩구매자 빈칸 줄 — 받는 분 번호로는 찾음');
        for (const bad of ['', null, '1234', '010', '0000', 'abc']) { r = await look(bad); eq([r.match, r.why, r.candidates], ['none', 'bad-phone', 0], '⑪못 쓰는 번호 ' + JSON.stringify(bad) + ' = none(빈 번호 줄에 안 걸림)'); }
        r = await look('01000000011'); eq([r.match, r.order && r.order.status_label, r.order && r.order.delivered, r.order && r.order.checked_at], ['one', null, false, null], '⑫상태 줄 없음 = 상태 null');
        r = await look('01000000014'); eq([r.match, r.order && r.order.boxes, r.order && String(r.order.partner).split(' · ').sort().join('|'), r.order && r.order.delivered], ['one', 2, ['대성(시온)', '효돈농협'].sort().join('|'), true], '⑬같은 날 두 거래처 = 한 건 2상자');
        r = await look('01000000015'); eq([r.match, r.order && r.order.status_label, r.order && r.order.status_step], ['one', '미배송', '배송출발'], '⑭미배송은 우리 분류로');

        // ── C2. 되묻기 답(받는 분 성함)으로 좁히기 ──
        eq(['강 어머니 님', '장구슬이요', ' 임열매 입니다.', '정', '', null, '강어머니께'].map(L.normalizeName), ['강어머니', '장구슬', '임열매', '정', '', '', '강어머니'], 'normalizeName 7종');
        r = await look('01000000009', { recipientName: '장 구슬' }); eq([r.match, r.role, r.narrowed, r.candidates, r.order && r.order.recipient_initial, r.order && r.order.tracking_tail], ['one', 'buyer', 'name', 2, '장', '0012'], '이름: 선물 2건 중 이름 전체로 one/buyer');
        r = await look('01000000009', { recipientName: '임' }); eq([r.match, r.role, r.narrowed, r.order && r.order.tracking_tail], ['one', 'buyer', 'surname', '0013'], '이름: 성만 — 그 성이 하나면 one');
        r = await look('01000000006', { recipientName: '강어머니님' }); eq([r.match, r.role, r.narrowed, r.order && r.order.tracking_tail], ['one', 'buyer', 'name', '0009'], '이름: 양쪽 역할 — 보낸 선물 쪽');
        r = await look('01000000006', { recipientName: '강육각' }); eq([r.match, r.role, r.order && r.order.tracking_tail], ['one', 'recipient', '0008'], '이름: 양쪽 역할 — 본인 주문 쪽');
        r = await look('01000000006', { recipientName: '강' }); eq([r.match, r.why, r.order, r.candidates], ['many', 'name-multi', null, 2], '이름: 성만인데 같은 성 둘 = many 유지');
        r = await look('01000000005', { recipientName: '정오성' }); eq([r.match, r.why], ['many', 'name-multi'], '이름: 같은 분께 2건(날짜 다름) = many 유지');
        r = await look('01000000009', { recipientName: '홍길동' }); eq([r.match, r.why, r.order], ['many', 'name-no-match', null], '이름: 안 맞는 이름 = many 유지');
        r = await look('01000000009', { recipientName: '장구' }); eq([r.match, r.narrowed], ['one', 'surname'], '이름: 두 글자 앞부분도 하나면 one'); r = await look('01000000009', { recipientName: '장구슬이' }); eq(r.match, 'many', '이름: 세 글자 넘는 틀린 이름은 앞글자 비교 안 함');
        r = await look('010-0000-0001', { recipientName: '홍길동' }); eq([r.match, r.role, r.narrowed], ['one', 'recipient', undefined], '이름: 원래 one 이면 이름과 무관하게 그대로');
        r = await look('01000000099', { recipientName: '김하나' }); eq(r.match, 'none', '이름: 번호가 없으면 이름만으로는 안 찾음');
        r = await look('01000000009', { recipientName: "장'; DROP--%_" }); eq([r.match, r.why], ['many', 'name-no-match'], '이름: 기호 섞인 입력은 글자만 남겨 비교');
        ok(!JSON.stringify(await look('01000000009', { recipientName: '장구슬' })).includes('구슬'), '이름: 결과에 이름 전체 없음');
        // ── D. 밖으로 나가는 것 ──
        const raw = await look('01000000004'); const pub = L.toPublic(raw); const pj = JSON.stringify(pub), rj = JSON.stringify(raw);
        ok(Object.keys(pub.order).every(k => L.PUBLIC_ORDER.includes(k)), 'toPublic: 허용 목록 칸만', Object.keys(pub.order));
        ok(!/9000000000\d\d/.test(pj), 'toPublic: 운송장 전체 없음'); ok(!/tracking"|trackings/.test(pj), 'toPublic: tracking·trackings 키 없음');
        ok(!/0100000\d{4}|0503/.test(pj), 'toPublic: 전화번호 없음'); ok(!pj.includes('검증로') && !pj.includes('메모'), 'toPublic: 주소·배송메모 없음');
        ok(!pj.includes('네모') && !pj.includes('가짜기사') && !pj.includes('가짜지점'), 'toPublic: 받는 분 이름 전체·기사·지점 없음');
        eq(pub.order.tracking_tail, '0005', 'toPublic: 운송장 끝 4자리'); eq(pub.order.recipient_initial, '최', 'toPublic: 성 한 글자');
        ok(!rj.includes('검증로') && !rj.includes('메모') && !/0100000\d{4}/.test(rj) && !rj.includes('네모') && !rj.includes('가짜기사') && !rj.includes('9999'), '원 결과에도 주소·번호·이름 전체·기사 없음(SELECT 가 안 읽음)');
        eq(L.toPublic(await look('01000000005')), { match: 'many', role: null, candidates: 2, order: null }, 'toPublic: many 는 주문 없음');
        eq(L.toPublic(null), { match: 'none', role: null, candidates: 0, order: null }, 'toPublic: 빈 입력');
        eq(L.toPublic({ match: 'one', role: 'buyer', candidates: 1, order: { addr: 'x', phone: 'y', tracking: 'z', ship_date: '2026-10-07' } }).order, { ship_date: '2026-10-07' }, 'toPublic: 모르는 칸은 버림');

        // ── E. 배송 상태 새로 묻기(CJ 는 가짜) ──
        let calls = 0; const cjOk = { TROUBLE_BUCKETS: ['미배송', '사고', '기타', '정보없음', '조회실패'], trackOne: async tr => { calls++; return { tracking: tr, bucket: '배송완료', code: '91', label: '배송완료', msg: 'm', time: '2026-10-10 11:00', branch: 'b', driver: { name: 'd', phone: '010-9999-0000' }, delivered: true, events: [{ code: '91' }] }; } };
        const cjFail = { trackOne: async () => { calls++; return { bucket: '조회실패' }; } }; const cjThrow = { trackOne: async () => { calls++; throw new Error('x'); } };
        const cjTrouble = { TROUBLE_BUCKETS: cjOk.TROUBLE_BUCKETS, trackOne: async tr => { calls++; return { tracking: tr, bucket: '미배송', code: '82', label: '배송출발', msg: '', time: 't', branch: '', driver: null, delivered: false, events: [] }; } };
        let s = await L.refreshStatus(c, '900000000001', { cj: cjOk }); eq([calls, s.refreshed, s.delivered], [0, false, true], '새로 묻기: 배송완료는 안 물음');
        s = await L.refreshStatus(c, '900000000002', { cj: cjOk }); eq([calls, s.refreshed, s.bucket], [0, false, '배송출발'], '새로 묻기: 30분 전 확인 = 안 물음');
        await c.query(`UPDATE delivery_status SET handled_at = now(), handled_by = '시험' WHERE tracking = '900000000003'`);
        s = await L.refreshStatus(c, '900000000003', { cj: cjFail }); eq([calls, s.refreshed, s.stale, s.bucket], [1, false, true, '간선상하차'], '새로 묻기: 조회 실패 = 있던 줄 그대로 + stale');
        s = await L.refreshStatus(c, '900000000003', { cj: cjThrow }); eq([calls, s.stale, s.bucket], [2, true, '간선상하차'], '새로 묻기: 예외도 같음');
        s = await L.refreshStatus(c, '9000-0000-0003', { cj: cjOk }); eq([calls, s.refreshed, s.delivered, s.bucket], [3, true, true, '배송완료'], '새로 묻기: 5시간 전 확인 = 묻고 적음(하이픈 운송장)');
        eq((await c.query(`SELECT handled_by, driver_name, code, first_trouble_at IS NULL AS nt FROM delivery_status WHERE tracking = '900000000003'`)).rows[0], { handled_by: '시험', driver_name: 'd', code: '91', nt: true }, '새로 묻기: 처리함 표시 유지 · 서버와 같은 칸');
        s = await L.refreshStatus(c, '900000000016', { cj: cjTrouble }); eq([calls, s.refreshed, s.bucket], [4, true, '미배송'], '새로 묻기: 상태 줄 없던 운송장 = 새 줄');
        eq((await c.query(`SELECT first_trouble_at IS NOT NULL AS t FROM delivery_status WHERE tracking = '900000000016'`)).rows[0].t, true, '새로 묻기: 이상 건이면 first_trouble_at');
        s = await L.refreshStatus(c, '900000000002', { cj: cjOk, force: true }); eq([calls, s.refreshed], [5, true], '새로 묻기: force 면 바로');
        eq(await L.refreshStatus(c, 'abc', { cj: cjOk }), null, '새로 묻기: 운송장 꼴이 아니면 null'); eq(calls, 5, '쓸데없는 조회 없음');
        s = await L.refreshStatus(c, '900000000099', { cj: cjFail }); eq(s, null, '새로 묻기: 줄도 없고 조회도 실패 = null');
        // 주문 단위 — ④의 안 끝난 상자를 새로 묻고 다시 채움
        calls = 0; await c.query(`UPDATE delivery_status SET checked_at = now() - interval '3 hours' WHERE tracking = '900000000005'`);
        r = await L.refreshOrder(c, await look('01000000004'), { cj: cjOk });
        eq([calls, r.order.delivered, r.order.boxes_delivered, r.order.status_label, r.order.tracking_tail], [1, true, 2, '배송완료', '0004'], '주문 새로 묻기: 안 끝난 상자만 1번 묻고 전부 완료로');
        r = await L.refreshOrder(c, await look('01000000005'), { cj: cjOk }); eq([calls, r.match], [1, 'many'], '주문 새로 묻기: many 는 안 물음');
        await c.query(`UPDATE delivery_status SET checked_at = now() - interval '9 hours' WHERE tracking = '900000000019'`);
        r = await L.refreshOrder(c, await look('01000000015'), { cj: cjFail }); eq([r.order.stale, r.order.status_label, L.toPublic(r).order.stale], [true, '미배송', true], '주문 새로 묻기: 실패면 stale 표시가 답까지');

        // ── F. (--live) CJ 실제 1건 — 진짜 표에서 운송장만 읽고 결과는 임시 표에 ──
        if (process.argv.includes('--live')) {
            const one = (await c.query(`SELECT tracking FROM public.delivery_status WHERE delivered IS TRUE ORDER BY checked_at DESC LIMIT 1`)).rows[0];
            if (one) { const t0 = Date.now(); s = await L.refreshStatus(c, one.tracking, { force: true }); ok(s && s.refreshed === true && s.delivered === true && s.bucket === '배송완료', 'live: 실제 CJ 1건 → 임시 표에 배송완료', s && { bucket: s.bucket, refreshed: s.refreshed, ms: Date.now() - t0 }); console.log('  live', Date.now() - t0, 'ms'); }
        }
        // ── G. 조회 계획(인덱스를 타는 꼴인지) ──
        const plan = (await c.query(`EXPLAIN SELECT 1 FROM delivery_shipments s WHERE (s.phone_digits = '01000000001' OR s.buyer_digits = '01000000001') AND s.ship_date >= current_date - 14`)).rows.map(x => x['QUERY PLAN']).join(' ');
        ok(/delivery_shipments/.test(plan), '조회 계획 나옴');
    } finally {
        try { await c.query('ROLLBACK'); } catch (e) { /* 무시 */ }
        for (const t of ['delivery_shipments', 'delivery_status']) { try { await c.query('DROP TABLE IF EXISTS pg_temp.' + t); } catch (e) { /* 무시 — 반드시 pg_temp. 를 붙인다(진짜 표 보호) */ } }
        c.release();
    }
    // 끝난 뒤 진짜 표는 그대로인가(가짜 운송장 0)
    const left = (await pool.query(`SELECT (SELECT count(*) FROM delivery_shipments WHERE tracking LIKE '9000000000__')::int a, (SELECT count(*) FROM delivery_status WHERE tracking LIKE '9000000000__')::int b`)).rows[0];
    eq(left, { a: 0, b: 0 }, '검증 뒤 진짜 표에 가짜 줄 0');
    await pool.end();
    console.log(`\n#610-C lookup 검증: ${pass}/${pass + fail} ${fail ? '✗ 실패 ' + fail : '통과'}`);
    process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(2); });
