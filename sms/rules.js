/* #610 회사폰 문자 응대 — AI 없이 규칙으로 답하는 글 (순수 함수 · DB·네트워크·AI 없음)
 *
 *   answer({ text, bucket, order, holidays, now }) → { text, kind, staff, why } | null
 *
 *     text     손님 글(「송장」을 물었는지 보는 데만 쓴다)
 *     bucket   classify.js 결과 — 'ship_q' 일 때만 답한다(그 밖 = null → AI 또는 사람)
 *     order    주문 찾기(워커4 lookup) 결과
 *              { match: 'one'|'many'|'none',
 *                order: { ship_date:'YYYY-MM-DD'|null, partner, option(또는 option_text — lookup.js 는 이 이름), qty, tracking_tail, delivered, status_label, arrive_text,
 *                         paid_at?(결제 시각 — 있으면 발송 전 계산의 기준) } }
 *              발송 전 주문(#610-H): order = { pre:true, channel, paid_at, option_text, qty, recipient_initial, ship_date:null, memo?(배송메세지) }
 *                → 「주문 확인됐어요 · ○/○(○) 오전 발송 예정이에요 · ○요일(○/○)~○요일(○/○) 사이 도착 예정이에요.」
 *                → paid_at 없음 · 배송메세지에 날짜 요청 · 예약 상품 · 발송 예정일 지남 = staff:true
 *     holidays server.js loadShippingHolidayInfo() 모양 { set, arriveOff, reasons }
 *     now      기준 시각(Date|ms|ISO) — 시험용. 없으면 지금
 *
 *   돌려주는 값
 *     null                       규칙으로 답할 수 없음(주문 못 찾음·배송 물음 아님) → 호출부가 AI 로
 *     { staff:true,  text:'' }   규칙이 「사람이 봐야 한다」고 판단(예약 상품 · 발송 예정일 지남 · 도착 예정일 지남) — why 에 까닭
 *     { staff:false, text, kind } 손님에게 보낼 글. kind = 'ship_before'(아직 안 나감) · 'ship_after'(나감) · 'tracking'(송장을 물음) · null(되묻기)
 *
 *   🔴 발송일·도착일은 shipping-schedule.js 의 computeShipping / computeArrival 만 쓴다(계산기 하나 — 알림톡·톡톡과 같은 답).
 *      여기서는 그 결과 날짜를 「오늘 기준」 말로 옮길 뿐이다(계산기 글의 「내일」은 주문일·발송일 기준이라 며칠 뒤 문자에는 그대로 못 쓴다).
 *   🔴 주소·전화번호 전체·운송장 전체는 적지 않는다 — 운송장은 끝 4자리(tracking_tail)만. 이모지 없음.
 */
'use strict';
const shippingSchedule = require('../shipping-schedule.js');

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;

const ASK_NAME_TEXT = '주문이 여러 건 확인돼요. 어느 분께 보내신 건인지 받는 분 성함을 알려 주시면 바로 확인해 드릴게요.';

