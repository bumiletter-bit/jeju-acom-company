// #610-G 문자 응대 — 「발송 전 주문」 짧은 보관 (「오늘 주문했는데 언제 와요」에 규칙 답이 나오게)
//   송장 표(delivery_shipments)는 송장이 나온 뒤에만 생긴다 → 아직 안 나간 주문(배송준비)은 3채널 조회 결과를 여기 잠깐 적어 둔다.
//   🔴 적는 것 = 번호 숫자(구매자·받는 분) · 받는 분 성 한 글자 · 옵션 · 수량 · 결제 시각뿐. 주소·이름 전체·배송메모는 받아도 버린다.
//   🔴 이 파일은 3채널 API 를 직접 부르지 않는다 — 조회 함수는 deps 로 받는다(server.js 가 장착):
//        deps.fetchNaver(days)   = naverFetchInvoiceOrders(days, { extended: true })   ← extended 여야 결제 시각(_x.paymentDate)이 온다
//        deps.fetchCoupang(days) = coupangFetchInvoiceOrders(days)                      ← 결제 시각 칸 없음(_paidAt 을 더하면 읽는다) · 번호는 안심번호
//        deps.fetchCafe24(days)  = cafe24.fetchInvoiceOrders(days)                      ← 결제 시각 칸 없음(_paidAt 을 더하면 읽는다)
//      셋 다 { rows: [...] } 를 돌려준다. 하나가 실패해도 나머지는 계속한다(실패한 채널은 「사라진 주문」 셈을 하지 않는다).
//   보관: 한 번 조회에 안 보이면 miss+1 · 두 번 연속 안 보이면 삭제(= 발송됐거나 취소됨) · 마지막으로 본 지 7일 넘은 줄도 삭제(purge).
'use strict';
const { normalizePhone, lookupable } = require('./lookup.js');   // lookup.js 는 이 파일을 함수 안에서(늦게) 부른다 — 서로 물리지 않게

const DDL = [
    `CREATE TABLE IF NOT EXISTS sms_preorders (
        id BIGSERIAL PRIMARY KEY, channel text NOT NULL, order_key text NOT NULL,
        buyer_digits text NOT NULL DEFAULT '', recipient_digits text NOT NULL DEFAULT '', recipient_initial text NOT NULL DEFAULT '',
        option_text text, qty integer, paid_at timestamptz, seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
        miss smallint NOT NULL DEFAULT 0, UNIQUE (channel, order_key))`,
    `CREATE INDEX IF NOT EXISTS idx_sms_pre_recipient ON sms_preorders(recipient_digits) WHERE recipient_digits <> ''`,
    `CREATE INDEX IF NOT EXISTS idx_sms_pre_buyer ON sms_preorders(buyer_digits) WHERE buyer_digits <> ''`,
];
async function initDB(db) { for (const q of DDL) await db.query(q); }

// ── 채널별 줄 → 적을 값 ──  (칸 이름 = server.js / cafe24.js 조회 함수가 내는 그대로)
const str = v => String(v == null ? '' : v).trim();
const digitsOf = v => { const d = normalizePhone(v); return lookupable(d) ? d : ''; };   // 꼴이 아닌 번호(빈칸·가림값)는 빈 글자로
const initialOf = v => { const m = str(v).replace(/\s+/g, '').match(/[가-힣A-Za-z]/); return m ? m[0] : ''; };
function paidOf(v) {
    if (v == null || v === '') return null;
    let s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + '+09:00';   // 시간대 없는 값은 한국 시각으로 본다
    const t = new Date(s).getTime(); return Number.isFinite(t) && t > Date.parse('2020-01-01') && t < Date.now() + 86400e3 ? new Date(t).toISOString() : null;
}
const short = (s, n) => str(s).replace(/\s+/g, ' ').slice(0, n);
const MAPPERS = {
    naver: r => ({ key: str(r._pid), buyer: r['구매자연락처'], recip: r['수취인연락처1'] || r['수취인연락처2'], name: r['수취인명'], opt: r['옵션정보'], qty: r['수량'], paid: (r._x && r._x.paymentDate) || r._paidAt }),
    // 쿠팡 열쇠: 줄에 _shipmentBoxId · _vendorItemId 가 있으면 그것(옵션 이름을 바꿔도 안 변함) · 없으면 종전(주문번호|옵션 글자)
    coupang: r => ({ key: (str(r._shipmentBoxId) || str(r._orderId)) && str(r._vendorItemId) ? (str(r._shipmentBoxId) || str(r._orderId)) + '|' + str(r._vendorItemId) : (str(r._orderId) ? str(r._orderId) + '|' + short(r['노출상품명(옵션명)'] || r['등록상품명'], 60) : ''), buyer: r['구매자전화번호'], recip: r['수취인전화번호'], name: r['수취인이름'], opt: r['노출상품명(옵션명)'] || r['등록상품명'], qty: r['구매수(수량)'], paid: r._paidAt }),
    cafe24: r => ({ key: str(r._orderId) ? str(r._orderId) + '|' + str(r._itemCode) : '', buyer: r['주문자 휴대전화'], recip: r['수령인 휴대전화'], name: r['수령인'], opt: r['주문상품명(세트상품 포함)'], qty: r['수량'], paid: r._paidAt }),
};
function mapRows(channel, rows) {
    const out = new Map(); const map = MAPPERS[channel]; if (!map) return [];
    for (const r of (Array.isArray(rows) ? rows : [])) {
        const m = map(r || {}); if (!m.key) continue;
        const row = { channel, order_key: m.key.slice(0, 120), buyer_digits: digitsOf(m.buyer), recipient_digits: digitsOf(m.recip), recipient_initial: initialOf(m.name),
            option_text: short(m.opt, 200) || null, qty: Math.max(0, parseInt(m.qty, 10) || 0) || null, paid_at: paidOf(m.paid) };
        const cur = out.get(row.order_key);
        if (cur) cur.qty = (cur.qty || 0) + (row.qty || 0) || null; else out.set(row.order_key, row);   // 같은 열쇠가 두 번 오면 수량만 더한다
    }
    return [...out.values()];
}

