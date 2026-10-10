/* #610-H 회사폰 문자 응대 — 되묻기(「받는 분 성함을 알려 주세요」) 뒤에 온 답 읽기 (순수 함수 · DB·네트워크·AI 없음)
 *
 *   흐름(서버 sms/index.js 가 잇는다):
 *     주문이 여러 건(many) → rules.ASK_NAME_TEXT 를 보내고 thread.ask_kind = 'name' · thread.ask_at = 지금
 *     → 다음 글이 오면 expectName(thread) 가 true 일 때만 parseNameReply(text)
 *     → name 이 있고 sure 면 lookupByPhone(db, phone, secondLookupArgs(name)) → one 이면 규칙 답
 *     → 그 밖(이름 못 읽음 · sure false · 다시 many/none)은 직원 몫. 🔴 되묻기는 한 번만 — 어느 쪽이든 ask_kind 를 비운다.
 *
 *   expectName(thread, now)   → boolean   thread.ask_kind === 'name' 이고 ask_at 이 60분 안
 *   parseNameReply(text)      → { name, sure, why }
 *        「김영희요」「받는 분은 김영희예요」「김영희 입니다」「네 김영희님이요」 → { name:'김영희', sure:true }
 *        이름 뒤에 다른 말·물음이 섞임(「김영희요 근데 언제 와요?」)       → { name:'김영희', sure:false }  ← 서버는 sure 일 때만 2차 조회
 *        「몰라요」「모르겠어요」「기억이 안 나요」                           → { name:null,   sure:false, why:'unknown' }
 *        이름으로 볼 수 없는 글(「어제 주문했는데요」)                        → { name:null,   sure:false, why:'no_name' }
 *   secondLookupArgs(name)    → { recipientName }   lookup.normalizeName 과 같은 정리(그 함수를 그대로 부른다)
 *
 *   이름은 한글 2~5자 또는 영문 2~20자. 손님 글의 이름은 주문을 가리는 데만 쓰고 답 글에 다시 적지 않는다.
 */
'use strict';
const { normalizeName } = require('./lookup.js');

const ASK_WINDOW_MIN = 60;   // 되물은 뒤 이 시간 안에 온 글만 「성함 답」으로 본다

// 모른다는 답
const UNKNOWN_RE = /모르|몰라|기억\s*(이|은)?\s*(안|못)|생각\s*(이|은)?\s*안|글쎄/;
// 이름 앞에 붙는 말(있으면 「이름을 말하려는 글」이라는 표시가 된다)
const LEAD_RE = /^(네+|넵|예|아+|음+|아\s*네)?[\s,.!~]*((받는|받으시는|받을|받으실)\s*(분|사람|이)|수령인|수취인|받는이|성함|이름|보낸\s*(분|사람))?\s*(성함|이름)?\s*(은|는|이|가|의)?[\s:：,]*/;
// 이름 뒤에 붙어도 되는 말(이것만 남으면 sure)
const TAIL_OK_RE = /^(님|씨|분|께)?\s*(입니다|이에요|이예요|예요|에요|이요|요|이구요|이고요|구요|입니당|임)?\s*(앞|에게|한테|께)?\s*(으로)?\s*(보냈|보낸|보내는|시킨|주문한)?\s*(어요|습니다|거예요|거에요|건이에요|건이요|건데요|거요|건)?[\s.!~^ㅎㅋ♥]*$/;
// 이름처럼 보여도 이름이 아닌 흔한 낱말
const NOT_NAME = new Set(['어제', '오늘', '내일', '그제', '지금', '아직', '언제', '주문', '배송', '택배', '송장', '발송', '도착', '확인', '감사', '안녕', '저기', '혹시', '그게', '이거', '저번', '지난', '선물', '본인', '저요', '제가', '저는', '나요', '우리', '엄마', '아빠', '어머니', '아버지', '어머님', '아버님', '부모님', '친구', '동생', '언니', '누나', '오빠', '형님', '사장님', '고객', '회사', '사무실', '모두', '전부', '둘다', '여러']);
const KO_NAME_RE = /^[가-힣]{2,5}$/;
// 말끝(서술어) 꼴 · 인사말로 시작하는 글은 이름이 아니다 — 「감사합니다」「죄송해요」가 한글 5자라 이름으로 읽히는 것을 막는다
const NOT_NAME_END_RE = /(니다|니당|세요|어요|아요|해요|네요|데요|까요|나요|군요|지요|죠|거든요|는데|ㄴ데)$/;
const NOT_NAME_HEAD_RE = /^(감사|고맙|고마|안녕|죄송|미안|수고|알겠|확인|괜찮|잠시|잠깐)/;
const EN_NAME_RE = /^[A-Za-z]{2,20}$/;