const toMs = v => (v == null ? Date.now() : new Date(v).getTime());
function kstYmd(ms) { return new Date(ms + KST_MS).toISOString().slice(0, 10); }
function dayOf(ymd) { return new Date(ymd + 'T00:00:00Z'); }                       // 달력일(UTC 자정) — 요일·간격 계산용
function mdDow(ymd) { const d = dayOf(ymd); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAY_KO[d.getUTCDay()]})`; }
function dowMd(ymd) { const d = dayOf(ymd); return `${DAY_KO[d.getUTCDay()]}요일(${d.getUTCMonth() + 1}/${d.getUTCDate()})`; }
function gap(a, b) { return Math.round((dayOf(b) - dayOf(a)) / DAY_MS); }           // a → b 며칠
// 오늘 기준 말: 오늘 · 내일 · 그 밖은 요일(날짜)
function relDay(ymd, today) {
    const g = gap(today, ymd);
    if (g === 0) return `오늘(${mdDow(ymd)})`;
    if (g === 1) return `내일 ${dowMd(ymd)}`;
    return dowMd(ymd);
}
// 도착 문장 — 남은 후보만. 두 후보가 이어진 날일 때만 범위(arrivePhrase #335 와 같은 규칙)
function arriveSentence(a1, a2, today) {
    const left = [a1, a2].filter(d => d && gap(today, d) >= 0);
    if (!left.length) return null;                                                  // 둘 다 지남 → 호출부가 사람에게
    if (left.length === 2 && gap(left[0], left[1]) === 1) return `${relDay(left[0], today)}~${dowMd(left[1])} 사이 도착 예정이에요`;
    return `${relDay(left[0], today)} 도착 예정이에요`;
}
// 계산기 글 끝의 「(한글날 연휴 휴무로 일요일 발송이에요)」 — 사유 문장만 꺼낸다(계산기가 만든 글자 그대로)
function reasonTail(calcText) {
    const m = String(calcText || '').match(/도착 예정 \((.+)\)\s*$/);
    return m ? m[1].trim() : '';
}
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const tail4 = s => { const d = String(s == null ? '' : s).replace(/[^0-9]/g, ''); return d.length >= 4 ? d.slice(-4) : ''; };

function answer(input) {
    const a = input || {};
    if (a.bucket !== 'ship_q') return null;
    const found = a.order || {};
    if (found.match === 'many') return { text: ASK_NAME_TEXT, kind: null, staff: false, why: 'many' };
    if (found.match !== 'one' || !found.order) return null;

    const o = found.order;
    const h = a.holidays || {};
    const nowMs = toMs(a.now);
    const today = kstYmd(nowMs);
    const askedTracking = /송장|운송장/.test(String(a.text || ''));
    const tail = tail4(o.tracking_tail);
    const partner = clean(o.partner, 12);
    const status = clean(o.status_label, 20);

    // ── 이미 나간 주문 ──
    if (o.ship_date && /^\d{4}-\d{2}-\d{2}$/.test(String(o.ship_date))) {
        const ship = String(o.ship_date);
        const head = `${mdDow(ship)} ${partner ? partner + '에서 ' : ''}출발했어요`;
        const tr = tail ? `송장 끝 ${tail}` : '';
        if (o.delivered) {
            const parts = [head, tr, '배송 완료로 확인돼요'].filter(Boolean);
            return { text: parts.join(' · ') + '.', kind: askedTracking ? 'tracking' : 'ship_after', staff: false, why: 'delivered' };
        }
        // 발송일 낮 12시(KST) 기준으로 계산기에 넣는다 — computeArrival 은 그 날짜의 달력일만 쓴다
        const r = shippingSchedule.computeArrival(new Date(ship + 'T12:00:00+09:00'), h.arriveOff || null, h.reasons || null);
        const arrive = arriveSentence(r.arriveStart, r.arriveEnd, today);
        if (!arrive) return { text: '', kind: null, staff: true, why: 'arrive_overdue' };   // 도착 예정일이 지났는데 완료가 아님 → 사람
        const parts = [head, tr, arrive + (r.reason ? ` (${clean(r.reason, 30)})` : '')].filter(Boolean);
        let text = parts.join(' · ');
        text += /[.!?]$/.test(text) ? '' : '.';
        if (status) text += ` 배송 상태: ${status}`;
        return { text, kind: askedTracking ? 'tracking' : 'ship_after', staff: false, why: 'shipped' };
    }

    // ── 아직 안 나간 주문 ──
    if (/예약/.test(String(o.option || o.option_text || ''))) return { text: '', kind: null, staff: true, why: 'reserve' };   // 예약 상품은 발송일이 따로 있다 — 계산기로 답하지 않는다
    // #610-H 발송 전 주문(order.pre === true — 3채널 「배송준비」에서 찾은 주문 · 송장 없음)
    //   결제 시각을 모르면 계산하지 않는다(「지금」 기준으로 세면 어제 주문을 내일 발송이라 말할 수 있다) · 배송메세지에 날짜 요청이 있으면 사람에게(알림톡은 그 날짜로 안내했을 수 있다)
    const pre = o.pre === true;
    if (pre && !o.paid_at) return { text: '', kind: null, staff: true, why: 'pre_no_paid_at' };
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
        ? (kstHour < 12 ? `오늘(${mdDow(r.shipDate)}) 오전 발송 예정이에요` : `오늘(${mdDow(r.shipDate)}) 발송분이에요`)
        : `${relDay(r.shipDate, today)} 오전 발송 예정이에요`;
    const arrive = arriveSentence(r.arriveStart, r.arriveEnd, today);
    const why = reasonTail(r.text);
    let text = (pre ? '주문 확인됐어요 · ' : '') + shipWhen + (arrive ? ` · ${arrive}` : '') + '.';
    if (why) text += ` (${why})`;
    if (askedTracking) text += ' 송장 번호는 발송되면 알림으로 보내 드려요.';
    return { text, kind: 'ship_before', staff: false, why: pre ? 'pre' : 'not_shipped' };
}

module.exports = { answer, ASK_NAME_TEXT };
