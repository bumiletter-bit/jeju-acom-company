// #1188 검증(최종발주 쪽 · 읽기 실행만) — 메모함에 저장된 「배송메세지」 박스별 줄이 최종발주에서 고른 그 주문에만 실리는지
//   🔴 DB·서버·브라우저 0 — order-memo.js pickForShip(실코드 require) + final-order.js boxPlan 의 주문 맞추기 줄(실코드를 글자로 떼어 실행 · 파일 무접촉)
//   주문 1건 · 2건(1박스+1박스) · 3건(1박스+2박스+1박스 · 판매처 섞임 · 받는 분 다름) · 같은 번호에 사이즈 줄·다른 주문 박스별 줄이 같이 있을 때
//   실행: node scripts/verify-1188-fo.js
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const om = require(path.join(ROOT, 'order-memo.js'));
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ''); } };

// final-order.js 에서 실코드 떼기: 번호 도우미 3줄 + boxPlan 의 「그 줄이 어느 주문인가」 3줄
const FO = fs.readFileSync(path.join(ROOT, 'public', 'final-order.js'), 'utf8').split('\r\n').join('\n').split('\n');
const BP = FO.findIndex(l => l.trim().startsWith('function boxPlan(cards, info) {')); if (BP < 0) throw new Error('boxPlan 못 찾음');
const inBP = start => { const l = FO.slice(BP, BP + 12).filter(x => x.trim().startsWith(start)); if (l.length !== 1) throw new Error('boxPlan 안 줄 못 찾음(' + l.length + '): ' + start); return l[0]; };
const lineOf = start => { const hit = FO.filter(l => l.trim().startsWith(start)); if (hit.length !== 1) throw new Error('떼어 올 줄 못 찾음(' + hit.length + '): ' + start); return hit[0]; };
const SRC = [
    lineOf('const digitsOf = '), lineOf('const buyerTel = '), lineOf('const idsOf = '),
    'function hitOf(m, s) {', "const CH = { '네이버': 'naver', '쿠팡': 'coupang', '자사몰': 'cafe24' };",
    inBP("const key = String(m.key || '').trim(), d = digitsOf(key)"), inBP("const pno = String((m.checked && m.checked.pno) || '').trim()"), inBP('const hit = s.merged.filter(e => (!ch || e.ch === ch)'),
    'return hit; }', 'return { hitOf };',
].join('\n');
const { hitOf } = new Function('rawOf', SRC)(e => e.raw || {});

const TODAY = '2026-11-18', TEL = '010-2696-0000', B0 = () => ({ t: '', o: '', n: '', p: '', p2: '', a: '', m: '', s: '', sn: '', sp: '' });
const order = (id, ch, pno, qty, recv) => ({ id, ch, i: id, conv: { '구매자연락처': TEL, '수취인명': recv, '수량': String(qty) }, raw: { '상품주문번호': pno, '구매자연락처': TEL } });
// 화면이 저장하는 꼴(고객정보수정 박스별 줄 · key = 구매자 번호 · checked.pno = 고른 주문) → 서버 줄 꼴
const boxRow = (id, pno, plat, n, text) => { const boxes = Array.from({ length: n }, () => Object.assign(B0(), { m: text })), note = '박스별 ' + n + '박스 · ' + boxes.map((b, i) => '박스' + (i + 1) + '=그대로(배송메세지 바꿈)').join(' · ');
    return { id, kind: 'line', line_key: TEL, note, plat, line: ['', TEL, note, plat].join('\t'), ship_date: null, sure: true, state: 'open', check_why: [], boxes, checked: { plat, as: 'buyer', at: '2026-11-18T01:00:00.000Z', buyer: TEL, pno } }; };
const plain = (id, key, note) => ({ id, kind: 'line', line_key: key, note, plat: '네이버', line: [key, note, '네이버'].join(' '), ship_date: null, sure: true, state: 'open', check_why: [], checked: { plat: '네이버', as: 'buyer', at: '2026-11-18T01:00:00.000Z' } });
const ids = hit => hit.map(e => e.id).join();
const TEXT = '현관비밀번호 1212';

