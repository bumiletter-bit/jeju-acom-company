// #775 감귤체험 예약 — 에이전트 오피스 창(전체 화면 겹 · body 직계 · Esc·뒤로가기·× 로 닫힘)
//   들어오는 길 = [+] 메뉴 「체험 예약」(#desk-exp-now) · 「지금 챙길 일」의 체험 줄(.exp-go) · window.AkmExp.open()
//   서버 계약 = experience.js 머리 주석: GET /api/agent-office/experience?from&to · PATCH …/:id · POST …/:id/visit · GET …/export.xlsx · GET …/:id/sms-preview · GET/PUT …/settings · GET …/:id/raw
//   보는 것: 맨 위 요약(오늘·내일·날짜 확인 필요 · 손님 문자 켜짐/꺼짐) → 날짜 확인 필요 묶음 → 날짜별(시간순 · 스토어/플레이스 배지 · 인원 · 방문 체크 · 고치기)
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const DOW = '일월화수목금토';
    const dLabel = d => { if (!d) return '날짜 미정'; const [, m, dd] = d.split('-'); const w = DOW[new Date(d + 'T00:00:00Z').getUTCDay()]; const t = today(); return `${+m}월 ${+dd}일(${w})` + (d === t ? ' · 오늘' : d === addDays(t, 1) ? ' · 내일' : ''); };
    const toast = (m) => { if (typeof window.showToast === 'function') window.showToast(m); };
    const ST = { confirmed: '확정', canceled: '취소', returned: '반품', visited: '방문', unknown: '메일 확인 필요' };
    const isAdmin = () => { try { const u = JSON.parse(localStorage.getItem('jwt_user') || '{}'); return u.role === 'admin'; } catch (e) { return false; } };
    async function call(url, method, body) {
        const r = await fetch(url, { method: method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') }, body: body ? JSON.stringify(body) : undefined });
        if (r.status === 401 && typeof window.akmSessionExpired === 'function') window.akmSessionExpired();
        const j = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, body: j || {} };
    }
    const X = { layer: null, from: today(), data: null, busy: false, showOff: false, edit: 0, timer: 0, pushed: false, set: false, setData: null };

    function shell() {
        const el = document.createElement('div');
        el.className = 'xp-layer'; el.id = 'xp-layer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '체험 예약');
        el.innerHTML = `<div class="xp-win">
            <div class="xp-head"><h2>체험 예약</h2><span class="xp-sub">스토어 주문 · 플레이스 예약</span><button type="button" class="xp-x" id="xp-close" aria-label="닫기">×</button></div>
            <div class="xp-bar">
                <div class="xp-nav"><button type="button" class="xp-btn" data-nav="-7" aria-label="한 주 앞">‹</button><button type="button" class="xp-btn" data-nav="0">오늘</button><button type="button" class="xp-btn" data-nav="7" aria-label="한 주 뒤">›</button><span class="xp-range" id="xp-range"></span></div>
                <div class="xp-tools"><label class="xp-chk"><input type="checkbox" id="xp-off"> 취소 포함</label><button type="button" class="xp-btn" id="xp-xlsx">엑셀</button><button type="button" class="xp-btn" id="xp-set-btn" hidden>문자 설정</button></div>
            </div>
            <div class="xp-sum" id="xp-sum"></div>
            <div class="xp-set" id="xp-set" hidden></div>
            <div class="xp-body" id="xp-body"><div class="xp-empty">불러오는 중…</div></div>
        </div>`;
        document.body.appendChild(el);
        el.addEventListener('click', onClick);
        el.addEventListener('change', e => { if (e.target.id === 'xp-off') { X.showOff = e.target.checked; render(); } });
        if (isAdmin()) $('xp-set-btn').hidden = false;
        return el;
    }
    async function load(quiet) {
        if (X.busy) return; X.busy = true;
        try {
            const r = await call(`/api/agent-office/experience?from=${X.from}&to=${addDays(X.from, 13)}`);
            if (!r.ok) { if (!quiet) $('xp-body').innerHTML = `<div class="xp-empty">${esc(r.body.error || '체험 예약을 읽지 못했어요')}</div>`; return; }
            X.data = r.body; render();
        } catch (e) { if (!quiet) $('xp-body').innerHTML = '<div class="xp-empty">연결이 끊겼어요 — 잠시 뒤 다시</div>'; }
        finally { X.busy = false; }
    }
    const people = b => [b.exp_count ? `체험 ${b.exp_count}` : '', b.entry_count ? `입장 ${b.entry_count}` : '', b.infant_count ? `유아 ${b.infant_count}` : ''].filter(Boolean).join(' · ') || '인원 0';
    const telLink = p => p ? `<a class="xp-tel" href="tel:${esc(p)}">${esc(String(p).replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3'))}</a>` : '<span class="xp-dim">연락처 없음</span>';
    function rowHtml(b) {
        const off = ['canceled', 'returned'].includes(b.status), vis = b.status === 'visited';
        const badge = b.source === 'store' ? '<i class="xp-src st">스토어</i>' : '<i class="xp-src pl">플레이스</i>';
        const chk = !b.date_ok ? `<i class="xp-need">${esc(b.date_why || '날짜 확인 필요')}</i>` : '';
        const smsFail = (!b.sms_recv_at && Number(b.sms_recv_tries) >= 3) || (!b.sms_eve_at && Number(b.sms_eve_tries) >= 3);   // 3번 실패 = 멈춤(서버) · 직원이 전화로
        const cf = b.confirm_state === 'failed' ? `<i class="xp-sms err" title="${esc(b.confirm_error || '')}">발주확인 실패</i>` : b.confirm_state === 'skipped_claim' ? `<i class="xp-sms err" title="${esc(b.confirm_error || '')}">자동 안 함 · 클레임 이력 — 센터에서 발주확인</i>` : '';   // #780 3번 실패 = 센터에서 직접
        const sms = b.source !== 'store' ? '' : b.sms_skip === 'refused' ? '<i class="xp-sms err" title="문자봇 수신거부 기억 — 문자 안 보냄">수신거부</i>' : smsFail ? `<i class="xp-sms err" title="${esc(b.sms_error || '')}">문자 실패</i>` : b.sms_recv_at ? '<i class="xp-sms ok" title="접수 문자 보냄">문자✓</i>' : '';
        const editing = X.edit === b.id;
        return `<li class="xp-row${off ? ' off' : ''}${vis ? ' vis' : ''}" data-id="${b.id}">
            <span class="xp-time">${esc(b.visit_time || '--:--')}</span>
            <div class="xp-main"><div class="xp-l1">${badge}<b class="xp-name">${esc(b.name || '(이름 없음)')}</b>${telLink(b.phone)}${chk}</div>
                <div class="xp-l2"><span>${esc(people(b))}</span>${b.amount ? `<span>${Number(b.amount).toLocaleString('ko-KR')}원</span>` : ''}<span class="xp-st s-${esc(b.status)}">${ST[b.status] || esc(b.status)}</span>${cf}${sms}${b.memo ? `<span class="xp-memo">${esc(b.memo)}</span>` : ''}</div></div>
            <div class="xp-acts">${off || b.status === 'unknown' ? '' : `<button type="button" class="xp-btn xp-visit${vis ? ' on' : ''}" data-act="visit" aria-pressed="${vis}">${vis ? '방문함' : '방문'}</button>`}<button type="button" class="xp-btn" data-act="edit" aria-expanded="${editing}">고치기</button></div>
            ${editing ? editHtml(b) : ''}</li>`;
    }
    function editHtml(b) {
        return `<div class="xp-edit" data-id="${b.id}">
            <label>방문일<input type="text" inputmode="numeric" id="xp-e-date" value="${esc(b.visit_date || '')}" placeholder="2026-11-01"></label>
            <label>시간<input type="text" id="xp-e-time" value="${esc(b.visit_time || '')}" placeholder="13:30"></label>
            <label>체험<input type="number" min="0" max="200" id="xp-e-exp" value="${b.exp_count || 0}"></label>
            <label>입장<input type="number" min="0" max="200" id="xp-e-entry" value="${b.entry_count || 0}"></label>
            <label>유아<input type="number" min="0" max="200" id="xp-e-inf" value="${b.infant_count || 0}"></label>
            <label class="w">메모<input type="text" id="xp-e-memo" maxlength="500" value="${esc(b.memo || '')}"></label>
            ${b.option_text ? `<div class="xp-raw"><b>주문 옵션 글</b>${esc(b.option_text)}</div>` : ''}
            <div class="xp-edit-acts"><button type="button" class="xp-btn pri" data-act="save">저장</button>${b.has_raw ? '<button type="button" class="xp-btn" data-act="raw">메일 원문</button>' : ''}${b.source === 'store' ? '<button type="button" class="xp-btn" data-act="sms">문자 미리보기</button>' : ''}
            ${['confirmed', 'unknown'].includes(b.status) ? '<button type="button" class="xp-btn warn" data-act="cancel">예약 취소로</button>' : b.status === 'canceled' ? '<button type="button" class="xp-btn" data-act="restore">확정으로 되돌리기</button>' : ''}<button type="button" class="xp-btn" data-act="close-edit">닫기</button></div>
            <div class="xp-pre" id="xp-pre" hidden></div></div>`;
    }
    function render() {
        const d = X.data; if (!d || !X.layer) return;
        const s = d.summary || {};
        $('xp-range').textContent = `${dLabel(d.from).replace(/ · .*/, '')} ~ ${dLabel(d.to).replace(/ · .*/, '')}`;
        $('xp-sum').innerHTML = `<div class="xp-card"><b>${s.today || 0}팀</b><span>오늘 · ${s.today_people || 0}명</span></div><div class="xp-card"><b>${s.tomorrow || 0}팀</b><span>내일 · ${s.tomorrow_people || 0}명</span></div>
            <div class="xp-card${s.need_check ? ' warn' : ''}"><b>${s.need_check || 0}</b><span>날짜 확인 필요</span></div><div class="xp-card sms"><b>${d.settings_view && d.settings_view.sms_enabled ? '켜짐' : '꺼짐'}</b><span>손님 문자</span></div>`;
        const items = (d.items || []).filter(b => X.showOff || !['canceled', 'returned'].includes(b.status));
        const need = items.filter(b => !b.date_ok && ['confirmed', 'unknown'].includes(b.status));
        const days = new Map();
        for (const b of items) { if (need.includes(b) || !b.visit_date || b.visit_date < d.from || b.visit_date > d.to) continue; if (!days.has(b.visit_date)) days.set(b.visit_date, []); days.get(b.visit_date).push(b); }
        let html = '';
        if (need.length) html += `<section class="xp-day need"><h3>날짜 확인 필요 <small>${need.length}건 · 손님께 확인한 뒤 [고치기]에서 날짜·시간을 넣어 주세요(넣으면 문자 대상)</small></h3><ul>${need.map(rowHtml).join('')}</ul></section>`;
        for (const [day, list] of [...days.entries()].sort()) {
            const live = list.filter(b => !['canceled', 'returned'].includes(b.status));
            const tot = k => live.reduce((a, b) => a + (Number(b[k]) || 0), 0);
            html += `<section class="xp-day${day === today() ? ' today' : ''}"><h3>${esc(dLabel(day))} <small>${live.length}팀 · 체험 ${tot('exp_count')} · 입장 ${tot('entry_count')}${tot('infant_count') ? ' · 유아 ' + tot('infant_count') : ''}</small></h3><ul>${list.map(rowHtml).join('')}</ul></section>`;
        }
        $('xp-body').innerHTML = html || '<div class="xp-empty">이 기간엔 체험 예약이 없어요.</div>';
        if (X.edit) { const f = $('xp-e-date'); if (f && !X.layer.contains(document.activeElement)) f.focus({ preventScroll: true }); }
    }
    async function onClick(e) {
        if (e.target.closest('#xp-close')) return close();
        const nav = e.target.closest('[data-nav]');
        if (nav) { const n = +nav.dataset.nav; X.from = n ? addDays(X.from, n) : today(); X.edit = 0; return load(); }
        if (e.target.closest('#xp-xlsx')) return xlsx();
        if (e.target.closest('#xp-set-btn')) return toggleSet();
        if (e.target.closest('#xp-set-save')) return saveSet();
        const btn = e.target.closest('[data-act]'); if (!btn) return;
        const li = btn.closest('[data-id]'); const id = li ? +li.dataset.id : 0; const b = (X.data.items || []).find(x => x.id === id);
        const act = btn.dataset.act;
        if (act === 'edit') { X.edit = X.edit === id ? 0 : id; return render(); }
        if (act === 'close-edit') { X.edit = 0; return render(); }
        if (act === 'visit') {
            btn.disabled = true; const r = await call(`/api/agent-office/experience/${id}/visit`, 'POST', { on: b.status !== 'visited' });
            if (!r.ok) { toast(r.body.error || '저장하지 못했어요'); btn.disabled = false; return; }
            Object.assign(b, r.body.item); return render();
        }
        if (act === 'save' || act === 'cancel' || act === 'restore') {
            const body = {};
            if (act === 'save') {
                const v = id2 => ($(id2) || {}).value;
                const nd = String(v('xp-e-date') || '').trim(), nt = String(v('xp-e-time') || '').trim();
                if (nd !== (b.visit_date || '')) body.visit_date = nd || null;
                if (nt !== (b.visit_time || '')) body.visit_time = nt || null;
                for (const [k, f] of [['exp_count', 'xp-e-exp'], ['entry_count', 'xp-e-entry'], ['infant_count', 'xp-e-inf']]) { const n = Number(v(f)); if (n !== Number(b[k] || 0)) body[k] = n; }
                const memo = String(v('xp-e-memo') || ''); if (memo !== (b.memo || '')) body.memo = memo;
                if (!Object.keys(body).length) { X.edit = 0; return render(); }
            } else body.status = act === 'cancel' ? 'canceled' : 'confirmed';
            btn.disabled = true; const r = await call(`/api/agent-office/experience/${id}`, 'PATCH', body);
            if (!r.ok) { toast(r.body.error || '저장하지 못했어요'); btn.disabled = false; return; }
            Object.assign(b, r.body.item); X.edit = 0; toast('저장했어요'); return load(true);
        }
        if (act === 'sms' || act === 'raw') {
            const pre = $('xp-pre'); pre.hidden = false; pre.textContent = '불러오는 중…';
            const r = await call(act === 'sms' ? `/api/agent-office/experience/${id}/sms-preview` : `/api/agent-office/experience/${id}/raw`);
            if (!r.ok) { pre.textContent = r.body.error || '읽지 못했어요'; return; }
            pre.textContent = act === 'sms' ? `[접수 즉시]\n${r.body.recv}\n\n[방문 전날]\n${r.body.eve}\n\n${r.body.will_send ? '→ 손님 문자가 켜져 있어 보낼 대상이에요' : '→ 지금은 보내지 않아요(문자 꺼짐 · 날짜 확인 필요 · 취소 · 연락처 없음 중 하나)'}` : (r.body.raw || '(원문 없음)');
        }
    }
    async function xlsx() {
        const to = addDays(X.from, 13);
        try {
            const r = await fetch(`/api/agent-office/experience/export.xlsx?from=${X.from}&to=${to}`, { headers: { Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') } });
            if (!r.ok) { toast('엑셀을 만들지 못했어요'); return; }
            const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `체험예약_${X.from}_${to}.xlsx`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } catch (e) { toast('엑셀을 내려받지 못했어요'); }
    }
    async function toggleSet() {
        const box = $('xp-set'); if (!box.hidden) { box.hidden = true; return; }
        box.hidden = false; box.innerHTML = '<div class="xp-empty">불러오는 중…</div>';
        const r = await call('/api/agent-office/experience/settings'); if (!r.ok) { box.innerHTML = `<div class="xp-empty">${esc(r.body.error || '설정을 읽지 못했어요')}</div>`; return; }
        const n = r.body.notify || {};
        box.innerHTML = `<div class="xp-set-grid">
            <label class="xp-chk"><input type="checkbox" id="xp-s-on"${n.enabled ? ' checked' : ''}> 손님 문자 보내기(접수 즉시 1통 · 방문 전날 낮 1통 · 스토어 주문만)</label>
            <label class="xp-chk"><input type="checkbox" id="xp-s-ac"${n.auto_confirm !== false ? ' checked' : ''}> 스토어 체험 주문 자동 발주확인(결제되면 바로 · 배송 없는 상품이라 곧 배송완료)</label>
            <label>하루 상한<input type="number" min="1" max="300" id="xp-s-cap" value="${esc(n.daily_cap)}"></label>
            <label>접수 문자 시간<input type="text" id="xp-s-rfrom" value="${esc(n.recv_from)}" placeholder="09:00"> ~ <input type="text" id="xp-s-rto" value="${esc(n.recv_to)}" placeholder="21:00"></label>
            <label>전날 문자 시간<input type="text" id="xp-s-from" value="${esc(n.eve_from)}" placeholder="10:00"> ~ <input type="text" id="xp-s-to" value="${esc(n.eve_to)}" placeholder="18:00"></label>
            <label>발신번호<input type="text" id="xp-s-sender" value="${esc(n.sender || '')}" placeholder="비우면 회사 기본 번호(알리고에 등록된 번호만)"></label>
            <label class="w">접수 문자<textarea id="xp-s-recv" rows="9">${esc(n.tpl_recv)}</textarea></label>
            <label class="w">전날 문자<textarea id="xp-s-eve" rows="4">${esc(n.tpl_eve)}</textarea></label>
            <p class="xp-hint">자리표 = {이름} {월} {일} {시간} {요일} {체험} {입장} {유아}(있을 때만 「 · 유아 n명」) · 문자에는 이모지가 안 나가요</p>
            <div class="xp-edit-acts"><button type="button" class="xp-btn pri" id="xp-set-save">설정 저장</button></div></div>`;
    }
    async function saveSet() {
        const v = id => ($(id) || {}).value;
        const body = { enabled: !!($('xp-s-on') || {}).checked, auto_confirm: !!($('xp-s-ac') || {}).checked, daily_cap: Number(v('xp-s-cap')), recv_from: v('xp-s-rfrom'), recv_to: v('xp-s-rto'), eve_from: v('xp-s-from'), eve_to: v('xp-s-to'), sender: v('xp-s-sender'), tpl_recv: v('xp-s-recv'), tpl_eve: v('xp-s-eve') };
        const r = await call('/api/agent-office/experience/settings', 'PUT', body);
        if (!r.ok) { toast(r.body.error || '저장하지 못했어요'); return; }
        toast('설정을 저장했어요'); $('xp-set').hidden = true; load(true);
    }
    function onPop() { if (X.layer) close(true); }
    // Esc = 고치기 칸이 열려 있으면 그것만 닫고, 아니면 창을 닫는다 — 초점이 창 밖(body)으로 빠져도 받게 문서에 건다(열려 있을 때만)
    function onKey(e) { if (e.key !== 'Escape' || !X.layer) return; e.preventDefault(); e.stopPropagation(); if (X.edit) { X.edit = 0; render(); } else if (!$('xp-set').hidden) { $('xp-set').hidden = true; } else close(); }
    function open() {
        if (X.layer) { load(); return; }
        X.layer = shell(); document.body.classList.add('xp-open'); document.addEventListener('keydown', onKey, true);
        // 뒤로가기 칸 = 지금 기록(ao-desk 의 aoDesk 깊이 값 포함) 위에 한 칸 — 깊이 값을 이어 붙여야 ao-desk 가 제 칸을 잘못 닫지 않는다
        try { history.pushState(Object.assign({}, history.state || {}, { xpExp: 1 }), ''); X.pushed = true; window.addEventListener('popstate', onPop); } catch (e) { X.pushed = false; }
        X.from = today(); X.edit = 0; load();
        X.timer = setInterval(() => { if (!document.hidden && !X.edit && !document.activeElement.closest('#xp-set')) load(true); }, 60000);
        setTimeout(() => { const c = $('xp-close'); if (c) c.focus({ preventScroll: true }); }, 0);
    }
    function close(fromPop) {
        if (!X.layer) return;
        clearInterval(X.timer); X.layer.remove(); X.layer = null; X.data = null; document.body.classList.remove('xp-open');
        window.removeEventListener('popstate', onPop); document.removeEventListener('keydown', onKey, true);
        if (X.pushed && !fromPop) { X.pushed = false; try { history.back(); } catch (e) { /* 기록이 없으면 그대로 */ } }
        X.pushed = false;
        const back = document.getElementById('desk-plus-btn'); if (back && !fromPop) back.focus({ preventScroll: true });
    }
    // #775 폴드7 실화면(10/20 대표): 폰에서 [+] 시트를 닫으면 ao-desk 가 history.go(-1) 로 시트 칸을 걷는데 이 일은 비동기다 —
    //   그 사이 이 창이 pushState 하면 뒤늦은 go(-1) 이 이 창의 칸을 되돌려 popstate → 창이 바로 닫혔다(메뉴만 닫히고 그대로).
    //   → ao-desk 의 histIdle(기록 되돌리기가 끝난 뒤 실행 · 최종발주 창과 같은 길)로 연다. ao-desk 가 없으면 바로.
    function openSoon() { const d = window.AkmAoDesk; if (d && typeof d.histIdle === 'function') d.histIdle(open); else open(); }
    document.addEventListener('click', e => {
        if (e.target.closest('#desk-exp-now') || e.target.closest('#desk-todo-box .exp-go')) openSoon();
    });
    document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#desk-todo-box .exp-go')) { e.preventDefault(); openSoon(); } });
    window.AkmExp = { open, close, isOpen: () => !!X.layer };
})();
