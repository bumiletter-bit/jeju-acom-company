// #610-C 문자 응대 — 「발신 번호 → 그 손님의 최근 주문 하나」 찾기 (서버·창구 공용 · AI 호출 없음 · 외부 발송 없음)
//   자료 = delivery_shipments(#594 송장 표 · phone_digits = 수취인 번호 숫자만 · buyer_digits = 구매자 번호 숫자만) + delivery_status(CJ 배송 상태).
//   규칙(총괄 확정 10/10): ①수취인 번호가 맞는 주문(같은 날·같은 받는 분 상자 여럿 = 한 건) ②없으면 구매자 번호 ③둘 다 걸리거나 2건 이상 = many(되묻기) ④0 = none.
//   🔴 이 모듈의 SELECT 는 주소·전화번호·배송메모·받는 분 이름 전체를 아예 읽지 않는다(받는 분은 성 한 글자만 DB 에서 잘라 온다).
//   🔴 답 글을 만드는 쪽은 lookupByPhone 결과를 그대로 쓰지 말고 toPublic() 을 거친 것만 쓴다(운송장 전체·기사 정보가 빠진다).
const path = require('path');

// ── 번호 정리 ──  숫자만 · 국가번호(+82 / 82)는 0 으로 · 050 안심번호는 그대로(손님 실제 번호와는 원래 안 맞는다)
function normalizePhone(s) {
    const raw = String(s == null ? '' : s);
    let d = raw.replace(/[^0-9]/g, '');
    if (/^\s*\+\s*82/.test(raw) || (/^82/.test(d) && d.length >= 11)) { d = d.slice(2); if (d[0] !== '0') d = '0' + d; }
    return d;
}
// 찾아볼 만한 번호인가 — 0 으로 시작하는 9~12자리만(빈 글자·짧은 번호로 찾으면 번호 없는 줄 전부가 걸린다)
const lookupable = d => /^0\d{8,11}$/.test(String(d || ''));

// ── 구매자 번호 짝짓기(송장 올리기 공용) ──  송장 엑셀 첫 시트의 「받는 분 번호 + 받는 분 이름 → 구매자 번호」.
//   운송장 시트에는 구매자 번호가 없어 이 열쇠로 붙인다. 같은 열쇠에 구매자 번호가 둘 이상(두 사람이 같은 분께 같은 날 보냄)이면 붙이지 않는다 — 틀린 번호보다 빈칸.
const pairKey = (scope, phone, name) => String(scope || '') + '\u0001' + normalizePhone(phone) + '\u0001' + String(name || '').replace(/\s+/g, '');
function makeBuyerIndex() {
    const m = new Map();
    return {
        add(scope, recipientPhone, recipientName, buyerPhone) {
            const b = normalizePhone(buyerPhone); if (!lookupable(b)) return;
            const k = pairKey(scope, recipientPhone, recipientName); let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(b);
        },
        // 돌려주는 값 = { buyer: '010…' | null, why: 'one' | 'ambiguous' | 'none' }
        find(scope, recipientPhone, recipientName) {
            const s = m.get(pairKey(scope, recipientPhone, recipientName));
            if (!s || !s.size) return { buyer: null, why: 'none' };
            if (s.size > 1) return { buyer: null, why: 'ambiguous' };
            return { buyer: [...s][0], why: 'one' };
        },
        size: () => m.size,
    };
}

// ── 번호로 찾기 ──
const SQL_HIT = `
    SELECT s.ship_date::text AS ship_date,
           left(btrim(min(s.recipient)), 1) AS recipient_initial,
           bool_or(s.phone_digits = $1) AS is_recipient,
           bool_or(s.buyer_digits = $1) AS is_buyer,
           array_agg(s.tracking ORDER BY s.tracking) AS trackings,
           array_remove(array_agg(DISTINCT NULLIF(btrim(s.partner), '')), NULL) AS partners,
           array_remove(array_agg(DISTINCT NULLIF(btrim(s.option_text), '')), NULL) AS options,
           COALESCE(sum(s.qty), 0)::int AS qty,
           ($3 <> '' AND regexp_replace(COALESCE(s.recipient, ''), '[[:space:]]+', '', 'g') = $3) AS name_exact,
           ($3 <> '' AND left(regexp_replace(COALESCE(s.recipient, ''), '[[:space:]]+', '', 'g'), char_length($3)) = $3) AS name_prefix
      FROM delivery_shipments s
     WHERE (s.phone_digits = $1 OR s.buyer_digits = $1)
       AND s.ship_date >= (now() AT TIME ZONE 'Asia/Seoul')::date - $2::int
     GROUP BY s.ship_date, regexp_replace(COALESCE(s.recipient, ''), '[[:space:]]+', '', 'g')
     ORDER BY s.ship_date DESC`;
const SQL_STATUS = `SELECT tracking, bucket, label, event_time, delivered, checked_at FROM delivery_status WHERE tracking = ANY($1::text[])`;

