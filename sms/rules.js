/* #610 회사폰 문자 응대 — AI 없이 규칙으로 답하는 글 (순수 함수 · DB·네트워크·AI 없음)
 *
 *   answer({ text, bucket, order, holidays, now }) → { text, kind, staff, why } | null
 *
 *     text     손님 글(「송장」을 물었는지 보는 데만 쓴다)
 *     bucket   classify.js 결과 — 'ship_q' 일 때만 답한다(그 밖 = null → AI 또는 사람)
 *     order    주문 찾기(워커4 lookup) 결과
 *              { match: 'one'|'many'|'none',
 *                order: { ship_date:'YYYY-MM-DD'|null, partner, option(또는 option_text — lookup.js 는 이 이름), qty, trackings:[운송장 전체…], tracking_tail, delivered, status_label, arrive_text,
 *                         paid_at?(결제 시각 — 있으면 발송 전 계산의 기준) } }
 *              발송 전 주문(#610-H): order = { pre:true, channel, paid_at, option_text, qty, recipient_initial, ship_date:null, memo?(배송메세지) }
 *                → 「주문 확인됐어요 · ○/○(○) 오전 발송 예정이에요 · ○요일(○/○)~○요일(○/○) 사이 도착 예정이에요.」
 *                → paid_at 없음 · 배송메세지에 날짜 요청 · 예약 상품 · 발송 예정일 지남 = staff:true
 *     holidays server.js loadShippingHolidayInfo() 모양 { set, arriveOff, reasons }
 *     now      기준 시각(Date|ms|ISO) — 시험용. 없으면 지금
 *
 *   돌려주는 값
 *     null                       규칙으로 답할 수 없음(주문 못 찾음·배송 물음 아님) → 호출부가 AI 로
 *     { staff:true,  text:'' }   규칙이 「사람이 봐야 한다」고 판단(예약 상품 · 발송 예정일 지남 · 도착 예정일 지남 · 새 주문이 따로 있음 · 택배 문제 상태 · 완료인데 못 받음 · 결제 시각 모름) — why 에 까닭
 *     { staff:false, text, kind } 손님에게 보낼 글. kind = 'ship_before'(아직 안 나감) · 'ship_after'(나감) · 'tracking'(송장을 물음) · null(되묻기)
 *
 *   🔴 발송일·도착일은 shipping-schedule.js 의 computeShipping / computeArrival 만 쓴다(계산기 하나 — 알림톡·톡톡과 같은 답).
 *      여기서는 그 결과 날짜를 「오늘 기준」 말로 옮길 뿐이다(계산기 글의 「내일」은 주문일·발송일 기준이라 며칠 뒤 문자에는 그대로 못 쓴다).
 *   🔴 주소·전화번호 전체는 적지 않는다. 이모지 없음.
 *   #643(대표 10/11 「송장도 고객님 송장이니 다 알려주도록」): 운송장 번호는 전체를 적는다 — 「송장번호 123456789012(CJ대한통운)」 · 상자가 여럿이면 「, 」로 3개까지(넘으면 「외 N」).
 *      조건은 맞춤 답이 나가는 조건 그대로(보낸 번호가 주문의 구매자·받는 분 번호와 전체 일치 + 주문 하나). 여럿(many)이면 되묻기 글만 나가고 번호는 없다.
 *      전체 번호는 lookup 결과의 order.trackings 에서만 읽는다(화면·저장용 toPublic 꼴에는 끝 4자리뿐 — 그 꼴이 오면 「송장 끝 1234」로 물러난다).
 *   #643(대표 10/11 「배송조회 링크 보내주고」「우리 사람 말투처럼 친절히 · ^^ 도 넣고」): 글은 직원이 손으로 쓴 꼴 —
 *      인사(「안녕하세요 고객님 ^^」 · 예·아니오 물음이면 「네 고객님 ^^」) → 사실 한 줄씩(줄바꿈) → 맺음(「행복한 하루 되세요 ^^」).
 *      말투 근거 = 직원이 실제로 쓴 톡톡 답(message_logs.staff_response 2,333건: 「^^」 46% · 「고객님」 31% · 「~니다」 말끝이 「~요」의 2.6배 · 「행복한 하루되세요」 맺음).
 *      발송된(완료 전) 주문 답 끝에 배송조회 주소 한 줄(/track?n=첫 송장번호 — 알림톡 버튼과 같은 주소). 「^^」는 글자 표정이라 문자에서 안 깨진다 · 이모지(그림 글자)는 여전히 금지.
 *   #643(대표 「효돈에서 아니고 제주에서」): 거래처 이름은 손님 글에 쓰지 않는다(내부 정보) — 「제주에서 출발했어요」. 발송 당일이면 「오늘 제주에서 출발했어요」.
 */
