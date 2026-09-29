// #469 클코 창구 — 에이전트 오피스 화면 (대표 GO 2026-09-29)
// 지시는 서버에 '대기'로 쌓이고, 대표 PC의 창구 터미널이 집어 처리한다. 이 파일은 화면만 담당한다.
// app.js에서 빌려 쓰는 것: api · showToast · currentUser · aoShowSettlementConfirm · aoSettleModalData · aoSettleQueue · aoBindEventsOnce · aoLoadReports
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isAdmin = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
    const pageActive = () => { const p = $('page-agent-office'); return !!(p && p.classList.contains('active')); };
    const kst = (t, opt) => { try { return new Date(/Z|[+-]\d\d:?\d\d$/.test(String(t)) ? t : String(t).replace(' ', 'T') + 'Z').toLocaleString('ko-KR', Object.assign({ timeZone: 'Asia/Seoul' }, opt)); } catch (e) { return ''; } };
    const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

    const S = {
        mounted: false, tab: 'mine', status: null, orders: [], board: null, sig: '', boardAt: 0,
        images: [], open: new Set(), seenConfirm: null, tick: 0, sending: false, loading: false,
    };
    const HINTS = ['오늘 발송 박스 수 알려줘', '이번 주 단가표 등록됐는지 확인해줘', '황금향 선물용 5kg 판매가 알려줘', '연휴 발송 안내 문자 초안 써줘'];
    const SAY = {
        idle: '무엇을 도와드릴까요? 아래에 적어 주세요.',
        busy: '지금 지시를 처리하고 있어요.',
        offline: '지금은 자리에 없어요. 남겨 두시면 돌아와서 순서대로 처리할게요.',
    };
    const STATE_LABEL = { idle: '대기 중', busy: '처리 중', offline: '자리 비움' };
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
        <section class="desk-top">
            <div class="desk-hero">
                <div>
                    <div class="desk-date" id="desk-date"></div>
                    <div class="desk-clock" id="desk-clock" aria-live="off"></div>
                    <span class="desk-state" id="desk-state" data-s="offline"><i></i><span id="desk-state-text">확인 중</span></span>
                    <span class="desk-state-sub" id="desk-state-sub"></span>
                    <div class="desk-say" id="desk-say" role="status"></div>
                </div>
                <div class="desk-stage" id="desk-stage" data-s="offline"><img id="desk-char" src="/desk/akkomi-off.webp" alt="아꼼이 캐릭터" width="150" height="150"></div>
            </div>
            <form class="desk-ask" id="desk-ask" autocomplete="off">
                <h2>클코에게 지시하기</h2>
                <p>조회, 문구 초안, 정산 이미지 등록을 맡길 수 있어요. 쿠폰, 가격, 발송은 대표 승인 뒤에 실행됩니다.</p>
                <label for="desk-input">지시 내용</label>
                <textarea class="desk-input" id="desk-input" maxlength="2000" placeholder="예: 21일 효돈 정산관리에 올려줘 (발송목록 이미지를 함께 붙여 주세요)"></textarea>
                <div class="desk-thumbs" id="desk-thumbs" hidden></div>
                <div class="desk-ask-row">
                    <input type="file" id="desk-file" accept="image/*" multiple hidden>
                    <button type="button" class="desk-btn" id="desk-attach">이미지 첨부</button>
                    <button type="submit" class="desk-btn primary" id="desk-send">지시 보내기</button>
                    <span class="desk-count" id="desk-count">0 / 2000</span>
                </div>
                <div class="desk-hints" id="desk-hints">${HINTS.map(h => `<button type="button" class="desk-hint">${esc(h)}</button>`).join('')}</div>
            </form>
        </section>
        <section class="desk-board" id="desk-board" aria-label="현황판"></section>
        <div class="desk-tabs" role="tablist" id="desk-tabs">
            <button class="desk-tab" role="tab" data-tab="mine" aria-selected="true">내 지시</button>
            <button class="desk-tab" role="tab" data-tab="all" aria-selected="false">전체 지시</button>
            <button class="desk-tab" role="tab" data-tab="approval" aria-selected="false" id="desk-tab-approval" hidden>대표 확인함<span class="n" id="desk-approval-n" hidden>0</span></button>
            <button class="desk-tab" role="tab" data-tab="reports" aria-selected="false">보고서함</button>
        </div>
        <div class="desk-list" id="desk-list" aria-live="polite"></div>`;
        // 보고서함(기존 표)을 새 화면 안으로 옮긴다 — 기능·데이터는 그대로
        const rep = $('ao-reports-view');
        if (rep) { root.appendChild(rep); rep.style.display = 'none'; }
        bind();
        S.mounted = true;
    }

    function bind() {
        const input = $('desk-input');
        input.addEventListener('input', () => { $('desk-count').textContent = input.value.length + ' / 2000'; });
        input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); send(); } });
        input.addEventListener('paste', e => {
            const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^image\//.test(f.type));
            if (files.length) { e.preventDefault(); addFiles(files); }
        });
        $('desk-ask').addEventListener('submit', e => { e.preventDefault(); send(); });
        $('desk-attach').addEventListener('click', () => $('desk-file').click());
        $('desk-file').addEventListener('change', e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; });
        const ask = $('desk-ask');
        ask.addEventListener('dragover', e => { e.preventDefault(); ask.classList.add('drag'); });
        ask.addEventListener('dragleave', () => ask.classList.remove('drag'));
        ask.addEventListener('drop', e => { e.preventDefault(); ask.classList.remove('drag'); addFiles(Array.from(e.dataTransfer.files || []).filter(f => /^image\//.test(f.type))); });
        $('desk-hints').addEventListener('click', e => { const b = e.target.closest('.desk-hint'); if (!b) return; input.value = b.textContent; input.dispatchEvent(new Event('input')); input.focus(); });
        $('desk-thumbs').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; S.images.splice(Number(b.dataset.i), 1); renderThumbs(); });
        $('desk-tabs').addEventListener('click', e => { const t = e.target.closest('.desk-tab'); if (t) setTab(t.dataset.tab); });
        $('desk-list').addEventListener('click', onListClick);
    }

    function addFiles(files) {
        for (const f of files) {
            if (S.images.length >= 6) { showToast('이미지는 한 번에 6장까지 보낼 수 있어요'); break; }
            if (f.size > 9 * 1024 * 1024) { showToast('10MB보다 큰 이미지는 보낼 수 없어요: ' + f.name); continue; }
            const rd = new FileReader();
            rd.onload = () => { S.images.push({ data: String(rd.result), mime: f.type || 'image/png', name: f.name }); renderThumbs(); };
            rd.readAsDataURL(f);
        }
    }
    function renderThumbs() {
        const box = $('desk-thumbs');
        box.hidden = !S.images.length;
        box.innerHTML = S.images.map((im, i) => `<div class="desk-thumb"><img src="${im.data}" alt="첨부 ${i + 1}"><button type="button" data-i="${i}" aria-label="첨부 ${i + 1} 빼기">×</button></div>`).join('');
    }

    async function send() {
        if (S.sending) return;
        const input = $('desk-input');
        const content = input.value.trim();
        if (!content && !S.images.length) { input.focus(); return; }
        S.sending = true;
        const btn = $('desk-send');
        btn.disabled = true; btn.textContent = '보내는 중';
        try {
            if (S.images.length) {
                const imgs = S.images.slice();
                for (const im of imgs) await api('/api/agent-office/orders', 'POST', { content: content || '정산관리에 올려줘', image_data: im.data, image_mime: im.mime });
                showToast(`지시 ${imgs.length}건을 보냈어요`);
            } else {
                await api('/api/agent-office/orders', 'POST', { content });
                showToast('지시를 보냈어요');
            }
            input.value = ''; $('desk-count').textContent = '0 / 2000';
            S.images = []; renderThumbs();
            if (S.tab !== 'mine') setTab('mine'); else await loadOrders(true);
        } catch (err) {
            showToast('보내지 못했어요: ' + (err && err.message ? err.message : '다시 시도해 주세요'));
        } finally {
            S.sending = false; btn.disabled = false; btn.textContent = '지시 보내기';
        }
    }

    function setTab(tab) {
        S.tab = tab;
        document.querySelectorAll('#desk-tabs .desk-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
        const rep = $('ao-reports-view'), list = $('desk-list');
        if (tab === 'reports') {
            list.hidden = true;
            if (rep) rep.style.display = '';
            try { localStorage.setItem('ao_inbox_seen', String(Date.now())); } catch (e) { /* 저장 불가 환경 */ }
            if (typeof aoLoadReports === 'function') aoLoadReports();
            return;
        }
        if (rep) rep.style.display = 'none';
        list.hidden = false;
        S.sig = '';
        list.innerHTML = '<div class="desk-empty">불러오는 중</div>';
        loadOrders(true);
    }

    async function loadStatus() {
        try {
            const d = await api('/api/agent-office/desk-status');
            const s = d.state || 'offline';
            $('desk-state').dataset.s = s;
            $('desk-stage').dataset.s = s;
            $('desk-state-text').textContent = STATE_LABEL[s] || s;
            const img = $('desk-char');
            const src = '/desk/akkomi-' + (s === 'busy' ? 'busy' : s === 'idle' ? 'idle' : 'off') + '.webp';
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
            const parts = [];
            if (d.waiting) parts.push(`대기 ${d.waiting}건`);
            if (d.working) parts.push(`처리 중 ${d.working}건`);
            if (s === 'offline' && d.last_seen) parts.push('마지막 확인 ' + kst(d.last_seen, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
            $('desk-state-sub').textContent = parts.join(' · ');
            $('desk-say').textContent = s === 'busy' && d.order_id ? `${d.order_id}번 지시를 처리하고 있어요.` : SAY[s] || SAY.offline;
            const tabA = $('desk-tab-approval'), n = $('desk-approval-n');
            tabA.hidden = !isAdmin();
            n.hidden = !d.approval; n.textContent = d.approval || 0;
        } catch (e) { /* 다음 주기에 다시 */ }
    }

    async function loadOrders(force) {
        if (S.tab === 'reports' || S.loading) return;
        S.loading = true;
        try {
            const q = S.tab === 'mine' ? '?mine=1&limit=30' : S.tab === 'approval' ? '?status=' + encodeURIComponent('승인대기') + '&limit=50' : '?limit=40';
            const d = await api('/api/agent-office/desk/orders' + q);
            const orders = d.orders || [];
            watchConfirms(orders);
            const sig = S.tab + '|' + orders.map(o => o.id + ':' + o.status + ':' + ((o.steps && o.steps.length) || 0) + ':' + (o.processed_at || '')).join(',');
            S.orders = orders;
            if (force || sig !== S.sig) { S.sig = sig; renderList(); }
        } catch (e) {
            if (force) $('desk-list').innerHTML = `<div class="desk-empty">목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</div>`;
        } finally { S.loading = false; }
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

    function resultHtml(o) {
        const r = o.result || {};
        const st = o.status;
        if (ACTIVE.includes(st) || st === '판독완료' || st === '확인표작성') {
            const steps = Array.isArray(o.steps) ? o.steps : [];
            const last = steps.length ? steps[steps.length - 1].text : '';
            const msg = st === '대기' ? '순서를 기다리고 있어요' : st === '승인됨' ? '승인됐어요. 곧 실행합니다' : (last || '처리하고 있어요');
            return `<div class="desk-note"><span class="desk-working">${esc(msg)}</span></div>`;
        }
        if (r.type === 'desk_answer' || r.type === 'answer') {
            const text = r.answer || r.text || '';
            const long = text.length > 360 || text.split('\n').length > 6;
            const open = S.open.has(o.id);
            const files = Array.isArray(r.files) && r.files.length
                ? `<div class="desk-note desk-files">${r.files.map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.label || '첨부 열기')}</a>`).join(' · ')}</div>` : '';
            return `<div class="desk-a ${long && !open ? 'clamp' : ''}">${r.title ? `<div class="desk-a-title">${esc(r.title)}</div>` : ''}${esc(text)}</div>${files}
                <div class="desk-acts">${long ? `<button type="button" class="desk-btn sm" data-act="toggle" data-id="${o.id}">${open ? '접기' : '전체 보기'}</button>` : ''}
                <button type="button" class="desk-btn sm" data-act="copy" data-id="${o.id}">답변 복사</button></div>`;
        }
        if (st === '질문' && r.type === 'settlement_ocr_confirm') {
            return `<div class="desk-a">${esc(r.summary || '정산 확인표가 준비됐어요')}</div>
                <div class="desk-acts"><button type="button" class="desk-btn sm primary" data-act="confirm" data-id="${o.id}">확인표 열기</button></div>`;
        }
        if (st === '질문') {
            return `<div class="desk-a">${esc(r.question || '확인이 필요해요')}</div>
                <div class="desk-acts"><button type="button" class="desk-btn sm" data-act="reply" data-id="${o.id}">답 적기</button></div>`;
        }
        if (r.type === 'approval_request') {
            const done = st === '반려' ? `<div class="desk-note">반려: ${esc(r.rejected_by || '')}${r.reject_reason ? ' · ' + esc(r.reject_reason) : ''}</div>`
                : r.approved_by ? `<div class="desk-note">승인: ${esc(r.approved_by)}</div>` : '';
            const acts = st === '승인대기' && isAdmin()
                ? `<div class="desk-acts"><button type="button" class="desk-btn sm primary" data-act="approve" data-id="${o.id}">승인하고 실행</button>
                   <button type="button" class="desk-btn sm danger" data-act="reject" data-id="${o.id}">반려</button></div>`
                : st === '승인대기' ? '<div class="desk-note">대표 승인을 기다리고 있어요</div>' : '';
            return `<dl class="desk-kv"><dt>요청</dt><dd>${esc(r.summary)}</dd>${r.impact ? `<dt>영향</dt><dd>${esc(r.impact)}</dd>` : ''}${r.plan ? `<dt>승인되면</dt><dd>${esc(r.plan)}</dd>` : ''}</dl>${done}${acts}`;
        }
        if (st === '오류' || st === '오류확인' || r.type === 'error') return `<div class="desk-a">처리하지 못했어요: ${esc(r.error || '사유 기록 없음')}</div>
            ${st === '오류' && isAdmin() ? `<div class="desk-acts"><button type="button" class="desk-btn sm" data-act="retry" data-id="${o.id}">다시 맡기기</button></div>` : ''}`;
        const text = r.notice || r.summary || '';
        return text ? `<div class="desk-a">${esc(text)}</div>` : '';
    }

    function renderList() {
        const box = $('desk-list');
        if (!S.orders.length) {
            box.innerHTML = `<div class="desk-empty">${S.tab === 'approval' ? '승인을 기다리는 요청이 없어요.' : S.tab === 'mine' ? '아직 보낸 지시가 없어요. 위 입력칸에 적어 보내면 여기에 쌓여요.' : '지시 기록이 없어요.'}</div>`;
            return;
        }
        box.innerHTML = S.orders.map(o => {
            const b = BADGE[o.status] || ['wait', o.status];
            const steps = (Array.isArray(o.steps) ? o.steps : []).slice(-4);
            const showSteps = steps.length > 1 && !['완료', '안내', '응답됨'].includes(o.status);
            return `<article class="desk-card" data-oid="${o.id}">
                <div class="desk-card-head"><span class="desk-badge" data-k="${b[0]}">${esc(b[1])}</span>
                    <span>${o.id}번</span><span>${esc(o.created_by || '')}</span>
                    <span>${esc(kst(o.created_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>
                    ${o.has_image ? '<span>이미지 첨부</span>' : ''}</div>
                <p class="desk-q">${esc(o.content)}</p>
                ${resultHtml(o)}
                ${showSteps ? `<ul class="desk-steps">${steps.map(s => `<li>${esc(kst(s.t, { hour: '2-digit', minute: '2-digit' }))} ${esc(s.text)}</li>`).join('')}</ul>` : ''}
            </article>`;
        }).join('');
    }

    async function onListClick(e) {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const id = Number(b.dataset.id), act = b.dataset.act;
        const o = S.orders.find(x => x.id === id);
        if (!o) return;
        if (act === 'toggle') { if (S.open.has(id)) S.open.delete(id); else S.open.add(id); renderList(); return; }
        if (act === 'copy') {
            const text = (o.result && (o.result.answer || o.result.text)) || '';
            try { await navigator.clipboard.writeText(text); showToast('답변을 복사했어요'); } catch (err) { showToast('복사하지 못했어요. 직접 선택해 복사해 주세요'); }
            return;
        }
        if (act === 'confirm') { openConfirm(o.result); return; }
        if (act === 'reply') { const i = $('desk-input'); i.focus(); i.scrollIntoView({ block: 'center' }); return; }
        if (act === 'approve' || act === 'reject' || act === 'retry') {
            let body;
            if (act === 'approve' && !confirm('이 요청을 승인할까요?\n\n' + (o.result.summary || '') + '\n\n승인하면 창구가 바로 실행합니다.')) return;
            if (act === 'reject') { const reason = prompt('반려 사유를 적어 주세요 (비워도 됩니다)', ''); if (reason === null) return; body = { reason }; }
            b.disabled = true;
            try {
                const path = act === 'retry' ? 'process' : act;
                const res = await api('/api/agent-office/orders/' + id + '/' + path, 'POST', body);
                showToast(res.message || '처리했어요');
                await Promise.all([loadOrders(true), loadStatus()]);
            } catch (err) { showToast(err && err.message ? err.message : '처리하지 못했어요'); b.disabled = false; }
        }
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
                ? `<ul class="desk-todo">${d.todo.map(t => `<li><span>${esc(t.label)}</span><b>${t.key === 'pricing' ? '확인' : t.count + '건'}</b><small>${esc(t.where)}</small></li>`).join('')}</ul>`
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
        if (!S.mounted || !pageActive()) return;
        S.tick++;
        clock();
        if (document.hidden) return;
        const hasActive = S.orders.some(o => ACTIVE.includes(o.status) || o.status === '판독완료' || o.status === '확인표작성');
        if (S.tick % (hasActive ? 4 : 12) === 0) loadOrders(false);
        if (S.tick % 10 === 0) loadStatus();
        if (Date.now() - S.boardAt > 60000) { S.boardAt = Date.now(); loadBoard(); }
    }

    window.aoDeskEnter = async function () {
        mount();
        if (!S.mounted) return;
        try { if (typeof aoBindEventsOnce === 'function') aoBindEventsOnce(); } catch (e) { console.error('보고서함 연결 실패:', e); }
        clock();
        await Promise.all([loadStatus(), loadOrders(true), loadBoard()]);
        if (!S.timer) S.timer = setInterval(tick, 1000);
    };
    window.__aoDesk = { S, loadOrders, loadStatus, loadBoard, setTab };
})();