function fillStatus(order, rows) {
    const by = new Map(rows.map(r => [r.tracking, r]));
    const st = order.trackings.map(t => by.get(t) || null);
    const pending = order.trackings.findIndex((t, i) => !(st[i] && st[i].delivered));   // 아직 안 끝난 상자가 있으면 그 상자가 대표
    const at = pending >= 0 ? pending : 0; const rep = st[at];
    order.tracking = order.trackings[at]; order.tracking_tail = order.tracking.slice(-4);
    order.delivered = pending < 0;
    order.status_label = rep ? (rep.bucket || rep.label || null) : null;   // 우리 분류(배송완료 · 배송출발 · 간선상하차 · 집화 · 미배송 …) — CJ 원문(msg)은 기사 이름이 들어 있어 쓰지 않는다
    order.status_step = rep ? (rep.label || null) : null;
    order.event_time = rep ? (rep.event_time || null) : null;
    order.checked_at = rep && rep.checked_at ? new Date(rep.checked_at).toISOString() : null;
    order.boxes_delivered = st.filter(x => x && x.delivered).length;
    return order;
}

// 되묻기 답으로 받은 「받는 분 성함」 다듬기 — 공백·기호를 빼고 끝의 님/씨/분/께/이요/요/입니다 같은 말꼬리를 뗀다(이름 비교는 DB 안에서만 한다)
function normalizeName(s) {
    let n = String(s == null ? '' : s).replace(/[^가-힣A-Za-z]/g, '');
    n = n.replace(/(입니다|이에요|이예요|예요|에요|이요|요)$/, '').replace(/(님께|님|씨|분|께)$/, '');
    return n.slice(0, 20);
}
// db = pool 또는 client(.query 만 쓴다). 돌려주는 값 = { match, role, order, candidates, why? }
//   opts.recipientName = many 일 때 되묻기로 받은 받는 분 성함. 이름 전체가 맞는 묶음이 하나면 one · 없으면 앞글자(성만 · 두 글자까지)가 맞는 묶음이 하나일 때만 one · 그 밖은 many 그대로.
async function lookupShipped(db, phone, opts) {
    const days = Math.max(1, Math.min(60, parseInt(opts && opts.days, 10) || 14));
    const d = normalizePhone(phone);
    if (!lookupable(d)) return { match: 'none', role: null, order: null, candidates: 0, why: 'bad-phone' };
    const name = normalizeName(opts && opts.recipientName);
    const groups = (await db.query(SQL_HIT, [d, days, name])).rows;
    const R = groups.filter(g => g.is_recipient), B = groups.filter(g => !g.is_recipient);
    const candidates = groups.length;
    if (!candidates) return { match: 'none', role: null, order: null, candidates: 0 };
    let pick = null, role = null;
    if (R.length === 1 && B.length === 0) { pick = R[0]; role = 'recipient'; }
    else if (R.length === 0 && B.length === 1) { pick = B[0]; role = 'buyer'; }
    let narrowed;
    if (!pick && name) {   // 2차 조회 — 이름으로 좁히기(역할은 그 묶음 것)
        const exact = groups.filter(g => g.name_exact); const pre = exact.length || name.length > 2 ? [] : groups.filter(g => g.name_prefix);
        const hit = exact.length ? exact : pre;
        if (hit.length === 1) { pick = hit[0]; role = pick.is_recipient ? 'recipient' : 'buyer'; narrowed = exact.length ? 'name' : 'surname'; }
        else return { match: 'many', role: null, order: null, candidates, why: hit.length ? 'name-multi' : 'name-no-match' };
    }
    if (!pick) return { match: 'many', role: null, order: null, candidates, why: R.length && B.length ? 'both-roles' : 'multi-orders' };
    const order = {
        ship_date: pick.ship_date, partner: (pick.partners || []).join(' · ') || null, option_text: (pick.options || []).join(' + ') || null,
        qty: pick.qty || null, boxes: pick.trackings.length, trackings: pick.trackings, recipient_initial: pick.recipient_initial || null,
    };
    fillStatus(order, (await db.query(SQL_STATUS, [order.trackings])).rows);
    return narrowed ? { match: 'one', role, order, candidates, narrowed } : { match: 'one', role, order, candidates };
}

// #610-G 송장 표에 없으면 「발송 전 주문」(sms_preorders · sms/preorders.js)을 본다. 송장 표에 하나라도 있으면 그쪽이 먼저다(이미 나간 것 우선) —
//   그때 발송 전 주문도 있으면 건수만 pre_pending 으로 알려 준다(「새로 주문한 건」을 묻는 것일 수 있다 · 답 글을 만드는 쪽이 판단).
//   발송 전 주문의 order = { pre:true, channel, paid_at, paid_known, option_text, qty, recipient_initial, ship_date:null, delivered:false, status_label:null, tracking_tail:null }
//   opts.pre === false 면 송장 표만 본다.
async function lookupByPhone(db, phone, opts) {
    const r = await lookupShipped(db, phone, opts);
    if (r.why === 'bad-phone' || (opts && opts.pre === false)) return r;
    const pre = await require('./preorders.js').lookupPre(db, phone, { days: opts && opts.days, name: normalizeName(opts && opts.recipientName) });
    if (r.match === 'none') return pre.match === 'none' ? r : pre;
    if (pre.candidates) r.pre_pending = pre.candidates;
    return r;
}

