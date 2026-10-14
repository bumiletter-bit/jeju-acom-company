// #687(대표 10/14) 회사 규정 — 「내 정보」 메뉴의 [회사 규정] 탭
//   전 직원: 규정 목록(제목 · 개정판 · 시행일 · 올린 날) → [보기](PDF) · [내려받기] · 같은 제목의 옛 판은 「이전 판 n」 접힘.
//   관리자(대표·경리): 올리기(제목 · 개정판 · 시행일 · PDF 1개 ≤ 5MB) · [지우기](soft). 「확인했습니다」·확인 현황은 두지 않는다(대표 확정).
//   탭 켜고 끄기는 payslip.js setTab 이 한 곳에서(TABS = info|pay|rules) — 이 파일은 자기 판(#rules-root)만 그린다. 서버 계약 = rules.js(루트).
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const me = () => { try { return (typeof currentUser !== 'undefined' && currentUser) || JSON.parse(localStorage.getItem('jwt_user') || 'null') || {}; } catch (e) { return {}; } };
    const isAdmin = () => me().role === 'admin';
    const toast = (m, t, ms) => { if (typeof showToast === 'function') showToast(m, t, ms); };
    const tokenHdr = () => ({ Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') });
    const call = async (url, method, body) => {
        const h = tokenHdr(); if (body) h['Content-Type'] = 'application/json';
        const r = await fetch(url, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) { j = null; }
        return { ok: r.ok && !!j && j.ok !== false, status: r.status, body: j || {} };
    };
    const kb = n => { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; };
    const ymd = t => { const d = new Date(t); return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const S = { items: null, err: '', file: null, busy: false, blobUrl: '', viewId: 0, lastFocus: null, form: null, open: new Set() };

    // ── 목록(제목별 · 최신 판 + 이전 판 접힘) ──────────────────
    const groups = () => {
        const by = new Map();
        (S.items || []).forEach(x => { let g = by.get(x.title); if (!g) { g = { title: x.title, rows: [] }; by.set(x.title, g); } g.rows.push(x); });   // 서버가 제목 → 올린 순 내림차순으로 준다
        return [...by.values()];
    };
    const sub = x => [x.version ? esc(x.version) : '', x.effective_date ? '시행 ' + esc(x.effective_date) : '', '올린 날 ' + esc(ymd(x.created_at)), 'PDF ' + esc(kb(x.size))].filter(Boolean).join(' · ');
    const rowHtml = (x, cur) => `<li class="ps-row${cur ? '' : ' cr-prev'}" data-id="${x.id}">
            <div class="ps-row-main"><b>${esc(x.title)}${x.version ? ` <span class="cr-ver">${esc(x.version)}</span>` : ''}</b><span class="ps-row-sub">${sub({ ...x, version: '' })}</span></div>
            ${cur ? '' : '<span class="ps-badge seen">이전 판</span>'}
            <div class="cr-acts"><button type="button" class="ps-btn primary" data-cr="view" data-id="${x.id}" data-t="${esc(x.title + (x.version ? ' ' + x.version : ''))}">보기</button><a class="ps-btn" data-cr="dl" data-id="${x.id}" href="/api/rules/${x.id}/file?dl=1" download="${esc(x.title + (x.version ? '_' + x.version : ''))}.pdf">내려받기</a>${isAdmin() ? `<button type="button" class="ps-btn danger sm" data-cr="del" data-id="${x.id}" aria-label="${esc(x.title + (x.version ? ' ' + x.version : ''))} 지우기">지우기</button>` : ''}</div></li>`;
    function listHtml() {
        if (S.err) return `<p class="ps-empty" role="alert">${esc(S.err)} <button type="button" class="ps-link" data-cr="reload">다시 불러오기</button></p>`;
        if (S.items == null) return '<p class="ps-empty">불러오는 중</p>';
        const gs = groups();
        if (!gs.length) return '<p class="ps-empty">아직 올라온 회사 규정이 없어요. 올라오면 알림으로 알려 드려요.</p>';
        return '<ul class="ps-list cr-list">' + gs.map(g => rowHtml(g.rows[0], true) + (g.rows.length > 1
            ? `<li class="cr-oldwrap"><details class="cr-old"${S.open.has(g.title) ? ' open' : ''} data-title="${esc(g.title)}"><summary>이전 판 ${g.rows.length - 1}</summary><ul class="ps-list">${g.rows.slice(1).map(x => rowHtml(x, false)).join('')}</ul></details></li>` : '')).join('') + '</ul>';
    }

    // ── 관리자 올리기 ────────────────────────────────────────
    function adminHtml() {
        if (!isAdmin()) return '';
        const f = S.form || {};
        return `<section class="card ps-card" aria-labelledby="cr-up-h"><h2 id="cr-up-h">회사 규정 올리기 <small>관리자</small></h2>
            <p class="ps-note">같은 제목으로 올리면 새 판이 되고 옛 판은 「이전 판」으로 남아요. 올리면 전 직원에게 앱 알림이 가요.</p>
            <div class="ps-form">
                <label class="ps-f">규정 제목<input type="text" class="ps-in" id="cr-title" value="${esc(f.title || '')}" maxlength="120" placeholder="예: 급여규정" autocomplete="off"></label>
                <label class="ps-f">개정판(없으면 비움)<input type="text" class="ps-in" id="cr-version" value="${esc(f.version || '')}" maxlength="60" placeholder="예: 2026 개정안" autocomplete="off"></label>
                <label class="ps-f">시행일(없으면 비움)<input type="text" class="ps-in akm-date" id="cr-date" value="${esc(f.date || '')}" readonly autocomplete="off" placeholder="날짜 선택"></label>
                <label class="ps-check"><input type="checkbox" id="cr-notify"${f.notify === false ? '' : ' checked'}> 전 직원에게 앱 알림 보내기</label>
            </div>
            <div class="ps-drop" id="cr-drop" tabindex="0" role="button" aria-label="PDF 파일 고르기"><b>${S.file ? esc(S.file.name) + ' · ' + esc(kb(S.file.size)) : 'PDF 를 여기에 끌어다 놓거나 눌러서 고르세요'}</b><span>${S.file ? '다른 파일을 고르면 바뀌어요' : 'PDF 한 개 · 5MB 까지'}</span><input type="file" id="cr-file" accept="application/pdf,.pdf" hidden></div>
            <div class="ps-acts"><button type="button" class="ps-btn primary" id="cr-send"${S.file && !S.busy ? '' : ' disabled'}>${S.busy ? '올리는 중' : '올리기'}</button>${S.file && !S.busy ? '<button type="button" class="ps-btn" id="cr-clear">파일 빼기</button>' : ''}<span class="ps-msg" id="cr-msg" role="status"></span></div>
        </section>`;
    }
    function draw() {
        const root = $('rules-root'); if (!root) return;
        if ($('cr-title')) S.form = { title: $('cr-title').value, version: $('cr-version').value, date: $('cr-date').value, notify: $('cr-notify').checked };
        root.innerHTML = `<section class="card ps-card" aria-labelledby="cr-list-h"><h2 id="cr-list-h">회사 규정</h2><p class="ps-note">급여규정·인사규정 등 회사 규정 문서예요. 누구나 보고 내려받을 수 있어요.</p><div id="cr-list">${listHtml()}</div></section>` + adminHtml();
    }
    async function load() {
        draw();
        try { const r = await call('/api/rules'); if (!r.ok) throw new Error(r.body.error || '불러오지 못했어요.'); S.items = r.body.items || []; S.err = ''; }
        catch (e) { S.err = (e && e.message) || '불러오지 못했어요.'; }
        draw();
    }

    // ── 올리기 ──────────────────────────────────────────────
    function pickFile(list) {
        const f = [...(list || [])][0]; if (!f) return;
        if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return toast(`「${f.name}」은 PDF 가 아니에요.`, '', 4000);
        if (f.size > 5 * 1024 * 1024) return toast(`「${f.name}」은 5MB 를 넘어요.`, '', 4000);
        S.file = f; draw();
    }
    const b64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => rej(new Error('파일을 읽지 못했어요.')); r.readAsDataURL(file); });
    async function send() {
        if (S.busy || !S.file) return;
        const title = ($('cr-title').value || '').trim(), version = ($('cr-version').value || '').trim(), date = $('cr-date').value || null, notify = $('cr-notify').checked;
        const say = (t, bad) => { const m = $('cr-msg'); if (m) { m.textContent = t; m.classList.toggle('err', !!bad); } };   // 다시 그린 뒤에도 지금 있는 칸에 쓴다
        if (!title) { say('규정 제목을 적어 주세요.', true); $('cr-title').focus(); return; }
        S.busy = true; draw();
        try {
            const r = await call('/api/rules', 'POST', { title, version, effective_date: date, name: S.file.name, data: await b64(S.file), notify });
            S.busy = false;
            if (!r.ok) { draw(); say(r.body.error || '올리지 못했어요.', true); return; }
            S.file = null; ['cr-title', 'cr-version', 'cr-date'].forEach(id => { if ($(id)) $(id).value = ''; }); S.form = { title: '', version: '', date: '', notify }; await load();   // 칸을 먼저 비워야 draw() 가 옛 값을 다시 집지 않는다
            say(`「${title}${version ? ' ' + version : ''}」 올렸어요${r.body.prev_versions ? ' · 옛 판 ' + r.body.prev_versions + '건은 「이전 판」으로' : ''}${notify ? ' · 알림 ' + (r.body.notified || 0) + '명' : ''}`);
            toast('회사 규정을 올렸어요', 'lime');
        } catch (e) { S.busy = false; draw(); say('통신이 끊겼어요. 다시 눌러 주세요.', true); }
    }
    async function removeOne(btn) {
        if (!isAdmin() || !btn) return;
        if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = '정말 지우기'; setTimeout(() => { if (btn.isConnected) { btn.dataset.sure = ''; btn.textContent = '지우기'; } }, 4000); return; }
        btn.disabled = true; const r = await call('/api/rules/' + btn.dataset.id, 'DELETE').catch(() => ({ ok: false, body: {} }));
        if (!r.ok) { btn.disabled = false; btn.dataset.sure = ''; btn.textContent = '지우기'; return toast(r.body.error || '지우지 못했어요.', '', 4500); }
        toast('지웠어요', 'lime'); load();
    }

    // ── 보기(PDF) · 내려받기 ─────────────────────────────────
    const narrow = () => window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;
    function closeView() { const v = $('cr-view'); if (!v || v.hidden) return false; v.hidden = true; const f = $('cr-view-frame'); if (f) f.removeAttribute('src'); if (S.blobUrl) { URL.revokeObjectURL(S.blobUrl); S.blobUrl = ''; } document.body.classList.remove('ps-view-open');
        const back = S.lastFocus && S.lastFocus.isConnected ? S.lastFocus : [...document.querySelectorAll('#rules-root [data-cr="view"]')].find(b => Number(b.dataset.id) === S.viewId); if (back) back.focus({ preventScroll: true }); return true; }
    async function fetchPdf(id) {
        const r = await fetch('/api/rules/' + id + '/file', { headers: tokenHdr() });
        if (!r.ok) { let e = ''; try { e = (await r.json()).error; } catch (_) { } throw new Error(e || '열지 못했어요.'); }
        return new Blob([await r.arrayBuffer()], { type: 'application/pdf' });
    }
    async function view(id, title, btn) {
        if (S.viewBusy) return; S.viewBusy = true; S.lastFocus = btn || null; S.viewId = Number(id); const old = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = '여는 중'; }
        const tab = narrow() ? window.open('', '_blank') : null;   // 폰은 새 탭 — 누른 순간 창을 먼저 열어 둬야 막히지 않는다
        try {
            const url = URL.createObjectURL(await fetchPdf(id));
            if (narrow()) {
                if (tab) { tab.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 120000); }
                else { const a = document.createElement('a'); a.href = url; a.download = (title || '회사 규정') + '.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); toast('내려받은 파일에서 확인해 주세요', '', 3500); }
            } else {
                if (S.blobUrl) URL.revokeObjectURL(S.blobUrl); S.blobUrl = url;
                $('cr-view-title').textContent = title || '회사 규정'; $('cr-view-frame').src = url; const dl = $('cr-view-dl'); dl.href = url; dl.download = (title || '회사 규정') + '.pdf';
                $('cr-view').hidden = false; document.body.classList.add('ps-view-open'); $('cr-view-x').focus({ preventScroll: true });
            }
        } catch (e) { if (tab) try { tab.close(); } catch (_) { } toast((e && e.message) || '열지 못했어요.', '', 4500); }
        finally { S.viewBusy = false; const b = btn && btn.isConnected ? btn : null; if (b) { b.disabled = false; b.textContent = old; } }
    }
    async function download(a) {   // 토큰이 필요하니 링크를 그대로 따라가지 않고 받아서 저장한다
        const id = a.dataset.id, name = a.getAttribute('download') || '회사 규정.pdf'; a.setAttribute('aria-busy', 'true');
        try { const url = URL.createObjectURL(await fetchPdf(id)); const t = document.createElement('a'); t.href = url; t.download = name; document.body.appendChild(t); t.click(); t.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
        catch (e) { toast((e && e.message) || '내려받지 못했어요.', '', 4500); }
        finally { a.removeAttribute('aria-busy'); }
    }

    // ── 이벤트(한 번만) ──────────────────────────────────────
    function bind() {
        if (document.body.dataset.crBound) return; document.body.dataset.crBound = '1';
        document.addEventListener('click', e => {
            const t = e.target; if (!t.closest) return;
            if (t.closest('#cr-view-x') || t === $('cr-view')) return void closeView();
            if (!t.closest('#rules-root')) return;
            const b = t.closest('[data-cr]');
            if (b) { const k = b.dataset.cr;
                if (k === 'view') return void view(b.dataset.id, b.dataset.t, b);
                if (k === 'dl') { e.preventDefault(); return void download(b); }
                if (k === 'del') return void removeOne(b);
                if (k === 'reload') return void load();
            }
            if (t.closest('#cr-send')) return void send();
            if (t.closest('#cr-clear') && !S.busy) { S.file = null; return draw(); }
            if (t.closest('#cr-drop')) { const f = $('cr-file'); if (f) f.click(); }
        });
        document.addEventListener('toggle', e => { const d = e.target; if (d && d.classList && d.classList.contains('cr-old')) { if (d.open) S.open.add(d.dataset.title); else S.open.delete(d.dataset.title); } }, true);
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && closeView()) { e.preventDefault(); return; }
            if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.id === 'cr-drop') { e.preventDefault(); const f = $('cr-file'); if (f) f.click(); }
        });
        document.addEventListener('change', e => { const t = e.target; if (t && t.id === 'cr-file') { pickFile(t.files); t.value = ''; } });
        ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest('#cr-drop'); if (d) { e.preventDefault(); d.classList.add('over'); } }));
        ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest('#cr-drop'); if (!d) return; e.preventDefault(); d.classList.remove('over'); if (ev === 'drop' && e.dataTransfer && !S.busy) pickFile(e.dataTransfer.files); }));
    }

    // payslip.js setTab('rules') 가 부른다 · 알림(notiGo 'myinfo?rules=1')은 open()
    function open() { bind(); if (window.AkmPayslip && typeof window.AkmPayslip.setTab === 'function') window.AkmPayslip.setTab('rules'); else load(); const t = document.querySelector('#myinfo-tabs .ps-tab[data-pstab="rules"]'); if (t) t.scrollIntoView({ block: 'nearest' }); }
    window.AkmRules = { load: () => { bind(); return load(); }, open, _state: S };
    if (document.readyState !== 'loading') bind(); else document.addEventListener('DOMContentLoaded', bind);
})();