console.log('1 주문 1건');
{
    const merged = [order(1, 'naver', 'P1', 1, '정받는'), { id: 9, ch: 'naver', i: 9, conv: { '구매자연락처': '010-9999-0000', '수량': '1' }, raw: { '상품주문번호': 'P9' } }];
    const fs1 = om.pickForShip([boxRow(801, 'P1', '네이버', 1, TEXT)], TODAY);
    ok(fs1.box_rows.length === 1 && fs1.box_rows[0].boxes[0].m === TEXT && fs1.box_rows[0].checked.pno === 'P1' && fs1.memo_text === '' && fs1.ship_memos.length === 0, '메모함 → 최종발주: 박스별 줄 1개(배송메세지 글 · 고른 주문 번호) · 메모 칸 글 0', { box: fs1.box_rows, memo: fs1.memo_text });
    ok(ids(hitOf(fs1.box_rows[0], { merged })) === '1', '최종발주가 맞춘 주문 = 그 주문 1건(다른 손님 주문 X)', ids(hitOf(fs1.box_rows[0], { merged })));
}
console.log('2 주문 2건(1박스 + 1박스 · 받는 분 다름)');
{
    const merged = [order(1, 'naver', 'P1', 1, '김하나'), order(2, 'naver', 'P2', 1, '이두리')];
    const fs2 = om.pickForShip([boxRow(802, 'P2', '네이버', 1, TEXT)], TODAY);
    ok(ids(hitOf(fs2.box_rows[0], { merged })) === '2', '둘째 주문을 골라 저장 = 둘째 주문에만 실림(첫째 주문 X)', ids(hitOf(fs2.box_rows[0], { merged })));
    const noPno = Object.assign({}, fs2.box_rows[0], { checked: Object.assign({}, fs2.box_rows[0].checked, { pno: '' }) });
    ok(hitOf(noPno, { merged }).length === 2, '(대조) 고른 주문 번호가 없으면 번호로 2건이 걸림 = 최종발주가 넣지 않고 카드로 물음 → 화면이 pno 를 꼭 저장해야 함', hitOf(noPno, { merged }).length);
}
console.log('3 주문 3건(1박스 + 2박스 + 1박스 · 쿠팡 섞임) · 2건에 차례로 넣음 · 같은 번호 사이즈 줄·다른 손님 박스별 줄 같이');
{
    const merged = [order(1, 'naver', 'P1', 1, '김하나'), order(2, 'naver', 'P2', 2, '이두리'), order(3, 'coupang', 'P3', 1, '박세나')];
    const other = Object.assign(boxRow(805, 'PX', '네이버', 1, '다른 손님 글'), { line_key: '010-7777-0000' });
    const rows = [boxRow(803, 'P2', '네이버', 2, TEXT), boxRow(804, 'P3', '쿠팡', 1, TEXT), plain(806, '010-5555-0000', 'S사이즈로'), other];
    const fs3 = om.pickForShip(rows, TODAY), br = id => fs3.box_rows.find(x => x.id === id);
    ok(fs3.box_rows.length === 3 && br(803).boxes.length === 2 && br(803).boxes.every(b => b.m === TEXT) && br(804).boxes[0].m === TEXT, '박스별 줄 3개가 그대로 나감(2박스 줄 = 박스 둘 다 글)', fs3.box_rows.map(x => [x.id, x.boxes.length]));
    ok(ids(hitOf(br(803), { merged })) === '2' && ids(hitOf(br(804), { merged })) === '3', '둘째 주문 줄 → 둘째 주문만 · 셋째(쿠팡) 줄 → 셋째 주문만 · 첫째 주문엔 아무 줄도 안 걸림', [ids(hitOf(br(803), { merged })), ids(hitOf(br(804), { merged }))]);
    ok(hitOf(br(805), { merged }).length === 0, '다른 손님 박스별 줄 = 이 손님 주문에 안 걸림');
    ok(fs3.memo_text === '010-5555-0000 S사이즈로 네이버' && fs3.lines.length === 1, '같이 있던 사이즈 줄 = 메모 칸에 종전 글 그대로(박스별 줄이 건드리지 않음)', fs3.memo_text);
    ok(br(803).boxes.length === Number(merged[1].conv['수량']) && br(804).boxes.length === Number(merged[2].conv['수량']), '박스 수 = 주문 수량과 같음(다르면 최종발주가 넣지 않고 카드로 알림 · final-order.js boxPlan)');
}
console.log('4 판을 닫아 보통 줄로 남은 경우(종전 동작)');
{
    const fs4 = om.pickForShip([plain(807, TEL, TEXT)], TODAY);
    ok(fs4.box_rows.length === 0 && fs4.memo_text === TEL + ' ' + TEXT + ' 네이버' && fs4.lines[0].state === 'nodate', '보통 줄 = 메모 칸 줄로 들어감(최종발주 「메모 재확인」 카드 길 · 양식 배송메세지엔 저절로 안 실림)', fs4.memo_text);
}
console.log(`\n#1188 최종발주 쪽 검증: ${pass}/${pass + failN} 통과` + (failN ? ` · 실패 ${failN}` : ''));
process.exit(failN ? 1 : 0);