// ── 배송 상태 새로 묻기 ──  배송완료가 아니고 마지막 확인이 maxAgeMs(기본 2시간)보다 오래됐으면 CJ 에 한 건 다시 묻고 표에 적는다.
//   적는 꼴은 server.js deliveryUpsertStatus 와 같다(handled_at/by 는 건드리지 않는다). 조회 실패면 있던 줄을 그대로 두고 stale:true 로 돌려준다.
const SQL_UPSERT = `INSERT INTO delivery_status (tracking, bucket, code, label, msg, event_time, branch, driver_name, driver_phone, events, delivered, checked_at, first_trouble_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11, now(), CASE WHEN $12 THEN now() ELSE NULL END)
        ON CONFLICT (tracking) DO UPDATE SET bucket = EXCLUDED.bucket, code = EXCLUDED.code, label = EXCLUDED.label, msg = EXCLUDED.msg, event_time = EXCLUDED.event_time,
            branch = EXCLUDED.branch, driver_name = EXCLUDED.driver_name, driver_phone = EXCLUDED.driver_phone, events = EXCLUDED.events, delivered = EXCLUDED.delivered, checked_at = now(),
            first_trouble_at = CASE WHEN $12 THEN COALESCE(delivery_status.first_trouble_at, now()) ELSE NULL END`;
async function refreshStatus(db, tracking, opts) {
    const o = opts || {}; const maxAge = o.maxAgeMs == null ? 2 * 3600e3 : o.maxAgeMs;
    const tr = String(tracking || '').replace(/\D/g, ''); if (!/^\d{10,12}$/.test(tr)) return null;
    const read = async () => (await db.query(SQL_STATUS, [[tr]])).rows[0] || null;
    const cur = await read();
    if (cur && cur.delivered) return Object.assign(cur, { refreshed: false });
    if (cur && !o.force && cur.checked_at && Date.now() - new Date(cur.checked_at).getTime() < maxAge) return Object.assign(cur, { refreshed: false });
    const cj = o.cj || require(path.join(__dirname, '..', 'cj-track.js'));
    let k; try { k = await cj.trackOne(tr); } catch (e) { k = { bucket: '조회실패' }; }
    if (!k || k.bucket === '조회실패') return cur ? Object.assign(cur, { refreshed: false, stale: true }) : null;
    const trouble = (cj.TROUBLE_BUCKETS || ['미배송', '사고', '기타', '정보없음', '조회실패']).includes(k.bucket);
    await db.query(SQL_UPSERT, [tr, k.bucket, k.code || '', k.label || '', k.msg || '', k.time || '', k.branch || '', k.driver ? k.driver.name : null, k.driver ? k.driver.phone : null,
        JSON.stringify(k.events || []), !!k.delivered, trouble]);
    const now = await read(); return now ? Object.assign(now, { refreshed: true }) : null;
}
// 찾은 주문(one)의 상자들 상태를 새로 묻고 결과에 다시 채운다 — 한 번에 maxBoxes(기본 3) 상자까지만
async function refreshOrder(db, result, opts) {
    if (!result || result.match !== 'one' || !result.order || result.order.pre || !Array.isArray(result.order.trackings)) return result;   // 발송 전 주문은 물을 운송장이 없다
    const o = opts || {}; let stale = false;
    for (const tr of result.order.trackings.slice(0, o.maxBoxes || 3)) { const r = await refreshStatus(db, tr, o); if (r && r.stale) stale = true; }
    fillStatus(result.order, (await db.query(SQL_STATUS, [result.order.trackings])).rows);
    if (stale) result.order.stale = true;
    return result;
}

// ── 답 글에 써도 되는 것만 ──  허용 목록 방식(새 칸이 생겨도 여기 적지 않으면 밖으로 안 나간다)
const PUBLIC_ORDER = ['ship_date', 'partner', 'option_text', 'qty', 'boxes', 'boxes_delivered', 'tracking_tail', 'recipient_initial', 'delivered', 'status_label', 'event_time', 'checked_at', 'stale', 'pre', 'channel', 'paid_at', 'paid_known'];
function toPublic(result) {
    const r = result || {}; const out = { match: r.match || 'none', role: r.role || null, candidates: r.candidates || 0, order: null };
    if (r.pre_pending) out.pre_pending = r.pre_pending;
    if (r.match === 'one' && r.order) { out.order = {}; for (const k of PUBLIC_ORDER) if (r.order[k] !== undefined) out.order[k] = r.order[k]; }
    return out;
}

module.exports = { lookupShipped, normalizeName, normalizePhone, lookupable, makeBuyerIndex, lookupByPhone, refreshStatus, refreshOrder, toPublic, PUBLIC_ORDER };