const SQL_UPSERT = `
    INSERT INTO sms_preorders (channel, order_key, buyer_digits, recipient_digits, recipient_initial, option_text, qty, paid_at, seen_at, miss)
    SELECT $1, k, b, r, i, o, q, p::timestamptz, now(), 0
      FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[]) AS x(k, b, r, i, o, q, p)
    ON CONFLICT (channel, order_key) DO UPDATE SET seen_at = now(), miss = 0, option_text = EXCLUDED.option_text, qty = EXCLUDED.qty,
        buyer_digits = COALESCE(NULLIF(EXCLUDED.buyer_digits, ''), sms_preorders.buyer_digits),
        recipient_digits = COALESCE(NULLIF(EXCLUDED.recipient_digits, ''), sms_preorders.recipient_digits),
        recipient_initial = COALESCE(NULLIF(EXCLUDED.recipient_initial, ''), sms_preorders.recipient_initial),
        paid_at = COALESCE(EXCLUDED.paid_at, sms_preorders.paid_at)`;

// 한 번 모으기 — 돌려주는 값 = { ok, days, channels: { naver: { rows, upserted, missed, removed } | { error } , … }, total }
const CHANNELS = [['naver', 'fetchNaver'], ['coupang', 'fetchCoupang'], ['cafe24', 'fetchCafe24']];
const _emptyOnce = {};   // 채널 → 직전 수집이 「0건 유예」였는가
// 부르는 꼴 둘 다 받는다: collect(db, deps, opts) · collect(deps, opts)  (뒤쪽이면 deps.pool 을 쓴다)
const argsOf = (a, b, c) => (a && typeof a.query === 'function') ? [a, b || {}, c] : [a && (a.pool || a.db), a || {}, b];
async function collect(a, b, c) {
    const [db, deps, opts] = argsOf(a, b, c); if (!db || typeof db.query !== 'function') throw new Error('preorders.collect: DB(pool)가 없습니다');
    const days = Math.max(1, Math.min(10, parseInt(opts && opts.days, 10) || 7)); const out = { ok: true, days, channels: {} };
    for (const [ch, fn] of CHANNELS) {
        if (!deps || typeof deps[fn] !== 'function') continue;
        let rows;
        try { const r = await deps[fn](days); rows = mapRows(ch, Array.isArray(r) ? r : (r && r.rows)); }
        catch (e) { out.channels[ch] = { error: String(e && (e.reason || e.message) || e).slice(0, 120) }; out.ok = false; continue; }   // 조회 실패 = 이 채널은 건드리지 않는다
        let upserted = 0;
        for (let k = 0; k < rows.length; k += 500) {
            const p = rows.slice(k, k + 500);
            upserted += (await db.query(SQL_UPSERT, [ch, p.map(x => x.order_key), p.map(x => x.buyer_digits), p.map(x => x.recipient_digits), p.map(x => x.recipient_initial),
                p.map(x => x.option_text), p.map(x => x.qty), p.map(x => x.paid_at)])).rowCount;
        }
        // F4(R3 M4): 조회는 성공했는데 0건이고 표에는 이 채널 줄이 있으면 — 일시적인 빈 응답일 수 있어 한 회는 그대로 둔다(연속 두 번째 0건부터 평소대로 센다 · 셈은 메모리)
        if (!rows.length) {
            const have = (await db.query(`SELECT count(*)::int AS n FROM sms_preorders WHERE channel = $1`, [ch])).rows[0].n;
            if (have > 0 && !_emptyOnce[ch]) { _emptyOnce[ch] = true; out.channels[ch] = { rows: 0, upserted: 0, missed: 0, removed: 0, grace: true }; continue; }
        } else _emptyOnce[ch] = false;
        const keys = rows.map(x => x.order_key);   // 이번에 안 보인 줄 = miss+1 · 두 번째면 삭제
        const missed = (await db.query(`UPDATE sms_preorders SET miss = miss + 1 WHERE channel = $1 AND NOT (order_key = ANY($2::text[]))`, [ch, keys])).rowCount;
        const removed = (await db.query(`DELETE FROM sms_preorders WHERE channel = $1 AND miss >= 2`, [ch])).rowCount;
        out.channels[ch] = { rows: rows.length, upserted, missed: missed - removed, removed };
    }
    out.total = (await db.query(`SELECT count(*)::int AS n FROM sms_preorders`)).rows[0].n;
    return out;
}
// 오래된 줄 지우기 — 마지막으로 본 지 days(기본 7)일 넘은 것(수집이 멈췄을 때 손님 번호가 남지 않게)
async function purge(db, days) {
    const d = Math.max(1, parseInt(days, 10) || 7);
    return (await db.query(`DELETE FROM sms_preorders WHERE seen_at < now() - ($1 || ' days')::interval`, [String(d)])).rowCount;
}

