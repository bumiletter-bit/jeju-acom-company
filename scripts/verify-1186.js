// #1186 발주 계열 고침 검증 — 실코드를 떼어 가짜 자료로(실DB·실서버·채널·브라우저 0 · DB = 이 PC 메모리 pglite · 번호·이름 전부 가짜)
//   A2  최종발주 [남은 주문 모두 오늘 발송] = 「메모 재확인」 카드는 남김 · 카드 배송메세지 칸에 고친 글 읽음(final-order.js 실코드 블록)
//   A3  메모함 = 첫날 발송처리 표식(checked.split_sent) 왕복 보존: 화면 lkCheck(실코드) + 서버 PUT(order-memo.js 실제 장착 · pglite) · normRow split_done 옮김
//   A5  자동 송장 = 10분 넘은 sending → unknown(기동·준비 앞) · 10분 안 된 sending 은 그대로(이중 전송 막이 유지)
//   A6  자동 송장 발송일 = 파일 이름 읽기(fileShipDate) · 없는 날 거름(realDay) · 쿠팡 한 상자 여러 줄 판정(실코드 블록)
//   A10 메모함 = 지난 날짜 현금 줄 알약 「지난 날짜 · 안 들어감」(pillOf 실코드) · A11 자동 고쳐 쓰기 = 그사이 친 줄 안 덮음(실코드 블록)
//   틀(메모리 DB·장착)은 verify-1121.js 의 도우미를 그대로 떼어 씀 · 포트 PORT1186(기본 3462)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-1186.js   (TZ=UTC 로도 한 번)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (m, c, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 700))); };
if (!process.env.PGLITE_DIR) { console.log('PGLITE_DIR 필요'); process.exit(2); }
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const OM = require(path.join(ROOT, 'order-memo.js')), IA = require(path.join(ROOT, 'invoice-auto.js'));
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const cut = (s, a0, end) => { const a = s.indexOf(a0); if (a < 0) throw new Error('없음 ' + a0.slice(0, 60)); const b = s.indexOf(end, a); if (b < 0) throw new Error('끝 없음 ' + end.slice(0, 60)); return s.slice(a, b + end.length); };
const FO = rd('public/final-order.js'), AOM = rd('public/ao-ordermemo.js'), IAS = rd('invoice-auto.js');
const BUY = '010-2600-0001', BD = '01026000001', TY = '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)', CAT = [TY];
// verify-1121.js 의 메모리 DB 도우미(arr · mkPool)와 장착(mk) 본문을 그대로
const H = rd('scripts/verify-1121.js');
const arrSrc = cut(H, 'const arr = v =>', '\n'), poolSrc = cut(H, 'function mkPool(db) {', '\n');
const mkBody = cut(H, '    const mk = async pre => {', '\n    };\n');

