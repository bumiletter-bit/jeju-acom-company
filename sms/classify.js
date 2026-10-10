/* #610 회사폰 문자 응대 — 받은 문자 가르기 (순수 함수 · DB·네트워크·AI 없음 · 한 통 1ms 안)
 *
 *   classify(text, ctx) → { bucket, words, reason }
 *     ctx = { hasImage       : 사진(MMS)이 같이 왔는가
 *             isKnownCustomer: 보낸 번호가 우리 주문(3채널·송장 색인)에 있는가
 *             fromShortCode  : 보낸 번호가 짧은 번호·대표번호인가(호출부가 알면 넘김)
 *             from           : 보낸 번호 글자(있으면 여기서도 한 번 더 본다) }
 *
 *   bucket   뜻                                   서버가 할 일(총괄 설계)
 *   ───────  ───────────────────────────────────  ─────────────────────────
 *   otp      인증번호·승인번호·카드 승인          기록만(답 없음)
 *   ad       광고·수신거부·[Web발신] 안내         기록만
 *   carrier  통신사·대표번호(15xx/16xx/18xx/080)  기록만
 *   claim    파손·썩음·곰팡이·환불·교환·안 옴     직원 몫(봇 답 없음 — 사진이 있으면 사진 판독 쪽)
 *   account  계좌·이체·입금·무통장·송금           직원 몫(봇 답·초안 없음 — 문자로 주문·입금하는 손님은 사람이 받는다 · #628 대표 「고」 10/10)
 *   photo    사진만 왔거나 글이 아주 짧음         사진 판독 → 직원 몫
 *   ship_q   언제 와요·발송·도착·송장             규칙 답(rules.js) → 안 되면 AI
 *   order_q  주문·결제·취소·변경·주소·사이즈      AI(확인이 필요하면 [사람])
 *   greeting 감사·잘 받았어요·네                  답 안 함
 *   other    그 밖                                AI
 *
 *   🔴 순서가 규칙이다: 기계 문자(otp → ad → carrier) → 불만(claim) → 사진(photo) → 배송(ship_q) → 주문(order_q) → 인사 → 그 밖.
 *      섞인 글은 앞쪽이 이긴다 — 「감사합니다 근데 곰팡이가…」 = claim · 「아직 안 왔어요 언제 와요」 = claim(사람이 봐야 한다).
 *   낱말표는 아래 상수 — 직원이 겪은 말을 그대로 더하면 된다(더한 뒤 node scripts/verify-610-rules.js).
 */
'use strict';

// ── 낱말표 (고칠 때: 넓히면 봇이 덜 답하고 사람이 더 본다 · 좁히면 그 반대. 불만 낱말은 넓게 두는 쪽이 안전) ──
const OTP_WORDS = ['인증번호', '인증 번호', '인증코드', '인증 코드', '승인번호', '승인 번호', '본인확인', '본인 확인', '일회용 비밀번호', '보안코드', 'OTP', 'otp', 'verification code', '카드 승인', '승인 완료', '일시불', '출금'];
const AD_WORDS = ['(광고)', '[광고]', '수신거부', '수신 거부', '무료거부', '무료 거부', '무료수신거부', '080-', '대출', '이벤트 당첨', '특가 안내', '지금 바로 신청', '상담 신청'];
const CARRIER_WORDS = ['통신요금', '요금 안내', '요금안내', '청구서', '청구 금액', '미납', '데이터 사용량', '데이터 소진', '부가서비스', 'SKT', 'SK텔레콤', 'LG U+', 'LGU+', '유플러스', '알뜰폰', '로밍'];
const WEB_SENT_RE = /^\s*\[(Web발신|web발신|WEB발신|국제발신|국외발신)\]/;

