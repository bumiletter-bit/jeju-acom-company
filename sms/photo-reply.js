/* #610-D 사진 판독 응대 — 손님에게 나가는 글 고르기 (순수 함수 · DB·네트워크·AI 없음 · 톡톡·문자 공용)
 *
 *   reply(judge, { channel:'talk'|'sms', lastOrder, prevOrder }) → 글 | null
 *
 *   🔴 손님 글은 AI 가 짓지 않는다. 아래 정해 둔 글에서 고르기만 한다(대표 10/10).
 *      · 숫자·개수·비율을 손님에게 말하지 않는다(「곰팡이 3개 정도」 ✗ — 꼬투리 방지). 사이즈 이름 「2S」만 예외.
 *      · 종류·정도·개수는 judge.staff_summary 로 직원에게만 간다(이 파일은 그 값을 읽지 않는다).
 *      · 금액·반품 접수·포인트 지급은 직원 몫 — 글은 「상황 인정 + 사과 + 선택지」까지만.
 *   kind 별
 *      damage    : 대표 원문 + 범위 되묻기(「다른 박스·나머지도 같으실까요?」)
 *      size      : 「크기가 작았군요」 + (confidence high 일 때만 「사진으로는 ○○ 정도로 보여요」) + 기준 + 지난 주문 + 배송메세지 안내
 *      other·unclear : 「사진 확인했어요, 어떤 점이 불편하셨는지 알려주세요」
 *      not_fruit : null(손님 답 없음 · 직원만)
 *   sms 채널은 이모지 0(알리고·문자에서 「?」로 찍힌다 — 메모리 jeju-sms-no-emoji).
 *
 *   ⚠️ 이 파일은 톡톡봇 저장소(photo-reply.js)에 **같은 내용 복사본**이 있다(별도 배포라 require 를 못 함).
 *      고치면 두 곳을 같이 고친다 — scripts/verify-610-photo.js 가 두 파일이 같은지 본다.
 */
'use strict';

const SIZES = ['2S', 'S', 'M', 'L'];
// 주문 기록에서 넘어오는 사이즈 말 → 손님에게 보일 말(숫자 없는 표현만 · 「2S」 예외)
const ORDER_SIZE_LABEL = {
    '2S': '2S', 'S': 'S', 'M': 'M', 'L': 'L',
    '소과': '소과(2S보다 작은 사이즈)',
    '로얄과': '로얄과(2S·S·M 중 한 사이즈)',
    '중대과': '중대과(M보다 큰 사이즈)'
};

// 대표 원문(10/10) — 글자 그대로. 고치려면 대표 확인.
const DAMAGE_CORE = '부패과가 나왔군요, 불편드려 죄송합니다. 괜찮은 상품 드셔보시고 입맛에도 안 맞으시면 무료 수거 및 반품처리도 가능합니다. 괜찮다고 하시면 위 부분 좀 더 하여 보상처리 가능합니다.';
const DAMAGE_ASK = '혹시 다른 박스·나머지도 같으실까요?';
const SIZE_GUIDE = '로얄과 사이즈는 2S = 골프공 전후 / S = 골프공보다 조금 큰 크기 / M = 종이컵 위에 걸리는 크기예요.';
const SIZE_MEMO = '다음에 주문하실 때 배송메세지에 원하시는 사이즈를 적어 주시면 그 사이즈로 맞춰 보내드려요.';
const SIZE_RETURN = '드셔보시고 입맛에도 안 맞으시면 무료 수거 및 반품처리도 가능합니다.';
const ASK_CORE = '사진 확인했어요, 어떤 점이 불편하셨는지 알려주세요.';
const STAFF_TAIL = '말씀 주시면 담당 직원이 이어서 바로 도와드리겠습니다.';

function orderSizeLabel(order) {
    if (!order) return '';
    const raw = String((typeof order === 'string' ? order : order.size) || '').trim();
    if (!raw) return '';
    const up = raw.toUpperCase();
    if (ORDER_SIZE_LABEL[up]) return ORDER_SIZE_LABEL[up];
    return ORDER_SIZE_LABEL[raw] || '';
}

function head(channel) {
    return channel === 'sms' ? '안녕하세요 제주아꼼이네입니다.' : '안녕하세요 제주아꼼이네입니다 🍊';
}

function reply(judge, opt) {
    const o = opt || {};
    const channel = o.channel === 'sms' ? 'sms' : 'talk';
    const j = judge || {};
    const kind = j.kind;
    const lines = [];

    if (kind === 'not_fruit') return null;

    if (kind === 'damage') {
        lines.push(head(channel), DAMAGE_CORE, DAMAGE_ASK, STAFF_TAIL);
    } else if (kind === 'size') {
        // 손님이 「크다」고 한 사진이면 「작았군요」가 틀린 말이 된다 → 방향을 모르면 「달랐군요」
        //   size_dir 칸이 아예 없으면(옛 호출) 기본 글 「작았군요」 · null(판독이 방향을 모름)이면 「달랐군요」
        const first = j.size_dir === 'big' ? '크기가 생각하신 것보다 컸군요, 불편드려 죄송합니다.'
            : j.size_dir === null ? '크기가 생각하신 것과 달랐군요, 불편드려 죄송합니다.'
                : '크기가 작았군요, 불편드려 죄송합니다.';
        lines.push(head(channel), first);
        // 확신이 낮으면(흐림 · 기준물 없음) 사이즈 글자를 적지 않는다 — 기준 설명만
        const sure = j.confidence === 'high' && SIZES.includes(j.size_guess);
        const prev = orderSizeLabel(o.prevOrder);
        if (sure) lines.push(`사진으로는 ${j.size_guess} 정도로 보여요.` + (prev ? ` 저번에 받으신 건 ${prev}였어요.` : ''));
        else if (prev) lines.push(`저번에 받으신 건 ${prev}였어요.`);
        lines.push(SIZE_GUIDE, SIZE_MEMO, SIZE_RETURN, STAFF_TAIL);
    } else {
        // other · unclear · 알 수 없는 값 — 전부 되묻기 한 벌
        lines.push(head(channel), ASK_CORE);
    }
    return lines.join('\n');
}

/* 손님 글에 숫자·개수·비율이 샜는지 검사(검증·발송 직전 안전망 공용). 걸리면 사유 글, 깨끗하면 ''.
   「2S」 는 사이즈 이름이라 예외. */
function leakCheck(text) {
    const t = String(text || '').replace(/2S/g, '');
    if (/[0-9０-９]/.test(t)) return '숫자';
    if (/(한두|두세|서너|몇|여러)\s*(개|알|과|박스|상자)/.test(t)) return '개수 표현';
    if (/(퍼센트|%|％|절반|반\s*정도|대부분|전부\s*다|분의)/.test(t)) return '비율 표현';
    return '';
}

module.exports = { reply, leakCheck, orderSizeLabel, DAMAGE_CORE, DAMAGE_ASK, SIZE_GUIDE, ASK_CORE, SIZES };
