// #658(대표 10/11 「톡톡·상품·주문 문의도 에이전트 오피스에서 문자처럼 바로 답장」) — 문자 전용 창의 톡톡 | 상품문의 | 주문문의 탭
//   이 파일은 그 세 탭의 목록·대화·입력·보내기·읽음·초안만 맡는다. 탭 줄·기록(history)·Esc·창 닫기는 ao-desk.js 가 맡고, 아래 window.AkmInbox 로 만난다.
//   모양은 문자 창과 같은 class(.sms-cols · .sms-row · .sms-msg …)를 그대로 써서 2단·폰 전체 화면·야간이 같은 CSS 로 나온다(id 는 전부 inb- 로 시작).
//   서버 계약 = docs/inbox-threads-spec.md: GET /api/inbox/counts · GET /api/inbox/threads?ch=&scope=&q= · GET /api/inbox/threads/:ch/:id(?peek=1) · POST …/send { text, seen } · …/read · …/unread · …/draft(톡톡)
//   #660(대표 10/12 「이전 대화를 기본으로 · 미답변 건을 볼 수 있게 · 확인 누르면 0이 되게」): 기본 목록 = 전체 대화(scope=all) · [미처리 n](scope=open · 탭별 기억 · #664 이름 바꿈 — 종전 「답 안 한 것만」) · 대화 머리 [확인](POST /api/inbox/done { ch, id, undo } — 답할 필요 없는 글 · 다시 누르면 되돌림)
//   타이머를 따로 두지 않는다 — ao-desk.js 의 틱이 AkmInbox.refresh() 를 부르고, 간격은 여기서 지킨다.
(function () {
    'use strict';
    const CH = {
        talk: { label: '톡톡', sub: '네이버 톡톡으로 온 대화', find: '이름·글로 찾기', send: '답 보내기', sendDraft: '이대로 보내기', sendEdit: '고쳐서 보내기', sent: '톡톡으로 답을 보냈어요', ph: '손님에게 보낼 톡톡 답을 적어 주세요', empty: '주고받은 글이 없어요.' },
        qna: { label: '상품문의', sub: '스마트스토어 상품 문의(공개 게시판)', find: '상품·글로 찾기', send: '답변 등록', sendDraft: '이대로 등록', sendEdit: '고쳐서 등록', sent: '답변을 등록했어요', ph: '상품문의 답변을 적어 주세요', empty: '문의 글이 없어요.' },
        inquiry: { label: '주문문의', sub: '스마트스토어 고객 문의(주문)', find: '이름·글로 찾기', send: '답변 등록', sendDraft: '이대로 등록', sendEdit: '고쳐서 등록', sent: '답변을 등록했어요', ph: '주문문의 답변을 적어 주세요', empty: '문의 글이 없어요.' },
    };
    const WHO = { customer: '손님', bot: '봇', staff: '직원' };
    const DONE_TEXT = '등록됨 · 수정은 스마트스토어 센터에서 해 주세요';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nfmt = n => (Number(n) || 0).toLocaleString('ko-KR');
    const p2 = n => String(n).padStart(2, '0');
    const kd = t => { if (!t) return null; const d = new Date(t); return isNaN(d) ? null : new Date(d.getTime() + 9 * 3600e3); };   // KST 로 옮긴 시각(읽을 때는 getUTC*)
    const dayOf = t => { const d = kd(t); return d ? d.toISOString().slice(0, 10) : ''; };
    const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const when = t => { const d = kd(t); if (!d) return ''; const hm = p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); return dayOf(t) === today() ? hm : (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + hm; };
    const dayLabel = t => { const d = kd(t); if (!d) return ''; return dayOf(t) === today() ? '오늘' : (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 ' + '일월화수목금토'[d.getUTCDay()] + '요일'; };
    const toast = (m, ms) => { if (typeof window.showToast === 'function') window.showToast(m, '', ms); };
    const phone = () => window.matchMedia('(max-width: 720px)').matches;
    const key = (ch, id) => ch + ':' + id;
    const safeUrl = u => { try { const x = new URL(String(u), location.href); return x.protocol === 'https:' || x.protocol === 'http:' || x.protocol === 'blob:' ? x.href : ''; } catch (e) { return ''; } };

    const I = {
        host: null, ch: '', onThread: null, scope: 'all', q: '', items: null, itemsAt: 0, err: '', sig: '', lbusy: false, lseq: 0, listAt: 0,
        open: '', openRow: null, openAt: 0, thread: null, tsig: '', tseq: 0, tbusy: false, thAt: 0, readAt: 0, actAt: Date.now(), sending: false, drafting: false, doneBusy: false, noDone: false,
        filled: '', fillText: '', newDraft: '', lockUntil: 0, texts: new Map(),
        counts: null, cbs: new Set(), cAt: 0, cbusy: false, avail: null, vvSig: '', vvRaf: 0, qTimer: 0,
    };
    const away = () => document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus()) || Date.now() - I.actAt > 120000;
    const mounted = () => !!(I.host && I.host.isConnected && I.ch);
    // [미처리] 를 켜 둔 탭은 다음에 열 때도 켠 채로(이 기기에만 · 못 쓰는 브라우저면 늘 전체)
    const scopeGet = ch => { try { return localStorage.getItem('akm_inb_only_open_' + ch) === '1' ? 'open' : 'all'; } catch (e) { return 'all'; } };
    const scopePut = (ch, v) => { try { if (v === 'open') localStorage.setItem('akm_inb_only_open_' + ch, '1'); else localStorage.removeItem('akm_inb_only_open_' + ch); } catch (e) { /* 기억 못 해도 그대로 쓴다 */ } };
    const isConf = t => !!(t && t.done) && t.state !== 'done' && t.state !== 'staff';   // [확인]을 누른 대화(답은 없지만 볼 일이 끝남)
    const needsOf = t => !!t && !isConf(t) && (t.needs_reply != null ? !!t.needs_reply : !!t.why);   // 미처리 대화(아직 답도 [확인]도 안 한 것) — counts.open 이 세는 것

    // ── 서버 ─────────────────────────────────────────────
    // api() 는 오류 응답의 본문을 넘겨주지 않아(409 의 새 초안) 직접 부른다. 돌려주는 값 = { status, ok, body }
    async function call(url, method, body) {
        const r = await fetch(url, { method: method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') }, body: body ? JSON.stringify(body) : undefined });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401 && typeof window.akmSessionExpired === 'function') window.akmSessionExpired();
        return { status: r.status, ok: r.ok, body: j || {} };
    }
    const errText = (res, fb) => { const b = res && res.body; return (b && (b.error_text || b.message || (typeof b.error === 'string' && /[가-힣]/.test(b.error) ? b.error : ''))) || fb || '다시 시도해 주세요'; };

    // 숫자 — 서버가 { talk: { unread, needs }, … } 로 주든 숫자만 주든 같은 꼴로 맞춘다
    function normCounts(c) {
        if (!c || typeof c !== 'object') return null;
        const one = v => (v && typeof v === 'object') ? { unread: Number(v.unread != null ? v.unread : v.unread_threads) || 0, needs: Number(v.needs != null ? v.needs : v.needs_staff != null ? v.needs_staff : v.open) || 0 } : { unread: Number(v) || 0, needs: 0 };
        return { talk: one(c.talk), qna: one(c.qna), inquiry: one(c.inquiry) };
    }
    function setCounts(c, avail) {
        const n = normCounts(c), was = JSON.stringify([I.counts, I.avail]);
        if (n) I.counts = n;
        if (avail != null) I.avail = avail;
        if (JSON.stringify([I.counts, I.avail]) !== was) { headSync(); I.cbs.forEach(cb => { try { cb(I.counts); } catch (e) { /* 듣는 쪽 오류는 넘긴다 */ } }); }
    }
    async function loadCounts() {
        if (I.cbusy) return; I.cbusy = true; I.cAt = Date.now();
        try {
            const r = await call('/api/inbox/counts');
            if (r.status === 404 || r.status === 503) setCounts(null, false);
            else if (r.ok) setCounts(r.body.counts, true);
        } catch (e) { /* 통신 끊김 — 다음 틱에 다시 */ }
        finally { I.cbusy = false; }
    }

    // ── 목록 ─────────────────────────────────────────────
    function skeleton() {
        const c = CH[I.ch];
        I.host.innerHTML = `<div class="sms-cols inb-cols" data-ch="${I.ch}"><div class="sms-left">`
            + `<div class="sms-bar"><label class="desk-sr" for="inb-q">${c.label} 찾기</label><input type="search" class="ship-q sms-q" id="inb-q" maxlength="40" autocomplete="off" placeholder="${esc(c.find)}">`
            + `<button type="button" class="desk-btn sm sms-done-btn sms-staff-btn" id="inb-open" aria-pressed="false" title="아직 답하거나 확인하지 않은 대화만 봐요. 다시 누르면 전체 대화">미처리 <b id="inb-open-n"></b></button>`
            + `<span class="sms-count" id="inb-count" role="status"></span></div>`
            + `<ul class="sms-list" id="inb-list" aria-label="${c.label} 목록"></ul>`
            + `</div><div class="sms-pane" id="inb-pane"><div class="sms-pane-empty">왼쪽 목록에서 대화를 골라 주세요.</div></div></div>`
            + `<div class="sms-view" id="inb-view" role="dialog" aria-modal="true" aria-label="사진 크게 보기" hidden><button type="button" class="desk-btn sm sms-view-x" id="inb-view-x">닫기</button><img id="inb-view-img" alt="손님이 보낸 사진" referrerpolicy="no-referrer"></div>`;
    }
    function rowHtml(x) {
        const k = key(x.ch || I.ch, x.id), open = I.open === k, out = x.last_dir === 'out';
        const un = (open && I.readAt >= I.itemsAt) ? 0 : (Number(x.unread) || 0);
        const done = x.state === 'done' || x.state === 'staff', ai = x.state === 'ai', conf = isConf(x);
        const needs = needsOf(x), why = conf ? '' : (x.why || (needs ? '답 필요' : ''));
        return `<li class="sms-item${open ? ' open' : ''}${un > 0 ? ' unread' : ''}${needs ? ' needs' : ''}" data-id="${esc(x.id)}" data-un="${un}">`
            + `<button type="button" class="sms-row" aria-expanded="${String(open)}" aria-controls="inb-thread">`
            + `<span class="sms-tail inb-title">${needs ? '<i class="inb-need" aria-hidden="true"></i>' : ''}${esc(x.title || '(이름 없음)')}</span>`
            + (un > 0 ? `<i class="sms-n sms-un" aria-label="안 읽은 글 ${un}개">${un > 99 ? '99+' : un}</i>` : conf ? '<span class="desk-badge inb-conf" data-k="mute">확인함</span>' : done ? '<span class="desk-badge" data-k="done">답함</span>' : ai ? '<span class="desk-badge" data-k="mute">봇 답</span>' : '')
            + `<time class="sms-time">${esc(when(x.last_at))}</time>`
            + (x.sub ? `<span class="sms-hint">${esc(x.sub)}</span>` : '')
            + `<span class="sms-last">${out ? '<b class="sms-me">나:</b> ' : ''}${esc(x.last_text || '(글 없음)')}</span>`
            + ((why || (x.has_draft && !done && !conf)) ? `<span class="sms-tags">${why ? `<i class="sms-why">${esc(why)}</i>` : ''}${x.has_draft && !done && !conf ? '<i class="sms-tag">초안</i>' : ''}</span>` : '')
            + '</button></li>';
    }
    function renderList() {
        const ul = $('inb-list'); if (!ul) return;
        const items = (I.items || []).slice();
        if (I.open) {   // 열어 둔 대화는 답·[확인]으로 「미처리」 목록에서 빠져도 접기 전까지 제자리에 둔다
            const at = items.findIndex(x => key(x.ch || I.ch, x.id) === I.open);
            if (at >= 0) { I.openRow = items[at]; I.openAt = at; }
            else if (I.openRow) items.splice(Math.min(I.openAt, items.length), 0, I.openRow);
        }
        const cnt = $('inb-count'); if (cnt) cnt.textContent = I.err || I.items == null ? '' : (I.scope === 'open' ? '미처리 · ' : '') + (items.length >= 200 ? '최근 ' + nfmt(items.length) + '건까지 보여요. 이름이나 글로 찾아보세요.' : nfmt(items.length) + '건');
        const sig = JSON.stringify([items, I.scope, I.q, I.open, I.err, I.items == null]);
        if (sig === I.sig && ul.firstChild) return;
        I.sig = sig;
        let html = items.map(rowHtml).join('');
        if (!html) html = I.err ? `<li class="desk-empty ship-empty">${esc(I.err)}</li>`
            : I.items == null ? '<li class="desk-empty ship-empty">불러오는 중</li>'
            : I.q ? `<li class="desk-empty ship-empty">${esc(`「${I.q}」로 찾은 글이 없어요.`)}</li>`
            : I.scope === 'open' ? '<li class="desk-empty ship-empty sms-none"><span>미처리 대화가 없어요.</span><button type="button" class="desk-btn sm" id="inb-empty-go">전체 대화 보기</button></li>'
            : '<li class="desk-empty ship-empty">아직 들어온 글이 없어요.</li>';
        const top = ul.scrollTop; ul.innerHTML = html; ul.scrollTop = top;
        headSync();
    }
    // [미처리 n] 단추 — 숫자는 탭 숫자와 같은 counts(open)에서 · 열기만 해서는 안 줄고 답·[확인]으로 준다
    function headSync() {
        const ob = $('inb-open'); if (!ob) return;
        const n = (I.counts && I.counts[I.ch] && I.counts[I.ch].needs) || 0;
        ob.setAttribute('aria-pressed', String(I.scope === 'open')); $('inb-open-n').textContent = n > 0 ? nfmt(n) : '';
    }
    async function loadList(quiet) {
        if (!mounted()) return;
        const ch = I.ch, seq = ++I.lseq; I.lbusy = true; I.listAt = Date.now();
        let r, err = '';
        try { r = await call('/api/inbox/threads?ch=' + ch + '&scope=' + I.scope + (I.q ? '&q=' + encodeURIComponent(I.q) : '')); }
        catch (e) { err = '통신이 끊겼어요. 잠시 뒤 다시 불러올게요.'; }
        if (seq !== I.lseq || ch !== I.ch || !mounted()) return;
        I.lbusy = false;
        if (!err && !(r.ok && Array.isArray(r.body.threads))) err = r.status === 404 || r.status === 503 ? '이 서버에서는 아직 쓸 수 없어요.' : '목록을 불러오지 못했어요: ' + errText(r);
        if (err) { if (!quiet || I.items == null) { I.err = err; I.items = I.items || []; renderList(); } return; }
        I.err = ''; I.items = r.body.threads; I.itemsAt = Date.now();
        setCounts(r.body.counts, true); I.cAt = Date.now();
        renderList();
    }
    function setScope(v) {
        v = v === 'open' ? 'open' : 'all';
        if (v === I.scope) return;
        I.scope = v; scopePut(I.ch, v); I.items = null; I.sig = ''; renderList(); loadList();
    }

    // ── 대화 ─────────────────────────────────────────────
    const curDraft = () => { const d = I.thread && I.thread.draft; return d == null ? '' : String(typeof d === 'object' ? (d.text || '') : d); };
    const isDone = d => { const t = d && d.thread; return !!t && I.ch !== 'talk' && (t.state === 'done' || (t.state === 'ai' && d.can_send === false)); };   // 문의 = 사람이 답함(done) 또는 봇이 등록함(ai) — 둘 다 「이미 답변」
    function threadOpen(id, silent, stay) {
        const k = key(I.ch, id);
        if (I.open === k) { if (phone() && !stay) threadClose(true); return; }   // stay = 알림·링크(openById)로 온 것 — 이미 펴 둔 대화를 접지 않는다   // PC 2단에서는 같은 줄을 또 눌러도 그대로 둔다
        const moved = !!I.open;
        threadClose(false, true);
        const x = (I.items || []).find(i => String(i.id) === String(id)) || (I.openRow && String(I.openRow.id) === String(id) ? I.openRow : null) || { id, ch: I.ch };
        const c = CH[I.ch];
        I.open = k; I.thread = null; I.tsig = ''; I.filled = ''; I.fillText = ''; I.newDraft = ''; I.lockUntil = 0; I.readAt = Date.now(); I.actAt = Date.now();
        I.openAt = Math.max(0, (I.items || []).findIndex(i => String(i.id) === String(id))); I.openRow = x;
        const th = document.createElement('div');
        th.className = 'sms-thread inb-thread'; th.id = 'inb-thread'; th.dataset.id = String(id); th.dataset.ch = I.ch; th.setAttribute('role', 'region'); th.setAttribute('aria-label', c.label + ' 대화');
        th.innerHTML = `<div class="sms-th-head"><button type="button" class="sms-th-back" id="inb-back" aria-label="목록으로 돌아가기">목록</button><i class="inb-dot" data-ch="${I.ch}" aria-hidden="true"></i><b class="inb-th-title" id="inb-th-title">${esc(x.title || c.label)}</b><span id="inb-th-badge"></span>`
            + `<span class="inb-acts"><button type="button" class="desk-btn sm inb-done" id="inb-done" aria-pressed="false" hidden>확인</button></span><button type="button" class="sms-th-x" id="inb-x" aria-label="이 대화 접기" title="접기 (Esc)">×</button></div>`
            + `<div class="sms-order inb-meta" id="inb-meta" hidden></div>`
            + `<div class="sms-msgs" id="inb-msgs" tabindex="0" aria-label="주고받은 글"><div class="desk-empty ship-empty">불러오는 중</div></div>`
            + `<form class="sms-reply" id="inb-reply" autocomplete="off"></form>`;
        document.querySelectorAll('#inb-list .sms-item.open').forEach(o => { o.classList.remove('open'); o.querySelector('.sms-row').setAttribute('aria-expanded', 'false'); });
        const li = document.querySelector('#inb-list .sms-item[data-id="' + (window.CSS && CSS.escape ? CSS.escape(String(id)) : String(id)) + '"]');
        if (li) { li.classList.add('open'); li.classList.remove('unread'); li.dataset.un = '0'; li.querySelector('.sms-row').setAttribute('aria-expanded', 'true'); const un = li.querySelector('.sms-un'); if (un) un.remove(); }
        $('inb-pane').replaceChildren(th);
        I.host.classList.add('inb-open');
        if (!moved && !silent && I.onThread) { try { I.onThread(true); } catch (e) { /* 기록 없이도 접기·Esc 로 닫힌다 */ } }
        vv(); I.sig = '';
        loadThread();
    }
    function threadClose(focusRow, keep) {
        const k = I.open; if (!k) return false;
        const id = k.slice(k.indexOf(':') + 1);
        const ta = $('inb-text');
        if (ta) { const v = ta.value; if (v.trim() && v.trim() !== curDraft().trim()) I.texts.set(k, v); else I.texts.delete(k); }
        I.open = ''; I.thread = null; I.tseq++; I.tbusy = false; I.openRow = null;
        if (I.scope === 'open' && !I.q && I.items) I.items = I.items.filter(i => String(i.id) !== id || needsOf(i));   // 「미처리」에서는 답했거나 [확인]한 대화가 접을 때 빠진다(전체 대화·찾기 중에는 그대로)
        const pane = $('inb-pane'); if (pane) pane.innerHTML = '<div class="sms-pane-empty">왼쪽 목록에서 대화를 골라 주세요.</div>';
        if (I.host) I.host.classList.remove('inb-open');
        if (!keep && I.onThread) { try { I.onThread(false); } catch (e) { /* 그대로 둔다 */ } }
        vv(); I.sig = ''; renderList();
        if (focusRow) { const r = document.querySelector('#inb-list .sms-item[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] .sms-row') || document.querySelector('#inb-list .sms-row') || $('inb-empty-go') || $('inb-q'); if (r) r.focus({ preventScroll: true }); }
        return true;
    }
    // 입력 칸 — 보낼 수 있으면 글 칸 + 단추 · 못 보내면 그 사유(등록된 문의 · 카카오·자사몰 대화)
    function replyRender(d) {
        const f = $('inb-reply'); if (!f) return;
        const c = CH[I.ch], can = d.can_send !== false, done = isDone(d);
        const pub = d.limits && d.limits.public != null ? !!d.limits.public : I.ch === 'qna', mkd = I.ch === 'talk' && d.can_draft !== false;
        const mode = !can ? (done ? 'done' : 'lock') : 'write' + (mkd ? '+d' : '');
        if (f.dataset.mode === mode) { if (!can) { const p = f.querySelector('.inb-lock span'); const t = lockText(d, done); if (p && p.textContent !== t) p.textContent = t; } return; }
        f.dataset.mode = mode;
        if (!can) { f.innerHTML = `<div class="inb-lock" data-k="${mode}" role="status"><i aria-hidden="true"></i><span>${esc(lockText(d, done))}</span></div>`; return; }
        const max = Math.max(100, Math.min(5000, Number(d.limits && (d.limits.max_chars || d.limits.max)) || (I.ch === 'talk' ? 1000 : 1000)));
        const keep = ($('inb-text') || {}).value || '';
        f.innerHTML = (pub ? `<p class="inb-public" id="inb-public"><i aria-hidden="true"></i>${esc((d.limits && d.limits.pii_note) || '공개 게시판에 올라가요. 누구나 보니 이름·번호·주소는 적지 마세요.')}</p>` : '')
            + '<div class="sms-warn" id="inb-warn" role="status" hidden></div>'
            + '<div class="sms-draft" id="inb-draft" hidden></div>'
            + `<label class="desk-sr" for="inb-text">${esc(c.ph)}</label>`
            + `<textarea class="sms-text" id="inb-text" rows="3" maxlength="${max}" placeholder="${esc(c.ph)}"${pub ? ' aria-describedby="inb-public"' : ''}></textarea>`
            + `<div class="sms-reply-row"><span class="sms-len" id="inb-len"></span>${mkd ? '<button type="button" class="desk-btn" id="inb-mkdraft">초안 만들기</button>' : ''}<button type="submit" class="desk-btn primary" id="inb-send" disabled>${esc(c.send)}</button></div>`;
        const ta = $('inb-text'); if (keep) ta.value = keep; else if (I.texts.has(I.open)) ta.value = I.texts.get(I.open);
    }
    const lockText = (d, done) => String(d.cannot_why || (done ? DONE_TEXT : '이 대화는 여기서 답을 보낼 수 없어요.'));
    function sync() {
        const ta = $('inb-text'); if (!ta) return;
        const c = CH[I.ch], v = ta.value, has = !!v.trim(), dt = curDraft(), dr = !!dt, same = dr && v.trim() === dt.trim();
        const btn = $('inb-send');
        btn.disabled = !has || I.sending || I.drafting || !I.thread || Date.now() < I.lockUntil;
        btn.textContent = same ? c.sendDraft : dr && has ? c.sendEdit : c.send;
        const mk = $('inb-mkdraft'); if (mk) { mk.disabled = I.sending || I.drafting || !I.thread; mk.textContent = I.drafting ? '초안 만드는 중' : dr ? '초안 다시 만들기' : '초안 만들기'; if (I.drafting) mk.setAttribute('aria-busy', 'true'); else mk.removeAttribute('aria-busy'); }
        const band = $('inb-draft'), fresh = dr && I.newDraft && I.newDraft === dt && !same, k = fresh ? 'new' : 'std';
        band.hidden = !dr;
        if (band.dataset.k !== k) { band.dataset.k = k; band.innerHTML = fresh ? '<span>초안이 새로 만들어졌어요.</span><button type="button" class="desk-btn sm" id="inb-draft-new">새 초안으로 바꾸기</button>' : '봇이 만든 초안이에요. 그대로 보내거나 고쳐서 보낼 수 있어요.'; }
        { const w = $('inb-warn'), pe = I.thread && I.thread.post_error; if (w) { w.hidden = !pe; w.textContent = pe ? '자동 등록이 실패했던 문의예요: ' + pe : ''; } }
        $('inb-len').textContent = has ? nfmt(v.length) + '자' : (window.matchMedia('(pointer: fine)').matches ? 'Ctrl+Enter 로 보내기' : '');
    }
    // 초안을 글 칸에 — 칸이 비었거나 우리가 채워 준 옛 초안 그대로면 채운다 · 사람이 적던 글은 안 덮는다([새 초안으로 바꾸기] 안내)
    function fillDraft() {
        const ta = $('inb-text'); if (!ta) return;
        const dt = curDraft(), fk = I.open + '|' + dt, cur = ta.value.trim();
        if (!dt) { I.filled = fk; I.newDraft = ''; return; }
        if (I.filled === fk) return;
        if (!cur || (I.fillText && cur === I.fillText.trim())) {
            const swapped = !!cur && cur !== dt.trim();
            ta.value = dt; I.fillText = dt; I.filled = fk; I.newDraft = '';
            if (swapped) { I.lockUntil = Date.now() + 800; ta.classList.add('sms-text-new'); setTimeout(() => { if (ta.isConnected) ta.classList.remove('sms-text-new'); }, 1600); setTimeout(sync, 820); }   // 누르는 순간 바뀌어 못 본 글이 나가지 않게 0.8초 잠금
        } else I.newDraft = dt;
    }
    async function loadThread(quiet) {
        const k = I.open; if (!k) return;
        const ch = I.ch, id = k.slice(k.indexOf(':') + 1), seq = ++I.tseq; I.tbusy = true; I.thAt = Date.now();
        const peek = !!quiet && away();   // 뒤에서 다시 받을 때 자리를 비운 것 같으면 읽음으로 바꾸지 않는다
        let r, err = '';
        try { r = await call('/api/inbox/threads/' + ch + '/' + encodeURIComponent(id) + (peek ? '?peek=1' : '')); } catch (e) { err = '통신이 끊겼어요'; }
        if (seq !== I.tseq || I.open !== k) return;
        I.tbusy = false;
        if (!err && !(r.ok && r.body.thread && Array.isArray(r.body.messages))) err = errText(r, '불러오지 못했어요');
        const box = $('inb-msgs'); if (!box) return;
        if (err) { if (!quiet || !I.thread) box.innerHTML = `<div class="desk-empty ship-empty">대화를 불러오지 못했어요: ${esc(err)}</div>`; return; }
        const d = r.body, first = !I.thread;
        I.thread = d;
        if (!peek) I.readAt = Date.now();
        { const it = (I.items || []).find(i => String(i.id) === id); if (it) Object.assign(it, d.thread, peek ? {} : { unread: 0 }); else I.openRow = Object.assign({}, I.openRow, d.thread); }
        if (first) { I.cAt = 0; }   // 읽음이 됐으니 탭 숫자를 다음 틱에 새로
        const sig = JSON.stringify([d.thread, d.messages, d.draft, d.can_send, d.cannot_why, d.can_draft, d.post_error]);
        if (sig === I.tsig) return;
        const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40, firstPaint = !I.tsig;
        I.tsig = sig;
        const t = d.thread;
        $('inb-th-title').textContent = t.title || CH[ch].label;
        $('inb-th-badge').innerHTML = needsOf(t) ? `<i class="sms-why${t.why ? '' : ' inb-gen'}">${esc(t.why || '답 필요')}</i>` : isDone(d) ? '<span class="desk-badge" data-k="done">답함</span>' : '';
        doneSync();
        { const m = $('inb-meta'), rows = [t.sub, t.product, t.order_text].filter(Boolean); m.hidden = !rows.length; m.innerHTML = rows.map(x => `<span>${esc(x)}</span>`).join(''); }
        let day = '';
        box.innerHTML = d.messages.length ? d.messages.map(m => {
            const out = m.direction === 'out', dk = dayOf(m.at);
            const sep = dk && dk !== day ? `<div class="sms-day"><span>${esc(dayLabel(m.at))}</span></div>` : ''; day = dk || day;
            const u = m.image_url ? safeUrl(m.image_url) : '';
            const img = u ? `<div class="sms-pics"><button type="button" class="sms-thumb" data-view="${esc(u)}" aria-label="사진 크게 보기"><img src="${esc(u)}" alt="${out ? '보낸' : '손님이 보낸'} 사진" loading="lazy" referrerpolicy="no-referrer"></button></div>` : '';
            const meta = [out ? (WHO[m.sender] || '우리') + (m.sender === 'staff' && m.by ? ' ' + m.by : '') : '', out && m.via === 'center' ? '센터에서 답함' : '', when(m.at)].filter(Boolean).map(esc).join(' · ');
            return sep + `<div class="sms-msg ${out ? 'out' : 'in'}" data-who="${esc(m.sender || '')}">${img}${m.body ? `<div class="sms-bub">${esc(m.body)}</div>` : ''}<small>${meta}${!out && m.note ? ` <i class="sms-why inb-note">${esc(m.note)}</i>` : ''}</small></div>`;
        }).join('') + (d.limits && d.limits.time_note ? `<p class="inb-timenote">${esc(d.limits.time_note)}</p>` : '') : `<div class="desk-empty ship-empty">${esc(CH[ch].empty)}</div>`;
        if (firstPaint || bottom) box.scrollTop = box.scrollHeight;
        replyRender(d); fillDraft(); sync();
        I.sig = ''; renderList();
    }
    async function send() {
        const k = I.open; if (!k || I.sending || I.drafting || !I.thread || Date.now() < I.lockUntil) return;
        const ta = $('inb-text'); if (!ta) return;
        const text = ta.value.trim(); if (!text) return;
        const ch = I.ch, id = k.slice(k.indexOf(':') + 1), c = CH[ch];
        I.sending = true; sync();
        const btn = $('inb-send'); btn.setAttribute('aria-busy', 'true');
        let ok = false, changed = false, msg = '', code = '';
        try {
            const r = await call('/api/inbox/threads/' + ch + '/' + encodeURIComponent(id) + '/send', 'POST', { text, seen: curDraft() });   // seen = 화면이 본 초안(서버 초안과 다르면 409 — 못 본 글이 나가지 않게)
            code = String(r.body.code || '');
            if (r.status === 409 && (code === 'draft_changed' || r.body.error === 'draft_changed')) {
                const nd = String(r.body.draft != null ? (typeof r.body.draft === 'object' ? r.body.draft.text || '' : r.body.draft) : (r.body.draft_text || ''));
                if (I.open === k && I.thread) { I.thread.draft = nd || null; I.tsig = ''; if (ta.isConnected) fillDraft(); }   // 손 안 댄 옛 초안이면 새 초안으로 · 적던 글이면 그대로 두고 [새 초안으로 바꾸기] 띠만 · 빈 초안이면 칸을 비우지 않음
                changed = true;
            } else if (!r.ok || r.body.ok === false) msg = errText(r);
            else ok = true;
        } catch (e) { msg = '통신이 끊겼어요. 다시 눌러 주세요'; }
        finally { I.sending = false; if (btn.isConnected) btn.removeAttribute('aria-busy'); }
        if (changed) { toast(I.newDraft ? '초안이 바뀌었어요. 적던 글은 그대로 뒀어요. 확인하고 다시 눌러 주세요' : '초안이 바뀌었어요. 확인하고 다시 눌러 주세요', 5000); sync(); if (I.open === k) loadThread(true); return; }
        if (!ok) {   // already = 이미 답한 문의 · timeout_unknown = 나가는 중일 수 있음 → 대화를 새로 받아 실제 상태를 보여 준다(글은 칸에 그대로)
            toast((ch === 'talk' ? '답을 보내지 못했어요: ' : '답변을 등록하지 못했어요: ') + msg, code === 'timeout_unknown' ? 8000 : 5000); sync();
            if ((code === 'already' || code === 'busy' || code === 'timeout_unknown' || code === 'duplicate') && I.open === k) { I.tsig = ''; loadThread(true); loadList(true); }
            return; }
        if (I.open === k && ta.isConnected) ta.value = '';
        I.texts.delete(k); I.fillText = ''; toast(c.sent);
        sync();
        if (I.open !== k) return;
        I.tsig = ''; await loadThread(true);
        I.cAt = 0; loadList(true);
    }
    async function makeDraft() {
        const k = I.open; if (!k || I.ch !== 'talk' || I.sending || I.drafting || !I.thread) return;
        const id = k.slice(k.indexOf(':') + 1);
        I.drafting = true; sync();
        let msg = '', nd = '';
        try {
            const r = await call('/api/inbox/threads/talk/' + encodeURIComponent(id) + '/draft', 'POST', {});
            if (!r.ok || r.body.ok === false) msg = errText(r);
            else nd = String(r.body.draft != null ? (typeof r.body.draft === 'object' ? r.body.draft.text || '' : r.body.draft) : (r.body.draft_text || r.body.text || ''));
        } catch (e) { msg = '통신이 끊겼어요'; }
        finally { I.drafting = false; }
        if (I.open !== k) return;
        if (msg || !nd) { toast('초안을 만들지 못했어요: ' + (msg || '봇이 답을 만들지 못했어요. 직접 적어 주세요'), 5000); sync(); return; }
        I.thread.draft = nd; I.tsig = '';
        fillDraft(); sync();
        const ta = $('inb-text'); if (ta && !I.newDraft) ta.focus({ preventScroll: true });
        toast(I.newDraft ? '초안을 만들었어요. 적던 글은 그대로 뒀어요' : '초안을 칸에 넣었어요. 읽어 보고 보내 주세요', 3500);
    }
    // [확인] — 답할 필요 없는 글·센터에서 이미 답한 글. 미처리 셈에서 빠지고, 다시 누르면 되돌린다
    function doneSync() {
        const b = $('inb-done'); if (!b) return;
        const t = I.thread && I.thread.thread, conf = isConf(t);
        b.hidden = I.noDone || !(conf || needsOf(t)); b.setAttribute('aria-pressed', String(conf)); b.disabled = I.doneBusy;
        b.textContent = conf ? '확인함' : '확인';
        b.title = conf ? '다시 누르면 미처리로 되돌려요' : '답할 필요가 없는 글이면 눌러 주세요. 미처리에서 빠져요';
    }
    async function markDone() {
        const k = I.open; if (!k || !I.thread || I.doneBusy) return;
        const ch = I.ch, id = k.slice(k.indexOf(':') + 1), undo = isConf(I.thread.thread);
        I.doneBusy = true; doneSync();
        let r, msg = '';
        try { r = await call('/api/inbox/done', 'POST', undo ? { ch, id, undo: true } : { ch, id }); if (!r.ok || r.body.ok === false) msg = errText(r); }
        catch (e) { msg = '통신이 끊겼어요. 다시 눌러 주세요'; }
        I.doneBusy = false;
        if (r && r.status === 404 && !(r.body && r.body.ok === false)) { I.noDone = true; doneSync(); toast('이 서버에서는 아직 [확인]을 쓸 수 없어요', 5000); return; }   // 옛 서버(라우트 없음) — 단추를 숨긴다(없는 대화의 404 는 { ok:false } 라 아래 안내로)
        if (msg) { doneSync(); toast((undo ? '되돌리지 못했어요: ' : '확인 처리를 하지 못했어요: ') + msg, 5000); return; }
        const now = r.body.done != null ? !!r.body.done : !undo;
        if (r.body.counts) { setCounts(r.body.counts, true); I.cAt = Date.now(); } else I.cAt = 0;
        toast(now ? '확인했어요. 미처리에서 뺐어요' : '확인을 되돌렸어요');
        if (I.open !== k || ch !== I.ch) { doneSync(); loadList(true); return; }
        if (I.thread) { const t = I.thread.thread; t.done = now; if (now) { t.needs_reply = false; t.unread = 0; } else if (r.body.needs_reply != null) t.needs_reply = !!r.body.needs_reply;
            const it = (I.items || []).find(i => String(i.id) === id); if (it) Object.assign(it, t); else I.openRow = Object.assign({}, I.openRow, t); }
        doneSync(); $('inb-th-badge').innerHTML = needsOf(I.thread && I.thread.thread) ? `<i class="sms-why${I.thread.thread.why ? '' : ' inb-gen'}">${esc(I.thread.thread.why || '답 필요')}</i>` : '';
        I.sig = ''; renderList();
        I.tsig = ''; await loadThread(true); loadList(true);
    }
    function viewOpen(u, from) { const v = $('inb-view'); if (!v) return; $('inb-view-img').src = u; v.hidden = false; v._from = from || null; $('inb-view-x').focus({ preventScroll: true }); }
    function viewClose() { const v = $('inb-view'); if (!v || v.hidden) return false; v.hidden = true; $('inb-view-img').removeAttribute('src'); const f = v._from; v._from = null; if (f && f.isConnected) f.focus({ preventScroll: true }); return true; }

    // 폰 자판이 올라오면 대화 화면을 자판 위로(문자 창과 같은 변수 이름 · 값은 우리 칸에 따로 단다)
    function vvNow() {
        I.vvRaf = 0; const h = I.host; if (!h) return;
        const v = window.visualViewport;
        const want = (!v || !I.open) ? '' : [Math.round(v.height), Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop)), Math.max(0, Math.round(v.offsetTop))].join(',');
        if (want === I.vvSig) return;
        I.vvSig = want;
        if (!want) { ['--sms-vh', '--sms-kb', '--sms-vt'].forEach(p => h.style.removeProperty(p)); return; }
        const [a, b, c] = want.split(','); h.style.setProperty('--sms-vh', a + 'px'); h.style.setProperty('--sms-kb', b + 'px'); h.style.setProperty('--sms-vt', c + 'px');
    }
    function vv() { if (I.vvRaf) return; I.vvRaf = requestAnimationFrame(vvNow); }

    // ── 사건(칸 하나에 한 번만 건다) ─────────────────────────
    function bind(host) {
        if (host._inbBound) return; host._inbBound = true;
        host.addEventListener('click', e => {
            I.actAt = Date.now();
            const t = e.target;
            const row = t.closest('.sms-row'); if (row && host.contains(row)) { threadOpen(row.parentNode.dataset.id); return; }
            if (t.closest('#inb-open')) { setScope(I.scope === 'open' ? 'all' : 'open'); return; }
            if (t.closest('#inb-empty-go')) { setScope('all'); return; }
            if (t.closest('#inb-back') || t.closest('#inb-x')) { threadClose(true); return; }
            if (t.closest('#inb-done')) { markDone(); return; }
            if (t.closest('#inb-mkdraft')) { makeDraft(); return; }
            if (t.closest('#inb-draft-new')) { const ta = $('inb-text'), dt = curDraft(); if (ta && dt) { ta.value = dt; I.fillText = dt; I.filled = I.open + '|' + dt; I.newDraft = ''; sync(); ta.focus({ preventScroll: true }); } return; }
            const th = t.closest('.sms-thumb'); if (th && th.dataset.view) { viewOpen(th.dataset.view, th); return; }
            if (t.closest('#inb-view') && t.id !== 'inb-view-img') { viewClose(); return; }
        });
        host.addEventListener('submit', e => { if (e.target.id === 'inb-reply') { e.preventDefault(); send(); } });
        host.addEventListener('input', e => {
            I.actAt = Date.now();
            if (e.target.id === 'inb-text') { sync(); return; }
            if (e.target.id === 'inb-q') { clearTimeout(I.qTimer); I.qTimer = setTimeout(() => { const v = ($('inb-q') || {}).value || ''; if (v.trim() === I.q) return; I.q = v.trim(); I.items = null; I.sig = ''; renderList(); loadList(); }, 300); }
        });
        host.addEventListener('keydown', e => {
            I.actAt = Date.now();
            const ime = e.isComposing || e.keyCode === 229;   // 한글 조합 중 Enter 는 글자 확정 — 보내기·찾기로 읽지 않는다
            if (e.target.id === 'inb-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !ime) { e.preventDefault(); send(); }
            if (e.target.id === 'inb-q' && e.key === 'Enter' && !ime) { e.preventDefault(); clearTimeout(I.qTimer); I.q = e.target.value.trim(); I.items = null; I.sig = ''; renderList(); loadList(); }
        });
        host.addEventListener('error', e => { const im = e.target; if (im && im.tagName === 'IMG' && im.closest('.sms-thumb')) { const b = im.closest('.sms-thumb'); b.classList.add('fail'); b.disabled = true; b.removeAttribute('data-view'); b.textContent = '사진을 불러오지 못했어요'; } }, true);
        ['pointerdown', 'wheel', 'touchstart'].forEach(ev => host.addEventListener(ev, () => { I.actAt = Date.now(); }, { passive: true }));
    }
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', vv); window.visualViewport.addEventListener('scroll', vv); }

    // ── 밖으로 내놓는 것 ───────────────────────────────────
    function mount(host, opt) {
        opt = opt || {};
        const ch = CH[opt.ch] ? opt.ch : 'talk';
        if (!host) return;
        if (I.host && I.host !== host) unmount();
        const same = I.host === host && I.ch === ch && host.firstChild;
        I.host = host; I.onThread = typeof opt.onThread === 'function' ? opt.onThread : I.onThread;
        bind(host);
        if (!same) {
            if (I.open) threadClose(false, true);
            I.ch = ch; I.scope = scopeGet(ch); I.q = ''; I.items = null; I.err = ''; I.sig = ''; I.lseq++;
            host.dataset.ch = ch; skeleton(); renderList(); loadList();
        }
        if (opt.openId != null && opt.openId !== '') openById(String(opt.openId));
    }
    // 알림·챙길 일에서 그 대화로 — 목록에 없으면(답한 대화·목록 건수 밖) 그 대화만 받아 맨 위에 두고 편다
    function openById(id) {
        if (!mounted()) return;
        if ((I.items || []).some(x => String(x.id) === id)) { threadOpen(id, false, true); return; }
        if (I.open === key(I.ch, id)) return;
        I.openRow = { id, ch: I.ch }; I.openAt = 0;
        threadOpen(id, false, true);
    }
    function unmount() {
        if (!I.host) return;
        viewClose(); if (I.open) threadClose(false, true);
        clearTimeout(I.qTimer);
        ['--sms-vh', '--sms-kb', '--sms-vt'].forEach(p => I.host.style.removeProperty(p)); I.vvSig = '';
        I.host.classList.remove('inb-open'); I.host.innerHTML = ''; I.lseq++; I.tseq++;
        I.host = null; I.ch = ''; I.items = null; I.sig = ''; I.onThread = null;
    }
    function back() { if (viewClose()) return true; if (I.open) { threadClose(true, true); return true; } return false; }   // 기록(history)에서 부르는 용 — onThread 는 안 부른다
    function refresh(now) {
        const t = Date.now();
        if (now) { I.cAt = 0; I.listAt = 0; I.thAt = 0; }
        if (I.avail === false) { if (t - I.cAt > 300000) loadCounts(); return; }   // 라우트가 없는 서버면 5분에 한 번만 다시 본다
        if (!mounted()) { if (t - I.cAt > 30000) loadCounts(); return; }
        if (document.hidden) return;
        if (!I.lbusy && t - I.listAt > 10000) loadList(true);
        else if (t - I.cAt > 30000 && !I.lbusy) loadCounts();
        if (I.open && !I.tbusy && !I.sending && !I.drafting && t - I.thAt > 5000) loadThread(true);
    }
    window.AkmInbox = {
        CH: Object.keys(CH).map(k => ({ ch: k, label: CH[k].label })),
        mount, unmount, back, refresh,
        isOpen: () => !!I.open,
        counts: () => I.counts,
        onCounts: cb => { if (typeof cb !== 'function') return () => { }; I.cbs.add(cb); return () => I.cbs.delete(cb); },
        available: () => I.avail === true,
        _state: I,
    };
})();
