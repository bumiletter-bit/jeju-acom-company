// #1121 중간발주 qtyBuild — 오늘 입력삭제 주문 = 주문 수량 대신 그날 주소 줄 박스로 셈
//   실코드(public/ao-desk.js 「#860 순수 도우미 시작」 ~ qtyBuild 끝)를 떼어 가짜 자료로 실행 · DB·서버·네트워크 0 · 쓰기 0
//   비교 기준(종전) = 인자 1 로 준 옛 파일(기본 = git HEAD 의 ao-desk.js)
//   사용: node scripts/verify-1121-qty.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'public/final-order-core.js'));
const NEW_SRC = fs.readFileSync(path.join(ROOT, 'public/ao-desk.js'), 'utf8');
const OLD_SRC = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : cp.execSync('git show HEAD:public/ao-desk.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

function cut(src) {
    const a = src.indexOf('    const QTY_PH = new Set('); const b = src.indexOf('    function qtyOpen() {');
    if (a < 0 || b < 0 || b < a) throw new Error('떼어낼 구간을 못 찾음');
    const qs = src.match(/^    const QTY_SIZE = .*$/m); if (!qs) throw new Error('QTY_SIZE 를 못 찾음');
    return qs[0] + '\n' + src.slice(a, b);
}
// 단가표 · 이름 매칭 가짜(실 matchProduct 는 app.js 전역 — 여기선 옵션 글자 → 단가표 이름 표)
const PRICING = { 효돈: ['타이벡감귤 선물용 - 3kg', '타이벡감귤 가정용 - 5kg(로얄과)'], 대성: ['황금향 선물용 - 3kg'] };
const MATCH = { '타이벡 선물 3kg': '타이벡감귤 선물용 - 3kg', '타이벡 가정 5kg': '타이벡감귤 가정용 - 5kg(로얄과)', '황금향 선물 3kg': '황금향 선물용 - 3kg' };
function run(src, input) {
    const ctx = {
        window: { FinalOrderCore: core }, console,
        QTY: { src: input.src, om: input.om || null, cash: input.cash || null },
        addSizeSuffix: (o) => o,
        matchProduct: (o) => MATCH[o] || ('[미매칭] ' + o),
        qtyCategory: () => 'c', aoItemPartner: (n) => { for (const [p, a] of Object.entries(PRICING)) if (a.includes(n)) return p; return null; },
        aoInvoicePricingByPartner: PRICING,
    };
    vm.createContext(ctx);
    vm.runInContext(cut(src) + '\n;globalThis.__r = qtyBuild(); globalThis.__m = typeof qtyEmptyMsg === "function" ? qtyEmptyMsg(QTY.stat) : null;', ctx);
    return { ok: ctx.__r, base: ctx.QTY.base, stat: ctx.QTY.stat, msg: ctx.__m };
}
const H = core.HEADERS.slice();
const addr = (k, opt, qty, bang) => [(bang ? '! ' : '') + '아꼼', k, '', '받는분', opt, String(qty), '010-1111-2222', '', '제주시 어딘가 1', '', k, '', ''];
const nv = (rows) => ({ nv: { ok: true, rows }, cp: { ok: true, rows: [] }, cf: { ok: true, rows: [] } });
const nvRow = (tel, opt, qty, pid) => ({ 구매자연락처: tel, 옵션정보: opt, 배송메세지: '', 수량: String(qty), 수취인명: '김손님', _pid: pid || 'P' + tel + opt });
const cfRow = (tel, opt, qty) => ({ '주문자 휴대전화': tel, '주문상품명(세트상품 포함)': opt, 배송메시지: '', 수량: String(qty), 수령인: '이손님', 주문번호: '20261111-0008480' });
const om = (date, lines, cashRows) => ({ ok: true, date, lines, cash_aoa: cashRows && cashRows.length ? [H].concat(cashRows) : [] });
const L = (state, line, sd) => ({ state, line, ship_date: sd || null });

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } }
const qtyOf = (r, name) => ((r.base && r.base.items) || []).filter(i => i.name === name).reduce((s, i) => s + i.qty, 0);
const unm = (r) => ((r.base && r.base.urows) || []).map(u => u.name + ' ' + u.qty);

