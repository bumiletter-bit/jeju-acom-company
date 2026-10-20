// #775 감귤체험 예약 — 에이전트 오피스 창(전체 화면 겹 · body 직계 · Esc·뒤로가기·× 로 닫힘)
//   들어오는 길 = [+] 메뉴 「체험 예약」(#desk-exp-now) · 「지금 챙길 일」의 체험 줄(.exp-go) · window.AkmExp.open()
//   서버 계약 = experience.js 머리 주석: GET /api/agent-office/experience?from&to · PATCH …/:id · POST …/:id/visit · GET …/export.xlsx · GET …/:id/sms-preview · GET/PUT …/settings · GET …/:id/raw
//   #783(대표 10/20 「일정 메뉴처럼 달력으로 · 11/10 예약이 안 보였다」): 2주 목록 → 월 달력(기본 이번 달 · ‹ › · 오늘)
//     날짜 칸 = 「n팀 · m명」 + 이름 2~3개(시간순 · 넘치면 「+n 더보기」 · 폰·폴드 = 숫자만) · 칸을 누르면 그 날 명단 판(종전 목록 줄 그대로 · 고치기·방문·문자 미리보기)
//     날짜 확인 필요 = 달력 위 띠 · 요약 4칸·취소 포함·엑셀·문자 설정은 그대로 · 모양 = 일정 메뉴 달력(오늘 동그라미 · 일 빨강 · 토 파랑)
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
    const OFF = ['canceled', 'returned'];
    const isAdmin = () => { try { const u = JSON.parse(localStorage.getItem('jwt_user') || '{}'); return u.role === 'admin'; } catch (e) { return false; } };
    async function call(url, method, body) {
        const r = await fetch(url, { method: method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') }, body: body ? JSON.stringify(body) : undefined });
        if (r.status === 401 && typeof window.akmSessionExpired === 'function') window.akmSessionExpired();
        const j = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, body: j || {} };
    }
    // 달 = 'YYYY-MM' · 그 달 첫날·끝날
    const ymOf = d => d.slice(0, 7);
    const monthRange = ym => { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, y, m, last }; };
    const shiftYm = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
    const X = { layer: null, ym: ymOf(today()), data: null, busy: false, showOff: false, edit: 0, timer: 0, pushed: false, day: null, dayPushed: false, ignorePop: false };

    function shell() {
        const el = document.createElement('div');
        el.className = 'xp-layer'; el.id = 'xp-layer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '체험 예약');
        el.innerHTML = `<div class="xp-win">
            <div class="xp-head"><h2>체험 예약</h2><span class="xp-sub">스토어 주문 · 플레이스 예약</span><button type="button" class="xp-x" id="xp-close" aria-label="닫기">×</button></div>
            <div class="xp-bar">
                <div class="xp-nav"><button type="button" class="xp-btn" data-nav="-1" aria-label="지난달">‹</button><b class="xp-range" id="xp-range"></b><button type="button" class="xp-btn" data-nav="1" aria-label="다음 달">›</button><button type="button" class="xp-btn" data-nav="0">오늘</button></div>
                <div class="xp-tools"><label class="xp-chk"><input type="checkbox" id="xp-off"> 취소 포함</label><button type="button" class="xp-btn" id="xp-xlsx">엑셀</button><button type="button" class="xp-btn" id="xp-set-btn" hidden>문자 설정</button></div>
            </div>
            <div class="xp-set" id="xp-set" hidden></div>
            <div class="xp-body" id="xp-body"><div class="xp-empty">불러오는 중…</div></div>
            <div class="xp-panel" id="xp-panel" role="dialog" aria-modal="false" aria-label="그 날 명단" hidden></div>
        </div>`;
        document.body.appendChild(el);
        el.addEventListener('click', onClick);
        el.addEventListener('change', e => { if (e.target.id === 'xp-off') { X.showOff = e.target.checked; render(); } });
        if (isAdmin()) $('xp-set-btn').hidden = false;
        return el;
    }
    async function load(quiet) {
        if (X.busy) return; X.busy = true;
        const r0 = monthRange(X.ym), r2 = monthRange(shiftYm(X.ym, 2));   // #786 보는 달 ~ 2달 뒤까지 한 번에(다음 달 안내·자동 이동용 · 호출 수 그대로)
        try {
            const r = await call(`/api/agent-office/experience?from=${r0.from}&to=${r2.to}`);
            if (!r.ok) { if (!quiet) $('xp-body').innerHTML = `<div class="xp-empty">${esc(r.body.error || '체험 예약을 읽지 못했어요')}</div>`; return; }
            X.data = r.body; render();
        } catch (e) { if (!quiet) $('xp-body').innerHTML = '<div class="xp-empty">연결이 끊겼어요 — 잠시 뒤 다시</div>'; }
        finally { X.busy = false; }
    }
    const people = b => [b.exp_count ? `체험 ${b.exp_count}` : '', b.entry_count ? `입장 ${b.entry_count}` : '', b.infant_count ? `유아 ${b.infant_count}` : ''].filter(Boolean).join(' · ') || '인원 0';
    // #786 그 달 확정·방문 예약 수(취소·반품 빼고 · from 이 있으면 그날부터) · 1~2달 뒤 첫 예약 달
    const liveIn = (ym, from) => ((X.data && X.data.items) || []).filter(b => ['confirmed', 'visited'].includes(b.status) && b.visit_date && b.visit_date.startsWith(ym + '-') && (!from || b.visit_date >= from)).length;
    const nextBooked = (ym) => { for (let n = 1; n <= 2; n++) { const y2 = shiftYm(ym, n), c = liveIn(y2); if (c) return { ym: y2, n: c }; } return null; };
    const headCount = b =>(Number(b.exp_count) || 0) + (Number(b.entry_count) || 0) + (Number(b.infant_count) || 0);
    const telLink = p => p ? `<a class="xp-tel" href="tel:${esc(p)}">${esc(String(p).replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3'))}</a>` : '<span class="xp-dim">연락처 없음</span>';
    function rowHtml(b) {
        const off = OFF.includes(b.status), vis = b.status === 'visited';
        const badge = b.source === 'store' ? '<i class="xp-src st">스토어</i>' : '<i class="xp-src pl">플레이스</i>';
        const chk = !b.date_ok ? `<i class="xp-need">${esc(b.date_why || '날짜 확인 필요')}</i>` : '';
        const smsFail = (!b.sms_recv_at && Number(b.sms_recv_tries) >= 3) || (!b.sms_eve_at && Number(b.sms_eve_tries) >= 3);   // 3번 실패 = 멈춤(서버) · 직원이 전화로
        const cf = b.confirm_state === 'failed' ? `<i class="xp-sms err" title="${esc(b.confirm_error || '')}">발주확인 실패</i>` : b.confirm_state === 'skipped_claim' ? `<i class="xp-sms err" title="${esc(b.confirm_error || '')}">자동 안 함 · 클레임 이력 — 센터에서 발주확인</i>`
            : b.confirm_state === 'dispatch_failed' ? `<i class="xp-sms err" title="${esc(b.dispatch_error || '')}">발송처리 실패 — 센터에서 발송처리</i>` : b.confirm_state === 'dispatched' ? '<i class="xp-sms ok" title="발주확인·발송처리(배송 없음) 끝">발송처리✓</i>' : '';   // #782   // #780 3번 실패 = 센터에서 직접
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
    // 보이는 예약(취소 포함 체크 때만 취소·반품) · 날짜 확인 필요 · 날짜별 묶음(시간순)
    function sets() {
        const items = (X.data && X.data.items) || [];
        const shown = items.filter(b => X.showOff || !OFF.includes(b.status));
        const need = shown.filter(b => !b.date_ok && ['confirmed', 'unknown'].includes(b.status));
        const byDay = new Map();
        for (const b of shown) { if (need.includes(b) || !b.visit_date) continue; if (!byDay.has(b.visit_date)) byDay.set(b.visit_date, []); byDay.get(b.visit_date).push(b); }
        for (const l of byDay.values()) l.sort((a, b) => String(a.visit_time || '99').localeCompare(String(b.visit_time || '99')) || a.id - b.id);
        const offNoDate = shown.filter(b => OFF.includes(b.status) && !b.visit_date);   // #785 날짜 없는 취소·반품(취소 포함일 때만 shown 에 있음) — 달력 칸이 없어 띠로
        return { need, byDay, offNoDate };
    }
    function render() {
        const d = X.data; if (!d || !X.layer) return;
        // #786 처음 열 때(오늘 달)만: 오늘 이후 확정·방문 예약이 이 달에 0 이고 1~2달 뒤에 있으면 그 달로 · 위에 안내(손으로 달을 넘긴 뒤엔 안 함)
        if (X.auto) {
            X.auto = false;
            if (X.ym === ymOf(today()) && !liveIn(X.ym, today())) { const nx = nextBooked(X.ym); if (nx) { X.jumpFrom = X.ym; X.ym = nx.ym; } }
        }
        const mr = monthRange(X.ym);   // #785 요약 4칸(오늘·내일·날짜 확인 필요·손님 문자) 뺌 — 대표 「달력으로 보여서 필요 없다」
        $('xp-range').textContent = `${mr.y}년 ${mr.m}월`;
        const { need, byDay, offNoDate } = sets(), t = today();
        let html = '';
        if (X.jumpFrom) html += `<div class="xp-jump">${+X.jumpFrom.slice(5)}월엔 남은 예약이 없어 ${+X.ym.slice(5)}월을 보여 드려요 · <button type="button" class="xp-link" data-nav="0">‹ 이번 달</button></div>`;
        if (need.length) html += `<button type="button" class="xp-needbar" data-day="need"><b>날짜 확인 필요 ${need.length}건</b><span>${esc(need.slice(0, 3).map(b => b.name || '(이름 없음)').join(' · '))}${need.length > 3 ? ' 외' : ''} — 눌러서 날짜·시간 넣기</span></button>`;
        if (offNoDate.length) html += `<button type="button" class="xp-needbar off" data-day="offnodate"><b>날짜 없는 취소·반품 ${offNoDate.length}건</b><span>${esc(offNoDate.slice(0, 3).map(b => b.name || '(이름 없음)').join(' · '))}${offNoDate.length > 3 ? ' 외' : ''} — 눌러서 보기</span></button>`;
        html += '<div class="xp-cal" role="grid" aria-label="체험 예약 달력"><div class="xp-cal-h" role="row">' + [...DOW].map((w, i) => `<span role="columnheader" class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('') + '</div><div class="xp-cal-g">';
        const lead = new Date(Date.UTC(mr.y, mr.m - 1, 1)).getUTCDay();
        for (let i = 0; i < lead; i++) html += '<span class="xp-cell out" aria-hidden="true"></span>';
        for (let day = 1; day <= mr.last; day++) {
            const ds = `${X.ym}-${String(day).padStart(2, '0')}`, dow = (lead + day - 1) % 7;
            const list = byDay.get(ds) || [], live = list.filter(b => !OFF.includes(b.status));
            const ppl = live.reduce((a, b) => a + headCount(b), 0);
            const cls = ['xp-cell', dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', ds === t ? 'today' : '', ds < t ? 'past' : '', list.length ? 'has' : ''].filter(Boolean).join(' ');
            const names = list.slice(0, 3).map(b => `<span class="xp-nm${OFF.includes(b.status) ? ' off' : ''}">${esc(b.visit_time || '')} ${esc(b.name || '(이름 없음)')}</span>`).join('');
            const more = list.length > 3 ? `<span class="xp-more">+${list.length - 3} 더보기</span>` : '';
            const aria = `${+ds.slice(5, 7)}월 ${day}일 ${DOW[dow]}요일${live.length ? ` · ${live.length}팀 ${ppl}명` : ' · 예약 없음'}`;
            html += `<button type="button" class="${cls}" data-day="${ds}" aria-label="${esc(aria)}"><span class="xp-dn">${ds === t ? '오늘' : day}</span>${live.length ? `<span class="xp-cnt"><b>${live.length}팀</b><em> · ${ppl}명</em></span>` : (list.length ? '<span class="xp-cnt off">취소만</span>' : '')}<span class="xp-nms">${names}${more}</span></button>`;
        }
        const tail = (7 - (lead + mr.last) % 7) % 7;
        for (let i = 0; i < tail; i++) html += '<span class="xp-cell out" aria-hidden="true"></span>';
        html += '</div></div>';
        const inMonth = [...byDay.keys()].filter(k => k.startsWith(X.ym + '-')).length;   // #786 목록이 2달 뒤까지 오므로 빈 달 판정은 보는 달만
        if (!inMonth) {
            const nx = nextBooked(X.ym);
            html += `<p class="xp-hint xp-cal-empty">이 달엔 체험 예약이 없어요. ‹ › 로 다른 달을 볼 수 있어요.${nx ? ` <button type="button" class="xp-btn xp-next" data-goym="${nx.ym}">${+nx.ym.slice(5)}월 ${nx.n}팀 ›</button>` : ''}</p>`;
        }
        $('xp-body').innerHTML = html;
        if (X.day) renderPanel();
    }
    // 그 날 명단 판 — 날짜 칸·더보기·확인 필요 띠를 누르면 · 종전 목록 줄 그대로(고치기·방문·문자 미리보기)
    function renderPanel() {
        const p = $('xp-panel'); if (!p) return;
        if (!X.day) { p.hidden = true; p.innerHTML = ''; return; }
        const { need, byDay, offNoDate } = sets();
        const list = X.day === 'need' ? need : X.day === 'offnodate' ? offNoDate : (byDay.get(X.day) || []);
        const live = list.filter(b => !OFF.includes(b.status));
        const tot = k => live.reduce((a, b) => a + (Number(b[k]) || 0), 0);
        const title = X.day === 'need' ? '날짜 확인 필요' : X.day === 'offnodate' ? '날짜 없는 취소·반품' : dLabel(X.day);
        const sub = X.day === 'offnodate' ? `${list.length}건 · 방문 날짜를 못 읽은 취소·반품이에요(손님 응대 없음 · 기록용)` : X.day === 'need' ?`${list.length}건 · 손님께 확인한 뒤 [고치기]에서 날짜·시간을 넣어 주세요(넣으면 문자 대상)` : `${live.length}팀 · 체험 ${tot('exp_count')} · 입장 ${tot('entry_count')}${tot('infant_count') ? ' · 유아 ' + tot('infant_count') : ''}`;
        p.hidden = false;
        p.innerHTML = `<div class="xp-panel-h"><div><h3>${esc(title)}</h3><small>${esc(sub)}</small></div><button type="button" class="xp-x" data-act="close-panel" aria-label="명단 닫기">×</button></div>
            <div class="xp-panel-b">${list.length ? `<ul>${list.map(rowHtml).join('')}</ul>` : '<div class="xp-empty">이 날은 예약이 없어요.</div>'}</div>`;
        if (X.edit) { const f = $('xp-e-date'); if (f && !p.contains(document.activeElement)) f.focus({ preventScroll: true }); }
    }
    // 폰 뒤로가기 = 명단 판만 닫힘(#678 「하나씩」) — 판을 열 때 기록 한 칸(xpDay) · 판을 다른 길(×·Esc·달 넘김)로 닫으면 그 칸을 걷고 그때 오는 popstate 한 번은 무시
    function pushDayHist() { if (X.dayPushed || !X.pushed) return; try { history.pushState(Object.assign({}, history.state || {}, { xpDay: 1 }), ''); X.dayPushed = true; } catch (e) { X.dayPushed = false; } }
    function dropDayHist() { if (!X.dayPushed) return; X.dayPushed = false; X.ignorePop = true; try { history.back(); } catch (e) { X.ignorePop = false; } }
    function openDay(day) { X.day = day; X.edit = 0; pushDayHist(); renderPanel(); const c = X.layer && X.layer.querySelector('[data-act="close-panel"]'); if (c) c.focus({ preventScroll: true }); }
    function closeDay(fromPop) { const was = X.day; X.day = null; X.edit = 0; if (!fromPop) dropDayHist(); renderPanel(); const cell = was && X.layer && X.layer.querySelector(`[data-day="${was}"]`); if (cell) cell.focus({ preventScroll: true }); }
    async function onClick(e) {
        if (e.target.closest('#xp-close')) return close();
        const nav = e.target.closest('[data-nav]');
        if (nav) { const n = +nav.dataset.nav; X.ym = n ? shiftYm(X.ym, n) : ymOf(today()); X.auto = false; X.jumpFrom = null; X.edit = 0; X.day = null; dropDayHist(); renderPanel(); return load(); }
        const goym = e.target.closest('[data-goym]');   // #786 빈 달의 「n월 n팀 ›」
        if (goym) { X.ym = goym.dataset.goym; X.auto = false; X.jumpFrom = null; X.edit = 0; X.day = null; dropDayHist(); renderPanel(); return load(); }
        const cell = e.target.closest('[data-day]'); if (cell && !e.target.closest('#xp-panel')) return openDay(cell.dataset.day);
        if (e.target.closest('#xp-xlsx')) return xlsx();
        if (e.target.closest('#xp-set-btn')) return toggleSet();
        if (e.target.closest('#xp-set-save')) return saveSet();
        const btn = e.target.closest('[data-act]'); if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'close-panel') return closeDay();
        const li = btn.closest('[data-id]'); const id = li ? +li.dataset.id : 0; const b = (X.data.items || []).find(x => x.id === id);
        if (act === 'edit') { X.edit = X.edit === id ? 0 : id; return renderPanel(); }
        if (act === 'close-edit') { X.edit = 0; return renderPanel(); }
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
                if (!Object.keys(body).length) { X.edit = 0; return renderPanel(); }
            } else body.status = act === 'cancel' ? 'canceled' : 'confirmed';
            btn.disabled = true; const r = await call(`/api/agent-office/experience/${id}`, 'PATCH', body);
            if (!r.ok) { toast(r.body.error || '저장하지 못했어요'); btn.disabled = false; return; }
            Object.assign(b, r.body.item); X.edit = 0; toast('저장했어요');
            if (body.visit_date) X.day = body.visit_date;   // 날짜를 넣거나 옮기면 판도 그 날로(확인 필요 묶음에서 넣은 경우 포함)
            if (body.visit_date && ymOf(body.visit_date) !== X.ym) { X.ym = ymOf(body.visit_date); X.jumpFrom = null; }
            return load(true);
        }
        if (act === 'sms' || act === 'raw') {
            const pre = $('xp-pre'); pre.hidden = false; pre.textContent = '불러오는 중…';
            const r = await call(act === 'sms' ? `/api/agent-office/experience/${id}/sms-preview` : `/api/agent-office/experience/${id}/raw`);
            if (!r.ok) { pre.textContent = r.body.error || '읽지 못했어요'; return; }
            pre.textContent = act === 'sms' ? `[접수 즉시]\n${r.body.recv}\n\n[방문 전날]\n${r.body.eve}\n\n${r.body.will_send ? '→ 손님 문자가 켜져 있어 보낼 대상이에요' : '→ 지금은 보내지 않아요(문자 꺼짐 · 날짜 확인 필요 · 취소 · 연락처 없음 중 하나)'}` : (r.body.raw || '(원문 없음)');
        }
    }
    async function xlsx() {
        const mr = monthRange(X.ym);
        try {
            const r = await fetch(`/api/agent-office/experience/export.xlsx?from=${mr.from}&to=${mr.to}`, { headers: { Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') } });
            if (!r.ok) { toast('엑셀을 만들지 못했어요'); return; }
            const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `체험예약_${mr.from}_${mr.to}.xlsx`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } catch (e) { toast('엑셀을 내려받지 못했어요'); }
    }
    async function toggleSet() {
        const box = $('xp-set'); if (!box.hidden) { box.hidden = true; return; }
        box.hidden = false; box.innerHTML = '<div class="xp-empty">불러오는 중…</div>';
        const r = await call('/api/agent-office/experience/settings'); if (!r.ok) { box.innerHTML = `<div class="xp-empty">${esc(r.body.error || '설정을 읽지 못했어요')}</div>`; return; }
        const n = r.body.notify || {};
        box.innerHTML = `<div class="xp-set-grid">
            <label class="xp-chk"><input type="checkbox" id="xp-s-on"${n.enabled ? ' checked' : ''}> 손님 문자 보내기(접수 즉시 1통 · 방문 전날 낮 1통 · 스토어 주문만)</label>
            <label class="xp-chk"><input type="checkbox" id="xp-s-ac"${n.auto_confirm !== false ? ' checked' : ''}> 스토어 체험 주문 자동 발주확인(결제되면 바로)</label>
            <label class="xp-chk"><input type="checkbox" id="xp-s-ad"${n.auto_dispatch !== false ? ' checked' : ''}> 발주확인 뒤 자동 발송처리(배송 없음 → 배송완료)</label>
            <label>하루 상한<input type="number" min="1" max="300" id="xp-s-cap" value="${esc(n.daily_cap)}"></label>
            <label>접수 문자 시간<input type="text" id="xp-s-rfrom" value="${esc(n.recv_from)}" placeholder="09:00"> ~ <input type="text" id="xp-s-rto" value="${esc(n.recv_to)}" placeholder="21:00"></label>
            <label>전날 문자 시간<input type="text" id="xp-s-from" value="${esc(n.eve_from)}" placeholder="10:00"> ~ <input type="text" id="xp-s-to" value="${esc(n.eve_to)}" placeholder="18:00"></label>
            <label>발신번호<input type="text" id="xp-s-sender" value="${esc(n.sender || '')}" placeholder="비우면 회사 기본 번호(알리고에 등록된 번호만)"></label>
            <label class="w">접수 문자<textarea id="xp-s-recv" rows="9">${esc(n.tpl_recv)}</textarea></label>
            <label class="w">전날 문자<textarea id="xp-s-eve" rows="4">${esc(n.tpl_eve)}</textarea></label>
            <p class="xp-hint">자리표 = {이름} {월} {일} {시간} {요일} {인원}(「체험 1명 · 입장 1명」 꼴 · 0명 칸은 빠짐) · 옛 자리표 {체험} {입장} {유아}도 됨 · 문자에는 이모지가 안 나가요</p>
            <div class="xp-edit-acts"><button type="button" class="xp-btn pri" id="xp-set-save">설정 저장</button></div></div>`;
    }
    async function saveSet() {
        const v = id => ($(id) || {}).value;
        const body = { enabled: !!($('xp-s-on') || {}).checked, auto_confirm: !!($('xp-s-ac') || {}).checked, auto_dispatch: !!($('xp-s-ad') || {}).checked, daily_cap: Number(v('xp-s-cap')), recv_from: v('xp-s-rfrom'), recv_to: v('xp-s-rto'), eve_from: v('xp-s-from'), eve_to: v('xp-s-to'), sender: v('xp-s-sender'), tpl_recv: v('xp-s-recv'), tpl_eve: v('xp-s-eve') };
        const r = await call('/api/agent-office/experience/settings', 'PUT', body);
        if (!r.ok) { toast(r.body.error || '저장하지 못했어요'); return; }
        toast('설정을 저장했어요'); $('xp-set').hidden = true; load(true);
    }
    function onPop() {
        if (!X.layer) return;
        if (X.ignorePop) { X.ignorePop = false; return; }   // 판을 ×·Esc 로 닫으며 걷은 칸
        if (X.dayPushed) { X.dayPushed = false; if (X.day) closeDay(true); return; }   // 뒤로가기 1번 = 명단 판만
        close(true);
    }
    // Esc = 고치기 칸 → 그 날 명단 판 → 문자 설정 → 창 순으로 하나씩 닫는다 — 초점이 창 밖(body)으로 빠져도 받게 문서에 건다(열려 있을 때만)
    function onKey(e) {
        if (e.key !== 'Escape' || !X.layer) return; e.preventDefault(); e.stopPropagation();
        if (X.edit) { X.edit = 0; renderPanel(); } else if (X.day) closeDay(); else if (!$('xp-set').hidden) { $('xp-set').hidden = true; } else close();
    }
    function open() {
        if (X.layer) { load(); return; }
        X.layer = shell(); document.body.classList.add('xp-open'); document.addEventListener('keydown', onKey, true);
        // 뒤로가기 칸 = 지금 기록(ao-desk 의 aoDesk 깊이 값 포함) 위에 한 칸 — 깊이 값을 이어 붙여야 ao-desk 가 제 칸을 잘못 닫지 않는다
        try { history.pushState(Object.assign({}, history.state || {}, { xpExp: 1 }), ''); X.pushed = true; window.addEventListener('popstate', onPop); } catch (e) { X.pushed = false; }
        X.ym = ymOf(today()); X.day = null; X.edit = 0; X.auto = true; X.jumpFrom = null; load();
        X.timer = setInterval(() => { if (!document.hidden && !X.edit && !document.activeElement.closest('#xp-set')) load(true); }, 60000);
        setTimeout(() => { const c = $('xp-close'); if (c) c.focus({ preventScroll: true }); }, 0);
    }
    function close(fromPop) {
        if (!X.layer) return;
        clearInterval(X.timer); X.layer.remove(); X.layer = null; X.data = null; X.day = null; document.body.classList.remove('xp-open');
        window.removeEventListener('popstate', onPop); document.removeEventListener('keydown', onKey, true);
        if (X.pushed && !fromPop) { X.pushed = false; try { history.go(X.dayPushed ? -2 : -1); } catch (e) { /* 기록이 없으면 그대로 */ } }   // 판 칸이 남아 있으면 둘 다 걷음
        X.pushed = false; X.dayPushed = false; X.ignorePop = false;
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
