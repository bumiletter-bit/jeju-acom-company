// #674(대표 10/12) 급여명세서 — 「내 정보」 메뉴의 [급여명세서] 탭
//   직원: 월 목록 → [조회](PDF) · 열면 「확인함」. 관리자(대표·경리): 올리기(여러 파일 · 파일 이름에서 직원 찾기) + 직원 × 월 표(열람 여부). 지우기는 대표만.
//   서버 계약 = payslip.js(루트). 금액은 화면도 서버도 읽지 않는다 — 파일만 주고받는다.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const me = () => { try { return (typeof currentUser !== 'undefined' && currentUser) || JSON.parse(localStorage.getItem('jwt_user') || 'null') || {}; } catch (e) { return {}; } };
    const isAdmin = () => me().role === 'admin', isOwner = () => isAdmin() && me().position === '대표';
    const toast = (m, t, ms) => { if (typeof showToast === 'function') showToast(m, t, ms); };
    const call = async (url, method, body) => {
        const h = { Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') }; if (body) h['Content-Type'] = 'application/json';
        const r = await fetch(url, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) { j = null; }
        return { ok: r.ok && !!j && j.ok !== false, status: r.status, body: j || {} };
    };
    const monthLabel = m => { const x = /^(\d{4})-(\d{2})$/.exec(String(m || '')); return x ? `${x[1]}년 ${Number(x[2])}월` : String(m || ''); };
    const kb = n => { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; };
    const md = t => { const d = new Date(t); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate(); };
    const S = { tab: 'info', mine: null, err: '', admin: null, aerr: '', files: [], busy: false, blobUrl: '', viewId: 0, lastFocus: null };

    // ── 탭(내 정보 | 급여명세서) ─────────────────────────────
    const TABS = ['info', 'pay', 'rules'];   // #687: 셋째 탭 「회사 규정」(rules.js 가 판을 그린다) — 탭 켜고 끄기는 여기 한 곳
    function setTab(t) {
        S.tab = TABS.includes(t) ? t : 'info';
        document.querySelectorAll('#myinfo-tabs .ps-tab').forEach(b => { const on = b.dataset.pstab === S.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
        TABS.forEach(k => { const el = $('myinfo-pane-' + k); if (el) el.hidden = S.tab !== k; });
        if (S.tab === 'pay') load(); else if (S.tab === 'rules' && window.AkmRules) window.AkmRules.load();
    }

    // ── 내 급여명세서 ────────────────────────────────────────
    function mineHtml() {
        if (S.err) return `<p class="ps-empty" role="alert">${esc(S.err)} <button type="button" class="ps-link" data-ps="reload">다시 불러오기</button></p>`;
        if (S.mine == null) return '<p class="ps-empty">불러오는 중</p>';
        if (!S.mine.length) return '<p class="ps-empty">아직 올라온 급여명세서가 없어요. 올라오면 알림으로 알려 드려요.</p>';
        return '<ul class="ps-list">' + S.mine.map(x => `<li class="ps-row${x.viewed_at ? '' : ' new'}">
            <div class="ps-row-main"><b>${esc(monthLabel(x.pay_month))}</b><span class="ps-row-sub">${x.pay_date ? '지급일 ' + esc(x.pay_date) + ' · ' : ''}PDF ${esc(kb(x.size))}</span></div>
            <span class="ps-badge${x.viewed_at ? ' seen' : ''}">${x.viewed_at ? '확인함 ' + esc(md(x.viewed_at)) : '새로 올라옴'}</span>
            <button type="button" class="ps-btn primary" data-ps="view" data-id="${x.id}" data-t="${esc(x.title || monthLabel(x.pay_month))}">조회</button></li>`).join('') + '</ul>';
    }

    // ── 관리자: 올리기 + 직원 × 월 표 ─────────────────────────
    const guessUser = name => {   // 파일 이름에 직원 이름이 통째로 들어 있을 때만(한 사람으로 좁혀질 때만) 고른다 — 애매하면 사람이 고른다
        const us = (S.admin && S.admin.users) || [], base = String(name || '').replace(/\.[^.]*$/, '').replace(/\s+/g, '');
        const hit = us.filter(u => u.name && base.includes(String(u.name).replace(/\s+/g, ''))); return hit.length === 1 ? hit[0].id : 0;
    };
    const nowMonth = () => { const d = new Date(Date.now() + 9 * 3600000); return d.toISOString().slice(0, 7); };
    function monthOpts(sel) {
        const out = [], d = new Date(Date.now() + 9 * 3600000); let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
        for (let i = 0; i < 18; i++) { const v = y + '-' + String(m).padStart(2, '0'); out.push(`<option value="${v}"${v === sel ? ' selected' : ''}>${monthLabel(v)}</option>`); if (--m < 1) { m = 12; y--; } }
        return out.join('');
    }
    function filesHtml() {
        if (!S.files.length) return '';
        const us = (S.admin && S.admin.users) || [];
        return '<ul class="ps-files" aria-label="올릴 파일">' + S.files.map((f, i) => `<li class="ps-file" data-i="${i}" data-st="${f.st || ''}">
            <span class="ps-file-n" title="${esc(f.name)}">${esc(f.name)}</span>
            <label class="ps-sr" for="ps-file-u-${i}">${esc(f.name)} — 받을 직원</label>
            <select class="ps-in" id="ps-file-u-${i}" data-ps-user="${i}"${f.st === 'ok' || S.busy ? ' disabled' : ''}><option value="">직원 고르기</option>${us.map(u => `<option value="${u.id}"${Number(f.uid) === Number(u.id) ? ' selected' : ''}>${esc(u.name)}${u.position ? ' · ' + esc(u.position) : ''}</option>`).join('')}</select>
            <span class="ps-file-msg" data-k="${f.st || ''}" role="status">${esc(f.msg || (f.uid ? '' : '직원을 골라 주세요'))}</span>
            ${f.st === 'dup' ? `<button type="button" class="ps-btn sm" data-ps="replace" data-i="${i}">교체</button>` : ''}
            ${f.st === 'ok' || S.busy ? '' : `<button type="button" class="ps-x" data-ps="drop" data-i="${i}" aria-label="${esc(f.name)} 빼기">×</button>`}</li>`).join('') + '</ul>';
    }
    function gridHtml() {
        if (S.aerr) return `<p class="ps-empty" role="alert">${esc(S.aerr)}</p>`;
        if (!S.admin) return '<p class="ps-empty">불러오는 중</p>';
        const items = S.admin.items || [], users = S.admin.users || [];
        const months = [...new Set(items.map(x => x.pay_month))].sort().reverse();
        if (!months.length) return '<p class="ps-empty">아직 올린 급여명세서가 없어요. 위에서 파일을 올리면 여기에 직원별로 보여요.</p>';
        const by = new Map(items.map(x => [x.user_id + '|' + x.pay_month, x]));
        const rows = users.filter(u => months.some(m => by.has(u.id + '|' + m))).concat(users.filter(u => !months.some(m => by.has(u.id + '|' + m))));
        return `<div class="ps-grid-wrap" tabindex="0" role="region" aria-label="직원별 급여명세서 표"><table class="ps-grid"><thead><tr><th scope="col">직원</th>${months.map(m => `<th scope="col">${esc(monthLabel(m).replace(/^\d{2}(\d{2})년 /, '$1.'))}</th>`).join('')}</tr></thead><tbody>`
            + rows.map(u => `<tr><th scope="row">${esc(u.name)}<small>${esc(u.position || '')}</small></th>${months.map(m => { const x = by.get(u.id + '|' + m);
                return x ? `<td><button type="button" class="ps-cell${x.viewed_at ? ' seen' : ''}" data-ps="view" data-id="${x.id}" data-admin="1" data-t="${esc(u.name + ' · ' + monthLabel(m))}" title="${esc(x.file_name)} · ${x.viewed_at ? '직원이 열어 봄 ' + esc(md(x.viewed_at)) : '아직 안 열어 봄'}">${x.viewed_at ? '열람' : '안 봄'}</button></td>` : '<td><span class="ps-cell none" aria-label="없음">–</span></td>'; }).join('')}</tr>`).join('')
            + '</tbody></table></div><p class="ps-note">칸을 누르면 그 명세서를 열어요(열어 본 기록이 남아요). 「열람」 = 직원이 직접 열어 본 것.</p>';
    }
    function adminHtml() {
        if (!isAdmin()) return '';
        const m = (S.form && S.form.month) || nowMonth(), pd = (S.form && S.form.date) || '', nt = !S.form || S.form.notify !== false;
        return `<section class="card ps-card" aria-labelledby="ps-up-h"><h2 id="ps-up-h">급여명세서 올리기 <small>관리자</small></h2>
            <div class="ps-form">
                <label class="ps-f">귀속 월<select class="ps-in" id="ps-month">${monthOpts(m)}</select></label>
                <label class="ps-f">지급일(없으면 비움)<input type="text" class="ps-in akm-date" id="ps-date" value="${esc(pd)}" readonly autocomplete="off" placeholder="날짜 선택"></label>
                <label class="ps-check"><input type="checkbox" id="ps-notify"${nt ? ' checked' : ''}> 직원에게 앱 알림 보내기</label>
            </div>
            <div class="ps-drop" id="ps-drop" tabindex="0" role="button" aria-label="PDF 파일 고르기 — 여러 개를 한 번에 올릴 수 있어요"><b>PDF 를 여기에 끌어다 놓거나 눌러서 고르세요</b><span>직원 한 명에 파일 하나 · 여러 개 한 번에 · 파일 이름에 직원 이름이 있으면 자동으로 골라져요 · 5MB 까지</span><input type="file" id="ps-file" accept="application/pdf,.pdf" multiple hidden></div>
            <div id="ps-files">${filesHtml()}</div>
            <div class="ps-acts"><button type="button" class="ps-btn primary" id="ps-send"${S.files.some(f => f.st !== 'ok') && !S.busy ? '' : ' disabled'}>${S.busy ? '올리는 중' : '올리기'}</button><button type="button" class="ps-btn" id="ps-clear"${S.files.length && !S.busy ? '' : ' hidden'}>목록 비우기</button><span class="ps-msg" id="ps-msg" role="status"></span></div>
        </section>
        <section class="card ps-card" aria-labelledby="ps-grid-h"><h2 id="ps-grid-h">직원별 현황 <small>관리자</small></h2><div id="ps-grid">${gridHtml()}</div></section>`;
    }
    function draw() {
        const root = $('payslip-root'); if (!root) return;
        const keep = { month: ($('ps-month') || {}).value, date: ($('ps-date') || {}).value, notify: $('ps-notify') ? $('ps-notify').checked : undefined };
        if (keep.month) S.form = keep;
        root.innerHTML = `<section class="card ps-card" aria-labelledby="ps-mine-h"><h2 id="ps-mine-h">내 급여명세서</h2><p class="ps-note">본인만 볼 수 있어요. 내용이 다르면 경리 담당에게 알려 주세요.</p><div id="ps-mine">${mineHtml()}</div></section>` + adminHtml();
    }
    async function load() {
        draw();
        try { const r = await call('/api/payslips/mine'); if (!r.ok) throw new Error(r.body.error || '불러오지 못했어요.'); S.mine = r.body.items || []; S.err = ''; }
        catch (e) { S.err = (e && e.message) || '불러오지 못했어요.'; }
        if (isAdmin()) { try { const r = await call('/api/payslips/admin'); if (!r.ok) throw new Error(r.body.error || '불러오지 못했어요.'); S.admin = r.body; S.aerr = ''; S.files.forEach(f => { if (!f.uid) f.uid = guessUser(f.name); }); } catch (e) { S.aerr = (e && e.message) || '불러오지 못했어요.'; } }
        draw();
    }

    // ── 올리기 ──────────────────────────────────────────────
    function addFiles(list) {
        [...(list || [])].forEach(f => {
            if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return toast(`「${f.name}」은 PDF 가 아니에요.`, '', 4000);
            if (f.size > 5 * 1024 * 1024) return toast(`「${f.name}」은 5MB 를 넘어요.`, '', 4000);
            if (S.files.some(x => x.name === f.name && x.size === f.size)) return;
            S.files.push({ file: f, name: f.name, size: f.size, uid: guessUser(f.name), st: '', msg: '' });
        });
        draw();
    }
    const b64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => rej(new Error('파일을 읽지 못했어요.')); r.readAsDataURL(file); });
    async function sendOne(f, replace) {
        const month = $('ps-month').value, date = $('ps-date').value || null, notify = $('ps-notify').checked;
        if (!f.uid) { f.st = 'err'; f.msg = '직원을 골라 주세요'; return; }
        try {
            const r = await call('/api/payslips', 'POST', { user_id: Number(f.uid), pay_month: month, pay_date: date, name: f.name, data: await b64(f.file), notify, ...(replace ? { replace: true } : {}) });
            if (r.ok) { f.st = 'ok'; f.msg = (r.body.replaced ? '교체했어요' : '올렸어요') + (r.body.notified ? ' · 알림 보냄' : ''); }
            else if (r.status === 409 && r.body.exists) { f.st = 'dup'; f.msg = '이 달 명세서가 이미 있어요 — 바꾸려면 [교체]'; }
            else { f.st = 'err'; f.msg = r.body.error || '올리지 못했어요'; }
        } catch (e) { f.st = 'err'; f.msg = '통신이 끊겼어요. 다시 눌러 주세요'; }
    }
    async function sendAll() {
        if (S.busy) return; const todo = S.files.filter(f => f.st !== 'ok' && f.st !== 'dup'); if (!todo.length) return;
        const two = new Map(); S.files.filter(f => f.st !== 'ok' && f.uid).forEach(f => two.set(String(f.uid), (two.get(String(f.uid)) || 0) + 1));
        if ([...two.values()].some(n => n > 1)) { const m = $('ps-msg'); if (m) { m.textContent = '같은 직원에게 파일이 둘 이상 골라져 있어요. 직원을 다시 확인해 주세요.'; m.classList.add('err'); } return; }
        S.busy = true; draw();
        for (const f of todo) { await sendOne(f, false); draw(); }
        S.busy = false; const okN = S.files.filter(f => f.st === 'ok').length, bad = S.files.length - okN;
        await load(); const m = $('ps-msg'); if (m) { m.textContent = `${okN}건 올림${bad ? ' · ' + bad + '건은 아래 줄을 확인해 주세요' : ''}`; m.classList.toggle('err', !!bad); }
        if (okN && !bad) toast('급여명세서를 올렸어요', 'lime');
    }

    // ── 보기(PDF) ───────────────────────────────────────────
    const narrow = () => window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;
    function closeView() { const v = $('ps-view'); if (!v || v.hidden) return false; v.hidden = true; const f = $('ps-view-frame'); if (f) f.removeAttribute('src'); if (S.blobUrl) { URL.revokeObjectURL(S.blobUrl); S.blobUrl = ''; } document.body.classList.remove('ps-view-open');
        const back = S.lastFocus && S.lastFocus.isConnected ? S.lastFocus : [...document.querySelectorAll('#payslip-root [data-ps="view"]')].find(b => Number(b.dataset.id) === S.viewId);   // 목록을 다시 그렸으면 같은 줄의 [조회]로
        if (back) back.focus({ preventScroll: true }); return true; }
    async function view(id, title, btn, asAdmin) {
        if (S.viewBusy) return; S.viewBusy = true; S.lastFocus = btn || null; S.viewId = Number(id); const old = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = '여는 중'; }
        // 폰은 새 탭으로 연다 — 누른 그 순간에 창을 먼저 열어 둬야 브라우저가 막지 않는다
        const tab = narrow() ? window.open('', '_blank') : null;
        try {
            const r = await fetch('/api/payslips/' + id + '/file', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') } });
            if (!r.ok) { let e = ''; try { e = (await r.json()).error; } catch (_) { } throw new Error(e || '열지 못했어요.'); }
            const blob = new Blob([await r.arrayBuffer()], { type: 'application/pdf' }), url = URL.createObjectURL(blob);
            if (narrow()) {
                if (tab) { tab.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 120000); }
                else { const a = document.createElement('a'); a.href = url; a.download = (title || '급여명세서') + '.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); toast('내려받은 파일에서 확인해 주세요', '', 3500); }
            } else {
                if (S.blobUrl) URL.revokeObjectURL(S.blobUrl); S.blobUrl = url; S.viewId = Number(id);
                $('ps-view-title').textContent = title || '급여명세서'; $('ps-view-frame').src = url; const dl = $('ps-view-dl'); dl.href = url; dl.download = (title || '급여명세서') + '.pdf';
                const del = $('ps-view-del'); del.hidden = !(asAdmin && isOwner()); $('ps-view').hidden = false; document.body.classList.add('ps-view-open'); $('ps-view-x').focus({ preventScroll: true });
            }
            if (!asAdmin) { const it = (S.mine || []).find(x => Number(x.id) === Number(id)); if (it && !it.viewed_at) { it.viewed_at = new Date().toISOString(); const box = $('ps-mine'); if (box) box.innerHTML = mineHtml(); } }
        } catch (e) { if (tab) try { tab.close(); } catch (_) { } toast((e && e.message) || '열지 못했어요.', '', 4500); }
        finally { S.viewBusy = false; const b = btn && btn.isConnected ? btn : null; if (b) { b.disabled = false; b.textContent = old; } }
    }
    async function removeOne() {
        if (!isOwner() || !S.viewId) return; const b = $('ps-view-del');
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '정말 지우기(한 번 더)'; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = '지우기'; } }, 4000); return; }
        b.disabled = true; const r = await call('/api/payslips/' + S.viewId, 'DELETE').catch(() => ({ ok: false, body: {} })); b.disabled = false; b.dataset.sure = ''; b.textContent = '지우기';
        if (!r.ok) return toast(r.body.error || '지우지 못했어요.', '', 4500);
        closeView(); toast('지웠어요', 'lime'); load();
    }

    // ── 이벤트(한 번만) ──────────────────────────────────────
    function bind() {
        if (document.body.dataset.psBound) return; document.body.dataset.psBound = '1';
        document.addEventListener('click', e => {
            const t = e.target; if (!t.closest) return;
            const tb = t.closest('#myinfo-tabs .ps-tab'); if (tb) return setTab(tb.dataset.pstab);
            if (t.closest('#ps-view-x') || t === $('ps-view')) return void closeView();
            if (t.closest('#ps-view-del')) return void removeOne();
            if (!t.closest('#payslip-root')) return;
            const b = t.closest('[data-ps]');
            if (b) { const k = b.dataset.ps, i = Number(b.dataset.i);
                if (k === 'view') return void view(b.dataset.id, b.dataset.t, b, b.dataset.admin === '1');
                if (k === 'reload') return void load();
                if (k === 'drop' && !S.busy) { S.files.splice(i, 1); return draw(); }
                if (k === 'replace' && !S.busy && S.files[i]) { S.busy = true; draw(); return void sendOne(S.files[i], true).then(() => { S.busy = false; return load(); }); }
            }
            if (t.closest('#ps-send')) return void sendAll();
            if (t.closest('#ps-clear') && !S.busy) { S.files = []; return draw(); }
            if (t.closest('#ps-drop')) { const f = $('ps-file'); if (f) f.click(); }
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && closeView()) { e.preventDefault(); return; }
            if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.id === 'ps-drop') { e.preventDefault(); const f = $('ps-file'); if (f) f.click(); }
            const tb = e.target && e.target.closest && e.target.closest('#myinfo-tabs .ps-tab'); if (tb && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setTab(TABS[(TABS.indexOf(S.tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]); const on = document.querySelector('#myinfo-tabs .ps-tab.active'); if (on) on.focus(); }
        });
        document.addEventListener('change', e => {
            const t = e.target; if (!t) return;
            if (t.id === 'ps-file') { addFiles(t.files); t.value = ''; return; }
            if (t.dataset && t.dataset.psUser != null) { const f = S.files[Number(t.dataset.psUser)]; if (f) { f.uid = Number(t.value) || 0; f.st = ''; f.msg = ''; draw(); } }
        });
        ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest('#ps-drop'); if (d) { e.preventDefault(); d.classList.add('over'); } }));
        ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest('#ps-drop'); if (!d) return; e.preventDefault(); d.classList.remove('over'); if (ev === 'drop' && e.dataTransfer && !S.busy) addFiles(e.dataTransfer.files); }));
    }

    // 메뉴에 들어올 때(app.js switchPage) · 알림에서 올 때(notiGo 'myinfo?pay=1')
    function render() { bind(); setTab(S.tab); }
    function open() { bind(); setTab('pay'); const t = document.querySelector('#myinfo-tabs .ps-tab[data-pstab="pay"]'); if (t) t.scrollIntoView({ block: 'nearest' }); }
    window.AkmPayslip = { render, open, setTab: t => { bind(); setTab(t); }, _state: S };   // #687: rules.js 가 setTab('rules') 로 자기 탭을 연다
    if (document.readyState !== 'loading') bind(); else document.addEventListener('DOMContentLoaded', bind);
})();