function expectName(thread, now) {
    const t = thread || {};
    if (t.ask_kind !== 'name' || !t.ask_at) return false;
    const at = new Date(t.ask_at).getTime();
    const n = now == null ? Date.now() : new Date(now).getTime();
    if (!Number.isFinite(at) || !Number.isFinite(n)) return false;
    const gapMin = (n - at) / 60000;
    return gapMin >= 0 && gapMin <= ASK_WINDOW_MIN;
}

// 이름 꼴인지 — 말꼬리를 뗀 뒤 한글 2~5자 / 영문 2~20자 · 흔한 낱말 제외
function asName(token) {
    const n = normalizeName(token);
    if (!n || NOT_NAME.has(n) || NOT_NAME_END_RE.test(n) || NOT_NAME_HEAD_RE.test(n)) return null;
    return (KO_NAME_RE.test(n) || EN_NAME_RE.test(n)) ? n : null;
}

function parseNameReply(text) {
    const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!raw) return { name: null, sure: false, why: 'empty' };
    if (UNKNOWN_RE.test(raw)) return { name: null, sure: false, why: 'unknown' };

    const lead = raw.match(LEAD_RE);
    const hadLead = !!(lead && /(받|수령인|수취인|성함|이름|보낸)/.test(lead[0]));
    const rest = raw.slice(lead ? lead[0].length : 0).trim();
    if (!rest) return { name: null, sure: false, why: 'no_name' };

    // ① 영문 이름(「Kim Younghee」 — 빈칸 한 번까지)
    const en = rest.match(/^([A-Za-z]{2,12}(?:\s[A-Za-z]{2,12})?)(.*)$/);
    if (en) {
        const name = asName(en[1]);
        if (!name) return { name: null, sure: false, why: 'no_name' };
        return { name, sure: TAIL_OK_RE.test(en[2].trim()), why: TAIL_OK_RE.test(en[2].trim()) ? '' : 'mixed' };
    }

    // ② 한글 이름 — 첫 어절에서 이름을 뗀다(「김영희요」「김영희님이요」「김영희입니다」)
    const first = rest.split(' ')[0].replace(/[.,!~?？^]+$/, '');
    const after = rest.slice(rest.split(' ')[0].length).trim();
    // 긴 말꼬리부터 떼어 본다 — 「김영희님이요」 → 김영희 · 「김영희입니다」 → 김영희
    const stem = first.replace(/(님|씨|분)?(입니다|입니당|이에요|이예요|예요|에요|이요|이구요|이고요|구요|인데요|인데|이랑|랑|하고|이고|요|임)?$/, '');
    const name = asName(stem) || asName(first);
    if (!name) return { name: null, sure: false, why: 'no_name' };
    const firstTail = first.slice(first.indexOf(name) + name.length);          // 첫 어절에서 이름 뒤에 남은 글자
    const tailAll = (firstTail + ' ' + after).trim();
    const hasQuestion = /\?|？|언제|어디|얼마|어떻게|왜|되나|될까|주세요|부탁|근데|그런데|그리고|인데/.test(tailAll);
    const onlyInde = /^인데요?[s.!~]*$/.test(tailAll);                                // 「김영희인데요」 = 이름만 말한 것
    const sure = onlyInde || (!hasQuestion && TAIL_OK_RE.test(tailAll));
    // 「받는 분은」 같은 머리말도 없이 뒤에 다른 말이 길게 붙으면(「어제 주문했는데요」 꼴) 이름으로 보지 않는다
    if (!sure && !hadLead && !/^(님|씨|요|이요|입니다|이에요|예요)/.test(firstTail)) return { name: null, sure: false, why: 'no_name' };
    return { name, sure, why: sure ? '' : 'mixed' };
}

function secondLookupArgs(name) {
    return { recipientName: normalizeName(name) };
}

module.exports = { expectName, parseNameReply, secondLookupArgs, ASK_WINDOW_MIN };
