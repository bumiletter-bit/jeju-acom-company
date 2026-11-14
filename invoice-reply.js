/* #1151(대표 11/14 「송장번호 알려주세요·개별송장 알려주세요 = [초안 만들기] 누르면 일주일 안 나간 주문의 받는 분 성함·송장번호·CJ대한통운이 나오게」)
 *
 *   손님 연락 [초안 만들기] 4채널(문자·톡톡·상품문의·주문문의) 공용 — 요청 판정은 server.js invoiceReq(#1112)를 그대로 받아 씀(넓히지 않음)
 *   · 자료 = delivery_shipments(발송일 ship_date ≥ 오늘(KST) − 7) · 받는 분 번호 phone_digits 또는 구매자 번호 buyer_digits 가 그 번호와 같은 줄
 *       구매자 번호로 맞으면 그 구매자 묶음 전부 · 받는 분 번호로만 맞으면 자기 송장만(같은 SELECT 의 OR 가 곧 이 규칙)
 *       #1149 로 운송장 파일 구매자 연락처 = 입력삭제 번호(주문한 손님)라 입력삭제 묶음도 구매자 번호로 찾힘
 *   · 초안 = 고정 글(코드가 그대로 붙임 · AI 를 부르지 않음 = 송장 숫자를 지어내거나 바꿀 틈 0) · 송장마다 한 줄 · 20줄 넘으면 앞 20줄 + 「외 n건」
 *   · 신원(오매칭 = 남의 이름·송장 유출 막기): 문자 = 보낸 번호 · 톡톡 = 손님 글에 적은 010 번호(초안에만 · 직원이 본인 확인 뒤 보냄)
 *       톡톡 번호 여럿이 걸리면 「구매자 번호로 맞는 것 하나」일 때만 · 그 밖 = 목록 없음 · 상품문의(공개 게시판) = 송장·성함 0 · 주문문의 = 주문 연결 없음(목록 없음)
 *   · 이 모듈은 로그·텔레그램에 송장 전체를 남기지 않는다(#644) — 돌려주는 note 는 번호 끝 4자리·건수만
 */
'use strict';

const DAYS = 7, MAX_LINES = 20, SMS_MAX_BYTES = 2000, TALK_MAX = 1000;
const PHONE_RE = /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;
const lookupable = d => /^0\d{8,11}$/.test(String(d || ''));
const onlyDigits = s => String(s == null ? '' : s).replace(/[^0-9]/g, '');
const tail4 = d => '…' + String(d || '').slice(-4);

function phonesInText(texts) {
    const out = [];
    for (const t of [].concat(texts || [])) for (const m of String(t == null ? '' : t).match(PHONE_RE) || []) { const d = onlyDigits(m); if (lookupable(d) && !out.includes(d)) out.push(d); }
    return out;
}
function fmtTracking(t) { const d = onlyDigits(t); return d.length === 12 ? d.slice(0, 4) + '-' + d.slice(4, 8) + '-' + d.slice(8) : d; }
function md(ymd) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? `${+m[2]}/${+m[3]}` : ''; }
function stateWord(r) { if (r && r.delivered) return '배송완료'; const l = String((r && (r.label || r.bucket)) || ''); return l === '배송출발' ? '배송 출발' : ''; }

// 그 번호의 최근 7일 송장(받는 분 번호 · 구매자 번호) — 시험 운송장 9996… · 검증 줄(source verify…)은 검증 모드가 아니면 뺌
async function findShipments(pool, d, opts) {
    if (!lookupable(d)) return [];
    const test = !!(opts && opts.testMode);
    const r = await pool.query(`SELECT s.tracking, s.ship_date::text AS ship_date, btrim(COALESCE(s.recipient, '')) AS recipient, (s.phone_digits = $1) AS is_r, (s.buyer_digits = $1) AS is_b,
            COALESCE(st.delivered, false) AS delivered, st.label, st.bucket
        FROM delivery_shipments s LEFT JOIN delivery_status st ON st.tracking = s.tracking
        WHERE (s.phone_digits = $1 OR s.buyer_digits = $1) AND s.ship_date >= (now() AT TIME ZONE 'Asia/Seoul')::date - $2::int
            AND s.tracking NOT LIKE '9996%' ${test ? '' : "AND COALESCE(s.source, '') NOT LIKE 'verify%'"}
        ORDER BY s.ship_date DESC, regexp_replace(COALESCE(s.recipient, ''), '[[:space:]]+', '', 'g'), s.tracking LIMIT 300`, [d, DAYS]);
    return r.rows.filter(x => /^\d{10,12}$/.test(onlyDigits(x.tracking)));
}

