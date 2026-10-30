// #850(대표 10/25 「직원이 회사폰 노트에 적던 발주 메모를 에이전트 오피스로 · 최대한 편리하게 · 글 쓰임 복잡하지 않게 · 디자인 · 무회귀」) — 발주 메모함 창
//   설계 = docs/850-order-memo-design.md · 시안 docs/850-mock-*.png · 서버 계약 = docs/850-api.md(워커2) — 서버 길은 아래 API 한 곳에만(계약이 바뀌면 여기만).
//   창 = 손님 연락 창과 같은 꼴(폰 = 전체 화면 · PC = 2단: 왼쪽 넣기 + 목록 / 오른쪽 「다음 발주에 들어갈 것」 = for-ship 글 그대로).
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
        { i: 1, label: '보내는 분 연락처', more: true, kind: 'tel', ph: '비우면 구매자 번호' },   // #927 대신 주문 = 부탁한 분 번호(택배사 양식 B) · 비우면 서버가 K 로(checkCash #858)
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
    const TAGS = [['cash', '주문입력', '현금 손님'],   // #895 칩 이름 = 주문입력(누르면 빈 주문 입력 카드 · 틀 글은 안 씀)
 ['indiv', '입력삭제', TEL_PH + ' 입력o삭제x'], ['size', '사이즈·과수', TEL_PH + ' S사이즈로'], ['date', '날짜 지정', TEL_PH + ' 00일 발송'], ['sender', '보내는이', TEL_PH + ' 보내는이 홍길동']];
    // 틀 자리를 안 고친 채 [입력하기] = 막고 그 자리를 골라 줌
    const TPL_HOLES = [[TEL_PH, '번호를 넣어 주세요 — 000-0000-0000 자리에 손님 번호를 써 주세요'], [/(^|[^0-9])00일/, '발송 날짜를 넣어 주세요 — 00일 자리에 날짜를 써 주세요'], ['보내는이 홍길동', '보내는 분 이름을 넣어 주세요 — 홍길동 자리를 바꿔 주세요']];
    const PLATS = ['네이버', '쿠팡', '자사몰'];
    const RECENT_KEY = 'akm_om_recent_opts';
    const recentGet = () => { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, 5) : []; } catch (e) { return []; } };
    const recentPut = v => { if (!v) return; try { const a = [v].concat(recentGet().filter(x => x !== v)).slice(0, 5); localStorage.setItem(RECENT_KEY, JSON.stringify(a)); } catch (e) { /* 기억 못 해도 그대로 */ } };

    const OM = { el: null, tab: 'open', list: null, cleared: null, counts: null, err: '', loading: false, shipDate: '', catalog: null, raw: '', tags: new Set(), busy: false,
        card: null, opt: null, undo: null, undoT: 0, sel: new Set(), csel: new Set(), cq: '', cpage: 0, delBusy: false, ask: null, prevOpen: false, ship: null, lastFocus: null };

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
        addrOk: (id, body) => safe(call('/api/order-memo/rows/' + encodeURIComponent(id) + '/addr-ok', 'POST', body)),   // #880-b { raw } = 「이대로 둘게요」 남김 · { undo: true } = 지움 · raw ≠ 지금 주소 = 409
        pair: body => safe(call('/api/order-memo/pair', 'POST', body)),
        pairHint: key => safe(call('/api/order-memo/pair-hint?key=' + encodeURIComponent(key))),   // #894 F4 번호로 못 찾은 현금 줄 묶음 후보(읽기만 · 옛 서버 404 = 종전 화면)   // #874 저장된 현금(「!」) 줄 → 입력삭제 주소 줄 · { undo, rows } = 되돌리기
        forShip: date => safe(call('/api/order-memo/for-ship?date=' + encodeURIComponent(date))),
        catalog: () => safe(call('/api/invoice/catalog')),
        lookup: (key, plat) => safe(call('/api/order-memo/lookup?key=' + encodeURIComponent(key) + '&plat=' + encodeURIComponent(plat || ''))),   // #850-c 판매처 확인(계약 §7 · 읽기만)
    };
    // 서버 줄(계약 1절) → 화면 줄 — 칸은 그대로 두고 빠진 것만 채움
    function normRow(r, entry) {
        if (!r) return null;
        const o = { id: r.id != null ? r.id : null, kind: r.kind === 'cash' ? 'cash' : 'line', ship_date: r.ship_date ? String(r.ship_date).slice(0, 10) : null,
            sure: r.sure === true, check_why: Array.isArray(r.check_why) ? r.check_why.map(String) : (r.check_why ? [String(r.check_why)] : []), src: r.src || '',
            stale: r.stale === true, indiv: r.indiv === true, state: r.state || 'open', used_on: r.used_on ? String(r.used_on).slice(0, 10) : null, cleared_at: r.cleared_at || '', entry: entry || {},
            addr_ok: r.addr_ok && typeof r.addr_ok === 'object' ? r.addr_ok : ('addr_ok' in r ? null : undefined) };   // #880-b 주소 「이대로 둘게요」 서버 기록 · undefined = 옛 서버(화면 기억 AKEPT 로)
        if (o.kind === 'cash') { o.cells = Array.from({ length: 13 }, (_, i) => (Array.isArray(r.cells) && r.cells[i] != null ? String(r.cells[i]) : '')); o.missing = Array.isArray(r.missing) ? r.missing.map(Number) : []; o.service = r.service === true; }   // #900 1-C 서비스 줄(현금 꼴 「!」 · 입력삭제 대조 밖)
        else { o.key = r.key || ''; o.note = r.note || ''; o.plat = r.plat || ''; o.line = r.line || [o.ship_date ? md(o.ship_date) : '', o.key, o.note, o.plat].join('\t'); o.checked = r.checked || null; }
        return o;
    }
    const outRow = r => Object.assign(r.kind === 'cash' ? Object.assign({ kind: 'cash', ship_date: r.ship_date || null, cells: r.cells.slice(), indiv: !!r.indiv }, r.service ? { service: true } : {}, !r.service && (r._indOff || r._noIndiv) ? { no_indiv: true } : {}) : { kind: 'line', ship_date: r.ship_date || null, key: r.key, note: r.note, plat: r.plat, line: r.line, checked: r.checked || null }, r.src ? { src: r.src } : {});   // 미리보기에서 받은 src·line 을 그대로(출처 보존 · 고쳤으면 서버가 다시 만듦 · 계약 §6)
    const putBody = r => r.kind === 'cash' ? Object.assign({ cells: r.cells.slice(), ship_date: r.ship_date || null }, r._svcTouched ? { service: !!r.service } : {}) : Object.assign({ key: r.key, note: r.note, plat: r.plat, ship_date: r.ship_date || null }, r._lk && r._lk.state === 'done' ? { checked: r.checked || null } : {});   // 찾기가 끝난 줄만 확인 표시를 보냄(못 찾았으면 null = 지움 · 아직이면 안 보냄 = 서버가 번호·판매처 바뀌면 비움)

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
        if (isCheck(r)) return { k: 'check', t: (r.stale ? '오래된 ' : '') + (blanksOf(r).length ? '빈칸 ' + blanksOf(r).length : '확인') };   // stale = 7일 넘게 안 고친 확인 줄(설정 unsure_days 넘으면 · 대표 10/28 30→10일 서버가 지움)
        if (isLater(r)) return { k: 'later', t: md(r.ship_date) + ' 발송 · 대기' };
        // #873 다음 발주에 들어갈 줄 = 머리 줄과 같은 날짜 글 하나(「내일」은 자정 넘으면 틀림 · 그 발주를 미리 열어 used_on 이 찍혀도 같은 글)
        //   used_on 이 다음 발주와 다른 날 = 지난 발주에 넣고 안 비운 줄 → 그날 표시(for-ship 은 used_on 을 안 봐서 다음 발주에도 들어감)
        if (r.used_on && r.used_on !== OM.shipDate) return { k: 'used', t: md(r.used_on) + ' 발주에 넣음' };
        return { k: 'next', t: OM.shipDate ? mdw(OM.shipDate) + ' 발주' : '다음 발주' };
    }
    const senderShow = v => String(v || '').replace(/[!！]/g, '').replace(/\s+/g, ' ').trim();   // #863 「!」 어디든(서버가 맨 뒤에 붙임) 떼고 보임
    const senderTelSame = r => !!digits(r.cells[1]) && digits(r.cells[1]) === digits(r.cells[10]);   // #927 보내는사람연락처(B) = 구매자연락처(K) → 따로 넣은 번호 아님
    const senderTelOwn = r => !!digits(r.cells[1]) && !senderTelSame(r);
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
                <div class="om-nexth" id="om-nexth"><b>다음 발주에 들어갈 것</b><span id="om-next-d"></span></div>
                <div class="om-tabs" role="tablist" aria-label="메모 목록">
                  <button type="button" class="om-tabb" role="tab" data-tab="open" aria-selected="true">지금 메모 <b id="om-n-open"></b></button>
                  <button type="button" class="om-tabb" role="tab" data-tab="cleared" aria-selected="false" id="om-tab-clr">비운 것</button>
                </div>
                <p class="om-sum" id="om-sum" role="status"></p>
                <div class="om-cash-q om-clr-q" id="om-clr-qw" hidden><label class="om-sr" for="om-clr-q">비운 것 찾기</label><input type="search" id="om-clr-q" autocomplete="off" spellcheck="false" placeholder="찾기 · 이름·번호 끝자리·주소·품목"></div>
                <div class="om-selbar" id="om-selbar" hidden><label class="om-selall"><input type="checkbox" id="om-selall">전체 선택</label><span class="om-seln" id="om-seln" role="status"></span><button type="button" class="om-btn sm om-del" id="om-ldel" disabled>삭제</button></div>
                <ul class="om-list" id="om-list" aria-live="polite"></ul>
                <p class="om-mnote" id="om-mnote" hidden>뒤 날짜 줄은 최종발주가 「오늘 안 나감」으로 빼요 · 확인 줄은 고친 뒤 들어가요</p>
              </div>
              <aside class="om-prev" id="om-prev" aria-labelledby="om-prev-t">
                <div class="om-prev-h"><b id="om-prev-t">현금 줄</b><span id="om-prev-d"></span><button type="button" class="om-btn sm om-prev-x" id="om-prev-x">닫기</button></div>
                <div class="om-prev-b" id="om-prev-b">
                  <section class="om-cash" id="om-cash" aria-label="현금 줄 표">
                    <div class="om-cash-q"><label class="om-sr" for="om-cash-q">현금 줄 찾기</label><input type="search" id="om-cash-q" autocomplete="off" spellcheck="false" placeholder="찾기 · 이름·번호 끝자리·주소·품목"></div>
                    <div class="om-selbar om-cselbar" id="om-cselbar" hidden><label class="om-selall"><input type="checkbox" id="om-cselall" data-csall="1">전체 선택</label><span class="om-seln" id="om-cseln" role="status"></span><button type="button" class="om-btn sm om-cneed" id="om-cneed" aria-pressed="false" hidden></button></div>
                    <p class="om-cafail" id="om-cafail" role="status" hidden></p>
                    <div class="om-ctw" id="om-ctw" aria-live="polite"></div>
                    <p class="om-prev-held" id="om-cheld" hidden></p>
                  </section>
                </div>
              </aside>
            </div>
            <footer class="om-foot" id="om-foot">
              <button type="button" class="om-btn" id="om-prev-open">현금 줄</button>
              <button type="button" class="om-btn om-del" id="om-del" disabled>현금 줄 삭제</button>
            </footer>
            <div class="om-undo" id="om-undo" role="status" hidden><span id="om-undo-t"></span><button type="button" class="om-btn sm" id="om-undo-b">되돌리기</button></div>
          </div>
          <div class="om-ask-back" id="om-ask-back" hidden></div>
          <div class="om-ask" id="om-ask" role="alertdialog" aria-modal="true" aria-labelledby="om-ask-h" aria-describedby="om-ask-s" hidden>
            <b id="om-ask-h"></b><p id="om-ask-s"></p>
            <div class="om-ask-acts"><button type="button" class="om-btn" id="om-ask-no">취소</button><button type="button" class="om-btn danger" id="om-ask-yes">삭제</button></div>
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
        tp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && (e.target.id === 'om-tp-tel' || e.target.id === 'om-tp-name' || e.target.id === 'om-tp-gw')) { e.preventDefault(); tpGo(); } });
        tp.addEventListener('change', e => { if (e.target.id === 'om-tp-date') { tpNote(''); if (!$('om-tp-tel').value.trim()) $('om-tp-tel').focus({ preventScroll: true }); else $('om-tp-go').focus({ preventScroll: true }); } });
        tp.addEventListener('click', e => { const b = e.target.closest('[data-tpsz]'); if (!b || !OM.tp) return; OM.tp.sz = b.dataset.tpsz; tp.querySelectorAll('[data-tpsz]').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false')); const g = $('om-tp-gw'); if (g) g.value = ''; tpNote(''); });   // #882 사이즈 고르면 과수 칸 비움(둘 중 하나)
        tp.addEventListener('input', e => { if (e.target.id !== 'om-tp-gw' || !OM.tp || !e.target.value.trim() || !OM.tp.sz) return; OM.tp.sz = null; tp.querySelectorAll('[data-tpsz]').forEach(x => x.setAttribute('aria-checked', 'false')); });   // #882 과수 치면 사이즈 단추 풂(칸 값은 안 바꿈 · #857)
        OM.el.querySelector('.om-tabs').addEventListener('click', e => { const b = e.target.closest('.om-tabb'); if (!b || b.dataset.tab === OM.tab) return; OM.tab = b.dataset.tab; syncTabs(); load(); });
        $('om-list').addEventListener('click', onList);
        $('om-prev-open').addEventListener('click', () => prevShow(true));
        $('om-prev-x').addEventListener('click', () => prevShow(false, true));
        $('om-list').addEventListener('change', e => { const c = e.target.closest('input[data-act="pick"]'); if (!c) return; const li = c.closest('.om-item'); if (!li) return; if (c.checked) OM.sel.add(String(li.dataset.id)); else OM.sel.delete(String(li.dataset.id)); li.classList.toggle('picked', c.checked); selSync(); });
        $('om-selall').addEventListener('change', e => { const all = memoRows().map(r => String(r.id)); OM.sel = new Set(e.target.checked ? all : []); renderList(); });   // #878 왼쪽 = 메모 줄만
        $('om-ldel').addEventListener('click', () => askDel(memoRows().filter(r => OM.sel.has(String(r.id))), $('om-ldel')));
        $('om-del').addEventListener('click', () => askDel(cashPicked(), $('om-del')));   // #878 맨 아래 [삭제] = 오른쪽 현금 줄 고른 것(찾기에 보이는 것만)
        $('om-ctw').addEventListener('click', onCash);
        const csAll = e => { cashPage(byRank(cashShown())).forEach(r => { const id = String(r.id); if (e.target.checked) OM.csel.add(id); else OM.csel.delete(id); }); renderCash(); };   // 찾은 줄 기준(머리 칸·폰 줄 같은 일)
        $('om-ctw').addEventListener('change', e => { if (e.target.dataset.csall) { csAll(e); return; } const c = e.target.closest('input[data-act="pick"]'); if (!c) return; const tr = c.closest('tr[data-id]'); if (!tr) return; if (c.checked) OM.csel.add(String(tr.dataset.id)); else OM.csel.delete(String(tr.dataset.id)); tr.classList.toggle('picked', c.checked); cselSync(); });
        $('om-cselall').addEventListener('change', csAll);
        $('om-cash-q').addEventListener('input', e => { OM.cq = e.target.value; OM.cpage = 0; renderCash(); });
        $('om-clr-q').addEventListener('input', e => { OM.clq = e.target.value; renderList(); });   // #903 비운 것 찾기(목록만 다시 그림 · 칸 초점 그대로)
        $('om-cneed').addEventListener('click', () => { OM.cneed = !OM.cneed; OM.cpage = 0; renderCash(); if (OM.cneed) aseqStart(); else OM.aseq = null; });   // #880-b 주소 확인 필요 줄만 보기 + 첫 줄 카드부터 이어서 ↔ 모두
        $('om-ask-no').addEventListener('click', () => askClose(true));
        $('om-ask-back').addEventListener('click', () => askClose(true));
        $('om-ask-yes').addEventListener('click', askYes);
        $('om-ask').addEventListener('keydown', e => { if (e.key !== 'Tab') return; const a = $('om-ask-no'), b = $('om-ask-yes'); if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); } else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); } });   // 초점은 두 단추 안에서만
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
            if (OM.ask) { askClose(true); return; }   // #878 삭제 확인 창 = 취소
            if (e.target && e.target.id === 'om-cash-q' && e.target.value) { e.target.value = ''; OM.cq = ''; OM.cpage = 0; renderCash(); return; }
            if (e.target && e.target.id === 'om-clr-q' && e.target.value) { e.target.value = ''; OM.clq = ''; renderList(); return; }   // #903 같은 꼴   // #878 찾기 칸 Esc = 값만 비움(메모함 안 닫힘)
            if (OM.opt) { optClose(true); return; }
            if (OM.card) { cardClose(); return; }
            if (OM.tp) { tpClose(true); return; }   // #862 줄 입력판
            if (OM.prevOpen) { prevShow(false, true); return; }
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
    const TP_KIND = { indiv: ['입력삭제', '이 번호 주문은 택배사 양식에서 빼고 현금 주소 줄로'], size: ['사이즈·과수', '귤 로얄과 사이즈 · 만감류 선물용 과수'], date: ['날짜 지정', '그날 발송분으로'], sender: ['보내는이', '선물 보내는 분 이름'] };
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
        $('om-tp-k').innerHTML = k === 'size' ? `<div class="om-seg om-tp-sz" role="radiogroup" aria-label="사이즈">${['2S', 'S', 'M'].map(z => `<button type="button" role="radio" class="om-seg-b" data-tpsz="${z}" aria-checked="false">${z}</button>`).join('')}</div><label class="om-tp-gw"><input id="om-tp-gw" inputmode="numeric" autocomplete="off" maxlength="3" placeholder="과수" aria-label="과수(만감류 선물용 · 숫자만 · 예 13)"><span aria-hidden="true">과</span></label>`
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
        if (k === 'size') { if (x.sz) return tel + ' ' + x.sz + '사이즈로'; const n = digits(x.gw).replace(/^0+/, ''); return n && Number(n) <= 40 ? gwLine(tel, n) : null; }   // #882 과수 = 숫자만(1~40 · 최종발주 #883 gwaLines 와 같은 범위)
        if (k === 'date') { const d = tpDay(x.date); return !d ? null : /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(d) ? d + ' ' + tel + ' 발송' : tel + ' ' + d + ' 발송'; }   // 해 넘김 = 날짜를 앞에(「1/3/27 010-… 발송」)
        if (k === 'sender') { const n = String(x.name || '').replace(/\s+/g, ' ').trim(); return n ? tel + ' 보내는이 ' + n : null; }
        return null;
    }
    const gwLine = (tel, n) => tel + ' ' + n + '과로';   // #882 만감류 선물용 과수 줄 꼴(최종발주 #883 gwaLines 가 먹는 꼴 = 사이즈 줄과 같게 판매처는 카드에서)
    function tpGo() {
        const x = OM.tp; if (!x) return;
        const te = $('om-tp-tel'), d = digits(te.value);
        if (!(isPhoneish(te.value) && d.length >= 9)) { tpNote('손님 번호를 넣어 주세요 · 예) 010-1234-5678', 'err'); te.focus({ preventScroll: true }); return; }
        te.value = fmtTel(te.value); const tel = lineTel(te.value);
        const name = $('om-tp-name'), date = $('om-tp-date');
        const gw = $('om-tp-gw'), line = tpLine(x.k, tel, { sz: x.sz, gw: gw && gw.value, date: date && date.value, name: name && name.value });
        if (!line) {
            if (x.k === 'size') { if (gw && gw.value.trim()) { tpNote('과수는 1~40 숫자로 넣어 주세요 · 예) 13', 'err'); gw.focus({ preventScroll: true }); } else { tpNote('사이즈를 고르거나 과수를 넣어 주세요', 'err'); const b = $('om-tp').querySelector('[data-tpsz]'); if (b) b.focus({ preventScroll: true }); } }
            else if (x.k === 'date') { tpNote('발송 날짜를 골라 주세요', 'err'); if (date) { date.focus({ preventScroll: true }); date.click(); } }
            else { tpNote('보내는 분 이름을 넣어 주세요', 'err'); if (name) name.focus({ preventScroll: true }); }
            return;
        }
        const raw = $('om-raw'); telLeave(raw, true);
        const cur = raw.value, pre = cur && !/\n$/.test(cur) ? cur + '\n' : cur;
        raw.value = (pre + line).slice(0, 4000); OM.raw = raw.value; xUndoHide(); inState();
        try { raw.scrollTop = raw.scrollHeight; } catch (e) { /* 그대로 */ }
        OM.tpLast = te.value;
        const nSaved = x.k === 'indiv' ? savedCashOf(digits(tel)).length : 0;   // #874 이 번호 현금 줄이 이미 메모함에 있으면 알림만(바꾸기는 [입력하기] 뒤 카드에서)
        inNote(`「${line}」 줄을 넣었어요`, 'ok'); tpNote(nSaved ? `넣었어요 · 메모함에 이 번호 현금 줄 ${nSaved}개가 있어요 — [입력하기] 뒤 카드에서 입력삭제 주소 줄로 바꿀 수 있어요` : '넣었어요 · 같은 손님은 꼬리표만 바꿔 이어서, 다른 손님은 번호를 바꿔 넣으세요', 'ok');
        x.sz = null; $('om-tp').querySelectorAll('[data-tpsz]').forEach(b => b.setAttribute('aria-checked', 'false')); if (gw) gw.value = ''; if (name) name.value = ''; if (date) date.value = '';
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
        c.rows.forEach((r, i) => { if (r.kind === 'cash' && !r._addr && String(r.cells[8] || '').trim()) addrRun(i); });   // #882 창구가 나중에 넣은 현금 줄도 주소 확인(종전 = cardOpen 의 lkAll 만 돌아 AI 줄은 빠졌음 · ACACHE 공용)
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
        { const k = Number(b.keep_days); if (Number.isInteger(k) && k >= 1 && k <= 365) { OM.keepDays = k; const t = $('om-tab-clr'); if (t) t.textContent = `비운 것(${k}일)`; } }   // #905 비운 줄 보관 날(설정 · 대표 10/28 30→15) · 응답 전엔 「비운 것」만
        const rows = []; (Array.isArray(b.entries) ? b.entries : []).forEach(e => (Array.isArray(e.rows) ? e.rows : []).forEach(r => { const x = normRow(r, e); if (x && (tab === 'cleared' ? x.state === 'cleared' : x.state !== 'cleared')) rows.push(x); }));
        if (tab === 'open') { OM.list = rows; OM.counts = b.counts || null; } else OM.cleared = rows;
        renderList(); if (tab === 'open') loadShip();
    }
    function syncTabs() {
        OM.el.querySelectorAll('.om-tabb').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === OM.tab ? 'true' : 'false'));
        $('om-foot').hidden = OM.tab !== 'open';
    }
    // #878(대표 A안 10/27) 왼쪽 「지금 메모」 = 메모 줄(kind line)만 · 현금 줄(현금 손님·입력삭제 주소 줄) = 오른쪽 「현금 줄」 표에서만
    const memoRows = () => (OM.list || []).filter(r => r.kind !== 'cash');
    const cashRows = () => (OM.list || []).filter(r => r.kind === 'cash');
    const rankOf = r => OM.tab !== 'open' ? 0 : isCheck(r) ? 0 : isLater(r) ? 2 : r.used_on && r.used_on !== OM.shipDate ? 3 : 1;   // 확인할 줄 → 다음 발주(미리 열어 넣은 줄도 · #873) → 날짜 대기 → 넣은 것 · 같은 무리 안은 최근 순
    const byRank = rows => rows.slice().sort((a, b) => rankOf(a) - rankOf(b) || String(b.entry.created_at || '').localeCompare(String(a.entry.created_at || '')));
    // #879(대표 10/27 · #878 다시) 왼쪽 = 「다음 발주에 들어갈 것」 메모 칸 꼴 상자(고정폭 글 한 줄씩 · 줄마다 체크·× · 누르면 고치기) · 비운 것(keep_days일) 탭은 종전 카드
    const badgeOf = r => { const p = pillOf(r); return p.k === 'next' ? null : p; };   // 다음 발주에 그냥 들어가는 줄 = 표시 없음 · 확인·날짜 대기·지난 발주 줄만 작은 표시(#873 배지 뜻)
    const whoOf = r => nameOf(r) || (last4(numOf(r)) ? '…' + last4(numOf(r)) : '이 줄');
    // #880 현금 줄 알약 = 입력삭제 주소 줄은 「입력삭제 …끝4」(구매자 번호 · 현금 알약과 다른 색) · 현금 손님은 「현금」
    const cashPill = r => { if (r.service) return '<span class="om-pill k-svc">서비스</span>'; if (!r.indiv) return '<span class="om-pill k-cash">현금</span>'; const l4 = last4(r.cells[10] || r.cells[1]); return `<span class="om-pill k-indiv">입력삭제${l4 ? ' …' + esc(l4) : ''}</span>`; };
    // #903(대표 10/28 폰 실물) 「비운 것」 = 최근 비운 줄 맨 위(cleared_at 내림 · 같으면 줄 번호 큰 것 먼저 · 종전 = 저장 묶음 순이라 어제 저장한 줄을 오늘 비우면 아래로 감)
    //   찾기 = 현금 줄 표 찾기와 같은 꼴(이름·번호 끝자리·주소·품목 · 띄어쓰기 무시) · 메모 줄은 메모 칸 글·번호로
    const clrAt = r => { const t = Date.parse(String(r.cleared_at || '')); return Number.isFinite(t) ? t : 0; };
    const byCleared = rows => rows.slice().sort((a, b) => clrAt(b) - clrAt(a) || Number(b.id) - Number(a.id));
    function clrShown(rows) {
        const q = String(OM.clq || '').trim().toLowerCase().replace(/\s+/g, ''), qd = digits(q); if (!q) return rows;
        const hay = r => r.kind === 'cash' ? cashHay(r) : (lineView(r.line) + ' ' + (r.note || '') + ' ' + (r.plat || '')).toLowerCase().replace(/\s+/g, '');
        const tels = r => r.kind === 'cash' ? cashTels(r) : [digits(r.key)];
        return rows.filter(r => hay(r).includes(q) || (qd.length >= 2 && qd === q.replace(/-/g, '') && tels(r).some(t => t && t.includes(qd))));
    }
    function renderList() {
        const ul = $('om-list'), sum = $('om-sum');
        const isOpenTab = OM.tab === 'open';
        const open = OM.list || [], memo = memoRows();
        const rows = isOpenTab ? (OM.list ? memo : null) : OM.cleared;
        $('om-n-open').textContent = memo.length ? String(memo.length) : '';
        $('om-next-d').textContent = OM.shipDate ? mdw(OM.shipDate) + ' 발주' : '';
        $('om-nexth').hidden = !isOpenTab;
        $('om-clr-qw').hidden = isOpenTab || !(OM.cleared && OM.cleared.length);   // #903 비운 것이 있을 때만 찾기 칸
        const nCheck = open.filter(isCheck).length;
        const have = new Set(memo.map(r => String(r.id))); OM.sel.forEach(id => { if (!have.has(id)) OM.sel.delete(id); });   // #859 없어진 줄은 고른 것에서 뺌
        $('om-selbar').hidden = !isOpenTab || !memo.length || !!OM.err; selSync();
        const hp = $('om-hpill'); hp.hidden = !nCheck; hp.textContent = '확인 ' + nCheck;
        renderCash();
        ul.classList.remove('om-mbox'); $('om-mnote').hidden = true;
        if (OM.loading && !rows) { ul.innerHTML = '<li class="om-skel" aria-hidden="true"></li><li class="om-skel" aria-hidden="true"></li><li class="om-skel" aria-hidden="true"></li>'; sum.textContent = ''; return; }
        if (OM.err) { ul.innerHTML = `<li class="om-empty err"><b>${esc(OM.err)}</b><button type="button" class="om-btn sm" data-act="reload">다시 불러오기</button></li>`; sum.textContent = ''; return; }
        if (isOpenTab && open.length) {
            const ready = open.filter(r => !isCheck(r) && !isLater(r));
            const nLine = ready.filter(r => r.kind === 'line').length, nCash = ready.filter(r => r.kind === 'cash').length, nLater = open.filter(r => !isCheck(r) && isLater(r)).length;
            sum.innerHTML = `메모 ${nLine}줄 · 현금 ${nCash}줄 들어가요` + (nLater ? ` · 날짜 대기 ${nLater}` : '') + (nCheck ? ` · <em>확인 ${nCheck}</em>` : '');
        } else sum.textContent = isOpenTab ? '' : (rows && rows.length ? (OM.clq && OM.clq.trim() ? `${clrShown(rows).length}줄 찾음 · ` : '') + '최근 비운 줄이 위 · ' + (OM.keepDays ? `비운 지 ${OM.keepDays}일이 지나면` : '오래 지나면') + ' 영구로 지워져요.' : '');
        if (!rows || !rows.length) {
            const nc = cashRows().length;
            ul.innerHTML = isOpenTab
                ? (nc ? `<li class="om-empty"><b>메모 줄이 없어요</b><span>현금 줄 ${nc}개는 「현금 줄」 표에 있어요${window.matchMedia('(max-width: 899px)').matches ? ' · 아래 [현금 줄]' : ' · 오른쪽'}</span></li>` : '<li class="om-empty"><b>다음 발주에 넣을 메모가 없어요</b><span>손님 글을 위 칸에 붙여 넣으면 여기에 쌓여요.</span></li>')
                : `<li class="om-empty"><b>비운 메모가 없어요</b><span>비운 줄은 ${OM.keepDays ? OM.keepDays + '일 동안' : '한동안'} 여기서 되살릴 수 있어요.</span></li>`;
            return;
        }
        if (isOpenTab) { ul.classList.add('om-mbox'); $('om-mnote').hidden = false; ul.innerHTML = byRank(rows).map(memoLineHtml).join(''); return; }
        const shown = clrShown(byCleared(rows));   // #903
        ul.innerHTML = shown.length ? shown.map(r => rowHtml(r, false, OM.sel)).join('') : '<li class="om-empty"><b>찾는 줄이 없어요</b><span>이름·번호 끝자리·주소·품목으로 찾아요.</span></li>';
    }
    function memoLineHtml(r) {
        const b = badgeOf(r), on = OM.sel.has(String(r.id)), w = whoOf(r);
        return `<li class="om-item om-ml${b ? ' k-' + b.k : ''}${on ? ' picked' : ''}" data-id="${esc(r.id)}">
            <label class="om-ck"><input type="checkbox" data-act="pick" aria-label="${esc(w + ' 고르기')}"${on ? ' checked' : ''}></label>
            <button type="button" class="om-ml-t" data-act="edit" aria-label="${esc(lineView(r.line) + ' 열어 고치기')}"><span class="om-ml-l">${esc(lineView(r.line) || '(빈 줄)')}</span>${b ? `<span class="om-pill k-${b.k}">${esc(b.t)}</span>` : ''}${isCheck(r) ? `<span class="om-ml-why">${esc(whyOf(r))}</span>` : ''}</button>
            <button type="button" class="om-x" data-act="del" aria-label="${esc(w + ' 지우기')}" title="지우기">${ICON_X}</button></li>`;
    }
    function rowHtml(r, isOpen, sel) {
        const p = isOpen ? pillOf(r) : { k: 'gone', t: '비움 ' + hm(r.cleared_at) };
        const nm = nameOf(r), l4 = last4(numOf(r));
        const who = [r.entry.created_by, hm(r.entry.created_at)].filter(Boolean).join(' · ');
        const why = isOpen && isCheck(r) ? `<p class="om-why">${esc(whyOf(r))}</p>` : '';
        const act = isOpen
            ? `<button type="button" class="om-x" data-act="del" aria-label="${esc((nm || (l4 ? '…' + l4 : '이 줄')) + ' 지우기')}" title="지우기">${ICON_X}</button>`
            : `<button type="button" class="om-btn sm om-restore" data-act="restore">되살리기</button>`;
        const label = (nm || (l4 ? '…' + l4 : '메모')) + (isOpen ? ' 열어 고치기' : '');
        const on = isOpen && sel.has(String(r.id));
        const ck = isOpen ? `<label class="om-ck"><input type="checkbox" data-act="pick" aria-label="${esc((nm || (l4 ? '…' + l4 : '이 줄')) + ' 고르기')}"${on ? ' checked' : ''}></label>` : '';
        return `<li class="om-item k-${p.k}${on ? ' picked' : ''}" data-id="${esc(r.id)}">
            <div class="om-row">${ck}
              <${isOpen ? 'button type="button" class="om-open" data-act="edit"' : 'div class="om-open"'} aria-label="${esc(label)}">
                <span class="om-r1">${nm ? `<b class="om-nm">${esc(nm)}</b>` : ''}${l4 ? `<span class="om-l4">…${esc(l4)}</span>` : ''}${r.kind === 'cash' ? cashPill(r) : ''}<span class="om-pill k-${p.k}">${esc(p.t)}</span><span class="om-who">${esc(who)}</span></span>
                <span class="om-line">${esc(previewOf(r) || '(빈 줄)')}</span>
              </${isOpen ? 'button' : 'div'}>
              ${act}
            </div>${why}</li>`;
    }
    const rowById = id => ((OM.tab === 'open' ? OM.list : OM.cleared) || []).find(r => String(r.id) === String(id));
    const editOpen = (r, more) => cardOpen(Object.assign({ mode: 'edit', rows: [clone(r)], raw: r.entry.raw || '', source: r.entry.source || '' }, more || {}));
    // #880-b 「주소 확인 필요 n줄」 = 그 줄 고치기 카드를 첫 줄부터 이어서(카드에서 [도로명으로 바꾸기]·후보 → [저장] 또는 「이대로 둘게요」로 끝내면 다음 줄 · 닫으면 멈춤)
    function aseqStart() { const ids = byRank(cashRows().filter(addrNeed)).map(r => String(r.id)); if (!ids.length) return; OM.aseq = { ids, i: -1 }; aseqNext(); }
    function aseqNext() {
        const q = OM.aseq; if (!q) return;
        for (q.i++; q.i < q.ids.length; q.i++) {
            const r = cashRows().find(x => String(x.id) === q.ids[q.i]); if (!r || addrKept(r)) continue;
            const h = ACACHE.get(String(r.cells[8] || '').trim()); if (h && h.done && h.res.state === 'one') continue;   // 그사이 확인됨 = 건너뜀
            editOpen(r, { aseq: { at: q.i + 1, n: q.ids.length } }); return;
        }
        OM.aseq = null; toast('주소 확인 다 했어요');
        if (OM.cneed && !cashRows().some(addrNeed)) { OM.cneed = false; renderCash(); }
    }
    const aseqGo = c => { if (c && c.aseq && OM.aseq) { c._aseqGo = true; return true; } return false; };   // 카드가 일을 끝냄 = 닫혀도 멈추지 않고 다음 줄로
    async function onList(e) {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'pick') return;   // #859 고르기 칸 = change 에서
        if (act === 'reload') { load(); return; }
        const li = b.closest('.om-item'); const r = li && rowById(li.dataset.id); if (!r) return;
        if (act === 'edit') { editOpen(r); return; }
        if (act === 'del') { askDel([r], b); return; }
        if (act === 'restore') {
            b.disabled = true; const res = await API.restore(r.id);
            if (!res.ok) { b.disabled = false; toast(errText(res, '되살리지 못했어요')); return; }
            OM.cleared = (OM.cleared || []).filter(x => x !== r); renderList(); OM.list = null;
            toast('되살렸어요 · 「지금 메모」로 돌아갔어요');
        }
    }
    // ── #879 오른쪽 「현금 줄」 = #878 전 표 꼴(수취인명·옵션정보·수량·수취인연락처1·배송지) + 맨 앞 체크·머리 전체 선택(찾은 결과 기준)·끝 × · 찾기 · 줄 누르면 고치기 카드(현금 줄 고치기·도로명·#874 짝 그대로)
    const cashHay = r => [r.cells[0], r.cells[3], r.cells[4], r.cells[8], r.cells[9]].join(' ').toLowerCase().replace(/\s+/g, '');
    const cashTels = r => [r.cells[1], r.cells[6], r.cells[10]].map(digits).filter(Boolean);
    function cashShown() {
        const q = String(OM.cq || '').trim().toLowerCase().replace(/\s+/g, ''), qd = digits(q);
        const all = OM.cneed ? cashRows().filter(addrNeed) : cashRows();   // #880-b 「주소 확인 필요 n줄」 누름 = 그 줄들만
        if (!q) return all;
        return all.filter(r => cashHay(r).includes(q) || (qd.length >= 2 && qd === q.replace(/-/g, '') && cashTels(r).some(t => t.includes(qd))));
    }
    function cashRowHtml(r) {
        const b = badgeOf(r), on = OM.csel.has(String(r.id)), w = whoOf(r), c = r.cells;
        return `<tr class="om-ct-r${b ? ' k-' + b.k : ''}${on ? ' picked' : ''}" data-id="${esc(r.id)}">
            <td class="ck"><label class="om-ck"><input type="checkbox" data-act="pick" aria-label="${esc(w + ' 고르기')}"${on ? ' checked' : ''}></label></td>
            <td class="nm"><button type="button" class="om-ct-open" data-act="edit" aria-label="${esc(w + ' 열어 고치기')}">${esc(c[3] || '(이름 없음)')}</button><span class="om-ct-p">${cashPill(r)}${b ? `<span class="om-pill k-${b.k}">${esc(b.t)}</span>` : ''}<span class="om-ct-ap">${addrPillOf(r)}</span></span>${isCheck(r) ? `<span class="om-ct-why">${esc(whyOf(r))}</span>` : ''}</td>
            <td class="opt">${esc(shortOpt(c[4]))}</td><td class="n q">${esc(c[5])}</td><td class="n tel">${esc(c[6])}</td><td class="ad">${esc(c[8])}</td>
            <td class="x"><button type="button" class="om-x sm" data-act="del" aria-label="${esc(w + ' 지우기')}" title="지우기">${ICON_X}</button></td></tr>`;
    }
    // #900 2-B 명절 = 현금 줄 100줄 넘으면 「촘촘히」 꼴(글씨 12 · 줄 36 · 폰 44 그대로) + 한 쪽 50줄 페이지 · 찾기는 전체에서 찾고 결과도 페이지
    //   100줄까지 = 종전 그대로(그리는 글·동작 같음) · 주소 확인(주소 검색) = 보이는 쪽 줄만 · 전체 선택 = 보이는 쪽만 + 「찾은 n줄 전부 고르기」 따로
    const CBIG_MIN = 100, CPAGE = 50;
    const cashBig = () => cashRows().length > CBIG_MIN;
    function cashPage(shown) {   // 큰 표 = 지금 쪽 줄 · 아니면 전부(같은 배열)
        if (!cashBig()) return shown;
        const pages = Math.max(1, Math.ceil(shown.length / CPAGE)); OM.cpage = Math.min(Math.max(0, OM.cpage | 0), pages - 1);
        return shown.slice(OM.cpage * CPAGE, OM.cpage * CPAGE + CPAGE);
    }
    function pagerHtml(n) {   // ‹ 1 2 3 4 5 … 20 › (폰 = ‹ 3 / 20 › · css 로 바꿔 보임)
        const pages = Math.ceil(n / CPAGE); if (pages <= 1) return '';
        const cur = OM.cpage, want = new Set([0, pages - 1]), nums = [];
        for (let i = cur - 2; i <= cur + 2; i++) if (i >= 0 && i < pages) want.add(i);
        if (cur < 4) for (let i = 0; i < Math.min(5, pages); i++) want.add(i);
        if (cur > pages - 5) for (let i = Math.max(0, pages - 5); i < pages; i++) want.add(i);
        let prev = -1; [...want].sort((a, b) => a - b).forEach(i => { if (i - prev > 1) nums.push('<span class="om-pg-gap" aria-hidden="true">…</span>'); nums.push(`<button type="button" class="om-pg-b" data-pg="${i}"${i === cur ? ' aria-current="page"' : ''} aria-label="${i + 1}쪽">${i + 1}</button>`); prev = i; });
        return `<nav class="om-pg" aria-label="현금 줄 쪽 넘기기"><button type="button" class="om-pg-b om-pg-a" data-pg="prev" aria-label="앞 쪽"${cur ? '' : ' disabled'}>‹</button><span class="om-pg-nums">${nums.join('')}</span><span class="om-pg-of" aria-hidden="true"><b>${cur + 1}</b> / ${pages}</span><button type="button" class="om-pg-b om-pg-a" data-pg="next" aria-label="다음 쪽"${cur < pages - 1 ? '' : ' disabled'}>›</button><span class="om-pg-n">${(cur * CPAGE + 1).toLocaleString()}–${Math.min(n, cur * CPAGE + CPAGE).toLocaleString()} / ${n.toLocaleString()}줄</span></nav>`;
    }
    function cashGo(k) {   // 쪽 넘기기 → 표 맨 위가 보이게 · 초점 = 같은 단추(끝에 닿아 꺼졌으면 지금 쪽 숫자)
        const pages = Math.ceil(cashShown().length / CPAGE);
        OM.cpage = k === 'prev' ? OM.cpage - 1 : k === 'next' ? OM.cpage + 1 : +k;
        OM.cpage = Math.min(Math.max(0, OM.cpage | 0), Math.max(0, pages - 1));
        renderCash();
        const box = $('om-ctw'), tw = box && box.querySelector('.om-prev-tw'); if (tw) tw.scrollIntoView({ block: 'start' });
        const f = box && (box.querySelector(`.om-pg-b[data-pg="${k}"]:not([disabled])`) || box.querySelector('.om-pg-b[aria-current]')); if (f) f.focus({ preventScroll: true });
    }
    function cashAllBtn(big, found) {   // 「찾은 n줄 전부 고르기」 = 큰 표에서 여러 쪽일 때만(종전 화면엔 안 생김)
        let b = $('om-callfound');
        if (!big || found.length <= CPAGE) { if (b) b.remove(); return; }
        if (!b) { b = document.createElement('button'); b.type = 'button'; b.id = 'om-callfound'; b.className = 'om-btn sm om-callfound'; b.addEventListener('click', () => { const ids = cashShown().map(r => String(r.id)), on = !ids.every(id => OM.csel.has(id)); ids.forEach(id => { if (on) OM.csel.add(id); else OM.csel.delete(id); }); renderCash(); }); $('om-cseln').after(b); }
        const n = found.length.toLocaleString();
        b.dataset.head = String(OM.cq || '').trim() || OM.cneed ? `찾은 ${n}줄 전부 ` : `${n}줄 전부 `;
        b.textContent = b.dataset.head + (found.every(r => OM.csel.has(String(r.id))) ? '풀기' : '고르기');
    }
    function renderCash() {
        const box = $('om-ctw'); if (!box) return;
        AQ.draw = new Set();   // #880 주소 확인 = 그리기마다 한 번만
        const all = cashRows(), have = new Set(all.map(r => String(r.id)));
        OM.csel.forEach(id => { if (!have.has(id)) OM.csel.delete(id); });
        const big = all.length > CBIG_MIN, found = byRank(cashShown()), shown = cashPage(found), s = OM.ship, nIn = s && Array.isArray(s.cash_ids) ? s.cash_ids.length : null;
        $('om-prev-d').textContent = all.length ? `${all.length}줄${nIn != null ? ` · ${OM.shipDate ? md(OM.shipDate) + ' ' : ''}발주에 ${nIn}줄` : ''} · 현금파일과 합쳐서 대조해요` : '';
        $('om-cselbar').hidden = !shown.length;
        { const l = $('om-cselall'), t = l && l.parentNode.lastChild; if (t && t.nodeType === 3) t.textContent = big ? '이 쪽 전체 선택' : '전체 선택'; }   // #900 2-B 큰 표 = 보이는 쪽만
        cashAllBtn(big, found);
        const pb = $('om-prev-open'); if (pb) pb.textContent = all.length ? `현금 줄 ${all.length}` : '현금 줄';
        const nChk = all.filter(isCheck).length, nWait = all.filter(r => !isCheck(r) && isLater(r)).length, held = $('om-cheld');
        held.hidden = !(nChk || nWait); held.textContent = [nChk ? `확인 안 된 ${nChk}줄은 안 들어가요` : '', nWait ? `날짜 대기 ${nWait}줄은 그날 들어가요` : ''].filter(Boolean).join(' · ');
        if (!OM.list) box.innerHTML = OM.loading ? '<div class="om-skel" aria-hidden="true"></div>' : '';
        else if (!all.length) box.innerHTML = '<p class="om-empty"><b>현금 줄이 없어요</b><span>[주문입력]이나 입력삭제 주소 줄을 넣으면 여기에 쌓여요.</span></p>';
        else if (!shown.length) box.innerHTML = `<p class="om-empty"><b>「${esc(OM.cq.trim())}」 찾는 현금 줄이 없어요</b></p>`;
        else box.innerHTML = `<div class="om-prev-tw"><table class="om-prev-t om-ct${big ? ' dense' : ''}"><thead><tr><th class="ck"><label class="om-ck"><input type="checkbox" id="om-cselall2" data-csall="1" aria-label="${big ? '이 쪽 현금 줄 전체 선택' : '찾은 현금 줄 전체 선택'}"></label></th><th>수취인명</th><th>옵션정보</th><th>수량</th><th>수취인연락처1</th><th>배송지</th><th class="x"><span class="om-sr">지우기</span></th></tr></thead><tbody>${shown.map(cashRowHtml).join('')}</tbody></table></div>${big ? pagerHtml(found.length) : ''}`;
        (big ? shown : all).forEach(r => { if (!addrOkOf(r)) addrQueue(String(r.cells[8] || '').trim()); }); addrFailNote(); cneedSync();   // #900 2-B 큰 표 = 보이는 쪽 줄만 주소 검색   // #880-b 둔 줄은 검색 안 함   // #880 주소 확인 = 캐시에 없는 것만(찾기·체크로 다시 그려도 호출 0)
        cselSync();
    }
    async function onCash(e) {
        if (e.target.closest('label.om-ck, input')) return;   // 고르기 칸 = change 에서
        const pg = e.target.closest('.om-pg-b[data-pg]'); if (pg) { if (!pg.disabled) cashGo(pg.dataset.pg); return; }   // #900 2-B 쪽 넘기기
        const b = e.target.closest('[data-act]'), tr = e.target.closest('tr[data-id]'); if (!tr) return;
        const r = cashRows().find(x => String(x.id) === String(tr.dataset.id)); if (!r) return;
        if (b && b.dataset.act === 'del') { askDel([r], b); return; }
        editOpen(r);   // 줄 어디를 눌러도 고치기 카드(이름 단추 = 자판 길)
    }
    function undoShow(t, fn) { clearTimeout(OM.undoT); OM.undo = fn; $('om-undo-t').textContent = t; $('om-undo').hidden = false; OM.undoT = setTimeout(undoHide, 6000); }
    function undoHide() { clearTimeout(OM.undoT); OM.undo = null; const u = $('om-undo'); if (u) u.hidden = true; }
    function undoRun() { const fn = OM.undo; undoHide(); if (fn) fn(); }

    // ── #859 고른 줄 삭제 → #878 줄 ×·고른 것 [삭제] 모두 화면 안 확인 창 한 번 더(종전 두 번 누르기 대신) · 서버 길 = 줄 × 와 같음(비운 것 30일 · 되살리기 가능)
    function selSync() {
        const memo = memoRows(), n = OM.sel.size, all = $('om-selall'), b = $('om-ldel');
        if (all) { all.checked = !!memo.length && n === memo.length; all.indeterminate = n > 0 && n < memo.length; }
        const sn = $('om-seln'); if (sn) sn.textContent = n ? n + '줄 고름' : '';
        if (b) { b.disabled = !n || OM.delBusy; b.textContent = OM.delBusy ? '지우는 중…' : n ? `삭제 ${n}` : '삭제'; }
    }
    // 오른쪽 지우기 대상 = 지금 찾기에 보이는 줄 가운데 고른 것만(찾기 밖에 고른 줄은 안 지움 · 숫자도 보이는 것만)
    const cashPicked = () => cashShown().filter(r => OM.csel.has(String(r.id)));
    function cselSync() {
        const shown = cashShown(), n = OM.csel.size, nv = cashPicked().length, b = $('om-del');
        const pg = cashBig() ? cashPage(byRank(shown)) : shown, pv = pg === shown ? nv : pg.filter(r => OM.csel.has(String(r.id))).length;   // #900 2-B 큰 표 = 머리 칸은 이 쪽 기준
        ['om-cselall', 'om-cselall2'].forEach(id => { const all = $(id); if (all) { all.checked = !!pg.length && pv === pg.length; all.indeterminate = pv > 0 && pv < pg.length; } });
        const fb = $('om-callfound'); if (fb) fb.textContent = (fb.dataset.head || '') + (shown.length && nv === shown.length ? '풀기' : '고르기');
        const sn = $('om-cseln'); if (sn) sn.textContent = n ? (nv ? nv + '줄 고름' + (nv > pv ? ` · 다른 쪽 ${nv - pv}줄 포함` : '') : '') + (nv < n ? `${nv ? ' · ' : ''}찾기 밖 ${n - nv}줄은 안 지워요` : '') : '';   // #900 2-B 큰 표 = 다른 쪽에 고른 줄도 지움 대상이라 알림(작은 표는 pv = nv 라 글 그대로)
        if (b) { b.disabled = !nv || OM.delBusy; b.textContent = OM.delBusy ? '지우는 중…' : nv ? `현금 줄 삭제 ${nv}` : '현금 줄 삭제'; }
    }
    function askDel(rows, from) {
        rows = (rows || []).filter(Boolean); if (!rows.length || OM.delBusy) return;
        OM.ask = { rows, from: from || document.activeElement };
        const names = rows.slice(0, 3).map(r => nameOf(r) || (last4(numOf(r)) ? '…' + last4(numOf(r)) : '이름 없는 줄')).join(', ') + (rows.length > 3 ? ` 외 ${rows.length - 3}줄` : '');
        $('om-ask-h').textContent = `${rows.length}줄을 지우면 다음 발주에서 빠져요. 정말 삭제할까요?`;
        $('om-ask-s').textContent = names + ` · 「비운 것${OM.keepDays ? '(' + OM.keepDays + '일)' : ''}」에서 되살릴 수 있어요`;   // #905
        $('om-ask-back').hidden = false; $('om-ask').hidden = false;
        hbPush('omask', () => askClose(false));
        requestAnimationFrame(() => $('om-ask-no').focus({ preventScroll: true }));
    }
    function askClose(hist) {
        const q = OM.ask; if (!q) return; OM.ask = null;
        $('om-ask').hidden = true; $('om-ask-back').hidden = true;
        if (hist) hbDrop('omask');
        const f = q.from; if (f && f.isConnected && !f.disabled) f.focus({ preventScroll: true });
    }
    function askYes() { const q = OM.ask; if (!q) return; askClose(true); delRows(q.rows); }
    async function delRows(rows) {
        const ids = new Set(rows.map(r => String(r.id)));
        document.querySelectorAll('#om-list .om-item, #om-ctw tr[data-id]').forEach(li => { if (ids.has(li.dataset.id)) li.classList.add('going'); });
        OM.delBusy = true; selSync(); cselSync();
        const res = [];   // #900 2-A 고른 줄을 한꺼번에 지우면(500줄 = 동시 500요청) 서버 DB 연결이 꽉 참 → 10개씩 차례로(순서 = 고른 순서 · 결과 자리 그대로)
        for (let i = 0; i < rows.length; i += 10) res.push(...await Promise.all(rows.slice(i, i + 10).map(r => API.remove(r.id))));
        OM.delBusy = false;
        const done = rows.filter((r, i) => res[i].ok), bad = rows.length - done.length;
        done.forEach(r => { OM.sel.delete(String(r.id)); OM.csel.delete(String(r.id)); });
        OM.list = (OM.list || []).filter(r => !done.includes(r));
        renderList();
        if (bad) toast(errText(res.find(x => !x.ok), '지우지 못했어요') + (done.length ? ` · ${done.length}줄은 지웠어요` : ''));
        if (done.length) {
            const t = done.length === 1 ? '지웠어요 · ' + (nameOf(done[0]) || (last4(numOf(done[0])) ? '…' + last4(numOf(done[0])) : '한 줄')) : `${done.length}줄 지웠어요`;
            undoShow(t, async () => { const ys = await Promise.all(done.map(r => API.restore(r.id))); if (ys.some(y => !y.ok)) toast(errText(ys.find(y => !y.ok), '되돌리지 못했어요')); load(); });
        }
        loadShip();
    }

    // ── for-ship = 오른쪽 머리 「M/D 발주에 n줄」 숫자에만 씀(메모 칸 글은 왼쪽 상자 · #879) ─────
    async function loadShip() {
        if (!OM.shipDate) return;
        const res = await API.forShip(OM.shipDate);
        OM.ship = res.ok ? res.body : null; renderPrev();
    }
    function renderPrev() { renderCash(); }
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
            else { [1, 6, 7, 10].forEach(i => { r.cells[i] = telShow(r.cells[i]); }); if (senderTelSame(r)) r.cells[1] = ''; if (c.mode !== 'edit') tailFromNote(r); }   // #856 손님 글의 사이즈·과수 = 미리 고름(처음 값으로 셈)   // #927 B = K(서버가 채운 값) = 빈 칸으로 보임 · 저장 '' = 서버가 다시 K
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
        if (!force && (c.dirty || c.fileN) && !c.confirm) {   // #895 파일로 넣은 줄 = 고친 것으로 셈(닫을 때 묻기)
            c.confirm = true; renderConfirm();
            if (fromHist) setTimeout(() => { if (OM.card === c) hbPush('omcard', () => cardClose(false, true)); }, 0);   // 뒤로가기로 빠진 칸을 다시 쌓는다(아직 닫지 않음) — 다음 틱에: 기록 쪽이 칸을 닫는 고리를 다 돈 뒤(안에서 쌓으면 그 고리가 바로 또 닫음)
            return;
        }
        optClose(false);
        if (c.wait) { const id = c.wait.id; c.wait = null; API.previewDel(id); }   // 정리 중에 닫음 = 그 요청 취소(손님 글 지움)
        OM.card = null;
        if (c.aseq && !c._aseqGo) OM.aseq = null;   // #880-b 이어서 확인 중에 그냥 닫음 = 멈춤
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
    const fieldsOf = r => (r.kind === 'cash' ? CASH_FIELDS : LINE_FIELDS).concat([{ kind: 'shipdate', label: '발송일', hint: '비우면 다음 발주', ph: '예) 10/30' }]);
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
        return `<div class="om-f${blank ? ' blank' : ''}${wide ? ' wide' : ''}${f.kind === 'qty' ? ' qty' : ''}${r.kind === 'cash' ? ' fk-' + (f.kind === 'shipdate' ? 'ship' : f.i) : ''}" data-fwrap="${esc(id)}"><div class="om-f-l"><label for="${id}">${esc(f.label)}${f.hint ? ` <small>${esc(f.hint)}</small>` : ''}</label>${undo}</div>${input}<p class="om-f-w" id="${id}-w">${esc(why)}</p></div>`;
    }
    const sameBtn = (r, ri) => `<button type="button" class="om-btn om-same" data-cact="same" data-ri="${ri}"${String(r.cells[6] || '').trim() ? '' : ' disabled'} title="받는 분 연락처를 그대로 넣어요">수취인과 동일</button>`;
    const footHtml = () => { const n = blankN(); if (OM.card && OM.card.wait) return `<button type="button" class="om-btn" data-cact="cancel">취소</button><button type="button" class="om-btn primary" id="om-card-save" data-cact="save" disabled>정리 중… <small>끝나면 저장할 수 있어요</small></button>`; return `<button type="button" class="om-btn" data-cact="cancel">취소</button><button type="button" class="om-btn primary${saveBlocked() ? ' om-blocked' : ''}" id="om-card-save" data-cact="save"${saveBlocked() ? ' aria-disabled="true"' : ''}>${saveLabel(n)}</button>`; };
    // #868 막힌 저장(입력삭제 받는 분 번호·번호 확인 중) = 회색·흐림 + aria-disabled · 누르면 그대로 안내+초점(disabled 를 안 씀 = 눌러서 이유를 들을 수 있게) · 풀리면 원래 색
    const saveBlocked = () => indivPendAt() >= 0 || indivBadAt() >= 0;
    function saveSync(sv) { if (!sv) return; const b = saveBlocked(); sv.classList.toggle('om-blocked', b); if (b) sv.setAttribute('aria-disabled', 'true'); else sv.removeAttribute('aria-disabled'); }
    const saveLabel = n => indivPendAt() >= 0 ? '번호 확인 중…' : indivBadAt() >= 0 ? '저장 <small>입력삭제 번호를 구매자 번호로 바꿔 주세요</small>' : n ? '저장 <small>빈칸은 「확인」으로 남아요</small>' : (OM.card.mode === 'edit' ? '고친 대로 저장' : '저장');   // #867
    const blankN = () => OM.card ? OM.card.rows.reduce((s, r) => s + blanksOf(r, true).length + (addrBad(r) ? 1 : 0), 0) : 0;   // #850-g 주소 확인 안 됨 = 빈칸 1
    // #900 2-B 줄이 50장 넘는 카드(파일 1,500줄) = 앞에서부터 50장씩 그림 + 「더 보기」 · 위에 「빈칸 n줄 → 첫 빈칸으로」 · 50장 이하 = 종전 그대로
    //   그리는 줄은 늘 앞부분(0 ~ shown) = 줄 번호(ri)와 .om-rowcard 순서가 같음(touched·lkPaint 등 종전 길 그대로) · 안 그린 줄의 칠하기는 칸이 없어 조용히 건너뜀
    const CARD_PAGE = 50;
    const rowBlank = r => !r._new && (blanksOf(r, true).length > 0 || addrBad(r));
    const cardBig = c => !!c && c.rows.length > CARD_PAGE;
    const cardShownN = c => cardBig(c) ? Math.min(c.rows.length, Math.max(CARD_PAGE, c.shown | 0)) : c.rows.length;
    function cardReveal(c, ri) { if (!cardBig(c) || ri < cardShownN(c)) return false; c.shown = Math.ceil((ri + 1) / CARD_PAGE) * CARD_PAGE; renderCard(); return true; }
    function jumpHtml(c) {
        if (!cardBig(c)) return '';
        const n = c.rows.filter(rowBlank).length;
        return `<div class="om-jump${n ? '' : ' ok'}" id="om-jump"><span id="om-jump-t">${n ? `빈칸 있는 줄 ${n.toLocaleString()}개 · 앞에 모아 뒀어요` : `빈칸 있는 줄 없음 · ${c.rows.length.toLocaleString()}줄`}</span><button type="button" class="om-btn sm" data-cact="jumpblank"${n ? '' : ' hidden'}>빈칸 ${n.toLocaleString()}줄 → 첫 빈칸으로</button></div>`;
    }
    function jumpSync() {   // 칸을 고칠 때 숫자만(다시 그리지 않음)
        const c = OM.card, j = $('om-jump'); if (!c || !j) return;
        const n = c.rows.filter(rowBlank).length, t = $('om-jump-t'), b = j.querySelector('[data-cact="jumpblank"]');
        j.classList.toggle('ok', !n); if (t) t.textContent = n ? `빈칸 있는 줄 ${n.toLocaleString()}개 · 앞에 모아 뒀어요` : `빈칸 있는 줄 없음 · ${c.rows.length.toLocaleString()}줄`;
        if (b) { b.hidden = !n; b.textContent = `빈칸 ${n.toLocaleString()}줄 → 첫 빈칸으로`; }
    }
    function jumpBlank() {
        const c = OM.card; if (!c) return; const ri = c.rows.findIndex(rowBlank); if (ri < 0) { jumpSync(); return; }
        cardReveal(c, ri);
        const rc = $('om-card').querySelectorAll('.om-rowcard')[ri]; if (!rc) return;
        const t = rc.querySelector('.om-f.blank input, .om-f.blank textarea, .om-f.blank .om-combo') || rc.querySelector('input, textarea, .om-combo');
        rc.scrollIntoView({ block: 'start' }); if (t) t.focus({ preventScroll: true });
    }
    function cardMore() {
        const c = OM.card; if (!cardBig(c)) return; const from = cardShownN(c);
        c.shown = from + CARD_PAGE; renderCard();
        const rc = $('om-card').querySelectorAll('.om-rowcard')[from], t = rc && rc.querySelector('input, textarea, .om-combo'); if (t) t.focus({ preventScroll: true });
    }
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
        const tags = []; if (c.rows.some(r => r.kind === 'cash' && !r.indiv)) tags.push('<span class="om-pill k-cash">주문입력</span>'); if (c.rows.some(r => r.kind === 'cash' && r.indiv)) tags.push('<span class="om-pill k-indiv">입력삭제 주소 줄</span>');   // indiv = 입력삭제 주문의 주소 줄(「!」 없음 · 서버가 정함)
        { const sv = c.rows.filter(r => r.kind === 'cash' && r.service).length; if (sv) tags.push(`<span class="om-pill k-svc">서비스 ${sv}줄</span>`); }   // #900 1-C
        const d = c.rows.map(r => r.ship_date).filter(Boolean)[0]; if (d) tags.push(`<span class="om-pill k-later">${esc(mdw(d))} 발송</span>`);
        const srcLabel = /^sms/.test(c.source || '') ? '문자 대화에서 가져옴' + (c.from && c.from.phone ? ' · ' + esc(c.from.phone) : '') : '붙여 넣은 글';
        const ask = '';   // #853 「손님께 물어볼 문자 초안」 칸 안 그림(서버 sms_draft 는 받아 둠 · askText 는 남김)
        card.innerHTML = `
          <header class="om-card-h">
            <button type="button" class="om-back" data-cact="cancel" aria-label="닫기"><span aria-hidden="true">×</span></button>
            <h3 id="om-card-t">${c.mode === 'edit' ? '메모 고치기' : c.cash ? '주문 입력' : '정리 결과 확인'}${c.aseq ? ` <small class="om-aseq">주소 확인 ${c.aseq.at}/${c.aseq.n}</small>` : ''}</h3>
            <button type="button" class="om-btn sm om-reset" data-cact="reset"${c.dirty ? '' : ' hidden'}>${ICON_UNDO}처음으로</button>
            <span class="om-hpill${n ? '' : ' ok'}" id="om-card-n">${n ? '빈칸 ' + n : '빈칸 없음'}</span>
          </header>
          <div class="om-card-b">
            ${c.raw ? `<figure class="om-quote"><figcaption>${srcLabel}</figcaption><blockquote>${esc(c.raw)}</blockquote></figure>` : ''}
            ${c.wait ? `<div class="om-aiband" role="status" aria-live="polite"><i class="om-aiband-dot" aria-hidden="true"></i><b>창구가 남은 글을 정리 중이에요 · ${c.wait.sec}초쯤 걸려요</b><span class="om-aiband-sub">${c.rows.length ? '규칙으로 읽은 줄은 아래에 먼저 · ' : ''}<span id="om-wait-sec">${Math.floor((Date.now() - c.wait.start) / 1000)}</span>초</span><button type="button" class="om-btn sm" data-cact="stopwait">그만 기다리기</button></div>` : ''}
            ${!c.wait && c.deskNote ? `<div class="om-aiband off" role="status"><b>${esc(c.deskNote)}</b></div>` : ''}
            ${cashBarHtml(c)}${jumpHtml(c)}
            ${tags.length ? `<div class="om-card-tags">${tags.join('')}</div>` : ''}
            ${pairHtml(c)}
            ${(cardBig(c) ? c.rows.slice(0, cardShownN(c)) : c.rows).map((r, ri) => `
              <section class="om-rowcard" aria-labelledby="om-rc-${ri}">
                <h4 id="om-rc-${ri}"${c.rows.length > 1 ? '' : ' class="om-sr"'}>${r.kind === 'cash' ? '현금 줄' : '메모 칸 줄'}${c.rows.length > 1 ? ' ' + (ri + 1) : ''}${c.mode === 'new' && c.rows.length > 1 ? `<button type="button" class="om-x sm" data-cact="droprow" data-ri="${ri}" aria-label="이 줄 빼기">${ICON_X}</button>` : ''}</h4>
                ${whyExtra(r).length ? `<p class="om-why">${esc(whyExtra(r).join(' · '))}</p>` : ''}
                ${r.kind === 'cash' && r._fromLine ? `<div class="om-f wide om-f-plat"><div class="om-f-l"><label>판매처</label></div>${platSeg(ri, CASH_PLAT)}<p class="om-f-w">현금 손님 칸으로 바꿨어요 · 다른 판매처를 누르면 메모 줄로 돌아가요</p></div>` : ''}
                <div class="om-grid${r.kind === 'cash' ? ' cash' : ''}">${fieldsOf(r).filter(f => !f.more).map(f => fieldHtml(ri, r, f)).join('')}</div>
                ${indRowHtml(c, r, ri)}${svcRowHtml(c, r, ri)}
                ${r.kind === 'cash' && r.indiv ? `<p class="om-indiv${indivWarn(c) ? ' warn' : ''}" role="note">${esc(indivNote(c))}</p>` : ''}
                ${r.kind === 'cash' ? `<details class="om-more"${senderShow(r.cells[0]) || r.cells[12] || senderTelOwn(r) ? ' open' : ''}><summary>보내는이 변경(클릭)</summary><div class="om-grid cash-more">${CASH_FIELDS.filter(f => f.more).map(f => fieldHtml(ri, r, f)).join('')}</div></details>` : ''}
                ${r.kind === 'line' && r.line ? `<p class="om-linepre"><span>메모 칸에 들어가는 글</span><code>${esc(lineView(r.line))}</code></p>` : ''}
              </section>`).join('')}
            ${cardBig(c) && cardShownN(c) < c.rows.length ? `<button type="button" class="om-btn om-cmore" data-cact="morerows">줄 ${Math.min(CARD_PAGE, c.rows.length - cardShownN(c))}개 더 보기 <small>${cardShownN(c).toLocaleString()} / ${c.rows.length.toLocaleString()}줄</small></button>` : ''}
            ${c.leftover ? `<div class="om-left-over"><b>정리 못 한 글</b><p>${esc(c.leftover)}</p><p class="om-addlink">못 읽은 글이 있어요 · <button type="button" class="om-link" data-cact="add" data-k="line">줄 추가</button></p></div>` : (!c.rows.length && !c.wait ? `<div class="om-left-over"><b>정리된 줄이 없어요</b><p class="om-addlink">판매처를 골라 직접 넣어 주세요 · <button type="button" class="om-link" data-cact="add" data-k="line">줄 추가</button></p></div>` : '')}
            ${ask ? `<div class="om-ask"><b>손님께 물어볼 문자 초안</b><p id="om-ask-t">${esc(ask)}</p><div class="om-acts"><button type="button" class="om-btn sm" data-cact="copy">복사</button>${c.from && c.from.threadId ? '<button type="button" class="om-btn sm" data-cact="toreply">답 칸에 넣기</button>' : ''}<span>보내기는 직접 · 자동으로 안 나가요</span></div></div>` : ''}
          </div>
          <footer class="om-card-f">${c.confirm ? '' : footHtml()}</footer>
          <p class="om-card-note">${c.mode === 'edit' ? '저장하면 이 줄만 바뀌어요 · 서버가 다시 검사해요.' : '저장 전엔 아무것도 안 남아요 · 저장한 뒤에도 목록에서 고치거나 지울 수 있어요.'}</p>`;
        if (c.confirm) renderConfirm();
        if (!card._bound) { card._bound = true; card.addEventListener('click', onCard); card.addEventListener('input', onCardInput); card.addEventListener('focusout', onCardLeave); card.addEventListener('change', onCardChange); card.addEventListener('keydown', onCardKey); }
        const nb = card.querySelector('.om-card-b'); if (nb && sc) nb.scrollTop = sc;
    }
    // 입력 중엔 다시 그리지 않는다(초점·자판 유지) — 빨강 풀기 · ↺ 보이기 · 머리 숫자 · 저장 단추만
    function onCardInput(e) {
        const t = e.target, ri = t.dataset ? Number(t.dataset.ri) : NaN;
        if (t && t.id === 'om-ind-key' && OM.card && OM.card.ind) { OM.card.ind.draft = t.value; return; }   // #895 주문자 번호 = 치는 동안은 그대로 두고 떠날 때·Enter 때 줄에 넣음(#857)
        if (!OM.card || isNaN(ri)) return;
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
        if (r.kind === 'cash' && f.i === 10) r._k10typed = true;   // #895 사람이 친 구매자 번호 = 「입력삭제 주소예요」가 안 덮음
        if (r.kind === 'cash' && f.i === 6) { const sb = $('om-card').querySelector(`.om-same[data-ri="${ri}"]`); if (sb) sb.disabled = !String(t.value).trim(); }
    }
    function onCardLeave(e) {   // #862 보내는 분 칸을 떠날 때 「드림」(치는 중엔 안 바꿈)
        const t = e.target;
        if (t && t.id === 'om-ind-key') { indCommit(t); return; }   // #895
        if (!t || !t.dataset || !t.dataset.fs || !OM.card) return;
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
        const n = blankN(), pill = $('om-card-n'); if (pill) { pill.textContent = n ? '빈칸 ' + n : '빈칸 없음'; pill.classList.toggle('ok', !n); } jumpSync();
        const sv = $('om-card-save'); if (sv && !c.wait) { sv.innerHTML = saveLabel(n); saveSync(sv); }
    }
    // #850-a 입력삭제 주소 줄(indiv) 안내 — 짝인 「입력o삭제x」 메모 줄이 카드에서 빠지면(× · 할 일 칸 비움) 저장 때 서버가 현금 손님(「!」)으로 다시 정한다
    //   판정 = 서버 order-memo.js 의 INDIV 식 · isIndivLine 과 같게(「입력o삭제x」·「입력0삭제x」·「입력삭제」·「개별발송」 + 번호 8자리 이상)
    //   고치기(edit) 카드는 줄 하나만 열리므로 짝 줄이 카드에 없는 게 정상 → 주의 글 없이 「입력삭제 주문의 주소 줄이에요」만
    const INDIV_RE = /입력\s*[oO○0]\s*[·,]?\s*삭제\s*[xX×]|입력\s*삭제|개별\s*발송/i;
    const hasIndivLine = c => c.rows.some(x => x.kind === 'line' && INDIV_RE.test(String(x.note || '') + ' ' + String(x.line || '')) && digits(x.key).length >= 8);
    const indivWarn = c => c.mode !== 'edit' && !hasIndivLine(c);
    const indivNote = c => c.mode === 'edit' ? '입력삭제 주문의 주소 줄이에요' : hasIndivLine(c) ? '입력삭제 줄을 지우면 이 주소는 현금 손님이 돼요' : '입력삭제 줄이 빠졌어요 — 저장하면 이 주소는 현금 손님(「!」)으로 들어가요';
    // ── #874(대표 10/27) 입력삭제 번호 ↔ 현금(「!」) 줄 짝짓기 = 묻고 → 사람이 누를 때만(자동 없음 · 안 누르면 종전과 같음)
    //   ① 같은 카드의 현금 줄(아직 짝 안 됨) = 줄마다 고르기(기본 안 고름) + 번호 고르기(입력삭제 줄이 둘 이상) → [주소 줄로 짝짓기] = K(구매자 연락처) = 그 번호 → 저장 때 서버 markIndiv 가 짝
    //   ② 메모함에 이미 저장된 현금 줄(K·B 번호 = 그 번호) = [바꾸기] 고르면 저장 뒤 POST /api/order-memo/pair(서버가 그 입력삭제 줄 묶음으로 옮김 · 되돌리기 6초)
    const pairKeys = c => { const m = new Map(); (c && c.mode !== 'edit' ? c.rows : []).forEach(x => { if (x.kind === 'line' && !x._new && INDIV_RE.test(String(x.note || '') + ' ' + String(x.line || '')) && digits(x.key).length >= 8 && !m.has(digits(x.key))) m.set(digits(x.key), telShow(x.key)); }); return [...m].map(([d, show]) => ({ d, show })); };
    const indKeyOk = c => !!(c && c.ind && c.ind.on && digits(c.ind.key).length >= 9);   // #895 주문 입력 카드 「입력삭제 주소예요」 켜고 번호(9자리↑)를 넣었나 · pairHtml 이 씀(verify-874 가 이 구간을 떼어 씀 = 여기 둠)
    const pair1Rows = c => c.rows.map((r, ri) => ({ r, ri })).filter(x => x.r.kind === 'cash' && !x.r.indiv && !x.r._new && !x.r.service);
    const savedCashOf = d => (OM.list || []).filter(r => r.kind === 'cash' && r.state === 'open' && !r.indiv && !r.service && r.id != null && [r.cells[10], r.cells[1]].map(digits).includes(d));
    //   ③(대표 10/27 · 순서 반대) 입력삭제 줄은 먼저 저장 · 주소 줄은 나중 다른 묶음 = 주소 글엔 구매자 번호가 없어(AI 가 K 에 받는 분 번호) 번호로 못 찾음
    //     → 메모함에 「아직 주소 줄이 없는 열린 입력삭제 줄」이 있으면 ①과 같은 묻기에 그 번호도 넣음(saved) · 고르면 저장 뒤 POST pair 로 그 줄 묶음에 짝
    //     #875(대표 10/27) 오늘(KST) 저장한 입력삭제 줄만 — 어제 이전 줄은 안 물음(묶음 created_at = UTC ISO → +9시간 날짜 · todayStr 와 같은 KST)
    const kstDay = v => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t + 9 * 3600e3).toISOString().slice(0, 10) : ''; };
    const savedIndivKeys = () => { const L = OM.list || [], m = new Map(), today = todayStr(); L.forEach(x => { const d = digits(x.key); if (x.kind !== 'line' || x.state !== 'open' || d.length < 8 || m.has(d) || kstDay(x.entry && x.entry.created_at) !== today || !INDIV_RE.test(String(x.note || '') + ' ' + String(x.line || ''))) return; if (L.some(y => y.kind === 'cash' && y.state === 'open' && y.indiv && [y.cells[10], y.cells[1]].map(digits).includes(d))) return; m.set(d, telShow(x.key)); }); return [...m].map(([d, show]) => ({ d, show, saved: true })); };
    const pair1Keys = c => { const own = pairKeys(c); return c && c.mode !== 'edit' ? own.concat(savedIndivKeys().filter(k => !own.some(o => o.d === k.d))) : []; };
    const pairWho = r => [nameOf(r), last4(r.cells[6]) ? '…' + last4(r.cells[6]) : '', String(r.cells[8] || '').split(/\s+/).slice(0, 3).join(' ')].filter(Boolean).join(' · ');
    // #900 1-H(대표 10/27) 짝 묻기마다 같은 체크 목록 — 줄마다 체크 · 기본 전부 · 체크한 줄만 입력삭제 짝 · 안 한 줄 = 현금 그대로
    //   머리 = 「n줄 중 m줄 · m박스」 · 맨 위 「전부」 칸 · 줄 글 = 받는 분 · 번호 끝 4 · 주소 앞 3낱말 · 품목 · 박스
    const qtyOf = r => parseInt(r && r.cells && r.cells[5], 10) || 0;
    const pairWhoQ = r => [pairWho(r), String(r.cells[4] || '').split(/[:：]/).pop().replace(/\s+[^\s]*로!$/, '').trim(), qtyOf(r) ? qtyOf(r) + '박스' : ''].filter(Boolean).join(' · ');
    function chkHtml(grp, k, items, sel) {
        const on = items.filter(x => sel.has(x.v)), all = on.length === items.length;
        return `<p class="om-pair-n">${items.length}줄 중 <b>${on.length}줄</b> · ${on.reduce((t, x) => t + qtyOf(x.r), 0)}박스</p>
                <ul class="om-pair-l"><li class="om-pair-all"><label><input type="checkbox" data-cact="chkall" data-g="${grp}" data-k="${esc(k)}"${all ? ' checked' : ''}> <span>전부</span></label></li>${items.map(x => `<li><label><input type="checkbox" data-cact="chk" data-g="${grp}" data-k="${esc(k)}" data-v="${esc(x.v)}"${sel.has(x.v) ? ' checked' : ''}> <span>${esc(pairWhoQ(x.r) || '현금 줄')}</span></label></li>`).join('')}</ul>`;
    }
    // 고른 값 Set — 새로 보이는 줄은 처음 한 번 체크해 둠(기본 전부) · seen = 이미 본 줄(사람이 끈 줄은 다시 안 켬)
    function chkSel(c, grp, k, vals) {
        const S = c.chk || (c.chk = {}), id = grp + ':' + k, o = S[id] || (S[id] = { sel: new Set(), seen: new Set() });
        vals.forEach(v => { if (!o.seen.has(v)) { o.seen.add(v); o.sel.add(v); } });
        return o.sel;
    }
    const chkGot = (c, grp, k) => { const o = c.chk && c.chk[grp + ':' + k]; return o ? o.sel : null; };
    const p2Rows = (c, d) => { const sel = chkGot(c, 'p2', d), all = savedCashOf(d); return sel ? all.filter(r => sel.has(String(r.id))) : all; };   // ② 체크한 줄(체크 목록을 안 그렸으면 = 전부 · 종전)
    function pairHtml(c) {
        const keys = pair1Keys(c); if (!keys.length) return '';
        let h = '';
        const p1 = c.pair1 || (c.pair1 = { sel: new Set(), key: keys.length === 1 ? keys[0].d : null, hide: false });
        if (p1.key && !keys.some(k => k.d === p1.key)) p1.key = null;
        if (!p1.key && keys.length === 1) p1.key = keys[0].d;
        const rows1 = pair1Rows(c);
        { const seen = p1.seen || (p1.seen = new WeakSet()); rows1.forEach(x => { if (!seen.has(x.r)) { seen.add(x.r); p1.sel.add(x.r); } }); }   // #900 1-H 기본 = 전부 체크(종전 안 고름) · 열쇠 = 줄 객체(파일 다시 넣기·앞줄 빠짐·줄 빼기로 번호가 밀려도 그 줄 그대로)
        const on1 = rows1.filter(x => p1.sel.has(x.r)).length;
        if (rows1.length && !p1.hide && !indKeyOk(c)) {   // #895 「입력삭제 주소예요」를 켜고 번호를 넣었으면 = 그쪽이 짝(같은 걸 두 번 안 물음)
            const kTxt = keys.length === 1 ? keys[0].show + (keys[0].saved ? ' 건(메모함)' : '') : '번호(아래에서 고르기)';
            h += `<div class="om-pair" role="group" aria-labelledby="om-pair1-t"><b id="om-pair1-t">이 현금 줄 ${rows1.length}개가 입력삭제 ${esc(kTxt)} 주소 줄인가요?</b>
                <p class="om-pair-s">맞는 줄만 체크하세요 · 체크 안 한 줄은 현금 그대로예요</p>
                ${keys.length > 1 ? `<div class="om-seg" role="radiogroup" aria-label="입력삭제 번호">${keys.map(k => `<button type="button" role="radio" class="om-seg-b" data-cact="p1key" data-k="${esc(k.d)}" aria-checked="${p1.key === k.d ? 'true' : 'false'}">${esc(k.show)}${k.saved ? ' <small>메모함</small>' : ''}</button>`).join('')}</div>` : ''}
                ${chkHtml('p1', 'card', rows1.map(x => ({ v: String(x.ri), r: x.r })), new Set(rows1.filter(x => p1.sel.has(x.r)).map(x => String(x.ri))))}
                <div class="om-acts"><button type="button" class="om-btn sm primary" data-cact="p1go"${on1 && p1.key ? '' : ' disabled'}>주소 줄로 짝짓기${on1 ? ' <small>' + on1 + '줄</small>' : ''}</button><button type="button" class="om-btn sm" data-cact="p1no">현금 그대로</button></div></div>`;
        }
        const p2 = c.pair2 || (c.pair2 = {});
        pairKeys(c).forEach(k => {   // ② = 이 카드의 입력삭제 줄 번호만
            const saved = savedCashOf(k.d); if (!saved.length) { h += hintSlot(c, k); return; } if (p2[k.d] === 'no') return;   // #895 ④ 번호로 짝 줄이 없으면 = 후보 묶음 고르기
            const sel2 = chkSel(c, 'p2', k.d, saved.map(r => String(r.id))), on2 = saved.filter(r => sel2.has(String(r.id))).length;   // #900 1-H
            h += p2[k.d] === 'yes'
                ? `<div class="om-pair ok" role="status"><b>저장하면 메모함 현금 줄 ${on2}개${on2 < saved.length ? `(${saved.length}개 중)` : ''}를 입력삭제 ${esc(k.show)} 주소 줄로 바꿔요</b><div class="om-acts"><button type="button" class="om-btn sm" data-cact="p2undo" data-k="${esc(k.d)}">안 바꿀래요</button></div></div>`
                : `<div class="om-pair" role="group"><b>메모함에 이 번호(${esc(k.show)}) 현금 줄 ${saved.length}개가 있어요 · 입력삭제 주소 줄로 바꿀까요?</b>
                    ${chkHtml('p2', k.d, saved.map(r => ({ v: String(r.id), r })), sel2)}
                    <div class="om-acts"><button type="button" class="om-btn sm primary" data-cact="p2yes" data-k="${esc(k.d)}"${on2 ? '' : ' disabled'}>바꾸기</button><button type="button" class="om-btn sm" data-cact="p2no" data-k="${esc(k.d)}">현금 그대로</button></div></div>`;
        });
        return h;
    }
    function pair1Go(c) {
        const p1 = c.pair1, k = p1 && pair1Keys(c).find(x => x.d === p1.key); if (!p1 || !c.rows.some(r => p1.sel.has(r))) return;
        if (!k) { p1.key = null; toast('입력삭제 번호가 바뀌었어요 · 번호를 다시 확인하고 골라 주세요'); renderCard(); return; }   // #875 카드에서 번호를 고친 뒤 누름 = 조용히 안 됨 막기
        let n = 0;
        c.rows.forEach(r => { if (!p1.sel.has(r) || r.kind !== 'cash' || r.indiv) return; const oldK = digits(r.cells[10]); if (!digits(r.cells[1]) || digits(r.cells[1]) === oldK) r.cells[1] = k.show; r.cells[10] = k.show; r.cells[0] = String(r.cells[0] || '').replace(/[!！]/g, '').replace(/\s+/g, ' ').trim(); r.indiv = true; if (k.saved) r._pairSaved = k.show; n++; });   // ③ 메모함 입력삭제 줄 = 저장 뒤 POST pair(같은 묶음이 아니라 서버 markIndiv 가 못 짝지음)
        p1.sel.clear(); c.dirty = true; renderCard();
        toast(`${n}줄을 입력삭제 ${k.show} 주소 줄로 짝지었어요 · 저장해야 들어가요`);
    }
    // 저장 뒤 ②(고른 번호만) — 실패해도 저장은 그대로(지금과 같은 상태 = 현금 줄)
    const PAIR_CHUNK = 60;
    // #899 5-b 저장 때 「똑같은 줄은 빼고 저장」으로 뺀 입력삭제 줄(메모함에 같은 줄이 이미 있음) — 그 묶음에 입력삭제 줄이 없어져 서버가 주소 줄로 못 짝지음
    //   → 같은 카드의 현금 줄 가운데 K·B 번호가 그 번호인 줄(입력삭제 줄이 남았으면 서버 markIndiv 가 짝지었을 줄과 같은 집합)에 _pairSaved 표식 → 저장 뒤 pair2Run 이 메모함 그 줄과 짝
    function dupPairMark(rows, sameIdx) {
        const keys = new Map(); sameIdx.forEach(i => { const r = rows[i]; if (r && r.kind === 'line' && INDIV_RE.test(String(r.note || '') + ' ' + String(r.line || '')) && digits(r.key).length >= 8) keys.set(digits(r.key), telShow(r.key)); });
        if (keys.size) rows.forEach((r, i) => { if (sameIdx.has(i) || r.kind !== 'cash' || r._pairSaved) return; const d = [r.cells[10], r.cells[1]].map(digits).find(x => keys.has(x)); if (d) r._pairSaved = keys.get(d); });
    }
    async function pair2Run(c, sent, saved) {
        const jobs = new Map();   // 번호 → { key, ids }
        Object.keys(c.pair2 || {}).filter(d => c.pair2[d] === 'yes').forEach(d => { const ids = p2Rows(c, d).map(r => r.id), k = pairKeys(c).find(x => x.d === d); if (ids.length) jobs.set(d, { key: k ? k.show : d, ids }); });
        (sent || []).forEach((r, i) => { const sv = saved && saved[i]; if (!r._pairSaved || r.service || !sv || sv.id == null || sv.kind !== 'cash') return; const d = digits(r._pairSaved), j = jobs.get(d) || { key: r._pairSaved, ids: [] }; j.ids.push(sv.id); jobs.set(d, j); });   // ③ 방금 저장한 줄(보낸 순서 = 받은 순서)
        const picks = hintPicks(c);   // #895 ④ 사람이 고른 후보 묶음 = pick(번호 대조 없이)
        if (!jobs.size && !picks.length) return;
        let n = 0, sentN = 0; const undo = [];   // n = 서버가 바꾼 줄 · sentN = 보내서 처리 끝난 줄(실패 안내의 「나머지」 = 아직 안 보낸 줄 · aa 점검 #899)
        // #899 서버 /pair 는 한 번에 60줄까지(order-memo.js ids.slice(0, 60)) → 60줄씩 차례로 · 실패하면 거기서 멈춤(같은 줄 두 번 안 감 · 된 줄은 되돌리기에 남음)
        const all = [...jobs.values()].concat(picks), total = all.reduce((t, j) => t + j.ids.length, 0);
        outer: for (const j of all) {
            for (let i = 0; i < j.ids.length; i += PAIR_CHUNK) {
                const ids = j.ids.slice(i, i + PAIR_CHUNK), res = await API.pair(j.pick ? { key: j.key, ids, pick: true } : { key: j.key, ids });
                if (!res.ok) { toast(errText(res, '현금 줄을 주소 줄로 못 바꿨어요') + (sentN ? ` · ${n}줄까지 바꿨고 나머지 ${total - sentN}줄은 현금 그대로예요` : ' · 현금 줄 그대로예요')); break outer; }
                n += Number(res.body && res.body.n) || 0; sentN += ids.length; (res.body && Array.isArray(res.body.undo) ? res.body.undo : []).forEach(u => undo.push(u));
            }
        }
        if (n) undoShow(`현금 줄 ${n}개를 입력삭제 주소 줄로 바꿨어요`, async () => {   // 되돌리기도 서버가 한 번에 60줄까지 = 나눠 보냄
            let back = 0; for (let i = 0; i < undo.length; i += PAIR_CHUNK) { const y = await API.pair({ undo: true, rows: undo.slice(i, i + PAIR_CHUNK) }); if (!y.ok) { toast(errText(y, '되돌리지 못했어요') + (back ? ` · ${back}줄은 되돌렸어요` : '')); load(); return; } back += Number(y.body && y.body.n) || 0; }
            toast('현금 줄로 되돌렸어요'); load();
        });
    }
    // ── #895 ④(#894 F4 · claude-69 계약) 입력삭제 줄 카드에서 그 번호로 짝 될 현금 줄이 없으면 = GET pair-hint → 품목별 박스가 그 주문과 딱 같은 현금 줄 묶음 후보
    //   여럿이면 고르기(기본 안 고름) → [이 묶음으로 바꾸기] = 저장 뒤 POST pair { key, ids, pick: true } · 옛 서버(404)·실패 = 안 보임(종전 그대로)
    //   불러오는 동안·후보 0 = 아무것도 안 그림(종전 화면 그대로 · verify-874) · 후보가 오면 다시 그림 — 카드 칸을 치는 중이면 그 칸을 떠난 뒤(#857)
    function hintSlot(c, k) {
        const H = c.hint || (c.hint = {}); if (!H[k.d]) { H[k.d] = { st: 'busy' }; hintLoad(c, k); }
        const h = hintHtml(c, k); return h ? `<div class="om-hintslot" data-hk="${esc(k.d)}">${h}</div>` : '';
    }
    async function hintLoad(c, k) {
        const res = API.pairHint ? await API.pairHint(k.show) : { ok: false }, b = res.ok && res.body ? res.body : null;   // 옛 짝 API 묶음(검증 가짜 등) = 안 부름
        c.hint[k.d] = { st: 'done', groups: b && Array.isArray(b.groups) ? b.groups.filter(g => g && Array.isArray(g.ids) && g.ids.length).slice(0, 5) : [], need: b && Array.isArray(b.need) ? b.need : [] };
        if (OM.card !== c || !c.hint[k.d].groups.length) return;
        const typing = () => { const ae = document.activeElement; return !!(ae && $('om-card').contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.type !== 'checkbox' && ae.type !== 'radio'); };
        const go = () => { if (OM.card !== c) return; if (typing()) { setTimeout(go, 400); return; } renderCard(); };   // 치는 칸이 있으면 0.4초마다 다시 봄(칸을 떠나고 누르는 단추가 끝난 뒤 그림)
        go();
    }
    const hintWhen = iso => { const t = Date.parse(String(iso || '')); if (!Number.isFinite(t)) return ''; const d = new Date(t + 9 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} 저장`; };
    const hintItems = items => (Array.isArray(items) ? items : []).map(it => `${shortOpt(optBase(it.opt))} ${Number(it.qty) || 0}`).join(' · ');
    function hintHtml(c, k) {
        const x = c.hint && c.hint[k.d], sel = (c.pair3 || {})[k.d];
        if (!x || x.st !== 'done' || !x.groups.length || sel === 'no') return '';
        const g0 = sel && x.groups.find(g => String(g.entry_id) === sel);
        if (g0) {   // #900 1-H 고른 묶음 = 줄마다 체크(기본 전부 · 메모함 목록에 다 있을 때만 줄 글 · 아니면 개수만)
            const rs = g0.ids.map(id => (OM.list || []).find(r => String(r.id) === String(id))).filter(Boolean), sel3 = chkSel(c, 'p3', k.d, g0.ids.map(String)), on3 = g0.ids.filter(id => sel3.has(String(id))).length;
            return `<div class="om-pair ok" role="group"><b>저장하면 메모함 현금 줄 ${on3}개${on3 < g0.ids.length ? `(${g0.ids.length}개 중)` : ''}(${esc(hintWhen(g0.created_at))})를 입력삭제 ${esc(k.show)} 주소 줄로 바꿔요</b>${rs.length === g0.ids.length ? chkHtml('p3', k.d, rs.map(r => ({ v: String(r.id), r })), sel3) : ''}<div class="om-acts"><button type="button" class="om-btn sm" data-cact="h3undo" data-k="${esc(k.d)}">안 바꿀래요</button></div></div>`;
        }
        const pk = (c.pick3 || {})[k.d];
        return `<div class="om-pair" role="group"><b>입력삭제 ${esc(k.show)} 주문과 박스 수가 같은 현금 줄 묶음이 있어요 · 이 주문의 주소 줄인가요?</b>
                ${x.need.length ? `<p class="om-pair-s">남은 주문 = ${esc(hintItems(x.need))}</p>` : ''}
                <ul class="om-pair-l">${x.groups.map(g => `<li><label><input type="radio" name="om-h3-${esc(k.d)}" data-cact="h3pick" data-k="${esc(k.d)}" data-g="${esc(String(g.entry_id))}"${String(pk) === String(g.entry_id) ? ' checked' : ''}> <span>${esc(hintWhen(g.created_at))} · ${Number(g.boxes) || g.ids.length}박스 · ${esc(hintItems(g.items))}</span></label></li>`).join('')}</ul>
                <div class="om-acts"><button type="button" class="om-btn sm primary" data-cact="h3yes" data-k="${esc(k.d)}"${pk ? '' : ' disabled'}>이 묶음으로 바꾸기</button><button type="button" class="om-btn sm" data-cact="h3no" data-k="${esc(k.d)}">현금 그대로</button></div></div>`;
    }
    const hintPicks = c => Object.keys(c.pair3 || {}).map(d => { const v = c.pair3[d]; if (!v || v === 'no') return null; const x = c.hint && c.hint[d], g = x && x.groups && x.groups.find(y => String(y.entry_id) === v), k = pairKeys(c).find(y => y.d === d); const sel = chkGot(c, 'p3', d), ids = sel ? g.ids.filter(id => sel.has(String(id))) : g.ids.slice(); return g && k && ids.length ? { key: k.show, ids, pick: true } : null; }).filter(Boolean);   // #900 1-H 체크한 줄만
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
        c.dirty = true; if (!cardReveal(c, ri)) renderCard(); if (c.rows[ri].kind === 'line') lkRun(ri);   // #900 2-B 안 그린 줄이면 그 쪽까지 펼침
        const fx = $('om-card').querySelectorAll('.om-rowcard')[ri]; const t2 = fx && (fx.querySelector('.om-f.blank input, .om-f.blank textarea, .om-f.blank .om-combo') || fx.querySelector('.om-seg-b[aria-checked="true"]')); if (t2) t2.focus({ preventScroll: true });
    }
    const stripTmp = r => { const o = Object.assign({}, r); delete o._dateBad; delete o._new; delete o._lk; delete o._lkSeq; delete o._lkT; delete o.checked; delete o._fromLine; delete o._addr; delete o._addrSeq; delete o._addrT; delete o._ik; delete o._ik0; delete o._ib0; delete o._k10typed; delete o._pairSaved; delete o._svcTouched; delete o._noIndiv; return o; };   // checked = 찾기가 저절로 채움(고친 것으로 안 셈)
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
        if (x.as === 'recv') { const b = indivBuyer(r); return `수취인 번호로 넣으셨네요 · ${x.plat} · ${body}${x.addr ? ' · 주소 ' + x.addr : ''} · 맞나요?${b ? ` ${telShow(b)}(구매자 연락처) · 맞으면 구매자 연락처로 수정해 주세요` : ''}`; }   // 이름·주소 = 새 표(#850-e)에 있을 때만 · 없으면 성 한 글자 · #884 구매자 번호 하나일 때만 덧붙임(단추 없음 · 직접 수정 · 저장 안 막음)
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
    //   #871 우리 꼴 = 「도로명 본 주소, 세부주소」(세부가 이미 쉼표로 시작해도 한 번만)
    const addrText = (j, detail) => { const d = String(detail || '').replace(/^[,\s]+/, '').trim(); return String(j.roadAddrPart1 || '').trim() + (d ? ', ' + d : ''); };
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
        const n = blankN(), pill = $('om-card-n'); if (pill) { pill.textContent = n ? '빈칸 ' + n : '빈칸 없음'; pill.classList.toggle('ok', !n); } jumpSync();
    }
    // #880 주소 확인 한 곳(카드·표 같은 길) · 결과는 화면 메모리 캐시(주소 글 → 결과 · 페이지를 새로 열기 전까지) · 검색 실패만 카드에서 다시 물음
    const ACACHE = new Map(), AKEPT = new Set(), AQ = { q: [], run: 0, draw: new Set() }, AFAIL = new Set(), AF = { n: 0 };   // #880 손질: 검색 실패(fail)는 캐시에 안 둠 · 표는 그리기마다 한 번만 · 연속 실패 3번이면 이 창 동안 표에선 그만 물음
    const acPut = (raw, res) => ACACHE.set(raw, { done: true, res, p: Promise.resolve(res) });
    function addrLookup(raw, fresh) {
        const hit = ACACHE.get(raw); if (hit && !(fresh && hit.done && hit.res.state === 'fail')) return hit.p;
        const h = { done: false, res: null }; ACACHE.set(raw, h);
        h.p = addrSearch(raw).then(res => { h.done = true; h.res = res; if (res.state === 'fail' && ACACHE.get(raw) === h) ACACHE.delete(raw); return res; });
        return h.p;
    }
    async function addrRun(ri) {
        const c = OM.card, r = c && c.rows[ri]; if (!r || r.kind !== 'cash') return;
        const raw = String(r.cells[8] || '').trim(); if (!raw) { r._addr = null; addrPaint(ri); return; }
        const seq = (r._addrSeq = (r._addrSeq || 0) + 1);
        r._addr = { state: 'busy', raw }; addrPaint(ri);
        const R0 = await addrLookup(raw, true);
        const A = Object.assign({}, R0, R0.cands ? { cands: R0.cands.map(x => Object.assign({}, x)) } : {}, (AKEPT.has(raw) || addrOkOf(r)) && R0.state !== 'one' ? { kept: true } : {});   // #880-b 서버에 「이대로 둘게요」 남은 주소 = 경고 없음
        if (OM.card !== c || r._addrSeq !== seq) return;
        const i = c.rows.indexOf(r); if (i < 0) return;
        r._addr = A; addrPaint(i);
        addrPaintTable(raw);
    }
    async function addrSearch(raw) {
        const oo = window.__ooTest, A = { raw, state: 'none' };
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
        return A;
    }
    // 표 = 그릴 때 캐시에 없는 주소만 줄 세움(2개씩 차례로) · 끝나면 그 주소 줄의 알약만 다시 칠함(다시 그리지 않음 · 찾기·체크로 다시 그려도 호출 0)
    function addrQueue(raw) { if (!raw || ACACHE.has(raw) || AQ.q.includes(raw) || AQ.draw.has(raw) || AF.n >= 3) return; AQ.draw.add(raw); AQ.q.push(raw); addrPump(); }
    function addrPump() { while (AQ.run < 2 && AQ.q.length) { const raw = AQ.q.shift(); if (ACACHE.has(raw)) continue; if (AF.n >= 3) { AQ.q.length = 0; break; } AQ.run++; addrLookup(raw).then(res => { if (res && res.state === 'fail') { AFAIL.add(raw); AF.n++; } else { AFAIL.delete(raw); AF.n = 0; } addrPaintTable(raw); }, () => {}).then(() => { AQ.run--; addrPump(); }); } }
    function addrFailNote() {   // 검색 실패 줄 = 알약 대신 표 머리 아래 회색 한 줄
        const el = $('om-cafail'); if (!el) return;
        const n = cashRows().filter(r => { const raw = String(r.cells[8] || '').trim(); return raw && !addrKept(r) && !ACACHE.has(raw) && (AFAIL.has(raw) || AF.n >= 3); }).length;   // 연속 실패로 그만 물은 줄도 셈
        el.hidden = !n; el.textContent = n ? `주소 검색이 안 돼서 ${n}줄은 확인 못 했어요` : '';
    }
    // #880-b 「이대로 둘게요」 = 서버 addr_ok(그때 주소 글 raw 가 지금 주소와 같을 때만 유효 · 주소가 바뀌면 다시 검색) · 옛 서버(addr_ok 칸 없음) = 화면 기억 AKEPT
    const addrOkOf = r => { const raw = String(r.cells[8] || '').trim(); return !!(raw && r.addr_ok && String(r.addr_ok.raw || '').trim() === raw); };
    const addrKept = r => addrOkOf(r) || AKEPT.has(String(r.cells[8] || '').trim());
    function addrNeed(r) {   // 표 「주소 확인 필요」 = 후보 여럿·못 찾음만(확인됨·확인 중·검색 실패·둔 줄·빈 주소 = 아님)
        const raw = String(r.cells[8] || '').trim(); if (!raw || addrKept(r)) return false;
        const h = ACACHE.get(raw); return !!(h && h.done && (h.res.state === 'none' || h.res.state === 'multi'));
    }
    function addrPillOf(r) {
        if (addrOkOf(r)) return `<span class="om-ct-ok" title="${esc([r.addr_ok.by_name, hm(r.addr_ok.at)].filter(Boolean).join(' · '))}">주소 확인함</span>`;
        return addrNeed(r) ? '<span class="om-pill k-addrchk" title="누르면 이 줄 고치기 카드 · [도로명으로 바꾸기]·후보·이대로 둘게요">주소 확인 필요</span>' : '';
    }
    function cneedSync() {   // 표 머리 줄 「주소 확인 필요 n줄」(0 = 안 보임 · 누르면 그 줄들만 보기 ↔ 모두 보기)
        const b = $('om-cneed'); if (!b) return;
        const n = cashRows().filter(addrNeed).length;
        if (!n && OM.cneed) { OM.cneed = false; renderCash(); return; }
        b.hidden = !n; b.setAttribute('aria-pressed', OM.cneed ? 'true' : 'false');
        b.textContent = OM.cneed ? `주소 확인 필요 ${n}줄만 보는 중 · 모두 보기` : `주소 확인 필요 ${n}줄`;
    }
    // 저장된 줄 = 바로 남김 · 아직 저장 안 된 줄(새 카드)·주소를 고친 줄 = 저장 뒤 남김(cardSave)
    async function addrOkSave(id, raw) {
        const res = await API.addrOk(id, { raw });
        if (!res.ok) { if (res.status !== 404) toast(errText(res, '「이대로 둘게요」를 남기지 못했어요 · 이 창에서만 기억해요')); return false; }
        const row = res.body && res.body.row, cur = (OM.list || []).find(x => String(x.id) === String(id));
        if (cur) cur.addr_ok = row && row.addr_ok ? row.addr_ok : { raw, at: new Date().toISOString(), by_name: '' };
        addrPaintTable(raw); return true;
    }
    function addrPaintTable(raw) {
        const box = $('om-ctw'); if (!box) return;
        addrFailNote(); cneedSync();
        box.querySelectorAll('tr[data-id]').forEach(tr => { const r = cashRows().find(x => String(x.id) === tr.dataset.id), ap = tr.querySelector('.om-ct-ap'); if (r && ap && String(r.cells[8] || '').trim() === raw) ap.innerHTML = addrPillOf(r); });
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
        if (a === 'indon') { indToggle(c, b.checked); return; }   // #895
        if (a === 'morerows') { cardMore(); return; }   // #900 2-B
        if (a === 'jumpblank') { jumpBlank(); return; }
        if (a === 'svcrow' && r) { r.service = !!b.checked; r._svcTouched = true; c.dirty = true; renderCard(); return; }   // #900 1-C
        if (a === 'indrow' && r) { r._indOff = !b.checked; if (r._indOff) r.service = false; indApply(c); renderCard(); const back = $('om-card').querySelector('input[data-cact="indrow"][data-ri="' + ri + '"]'); if (back) back.focus({ preventScroll: true }); return; }   // #900 1-H 줄마다 입력삭제 체크 · 다시 그림(그 줄 「서비스」 칸이 생기고 사라짐) · 끈 줄은 서비스도 끔
        if (a === 'h3pick') { (c.pick3 = c.pick3 || {})[b.dataset.k] = b.dataset.g; const go = b.closest('.om-pair').querySelector('[data-cact="h3yes"]'); if (go) go.disabled = false; return; }   // #895 ④
        if (a === 'h3yes') { const g = (c.pick3 || {})[b.dataset.k]; if (!g) return; (c.pair3 = c.pair3 || {})[b.dataset.k] = g; renderCard(); return; }
        if (a === 'h3no') { (c.pair3 = c.pair3 || {})[b.dataset.k] = 'no'; renderCard(); return; }
        if (a === 'h3undo') { if (c.pair3) delete c.pair3[b.dataset.k]; renderCard(); return; }
        if (a === 'file') { const fi = $('om-file'); if (fi) fi.click(); return; }
        if (a === 'chk' || a === 'chkall') {   // #900 1-H 체크 목록(① p1 = 카드 줄 번호 · ② p2·④ p3 = 메모함 줄 id)
            const g = b.dataset.g, k = b.dataset.k, box = b.closest('.om-pair'), vals = [...box.querySelectorAll('input[data-cact="chk"]')].map(x => x.dataset.v);
            const set = g === 'p1' ? (c.pair1 && c.pair1.sel) : chkSel(c, g, k, vals); if (!set) return;
            const put = (v, on) => { const x = g === 'p1' ? c.rows[Number(v)] : v; if (!x) return; if (on) set.add(x); else set.delete(x); };   // p1 = 그 순간 화면 줄 번호 → 줄 객체
            if (a === 'chkall') vals.forEach(v => put(v, b.checked)); else put(b.dataset.v, b.checked);
            renderCard(); const back = $('om-card').querySelector(`.om-pair input[data-cact="${a}"][data-g="${g}"][data-k="${k}"]${a === 'chk' ? `[data-v="${b.dataset.v}"]` : ''}`); if (back) back.focus({ preventScroll: true });
            return;
        }
        if (a === 'p1row') { const p1 = c.pair1; if (!p1 || !r) return; if (b.checked) p1.sel.add(r); else p1.sel.delete(r); const go = $('om-card').querySelector('[data-cact="p1go"]'); if (go) { go.disabled = !(p1.sel.size && p1.key); go.innerHTML = '주소 줄로 짝짓기' + (p1.sel.size ? ' <small>' + p1.sel.size + '줄</small>' : ''); } return; }   // #874
        if (a === 'p1key') { if (c.pair1) c.pair1.key = b.dataset.k; renderCard(); return; }
        if (a === 'p1go') { pair1Go(c); return; }
        if (a === 'p1no') { if (c.pair1) { c.pair1.hide = true; c.pair1.sel.clear(); } renderCard(); return; }
        if (a === 'p2yes' || a === 'p2no' || a === 'p2undo') { c.pair2 = c.pair2 || {}; if (a === 'p2undo') delete c.pair2[b.dataset.k]; else c.pair2[b.dataset.k] = a === 'p2yes' ? 'yes' : 'no'; renderCard(); return; }
        if (a === 'reset') { if (c.pair1) c.pair1.sel.clear(); c.rows = clone(c.orig); c.dirty = false; if (c.ind && c.ind.on) indApply(c); renderCard(); lkAll(); toast('처음 정리한 값으로 돌렸어요'); return; }
        if (a === 'same') {   // #862 받는 분 연락처 → 구매자 연락처(이미 있으면 바꿔 넣음 · 처음 값은 칸 ↺)
            const v = String((r && r.cells[6]) || '').trim(), f = CASH_FIELDS.find(x => x.i === 10); if (!v || !f) return;
            setV(r, f, v); r._k10typed = true; const el = $(fid(ri, f)); if (el) el.value = getV(r, f); touched(ri, f); return;
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
        if (a === 'droprow') { if (c.pair1 && r) c.pair1.sel.delete(r); c.rows.splice(ri, 1); c.orig.splice(ri, 1); c.dirty = true; renderCard(); return; }
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
            if (a === 'addrkeep') {   // #880 표에서도 「주소 확인 필요」 안 띄움 · #880-b 서버에 남김(저장된 줄이고 주소를 안 고쳤으면 바로 · 아니면 저장 뒤)
                A.kept = true; addrPaint(ri);
                if (A.raw) {
                    AKEPT.add(A.raw); r._addrOk = A.raw; addrPaintTable(A.raw);
                    const o = c.orig[ri], same = c.mode === 'edit' && r.id != null && o && String(o.cells[8] || '').trim() === A.raw;
                    if (same && await addrOkSave(r.id, A.raw)) { r.addr_ok = { raw: A.raw }; r._addrOk = null; if (OM.card === c && !c.dirty && aseqGo(c)) { cardClose(true); aseqNext(); } }   // #880-b 이어서 확인 = 남긴 뒤 다음 줄(고친 칸 있으면 [저장] 기다림)
                }
                return;
            }
            const road = b.dataset.v === 'one' ? A.road : (A.cands[Number(b.dataset.v)] || {}).road; if (!road) return;
            setV(r, f, road); const el = $(fid(ri, f)); if (el) el.value = road;
            acPut(road, { raw: road, state: 'one', road, detail: A.detail });   // #880 바꾼 도로명 = 확인됨으로 기억(다시 안 물음)
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
        if (c.pair1 && c.pair1.seen && !indKeyOk(c)) c.rows.forEach(r => { if (r.kind === 'cash') r._noIndiv = c.pair1.seen.has(r) && !c.pair1.sel.has(r) && !r.indiv; });   // #900 1-H ① 묻기에서 체크를 끈 줄 = 같은 묶음에 그 번호 입력삭제 줄이 있어도 서버 markIndiv 가 짝짓지 않게(no_indiv)
        if (!rows.length) { cardClose(true); return; }
        if (c.ind && c.ind.on && !indKeyOk(c)) { toast('주문자(구매자) 번호를 넣거나 「입력삭제 주소예요」를 꺼 주세요'); const k = $('om-ind-key'); if (k) { k.scrollIntoView({ block: 'center' }); k.focus({ preventScroll: true }); } return; }   // #895
        if (indivPendAt() >= 0) { toast('번호 확인 중이에요 · 잠시 뒤 다시 눌러 주세요'); return; }   // #867 손질 ①
        const bad = indivBadAt();   // #867 입력삭제 줄이 받는 분 번호 = 저장 안 함(저장 안 되면 [메모함 적용하기]에도 안 들어감)
        if (bad >= 0) {
            toast('입력삭제는 구매자 번호로 넣어야 송장이 붙어요 · 구매자 번호로 바꾼 뒤 저장해 주세요');
            cardReveal(c, bad); const rc = $('om-card').querySelectorAll('.om-rowcard')[bad], t = rc && (rc.querySelector('.om-lk-fix') || rc.querySelector('#om-f-' + bad + '-key'));
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
                if (d && d.same.size) { skipped = d.same.size; dupPairMark(rows, d.same); rows = rows.filter((r, i) => !d.same.has(i)); }
            } else { skipped = c.dupOk.same.length; dupPairMark(c.dupOk.rows, new Set(c.dupOk.same)); rows = c.dupOk.rows.filter((r, i) => !c.dupOk.same.includes(i)); drop = c.dupOk.drop; }
            if (!rows.length) { cardClose(true); inNote(`이미 같은 줄이 있어요 · 저장하지 않았어요`, 'warn'); if (c.pair2 || c.pair3) { await pair2Run(c); load(); } return; }   // #874 입력삭제 줄이 이미 있어도 고른 ②는 함
        }
        let res;
        if (c.mode === 'edit') res = await API.update(rows[0].id, putBody(rows[0]));
        else res = await saveRows(c, rows);   // #895 60줄 넘으면 나눠 저장
        if (!res.ok && res.part) {   // #895 나눠 저장하다 중간에 실패 = 저장된 앞줄은 카드에서 빼고 남은 줄만(다시 누르면 남은 줄만 · 같은 줄 두 번 안 들어감)
            const done = rows.slice(0, res.part.n); await pair2Run(c, done, res.part.saved);
            done.forEach(r => { const i = c.rows.indexOf(r); if (i >= 0) { c.rows.splice(i, 1); c.orig.splice(i, 1); } });
            c.dupOk = null; if (OM.card === c) renderCard(); load();
            toast(`앞 ${res.part.n}줄은 저장했어요 · 남은 ${rows.length - res.part.n}줄은 못 했어요 · 저장을 다시 눌러 주세요`); return;
        }
        if (!res.ok) { btn.disabled = false; btn.innerHTML = keep; c.dupOk = null; toast(res.status === 409 ? errText(res, '비운 줄이에요 — 되살린 뒤 고쳐 주세요') : errText(res, '저장하지 못했어요 · 다시 눌러 주세요')); return; }
        if (c.mode !== 'edit') await pair2Run(c, rows, res.body && Array.isArray(res.body.rows) ? res.body.rows : []);   // #874 ②·③ 저장된 뒤(서버가 그 입력삭제 줄 묶음으로 옮김)
        {   // #880-b 저장 전에 누른 「이대로 둘게요」 = 저장된 줄 id 로 남김(저장된 주소가 그때 주소와 같을 때만)
            const sv = c.mode === 'edit' ? (res.body && res.body.row ? [res.body.row] : []) : (res.body && Array.isArray(res.body.rows) ? res.body.rows : []);
            const sp = v => String(v || '').replace(/\s+/g, ' ').trim();   // 서버가 탭·줄바꿈을 빈칸으로 바꿔 저장 → 견줄 땐 빈칸 하나로 · 보낼 땐 서버에 저장된 글 그대로(claude-69)
            await Promise.all(rows.map((r, i) => { const x = sv[i], saved = x ? String((x.cells || [])[8] || '').trim() : ''; if (r.kind !== 'cash' || !r._addrOk || !x || x.id == null || sp(saved) !== sp(r._addrOk) || (x.addr_ok && x.addr_ok.raw === saved)) return null; return addrOkSave(x.id, saved); }));
        }
        for (const id of drop) await API.remove(id);   // [바꾸기] = 새 줄 저장이 된 뒤 옛 줄을 「비운 것」으로(되살리기 가능)
        if (skipped || drop.length) toast([skipped ? `같은 줄 ${skipped}개는 이미 있어 뺐어요` : '', drop.length ? `옛 줄 ${drop.length}개를 새 것으로 바꿨어요` : ''].filter(Boolean).join(' · '));
        c.rows.forEach(r => { if (r.kind === 'cash' && r.cells[4]) recentPut(optBase(r.cells[4])); });   // #856 최근 목록 = 꼬리 뗀 품목 이름
        const saved = (res.body && (Array.isArray(res.body.rows) ? res.body.rows : res.body.row ? [res.body.row] : [])).map(r => normRow(r));
        const n = saved.length || c.rows.length, nCheck = saved.length ? saved.filter(r => !r.sure).length : blankN();
        if (c.mode !== 'edit' && !c.cash && (!c.from || c.from.filled)) { const raw = $('om-raw'); OM.telLn = null; raw.value = ''; OM.raw = ''; OM.tags.clear(); OM.smsSrc = null; syncTags(); inState(); }
        const goNext = aseqGo(c);   // #880-b 닫기 전에 표시(닫힘 = 멈춤으로 안 보게)
        cardClose(true);
        inNote(c.mode === 'edit' ? '고쳤어요' + (nCheck ? ' · 아직 「확인」으로 남았어요' : '') : (nCheck ? `${n}줄 저장했어요 · ${nCheck}줄은 「확인」으로 남았어요` : `${n}줄 저장했어요 · 다음 최종발주에 들어가요`), nCheck ? 'warn' : 'ok');
        OM.tab = 'open'; syncTabs(); const ld = load();
        if (goNext) ld.then(() => aseqNext());   // #880-b 이어서 확인 = 저장 뒤 다음 줄 카드
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
        if (r.check_why.length) r.check_why = r.check_why.filter(w => !/^파일 품목 /.test(w));   // #895 파일 품목 안내 = 고르면 뗌
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
        tpClose(false); askClose(hist !== false); OM.sel.clear(); OM.csel.clear(); OM.cq = ''; OM.cpage = 0; OM.clq = ''; OM.cneed = false; AFAIL.clear(); AF.n = 0; const q = $('om-cash-q'); if (q) q.value = ''; const q2 = $('om-clr-q'); if (q2) q2.value = ''; selSync(); undoHide();   // #859 닫으면 고른 것도 풂 · #878 현금 줄 고른 것·찾기도
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
    // ── #895(대표 10/27 · 순서 = 주문입력으로 개별 주소 먼저 → 입력삭제 번호 나중 → 짝) 주문 입력 카드 위 띠
    //   ① 「입력삭제 주소예요」 + 주문자(구매자) 번호 = 모든 줄 구매자 연락처(K) = 그 번호(보내는사람연락처(B)는 비었거나 옛 K 와 같을 때만 · pair1Go 와 같은 규칙)
    //      사람이 친 다른 K 는 그대로 · 끄면 넣은 번호만 되돌림 · 저장 = 지금처럼 현금 줄(「!」) → 메모함에 그 번호 입력삭제 줄이 이미 있으면 저장 뒤 그 줄과 짝(#874 ③ POST pair)
    //      없으면 나중에 그 번호 입력삭제 줄을 넣을 때 짝지을지 물음(#874 ②) · 치는 동안은 칸을 안 바꿈(#857) — 떠날 때·Enter 때 하이픈·줄에 넣기
    //   ② [택배 양식 파일 올리기] = 최종발주 택배 양식 13칸(FinalOrderCore.HEADERS) xlsx 를 브라우저에서 읽어 현금 줄로 · 파일은 서버로 안 감(저장 = 줄만)
    //      머리줄 = 위 15줄 안에서 「수취인명·옵션정보·배송지」 칸 이름으로 찾음 · 빈 줄·합계 줄(받는 분·주소 없음) 뺌 · 옵션 = 단가표 이름과 맞을 때만(아니면 비워 고르게)
    const IND_MIN = 9, FILE_MAX = 1500, SAVE_CHUNK = 60;   // #900 2-B 명절 = 파일 1,500줄(카드는 50장씩 그림 · cardRows)   // SAVE_CHUNK = 서버 한 번 저장 상한(order-memo.js MAX_ROWS)
    const FILE_HEADERS = ['보내는사람', '보내는사람연락처', '출고지', '수취인명', '옵션정보', '수량', '수취인연락처1', '수취인연락처2', '배송지', '배송메세지', '구매자연락처', '박스타입(입력x)', '보내는이 변경주소'];   // final-order-core.js HEADERS 와 같은 순서(그 파일이 없을 때 대비)
    const savedIndivLine = d => (OM.list || []).some(x => x.kind === 'line' && x.state === 'open' && digits(x.key) === d && INDIV_RE.test(String(x.note || '') + ' ' + String(x.line || '')));
    // #902 「입력삭제 주소예요」가 넣은 구매자·보내는사람 번호(_ik)만 있는 줄도 = 손대지 않은 빈 줄(종전엔 그 번호 때문에 파일 줄로 안 바뀌고 빈 「현금 줄 1」이 남음)
    const cashEmpty = r => r.kind === 'cash' && !r.ship_date && !r.cells.some((v, i) => { const t = String(v == null ? '' : v).trim(); return t && !(r._ik != null && (i === 10 || i === 1) && digits(t) === r._ik); });
    function indNote(c) {
        const ind = c.ind; if (!ind || !ind.on) return null;
        if (!digits(ind.key)) return { t: '주문자(구매자) 번호를 넣으면 모든 줄 구매자 연락처가 그 번호가 돼요', w: false };
        if (!indKeyOk(c)) return { t: '번호를 다시 확인해 주세요 · 9자리 이상이에요', w: true };
        const d = digits(ind.key), kept = c.rows.filter(r => r.kind === 'cash' && !r.indiv && r._k10typed && digits(r.cells[10]) && digits(r.cells[10]) !== d).length;
        const onR = c.rows.filter(r => r.kind === 'cash' && !r.indiv && r._ik != null), offN = c.rows.filter(r => r.kind === 'cash' && !r.indiv && r._indOff).length;   // #900 1-H 줄 수·박스
        return { t: `입력삭제 ${onR.length}줄 · ${onR.reduce((t, r) => t + qtyOf(r), 0)}박스${offN ? ` · 체크 안 한 ${offN}줄 = 현금 그대로` : ''} · ` + (savedIndivLine(d) ? `메모함에 ${ind.key} 입력삭제 줄이 있어요 · 저장하면 그 주문의 주소 줄로 짝지어요` : `저장하면 현금 줄로 들어가요 · 나중에 ${ind.key} 입력삭제 줄을 넣으면 짝지을지 물어봐요`) + (kept ? ` · 직접 넣은 다른 번호 ${kept}줄은 그대로예요` : ''), w: !!kept };
    }
    function cashBarHtml(c) {
        if (!c.cash || c.mode === 'edit') return '';
        const ind = c.ind || (c.ind = { on: false, key: '' }), nt = indNote(c), fn = c.fileNote, v = ind.draft != null ? ind.draft : ind.key;
        return `<div class="om-cashbar">
              <div class="om-cashbar-r">
                <label class="om-sw"><input type="checkbox" role="switch" data-cact="indon"${ind.on ? ' checked' : ''}><span>입력삭제 주소예요</span></label>
                <button type="button" class="om-btn sm" data-cact="file"${c.fileBusy ? ' disabled' : ''}>${c.fileBusy ? '파일 읽는 중…' : '택배 양식 파일 올리기'}</button>
                <input type="file" id="om-file" accept=".xlsx,.xls" hidden>
              </div>
              ${ind.on ? `<div class="om-f${ind.key && !indKeyOk(c) ? ' blank' : ''}"><div class="om-f-l"><label for="om-ind-key">주문자(구매자) 번호 <small>입력삭제 주문의 번호</small></label></div><input id="om-ind-key" type="tel" inputmode="tel" autocomplete="off" maxlength="16" placeholder="010-1234-5678" value="${esc(v)}" aria-describedby="om-ind-n"></div>` : ''}
              ${nt ? `<p class="om-barn${nt.w ? ' warn' : ''}" id="om-ind-n" role="note">${esc(nt.t)}</p>` : ''}
              ${fn ? `<p class="om-barn${fn.w ? ' warn' : ''}" id="om-file-n" role="status">${esc(fn.t)}</p>` : ''}
            </div>`;
    }
    // 켜짐 = 그 번호를 줄마다 넣음 · 꺼짐(또는 번호가 틀림) = 넣었던 번호만 되돌림 · 칸은 다시 그리지 않고 값만(초점 유지)
    function indApply(c) {
        const ok = indKeyOk(c), d = ok ? digits(c.ind.key) : '', key = c.ind && c.ind.key, f10 = CASH_FIELDS.find(x => x.i === 10), hit = ok && savedIndivLine(d);
        c.rows.forEach((r, ri) => {
            if (r.kind !== 'cash' || r.indiv) return;
            const cur = digits(r.cells[10]);
            if (ok && !r._indOff) {   // #900 1-H 「입력삭제」 체크를 끈 줄 = 아래 되돌림 길(넣은 번호만 되돌림 · 현금 그대로)
                if (r._k10typed && cur && cur !== d) return;   // 사람이 친 다른 번호
                if (r._ik == null) { r._ik0 = r.cells[10]; r._ib0 = r.cells[1]; }
                const oldK = r._ik != null ? r._ik : cur;
                if (!digits(r.cells[1]) || digits(r.cells[1]) === oldK) r.cells[1] = key;
                r.cells[10] = key; r._ik = d;
                if (hit) r._pairSaved = key; else delete r._pairSaved;
            } else if (r._ik != null) {
                if (cur === r._ik) r.cells[10] = r._ik0 || '';
                if (digits(r.cells[1]) === r._ik) r.cells[1] = r._ib0 || '';
                delete r._ik; delete r._ik0; delete r._ib0; delete r._pairSaved;
            } else return;
            const el = $(fid(ri, f10)); if (el) { el.value = getV(r, f10); touched(ri, f10); }
        });
    }
    // #900 1-H 스위치 켜고 번호를 넣은 카드 = 줄마다 「입력삭제」 체크(기본 켬) · 사람이 다른 구매자 번호를 친 줄은 안 보임(원래 안 바뀜)
    function indRowHtml(c, r, ri) {
        if (!c.cash || c.mode === 'edit' || r.kind !== 'cash' || r.indiv || !indKeyOk(c)) return '';
        const d = digits(c.ind.key), cur = digits(r.cells[10]); if (r._k10typed && cur && cur !== d) return '';
        return `<label class="om-indchk"><input type="checkbox" data-cact="indrow" data-ri="${ri}"${r._indOff ? '' : ' checked'}> <span>입력삭제 ${esc(c.ind.key)} 주소 줄 <small>끄면 현금 그대로</small></span></label>`;
    }
    // #900 1-C(대표 10/27) 「서비스」 = 입력삭제 주소 줄을 주문과 별개인 현금건으로(서버가 A칸 「… 드림!」 꼴 · 박스 대조·짝·자동 송장 등록 밖 · 택배사 양식엔 그대로 나감)
    //   보이는 줄 = 입력삭제 주소 줄이 될 줄(이미 주소 줄 · 스위치로 그 번호를 넣은 줄 · 카드 입력삭제 줄 번호와 K·B 가 같은 줄) 또는 이미 서비스인 줄 · 현금 손님 줄엔 안 보임(서버 400)
    function svcRowHtml(c, r, ri) {
        if (r.kind !== 'cash') return '';
        const keys = new Set(pairKeys(c).map(k => k.d)), willIndiv = r.indiv || r._ik != null || [r.cells[10], r.cells[1]].map(digits).some(d => keys.has(d));
        if (!r.service && !willIndiv) return '';
        return `<label class="om-indchk om-svcchk"><input type="checkbox" data-cact="svcrow" data-ri="${ri}"${r.service ? ' checked' : ''}> <span>서비스 <small>주문과 별개 · 박스 대조·운송장 등록 밖 · 택배는 나가요</small></span></label>`;
    }
    // 카드를 다시 그리되 칸을 치는 중이면 그 칸을 떠난 뒤(#857 · hintLoad 와 같은 꼴)
    function renderSoon(c) {
        const typing = () => { const ae = document.activeElement; return !!(ae && $('om-card').contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.type !== 'checkbox' && ae.type !== 'radio'); };
        const go = () => { if (OM.card !== c) return; if (typing()) { setTimeout(go, 400); return; } renderCard(); };
        go();
    }
    function indToggle(c, on) {
        c.ind = c.ind || { on: false, key: '' }; c.ind.on = !!on;
        if (c.ind.draft != null) { c.ind.key = c.ind.draft; c.ind.draft = null; }
        indApply(c); renderCard();
        const t = on && !indKeyOk(c) ? $('om-ind-key') : $('om-card').querySelector('[data-cact="indon"]'); if (t) t.focus({ preventScroll: true });
    }
    function indCommit(el) {
        const c = OM.card; if (!c || !c.ind) return;
        const v = String(el.value || '').trim(), show = digits(v).length >= IND_MIN ? telShow(v) : v;
        c.ind.draft = null; if (el.value !== show) el.value = show;
        if (show === c.ind.key) return;
        const was = indKeyOk(c); c.ind.key = show; indApply(c); indPaint(c);
        if (was !== indKeyOk(c)) renderSoon(c);   // #900 1-H 번호가 맞게/틀리게 바뀜 = 줄마다 체크 칸이 생기거나 사라짐
    }
    function indPaint(c) {   // 안내 줄·빨강·저장 단추만 고침(다시 그리지 않음 = 다음 칸 초점 유지)
        const bar = $('om-card').querySelector('.om-cashbar'); if (!bar) return;
        const nt = indNote(c); let p = $('om-ind-n');
        if (nt) { if (!p) { p = document.createElement('p'); p.id = 'om-ind-n'; p.setAttribute('role', 'note'); const fld = bar.querySelector('.om-f'); if (fld) fld.after(p); else bar.appendChild(p); } p.className = 'om-barn' + (nt.w ? ' warn' : ''); p.textContent = nt.t; }
        else if (p) p.remove();
        const k = $('om-ind-key'); if (k) k.closest('.om-f').classList.toggle('blank', !!c.ind.key && !indKeyOk(c));
        const p1 = $('om-card').querySelector('[data-cact="p1go"]'); if (p1) p1.closest('.om-pair').hidden = indKeyOk(c);   // 켜고 번호 = #874 ① 묻기 숨김(다음 그리기 때 pairHtml 이 안 그림)
        const sv = $('om-card-save'); if (sv && !c.wait) { sv.innerHTML = saveLabel(blankN()); saveSync(sv); }
    }
    function onCardKey(e) { if (e.target && e.target.id === 'om-ind-key' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); indCommit(e.target); } }
    function onCardChange(e) {
        const t = e.target; if (!t || t.id !== 'om-file') return;
        const f = t.files && t.files[0]; t.value = ''; if (f && OM.card) fileLoad(OM.card, f);
    }
    // 단가표 이름과 맞으면 그 글(꼬리 「2S사이즈로!」·「15과로!」 그대로) · 띄어쓰기만 다르면 단가표 이름으로 · 아니면 null(비워서 고르게)
    function optMatch(v) {
        v = String(v || '').trim(); const cat = OM.catalog || []; if (!v || !cat.length) return null;
        const has = n => cat.includes(n), FC = window.FinalOrderCore;
        if (has(optBase(v))) return v;
        const base = FC && FC.stripTail ? FC.stripTail(v, has) : v; if (has(base)) return base === v ? v : withOptTail(base, tailFits(base, optTail(v)) ? optTail(v) : '');
        const nz = s => String(s).replace(/\s+/g, ''), b0 = optBase(v), hit = cat.find(n => nz(n) === nz(b0));
        return hit ? withOptTail(hit, tailFits(hit, optTail(v)) ? optTail(v) : '') : null;
    }
    function fileRows(wb) {
        const H = (window.FinalOrderCore && FinalOrderCore.HEADERS) || FILE_HEADERS, nz = s => String(s == null ? '' : s).replace(/\s+/g, '');
        for (const name of wb.SheetNames || []) {
            const ws = wb.Sheets[name]; if (!ws) continue;
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
            for (let hi = 0; hi < Math.min(aoa.length, 15); hi++) {
                const head = (aoa[hi] || []).map(nz), col = H.map(h => head.indexOf(nz(h)));
                if (col[3] < 0 || col[4] < 0 || col[8] < 0) continue;   // 수취인명·옵션정보·배송지
                const rows = []; let skip = 0;
                for (let i = hi + 1; i < aoa.length; i++) {
                    const a = aoa[i] || [], cells = col.map(ci => ci < 0 ? '' : String(a[ci] == null ? '' : a[ci]).trim());
                    if (!cells.some(Boolean)) continue;
                    if ((!cells[3] && !cells[8]) || /^(합계|총계|소계|계|total)$/i.test(nz(cells[0] || cells[3]))) { skip++; continue; }
                    rows.push(cells);
                }
                return { rows, skip, sheet: name };
            }
        }
        return { err: '택배 양식 머리줄(수취인명·옵션정보·배송지)을 못 찾았어요 · 최종발주 택배 양식 파일인지 확인해 주세요' };
    }
    function fileRow(cells) {
        const r = blankRow('cash');
        for (let i = 0; i < 13; i++) r.cells[i] = String(cells[i] == null ? '' : cells[i]).trim();
        r.cells[11] = '';   // 박스타입 = 입력x
        [1, 6, 7, 10].forEach(i => { const v = r.cells[i], d = digits(v); r.cells[i] = /^1\d{8,9}$/.test(d) && /^[\d\s.-]*$/.test(v) ? telShow('0' + d) : telShow(v); });   // 엑셀이 숫자로 읽어 앞 0 이 빠진 번호
        const q = Math.round(Number(String(r.cells[5]).replace(/[^\d.]/g, ''))); r.cells[5] = q > 0 ? String(q) : '';
        const o = r.cells[4], m = optMatch(o);
        if (m == null) { r.cells[4] = ''; if (o) r.check_why = ['파일 품목 「' + o.slice(0, 60) + '」은 단가표에 없어요 · 골라 주세요']; }
        else r.cells[4] = m;
        return r;
    }
    async function fileLoad(c, file) {
        if (OM.card !== c || c.fileBusy) return;
        const note = (t, w) => { c.fileNote = { t, w: !!w }; renderCard(); };
        if (!window.XLSX) { note('엑셀 읽는 도구를 못 불러왔어요 · 새로고침한 뒤 다시 올려 주세요', true); return; }
        if (!/\.xlsx?$/i.test(file.name || '')) { note('엑셀 파일(xlsx·xls)만 올릴 수 있어요', true); return; }
        if (file.size > 10 * 1024 * 1024) { note('파일이 너무 커요 · 10MB 까지예요', true); return; }
        c.fileBusy = true; renderCard();
        let got;
        try { got = fileRows(XLSX.read(await file.arrayBuffer(), { type: 'array' })); } catch (e) { got = { err: '엑셀 파일을 못 읽었어요 · 택배 양식 파일인지 확인해 주세요' }; }
        if (!OM.catalog) await loadCatalog();
        c.fileBusy = false; if (OM.card !== c) return;
        if (got.err) { note(got.err, true); return; }
        if (!got.rows.length) { note(`「${file.name}」에 넣을 줄이 없어요(받는 분·주소가 있는 줄이 없어요)`, true); return; }
        const keep = c.rows.map((r, i) => i).filter(i => !cashEmpty(c.rows[i]));   // 손대지 않은 빈 줄 = 파일 줄로 바꿈
        c.rows = keep.map(i => c.rows[i]); c.orig = keep.map(i => c.orig[i]);
        const room = Math.max(0, FILE_MAX - c.rows.length), take = got.rows.slice(0, room), over = got.rows.length - take.length;
        const add = take.map(fileRow), miss = add.filter(r => !r.cells[4]).length, at = c.rows.length;
        add.forEach(r => { c.rows.push(r); c.orig.push(clone(r)); });   // 파일 값 = 처음 값(↺ 기준)
        if (c.rows.length > CARD_PAGE) {   // #900 2-B 큰 카드 = 이번 파일 줄 안에서만 빈칸 있는 줄 먼저(손으로 넣은 앞 줄은 자리 그대로 · 줄·처음 값 같이 · 같은 무리 안 순서 그대로)
            const ix = c.rows.map((r, i) => i).slice(at), bl = i => rowBlank(c.rows[i]) ? 0 : 1; ix.sort((a, b) => bl(a) - bl(b) || a - b);
            const rows = c.rows.slice(0, at).concat(ix.map(i => c.rows[i])), orig = c.orig.slice(0, at).concat(ix.map(i => c.orig[i]));
            c.rows = rows; c.orig = orig; c.shown = CARD_PAGE;
        }
        c.fileN = (c.fileN || 0) + add.length; c.fileName = file.name;
        if (c.ind && c.ind.on) indApply(c);
        note(`「${file.name}」에서 ${add.length}줄을 넣었어요` + (miss ? ` · 품목을 못 맞춘 ${miss}줄은 골라 주세요` : '') + (got.skip ? ` · 빈·합계 줄 ${got.skip}개는 뺐어요` : '') + (over ? ` · ${FILE_MAX}줄이 넘어 ${over}줄은 못 넣었어요` : ''), miss || over);
        let k = 0; const list = add.filter(r => String(r.cells[8] || '').trim());   // 주소 확인 = 두 줄씩(줄이 많아도 한꺼번에 안 부름)
        const next = () => { if (OM.card !== c || k >= list.length) return; const i = c.rows.indexOf(list[k++]); (i >= 0 ? addrRun(i) : Promise.resolve()).catch(() => {}).then(next); };
        next(); next();
    }
    // 서버 한 번 저장 = 60줄까지 → 넘으면 60줄씩 차례로 · 중간에 실패 = part(앞에서 저장된 줄 수·저장 결과)
    async function saveRows(c, rows) {
        const body = part => ({ raw: c.raw || (c.fileName ? '택배 양식 파일 ' + c.fileName : ''), tags: c.tags || [], source: c.source || 'manual', rows: part.map(outRow) });
        if (rows.length <= SAVE_CHUNK) return API.save(body(rows));
        const saved = [];
        for (let i = 0; i < rows.length; i += SAVE_CHUNK) {
            const res = await API.save(body(rows.slice(i, i + SAVE_CHUNK)));
            if (!res.ok) return i ? Object.assign({}, res, { part: { n: i, saved } }) : res;
            (res.body && Array.isArray(res.body.rows) ? res.body.rows : []).forEach(x => saved.push(x));
        }
        return { ok: true, status: 200, body: { ok: true, rows: saved } };
    }
    // 문자 대화에서: 그 글로 바로 정리 → 카드(저장 전엔 DB 0)
    function fromText(text, o) {
        o = o || {};
        open({ noFocus: true });
        runPreview({ text: String(text || '').trim().slice(0, 4000), tags: o.tags || [], source: o.threadId ? 'sms:' + o.threadId : 'manual', phone: o.phone || '', threadId: o.threadId || '' });
    }

    window.AkmOrderMemo = { open, close, fromText, fillFromSms, appendFromSms, isOpen: () => !!(OM.el && !OM.el.hidden), _t: { normRow, outRow, putBody, blanksOf, toIso } };
})();
