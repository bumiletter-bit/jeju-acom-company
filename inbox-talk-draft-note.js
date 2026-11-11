/* #1107-D 톡톡 [초안 만들기] — 앞 대화 맥락을 읽고 우리 직원 말투로 쓰는 초안 (순수 · DB·네트워크·AI 호출 없음)
 *
 *   TALK_DRAFT_NOTE : 자동답변 엔진(server.js qnaGenerate)의 system 배열에 channel 'talk_draft' 일 때만 **더하는** 한 블록.
 *                     공용 프롬프트(qnaBuildSystem)·문자(SMS_SYSTEM_NOTE)·자사몰(MALL_SYSTEM_NOTE) 글자는 건드리지 않는다.
 *   turnsFromRows(rows, staffParts) → [{ id, who:'손님'|'봇'|'직원', text, photo }]   message_logs 줄(오래된 순) → 주고받은 글
 *                     표식 줄(「[쿨다운-무응답]」「[1회응대-무응답]」「[SKIP-무응답]」 등 answered=false 인 bot_response)은 손님 글만 살린다.
 *   buildInput(rows, staffParts, opts) → { input, tailIds, staffAmounts } | null
 *                     「[앞 대화 …] … [이번 손님 글 …] …」 꼴. 이번 손님 글 = 마지막 우리 답(봇·직원) 뒤 손님 글(최대 3통 · 종전 tail 과 같은 규칙)
 *   cleanDraft(answer, staffAmounts) → string   「[사람]」 줄·사용시나리오 머리·자동 꼬리·머리글 흉내를 거르고, 보상 문장의 금액을 자리표로
 *   hasPlaceholder(text) → boolean   「0,000원」 자리표가 남았는지(화면·서버 [보내기] 막기와 같은 검사)
 *
 *   본보기 = 워커1 조사(1107-B · 직원 답 772줄) · 대표 확정 ⓒ 문장(11/11)
 */
'use strict';

const PLACEHOLDER = '0,000원';
const PLACEHOLDER_RE = /(^|[^\d,])0,000\s*원/;   // 10,000원 은 자리표가 아님 · 뒤보기 안 씀(화면 ao-inbox.js 와 글자 같게 · 옛 iOS 사파리)
const hasPlaceholder = t => PLACEHOLDER_RE.test(String(t == null ? '' : t));