// #628(대표 10/10 「계좌이체 문의는 직원으로」): 계좌·입금 — 봇이 답도 초안도 만들지 않는다(톡톡 시나리오 「스토어로만」 글이 문자 단골 주문에는 맞지 않음)
const ACCOUNT_WORDS = ['계좌', '이체', '입금', '무통장', '송금', '입금확인', '입금 확인', '계좌번호'];
// 불만·문제 — 여기 걸리면 봇은 답하지 않는다
const CLAIM_WORDS = [
    '파손', '깨졌', '깨져', '터졌', '터져', '찌그러', '짓눌', '으깨', '멍들', '눌려', '눌렸',
    '썩', '곰팡이', '부패', '상했', '상해서', '상한', '물러', '물렀', '무른', '무름', '흐물', '시들', '벌레', '냄새',
    '환불', '반품', '교환', '보상', '변상',
    '안 왔', '안왔', '안 와', '안와', '안 옴', '안옴', '못 받', '못받', '안 받았', '안받았', '도착 안', '도착안', '배송 안', '배송안', '안 오네', '안오네', '아직도',
    '다른 상품', '다른상품', '다른 게 왔', '다른게 왔', '잘못 왔', '잘못왔', '잘못 온', '오배송', '누락', '빠졌', '빠져', '모자라', '덜 왔', '덜왔', '개수가', '갯수가',
    '맛없', '맛이 없', '맛이 이상', '시어', '너무 셔', '싱거', '실망', '화가', '화나', '짜증', '어이없', '항의', '신고', '소비자원', '사기',
    '깨진', '깨짐', '터진', '터짐', '곪', '골았', '짓무', '물컹', '상함', '변질', '불량', '하자', '덜 익', '안 익', '말랐', '말라', '딱딱', '쓴맛', '먹을 수가 없', '못 먹', '버렸', '버림',
    '받지 못', '못 받았', '미도착', '안 도착', '안받음', '분실', '늦네', '늦어', '너무 늦', '오래 걸', '연락이 없', '답이 없', '최악', '엉망',
    '작아요', '작네요', '너무 작', '크기가 다', '사이즈가 다', '사진이랑 다', '사진과 다', '저번이랑 다', '지난번이랑 다', '저번과 다', '지난번과 다',
];
// 배송·발송 물음
const SHIP_WORDS = ['언제 와', '언제와', '언제 오', '언제오', '언제 받', '언제받', '언제 도착', '언제도착', '언제 보내', '언제보내', '언제 발송', '언제발송', '언제 출발', '언제쯤', '언제 나가', '언제나가',
    '발송', '출고', '출발', '도착', '배송', '택배', '송장', '운송장', '며칠', '몇일', '몇 일', '오늘 나가', '내일 나가', '받을 수 있', '받을수있'];
// 주문·변경 물음
const ORDER_WORDS = ['주문', '결제', '입금', '취소', '변경', '바꿔', '바꾸', '주소', '받는 사람', '받는사람', '받는 분', '수령인', '연락처 수정', '사이즈', '수량', '추가 주문', '추가주문', '옵션', '영수증', '현금영수증', '세금계산서', '계산서'];
// 주문 낱말 가운데 「사람이 손대야 하는 변경」 — 배송 낱말과 같이 오면 주문 쪽으로 보낸다
const ORDER_CHANGE_WORDS = ['취소', '변경', '바꿔', '바꾸', '주소', '사이즈', '수량'];
// 인사·맺음 — 이것만 있고 짧을 때만
const GREETING_WORDS = ['감사', '고맙', '고마워', '잘 받았', '잘받았', '잘 먹', '잘먹', '맛있', '수고', '알겠', '네네', '넵', '넹', '확인했', '좋은 하루', '안녕'];
const GREETING_ONLY_RE = /^(네|넵|넹|예|응|ㅇㅇ|ㅇㅋ|ok|okay|ㄳ|ㄱㅅ|감사|ㅎㅎ+|ㅋㅋ+)+[\s.!~^♥]*$/i;

const SHORT_CODE_RE = /^(15|16|18)\d{6}$|^080\d{6,8}$|^1\d{2}$|^\d{3,6}$/;   // 1588-0000 · 080 · 114 · 짧은 번호
const QUESTION_RE = /\?|？|까요|나요|가요|ㄴ가|인지|언제|어디|얼마|어떻게|뭐|무슨|왜|되나|될까|있나|있을까|해주|해 주|주세요|부탁/;
const ASK_STRICT_RE = /\?|？|언제|어디|얼마|어떻게|되나|될까|주세요|부탁|며칠|몇\s*일|송장|운송장/;

const PHOTO_SHORT_LEN = 8;     // 사진과 같이 온 글이 이 길이(공백 뺀 글자 수) 이하면 「사진만」으로 본다
const GREETING_MAX_LEN = 30;   // 인사로 볼 글의 최대 길이

function hits(text, list) {
    const out = [];
    for (const w of list) if (text.includes(w)) out.push(w.trim());
    return out;
}
const digits = s => String(s == null ? '' : s).replace(/[^0-9]/g, '');

