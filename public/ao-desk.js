// #469 클코 창구 — 에이전트 오피스 화면 (대표 GO 2026-09-29)
// 지시는 서버에 '대기'로 쌓이고, 대표 PC의 창구 터미널이 집어 처리한다. 이 파일은 화면만 담당한다.
// app.js에서 빌려 쓰는 것: api · showToast · currentUser · aoShowSettlementConfirm · aoSettleModalData · aoSettleQueue · aoBindEventsOnce
// #469-b(대표 9/29): 보고서함 탭 없음 — 내 지시·전체 지시(+관리자에게만 대표 확인함) → #538 채팅·이전 채팅 이력·승인 결재함 → #566 채팅·이전 채팅 이력 2개
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // #498 답변 글을 표·굵은 글씨·목록으로 그린다. 글자는 먼저 전부 esc 한 뒤 꾸미므로 답변에 든 태그는 글자로만 보인다.
    const mdInline = s => esc(s).replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`\n]+?)`/g, '<code>$1</code>');
    const mdCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    function md(text) {
        const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
        const out = [];
        let para = [], list = null;
        // #557(대표 10/6): 「★ ▶ ■ · ※」로 시작하는 줄은 앞 글과 살짝 띄우고 같은 기호끼리는 붙인다 — 줄마다 틀만 씌운다(글자는 그대로 · 복사 결과 불변). 기호 줄이 없는 문단은 종전 그대로.
        const symOf = l => { const m = /^\s*([★▶■·※])/.exec(l); return m ? '★▶■·※'.indexOf(m[1]) + 1 : 0; };
        const flushP = () => {
            if (!para.length) return;
            if (para.some(symOf)) out.push('<div class="desk-md-p desk-md-sym">' + para.map(l => { const k = symOf(l); return '<div class="desk-md-ln' + (k ? ' sym s' + k : '') + '">' + mdInline(l) + '</div>'; }).join('') + '</div>');
            else out.push('<div class="desk-md-p">' + para.map(mdInline).join('\n') + '</div>');
            para = [];
        };
        const flushL = () => { if (list) { out.push('<' + list.tag + ' class="desk-md-l">' + list.items.map(x => '<li>' + mdInline(x) + '</li>').join('') + '</' + list.tag + '>'); list = null; } };
        for (let i = 0; i < lines.length; i++) {
            const ln = lines[i], t = ln.trim();
            const isRow = t.startsWith('|') && t.indexOf('|', 1) > 0;
            if (isRow && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[i + 1].trim())) {
                flushP(); flushL();
                const head = mdCells(t);
                const align = mdCells(lines[i + 1]).map(c => /^:?-+:$/.test(c) ? (c[0] === ':' ? 'c' : 'r') : '');
                const numCls = (c, k) => { const a = align[k] || (/^[\d,.\-+%₩\s]*\d[\d,.\-+%₩\s]*(원|박스|건|개|kg|과|명|장|초|분)?$/.test(c) ? 'r' : ''); return a ? ' class="' + (a === 'r' ? 'num' : 'ctr') + '"' : ''; };
                i += 2;
                const rows = [];
                while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(mdCells(lines[i])); i++; }
                i--;
                out.push('<div class="desk-md-tw"><table class="desk-md-t"><thead><tr>' + head.map((c, k) => '<th' + (align[k] ? ' class="' + (align[k] === 'r' ? 'num' : 'ctr') + '"' : '') + '>' + mdInline(c) + '</th>').join('') + '</tr></thead><tbody>'
                    + rows.map(r => '<tr>' + head.map((_, k) => '<td' + numCls(r[k] == null ? '' : r[k], k) + '>' + mdInline(r[k] == null ? '' : r[k]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
                continue;
            }
            if (!t) { flushP(); flushL(); continue; }
            if (/^(-{3,}|━{3,}|═{3,}|─{3,})$/.test(t)) { flushP(); flushL(); out.push('<hr class="desk-md-hr">'); continue; }
            const h = /^#{1,4}\s+(.+)$/.exec(t);
            if (h) { flushP(); flushL(); out.push('<div class="desk-md-h">' + mdInline(h[1]) + '</div>'); continue; }
            const ul = /^[-*•]\s+(.+)$/.exec(t), ol = /^(\d{1,2})[.)]\s+(.+)$/.exec(t);
            if (ul || ol) {
                flushP();
                const tag = ul ? 'ul' : 'ol';
                if (!list || list.tag !== tag) { flushL(); list = { tag, items: [] }; }
                list.items.push(ul ? ul[1] : ol[2]);
                continue;
            }
            flushL(); para.push(ln);
        }
        flushP(); flushL();
        return '<div class="desk-md">' + out.join('') + '</div>';
    }
    // #552(대표 10/6): 창구가 여러 결과물을 한 답에 낼 때 「━━━ ① 문자(LMS) ━━━」 꼴 줄로 묶음을 나눈다 → 묶음이 2개 이상이면 묶음마다 [복사]
    //   묶음 머리 = 「━ 두 개 이상 + 글자 + ━ 두 개 이상」으로만 된 줄(글자 없는 「━━━━」 구분 줄은 아님). 머리 앞의 글은 묶음이 아니다. 복사하는 글 = 원문 그대로(머리 줄 빼고 · 앞뒤 빈 줄 정리).
    const SEC_HEAD = /^\s*━{2,}\s*([^━\s][^━]*?)\s*━{2,}\s*$/;
    function answerSecs(text) {
        const pre = [], secs = []; let cur = null;
        String(text == null ? '' : text).replace(/\r/g, '').split('\n').forEach(ln => { const m = SEC_HEAD.exec(ln); if (m) { cur = { title: m[1].trim(), lines: [] }; secs.push(cur); } else (cur ? cur.lines : pre).push(ln); });
        if (secs.length < 2) return null;
        return { pre: pre.join('\n'), secs: secs.map(s => ({ title: s.title, body: s.lines.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '') })) };
    }
    function mdAnswer(text, o) {
        const a = o ? answerSecs(text) : null; if (!a) return md(text);
        return (a.pre.trim() ? md(a.pre) : '') + a.secs.map((s, i) => `<section class="desk-sec" aria-label="${esc(s.title)}"><div class="desk-sec-head"><b>${esc(s.title)}</b><button type="button" class="desk-sec-copy" data-act="copysec" data-id="${o.id}" data-sec="${i}" aria-label="${esc(s.title)} 복사">복사</button></div><div class="desk-sec-body">${md(s.body)}</div></section>`).join('');   // #556: 묶음마다 틀(머리 띠 + 본문) — 어느 [복사]가 어디까지인지 보이게
    }
    // 복사: 브라우저가 클립보드 쓰기를 막으면(권한·보안 연결 아님) 숨은 입력칸으로 한 번 더 해 본다
    // #584: 그래도 막히면(회사 PC 보안 프로그램·브라우저 정책) 화면의 그 글을 골라 둬서 Ctrl+C(폰은 길게 눌러 복사)만 누르면 되게 한다
    async function copyText(text, okMsg, el) {
        try { await navigator.clipboard.writeText(text); showToast(okMsg); return; } catch (e) { /* 아래 대체 방법 */ }
        try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'; document.body.appendChild(ta); ta.select(); const done = document.execCommand('copy'); ta.remove(); if (done) { showToast(okMsg); return; } } catch (e) { /* 아래 안내 */ }
        if (el && el.isConnected) {
            try { const sel = window.getSelection(); sel.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(el); sel.addRange(r); el.scrollIntoView({ block: 'nearest' }); showToast('이 브라우저는 복사를 막고 있어 글을 골라 두었어요. Ctrl+C(폰은 길게 눌러 복사)로 복사해 주세요', '', 5000); return; } catch (e) { /* 아래 안내 */ }
        }
        showToast('복사하지 못했어요. 직접 선택해 복사해 주세요');
    }
    const plainHead = t => String(t || '').replace(/^[#\s*]+/, '').replace(/[*\s]+$/, '').replace(/\s+/g, ' ').trim();
    const sameHead = (title, text) => plainHead(title) === plainHead(String(text || '').split('\n').find(l => l.trim()) || '');
    // 화면에 보일 진행 단계(처리 길 표시는 답변 옆 작은 표시로만 쓴다)
    const visSteps = o => (Array.isArray(o.steps) ? o.steps : []).filter(x => x && x.kind !== 'lane');
    // 어느 길로 처리했는지(대기 프로그램이 단계에 남긴다) + 걸린 시간
    function laneChip(o) {
        const st = (Array.isArray(o.steps) ? o.steps : []).find(s => s && s.kind === 'lane');
        if (!st) return '';
        let sec = '';
        // #580: 걸린 시간은 「보낸 때」부터 잰다 — 종전엔 창구가 집은 뒤(길 표시)부터 재서, 기다린 시간이 빠져 실제보다 짧게 나왔다
        const t0 = o.created_at || st.t;
        if (o.processed_at && t0) { const d = Math.round((tms(o.processed_at) - tms(t0)) / 1000); if (d > 0 && d < 7200) sec = d < 90 ? d + '초' : Math.round(d / 60) + '분'; }
        const done = !ACTIVE.includes(o.status) && o.status !== '판독완료' && o.status !== '확인표작성';
        return `<span class="desk-lane" data-lane="${esc(st.lane || '')}">${esc(st.text)}${done && sec ? ' · ' + sec : ''}</span>`;
    }
    // #580: 서버 시각(시간대 표시 없는 UTC 글자)을 밀리초로 · 지난 시간을 「N초」「M분 S초」로
    const tms = t => { const v = new Date(/Z|[+-]\d\d:?\d\d$/.test(String(t)) ? t : String(t).replace(' ', 'T') + 'Z').getTime(); return Number.isFinite(v) ? v : NaN; };
    const agoText = since => { const d = Math.floor((Date.now() - tms(since)) / 1000); if (!Number.isFinite(d) || d < 1) return ''; return d < 90 ? d + '초' : Math.floor(d / 60) + '분 ' + (d % 60) + '초'; };
    const elapsedHtml = o => o.created_at ? `<span class="desk-elapsed" data-since="${esc(o.created_at)}">${agoText(o.created_at) ? ' · ' + agoText(o.created_at) : ''}</span>` : '';
    // 1초마다 숫자만 바꾼다(목록을 다시 그리지 않는다)
    function tickElapsed() { const list = $('desk-list'); if (!list) return; list.querySelectorAll('.desk-elapsed[data-since]').forEach(el => { const t = agoText(el.getAttribute('data-since')); const v = t ? ' · ' + t : ''; if (el.textContent !== v) el.textContent = v; }); }
    const isAdmin = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
    // #561(대표 10/6 A안): 관리자 중 대표만 — 모두의 이력 보기 · 승인/반려(#566 에서 승인 결재함 탭은 없앰). 창구 깨우기 · [다시 맡기기]는 관리자(isAdmin) 그대로
    const isOwner = () => isAdmin() && currentUser.position === '대표';
    const pageActive = () => { const p = $('page-agent-office'); return !!(p && p.classList.contains('active')); };
    // #673: LIVE 로그 시각 — 오늘은 종전 꼴(오후 10:40) · 다른 날은 「10/11 22:40」(날짜가 없어 순서가 뒤섞여 보이던 것)
    const liveWhen = t => { const day = kst(t, { year: 'numeric', month: '2-digit', day: '2-digit' }); if (!day || day === kst(new Date().toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' })) return kst(t, { hour: '2-digit', minute: '2-digit' }); const m = kst(t, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).match(/(\d+)\.\s*(\d+)\.\s*(\d+):(\d+)/); return m ? `${m[1]}/${m[2]} ${m[3] === '24' ? '00' : m[3]}:${m[4]}` : kst(t, { hour: '2-digit', minute: '2-digit' }); };
    const kst = (t, opt) => { try { return new Date(/Z|[+-]\d\d:?\d\d$/.test(String(t)) ? t : String(t).replace(' ', 'T') + 'Z').toLocaleString('ko-KR', Object.assign({ timeZone: 'Asia/Seoul' }, opt)); } catch (e) { return ''; } };
    const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

    const S = {
        mounted: false, tab: 'mine', status: null, orders: [], board: null, sig: '', boardAt: 0,
        images: [], open: new Set(), seenConfirm: null, tick: 0, sending: false, loading: false,
        fs: 'all', wide: false, detail: new Set(), autoOpened: new Set(), pend: new Map(), media: new Map(), replyImg: new Map(), replyTarget: 0,
        view: (() => { try { return localStorage.getItem('akm_desk_view') === 'table' ? 'table' : 'chat'; } catch (e) { return 'chat'; } })(), closed: new Set(), follow: new Set(), boxOpen: new Set(),
        hist: { q: '', mineOnly: false, older: [], more: false, open: new Set(), busy: false, delAsk: 0 }, endAsk: 0, pin: new Set(), q: { mine: '', all: '' }, mineLimit: 60, pickImg: false,
        inbox: null, inboxKind: 'all', inboxSeen: false, inboxAt: 0, ibDetail: new Set(),
    };
    // #469-d(대표 9/29): 예시는 일을 통째로 맡기는 문장으로 — 괄호는 직원이 채울 내용 안내
    const HINTS = ['정산관리 오늘 발주수량이야 올려줘', '단골고객에게 문자발송할 예정이야 (쿠폰, 행사내용, 기간 넣어주기)', '지금 네이버 자사몰 쿠팡 가격 맞는지 확인해줘', '신규품목 보고서 작성해줘 (핵심내용 두서없이 쓰기)'];
    const SAY = {
        idle: '무엇을 도와드릴까요?',
        busy: '지금 지시를 처리하고 있어요.',
        offline: '지금은 자리에 없어요. 남겨 두시면 돌아와서 순서대로 처리할게요.',
        queued: '순서 대기 중이에요.',   // #596: 내 지시가 기다리는데 다른 일을 처리 중일 때(누구 것·몇 건인지는 적지 않는다)
    };
    const STATE_LABEL = { idle: '대기 중', busy: '처리 중', offline: '자리 비움' };
    // #506(대표 10/3): 처리 중 문구는 번호 대신 「"요청"」 — 길면 앞부분만, 이어서 보낸 글은 괄호로, 여러 건이면 나란히
    // #596(대표 10/8): 이 카드는 **본인 지시만** — 서버(desk-status)가 건수·목록·state 를 로그인 계정 것만 내려준다(이름 없음). 남의 지시는 건수도 글도 여기 안 나온다(대표·관리자도 같다)
    const cutText = (t, n) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
    function sayWorking(d) {
        const list = Array.isArray(d.working_list) ? d.working_list : [];
        if (!list.length) return d.working > 1 ? `지시 ${d.working}건을 동시에 처리하고 있어요.` : SAY.busy;
        if (list.length === 1) {
            const w = list[0];
            const base = w.reply_to && w.parent_content ? w.parent_content : w.content;
            const follow = w.reply_to && w.parent_content ? ` (이어서: "${cutText(w.content, 16)}")` : '';
            return `"${cutText(base, 24)}"${follow} 처리 중이에요`;
        }
        return `${list.length}건 처리 중 — ` + list.map(w => `"${cutText(w.reply_to && w.parent_content ? w.parent_content : w.content, 14)}"`).join(' · ');
    }
    const BADGE = {
        '대기': ['wait', '순서 대기'], '처리중': ['work', '처리 중'], '판독완료': ['work', '확인표 작성 중'], '확인표작성': ['work', '확인표 작성 중'],
        '질문': ['ask', '확인 필요'], '승인대기': ['ask', '승인 대기'], '승인됨': ['work', '승인됨 · 실행 대기'], '반려': ['err', '반려'],
        '완료': ['done', '완료'], '안내': ['done', '안내'], '응답됨': ['done', '답변함'], '오류': ['err', '오류'], '오류확인': ['err', '오류 확인함'],
        '질문종결': ['done', '종결'], '취소': ['done', '취소'], '대체됨': ['done', '대체됨'], '피드백': ['done', '피드백'],
    };
    const ACTIVE = ['대기', '처리중', '판독완료', '확인표작성', '승인됨'];

    function mount() {
        if (S.mounted) return;
        const root = $('ao-desk-root');
        if (!root) return;
        root.innerHTML = `
        <div class="desk-main">
            <section class="desk-top desk-top1">
                <div class="desk-theme-slot"><button type="button" class="desk-theme" id="desk-theme" aria-pressed="false" aria-label="야간 화면으로 바꾸기" title="야간 화면으로 바꾸기"></button></div>
                <div class="desk-hero">
                    <div class="desk-hero-info">
                        <div class="desk-date" id="desk-date"></div>
                        <div class="desk-clock" id="desk-clock" aria-live="off"></div>
                        <div class="desk-hero-line">
                            <span class="desk-state" id="desk-state" data-s="offline"><i></i><span id="desk-state-text">확인 중</span></span>
                            <span class="desk-say" id="desk-say" role="status"></span>
                        </div>
                        <span class="desk-state-sub" id="desk-state-sub"></span>
                        <div class="desk-wake" id="desk-wake">
                            <button type="button" class="desk-btn primary" id="desk-wake-btn">창구 깨우기</button>
                            <span class="desk-wake-note" id="desk-wake-note"></span>
                        </div>
                    </div>
                    <div class="desk-stage" id="desk-stage" data-s="offline"><img id="desk-char" src="/desk/akkomi-off.webp?v=2" alt="아꼼이 캐릭터" width="132" height="132"></div>
                </div>
                <form class="desk-ask" id="desk-ask" autocomplete="off">
                    <label class="desk-sr" for="desk-input">지시 내용</label>
                    <div class="desk-compose desk-cbox desk-topbox">
                        <div class="desk-thumbs" id="desk-thumbs" hidden></div>
                        <textarea class="desk-input" id="desk-input" rows="1" maxlength="2000" placeholder="원하시는 작업을 입력해 주세요"></textarea>
                        <div class="desk-cbox-row">
                            <input type="file" id="desk-file" accept="image/*,.xlsx,.xls,.csv,.pdf,.txt" multiple hidden>
                            <input type="file" id="desk-reply-file" accept="image/*,.xlsx,.xls,.csv,.pdf,.txt" hidden>
                            <button type="button" class="desk-cbtn desk-plus-btn" id="desk-plus-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="desk-plus" aria-label="할 일 고르기 — 첨부 · 발주 · 확인 · 문자" title="첨부 · 발주 · 확인 · 문자">${ICON_PLUS}<i class="sms-n desk-plus-n" id="desk-plus-n" hidden></i></button>
                            <div class="desk-quick2 desk-shorts" id="desk-shorts" role="group" aria-label="바로가기"></div>
                            <div class="desk-plus-back" id="desk-plus-back" hidden></div>
                            <div class="desk-plus" id="desk-plus" role="menu" aria-label="할 일 고르기" hidden>
                                <div class="desk-plus-g" role="group" aria-label="첨부"><b>첨부</b>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-attach" data-mk="attach" aria-label="이미지·파일 첨부"><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.9-2.9l8.5-8.5"/></svg></i><span class="desk-mi-t"><strong>파일 · 이미지</strong><small>엑셀 · PDF · 사진을 지시에 붙여요</small></span></button>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-settle-now" data-mk="settle"><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg></i><span class="desk-mi-t"><strong>정산 이미지</strong><small>발송목록 사진으로 정산 확인표를 만들어요</small></span></button>
                                </div>
                                <div class="desk-plus-g" role="group" aria-label="발주"><b>발주</b>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-qty-now" data-mk="qty"><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg></i><span class="desk-mi-t"><strong>중간발주</strong><small>들어온 주문을 거래처별로 바로 집계해요</small></span></button>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-final-now" data-mk="final"><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V10z"/><path d="M9 5v5H4"/><path d="M9 14l2 2 4-4"/></svg></i><span class="desk-mi-t"><strong>최종발주</strong><small>현금파일 · 메모로 택배사 양식을 만들어요</small></span></button>
                                </div>
                                <div class="desk-plus-g" role="group" aria-label="확인"><b>확인</b>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-ship-now" data-mk="ship"><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg></i><span class="desk-mi-t"><strong>배송조회 확인하기</strong><small>발송한 택배가 어디까지 갔는지 물어봐요</small></span></button>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-price-now" data-mk="price"><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg></i><span class="desk-mi-t"><strong>전체 가격 확인하기</strong><small>네이버 · 자사몰 가격이 서로 맞는지 봐요</small></span></button>
                                </div>
                                <div class="desk-plus-g" role="group" aria-label="손님" id="desk-plus-cust"><b>손님</b>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-sms-now" data-mk="sms" hidden><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg></i><span class="desk-mi-t"><strong>문자</strong><small>회사폰으로 온 문자를 보고 여기서 답해요</small></span><i class="sms-n" id="sms-chip-n" hidden></i></button>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-inb-talk" data-mk="inb" hidden><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg></i><span class="desk-mi-t"><strong>톡톡</strong><small>톡톡 문의를 보고 여기서 답해요</small></span><i class="sms-n" id="inb-n-talk" hidden></i></button>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-inb-qna" data-mk="inb" hidden><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg></i><span class="desk-mi-t"><strong>상품문의</strong><small>답하면 스마트스토어에 바로 등록돼요</small></span><i class="sms-n" id="inb-n-qna" hidden></i></button>
                                    <button type="button" class="desk-mi" role="menuitem" id="desk-inb-inquiry" data-mk="inb" hidden><i class="desk-mi-ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg></i><span class="desk-mi-t"><strong>주문문의</strong><small>답하면 스마트스토어에 바로 등록돼요</small></span><i class="sms-n" id="inb-n-inquiry" hidden></i></button>
                                </div>
                            </div>
                            <span class="desk-count" id="desk-count" hidden>0 / 2000</span>
                            <button type="submit" class="desk-cbtn primary" id="desk-send" disabled aria-label="지시 보내기" title="보내기 (Enter) · 줄바꿈은 Shift+Enter">${ICON_UP}</button>
                        </div>
                    </div>
                </form>
            </section>
            <section class="desk-tool" id="desk-ship" aria-label="배송조회" hidden>
                <div class="desk-tool-head"><b>배송조회</b><span>CJ대한통운 · 발송일 기준</span><button type="button" class="desk-btn sm desk-tool-x" id="ship-close">닫기</button></div>
                <form class="ship-form" id="ship-form" autocomplete="off">
                    <label class="ship-f" for="ship-from">발송일</label>
                    <input type="text" class="akm-date ship-date" id="ship-from" readonly autocomplete="off" placeholder="날짜 선택" aria-label="발송일 시작">
                    <span class="ship-tilde" aria-hidden="true">~</span>
                    <input type="text" class="akm-date ship-date" id="ship-to" readonly autocomplete="off" placeholder="날짜 선택" aria-label="발송일 끝">
                    <button type="submit" class="desk-btn primary" id="ship-go">조회</button>
                    <label class="desk-sr" for="ship-q">이름·받는 분 연락처 끝 4자리·운송장으로 찾기</label><input type="search" class="ship-q desk-find ship-find" id="ship-q" autocomplete="off" maxlength="40" placeholder="이름 · 받는 분 연락처 끝 4자리 · 운송장" title="이 기간 송장에서 찾아요(조회한 뒤에 쓸 수 있어요)" disabled>
                </form>
                <div class="ship-prog" id="ship-prog" role="status" hidden><div class="ship-prog-line"><span id="ship-prog-text">조회 중</span><b id="ship-prog-n"></b></div><div class="ship-track"><i id="ship-prog-bar"></i></div></div>
                <div class="ship-note" id="ship-note" role="status" hidden></div>
                <div class="ship-out" id="ship-out"></div>
                <div class="ship-drop" id="ship-drop">
                    <input type="file" id="ship-file" accept=".xlsx" hidden>
                    <span class="ship-drop-txt"><b>송장 엑셀 올리기</b> 송장이 아직 안 올라온 날은 택배사 엑셀을 여기에 끌어다 놓으세요</span>
                    <button type="button" class="desk-btn sm" id="ship-pick">파일 고르기</button>
                    <span class="ship-up-msg" id="ship-up-msg" role="status"></span>
                </div>
            </section>
            <section class="desk-tool" id="desk-qty" aria-label="중간발주" hidden>
                <div class="desk-tool-head"><b>중간발주</b><span id="qty-sub">3채널 배송준비 · 지금 기준</span><button type="button" class="desk-btn sm desk-tool-x" id="qty-close">닫기</button></div>
                <div class="ship-prog" id="qty-prog" role="status" hidden><div class="ship-prog-line"><span id="qty-prog-text">주문을 불러오는 중</span></div><div class="ship-track busy"><i></i></div></div>
                <div class="ship-note" id="qty-note" role="status" hidden></div>
                <div class="qty-out" id="qty-out"></div>
            </section>
            <section class="desk-tool sms-modal" id="desk-sms" role="dialog" aria-modal="true" aria-label="문자" hidden>
              <div class="sms-win">
                <div class="desk-tool-head"><b id="sms-title">문자</b><em class="sms-mode" id="sms-mode" hidden></em><span id="sms-sub">회사폰으로 온 문자</span><button type="button" class="desk-btn sm desk-tool-x" id="sms-close">닫기</button></div>
                <div class="ship-note" id="sms-note" role="status" hidden></div>
                <div class="sms-tabs" id="sms-tabs" role="tablist" aria-label="손님 연락 채널" hidden></div>
                <div class="sms-cols"><div class="sms-left">
                <div class="sms-bar"><label class="desk-sr" for="sms-q">문자 찾기</label><input type="search" class="ship-q sms-q" id="sms-q" maxlength="40" autocomplete="off" placeholder="끝 4자리 · 전체 번호 · 글로 찾기"><button type="button" class="desk-btn sm sms-done-btn sms-staff-btn" id="sms-staff" aria-pressed="false" title="읽었어도 아직 사람 답이 필요한 대화만 봐요. 다시 누르면 전체 대화" hidden>직원 확인 <b id="sms-staff-n"></b></button><button type="button" class="desk-btn sm sms-done-btn" id="sms-scope" aria-pressed="false" title="직원이 챙겨야 하는 대화만 봐요. 다시 누르면 전체 대화">미처리 <b id="sms-open-n" hidden></b></button><span class="sms-count" id="sms-count" role="status"></span><button type="button" class="desk-btn sm sms-new-btn" id="sms-new" title="번호를 적어 손님에게 먼저 문자를 보내요" hidden>새 문자</button></div>
                <ul class="sms-list" id="sms-list"></ul>
                </div><div class="sms-pane" id="sms-pane"><div class="sms-pane-empty">왼쪽 목록에서 대화를 골라 주세요.</div></div></div>
                <div class="inb-host" id="inb-host" hidden></div>
              </div>
                <div class="sms-view" id="sms-view" role="dialog" aria-modal="true" aria-label="사진 크게 보기" hidden><button type="button" class="desk-btn sm sms-view-x" id="sms-view-x">닫기</button><img id="sms-view-img" alt="문자로 온 사진"></div>
            </section>
            <section class="desk-listbox" id="desk-listbox" aria-label="채팅 목록">
                <div class="desk-fullbar"><b id="desk-full-title">채팅</b><button type="button" class="desk-btn sm desk-close" data-full-close>닫기</button></div>
                <div class="desk-tabsrow">
                    <div class="desk-tabs" role="tablist" id="desk-tabs">
                        <button class="desk-tab" role="tab" data-tab="mine" aria-selected="true">채팅</button>
                        <button class="desk-tab" role="tab" data-tab="all" aria-selected="false" id="desk-tab-all">이전 채팅 이력</button>
                    </div>
                    <div class="desk-filter">
                        <button type="button" class="desk-btn sm desk-viewbtn" id="desk-view" hidden>표로 보기</button>
                        <select id="desk-fs" aria-label="상태로 걸러 보기">
                            <option value="all">전체 상태</option>
                            <option value="work">진행 중</option>
                            <option value="ask">확인 필요</option>
                            <option value="done">완료</option>
                            <option value="err">오류·반려</option>
                        </select>
                    </div>
                </div>
                <div class="desk-histbar" id="desk-histbar">
                    <label class="desk-sr" for="desk-hist-q">채팅 검색</label>
                    <div class="desk-hist-search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="desk-hist-q" maxlength="60" placeholder="보낸 글이나 답변에서 찾기" autocomplete="off"><button type="button" class="desk-hist-x" id="desk-hist-x" aria-label="검색어 지우기" hidden>×</button></div>
                    <label class="desk-hist-mine" id="desk-hist-mine-wrap" hidden><input type="checkbox" id="desk-hist-mine"> 내 것만</label>
                </div>
                <div class="desk-list" id="desk-list" aria-live="polite"></div>
                <button type="button" class="desk-more-all" id="desk-list-more" data-full-open="desk-listbox">자세히 확인하기<span class="n"></span><span class="chev" aria-hidden="true">›</span></button>
            </section>
            <section class="desk-inbox" id="desk-inbox" aria-label="손님 연락">
                <div class="desk-inbox-head">
                    <b>손님 연락</b>
                    <div class="desk-inbox-tabs" id="desk-inbox-tabs" role="tablist" aria-label="채널 고르기 · 숫자는 미처리">
                        <button type="button" role="tab" data-k="all" aria-selected="true">전체</button>
                        <button type="button" role="tab" data-k="sms" aria-selected="false" hidden>문자 <i id="inbox-n-sms">0</i></button>
                        <button type="button" role="tab" data-k="talk" aria-selected="false">톡톡 <i id="inbox-n-talk">0</i></button>
                        <button type="button" role="tab" data-k="qna" aria-selected="false">상품문의 <i id="inbox-n-qna">0</i></button>
                        <button type="button" role="tab" data-k="inquiry" aria-selected="false">주문문의 <i id="inbox-n-inquiry">0</i></button>
                    </div>
                    <button type="button" class="desk-btn sm desk-close" data-full-close>닫기</button>
                </div>
                <div class="desk-inbox-list" id="desk-inbox-list"><div class="desk-empty">불러오는 중</div></div>
                <button type="button" class="desk-more-all" id="desk-inbox-more" data-full-open="desk-inbox">자세히 확인하기<span class="n"></span><span class="chev" aria-hidden="true">›</span></button>
            </section>
            <button type="button" class="desk-foldbtn" id="desk-board-fold" aria-expanded="false" aria-controls="desk-board">현황판 보기</button>
            <section class="desk-board folded" id="desk-board" aria-label="현황판"></section>
        </div>
        <aside class="desk-side">
            <div class="desk-panel"><h3>LIVE 로그 <span>내 채팅 처리 현황</span></h3><div id="desk-live"></div></div>
            <div class="desk-panel"><h3>오늘 일정 <span id="desk-today-n"></span></h3><div id="desk-today"></div></div>
            <div class="desk-panel"><h3>주요 업무 현황 <span>오늘 기준</span></h3><div id="desk-prog"></div></div>
        </aside>`;
        bind();
        todoBind();
        S.mounted = true;
        // #477 안내 문구는 관리자·직원 같다(대표 9/30 — 직원도 바로 실행)
    }

    function bind() {
        const input = $('desk-input');
        input.addEventListener('input', () => { syncInput(); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(); } });
        input.addEventListener('paste', e => {
            const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
            if (files.length) { e.preventDefault(); addFiles(files); }
        });
        $('desk-ask').addEventListener('submit', e => { e.preventDefault(); send(); });
        $('desk-attach').addEventListener('click', () => { S.pickImg = false; $('desk-file').accept = ACCEPT_ALL; $('desk-file').click(); });
        plusBind();   // #653-나 [+] 메뉴 · 바로가기
        $('desk-reply-file').addEventListener('change', e => { const f = (e.target.files || [])[0]; e.target.value = ''; if (f && S.replyTarget) setReplyImg(S.replyTarget, f); });
        const replyId = el => el && el.classList && el.classList.contains('desk-reply-in') && /^reply-\d+$/.test(el.id) ? Number(el.id.slice(6)) : 0;
        $('desk-list').addEventListener('paste', e => {
            const id = replyId(e.target);
            if (!id) return;
            const f = Array.from((e.clipboardData && e.clipboardData.files) || [])[0];
            if (f) { e.preventDefault(); setReplyImg(id, f); }
        });
        $('desk-list').addEventListener('input', e => { if (e.target && e.target.classList && e.target.classList.contains('desk-reply-in')) { const tbx = e.target.closest('.desk-thread-box'); if (tbx && tbx.dataset.th) S.boxOpen.add(Number(tbx.dataset.th)); fitReply(e.target); syncSendBtns(); } });
        let histT = 0;   // #543 검색 — 치는 즉시(한글 조합 중에도) 받은 목록을 화면에서 거른다. 이력 탭은 250ms 뒤 서버에서 찾아 바꿔 끼운다
        const onSearch = () => {
            const v = $('desk-hist-q').value; S.q[S.tab] = v; $('desk-hist-x').hidden = !v;
            S.sig = ''; renderList();
            if (S.tab !== 'all') return;
            clearTimeout(histT); const t = v.trim();
            histT = setTimeout(() => { if (t === S.hist.q) return; S.hist.q = t; S.hist.older = []; S.sig = ''; loadOrders(true); }, 250);
        };
        $('desk-hist-q').addEventListener('input', onSearch);
        $('desk-hist-x').addEventListener('click', () => { const i = $('desk-hist-q'); i.value = ''; onSearch(); i.focus(); });
        $('desk-hist-mine').addEventListener('change', e => { S.hist.mineOnly = e.target.checked; S.sig = ''; renderList(); });
        $('desk-list').addEventListener('keydown', e => {   // 답 칸도 Enter = 보내기(PC) · Shift+Enter = 줄바꿈
            const id = replyId(e.target);
            if (!id || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229 || !window.matchMedia('(pointer: fine)').matches) return;
            e.preventDefault();
            const box = e.target.closest('.desk-reply'), btn = box && box.querySelector('[data-act="sendreply"]');
            if (btn) btn.click();
        });
        $('desk-qty-now').addEventListener('click', () => qtyOpen());   // #595: 브라우저가 바로 집계·그림(대기 프로그램을 거치지 않는다)
        bindTools();   // #594 배송조회 · #595 중간발주
        $('desk-theme').addEventListener('click', () => setTheme(!themeOn));   // #568
        applyTheme();
        $('desk-final-now').addEventListener('click', () => { if (window.AkmFinalOrder) { plusClose(false); hbIdle(() => window.AkmFinalOrder.open()); } else showToast('최종발주 화면을 불러오지 못했어요. 새로고침 후 다시 눌러 주세요'); });   // #508
        $('desk-settle-now').addEventListener('click', () => { if (!input.value.trim()) { input.value = '정산관리에 올려줘'; syncInput(); } S.pickImg = true; $('desk-file').accept = 'image/*'; $('desk-file').click(); });   // 정산 이미지는 이미지 전용 그대로
        $('desk-wake-btn').addEventListener('click', () => wake());
        $('desk-file').addEventListener('change', e => { const fl = Array.from(e.target.files || []); addFiles(S.pickImg ? fl.filter(isImg) : fl); e.target.value = ''; });
        const ask = $('desk-ask');
        ask.addEventListener('dragover', e => { e.preventDefault(); ask.classList.add('drag'); });
        ask.addEventListener('dragleave', () => ask.classList.remove('drag'));
        ask.addEventListener('drop', e => { e.preventDefault(); ask.classList.remove('drag'); addFiles(Array.from(e.dataTransfer.files || [])); });
        // #661 손님 연락 카드 — 채널 칩(다시 누르면 전체) · 줄 = 그 대화로 · [확인]/[확인함](되돌리기)
        $('desk-inbox-tabs').addEventListener('click', e => {
            const b = e.target.closest('button[data-k]'); if (!b) return;
            S.inboxKind = (b.dataset.k === S.inboxKind) ? 'all' : b.dataset.k;
            renderInbox();
        });
        $('desk-inbox-list').addEventListener('click', async e => {
            const b = e.target.closest('button[data-ib]'); if (!b) return;
            const act = b.dataset.ib, row = b.closest('.desk-cu');
            if (act === 'open') { cuOpen(row ? row.dataset.kind : '', b.dataset.open || ''); return; }
            if (act === 'win') { cuOpen(S.inboxKind === 'all' ? '' : S.inboxKind, ''); return; }
            if (!row || (act !== 'ok' && act !== 'undo')) return;
            b.disabled = true;
            try {
                const r = await api('/api/agent-office/desk/inbox/review', 'POST', { kind: row.dataset.kind, id: row.dataset.id, undo: act === 'undo' });
                showToast(r.message || (act === 'undo' ? '다시 대기로 돌렸어요' : '확인했습니다'));
                await loadInbox();
                const a = inbApi(); try { if (a && a.refresh) a.refresh(true); } catch (err) { /* 창 숫자는 다음 주기에 */ }   // 창의 [답 안 한 것만 n]·탭 숫자도 같은 표식이라 바로 다시 받는다
                const nb = document.querySelector('#desk-inbox-list .desk-cu[data-kind="' + row.dataset.kind + '"][data-id="' + String(row.dataset.id).replace(/"/g, '') + '"] .desk-cu-ok'); if (nb) nb.focus({ preventScroll: true });
            } catch (err) { showToast(err && err.message ? err.message : '처리하지 못했어요'); b.disabled = false; }
        });
        $('desk-fs').addEventListener('change', e => { S.fs = e.target.value; S.sig = ''; renderList(); });
        $('desk-view').addEventListener('click', () => {
            S.view = S.view === 'chat' ? 'table' : 'chat';
            try { localStorage.setItem('akm_desk_view', S.view); } catch (e) { }
            S.sig = ''; renderList();
        });
        const fold = $('desk-board-fold');
        if (fold) fold.addEventListener('click', () => {
            const open = $('desk-board').classList.toggle('folded') === false;
            fold.setAttribute('aria-expanded', String(open));
            fold.textContent = open ? '현황판 접기' : '현황판 보기';
        });
        // 넓은 화면은 표, 좁은 화면은 카드(대표 확정 2026-09-29)
        const mq = window.matchMedia('(min-width: 1024px)');
        S.wide = mq.matches;
        const onMq = () => { if (S.wide === mq.matches) return; S.wide = mq.matches; renderList(); renderInbox(); };
        if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);
        $('desk-thumbs').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; S.images.splice(Number(b.dataset.i), 1); renderThumbs(); });
        $('desk-tabs').addEventListener('click', e => { const t = e.target.closest('.desk-tab'); if (t) setTab(t.dataset.tab); });
        $('desk-list').addEventListener('click', onListClick);
        // #476 [자세히 확인하기] = 그 칸을 화면 전체로 크게(같은 DOM이라 버튼·답 칸이 그대로 동작) · 닫기/Esc/뒤로가기로 원래 자리
        $('ao-desk-root').addEventListener('click', e => {
            const o = e.target.closest('[data-full-open]');
            if (o) { openFull($(o.dataset.fullOpen)); return; }
            if (e.target.closest('[data-full-close]')) closeFull();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') { const z = $('desk-zoom'); if (z && !z.hidden) { zoomClose(); return; } }
            if (e.key !== 'Escape' || !S.full) return;
            // 확인표 창 같은 다른 창이 위에 떠 있으면 그 창이 먼저 닫힌다
            if (Array.from(document.querySelectorAll('.modal-overlay')).some(m => getComputedStyle(m).display !== 'none')) return;
            closeFull();
        });
        window.addEventListener('popstate', hbPop);   // #677 뒤로가기는 이 한 곳에서
        hbSync();   // 새로고침 뒤 남은 칸을 걷는다
        try { new MutationObserver(() => {   // 확인표 창(app.js 가 body 에 붙였다 뗀다)도 겹으로 — 뒤로가기 = 그 창의 × 와 같음
            if (pageActive() && document.querySelector('body > .ao-settle-overlay')) hbPush('confirm', () => { document.querySelectorAll('body > .ao-settle-overlay .modal-close').forEach(b => b.click()); }, { deskConfirm: 1 });
            else hbDrop('confirm');
        }).observe(document.body, { childList: true }); } catch (e) { /* 창은 ×·저장으로 닫힌다 */ }
    }

    // ── #677(대표 10/12 「에이전트 오피스에서 뭐 누르고 뒤로가기 누르면 꺼지지 않고 전으로」) 뒤로가기 한 곳 ──
    //   눌러서 열리는 겹(자세히 보기 · [+] 메뉴 · 도구 카드 · 손님 연락 창·대화·사진·구매이력 · 고르기 창 · 사진 크게 · 확인표 창 · 탭)을 연 순서대로 HB.stack 에 쌓고, 기록(history)에는 「몇 겹째」(aoDesk)만 적는다.
    //   뒤로가기 = 맨 위 겹 하나만 닫힘(그 겹의 close) · 화면에서 닫으면(닫기·×·Esc) hbDrop 이 그 칸을 되돌린다 · 기록을 되돌리는 중(moving)에는 새 칸을 쌓지 않고 끝난 뒤에(겹이 꼬이지 않게 한 줄로)
    //   최종발주 창(foPanel · final-order.js)이 맨 위에 있는 동안에는 기록을 건드리지 않는다(그 창은 뒤로가기가 오면 스스로 닫힌다) · tag = 종전 표식(smsWin·deskFull·deskPlus) 그대로
    const HB = { stack: [], moving: false, mt: 0, idle: [] };
    const hbAt = () => { try { return Number(history.state && history.state.aoDesk) || 0; } catch (e) { return 0; } };
    const hbFo = () => { try { return !!(history.state && history.state.foPanel); } catch (e) { return false; } };
    const hbHas = k => HB.stack.some(e => e.k === k);
    // 다른 곳(app.js 의 메뉴 칸 등)이 지금 칸에 적어 둔 값은 그대로 이어 싣는다 — 우리 표식만 갈아 끼운다(#678 과 맞춘 약속)
    const HB_KEYS = ['aoDesk', 'k', 'smsWin', 'deskFull', 'deskPlus', 'deskTool', 'deskTab', 'deskZoom', 'deskPick', 'deskConfirm'];
    const hbBase = () => { const o = {}; let n = 0; try { const st = history.state; if (st && typeof st === 'object') Object.keys(st).forEach(k => { if (!HB_KEYS.includes(k)) { o[k] = st[k]; n++; } }); } catch (e) { /* 빈 값 */ } return n ? o : null; };
    const hbTouch = () => window.matchMedia('(max-width: 960px), (pointer: coarse)').matches;   // 폰·폴드(뒤로가기 단추가 있는 기기) — 작은 팝오버([+] 메뉴·고르기 창)는 여기서만 겹으로 센다
    function hbFlush() { if (HB.moving) return; const q = HB.idle.splice(0); q.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
    function hbIdle(fn) { if (HB.moving) HB.idle.push(fn); else fn(); }   // 기록을 되돌리는 중이면 끝난 뒤에(최종발주 창처럼 스스로 칸을 쌓는 것을 열 때)
    function hbSync() {
        if (HB.moving || hbFo()) return;
        const d = hbAt(), want = HB.stack.length;
        try {
            if (d > want) {
                HB.moving = true; clearTimeout(HB.mt);
                HB.mt = setTimeout(() => { HB.moving = false; try { if (hbAt() > HB.stack.length) history.replaceState(hbBase(), ''); } catch (e) { /* 그대로 */ } hbSync(); hbFlush(); }, 700);   // 되돌릴 칸이 없었으면(답 없음) 지금 칸을 바닥으로 삼는다
                history.go(want - d);
            } else for (let i = d; i < want; i++) history.pushState(Object.assign(hbBase() || {}, { aoDesk: i + 1, k: HB.stack[i].k }, HB.stack[i].tag), '');
        } catch (e) { HB.moving = false; }
    }
    function hbPush(k, close, tag) { if (hbHas(k) || hbFo()) return; HB.stack.push({ k, close, tag: tag || null }); hbSync(); }
    function hbDrop() { let n = 0; for (let j = 0; j < arguments.length; j++) { const k = arguments[j], i = HB.stack.findIndex(e => e.k === k); if (i >= 0) { HB.stack.splice(i, 1); n++; } } if (n) hbSync(); return n > 0; }
    function hbPop() {
        const own = HB.moving; HB.moving = false; clearTimeout(HB.mt);
        if (hbFo()) { hbFlush(); return; }
        if (!own) { const d = hbAt(); while (HB.stack.length > d) { const e = HB.stack.pop(); try { e.close(); } catch (er) { console.error(er); } } }   // 사람이 누른 뒤로가기 = 빠진 칸만큼 위에서부터 닫는다
        hbSync(); hbFlush();
    }
    const TOOLS = ['desk-ship', 'desk-qty', 'desk-price'];
    function toolPop() { const k = TOOLS.find(x => { const el = $(x); return el && !el.hidden; }); pkClose(false); toolShow(null); if (k) plusFocus(k.slice(5)); }
    const tabPop = () => { setTab('mine'); };
    // app.js(#678)는 메뉴가 바뀐 것을 조금 뒤에 알아채 메뉴 칸을 쌓는다 → 그 칸(akmNav.p = agent-office)이 선 뒤에 겹을 다시 쌓는다(먼저 쌓으면 앞 메뉴 값을 이어 실은 칸이 메뉴 칸 밑에 깔린다)
    function hbRestore(n) { let nav = null; try { nav = history.state && history.state.akmNav; } catch (e) { nav = null; } if (nav && nav.p && nav.p !== 'agent-office' && (n | 0) < 25) { setTimeout(() => { if (pageActive()) hbRestore((n | 0) + 1); }, 60); return; } if (TOOLS.some(x => { const el = $(x); return el && !el.hidden; })) hbPush('tool', toolPop, { deskTool: 1 }); if (S.tab && S.tab !== 'mine') hbPush('tab', tabPop, { deskTab: 1 }); }   // 다른 메뉴에 다녀온 뒤: 열려 있던 카드·탭을 다시 겹으로
    function hbLeave() { if (!HB.stack.length) return; plusClose(false); pkClose(false); zoomClose(); HB.stack.length = 0; hbSync(); }   // 다른 메뉴로 넘어감: 쌓아 둔 칸을 걷는다(그 메뉴에서의 뒤로가기가 헛돌지 않게)
    function zoomClose() { const z = $('desk-zoom'); if (z && !z.hidden) z.hidden = true; hbDrop('zoom'); }
    const PREVIEW_LIST = 5, PREVIEW_INBOX = 5;
    function openFull(sec) {
        if (!sec || S.full === sec) return;
        if (S.full) closeFull();
        S.full = sec;
        sec.classList.add('is-full');
        document.body.classList.add('desk-full-open');
        hbPush('full', () => closeFull(true), { deskFull: sec.id });
        sec.scrollTop = 0;
        const c = sec.querySelector('.desk-close'); if (c) c.focus({ preventScroll: true });
    }
    function closeFull(fromPop) {
        const sec = S.full;
        if (!sec) return;
        S.full = null;
        sec.classList.remove('is-full');
        document.body.classList.remove('desk-full-open');
        hbDrop('full');
        const m = sec.querySelector('.desk-more-all'); if (m && pageActive()) m.focus({ preventScroll: true });
    }
    function setMore(id, hidden) {
        const n = $(id) && $(id).querySelector('.n');
        if (n) n.textContent = hidden > 0 ? ` · ${hidden}건 더` : '';
    }

    // #501 입력칸: 적는 만큼 늘어나고(최대 240px), 글자 수는 1,500자를 넘을 때만 보인다
    function syncInput() {
        const t = $('desk-input'), c = $('desk-count');
        if (!t || !c) return;
        const n = t.value.length;
        c.textContent = n + ' / 2000'; c.hidden = n < 1500;
        t.style.height = 'auto';
        if (t.value) t.style.height = Math.min(t.scrollHeight + 2, 240) + 'px'; else t.style.height = '';
        // #550-b: 답 상자처럼 — 글도 첨부도 없으면 보내기가 꺼져 있다(보내는 중에는 건드리지 않는다)
        const sb = $('desk-send'); if (sb && sb.getAttribute('aria-busy') !== 'true') sb.disabled = !t.value.trim() && !S.images.length;
    }
    // #544(대표 GO 10/5) 첨부 = 이미지 또는 파일 1개(엑셀·CSV·PDF·텍스트 · 10MB 이내). 서버 약속: image_data(data URL) + image_mime + 파일이면 file_name
    const FILE_EXT = ['xlsx', 'xls', 'csv', 'pdf', 'txt'], ACCEPT_ALL = 'image/*,.xlsx,.xls,.csv,.pdf,.txt', MAX_FILE = 10 * 1024 * 1024, MAX_IMG = 9 * 1024 * 1024;
    const extOfName = n => { const m = String(n || '').match(/\.([A-Za-z0-9]{2,5})$/); return m ? m[1].toLowerCase() : ''; };
    const isImg = f => /^image\//.test(f.type || '');
    const isDoc = f => !isImg(f) && FILE_EXT.includes(extOfName(f.name));
    const sizeText = n => n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round((Number(n) || 0) / 1024)) + 'KB';
    function attachOk(f) {
        if (!isImg(f) && !isDoc(f)) { showToast('첨부할 수 있는 파일은 이미지 · 엑셀(xlsx·xls) · CSV · PDF · 텍스트(txt)예요: ' + f.name); return false; }
        if (f.size > (isImg(f) ? MAX_IMG : MAX_FILE)) { showToast('10MB보다 큰 ' + (isImg(f) ? '이미지' : '파일') + '는 보낼 수 없어요: ' + f.name); return false; }
        return true;
    }
    const ICON_FILE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
    const fileChip = (name, size, xAttr) => `<div class="desk-filechip"><span class="desk-filechip-ic">${ICON_FILE}</span><span class="desk-filechip-name">${esc(name)}</span><span class="desk-filechip-size">${esc(sizeText(size))}</span><button type="button" ${xAttr} aria-label="첨부 파일 빼기">×</button></div>`;
    const attMeta = o => o.file_name ? ' · 📎 ' + esc(o.file_name) : o.has_image ? ' · 이미지 첨부' : '';
    function addFiles(files) {
        const good = files.filter(attachOk), doc = good.find(isDoc);
        if (doc) {   // 파일은 1개만 — 여러 개를 골랐거나 이미지가 붙어 있었으면 첫 파일만 남긴다
            if (good.length > 1 || S.images.length) showToast('파일은 한 번에 1개만 보낼 수 있어요. 첫 파일만 붙였어요');
            const rd = new FileReader();
            rd.onload = () => { S.images = [{ data: String(rd.result), mime: doc.type || 'application/octet-stream', name: doc.name, size: doc.size, file: true }]; renderThumbs(); };
            rd.readAsDataURL(doc);
            return;
        }
        if (good.length && S.images.some(x => x.file)) S.images = [];   // 파일 대신 이미지로 바꿔 붙인다
        for (const f of good) {
            if (S.images.length >= 6) { showToast('이미지는 한 번에 6장까지 보낼 수 있어요'); break; }
            const rd = new FileReader();
            rd.onload = () => { S.images.push({ data: String(rd.result), mime: f.type || 'image/png', name: f.name }); renderThumbs(); };
            rd.readAsDataURL(f);
        }
    }
    function renderThumbs() {
        const box = $('desk-thumbs');
        box.hidden = !S.images.length;
        syncInput();
        box.innerHTML = S.images.map((im, i) => im.file ? fileChip(im.name, im.size, `data-i="${i}"`) : `<div class="desk-thumb"><img src="${im.data}" alt="첨부 ${i + 1}"><button type="button" data-i="${i}" aria-label="첨부 ${i + 1} 빼기">×</button></div>`).join('');
    }

    async function send() {
        if (S.sending) return;
        const input = $('desk-input');
        const content = input.value.trim();
        if (!content && !S.images.length) { input.focus(); return; }
        S.sending = true;
        const btn = $('desk-send');
        btn.disabled = true; btn.setAttribute('aria-busy', 'true');
        const newIds = [];
        const idOf = r => r && r.order && r.order.id;
        try {
            if (S.images.length) {
                const imgs = S.images.slice();
                for (const im of imgs) newIds.push(idOf(await api('/api/agent-office/orders', 'POST', im.file
                    ? { content: content || '첨부한 파일을 확인해줘', image_data: im.data, image_mime: im.mime, file_name: im.name }
                    : { content: content || '정산관리에 올려줘', image_data: im.data, image_mime: im.mime })));
                showToast(imgs[0].file ? '파일과 함께 지시를 보냈어요' : `지시 ${imgs.length}건을 보냈어요`);
            } else {
                newIds.push(idOf(await api('/api/agent-office/orders', 'POST', { content })));
                showToast('지시를 보냈어요');
            }
            input.value = ''; syncInput();
            S.images = []; renderThumbs();
            // #476 보낸 지시가 바로 보이게: 내 지시 · 전체 상태로 돌리고 새 카드로 이동 + 잠깐 강조
            if (S.fs !== 'all') { S.fs = 'all'; $('desk-fs').value = 'all'; }
            if (S.tab !== 'mine') await setTab('mine'); else { S.sig = ''; await loadOrders(true); }
            revealOrders(newIds.filter(Boolean));
        } catch (err) {
            showToast('보내지 못했어요: ' + (err && err.message ? err.message : '다시 시도해 주세요'));
        } finally {
            S.sending = false; btn.disabled = false; btn.removeAttribute('aria-busy'); syncInput();
        }
    }

    // ── #594 배송조회(대표 10/8) — 알약 [배송조회 확인하기] → 서버가 CJ대한통운에 직접 물어본 결과를 이 카드에 그린다(창구·AI를 거치지 않는다)
    //   서버: POST /api/delivery/track · GET /api/delivery/track/status · GET /api/delivery/summary · POST /api/delivery/shipments/upload
    const SHIP = { timer: 0, data: null, busy: false, seq: 0, pick: null, q: '', list: null, lseq: 0, qt: 0, rkey: '', asked: '' };   // asked = 이 카드에서 [조회]를 누른 기간(from|to) — 「카톡에 올릴 요약」은 그 기간에만 뜬다(대표 10/10 저녁)
    const kstDay = off => new Date(Date.now() + 9 * 3600e3 + (off || 0) * 86400e3).toISOString().slice(0, 10);
    const nfmt = n => (Number(n) || 0).toLocaleString('ko-KR');
    const mdOf = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? m[2] + '/' + m[3] : String(d || ''); };
    const SHIP_KEYS = ['배송완료', '배송출발', '간선상하차', '집화', '미배송', '사고', '기타', '조회실패', '미조회'];
    const SHIP_BADGE = { '사고': 'err', '미배송': 'ask', '집화': 'wait', '집화 정체': 'wait', '기타': 'mute', '조회실패': 'mute', '미조회': 'mute' };
    const SHIP_EMPTY = '그 기간 송장이 아직 안 올라왔어요. 아래에 택배사 엑셀을 끌어다 놓거나, 대표 PC에서 송장이 올라오기를 기다려 주세요.';
    // ── #653-나(대표 10/11 「+ 를 누르면 파일·이미지, 중간발주, 최종발주, 정산이미지 … 보기 좋게」) ──
    //   입력 칸 왼쪽 [+] 하나 → 묶음별 판(첨부 · 발주 · 확인 · 손님). PC = 단추 아래 팝오버 · 폰 = 아래에서 올라오는 시트. ↑↓ Home End · Enter · Esc · 바깥 누름.
    //   [+] 옆 바로가기 = 안 읽은 문자가 있으면 「문자 n」 하나뿐(종전 「최근에 쓴 것 2개」는 대표 10/11 지시로 뺌). 바로가기는 메뉴 항목을 대신 눌러 주는 것뿐(동작은 한 곳).
    const PLUS_ID = { attach: 'desk-attach', settle: 'desk-settle-now', qty: 'desk-qty-now', final: 'desk-final-now', ship: 'desk-ship-now', price: 'desk-price-now', sms: 'desk-sms-now' };
    const PLUS_NAME = { settle: '정산 이미지', qty: '중간발주', final: '최종발주', ship: '배송조회', price: '가격 확인', sms: '문자' };
    const PLUS_KEY = 'akm_desk_plus_recent';
    // 대표 10/11(라이브 실물): 「중간발주·최종발주 뜨는 건 없도록」 → 기본·최근 바로가기는 없앤다(메뉴는 [+] 안에서만). 남는 바로가기 = 안 읽은 문자가 있을 때의 「문자 n」 하나
    try { localStorage.removeItem(PLUS_KEY); } catch (e) { /* 옛 기억 지우기 — 못 지워도 쓰지 않는다 */ }
    function plusRecent() { return []; }
    function plusUsed() { /* 최근 기억 없음 */ }
    function plusShorts() {
        const box = $('desk-shorts'); if (!box) return;
        const custN = custNums().total, keys = plusRecent().concat(custN > 0 ? ['sms'] : []);
        const off = k => { const t = $(PLUS_ID[k]); return !!(t && t.disabled); };
        const html = keys.map(k => `<button type="button" class="desk-chip desk-short${k === 'sms' ? ' sms-chip' : ''}" id="desk-short-${k}" data-go="${k}"${k === 'sms' && smsDead() ? ' data-dead="1"' : ''}${off(k) ? ' disabled' : ''}>${k === 'sms' && custHasInb() ? '손님' : PLUS_NAME[k]}${off(k) && k === 'qty' ? '<small>집계 중</small>' : ''}${k === 'sms' ? `<i class="sms-n">${custN > 99 ? '99+' : custN}</i>` : ''}</button>`).join('');
        if (box.dataset.sig === html) return;
        const had = document.activeElement && document.activeElement.closest && document.activeElement.closest('#desk-shorts') ? document.activeElement.id : '';
        box.dataset.sig = html; box.innerHTML = html;
        if (had && document.getElementById(had)) document.getElementById(had).focus({ preventScroll: true });
    }
    const plusItems = () => Array.from(document.querySelectorAll('#desk-plus .desk-mi')).filter(b => !b.hidden && !b.disabled);
    const PLUS = { hist: false, skip: 0, after: null, replay: false };
    const plusSheet = () => window.matchMedia('(max-width: 720px)').matches;   // 폰 = 아래 시트
    function plusOpen() {
        const m = $('desk-plus'), b = $('desk-plus-btn'); if (!m || !m.hidden) return;
        custMenu();   // #668 「손님」 묶음 = 지난 기억으로 바로(답이 오면 그대로 맞춰진다)
        m.hidden = false; $('desk-plus-back').hidden = false; b.setAttribute('aria-expanded', 'true');
        m.style.maxHeight = getComputedStyle(m).position === 'absolute' ? Math.max(220, Math.round(window.innerHeight - m.getBoundingClientRect().top - 16)) + 'px' : '';   // PC 팝오버는 화면 아래로 넘치지 않게(넘치면 판 안에서 스크롤)
        document.body.classList.add('desk-plus-open');   // 폰 시트가 떠 있는 동안 뒤 화면 스크롤 잠금(CSS 가 폰 폭에서만)
        if (hbTouch()) hbPush('plus', () => plusClose(true), { deskPlus: 1 });   // 폰: 뒤로가기 = 시트 닫기(페이지를 떠나지 않게 · 문자 창과 같은 방식)
        const first = plusItems()[0]; if (first) first.focus({ preventScroll: true });
    }
    // 돌려주는 값 true = 닫으면서 기록을 한 칸 되돌리는 중(곧 popstate 가 온다 — 이어서 기록을 쌓을 일은 그 뒤에)
    function plusClose(focusBtn, fromPop) {
        const m = $('desk-plus'); if (!m || m.hidden) return false;
        m.hidden = true; $('desk-plus-back').hidden = true; const b = $('desk-plus-btn'); b.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('desk-plus-open');
        if (focusBtn) b.focus({ preventScroll: true });
        hbDrop('plus');
        return false;
    }
    // 도구를 닫았을 때 초점이 돌아갈 곳 — 그 일의 바로가기가 떠 있으면 거기, 아니면 [+]
    function plusFocus(k) { const el = document.getElementById('desk-short-' + k) || $('desk-plus-btn'); if (el && !el.hidden) el.focus({ preventScroll: true }); }
    // E: 중간발주가 집계 중이면 메뉴 항목·바로가기 둘 다 꺼진 모양 + 「집계 중」
    function plusBusy() { const it = $('desk-qty-now'); if (it) { if (it.disabled) it.dataset.busy = '집계 중'; else delete it.dataset.busy; } plusShorts(); }
    function plusBind() {
        const btn = $('desk-plus-btn'), menu = $('desk-plus');
        btn.addEventListener('click', () => { if (menu.hidden) plusOpen(); else plusClose(true); });
        $('desk-plus-back').addEventListener('click', () => plusClose(true));
        menu.addEventListener('click', e => { const it = e.target.closest('.desk-mi'); if (!it) return; plusClose(false); plusUsed(it.dataset.mk); });   // 항목 자신의 누름 처리가 먼저 돈 뒤 판을 닫는다
        menu.addEventListener('keydown', e => {
            const items = plusItems(), i = items.indexOf(document.activeElement);
            const go = n => { e.preventDefault(); const t = items[(n + items.length) % items.length]; if (t) t.focus({ preventScroll: true }); };
            if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1); else if (e.key === 'Home') go(0); else if (e.key === 'End') go(items.length - 1);
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); plusClose(true); }
            else if (e.key === 'Tab') { e.preventDefault(); plusClose(true); }   // G: Tab 으로 나가면 판을 닫고 초점은 [+] 로
        });
        btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && menu.hidden) { e.preventDefault(); plusOpen(); } });
        document.addEventListener('mousedown', e => { if (!menu.hidden && !e.target.closest('#desk-plus, #desk-plus-btn, #desk-plus-back')) plusClose(false); });
        $('desk-shorts').addEventListener('click', e => { const s = e.target.closest('.desk-short'); if (!s) return; if (s.dataset.go === 'sms' && inbOk()) { inbOpenFirst(); return; } const t = $(PLUS_ID[s.dataset.go]); if (t && !t.disabled) { t.click(); plusUsed(s.dataset.go); } });
        plusShorts();
    }
    function toolShow(id) {   // 도구 카드는 한 번에 하나만
        plusClose(false);   // #653-나: 다른 카드·창이 뜨면 [+] 메뉴는 닫는다
        if (TOOLS.includes(id)) hbPush('tool', toolPop, { deskTool: 1 }); else hbDrop('tool');   // #677 배송조회·중간발주·가격 카드 = 겹 하나(카드끼리 바꿔도 한 칸)
        if (id !== 'desk-sms') smsWinCleanup();   // #653: 문자 창이 떠 있었으면 창 흔적(스크롤 잠금·뒤로가기 기록)을 걷는다
        ['desk-ship', 'desk-qty', 'desk-sms', 'desk-price'].forEach(k => { const el = $(k); if (el) el.hidden = k !== id; });   // desk-price(#612)는 처음 열 때 생긴다
        if (id !== 'desk-ship') clearTimeout(SHIP.timer);
        const el = id && $(id); if (el) el.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    function shipNote(text, kind) { const n = $('ship-note'); n.hidden = !text; n.textContent = text || ''; n.dataset.k = kind || ''; }
    function shipProg(st) {
        const box = $('ship-prog'); box.hidden = !st;
        $('ship-go').disabled = !!st; const f = document.getElementById('ship-force'); if (f) f.disabled = !!st;
        if (!st) return;
        const total = Number(st.total) || 0, done = Math.min(Number(st.done) || 0, total || Infinity);
        $('ship-prog-text').textContent = total ? '조회 중' : '송장을 모으는 중';
        $('ship-prog-n').textContent = total ? nfmt(done) + ' / ' + nfmt(total) : '';
        $('ship-prog-bar').style.transform = 'scaleX(' + (total ? Math.max(0.02, done / total) : 0.02) + ')';
    }
    function shipRange() {
        let from = $('ship-from').value.trim(), to = $('ship-to').value.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = kstDay(-1);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = from;
        if (from > to) { const t = from; from = to; to = t; }
        $('ship-from').value = from; $('ship-to').value = to;
        return { from, to };
    }
    function shipOpen() {
        toolShow('desk-ship');
        if (!$('ship-from').value) { $('ship-from').value = kstDay(-1); $('ship-to').value = kstDay(-1); }   // 기본 = 어제 발송분
        SHIP.asked = '';   // 카드를 열 때마다 요약은 숨긴 채로 — [조회]를 눌러 지금 상태를 확인한 뒤에만 보인다(앞 조회 결과 숫자는 「○ 기준」과 함께 그대로)
        shipCheck(true);
    }
    // 열 때·[조회] 뒤: 서버에 도는 조회가 있으면 진행 줄, 없으면 마지막 결과를 그린다
    async function shipCheck(first) {
        clearTimeout(SHIP.timer);
        if ($('desk-ship').hidden) return;
        const seq = ++SHIP.seq;
        let st;
        try { st = await api('/api/delivery/track/status'); } catch (e) { shipProg(null); shipNote('조회 상태를 불러오지 못했어요: ' + (e && e.message ? e.message : '다시 시도해 주세요'), 'err'); return; }
        if (seq !== SHIP.seq || $('desk-ship').hidden) return;
        if (st && st.state === 'running') {
            if (first && st.from) { $('ship-from').value = st.from; $('ship-to').value = st.to || st.from; SHIP.asked = st.from + '|' + (st.to || st.from); }   // 이미 도는 조회에 붙었으면 끝난 뒤 요약이 뜬다
            shipProg(st); shipNote('');
            SHIP.timer = setTimeout(() => shipCheck(false), 2000);
            return;
        }
        shipProg(null);
        if (st && st.state === 'error' && !first) shipNote('조회하다 멈췄어요: ' + (st.error || '다시 눌러 주세요'), 'err');
        await shipLoad();
    }
    async function shipLoad() {
        const r = shipRange(), out = $('ship-out');
        let d;
        try { d = await api('/api/delivery/summary?from=' + r.from + '&to=' + r.to); }
        catch (e) { out.innerHTML = ''; shipNote((e && e.message) || '불러오지 못했어요', 'err'); return; }
        if (r.from !== $('ship-from').value || r.to !== $('ship-to').value) return;   // 그 사이 날짜를 바꿨다
        SHIP.data = d;
        const rkey = r.from + '|' + r.to;   // #597: 다시 받아도 고른 칸·검색어는 그대로 — 날짜가 바뀌었을 때만 「확인할 건」으로
        if (SHIP.rkey !== rkey) { SHIP.rkey = rkey; SHIP.pick = null; SHIP.q = ''; SHIP.list = null; SHIP.lseq++; }
        if (!d || d.ok === false || !(Number(d.shipments) > 0)) { out.innerHTML = `<div class="desk-empty ship-empty">${esc((d && d.error) || SHIP_EMPTY)}</div>`; $('ship-drop').classList.add('want'); return; }
        $('ship-drop').classList.remove('want');
        if (!(Number(d.checked) > 0)) { out.innerHTML = `<div class="desk-empty ship-empty">송장 ${nfmt(d.shipments)}건이 올라와 있고 아직 조회하지 않았어요. [조회]를 누르면 CJ대한통운에 물어봐요.</div>`; return; }
        out.innerHTML = shipHtml(d);
        shipDetail();
        if (SHIP.pick || SHIP.q) shipList();
    }
    function shipHtml(d) {
        const c = d.counts || {}, tr = Array.isArray(d.trouble) ? d.trouble : [], bd = Array.isArray(d.by_date) ? d.by_date : [];
        const keys = SHIP_KEYS.filter(k => k in c || ['배송완료', '배송출발', '간선상하차', '미배송', '사고'].includes(k));
        // #597: 건수가 있는 칸은 누르면 그 상태만 아래 표에(0건 칸은 안 눌림)
        const stat = keys.map(k => `<li data-k="${SHIP_BADGE[k] && Number(c[k]) > 0 ? SHIP_BADGE[k] : ''}"${Number(c[k]) > 0 ? ` data-b="${esc(k)}" role="button" tabindex="0" aria-pressed="false"` : ''}><span>${esc(k)}</span><b>${nfmt(c[k])}</b></li>`).join('');
        const cell = (x, k, v) => `<button type="button" class="ship-cell" data-b="${esc(k)}" data-d="${esc(String(x.date || '').slice(0, 10))}" data-p="${esc(x.partner || '')}" aria-pressed="false">${nfmt(v)}</button>`;
        const when = d.checked_at ? kst(d.checked_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const byCols = SHIP_KEYS.filter(k => bd.some(x => x.counts && Number(x.counts[k]) > 0) || ['배송완료', '배송출발', '간선상하차'].includes(k));
        const byTable = bd.length ? `<h4 class="ship-h">발송일·거래처별</h4><div class="desk-md-tw ship-tw"><table class="desk-md-t ship-by"><thead><tr><th>발송일</th><th>거래처</th><th class="num">송장</th>${byCols.map(k => `<th class="num">${esc(k)}</th>`).join('')}</tr></thead><tbody>`
            + bd.map(x => `<tr><td>${esc(mdOf(x.date))}</td><td>${esc(x.partner || '')}</td><td class="num">${Number(x.n) > 0 ? cell(x, '', x.n) : nfmt(x.n)}</td>${byCols.map(k => { const v = Number(x.counts && x.counts[k]) || 0; return `<td class="num${v && (k === '미배송' || k === '사고') ? ' warn' : ''}">${v ? cell(x, k, v) : '<i>0</i>'}</td>`; }).join('')}</tr>`).join('') + '</tbody></table></div>' : '';
        const asked = !!SHIP.asked && SHIP.asked === SHIP.rkey;   // [조회]를 누르기 전에는 요약을 안 보인다(앞 조회 때 글을 지금 것처럼 복사해 올리지 않게)
        return (!asked ? `<div class="desk-empty ship-sum-wait" id="ship-sum-wait">카톡에 올릴 요약은 [조회]를 누르면 떠요. 아래 숫자는 마지막으로 조회한 결과예요${when ? '(' + esc(when) + ' 기준)' : ''}.</div>` : `<section class="desk-sec ship-sum" aria-label="카톡에 올릴 요약"><div class="desk-sec-head"><b>카톡에 올릴 요약</b><button type="button" class="desk-sec-copy" id="ship-copy" aria-label="요약 복사">복사</button></div><div class="desk-sec-body"><div class="ship-sum-text" id="ship-sum-text">${esc(d.summary_text || '')}</div></div></section>`)
            + `<ul class="ship-stat" aria-label="상태별 건수">${stat}</ul>`
            + `<div class="ship-meta"><span>송장 ${nfmt(d.shipments)}건 중 ${nfmt(d.checked)}건 조회${Number(d.shipments) > Number(d.checked) ? ' (아직 ' + nfmt(d.shipments - d.checked) + '건은 [조회]를 눌러야 해요)' : ''}${d.dup && Number(d.dup.person) > 0 ? ' · 같은 분 여러 상자 ' + nfmt(d.dup.person) + '건' : ''}${when ? ' · ' + esc(when) + ' 기준' : ''}</span><button type="button" class="desk-btn sm" id="ship-force" title="배송완료로 확인된 건까지 전부 다시 물어봐요">전부 다시 조회</button></div>`
            + byTable
            + '<div class="ship-detail" id="ship-detail"></div>';
    }
    // ── #597(대표 10/8 밤): 아래 표 = 평소엔 「확인할 건」(summary.trouble) · 숫자 칸을 누르면 그 상태만(GET /api/delivery/list) · 같은 분 여러 상자는 한 줄 · 줄마다 [처리함]
    const shipKey = p => p ? [p.bucket || '', p.from || '', p.partner || ''].join('|') : '';
    const shipHm = at => { const t = new Date(new Date(at).getTime() + 9 * 3600e3); return isNaN(t) ? '' : `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`; };
    // 같은 분(이름·끝 4자리·지역)이고 상태도 같을 때만 한 줄로 — 한 상자만 미배송이면 따로 둔다. 처리한 줄은 아래로
    // #613(대표 10/10): 며칠째(days)는 서버가 발송일 기준으로 센다(발송 다음 날 = 1 · 완료 건은 완료한 날까지 · 그 밖은 오늘까지). 완료 시각 = delivered_at 「2026-10-08 15:34」
    const shipDoneAt = i => { const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(i.delivered_at || '')); return m ? Number(m[2]) + '/' + Number(m[3]) + ' ' + m[4] + ':' + m[5] : (i.event_time ? shipHm(i.event_time) : ''); };
    // 찾는 글 다듬기: 숫자·하이픈·빈칸뿐이면 숫자만 남긴다 — 전화번호 통째(0으로 시작 · 9~11자리)는 받는 분 연락처 끝 4자리로, 운송장은 하이픈만 뺀다
    function shipQNorm(v) {
        const t = String(v || '').trim();
        if (!/^[\d\s.\-]+$/.test(t)) return t;
        const d = t.replace(/\D/g, '');
        return /^0\d{8,10}$/.test(d) ? d.slice(-4) : d;
    }
    function shipGroup(rows) {
        const out = [], at = new Map();
        rows.forEach(x => {
            const k = x.recipient ? [x.recipient, x.phone_tail || '', x.region || '', x.bucket || ''].join('\u0001') : '';
            const g = k && at.get(k);
            if (g) g.items.push(x); else { const n = { items: [x] }; out.push(n); if (k) at.set(k, n); }
        });
        return out;   // #619(대표 10/10 「처리함은 의미 없음」): 처리한 줄을 아래로 보내지 않는다 — 서버가 준 순서 그대로
    }
    const shipMd = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? Number(m[2]) + '/' + Number(m[3]) : ''; };
    function shipTable(rows) {
        const tel = p => { const g = String(p || '').replace(/[^\d+]/g, ''); return g ? `<a class="ship-tel" href="tel:${esc(g)}">${esc(p)}</a>` : ''; };
        const uniq = a => a.filter((v, i) => v && a.indexOf(v) === i);
        return `<div class="desk-md-tw ship-tw"><table class="desk-md-t ship-tr"><thead><tr><th>상태</th><th>받는 분</th><th>품목</th><th>상태 내용</th><th class="num">발송일</th><th>담당기사</th><th>운송장</th><th>진행상황</th></tr></thead><tbody>`
            + shipGroup(rows).map(g => {
                const x = g.items[0], n = g.items.length;
                const dr = g.items.map(i => i.driver).find(v => v && (v.name || v.phone)) || {}, days = Math.max(...g.items.map(i => Number(i.days) || 0));
                const fin = x.delivered === true || x.bucket === '배송완료', finAt = fin ? g.items.map(shipDoneAt).filter(Boolean).pop() || '' : '';
                const what = [x.label, x.msg && x.msg !== x.label ? x.msg : ''].filter(Boolean).map(esc).join('<br>');
                const where = [x.event_time ? kst(x.event_time, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '', x.branch].filter(Boolean).map(esc).join(' · ');
                const opts = uniq(g.items.map(i => esc(i.option || '') + (Number(i.qty) > 1 ? ` <b>× ${nfmt(i.qty)}</b>` : ''))).join('<br>');
                const trs = g.items.map(i => String(i.tracking || '')).filter(Boolean);
                // #619: 진행상황 = 도착(완료 시각) / 미도착(3일 이상이면 진한 빨강 · 며칠째는 그 아래 작은 글) — [처리함] 버튼은 뺐다(서버 라우트·handled_at 은 그대로 있다)
                const state = fin ? `<b class="ship-st ok">도착</b>${finAt ? `<small>${esc(finAt)}</small>` : ''}`
                    : `<b class="ship-st no${days >= 3 ? ' late' : ''}">미도착</b>${days > 0 ? `<small>${days}일째</small>` : ''}`;
                return `<tr><td><span class="desk-badge" data-k="${SHIP_BADGE[x.bucket] || 'mute'}">${esc(x.bucket || '확인')}</span></td>`
                    + `<td class="ship-who">${esc(x.recipient || '')}${n > 1 ? ` <em class="ship-box">× ${n}상자</em>` : ''}${x.phone_tail ? `<small>끝 ${esc(x.phone_tail)}</small>` : ''}${x.region ? `<small>${esc(x.region)}</small>` : ''}</td>`
                    + `<td class="ship-opt">${opts}</td>`
                    + `<td class="ship-what">${what || '<i>내용 없음</i>'}${where ? `<small>${where}</small>` : ''}${x.memo ? `<small class="memo" title="${esc(x.memo)}">손님 메모 · ${esc(x.memo)}</small>` : ''}</td>`
                    + `<td class="num ship-date">${esc(uniq(g.items.map(i => shipMd(i.ship_date))).join(' · '))}</td>`
                    + `<td class="ship-drv">${esc(dr.name || '')}${tel(dr.phone)}</td>`
                    + `<td class="ship-no">${trs.map(t => `<span class="ship-trk">${esc(t)}</span>`).join('')}<small>${esc(uniq(g.items.map(i => i.partner || '')).join(' / '))}</small></td>`
                    + `<td class="ship-state">${state}</td></tr>`;
            }).join('') + '</tbody></table></div>';
    }
    function shipDetail() {
        const box = document.getElementById('ship-detail'); if (!box) return;
        const p = SHIP.pick, d = SHIP.data || {}, key = shipKey(p), mode = p ? 'L' + key : 'T', finding = !p && !!SHIP.q;   // finding = 「확인할 건」에서 찾는 중(그 기간 전체)
        $('ship-out').querySelectorAll('[aria-pressed]').forEach(el => el.setAttribute('aria-pressed', String(!!p && [el.dataset.b || '', el.dataset.d || '', el.dataset.p || ''].join('|') === key)));
        { const qi = $('ship-q'); if (qi) { qi.disabled = false; if (shipQNorm(qi.value) !== SHIP.q) qi.value = SHIP.q || ''; } }   // #621: 찾기 칸은 위쪽 [조회] 옆에 늘 있다 — 칸을 바꾸면(SHIP.q 비움) 칸 글도 비운다
        if (box.dataset.mode !== mode) {   // 머리(검색 칸)는 칸을 바꿀 때만 새로 그린다 — 검색어를 적는 동안 초점이 날아가지 않게
            box.dataset.mode = mode;
            box.innerHTML = `<div class="ship-dhead"><h4 class="ship-h" id="ship-dh"></h4>${p ? `<button type="button" class="desk-btn sm" id="ship-all" title="확인할 건으로 돌아가요">전체</button>` : ''}</div><div class="ship-dnote" id="ship-dnote" role="status" hidden></div><div id="ship-dbody"></div>`;
        }
        const useL = !!p || finding, L = useL ? SHIP.list : null, rows = useL ? (L ? L.rows : []) : (Array.isArray(d.trouble) ? d.trouble : []);
        const label = p ? (p.from ? `${mdOf(p.from)} ${p.partner} · ${p.bucket || '전체'}` : p.bucket) : finding ? '찾은 건' : '확인할 건';
        $('ship-dh').innerHTML = `${esc(label)} <b>${useL && !L ? '…' : nfmt(useL ? L.total : rows.length)}</b>`;
        const note = $('ship-dnote'), body = $('ship-dbody');
        const more = L && !L.error && L.total > rows.length, rg = shipRange(), span = rg.from === rg.to ? mdOf(rg.from) : mdOf(rg.from) + '~' + mdOf(rg.to);
        const noteText = more ? `${nfmt(rows.length)}건까지 보여요. 이름·끝 4자리·운송장으로 찾아보세요.` : (finding && L && !L.error ? `발송일 ${span} 송장 전체${Number(d.shipments) > 0 ? ' ' + nfmt(d.shipments) + '건 중' : ''}에서 찾았어요.${rows.length ? '' : ' 안 보이면 위에서 발송일 기간을 넓혀 [조회]해 보세요.'}` : '');
        // #613-b: 이 기간에 없는데 다른 발송일에 같은 조건이 있으면(서버 outside) 그 날짜로 바로 가는 버튼
        const outs = finding && L && !L.error && !rows.length && L.outside && Array.isArray(L.outside.ship_dates) ? L.outside.ship_dates.filter(o => o && /^\d{4}-\d{2}-\d{2}/.test(String(o.date))).slice(0, 5) : [];
        note.hidden = !noteText && !outs.length;
        if (outs.length) note.innerHTML = esc(`발송일 ${span} 에는 없어요. `) + outs.map(o => `<span class="ship-outside">${esc(mdOf(o.date))} 발송분에 ${nfmt(o.n)}건 있어요 <button type="button" class="desk-btn ship-out-go" data-d="${esc(String(o.date).slice(0, 10))}">그 날짜로 보기</button></span>`).join(' ');
        else note.textContent = noteText;
        if (useL && !L) { body.setAttribute('aria-busy', 'true'); if (!body.firstChild) body.innerHTML = '<div class="desk-empty ship-empty">불러오는 중</div>'; return; }
        body.removeAttribute('aria-busy');
        if (L && L.error) body.innerHTML = `<div class="desk-empty ship-empty">${esc(L.error)}</div>`;
        else if (!rows.length) body.innerHTML = `<div class="desk-empty ship-empty">${useL ? (SHIP.q ? `「${esc(SHIP.q)}」로 찾은 건이 없어요.` : '해당하는 건이 없어요.') : '확인할 건이 없어요. 미배송·사고 0건입니다.'}</div>`;
        else body.innerHTML = shipTable(rows);
    }
    function shipPick(el) {
        let p = el ? { bucket: el.dataset.b || '', from: el.dataset.d || '', partner: el.dataset.p || '' } : null;
        if (p && shipKey(p) === shipKey(SHIP.pick)) p = null;   // 같은 칸을 다시 누르면 확인할 건으로
        clearTimeout(SHIP.qt); SHIP.pick = p; SHIP.q = ''; SHIP.list = null; SHIP.lseq++;
        shipDetail();
        if (p) shipList();
    }
    async function shipList() {
        const p = SHIP.pick;
        if (!p && !SHIP.q) { SHIP.list = null; SHIP.lseq++; shipDetail(); return; }   // 찾는 글을 지우면 「확인할 건」으로(서버에 안 묻는다)
        const r = shipRange(), seq = ++SHIP.lseq;
        const qs = new URLSearchParams({ from: (p && p.from) || r.from, to: (p && p.from) || r.to });
        if (p && p.bucket) qs.set('bucket', p.bucket);
        if (p && p.partner) qs.set('partner', p.partner);
        if (SHIP.q) qs.set('q', SHIP.q);
        qs.set('limit', '300');
        let d, err = '';
        try { d = await api('/api/delivery/list?' + qs.toString()); } catch (e) { err = (e && e.message) || '불러오지 못했어요'; }
        if (seq !== SHIP.lseq || SHIP.pick !== p) return;
        if (!err && (!d || d.ok === false)) err = (d && d.error) || '불러오지 못했어요';
        const rows = !err && Array.isArray(d.rows) ? d.rows : [];
        SHIP.list = { rows, total: err ? 0 : Math.max(Number(d.total) || 0, rows.length), error: err, outside: !err && d.outside && Number(d.outside.n) > 0 ? d.outside : null };
        shipDetail();
    }
    async function shipGo(force) {
        if (SHIP.busy) return;
        const r = shipRange();
        SHIP.busy = true; shipNote(''); shipProg({ total: 0, done: 0 });
        try {
            const res = await api('/api/delivery/track', 'POST', force ? { from: r.from, to: r.to, force: true } : { from: r.from, to: r.to });
            if (!res || res.ok === false) {
                shipProg(null);
                if (res && res.need_upload) { $('ship-out').innerHTML = `<div class="desk-empty ship-empty">${esc(res.error || SHIP_EMPTY)}</div>`; $('ship-drop').classList.add('want'); }
                else shipNote((res && res.error) || '조회를 시작하지 못했어요', 'err');
                return;
            }
            SHIP.asked = r.from + '|' + r.to;
            if (res.job && res.job.state === 'running') shipProg(res.job);
            SHIP.timer = setTimeout(() => shipCheck(false), res.job && res.job.state === 'running' ? 2000 : 0);
        } catch (e) {
            shipProg(null);
            const m = (e && e.message) || '다시 시도해 주세요';
            if (/송장/.test(m)) { $('ship-out').innerHTML = `<div class="desk-empty ship-empty">${esc(m)}</div>`; $('ship-drop').classList.add('want'); }
            else shipNote('조회를 시작하지 못했어요: ' + m, 'err');
        } finally { SHIP.busy = false; }
    }
    // 송장 엑셀 올리기 — 서버가 받는 꼴 = JSON { name, data(base64), date? } · 발송일은 파일 이름의 「10.07」에서 읽고, 이름에 날짜가 없으면 지금 고른 발송일로 한 번 더 보낸다
    const fileB64 = file => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.onerror = () => rej(new Error('파일을 읽지 못했어요')); fr.readAsDataURL(file); });
    async function shipUpload(file) {
        const msg = $('ship-up-msg');
        if (!file) return;
        if (!/\.xlsx$/i.test(file.name || '')) { msg.dataset.k = 'err'; msg.textContent = '엑셀 파일(xlsx)만 올릴 수 있어요'; return; }
        if (file.size > 12 * 1024 * 1024) { msg.dataset.k = 'err'; msg.textContent = '파일이 너무 커요(12MB까지)'; return; }
        msg.dataset.k = ''; msg.textContent = '올리는 중';
        $('ship-pick').disabled = true;
        try {
            const data = await fileB64(file);
            let d, byPick = false;
            try { d = await api('/api/delivery/shipments/upload', 'POST', { name: file.name, data }); }
            catch (e) { if (!/발송일을 알 수 없/.test((e && e.message) || '')) throw e; byPick = true; d = await api('/api/delivery/shipments/upload', 'POST', { name: file.name, data, date: shipRange().from }); }
            if (!d || d.ok === false) throw new Error((d && d.error) || '올리지 못했어요');
            msg.dataset.k = 'ok'; msg.textContent = `${d.date ? mdOf(d.date) + ' ' : ''}송장 ${nfmt(d.rows)}건을 올렸어요${byPick ? ' (파일 이름에 날짜가 없어 고른 발송일로 넣었어요)' : ''}`;
            if (d.date && /^\d{4}-\d{2}-\d{2}/.test(d.date)) { $('ship-from').value = String(d.date).slice(0, 10); $('ship-to').value = String(d.date).slice(0, 10); }
            shipNote(''); await shipLoad();
        } catch (e) { msg.dataset.k = 'err'; msg.textContent = (e && e.message) || '올리지 못했어요'; }
        finally { $('ship-pick').disabled = false; }
    }

    // ── #595 중간발주(대표 10/8) — 대기 프로그램(대표 PC)이 그리던 거래처별 그림을 브라우저가 바로 그린다
    //   주문 조회·옵션 매칭·사이즈 꼬리·색·거래처 판정은 app.js 의 송장변환 함수를 그대로 부른다(addSizeSuffix · matchProduct · qtyCategory · aoItemPartner · aoLoadInvoicePricing — 복사하지 않는다).
    //   표 모양·묶는 법은 종전 그림(scripts/desk/qty-image.js)과 같다: 거래처별 한 장 · 이름 가나다순 · 사이즈 요청은 따로 줄 · 미매칭은 따로 한 장 · 최근 20일.
    //   「효돈 것만」「지난주 것」처럼 조건이 붙은 말은 종전대로 채팅(창구)으로 보낸다.
    const QTY = { busy: false, urls: [], blobs: new Map(), base: null, extra: [], draft: null, xday: '', xopen: false };
    const QTY_DAYS = 20;
    const QTY_BG = { yellow: '#FFFF00', orange: '#F4B183', blue: '#BDD7EE', green: '#C6E0B4', pink: '#F4CCCC', none: '#FFFFFF' };   // 거래처에 보내는 그림 색(styles.css .qty-cat-* 와 같은 값 · 야간에도 그대로)
    const QTY_SIZE = /^(.*?)\s+(2S|S|M)사이즈로!$/;
    function qtyNote(text, kind) { const n = $('qty-note'); n.hidden = !text; n.textContent = text || ''; n.dataset.k = kind || ''; }
    // 표 그림 — 화면을 찍지 않고 캔버스에 바로 그린다(쪽 전체를 복사해 찍는 html2canvas 는 이 화면에서 한 장에 몇 초씩 걸리고 야간 색이 섞일 수 있다).
    //   모양은 종전 그림과 같다: 15px 맑은 고딕 · 칸 안쪽 6px 10px · 1px 검은 줄 · 수량 굵게 오른쪽 · 맨 아래 합계 줄 노랑 · 2배율.
    function qtyPng(rows, total, unmatched) {
        const FONT = '15px "Malgun Gothic", "맑은 고딕", sans-serif', BOLD = '800 ' + FONT;
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;line-height:normal;letter-spacing:normal;font:' + FONT;
        probe.textContent = '가Ag'; document.body.appendChild(probe);
        const lh = Math.max(18, Math.round(probe.getBoundingClientRect().height)); probe.remove();
        const c = document.createElement('canvas'), g = c.getContext('2d');
        g.font = FONT; const wName = Math.ceil(Math.max(0, ...rows.map(r => g.measureText(r.name).width))) + 20;
        g.font = BOLD; const wNum = Math.max(50, Math.ceil(Math.max(g.measureText(String(total)).width, ...rows.map(r => g.measureText(String(r.qty)).width)))) + 20;
        const rh = lh + 12, W = 1 + wName + 1 + wNum + 1, H = 1 + (rows.length + 1) * (rh + 1);
        c.width = W * 2; c.height = H * 2; g.scale(2, 2);
        g.fillStyle = '#000000'; g.fillRect(0, 0, W, H);   // 줄 색을 먼저 깔고 칸을 덮는다
        g.textBaseline = 'middle';
        const line = (i, name, qty, bgName, bgNum, color) => {
            const y = 1 + i * (rh + 1);
            g.fillStyle = bgName; g.fillRect(1, y, wName, rh);
            g.fillStyle = bgNum; g.fillRect(1 + wName + 1, y, wNum, rh);
            g.font = FONT; g.textAlign = 'left'; g.fillStyle = color; if (name) g.fillText(name, 11, y + rh / 2 + 1);
            g.font = BOLD; g.textAlign = 'right'; g.fillStyle = '#000000'; g.fillText(String(qty), W - 11, y + rh / 2 + 1);
        };
        rows.forEach((r, i) => line(i, r.name, r.qty, QTY_BG[r.cat] || QTY_BG.none, '#FFFFFF', unmatched ? '#C0392B' : '#000000'));
        line(rows.length, '', total, QTY_BG.yellow, QTY_BG.yellow, '#000000');
        return new Promise((res, rej) => c.toBlob(b => { if (!b) return rej(new Error('그림을 만들지 못했어요')); b.cssW = W; b.cssH = H; res(b); }, 'image/png'));
    }
    function qtyOpen() {
        toolShow('desk-qty');
        if (!QTY.busy) qtyRun();
    }
    async function qtyRun() {
        if (QTY.busy) return;
        if (typeof matchProduct !== 'function' || typeof addSizeSuffix !== 'function' || typeof qtyCategory !== 'function' || typeof aoItemPartner !== 'function') { qtyNote('중간발주 화면을 불러오지 못했어요. 새로고침 후 다시 눌러 주세요', 'err'); return; }
        QTY.busy = true; $('desk-qty-now').disabled = true; plusBusy();
        const out = $('qty-out'), prog = $('qty-prog'), ptxt = $('qty-prog-text');
        QTY.urls.forEach(u => URL.revokeObjectURL(u)); QTY.urls = []; QTY.blobs.clear();
        pkClose(false); out.innerHTML = ''; qtyNote(''); prog.hidden = false;
        const chState = { naver: '조회 중', coupang: '조회 중', cafe24: '조회 중' };
        const paint = () => { ptxt.textContent = `주문을 불러오는 중 · 네이버 ${chState.naver} · 쿠팡 ${chState.coupang} · 자사몰 ${chState.cafe24}`; };
        paint();
        const track = (p, key) => p.then(v => { chState[key] = v && v.ok ? nfmt(v.count != null ? v.count : (v.rows || []).length) + '건' : '실패'; paint(); return v; }, e => { chState[key] = '실패'; paint(); throw e; });
        try {
            await aoLoadInvoicePricing();   // 매번 오늘 단가표 품목명으로(#440)
            const rv = await Promise.allSettled([
                track(api('/api/agent-office/naver/invoice-orders?days=' + QTY_DAYS), 'naver'),
                track(api('/api/agent-office/coupang/invoice-orders?days=' + QTY_DAYS), 'coupang'),
                track(api('/api/agent-office/cafe24/invoice-orders?days=' + QTY_DAYS), 'cafe24'),
            ]);
            const chan = x => x.status === 'fulfilled' && x.value && x.value.ok ? x.value : { ok: false, message: x.status === 'fulfilled' ? (x.value && x.value.message) || '불러오기 실패' : (x.reason && x.reason.message) || String(x.reason) };
            const nv = chan(rv[0]), cp = chan(rv[1]), cf = chan(rv[2]);
            if (!nv.ok && !cp.ok && !cf.ok) { qtyNote(`3채널 모두 불러오지 못했어요 · 네이버: ${nv.message} / 쿠팡: ${cp.message} / 자사몰: ${cf.message}`, 'err'); return; }
            ptxt.textContent = '거래처별로 묶어 그림을 만드는 중';
            // 채널별 (옵션 원문 + 손님 메모의 사이즈 요청 꼬리) → 수량
            const lines = [];
            const add = (ch, opt, memo, qty) => { let o = String(opt || ''); try { o = addSizeSuffix(o, String(memo || '').trim()); } catch (e) { /* 꼬리 없이 */ } lines.push({ ch, opt: o, qty: parseInt(qty) || 1 }); };
            if (nv.ok) (nv.rows || []).forEach(r => add('naver', r['옵션정보'], r['배송메세지'], r['수량']));
            if (cf.ok) (cf.rows || []).forEach(r => add('cafe24', r['주문상품명(세트상품 포함)'], r['배송메시지'], r['수량']));
            if (cp.ok) (cp.rows || []).forEach(r => add('coupang', r['노출상품명(옵션명)'] || r['등록상품명'], r['배송메세지'], r['구매수(수량)']));
            if (!lines.length) { qtyNote('3채널 모두 배송준비 주문이 없어요.', ''); return; }
            const map = new Map(), umap = new Map();
            for (const g of lines) {
                const sm = QTY_SIZE.exec(g.opt);
                let name = matchProduct(sm ? sm[1] : g.opt);
                if (sm && typeof name === 'string' && !name.startsWith('[미매칭]')) name = name + ' ' + sm[2] + '사이즈로!';
                if (typeof name !== 'string' || name.startsWith('[미매칭]')) { const k = `[${g.ch}] ${g.opt}`; umap.set(k, (umap.get(k) || 0) + g.qty); continue; }
                map.set(name, (map.get(name) || 0) + g.qty);
            }
            const items = [...map.entries()].map(([name, qty]) => ({ name, qty, cat: qtyCategory(name), partner: aoItemPartner(name.replace(/\s+(2S|S|M)사이즈로!$/, '')) || '기타' }));
            const urows = [...umap.entries()].map(([name, qty]) => ({ name, qty, cat: 'none' })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
            QTY.base = { items, urows };   // #598: 직접 추가 행을 넣어 그림만 다시 만들 때 쓴다(주문은 다시 묻지 않는다)
            const fails = [!nv.ok && '네이버: ' + nv.message, !cp.ok && '쿠팡: ' + cp.message, !cf.ok && '자사몰: ' + cf.message].filter(Boolean);
            const partial = (nv.ok ? nv.partial_adjusted || 0 : 0) + (cp.ok ? cp.partial_adjusted || 0 : 0) + (cf.ok ? cf.partial_adjusted || 0 : 0);
            const cnt = x => x.ok ? nfmt(x.count != null ? x.count : (x.rows || []).length) : '실패';
            $('qty-sub').textContent = `${kst(new Date().toISOString(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 조회 · 최근 ${QTY_DAYS}일`;
            qtyExtraLoad();
            out.innerHTML = `<div class="ship-meta"><span>주문 네이버 ${cnt(nv)} · 쿠팡 ${cnt(cp)} · 자사몰 ${cnt(cf)}${partial ? ' · 부분취소 반영 ' + nfmt(partial) + '건' : ''}</span><button type="button" class="desk-btn sm" id="qty-again">다시 집계</button></div><div id="qty-figs"></div>`
                + `<details class="qty-extra" id="qty-extra"${QTY.draft.length || QTY.xopen ? ' open' : ''}><summary>직접 추가 <span class="desk-note" id="qty-extra-n"></span></summary>
                    <p class="desk-note">전화·현금으로 받은 물량을 행으로 넣고 [그림 다시 만들기]를 누르면 그 거래처 그림의 같은 품목 줄에 더해져요(그림에 없던 품목은 새 줄). 오늘 하루 동안 기억해요.</p>
                    <div id="qty-extra-rows"></div>
                    <div class="qty-extra-acts"><button type="button" class="desk-btn sm" id="qty-extra-add">+ 행</button><button type="button" class="desk-btn sm primary" id="qty-extra-go">그림 다시 만들기</button></div>
                    <p class="desk-note" id="qty-extra-dirty" role="status" hidden>바꾼 내용은 [그림 다시 만들기]를 눌러야 그림에 들어가요.</p>
                </details>`;
            qtyExtraPaint(); qtyExtraDirty(false);
            await qtyDraw();
            if (fails.length) qtyNote('불러오지 못한 채널은 빼고 집계했어요 · ' + fails.join(' / '), 'err');
        } catch (e) {
            qtyNote('집계하지 못했어요: ' + ((e && e.message) || '다시 시도해 주세요'), 'err');
        } finally { prog.hidden = true; QTY.busy = false; $('desk-qty-now').disabled = false; plusBusy(); }
    }
    // 거래처별 그림을 (다시) 그린다 — 집계(QTY.base) + 직접 추가(QTY.extra). 추가 행이 없으면 종전과 같은 표·같은 순서
    async function qtyDraw() {
        const box = document.getElementById('qty-figs'), base = QTY.base;
        if (!box || !base) return;
        QTY.urls.forEach(u => URL.revokeObjectURL(u)); QTY.urls = []; QTY.blobs.clear();
        // #600(대표 10/9): 직접 추가는 같은 거래처·같은 품목 줄에 더한다(「(추가)」 줄을 따로 두지 않는다) · 집계에 없던 품목은 그 이름 그대로 새 줄
        const rows = base.items.map(it => ({ name: it.name, qty: it.qty, cat: it.cat, partner: it.partner, added: 0 }));
        const at = new Map(rows.map(r => [r.partner + '\n' + r.name, r]));
        QTY.extra.forEach(x => {
            const k = x.partner + '\n' + x.name; let r = at.get(k);
            if (!r) { let cat = 'none'; try { cat = qtyCategory(x.name); } catch (e) { /* 색 없이 */ } r = { name: x.name, qty: 0, cat, partner: x.partner, added: 0 }; at.set(k, r); rows.push(r); }
            r.qty += x.qty; r.added += x.qty;
        });
        const partners = new Map();
        rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
            .forEach(it => { const p = partners.get(it.partner) || { total: 0, added: 0, rows: [] }; p.rows.push(it); p.total += it.qty; p.added += it.added; partners.set(it.partner, p); });
        const tag = kstDay(0).slice(5, 7) + kstDay(0).slice(8, 10);
        const figs = [];
        for (const [p, v] of partners) figs.push({ title: p, total: v.total, added: v.added, kinds: v.rows.length, file: `중간발주_${p}_${tag}.png`, blob: await qtyPng(v.rows, v.total, false) });
        if (base.urows.length) { const t = base.urows.reduce((s, r) => s + r.qty, 0); figs.push({ title: '미매칭', total: t, kinds: base.urows.length, file: `중간발주_미매칭_${tag}.png`, blob: await qtyPng(base.urows, t, true), unmatched: true }); }
        const canCopy = !!(navigator.clipboard && window.ClipboardItem);
        box.innerHTML = figs.map((f, i) => { const u = URL.createObjectURL(f.blob); QTY.urls.push(u); QTY.blobs.set(String(i), f.blob);
            return `<figure class="qty-fig${f.unmatched ? ' unmatched' : ''}"><figcaption><b>${esc(f.title)}</b><span>${nfmt(f.kinds)}종 · 합계 ${nfmt(f.total)}박스${f.added ? ' · 직접 추가 ' + nfmt(f.added) + '박스 포함' : ''}${f.unmatched ? ' · 품목별 금액에 없는 옵션' : ''}</span><span class="qty-acts">${canCopy ? `<button type="button" class="desk-btn sm" data-qty-copy="${i}">그림 복사</button>` : ''}<a class="desk-btn sm" href="${u}" download="${esc(f.file)}">내려받기</a></span></figcaption><div class="qty-img"><img src="${u}" width="${f.blob.cssW}" height="${f.blob.cssH}" alt="${esc(f.title)} 중간발주 표"></div></figure>`; }).join('');
        const n = document.getElementById('qty-extra-n'); if (n) n.textContent = QTY.extra.length ? `${QTY.extra.length}행 · ${nfmt(QTY.extra.reduce((s, x) => s + x.qty, 0))}박스 들어가 있어요` : '';
    }
    // ── #598(대표 10/9) 중간발주 「직접 추가」 — 「현금건 4kg 로얄 18건 추가해 줘」를 창구(AI)에 보내지 않고 사람이 행으로 넣는다
    //   QTY.draft = 적는 중인 행(화면) · QTY.extra = 그림에 들어간 행([그림 다시 만들기]를 누른 것) · 같은 날(KST)에만 sessionStorage 에 둔다
    const QTY_XKEY = 'akm_qty_extra';
    function qtyExtraLoad() {
        const day = kstDay(0);
        if (QTY.xday === day && QTY.draft) return;   // 이 화면에서 적던 것은 [다시 집계]를 눌러도 그대로
        QTY.xday = day; QTY.extra = [];
        try {
            const j = JSON.parse(sessionStorage.getItem(QTY_XKEY) || 'null');
            if (j && j.day === day && Array.isArray(j.rows)) QTY.extra = j.rows.filter(x => x && x.partner && x.name && parseInt(x.qty) > 0).map(x => ({ partner: String(x.partner), name: String(x.name), qty: parseInt(x.qty) }));
            else sessionStorage.removeItem(QTY_XKEY);   // 날짜가 바뀌면 비운다
        } catch (e) { /* 저장소를 못 쓰는 브라우저 — 이 화면 동안만 */ }
        QTY.draft = QTY.extra.map(x => ({ partner: x.partner, name: x.name, qty: String(x.qty) }));
    }
    function qtyExtraSave() { try { if (QTY.extra.length) sessionStorage.setItem(QTY_XKEY, JSON.stringify({ day: kstDay(0), rows: QTY.extra })); else sessionStorage.removeItem(QTY_XKEY); } catch (e) { /* 무시 */ } }
    function qtyExtraDirty(on) { const n = document.getElementById('qty-extra-dirty'); if (n) n.hidden = !on; }
    const qtyPartners = () => { const by = typeof aoInvoicePricingByPartner === 'object' && aoInvoicePricingByPartner ? aoInvoicePricingByPartner : {}; const ps = Object.keys(by).sort((a, b) => a.localeCompare(b, 'ko')); return { by, ps: ps.length ? ps : ['기타'] }; };
    function qtyExtraPaint() {
        const box = document.getElementById('qty-extra-rows'); if (!box) return;
        pkClose(false);
        const { by, ps } = qtyPartners();
        box.innerHTML = QTY.draft.map((d, i) => {
            if (!d.partner) d.partner = ps[0];
            const names = [...(by[d.partner] || [])].sort((a, b) => a.localeCompare(b, 'ko'));
            if (d.free === undefined) d.free = !names.length || (!!d.name && !names.includes(d.name));
            if (!names.length) d.free = true;
            if (!d.free && !d.name) d.name = names[0];
            const pick = (kind, cls, v, text, lab) => `<button type="button" class="ship-q qty-pick ${cls}" data-pick="${kind}" value="${esc(v)}" aria-haspopup="listbox" aria-expanded="false" aria-label="${lab} 고르기 — 지금: ${esc(text)}"><span class="qty-pick-t">${esc(text)}</span><span class="qty-pick-ar" aria-hidden="true"></span></button>`;
            return `<div class="qty-xrow" data-i="${i}">
                ${pick('p', 'qty-xp', d.partner, d.partner, '거래처')}
                ${names.length ? pick('n', 'qty-xn', d.free ? '' : d.name, d.free ? PK_FREE : d.name, '품목') : ''}
                ${d.free ? `<input type="text" class="ship-q qty-xf" maxlength="60" placeholder="품목 이름" aria-label="품목 이름" value="${esc(d.name || '')}">` : ''}
                <span class="qty-xstep"><button type="button" class="desk-btn sm qty-xm" aria-label="수량 1 줄이기">−</button><input type="text" inputmode="numeric" class="ship-q qty-xq" maxlength="4" placeholder="수량" aria-label="수량(박스)" value="${esc(d.qty || '')}"><button type="button" class="desk-btn sm qty-xa" aria-label="수량 1 늘리기">+</button></span>
                <button type="button" class="desk-btn sm qty-xx" aria-label="이 행 빼기" title="이 행 빼기">×</button>
            </div>`;
        }).join('');
    }
    // #600(대표 10/9 「브라우저 기본 목록 말고 우리 디자인으로」): 거래처·품목 고르기 = 입력칸처럼 생긴 버튼 → 목록 창(최종발주 #583-g 옵션 목록 창과 같은 모양·동작)
    //   묶음 머리 · 지금 값 체크 · 8개 넘으면 위에 거르기 칸 · ↑↓/Home/End/Enter/Esc/Tab · 바깥 누름 닫기 · 폰(640 이하)은 아래에서 올라오는 시트. 창은 .desk 바로 아래 하나만 둔다.
    const PK = { open: false, i: -1, kind: '', sel: '', act: -1, n: 0 };
    const PK_FREE = '단가표에 없는 품목 (직접 적기)';
    const pkBtn = () => document.querySelector(`#qty-extra-rows .qty-xrow[data-i="${PK.i}"] .qty-pick[data-pick="${PK.kind}"]`);
    const pkMobile = () => window.matchMedia('(max-width: 640px)').matches;
    function pkEl() {
        let p = document.getElementById('qty-pickpanel'); if (p) return p;
        const host = $('desk-qty').closest('.desk') || document.body, bk = document.createElement('div'); bk.className = 'qty-pickback'; bk.id = 'qty-pickback'; bk.hidden = true; host.appendChild(bk);
        p = document.createElement('div'); p.className = 'qty-pickpanel'; p.id = 'qty-pickpanel'; p.hidden = true; p.tabIndex = -1; p.setAttribute('role', 'dialog');
        p.innerHTML = '<div class="qty-pick-head"><b id="qty-pick-title"></b><span class="qty-pick-n" id="qty-pick-n" aria-live="polite"></span><button type="button" class="qty-pick-x" data-pkclose>닫기</button></div>'
            + '<div class="qty-pick-q" id="qty-pick-qbox"><input type="text" inputmode="search" class="ship-q" id="qty-pickq" placeholder="검색 (예: 2.5 · 로얄과 4kg)" aria-label="목록에서 찾기" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="qty-pickrows"></div>'
            + '<div class="qty-pickrows" id="qty-pickrows" role="listbox"></div>';
        host.appendChild(p);
        p.addEventListener('click', e => { if (e.target.closest('[data-pkclose]')) return pkClose(true); const r = e.target.closest('.qty-pickrow'); if (r) pkPick(r.dataset.v); });
        p.addEventListener('keydown', e => {
            const inQ = e.target.id === 'qty-pickq';
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (PK.n) pkAct(PK.act < 0 ? (e.key === 'ArrowDown' ? 0 : PK.n - 1) : Math.max(0, Math.min(PK.n - 1, PK.act + (e.key === 'ArrowDown' ? 1 : -1)))); }
            else if (e.key === 'Home' && PK.n && !inQ) { e.preventDefault(); pkAct(0); }
            else if (e.key === 'End' && PK.n && !inQ) { e.preventDefault(); pkAct(PK.n - 1); }
            else if (e.key === 'Enter' || (e.key === ' ' && !inQ)) { e.preventDefault(); const r = $('qty-pickrows').querySelector('.qty-pickrow.act'); if (r) pkPick(r.dataset.v); }
            else if (e.key === 'Tab') { e.preventDefault(); pkClose(true); }
        });
        $('qty-pickq').addEventListener('input', () => pkDraw());
        bk.addEventListener('click', () => pkClose(false));
        return p;
    }
    function pkItems() {
        const d = QTY.draft[PK.i] || {}, { by, ps } = qtyPartners();
        if (PK.kind === 'p') return { title: '거래처 고르기', grp: '', rows: (ps.includes(d.partner) || !d.partner ? ps : ps.concat(d.partner)).map(v => ({ v, t: v })), tail: [] };
        return { title: '품목 고르기', grp: d.partner || '', rows: [...(by[d.partner] || [])].sort((a, b) => a.localeCompare(b, 'ko')).map(v => ({ v, t: v })), tail: [{ v: '', t: PK_FREE }] };
    }
    function pkDraw() {
        // 연관검색처럼(최종발주와 같은 규칙): 띄어쓰기·괄호·「kg」 유무 무시 · 띄어 쓴 낱말은 모두 포함 · 맞는 글자 강조 · 「직접 적기」 줄은 늘 맨 아래에 남는다
        const it = pkItems(), sq = t => String(t || '').toLowerCase().replace(/kg/g, '').replace(/[\s()\[\]{}·:,\/\-_~*]/g, '');
        const big = it.rows.length > 8, qbox = $('qty-pick-qbox'); qbox.hidden = !big;
        const raw = big ? String($('qty-pickq').value || '').toLowerCase().split(/\s+/).filter(Boolean) : [], ws = raw.map(sq).filter(Boolean), hit = n => { const x = sq(n); return ws.every(w => x.includes(w)); };
        const mark = n => {
            const low = n.toLowerCase(), rg = []; [...new Set(raw.concat(raw.map(w => w.replace(/kg/g, ''))))].filter(Boolean).forEach(w => { for (let k = low.indexOf(w); k >= 0; k = low.indexOf(w, k + w.length)) rg.push([k, k + w.length]); });
            if (!rg.length) return esc(n); rg.sort((a, b) => a[0] - b[0]); let out = '', at = 0;
            rg.forEach(([a, b]) => { if (b <= at) return; a = Math.max(a, at); out += esc(n.slice(at, a)) + '<mark class="qty-pickmk">' + esc(n.slice(a, b)) + '</mark>'; at = b; });
            return out + esc(n.slice(at));
        };
        let i = 0; const row = (x, cls) => `<button type="button" role="option" class="qty-pickrow${cls || ''}${x.v === PK.sel ? ' on' : ''}" id="qty-pickrow-${i}" data-i="${i++}" data-v="${esc(x.v)}" aria-selected="${x.v === PK.sel}"><span class="qty-pickrow-t">${cls ? esc(x.t) : mark(x.t)}</span>${x.v === PK.sel ? '<span class="qty-pickck" aria-hidden="true"></span>' : ''}</button>`;
        const found = it.rows.filter(x => hit(x.t));
        let h = (it.grp ? `<div class="qty-pickgrp" role="presentation">${esc(it.grp)}</div>` : '') + found.map(x => row(x)).join('');
        if (!found.length && it.rows.length) h += '<p class="qty-picknone">맞는 이름이 없어요.</p>';
        h += it.tail.map(x => row(x, ' free')).join('');
        $('qty-pickrows').innerHTML = h; $('qty-pickrows').setAttribute('aria-label', it.title);
        $('qty-pick-title').textContent = it.title; $('qty-pickpanel').setAttribute('aria-label', it.title);
        PK.n = i; $('qty-pick-n').textContent = ws.length ? `${found.length}개` : `전체 ${it.rows.length}개`;
        const on = $('qty-pickrows').querySelector('.qty-pickrow.on'); pkAct(on ? Number(on.dataset.i) : (ws.length && found.length ? 0 : -1));
    }
    function pkAct(i) {
        PK.act = i; const rows = $('qty-pickrows'); rows.querySelectorAll('.qty-pickrow.act').forEach(r => r.classList.remove('act'));
        const r = i >= 0 ? rows.querySelector(`.qty-pickrow[data-i="${i}"]`) : null;
        if (r) { r.classList.add('act'); $('qty-pickq').setAttribute('aria-activedescendant', r.id); if (typeof r.scrollIntoView === 'function') r.scrollIntoView({ block: 'nearest' }); } else $('qty-pickq').removeAttribute('aria-activedescendant');
    }
    // #602: follow = 화면이 움직일 때 — 연 방향·크기는 그대로 두고 버튼에 붙여 따라간다(버튼이 화면 밖으로 나가면 창도 같이)
    function pkPlace(follow) {
        const p = document.getElementById('qty-pickpanel'), b = pkBtn(); if (!p) return; if (!b) return pkClose(false);
        if (pkMobile()) { ['left', 'top', 'width', 'maxHeight', 'bottom', 'visibility'].forEach(k => { p.style[k] = ''; }); p.dataset.up = ''; return; }   // 폰 = 시트(자리·크기는 CSS)
        const r = b.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth, w = Math.max(PK.kind === 'p' ? 220 : 320, Math.min(520, r.width)), below = vh - r.bottom - 12, above = r.top - 12, up = below < 280 && above > below;
        { const full = b.closest('.is-full'), sr = full ? full.getBoundingClientRect() : { top: 0, bottom: vh }; p.style.visibility = r.bottom < Math.max(0, sr.top) || r.top > Math.min(vh, sr.bottom) ? 'hidden' : ''; }   // 버튼이 화면 밖에 있는 동안은 창도 안 보인다(열린 채 · 돌아오면 제자리)
        if (follow && p.style.width) { if (p.dataset.up === '1') p.style.bottom = (vh - r.top + 6) + 'px'; else p.style.top = (r.bottom + 6) + 'px'; return; }
        p.style.width = w + 'px'; p.style.left = Math.max(8, Math.min(vw - w - 8, r.left)) + 'px'; p.style.maxHeight = Math.max(200, Math.min(440, up ? above : below)) + 'px';
        if (up) { p.style.top = ''; p.style.bottom = (vh - r.top + 6) + 'px'; } else { p.style.bottom = ''; p.style.top = (r.bottom + 6) + 'px'; }
        p.dataset.up = up ? '1' : '';
    }
    function pkOpen(btn) {
        const row = btn.closest('.qty-xrow'); if (!row) return;
        if (PK.open) pkClose(false);
        const p = pkEl(); PK.open = true; PK.i = Number(row.dataset.i); PK.kind = btn.dataset.pick; PK.sel = btn.value; $('qty-pickq').value = '';
        p.hidden = false; $('qty-pickback').hidden = false; btn.setAttribute('aria-expanded', 'true'); pkDraw(); pkPlace();
        if (hbTouch()) hbPush('pick', () => pkClose(false), { deskPick: 1 });
        if (pkMobile() || $('qty-pick-qbox').hidden) p.focus({ preventScroll: true }); else $('qty-pickq').focus({ preventScroll: true });   // 폰은 자판이 시트를 가리지 않게 거르기 칸에 바로 커서를 두지 않는다
    }
    function pkClose(focusBack) {
        if (!PK.open) return; PK.open = false; hbDrop('pick'); const p = document.getElementById('qty-pickpanel'), bk = document.getElementById('qty-pickback'), b = pkBtn();
        if (p) p.hidden = true; if (bk) bk.hidden = true;
        if (b) { b.setAttribute('aria-expanded', 'false'); if (focusBack) b.focus({ preventScroll: true }); }
    }
    function pkPick(v) {
        const i = PK.i, kind = PK.kind, d = QTY.draft[i]; pkClose(false); if (!d) return;
        let sel = '.qty-xp';
        if (kind === 'p') { if (v !== d.partner) { d.partner = v; d.name = ''; d.free = undefined; qtyExtraDirty(true); } }
        else { const free = !v; if (free !== !!d.free || (!free && v !== d.name)) qtyExtraDirty(true); if (free && !d.free) d.name = ''; d.free = free; if (!free) d.name = v; sel = free ? '.qty-xf' : '.qty-xn'; }
        qtyExtraPaint();
        const f = document.querySelector(`#qty-extra-rows .qty-xrow[data-i="${i}"] ${sel}`); if (f) f.focus({ preventScroll: true });
    }
    document.addEventListener('pointerdown', e => { if (PK.open && !(e.target.closest && (e.target.closest('#qty-pickpanel') || e.target.closest('.qty-pick')))) pkClose(false); }, true);
    document.addEventListener('keydown', e => { if (PK.open && e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); pkClose(true); } }, true);   // 목록 창만 닫는다
    window.addEventListener('resize', () => { if (PK.open) pkPlace(); });
    window.addEventListener('scroll', e => { if (PK.open && !pkMobile() && !(e.target && e.target.closest && e.target.closest('#qty-pickpanel'))) pkPlace(true); }, { passive: true, capture: true });
    async function qtyExtraGo(btn) {
        const rows = [], warn = (i, sel, msg) => { if (typeof akmAlert === 'function') akmAlert(msg); else showToast(msg); const el = document.querySelector(`#qty-extra-rows .qty-xrow[data-i="${i}"] ${sel}`); if (el) el.focus(); };
        for (let i = 0; i < QTY.draft.length; i++) {
            const d = QTY.draft[i], name = String(d.name || '').replace(/\s+/g, ' ').trim(), q = String(d.qty || '').trim();
            if (!name) return warn(i, '.qty-xf, .qty-xn', '품목 이름을 적어 주세요');
            if (!/^\d{1,4}$/.test(q) || parseInt(q) < 1) return warn(i, '.qty-xq', '수량은 1 이상 숫자로 적어 주세요');
            rows.push({ partner: d.partner, name, qty: parseInt(q) });
        }
        btn.disabled = true;
        try {
            QTY.extra = rows; qtyExtraSave(); await qtyDraw(); qtyExtraDirty(false);
            showToast(rows.length ? `직접 추가 ${rows.length}행을 넣어 그림을 다시 만들었어요` : '직접 추가 없이 그림을 다시 만들었어요');
        } catch (e) { showToast('그림을 만들지 못했어요. 다시 눌러 주세요'); }
        finally { btn.disabled = false; }
    }
    // ── #610-E 문자(회사폰 반자동 응대) — 알약 [문자] → 회사폰으로 온 문자를 대화별로 보고 여기서 답한다(창구·AI를 거치지 않는다)
    //   서버: GET /api/sms/summary · /api/sms/threads?scope=active|all&q=&limit= · /api/sms/threads/:id[?peek=1] · /api/sms/images/:id
    //         POST /api/sms/threads/:id/reply { text } · /send-draft
    //   #635(대표 10/11 「폰 문자함처럼」): 목록 = 안 읽은 글이 있는 대화만(scope=active) · 열면 읽음(배지 0) · 접으면 목록에서 빠짐 · 손님이 또 보내면 다시 뜸
    //     [이전 대화 보기](scope=all)·찾기(q = 서버가 전체에서)로 지난 대화를 본다 · 숫자 네 칸·[처리함]·[대화 끝내기]는 없앴다(서버 라우트는 그대로 있다)
    //   새 폴링 없음 — 기존 1초 tick 에 얹는다(요약 30초 · 카드가 열려 있으면 목록 10초 · 펼친 대화 5초 · 가려진 동안은 안 받음)
    //   서버에 문자 라우트가 없으면(요약이 실패하면) 알약 자체가 안 보인다 → 종전 화면 그대로
    const SMS = { scope: 'all', only: false, sum: null, sumAt: 0, sumSig: '', items: null, sig: '', err: '', q: '', qt: 0, seq: 0, lbusy: false, listAt: 0, open: 0, openRow: null, openAt: 0, thread: null, tsig: '', tseq: 0, tbusy: false, thAt: 0, sending: false, buyOpen: new Set(), texts: new Map(), filled: 0, fillText: '', newDraft: '', actAt: Date.now(), readAt: 0, itemsAt: 0, imgs: new Map(), neu: { on: false, phone: '', text: '', busy: false, touched: false, err: '' }, newOff: false };   // scope = all(전체 대화 · 기본 #660)|open(답 안 한 것만) — 이 화면 동안 기억 · only = 직원 확인이 필요한 대화만(#633 봇 실패 알약에서 올 때)
    const SMS_ST = { staff_needed: ['직원 몫', 'ask'], draft: ['초안 대기', 'wait'], bot_replied: ['봇 답변', 'work'], cooldown: ['봇 답변', 'work'], staff_replied: ['직원 답변', 'done'], closed: ['끝난 대화', 'mute'], new: ['새 문자', 'mute'], ignored: ['안 봐도 됨', 'mute'] };
    // #635: 볼 것 = 안 읽은 글이 있는 대화(unread_threads) · 그중 사람 몫(needs_staff) · 안 보낸 초안이 있는 대화(drafts) — 옛 서버(칸 없음)면 종전 셈(직원 몫 + 초안 대기)
    const smsNeed = () => { const d = SMS.sum || {}, c = d.counts && typeof d.counts === 'object' ? d.counts : {}, old = !('unread_threads' in d), st = Number(d.staff_needed) || 0, dr = Number(old && 'draft' in c ? c.draft : d.drafts) || 0; return old ? { unread: st + dr, staff: st, draft: dr, old: true } : { unread: Number(d.unread_threads) || 0, staff: Number(d.needs_staff) || 0, draft: dr, old: false }; };
    const SMS_MODE = { record: ['기록만', '봇은 답하지 않고 받은 문자만 기록해요'], draft: ['초안', '봇이 답 초안을 만들고, 사람이 보내요'], auto: ['자동 답변', '간단한 문의는 봇이 바로 답해요'] };
    // sender: gateway_other = 우리 화면·봇이 낸 글이 아닌데 전달 앱이 「보냈다」고 알려 온 글(앱 대시보드·다른 프로그램 · 서버가 쉬는 사이 나간 글) — 직원이 폰 문자 앱에서 손으로 보낸 글은 여기로 안 온다
    const SMS_WHO = { bot: '봇', staff_phone: '직원(폰)', staff_desk: '직원(오피스)', gateway_other: '전달 앱' };
    const SMS_STATE = { queued: '보내는 중', sending: '보내는 중', sent: '보냄', delivered: '전달됨', failed: '보내지 못함', cancelled: '안 보냄(취소)' };
    // #651: 취소된 글은 손님에게 안 나간 글이다 — 사유를 붙여 한눈에(직원이 먼저 답함 · 시간이 지남). 봇 답이 유예 중(queued)이면 「곧 발송」
    const smsStateLabel = m => {
        if (m.state === 'cancelled') { const r = String(m.fail_reason || ''); return '안 보냄 · ' + (/stale/.test(r) ? '시간이 지나 취소' : /handover/.test(r) ? '손님이 이어서 보내 직원 확인으로 넘김' : /staff|gateway|handled|close/.test(r) ? '직원이 먼저 답해서 취소' : '취소'); }
        if (m.state === 'queued' && m.sender === 'bot') return '곧 발송';
        return SMS_STATE[m.state] || '';
    };
    const p2 = n => String(n).padStart(2, '0');
    const smsKd = t => { const v = tms(t); return Number.isFinite(v) ? new Date(v + 9 * 3600e3) : null; };
    const smsDay = t => { const d = smsKd(t); return d ? d.toISOString().slice(0, 10) : ''; };
    const smsWhen = t => { const d = smsKd(t); if (!d) return ''; const hm = p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); return smsDay(t) === kstDay(0) ? hm : (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + hm; };
    const smsDayLabel = t => { const d = smsKd(t); if (!d) return ''; return smsDay(t) === kstDay(0) ? '오늘' : (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 ' + '일월화수목금토'[d.getUTCDay()] + '요일'; };
    const smsBadge = st => { const b = SMS_ST[st] || [st || '확인', 'mute']; return `<span class="desk-badge" data-k="${b[1]}">${esc(b[0])}</span>`; };
    const smsVisible = () => { const c = $('desk-sms'); return !!c && !c.hidden; };
    function smsNote(text, kind) { const n = $('sms-note'); if (!n) return; n.hidden = !text; n.textContent = text || ''; n.dataset.k = kind || ''; }
    // 요약 — 알약 숫자 · 카드 머리 · 「지금 챙길 일」 한 줄
    // #683(대표 10/13 「○○님이 입력 중..」): 문자 답 칸에 글을 치는 동안 같은 대화를 보는 다른 직원에게 알린다 — 막는 것은 없다(표시만).
    //   보내기 = 답 칸 input 때 POST /api/sms/threads/:id/typing {on:true}(첫 글자 즉시 · 그 뒤 4초에 1번) · 빈 칸·보냄·대화 닫음 = {on:false}. 응답 typing = 나를 뺀 그 대화 입력자 → 2명 경고를 바로 그린다
    //   받기 = 문자 탭이 보이는 동안만 GET /api/sms/typing 을 3초마다(창 닫힘·다른 탭·화면 숨김이면 멈춤) → 목록 줄 「A 입력 중」 · 답 칸 위 한 줄. 옛 서버(404)면 끄고 다시 묻지 않는다(토스트 없음)
    const TYP = { off: false, pauseUntil: 0, ttl: 30000, others: {}, here: [], mine: 0, lastOn: 0, pollAt: 0, pbusy: false, sig: '', lsig: '' };
    const typNames = v => (Array.isArray(v) ? v : []).map(p => String((p && p.name) || '').trim()).filter(Boolean);
    const typMe = () => !!SMS.open && TYP.mine === SMS.open && Date.now() - TYP.lastOn < TYP.ttl;
    async function typCall(path, body) {
        if (TYP.off || Date.now() < TYP.pauseUntil) return null;
        try {
            const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') } }, body ? { method: 'POST', body: JSON.stringify(body), keepalive: true } : {}));
            if (r.status === 404 || r.status === 405 || r.status === 501) { TYP.off = true; typClear(); return null; }   // 옛 서버 — 이 화면 동안 다시 묻지 않는다
            if (!r.ok) throw new Error('http ' + r.status);
            const d = await r.json(); return d && d.ok !== false ? d : null;
        } catch (e) { TYP.pauseUntil = Date.now() + 60000; typClear(); return null; }   // 잠깐 끊김 — 조용히 숨기고 1분 쉰다
    }
    function typClear() { TYP.others = {}; TYP.here = []; typDraw(); }
    function typDraw() {
        const el = document.getElementById('sms-typing');
        if (el) {
            const names = TYP.off ? [] : typNames(TYP.here), me = typMe(), k = !names.length ? '' : me ? 'both' : 'one';
            const who = names.map(n => n + '님').join('·');
            const sig = k + '|' + who;
            if (sig !== TYP.sig) {
                TYP.sig = sig; el.hidden = !k; el.dataset.k = k;
                el.innerHTML = !k ? '' : k === 'both' ? `<span class="sms-typing-t">⚠ ${esc(who)}도 같이 작성 중입니다 (${names.length + 1}명)</span>` : `<span class="sms-typing-d" aria-hidden="true"><i></i><i></i><i></i></span><span class="sms-typing-t">${esc(who)}이 입력 중..</span>`;
            }
        }
        const lsig = TYP.off ? '' : JSON.stringify(Object.keys(TYP.others).sort().map(id => [id, typNames(TYP.others[id])]));
        if (lsig !== TYP.lsig) { TYP.lsig = lsig; if (SMS.items) smsRenderList(); }
    }
    function typInput() {   // 답 칸을 손으로 고칠 때만 불린다(input) — 초안이 저절로 채워지는 것·[이대로 보내기]는 신호가 아니다
        const id = SMS.open, ta = document.getElementById('sms-text'); if (!id || !ta || TYP.off) return;
        if (!ta.value.trim()) { typStop(); return; }
        if (smsIsDraft()) return;
        const now = Date.now();
        if (TYP.mine === id && now - TYP.lastOn < 4000) return;
        if (TYP.mine && TYP.mine !== id) typStop();
        TYP.mine = id; TYP.lastOn = now; typDraw();
        typCall('/api/sms/threads/' + id + '/typing', { on: true }).then(d => { if (d && SMS.open === id && Array.isArray(d.typing)) { TYP.here = d.typing; TYP.others[id] = d.typing; if (!d.typing.length) delete TYP.others[id]; typDraw(); } });
    }
    function typStop(quiet) {   // 빈 칸 · 보냄 · 대화 닫음 · 다른 대화로 옮김
        const id = TYP.mine; if (!id) return;
        TYP.mine = 0; TYP.lastOn = 0;
        if (!quiet) typCall('/api/sms/threads/' + id + '/typing', { on: false });
        typDraw();
    }
    function typTick() {
        if (TYP.off || TYP.pbusy || document.hidden || !smsVisible() || INB.ch !== 'sms') return;
        const now = Date.now(); if (now - TYP.pollAt < 3000) return;
        TYP.pollAt = now; TYP.pbusy = true;
        typCall('/api/sms/typing').then(d => {
            TYP.pbusy = false; if (!d) return;
            if (Number(d.ttl_sec) > 0) TYP.ttl = Number(d.ttl_sec) * 1000;
            TYP.others = d.threads && typeof d.threads === 'object' ? d.threads : {};
            TYP.here = SMS.open ? (TYP.others[SMS.open] || TYP.others[String(SMS.open)] || []) : [];
            typDraw();
        });
    }
    async function smsSummary() {
        SMS.sumAt = Date.now();
        let d = null;
        try { d = await api('/api/sms/summary'); } catch (e) { d = null; }
        if (!d || typeof d !== 'object' || !('mode' in d || 'enabled' in d)) d = null;
        if (!d && SMS.sum && (SMS.sumFail = (SMS.sumFail || 0) + 1) < 3) { SMS.sumAt = Date.now() - 20000; return; }   // 앞 요약을 그대로 두고 10초 뒤 다시(답을 쓰던 창이 사라지지 않게)
        SMS.sumFail = 0;
        SMS.sum = d; const first = !SMS.sumDone; SMS.sumDone = true;
        const sig = JSON.stringify(d);
        if (sig === SMS.sumSig) { if (first) smsChip(); return; }
        SMS.sumSig = sig;
        if (!first) boardSoon();   // #676 문자 미처리가 바뀌면 챙길 일(봇 실패 줄)도 바로
        smsChip(); smsHead();
        if (S.board) renderBoard();
    }
    const smsDead = () => !!(SMS.sum && SMS.sum.enabled !== false && SMS.sum.gateway && SMS.sum.gateway.alive === false);
    function smsChip() {
        const b = $('desk-sms-now'), n = $('sms-chip-n'); if (!b) return;
        const d = SMS.sum;
        const pb = $('desk-plus-btn');
        if (!d) { if (pb) pb.dataset.dead = ''; plusShorts(); inbTabs(); if (smsVisible() && !inbOk()) toolShow(null); return; }
        const nd = smsNeed(), need = smsOpenN(), dead = smsDead();   // #668 숫자 = 미처리(open_threads) · [+] 점 = 네 채널 미처리 합(custMenu)
        inbTabs();
        if (pb) pb.dataset.dead = dead ? '1' : '';
        plusShorts();
        b.dataset.dead = dead ? '1' : '';
        b.setAttribute('aria-label', '문자' + (need > 0 ? `, 미처리 대화 ${need}건(직원 확인 ${nd.staff} · 초안 ${nd.draft})` : '') + (dead ? ', 회사폰 연결 끊김' : ''));
    }
    function smsHead() {
        if (INB.ch !== 'sms') { inbSub(); return; }   // #658 톡톡·문의 탭에서는 머리 글을 그 탭 것으로
        const d = SMS.sum; if (!d || !$('sms-mode')) return;
        const md = SMS_MODE[d.mode] || [d.mode || '', ''], el = $('sms-mode');
        el.textContent = md[0]; el.title = md[1]; el.dataset.m = d.mode || ''; el.hidden = !md[0];
        $('sms-sub').textContent = `오늘 받은 문자 ${nfmt(d.today_in)}건 · 봇 답 ${nfmt(d.today_bot)} · 직원 답 ${nfmt(d.today_staff)}`;
        if (d.enabled === false) smsNote('문자 연동이 꺼져 있어요. 지금은 받은 문자가 여기에 들어오지 않아요.', '');
        else if (smsDead()) smsNote(`회사폰 전달 앱 연결이 끊겼어요${d.gateway.last_ping_at ? '. 마지막 연결 ' + smsWhen(d.gateway.last_ping_at) : ''}. 회사폰이 켜져 있는지, 앱이 돌고 있는지 확인해 주세요. 그동안 온 문자는 여기에 안 보여요.`, 'err');
        else smsNote('');
        const sc = $('sms-scope'); if (sc) { sc.setAttribute('aria-pressed', String(SMS.scope === 'open' && !SMS.only)); const on = $('sms-open-n'), n = Number(d.open_threads); if (on) { on.hidden = !(n > 0); on.textContent = n > 99 ? '99+' : String(n || ''); } }   // #660 숫자 = 서버 요약 open_threads(옛 서버엔 없음 → 숫자 없이 단추만)
        // 셈 = 서버 요약의 staff_open(사유가 남아 있는 열린 대화 수 · 읽음 여부 무관) — 그 칸이 없으면 상태가 「직원 몫」인 대화 수(staff_needed)로 대신
        { const sb = $('sms-staff'), n = Number('staff_open' in d ? d.staff_open : d.staff_needed) || 0; if (sb) { sb.hidden = !(n > 0 || SMS.only); sb.setAttribute('aria-pressed', String(!!SMS.only)); $('sms-staff-n').textContent = n > 99 ? '99+' : String(n); } }
        { const nb = $('sms-new'); if (nb) nb.hidden = !(d.send_route === true && !SMS.newOff); }   // #688 옛 서버(표식 없음)면 숨김
        if (document.getElementById('sms-text')) smsSync();
        if (SMS.neu.on) smsNewSync();
    }
    // scope 를 주면 그 범위로 새로 연다(찾기 비움) · 안 주면 보던 범위 그대로
    // #653-가(대표 10/11 「최종발주처럼 창으로 · 뒤로가기 버튼이 되게」): 문자 = 화면을 덮는 전용 창. 폰·PC 의 뒤로가기는 「대화 → 목록 → 창 닫힘」 순.
    //   기록(history)에 창 1칸 · 대화 1칸을 쌓고, 화면에서 닫을 때는 그만큼 스스로 되돌린다(뒤로가기로 페이지가 나가 버리지 않게). 다른 대화로 옮길 때는 칸을 다시 쌓지 않는다.
    //   🔴 판단은 「우리가 몇 칸 쌓았나」가 아니라 **지금 기록 맨 위 칸(history.state.smsWin)** 으로 한다 — 다른 화면(자세히 보기 전체 화면·최종발주)이 같은 순간 기록을 되돌려도 어긋나지 않게.
    // ── #658(대표 10/11 「톡톡·상품·주문 문의도 여기서 문자처럼 답장」) 문자 창의 채널 탭 — 문자 | 톡톡 | 상품문의 | 주문문의
    //   톡톡·문의 탭의 본문은 public/ao-inbox.js(window.AkmInbox · 워커4)가 #inb-host 안에 그린다. 이 파일이 맡는 것 = 탭 줄 · 탭 전환(mount/unmount) · 뒤로가기 칸 · Esc · 창 닫기 · 들어오는 길([+] 메뉴 · 바로가기 · 챙길 일 · 확인 필요 문의 줄)
    //   AkmInbox 가 없거나(옛 캐시) 서버에 /api/inbox 가 없으면 탭 줄·항목이 안 보이고 전부 종전 문자 창 그대로
    const INB = { ch: 'sms', bound: false, known: false };
    // #668(대표 10/12 「[+] 처음 누르면 손님 건이 늦게 나오던데」): 원인 = 문자 줄은 /api/sms/summary, 톡톡·문의 줄은 /api/inbox/counts 답이 온 뒤에야 보였고, 그 counts 조회는 첫 화면의 다섯 조회가 다 끝난 뒤(+1초)에야 시작됐다
    //   → ⓐ 마지막으로 확인한 「있다/없다」와 숫자를 이 브라우저에 기억해 답이 오기 전에는 그대로 먼저 보여 주고(답이 「없음」으로 확정되면 그때 숨김) ⓑ counts 조회를 화면이 뜨는 즉시 시작
    //   숫자는 전부 미처리(문자 = summary.open_threads · 톡톡·문의 = counts.open) = 손님 연락 카드 칩과 같은 수
    const CUST_KEY = 'akm_desk_cust';
    const CUST = (() => { try { const v = JSON.parse(localStorage.getItem(CUST_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } })();   // { sms: bool, inb: bool, n: { sms, talk, qna, inquiry } }
    function custSave() {
        const n = custNums(), v = { sms: SMS.sumDone ? !!SMS.sum : !!CUST.sms, inb: INB.known ? inbOk() : !!CUST.inb, n: { sms: n.sms, talk: n.talk, qna: n.qna, inquiry: n.inquiry } };
        const j = JSON.stringify(v); if (j === CUST.j) return; CUST.j = j; CUST.sms = v.sms; CUST.inb = v.inb; CUST.n = v.n;
        try { localStorage.setItem(CUST_KEY, j); } catch (e) { /* 기억 못 해도 답이 오면 보인다 */ }
    }
    const custHasSms = () => SMS.sumDone ? !!SMS.sum : !!(SMS.sum || CUST.sms);       // 문자 줄을 보일지(답 오기 전 = 지난 기억)
    const custHasInb = () => INB.known ? inbOk() : (inbOk() || !!CUST.inb);            // 톡톡·문의 줄을 보일지
    const smsOpenN = () => { const d = SMS.sum; if (!d) return 0; return d.open_threads != null ? (Number(d.open_threads) || 0) : smsNeed().unread; };   // 문자 미처리(옛 서버면 종전 안 읽음)
    function custNums() {
        const m = CUST.n || {}, c = inbCounts(), inb = INB.known || inbOk();
        const out = { sms: SMS.sumDone || SMS.sum ? smsOpenN() : (CUST.sms ? Number(m.sms) || 0 : 0) };
        INB_CH.forEach(([k]) => { out[k] = inb ? (inbOk() ? c[k].needs : 0) : (CUST.inb ? Number(m[k]) || 0 : 0); });
        out.total = out.sms + out.talk + out.qna + out.inquiry;
        return out;
    }
    function custMenu() {
        const n = custNums(), hs = custHasSms(), hi = custHasInb();
        const sb = $('desk-sms-now'), sn = $('sms-chip-n'); if (sb) sb.hidden = !hs;
        if (sn) { sn.hidden = !(n.sms > 0); sn.textContent = n.sms > 99 ? '99+' : String(n.sms); }
        INB_CH.forEach(([k]) => { const b = $('desk-inb-' + k), i = $('inb-n-' + k); if (b) b.hidden = !hi; if (i) { i.hidden = !(n[k] > 0); i.textContent = n[k] > 99 ? '99+' : String(n[k]); } });
        const g = $('desk-plus-cust'); if (g) g.hidden = !hs && !hi;   // 둘 다 없는 서버면 「손님」 묶음째 숨김
        const pn = $('desk-plus-n'); if (pn) { pn.hidden = !(n.total > 0); pn.textContent = n.total > 99 ? '99+' : String(n.total); }
        if (SMS.sumDone && (INB.known || !inbApi())) custSave();
    }
    // 답이 오기 전에 줄을 눌렀으면(기억으로 보이는 줄) 답을 잠깐 기다렸다가 연다
    function custWait(ready, go) { let i = 0; const t = () => { if (ready() || ++i > 40) { go(); return; } setTimeout(t, 100); }; t(); }
    function inbSoon() { let i = 0; const t = () => { if (inbApi()) { inbHook(); return; } if (++i < 50) setTimeout(t, 100); else { INB.known = true; custMenu(); plusShorts(); } }; t(); }   // ao-inbox.js 는 이 파일 뒤에 실린다
    const INB_CH = [['talk', '톡톡'], ['qna', '상품문의'], ['inquiry', '주문문의']];
    const INB_SUB = { talk: '톡톡 문의 · 여기서 답하면 손님 톡톡으로 바로 보내져요', qna: '상품문의 · 답하면 스마트스토어에 바로 등록돼요(누구나 보는 글)', inquiry: '주문문의 · 답하면 스마트스토어에 바로 등록돼요' };
    const inbApi = () => (window.AkmInbox && typeof window.AkmInbox.mount === 'function') ? window.AkmInbox : null;
    const inbOk = () => { const a = inbApi(); try { return !!(a && typeof a.available === 'function' && a.available()); } catch (e) { return false; } };
    function inbCounts() {
        const a = inbApi(); let c = null; try { c = a && a.counts ? a.counts() : null; } catch (e) { c = null; }
        const out = {}; INB_CH.forEach(([k]) => { const x = c && c[k]; out[k] = { unread: Number(x && x.unread) || 0, needs: Number(x && (x.needs != null ? x.needs : x.open)) || 0 }; });
        return out;
    }
    const inbUnread = () => { if (!inbOk()) return 0; const c = inbCounts(); return INB_CH.reduce((n, [k]) => n + c[k].needs, 0); };   // #660: 톡톡·문의는 「답 안 한 것」(needs = 서버 counts.open · [확인]·답으로 줄어듦)
    function inbSub() {
        const sub = $('sms-sub'), md = $('sms-mode'); if (!sub) return;
        if (INB.ch === 'sms') return;
        sub.textContent = INB_SUB[INB.ch] || ''; if (md) md.hidden = true; smsNote('');
    }
    function inbTabs() {
        const el = $('sms-tabs'), ttl = $('sms-title'); if (!el) return;
        const on = inbOk();
        custMenu();
        if (ttl) ttl.textContent = on ? '손님 연락' : '문자';
        if (!on) { el.hidden = true; return; }
        const c = inbCounts(), smsN = smsOpenN();
        const tabs = (SMS.sum ? [['sms', '문자', smsN]] : []).concat(INB_CH.map(([k, name]) => [k, name, c[k].needs]));
        const html = tabs.map(([k, name, n]) => `<button type="button" class="sms-tab" role="tab" data-ch="${k}" aria-selected="${String(INB.ch === k)}" tabindex="${INB.ch === k ? 0 : -1}">${name}${n > 0 ? `<i class="sms-n" aria-label="미처리 ${n}">${n > 99 ? '99+' : n}</i>` : ''}</button>`).join('');
        if (el.dataset.sig !== html) {
            const had = document.activeElement && document.activeElement.closest && document.activeElement.closest('#sms-tabs') ? document.activeElement.dataset.ch : '';
            el.dataset.sig = html; el.innerHTML = html;
            if (had) { const b = el.querySelector('[data-ch="' + had + '"]'); if (b) b.focus({ preventScroll: true }); }
        }
        el.hidden = false;
    }
    // 사람이 화면에서 톡톡·문의 대화를 펴고 접을 때 AkmInbox 가 부른다 → 뒤로가기 칸(창 'win' 위의 'th')을 문자와 같은 방식으로
    function inbOnThread(open) {
        if (!document.body.classList.contains('sms-win-open') || INB.ch === 'sms') return;
        if (open) { if (smsHistAt() === 'win') smsHistPush('th'); }
        else if (smsHistAt() === 'th') smsHistBack(1);
    }
    // 창이 떠 있는 채로 탭을 바꾼다(ch = sms|talk|qna|inquiry · openId = 그 대화를 바로 폄)
    function inbShow(ch, openId) {
        const host = $('inb-host'), cols = document.querySelector('#desk-sms .sms-cols'); if (!host || !cols) return;
        const a = inbApi(), ok = inbOk();
        if (ch !== 'sms' && !(ok && INB_CH.some(x => x[0] === ch))) ch = 'sms';
        if (ch === 'sms' && !SMS.sum && ok) ch = 'talk';
        const from = INB.ch; let hadTh = false;
        if (from === 'sms') { if (ch !== 'sms' && SMS.open) { smsThreadClose(false, true); hadTh = true; } else if (ch !== 'sms' && SMS.neu.on) { smsNewClose(false, true); hadTh = true; } }
        else if (a && ch !== from) { try { hadTh = !!a.isOpen(); } catch (e) { hadTh = false; } }
        INB.ch = ch;
        if (ch === 'sms') {
            if (a && from !== 'sms') { try { a.unmount(); } catch (e) { /* 칸은 아래에서 숨긴다 */ } }
            host.hidden = true; cols.hidden = false;
            if (from !== 'sms') { SMS.sig = ''; smsHead(); smsList(); }
        } else {
            cols.hidden = true; host.hidden = false;
            try { a.mount(host, { ch, openId: openId == null || openId === '' ? undefined : openId, onThread: inbOnThread, onView: inbOnView }); } catch (e) { /* 못 그리면 빈 칸 — 탭으로 돌아갈 수 있다 */ }
        }
        if (hadTh && !openId && smsHistAt() === 'th') smsHistBack(1);   // 떠난 탭에서 펴 둔 대화의 칸을 되돌린다(새 대화를 바로 펼 때는 그 칸을 이어 쓴다)
        inbTabs(); if (ch === 'sms') smsHead(); else inbSub();
    }
    function inbOpen(ch, openId) {
        if (!inbOk() || ch === 'sms') { if (SMS.sum) smsOpen(); return !!SMS.sum; }
        if (S.full) { smsAfterFull(() => inbOpen(ch, openId)); return true; }
        smsWinShow(); inbShow(ch, openId); return true;
    }
    // 바로가기 「손님 n」·챙길 일 줄: 안 읽음이 있는 첫 탭으로(문자 먼저)
    function inbOpenFirst() {
        const c = inbCounts(), smsN = smsOpenN();
        const hit = smsN > 0 ? 'sms' : (INB_CH.find(([k]) => c[k].needs > 0) || [SMS.sum ? 'sms' : 'talk'])[0];
        if (hit === 'sms') smsOpen(); else inbOpen(hit);
    }
    // 틱마다: AkmInbox 가 늦게 실려도(스크립트 순서) 숫자 알림을 한 번 걸고, 간격은 AkmInbox 가 스스로 지킨다
    function inbHook() {
        const a = inbApi(); if (!a) return;
        if (!INB.bound) { INB.bound = true; try { if (a.onCounts) a.onCounts(() => { const was = INB.known; INB.known = true; inbTabs(); smsChip(); plusShorts(); if (S.board) renderBoard(); if (S.inbox) renderInbox(); if (was) boardSoon(); }); } catch (e) { /* 숫자는 다음 틱에 */ } }
        try { if (a.refresh) a.refresh(); } catch (e) { /* 다음 틱에 */ }
        if (!INB.known && inbOk()) { INB.known = true; inbTabs(); plusShorts(); }
    }
    // #677: 창 'win' · 대화 'th' 칸은 HB 의 겹(sms-win · sms-th) — 그 위에 사진(sms-view)·구매이력 펼침(sms-buy)
    const smsHistAt = () => hbHas('sms-th') ? 'th' : hbHas('sms-win') ? 'win' : '';   // '' | 'win' | 'th'
    const smsHistPush = k => hbPush('sms-' + k, k === 'th' ? smsPopTh : smsPopWin, { smsWin: k });
    const smsHistBack = n => { if (!(n > 0)) return; if (n >= 2 || !hbHas('sms-th')) hbDrop('sms-view', 'sms-buy', 'sms-th', 'sms-win'); else hbDrop('sms-view', 'sms-buy', 'sms-th'); };
    function smsPopTh() {   // 뒤로가기로 대화 칸이 빠짐 → 대화만 접는다
        if (INB.ch !== 'sms') { const a = inbApi(); try { for (let i = 0; a && i < 3 && a.isOpen(); i++) a.back(); } catch (e) { /* 다음 조작에서 맞춰진다 */ } }
        else if (SMS.neu.on) smsNewClose(true, true);
        else if (SMS.open) smsThreadClose(true, true);
    }
    function smsPopWin() { if (document.body.classList.contains('sms-win-open')) smsCloseCard(); }   // 창 칸까지 빠짐 → 창 닫기
    function smsPopView() { if (smsViewClose()) return; const v = document.getElementById('inb-view'), a = inbApi(); if (v && !v.hidden && a) { try { a.back(); } catch (e) { /* 그대로 */ } } }
    function inbOnView(open) { if (open) hbPush('sms-view', smsPopView, { smsWin: 'th' }); else hbDrop('sms-view'); }   // 톡톡·문의 탭의 사진 크게 보기(AkmInbox 가 부른다)
    function smsPopBuy() { if (SMS.open) SMS.buyOpen.delete(SMS.open); SMS.buyShow = 5; smsBuyRender(); const bo = document.getElementById('sms-order'); if (bo) bo.scrollTop = 0; }
    function smsBuyLyr() { if (SMS.open && SMS.buyOpen.has(SMS.open) && document.querySelector('#sms-order.has-more')) hbPush('sms-buy', smsPopBuy, { smsWin: 'th' }); else hbDrop('sms-buy'); }
    function smsAfterFull(fn) { if (S.full) closeFull(); fn(); }   // 「자세히 확인하기」 전체 화면이 떠 있으면 먼저 닫는다(기록 되돌리기는 HB 가 한 줄로 세운다)
    function smsWinShow() {
        const was = smsVisible() && document.body.classList.contains('sms-win-open');
        toolShow('desk-sms');
        if (was) return;
        document.body.classList.add('sms-win-open');
        if (!smsHistAt()) smsHistPush('win');
        const x = $('sms-close'); if (x) x.focus({ preventScroll: true });
    }
    function smsWinCleanup() {
        if (!document.body.classList.contains('sms-win-open')) return;
        smsThreadClose(false, true); smsNewClose(false, true); smsViewClose(); SMS.buyOpen.clear(); setTimeout(() => { try { loadInbox(); boardSoon(); } catch (e) { /* 다음 주기에 */ } }, 400);   // #661 창에서 답·[확인]한 것이 손님 연락 카드에 바로
        if (INB.ch !== 'sms') {   // #658 톡톡·문의 탭을 보던 채 닫으면: 그 칸을 걷고 다음에는 문자 탭부터
            const a = inbApi(); try { if (a) a.unmount(); } catch (e) { /* 칸은 숨긴다 */ }
            INB.ch = 'sms'; const h = $('inb-host'), c = document.querySelector('#desk-sms .sms-cols'); if (h) h.hidden = true; if (c) c.hidden = false; inbTabs();
        }
        document.body.classList.remove('sms-win-open');
        const at = smsHistAt(); smsHistBack(at === 'th' ? 2 : at === 'win' ? 1 : 0);
    }
    function smsOpen(scope) {
        if (!SMS.sum) return;
        if (S.full) { smsAfterFull(() => smsOpen(scope)); return; }
        smsWinShow();
        if (INB.ch !== 'sms') inbShow('sms');
        if (scope === 'active' || scope === 'open' || scope === 'all') { SMS.scope = scope === 'all' ? 'all' : 'open'; SMS.only = false; SMS.q = ''; $('sms-q').value = ''; SMS.items = null; SMS.sig = ''; }
        smsHead(); smsList();
        if (Date.now() - SMS.sumAt > 3000) smsSummary();
    }
    function smsStaffOnly(on) {   // 직원 확인이 필요한 대화만(이전 대화까지 받아 화면에서 거른다 · 최근 50건 안)
        if (!on) { smsScope('all'); return; }
        if (S.full) { smsAfterFull(() => smsStaffOnly(true)); return; }
        smsOpen('all'); SMS.only = true; SMS.sig = ''; smsHead(); smsRenderList();
    }
    function smsScope(v) {
        v = v === 'open' ? 'open' : 'all';
        if (v === SMS.scope && !SMS.only) return;
        const same = v === SMS.scope; SMS.scope = v; SMS.only = false; SMS.sig = '';
        if (same) { smsHead(); smsRenderList(); return; }   // 거르기만 푼다(받아 둔 목록 그대로)
        SMS.items = null;
        smsHead(); smsList();
    }
    // ── #688(대표 10/14) 문자 먼저 보내기 — [새 문자] → 오른쪽 대화 칸에 「새 문자」 판(대화 한 건을 연 것과 같은 자리 · 같은 뒤로가기 칸 'th' · Esc)
    //   서버: POST /api/sms/send { phone(숫자만), text } → { ok, thread_id, thread } · 실패 { ok:false, error } · 옛 서버 = 요약에 send_route 없음(단추 숨김) 또는 404(그때 끔)
    //   번호 = 숫자만 남기고 +82 → 0 · 휴대폰 전체 번호(01x 10~11자리)만 통과 · 글의 이모지는 서버 smsSafe 가 빼므로 미리 알린다 · 단추 글에 번호를 적어 누르는 순간 보이게(확인 창 없음)
    const smsNewNo = v => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('82') && d.length >= 11) d = '0' + d.slice(2).replace(/^0/, ''); return d; };
    const smsNewOk = d => /^01[016789]\d{7,8}$/.test(d);
    const smsNewEmoji = t => { try { return (String(t || '').match(/\p{Extended_Pictographic}/gu) || []).length; } catch (e) { return 0; } };
    function smsNewSync() {
        const ph = document.getElementById('sms-new-phone'), ta = document.getElementById('sms-new-text'); if (!ph || !ta) return;
        const N = SMS.neu, d = smsNewNo(ph.value), okNo = smsNewOk(d), has = !!ta.value.trim();
        N.phone = ph.value; N.text = ta.value;
        const btn = $('sms-new-send'); btn.disabled = !okNo || !has || N.busy; btn.textContent = N.busy ? '보내는 중' : okNo ? smsFmtNo(d) + ' 로 보내기' : '보내기';
        if (N.busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
        const pe = $('sms-new-perr'), bad = !!d && !okNo && N.touched; pe.hidden = !bad; pe.textContent = bad ? '휴대폰 번호 전체를 적어 주세요(예: 010-1234-5678).' : ''; ph.setAttribute('aria-invalid', String(bad));
        const hint = $('sms-new-hint'), old = okNo ? (SMS.items || []).find(x => smsFull(x) === d) : null, hk = old ? String(old.id) : '';
        if (hint.dataset.k !== hk) { hint.dataset.k = hk; hint.hidden = !old; hint.innerHTML = old ? `이 번호와 나눈 대화가 있어요. <button type="button" class="sms-new-goto" id="sms-new-goto" data-id="${old.id}">그 대화 열기</button>` : ''; }
        $('sms-new-len').textContent = has ? nfmt(ta.value.length) + '자' : (window.matchMedia('(pointer: fine)').matches ? 'Ctrl+Enter 로 보내기' : '');
        const w = $('sms-new-warn'), em = smsNewEmoji(ta.value), dead = smsDead();
        w.hidden = !(em || dead); w.textContent = [em ? '이모지 ' + nfmt(em) + '개는 문자에서 깨져서 빠진 채 나가요.' : '', dead ? '회사폰 연결이 끊겨 있어요. 지금 보낸 글은 연결이 돌아오면 나가요. 10분 넘으면 「보내지 못함」으로 바뀌어요.' : ''].filter(Boolean).join(' ');
        const er = $('sms-new-err'); er.hidden = !N.err; er.textContent = N.err || '';
    }
    function smsNewOpen() {
        if (SMS.newOff || !SMS.sum) return;
        if (SMS.neu.on) { const f = document.getElementById('sms-new-phone'); if (f) f.focus({ preventScroll: true }); return; }
        smsThreadClose(false, true);   // 보던 대화는 접는다 — 뒤로가기 칸은 그대로(아래에서 같은 칸을 쓴다)
        const N = SMS.neu; N.on = true; N.err = ''; N.touched = !!smsNewNo(N.phone);
        const box = document.createElement('div');
        box.className = 'sms-thread sms-new'; box.id = 'sms-newbox'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', '새 문자 보내기');
        box.innerHTML = '<div class="sms-th-head"><button type="button" class="sms-th-back" id="sms-new-back" aria-label="목록으로 돌아가기">목록</button><b>새 문자</b><button type="button" class="sms-th-x" id="sms-new-x" aria-label="새 문자 닫기" title="닫기 (Esc)">×</button></div>'
            + '<form class="sms-new-form" id="sms-new-form" autocomplete="off" novalidate>'
            + '<p class="sms-new-lead">안내·답변용이에요. 행사·광고 글은 보내지 마세요.</p>'
            + '<div class="sms-new-f"><label for="sms-new-phone">받는 번호</label><input type="tel" inputmode="numeric" class="sms-new-in" id="sms-new-phone" maxlength="17" placeholder="010-1234-5678" aria-describedby="sms-new-perr sms-new-hint" aria-invalid="false"><p class="sms-new-perr" id="sms-new-perr" role="alert" hidden></p><p class="sms-new-hint" id="sms-new-hint" hidden></p></div>'
            + '<div class="sms-new-f grow"><label for="sms-new-text">보낼 글</label><textarea class="sms-text" id="sms-new-text" rows="6" maxlength="1000" aria-describedby="sms-new-tip"></textarea><p class="sms-new-tip" id="sms-new-tip">회사폰 번호로 나가요. 이모지는 문자에서 깨져서 빠져요.</p></div>'
            + '<div class="sms-warn" id="sms-new-warn" role="status" hidden></div>'
            + '<p class="sms-new-err" id="sms-new-err" role="alert" hidden></p>'
            + '<div class="sms-reply-row"><span class="sms-len" id="sms-new-len"></span><button type="submit" class="desk-btn primary" id="sms-new-send" disabled>보내기</button></div>'
            + '</form>';
        $('sms-pane').replaceChildren(box);
        $('desk-sms').classList.add('sms-open');
        if (smsHistAt() !== 'th') smsHistPush('th');
        const ph = $('sms-new-phone'), ta = $('sms-new-text'); ph.value = N.phone; ta.value = N.text;
        smsNewSync(); smsVv();
        (smsNewOk(smsNewNo(N.phone)) ? ta : ph).focus({ preventScroll: true });
    }
    function smsNewClose(focusBtn, keepHist) {
        const N = SMS.neu; if (!N.on) return;
        const ph = document.getElementById('sms-new-phone'), ta = document.getElementById('sms-new-text'); if (ph) N.phone = ph.value; if (ta) N.text = ta.value;   // 적던 것은 이 창을 여는 동안 기억
        N.on = false; N.err = '';
        const pane = $('sms-pane'); if (pane && document.getElementById('sms-newbox')) pane.innerHTML = '<div class="sms-pane-empty">왼쪽 목록에서 대화를 골라 주세요.</div>';
        const card = $('desk-sms'); if (card) card.classList.remove('sms-open');
        if (!keepHist && smsHistAt() === 'th') smsHistBack(1);
        smsVv();
        if (focusBtn) { const b = $('sms-new'); if (b && !b.hidden) b.focus({ preventScroll: true }); }
    }
    async function smsNewSend() {
        const N = SMS.neu, ph = document.getElementById('sms-new-phone'), ta = document.getElementById('sms-new-text'); if (!N.on || N.busy || !ph || !ta) return;
        const phone = smsNewNo(ph.value), text = ta.value.trim();
        if (!smsNewOk(phone)) { N.touched = true; smsNewSync(); ph.focus({ preventScroll: true }); return; }
        if (!text) { ta.focus({ preventScroll: true }); return; }
        N.busy = true; N.err = ''; smsNewSync();
        let res = null, status = 0;
        try {
            const r = await fetch('/api/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') }, body: JSON.stringify({ phone, text }) });
            status = r.status; res = await r.json().catch(() => ({}));
            if (status === 401 && typeof akmSessionExpired === 'function') akmSessionExpired();
        } catch (e) { res = { ok: false, error: '통신이 끊겼어요. 다시 눌러 주세요' }; }
        N.busy = false;
        if (status === 404) {   // 옛 서버 — 단추를 끄고 판을 걷는다(적던 글은 기억)
            SMS.newOff = true; smsNewClose(false); smsHead(); showToast('이 서버에서는 아직 새 문자를 보낼 수 없어요', '', 5000); return;
        }
        if (!(status >= 200 && status < 300) || !res || res.ok === false) { N.err = '보내지 못했어요: ' + ((res && res.error) || '다시 시도해 주세요'); if (N.on) smsNewSync(); else showToast(N.err, '', 5000); return; }
        N.phone = ''; N.text = ''; N.touched = false;
        if (ph.isConnected) ph.value = ''; if (ta.isConnected) ta.value = '';
        showToast(smsFmtNo(phone) + ' 로 문자를 보냈어요. 회사폰에서 나가면 「보냄」으로 바뀌어요');
        const id = Number(res.thread_id) || 0;
        smsNewClose(false, true);   // 뒤로가기 칸은 두고 그 자리에 보낸 대화를 연다
        if (INB.ch === 'sms' && smsVisible()) {
            SMS.scope = 'all'; SMS.only = false; SMS.q = ''; clearTimeout(SMS.qt); $('sms-q').value = ''; SMS.items = null; SMS.sig = '';
            smsHead(); await smsList();
            // 응답 직후엔 글이 큐에만 있어 서버 목록에서 그 대화의 마지막 글 시각이 비어 있을 수 있다(새 대화면 50건 밖일 수도) → 응답의 줄을 목록 맨 위에 올려 두고 연다(다음 목록 조회부터는 서버 순서)
            if (id && Array.isArray(SMS.items) && !SMS.err) { const at = SMS.items.findIndex(x => x.id === id), row = Object.assign({}, res.thread && typeof res.thread === 'object' ? res.thread : {}, at >= 0 ? SMS.items[at] : {}, { id }); if (at >= 0) SMS.items.splice(at, 1);
                if (smsLastDir(row) !== 'out' || !row.last_out_text) { const now = new Date().toISOString(); Object.assign(row, { last_dir: 'out', last_out_text: text.slice(0, 120), last_out_at: now, last_at: now }); }   /* 줄에 「나: 보낸 글」이 바로 보이게(서버 값이 채워지면 그것으로 바뀐다) */ if (at >= 0 || res.thread) { SMS.items.unshift(row); SMS.sig = ''; smsRenderList(); } }
            if (id && document.querySelector('#sms-list .sms-item[data-id="' + id + '"]')) smsThreadOpen(id);
            else if (smsHistAt() === 'th' && !SMS.open && !SMS.neu.on) smsHistBack(1);
        }
        smsSummary();
    }
    function smsCloseCard() {
        smsWinCleanup();
        SMS.imgs.forEach(p => p.then(u => { if (u) URL.revokeObjectURL(u); }).catch(() => { })); SMS.imgs.clear();
        toolShow(null); plusFocus('sms');
    }
    async function smsList(quiet) {
        if (!smsVisible()) return;
        const seq = ++SMS.seq, q = SMS.q, asked = Date.now();
        SMS.lbusy = true; SMS.listAt = asked;
        if (!quiet && !SMS.items) $('sms-list').innerHTML = '<li class="desk-empty ship-empty">불러오는 중</li>';
        let d, err = '';
        try { d = await api(smsListUrl(q)); } catch (e) { err = (e && e.message) || '불러오지 못했어요'; }
        if (seq !== SMS.seq) return;
        SMS.lbusy = false;
        if (!err && !(d && Array.isArray(d.items))) err = (d && d.error) || '불러오지 못했어요';
        if (err && quiet && SMS.items) return;   // 뒤에서 다시 받다 실패하면 보이던 목록을 그대로 둔다
        // #730 「더 보기」: 첫 쪽만 다시 받고, 더 보기로 붙인 뒤쪽(tail)은 이어 둔다 · 목록을 새로 시작하면(items = null · 찾기·탭 바꿈) 뒤쪽을 버린다
        //   옛 서버(more 칸 없음) = 종전 그대로(50건 안내 글)
        if (err || !SMS.items || d.more === false) { SMS.tail = []; SMS.more = !err && d.more === true; }
        else if (!(SMS.tail || []).length) SMS.more = d.more === true;
        SMS.oldSrv = !err && typeof d.more !== 'boolean';
        if (err) SMS.items = [];
        else { const ids = new Set(d.items.map(x => x.id)); SMS.tail = (SMS.tail || []).filter(x => !ids.has(x.id)); SMS.items = d.items.concat(SMS.tail); }
        SMS.err = err; SMS.itemsAt = asked;
        smsHead(); smsRenderList();
    }
    const smsListUrl = (q, offset) => '/api/sms/threads?scope=' + (SMS.scope === 'open' && SMS.sum && !('open_threads' in SMS.sum) ? 'active' : SMS.scope) + '&q=' + encodeURIComponent(q) + '&limit=50' + (offset ? '&offset=' + offset : '');
    // #730(대표 10/18 「50건까지만 보여요 — 나머지도」): 목록 맨 아래 [더 보기] = 다음 50건을 이어 붙임(찾기 결과에도) · 다 보면 「끝」
    async function smsMore() {
        if (SMS.mbusy || !SMS.more || !SMS.items) return;
        const key = SMS.scope + '\u0001' + SMS.q, have = SMS.items;
        SMS.mbusy = true; SMS.sig = ''; smsRenderList();
        let d = null, err = '';
        try { d = await api(smsListUrl(SMS.q, have.length)); } catch (e) { err = (e && e.message) || '더 불러오지 못했어요'; }
        SMS.mbusy = false; SMS.sig = '';
        if (!SMS.items || key !== SMS.scope + '\u0001' + SMS.q) return;   // 그사이 찾기·탭이 바뀜 — 버린다
        if (err || !(d && Array.isArray(d.items))) { smsRenderList(); showToast(err || '더 불러오지 못했어요'); return; }
        const ids = new Set(SMS.items.map(x => x.id)), add = d.items.filter(x => !ids.has(x.id));   // 사이에 새 글이 와서 한 줄 밀렸으면 겹친 줄은 뺀다
        SMS.tail = (SMS.tail || []).concat(add); SMS.items = SMS.items.concat(add); SMS.more = d.more === true;
        smsRenderList();
        const li = document.querySelectorAll('#sms-list .sms-item')[have.length]; if (li) { const b = li.querySelector('.sms-row'); if (b) b.focus({ preventScroll: true }); if (li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); }
    }
    // #624(대표 10/10 「번호 다 뜨게」): 서버가 phone_full(숫자만)을 주면 전체 번호를 010-1234-5678 꼴로 — 없으면(옛 서버) 종전 가림 글. 대화 머리의 번호는 누르면 전화(tel:)
    const smsFmtNo = d => { d = String(d || '').replace(/\D/g, ''); return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.length === 10 ? (d.startsWith('02') ? '02-' + d.slice(2, 6) + '-' + d.slice(6) : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6)) : d.length === 12 ? d.slice(0, 4) + '-' + d.slice(4, 8) + '-' + d.slice(8) : d; };
    const smsFull = x => String((x && x.phone_full) || '').replace(/\D/g, '');
    const smsNo = x => (smsFull(x) ? smsFmtNo(smsFull(x)) : '끝 ' + (x.phone_tail || ''));   // 목록 줄 — 옛 응답이면 종전 「끝 1234」
    const smsNoHtml = x => (smsFull(x) ? `<a class="sms-tel" href="tel:${esc(smsFull(x))}" aria-label="${esc(smsFmtNo(smsFull(x)))} 로 전화 걸기">${esc(smsFmtNo(smsFull(x)))}</a>` : esc(x.phone_masked || '끝 ' + (x.phone_tail || '')));
    // #635 줄 = 번호 · 손님 힌트 · 안 읽음 배지 · 시각 / 마지막 글 한 줄(우리가 마지막이면 「나:」) / 사람 몫 사유 · 초안 표시. 옛 서버(unread 칸 없음)면 배지 자리에 종전 상태 배지
    const smsLastDir = x => (x.last_dir === 'in' || x.last_dir === 'out') ? x.last_dir : (x.last_out_at && (!x.last_in_at || tms(x.last_out_at) > tms(x.last_in_at)) ? 'out' : 'in');
    const smsOld = x => typeof x.unread !== 'number';
    const smsWhy = x => (x.needs_staff || (smsOld(x) && x.status === 'staff_needed')) ? (x.staff_why_label || '직원 확인') : '';
    const smsHeadBadge = t => { const w = smsWhy(t); return w ? `<span class="desk-badge" data-k="ask">${esc(w)}</span>` : smsBadge(t.status); };
    function smsRowHtml(x) {
        const open = SMS.open === x.id, out = smsLastDir(x) === 'out', old = smsOld(x), un = (open && SMS.readAt >= SMS.itemsAt) ? 0 : (Number(x.unread) || 0);
        const at = x.last_at || (out ? x.last_out_at : x.last_in_at), why = smsWhy(x);
        const text = out ? (x.last_out_text || '') : (x.last_in_text || '');
        const draft = !!x.draft_text && x.status !== 'closed' && x.status !== 'ignored';   // 끝난 대화에 남은 초안은 표시하지 않는다(보낼 일이 없다)
        const typ = TYP.off ? '' : typNames(TYP.others[x.id]).join('·');   // #683 누가 답을 쓰는 중인지(나는 빼고)
        return `<li class="sms-item${open ? ' open' : ''}${un > 0 ? ' unread' : ''}" data-id="${x.id}" data-st="${esc(x.status || '')}" data-un="${un}">`
            + `<button type="button" class="sms-row" aria-expanded="${String(open)}" aria-controls="sms-thread">`
            + `<span class="sms-tail">${esc(smsNo(x))}</span>`
            + `<span class="sms-hint${x.customer_hint ? '' : ' none'}">${esc(x.customer_hint || '주문을 찾지 못한 번호')}</span>`
            + (un > 0 ? `<i class="sms-n sms-un" aria-label="안 읽은 글 ${un}개">${un > 99 ? '99+' : un}</i>` : old ? smsBadge(x.status) : '')
            + `<time class="sms-time">${esc(smsWhen(at))}</time>`
            + `<span class="sms-last">${out ? '<b class="sms-me">나:</b> ' : ''}${!out && x.has_image ? '<i class="sms-pic">사진</i>' : ''}${esc(text || (!out && x.has_image ? '' : '(글 없음)'))}</span>`
            + ((why || draft || typ) ? `<span class="sms-tags">${why ? `<i class="sms-why">${esc(why)}</i>` : ''}${draft ? '<i class="sms-tag">초안</i>' : ''}${typ ? `<i class="sms-typ">${esc(typ)} 입력 중</i>` : ''}</span>` : '')
            + '</button></li>';
    }
    function smsRenderList() {
        const ul = $('sms-list'); if (!ul) return;
        let items = (SMS.items || []).slice();
        if (SMS.only) items = items.filter(x => smsWhy(x) || x.id === SMS.open);   // 직원 확인이 필요한 대화만
        // 열어 둔 대화는 읽음이 되어 「새 문자」 목록에서 빠져도 접기 전까지 제자리에 둔다
        if (SMS.open) {
            const at = items.findIndex(x => x.id === SMS.open);
            if (at >= 0) { SMS.openRow = items[at]; SMS.openAt = at; }
            else if (SMS.openRow) items.splice(Math.min(SMS.openAt, items.length), 0, SMS.openRow);
        }
        const sig = smsSig([items, SMS.scope, SMS.only, SMS.q, SMS.open, SMS.err, TYP.lsig, SMS.more, SMS.mbusy]);
        const all = (SMS.items || []).length;
        const cnt = $('sms-count'); if (cnt) cnt.textContent = SMS.err ? ''
            : SMS.oldSrv ? (items.length >= 50 && !SMS.only ? '50건까지 보여요. 끝 4자리·전체 번호나 글로 찾아보세요.' : (SMS.only ? '직원 확인만 · ' : '') + nfmt(items.length) + '건' + (SMS.only && all >= 50 ? ' · 최근 50건 안에서' : ''))   // 옛 서버(더 보기 없음)
            : SMS.only ? '직원 확인만 · ' + nfmt(items.length) + '건' + (SMS.more ? ' · 불러온 ' + nfmt(all) + '건 안에서 · 더 보기로 이어서' : '')
            : SMS.more ? (SMS.q ? '찾은 ' + nfmt(all) + '건 · 더 보기로 이어서' : '최근 ' + nfmt(all) + '건 · 더 보기로 이어서 · 끝 4자리·전체 번호·글로 찾으면 전체에서')
            : nfmt(items.length) + '건';
        if (sig === SMS.sig && ul.firstChild) return;
        SMS.sig = sig;
        let html = items.map(smsRowHtml).join('');
        if (!html) html = SMS.err ? `<li class="desk-empty ship-empty">${esc(SMS.err)}</li>`
            : SMS.q ? `<li class="desk-empty ship-empty">${esc(`「${SMS.q}」로 찾은 문자가 없어요.`)}</li>`
            : SMS.only ? '<li class="desk-empty ship-empty">직원 확인이 필요한 대화가 없어요.</li>'
            : SMS.scope === 'all' ? '<li class="desk-empty ship-empty">아직 들어온 문자가 없어요.</li>'
            : '<li class="desk-empty ship-empty sms-none"><span>미처리 문자가 없어요.</span><button type="button" class="desk-btn sm sms-empty-go">전체 대화 보기</button></li>';
        if (!SMS.err && all && !SMS.oldSrv) {
            if (SMS.more) html += `<li class="desk-empty ship-empty sms-none sms-more-li"><button type="button" class="desk-btn sm sms-more"${SMS.mbusy ? ' disabled aria-busy="true"' : ''}>${SMS.mbusy ? '불러오는 중' : '더 보기(50건씩)'}</button></li>`;
            else if (all > 50) html += '<li class="desk-empty ship-empty sms-end">끝 — 더 없어요</li>';
        }
        const top = ul.scrollTop;
        ul.innerHTML = html;
        ul.scrollTop = top;
    }
    // 대화 펼치기 — PC 는 창 오른쪽 칸에, 폰은 창을 덮는 전체 화면으로(같은 요소 · 모양만 CSS 로)
    function smsThreadOpen(id) {
        if (SMS.open === id) { if (window.matchMedia('(max-width: 720px)').matches) smsThreadClose(true); return; }   // PC 2단에서는 같은 줄을 또 눌러도 그대로 둔다
        smsThreadClose(false, true);   // 다른 대화로 옮김 — 뒤로가기 칸은 그대로 둔다
        smsNewClose(false, true);   // #688 새 문자 판이 떠 있었으면 걷는다(적던 글은 기억)
        const li = document.querySelector('#sms-list .sms-item[data-id="' + id + '"]');
        if (!li) { if (smsHistAt() === 'th') smsHistBack(1); return; }
        const x = (SMS.items || []).find(i => i.id === id) || {};
        SMS.open = id; SMS.thread = null; SMS.tsig = ''; SMS.filled = 0; SMS.fillText = ''; SMS.newDraft = ''; SMS.chgAt = 0; SMS.lockUntil = 0; SMS.buyShow = 5; SMS.readAt = Date.now(); SMS.actAt = Date.now();
        SMS.openAt = Math.max(0, (SMS.items || []).findIndex(i => i.id === id)); SMS.openRow = x.id ? x : null;
        { const un = li.querySelector('.sms-un'); if (un) un.remove(); li.classList.remove('unread'); li.dataset.un = '0'; }   // #635 여는 순간 읽음(서버도 GET 에서 읽음으로)
        const th = document.createElement('div');
        th.className = 'sms-thread'; th.id = 'sms-thread'; th.dataset.id = String(id); th.setAttribute('role', 'region'); th.setAttribute('aria-label', '끝 ' + (x.phone_tail || '') + ' 번호와 주고받은 문자');
        th.innerHTML = `<div class="sms-th-head"><button type="button" class="sms-th-back" id="sms-th-back" aria-label="목록으로 돌아가기">목록</button><b id="sms-th-phone">${smsNoHtml(x)}</b><span id="sms-th-badge">${smsHeadBadge(x)}</span><button type="button" class="desk-btn sm sms-done" id="sms-done" aria-pressed="false" hidden>처리함</button><button type="button" class="sms-th-x" id="sms-th-x" aria-label="이 대화 접기" title="접기 (Esc)">×</button></div>`
            + `<div class="sms-order sms-buy" id="sms-order">구매이력을 찾는 중</div>`
            + `<div class="sms-msgs" id="sms-msgs" tabindex="0" aria-label="주고받은 문자"><div class="desk-empty ship-empty">불러오는 중</div></div>`
            + `<form class="sms-reply" id="sms-reply" autocomplete="off">`
            + `<div class="sms-typing" id="sms-typing" role="status" aria-live="polite" hidden></div>`
            + `<div class="sms-draft" id="sms-draft" hidden>봇이 만든 초안이에요. 그대로 보내거나 고쳐서 보낼 수 있어요.</div>`
            + `<div class="sms-warn" id="sms-warn" role="status" hidden></div>`
            + `<label class="desk-sr" for="sms-text">손님에게 보낼 답 문자</label>`
            + `<textarea class="sms-text" id="sms-text" rows="3" maxlength="1000" placeholder="손님에게 보낼 문자를 적어 주세요"></textarea>`
            + `<div class="sms-reply-row"><span class="sms-len" id="sms-len"></span><button type="submit" class="desk-btn primary" id="sms-send" disabled>답 보내기</button></div>`
            + `</form>`;
        TYP.sig = ''; TYP.here = TYP.off ? [] : (TYP.others[id] || []); setTimeout(typDraw, 0);   // #683 목록에서 이미 본 입력자를 여는 즉시
        if (window.ResizeObserver) {   // #681: 구매이력 판·초안 띠·답 칸이 늦게 커져 대화 칸이 줄면 마지막 글이 아래로 잘렸다 → 맨 아래를 보고 있었으면 다시 맨 아래로(위 글을 읽는 중이면 그대로)
            const ms = th.querySelector('#sms-msgs'); let stick = true;
            ms.addEventListener('scroll', () => { stick = ms.scrollHeight - ms.scrollTop - ms.clientHeight < 40; }, { passive: true });
            if (SMS.ro) SMS.ro.disconnect();
            SMS.ro = new ResizeObserver(() => { if (stick) ms.scrollTop = ms.scrollHeight; }); SMS.ro.observe(ms);
        }
        document.querySelectorAll('#sms-list .sms-item.open').forEach(o => { o.classList.remove('open'); o.querySelector('.sms-row').setAttribute('aria-expanded', 'false'); });
        li.classList.add('open'); li.querySelector('.sms-row').setAttribute('aria-expanded', 'true');
        $('sms-pane').replaceChildren(th);
        $('desk-sms').classList.add('sms-open');
        if (smsHistAt() !== 'th') smsHistPush('th');
        const ta = $('sms-text'); if (SMS.texts.has(id)) ta.value = SMS.texts.get(id);
        smsSync(); smsVv();
        SMS.sig = '';
        smsThread();
    }
    function smsThreadClose(focusRow, keepHist) {
        const id = SMS.open; if (!id) return;
        typStop(); TYP.here = []; TYP.sig = '';
        if (SMS.ro) { SMS.ro.disconnect(); SMS.ro = null; }
        const ta = document.getElementById('sms-text');
        if (ta) { const v = ta.value; const dr = SMS.thread && SMS.thread.thread && SMS.thread.thread.draft_text; if (v.trim() && v.trim() !== String(dr || '').trim()) SMS.texts.set(id, v); else SMS.texts.delete(id); }
        const read = !!SMS.thread;
        SMS.open = 0; SMS.thread = null; SMS.tseq++; SMS.tbusy = false; SMS.openRow = null;
        // #635 접으면 읽은 대화는 「새 문자」 목록에서 빠진다(이전 대화 보기·찾기 중에는 그대로 · 옛 서버 줄은 그대로)
        if (read && SMS.scope === 'open' && !SMS.q && SMS.items) SMS.items = SMS.items.filter(i => i.id !== id || smsOld(i) || smsWhy(i));   // #660 [답 안 한 것만]: 읽은 대화는 빠진다(사람 몫 사유가 남은 대화는 그대로)
        const pane = $('sms-pane'); if (pane) pane.innerHTML = '<div class="sms-pane-empty">왼쪽 목록에서 대화를 골라 주세요.</div>';
        const card = $('desk-sms'); if (card) card.classList.remove('sms-open');
        if (!keepHist && smsHistAt() === 'th') smsHistBack(1); else hbDrop('sms-view', 'sms-buy');   // 화면에서 접었으면 쌓아 둔 뒤로가기 칸도 되돌린다
        smsVv();
        SMS.sig = ''; smsRenderList();
        if (focusRow) { const r = document.querySelector('#sms-list .sms-item[data-id="' + id + '"] .sms-row') || document.querySelector('#sms-list .sms-row') || document.querySelector('#sms-list .sms-empty-go') || $('sms-q'); if (r) r.focus({ preventScroll: true }); }
    }
    // #653-가 「구매이력」 카드(대표 10/11) — 직원만 보는 주문 정보(손님에게 안 나감). 틀 = 상태 배지 + 칸 맞춘 줄(발송일 · 송장 · 받는 분 · 품목).
    //   자료: 서버 history(#654 · 최근 60일 · 최신순 · 최대 20건)가 있으면 그것 — 가장 위 1건을 보여 주고 나머지는 「구매이력 n건 더보기」로 같은 틀로 펼친다(그 대화를 보는 동안 기억).
    //         history 가 없으면(옛 서버) 종전 order(판정에 쓴 최근 14일 1건)로. 송장 = 전체 번호(누르면 복사 · [조회] = 우리 배송조회 새 창) · 옛 응답이면 「끝 1234」.
    //   #681(대표 10/13 폴드7 실물 「1개만 나오고 +n건 · 접어서 볼 때도 가려」): 「1건」 = 송장 1개(상자 1개). 한 주문에 송장이 2개면 2건으로 나눠, 접힌 판에는 맨 위 1건만 낮게(품목은 한 줄 말줄임) + 머리 줄 오른쪽 「+n건 더보기」
    function smsBuyUnits(o) {
        if (!o || typeof o !== 'object') return [];
        const row = (k, name, html, key, tip) => html ? `<div class="sms-buy-r r-${k}${key ? ' key' : ''}"><dt>${name}</dt><dd data-k="${k}"${key ? ' class="key"' : ''}${tip ? ` title="${tip}"` : ''}>${html}</dd></div>` : '';
        const badge = (text, k) => text ? `<span class="desk-badge" data-k="${k}">${esc(text)}</span>` : '';
        const role = o.role === 'buyer' ? '<small class="sms-buy-role">이 번호가 주문한 건</small>' : o.role === 'both' ? '' : o.role === 'recipient' ? '<small class="sms-buy-role">이 번호가 받는 건</small>' : '';
        const item = esc((o.option_text || '') + (Number(o.qty) > 1 ? ' × ' + nfmt(o.qty) : '') + (Number(o.boxes) > 1 ? ' · ' + nfmt(o.boxes) + '상자' : ''));
        const rName = String(o.recipient_name || '').trim(), rInit = String(o.recipient_initial || '').trim();
        const who = esc(rName ? (rName.length === 1 ? rName + '**' : rName) : (rInit ? rInit + '**' : ''));
        if (o.pre) {
            const pd = smsKd(o.paid_at);
            return [`<div class="sms-buy-i"><div class="sms-buy-s">${badge('발송 전', 'wait')}${role}</div><dl class="sms-buy-g">`
                + row('plan', '발송 예정', o.ship_plan ? esc(String(o.ship_plan).slice(0, 20)) : '', true)   // #654 서버가 달력으로 계산해 준 글자(없으면 줄 없음 — 결제 시각 모름·예약 상품·예정일 지남)
                + row('paid', '결제', pd ? esc((pd.getUTCMonth() + 1) + '/' + pd.getUTCDate() + (o.paid_known === false ? '쯤' : '')) : '', !o.ship_plan)
                + row('who', '받는 분', who) + row('item', '품목', item, false, item) + row('note', '안내', o.ship_plan ? '아직 발송 전이에요(송장은 발송 뒤에 생겨요)' : '아직 발송 전이에요(송장 없음)') + '</dl></div>'];
        }
        if (!(o.ship_date || o.option_text || o.tracking_tail || o.status_label || (Array.isArray(o.trackings) && o.trackings.length))) return [];
        const trks = [...new Set((Array.isArray(o.trackings) ? o.trackings : []).map(x => String(x == null ? '' : x).replace(/[^0-9]/g, '')).filter(x => /^[0-9]{10,12}$/.test(x)))];
        const trk1 = n => `<span class="sms-trk1"><button type="button" class="sms-trk" data-trk="${n}" title="눌러서 복사" aria-label="송장번호 ${n} 복사">${n}</button><a class="sms-trk-go" href="/track?n=${n}" target="_blank" rel="noopener" aria-label="송장번호 ${n} 배송조회(새 창)">조회</a></span>`;
        const trkHtml = trks.length ? `<span class="sms-trks">${trks.map(trk1).join('')}</span>` : (o.tracking_tail ? esc('끝 ' + o.tracking_tail) : '');
        // #657(대표 10/11): 배지 글 = 서버가 지어 준 status_text(「배송 중 · 집화 전」「조회 안 됨」…) — 없으면(옛 서버) status_label. 색 = 배송완료 초록 · 배송 중 인디고 · 조회 안 됨·미배송·사고 주황
        const stK = s => /완료/.test(s) ? 'done' : /조회 안 됨|미배송|사고|반송|실패|없음/.test(s) ? 'ask' : s ? 'work' : 'mute';
        const st = String(o.status_text || o.status_label || '').trim() || (o.delivered ? '배송완료' : '');
        // #657 송장별 품목·상태(서버 boxes_detail) → #681 송장마다 따로 한 건(상태 배지 하나 · 발송일 거래처 · 송장 [조회] · 받는 분 · 그 상자 품목). 「n/m상자」 = 같은 주문의 몇째 상자
        const bd = (Array.isArray(o.boxes_detail) ? o.boxes_detail : []).map(b => ({ n: String((b && b.tracking) == null ? '' : b.tracking).replace(/[^0-9]/g, ''), opt: String((b && b.option_text) || '').trim(), qty: Number(b && b.qty) || 0, st: String((b && (b.status_text || b.status_label)) || '').trim() || (b && b.delivered ? '배송완료' : '') })).filter(b => /^[0-9]{10,12}$/.test(b.n));
        const unit = (s, trk, it, nth, of) => `<div class="sms-buy-i"><div class="sms-buy-s">${badge(s || '상태 확인 전', stK(s))}${role}</div><dl class="sms-buy-g">`
            + row('ship', '발송일', o.ship_date || of ? (o.ship_date ? esc(mdOf(o.ship_date)) : '') + (o.partner ? ` <small>${esc(o.partner)}</small>` : '') + (of ? ` <small class="sms-buy-nth">${nth}/${of}상자</small>` : '') : '', true)
            + row('trk', '송장', trk) + row('who', '받는 분', who) + row('item', '품목', it, false, it) + (o.arrive_text ? row('arrive', '도착', esc(o.arrive_text)) : '') + '</dl></div>';
        if (bd.length >= 2) return bd.map((b, i) => unit(b.st || st, `<span class="sms-trks">${trk1(b.n)}</span>`, b.opt ? esc(b.opt + (b.qty > 1 ? ' × ' + nfmt(b.qty) : '')) : (item || '품목 확인 전'), i + 1, bd.length));
        if (trks.length >= 2) return trks.map((n, i) => unit(st, `<span class="sms-trks">${trk1(n)}</span>`, item, i + 1, trks.length));   // 상자별 자료가 없는 응답 = 송장만 나눔(품목·상태는 주문 것)
        return [unit(st, trkHtml, item)];
    }
    function smsBuyRender() {
        const box = document.getElementById('sms-order'), d = SMS.thread; if (!box || !d) return;
        const t = d.thread || {}, ow = d.order && typeof d.order === 'object' ? d.order : null, o = ow ? (ow.order && typeof ow.order === 'object' ? ow.order : ow) : null;
        const hasHist = Array.isArray(d.history), days = hasHist ? (Number(d.history_days) || 60) : 14;
        const list = hasHist ? d.history.flatMap(smsBuyUnits) : smsBuyUnits(o);
        let html = '';
        if (list.length) {
            const rest = list.length - 1, open = SMS.buyOpen.has(SMS.open), shown = Math.min(rest, Math.max(5, Number(SMS.buyShow) || 5)), left = rest - shown;   // #657: 펼치면 한 번에 5건씩(60일 안 수십 건 손님 — 대화 칸을 가리지 않게)
            html = `<div class="sms-buy-h"><b>구매이력</b><small>최근 ${days}일${list.length > 1 ? ' · ' + nfmt(list.length) + '건' : ''}</small>${rest > 0 ? `<button type="button" class="sms-buy-more" id="sms-buy-more" aria-expanded="${String(open)}" aria-controls="sms-buy-rest" aria-label="${open ? '구매이력 접기' : '구매이력 ' + nfmt(rest) + '건 더보기'}">${open ? '접기' : '+' + nfmt(rest) + '건 더보기'}</button>` : ''}</div>` + list[0]
                + (rest > 0 ? `<div class="sms-buy-rest" id="sms-buy-rest"${open ? '' : ' hidden'}>${list.slice(1, 1 + shown).join('')}${left > 0 ? `<button type="button" class="sms-buy-more next" id="sms-buy-next">${nfmt(Math.min(5, left))}건 더보기 <small>남은 ${nfmt(left)}건</small></button>` : (d.history_more ? `<p class="sms-buy-cap">${nfmt(list.length)}건까지 보여요.</p>` : '')}</div>` : '');
        } else if (!hasHist) {
            const line = String((ow && ow.line) || t.order_hint || '').trim();   // 칸이 없는 옛 응답은 서버가 지어 준 한 줄
            if (line) html = `<div class="sms-buy-h"><b>구매이력</b><small>최근 14일</small></div><div class="sms-buy-i"><dl class="sms-buy-g">${`<div class="sms-buy-r"><dt>요약</dt><dd data-k="line">${esc(line)}</dd></div>`}</dl></div>`;
        }
        box.classList.toggle('none', !html); box.classList.toggle('has-more', list.length > 1); box.classList.toggle('open', list.length > 1 && SMS.buyOpen.has(SMS.open)); smsBuyLyr();   // #659 2건 이상이면 판 아무 곳이나 눌러 펼침·접힘
        const sig = html || 'none:' + days;
        if (box.dataset.sig === sig) return;   // 폴링마다 다시 그리지 않는다(더보기 누르던 초점 유지)
        box.dataset.sig = sig;
        box.innerHTML = html || `<b>구매이력 없음</b> <small>이 번호로 찾은 최근 ${days}일 주문이 없어요</small>`;
    }
    const smsSig = v => JSON.stringify(v, (k, x) => (k === 'staff_read_at' ? undefined : x));   // #655: 읽은 시각만 바뀐 응답은 같은 것으로 본다(쓰는 중 다시 그리지 않게)
    const smsAway = () => document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus()) || Date.now() - SMS.actAt > 120000;
    async function smsThread(quiet) {
        const id = SMS.open; if (!id) return;
        const seq = ++SMS.tseq; SMS.tbusy = true; SMS.thAt = Date.now();
        let d, err = '';
        // #635: 뒤에서 다시 받을 때(quiet) 자리를 비운 것 같으면 읽음으로 바꾸지 않는다(peek) — 화면이 가려짐 · 창이 초점을 잃음 · 2분 넘게 조작(키·누름·터치·휠) 없음.
        //   사무실 PC 에 대화를 펼쳐 둔 채 자리를 비워도 그 사이 온 글은 안 읽음으로 남는다 · 돌아와 조작하면 다음 폴링에서 읽음. 직접 펼칠 때·답 보낸 직후는 늘 읽음.
        const peek = !!quiet && smsAway();
        try { d = await api('/api/sms/threads/' + id + (peek ? '?peek=1' : '')); } catch (e) { err = (e && e.message) || '불러오지 못했어요'; }
        if (seq !== SMS.tseq || SMS.open !== id) return;
        SMS.tbusy = false;
        if (!err && !(d && d.thread && Array.isArray(d.messages))) err = (d && d.error) || '불러오지 못했어요';
        const box = document.getElementById('sms-msgs'); if (!box) return;
        if (err) { if (!quiet || !SMS.thread) { box.innerHTML = `<div class="desk-empty ship-empty">대화를 불러오지 못했어요: ${esc(err)}</div>`; $('sms-order').textContent = ''; } return; }
        const firstLoad = !SMS.thread;
        SMS.thread = d;
        if (!peek) SMS.readAt = Date.now();
        { const it = (SMS.items || []).find(i => i.id === id); if (it) Object.assign(it, d.thread); else SMS.openRow = d.thread; }   // 열려 있는 줄은 대화 응답으로 새로(답한 뒤 사유·초안 표시, 번호 표시가 낡지 않게 · peek 이면 서버가 준 안 읽음 수 그대로)
        if (firstLoad) { SMS.sumAt = 0; setTimeout(smsSummary, 1300); }   // 읽음이 됐으니 알약 숫자를 새로(api() 가 바로 겹친 같은 조회를 하나로 합치므로 조금 띄운다)
        const sig = smsSig(d);
        if (sig === SMS.tsig) return;
        const first = !SMS.tsig, bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
        SMS.tsig = sig;
        const t = d.thread, ow = d.order && typeof d.order === 'object' ? d.order : null, o = ow ? (ow.order && typeof ow.order === 'object' ? ow.order : ow) : null;
        $('sms-th-phone').innerHTML = smsNoHtml(t);
        $('sms-th-badge').innerHTML = smsHeadBadge(t);
        smsDoneSync(t);
        smsBuyRender();
        let day = '', holdShown = false;
        box.innerHTML = d.messages.length ? d.messages.map(m => {
            const out = m.direction === 'out', dk = smsDay(m.event_at);
            const sep = dk && dk !== day ? `<div class="sms-day"><span>${esc(smsDayLabel(m.event_at))}</span></div>` : ''; day = dk || day;
            const imgs = (Array.isArray(m.image_ids) ? m.image_ids : []).map(i => `<button type="button" class="sms-thumb" data-img="${esc(i)}" aria-label="사진 크게 보기"><img alt="${out ? '보낸' : '손님이 보낸'} 사진" data-img="${esc(i)}"></button>`).join('');
            const meta = [out ? (SMS_WHO[m.sender] || '우리') : '', smsWhen(m.event_at), out ? smsStateLabel(m) : ''].filter(Boolean).map(esc).join(' · ');
            const holdHere = out && m.state === 'queued' && m.sender === 'bot' && !holdShown; if (holdHere) holdShown = true;   // 여러 통으로 나뉜 봇 답이면 단추는 첫 통에만
            const hold = holdHere ? ' <button type="button" class="sms-hold" title="이 봇 답을 보내지 않고, 이 대화는 직원이 맡아요">보내지 않기</button>' : '';   // 유예 중인 봇 답을 사람이 막는다(서버 /handled = 대기 발송 취소 + 직원 답변으로 잠금)
            return sep + `<div class="sms-msg ${out ? 'out' : 'in'}" data-s="${esc(m.state || '')}" data-who="${esc(m.sender || '')}">${imgs ? `<div class="sms-pics">${imgs}</div>` : ''}${m.body ? `<div class="sms-bub">${esc(m.body)}</div>` : ''}<small>${meta}${hold}</small></div>`;
        }).join('') : '<div class="desk-empty ship-empty">주고받은 문자가 없어요.</div>';
        smsImgs();
        if (first || bottom) box.scrollTop = box.scrollHeight;
        const ta = $('sms-text');
        // 초안을 답 칸에 — 종전엔 「펼친 뒤 첫 응답 한 번」만 채워서, 열어 둔 뒤에 초안이 생기면 안내 띠만 뜨고 칸이 비었다(대표 폰 실물 10/11 · 끝 8755)
        //   이제: 초안이 새로 생기거나 바뀌었고 칸이 비어 있으면 폴링 때도 채운다 · 적던 글은 안 덮는다 · 채워 준 초안을 사람이 지웠으면 같은 초안은 다시 안 채운다
        //   열어 둔 사이 손님이 또 보내 초안이 새로 만들어지면: 칸의 글이 우리가 채워 준 옛 초안 그대로(사람이 안 고침)면 새 초안으로 바꾼다 · 고치던 중이면 그대로 두고 [새 초안으로 바꾸기] 안내
        { const dt = t.draft_text || '', fk = id + '|' + dt, cur = ta.value.trim();
            if (!dt) { SMS.filled = fk; SMS.newDraft = ''; }
            else if (SMS.filled !== fk) {
                if (!cur || (SMS.fillText && cur === SMS.fillText.trim())) {
                    const swapped = !!cur && cur !== dt.trim();   // 칸에 있던 옛 초안이 새 초안으로 바뀌는 경우(처음 채우는 것은 아님)
                    ta.value = dt; SMS.fillText = dt; SMS.filled = fk; SMS.newDraft = '';
                    if (swapped) {   // 바뀐 순간이 보이게: 칸 강조 1.6초 · 안내 띠 8초 · [이대로 보내기] 0.8초 잠금(누르는 순간 바뀌어 안 읽은 글이 나가는 것 방지)
                        SMS.chgAt = Date.now(); SMS.lockUntil = Date.now() + 800;
                        ta.classList.add('sms-text-new'); setTimeout(() => { if (ta.isConnected) ta.classList.remove('sms-text-new'); }, 1600);
                        setTimeout(smsSync, 820); setTimeout(smsSync, 8100);
                    }
                }
                else SMS.newDraft = dt;
            } }
        smsSync();
        if (!SMS.items || !SMS.items.some(x => x.id === id && x.status === t.status)) { SMS.sig = ''; smsRenderList(); }
        else smsRenderList();   // 읽음·안 읽음 수가 바뀌었으면 그 줄 배지도 바로(바뀐 것이 없으면 다시 그리지 않는다)
    }
    // 사진은 로그인 표를 붙여 받아야 해서 img 주소로 바로 못 쓴다 → 받아서 붙인다(한 번 받은 것은 카드를 닫을 때까지 재사용)
    function smsImg(id) {
        if (!SMS.imgs.has(id)) SMS.imgs.set(id, (async () => { const r = await fetch('/api/sms/images/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') } }); if (!r.ok) throw new Error('사진을 불러오지 못했어요'); return URL.createObjectURL(await r.blob()); })());
        return SMS.imgs.get(id);
    }
    function smsImgs() {
        document.querySelectorAll('#sms-msgs img[data-img]:not([src])').forEach(img => {
            const id = img.dataset.img;
            smsImg(id).then(u => { if (img.isConnected) img.src = u; }).catch(() => { SMS.imgs.delete(id); const b = img.closest('.sms-thumb'); if (b) { b.classList.add('fail'); b.disabled = true; b.textContent = '사진을 불러오지 못했어요'; } });
        });
    }
    function smsView(id, from) {
        const v = $('sms-view'), img = $('sms-view-img');
        img.removeAttribute('src'); v.hidden = false; v._from = from || null; hbPush('sms-view', smsPopView, { smsWin: 'th' });
        smsImg(id).then(u => { if (!v.hidden) img.src = u; }).catch(() => { smsViewClose(); showToast('사진을 불러오지 못했어요'); });
        $('sms-view-x').focus({ preventScroll: true });
    }
    function smsViewClose() { const v = $('sms-view'); if (!v || v.hidden) return false; v.hidden = true; hbDrop('sms-view'); const f = v._from; v._from = null; if (f && f.isConnected) f.focus({ preventScroll: true }); return true; }
    // 답 칸 — 봇 초안 그대로면 [이대로 보내기](send-draft) · 고쳤으면 [고쳐서 보내기](reply) · 초안이 없으면 [답 보내기]
    const smsIsDraft = () => { const t = SMS.thread && SMS.thread.thread, ta = document.getElementById('sms-text'); return !!(t && t.draft_text && ta && ta.value.trim() === String(t.draft_text).trim()); };
    function smsSync() {
        const ta = document.getElementById('sms-text'); if (!ta) return;
        const t = SMS.thread && SMS.thread.thread, v = ta.value, has = !!v.trim(), dr = !!(t && t.draft_text);
        const btn = $('sms-send');
        btn.disabled = !has || SMS.sending || !SMS.thread || Date.now() < (SMS.lockUntil || 0);
        btn.textContent = smsIsDraft() ? '이대로 보내기' : dr && has ? '고쳐서 보내기' : '답 보내기';
        { const band = $('sms-draft'), fresh = dr && SMS.newDraft && SMS.newDraft === t.draft_text && v.trim() !== String(t.draft_text).trim(), k = fresh ? 'new' : (dr && SMS.chgAt && Date.now() - SMS.chgAt < 8000 && v.trim() === String(t.draft_text).trim()) ? 'chg' : 'std';
            band.hidden = !dr;
            if (band.dataset.k !== k) { band.dataset.k = k; band.innerHTML = fresh ? '<span>손님 글이 더 와서 봇이 초안을 새로 만들었어요.</span><button type="button" class="desk-btn sm" id="sms-draft-new">새 초안으로 바꾸기</button>' : k === 'chg' ? '초안이 새로 바뀌었어요. 읽어 보고 보내 주세요.' : '봇이 만든 초안이에요. 그대로 보내거나 고쳐서 보낼 수 있어요.'; } }
        $('sms-len').textContent = has ? nfmt(v.length) + '자' : (window.matchMedia('(pointer: fine)').matches ? 'Ctrl+Enter 로 보내기' : '');
        const w = $('sms-warn'), dead = smsDead();
        w.hidden = !dead; w.textContent = dead ? '회사폰 연결이 끊겨 있어요. 지금 보낸 답은 연결이 돌아오면 나가요. 10분 넘으면 「보내지 못함」으로 바뀌어요.' : '';
    }
    async function smsAct() {
        const id = SMS.open; if (!id || SMS.sending || !SMS.thread) return;
        if (Date.now() < (SMS.lockUntil || 0)) return;   // 초안이 막 바뀐 0.8초 동안은 단추·Ctrl+Enter 어느 쪽으로도 안 나간다
        const ta = $('sms-text'), text = ta.value.trim();
        if (!text) return;
        const draft = smsIsDraft();
        SMS.sending = true; smsSync();
        const btn = $('sms-send'); btn.setAttribute('aria-busy', 'true');
        let okDone = false, changed = false;
        try {
            let res;
            if (draft) {   // api() 는 오류 응답의 본문(새 초안)을 넘겨주지 않아 직접 부른다
                const seen = String(SMS.thread.thread.draft_text || '');
                const r = await fetch('/api/sms/threads/' + id + '/send-draft', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') }, body: JSON.stringify({ seen }) });
                res = await r.json().catch(() => ({}));
                if (r.status === 409 && res && res.error === 'draft_changed') {
                    const nd = String(res.draft_text || '');
                    if (SMS.open === id && SMS.thread && SMS.thread.thread) { SMS.thread.thread.draft_text = nd || null; if (ta.isConnected) ta.value = nd; SMS.fillText = nd; SMS.filled = id + '|' + nd; SMS.newDraft = ''; SMS.tsig = ''; }
                    changed = true; throw new Error('초안이 바뀌었어요');
                }
                if (r.status === 401 && typeof akmSessionExpired === 'function') akmSessionExpired();
                if (!r.ok) throw new Error((res && res.error) || '다시 시도해 주세요');
            } else res = await api('/api/sms/threads/' + id + '/reply', 'POST', { text });
            if (res && res.ok === false) throw new Error(res.error || '다시 시도해 주세요');
            okDone = true; typStop(true);   // #683 보냄 = 서버가 내 입력 표시를 지운다
            if (SMS.open === id && ta.isConnected) ta.value = '';
            SMS.texts.delete(id); showToast('답을 보냈어요. 회사폰에서 나가면 「보냄」으로 바뀌어요');
        } catch (e) {
            showToast(changed ? '초안이 바뀌었어요. 확인하고 다시 눌러 주세요' : '답을 보내지 못했어요: ' + ((e && e.message) || '다시 시도해 주세요'), '', 5000);
        } finally { SMS.sending = false; if (btn.isConnected) btn.removeAttribute('aria-busy'); smsSync(); }
        if (changed && SMS.open === id) { smsThread(true); return; }
        if (!okDone || SMS.open !== id) return;
        SMS.tsig = ''; await smsThread(true);
        smsSummary(); smsList(true);
    }
    // #675(대표 10/12 「전화로 처리한 사진 손님이 미처리 1로 남음」) 대화 머리 [처리함] — 톡톡의 [확인]과 같은 자리·꼴. 사람 몫(needs_staff) 대화에만 보이고, 누르면 미처리에서 빠진다(봇은 이 대화에 더 답하지 않음 · 손님이 새 글을 보내면 다시 판정)
    //   눌린 뒤 = 「처리함 · 되돌리기」(done) — 다시 누르면 원래 사유로 되돌림(그 사이 손님 새 글이 왔으면 서버가 409). 서버: POST /api/sms/threads/:id/done { undo? } · 요약에 done_route 가 없는 옛 서버면 단추 숨김
    function smsDoneSync(t) {
        const b = $('sms-done'); if (!b) return;
        const on = !!(SMS.sum && SMS.sum.done_route), done = !!(t && t.done), need = !!(t && t.needs_staff);
        b.hidden = !on || !(done || need); b.setAttribute('aria-pressed', String(done)); b.disabled = !!SMS.doneBusy;
        b.textContent = done ? '처리함 · 되돌리기' : '처리함';
        b.title = done ? ((t.done_by ? t.done_by + ' 님이 처리함 · ' : '') + '다시 누르면 미처리로 되돌려요') : '전화 등으로 이미 처리했으면 눌러 주세요. 미처리에서 빠져요';
    }
    async function smsDone() {
        const id = SMS.open, t = SMS.thread && SMS.thread.thread; if (!id || !t || SMS.doneBusy) return;
        const undo = !!t.done;
        SMS.doneBusy = true; smsDoneSync(t);
        try {
            const r = await api('/api/sms/threads/' + id + '/done', 'POST', undo ? { undo: true } : {});
            if (r && r.ok === false) throw new Error(r.error || '다시 시도해 주세요');
            showToast(r && r.noop ? '이미 미처리가 아닌 대화예요' : undo ? '미처리로 되돌렸어요' : '처리함으로 넘겼어요' + (r && r.cancelled > 0 ? ' · 보내려던 봇 답은 취소했어요' : ''));
        } catch (e) { showToast((undo ? '되돌리지 못했어요: ' : '처리함으로 넘기지 못했어요: ') + ((e && e.message) || '다시 시도해 주세요'), '', 5000); }
        SMS.doneBusy = false;
        if (SMS.open !== id) return;
        SMS.tsig = ''; await smsThread(true);
        if (SMS.thread && SMS.thread.thread) smsDoneSync(SMS.thread.thread);
        smsSummary(); smsList(true); S.inboxAt = 0; loadInbox();   // 미처리 숫자([미처리 n]·탭·[+]·손님 n)와 메인 카드 문자 줄을 바로 다시 받는다
    }
    // #651 유예 중(곧 발송)인 봇 답을 보내지 않기 — 서버 /handled(대기 발송 취소 + 직원 답변으로 표시 = 봇이 이 대화에 더 답하지 않음)
    async function smsHold() {
        const id = SMS.open; if (!id || SMS.sending || !SMS.thread) return;
        let held = false;
        SMS.sending = true; smsSync();
        try {
            const res = await api('/api/sms/threads/' + id + '/handled', 'POST', {});
            if (res && res.ok === false) throw new Error(res.error || '다시 시도해 주세요');
            if (res && typeof res.cancelled === 'number' && res.cancelled === 0) showToast('이미 나가는 중이라 막지 못했어요. 대화를 확인해 주세요', '', 5000);
            else { held = true; showToast('봇 답을 보내지 않았어요. 봇은 이 대화에 더 답하지 않으니 지금 바로 답해 주세요', '', 5000); }
        } catch (e) { showToast('취소하지 못했어요: ' + ((e && e.message) || '다시 시도해 주세요'), '', 5000); }
        finally { SMS.sending = false; smsSync(); }
        if (SMS.open !== id) return;
        SMS.tsig = ''; await smsThread(true);
        if (held && SMS.open === id) { const ta = document.getElementById('sms-text'); if (ta) ta.focus({ preventScroll: true }); }
        smsSummary(); smsList(true);
    }
    // 폰 자판이 올라오면 시트를 자판 위로(보이는 화면 높이에 맞춘다)
    function smsVvNow() {
        SMS.vvRaf = 0;
        const card = $('desk-sms'); if (!card) return;
        const vv = window.visualViewport;
        const want = (!vv || !(SMS.open || SMS.neu.on)) ? '' : [Math.round(vv.height), Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)), Math.max(0, Math.round(vv.offsetTop))].join(',');
        if (want === (SMS.vvSig || '')) return;   // 같은 값이면 손대지 않는다(자판이 떠 있는 동안 스크롤 사건마다 다시 배치하면 화면이 떨린다)
        SMS.vvSig = want;
        if (!want) { card.style.removeProperty('--sms-vh'); card.style.removeProperty('--sms-kb'); card.style.removeProperty('--sms-vt'); return; }
        const [h, kb, top] = want.split(',');
        card.style.setProperty('--sms-vh', h + 'px'); card.style.setProperty('--sms-kb', kb + 'px'); card.style.setProperty('--sms-vt', top + 'px');
    }
    function smsVv() { if (SMS.vvRaf) return; SMS.vvRaf = requestAnimationFrame(smsVvNow); }   // #655: 한 프레임에 한 번
    function smsTick(now) {
        inbHook(); typTick();
        if (now) { SMS.sumAt = 0; SMS.listAt = 0; SMS.thAt = 0; }
        const t = Date.now();
        if (t - SMS.sumAt > (SMS.sum ? 30000 : 300000)) smsSummary();   // 문자 라우트가 없는 서버면 5분에 한 번만 다시 본다
        if (!SMS.sum || !smsVisible()) return;
        if (!SMS.lbusy && t - SMS.listAt > 10000) smsList(true);
        if (SMS.open && !SMS.tbusy && !SMS.sending && t - SMS.thAt > 5000) smsThread(true);
    }
    // 알림에서 그 문자 대화로(F1) — app.js 가 메뉴를 바꾼 뒤 window.AkmAoDesk.openSms(대화 id) 를 부른다(link = agent-office?sms=ID)
    //   카드를 전체 목록으로 열고 그 대화를 펼친다 · 목록 50건 밖이면 그 대화만 따로 받아 맨 위에 둔다 · 없는 번호면 카드만 열고 false
    let smsOpenSeq = 0;
    async function smsOpenById(threadId) {
        const id = Number(threadId); if (!Number.isInteger(id) || id <= 0) return false;
        const seq = ++smsOpenSeq, stale = () => seq !== smsOpenSeq || !S.mounted || !pageActive();
        try {
            for (let i = 0; i < 50 && !(S.mounted && pageActive()); i++) await new Promise(r => setTimeout(r, 100));   // 메뉴 전환·첫 그리기(최대 5초)
            if (stale()) return false;
            if (!SMS.sum) await smsSummary();
            if (stale() || !SMS.sum) return false;
            if (S.full) { await new Promise(r => smsAfterFull(r)); if (stale()) return false; }
            if (SMS.open && SMS.open !== id) smsThreadClose(false, true);
            smsWinShow();
            if (INB.ch !== 'sms') inbShow('sms');
            SMS.q = ''; $('sms-q').value = ''; SMS.sig = '';
            smsHead(); await smsList();
            if (stale()) return false;
            // #635: 이미 읽은(닫힌) 대화면 「이전 대화 보기」로 넘겨서 찾는다(#629 [끝난 대화도] 자동 켜기 대체)
            if (!(SMS.items || []).some(x => x.id === id) && SMS.scope !== 'all') { SMS.scope = 'all'; SMS.items = null; SMS.sig = ''; smsHead(); await smsList(); if (stale()) return false; }
            if (!(SMS.items || []).some(x => x.id === id)) {
                let d = null; try { d = await api('/api/sms/threads/' + id + '?peek=1'); } catch (e) { d = null; }   // 줄만 채우는 조회 — 읽음으로 바꾸지 않는다(곧 펼치면서 읽음)
                if (stale() || !(d && d.thread)) return false;
                SMS.items = [d.thread].concat(SMS.items || []); SMS.sig = ''; smsRenderList();
            }
            if (!document.body.classList.contains('sms-win-open')) return false;   // 그 사이 창이 닫혔으면 대화를 펴지 않는다(안 보이는데 읽음으로 찍히지 않게)
            if (SMS.open !== id) smsThreadOpen(id);
            const row = document.querySelector('#sms-list .sms-item[data-id="' + id + '"]');
            if (row) { row.scrollIntoView({ block: 'nearest' }); flashEl(row.querySelector('.sms-row'), 1600); }
            return SMS.open === id;
        } catch (e) { return false; }
    }
    function smsTodoHtml() {
        // #661(대표 10/12 「2곳에 보일 필요 없음」): 챙길 일에는 「손님 연락 n건」 줄을 두지 않는다 — 숫자·들어가는 길은 아래 「손님 연락」 카드(문자|톡톡|상품 Q&A|주문 문의 칩)에만. 회사폰 연결 끊김 줄은 그대로
        // #668-b(대표 10/12): 손님 연락 창이 없는 서버에서도 「안 읽은 문자 n건」 줄은 두지 않는다(「손님 0」인데 건수가 뜨면 어긋남 · 숫자는 [+]·손님 연락 카드에)
        return smsTodoHtml0(true);
    }
    function smsTodoHtml0(noUnread) {
        const d = SMS.sum; if (!d || d.enabled === false) return '';
        const nd = smsNeed(), sub = [nd.staff > 0 ? `직원 확인 ${nfmt(nd.staff)}` : '', nd.draft > 0 ? `초안 ${nfmt(nd.draft)}` : ''].filter(Boolean).join(' · ');
        return (smsDead() ? `<li class="sms-todo dead" data-sms="keep" role="button" tabindex="0"><span>회사폰 전달 앱 연결 끊김</span><b>확인</b><small>${d.gateway.last_ping_at ? '마지막 연결 ' + esc(smsWhen(d.gateway.last_ping_at)) + ' · ' : ''}회사폰이 켜져 있는지 봐 주세요</small></li>` : '')
            + (!noUnread && nd.unread > 0 ? `<li class="sms-todo" data-sms="active" role="button" tabindex="0"><span>${nd.old ? '문자 답할 것' : '안 읽은 문자'}</span><b>${nfmt(nd.unread)}건</b><small>${sub ? sub + ' · ' : ''}에이전트 오피스 &gt; 문자 (눌러서 열기)</small></li>` : '');
    }
    function smsBind() {
        $('desk-sms-now').addEventListener('click', () => custWait(() => SMS.sumDone, () => smsOpen()));   // #653-나: 고르면 항상 연다(닫기는 창의 [닫기]·Esc·뒤로가기)
        $('sms-close').addEventListener('click', smsCloseCard);
        INB_CH.forEach(([k]) => { const b = $('desk-inb-' + k); if (b) b.addEventListener('click', () => custWait(() => INB.known || inbOk(), () => inbOpen(k))); });
        $('sms-tabs').addEventListener('click', e => { const b = e.target.closest('.sms-tab'); if (b && b.dataset.ch !== INB.ch) inbShow(b.dataset.ch); });
        $('sms-tabs').addEventListener('keydown', e => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const bs = Array.from(document.querySelectorAll('#sms-tabs .sms-tab')), i = bs.indexOf(document.activeElement); if (i < 0) return;
            e.preventDefault(); const nx = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length]; inbShow(nx.dataset.ch); const f = document.querySelector('#sms-tabs .sms-tab[data-ch="' + INB.ch + '"]'); if (f) f.focus({ preventScroll: true });
        });
        ['keydown', 'pointerdown', 'touchstart', 'wheel'].forEach(ev => document.addEventListener(ev, () => { SMS.actAt = Date.now(); }, { capture: true, passive: true }));
        // (scroll 은 세지 않는다 — 새 글이 붙으며 대화 창이 스스로 내려가는 것도 scroll 이라, 자리를 비웠는데 조작으로 잡힌다. 사람이 굴리면 wheel·touch 가 먼저 온다)
        $('sms-scope').addEventListener('click', () => smsScope(SMS.scope === 'open' && !SMS.only ? 'all' : 'open'));
        $('sms-staff').addEventListener('click', () => smsStaffOnly(!SMS.only));
        // 찾기 = 0.4초 멈추면 · Enter 면 바로(서버가 이전 대화까지 전체에서 찾는다)
        const qGo = v => { clearTimeout(SMS.qt); v = String(v || '').trim(); if (v === SMS.q) return; SMS.q = v; SMS.only = false; SMS.items = null; SMS.sig = ''; smsList(); };
        $('sms-q').addEventListener('input', e => { clearTimeout(SMS.qt); SMS.qt = setTimeout(() => qGo(e.target.value), 400); });
        $('sms-q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); qGo(e.target.value); } });
        const list = $('desk-sms');   // 대화(오른쪽 칸)·목록 둘 다 이 안에 있다
        list.addEventListener('click', e => { if (e.target.closest('#inb-host')) return;   // #658 톡톡·문의 탭 안의 누름은 ao-inbox.js 가 받는다(같은 class 라 문자 쪽 처리가 가로채지 않게)
            if (e.target.closest('#sms-new')) { smsNewOpen(); return; }   // #688
            if (e.target.closest('#sms-new-back, #sms-new-x')) { smsNewClose(true); return; }
            { const g = e.target.closest('#sms-new-goto'); if (g) { smsThreadOpen(Number(g.dataset.id)); return; } }
            if (e.target.closest('#sms-th-back')) { smsThreadClose(true); return; }
            const th = e.target.closest('.sms-thumb'); if (th) { if (!th.disabled) smsView(th.dataset.img, th); return; }
            if (e.target.closest('#sms-th-x')) { smsThreadClose(true); return; }
            if (e.target.closest('#sms-done')) { smsDone(); return; }
            if (e.target.closest('.sms-empty-go')) { smsScope('all'); return; }
            if (e.target.closest('.sms-more')) { smsMore(); return; }   // #730
            { const tk = e.target.closest('.sms-trk'); if (tk) { copyText(tk.dataset.trk, '송장번호를 복사했어요', tk); return; } }   // #644
            if (e.target.closest('.sms-hold')) { smsHold(); return; }   // #651
            if (e.target.closest('#sms-buy-next')) { const had = document.querySelectorAll('#sms-buy-rest .sms-buy-i').length; SMS.buyShow = (Number(SMS.buyShow) || 5) + 5; smsBuyRender(); const nx = document.getElementById('sms-buy-next') || document.getElementById('sms-buy-more'); if (nx) nx.focus({ preventScroll: true }); const it = document.querySelectorAll('#sms-buy-rest .sms-buy-i')[had]; if (it && it.scrollIntoView) it.scrollIntoView({ block: 'nearest' }); return; }
            {   // #659(대표 10/12): 구매이력 판 아무 곳이나(또는 「+n건 더보기」) 누르면 펼침·접힘 — 송장 복사·[조회]·[5건 더보기] 같은 안쪽 단추와 글자를 끌어 고르는 중에는 그대로. 펼침은 대화별로 이 창을 여는 동안 기억
                const bo = e.target.closest('#sms-order.has-more'), mb = e.target.closest('#sms-buy-more');
                if (bo && SMS.open && (mb || (!e.target.closest('a, button, input, textarea, label') && !String(window.getSelection ? window.getSelection() : '').trim()))) {
                    if (SMS.buyOpen.has(SMS.open)) SMS.buyOpen.delete(SMS.open); else SMS.buyOpen.add(SMS.open);
                    SMS.buyShow = 5; smsBuyRender(); bo.scrollTop = 0;
                    const b = document.getElementById('sms-buy-more'); if (b && mb) b.focus({ preventScroll: true }); return;
                }
            }   // #653 구매이력 더보기·접기
            if (e.target.closest('#sms-draft-new')) { const ta = $('sms-text'), t = SMS.thread && SMS.thread.thread; if (ta && t && t.draft_text) { ta.value = t.draft_text; SMS.fillText = t.draft_text; SMS.filled = SMS.open + '|' + t.draft_text; SMS.newDraft = ''; smsSync(); ta.focus({ preventScroll: true }); } return; }
            const row = e.target.closest('.sms-row'); if (row) smsThreadOpen(Number(row.closest('.sms-item').dataset.id));
        });
        list.addEventListener('submit', e => { if (e.target.id === 'sms-reply') { e.preventDefault(); smsAct('send'); } else if (e.target.id === 'sms-new-form') { e.preventDefault(); smsNewSend(); } });
        list.addEventListener('input', e => { if (e.target.id === 'sms-text') { smsSync(); typInput(); } else if (e.target.id === 'sms-new-phone' || e.target.id === 'sms-new-text') { SMS.neu.err = ''; smsNewSync(); } });
        list.addEventListener('focusout', e => { if (e.target.id === 'sms-new-phone') { const d = smsNewNo(e.target.value); if (d) { SMS.neu.touched = true; if (smsNewOk(d)) e.target.value = smsFmtNo(d); } smsNewSync(); } });
        list.addEventListener('keydown', e => { if ((e.target.id === 'sms-text' || e.target.id === 'sms-new-text') && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); if (e.target.id === 'sms-text') smsAct('send'); else smsNewSend(); } });
        $('desk-sms').addEventListener('mousedown', e => { if (e.target === $('desk-sms')) smsCloseCard(); });   // 창 바깥(어두운 곳) 누름 = 닫기
        $('sms-view').addEventListener('click', e => { if (e.target.id !== 'sms-view-img') smsViewClose(); });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || !smsVisible() || !pageActive()) return;
            if (Array.from(document.querySelectorAll('.modal-overlay')).some(m => getComputedStyle(m).display !== 'none')) return;   // 안내·확인 창이 위에 떠 있으면 그 창이 먼저 닫힌다
            if (INB.ch !== 'sms') {   // #658 톡톡·문의 탭: 사진 → 대화 → 창 순서는 AkmInbox.back() 이 안다(접을 것이 없으면 false)
                const a = inbApi(); let did = false;
                try { const was = !!(a && a.isOpen()); did = !!(a && a.back()); if (did && was && !a.isOpen() && smsHistAt() === 'th') smsHistBack(1); } catch (er) { did = false; }
                e.stopPropagation(); if (!did) smsCloseCard(); return;
            }
            if (smsViewClose()) { e.stopPropagation(); return; }
            if (SMS.neu.on) { e.stopPropagation(); smsNewClose(true); return; }   // #688 새 문자 판 → 창
            if (SMS.open) { e.stopPropagation(); smsThreadClose(true); return; }
            if (document.body.classList.contains('sms-win-open')) { e.stopPropagation(); smsCloseCard(); }   // Esc 도 같은 순서: 사진 → 대화 → 창
        });
        if (window.visualViewport) { window.visualViewport.addEventListener('resize', smsVv); window.visualViewport.addEventListener('scroll', smsVv); }
    }

    // ── #612 전체 가격 확인하기(대표 10/10) — 같은 옵션이 걸린 페이지(네이버·자사몰)의 결제가를 나란히 놓고 어긋난 줄을 짚는다 ──
    //   자료 = GET /api/price-check[?refresh=1] (price-check.js build 보고 · 10분 캐시): { generated_at, source{ naver_snapshot_at, mall }, pages[{ key 'naver:번호'|'mall:번호', channel, name, tier, sold, ignore, note }],
    //          groups[{ key, label, sold_rows, rows[{ page_key, channel, option_text, price, tier, changed_at, prev_price, unchanged_since, changed_unknown, sold, ignore }], issues[{ kind, detail, … }], offseason_mismatch? }], summary, notes[] }
    //   묶음 하나 = 「같은 옵션」 · 줄 = 그 옵션이 걸린 페이지 → 값이 세로로 나란히 놓인다(폰에서도 옆으로 밀 일이 없다)
    //   설정 = GET /api/price-check/pages { config } · POST(관리자)는 **통째로 갈아 끼움** → 있던 설정 + 바꾼 것을 함께 보낸다 · 키는 naver:번호 · cafe24:번호(보고의 mall: 을 바꿔 보냄)
    //   카드는 처음 열 때 만든다(닫힌 화면의 칸 순서를 안 바꾼다) · 읽기 전용 · 쓰기는 「페이지 등급 설정」 저장뿐
    const PRICE = { data: null, busy: false, kind: null, q: '', view: null, only: false, fold: new Set(), seq: 0, qt: 0, cfg: null, setBusy: false };   // #622: view = selling|all · only = 이상 있는 것만 · fold = 접은 품목('i:이름')·규격('g:키') — 이 화면 동안 기억
    const PC_BAD = [['tier_mismatch', '페이지끼리 값 다름'], ['mall_vs_naver', '자사몰≠네이버'], ['vip_not_lower', 'VIP가 더 비쌈'], ['stale', '한쪽만 안 바뀜']];
    const PC_REF = [['missing', '자사몰에 없음'], ['vip_same', 'VIP와 일반 값 같음']];   // 참고(어긋남으로 세지 않는다)
    const PC_KIND_LABEL = Object.fromEntries(PC_BAD.concat(PC_REF));
    const pcIsRef = k => PC_REF.some(x => x[0] === k);
    const PC_TIERS = [['normal', '일반', 'mute'], ['vip', 'VIP', 'work'], ['gift', '선물', 'done'], ['bulk', '대용량', 'wait']];
    const PC_TIER = Object.fromEntries(PC_TIERS.map(t => [t[0], t]));
    const PC_CH = { naver: '네이버', mall: '자사몰', cafe24: '자사몰' };
    const PC_VIEWS = [['selling', '판매중'], ['all', '전체상품']];   // #622(대표 10/10): 판매 중인 상품만 / 안 파는 것까지 전부
    const pcLive = r => !(r.sold === false || r.ignore);   // 지금 파는 줄
    const PC_HTML = `
            <section class="desk-tool pc-card" id="desk-price" aria-label="전체 가격 확인" hidden>
                <div class="desk-tool-head"><b>전체 가격 확인</b><span id="pc-sub">네이버·자사몰 옵션 결제가</span><button type="button" class="desk-btn sm pc-re" id="pc-refresh">다시 확인</button><button type="button" class="desk-btn sm desk-tool-x" id="pc-close">닫기</button></div>
                <div class="ship-prog" id="pc-prog" role="status" hidden><div class="ship-prog-line"><span>가격을 모으는 중(1분쯤 걸릴 수 있어요)</span></div><div class="ship-track busy"><i></i></div></div>
                <div class="ship-note" id="pc-note" role="status" hidden></div>
                <div class="pc-when" id="pc-when" hidden></div>
                <p class="pc-sum" id="pc-sum" role="status" hidden></p>
                <div class="pc-bar">
                    <div class="pc-views" id="pc-views" role="group" aria-label="보기">${PC_VIEWS.map(v => `<button type="button" class="desk-btn sm" data-view="${v[0]}" aria-pressed="false">${v[1]}</button>`).join('')}</div>
                    <button type="button" class="desk-btn sm pc-only" id="pc-only" aria-pressed="false">이상 있는 것만</button>
                    <label class="desk-sr" for="pc-q">품목·옵션·페이지 찾기</label><input type="search" class="ship-q desk-find pc-q" id="pc-q" maxlength="40" autocomplete="off" placeholder="품목 · 옵션 · 페이지로 찾기">
                    <span class="pc-count" id="pc-count" role="status"></span>
                    <button type="button" class="desk-btn sm pc-copy" id="pc-copy">요약 복사</button>
                </div>
                <div class="pc-out" id="pc-out"></div>
                <details class="pc-fold" id="pc-off" hidden><summary id="pc-off-sum">지금 안 파는 옵션끼리 값이 다름</summary><div class="pc-fold-body" id="pc-off-out"></div></details>
                <details class="pc-fold pc-set" id="pc-set" hidden>
                    <summary>페이지 등급 설정</summary>
                    <p class="pc-set-help">같은 등급끼리 값을 견줘요. VIP 페이지는 VIP끼리만 견주고, 「제외」를 켠 페이지는 셈에서 빠집니다.</p>
                    <div class="pc-set-list" id="pc-set-list"></div>
                    <div class="pc-set-foot"><span class="pc-set-msg" id="pc-set-msg" role="status"></span><button type="button" class="desk-btn primary" id="pc-set-save">저장</button></div>
                </details>
                <p class="pc-hint">쿠팡은 가격 조회 API가 없어 빠져 있어요.</p>
            </section>`;
    const pcVisible = () => { const c = $('desk-price'); return !!c && !c.hidden; };
    const pcView = () => PRICE.view || 'selling';   // #622: 기본 = 판매중
    const pcKst = t => { const d = t ? new Date(t) : null; return (!d || isNaN(d)) ? null : new Date(d.getTime() + 9 * 3600e3); };
    const pcMd = t => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t || '')); if (m) return Number(m[2]) + '/' + Number(m[3]); const k = pcKst(t); return k ? (k.getUTCMonth() + 1) + '/' + k.getUTCDate() : ''; };
    const pcWhen = t => { const k = pcKst(t); return k ? (k.getUTCMonth() + 1) + '/' + k.getUTCDate() + ' ' + String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0') : ''; };
    const pcWon = n => (n == null || n === '' || isNaN(Number(n))) ? '' : nfmt(n);
    function pcNote(text, kind) { const n = $('pc-note'); if (!n) return; n.hidden = !text; n.textContent = text || ''; n.dataset.k = kind || ''; }
    const pcPage = key => { const d = PRICE.data; const p = d && Array.isArray(d.pages) ? d.pages.find(x => x && x.key === key) : null; return p || { key, name: key, tier: null, channel: String(key).split(':')[0] }; };
    // 어긋남 하나가 가리키는 페이지 → { 빨강(bad) · 노랑(stale) · 참고(ref) }
    function pcIssuePages(is) {
        const arr = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
        if (is.kind === 'tier_mismatch') return { bad: arr(is.odd_pages) };
        if (is.kind === 'mall_vs_naver') return { bad: arr(is.mall).concat(arr(is.naver)) };
        if (is.kind === 'vip_not_lower') return { bad: arr(is.vip) };
        if (is.kind === 'stale') return { stale: arr(is.page) };
        if (is.kind === 'vip_same') return { ref: arr(is.vip) };
        if (is.kind === 'missing') return { ref: arr(is.naver) };
        return { bad: arr(is.page_keys).concat(arr(is.page_key)) };   // 모르는 종류 — 페이지 칸이 있으면 그 줄만
    }
    function pcShape(g) {
        const order = PRICE.data && Array.isArray(PRICE.data.pages) ? PRICE.data.pages.map(p => p.key) : [];
        const idx = k => { const i = order.indexOf(k); return i < 0 ? 999 : i; };
        const rank = r => (r.tier === 'vip' ? 10 : 0) + (r.channel === 'naver' ? 0 : 1);
        const rows = (Array.isArray(g.rows) ? g.rows.filter(r => r && r.page_key != null) : []).slice().sort((a, b) => rank(a) - rank(b) || idx(a.page_key) - idx(b.page_key));
        const issues = Array.isArray(g.issues) ? g.issues.filter(Boolean) : [];
        const flag = new Map(); const put = (k, f, is) => { if (!flag.has(k)) flag.set(k, { bad: [], stale: [], ref: [] }); flag.get(k)[f].push(is); };
        issues.forEach(is => { const p = pcIssuePages(is); ['bad', 'stale', 'ref'].forEach(f => (p[f] || []).forEach(k => put(k, f, is))); });
        return { rows, issues, flag, bad: issues.filter(is => !pcIsRef(is.kind)), ref: issues.filter(is => pcIsRef(is.kind)) };
    }
    function pcGroups() {   // 지금 거르기에 맞는 묶음만
        const d = PRICE.data, q = PRICE.q.toLowerCase(), view = pcView(), kind = PRICE.kind, out = [];
        (d && Array.isArray(d.groups) ? d.groups : []).forEach(g => {
            if (!g) return;
            const sh = pcShape(g), live = sh.rows.filter(pcLive);
            if (view === 'selling' && !live.length) return;   // 파는 줄이 하나도 없는 규격은 [전체상품]에서만
            if (PRICE.only && !sh.bad.length) return;
            if (q && !(String(g.label || '').toLowerCase().includes(q) || sh.rows.some(r => String(r.option_text || '').toLowerCase().includes(q) || String(pcPage(r.page_key).name || '').toLowerCase().includes(q)))) return;
            out.push({ g, sh, rows: view === 'selling' ? live : sh.rows });
        });
        return out;
    }
    // #614(대표 10/10 「품목이 메인이고 그 밑에 페이지가 맞춰진 꼴」): 묶음 이름 → 품목(황금향) + 규격(선물용 3kg) + 덧글((중대과 7~15과)). 같은 품목끼리 한 번 더 묶는다
    const PC_ITEM_RE = /(하우스\s?감귤|타이벡\s?감귤|노지\s?감귤|비가림\s?감귤|미니\s?밤호박|그린\s?레몬|레드\s?키위|골드\s?키위|그린\s?키위|초당\s?옥수수|천혜향|레드향|한라봉|황금향|카라향|수라향|유라조생|감귤|하귤|홍귤|청귤|풋귤|레몬|키위|자몽|오렌지|밤호박|옥수수|양배추|브로콜리|취나물)/;
    function pcLabel(label) {
        let s = String(label || ''); const c = s.lastIndexOf(':');
        if (c >= 0) s = s.slice(c + 1); else if (s.includes(' / ')) s = s.slice(s.lastIndexOf(' / ') + 3);   // 「묶음 이름 / 상품 및 과수: 옵션」 꼴이면 옵션 쪽만
        s = s.trim(); const m = PC_ITEM_RE.exec(s);
        let item, rest;
        if (m) { item = m[1].replace(/\s/g, ''); rest = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); }
        else { item = s.split(/[\s\-(]/)[0] || s; rest = s.slice(item.length); }
        rest = rest.replace(/^\s*제주\s+/, ' ').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim();
        const p = rest.indexOf('(');
        return p > 0 ? { item, spec: rest.slice(0, p).trim(), extra: rest.slice(p).trim() } : { item, spec: rest, extra: '' };
    }
    const pcChanged = r => r.changed_at ? '바뀜 ' + pcMd(r.changed_at) + (r.prev_price != null ? ' · 앞 값 ' + pcWon(r.prev_price) : '') : r.changed_unknown ? '바뀐 날 모름' : r.unchanged_since ? pcMd(r.unchanged_since) + ' 이전부터 그대로' : '';
    const pcFoldAttr = key => ` role="button" tabindex="0" data-fold="${esc(key)}" aria-expanded="${!PRICE.fold.has(key)}"`;   // #622: 품목 대제목·규격 띠 = 눌러 접는 머리(같은 꼴 · 같은 화살표)
    const PC_CHEV = '<i class="pc-chev" aria-hidden="true"></i>';
    function pcGroupHtml(g, sh, kind, rows) {
        let prevVip = null; const fk = 'g:' + g.key;
        const body = (rows || sh.rows).map(r => {
            const p = pcPage(r.page_key), t = PC_TIER[r.tier || p.tier] || [r.tier, r.tier || '등급 없음', 'mute'], f = sh.flag.get(String(r.page_key)) || { bad: [], stale: [], ref: [] };
            const off = r.sold === false || r.ignore, cls = ['pc-r'];
            const vip = (r.tier || p.tier) === 'vip'; if (prevVip !== null && prevVip !== vip) cls.push('pc-sep'); prevVip = vip;
            if (off) cls.push('pc-off'); else if (f.bad.length) cls.push('pc-bad'); else if (f.stale.length) cls.push('pc-stale');
            const why = f.bad.concat(f.stale).map(is => PC_KIND_LABEL[is.kind] || is.kind).join(' · ');
            const state = r.ignore ? '제외한 페이지' : r.sold === false ? '판매 안 함' : '';
            return `<tr class="${cls.join(' ')}" data-page="${esc(r.page_key)}">
                <th scope="row" class="pc-pg"><span class="pc-pname">${esc(p.name || r.page_key)}</span><span class="pc-pmeta"><i class="desk-badge" data-k="${t[2]}">${esc(t[1])}</i><i class="pc-ch">${esc(PC_CH[r.channel || p.channel] || r.channel || '')}</i></span><span class="pc-otxt" title="${esc(r.option_text || '')}">${esc(r.option_text || '')}</span></th>
                <td class="pc-price"><b>${esc(pcWon(r.price))}<i>원</i></b>${state ? '<small>' + state + '</small>' : why ? '<small>' + esc(why) + '</small>' : ''}${pcChanged(r) ? '<small class="pc-chg2">' + esc(pcChanged(r)) + '</small>' : ''}</td>
                <td class="pc-chg">${esc(pcChanged(r))}</td>
            </tr>`;
        }).join('');
        const lines = (kind ? sh.issues.filter(is => is.kind === kind) : sh.issues).map(is => `<li data-kind="${esc(is.kind)}"><i class="desk-badge" data-k="${pcIsRef(is.kind) ? 'mute' : is.kind === 'stale' ? 'wait' : 'err'}">${esc(PC_KIND_LABEL[is.kind] || is.kind)}</i><span>${esc(is.detail || '')}</span></li>`).join('');
        const L = pcLabel(g.label || g.key);
        return `<section class="pc-group${PRICE.fold.has(fk) ? ' pc-shut' : ''}" data-g="${esc(g.key)}" data-label="${esc(g.label || g.key)}">
                <h4 class="pc-h${sh.bad.length ? ' pc-h-bad' : ''}" title="${esc(g.label || g.key)}"${pcFoldAttr(fk)}>${sh.bad.length ? '<i class="pc-hdot" aria-hidden="true"></i>' : ''}<span class="pc-hi">${esc(L.item)}</span>${L.spec ? `<span class="pc-hs">${esc(L.spec)}</span>` : ''}${L.extra ? `<small class="pc-hx">${esc(L.extra)}</small>` : ''}${sh.bad.length ? `<i class="desk-badge" data-k="err">이상 있음 ${sh.bad.length}건</i>` : ''}${sh.ref.length ? `<i class="desk-badge" data-k="mute">참고 ${sh.ref.length}</i>` : ''}${PC_CHEV}</h4>
                <div class="pc-tw"><table class="pc-t"><thead class="desk-sr"><tr><th scope="col">페이지</th><th scope="col">결제가</th><th scope="col">바뀐 날</th></tr></thead><tbody>${body}</tbody></table></div>
                ${lines ? `<ul class="pc-issues">${lines}</ul>` : ''}
            </section>`;
    }
    function pcRender() {
        const d = PRICE.data, out = $('pc-out'); if (!out) return;
        const by = {}; let bad = 0, off = [];
        if (d) (d.groups || []).forEach(g => { if (!g) return; (g.issues || []).forEach(is => { by[is.kind] = (by[is.kind] || 0) + 1; if (!pcIsRef(is.kind)) bad++; }); if (g.offseason_mismatch) off.push(g); });
        $('pc-sub').textContent = d ? (bad ? '이상 있음 ' + nfmt(bad) + '건' : '이상 없음') : '네이버·자사몰 옵션 결제가';
        $('pc-sub').dataset.k = bad ? 'err' : '';
        const src = d && d.source ? d.source : {}, snap = pcWhen(src.naver_snapshot_at), wh = $('pc-when');
        wh.hidden = !d;
        if (d) {
            const notes = (Array.isArray(d.notes) ? d.notes : []).filter(n => /자사몰/.test(String(n)));
            const mallBad = src.mall === 'error' || src.mall === 'none';
            wh.innerHTML = `<b>네이버 ${snap ? esc(snap) + ' 값' : '새벽 값'}</b><span>${mallBad ? '' : '자사몰은 방금 값 · '}네이버는 새벽에 찍어 둔 값이에요. 낮에 고친 네이버 가격은 내일 새벽 뒤에 확인돼요.${pcWhen(d.generated_at) ? ' (확인 ' + esc(pcWhen(d.generated_at)) + ')' : ''}</span>${mallBad ? '<em>' + esc(notes.join(' · ') || '자사몰은 조회하지 못해 네이버 페이지끼리만 견줬어요') + '</em>' : ''}`;
        }
        // #622(대표 10/10 「문구 줄 빼고 이상 있고 없고를」): 종류별 숫자 칸 6개 대신 한 줄 요약 — 판매 중인 품목 수 · 그 가운데 이상 있는 품목 수 · 참고 건수(참고는 이상에 안 셈)
        const sum = $('pc-sum'); sum.hidden = !d;
        if (d) {
            const its = new Map(); let refN = 0;
            (d.groups || []).forEach(g => { if (!g) return; const sh = pcShape(g); if (!sh.rows.some(pcLive)) return; const nm = pcLabel(g.label || g.key).item; its.set(nm, (its.get(nm) || 0) + sh.bad.length); refN += sh.ref.length; });
            const badIt = [...its.values()].filter(n => n > 0).length;
            sum.dataset.k = badIt ? 'err' : 'ok';
            sum.innerHTML = `<span>판매 중 <b>${nfmt(its.size)}</b>품목</span><i class="desk-badge" data-k="${badIt ? 'err' : 'done'}">${badIt ? '이상 있음 ' + nfmt(badIt) + '품목' : '이상 없음'}</i><span>참고 <b>${nfmt(refN)}</b>건</span>`;
        }
        const view = pcView(); $('pc-views').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
        $('pc-only').setAttribute('aria-pressed', String(!!PRICE.only));
        $('pc-copy').disabled = !bad;
        const offBox = $('pc-off'); offBox.hidden = !off.length;
        if (off.length) { $('pc-off-sum').textContent = '지금 안 파는 옵션끼리 값이 다름 ' + nfmt(off.length) + '건(참고)'; $('pc-off-out').innerHTML = off.map(g => pcGroupHtml(g, pcShape(g), null)).join(''); }
        if (!d) { out.innerHTML = PRICE.busy ? '' : '<div class="desk-empty">아직 불러온 가격이 없어요. [다시 확인]을 눌러 주세요.</div>'; $('pc-count').textContent = ''; return; }
        const list = pcGroups();
        $('pc-count').textContent = '옵션 ' + nfmt(list.length) + '개' + (PRICE.only ? ' · 이상 있는 것만' : '');
        if (!list.length) {
            out.innerHTML = `<div class="desk-empty">${PRICE.q ? '찾는 품목·옵션·페이지가 없어요.' : PRICE.only ? '이상 있는 가격이 없어요. [이상 있는 것만]을 끄면 전부 볼 수 있어요.' : view === 'selling' ? '지금 파는 옵션이 없어요. [전체상품]에서 볼 수 있어요.' : '가격을 확인할 옵션이 없어요.'}</div>`;
            return;
        }
        const items = [], at = new Map();   // 같은 품목끼리(처음 나온 순서 — 서버가 어긋난 묶음을 앞에 둔다)
        list.forEach(x => { const name = pcLabel(x.g.label || x.g.key).item; let it = at.get(name); if (!it) { it = { name, list: [] }; at.set(name, it); items.push(it); } it.list.push(x); });
        out.innerHTML = items.map(it => { const bad = it.list.reduce((a, x) => a + x.sh.bad.length, 0); const fk = 'i:' + it.name; return `<section class="pc-item${bad ? ' pc-item-bad' : ''}${PRICE.fold.has(fk) ? ' pc-shut' : ''}" data-item="${esc(it.name)}"><h3 class="pc-item-h"${pcFoldAttr(fk)}><span>${esc(it.name)}</span><small>규격 ${nfmt(it.list.length)}개</small><i class="desk-badge pc-flag" data-k="${bad ? 'err' : 'done'}">${bad ? '이상 있음 ' + nfmt(bad) + '건' : '이상 없음'}</i>${PC_CHEV}</h3>${it.list.map(({ g, sh, rows }) => pcGroupHtml(g, sh, null, rows)).join('')}</section>`; }).join('');
    }
    function pcSummaryText() {
        const d = PRICE.data; if (!d) return '';
        const L = []; let n = 0;
        (d.groups || []).forEach(g => {
            if (!g) return; const sh = pcShape(g); if (!sh.bad.length) return;
            L.push('', '■ ' + (g.label || g.key));
            sh.rows.forEach(r => { const p = pcPage(r.page_key), f = sh.flag.get(String(r.page_key)); const t = PC_TIER[r.tier || p.tier]; L.push('  ' + (f && (f.bad.length || f.stale.length) ? '▶ ' : '   ') + pcWon(r.price) + '원 · ' + (PC_CH[r.channel || p.channel] || '') + ' ' + (p.name || r.page_key) + (t && t[0] !== 'normal' ? ' [' + t[1] + ']' : '') + (r.sold === false ? ' (판매 안 함)' : '') + (r.changed_at ? ' · ' + pcMd(r.changed_at) + ' 바뀜' : '')); });
            sh.bad.forEach(is => { n++; L.push('  → [' + (PC_KIND_LABEL[is.kind] || is.kind) + '] ' + String(is.detail || '')); });
        });
        const snap = pcWhen(d.source && d.source.naver_snapshot_at);
        return '[가격 확인' + (snap ? ' · 네이버 ' + snap + ' 값' : '') + '] 어긋난 것 ' + n + '건' + L.join('\n');
    }
    async function pcLoad(refresh) {
        if (PRICE.busy) return;
        PRICE.busy = true; const seq = ++PRICE.seq;
        $('pc-prog').hidden = false; $('pc-refresh').disabled = true; pcNote('');
        if (!PRICE.data) pcRender();
        try {
            const d = await api('/api/price-check' + (refresh ? '?refresh=1' : ''));
            if (seq !== PRICE.seq) return;
            if (!d || typeof d !== 'object' || d.ok === false || !Array.isArray(d.groups)) throw new Error(d && d.error ? d.error : '가격 자료가 비어 있어요');
            PRICE.data = d;
            if (refresh) showToast('가격을 다시 확인했어요');
        } catch (e) {
            if (seq !== PRICE.seq) return;
            pcNote((PRICE.data ? '새로 불러오지 못해 앞서 받은 가격을 보여 드려요. ' : '가격을 불러오지 못했어요. ') + '[다시 확인]을 눌러 주세요.' + (e && e.message ? ' (' + e.message + ')' : ''), 'err');
        } finally {
            if (seq === PRICE.seq) { PRICE.busy = false; if ($('pc-prog')) { $('pc-prog').hidden = true; $('pc-refresh').disabled = false; pcRender(); if ($('pc-set').open) pcSetLoad(); } }
        }
    }
    function pcMount() {
        if ($('desk-price')) return;
        $('desk-listbox').insertAdjacentHTML('beforebegin', PC_HTML);
        $('pc-close').addEventListener('click', () => pcClose());
        $('pc-refresh').addEventListener('click', () => pcLoad(true));
        $('pc-views').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (!b) return; PRICE.view = b.dataset.view; pcRender(); });
        $('pc-only').addEventListener('click', () => { PRICE.only = !PRICE.only; pcRender(); });
        // #622: 품목 대제목 · 규격 띠 · 그 아래 줄 어디를 눌러도 접힌다(대제목 = 그 품목 전체 · 띠와 줄 = 그 규격) — 다시 그리지 않고 그 자리에서만
        const pcFold = head => { const key = head.dataset.fold, shut = !PRICE.fold.has(key); if (shut) PRICE.fold.add(key); else PRICE.fold.delete(key);
            $('desk-price').querySelectorAll('[data-fold]').forEach(h => { if (h.dataset.fold !== key) return; h.setAttribute('aria-expanded', String(!shut)); h.parentElement.classList.toggle('pc-shut', shut); }); };
        $('desk-price').addEventListener('click', e => {
            const t = e.target; if (!t.closest || t.closest('a, button, input, select, summary, label')) return;
            const head = t.closest('[data-fold]'); if (head) return pcFold(head);
            const row = t.closest('.pc-group .pc-tw, .pc-group .pc-issues'); if (!row || String(window.getSelection && window.getSelection()).length) return;   // 글을 긁는 중이면 접지 않는다
            const h = row.closest('.pc-group').querySelector('[data-fold]'); if (h) pcFold(h);
        });
        $('desk-price').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-fold]')) { e.preventDefault(); pcFold(e.target); } });
        $('pc-copy').addEventListener('click', () => { const t = pcSummaryText(); if (t) copyText(t, '어긋난 가격 요약을 복사했어요', $('pc-out')); });
        $('pc-q').addEventListener('input', e => { clearTimeout(PRICE.qt); PRICE.qt = setTimeout(() => { PRICE.q = e.target.value.trim(); pcRender(); }, 180); });
        $('desk-price').addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { if (e.target.id === 'pc-q' && e.target.value) return; e.preventDefault(); pcClose(); } });
        $('pc-set').hidden = !isAdmin();
        $('pc-set').addEventListener('toggle', () => { if ($('pc-set').open) pcSetLoad(); });
        $('pc-set-save').addEventListener('click', () => pcSetSave());
    }
    function pcOpen() { pcMount(); toolShow('desk-price'); if (!PRICE.data) pcLoad(false); else pcRender(); }
    function pcClose() { toolShow(null); plusFocus('price'); }
    // 페이지 등급 설정(관리자) — 저장 키는 naver:번호 · cafe24:번호
    const pcCfgKey = k => String(k).replace(/^mall:/i, 'cafe24:');
    const pcSetMsg = (t, k) => { const m = $('pc-set-msg'); m.textContent = t || ''; m.dataset.k = k || ''; };
    async function pcSetLoad() {
        const box = $('pc-set-list'), pages = PRICE.data && Array.isArray(PRICE.data.pages) ? PRICE.data.pages : [];
        pcSetMsg('');
        if (!pages.length) { box.innerHTML = '<div class="desk-empty">가격을 먼저 불러와야 페이지 목록이 보여요.</div>'; PRICE.cfg = null; return; }
        box.innerHTML = '<div class="desk-empty">설정을 불러오는 중</div>';
        try {
            const r = await api('/api/price-check/pages');
            if (!r || r.ok === false) throw new Error(r && r.error ? r.error : '설정이 비어 있어요');
            const cfg = {}; Object.entries(r.config && typeof r.config === 'object' ? r.config : {}).forEach(([k, v]) => { if (v && typeof v === 'object') cfg[pcCfgKey(k)] = v; });
            PRICE.cfg = cfg;
            box.innerHTML = pages.map((p, i) => `<div class="pc-set-row" data-key="${esc(p.key)}" data-tier="${esc(p.tier || 'normal')}" data-ignore="${p.ignore ? '1' : ''}">
                <div class="pc-set-name"><b>${esc(p.name || p.key)}</b><small>${esc(PC_CH[p.channel] || p.channel || '')} · ${esc(pcCfgKey(p.key))}${p.options != null ? ' · 옵션 ' + nfmt(p.options) + '개' : ''}${p.sold === false ? ' · 판매 안 함' : ''}</small></div>
                <label class="desk-sr" for="pc-tier-${i}">${esc(p.name || p.key)} 등급</label><select class="pc-sel" id="pc-tier-${i}" data-f="tier">${PC_TIERS.map(t => `<option value="${t[0]}"${t[0] === (p.tier || 'normal') ? ' selected' : ''}>${t[1]}</option>`).join('')}</select>
                <label class="pc-ign"><input type="checkbox" data-f="ignore"${p.ignore ? ' checked' : ''}><span>제외</span></label>
            </div>`).join('');
        } catch (e) { box.innerHTML = ''; PRICE.cfg = null; pcSetMsg('설정을 불러오지 못했어요.' + (e && e.message ? ' (' + e.message + ')' : ''), 'err'); }
    }
    async function pcSetSave() {
        if (PRICE.setBusy || !PRICE.cfg) return;
        const pages = PRICE.data && Array.isArray(PRICE.data.pages) ? PRICE.data.pages : [];
        // 서버는 받은 것으로 통째로 갈아 끼운다 → 있던 설정을 먼저 싣고(등급이 비어 있던 설정은 지금 등급으로) 바꾼 줄을 덮는다
        const body = {};
        Object.entries(PRICE.cfg).forEach(([k, v]) => { const p = pages.find(x => pcCfgKey(x.key) === k); body[k] = { tier: PC_TIER[v.tier] ? v.tier : (p && p.tier) || 'normal', note: String(v.note || ''), ignore: v.ignore === true }; });
        let n = 0;
        $('pc-set-list').querySelectorAll('.pc-set-row').forEach(row => {
            const tier = row.querySelector('[data-f="tier"]').value, ignore = row.querySelector('[data-f="ignore"]').checked;
            if (tier === row.dataset.tier && ignore === (row.dataset.ignore === '1')) return;
            const k = pcCfgKey(row.dataset.key); n++;
            body[k] = { tier, note: (body[k] && body[k].note) || '', ignore };
        });
        if (!n) { pcSetMsg('바뀐 것이 없어요.'); return; }
        PRICE.setBusy = true; $('pc-set-save').disabled = true; pcSetMsg('저장하는 중');
        try {
            const r = await api('/api/price-check/pages', 'POST', body);
            if (r && r.ok === false) throw new Error(r.error || '저장하지 못했어요');
            showToast('페이지 등급을 저장했어요');
            await pcLoad(true);
            pcSetMsg(n + '개 페이지를 저장하고 가격을 다시 확인했어요.', 'ok');
        } catch (e) { pcSetMsg('저장하지 못했어요. 다시 눌러 주세요.' + (e && e.message ? ' (' + e.message + ')' : ''), 'err'); }
        finally { PRICE.setBusy = false; $('pc-set-save').disabled = false; }
    }

    function bindTools() {
        smsBind();   // #610-E 문자
        $('desk-price-now').addEventListener('click', () => { pcOpen(); const x = document.querySelector('#desk-price .desk-tool-x'); if (x) x.focus({ preventScroll: true }); });   // #612 전체 가격 확인하기 · #653-나: 고르면 항상 연다(이미 열려 있으면 그 카드로 — 닫기는 카드의 [닫기])
        $('desk-ship-now').addEventListener('click', () => shipOpen());
        $('ship-close').addEventListener('click', () => { toolShow(null); plusFocus('ship'); });
        $('qty-close').addEventListener('click', () => { pkClose(false); toolShow(null); plusFocus('qty'); });
        $('ship-form').addEventListener('submit', e => { e.preventDefault(); shipGo(false); });
        ['ship-from', 'ship-to'].forEach(id => $(id).addEventListener('change', () => { shipRange(); shipNote(''); shipLoad(); }));
        $('ship-out').addEventListener('click', e => {
            if (e.target.closest('#ship-copy')) { const d = SHIP.data; if (d && d.summary_text) copyText(d.summary_text, '요약을 복사했어요', document.getElementById('ship-sum-text')); }
            else if (e.target.closest('#ship-force')) shipGo(true);
            else if (e.target.closest('#ship-all')) shipPick(null);
            else if (e.target.closest('.ship-out-go')) {   // #613-b: 그 발송일로 기간을 바꾸고 같은 글로 다시 찾는다(검색어 유지)
                const day = e.target.closest('.ship-out-go').dataset.d;
                $('ship-from').value = day; $('ship-to').value = day; shipNote('');
                SHIP.rkey = day + '|' + day; SHIP.pick = null; SHIP.list = null; SHIP.lseq++;
                shipLoad();
            }
            else { const c = e.target.closest('.ship-stat li[role="button"], .ship-cell'); if (c) shipPick(c); }
        });
        $('ship-out').addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const li = e.target.closest && e.target.closest('.ship-stat li[role="button"]');
            if (li && e.target === li) { e.preventDefault(); shipPick(li); }
        });
        $('ship-form').addEventListener('keydown', e => { if (e.target.id === 'ship-q' && e.key === 'Enter') e.preventDefault(); });   // #621: 찾기 칸의 Enter 가 [조회](CJ 다시 묻기)를 누르지 않게
        $('ship-form').addEventListener('input', e => {
            if (e.target.id !== 'ship-q') return;
            clearTimeout(SHIP.qt);
            SHIP.qt = setTimeout(() => { const v = shipQNorm(e.target.value); if (v === SHIP.q) return; SHIP.q = v; SHIP.list = null; shipDetail(); shipList(); }, 300);
        });
        // #613: 붙여 넣은 운송장의 하이픈·빈칸을 빼고, 전화번호 통째면 끝 4자리만 남겨 칸에도 그렇게 보여 준다(손으로 치는 동안은 칸을 안 바꾸고 찾는 글만 다듬는다 → 칸은 벗어날 때 바꿈)
        $('ship-form').addEventListener('paste', e => {
            if (e.target.id !== 'ship-q') return;
            const raw = (e.clipboardData && e.clipboardData.getData('text')) || '', norm = shipQNorm(raw);
            if (!raw.trim() || norm === raw.trim()) return;
            e.preventDefault(); e.target.value = norm;
            clearTimeout(SHIP.qt); if (norm !== SHIP.q) { SHIP.q = norm; SHIP.list = null; shipDetail(); shipList(); }
        });
        $('ship-form').addEventListener('change', e => { if (e.target.id !== 'ship-q') return; const n = shipQNorm(e.target.value); if (n !== e.target.value) e.target.value = n; });
        $('ship-pick').addEventListener('click', () => $('ship-file').click());
        $('ship-file').addEventListener('change', e => { const f = (e.target.files || [])[0]; e.target.value = ''; shipUpload(f); });
        const drop = $('ship-drop');
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
        drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); shipUpload((e.dataTransfer.files || [])[0]); });
        $('qty-out').addEventListener('click', async e => {
            if (e.target.closest('#qty-again')) { qtyRun(); return; }
            if (e.target.closest('#qty-extra-add')) {
                QTY.draft.push({ partner: QTY.draft.length ? QTY.draft[QTY.draft.length - 1].partner : '', name: '', qty: '' }); qtyExtraPaint(); qtyExtraDirty(true);
                const f = document.querySelector(`#qty-extra-rows .qty-xrow[data-i="${QTY.draft.length - 1}"] .qty-xp`); if (f) f.focus();
                return;
            }
            if (e.target.closest('#qty-extra-go')) { qtyExtraGo(e.target.closest('#qty-extra-go')); return; }
            const pk = e.target.closest('.qty-pick');
            if (pk) { if (PK.open && pkBtn() === pk) pkClose(true); else pkOpen(pk); return; }
            const stp = e.target.closest('.qty-xm, .qty-xa');   // #600 수량 − / + (최소 1 · 직접 적어도 됨)
            if (stp) {
                const row = stp.closest('.qty-xrow'), d = QTY.draft[Number(row.dataset.i)], inp = row.querySelector('.qty-xq'), cur = parseInt(String(inp.value).trim(), 10);
                const nv = String(Math.max(1, Math.min(9999, (Number.isFinite(cur) ? cur : 0) + (stp.classList.contains('qty-xa') ? 1 : -1))));
                inp.value = nv; if (d) d.qty = nv; qtyExtraDirty(true); return;
            }
            const xx = e.target.closest('.qty-xx');
            if (xx) { QTY.draft.splice(Number(xx.closest('.qty-xrow').dataset.i), 1); qtyExtraPaint(); qtyExtraDirty(true); $('qty-extra-add').focus(); return; }
            const b = e.target.closest('[data-qty-copy]'); if (!b) return;
            try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': QTY.blobs.get(b.dataset.qtyCopy) })]); showToast('그림을 복사했어요. 카톡에 붙여 넣으세요'); }
            catch (err) { showToast('이 브라우저는 그림 복사를 막고 있어요. [내려받기]를 눌러 주세요'); }
        });
        // #598 직접 추가 행 — 적는 대로 QTY.draft 에(거래처·품목은 목록 창 pkPick 이 바꾼다 #600)
        const xEdit = e => {
            const row = e.target.closest && e.target.closest('.qty-xrow'); if (!row) return;
            const i = Number(row.dataset.i), d = QTY.draft[i], t = e.target; if (!d) return;
            if (t.classList.contains('qty-xq')) d.qty = t.value;
            else if (t.classList.contains('qty-xf')) d.name = t.value;
            else return;
            qtyExtraDirty(true);
        };
        $('qty-out').addEventListener('input', xEdit);
        $('qty-out').addEventListener('change', xEdit);
        $('qty-out').addEventListener('keydown', e => { if (e.key === 'ArrowDown' && e.target.closest && e.target.closest('.qty-pick') && !PK.open) { e.preventDefault(); pkOpen(e.target.closest('.qty-pick')); return; } if (e.key === 'Enter' && e.target.closest && e.target.closest('.qty-xrow input')) { e.preventDefault(); qtyExtraGo($('qty-extra-go')); } });
        $('qty-out').addEventListener('toggle', e => { if (e.target.id === 'qty-extra') QTY.xopen = e.target.open; }, true);
    }

    // #566(대표 10/6): 승인 결재함 탭 없음(모든 계정) — 9/30 뒤로 승인을 거치는 일이 없다. 혹시 승인 대기 건이 생기면 대표는 채팅 탭(본인 것)·이전 채팅 이력(모두)의 그 카드에서 승인/반려한다
    const TAB_NAME = { mine: '채팅', all: '이전 채팅 이력' };
    function setTab(tab) {
        if (!TAB_NAME[tab]) tab = 'mine';
        S.tab = tab;
        if (tab === 'mine') hbDrop('tab'); else hbPush('tab', tabPop, { deskTab: 1 });   // #677 다른 탭에서 뒤로가기 = 「채팅」 탭으로
        document.querySelectorAll('#desk-tabs .desk-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
        const list = $('desk-list');
        S.sig = ''; S.endAsk = 0;
        $('desk-fs').hidden = tab === 'all';
        $('desk-hist-mine-wrap').hidden = !isOwner() || tab !== 'all';
        $('desk-hist-q').value = S.q[tab] || ''; $('desk-hist-x').hidden = !S.q[tab];
        $('desk-full-title').textContent = TAB_NAME[tab] || '채팅';
        list.innerHTML = '<div class="desk-empty">불러오는 중</div>';
        return loadOrders(true);
    }

    // 방금 보낸 지시 카드(표 줄)를 찾아 화면 가운데로 옮기고 잠깐 강조한다 — 목록이 아직 안 받아졌으면 몇 번 다시 받는다
    async function revealOrders(ids) {
        if (!ids.length) return;
        const find = () => ids.map(id => document.querySelector(`#desk-list [data-oid="${id}"]`)).filter(Boolean);
        let els = find();
        for (let i = 0; i < 4 && !els.length; i++) {
            await new Promise(r => setTimeout(r, 700));
            S.sig = ''; await loadOrders(true);
            els = find();
        }
        if (!els.length) { $('desk-listbox').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
        const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        els[0].scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
        els.forEach(el => { el.classList.remove('desk-flash'); void el.offsetWidth; el.classList.add('desk-flash'); setTimeout(() => el.classList.remove('desk-flash'), 2600); });
    }

    async function loadStatus() {
        try {
            const d = await api('/api/agent-office/desk-status');
            const s = d.state || 'offline';
            $('desk-state').dataset.s = s;
            $('desk-stage').dataset.s = s;
            $('desk-state-text').textContent = STATE_LABEL[s] || s;
            const img = $('desk-char');
            const src = '/desk/akkomi-' + (s === 'busy' ? 'busy' : s === 'idle' ? 'idle' : 'off') + '.webp?v=2';   // #507 3D 아꼼이(10/3)
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
            const parts = [];
            if (d.waiting) parts.push(`대기 ${d.waiting}건`);
            if (d.working) parts.push(`처리 중 ${d.working}건`);
            if (s === 'offline' && d.last_seen) parts.push('마지막 확인 ' + kst(d.last_seen, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
            $('desk-state-sub').textContent = parts.join(' · ');
            $('desk-say').textContent = s === 'busy' ? sayWorking(d) : s === 'idle' && Number(d.waiting) > 0 && d.others_busy ? SAY.queued : SAY[s] || SAY.offline;
            // #470 창구 켜기·끄기 — 버튼은 늘 같은 자리에 둔다(숨기면 어디 있는지 못 찾는다 · 대표 실물 확인 9/29)
            // #490(대표 9/30): [쉬게 하기] 없음 — 껐다 켜면 토큰만 쓴다. 창구는 늘 켜 두고, PC가 꺼졌다 켜졌을 때 [창구 깨우기]만 관리자(대표·조가영)가 누른다.
            const lc = d.launcher, wrap = $('desk-wake'), wb = $('desk-wake-btn'), wn = $('desk-wake-note');
            const canWake = !!d.can_wake;      // 대표 PC의 관리 프로그램이 살아 있는가
            const asleep = s === 'offline';
            wrap.hidden = false;
            wb.hidden = !isAdmin() || !asleep;   // #501(대표 GO 10/2): 켜져 있을 땐 버튼을 숨긴다 — 자리 비움일 때만 상태 옆에 보인다
            wb.disabled = !canWake || !asleep;
            wb.textContent = asleep ? '창구 깨우기' : '창구 켜짐';
            wn.textContent = !canWake
                ? '대표 PC의 창구 관리 프로그램이 꺼져 있어요. PC를 켜면 남긴 지시부터 순서대로 처리됩니다.'
                : asleep && !isAdmin() ? '창구가 자리 비움이에요. 관리자가 깨우면 남긴 지시부터 처리됩니다.'
                : (lc && lc.note) ? lc.note : '';
            $('desk-tab-all').hidden = false;   // #538 이전 채팅 이력은 직원에게도 보인다(서버가 본인 것만 내려준다)
            $('desk-hist-mine-wrap').hidden = !isOwner() || S.tab !== 'all';
        } catch (e) { /* 다음 주기에 다시 */ }
    }

    async function wake() {
        const wb = $('desk-wake-btn');
        wb.disabled = true;
        try {
            const r = await api('/api/agent-office/desk/wake', 'POST', { action: 'wake' });
            showToast(r.message || '창구를 켭니다', 'success');
            setTimeout(loadStatus, 4000); setTimeout(loadStatus, 12000);
        } catch (e) { showToast(e.message || '신호를 보내지 못했습니다', 'error'); }
        wb.disabled = false;
    }

    // #476 받는 도중 탭이 바뀌면 이전 탭 목록을 새 탭 이름 아래 그리던 경합 교정 — 끝난 뒤 새 탭으로 한 번 더 받는다
    const HIST_PAGE = 60;
    function loadOrders(force) {
        if (S.loading) { S.again = true; return S.loadP; }
        S.loading = true;
        S.loadP = loadOrdersNow(force);
        return S.loadP;
    }
    async function loadOrdersNow(force) {
        const tab = S.tab;
        try {
            const hq = S.hist.q;
            const q = S.tab === 'mine' ? '?mine=1&limit=' + S.mineLimit : '?history=1&limit=' + HIST_PAGE + (hq ? '&q=' + encodeURIComponent(hq) : '');
            const d = await api('/api/agent-office/desk/orders' + q);
            if (tab !== S.tab || (tab === 'all' && hq !== S.hist.q)) { S.again = true; return; }
            let orders = d.orders || [];
            if (tab === 'all') {   // #538 [더 보기]로 받아 둔 옛 줄은 새로고침해도 남긴다
                const min = orders.length ? Math.min(...orders.map(o => o.id)) : Infinity;
                S.hist.older = S.hist.older.filter(o => o.id < min);
                if (!S.hist.older.length) S.hist.more = orders.length >= HIST_PAGE;
                orders = orders.concat(S.hist.older);
            }
            watchConfirms(orders);
            const sig = S.tab + '|' + orders.map(o => o.id + ':' + o.status + ':' + ((o.steps && o.steps.length) || 0) + ':' + (o.processed_at || '') + ':' + liveLen(o)).join(',');
            // #498 내 지시가 처리되기 시작하면 그 줄을 한 번 펼쳐 진행 상황과 쓰는 중인 답변이 바로 보이게 한다(닫으면 다시 열지 않는다)
            if (tab === 'mine') for (const o of orders) if (o.status === '처리중' && !S.autoOpened.has(o.id)) { S.autoOpened.add(o.id); S.detail.add(o.id); }
            S.orders = orders;
            if (force || sig !== S.sig) { S.sig = sig; renderList(); }
        } catch (e) {
            if (force && tab === S.tab) $('desk-list').innerHTML = `<div class="desk-empty">목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</div>`;
        } finally {
            S.loading = false;
            if (S.again) { S.again = false; S.sig = ''; await loadOrders(true); }
        }
    }

    // 내 정산 확인표가 새로 준비되면 기존 확인표 창을 띄운다(화면에 들어올 때 이미 있던 것은 목록의 버튼으로만)
    function watchConfirms(orders) {
        const mineId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
        const ready = orders.filter(o => o.status === '질문' && o.result && o.result.type === 'settlement_ocr_confirm');
        if (S.seenConfirm === null) { S.seenConfirm = new Set(ready.map(o => o.id)); return; }
        for (const o of ready) {
            if (S.seenConfirm.has(o.id)) continue;
            S.seenConfirm.add(o.id);
            if (mineId != null && o.created_by_id !== mineId) continue;
            if (/^\[검증469\]/.test(String(o.content || ''))) continue;   // #636: 검증 스크립트의 시험 지시는 실화면에 확인표 창을 띄우지 않는다(이중 안전망)
            openConfirm(o.result);
        }
    }
    function openConfirm(r) {
        if (typeof aoShowSettlementConfirm !== 'function') return;
        try {
            if (typeof aoSettleModalData !== 'undefined' && aoSettleModalData) aoSettleQueue.push(r);
            else aoShowSettlementConfirm(r);
        } catch (e) { console.error('확인표 열기 실패:', e); }
    }

    // #477 끝난 지시에 [이어서 지시] — 앞 답을 이어받아 고칠 점·추가 요청을 보낸다(서버 reply · 창구는 follow_of로 앞 대화를 받는다)
    const FOLLOW = ['완료', '안내', '응답됨', '오류', '오류확인', '반려', '질문종결', '피드백'];
    const PLAN_GO = '[이대로 진행]';   // #598: 대기 프로그램이 이 글자 그대로를 알아본다 — 바꾸면 scripts/desk 쪽도 같이
    // #525: 최종발주 정리 기록(내용이 「[최종발주] 」로 시작)에는 이어서 지시·답 칸을 띄우지 않는다 — 수정은 최종발주 화면의 대화 칸에서 한다
    const isFinalLog = o => /^\[최종발주\] /.test(String((o && o.content) || ''));
    function followHtml(o) {
        if (!FOLLOW.includes(o.status) || isFinalLog(o)) return '';
        if (!followOpen(o)) return isAnswer(o) ? '' : `<div class="desk-acts">${followBtn(o)}</div>`; // 답변 카드는 [답변 복사] 줄에 함께
        const always = chatMine();   // #500 대화 보기에서는 누르지 않아도 늘 열려 있다
        if (always) return composeBox(o, '이어서 보내기', '이어서 적어 주세요');

        return `<div class="desk-reply desk-follow">
                ${replyImgHtml(o.id)}<textarea class="desk-reply-in" id="reply-${o.id}" rows="${always ? 1 : 3}" maxlength="2000" placeholder="${always ? '이어서 지시하기 (이미지는 붙여넣기도 돼요)' : '고칠 점이나 이어서 할 일을 적어 주세요. 앞 답변을 이어받아 처리해요 (예: 3번 문구만 더 짧게)'}"></textarea>
                <button type="button" class="desk-btn sm primary" data-act="sendreply" data-id="${o.id}">이어서 보내기</button>
                <button type="button" class="desk-btn sm" data-act="replyimg" data-id="${o.id}">이미지 첨부</button>
                ${always ? '' : `<button type="button" class="desk-btn sm" data-act="follow" data-id="${o.id}">취소</button>`}
            </div>`;
    }
    // #538(대표 10/5 캡처): 채팅 탭의 답 칸 = 둥근 상자 하나 — 글 칸(위) + 아래 줄 왼쪽 「+」(이미지 첨부) · 오른쪽 화살표(보내기). 글자 버튼 없음(이름은 aria-label)
    const ICON_PLUS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    const ICON_UP = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
    function composeBox(o, sendLabel, hint) {
        return `<div class="desk-reply desk-cbox" data-cbox="${o.id}">
                ${replyImgHtml(o.id)}<label class="desk-sr" for="reply-${o.id}">${esc(sendLabel === '답 보내기' ? '답 적기' : '이어서 보낼 글')}</label>
                <textarea class="desk-reply-in" id="reply-${o.id}" rows="1" maxlength="2000" placeholder="${esc(hint)}"></textarea>
                <div class="desk-cbox-row">
                    <button type="button" class="desk-cbtn" data-act="replyimg" data-id="${o.id}" aria-label="이미지·파일 첨부" title="이미지·파일 첨부 (붙여넣기도 돼요)">${ICON_PLUS}</button><!--endslot-->
                    <button type="button" class="desk-cbtn primary" data-act="sendreply" data-id="${o.id}" aria-label="${esc(sendLabel)}" title="${esc(sendLabel)} (Enter)" disabled>${ICON_UP}</button>
                </div>
            </div>`;
    }
    // 글이나 붙인 이미지가 있어야 보내기가 켜진다
    function syncSendBtns() {
        document.querySelectorAll('#desk-list .desk-cbox').forEach(box => { const t = box.querySelector('.desk-reply-in'), b = box.querySelector('[data-act="sendreply"]'); if (t && b && b.getAttribute('aria-busy') !== 'true') b.disabled = !t.value.trim() && !S.replyImg.has(Number(box.dataset.cbox)); });
    }
    const isAnswer = o => !!o.result && (o.result.type === 'desk_answer' || o.result.type === 'answer');
    const chatMine = () => S.tab === 'mine' && S.view === 'chat';
    const followOpen = o => S.follow.has(o.id) || chatMine();
    // 이어서 지시·되묻기 답에 붙인 이미지(지시 1건에 1장) — 다시 그려도 남도록 S.replyImg 에 둔다
    const replyImgHtml = id => { const im = S.replyImg.get(id); if (im && im.file) return `<div class="desk-thumbs desk-reply-thumbs">${fileChip(im.name, im.size, `data-act="replyimgx" data-id="${id}"`)}</div>`; return im ? `<div class="desk-thumbs desk-reply-thumbs"><div class="desk-thumb"><img src="${im.data}" alt="붙인 이미지"><button type="button" data-act="replyimgx" data-id="${id}" aria-label="붙인 이미지 빼기">×</button></div></div>` : ''; };
    function setReplyImg(id, file) {
        if (!file || !attachOk(file)) return;
        const doc = isDoc(file);
        const rd = new FileReader();
        rd.onload = () => { S.replyImg.set(id, doc ? { data: String(rd.result), mime: file.type || 'application/octet-stream', name: file.name, size: file.size, file: true } : { data: String(rd.result), mime: file.type || 'image/png' }); S.sig = ''; renderList(); const ta = document.getElementById('reply-' + id); if (ta) ta.focus(); };
        rd.readAsDataURL(file);
    }
    const followBtn = o => S.tab !== 'all' && FOLLOW.includes(o.status) && !isFinalLog(o) && !followOpen(o) ? `<button type="button" class="desk-btn sm" data-act="follow" data-id="${o.id}">이어서 지시</button>` : '';
    // #484(대표 9/30): full = 표에서 줄을 눌러 펼친 자세히 칸 — 답변을 줄이지 않고 전부 보여 준다(전체 보기 버튼 없음)
    // #498 처리 중에 대기 프로그램이 적어 주는 「쓰는 중인 답변」(result.type = live)
    function liveText(o) { const r = o.result || {}; return o.status === '처리중' && r.type === 'live' && r.text ? String(r.text) : ''; }
    function liveLen(o) { return liveText(o).length; }
    function resultHtml(o, full) { return resultBody(o, full) + followHtml(o); }
    function resultBody(o, full) {
        const r = o.result || {};
        const st = o.status;
        if (ACTIVE.includes(st) || st === '판독완료' || st === '확인표작성') {
            const steps = visSteps(o);
            const last = steps.length ? steps[steps.length - 1].text : '';
            const msg = st === '대기' ? '순서를 기다리고 있어요' : st === '승인됨' ? '승인됐어요. 곧 실행합니다' : (last || '생각하고 있어요');   // #580: 아직 한 일이 없으면 「생각 중」
            const live = liveText(o);
            const trail = steps.slice(-4).filter(s => s && s.text);
            return `<div class="desk-note"><span class="desk-working">${esc(live ? '답변을 쓰고 있어요' : msg)}</span>${elapsedHtml(o)}</div>`
                + (full && trail.length > 1 ? `<ul class="desk-steps">${trail.map(s => `<li>${esc(kst(s.t, { hour: '2-digit', minute: '2-digit' }))} ${esc(s.text)}</li>`).join('')}</ul>` : '')
                + (live ? `<div class="desk-a answer draft live"><div class="desk-a-label">클코 답변 · 쓰는 중</div><div class="desk-live-scroll" data-live="${o.id}">${md(live)}<span class="desk-caret" aria-hidden="true"></span></div></div>` : '');
        }
        if (r.type === 'desk_answer' || r.type === 'answer') {
            const text = r.answer || r.text || '';
            const long = text.length > 360 || text.split('\n').length > 6;
            const mid = !long && (text.length > 120 || text.split('\n').length > 3); // #476 첫 화면 미리보기에서만 3줄로 줄인다
            const open = full || S.open.has(o.id);
            const fl = Array.isArray(r.files) ? r.files : [];
            // #536 주소로 온 그림(힉스필드 결과 등 · file_id 없음)도 바로 보인다 — 이름표가 아니라 주소 끝의 확장자로 가린다(https 만)
            const extOf = s => { const m = String(s || '').split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i); return m ? m[1].toLowerCase() : ''; };
            const urlOk = f => !f.file_id && /^https:\/\//i.test(String(f.url || ''));
            const mediaOf = f => { const ext = f.file_id ? extOf(f.label) : urlOk(f) ? extOf(f.url) : ''; return /^(png|jpe?g|gif|webp)$/.test(ext) ? 'img' : ext === 'mp4' ? 'video' : ''; };
            const srcOf = f => f.file_id ? `data-file="${Number(f.file_id)}"` : `src="${esc(f.url)}" referrerpolicy="no-referrer" loading="lazy"`;
            const media = fl.filter(f => (f.file_id || urlOk(f)) && mediaOf(f));
            const mediaHtml = media.length ? `<div class="desk-media">${media.map(f => mediaOf(f) === 'img'
                ? `<figure class="desk-media-item"><img ${srcOf(f)} alt="${esc(f.label || '첨부 사진')}" data-act="zoom" data-id="${o.id}" title="누르면 크게 보여요"><figcaption>${esc(f.label || '')}</figcaption></figure>`
                : `<figure class="desk-media-item video"><video ${srcOf(f)} controls playsinline preload="metadata"></video><figcaption>${esc(f.label || '')}</figcaption></figure>`).join('')}</div>` : '';
            const files = fl.length
                ? mediaHtml + `<div class="desk-acts desk-files">${fl.map(f => f.file_id
                    ? `<button type="button" class="desk-btn sm" data-act="file" data-id="${o.id}" data-file="${Number(f.file_id)}">${esc(f.label || '파일')} 내려받기</button>`
                    : `<a class="desk-link" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.label || '첨부 열기')}</a>`).join('')}</div>` : '';
            return `<div class="desk-a answer ${long && !open ? 'clamp' : ''}${(long || mid) && !open ? ' pv' : ''}"><button type="button" class="desk-sec-copy desk-a-copy" data-act="copytop" data-id="${o.id}" aria-label="답변 복사">복사</button><div class="desk-a-label">클코 답변</div>${laneChip(o)}${r.title && !sameHead(r.title, text) ? `<div class="desk-a-title">${esc(r.title)}</div>` : ''}${mdAnswer(text, o)}</div>${files}
                <div class="desk-acts desk-a-acts">${(long || mid) && !full ? `<button type="button" class="desk-btn sm${long ? '' : ' pv-only'}" data-act="toggle" data-id="${o.id}">${open ? '접기' : '전체 보기'}</button>` : ''}
                <button type="button" class="desk-btn sm" data-act="copy" data-id="${o.id}">답변 복사</button>${followBtn(o)}</div>`;
        }
        if (st === '질문' && r.type === 'settlement_ocr_confirm') {
            return `<div class="desk-a">${esc(r.summary || '정산 확인표가 준비됐어요')}</div>
                <div class="desk-acts"><button type="button" class="desk-btn sm primary" data-act="confirm" data-id="${o.id}">확인표 열기</button></div>`;
        }
        if (st === '질문') {
            // #473-b 그 자리에서 바로 답한다(대화처럼) — 보내면 이 질문은 닫히고, 창구가 앞 대화를 함께 받아 이어서 처리한다
            if (S.tab === 'all') return `<div class="desk-a">${esc(r.question || '확인이 필요해요')}</div><div class="desk-note">답을 기다리고 있어요. 답은 채팅 탭에서 보낼 수 있어요.</div>`;
            // #598(대표 10/9): 창구가 되물으며 할 일(result.plan = { label, cmds })을 함께 실어 보냈으면 [이대로 진행] 버튼 — 누르면 고정 글 「[이대로 진행]」이 이어서 지시 길로 간다(대기 프로그램이 AI 없이 cmds 를 실행). cmds 는 화면에 그리지 않는다
            const plan = r.type === 'clarify' && r.plan && typeof r.plan === 'object' && String(r.plan.label || '').trim() ? `<div class="desk-acts desk-plan"><button type="button" class="desk-btn sm primary" data-act="plango" data-id="${o.id}">이대로 진행 · ${esc(cutText(String(r.plan.label).replace(/\s+/g, ' ').trim(), 60))}</button></div>` : '';
            if (chatMine()) return `<div class="desk-a">${esc(r.question || '확인이 필요해요')}</div>` + plan + composeBox(o, '답 보내기', '여기에 답을 적어 주세요');
            return `<div class="desk-a">${esc(r.question || '확인이 필요해요')}</div>${plan}
                <div class="desk-reply">
                    ${replyImgHtml(o.id)}<textarea class="desk-reply-in" id="reply-${o.id}" rows="2" maxlength="2000" placeholder="여기에 답을 적어 보내면 이어서 처리해요"></textarea>
                    <button type="button" class="desk-btn sm primary" data-act="sendreply" data-id="${o.id}">답 보내기</button>
                    <button type="button" class="desk-btn sm" data-act="replyimg" data-id="${o.id}">이미지 첨부</button>
                </div>`;
        }
        if (r.type === 'approval_request') {
            const done = st === '반려' ? `<div class="desk-note">반려: ${esc(r.rejected_by || '')}${r.reject_reason ? ' · ' + esc(r.reject_reason) : ''}</div>`
                : r.approved_by ? `<div class="desk-note">승인: ${esc(r.approved_by)}</div>` : '';
            const pend = S.pend.get(o.id);
            const acts = st === '승인대기' && isOwner() && pend === 'approve'
                ? `<div class="desk-reply desk-confirm"><p class="desk-confirm-q">이 요청을 승인할까요? 승인하면 창구가 바로 실행합니다.</p>
                   <button type="button" class="desk-btn sm primary" data-act="approve2" data-id="${o.id}">승인하고 실행</button>
                   <button type="button" class="desk-btn sm" data-act="pendcancel" data-id="${o.id}">취소</button></div>`
                : st === '승인대기' && isOwner() && pend === 'reject'
                ? `<div class="desk-reply desk-confirm"><label class="desk-confirm-q" for="reject-${o.id}">반려 사유 (비워도 됩니다)</label>
                   <textarea class="desk-reply-in" id="reject-${o.id}" rows="2" maxlength="500" placeholder="예: 대상을 다시 확인해 주세요"></textarea>
                   <button type="button" class="desk-btn sm danger" data-act="reject2" data-id="${o.id}">반려하기</button>
                   <button type="button" class="desk-btn sm" data-act="pendcancel" data-id="${o.id}">취소</button></div>`
                : st === '승인대기' && isOwner()
                ? `<div class="desk-acts"><button type="button" class="desk-btn sm primary" data-act="approve" data-id="${o.id}">승인하고 실행</button>
                   <button type="button" class="desk-btn sm danger" data-act="reject" data-id="${o.id}">반려</button></div>`
                : st === '승인대기' ? '<div class="desk-note">대표 승인을 기다리고 있어요</div>' : '';
            return `<dl class="desk-kv"><dt>요청</dt><dd>${esc(r.summary)}</dd>${r.impact ? `<dt>영향</dt><dd>${esc(r.impact)}</dd>` : ''}${r.plan ? `<dt>승인되면</dt><dd>${esc(r.plan)}</dd>` : ''}</dl>${done}${acts}`;
        }
        if (st === '오류' || st === '오류확인' || r.type === 'error') return `<div class="desk-a">처리하지 못했어요: ${esc(r.error || '사유 기록 없음')}</div>
            ${st === '오류' && isAdmin() ? `<div class="desk-acts"><button type="button" class="desk-btn sm" data-act="retry" data-id="${o.id}">다시 맡기기</button></div>` : ''}`;
        if (st === '질문종결') {
            const asked = r.question || r.summary || '';
            return (asked ? `<div class="desk-a"><div class="desk-a-title">물은 것</div>${esc(asked)}</div>` : '')
                + (o.followed_by ? `<div class="desk-note">↳ 답은 ${Number(o.followed_by)}번 지시로 이어서 처리했어요</div>` : '');
        }
        const text = r.notice || r.summary || '';
        return text ? `<div class="desk-a">${esc(text)}</div>` : '';
    }

    // 상태 묶음 — 화면의 「전체 상태」 고르개와 같은 기준
    const GROUP = {
        work: ['대기', '처리중', '판독완료', '확인표작성', '승인됨'],
        ask: ['질문', '승인대기'],
        done: ['완료', '안내', '응답됨', '질문종결', '취소', '대체됨', '피드백'],
        err: ['오류', '오류확인', '반려'],
    };
    const shown = () => S.fs === 'all' ? S.orders : S.orders.filter(o => (GROUP[S.fs] || []).includes(o.status));
    // 표 칸에 넣을 한 줄 요약
    function resultLine(o) {
        const r = o.result || {}, st = o.status;
        if (GROUP.work.includes(o.status)) {
            const steps = visSteps(o);
            const last = steps.length ? steps[steps.length - 1].text : '';
            return '<span class="desk-working">' + esc(st === '대기' ? '순서를 기다리고 있어요' : st === '승인됨' ? '승인됐어요. 곧 실행합니다' : (last || '처리하고 있어요')) + '</span>';
        }
        if (st === '질문') return '<span class="desk-working">답을 기다리고 있어요</span> · ' + esc(String(r.question || '').replace(/\s+/g, ' ').slice(0, 70));
        const t = r.title || r.summary || r.answer || r.question || r.notice || r.error || '';
        return esc(String(t).replace(/\s+/g, ' ').slice(0, 90));
    }

    // #476 워커 H1: 진행 중 지시가 있으면 4초마다 목록을 다시 그린다 → 답 칸에 적던 글·커서를 보존해 되돌린다
    function keepReplies(fn) {
        const saved = {};
        document.querySelectorAll('#desk-list .desk-reply-in').forEach(t => { if (t.value) saved[t.id] = t.value; });
        const a = document.activeElement;
        const focusId = a && a.classList && a.classList.contains('desk-reply-in') ? a.id : null;
        const sel = focusId ? [a.selectionStart, a.selectionEnd] : null;
        // #498 쓰는 중인 답변 칸: 맨 아래를 보고 있었으면(또는 처음 그리면) 계속 맨 아래를 따라가고, 위로 올려 읽고 있었으면 그 자리를 지킨다
        const liveAt = {};
        document.querySelectorAll('#desk-list [data-live]').forEach(el => { liveAt[el.dataset.live] = { top: el.scrollTop, bottom: el.scrollHeight - el.scrollTop - el.clientHeight < 24 }; });
        fn();
        document.querySelectorAll('#desk-list [data-live]').forEach(el => { const p = liveAt[el.dataset.live]; el.scrollTop = !p || p.bottom ? el.scrollHeight : p.top; });
        for (const id in saved) { const t = document.getElementById(id); if (t && !t.value) t.value = saved[id]; if (t) fitReply(t); }
        if (focusId) { const t = document.getElementById(focusId); if (t) { t.focus({ preventScroll: true }); try { t.setSelectionRange(sel[0], sel[1]); } catch (e) { } } }
        syncSendBtns();
    }
    // #498 목록 안의 글자를 끌어 고르는 중이면 다시 그리지 않는다(고른 것이 풀리지 않게) — 고르기를 끝내면 다음 새로고침에 그린다
    function selectingInList() {
        const g = window.getSelection && window.getSelection();
        if (!g || g.isCollapsed || !g.anchorNode) return false;
        const box = $('desk-list');
        return !!(box && box.contains(g.anchorNode));
    }
    // 답 칸은 한 줄로 시작해 적는 만큼 늘어난다(최대 220px)
    function fitReply(t) { if (!t.value) { t.style.height = ''; return; } t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 220) + 'px'; }
    function renderList() { if (selectingInList()) { S.sig = ''; return; } keepReplies(renderListNow); highlight(); fillMedia(); }
    // #543 검색 — 지시 글·답 글·보낸 사람에서 찾는다(대화는 한 차례라도 맞으면 통째로)
    const qNow = () => String(S.q[S.tab] || '').trim().toLowerCase();
    const hayOf = o => { const r = o.result || {}; return [o.content, o.created_by, o.file_name, r.answer, r.text, r.title, r.question, r.summary, r.notice].filter(Boolean).join('\n').toLowerCase(); };
    const matchQ = (o, q) => !q || hayOf(o).includes(q);
    // 맞는 낱말에 옅은 형광 — 다 그린 뒤 글자 노드만 감싼다(HTML 을 문자열로 끼우지 않는다)
    function highlight() {
        const q = qNow(); if (!q) return;
        const root = $('desk-list');
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => { const p = n.parentElement; return p && !p.closest('textarea, script, style, mark, .desk-badge, .desk-empty, .desk-cbox, .desk-end-ask, .desk-h-foot, .desk-a-acts, .desk-acts') && n.nodeValue.toLowerCase().includes(q) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
        const nodes = []; while (w.nextNode() && nodes.length < 600) nodes.push(w.currentNode);
        for (const n of nodes) {
            const txt = n.nodeValue, low = txt.toLowerCase(), frag = document.createDocumentFragment(); let i = 0, j;
            while ((j = low.indexOf(q, i)) >= 0) { if (j > i) frag.appendChild(document.createTextNode(txt.slice(i, j))); const m = document.createElement('mark'); m.className = 'desk-hl'; m.textContent = txt.slice(j, j + q.length); frag.appendChild(m); i = j + q.length; }
            if (i < txt.length) frag.appendChild(document.createTextNode(txt.slice(i)));
            n.parentNode.replaceChild(frag, n);
        }
    }
    // #504 첨부 사진·영상 채우기 — 받은 파일은 S.media(file_id → object URL)에 두어 2초 새로고침에 다시 받지 않는다
    async function fillMedia() {
        const els = document.querySelectorAll('#desk-list [data-file]:not([src])');
        for (const el of els) {
            if (!(el instanceof HTMLImageElement) && !(el instanceof HTMLVideoElement)) continue;
            const id = Number(el.dataset.file);
            if (!id) continue;
            if (S.media.has(id)) { const u = S.media.get(id); if (u === 'fail') { const fig = el.closest('.desk-media-item'); if (fig) fig.classList.add('fail'); } else if (u) el.src = u; continue; }
            S.media.set(id, '');   // 받는 중
            try {
                const res = await fetch('/api/agent-office/files/' + id + '/download', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') } });
                if (!res.ok) throw new Error(String(res.status));
                const u = URL.createObjectURL(await res.blob());
                S.media.set(id, u);
                document.querySelectorAll('#desk-list [data-file="' + id + '"]:not([src])').forEach(x => { x.src = u; });
            } catch (e) { S.media.set(id, 'fail'); const fig = el.closest('.desk-media-item'); if (fig) fig.classList.add('fail'); }   // 실패도 기억해 2초마다 다시 받지 않는다
        }
    }
    // 사진 크게 보기(누르면 열리고, 다시 누르거나 Esc 로 닫힘)
    function zoomMedia(src, label) {
        let z = $('desk-zoom');
        if (!z) { z = document.createElement('div'); z.id = 'desk-zoom'; z.className = 'desk-zoom'; z.setAttribute('role', 'dialog'); z.setAttribute('aria-label', '사진 크게 보기'); z.addEventListener('click', zoomClose); document.body.appendChild(z); }
        z.innerHTML = `<img src="${src}" alt="${esc(label || '')}"><div class="desk-zoom-cap">${esc(label || '')} · 누르면 닫혀요</div>`;
        z.hidden = false; hbPush('zoom', zoomClose, { deskZoom: 1 });
    }
    function renderListNow() {
        const box = $('desk-list');
        let list = S.tab === 'all' ? (S.hist.mineOnly ? S.orders.filter(o => o.created_by_id === myId()) : S.orders) : shown();
        const chat = S.tab === 'mine' && S.view === 'chat';
        const q = qNow(); S.qOn = !!q;
        if (q) {
            if (S.tab === 'all' || chat) { const okIds = new Set(); threadsOf(S.tab === 'all' ? list : S.orders).forEach(t => { if (t.items.some(o => matchQ(o, q))) t.items.forEach(o => okIds.add(o.id)); }); list = list.filter(o => okIds.has(o.id)); }
            else list = list.filter(o => matchQ(o, q));
        }
        const vb = $('desk-view');
        if (vb) { vb.hidden = true; vb.textContent = S.view === 'chat' ? '표로 보기' : '대화로 보기'; }   // #504 전환 버튼 없음
        box.classList.toggle('desk-cardlist', !S.wide && !chat);
        box.classList.toggle('desk-chat', chat || S.tab === 'all');
        box.classList.toggle('desk-hist', S.tab === 'all');
        if (!list.length) {
            setMore('desk-list-more', 0);
            box.innerHTML = `<div class="desk-empty">${q ? '찾는 글이 든 채팅이 없어요. 다른 낱말로 찾아 보세요.' : S.tab === 'all' ? '이전 채팅이 아직 없어요.' : S.fs !== 'all' ? '고른 상태에 해당하는 채팅이 없어요.' : '열려 있는 채팅이 없어요. 위 입력칸에 적어 보내면 여기에 쌓여요.'}</div>`;
            return;
        }
        if (S.tab === 'all') { renderHistory(list); return; }
        if (chat) { renderChat(list); return; }
        const ov = previewMask(list);
        setMore('desk-list-more', ov.filter(Boolean).length);
        if (S.wide) { renderTable(list, ov); return; }
        box.innerHTML = list.map((o, i) => {
            const b = BADGE[o.status] || ['wait', o.status];
            const steps = visSteps(o).slice(-4);
            const showSteps = steps.length > 1 && !['완료', '안내', '응답됨'].includes(o.status);
            return `<article class="desk-card${ov[i] ? ' ov' : ''}" data-oid="${o.id}">
                <div class="desk-card-head"><span class="desk-badge" data-k="${b[0]}">${esc(b[1])}</span>
                    <span>${o.id}번</span>${o.reply_to ? `<span class="desk-thread">↳ ${Number(o.reply_to)}번에 이어서</span>` : ''}<span>${esc(o.created_by || '')}</span>
                    <span>${esc(kst(o.created_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>
                    ${o.file_name ? `<span>📎 ${esc(o.file_name)}</span>` : o.has_image ? '<span>이미지 첨부</span>' : ''}
                    ${S.tab === 'mine' && !ACTIVE.includes(o.status) && !['판독완료', '확인표작성', '승인대기'].includes(o.status) ? `<button type="button" class="desk-x" data-act="hide" data-id="${o.id}" aria-label="${o.id}번 채팅 종료" title="채팅 종료">×</button>` : ''}</div>
                <p class="desk-q">${esc(o.content)}</p>
                ${resultHtml(o)}
                ${showSteps ? `<ul class="desk-steps">${steps.map(s => `<li>${esc(kst(s.t, { hour: '2-digit', minute: '2-digit' }))} ${esc(s.text)}</li>`).join('')}</ul>` : ''}
            </article>`;
        }).join('');
    }

    // #499(대표 GO 10/2) 내 지시 = 대화 보기. 이어서 지시·되묻기 답(reply_to)을 한 대화로 묶어, 내 글은 오른쪽·클코 답은 왼쪽에 시간순으로 쌓는다.
    //   새 대화가 맨 위(입력칸 바로 아래). 답 내용은 표·카드와 같은 resultBody 를 그대로 쓴다(버튼·답 칸·쓰는 중인 답변 동작 동일).
    const CLOSED_FOR_HIDE = o => !ACTIVE.includes(o.status) && !['판독완료', '확인표작성', '승인대기', '질문'].includes(o.status);
    function threadsOf(all) {
        const byId = new Map(all.map(o => [o.id, o]));
        const rootOf = o => { let c = o, n = 0; while (c.reply_to && byId.has(c.reply_to) && n++ < 60) c = byId.get(c.reply_to); return c.id; };
        const m = new Map();
        for (const o of all) { const r = rootOf(o); if (!m.has(r)) m.set(r, []); m.get(r).push(o); }
        const out = [...m.entries()].map(([id, items]) => { items.sort((a, b) => a.id - b.id); return { id, items, last: items[items.length - 1].id }; });
        out.sort((a, b) => b.last - a.last);
        return out;
    }
    function renderChat(list) {
        const keep = new Set(list.map(o => o.id));
        const ths = threadsOf(S.orders).filter(t => t.items.some(o => keep.has(o.id)));   // 상태로 거를 때: 대화 안 한 건이라도 맞으면 대화 통째로
        let shownN = 0, hidden = 0;
        const hm = { hour: '2-digit', minute: '2-digit' };
        const html = ths.map((t, ti) => {
            const needs = t.items.some(o => NEEDS.includes(o.status));
            const ov = !S.qOn && !needs && !t.items.some(o => S.pin.has(o.id)) && ++shownN > PREVIEW_LIST;
            if (ov) hidden++;
            const first = t.items[0];
            // #653-다 ②: 답 칸은 맨 위(가장 최근) 대화만 펼친다 — 나머지는 「이어서 지시」 한 줄(누르거나 대화를 누르면 펼쳐짐 · 쓰던 글·붙인 그림·종료 확인 중이면 펼친 채)
            const boxOpen = ti === 0 || S.boxOpen.has(t.id) || S.endAsk === t.id || S.replyImg.has(t.last);
            const canHide = t.items.every(o => CLOSED_FOR_HIDE(o) || o.status === '질문');   // #605(대표 10/9): 되묻기에 답하지 않고도 끝낼 수 있게 — 종료 때 「질문」은 먼저 닫는다(질문종결)
            const busyEnd = !canHide && t.items.some(o => ['판독완료', '확인표작성', '승인대기'].includes(o.status));
            // #538: 대화 머리 = 시작 시각 + 첫 글 한 줄 → 어디서부터 다른 대화인지 바로 보인다
            const head = `<div class="desk-th-head"><span class="desk-th-when">${esc(kst(first.created_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} 시작</span><span class="desk-th-sum">${esc(cutText(first.content, 60))}</span>${first.reply_to ? `<span class="desk-thread">↳ ${Number(first.reply_to)}번에 이어서</span>` : ''}${t.items.length > 1 ? `<span>${t.items.length}번 주고받음</span>` : ''}</div>`;
            // #538 [채팅 종료] — 끝난 대화에만 · 카드 안에서 한 번 확인 · 이전 채팅 이력에서 다시 볼 수 있다
            // #541(대표 10/5): [채팅 종료]는 답 상자 안 「+」 옆에 담는다(상자가 틀 너비를 다 쓴다). 답 상자가 없는 대화(최종발주 기록 등)만 상자 밖
            // #559(대표 폰 실물 10/6): 종료 확인도 답 상자 안 같은 자리에서 — [채팅 종료]를 누른 그 자리에 [종료하기]가 나와 손이 안 움직인다
            const endIn = `<span class="desk-end-ask in" role="group" aria-label="채팅 종료 확인 — 이전 채팅 이력에서 다시 볼 수 있어요"><button type="button" class="desk-endbtn yes" data-act="hidethread" data-id="${t.id}">종료하기</button><button type="button" class="desk-endbtn no" data-act="endno" data-id="${t.id}">취소</button></span>`;
            // #571(대표 10/7 「PC 에서도 모바일처럼」): 답 상자가 없는 대화(최종발주 기록)도 같은 자리에서 — 종전 넓은 확인 칸은 PC 에서 [종료]가 오른쪽 끝(600px 넘게)으로 떨어졌다. 이제 [채팅 종료]가 있던 그 자리에 [종료하기]·[취소](.solo)
            const endBtn = canHide ? `<button type="button" class="desk-endbtn" data-act="endchat" data-id="${t.id}">채팅 종료</button>` : '';
            const lastHtml = o => { const rb = resultBody(o, true), f0 = followHtml(o), f = !boxOpen && f0.indexOf('data-cbox="') >= 0 ? `<div class="desk-follow-line"><button type="button" class="desk-follow-open" data-act="openbox" data-id="${t.id}" aria-expanded="false">이어서 지시</button><!--endslot--></div>` : f0, asking = S.endAsk === t.id; const wrap = (a, b) => a + `<div class="desk-chatbar">${b}</div>`;
                if (!endBtn) return wrap(rb, f + (busyEnd ? '<span class="desk-h-note">처리 중이라 끝난 뒤 종료할 수 있어요.</span>' : ''));
                if (f.indexOf('<!--endslot-->') >= 0) return wrap(rb, f.replace('<!--endslot-->', asking ? endIn : endBtn));
                if (rb.indexOf('<!--endslot-->') >= 0) return wrap(rb.replace('<!--endslot-->', asking ? endIn : endBtn), f);   // #605 되묻기 답 상자 안 「+」 옆
                return wrap(rb, f + (asking ? endIn.replace('class="desk-end-ask in"', 'class="desk-end-ask in solo"') : endBtn)); };
            const turns = t.items.map(o => {
                const b = BADGE[o.status] || ['wait', o.status];
                const last = o.id === t.last;
                return `<div class="desk-turn${last ? ' last' : ''}" data-oid="${o.id}">
                    <div class="desk-bub me"><p class="desk-q">${esc(o.content)}</p><div class="desk-bub-meta">${o.id}번 · ${esc(kst(o.created_at, hm))}${attMeta(o)}</div></div>
                    <div class="desk-bub ai">${['완료', '안내', '응답됨'].includes(o.status) ? '' : `<div class="desk-bub-who"><span class="desk-badge" data-k="${b[0]}">${esc(b[1])}</span></div>`}${last ? lastHtml(o) : resultBody(o, true)}</div>
                </div>`;
            }).join('');
            return `<article class="desk-thread-box${ov ? ' ov' : ''}" data-th="${t.id}">${head}${turns}</article>`;
        }).join('');
        setMore('desk-list-more', hidden);
        // #571: 종료 확인 중에 목록이 다시 그려져도(새 글 확인 등) 초점이 [종료하기]·[취소]에 그대로 남게
        const fa = document.activeElement, fk = fa && fa.closest && fa.closest('#desk-list') && /^(hidethread|endno)$/.test(fa.getAttribute('data-act') || '') ? [fa.getAttribute('data-act'), fa.getAttribute('data-id')] : null;
        $('desk-list').innerHTML = html;
        if (fk) { const el = document.querySelector(`#desk-list [data-act="${fk[0]}"][data-id="${fk[1]}"]`); if (el) el.focus({ preventScroll: true }); }
    }

    // #538(대표 10/5) 이전 채팅 이력 — 대화(스레드) 한 줄씩 · 날짜 묶음 · 누르면 그 자리에서 말풍선으로 펼침(읽기 전용) · 본인 대화는 [이 채팅 다시 이어가기]
    const myId = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    const PREVIEW_HIST = 8;
    function dayGroup(t) {
        const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(String(t)) ? t : String(t).replace(' ', 'T') + 'Z'), now = new Date();
        const key = x => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
        const dk = key(d), nk = key(now), diff = Math.round((Date.parse(nk + 'T00:00:00Z') - Date.parse(dk + 'T00:00:00Z')) / 86400000);
        if (diff <= 0) return '오늘';
        if (diff === 1) return '어제';
        const dow = (new Date(nk + 'T00:00:00Z').getUTCDay() + 6) % 7;   // 월요일 = 0
        if (diff <= dow) return '이번 주';
        const y = Number(dk.slice(0, 4)), m = Number(dk.slice(5, 7));
        return (y !== Number(nk.slice(0, 4)) ? y + '년 ' : '') + m + '월';
    }
    const histFlag = t => t.items.some(o => ['질문', '승인대기'].includes(o.status)) ? ['ask', '확인 필요'] : t.items.some(o => GROUP.err.includes(o.status)) ? ['err', '오류'] : t.items.some(o => GROUP.work.includes(o.status)) ? ['work', '진행 중'] : null;
    const hasAttach = o => !!o.has_image || !!o.file_name || !!(o.result && Array.isArray(o.result.files) && o.result.files.length);
    const ICON_CLIP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>';
    // #605(대표 10/9): 이전 채팅 이력 줄 [지우기] — 본인 대화 · 끝난 것만 · 내 이력에서만 사라진다(대표의 전체 이력에는 그대로). hide-mine {hist:true} → 서버가 hist_hidden 으로 직원 이력에서 거른다
    const histCanDel = t => { const me = myId(); return !isOwner() && me != null && t.items.every(o => o.created_by_id === me && CLOSED_FOR_HIDE(o)); };
    const histDelBtn = (t, cls) => S.hist.delAsk === t.id ? `<button type="button" class="desk-btn sm primary${cls}" data-act="histdel" data-id="${t.id}" aria-label="지우기 확인 — 한 번 더 누르면 내 이력에서 지워요" title="한 번 더 누르면 내 이력에서 지워요">확인</button>` : `<button type="button" class="desk-btn sm${cls}" data-act="histdel" data-id="${t.id}" aria-label="이 채팅을 내 이력에서 지우기">지우기</button>`;
    async function histDelete(rootId, b) {
        let t = threadsOf(S.orders).find(x => x.id === rootId); const me = myId();
        if (!t || !histCanDel(t)) return;
        if (S.hist.delAsk !== rootId) { S.hist.delAsk = rootId; renderList(); const y = document.querySelector('#desk-list [data-act="histdel"][data-id="' + rootId + '"]'); if (y) y.focus({ preventScroll: true }); showToast('한 번 더 누르면 내 이력에서 지워요'); return; }
        b.disabled = true;
        try {
            if (S.hist.q) {   // 검색 결과에는 맞은 차례만 있다 → 그 대화의 차례를 전부 찾아 함께 지운다
                const d = await api('/api/agent-office/desk/orders?history=1&limit=200');
                const known = new Set(S.orders.map(o => o.id));
                const full = threadsOf(S.orders.concat((d.orders || []).filter(o => !known.has(o.id)))).find(x => x.items.some(o => o.id === rootId));
                if (full && full.items.every(o => o.created_by_id === me && CLOSED_FOR_HIDE(o))) t = full;
            }
            for (const it of t.items) await api('/api/agent-office/orders/' + it.id + '/hide-mine', 'POST', { hide: true, hist: true });
            const gone = new Set(t.items.map(x => x.id));
            S.orders = S.orders.filter(x => !gone.has(x.id)); S.hist.older = S.hist.older.filter(x => !gone.has(x.id)); S.hist.open.delete(rootId); S.hist.delAsk = 0; S.sig = ''; renderList();
            showToast('내 이력에서 지웠어요');
        } catch (err) { showToast(err && err.message ? err.message : '지우지 못했어요'); S.hist.delAsk = 0; S.sig = ''; loadOrders(true); }
    }
    function renderHistory(list) {
        const ths = threadsOf(list), admin = isOwner(), me = myId(), hm = { hour: '2-digit', minute: '2-digit' }, mdhm = { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        let lastG = '', n = 0, hidden = 0;
        const html = ths.map(t => {
            const first = t.items[0], lastO = t.items[t.items.length - 1], g = dayGroup(lastO.created_at), open = S.hist.open.has(t.id);
            const ov = !S.qOn && ++n > PREVIEW_HIST && !open; if (ov) hidden++;
            const flag = histFlag(t), fin = isFinalLog(first);
            const head = g !== lastG ? `<h4 class="desk-h-day${ov ? ' ov' : ''}">${esc(g)}</h4>` : ''; lastG = g;
            const when = (g === '오늘' || g === '어제' ? '' : kst(lastO.created_at, { month: 'numeric', day: 'numeric' }) + ' ') + kst(lastO.created_at, hm);
            const row = `<button type="button" class="desk-h-row" data-act="histopen" data-id="${t.id}" aria-expanded="${open}">
                    <span class="desk-h-when">${esc(when)}</span>${admin ? `<span class="desk-h-who${first.created_by_id === me ? ' mine' : ''}">${esc(first.created_by || '')}</span>` : ''}
                    <span class="desk-h-text">${esc(cutText(first.content, 120))}</span>
                    <span class="desk-h-meta">${flag ? `<span class="desk-badge" data-k="${flag[0]}">${flag[1]}</span>` : ''}${t.items.some(hasAttach) ? `<span class="desk-h-clip" title="첨부 있음" aria-label="첨부 있음">${ICON_CLIP}</span>` : ''}${t.items.length > 1 ? `<span class="desk-h-n">${t.items.length}번 주고받음</span>` : ''}<span class="desk-h-chev" aria-hidden="true">${open ? '▴' : '▾'}</span></span>
                </button>${(() => { const la = [...t.items].reverse().find(o => o.result && (o.result.answer || o.result.text)); return !open && la ? `<button type="button" class="desk-btn sm desk-h-copy" data-act="copy" data-id="${la.id}" aria-label="마지막 답변 복사">복사</button>` : ''; })()}${!open && histCanDel(t) ? histDelBtn(t, ' desk-h-del') : ''}`;   // #584(대표 10/8): 접힌 검색 결과에서도 펼치지 않고 마지막 답변을 바로 복사
            let body = '';
            if (open) {
                const turns = t.items.map(o => { const b = BADGE[o.status] || ['wait', o.status];
                    return `<div class="desk-turn" data-oid="${o.id}"><div class="desk-bub me"><p class="desk-q">${esc(o.content)}</p><div class="desk-bub-meta">${o.id}번 · ${esc(kst(o.created_at, mdhm))}${attMeta(o)}</div></div>
                        <div class="desk-bub ai">${['완료', '안내', '응답됨'].includes(o.status) ? '' : `<div class="desk-bub-who"><span class="desk-badge" data-k="${b[0]}">${esc(b[1])}</span></div>`}${resultBody(o, true)}</div></div>`; }).join('');
                const mine = me != null && t.items.every(o => o.created_by_id === me);
                const live = t.items.some(o => !o.mine_hidden);
                const foot = mine && !fin ? `<div class="desk-h-foot"><button type="button" class="desk-btn sm primary" data-act="resume" data-id="${t.id}">${live ? '채팅 탭에서 이어가기' : '이 채팅 다시 이어가기'}</button><span class="desk-h-note">${live ? '지금 채팅 탭에 열려 있는 대화예요.' : '채팅 탭으로 다시 꺼내 이어서 보낼 수 있어요.'}</span>${histCanDel(t) ? histDelBtn(t, '') : ''}</div>` : '';
                body = `<div class="desk-h-body"><div class="desk-h-head">${esc(kst(first.created_at, mdhm))} 시작 · ${t.items.length}번 주고받음</div>${turns}${foot}</div>`;
            }
            return head + `<article class="desk-h-item${ov ? ' ov' : ''}${open ? ' open' : ''}" data-th="${t.id}">${row}${body}</article>`;
        }).join('');
        const more = S.hist.more ? `<button type="button" class="desk-btn desk-h-more${hidden ? ' ov' : ''}" data-act="histmore" data-id="${list.length ? list[list.length - 1].id : 0}">더 보기</button>` : '';
        setMore('desk-list-more', hidden);
        $('desk-list').innerHTML = html + more;
    }
    async function histMore(b) {
        if (S.hist.busy || !S.orders.length) return;
        S.hist.busy = true; b.disabled = true; b.setAttribute('aria-busy', 'true');
        try {
            const last = Math.min(...S.orders.map(o => o.id)), q0 = S.hist.q;
            const d = await api('/api/agent-office/desk/orders?history=1&limit=' + HIST_PAGE + '&before=' + last + (q0 ? '&q=' + encodeURIComponent(q0) : ''));
            if (S.tab !== 'all' || q0 !== S.hist.q) return;
            const got = d.orders || [];
            S.hist.older = S.hist.older.concat(got); S.hist.more = got.length >= HIST_PAGE;
            S.orders = S.orders.concat(got); S.sig = ''; renderList();
        } catch (err) { showToast(err && err.message ? err.message : '더 불러오지 못했어요'); b.disabled = false; b.removeAttribute('aria-busy'); }
        finally { S.hist.busy = false; }
    }
    // #547(대표 10/5): 이력에서 펼친 대화를 접으면 화면이 접힌 자리(아래쪽 다른 대화)에 남던 것 → 그 대화의 한 줄이 위에서 1/4 쯤에 보이게 맞춘다
    function alignRow(row) {
        const go = () => { if (!row.isConnected) return; const vv = window.visualViewport, vh = vv ? vv.height : window.innerHeight, vtop = vv ? vv.offsetTop : 0;
            const sc = row.closest('.is-full') || document.scrollingElement || document.documentElement;
            const bar = sc.querySelector ? sc.querySelector('.desk-fullbar') : null; const head = bar && sc.classList && sc.classList.contains('is-full') ? bar.getBoundingClientRect().height : 0;
            const d = row.getBoundingClientRect().top - (vtop + Math.max(head + 12, vh * 0.25));
            if (Math.abs(d) > 4) { if (sc === document.scrollingElement || sc === document.documentElement) window.scrollBy(0, d); else sc.scrollTop += d; } };
        go(); setTimeout(go, 120);
    }
    // 그 대화의 답 칸으로 옮겨 커서를 둔다(답 칸이 없는 대화면 대화 틀로만 옮긴다)
    function focusThread(box, noFocus) {
        if (!box) return;
        if (box.dataset && box.dataset.th && box.querySelector('.desk-follow-open')) {   // #653-다 ②: 접힌 답 칸이면 먼저 펼친다
            const th = box.dataset.th;
            S.boxOpen.add(Number(th)); renderList();
            box = document.querySelector('#desk-list .desk-thread-box[data-th="' + th + '"]');
            if (!box) return;
        }
        const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const ta = box.querySelector('.desk-turn.last .desk-reply-in');
        const target = ta ? (ta.closest('.desk-cbox') || ta) : box;
        // #545(대표 폰 실물 「잘 안 맞아」): 폰에서는 ①자판이 올라오며 보이는 화면이 줄고 ②위쪽 대화의 그림이 늦게 떠 자리가 밀리고 ③부드러운 스크롤이 2초 새로고침에 끊긴다
        //   → 「보이는 화면(visualViewport)」 기준으로 답 상자가 위에서 1/3 쯤에 오게 직접 맞추고, 자리가 잡힐 때까지 몇 번 다시 맞춘다(손을 대면 그만둔다)
        const align = () => {
            if (!target.isConnected) return;
            const vv = window.visualViewport, vh = vv ? vv.height : window.innerHeight, vtop = vv ? vv.offsetTop : 0;
            const sc = target.closest('.is-full') || document.scrollingElement || document.documentElement;
            const bar = sc.querySelector ? sc.querySelector('.desk-fullbar') : null;
            const head = bar && sc.classList && sc.classList.contains('is-full') ? bar.getBoundingClientRect().height : 0;
            const r = target.getBoundingClientRect();
            // #555(대표 폰 실물 10/6 「너무 위에 있다 — 키보드 바로 위로」): 답 상자를 보이는 화면의 맨 아래(자판 바로 위 · 12px 띄움)에 붙인다 → 위쪽에 앞 답이 더 많이 보인다. 상자가 화면보다 크면 머리 아래에 맞춘다
            const want = vtop + Math.max(head + 12, vh - r.height - 12);
            const d = r.top - want;
            if (Math.abs(d) > 4) { if (sc === document.scrollingElement || sc === document.documentElement) window.scrollBy(0, d); else sc.scrollTop += d; }
        };
        align();
        if (ta && !noFocus) ta.focus({ preventScroll: true });
        let stop = false; const cancel = () => { stop = true; };
        ['touchstart', 'wheel', 'keydown'].forEach(ev => window.addEventListener(ev, cancel, { once: true, passive: true, capture: true }));
        [250, 600, 1100, 1800].forEach(ms => setTimeout(() => { if (!stop) align(); }, ms));
        if (window.visualViewport) { const vv = window.visualViewport, on = () => { if (!stop) align(); }; vv.addEventListener('resize', on); setTimeout(() => vv.removeEventListener('resize', on), 2600); }   // 자판이 올라와 화면이 줄면 한 번 더
        void calm;
        box.classList.remove('desk-flash'); void box.offsetWidth; box.classList.add('desk-flash'); setTimeout(() => box.classList.remove('desk-flash'), 1600);
    }
    // 이력의 내 대화를 채팅 탭으로 다시 꺼낸다(숨겨 둔 차례만 되살림) → 그 대화로 옮겨 답 칸에 커서
    async function resumeChat(rootId, b) {
        let t = threadsOf(S.orders).find(x => x.id === rootId); const me = myId();
        if (!t || me == null || !t.items.every(o => o.created_by_id === me)) return;
        b.disabled = true;
        try {
            // #543: 검색 결과에서 누르면 맞은 차례만 받아져 있다 → 검색 없이 한 번 받아 그 대화의 차례를 전부 찾는다(일부만 되살리지 않게)
            if (S.hist.q) {
                const d = await api('/api/agent-office/desk/orders?history=1&limit=200');
                const known = new Set(S.orders.map(o => o.id));
                const all = S.orders.concat((d.orders || []).filter(o => !known.has(o.id)));
                const full = threadsOf(all).find(x => x.items.some(o => o.id === rootId));
                if (full && full.items.every(o => o.created_by_id === me)) t = full;
            }
            for (const it of t.items) if (it.mine_hidden) await api('/api/agent-office/orders/' + it.id + '/hide-mine', 'POST', { hide: false });
            t.items.forEach(o => S.pin.add(o.id));
            // #543(대표 폰 실물): 크게 보기(is-full)에서 눌러도 반드시 넘어가야 한다 → 크게 보기를 닫지 않고(뒤로 가기를 건드리지 않는다) 그 자리에서 탭만 바꾼다
            S.q.mine = ''; if (S.fs !== 'all') { S.fs = 'all'; $('desk-fs').value = 'all'; }
            await setTab('mine');
            const find = () => document.querySelector('#desk-list [data-oid="' + t.last + '"]');
            let el = find();
            if (!el) { S.mineLimit = 200; S.sig = ''; await loadOrders(true); el = find(); }   // 채팅 탭 60건 밖이면 한 번 더 넉넉히 받는다
            if (!el) { showToast('채팅 탭으로 옮겼어요'); return; }
            focusThread(el.closest('.desk-thread-box') || el);
        } catch (err) { showToast(err && err.message ? err.message : '다시 꺼내지 못했어요'); b.disabled = false; }
    }

    // #476 첫 화면에는 몇 건만(칸이 끝없이 길어지지 않게) — 나머지는 [자세히 확인하기]로. 답해야 하는 건은 늘 보인다
    function previewMask(list) {
        let shownN = 0;
        return list.map(o => {
            if (S.qOn || NEEDS.includes(o.status) || S.pin.has(o.id)) return false;   // #576 알림에서 찾아온 줄(pin)은 접지 않는다
            shownN++;
            return shownN > PREVIEW_LIST;
        });
    }

    // 넓은 화면 표 보기 — ⋯ 을 누르면 그 아래에 자세한 내용이 펼쳐진다
    // 되묻기·승인 대기는 사람이 답해야 하는 행이라 표에서도 저절로 펼쳐 둔다(대표 확인 9/29 — PC에서 답 칸이 안 보이던 것)
    const NEEDS = ['질문', '승인대기'];
    function renderTable(list, ov) {
        ov = ov || [];
        const rows = list.map((o, i) => {
            const b = BADGE[o.status] || ['wait', o.status];
            const open = S.detail.has(o.id) || S.follow.has(o.id) || (NEEDS.includes(o.status) && !S.closed.has(o.id));
            const canHide = S.tab === 'mine' && !ACTIVE.includes(o.status) && !['판독완료', '확인표작성', '승인대기'].includes(o.status);
            const oc = ov[i] ? ' ov' : '';
            return `<tr class="row clickable${oc}${open ? ' opened' : ''}" data-oid="${o.id}" title="${open ? '접기' : '눌러서 답변 보기'}">
                <td><span class="desk-badge" data-k="${b[0]}">${esc(b[1])}</span></td>
                <td class="c-id">${o.id}번${o.reply_to ? `<br><small class="desk-thread">↳ ${Number(o.reply_to)}번에 이어서</small>` : ''}<br><small>${esc(kst(o.created_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</small></td>
                <td class="c-q">${esc(String(o.content || '').slice(0, 120))}${o.has_image ? ' <small>(이미지)</small>' : ''}</td>
                <td class="c-r">${resultLine(o)}</td>
                <td class="c-by">${esc(o.created_by || '')}</td>
                <td class="c-x"><button type="button" class="desk-more" data-act="detail" data-id="${o.id}" aria-expanded="${open}" aria-label="${o.id}번 자세히">${open ? '▴' : '⋯'}</button></td>
            </tr>${open ? `<tr class="detailrow${oc}"><td class="detail" colspan="6"><div class="desk-q-full"><div class="desk-a-label">지시 내용</div>${esc(o.content || '')}${o.has_image ? ' <small>(이미지 첨부)</small>' : ''}</div>${resultHtml(o, true)}${canHide ? `<div class="desk-acts"><button type="button" class="desk-btn sm" data-act="hide" data-id="${o.id}">채팅 종료</button></div>` : ''}</td></tr>` : ''}`;
        }).join('');
        $('desk-list').innerHTML = `<div class="table-scroll-wrapper"><table class="desk-table"><thead><tr>
            <th>상태</th><th>번호 · 시각</th><th>지시 내용</th><th>결과</th><th>보낸 사람</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    async function onListClick(e) {
        let b = e.target.closest('button[data-act], img[data-act="zoom"]');
        if (!b) {
            // #484: 표의 줄(번호·지시 내용·결과 …)을 눌러도 자세히가 열린다 — 버튼·입력칸·링크·글자 드래그는 제외
            const tr = e.target.closest('tr.row');
            if (e.target.closest('button, input, textarea, select, a, img, video, summary, label')) return;
            const sel = window.getSelection && window.getSelection();
            if (sel && String(sel).length) return;
            // #543: 채팅 탭 — 대화 머리 줄이나 빈 곳을 누르면 그 대화의 답 칸으로 / 이력 탭 — 펼친 대화의 본문을 누르면 접힌다
            const hb = e.target.closest('.desk-h-body');
            if (hb) { const it = hb.closest('.desk-h-item'); if (it) { S.hist.open.delete(Number(it.dataset.th)); renderList(); const row = document.querySelector('#desk-list .desk-h-item[data-th="' + it.dataset.th + '"] .desk-h-row'); if (row) { row.focus({ preventScroll: true }); alignRow(row); } } return; }   // #547: 접은 뒤에는 그 줄(처음 눌렀던 자리)이 보이게
            const tb = chatMine() ? e.target.closest('.desk-thread-box') : null;
            if (tb && !e.target.closest('.desk-cbox, .desk-end-ask, .desk-media')) { focusThread(tb); return; }   // #546(대표 10/5): 대화 어디를 눌러도(답변 글 포함) 맨 아래 답 칸으로 — 버튼·링크·그림·글자 고르는 중·답 상자 안은 제외
            if (!tr) return;
            b = tr.querySelector('.desk-more[data-act="detail"]');
            if (!b) return;
        }
        const id = Number(b.dataset.id), act = b.dataset.act;
        if (act === 'zoom') { if (b.src) zoomMedia(b.src, b.alt); return; }
        const o = S.orders.find(x => x.id === id);
        if (!o) return;
        if (act === 'toggle') { if (S.open.has(id)) S.open.delete(id); else S.open.add(id); renderList(); return; }
        if (act === 'detail') {
            const auto = ['질문', '승인대기'].includes(o.status);
            const nowOpen = S.detail.has(id) || (auto && !S.closed.has(id));
            if (nowOpen) { S.detail.delete(id); if (auto) S.closed.add(id); }
            else { S.detail.add(id); S.closed.delete(id); }
            renderList(); return;
        }
        if (act === 'copy' || act === 'copytop') {   // #586(대표 10/8 「위에가 좋은데」): 답 맨 위 오른쪽 [복사]도 같은 동작(맨 아래 [답변 복사]는 그대로)
            const text = (o.result && (o.result.answer || o.result.text)) || '';
            const acts = b.closest('.desk-a-acts'), shown = act === 'copytop' ? b.closest('.desk-a') : (acts ? acts.parentElement.querySelector('.desk-a') : null);   // #584: 막히면 골라 둘 글(접힌 이력 줄의 [복사]는 화면에 글이 없어 안내만)
            await copyText(text, '답변을 복사했어요', shown);
            return;
        }
        if (act === 'copysec') {   // #552 그 묶음의 본문만
            const a = answerSecs((o.result && (o.result.answer || o.result.text)) || ''), sec = a && a.secs[Number(b.dataset.sec)];
            const secEl = b.closest('.desk-sec'), shown = secEl ? secEl.querySelector('.desk-sec-body') : null;
            if (sec) await copyText(sec.body, `${sec.title}를 복사했어요`.replace(/([가-힣])를 복사/, (m, c) => ((c.charCodeAt(0) - 0xAC00) % 28 ? c + '을 복사' : c + '를 복사')), shown);
            return;
        }
        if (act === 'confirm') { openConfirm(o.result); return; }
        if (act === 'file') {
            if (typeof aoDownloadFile !== 'function') { showToast('내려받기 기능을 찾지 못했어요. 새로고침 후 다시 눌러 주세요'); return; }
            b.disabled = true;
            try { await aoDownloadFile(Number(b.dataset.file)); } finally { b.disabled = false; }
            return;
        }
        if (act === 'openbox') { focusThread(document.querySelector('#desk-list .desk-thread-box[data-th="' + id + '"]')); return; }
        if (act === 'endchat') { S.endAsk = id; renderList(); const y = document.querySelector('#desk-list .desk-end-ask [data-act="hidethread"]'); if (y) y.focus(); return; }
        if (act === 'endno') { S.endAsk = 0; renderList(); return; }
        if (act === 'histopen') { S.hist.delAsk = 0; if (S.hist.open.has(id)) S.hist.open.delete(id); else S.hist.open.add(id); renderList(); return; }
        if (act === 'histdel') { return histDelete(id, b); }
        if (act === 'histmore') { return histMore(b); }
        if (act === 'resume') { return resumeChat(id, b); }
        if (act === 'hidethread') {
            const t = threadsOf(S.orders).find(x => x.id === id);
            if (!t) return;
            b.disabled = true;
            try {
                let asked = 0;
                for (const it of t.items) { if (it.status === '질문') { await api('/api/agent-office/orders/' + it.id + '/close', 'POST'); it.status = '질문종결'; asked++; } await api('/api/agent-office/orders/' + it.id + '/hide-mine', 'POST', { hide: true }); }
                const gone = new Set(t.items.map(x => x.id));
                S.orders = S.orders.filter(x => !gone.has(x.id)); S.sig = ''; S.endAsk = 0; renderList();
                showToast(asked ? '채팅을 종료했어요(전체 지시에는 남아 있어요)' : '채팅을 종료했어요 · 이전 채팅 이력에서 다시 볼 수 있어요');
            } catch (err) { showToast(err && err.message ? err.message : '종료하지 못했어요'); S.sig = ''; S.endAsk = 0; loadOrders(true); }
            return;
        }
        if (act === 'hide') {
            b.disabled = true;
            try {
                if (o.status === '질문') { await api('/api/agent-office/orders/' + id + '/close', 'POST'); o.status = '질문종결'; }   // #605
                await api('/api/agent-office/orders/' + id + '/hide-mine', 'POST', { hide: true });
                S.orders = S.orders.filter(x => x.id !== id); S.sig = ''; renderList();
                showToast('채팅을 종료했어요 · 이전 채팅 이력에서 다시 볼 수 있어요');
            } catch (err) { showToast(err && err.message ? err.message : '종료하지 못했어요'); b.disabled = false; }
            return;
        }
        if (act === 'replyimg') { S.replyTarget = id; $('desk-reply-file').click(); return; }
        if (act === 'replyimgx') { S.replyImg.delete(id); S.sig = ''; renderList(); return; }
        if (act === 'follow') {
            if (S.follow.has(id)) S.follow.delete(id); else S.follow.add(id);
            renderList();
            const ta = document.getElementById('reply-' + id); if (ta) ta.focus();
            return;
        }
        if (act === 'sendreply') {
            const ta = document.getElementById('reply-' + id);
            const text = ta ? ta.value.trim() : '';
            const im = S.replyImg.get(id);
            if (!text && !im) { if (ta) ta.focus(); return; }
            const icon = b.classList.contains('desk-cbtn'), label0 = b.textContent; b.disabled = true; if (icon) b.setAttribute('aria-busy', 'true'); else b.textContent = '보내는 중';
            try {
                const res = await api('/api/agent-office/orders/' + id + '/reply', 'POST', im ? (im.file ? { content: text, image_data: im.data, image_mime: im.mime, file_name: im.name } : { content: text, image_data: im.data, image_mime: im.mime }) : { content: text });
                S.replyImg.delete(id);
                showToast(res.message || '답을 보냈어요');
                S.follow.delete(id);
                S.sig = ''; await loadOrders(true);
                if (res.order && res.order.id) revealOrders([res.order.id]);
            } catch (err) { showToast(err && err.message ? err.message : '보내지 못했어요'); b.disabled = false; if (icon) b.removeAttribute('aria-busy'); else b.textContent = label0; }
            return;
        }
        if (act === 'plango') {   // #598: 글 칸·붙인 이미지와 무관하게 고정 글만 보낸다
            const label0 = b.textContent; b.disabled = true; b.textContent = '보내는 중';
            try {
                const res = await api('/api/agent-office/orders/' + id + '/reply', 'POST', { content: PLAN_GO });
                showToast(res.message || '이대로 진행할게요');
                S.follow.delete(id);
                S.sig = ''; await loadOrders(true);
                if (res.order && res.order.id) revealOrders([res.order.id]);
            } catch (err) { showToast(err && err.message ? err.message : '보내지 못했어요'); b.disabled = false; b.textContent = label0; }
            return;
        }
        if (act === 'reply') { closeFull(); const i = $('desk-input'); i.focus(); i.scrollIntoView({ block: 'center' }); return; }
        if (act === 'approve' || act === 'reject') {   // #499 한 번 더 확인은 카드 안에서(브라우저 기본 창 대신)
            S.pend.set(id, act); renderList();
            if (act === 'reject') { const ta = document.getElementById('reject-' + id); if (ta) ta.focus(); }
            return;
        }
        if (act === 'pendcancel') { S.pend.delete(id); renderList(); return; }
        if (act === 'approve2' || act === 'reject2' || act === 'retry') {
            let body;
            if (act === 'reject2') { const ta = document.getElementById('reject-' + id); body = { reason: ta ? ta.value.trim() : '' }; }
            b.disabled = true;
            try {
                const path = act === 'retry' ? 'process' : act === 'approve2' ? 'approve' : 'reject';
                S.pend.delete(id);
                const res = await api('/api/agent-office/orders/' + id + '/' + path, 'POST', body);
                showToast(res.message || '처리했어요');
                await Promise.all([loadOrders(true), loadStatus()]);
            } catch (err) { showToast(err && err.message ? err.message : '처리하지 못했어요'); b.disabled = false; }
        }
    }

    // #661(대표 10/12 「2곳이 정확히 같아야 해 · 문자도 들어가게 · 누르면 그 해당 칸으로 · 간단하게 볼 수만 있게」) 손님 연락 카드
    //   = 문자·톡톡·상품 Q&A·주문 문의 전체 대화를 최근 대화순 한 목록으로(네이버 톡톡상담관리 「전체」처럼). 칩 숫자 = 대기(답 안 한 것 · 서버 counts.{ch}.open 그대로 = 손님 연락 창의 [답 안 한 것만 n])
    //   줄 = 채널 · 손님 · 마지막 글 한 줄(우리가 마지막이면 「나:」) · 시각. 대기 줄 = 점 + 굵게 + [확인] · 확인한 줄 = [확인함](다시 누르면 대기로) · 답한 줄은 흐리게. 줄을 누르면 손님 연락 창의 그 대화로
    //   서버: GET /api/agent-office/desk/inbox → { days, sms[]|null, talk[], qna[], inquiry[], counts, more } · POST …/desk/inbox/review { kind, id, undo }(창의 [확인]과 같은 표식)
    // #663(대표 10/12 「메인에서는 미처리 건만 · 누르면 창으로 가니까 메인은 확인만 · 색 다르게 구별되게」): 이 카드 목록 = 대기(needs_reply) 줄만. 전체 대화는 손님 연락 창에서(창은 그대로).
    //   [확인]을 누르면 줄이 카드에서 빠진다(되돌리기는 창의 그 대화에서) · 「n건 더」 = 서버 대기 수(counts.open) 중 여기 못 실은 것 · 채널 배지·칩 점은 채널마다 다른 색(--d-ch-*)
    const CU_KINDS = ['sms', 'talk', 'qna', 'inquiry'], CU_NAME = { sms: '문자', talk: '톡톡', qna: '상품문의', inquiry: '주문문의' }   /* #673: 손님 연락 창 탭 이름과 같게(종전 상품 Q&A · 주문 문의) */;
    async function loadInbox() {
        try { S.inbox = await api('/api/agent-office/desk/inbox'); S.inboxAt = Date.now(); renderInbox(); }
        catch (e) { const box = $('desk-inbox-list'); if (box && !S.inbox) box.innerHTML = '<div class="desk-empty">손님 연락 현황을 읽지 못했어요. 잠시 뒤 다시 열어 주세요.</div>'; }
    }
    function cuOpen(kind, id) {
        if (kind === 'sms') { if (id) smsOpenById(Number(id)); else smsOpen(); return; }
        if (!kind) { inbOpenFirst(); return; }
        if (inbOk()) { inbOpen(kind, id || undefined); return; }
        if (S.full) closeFull();
        if (typeof switchPage === 'function') switchPage('inquiry');   // 손님 연락 창이 없는 서버·옛 캐시면 종전 문의 관리로
    }
    function cuRow(x, i) {
        const sms = x.kind === 'sms', out = x.last_dir === 'out';
        const who = sms ? smsNo(x) : String(x.title || CU_NAME[x.kind] + ' 손님'), sub = String(sms ? (x.customer_hint || '') : (x.sub || x.item || ''));
        const text = String(x.last_text || (sms ? (out ? x.last_out_text : x.last_in_text) : x.question) || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        const at = x.last_at || x.at, oid = sms ? x.id : x.kind === 'talk' ? (x.tkey || '') : x.id;
        return `<div class="desk-cu wait${i >= PREVIEW_INBOX ? ' ov' : ''}" data-kind="${x.kind}" data-id="${esc(x.id)}">`
            + `<button type="button" class="desk-cu-row" data-ib="open" data-open="${esc(oid == null ? '' : oid)}" title="눌러서 이 대화 열기">`
            + `<i class="desk-cu-ch" data-ch="${x.kind}">${CU_NAME[x.kind]}</i>`
            + `<span class="desk-cu-who"><b>${esc(who)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>`
            + `<time class="desk-cu-at">${esc(at ? smsWhen(at) : '')}</time>`
            + `<span class="desk-cu-last">${out ? '<b class="sms-me">나:</b> ' : ''}${esc(text || '(글 없음)')}</span></button>`
            + (sms ? '' : '<button type="button" class="desk-btn sm primary desk-cu-ok" data-ib="ok" title="답할 필요가 없는 글이면 눌러서 대기에서 빼요">확인</button>')
            + '</div>';
    }
    function renderInbox() {
        const d = S.inbox, box = $('desk-inbox-list');
        if (!d || !box) return;
        const hasSms = Array.isArray(d.sms);
        if (S.inboxKind === 'sms' && !hasSms) S.inboxKind = 'all';
        CU_KINDS.forEach(k => {
            const n = $('inbox-n-' + k), c = d.counts && d.counts[k], v = c ? (Number(c.open) || 0) : null;
            if (n) { n.textContent = v == null ? '?' : (v > 99 ? '99+' : String(v)); n.className = v ? 'on' : ''; if (k === 'sms') n.parentNode.hidden = !hasSms; }
        });
        document.querySelectorAll('#desk-inbox-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.k === S.inboxKind)));
        const kinds = S.inboxKind === 'all' ? CU_KINDS : [S.inboxKind];
        let html;
        if (S.inboxKind !== 'all' && !Array.isArray(d[S.inboxKind])) { html = '<div class="desk-empty">이 채널은 지금 읽지 못했어요.</div>'; setMore('desk-inbox-more', 0); }
        else {
            const list = [].concat(...kinds.map(k => Array.isArray(d[k]) ? d[k].filter(x => x && x.needs_reply).map(x => Object.assign({}, x, { kind: k })) : []));   // #663 대기 줄만
            list.sort((a, b) => (tms(b.last_at || b.at) || 0) - (tms(a.last_at || a.at) || 0));   // 최근 대화순(채널별 시각 글 꼴이 달라 Date 로 견준다)
            const open = kinds.reduce((n, k) => n + (Array.isArray(d[k]) ? Number(d.counts && d.counts[k] && d.counts[k].open) || 0 : 0), 0), more = Math.max(0, open - list.length);   // 못 실은 대기 = 서버 대기 수 − 받은 대기 줄
            setMore('desk-inbox-more', Math.max(0, list.length - PREVIEW_INBOX) + more);
            html = (list.length || more) ? list.map(cuRow).join('') + (more > 0 ? `<button type="button" class="desk-cu-morewin${list.length >= PREVIEW_INBOX ? ' ov' : ''}" data-ib="win">여기에 못 실은 미처리 ${nfmt(more)}건 더 · 손님 연락 창에서 보기</button>` : '')
                : `<div class="desk-empty desk-cu-none">${S.inboxKind === 'all' ? '미처리 손님 연락이 없어요.' : esc(CU_NAME[S.inboxKind]) + ' 미처리 건이 없어요.'} <button type="button" class="desk-cu-link" data-ib="win">손님 연락 창 열기</button></div>`;
        }
        { const mb = $('desk-inbox-more'); if (mb) mb.hidden = html.indexOf('desk-cu-none') >= 0; }   // #673: 빈 상태 = 링크 하나만(같은 곳으로 가는 줄을 둘 두지 않는다)
        if (box.dataset.sig === html) return;   // 주기마다 다시 그리지 않는다(누르던 초점 유지)
        const had = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#desk-inbox-list .desk-cu') : null, hk = had ? [had.dataset.kind, had.dataset.id, document.activeElement.classList.contains('desk-cu-ok')] : null;
        box.dataset.sig = html; box.innerHTML = html;
        if (hk) { const el = Array.from(box.querySelectorAll('.desk-cu')).find(r => r.dataset.kind === hk[0] && r.dataset.id === hk[1]); const t = el && (hk[2] ? el.querySelector('.desk-cu-ok') : null) || (el && el.querySelector('.desk-cu-row')); if (t) t.focus({ preventScroll: true }); }
    }

    function boardSoon() { if (S.board && Date.now() - (S.boardAt || 0) > 1500) loadBoard(); }   // #676 손님 연락 창에서 처리한 것이 「봇 실패」 줄에 바로(잇단 호출은 1.5초에 한 번)
    async function loadBoard() {
        try { S.board = await api('/api/agent-office/desk/board'); S.boardAt = Date.now(); renderBoard(); } catch (e) { /* 다음 주기에 다시 */ }
    }
    // #633(대표 10/11): 봇이 답을 못 낸 건 한 줄
    // #676(대표 10/12 폴드 실물 「문의 관리로 가는데 어떤 건인지 모르겠고 · 없애는 법도 모르겠고 · 뒤로가기로 못 돌아옴」): 알약은 다른 메뉴로 보내지 않고 손님 연락 창의 그 대화로
    //   서버가 대상 목록(talk_ids · sms_ids)을 주면 1건 = 바로 그 대화 · 여러 건 = 그 탭의 미처리 목록(톡톡 [미처리] 켬 · 문자 「직원 확인만」). 거기서 [확인]/[처리함]/답 보내기로 처리하면 줄 숫자도 같이 준다
    //   손님 연락 창이 없는 옛 서버에서만 종전대로 문의 관리 메뉴로
    function botFailHtml(t) {
        const tk = Number(t.talk) || 0, sm = Number(t.sms) || 0;
        return `<li class="bot-fail"><span>봇 실패</span><b>${nfmt(tk + sm)}건</b><small>`
            + (tk > 0 ? `<button type="button" class="bf-go" data-bf="talk">톡톡 ${nfmt(tk)}</button>` : '')
            + (sm > 0 ? `<button type="button" class="bf-go" data-bf="sms">문자 ${nfmt(sm)}</button>` : '')
            + `<i>봇이 답을 못 낸 건 · 누르면 그 대화로</i></small></li>`;
    }
    const bfIds = v => Array.isArray(v) ? v.map(x => x && typeof x === 'object' ? x.id : x).filter(x => x != null && x !== '').map(String) : [];
    function botFailGo(k) {
        const t = ((S.board && S.board.todo) || []).find(x => x && x.key === 'botfail') || {};
        if (k === 'sms') {
            const ids = bfIds(t.sms_ids);
            if (ids.length === 1 && (Number(t.sms) || 0) === 1 && Number(ids[0]) > 0) { smsOpenById(Number(ids[0])).then(ok => { if (!ok && !document.body.classList.contains('sms-win-open')) smsStaffOnly(true); }); return; }
            smsStaffOnly(true); return;   // 전체 화면이 떠 있으면 smsStaffOnly 가 닫힘을 기다린 뒤 연다
        }
        if (inbOk()) {
            const ids = bfIds(t.talk_ids);
            if (ids.length === 1 && (Number(t.talk) || 0) === 1) { inbOpen('talk', ids[0]); return; }   // ids 는 최근 10건까지만 온다 — 전체 수(talk)가 1일 때만 바로 그 대화
            try { localStorage.setItem('akm_inb_only_open_talk', '1'); } catch (e) { /* 못 적으면 전체 목록 */ }   // ao-inbox.js 의 [미처리] 기억과 같은 열쇠 — 그 탭을 미처리만으로 연다
            if (INB.ch === 'talk') { const a = inbApi(); try { if (a) a.unmount(); } catch (e) { /* 다시 그린다 */ } INB.ch = 'sms'; }   // 이미 톡톡 탭을 보던 중이면 새로 그려야 [미처리]가 먹는다
            inbOpen('talk'); return;
        }
        if (S.full) closeFull();   // #635: 상태 칸이 없어져 「직원 확인이 필요한 대화만」(needs_staff)으로 연다 — [이전 대화 보기]·찾기를 누르면 풀린다
        const nav = document.querySelector('.nav-item[data-page="inquiry"]');
        if (nav) { nav.click(); setTimeout(() => { try { if (typeof switchInquiryTab === 'function') switchInquiryTab('unanswered'); } catch (e) { /* 메뉴만 열려도 된다 */ } }, 0); }   // 문의 관리의 「톡톡 문의」 탭까지
    }
    // #666(대표 10/12 「지금 챙길 일을 밑으로 — 원래 있던 자리에」): #653-다에서 위(PC 오른쪽 칸 맨 위 · 좁은 폭 채팅 목록 앞)로 올렸던 것을 되돌림
    //   = 현황판 셋째 칸(채널별 주문 · 최근 7일 발송 박스 다음). 현황판을 다시 그릴 때마다 같이 그려지므로 누름은 현황판(#desk-board)에 한 번만 건다. 좁은 폭의 「N건 더 보기」 접기는 없앰(전부 보임)
    const todoPr = t => t.key === 'botfail' ? 0 : t.key === 'remind' && (t.when || '오늘') === '오늘' ? 1 : 2;   // 봇 실패 · 오늘 일정 알림은 맨 앞
    function todoBind() {
        const box = $('desk-board');
        if (!box) return;
        box.addEventListener('click', e => {
            if (!e.target.closest('#desk-todo-box')) return;
            const cu = e.target.closest('.cu-go'); if (cu) { if (cu.dataset.cu === 'sms') smsOpen('active'); else inbOpen(cu.dataset.cu); return; }
            const bf = e.target.closest('.bf-go'); if (bf) { botFailGo(bf.dataset.bf); return; }
            const li = e.target.closest('.sms-todo'); if (li) { if (li.dataset.sms === 'cust') inbOpenFirst(); else smsOpen(li.dataset.sms === 'active' ? 'active' : undefined); }
        });
        box.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('sms-todo') && e.target.closest('#desk-todo-box')) { e.preventDefault(); e.target.click(); } });
    }
    function renderBoard() {
        const d = S.board, box = $('desk-board');
        if (!d || !box) return;
        const chName = { naver: '스마트스토어', mall: '자사몰', coupang: '쿠팡' };
        let chHtml = '<div class="desk-empty">주문 기록을 읽지 못했어요</div>';
        if (Array.isArray(d.channels)) {
            const by = {}; d.channels.forEach(c => { by[c.ch] = c; });
            let t = 0, y = 0;
            const rows = ['naver', 'mall', 'coupang'].map(k => { const c = by[k] || { today: 0, yesterday: 0 }; t += c.today; y += c.yesterday; return `<span>${chName[k]}</span><b>${c.today}</b><em>어제 ${c.yesterday}</em>`; }).join('');
            chHtml = `<div class="desk-ch">${rows}<span class="sum">합계</span><b class="sum">${t}</b><em class="sum">어제 ${y}</em></div>`;
        }
        let shipHtml = '<div class="desk-empty">발송 기록을 읽지 못했어요</div>';
        if (Array.isArray(d.ship)) {
            const days = [];
            const base = new Date(Date.now() + 9 * 3600 * 1000);
            for (let i = 6; i >= 0; i--) { const x = new Date(base.getTime() - i * 86400000); days.push(x.toISOString().slice(0, 10)); }
            const sum = {}; d.ship.forEach(r => { sum[r.d] = (sum[r.d] || 0) + (r.boxes || 0); });
            const max = Math.max(1, ...days.map(k => sum[k] || 0));
            shipHtml = `<div class="desk-bars">${days.map(k => { const v = sum[k] || 0; return `<div class="desk-bar"><b>${v ? v.toLocaleString('ko-KR') : ''}</b><i class="${v ? '' : 'zero'}" style="height:${v ? Math.max(4, Math.round(v / max * 60)) : 2}px"></i><span>${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}</span></div>`; }).join('')}</div>`;
        }
        let todoHtml = '<div class="desk-empty">할 일 목록을 읽지 못했어요</div>';
        const smsLi = smsTodoHtml();   // #610-E: 문자 답할 것 · 회사폰 연결 끊김(서버 목록과 따로 · 문자 요약에서)
        if (!Array.isArray(d.todo) && smsLi) todoHtml = `<ul class="desk-todo">${smsLi}</ul>`;
        if (Array.isArray(d.todo)) {
            todoHtml = d.todo.length || smsLi
                ? `<ul class="desk-todo">${smsLi}${d.todo.slice().sort((a, b) => todoPr(a) - todoPr(b)).map(t => t.key === 'botfail' ? botFailHtml(t) : `<li${todoPr(t) === 1 ? ' class="pin"' : ''}><span>${esc(t.label)}</span><b>${t.key === 'remind' ? esc(t.when || '오늘') : t.key === 'owner' ? esc(t.when || '확인') : t.key === 'pricing' ? '확인' : t.count + '건'}</b><small>${esc(t.where)}</small></li>`).join('')}</ul>`
                : '<div class="desk-empty">지금 챙길 일이 없어요.</div>';
        }
        const todoN = (todoHtml.match(/<li[\s>]/g) || []).length;
        let salesHtml = '';
        if (d.is_admin && Array.isArray(d.sales)) {
            salesHtml = `<div class="desk-panel"><h3>네이버 정산 회차별 결제금액 <span>대표만 보임</span></h3>${d.sales.length
                ? `<div class="desk-sales">${d.sales.map(s => `<span>${Number(s.d.slice(5, 7))}/${Number(s.d.slice(8, 10))} 입금</span><span>${s.orders || 0}건</span><b>${won(s.pay)}원</b>`).join('')}</div>`
                : '<div class="desk-empty">정산 회차 기록이 없어요.</div>'}</div>`;
        }
        box.innerHTML = `
            <div class="desk-panel"><h3>채널별 주문 <span>오늘 · 주문 안내 기준</span></h3>${chHtml}</div>
            <div class="desk-panel"><h3>최근 7일 발송 박스 <span>정산관리 입력 기준</span></h3>${shipHtml}</div>
            <div class="desk-panel desk-todo-box${todoN ? '' : ' none'}" id="desk-todo-box" aria-label="지금 챙길 일"><h3>지금 챙길 일 <span id="desk-todo-n">${todoN ? todoN + '건' : ''}</span></h3><div id="desk-todo">${todoHtml}</div></div>
            ${salesHtml}`;
        renderSide(d);
    }

    // #472 오른쪽 칸 — LIVE 로그(보는 사람 본인 지시만 · 대표 확정) · 오늘 일정 · 주요 업무 현황
    function renderSide(d) {
        const live = $('desk-live'), today = $('desk-today'), prog = $('desk-prog');
        if (live) {
            const dot = st => ['오류', '오류확인', '반려'].includes(st) ? 'err' : ['질문', '승인대기'].includes(st) ? 'warn' : 'ok';
            live.innerHTML = Array.isArray(d.live) && d.live.length
                ? `<ul class="desk-live">${d.live.map(x => `<li><time>${esc(liveWhen(x.processed_at))}</time><i class="${dot(x.status)}"></i><p>${esc(x.text || '')}</p></li>`).join('')}</ul>`
                : '<div class="desk-empty">아직 처리된 내 채팅이 없어요.</div>';
        }
        if (today) {
            const n = $('desk-today-n');
            const list = Array.isArray(d.today) ? d.today : [];
            if (n) n.textContent = list.length ? list.filter(x => x.is_completed).length + ' / ' + list.length + ' 완료' : '';
            today.innerHTML = list.length
                ? `<ul class="desk-sch">${list.map(x => `<li class="${x.is_completed ? 'done' : ''}"><span class="mk">✓</span><div>${esc(x.title || '')}<small>${esc([x.start_time ? String(x.start_time).slice(0, 5) : '', x.category || '', x.user_name || ''].filter(Boolean).join(' · '))}</small></div></li>`).join('')}</ul>`
                : '<div class="desk-empty">오늘 등록된 일정이 없어요.</div>';
        }
        if (prog) {
            const list = Array.isArray(d.progress) ? d.progress : [];
            prog.innerHTML = list.length
                ? `<ul class="desk-prog">${list.map(x => {
                    const pct = x.total ? Math.round(x.done / x.total * 100) : 0;
                    return `<li data-k="${esc(x.key)}" title="${esc(x.note || '')}"><span>${esc(x.label)}</span><span class="track"><i style="width:${pct}%"></i></span><em>${x.done} / ${x.total}</em></li>`;
                }).join('')}</ul>`
                : '<div class="desk-empty">집계를 읽지 못했어요.</div>';
        }
    }

    function clock() {
        const now = new Date();
        const c = $('desk-clock'), d = $('desk-date');
        if (!c) return;
        const hm = now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
        const ss = now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', second: '2-digit' }).replace(/\D/g, '').padStart(2, '0');
        c.innerHTML = `${esc(hm)}<small>${esc(ss)}</small>`;
        d.textContent = now.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    }

    function tick() {
        if (S.full && !pageActive()) closeFull();
        if (!pageActive() && document.body.classList.contains('sms-win-open')) smsCloseCard();   // 다른 메뉴로 넘어갔으면 문자 창을 걷는다(스크롤 잠금이 남지 않게)
        if (!pageActive()) hbLeave();
        if (!S.mounted || !pageActive()) return;
        S.tick++;
        clock();
        if (document.hidden) return;
        const hasActive = S.orders.some(o => ACTIVE.includes(o.status) || o.status === '판독완료' || o.status === '확인표작성');
        tickElapsed();
        // #580: 진행 중이면 1초마다(종전 2초) — 앞 요청이 아직 안 끝났으면 건너뛴다(겹쳐 쌓이지 않게) · 없으면 12초 그대로
        if (hasActive ? !S.loading : S.tick % 12 === 0) loadOrders(false);
        if (S.tick % 10 === 0) loadStatus();
        if (Date.now() - S.boardAt > 60000) { S.boardAt = Date.now(); loadBoard(); }
        if (Date.now() - S.inboxAt > 30000) { S.inboxAt = Date.now(); loadInbox(); }
        smsTick();   // #610-E 문자 — 새 폴링 없이 이 tick 에 얹는다
    }

    // #568(대표 10/6) 야간 화면 — 사람(기기)마다 기억 · 기기 다크모드 설정은 따르지 않는다 (범위는 아래 #569 DARK_PAGES)
    //   켜짐 표시 = <html data-ao-theme="dark">(색은 전부 ao-desk.css 의 그 속성 아래) · 다른 메뉴로 가면 뗀다(page active 클래스 관찰 — app.js 무접촉)
    const THEME_KEY = 'akm_ao_theme';
    const ICON_MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    const ICON_SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    let themeOn = (() => { try { return localStorage.getItem(THEME_KEY) === 'dark'; } catch (e) { return false; } })();
    // #569(대표 10/6 밤) 야간 화면을 모든 메뉴로 — 「끝난 메뉴 목록」에 든 메뉴를 보고 있을 때만 속성이 붙는다(목록 밖 메뉴는 켠 사람에게도 종전 밝은 화면)
    //   색은 ao-dark.css(생성물 · scripts/ao-dark) · 에이전트 오피스는 ao-desk.css #568 블록. 묶음이 검증을 통과할 때마다 여기에 이름만 넣는다.
    const DARK_PAGES = ['agent-office', 'schedule', 'worklog', 'planner', 'rankings', 'myinfo', 'inquiry', 'settlement', 'pricing', 'inventory', 'document', 'expense', 'data', 'organizer', 'invoice', 'event'];
    const curPage = () => { const p = document.querySelector('.main-content > .page.active, .page.active'); return p ? p.id.replace(/^page-/, '') : ''; };
    const loginShown = () => { const l = $('login-page'); return !!l && l.style.display !== 'none'; };
    const inScope = () => DARK_PAGES.includes(curPage());
    function applyTheme() {
        const root = document.documentElement;
        if (themeOn && inScope() && !loginShown()) root.setAttribute('data-ao-theme', 'dark'); else root.removeAttribute('data-ao-theme');
        const label = themeOn ? '밝은 화면으로 바꾸기' : '야간 화면으로 바꾸기';
        for (const b of [$('desk-theme'), $('side-theme')]) {
            if (!b) continue;
            b.setAttribute('aria-pressed', String(themeOn)); b.setAttribute('aria-label', label); b.title = label;
            if (b.dataset.on !== String(themeOn)) { b.dataset.on = String(themeOn); b.innerHTML = themeOn ? ICON_SUN : ICON_MOON; }
        }
        const sb = $('side-theme');
        if (sb) { const off = !inScope(); sb.classList.toggle('off-scope', off); if (off) sb.title = label + ' (이 화면은 아직 밝은 화면만 돼요)'; }
    }
    function setTheme(on) {
        themeOn = !!on;
        try { localStorage.setItem(THEME_KEY, themeOn ? 'dark' : 'light'); } catch (e) { /* 기억 못 해도 이번 화면에는 적용 */ }
        applyTheme();
        try { document.dispatchEvent(new CustomEvent('akm-ao-theme', { detail: { dark: themeOn } })); } catch (e) { /* 알림 없이도 속성으로 동작 */ }
    }
    window.AkmAoTheme = { isDark: () => themeOn, set: setTheme, toggle: () => setTheme(!themeOn), pages: () => DARK_PAGES.slice() };
    // 왼쪽 메뉴 아래(사용자 이름 줄 오른쪽 끝)의 전환 버튼 — 모든 메뉴·폰 메뉴에서 닿는다. index.html 무수정(여기서 만들어 붙인다)
    function mountSideTheme() {
        const row = document.querySelector('.sidebar-footer .user-info');
        if (!row || $('side-theme')) return;
        const b = document.createElement('button');
        b.type = 'button'; b.id = 'side-theme'; b.className = 'side-theme';
        b.addEventListener('click', () => {
            setTheme(!themeOn);
            if (themeOn && !inScope()) { try { if (typeof showToast === 'function') showToast('야간 화면을 켰어요. 이 화면은 아직 밝은 화면만 돼요.'); } catch (e) { /* 안내 없이도 동작 */ } }
        });
        row.appendChild(b);
    }
    // 화면을 찍어 만드는 결과물(PDF · 이미지 저장)은 야간이어도 종전과 같아야 한다 → html2canvas 가 찍는 복제 문서에서만 속성을 뗀다(보이는 화면은 그대로)
    function guardCapture() {
        const orig = window.html2canvas;
        if (typeof orig !== 'function' || orig.__akmGuard) return;
        const wrapped = function (el, opt) {
            let o = opt;
            try {
                const prev = opt && opt.onclone;
                o = Object.assign({}, opt || {}, { onclone: function (doc) { try { doc.documentElement.removeAttribute('data-ao-theme'); } catch (e) { /* 그대로 찍는다 */ } return typeof prev === 'function' ? prev.apply(this, arguments) : undefined; } });
            } catch (e) { o = opt; }
            return orig.call(this, el, o);
        };
        wrapped.__akmGuard = true;
        try { window.html2canvas = wrapped; } catch (e) { /* 못 감싸면 원래 것 그대로 */ }
    }
    (() => {
        guardCapture(); mountSideTheme();
        if (window.MutationObserver) {
            const mo = new MutationObserver(applyTheme);
            document.querySelectorAll('.page').forEach(p => mo.observe(p, { attributes: true, attributeFilter: ['class'] }));
            const l = $('login-page'); if (l) mo.observe(l, { attributes: true, attributeFilter: ['style'] });
        }
        applyTheme();
    })();

    // #576(대표 10/7 「알림을 누르면 해당 창·페이지로」): 알림에서 그 채팅으로 — app.js 가 메뉴를 바꾼 뒤 window.AkmAoDesk.open(지시 id) 를 부른다
    //   ①채팅 탭에 있으면 그 대화 틀로(답 칸은 자판 바로 위 자리 · 자판은 띄우지 않는다) ②없으면(종료한 대화 · 남의 것) 이전 채팅 이력에서 펼쳐 보여 준다 ③어디에도 없으면 아무것도 바꾸지 않는다
    //   탭을 바꾸기 전에 먼저 받아서 확인한다 → 없는 번호로는 탭·검색이 그대로다. 답·되묻기 차례 id 여도 그 차례가 속한 대화를 찾는다(threadsOf)
    let openSeq = 0;
    const flashEl = (el, ms) => { if (!el) return; el.classList.remove('desk-flash'); void el.offsetWidth; el.classList.add('desk-flash'); setTimeout(() => el.classList.remove('desk-flash'), ms || 2600); };
    async function openOrder(orderId) {
        const id = Number(orderId);
        if (!Number.isInteger(id) || id <= 0) return false;
        const seq = ++openSeq, stale = () => seq !== openSeq || !S.mounted || !pageActive();
        try {
            for (let i = 0; i < 50 && !(S.mounted && pageActive()); i++) await new Promise(r => setTimeout(r, 100));   // 메뉴 전환·첫 그리기를 기다린다(최대 5초)
            if (stale()) return false;
            const has = list => list.some(o => o.id === id);
            const turnEl = () => document.querySelector('#desk-list .desk-turn[data-oid="' + id + '"], #desk-list [data-oid="' + id + '"]');
            const showList = () => { const lb = $('desk-listbox'); if (S.full && lb && !S.full.contains(lb) && S.full !== lb) closeFull(); };
            // ① 채팅 탭(내 것 · 열려 있는 대화)
            let mine = S.tab === 'mine' && has(S.orders) ? S.orders : null;
            if (!mine) { const d = await api('/api/agent-office/desk/orders?mine=1&limit=200'); if (stale()) return false; if (has(d.orders || [])) mine = d.orders; }
            if (mine) {
                const t = threadsOf(mine).find(x => x.items.some(o => o.id === id));
                t.items.forEach(o => S.pin.add(o.id));   // 첫 화면 몇 건 밖이어도 접히지 않게
                if (mine.findIndex(o => o.id === id) >= S.mineLimit) S.mineLimit = 200;   // 채팅 탭 60건 밖이면 넉넉히 받는다
                S.q.mine = ''; if (S.fs !== 'all') { S.fs = 'all'; $('desk-fs').value = 'all'; }
                showList();
                if (S.tab !== 'mine') await setTab('mine'); else { $('desk-hist-q').value = ''; $('desk-hist-x').hidden = true; S.sig = ''; await loadOrders(true); }
                if (stale()) return false;
                let el = turnEl();
                for (let i = 0; i < 3 && !el; i++) { await new Promise(r => setTimeout(r, 500)); if (stale()) return false; S.sig = ''; await loadOrders(true); el = turnEl(); }
                if (!el) return false;
                const box = el.closest('.desk-thread-box');
                if (!box) { el.scrollIntoView({ block: 'center' }); flashEl(el); return 'mine'; }   // 표·카드 보기
                if (el.classList.contains('last')) focusThread(box, true); else { alignRow(el); flashEl(box, 1600); }
                flashEl(el);
                return 'mine';
            }
            // ② 이전 채팅 이력(종료한 대화 · 대표는 남의 것도) — 몇 쪽까지 받아 본다
            let got = [], more = true, before = 0;
            for (let p = 0; p < 5 && more && !has(got); p++) {
                const d = await api('/api/agent-office/desk/orders?history=1&limit=' + HIST_PAGE + (before ? '&before=' + before : ''));
                if (stale()) return false;
                const rows = d.orders || []; got = got.concat(rows); more = rows.length >= HIST_PAGE;
                if (rows.length) before = Math.min(...rows.map(o => o.id));
                if (before && before <= id) break;   // 그 번호보다 옛 줄까지 받았는데 없으면 더 볼 것 없다
            }
            if (!has(got)) return false;
            S.hist.q = ''; S.q.all = ''; S.hist.older = got.slice(HIST_PAGE); S.hist.more = more;
            if (S.hist.mineOnly) { S.hist.mineOnly = false; $('desk-hist-mine').checked = false; }
            S.hist.open.add(threadsOf(got).find(x => x.items.some(o => o.id === id)).id);
            showList();
            await setTab('all');
            if (stale()) return false;
            const t2 = threadsOf(S.orders).find(x => x.items.some(o => o.id === id));
            if (!t2) return false;
            if (!S.hist.open.has(t2.id) || !turnEl()) { S.hist.open.add(t2.id); renderList(); }
            const el = turnEl();
            if (!el) return false;
            const item = el.closest('.desk-h-item');
            alignRow((item && item.querySelector('.desk-h-row')) || el);
            flashEl(el);
            return 'all';
        } catch (e) { return false; }
    }
    window.AkmAoDesk = { open: openOrder, openSms: smsOpenById, openInbox: (ch, id) => inbOpen(String(ch || ''), id), histIdle: hbIdle, histDepth: () => HB.stack.length };   // openInbox = 알림 링크용(#658 · ch = talk|qna|inquiry)

    window.aoDeskEnter = async function () {
        mount();
        if (!S.mounted) return;
        try { if (typeof aoBindEventsOnce === 'function') aoBindEventsOnce(); } catch (e) { console.error('보고서함 연결 실패:', e); }
        clock(); hbRestore();
        custMenu(); plusShorts(); inbSoon();   // #668
        await Promise.all([loadStatus(), loadOrders(true), loadBoard(), loadInbox(), smsSummary()]);
        if (!S.timer) S.timer = setInterval(tick, 1000);
        // #580: 다른 탭·앱에 갔다 돌아오면 다음 차례를 기다리지 않고 바로 다시 받는다(가려진 동안은 안 받으므로 돌아온 순간이 가장 낡아 있다)
        if (!S.visBound) { S.visBound = true; document.addEventListener('visibilitychange', () => { if (document.hidden || !S.mounted || !pageActive()) return; tickElapsed(); if (!S.loading) loadOrders(false); loadStatus(); smsTick(true); }); }
    };
    window.__aoDesk = { HB, S, loadOrders, loadStatus, loadBoard, setTab, renderList, loadInbox, renderInbox, plusFocus, plusBusy };
    // #620(대표 10/10 「새로고침하면 가끔 화면이 빈다」): app.js 의 로그인 확인이 이 파일보다 먼저 끝나면 switchPage 가 aoDeskEnter 를 못 찾아 옛 화면 길로 빠지고, 그 뒤로는 아무도 그리지 않았다
    //   → 이 파일이 실행된 순간 에이전트 오피스가 이미 떠 있으면 스스로 들어간다(mount 는 S.mounted 로 한 번만).
    if (pageActive()) window.aoDeskEnter().catch(console.error);
})();