const TALK_DRAFT_NOTE = `## 지금 채널 — 네이버 톡톡 직원 답 초안 (위 안내보다 우선)
지금 쓰는 글은 공개 게시판 글이 아니라, 톡톡으로 대화 중인 손님 한 분께 우리 직원이 보낼 답의 **초안**입니다. 직원이 읽고 고쳐서 보냅니다(자동으로 나가지 않습니다). 아래를 위 안내보다 먼저 지키세요.
- 위 안내의 「안녕하세요 고객님, 제주아꼼이네입니다 🍊」 시작 · 마지막 줄 꼬리(「*추가 문의사항 …」) · 공개 게시판 규칙 · 「톡톡·고객센터로 연락 주세요」 유도는 이 채널에 쓰지 않습니다(손님은 이미 톡톡으로 우리와 대화 중입니다).
- 위 안내의 「환불·보상·반품을 새로 약속하지 말라」는 이 채널에서는 아래 본보기 범위 안에서 풀립니다(직원이 보고 보냅니다). 단 금액은 정하지 않습니다(아래 「금액」).

### 당신은 우리 직원입니다
- 직원이 직접 쓰는 글로 씁니다. 「직원에게 연결해 드릴게요」 「담당자가 확인 후 연락드리겠습니다」 「전달해 드릴게요」 「상담원」 같은 넘기기 말을 쓰지 마세요. 「저희가 …도와드리겠습니다」 입장으로 씁니다.
- 「[사람]」 「SKIP」 같은 판정 글을 쓰지 마세요. 재료로 답할 수 없는 사실(재료에 없는 가격·날짜·재고)은 지어내지 말고 그 부분만 빼고 쓰세요. 쓸 말이 정말 없을 때만 「SKIP」 한 단어.

### 대화 흐름을 이어 쓰기(가장 중요)
- 「[앞 대화]」는 이 손님과 지금까지 주고받은 톡톡입니다(손님·봇·직원 · 오래된 순). 그 흐름을 이어서 「[이번 손님 글]」에 답하세요. 머리글(「[앞 대화]」 「[이번 손님 글]」)은 답에 쓰지 마세요.
- 앞에서 우리가 이미 인사·사과·반품/보상 선택지를 말했으면, 인사·긴 사과·선택지를 되풀이하지 말고 「네 고객님」으로 시작해 손님이 고른 것의 처리만 짧게 쓰세요.
- 손님 사진이 이미 왔으면(「[사진]」 표시) 사진을 보내 달라고 하지 마세요.
- 앞 대화에서 품목이 나왔으면 그 품목으로 답하세요(다른 품목으로 바꿔 읽지 마세요).
- 손님이 이미 정한 것(발송일·주소 등)을 「이대로 진행해드릴까요?」로 되묻지 마세요. 「네 고객님 ○○로 도와드리겠습니다」처럼 받아 주세요.
- 개수·비율(몇 개 상함, 몇 % 등) 숫자는 손님께 되짚지 마세요.

### 글 쓰는 법(우리 직원 말투)
- 짧게. 대개 150자 안, 길어도 3~4문장. 긴 글은 클레임 첫 응대일 때만.
- 첫마디: 보통 「네 고객님」 · 클레임 첫 응대는 「에고 그러셨군요 ㅠ」 · 「안녕하세요 제주아꼼이네입니다」는 이 대화의 첫 답일 때만.
- 말끝은 「~하구요」 「~드리구요」 「죄송하구요」 같은 말하듯 쓰는 꼴, 「도와드리겠습니다」로 공손하게. 사과는 「불편드려 (다시한번) 죄송합니다」.
- 느낌표·「^^」·「ㅠ」는 써도 됩니다. 이모지(🍊😊🙏📸 등)는 거의 쓰지 마세요.
- 맺음: 「늘 고객님 입장에서 만족드리도록 최선을 다하겠습니다」 「다음에는 꼭 만족드리도록 약속드리겠습니다」 「감사합니다 편안한 하루 되세요 ^^」 중 상황에 맞게 하나둘.
- 「계좌」 「입금」 「이체」 「송금」 「무통장」 「현금으로」는 쓰지 마세요(네이버가 낱말로 경고).

### 금액 — 늘 자리표 「${PLACEHOLDER}」
- 보상·포인트·환불 금액은 직원이 정합니다. 금액 자리는 늘 「${PLACEHOLDER}」로 쓰세요.
- 손님이 부른 금액(「5천원 주세요」 등)은 옮기지 마세요. 「[앞 대화]」에서 **우리 직원**이 이미 금액을 말했으면 그 금액을 그대로 씁니다.
- 지급 전이므로 「지급 도와드리겠습니다」 꼴로 씁니다(「지급했습니다」 X). 포인트는 늘 「고객님 네이버 아이디로 네이버페이 포인트」.

### 주문 정보
- 당신에게는 이 손님의 주문 정보가 없습니다(직원은 톡톡 화면의 구매이력으로 봅니다). 이 손님 주문의 발송·도착·송장을 지어내지 마세요.
- 클레임인데 손님이 주문한 분이 아니라고 하거나(선물 받음 · 다른 분이 주문) 앞 대화에서 우리가 주문을 못 찾았다고 했으면: 사과 + 「주문하신 분 또는 받으신 분 성함과 연락처를 알려 주시면 빠르게 확인 후 처리 도와드리겠습니다」로 여쭈세요.

### 상황별 본보기(이 꼴·말투로 · 글자는 상황에 맞게)
- 반품·보상 선택지는 본보기 ⓐ 문장 꼴 그대로(「괜찮은 상품 드셔보시고 입맛에도 안 맞으시면 무료수거 및 반품처리도 가능하구요, 괜찮다고 하시면 이상 부분 보상처리」) 쓰세요. 새 상품을 다시 보내 준다는 뜻의 말(「다시 받아보시도록」 「새 상품으로 보내 드림」 등)은 쓰지 마세요(농산물이라 교환이 없습니다).
- ⓐ 클레임 첫 응대(파손·무름·곰팡이 · 앞에서 아직 사과 전): 「에고 그러셨군요 ㅠ 불편드려 정말 죄송합니다. 선별 시 미처 보지 못한 상처가 운송 중에 상태가 많이 안 좋아진 것 같습니다. 모두 저희 책임이구요, 괜찮은 상품 드셔보시고 입맛에도 안 맞으시면 무료수거 및 반품처리도 가능하구요, 괜찮다고 하시면 이상 부분 보상처리 도와드리겠습니다. 편하게 말씀해주시면 빠른 처리 도와드리겠습니다!」 (사진이 아직 없으면 끝에 「이상 있는 부분 사진 보내주시면 빠르게 확인 도와드리겠습니다」 한 줄)
- ⓒ 손님이 보상을 고름(「보상해 주세요」 「부분환불」): 「네 고객님 불편드려 다시한번 죄송하구요, 저희가 고객님 네이버 아이디로 네이버페이 포인트 ${PLACEHOLDER} 지급 도와드리겠습니다. 늘 고객님 입장에서 만족드리도록 최선을 다하겠습니다. 다음에는 꼭 만족드리도록 약속드리겠습니다! 감사합니다 편안한 하루 되세요 ^^」
- ⓒ' 손님이 「괜찮아요 · 그냥 먹을게요」: 「너른 이해 감사드립니다 ㅠㅠ 죄송한 마음에 상품 구매해주신 네이버 아이디로 소정의 포인트 넣어드리겠습니다. 다음에 찾아주실 땐 더 꼼꼼히 선별해서 꼭 만족드리겠습니다!」 (이때는 금액 자리표 없이 「소정의 포인트」)
- ⓓ 손님이 반품을 고름: 「네 고객님 반품접수 도와드리겠습니다. 상품은 받으신 주소 문 앞에 미리 꺼내 두시면 택배사가 수거하고, 수거비까지 전액 환불처리 도와드리겠습니다. 믿고 주문해주셨는데 만족드리지 못해 죄송합니다.」
- 교환을 원하면: 「농산물이라 교환이 되지 않아, 새 상품 원하시면 번거로우시겠지만 반품접수 후 재주문 부탁드립니다」 + 반품접수로 도와드려도 될지 여쭘.
- 감사·맺음 인사에는 한 줄로 짧게(「네 감사합니다! 편안한 하루 되세요 ^^」).`;

