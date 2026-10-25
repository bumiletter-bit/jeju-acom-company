// #850 검증 — 발주 메모함 서버(order-memo.js · 계약 docs/850-api.md) · 실DB·실AI·네트워크 0
//   DB = 이 PC 메모리 안 Postgres(pglite · 실제 SQL 그대로) · AI = 가짜(정해 둔 JSON) · 서버 = express 를 이 스크립트 안에서 띄움(포트 3458 · 로그인 가짜)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-850-server.js
//   ① 규칙 줄(사이즈·날짜·입력삭제·보내는이·현금 행 붙여넣기) = 최종발주 sizeLines·v2 parseLines 와 같은 결과 ② 현금 13칸 검사 ③ 30일 지정 → 26·27·28 메모 칸 「대기」로 매일 · 현금은 30일만
//   ④ API 왕복(미리보기 저장 0 · 저장 · 목록 · 고치기 · X 지우기 · 되살리기 · for-ship · used · clear · 영구 삭제) ⑤ 감사 기록에 개인정보 0 ⑥ 최종발주 parseCash 가 cash_aoa 를 그대로 읽음
'use strict';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ''); } };
const PGL = process.env.PGLITE_DIR;
if (!PGL) { console.log('PGLITE_DIR 가 없어요 — npm i @electric-sql/pglite 한 폴더를 주세요'); process.exit(2); }
const { PGlite } = require(path.join(PGL, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const OM = require(path.join(ROOT, 'order-memo.js'));
const PORT = Number(process.env.PORT850) || 3458;   // 다른 세션이 3458 을 쓰고 있으면 PORT850=… 로
const core = require(path.join(ROOT, 'public', 'final-order-core.js'));

const CAT = ['고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)'];
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) {
    const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
    const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; };
    return { query: q, connect: async () => ({ query: q, release() {} }) };
}

