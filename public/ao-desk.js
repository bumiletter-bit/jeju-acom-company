// #469 클코 창구 — 에이전트 오피스 화면 (대표 GO 2026-09-29)
// 지시는 서버에 '대기'로 쌓이고, 대표 PC의 창구 터미널이 집어 처리한다. 이 파일은 화면만 담당한다.
// app.js에서 빌려 쓰는 것: api · showToast · currentUser · aoShowSettlementConfirm · aoSettleModalData · aoSettleQueue · aoBindEventsOnce
// #469-b(대표 9/29): 보고서함 탭 없음 — 내 지시·전체 지시(+관리자에게만 대표 확인함)
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
        const flushP = () => { if (para.length) { out.push('<div class="desk-md-p">' + para.map(mdInline).join('\n') + '</div>'); para = []; } };
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
    const plainHead = t => String(t || '').replace(/^[#\s*]+/, '').replace(/[*\s]+$/, '').replace(/\s+/g, ' ').trim();
    const sameHead = (title, text) => plainHead(title) === plainHead(String(text || '').split('\n').find(l => l.trim()) || '');
    // 화면에 보일 진행 단계(처리 길 표시는 답변 옆 작은 표시로만 쓴다)
    const visSteps = o => (Array.isArray(o.steps) ? o.steps : []).filter(x => x && x.kind !== 'lane');
    // 어느 길로 처리했는지(대기 프로그램이 단계에 남긴다) + 걸린 시간
    function laneChip(o) {
        const st = (Array.isArray(o.steps) ? o.steps : []).find(s => s && s.kind === 'lane');
        if (!st) return '';
        let sec = '';
        if (o.processed_at && st.t) { const d = Math.round((new Date(o.processed_at) - new Date(st.t)) / 1000); if (d > 0 && d < 7200) sec = d < 90 ? d + '초' : Math.round(d / 60) + '분'; }
        const done = !ACTIVE.includes(o.status) && o.status !== '판독완료' && o.status !== '확인표작성';
        return `<span class="desk-lane" data-lane="${esc(st.lane || '')}">${esc(st.text)}${done && sec ? ' · ' + sec : ''}</span>`;
    }
    const isAdmin = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
    const pageActive = () => { const p = $('page-agent-office'); return !!(p && p.classList.contains('active')); };
    const kst = (t, opt) => { try { return new Date(/Z|[+-]\d\d:?\d\d$/.test(String(t)) ? t : String(t).replace(' ', 'T') + 'Z').toLocaleString('ko-KR', Object.assign({ timeZone: 'Asia/Seoul' }, opt)); } catch (e) { return ''; } };
    const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

    const S = {
        mounted: false, tab: 'mine', status: null, orders: [], board: null, sig: '', boardAt: 0,
        images: [], open: new Set(), seenConfirm: null, tick: 0, sending: false, loading: false,
        fs: 'all', wide: false, detail: new Set(), autoOpened: new Set(), pend: new Map(), media: new Map(), replyImg: new Map(), replyTarget: 0,
        view: (() => { try { return localStorage.getItem('akm_desk_view') === 'table' ? 'table' : 'chat'; } catch (e) { return 'chat'; } })(), closed: new Set(), follow: new Set(),
        hist: { q: '', mineOnly: false, older: [], more: false, open: new Set(), busy: false }, endAsk: 0, pin: new Set(), q: { mine: '', all: '', approval: '' }, mineLimit: 60, pickImg: false,
        inbox: null, inboxKind: 'talk', inboxSeen: false, inboxAt: 0, ibDetail: new Set(),
    };
    // #469-d(대표 9/29): 예시는 일을 통째로 맡기는 문장으로 — 괄호는 직원이 채울 내용 안내
    const HINTS = ['정산관리 오늘 발주수량이야 올려줘', '단골고객에게 문자발송할 예정이야 (쿠폰, 행사내용, 기간 넣어주기)', '지금 네이버 자사몰 쿠팡 가격 맞는지 확인해줘', '신규품목 보고서 작성해줘 (핵심내용 두서없이 쓰기)'];
    const SAY = {
        idle: '무엇을 도와드릴까요?',
        busy: '지금 지시를 처리하고 있어요.',
        offline: '지금은 자리에 없어요. 남겨 두시면 돌아와서 순서대로 처리할게요.',
    };
    const STATE_LABEL = { idle: '대기 중', busy: '처리 중', offline: '자리 비움' };
    // #506(대표 10/3): 처리 중 문구는 번호 대신 「누구의 "요청"」 — 길면 앞부분만, 이어서 보낸 글은 괄호로, 여러 건이면 나란히
    const cutText = (t, n) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
    const whoOf = w => { const by = String(w.created_by || '').trim(); return by ? by + '님' : '직원'; };
    function sayWorking(d) {
        const list = Array.isArray(d.working_list) ? d.working_list : [];
        if (!list.length) return d.working > 1 ? `지시 ${d.working}건을 동시에 처리하고 있어요.` : SAY.busy;
        if (list.length === 1) {
            const w = list[0];
            const base = w.reply_to && w.parent_content ? w.parent_content : w.content;
            const follow = w.reply_to && w.parent_content ? ` (이어서: "${cutText(w.content, 16)}")` : '';
            return `${whoOf(w)}의 "${cutText(base, 24)}"${follow} 처리 중이에요`;
        }
        return `${list.length}건 처리 중 — ` + list.map(w => `${whoOf(w)} "${cutText(w.reply_to && w.parent_content ? w.parent_content : w.content, 14)}"`).join(' · ');
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
                    <div class="desk-compose">
                        <span class="desk-spark" aria-hidden="true">✦</span>
                        <textarea class="desk-input" id="desk-input" rows="2" maxlength="2000" placeholder="원하시는 작업을 입력해 주세요"></textarea>
                        <div class="desk-thumbs" id="desk-thumbs" hidden></div>
                        <div class="desk-compose-row">
                            <input type="file" id="desk-file" accept="image/*,.xlsx,.xls,.csv,.pdf,.txt" multiple hidden>
                            <input type="file" id="desk-reply-file" accept="image/*,.xlsx,.xls,.csv,.pdf,.txt" hidden>
                            <span class="desk-count" id="desk-count" hidden>0 / 2000</span>
                            <button type="button" class="desk-icon" id="desk-attach" aria-label="이미지·파일 첨부" title="이미지·파일 첨부 (붙여넣기·끌어 놓기도 돼요 · 파일은 엑셀·CSV·PDF·텍스트 1개)"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg></button>
                            <button type="submit" class="desk-icon primary" id="desk-send" aria-label="지시 보내기" title="보내기 (Enter) · 줄바꿈은 Shift+Enter"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg></button>
                        </div>
                    </div>
                    <div class="desk-quick2" role="group" aria-label="자주 쓰는 일">
                        <button type="button" class="desk-chip" id="desk-qty-now" title="AI를 거치지 않고 바로 집계해요 (1~2분)">중간발주</button>
                        <button type="button" class="desk-chip" id="desk-final-now" title="현금파일과 메모를 넣으면 거래처별 택배사 양식, 수량 표, 스토어 양식을 만들어요">최종발주</button>
                        <button type="button" class="desk-chip" id="desk-settle-now" title="발송목록 이미지를 고르면 정산 확인표를 만들어요">정산 이미지</button>
                        <button type="button" class="desk-chip" id="desk-talk-now" title="입력칸에 지시를 채워 드려요. 고쳐서 보내도 돼요">톡톡 답변 추천</button>
                    </div>
                </form>
            </section>
            <section class="desk-listbox" id="desk-listbox" aria-label="채팅 목록">
                <div class="desk-fullbar"><b id="desk-full-title">채팅</b><button type="button" class="desk-btn sm desk-close" data-full-close>닫기</button></div>
                <div class="desk-tabsrow">
                    <div class="desk-tabs" role="tablist" id="desk-tabs">
                        <button class="desk-tab" role="tab" data-tab="mine" aria-selected="true">채팅</button>
                        <button class="desk-tab" role="tab" data-tab="all" aria-selected="false" id="desk-tab-all">이전 채팅 이력</button>
                        <button class="desk-tab" role="tab" data-tab="approval" aria-selected="false" id="desk-tab-approval" hidden>승인 결재함<span class="n" id="desk-approval-n" hidden>0</span></button>
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
            <section class="desk-inbox" id="desk-inbox" aria-label="확인 필요 문의">
                <div class="desk-inbox-head">
                    <b>확인 필요 문의</b>
                    <div class="desk-inbox-tabs" id="desk-inbox-tabs" role="tablist">
                        <button type="button" role="tab" data-k="talk" aria-selected="true">톡톡 <i id="inbox-n-talk">0</i></button>
                        <button type="button" role="tab" data-k="qna" aria-selected="false">상품 Q&amp;A <i id="inbox-n-qna">0</i></button>
                        <button type="button" role="tab" data-k="inquiry" aria-selected="false">주문 문의 <i id="inbox-n-inquiry">0</i></button>
                    </div>
                    <label class="desk-inbox-seen"><input type="checkbox" id="desk-inbox-seen"> 확인한 건도 보기</label>
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
        $('desk-reply-file').addEventListener('change', e => { const f = (e.target.files || [])[0]; e.target.value = ''; if (f && S.replyTarget) setReplyImg(S.replyTarget, f); });
        const replyId = el => el && el.classList && el.classList.contains('desk-reply-in') && /^reply-\d+$/.test(el.id) ? Number(el.id.slice(6)) : 0;
        $('desk-list').addEventListener('paste', e => {
            const id = replyId(e.target);
            if (!id) return;
            const f = Array.from((e.clipboardData && e.clipboardData.files) || [])[0];
            if (f) { e.preventDefault(); setReplyImg(id, f); }
        });
        $('desk-list').addEventListener('input', e => { if (e.target && e.target.classList && e.target.classList.contains('desk-reply-in')) { fitReply(e.target); syncSendBtns(); } });
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
        $('desk-qty-now').addEventListener('click', () => sendQtyNow());
        $('desk-final-now').addEventListener('click', () => { if (window.AkmFinalOrder) window.AkmFinalOrder.open(); else showToast('최종발주 화면을 불러오지 못했어요. 새로고침 후 다시 눌러 주세요'); });   // #508
        $('desk-settle-now').addEventListener('click', () => { if (!input.value.trim()) { input.value = '정산관리에 올려줘'; syncInput(); } S.pickImg = true; $('desk-file').accept = 'image/*'; $('desk-file').click(); });   // 정산 이미지는 이미지 전용 그대로
        $('desk-talk-now').addEventListener('click', () => { input.value = '처리 안 된 톡톡 건 답변 예시문구 만들어줘'; syncInput(); input.focus(); });
        $('desk-wake-btn').addEventListener('click', () => wake());
        $('desk-file').addEventListener('change', e => { const fl = Array.from(e.target.files || []); addFiles(S.pickImg ? fl.filter(isImg) : fl); e.target.value = ''; });
        const ask = $('desk-ask');
        ask.addEventListener('dragover', e => { e.preventDefault(); ask.classList.add('drag'); });
        ask.addEventListener('dragleave', () => ask.classList.remove('drag'));
        ask.addEventListener('drop', e => { e.preventDefault(); ask.classList.remove('drag'); addFiles(Array.from(e.dataTransfer.files || [])); });
        // #474 확인 필요 문의 — 채널 고르기 · 확인한 건 보기 · [확인] · [문구 부탁]
        $('desk-inbox-tabs').addEventListener('click', e => {
            const b = e.target.closest('button[data-k]'); if (!b) return;
            S.inboxKind = b.dataset.k;
            document.querySelectorAll('#desk-inbox-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
            renderInbox();
        });
        $('desk-inbox-seen').addEventListener('change', e => { S.inboxSeen = e.target.checked; loadInbox(); });
        $('desk-inbox-list').addEventListener('click', async e => {
            let b = e.target.closest('button[data-ib]');
            if (!b) {
                // #485: 표의 줄을 눌러도 펼친다(버튼·링크·글자 드래그 제외)
                const tr = e.target.closest('tr.desk-ib-row');
                if (!tr || e.target.closest('button, input, textarea, select, a')) return;
                const sel = window.getSelection && window.getSelection();
                if (sel && String(sel).length) return;
                b = tr.querySelector('[data-ib="detail"]');
                if (!b) return;
            }
            const act = b.dataset.ib;
            if (act === 'detail') {
                const key = b.dataset.kind + ':' + b.dataset.id;
                if (S.ibDetail.has(key)) S.ibDetail.delete(key); else S.ibDetail.add(key);
                renderInbox(); return;
            }
            if (act === 'ask') {
                closeFull();
                const line = b.dataset.kind === 'talk' ? '지금 처리 안 된 톡톡 건들 답변 예시문구 만들어줘' : '지금 답변 안 된 ' + (b.dataset.kind === 'qna' ? '상품 Q&A' : '주문 문의') + ' 답변 예시문구 만들어줘';
                const cur = input.value.trim();
                input.value = !cur ? line : cur.includes(line) ? input.value : input.value.replace(/\s+$/, '') + '\n' + line; // #476 적던 지시는 지우지 않는다
                input.dispatchEvent(new Event('input')); input.focus(); input.scrollIntoView({ block: 'center' });
                return;
            }
            if (act === 'go') { if (typeof switchPage === 'function') switchPage('inquiry'); return; }
            if (act === 'more') { const box = b.closest('.desk-ib'); if (box) box.classList.toggle('open'); b.textContent = box && box.classList.contains('open') ? '접기' : '전체 보기'; return; }
            b.disabled = true;
            try {
                const r = await api('/api/agent-office/desk/inbox/review', 'POST', { kind: b.dataset.kind, id: b.dataset.id, undo: act === 'undo' });
                showToast(r.message || '확인했습니다');
                await loadInbox();
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
            if (e.key === 'Escape') { const z = $('desk-zoom'); if (z && !z.hidden) { z.hidden = true; return; } }
            if (e.key !== 'Escape' || !S.full) return;
            // 확인표 창 같은 다른 창이 위에 떠 있으면 그 창이 먼저 닫힌다
            if (Array.from(document.querySelectorAll('.modal-overlay')).some(m => getComputedStyle(m).display !== 'none')) return;
            closeFull();
        });
        window.addEventListener('popstate', () => {
            if (S.skipPop) { S.skipPop = false; return; }
            if (S.full) closeFull(true);
        });
    }

    const PREVIEW_LIST = 5, PREVIEW_INBOX = 3;
    function openFull(sec) {
        if (!sec || S.full === sec) return;
        if (S.full) closeFull();
        S.full = sec;
        sec.classList.add('is-full');
        document.body.classList.add('desk-full-open');
        try { history.pushState({ deskFull: sec.id }, ''); } catch (e) { /* 기록 없이도 닫기·Esc로 닫힌다 */ }
        sec.scrollTop = 0;
        const c = sec.querySelector('.desk-close'); if (c) c.focus({ preventScroll: true });
    }
    function closeFull(fromPop) {
        const sec = S.full;
        if (!sec) return;
        S.full = null;
        sec.classList.remove('is-full');
        document.body.classList.remove('desk-full-open');
        if (!fromPop && history.state && history.state.deskFull) { S.skipPop = true; history.back(); }
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
            S.sending = false; btn.disabled = false; btn.removeAttribute('aria-busy');
        }
    }

    // #498 중간발주 — 정해진 일이라 AI를 거치지 않고 대기 프로그램이 바로 집계한다(지시 목록에 결과가 올라온다)
    async function sendQtyNow() {
        if (S.sending) return;
        S.sending = true;
        const btn = $('desk-qty-now');
        btn.disabled = true;
        try {
            const r = await api('/api/agent-office/orders', 'POST', { content: '중간발주 뽑아줘' });
            showToast('중간발주를 집계하고 있어요 (1~2분)');
            if (S.fs !== 'all') { S.fs = 'all'; $('desk-fs').value = 'all'; }
            if (S.tab !== 'mine') await setTab('mine'); else { S.sig = ''; await loadOrders(true); }
            revealOrders([r && r.order && r.order.id].filter(Boolean));
        } catch (err) {
            showToast('보내지 못했어요: ' + (err && err.message ? err.message : '다시 시도해 주세요'));
        } finally { S.sending = false; btn.disabled = false; }
    }

    const TAB_NAME = { mine: '채팅', all: '이전 채팅 이력', approval: '승인 결재함' };
    function setTab(tab) {
        S.tab = tab;
        document.querySelectorAll('#desk-tabs .desk-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
        const list = $('desk-list');
        S.sig = ''; S.endAsk = 0;
        $('desk-fs').hidden = tab === 'all';
        $('desk-hist-mine-wrap').hidden = !isAdmin() || tab !== 'all';
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
            $('desk-say').textContent = s === 'busy' ? sayWorking(d) : SAY[s] || SAY.offline;
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
            const tabA = $('desk-tab-approval'), n = $('desk-approval-n');
            tabA.hidden = !isAdmin();
            $('desk-tab-all').hidden = false;   // #538 이전 채팅 이력은 직원에게도 보인다(서버가 본인 것만 내려준다)
            $('desk-hist-mine-wrap').hidden = !isAdmin() || S.tab !== 'all';
            if (!isAdmin() && S.tab === 'approval') setTab('mine');
            n.hidden = !d.approval; n.textContent = d.approval || 0;
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
            const q = S.tab === 'mine' ? '?mine=1&limit=' + S.mineLimit : S.tab === 'approval' ? '?status=' + encodeURIComponent('승인대기') + '&limit=50' : '?history=1&limit=' + HIST_PAGE + (hq ? '&q=' + encodeURIComponent(hq) : '');
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
            const msg = st === '대기' ? '순서를 기다리고 있어요' : st === '승인됨' ? '승인됐어요. 곧 실행합니다' : (last || '처리하고 있어요');
            const live = liveText(o);
            const trail = steps.slice(-4).filter(s => s && s.text);
            return `<div class="desk-note"><span class="desk-working">${esc(live ? '답변을 쓰고 있어요' : msg)}</span></div>`
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
            return `<div class="desk-a answer ${long && !open ? 'clamp' : ''}${(long || mid) && !open ? ' pv' : ''}"><div class="desk-a-label">클코 답변</div>${laneChip(o)}${r.title && !sameHead(r.title, text) ? `<div class="desk-a-title">${esc(r.title)}</div>` : ''}${md(text)}</div>${files}
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
            if (chatMine()) return `<div class="desk-a">${esc(r.question || '확인이 필요해요')}</div>` + composeBox(o, '답 보내기', '여기에 답을 적어 주세요');
            return `<div class="desk-a">${esc(r.question || '확인이 필요해요')}</div>
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
            const acts = st === '승인대기' && isAdmin() && pend === 'approve'
                ? `<div class="desk-reply desk-confirm"><p class="desk-confirm-q">이 요청을 승인할까요? 승인하면 창구가 바로 실행합니다.</p>
                   <button type="button" class="desk-btn sm primary" data-act="approve2" data-id="${o.id}">승인하고 실행</button>
                   <button type="button" class="desk-btn sm" data-act="pendcancel" data-id="${o.id}">취소</button></div>`
                : st === '승인대기' && isAdmin() && pend === 'reject'
                ? `<div class="desk-reply desk-confirm"><label class="desk-confirm-q" for="reject-${o.id}">반려 사유 (비워도 됩니다)</label>
                   <textarea class="desk-reply-in" id="reject-${o.id}" rows="2" maxlength="500" placeholder="예: 대상을 다시 확인해 주세요"></textarea>
                   <button type="button" class="desk-btn sm danger" data-act="reject2" data-id="${o.id}">반려하기</button>
                   <button type="button" class="desk-btn sm" data-act="pendcancel" data-id="${o.id}">취소</button></div>`
                : st === '승인대기' && isAdmin()
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
        if (!z) { z = document.createElement('div'); z.id = 'desk-zoom'; z.className = 'desk-zoom'; z.setAttribute('role', 'dialog'); z.setAttribute('aria-label', '사진 크게 보기'); z.addEventListener('click', () => { z.hidden = true; }); document.body.appendChild(z); }
        z.innerHTML = `<img src="${src}" alt="${esc(label || '')}"><div class="desk-zoom-cap">${esc(label || '')} · 누르면 닫혀요</div>`;
        z.hidden = false;
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
            box.innerHTML = `<div class="desk-empty">${q ? '찾는 글이 든 채팅이 없어요. 다른 낱말로 찾아 보세요.' : S.tab === 'all' ? '이전 채팅이 아직 없어요.' : S.fs !== 'all' ? '고른 상태에 해당하는 채팅이 없어요.' : S.tab === 'approval' ? '승인을 기다리는 요청이 없어요.' : '열려 있는 채팅이 없어요. 위 입력칸에 적어 보내면 여기에 쌓여요.'}</div>`;
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
        const html = ths.map(t => {
            const needs = t.items.some(o => NEEDS.includes(o.status));
            const ov = !S.qOn && !needs && !t.items.some(o => S.pin.has(o.id)) && ++shownN > PREVIEW_LIST;
            if (ov) hidden++;
            const first = t.items[0];
            const canHide = t.items.every(CLOSED_FOR_HIDE);
            // #538: 대화 머리 = 시작 시각 + 첫 글 한 줄 → 어디서부터 다른 대화인지 바로 보인다
            const head = `<div class="desk-th-head"><span class="desk-th-when">${esc(kst(first.created_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} 시작</span><span class="desk-th-sum">${esc(cutText(first.content, 60))}</span>${first.reply_to ? `<span class="desk-thread">↳ ${Number(first.reply_to)}번에 이어서</span>` : ''}${t.items.length > 1 ? `<span>${t.items.length}번 주고받음</span>` : ''}</div>`;
            // #538 [채팅 종료] — 끝난 대화에만 · 카드 안에서 한 번 확인 · 이전 채팅 이력에서 다시 볼 수 있다
            const endHtml = !canHide ? '' : S.endAsk === t.id
                ? `<div class="desk-end-ask" role="group" aria-label="채팅 종료 확인"><span>이 채팅을 종료할까요? 이전 채팅 이력에서 다시 볼 수 있어요.</span><button type="button" class="desk-btn sm primary" data-act="hidethread" data-id="${t.id}">종료</button><button type="button" class="desk-btn sm" data-act="endno" data-id="${t.id}">취소</button></div>`
                : `<button type="button" class="desk-endbtn" data-act="endchat" data-id="${t.id}">채팅 종료</button>`;
            // #541(대표 10/5): [채팅 종료]는 답 상자 안 「+」 옆에 담는다(상자가 틀 너비를 다 쓴다). 답 상자가 없는 대화(최종발주 기록 등)와 확인 중일 때만 상자 밖
            const barHtml = o => { const f = followHtml(o); const asking = S.endAsk === t.id; if (!endHtml || asking || f.indexOf('<!--endslot-->') < 0) return f + endHtml; return f.replace('<!--endslot-->', endHtml); };
            const turns = t.items.map(o => {
                const b = BADGE[o.status] || ['wait', o.status];
                const last = o.id === t.last;
                return `<div class="desk-turn${last ? ' last' : ''}" data-oid="${o.id}">
                    <div class="desk-bub me"><p class="desk-q">${esc(o.content)}</p><div class="desk-bub-meta">${o.id}번 · ${esc(kst(o.created_at, hm))}${attMeta(o)}</div></div>
                    <div class="desk-bub ai">${['완료', '안내', '응답됨'].includes(o.status) ? '' : `<div class="desk-bub-who"><span class="desk-badge" data-k="${b[0]}">${esc(b[1])}</span></div>`}${last ? resultBody(o, true) + `<div class="desk-chatbar${endHtml && S.endAsk === t.id ? ' asking' : ''}">${barHtml(o)}</div>` : resultBody(o, true)}</div>
                </div>`;
            }).join('');
            return `<article class="desk-thread-box${ov ? ' ov' : ''}" data-th="${t.id}">${head}${turns}</article>`;
        }).join('');
        setMore('desk-list-more', hidden);
        $('desk-list').innerHTML = html;
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
    function renderHistory(list) {
        const ths = threadsOf(list), admin = isAdmin(), me = myId(), hm = { hour: '2-digit', minute: '2-digit' }, mdhm = { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
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
                </button>`;
            let body = '';
            if (open) {
                const turns = t.items.map(o => { const b = BADGE[o.status] || ['wait', o.status];
                    return `<div class="desk-turn" data-oid="${o.id}"><div class="desk-bub me"><p class="desk-q">${esc(o.content)}</p><div class="desk-bub-meta">${o.id}번 · ${esc(kst(o.created_at, mdhm))}${attMeta(o)}</div></div>
                        <div class="desk-bub ai">${['완료', '안내', '응답됨'].includes(o.status) ? '' : `<div class="desk-bub-who"><span class="desk-badge" data-k="${b[0]}">${esc(b[1])}</span></div>`}${resultBody(o, true)}</div></div>`; }).join('');
                const mine = me != null && t.items.every(o => o.created_by_id === me);
                const live = t.items.some(o => !o.mine_hidden);
                const foot = mine && !fin ? `<div class="desk-h-foot"><button type="button" class="desk-btn sm primary" data-act="resume" data-id="${t.id}">${live ? '채팅 탭에서 이어가기' : '이 채팅 다시 이어가기'}</button><span class="desk-h-note">${live ? '지금 채팅 탭에 열려 있는 대화예요.' : '채팅 탭으로 다시 꺼내 이어서 보낼 수 있어요.'}</span></div>` : '';
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
    // 그 대화의 답 칸으로 옮겨 커서를 둔다(답 칸이 없는 대화면 대화 틀로만 옮긴다)
    function focusThread(box) {
        if (!box) return;
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
            const want = vtop + Math.max(head + 12, Math.min(vh * 0.32, vh - r.height - 16));
            const d = r.top - want;
            if (Math.abs(d) > 4) { if (sc === document.scrollingElement || sc === document.documentElement) window.scrollBy(0, d); else sc.scrollTop += d; }
        };
        align();
        if (ta) ta.focus({ preventScroll: true });
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
            if (S.qOn || NEEDS.includes(o.status)) return false;
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
            if (hb) { const it = hb.closest('.desk-h-item'); if (it) { S.hist.open.delete(Number(it.dataset.th)); renderList(); const row = document.querySelector('#desk-list .desk-h-item[data-th="' + it.dataset.th + '"] .desk-h-row'); if (row) row.focus({ preventScroll: true }); } return; }
            const tb = chatMine() ? e.target.closest('.desk-thread-box') : null;
            if (tb && (e.target.closest('.desk-th-head') || !e.target.closest('.desk-a, .desk-q, .desk-media, .desk-cbox, .desk-end-ask, .desk-note, .desk-kv, .desk-steps'))) { focusThread(tb); return; }
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
        if (act === 'copy') {
            const text = (o.result && (o.result.answer || o.result.text)) || '';
            try { await navigator.clipboard.writeText(text); showToast('답변을 복사했어요'); } catch (err) { showToast('복사하지 못했어요. 직접 선택해 복사해 주세요'); }
            return;
        }
        if (act === 'confirm') { openConfirm(o.result); return; }
        if (act === 'file') {
            if (typeof aoDownloadFile !== 'function') { showToast('내려받기 기능을 찾지 못했어요. 새로고침 후 다시 눌러 주세요'); return; }
            b.disabled = true;
            try { await aoDownloadFile(Number(b.dataset.file)); } finally { b.disabled = false; }
            return;
        }
        if (act === 'endchat') { S.endAsk = id; renderList(); const y = document.querySelector('#desk-list .desk-end-ask [data-act="hidethread"]'); if (y) y.focus(); return; }
        if (act === 'endno') { S.endAsk = 0; renderList(); return; }
        if (act === 'histopen') { if (S.hist.open.has(id)) S.hist.open.delete(id); else S.hist.open.add(id); renderList(); return; }
        if (act === 'histmore') { return histMore(b); }
        if (act === 'resume') { return resumeChat(id, b); }
        if (act === 'hidethread') {
            const t = threadsOf(S.orders).find(x => x.id === id);
            if (!t) return;
            b.disabled = true;
            try {
                for (const it of t.items) await api('/api/agent-office/orders/' + it.id + '/hide-mine', 'POST', { hide: true });
                const gone = new Set(t.items.map(x => x.id));
                S.orders = S.orders.filter(x => !gone.has(x.id)); S.sig = ''; S.endAsk = 0; renderList();
                showToast('채팅을 종료했어요 · 이전 채팅 이력에서 다시 볼 수 있어요');
            } catch (err) { showToast(err && err.message ? err.message : '종료하지 못했어요'); S.sig = ''; S.endAsk = 0; loadOrders(true); }
            return;
        }
        if (act === 'hide') {
            b.disabled = true;
            try {
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

    // #474 확인 필요 문의 — 톡톡·상품 Q&A·주문 문의 미처리 건(최근 3일). [확인]을 누른 건은 빠진다.
    async function loadInbox() {
        try { S.inbox = await api('/api/agent-office/desk/inbox' + (S.inboxSeen ? '?seen=1' : '')); S.inboxAt = Date.now(); renderInbox(); }
        catch (e) { const box = $('desk-inbox-list'); if (box && !S.inbox) box.innerHTML = '<div class="desk-empty">문의 현황을 읽지 못했어요. 잠시 뒤 다시 열어 주세요.</div>'; }
    }
    function renderInbox() {
        const d = S.inbox, box = $('desk-inbox-list');
        if (!d || !box) return;
        const opened = new Set(Array.from(box.querySelectorAll('.desk-ib.open')).map(el => el.dataset.kind + ':' + el.dataset.id));
        renderInboxNow(d, box);
        if (opened.size) box.querySelectorAll('.desk-ib').forEach(el => { if (opened.has(el.dataset.kind + ':' + el.dataset.id)) { el.classList.add('open'); const b = el.querySelector('[data-ib="more"]'); if (b) b.textContent = '접기'; } });
    }
    function renderInboxNow(d, box) {
        for (const k of ['talk', 'qna', 'inquiry']) {
            const n = $('inbox-n-' + k), c = d.counts && d.counts[k];
            if (n) { const v = c ? c.open + c.ai + (c.staff || 0) : 0; n.textContent = c ? v : '?'; n.className = v ? 'on' : ''; }
        }
        const list = d[S.inboxKind];
        if (!Array.isArray(list)) { box.innerHTML = '<div class="desk-empty">이 채널은 지금 읽지 못했어요.</div>'; return; }
        setMore('desk-inbox-more', Array.isArray(list) ? Math.max(0, list.length - PREVIEW_INBOX) : 0);
        if (!list.length) {
            box.innerHTML = '<div class="desk-empty">' + (S.inboxSeen ? '최근 ' + d.days + '일 기록이 없어요.' : '확인할 문의가 없어요.') + '</div>';
            return;
        }
        const name = { talk: '톡톡', qna: '상품 Q&A', inquiry: '주문 문의' }[S.inboxKind];
        const hasOpen = list.some(x => x.state === 'open' && !x.seen);
        const top = (hasOpen ? `<div class="desk-ib-top"><button type="button" class="desk-btn sm primary" data-ib="ask" data-kind="${S.inboxKind}">미답변 ${esc(name)} 답변 문구 부탁하기</button><span>입력칸에 지시가 들어갑니다. 보내면 클코가 건별로 문구를 만들어요.</span></div>` : '');
        // #486: 톡톡은 직원이 답해도 [확인] 전까지 남는다 → 상태 3종(미답변 · 봇 답변 · 직원 답변)
        const badge = x => `<span class="desk-badge" data-k="${x.seen ? 'done' : x.state === 'staff' ? 'done' : x.state === 'ai' ? 'work' : 'ask'}">${x.seen ? '확인함' : x.state === 'staff' ? '직원 답변함 · 확인 전' : x.state === 'ai' ? '봇 답변함 · 확인 전' : '미답변'}</span>`;
        const bands = x => `${x.answer ? `<div class="desk-a answer"><div class="desk-a-label">${x.kind === 'talk' ? '봇이 보낸 답' : '자동으로 등록된 답'}</div>${esc(x.answer)}</div>` : ''}
            ${x.staff ? `<div class="desk-a answer"><div class="desk-a-label">직원이 보낸 답</div>${esc(x.staff)}</div>` : ''}
            ${x.draft ? `<div class="desk-a answer draft"><div class="desk-a-label">AI 초안 · 아직 등록 안 됨</div>${esc(x.draft)}</div>` : ''}`;
        const acts = x => `${x.seen
            ? `<button type="button" class="desk-btn sm" data-ib="undo" data-kind="${x.kind}" data-id="${esc(x.id)}">다시 목록에 올리기</button>`
            : `<button type="button" class="desk-btn sm primary" data-ib="ok" data-kind="${x.kind}" data-id="${esc(x.id)}">확인</button>`}
            ${x.kind !== 'talk' && x.state === 'open' ? `<button type="button" class="desk-btn sm" data-ib="go">문의 관리에서 답하기</button>` : ''}`;
        // #485(대표 9/30): PC = 지시 목록과 같은 표 — 줄을 누르면 손님 문의 전문 + 답변 띠 + 확인 버튼이 펼쳐진다 · 폰 = 카드(종전)
        if (S.wide) {
            const rows = list.map((x, i) => {
                const key = x.kind + ':' + x.id, open = S.ibDetail.has(key), oc = i >= PREVIEW_INBOX ? ' ov' : '';
                return `<tr class="row clickable desk-ib-row${oc}${open ? ' opened' : ''}${x.seen ? ' seen' : ''}" data-kind="${x.kind}" data-id="${esc(x.id)}" title="${open ? '접기' : '눌러서 문의·답변 보기'}">
                    <td>${badge(x)}</td>
                    <td class="c-id">${esc(kst(x.at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}${x.item ? `<br><small>${esc(x.item)}</small>` : ''}${x.seen && x.seen_by ? `<br><small>확인: ${esc(x.seen_by)}</small>` : ''}</td>
                    <td class="c-q">${esc(String(x.question || '').replace(/\s+/g, ' ').slice(0, 120))}</td>
                    <td class="c-r">${esc(String(x.staff ? '(직원) ' + x.staff : x.draft ? '(초안) ' + x.draft : x.answer || x.why || '').replace(/\s+/g, ' ').slice(0, 90))}</td>
                    <td class="c-x"><button type="button" class="desk-more" data-ib="detail" data-kind="${x.kind}" data-id="${esc(x.id)}" aria-expanded="${open}" aria-label="자세히">${open ? '▴' : '⋯'}</button></td>
                </tr>${open ? `<tr class="detailrow${oc}"><td class="detail" colspan="5">
                    <div class="desk-q-full"><div class="desk-a-label">손님 문의</div>${esc(x.question || '')}${x.why ? ` <small>· ${esc(x.why)}</small>` : ''}</div>
                    ${bands(x)}
                    <div class="desk-acts desk-a-acts">${acts(x)}</div></td></tr>` : ''}`;
            }).join('');
            box.innerHTML = top + `<div class="table-scroll-wrapper"><table class="desk-table"><thead><tr><th>상태</th><th>시각 · 품목</th><th>손님 문의</th><th>답변</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
            return;
        }
        box.innerHTML = top
            + list.map((x, i) => {
                const long = (x.question || '').length > 140 || (x.answer || '').length > 160;
                return `<article class="desk-ib ${x.seen ? 'seen' : ''}${i >= PREVIEW_INBOX ? ' ov' : ''}" data-kind="${x.kind}" data-id="${esc(x.id)}">
                    <div class="desk-ib-head">
                        <span class="desk-badge" data-k="${x.seen ? 'done' : x.state === 'ai' ? 'work' : 'ask'}">${x.seen ? '확인함' : x.state === 'ai' ? '답변완료 · AI 답변 확인 전' : '미답변'}</span>
                        <span>${esc(kst(x.at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>
                        ${x.item ? `<span>${esc(x.item)}</span>` : ''}
                        ${x.why ? `<span>${esc(x.why)}</span>` : ''}
                        ${x.seen && x.seen_by ? `<span>확인: ${esc(x.seen_by)}</span>` : ''}
                    </div>
                    <p class="desk-ib-q">${esc(x.question)}</p>
                    ${bands(x).replace(/class="desk-a answer/g, 'class="desk-ib-a desk-a answer')}
                    <div class="desk-acts desk-a-acts">
                        ${acts(x)}
                        ${long ? `<button type="button" class="desk-btn sm pv-only" data-ib="more">전체 보기</button>` : ''}
                    </div>
                </article>`;
            }).join('');
    }

    async function loadBoard() {
        try { S.board = await api('/api/agent-office/desk/board'); S.boardAt = Date.now(); renderBoard(); } catch (e) { /* 다음 주기에 다시 */ }
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
        if (Array.isArray(d.todo)) {
            todoHtml = d.todo.length
                ? `<ul class="desk-todo">${d.todo.map(t => `<li><span>${esc(t.label)}</span><b>${t.key === 'remind' ? esc(t.when || '오늘') : t.key === 'pricing' ? '확인' : t.count + '건'}</b><small>${esc(t.where)}</small></li>`).join('')}</ul>`
                : '<div class="desk-empty">지금 챙길 일이 없어요.</div>';
        }
        let salesHtml = '';
        if (d.is_admin && Array.isArray(d.sales)) {
            salesHtml = `<div class="desk-panel"><h3>네이버 정산 회차별 결제금액 <span>대표만 보임</span></h3>${d.sales.length
                ? `<div class="desk-sales">${d.sales.map(s => `<span>${Number(s.d.slice(5, 7))}/${Number(s.d.slice(8, 10))} 입금</span><span>${s.orders || 0}건</span><b>${won(s.pay)}원</b>`).join('')}</div>`
                : '<div class="desk-empty">정산 회차 기록이 없어요.</div>'}</div>`;
        }
        box.innerHTML = `
            <div class="desk-panel"><h3>채널별 주문 <span>오늘 · 주문 안내 기준</span></h3>${chHtml}</div>
            <div class="desk-panel"><h3>최근 7일 발송 박스 <span>정산관리 입력 기준</span></h3>${shipHtml}</div>
            <div class="desk-panel"><h3>지금 챙길 일</h3>${todoHtml}</div>
            ${salesHtml}`;
        renderSide(d);
    }

    // #472 오른쪽 칸 — LIVE 로그(보는 사람 본인 지시만 · 대표 확정) · 오늘 일정 · 주요 업무 현황
    function renderSide(d) {
        const live = $('desk-live'), today = $('desk-today'), prog = $('desk-prog');
        if (live) {
            const dot = st => ['오류', '오류확인', '반려'].includes(st) ? 'err' : ['질문', '승인대기'].includes(st) ? 'warn' : 'ok';
            live.innerHTML = Array.isArray(d.live) && d.live.length
                ? `<ul class="desk-live">${d.live.map(x => `<li><time>${esc(kst(x.processed_at, { hour: '2-digit', minute: '2-digit' }))}</time><i class="${dot(x.status)}"></i><p>${esc(x.text || '')}</p></li>`).join('')}</ul>`
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
        if (!S.mounted || !pageActive()) return;
        S.tick++;
        clock();
        if (document.hidden) return;
        const hasActive = S.orders.some(o => ACTIVE.includes(o.status) || o.status === '판독완료' || o.status === '확인표작성');
        if (S.tick % (hasActive ? 2 : 12) === 0) loadOrders(false);   // #498 진행 중이면 2초마다(종전 4초)
        if (S.tick % 10 === 0) loadStatus();
        if (Date.now() - S.boardAt > 60000) { S.boardAt = Date.now(); loadBoard(); }
        if (Date.now() - S.inboxAt > 30000) { S.inboxAt = Date.now(); loadInbox(); }
    }

    window.aoDeskEnter = async function () {
        mount();
        if (!S.mounted) return;
        try { if (typeof aoBindEventsOnce === 'function') aoBindEventsOnce(); } catch (e) { console.error('보고서함 연결 실패:', e); }
        clock();
        await Promise.all([loadStatus(), loadOrders(true), loadBoard(), loadInbox()]);
        if (!S.timer) S.timer = setInterval(tick, 1000);
    };
    window.__aoDesk = { S, loadOrders, loadStatus, loadBoard, setTab, renderList, loadInbox, renderInbox };
})();