'use strict';
const shippingSchedule = require('../shipping-schedule.js');

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;

const HELLO = '안녕하세요 고객님 ^^', YES_HELLO = '네 고객님 ^^', BYE = '행복한 하루 되세요 ^^';
// #646(대표 10/11 「둘째부터 줄이고 마지막에는 감사 인사로」): again = 그 대화에 오늘 우리가 보낸 글이 이미 있음 → 머리 인사 없이 본문부터 · 맺음은 「감사합니다 ^^」
const THANKS = '감사합니다 ^^';
const hello = again => (again ? '' : HELLO + ' ');
const bye = again => (again ? THANKS : BYE);
const askNameText = again => hello(again) + '주문이 여러 건 확인됩니다!\n어느 분께 보내신 건인지 받는 분 성함을 알려 주시면 바로 확인해 드리겠습니다.';
const ASK_NAME_TEXT = askNameText(false);
// #645·#646(대표 「주문자가 없으면 주문자나 수취인을 물어보는 구도」): 보낸 번호로 주문을 못 찾았을 때 — 불만 글이면 사과부터(「^^」 없이)
function notFoundText(o) {
    const a = o || {};
    if (a.claim) return '고객님, 불편드려 죄송합니다.\n보내주신 번호로는 주문이 확인되지 않아, 주문하신 분 또는 받으시는 분 성함과 연락처를 알려 주시면 바로 확인해 드리겠습니다.';
    return hello(a.again) + '보내주신 번호로는 주문이 확인되지 않습니다.\n주문하신 분 또는 받으시는 분 성함과 연락처를 알려 주시면 바로 확인해 드리겠습니다.';
}
// #646 불만 글 고정 답 — 톡톡 시나리오(inquiry_scenarios 3 「상품 파손/불량」· 4 「반품 요청」· 5 「교환 요청」)의 뜻 그대로 · 문자용(이모지·「톡톡」·번호 꼬리·「네이버 페이로」 없음)
//   🔴 금액·개수·비율을 말하지 않는다 · 봇이 정하는 말(「환불해 드리겠습니다」)을 쓰지 않는다 — 「가능하니 말씀해 주시면」까지만. 결정은 직원.
//   상품 상태(파손·부패·무름…)·환불/반품/교환 요청 글에만. 미도착·오배송·누락·수량 글은 이 답이 안 맞는다 → null(사람)
const CLAIM_DAMAGE_RE = /파손|깨졌|깨져|깨진|깨짐|터졌|터져|터진|터짐|찌그러|짓눌|으깨|멍들|눌려|눌렸|썩|곰팡이|부패|상했|상해서|상한|상함|물러|물렀|무른|무름|흐물|시들|벌레|곪|골았|짓무|물컹|변질|불량|하자/;
const CLAIM_REFUND_RE = /환불|반품|교환|보상/;
const CLAIM_OTHER_RE = /안\s*왔|안\s*와|안\s*옴|안\s*오|못\s*받|안\s*받았|받지\s*못|도착\s*안|안\s*도착|배송\s*안|미도착|분실|다른\s*상품|다른\s*게|잘못\s*왔|잘못\s*온|오배송|누락|빠졌|빠져|모자라|덜\s*왔|개수|갯수|사기|신고|소비자원/;
// #650 A: 불만 낱말이 있어도 불만이 아닌 글(「파손 없이 잘 받았습니다」「반품은 안 해도 될 것 같아요」「저번엔 물렀는데 이번엔 좋네요」)에는 이 답을 만들지 않는다
const CLAIM_NOT_RE = /없이|없네|없어요|없습니다|없고|없었|하나도|안\s*해도|안해도|괜찮|좋네|좋아요|좋습니다|맛있|싱싱|잘\s*받|잘\s*왔|잘\s*도착|감사|고맙|만족/;
const CLAIM_ASK_RE = /\?|？|되나요|될까요|되는지|가능한가요|가능할까요|가능한지|가능해요|언제|어떻게|얼마/;
// 자동으로 보내도 되는가 — 상품 상태 낱말(파손·부패·무름…)이 있고 물음이 아닐 때만. 「환불·반품·교환」만 있는 글·물음 꼴은 같은 문구를 초안으로만(직원이 보고 보냄)
function claimAuto(o) {
    const t = String((o && o.text) || '');
    return !!claimText(o) && CLAIM_DAMAGE_RE.test(t) && !CLAIM_ASK_RE.test(t);
}
function claimText(o) {
    const t = String((o && o.text) || '');
    const damage = CLAIM_DAMAGE_RE.test(t), refund = CLAIM_REFUND_RE.test(t);
    if (!(damage || refund) || CLAIM_OTHER_RE.test(t) || CLAIM_NOT_RE.test(t)) return null;
    return ['고객님, 불편드려 죄송합니다.',
        (damage ? '배송 중에 약했던 부분이 상하거나 파손된 것 같습니다. ' : '') + '다음에는 더 꼼꼼하게 선별하겠습니다.',
        '전체적으로 확인해 보시고 이상 있는 부분은 부분 환불 처리도 가능하고, 괜찮은 상품 드셔 보시고 입맛에 안 맞으시면 반품 처리도 가능하니 말씀해 주시면 빠르게 도와드리겠습니다.',
        /교환/.test(t) ? '농산물 특성상 교환은 어려워, 새 상품을 원하시면 반품(무료 수거·전액 환불) 접수 후 재주문으로 도와드리고 있습니다.' : '',
        '이상 있는 부분 사진을 찍어 보내 주시면 더 빠르게 처리해 드리겠습니다.'].filter(Boolean).join('\n');
}
const TRACK_URL = String(process.env.SMS_PUBLIC_URL || 'https://jeju-acom-company.onrender.com').replace(/\/+$/, '') + '/track?n=';   // 서버 /track = CJ 조회로 넘김(알림톡 [택배 배송조회] 버튼과 같은 주소)