// 톡톡 = 손님 글의 번호 → 쓸 번호 하나 고르기 · { d, rows } | { why }
async function pickFromText(pool, texts, opts) {
    const nums = phonesInText(texts);
    if (!nums.length) return { why: 'no_number' };
    const hits = [];
    for (const d of nums) { const rows = await findShipments(pool, d, opts); if (rows.length) hits.push({ d, rows }); }
    if (!hits.length) return { why: 'not_found', d: nums[0] };
    if (hits.length === 1) return hits[0];
    const buyers = hits.filter(h => h.rows.some(x => x.is_b));
    return buyers.length === 1 ? buyers[0] : { why: 'many' };
}

// 고정 초안 글 — ch 'sms' = 이모지 없음 · 2,000바이트(#1116) 안 · 'talk' = 1,000자 안 · 넘으면 줄을 줄이고 「외 n건」
function compose(rows, ch, bytesOf) {
    const sms = ch === 'sms';
    const head = sms ? ['안녕하세요 고객님 제주아꼼이네입니다.', '요청하신 송장번호 안내드려요.', '택배사: CJ대한통운'] : ['안녕하세요 고객님 제주아꼼이네입니다 🍊', '요청하신 송장번호 안내드려요 😊', '택배사: CJ대한통운'];
    const foot = '배송조회는 CJ대한통운 홈페이지·앱에서 송장번호로 확인하실 수 있어요.';
    const line = r => [md(r.ship_date) + ' 발송', r.recipient ? String(r.recipient).replace(/\s+/g, ' ').slice(0, 20) + '님' : '', fmtTracking(r.tracking) + (stateWord(r) ? ` (${stateWord(r)})` : '')].filter(Boolean).join(' · ');
    const size = t => sms ? (typeof bytesOf === 'function' ? bytesOf(t) : Buffer.byteLength(t, 'utf8')) : t.length;
    const cap = sms ? SMS_MAX_BYTES : TALK_MAX;
    let n = Math.min(rows.length, MAX_LINES), text = '';
    for (; n >= 1; n--) {
        const more = rows.length - n;
        text = head.concat(rows.slice(0, n).map(line), more > 0 ? [`외 ${more}건은 따로 보내드릴게요.`] : [], [foot]).join('\n');
        if (size(text) <= cap) break;
    }
    return { text, shown: Math.max(n, 1), total: rows.length };
}

const NOTE = {
    sms_found: (d, n) => `최근 ${DAYS}일 발송 기록 ${n}건을 이 번호(${tail4(d)})로 찾아 넣었어요`,
    talk_found: (d, n, recvOnly) => `손님 글에 적은 번호 ${tail4(d)}로 찾았어요(${n}건)${recvOnly ? ' · 받는 분 번호로만 맞음(구매자 아님)' : ''} · 주문자 본인인지 확인 뒤 보내 주세요`,
    not_found: () => `최근 ${DAYS}일 발송 기록을 못 찾았어요`,
    no_number: () => '톡톡은 주문자를 알 수 없어요(손님 글에 번호 없음)',
    many: () => '손님 글의 번호 여럿이 서로 다른 주문에 걸려요 — 목록을 넣지 않았어요',
    inquiry: () => '주문문의는 주문 번호가 연결돼 있지 않아요',
    qna: () => '상품문의는 공개 게시판이라 송장·성함을 넣지 않았어요 — 톡톡·문자로 보내 주세요',
};
// 상품문의(공개 게시판) 초안 — 송장·성함·번호 0
const QNA_TEXT = '안녕하세요 고객님 제주아꼼이네입니다 🍊\n송장번호는 받는 분 성함 등 개인정보가 함께 담겨 있어 공개 게시판에는 남겨 드리기 어려워요.\n번거로우시겠지만 네이버 톡톡으로 주문자 성함과 연락처를 남겨 주시면 송장번호를 바로 안내드리겠습니다 😊';

module.exports = { DAYS, MAX_LINES, PHONE_RE, phonesInText, fmtTracking, findShipments, pickFromText, compose, NOTE, QNA_TEXT, tail4 };
