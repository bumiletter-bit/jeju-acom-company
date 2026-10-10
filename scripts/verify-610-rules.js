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
    ['order_q', '입금했습니다 확인 부탁드려요', {}],
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
    { kind: 'ship_after', staff: false, text: '10/8(목) 효돈에서 출발했어요 · 송장 끝 1234 · 오늘(10/10(토)) 도착 예정이에요 (공휴일(한글날)). 배송 상태: 간선상하차' }]);
// 2 발송 뒤 — 송장을 물음 → kind tracking
R.push(['발송 뒤 + 「송장」 물음 = kind tracking',
    rules.answer({ text: '송장번호 알려주세요', bucket: 'ship_q', now: '2026-10-13T09:00:00+09:00', holidays: H, order: one({ ship_date: '2026-10-12', partner: '대성', tracking_tail: '601234567890', delivered: false, status_label: '집화처리' }) }),
    { kind: 'tracking', staff: false, text: '10/12(월) 대성에서 출발했어요 · 송장 끝 7890 · 오늘(10/13(화))~수요일(10/14) 사이 도착 예정이에요. 배송 상태: 집화처리' }]);
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

console.log(`\n결과 ${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