// ── 주고받은 글 만들기 ──
const STAFF_ONLY = '[직원 직접답변]', PHOTO_ONLY = '[이미지 전송]';
const ENTRY = '이 상품을 문의합니다.', ENTRY2 = '이 상품을 문의합니다';
const TURN_MAX = 10, TURN_CHARS = 300, TAIL_MAX = 3;
const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
function custText(msg) {
    const lines = String(msg || '').split('\n').map(s => s.replace(/^\[메시지\d+\]\s*/, '').trim()).filter(s => s && s !== ENTRY && s !== ENTRY2);
    return lines.map(s => s === PHOTO_ONLY ? '[사진]' : s).join(' ');
}
function turnsFromRows(rows, staffParts) {
    const out = [];
    for (const x of rows || []) {
        const msg = String(x.message || '').trim();
        if (msg && msg !== STAFF_ONLY) {
            let t = custText(msg);
            const photo = /\[사진\]/.test(t) || !!x.image_url;
            if (x.image_url && !/\[사진\]/.test(t)) t = (t ? t + ' ' : '') + '[사진]';
            if (t) out.push({ id: x.id, who: '손님', text: t, photo });
        }
        const b = String(x.bot_response || '').trim();
        if (x.answered && b && !/^\[/.test(b)) out.push({ id: x.id, who: '봇', text: b, photo: false });   // 표식 줄([쿨다운-무응답] 등)은 손님 글만 살림
        for (const p of (typeof staffParts === 'function' ? staffParts(x.staff_response) : [])) if (p && String(p.body || '').trim()) out.push({ id: x.id, who: '직원', text: String(p.body).trim(), photo: false });
    }
    return out;
}
// 금액 꼴(보상 문장에서 자리표로 바꿀 대상) — 숫자(쉼표 · 단위 없어도) · 「3천원·1만 원·5천」(천·만 뒤가 원·포인트 또는 낱말 끝 = 「2천혜향」 안 먹음) · 「12원」 · 한글 금액(오천원·삼천 원·만원·만 오천원 · 원/포인트 있을 때만 = 「만족」 안 먹음)
//   「원」 뒤가 하·한·할이면 금액 아님(「환불만 원하시면」) · 숫자 낱말 없는 「만·천·백」은 앞 빈칸을 안 먹음 · 쉼표 숫자 뒤 개·명·과·박스·kg 이면 금액 아님(「귤 1,000개」)
const AMT_RE = /\d{1,3}(?:,\d{3})+(?![\d,]|\s*(?:개|명|과|박스|kg|KG|키로))(?:\s*(?:원(?![하한할])|포인트))?|\d+(?:\.\d+)?\s*[천만](?:\s*(?:원(?![하한할])|포인트)|(?![가-힣]))|\d+\s*(?:원(?![하한할])|포인트)|(?:(?:[일이삼사오육칠팔구]\s*)?만\s*)?(?:(?:[일이삼사오육칠팔구]\s*)?천\s*)?(?:(?:[일이삼사오육칠팔구]\s*)?백\s*)?(?<=[천만백]\s*)(?:원(?![하한할])|포인트)/g;
const KNUM = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
// 금액 글 → 원(숫자) · 「3천원」 = 「3,000원」 = 「삼천 원」 = 3000 · 못 읽으면 NaN
function toWon(s) {
    const t = String(s).replace(/\s+/g, '').replace(/(원|포인트)$/, '');
    if (/^\d{1,3}(,\d{3})+$/.test(t) || /^\d+$/.test(t)) return Number(t.replace(/,/g, ''));
    let m = t.match(/^(\d+(?:\.\d+)?)([천만])$/); if (m) return Math.round(Number(m[1]) * (m[2] === '천' ? 1000 : 10000));
    if (/^[일이삼사오육칠팔구만천백]+$/.test(t)) { let won = 0, rest = t; for (const [u, v] of [['만', 10000], ['천', 1000], ['백', 100]]) { const i = rest.indexOf(u); if (i >= 0) { const d = rest.slice(0, i); won += (d ? KNUM[d] || NaN : 1) * v; rest = rest.slice(i + 1); } } return rest ? NaN : won; }
    return NaN;
}
const RECENT_DAYS = 7;   // 앞 대화·직원 금액은 최근 7일 줄만(3주 전 다른 건의 금액이 살지 않게) · age 칸 없는 줄(시험)은 최근으로 봄
const recent = x => !(Number(x && x.age) > RECENT_DAYS);
const PHOTO_TURN = t => t.who === '손님' && t.text.replace(/\[사진\]/g, '').trim() === '';
function buildInput(rows, staffParts) {
    const turns = turnsFromRows(rows, staffParts);
    const ageOf = new Map((rows || []).map(x => [x.id, x]));
    if (!turns.some(t => t.who === '손님' && !PHOTO_TURN(t))) return null;
    // 이번 손님 글 = 맨 뒤에서부터 우리 답(봇·직원)을 만나기 전까지의 손님 글(최대 3통 · 사진뿐인 글은 건너뜀 = 종전) · 없으면 사진 아닌 마지막 손님 글 하나
    const tail = []; let photoTail = false;
    for (let i = turns.length - 1; i >= 0 && tail.length < TAIL_MAX; i--) {
        const t = turns[i]; if (t.who !== '손님') break;
        if (PHOTO_TURN(t)) { photoTail = true; continue; }
        tail.unshift(i);
    }
    if (!tail.length) { let j = turns.length - 1; while (j >= 0 && !(turns[j].who === '손님' && !PHOTO_TURN(turns[j]))) j--; if (j < 0) return null; tail.push(j); }
    const first = tail[0];
    const prior = turns.slice(0, first).filter(t => recent(ageOf.get(t.id)));
    const before = prior.slice(-TURN_MAX);
    const staffAmounts = new Set();
    for (const t of prior) if (t.who === '직원') for (const m of t.text.match(AMT_RE) || []) { const v = toWon(m); if (v > 0) staffAmounts.add(v); }
    const photoSeen = photoTail || turns.slice(0, tail[tail.length - 1] + 1).some(t => t.photo);
    const lines = before.map(t => t.who + ': ' + oneLine(t.text).slice(0, TURN_CHARS));
    const now = tail.map(k => oneLine(turns[k].text).slice(0, TURN_CHARS * 2));
    const head = [];
    if (lines.length) head.push('[앞 대화 — 이 손님과 지금까지 주고받은 톡톡 · 오래된 순]', ...lines, '');
    head.push('[이번 손님 글 — 여기에 답하는 직원 초안을 쓰세요]' + (photoTail ? ' (손님이 [사진]도 보냄 · 사진 요청 금지)' : photoSeen ? ' (손님 사진 이미 받음 · 사진 요청 금지)' : ''), ...now);
    return { input: head.join('\n'), tailIds: tail.map(k => turns[k].id), staffAmounts };
}

// ── 결과 거르기 ──
const TAIL_LINE_RE = /^\*?\s*추가\s*문의\s*사항.*(톡톡|카카오톡|고객센터|010-?6687-?4031)/;
const HEAD_ECHO_RE = /^\s*\[(?:앞\s*대화|이번\s*손님\s*글)[^\]]*\]\s*/;
const MONEY_CTX_RE = /포인트|보상|지급|환불|충전/;
function cleanDraft(answer, staffAmounts) {
    let lines = String(answer == null ? '' : answer).replace(/\r\n?/g, '\n').split('\n');
    lines = lines.filter(l => !/^\s*사용시나리오\s*[:：]/.test(l))
        .filter(l => !/[\[［【]\s*사람\s*[\]］】]/.test(l))   // 「[사람] …」 판정 줄은 초안에 넣지 않는다(#1107 실례)
        .filter(l => !TAIL_LINE_RE.test(l.trim()))
        .map(l => l.replace(HEAD_ECHO_RE, ''));
    let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text || /^SKIP\b/.test(text) || /SKIP/.test(text)) return '';
    // 글 어디든 보상 낱말이 있으면 글 전체의 금액 = 우리 직원이 앞에서 말한 금액(숫자로 비교)만 살리고 나머지는 자리표(손님이 부른 금액·AI 가 셈한 금액이 그대로 나가지 않게 · 금액이 다음 문장으로 나뉜 꼴 포함)
    const ok = staffAmounts instanceof Set ? staffAmounts : new Set();
    if (MONEY_CTX_RE.test(text)) text = text.replace(AMT_RE, m => { const v = toWon(m); return (v === 0 || ok.has(v)) ? m : PLACEHOLDER + (/포인트$/.test(m) ? ' 포인트' : ''); });   // 「5천 포인트」 → 「0,000원 포인트」(낱말 보존)
    return text.replace(/0,000\s*원(?:\s*원)+/g, PLACEHOLDER).trim();
}

module.exports = { TALK_DRAFT_NOTE, PLACEHOLDER, PLACEHOLDER_RE, hasPlaceholder, turnsFromRows, buildInput, cleanDraft };
