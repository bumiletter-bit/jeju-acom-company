/* #610 회사폰 문자 응대 — 가르기·규칙 답·헤더 파서·문자 다듬기 검증 (순수 함수 · DB·네트워크·AI 없음)
 *   실행: node scripts/verify-610-rules.js        → 마지막 줄 「결과 N/N」
 *         node scripts/verify-610-rules.js --show → 실제 값을 전부 찍음(기대값을 고칠 때)
 *   낱말표(sms/classify.js)나 답 문장(sms/rules.js)을 고치면 여기 기대값도 같이 고친다.
 */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
const { classify } = require(path.join(root, 'sms/classify.js'));
const rules = require(path.join(root, 'sms/rules.js'));
const aiNote = require(path.join(root, 'sms/ai-note.js'));
const { smsSafe, smsSafeBase, smsBytes } = require(path.join(root, 'sms/sms-safe.js'));
const shippingSchedule = require(path.join(root, 'shipping-schedule.js'));
const followup = require(path.join(root, 'sms/followup.js'));

const SHOW = process.argv.includes('--show');
let pass = 0, total = 0;
function ok(name, cond, got) {
    total++;
    if (cond) pass++;
    if (!cond || SHOW) console.log(`${cond ? '✅' : '❌'} ${name}${cond && !SHOW ? '' : '\n     → ' + (typeof got === 'string' ? got : JSON.stringify(got))}`);
}
const EMOJI_RE = /\p{Extended_Pictographic}/u;

// ───────────────────────── ① classify 40문장 ─────────────────────────
console.log('① 가르기(classify)');
const C = [
    // otp 4
    ['otp', '[Web발신] [네이버] 인증번호 [482913]을 입력해 주세요.', { from: '1588-3820' }],
    ['otp', '인증번호는 739201 입니다. 타인에게 알려주지 마세요', {}],
    ['otp', '[Web발신] 신한카드 승인 완료 12,000원 일시불 10/10 14:22', { fromShortCode: true }],
    ['otp', '[카카오] 본인확인 인증번호 [5521]', { from: '16441234' }],
    // ad 5
    ['ad', '(광고) 제주감귤 특가! 무료거부 080-123-4567', {}],
    ['ad', '[Web발신] (광고)[○○마트] 주말 세일 안내 수신거부 0801234567', {}],
    ['ad', '저금리 대출 상담 신청하세요', {}],
    ['ad', '[Web발신] 고객님 택배가 보관 중입니다 확인 http://x.y', {}],
    ['ad', '[국제발신] 귀하의 계정이 정지되었습니다', {}],
    // carrier 4
    ['carrier', '10월 통신요금 안내: 청구 금액 55,000원', {}],
    ['carrier', '고객님 데이터 사용량이 80%를 넘었습니다', {}],
    ['carrier', '안녕하세요 고객센터입니다', { from: '1588-1234' }],
    ['carrier', '부재중 전화 1통', { from: '114' }],
    // account 5 (#628 · 계좌·입금은 사람 — claim 이 먼저 · 다른 글은 종전대로)
    ['account', '계좌이체로 주문하고 싶은데 계좌번호 알려주세요', {}],
    ['account', '입금했어요 확인 부탁드려요', {}],
    ['account', '무통장으로 보낼게요 얼마 넣으면 돼요?', { isKnownCustomer: true }],
    ['account', '송금했습니다 하우스감귤 3kg 2개요', {}],
    ['claim', '환불 계좌 알려드릴게요 썩은 게 많아요', {}],
    // claim 6 (섞인 글 포함)
    ['claim', '귤이 썩어서 왔어요', {}],
    ['claim', '감사합니다 근데 곰팡이 핀 게 몇 개 있네요', {}],
    ['claim', '아직 안 왔어요 언제 와요?', { isKnownCustomer: true }],
    ['claim', '환불해 주세요', {}],
    ['claim', '다른 상품이 왔는데요', { hasImage: true }],
    ['claim', '크기가 너무 작아요 저번이랑 다르네요', { hasImage: true }],
    // photo 4
    ['photo', '', { hasImage: true }],
    ['photo', '이거요', { hasImage: true }],
    ['photo', '사진 보내요', { hasImage: true }],
    ['photo', '어제 받은 상자 사진인데 한번 봐 주시겠어요', { hasImage: true }],
    // ship_q 5
    ['ship_q', '언제 와요?', { isKnownCustomer: true }],
    ['ship_q', '오늘 주문하면 언제 받을 수 있나요', {}],
    ['ship_q', '송장번호 좀 알려주세요', { isKnownCustomer: true }],
    ['ship_q', '발송 됐나요?', {}],
    ['ship_q', '감사합니다 근데 배송은 며칠 걸려요?', {}],
    // order_q 5
    ['order_q', '주문 취소하고 싶어요', {}],
    ['order_q', '배송지 주소 변경 가능한가요', {}],
    ['order_q', '사이즈를 M으로 바꿔주세요', {}],
    ['order_q', '현금영수증 발급되나요', {}],
    ['account', '입금했습니다 확인 부탁드려요', {}],   // #628: 종전 order_q → account(사람)
    // greeting 4
    ['greeting', '네', {}],
    ['greeting', '감사합니다~', {}],
    ['greeting', '잘 받았어요 맛있네요', {}],
    ['greeting', '배송 잘 받았습니다 감사합니다', {}],
    // other 3
    ['other', '귤 보관은 어떻게 하나요', {}],
    ['other', '5kg 얼마예요?', {}],
    ['other', '선물용 포장 되나요', {}],
];
C.forEach(([want, text, ctx], i) => {
    const r = classify(text, ctx);
    ok(`${String(i + 1).padStart(2, '0')} ${want.padEnd(8)} 「${text.slice(0, 28)}」`, r.bucket === want, r);
});
{
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 2000; i++) classify(C[i % C.length][1], C[i % C.length][2]);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 2000;
    ok(`속도 한 통 ${ms.toFixed(3)}ms (기준 2ms 안)`, ms < 2, ms);
}