// 주기 실행은 sms/index.js watchTick 이 한다(설정 sms_gateway.preorders === true · 60분 1회 · 한국 01~07시 쉼 · 'sms_preorders_last' 기록) — 여기에는 주기 함수를 두지 않는다(F4).

// ── 번호로 찾기(발송 전) ──  같은 채널 · 같은 받는 분(번호 + 성) · 같은 결제일(한국 날짜) = 한 건.
//   name = 되묻기로 받은 받는 분 성함(다듬은 것) — 여기에는 성 한 글자만 있어 첫 글자로만 좁힌다 · 🔴 이름이 3글자 이상일 때만(F4 — 「정말」「최고」 같은 두 글자 말이 성으로 읽히지 않게).
const SQL_PRE = `
    SELECT p.channel, min(p.recipient_initial) AS recipient_initial,
           bool_or(p.recipient_digits = $1) AS is_recipient, bool_or(p.buyer_digits = $1) AS is_buyer,
           min(COALESCE(p.paid_at, p.created_at)) AS paid_at, bool_and(p.paid_at IS NOT NULL) AS paid_known,
           array_remove(array_agg(DISTINCT NULLIF(btrim(p.option_text), '')), NULL) AS options, COALESCE(sum(p.qty), 0)::int AS qty, count(*)::int AS lines,
           (char_length($3) >= 3 AND min(p.recipient_initial) = left($3, 1)) AS name_prefix
      FROM sms_preorders p
     WHERE (p.recipient_digits = $1 OR p.buyer_digits = $1) AND p.miss = 0
       AND COALESCE(p.paid_at, p.created_at) >= now() - ($2 || ' days')::interval
     GROUP BY p.channel, p.recipient_digits, p.recipient_initial, (COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'Asia/Seoul')::date
     ORDER BY min(COALESCE(p.paid_at, p.created_at)) DESC`;
async function lookupPre(db, phone, opts) {
    const d = normalizePhone(phone); if (!lookupable(d)) return { match: 'none', role: null, order: null, candidates: 0, why: 'bad-phone' };
    const days = Math.max(1, Math.min(60, parseInt(opts && opts.days, 10) || 14)); const name = String((opts && opts.name) || '');
    let groups;
    try { groups = (await db.query(SQL_PRE, [d, String(days), name])).rows; }
    catch (e) { if (e && e.code === '42P01') return { match: 'none', role: null, order: null, candidates: 0, why: 'no-table' }; throw e; }   // 표가 아직 없으면(배포 전) 없는 것으로
    if (!groups.length) return { match: 'none', role: null, order: null, candidates: 0 };
    const R = groups.filter(g => g.is_recipient), B = groups.filter(g => !g.is_recipient);
    let pick = null, role = null, narrowed;
    if (R.length === 1 && B.length === 0) { pick = R[0]; role = 'recipient'; }
    else if (R.length === 0 && B.length === 1) { pick = B[0]; role = 'buyer'; }
    else if (name) {
        const hit = groups.filter(g => g.name_prefix);
        if (hit.length === 1) { pick = hit[0]; role = pick.is_recipient ? 'recipient' : 'buyer'; narrowed = 'surname'; }
        else return { match: 'many', role: null, order: null, candidates: groups.length, why: hit.length ? 'name-multi' : 'name-no-match', pre: true };
    }
    if (!pick) return { match: 'many', role: null, order: null, candidates: groups.length, why: R.length && B.length ? 'both-roles' : 'multi-orders', pre: true };
    const order = { pre: true, channel: pick.channel, paid_at: new Date(pick.paid_at).toISOString(), paid_known: !!pick.paid_known, option_text: (pick.options || []).join(' + ') || null,
        qty: pick.qty || null, recipient_initial: pick.recipient_initial || null, ship_date: null, delivered: false, status_label: null, tracking_tail: null, boxes: null };
    const out = { match: 'one', role, order, candidates: groups.length }; if (narrowed) out.narrowed = narrowed;
    return out;
}

module.exports = { DDL, initDB, mapRows, collect, purge, lookupPre, MAPPERS, _resetGrace: () => { for (const k of Object.keys(_emptyOnce)) delete _emptyOnce[k]; } };
