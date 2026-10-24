// #838-C 가상 시험 — 최종발주 실코드(final-order-core.js 모듈 + invoice-v2.js 순수 함수 떼어 냄)에 가짜 주문·가짜 현금파일·대표 메모 4꼴을 넣어 산출물 확인. 서버·DB·AI·브라우저 0 · 가짜 번호만.
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/전승범/OneDrive/문서/★제주아꼼이네 회사프로그램';
const core = require(path.join(ROOT, 'public/final-order-core.js'));
const v2 = fs.readFileSync(path.join(ROOT, 'public/invoice-v2.js'), 'utf8');
// v2 에서 순수 함수만 떼기(머리 표식 → 다음 「\n    function|const」 전까지 — 중괄호 균형으로)
function grab(startRe) { const m = v2.match(startRe); if (!m) throw new Error('v2 못 찾음 ' + startRe); let i = m.index, depth = 0, started = false; for (let j = i; j < v2.length; j++) { const ch = v2[j]; if (ch === '{') { depth++; started = true; } else if (ch === '}') { depth--; if (started && depth === 0) { let k = j + 1; if (v2[k] === ';') k++; return v2.slice(i, k); } } else if (!started && ch === '\n') { return v2.slice(i, j); } } throw new Error('끝 못 찾음'); }
const v2code = [/const PLACEHOLDER = /, /const isoOf = /, /const rawOf = /, /const telOf = /, /const idsOf = /, /const matchKey = /, /function parseDate\(s, today\)/, /const chOfText = /, /function parseLines\(txt, boxCh, today\)/, /function applyLines\(ctx, force = true\)/].map(r => grab(r)).join('\n');
const V2 = new Function(v2code + '\nreturn { parseLines, applyLines, matchKey, telOf, idsOf };')();

const TODAY = '2026-10-24', SHIP = '2026-10-24';
const CAL = { realToday: TODAY, shipDays: ['2026-10-24', '2026-10-26', '2026-10-27', '2026-10-28'], noShip: ['2026-10-25'], shipDate: SHIP };
// 가짜 주문(네이버 6 · 쿠팡 1 · 자사몰 1) — 번호 전부 010-0000-xxxx
const OPT = { h3s: '아꼼이네 상품선택: 1. 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 3kg(소과)', h5r: '아꼼이네 상품선택: 1. 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 5kg(로얄과)', h25r: '아꼼이네 상품선택: 1. 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(로얄과)', gold3: '아꼼이네 상품선택: 2. 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)' };
const CAT = { 효돈: ['하우스감귤 가정용 - 3kg(소과)', '하우스감귤 가정용 - 5kg(로얄과)', '하우스감귤 가정용 - 2.5kg(로얄과)'], 대성: ['황금향 가정용 - 3kg(중소과 17과 전후)'] };
const catOpt = s => { const m = String(s).match(/상품 및 과수:\s*(.+)$/); return m ? m[1].trim() : String(s); };
const mk = (ch, i, o) => ({ ch, i, conv: { '구매자명': o.b, '구매자연락처': o.bt, '수취인명': o.r, '옵션정보': catOpt(o.opt), '수량': o.q, '수취인연락처1': o.rt, '수취인연락처2': '', '통합배송지': o.ad, '배송메세지': o.memo || '' }, raw: { _pid: o.pid, _orderId: o.oid, '구매자연락처': o.bt, '수취인연락처1': o.rt, '수취인명': o.r } });
const ORDERS = [
    mk('naver', 0, { b: '가A', bt: '010-0000-0001', r: '가A', rt: '010-0000-0001', opt: OPT.h3s, q: 1, ad: '서울 가가구 가가로 1', pid: '2026100000000001', oid: '2026100000001' }),
    mk('naver', 1, { b: '나B', bt: '010-0000-0002', r: '나B', rt: '010-0000-0002', opt: OPT.h5r, q: 4, ad: '부산 나나구 나나로 2', pid: '2026100000000002', oid: '2026100000002', memo: '주소는 따로 보내드렸어요' }),   // ① 입력o삭제x
    mk('naver', 2, { b: '다C', bt: '010-0000-0003', r: '다C', rt: '010-0000-0003', opt: OPT.gold3, q: 1, ad: '대구 다다구 다다로 3', pid: '2026100000000003', oid: '2026100000003' }),   // ② 27일발송
    mk('naver', 3, { b: '라D', bt: '010-0000-0004', r: '라D', rt: '010-0000-0004', opt: OPT.h25r, q: 1, ad: '인천 라라구 라라로 4', pid: '2026100000000004', oid: '2026100000004' }),   // ③ s사이즈
    mk('naver', 4, { b: '마E', bt: '010-0000-0005', r: '마E', rt: '010-0000-0005', opt: OPT.h3s, q: 1, ad: '광주 마마구 마마로 5', pid: '2026100000000005', oid: '2026100000005' }),   // ④ 보내는이
    mk('naver', 5, { b: '바F', bt: '010-0000-0000', r: '사G', rt: '010-0000-0006', opt: OPT.h25r, q: 1, ad: '대전 바바구 바바로 6', pid: '2026100000000006', oid: '2026100000006' }),   // 선물하기(구매자 번호 자리표시)
    mk('coupang', 0, { b: '아H', bt: '010-0000-0007', r: '아H', rt: '010-0000-0007', opt: '하우스감귤 가정용 - 3kg(소과), 1개', q: 1, ad: '울산 아아구 아아로 7', pid: 'cp-box-7', oid: '7000000000007' }),
    mk('cafe24', 0, { b: '자I', bt: '010-0000-0008', r: '자I', rt: '010-0000-0008', opt: '하우스감귤 가정용 - 5kg(로얄과)', q: 2, ad: '세종 자자로 8', pid: 'c24-item-8', oid: '20261024-0000001' }),
];
const ctx = { today: TODAY, naver: { rows: ORDERS.filter(e => e.ch === 'naver').map(e => e.raw) }, coupang: ORDERS.filter(e => e.ch === 'coupang').map(e => e.raw), cafe24: ORDERS.filter(e => e.ch === 'cafe24').map(e => e.raw), merged: ORDERS, allowIndiv: true, lines: {}, allLines: [] };
const keyOf = e => e.ch + ':' + e.i; const buyerTel = e => String(e.conv['구매자연락처'] || '').replace(/\D/g, ''); const dg = s => String(s || '').replace(/\D/g, '');
const NO_TEL = new Set(['01000000000', '0000000000', '00000000000']);
const recvMatches = d => ORDERS.filter(e => [e.conv['수취인연락처1'], e.conv['수취인연락처2']].some(v => dg(v) === d));
const sizeItem = opt => /귤/.test(opt) && /로얄과/.test(opt) && !/선물/.test(opt);   // final-order sizeItem 의 뜻(귤 로얄과만 · 선물용 제외) 재현

