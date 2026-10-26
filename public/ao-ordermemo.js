// #850(대표 10/25 「직원이 회사폰 노트에 적던 발주 메모를 에이전트 오피스로 · 최대한 편리하게 · 글 쓰임 복잡하지 않게 · 디자인 · 무회귀」) — 발주 메모함 창
//   설계 = docs/850-order-memo-design.md · 시안 docs/850-mock-*.png · 서버 계약 = docs/850-api.md(워커2) — 서버 길은 아래 API 한 곳에만(계약이 바뀌면 여기만).
//   창 = 손님 연락 창과 같은 꼴(폰 = 전체 화면 · PC = 2단: 왼쪽 넣기 + 목록 / 오른쪽 「내일 발주에 들어갈 것」 = for-ship 글 그대로).
//   겹·뒤로가기 = ao-desk.js 기록(AkmAoDesk.hbPush/hbDrop · #677·#678) — 열린 순서대로 닫힘: 옵션 목록 → 정리 카드 → 미리보기 판 → 메모함.
//   흐름 = 손님 글 붙여 넣기 → [입력하기](preview · 저장 0) → 정리 결과 카드(칸마다 고침 · ↺ = 처음 정리한 값 · 빈칸 빨강+이유 · 손님께 물어볼 문자 초안) → [저장].
//   고친 것이 있는데 닫으면(× · 취소 · Esc · 뒤로가기) 「저장 안 하고 닫을까요?」 한 번.
//   목록 = 한 줄씩 [×] 지우기(되돌리기 6초) · 날짜 지정 줄 = 「10/30 발송 · 대기」 · 누르면 같은 카드로 고치기.
//   입구 = [+] 메뉴(ao-desk.js) · 최종발주 메모 칸 위 링크(final-order.js) · 문자 대화 [발주 메모로 보내기](AkmOrderMemo.fromText).
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const p2 = n => String(n).padStart(2, '0');
    const toast = (m, ms) => { if (typeof window.showToast === 'function') window.showToast(m, '', ms); };
    const phoneW = () => window.matchMedia('(max-width: 720px)').matches;
    const kstNow = () => new Date(Date.now() + 9 * 3600e3);
    const todayStr = () => kstNow().toISOString().slice(0, 10);
    const WD = '일월화수목금토';
    const md = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[2]) + '/' + (+m[3]) : ''; };
    const mdw = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return ''; const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return (+m[2]) + '/' + (+m[3]) + '(' + WD[dt.getUTCDay()] + ')'; };
    const hm = t => { if (!t) return ''; const d = new Date(new Date(t).getTime() + 9 * 3600e3); if (isNaN(d)) return ''; const s = p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); return d.toISOString().slice(0, 10) === todayStr() ? s : (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + s; };
    const digits = s => String(s || '').replace(/\D/g, '');
    const last4 = s => { const d = digits(s); return d.length >= 4 ? d.slice(-4) : ''; };
    // #850-c 전화번호 = 치는 대로 000-0000-0000(10자리 000-000-0000 · #808 체험 예약 fmtTel 과 같은 꼴) — 0으로 시작하는 11자리 이하 숫자만 · 주문번호(네이버 16자리 · 자사몰 YYYYMMDD-NNNNNNN · 쿠팡)는 그대로
    //   최종발주 메모 칸 대조는 숫자만 본다(invoice-v2 parseLines digits · matchKey) → 하이픈 꼴이어도 판정 무변화
    // 앞자리 = 02(서울 2자리) · 050x(안심번호 4자리 · 12자리까지) · 그 밖 3자리 · 뒤 = 7자리면 3-4 · 8자리면 4-4(보기만 · 숫자는 그대로)
    const telHead = d => d.startsWith('02') ? 2 : d.startsWith('050') ? 4 : 3;
    const telMax = d => d.startsWith('050') ? 12 : 11;
    const fmtTel = v => { let d = digits(v); d = d.slice(0, telMax(d)); const p = telHead(d), r = d.slice(p); if (!r) return d; if (r.length <= 4) return d.slice(0, p) + '-' + r; const m = r.length <= 7 ? 3 : 4; return d.slice(0, p) + '-' + r.slice(0, m) + '-' + r.slice(m); };
    // 한 줄 번호 칸 = 치는 대로 하이픈(카드 번호 칸 · #862 줄 입력판 번호 칸) · 커서 = 그 앞 숫자 개수 기준 · 여러 줄 입력 칸(om-raw)엔 안 씀(#857)
    const lineTel = v => { const d = digits(v); return d.startsWith('02') ? d : fmtTel(v); };   // #862 줄(메모 줄 번호) 꼴 — 02 는 숫자만
    function telLive(t) {
        if (!isPhoneish(t.value)) return;
        const fv = fmtTel(t.value); if (fv === t.value) return;
        const pos = t.selectionStart == null ? t.value.length : t.selectionStart, nd = digits(t.value.slice(0, pos)).length;
        t.value = fv; let cnt = 0, i = 0; while (i < fv.length && cnt < nd) { if (/[0-9]/.test(fv[i])) cnt++; i++; }
        try { t.setSelectionRange(i, i); } catch (er) { /* 그대로 */ }
    }
    const isPhoneish = v => { const s = String(v || '').trim(), d = digits(s); return !!d && d[0] === '0' && d.length <= telMax(d) && !/[A-Za-z가-힣]/.test(s) && !/^\d{8}-\d/.test(s); };
    const telShow = v => isPhoneish(v) && digits(v).length >= 9 ? fmtTel(v) : v;
    const lineView = s => String(s || '').split('\t').map(x => x.trim()).filter(Boolean).join(' ');   // 메모 칸 글 보기 = 칸 사이 한 칸(앞 빈 칸·넓은 탭 없이)
    const nextShip = () => { const d = kstNow(); d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };   // 서버가 기준 발송일을 안 주면 = 내일(일요일 건너뜀)
    const toIso = s => { const t = String(s || '').trim(); if (!t) return null; let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return `${m[1]}-${p2(+m[2])}-${p2(+m[3])}`; m = t.match(/(\d{1,2})\s*[\/.월-]\s*(\d{1,2})/); if (!m) return undefined; const now = kstNow(); let y = now.getUTCFullYear(); if (+m[1] < now.getUTCMonth() + 1 - 6) y++; return `${y}-${p2(+m[1])}-${p2(+m[2])}`; };   // undefined = 못 읽음
    const clone = o => JSON.parse(JSON.stringify(o));

    // ── 칸 정의 ─────────────────────────────────────────
    //   현금 13칸(최종발주 parseCash 순서 · 계약 1절) — 화면에 보이는 칸만 · need = 비면 빨강(서버 missing 과 같은 번호 3·4·5·6·8)
    const CASH_FIELDS = [
        { i: 4, label: '옵션정보', need: true, why: '품목을 골라 주세요', alias: '품목을 못 정했어요', kind: 'option' },   // alias = 서버 이유 글(같은 칸 이유로 묶음)
        { i: 5, label: '수량', need: true, why: '수량을 넣어 주세요', alias: '수량이 없어요', kind: 'qty' },
        { i: 3, label: '받는 분', need: true, why: '받는 분 성함이 없어요' },
        { i: 6, label: '받는 분 연락처', need: true, why: '받는 분 번호가 없어요', kind: 'tel' },
        { i: 8, label: '배송지', need: true, why: '주소가 없어요', kind: 'area' },
        { i: 10, label: '구매자 연락처', kind: 'tel' },
        { i: 9, label: '배송메세지', ph: '비우면 최종발주가 기본 문구로' },
        { i: 0, label: '보내는 분(선물)', hint: '「드림」 자동', more: true, kind: 'sender', ph: '예) 홍길동' },   // #862 힌트 = 최종발주 「보내는 분 이름(「드림」 자동)」과 같은 글자
        { i: 12, label: '보내는 분 주소', more: true },
    ];
    const LINE_FIELDS = [
        { k: 'key', label: '번호', hint: '구매자 번호 · 주문번호', need: true, why: '번호가 없어요', kind: 'tel' },
        { k: 'note', label: '할 일', need: true, why: '무엇을 할지 못 읽었어요', ph: '예) S사이즈로 · 입력o삭제x · 보내는이 홍길동' },
        { k: 'plat', label: '판매처', kind: 'platform', need: true, cardOnly: true, why: '판매처를 골라 주세요' },   // #850-c 「모름」 없앰 · 빈칸은 카드 안에서만 셈(목록 알약은 서버 판정 그대로)
    ];
    // #850-c ⑤ 꼬리표 = 누르면 메모장에 틀 한 줄 + 번호 자리 선택(바로 번호만 치면 됨) · #850-f 「현금 손님」도 상태 없이 「현금 손님」 한 줄(대표 정정) · 단추는 누르는 순간만 깜빡(켜짐 상태 없음)
    //   틀 꼴 = 서버 규칙 줄(order-memo.js · invoice-v2 parseLines · sizeLines)이 그대로 읽는 「번호 + 지시」 꼴
    const TEL_PH = '000-0000-0000';
    const TAGS = [['cash', '현금 손님', '현금 손님'], ['indiv', '입력삭제', TEL_PH + ' 입력o삭제x'], ['size', '사이즈', TEL_PH + ' S사이즈로'], ['date', '날짜 지정', TEL_PH + ' 00일 발송'], ['sender', '보내는이', TEL_PH + ' 보내는이 홍길동']];
    // 틀 자리를 안 고친 채 [입력하기] = 막고 그 자리를 골라 줌
    const TPL_HOLES = [[TEL_PH, '번호를 넣어 주세요 — 000-0000-0000 자리에 손님 번호를 써 주세요'], [/(^|[^0-9])00일/, '발송 날짜를 넣어 주세요 — 00일 자리에 날짜를 써 주세요'], ['보내는이 홍길동', '보내는 분 이름을 넣어 주세요 — 홍길동 자리를 바꿔 주세요']];
    const PLATS = ['네이버', '쿠팡', '자사몰'];
    const RECENT_KEY = 'akm_om_recent_opts';
    const recentGet = () => { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, 5) : []; } catch (e) { return []; } };
    const recentPut = v => { if (!v) return; try { const a = [v].concat(recentGet().filter(x => x !== v)).slice(0, 5); localStorage.setItem(RECENT_KEY, JSON.stringify(a)); } catch (e) { /* 기억 못 해도 그대로 */ } };

    const OM = { el: null, tab: 'open', list: null, cleared: null, counts: null, err: '', loading: false, shipDate: '', catalog: null, raw: '', tags: new Set(), busy: false,
        card: null, opt: null, undo: null, undoT: 0, sel: new Set(), delArm: false, delT: 0, delBusy: false, prevOpen: false, ship: null, lastFocus: null };

    // ── 서버(계약 = docs/850-api.md) ─────────────────────
    async function call(url, method, body) {
        const r = await fetch(url, { method: method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') }, body: body ? JSON.stringify(body) : undefined });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401 && typeof window.akmSessionExpired === 'function') window.akmSessionExpired();
        return { status: r.status, ok: r.ok, body: j || {} };
    }
    const safe = p => p.catch(() => ({ ok: false, status: 0, body: {} }));
    const errText = (res, fb) => { const b = res && res.body; return (b && (b.error_text || b.message || (typeof b.error === 'string' && /[가-힣]/.test(b.error) ? b.error : ''))) || fb || '다시 시도해 주세요'; };
    const API = {
        list: st => safe(call('/api/order-memo?state=' + encodeURIComponent(st))),
        preview: body => safe(call('/api/order-memo/preview', 'POST', body)),
        previewGet: id => safe(call('/api/order-memo/preview/' + encodeURIComponent(id))),          // 2-1b 창구 정리 기다리기 { state: wait|done|fail }
        previewDel: id => safe(call('/api/order-memo/preview/' + encodeURIComponent(id), 'DELETE')), // done·fail 직후 · 취소 · 시간 넘김 = 손님 글을 서버에서 지움
        save: body => safe(call('/api/order-memo', 'POST', body)),
        update: (id, body) => safe(call('/api/order-memo/rows/' + encodeURIComponent(id), 'PUT', body)),
        remove: id => safe(call('/api/order-memo/rows/' + encodeURIComponent(id), 'DELETE')),
        restore: id => safe(call('/api/order-memo/restore/' + encodeURIComponent(id), 'POST')),
        forShip: date => safe(call('/api/order-memo/for-ship?date=' + encodeURIComponent(date))),
        catalog: () => safe(call('/api/invoice/catalog')),
        lookup: (key, plat) => safe(call('/api/order-memo/lookup?key=' + encodeURIComponent(key) + '&plat=' + encodeURIComponent(plat || ''))),   // #850-c 판매처 확인(계약 §7 · 읽기만)
    };
    // 서버 줄(계약 1절) → 화면 줄 — 칸은 그대로 두고 빠진 것만 채움
    function normRow(r, entry) {
        if (!r) return null;
        const o = { id: r.id != null ? r.id : null, kind: r.kind === 'cash' ? 'cash' : 'line', ship_date: r.ship_date ? String(r.ship_date).slice(0, 10) : null,
            sure: r.sure === true, check_why: Array.isArray(r.check_why) ? r.check_why.map(String) : (r.check_why ? [String(r.check_why)] : []), src: r.src || '',
            stale: r.stale === true, indiv: r.indiv === true, state: r.state || 'open', used_on: r.used_on ? String(r.used_on).slice(0, 10) : null, cleared_at: r.cleared_at || '', entry: entry || {} };
        if (o.kind === 'cash') { o.cells = Array.from({ length: 13 }, (_, i) => (Array.isArray(r.cells) && r.cells[i] != null ? String(r.cells[i]) : '')); o.missing = Array.isArray(r.missing) ? r.missing.map(Number) : []; }
        else { o.key = r.key || ''; o.note = r.note || ''; o.plat = r.plat || ''; o.line = r.line || [o.ship_date ? md(o.ship_date) : '', o.key, o.note, o.plat].join('\t'); o.checked = r.checked || null; }
        return o;
    }
    const outRow = r => Object.assign(r.kind === 'cash' ? { kind: 'cash', ship_date: r.ship_date || null, cells: r.cells.slice(), indiv: !!r.indiv } : { kind: 'line', ship_date: r.ship_date || null, key: r.key, note: r.note, plat: r.plat, line: r.line, checked: r.checked || null }, r.src ? { src: r.src } : {});   // 미리보기에서 받은 src·line 을 그대로(출처 보존 · 고쳤으면 서버가 다시 만듦 · 계약 §6)
    const putBody = r => r.kind === 'cash' ? { cells: r.cells.slice(), ship_date: r.ship_date || null } : Object.assign({ key: r.key, note: r.note, plat: r.plat, ship_date: r.ship_date || null }, r._lk && r._lk.state === 'done' ? { checked: r.checked || null } : {});   // 찾기가 끝난 줄만 확인 표시를 보냄(못 찾았으면 null = 지움 · 아직이면 안 보냄 = 서버가 번호·판매처 바뀌면 비움)

    // ── 줄 판정(화면 표시) ────────────────────────────────
    const valOf = (r, f) => r.kind === 'cash' ? (r.cells[f.i] || '') : (r[f.k] || '');
    // #850-c 새로 더한 빈 줄(_new)은 손대기 전엔 빨간 글·빈칸 셈 없음(저장 때 그냥 버림) — 대표 「+ 메모 줄을 확인 단추로 착각」
    const blanksOf = (r, inCard) => r._new ? [] : (r.kind === 'cash' ? CASH_FIELDS : LINE_FIELDS).filter(f => f.need && (inCard || !f.cardOnly) && !String(valOf(r, f)).trim());
    const isLater = r => !!(r.ship_date && OM.shipDate && r.ship_date > OM.shipDate);
    const isCheck = r => !r.sure || blanksOf(r).length > 0;
    const whyOf = r => r.check_why.length ? r.check_why.join(' · ') : blanksOf(r).map(f => f.why).join(' · ');
    // 카드 안 줄 머리 이유 = 칸 아래 빨간 글과 겹치지 않는 것만(「주소가 없어요」는 배송지 칸 아래에 이미 있음)
    const nk = s => String(s || '').replace(/[s·]/g, '');
    const fieldWhy = (r, f) => (r.check_why || []).find(w => nk(w).includes(nk(f.why)) || (f.alias && nk(w).includes(nk(f.alias)))) || f.why;   // 서버 이유가 그 칸을 말하면 그 글(「주소가 없어요 · 『어머니댁』만 적혀 있어요」)을 칸 아래에
    const whyExtra = r => { const own = (r.kind === 'cash' ? CASH_FIELDS : LINE_FIELDS).filter(f => f.why).flatMap(f => [f.why, f.alias].filter(Boolean)).map(w => w.replace(/[\s·]/g, '')); return r.check_why.filter(w => { const k = String(w).replace(/[\s·]/g, ''); return !own.some(o => k.includes(o) || o.includes(k)); }); };
    function pillOf(r) {
        if (isCheck(r)) return { k: 'check', t: (r.stale ? '오래된 ' : '') + (blanksOf(r).length ? '빈칸 ' + blanksOf(r).length : '확인') };   // stale = 7일 넘게 안 고친 확인 줄(30일 넘으면 서버가 지움)
        if (isLater(r)) return { k: 'later', t: md(r.ship_date) + ' 발송 · 대기' };
        if (r.used_on) return { k: 'used', t: md(r.used_on) + ' 발주에 넣음' };
        return { k: 'next', t: '내일 발주' };
    }
    const senderShow = v => String(v || '').replace(/[!！]/g, '').replace(/\s+/g, ' ').trim();   // #863 「!」 어디든(서버가 맨 뒤에 붙임) 떼고 보임
    // #862 보내는 분 이름만 치면 「○○ 드림」 — 서버 cashSender(order-memo.js) · 최종발주 IvtSender(「이름 드림」) 와 같은 판정(이미 드림·올림 · 제주아꼼이네 · 「○○(제주아꼼이네)」 는 그대로)
    const senderDrim = v => { const n = senderShow(v); return !n || /(?:드림|올림)$|제주아꼼이네\)?$/.test(n) ? n : n + ' 드림'; };
    const nameOf = r => r.kind === 'cash' ? (r.cells[3] || '') : '';
    const numOf = r => r.kind === 'cash' ? (r.cells[6] || r.cells[10]) : r.key;
    const shortOpt = s => String(s || '').replace(/\s*\/\s*상품 및 과수:\s*/, ' · ');
    const previewOf = r => r.kind === 'cash' ? [shortOpt(r.cells[4]), r.cells[5] ? r.cells[5] + '박스' : '', r.cells[8]].filter(Boolean).join(' · ') : lineView(r.line);

    // ── 창 틀 ─────────────────────────────────────────
    const ICON_CLIP = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1.2"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M8.5 12h7M8.5 16h4.5"/></svg>';
    const ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const ICON_UNDO = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h11a5 5 0 0 1 0 10h-3"/><path d="M8 5L4 9l4 4"/></svg>';
    const ICON_DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    function mount() {
        if (OM.el && OM.el.isConnected) return OM.el;
        const root = document.body;   // body 바로 아래 — 최종발주 겹(z 960) 위에서도 열리게 · 색 토큰은 ao-ordermemo.css 가 한 벌 둔다
        const sec = document.createElement('section');
        sec.className = 'om-modal'; sec.id = 'desk-om'; sec.setAttribute('role', 'dialog'); sec.setAttribute('aria-modal', 'true'); sec.setAttribute('aria-labelledby', 'om-title'); sec.hidden = true;
        sec.innerHTML = `
          <div class="om-win">
            <header class="om-head">
              <button type="button" class="om-back" id="om-close" aria-label="발주 메모함 닫기"><span aria-hidden="true">‹</span><em>닫기</em></button>
              <h2 id="om-title">발주 메모함</h2>
              <span class="om-hpill" id="om-hpill" hidden></span>
            </header>
            <div class="om-cols">
              <div class="om-left">
                <form class="om-in" id="om-in" autocomplete="off">
                  <div class="om-in-h"><i class="om-in-ic">${ICON_CLIP}</i><div><b>손님 글을 그대로 붙여 넣어요</b><span>이름·번호·주소·품목이 섞여 있어도 돼요 · 칸 나누기는 이쪽에서</span></div></div>
                  <div class="om-in-paper">
                    <label class="om-sr" for="om-raw">손님 글 · 메모</label>
                    <textarea id="om-raw" class="has-xs" rows="4" maxlength="4000" spellcheck="false"></textarea>
                    <div class="om-in-mirror" id="om-raw-mirror" aria-hidden="true"></div>
                    <div class="om-in-xs" id="om-raw-xs"></div>
                    <button type="button" class="om-in-clear" id="om-raw-clear" aria-label="글 지우기" hidden>${ICON_X}</button>
                  </div>
                  <div class="om-tags" role="group" aria-label="빠른 꼬리표(안 눌러도 글에서 읽어요)">${TAGS.map(t => `<button type="button" class="om-tag" data-tag="${t[0]}">${t[1]}</button>`).join('')}</div>
                  <div class="om-tp" id="om-tp" role="group" aria-labelledby="om-tp-t" hidden>
                    <div class="om-tp-h"><b id="om-tp-t">입력삭제</b><span class="om-tp-s" id="om-tp-s"></span><button type="button" class="om-btn icon om-tp-x" id="om-tp-x" aria-label="줄 입력 닫기">${ICON_X}</button></div>
                    <div class="om-tp-row">
                      <input id="om-tp-tel" class="om-tp-tel" type="tel" inputmode="tel" autocomplete="off" maxlength="16" placeholder="010-1234-5678" aria-label="손님 번호(구매자 번호)">
                      <div class="om-tp-k" id="om-tp-k"></div>
                      <button type="button" class="om-btn primary om-tp-go" id="om-tp-go">넣기</button>
                    </div>
                    <p class="om-tp-note" id="om-tp-note" role="status"></p>
                  </div>
                  <div class="om-in-acts">
                    <button type="submit" class="om-btn primary" id="om-go" disabled>입력하기</button>
                  </div>
                  <p class="om-in-note" id="om-in-note" role="status"></p><button type="button" class="om-link om-in-undo" id="om-raw-undo" hidden>지운 줄 되돌리기</button>
                </form>
                <div class="om-tabs" role="tablist" aria-label="메모 목록">
                  <button type="button" class="om-tabb" role="tab" data-tab="open" aria-selected="true">지금 메모 <b id="om-n-open"></b></button>
                  <button type="button" class="om-tabb" role="tab" data-tab="cleared" aria-selected="false">비운 것(30일)</button>
                </div>
                <p class="om-sum" id="om-sum" role="status"></p>
                <div class="om-selbar" id="om-selbar" hidden><label class="om-selall"><input type="checkbox" id="om-selall">전체 선택</label><span class="om-seln" id="om-seln" role="status"></span></div>
                <ul class="om-list" id="om-list" aria-live="polite"></ul>
              </div>
              <aside class="om-prev" id="om-prev" aria-labelledby="om-prev-t">
                <div class="om-prev-h"><b id="om-prev-t">내일 발주에 들어갈 것</b><span id="om-prev-d"></span><button type="button" class="om-btn sm om-prev-x" id="om-prev-x">닫기</button></div>
                <div class="om-prev-b" id="om-prev-b"></div>
              </aside>
            </div>
            <footer class="om-foot" id="om-foot">
              <button type="button" class="om-btn" id="om-prev-open">내일 발주 미리보기</button>
              <button type="button" class="om-btn om-del" id="om-del" disabled>삭제</button>
            </footer>
            <div class="om-undo" id="om-undo" role="status" hidden><span id="om-undo-t"></span><button type="button" class="om-btn sm" id="om-undo-b">되돌리기</button></div>
          </div>
          <div class="om-card-back" id="om-card-back" hidden></div>
          <section class="om-card" id="om-card" role="dialog" aria-modal="true" aria-labelledby="om-card-t" hidden></section>
          <div class="om-optpop" id="om-optpop" role="dialog" aria-modal="true" aria-label="옵션정보 고르기" hidden>
            <div class="om-optpop-h"><label class="om-sr" for="om-opt-q">품목 찾기</label><input type="search" id="om-opt-q" autocomplete="off" placeholder="품목 찾기 · 예) 타이벡 5kg" role="combobox" aria-expanded="true" aria-controls="om-opt-list" aria-autocomplete="list"><button type="button" class="om-btn sm" id="om-opt-x">닫기</button></div>
            <ul class="om-opt-list" id="om-opt-list" role="listbox" aria-label="옵션정보"></ul>
          </div>`;
        root.appendChild(sec);
        OM.el = sec;
        bind();
        inNote('');
        return sec;
    }

    function bind() {
        const raw = $('om-raw');
        $('om-close').addEventListener('click', () => close(true));
        raw.addEventListener('input', e => { telMark(raw, e); OM.raw = raw.value; if (!raw.value.trim()) OM.smsSrc = null; xUndoHide(); inState(); });   // #852 칸이 비면 문자 출처도 끊음
        ['keyup', 'click', 'pointerup'].forEach(k => raw.addEventListener(k, () => telLeave(raw)));   // #857 줄을 떠나면(다른 줄로 커서) 그 줄 번호 정리
        raw.addEventListener('blur', () => telLeave(raw, true));   // #857 칸 밖으로 나가면
        raw.addEventListener('compositionstart', () => { OM.telComp = true; });
        raw.addEventListener('compositionend', () => { OM.telComp = false; });
        raw.addEventListener('scroll', xLayout, { passive: true });
        if (window.ResizeObserver) new ResizeObserver(() => xLayout()).observe(raw);
        $('om-raw-xs').addEventListener('click', e => { const b = e.target.closest('.om-in-x'); if (b) xDel(Number(b.dataset.ln)); });
        $('om-raw-undo').addEventListener('click', xUndo);
        raw.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!$('om-go').disabled) runPreview(); } });
        $('om-raw-clear').addEventListener('click', () => { OM.telLn = null; raw.value = ''; OM.raw = ''; OM.tags.clear(); OM.smsSrc = null; syncTags(); inState(); inNote(''); raw.focus(); });
        $('om-in').addEventListener('submit', e => { e.preventDefault(); runPreview(); });
        OM.el.querySelector('.om-tags').addEventListener('click', e => {
            const b = e.target.closest('.om-tag'); if (!b) return;
            const k = b.dataset.tag, tpl = (TAGS.find(t => t[0] === k) || [])[2];
            b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 320);   // 누른 순간만 표시
            if (k === 'cash') { tpClose(false); cashCard(); return; }   // #853 현금 손님 = 바로 빈 현금 카드
            if (tpl) tpOpen(k);   // #862 틀을 칸에 넣지 않고 아래 줄 입력판(번호 칸 + 꼬리표 칸)
        });
        $('om-tp-x').addEventListener('click', () => tpClose(true));
        $('om-tp-go').addEventListener('click', tpGo);
        const tp = $('om-tp');
        tp.addEventListener('input', e => { if (e.target.id === 'om-tp-tel' && !e.isComposing) telLive(e.target); if (e.target.closest('.om-tp-row')) tpNote(''); });
        tp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && (e.target.id === 'om-tp-tel' || e.target.id === 'om-tp-name')) { e.preventDefault(); tpGo(); } });
        tp.addEventListener('change', e => { if (e.target.id === 'om-tp-date') { tpNote(''); if (!$('om-tp-tel').value.trim()) $('om-tp-tel').focus({ preventScroll: true }); else $('om-tp-go').focus({ preventScroll: true }); } });
        tp.addEventListener('click', e => { const b = e.target.closest('[data-tpsz]'); if (!b || !OM.tp) return; OM.tp.sz = b.dataset.tpsz; tp.querySelectorAll('[data-tpsz]').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false')); tpNote(''); });
        OM.el.querySelector('.om-tabs').addEventListener('click', e => { const b = e.target.closest('.om-tabb'); if (!b || b.dataset.tab === OM.tab) return; OM.tab = b.dataset.tab; syncTabs(); load(); });
        $('om-list').addEventListener('click', onList);
        $('om-prev-open').addEventListener('click', () => prevShow(true));
        $('om-prev-x').addEventListener('click', () => prevShow(false, true));
        $('om-list').addEventListener('change', e => { const c = e.target.closest('input[data-act="pick"]'); if (!c) return; const li = c.closest('.om-item'); if (!li) return; if (c.checked) OM.sel.add(String(li.dataset.id)); else OM.sel.delete(String(li.dataset.id)); li.classList.toggle('picked', c.checked); selSync(); });
        $('om-selall').addEventListener('change', e => { const all = (OM.list || []).map(r => String(r.id)); OM.sel = new Set(e.target.checked ? all : []); renderList(); });
        $('om-del').addEventListener('click', delClick);
        document.addEventListener('pointerdown', e => { if (OM.delArm && !e.target.closest('#om-del')) delDisarm(); }, true);   // #859 다른 데 누르면 되돌아감
        $('om-undo-b').addEventListener('click', undoRun);
        $('om-card-back').addEventListener('click', () => cardClose());
        $('om-opt-q').addEventListener('input', () => optRender());
        $('om-opt-q').addEventListener('keydown', optKey);
        $('om-opt-x').addEventListener('click', () => optClose(true));
        $('om-opt-list').addEventListener('click', e => { const li = e.target.closest('[data-v]'); if (li) optPick(li.dataset.v); });
        // Esc 는 문서 전체에서(먼저) 받는다 — 초점이 창 밖(문자 대화의 [발주 메모로] 등)에 있어도 이 창이 떠 있으면 이 창부터 닫힘(뒤 화면으로 새지 않게)
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || !OM.el || OM.el.hidden || e.isComposing) return;
            e.stopPropagation(); e.preventDefault();
            if (OM.opt) { optClose(true); return; }
            if (OM.card) { cardClose(); return; }
            if (OM.tp) { tpClose(true); return; }   // #862 줄 입력판
            if (OM.prevOpen) { prevShow(false, true); return; }
            if (OM.delArm) { delDisarm(); return; }
            close(true);
        }, true);
    }
    // 기록(뒤로가기) — 평소 = ao-desk.js 의 겹 기록(AkmAoDesk.hbPush/hbDrop) · 최종발주 화면 위에서 열면(그 화면은 popstate 한 번에 닫힘 · ao-desk 기록도 멈춤)
    //   이 창만의 칸을 쌓고, 그 칸의 뒤로가기는 여기서 먼저 받아 최종발주 쪽으로 안 넘긴다(이 파일이 final-order.js 보다 먼저 불려 듣는 순서가 앞)
    const A = () => window.AkmAoDesk || {};
    const OWN = { on: false, stack: [], skip: 0 };
    const ownDepth = () => { try { return (history.state && history.state.omOwn) | 0; } catch (e) { return 0; } };
    function hbPush(k, fn) {
        if (OWN.on) { if (OWN.stack.some(e => e.k === k)) return; OWN.stack.push({ k, fn }); try { history.pushState(Object.assign({}, history.state || {}, { omOwn: OWN.stack.length }), ''); } catch (e) { /* 기록 못 쌓아도 단추로 닫힘 */ } return; }
        const a = A(); if (typeof a.hbPush === 'function') a.hbPush(k, fn);
    }
    function hbDrop() {
        if (OWN.on) { let n = 0; for (const k of arguments) { const i = OWN.stack.findIndex(e => e.k === k); if (i >= 0) { OWN.stack.splice(i, 1); n++; } } if (n) { OWN.skip += n; try { history.go(-n); } catch (e) { OWN.skip = 0; } } return; }
        const a = A(); if (typeof a.hbDrop === 'function') a.hbDrop.apply(null, arguments);
    }
    window.addEventListener('popstate', e => {
        if (!OWN.on && !OWN.skip) return;
        if (OWN.skip > 0) { OWN.skip--; e.stopImmediatePropagation(); return; }   // 우리가 단추로 닫으며 되돌린 칸
        const d = ownDepth(); if (OWN.stack.length <= d) return;
        e.stopImmediatePropagation();   // 이 창의 칸 = 최종발주는 그대로
        while (OWN.stack.length > d) { const x = OWN.stack.pop(); try { x.fn(); } catch (er) { console.error(er); } }
    });

    // ── 넣기 칸 ───────────────────────────────────────
    // 틀 한 줄을 메모장 끝에 넣고 번호 자리(000-0000-0000)를 고른 채 초점 — 자판으로 바로 치면 그 자리가 바뀜
    function tplInsert(tpl) {
        telLeave($('om-raw'), true);   // #857 틀 넣기 전 친 줄 번호 정리
        const raw = $('om-raw'), cur = raw.value, pre = cur && !/\n$/.test(cur) ? cur + '\n' : cur;
        const above = cur.split('\n').map(s => s.trim()).filter(Boolean).pop() || '', m = above.match(/^(0\d{1,3}[-\s]?\d{3,4}[-\s]?\d{4})(?=\s|$)/);   // #850-f 바로 윗줄이 진짜 번호로 시작하면 그 번호로(한 손님 요청 2가지 = 번호 한 번)
        if (!tpl.startsWith(TEL_PH)) { raw.value = pre + tpl; OM.raw = raw.value; inState(); raw.focus({ preventScroll: true }); try { raw.setSelectionRange(raw.value.length, raw.value.length); } catch (e) { /* 그대로 */ } inNote(`「${tpl}」 줄을 넣었어요`, 'ok'); return; }
        const line = m && digits(m[1]).length >= 9 ? m[1] + tpl.slice(TEL_PH.length) : tpl;
        raw.value = pre + line; OM.raw = raw.value; inState();
        raw.focus({ preventScroll: true });
        if (line !== tpl) { const e = raw.value.length, h = line.search(/00일|홍길동/), s = h >= 0 ? pre.length + h : e; try { raw.setSelectionRange(s, h >= 0 ? s + (line.slice(h).startsWith('00일') ? 2 : 3) : e); } catch (er) { /* 그대로 */ } inNote('윗줄 번호로 채웠어요', 'ok'); return; }
        const s = pre.length + tpl.indexOf(TEL_PH);
        try { raw.setSelectionRange(s, s + TEL_PH.length); } catch (e) { /* 그대로 */ }
        inNote('번호 자리를 골라 뒀어요 · 손님 번호를 바로 치세요', 'ok');
    }
    // #862 줄 입력판 — 꼬리표를 누르면 입력 칸에 틀을 넣지 않고 [번호 칸 + 꼬리표 칸 + 넣기] · [넣기]·Enter = 입력 칸 끝에 서버 규칙 줄 꼴 한 줄
    //   입력삭제 「010-1234-5678 입력o삭제x」 · 사이즈 「… S사이즈로」 · 날짜 「… 10/27 발송」(해 넘김 = 「1/3/27 … 발송」) · 보내는이 「… 보내는이 홍길동」 (ruleLine · invoice-v2 parseLines · sizeLines 가 읽는 꼴)
    //   번호 = 직전에 넣은 번호(없으면 입력 칸 마지막 줄 맨 앞 번호)를 미리 채우고 통째 골라 둠 → 같은 손님이면 그대로 · 다른 손님이면 바로 치면 바뀜
    const TP_KIND = { indiv: ['입력삭제', '이 번호 주문은 택배사 양식에서 빼고 현금 주소 줄로'], size: ['사이즈', '귤 로얄과 사이즈 요청'], date: ['날짜 지정', '그날 발송분으로'], sender: ['보내는이', '선물 보내는 분 이름'] };
    const tpNote = (t, k) => { const n = $('om-tp-note'); if (!n) return; n.textContent = t || ''; n.dataset.k = k || ''; };
    function tpLastTel() {
        if (OM.tpLast) return OM.tpLast;
        const above = String($('om-raw').value || '').split('\n').map(x => x.trim()).filter(Boolean).pop() || '', m = above.match(/^(0\d{1,3}[-\s]?\d{3,4}[-\s]?\d{4})(?=\s|$)/);
        return m && digits(m[1]).length >= 9 ? fmtTel(m[1]) : '';
    }
    function tpOpen(k) {
        if (!TP_KIND[k]) return;
        const tp = $('om-tp'), tel = $('om-tp-tel'), was = OM.tp;
        OM.tp = { k, sz: null };
        $('om-tp-t').textContent = TP_KIND[k][0]; $('om-tp-s').textContent = TP_KIND[k][1];
        $('om-tp-k').innerHTML = k === 'size' ? `<div class="om-seg om-tp-sz" role="radiogroup" aria-label="사이즈">${['2S', 'S', 'M'].map(z => `<button type="button" role="radio" class="om-seg-b" data-tpsz="${z}" aria-checked="false">${z}</button>`).join('')}</div>`
            : k === 'date' ? '<input id="om-tp-date" class="akm-date om-tp-date" readonly autocomplete="off" placeholder="발송 날짜 고르기" aria-label="발송 날짜">'
            : k === 'sender' ? '<input id="om-tp-name" class="om-tp-name" autocomplete="off" maxlength="20" placeholder="보내는 분 이름" aria-label="보내는 분 이름">' : '';
        tp.dataset.k = k; tpNote('');
        if (!was) { tp.hidden = false; tel.value = tpLastTel(); }
        else if (!tel.value.trim()) tel.value = tpLastTel();
        tel.focus({ preventScroll: true }); try { tel.select(); } catch (e) { /* 그대로 */ }
        try { tp.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 그대로 */ }
    }
    function tpClose(focusRaw) {
        const tp = $('om-tp'); if (!OM.tp || !tp) { OM.tp = null; return; }
        OM.tp = null; tp.hidden = true; $('om-tp-k').innerHTML = ''; tpNote('');
        if (focusRaw) { const t = OM.el.querySelector(`.om-tag[data-tag="${tp.dataset.k}"]`) || $('om-raw'); if (t) t.focus({ preventScroll: true }); }
    }
    // 날짜 → 「10/27」(늘 M/D) · 해가 다르면 「1/3/27」
    function tpDay(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return '';
        const t = todayStr(), mo = +m[2], d = +m[3];
        if (t.slice(0, 4) !== iso.slice(0, 4)) return mo + '/' + d + '/' + iso.slice(2, 4);   // 해가 다르면 해까지(「1/3」 만 쓰면 올해로 읽음)
        return mo + '/' + d;   // 늘 「M/D」 — 「27일」은 최종발주가 그날 기준으로 다시 읽어 달이 넘어가면 다음 달로 읽힘(워커2 점검)
    }
    function tpLine(k, tel, x) {
        if (k === 'indiv') return tel + ' 입력o삭제x';
        if (k === 'size') return x.sz ? tel + ' ' + x.sz + '사이즈로' : null;
        if (k === 'date') { const d = tpDay(x.date); return !d ? null : /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(d) ? d + ' ' + tel + ' 발송' : tel + ' ' + d + ' 발송'; }   // 해 넘김 = 날짜를 앞에(「1/3/27 010-… 발송」)
        if (k === 'sender') { const n = String(x.name || '').replace(/\s+/g, ' ').trim(); return n ? tel + ' 보내는이 ' + n : null; }
        return null;
    }
    function tpGo() {
        const x = OM.tp; if (!x) return;
        const te = $('om-tp-tel'), d = digits(te.value);
        if (!(isPhoneish(te.value) && d.length >= 9)) { tpNote('손님 번호를 넣어 주세요 · 예) 010-1234-5678', 'err'); te.focus({ preventScroll: true }); return; }
        te.value = fmtTel(te.value); const tel = lineTel(te.value);
        const name = $('om-tp-name'), date = $('om-tp-date');
        const line = tpLine(x.k, tel, { sz: x.sz, date: date && date.value, name: name && name.value });
        if (!line) {
            if (x.k === 'size') { tpNote('사이즈를 골라 주세요', 'err'); const b = $('om-tp').querySelector('[data-tpsz]'); if (b) b.focus({ preventScroll: true }); }
            else if (x.k === 'date') { tpNote('발송 날짜를 골라 주세요', 'err'); if (date) { date.focus({ preventScroll: true }); date.click(); } }
            else { tpNote('보내는 분 이름을 넣어 주세요', 'err'); if (name) name.focus({ preventScroll: true }); }
            return;
        }
        const raw = $('om-raw'); telLeave(raw, true);
        const cur = raw.value, pre = cur && !/\n$/.test(cur) ? cur + '\n' : cur;
        raw.value = (pre + line).slice(0, 4000); OM.raw = raw.value; xUndoHide(); inState();
        try { raw.scrollTop = raw.scrollHeight; } catch (e) { /* 그대로 */ }
        OM.tpLast = te.value;
        inNote(`「${line}」 줄을 넣었어요`, 'ok'); tpNote('넣었어요 · 같은 손님은 꼬리표만 바꿔 이어서, 다른 손님은 번호를 바꿔 넣으세요', 'ok');
        x.sz = null; $('om-tp').querySelectorAll('[data-tpsz]').forEach(b => b.setAttribute('aria-checked', 'false')); if (name) name.value = ''; if (date) date.value = '';
        te.focus({ preventScroll: true }); try { te.select(); } catch (e) { /* 그대로 */ }
    }
    // #850-f 꼬리표(서버로 보내는 tags) = 칸에 그 줄이 있을 때만 · 종전 「누른 단추」 tags 와 같은 값
    const TAG_RE = { cash: /현금\s*손님/, indiv: /입력\s*[oO○0]\s*[·,]?\s*삭제\s*[xX×]|입력\s*삭제|개별\s*발송/i, size: /사이즈/, date: /\d+\s*일\s*(?:발송|출고)|\d{1,2}\s*\/\s*\d{1,2}\s*(?:발송|출고)|^\d{1,2}\/\d{1,2}\/\d{2}\s.*(?:발송|출고)/, sender: /보내는\s*(?:이|분|사람)/ };
    function tagsFromText() { const lines = String(OM.raw || '').split('\n'); Object.keys(TAG_RE).forEach(k => { if (lines.some(l => TAG_RE[k].test(l))) OM.tags.add(k); else OM.tags.delete(k); }); syncTags(); }
    // #850-f 입력 칸 줄마다 × — 재는 칸(같은 폭·글꼴)에 줄을 그려 줄 위치를 재고 오른쪽 끝에 놓음 · 빈 줄엔 없음 · 지운 뒤 되돌리기 한 번
    function xLayout() {
        const raw = $('om-raw'), mir = $('om-raw-mirror'), box = $('om-raw-xs'); if (!raw || !mir || !box) return;
        const lines = raw.value.split('\n');
        mir.style.width = raw.clientWidth + 'px';
        mir.innerHTML = lines.map(l => `<div>${esc(l) || '&#8203;'}</div>`).join('');
        const lh = parseFloat(getComputedStyle(raw).lineHeight) || 26, top0 = raw.offsetTop, st = raw.scrollTop, vis = raw.clientHeight;
        box.style.top = top0 + 'px'; box.style.height = vis + 'px';
        const ds = mir.children;
        box.innerHTML = lines.map((l, i) => { if (!l.trim() || !ds[i]) return ''; const y = ds[i].offsetTop - st; if (y + lh < 0 || y > vis) return ''; return `<button type="button" class="om-in-x" data-ln="${i}" style="top:${y + (lh - Math.min(lh, 44)) / 2}px" aria-label="${i + 1}번째 줄 지우기" title="이 줄 지우기">${ICON_X}</button>`; }).join('');
    }
    function xDel(i) {
        const raw = $('om-raw'), lines = raw.value.split('\n'); if (!(i >= 0 && i < lines.length)) return;
        telLeave(raw, true); OM.xUndo = { value: raw.value, smsSrc: OM.smsSrc };
        lines.splice(i, 1); raw.value = lines.join('\n'); OM.raw = raw.value; inState();
        const u = $('om-raw-undo'); if (u) u.hidden = false;
        if (!OM.raw.trim()) OM.smsSrc = null;
        const nb = $('om-raw-xs').querySelector(`[data-ln="${Math.min(i, lines.length - 1)}"]`) || raw; nb.focus({ preventScroll: true });
    }
    function xUndo() { const U = OM.xUndo; if (!U) return; const raw = $('om-raw'); OM.telLn = null; raw.value = U.value; OM.raw = U.value; OM.smsSrc = U.smsSrc; OM.xUndo = null; xUndoHide(); inState(); raw.focus({ preventScroll: true }); }
    function xUndoHide() { OM.xUndo = null; const u = $('om-raw-undo'); if (u) u.hidden = true; }
    // #857 입력 칸 번호 정리 = 치는 동안엔 값을 안 바꿈(폰 자판 낱말 추천과 엉킴 · #855 치는 대로 하이픈 뺌)
    //   사람이 친 줄을 떠날 때(다른 줄로 커서 · 칸 밖 · [입력하기])만 그 줄 맨 앞 번호 덩어리를 fmtTel 로 한 번 + 뒤 글과 붙어 있으면 빈칸 한 칸
    //   0으로 시작 9~12자리만 · 붙여 넣은 줄·주문번호·날짜·줄 뒤쪽 무접촉
    const lnAt = (v, p) => v.slice(0, p).split('\n').length - 1;
    function telMark(ta, e) {
        const t = (e && e.inputType) || '';
        if (/^insertFrom/.test(t)) { OM.telLn = null; return; }   // 붙여 넣기·끌어 넣기 = 정리 안 함
        const ln = lnAt(ta.value, ta.selectionStart);
        if (/^insert(LineBreak|Paragraph)$/.test(t)) { if (OM.telLn != null) telTidy(ta, ln - 1); OM.telLn = null; return; }   // 줄 바꿈 = 앞줄을 떠남
        OM.telLn = ln;
    }
    function telLeave(ta, all) {
        if (OM.telLn == null || OM.telComp) return;
        if (!all && lnAt(ta.value, ta.selectionStart) === OM.telLn) return;
        const ln = OM.telLn; OM.telLn = null; telTidy(ta, ln);
    }
    function telTidy(ta, ln) {
        const v = ta.value, lines = v.split('\n'); if (!(ln >= 0 && ln < lines.length)) return;
        const l = lines[ln], m = l.match(/^0[0-9-]*/); if (!m) return;
        const chunk = m[0], d = digits(chunk); if (d.length < 9 || d.length > 12 || !isPhoneish(chunk)) return;
        if (d.startsWith('02')) return;   // #862 02 는 하이픈을 넣으면 최종발주가 날짜로 읽음 → 숫자 그대로
        const fv = fmtTel(chunk); if (digits(fv) !== d) return;   // 자릿수가 넘쳐 잘리면 안 바꿈
        const rest = l.slice(chunk.length), nl = fv + (rest && !/^\s/.test(rest) ? ' ' : '') + rest; if (nl === l) return;
        const ls = lines.slice(0, ln).join('\n').length + (ln ? 1 : 0), delta = nl.length - l.length, ss = ta.selectionStart, se = ta.selectionEnd;
        lines[ln] = nl; ta.value = lines.join('\n'); OM.raw = ta.value;
        const mv = p => (p > ls ? Math.max(ls, p + delta) : p);
        try { ta.setSelectionRange(mv(ss), mv(se)); } catch (er) { /* 그대로 */ }
        inState();
    }
    function tplHole(text) {   // 안 고친 틀 자리 → { at, len, msg } | null
        for (const [h, msg] of TPL_HOLES) {
            if (typeof h === 'string') { const at = text.indexOf(h); if (at >= 0) return { at: h === TEL_PH ? at : at + '보내는이 '.length, len: h === TEL_PH ? h.length : '홍길동'.length, msg }; }
            else { const m = text.match(h); if (m) { const at = m.index + m[1].length; return { at, len: 2, msg }; } }
        }
        return null;
    }
    function syncTags() { /* #850-f 단추 켜짐 상태 없음 — 꼬리표(tags)는 글에서 정해 서버로만(tagsFromText) */ }
    function inState() {
        const has = OM.raw.trim().length > 0;
        const go = $('om-go'); go.disabled = !has || OM.busy; go.classList.toggle('ready', has && !OM.busy);
        $('om-raw-clear').hidden = true;   // #850-f 전체 × 대신 줄마다 ×
        tagsFromText(); xLayout();
        $('om-in').classList.toggle('filled', has);
    }
    function inNote(t, k) { const n = $('om-in-note'); if (!n) return; n.textContent = t || '입력하면 내용을 확인하고 [저장]해요 · 저장한 줄은 다음 최종발주에 저절로 들어가요.'; n.dataset.k = k || ''; }
    async function runPreview(src) {
        if (OM.busy) return;
        if (!src) { OM.telComp = false; telLeave($('om-raw'), true); }   // #857 [입력하기] = 친 줄 번호 정리 먼저
        const raw = src ? src.text : OM.raw.trim(); if (!raw) return;
        if (!src) { const hole = tplHole(OM.raw); if (hole) { inNote(hole.msg, 'err'); const ta = $('om-raw'); ta.focus({ preventScroll: true }); try { ta.setSelectionRange(hole.at, hole.at + hole.len); } catch (e) { /* 그대로 */ } return; } }   // #850-c 틀 자리 안 고침 = 막음
        OM.busy = true; inState(); $('om-go').textContent = '입력하는 중…'; if (!src) inNote('글을 읽고 있어요 · 길면 몇 초 걸려요');
        const sms = !src && OM.smsSrc ? OM.smsSrc : null;   // #850-g 문자 대화에서 입력 칸에 채운 글 = 출처·번호는 그 대화
        const req = { raw, tags: src ? (src.tags || []) : [...OM.tags], source: src ? src.source : sms ? 'sms:' + sms.threadId : 'manual' };
        if ((src || sms) && (src || sms).phone) req.phone = (src || sms).phone;
        const res = await API.preview(req);
        OM.busy = false; $('om-go').textContent = '입력하기'; inState();
        if (!res.ok) {
            const msg = res.status === 404 ? '서버가 아직 발주 메모함을 몰라요(배포 전)' : res.status === 429 ? '잠시 뒤 다시 해 주세요(정리를 너무 자주 눌렀어요)' : errText(res, '정리하지 못했어요 · 다시 눌러 주세요');
            if (src) toast(msg); else inNote(msg, 'err');
            return;
        }
        if (!src) inNote('');
        const b = res.body || {};
        const rows = (Array.isArray(b.rows) ? b.rows : []).map(r => normRow(r)).filter(Boolean);
        const desk = b.desk && typeof b.desk === 'object' ? b.desk : null;   // null = 규칙으로 다 읽힘 · wait = 창구가 남은 글 정리 중 · off = 창구 꺼짐(규칙 줄만)
        const waiting = !!(desk && desk.state === 'wait' && desk.id != null);
        if (!rows.length && !b.leftover && !waiting) { const e = emptyRow(src || sms); if (e) rows.push(e); }   // #850-g 정리된 줄 0 = 문자 출처만 현금 빈 줄 · 그 밖은 안내만
        cardOpen({ mode: 'new', raw, tags: req.tags, source: req.source, rows, leftover: b.leftover || '', ask: b.sms_draft || '', from: src || sms || null,
            wait: waiting ? { id: desk.id, start: Date.now(), sec: Number(desk.wait_sec) || 30 } : null,
            deskNote: desk && desk.state === 'off' ? (desk.message || '창구가 꺼져 있어 지금은 규칙으로만 정리했어요 · 남은 글은 직접 채워 주세요') : '' });
        if (waiting) waitLoop(OM.card);
    }
    // ── 창구 정리 기다리기(최종발주 메모 읽기와 같은 꼴 · 2.5초마다 · 최대 3분) ──
    const WAIT_MAX = 180000;
    async function waitLoop(c) {
        while (OM.card === c && c.wait) {
            await new Promise(r => setTimeout(r, 2500));
            if (OM.card !== c || !c.wait) return;
            if (Date.now() - c.wait.start > WAIT_MAX) { waitEnd(c, { state: 'fail', message: '오래 걸려요 — 남은 글은 직접 채워 주세요' }); return; }
            const res = await API.previewGet(c.wait.id);
            if (OM.card !== c || !c.wait) return;
            if (!res.ok) { if (res.status === 404 || res.status === 403) { waitEnd(c, { state: 'fail', message: '정리 요청을 못 찾았어요 — 남은 글은 직접 채워 주세요' }); return; } continue; }   // 잠깐 끊김 = 다음 바퀴
            const s = res.body || {};
            if (s.state === 'done' || s.state === 'fail') { waitEnd(c, s); return; }
        }
    }
    function waitEnd(c, s) {
        const id = c.wait && c.wait.id; c.wait = null;
        if (id != null) API.previewDel(id);   // 받은 직후 꼭 지움(손님 글·결과)
        if (OM.card !== c) return;
        if (s.state === 'done') {
            const add = (Array.isArray(s.rows) ? s.rows : []).map(r => normRow(r)).filter(Boolean);
            add.forEach(r => { c.rows.push(r); c.orig.push(clone(r)); });   // ↺ 처음 값 = 창구가 정리한 값
            if (s.sms_draft) c.ask = s.sms_draft;
            c.leftover = s.leftover || '';
            c.deskNote = add.length ? '' : (c.leftover ? '창구가 읽지 못한 글이 있어요 · 직접 채워 주세요' : '');
            if (!c.rows.length) { const nr = emptyRow(c.from); if (nr) { c.rows.push(nr); c.orig.push(clone(nr)); } }
        } else {
            c.leftover = s.leftover || c.leftover || c.raw;
            c.deskNote = s.message || '창구가 정리하지 못했어요 — 남은 글은 직접 채워 주세요';
        }
        renderCard();
        c.rows.forEach((r, i) => { if (r.kind === 'line' && !r._lk && !r._new) lkRun(i); });   // #867 창구가 나중에 넣은 메모 줄도 판매처 확인(입력삭제 받는 분 번호 막기)
        const f = $('om-card').querySelector('.om-f.blank input, .om-f.blank textarea, .om-f.blank .om-combo'); if (f && !phoneW()) f.focus({ preventScroll: true });
    }
    function waitTick() {   // 기다리는 초만 고쳐 씀(다시 그리지 않음)
        const c = OM.card; if (!c || !c.wait) return;
        const el = $('om-wait-sec'); if (el) el.textContent = String(Math.floor((Date.now() - c.wait.start) / 1000));
        setTimeout(waitTick, 1000);
    }
    // #850-g 정리 결과가 0줄일 때 = 문자 대화에서 왔으면 현금 빈 줄(받는 분 연락처·구매자 번호 = 문자 번호) · 그 밖은 줄 안 만듦(카드에 「정리된 줄이 없어요」)
    function emptyRow(src) {
        if (!(src && src.phone)) return null;
        const r = blankRow('cash'), p = telShow(src.phone); r.cells[6] = p; r.cells[10] = p; return r;
    }
    function blankRow(kind, phone) {
        const r = normRow({ kind, sure: false, check_why: [] });
        if (phone) { if (kind === 'cash') r.cells[10] = phone; else r.key = phone; }
        return r;
    }

    // ── 목록 ──────────────────────────────────────────
    async function load() {
        OM.loading = true; renderList();
        const tab = OM.tab, res = await API.list(tab);
        OM.loading = false;
        if (tab !== OM.tab) return;
        if (!res.ok) { OM.err = res.status === 404 ? '서버가 아직 발주 메모함을 몰라요(배포 전)' : errText(res, '목록을 못 불러왔어요'); renderList(); return; }
        OM.err = '';
        const b = res.body || {};
        OM.shipDate = b.ship_date ? String(b.ship_date).slice(0, 10) : (OM.shipDate || nextShip());
        const rows = []; (Array.isArray(b.entries) ? b.entries : []).forEach(e => (Array.isArray(e.rows) ? e.rows : []).forEach(r => { const x = normRow(r, e); if (x && (tab === 'cleared' ? x.state === 'cleared' : x.state !== 'cleared')) rows.push(x); }));
        if (tab === 'open') { OM.list = rows; OM.counts = b.counts || null; } else OM.cleared = rows;
        renderList(); if (tab === 'open') loadShip();
    }
    function syncTabs() {
        OM.el.querySelectorAll('.om-tabb').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === OM.tab ? 'true' : 'false'));
        $('om-foot').hidden = OM.tab !== 'open'; if (OM.delArm) delDisarm();
    }
    function renderList() {
        const ul = $('om-list'), sum = $('om-sum');
        const rows = OM.tab === 'open' ? OM.list : OM.cleared;
        const open = OM.list || [];
        $('om-n-open').textContent = open.length ? String(open.length) : '';
        const nCheck = open.filter(isCheck).length;
        const have = new Set(open.map(r => String(r.id))); OM.sel.forEach(id => { if (!have.has(id)) OM.sel.delete(id); });   // #859 없어진 줄은 고른 것에서 뺌
        $('om-selbar').hidden = OM.tab !== 'open' || !open.length || !!OM.err; selSync();
        const hp = $('om-hpill'); hp.hidden = !nCheck; hp.textContent = '확인 ' + nCheck;
        if (OM.loading && !rows) { ul.innerHTML = '<li class="om-skel" aria-hidden="true"></li><li class="om-skel" aria-hidden="true"></li><li class="om-skel" aria-hidden="true"></li>'; sum.textContent = ''; return; }
        if (OM.err) { ul.innerHTML = `<li class="om-empty err"><b>${esc(OM.err)}</b><button type="button" class="om-btn sm" data-act="reload">다시 불러오기</button></li>`; sum.textContent = ''; return; }
        if (!rows || !rows.length) {
            ul.innerHTML = OM.tab === 'open'
                ? '<li class="om-empty"><b>내일 발주에 넣을 메모가 없어요</b><span>손님 글을 위 칸에 붙여 넣으면 여기에 쌓여요.</span></li>'
                : '<li class="om-empty"><b>비운 메모가 없어요</b><span>비운 줄은 30일 동안 여기서 되살릴 수 있어요.</span></li>';
            sum.textContent = OM.tab === 'open' ? '' : '';
            return;
        }
        if (OM.tab === 'open') {
            const ready = open.filter(r => !isCheck(r) && !isLater(r));
            const nLine = ready.filter(r => r.kind === 'line').length, nCash = ready.filter(r => r.kind === 'cash').length, nLater = open.filter(r => !isCheck(r) && isLater(r)).length;
            sum.innerHTML = `${esc(mdw(OM.shipDate))} 발주에 <b>메모 ${nLine}줄 · 현금 ${nCash}줄</b>` + (nLater ? ` · 날짜 대기 ${nLater}` : '') + (nCheck ? ` · <em>확인 ${nCheck}</em>` : '');
        } else sum.textContent = '비운 지 30일이 지나면 영구로 지워져요.';
        const rank = r => OM.tab !== 'open' ? 0 : isCheck(r) ? 0 : isLater(r) ? 2 : r.used_on ? 3 : 1;   // 확인할 줄 → 내일 발주 → 날짜 대기 → 넣은 것 · 같은 무리 안은 최근 순
        const sorted = rows.slice().sort((a, b) => rank(a) - rank(b) || String(b.entry.created_at || '').localeCompare(String(a.entry.created_at || '')));
        ul.innerHTML = sorted.map(rowHtml).join('');
    }
    function rowHtml(r) {
        const isOpen = OM.tab === 'open';
        const p = isOpen ? pillOf(r) : { k: 'gone', t: '비움 ' + hm(r.cleared_at) };
        const nm = nameOf(r), l4 = last4(numOf(r));
        const who = [r.entry.created_by, hm(r.entry.created_at)].filter(Boolean).join(' · ');
        const why = isOpen && isCheck(r) ? `<p class="om-why">${esc(whyOf(r))}</p>` : '';
        const act = isOpen
            ? `<button type="button" class="om-x" data-act="del" aria-label="${esc((nm || (l4 ? '…' + l4 : '이 줄')) + ' 지우기')}" title="지우기">${ICON_X}</button>`
            : `<button type="button" class="om-btn sm om-restore" data-act="restore">되살리기</button>`;
        const label = (nm || (l4 ? '…' + l4 : '메모')) + (isOpen ? ' 열어 고치기' : '');
        const on = isOpen && OM.sel.has(String(r.id));
        const ck = isOpen ? `<label class="om-ck"><input type="checkbox" data-act="pick" aria-label="${esc((nm || (l4 ? '…' + l4 : '이 줄')) + ' 고르기')}"${on ? ' checked' : ''}></label>` : '';
        return `<li class="om-item k-${p.k}${on ? ' picked' : ''}" data-id="${esc(r.id)}">
            <div class="om-row">${ck}
              <${isOpen ? 'button type="button" class="om-open" data-act="edit"' : 'div class="om-open"'} aria-label="${esc(label)}">
                <span class="om-r1">${nm ? `<b class="om-nm">${esc(nm)}</b>` : ''}${l4 ? `<span class="om-l4">…${esc(l4)}</span>` : ''}${r.kind === 'cash' ? (r.indiv ? '<span class="om-pill k-addr">주소 줄</span>' : '<span class="om-pill k-cash">현금</span>') : ''}<span class="om-pill k-${p.k}">${esc(p.t)}</span><span class="om-who">${esc(who)}</span></span>
                <span class="om-line">${esc(previewOf(r) || '(빈 줄)')}</span>
              </${isOpen ? 'button' : 'div'}>
              ${act}
            </div>${why}</li>`;
    }
    const rowById = id => ((OM.tab === 'open' ? OM.list : OM.cleared) || []).find(r => String(r.id) === String(id));
    async function onList(e) {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'pick') return;   // #859 고르기 칸 = change 에서
        if (act === 'reload') { load(); return; }
        const li = b.closest('.om-item'); const r = li && rowById(li.dataset.id); if (!r) return;
        if (act === 'edit') { cardOpen({ mode: 'edit', rows: [clone(r)], raw: r.entry.raw || '', source: r.entry.source || '' }); return; }
        if (act === 'del') return delRow(r, li);
        if (act === 'restore') {
            b.disabled = true; const res = await API.restore(r.id);
            if (!res.ok) { b.disabled = false; toast(errText(res, '되살리지 못했어요')); return; }
            OM.cleared = (OM.cleared || []).filter(x => x !== r); renderList(); OM.list = null;
            toast('되살렸어요 · 「지금 메모」로 돌아갔어요');
        }
    }
    async function delRow(r, li) {
        li.classList.add('going'); const x = li.querySelector('.om-x'); if (x) x.disabled = true;
        const res = await API.remove(r.id);
        if (!res.ok) { li.classList.remove('going'); if (x) x.disabled = false; toast(errText(res, '지우지 못했어요')); return; }
        OM.list = (OM.list || []).filter(y => y !== r);
        setTimeout(() => { renderList(); renderPrev(); }, 160);
        undoShow('지웠어요 · ' + (nameOf(r) || (last4(numOf(r)) ? '…' + last4(numOf(r)) : '한 줄')), async () => { const y = await API.restore(r.id); if (!y.ok) { toast(errText(y, '되돌리지 못했어요')); return; } load(); });
        loadShip();
    }
    function undoShow(t, fn) { clearTimeout(OM.undoT); OM.undo = fn; $('om-undo-t').textContent = t; $('om-undo').hidden = false; OM.undoT = setTimeout(undoHide, 6000); }
    function undoHide() { clearTimeout(OM.undoT); OM.undo = null; const u = $('om-undo'); if (u) u.hidden = true; }
    function undoRun() { const fn = OM.undo; undoHide(); if (fn) fn(); }

    // ── #859 고른 줄 삭제(줄 × 와 같은 서버 길 = 비운 것 30일 · 되살리기 가능) · 두 번 눌러야 지움(첫 누름 = 「한 번 더 누르면 n줄 삭제」 주황 · 3초 · 다른 데 누르면 되돌아감) ─────
    function selSync() {
        const open = OM.list || [], n = OM.sel.size, all = $('om-selall'), b = $('om-del');
        if (all) { all.checked = !!open.length && n === open.length; all.indeterminate = n > 0 && n < open.length; }
        const sn = $('om-seln'); if (sn) sn.textContent = n ? n + '줄 고름' : '';
        if (!n && OM.delArm) delDisarm();
        if (!b) return;
        b.disabled = !n || OM.delBusy; b.classList.toggle('armed', OM.delArm);
        b.textContent = OM.delBusy ? '지우는 중…' : OM.delArm ? `한 번 더 누르면 ${n}줄 삭제` : '삭제';
    }
    function delDisarm() { clearTimeout(OM.delT); OM.delArm = false; selSync(); }
    function delClick() {
        if (!OM.sel.size || OM.delBusy) return;
        if (!OM.delArm) { OM.delArm = true; clearTimeout(OM.delT); OM.delT = setTimeout(delDisarm, 3000); selSync(); return; }
        delRun();
    }
    async function delRun() {
        clearTimeout(OM.delT); OM.delArm = false;
        const rows = (OM.list || []).filter(r => OM.sel.has(String(r.id))); if (!rows.length) { selSync(); return; }
        OM.delBusy = true; selSync();
        const res = await Promise.all(rows.map(r => API.remove(r.id)));
        OM.delBusy = false;
        const done = rows.filter((r, i) => res[i].ok), bad = rows.length - done.length;
        done.forEach(r => OM.sel.delete(String(r.id)));
        OM.list = (OM.list || []).filter(r => !done.includes(r));
        renderList(); renderPrev();
        if (bad) toast(errText(res.find(x => !x.ok), '지우지 못했어요') + (done.length ? ` · ${done.length}줄은 지웠어요` : ''));
        if (done.length) undoShow(`${done.length}줄 지웠어요`, async () => { const ys = await Promise.all(done.map(r => API.restore(r.id))); if (ys.some(y => !y.ok)) toast(errText(ys.find(y => !y.ok), '되돌리지 못했어요')); load(); });
        loadShip();
    }

    // ── 「내일 발주에 들어갈 것」 = for-ship 그대로(PC 오른쪽 · 폰은 단추로 여는 판) ─────
    async function loadShip() {
        if (!OM.shipDate) return;
        const res = await API.forShip(OM.shipDate);
        OM.ship = res.ok ? res.body : null; renderPrev();
    }
    function renderPrev() {
        const box = $('om-prev-b'); if (!box) return;
        $('om-prev-d').textContent = OM.shipDate ? mdw(OM.shipDate) + ' 발주' : '';
        const s = OM.ship;
        if (!s) { box.innerHTML = OM.list ? '<p class="om-prev-empty">미리보기를 불러오지 못했어요.</p>' : ''; return; }
        const memo = String(s.memo_text || ''), aoa = Array.isArray(s.cash_aoa) ? s.cash_aoa : [];
        const nL = memo ? memo.split('\n').filter(Boolean).length : 0, nC = Math.max(0, aoa.length - 1), held = Array.isArray(s.held) ? s.held.length : 0, wait = Array.isArray(s.waiting) ? s.waiting.length : 0;
        if (!nL && !nC) { box.innerHTML = '<p class="om-prev-empty">아직 들어갈 줄이 없어요.<br>저장한 메모는 여기 「최종발주 메모 칸에 들어가는 글」 그대로 보여요.</p>' + (held ? `<p class="om-prev-held">확인 안 된 ${held}줄은 안 들어가요.</p>` : ''); return; }
        const H = aoa[0] || [], show = [3, 4, 5, 6, 8];
        box.innerHTML = (nL ? `<h3>메모 칸 <small>${nL}줄 · 뒤 날짜 줄은 최종발주가 「오늘 안 나감」으로 빼요</small></h3><pre class="om-prev-memo">${esc(memo.split('\n').map(lineView).join('\n'))}</pre>` : '')
            + (nC ? `<h3>현금 줄 <small>${nC}줄 · 현금파일과 합쳐서 대조해요</small></h3><div class="om-prev-tw" tabindex="0" aria-label="현금 줄 표"><table class="om-prev-t"><thead><tr>${show.map(i => `<th>${esc(H[i] || '')}</th>`).join('')}</tr></thead><tbody>${aoa.slice(1).map(row => `<tr>${show.map(i => `<td${i === 5 || i === 6 ? ' class="n"' : ''}>${esc(i === 4 ? shortOpt(row[i]) : row[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '')
            + (held || wait ? `<p class="om-prev-held">${[held ? `확인 안 된 ${held}줄은 안 들어가요` : '', wait ? `날짜 대기 현금 ${wait}줄은 그날 들어가요` : ''].filter(Boolean).join(' · ')}</p>` : '');
    }
    function prevShow(on, hist) {
        if (!!on === OM.prevOpen) return;
        OM.prevOpen = !!on; OM.el.classList.toggle('prev-open', OM.prevOpen);
        if (on) { renderPrev(); hbPush('omprev', () => prevShow(false, false)); $('om-prev-x').focus({ preventScroll: true }); }
        else { if (hist) hbDrop('omprev'); const b = $('om-prev-open'); if (b && phoneW()) b.focus({ preventScroll: true }); }
    }

    // ── 정리 결과 카드 ────────────────────────────────
    function cardOpen(c) {
        if (OM.card) cardClose(true);   // 앞 카드가 떠 있으면 먼저 닫음(기다리던 창구 요청은 취소·지움)
        c.rows.forEach(r => {   // #850-c 번호 = 000-0000-0000 꼴로 보이게(전화번호 꼴만 · 주문번호 그대로) — 「처음 값」보다 먼저(고친 것으로 안 셈)
            if (r.kind === 'line') { const k = telShow(r.key); if (k !== r.key) { r.key = k; r.line = [r.ship_date ? md(r.ship_date) : '', r.key, r.note, r.plat].join('\t'); } }
            else { [1, 6, 7, 10].forEach(i => { r.cells[i] = telShow(r.cells[i]); }); if (c.mode !== 'edit') tailFromNote(r); }   // #856 손님 글의 사이즈·과수 = 미리 고름(처음 값으로 셈)
        });
        c.orig = clone(c.rows); c.dirty = false; c.confirm = false;
        OM.card = c; OM.lastFocus = document.activeElement;
        if (!OM.catalog) loadCatalog();
        renderCard(); lkAll();
        $('om-card').hidden = false; $('om-card-back').hidden = false;
        hbPush('omcard', () => cardClose(false, true));
        if (c.wait) setTimeout(waitTick, 1000);
        requestAnimationFrame(() => { const f = $('om-card').querySelector('.om-f.blank input, .om-f.blank textarea, .om-f.blank .om-combo') || $('om-card-save'); if (f) f.focus({ preventScroll: !phoneW() }); });
    }
    // fromHist = 뒤로가기로 이미 기록이 빠진 경우 · force = 묻지 않고 닫기
    function cardClose(force, fromHist) {
        const c = OM.card; if (!c) return;
        if (!force && c.dirty && !c.confirm) {
            c.confirm = true; renderConfirm();
            if (fromHist) setTimeout(() => { if (OM.card === c) hbPush('omcard', () => cardClose(false, true)); }, 0);   // 뒤로가기로 빠진 칸을 다시 쌓는다(아직 닫지 않음) — 다음 틱에: 기록 쪽이 칸을 닫는 고리를 다 돈 뒤(안에서 쌓으면 그 고리가 바로 또 닫음)
            return;
        }
        optClose(false);
        if (c.wait) { const id = c.wait.id; c.wait = null; API.previewDel(id); }   // 정리 중에 닫음 = 그 요청 취소(손님 글 지움)
        OM.card = null;
        const card = $('om-card'), back = $('om-card-back'); if (card) { card.hidden = true; card.innerHTML = ''; } if (back) back.hidden = true;
        if (!fromHist) hbDrop('omcard');
        // 초점은 창 안으로만 되돌린다(문자 대화에서 왔으면 그 단추는 창 뒤 — 거기로 가면 다음 Esc·Tab 이 뒤 화면으로 샘)
        const ret = OM.lastFocus && OM.lastFocus.isConnected && OM.el.contains(OM.lastFocus) ? OM.lastFocus : (phoneW() ? $('om-close') : $('om-raw'));
        if (ret && !OM.el.hidden) try { ret.focus({ preventScroll: true }); } catch (e) { /* 그대로 */ }
    }
    function renderConfirm() {
        const f = $('om-card').querySelector('.om-card-f'); if (!f) return;
        const c = OM.card;
        f.innerHTML = c.confirm
            ? `<p class="om-confirm" id="om-confirm-t" role="alert"><b>저장 안 하고 닫을까요?</b> 고친 내용이 사라져요.</p><button type="button" class="om-btn" data-cact="keep">계속 고치기</button><button type="button" class="om-btn danger" data-cact="discard">저장 안 하고 닫기</button>`
            : footHtml();
        const d = f.querySelector(c.confirm ? '[data-cact="keep"]' : '#om-card-save'); if (d) d.focus({ preventScroll: true });
    }
    function renderDup() {   // #850-f 같은 번호 같은 종류 줄이 이미 있음 — 바꿀지 묻기(발 칸에)
        const f = $('om-card').querySelector('.om-card-f'), q = OM.card && OM.card.dupAsk; if (!f || !q) return;
        const items = q.diff.map(x => `<li><b>${esc(telShow(q.rows[x.i].key))}</b> 이미 ${esc(x.kind)} 줄이 있어요 · 「${esc(lineView(x.olds[0].note))}」${x.olds[0].ship_date ? ' ' + esc(md(x.olds[0].ship_date)) : ''} → 「${esc(lineView(q.rows[x.i].note))}」${q.rows[x.i].ship_date ? ' ' + esc(md(q.rows[x.i].ship_date)) : ''}</li>`).join('');
        f.innerHTML = `<div class="om-confirm om-dup" role="alert"><b>새 것으로 바꿀까요?</b><ul>${items}</ul>${q.same.length ? `<small>똑같은 줄 ${q.same.length}개는 이미 있어 빼고 저장해요</small>` : ''}</div><button type="button" class="om-btn" data-cact="dupkeep">취소</button><button type="button" class="om-btn primary" data-cact="dupswap">바꾸기</button>`;
        const d = f.querySelector('[data-cact="dupswap"]'); if (d) d.focus({ preventScroll: true });
    }
    async function loadCatalog() {
        const res = await API.catalog();
        const set = new Set(); if (res.ok && res.body && res.body.byPartner) Object.values(res.body.byPartner).forEach(a => (a || []).forEach(n => n && set.add(n)));
        OM.catalog = [...set].sort((a, b) => a.localeCompare(b, 'ko'));
        if (OM.opt) optRender();
    }
    const fid = (ri, f) => `om-f-${ri}-${f.kind === 'shipdate' ? 'date' : f.i != null ? 'c' + f.i : f.k}`;
    const getV = (r, f) => f.kind === 'shipdate' ? (r.ship_date ? md(r.ship_date) : '') : f.kind === 'sender' ? senderShow(r.cells[0]) : valOf(r, f);
    function setV(r, f, v) {
        if (f.kind === 'shipdate') { const iso = toIso(v); r.ship_date = iso === undefined ? r.ship_date : iso; r._dateBad = iso === undefined; }
        else if (f.kind === 'sender') r.cells[0] = senderShow(v);   // #863 이름만 보냄(「!」 = 서버가 맨 뒤에)
        else if (r.kind === 'cash') r.cells[f.i] = v; else r[f.k] = v;
        if (r.kind === 'line') r.line = [r.ship_date ? md(r.ship_date) : '', r.key, r.note, r.plat].join('\t');
    }
    // #856 현금 줄 품목 꼬리 = 최종발주와 같은 글자(옵션 끝 「 2S사이즈로!」 · 「 15과로!」 · final-order sizeItem·tailNorm 과 같은 규칙)
    //   사이즈 = 귤 로얄과(선물용 제외) · 과수 = 선물용 만감류(황금향·한라봉·레드향·천혜향 · 카라향·하우스·타이벡 선물 X = jeju-gift-size-rule)
    const OPT_TAIL = /\s+((?:2S|S|M)사이즈로!|\d{1,2}과로!)\s*$/;
    const optBase = v => String(v || '').replace(OPT_TAIL, '').trim();
    const optTail = v => (String(v || '').match(OPT_TAIL) || [])[1] || '';
    const sizeItem = s => /귤/.test(s) && /로얄과/.test(s) && !/선물용/.test(s);
    const gwaItem = s => /황금향|한라봉|레드향|천혜향/.test(s) && /선물/.test(s);
    const tailFits = (base, t) => !t || (/사이즈로!$/.test(t) ? sizeItem(base) : /과로!$/.test(t) ? gwaItem(base) : false);
    const withOptTail = (base, t) => optBase(base) + (t ? ' ' + t : '');
    // 손님 글(AI·규칙이 배송메세지 칸에 둔 「S사이즈로」·「15과」)로 미리 고름 → 그 말은 배송메세지에서 뺌(옵션 꼬리로 옮김)
    function tailFromNote(r) {
        if (r.kind !== 'cash' || optTail(r.cells[4])) return;
        const base = optBase(r.cells[4]), note = String(r.cells[9] || '');
        let m, t = '';
        if (sizeItem(base) && (m = note.match(/(^|[^0-9A-Za-z])(2S|S|M)\s*사이즈\s*(?:로)?\s*!?/i))) t = m[2].toUpperCase() + '사이즈로!';
        // 과수 = 「15과」 뒤가 로·수·끝·빈칸·문장부호일 때만(「2 과일상자」는 안 집음)
        else if (gwaItem(base) && (m = note.match(/(^|[^0-9])(\d{1,2})\s*과수?(?=로|$|[\s!.,])\s*(?:로)?\s*!?/))) t = Number(m[2]) + '과로!';
        if (!t) return;
        r.cells[4] = withOptTail(base, t);
        r.cells[9] = (note.slice(0, m.index) + m[1] + note.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').replace(/^[\s·,.]+|[\s·,]+$/g, '').trim();
    }
    function tailHtml(ri, r) {
        const base = optBase(r.cells[4]), t = optTail(r.cells[4]);
        if (sizeItem(base)) return `<div class="om-tailrow"><span class="om-tail-l" id="om-tl-${ri}">사이즈</span><div class="om-seg om-tail" role="radiogroup" aria-labelledby="om-tl-${ri}">${[['2S사이즈로!', '2S'], ['S사이즈로!', 'S'], ['M사이즈로!', 'M'], ['', '없음']].map(([v, l]) => `<button type="button" role="radio" class="om-seg-b" data-cact="tail" data-ri="${ri}" data-v="${v}" aria-checked="${t === v ? 'true' : 'false'}">${l}</button>`).join('')}</div></div>`;
        if (gwaItem(base)) return `<div class="om-tailrow"><label class="om-tail-l" for="om-f-${ri}-gwa">과수</label><input id="om-f-${ri}-gwa" class="om-gwa" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="예) 15" data-ri="${ri}" data-ftail="1" value="${esc((t.match(/^(\d+)과로!$/) || [])[1] || '')}"><span class="om-tail-s">과로!</span><small class="om-tail-h">비우면 과수 지정 안 함</small></div>`;
        return '';
    }
    const fieldsOf = r => (r.kind === 'cash' ? CASH_FIELDS : LINE_FIELDS).concat([{ kind: 'shipdate', label: '발송일', ph: '비우면 다음 발주 · 예) 10/30' }]);
    function fieldHtml(ri, r, f) {
        const v = getV(r, f), o = getV(origOf(ri) || r, f), id = fid(ri, f);
        const blank = !r._new && f.need && !String(v).trim();
        const why = blank ? fieldWhy(r, f) : (f.kind === 'shipdate' && r._dateBad ? '날짜를 못 읽었어요 · 예) 10/30' : '');
        const changed = String(v) !== String(o);
        const undo = `<button type="button" class="om-undo1" data-cact="undo1" data-ri="${ri}" data-f="${esc(id)}" aria-label="${esc(f.label)} 처음 값으로" title="처음 정리한 값으로"${changed ? '' : ' hidden'}>${ICON_UNDO}<span>처음 값</span></button>`;
        let input;
        const aria = `${blank ? ' aria-invalid="true"' : ''} aria-describedby="${id}-w"`;
        if (f.kind === 'option') {
            input = `<button type="button" class="om-combo" id="${id}" data-cact="opt" data-ri="${ri}" aria-haspopup="dialog"${aria}><span>${v ? esc(shortOpt(optBase(v))) + (OM.catalog && !OM.catalog.includes(optBase(v)) ? ' <em>목록에 없음</em>' : '') : '<i>품목 고르기</i>'}</span>${ICON_DOWN}</button>` + (r.kind === 'cash' ? tailHtml(ri, r) : '');   // #856 사이즈·과수 꼬리
        } else if (f.kind === 'qty') {
            input = `<div class="om-step"><button type="button" class="om-btn icon" data-cact="step" data-d="-1" data-ri="${ri}" aria-label="수량 하나 빼기">−</button><input id="${id}" inputmode="numeric" pattern="[0-9]*" data-ri="${ri}" data-fi="${f.i}" value="${esc(v)}"${aria}><button type="button" class="om-btn icon" data-cact="step" data-d="1" data-ri="${ri}" aria-label="수량 하나 더하기">+</button></div>`;
        } else if (f.kind === 'area') {
            input = `<textarea id="${id}" rows="2" data-ri="${ri}" data-fi="${f.i}"${aria}>${esc(v)}</textarea>` + (r.kind === 'cash' && f.i === 8 ? `<p class="om-addr" id="om-addr-${ri}" role="status" aria-live="polite" data-k="${addrKind(r)}">${addrHtml(r, ri)}</p>` : '');
        } else if (f.kind === 'platform') {
            input = `<div class="om-seg" role="radiogroup" aria-label="${esc(f.label)}">${PLATS.concat(OM.card && OM.card.mode === 'edit' ? [] : [CASH_PLAT]).map(p => `<button type="button" role="radio" class="om-seg-b" data-cact="plat" data-ri="${ri}" data-v="${esc(p)}" aria-checked="${v === p ? 'true' : 'false'}">${p}</button>`).join('')}</div><p class="om-lk" id="om-lk-${ri}" role="status" aria-live="polite" data-k="${lkKind(r)}">${lkHtml(r, ri)}</p>`;
        } else {
            const at = f.kind === 'shipdate' ? 'data-fd="1"' : f.kind === 'sender' ? 'data-fs="1"' : f.i != null ? `data-fi="${f.i}"` : `data-fk="${f.k}"`;
            input = `<input id="${id}" ${f.kind === 'tel' ? 'inputmode="tel" ' : ''}${f.ph ? `placeholder="${esc(f.ph)}" ` : ''}data-ri="${ri}" ${at} value="${esc(v)}"${aria}>`;
            if (r.kind === 'cash' && f.i === 10) input = `<div class="om-telrow">${input}${sameBtn(r, ri)}</div>`;   // #862 구매자 연락처 = 받는 분 연락처 그대로 넣기
        }
        const wide = f.kind === 'area' || f.kind === 'option' || f.kind === 'platform' || (r.kind === 'line' && f.k === 'note');
        return `<div class="om-f${blank ? ' blank' : ''}${wide ? ' wide' : ''}${f.kind === 'qty' ? ' qty' : ''}" data-fwrap="${esc(id)}"><div class="om-f-l"><label for="${id}">${esc(f.label)}${f.hint ? ` <small>${esc(f.hint)}</small>` : ''}</label>${undo}</div>${input}<p class="om-f-w" id="${id}-w">${esc(why)}</p></div>`;
    }
    const sameBtn = (r, ri) => `<button type="button" class="om-btn om-same" data-cact="same" data-ri="${ri}"${String(r.cells[6] || '').trim() ? '' : ' disabled'} title="받는 분 연락처를 그대로 넣어요">수취인과 동일</button>`;
    const footHtml = () => { const n = blankN(); if (OM.card && OM.card.wait) return `<button type="button" class="om-btn" data-cact="cancel">취소</button><button type="button" class="om-btn primary" id="om-card-save" data-cact="save" disabled>정리 중… <small>끝나면 저장할 수 있어요</small></button>`; return `<button type="button" class="om-btn" data-cact="cancel">취소</button><button type="button" class="om-btn primary" id="om-card-save" data-cact="save">${saveLabel(n)}</button>`; };
    const saveLabel = n => indivPendAt() >= 0 ? '번호 확인 중…' : indivBadAt() >= 0 ? '저장 <small>입력삭제 번호를 구매자 번호로 바꿔 주세요</small>' : n ? '저장 <small>빈칸은 「확인」으로 남아요</small>' : (OM.card.mode === 'edit' ? '고친 대로 저장' : '저장');   // #867
    const blankN = () => OM.card ? OM.card.rows.reduce((s, r) => s + blanksOf(r, true).length + (addrBad(r) ? 1 : 0), 0) : 0;   // #850-g 주소 확인 안 됨 = 빈칸 1
    function askText(c) {
        if (c.ask) return c.ask;
        const need = new Set(); c.rows.forEach(r => blanksOf(r).forEach(f => need.add(f.i != null ? f.i : f.k)));
        const want = [];
        if (need.has(3) || need.has(6)) want.push('받으실 분 성함·연락처');
        if (need.has(8)) want.push('주소');
        if (need.has(4) || need.has(5)) want.push('원하시는 품목·수량');
        if (!want.length) return '';
        const d = c.rows.map(r => r.ship_date).filter(Boolean)[0];
        return `안녕하세요 제주아꼼이네입니다. ${want.join('과 ')}를 알려 주시면 ${d ? mdw(d) + '에' : '바로'} 보내 드릴게요.`;
    }
    function renderCard() {
        const c = OM.card; if (!c) return;
        const card = $('om-card'); const bEl = card.querySelector('.om-card-b'); const sc = bEl ? bEl.scrollTop : 0;
        const n = blankN();
        const tags = []; if (c.rows.some(r => r.kind === 'cash' && !r.indiv)) tags.push('<span class="om-pill k-cash">현금 손님</span>'); if (c.rows.some(r => r.kind === 'cash' && r.indiv)) tags.push('<span class="om-pill k-addr">입력삭제 주소 줄</span>');   // indiv = 입력삭제 주문의 주소 줄(「!」 없음 · 서버가 정함)
        const d = c.rows.map(r => r.ship_date).filter(Boolean)[0]; if (d) tags.push(`<span class="om-pill k-later">${esc(mdw(d))} 발송</span>`);
        const srcLabel = /^sms/.test(c.source || '') ? '문자 대화에서 가져옴' + (c.from && c.from.phone ? ' · ' + esc(c.from.phone) : '') : '붙여 넣은 글';
        const ask = '';   // #853 「손님께 물어볼 문자 초안」 칸 안 그림(서버 sms_draft 는 받아 둠 · askText 는 남김)
        card.innerHTML = `
          <header class="om-card-h">
            <button type="button" class="om-back" data-cact="cancel" aria-label="닫기"><span aria-hidden="true">×</span></button>
            <h3 id="om-card-t">${c.mode === 'edit' ? '메모 고치기' : c.cash ? '현금 손님 입력' : '정리 결과 확인'}</h3>
            <button type="button" class="om-btn sm om-reset" data-cact="reset"${c.dirty ? '' : ' hidden'}>${ICON_UNDO}처음으로</button>
            <span class="om-hpill${n ? '' : ' ok'}" id="om-card-n">${n ? '빈칸 ' + n : '빈칸 없음'}</span>
          </header>
          <div class="om-card-b">
            ${c.raw ? `<figure class="om-quote"><figcaption>${srcLabel}</figcaption><blockquote>${esc(c.raw)}</blockquote></figure>` : ''}
            ${c.wait ? `<div class="om-aiband" role="status" aria-live="polite"><i class="om-aiband-dot" aria-hidden="true"></i><b>창구가 남은 글을 정리 중이에요 · ${c.wait.sec}초쯤 걸려요</b><span class="om-aiband-sub">${c.rows.length ? '규칙으로 읽은 줄은 아래에 먼저 · ' : ''}<span id="om-wait-sec">${Math.floor((Date.now() - c.wait.start) / 1000)}</span>초</span><button type="button" class="om-btn sm" data-cact="stopwait">그만 기다리기</button></div>` : ''}
            ${!c.wait && c.deskNote ? `<div class="om-aiband off" role="status"><b>${esc(c.deskNote)}</b></div>` : ''}
            ${tags.length ? `<div class="om-card-tags">${tags.join('')}</div>` : ''}
            ${c.rows.map((r, ri) => `
              <section class="om-rowcard" aria-labelledby="om-rc-${ri}">
                <h4 id="om-rc-${ri}"${c.rows.length > 1 ? '' : ' class="om-sr"'}>${r.kind === 'cash' ? '현금 줄' : '메모 칸 줄'}${c.rows.length > 1 ? ' ' + (ri + 1) : ''}${c.mode === 'new' && c.rows.length > 1 ? `<button type="button" class="om-x sm" data-cact="droprow" data-ri="${ri}" aria-label="이 줄 빼기">${ICON_X}</button>` : ''}</h4>
                ${whyExtra(r).length ? `<p class="om-why">${esc(whyExtra(r).join(' · '))}</p>` : ''}
                ${r.kind === 'cash' && r._fromLine ? `<div class="om-f wide om-f-plat"><div class="om-f-l"><label>판매처</label></div>${platSeg(ri, CASH_PLAT)}<p class="om-f-w">현금 손님 칸으로 바꿨어요 · 다른 판매처를 누르면 메모 줄로 돌아가요</p></div>` : ''}
                <div class="om-grid">${fieldsOf(r).filter(f => !f.more).map(f => fieldHtml(ri, r, f)).join('')}</div>
                ${r.kind === 'cash' && r.indiv ? `<p class="om-indiv${indivWarn(c) ? ' warn' : ''}" role="note">${esc(indivNote(c))}</p>` : ''}
                ${r.kind === 'cash' ? `<details class="om-more"${senderShow(r.cells[0]) || r.cells[12] ? ' open' : ''}><summary>보내는이 변경(클릭)</summary><div class="om-grid">${CASH_FIELDS.filter(f => f.more).map(f => fieldHtml(ri, r, f)).join('')}</div></details>` : ''}
                ${r.kind === 'line' && r.line ? `<p class="om-linepre"><span>메모 칸에 들어가는 글</span><code>${esc(lineView(r.line))}</code></p>` : ''}
              </section>`).join('')}
            ${c.leftover ? `<div class="om-left-over"><b>정리 못 한 글</b><p>${esc(c.leftover)}</p><p class="om-addlink">못 읽은 글이 있어요 · <button type="button" class="om-link" data-cact="add" data-k="line">줄 추가</button></p></div>` : (!c.rows.length && !c.wait ? `<div class="om-left-over"><b>정리된 줄이 없어요</b><p class="om-addlink">판매처를 골라 직접 넣어 주세요 · <button type="button" class="om-link" data-cact="add" data-k="line">줄 추가</button></p></div>` : '')}
            ${ask ? `<div class="om-ask"><b>손님께 물어볼 문자 초안</b><p id="om-ask-t">${esc(ask)}</p><div class="om-acts"><button type="button" class="om-btn sm" data-cact="copy">복사</button>${c.from && c.from.threadId ? '<button type="button" class="om-btn sm" data-cact="toreply">답 칸에 넣기</button>' : ''}<span>보내기는 직접 · 자동으로 안 나가요</span></div></div>` : ''}
          </div>
          <footer class="om-card-f">${c.confirm ? '' : footHtml()}</footer>
          <p class="om-card-note">${c.mode === 'edit' ? '저장하면 이 줄만 바뀌어요 · 서버가 다시 검사해요.' : '저장 전엔 아무것도 안 남아요 · 저장한 뒤에도 목록에서 고치거나 지울 수 있어요.'}</p>`;
        if (c.confirm) renderConfirm();
        if (!card._bound) { card._bound = true; card.addEventListener('click', onCard); card.addEventListener('input', onCardInput); card.addEventListener('focusout', onCardLeave); }
        const nb = card.querySelector('.om-card-b'); if (nb && sc) nb.scrollTop = sc;
    }
    // 입력 중엔 다시 그리지 않는다(초점·자판 유지) — 빨강 풀기 · ↺ 보이기 · 머리 숫자 · 저장 단추만
    function onCardInput(e) {
        const t = e.target, ri = t.dataset ? Number(t.dataset.ri) : NaN; if (!OM.card || isNaN(ri)) return;
        const r = OM.card.rows[ri]; if (!r) return;
        if (t.dataset.ftail) {   // #856 과수 = 숫자만 → 「15과로!」(final-order tailNorm 과 같은 꼴) · 비우면 뗌
            if (e.isComposing) return;
            const d = digits(t.value).slice(0, 2); if (d !== t.value) t.value = d;
            const fo = CASH_FIELDS.find(x => x.i === 4); setV(r, fo, withOptTail(r.cells[4], d && Number(d) > 0 ? Number(d) + '과로!' : '')); touched(ri, fo);
            return;
        }
        const f = t.dataset.fd ? fieldsOf(r).find(x => x.kind === 'shipdate') : t.dataset.fs ? CASH_FIELDS.find(x => x.kind === 'sender') : t.dataset.fi != null ? CASH_FIELDS.find(x => x.i === Number(t.dataset.fi)) : LINE_FIELDS.find(x => x.k === t.dataset.fk);
        if (!f) return;
        if (f.kind === 'tel' && !e.isComposing && !(f.k === 'key' && digits(t.value).startsWith('02'))) telLive(t);   // #862 메모 줄 번호의 02 = 숫자 그대로(위 lineTel)   // #850-c 치는 대로 하이픈 · 커서 = 그 앞 숫자 개수 기준(가운데를 고쳐도 끝으로 안 튐)
        setV(r, f, t.value); touched(ri, f);
        if (r.kind === 'cash' && f.i === 6) { const sb = $('om-card').querySelector(`.om-same[data-ri="${ri}"]`); if (sb) sb.disabled = !String(t.value).trim(); }
    }
    function onCardLeave(e) {   // #862 보내는 분 칸을 떠날 때 「드림」(치는 중엔 안 바꿈)
        const t = e.target; if (!t || !t.dataset || !t.dataset.fs || !OM.card) return;
        const ri = Number(t.dataset.ri), r = OM.card.rows[ri]; if (!r) return;
        const v = senderDrim(t.value); if (v === t.value) return;
        t.value = v; const f = CASH_FIELDS.find(x => x.kind === 'sender'); setV(r, f, v); touched(ri, f);
    }
    function touched(ri, f) {
        const c = OM.card, r = c.rows[ri], id = fid(ri, f), wrap = $('om-card').querySelector(`[data-fwrap="${id}"]`);
        if (r._new) { r._new = false; markRow(ri); }   // #850-c 새로 더한 빈 줄 = 처음 칠 때부터 그 줄 빈칸을 셈
        if (wrap) {
            const v = getV(r, f), blank = f.need && !String(v).trim();
            wrap.classList.toggle('blank', blank);
            const inp = $(id); if (inp) { if (blank) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
            const w = $(id + '-w'); if (w) w.textContent = blank ? fieldWhy(r, f) : (f.kind === 'shipdate' && r._dateBad ? '날짜를 못 읽었어요 · 예) 10/30' : '');
            const u = wrap.querySelector('.om-undo1'); if (u) u.hidden = String(v) === String(getV(origOf(ri) || r,f));
        }
        if (r.kind === 'line') indivSync();
        if (r.kind === 'cash' && f.i === 8) { clearTimeout(r._addrT); r._addrT = setTimeout(() => addrRun(c.rows.indexOf(r)), 700); }   // #850-g 주소 고치면 0.7초 뒤 다시 확인
        if (r.kind === 'line' && f.k === 'key' && (!r._lk || r._lk.key !== digits(r.key))) { r.checked = null; clearTimeout(r._lkT); r._lkT = setTimeout(() => lkRun(c.rows.indexOf(r)), 700); }   // #850-c 번호 고침 = 확인 표시 지우고 잠시 뒤 다시 찾기
        if (r.kind === 'line') { const lp = $('om-card').querySelectorAll('.om-rowcard')[ri]; const code = lp && lp.querySelector('.om-linepre code'); if (code) code.textContent = lineView(r.line); }
        c.dirty = JSON.stringify(c.rows.map(stripTmp)) !== JSON.stringify(c.orig.map(stripTmp));
        const rs = $('om-card').querySelector('.om-reset'); if (rs) rs.hidden = !c.dirty;
        const n = blankN(), pill = $('om-card-n'); if (pill) { pill.textContent = n ? '빈칸 ' + n : '빈칸 없음'; pill.classList.toggle('ok', !n); }
        const sv = $('om-card-save'); if (sv && !c.wait) sv.innerHTML = saveLabel(n);
    }
    // #850-a 입력삭제 주소 줄(indiv) 안내 — 짝인 「입력o삭제x」 메모 줄이 카드에서 빠지면(× · 할 일 칸 비움) 저장 때 서버가 현금 손님(「!」)으로 다시 정한다
    //   판정 = 서버 order-memo.js 의 INDIV 식 · isIndivLine 과 같게(「입력o삭제x」·「입력0삭제x」·「입력삭제」·「개별발송」 + 번호 8자리 이상)
    //   고치기(edit) 카드는 줄 하나만 열리므로 짝 줄이 카드에 없는 게 정상 → 주의 글 없이 「입력삭제 주문의 주소 줄이에요」만
    const INDIV_RE = /입력\s*[oO○0]\s*[·,]?\s*삭제\s*[xX×]|입력\s*삭제|개별\s*발송/i;
    const hasIndivLine = c => c.rows.some(x => x.kind === 'line' && INDIV_RE.test(String(x.note || '') + ' ' + String(x.line || '')) && digits(x.key).length >= 8);
    const indivWarn = c => c.mode !== 'edit' && !hasIndivLine(c);
    const indivNote = c => c.mode === 'edit' ? '입력삭제 주문의 주소 줄이에요' : hasIndivLine(c) ? '입력삭제 줄을 지우면 이 주소는 현금 손님이 돼요' : '입력삭제 줄이 빠졌어요 — 저장하면 이 주소는 현금 손님(「!」)으로 들어가요';
    function indivSync() { const c = OM.card; if (!c) return; const w = indivWarn(c); $('om-card').querySelectorAll('.om-indiv').forEach(p => { p.textContent = indivNote(c); p.classList.toggle('warn', w); }); }
    // ── #850-f 판매처 「현금」 = 그 메모 줄을 현금 손님 칸(받는 분·연락처·주소·품목·수량·보내는이)으로 · 적힌 번호 = 받는 분 연락처 · 다른 판매처 = 메모 줄로 되돌림(적어 둔 메모 줄 그대로)
    const CASH_PLAT = '현금';
    const origOf = ri => { const c = OM.card, o = c && c.orig[ri], r = c && c.rows[ri]; return o && r && o.kind === r.kind ? o : null; };   // 종류가 바뀐 줄은 「처음 값」 없음
    const platSeg = (ri, v) => `<div class="om-seg" role="radiogroup" aria-label="판매처">${PLATS.concat([CASH_PLAT]).map(p => `<button type="button" role="radio" class="om-seg-b" data-cact="plat" data-ri="${ri}" data-v="${esc(p)}" aria-checked="${v === p ? 'true' : 'false'}">${p}</button>`).join('')}</div>`;
    function toCashOrBack(ri, v) {
        const c = OM.card, r = c && c.rows[ri]; if (!r || c.mode === 'edit') return;   // 저장된 줄 고치기 = 종류 못 바꿈(PUT 은 같은 줄만)
        if (r.kind === 'line' && v === CASH_PLAT) {
            const n = blankRow('cash'); n.ship_date = r.ship_date || null; n.src = 'edit'; n._fromLine = clone(stripTmp(r));
            if (isPhoneish(r.key)) n.cells[6] = telShow(r.key);
            if (String(r.note || '').trim()) n.cells[9] = String(r.note).trim();   // 할 일 글 = 배송메세지 칸으로(되돌리면 메모 줄 그대로)
            c.rows[ri] = n;
        } else if (r.kind === 'cash' && v !== CASH_PLAT && r._fromLine) {
            const back = clone(r._fromLine); back.plat = v; back.ship_date = r.ship_date || back.ship_date || null; back.line = [back.ship_date ? md(back.ship_date) : '', back.key, back.note, back.plat].join('\t');
            c.rows[ri] = back;
        } else return;
        c.dirty = true; renderCard(); if (c.rows[ri].kind === 'line') lkRun(ri);
        const fx = $('om-card').querySelectorAll('.om-rowcard')[ri]; const t2 = fx && (fx.querySelector('.om-f.blank input, .om-f.blank textarea, .om-f.blank .om-combo') || fx.querySelector('.om-seg-b[aria-checked="true"]')); if (t2) t2.focus({ preventScroll: true });
    }
    const stripTmp = r => { const o = Object.assign({}, r); delete o._dateBad; delete o._new; delete o._lk; delete o._lkSeq; delete o._lkT; delete o.checked; delete o._fromLine; delete o._addr; delete o._addrSeq; delete o._addrT; return o; };   // checked = 찾기가 저절로 채움(고친 것으로 안 셈)
    // ── #850-c 판매처 확인 — 번호(또는 주문번호)로 발송 전 주문 찾기(계약 §7 · 7일) · 찾은 판매처 하나면 미리 고름 · 판매처 누르면 그 곳 결과로
    //   r._lk = { state: busy|done|err, key(숫자), matches } · r.checked = 고른 판매처에서 찾았을 때만 { plat, as, at }(§8 · 최종발주 「취소됐을 수 있어요」 근거)
    const canLook = k => { const s = String(k || '').trim(), d = digits(s); return /^\d{8}-\d{7}$/.test(s) || /^0\d{8,11}$/.test(d) || (!/^0/.test(d) && /^\d{10,20}$/.test(d)); };
    const lkIn = r => { const m = (r._lk && r._lk.matches) || []; return r.plat ? m.filter(x => x.plat === r.plat) : m; };
    const lkPlats = r => [...new Set(((r._lk && r._lk.matches) || []).map(x => x.plat))];
    function lkKind(r) {
        const L = r._lk; if (!L) return '';
        if (L.state === 'busy') return 'busy'; if (L.state === 'err') return 'warn';
        if (!L.matches.length) return 'warn';
        if (!r.plat) return 'warn';
        const m = lkIn(r); if (!m.length) return 'warn';
        if (indivRecv(r)) return 'warn';   // #867 입력삭제 줄 = 받는 분 번호면 막음
        return m[0].as === 'recv' ? 'ask' : 'ok';
    }
    function lkText(r) {
        const L = r._lk; if (!L) return '';
        if (L.state === 'busy') return '주문 찾는 중…';
        if (L.state === 'err') return '주문을 찾지 못했어요(연결 오류) · 판매처를 골라 주세요';
        if (!L.matches.length) return '못 찾았어요 — 7일 지난 주문·예약 주문은 여기서 안 보여요 · 판매처를 골라 주세요';
        const ps = lkPlats(r);
        if (!r.plat) return `${ps.join('·')} 여러 곳에 주문이 있어요 · 판매처를 골라 주세요`;
        const m = lkIn(r);
        if (!m.length) return `${r.plat}엔 이 번호 주문이 없어요 · ${ps.join('·')}에 있어요`;
        const x = m[0], who = x.recv_name || (x.recv_initial ? x.recv_initial + '○' : ''), pd = md(x.paid_at);
        const body = [who ? '받는 분 ' + who : '', optBrief(x.option) + (x.qty ? ` ${x.qty}박스` : ''), pd ? pd + ' 결제' : ''].filter(s => s.trim()).join(' · ') + (m.length > 1 ? ` 외 ${m.length - 1}건` : '');
        if (indivRecv(r)) return `입력삭제는 구매자 번호로 넣어야 송장이 붙어요 · 구매자 번호로 바꿔 주세요${indivBuyer(r) ? '' : ' · 구매자 번호를 번호 칸에 직접 넣어 주세요'} · 지금 번호 = 받는 분 번호 · ${x.plat} · ${body}`;   // #867
        if (x.as === 'recv') return `수취인 번호로 넣으셨네요 · ${x.plat} · ${body}${x.addr ? ' · 주소 ' + x.addr : ''} · 맞나요?`;   // 이름·주소 = 새 표(#850-e)에 있을 때만 · 없으면 성 한 글자
        return `${x.plat}${x.as === 'order' ? ' 주문번호' : ''} · ${body} · 맞아요`;
    }
    // #867 입력삭제 줄(INDIV_RE)인데 고른 판매처에서 받는 분 번호로만 찾힘 = 저장 막음 · [구매자 번호로 바꾸기](그 주문 구매자 번호 하나일 때만 · 서버 lookup buyer_phone)
    const isIndivRow = r => !!r && r.kind === 'line' && INDIV_RE.test(String(r.note || '') + ' ' + String(r.line || ''));
    function indivRecv(r) {
        if (!isIndivRow(r) || !r.plat || !r._lk || r._lk.state !== 'done' || r._lk.key !== digits(r.key)) return false;
        const m = lkIn(r); return m.length > 0 && m.every(x => x.as === 'recv');
    }
    const indivBuyer = r => { const b = [...new Set(lkIn(r).map(x => digits(x.buyer_phone)).filter(d => d.length >= 9))]; return b.length === 1 ? b[0] : ''; };   // 주문마다 구매자가 다르면 단추 없음(직접 넣기)
    const lkHtml = (r, ri) => esc(lkText(r)) + (indivRecv(r) && indivBuyer(r) ? `<button type="button" class="om-btn sm om-lk-fix" data-cact="tobuyer" data-ri="${ri}">구매자 번호로 바꾸기 <small>${esc(telShow(indivBuyer(r)))}</small></button>` : '');
    const indivBadAt = () => OM.card ? OM.card.rows.findIndex(r => !r._new && indivRecv(r)) : -1;
    // #867 손질 ① 입력삭제 줄 찾기가 도는 중이거나 지금 번호 ≠ 찾은 번호(0.7초 틈) = 잠깐 막음 · 찾기 결과가 없는 줄(_lk 없음)·연결 오류·판매처 미선택은 안 막음
    const indivPendAt = () => OM.card ? OM.card.rows.findIndex(r => !r._new && isIndivRow(r) && !!r._lk && (r._lk.state === 'busy' || r._lk.key !== digits(r.key))) : -1;
    const optBrief = s => shortOpt(String(s || '').replace(/^[^:]*선택\s*:\s*/, '').replace(/^\d+\.\s*/, ''));
    function lkCheck(r) { const m = r.plat && r._lk && r._lk.state === 'done' ? lkIn(r) : []; r.checked = m.length ? { plat: r.plat, as: m[0].as, at: new Date().toISOString() } : null; }
    function lkPaint(ri) {   // 판매처 단추·결과 글·빈칸 숫자만 다시 칠함(다시 그리지 않음 — 초점·자판 유지)
        const c = OM.card, r = c && c.rows[ri]; if (!r) return;
        const card = $('om-card'), p = card && card.querySelector('#om-lk-' + ri); if (!p) return;
        p.innerHTML = lkHtml(r, ri); p.dataset.k = lkKind(r);
        const seg = p.parentNode.querySelector('.om-seg'); if (seg) seg.querySelectorAll('.om-seg-b').forEach(x => x.setAttribute('aria-checked', x.dataset.v === r.plat ? 'true' : 'false'));
        touched(ri, LINE_FIELDS.find(x => x.k === 'plat'));
    }
    async function lkRun(ri) {
        const c = OM.card, r = c && c.rows[ri]; if (!r || r.kind !== 'line') return;
        if (!canLook(r.key)) { if (r._lk) { r._lk = null; r.checked = null; lkPaint(ri); } return; }
        const key = digits(r.key), seq = (r._lkSeq = (r._lkSeq || 0) + 1);
        r._lk = { state: 'busy', key, matches: [] }; lkPaint(ri);
        const res = await API.lookup(String(r.key).trim());   // 셋 다 한 번에 · 판매처를 바꿔 누르면 받아 둔 결과로 거름(호출 0)
        if (OM.card !== c || r._lkSeq !== seq) return;
        const i = c.rows.indexOf(r); if (i < 0) return;
        r._lk = res.ok && res.body ? { state: 'done', key, matches: Array.isArray(res.body.matches) ? res.body.matches : [] } : { state: 'err', key, matches: [] };
        const ps = lkPlats(r);
        if (!r.plat && ps.length === 1) {   // 한 곳에서만 찾음 = 미리 고름(처음 정리한 값도 같이 — 고친 것으로 안 셈 · 사람이 이미 골랐으면 그대로)
            const f = LINE_FIELDS.find(x => x.k === 'plat'), o = c.orig[i];
            setV(r, f, ps[0]); if (o && o.kind === 'line' && !o.plat && digits(o.key) === key) setV(o, f, ps[0]);
        }
        lkCheck(r); lkPaint(i);
    }
    const lkAll = () => { const c = OM.card; if (c) c.rows.forEach((r, i) => { if (r.kind === 'line' && !r._new) lkRun(i); else if (r.kind === 'cash' && String(r.cells[8] || '').trim()) addrRun(i); }); };
    // ── #850-g 현금 줄 주소 확인 = 최종발주 #528 꼴(GET /api/agent-office/juso · 주소 정리기 splitAddr·searchBody·exactMatches) · 1건 = 확인됨 · 여러 건 = 고르기 · 못 찾음 = 확인 필요(빈칸으로 셈 · 「이대로 둘게요」)
    //   상세(동·호수)는 적은 그대로 붙임 · 칸 값은 사람이 [도로명으로 바꾸기]·후보를 눌러야만 바뀜(치는 중에 덮지 않음) · 과호출 = 서버 캐시·상한 그대로
    const addrText = (j, detail) => String(j.roadAddrPart1 || '').trim() + (detail ? ' ' + detail : '');
    const addrBad = r => r.kind === 'cash' && !!r._addr && (r._addr.state === 'none' || r._addr.state === 'fail' || r._addr.state === 'multi') && !r._addr.kept && String(r.cells[8] || '').trim() === r._addr.raw;
    function addrKind(r) { const A = r._addr; if (!A) return ''; if (A.state === 'busy') return 'busy'; if (A.state === 'one') return 'ok'; return A.kept ? '' : 'warn'; }
    function addrHtml(r, ri) {
        const A = r._addr; if (!A) return '';
        if (A.state === 'busy') return '주소 확인 중…';
        if (A.state === 'one') return `확인됨 · 도로명 ${esc(A.road)}${A.road !== String(r.cells[8] || '').trim() ? ` <button type="button" class="om-link" data-cact="addrset" data-ri="${ri}" data-v="one">도로명으로 바꾸기</button>` : ''}`;
        if (A.state === 'multi') return `주소 후보가 여러 개예요 · 골라 주세요<span class="om-addr-c">${A.cands.map((x, i) => `<button type="button" class="om-btn sm" data-cact="addrset" data-ri="${ri}" data-v="${i}">${esc(x.road)}${x.bd ? ` <small>${esc(x.bd)}</small>` : ''}</button>`).join('')}<button type="button" class="om-link" data-cact="addrkeep" data-ri="${ri}">적은 그대로</button></span>`;
        return A.kept ? '적은 주소 그대로 둬요' : `${A.state === 'fail' ? '주소 검색이 안 돼요' + (A.err ? '(' + esc(A.err) + ')' : '') + ' · ' : ''}주소를 확인해 주세요 <button type="button" class="om-link" data-cact="addrkeep" data-ri="${ri}">이대로 둘게요</button>`;
    }
    function addrPaint(ri) {
        const c = OM.card, r = c && c.rows[ri]; if (!r) return;
        const p = $('om-card').querySelector('#om-addr-' + ri); if (p) { p.innerHTML = addrHtml(r, ri); p.dataset.k = addrKind(r); }
        const w = $('om-card').querySelector(`[data-fwrap="om-f-${ri}-c8"]`); if (w && String(r.cells[8] || '').trim()) w.classList.toggle('blank', addrBad(r));
        const n = blankN(), pill = $('om-card-n'); if (pill) { pill.textContent = n ? '빈칸 ' + n : '빈칸 없음'; pill.classList.toggle('ok', !n); }
    }
    async function addrRun(ri) {
        const c = OM.card, r = c && c.rows[ri]; if (!r || r.kind !== 'cash') return;
        const raw = String(r.cells[8] || '').trim(), oo = window.__ooTest; if (!raw) { r._addr = null; addrPaint(ri); return; }
        const seq = (r._addrSeq = (r._addrSeq || 0) + 1);
        r._addr = { state: 'busy', raw }; addrPaint(ri);
        const A = { raw, state: 'none' };
        try {
            if (!oo || typeof oo.splitAddr !== 'function') throw new Error('주소 검색 도구를 불러오지 못했어요');
            const [body, detail] = oo.splitAddr(raw); A.detail = detail || '';
            const tries = [body]; const sb = oo.searchBody(body); if (sb && sb !== body) tries.push(sb);
            let list = null, fallback = false, err = '';
            for (let k = 0; k < tries.length && !list; k++) {
                const res = await safe(call('/api/agent-office/juso?keyword=' + encodeURIComponent(tries[k]))); const d = res.ok ? res.body : null;
                if (!res.ok) { err = errText(res, '주소 검색 실패'); continue; }
                if (d && d.error) { err = d.error === 'NOKEY' ? '주소 검색 승인키가 서버에 없어요' : String(d.error); continue; }
                const cm = d && d.results && d.results.common; if (!cm) continue;
                if (cm.errorCode !== '0') { err = cm.errorMessage || cm.errorCode; continue; }
                const ls = d.results.juso || []; if (ls.length) { list = ls; fallback = k > 0; }
            }
            if (!list) { A.state = err ? 'fail' : 'none'; A.err = err; }
            else {
                const uniq = [...new Set(list.map(j => j.roadAddrPart1 + '|' + j.zipNo))];
                const ex = !fallback && uniq.length > 1 ? oo.exactMatches(tries[0], list, A.detail) : [];
                const one = !fallback && (list.length === 1 || uniq.length === 1) ? list[0] : ex.length === 1 ? ex[0] : null;
                if (one) { A.state = 'one'; A.road = addrText(one, A.detail); }
                else { A.state = 'multi'; A.cands = list.slice(0, 7).map(j => ({ road: addrText(j, A.detail), bd: String(j.bdNm || '') })); }
            }
        } catch (e) { A.state = 'fail'; A.err = (e && e.message) || String(e); }
        if (OM.card !== c || r._addrSeq !== seq) return;
        const i = c.rows.indexOf(r); if (i < 0) return;
        r._addr = A; addrPaint(i);
    }
    function markRow(ri) {   // 한 줄의 빨간 칸·이유를 다시 칠함(다시 그리지 않음 — 초점·자판 유지)
        const c = OM.card, r = c && c.rows[ri]; if (!r) return;
        fieldsOf(r).concat(r.kind === 'cash' ? CASH_FIELDS.filter(x => x.more) : []).forEach(f => {
            const id = fid(ri, f), wrap = $('om-card').querySelector(`[data-fwrap="${id}"]`); if (!wrap) return;
            const blank = !r._new && f.need && !String(getV(r, f)).trim();
            wrap.classList.toggle('blank', blank);
            const inp = $(id); if (inp) { if (blank) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
            const w = $(id + '-w'); if (w && f.kind !== 'shipdate') w.textContent = blank ? fieldWhy(r, f) : '';
        });
    }
    async function onCard(e) {
        const b = e.target.closest('[data-cact]'); if (!b || !OM.card) return;
        const a = b.dataset.cact, c = OM.card, ri = Number(b.dataset.ri), r = c.rows[ri];
        if (a === 'cancel') { cardClose(); return; }
        if (a === 'keep') { c.confirm = false; renderConfirm(); return; }
        if (a === 'stopwait') { waitEnd(c, { state: 'fail', leftover: '', message: '기다리지 않기로 했어요 — 남은 글은 직접 채워 주세요(위 원문 참고)' }); return; }
        if (a === 'discard') { cardClose(true); return; }
        if (a === 'reset') { c.rows = clone(c.orig); c.dirty = false; renderCard(); lkAll(); toast('처음 정리한 값으로 돌렸어요'); return; }
        if (a === 'same') {   // #862 받는 분 연락처 → 구매자 연락처(이미 있으면 바꿔 넣음 · 처음 값은 칸 ↺)
            const v = String((r && r.cells[6]) || '').trim(), f = CASH_FIELDS.find(x => x.i === 10); if (!v || !f) return;
            setV(r, f, v); const el = $(fid(ri, f)); if (el) el.value = getV(r, f); touched(ri, f); return;
        }
        if (a === 'undo1') {
            const f = fieldsOf(r).concat(CASH_FIELDS.filter(x => x.more)).find(x => fid(ri, x) === b.dataset.f); if (!f || !origOf(ri)) return;
            setV(r, f, getV(c.orig[ri], f)); if (f.kind === 'shipdate') { r.ship_date = c.orig[ri].ship_date; r._dateBad = false; }
            const el = $(fid(ri, f));
            if (f.kind === 'option') { renderCard(); }
            else if (f.kind === 'platform') renderCard();
            else if (el) { el.value = getV(r, f); touched(ri, f); }
            const back = $(fid(ri, f)); if (back) back.focus({ preventScroll: true });
            return;
        }
        if (a === 'step') { const n = Math.max(1, (parseInt(r.cells[5], 10) || 0) + Number(b.dataset.d)); const f = CASH_FIELDS.find(x => x.i === 5); setV(r, f, String(n)); const el = $(fid(ri, f)); if (el) el.value = String(n); touched(ri, f); return; }
        if (a === 'plat' && (b.dataset.v === CASH_PLAT || r.kind === 'cash')) { toCashOrBack(ri, b.dataset.v); return; }   // #850-f 「현금」 = 현금 손님 칸으로 · 현금 줄에서 다른 판매처 = 메모 줄로 되돌림
        if (a === 'plat') { const f = LINE_FIELDS.find(x => x.k === 'plat'); setV(r, f, b.dataset.v); if (canLook(r.key) && (!r._lk || r._lk.key !== digits(r.key))) { lkRun(ri); return; } lkCheck(r); lkPaint(ri); return; }   // #850-c 받아 둔 결과로 거름(호출 0) · 번호가 바뀌었으면 다시 찾기
        if (a === 'opt') { optOpen(ri, b); return; }
        if (a === 'tail' && r && r.kind === 'cash') {   // #856 사이즈 고르기(누른 것 다시 누르면 그대로 · 「없음」 = 꼬리 뗌)
            const f = CASH_FIELDS.find(x => x.i === 4); setV(r, f, withOptTail(r.cells[4], b.dataset.v || '')); touched(ri, f);
            b.parentNode.querySelectorAll('.om-seg-b').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
            return;
        }
        if (a === 'add') {   // #850-c 새 빈 줄 = 손대기 전엔 빨간 글·빈칸 셈 없음 · 그 줄 번호 칸에 초점
            const nr = blankRow(b.dataset.k); nr._new = true; c.rows.push(nr); c.orig.push(clone(nr)); renderCard();
            const ri2 = c.rows.length - 1, f = $(nr.kind === 'cash' ? `om-f-${ri2}-c6` : `om-f-${ri2}-key`);
            if (f) { f.scrollIntoView({ block: 'center' }); f.focus({ preventScroll: true }); }
            return;
        }
        if (a === 'droprow') { c.rows.splice(ri, 1); c.orig.splice(ri, 1); c.dirty = true; renderCard(); return; }
        if (a === 'copy') { const t = ($('om-ask-t') || {}).textContent || ''; try { await navigator.clipboard.writeText(t); toast('복사했어요'); } catch (er) { toast('복사하지 못했어요 · 글을 길게 눌러 복사해 주세요'); } return; }
        if (a === 'toreply') { const t = ($('om-ask-t') || {}).textContent || ''; const ok = window.AkmAoDesk && typeof window.AkmAoDesk.smsPutReply === 'function' && window.AkmAoDesk.smsPutReply(c.from.threadId, t); toast(ok ? '답 칸에 넣었어요 · 보내기는 직접' : '문자 답 칸을 못 찾았어요 · [복사]로 넣어 주세요'); return; }
        if (a === 'tobuyer') {   // #867 번호 칸 = 그 주문 구매자 번호(누를 때만 · 치는 중엔 안 바꿈) + 같은 카드 현금 주소 줄 K·B 가 옛 번호면 같이 → 다시 찾기
            const nb = r && indivRecv(r) ? indivBuyer(r) : ''; if (!nb) return;
            const old = digits(r.key), kf = LINE_FIELDS.find(x => x.k === 'key'), nv = telShow(nb);
            setV(r, kf, nv); r.checked = null; r._lk = null;
            let moved = 0;
            if (c.mode !== 'edit') c.rows.forEach(x => { if (x.kind !== 'cash' || !x.indiv) return; [10, 1].forEach(i => { if (digits(x.cells[i]) === old) { x.cells[i] = nv; moved++; } }); });
            renderCard(); touched(ri, kf); clearTimeout(r._lkT); lkRun(ri);
            const k = $('om-f-' + ri + '-key'); if (k) k.focus({ preventScroll: true });
            toast('구매자 번호로 바꿨어요' + (moved ? ' · 현금 주소 줄 번호도 같이' : c.mode === 'edit' ? ' · 저장하면 짝 주소 줄 번호도 같이 바뀌어요' : '') + ' · 다시 찾는 중'); return;
        }
        if (a === 'save') return cardSave(b);
        if (a === 'addrset' || a === 'addrkeep') {   // #850-g 도로명 고르기 · 적은 그대로
            const A = r && r._addr; if (!A) return; const f = CASH_FIELDS.find(x => x.i === 8);
            if (a === 'addrkeep') { A.kept = true; addrPaint(ri); return; }
            const road = b.dataset.v === 'one' ? A.road : (A.cands[Number(b.dataset.v)] || {}).road; if (!road) return;
            setV(r, f, road); const el = $(fid(ri, f)); if (el) el.value = road;
            clearTimeout(r._addrT); r._addr = { state: 'one', raw: road, road, detail: A.detail }; touched(ri, f); clearTimeout(r._addrT); addrPaint(ri); return;
        }
        if (a === 'dupswap' || a === 'dupkeep') {   // #850-f 바꾸기 = 옛 줄 지우고 새 것 · 취소 = 카드 그대로(고치거나 그 줄 빼고 다시 저장)
            const q = c.dupAsk; if (!q) return; c.dupAsk = null;
            if (a === 'dupkeep') { renderConfirm(); return; }
            c.dupOk = { rows: q.rows, same: q.same, drop: [...new Set(q.diff.flatMap(x => x.olds.map(o => o.id)).filter(id => id != null))] };
            renderConfirm(); const sv = $('om-card-save'); if (sv) return cardSave(sv);
            return;
        }
    }
    // ── #850-f 같은 번호(숫자)에 같은 종류(사이즈·날짜·보내는이·입력삭제) 열린 줄이 이미 있으면 — 같으면 안 넣음 · 다르면 바꿀지 묻기(화면 판정 · 서버 무변경)
    const DUP_KINDS = [['size', '사이즈', n => /사이즈|(?:^|[\s,·])\d?\s*[SMLsml](?=$|[\s,·])/.test(n)], ['date', '날짜', (n, r) => !!r.ship_date || /\d+\s*일\s*(?:발송|출고|보내)/.test(n)], ['sender', '보내는이', n => /보내는\s*(?:이|분|사람)|드림/.test(n)], ['indiv', '입력삭제', n => INDIV_RE.test(n)]];
    const dupKinds = r => r.kind !== 'line' ? [] : DUP_KINDS.filter(k => k[2](String(r.note || ''), r));
    const dupSame = (a, b) => String(a.note || '').replace(/\s+/g, '').toLowerCase() === String(b.note || '').replace(/\s+/g, '').toLowerCase() && (a.ship_date || '') === (b.ship_date || '');
    async function dupCheck(rows) {
        const res = await API.list('open'); if (!res.ok) return null;   // 못 읽으면 확인 없이 종전대로 저장
        const open = []; (Array.isArray(res.body && res.body.entries) ? res.body.entries : []).forEach(e => (Array.isArray(e.rows) ? e.rows : []).forEach(x => { const o = normRow(x, e); if (o && o.kind === 'line' && o.state === 'open') open.push(o); }));
        const same = new Set(), diff = [];
        rows.forEach((r, i) => {
            const d = digits(r.key), ks = dupKinds(r); if (!ks.length || d.length < 8) return;
            const hit = open.filter(o => digits(o.key) === d && dupKinds(o).some(k => ks.some(k2 => k2[0] === k[0])));
            if (!hit.length) return;
            if (hit.some(o => dupSame(o, r))) { same.add(i); return; }
            diff.push({ i, olds: hit, kind: ks.filter(k => hit.some(o => dupKinds(o).some(k2 => k2[0] === k[0])))[0][1] });
        });
        return { same, diff };
    }
    async function cardSave(btn) {
        const c = OM.card; if (!c || btn.disabled || c.wait) return;
        let rows = c.rows.filter(r => !r._new);   // #850-c 더하고 손대지 않은 빈 줄은 그냥 버림
        if (!rows.length) { cardClose(true); return; }
        if (indivPendAt() >= 0) { toast('번호 확인 중이에요 · 잠시 뒤 다시 눌러 주세요'); return; }   // #867 손질 ①
        const bad = indivBadAt();   // #867 입력삭제 줄이 받는 분 번호 = 저장 안 함(저장 안 되면 [메모함 적용하기]에도 안 들어감)
        if (bad >= 0) {
            toast('입력삭제는 구매자 번호로 넣어야 송장이 붙어요 · 구매자 번호로 바꾼 뒤 저장해 주세요');
            const rc = $('om-card').querySelectorAll('.om-rowcard')[bad], t = rc && (rc.querySelector('.om-lk-fix') || rc.querySelector('#om-f-' + bad + '-key'));
            if (t) { t.scrollIntoView({ block: 'center' }); t.focus({ preventScroll: true }); }
            return;
        }
        btn.disabled = true; const keep = btn.innerHTML; btn.textContent = '저장하는 중…';
        let drop = [], skipped = 0;
        if (c.mode !== 'edit') {
            if (!c.dupOk) {
                const d = await dupCheck(rows);
                if (OM.card !== c) return;
                if (d && d.diff.length) { c.dupAsk = { diff: d.diff, same: [...d.same], rows }; btn.disabled = false; btn.innerHTML = keep; renderDup(); return; }
                if (d && d.same.size) { skipped = d.same.size; rows = rows.filter((r, i) => !d.same.has(i)); }
            } else { skipped = c.dupOk.same.length; rows = c.dupOk.rows.filter((r, i) => !c.dupOk.same.includes(i)); drop = c.dupOk.drop; }
            if (!rows.length) { cardClose(true); inNote(`이미 같은 줄이 있어요 · 저장하지 않았어요`, 'warn'); return; }
        }
        let res;
        if (c.mode === 'edit') res = await API.update(rows[0].id, putBody(rows[0]));
        else res = await API.save({ raw: c.raw, tags: c.tags || [], source: c.source || 'manual', rows: rows.map(outRow) });
        if (!res.ok) { btn.disabled = false; btn.innerHTML = keep; c.dupOk = null; toast(res.status === 409 ? errText(res, '비운 줄이에요 — 되살린 뒤 고쳐 주세요') : errText(res, '저장하지 못했어요 · 다시 눌러 주세요')); return; }
        for (const id of drop) await API.remove(id);   // [바꾸기] = 새 줄 저장이 된 뒤 옛 줄을 「비운 것」으로(되살리기 가능)
        if (skipped || drop.length) toast([skipped ? `같은 줄 ${skipped}개는 이미 있어 뺐어요` : '', drop.length ? `옛 줄 ${drop.length}개를 새 것으로 바꿨어요` : ''].filter(Boolean).join(' · '));
        c.rows.forEach(r => { if (r.kind === 'cash' && r.cells[4]) recentPut(optBase(r.cells[4])); });   // #856 최근 목록 = 꼬리 뗀 품목 이름
        const saved = (res.body && (Array.isArray(res.body.rows) ? res.body.rows : res.body.row ? [res.body.row] : [])).map(r => normRow(r));
        const n = saved.length || c.rows.length, nCheck = saved.length ? saved.filter(r => !r.sure).length : blankN();
        if (c.mode !== 'edit' && !c.cash && (!c.from || c.from.filled)) { const raw = $('om-raw'); OM.telLn = null; raw.value = ''; OM.raw = ''; OM.tags.clear(); OM.smsSrc = null; syncTags(); inState(); }
        cardClose(true);
        inNote(c.mode === 'edit' ? '고쳤어요' + (nCheck ? ' · 아직 「확인」으로 남았어요' : '') : (nCheck ? `${n}줄 저장했어요 · ${nCheck}줄은 「확인」으로 남았어요` : `${n}줄 저장했어요 · 다음 최종발주에 들어가요`), nCheck ? 'warn' : 'ok');
        OM.tab = 'open'; syncTabs(); load();
    }

    // ── 옵션정보 고르기(찾기 · 최근 고른 것 위) ─────────────
    function optOpen(ri, btn) {
        OM.opt = { ri, btn, at: -1 };
        const pop = $('om-optpop'), q = $('om-opt-q'); q.value = '';
        optRender(); pop.hidden = false; OM.el.classList.add('opt-open');
        if (!phoneW()) { const r = btn.getBoundingClientRect(), w = Math.max(r.width, 320); pop.style.left = Math.min(r.left, window.innerWidth - w - 12) + 'px'; pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 340) + 'px'; pop.style.width = w + 'px'; }
        else { pop.style.left = ''; pop.style.top = ''; pop.style.width = ''; }
        hbPush('omopt', () => optClose(false, true));
        q.focus({ preventScroll: true });
    }
    function optClose(hist, fromHist) {
        if (!OM.opt) return;
        const btn = OM.opt.btn; OM.opt = null; $('om-optpop').hidden = true; OM.el.classList.remove('opt-open');
        if (hist !== false && !fromHist) hbDrop('omopt'); else if (hist === false && !fromHist) hbDrop('omopt');
        if (btn && btn.isConnected) btn.focus({ preventScroll: true });
    }
    function optRender() {
        if (!OM.opt) return;
        const ul = $('om-opt-list'), qs = $('om-opt-q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);   // 띄어 쓴 낱말이 전부 든 품목(「타이벡 10」 = 타이벡 … 10kg)
        const cur = OM.card && OM.card.rows[OM.opt.ri] ? OM.card.rows[OM.opt.ri].cells[4] : '';
        if (!OM.catalog) { ul.innerHTML = '<li class="om-opt-empty">품목 목록을 불러오는 중…</li>'; return; }
        const hit = s => { const t = String(s).replace(/\s+/g, '').toLowerCase(); return qs.every(w => t.includes(w)); };
        const rec = recentGet().filter(x => OM.catalog.includes(x) && hit(x));
        const rest = OM.catalog.filter(x => hit(x) && !rec.includes(x));
        const li = (v, i) => `<li role="option" id="om-opt-${i}" data-v="${esc(v)}" aria-selected="${v === cur ? 'true' : 'false'}"><span>${esc(shortOpt(v))}</span>${v === cur ? '<b aria-hidden="true">✓</b>' : ''}</li>`;
        let i = 0, html = '';
        if (rec.length) html += `<li class="om-opt-g" role="presentation">최근 고른 것</li>` + rec.map(v => li(v, i++)).join('');
        if (rest.length) html += (rec.length ? `<li class="om-opt-g" role="presentation">전체</li>` : '') + rest.map(v => li(v, i++)).join('');
        ul.innerHTML = html || `<li class="om-opt-empty">「${esc($('om-opt-q').value)}」가 든 품목이 없어요 · 그날 단가표 이름만 고를 수 있어요</li>`;
        OM.opt.at = -1;
    }
    function optKey(e) {
        const items = [...$('om-opt-list').querySelectorAll('[data-v]')]; if (!OM.opt) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; OM.opt.at = (OM.opt.at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((x, j) => x.classList.toggle('act', j === OM.opt.at)); items[OM.opt.at].scrollIntoView({ block: 'nearest' }); $('om-opt-q').setAttribute('aria-activedescendant', items[OM.opt.at].id); }
        else if (e.key === 'Enter') { e.preventDefault(); const it = items[OM.opt.at] || (items.length === 1 ? items[0] : null); if (it) optPick(it.dataset.v); }
    }
    function optPick(v) {
        if (!OM.opt || !OM.card) return;
        const ri = OM.opt.ri, r = OM.card.rows[ri], f = CASH_FIELDS.find(x => x.i === 4);
        const t0 = optTail(r.cells[4]);   // #856 고른 꼬리는 새 품목에도 맞으면 그대로(안 맞으면 뗌)
        setV(r, f, tailFits(v, t0) ? withOptTail(v, t0) : v); optClose(true);
        touched(ri, f); renderCard();   // 사이즈·과수 칸이 품목 따라 보이고 숨음
        const nx = $(fid(ri, CASH_FIELDS.find(x => x.i === 5))); if (nx) nx.focus({ preventScroll: true });
    }

    // ── 열기·닫기 ─────────────────────────────────────
    function open(opts) {
        mount();
        const el = OM.el;
        if (el.hidden) {
            let fo = false; try { fo = !!(history.state && history.state.foPanel); } catch (e) { fo = false; }
            OWN.on = fo; OWN.stack = []; OWN.skip = 0;
            OM.tpLast = null; el.hidden = false; document.body.classList.add('om-open'); el.classList.toggle('over-fo', fo); hbPush('om', () => close(false));
        }
        OM.tab = 'open'; syncTabs(); inState(); load();
        requestAnimationFrame(xLayout);   // #850-f 창이 보인 뒤 줄 × 자리
        if (!(opts && opts.noFocus)) setTimeout(() => { const t = phoneW() ? $('om-close') : $('om-raw'); if (t) t.focus({ preventScroll: true }); }, 60);
    }
    function close(hist) {
        if (!OM.el || OM.el.hidden) return;
        if (OM.card && OM.card.dirty && hist !== false) { cardClose(); return; }   // 고친 카드가 있으면 먼저 묻는다
        if (OM.opt) optClose(false, hist === false);
        if (OM.card) cardClose(true, hist === false);
        if (OM.prevOpen) prevShow(false, hist !== false);
        tpClose(false); OM.sel.clear(); delDisarm(); undoHide();   // #859 닫으면 고른 것도 풂
        OM.el.hidden = true; document.body.classList.remove('om-open');
        if (hist !== false) hbDrop('om');
        OWN.on = false; OWN.stack = [];
    }
    // #850-g 문자 대화 [발주 메모로] = 이 대화로 마지막 발주 메모를 저장한 뒤의 손님 글 전부(우리 답 사이 것도 · 없으면 최근 24시간 · 사진 글 빼고 · 최대 10개 · 시간순)
    //   → 입력 칸에 채워 사람이 보고 지우거나 고친 뒤 [입력하기](말풍선 꾹 누르기 = 그 글만 바로 정리는 fromText 그대로)
    async function fillFromSms(msgs, o) {
        o = o || {};
        open({ noFocus: true });
        let since = 0;
        for (const st of ['open', 'cleared']) {
            const res = await API.list(st); if (!res.ok) continue;
            (Array.isArray(res.body && res.body.entries) ? res.body.entries : []).forEach(e => { if (String(e.source || '') === 'sms:' + o.threadId) { const t2 = Date.parse(e.created_at); if (t2 > since) since = t2; } });
        }
        const from = since || Date.now() - 24 * 3600e3;
        const pick = (Array.isArray(msgs) ? msgs : []).filter(m => m && m.direction !== 'out' && String(m.body || '').trim() && Date.parse(m.event_at) > from)
            .sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at)).slice(-10);
        if (!pick.length) { inNote(since ? '마지막 발주 메모 뒤로 손님이 보낸 글이 없어요' : '최근 24시간 손님이 보낸 글이 없어요', 'warn'); return 0; }
        const raw = $('om-raw'); OM.telLn = null; raw.value = pick.map(m => String(m.body).trim()).join('\n'); OM.raw = raw.value; OM.tags.clear(); syncTags();
        OM.smsSrc = { phone: o.phone || '', threadId: o.threadId || '', filled: true }; inState();
        inNote(`문자 ${pick.length}개를 넣었어요 · 필요 없는 글은 지우고 [입력하기]`, 'ok');
        raw.focus({ preventScroll: true }); try { raw.setSelectionRange(raw.value.length, raw.value.length); } catch (e) { /* 그대로 */ }
        return pick.length;
    }
    // #852 문자 말풍선 「발주메모」 칩 = 그 글 한 개를 입력 칸 끝 줄에 덧붙임(창이 닫혀 있으면 열고) · 여러 말풍선을 차례로 눌러 모음
    //   출처·번호 = 칸이 비었거나 같은 대화일 때 그 대화 · 다른 대화 글이 있으면 안 넣음 · 손으로 친 글 뒤면 넣되 출처 manual·번호 없음
    function appendFromSms(text, o) {
        o = o || {};
        const line = String(text || '').trim(); if (!line) return false;
        open({ noFocus: true });
        const raw = $('om-raw'), cur = raw.value, empty = !cur.trim();
        const same = !empty && OM.smsSrc && String(OM.smsSrc.threadId) === String(o.threadId || '');
        if (!empty && OM.smsSrc && !same) { inNote('다른 손님 글이 칸에 있어요 · 먼저 [입력하기] 하거나 지워 주세요', 'warn'); return false; }   // 번호가 섞이면 남의 번호가 구매자 번호로 들어감
        OM.telLn = null; raw.value = (empty ? '' : cur.replace(/\n*$/, '\n')) + line; raw.value = raw.value.slice(0, 4000); OM.raw = raw.value; xUndoHide();
        if (empty) OM.smsSrc = { phone: o.phone || '', threadId: o.threadId || '', filled: true };   // 손으로 친 글 뒤(smsSrc 없음) = 그대로 없음 → manual·번호 없음
        inState();
        const n = raw.value.split('\n').filter(s => s.trim()).length;
        inNote(empty || same ? `문자 글을 넣었어요(${n}줄) · 더 넣거나 [입력하기]` : '직접 친 글과 섞여 번호를 안 붙여요', empty || same ? 'ok' : 'warn');
        raw.scrollTop = raw.scrollHeight; xLayout();
        return true;
    }
    // #853 「현금 손님」 = 정리 결과 카드의 현금 줄 칸 그대로 빈 채로(옵션·수량·받는 분·연락처·배송지(주소 확인)·구매자 연락처·배송메세지·발송일·보내는 분) → [저장] = 사람이 만든 현금 줄 POST(AI 0) · 입력 칸 글 무접촉
    function cashCard() {
        open({ noFocus: true });
        cardOpen({ mode: 'new', cash: true, raw: '', tags: ['cash'], source: 'manual', rows: [blankRow('cash')], leftover: '', ask: '', from: null });
    }
    // 문자 대화에서: 그 글로 바로 정리 → 카드(저장 전엔 DB 0)
    function fromText(text, o) {
        o = o || {};
        open({ noFocus: true });
        runPreview({ text: String(text || '').trim().slice(0, 4000), tags: o.tags || [], source: o.threadId ? 'sms:' + o.threadId : 'manual', phone: o.phone || '', threadId: o.threadId || '' });
    }

    window.AkmOrderMemo = { open, close, fromText, fillFromSms, appendFromSms, isOpen: () => !!(OM.el && !OM.el.hidden), _t: { normRow, outRow, putBody, blanksOf, toIso } };
})();