// ── A. 입력삭제 오늘 줄이 없는 날 = 종전과 바이트 동일(QTY.base · stat 의 종전 칸) ──
const T1 = '01012345678', T2 = '01098765432', T3 = '01055556666';
const same = [
    ['메모함 없음', { src: nv([nvRow(T1, '타이벡 선물 3kg', 2), nvRow(T2, '황금향 선물 3kg', 1)]) }],
    ['메모함 빈 날', { src: nv([nvRow(T1, '타이벡 선물 3kg', 2)]), om: om('2026-11-12', [], []) }],
    ['뒤 날짜 입력삭제(보통 날짜 지정)', { src: nv([nvRow(T1, '타이벡 선물 3kg', 63), nvRow(T2, '황금향 선물 3kg', 1)]), om: om('2026-11-12', [L('wait', `11/15\t${T1}\t입력o삭제x\t네이버`, '2026-11-15')], []) }],
    ['뒤 날짜 입력삭제 + 날짜 없는 주소 3', { src: nv([nvRow(T1, '타이벡 선물 3kg', 63)]), om: om('2026-11-12', [L('wait', `11/15\t${T1}\t입력o삭제x\t네이버`, '2026-11-15')], [addr(T1, '타이벡감귤 선물용 - 3kg', 3)]) }],
    ['「!」 현금 줄만', { src: nv([nvRow(T1, '타이벡 선물 3kg', 2)]), om: om('2026-11-12', [], [addr(T3, '황금향 선물용 - 3kg', 4, true), addr(T1, '타이벡감귤 선물용 - 3kg', 2, true)]) }],
    ['오늘 일반 줄(입력삭제 아님) + 주소 줄', { src: nv([nvRow(T1, '타이벡 선물 3kg', 5)]), om: om('2026-11-12', [L('today', `11/12\t${T1}\t메모무시\t네이버`, '2026-11-12')], [addr(T1, '타이벡감귤 선물용 - 3kg', 5)]) }],
    ['오늘 입력삭제인데 주소 줄 없음(종전대로 주문 수량)', { src: nv([nvRow(T1, '타이벡 선물 3kg', 4)]), om: om('2026-11-12', [L('today', `11/12\t${T1}\t입력o삭제x\t네이버`, '2026-11-12')], []) }],
    ['오늘 입력삭제 「n건 중」 부분(확인 몫 = 종전)', { src: nv([nvRow(T1, '타이벡 선물 3kg', 4)]), om: om('2026-11-12', [L('today', `11/12\t${T1}\t입력o삭제x 2건 중\t네이버`, '2026-11-12')], [addr(T1, '타이벡감귤 선물용 - 3kg', 4)]) }],
    ['주소 줄 번호가 다른 사람(종전)', { src: nv([nvRow(T1, '타이벡 선물 3kg', 4)]), om: om('2026-11-12', [L('today', `11/12\t${T2}\t입력o삭제x\t네이버`, '2026-11-12')], [addr(T2, '타이벡감귤 선물용 - 3kg', 1)]) }],
];
for (const [name, inp] of same) {
    const o = run(OLD_SRC, inp), n = run(NEW_SRC, inp);
    const ns = Object.assign({}, n.stat); const extra = { indiv: ns.indiv, indivQty: ns.indivQty }; delete ns.indiv; delete ns.indivQty;
    ok('A 종전 동일 · ' + name, o.ok === n.ok && eq(o.base, n.base) && eq(o.stat, ns) && extra.indiv === 0 && extra.indivQty === 0, { old: o.base, neu: n.base, stat: [o.stat, n.stat] });
}