function run(title, memo, cashAoa, extraLines) {
    console.log('\n' + '='.repeat(100) + '\n▶ ' + title + '\n메모:\n' + memo.split('\n').map(l => '   ' + l).join('\n'));
    // 1) 사이즈 줄 떼기 → 2) prepLines(보내는이·날짜·입력삭제 정규화) → 3) v2 parseLines/applyLines
    const sz = core.sizeLines(memo); const prep = core.prepLines(sz.text, CAL);
    console.log('sizeLines →', JSON.stringify(sz.sizes.map(z => ({ raw: z.raw, size: z.size, digits: z.digits }))), '| bad', sz.bad.length, '| ups', sz.ups.length);
    console.log('prepLines → v2Text 줄:', JSON.stringify(prep.v2Text.split('\n')), '| senders:', JSON.stringify(prep.senders.map(s => ({ raw: s.raw, name: s.name, phone: s.phone, ambiguous: s.ambiguous, why: s.why }))), '| notes:', JSON.stringify(prep.notes.map(n => n.type + (n.detail ? '(' + n.detail + ')' : ''))));
    const lines = V2.parseLines(prep.v2Text, 'naver', TODAY); ctx.lines = { naver: [], cafe24: [], coupang: [] }; lines.forEach(l => { if (!l.bad) ctx.lines[l.ch].push(l); }); ctx.allLines = lines;
    ORDERS.forEach(e => { e.memoFlag = null; e.userTouched = false; e.excluded = false; });
    V2.applyLines(ctx, true);
    console.log('v2 줄 해석:', JSON.stringify(lines.map(l => ({ line: l.line, bad: !!l.bad, date: l.date, digits: l.digits, indiv: l.indiv, ch: l.ch, hits: l.hits, applied: l.applied }))));
    ORDERS.forEach(e => console.log(`   주문 ${keyOf(e)} ${e.conv['구매자명']} q${e.conv['수량']} ${e.conv['옵션정보'].slice(0, 22)} → reqKind=${e.reqKind || '-'} individual=${e.individual} excluded=${e.excluded} flag=${e.flag || '-'}`));
    // 4) 사이즈 적용(final-order sizeApply 재현: 구매자 번호·주문번호 → 귤 로얄과만 꼬리 · 받는 분 번호면 카드)
    const tails = new Map(), cards = [];
    sz.sizes.forEach(z => { const hit = ORDERS.filter(e => (z.digits.length >= 8 && !NO_TEL.has(z.digits) && buyerTel(e) === z.digits) || V2.idsOf(ctx, e).includes(z.key)); if (!hit.length) { const rv = recvMatches(z.digits); cards.push(rv.length ? `[메모 줄 카드] 「${z.raw}」 = 받는 분 번호 → 주문 ${rv.map(keyOf).join(',')} 에 적용할지 묻는 카드(choices 적용/넘어감)` : `[정보] 주문 없음: ${z.raw}`); return; } const ok = hit.filter(e => sizeItem(e.conv['옵션정보'])); ok.forEach(e => tails.set(keyOf(e), z.size + '사이즈로!')); hit.filter(e => !ok.includes(e)).forEach(e => cards.push(`[정보] 사이즈 지정 대상 아님(귤 로얄과만): ${keyOf(e)} ${e.conv['옵션정보']}`)); });
    // 5) 보내는이 적용
    const sm = core.applySenders(prep.senders, ORDERS.map(e => ({ key: keyOf(e), digits: buyerTel(e), ids: V2.idsOf(ctx, e), recipient: e.conv['수취인명'], ch: e.ch })));
    prep.senders.filter(s => s.ambiguous).forEach(s => cards.push(`[보내는이 줄 카드] 「${s.raw}」 애매: ${s.why} → 사람이 이름·번호 확정`));
    sm.nohit.forEach(s => cards.push(`[정보] 보내는이 줄 주문 없음: ${s.raw}`));
    console.log('보내는이 적용:', JSON.stringify([...sm.byKey.entries()]));
    // 6) 현금파일 대조
    let cash = null;
    if (cashAoa) { cash = core.parseCash(cashAoa); console.log('현금파일 parse:', cash.ok ? `ok ${cash.rows.length}줄(! 줄 ${cash.rows.filter(r => r.bang).length})` : cash.error);
        const chk = core.cashCheck({ orders: ORDERS.map(e => ({ key: keyOf(e), digits: buyerTel(e), buyer: e.conv['구매자명'], qty: Number(e.conv['수량']), individual: !!e.individual, excluded: !!e.excluded })), cash });
        console.log('cashCheck:', JSON.stringify({ missing: chk.missing.map(m => ({ buyer: m.buyer, qty: m.qty })), notIndiv: chk.notIndiv.map(m => m.buyer), boxDiff: chk.boxDiff.map(m => ({ buyer: m.buyer, order: m.orderQty, cash: m.cashQty })), strangers: chk.strangers.length, mixed: chk.mixed.map(m => m.buyer), unchecked: chk.unchecked.map(u => u.buyer) }));
        chk.missing.forEach(m => cards.push(`[현금파일 카드] ${m.buyer} 입력삭제 ${m.qty}박스 — 현금파일에 주소 줄 없음`)); chk.boxDiff.forEach(m => cards.push(`[박스 수 카드] ${m.buyer} 주문 ${m.order}박스 / 현금파일 ${m.cash}박스`)); chk.notIndiv.forEach(m => cards.push(`[현금파일 카드] ${m.buyer} 현금 줄은 있는데 입력삭제 주문 아님(이중 발송 위험)`)); }
    // 7) 택배사 양식(buildRows) — 나가는 주문(individual·excluded 아님) + 현금 줄
    const going = ORDERS.filter(e => !e.individual && !e.excluded);
    const program = going.map(e => { const c = e.conv, snd = sm.byKey.get(keyOf(e)); const t = tails.get(keyOf(e)); return { key: keyOf(e), cells: [snd ? snd.name : c['구매자명'] + '(제주아꼼이네)', snd && snd.phone ? snd.phone : c['구매자연락처'], '제주 출고지', c['수취인명'], t ? c['옵션정보'] + ' ' + t : c['옵션정보'], c['수량'], c['수취인연락처1'], '', c['통합배송지'], c['배송메세지'], c['구매자연락처'], '', ''].map(v => ({ v, t: typeof v === 'number' ? 'n' : 's' })) }; });
    const out = core.buildRows({ program, cash: cash && cash.ok ? cash.rows : [], byPartner: CAT, picks: {}, senderByKey: sm.byKey, defaultMemo: core.DEFAULT_MEMO });
    out.partners.forEach(p => { console.log(`택배사 양식(${p.short || p.name}) ${p.rows.length}줄:`); p.rows.forEach(r => console.log('   ', r.src === 'cash' ? '[현금 줄]' : '[주문]', '보내는사람=' + r.cells[0].v, '| 받는분=' + r.cells[3].v, '| 옵션=' + r.cells[4].v, '| 수량=' + r.cells[5].v, '| 주소=' + String(r.cells[8].v).slice(0, 12), '| 메세지=' + String(r.cells[9].v).slice(0, 18))); });
    if (out.unknown.length) console.log('거래처 못 정한 품목:', out.unknown);
    // 8) 네이버 「발주발송관리」 시트(v2 buildSheet2 규칙 재현: 네이버 · 나가는 주문 줄 → 그 아래 입력삭제 주문 노란 줄 · 수량은 주문 수량 그대로 · 송장번호 빈칸)
    const nv = ORDERS.filter(e => e.ch === 'naver'); const s2 = nv.filter(e => !e.individual && !e.excluded).map(e => ({ pid: e.raw._pid, q: e.conv['수량'], yellow: false })).concat(nv.filter(e => e.individual && !e.excluded).map(e => ({ pid: e.raw._pid, q: e.conv['수량'], yellow: true })));
    console.log('네이버 발주발송관리 시트 줄:', JSON.stringify(s2), '| 시트에서 빠진 네이버 주문:', nv.filter(e => e.excluded).map(e => e.raw._pid + '(' + e.reqKind + ')'));
    console.log('카드·정보:'); cards.forEach(c => console.log('   ' + c)); if (!cards.length) console.log('   (없음)');
    return { prep, lines, out, cards };
}
// 가짜 현금파일(택배사 양식 13칸 머리글 · 「!」 없는 줄 = 입력삭제 건 개별 주소) — ① 나B 4박스 중 1박스만 다른 주소(현금 1줄 수량 1)
const H = core.HEADERS;
const cashRow = (buyer, bt, recv, opt, q, addr) => [buyer + '(제주아꼼이네)', bt, '제주 출고지', recv, opt, q, '010-0000-0902', '', addr, '', bt, '', ''];
const CASH_1 = [H, cashRow('나B', '010-0000-0002', '차J', '하우스감귤 가정용 - 5kg(로얄과)', 1, '강원 차차군 차차로 9')];
const CASH_4 = [H, cashRow('나B', '010-0000-0002', '차J', '하우스감귤 가정용 - 5kg(로얄과)', 2, '강원 차차군 차차로 9'), cashRow('나B', '010-0000-0002', '카K', '하우스감귤 가정용 - 5kg(로얄과)', 2, '전남 카카군 카카로 10')];
const MEMO4 = ['010-0000-0002 입력o삭제x', '010-0000-0003 27일발송', '010-0000-0004 s사이즈', '010-0000-0005 전승범 드림 010-0000-0101'].join('\n');
run('A. 대표 메모 4꼴 그대로 + 현금파일 1줄(4박스 중 1박스만 개별 주소)', MEMO4, CASH_1);
run('B. 같은 메모 + 현금파일 2줄(4박스 전부 개별 주소 2+2)', MEMO4, CASH_4);
run('C. ④를 되는 꼴로(「보내는이」 낱말) + 선물하기 받는 분 번호 사이즈 줄 + 자사몰 주문번호 줄 + 쿠팡 번호 줄', ['010-0000-0002 입력o삭제x', '010-0000-0005 보내는이 전승범 010-0000-0101', '010-0000-0006 s사이즈', '20261024-0000001 27일발송', '010-0000-0007 27일발송 쿠팡'].join('\n'), CASH_4);
run('D. 날짜+입력삭제 탭 꼴(정리 파일 원꼴) · 보내는이 「드림」만(낱말 없음 · 번호 뒤)', ['10/24\t010-0000-0002\t입력o삭제x\t네이버', '010-0000-0005 전승범 드림'].join('\n'), CASH_4);