(async () => {
    // ── A2 일괄 [오늘 발송] ─────────────────────────────────────────────
    console.log('\n■ A2 최종발주 일괄 [남은 주문 모두 오늘 발송]');
    {
        const blk = cut(FO, "if (b.dataset.bulk === 'send') {", 'return renderSummaryOnly(); }');
        const cards = [{ id: 'ord:1', type: 'order', memoOrig: '문 앞' }, { id: 'ord:2', type: 'order', memoOrig: '경비실' }, { id: 'ord:3', type: 'order', recheck: true, memoOrig: '' }, { id: 'memo:9', type: 'memo' }];
        const memoVal = { 'ord:1': '문 앞', 'ord:2': '부재 시 전화 주세요' };   // 2번 카드만 배송메세지 칸을 고침
        const st = { dec: new Map(), ordMemo: new Map([['ord:1', '옛 글']]), out: 1 };
        const doc = { querySelectorAll: () => cards.filter(c => c.type === 'order').map(c => ({ dataset: { id: c.id }, closest: () => ({ querySelector: () => (c.id in memoVal ? { value: memoVal[c.id] } : null) }) })) };
        const res = { hidden: false }; let drew = 0;
        new Function('b', 'st', 'pending', 'document', '$', 'renderSummaryOnly', blk)({ dataset: { bulk: 'send' } }, st, () => cards.filter(c => !st.dec.has(c.id)), doc, () => res, () => { drew++; });
        ok('보통 주문 카드 2장 = 오늘 발송', st.dec.get('ord:1') === 'send' && st.dec.get('ord:2') === 'send');
        ok('「메모 재확인」 카드는 안 닫힘(남음)', !st.dec.has('ord:3'), [...st.dec]);
        ok('메모 카드(주문 아님)는 안 건드림', !st.dec.has('memo:9'));
        ok('고친 배송메세지 = 낱개 단추와 같게 읽음(2번 = 새 글 · 1번 = 원문과 같아 지움)', st.ordMemo.get('ord:2') === '부재 시 전화 주세요' && !st.ordMemo.has('ord:1'), [...st.ordMemo]);
        ok('결과 지우고 다시 그림', st.out === null && res.hidden === true && drew === 1);
        ok('건수 단추 셈도 재확인 카드를 뺌(ordOpen)', /ordOpen = open\.filter\(cd => cd\.type === 'order' && !cd\.recheck\)\.length/.test(FO));
    }

    // ── A3 화면 lkCheck · normRow ────────────────────────────────────────
    console.log('\n■ A3 메모함 표식 보존(화면)');
    {
        const lkSrc = cut(AOM, '    function lkCheck(r) {', '); }');
        const digits = s => String(s || '').replace(/\D/g, ''), isPhoneKey = k => /^0\d{8,11}$/.test(digits(k));
        const mkLk = found => new Function('digits', 'isPhoneKey', 'lkIn', lkSrc + '\nreturn lkCheck;')(digits, isPhoneKey, r => found);
        const row = extra => Object.assign({ key: BUY, plat: '네이버', _key0: BD, _plat0: '네이버', _lk: { state: 'done' }, checked: { plat: '네이버', as: 'buyer', at: '2026-11-02T00:00:00.000Z', split_sent: '2026-11-02', pno: '2026110100000001', ship_memo: '문 앞' } }, extra || {});
        let r = row(); mkLk([{ as: 'buyer', plat: '네이버' }])(r);
        ok('찾기 결과가 다시 와도 split_sent·pno·ship_memo 보존', r.checked.split_sent === '2026-11-02' && r.checked.pno === '2026110100000001' && r.checked.ship_memo === '문 앞' && r.checked.as === 'buyer', r.checked);
        r = row(); mkLk([])(r);
        ok('찾기 0건(주문이 이미 나감)이어도 split_sent 는 남음', r.checked && r.checked.split_sent === '2026-11-02' && r.checked.plat === '네이버', r.checked);
        r = row({ key: '010-9999-0000' }); mkLk([{ as: 'buyer', plat: '네이버' }])(r);
        ok('번호를 바꾸면 옛 표식은 안 따라감(새 번호 줄)', r.checked && !r.checked.split_sent && !r.checked.pno, r.checked);
        r = row({ plat: '쿠팡' }); mkLk([{ as: 'buyer', plat: '쿠팡' }])(r);
        ok('판매처를 바꿔도 옛 표식은 안 따라감', r.checked && !r.checked.split_sent, r.checked);
        r = row({ checked: { plat: '네이버', as: 'buyer', at: 'x' } }); mkLk([{ as: 'recv', plat: '네이버' }])(r);
        ok('표식 없는 보통 줄 = 종전과 같은 꼴(plat·as·at 뿐)', Object.keys(r.checked).sort().join() === 'as,at,plat' && r.checked.as === 'recv', r.checked);
        r = row({ checked: { plat: '네이버', as: 'buyer', at: 'x' } }); mkLk([])(r);
        ok('표식 없는 줄 · 찾기 0건 = 종전대로 null', r.checked === null, r.checked);
        // normRow
        const nrSrc = cut(AOM, '    function normRow(r, entry) {', '\n        return o;\n    }');
        const normRow = new Function('digits', 'md', nrSrc + '\nreturn normRow;')(digits, d => d);
        const cells = Array.from({ length: 13 }, () => '');
        ok('normRow 가 서버 split_done 을 옮김(알약 「입력삭제 · 발송처리 끝」 조건)', normRow({ id: 1, kind: 'cash', cells, split_done: '2026-11-02' }).split_done === '2026-11-02');
        ok('split_done 없거나 꼴이 아니면 null', normRow({ id: 1, kind: 'cash', cells }).split_done === null && normRow({ id: 1, kind: 'cash', cells, split_done: 'x' }).split_done === null);
        const ln = normRow({ id: 2, kind: 'line', key: BUY, plat: '네이버', note: '입력o삭제x' });
        ok('메모 줄 = 받아 온 때의 번호·판매처 기억(_key0·_plat0)', ln._key0 === BD && ln._plat0 === '네이버');
        ok('화면 파일이 split_done 을 쓰는 곳 = 알약(cashPill)·풀림 판정(lostOf) 둘 다 닿음', /if \(r\.split_done && noLine\(r\)\)/.test(AOM) && /r\.service \|\| r\.split_done \|\|/.test(AOM));
    }

    // ── A3 서버 PUT 왕복(pglite · 실제 장착) ─────────────────────────────
    console.log('\n■ A3 메모함 표식 보존(서버 PUT 왕복)');
    {
        const arr = new Function(arrSrc + '\nreturn arr;')();
        const mkPool = new Function('arr', poolSrc + '\nreturn mkPool;')(arr);
        let port = Number(process.env.PORT1186) || 3462;
        const mk = new Function('PGlite', 'express', 'OM', 'ROOT', 'path', 'http', 'mkPool', 'CAT', 'require', 'BD', 'BUY', 'TY', 'HOME', 'PERS', 'fs', 'D0', 'portRef', mkBody.replace('const mk = async pre => {', 'return async pre => {').replace(/port\+\+/g, 'portRef.p++'))(PGlite, express, OM, ROOT, path, http, mkPool, CAT, require, BD, BUY, TY, '서울특별시 가짜구 집로 1', '1318님 - 개인결제창', fs, '2026-11-01', { get p() { return port; }, set p(v) { port = v; } });
        const A = await mk([{ ch: 'naver', pid: '2026110100000001', qty: 2, opt: TY }]);
        try {
            const sv = await A.call('POST', '/api/order-memo', { raw: '시험', rows: [{ kind: 'line', key: BUY, note: '입력o삭제x', plat: '네이버', ship_date: '2026-11-04', sure: true, check_why: [], src: 'edit', line: ['11/4', BUY, '입력o삭제x', '네이버'].join('\t'), checked: { plat: '네이버', as: 'buyer', at: new Date().toISOString() } }] });
            const rows0 = await A.rows(); if (!rows0.length) console.log('저장 응답', JSON.stringify(sv).slice(0, 400)); const id = rows0.find(x => x.kind === 'line').id;
            ok('줄 저장', sv.s === 200 && !!id, sv);
            await A.db.query(`UPDATE order_memo_rows SET checked = checked || '{"split_sent":"2026-11-02"}'::jsonb WHERE id = $1`, [id]);
            const chk = async () => (await A.db.query(`SELECT checked FROM order_memo_rows WHERE id = $1`, [id])).rows[0].checked;
            // ① 종전 화면이 보내던 꼴(표식 없는 checked) → 서버 이중 막이
            let r = await A.call('PUT', '/api/order-memo/rows/' + id, { key: BUY, note: '입력o삭제x', plat: '네이버', ship_date: '2026-11-04', checked: { plat: '네이버', as: 'buyer', at: new Date().toISOString() } });
            let c = await chk();
            ok('PUT(표식 없는 checked) 뒤에도 split_sent 남음', r.s === 200 && c && c.split_sent === '2026-11-02', { s: r.s, c });
            // ② 찾기 0건 = null 을 보내는 꼴
            r = await A.call('PUT', '/api/order-memo/rows/' + id, { key: BUY, note: '입력o삭제x', plat: '네이버', ship_date: '2026-11-04', checked: null });
            c = await chk();
            ok('PUT(checked null) 뒤에도 split_sent 남음', r.s === 200 && c && c.split_sent === '2026-11-02', { s: r.s, c });
            // ③ 새 화면이 보내는 꼴(표식 포함) = 그대로
            r = await A.call('PUT', '/api/order-memo/rows/' + id, { key: BUY, note: '입력o삭제x', plat: '네이버', ship_date: '2026-11-04', checked: { plat: '네이버', as: 'buyer', at: new Date().toISOString(), split_sent: '2026-11-02' } });
            c = await chk();
            ok('PUT(표식 포함) = 그대로', r.s === 200 && c && c.split_sent === '2026-11-02');
            // ④ 글만 고침(checked 칸 안 보냄) = 종전대로 유지
            r = await A.call('PUT', '/api/order-memo/rows/' + id, { key: BUY, note: '입력o삭제x', plat: '네이버', ship_date: '2026-11-05' });
            c = await chk();
            ok('PUT(checked 칸 없음) = 종전대로 유지', r.s === 200 && c && c.split_sent === '2026-11-02');
            // ⑤ 번호를 바꾸면 표식 버림(다른 주문)
            r = await A.call('PUT', '/api/order-memo/rows/' + id, { key: '010-9999-0000', note: '입력o삭제x', plat: '네이버', ship_date: '2026-11-05', checked: { plat: '네이버', as: 'buyer', at: new Date().toISOString() } });
            c = await chk();
            ok('번호를 바꾸면 split_sent 안 따라감', r.s === 200 && !(c && c.split_sent), { s: r.s, c });
            // 표식 없는 보통 줄 = 구/신 같음(표식이 새로 생기지 않음)
            const sv2 = await A.call('POST', '/api/order-memo', { raw: '시험', rows: [{ kind: 'line', key: '010-2600-0002', note: '입력o삭제x', plat: '네이버', ship_date: '2026-11-04', sure: true, check_why: [], src: 'edit', line: ['11/4', '010-2600-0002', '입력o삭제x', '네이버'].join('\t'), checked: { plat: '네이버', as: 'buyer', at: new Date().toISOString() } }] });
            const id2 = (await A.rows()).filter(x => x.kind === 'line').map(x => x.id).find(x => x !== id);
            r = await A.call('PUT', '/api/order-memo/rows/' + id2, { key: '010-2600-0002', note: '입력o삭제x', plat: '네이버', ship_date: '2026-11-04', checked: null });
            const c2 = (await A.db.query(`SELECT checked FROM order_memo_rows WHERE id = $1`, [id2])).rows[0].checked;
            ok('표식 없는 줄 · checked null = 종전대로 지워짐(null)', sv2.s === 200 && r.s === 200 && c2 === null, c2);
            // #1186-b 없는 날짜 줄 = 「확인」 줄로 저장 → for-ship 에서 held(오늘 줄·nodate 줄에 없음)
            const gl = ['11/31', '010-2600-0003', '입력o삭제x', '네이버'].join('\t');
            const sv3 = await A.call('POST', '/api/order-memo', { raw: '시험', rows: [{ kind: 'line', key: '010-2600-0003', note: '입력o삭제x', plat: '네이버', ship_date: null, src: 'rule', line: gl }] });
            const row3 = (await A.db.query(`SELECT id, sure, check_why, ship_date FROM order_memo_rows WHERE line_key = '010-2600-0003'`)).rows[0];
            const fsG = await A.forShip('2026-11-17');
            ok('메모함: 「11/31⇥번호⇥입력o삭제x」 = 확인 줄(sure false · 「없는 날짜예요」)로 저장', sv3.s === 200 && row3 && row3.sure === false && (row3.check_why || []).some(w => /없는 날짜예요\(11\/31\)/.test(w)), { s: sv3.s, row3 });
            ok('for-ship: 그 줄은 오늘 줄에 없고 held 에 있음(과발송 길 막힘)', !(fsG.lines || []).some(l => String(l.id) === String(row3.id)) && (fsG.held || []).some(h => String(h.id) === String(row3.id)), { lines: (fsG.lines || []).length, held: (fsG.held || []).length });
        } finally { await A.close(); }
    }

    // ── A5 멈춘 sending 복구 ─────────────────────────────────────────────
    console.log('\n■ A5 자동 송장 · 멈춘 sending → unknown');
    {
        const db = new PGlite();
        const arr = new Function(arrSrc + '\nreturn arr;')(), mkPool = new Function('arr', poolSrc + '\nreturn mkPool;')(arr);
        const logs = []; const app = { post() { }, get() { } };
        const api = IA(app, { pool: mkPool(db), authMiddleware: (q, s, n) => n(), adminOnly: (q, s, n) => n(), writeAudit: async () => { }, adminActor: () => ({}), ExcelJS: {}, lois: {}, fetchers: {}, kstToday: () => '2026-11-17', log: { error: (...a) => logs.push(a.join(' ')), warn() { }, info() { }, log() { } }, cfgGet: async () => null, transport: {} });
        await api.initDB();
        await db.query(`INSERT INTO invoice_auto_items (idem_key, run_id, channel, order_key, tracking, state, updated_at) VALUES
            ('naver:OLD', 1, 'naver', 'OLD', '111', 'sending', now() - interval '11 minutes'),
            ('naver:NEW', 1, 'naver', 'NEW', '222', 'sending', now() - interval '3 minutes'),
            ('naver:SENT', 1, 'naver', 'SENT', '333', 'sent', now() - interval '1 day'),
            ('naver:RDY', 1, 'naver', 'RDY', '444', 'ready', now() - interval '1 day')`);
        await api.initDB();   // 기동 복구(두 번째 호출 = 재시작 흉내)
        const st = Object.fromEntries((await db.query(`SELECT order_key, state, error_text FROM invoice_auto_items`)).rows.map(x => [x.order_key, x]));
        ok('11분 된 sending → unknown(「채널 화면에서 확인」 사유)', st.OLD.state === 'unknown' && /채널 화면에서/.test(st.OLD.error_text || ''), st.OLD);
        ok('3분 된 sending = 그대로(지금 보내는 중일 수 있음 = 이중 전송 막이 유지)', st.NEW.state === 'sending');
        ok('sent·ready 는 안 건드림', st.SENT.state === 'sent' && st.RDY.state === 'ready');
        ok('unknown 은 여전히 「이미 등록」 묶음(다시 안 보냄)', /const BLOCK_STATES = \['sent', 'sending', 'unknown'\];/.test(IAS));
        ok('준비 저장 앞에서도 한 번(healSending) · 화면은 앞 실행 모름 줄을 따로 보임', /await healSending\(\);   \/\/ #1186 멈춘 sending/.test(IAS) && /앞 실행에서 결과를 모르는 줄/.test(FO) && /it\.state === 'already' && \/\^\(unknown\|sending\)\$\/\.test\(it\.prev_state/.test(FO));
        await db.close();
    }

    // ── A6 발송일 읽기 · 쿠팡 판정 ───────────────────────────────────────
    console.log('\n■ A6 자동 송장 발송일 · 쿠팡 상자 판정');
    {
        const f = IA.fileShipDate, T = '2026-11-17';
        ok('「11.17(효돈).xlsx」 = 11/17(종전과 같음)', f('11.17(효돈).xlsx', T) === '2026-11-17');
        ok('「하우스 2.5kg 11.17(효돈)」 = 2.5 를 날짜로 안 읽고 11/17', f('하우스 2.5kg 11.17(효돈).xlsx', T) === '2026-11-17');
        ok('「2026.11.17(효돈)」 = 11/17', f('2026.11.17(효돈).xlsx', T) === '2026-11-17');
        ok('날짜 없는 이름(CJ 기본 이름) = null(→ 오늘 · 화면에 「오늘로」 표시)', f('파일접수 상세내역_20261117.xlsx', T) === null);
        ok('없는 월·일(0.5 · 26.11 · 11.31) = null(종전 = DB 500)', f('0.5 시험.xlsx', T) === null && f('26.11 시험.xlsx', T) === null && f('11.31(효돈).xlsx', T) === null);
        ok('1월에 올린 12.31 파일 = 작년 12/31', f('12.31(효돈).xlsx', '2027-01-01') === '2026-12-31');
        ok('「11.17 개별발송」·「11.17 과수지정」·「11.17 박스별」 = 날짜로 읽음(단위 낱말 뒤에 글자가 이어지면 단위 아님) · 「2.5 박스 11.17」 = 11/17', f('11.17 개별발송.xlsx', T) === '2026-11-17' && f('11.17 과수지정.xlsx', T) === '2026-11-17' && f('11.17 박스별(효돈).xlsx', T) === '2026-11-17' && f('2.5 박스 11.17.xlsx', T) === '2026-11-17' && f('3.5키로 11.18.xlsx', T) === '2026-11-18');
        ok('realDay = 달력에 있는 날만', IA.realDay('2026-11-17') && !IA.realDay('2026-11-31') && !IA.realDay('2026-13-01') && !IA.realDay('x'));
        ok('화면이 고른 발송일을 서버로 보냄(ship_date) · 서버가 달력에 없는 날 거름', /pickedDate \? \{ ship_date: pickedDate \} : \{\}/.test(FO) && /발송일이 달력에 없는 날짜예요/.test(IAS));
        ok('표식 없음 = 주황 「최종발주 표식 없음 · 날짜 확인」', /r\.marks && r\.marks\.source === 'none' \? `<p class="fo-hint fo-ia-warn"/.test(FO));
        ok('브라우저가 붙인 「(1)」은 거래처 이름으로 안 씀', /find\(x => x && !\/\^\\d\+\$\/\.test\(x\)\)/.test(IAS));
        // 쿠팡: 실코드 블록
        const blk = cut(IAS, '            const byBox = new Map(); (dd.responseList || [])', '\n            }\n');
        const run = list => { const out = new Map(); new Function('dd', 'chunk', 'out', 'err', 'errCls', 'errMsg', blk)({ responseList: list }, [{ box_id: '1', key: 'coupang:1' }, { box_id: '2', key: 'coupang:2' }, { box_id: '3', key: 'coupang:3' }], out, null, () => 'unknown', () => ''); return Object.fromEntries([...out].map(([k, v]) => [k, v.state])); };
        const one = run([{ shipmentBoxId: 1, succeed: true }, { shipmentBoxId: 2, succeed: false, resultCode: 'X' }]);
        ok('상자당 한 줄(문서 꼴) = 종전과 같음(성공 sent · 실패 failed · 없음 unknown)', one['coupang:1'] === 'sent' && one['coupang:2'] === 'failed' && one['coupang:3'] === 'unknown', one);
        const multi = run([{ shipmentBoxId: 1, succeed: false, resultCode: 'X' }, { shipmentBoxId: 1, succeed: true }, { shipmentBoxId: 2, succeed: true }, { shipmentBoxId: 2, succeed: true }, { shipmentBoxId: 3, succeed: true }, { shipmentBoxId: 3, succeed: false, resultCode: 'Y' }]);
        ok('한 상자 여러 줄 = 전부 성공일 때만 sent(앞 실패·뒤 성공 = failed · 종전은 sent)', multi['coupang:1'] === 'failed' && multi['coupang:2'] === 'sent' && multi['coupang:3'] === 'failed', multi);
    }

    // ── A10 지난 날짜 알약 ───────────────────────────────────────────────
    console.log('\n■ A10 메모함 지난 날짜 현금 줄 알약');
    {
        const src = cut(AOM, '    const isLater = r =>', '\n') + cut(AOM, '    const isPast = r =>', '\n') + cut(AOM, '    function pillOf(r) {', '\n    }\n');
        const mkPill = ship => new Function('OM', 'isCheck', 'blanksOf', 'md', 'mdw', 'isBoxRow', src + '\nreturn { pillOf, isPast };')({ shipDate: ship }, r => r.sure === false, () => [], d => +d.slice(5, 7) + '/' + +d.slice(8, 10), d => d, x => !!x && x.kind === 'line' && /^박스별(?:\s|$)/.test(String(x.note || '')));
        const P = mkPill('2026-11-18');
        const cash = (d, x) => Object.assign({ kind: 'cash', state: 'open', sure: true, ship_date: d }, x || {});
        ok('발송일이 다음 발주보다 앞인 현금 줄 = 「지난 날짜 · 안 들어감」', P.pillOf(cash('2026-11-17')).k === 'past' && /지난 날짜/.test(P.pillOf(cash('2026-11-17')).t));
        ok('오늘 발송·날짜 없음·뒤 날짜 = 종전 알약 그대로', P.pillOf(cash('2026-11-18')).k === 'today' && P.pillOf(cash(null)).k === 'next' && P.pillOf(cash('2026-11-20')).k === 'later');
        ok('확인 줄은 확인이 먼저', P.pillOf(cash('2026-11-17', { sure: false })).k === 'check');
        ok('메모 줄(현금 아님)은 이 알약 안 붙음(서버 for-ship 이 빼는 것은 현금·주소 줄)', P.pillOf({ kind: 'line', state: 'open', sure: true, ship_date: '2026-11-17' }).k !== 'past');
        ok('지난 날짜 박스별 줄(서버가 「지난 날짜예요」로 빼는 줄)도 같은 알약', P.pillOf({ kind: 'line', state: 'open', sure: true, ship_date: '2026-11-17', note: '박스별 1:2S 2:M', boxes: [{ t: '2S' }, { t: 'M' }] }).k === 'past' && P.pillOf({ kind: 'line', state: 'open', sure: true, ship_date: '2026-11-18', note: '박스별 1:2S', boxes: [{ t: '2S' }] }).k !== 'past');
        ok('요약 셈 = 지난 날짜 줄을 「들어가요」에서 빼고 따로 · 현금 줄 표 안내', /!isLater\(r\) && !isPast\(r\)\)/.test(AOM) && /지난 날짜 \$\{nPast\}줄은 안 들어가요/.test(AOM) && /지난 날짜 \$\{nPastC\}줄은 안 들어가요/.test(AOM));
        ok('서버 판정과 같은 조건(order-memo.js = 날짜 지남 → held 「지난 날짜예요」)', /else held\.push\(\{ id: r\.id, kind: 'cash', why: \['지난 날짜예요'\] \}\);/.test(rd('order-memo.js')));
    }

    // ── A11 자동 고쳐 쓰기 = 그사이 친 줄 안 덮음 ────────────────────────
    console.log('\n■ A11 자동 고쳐 쓰기(lineFixAuto) 적용부');
    {
        const blk = cut(FO, "            const curLines = String(E.ta.value || '').split('\\n'), usedAt = new Set(); let lost = 0;", "            E.ta.value = curLines.join('\\n');");
        const run = (now, targets, out) => { const E = { ta: { value: now } }, st = {}, notes = []; let ret = 'applied';
            try { new Function('E', 'out', 'targets', 'st', 'syncInput', 'memoNote', blk.replace("', true); return; }", "', true); throw 'RET'; }"))(E, out, targets, st, () => { }, (t) => notes.push(t)); } catch (e) { if (e !== 'RET') throw e; ret = 'skipped'; }
            return { v: E.ta.value, ret, notes, fix: st.lineFix }; };
        const T = [{ i: 1, raw: '11/20 01012345678 입삭' }];
        let r = run('11/18 010-1111-2222 입력o삭제x\n11/20 01012345678 입삭', T, [{ i: 1, fixed: '11/20\t010-1234-5678\t입력o삭제x' }]);
        ok('메모 칸이 그대로면 종전과 같은 결과(그 줄만 바뀜)', r.v === '11/18 010-1111-2222 입력o삭제x\n11/20\t010-1234-5678\t입력o삭제x' && r.ret === 'applied');
        r = run('11/18 010-1111-2222 입력o삭제x\n11/20 01012345678 입삭\n11/19 010-7777-8888 입력o삭제x', T, [{ i: 1, fixed: '11/20\t010-1234-5678\t입력o삭제x' }]);
        ok('기다리는 동안 아래에 새로 친 줄이 남음(종전 = 사라짐)', r.v.split('\n').length === 3 && r.v.endsWith('11/19 010-7777-8888 입력o삭제x') && r.v.includes('11/20\t010-1234-5678'), r.v);
        r = run('새로 넣은 맨 윗줄\n11/18 010-1111-2222 입력o삭제x\n11/20 01012345678 입삭', T, [{ i: 1, fixed: '11/20\t010-1234-5678\t입력o삭제x' }]);
        ok('위에 줄을 끼워 넣어 자리가 밀려도 원문 줄을 찾아 그 줄만 바꿈', r.v === '새로 넣은 맨 윗줄\n11/18 010-1111-2222 입력o삭제x\n11/20\t010-1234-5678\t입력o삭제x', r.v);
        r = run('11/18 010-1111-2222 입력o삭제x\n11/21 010-1234-5678 입력o삭제x', T, [{ i: 1, fixed: '11/20\t010-1234-5678\t입력o삭제x' }]);
        ok('그 줄을 사람이 직접 고쳤으면 안 덮고 안내만', r.ret === 'skipped' && r.v === '11/18 010-1111-2222 입력o삭제x\n11/21 010-1234-5678 입력o삭제x' && /넣지 않았어요/.test(r.notes.join()), r);
        ok('판정을 못 돌린 때 = 「다시 판정했어요」 대신 낡음 표시', /지금은 다른 작업 중이라 판정을 못 했어요/.test(FO) && /markStale\(\); return; \}\n            memoNote\(`클코가 \$\{nFix\}줄을 틀로 고쳐 썼어요 — 다시 판정했어요\.`\);/.test(FO));
    }

    // ── 그 밖(글자 확인) ─────────────────────────────────────────────────
    console.log('\n■ #1186-b 없는 날짜(11/31 · 2/30 · 30일 달의 31일) = 오늘 발송으로 읽지 않음');
    {
        const core = require(path.join(ROOT, 'public', 'final-order-core.js')), T = '2026-11-17', opt = { realToday: T, shipDate: T, shipDays: [T] };
        const pl = l => { const r = core.prepLines(l, opt); return { out: r.v2Text, types: r.notes.map(n => n.type), detail: (r.notes[0] || {}).detail || '' }; };
        for (const l of ['11/31\t01012345678\t입력o삭제x\t네이버', '11/31 01012345678 입력삭제', '01012345678 11/31 개별발송', '01012345678\t11/31 개별발송', '31일 01012345678 입력o삭제x', '2/30 01012345678 입력o삭제x']) {
            const x = pl(l);
            ok('최종발주: 「' + l.replace(/\t/g, '⇥') + '」 = line-baddate · 기준일(11/17)로 안 찍힘', x.types.includes('line-baddate') && !x.types.includes('indiv-today') && !/^11\/17[\s\t]/.test(x.out) && /달력에 없는 날짜/.test(x.detail), x);
        }
        let x = pl('01012345678 개별발송'); ok('날짜 없는 개별발송 줄 = 종전대로 기준일(indiv-today)', x.types.join() === 'indiv-today' && x.out.startsWith('11/17 '), x);
        x = pl('11/30\t01012345678\t입력o삭제x\t네이버'); ok('있는 날짜 줄 = 무변(안내 0)', x.types.length === 0 && x.out === '11/30\t01012345678\t입력o삭제x\t네이버', x);
        x = pl('01012345678 2.5kg 개별발송'); ok('「2.5kg」·전화번호·수량은 없는 날짜로 안 잡힘', !x.types.includes('line-baddate') && core.ghostDate('010-1234-5678', T) === null && core.ghostDate('2.5kg', T) === null && core.ghostDate('30박스', T) === null && core.ghostDate('12/31', T) === null, x);
        ok('ghostDate = 11/31 · 31일(11월) · 2/29(평년) 만 잡고 13/31·0/5 는 안 잡음', core.ghostDate('11/31', T) === '11/31' && core.ghostDate('31일', T) === '11/31' && core.ghostDate('2/29', T) === '2/29' && core.ghostDate('13/31', T) === null && core.ghostDate('0/5', T) === null && core.ghostDate('2028-02-29', '2028-02-01') === null);
        ok('화면: 없는 날짜 = 메모 줄 표시(확인 필요) + 단추 없는 카드(줄을 고쳐야 파일 만들기)', /'indiv-nodate', 'line-baddate'\]\.includes\(x\.type\)/.test(FO) && /n\.type === 'line-baddate'\) cards\.push\(\{ id: 'lbaddate:'/.test(FO) && /choices: \[\] \}\);   \/\* #1186-b/.test(FO));
        // 메모함 서버 순수 판정
        const cl = (line, extra) => OM.checkLine(Object.assign({ kind: 'line', key: '010-1234-5678', note: '입력o삭제x', plat: '네이버', ship_date: null, src: 'rule', line }, extra || {}), T, true);
        let c = cl('11/31\t010-1234-5678\t입력o삭제x\t네이버'); ok('메모함 checkLine: 탭 줄 11/31 = sure false · 「없는 날짜예요(11/31)」', c.sure === false && c.check_why.some(w => /없는 날짜예요\(11\/31\)/.test(w)), c);
        c = cl('010-1234-5678 11/31 입력o삭제x', { note: '11/31 입력o삭제x' }); ok('메모함 checkLine: 비고 안 11/31 도 같음', c.sure === false && c.check_why.some(w => /없는 날짜예요/.test(w)), c);
        c = cl('', { ship_date: '2026-11-31', src: 'edit' }); ok('메모함 checkLine: 받은 발송일 값이 2026-11-31 = 확인 줄(종전 = 조용히 날짜 없는 줄)', c.sure === false && c.ship_date === null && c.check_why.some(w => /없는 날짜예요\(2026-11-31\)/.test(w)), c);
        c = cl('11/30\t010-1234-5678\t입력o삭제x\t네이버', { ship_date: '2026-11-30' }); ok('메모함 checkLine: 있는 날짜 줄 = 종전대로 sure true', c.sure === true && c.ship_date === '2026-11-30' && !c.check_why.length, c);
        c = cl('010-1234-5678 입력o삭제x'); ok('메모함 checkLine: 날짜 없는 입력삭제 줄 = 종전대로 sure true', c.sure === true && !c.check_why.length, c);
        const cells = ['홍길동 드림', '010-1000-2000', '제주시 가짜로 1', '가받는', '황금향 선물용 - 3kg', '1', '010-3000-0001', '', '부산광역시 가짜구 가짜로 1', '', '010-1000-2000', '', ''];
        const k1 = OM.checkCash({ kind: 'cash', cells, ship_date: '2026-11-31' }, T, null, ''), k2 = OM.checkCash({ kind: 'cash', cells, ship_date: '2026-11-30' }, T, null, ''), k3 = OM.checkCash({ kind: 'cash', cells, ship_date: null }, T, null, '');
        ok('메모함 checkCash: 주소 줄 발송일 2026-11-31 = 확인 줄 · 11/30·날짜 없음 = 「없는 날짜」 안 붙음', k1.sure === false && k1.check_why.some(w => /없는 날짜예요/.test(w)) && !k2.check_why.some(w => /없는 날짜/.test(w)) && !k3.check_why.some(w => /없는 날짜/.test(w)), { k1: k1.check_why, k2: k2.check_why, k3: k3.check_why });
    }

    console.log('\n■ 그 밖');
    ok('A4 [등록] 뒤 고르기 = 준비 무효(다시 [등록]) · 보낸 뒤 = 되돌림', /if \(ia\.reg\) \{ ia\.reg = null; redo = true;/.test(FO) && /ia\.busy \|\| ia\.sent \|\| \(ia\.reg && ia\.reg\.dry === false\)\) \{ const cur = ia\.picks\.get\(id\); sel\.value = cur == null \? '' : cur;/.test(FO));
    ok('for-ship 실패 = 빨간 띠 + [다시 시도](조용히 「받은 것」 처리 안 함)', /omFail = !\(e && e\.status === 404\)/.test(FO) && /발주 메모함을 불러오지 못했어요<\/b>/.test(FO));
    ok('AI 일부만 읽음 = 「m건 중 n건」 + 못 읽은 메모 카드', /A\.partial = n < A\.items\.length;/.test(FO) && /\(st\.ai\.failed \|\| st\.ai\.partial\) && !st\.ai\.running/.test(FO) && /건 중 \$\{A\.count\}건만 읽었어요/.test(FO));
    ok('[파일 빼기] = 메모함 현금 줄 남김 또는 띠 + [다시 넣기]', /omCashAfter\(g, true\)/.test(FO) && /data-om=\\?"cashback\\?"/.test(FO));
    ok('[바꾸기]·줄 합치기 = 지우기 결과 확인', /옛 줄 \$\{dropFail\}개가 남았어요/.test(AOM) && /주문번호 줄 \$\{left\}개가 남았어요/.test(AOM));
    ok('저장이 막혀 돌아갈 때 _saving 풀림(3곳)', (AOM.match(/c\._saving = false; (\/\* #1186[^*]*\*\/ )?toast\('(주문자\(구매자\) 번호를|번호 확인 중이에요)/g) || []).length === 2 && /if \(bad >= 0\) \{\n            c\._saving = false;/.test(AOM));
    ok('창구 답 도착 = 치는 중이면 다시 그리기 미룸', /if \(cardTyping\(\)\) \{ toast\('창구 정리가 끝났어요/.test(AOM));
    ok('결과 팝업 = dvh 안 씀', !/max-height: calc\(100dvh/.test(rd('public/final-order.css')));
    console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); setTimeout(() => process.exit(fail ? 1 : 0), 200);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