// ── B. 8480 꼴(자사몰 개인결제창 1건 · 3박스 첫날 · 60박스 11/15) ──
const K8 = '01033331318', OPT8 = '1318님 - 개인결제창', IT = '타이벡감귤 선물용 - 3kg';
const cf8 = () => ({ nv: { ok: true, rows: [] }, cp: { ok: true, rows: [] }, cf: { ok: true, rows: [cfRow(K8, OPT8, 1)] } });
// 첫날 11/12 · 워커1 새 for-ship = 입력삭제 줄을 오늘로 내보냄 + 오늘 주소 3 (60 은 waiting = cash_aoa 밖)
let r = run(NEW_SRC, { src: cf8(), om: om('2026-11-12', [L('today', `11/12\t${K8}\t입력o삭제x\t자사몰`, '2026-11-12')], [addr(K8, IT, 3)]) });
ok('B 첫날(새 for-ship) 3박스', qtyOf(r, IT) === 3, r.base); ok('B 첫날 미매칭 0', unm(r).length === 0, unm(r)); ok('B 첫날 stat indiv 1', r.stat.indiv === 1);
// 첫날 · 종전 for-ship(줄 wait) = 주문 빠짐 + 주소 3 더함 → 3 (새 코드도 같아야)
r = run(NEW_SRC, { src: cf8(), om: om('2026-11-12', [L('wait', `11/15\t${K8}\t입력o삭제x\t자사몰`, '2026-11-15')], [addr(K8, IT, 3)]) });
ok('B 첫날(종전 for-ship) 3박스', qtyOf(r, IT) === 3 && unm(r).length === 0, r.base);
// 11/13·14 = 줄 wait · 주소 없음 → 0
for (const d of ['2026-11-13', '2026-11-14']) { r = run(NEW_SRC, { src: cf8(), om: om(d, [L('wait', `11/15\t${K8}\t입력o삭제x\t자사몰`, '2026-11-15')], []) }); ok('B ' + d + ' 0', !r.ok || (qtyOf(r, IT) === 0 && unm(r).length === 0), r.base); }
// 11/15 = 종전 for-ship(줄 today · 주문 아직 배송준비 · 주소 60) → 종전 = 미매칭 1 · 60 빠짐 / 새 = 60 · 미매칭 0
const in15 = { src: cf8(), om: om('2026-11-15', [L('today', `11/15\t${K8}\t입력o삭제x\t자사몰`, '2026-11-15')], [addr(K8, IT, 60)]) };
const o15 = run(OLD_SRC, in15); r = run(NEW_SRC, in15);
ok('B 11/15 종전은 결함 재현(60 빠짐·미매칭 1)', qtyOf(o15, IT) === 0 && unm(o15).length === 1, o15.base);
ok('B 11/15 새 = 60박스', qtyOf(r, IT) === 60, r.base); ok('B 11/15 미매칭 0', unm(r).length === 0, unm(r));
// 11/15 · 새 for-ship(첫날 발송처리 끝 = 줄 빠짐 · 주문 목록에 없음) → 주소 60 종전대로
r = run(NEW_SRC, { src: { nv: { ok: true, rows: [] }, cp: { ok: true, rows: [] }, cf: { ok: true, rows: [] } }, om: om('2026-11-15', [], [addr(K8, IT, 60)]) });
ok('B 11/15(새 for-ship · 주문 없음) 60', qtyOf(r, IT) === 60 && unm(r).length === 0, r.base);