(async () => {
    console.log('① 규칙 줄');
    const T = '2026-10-26';
    const r1 = OM.ruleLine('010-1234-5678 S사이즈로', T);
    ok(r1 && r1.kind === 'line' && r1.line === '010-1234-5678 S사이즈로' && core.sizeLines(r1.line).sizes[0].size === 'S', '「번호 S사이즈로」 = 규칙 줄 · 원문 그대로 · sizeLines 가 S 로 읽음', r1);
    const c1 = OM.checkRow(r1, { today: T, catalog: new Set(CAT) });
    ok(c1.sure && !c1.check_why.length && c1.missing.length === 0, '사이즈 줄 ✅', c1);
    const r2 = OM.checkRow(OM.ruleLine('010-1234-5678 L사이즈', T), { today: T });
    ok(r2.sure === false && r2.check_why.some(w => /로얄과 사이즈가 아니에요/.test(w)), 'L 사이즈 = 🟠 「로얄과 사이즈가 아니에요」(최종발주와 같은 말)', r2);
    const r3 = OM.ruleLine('10/30\t010-2222-3333\t입력o삭제x\t네이버', T);
    ok(r3 && r3.ship_date === '2026-10-30' && r3.line === '10/30\t010-2222-3333\t입력o삭제x\t네이버', '탭 줄(날짜⇥번호⇥입력o삭제x⇥네이버) = 규칙 · 날짜 10/30', r3);
    const r4 = OM.ruleLine('010-2222-3333 30일 발송', T);
    ok(r4 && r4.ship_date === '2026-10-30', '「번호 30일 발송」 = 규칙 · 10/30', r4);
    const r5 = OM.ruleLine('010-1111-2222 보내는이 홍길동', T);
    ok(r5 && r5.kind === 'line' && r5.ship_date === null, '「번호 보내는이 홍길동」 = 규칙', r5);
    ok(OM.ruleLine('홍길동 010-1111-2222 서울시 강남구 테헤란로 1 타이벡 5kg 2박스', T) === null, '이름·주소·품목 섞인 글 = AI 몫(null)');
    ok(OM.ruleLine('010-1111-2222 서울시 강남구 테헤란로 12', T) === null, '번호 + 주소 = AI 몫(null)');
    ok(OM.ruleLine('010-1111-2222 맛있게 부탁해요', T) === null, '번호 + 지시 아닌 말 = AI 몫(null)');
    // 워커3 시험 ②: 띄어쓰기 없는 날짜·「날 보내」 꼴도 규칙 · 반대 뜻(보내지 말고)·도착 요청은 AI
    const DV = ['010-2101-0013 27일발송', '010-2101-0013 27일 발송', '010-2101-0013 27일날 보내', '010-2101-0013 27일날 보내주세요', '010-2101-0013 27일 보내 주세요', '010-2101-0013 10/27발송'].map(t => [t, OM.ruleLine(t, T)]);
    ok(DV.every(([t, r]) => r && r.ship_date === '2026-10-27' && r.line === t && OM.V2.parseLines(t, 'naver', T)[0].date === '2026-10-27'), '「27일발송」「27일날 보내」「10/27발송」 등 = 규칙 · 10/27 · 원문 그대로 · v2 도 같은 날짜', DV.map(([t, r]) => [t, r && r.ship_date]));
    ok(['010-2101-0013 27일 보내지말고', '010-2101-0013 27일보내지마세요', '010-2101-0013 30일 도착하게'].every(t => OM.ruleLine(t, T) === null), '「보내지 말고」(반대 뜻)·「도착하게」 = 규칙으로 안 읽음(AI)');
    const paste = ['홍길동(제주아꼼이네)', '010-9999-0000', '', '김받음', CAT[0], '2', '010-8888-7777', '', '서울특별시 강남구 테헤란로 1 101호', '', '010-9999-0000', '', ''].join('\t');
    const r6 = OM.checkRow(OM.ruleLine(paste, T), { today: T, catalog: new Set(CAT), origin: '출고지글' });
    ok(r6.kind === 'cash' && r6.sure && r6.cells[0] === '!홍길동(제주아꼼이네)' && r6.cells[2] === '출고지글' && r6.cells[5] === '2', '엑셀 13칸 붙여넣기 = 현금 행 ✅ · 「!」 표식 · 출고지 기본', r6);
    // 규칙 줄 = 손으로 친 메모 칸과 같은 판정(v2 parseLines)
    const v2 = OM.V2.parseLines([r3.line, r4.line].join('\n'), 'naver', T);
    ok(v2.length === 2 && v2.every(x => !x.bad && x.date === '2026-10-30') && v2[0].indiv, 'v2 parseLines 가 메모함 줄을 사람이 친 줄과 같게 읽음(날짜·입력삭제)', v2);

    {   // 틀 자리 번호(워커3 제안) = 🟠 「번호를 넣어 주세요」
        const H = ['000-0000-0000 S사이즈로', '00000000000 입력o삭제x', '010-0000-0000 S사이즈로'].map(t => OM.checkRow(OM.ruleLine(t, T) || { kind: 'line', key: t.split(' ')[0], note: t.split(' ')[1], src: 'edit' }, { today: T }));
        ok(H.every(r => r.sure === false && r.check_why.includes('번호를 넣어 주세요') && r.missing.join() === 'key'), '틀 자리 번호(000-0000-0000 · 0만 · 010-0000-0000) = 🟠 「번호를 넣어 주세요」 · missing key', H.map(r => [r.key, r.sure, r.check_why]));
        const okK = OM.checkRow(OM.ruleLine('010-1000-2000 S사이즈로', T), { today: T });
        ok(okK.sure, '0 이 섞인 진짜 번호는 그대로 ✅', okK);
    }
    console.log('② 현금 13칸 검사');
    const ctx = { today: T, catalog: new Set(CAT), origin: 'O' };
    const m1 = OM.checkRow(OM.cashFromAi({ buyer: '이손님', buyer_phone: '01055556666', recv: '박받음', phone1: '', phone2: '', addr: '', option: CAT[1], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' }), ctx);
    ok(!m1.sure && m1.missing.join() === '6,8' && m1.check_why.includes('주소가 없어요') && m1.cells[0] === '!이손님(제주아꼼이네)' && m1.cells[1] === '010-5555-6666', '빈 칸 = 🟠 · missing [6,8] · 「주소가 없어요」 · 보내는사람 = 「!손님(제주아꼼이네)」 · 번호 하이픈', m1);
    const m2 = OM.checkRow(OM.cashFromAi({ buyer: '', buyer_phone: '', recv: '박받음', phone1: '01012341234', phone2: '', addr: '제주시 1', option: '없는 품목', qty: 0, memo: '', sender: '정만웅', sender_phone: '01094020886', sender_addr: '', date: '' }), ctx);
    ok(!m2.sure && m2.missing.includes(4) && m2.missing.includes(5) && m2.cells[0] === '!정만웅 드림' && m2.check_why.includes('품목이 단가표 이름과 달라요'), '단가표에 없는 품목·수량 0 = 🟠 · 보내는이 = 「!이름 드림」', m2);

    console.log('②-b 문자 출처 현금 손님(#850-b)');
    {
        const SP = '01092590977', base = { buyer: '', buyer_phone: '', recv: '박받음', phone1: '010-7777-8888', phone2: '', addr: '제주시 1', option: CAT[0], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' };
        const a1 = OM.checkRow(OM.cashFromAi(base, { smsPhone: SP, text: '타이벡 5kg 1박스 박받음 010-7777-8888 제주시 1' }), ctx);
        ok(a1.cells[10] === '010-9259-0977' && a1.cells[1] === '010-9259-0977' && a1.cells[6] === '010-7777-8888' && a1.cells[0] === '!제주아꼼이네' && a1.sure, '문자 출처 · 입금자명 없음 = K·보내는사람연락처 = 문자 손님 번호 · 받는 분 번호 그대로 · 보내는사람 「!제주아꼼이네」', a1.cells);
        const a2 = OM.checkRow(OM.cashFromAi(Object.assign({}, base, { buyer: '김손님', buyer_phone: '010-5555-6666' }), { smsPhone: SP, text: '입금 김철수으로 했어요 박받음 …' }), ctx);
        ok(a2.cells[0] === '!김철수 드림' && a2.cells[10] === '010-9259-0977' && a2.cells[1] === '010-9259-0977', '입금자명 있음(「입금 김철수으로 했어요」) = 보내는사람 「!김철수 드림」 · AI 구매자 번호보다 문자 손님 번호', a2.cells);
        const a3 = OM.checkRow(OM.cashFromAi(Object.assign({}, base, { buyer: '김손님', sender_phone: '010-1212-3434' }), { smsPhone: SP, text: '보내는 사람 번호 010-1212-3434' }), ctx);
        ok(a3.cells[1] === '010-1212-3434' && a3.cells[10] === '010-9259-0977' && a3.cells[0] === '!김손님(제주아꼼이네)', 'AI 가 sender_phone 따로 주면 보내는사람연락처만 그 값 · 이름 = 구매자(제주아꼼이네)', a3.cells);
        const a4 = OM.checkRow(OM.cashFromAi(Object.assign({}, base, { sender: '이모' }), { smsPhone: SP, text: '입금 김철수로 했어요' }), ctx);
        ok(a4.cells[0] === '!이모 드림', '보내는이 지정이 입금자명보다 먼저');
        const a5 = OM.checkRow(OM.cashFromAi(Object.assign({}, base, { buyer_phone: '010-5555-6666' }), {}), ctx);
        ok(a5.cells[10] === '010-5555-6666' && a5.cells[1] === '010-5555-6666' && a5.cells[0] === '!제주아꼼이네', '문자 아님(manual) = 종전 그대로(K = AI 구매자 번호)', a5.cells);
        // 입금자명 38글(워커3 점검 꼴 · 맞게 읽을 12 + 이름 없음 26)
        const DEP = [['입금 김철수으로 했어요', '김철수'], ['입금은 김철수로 했습니다', '김철수'], ['입금자명 박영희입니다', '박영희'], ['입금자 이순자', '이순자'], ['입금자명: 최민수', '최민수'], ['입금자는 정하나예요', '정하나'],
            ['홍길동 이름으로 입금했어요', '홍길동'], ['김철수로 입금했어요', '김철수'], ['이영수 명의로 입금했습니다', '이영수'], ['입금 박지성 이름으로 했어요', '박지성'], ['010-1234-5678 타이벡 5kg 입금 이영수로 했어요', '이영수'], ['입금은 오세훈입니다', '오세훈'],
            ['입금 먼저 할게요', ''], ['입금 오후에 할게요', ''], ['입금 바로 했어요', ''], ['입금 제가 할게요', ''], ['입금 늦어서 죄송해요', ''], ['입금 금액 알려주세요', ''], ['입금은 아들이 할 거예요', ''],
            ['입금 남편 이름으로 했어요', ''], ['입금 남편이름으로 했어요', ''], ['입금 엄마 이름으로 할게요', ''], ['입금 회사명으로 할게요', ''], ['카카오뱅크로 입금했어요', ''], ['국민은행으로 입금했어요', ''], ['토스로 입금했어요', ''],
            ['네이버페이로 입금했어요', ''], ['방금 입금했어요', ''], ['계좌로 입금했어요', ''], ['입금 완료했습니다', ''], ['입금했습니다 감사해요', ''], ['아빠 명의로 입금했어요', ''], ['딸 이름으로 입금할게요', ''],
            ['부모님 이름으로 입금했어요', ''], ['회사 이름으로 입금했어요', ''], ['입금은 내일 할게요', ''], ['현금으로 입금했어요', ''], ['입금 확인 부탁드려요', ''],
            ['입금 월요일로 할게요', ''], ['입금 다음주로 할게요', ''], ['입금 내일오전으로', ''], ['입금 시댁으로 했어요', ''], ['입금 김민서로 했어요', '김민서'], ['입금 김민주로 했어요', '김민주'], ['박서준 이름으로 입금했어요', '박서준'], ['입금 이번주로 할게요', ''], ['입금 늦어서 죄송', '']];
        const depBad = DEP.filter(([t, w]) => OM.depositName(t) !== w).map(([t, w]) => [t, w, OM.depositName(t)]);
        ok(DEP.length === 47 && !depBad.length, '입금자명 47글(38 + 재점검 9) = 이름 있을 때만(「먼저·오후에·바로·제가·늦어서·금액」·「아들이」·남편/엄마/회사·…뱅크/은행/페이 = 빈칸)', depBad);
        const m6 = OM.checkRow(OM.cashFromAi(Object.assign({}, base, { buyer: '김손님' }), { text: '입금 이영수로 했어요' }), ctx);
        ok(m6.cells[0] === '!이영수 드림' && m6.cells[10] === '010-7777-8888', 'manual 붙여 넣기에도 입금자명 = 「!이영수 드림」(현금건 공통) · 번호 채우기는 안 함(K = 받는 분 번호 · 종전)', m6.cells);
    }
    console.log('③ 30일 지정 — 26·27·28 매일 · 30일 당일');
    let id = 0; const mk = (o) => Object.assign({ id: ++id, state: 'open', sure: true, used_on: null, check_why: [] }, o);
    const L30 = mk({ kind: 'line', line: '10/30\t010-2222-3333\t입력o삭제x\t네이버', ship_date: '2026-10-30' });
    const Ln = mk({ kind: 'line', line: '010-1234-5678 S사이즈로', ship_date: null });
    const C30 = mk({ kind: 'cash', cells: r6.cells, ship_date: '2026-10-30' });
    const Cn = mk({ kind: 'cash', cells: r6.cells, ship_date: null });
    const U = mk({ kind: 'cash', cells: m1.cells, sure: false, check_why: m1.check_why });
    let rows = [L30, Ln, C30, Cn, U];
    const dayRun = (date) => { const f = OM.pickForShip(rows, date); f.ids.forEach(i => { rows.find(r => r.id === i).used_on = date; }); const cl = OM.pickClear(rows, date, false); rows.forEach(r => { if (cl.includes(r.id)) r.state = 'cleared'; }); return { f, cl }; };
    const d26 = dayRun('2026-10-26');
    ok(d26.f.lines.find(l => l.id === L30.id).state === 'wait' && d26.f.memo_text.includes(L30.line), '26일: 30일 메모 줄 = 메모 칸에 들어감 · 「대기」', d26.f.lines);
    ok(d26.f.cash_ids.join() === String(Cn.id) && d26.f.waiting.some(w => w.id === C30.id) && d26.f.held.some(h => h.id === U.id), '26일: 현금 = 날짜 없는 행만 · 30일 현금 = waiting · 🟠 = held', d26.f);
    ok(d26.cl.includes(Ln.id) && d26.cl.includes(Cn.id) && !d26.cl.includes(L30.id) && !d26.cl.includes(U.id), '26일 비우기: 쓴 줄만 비움 · 30일 메모 줄·🟠 남음', d26.cl);
    const v2_26 = OM.V2.parseLines(d26.f.memo_text, 'naver', '2026-10-26').find(x => x.digits === '01022223333');
    ok(v2_26 && v2_26.date === '2026-10-30' && v2_26.date > '2026-10-26', '26일 v2 판정: 그 줄은 「오늘보다 뒤」 = 오늘 안 나감', v2_26);
    for (const d of ['2026-10-27', '2026-10-28']) {
        const x = dayRun(d);
        ok(x.f.lines.length === 1 && x.f.lines[0].id === L30.id && x.f.lines[0].state === 'wait' && !x.f.cash_ids.includes(C30.id) && !x.cl.includes(L30.id), `${d.slice(8)}일: 30일 메모 줄 또 들어감(대기) · 30일 현금 안 들어감 · 비우기 뒤에도 남음`, x);
    }
    const d30 = dayRun('2026-10-30');
    ok(d30.f.lines[0].state === 'today' && d30.f.cash_ids.includes(C30.id) && d30.cl.includes(L30.id) && d30.cl.includes(C30.id), '30일: 메모 줄 「오늘」 · 30일 현금 행 들어감 · 비우기 = 둘 다 비워짐', d30);
    ok(rows.filter(r => r.state === 'open').map(r => r.id).join() === String(U.id), '30일 뒤 남은 줄 = 🟠 하나뿐');
    {   // #850-a 날짜 지정 입력삭제 줄 + 같은 번호 주소 줄(날짜 없음) → 주소 줄도 그날
        const P = '010-2101-0013', ctxA = { today: '2026-10-26', catalog: new Set(CAT), origin: 'O' };
        const lineA = OM.ruleLine('10/30\t' + P + '\t입력o삭제x\t네이버', '2026-10-26');
        const addrA = { kind: 'cash', src: 'ai', cells: ['', P, '', '강가짜', CAT[0], '1', '010-3201-0013', '', '경기도 가짜시 가짜로 88', '', P, '', ''] };
        const chk = OM.markIndiv([lineA, addrA]).map(r => OM.checkRow(r, ctxA));
        let n = 900; const rowsA = chk.map(r => Object.assign({ id: ++n, state: 'open', used_on: null }, r));
        const f26 = OM.pickForShip(rowsA, '2026-10-26'), f30 = OM.pickForShip(rowsA, '2026-10-30');
        ok(chk[1].indiv && chk[1].ship_date === '2026-10-30' && f26.lines[0].state === 'wait' && f26.waiting.some(w => w.id === rowsA[1].id) && !f26.cash_ids.includes(rowsA[1].id)
            && f30.cash_ids.includes(rowsA[1].id) && f30.lines[0].state === 'today', '#850-a 10/30 입력삭제 줄 + 주소 줄 = 10/26 엔 주소 줄 waiting · 10/30 에 현금 행으로', { f26: f26.waiting, f30: f30.cash_ids });
        f26.ids.forEach(i => { rowsA.find(r => r.id === i).used_on = '2026-10-26'; });
        ok(OM.pickClear(rowsA, '2026-10-26', false).length === 0, '#850-a 10/26 비우기 = 입력삭제 줄·주소 줄 둘 다 남음');
        const own = OM.markIndiv([Object.assign({}, lineA), Object.assign({}, addrA, { ship_date: '2026-10-28' })]);
        ok(own[1].ship_date === '2026-10-28', '#850-a 주소 줄에 따로 적은 날짜는 그대로(덮지 않음)');
    }
    const pc = core.parseCash(d30.f.cash_aoa);
    ok(pc.ok && pc.rows.length === 1 && pc.rows[0].bang && pc.rows[0].qty === 2, '⑥ 최종발주 parseCash 가 cash_aoa 를 그대로 읽음(머리글 13칸 · 「!」 현금 손님)', pc);

    console.log('④ API 왕복(pglite · 가짜 AI)');
    const db = new PGlite();
    await db.query(`CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner TEXT, start_date DATE, end_date DATE, items JSONB)`);
    await db.query(`INSERT INTO pricing (partner, start_date, end_date, items) VALUES ('대성(시온)', '2026-01-01', '2026-12-31', $1)`, [JSON.stringify(CAT.map(n => ({ name: n, price: 1 })))]);
    await db.query(`CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, payload JSONB, created_by TEXT, created_by_id INTEGER, status TEXT, mine_hidden BOOLEAN DEFAULT false,
        result JSONB, processed_at TIMESTAMPTZ, is_deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE sms_threads (id SERIAL PRIMARY KEY, phone_digits TEXT UNIQUE NOT NULL)`);
    await db.query(`INSERT INTO sms_threads (id, phone_digits) VALUES (55, '01092590977')`);
    // #850-d 발송 전 주문 표(sms/preorders.js DDL 그대로)
    for (const q of require(path.join(ROOT, 'sms', 'preorders.js')).DDL) await db.query(q);
    await db.query("INSERT INTO sms_preorders (channel, order_key, buyer_digits, recipient_digits, recipient_initial, option_text, qty, paid_at) VALUES ('naver', '2026102512345678', '01011112222', '01033334444', '김', '타이벡 5kg', 2, '2026-10-25T03:00:00Z'), ('cafe24', '20261025-0000123|P0001', '01055556666', '01055556666', '박', '황금향 3kg', 1, '2026-10-25T04:00:00Z'), ('coupang', '9000111|7000222', '01077778888', '01099990000', '이', '레몬 2kg', 1, NULL)");
    // cfgVal = 실DB 설정 order_memo 대신 · 앞쪽 시험은 서버 직접 AI(direct) · 창구 경유 시험은 ⑦에서 기본값(direct false)
    let cfgVal = { ai: { direct: true } }, deskOn = false;
    const pool = mkPool(db), audits = []; let today = '2026-10-26', aiCalls = 0, aiOn = true;
    const fakeAi = { messages: { create: async (p) => { aiCalls++; ok(p.output_config && p.output_config.format && p.output_config.format.type === 'json_schema' && p.model === 'claude-opus-5-5', 'AI 요청 = 구조화 출력(json_schema) · 기본 모델', { model: p.model });
        return { stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 300 }, content: [{ type: 'text', text: JSON.stringify({ lines: [], cash: [{ buyer: '이손님', buyer_phone: '010-5555-6666', recv: '박받음', phone1: '010-7777-8888', phone2: '', addr: '', option: CAT[1], qty: 1, memo: '문 앞', sender: '', sender_phone: '', sender_addr: '', date: '' }], unsure: [{ text: '다음 주쯤', why: '날짜 애매' }], sms_draft: '' }) }] }; } } };
    const app = express(); app.use(express.json());
    const auth = (req, res, next) => { req.user = { id: Number(req.headers['x-uid'] || 990850), name: '검증', position: '', role: req.headers['x-role'] || 'staff' }; next(); };
    const handleErr = (res, e) => res.status(e.status || 500).json({ error: e.message });
    const api = OM.mount(app, { pool, authMiddleware: auth, writeAudit: async a => { audits.push(a); }, adminActor: req => ({ id: req.user.id }), handleErr,
        cfgGet: async k => (k === 'order_memo' ? cfgVal : k === 'desk_subscription_users' ? { ids: [1, 10] } : null), deskAlive: async () => deskOn, kstToday: () => today, noTimers: true, anthropic: { messages: { create: (p) => aiOn ? fakeAi.messages.create(p) : Promise.reject(Object.assign(new Error('x'), { status: 500 })) } },
        shipCal: async () => ({ realToday: today, shipDays: ['2026-10-26', '2026-10-27'], suggested: '2026-10-27' }) });
    const srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, () => r(s)); });
    const call = async (method, url, body, who) => { const h = Object.assign({ 'Content-Type': 'application/json' }, who ? { 'x-uid': String(who.uid), 'x-role': who.role || 'staff' } : {});
        const r = await fetch('http://127.0.0.1:' + PORT + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
    const nRows = async () => Number((await db.query(`SELECT COUNT(*)::int AS n FROM order_memo_rows`)).rows[0].n);
    try {
        await api.ensure();
        const p1 = await call('POST', '/api/order-memo/preview', { raw: '010-1234-5678 S사이즈로\n10/30\t010-2222-3333\t입력o삭제x\t네이버' });
        ok(p1.s === 200 && p1.j.rows.length === 2 && p1.j.rule_count === 2 && p1.j.ai.used === false && aiCalls === 0, '미리보기(규칙 줄만) = AI 안 부름 · 2줄', p1.j);
        ok(await nRows() === 0 && audits.length === 0, '미리보기 = DB 쓰기 0 · 감사 0');
        const p2 = await call('POST', '/api/order-memo/preview', { raw: '010-1234-5678 S사이즈로\n이손님 010-5555-6666 박받음 010-7777-8888 황금향 3kg 1박스 문 앞\n다음 주쯤', tags: ['cash', 'evil'] });
        const cashRow = p2.j.rows && p2.j.rows.find(r => r.kind === 'cash');
        ok(p2.s === 200 && aiCalls === 1 && p2.j.rule_count === 1 && p2.j.ai_count === 1 && cashRow && cashRow.missing.join() === '8' && !cashRow.sure, '남은 글만 AI 한 번 · 현금 행 주소 빈칸 = 🟠 missing [8]', p2.j);
        ok(/다음 주쯤/.test(p2.j.leftover) && /제주아꼼이네/.test(p2.j.sms_draft) && p2.j.ai.in_tokens === 1200, 'AI 가 애매하다 한 글 = leftover · 빈칸 있으면 문자 초안 · 토큰 수 보고', p2.j);
        aiOn = false;
        const p3 = await call('POST', '/api/order-memo/preview', { raw: '홍길동 서울 어딘가' });
        ok(p3.s === 200 && p3.j.rows.length === 0 && p3.j.leftover === '홍길동 서울 어딘가' && /실패/.test(p3.j.ai.why), 'AI 실패 = 남은 글 그대로 leftover(오류 아님)', p3.j);
        aiOn = true;
        ok((await call('POST', '/api/order-memo/preview', { raw: '  ' })).s === 400, '빈 글 = 400');
        ok((await call('POST', '/api/order-memo/preview', { raw: 'x'.repeat(4001) })).s === 400, '4000자 넘음 = 400');

        // 저장 — 화면이 sure 를 true 로 속여 보내도 서버가 다시 검사
        const fake = Object.assign({}, cashRow, { sure: true, check_why: [] });
        const sv = await call('POST', '/api/order-memo', { raw: '원문 글', tags: ['cash'], source: 'sms:77', rows: [p2.j.rows[0], fake, Object.assign({}, p1.j.rows[1])] });
        ok(sv.s === 200 && sv.j.rows.length === 3 && sv.j.rows.every(r => r.id) && sv.j.rows[1].sure === false && sv.j.rows[1].missing.join() === '8', '저장 = 3줄 · 속인 sure 는 서버가 🟠 로 되돌림', sv.j);
        const ent = (await db.query(`SELECT raw, tags, source FROM order_memo_entries`)).rows[0];
        ok(ent.raw === '원문 글' && ent.source === 'sms:77' && ent.tags.join() === 'cash', '건 = 원문·꼬리표·출처 저장');
        const auditTxt = JSON.stringify(audits);
        ok(audits.length === 1 && audits[0].source === 'order_memo' && !/010|5555|박받음|이손님|원문/.test(auditTxt) && audits[0].changes.after.rows === 3 && audits[0].changes.after.source === 'sms', '⑤ 감사 기록 = 줄 수·종류만 · 이름·번호·원문 0 · 대화 번호도 안 남김', audits[0]);

        const ls = await call('GET', '/api/order-memo');
        ok(ls.s === 200 && ls.j.entries.length === 1 && ls.j.entries[0].rows.length === 3 && ls.j.counts.open === 3 && ls.j.counts.unsure === 1 && ls.j.counts.wait === 1 && ls.j.ship_date === '2026-10-27' && ls.j.counts.next === 2, '목록 = 건 1·줄 3 · counts(열림 3 · 🟠 1 · 대기 1 · next 2) · ship_date = 다음 발송일', ls.j.counts);
        const [rS, rC, r30] = sv.j.rows;
        ok(ls.j.entries[0].rows.find(r => r.id === rS.id).missing.length === 0 && ls.j.entries[0].rows.find(r => r.id === r30.id).ship_date === '2026-10-30', '목록 줄 꼴 = 저장 응답과 같음(날짜 글자)');

        const up = await call('PUT', `/api/order-memo/rows/${rC.id}`, { cells: Object.assign([], rC.cells, { 8: '제주특별자치도 제주시 연삼로 1' }) });
        ok(up.s === 200 && up.j.row.sure && up.j.row.missing.length === 0 && up.j.row.src === 'edit', '고치기(주소 넣음) = ✅', up.j);
        ok((await call('PUT', `/api/order-memo/rows/${rS.id}`, { key: '123' })).j.row.missing.join() === 'key', 'line 번호 짧게 고침 = 🟠 missing [key]');
        await call('PUT', `/api/order-memo/rows/${rS.id}`, { key: '010-1234-5678' });
        ok((await call('PUT', `/api/order-memo/rows/${rS.id}`, { ship_date: '2026/10/30' })).s === 400, '날짜 꼴 틀림 = 400');
        ok((await call('PUT', '/api/order-memo/rows/999999', { key: 'x' })).s === 404 && (await call('DELETE', '/api/order-memo/rows/abc')).s === 404, '없는 줄 = 404');

        // X 지우기 → 비운 것 → 되살리기
        const del = await call('DELETE', `/api/order-memo/rows/${rS.id}`);
        const lc = await call('GET', '/api/order-memo?state=cleared');
        ok(del.s === 200 && lc.j.entries[0].rows.length === 1 && lc.j.entries[0].rows[0].id === rS.id && lc.j.entries[0].rows[0].cleared_by === '검증', 'X = 비운 것 탭으로(누가 비웠는지)', lc.j);
        ok((await call('PUT', `/api/order-memo/rows/${rS.id}`, { note: 'M사이즈로' })).s === 409, '비운 줄 고치기 = 409');
        const rs = await call('POST', `/api/order-memo/restore/${rS.id}`);
        ok(rs.s === 200 && rs.j.row.state === 'open' && rs.j.row.used_on === null, '되살리기 = 열림');

        // for-ship → used → clear (26 → 27 → 28 → 30)
        const fs26 = await call('GET', '/api/order-memo/for-ship?date=2026-10-26');
        ok(fs26.s === 200 && fs26.j.lines.length === 2 && fs26.j.lines.find(l => l.id === r30.id).state === 'wait' && fs26.j.cash_ids.join() === String(rC.id) && fs26.j.memo_text.split('\n').length === 2 && fs26.j.cash_aoa.length === 2, 'for-ship 26 = 메모 2줄(30일 대기 포함) · 현금 1행(머리글 + 1)', fs26.j);
        ok((await call('GET', '/api/order-memo/for-ship?date=26')).s === 400, 'for-ship 날짜 없음 = 400');
        ok((await call('POST', '/api/order-memo/used', { date: '2026-10-26', ids: fs26.j.ids })).j.n === 3, 'used 3');
        const un = await call('POST', '/api/order-memo/used', { date: '2026-10-26', ids: [rC.id], undo: true });
        ok(un.j.n === 1, '[빼기] = used 되돌림');
        await call('POST', '/api/order-memo/used', { date: '2026-10-26', ids: [rC.id] });
        const cl26 = await call('POST', '/api/order-memo/clear', { date: '2026-10-26' });
        ok(cl26.j.cleared === 2 && cl26.j.left.open === 1 && cl26.j.left.wait === 1, '26일 비우기 = 2줄 · 30일 줄 남음(대기 1)', cl26.j);
        for (const d of ['2026-10-27', '2026-10-28']) {
            const f = await call('GET', '/api/order-memo/for-ship?date=' + d);
            await call('POST', '/api/order-memo/used', { date: d, ids: f.j.ids });
            const c = await call('POST', '/api/order-memo/clear', { date: d });
            ok(f.j.lines.length === 1 && f.j.lines[0].state === 'wait' && c.j.cleared === 0 && c.j.left.open === 1, `${d.slice(8)}일 = 30일 줄 대기로 또 들어감 · 비우기 0`, { f: f.j.lines, c: c.j });
        }
        today = '2026-10-30';
        const f30 = await call('GET', '/api/order-memo/for-ship?date=2026-10-30');
        await call('POST', '/api/order-memo/used', { date: '2026-10-30', ids: f30.j.ids });
        const c30 = await call('POST', '/api/order-memo/clear', { date: '2026-10-30' });
        ok(f30.j.lines[0].state === 'today' && c30.j.cleared === 1 && c30.j.left.open === 0, '30일 = 「오늘」로 들어감 · 비우기 1 · 남은 줄 0', { f: f30.j.lines, c: c30.j });

        // 전부 비우기 · 영구 삭제
        const sv2 = await call('POST', '/api/order-memo', { raw: 'b', rows: [{ kind: 'line', key: '010-3333-4444', note: 'S사이즈로' }] });
        const ca = await call('POST', '/api/order-memo/clear', { all: true });
        ok(sv2.s === 200 && ca.j.cleared === 1 && ca.j.left.open === 0, '[전부 비우기] = 열린 줄 전부');
        await db.query(`UPDATE order_memo_rows SET cleared_at = NOW() - INTERVAL '31 days' WHERE id = ANY($1::int[])`, [arr([rS.id, rC.id, r30.id])]);
        await db.query(`UPDATE order_memo_entries SET created_at = NOW() - INTERVAL '40 days'`);
        const pg1 = await api.purge();
        const left = (await db.query(`SELECT id FROM order_memo_rows ORDER BY id`)).rows.map(r => r.id);
        ok(pg1.rows === 3 && left.join() === String(sv2.j.rows[0].id) && pg1.entries === 1, '영구 삭제 = 비운 지 30일 넘은 3줄 + 빈 건 1(원문째) · 30일 안 줄은 남음', { pg1, left });
        ok((await call('POST', `/api/order-memo/restore/${rS.id}`)).s === 404, '영구 삭제된 줄 되살리기 = 404');

        console.log('⑦ 창구 경유(기본) — 가짜 창구 왕복');
        cfgVal = null; const before = aiCalls;
        const MIX = '010-1234-5678 S사이즈로\n이손님 박받음 010-7777-8888 황금향 3kg 1박스';
        deskOn = false;
        const off = await call('POST', '/api/order-memo/preview', { raw: MIX }, { uid: 1 });
        const nPo = async () => Number((await db.query(`SELECT COUNT(*)::int AS n FROM pending_orders`)).rows[0].n);
        ok(off.s === 200 && off.j.desk && off.j.desk.state === 'off' && /창구가 꺼져/.test(off.j.desk.message) && off.j.leftover === '이손님 박받음 010-7777-8888 황금향 3kg 1박스' && off.j.rows.length === 1 && await nPo() === 0 && aiCalls === before,
            '창구 꺼짐 = 규칙 줄만 · 남은 글 그대로 · 「창구가 꺼져 있어…」 · 요청 줄 0 · 서버 AI 0', off.j);
        ok((await call('POST', '/api/order-memo/preview', { raw: '010-1234-5678 S사이즈로' }, { uid: 1 })).j.desk === null, '규칙으로 다 읽히면 창구 안 부름(desk null · 즉시)');
        deskOn = true;
        const reqs = {};
        for (const uid of [1, 10, 7]) {
            const w = await call('POST', '/api/order-memo/preview', { raw: MIX, tags: ['cash'] }, { uid });
            reqs[uid] = w.j.desk && w.j.desk.id;
            const po = (await db.query(`SELECT content, payload, created_by_id, status, mine_hidden FROM pending_orders WHERE id = $1`, [reqs[uid] || 0])).rows[0];
            ok(w.s === 200 && w.j.desk.state === 'wait' && w.j.desk.wait_sec === 30 && w.j.rows.length === 1 && w.j.leftover === '' && po && /^\[발주 메모 읽기\] 남은 글 1줄$/.test(po.content)
                && po.created_by_id === uid && po.status === '대기' && po.mine_hidden === true && po.payload.type === 'order_memo' && po.payload.text === '이손님 박받음 010-7777-8888 황금향 3kg 1박스'
                && po.payload.catalog.length === 2 && po.payload.tags.join() === 'cash' && po.payload.shipDays.length === 2,
                `창구 켜짐 · 계정 ${uid} = 요청 줄(「[발주 메모 읽기]」 · created_by_id ${uid} · 대기 · 내 목록 숨김 · payload = 남은 글·단가표·달력·꼬리표)`, { w: w.j, po });
        }
        ok(aiCalls === before, '창구 경유 = 서버 직접 AI 0');
        // 창구 요금 가름 = launcher.js 「mine = desk_subscription_users.has(created_by_id)」(코드 그대로 확인) · 1·10 = 대표 요금제 · 7 = 콘솔
        const lsrc = require('fs').readFileSync(path.join(ROOT, 'scripts', 'desk', 'launcher.js'), 'utf8');
        ok(/const mine = \(await subscriptionUsers\(\)\)\.has\(Number\(o\.created_by_id\)\)/.test(lsrc), 'launcher 요금 가름 = created_by_id 기준(그대로)');
        const subs = new Set([1, 10]);
        ok(subs.has((await db.query(`SELECT created_by_id FROM pending_orders WHERE id = $1`, [reqs[1]])).rows[0].created_by_id) && subs.has(10) && !subs.has((await db.query(`SELECT created_by_id FROM pending_orders WHERE id = $1`, [reqs[7]])).rows[0].created_by_id),
            'desk_subscription_users {1,10} 이면 1·10 요청 = 대표 요금제 · 7 = 콘솔');
        // 창구 쪽 길: get.js 가 같은 꼴(final_order_memo)로 내주고 fast.inlineFinalOrder 가 규칙 문서·자료를 미리 넣을 수 있어야 함
        const gsrc = require('fs').readFileSync(path.join(ROOT, 'scripts', 'desk', 'get.js'), 'utf8');
        const howM = gsrc.match(/type === 'order_memo'[\s\S]*?how: '([^']+)'/);
        const fast = require(path.join(ROOT, 'scripts', 'desk', 'fast.js'));
        const rulesTxt = require('fs').readFileSync(path.join(ROOT, '★에이전트오피스', '발주메모_정리.md'), 'utf8');
        const inl = howM && fast.inlineFinalOrder({ id: 1, final_order_memo: { payload_path: 'P', count: 1, rules: 'R', how: howM[1] } }, p => (p === 'R' ? rulesTxt : p === 'P' ? '{"type":"order_memo","text":"x"}' : null));
        ok(!!inl && inl.withData && /발주 메모함 — 발주 메모 읽기/.test(inl.text) && /아래 <규칙 문서> 대로/.test(inl.got.final_order_memo.how) && !/payload_path 파일을 지웁니다/.test(inl.got.final_order_memo.how),
            'get.js 안내문 = fast.inlineFinalOrder 가 규칙 문서·자료를 미리 넣음(최종발주 메모 읽기와 같은 길)', inl && inl.got.final_order_memo);
        const rsrc = require('fs').readFileSync(path.join(ROOT, 'scripts', 'desk', 'respond.js'), 'utf8');
        const keepRe = new RegExp(rsrc.match(/\/(\^\(\\\[검증469\\\]\\s\*\)\?\\\[\(\?:최종발주[^/]+)\/\.test\(o\.content/)[1]);
        ok(keepRe.test('[발주 메모 읽기] 남은 글 1줄') && keepRe.test('[최종발주 메모 읽기] 손님 메모 3건') && keepRe.test('[최종발주 대화] x') && !keepRe.test('[아침 정리] x'), 'respond.js 가 「[발주 메모 읽기]」 결과 data 도 보관(최종발주 둘은 그대로)');

        // 기다리기 → 창구 답 → 받기 → 지우기
        const g1 = await call('GET', `/api/order-memo/preview/${reqs[7]}`, null, { uid: 7 });
        ok(g1.s === 200 && g1.j.state === 'wait', '창구가 아직 = wait');
        ok((await call('GET', `/api/order-memo/preview/${reqs[7]}`, null, { uid: 8 })).s === 403 && (await call('GET', `/api/order-memo/preview/${reqs[7]}`, null, { uid: 8, role: 'admin' })).s === 200, '남의 요청 = 403 · 관리자 = 볼 수 있음');
        ok((await call('GET', '/api/order-memo/preview/abc', null, { uid: 7 })).s === 404, '없는 요청 = 404');
        const deskData = { lines: [{ key: '010-2222-3333', note: '입력o삭제x', plat: '네이버', date: '2026-10-30' }],
            cash: [{ buyer: '이손님', buyer_phone: '', recv: '박받음', phone1: '010-7777-8888', phone2: '', addr: '', option: CAT[1], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' }],
            unsure: [], sms_draft: '안녕하세요 제주아꼼이네입니다. 받으실 주소를 알려 주세요.' };
        await db.query(`UPDATE pending_orders SET status = '완료', result = $2 WHERE id = $1`, [reqs[7], JSON.stringify({ type: 'desk_answer', title: '발주 메모 정리', answer: '현금 1명', data: deskData })]);
        const g2 = await call('GET', `/api/order-memo/preview/${reqs[7]}`, null, { uid: 7 });
        const cr = g2.j.rows && g2.j.rows.find(r => r.kind === 'cash'), lr = g2.j.rows && g2.j.rows.find(r => r.kind === 'line');
        ok(g2.j.state === 'done' && cr && !cr.sure && cr.missing.join() === '8' && cr.cells[0] === '!이손님(제주아꼼이네)' && lr && lr.sure && lr.ship_date === '2026-10-30' && lr.line === '10/30\t010-2222-3333\t입력o삭제x\t네이버' && /주소/.test(g2.j.sms_draft),
            '창구 답 = 서버가 다시 검사한 줄(현금 주소 빈칸 🟠 · 메모 줄 탭 꼴) + 문자 초안', g2.j);
        const dq = await call('DELETE', `/api/order-memo/preview/${reqs[7]}`, null, { uid: 7 });
        const after = (await db.query(`SELECT payload, result, status FROM pending_orders WHERE id = $1`, [reqs[7]])).rows[0];
        ok(dq.s === 200 && after.payload === null && !('data' in after.result) && after.status === '완료', '받은 뒤 DELETE = 손님 글(payload)·결과 data 지움 · 상태 그대로');
        const c1 = await call('DELETE', `/api/order-memo/preview/${reqs[10]}`, null, { uid: 10 });
        ok(c1.s === 200 && (await db.query(`SELECT status, payload FROM pending_orders WHERE id = $1`, [reqs[10]])).rows[0].status === '취소', '아직 안 집힌 요청을 그만두면 = 취소 · 글 지움');
        await db.query(`UPDATE pending_orders SET status = '오류', result = $2 WHERE id = $1`, [reqs[1], JSON.stringify({ type: 'error', error: '창구가 3번 시도했지만 결과를 올리지 못했습니다.' })]);
        const g3 = await call('GET', `/api/order-memo/preview/${reqs[1]}`, null, { uid: 1 });
        ok(g3.j.state === 'fail' && g3.j.leftover === '이손님 박받음 010-7777-8888 황금향 3kg 1박스' && /3번 시도/.test(g3.j.message), '창구 실패 = fail · 남은 글 그대로 돌려줌 · 이유 글', g3.j);
        const auditDesk = audits.filter(a => a.action === 'desk_request');
        ok(auditDesk.length === 3 && !/010|이손님|박받음/.test(JSON.stringify(auditDesk)), '창구 요청 감사 = 줄 수만(손님 글 0)', auditDesk);
        // 하루 지난 창구 요청 줄 = 글·결과만 지움
        const w2 = await call('POST', '/api/order-memo/preview', { raw: MIX }, { uid: 1 });
        await db.query(`UPDATE pending_orders SET created_at = NOW() - INTERVAL '2 days', result = '{"data":{"x":1}}'::jsonb, status = '완료' WHERE id = $1`, [w2.j.desk.id]);
        const pg2 = await api.purge();
        const old = (await db.query(`SELECT payload, result FROM pending_orders WHERE id = $1`, [w2.j.desk.id])).rows[0];
        ok(pg2.desk >= 1 && old.payload === null && !('data' in old.result), '영구 삭제 틱 = 하루 지난 창구 요청의 손님 글·결과 지움(화면이 DELETE 못 하고 떠난 경우)', { pg2, old });
        deskOn = false; cfgVal = { ai: { direct: true } };

        console.log('⑨ 입력삭제 주소 줄(워커3 시험 ①)');
        {
            const P = '010-2101-0013', AD = ['', P, '', '강가짜', CAT[0], '1', '010-3201-0013', '', '경기도 가짜시 가짜로 88', '', P, '', ''];
            const sv9 = await call('POST', '/api/order-memo', { raw: 'g', rows: [
                { kind: 'line', src: 'ai', key: P, note: '입력o삭제x', plat: '네이버' },
                { kind: 'cash', src: 'ai', cells: AD },
                { kind: 'cash', src: 'ai', cells: Object.assign([], AD, { 1: '010-5555-1111', 10: '010-5555-1111' }) } ] });
            const [, addrRow, cashRow9] = sv9.j.rows || [];
            ok(sv9.s === 200 && addrRow.indiv === true && !/[!！]/.test(addrRow.cells[0]) && addrRow.cells[0] === '제주아꼼이네' && addrRow.cells[10] === P && addrRow.sure && cashRow9.indiv === false && cashRow9.cells[0].startsWith('!'),
                '같은 묶음 「입력o삭제x」 번호 = 현금 줄 구매자 번호 → 주소 줄(「!」 없음 · K = 주문 번호) · 다른 번호 줄은 현금 손님(「!」)', sv9.j.rows);
            const fs9 = OM.pickForShip((await db.query(`SELECT id, kind, to_char(ship_date, 'YYYY-MM-DD') AS ship_date, line, cells, sure, check_why, state, used_on FROM order_memo_rows WHERE entry_id = $1 ORDER BY id`, [sv9.j.entry_id])).rows, '2026-10-30');
            const pc9 = core.parseCash(fs9.cash_aoa);
            const cc9 = core.cashCheck({ orders: [{ key: 'n1', digits: '01021010013', buyer: '구매자', qty: 1, individual: true, excluded: false }], cash: pc9 });
            ok(pc9.ok && pc9.rows.length === 2 && pc9.rows.filter(r => r.bang).length === 1 && cc9.missing.length === 0 && cc9.boxDiff.length === 0 && cc9.strangers.length === 0,
                '최종발주 cashCheck = 입력삭제 주문의 「주소 줄 없음」 카드 0 · 현금 손님 1 · 낯선 줄 0', { cc9, bang: pc9.rows.map(r => r.bang) });
            const up9 = await call('PUT', `/api/order-memo/rows/${addrRow.id}`, { cells: Object.assign([], addrRow.cells, { 9: '문 앞' }) });
            ok(up9.j.row.indiv === true && !/[!！]/.test(up9.j.row.cells[0]), '주소 줄 고치기 = 「!」 안 붙음(구분 그대로)', up9.j.row);
            // #850-a 날짜 지정 입력삭제 줄 저장 → 주소 줄도 그날 · 고치기로 날짜 바꾸면 주소 줄도
            const PA = '010-4101-0014';
            const svA = await call('POST', '/api/order-memo', { raw: 'a', rows: [
                { kind: 'line', src: 'rule', line: '11/3\t' + PA + '\t입력o삭제x\t네이버', key: PA, note: '입력o삭제x', plat: '네이버', ship_date: '2026-11-03' },
                { kind: 'cash', src: 'ai', cells: ['', PA, '', '오가짜', CAT[0], '1', '010-3201-0014', '', '경기도 가짜시 가짜로 99', '', PA, '', ''] } ] });
            const [lA, aA] = svA.j.rows || [];
            const fA1 = await call('GET', '/api/order-memo/for-ship?date=2026-11-01');
            const fA3 = await call('GET', '/api/order-memo/for-ship?date=2026-11-03');
            ok(aA.indiv && aA.ship_date === '2026-11-03' && fA1.j.waiting.some(w => w.id === aA.id) && !fA1.j.cash_ids.includes(aA.id) && fA3.j.cash_ids.includes(aA.id), '#850-a 저장 = 주소 줄 11/3 · 11/1 for-ship waiting · 11/3 현금 행', { aA: aA.ship_date, w: fA1.j.waiting });
            await call('POST', '/api/order-memo/used', { date: '2026-11-01', ids: fA1.j.ids });
            await call('POST', '/api/order-memo/clear', { date: '2026-11-01' });
            const stA1 = (await db.query(`SELECT id, state FROM order_memo_rows WHERE id = ANY($1::int[]) ORDER BY id`, [arr([lA.id, aA.id])])).rows.map(r => r.state).join();
            ok(stA1 === 'open,open', '#850-a 11/1 비우기 = 둘 다 남음', stA1);
            const upA = await call('PUT', `/api/order-memo/rows/${lA.id}`, { ship_date: '2026-11-04' });
            const aA2 = (await db.query(`SELECT to_char(ship_date, 'YYYY-MM-DD') AS d FROM order_memo_rows WHERE id = $1`, [aA.id])).rows[0].d;
            const fA3b = await call('GET', '/api/order-memo/for-ship?date=2026-11-03'), fA4 = await call('GET', '/api/order-memo/for-ship?date=2026-11-04');
            ok(upA.j.paired === 1 && aA2 === '2026-11-04' && fA3b.j.waiting.some(w => w.id === aA.id) && fA4.j.cash_ids.includes(aA.id) && fA4.j.lines.find(l => l.id === lA.id).state === 'today',
                '#850-a 입력삭제 줄 날짜 11/3 → 11/4 고침 = 주소 줄도 11/4(paired 1) · 11/3 waiting · 11/4 현금 행', { paired: upA.j.paired, aA2 });
            const upB = await call('PUT', `/api/order-memo/rows/${lA.id}`, { note: '입력o삭제x 쿠팡' });
            ok(upB.j.paired === 0, '#850-a 날짜 안 바꾼 고치기 = 주소 줄 무접촉(paired 0)');
            await call('POST', '/api/order-memo/clear', { all: true });
            // 창구 경유: 규칙으로 읽은 입력삭제 줄 + 창구가 읽은 주소 → 기다리기 결과도 주소 줄
            deskOn = true; cfgVal = null;
            const w9 = await call('POST', '/api/order-memo/preview', { raw: P + ' 입력o삭제x\n받는분 강가짜 010-3201-0013 경기도 가짜시 가짜로 88 로 보내주세요' }, { uid: 1 });
            const p9 = (await db.query(`SELECT payload FROM pending_orders WHERE id = $1`, [w9.j.desk.id])).rows[0].payload;
            await db.query(`UPDATE pending_orders SET status = '완료', result = $2 WHERE id = $1`, [w9.j.desk.id, JSON.stringify({ type: 'desk_answer', answer: 'x', data: { lines: [], cash: [{ buyer: '', buyer_phone: P, recv: '강가짜', phone1: '010-3201-0013', phone2: '', addr: '경기도 가짜시 가짜로 88', option: CAT[0], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' }], unsure: [], sms_draft: '' } })]);
            const g9 = await call('GET', `/api/order-memo/preview/${w9.j.desk.id}`, null, { uid: 1 });
            ok(w9.j.rows.length === 1 && p9.indiv_keys.map(k => k.key).join() === P && g9.j.state === 'done' && g9.j.rows[0].indiv === true && !/[!！]/.test(g9.j.rows[0].cells[0]), '창구 경유 = 규칙 입력삭제 줄 번호(payload.indiv_keys)로 창구 주소 줄도 「!」 없이', { p9: p9.indiv_keys, g9: g9.j.rows });
            await call('DELETE', `/api/order-memo/preview/${w9.j.desk.id}`, null, { uid: 1 });
            deskOn = false; cfgVal = { ai: { direct: true } };
        }

        console.log('⑩ 문자 출처 API(#850-b)');
        {
            const U = { uid: 21 };
            cfgVal = { ai: { direct: true } };
            const t1 = '타이벡 5kg 1박스 박받음 010-7777-8888 제주시 1 입금 김철수로 했어요';
            const q1 = await call('POST', '/api/order-memo/preview', { raw: t1, source: 'sms:55', phone: '010-9259-0977' }, U);
            const c1 = q1.j.rows.find(r => r.kind === 'cash');
            ok(c1 && c1.cells[10] === '010-9259-0977' && c1.cells[1] === '010-9259-0977' && c1.cells[0] === '!김철수 드림' && c1.cells[6] === '010-7777-8888', '미리보기(서버 직접) · 문자 출처 = K·B 문자 손님 번호 · 입금자명 → 「!김철수 드림」 · 받는 분 번호 다름 그대로', c1 && c1.cells);
            const q2 = await call('POST', '/api/order-memo/preview', { raw: '타이벡 1박스 박받음 제주시 1', source: 'sms:55' }, U);
            const c2 = q2.j.rows.find(r => r.kind === 'cash');
            ok(c2 && c2.cells[10] === '010-9259-0977' && c2.cells[0] === '!이손님(제주아꼼이네)', '화면이 번호를 안 보내면 sms_threads 에서 읽음 · 입금자명 없음 = 「구매자(제주아꼼이네)」', c2 && c2.cells);
            const q3 = await call('POST', '/api/order-memo/preview', { raw: '타이벡 1박스 박받음 제주시 1', source: 'manual', phone: '010-9259-0977' }, U);
            ok(q3.j.rows.find(r => r.kind === 'cash').cells[10] === '010-5555-6666', 'manual = 문자 번호 안 씀(종전 그대로)');
            deskOn = true; cfgVal = null;
            const w = await call('POST', '/api/order-memo/preview', { raw: '박받음 010-7777-8888 제주시 1 입금은 이영수로 했습니다', source: 'sms:55' }, U);
            const pw = (await db.query(`SELECT payload FROM pending_orders WHERE id = $1`, [w.j.desk.id])).rows[0].payload;
            await db.query(`UPDATE pending_orders SET status = '완료', result = $2 WHERE id = $1`, [w.j.desk.id, JSON.stringify({ type: 'desk_answer', answer: 'x', data: { lines: [], cash: [{ buyer: '', buyer_phone: '', recv: '박받음', phone1: '010-7777-8888', phone2: '', addr: '제주시 1', option: CAT[0], qty: 1, memo: '', sender: '', sender_phone: '', sender_addr: '', date: '' }], unsure: [], sms_draft: '' } })]);
            const gw = await call('GET', `/api/order-memo/preview/${w.j.desk.id}`, null, U);
            ok(pw.from_sms === true && gw.j.state === 'done' && gw.j.rows[0].cells[10] === '010-9259-0977' && gw.j.rows[0].cells[0] === '!이영수 드림', '창구 경유 · 문자 출처 = 기다리기 결과도 K = 문자 손님 · 입금자명 「!이영수 드림」(창구가 sender 를 비워도)', gw.j.rows);
            await call('DELETE', `/api/order-memo/preview/${w.j.desk.id}`, null, U);
            deskOn = false; cfgVal = { ai: { direct: true } };
            const sv = await call('POST', '/api/order-memo', { raw: 's', source: 'sms:55', rows: [{ kind: 'cash', src: 'edit', cells: ['', '', '', '박받음', CAT[0], '1', '010-7777-8888', '', '제주시 1', '', '', '', ''] }] }, U);
            ok(sv.j.rows[0].cells[10] === '' && sv.j.rows[0].cells[1] === '', '저장 = 사람이 비운 K·B 칸 그대로(문자 번호 채우기는 미리보기 때만)', sv.j.rows[0].cells);
            const qR = await call('POST', '/api/order-memo/preview', { raw: ['', '', '', '박받음', CAT[0], '1', '010-7777-8888', '', '제주시 1', '', '', '', ''].join('\t'), source: 'sms:55' }, U);
            ok(qR.j.rows[0].kind === 'cash' && qR.j.rows[0].cells[10] === '010-9259-0977' && qR.j.rows[0].cells[1] === '010-9259-0977', '미리보기 · 붙여 넣은 현금 행의 빈 K·B = 문자 손님 번호', qR.j.rows[0].cells);
            await call('POST', '/api/order-memo/clear', { all: true }, U);
        }

        console.log('⑪ 판매처 확인 lookup(#850-d)');
        {
            const a0 = audits.length;
            const L = async (q, who) => call('GET', '/api/order-memo/lookup?' + q, null, who || { uid: 31 });
            const b1 = await L('key=' + encodeURIComponent('010-1111-2222'));
            ok(b1.s === 200 && b1.j.found && b1.j.matches.length === 1 && b1.j.matches[0].plat === '네이버' && b1.j.matches[0].as === 'buyer' && b1.j.matches[0].order_no === '2026102512345678' && b1.j.matches[0].option === '타이벡 5kg' && b1.j.matches[0].qty === 2 && b1.j.matches[0].paid_at === '2026-10-25 12:00',
                '구매자 번호 = as buyer · 네이버 · 주문번호·옵션·수량·결제 시각(KST)', b1.j);
            const b2 = await L('key=01033334444');
            ok(b2.j.matches[0].as === 'recv' && b2.j.matches[0].recv_initial === '김' && b2.j.matches[0].recv_name === null && b2.j.matches[0].addr === null, '받는 분 번호 = as recv · 성 한 글자만(이름 전체·주소 = 표에 없음 → null)', b2.j.matches);
            const b3 = await L('key=01011112222&plat=' + encodeURIComponent('쿠팡'));
            ok(b3.s === 200 && !b3.j.found && b3.j.matches.length === 0 && /못 찾았어요/.test(b3.j.message) && b3.j.coverage.days === 7, '판매처 지정 = 그 채널만 · 없음 = 「못 찾았어요(…)」 · 덮는 범위 7일', b3.j);
            const b4 = await L('key=20261025-0000123');
            ok(b4.j.matches.length === 1 && b4.j.matches[0].plat === '자사몰' && b4.j.matches[0].as === 'order' && b4.j.matches[0].order_no === '20261025-0000123', '자사몰 주문번호 꼴 = 주문번호로', b4.j.matches);
            const b5 = await L('key=2026102512345678');
            ok(b5.j.matches.length === 1 && b5.j.matches[0].plat === '네이버' && b5.j.matches[0].as === 'order', '네이버 상품주문번호 = 주문번호로');
            const b6 = await L('key=010-9999-0000&plat=' + encodeURIComponent('쿠팡'));
            ok(b6.j.matches[0].as === 'recv' && b6.j.matches[0].paid_at === null, '쿠팡(결제 시각 없음) = 받는 분 번호로 찾음');
            ok((await L('key=1234')).s === 400 && (await L('key=01011112222&plat=' + encodeURIComponent('옥션'))).s === 400, '짧은 번호·모르는 판매처 = 400');
            ok(audits.length === a0, '감사 기록 0(개인정보 응답에만)');
            // checked(판매처 확인 표시) — 꼴만 거름 · 저장 · 목록 · for-ship · 고치기
            const CK = { plat: '네이버', as: 'buyer', at: '2026-10-25T10:00:00Z', name: '김손님', addr: '서울 어딘가', phone: '01011112222' };
            const sk = await call('POST', '/api/order-memo', { raw: 'k', rows: [
                { kind: 'line', src: 'edit', key: '010-1111-2222', note: 'S사이즈로', plat: '네이버', checked: CK },
                { kind: 'line', src: 'edit', key: '010-3333-4444', note: 'M사이즈로', checked: { plat: '옥션', as: 'buyer' } },
                { kind: 'cash', src: 'edit', cells: r6.cells, checked: CK } ] }, { uid: 31 });
            const [k1, k2, k3] = sk.j.rows || [];
            const dbk = (await db.query(`SELECT checked FROM order_memo_rows WHERE id = $1`, [k1.id])).rows[0].checked;
            const ckEq = c => !!c && Object.keys(c).sort().join() === 'as,at,plat' && c.plat === '네이버' && c.as === 'buyer' && c.at === '2026-10-25T10:00:00.000Z';   // jsonb 는 칸 순서를 바꿈
            ok(sk.s === 200 && ckEq(k1.checked) && ckEq(dbk) && k2.checked === null && k3.checked === null,
                'checked 저장 = {plat, as, at} 꼴만(이름·주소·번호 버림) · 판매처 틀림 = null · 현금 줄 = null', { k1: k1.checked, dbk, k2: k2.checked, k3: k3.checked });
            const lk = await call('GET', '/api/order-memo', null, { uid: 31 });
            const fk = await call('GET', '/api/order-memo/for-ship?date=2026-11-10', null, { uid: 31 });
            ok(lk.j.entries.flatMap(e => e.rows).find(r => r.id === k1.id).checked.plat === '네이버' && fk.j.lines.find(l => l.id === k1.id).checked.as === 'buyer' && fk.j.lines.find(l => l.id === k2.id).checked === null, '목록·for-ship lines[] 에 checked 그대로');
            const u1 = await call('PUT', `/api/order-memo/rows/${k1.id}`, { note: 'M사이즈로' }, { uid: 31 });
            ok(u1.j.row.checked && u1.j.row.checked.plat === '네이버', '번호·판매처 그대로 고치기 = checked 유지');
            const u2 = await call('PUT', `/api/order-memo/rows/${k1.id}`, { plat: '쿠팡' }, { uid: 31 });
            ok(u2.j.row.checked === null, '판매처 바꿈 = checked 비움');
            const u3 = await call('PUT', `/api/order-memo/rows/${k1.id}`, { key: '010-5555-6666', checked: { plat: '쿠팡', as: 'recv', at: '2026-10-25T11:00:00Z' } }, { uid: 31 });
            ok(u3.j.row.checked && u3.j.row.checked.as === 'recv' && u3.j.row.checked.plat === '쿠팡', '번호 바꾸며 새 checked 실음 = 새 값');
            const u4 = await call('PUT', `/api/order-memo/rows/${k1.id}`, { key: '010-7777-0000' }, { uid: 31 });
            ok(u4.j.row.checked === null, '번호만 바꿈 = checked 비움');
            const u5 = await call('PUT', `/api/order-memo/rows/${k2.id}`, { checked: { plat: '자사몰', as: 'order' } }, { uid: 31 });
            ok(u5.j.row.checked && u5.j.row.checked.plat === '자사몰' && !Number.isNaN(Date.parse(u5.j.row.checked.at)), '번호 그대로 checked 만 실음 = 저장(at 없으면 지금)');
            await call('POST', '/api/order-memo/clear', { all: true }, { uid: 31 });
        }

        console.log('⑫ 메모함 발송 전 주문 표(#850-e · 문자 수집기 훅)');
        {
            const P = require(path.join(ROOT, 'sms', 'preorders.js'));
            await api.preEnsure();
            const NV = (pid, buyer, recv, extra) => Object.assign({ _pid: pid, '구매자명': '구매' + pid.slice(-2), '구매자연락처': buyer, '수취인명': '받는' + pid.slice(-2), '수취인연락처1': recv, '통합배송지': '제주특별자치도 제주시 가짜로 ' + pid.slice(-2), '옵션정보': '타이벡 5kg', '수량': 1, _x: { paymentDate: '2026-10-25T10:00:00.000+09:00' } }, extra || {});
            let nvRows = [NV('2026102500000011', '010-2222-1111', '010-3333-1111'), NV('2026102500000012', '010-2222-1212', '010-3333-1212')];
            const cpRows = [{ _orderId: '91000', _shipmentBoxId: '81000', _vendorItemId: '71000', '구매자': '쿠구매', '구매자전화번호': '010-4444-1111', '수취인이름': '쿠받는', '수취인전화번호': '0507-1234-5678', '수취인 주소': '서울시 가짜구 1', '노출상품명(옵션명)': '레몬 2kg', '구매수(수량)': 1, _paidAt: '2026-10-25T01:00:00.000Z' }];
            const c24Rows = [{ _orderId: '20261025-0000999', _itemCode: 'P1', '주문자명': '자구매', '주문자 휴대전화': '010-5555-1111', '수령인': '자받는', '수령인 휴대전화': '010-5555-2222', '수령인 주소(전체)': '부산시 가짜로 2', '주문상품명(세트상품 포함)': '황금향 3kg', '수량': 2, _paidAt: '2026-10-25T02:00:00.000Z' }];
            const depsP = { fetchNaver: async () => ({ rows: nvRows }), fetchCoupang: async () => ({ rows: cpRows }), fetchCafe24: async () => ({ rows: c24Rows }) };

            const r1 = await P.collect(pool, depsP);
            const mem = (await db.query(`SELECT channel, order_key, product_order_no, buyer_name, recv_name, addr, buyer_digits, recv_digits, qty, miss FROM order_memo_preorders ORDER BY channel, order_key`)).rows;
            ok(r1.ok && mem.length === 4 && mem.find(x => x.order_key === '2026102500000011').buyer_name === '구매11' && mem.find(x => x.order_key === '2026102500000011').recv_name === '받는11' && /가짜로 11$/.test(mem.find(x => x.order_key === '2026102500000011').addr)
                && mem.find(x => x.channel === 'coupang').product_order_no === '91000' && mem.find(x => x.channel === 'cafe24').qty === 2 && mem.find(x => x.channel === 'cafe24').product_order_no === '20261025-0000999',
                '문자 수집 1회 = 메모함 표에도 4줄(구매자 이름·받는 분 이름 전체·주소·상품주문번호 · 추가 조회 0)', mem);
            const smsCols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'sms_preorders' ORDER BY ordinal_position`)).rows.map(x => x.column_name).join();
            const smsRow = (await db.query(`SELECT * FROM sms_preorders WHERE order_key = '2026102500000011'`)).rows[0];
            ok(smsCols === 'id,channel,order_key,buyer_digits,recipient_digits,recipient_initial,option_text,qty,paid_at,seen_at,created_at,miss' && smsRow && smsRow.recipient_initial === '받' && !JSON.stringify(smsRow).includes('가짜로') && !JSON.stringify(smsRow).includes('받는11'),
                '문자 표 sms_preorders = 칸 그대로 · 이름은 한 글자 · 주소·이름 전체 0(#610-G 그대로)', { smsCols, smsRow });
            const lk1 = await call('GET', '/api/order-memo/lookup?key=010-3333-1111', null, { uid: 41 });
            ok(lk1.j.coverage.source === 'memo' && lk1.j.matches.length === 1 && lk1.j.matches[0].as === 'recv' && lk1.j.matches[0].recv_name === '받는11' && lk1.j.matches[0].buyer_name === '구매11' && /가짜로 11$/.test(lk1.j.matches[0].addr) && lk1.j.matches[0].order_no === '2026102500000011',
                'lookup = 메모함 표에서 받는 분 이름 전체·구매자 이름·주소 채움', lk1.j);
            const lk2 = await call('GET', '/api/order-memo/lookup?key=20261025-0000999', null, { uid: 41 });
            ok(lk2.j.matches[0].plat === '자사몰' && lk2.j.matches[0].recv_name === '자받는' && lk2.j.matches[0].addr === '부산시 가짜로 2', '자사몰 주문번호 = 메모함 표에서');
            const lk3 = await call('GET', '/api/order-memo/lookup?key=010-9999-9999', null, { uid: 41 });
            ok(!lk3.j.found && lk3.j.message === '못 찾았어요 — 7일 지난 주문이면 판매처를 골라 주세요' && lk3.j.coverage.days === 7, '없음 = 「못 찾았어요 — 7일 지난 주문이면 판매처를 골라 주세요」');
            // 즉시 조회(merge) = 넣기만 · 큰 수집 두 번 연속 안 보이면 삭제(문자 쪽과 같은 규칙)
            nvRows = [NV('2026102500000011', '010-2222-1111', '010-3333-1111')];
            await P.collect(pool, depsP, { days: 2, merge: true });
            ok((await db.query(`SELECT miss FROM order_memo_preorders WHERE order_key = '2026102500000012'`)).rows[0].miss === 0, 'merge(즉시 조회) = 안 보인 줄 셈 안 함');
            await P.collect(pool, depsP);
            const m1 = (await db.query(`SELECT miss FROM order_memo_preorders WHERE order_key = '2026102500000012'`)).rows[0];
            const lkM = await call('GET', '/api/order-memo/lookup?key=010-3333-1212', null, { uid: 41 });
            ok(m1.miss === 1 && !lkM.j.found, '큰 수집 1번 안 보임 = miss 1 · lookup 에서 빠짐(발송됐을 수 있음)');
            await P.collect(pool, depsP);
            ok((await db.query(`SELECT count(*)::int n FROM order_memo_preorders WHERE order_key = '2026102500000012'`)).rows[0].n === 0 && (await db.query(`SELECT count(*)::int n FROM sms_preorders WHERE order_key = '2026102500000012'`)).rows[0].n === 0, '두 번 연속 안 보임 = 메모함 표·문자 표 둘 다 삭제(같은 규칙)');
            // 훅이 실패해도 문자 수집은 그대로 · 훅을 빼면 종전과 같음
            P.setRowsHook(async () => { throw new Error('훅 실패 시험'); });
            nvRows = [NV('2026102500000013', '010-2222-1313', '010-3333-1313')];
            const r4 = await P.collect(pool, depsP, { merge: true });
            ok(r4.ok && (await db.query(`SELECT count(*)::int n FROM sms_preorders WHERE order_key = '2026102500000013'`)).rows[0].n === 1 && (await db.query(`SELECT count(*)::int n FROM order_memo_preorders WHERE order_key = '2026102500000013'`)).rows[0].n === 0, '훅 실패 = 문자 수집은 그대로(문자 표엔 들어감 · 메모함 표만 안 씀)');
            P.setRowsHook(null);
            nvRows = [NV('2026102500000014', '010-2222-1414', '010-3333-1414')];
            await P.collect(pool, depsP, { merge: true });
            ok((await db.query(`SELECT count(*)::int n FROM order_memo_preorders WHERE order_key = '2026102500000014'`)).rows[0].n === 0, '훅 없음 = 메모함 표 무접촉(종전 동작)');
            P.setRowsHook(api.preHook);
            // 워커3 점검 손질: ③ 번호 정규화 = 문자 쪽과 같게 · ④ 세무사 403 · ② 훅 실패 경고 = 오류 코드만 · ① 6시간 정리에 7일 지난 줄
            nvRows = [NV('2026102500000015', '+82 10-2222-1515', '+82-10-3333-1515')];
            await P.collect(pool, depsP, { merge: true });
            const nm = (await db.query(`SELECT buyer_digits, recv_digits FROM order_memo_preorders WHERE order_key = '2026102500000015'`)).rows[0];
            const ns = (await db.query(`SELECT buyer_digits, recipient_digits FROM sms_preorders WHERE order_key = '2026102500000015'`)).rows[0];
            ok(nm && ns && nm.buyer_digits === '01022221515' && nm.buyer_digits === ns.buyer_digits && nm.recv_digits === ns.recipient_digits, '③ +82 번호 = 두 표 같은 숫자(01022221515)', { nm, ns });
            const lkP = await call('GET', '/api/order-memo/lookup?key=' + encodeURIComponent('+82 10-3333-1515'), null, { uid: 41 });
            ok(lkP.j.found && lkP.j.matches[0].as === 'recv', '③ lookup 도 +82 꼴 번호로 찾음');
            ok((await call('GET', '/api/order-memo/lookup?key=010-3333-1111', null, { uid: 42, role: 'accountant' })).s === 403, '④ 세무사(accountant) 계정 = 403');
            const warns = [], ow = console.warn; console.warn = (...x) => warns.push(x);
            P.setRowsHook(async () => { throw Object.assign(new Error('이름 김가짜 010-1111-2222'), { code: 'XX01' }); });
            await P.collect(pool, depsP, { merge: true });
            console.warn = ow; P.setRowsHook(api.preHook);
            ok(warns.length >= 1 && warns.every(w => w[0] === '[발주 메모함] 발송 전 주문 쓰기 실패:' && w[1] === 'XX01' && w.length === 2), '② 훅 실패 = 경고 한 줄 · 오류 코드만(글·이름·번호 0)', warns);
            await db.query(`UPDATE order_memo_preorders SET seen_at = NOW() - INTERVAL '8 days' WHERE order_key = '2026102500000011'`);
            const pgP = await api.purge();
            ok(pgP.pre === 1 && (await db.query(`SELECT count(*)::int n FROM order_memo_preorders WHERE order_key = '2026102500000011'`)).rows[0].n === 0, '① 6시간 정리 = 7일 넘게 안 보인 발송 전 주문 줄 삭제', pgP);
        }

        console.log('⑧ 점검 손질(a 늦은 답 · c 오래된 확인 · d 섞기 · e 출처)');
        // a) 처리 중에 화면이 그만둠(DELETE) → 창구가 늦게 답해도 안 내줌
        deskOn = true; cfgVal = null;
        const wa = await call('POST', '/api/order-memo/preview', { raw: MIX }, { uid: 10 });
        await db.query(`UPDATE pending_orders SET status = '처리중' WHERE id = $1`, [wa.j.desk.id]);
        await call('DELETE', `/api/order-memo/preview/${wa.j.desk.id}`, null, { uid: 10 });
        const stA = (await db.query(`SELECT status, payload FROM pending_orders WHERE id = $1`, [wa.j.desk.id])).rows[0];
        await db.query(`UPDATE pending_orders SET status = '완료', result = $2 WHERE id = $1`, [wa.j.desk.id, JSON.stringify({ type: 'desk_answer', answer: 'x', data: deskData })]);
        const ga = await call('GET', `/api/order-memo/preview/${wa.j.desk.id}`, null, { uid: 10 });
        ok(stA.status === '처리중' && stA.payload === null && ga.j.state === 'fail' && !ga.j.rows && /그만둔 요청/.test(ga.j.message), 'a 처리 중 그만둔 요청 = 늦게 온 창구 답을 안 내줌(fail 「그만둔 요청」)', ga.j);
        const rsrc2 = require('fs').readFileSync(path.join(ROOT, 'scripts', 'desk', 'respond.js'), 'utf8');
        ok(/\(payload IS NULL\) AS no_payload/.test(rsrc2) && /!\(o\.no_payload && \/\^\\\[발주 메모 읽기\\\]\/\.test\(o\.content/.test(rsrc2), 'a respond.js = 손님 글 지운 「[발주 메모 읽기]」 요청엔 data 를 안 적음');
        // d) 섞기 — staff_direct true: 대표 요금제 계정(1·10)만 창구 · 7 = 서버 직접 · 기본(false) = 모두 창구
        cfgVal = { ai: { staff_direct: true } };
        const a0 = aiCalls, n0 = await nPo();
        const s7 = await call('POST', '/api/order-memo/preview', { raw: MIX }, { uid: 7 });
        ok(s7.j.desk === null && s7.j.ai.via === 'staff_direct' && aiCalls === a0 + 1 && await nPo() === n0 && s7.j.rows.some(r => r.kind === 'cash'), 'd 섞기 켬 · 직원(7) = 서버 직접 AI(창구 요청 줄 0)', s7.j.ai);
        const s1 = await call('POST', '/api/order-memo/preview', { raw: MIX }, { uid: 1 });
        ok(s1.j.desk && s1.j.desk.state === 'wait' && aiCalls === a0 + 1 && await nPo() === n0 + 1, 'd 섞기 켬 · 대표 요금제 계정(1) = 창구(무료)');
        await call('DELETE', `/api/order-memo/preview/${s1.j.desk.id}`, null, { uid: 1 });
        cfgVal = null;
        const s7b = await call('POST', '/api/order-memo/preview', { raw: MIX }, { uid: 7 });
        ok(s7b.j.desk && s7b.j.desk.state === 'wait' && aiCalls === a0 + 1, 'd 기본(staff_direct 없음) = 직원도 창구');
        await call('DELETE', `/api/order-memo/preview/${s7b.j.desk.id}`, null, { uid: 7 });
        deskOn = false; cfgVal = { ai: { direct: true } };
        // e) 저장 때 출처·원문 줄 보존(칸이 같을 때만) · 고친 줄 = 칸으로 다시 만들고 edit
        const raw1 = '010-1234-5678 30일 발송';
        const se = await call('POST', '/api/order-memo', { raw: 'e', rows: [
            { kind: 'line', src: 'rule', line: raw1, key: '010-1234-5678', note: '30일 발송', ship_date: '2026-10-30' },
            { kind: 'line', src: 'rule', line: raw1, key: '010-9999-8888', note: '30일 발송', ship_date: '2026-10-30' },
            { kind: 'line', src: 'rule', line: raw1, key: '010-1234-5678', note: '30일 발송 보내는이 홍길동', ship_date: '2026-10-30' },
            { kind: 'line', src: 'rule', line: raw1, key: '010-1234-5678', note: '30일 발송', plat: '쿠팡', ship_date: '2026-10-30' },
            { kind: 'line', src: 'ai', key: '010-2222-3333', note: '입력o삭제x', plat: '네이버', ship_date: '2026-10-31' },
            { kind: 'cash', src: 'ai', cells: r6.cells } ] });
        const [e1, e2, eN, eP, e3, e4] = se.j.rows || [];
        ok(se.s === 200 && e1.src === 'rule' && e1.line === raw1 && e2.src === 'edit' && e2.line === '10/30\t010-9999-8888\t30일 발송' && eN.src === 'edit' && eN.line === '10/30\t010-1234-5678\t30일 발송 보내는이 홍길동' && eP.src === 'edit' && eP.line === '10/30\t010-1234-5678\t30일 발송\t쿠팡' && e3.src === 'ai' && e3.line === '10/31\t010-2222-3333\t입력o삭제x\t네이버' && e4.src === 'ai',
            'e 저장 = 규칙 원문 줄·출처 그대로 · 번호·비고·플랫폼 고친 줄은 칸으로 다시(edit) · AI 출처 보존', se.j.rows);
        // c) 오래된 확인 — 7일 = 표시 · 30일 = 영구 삭제(빈 건이면 원문째)
        const sc = await call('POST', '/api/order-memo', { raw: '확인 원문', rows: [{ kind: 'cash', src: 'ai', cells: m1.cells }] });
        const cid = sc.j.rows[0].id;
        ok(sc.j.rows[0].sure === false && sc.j.rows[0].stale === false, 'c 갓 저장한 확인 줄 = 오래된 확인 아님');
        await db.query(`UPDATE order_memo_rows SET updated_at = NOW() - INTERVAL '8 days' WHERE id = $1`, [cid]);
        const lc2 = await call('GET', '/api/order-memo');
        const crow = lc2.j.entries.flatMap(e => e.rows).find(r => r.id === cid);
        ok(crow && crow.stale === true && lc2.j.counts.stale === 1, 'c 8일 안 고친 확인 줄 = stale · counts.stale 1', { crow, counts: lc2.j.counts });
        await db.query(`UPDATE order_memo_rows SET updated_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [cid]);
        await db.query(`UPDATE order_memo_entries SET created_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [sc.j.entry_id]);
        const pg3 = await api.purge();
        const moved = (await db.query(`SELECT state, cleared_by FROM order_memo_rows WHERE id = $1`, [cid])).rows[0];
        const lc3 = await call('GET', '/api/order-memo?state=cleared');
        ok(pg3.unsure === 1 && moved.state === 'cleared' && moved.cleared_by === '자동 정리(확인 30일)' && lc3.j.entries.some(e => e.rows.some(r => r.id === cid)) && (await db.query(`SELECT 1 FROM order_memo_entries WHERE id = $1`, [sc.j.entry_id])).rows.length === 1 && (await db.query(`SELECT state FROM order_memo_rows WHERE id = $1`, [e1.id])).rows[0].state === 'open',
            'c 31일 안 고친 확인 줄 = 「비운 것」으로(자동 정리 · 되살리기 탭에 보임 · 원문 남음) · 확실한 열린 줄은 그대로', { pg3, moved });
        const rv = await call('POST', `/api/order-memo/restore/${cid}`);
        ok(rv.s === 200 && rv.j.row.state === 'open', 'c 자동 정리된 확인 줄도 되살리기 됨');
        await call('DELETE', `/api/order-memo/rows/${cid}`);
        await db.query(`UPDATE order_memo_rows SET cleared_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [cid]);
        const pg4 = await api.purge();
        ok(pg4.rows === 1 && (await db.query(`SELECT 1 FROM order_memo_rows WHERE id = $1`, [cid])).rows.length === 0 && (await db.query(`SELECT 1 FROM order_memo_entries WHERE id = $1`, [sc.j.entry_id])).rows.length === 0, 'c 비운 것에서 30일 더 지나면 영구 삭제 + 원문째', pg4);

        // 분당 상한
        let last = 0; for (let i = 0; i < 25; i++) last = (await call('POST', '/api/order-memo/preview', { raw: '010-1234-5678 S사이즈로' })).s;
        ok(last === 429, '미리보기 분당 20번 넘으면 429');
    } finally { srv.close(); }
    console.log(`결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