// ───────────────────────── ② rules 10건 ─────────────────────────
console.log('② 규칙 답(rules.answer)');
// 달력: 10/9(금) 한글날 = 발송휴무 + 도착불가 · 10/10(토) 발송 없음(토요일만 발송을 쉰다 — 일요일은 발송함) · 10/11(일) 배달 없음
const H = { set: new Set(['2026-10-09']), arriveOff: new Set(['2026-10-09']), reasons: new Map([['2026-10-09', '공휴일(한글날)']]) };
const NOW = '2026-10-10T10:00:00+09:00';   // 토요일 오전
const one = o => ({ match: 'one', order: o });
const R = [];
// 1 발송 뒤 — 10/8(목) 출발 · 10/9 도착불가 → 토(10/10) · 일요일 배달 없음 → 최단일만
R.push(['발송 뒤(휴무일 끼임) = 오늘 도착 예정 한 날만 + 사유',
    rules.answer({ text: '언제 와요?', bucket: 'ship_q', now: NOW, holidays: H, order: one({ ship_date: '2026-10-08', partner: '효돈', option: '하우스감귤 가정용 - 4kg(로얄과)', qty: 1, tracking_tail: '1234', delivered: false, status_label: '간선상하차' }) }),
    { kind: 'ship_after', staff: false, text: '10/8(목) 효돈에서 출발했어요 · 송장 끝 1234 · 오늘(10/10(토)) 도착 예정이에요 (공휴일(한글날)). 지금은 배송 지역으로 이동 중이에요.' }]);
// 2 발송 뒤 — 송장을 물음 → kind tracking
R.push(['발송 뒤 + 「송장」 물음 = kind tracking',
    rules.answer({ text: '송장번호 알려주세요', bucket: 'ship_q', now: '2026-10-13T09:00:00+09:00', holidays: H, order: one({ ship_date: '2026-10-12', partner: '대성(시온)', tracking_tail: '601234567890', delivered: false, status_label: '집화' }) }),
    { kind: 'tracking', staff: false, text: '10/12(월) 대성에서 출발했어요 · 송장 끝 7890 · 오늘(10/13(화))~수요일(10/14) 사이 도착 예정이에요. 지금은 택배사에 접수됐어요.' }]);
// 3 배송 완료
R.push(['배송 완료 = 도착 예정 문장 없음',
    rules.answer({ text: '도착했나요', bucket: 'ship_q', now: NOW, holidays: H, order: one({ ship_date: '2026-10-07', partner: '효돈', tracking_tail: '5678', delivered: true, status_label: '배송완료' }) }),
    { kind: 'ship_after', staff: false, text: '10/7(수) 효돈에서 출발했어요 · 송장 끝 5678 · 배송 완료로 확인돼요.' }]);
// 4 도착 예정일 지남 → 사람
R.push(['도착 예정일이 지났는데 완료 아님 = 사람',
    rules.answer({ text: '언제 와요', bucket: 'ship_q', now: '2026-10-14T10:00:00+09:00', holidays: H, order: one({ ship_date: '2026-10-07', partner: '효돈', tracking_tail: '5678', delivered: false, status_label: '간선하차' }) }),
    { kind: null, staff: true, text: '', why: 'arrive_overdue' }]);
// 5 발송 전 — 토요일 주문 → 일요일 발송(일요일은 발송하는 날)
R.push(['발송 전(토요일 주문) = 내일 일요일 발송',
    rules.answer({ text: '언제 발송돼요?', bucket: 'ship_q', now: NOW, holidays: H, order: one({ ship_date: null, option: '하우스감귤 가정용 - 4kg(로얄과)', qty: 1, paid_at: '2026-10-10T09:30:00+09:00' }) }),
    { kind: 'ship_before', staff: false, text: '내일 일요일(10/11) 오전 발송 예정이에요 · 월요일(10/12)~화요일(10/13) 사이 도착 예정이에요.' }]);