// ── C. 네이버 주문 1건 63박스 ──
const KN = '01077778888', OPN = '타이벡 선물 3kg';
// A꼴 11/15 (종전 for-ship · 주문 배송준비 · 줄 today · 주소 60) → 종전 63 / 새 60
const inA = { src: nv([nvRow(KN, OPN, 63), nvRow(T2, '황금향 선물 3kg', 2)]), om: om('2026-11-15', [L('today', `11/15\t${KN}\t입력o삭제x\t네이버`, '2026-11-15')], [addr(KN, IT, 60)]) };
const oA = run(OLD_SRC, inA); r = run(NEW_SRC, inA);
ok('C A꼴 11/15 종전 63', qtyOf(oA, IT) === 63, oA.base); ok('C A꼴 11/15 새 60', qtyOf(r, IT) === 60, r.base);
ok('C A꼴 다른 주문(황금향 2) 그대로', qtyOf(r, '황금향 선물용 - 3kg') === 2 && qtyOf(oA, '황금향 선물용 - 3kg') === 2);
// A꼴 첫날 (새 for-ship = 줄 오늘 · 주소 3) → 3
r = run(NEW_SRC, { src: nv([nvRow(KN, OPN, 63)]), om: om('2026-11-12', [L('today', `11/12\t${KN}\t입력o삭제x\t네이버`, '2026-11-12')], [addr(KN, IT, 3)]) });
ok('C A꼴 첫날 3', qtyOf(r, IT) === 3 && unm(r).length === 0, r.base);
// B꼴 첫날 (줄 오늘 · 주소 일부 오늘 3 + 나머지 뒤 날짜 = cash_aoa 밖) → 종전 63 / 새 3
const inB = { src: nv([nvRow(KN, OPN, 63)]), om: om('2026-11-12', [L('today', `11/12\t${KN}\t입력o삭제x\t네이버`, '2026-11-12')], [addr(KN, IT, 1), addr(KN, IT, 2)]) };
ok('C B꼴 첫날 종전 63', qtyOf(run(OLD_SRC, inB), IT) === 63); r = run(NEW_SRC, inB); ok('C B꼴 첫날 새 3', qtyOf(r, IT) === 3, r.base);
// B꼴 뒤 날짜 (주문 이미 발송 = 목록 없음 · 주소 60) → 60 (종전 = 새)
const inB2 = { src: nv([nvRow(T2, '황금향 선물 3kg', 1)]), om: om('2026-11-15', [], [addr(KN, IT, 60)]) };
ok('C B꼴 뒤 날짜 60 · 종전 동일', qtyOf(run(NEW_SRC, inB2), IT) === 60 && eq(run(OLD_SRC, inB2).base, run(NEW_SRC, inB2).base));
// 같은 번호 일반 주문이 하나 더(같은 구매자 · 전화번호 키 줄은 v2 에서도 두 주문 다 입력삭제) → 두 주문 다 주소 줄로
r = run(NEW_SRC, { src: nv([nvRow(KN, OPN, 63, 'P1'), nvRow(KN, '황금향 선물 3kg', 1, 'P2')]), om: om('2026-11-15', [L('today', `11/15\t${KN}\t입력o삭제x\t네이버`, '2026-11-15')], [addr(KN, IT, 60), addr(KN, '황금향 선물용 - 3kg', 1)]) });
ok('C 같은 번호 두 주문 = 주소 줄 60+1', qtyOf(r, IT) === 60 && qtyOf(r, '황금향 선물용 - 3kg') === 1, r.base);
// 주문번호 키 줄(#938) · 같은 번호 다른 주문은 뒤 날짜 → 오늘 줄 주문만 주소 줄로 · 다른 주문은 빠짐
r = run(NEW_SRC, { src: nv([nvRow(KN, OPN, 5, '2026111200000001'), nvRow(KN, '황금향 선물 3kg', 2, '2026111200000002')]), om: om('2026-11-12', [L('today', `11/12\t2026111200000001\t입력o삭제x\t네이버`, '2026-11-12'), L('wait', `11/15\t2026111200000002\t입력o삭제x\t네이버`, '2026-11-15')], [addr(KN, IT, 5)]) });
ok('C #938 주문번호 키 = 오늘 5 · 뒤 날짜 주문 빠짐', qtyOf(r, IT) === 5 && qtyOf(r, '황금향 선물용 - 3kg') === 0, r.base);
// 「!」 현금 줄은 종전(늘 더함)
r = run(NEW_SRC, { src: nv([nvRow(KN, OPN, 63)]), om: om('2026-11-15', [L('today', `11/15\t${KN}\t입력o삭제x\t네이버`, '2026-11-15')], [addr(KN, IT, 60), addr(T3, '황금향 선물용 - 3kg', 4, true)]) });
ok('C 「!」 현금 4 더함', qtyOf(r, '황금향 선물용 - 3kg') === 4 && qtyOf(r, IT) === 60, r.base);
// 쿠팡 같은 규칙
r = run(NEW_SRC, { src: { nv: { ok: true, rows: [] }, cf: { ok: true, rows: [] }, cp: { ok: true, rows: [{ 구매자전화번호: KN, '노출상품명(옵션명)': OPN, 배송메세지: '', '구매수(수량)': '10', 수취인이름: '박손님' }] } }, om: om('2026-11-12', [L('today', `11/12\t${KN}\t입력o삭제x\t쿠팡`, '2026-11-12')], [addr(KN, IT, 4)]) });
ok('C 쿠팡 오늘 입력삭제 = 주소 4', qtyOf(r, IT) === 4, r.base);
// 다른 채널 같은 번호 줄은 안 걸림(줄 채널 = 네이버 · 주문 = 쿠팡)
r = run(NEW_SRC, { src: { nv: { ok: true, rows: [] }, cf: { ok: true, rows: [] }, cp: { ok: true, rows: [{ 구매자전화번호: KN, '노출상품명(옵션명)': OPN, 배송메세지: '', '구매수(수량)': '10', 수취인이름: '박손님' }] } }, om: om('2026-11-12', [L('today', `11/12\t${KN}\t입력o삭제x\t네이버`, '2026-11-12')], [addr(KN, IT, 4)]) });
ok('C 채널 다른 줄 = 종전(쿠팡 주문 10 · 주소 줄 안 더함)', qtyOf(r, IT) === 10, r.base);

