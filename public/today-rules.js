// #1235(대표 11/22 「오늘 챙길 일 · 메뉴 숫자 배지」) 화면과 서버가 같이 쓰는 판정 — 브라우저(전역 AKMToday) · Node(module.exports) 양쪽
//   「띠·배지 숫자 = 그 메뉴 안 숫자」(#199 교훈)를 지키려고, 메뉴 화면이 쓰던 판정식을 여기로 옮겨 화면(ao-ordermemo.js·ao-exp.js)과 서버(today-summary.js)가 같은 함수를 부른다.
//   뜻은 옮기기 전과 한 글자도 같다(옮긴 원본 = ao-ordermemo.js BADGE_K·badgeK·lineTone · ao-exp.js noPhone · app.js rvAll).
//   화면 쪽은 이 파일이 안 실렸을 때 종전 식으로 떨어진다(안전망).
(function (root) {
    'use strict';
    /* ── 발주 메모함 줄 배지(옮긴 원본 ao-ordermemo.js · #936 · #936-b · #1020 · #1023) ── */
    var MEMO_BADGE_K = { allnormal: 'ok', normal_later: 'later', normal_split: 'later', ok: 'ok', split: 'later', sent_split: 'later', short: 'short', over: 'over', unknown: 'unk', pre: 'unk', personal: 'pers' };
    function memoBadgeK(b) { return (b.unsure > 0 && ['over', 'personal', 'unknown'].indexOf(b.state) < 0) ? 'short' : (MEMO_BADGE_K[b.state] || 'unk'); }
    function memoLineTone(lb, ib) { return lb ? (lb.state === 'ok' ? 'ok' : lb.state === 'fail' ? 'bad' : '') : ib ? ({ ok: 'ok', over: 'bad', short: 'bad' }[memoBadgeK(ib)] || '') : ''; }
    /* 메모함 「확인 필요」 줄 = 줄 글이 빨강(lineTone 'bad')으로 그려지는 줄 — 서버 /api/order-memo 줄의 badge 그대로 */
    function memoRowBad(r) {
        var b = r && r.badge;
        var lb = b && b.kind === 'line' ? b : null, ib = b && b.kind !== 'line' ? b : null;
        return memoLineTone(lb, ib) === 'bad';
    }
    /* ── 체험 예약 「번호 미입력」(옮긴 원본 ao-exp.js · #804 · #808) · today = KST YYYY-MM-DD ── */
    function expNoPhone(b, today) { return (b.source === 'place' || b.source === 'manual') && b.status === 'confirmed' && !(b.phone && String(b.phone).length >= 10) && (!b.visit_date || b.visit_date >= today); }
    /* ── 문의 관리 › 응대 현황 「아직 안 답함」(옮긴 원본 app.js rvAll · #1122 = 톡톡+상품문의+고객문의 · 문자 제외) ── */
    function inqOpen(d) {
        if (!d) return null;
        if (!d.channels) return d.all ? (Number(d.all.open) || 0) : null;
        var n = 0, ks = ['talk', 'qna', 'inquiry'];
        for (var i = 0; i < ks.length; i++) { var c = d.channels[ks[i]]; if (c) n += Number(c.open) || 0; }
        return n;
    }
    function kstToday(now) { return new Date((now == null ? Date.now() : now) + 9 * 3600e3).toISOString().slice(0, 10); }
    var api = { MEMO_BADGE_K: MEMO_BADGE_K, memoBadgeK: memoBadgeK, memoLineTone: memoLineTone, memoRowBad: memoRowBad, expNoPhone: expNoPhone, inqOpen: inqOpen, kstToday: kstToday };
    root.AKMToday = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