// 6 발송 전 — 휴무일 사유가 붙는 경우(10/8 낮 주문 → 10/9 휴무 · 10/10 토 → 10/11 일) · 물은 날 = 10/10(토) 저녁
R.push(['발송 전(한글날 휴무로 밀림) = 사유 문장 포함',
    rules.answer({ text: '배송 언제 되나요', bucket: 'ship_q', now: '2026-10-10T19:00:00+09:00', holidays: H, order: one({ ship_date: null, option: '황금향 가정용 3kg', paid_at: '2026-10-08T13:00:00+09:00' }) }),
    { kind: 'ship_before', staff: false, text: '내일 일요일(10/11) 오전 발송 예정이에요 · 월요일(10/12)~화요일(10/13) 사이 도착 예정이에요. (한글날 연휴 휴무로 일요일 발송이에요)' }]);
// 7 발송 전 — 오늘 발송분인데 낮 12시 넘음 + 송장 물음
R.push(['발송 전(오늘 발송분 · 오후) = 「오전 발송 예정」이라 안 함 + 송장 안내',
    rules.answer({ text: '송장 나왔나요', bucket: 'ship_q', now: '2026-10-13T14:00:00+09:00', holidays: H, order: one({ ship_date: null, option: '하우스감귤 4kg', paid_at: '2026-10-13T07:10:00+09:00' }) }),
    { kind: 'ship_before', staff: false, text: '오늘(10/13(화)) 발송분이에요 · 내일 수요일(10/14)~목요일(10/15) 사이 도착 예정이에요. 송장 번호는 발송되면 알림으로 보내 드려요.' }]);
// 8 예약 상품 → 사람
R.push(['발송 전 예약 상품 = 사람(계산기로 답하지 않음)',
    rules.answer({ text: '언제 와요', bucket: 'ship_q', now: NOW, holidays: H, order: one({ ship_date: null, option: '[예약] 레드향 3kg', paid_at: '2026-10-09T10:00:00+09:00' }) }),
    { kind: null, staff: true, text: '', why: 'reserve' }]);
// 9 many → 되묻기
R.push(['주문 여러 건(many) = 받는 분 성함 되묻기',
    rules.answer({ text: '언제 와요', bucket: 'ship_q', now: NOW, holidays: H, order: { match: 'many' } }),
    { kind: null, staff: false, text: rules.ASK_NAME_TEXT }]);
// 10 none → null · 배송 물음이 아니면 null
R.push(['주문 없음(none) = null(AI 로)', rules.answer({ text: '언제 와요', bucket: 'ship_q', now: NOW, holidays: H, order: { match: 'none' } }), null]);
R.push(['배송 물음이 아님(order_q) = null', rules.answer({ text: '주소 바꿔주세요', bucket: 'order_q', now: NOW, holidays: H, order: one({ ship_date: '2026-10-08' }) }), null]);
R.push(['발송 예정일이 지났는데 발송 기록 없음 = 사람',
    rules.answer({ text: '언제 와요', bucket: 'ship_q', now: '2026-10-14T10:00:00+09:00', holidays: H, order: one({ ship_date: null, option: '황금향 3kg', paid_at: '2026-10-08T13:00:00+09:00' }) }),
    { kind: null, staff: true, text: '', why: 'ship_overdue' }]);
R.forEach(([name, got, want], i) => {
    const same = want === null ? got === null
        : !!got && got.kind === want.kind && got.staff === want.staff && got.text === want.text && (want.why === undefined || got.why === want.why);
    ok(`${String(i + 1).padStart(2, '0')} ${name}`, same, got);
});
{
    // 계산기 하나: 규칙 답의 날짜가 computeShipping / computeArrival 결과와 같은지(직접 대조)
    const s = shippingSchedule.computeShipping(new Date('2026-10-08T13:00:00+09:00'), H.set, H.reasons, { arriveOff: H.arriveOff });
    ok('계산기 대조 — 발송 전 답의 발송일·도착일 = computeShipping 결과', s.shipDate === '2026-10-11' && s.arriveStart === '2026-10-12' && s.arriveEnd === '2026-10-13' && R[5][1].text.includes('10/11') && R[5][1].text.includes('10/12') && R[5][1].text.includes('10/13'), s);
    const a = shippingSchedule.computeArrival(new Date('2026-10-08T12:00:00+09:00'), H.arriveOff, H.reasons);
    ok('계산기 대조 — 발송 뒤 답의 도착일 = computeArrival 결과', a.arriveStart === '2026-10-10' && a.arriveEnd === '2026-10-12' && R[0][1].text.includes('10/10'), a);
    const texts = R.map(x => x[1] && x[1].text).filter(Boolean).join('\n');
    ok('규칙 답 전체 — 이모지 0 · 운송장 5자리 이상 숫자 0 · 전화번호 꼴 0', !EMOJI_RE.test(texts) && !/\d{5,}/.test(texts) && !/01\d-?\d{3,4}-?\d{4}/.test(texts), texts);
}