const toMs = v => (v == null ? Date.now() : new Date(v).getTime());
function kstYmd(ms) { return new Date(ms + KST_MS).toISOString().slice(0, 10); }
function dayOf(ymd) { return new Date(ymd + 'T00:00:00Z'); }                       // 달력일(UTC 자정) — 요일·간격 계산용
function mdDow(ymd) { const d = dayOf(ymd); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAY_KO[d.getUTCDay()]})`; }
function dowMd(ymd) { const d = dayOf(ymd); return `${DAY_KO[d.getUTCDay()]}요일(${d.getUTCMonth() + 1}/${d.getUTCDate()})`; }
function gap(a, b) { return Math.round((dayOf(b) - dayOf(a)) / DAY_MS); }           // a → b 며칠
// 오늘 기준 말: 오늘 · 내일 · 그 밖은 요일(날짜)
function relDay(ymd, today) {
    const g = gap(today, ymd);
    if (g === 0) return `오늘 ${dowMd(ymd)}`;   // 「오늘 화요일(10/13)」 — 「내일 화요일(10/13)」과 같은 모양(괄호 겹침 없앰)
    if (g === 1) return `내일 ${dowMd(ymd)}`;
    return dowMd(ymd);
}
// 도착 문장 — 남은 후보만. 두 후보가 이어진 날일 때만 범위(arrivePhrase #335 와 같은 규칙)
function arriveSentence(a1, a2, today) {
    const left = [a1, a2].filter(d => d && gap(today, d) >= 0);
    if (!left.length) return null;                                                  // 둘 다 지남 → 호출부가 사람에게
    if (left.length === 2 && gap(left[0], left[1]) === 1) return `${relDay(left[0], today)}~${dowMd(left[1])} 사이 도착 예정`;
    return `${relDay(left[0], today)} 도착 예정`;
}
// 계산기 글 끝의 「(한글날 연휴 휴무로 일요일 발송이에요)」 — 사유 문장만 꺼낸다(계산기가 만든 글자 그대로)
function reasonTail(calcText) {
    const m = String(calcText || '').match(/도착 예정 \((.+)\)\s*$/);
    return m ? m[1].trim() : '';
}
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
// 택배 상태(우리 분류) → 손님에게 하는 말. 여기 없는 분류는 말하지 않는다. 문제 분류(미배송·사고·기타·정보없음·조회실패)는 사람에게 넘긴다
let TROUBLE = ['미배송', '사고', '기타', '정보없음', '조회실패'];
try { const t = require('../cj-track.js').TROUBLE_BUCKETS; if (Array.isArray(t) && t.length) TROUBLE = t; } catch (_) { /* 못 읽으면 위 기본값 */ }
function statusPhrase(label) {
    const s = String(label || '');
    if (/배송\s*완료/.test(s)) return '배송 완료로 확인돼요';
    if (/배송\s*출발/.test(s)) return '배송 기사님이 배송을 시작했습니다';   // #643: 「오늘」을 뺌(앞 문장 「오늘 도착 예정」과 겹침)
    if (/간선/.test(s)) return '배송 지역으로 이동 중입니다';
    if (/집화/.test(s)) return '택배사에 접수되었습니다';
    return '';
}
// #643 운송장 글 — 전체 번호(숫자 10~12자리만 · 겹친 것 한 번) 최대 3개 + 택배사. 전체가 없으면 끝 4자리로 물러난다
const CARRIER = 'CJ대한통운';   // 송장 표(delivery_shipments)는 CJ 접수분만 담는다
const fullTrackings = o => [...new Set((Array.isArray(o.trackings) ? o.trackings : []).map(t => String(t == null ? '' : t).replace(/[^0-9]/g, '')).filter(t => /^\d{10,12}$/.test(t)))];
function trackingText(o) {
    const full = fullTrackings(o);
    if (full.length) return `송장번호 ${full.slice(0, 3).join(', ')}${full.length > 3 ? ` 외 ${full.length - 3}` : ''}(${CARRIER})`;
    const tail = tail4(o.tracking_tail);
    return tail ? `송장 끝 ${tail}` : '';
}
// 「발송됐나요?」처럼 예·아니오로 묻는 글에만 머리에 「네, 」
//   사실이 「네」일 때만 붙인다: 「보냈나요?」(이미 나감 = 네) · 「도착했나요?」는 배송 완료일 때만. 「언제·며칠·몇 시」(때를 묻는 글) · 「안/못/아직」(부정으로 묻는 글)이 있으면 안 붙인다 — 애매하면 안 붙이는 쪽
const YES_Q_RE = /((발송|출발|출고|보내)[^.?!]{0,8}(됐|됬|했|셨|었)|보냈|나갔|부쳤)[^.?!]{0,4}(나요|는지|을까요|습니까|죠|\?|？)/;
const ARRIVED_Q_RE = /(도착|배달|배송\s*완료)[^.?!]{0,8}(됐|됬|했|었)[^.?!]{0,4}(나요|는지|을까요|습니까|죠|\?|？)/;
const NOT_YES_RE = /언제|며칠|몇\s*일|몇\s*시|안\s|안됐|안됬|안했|안왔|못\s|아직/;
const tail4 = s => { const d = String(s == null ? '' : s).replace(/[^0-9]/g, ''); return d.length >= 4 ? d.slice(-4) : ''; };

function answer(input) {
    const a = input || {};
    if (a.bucket !== 'ship_q') return null;
    const found = a.order || {};
    const again = a.again === true;   // #646 오늘 이 대화에 우리 글이 이미 있음
    if (found.match === 'many') return { text: askNameText(again), kind: null, staff: false, why: 'many' };
    if (found.match !== 'one' || !found.order) return null;

    const o = found.order;
    const h = a.holidays || {};
    const nowMs = toMs(a.now);
    const today = kstYmd(nowMs);
    const askedTracking = /송장|운송장/.test(String(a.text || ''));
    const status = clean(o.status_label, 20);
    const q = String(a.text || '');

    // ── 이미 나간 주문 ──
    const shipYmd = o.ship_date ? String(o.ship_date).slice(0, 10) : '';   // 'YYYY-MM-DD' 또는 ISO 글자 어느 쪽이 와도 앞 10자
    if (/^\d{4}-\d{2}-\d{2}$/.test(shipYmd)) {
        const ship = shipYmd;
        // 새로 넣은 주문이 따로 있으면(발송 전 주문 pre_pending) 지난 송장으로 답하지 않는다 — 손님은 새 주문을 묻는 것일 수 있다
        if (Number(found.pre_pending) >= 1) return { text: '', kind: null, staff: true, why: 'new_order_pending' };
        if (TROUBLE.includes(status)) return { text: '', kind: null, staff: true, why: 'trouble' };   // 미배송·사고 등은 그 낱말을 손님에게 말하지 않고 사람이 본다
        if (gap(today, ship) > 0) return { text: '', kind: null, staff: true, why: 'ship_future' };   // 발송일이 앞날로 적힌 줄(자료 오류) — 「출발했어요」라는 틀린 말이 자동으로 나가지 않게 사람이 본다
        const yes = !NOT_YES_RE.test(q) && (YES_Q_RE.test(q) || (!!o.delivered && ARRIVED_Q_RE.test(q)));
        const head = (yes ? YES_HELLO + ' ' : hello(again)) + (gap(today, ship) === 0 ? '오늘' : mdDow(ship)) + ' 제주에서 출발했';   // #643 거래처 이름 없음 · 발송 당일이면 「오늘」 · 말끝은 아래에서
        const tr = trackingText(o);
        if (o.delivered) {
            if (/못\s*받|받지|분실|없어요|어디/.test(q)) return { text: '', kind: null, staff: true, why: 'not_received' };   // 배송 완료로 찍혔는데 못 받았다는 글
            if (!/도착했|받았|완료|송장|운송장/.test(q)) return null;   // 「언제 와요」류 — 이미 받은 지난 주문 이야기가 아닐 수 있다 → 규칙으로 답하지 않는다(AI)
            const lines = [head + '고, 배송 완료로 확인됩니다!', tr, THANKS].filter(Boolean);
            return { text: lines.join('\n'), kind: askedTracking ? 'tracking' : 'ship_after', staff: false, why: 'delivered' };
        }
        // 발송일 낮 12시(KST) 기준으로 계산기에 넣는다 — computeArrival 은 그 날짜의 달력일만 쓴다
        const r = shippingSchedule.computeArrival(new Date(ship + 'T12:00:00+09:00'), h.arriveOff || null, h.reasons || null);
        const arrive = arriveSentence(r.arriveStart, r.arriveEnd, today);
        if (!arrive) return { text: '', kind: null, staff: true, why: 'arrive_overdue' };   // 도착 예정일이 지났는데 완료가 아님 → 사람
        const phrase = o.stale ? '' : statusPhrase(status);   // 택배사 조회가 실패해 옛 상태면(stale) 상태는 말하지 않는다
        const first = fullTrackings(o)[0];
        const lines = [head + '습니다!', tr, arrive + '입니다.' + (r.reason ? ` (${clean(r.reason, 30)})` : ''),
            (phrase && !/완료/.test(phrase)) ? `지금은 ${phrase}.` : '',
            first ? `배송조회 ${TRACK_URL}${first}` : '',   // 상자가 여럿이어도 주소는 첫 송장 하나(번호는 위 줄에 전부)
            bye(again)].filter(Boolean);
        return { text: lines.join('\n'), kind: askedTracking ? 'tracking' : 'ship_after', staff: false, why: 'shipped' };
    }

    // ── 아직 안 나간 주문 ──
    if (/예약/.test(String(o.option || o.option_text || ''))) return { text: '', kind: null, staff: true, why: 'reserve' };   // 예약 상품은 발송일이 따로 있다 — 계산기로 답하지 않는다
    // #610-H 발송 전 주문(order.pre === true — 3채널 「배송준비」에서 찾은 주문 · 송장 없음)
    //   결제 시각을 모르면 계산하지 않는다(「지금」 기준으로 세면 어제 주문을 내일 발송이라 말할 수 있다) · 배송메세지에 날짜 요청이 있으면 사람에게(알림톡은 그 날짜로 안내했을 수 있다)
    const pre = o.pre === true;
    if (pre && (!o.paid_at || o.paid_known === false)) return { text: '', kind: null, staff: true, why: 'pre_no_paid_at' };   // paid_known false = 결제 시각 자리에 「수집기가 처음 본 시각」이 들어 있다(쿠팡·자사몰)
    if (pre && o.memo) {
        let memoLine = null;
        try { memoLine = shippingSchedule.memoShipLine(o.memo, new Date(toMs(o.paid_at)), h.set || null, h.reasons || null, { arriveOff: h.arriveOff || null }); } catch (_) { memoLine = { kind: 'ack' }; }
        if (memoLine) return { text: '', kind: null, staff: true, why: 'memo_date' };
    }
    const base = o.paid_at ? toMs(o.paid_at) : nowMs;
    const r = shippingSchedule.computeShipping(new Date(base), h.set || null, h.reasons || null, { arriveOff: h.arriveOff || null });
    if (gap(today, r.shipDate) < 0) return { text: '', kind: null, staff: true, why: 'ship_overdue' };       // 나갔어야 할 날이 지났는데 발송 기록이 없음 → 사람
    // 오늘 발송분인데 이미 오전이 지났으면 「오늘 오전 발송 예정」이라 말하지 않는다(송장 등록 전일 뿐일 수 있다)
    const kstHour = new Date(nowMs + KST_MS).getUTCHours();
    const shipWhen = gap(today, r.shipDate) === 0
        ? (kstHour < 12 ? `오늘 ${dowMd(r.shipDate)} 오전 발송 예정` : `오늘 ${dowMd(r.shipDate)} 발송분`)
        : `${relDay(r.shipDate, today)} 오전 발송 예정`;
    const arrive = arriveSentence(r.arriveStart, r.arriveEnd, today);
    const why = reasonTail(r.text);
    const lines = [[again ? '' : HELLO, pre ? '주문 확인됐습니다!' : ''].filter(Boolean).join(' '),
        shipWhen + (arrive ? `이고, ${arrive}입니다.` : '입니다.') + (why ? ` (${why})` : ''),
        askedTracking ? `송장번호는 발송되면 ${o.channel === 'coupang' ? '문자로' : '알림톡으로'} 안내드리겠습니다.` : '',   // 발송안내 = 네이버·자사몰은 알림톡 · 쿠팡은 문자
        '잘 포장해서 보내드리겠습니다. ' + bye(again)].filter(Boolean);
    return { text: lines.join('\n'), kind: 'ship_before', staff: false, why: pre ? 'pre' : 'not_shipped' };
}

// #654 직원 화면용: 발송 전 주문의 발송 예정일 글자('10/12(월)') — 위 발송 전 답과 같은 조건·같은 계산기. 답을 만들지 않는 경우(결제 시각 모름 · 예약 상품 · 배송메세지 날짜 요청 · 예정일 지남)는 null
function prePlan(input) {
    try {
        const o = (input && input.order) || {}; const h = (input && input.holidays) || {}; const nowMs = (input && input.now) || Date.now();
        if (o.pre !== true || !o.paid_at || o.paid_known === false) return null;
        if (/예약/.test(String(o.option || o.option_text || ''))) return null;
        if (o.memo) { let ml = null; try { ml = shippingSchedule.memoShipLine(o.memo, new Date(toMs(o.paid_at)), h.set || null, h.reasons || null, { arriveOff: h.arriveOff || null }); } catch (_) { ml = { kind: 'ack' }; } if (ml) return null; }
        const r = shippingSchedule.computeShipping(new Date(toMs(o.paid_at)), h.set || null, h.reasons || null, { arriveOff: h.arriveOff || null });
        const today = new Date(nowMs + KST_MS).toISOString().slice(0, 10);
        if (gap(today, r.shipDate) < 0) return null;
        return mdDow(r.shipDate);
    } catch (e) { return null; }
}

module.exports = { prePlan, answer, ASK_NAME_TEXT, askNameText, notFoundText, claimText, claimAuto, TRACK_URL };
