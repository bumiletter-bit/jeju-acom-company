// #775 감귤체험 예약 — 에이전트 오피스 창(전체 화면 겹 · body 직계 · Esc·뒤로가기·× 로 닫힘)
//   들어오는 길 = [+] 메뉴 「체험 예약」(#desk-exp-now) · 「지금 챙길 일」의 체험 줄(.exp-go) · window.AkmExp.open()
//   서버 계약 = experience.js 머리 주석: GET /api/agent-office/experience?from&to · PATCH …/:id · POST …/:id/visit · GET …/export.xlsx · GET …/:id/sms-preview · GET/PUT …/settings · GET …/:id/raw
//   #783(대표 10/20 「일정 메뉴처럼 달력으로 · 11/10 예약이 안 보였다」): 2주 목록 → 월 달력(기본 이번 달 · ‹ › · 오늘)
//     날짜 칸 = 「n팀 · m명」 + 이름 2~3개(시간순 · 넘치면 「+n 더보기」 · 폰·폴드 = 숫자만) · 칸을 누르면 그 날 명단 판(종전 목록 줄 그대로 · 고치기·방문·문자 미리보기)
//     날짜 확인 필요 = 달력 위 띠 · 요약 4칸·취소 포함·엑셀·문자 설정은 그대로 · 모양 = 일정 메뉴 달력(오늘 동그라미 · 일 빨강 · 토 파랑)
//   #804(대표 10/21): 스토어(초록)·플레이스(귤색) = 줄·달력 이름 왼쪽 띠 색 · 접수 안내 보냄 = 띠 굵게 + 「✓ 알림톡」 · 플레이스 = 고치기에 이름·번호(넣고 저장 = 그 자리에서 접수 안내)
//   #808(대표 10/21): 날짜 판 [+ 예약 추가] = 수기(현금) 예약(source manual · 남색 띠 · 「수기」 · 번호 넣으면 그 자리에서 접수 안내) · 「고치기」 → 「수정」 · 방문일 = 공통 달력(akm-date) · 시간 = 30분 알약 + 직접 입력
//     번호 칸 = 치는 대로 010-0000-0000 · 「✓」 배지 = 실제로 나간 길(알림톡/문자) · 수기 건만 「삭제(취소)」·「되돌리기」
//     달력 머리 「번호 미입력 n건」 알약 → 그 묶음 판(줄마다 이름·번호 바로 넣기) · 「메일 원문」·「예약 취소로」·「확정으로 되돌리기」 단추 뺌(취소는 플레이스·스토어에서 → 수집이 반영)
//   #822(대표 10/22): [문자 설정] 단추 숨김(기능·서버 그대로) · 현장 판매(귤) = 날짜 판 머리 [+ 현장 판매] → 금액·메모 칸(#822-b · 값 있으면 한 줄 + 수정·삭제 · 전 직원 · PUT …/sales/:day) · 달력 칸 「현장 120,000」(폰 = ₩ 표식) · 달력 위 「이달 현장 판매(귤) 합계」 띠 · 엑셀 둘째 시트
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const DOW = '일월화수목금토';
    const dLabel = d => { if (!d) return '날짜 미정'; const [, m, dd] = d.split('-'); const w = DOW[new Date(d + 'T00:00:00Z').getUTCDay()]; const t = today(); return `${+m}월 ${+dd}일(${w})` + (d === t ? ' · 오늘' : d === addDays(t, 1) ? ' · 내일' : ''); };
    // #806(대표 10/21 「동명이인 · 날짜별로 · 예약번호」) 줄 머리 = 날짜(오늘·내일·11/7(토)) 위 · 시간 아래 / 여러 날짜 판 = 날짜순 + 날짜 구분 줄
    const whenHtml = b => {
        if (!b.visit_date) return '<span class="xp-wd">날짜 미정</span><span class="xp-wt">' + esc(b.visit_time || '--:--') + '</span>';
        const t = today(), d = b.visit_date, [, m, dd] = d.split('-');
        const day = d === t ? '오늘' : d === addDays(t, 1) ? '내일' : `${+m}/${+dd}(${DOW[new Date(d + 'T00:00:00Z').getUTCDay()]})`;
        return `<span class="xp-wd${d === t ? ' now' : ''}">${day}</span><span class="xp-wt${b.visit_time ? '' : b.source === 'manual' ? ' tbd' : ''}">${esc(b.visit_time || (b.source === 'manual' ? '미정' : '--:--'))}</span>`;   // #930
    };
    const byWhen = (a, b) => String(a.visit_date || '9999').localeCompare(String(b.visit_date || '9999')) || String(a.visit_time || '99').localeCompare(String(b.visit_time || '99')) || a.id - b.id;
    const MULTI = ['need', 'nophone', 'offnodate'];   // 여러 날짜가 섞이는 판
    function listHtml(list, multi) {
        if (!multi) return list.map(rowHtml).join('');
        let last = null, out = '';
        for (const b of list.slice().sort(byWhen)) {
            const k = b.visit_date || '';
            if (k !== last) { out += `<li class="xp-dsep" role="presentation"><span>${esc(dLabel(b.visit_date))}</span></li>`; last = k; }
            out += rowHtml(b);
        }
        return out;
    }
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
                <div class="xp-nav"><button type="button" class="xp-btn" data-nav="-1" aria-label="지난달">‹</button><b class="xp-range" id="xp-range"></b><button type="button" class="xp-pill" id="xp-nophone" data-day="nophone" hidden></button><button type="button" class="xp-btn" data-nav="1" aria-label="다음 달">›</button><button type="button" class="xp-btn" data-nav="0">오늘</button></div>
                <div class="xp-tools"><label class="xp-chk"><input type="checkbox" id="xp-off"> 취소 포함</label><button type="button" class="xp-btn" id="xp-xlsx">엑셀</button><button type="button" class="xp-btn" id="xp-set-btn" hidden>문자 설정</button></div>
            </div>
            <div class="xp-set" id="xp-set" hidden></div>
            <div class="xp-body" id="xp-body"><div class="xp-empty">불러오는 중…</div></div>
            <div class="xp-panel" id="xp-panel" role="dialog" aria-modal="false" aria-label="그 날 명단" hidden></div>
        </div>`;
        document.body.appendChild(el);
        el.addEventListener('click', onClick);
        el.addEventListener('change', e => { if (e.target.id === 'xp-off') { X.showOff = e.target.checked; render(); } });
        el.addEventListener('input', onInput);   // #808
        el.addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('xp-ph')) telCheck(e.target); });
        // #822(대표 10/22 「문자 설정은 기능 그대로 두고 노출만 없애」): 단추는 늘 숨김 · 설정 창·저장 길(toggleSet/saveSet · 서버 PUT)은 그대로 — 필요하면 콘솔 AkmExp.settings()
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
    // #804 줄·달력 이름의 출처 띠 · 보냄 표시 · 번호 미입력(플레이스·확정·번호 없음·오늘 이후)
    const srcCls = b => (b.source === 'place' ? ' src-pl' : b.source === 'manual' ? ' src-mn' : ' src-st') + (b.sms_recv_at ? ' sent' : '');
    const SRC = { store: ['st', '스토어', '주문', '주문번호(스토어)'], place: ['pl', '플레이스', '예약', '예약번호(스마트플레이스 예약자관리와 대조)'], manual: ['mn', '수기', '수기', '수기 예약 번호(현금 등 · 직원이 넣음)'] };
    const srcOf = b => SRC[b.source] || SRC.store;
    const PRICE = { exp: 18000, entry: 10000 };   // #808 수기 금액 기본 셈(체험 18,000 · 입장 10,000 · 유아 0) — 사람이 고칠 수 있음
    const TIMES = []; for (let h = 10; h <= 16; h++) for (const m of ['00', '30']) TIMES.push(String(h).padStart(2, '0') + ':' + m);   // 10:00~16:30
    const TBD = '미정';   // #930(대표 10/31) 수기 예약만 시간 「미정」 = 서버가 시간 비워 저장 · 글에는 「시간 미정」
    const tpick = (forId, cur, tbd) => `<div class="xp-tpick" data-for="${forId}" role="group" aria-label="시간 고르기">${TIMES.concat(tbd ? [TBD] : []).map(t => `<button type="button" class="xp-tp${t === TBD ? ' tbd' : ''}${t === cur ? ' on' : ''}" data-tp="${t}" aria-pressed="${t === cur}">${t}</button>`).join('')}</div>`;
    const timeOf = b => b.visit_time || (b.source === 'manual' && b.visit_date ? TBD : '');   // #930 수기 빈 시간 = 「미정」
    const fmtTel = v => { const d = String(v || '').replace(/[^0-9]/g, '').slice(0, 11); return d.length < 4 ? d : d.length < 8 ? d.slice(0, 3) + '-' + d.slice(3) : d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7); };
    const telOk = v => { const d = String(v || '').replace(/[^0-9]/g, ''); return !d || /^01[0-9]{8,9}$/.test(d); };
    const telInput = (id, val) => `<label>번호<input type="tel" inputmode="numeric" class="xp-ph" id="${id}" maxlength="13" value="${esc(fmtTel(val))}" placeholder="010-0000-0000" autocomplete="off"><small class="xp-err" id="${id}-err" hidden>번호는 010 으로 시작하는 10~11자리</small></label>`;
    const viaBadge = b => !b.sms_recv_at ? '' : b.sms_recv_via === 'alimtalk' ? '<i class="xp-sms ok" title="접수 안내 = 알림톡으로 보냄(알림톡이 안 되면 알리고가 문자로 대신 보냄)">알림톡✓</i>' : '<i class="xp-sms ok" title="접수 안내 = 문자로 보냄">문자✓</i>';
    const noPhone = b => (b.source === 'place' || b.source === 'manual') && b.status === 'confirmed'   /* #808 번호 없이 넣은 수기도 */ && !(b.phone && String(b.phone).length >= 10) && (!b.visit_date || b.visit_date >= today());
    const sentLabel = () => (X.data && X.data.settings_view && X.data.settings_view.alimtalk) ? '✓ 알림톡' : '✓ 문자';
    const sentMsg = v => v === 'sent' ? (sentLabel() === '✓ 알림톡' ? '저장 · 접수 알림톡 보냈어요 ✓' : '저장 · 접수 문자 보냈어요 ✓') : /^skip:/.test(String(v || '')) ? '저장 · 접수 안내는 이미 보냈어요 ✓' : v === 'refused' ? '저장했어요 · 이 번호는 문자 수신거부라 안 보냈어요' : v === 'failed' ? '저장했어요 · 보내기 실패 — 30분 뒤 다시 보내요' : /^later:/.test(String(v || '')) ? '저장했어요 · 지금은 안 보냄(' + String(v).slice(6) + ') — 조건이 되면 저절로 보내요' : '저장했어요';
    const telLink = p => p ? `<a class="xp-tel" href="tel:${esc(p)}">${esc(String(p).replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3'))}</a>` : '<span class="xp-dim">연락처 없음</span>';
    // #822 현장 판매(귤) — 서버 sales 줄(날짜당 하나) · 금액 글자 = 1,234,567 · 이달 합계
    const won = n => Number(n || 0).toLocaleString('ko-KR');
    const saleOf = day => ((X.data && X.data.sales) || []).find(s => s.day === day) || null;
    const saleMonth = ym => { const l = ((X.data && X.data.sales) || []).filter(s => s.day.startsWith(ym + '-') && Number(s.amount) > 0); return { sum: l.reduce((a, s) => a + Number(s.amount), 0), days: l.length }; };
    // #822-b(대표 10/22 라이브 「늘 펼쳐진 칸 빼고 [추가] 를 누르도록 · 삭제도」): 값 없음 = 아무것도 안 그림(판 머리 [+ 현장 판매] 단추) · 값 있음 = 한 줄 요약 + [수정]·[삭제] · 적는 중(X.saleEdit) = 금액·메모 칸 + [저장]·[취소]
    function saleHtml(day) {
        const s = saleOf(day), editing = X.saleEdit === day;
        if (editing) return `<div class="xp-sale-box" id="xp-sale-box" data-day="${day}"><div class="xp-sale-h"><b>현장 판매(귤)</b><small>${s ? '고치기 · 금액을 0 으로 비우고 저장하면 지워져요' : '그날 체험장에서 직접 판 귤 매출 — 금액과 메모'}</small></div>
            <label>금액(원)<input type="text" inputmode="numeric" class="xp-won" id="xp-sl-amount" value="${s && s.amount ? esc(won(s.amount)) : ''}" placeholder="0" maxlength="11" autocomplete="off"></label>
            <label class="g">메모<input type="text" id="xp-sl-memo" maxlength="200" value="${esc(s && s.memo || '')}" placeholder="예: 5kg 12박스 · 현금 8 / 카드 4" autocomplete="off"></label>
            <span class="xp-sale-acts"><button type="button" class="xp-btn pri" data-act="sale-save">저장</button><button type="button" class="xp-btn" data-act="sale-cancel">취소</button></span></div>`;
        if (!s) return '';
        return `<div class="xp-sale-line" id="xp-sale-line" data-day="${day}"><b>현장 판매(귤)</b><span class="xp-sale-amt">${won(s.amount)}원</span>${s.memo ? `<em>${esc(s.memo)}</em>` : ''}<small>${esc(s.updated_by || '')} · ${esc(s.updated_at || '')}</small>
            <span class="xp-sale-acts"><button type="button" class="xp-btn" data-act="sale-edit">수정</button><button type="button" class="xp-btn warn" data-act="sale-del">삭제</button></span></div>`;
    }
    function rowHtml(b) {
        const off = OFF.includes(b.status), vis = b.status === 'visited';
        const badge = `<i class="xp-src ${srcOf(b)[0]}">${srcOf(b)[1]}</i>`;
        const chk = !b.date_ok ? `<i class="xp-need">${esc(b.date_why || '날짜 확인 필요')}</i>` : '';
        const smsFail = (!b.sms_recv_at && Number(b.sms_recv_tries) >= 3) || (!b.sms_eve_at && Number(b.sms_eve_tries) >= 3);   // 3번 실패 = 멈춤(서버) · 직원이 전화로
        const cf = b.confirm_state === 'failed' ? `<i class="xp-sms err" title="${esc(b.confirm_error || '')}">발주확인 실패</i>` : b.confirm_state === 'skipped_claim' ? `<i class="xp-sms err" title="${esc(b.confirm_error || '')}">자동 안 함 · 클레임 이력 — 센터에서 발주확인</i>`
            : b.confirm_state === 'dispatch_failed' ? `<i class="xp-sms err" title="${esc(b.dispatch_error || '')}">발송처리 실패 — 센터에서 발송처리</i>` : b.confirm_state === 'dispatched' ? '<i class="xp-sms ok" title="발주확인·발송처리(배송 없음) 끝">발송처리✓</i>' : '';   // #782   // #780 3번 실패 = 센터에서 직접
        const sms = noPhone(b) ? '<i class="xp-sms err">번호 미입력</i>' : (b.source !== 'store' && !b.contact_at && !b.sms_recv_at) ? '' : b.sms_skip === 'refused' ? '<i class="xp-sms err" title="문자봇 수신거부 기억 — 문자 안 보냄">수신거부</i>' : smsFail ? `<i class="xp-sms err" title="${esc(b.sms_error || '')}">문자 실패</i>` : viaBadge(b);   // #808 나간 길
        const editing = X.edit === b.id;
        return `<li class="xp-row${srcCls(b)}${off ? ' off' : ''}${vis ? ' vis' : ''}" data-id="${b.id}">
            <span class="xp-time">${whenHtml(b)}</span>
            <div class="xp-main"><div class="xp-l1">${badge}<b class="xp-name">${esc(b.name || '(이름 없음)')}</b>${b.order_no ? `<span class="xp-ono" title="${srcOf(b)[3]}"><i>${srcOf(b)[2]}</i>${esc(b.order_no)}</span>` : ''}${telLink(b.phone)}${chk}</div>
                <div class="xp-l2"><span>${esc(people(b))}</span>${b.amount ? `<span>${Number(b.amount).toLocaleString('ko-KR')}원</span>` : ''}<span class="xp-st s-${esc(b.status)}">${ST[b.status] || esc(b.status)}</span>${cf}${sms}${b.memo ? `<span class="xp-memo">${esc(b.memo)}</span>` : ''}</div></div>
            <div class="xp-acts">${off || b.status === 'unknown' ? '' : `<button type="button" class="xp-btn xp-visit${vis ? ' on' : ''}" data-act="visit" aria-pressed="${vis}">${vis ? '방문함' : '방문'}</button>`}<button type="button" class="xp-btn" data-act="edit" aria-expanded="${editing}">수정</button></div>
            ${editing ? editHtml(b) : X.day === 'nophone' && noPhone(b) ? quickHtml(b) : ''}</li>`;
    }
    // #804 번호 미입력 판 = 줄마다 바로 넣기(수정을 안 열어도)
    function quickHtml(b) {
        return `<div class="xp-edit xp-quick" data-id="${b.id}"><label>이름<input type="text" id="xp-q-name-${b.id}" maxlength="30" value="${esc(b.name || '')}" placeholder="손님 이름"></label>${telInput('xp-q-phone-' + b.id, b.phone)}<button type="button" class="xp-btn pri" data-act="qsave">저장·보내기</button><small class="xp-hint">저장하면 그 자리에서 접수 알림톡이 나가요 · 이름의 *(가린 글자)는 손님 이름으로 고쳐 주세요</small></div>`;
    }
    function editHtml(b) {
        const pl = b.source === 'place', mn = b.source === 'manual', who = pl || mn;
        return `<div class="xp-edit" data-id="${b.id}">
            ${who ? `<label>이름<input type="text" id="xp-e-name" maxlength="30" value="${esc(b.name || '')}" placeholder="손님 이름"></label>${telInput('xp-e-phone', b.phone)}` : ''}
            <label>방문일<input type="text" class="akm-date xp-date" id="xp-e-date" value="${esc(b.visit_date || '')}" placeholder="날짜 선택" readonly autocomplete="off"></label>
            <label>시간<input type="text" id="xp-e-time" value="${esc(mn ? timeOf(b) : b.visit_time || '')}" placeholder="13:30" autocomplete="off"></label>
            ${tpick('xp-e-time', mn ? timeOf(b) : b.visit_time, mn)}
            <label>체험<input type="number" min="0" max="200" id="xp-e-exp" value="${b.exp_count || 0}"></label>
            <label>입장<input type="number" min="0" max="200" id="xp-e-entry" value="${b.entry_count || 0}"></label>
            <label>유아<input type="number" min="0" max="200" id="xp-e-inf" value="${b.infant_count || 0}"></label>
            ${mn ? `<label>금액(원)<input type="number" min="0" step="1000" id="xp-e-amount" value="${b.amount == null ? '' : Number(b.amount)}"></label>` : ''}
            <label class="w">메모<input type="text" id="xp-e-memo" maxlength="500" value="${esc(b.memo || '')}"></label>
            ${b.option_text ? `<div class="xp-raw"><b>주문 옵션 글</b>${esc(b.option_text)}</div>` : ''}
            <div class="xp-edit-acts"><button type="button" class="xp-btn pri" data-act="save">저장</button>${b.source === 'store' || b.contact_at ? '<button type="button" class="xp-btn" data-act="sms">문자 미리보기</button>' : ''}
            ${mn ? (b.status === 'canceled' ? '<button type="button" class="xp-btn" data-act="undel">되돌리기</button>' : '<button type="button" class="xp-btn warn" data-act="del">삭제(취소)</button>') : ''}
            ${pl ? '<small class="xp-hint">번호를 넣고 저장하면 그 자리에서 접수 알림톡이 나가요 · 취소는 네이버 플레이스에서(메일로 반영)</small>' : mn ? '<small class="xp-hint">수기 예약은 직원이 직접 고치고 지워요(수집이 덮지 않음) · 번호를 바꾸면 그 자리에서 접수 안내</small>' : ''}<button type="button" class="xp-btn" data-act="close-edit">닫기</button></div>
            <div class="xp-pre" id="xp-pre" hidden></div></div>`;
    }
    // #808 수기(현금) 예약 추가 칸 — 그 날 판 맨 위 · 금액은 인원으로 셈(고치면 그 값 유지)
    function addHtml(day) {
        return `<div class="xp-edit xp-add" id="xp-add">
            <b class="xp-add-h">수기 예약 추가 <small>현금 등 · 직원이 받은 예약</small></b>
            <label>이름<input type="text" id="xp-a-name" maxlength="30" placeholder="손님 이름" autocomplete="off"></label>${telInput('xp-a-phone', '')}
            <label>방문일<input type="text" class="akm-date xp-date" id="xp-a-date" value="${esc(day)}" placeholder="날짜 선택" readonly autocomplete="off"></label>
            <label>시간<input type="text" id="xp-a-time" placeholder="13:30 · 모르면 미정" autocomplete="off"></label>
            ${tpick('xp-a-time', '', true)}
            <label>체험<input type="number" min="0" max="200" id="xp-a-exp" value="1"></label>
            <label>입장<input type="number" min="0" max="200" id="xp-a-entry" value="0"></label>
            <label>유아<input type="number" min="0" max="200" id="xp-a-inf" value="0"></label>
            <label>금액(원)<input type="number" min="0" step="1000" id="xp-a-amount" value="${PRICE.exp}"></label>
            <label class="w">메모<input type="text" id="xp-a-memo" maxlength="500" placeholder="예: 현금 결제"></label>
            <div class="xp-edit-acts"><button type="button" class="xp-btn pri" data-act="add-save">추가</button><button type="button" class="xp-btn" data-act="add-cancel">닫기</button><small class="xp-hint">번호를 넣으면 추가하는 그 자리에서 접수 알림톡이 나가요 · 방문 전날 안내도 같이</small></div></div>`;
    }
    // 보이는 예약(취소 포함 체크 때만 취소·반품) · 날짜 확인 필요 · 날짜별 묶음(시간순)
    function sets() {
        const items = (X.data && X.data.items) || [];
        const shown = items.filter(b => X.showOff || !OFF.includes(b.status));
        const need = shown.filter(b => !b.date_ok && ['confirmed', 'unknown'].includes(b.status));
        const byDay = new Map();
        for (const b of shown) { if (need.includes(b) || !b.visit_date) continue; if (!byDay.has(b.visit_date)) byDay.set(b.visit_date, []); byDay.get(b.visit_date).push(b); }
        for (const l of byDay.values()) l.sort((a, b) => String(a.visit_time || '99').localeCompare(String(b.visit_time || '99')) || a.id - b.id);
        const offNoDate = shown.filter(b => OFF.includes(b.status) && !b.visit_date);
        const nophone = items.filter(noPhone).sort((a, b) => String(a.visit_date || '').localeCompare(String(b.visit_date || '')) || String(a.visit_time || '').localeCompare(String(b.visit_time || '')));   // #804   // #785 날짜 없는 취소·반품(취소 포함일 때만 shown 에 있음) — 달력 칸이 없어 띠로
        return { need, byDay, offNoDate, nophone };
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
        const { need, byDay, offNoDate, nophone } = sets(), t = today();
        const pill = $('xp-nophone'); if (pill) { pill.hidden = false; pill.classList.toggle('none', !nophone.length); pill.textContent = nophone.length ? `번호 미입력 ${nophone.length}건` : '번호 미입력 없음'; pill.setAttribute('aria-label', `플레이스·수기 번호 미입력 ${nophone.length}건 — 눌러서 이름·번호 넣기`); }   // #804
        let html = '';
        if (X.jumpFrom) html += `<div class="xp-jump">${+X.jumpFrom.slice(5)}월엔 남은 예약이 없어 ${+X.ym.slice(5)}월을 보여 드려요 · <button type="button" class="xp-link" data-nav="0">‹ 이번 달</button></div>`;
        if (need.length) html += `<button type="button" class="xp-needbar" data-day="need"><b>날짜 확인 필요 ${need.length}건</b><span>${esc(need.slice(0, 3).map(b => b.name || '(이름 없음)').join(' · '))}${need.length > 3 ? ' 외' : ''} — 눌러서 날짜·시간 넣기</span></button>`;
        if (offNoDate.length) html += `<button type="button" class="xp-needbar off" data-day="offnodate"><b>날짜 없는 취소·반품 ${offNoDate.length}건</b><span>${esc(offNoDate.slice(0, 3).map(b => b.name || '(이름 없음)').join(' · '))}${offNoDate.length > 3 ? ' 외' : ''} — 눌러서 보기</span></button>`;
        const sm = saleMonth(X.ym);   // #822 이달 현장 판매 합계(0이면 안 보임)
        if (sm.sum) html += `<div class="xp-sales-sum" id="xp-sales-sum"><b>이달 현장 판매(귤)</b><span>${won(sm.sum)}원</span><em>· ${sm.days}일 · 날짜 칸을 눌러 적어요</em></div>`;
        html += '<div class="xp-cal" role="grid" aria-label="체험 예약 달력"><div class="xp-cal-h" role="row">' + [...DOW].map((w, i) => `<span role="columnheader" class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('') + '</div><div class="xp-cal-g">';
        const lead = new Date(Date.UTC(mr.y, mr.m - 1, 1)).getUTCDay();
        for (let i = 0; i < lead; i++) html += '<span class="xp-cell out" aria-hidden="true"></span>';
        for (let day = 1; day <= mr.last; day++) {
            const ds = `${X.ym}-${String(day).padStart(2, '0')}`, dow = (lead + day - 1) % 7;
            const list = byDay.get(ds) || [], live = list.filter(b => !OFF.includes(b.status));
            const ppl = live.reduce((a, b) => a + headCount(b), 0);
            const cls = ['xp-cell', dow === 0 ? 'sun' : dow === 6 ? 'sat' : '', ds === t ? 'today' : '', ds < t ? 'past' : '', list.length ? 'has' : ''].filter(Boolean).join(' ');
            const names = list.slice(0, 3).map(b => `<span class="xp-nm${srcCls(b)}${OFF.includes(b.status) ? ' off' : ''}">${esc(timeOf(b))} ${esc(b.name || '(이름 없음)')}</span>`).join('');
            const more = list.length > 3 ? `<span class="xp-more">+${list.length - 3} 더보기</span>` : '';
            const sl = saleOf(ds), sale = sl && Number(sl.amount) > 0 ? `<span class="xp-sale" title="현장 판매(귤) ${won(sl.amount)}원"><i>₩</i><em>현장 ${won(sl.amount)}</em></span>` : '';   // #822
            const aria = `${+ds.slice(5, 7)}월 ${day}일 ${DOW[dow]}요일${live.length ? ` · ${live.length}팀 ${ppl}명` : ' · 예약 없음'}${sale ? ` · 현장 판매 ${won(sl.amount)}원` : ''}`;
            html += `<button type="button" class="${cls}" data-day="${ds}" aria-label="${esc(aria)}"><span class="xp-dn">${ds === t ? '오늘' : day}</span>${live.length ? `<span class="xp-cnt"><b>${live.length}팀</b><em> · ${ppl}명</em></span>` : (list.length ? '<span class="xp-cnt off">취소만</span>' : '')}<span class="xp-nms">${names}${more}</span>${live.length ? `<span class="xp-dots" aria-hidden="true">${live.slice(0, 5).map(b => `<i class="xp-dot${srcCls(b)}"></i>`).join('')}</span>` : ''}${sale}</button>`;
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
        const { need, byDay, offNoDate, nophone } = sets();
        const list = X.day === 'need' ? need : X.day === 'offnodate' ? offNoDate : X.day === 'nophone' ? nophone : (byDay.get(X.day) || []);
        const live = list.filter(b => !OFF.includes(b.status));
        const tot = k => live.reduce((a, b) => a + (Number(b[k]) || 0), 0);
        const title = X.day === 'need' ? '날짜 확인 필요' : X.day === 'offnodate' ? '날짜 없는 취소·반품' : X.day === 'nophone' ? '번호 미입력(플레이스·수기)' : dLabel(X.day);
        const sub = X.day === 'nophone' ? `${list.length}건 · 플레이스는 스마트플레이스 예약자관리에서 같은 예약번호 줄의 이름·전화번호를, 수기는 받아 둔 번호를 넣어 주세요(저장 = 그 자리에서 접수 알림톡)` : X.day === 'offnodate' ? `${list.length}건 · 방문 날짜를 못 읽은 취소·반품이에요(손님 응대 없음 · 기록용)` : X.day === 'need' ?`${list.length}건 · 손님께 확인한 뒤 [수정]에서 날짜·시간을 넣어 주세요(넣으면 문자 대상)` : `${live.length}팀 · 체험 ${tot('exp_count')} · 입장 ${tot('entry_count')}${tot('infant_count') ? ' · 유아 ' + tot('infant_count') : ''}`;
        p.hidden = false;
        const isDay = /^\d{4}-\d{2}-\d{2}$/.test(X.day || '');   // #808 날짜 판에만 [+ 예약 추가]
        p.innerHTML = `<div class="xp-panel-h"><div><h3>${esc(title)}</h3><small>${esc(sub)}</small></div>${isDay ? `<button type="button" class="xp-btn pri xp-addbtn" data-act="add" aria-expanded="${X.adding === X.day}">+ 예약 추가</button>${!saleOf(X.day) && X.saleEdit !== X.day ? '<button type="button" class="xp-btn xp-salebtn" data-act="sale-edit" aria-expanded="false">+ 현장 판매</button>' : ''}` : ''}<button type="button" class="xp-x" data-act="close-panel" aria-label="명단 닫기">×</button></div>
            <div class="xp-panel-b">${isDay ? saleHtml(X.day) : ''}${isDay && X.adding === X.day ? addHtml(X.day) : ''}${list.length ? `<ul>${listHtml(list, MULTI.includes(X.day))}</ul>` : `<div class="xp-empty">${X.day === 'nophone' ? '번호를 넣을 플레이스 예약이 없어요.' : '이 날은 예약이 없어요.'}</div>`}</div>`;
        X.saleDirty = false;   // #822 판을 새로 그리면 적던 값은 없어진 것
        if (X.edit) { const f = $('xp-e-date'); if (f && !p.contains(document.activeElement)) f.focus({ preventScroll: true }); }
    }
    // 폰 뒤로가기 = 명단 판만 닫힘(#678 「하나씩」) — 판을 열 때 기록 한 칸(xpDay) · 판을 다른 길(×·Esc·달 넘김)로 닫으면 그 칸을 걷고 그때 오는 popstate 한 번은 무시
    function pushDayHist() { if (X.dayPushed || !X.pushed) return; try { history.pushState(Object.assign({}, history.state || {}, { xpDay: 1 }), ''); X.dayPushed = true; } catch (e) { X.dayPushed = false; } }
    function dropDayHist() { if (!X.dayPushed) return; X.dayPushed = false; X.ignorePop = true; try { history.back(); } catch (e) { X.ignorePop = false; } }
    function openDay(day) { X.day = day; X.edit = 0; X.adding = null; X.saleEdit = null; pushDayHist(); renderPanel(); const c = X.layer && X.layer.querySelector('[data-act="close-panel"]'); if (c) c.focus({ preventScroll: true }); }
    function closeDay(fromPop) { const was = X.day; X.day = null; X.edit = 0; X.adding = null; X.saleEdit = null; if (!fromPop) dropDayHist(); renderPanel(); const cell = was && X.layer && X.layer.querySelector(`[data-day="${was}"]`); if (cell) cell.focus({ preventScroll: true }); }
    // #808 번호 = 치는 대로 하이픈(숫자만 남겨 3-4-4 · 10자리 3-3-4) · 커서는 끝 · 수기 금액 = 인원으로 셈(금액을 손으로 고치면 그 뒤론 안 셈)
    function onInput(e) {
        const t = e.target;
        if (t.classList.contains('xp-ph')) {
            if (e.isComposing) return;   // 한글 조합 중엔 안 건드림
            const f = fmtTel(t.value);
            if (f !== t.value) {   // 바뀐 때만 · 커서 = 그 앞 숫자 개수 기준(가운데를 고쳐도 끝으로 안 튐)
                const pos = t.selectionStart == null ? t.value.length : t.selectionStart, nd = t.value.slice(0, pos).replace(/[^0-9]/g, '').length;
                t.value = f; let c = 0, i = 0; while (i < f.length && c < nd) { if (/[0-9]/.test(f[i])) c++; i++; }
                try { t.setSelectionRange(i, i); } catch (_) { }
            } const er = $(t.id + '-err'); if (er && !er.hidden && telOk(t.value) && t.value.replace(/[^0-9]/g, '').length >= 10) { er.hidden = true; t.removeAttribute('aria-invalid'); } return; }
        if (t.id === 'xp-a-amount') { t.dataset.touched = '1'; return; }
        if (t.id === 'xp-sl-amount' || t.id === 'xp-sl-memo') {   // #822 금액 = 숫자만 · 1,234,567 꼴 · 적는 중엔 60초 새로고침이 판을 다시 안 그림
            X.saleDirty = true;
            if (t.id === 'xp-sl-amount') { const d = t.value.replace(/[^0-9]/g, '').slice(0, 9); const f = d ? Number(d).toLocaleString('ko-KR') : ''; if (f !== t.value) { t.value = f; try { t.setSelectionRange(f.length, f.length); } catch (_) { } } }
            return;
        }
        if (/^xp-a-(exp|entry)$/.test(t.id)) { const a = $('xp-a-amount'); if (a && !a.dataset.touched) a.value = (Number(($('xp-a-exp') || {}).value) || 0) * PRICE.exp + (Number(($('xp-a-entry') || {}).value) || 0) * PRICE.entry; }
        if (t.id === 'xp-e-time' || t.id === 'xp-a-time') markTp(t);
    }
    function telCheck(t) { const er = $(t.id + '-err'); const bad = !telOk(t.value); if (er) er.hidden = !bad; if (bad) t.setAttribute('aria-invalid', 'true'); else t.removeAttribute('aria-invalid'); return !bad; }
    function markTp(input) { const box = X.layer && X.layer.querySelector(`.xp-tpick[data-for="${input.id}"]`); if (!box) return; for (const b of box.querySelectorAll('.xp-tp')) { const on = b.dataset.tp === input.value.trim(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); } }
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
        const tp = e.target.closest('[data-tp]');   // #808 시간 알약
        if (tp) { const box = tp.closest('.xp-tpick'), inp = box && $(box.dataset.for); if (inp) { inp.value = tp.dataset.tp; markTp(inp); } return; }
        const btn = e.target.closest('[data-act]'); if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'close-panel') return closeDay();
        if (act === 'sale-edit') { X.saleEdit = X.day; renderPanel(); const a = $('xp-sl-amount'); if (a) a.focus({ preventScroll: false }); return; }   // #822-b
        if (act === 'sale-cancel') { X.saleEdit = null; X.saleDirty = false; return renderPanel(); }
        if (act === 'sale-del') {   // #822-b 지우기 = 한 번 더 눌러 확인 → 금액 0·빈 메모 PUT(서버가 줄을 지움)
            if (btn.dataset.ask !== '1') { btn.dataset.ask = '1'; btn.textContent = '정말 삭제(한 번 더)'; return; }
            const line = btn.closest('.xp-sale-line'), day = line && line.dataset.day; if (!day) return;
            btn.disabled = true; const r = await call(`/api/agent-office/experience/sales/${day}`, 'PUT', { amount: 0, memo: '' });
            if (!r.ok) { toast(r.body.error || '지우지 못했어요'); btn.disabled = false; return; }
            X.data.sales = (X.data.sales || []).filter(s => s.day !== day); X.saleEdit = null; toast('현장 판매 줄을 지웠어요'); render(); return;
        }
        if (act === 'sale-save') {   // #822 현장 판매(귤) 저장 — 날짜당 한 줄 덮어쓰기 · 0·빈 메모 = 지움
            const box = btn.closest('.xp-sale-box'), day = box && box.dataset.day; if (!day) return;
            const amount = Number(String(($('xp-sl-amount') || {}).value || '').replace(/[^0-9]/g, '')) || 0, memo = String(($('xp-sl-memo') || {}).value || '').trim();
            btn.disabled = true; const r = await call(`/api/agent-office/experience/sales/${day}`, 'PUT', { amount, memo });
            if (!r.ok) { toast(r.body.error || '저장하지 못했어요'); btn.disabled = false; return; }
            const list = (X.data.sales = (X.data.sales || []).filter(s => s.day !== day)); if (r.body.item) list.push(r.body.item);
            X.saleDirty = false; X.saleEdit = null; toast(r.body.item ? `현장 판매 ${won(r.body.item.amount)}원 저장했어요` : '현장 판매 줄을 지웠어요');
            render(); return;
        }
        if (act === 'add') { X.adding = X.adding === X.day ? null : X.day; X.edit = 0; renderPanel(); const n = $('xp-a-name'); if (n) n.focus({ preventScroll: false }); return; }
        if (act === 'add-cancel') { X.adding = null; return renderPanel(); }
        if (act === 'add-save') {
            const v = id2 => String(($(id2) || {}).value || '').trim();
            const body = { name: v('xp-a-name'), phone: v('xp-a-phone').replace(/[^0-9]/g, ''), visit_date: v('xp-a-date'), visit_time: v('xp-a-time'), exp_count: Number(v('xp-a-exp')) || 0, entry_count: Number(v('xp-a-entry')) || 0, infant_count: Number(v('xp-a-inf')) || 0, amount: v('xp-a-amount') === '' ? null : Number(v('xp-a-amount')), memo: v('xp-a-memo') };
            if (!body.name) { toast('손님 이름을 넣어 주세요'); $('xp-a-name').focus(); return; }
            if (body.name.includes('*')) { toast('이름에 *(가린 글자)가 있어요 — 손님 이름으로 넣어 주세요'); return; }
            if (!telCheck($('xp-a-phone'))) { $('xp-a-phone').focus(); return; }
            if (!body.visit_date) { toast('방문일을 골라 주세요'); return; }
            if (!body.visit_time) { toast('시간을 골라 주세요(모르면 「미정」)'); $('xp-a-time').focus(); return; }
            if (body.exp_count + body.entry_count + body.infant_count < 1) { toast('인원을 1명 이상 넣어 주세요'); return; }
            btn.disabled = true; const r = await call('/api/agent-office/experience', 'POST', body);
            if (!r.ok) { toast(r.body.error || '추가하지 못했어요'); btn.disabled = false; return; }
            X.adding = null; toast(r.body.sent ? sentMsg(r.body.sent).replace(/^저장/, '추가') : '추가했어요 · 번호가 없어 접수 안내는 안 보냈어요');
            if (body.visit_date !== X.day) { X.day = body.visit_date; if (ymOf(body.visit_date) !== X.ym) { X.ym = ymOf(body.visit_date); X.jumpFrom = null; } }
            return load(true);
        }
        const li = btn.closest('[data-id]'); const id = li ? +li.dataset.id : 0; const b = (X.data.items || []).find(x => x.id === id);
        if (act === 'edit') { X.edit = X.edit === id ? 0 : id; X.adding = null; return renderPanel(); }
        if (act === 'del' || act === 'undel') {   // #808 수기 건만 · 지우기 = 취소 표시(되돌리기 가능) · 한 번 더 눌러 확인
            if (act === 'del' && btn.dataset.ask !== '1') { btn.dataset.ask = '1'; btn.textContent = '정말 삭제(한 번 더)'; return; }
            btn.disabled = true; const r = await call(`/api/agent-office/experience/${id}`, 'PATCH', { status: act === 'del' ? 'canceled' : 'confirmed' });
            if (!r.ok) { toast(r.body.error || '저장하지 못했어요'); btn.disabled = false; return; }
            Object.assign(b, r.body.item); X.edit = 0; toast(act === 'del' ? '수기 예약을 지웠어요(취소 포함에서 보이고 되돌릴 수 있어요)' : '되돌렸어요'); return load(true);
        }
        if (act === 'close-edit') { X.edit = 0; return renderPanel(); }
        if (act === 'visit') {
            btn.disabled = true; const r = await call(`/api/agent-office/experience/${id}/visit`, 'POST', { on: b.status !== 'visited' });
            if (!r.ok) { toast(r.body.error || '저장하지 못했어요'); btn.disabled = false; return; }
            Object.assign(b, r.body.item); return render();
        }
        if (act === 'save' || act === 'qsave') {
            const body = {};
            const v = id2 => ($(id2) || {}).value;
            if (b.source === 'place' || b.source === 'manual') {   // #804 이름·번호(바뀐 것만) · #808 수기도
                const nm = String(v(act === 'qsave' ? 'xp-q-name-' + id : 'xp-e-name') == null ? (b.name || '') : v(act === 'qsave' ? 'xp-q-name-' + id : 'xp-e-name')).trim();
                const ph = String(v(act === 'qsave' ? 'xp-q-phone-' + id : 'xp-e-phone') == null ? (b.phone || '') : v(act === 'qsave' ? 'xp-q-phone-' + id : 'xp-e-phone')).replace(/[^0-9]/g, '');
                if (nm !== (b.name || '')) body.name = nm;
                if (ph !== (b.phone || '')) body.phone = ph;
                if ((ph || b.phone) && nm.includes('*')) { toast('이름에 *(가린 글자)가 남아 있어요 — 손님 이름으로 고쳐 주세요'); return; }
                if (ph && !/^01[0-9]{8,9}$/.test(ph)) { const pi = $(act === 'qsave' ? 'xp-q-phone-' + id : 'xp-e-phone'); if (pi) { telCheck(pi); pi.focus(); } toast('번호는 010 으로 시작하는 10~11자리'); return; }
            }
            if (act === 'save') {
                const nd = String(v('xp-e-date') || '').trim(), nt = String(v('xp-e-time') || '').trim();
                if (nd !== (b.visit_date || '')) body.visit_date = nd || null;
                const ot = b.source === 'manual' ? timeOf(b) : (b.visit_time || '');   // #930 수기 미정 줄은 칸에 「미정」이 들어 있음 → 안 바꾸면 안 보냄
                if (nt !== ot) body.visit_time = nt || null;
                for (const [k, f] of [['exp_count', 'xp-e-exp'], ['entry_count', 'xp-e-entry'], ['infant_count', 'xp-e-inf']]) { const n = Number(v(f)); if (n !== Number(b[k] || 0)) body[k] = n; }
                const memo = String(v('xp-e-memo') || ''); if (memo !== (b.memo || '')) body.memo = memo;
                if (b.source === 'manual') { const am = String(v('xp-e-amount') == null ? '' : v('xp-e-amount')).trim(); if (am !== '' && Number(am) !== Number(b.amount)) body.amount = Number(am); }   // #808
                if (!Object.keys(body).length) { X.edit = 0; return renderPanel(); }   // (이름·번호만 바뀐 경우도 body 에 있어 여기 안 옴)
            }
            if (act === 'qsave' && !Object.keys(body).length) { toast('바뀐 것이 없어요'); return; }
            btn.disabled = true; const r = await call(`/api/agent-office/experience/${id}`, 'PATCH', body);
            if (!r.ok) { toast(r.body.error || '저장하지 못했어요'); btn.disabled = false; return; }
            Object.assign(b, r.body.item); X.edit = 0; toast(sentMsg(r.body.sent));
            if (body.visit_date) X.day = body.visit_date;   // 날짜를 넣거나 옮기면 판도 그 날로(확인 필요 묶음에서 넣은 경우 포함)
            if (body.visit_date && ymOf(body.visit_date) !== X.ym) { X.ym = ymOf(body.visit_date); X.jumpFrom = null; }
            return load(true);
        }
        if (act === 'sms') {   // #804 「메일 원문」 단추 뺌(서버 …/raw 는 진단용으로 남김)
            const pre = $('xp-pre'); pre.hidden = false; pre.textContent = '불러오는 중…';
            const r = await call(`/api/agent-office/experience/${id}/sms-preview`);
            if (!r.ok) { pre.textContent = r.body.error || '읽지 못했어요'; return; }
            pre.textContent = `[접수 즉시]\n${r.body.recv}\n\n[방문 전날]\n${r.body.eve}\n\n${r.body.will_send ? '→ 손님 문자가 켜져 있어 보낼 대상이에요' : '→ 지금은 보내지 않아요(문자 꺼짐 · 날짜 확인 필요 · 취소 · 연락처 없음 중 하나)'}`;
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
    // Esc = (달력) → 추가·수정 칸 → 그 날 명단 판 → 문자 설정 → 창 순으로 하나씩 닫는다 — 초점이 창 밖(body)으로 빠져도 받게 문서에 건다(열려 있을 때만)
    function onKey(e) {
        if (e.key !== 'Escape' || !X.layer) return; e.preventDefault(); e.stopPropagation();
        const cal = document.querySelector('.akm-cal'); if (cal && cal.style.display !== 'none') { if (typeof AkmCal !== 'undefined' && AkmCal.close) AkmCal.close(); else cal.style.display = 'none'; return; }   // #808 달력부터
        if (X.saleEdit) { X.saleEdit = null; X.saleDirty = false; renderPanel(); } else if (X.adding) { X.adding = null; renderPanel(); } else if (X.edit) { X.edit = 0; renderPanel(); } else if (X.day) closeDay(); else if (!$('xp-set').hidden) { $('xp-set').hidden = true; } else close();
    }
    function open() {
        if (X.layer) { load(); return; }
        X.layer = shell(); document.body.classList.add('xp-open'); document.addEventListener('keydown', onKey, true);
        // 뒤로가기 칸 = 지금 기록(ao-desk 의 aoDesk 깊이 값 포함) 위에 한 칸 — 깊이 값을 이어 붙여야 ao-desk 가 제 칸을 잘못 닫지 않는다
        try { history.pushState(Object.assign({}, history.state || {}, { xpExp: 1 }), ''); X.pushed = true; window.addEventListener('popstate', onPop); } catch (e) { X.pushed = false; }
        X.ym = ymOf(today()); X.day = null; X.edit = 0; X.auto = true; X.jumpFrom = null; load();
        X.timer = setInterval(() => { if (!document.hidden && !X.edit && !X.saleDirty && !document.activeElement.closest('#xp-set')) load(true); }, 60000);   // #822 현장 판매 적는 중엔 쉼
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
    window.AkmExp = { open, close, isOpen: () => !!X.layer, settings: () => { if (X.layer && isAdmin()) toggleSet(); } };   // #822 settings = 숨긴 문자 설정 창(관리자 · 콘솔용)
})();