function classify(text, ctx) {
    const c = ctx || {};
    const raw = String(text == null ? '' : text);
    const t = raw.replace(/\s+/g, ' ').trim();
    const bare = t.replace(/\s/g, '');
    const shortCode = !!c.fromShortCode || (c.from != null && SHORT_CODE_RE.test(digits(c.from)));
    const webSent = WEB_SENT_RE.test(t);

    // 손님 글의 표시 — 물음이거나 배송·주문·불만 낱말이 있다(기계 문자로 잘못 버리지 않게 먼저 본다)
    const asks = QUESTION_RE.test(t);
    const custWords = hits(t, SHIP_WORDS).length + hits(t, ORDER_WORDS).length;
    const claimWords = hits(t, CLAIM_WORDS).length;
    const personal = !shortCode && !webSent && (/^01\d{8,9}$/.test(digits(c.from)) || c.isKnownCustomer === true);   // 휴대폰 번호에서 온 글(또는 주문 손님)

    // ① 기계가 보낸 문자 — 답하지 않는다
    //    인증·승인 낱말이 있어도 손님 글(「입금했어요 승인번호 … 확인 부탁」)이면 여기서 버리지 않는다 → 짧은 번호·[Web발신] 이거나, 물음·배송/주문 낱말이 없을 때만
    let w = hits(t, OTP_WORDS);
    if (w.length && (shortCode || webSent || (!asks && !custWords))) return { bucket: 'otp', words: w, reason: '인증·승인 문자' };
    //    광고 낱말이 있어도 휴대폰 손님 글에 물음·배송/주문/불만 낱말이 있으면 광고가 아니다(「대출 문자 말고 제 귤 언제 와요」「수신거부 했는데 환불은요」)
    w = hits(t, AD_WORDS);
    if (w.length && !(personal && (asks || custWords || claimWords))) return { bucket: 'ad', words: w, reason: '광고·수신거부 문구' };
    w = hits(t, CARRIER_WORDS);
    if (shortCode) return { bucket: 'carrier', words: w, reason: '대표번호·짧은 번호에서 온 문자' };
    if (w.length && !c.isKnownCustomer && (webSent || !QUESTION_RE.test(t))) return { bucket: 'carrier', words: w, reason: '통신사 안내' };
    if (webSent) return { bucket: 'ad', words: [t.match(WEB_SENT_RE)[0].trim()], reason: '웹·국제 발신 안내 문자' };

    // ② 불만·문제 — 사람
    w = hits(t, CLAIM_WORDS);
    if (w.length) return { bucket: 'claim', words: w, reason: '불만·문제 낱말' };
    // ②-b 계좌·입금 — 사람(#628)
    w = hits(t, ACCOUNT_WORDS);
    if (w.length) return { bucket: 'account', words: w, reason: '계좌·입금 낱말' };

    // ③ 사진만
    if (c.hasImage && bare.length <= PHOTO_SHORT_LEN) return { bucket: 'photo', words: [], reason: bare ? '사진 + 짧은 글' : '사진만' };
    if (!bare) return { bucket: 'other', words: [], reason: '빈 글' };

    // ④ 배송 물음 → ⑤ 주문 물음
    const ws = hits(t, SHIP_WORDS), wo = hits(t, ORDER_WORDS), wg = hits(t, GREETING_WORDS);
    // 「배송 잘 받았어요 감사합니다」처럼 물음 없이 인사만인 글은 배송 물음이 아니다
    const thanksOnly = wg.length > 0 && bare.length <= GREETING_MAX_LEN && !ASK_STRICT_RE.test(t);
    if (ws.length && !thanksOnly) {
        if (wo.some(x => ORDER_CHANGE_WORDS.includes(x))) return { bucket: 'order_q', words: wo.concat(ws), reason: '주문 변경 + 배송 낱말' };
        return { bucket: 'ship_q', words: ws, reason: '배송·발송 물음' };
    }
    if (wo.length && !thanksOnly) return { bucket: 'order_q', words: wo, reason: '주문·변경 물음' };

    // ⑥ 인사
    if (GREETING_ONLY_RE.test(t)) return { bucket: 'greeting', words: [t], reason: '짧은 대답' };
    if (thanksOnly) return { bucket: 'greeting', words: wg, reason: '인사·맺음' };

    if (c.hasImage) return { bucket: 'photo', words: [], reason: '사진 + 글(불만 낱말 없음)' };
    return { bucket: 'other', words: [], reason: '그 밖' };
}

module.exports = { classify, OTP_WORDS, AD_WORDS, CARRIER_WORDS, CLAIM_WORDS, ACCOUNT_WORDS, SHIP_WORDS, ORDER_WORDS, GREETING_WORDS };