// ── D. 서버 split 칸(워커1 for-ship) ──
const Ls = (line, k) => ({ state: 'today', line, ship_date: '2026-11-12', split: { k, today: 3, later: 60, later_date: '2026-11-15', later_items: [], orig_date: '2026-11-15' } });
r = run(NEW_SRC, { src: nv([nvRow(KN, OPN, 63)]), om: om('2026-11-12', [Ls(`11/12\t${KN}\t입력o삭제x\t네이버`, KN)], [addr(KN, IT, 3)]) });
ok('D split 줄 + 오늘 주소 3 = 3', qtyOf(r, IT) === 3 && unm(r).length === 0, r.base);
r = run(NEW_SRC, { src: nv([nvRow(KN, OPN, 63)]), om: om('2026-11-12', [Ls(`11/12\t${KN}\t입력o삭제x\t네이버`, KN)], []) });
ok('D split 줄 + 주소 줄 0(손으로 지움) = 63 안 셈', qtyOf(r, IT) === 0 && r.stat.indiv === 1, r.base);
r = run(NEW_SRC, { src: cf8(), om: om('2026-11-12', [Ls(`11/12\t${K8}\t입력o삭제x\t자사몰`, K8)], []) });
ok('D 개인결제창 split 줄 + 주소 0 = 미매칭 0', unm(r).length === 0, r.base);
// ── E. 빈 결과 안내 ──
r = run(NEW_SRC, { src: nv([nvRow(KN, OPN, 63)]), om: om('2026-11-12', [Ls(`11/12\t${KN}\t입력o삭제x\t네이버`, KN)], []) });
ok('E split 줄만 · 주소 0 = 빈 결과 + 입력삭제 안내', r.ok === false && r.msg === '입력삭제 주문 1건은 주소 줄로 세는데 오늘 주소 줄이 없어요.', r.msg);
r = run(NEW_SRC, { src: nv([nvRow(KN, OPN, 63), nvRow(T2, OPN, 1)]), om: om('2026-11-12', [Ls(`11/12\t${KN}\t입력o삭제x\t네이버`, KN), L('wait', `11/15\t${T2}\t메모무시\t네이버`, '2026-11-15')], []) });
ok('E split + 뒤 날짜 1 = 두 문장', r.ok === false && r.msg === '입력삭제 주문 1건은 주소 줄로 세는데 오늘 주소 줄이 없어요. 나머지 1건은 발주 메모함의 뒤 날짜 줄로 빠졌어요.', r.msg);
r = run(NEW_SRC, { src: nv([nvRow(T2, OPN, 1)]), om: om('2026-11-12', [L('wait', `11/15\t${T2}\t메모무시\t네이버`, '2026-11-15')], []) });
ok('E 종전 글 = 뒤 날짜로 빠짐', r.ok === false && r.msg === '배송준비 주문이 모두 발주 메모함의 뒤 날짜 줄로 빠져 이번에 집계할 것이 없어요.', r.msg);
r = run(NEW_SRC, { src: nv([]) });
ok('E 종전 글 = 주문 없음', r.ok === false && r.msg === '3채널 모두 배송준비 주문이 없어요.', r.msg);
console.log(`verify-1121-qty: ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