// ───────────────────────── ②-a 수정 F3(총검토 R3·R4) — 지난 주문·문제 상태·결제 시각 ─────────────────────────
console.log('②-a 규칙 답 수정 F3');
{
    const shipped = (o, extra) => Object.assign({ match: 'one', order: Object.assign({ ship_date: '2026-10-08', partner: '효돈', tracking_tail: '1234', delivered: false, status_label: '간선상하차' }, o) }, extra || {});
    const ask = (text, order, now) => rules.answer({ text, bucket: 'ship_q', now: now || NOW, holidays: H, order });
    const isStaff = (r, why) => !!r && r.staff === true && r.text === '' && r.why === why;
    ok('01 새 주문이 따로 있음(pre_pending 1) = 사람 — 지난 송장으로 답하지 않음', isStaff(ask('언제 와요', shipped({ delivered: true, status_label: '배송완료' }, { pre_pending: 1 })), 'new_order_pending'), ask('언제 와요', shipped({}, { pre_pending: 1 })));
    ok('02 pre_pending 이 있으면 배송 중인 주문이어도 사람', isStaff(ask('언제 와요', shipped({}, { pre_pending: 2 })), 'new_order_pending'));
    ok('03 배송 완료 + 「언제 와요」 = null(AI 로 — 지난 주문 이야기가 아닐 수 있다)', ask('언제 와요?', shipped({ delivered: true, status_label: '배송완료' })) === null, ask('언제 와요?', shipped({ delivered: true, status_label: '배송완료' })));
    const d1 = ask('도착했나요', shipped({ delivered: true, status_label: '배송완료' }));
    ok('04 배송 완료 + 「도착했나요」 = 완료 답', !!d1 && d1.staff === false && d1.text === '10/8(목) 효돈에서 출발했어요 · 송장 끝 1234 · 배송 완료로 확인돼요.', d1);
    const d2 = ask('송장번호 알려주세요', shipped({ delivered: true, status_label: '배송완료' }));
    ok('05 배송 완료 + 「송장」 물음 = 완료 답(kind tracking)', !!d2 && d2.kind === 'tracking' && /배송 완료로 확인돼요\.$/.test(d2.text), d2);
    ok('06 배송 완료인데 「못 받았어요」「어디 있나요」「분실」 = 사람', isStaff(ask('배송완료라는데 못 받았어요', shipped({ delivered: true })), 'not_received') && isStaff(ask('택배 어디 있나요', shipped({ delivered: true })), 'not_received') && isStaff(ask('분실된 건가요 송장 알려주세요', shipped({ delivered: true })), 'not_received'));
    ok('07 문제 상태(미배송·사고·기타·정보없음·조회실패) = 사람 · 그 낱말이 답에 안 나감', ['미배송', '사고', '기타', '정보없음', '조회실패'].every(s => isStaff(ask('언제 와요', shipped({ status_label: s })), 'trouble')));
    const s1 = ask('언제 와요', shipped({ status_label: '배송출발' }));
    ok('08 상태를 손님 말로 — 배송출발 → 「오늘 배송 출발했어요」 · 분류 낱말 그대로는 안 나감', !!s1 && /지금은 오늘 배송 출발했어요\.$/.test(s1.text) && !/배송 상태|간선|집화|배송출발/.test(s1.text), s1);
    const s2 = ask('언제 와요', shipped({ status_label: '간선상하차', stale: true })), s3 = ask('언제 와요', shipped({ status_label: '알 수 없는 분류' })), s4 = ask('언제 와요', shipped({ status_label: null }));
    ok('09 조회 실패로 옛 상태(stale) · 모르는 분류 · 상태 없음 = 상태 문장 생략', [s2, s3, s4].every(r => !!r && r.staff === false && /도착 예정이에요 \(공휴일\(한글날\)\)\.$/.test(r.text)), [s2, s3, s4].map(r => r && r.text));
    const iso = ask('언제 와요', shipped({ ship_date: '2026-10-08T00:00:00.000Z' }));
    ok('10 ship_date 가 ISO 글자여도 앞 10자로 읽음', !!iso && /^10\/8\(목\) 효돈에서 출발했어요/.test(iso.text), iso);
    const pn = ask('언제 와요', shipped({ partner: '대성(시온)' })), pn2 = ask('언제 와요', shipped({ partner: '효돈 (2차)' }));
    ok('11 거래처 이름의 괄호 안은 뗌(「대성(시온)」 → 「대성에서」)', !!pn && /대성에서 출발했어요/.test(pn.text) && !/시온|\(시/.test(pn.text) && /효돈에서 출발했어요/.test(pn2.text), pn && pn.text);
    const pk = rules.answer({ text: '언제 와요', bucket: 'ship_q', now: '2026-10-13T15:00:00+09:00', holidays: H, order: { match: 'one', order: { pre: true, channel: 'coupang', ship_date: null, option_text: '하우스감귤 4kg', paid_at: '2026-10-13T09:10:00+09:00', paid_known: false } } });
    ok('12 발송 전 — 결제 시각 모름(paid_known false · 수집 시각이 들어 있음) = 사람', isStaff(pk, 'pre_no_paid_at'), pk);
    const pk2 = rules.answer({ text: '언제 와요', bucket: 'ship_q', now: '2026-10-13T15:00:00+09:00', holidays: H, order: { match: 'one', order: { pre: true, channel: 'naver', ship_date: null, option_text: '하우스감귤 4kg', paid_at: '2026-10-13T09:10:00+09:00', paid_known: true } } });
    ok('13 발송 전 — paid_known true 면 종전대로 답', !!pk2 && pk2.staff === false && pk2.why === 'pre' && /^주문 확인됐어요 · 내일 수요일\(10\/14\)/.test(pk2.text), pk2);
}

// ───────────────────────── ①-b 가르기 수정 F3 — 새 문장 20 ─────────────────────────
console.log('①-b 가르기 수정 F3');
const C2 = [
    ['claim', '귤이 깨진 채로 왔어요', {}], ['claim', '상자가 터짐', { hasImage: true }], ['claim', '몇 개가 곪았어요', {}], ['claim', '짓무른 게 많네요', {}], ['claim', '덜 익은 게 왔어요', {}],
    ['claim', '너무 딱딱하고 쓴맛이 나요', {}], ['claim', '먹을 수가 없어서 다 버렸어요', {}], ['claim', '아직 받지 못했습니다', { isKnownCustomer: true }], ['claim', '미도착인데요', {}], ['claim', '배송이 너무 늦네요', {}],
    ['claim', '문의했는데 답이 없네요', {}], ['claim', '포장 상태 최악이에요', {}], ['claim', '불량이 섞여 있어요', {}],
    // 인증·광고 낱말이 있어도 손님 글이면 버리지 않는다
    ['account', '입금했습니다 승인번호 1234 확인 부탁드려요', { from: '010-1234-5678' }],
    ['ship_q', '인증번호 문자 말고 제 귤 언제 오나요?', { from: '01012345678' }],
    ['claim', '수신거부 했는데 환불은 언제 되나요', { from: '01012345678' }],
    ['ship_q', '대출 광고 아니고요 배송 언제 되나요', { isKnownCustomer: true }],
    // 기계 문자는 그대로
    ['otp', '[Web발신] 인증번호 482913 배송 조회용', {}],
    ['otp', '본인확인 인증번호 [5521]', { from: '16441234' }],
    ['ad', '(광고) 배송비 무료 이벤트 수신거부 0801234567', {}],
];
C2.forEach(([want, text, ctx], i) => { const r = classify(text, ctx); ok(`${String(i + 1).padStart(2, '0')} ${want.padEnd(8)} 「${text.slice(0, 28)}」`, r.bucket === want, r); });

// ───────────────────────── ②-b 발송 전 주문(#610-H · order.pre) ─────────────────────────
console.log('②-b 발송 전 주문(rules.answer · order.pre)');
const pre = o => one(Object.assign({ pre: true, channel: 'naver', ship_date: null, option_text: '하우스감귤 가정용 - 4kg(로얄과)', qty: 1, recipient_initial: '김' }, o));
const PRE = [
    ['발송 전 — 오전 8시 전 결제 = 오늘 오전 발송',
        rules.answer({ text: '언제 발송돼요?', bucket: 'ship_q', now: '2026-10-13T08:30:00+09:00', holidays: H, order: pre({ paid_at: '2026-10-13T07:40:00+09:00' }) }),
        { kind: 'ship_before', staff: false, why: 'pre', text: '주문 확인됐어요 · 오늘(10/13(화)) 오전 발송 예정이에요 · 내일 수요일(10/14)~목요일(10/15) 사이 도착 예정이에요.' }],
    ['발송 전 — 8시 넘어 결제 = 내일 발송',
        rules.answer({ text: '배송 언제 오나요', bucket: 'ship_q', now: '2026-10-13T15:00:00+09:00', holidays: H, order: pre({ paid_at: '2026-10-13T10:10:00+09:00', channel: 'coupang' }) }),
        { kind: 'ship_before', staff: false, why: 'pre', text: '주문 확인됐어요 · 내일 수요일(10/14) 오전 발송 예정이에요 · 목요일(10/15)~금요일(10/16) 사이 도착 예정이에요.' }],
    ['발송 전 — 휴무일로 밀림(10/8 낮 결제 → 10/11 일 발송) + 사유',
        rules.answer({ text: '언제 받을 수 있나요', bucket: 'ship_q', now: '2026-10-09T11:00:00+09:00', holidays: H, order: pre({ paid_at: '2026-10-08T13:00:00+09:00', channel: 'mall' }) }),
        { kind: 'ship_before', staff: false, why: 'pre', text: '주문 확인됐어요 · 일요일(10/11) 오전 발송 예정이에요 · 월요일(10/12)~화요일(10/13) 사이 도착 예정이에요. (한글날 연휴 휴무로 일요일 발송이에요)' }],
    ['발송 전 — 예약 상품 = 사람', rules.answer({ text: '언제 와요', bucket: 'ship_q', now: NOW, holidays: H, order: pre({ paid_at: '2026-10-09T10:00:00+09:00', option_text: '[예약] 레드향 3kg' }) }), { kind: null, staff: true, why: 'reserve', text: '' }],
    ['발송 전 — 결제 시각 없음 = 사람(지금 기준으로 세지 않음)', rules.answer({ text: '언제 와요', bucket: 'ship_q', now: NOW, holidays: H, order: pre({}) }), { kind: null, staff: true, why: 'pre_no_paid_at', text: '' }],
    ['발송 전 — 배송메세지에 날짜 요청 = 사람', rules.answer({ text: '언제 와요', bucket: 'ship_q', now: '2026-10-13T15:00:00+09:00', holidays: H, order: pre({ paid_at: '2026-10-13T10:10:00+09:00', memo: '20일 발송 부탁드려요' }) }), { kind: null, staff: true, why: 'memo_date', text: '' }],
    ['발송 전 — 배송메세지가 기사님 말뿐이면 그대로 답', rules.answer({ text: '언제 와요', bucket: 'ship_q', now: '2026-10-13T15:00:00+09:00', holidays: H, order: pre({ paid_at: '2026-10-13T10:10:00+09:00', memo: '문 앞에 놓아주세요' }) }),
        { kind: 'ship_before', staff: false, why: 'pre', text: '주문 확인됐어요 · 내일 수요일(10/14) 오전 발송 예정이에요 · 목요일(10/15)~금요일(10/16) 사이 도착 예정이에요.' }],
    ['발송 전 — 발송 예정일이 지남 = 사람', rules.answer({ text: '언제 와요', bucket: 'ship_q', now: '2026-10-14T10:00:00+09:00', holidays: H, order: pre({ paid_at: '2026-10-08T13:00:00+09:00' }) }), { kind: null, staff: true, why: 'ship_overdue', text: '' }],
];
PRE.forEach(([name, got, want], i) => ok(`${String(i + 1).padStart(2, '0')} ${name}`, !!got && got.kind === want.kind && got.staff === want.staff && got.text === want.text && got.why === want.why, got));
{
    const s = shippingSchedule.computeShipping(new Date('2026-10-13T10:10:00+09:00'), H.set, H.reasons, { arriveOff: H.arriveOff });
    ok('계산기 대조 — 발송 전(pre) 답의 날짜 = computeShipping(결제 시각) 결과', s.shipDate === '2026-10-14' && s.arriveStart === '2026-10-15' && s.arriveEnd === '2026-10-16' && PRE[1][1].text.includes('10/14') && PRE[1][1].text.includes('10/15') && PRE[1][1].text.includes('10/16'), s);
    const texts = PRE.map(x => x[1] && x[1].text).filter(Boolean).join('\n');
    ok('발송 전 답 전체 — 이모지 0 · 5자리 이상 숫자 0 · 받는 분 이름·첫 글자 0', !EMOJI_RE.test(texts) && !/\d{5,}/.test(texts) && !/김/.test(texts), texts);
}

// ───────────────────────── ②-c 되묻기 답 읽기(followup) ─────────────────────────
console.log('②-c 되묻기 답 읽기(followup)');
const ASK_AT = '2026-10-10T10:00:00+09:00';
ok('01 expectName — 되물은 지 20분 = true', followup.expectName({ ask_kind: 'name', ask_at: ASK_AT }, '2026-10-10T10:20:00+09:00') === true);
ok('02 expectName — 61분 지남 = false · ask_kind 없음 = false · ask_at 없음 = false · thread 없음 = false',
    followup.expectName({ ask_kind: 'name', ask_at: ASK_AT }, '2026-10-10T11:01:00+09:00') === false && followup.expectName({ ask_kind: null, ask_at: ASK_AT }, '2026-10-10T10:05:00+09:00') === false && followup.expectName({ ask_kind: 'name' }, ASK_AT) === false && followup.expectName(null) === false);
const F = [
    ['김영희요', { name: '김영희', sure: true }],
    ['받는 분은 김영희예요', { name: '김영희', sure: true }],
    ['김영희 입니다', { name: '김영희', sure: true }],
    ['네 김영희님이요', { name: '김영희', sure: true }],
    ['박철수 앞으로 보낸 거예요', { name: '박철수', sure: true }],
    ['Kim Younghee', { name: 'KimYounghee', sure: true }],
    ['김영희요 근데 언제 와요?', { name: '김영희', sure: false }],
    ['받는 분 김영희인데 주소도 바꿔주세요', { name: '김영희', sure: false }],
    ['몰라요', { name: null, sure: false, why: 'unknown' }],
    ['모르겠어요', { name: null, sure: false, why: 'unknown' }],
    ['어제 주문했는데요', { name: null, sure: false, why: 'no_name' }],
    ['감사합니다', { name: null, sure: false, why: 'no_name' }],
];
F.forEach(([text, want], i) => {
    const got = followup.parseNameReply(text);
    ok(`${String(i + 3).padStart(2, '0')} parseNameReply 「${text}」 → ${want.name || '이름 없음'}${want.sure ? '' : want.name ? '(sure 아님)' : ''}`, got.name === want.name && got.sure === want.sure && (want.why === undefined || got.why === want.why), got);
});
{
    // 수정 F3 — 조사·맞장구가 이름을 깎지 않게 · 말끝 꼴 · 불만/주문 변경 글
    const F2 = [
        ['이영희요', { name: '이영희', sure: true }],                 // 「이」를 조사로 떼면 「영희」가 된다
        ['받는 분 이영희', { name: '이영희', sure: true }],
        ['받는 분이 가영희예요', { name: '가영희', sure: true }],
        ['예지원이요', { name: '예지원', sure: true }],               // 「예」를 맞장구로 떼면 안 된다
        ['아영이에요', { name: '아영', sure: true }],
        ['네, 은지수입니다', { name: '은지수', sure: true }],
        ['보냈어요', { name: null, sure: false }],
        ['좋아요', { name: null, sure: false }],
        ['취소요', { name: null, sure: false }],
        ['진짜요', { name: null, sure: false }],
        ['김영희인데요', { name: '김영희', sure: true }],
        ['받는 분 김영희요 환불해주세요', { name: '김영희', sure: false }],
        ['수령인 김영희 주소 변경 부탁드려요', { name: '김영희', sure: false }],
    ];
    F2.forEach(([text, want], i) => { const got = followup.parseNameReply(text); ok(`F3-${String(i + 1).padStart(2, '0')} parseNameReply 「${text}」 → ${want.name || '이름 없음'}${want.sure ? '' : want.name ? '(sure 아님)' : ''}`, got.name === want.name && got.sure === want.sure, got); });
}
{
    const lk = require(path.join(root, 'sms/lookup.js'));
    const a = followup.secondLookupArgs('김영희 님이요');
    ok('15 secondLookupArgs — lookup.normalizeName 과 같은 정리', a.recipientName === lk.normalizeName('김영희 님이요') && a.recipientName === '김영희' && Object.keys(a).length === 1, a);
}

// ───────────────────────── ③ parse 5건 ─────────────────────────
console.log('③ 첫 줄 헤더 파서(ai-note.parse)');
const P = [
    ['[사람] 한 줄 = 직원 몫 + 까닭', aiNote.parse('[사람] 파손 불만'), { toStaff: true, text: '', why: '파손 불만' }],
    ['보통 답 = 그대로', aiNote.parse('안녕하세요, 제주아꼼이네입니다.\n서늘한 곳에 두시면 됩니다.'), { toStaff: false, text: '안녕하세요, 제주아꼼이네입니다.\n서늘한 곳에 두시면 됩니다.', why: '' }],
    ['엔진 헤더 + [사람] + 자동 꼬리가 붙어 와도 직원 몫', aiNote.parse('사용시나리오: 배송 일정\n[사람] 주문 확인 필요\n\n*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.'), { toStaff: true, text: '', why: '주문 확인 필요' }],
    ['본문 끝에 뒤늦게 붙은 [사람] = 직원 몫(손님에게 안 나감)', aiNote.parse('안녕하세요.\n환불은 가능합니다.\n[사람]'), { toStaff: true, text: '', why: '본문에 판정 문구 섞임' }],
    ['빈 답·SKIP = 직원 몫', [aiNote.parse(''), aiNote.parse('SKIP')], [{ toStaff: true, text: '', why: '빈 답' }, { toStaff: true, text: '', why: 'SKIP' }]],
    ['보통 답 뒤 자동 꼬리 = 꼬리만 뗌', aiNote.parse('안녕하세요.\n내일 발송됩니다.\n\n*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.'), { toStaff: false, text: '안녕하세요.\n내일 발송됩니다.', why: '' }],
];
P.forEach(([name, got, want], i) => ok(`${String(i + 1).padStart(2, '0')} ${name}`, JSON.stringify(got) === JSON.stringify(want), got));
ok('안내 블록 — [사람] 규칙·이모지 금지·톡톡 금지 문장이 들어 있음', /\[사람\]/.test(aiNote.SMS_SYSTEM_NOTE) && /이모지/.test(aiNote.SMS_SYSTEM_NOTE) && /톡톡/.test(aiNote.SMS_SYSTEM_NOTE) && !EMOJI_RE.test(aiNote.SMS_SYSTEM_NOTE), aiNote.SMS_SYSTEM_NOTE.length);

// ───────────────────────── ④ smsSafe 8건 ─────────────────────────
console.log('④ 문자 다듬기(smsSafe)');
const TAIL = '*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.';
const S = [
    ['이모지 제거 + 공백 정리', smsSafe('에고 😢 불편드려 죄송합니다 🙏  감사합니다! 🍊'), '에고 불편드려 죄송합니다 감사합니다!'],
    ['자동 꼬리 줄 제거', smsSafe('내일 발송됩니다.\n\n' + TAIL), '내일 발송됩니다.'],
    ['자사몰 변형 꼬리(카카오톡 채널)도 제거', smsSafe('내일 발송됩니다.\n\n*추가 문의사항 있으시다면 언제든지 카카오톡 채널 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.'), '내일 발송됩니다.'],
    ['「톡톡으로」 → 「문자로」 · 「네이버 페이로」 제거', smsSafe('이상 있는 부분은 네이버 페이로 부분환불도 가능하고, 톡톡으로 말씀해 주세요.'), '이상 있는 부분은 부분환불도 가능하고, 문자로 말씀해 주세요.'],
    ['빈 줄 3개 이상 → 1개 · 줄 끝 공백', smsSafe('첫 줄  \n\n\n\n둘째 줄\t\n'), '첫 줄\n\n둘째 줄'],
    ['문자에 실리는 기호는 남김(★ ▶ ※ ♥ ☎)', smsSafe('★ 안내 ▶ 보관법 ※ 주의 ♥ ☎'), '★ 안내 ▶ 보관법 ※ 주의 ♥ ☎'],
    ['사진 요청 줄은 opt.dropPhotoAsk 일 때만 제거', [smsSafe('죄송합니다.\n📸 파손 부분 사진 찍어 보내주시면 빠른 처리 도와드리겠습니다\n감사합니다.'), smsSafe('죄송합니다.\n📸 파손 부분 사진 찍어 보내주시면 빠른 처리 도와드리겠습니다\n감사합니다.', { dropPhotoAsk: true })],
        ['죄송합니다.\n파손 부분 사진 찍어 보내주시면 빠른 처리 도와드리겠습니다\n감사합니다.', '죄송합니다.\n감사합니다.']],
];
S.forEach(([name, got, want], i) => ok(`${String(i + 1).padStart(2, '0')} ${name}`, JSON.stringify(got) === JSON.stringify(want), got));
{
    const long = Array.from({ length: 40 }, (_, i) => `${i + 1}번째 문장입니다 귤은 서늘한 곳에 보관해 주세요.`).join(' ');
    const cut = smsSafe(long);
    ok(`08 900바이트 넘으면 문장 단위로 자름(원문 ${smsBytes(long)} → ${smsBytes(cut)}바이트 · 마침표로 끝남)`, smsBytes(long) > 900 && smsBytes(cut) <= 900 && smsBytes(cut) > 800 && /보관해 주세요\.$/.test(cut), cut.slice(-40));
    ok('09 maxBytes 0 = 안 자름 · 숫자 주면 그 한도', smsSafe(long, { maxBytes: 0 }) === long && smsBytes(smsSafe(long, { maxBytes: 90 })) <= 90, smsBytes(smsSafe(long, { maxBytes: 90 })));
    // 기존 smsSafe(kakao-notify.js #549)와 같은 결과 — 총괄이 하나로 합칠 때까지 지켜야 하는 약속
    let same = true, diff = null;
    try {
        const kn = require(path.join(root, 'kakao-notify.js'));
        const samples = ['에고 😢 불편 🙏  감사 🍊', '📞 010-1111-2222 ☎ ★ 1️⃣ 👍🏻 🇰🇷  끝 ', ' 줄1  \n\t줄2 ♥ ▶ ※', '', '👨‍👩‍👧 가족  세트 ❤️', TAIL, '일반 글자만 있는 줄\n둘째 줄'];
        for (const x of samples) if (smsSafeBase(x) !== kn.smsSafe(x)) { same = false; diff = x; break; }
    } catch (e) { same = false; diff = 'kakao-notify.js 를 못 읽음: ' + e.message; }
    ok('10 smsSafeBase = kakao-notify.js smsSafe(#549) 와 글자까지 같음(7문장)', same, diff);
}

// ───────────────────────── ④-b 문자 다듬기 수정 F3 ─────────────────────────
console.log('④-b 문자 다듬기 수정 F3');
{
    const S2 = [
        ['회사 번호로 연락하라는 문장만 빼고 같은 줄의 다른 안내는 남김', smsSafe('내일 오전 발송됩니다. 궁금하신 점은 010-6687-4031 로 연락 주세요. 맛있게 드세요.'), '내일 오전 발송됩니다. 맛있게 드세요.'],
        ['그 문장뿐인 줄은 줄째 사라짐', smsSafe('내일 발송됩니다.\n문의는 ☎ 010-6687-4031 로 전화 주세요\n감사합니다.'), '내일 발송됩니다.\n감사합니다.'],
        ['번호만 있고 연락 낱말이 없는 문장은 남김', smsSafe('고객센터 번호는 010-6687-4031 입니다.'), '고객센터 번호는 010-6687-4031 입니다.'],
        ['표시 그림을 글자로 — ✅ → 가능 · ❌ → 불가', smsSafe('토요일 배송 ✅ / 일요일 배송 ❌'), '토요일 배송 가능 / 일요일 배송 불가'],
        ['이미 글자가 있으면 겹쳐 쓰지 않음', smsSafe('냉장 보관 가능 ✅ 상온 장기 보관은 불가 ❌'), '냉장 보관 가능 상온 장기 보관은 불가'],
        ['「톡톡 문의」「네이버 톡톡」 변형도 문자로', smsSafe('톡톡 문의 주시면 안내드려요. 네이버 톡톡도 됩니다.'), '문자 주시면 안내드려요. 문자도 됩니다.'],
    ];
    S2.forEach(([name, got, want], i) => ok(`${String(i + 1).padStart(2, '0')} ${name}`, got === want, got));
    const dec = '하우스감귤은 2.5kg 과 4.5kg 두 가지입니다. ' + '귤은 서늘한 곳에 보관해 주세요. '.repeat(3);
    const cut = smsSafe(dec, { maxBytes: 30 });
    ok('07 소수점에서 끊지 않음(「2.5kg」) — 30바이트 한도면 「하우스감귤은 2.」로 끝나지 않는다', !/2\.$/.test(cut) && smsBytes(cut) <= 30, cut);
    ok('08 소수점 든 문장은 통째로 실리거나 통째로 빠짐', smsSafe(dec, { maxBytes: 60 }) === '하우스감귤은 2.5kg 과 4.5kg 두 가지입니다.', smsSafe(dec, { maxBytes: 60 }));
}

console.log(`\n결과 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
