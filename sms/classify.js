/* #610 회사폰 문자 응대 — 받은 문자 가르기 (순수 함수 · DB·네트워크·AI 없음 · 한 통 1ms 안)
 *
 *   classify(text, ctx) → { bucket, words, reason }
 *     ctx = { hasImage       : 사진(MMS)이 같이 왔는가
 *             isKnownCustomer: 보낸 번호가 우리 주문(3채널·송장 색인)에 있는가
 *             fromShortCode  : 보낸 번호가 짧은 번호·대표번호인가(호출부가 알면 넘김)
 *             from           : 보낸 번호 글자(있으면 여기서도 한 번 더 본다)
 *             hasOrder       : 그 번호로 주문이 있다(one·many) — 있으면 기사 안내문·뜻 없는 글로 무시하지 않는다(#650) }
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
 *   request  주문합니다·보내주세요·취소·변경·영수증  직원 몫(봇 답·초안 없음 — 주문을 넣거나 바꾸는 글은 사람이 받는다 · #650)
 *   call     전화 주세요·통화 가능하세요            직원 몫(봇 답·초안 없음)
 *   wrong    잘못 보내셨어요·누구세요·○○님 아닙니다  직원 몫(개인정보 오발송일 수 있다 — 무시하지 않는다)
 *   refuse   수신거부·그만 보내·보내지 마세요       직원 몫 + 그 번호에는 봇이 다시 답하지 않는다(index.js 가 기억)
 *   greeting 감사·잘 받았어요·잘 도착했어요·네    답·초안 없음 · 직원 몫 아님(안 읽음으로만 뜬다 · #641) — 반응 문자(「…에 좋아요를 표시함」)·뜻 없는 글(「123」「?」)도 여기
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

// #649·#650(문자 최종 점검 — 워커4 54문장 · 워커5 33문장 + 실제 받은 글 28통)
const CLAIM_EXTRA_RE = /(귤|맛|너무|좀|많이|엄청|조금)이?\s*(시네|시어|셔요|셔서|십니다|시고)|신\s*맛|시큼|물렁|별로|상태가?\s*(안|별로|영)|안\s*좋|기대\s*이하|안\s*시킬|다시는?\s*안|이게\s*(뭐|뭡|무슨)/;
const CALL_RE = /전화\s*(좀\s*)?(주세요|주시|부탁|해\s*주|드릴|가능|바랍|요망)|통화\s*(가능|좀|부탁|하고|할\s*수|원해|요망)|연락\s*(좀\s*)?(주세요|주시|부탁|바랍)/;
// 요청형 — 톡톡의 TALKTALK_REQUEST_RE(server.js) 낱말표 + 문자 주문 꼴(「한 박스 주문합니다」「받는사람 …」「4키로 두 박스 보내주세요」「현금영수증 해주세요」)
const REQUEST_RE = new RegExp([
    '(배송지|주소|옵션|연락처|받는\\s*분|수취인|사이즈|수량|날짜|발송일)[\\s\\S]{0,40}(변경|바꿔|바꾸|수정)', '(변경|바꿔|바꾸|수정)[\\s\\S]{0,40}(배송지|주소|옵션|연락처|사이즈|수량)',
    '주문[\\s\\S]{0,20}취소', '취소[\\s\\S]{0,20}(해\\s*주|부탁|요청|하고\\s*싶|가능|되나|되요|될까|하려|할래|하고싶)',
    '주문\\s*(합니다|할게|할께|할래|해요|드려요|드립니다|하겠|넣어|접수|부탁|이요)', '(\\d+\\s*(박스|상자|kg|키로|킬로|k\\b)|한\\s*(박스|상자)|두\\s*(박스|상자)|세\\s*(박스|상자))[^.?!\\n]{0,30}(보내|주문|부탁|주세요)',
    '받는\\s*(사람|분|이)\\s*[:：]?\\s*[가-힣]', '보내는\\s*(사람|분|이)\\s*[:：]?\\s*[가-힣]', '(현금)?\\s*영수증', '세금\\s*계산서', '계산서\\s*발행',
    '[가-힣]{1,5}(시|군|구)\\s+[가-힣0-9\\s]{0,20}(로|길|동|읍|면|리)\\s*\\d',
].join('|'));
const REACTION_RE = /메시지에\s*.{1,8}을\(를\)\s*(추가|표시)함|에\s*좋아요를\s*표시함|에\s*(공감|하트|좋아요)(을|를)?\s*(추가|표시)|^(Liked|Loved|Emphasized|Laughed at|Disliked|Questioned)\s+[“"']/;
const BRACKET_HEAD_RE = /^\s*\[[^\]]{0,14}(택배|통운|물류|로지스|익스프레스|우체국|은행|카드|페이|증권|보험|캐피탈|공단|세무서|구청|시청|군청|주민센터|병원|의원|약국)[^\]]{0,6}\]/;   // 알려진 발신처 머리만(「[한진택배] …」「[○○은행] …」) — 「[주문] …」처럼 손님이 붙인 대괄호는 아니다
const DRIVER_RE = /기사입니다|두고\s*갑니다|놓고\s*갑니다|맡겼습니다|맡겨\s*(두|놓)었습니다|(배송|배달|방문)\s*예정입니다|배송\s*완료\s*(했|하였|되었)습니다/;   // 보내는 쪽 말끝일 때만
const ASK_FAVOR_RE = /주세요|주실|주시|부탁|알려|전해|바랍|해\s*줘|주십/;   // 부탁 말끝이 있으면 손님 글이다(「부재 시 문 앞에 놓아주세요」「기사님 전화번호 좀 알려주세요」)
// 불만 낱말이 들어 있어도 칭찬·잘 받았다는 글(「파손 없이 잘 받았습니다」「썩은 거 하나도 없이 잘 왔어요 감사합니다」) — 「…는데/지만」이 없고 물음이 아닐 때만 인사 갈래
const PRAISE_NEG_RE = /없이|하나도\s*없|없고|없네|없어요|없습니다|없었/;
const PRAISE_POS_RE = /잘\s*받|잘\s*왔|잘\s*도착|감사|고맙|맛있|싱싱|좋네|좋아요|좋습니다|만족/;
const REPORTED_RE = /없어요|없는데|못\s*받|안\s*왔|했는데|라는데|라고\s*(하|했|문자)|하던데|왔는데/;   // 손님이 기사 말을 옮겨 적은 글(「문 앞에 두고 갑니다 했는데 없어요」)은 기사 문자가 아니다
const REFUSE_RE = /수신\s*거부|문자\s*(좀\s*)?(그만|보내지)|그만\s*보내|보내지\s*마|연락\s*하지\s*마|연락하지마/;
const WRONG_RE = /잘못\s*보내셨|잘못\s*보낸|번호\s*잘못|문자\s*잘못|누구세요|누구시죠|누구신지|님\s*아닙니다|님이?\s*아닌데|저\s*[가-힣]{2,4}\s*(님)?\s*아닙니다|모르는\s*(번호|분)/;
const OTP_RE = /is your [\w\s]{0,30}code|your [\w\s]{0,20}code is|verification|\b\d{4,8}\b[^\d]{0,14}(code|코드|인증)|(code|코드|인증)[^\d]{0,14}\b\d{4,8}\b/i;
const NOISE_WORD_RE = /^(저기요|여보세요|계세요|저기|여기요)[\s.!?~]*$/;

const SHORT_CODE_RE = /^(15|16|18)\d{6}$|^080\d{6,8}$|^1\d{2}$|^\d{3,6}$/;   // 1588-0000 · 080 · 114 · 짧은 번호
const QUESTION_RE = /\?|？|까요|나요|가요|ㄴ가|인지|언제|어디|얼마|어떻게|뭐|무슨|왜|되나|될까|있나|있을까|해주|해 주|주세요|부탁/;
const ASK_STRICT_RE = /\?|？|언제|어디|얼마|어떻게|되나|될까|주세요|부탁|며칠|몇\s*일|송장|운송장/;

const PHOTO_SHORT_LEN = 8;     // 사진과 같이 온 글이 이 길이(공백 뺀 글자 수) 이하면 「사진만」으로 본다
const GREETING_MAX_LEN = 30;   // 인사로 볼 글의 최대 길이
// #641(대표 10/11 실물: 「귤 잘 도착했습니다.^^」에 배송 조회 초안이 붙음): 「받았다·도착했다」는 알림이지 물음이 아니다 → 인사 갈래
//   말끝이 맺어진 꼴만 본다(「도착했는데…」「받았는데…」는 뒤에 사연이 오므로 인사가 아니다) · 물음·불만·계좌·변경 낱말이 있으면 앞 갈래가 먼저다
const RECEIVED_RE = /잘\s*(도착|왔|받|수령|먹)|(도착|수령|배송\s*완료)\s*(했습니다|했어요|했네요|했음|했어|하였습니다|완료|됐습니다|됐어요|됐네요|되었습니다|되었어요)|받았(습니다|어요|네요|음|어)|왔(습니다|어요|네요)/;
const CONTRAST_RE = /는데|은데|인데|던데|지만|근데|그런데|그러나|다만|하지만|그치만/;   // 뒤에 사연이 이어지는 글 = 인사만이 아니다
const RECEIVED_MAX_LEN = 60;   // 받았다는 알림으로 볼 글의 최대 길이(「잘 받았습니다 맛있게 먹겠습니다 번창하세요」 정도)

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
    const fromDigits = digits(c.from), foreign = !!fromDigits && !fromDigits.startsWith('0') && !shortCode;   // +1 … 처럼 국내 꼴이 아닌 번호

    // ⓪ 반응 문자(「…메시지에 👍을(를) 추가함」「Liked “…”」) — 인용된 글의 낱말(발송·주문)로 가르지 않는다
    if (REACTION_RE.test(t)) return { bucket: 'greeting', words: [], reason: '반응 문자(좋아요·공감 표시)' };

    // ① 기계가 보낸 문자 — 답하지 않는다
    //    인증·승인 낱말이 있어도 손님 글(「입금했어요 승인번호 … 확인 부탁」)이면 여기서 버리지 않는다 → 짧은 번호·[Web발신] 이거나, 물음·배송/주문 낱말이 없을 때만
    let w = hits(t, OTP_WORDS);
    if (w.length && (shortCode || webSent || foreign || (!asks && !custWords))) return { bucket: 'otp', words: w, reason: '인증·승인 문자' };
    if (OTP_RE.test(t) && (shortCode || webSent || foreign || (!asks && !custWords && !claimWords))) return { bucket: 'otp', words: [], reason: '인증번호 꼴(코드 + 숫자)' };
    //    택배사·기사·기관 안내문 — 「[한진택배] …배송 예정」 발신처 머리 · 「배송기사입니다」「문 앞에 두고 갑니다」(물음이 아니고, 손님이 옮겨 적은 글이 아닐 때)
    if (!c.hasOrder && BRACKET_HEAD_RE.test(t) && !webSent && !ASK_STRICT_RE.test(t.replace(BRACKET_HEAD_RE, '')) && !ASK_FAVOR_RE.test(t)) return { bucket: 'carrier', words: [t.match(BRACKET_HEAD_RE)[0].trim()], reason: '발신처 머리가 붙은 안내문' };
    if (!c.hasOrder && DRIVER_RE.test(t) && !claimWords && !REPORTED_RE.test(t) && !ASK_FAVOR_RE.test(t) && !/\?|？/.test(t)) return { bucket: 'carrier', words: [], reason: '택배 기사·기관 안내문' };
    //    거부·오발신 — 광고 꼬리(「무료수신거부 080…」)가 아니라 사람이 쓴 글일 때
    if (!shortCode && !webSent && !foreign && !/\(광고\)|\[광고\]|080/.test(t)) {   // 사람이 쓴 글(짧은 번호·웹 발신·해외 번호가 아님)
        if (REFUSE_RE.test(t) && !claimWords && !custWords) return { bucket: 'refuse', words: [], reason: '수신거부·그만 보내 달라는 글' };
        if (WRONG_RE.test(t)) return { bucket: 'wrong', words: [], reason: '잘못 온 문자라는 글' };
    }
    //    광고 낱말이 있어도 휴대폰 손님 글에 물음·배송/주문/불만 낱말이 있으면 광고가 아니다(「대출 문자 말고 제 귤 언제 와요」「수신거부 했는데 환불은요」)
    w = hits(t, AD_WORDS);
    if (w.length && !(personal && (asks || custWords || claimWords))) return { bucket: 'ad', words: w, reason: '광고·수신거부 문구' };
    w = hits(t, CARRIER_WORDS);
    if (shortCode) return { bucket: 'carrier', words: w, reason: '대표번호·짧은 번호에서 온 문자' };
    if (w.length && !c.isKnownCustomer && (webSent || !QUESTION_RE.test(t))) return { bucket: 'carrier', words: w, reason: '통신사 안내' };
    if (webSent) return { bucket: 'ad', words: [t.match(WEB_SENT_RE)[0].trim()], reason: '웹·국제 발신 안내 문자' };

    // ② 불만·문제 — 사람
    w = hits(t, CLAIM_WORDS);
    if (w.length && PRAISE_NEG_RE.test(t) && PRAISE_POS_RE.test(t) && !CONTRAST_RE.test(t) && !QUESTION_RE.test(t) && bare.length <= RECEIVED_MAX_LEN) return { bucket: 'greeting', words: [], reason: '칭찬·잘 받았다는 글(불만 낱말 + 「없이·없고」)' };
    if (w.length) return { bucket: 'claim', words: w, reason: '불만·문제 낱말' };
    if (CLAIM_EXTRA_RE.test(t)) return { bucket: 'claim', words: [], reason: '불만·문제 꼴(시다·물렁·별로·안 좋다·기대 이하)' };
    // ②-b 계좌·입금 — 사람(#628)
    w = hits(t, ACCOUNT_WORDS);
    if (w.length) return { bucket: 'account', words: w, reason: '계좌·입금 낱말' };
    // ②-c 요청형(주문·변경·취소·영수증) · 전화 요청 — 사람(#650)
    if (REQUEST_RE.test(t)) return { bucket: 'request', words: [], reason: '주문·변경·취소·영수증 요청' };
    if (CALL_RE.test(t)) return { bucket: 'call', words: [], reason: '전화·통화 요청' };

    // ③ 사진만
    if (c.hasImage && bare.length <= PHOTO_SHORT_LEN) return { bucket: 'photo', words: [], reason: bare ? '사진 + 짧은 글' : '사진만' };
    if (!bare) return { bucket: 'other', words: [], reason: '빈 글' };

    // ④ 배송 물음 → ⑤ 주문 물음
    const ws = hits(t, SHIP_WORDS), wo = hits(t, ORDER_WORDS), wg = hits(t, GREETING_WORDS);
    // 「배송 잘 받았어요 감사합니다」처럼 물음 없이 인사만인 글은 배송 물음이 아니다
    const contrast = CONTRAST_RE.test(t), changeWord = wo.some(x => ORDER_CHANGE_WORDS.includes(x));
    const received = RECEIVED_RE.test(t) && bare.length <= RECEIVED_MAX_LEN && !QUESTION_RE.test(t) && !contrast && !changeWord;   // #641 「잘 도착했습니다」「받았어요」 = 알림
    const thanksOnly = received || (wg.length > 0 && bare.length <= GREETING_MAX_LEN && !ASK_STRICT_RE.test(t) && !contrast);
    if (ws.length && !thanksOnly) {
        if (wo.some(x => ORDER_CHANGE_WORDS.includes(x))) return { bucket: 'order_q', words: wo.concat(ws), reason: '주문 변경 + 배송 낱말' };
        return { bucket: 'ship_q', words: ws, reason: '배송·발송 물음' };
    }
    if (wo.length && !thanksOnly) return { bucket: 'order_q', words: wo, reason: '주문·변경 물음' };

    // ⑥ 인사
    if (GREETING_ONLY_RE.test(t)) return { bucket: 'greeting', words: [t], reason: '짧은 대답' };
    if (thanksOnly) return { bucket: 'greeting', words: wg, reason: received ? '받았다는 알림(물음 아님)' : '인사·맺음' };

    if (c.hasImage) return { bucket: 'photo', words: [], reason: '사진 + 글(불만 낱말 없음)' };
    // 뜻 없는 글(「123」「ㄱㅡ」「?」「저기요」) — AI 를 부르지 않는다(안 읽음으로만)
    if (!c.hasOrder && ((!/[가-힣]{2,}/.test(t) && !/[A-Za-z]{3,}/.test(t) && bare.length <= 6) || NOISE_WORD_RE.test(t))) return { bucket: 'greeting', words: [], reason: '뜻 없는 글' };
    return { bucket: 'other', words: [], reason: '그 밖' };
}

module.exports = { classify, RECEIVED_RE, OTP_WORDS, AD_WORDS, CARRIER_WORDS, CLAIM_WORDS, ACCOUNT_WORDS, SHIP_WORDS, ORDER_WORDS, GREETING_WORDS };
