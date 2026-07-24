// ==========================================
// 제주아꼼이네 농업회사법인 (주) - 회사 프로그램
// ==========================================

// ---- PWA 설치 ----
let deferredInstallPrompt = null;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

// beforeinstallprompt 이벤트 저장 (Android Chrome)
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallButton();
    showInstallBannerIfNeeded();
});

// 설치 완료 시 버튼 숨김
window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallButton();
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
});

function showInstallButton() {
    const btn = document.getElementById('btn-install-app');
    if (btn && !isStandalone) btn.style.display = '';
}
function hideInstallButton() {
    const btn = document.getElementById('btn-install-app');
    if (btn) btn.style.display = 'none';
}

window.handleInstallClick = function() {
    if (deferredInstallPrompt) {
        // Android Chrome: 설치 팝업
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(result => {
            if (result.outcome === 'accepted') hideInstallButton();
            deferredInstallPrompt = null;
        });
    } else if (isIOS) {
        // iOS Safari: 안내 모달
        document.getElementById('ios-install-modal').style.display = '';
    } else {
        // 기타 (PC 등): 안내 모달
        document.getElementById('pc-install-modal').style.display = '';
    }
};

function showInstallBannerIfNeeded() {
    if (isStandalone) return;
    const dismissed = localStorage.getItem('pwa_banner_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = '';
}
window.dismissInstallBanner = function() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
    localStorage.setItem('pwa_banner_dismissed', Date.now().toString());
};

// iOS/기타 브라우저: beforeinstallprompt 미지원 → 직접 버튼/배너 표시
if (!isStandalone) {
    document.addEventListener('DOMContentLoaded', () => {
        if (isIOS) {
            showInstallButton();
            showInstallBannerIfNeeded();
        }
    });
}

// ---- API Helper (JWT 자동 첨부) ----
async function api(url, method = 'GET', body = null) {
    const options = { method, headers: {} };
    const token = localStorage.getItem('jwt_token');
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('jwt_user');
        showLoginPage();
        throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '서버 오류' }));
        throw new Error(err.error || '서버 오류');
    }
    return res.json();
}

// 캐시
let settlementsCache = [];
let pricingCache = [];
let currentUser = null;

// =============================================
// 인증 (로그인 / 로그아웃)
// =============================================

function showLoginPage() {
    document.getElementById('login-page').style.display = 'flex';
    document.querySelector('.app').style.display = 'none';
    currentUser = null;
    stopNotiPolling();
}

function showAppPage() {
    document.getElementById('login-page').style.display = 'none';
    document.querySelector('.app').style.display = 'flex';
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
        errorEl.textContent = '아이디와 비밀번호를 입력해주세요.';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.error || '로그인 실패';
            errorEl.style.display = 'block';
            return;
        }

        localStorage.setItem('jwt_token', data.token);
        localStorage.setItem('jwt_user', JSON.stringify(data.user));
        currentUser = data.user;
        errorEl.style.display = 'none';
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
        onLoginSuccess();
    } catch (err) {
        errorEl.textContent = '서버 연결에 실패했습니다.';
        errorEl.style.display = 'block';
    }
});

function onLoginSuccess() {
    showAppPage();
    updateUserUI();
    init();
    startNotiPolling();
}

function updateUserUI() {
    if (!currentUser) return;
    document.getElementById('welcome-message').textContent =
        `${currentUser.position} ${currentUser.name}님 안녕하세요`;
    document.getElementById('annual-leave-count').textContent = formatLeave(currentUser.annualLeave);
    document.getElementById('sidebar-user-name').textContent = `${currentUser.position} ${currentUser.name}`;
    document.getElementById('sidebar-user-dot').style.backgroundColor = currentUser.color;

    const userCard = document.getElementById('user-management-card');
    if (userCard) userCard.style.display = currentUser.role === 'admin' ? '' : 'none';
    const naverCard = document.getElementById('naver-connect-card'); // 대표 7/24: 네이버 연동(관리자만)
    if (naverCard) naverCard.style.display = currentUser.role === 'admin' ? '' : 'none';

    // 관리자 전용 메뉴 숨김 (정산관리, 품목별 금액, 데이터관리, AGENT OFFICE)
    const adminOnlyPages = ['settlement', 'pricing', 'data', 'agent-office'];
    adminOnlyPages.forEach(page => {
        const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navEl) navEl.style.display = currentUser.role === 'admin' ? '' : 'none';
    });

    // 세무사(accountant): 지출결의서만 노출, 나머지 메뉴 모두 숨김
    if (currentUser.role === 'accountant') {
        const allowed = ['expense'];
        document.querySelectorAll('.nav-item[data-page]').forEach(nav => {
            nav.style.display = allowed.includes(nav.dataset.page) ? '' : 'none';
        });
    }

    // 관리자 전용 📢 지시사항 버튼
    const announcementBtn = document.getElementById('announcement-btn');
    if (announcementBtn) announcementBtn.style.display = currentUser.role === 'admin' ? '' : 'none';

    // 버전 칩 (0단계 버전 시스템) — AGENT OFFICE 제목 옆, 조회 API가 관리자 전용이라 관리자에게만 표시
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
        versionEl.textContent = '';
        if (currentUser.role === 'admin') {
            api('/api/version').then(d => { versionEl.textContent = d.version; }).catch(() => {});
        }
    }
}

document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('jwt_user');
    currentUser = null;
    showLoginPage();
});

function checkAuth() {
    const token = localStorage.getItem('jwt_token');
    const userStr = localStorage.getItem('jwt_user');
    if (token && userStr) {
        currentUser = JSON.parse(userStr);
        api('/api/auth/me').then(user => {
            currentUser = user;
            localStorage.setItem('jwt_user', JSON.stringify(user));
            onLoginSuccess();
        }).catch(() => {
            showLoginPage();
        });
    } else {
        showLoginPage();
    }
}

// =============================================
// Navigation
// =============================================
const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        switchPage(page);
        closeMobileSidebar();
    });
});

// 모바일 사이드바 토글
window.toggleMobileSidebar = function() {
    document.querySelector('.sidebar').classList.toggle('mobile-open');
    document.querySelector('.mobile-overlay').classList.toggle('show');
};
window.closeMobileSidebar = function() {
    document.querySelector('.sidebar').classList.remove('mobile-open');
    document.querySelector('.mobile-overlay').classList.remove('show');
};

function switchPage(pageName) {
    // 관리자 전용 페이지 접근 차단
    const adminOnlyPages = ['settlement', 'pricing', 'data', 'agent-office'];
    if (adminOnlyPages.includes(pageName) && currentUser?.role !== 'admin') {
        pageName = 'schedule';
    }
    // 세무사: 지출결의서 외엔 모두 expense로
    if (currentUser?.role === 'accountant' && pageName !== 'expense') {
        pageName = 'expense';
    }

    navItems.forEach(n => n.classList.remove('active'));
    pages.forEach(p => p.classList.remove('active'));

    document.querySelector(`[data-page="${pageName}"]`).classList.add('active');
    document.getElementById(`page-${pageName}`).classList.add('active');

    if (pageName === 'schedule') renderScheduleCalendar().catch(console.error);
    if (pageName === 'rankings') renderRankingsPage().catch(console.error);
    if (pageName === 'document') {
        loadApprovers().catch(console.error);
        renderDocList().catch(console.error);
        renderMyApprovedList().catch(console.error);
        document.getElementById('approval-pending-card').style.display = currentUser?.role === 'admin' ? '' : 'none';
        document.getElementById('doc-main-tabs').style.display = currentUser?.role === 'admin' ? '' : 'none';
        if (currentUser?.role === 'admin') renderApprovalList().catch(console.error);
        if (currentUser) document.getElementById('doc-applicant').value = `${currentUser.position} ${currentUser.name}`;
        updateDocEndDateVisibility();
        // 항상 신청목록 탭으로 초기화
        document.querySelectorAll('.doc-main-tab').forEach(t => t.classList.toggle('active', t.dataset.docMain === 'list'));
        document.getElementById('doc-section-list').style.display = '';
        document.getElementById('doc-section-history').style.display = 'none';
    }
    if (pageName === 'expense') {
        initExpensePage();
    }
    if (pageName === 'settlement') {
        renderSettlementCalendar().catch(console.error);
        renderSettlementList().catch(console.error);
        renderWeeklySettlement().catch(console.error);
        renderPrepaymentCard().catch(console.error);
    }
    if (pageName === 'worklog') renderWorklogPage().catch(console.error);
    if (pageName === 'pricing') renderPricingList().catch(console.error);
    if (pageName === 'invoice') aoRenderInvoiceCatalog().catch(console.error); // 송장변환: 오늘 판매 품목 로드·표시 (대표 7/20)
    if (pageName === 'planner') renderPlannerPage().catch(console.error);
    if (pageName === 'inventory') renderBoxInventory().catch(console.error);
    if (pageName === 'cs-room') renderCsTemplates().catch(console.error);
    if (pageName === 'data' && currentUser?.role === 'admin') renderUserList().catch(console.error);
    if (pageName === 'myinfo') renderMyInfoPage();
    if (pageName === 'agent-office') renderAgentOffice().catch(console.error);
}

// =============================================
// 일정 캘린더 (메인화면)
// =============================================
let scheduleYear = new Date().getFullYear();
let scheduleMonth = new Date().getMonth();

document.getElementById('schedule-prev-month').addEventListener('click', () => {
    scheduleMonth--;
    if (scheduleMonth < 0) { scheduleMonth = 11; scheduleYear--; }
    renderScheduleCalendar().catch(console.error);
});

document.getElementById('schedule-next-month').addEventListener('click', () => {
    scheduleMonth++;
    if (scheduleMonth > 11) { scheduleMonth = 0; scheduleYear++; }
    renderScheduleCalendar().catch(console.error);
});

document.getElementById('schedule-refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('schedule-refresh-btn');
    btn.classList.add('spinning');
    try {
        await renderScheduleCalendar();
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        document.getElementById('schedule-refresh-time').textContent = `${h}:${m} 업데이트됨`;
    } catch (err) {
        console.error('새로고침 오류:', err);
    }
    btn.classList.remove('spinning');
});

// 일정 유형 필터 (다중 토글) + 순위관리 페이지 진입 버튼
// 직원 색상 범례를 대체. 필터 상태는 window._scheduleTypeFilter (Set).
function renderScheduleTypeFilter() {
    const wrap = document.getElementById('schedule-legend');
    if (!wrap) return;
    if (!window._scheduleTypeFilter) {
        window._scheduleTypeFilter = new Set(['event','product','duty','normal','vacation','attendance']);
    }
    const f = window._scheduleTypeFilter;
    const isAll = ['event','product','duty','normal','vacation','attendance'].every(t => f.has(t));
    const types = [
        { key: 'all',     label: '전체', cls: 'sch-flt-all' },
        { key: 'event',   label: '🎉 행사', cls: 'sch-flt-event' },
        { key: 'product', label: '📦 상품', cls: 'sch-flt-product' },
        { key: 'duty',    label: '🌙 당직', cls: 'sch-flt-duty' },
        { key: 'normal',  label: '일반', cls: 'sch-flt-normal' }
    ];
    wrap.innerHTML = types.map(t => {
        let active;
        if (t.key === 'all') active = isAll;
        else active = f.has(t.key);
        return `<button class="sch-flt-btn ${t.cls}${active ? ' active' : ''}" data-type="${t.key}">${t.label}</button>`;
    }).join('') +
    `<button class="sch-flt-btn sch-flt-rank" data-type="__rank__" title="순위관리 화면으로 이동">📊 순위</button>`;

    wrap.querySelectorAll('.sch-flt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const k = btn.dataset.type;
            if (k === '__rank__') { switchPage('rankings'); return; }
            if (k === 'all') {
                if (isAll) {
                    // 전체 → 행사만
                    window._scheduleTypeFilter = new Set(['event']);
                } else {
                    window._scheduleTypeFilter = new Set(['event','product','duty','normal','vacation','attendance']);
                }
            } else {
                // 토글
                if (f.has(k)) f.delete(k); else f.add(k);
                if (f.size === 0) f.add(k); // 빈 상태 방지
                // 휴가/근태는 normal과 함께 묶어서 처리
                if (k === 'normal') {
                    if (f.has('normal')) { f.add('vacation'); f.add('attendance'); }
                    else { f.delete('vacation'); f.delete('attendance'); }
                }
            }
            renderScheduleCalendar().catch(console.error);
        });
    });
}

async function renderScheduleCalendar() {
    const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    document.getElementById('schedule-calendar-title').textContent = `${scheduleYear}년 ${monthNames[scheduleMonth]}`;

    const monthStr = `${scheduleYear}-${String(scheduleMonth + 1).padStart(2, '0')}`;
    const schedules = await api(`/api/schedules?month=${monthStr}`);

    // 당직일수 계산 (본인의 당직 중 오늘 이전 날짜만 카운트)
    if (currentUser) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const dutyCount = schedules.filter(s =>
            s.type === 'duty' && s.userId === currentUser.id && s.date < todayStr
        ).length;
        document.getElementById('duty-count').textContent = dutyCount;
    }

    // 유형 필터 + 순위 버튼 (직원별 범례를 대체)
    renderScheduleTypeFilter();

    // 필터 상태에 따라 일정 필터링 (vacation/attendance는 항상 표시)
    const activeTypes = window._scheduleTypeFilter || new Set(['event','product','duty','normal','vacation','attendance']);
    const filteredSchedules = schedules.filter(s => activeTypes.has(s.type));
    // 3단계 일정 카테고리 아이콘·색상 (일반은 기존 담당자 색 유지)
    window.SCHED_CAT_ICON = window.SCHED_CAT_ICON || { '휴가': '🏖️ ', '톡톡발송': '💬 ', '문자발송': '📩 ', '할인·이벤트': '🏷️ ' };
    window.SCHED_CAT_COLOR = window.SCHED_CAT_COLOR || { '휴가': '#1098AD', '톡톡발송': '#2F9E44', '문자발송': '#E8590C', '할인·이벤트': '#D6336C' };
    const SCHED_CAT_ICON = window.SCHED_CAT_ICON, SCHED_CAT_COLOR = window.SCHED_CAT_COLOR;

    // 일별 일정 — 기간형 일정(endDate, 3단계 할인·이벤트)은 기간 내 매일 표시
    const dailySchedules = {};
    filteredSchedules.forEach(s => {
        const dates = [];
        if (s.endDate && s.endDate > s.date) {
            let d = new Date(s.date + 'T00:00:00Z');
            const end = new Date(s.endDate + 'T00:00:00Z');
            let guard = 0;
            while (d <= end && guard++ < 62) {
                dates.push(d.toISOString().slice(0, 10));
                d = new Date(d.getTime() + 86400000);
            }
        } else dates.push(s.date);
        dates.forEach(ds => {
            if (!dailySchedules[ds]) dailySchedules[ds] = [];
            dailySchedules[ds].push(s);
        });
    });

    // 정렬 우선순위: 행사 > 상품 > 당직 > 휴가 > 근태 > 일반
    const typeOrder = { event: 0, product: 1, duty: 2, vacation: 3, attendance: 4, normal: 5 };
    Object.keys(dailySchedules).forEach(d => {
        dailySchedules[d].sort((a, b) => {
            const oa = typeOrder[a.type] ?? 99;
            const ob = typeOrder[b.type] ?? 99;
            if (oa !== ob) return oa - ob;
            return (a.id || 0) - (b.id || 0); // 같은 유형은 기존 순서 유지
        });
    });

    const firstDay = new Date(scheduleYear, scheduleMonth, 1).getDay();
    const daysInMonth = new Date(scheduleYear, scheduleMonth + 1, 0).getDate();
    const today = new Date();

    let html = '';
    let day = 1;
    let started = false;

    for (let week = 0; week < 6; week++) {
        if (day > daysInMonth) break;
        html += '<tr>';
        for (let dow = 0; dow < 7; dow++) {
            if (!started && dow < firstDay) {
                html += '<td></td>';
            } else if (day > daysInMonth) {
                html += '<td></td>';
            } else {
                started = true;
                const dateStr = `${scheduleYear}-${String(scheduleMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isToday = (scheduleYear === today.getFullYear() && scheduleMonth === today.getMonth() && day === today.getDate());

                let classes = ['clickable-day'];
                if (dow === 0) classes.push('sun');
                if (dow === 6) classes.push('sat');
                if (isToday) classes.push('today');

                const daySchedules = dailySchedules[dateStr] || [];
                // 당직과 일반 일정 분리
                const dutySchedules = daySchedules.filter(s => s.type === 'duty');
                const normalSchedules = daySchedules.filter(s => s.type !== 'duty');

                let dutyHtml = '';
                if (dutySchedules.length > 0) {
                    dutyHtml = dutySchedules.map(s => {
                        const shortName = s.userName.length > 2 ? s.userName.slice(-2) : s.userName;
                        return `<span class="duty-badge" title="${s.userName} 당직"><span class="duty-label"><span class="duty-full">당직</span><span class="duty-short"></span>🌙</span><span class="duty-name">${shortName}</span></span>`;
                    }).join('');
                }

                let scheduleHtml = '';
                if (normalSchedules.length > 0) {
                    scheduleHtml = '<div class="day-schedules">';
                    normalSchedules.forEach(s => {
                        const typeIcon =
                            s.type === 'event' ? '🎉 ' :
                            s.type === 'product' ? '📦 ' :
                            s.type === 'vacation' ? '🏖️ ' :
                            s.type === 'attendance' ? '📌 ' : '';
                        // 3단계: 카테고리 아이콘·색상 구분 (일반은 기존 표시 유지)
                        const catIco = SCHED_CAT_ICON[s.category] || '';
                        const bcol = SCHED_CAT_COLOR[s.category] || s.userColor;
                        const typeClass = ` type-${s.type}`;
                        if (s.type === 'normal') {
                            const checked = s.isCompleted ? 'checked' : '';
                            const completedClass = s.isCompleted ? ' schedule-completed' : '';
                            scheduleHtml += `<div class="day-schedule-item${typeClass}${completedClass}" style="border-left:3px solid ${bcol};" title="${s.userName}: ${s.title}"><label class="schedule-check" onclick="event.stopPropagation();"><input type="checkbox" ${checked} onchange="toggleScheduleComplete(${s.id}, this)"><span class="schedule-checkmark"></span></label><span class="schedule-text">${catIco}${s.title}</span></div>`;
                        } else {
                            scheduleHtml += `<div class="day-schedule-item${typeClass}" style="border-left:3px solid ${bcol};" title="${s.userName}: ${s.title}">${catIco || typeIcon}${s.title}</div>`;
                        }
                    });
                    scheduleHtml += '</div>';
                }

                html += `<td class="${classes.join(' ')}" data-date="${dateStr}" onclick="openScheduleModal('${dateStr}')">
                    <div class="day-header"><span class="day-number">${isToday ? '오늘' : day}</span>${dutyHtml}</div>
                    ${scheduleHtml}
                </td>`;
                day++;
            }
        }
        html += '</tr>';
    }

    document.getElementById('schedule-calendar-body').innerHTML = html;
}

// 일정 추가 모달
window.openScheduleModal = function(dateStr) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3>${dateStr} 일정</h3>
            <div id="modal-schedule-list" style="margin-bottom:16px;"><p style="color:#999;">로딩 중...</p></div>
            <hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0;">
            <h4>새 일정 추가</h4>
            <div class="form-group">
                <label>일정 내용</label>
                <input type="text" id="modal-schedule-title" class="form-input" placeholder="일정을 입력하세요">
            </div>
            <div class="form-group">
                <label>유형</label>
                <div class="btn-group" id="modal-schedule-type-group">
                    <button class="btn-toggle active" data-value="normal">일반</button>
                    <button class="btn-toggle" data-value="duty" style="background:#fef2f2;border-color:#fca5a5;color:#dc2626;">당직</button>
                    <button class="btn-toggle" data-value="product" style="background:#ecfdf5;border-color:#86efac;color:#047857;">상품</button>
                    <button class="btn-toggle" data-value="event" style="background:#faf5ff;border-color:#d8b4fe;color:#7c3aed;">행사</button>
                </div>
            </div>
            <div style="display:flex;gap:12px;">
                <div class="form-group" style="flex:1;">
                    <label>시작일</label>
                    <input type="date" id="modal-schedule-start" class="form-input" value="${dateStr}">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>종료일</label>
                    <input type="date" id="modal-schedule-end" class="form-input" value="${dateStr}">
                </div>
            </div>
            <button class="btn-primary" id="modal-schedule-save" style="width:100%;">저장</button>
        </div>
    `;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    let selectedType = 'normal';
    overlay.querySelector('#modal-schedule-type-group').addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-toggle');
        if (!btn) return;
        overlay.querySelectorAll('#modal-schedule-type-group .btn-toggle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedType = btn.dataset.value;
    });

    loadDaySchedules(dateStr, overlay);

    overlay.querySelector('#modal-schedule-save').addEventListener('click', async () => {
        const title = overlay.querySelector('#modal-schedule-title').value.trim();
        if (!title) return alert('일정 내용을 입력해주세요.');
        const startDate = overlay.querySelector('#modal-schedule-start').value;
        const endDate = overlay.querySelector('#modal-schedule-end').value;
        if (!startDate || !endDate) return alert('시작일과 종료일을 입력해주세요.');
        if (endDate < startDate) return alert('종료일은 시작일 이후여야 합니다.');

        try {
            await api('/api/schedules', 'POST', { startDate, endDate, title, type: selectedType });
            overlay.remove();
            await renderScheduleCalendar();
        } catch (err) {
            alert('저장 실패: ' + err.message);
        }
    });
};

async function loadDaySchedules(dateStr, overlay) {
    try {
        const monthStr = dateStr.substring(0, 7);
        const schedules = await api(`/api/schedules?month=${monthStr}`);
        const daySchedules = schedules.filter(s => s.date === dateStr);

        const listEl = overlay.querySelector('#modal-schedule-list');
        if (daySchedules.length === 0) {
            listEl.innerHTML = '<p style="color:#999;">등록된 일정이 없습니다.</p>';
        } else {
            listEl.innerHTML = daySchedules.map(s => {
                const typeLabel = s.type === 'vacation' ? ' (휴가)' : s.type === 'attendance' ? ' (근태)' : s.type === 'duty' ? ' (당직)' : '';
                const canDelete = currentUser && (currentUser.id === s.userId || currentUser.role === 'admin') && !s.documentId;
                const nameStyle = s.type === 'duty' ? ' style="color:#000"' : '';
                const completedClass = (s.type === 'normal' && s.isCompleted) ? ' schedule-completed' : '';
                let checkboxHtml = '';
                if (s.type === 'normal') {
                    const checked = s.isCompleted ? 'checked' : '';
                    checkboxHtml = `<label class="schedule-check" style="margin-right:8px;"><input type="checkbox" ${checked} onchange="toggleScheduleComplete(${s.id}, this)"><span class="schedule-checkmark"></span></label>`;
                }
                return `<div class="schedule-detail-item${completedClass}" style="border-left:3px solid ${s.userColor};">
                    <div style="display:flex;align-items:center;">${checkboxHtml}<span${nameStyle}><strong>${s.userName}</strong>${typeLabel}: ${s.title}</span></div>
                    ${canDelete ? `<button class="btn-danger btn-sm" onclick="deleteSchedule(${s.id}, this)">삭제</button>` : ''}
                </div>`;
            }).join('');
        }
    } catch (err) {
        console.error('loadDaySchedules error:', err);
    }
}

window.deleteSchedule = async function(id, btn) {
    if (!confirm('일정을 삭제하시겠습니까?')) return;
    try {
        await api(`/api/schedules/${id}`, 'DELETE');
        const overlay = btn.closest('.modal-overlay');
        if (overlay) overlay.remove();
        await renderScheduleCalendar();
        const me = await api('/api/auth/me');
        currentUser = me;
        localStorage.setItem('jwt_user', JSON.stringify(me));
        document.getElementById('annual-leave-count').textContent = formatLeave(me.annualLeave);
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};

// 일정 완료 토글
window.toggleScheduleComplete = async function(id, checkbox) {
    try {
        const res = await api(`/api/schedules/${id}/toggle-complete`, 'PUT');
        const item = checkbox.closest('.day-schedule-item');
        if (res.isCompleted) {
            if (item) item.classList.add('schedule-completed');
            showToast('미션 성공! 🎉');
        } else {
            if (item) item.classList.remove('schedule-completed');
        }
    } catch (err) {
        checkbox.checked = !checkbox.checked;
        console.error('일정 상태 변경 실패:', err);
    }
};

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2000);
}

// =============================================
// 알림 시스템
// =============================================
let notiPollingTimer = null;
let lastUnreadCount = 0;

function timeAgo(dateStr) {
    const now = new Date();
    const d = new Date(dateStr);
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return '방금 전';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    if (diff < 172800) return '어제';
    if (diff < 2592000) return `${Math.floor(diff / 86400)}일 전`;
    return d.toLocaleDateString('ko-KR');
}

async function fetchUnreadCount() {
    try {
        const data = await api('/api/notifications/unread-count');
        const badges = [document.getElementById('bell-badge'), document.getElementById('mobile-bell-badge')];
        badges.forEach(badge => {
            if (!badge) return;
            if (data.count > 0) {
                badge.textContent = data.count > 99 ? '99+' : data.count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        });
        // 새 알림 감지 시 토스트
        if (data.count > lastUnreadCount && lastUnreadCount >= 0) {
            const notis = await api('/api/notifications');
            const newest = notis.find(n => !n.isRead);
            if (newest && lastUnreadCount > 0) {
                if (newest.type === 'announcement') {
                    showNotificationToast('📢 새 지시사항이 있습니다', true);
                } else {
                    showNotificationToast(newest.message);
                }
            }
        }
        lastUnreadCount = data.count;
    } catch (err) { /* ignore */ }
}

function showNotificationToast(msg, isAnnouncement) {
    const toast = document.createElement('div');
    toast.className = 'noti-toast' + (isAnnouncement ? ' noti-toast-announcement' : '');
    toast.textContent = isAnnouncement ? msg : ('🔔 ' + msg);
    toast.onclick = () => {
        toast.remove();
        toggleNotificationDropdown(new Event('click'));
    };
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function startNotiPolling() {
    if (notiPollingTimer) clearInterval(notiPollingTimer);
    lastUnreadCount = -1;
    fetchUnreadCount();
    notiPollingTimer = setInterval(fetchUnreadCount, 30000);
}

function stopNotiPolling() {
    if (notiPollingTimer) { clearInterval(notiPollingTimer); notiPollingTimer = null; }
}

window.toggleNotificationDropdown = async function(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('notification-dropdown');
    if (dropdown.style.display === 'none') {
        dropdown.style.display = 'flex';
        await renderNotificationList();
    } else {
        dropdown.style.display = 'none';
    }
};

// 외부 클릭 시 닫기
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('notification-dropdown');
    const bell = document.getElementById('notification-bell');
    const mobileBell = document.getElementById('mobile-noti-btn');
    if (dropdown && dropdown.style.display !== 'none') {
        const clickedBell = (bell && bell.contains(e.target)) || (mobileBell && mobileBell.contains(e.target));
        if (!clickedBell && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    }
});

async function renderNotificationList() {
    const listEl = document.getElementById('noti-list');
    try {
        const notis = await api('/api/notifications');
        // 알림 목록을 저장해두고 클릭 시 참조
        window._notiCache = notis;
        const unreadNotis = notis.filter(n => !n.isRead);
        if (unreadNotis.length === 0) {
            listEl.innerHTML = '<div class="noti-empty">새로운 알림이 없습니다.</div>';
            return;
        }
        listEl.innerHTML = unreadNotis.map(n => {
            const isAnnouncement = n.type === 'announcement';
            const icon = isAnnouncement ? '📢' : '';
            const extraClass = isAnnouncement ? ' noti-announcement' : '';
            const clickAction = isAnnouncement
                ? `showAnnouncementDetail(${n.id})`
                : `clickNotification(${n.id}, '${n.link || 'documents'}')`;
            return `<div class="noti-item unread${extraClass}" data-id="${n.id}">
                <span class="noti-dot unread">${icon}</span>
                <div class="noti-content" onclick="${clickAction}">
                    <div class="noti-msg">${n.message}</div>
                    <div class="noti-time">${timeAgo(n.createdAt)}</div>
                </div>
                <button class="noti-delete" onclick="deleteNotification(event, ${n.id})" title="삭제">×</button>
            </div>`;
        }).join('');
    } catch (err) {
        listEl.innerHTML = '<div class="noti-empty">알림을 불러올 수 없습니다.</div>';
    }
}

window.clickNotification = async function(id, link) {
    try {
        await api(`/api/notifications/${id}/read`, 'PUT');
        fetchUnreadCount();
    } catch (err) { /* ignore */ }
    document.getElementById('notification-dropdown').style.display = 'none';
    // 해당 페이지로 이동 (documents → document 보정)
    const page = link === 'documents' ? 'document' : link;
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.click();
};

window.showAnnouncementDetail = async function(id) {
    const noti = (window._notiCache || []).find(n => n.id === id);
    const message = noti ? noti.message : '';

    try {
        await api(`/api/notifications/${id}/read`, 'PUT');
        fetchUnreadCount();
        await renderNotificationList();
    } catch (err) { /* ignore */ }
    document.getElementById('notification-dropdown').style.display = 'none';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'padding:16px;background:#FFF8E1;border-radius:8px;border:1px solid #FFE082;line-height:1.7;white-space:pre-wrap;word-break:break-word;';
    msgDiv.textContent = message;

    overlay.innerHTML = `
        <div class="modal" style="max-width:480px;">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3 style="margin-bottom:16px;">📢 지시사항</h3>
            <div id="announcement-detail-body"></div>
            <div style="display:flex;justify-content:flex-end;margin-top:16px;">
                <button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">닫기</button>
            </div>
        </div>
    `;
    overlay.querySelector('#announcement-detail-body').appendChild(msgDiv);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

window.markAllNotificationsRead = async function(e) {
    e.stopPropagation();
    try {
        await api('/api/notifications/read-all', 'PUT');
        fetchUnreadCount();
        await renderNotificationList();
    } catch (err) { alert('실패: ' + err.message); }
};

window.deleteNotification = async function(e, id) {
    e.stopPropagation();
    try {
        await api(`/api/notifications/${id}`, 'DELETE');
        fetchUnreadCount();
        await renderNotificationList();
    } catch (err) { alert('삭제 실패: ' + err.message); }
};

// =============================================
// 📢 지시사항 전달 (관리자 전용)
// =============================================
window.openAnnouncementModal = async function() {
    let userListHtml = '';
    try {
        const users = await api('/api/users/names');
        const others = users.filter(u => u.id !== currentUser.id);
        userListHtml = others.map(u => `<label class="announcement-user-check"><input type="checkbox" value="${u.id}" checked> ${u.name}</label>`).join('');
    } catch (err) { console.error(err); }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'announcement-modal';
    overlay.innerHTML = `
        <div class="modal" style="max-width:480px;">
            <button class="modal-close" onclick="closeAnnouncementModal()">×</button>
            <h3 style="margin-bottom:16px;">📢 지시사항 전달하기</h3>
            <div class="form-group">
                <label>전달 내용</label>
                <textarea id="announcement-message" class="form-input" rows="5" placeholder="지시사항을 입력하세요..."></textarea>
            </div>
            <div class="form-group">
                <label>대상</label>
                <div class="btn-group" id="announcement-target-group">
                    <button class="btn-toggle active" data-value="all" onclick="selectAnnouncementTarget(this)">전체 직원</button>
                    <button class="btn-toggle" data-value="select" onclick="selectAnnouncementTarget(this)">직원 선택</button>
                </div>
            </div>
            <div class="form-group" id="announcement-user-list" style="display:none;">
                <div class="announcement-users-grid">${userListHtml}</div>
            </div>
            <div style="display:flex;gap:10px;margin-top:8px;">
                <button class="btn-primary" style="flex:1;" onclick="submitAnnouncement()">전달하기</button>
                <button class="btn-outline" onclick="closeAnnouncementModal()">취소</button>
            </div>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAnnouncementModal(); });
    document.body.appendChild(overlay);
};

window.selectAnnouncementTarget = function(btn) {
    btn.parentElement.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const userList = document.getElementById('announcement-user-list');
    userList.style.display = btn.dataset.value === 'select' ? '' : 'none';
};

window.closeAnnouncementModal = function() {
    const modal = document.getElementById('announcement-modal');
    if (modal) modal.remove();
};

window.submitAnnouncement = async function() {
    const message = document.getElementById('announcement-message').value.trim();
    if (!message) return alert('전달 내용을 입력해주세요.');

    const targetBtn = document.querySelector('#announcement-target-group .btn-toggle.active');
    const target = targetBtn ? targetBtn.dataset.value : 'all';

    let body = { message };
    if (target === 'all') {
        body.target = 'all';
    } else {
        const checked = document.querySelectorAll('#announcement-user-list input[type="checkbox"]:checked');
        const ids = Array.from(checked).map(c => Number(c.value));
        if (ids.length === 0) return alert('최소 한 명의 직원을 선택해주세요.');
        body.user_ids = ids;
    }

    if (!confirm(`지시사항을 전달하시겠습니까?`)) return;

    try {
        const result = await api('/api/notifications/announcement', 'POST', body);
        closeAnnouncementModal();
        showAnnouncementToast(`전달 완료! (${result.count}명)`);
    } catch (err) { alert('전달 실패: ' + err.message); }
};

function showAnnouncementToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'noti-toast';
    toast.textContent = '📢 ' + msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// =============================================
// 정산관리 캘린더 (기존 홈에서 이동)
// =============================================
let settlementCalYear = new Date().getFullYear();
let settlementCalMonth = new Date().getMonth();
let settlementDailyData = {};

document.getElementById('settlement-prev-month').addEventListener('click', () => {
    settlementCalMonth--;
    if (settlementCalMonth < 0) { settlementCalMonth = 11; settlementCalYear--; }
    renderSettlementCalendar().catch(console.error);
    renderWeeklySettlement().catch(console.error);
});

document.getElementById('settlement-next-month').addEventListener('click', () => {
    settlementCalMonth++;
    if (settlementCalMonth > 11) { settlementCalMonth = 0; settlementCalYear++; }
    renderSettlementCalendar().catch(console.error);
    renderWeeklySettlement().catch(console.error);
});

document.getElementById('settlement-refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('settlement-refresh-btn');
    btn.classList.add('spinning');
    try {
        await Promise.all([renderSettlementCalendar(), renderWeeklySettlement()]);
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        document.getElementById('settlement-refresh-time').textContent = `${h}:${m} 업데이트됨`;
    } catch (err) {
        console.error('새로고침 오류:', err);
    }
    btn.classList.remove('spinning');
});

async function renderSettlementCalendar() {
    const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    document.getElementById('settlement-calendar-title').textContent = `${settlementCalYear}년 ${monthNames[settlementCalMonth]}`;

    const monthNum = settlementCalMonth + 1;
    document.getElementById('expected-payment-label').textContent = '총 결제예정금액';
    document.getElementById('daesung-payment-label').textContent = '대성(시온)';
    document.getElementById('hyodon-payment-label').textContent = '효돈농협';
    document.getElementById('aewol-payment-label').textContent = '기타거래처';
    document.getElementById('cj-payment-label').textContent = 'CJ택배';

    const monthStr = `${settlementCalYear}-${String(monthNum).padStart(2, '0')}`;
    const [settlements, prepayments, cjCarryoverData, cjDailyPayments] = await Promise.all([
        api(`/api/settlements?month=${monthStr}`),
        api('/api/prepayments'),
        api(`/api/cj-carryover?month=${monthStr}`).catch(() => ({ amount: 0, note: '' })),
        api(`/api/cj-daily-payments?month=${monthStr}`).catch(() => [])
    ]);
    // CJ 일별 결제완료 맵
    const cjPaidMap = {};
    cjDailyPayments.forEach(c => { cjPaidMap[c.date] = c.isPaid || false; });
    const cjCarryover = cjCarryoverData.amount || 0;
    const cjCarryoverStart = cjCarryoverData.start_date || '';
    const cjCarryoverEnd = cjCarryoverData.end_date || '';

    let daesungPayment = 0, hyodonPayment = 0, aewolPayment = 0, cjPayment = 0;
    const dailyPayments = {};

    settlements.forEach(s => {
        const amount = s.amount || 0;
        const isPaid = s.isPaid || false;

        if (!dailyPayments[s.date]) dailyPayments[s.date] = {
            daesung: 0, hyodon: 0, aewol: 0, cj: 0,
            daesungPaid: 0, hyodonPaid: 0, aewolPaid: 0, cjPaid: 0,
            entries: []
        };

        dailyPayments[s.date].entries.push({ id: s.id, partner: s.partner, amount, isPaid, items: s.items });

        if (s.partner === '대성(시온)') {
            dailyPayments[s.date].daesung += amount;
            if (isPaid) dailyPayments[s.date].daesungPaid += amount;
            else daesungPayment += amount;
        }
        if (s.partner === '효돈농협') {
            dailyPayments[s.date].hyodon += amount;
            if (isPaid) dailyPayments[s.date].hyodonPaid += amount;
            else hyodonPayment += amount;
        }
        if (s.partner === '기타거래처') {
            dailyPayments[s.date].aewol += amount;
            if (isPaid) dailyPayments[s.date].aewolPaid += amount;
            else aewolPayment += amount;
        }

        // CJ택배비 자동 계산: 대성/효돈/애월 정산의 items 수량 합계 × 3,100원
        // CJ 결제완료는 대성/효돈/애월과 독립적으로 cjPaidMap에서 관리
        if (s.partner === '대성(시온)' || s.partner === '효돈농협' || s.partner === '기타거래처') {
            const items = s.items || [];
            const boxCount = items.reduce((sum, item) => sum + (item.qty || 0), 0);
            const cjCost = boxCount * 3100;
            dailyPayments[s.date].cj += cjCost;
        }
    });

    // CJ 결제완료 상태 독립 적용
    Object.keys(dailyPayments).forEach(date => {
        const dp = dailyPayments[date];
        const cjIsPaid = cjPaidMap[date] || false;
        if (cjIsPaid) {
            dp.cjPaid = dp.cj;
        }
        if (!cjIsPaid) {
            cjPayment += dp.cj;
        }
    });

    settlementDailyData = dailyPayments;

    // 월별 총 결제금액 배지 (해당 월 전체 금액 합산: 결제완료+미결제 모두)
    let monthlyTotal = 0;
    settlements.forEach(s => { monthlyTotal += (s.amount || 0); });
    // CJ택배비도 합산
    Object.keys(dailyPayments).forEach(date => { monthlyTotal += dailyPayments[date].cj; });
    // CJ 이월금액 합산
    monthlyTotal += cjCarryover;
    document.getElementById('monthly-total-badge').textContent = `${monthNum}월 총 결제금액: ${monthlyTotal.toLocaleString()}원`;

    // CJ 카드: 이월금액 반영
    const cjTotal = cjCarryover + cjPayment;
    document.getElementById('cj-payment').textContent = `${cjTotal.toLocaleString()} 원`;
    const cjCarryoverDetail = document.getElementById('cj-carryover-detail');
    const cjMonthlyLine = document.getElementById('cj-monthly-line');
    if (cjCarryover > 0) {
        cjCarryoverDetail.style.display = '';
        cjMonthlyLine.style.display = '';
        // 기간 표시 (M/D~M/D 형식)
        let periodStr = '';
        if (cjCarryoverStart && cjCarryoverEnd) {
            const s = new Date(cjCarryoverStart + 'T00:00:00');
            const e = new Date(cjCarryoverEnd + 'T00:00:00');
            periodStr = ` (${s.getMonth()+1}/${s.getDate()}~${e.getMonth()+1}/${e.getDate()})`;
        }
        document.getElementById('cj-carryover-line').textContent = `이월 ${cjCarryover.toLocaleString()}원${periodStr}`;
        cjMonthlyLine.textContent = `당월 ${cjPayment.toLocaleString()}원`;
    } else {
        cjCarryoverDetail.style.display = '';
        cjMonthlyLine.style.display = 'none';
        document.getElementById('cj-carryover-line').textContent = '이월 없음';
    }

    // 전체 미정산 합계 API 호출 (모든 월 합산)
    try {
        const totalUnpaid = await api('/api/settlements/total-unpaid');
        document.getElementById('daesung-payment').textContent = `${(totalUnpaid.daesung || 0).toLocaleString()} 원`;
        document.getElementById('hyodon-payment').textContent = `${(totalUnpaid.hyodon || 0).toLocaleString()} 원`;
        document.getElementById('aewol-payment').textContent = `${(totalUnpaid.aewol || 0).toLocaleString()} 원`;
        document.getElementById('cj-payment').textContent = `${(totalUnpaid.cj || 0).toLocaleString()} 원`;
        document.getElementById('expected-payment').textContent = `${(totalUnpaid.total || 0).toLocaleString()} 원`;

        // 선결제 라인 숨김 (총합에 이미 반영됨)
        document.getElementById('daesung-prepay-line').style.display = 'none';
        document.getElementById('hyodon-prepay-line').style.display = 'none';
        document.getElementById('aewol-prepay-line').style.display = 'none';
    } catch (err) {
        console.error('전체 미정산 합계 로드 오류:', err);
        // 폴백: 현재 월 데이터만 표시
        document.getElementById('daesung-payment').textContent = `${daesungPayment.toLocaleString()} 원`;
        document.getElementById('hyodon-payment').textContent = `${hyodonPayment.toLocaleString()} 원`;
        document.getElementById('aewol-payment').textContent = `${aewolPayment.toLocaleString()} 원`;
        document.getElementById('expected-payment').textContent = `${(daesungPayment + hyodonPayment + aewolPayment + cjTotal).toLocaleString()} 원`;
    }

    // 달력용 선결제 내역 (해당 월)
    const dailyPrepayments = {};
    prepayments.forEach(p => {
        if (p.date && p.date.startsWith(monthStr)) {
            if (!dailyPrepayments[p.date]) dailyPrepayments[p.date] = [];
            const shortName = p.partner === '대성(시온)' ? '대성' : (p.partner === '효돈농협' ? '효돈' : (p.partner === '기타거래처' ? '기타' : p.partner));
            dailyPrepayments[p.date].push({ name: shortName, amount: p.amount });
        }
    });

    const firstDay = new Date(settlementCalYear, settlementCalMonth, 1).getDay();
    const daysInMonth = new Date(settlementCalYear, settlementCalMonth + 1, 0).getDate();
    const today = new Date();

    let html = '';
    let day = 1;
    let started = false;

    for (let week = 0; week < 6; week++) {
        if (day > daysInMonth) break;
        html += '<tr>';
        for (let dow = 0; dow < 7; dow++) {
            if (!started && dow < firstDay) {
                html += '<td></td>';
            } else if (day > daysInMonth) {
                html += '<td></td>';
            } else {
                started = true;
                const dateStr = `${settlementCalYear}-${String(settlementCalMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isToday = (settlementCalYear === today.getFullYear() && settlementCalMonth === today.getMonth() && day === today.getDate());

                let classes = [];
                if (dow === 0) classes.push('sun');
                if (dow === 6) classes.push('sat');
                if (isToday) classes.push('today');

                let contentHtml = '';

                // 선결제 표시
                const pp = dailyPrepayments[dateStr];
                if (pp) {
                    pp.forEach(item => {
                        contentHtml += `<div class="day-prepay-item">${item.name} 지급결제 ${item.amount.toLocaleString()}원</div>`;
                    });
                }

                // 정산금액 표시
                const dp = dailyPayments[dateStr];
                if (dp) {
                    contentHtml += '<div class="day-payments">';
                    if (dp.daesung) {
                        const allPaid = dp.daesungPaid === dp.daesung;
                        const cls = allPaid ? 'day-payment-item daesung paid' : 'day-payment-item daesung';
                        contentHtml += `<div class="${cls}"><span class="pay-label">대성</span><span class="pay-amount">${dp.daesung.toLocaleString()}원</span></div>`;
                    }
                    if (dp.hyodon) {
                        const allPaid = dp.hyodonPaid === dp.hyodon;
                        const cls = allPaid ? 'day-payment-item hyodon paid' : 'day-payment-item hyodon';
                        contentHtml += `<div class="${cls}"><span class="pay-label">효돈</span><span class="pay-amount">${dp.hyodon.toLocaleString()}원</span></div>`;
                    }
                    if (dp.aewol) {
                        const allPaid = dp.aewolPaid === dp.aewol;
                        const cls = allPaid ? 'day-payment-item aewol paid' : 'day-payment-item aewol';
                        contentHtml += `<div class="${cls}"><span class="pay-label">기타</span><span class="pay-amount">${dp.aewol.toLocaleString()}원</span></div>`;
                    }
                    if (dp.cj) {
                        const allPaid = dp.cjPaid === dp.cj;
                        const cls = allPaid ? 'day-payment-item cj paid' : 'day-payment-item cj';
                        contentHtml += `<div class="${cls}"><span class="pay-label">CJ</span><span class="pay-amount">${dp.cj.toLocaleString()}원</span></div>`;
                    }
                    const dayTotal = (dp.daesung || 0) + (dp.hyodon || 0) + (dp.aewol || 0) + (dp.cj || 0);
                    const dayTotalPaid = (dp.daesungPaid || 0) + (dp.hyodonPaid || 0) + (dp.aewolPaid || 0) + (dp.cjPaid || 0);
                    if (dayTotal > 0) {
                        const allPaid = dayTotalPaid === dayTotal;
                        const cls = allPaid ? 'day-total paid' : 'day-total';
                        contentHtml += `<div class="${cls}"><span class="pay-label">합계</span><span class="pay-amount">${dayTotal.toLocaleString()}원</span></div>`;
                    }
                    contentHtml += '</div>';
                }

                html += `<td class="${classes.join(' ')}" onclick="showSettlementDayModal('${dateStr}')" style="cursor:pointer;">
                    <span class="day-number">${isToday ? '오늘' : day}</span>
                    ${contentHtml}
                </td>`;
                day++;
            }
        }
        html += '</tr>';
    }

    document.getElementById('settlement-calendar-body').innerHTML = html;
}

window.showSettlementDayModal = function(dateStr) {
    const dp = settlementDailyData[dateStr];
    if (!dp || !dp.entries || dp.entries.length === 0) return;

    let entriesHtml = '';
    let total = 0;

    // 대성, 효돈 entries — 거래처명 클릭 시 품목 상세 모달
    ['대성(시온)', '효돈농협', '기타거래처'].forEach(partner => {
        const entries = dp.entries.filter(e => e.partner === partner);
        if (!entries.length) return;
        entries.forEach(e => {
            total += e.amount;
            const paidClass = e.isPaid ? 'settlement-day-entry paid' : 'settlement-day-entry';
            const btnText = e.isPaid ? '✅ 완료' : '☐ 결제완료';
            const btnClass = e.isPaid ? 'btn-paid active' : 'btn-paid';
            entriesHtml += `<div class="${paidClass}">
                <span class="entry-partner" onclick="showSettlementItemsModal(${e.id})" title="클릭: 상품/수량 상세 (수량 수정 가능)" style="cursor:pointer;color:#0066CC;text-decoration:underline;">${partner}</span>
                <span class="entry-amount">${e.amount.toLocaleString()}원</span>
                <button class="${btnClass}" onclick="toggleSettlementPaid(${e.id})">${btnText}</button>
            </div>`;
        });
    });

    // CJ 택배비 (독립 결제완료 토글)
    if (dp.cj > 0) {
        total += dp.cj;
        const cjIsPaid = dp.cjPaid === dp.cj && dp.cj > 0;
        const paidClass = cjIsPaid ? 'settlement-day-entry paid' : 'settlement-day-entry';
        const btnText = cjIsPaid ? '✅ 완료' : '☐ 결제완료';
        const btnClass = cjIsPaid ? 'btn-paid active' : 'btn-paid';
        entriesHtml += `<div class="${paidClass}">
            <span class="entry-partner">CJ택배</span>
            <span class="entry-amount">${dp.cj.toLocaleString()}원</span>
            <button class="${btnClass}" onclick="toggleCjDailyPaid('${dateStr}', ${dp.cj})">${btnText}</button>
        </div>`;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'settlement-day-modal';
    overlay.innerHTML = `
        <div class="modal" style="max-width:480px;">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3 style="margin-bottom:16px;">${dateStr} 정산 내역</h3>
            <div class="settlement-day-entries">${entriesHtml}</div>
            <div class="settlement-day-total">
                <span>합계</span>
                <span>${total.toLocaleString()}원</span>
            </div>
            <div style="text-align:right; margin-top:16px;">
                <button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">닫기</button>
            </div>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

window.toggleSettlementPaid = async function(id) {
    try {
        await api(`/api/settlements/${id}/toggle-paid`, 'PUT');
        const modal = document.getElementById('settlement-day-modal');
        if (modal) modal.remove();
        await renderSettlementCalendar();
        await renderSettlementList();
        await renderWeeklySettlement();
    } catch (err) {
        alert('결제완료 처리 실패: ' + err.message);
    }
};

window.toggleCjDailyPaid = async function(date, amount) {
    try {
        await api('/api/cj-daily-payments/toggle-paid', 'POST', { date, amount });
        const modal = document.getElementById('settlement-day-modal');
        if (modal) modal.remove();
        await renderSettlementCalendar();
        await renderWeeklySettlement();
    } catch (err) {
        alert('CJ 결제완료 처리 실패: ' + err.message);
    }
};

// 일자 모달에서 거래처명 클릭 시 → 해당 settlement의 품목 상세 + 수량 수정
window.showSettlementItemsModal = function(settlementId) {
    let entry = null;
    Object.values(settlementDailyData).forEach(dp => {
        const found = (dp.entries || []).find(e => e.id === settlementId);
        if (found) entry = found;
    });
    if (!entry) { alert('정산 데이터를 찾을 수 없습니다'); return; }

    const items = (entry.items || []).map(it => ({
        name: it.name || '',
        qty: Number(it.qty) || 0,
        price: Number(it.price) || 0
    }));
    if (items.length === 0) { alert('등록된 품목이 없습니다'); return; }

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    const initialTotal = items.reduce((s, it) => s + it.qty * it.price, 0);
    const rowsHtml = items.map((it, idx) => `
        <tr>
            <td>${escapeHtml(it.name)}</td>
            <td style="text-align:center;">
                <input type="number" class="si-qty-input" data-idx="${idx}" value="${it.qty}" min="0"
                    style="width:80px;text-align:center;padding:5px 6px;border:1px solid #d1d5db;border-radius:4px;">
            </td>
            <td style="text-align:right;">${it.price.toLocaleString()}원</td>
            <td class="si-subtotal" data-idx="${idx}" style="text-align:right;font-weight:600;">${(it.qty * it.price).toLocaleString()}원</td>
        </tr>
    `).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal" style="max-width:680px;">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3 style="margin-bottom:6px;">${entry.partner} — 정산 품목</h3>
            <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">💡 수량 입력 시 합계가 자동 갱신됩니다. 저장하면 달력 금액이 반영돼요.</div>
            <table class="data-table" style="width:100%;font-size:13px;">
                <thead>
                    <tr>
                        <th>상품명</th>
                        <th style="width:90px;">수량</th>
                        <th style="width:110px;">단가</th>
                        <th style="width:140px;">합계</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr style="background:#FFF8E1;font-weight:700;">
                        <td style="text-align:right;">총 합계</td>
                        <td id="si-qty-total" style="text-align:center;color:#0066CC;"></td>
                        <td></td>
                        <td id="si-total" style="text-align:right;color:#0066CC;">${initialTotal.toLocaleString()}원</td>
                    </tr>
                </tfoot>
            </table>
            <div style="text-align:right;margin-top:16px;">
                <button class="btn-outline" onclick="this.closest('.modal-overlay').remove()" style="margin-right:8px;">취소</button>
                <button class="btn-primary" id="si-save">💾 저장</button>
            </div>
        </div>
    `;

    const recalc = () => {
        let total = 0, qtyTotal = 0;
        overlay.querySelectorAll('.si-qty-input').forEach(inp => {
            const idx = Number(inp.dataset.idx);
            const qty = Number(inp.value) || 0;
            const price = items[idx].price;
            const sub = qty * price;
            overlay.querySelector(`.si-subtotal[data-idx="${idx}"]`).textContent = sub.toLocaleString() + '원';
            total += sub;
            qtyTotal += qty;
        });
        overlay.querySelector('#si-total').textContent = total.toLocaleString() + '원';
        const qtyCell = overlay.querySelector('#si-qty-total'); // 대표 7/20: 박스 수량 총합계 표시
        if (qtyCell) qtyCell.textContent = qtyTotal + '박스';
        return total;
    };
    overlay.querySelectorAll('.si-qty-input').forEach(inp => inp.addEventListener('input', recalc));
    recalc(); // 초기 박스 수량 총합계 표시 (대표 7/20)

    overlay.querySelector('#si-save').addEventListener('click', async () => {
        const btn = overlay.querySelector('#si-save');
        btn.disabled = true;
        btn.textContent = '저장 중...';
        try {
            const updatedItems = items.map((it, idx) => {
                const qty = Number(overlay.querySelector(`.si-qty-input[data-idx="${idx}"]`).value) || 0;
                return { name: it.name, qty, price: it.price, subtotal: qty * it.price };
            });
            const amount = updatedItems.reduce((s, it) => s + it.subtotal, 0);
            await api(`/api/settlements/${settlementId}/items`, 'PUT', { items: updatedItems, amount });
            overlay.remove();
            // 일자 모달 닫고 달력/목록/주간 새로고침
            const parent = document.getElementById('settlement-day-modal');
            if (parent) parent.remove();
            await renderSettlementCalendar();
            await renderSettlementList();
            await renderWeeklySettlement();
        } catch (err) {
            alert('저장 실패: ' + err.message);
            btn.disabled = false;
            btn.textContent = '💾 저장';
        }
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

// =============================================
// 정산관리 (기존 기능 유지)
// =============================================
let selectedSettlementPartner = null;

// 오늘 날짜를 로컬 기준으로 설정 (UTC 차이 방지)
document.getElementById('settlement-date').value = new Date().toLocaleDateString('en-CA');

const now = new Date();
document.getElementById('settlement-month-filter').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

document.getElementById('settlement-partner-group').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-toggle');
    if (!btn) return;
    document.querySelectorAll('#settlement-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSettlementPartner = btn.dataset.value;
    toggleCjMode(selectedSettlementPartner === 'CJ대한통운');
});

function toggleCjMode(isCj) {
    document.getElementById('cj-input-section').style.display = isCj ? '' : 'none';
    document.getElementById('sales-upload-section').style.display = isCj ? 'none' : '';
    document.getElementById('settlement-amount-section').style.display = isCj ? 'none' : '';
    if (isCj) {
        document.getElementById('cj-parcel-qty').value = '';
        document.getElementById('cj-calc-amount').textContent = '0 원';
        document.getElementById('settlement-amount').value = '';
        document.getElementById('settlement-rows').innerHTML = '';
        resetSettlementPaste();
    }
}

document.getElementById('cj-parcel-qty').addEventListener('input', () => {
    const qty = Number(document.getElementById('cj-parcel-qty').value) || 0;
    const amount = qty * 3100;
    document.getElementById('cj-calc-amount').textContent = amount.toLocaleString() + ' 원';
    document.getElementById('settlement-amount').value = amount;
});

// CJ 자동 계산 버튼
document.getElementById('cj-auto-calc-btn').addEventListener('click', async () => {
    const date = document.getElementById('settlement-date').value;
    if (!date) return alert('먼저 날짜를 선택해주세요.');

    try {
        const data = await api(`/api/settlements/box-count?date=${date}`);
        document.getElementById('cj-parcel-qty').value = data.totalBoxes;

        // 상세 표시
        const detailEl = document.getElementById('cj-auto-detail');
        if (data.totalBoxes > 0) {
            detailEl.innerHTML = `대성(시온) <strong>${data.daesung}건</strong> + 효돈농협 <strong>${data.hyodon}건</strong> + 기타거래처 <strong>${data.aewol}건</strong> = 총 <strong>${data.totalBoxes}건</strong>`;
            detailEl.style.display = '';
        } else {
            detailEl.innerHTML = '해당 날짜에 대성/효돈 정산 데이터가 없습니다.';
            detailEl.style.display = '';
        }

        // 금액 자동 계산 트리거
        const amount = data.totalBoxes * 3100;
        document.getElementById('cj-calc-amount').textContent = amount.toLocaleString() + ' 원';
        document.getElementById('settlement-amount').value = amount;
    } catch (err) {
        alert('자동 계산 실패: ' + err.message);
    }
});

document.getElementById('settlement-reset-btn').addEventListener('click', () => {
    document.getElementById('settlement-date').value = '';
    document.querySelectorAll('#settlement-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    selectedSettlementPartner = '';
    document.getElementById('settlement-amount').value = '';
    document.getElementById('settlement-rows').innerHTML = '';
    resetSettlementPaste();
    document.getElementById('sales-unmatched-container').style.display = 'none';
    document.getElementById('sales-upload-area').style.display = '';
    document.getElementById('cj-auto-detail').style.display = 'none';
    toggleCjMode(false);
});

// ---- 판매현황 엑셀 업로드 ----
const salesUploadArea = document.getElementById('sales-upload-area');
const salesExcelFile = document.getElementById('sales-excel-file');

salesUploadArea.addEventListener('click', () => salesExcelFile.click());
salesExcelFile.addEventListener('change', () => {
    if (salesExcelFile.files.length > 0) { handleSalesExcel(salesExcelFile.files[0]); salesExcelFile.value = ''; }
});
salesUploadArea.addEventListener('dragover', (e) => { e.preventDefault(); salesUploadArea.classList.add('dragover'); });
salesUploadArea.addEventListener('dragleave', () => { salesUploadArea.classList.remove('dragover'); });
salesUploadArea.addEventListener('drop', (e) => {
    e.preventDefault(); salesUploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.match(/\.(xls|xlsx)$/i)) handleSalesExcel(file);
    }
});

function handleSalesExcel(file) {
    if (!selectedSettlementPartner) { alert('먼저 거래처를 선택해주세요.'); return; }
    const settlementDate = document.getElementById('settlement-date').value;
    if (!settlementDate) { alert('먼저 날짜를 선택해주세요.'); return; }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            if (jsonData.length === 0) return alert('엑셀에 데이터가 없습니다.');

            // 헤더 행 탐색: 첫 번째 행부터 검사하여 품목명+수량 헤더가 있는 행을 찾음
            let headerRowIdx = 0;
            let nameCol = -1, qtyCol = -1;
            for (let r = 0; r < Math.min(jsonData.length, 10); r++) {
                const row = jsonData[r];
                if (!row) continue;
                const testHeader = row.map(h => String(h || '').trim().toLowerCase());
                let nc = -1, qc = -1;
                testHeader.forEach((h, i) => {
                    if (h.includes('옵션명') || h.includes('품목명') || h.includes('상품명') || h.includes('품목') || h.includes('옵션')) nc = i;
                    if (h.includes('수량') || h.includes('판매수량') || h.includes('주문수량') || h.includes('qty')) qc = i;
                });
                if (nc !== -1 && qc !== -1) { headerRowIdx = r; nameCol = nc; qtyCol = qc; break; }
            }
            // 헤더를 못 찾으면 첫 번째 행을 헤더로 간주
            if (nameCol === -1) {
                const header = jsonData[0].map(h => String(h || '').trim());
                header.forEach((h, i) => {
                    const lower = h.toLowerCase();
                    if (lower.includes('옵션명') || lower.includes('품목명') || lower.includes('상품명') || lower.includes('품목') || lower.includes('옵션')) nameCol = i;
                    if (lower.includes('수량') || lower.includes('판매수량') || lower.includes('주문수량') || lower.includes('qty')) qtyCol = i;
                });
            }
            if (nameCol === -1) nameCol = 0;
            if (qtyCol === -1) qtyCol = jsonData[0].length >= 2 ? jsonData[0].length - 1 : 1;
            console.log('[정산 엑셀] 헤더 행:', headerRowIdx, '품목 열:', nameCol, '수량 열:', qtyCol);

            const salesItems = [];
            for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;
                const name = String(row[nameCol] || '').trim();
                const qty = parseInt(String(row[qtyCol] || '0').replace(/[,\s]/g, ''), 10) || 0;
                // 헤더 행이 중간에 반복되면 건너뛰기 (데이터 중복 방지)
                const nameLower = name.toLowerCase();
                if (nameLower.includes('옵션명') || nameLower.includes('품목명') || nameLower.includes('상품명') || nameLower === '품목' || nameLower === '옵션' || nameLower === '상품명') continue;
                if (name && qty > 0) { salesItems.push({ name, qty }); console.log(`[정산 엑셀] 행${i}: "${name}" → ${qty}개`); }
            }

            if (salesItems.length === 0) { alert('엑셀에서 품목/수량 데이터를 찾을 수 없습니다.'); return; }
            console.log('[정산 엑셀] 파싱된 품목 수:', salesItems.length, '총 수량:', salesItems.reduce((s, i) => s + i.qty, 0));

            const pricingItems = await getPricingForDate(selectedSettlementPartner, settlementDate);
            if (pricingItems.length === 0) {
                alert('해당 날짜(' + settlementDate + ') / 거래처(' + selectedSettlementPartner + ')의 품목별 금액이 등록되지 않았습니다.\n먼저 품목별 금액에서 단가를 등록해주세요.');
                return;
            }

            // DB 매핑 조회
            let mappings = [];
            try { mappings = await api(`/api/product-mappings?partner=${selectedSettlementPartner}`); } catch(e) {}
            const mappingMap = {};
            mappings.forEach(m => { mappingMap[m.sales_name] = m.pricing_name; });

            // 현재 pricing items를 전역에 저장 (매칭 기억하기에서 사용)
            window._currentPricingItems = pricingItems;

            const matched = [], unmatched = [];
            for (const item of salesItems) {
                // 1차: DB 매핑 확인
                if (mappingMap[item.name]) {
                    const p = pricingItems.find(pi => pi.name === mappingMap[item.name]);
                    if (p) { matched.push({ pricingName: p.name, price: p.price, qty: item.qty, originalName: item.name }); continue; }
                }
                // 2차: 키워드 매칭
                const result = matchSalesToPricing(item.name, pricingItems);
                if (result) { matched.push({ pricingName: result.name, price: result.price, qty: item.qty, originalName: item.name }); continue; }
                // 미매칭
                unmatched.push(item);
            }

            const grouped = {};
            for (const item of matched) {
                const key = item.pricingName;
                if (!grouped[key]) grouped[key] = { name: item.pricingName, price: item.price, qty: 0 };
                grouped[key].qty += item.qty;
            }
            const groupedList = Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
            console.log('[정산 엑셀] 매칭 성공:', matched.length, '실패:', unmatched.length);
            console.log('[정산 엑셀] 그룹핑 결과:', groupedList.map(g => `${g.name} (${g.qty})`).join(', '));

            document.getElementById('settlement-rows').innerHTML = '';
            for (const item of groupedList) addSettlementRow(item.name, item.price, item.qty);
            for (const item of unmatched) addSettlementRow(item.name, 0, item.qty);

            if (groupedList.length > 0 || unmatched.length > 0) { showSettlementRows(); updateSettlementTotal(); }

            const unmatchedContainer = document.getElementById('sales-unmatched-container');
            if (unmatched.length > 0) {
                const optionsHtml = pricingItems.map(p =>
                    '<option value="' + p.name.replace(/"/g, '&quot;') + '">' + p.name + ' (' + p.price.toLocaleString() + '원)</option>'
                ).join('');
                document.getElementById('sales-unmatched-list').innerHTML = unmatched.map(item =>
                    '<div class="ocr-unmatched-item">' +
                    '<span class="unmatched-name" title="' + item.name.replace(/"/g, '&quot;') + '">' + item.name + '</span>' +
                    '<span class="unmatched-qty">' + item.qty + '개</span>' +
                    '<select class="unmatched-select" data-sales-name="' + item.name.replace(/"/g, '&quot;') + '" data-qty="' + item.qty + '">' +
                    '<option value="">-- 품목 선택 --</option>' + optionsHtml + '</select></div>'
                ).join('');
                unmatchedContainer.style.display = 'block';
            } else { unmatchedContainer.style.display = 'none'; }

            let msg = '=== 매칭 결과 ===\n매칭 성공: ' + matched.length + '개 품목 / 실패: ' + unmatched.length + '개\n';
            if (groupedList.length > 0) { msg += '\n[매칭 성공 (그룹핑)]\n'; groupedList.forEach(g => { msg += '  ' + g.name + ' (' + g.price.toLocaleString() + '원 x ' + g.qty + ')\n'; }); }
            if (unmatched.length > 0) { msg += '\n[매칭 실패 - 드롭다운에서 수동 선택 가능]\n'; unmatched.forEach(u => { msg += '  ' + u.name + '\n'; }); }
            alert(msg);
        } catch (err) {
            alert('엑셀 파일을 읽는데 실패했습니다: ' + err.message);
            console.error('Sales Excel Error:', err);
        }
    };
    reader.readAsArrayBuffer(file);
}

// 품목명에서 과일명/용도/중량 3가지 특징 추출
function extractFeatures(text) {
    const t = (text || '');

    // 재배방식/접두사 추출 (노지, 하우스, 비가림, 블러드 등)
    let growType = '';
    if (/노지/.test(t)) growType = '노지';
    else if (/하우스/.test(t)) growType = '하우스';
    else if (/비가림/.test(t)) growType = '비가림';
    else if (/블러드/.test(t)) growType = '블러드';

    // 과일명 추출 (3종세트 우선, 접두사 포함 품목은 접두사+과일명)
    let fruit = null;
    if (/3종세트/.test(t)) fruit = '3종세트';
    else if (/2종세트/.test(t)) fruit = '2종세트';
    else if (/블러드오렌지|블러드/.test(t)) fruit = '블러드오렌지';
    else if (/비가림|감귤/.test(t)) fruit = '비가림귤';
    else if (/수라향/.test(t)) fruit = '수라향';
    else if (/자몽/.test(t)) fruit = '자몽';
    else if (/천혜향/.test(t)) fruit = '천혜향';
    else if (/레드향/.test(t)) fruit = '레드향';
    else if (/한라봉/.test(t)) fruit = '한라봉';
    else if (/레몬/.test(t)) fruit = '레몬';
    else if (/카라향/.test(t)) fruit = '카라향';
    else if (/하귤/.test(t)) fruit = '하귤';

    // 용도/등급 추출
    let grade = null;
    if (/프리미엄\s*로얄/.test(t)) grade = '선물용';
    else if (/로얄과/.test(t)) grade = '로얄과';
    else if (/소과/.test(t)) grade = '소과';
    else if (/중대과/.test(t)) grade = '중대과';
    else if (/못난이/.test(t)) grade = '못난이';
    else if (/선물용/.test(t)) grade = '선물용';
    else if (/프리미엄/.test(t)) grade = '선물용';
    else if (/가정용/.test(t)) grade = '가정용';

    // 꼬마 여부 추출
    let size = '';
    if (/꼬마/.test(t)) size = '꼬마';

    // 중량 추출 (소수점 포함: 2.5kg, 4.5kg 등)
    let weight = null;
    const wMatch = t.match(/(\d+(?:\.\d+)?)\s*kg/i);
    if (wMatch) weight = wMatch[1] + 'kg';

    return { fruit, grade, weight, growType, size };
}

function matchSalesToPricing(salesName, pricingItems) {
    // 1차: 정확한 이름 매칭
    for (const p of pricingItems) { if (p.name === salesName) return p; }

    // 2차: 특징 기반 매칭 (과일명 + 재배방식 + 용도 + 중량)
    const sf = extractFeatures(salesName);
    if (!sf.fruit) return null;

    let bestMatch = null, bestScore = 0;
    for (const p of pricingItems) {
        const pf = extractFeatures(p.name);
        if (!pf.fruit || sf.fruit !== pf.fruit) continue;

        let score = 1; // 과일명 일치
        let mismatch = false;

        // 꼬마 여부(size): 불일치 시 절대 매칭 안됨
        if (sf.size !== pf.size) mismatch = true;
        if (sf.size && pf.size && sf.size === pf.size) score += 3;

        // 재배방식(growType): 불일치 시 절대 매칭 안됨
        if (sf.growType || pf.growType) {
            if (sf.growType === pf.growType) score += 3;
            else mismatch = true;
        }

        // 중량: 둘 다 있으면 일치해야 함
        if (sf.weight && pf.weight) {
            if (sf.weight === pf.weight) score += 2;
            else mismatch = true;
        }

        // 등급: 둘 다 있으면 일치해야 함
        if (sf.grade && pf.grade) {
            if (sf.grade === pf.grade) score += 2;
            else mismatch = true;
        }

        if (mismatch) continue;
        if (score > bestScore) { bestScore = score; bestMatch = p; }
    }

    return bestMatch;
}

async function getPricingForDate(partner, dateStr) {
    // 서버에서 SQL로 직접 날짜 기간 필터링 (timezone 문제 방지)
    const applicable = await api(`/api/pricing/for-date?partner=${encodeURIComponent(partner)}&date=${dateStr}`);

    if (applicable.length > 0) {
        console.log(`[정산 매칭] 정산날짜: ${dateStr}, 매칭된 pricing 기간: ${applicable[0].startDate} ~ ${applicable[0].endDate}, 품목 수: ${applicable.reduce((sum, p) => sum + (p.items || []).length, 0)}`);
    } else {
        console.log(`[정산 매칭] 정산날짜: ${dateStr}, 거래처: ${partner} - 매칭되는 pricing 없음`);
    }

    if (applicable.length === 0) return [];
    const itemMap = {};
    applicable.sort((a, b) => a.id - b.id);
    applicable.forEach(p => { (p.items || []).forEach(item => { itemMap[item.name] = item.price; }); });
    const result = Object.entries(itemMap).map(([name, price]) => ({ name, price }));
    console.log(`[정산 매칭] 사용 가능한 품목:`, result.map(r => r.name).join(', '));
    return result;
}

function showSettlementRows() {
    document.getElementById('settlement-rows-header').style.display = 'flex';
    document.getElementById('settlement-add-row').style.display = '';
}
function resetSettlementPaste() {
    document.getElementById('settlement-rows-header').style.display = 'none';
    document.getElementById('settlement-add-row').style.display = 'none';
}

document.getElementById('settlement-add-row').addEventListener('click', () => addSettlementRow());

// 매칭 기억하기 버튼
document.getElementById('save-mappings-btn').addEventListener('click', async () => {
    const selects = document.querySelectorAll('.unmatched-select');
    let savedCount = 0;
    const pricingItems = window._currentPricingItems || [];

    for (const sel of selects) {
        if (!sel.value) continue;
        const salesName = sel.dataset.salesName;
        const qty = Number(sel.dataset.qty) || 1;

        try {
            await api('/api/product-mappings', 'POST', {
                salesName, pricingName: sel.value, partner: selectedSettlementPartner
            });
            savedCount++;

            // 정산 행에서 해당 미매칭 항목 찾아 가격 업데이트
            const price = pricingItems.find(p => p.name === sel.value)?.price || 0;
            const rows = document.querySelectorAll('#settlement-rows .settlement-row');
            for (const row of rows) {
                const nameInput = row.querySelector('.s-item-name');
                if (nameInput && nameInput.value === salesName) {
                    nameInput.value = sel.value;
                    row.querySelector('.s-item-price').value = price;
                    const q = Number(row.querySelector('.s-item-qty').value) || 0;
                    row.querySelector('.s-item-subtotal').textContent = (price * q).toLocaleString() + ' 원';
                    break;
                }
            }
        } catch (err) {
            console.error('매핑 저장 실패:', err);
        }
    }

    if (savedCount > 0) {
        updateSettlementTotal();
        document.getElementById('sales-unmatched-container').style.display = 'none';
        alert(savedCount + '개 매칭이 저장되었습니다. 다음부터 자동 매칭됩니다.');
    } else {
        alert('매칭할 품목을 드롭다운에서 선택해주세요.');
    }
});

function addSettlementRow(name, price, qty) {
    name = name || ''; price = price || ''; qty = qty || 1;
    const subtotal = (Number(price) || 0) * (Number(qty) || 0);
    const container = document.getElementById('settlement-rows');
    const div = document.createElement('div');
    div.className = 'settlement-row';
    div.innerHTML = `
        <input type="text" placeholder="품목명" class="s-item-name" value="${name}">
        <input type="number" placeholder="단가" class="s-item-price" value="${price}">
        <input type="number" placeholder="수량" class="s-item-qty" value="${qty}">
        <span class="s-item-subtotal">${subtotal.toLocaleString()} 원</span>
        <button class="btn-remove-row" onclick="removeSettlementRow(this)">×</button>
    `;
    container.appendChild(div);
    showSettlementRows();
    const priceInput = div.querySelector('.s-item-price');
    const qtyInput = div.querySelector('.s-item-qty');
    const calc = () => {
        const p = Number(priceInput.value) || 0;
        const q = Number(qtyInput.value) || 0;
        div.querySelector('.s-item-subtotal').textContent = `${(p * q).toLocaleString()} 원`;
        updateSettlementTotal();
    };
    priceInput.addEventListener('input', calc);
    qtyInput.addEventListener('input', calc);
}

window.removeSettlementRow = function(btn) { btn.closest('.settlement-row').remove(); updateSettlementTotal(); };

function updateSettlementTotal() {
    let total = 0;
    document.querySelectorAll('#settlement-rows .settlement-row').forEach(row => {
        total += (Number(row.querySelector('.s-item-price').value) || 0) * (Number(row.querySelector('.s-item-qty').value) || 0);
    });
    document.getElementById('settlement-amount').value = total;
}

document.getElementById('settlement-month-filter').addEventListener('change', () => { renderSettlementList().catch(console.error); });

document.getElementById('settlement-save').addEventListener('click', async () => {
    try {
        const date = document.getElementById('settlement-date').value;
        if (!date) return alert('날짜를 선택해주세요.');
        if (!selectedSettlementPartner) return alert('거래처를 선택해주세요.');

        let items = [], amount = 0;
        if (selectedSettlementPartner === 'CJ대한통운') {
            const parcelQty = Number(document.getElementById('cj-parcel-qty').value) || 0;
            if (parcelQty <= 0) return alert('택배수량을 입력해주세요.');
            amount = parcelQty * 3100;
            items = [{ name: 'CJ택배', price: 3100, qty: parcelQty, subtotal: amount }];
        } else {
            document.querySelectorAll('#settlement-rows .settlement-row').forEach(row => {
                const name = row.querySelector('.s-item-name').value.trim();
                const price = Number(row.querySelector('.s-item-price').value) || 0;
                const qty = Number(row.querySelector('.s-item-qty').value) || 0;
                if (name) items.push({ name, price, qty, subtotal: price * qty });
            });
            amount = Number(document.getElementById('settlement-amount').value) || 0;
        }

        // 같은 날짜+거래처 중복 저장 방지 확인
        if (settlementsCache && settlementsCache.length > 0) {
            const duplicate = settlementsCache.find(s => s.date === date && s.partner === selectedSettlementPartner);
            if (duplicate) {
                if (!confirm(`⚠️ ${date} ${selectedSettlementPartner} 정산이 이미 존재합니다.\n중복 저장하시겠습니까?`)) return;
            }
        }

        await api('/api/settlements', 'POST', { date, partner: selectedSettlementPartner, amount, items });

        selectedSettlementPartner = null;
        document.getElementById('settlement-amount').value = '';
        document.querySelectorAll('#settlement-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
        document.getElementById('settlement-rows').innerHTML = '';
        resetSettlementPaste();
        document.getElementById('cj-auto-detail').style.display = 'none';
        toggleCjMode(false);
        await renderSettlementList();
        await renderSettlementCalendar();
        alert('저장되었습니다.');
    } catch (err) { alert('저장 실패: ' + err.message); }
});

async function renderSettlementList() {
    const monthVal = document.getElementById('settlement-month-filter').value;
    const url = monthVal ? `/api/settlements?month=${monthVal}` : '/api/settlements';
    const data = await api(url);
    settlementsCache = data;

    const tbody = document.getElementById('settlement-list');
    let totalAmount = 0;

    if (data.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">데이터가 없습니다.</td></tr>';
    } else {
        tbody.innerHTML = data.map(item => {
            totalAmount += (item.amount || 0);
            const fromPricingBadge = item.fromPricing ? '<span class="badge-pricing">품목별금액</span>' : '';
            const paidBadge = item.isPaid ? '<span class="badge-paid">✅</span>' : '<span class="badge-unpaid">☐</span>';
            return `<tr>
                <td>${item.date}</td>
                <td>${item.partner} ${fromPricingBadge}</td>
                <td>${(item.amount || 0).toLocaleString()} 원 ${paidBadge}</td>
                <td>
                    ${item.items && item.items.length > 0 ? `<button class="btn-view-items" onclick="viewSettlementItems(${item.id})">상세</button>` : ''}
                    <button class="btn-danger" onclick="deleteSettlement(${item.id})">삭제</button>
                </td>
            </tr>`;
        }).join('');
    }
    document.getElementById('settlement-total-amount').innerHTML = `<strong>${totalAmount.toLocaleString()} 원</strong>`;
}

window.deleteSettlement = async function(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try { await api(`/api/settlements/${id}`, 'DELETE'); await renderSettlementList(); await renderSettlementCalendar(); } catch (err) { alert('삭제 실패: ' + err.message); }
};

window.viewSettlementItems = function(id) {
    const item = settlementsCache.find(d => d.id === id);
    if (!item || !item.items || item.items.length === 0) return;

    let isEditMode = false;
    const originalItems = JSON.parse(JSON.stringify(item.items));
    let editItems = JSON.parse(JSON.stringify(item.items));

    function renderModal(overlay) {
        const displayItems = isEditMode ? editItems : item.items;
        const rows = displayItems.map((i, idx) => {
            const price = i.price || 0;
            const qty = i.qty || 1;
            const subtotal = price * qty;
            if (isEditMode) {
                return `<tr>
                    <td>${i.name}</td>
                    <td style="text-align:right">${price.toLocaleString()} 원</td>
                    <td style="text-align:center"><input type="number" class="settlement-qty-input" data-idx="${idx}" value="${qty}" min="0" style="width:70px;text-align:center;padding:4px 6px;border:1px solid #4F46E5;border-radius:4px;font-size:14px;"></td>
                    <td style="text-align:right" class="settlement-subtotal" data-idx="${idx}">${subtotal.toLocaleString()} 원</td>
                </tr>`;
            }
            return `<tr><td>${i.name}</td><td style="text-align:right">${price.toLocaleString()} 원</td><td style="text-align:center">${qty}</td><td style="text-align:right">${(i.subtotal || price).toLocaleString()} 원</td></tr>`;
        }).join('');

        const total = displayItems.reduce((sum, i) => sum + (i.price || 0) * (i.qty || 1), 0);

        const editBtn = isEditMode
            ? `<div style="display:flex;gap:8px;justify-content:center;margin-top:16px;">
                <button class="btn-primary" id="settlement-save-btn" style="padding:8px 24px;">저장</button>
                <button class="btn-secondary" id="settlement-cancel-btn" style="padding:8px 24px;">취소</button>
               </div>`
            : `<div style="display:flex;gap:8px;justify-content:center;margin-top:16px;">
                <button class="btn-secondary" id="settlement-edit-btn" style="padding:8px 24px;">수정</button>
                <button class="btn-secondary" id="settlement-close-btn" style="padding:8px 24px;">닫기</button>
               </div>`;

        overlay.querySelector('.modal').innerHTML = `
            <button class="modal-close" id="settlement-x-btn">×</button>
            <h3>${item.date} - ${item.partner} 상세${isEditMode ? ' <span style="color:#4F46E5;font-size:14px;">[수정모드]</span>' : ''}</h3>
            <table class="data-table">
                <thead><tr><th>품목명</th><th style="text-align:right">단가</th><th style="text-align:center">수량</th><th style="text-align:right">소계</th></tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr><td colspan="3"><strong>합계</strong></td><td style="text-align:right" id="settlement-total"><strong>${total.toLocaleString()} 원</strong></td></tr></tfoot>
            </table>
            ${editBtn}
        `;

        // 버튼 이벤트 바인딩
        const xBtnEl = overlay.querySelector('#settlement-x-btn');
        if (xBtnEl) {
            xBtnEl.addEventListener('click', () => { restoreAndClose(overlay); });
        }
        const editBtnEl = overlay.querySelector('#settlement-edit-btn');
        if (editBtnEl) {
            editBtnEl.addEventListener('click', () => { editItems = JSON.parse(JSON.stringify(item.items)); isEditMode = true; renderModal(overlay); });
        }
        const closeBtnEl = overlay.querySelector('#settlement-close-btn');
        if (closeBtnEl) {
            closeBtnEl.addEventListener('click', () => { restoreAndClose(overlay); });
        }
        const cancelBtnEl = overlay.querySelector('#settlement-cancel-btn');
        if (cancelBtnEl) {
            cancelBtnEl.addEventListener('click', () => {
                editItems = JSON.parse(JSON.stringify(originalItems));
                isEditMode = false;
                renderModal(overlay);
            });
        }
        const saveBtnEl = overlay.querySelector('#settlement-save-btn');
        if (saveBtnEl) {
            saveBtnEl.addEventListener('click', async () => {
                const newTotal = editItems.reduce((sum, i) => sum + (i.price || 0) * (i.qty || 1), 0);
                const updatedItems = editItems.map(i => ({ ...i, subtotal: (i.price || 0) * (i.qty || 1) }));
                try {
                    await api(`/api/settlements/${id}/items`, 'PUT', { items: updatedItems, amount: newTotal });
                    item.items = updatedItems;
                    item.amount = newTotal;
                    isEditMode = false;
                    renderModal(overlay);
                    showToast('수정 완료');
                    await renderSettlementList();
                    await renderSettlementCalendar();
                } catch (err) {
                    alert('수정 실패: ' + (err.message || err));
                }
            });
        }

        // 수량 input 실시간 계산 (editItems 임시 배열만 수정, 원본은 저장 시에만 변경)
        overlay.querySelectorAll('.settlement-qty-input').forEach(input => {
            input.addEventListener('input', () => {
                const idx = parseInt(input.dataset.idx);
                const newQty = parseInt(input.value) || 0;
                editItems[idx].qty = newQty;
                const subtotal = (editItems[idx].price || 0) * newQty;
                overlay.querySelector(`.settlement-subtotal[data-idx="${idx}"]`).textContent = subtotal.toLocaleString() + ' 원';
                const total = editItems.reduce((sum, i) => sum + (i.price || 0) * (i.qty || 1), 0);
                overlay.querySelector('#settlement-total').innerHTML = `<strong>${total.toLocaleString()} 원</strong>`;
            });
        });
    }

    // 모달 닫힐 때 원본 복원하는 함수
    function restoreAndClose(overlay) {
        item.items = JSON.parse(JSON.stringify(originalItems));
        overlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal"></div>';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) restoreAndClose(overlay); });
    document.body.appendChild(overlay);
    renderModal(overlay);
};

// =============================================
// 품목별 금액 (기존 기능 유지)
// =============================================
let selectedPricingPartner = null;

const startOfWeek = new Date();
const dayOfWeek = startOfWeek.getDay();
const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
const endOfWeek = new Date(startOfWeek);
endOfWeek.setDate(endOfWeek.getDate() + 6);

document.getElementById('pricing-start-date').value = formatDate(startOfWeek);
document.getElementById('pricing-end-date').value = formatDate(endOfWeek);

document.getElementById('pricing-partner-group').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-toggle');
    if (!btn) return;
    document.querySelectorAll('#pricing-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPricingPartner = btn.dataset.value;
});

const pricingPasteArea = document.getElementById('pricing-paste-area');
const pricingExcelInput = document.getElementById('pricing-excel-file');

pricingPasteArea.addEventListener('click', () => pricingExcelInput.click());
pricingExcelInput.addEventListener('change', () => { if (pricingExcelInput.files.length > 0) { parsePricingExcel(pricingExcelInput.files[0]); pricingExcelInput.value = ''; } });
pricingPasteArea.addEventListener('dragover', (e) => { e.preventDefault(); pricingPasteArea.classList.add('dragover'); });
pricingPasteArea.addEventListener('dragleave', () => { pricingPasteArea.classList.remove('dragover'); });
pricingPasteArea.addEventListener('drop', (e) => {
    e.preventDefault(); pricingPasteArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) { const file = e.dataTransfer.files[0]; if (file.name.match(/\.(xls|xlsx)$/i)) { parsePricingExcel(file); return; } }
    const text = e.dataTransfer.getData('text'); if (text) parsePricingText(text);
});
pricingPasteArea.addEventListener('paste', (e) => { e.preventDefault(); const text = e.clipboardData.getData('text'); if (text) parsePricingText(text); });
document.getElementById('page-pricing').addEventListener('paste', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault(); const text = e.clipboardData.getData('text'); if (text) parsePricingText(text);
});

function parsePricingExcel(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (jsonData.length === 0) return alert('엑셀에 데이터가 없습니다.');

            const header = jsonData[0].map(h => String(h || '').trim());
            let nameCol = -1, priceCol = -1;
            header.forEach((h, i) => {
                const lower = h.toLowerCase();
                if (lower.includes('옵션명') || lower.includes('품목명') || lower.includes('상품명') || lower.includes('품목')) nameCol = i;
                if (lower.includes('단가') || lower.includes('가격') || lower.includes('금액')) priceCol = i;
            });
            if (nameCol === -1) nameCol = 0;
            if (priceCol === -1) priceCol = header.length >= 2 ? 1 : -1;

            document.getElementById('pricing-rows').innerHTML = '';
            const inheritMap = getInheritedBoxTypeMap();
            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i]; if (!row || row.length === 0) continue;
                const name = String(row[nameCol] || '').trim();
                let price = 0;
                if (priceCol >= 0 && row[priceCol] != null) price = Number(String(row[priceCol]).replace(/[,원\s]/g, '')) || 0;
                if (name) addPricingRow(name, price, inheritMap[name]);
            }
            showPricingRows();
        } catch (err) { alert('엑셀 파일을 읽는데 실패했습니다: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
}

function parsePricingText(text) {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return;
    document.getElementById('pricing-rows').innerHTML = '';
    const inheritMap = getInheritedBoxTypeMap();
    lines.forEach(line => {
        const parts = line.split(/\t/).map(s => s.trim()).filter(s => s);
        let name = '', price = 0;
        if (parts.length >= 2) { price = Number(parts[parts.length - 1].replace(/[,원\s]/g, '')) || 0; name = parts.slice(0, parts.length - 1).join(' '); }
        else { const match = line.match(/^(.+?)\s{2,}([\d,]+)/); if (match) { name = match[1].trim(); price = Number(match[2].replace(/,/g, '')) || 0; } else { name = line.trim(); } }
        if (name && !name.match(/^(옵션명|품목명|상품명|단가|가격)$/)) addPricingRow(name, price, inheritMap[name]);
    });
    showPricingRows();
}

function showPricingRows() { document.getElementById('pricing-rows-header').style.display = 'flex'; document.getElementById('pricing-add-row').style.display = ''; document.getElementById('pricing-paste-area').style.display = 'none'; }
function resetPricingPaste() { document.getElementById('pricing-rows-header').style.display = 'none'; document.getElementById('pricing-add-row').style.display = 'none'; document.getElementById('pricing-paste-area').style.display = ''; }

document.getElementById('pricing-add-row').addEventListener('click', () => addPricingRow());

// 품목별 금액 초기화 버튼
document.getElementById('pricing-reset-btn').addEventListener('click', () => {
    selectedPricingPartner = null;
    document.querySelectorAll('#pricing-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    document.getElementById('pricing-rows').innerHTML = '';
    resetPricingPaste();
    // 날짜를 현재 주로 리셋
    const sow = new Date();
    const dow2 = sow.getDay();
    const diff2 = dow2 === 0 ? -6 : 1 - dow2;
    sow.setDate(sow.getDate() + diff2);
    const eow = new Date(sow);
    eow.setDate(eow.getDate() + 6);
    document.getElementById('pricing-start-date').value = formatDate(sow);
    document.getElementById('pricing-end-date').value = formatDate(eow);
});

// 박스 옵션 (값은 box_inventory.product_name과 정확히 일치 — 추후 차감 매칭용)
const BOX_OPTIONS = [
    { value: '해당없음', label: '해당없음' },
    { value: '귤 박스 3kg', label: '귤박스 3kg' },
    { value: '귤 박스 5kg', label: '귤박스 5kg' },
    { value: '귤 박스 10kg', label: '귤박스 10kg' },
    { value: '만감 박스 3kg', label: '만감박스 3kg' },
    { value: '만감 박스 5kg', label: '만감박스 5kg' },
    { value: '만감 박스 10kg', label: '만감박스 10kg' }
];
let _pricingRowUid = 0;

// 엑셀/붙여넣기로 단가표를 채울 때, 같은 거래처의 가장 최근 단가표에서
// 품목명이 일치하는 boxType(박스 매핑)을 자동 상속한다.
// (매주 새 표를 만들 때 박스 라디오를 수동 재설정하다 빠뜨리는 실수 방지)
function getInheritedBoxTypeMap() {
    if (!selectedPricingPartner || !Array.isArray(pricingCache)) return {};
    // 박스 매핑이 하나라도 있는 같은 거래처 단가표만 후보 (매핑이 텅 빈 표는 기준에서 제외)
    const same = pricingCache.filter(p => p.partner === selectedPricingPartner
        && (p.items || []).some(it => it.boxType && it.boxType !== '해당없음'));
    if (same.length === 0) return {};
    // 종료일 최신 → 동일 시 id 최신 순으로 가장 최근 표 선택
    same.sort((a, b) => {
        const ae = a.endDate || '', be = b.endDate || '';
        if (ae !== be) return ae < be ? 1 : -1;
        return (b.id || 0) - (a.id || 0);
    });
    const map = {};
    (same[0].items || []).forEach(it => {
        if (it.boxType && it.boxType !== '해당없음') map[it.name] = it.boxType;
    });
    return map;
}

function addPricingRow(name, price, boxType) {
    name = name || ''; price = price || ''; boxType = boxType || '해당없음';
    const container = document.getElementById('pricing-rows');
    const div = document.createElement('div');
    div.className = 'pricing-row pricing-row-v2';
    const uid = ++_pricingRowUid;
    const boxHtml = BOX_OPTIONS.map(o =>
        `<label class="pricing-box-opt"><input type="radio" name="pricing-box-${uid}" value="${o.value}" ${o.value === boxType ? 'checked' : ''}><span>${o.label}</span></label>`
    ).join('');
    div.innerHTML = `
        <div class="pricing-row-main">
            <input type="text" placeholder="품목명" class="pricing-item-name" value="${name}">
            <input type="number" placeholder="단가 (원)" class="pricing-item-price" value="${price}">
            <button class="btn-remove-row" onclick="removePricingRow(this)">×</button>
        </div>
        <div class="pricing-row-box-line">
            <span class="pricing-box-label">📦 박스:</span>
            ${boxHtml}
        </div>
    `;
    container.appendChild(div);
    showPricingRows();
}
window.removePricingRow = function(btn) { btn.closest('.pricing-row').remove(); };

document.getElementById('pricing-save').addEventListener('click', async () => {
    try {
        const startDate = document.getElementById('pricing-start-date').value;
        const endDate = document.getElementById('pricing-end-date').value;
        if (!startDate || !endDate) return alert('기간을 선택해주세요.');
        if (!selectedPricingPartner) return alert('거래처를 선택해주세요.');

        const rows = [];
        document.querySelectorAll('#pricing-rows .pricing-row').forEach(row => {
            const name = row.querySelector('.pricing-item-name').value.trim();
            const price = row.querySelector('.pricing-item-price').value;
            const boxChecked = row.querySelector('input[type="radio"]:checked');
            const boxType = boxChecked ? boxChecked.value : '해당없음';
            if (name) rows.push({ name, price: Number(price) || 0, boxType });
        });
        if (rows.length === 0) return alert('품목을 입력해주세요.');

        await api('/api/pricing', 'POST', { startDate, endDate, partner: selectedPricingPartner, items: rows });

        selectedPricingPartner = null;
        document.querySelectorAll('#pricing-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
        document.getElementById('pricing-rows').innerHTML = '';
        resetPricingPaste();
        await renderPricingList();
        alert('저장되었습니다.');
    } catch (err) { alert('저장 실패: ' + err.message); }
});

// 박스 표시용 짧은 라벨 + 색상
function pricingBoxBadge(boxType) {
    if (!boxType || boxType === '해당없음') return '<span style="color:#9ca3af;font-size:12px;">해당없음</span>';
    const opt = BOX_OPTIONS.find(o => o.value === boxType);
    const label = opt ? opt.label : boxType;
    // 귤박스=주황, 만감박스=초록 톤
    const isGyul = boxType.indexOf('귤') === 0;
    const bg = isGyul ? '#FFF3E0' : '#E8F5E9';
    const color = isGyul ? '#E65100' : '#2E7D32';
    return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;">📦 ${label}</span>`;
}

async function renderPricingList() {
    const data = await api('/api/pricing');
    pricingCache = data;
    const tbody = document.getElementById('pricing-list');

    if (data.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">설정된 금액이 없습니다.</td></tr>';
    } else {
        let rows = '';
        data.forEach(item => {
            const items = item.items || [];
            if (items.length === 0) {
                rows += `<tr><td>${item.startDate} ~ ${item.endDate}</td><td>${item.partner}</td><td>-</td><td>-</td><td>-</td></tr>`;
            } else {
                const colorClass = item.partner === '대성(시온)' ? 'pricing-daesung' : (item.partner === '효돈농협' ? 'pricing-hyodon' : 'pricing-aewol');
                items.forEach((it, idx) => {
                    rows += `<tr class="${colorClass}">
                        ${idx === 0 ? `<td rowspan="${items.length}">${item.startDate} ~ ${item.endDate}<br><button class="btn-outline" style="margin-top:6px" onclick="editPricing(${item.id})">✏️ 수정</button><br><button class="btn-danger" style="margin-top:6px" onclick="deletePricing(${item.id})">삭제</button></td>` : ''}
                        ${idx === 0 ? `<td rowspan="${items.length}">${item.partner}</td>` : ''}
                        <td>${it.name}</td>
                        <td>${(it.price || 0).toLocaleString()} 원</td>
                        <td>${pricingBoxBadge(it.boxType)}</td>
                    </tr>`;
                });
            }
        });
        tbody.innerHTML = rows;
    }
}

window.deletePricing = async function(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try { await api(`/api/pricing/${id}`, 'DELETE'); await renderPricingList(); } catch (err) { alert('삭제 실패: ' + err.message); }
};

// 품목별 금액 수정 (대표 7/20): 품목명·단가·박스 편집 모달
window.editPricing = function(id) {
    const entry = (pricingCache || []).find(p => p.id === id);
    if (!entry) return alert('항목을 찾을 수 없습니다');
    document.querySelectorAll('.ao-pricing-edit-overlay').forEach(e => e.remove());
    const boxOpts = (cur) => BOX_OPTIONS.map(o => `<option value="${aoEsc(o.value)}"${o.value === (cur || '해당없음') ? ' selected' : ''}>${aoEsc(o.label)}</option>`).join('');
    const rowHtml = (it, i) => `<tr data-prow="${i}">
        <td><input class="form-input pe-name" value="${aoEsc(it.name || '')}" style="width:100%;min-width:200px;font-size:13px;"></td>
        <td><input class="form-input pe-price" type="number" value="${Number(it.price) || 0}" style="width:100px;font-size:13px;text-align:right;"></td>
        <td><select class="form-input pe-box" style="font-size:13px;">${boxOpts(it.boxType)}</select></td>
        <td><button class="btn-danger" style="padding:4px 8px;font-size:12px;" onclick="this.closest('tr').remove()">✕</button></td>
    </tr>`;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ao-pricing-edit-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:720px;width:96vw;">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 4px;">✏️ 품목별 금액 수정</h3>
        <div style="color:#666;font-size:13px;margin-bottom:12px;">${aoEsc(entry.startDate)} ~ ${aoEsc(entry.endDate)} · <strong>${aoEsc(entry.partner)}</strong></div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#f7f7f7;"><th style="padding:6px;text-align:left;">품목명</th><th style="padding:6px;">단가(원)</th><th style="padding:6px;">박스</th><th style="padding:6px;"></th></tr></thead>
            <tbody id="pe-rows">${(entry.items || []).map(rowHtml).join('')}</tbody>
        </table>
        </div>
        <button class="btn-outline" style="margin-top:10px;font-size:13px;" onclick="aoPricingAddRow()">+ 품목 추가</button>
        <div style="display:flex;gap:8px;margin-top:16px;">
            <button class="btn-primary" style="flex:1;padding:12px;" onclick="aoPricingSaveEdit(${id})">💾 저장</button>
            <button class="btn-outline" style="flex:1;padding:12px;" onclick="this.closest('.modal-overlay').remove()">취소</button>
        </div>
    </div>`;
    overlay._boxOpts = boxOpts;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};
window.aoPricingAddRow = function() {
    const tbody = document.getElementById('pe-rows');
    const boxOpts = BOX_OPTIONS.map(o => `<option value="${aoEsc(o.value)}"${o.value === '해당없음' ? ' selected' : ''}>${aoEsc(o.label)}</option>`).join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="form-input pe-name" value="" style="width:100%;min-width:200px;font-size:13px;"></td>
        <td><input class="form-input pe-price" type="number" value="0" style="width:100px;font-size:13px;text-align:right;"></td>
        <td><select class="form-input pe-box" style="font-size:13px;">${boxOpts}</select></td>
        <td><button class="btn-danger" style="padding:4px 8px;font-size:12px;" onclick="this.closest('tr').remove()">✕</button></td>`;
    tbody.appendChild(tr);
};
window.aoPricingSaveEdit = async function(id) {
    const entry = (pricingCache || []).find(p => p.id === id);
    if (!entry) return;
    const items = [];
    document.querySelectorAll('#pe-rows tr').forEach(tr => {
        const name = tr.querySelector('.pe-name').value.trim();
        const price = Number(tr.querySelector('.pe-price').value) || 0;
        const boxType = tr.querySelector('.pe-box').value;
        if (name) items.push({ name, price, boxType });
    });
    if (!items.length) return alert('품목이 하나 이상 필요합니다');
    try {
        await api(`/api/pricing/${id}`, 'PUT', { startDate: entry.startDate, endDate: entry.endDate, partner: entry.partner, items });
        document.querySelectorAll('.ao-pricing-edit-overlay').forEach(e => e.remove());
        await renderPricingList();
        showToast('✅ 품목별 금액이 수정되었습니다');
    } catch (err) { alert('저장 실패: ' + err.message); }
};

// =============================================
// 사용자 관리 (관리자 전용)
// =============================================

async function renderUserList() {
    try {
        const users = await api('/api/users');
        const tbody = document.getElementById('user-list');
        if (users.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="7">사용자가 없습니다.</td></tr>';
        } else {
            tbody.innerHTML = users.map(u => `<tr>
                <td>${u.username}</td>
                <td>${u.name}</td>
                <td>${u.position || '-'}</td>
                <td><span class="user-color-dot" style="background:${u.color};display:inline-block;"></span> ${u.color}</td>
                <td>${u.role === 'admin' ? '관리자' : u.role === 'accountant' ? '세무사' : '직원'}</td>
                <td>${u.annualLeave}</td>
                <td>
                    <button class="btn-view-items" onclick="openUserModal(${u.id})">수정</button>
                    ${u.username !== 'admin' ? `<button class="btn-danger" onclick="deleteUser(${u.id})">삭제</button>` : ''}
                </td>
            </tr>`).join('');
        }
    } catch (err) { console.error('renderUserList error:', err); }
}

document.getElementById('btn-add-user').addEventListener('click', () => openUserModal());

// 대표 7/24: 네이버 커머스API 중계서버 연결 테스트 (2단계)
(function () {
    const btn = document.getElementById('btn-naver-test');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const box = document.getElementById('naver-test-result');
        btn.disabled = true;
        if (box) box.innerHTML = '⏳ 확인 중... (중계서버 → 네이버 왕복)';
        try {
            const r = await api('/api/agent-office/naver/test');
            const ok = r.ok;
            const line = (label, good, detail) =>
                `<div>${good ? '✅' : '❌'} <strong>${label}</strong>${detail ? ' — ' + aoEsc(String(detail)) : ''}</div>`;
            let html = '';
            html += line('중계서버 도달', r.relay_reachable, r.relay_reachable ? '101.79.16.213:4000 응답' : '연결 안 됨');
            html += line('네이버 토큰 발급', r.naver_token === 'success', r.naver_token);
            const c = r.chain || {};
            html += line('정산 조회 왕복(Bearer 인증)', c.ok, c.ok ? `${c.date} 조회 성공` : (c.error || '') + (c.status ? ' (' + c.status + ')' : ''));
            html += `<div style="margin-top:8px;font-weight:700;color:${ok ? '#12B76A' : '#F04438'};">${ok ? '🎉 전체 연결 정상! 3단계(정산 조회) 준비 완료' : '⚠️ 위 항목 확인 필요 — 결과를 클로드에게 알려주세요'}</div>`;
            if (box) box.innerHTML = html;
        } catch (e) {
            if (box) box.innerHTML = '❌ 테스트 실패: ' + aoEsc(e.message || String(e));
        } finally { btn.disabled = false; }
    });
})();

window.openUserModal = async function(userId) {
    let user = null;
    if (userId) {
        try {
            const users = await api('/api/users');
            user = users.find(u => u.id === userId);
        } catch (err) { return; }
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3>${user ? '직원 수정' : '직원 추가'}</h3>
            <div class="form-group">
                <label>아이디</label>
                <input type="text" id="modal-user-username" class="form-input" value="${user ? user.username : ''}" ${user ? 'readonly style="background:#f3f4f6;"' : 'placeholder="아이디"'}>
            </div>
            <div class="form-group">
                <label>${user ? '비밀번호 (변경 시에만 입력)' : '비밀번호'}</label>
                <input type="password" id="modal-user-password" class="form-input" placeholder="비밀번호">
            </div>
            <div class="form-group">
                <label>이름</label>
                <input type="text" id="modal-user-name" class="form-input" value="${user ? user.name : ''}" placeholder="이름">
            </div>
            <div class="form-group">
                <label>직급</label>
                <input type="text" id="modal-user-position" class="form-input" value="${user ? user.position : ''}" placeholder="직급 (예: 대표, 이사, 사원)">
            </div>
            <div class="form-group">
                <label>달력 색상</label>
                <input type="color" id="modal-user-color" class="form-input" value="${user ? user.color : '#3b82f6'}" style="height:40px;padding:4px;">
            </div>
            <div class="form-group">
                <label>역할</label>
                <select id="modal-user-role" class="form-input">
                    <option value="user" ${user && user.role === 'user' ? 'selected' : ''}>직원</option>
                    <option value="admin" ${user && user.role === 'admin' ? 'selected' : ''}>관리자</option>
                    <option value="accountant" ${user && user.role === 'accountant' ? 'selected' : ''}>세무사 (조회 전용)</option>
                </select>
            </div>
            <div class="form-group">
                <label>잔여연차</label>
                <input type="number" id="modal-user-annual" class="form-input" value="${user ? user.annualLeave : 15}" min="0">
            </div>
            <button class="btn-primary" id="modal-user-save" style="width:100%;">저장</button>
        </div>
    `;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    overlay.querySelector('#modal-user-save').addEventListener('click', async () => {
        try {
            const data = {
                name: overlay.querySelector('#modal-user-name').value.trim(),
                position: overlay.querySelector('#modal-user-position').value.trim(),
                color: overlay.querySelector('#modal-user-color').value,
                role: overlay.querySelector('#modal-user-role').value,
                annualLeave: Number(overlay.querySelector('#modal-user-annual').value) || 0
            };
            const pw = overlay.querySelector('#modal-user-password').value;

            if (user) {
                if (pw) data.password = pw;
                await api(`/api/users/${user.id}`, 'PUT', data);
            } else {
                data.username = overlay.querySelector('#modal-user-username').value.trim();
                data.password = pw;
                if (!data.username || !data.password || !data.name) return alert('아이디, 비밀번호, 이름은 필수입니다.');
                await api('/api/users', 'POST', data);
            }

            overlay.remove();
            await renderUserList();
            alert('저장되었습니다.');
        } catch (err) { alert('저장 실패: ' + err.message); }
    });
};

window.deleteUser = async function(id) {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try { await api(`/api/users/${id}`, 'DELETE'); await renderUserList(); } catch (err) { alert('삭제 실패: ' + err.message); }
};

// =============================================
// 기안서류
// =============================================
let currentDocType = 'vacation';
let selectedDocSubType = '연차';
let approverList = [];

// 상위 탭 전환 (신청목록 / 승인 이력)
document.querySelectorAll('.doc-main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.doc-main-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const section = tab.dataset.docMain;
        document.getElementById('doc-section-list').style.display = section === 'list' ? '' : 'none';
        document.getElementById('doc-section-history').style.display = section === 'history' ? '' : 'none';
        if (section === 'history') {
            selectedLeaveEmpId = null;
            document.getElementById('history-employee').value = '';
            loadHistoryFilters();
            renderLeaveSummary();
            searchDocHistory();
            loadLeaveAdjustments();
        }
    });
});

// 하위 탭 전환 (휴가/근태/시말서)
document.querySelectorAll('.doc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.doc-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentDocType = tab.dataset.docType;
        updateDocForm();
        renderDocList().catch(console.error);
    });
});

function updateDocForm() {
    const typeLabels = { vacation: '휴가신청서', attendance: '근태신청서', reason: '시말서', employment: '재직증명서' };
    document.getElementById('doc-form-title').textContent = typeLabels[currentDocType] + ' 작성';

    document.getElementById('doc-vacation-type-group').style.display = currentDocType === 'vacation' ? '' : 'none';
    document.getElementById('doc-attendance-type-group').style.display = currentDocType === 'attendance' ? '' : 'none';
    document.getElementById('doc-reason-type-group').style.display = currentDocType === 'reason' ? '' : 'none';
    document.getElementById('doc-employment-type-group').style.display = currentDocType === 'employment' ? '' : 'none';
    document.getElementById('doc-employment-count-group').style.display = currentDocType === 'employment' ? '' : 'none';
    document.getElementById('doc-employment-notice').style.display = currentDocType === 'employment' ? '' : 'none';

    if (currentDocType === 'vacation') selectedDocSubType = '연차';
    else if (currentDocType === 'attendance') selectedDocSubType = '휴직';
    else if (currentDocType === 'reason') selectedDocSubType = '지각';
    else if (currentDocType === 'employment') selectedDocSubType = '은행 제출용';

    const activeGroup = document.getElementById(`doc-${currentDocType}-type-group`);
    if (activeGroup) {
        activeGroup.querySelectorAll('.btn-toggle').forEach((b, i) => b.classList.toggle('active', i === 0));
    }

    updateDocEndDateVisibility();
    // 재직증명서는 결재라인을 대표 단독으로 갱신
    loadApprovers().catch(console.error);
    document.getElementById('doc-list-title').textContent = typeLabels[currentDocType] + ' 목록';
}

function resetDocForm() {
    document.getElementById('doc-start-date').value = '';
    document.getElementById('doc-end-date').value = '';
    document.getElementById('doc-reason').value = '';
    // 결재라인은 자동 표시이므로 초기화 불필요
    const startTime = document.getElementById('doc-start-time');
    const endTime = document.getElementById('doc-end-time');
    if (startTime) startTime.value = '';
    if (endTime) endTime.value = '';
    const hoursDisplay = document.getElementById('doc-time-hours');
    if (hoursDisplay) hoursDisplay.textContent = '';
    updateDocForm();
}
window.resetDocForm = resetDocForm;

function updateDocEndDateVisibility() {
    const isTime = (currentDocType === 'vacation' && selectedDocSubType === '시간차') ||
                   (currentDocType === 'attendance' && selectedDocSubType === '기타');
    const showEndDate = currentDocType === 'vacation' || currentDocType === 'attendance';
    document.getElementById('doc-end-date-group').style.display = showEndDate ? '' : 'none';
    document.getElementById('doc-start-time-group').style.display = isTime ? '' : 'none';
    document.getElementById('doc-end-time-group').style.display = isTime ? '' : 'none';
    document.getElementById('doc-time-hours-group').style.display = isTime ? '' : 'none';
    // 휴가신청서 연차/시간차, 재직증명서는 사유란 숨김
    const hideReason = (currentDocType === 'vacation' && (selectedDocSubType === '연차' || selectedDocSubType === '시간차'))
                     || currentDocType === 'employment';
    document.getElementById('doc-reason-group').style.display = hideReason ? 'none' : '';
    if (hideReason) document.getElementById('doc-reason').value = '';
    // 재직증명서: 시작일 라벨을 '필요일'로 변경, 종료일 숨김
    const startLabel = document.querySelector('label[for=""]');
    const startDateLabel = document.getElementById('doc-start-date')?.previousElementSibling;
    if (startDateLabel && startDateLabel.tagName === 'LABEL') {
        startDateLabel.textContent = currentDocType === 'employment' ? '필요일' : '시작일';
    }
    if (isTime) initTimeSelects();
}

function initTimeSelects() {
    const startSel = document.getElementById('doc-start-time');
    const endSel = document.getElementById('doc-end-time');
    if (startSel.options.length > 1) return;
    const options = ['<option value="">선택</option>'];
    for (let h = 8; h <= 18; h++) {
        for (let m = 0; m < 60; m += 30) {
            if (h === 18 && m > 0) break;
            const t = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
            options.push(`<option value="${t}">${t}</option>`);
        }
    }
    startSel.innerHTML = options.join('');
    endSel.innerHTML = options.join('');
}

// 소수점 연차를 "일 + 시간" 형식으로 변환 (1일 = 8시간, 30분 단위 반올림)
function formatLeave(val) {
    const n = Number(val);
    if (isNaN(n) || n === 0) return '0';
    const days = Math.floor(Math.abs(n));
    const fracHours = (Math.abs(n) - days) * 8;
    // 30분 단위로 반올림: 0, 0.5, 1, 1.5, ...
    const roundedHours = Math.round(fracHours * 2) / 2;
    const wholeH = Math.floor(roundedHours);
    const hasHalf = roundedHours % 1 !== 0;

    let result = '';
    if (days > 0) result += days + '일';
    if (wholeH > 0 || hasHalf) {
        if (result) result += ' ';
        if (hasHalf && wholeH > 0) result += wholeH + '시간 30분';
        else if (hasHalf) result += '30분';
        else result += wholeH + '시간';
    }
    if (!result) result = '0';
    return result;
}

// 차감/추가일수 표시 헬퍼
function formatDeductedLeave(d) {
    const val = d.deductedLeave;
    if (!val || val === 0) return '-';
    if (val < 0) {
        // 추가일수
        return `+${parseFloat(Math.abs(val).toFixed(2))}일`;
    }
    // 차감일수
    if (d.subType === '시간차' && d.startTime && d.endTime) {
        const hrs = calcWorkHoursClient(d.startTime, d.endTime);
        return `${hrs}시간 (-${parseFloat(val.toFixed(2))}일)`;
    }
    return `-${parseFloat(val.toFixed(2))}일`;
}

function calcWorkHoursClient(startTimeStr, endTimeStr) {
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const s = toMin(startTimeStr);
    const e = toMin(endTimeStr);
    const total = (e - s) / 60;
    const lunchStart = 720, lunchEnd = 780;
    let lunchOverlap = 0;
    if (s < lunchEnd && e > lunchStart) {
        lunchOverlap = (Math.min(e, lunchEnd) - Math.max(s, lunchStart)) / 60;
    }
    return Math.max(total - lunchOverlap, 0);
}

function calcTimeLeave() {
    const startTime = document.getElementById('doc-start-time').value;
    const endTime = document.getElementById('doc-end-time').value;
    const display = document.getElementById('doc-time-hours');
    if (!startTime || !endTime) { display.textContent = ''; return; }
    const hours = calcWorkHoursClient(startTime, endTime);
    if (hours <= 0) { display.textContent = '시간을 확인해주세요'; return; }
    const days = parseFloat((hours / 8).toFixed(4));
    display.textContent = `차감 연차: ${hours}시간 (${days}일 차감) *점심시간 제외`;
}
window.calcTimeLeave = calcTimeLeave;

// 서류 하위 유형 선택
['vacation', 'attendance', 'reason', 'employment'].forEach(type => {
    const group = document.getElementById(`doc-${type}-type-group`);
    if (!group) return;
    group.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-toggle');
        if (!btn) return;
        group.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedDocSubType = btn.dataset.value;
        updateDocEndDateVisibility();
    });
});

// 결재자 목록 로드 → 결재라인 카드 UI 표시
async function loadApprovers() {
    try {
        // 재직증명서는 항상 대표 단독 결재
        if (currentDocType === 'employment') {
            const ceo = await api('/api/users/ceo');
            approverList = [ceo];
        } else {
            approverList = await api('/api/users/approvers');
        }
        const container = document.getElementById('doc-approval-line');
        if (!container) return;

        // 신청자(현재 로그인 사용자) + 결재자 카드
        let html = `<div class="expense-approval-step">
            <span class="step-label">신청자</span>
            <span class="step-name">${currentUser.name}</span>
            <span class="step-position">${currentUser.position || ''}</span>
        </div>`;

        if (approverList.length > 0) {
            const approver = approverList[0];
            html += `<span class="expense-approval-arrow">→</span>`;
            html += `<div class="expense-approval-step">
                <span class="step-label">결재</span>
                <span class="step-name">${approver.name}</span>
                <span class="step-position">${approver.position || ''}</span>
            </div>`;
        }
        container.innerHTML = html;
    } catch (err) {
        console.error('loadApprovers error:', err);
    }
}

// 서류 제출
document.getElementById('doc-submit').addEventListener('click', async () => {
    const approverId = approverList.length > 0 ? approverList[0].id : null;
    const startDate = document.getElementById('doc-start-date').value;
    const endDate = document.getElementById('doc-end-date').value;
    let reason = document.getElementById('doc-reason').value.trim();

    if (!startDate) return alert('날짜를 선택해주세요.');
    if (!approverId) return alert('결재자 정보를 불러올 수 없습니다. 페이지를 새로고침해주세요.');

    const isTime = (currentDocType === 'vacation' && selectedDocSubType === '시간차') ||
                   (currentDocType === 'attendance' && selectedDocSubType === '기타');
    const hasEndDate = currentDocType === 'vacation' || currentDocType === 'attendance';

    if (isTime) {
        const st = document.getElementById('doc-start-time').value;
        const et = document.getElementById('doc-end-time').value;
        if (!st || !et) return alert('시작시간과 종료시간을 선택해주세요.');
    }

    // 재직증명서: 매수를 reason에 자동 기록
    if (currentDocType === 'employment') {
        const count = Number(document.getElementById('doc-employment-count').value) || 1;
        reason = `발급 매수: ${count}부`;
    }

    const body = {
        type: currentDocType,
        subType: selectedDocSubType,
        approverId: Number(approverId),
        startDate,
        endDate: hasEndDate ? endDate || startDate : startDate,
        reason
    };
    if (isTime) {
        body.startTime = document.getElementById('doc-start-time').value;
        body.endTime = document.getElementById('doc-end-time').value;
    }

    try {
        await api('/api/documents', 'POST', body);
        alert('서류가 제출되었습니다.');

        document.getElementById('doc-start-date').value = '';
        document.getElementById('doc-end-date').value = '';
        document.getElementById('doc-reason').value = '';
        if (isTime) {
            document.getElementById('doc-start-time').value = '';
            document.getElementById('doc-end-time').value = '';
            document.getElementById('doc-time-hours').textContent = '';
        }

        const me = await api('/api/auth/me');
        currentUser = me;
        localStorage.setItem('jwt_user', JSON.stringify(me));
        document.getElementById('annual-leave-count').textContent = formatLeave(me.annualLeave);

        await renderDocList();
        if (currentUser.role === 'admin') await renderApprovalList();
    } catch (err) {
        alert('제출 실패: ' + err.message);
    }
});

// 서류 목록 렌더링
async function renderDocList() {
    try {
        const docs = await api(`/api/documents?type=${currentDocType}&mine=true`);
        const tbody = document.getElementById('doc-list');

        if (docs.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">서류가 없습니다.</td></tr>';
            return;
        }

        const isAdmin = currentUser?.role === 'admin';

        tbody.innerHTML = docs.map(d => {
            const statusClass = d.status === 'approved' ? 'status-approved' : d.status === 'rejected' ? 'status-rejected' : 'status-pending';
            const statusLabel = d.status === 'approved' ? '승인' : d.status === 'rejected' ? '반려' : '대기중';
            let dateStr = d.startDate === d.endDate ? d.startDate : `${d.startDate} ~ ${d.endDate}`;
            if (d.subType === '시간차' && d.startTime && d.endTime) {
                dateStr += ` (${d.startTime}~${d.endTime})`;
            }

            const isMine = d.applicantId === currentUser?.id;
            const isMyApproval = d.approverId === currentUser?.id;
            // 수정: 대기중/반려 → 본인, 승인 → 결재자
            const canEdit = (d.status === 'pending' && isMine) || (d.status === 'rejected' && isMine) || (d.status === 'approved' && isMyApproval);
            // 삭제: 대기중/반려 → 본인 또는 결재자, 승인 → 결재자만
            const canDelete = (d.status === 'approved' && isMyApproval) || (d.status !== 'approved' && (isMine || isMyApproval));

            let actions = '';
            if (canEdit) actions += `<button class="btn-view" onclick="openEditDocument(${d.id})">${d.status === 'rejected' ? '재제출' : '수정'}</button>`;
            if (canDelete) actions += `<button class="btn-danger" onclick="deleteDocument(${d.id})">삭제</button>`;

            return `<tr>
                <td>${d.subType}</td>
                <td>${dateStr}</td>
                <td>${d.reason || '-'}</td>
                <td>${d.approverName || '-'}</td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td>${actions}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('renderDocList error:', err);
    }
}

// 결재 대기 목록 (관리자) - pending + modification_pending
async function renderApprovalList() {
    try {
        const docs = await api('/api/documents?status=pending');
        const tbody = document.getElementById('approval-pending-list');

        if (docs.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="5">대기 중인 결재가 없습니다.</td></tr>';
            return;
        }

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', employment: '재직증명서' };

        tbody.innerHTML = docs.map(d => {
            let dateStr = d.startDate === d.endDate ? d.startDate : `${d.startDate} ~ ${d.endDate}`;
            // 시간차 휴가: 시간 표기 추가
            if (d.subType === '시간차' && d.startTime && d.endTime) {
                dateStr += ` (${d.startTime}~${d.endTime})`;
            }
            const isMod = d.status === 'modification_pending';
            let modBadge = '';
            if (isMod) {
                const badgeClass = d.modificationType === 'cancel' ? 'mod-badge-cancel' : 'mod-badge-modify';
                const badgeLabel = d.modificationType === 'cancel' ? '취소요청' : '수정요청';
                modBadge = ` <span class="${badgeClass}">${badgeLabel}</span>`;
            }

            let infoHtml = d.reason || '-';
            if (isMod) {
                infoHtml = `<div style="font-size:12px;">${d.modificationReason || '-'}</div>`;
                if (d.modificationType === 'modify') {
                    let newDate = d.newStartDate === d.newEndDate ? d.newStartDate : `${d.newStartDate} ~ ${d.newEndDate}`;
                    if (d.subType === '시간차' && d.newStartTime && d.newEndTime) {
                        newDate += ` (${d.newStartTime}~${d.newEndTime})`;
                    }
                    infoHtml += `<div style="font-size:11px; color:var(--primary); margin-top:2px;">변경: ${newDate}</div>`;
                }
            }

            const approveFunc = isMod ? `approveModification(${d.id})` : `approveDocument(${d.id})`;
            const rejectFunc = isMod ? `rejectModification(${d.id})` : `rejectDocument(${d.id})`;

            return `<tr>
                <td>${typeLabels[d.type] || d.type} - ${d.subType}${modBadge}</td>
                <td>${d.applicantPosition ? d.applicantPosition + ' ' : ''}${d.applicantName}</td>
                <td>${dateStr}</td>
                <td>${infoHtml}</td>
                <td>
                    <button class="btn-approve" onclick="${approveFunc}">승인</button>
                    <button class="btn-reject" onclick="${rejectFunc}">반려</button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('renderApprovalList error:', err);
    }
}

// 내 승인 완료 목록
async function renderMyApprovedList() {
    try {
        const docs = await api('/api/documents?mine=true');
        const approved = docs.filter(d => d.status === 'approved' || d.status === 'modification_pending');
        const tbody = document.getElementById('my-approved-list');

        if (approved.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">승인 완료된 서류가 없습니다.</td></tr>';
            return;
        }

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', employment: '재직증명서' };

        tbody.innerHTML = approved.map(d => {
            let dateStr = d.startDate === d.endDate ? d.startDate : `${d.startDate} ~ ${d.endDate}`;
            if (d.subType === '시간차' && d.startTime && d.endTime) {
                dateStr += ` (${d.startTime}~${d.endTime})`;
            }
            const processedDate = d.processedAt ? new Date(d.processedAt).toLocaleDateString('ko-KR') : '-';

            let statusHtml = '<span class="status-badge status-approved">승인</span>';
            let actionHtml = `<button class="btn-mod-request" onclick="openModRequestModal(${d.id})">수정요청</button>`;
            if (d.status === 'modification_pending') {
                const badgeClass = d.modificationType === 'cancel' ? 'mod-badge-cancel' : 'mod-badge-modify';
                const badgeLabel = d.modificationType === 'cancel' ? '취소대기' : '수정대기';
                statusHtml = `<span class="${badgeClass}">${badgeLabel}</span>`;
                actionHtml = '<span style="font-size:12px; color:var(--text-light);">대기중</span>';
            }

            return `<tr>
                <td>${typeLabels[d.type] || d.type} - ${d.subType}</td>
                <td>${dateStr}</td>
                <td>${d.reason || '-'}</td>
                <td>${processedDate}</td>
                <td>${statusHtml}</td>
                <td>${actionHtml}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('renderMyApprovedList error:', err);
    }
}

// 서류 삭제
window.deleteDocument = async function(id) {
    if (!confirm('정말 삭제하시겠습니까?\n연차가 차감된 경우 자동 복구됩니다.')) return;
    try {
        await api(`/api/documents/${id}`, 'DELETE');
        const me = await api('/api/auth/me');
        currentUser = me;
        localStorage.setItem('jwt_user', JSON.stringify(me));
        document.getElementById('annual-leave-count').textContent = formatLeave(me.annualLeave);
        await renderDocList();
        if (currentUser.role === 'admin') await renderApprovalList();
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};

// 서류 수정 모달
window.openEditDocument = async function(id) {
    try {
        const docs = await api(`/api/documents?type=${currentDocType}&mine=true`);
        const doc = docs.find(d => d.id === id);
        if (!doc) {
            // 관리자가 다른 사람 서류 수정 시
            const allDocs = await api('/api/documents');
            const found = allDocs.find(d => d.id === id);
            if (!found) return alert('서류를 찾을 수 없습니다.');
            showEditDocModal(found);
        } else {
            showEditDocModal(doc);
        }
    } catch (err) {
        alert('서류 정보 로드 실패: ' + err.message);
    }
};

async function showEditDocModal(doc) {
    const approvers = await api('/api/users/approvers');
    const editApprover = approvers.length > 0 ? approvers[0] : null;

    const typeMap = {
        vacation: { label: '휴가종류', options: ['연차','시간차','병가'] },
        attendance: { label: '종류', options: ['휴직','예비군','병가','기타'] },
        reason: { label: '종류', options: ['지각','미출근','조퇴','기타'] }
    };
    const typeInfo = typeMap[doc.type] || { label: '종류', options: [doc.subType] };

    const showEndDate = doc.type === 'vacation' && (doc.subType === '연차' || doc.subType === '병가' || doc.subType === '시간차');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'edit-doc-modal';
    overlay.innerHTML = `
        <div class="modal" style="max-width:480px;">
            <button class="modal-close" onclick="closeEditDocModal()">&times;</button>
            <h3>${doc.status === 'rejected' ? '서류 재제출' : '서류 수정'}</h3>
            <div class="form-group">
                <label>${typeInfo.label}</label>
                <div class="btn-group" id="edit-doc-subtype-group">
                    ${typeInfo.options.map(o => `<button class="btn-toggle ${o === doc.subType ? 'active' : ''}" data-value="${o}" onclick="selectEditSubType(this)">${o}</button>`).join('')}
                </div>
            </div>
            <div class="form-row" style="gap:12px;">
                <div class="form-group">
                    <label>시작일</label>
                    <input type="date" id="edit-doc-start" class="form-input" value="${doc.startDate}">
                </div>
                <div class="form-group" id="edit-doc-end-group" style="${showEndDate ? '' : 'display:none;'}">
                    <label>종료일</label>
                    <input type="date" id="edit-doc-end" class="form-input" value="${doc.endDate || doc.startDate}">
                </div>
            </div>
            <div class="form-group">
                <label>사유</label>
                <textarea id="edit-doc-reason" class="form-input" rows="3">${doc.reason || ''}</textarea>
            </div>
            <div class="form-group">
                <label>결재라인</label>
                <div class="expense-approval-line" id="edit-doc-approval-line">
                    <div class="expense-approval-step">
                        <span class="step-label">신청자</span>
                        <span class="step-name">${currentUser.name}</span>
                        <span class="step-position">${currentUser.position || ''}</span>
                    </div>
                    ${editApprover ? `<span class="expense-approval-arrow">→</span>
                    <div class="expense-approval-step">
                        <span class="step-label">결재</span>
                        <span class="step-name">${editApprover.name}</span>
                        <span class="step-position">${editApprover.position || ''}</span>
                    </div>` : ''}
                </div>
            </div>
            <button class="btn-primary" style="width:100%;" onclick="submitEditDocument(${doc.id}, '${doc.type}')">${doc.status === 'rejected' ? '재제출' : '수정 저장'}</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEditDocModal(); });

    // 종류 변경 시 종료일 표시 토글 (휴가만)
    if (doc.type === 'vacation') {
        updateEditEndDateVisibility();
    }
}

window.selectEditSubType = function(btn) {
    btn.parentElement.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateEditEndDateVisibility();
};

function updateEditEndDateVisibility() {
    const activeBtn = document.querySelector('#edit-doc-subtype-group .btn-toggle.active');
    const endGroup = document.getElementById('edit-doc-end-group');
    if (activeBtn && endGroup) {
        const val = activeBtn.dataset.value;
        endGroup.style.display = (val === '연차' || val === '병가' || val === '시간차') ? '' : 'none';
    }
}

window.closeEditDocModal = function() {
    const modal = document.getElementById('edit-doc-modal');
    if (modal) modal.remove();
};

window.submitEditDocument = async function(id, type) {
    const subType = document.querySelector('#edit-doc-subtype-group .btn-toggle.active')?.dataset.value;
    const startDate = document.getElementById('edit-doc-start').value;
    const endDate = document.getElementById('edit-doc-end').value || startDate;
    const reason = document.getElementById('edit-doc-reason').value;
    const editApprovers = await api('/api/users/approvers');
    const approverId = editApprovers.length > 0 ? editApprovers[0].id : null;

    if (!startDate) return alert('시작일을 입력하세요.');
    if (!approverId) return alert('결재자 정보를 불러올 수 없습니다.');

    try {
        await api(`/api/documents/${id}`, 'PUT', { subType, startDate, endDate, reason, approverId: Number(approverId) });
        closeEditDocModal();
        const me = await api('/api/auth/me');
        currentUser = me;
        localStorage.setItem('jwt_user', JSON.stringify(me));
        document.getElementById('annual-leave-count').textContent = formatLeave(me.annualLeave);
        await renderDocList();
        if (currentUser.role === 'admin') await renderApprovalList();
        alert(type === 'rejected' ? '재제출되었습니다.' : '수정되었습니다.');
    } catch (err) {
        alert('수정 실패: ' + err.message);
    }
};

// 수정요청 모달
window.openModRequestModal = function(id) {
    const docs = [];
    // mine 데이터에서 찾기
    const tbody = document.getElementById('my-approved-list');
    // API에서 다시 가져옴
    api('/api/documents?mine=true').then(allDocs => {
        const doc = allDocs.find(d => d.id === id);
        if (!doc) return alert('서류를 찾을 수 없습니다.');

        document.getElementById('mod-doc-id').value = id;
        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', employment: '재직증명서' };
        let dateStr = doc.startDate === doc.endDate ? doc.startDate : `${doc.startDate} ~ ${doc.endDate}`;
        if (doc.subType === '시간차' && doc.startTime && doc.endTime) dateStr += ` (${doc.startTime}~${doc.endTime})`;

        document.getElementById('mod-original-info').innerHTML =
            `<strong>기존 내용</strong><br>유형: ${typeLabels[doc.type] || doc.type} - ${doc.subType}<br>기간: ${dateStr}<br>사유: ${doc.reason || '-'}`;

        document.getElementById('mod-start-date').value = doc.startDate;
        document.getElementById('mod-end-date').value = doc.endDate;
        document.getElementById('mod-start-time').value = doc.startTime || '';
        document.getElementById('mod-end-time').value = doc.endTime || '';
        document.getElementById('mod-reason').value = '';
        document.querySelector('input[name="mod-type"][value="modify"]').checked = true;

        // 시간차면 시간 필드 표시
        document.getElementById('mod-time-fields').style.display = doc.subType === '시간차' ? '' : 'none';
        document.getElementById('mod-date-fields').style.display = '';

        document.getElementById('mod-request-modal').style.display = '';
    });
};

window.toggleModFields = function() {
    const type = document.querySelector('input[name="mod-type"]:checked').value;
    document.getElementById('mod-date-fields').style.display = type === 'modify' ? '' : 'none';
};

window.submitModRequest = async function() {
    const id = document.getElementById('mod-doc-id').value;
    const modificationType = document.querySelector('input[name="mod-type"]:checked').value;
    const modificationReason = document.getElementById('mod-reason').value.trim();
    if (!modificationReason) { alert('사유를 입력해주세요.'); return; }

    const body = { modification_type: modificationType, modification_reason: modificationReason };
    if (modificationType === 'modify') {
        body.new_start_date = document.getElementById('mod-start-date').value;
        body.new_end_date = document.getElementById('mod-end-date').value;
        body.new_start_time = document.getElementById('mod-start-time').value || null;
        body.new_end_time = document.getElementById('mod-end-time').value || null;
    }

    try {
        await api(`/api/documents/${id}/request-modification`, 'PUT', body);
        document.getElementById('mod-request-modal').style.display = 'none';
        await renderMyApprovedList();
        if (currentUser.role === 'admin') await renderApprovalList();
        alert('수정 요청이 제출되었습니다.');
    } catch (err) { alert('요청 실패: ' + err.message); }
};

// 수정 요청 승인/반려
window.approveModification = async function(id) {
    if (!confirm('수정/취소 요청을 승인하시겠습니까?')) return;
    try {
        await api(`/api/documents/${id}/approve-modification`, 'PUT');
        await renderApprovalList();
        await renderMyApprovedList();
        await renderDocList();
        const me = await api('/api/auth/me');
        currentUser = me;
        localStorage.setItem('jwt_user', JSON.stringify(me));
        document.getElementById('annual-leave-count').textContent = formatLeave(me.annualLeave);
        alert('수정 요청이 승인되었습니다.');
    } catch (err) { alert('승인 실패: ' + err.message); }
};

window.rejectModification = async function(id) {
    if (!confirm('수정/취소 요청을 반려하시겠습니까?\n기존 승인 내용이 유지됩니다.')) return;
    try {
        await api(`/api/documents/${id}/reject-modification`, 'PUT');
        await renderApprovalList();
        await renderMyApprovedList();
        alert('수정 요청이 반려되었습니다. 기존 승인 내용이 유지됩니다.');
    } catch (err) { alert('반려 실패: ' + err.message); }
};

// 결재 승인
window.approveDocument = async function(id) {
    if (!confirm('승인하시겠습니까?')) return;
    try {
        await api(`/api/documents/${id}/approve`, 'PUT');
        await renderApprovalList();
        await renderDocList();
        alert('승인되었습니다.');
    } catch (err) {
        alert('승인 실패: ' + err.message);
    }
};

// 결재 반려
window.rejectDocument = async function(id) {
    if (!confirm('반려하시겠습니까?\n연차가 차감된 경우 복구됩니다.')) return;
    try {
        await api(`/api/documents/${id}/reject`, 'PUT');
        await renderApprovalList();
        await renderDocList();
        const me = await api('/api/auth/me');
        currentUser = me;
        localStorage.setItem('jwt_user', JSON.stringify(me));
        document.getElementById('annual-leave-count').textContent = formatLeave(me.annualLeave);
        alert('반려되었습니다.');
    } catch (err) {
        alert('반려 실패: ' + err.message);
    }
};

// =============================================
// 승인 이력 (관리자 전용)
// =============================================

async function loadHistoryFilters() {
    try {
        const users = await api('/api/users');
        const select = document.getElementById('history-employee');
        select.innerHTML = '<option value="">전체</option>' +
            users.map(u =>
                `<option value="${u.id}">${u.position ? u.position + ' ' : ''}${u.name}</option>`
            ).join('');
    } catch (err) {
        console.error('loadHistoryFilters error:', err);
    }
}

let selectedLeaveEmpId = null;

async function renderLeaveSummary() {
    try {
        const data = await api('/api/users/leave-summary');
        const grid = document.getElementById('leave-summary-grid');

        if (data.length === 0) {
            grid.innerHTML = '<p style="color:var(--text-light);">직원 데이터가 없습니다.</p>';
            return;
        }

        grid.innerHTML = data.map(emp => {
            const total = emp.annualLeave + emp.usedLeave + emp.pendingLeave;
            const isSelected = selectedLeaveEmpId === emp.id;
            return `
                <div class="leave-summary-card ${isSelected ? 'selected' : ''}" onclick="clickLeaveCard(${emp.id})" style="cursor:pointer;">
                    <div class="emp-name">${emp.name}</div>
                    <div class="emp-position">${emp.position || ''}</div>
                    <div class="leave-numbers">
                        <div>총<span class="num">${formatLeave(total)}</span></div>
                        <div>사용<span class="num used">${formatLeave(emp.usedLeave)}</span></div>
                        <div>잔여<span class="num remaining">${formatLeave(emp.annualLeave)}</span></div>
                        <div>대기<span class="num pending">${formatLeave(emp.pendingLeave)}</span></div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('renderLeaveSummary error:', err);
    }
}

window.clickLeaveCard = function(empId) {
    if (selectedLeaveEmpId === empId) {
        // 같은 카드 다시 클릭 → 해제 (전체 보기)
        selectedLeaveEmpId = null;
        document.getElementById('history-employee').value = '';
    } else {
        selectedLeaveEmpId = empId;
        document.getElementById('history-employee').value = empId;
    }
    // 카드 선택 상태 업데이트
    document.querySelectorAll('.leave-summary-card').forEach(card => {
        card.classList.toggle('selected', card.onclick.toString().includes(selectedLeaveEmpId));
    });
    renderLeaveSummary();
    searchDocHistory();
};

window.searchDocHistory = async function() {
    try {
        const employeeId = document.getElementById('history-employee').value;
        const startDate = document.getElementById('history-start-date').value;
        const endDate = document.getElementById('history-end-date').value;
        const type = document.getElementById('history-type').value;

        let url = '/api/documents/history?';
        const params = [];
        if (employeeId) params.push(`employeeId=${employeeId}`);
        if (startDate) params.push(`startDate=${startDate}`);
        if (endDate) params.push(`endDate=${endDate}`);
        if (type) params.push(`type=${type}`);
        url += params.join('&');

        const docs = await api(url);
        renderDocHistory(docs);
    } catch (err) {
        console.error('searchDocHistory error:', err);
    }
};

function renderDocHistory(docs) {
    window._lastDocHistory = docs || [];
    const tbody = document.getElementById('doc-history-list');
    const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', employment: '재직증명서', leave_adjustment: '연차 조정' };

    if (!docs || docs.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="9">검색 결과가 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = docs.map(d => {
        // 연차 조정 타입 특별 처리
        if (d.isLeaveAdjustment || d.type === 'leave_adjustment') {
            const adj = d.deductedLeave;
            const adjSign = adj > 0 ? '+' : '';
            const processedDate = d.processedAt ? new Date(d.processedAt).toLocaleDateString('ko-KR') : '-';
            return `<tr>
                <td>연차 조정 ${adjSign}${adj}일</td>
                <td>${d.applicantPosition ? d.applicantPosition + ' ' : ''}${d.applicantName}</td>
                <td>-</td>
                <td>${d.reason || '-'}</td>
                <td>${adjSign}${adj}일</td>
                <td>${d.approverName || '-'}</td>
                <td><span class="status-badge status-approved">완료</span></td>
                <td>${processedDate}</td>
                <td></td>
            </tr>`;
        }

        const statusClass = d.status === 'approved' ? 'status-approved' : 'status-rejected';
        const statusLabel = d.status === 'approved' ? '승인' : '반려';
        const sd = d.startDate ? new Date(d.startDate).toLocaleDateString('ko-KR') : '';
        const ed = d.endDate ? new Date(d.endDate).toLocaleDateString('ko-KR') : '';
        let dateStr = sd === ed || !ed ? sd : `${sd} ~ ${ed}`;
        if (d.subType === '시간차' && d.startTime && d.endTime) {
            dateStr += ` (${d.startTime}~${d.endTime})`;
        }
        const processedDate = d.processedAt ? new Date(d.processedAt).toLocaleDateString('ko-KR') : '-';
        const deducted = formatDeductedLeave(d);

        return `<tr>
            <td>${typeLabels[d.type] || d.type} - ${d.subType}</td>
            <td>${d.applicantPosition ? d.applicantPosition + ' ' : ''}${d.applicantName}</td>
            <td>${dateStr}</td>
            <td>${d.reason || '-'}</td>
            <td>${deducted}</td>
            <td>${d.approverName || '-'}</td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td>${processedDate}</td>
            <td>
                <button class="btn-view-items" onclick="viewDocDetail(${d.id})">상세</button>
                ${currentUser.position === '대표' ? `<button class="btn-view-items" onclick="deleteDocHistory(${d.id})" style="color:#dc2626; margin-left:4px;">삭제</button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

// 승인이력 삭제 (대표 전용)
window.deleteDocHistory = async function(id) {
    if (!confirm('이 승인 이력을 삭제하시겠습니까?\n차감된 연차도 복구됩니다.')) return;
    try {
        await api(`/api/documents/${id}`, 'DELETE');
        showToast('이력이 삭제되었습니다');
        searchDocHistory();
        renderLeaveSummary();
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};

// 기안서류 개별 상세 모달
window.viewDocDetail = async function(id) {
    try {
        const docs = await api('/api/documents/history?');
        const d = docs.find(doc => doc.id === id);
        if (!d) { alert('문서를 찾을 수 없습니다.'); return; }

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', employment: '재직증명서' };
        const typeLabel = `${typeLabels[d.type] || d.type} - ${d.subType}`;

        // 날짜 포맷
        const sd = d.startDate ? new Date(d.startDate).toLocaleDateString('ko-KR') : '';
        const ed = d.endDate ? new Date(d.endDate).toLocaleDateString('ko-KR') : '';
        let dateStr = sd === ed || !ed ? sd : `${sd} ~ ${ed}`;
        if (d.subType === '시간차' && d.startTime && d.endTime) dateStr += ` (${d.startTime}~${d.endTime})`;

        const deducted = formatDeductedLeave(d);

        const statusClass = d.status === 'approved' ? 'status-approved' : 'status-rejected';
        const statusLabel = d.status === 'approved' ? '승인' : '반려';
        const processedDate = d.processedAt ? new Date(d.processedAt).toLocaleDateString('ko-KR') : '-';

        // 결재란 도장 이미지 조회
        const sigIds = [d.applicantId];
        if (d.approverId) sigIds.push(d.approverId);
        const sigResults = await Promise.all(
            [...new Set(sigIds)].map(uid => api(`/api/users/${uid}/signature`).catch(() => ({ signatureImage: null })))
        );
        const sigMap = {};
        [...new Set(sigIds)].forEach((uid, i) => { sigMap[uid] = sigResults[i].signatureImage; });

        function stampBox(label, userId, name, isApproved, fallbackText) {
            const sig = sigMap[userId];
            let stampContent;
            if (isApproved && sig) stampContent = `<img src="${sig}" style="width:45px;height:45px;object-fit:contain;" alt="도장">`;
            else if (isApproved) stampContent = `<div class="stamp-area approved">${fallbackText}</div>`;
            else stampContent = `<div class="stamp-area">${fallbackText}</div>`;
            return `<div class="expense-stamp-box"><div class="stamp-label">${label}</div>${stampContent}<div class="stamp-name">${name}</div></div>`;
        }

        const approvalHtml = `<div class="expense-detail-approval">
            ${stampBox('신청자', d.applicantId, `${d.applicantPosition || ''} ${d.applicantName}`, true, '신청')}
            ${d.approverId ? stampBox('결재', d.approverId, d.approverName || '', d.status === 'approved', statusLabel) : ''}
        </div>`;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="max-width:520px;">
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                <h3 style="text-align:center;margin-bottom:12px;">기안서류 상세</h3>
                ${approvalHtml}
                <div style="margin:16px 0;line-height:2;">
                    <div><strong>유형:</strong> ${typeLabel}</div>
                    <div><strong>신청자:</strong> ${d.applicantPosition ? d.applicantPosition + ' ' : ''}${d.applicantName}</div>
                    <div><strong>기간:</strong> ${dateStr}</div>
                    <div><strong>사유:</strong> ${d.reason || '-'}</div>
                    <div><strong>차감일수:</strong> ${deducted}</div>
                    <div><strong>상태:</strong> <span class="status-badge ${statusClass}">${statusLabel}</span></div>
                    <div><strong>처리일:</strong> ${processedDate}</div>
                </div>
                <div style="display:flex;justify-content:center;gap:8px;margin-top:16px;">
                    <button class="btn-primary" onclick="downloadDocPDF(${d.id})" style="padding:8px 16px;">PDF 다운로드</button>
                    <button class="btn-secondary" onclick="downloadDocExcel(${d.id})" style="padding:8px 16px;">엑셀 다운로드</button>
                    <button class="btn-outline" onclick="this.closest('.modal-overlay').remove()" style="padding:8px 16px;">닫기</button>
                </div>
            </div>
        `;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    } catch (err) { alert('상세 조회 실패: ' + err.message); }
};

// 재직증명서 전용 PDF 양식 (표준 양식)
async function renderEmploymentCertPDF(d) {
    // 발급일자: 처리일 우선, 없으면 오늘
    const issueDate = d.processedAt ? new Date(d.processedAt) : new Date();
    const issueDateStr = `${issueDate.getFullYear()}년 ${String(issueDate.getMonth() + 1).padStart(2, '0')}월 ${String(issueDate.getDate()).padStart(2, '0')}일`;

    // 발급 매수 파싱 (reason에 "발급 매수: N부"로 저장됨)
    const countMatch = (d.reason || '').match(/(\d+)\s*부/);
    const issueCount = countMatch ? countMatch[1] : '1';
    const purpose = d.subType || '-';

    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:50px 60px;box-sizing:border-box;font-family:"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo",sans-serif;color:#000;';
    container.innerHTML = `
        <div style="min-height:1000px;position:relative;padding:30px 0;">
            <h1 style="text-align:center;font-size:34px;letter-spacing:18px;margin:30px 0 60px 0;font-weight:bold;">재 직 증 명 서</h1>

            <table style="width:100%;border-collapse:collapse;border-top:2px solid #000;border-bottom:2px solid #000;margin-bottom:50px;font-size:16px;">
                <tr style="border-bottom:1px solid #999;">
                    <td style="width:140px;padding:14px 18px;background:#f5f5f5;font-weight:bold;text-align:center;border-right:1px solid #999;">성       명</td>
                    <td style="padding:14px 20px;">${d.applicantName || ''}</td>
                </tr>
                <tr style="border-bottom:1px solid #999;">
                    <td style="padding:14px 18px;background:#f5f5f5;font-weight:bold;text-align:center;border-right:1px solid #999;">소       속</td>
                    <td style="padding:14px 20px;">제주아꼼이네 농업회사법인(주)</td>
                </tr>
                <tr style="border-bottom:1px solid #999;">
                    <td style="padding:14px 18px;background:#f5f5f5;font-weight:bold;text-align:center;border-right:1px solid #999;">직       급</td>
                    <td style="padding:14px 20px;">${d.applicantPosition || '-'}</td>
                </tr>
                <tr style="border-bottom:1px solid #999;">
                    <td style="padding:14px 18px;background:#f5f5f5;font-weight:bold;text-align:center;border-right:1px solid #999;">발 급 용 도</td>
                    <td style="padding:14px 20px;">${purpose}</td>
                </tr>
                <tr>
                    <td style="padding:14px 18px;background:#f5f5f5;font-weight:bold;text-align:center;border-right:1px solid #999;">발 급 매 수</td>
                    <td style="padding:14px 20px;">${issueCount} 부</td>
                </tr>
            </table>

            <p style="font-size:17px;line-height:2;margin:40px 0;text-align:center;">위 사람은 본사에 위와 같이 재직 중임을 증명합니다.</p>

            <p style="font-size:18px;text-align:center;margin-top:80px;letter-spacing:2px;">${issueDateStr}</p>

            <div style="margin-top:80px;text-align:center;font-size:22px;font-weight:bold;letter-spacing:3px;display:flex;align-items:center;justify-content:center;gap:24px;">
                <span>제주아꼼이네 농업회사법인(주)</span>
                <span style="display:inline-flex;align-items:center;justify-content:center;width:95px;height:95px;border:1.5px dashed #9ca3af;border-radius:50%;background:#fff;color:#9ca3af;font-size:13px;font-weight:normal;letter-spacing:1px;">
                    (법인인감)
                </span>
            </div>

            <div style="position:absolute;bottom:0;left:0;right:0;text-align:center;color:#9ca3af;font-size:11px;padding-top:30px;border-top:1px solid #e5e7eb;margin-top:60px;">
                ※ 법인 인감도장 직인은 따로 법인직인대장에 기록 후 사용
            </div>
        </div>
    `;
    document.body.appendChild(container);

    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    document.body.removeChild(container);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgData = canvas.toDataURL('image/png');
    const pdfW = 210;
    const pdfH = (canvas.height * pdfW) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);

    const dateForFile = `${issueDate.getFullYear()}${String(issueDate.getMonth() + 1).padStart(2, '0')}${String(issueDate.getDate()).padStart(2, '0')}`;
    pdf.save(`재직증명서_${d.applicantName}_${dateForFile}.pdf`);
}

// 기안서류 개별 PDF 다운로드
window.downloadDocPDF = async function(id) {
    try {
        const docs = await api('/api/documents/history?');
        const d = docs.find(doc => doc.id === id);
        if (!d) { alert('문서를 찾을 수 없습니다.'); return; }

        // 재직증명서: 표준 양식으로 별도 처리
        if (d.type === 'employment') {
            await renderEmploymentCertPDF(d);
            return;
        }

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', employment: '재직증명서' };
        const docTitle = d.type === 'vacation' ? '휴가신청서' : d.type === 'attendance' ? '근태신청서' : '시말서';

        // 날짜 포맷
        const sd = d.startDate ? new Date(d.startDate) : null;
        const ed = d.endDate ? new Date(d.endDate) : null;
        let dateStr = '';
        if (sd) {
            dateStr = `${sd.getFullYear()}년 ${sd.getMonth() + 1}월 ${sd.getDate()}일`;
            if (ed && sd.getTime() !== ed.getTime()) dateStr += ` ~ ${ed.getFullYear()}년 ${ed.getMonth() + 1}월 ${ed.getDate()}일`;
            if (d.subType === '시간차' && d.startTime && d.endTime) dateStr += ` ${d.startTime} ~ ${d.endTime}`;
        }

        const deducted = formatDeductedLeave(d);

        const statusLabel = d.status === 'approved' ? '승인' : '반려';
        const processedDate = d.processedAt ? new Date(d.processedAt) : null;
        const processedStr = processedDate ? `${processedDate.getFullYear()}년 ${processedDate.getMonth() + 1}월 ${processedDate.getDate()}일` : '-';

        // 도장 이미지 조회
        const stamps = [];
        const sigIds = [d.applicantId];
        stamps.push({ label: '신청자', name: `${d.applicantPosition || ''} ${d.applicantName}`, status: '신청', userId: d.applicantId });
        if (d.approverId) {
            stamps.push({ label: '결재자', name: d.approverName || '', status: d.status === 'approved' ? '승인' : (d.status === 'rejected' ? '반려' : ''), userId: d.approverId });
            sigIds.push(d.approverId);
        }
        const sigResults = await Promise.all(
            [...new Set(sigIds)].map(uid => api(`/api/users/${uid}/signature`).catch(() => ({ signatureImage: null })))
        );
        const sigMap = {};
        [...new Set(sigIds)].forEach((uid, i) => { sigMap[uid] = sigResults[i].signatureImage; });

        const stampHtml = stamps.map(s => {
            const sig = sigMap[s.userId];
            let stampContent;
            if (s.status && sig) stampContent = `<img src="${sig}" style="width:50px;height:50px;object-fit:contain;" alt="도장">`;
            else if (s.status) stampContent = `<span style="font-size:16px;font-weight:bold;color:#dc2626;">${s.status}</span>`;
            else stampContent = '';
            return `<td style="width:90px;border:1px solid #000;padding:0;text-align:center;vertical-align:top;">
                <div style="background:#f3f4f6;padding:4px;font-size:12px;font-weight:bold;border-bottom:1px solid #000;">${s.label}</div>
                <div style="height:55px;display:flex;align-items:center;justify-content:center;">${stampContent}</div>
                <div style="padding:4px;font-size:12px;border-top:1px solid #000;background:#f9fafb;">${s.name}</div></td>`;
        }).join('');

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:40px;box-sizing:border-box;font-family:"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo",sans-serif;';
        container.innerHTML = `
            <div style="border:2px solid #000;padding:30px;min-height:1050px;position:relative;">
                <h1 style="text-align:center;font-size:26px;letter-spacing:12px;margin:0 0 20px 0;">${docTitle}</h1>
                <table style="border-collapse:collapse;margin-left:auto;margin-bottom:24px;">
                    <tr>${stampHtml}</tr>
                </table>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                    <tr><td style="padding:10px 0;font-weight:bold;width:100px;border-bottom:1px solid #ddd;">유형</td><td style="padding:10px 0;border-bottom:1px solid #ddd;">${typeLabels[d.type] || d.type} - ${d.subType}</td></tr>
                    <tr><td style="padding:10px 0;font-weight:bold;border-bottom:1px solid #ddd;">신청자</td><td style="padding:10px 0;border-bottom:1px solid #ddd;">${d.applicantPosition ? d.applicantPosition + ' ' : ''}${d.applicantName}</td></tr>
                    <tr><td style="padding:10px 0;font-weight:bold;border-bottom:1px solid #ddd;">기간</td><td style="padding:10px 0;border-bottom:1px solid #ddd;">${dateStr}</td></tr>
                    <tr><td style="padding:10px 0;font-weight:bold;border-bottom:1px solid #ddd;">사유</td><td style="padding:10px 0;border-bottom:1px solid #ddd;">${d.reason || '-'}</td></tr>
                    <tr><td style="padding:10px 0;font-weight:bold;border-bottom:1px solid #ddd;">차감일수</td><td style="padding:10px 0;border-bottom:1px solid #ddd;">${deducted}</td></tr>
                    <tr><td style="padding:10px 0;font-weight:bold;border-bottom:1px solid #ddd;">상태</td><td style="padding:10px 0;border-bottom:1px solid #ddd;">${statusLabel}</td></tr>
                    <tr><td style="padding:10px 0;font-weight:bold;">처리일</td><td style="padding:10px 0;">${processedStr}</td></tr>
                </table>
                <div style="position:absolute;bottom:20px;left:0;right:0;text-align:center;color:#6b7280;font-size:14px;">제주아꼼이네 농업회사법인(주)</div>
            </div>
        `;
        document.body.appendChild(container);

        const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        document.body.removeChild(container);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgData = canvas.toDataURL('image/png');
        const pdfW = 210;
        const pdfH = (canvas.height * pdfW) / canvas.width;
        pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);

        const dateForFile = d.startDate ? d.startDate.replace(/-/g, '').slice(0, 8) : '';
        pdf.save(`${docTitle}_${d.applicantName}_${d.subType}_${dateForFile}.pdf`);
    } catch (err) { alert('PDF 다운로드 실패: ' + err.message); }
};

// 기안서류 개별 엑셀 다운로드
window.downloadDocExcel = function(id) {
    try {
        const docs = window._lastDocHistory || [];
        const d = docs.find(doc => doc.id === id);
        if (!d) { alert('문서를 찾을 수 없습니다.'); return; }

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', employment: '재직증명서' };
        const typeLabel = `${typeLabels[d.type] || d.type} - ${d.subType}`;
        const docTitle = d.type === 'vacation' ? '휴가신청서' : d.type === 'attendance' ? '근태신청서' : d.type === 'employment' ? '재직증명서' : '시말서';

        const sd = d.startDate ? new Date(d.startDate).toLocaleDateString('ko-KR') : '';
        const ed = d.endDate ? new Date(d.endDate).toLocaleDateString('ko-KR') : '';
        let dateStr = sd === ed || !ed ? sd : `${sd} ~ ${ed}`;
        if (d.subType === '시간차' && d.startTime && d.endTime) dateStr += ` (${d.startTime}~${d.endTime})`;

        const deducted = formatDeductedLeave(d);

        const statusLabel = d.status === 'approved' ? '승인' : '반려';
        const processedDate = d.processedAt ? new Date(d.processedAt).toLocaleDateString('ko-KR') : '-';

        const rows = [
            [docTitle],
            [],
            ['항목', '내용'],
            ['유형', typeLabel],
            ['신청자', `${d.applicantPosition ? d.applicantPosition + ' ' : ''}${d.applicantName}`],
            ['기간', dateStr],
            ['사유', d.reason || '-'],
            ['차감일수', deducted],
            ['결재자', d.approverName || '-'],
            ['상태', statusLabel],
            ['처리일', processedDate]
        ];

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
        ws['!cols'] = [{ wch: 14 }, { wch: 36 }];
        XLSX.utils.book_append_sheet(wb, ws, docTitle);

        const dateForFile = d.startDate ? d.startDate.replace(/-/g, '').slice(0, 8) : '';
        XLSX.writeFile(wb, `기안서류_${d.applicantName}_${d.subType}_${dateForFile}.xlsx`);
    } catch (err) { alert('엑셀 다운로드 실패: ' + err.message); }
};

// 기안서류 승인이력 엑셀 다운로드
// 직원별 연차 현황 다운로드
window.downloadLeaveSummary = async function() {
    if (currentUser?.role !== 'admin') { alert('관리자만 다운로드할 수 있습니다.'); return; }
    try {
        const leaveData = await api('/api/users/leave-summary');
        const now = new Date();
        const monthLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;
        const leaveRows = [
            [`직원별 연차 현황 (${monthLabel} 기준)`],
            [],
            ['이름', '직급', '총', '사용', '잔여', '대기']
        ];
        leaveData.forEach(emp => {
            const total = emp.annualLeave + emp.usedLeave + emp.pendingLeave;
            leaveRows.push([emp.name, emp.position || '', formatLeave(total), formatLeave(emp.usedLeave), formatLeave(emp.annualLeave), formatLeave(emp.pendingLeave)]);
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(leaveRows);
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
        ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 10 }];
        if (ws['A1']) ws['A1'].s = { font: { bold: true, sz: 14 }, alignment: { horizontal: 'center' } };
        ['A3','B3','C3','D3','E3','F3'].forEach(cell => {
            if (ws[cell]) ws[cell].s = { font: { bold: true }, fill: { fgColor: { rgb: 'F3F4F6' } }, alignment: { horizontal: 'center' } };
        });
        XLSX.utils.book_append_sheet(wb, ws, '직원별 연차 현황');
        XLSX.writeFile(wb, `직원별_연차현황_${now.getFullYear()}년${now.getMonth() + 1}월.xlsx`);
    } catch (err) { alert('다운로드 실패: ' + err.message); }
};

// 승인/반려 이력 다운로드
window.downloadDocHistory = async function() {
    if (currentUser?.role !== 'admin') { alert('관리자만 다운로드할 수 있습니다.'); return; }
    try {
        const employeeId = document.getElementById('history-employee').value;
        const startDate = document.getElementById('history-start-date').value;
        const endDate = document.getElementById('history-end-date').value;
        const type = document.getElementById('history-type').value;
        let url = '/api/documents/history?';
        const params = [];
        if (employeeId) params.push(`employeeId=${employeeId}`);
        if (startDate) params.push(`startDate=${startDate}`);
        if (endDate) params.push(`endDate=${endDate}`);
        if (type) params.push(`type=${type}`);
        url += params.join('&');
        const [docs, leaveData] = await Promise.all([api(url), api('/api/users/leave-summary')]);
        // 직원별 잔여연차 맵 (id → annualLeave)
        const leaveMap = {};
        leaveData.forEach(emp => { leaveMap[emp.id] = emp.annualLeave; });
        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', employment: '재직증명서', leave_adjustment: '연차 조정' };
        const historyRows = [['유형', '신청자', '기간/날짜', '사유', '차감일수', '잔여연차', '결재자', '상태', '처리일']];
        docs.forEach(d => {
            const remainLeave = leaveMap[d.applicantId] !== undefined ? formatLeave(leaveMap[d.applicantId]) : '';
            // 연차 조정 타입 특별 처리
            if (d.isLeaveAdjustment || d.type === 'leave_adjustment') {
                const adj = d.deductedLeave;
                const adjSign = adj > 0 ? '+' : '';
                const processedDate = d.processedAt ? new Date(d.processedAt).toLocaleDateString('ko-KR') : '';
                historyRows.push([
                    `연차 조정 ${adjSign}${adj}일`,
                    `${d.applicantPosition ? d.applicantPosition + ' ' : ''}${d.applicantName}`,
                    '-', d.reason || '', `${adjSign}${adj}일`, remainLeave, d.approverName || '', '완료', processedDate
                ]);
                return;
            }
            const sd = d.startDate ? new Date(d.startDate).toLocaleDateString('ko-KR') : '';
            const ed = d.endDate ? new Date(d.endDate).toLocaleDateString('ko-KR') : '';
            let dateStr = sd === ed || !ed ? sd : `${sd} ~ ${ed}`;
            if (d.subType === '시간차' && d.startTime && d.endTime) dateStr += ` (${d.startTime}~${d.endTime})`;
            const processedDate = d.processedAt ? new Date(d.processedAt).toLocaleDateString('ko-KR') : '';
            const deducted = formatDeductedLeave(d) === '-' ? '' : formatDeductedLeave(d);
            historyRows.push([
                `${typeLabels[d.type] || d.type} - ${d.subType}`,
                `${d.applicantPosition ? d.applicantPosition + ' ' : ''}${d.applicantName}`,
                dateStr, d.reason || '', deducted, remainLeave, d.approverName || '',
                d.status === 'approved' ? '승인' : '반려', processedDate
            ]);
        });
        const now = new Date();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(historyRows);
        ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 14 }];
        ['A1','B1','C1','D1','E1','F1','G1','H1','I1'].forEach(cell => {
            if (ws[cell]) ws[cell].s = { font: { bold: true }, fill: { fgColor: { rgb: 'F3F4F6' } }, alignment: { horizontal: 'center' } };
        });
        XLSX.utils.book_append_sheet(wb, ws, '승인반려 이력');
        XLSX.writeFile(wb, `승인반려_이력_${now.getFullYear()}년${now.getMonth() + 1}월.xlsx`);
    } catch (err) { alert('다운로드 실패: ' + err.message); }
};

// =============================================
// 연차 조정 내역 (부장 전용 등록/삭제, 관리자 조회)
// =============================================

async function loadLeaveAdjustments() {
    const section = document.getElementById('leave-adjustment-section');
    if (!section) return;
    if (currentUser?.role !== 'admin') {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';

    // 관리자만 연차 조정 버튼 표시
    const addBtn = document.getElementById('btn-add-leave-adj');
    if (addBtn) {
        addBtn.style.display = (currentUser.role === 'admin') ? '' : 'none';
    }

    try {
        const data = await api('/api/leave-adjustments');
        const tbody = document.getElementById('leave-adj-list');
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">연차 조정 내역이 없습니다.</td></tr>';
            return;
        }
        const canAdjust = currentUser.role === 'admin';
        tbody.innerHTML = data.map(d => {
            const date = new Date(d.createdAt).toLocaleDateString('ko-KR');
            const adjSign = d.adjustment > 0 ? '+' : '';
            const isDoc = d.source === 'document';   // 수기 이력에서 넘어온 추가일수
            const actionCell = isDoc
                ? '<span style="color:#9ca3af; font-size:12px;">승인이력에서 관리</span>'
                : (canAdjust ? `<button class="btn-view-items" onclick="deleteLeaveAdj(${d.id})" style="color:#dc2626;">취소</button>` : '');
            return `<tr>
                <td>${date}</td>
                <td>${d.userPosition ? d.userPosition + ' ' : ''}${d.userName}</td>
                <td style="font-weight:600; color:${d.adjustment > 0 ? '#2563eb' : '#dc2626'};">${adjSign}${d.adjustment}일</td>
                <td>${d.reason}${isDoc ? ' <span style="color:#16a34a; font-size:11px;">(수기 이력)</span>' : ''}</td>
                <td>${d.adjustedByName}</td>
                <td>${actionCell}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('loadLeaveAdjustments error:', err);
    }
}

window.openLeaveAdjModal = async function() {
    document.getElementById('leave-adj-modal').style.display = '';
    try {
        const users = await api('/api/users');
        const select = document.getElementById('adj-employee');
        select.innerHTML = users
            .filter(u => u.id !== currentUser.id) // 본인 제외 가능, 필요 시 제거
            .map(u => `<option value="${u.id}">${u.position ? u.position + ' ' : ''}${u.name}</option>`)
            .join('');
    } catch (err) {
        console.error('openLeaveAdjModal error:', err);
    }
    // 초기화
    document.getElementById('adj-days').value = '1';
    document.getElementById('adj-reason').value = '';
    document.querySelector('input[name="adj-type"][value="add"]').checked = true;
};

window.closeLeaveAdjModal = function() {
    document.getElementById('leave-adj-modal').style.display = 'none';
};

window.saveLeaveAdj = async function() {
    const userId = document.getElementById('adj-employee').value;
    const days = parseFloat(document.getElementById('adj-days').value);
    const reason = document.getElementById('adj-reason').value.trim();
    const isAdd = document.querySelector('input[name="adj-type"]:checked').value === 'add';

    if (!userId) { alert('대상 직원을 선택해주세요.'); return; }
    if (!days || days <= 0) { alert('일수를 입력해주세요.'); return; }
    if (!reason) { alert('사유를 입력해주세요.'); return; }

    const adjustment = isAdd ? days : -days;

    try {
        await api('/api/leave-adjustments', 'POST', { user_id: Number(userId), adjustment, reason });
        closeLeaveAdjModal();
        showToast('연차 조정 완료');
        loadLeaveAdjustments();
        renderLeaveSummary();
    } catch (err) {
        alert('연차 조정 실패: ' + err.message);
    }
};

window.deleteLeaveAdj = async function(id) {
    if (!confirm('이 연차 조정을 취소하시겠습니까? 연차가 원복됩니다.')) return;
    try {
        await api(`/api/leave-adjustments/${id}`, 'DELETE');
        showToast('연차 조정이 취소되었습니다');
        loadLeaveAdjustments();
        renderLeaveSummary();
    } catch (err) {
        alert('취소 실패: ' + err.message);
    }
};

// =============================================
// 수기 이력 추가 (관리자 전용)
// =============================================

window.openManualDocModal = async function() {
    document.getElementById('manual-doc-modal').style.display = '';
    // 직원 목록 로드
    try {
        const users = await api('/api/users');
        const sel = document.getElementById('manual-employee');
        sel.innerHTML = users.map(u =>
            `<option value="${u.id}">${u.position ? u.position + ' ' : ''}${u.name}</option>`
        ).join('');
    } catch (err) { console.error(err); }
    // 초기화
    document.getElementById('manual-doc-type').value = 'vacation';
    onManualDocTypeChange();
    document.getElementById('manual-start-date').value = '';
    document.getElementById('manual-end-date').value = '';
    document.getElementById('manual-reason').value = '';
    document.getElementById('manual-deducted').value = '0';
    document.getElementById('manual-added').value = '0';
};

window.closeManualDocModal = function() {
    document.getElementById('manual-doc-modal').style.display = 'none';
};

window.onManualDocTypeChange = function() {
    const type = document.getElementById('manual-doc-type').value;
    const subGroup = document.getElementById('manual-subtype-group');
    const subSel = document.getElementById('manual-subtype');

    if (type === 'vacation') {
        subGroup.style.display = '';
        subSel.innerHTML = '<option value="연차">연차</option><option value="시간차">시간차</option>';
    } else if (type === 'attendance') {
        subGroup.style.display = '';
        subSel.innerHTML = '<option value="휴직">휴직</option><option value="예비군">예비군</option><option value="병가">병가</option><option value="기타">기타</option>';
    } else {
        subGroup.style.display = 'none';
        subSel.innerHTML = '<option value="지각">지각</option><option value="미출근">미출근</option><option value="조퇴">조퇴</option><option value="기타">기타</option>';
    }
    onManualSubTypeChange();
};

window.onManualSubTypeChange = function() {
    const type = document.getElementById('manual-doc-type').value;
    const sub = document.getElementById('manual-subtype').value;
    const isTime = type === 'vacation' && sub === '시간차';
    document.getElementById('manual-time-group').style.display = isTime ? '' : 'none';
    if (isTime) {
        const opts = [];
        for (let h = 8; h <= 18; h++) {
            opts.push(`<option value="${String(h).padStart(2,'0')}:00">${String(h).padStart(2,'0')}:00</option>`);
            if (h < 18) opts.push(`<option value="${String(h).padStart(2,'0')}:30">${String(h).padStart(2,'0')}:30</option>`);
        }
        document.getElementById('manual-start-time').innerHTML = opts.join('');
        document.getElementById('manual-end-time').innerHTML = opts.join('');
    }
    calcManualDeducted();
};

window.calcManualDeducted = function() {
    const type = document.getElementById('manual-doc-type').value;
    const sub = document.getElementById('manual-subtype').value;
    const startDate = document.getElementById('manual-start-date').value;
    const endDate = document.getElementById('manual-end-date').value;

    if (type === 'vacation' && sub === '시간차') {
        const st = document.getElementById('manual-start-time').value;
        const et = document.getElementById('manual-end-time').value;
        if (st && et) {
            const s = new Date(`2000-01-01T${st}`);
            const e = new Date(`2000-01-01T${et}`);
            const hours = (e - s) / (1000 * 60 * 60);
            document.getElementById('manual-deducted').value = hours > 0 ? (Math.round(hours / 8 * 10) / 10) : 0;
        }
        document.getElementById('manual-added').value = '0';
    } else if (type === 'vacation' && sub === '연차' && startDate && endDate) {
        const days = Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
        document.getElementById('manual-deducted').value = days > 0 ? days : 0;
        document.getElementById('manual-added').value = '0';
    } else {
        document.getElementById('manual-deducted').value = '0';
        document.getElementById('manual-added').value = '0';
    }
};

// 차감일수/추가일수 상호 배타 입력
window.onManualDeductInput = function(which) {
    if (which === 'deduct') {
        const val = parseFloat(document.getElementById('manual-deducted').value) || 0;
        if (val > 0) document.getElementById('manual-added').value = '0';
    } else {
        const val = parseFloat(document.getElementById('manual-added').value) || 0;
        if (val > 0) document.getElementById('manual-deducted').value = '0';
    }
};

window.saveManualDoc = async function() {
    const employeeId = document.getElementById('manual-employee').value;
    const type = document.getElementById('manual-doc-type').value;
    const subType = document.getElementById('manual-subtype').value;
    const startDate = document.getElementById('manual-start-date').value;
    const endDate = document.getElementById('manual-end-date').value;
    const reason = document.getElementById('manual-reason').value;
    const deductDays = parseFloat(document.getElementById('manual-deducted').value) || 0;
    const addDays = parseFloat(document.getElementById('manual-added').value) || 0;

    if (deductDays > 0 && addDays > 0) {
        alert('차감일수와 추가일수는 동시에 입력할 수 없습니다.');
        return;
    }

    if (!employeeId || !startDate) {
        alert('직원과 시작일을 선택해주세요.');
        return;
    }

    // 차감: 양수, 추가: 음수로 전달
    const deductedLeave = addDays > 0 ? -addDays : deductDays;

    const body = { employeeId: Number(employeeId), type, subType, startDate, endDate: endDate || startDate, reason, deductedLeave };

    const isTime = type === 'vacation' && subType === '시간차';
    if (isTime) {
        body.startTime = document.getElementById('manual-start-time').value;
        body.endTime = document.getElementById('manual-end-time').value;
    }

    try {
        await api('/api/documents/manual', 'POST', body);
        closeManualDocModal();
        alert('추가 완료되었습니다.');
        renderLeaveSummary();
        searchDocHistory();
    } catch (err) {
        alert('저장 실패: ' + err.message);
    }
};

// =============================================
// CS처리방
// =============================================

let csCurrentCategory = '전체';
let csTemplatesData = [];
let csCategoriesData = [];

async function loadCsCategories() {
    try {
        csCategoriesData = await api('/api/cs-categories');
    } catch (err) { csCategoriesData = []; }
}

function getCsCategoryColor(catName) {
    const cat = csCategoriesData.find(c => c.name === catName);
    return cat ? cat.color : '#9E9E9E';
}

function renderCsTabs() {
    const container = document.getElementById('cs-tabs-container');
    if (!container) return;
    container.innerHTML = `<button class="cs-tab ${csCurrentCategory === '전체' ? 'active' : ''}" onclick="filterCsCategory('전체')">전체</button>` +
        csCategoriesData.map(c =>
            `<button class="cs-tab ${csCurrentCategory === c.name ? 'active' : ''}" onclick="filterCsCategory('${c.name.replace(/'/g, "\\'")}')">${c.name}</button>`
        ).join('');
}

function renderCsCategoryDropdown() {
    const sel = document.getElementById('cs-template-category');
    if (!sel) return;
    sel.innerHTML = csCategoriesData.map(c =>
        `<option value="${c.name}">${c.name}</option>`
    ).join('');
}

async function renderCsTemplates() {
    await loadCsCategories();
    renderCsTabs();
    renderCsCategoryDropdown();

    try {
        csTemplatesData = await api('/api/cs-templates');
    } catch (err) { csTemplatesData = []; }

    const search = (document.getElementById('cs-search-input')?.value || '').trim().toLowerCase();
    let filtered = csTemplatesData;

    if (csCurrentCategory !== '전체') {
        filtered = filtered.filter(t => t.category === csCurrentCategory);
    }
    if (search) {
        filtered = filtered.filter(t => t.title.toLowerCase().includes(search) || t.content.toLowerCase().includes(search));
    }

    const list = document.getElementById('cs-template-list');
    if (!list) return;

    if (filtered.length === 0) {
        list.innerHTML = '<p style="color:var(--text-light); font-size:14px; text-align:center; padding:40px 0;">등록된 문구가 없습니다</p>';
        return;
    }

    list.innerHTML = filtered.map(t => {
        const bgColor = getCsCategoryColor(t.category);
        const lightBg = bgColor + '22';
        return `
        <div class="cs-card" onclick="copyCsTemplate(event, ${t.id})">
            <div class="cs-card-header">
                <span class="cs-badge" style="background:${lightBg}; color:${bgColor};">${t.category}</span>
                <span class="cs-card-title">${t.title}</span>
                <div class="cs-card-actions">
                    <button onclick="event.stopPropagation(); editCsTemplate(${t.id})">수정</button>
                    <button onclick="event.stopPropagation(); deleteCsTemplate(${t.id})">삭제</button>
                </div>
            </div>
            <div class="cs-card-content">${t.content}</div>
        </div>`;
    }).join('');
}

window.filterCsCategory = function(cat) {
    csCurrentCategory = cat;
    document.querySelectorAll('.cs-tab').forEach(tab => {
        tab.classList.toggle('active', tab.textContent === cat);
    });
    // 탭 클릭 시 목록만 재필터링 (카테고리 재로드 불필요)
    (async () => {
        const search = (document.getElementById('cs-search-input')?.value || '').trim().toLowerCase();
        let filtered = csTemplatesData;
        if (csCurrentCategory !== '전체') filtered = filtered.filter(t => t.category === csCurrentCategory);
        if (search) filtered = filtered.filter(t => t.title.toLowerCase().includes(search) || t.content.toLowerCase().includes(search));
        const list = document.getElementById('cs-template-list');
        if (!list) return;
        if (filtered.length === 0) {
            list.innerHTML = '<p style="color:var(--text-light); font-size:14px; text-align:center; padding:40px 0;">등록된 문구가 없습니다</p>';
            return;
        }
        list.innerHTML = filtered.map(t => {
            const bgColor = getCsCategoryColor(t.category);
            const lightBg = bgColor + '22';
            return `<div class="cs-card" onclick="copyCsTemplate(event, ${t.id})">
                <div class="cs-card-header">
                    <span class="cs-badge" style="background:${lightBg}; color:${bgColor};">${t.category}</span>
                    <span class="cs-card-title">${t.title}</span>
                    <div class="cs-card-actions">
                        <button onclick="event.stopPropagation(); editCsTemplate(${t.id})">수정</button>
                        <button onclick="event.stopPropagation(); deleteCsTemplate(${t.id})">삭제</button>
                    </div>
                </div>
                <div class="cs-card-content">${t.content}</div>
            </div>`;
        }).join('');
    })();
};

window.copyCsTemplate = async function(event, id) {
    const tpl = csTemplatesData.find(t => t.id === id);
    if (!tpl) return;
    try {
        await navigator.clipboard.writeText(tpl.content);
        const toast = document.getElementById('cs-copy-toast');
        toast.style.display = '';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
    } catch (err) {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = tpl.content;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const toast = document.getElementById('cs-copy-toast');
        toast.style.display = '';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
    }
};

window.openCsTemplateModal = function() {
    document.getElementById('cs-modal-title').textContent = '문구 추가';
    document.getElementById('cs-edit-id').value = '';
    renderCsCategoryDropdown();
    const sel = document.getElementById('cs-template-category');
    if (sel.options.length > 0) sel.selectedIndex = 0;
    document.getElementById('cs-template-title-input').value = '';
    document.getElementById('cs-template-content').value = '';
    document.getElementById('cs-template-modal').style.display = '';
};

window.editCsTemplate = function(id) {
    const tpl = csTemplatesData.find(t => t.id === id);
    if (!tpl) return;
    document.getElementById('cs-modal-title').textContent = '문구 수정';
    document.getElementById('cs-edit-id').value = id;
    document.getElementById('cs-template-category').value = tpl.category;
    document.getElementById('cs-template-title-input').value = tpl.title;
    document.getElementById('cs-template-content').value = tpl.content;
    document.getElementById('cs-template-modal').style.display = '';
};

window.saveCsTemplate = async function() {
    const id = document.getElementById('cs-edit-id').value;
    const category = document.getElementById('cs-template-category').value;
    const title = document.getElementById('cs-template-title-input').value.trim();
    const content = document.getElementById('cs-template-content').value.trim();
    if (!title || !content) { alert('제목과 내용을 입력해주세요.'); return; }
    try {
        if (id) {
            await api(`/api/cs-templates/${id}`, 'PUT', { category, title, content });
        } else {
            await api('/api/cs-templates', 'POST', { category, title, content });
        }
        document.getElementById('cs-template-modal').style.display = 'none';
        await renderCsTemplates();
    } catch (err) { alert('저장 실패: ' + err.message); }
};

window.deleteCsTemplate = async function(id) {
    if (!confirm('이 문구를 삭제하시겠습니까?')) return;
    try {
        await api(`/api/cs-templates/${id}`, 'DELETE');
        await renderCsTemplates();
    } catch (err) { alert('삭제 실패: ' + err.message); }
};

// --- CS 카테고리 관리 ---
window.openCsCategoryModal = async function() {
    await loadCsCategories();
    renderCsCategoryList();
    document.getElementById('cs-new-cat-name').value = '';
    document.getElementById('cs-new-cat-color').value = '#9E9E9E';
    document.getElementById('cs-category-modal').style.display = '';
};

function renderCsCategoryList() {
    const container = document.getElementById('cs-category-list');
    if (!container) return;
    if (csCategoriesData.length === 0) {
        container.innerHTML = '<p style="color:var(--text-light); font-size:13px; text-align:center; padding:12px;">등록된 카테고리가 없습니다</p>';
        return;
    }
    container.innerHTML = csCategoriesData.map(c => `
        <div class="cs-cat-item" data-id="${c.id}">
            <span class="cs-cat-color-dot" style="background:${c.color};"></span>
            <span class="cs-cat-name">${c.name}</span>
            <div class="cs-cat-actions">
                <button onclick="editCsCategory(${c.id})">수정</button>
                <button onclick="deleteCsCategory(${c.id})">삭제</button>
            </div>
        </div>
    `).join('');
}

window.addCsCategory = async function() {
    const name = document.getElementById('cs-new-cat-name').value.trim();
    const color = document.getElementById('cs-new-cat-color').value;
    if (!name) { alert('카테고리 이름을 입력해주세요.'); return; }
    try {
        await api('/api/cs-categories', 'POST', { name, color });
        document.getElementById('cs-new-cat-name').value = '';
        document.getElementById('cs-new-cat-color').value = '#9E9E9E';
        await loadCsCategories();
        renderCsCategoryList();
        renderCsTabs();
        renderCsCategoryDropdown();
    } catch (err) { alert('추가 실패: ' + err.message); }
};

window.editCsCategory = function(id) {
    const cat = csCategoriesData.find(c => c.id === id);
    if (!cat) return;
    const item = document.querySelector(`.cs-cat-item[data-id="${id}"]`);
    if (!item) return;
    item.innerHTML = `
        <input type="color" value="${cat.color}" style="width:32px; height:32px; border:none; cursor:pointer;" id="cs-edit-cat-color-${id}">
        <input type="text" value="${cat.name}" class="form-input" style="flex:1; padding:4px 8px; font-size:13px;" id="cs-edit-cat-name-${id}">
        <div class="cs-cat-actions">
            <button onclick="saveCsCategory(${id})">저장</button>
            <button onclick="renderCsCategoryList()">취소</button>
        </div>
    `;
};

window.saveCsCategory = async function(id) {
    const name = document.getElementById(`cs-edit-cat-name-${id}`).value.trim();
    const color = document.getElementById(`cs-edit-cat-color-${id}`).value;
    if (!name) { alert('카테고리 이름을 입력해주세요.'); return; }
    try {
        await api(`/api/cs-categories/${id}`, 'PUT', { name, color });
        await loadCsCategories();
        renderCsCategoryList();
        renderCsTabs();
        renderCsCategoryDropdown();
    } catch (err) { alert('수정 실패: ' + err.message); }
};

window.deleteCsCategory = async function(id) {
    const cat = csCategoriesData.find(c => c.id === id);
    if (!cat) return;
    if (!confirm(`"${cat.name}" 카테고리를 삭제하시겠습니까?\n해당 카테고리의 문구는 "미분류"로 이동됩니다.`)) return;
    try {
        await api(`/api/cs-categories/${id}`, 'DELETE');
        await loadCsCategories();
        renderCsCategoryList();
        renderCsTabs();
        renderCsCategoryDropdown();
        // 삭제된 카테고리를 보고 있었다면 전체로 돌아가기
        if (csCurrentCategory === cat.name) {
            csCurrentCategory = '전체';
        }
        await renderCsTemplates();
    } catch (err) { alert('삭제 실패: ' + err.message); }
};

// =============================================
// 마이 플래너
// =============================================

let plannerYear = new Date().getFullYear();
let plannerMonth = new Date().getMonth();
let plannerSelectedDate = new Date().toISOString().split('T')[0];
let plannerCalDots = { todoDates: [], memoDates: [] };

async function renderPlannerPage() {
    // 환영 카드
    const welcome = document.getElementById('planner-welcome');
    if (localStorage.getItem('planner_welcome_hidden') === 'true') {
        welcome.style.display = 'none';
    } else {
        welcome.style.display = '';
    }
    await renderPlannerCalendar();
    await renderPlannerTodos();
    await renderPlannerMemo();
    await renderPlannerDdays();
    await renderPlannerHabits();
}

window.hidePlannerWelcome = function(permanent) {
    document.getElementById('planner-welcome').style.display = 'none';
    if (permanent) localStorage.setItem('planner_welcome_hidden', 'true');
};

// -- 미니 달력 --
window.plannerPrevMonth = function() {
    plannerMonth--;
    if (plannerMonth < 0) { plannerMonth = 11; plannerYear--; }
    renderPlannerCalendar();
};
window.plannerNextMonth = function() {
    plannerMonth++;
    if (plannerMonth > 11) { plannerMonth = 0; plannerYear++; }
    renderPlannerCalendar();
};

async function renderPlannerCalendar() {
    const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    document.getElementById('planner-cal-title').textContent = `${plannerYear}년 ${monthNames[plannerMonth]}`;

    const mm = String(plannerMonth + 1).padStart(2, '0');
    try {
        plannerCalDots = await api(`/api/planner/calendar-dots?month=${plannerYear}-${mm}`);
    } catch (e) { plannerCalDots = { todoDates: [], memoDates: [], todosByDate: {}, memosByDate: {}, ddaysByDate: {} }; }

    const daysInMonth = new Date(plannerYear, plannerMonth + 1, 0).getDate();
    const firstDay = new Date(plannerYear, plannerMonth, 1).getDay();
    const todayStr = new Date().toISOString().split('T')[0];

    // D-day 당일 알림
    const alertDiv = document.getElementById('planner-dday-alert');
    const todayDdays = plannerCalDots.ddaysByDate?.[todayStr];
    if (todayDdays && todayDdays.length > 0) {
        alertDiv.style.display = '';
        alertDiv.innerHTML = todayDdays.map(title =>
            `<div class="planner-dday-alert-item">🎉 오늘이 <strong>${title}</strong>의 날입니다!</div>`
        ).join('');
    } else {
        alertDiv.style.display = 'none';
        alertDiv.innerHTML = '';
    }

    let html = '';
    let day = 1;
    for (let week = 0; week < 6; week++) {
        if (day > daysInMonth) break;
        html += '<tr>';
        for (let dow = 0; dow < 7; dow++) {
            if ((week === 0 && dow < firstDay) || day > daysInMonth) {
                html += '<td class="empty"></td>';
            } else {
                const dateStr = `${plannerYear}-${mm}-${String(day).padStart(2, '0')}`;
                const cls = [];
                if (dow === 0) cls.push('sun');
                if (dow === 6) cls.push('sat');
                if (dateStr === todayStr) cls.push('today');
                if (dateStr === plannerSelectedDate) cls.push('selected');

                // 셀 안에 이벤트 내용 표시
                let events = '<div class="planner-cal-events">';
                // D-day
                const ddays = plannerCalDots.ddaysByDate?.[dateStr];
                if (ddays) {
                    ddays.forEach(title => { events += `<div class="cal-evt-dday">${title}</div>`; });
                }
                // 할일 (최대 2개 + 나머지 개수)
                const todos = plannerCalDots.todosByDate?.[dateStr];
                if (todos) {
                    todos.slice(0, 2).forEach(t => {
                        events += `<div class="cal-evt-todo">${t.done ? '✓' : '·'} ${t.content}</div>`;
                    });
                    if (todos.length > 2) events += `<div class="cal-evt-todo" style="color:var(--text-light);">+${todos.length - 2}개</div>`;
                }
                // 메모
                const memo = plannerCalDots.memosByDate?.[dateStr];
                if (memo) {
                    const short = memo.length > 8 ? memo.substring(0, 8) + '…' : memo;
                    events += `<div class="cal-evt-memo">📝 ${short}</div>`;
                }
                events += '</div>';

                html += `<td class="${cls.join(' ')}" onclick="selectPlannerDate('${dateStr}')"><span class="planner-day-num">${day}</span>${events}</td>`;
                day++;
            }
        }
        html += '</tr>';
    }
    document.getElementById('planner-cal-body').innerHTML = html;
}

window.selectPlannerDate = function(dateStr) {
    plannerSelectedDate = dateStr;
    renderPlannerCalendar();
    renderPlannerTodos();
    renderPlannerMemo();
};

// -- 할일 --
async function renderPlannerTodos() {
    const d = new Date(plannerSelectedDate);
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = plannerSelectedDate === todayStr;
    const label = isToday ? '오늘의 할일' : `${d.getMonth()+1}/${d.getDate()} 할일`;
    document.getElementById('planner-todo-title').textContent = `✅ ${label}`;

    try {
        const todos = await api(`/api/planner/todos?date=${plannerSelectedDate}`);
        const list = document.getElementById('planner-todo-list');
        if (todos.length === 0) {
            list.innerHTML = '<p style="color:var(--text-light); font-size:13px; text-align:center; padding:16px 0;">할일이 없습니다</p>';
            return;
        }
        list.innerHTML = todos.map(t => `
            <div class="planner-todo-item">
                <input type="checkbox" ${t.isCompleted ? 'checked' : ''} onchange="togglePlannerTodo(${t.id}, this.checked)">
                <span class="todo-text ${t.isCompleted ? 'completed' : ''}">${t.content}</span>
                <div class="todo-actions">
                    <button onclick="postponePlannerTodo(${t.id})" title="내일로 미루기">→</button>
                    <button onclick="deletePlannerTodo(${t.id})" title="삭제">×</button>
                </div>
            </div>
        `).join('');
    } catch (err) { console.error(err); }
}

window.addPlannerTodo = async function() {
    const input = document.getElementById('planner-todo-input');
    const content = input.value.trim();
    if (!content) return;
    try {
        await api('/api/planner/todos', 'POST', { date: plannerSelectedDate, content });
        input.value = '';
        await renderPlannerTodos();
        await renderPlannerCalendar();
    } catch (err) { alert('추가 실패: ' + err.message); }
};

window.togglePlannerTodo = async function(id, checked) {
    try {
        await api(`/api/planner/todos/${id}`, 'PUT', { isCompleted: checked });
        await renderPlannerTodos();
    } catch (err) { console.error(err); }
};

window.postponePlannerTodo = async function(id) {
    const next = new Date(plannerSelectedDate);
    next.setDate(next.getDate() + 1);
    const nextStr = next.toISOString().split('T')[0];
    try {
        await api(`/api/planner/todos/${id}`, 'PUT', { date: nextStr });
        await renderPlannerTodos();
        await renderPlannerCalendar();
    } catch (err) { console.error(err); }
};

window.deletePlannerTodo = async function(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
        await api(`/api/planner/todos/${id}`, 'DELETE');
        await renderPlannerTodos();
        await renderPlannerCalendar();
    } catch (err) { console.error(err); }
};

// -- 메모 --
async function renderPlannerMemo() {
    const d = new Date(plannerSelectedDate);
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = plannerSelectedDate === todayStr;
    const label = isToday ? '한줄 메모' : `${d.getMonth()+1}/${d.getDate()} 메모`;
    document.getElementById('planner-memo-title').textContent = `📝 ${label}`;

    try {
        const memo = await api(`/api/planner/memos?date=${plannerSelectedDate}`);
        document.getElementById('planner-memo-input').value = memo?.content || '';
    } catch (err) { console.error(err); }
}

window.savePlannerMemo = async function() {
    const content = document.getElementById('planner-memo-input').value.trim();
    if (!content) return;
    try {
        await api('/api/planner/memos', 'POST', { date: plannerSelectedDate, content });
        await renderPlannerCalendar();
    } catch (err) { console.error(err); }
};

// -- D-day --
async function renderPlannerDdays() {
    try {
        const ddays = await api('/api/planner/ddays');
        const list = document.getElementById('planner-dday-list');
        if (ddays.length === 0) {
            list.innerHTML = '<p style="color:var(--text-light); font-size:13px; text-align:center; padding:12px 0;">D-day를 추가해보세요</p>';
            return;
        }
        const today = new Date(); today.setHours(0,0,0,0);
        list.innerHTML = ddays.map(d => {
            const target = new Date(d.targetDate); target.setHours(0,0,0,0);
            const diff = Math.round((target - today) / (1000*60*60*24));
            let label;
            if (diff === 0) label = '<span class="dday-today">D-DAY 🎉</span>';
            else if (diff > 0) label = `<span class="dday-label">D-${diff}</span>`;
            else label = `<span class="dday-label" style="color:var(--text-light);">D+${Math.abs(diff)}</span>`;
            return `<div class="planner-dday-item">
                <div><span style="margin-right:8px;">${d.title}</span>${label}</div>
                <button class="habit-del" onclick="deletePlannerDday(${d.id})">×</button>
            </div>`;
        }).join('');
    } catch (err) { console.error(err); }
}

window.openDdayModal = function() {
    document.getElementById('dday-title').value = '';
    document.getElementById('dday-date').value = '';
    document.getElementById('dday-modal').style.display = '';
};

window.saveDday = async function() {
    const title = document.getElementById('dday-title').value.trim();
    const targetDate = document.getElementById('dday-date').value;
    if (!title || !targetDate) { alert('제목과 날짜를 입력해주세요.'); return; }
    try {
        await api('/api/planner/ddays', 'POST', { title, targetDate });
        document.getElementById('dday-modal').style.display = 'none';
        await renderPlannerDdays();
        await renderPlannerCalendar();
    } catch (err) { alert('저장 실패: ' + err.message); }
};

window.deletePlannerDday = async function(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
        await api(`/api/planner/ddays/${id}`, 'DELETE');
        await renderPlannerDdays();
        await renderPlannerCalendar();
    } catch (err) { console.error(err); }
};

// -- 습관 트래커 --
async function renderPlannerHabits() {
    try {
        const habits = await api('/api/planner/habits');
        const today = new Date();
        const mm = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
        const logs = await api(`/api/planner/habit-logs?month=${mm}`);

        // 이번 주 월~일 날짜 계산
        const todayDay = today.getDay();
        const monday = new Date(today);
        monday.setDate(today.getDate() - ((todayDay === 0 ? 7 : todayDay) - 1));
        const weekDates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            weekDates.push(d.toISOString().split('T')[0]);
        }
        const todayStr = today.toISOString().split('T')[0];

        const list = document.getElementById('planner-habit-list');
        if (habits.length === 0) {
            list.innerHTML = '<p style="color:var(--text-light); font-size:13px; text-align:center; padding:12px 0;">습관을 추가해보세요</p>';
            return;
        }

        const dayLabels = ['월','화','수','목','금','토','일'];
        list.innerHTML = habits.map(h => {
            const habitLogs = logs.filter(l => l.habitId === h.id).map(l => l.date?.split('T')[0] || l.date);
            let doneCount = 0;
            const dots = weekDates.map((date, i) => {
                const done = habitLogs.includes(date);
                if (done) doneCount++;
                const isToday = date === todayStr;
                const cls = ['habit-dot'];
                if (done) cls.push('done');
                if (isToday) cls.push('today-dot', 'clickable');
                return `<span class="${cls.join(' ')}" ${isToday ? `onclick="toggleHabitLog(${h.id},'${date}',${done})"` : ''}>${dayLabels[i]}</span>`;
            }).join('');
            const scoreText = doneCount === 7 ? '잘 하셨어요! 🎉' : `${doneCount}/7`;
            return `<div class="planner-habit-item">
                <div class="habit-dots">${dots}</div>
                <span class="habit-name">${h.title}</span>
                <span class="habit-score ${doneCount === 7 ? 'habit-perfect' : ''}">${scoreText}</span>
                <button class="habit-del" onclick="deletePlannerHabit(${h.id})">×</button>
            </div>`;
        }).join('');
    } catch (err) { console.error(err); }
}

window.addPlannerHabit = async function() {
    const title = prompt('습관명을 입력하세요:');
    if (!title || !title.trim()) return;
    try {
        await api('/api/planner/habits', 'POST', { title: title.trim() });
        await renderPlannerHabits();
    } catch (err) { alert('추가 실패: ' + err.message); }
};

window.toggleHabitLog = async function(habitId, date, isDone) {
    try {
        if (isDone) {
            await api('/api/planner/habit-logs', 'DELETE', { habitId, date });
        } else {
            await api('/api/planner/habit-logs', 'POST', { habitId, date });
        }
        await renderPlannerHabits();
    } catch (err) { console.error(err); }
};

window.deletePlannerHabit = async function(id) {
    if (!confirm('이 습관을 삭제하시겠습니까?')) return;
    try {
        await api(`/api/planner/habits/${id}`, 'DELETE');
        await renderPlannerHabits();
    } catch (err) { console.error(err); }
};

// =============================================
// 박스재고
// =============================================

let boxInventoryData = [];

async function renderBoxInventory() {
    try {
        const data = await api('/api/box-inventory');
        boxInventoryData = data;
        const grid = document.getElementById('box-inventory-grid');
        const isAdmin = currentUser?.role === 'admin';

        grid.innerHTML = data.map(item => {
            const hyodon = item.hyodonStock || 0;
            const total = item.companyStock + item.daesongStock + hyodon;
            return `
                <div class="leave-summary-card box-card-clickable" onclick="showBoxHistoryModal('${item.productName.replace(/'/g, "\\'")}')">
                    <div class="emp-name">${item.productName} <span style="color:#9ca3af;font-size:11px;font-weight:400;">📊 클릭하면 차감 이력</span></div>
                    <div class="leave-numbers" style="margin-top:12px;">
                        <div>총 재고<span class="num">${total}</span></div>
                        <div>업체재고<span class="num used ${isAdmin ? 'box-editable' : ''}" ${isAdmin ? `onclick="event.stopPropagation();editBoxStock(${item.id},'company')"` : ''} data-box-id="${item.id}" data-box-field="company">${item.companyStock}</span></div>
                        <div>대성(시온)<span class="num remaining ${isAdmin ? 'box-editable' : ''}" ${isAdmin ? `onclick="event.stopPropagation();editBoxStock(${item.id},'daesong')"` : ''} data-box-id="${item.id}" data-box-field="daesong">${item.daesongStock}</span></div>
                        <div>효돈<span class="num remaining ${isAdmin ? 'box-editable' : ''}" ${isAdmin ? `onclick="event.stopPropagation();editBoxStock(${item.id},'hyodon')"` : ''} data-box-id="${item.id}" data-box-field="hyodon">${hyodon}</span></div>
                    </div>
                </div>
            `;
        }).join('');

        document.getElementById('box-inventory-save-row').style.display = 'none';

        // 전체 입출고 현황 — 박스 종류 필터 옵션 채우기 + 기간 기본값 + 조회
        const histSel = document.getElementById('box-hist-product');
        if (histSel) {
            const prev = histSel.value;
            histSel.innerHTML = '<option value="">전체</option>' +
                data.map(b => `<option value="${b.productName.replace(/"/g,'&quot;')}">${b.productName}</option>`).join('');
            histSel.value = prev;
        }
        const histStart = document.getElementById('box-hist-start');
        const histEnd = document.getElementById('box-hist-end');
        if (histStart && histEnd && !histStart.value) {
            const now = new Date();
            histStart.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            histEnd.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        }
        loadBoxHistoryAll();
    } catch (err) {
        console.error('renderBoxInventory error:', err);
    }
}

// 전체 입출고 현황 조회 (모든 박스 통합)
let _boxHistAllCache = null;
async function loadBoxHistoryAll() {
    const tableEl = document.getElementById('box-hist-table');
    const summaryEl = document.getElementById('box-hist-summary');
    if (!tableEl) return;
    const startDate = document.getElementById('box-hist-start')?.value || '';
    const endDate = document.getElementById('box-hist-end')?.value || '';
    const product = document.getElementById('box-hist-product')?.value || '';
    const typeFilter = document.getElementById('box-hist-type')?.value || '';

    try {
        const qs = new URLSearchParams();
        if (product) qs.set('productName', product);
        if (startDate) qs.set('startDate', startDate);
        if (endDate) qs.set('endDate', endDate);
        const r = await api(`/api/box-inventory/history?${qs.toString()}`);
        let events = r.events || [];
        if (typeFilter) events = events.filter(e => e.type === typeFilter);

        const typeMeta = {
            order:    { label: '📥 업체 입고', color: '#16a34a' },
            transfer: { label: '🚚 시온 이동', color: '#0066CC' },
            transfer_hyodon: { label: '🚚 효돈 이동', color: '#F5A623' }, // 대표 7/20
            consume:  { label: '📤 정산 차감', color: '#dc2626' }
        };

        // 요약 (필터 반영)
        let sOrder = 0, sTransfer = 0, sHyodon = 0, sConsume = 0;
        events.forEach(e => {
            if (e.type === 'order') sOrder += e.qty;
            else if (e.type === 'transfer') sTransfer += e.qty;
            else if (e.type === 'transfer_hyodon') sHyodon += e.qty;
            else if (e.type === 'consume') sConsume += e.qty;
        });
        summaryEl.innerHTML = `<div style="background:#F0F7FF;padding:10px 14px;border-radius:6px;display:flex;gap:18px;flex-wrap:wrap;font-size:13px;">
            <span><strong style="color:#16a34a;">📥 업체 입고:</strong> +${sOrder}</span>
            <span><strong style="color:#0066CC;">🚚 시온 이동:</strong> ${sTransfer}</span>
            <span><strong style="color:#F5A623;">🚚 효돈 이동:</strong> ${sHyodon}</span>
            <span><strong style="color:#dc2626;">📤 정산 차감:</strong> −${sConsume}</span>
            <span style="color:#9ca3af;">건수: ${events.length}</span>
        </div>`;

        const esc = s => String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        if (events.length === 0) {
            tableEl.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af;">해당 기간/조건의 입출고 기록이 없습니다.</div>';
        } else {
            const rows = events.map(e => {
                const meta = typeMeta[e.type] || { label: e.type, color: '#6b7280' };
                const qtyDisplay = e.sign > 0 ? `+${e.qty}` : (e.sign < 0 ? `−${e.qty}` : `${e.qty}`);
                const qtyColor = e.sign > 0 ? '#16a34a' : (e.sign < 0 ? '#dc2626' : '#0066CC');
                return `<tr>
                    <td>${e.date}</td>
                    <td style="font-weight:600;">${esc(e.productName)}</td>
                    <td style="color:${meta.color};font-weight:600;">${meta.label}</td>
                    <td style="text-align:right;font-weight:700;color:${qtyColor};">${qtyDisplay}</td>
                    <td style="font-size:12px;color:#6b7280;">${esc(e.note)}</td>
                </tr>`;
            }).join('');
            tableEl.innerHTML = `<table class="data-table" style="font-size:13px;width:100%;">
                <thead><tr><th>날짜</th><th>박스 종류</th><th>구분</th><th style="text-align:right;">수량</th><th>비고/품목</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        }
        _boxHistAllCache = { events, startDate, endDate };
    } catch (err) {
        tableEl.innerHTML = `<div style="padding:20px;text-align:center;color:#dc2626;">조회 실패: ${err.message}</div>`;
    }
}

// 전체 입출고 현황 엑셀 다운로드
function downloadBoxHistoryAllExcel() {
    if (!_boxHistAllCache || !_boxHistAllCache.events.length) { alert('다운로드할 데이터가 없습니다. 먼저 조회해주세요.'); return; }
    const { events, startDate, endDate } = _boxHistAllCache;
    const typeLabel = { order: '업체 입고', transfer: '시온 이동', consume: '정산 차감' };

    let sOrder = 0, sTransfer = 0, sConsume = 0;
    events.forEach(e => {
        if (e.type === 'order') sOrder += e.qty;
        else if (e.type === 'transfer') sTransfer += e.qty;
        else if (e.type === 'consume') sConsume += e.qty;
    });

    const rows = [[`박스 전체 입출고 현황 (${startDate || ''} ~ ${endDate || ''})`]];
    rows.push([]);
    rows.push(['📥 업체 입고', sOrder, '🚚 시온 이동', sTransfer, '📤 정산 차감', sConsume]);
    rows.push([]);
    rows.push(['날짜', '박스 종류', '구분', '수량', '비고/품목']);
    events.forEach(e => {
        rows.push([
            e.date,
            e.productName || '',
            typeLabel[e.type] || e.type,
            e.sign > 0 ? e.qty : (e.sign < 0 ? -e.qty : e.qty),
            e.note || ''
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 13 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 50 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];

    if (XLSX.utils && ws['!ref']) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        const border = { top:{style:'thin',color:{rgb:'999999'}}, bottom:{style:'thin',color:{rgb:'999999'}}, left:{style:'thin',color:{rgb:'999999'}}, right:{style:'thin',color:{rgb:'999999'}} };
        for (let R = range.s.r; R <= range.e.r; R++) {
            for (let C = range.s.c; C <= range.e.c; C++) {
                const ref = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[ref]) ws[ref] = { t: 's', v: '' };
                const st = { border, alignment: { vertical: 'center' } };
                if (R === 0) { st.font = { bold: true, sz: 14 }; st.alignment = { horizontal: 'center', vertical: 'center' }; st.fill = { fgColor: { rgb: 'FFE0B2' } }; }
                if (R === 2) { st.font = { bold: true }; st.fill = { fgColor: { rgb: 'F0F7FF' } }; }
                if (R === 4) { st.font = { bold: true }; st.fill = { fgColor: { rgb: 'E6F0FA' } }; st.alignment = { horizontal: 'center' }; }
                if (R >= 5 && C === 3) { st.alignment = { ...st.alignment, horizontal: 'right' }; st.numFmt = '#,##0'; if (typeof ws[ref].v === 'number') ws[ref].t = 'n'; }
                ws[ref].s = st;
            }
        }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '입출고현황');
    const today = new Date();
    const fname = `박스_입출고현황_${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}.xlsx`;
    XLSX.writeFile(wb, fname);
}

document.getElementById('box-hist-search-btn')?.addEventListener('click', loadBoxHistoryAll);
document.getElementById('box-hist-type')?.addEventListener('change', loadBoxHistoryAll);
document.getElementById('box-hist-product')?.addEventListener('change', loadBoxHistoryAll);
document.getElementById('box-hist-excel-btn')?.addEventListener('click', downloadBoxHistoryAllExcel);

window.editBoxStock = function(id, field) {
    const item = boxInventoryData.find(i => i.id === id);
    if (!item) return;
    const label = field === 'company' ? '업체재고' : field === 'daesong' ? '대성(시온)재고' : '효돈재고';
    const current = field === 'company' ? item.companyStock : field === 'daesong' ? item.daesongStock : (item.hyodonStock || 0);
    const val = prompt(`${item.productName} - ${label} 실재고 입력\n(오늘 기준 실제 재고 수량 → 내일부터 입출고 자동 반영):`, current);
    if (val === null) return;
    const num = parseInt(val);
    if (isNaN(num) || num < 0) { alert('올바른 숫자를 입력해주세요.'); return; }

    if (field === 'company') item.companyStock = num;
    else if (field === 'daesong') item.daesongStock = num;
    else item.hyodonStock = num;

    // UI 즉시 반영
    const total = item.companyStock + item.daesongStock + (item.hyodonStock || 0);
    const card = document.querySelector(`[data-box-id="${id}"][data-box-field="company"]`).closest('.leave-summary-card');
    card.querySelector('.num:first-of-type').textContent = total;
    card.querySelector('[data-box-field="company"]').textContent = item.companyStock;
    card.querySelector('[data-box-field="daesong"]').textContent = item.daesongStock;
    const hyoCell = card.querySelector('[data-box-field="hyodon"]');
    if (hyoCell) hyoCell.textContent = item.hyodonStock || 0;

    document.getElementById('box-inventory-save-row').style.display = '';
};

window.saveBoxInventory = async function() {
    try {
        for (const item of boxInventoryData) {
            await api(`/api/box-inventory/${item.id}`, 'PUT', {
                companyStock: item.companyStock,
                daesongStock: item.daesongStock,
                hyodonStock: item.hyodonStock || 0
            });
        }
        alert('저장되었습니다.');
        document.getElementById('box-inventory-save-row').style.display = 'none';
    } catch (err) {
        alert('저장 실패: ' + err.message);
    }
};

// 새로고침 버튼
document.getElementById('inventory-refresh-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('inventory-refresh-btn');
    btn.classList.add('spinning');
    try {
        await renderBoxInventory();
        const now = new Date();
        document.getElementById('inventory-refresh-time').textContent =
            `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} 업데이트됨`;
    } catch (err) {
        console.error(err);
    } finally {
        btn.classList.remove('spinning');
    }
});

// 박스 통합 이력 모달 (자동차감 + 업체 입고 + 시온 이동) — 박스 카드 클릭 시
window.showBoxHistoryModal = async function(productName) {
    try {
        const r = await api(`/api/box-inventory/history?productName=${encodeURIComponent(productName)}`);
        const events = r.events || [];
        const s = r.summary || { consumed:0, ordered:0, transferred:0, count:0 };

        const typeMeta = {
            order:    { label: '📥 업체 입고',  color: '#16a34a' },
            transfer: { label: '🚚 시온 이동',  color: '#0066CC' },
            consume:  { label: '📤 정산 차감',  color: '#dc2626' }
        };

        const rows = events.map(e => {
            const meta = typeMeta[e.type] || { label: e.type, color: '#6b7280' };
            const qtyDisplay = e.sign > 0 ? `+${e.qty}` : (e.sign < 0 ? `−${e.qty}` : `${e.qty}`);
            const qtyColor = e.sign > 0 ? '#16a34a' : (e.sign < 0 ? '#dc2626' : '#0066CC');
            const noteText = (e.note || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const delBtn = (e.type === 'order' || e.type === 'transfer')
                ? `<button class="btn-danger" style="padding:2px 8px;font-size:11px;" onclick="deleteBoxMovement(${e.refId}, '${productName.replace(/'/g,"\\'")}')">삭제</button>`
                : (e.isAdjusted === false ? '<span style="color:#f59e0b;font-size:11px;">⏳ 미차감</span>' : '<span style="color:#16a34a;font-size:11px;">✅</span>');
            return `<tr>
                <td>${e.date}</td>
                <td style="color:${meta.color};font-weight:600;">${meta.label}</td>
                <td style="text-align:right;font-weight:700;color:${qtyColor};">${qtyDisplay}</td>
                <td style="font-size:12px;color:#6b7280;">${noteText}</td>
                <td style="text-align:center;">${delBtn}</td>
            </tr>`;
        }).join('');

        const bodyHtml = events.length === 0
            ? '<div style="padding:20px;text-align:center;color:#9ca3af;">아직 기록된 이력이 없습니다.</div>'
            : `<table class="data-table" style="font-size:13px;width:100%;">
                <thead><tr><th>날짜</th><th>구분</th><th style="text-align:right;">수량</th><th>비고/품목</th><th style="text-align:center;">관리</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="max-width:820px;">
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                <h3 style="margin-bottom:12px;">📊 ${productName} — 박스 이력</h3>
                <div style="background:#F0F7FF;padding:12px;border-radius:6px;margin-bottom:12px;display:flex;gap:14px;flex-wrap:wrap;font-size:13px;">
                    <span><strong style="color:#16a34a;">📥 업체 입고:</strong> +${s.ordered}</span>
                    <span><strong style="color:#0066CC;">🚚 시온 이동:</strong> ${s.transferred}</span>
                    <span><strong style="color:#dc2626;">📤 정산 차감:</strong> −${s.consumed}</span>
                </div>
                ${bodyHtml}
                <div style="display:flex;justify-content:space-between;margin-top:16px;">
                    <button class="btn-outline" onclick="downloadBoxHistoryExcel('${productName.replace(/'/g,"\\'")}')">📄 거래처 자료 (엑셀)</button>
                    <button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">닫기</button>
                </div>
            </div>
        `;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);

        // 다운로드용 캐시
        window._lastBoxHistory = { productName, events, summary: s };
    } catch (err) {
        alert('이력 조회 실패: ' + err.message);
    }
};

// 박스 이동 기록 삭제
window.deleteBoxMovement = async function(id, productName) {
    if (!confirm('이 기록을 삭제하시겠습니까?\n박스재고가 등록 전 상태로 자동 복구됩니다.')) return;
    try {
        await api(`/api/box-movements/${id}`, 'DELETE');
        document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
        await renderBoxInventory();
        showBoxHistoryModal(productName);
    } catch (err) { alert('삭제 실패: ' + err.message); }
};

// 박스 이력 엑셀 다운로드 (거래처 제출용)
window.downloadBoxHistoryExcel = function(productName) {
    const cache = window._lastBoxHistory;
    if (!cache || cache.productName !== productName) { alert('이력을 다시 조회해주세요.'); return; }
    const { events, summary } = cache;
    const typeLabel = { order: '업체 입고', transfer: '시온 이동', consume: '정산 차감' };

    const rows = [[`${productName} — 박스 이력 자료`]];
    rows.push([]);
    rows.push(['📥 업체 입고', summary.ordered, '🚚 시온 이동', summary.transferred, '📤 정산 차감', summary.consumed]);
    rows.push([]);
    rows.push(['날짜', '구분', '수량', '비고/품목']);
    events.forEach(e => {
        rows.push([
            e.date,
            typeLabel[e.type] || e.type,
            e.sign > 0 ? e.qty : (e.sign < 0 ? -e.qty : e.qty),
            e.note || ''
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 13 }, { wch: 14 }, { wch: 10 }, { wch: 50 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];

    // 스타일링 — 헤더/합계 강조
    if (XLSX.utils && ws['!ref']) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        const border = { top:{style:'thin',color:{rgb:'999999'}}, bottom:{style:'thin',color:{rgb:'999999'}}, left:{style:'thin',color:{rgb:'999999'}}, right:{style:'thin',color:{rgb:'999999'}} };
        for (let R = range.s.r; R <= range.e.r; R++) {
            for (let C = range.s.c; C <= range.e.c; C++) {
                const ref = XLSX.utils.encode_cell({ r: R, c: C });
                if (!ws[ref]) ws[ref] = { t: 's', v: '' };
                const st = { border, alignment: { vertical: 'center' } };
                if (R === 0) { st.font = { bold: true, sz: 14 }; st.alignment = { horizontal: 'center', vertical: 'center' }; st.fill = { fgColor: { rgb: 'FFE0B2' } }; }
                if (R === 2) { st.font = { bold: true }; st.fill = { fgColor: { rgb: 'F0F7FF' } }; }
                if (R === 4) { st.font = { bold: true }; st.fill = { fgColor: { rgb: 'E6F0FA' } }; st.alignment = { horizontal: 'center' }; }
                if (R >= 5 && C === 2) { st.alignment = { ...st.alignment, horizontal: 'right' }; st.numFmt = '#,##0'; if (typeof ws[ref].v === 'number') ws[ref].t = 'n'; }
                ws[ref].s = st;
            }
        }
    }

    const wb = XLSX.utils.book_new();
    const sheetName = productName.length > 28 ? productName.substring(0, 28) : productName;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const today = new Date();
    const fname = `${productName}_박스이력_${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}.xlsx`;
    XLSX.writeFile(wb, fname);
};

// 박스 입고/이동 등록 모달
document.getElementById('box-movement-btn')?.addEventListener('click', () => {
    const optionsHtml = (boxInventoryData || []).map(b => `<option value="${b.productName}">${b.productName}</option>`).join('');
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal" style="max-width:480px;">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3 style="margin-bottom:14px;">📥 박스 입고/이동 등록</h3>
            <div style="font-size:12px;color:#6b7280;margin-bottom:12px;line-height:1.5;">
                💡 <strong>업체 입고</strong>: 제작 업체에서 박스가 들어옴 → <strong>업체재고 +</strong><br>
                💡 <strong>시온 이동</strong>: 업체재고에서 대성으로 배달 → <strong>업체재고 - / 대성재고 +</strong><br>
                💡 <strong>효돈 이동</strong>: 업체재고에서 효돈으로 배달 → <strong>업체재고 - / 효돈재고 +</strong>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
                <div>
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">구분</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <label style="flex:1;min-width:120px;padding:10px;border:2px solid #16a34a;border-radius:6px;cursor:pointer;text-align:center;background:#f0fdf4;">
                            <input type="radio" name="mov-type" value="order" checked style="margin-right:6px;">📥 업체 입고
                        </label>
                        <label style="flex:1;min-width:120px;padding:10px;border:2px solid #0066CC;border-radius:6px;cursor:pointer;text-align:center;background:#F0F7FF;">
                            <input type="radio" name="mov-type" value="transfer" style="margin-right:6px;">🚚 시온 이동
                        </label>
                        <label style="flex:1;min-width:120px;padding:10px;border:2px solid #4F46E5;border-radius:6px;cursor:pointer;text-align:center;background:#EEF0FF;">
                            <input type="radio" name="mov-type" value="transfer_hyodon" style="margin-right:6px;">🚚 효돈 이동
                        </label>
                    </div>
                </div>
                <div>
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">박스 종류</label>
                    <select id="mov-product" class="form-input" style="width:100%;">${optionsHtml}</select>
                </div>
                <div style="display:flex;gap:10px;">
                    <div style="flex:1;">
                        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">수량</label>
                        <input type="number" id="mov-qty" class="form-input" placeholder="예: 100" min="1" style="width:100%;">
                    </div>
                    <div style="flex:1;">
                        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">날짜</label>
                        <input type="date" id="mov-date" class="form-input" value="${todayStr}" style="width:100%;">
                    </div>
                </div>
                <div>
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">비고 (선택)</label>
                    <input type="text" id="mov-note" class="form-input" placeholder="예: 한라포장 주문분 / 시온 1차 배달" style="width:100%;">
                </div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
                <button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">취소</button>
                <button class="btn-primary" id="mov-save">💾 저장</button>
            </div>
        </div>
    `;
    overlay.querySelector('#mov-save').addEventListener('click', async () => {
        const movementType = overlay.querySelector('input[name="mov-type"]:checked').value;
        const productName = overlay.querySelector('#mov-product').value;
        const qty = Number(overlay.querySelector('#mov-qty').value) || 0;
        const date = overlay.querySelector('#mov-date').value;
        const note = overlay.querySelector('#mov-note').value.trim();
        if (qty <= 0) { alert('수량을 입력해주세요.'); return; }
        if (!date) { alert('날짜를 선택해주세요.'); return; }
        const btn = overlay.querySelector('#mov-save');
        btn.disabled = true; btn.textContent = '저장 중...';
        try {
            await api('/api/box-movements', 'POST', { productName, movementType, qty, date, note });
            overlay.remove();
            await renderBoxInventory();
            alert('등록 완료');
        } catch (err) {
            alert('등록 실패: ' + err.message);
            btn.disabled = false; btn.textContent = '💾 저장';
        }
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
});

// =============================================
// 송장변환
// =============================================
let invoiceDataSmart = null;
let invoiceDataJasamol = null;
let invoiceDataCoupang = null;

function setupInvoiceArea(areaId, inputId, fileNameId, headerRange, convertFn, storeKey) {
    const area = document.getElementById(areaId);
    const input = document.getElementById(inputId);
    const fileNameEl = document.getElementById(fileNameId);
    if (!area || !input) return;

    area.addEventListener('click', () => input.click());
    area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            loadInvoiceFile(e.dataTransfer.files[0], area, fileNameEl, headerRange, convertFn, storeKey);
        }
    });
    input.addEventListener('change', (e) => {
        if (e.target.files.length) loadInvoiceFile(e.target.files[0], area, fileNameEl, headerRange, convertFn, storeKey);
    });
}

function loadInvoiceFile(file, area, fileNameEl, headerRange, convertFn, storeKey) {
    fileNameEl.textContent = file.name;
    area.classList.add('has-file');
    const successMsg = document.getElementById('invoice-success-msg');
    if (successMsg) successMsg.style.display = 'none';
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(ws, { range: headerRange, defval: '' });
            if (data.length > 0) {
                if (storeKey === 'smart') invoiceDataSmart = data;
                else if (storeKey === 'jasamol') invoiceDataJasamol = data;
                else if (storeKey === 'coupang') invoiceDataCoupang = data;
                updateInvoiceMergeBtn();
                showInvoiceMergedPreview();
            } else {
                alert('데이터가 없습니다. 올바른 엑셀 파일인지 확인해주세요.');
            }
        } catch (err) {
            alert('파일을 읽는 중 오류: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function updateInvoiceMergeBtn() {
    const hasData = invoiceDataSmart || invoiceDataJasamol || invoiceDataCoupang;
    document.getElementById('invoice-merge-btn').disabled = !hasData;
}

function getMergedConverted() {
    let all = [];
    if (invoiceDataSmart) all = all.concat(convertDataSmart(invoiceDataSmart));
    if (invoiceDataJasamol) all = all.concat(convertDataJasamol(invoiceDataJasamol));
    if (invoiceDataCoupang) all = all.concat(convertDataCoupang(invoiceDataCoupang));
    all.sort((a, b) => (a['옵션정보'] || '').localeCompare(b['옵션정보'] || '', 'ko'));
    return all;
}

function showInvoiceMergedPreview() {
    const converted = getMergedConverted();
    if (converted.length === 0) return;
    showInvoicePreview(converted);
}

document.getElementById('invoice-merge-btn').addEventListener('click', () => {
    const converted = getMergedConverted();
    if (converted.length === 0) return alert('업로드된 파일이 없습니다.');
    exportInvoiceExcel(converted);
});

function showInvoicePreview(converted) {
    document.getElementById('invoice-preview-section').style.display = '';
    document.getElementById('invoice-total-orders').textContent = converted.length;
    document.getElementById('invoice-total-qty').textContent = converted.reduce((sum, row) => sum + (parseInt(row['수량']) || 1), 0);
    document.getElementById('invoice-unique-recipients').textContent = new Set(converted.map(r => r['수취인명'])).size;

    const headers = ['보내는사람', '보내는사람연락처', '수취인명', '옵션정보', '수량', '배송지'];
    let html = '<table><thead><tr>';
    headers.forEach(h => html += `<th>${h}</th>`);
    html += '</tr></thead><tbody>';
    converted.slice(0, 10).forEach(row => {
        html += '<tr>';
        headers.forEach(h => {
            let val = row[h] || '';
            if (typeof val === 'string' && val.length > 30) val = val.substring(0, 30) + '...';
            html += `<td>${val}</td>`;
        });
        html += '</tr>';
    });
    if (converted.length > 10) html += `<tr><td colspan="${headers.length}" style="text-align:center;color:#999;padding:12px;">... 외 ${converted.length - 10}건 더</td></tr>`;
    html += '</tbody></table>';
    document.getElementById('invoice-table-wrapper').innerHTML = html;
}

// 사이즈 감지
function detectSize(msg) {
    if (!msg) return null;
    const lower = msg.toLowerCase().trim();
    const koreanMap = [
        { patterns: ['투에스', '2에스'], size: '2S' },
        { patterns: ['에스', '스몰'], size: 'S' },
        { patterns: ['엠', '미디엄', '미듐'], size: 'M' },
    ];
    for (const item of koreanMap) {
        for (const p of item.patterns) {
            if (lower.includes(p)) return item.size;
        }
    }
    let match = lower.match(/(2s|s|m)\s*사이즈/);
    if (match) return match[1].toUpperCase();
    match = lower.match(/\b(2s)\b/) || lower.match(/\b([sm])\b/);
    if (match) return match[1].toUpperCase();
    return null;
}

// 품목명 카탈로그 (품목명 추가(03.03).xlsx 기준)
const PRODUCT_CATALOG = new Set([
    '★추천 선물세트 / 상품 및 과수: 한라봉&카라향 3kg(2종세트)',
    '★추천 선물세트 / 상품 및 과수: 한라봉&카라향 5kg(2종세트)',
    '과수 및 크기: 제주 레몬3kg(혼합과)',
    '과수 및 크기: 제주 레몬5kg(혼합과)',
    '과수 및 크기: 제주 레몬10kg(혼합과)',
    '과수 및 크기: 제주 못난이 레몬5kg(랜덤과)',
    '과수 및 크기: 제주 못난이 레몬10kg(랜덤과)',
    '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)',
    '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 5kg(중소과 27과 전후)',
    '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(대과 7~15과)',
    '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(대과 13~23과)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 가정용 - 3kg(중소과 18과 전후)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 가정용 - 5kg(중소과 28과 전후)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 가정용 - 10kg(중소과 55과 전후)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 선물용 - 3kg(대과 7~13과)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 선물용 - 5kg(대과 12~22과)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 못난이 - 5kg(랜덤과)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 못난이 - 10kg(랜덤과)',
    '제주자몽 / 상품 및 과수: 제주자몽 가정용 3kg(10과전후)',
    '제주자몽 / 상품 및 과수: 제주자몽 가정용 5kg(17과전후)',
    '제주자몽 / 상품 및 과수: 제주자몽 선물용 3kg(10과전후)',
    '제주자몽 / 상품 및 과수: 제주자몽 선물용 5kg(17과전후)',
    '제주자몽 / 상품 및 과수: 제주자몽 못난이 5kg(랜덤과)',
    '제주자몽 / 상품 및 과수: 제주자몽 못난이 10kg(랜덤과)',
    '블러드오렌지 / 상품 및 과수: 블러드오렌지 가정용 5kg(랜덤과)',
    '블러드오렌지 / 상품 및 과수: 블러드오렌지 가정용 3kg(랜덤과)',
    '블러드오렌지 / 상품 및 과수: 블러드오렌지 못난이 5kg(랜덤과)',
    '살살녹는 수라향 / 상품 및 과수: 수라향 가정용 - 5kg(랜덤과)',
    '살살녹는 수라향 / 상품 및 과수: 수라향 가정용 - 3kg(랜덤과)',
    '살살녹는 수라향 / 상품 및 과수: 수라향 못난이 - 5kg(랜덤과)',
    '제주 하귤 / 상품 및 과수: 하귤 가정용 4.5kg(랜덤과)',
    '제주 하귤 / 상품 및 과수: 하귤 가정용 9kg(랜덤과)',
    '새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - 3kg(24과 전후)',
    '새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - 5kg(40과 전후)',
    '새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - 9kg(72과 전후)',
    '새콤달콤 카라향 / 상품 및 과수: 카라향 선물용 - 2kg(10~17과)',
    '맛이진한 세미놀귤 / 세미놀귤 가정용 - 3kg(랜덤과)',
    '맛이진한 세미놀귤 / 세미놀귤 가정용 - 5kg(랜덤과)',
    '맛이진한 세미놀귤 / 세미놀귤 가정용 - 10kg(랜덤과)',
    '맛이진한 세미놀귤 / 세미놀귤 못난이 - 5kg(랜덤과)',
    '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(로얄과)',
    '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(소과)',
    '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(로얄과)',
    '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(중대과)',
    '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(소과)',
    '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 10kg(로얄과)',
    '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 선물용 - 3kg(로얄과)',
    '미니밤호박 특품최상급 / 상품 및 과수: 특품 3kg(6~12개)',
    '미니밤호박 특품최상급 / 상품 및 과수: 특품 5kg(10~20개)',
    '미니밤호박 특품최상급 / 상품 및 과수: 특품 10kg(20~40개)',
    '미니밤호박 중품못난이 / 상품 및 과수: 못난이 3kg(랜덤과)',
    '미니밤호박 중품못난이 / 상품 및 과수: 못난이 5kg(랜덤과)',
    '미니밤호박 중품못난이 / 상품 및 과수: 못난이 10kg(랜덤과)',
    '미니밤호박 꼬마 / 상품 및 과수: 한입밤호박 3kg(15과 전후)',
    '미니밤호박 꼬마 / 상품 및 과수: 한입밤호박 5kg(25과 전후)',
    '미니밤호박 꼬마 / 상품 및 과수: 한입밤호박 10kg(50과 전후)',
    '초당옥수수 / 중품 10+1개입',
    '초당옥수수 / 중품 20+2개입',
    '최상품 청귤(풋귤) 5kg',
    '최상품 청귤(풋귤) 10kg',
]);

// 송장변환 품목 매칭 = 오늘 품목별 금액(pricing) 기반 (대표 7/20)
// matchProductRaw(정교한 옵션 파서)로 표준 품목명 생성 → 오늘 pricing 품목과 특징 매칭 →
// pricing에 있으면 그 품목명, 없으면 [미매칭]. pricing 미로드 시 표준명 폴백. 중간발주도 공유.
let aoInvoicePricingNames = []; // 오늘 유효 pricing 품목명 (전체)
let aoInvoicePricingByPartner = {}; // 거래처별 품목명 Set (대표 7/21 — 중간발주 필터·엑셀 색상)
async function aoLoadInvoicePricing() {
    try {
        // 대표 7/21: 직원도 쓸 수 있는 경량 카탈로그 API (품목명·거래처만, 단가 제외) — 권한(adminOnly) 문제로 직원 화면에 매칭·색상·필터 안 되던 것 수정
        const data = await api('/api/invoice/catalog');
        const names = new Set();
        aoInvoicePricingByPartner = {};
        Object.entries(data.byPartner || {}).forEach(([partner, arr]) => {
            const set = aoInvoicePricingByPartner[partner] = new Set();
            (arr || []).forEach(n => { if (n) { names.add(n); set.add(n); } });
        });
        aoInvoicePricingNames = [...names];
    } catch (e) { aoInvoicePricingNames = []; aoInvoicePricingByPartner = {}; console.error('송장변환 카탈로그 로드 실패:', e); }
}
// 품목명 → 거래처 판정 (매칭된 pricing 이름 기준, 미매칭이면 null) — 대표 7/21
function aoItemPartner(name) {
    if (!name || String(name).startsWith('[미매칭]')) return null;
    for (const [partner, set] of Object.entries(aoInvoicePricingByPartner)) {
        if (set.has(name)) return partner;
    }
    return null;
}
// 품목명 → 특징(과일·용도·중량·등급) 추출 (정산 matchItemToPricing과 같은 개념, 송장변환용 프론트 판)
function aoInvoiceFeat(name) {
    const t = String(name || '').replace(/\s/g, '');
    const fruit = (t.match(/하우스감귤|미니밤호박|한입밤호박|황금향|한라봉|천혜향|새콤달콤카라향|카라향|레드향|세미놀귤|자몽|레몬|블러드오렌지|수라향|하귤|청귤|풋귤|초당옥수수|취나물/) || [])[0] || '';
    const use = (t.match(/특품|못난이|한입|가정용|선물용|프리미엄/) || [])[0] || '';
    const weight = ((t.match(/(\d+(?:\.\d+)?)kg/) || [])[1]) || '';
    const grade = (t.match(/로얄과|중대과|소과|랜덤과|중소과|대과/) || [])[0] || '';
    return { fruit, use, weight, grade };
}
function aoMatchToPricing(standardName, pricingNames) {
    const s = aoInvoiceFeat(standardName);
    if (!s.fruit || !s.weight) return null;
    for (const pn of pricingNames) {
        const p = aoInvoiceFeat(pn);
        if (p.fruit === s.fruit && p.weight === s.weight
            && (p.use === s.use || (!s.use && !p.use))
            && (p.grade === s.grade || (!s.grade && !p.grade))) return pn;
    }
    return null;
}
// 송장변환 화면: 오늘 판매 품목 목록 로드·표시 (읽기 전용 — 품목별 금액과 동일)
async function aoRenderInvoiceCatalog() {
    await aoLoadInvoicePricing();
    const box = document.getElementById('invoice-catalog-list');
    if (!box) return;
    if (!aoInvoicePricingNames.length) {
        box.innerHTML = '<div style="color:#9ca3af;font-size:13px;">오늘 기준 품목별 금액이 없습니다 — 품목별 금액 메뉴에서 이번 기간을 등록하세요.</div>';
        return;
    }
    box.innerHTML = `<div style="color:#666;font-size:13px;margin-bottom:8px;">총 <strong>${aoInvoicePricingNames.length}</strong>개 품목</div>`
        + '<div style="display:flex;flex-direction:column;gap:4px;">'
        + aoInvoicePricingNames.map(n => `<div style="padding:6px 10px;background:#f7f9fc;border-radius:6px;font-size:13px;">${aoEsc(n)}</div>`).join('')
        + '</div>';
}
function matchProduct(rawText) {
    const std = matchProductRaw(rawText);
    if (typeof std !== 'string' || std.startsWith('[미매칭]')) return std;
    if (!aoInvoicePricingNames.length) return std; // pricing 미로드 시 표준명 폴백 (안전)
    const matched = aoMatchToPricing(std, aoInvoicePricingNames);
    return matched || ('[미매칭] ' + String(rawText || '').trim());
}

// 상품 카탈로그 매칭 (정교한 옵션정보 파서 → 표준 품목명)
function matchProductRaw(rawText) {
    const t = rawText || '';
    // 초당옥수수: kg가 아닌 '개입(개수)' 단위라 중량 매칭 전에 처리
    if (/옥수수/.test(t)) {
        // 초당옥수수(07.06 시작): 'N+M개입' 형식 (중품, 예: 10+1개입 / 20+2개입)
        const cm2 = t.match(/(\d+)\s*\+\s*(\d+)\s*개/);
        if (cm2) {
            const result = '초당옥수수 / 중품 ' + cm2[1] + '+' + cm2[2] + '개입';
            if (PRODUCT_CATALOG.has(result)) return result;
            return '[미매칭] ' + t.trim();
        }
        // 애플초당옥수수(종료): 'N개입' 단위 — 카탈로그 제거로 [미매칭] 처리됨
        const cm = t.match(/(\d+)\s*개/);
        const result = cm ? ('애플초당옥수수 미니 / ' + cm[1] + '개입') : null;
        if (result && PRODUCT_CATALOG.has(result)) return result;
        return '[미매칭] ' + t.trim();
    }
    // 중량up 행사: "3kg→중량up 5kg" 등 패턴에서 업그레이드된 중량 추출
    const weightUpMatch = t.match(/중량\s*(?:up|업|UP)\s*(\d+\.?\d*)\s*kg/i);
    const wm = weightUpMatch ? weightUpMatch : t.match(/(\d+\.?\d*)\s*kg/i);
    if (!wm) return '[미매칭] ' + t.trim();
    const w = parseFloat(wm[1]);
    const wStr = w + 'kg';

    let result = null;

    if (/수라향.*한라봉.*카라향|한라봉.*카라향.*수라향|수라향.*카라향.*한라봉|카라향.*수라향.*한라봉|카라향.*한라봉.*수라향|한라봉.*수라향.*카라향/.test(t)) {
        result = '★추천 선물세트 / 상품 및 과수: 수라향&한라봉&카라향 ' + wStr + '(3종세트)';
    } else if (/2종세트|한라봉.*카라향|카라향.*한라봉/.test(t)) {
        result = '★추천 선물세트 / 상품 및 과수: 한라봉&카라향 ' + wStr + '(2종세트)';
    } else if (/3종세트|레드향.*한라봉.*천혜향|한라봉.*천혜향.*레드향/.test(t)) {
        result = '★추천 선물세트 / 상품 및 과수: 레드향&한라봉&천혜향 ' + wStr + '(3종세트)';
    } else if (/블러드오렌지|블러드\s*오렌지/.test(t)) {
        if (/못난이/.test(t)) {
            result = '블러드오렌지 / 상품 및 과수: 블러드오렌지 못난이 ' + wStr + '(랜덤과)';
        } else {
            result = '블러드오렌지 / 상품 및 과수: 블러드오렌지 가정용 ' + wStr + '(랜덤과)';
        }
    } else if (/수라향/.test(t)) {
        if (/선물/.test(t)) {
            const detail = w === 3 ? '중대과 10~16과' : '중대과 15~25과';
            result = '살살녹는 수라향 / 상품 및 과수: 수라향 선물용 - ' + wStr + '(' + detail + ')';
        } else if (/못난이/.test(t)) {
            result = '살살녹는 수라향 / 상품 및 과수: 수라향 못난이 - ' + wStr + '(랜덤과)';
        } else {
            result = '살살녹는 수라향 / 상품 및 과수: 수라향 가정용 - ' + wStr + '(랜덤과)';
        }
    } else if (/레몬/.test(t)) {
        if (/못난이/.test(t)) result = '과수 및 크기: 제주 못난이 레몬' + wStr + '(랜덤과)';
        else result = '과수 및 크기: 제주 레몬' + wStr + '(혼합과)';
    } else if (/미니밤호박|밤호박|호박/.test(t)) {
        if (/꼬마|한입/.test(t)) {
            const detail = w === 3 ? '15과 전후' : w === 5 ? '25과 전후' : w === 10 ? '50과 전후' : '';
            result = '미니밤호박 꼬마 / 상품 및 과수: 한입밤호박 ' + wStr + '(' + detail + ')';
        } else if (/못난이/.test(t)) {
            result = '미니밤호박 중품못난이 / 상품 및 과수: 못난이 ' + wStr + '(랜덤과)';
        } else {
            const detail = w === 3 ? '6~12개' : w === 5 ? '10~20개' : w === 10 ? '20~40개' : '';
            result = '미니밤호박 특품최상급 / 상품 및 과수: 특품 ' + wStr + '(' + detail + ')';
        }
    } else if (/하우스감귤/.test(t)) {
        if (/선물/.test(t)) {
            result = '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 선물용 - ' + wStr + '(로얄과)';
        } else if (/중대과/.test(t)) {
            result = '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - ' + wStr + '(중대과)';
        } else if (/소과/.test(t)) {
            result = '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - ' + wStr + '(소과)';
        } else {
            result = '고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - ' + wStr + '(로얄과)';
        }
    } else if (/청귤|풋귤/.test(t)) {
        result = '최상품 청귤(풋귤) ' + wStr;
    } else if (/비가림|감귤/.test(t)) {
        if (/소과|2S미만/.test(t)) result = '고당도 비가림귤 / 상품 및 과수: 소과 - ' + wStr + '(가정용 2S미만)';
        else if (/선물용|프리미엄\s*로얄/.test(t)) result = '고당도 비가림귤 / 상품 및 과수: 프리미엄 로얄과 - ' + wStr + '(선물용 2S~M)';
        else if (/중대과|[lL]이상|대과/.test(t)) result = '고당도 비가림귤 / 상품 및 과수: 중대과 - ' + wStr + '(가정용 L이상)';
        else result = '고당도 비가림귤 / 상품 및 과수: 로얄과 - ' + wStr + '(가정용 2S~M)';
    } else if (/자몽/.test(t)) {
        if (/못난이/.test(t)) {
            result = '제주자몽 / 상품 및 과수: 제주자몽 못난이 ' + wStr + '(랜덤과)';
        } else {
            const type = /선물/.test(t) ? '선물용' : '가정용';
            const detail = w === 3 ? '10과전후' : w === 5 ? '17과전후' : '';
            result = '제주자몽 / 상품 및 과수: 제주자몽 ' + type + ' ' + wStr + '(' + detail + ')';
        }
    } else if (/카라향/.test(t)) {
        if (/선물/.test(t)) {
            result = '새콤달콤 카라향 / 상품 및 과수: 카라향 선물용 - ' + wStr + '(10~17과)';
        } else {
            const detail = w === 3 ? '24과 전후' : w === 5 ? '40과 전후' : w === 9 ? '72과 전후' : '';
            result = '새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - ' + wStr + '(' + detail + ')';
        }
    } else if (/취나물/.test(t)) {
        result = '제주 취나물 / 상품 및 과수: 제주 취나물 - ' + wStr;
    } else if (/하귤/.test(t)) {
        result = '제주 하귤 / 상품 및 과수: 하귤 가정용 ' + wStr + '(랜덤과)';
    } else if (/세미놀/.test(t)) {
        if (/못난이/.test(t)) {
            result = '맛이진한 세미놀귤 / 세미놀귤 못난이 - ' + wStr + '(랜덤과)';
        } else {
            result = '맛이진한 세미놀귤 / 세미놀귤 가정용 - ' + wStr + '(랜덤과)';
        }
    } else if (/황금향/.test(t)) {
        if (/선물/.test(t)) {
            const detail = w === 3 ? '대과 7~15과' : w === 5 ? '대과 13~23과' : '';
            result = '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - ' + wStr + '(' + detail + ')';
        } else {
            const detail = w === 3 ? '중소과 17과 전후' : w === 5 ? '중소과 27과 전후' : '';
            result = '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - ' + wStr + '(' + detail + ')';
        }
    } else {
        let fruit;
        if (/레드향/.test(t)) fruit = '레드향';
        else if (/한라봉/.test(t)) fruit = '한라봉';
        else if (/천혜향/.test(t)) fruit = '천혜향';

        if (!fruit) return '[미매칭] ' + t.trim();

        if (/꼬마/.test(t) && fruit === '천혜향') {
            const detail = w === 5 ? '30과 전후' : w === 9 ? '55과 전후' : '';
            result = '과즙팡팡 천혜향 / 상품 및 과수: 꼬마 천혜향 가정용 - ' + wStr + '(' + detail + ')';
        } else if (/꼬마/.test(t) && fruit === '한라봉') {
            const detail = w === 5 ? '30과 전후' : w === 9 ? '54과 전후' : '';
            result = '하우스 한라봉 / 상품 및 과수: 꼬마 한라봉 - ' + wStr + '(' + detail + ')';
        } else if (w === 2 && /프리미엄/.test(t)) {
            result = '프리미엄 선물용 / 상품 및 과수: 프리미엄 선물용 ' + fruit + ' - 2kg';
        } else {
            let type;
            if (/못난이/.test(t)) type = '못난이';
            else if (/선물용/.test(t)) type = '선물용';
            else type = '가정용';

            let category;
            if (fruit === '레드향') category = '알알톡톡 레드향';
            else if (fruit === '천혜향') category = /프리미엄/.test(t) ? '프리미엄 천혜향' : '과즙팡팡 천혜향';
            else {
                const isNoji = /노지/.test(t) || (type === '가정용' && /랜덤/.test(t));
                category = isNoji ? '노지 한라봉' : '하우스 한라봉';
            }

            let detail;
            if (type === '못난이') detail = '랜덤과';
            else if (type === '선물용') detail = w === 3 ? '대과 7~13과' : w === 5 ? '대과 12~22과' : '';
            else {
                if (category === '노지 한라봉') detail = '랜덤과';
                else if (w === 9) detail = '중과 45과 전후';
                else if (fruit === '천혜향') detail = w === 3 ? '중소과 15과 전후' : w === 5 ? '중소과 25과 전후' : '';
                else detail = w === 3 ? '중소과 18과 전후' : w === 5 ? '중소과 28과 전후' : w === 10 ? '중소과 55과 전후' : '';
            }
            result = category + ' / 상품 및 과수: ' + fruit + ' ' + type + ' - ' + wStr + '(' + detail + ')';
        }
    }

    // 카탈로그 검증: 생성된 품목명이 카탈로그에 없으면 원본 그대로 + [미매칭]
    if (result && PRODUCT_CATALOG.has(result)) return result;
    return '[미매칭] ' + t.trim();
}

function addSizeSuffix(optionInfo, msg) {
    let detectedSize = detectSize(msg);
    if (!detectedSize && /귤/.test(optionInfo) && /작은|작게|작다|작아|소과/.test(msg)) detectedSize = 'S';
    if (detectedSize) optionInfo = optionInfo.trim() + ' ' + detectedSize + '사이즈로!';
    return optionInfo;
}

// 스마트스토어 변환
function convertDataSmart(data) {
    const addr = document.getElementById('invoice-sender-address').value.trim();
    return data.map(row => {
        const buyer = (row['구매자명'] || '').trim();
        let opt = matchProduct(row['옵션정보'] || '');
        opt = addSizeSuffix(opt, (row['배송메세지'] || '').trim());
        return {
            '보내는사람': buyer ? buyer + '(제주아꼼이네)' : '',
            '보내는사람연락처': (row['구매자연락처'] || '').includes('*') ? '010-6687-4031' : (row['구매자연락처'] || ''),
            '출고지': addr,
            '수취인명': ((row['수취인명'] || '').trim().length === 1) ? row['수취인명'].trim() + '*' : (row['수취인명'] || ''),
            '옵션정보': opt, '수량': parseInt(row['수량']) || 1,
            '수취인연락처1': row['수취인연락처1'] || '', '수취인연락처2': row['수취인연락처2'] || '',
            '배송지': row['통합배송지'] || '', '배송메세지': row['배송메세지'] || '', '구매자연락처': row['구매자연락처'] || ''
        };
    });
}

// 자사몰 변환
function convertDataJasamol(data) {
    const addr = document.getElementById('invoice-sender-address').value.trim();
    return data.map(row => {
        const buyer = (row['주문자명'] || '').trim();
        let opt = matchProduct(row['주문상품명(세트상품 포함)'] || '');
        opt = addSizeSuffix(opt, (row['배송메시지'] || '').trim());
        const recip = (row['수령인'] || '').trim();
        return {
            '보내는사람': buyer ? buyer + '(제주아꼼이네 자사몰)' : '',
            '보내는사람연락처': (row['주문자 휴대전화'] || '').includes('*') ? '010-6687-4031' : (row['주문자 휴대전화'] || ''),
            '출고지': addr,
            '수취인명': (recip.length === 1) ? recip + '*' : recip,
            '옵션정보': opt, '수량': parseInt(row['수량']) || 1,
            '수취인연락처1': row['수령인 휴대전화'] || '', '수취인연락처2': '',
            '배송지': row['수령인 주소(전체)'] || '', '배송메세지': row['배송메시지'] || '', '구매자연락처': row['주문자 휴대전화'] || ''
        };
    });
}

// 쿠팡 변환
function convertDataCoupang(data) {
    const addr = document.getElementById('invoice-sender-address').value.trim();
    return data.map(row => {
        const buyer = (row['구매자'] || '').trim();
        const raw = (row['등록상품명'] || '') + ' ' + (row['노출상품명(옵션명)'] || '');
        let opt = matchProduct(raw);
        opt = addSizeSuffix(opt, (row['배송메세지'] || '').trim());
        const recip = (row['수취인이름'] || '').trim();
        return {
            '보내는사람': buyer ? buyer + '(제주아꼼이네 쿠팡)' : '',
            '보내는사람연락처': (row['구매자전화번호'] || '').includes('*') ? '010-6687-4031' : (row['구매자전화번호'] || ''),
            '출고지': addr,
            '수취인명': (recip.length === 1) ? recip + '*' : recip,
            '옵션정보': opt, '수량': parseInt(row['구매수(수량)']) || 1,
            '수취인연락처1': row['수취인전화번호'] || '', '수취인연락처2': '',
            '배송지': row['수취인 주소'] || '', '배송메세지': row['배송메세지'] || '', '구매자연락처': row['구매자전화번호'] || ''
        };
    });
}

// 엑셀 내보내기 (스타일 포함)
function exportInvoiceExcel(converted) {
    const wb = XLSX.utils.book_new();
    const headers = ['보내는사람', '보내는사람연락처', '출고지', '수취인명', '옵션정보', '수량', '수취인연락처1', '수취인연락처2', '배송지', '배송메세지', '구매자연락처'];
    const ws = XLSX.utils.json_to_sheet(converted, { header: headers });
    ws['!cols'] = [
        { wch: 18.5 }, { wch: 14.25 }, { wch: 50.75 }, { wch: 13.75 },
        { wch: 60.25 }, { wch: 5.5 }, { wch: 14.75 }, { wch: 14.75 },
        { wch: 73.25 }, { wch: 51 }, { wch: 13 },
    ];

    const thinBorder = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    const hGreen = { fill: { fgColor: { rgb: '92D050' } }, font: { bold: true, name: '맑은 고딕', sz: 11 }, border: thinBorder, alignment: { horizontal: 'center', vertical: 'center' } };
    const hYellow = { fill: { fgColor: { rgb: 'FFFF00' } }, font: { bold: true, name: '맑은 고딕', sz: 11 }, border: thinBorder, alignment: { horizontal: 'center', vertical: 'center' } };
    const dStyle = { border: thinBorder, font: { name: '맑은 고딕', sz: 11 }, alignment: { vertical: 'center' } };
    const dRed = { border: thinBorder, font: { name: '맑은 고딕', sz: 11, color: { rgb: 'FF0000' }, bold: true }, fill: { fgColor: { rgb: 'FFC7CE' } }, alignment: { vertical: 'center' } };
    const dYellow = { border: thinBorder, font: { name: '맑은 고딕', sz: 11 }, fill: { fgColor: { rgb: 'FFFF00' } }, alignment: { vertical: 'center' } };
    // 거래처별 색상 (대표 7/21 — 품목명 셀 E열): 효돈=아주 연한 파랑, 시온=아주 연한 보라, 기타=아주 연한 갈색
    const mkPartnerStyle = rgb => ({ border: thinBorder, font: { name: '맑은 고딕', sz: 11 }, fill: { fgColor: { rgb } }, alignment: { vertical: 'center' } });
    const AO_PARTNER_XLS = { '효돈농협': mkPartnerStyle('E8F1FB'), '대성(시온)': mkPartnerStyle('F0EAF8'), '기타거래처': mkPartnerStyle('F2EBE3') };

    function hasDateRequest(msg) {
        if (!msg) return false;
        return /다음\s*주|다음\s*날|내일|모레|글피|\d+일|\d+월|\d+\/\d+|월요|화요|수요|목요|금요|토요|일요|주말|평일|다다음|이번\s*주|일주일|[이삼사오육칠팔]\s*일\s*뒤|[이삼사오육칠팔]\s*일\s*후|\d+\s*일\s*뒤|\d+\s*일\s*후|며칠|몇\s*일/.test(msg);
    }

    const cols = ['A','B','C','D','E','F','G','H','I','J','K'];
    cols.forEach((col, i) => { const ref = col + '1'; if (ws[ref]) ws[ref].s = i < 3 ? hGreen : hYellow; });

    for (let r = 2; r <= converted.length + 1; r++) {
        const msgVal = ws['J' + r] ? String(ws['J' + r].v || '') : '';
        const isDateReq = hasDateRequest(msgVal);
        const addrVal = ws['I' + r] ? String(ws['I' + r].v || '') : '';
        const isJeju = /제주/.test(addrVal);
        const optVal = ws['E' + r] ? String(ws['E' + r].v || '') : '';
        const isUnmatched = optVal.startsWith('[미매칭]');
        const partnerStyle = isUnmatched ? null : AO_PARTNER_XLS[aoItemPartner(optVal)]; // 거래처별 품목 셀 색상 (대표 7/21)
        cols.forEach(col => {
            const ref = col + r;
            let style = dStyle;
            if (isUnmatched && col === 'E') style = dRed;
            else if (col === 'E' && partnerStyle) style = partnerStyle; // 매칭 품목 = 거래처 색
            else if (isDateReq && col === 'J') style = dRed;
            else if (isJeju && col === 'I') style = dYellow;
            if (ws[ref]) ws[ref].s = style;
            else ws[ref] = { v: '', t: 's', s: style };
        });
    }

    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const today = new Date();
    const dateStr = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `송장_${dateStr}.xlsx`);
    document.getElementById('invoice-success-msg').style.display = '';
}

// 채널 초기화
setupInvoiceArea('invoice-upload-smart', 'invoice-file-smart', 'invoice-filename-smart', 1, convertDataSmart, 'smart');
setupInvoiceArea('invoice-upload-jasamol', 'invoice-file-jasamol', 'invoice-filename-jasamol', 0, convertDataJasamol, 'jasamol');
setupInvoiceArea('invoice-upload-coupang', 'invoice-file-coupang', 'invoice-filename-coupang', 0, convertDataCoupang, 'coupang');

// 송장변환 초기화
function resetInvoice() {
    invoiceDataSmart = null;
    invoiceDataJasamol = null;
    invoiceDataCoupang = null;

    ['smart', 'jasamol', 'coupang'].forEach(ch => {
        const fileInput = document.getElementById(`invoice-file-${ch}`);
        const fileName = document.getElementById(`invoice-filename-${ch}`);
        const area = document.getElementById(`invoice-upload-${ch}`);
        if (fileInput) fileInput.value = '';
        if (fileName) fileName.textContent = '';
        if (area) area.classList.remove('has-file');
    });

    document.getElementById('invoice-merge-btn').disabled = true;
    document.getElementById('invoice-success-msg').style.display = 'none';
    document.getElementById('invoice-preview-section').style.display = 'none';
    document.getElementById('invoice-table-wrapper').innerHTML = '';
    document.getElementById('invoice-total-orders').textContent = '0';
    document.getElementById('invoice-total-qty').textContent = '0';
    document.getElementById('invoice-unique-recipients').textContent = '0';
}
window.resetInvoice = resetInvoice;

// =============================================
// 송장변환 - 현재까지 수량 (모바일 중간발주표)
// =============================================
function switchInvoiceMode(mode) {
    const convert = document.getElementById('invoice-convert-mode');
    const qty = document.getElementById('invoice-qty-mode');
    const cBtn = document.getElementById('invoice-mode-convert-btn');
    const qBtn = document.getElementById('invoice-mode-qty-btn');
    if (mode === 'qty') {
        convert.style.display = 'none'; qty.style.display = '';
        cBtn.classList.remove('active'); qBtn.classList.add('active');
    } else {
        convert.style.display = ''; qty.style.display = 'none';
        cBtn.classList.add('active'); qBtn.classList.remove('active');
    }
}
window.switchInvoiceMode = switchInvoiceMode;

let qtyAggregated = [];   // [{ name, qty, cat, checked }]
let qtyRowsMain = [];     // 발주(스마트스토어) 파일 행
let qtyManual = [];       // 수기로 직접 추가한 품목 [{ name, qty }]
let qtyImageCounter = 1;

// 과일별 색상 분류 (사진 기준)
function qtyCategory(name) {
    if (name.startsWith('[미매칭]')) return 'none';
    if (/미니밤호박|밤호박|호박/.test(name)) return 'orange';
    if (/블러드오렌지/.test(name)) return 'blue';
    if (/자몽/.test(name)) return 'green';
    return 'yellow';
}

function arrayBufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}
function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

// 엑셀 버퍼 → 행 배열 (헤더행 자동 감지: '옵션정보' 포함 행). 암호화 등 실패 시 null
function parseInvoiceRows(data) {
    let wb;
    try { wb = XLSX.read(data, { type: 'array' }); } catch (e) { return null; }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    let hdrIdx = -1;
    for (let i = 0; i < Math.min(aoa.length, 10); i++) {
        if ((aoa[i] || []).some(c => String(c).trim() === '옵션정보')) { hdrIdx = i; break; }
    }
    if (hdrIdx < 0) return [];
    return XLSX.utils.sheet_to_json(ws, { range: hdrIdx, defval: '' });
}

// 발주 파일 업로드 → (필요 시 서버 복호화) → 파싱 → 재합산
async function handleQtyUpload(file) {
    document.getElementById('invoice-qty-filename').textContent = file.name;
    document.getElementById('invoice-qty-upload').classList.add('has-file');
    const loading = document.getElementById('invoice-qty-loading');
    loading.style.display = '';
    try {
        const buf = await file.arrayBuffer();
        // 먼저 그대로 읽어보고(암호화 X), 실패하거나 빈 결과면 서버 복호화
        let rows = parseInvoiceRows(buf);
        if (!rows || rows.length === 0) {
            const resp = await api('/api/invoice/decrypt', 'POST', { fileBase64: arrayBufferToBase64(buf) });
            rows = parseInvoiceRows(base64ToArrayBuffer(resp.fileBase64));
        }
        rows = rows || [];
        if (rows.length === 0) {
            alert('품목 데이터를 찾을 수 없습니다. 올바른 파일인지 확인해주세요.');
            return;
        }
        qtyRowsMain = rows;
        recomputeQtyAggregate();
        document.getElementById('invoice-qty-result').style.display = '';
    } catch (err) {
        alert('파일 처리 오류: ' + err.message);
    } finally {
        loading.style.display = 'none';
    }
}

// 발주 파일 + 수기 추가 품목을 합쳐 품목별 합산 (수기 수정은 재합산 시 초기화됨)
function recomputeQtyAggregate() {
    const map = new Map();
    qtyRowsMain.forEach(row => {
        const name = matchProduct(row['옵션정보'] || '');
        const q = parseInt(row['수량']) || 1;
        map.set(name, (map.get(name) || 0) + q);
    });
    qtyManual.forEach(it => {
        map.set(it.name, (map.get(it.name) || 0) + it.qty);
    });
    qtyAggregated = Array.from(map.entries())
        .map(([name, qty]) => ({ name, qty, cat: qtyCategory(name), checked: true }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    renderQtyList();
}

// 품목추가 폼 토글
function toggleAddItemForm() {
    const form = document.getElementById('invoice-qty-addform');
    const show = form.style.display === 'none';
    form.style.display = show ? 'flex' : 'none';
    if (show) { document.getElementById('qty-add-name').value = ''; document.getElementById('qty-add-qty').value = ''; document.getElementById('qty-add-name').focus(); }
}
window.toggleAddItemForm = toggleAddItemForm;

// 수기 품목 추가 → 합산 목록에 반영
function confirmAddItem() {
    const name = document.getElementById('qty-add-name').value.trim();
    const qty = parseInt(document.getElementById('qty-add-qty').value);
    if (!name) { alert('품목명을 입력해주세요.'); return; }
    if (isNaN(qty) || qty <= 0) { alert('수량을 1 이상 입력해주세요.'); return; }
    qtyManual.push({ name, qty });
    recomputeQtyAggregate();
    document.getElementById('invoice-qty-result').style.display = '';
    toggleAddItemForm();
}
window.confirmAddItem = confirmAddItem;

// 중간발주 거래처 필터 (대표 7/21): 품목추가 옆 — 전체보기/효돈농협/대성(시온)/기타거래처
let aoQtyPartnerFilter = '전체';
const AO_QTY_PARTNERS = ['전체', '효돈농협', '대성(시온)', '기타거래처'];
function aoRenderQtyPartnerFilter() {
    const box = document.getElementById('qty-partner-filter');
    if (!box) return;
    box.innerHTML = AO_QTY_PARTNERS.map(p =>
        `<button class="btn-sm ${p === aoQtyPartnerFilter ? 'btn-primary' : 'btn-outline'}" style="margin-right:4px;" onclick="aoSetQtyPartnerFilter('${p === '전체' ? '전체' : p.replace(/'/g,"\\'")}')">${p === '전체' ? '전체보기' : p}</button>`
    ).join('');
}
window.aoSetQtyPartnerFilter = function(p) { aoQtyPartnerFilter = p; renderQtyList(); };
function renderQtyList() {
    aoRenderQtyPartnerFilter();
    const list = document.getElementById('invoice-qty-list');
    list.innerHTML = qtyAggregated.map((it, i) => {
        // 거래처 필터 (전체보기면 전부, 아니면 해당 거래처 품목만)
        if (aoQtyPartnerFilter !== '전체' && aoItemPartner(it.name) !== aoQtyPartnerFilter) return '';
        return `
        <div class="qty-row qty-cat-${it.cat} ${it.checked ? '' : 'unchecked'} ${it.cat === 'none' ? 'unmatched' : ''}" onclick="toggleQtyRow(${i})">
            <input type="checkbox" ${it.checked ? 'checked' : ''} onclick="event.stopPropagation(); toggleQtyRow(${i})">
            <span class="qty-name">${it.name}</span>
            <input type="number" class="qty-num-input" value="${it.qty}" min="0" onclick="event.stopPropagation()" onchange="editQtyNum(${i}, this.value)">
        </div>`;
    }).join('');
    updateQtySummary();
}

// 수량 수기 수정 (다운로드 이미지에 그대로 반영)
function editQtyNum(i, val) {
    const n = parseInt(val);
    qtyAggregated[i].qty = isNaN(n) || n < 0 ? 0 : n;
    updateQtySummary();
}
window.editQtyNum = editQtyNum;

function toggleQtyRow(i) {
    qtyAggregated[i].checked = !qtyAggregated[i].checked;
    renderQtyList();
}
window.toggleQtyRow = toggleQtyRow;

function qtySelectAll(val) {
    qtyAggregated.forEach(it => it.checked = val);
    renderQtyList();
}
window.qtySelectAll = qtySelectAll;

function updateQtySummary() {
    const sel = qtyAggregated.filter(it => it.checked);
    document.getElementById('invoice-qty-sel-count').textContent = sel.length;
    document.getElementById('invoice-qty-sel-total').textContent = sel.reduce((s, it) => s + it.qty, 0);
}

// 선택된 품목으로 중간발주표 이미지 생성 → 자동 다운로드
async function saveQtyImage() {
    // 거래처 필터 적용 (대표 7/21): 화면에 보이는 것만 저장 — 거래처 선택 시 미매칭·타 거래처 제외
    const sel = qtyAggregated.filter(it => it.checked && (aoQtyPartnerFilter === '전체' || aoItemPartner(it.name) === aoQtyPartnerFilter));
    if (sel.length === 0) { alert('선택된 품목이 없습니다.'); return; }
    const total = sel.reduce((s, it) => s + it.qty, 0);

    const cap = document.createElement('div');
    cap.id = 'invoice-qty-capture';
    let html = '<table><tbody>';
    sel.forEach(it => {
        html += `<tr><td class="cap-name qty-cat-${it.cat}">${it.name}</td><td class="cap-num">${it.qty}</td></tr>`;
    });
    html += `<tr class="cap-total"><td class="cap-name qty-cat-yellow"></td><td class="cap-num qty-cat-yellow">${total}</td></tr>`;
    html += '</tbody></table>';
    cap.innerHTML = html;
    document.body.appendChild(cap);

    try {
        const canvas = await html2canvas(cap, { scale: 2, backgroundColor: '#ffffff' });
        const fileName = `중간발주${qtyImageCounter}.png`;
        await new Promise(resolve => {
            canvas.toBlob(blob => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = fileName;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                resolve();
            }, 'image/png');
        });
        qtyImageCounter++;
    } catch (err) {
        alert('이미지 생성 오류: ' + err.message);
    } finally {
        document.body.removeChild(cap);
    }
}
window.saveQtyImage = saveQtyImage;

// 초기화 (파일/목록/결과/수기품목 비우기)
function resetInvoiceQty() {
    qtyAggregated = []; qtyRowsMain = []; qtyManual = [];
    const f = document.getElementById('invoice-qty-file'); if (f) f.value = '';
    document.getElementById('invoice-qty-filename').textContent = '';
    document.getElementById('invoice-qty-upload').classList.remove('has-file');
    document.getElementById('invoice-qty-loading').style.display = 'none';
    document.getElementById('invoice-qty-result').style.display = 'none';
    document.getElementById('invoice-qty-list').innerHTML = '';
    const addform = document.getElementById('invoice-qty-addform');
    if (addform) addform.style.display = 'none';
}
window.resetInvoiceQty = resetInvoiceQty;

// 업로드 영역 이벤트 (발주 파일)
(function setupQtyArea() {
    const area = document.getElementById('invoice-qty-upload');
    const input = document.getElementById('invoice-qty-file');
    if (!area || !input) return;
    area.addEventListener('click', () => input.click());
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', e => {
        e.preventDefault(); area.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleQtyUpload(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', e => { if (e.target.files.length) handleQtyUpload(e.target.files[0]); });
})();

// =============================================
// Utility
// =============================================
function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

document.querySelectorAll('input[type="date"]').forEach(input => {
    input.addEventListener('click', () => { if (input.showPicker) input.showPicker(); });
});

// =============================================
// Init
// =============================================
async function init() {
    try {
        // 세무사: 일정 페이지 대신 지출결의서로 자동 이동
        if (currentUser?.role === 'accountant') {
            switchPage('expense');
            return;
        }
        await renderScheduleCalendar();
        await renderSettlementList();
        await renderPricingList();
        if (currentUser?.role === 'admin') await renderUserList();
    } catch (err) {
        console.error('초기화 오류:', err);
    }
}

checkAuth();

// =============================================
// 선결제 관리
// =============================================

async function renderPrepaymentCard() {
    const card = document.getElementById('prepayment-card');
    if (!card) return;
    card.style.display = currentUser?.role === 'admin' ? '' : 'none';
    if (currentUser?.role === 'admin') {
        await renderPrepaymentList();
    }
}

async function renderPrepaymentList() {
    try {
        const data = await api('/api/prepayments');
        const tbody = document.getElementById('prepayment-list');
        if (data.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="5">지급결제 내역이 없습니다.</td></tr>';
        } else {
            tbody.innerHTML = data.map(item => `<tr>
                <td>${item.date}</td>
                <td>${item.partner}</td>
                <td>${item.amount.toLocaleString()} 원</td>
                <td>${item.note || '-'}</td>
                <td><button class="btn-danger" onclick="deletePrepayment(${item.id})">삭제</button></td>
            </tr>`).join('');
        }
    } catch (err) {
        console.error('선결제 목록 오류:', err);
    }
}

// 지급결제 금액 입력 시 천 단위 콤마 자동 표시 (마이너스 지원)
document.getElementById('prepay-amount').addEventListener('input', function(e) {
    const raw = e.target.value;
    const isNegative = raw.startsWith('-');
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits) {
        e.target.value = (isNegative ? '-' : '') + Number(digits).toLocaleString();
    } else {
        e.target.value = isNegative ? '-' : '';
    }
});

document.getElementById('prepay-save').addEventListener('click', async () => {
    const partner = document.getElementById('prepay-partner').value;
    const amount = Number(document.getElementById('prepay-amount').value.replace(/,/g, ''));
    const date = document.getElementById('prepay-date').value;
    const note = document.getElementById('prepay-note').value.trim();

    if (!partner) return alert('거래처를 선택해주세요.');
    if (!amount) return alert('금액을 입력해주세요.');
    if (!date) return alert('날짜를 선택해주세요.');

    try {
        await api('/api/prepayments', 'POST', { partner, amount, date, note });
        document.getElementById('prepay-partner').value = '';
        document.getElementById('prepay-amount').value = '';
        document.getElementById('prepay-date').value = '';
        document.getElementById('prepay-note').value = '';
        await renderPrepaymentList();
        await renderSettlementCalendar();
        alert('지급결제가 추가되었습니다.');
    } catch (err) {
        alert('추가 실패: ' + err.message);
    }
});

window.deletePrepayment = async function(id) {
    if (!confirm('이 지급결제 내역을 삭제하시겠습니까?')) return;
    try {
        await api(`/api/prepayments/${id}`, 'DELETE');
        await renderPrepaymentList();
        await renderSettlementCalendar();
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};

// =============================================
// 주간 정산 현황
// =============================================

// -- CJ 이월금액 모달 --
window.openCjCarryoverModal = async function() {
    const monthStr = `${settlementCalYear}-${String(settlementCalMonth + 1).padStart(2, '0')}`;
    document.getElementById('cj-carryover-month').value = monthStr;
    try {
        const data = await api(`/api/cj-carryover?month=${monthStr}`);
        document.getElementById('cj-carryover-start').value = data.start_date || '';
        document.getElementById('cj-carryover-end').value = data.end_date || '';
        document.getElementById('cj-carryover-amount').value = data.amount || '';
        document.getElementById('cj-carryover-note').value = data.note || '';
    } catch (e) {
        document.getElementById('cj-carryover-start').value = '';
        document.getElementById('cj-carryover-end').value = '';
        document.getElementById('cj-carryover-amount').value = '';
        document.getElementById('cj-carryover-note').value = '';
    }
    document.getElementById('cj-carryover-modal').style.display = '';
};

// 종료일 변경 시 month 자동 설정
window.updateCjCarryoverMonth = function() {
    const endDate = document.getElementById('cj-carryover-end').value;
    if (endDate) {
        document.getElementById('cj-carryover-month').value = endDate.substring(0, 7);
    }
};

window.saveCjCarryover = async function() {
    const startDate = document.getElementById('cj-carryover-start').value;
    const endDate = document.getElementById('cj-carryover-end').value;
    if (!startDate || !endDate) { alert('시작일과 종료일을 입력해주세요.'); return; }
    const month = endDate.substring(0, 7);
    const amount = Number(document.getElementById('cj-carryover-amount').value) || 0;
    const note = document.getElementById('cj-carryover-note').value.trim();
    try {
        await api('/api/cj-carryover', 'POST', { month, amount, note, startDate, endDate });
        document.getElementById('cj-carryover-modal').style.display = 'none';
        await renderSettlementCalendar();
    } catch (err) { alert('저장 실패: ' + err.message); }
};

async function renderWeeklySettlement() {
    const tbody = document.getElementById('weekly-settlement-list');
    if (!tbody) return;

    const monthStr = `${settlementCalYear}-${String(settlementCalMonth + 1).padStart(2, '0')}`;

    try {
        // 주차가 이전/다음 달에 걸칠 수 있으므로 전후 월 데이터도 가져옴
        const prevMonth = settlementCalMonth === 0 ? 12 : settlementCalMonth;
        const prevYear = settlementCalMonth === 0 ? settlementCalYear - 1 : settlementCalYear;
        const nextMonth = settlementCalMonth === 11 ? 1 : settlementCalMonth + 2;
        const nextYear = settlementCalMonth === 11 ? settlementCalYear + 1 : settlementCalYear;
        const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
        const nextMonthStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

        const [settCurr, settPrev, settNext, prepayments, cjDailyAll] = await Promise.all([
            api(`/api/settlements?month=${monthStr}`),
            api(`/api/settlements?month=${prevMonthStr}`),
            api(`/api/settlements?month=${nextMonthStr}`),
            api('/api/prepayments'),
            Promise.all([
                api(`/api/cj-daily-payments?month=${monthStr}`).catch(() => []),
                api(`/api/cj-daily-payments?month=${prevMonthStr}`).catch(() => []),
                api(`/api/cj-daily-payments?month=${nextMonthStr}`).catch(() => [])
            ]).then(arr => [...arr[0], ...arr[1], ...arr[2]])
        ]);
        const settlements = [...settPrev, ...settCurr, ...settNext];
        const weeklyCjPaidMap = {};
        cjDailyAll.forEach(c => { weeklyCjPaidMap[c.date] = c.isPaid || false; });

        const weeks = getWeeksInMonth(settlementCalYear, settlementCalMonth);

        if (weeks.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">데이터가 없습니다.</td></tr>';
            return;
        }

        let html = '';
        weeks.forEach((week, idx) => {
            let daesungTotal = 0, hyodonTotal = 0, aewolTotal = 0, cjTotal = 0;

            // CJ 일별 금액을 날짜별로 모아서 결제완료 여부 확인
            const cjByDate = {};

            settlements.forEach(s => {
                if (s.date >= week.start && s.date <= week.end) {
                    if (s.partner === '대성(시온)') {
                        daesungTotal += (s.amount || 0);
                        const items = s.items || [];
                        const cjCost = items.reduce((sum, item) => sum + (item.qty || 0), 0) * 3100;
                        if (!cjByDate[s.date]) cjByDate[s.date] = 0;
                        cjByDate[s.date] += cjCost;
                    }
                    if (s.partner === '효돈농협') {
                        hyodonTotal += (s.amount || 0);
                        const items = s.items || [];
                        const cjCost = items.reduce((sum, item) => sum + (item.qty || 0), 0) * 3100;
                        if (!cjByDate[s.date]) cjByDate[s.date] = 0;
                        cjByDate[s.date] += cjCost;
                    }
                    if (s.partner === '기타거래처') {
                        aewolTotal += (s.amount || 0);
                        const items = s.items || [];
                        const cjCost = items.reduce((sum, item) => sum + (item.qty || 0), 0) * 3100;
                        if (!cjByDate[s.date]) cjByDate[s.date] = 0;
                        cjByDate[s.date] += cjCost;
                    }
                }
            });

            // CJ: 모든 날짜 금액 합산 (달력과 동일하게)
            Object.keys(cjByDate).forEach(date => {
                cjTotal += cjByDate[date];
            });

            // 해당 주차 선결제 합계
            let weekPrepay = 0;
            prepayments.forEach(p => {
                if (p.date >= week.start && p.date <= week.end) {
                    weekPrepay += (p.amount || 0);
                }
            });

            const weekTotal = daesungTotal + hyodonTotal + aewolTotal + cjTotal - weekPrepay;

            // 날짜 라벨: M/D 형태
            const sDate = new Date(week.start + 'T00:00:00');
            const eDate = new Date(week.end + 'T00:00:00');
            const startLabel = `${sDate.getMonth() + 1}/${sDate.getDate()}`;
            const endLabel = `${eDate.getMonth() + 1}/${eDate.getDate()}`;
            const weekLabel = `${idx + 1}주차<br><span style="font-size:11px; color:#6b7280;">${startLabel} ~ ${endLabel}</span>`;

            // 클릭 가능한 거래처 금액 셀 (해당 주차 결제금액 엑셀 다운로드)
            const partnerLink = (partner, total) => total > 0
                ? `<a href="#" onclick="downloadPartnerWeeklySettlement('${partner}','${week.start}','${week.end}');return false;" title="해당 주차 결제금액 엑셀 다운로드" style="color:#0066CC;text-decoration:underline;cursor:pointer;font-weight:600;">${total.toLocaleString()} 원 📥</a>`
                : '-';

            html += `<tr>
                <td>${weekLabel}</td>
                <td>${partnerLink('대성(시온)', daesungTotal)}</td>
                <td>${partnerLink('효돈농협', hyodonTotal)}</td>
                <td>${partnerLink('기타거래처', aewolTotal)}</td>
                <td>${cjTotal > 0 ? cjTotal.toLocaleString() + ' 원' : '-'}</td>
                <td>${weekPrepay !== 0 ? '<span style="color:#8b5cf6;">' + (weekPrepay > 0 ? '-' : '') + Math.abs(weekPrepay).toLocaleString() + ' 원</span>' : '-'}</td>
                <td><strong>${weekTotal !== 0 ? weekTotal.toLocaleString() + ' 원' : '-'}</strong></td>
            </tr>`;
        });

        tbody.innerHTML = html;
    } catch (err) {
        console.error('주간 정산 현황 오류:', err);
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">로드 실패</td></tr>';
    }
}

// 주간 거래처별 결제금액 엑셀 다운로드
// 양식: 옵션명 | 단가 | 요일별수량(월~일) | 총수량 | 금액 | 차감수량 | 차감금액 | 총 입금금액
// 차감수량만 입력하면 차감금액·총입금금액은 엑셀 수식으로 자동 계산
window.downloadPartnerWeeklySettlement = async function(partner, weekStart, weekEnd) {
    try {
        // 주차가 월 경계에 걸칠 수 있어 전후 월 모두 조회
        const startMonth = weekStart.substring(0, 7);
        const endMonth = weekEnd.substring(0, 7);
        const months = [...new Set([startMonth, endMonth])];
        const settsByMonth = await Promise.all(months.map(m => api(`/api/settlements?month=${m}`).catch(() => [])));
        const all = settsByMonth.flat();
        const target = all.filter(s => s.partner === partner && s.date >= weekStart && s.date <= weekEnd);

        if (target.length === 0) { alert('해당 주차에 정산 데이터가 없습니다.'); return; }

        // 주차의 7일 날짜 배열 (월~일)
        const days = [];
        const sD = new Date(weekStart + 'T00:00:00');
        const eD = new Date(weekEnd + 'T00:00:00');
        for (let d = new Date(sD); d <= eD; d.setDate(d.getDate() + 1)) {
            const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
            days.push(`${y}-${m}-${dd}`);
        }
        const dowLabels = ['일','월','화','수','목','금','토'];

        // 품목별 요일별 집계
        const byItem = {};
        target.forEach(s => {
            (s.items || []).forEach(it => {
                const name = it.name || '(미입력)';
                if (!byItem[name]) byItem[name] = { price: 0, qtyByDate: {}, totalQty: 0 };
                byItem[name].qtyByDate[s.date] = (byItem[name].qtyByDate[s.date] || 0) + (Number(it.qty) || 0);
                byItem[name].totalQty += (Number(it.qty) || 0);
                if (Number(it.price) > 0) byItem[name].price = Number(it.price);
            });
        });
        const itemNames = Object.keys(byItem).sort((a, b) => a.localeCompare(b, 'ko'));

        // 요일 헤더 (예: "월\n5/25")
        const dayHeaders = days.map(d => {
            const dt = new Date(d + 'T00:00:00');
            return `${dowLabels[dt.getDay()]}\n${dt.getMonth() + 1}/${dt.getDate()}`;
        });

        // 시트 데이터 (AoA)
        const rows = [];
        rows.push([`${partner} — 결제금액 (${weekStart} ~ ${weekEnd})`]);
        rows.push([]);
        // 컬럼 헤더 (14개): 옵션명/단가/요일7개/총수량/금액/차감수량/차감금액/총입금금액
        rows.push(['옵션명', '단가', ...dayHeaders, '총수량', '금액', '차감수량', '차감금액', '총 입금금액']);

        const dayQtyTotals = days.map(() => 0);
        let grandQty = 0, grandAmount = 0;
        itemNames.forEach(name => {
            const info = byItem[name];
            const qtys = days.map(d => info.qtyByDate[d] || 0);
            qtys.forEach((q, i) => { dayQtyTotals[i] += q; });
            const amt = info.price * info.totalQty;
            grandQty += info.totalQty;
            grandAmount += amt;
            // 차감수량은 기본 0 (사용자가 직접 수량을 입력하면 차감금액·총입금금액 자동 계산)
            rows.push([name, info.price, ...qtys, info.totalQty, amt, 0, 0, amt]);
        });
        // 합계 행 — 차감수량/차감금액/총입금금액은 합계 수식 주입
        const totalRowIdx = rows.length;
        rows.push(['합계', '', ...dayQtyTotals, grandQty, grandAmount, 0, 0, grandAmount]);

        const ws = XLSX.utils.aoa_to_sheet(rows);

        // 컬럼 인덱스 (0-based) 정리
        const PRICE_C = 1;
        const DAY_START = 2;
        const DAY_END = 2 + days.length - 1;
        const QTY_TOTAL_C = 2 + days.length;       // 총수량
        const AMOUNT_C = QTY_TOTAL_C + 1;          // 금액
        const DEDUCT_QTY_C = AMOUNT_C + 1;         // 차감수량
        const DEDUCT_AMT_C = DEDUCT_QTY_C + 1;     // 차감금액
        const FINAL_C = DEDUCT_AMT_C + 1;          // 총 입금금액
        const LAST_C = FINAL_C;
        const dataStart = 3;
        const dataEnd = 2 + itemNames.length;

        // ── 수식 주입: 데이터 행 ──
        // 차감금액 = 단가 × 차감수량  (차감수량 빈칸이면 Excel이 0으로 계산)
        // 총 입금금액 = 금액 - 차감금액
        for (let r = dataStart; r <= dataEnd; r++) {
            const excelRow = r + 1; // 1-based
            const priceRef = XLSX.utils.encode_col(PRICE_C) + excelRow;
            const amountRef = XLSX.utils.encode_col(AMOUNT_C) + excelRow;
            const deductQtyRef = XLSX.utils.encode_col(DEDUCT_QTY_C) + excelRow;
            const deductAmtRef = XLSX.utils.encode_col(DEDUCT_AMT_C) + excelRow;

            // 차감금액 셀
            const damtCell = XLSX.utils.encode_cell({ r, c: DEDUCT_AMT_C });
            ws[damtCell] = { t: 'n', v: 0, f: `${priceRef}*${deductQtyRef}` };
            // 총 입금금액 셀
            const finalCell = XLSX.utils.encode_cell({ r, c: FINAL_C });
            const initialFinal = Number(ws[finalCell] && ws[finalCell].v) || 0;
            ws[finalCell] = { t: 'n', v: initialFinal, f: `${amountRef}-${deductAmtRef}` };
        }

        // ── 수식 주입: 합계 행 ──
        const sumRowExcel = totalRowIdx + 1;
        const dataStartExcel = dataStart + 1;
        const dataEndExcel = dataEnd + 1;
        const sumRange = (col) => `SUM(${XLSX.utils.encode_col(col)}${dataStartExcel}:${XLSX.utils.encode_col(col)}${dataEndExcel})`;
        // 차감수량 합계
        ws[XLSX.utils.encode_cell({ r: totalRowIdx, c: DEDUCT_QTY_C })] = { t: 'n', v: 0, f: sumRange(DEDUCT_QTY_C) };
        // 차감금액 합계
        ws[XLSX.utils.encode_cell({ r: totalRowIdx, c: DEDUCT_AMT_C })] = { t: 'n', v: 0, f: sumRange(DEDUCT_AMT_C) };
        // 총 입금금액 합계
        ws[XLSX.utils.encode_cell({ r: totalRowIdx, c: FINAL_C })] = { t: 'n', v: grandAmount, f: sumRange(FINAL_C) };

        // 컬럼 너비
        ws['!cols'] = [
            { wch: 32 },                            // 옵션명
            { wch: 11 },                            // 단가
            ...days.map(() => ({ wch: 9 })),        // 요일별 7개
            { wch: 10 },                            // 총수량
            { wch: 13 },                            // 금액
            { wch: 11 },                            // 차감수량
            { wch: 13 },                            // 차감금액
            { wch: 14 }                             // 총 입금금액
        ];

        // 머지 (메인 타이틀 행)
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: LAST_C } }];

        // 행 높이 (요일 헤더 줄바꿈 + 메인 헤더)
        ws['!rows'] = [{ hpt: 28 }, {}, { hpt: 32 }];

        // 스타일
        styleSettlementWeeklySheet(ws, {
            mainHeaderRow: 0,
            colHeaderRow: 2,
            dataStart, dataEnd,
            totalRow: totalRowIdx,
            amountCols: [PRICE_C, AMOUNT_C, DEDUCT_AMT_C, FINAL_C],
            qtyCols: [...Array.from({ length: days.length }, (_, i) => DAY_START + i), QTY_TOTAL_C, DEDUCT_QTY_C]
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, partner.substring(0, 30));
        const fname = `${partner}_결제금액_${weekStart}~${weekEnd}.xlsx`;
        XLSX.writeFile(wb, fname);
    } catch (err) {
        alert('엑셀 다운로드 실패: ' + err.message);
        console.error(err);
    }
};

// 주간 정산현황 엑셀 시트 스타일링 (테두리 + 색상 + 천단위 콤마)
function styleSettlementWeeklySheet(ws, opt) {
    if (!ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const border = {
        top: { style: 'thin', color: { rgb: '999999' } },
        bottom: { style: 'thin', color: { rgb: '999999' } },
        left: { style: 'thin', color: { rgb: '999999' } },
        right: { style: 'thin', color: { rgb: '999999' } }
    };
    const amountSet = new Set(opt.amountCols);
    const qtySet = new Set(opt.qtyCols);

    for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const ref = XLSX.utils.encode_cell({ r: R, c: C });
            if (!ws[ref]) ws[ref] = { t: 's', v: '' };
            const s = { border, alignment: { vertical: 'center', wrapText: true } };

            if (R === opt.mainHeaderRow) {
                s.font = { bold: true, sz: 14 };
                s.alignment = { horizontal: 'center', vertical: 'center' };
                s.fill = { fgColor: { rgb: 'FFE0B2' } };
            } else if (R === opt.colHeaderRow) {
                s.font = { bold: true, sz: 11 };
                s.fill = { fgColor: { rgb: 'E6F0FA' } };
                s.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
            } else if (R >= opt.dataStart && R <= opt.dataEnd) {
                if (amountSet.has(C)) {
                    s.numFmt = '#,##0';
                    s.alignment = { ...s.alignment, horizontal: 'right' };
                    if (typeof ws[ref].v === 'number') ws[ref].t = 'n';
                } else if (qtySet.has(C)) {
                    s.alignment = { ...s.alignment, horizontal: 'center' };
                    if (typeof ws[ref].v === 'number') ws[ref].t = 'n';
                }
            } else if (R === opt.totalRow) {
                s.font = { bold: true };
                s.fill = { fgColor: { rgb: 'FFF8E1' } };
                if (amountSet.has(C)) {
                    s.numFmt = '#,##0';
                    s.alignment = { ...s.alignment, horizontal: 'right' };
                    if (typeof ws[ref].v === 'number') ws[ref].t = 'n';
                } else if (qtySet.has(C)) {
                    s.alignment = { ...s.alignment, horizontal: 'center' };
                    if (typeof ws[ref].v === 'number') ws[ref].t = 'n';
                }
            }
            ws[ref].s = s;
        }
    }
}

function getWeeksInMonth(year, month) {
    const weeks = [];
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const lastDate = lastOfMonth.getDate();

    // 1일이 속한 주의 월요일 찾기 (이전 달일 수 있음)
    const dow1 = firstOfMonth.getDay(); // 0=일,1=월,...
    let startMonday;
    if (dow1 === 1) {
        startMonday = new Date(year, month, 1);
    } else if (dow1 === 0) {
        // 일요일 → 그 주의 월요일은 6일 전
        startMonday = new Date(year, month, 1 - 6);
    } else {
        // 화~토 → 이전 월요일
        startMonday = new Date(year, month, 1 - (dow1 - 1));
    }

    // 주차 생성: startMonday부터 7일씩, 해당 월의 마지막 날을 포함하는 주까지
    let current = new Date(startMonday);
    while (true) {
        const weekStart = new Date(current);
        const weekEnd = new Date(current);
        weekEnd.setDate(weekEnd.getDate() + 6); // 일요일

        weeks.push({
            start: formatDate(weekStart),
            end: formatDate(weekEnd)
        });

        // 이 주의 일요일이 이번 달 마지막 날 이상이면 종료
        if (weekEnd >= lastOfMonth) break;

        current.setDate(current.getDate() + 7);
    }

    return weeks;
}

window.completeWeekSettlement = async function(weekStart, weekEnd, partner, amount) {
    if (!confirm(`${partner} ${weekStart} ~ ${weekEnd} 정산을 완료 처리하시겠습니까?\n금액: ${amount.toLocaleString()} 원`)) return;
    try {
        await api('/api/settlement-completions', 'POST', {
            partner, weekStart, weekEnd, totalAmount: amount
        });
        await renderWeeklySettlement();
        await renderSettlementCalendar();
    } catch (err) {
        alert('정산 완료 처리 실패: ' + err.message);
    }
};

window.cancelWeekSettlement = async function(id) {
    if (!confirm('정산 완료를 취소하시겠습니까?')) return;
    try {
        await api(`/api/settlement-completions/${id}`, 'DELETE');
        await renderWeeklySettlement();
        await renderSettlementCalendar();
    } catch (err) {
        alert('취소 실패: ' + err.message);
    }
};

// 업무일지 월 이동 버튼
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('worklog-prev-month').addEventListener('click', () => {
        worklogMonth--;
        if (worklogMonth < 0) { worklogMonth = 11; worklogYear--; }
        loadWorkLogs();
    });
    document.getElementById('worklog-next-month').addEventListener('click', () => {
        worklogMonth++;
        if (worklogMonth > 11) { worklogMonth = 0; worklogYear++; }
        loadWorkLogs();
    });
});

// =============================================
// 업무일지
// =============================================

let worklogYear = new Date().getFullYear();
let worklogMonth = new Date().getMonth();
let worklogData = []; // 현재 월의 업무일지 데이터
let worklogEditId = null; // 수정 중인 업무일지 ID
let worklogEditDate = null; // 현재 모달에 열려있는 날짜

async function renderWorklogPage() {
    // 대표만 직원 선택 드롭다운 표시 (다른 직원 업무일지는 대표 전용)
    const adminCard = document.getElementById('worklog-admin-card');
    if (currentUser?.position === '대표') {
        adminCard.style.display = '';
        await loadWorklogUsers();
    } else {
        adminCard.style.display = 'none';
    }
    await loadWorkLogs();
}

async function loadWorklogUsers() {
    try {
        const users = await api('/api/users');
        const select = document.getElementById('worklog-user-select');
        const currentVal = select.value;
        select.innerHTML = `<option value="">내 업무일지</option>` +
            users.map(u => `<option value="${u.id}">${u.name} (${u.position})</option>`).join('');
        if (currentVal) select.value = currentVal;
    } catch (err) {
        console.error('직원 목록 로드 오류:', err);
    }
}

async function loadWorkLogs() {
    const monthStr = `${worklogYear}-${String(worklogMonth + 1).padStart(2, '0')}`;
    document.getElementById('worklog-calendar-title').textContent = `${worklogYear}년 ${worklogMonth + 1}월`;

    try {
        const selectedUser = document.getElementById('worklog-user-select')?.value;
        if (currentUser?.position === '대표' && selectedUser) {
            worklogData = await api(`/api/work-logs/admin?month=${monthStr}&user_id=${selectedUser}`);
        } else {
            worklogData = await api(`/api/work-logs?month=${monthStr}`);
        }
    } catch (err) {
        console.error('업무일지 로드 오류:', err);
        worklogData = [];
    }

    renderWorklogCalendar();
}
window.loadWorkLogs = loadWorkLogs;

function renderWorklogCalendar() {
    const body = document.getElementById('worklog-calendar-body');
    const firstDay = new Date(worklogYear, worklogMonth, 1).getDay();
    const lastDate = new Date(worklogYear, worklogMonth + 1, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 업무일지 데이터를 날짜별 맵으로
    const logMap = {};
    worklogData.forEach(log => {
        logMap[log.date] = log;
    });

    const isViewingOther = currentUser?.position === '대표' && document.getElementById('worklog-user-select')?.value;

    let html = '';
    let day = 1;
    for (let row = 0; row < 6; row++) {
        if (day > lastDate) break;
        html += '<tr>';
        for (let col = 0; col < 7; col++) {
            if ((row === 0 && col < firstDay) || day > lastDate) {
                html += '<td class="empty"></td>';
            } else {
                const dateStr = `${worklogYear}-${String(worklogMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isToday = dateStr === todayStr;
                const hasLog = !!logMap[dateStr];
                const log = logMap[dateStr];

                let cellClass = '';
                if (col === 0) cellClass = 'sun';
                if (col === 6) cellClass = 'sat';
                if (isToday) cellClass += ' today';

                html += `<td class="${cellClass}">`;
                html += `<div class="calendar-day">${day}`;
                if (hasLog) {
                    html += `<span class="worklog-dot" title="작성완료"></span>`;
                    // 관리자: 회의록 작성 여부 표시
                    if (currentUser?.role === 'admin' && log) {
                        const parsed = parseWorklogContent(log.content);
                        if (parsed.meeting) {
                            html += `<span class="worklog-meeting-dot" title="회의록 있음">📋</span>`;
                        }
                    }
                }
                html += `</div>`;

                if (isViewingOther) {
                    // 관리자가 다른 직원 보기: 클릭하면 내용 보기만
                    if (hasLog) {
                        html += `<button class="worklog-view-btn" onclick="viewWorkLog('${dateStr}')">보기</button>`;
                    }
                } else {
                    // 자기 업무일지
                    if (isToday && !hasLog) {
                        html += `<button class="worklog-write-btn" onclick="openWorklogModal('${dateStr}')">업무일지 작성</button>`;
                    } else if (hasLog) {
                        html += `<button class="worklog-view-btn" onclick="openWorklogModal('${dateStr}')">보기/수정</button>`;
                    } else {
                        // 과거 날짜에도 작성 가능
                        const dateObj = new Date(worklogYear, worklogMonth, day);
                        if (dateObj <= today) {
                            html += `<button class="worklog-write-btn" onclick="openWorklogModal('${dateStr}')" style="background:#999;">작성</button>`;
                        }
                    }
                }

                html += `</td>`;
                day++;
            }
        }
        html += '</tr>';
    }
    body.innerHTML = html;
}

function parseWorklogContent(content) {
    try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.morning === 'string') return { morning: parsed.morning, afternoon: parsed.afternoon || '', meeting: parsed.meeting || '' };
    } catch (e) {}
    // 기존 단일 텍스트 호환: 전체를 오전에 넣기
    return { morning: content || '', afternoon: '', meeting: '' };
}

function openWorklogModal(dateStr) {
    worklogEditDate = dateStr;
    const [y, m, d] = dateStr.split('-');
    document.getElementById('worklog-modal-date-label').textContent = `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;

    const log = worklogData.find(l => l.date === dateStr);
    const morningEl = document.getElementById('worklog-morning');
    const afternoonEl = document.getElementById('worklog-afternoon');
    const deleteBtn = document.getElementById('worklog-delete-btn');
    const saveBtn = document.getElementById('worklog-save-btn');
    const titleEl = document.getElementById('worklog-modal-title');

    const meetingEl = document.getElementById('worklog-meeting');
    const meetingGroup = document.getElementById('worklog-meeting-group');

    if (log) {
        const parsed = parseWorklogContent(log.content);
        morningEl.value = parsed.morning;
        afternoonEl.value = parsed.afternoon;
        meetingEl.value = parsed.meeting;
        worklogEditId = log.id;
        deleteBtn.style.display = '';
        titleEl.textContent = '업무일지 수정';
        saveBtn.textContent = '수정';
    } else {
        morningEl.value = '';
        afternoonEl.value = '';
        meetingEl.value = '';
        worklogEditId = null;
        deleteBtn.style.display = 'none';
        titleEl.textContent = '업무일지 작성';
        saveBtn.textContent = '저장';
    }

    // 관리자가 다른 직원 것 보는 경우 읽기 전용
    const isViewingOther = currentUser?.position === '대표' && document.getElementById('worklog-user-select')?.value;
    morningEl.readOnly = !!isViewingOther;
    afternoonEl.readOnly = !!isViewingOther;
    meetingEl.readOnly = !!isViewingOther;
    saveBtn.style.display = isViewingOther ? 'none' : '';
    deleteBtn.style.display = isViewingOther ? 'none' : (log ? '' : 'none');

    // 회의록: 관리자가 다른 직원 것 볼 때만 표시 (일반 직원은 항상 표시 - 작성용)
    // 관리자가 자기 업무일지 볼 때도 표시
    meetingGroup.style.display = '';
    // 관리자가 다른 직원 조회 시: 회의록 있으면 표시, 없으면 숨김
    if (isViewingOther && !meetingEl.value) {
        meetingGroup.style.display = 'none';
    }

    document.getElementById('worklog-modal').style.display = 'flex';
    if (!isViewingOther) morningEl.focus();
}
window.openWorklogModal = openWorklogModal;

function viewWorkLog(dateStr) {
    openWorklogModal(dateStr);
}
window.viewWorkLog = viewWorkLog;

function closeWorklogModal() {
    document.getElementById('worklog-modal').style.display = 'none';
    worklogEditId = null;
    worklogEditDate = null;
}
window.closeWorklogModal = closeWorklogModal;

async function saveWorkLog() {
    const morning = document.getElementById('worklog-morning').value.trim();
    const afternoon = document.getElementById('worklog-afternoon').value.trim();
    const meeting = document.getElementById('worklog-meeting').value.trim();
    if (!morning && !afternoon) {
        alert('오전 또는 오후 업무 내용을 입력해주세요.');
        return;
    }
    const content = JSON.stringify({ morning, afternoon, meeting });

    try {
        if (worklogEditId) {
            await api(`/api/work-logs/${worklogEditId}`, 'PUT', { content });
        } else {
            await api('/api/work-logs', 'POST', { date: worklogEditDate, content });
        }

        closeWorklogModal();
        await loadWorkLogs();

        // 토스트 메시지 표시
        const toast = document.getElementById('worklog-toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 3000);
    } catch (err) {
        alert('저장 실패: ' + (err.message || '오류'));
    }
}
window.saveWorkLog = saveWorkLog;

async function deleteWorkLog() {
    if (!worklogEditId) return;
    if (!confirm('이 업무일지를 삭제하시겠습니까?')) return;

    try {
        await api(`/api/work-logs/${worklogEditId}`, 'DELETE');
        closeWorklogModal();
        await loadWorkLogs();
    } catch (err) {
        alert('삭제 실패: ' + (err.message || '오류'));
    }
}
window.deleteWorkLog = deleteWorkLog;

// =============================================
// 내 정보 페이지
// =============================================
async function renderMyInfoPage() {
    if (!currentUser) return;
    document.getElementById('myinfo-username').textContent = currentUser.username;
    document.getElementById('myinfo-name').textContent = currentUser.name;
    document.getElementById('myinfo-position').textContent = currentUser.position || '-';
    document.getElementById('myinfo-color').style.backgroundColor = currentUser.color || '#3b82f6';
    // 도장 미리보기 로드
    try {
        const sig = await api(`/api/users/${currentUser.id}/signature`);
        updateSignaturePreview(sig.signatureImage);
    } catch (err) { updateSignaturePreview(null); }
}

function updateSignaturePreview(imgData) {
    const emptyEl = document.getElementById('signature-preview-empty');
    const imgEl = document.getElementById('signature-preview-img');
    const delBtn = document.getElementById('signature-delete-btn');
    if (imgData) {
        emptyEl.style.display = 'none';
        imgEl.style.display = '';
        imgEl.src = imgData;
        delBtn.style.display = '';
    } else {
        emptyEl.style.display = '';
        imgEl.style.display = 'none';
        imgEl.src = '';
        delBtn.style.display = 'none';
    }
}

document.getElementById('signature-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('파일 크기가 2MB를 초과합니다.'); e.target.value = ''; return; }
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) { alert('PNG 또는 JPG 파일만 업로드 가능합니다.'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
        const base64 = ev.target.result;
        try {
            await api('/api/users/signature', 'PUT', { signatureImage: base64 });
            updateSignaturePreview(base64);
            alert('도장 이미지가 등록되었습니다.');
        } catch (err) { alert('업로드 실패: ' + err.message); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
});

document.getElementById('signature-delete-btn').addEventListener('click', async () => {
    if (!confirm('등록된 도장 이미지를 삭제하시겠습니까?')) return;
    try {
        await api('/api/users/signature', 'DELETE');
        updateSignaturePreview(null);
        alert('도장 이미지가 삭제되었습니다.');
    } catch (err) { alert('삭제 실패: ' + err.message); }
});

document.getElementById('form-change-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPw = document.getElementById('pw-current').value;
    const newPw = document.getElementById('pw-new').value;
    const confirmPw = document.getElementById('pw-confirm').value;

    if (newPw !== confirmPw) {
        alert('새 비밀번호가 일치하지 않습니다.');
        return;
    }
    if (newPw.length < 4) {
        alert('새 비밀번호는 4자 이상이어야 합니다.');
        return;
    }

    try {
        await api('/api/auth/change-password', 'PUT', { currentPassword: currentPw, newPassword: newPw });
        alert('비밀번호가 변경되었습니다. 다시 로그인해주세요.');
        document.getElementById('form-change-password').reset();
        // 로그아웃 처리
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('jwt_user');
        currentUser = null;
        showLoginPage();
    } catch (err) {
        alert(err.message || '비밀번호 변경에 실패했습니다.');
    }
});

// =============================================
// 지출결의서
// =============================================

function initExpensePage() {
    if (!currentUser) return;
    const isAdmin = currentUser.role === 'admin';
    const isAccountant = currentUser.role === 'accountant';
    // 세무사는 작성/내신청/결재대기 탭 숨김
    document.getElementById('expense-tab-write').style.display = isAccountant ? 'none' : '';
    document.getElementById('expense-tab-my').style.display = isAccountant ? 'none' : '';
    document.getElementById('expense-tab-pending').style.display = isAdmin ? '' : 'none';
    document.getElementById('expense-tab-history').style.display = (isAdmin || isAccountant) ? '' : 'none';
    document.getElementById('expense-tab-card').style.display = (isAdmin || isAccountant) ? '' : 'none';

    if (!isAccountant) {
        document.getElementById('expense-applicant').value = `${currentUser.position} ${currentUser.name}`;
        renderExpenseApprovalLine();
        const itemsEl = document.getElementById('expense-items');
        if (itemsEl.children.length === 0) addExpenseItem();
        // 사용날짜 기본값: 오늘 (비어있을 때만)
        const useDateEl = document.getElementById('expense-use-date');
        if (useDateEl && !useDateEl.value) {
            const t = new Date();
            useDateEl.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        }
        renderExpenseMyList().catch(console.error);
    }

    // 초기 탭: 세무사는 카드이용내역, 그 외는 작성
    switchExpenseTab(isAccountant ? 'card' : 'write');

    if (isAdmin) renderExpensePendingList().catch(console.error);
    if (isAdmin || isAccountant) {
        loadExpenseUserFilter().catch(console.error);
        renderExpenseHistoryList().catch(console.error);
    }
}

// 탭 전환
document.querySelectorAll('[data-expense-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
        switchExpenseTab(tab.dataset.expenseTab);
    });
});

function switchExpenseTab(tabName) {
    document.querySelectorAll('[data-expense-tab]').forEach(t => t.classList.toggle('active', t.dataset.expenseTab === tabName));
    ['write', 'pending', 'my', 'history', 'card'].forEach(s => {
        const el = document.getElementById(`expense-section-${s}`);
        if (el) el.style.display = s === tabName ? '' : 'none';
    });
    if (tabName === 'my') renderExpenseMyList().catch(console.error);
    if (tabName === 'pending') renderExpensePendingList().catch(console.error);
    if (tabName === 'history') renderExpenseHistoryList().catch(console.error);
    if (tabName === 'card') initCardTransactionsTab();
}

// 결재라인 표시
function renderExpenseApprovalLine() {
    const el = document.getElementById('expense-approval-line');
    let steps = [];
    steps.push({ label: '신청자', name: `${currentUser.position} ${currentUser.name}` });

    if (currentUser.position === '대표') {
        steps.push({ label: '최종결재', name: `${currentUser.name} (자체)` });
    } else {
        // 부장 퇴사로 모든 결재를 대표가 단독 처리
        steps.push({ label: '최종결재', name: '전승범 대표' });
    }

    el.innerHTML = steps.map((s, i) => {
        const arrow = i < steps.length - 1 ? '<span class="expense-approval-arrow">→</span>' : '';
        return `<div class="expense-approval-step"><span class="step-label">${s.label}</span><span class="step-name">${s.name}</span></div>${arrow}`;
    }).join('');
}

// 지출 항목 추가/삭제
const EXPENSE_CATEGORIES = [
    { name: '거래처 정산', detail: '거래선 정산대금 (대성, 효돈, 택배비 등)' },
    { name: '복리후생비', detail: '직원 식대, 간식, 음료, 경조사비, 야근 식비' },
    { name: '업무차 교통비', detail: '출장비, 택시비, 주차비, 톨비, 항공/기차비, 숙박비' },
    { name: '업무차 접대비', detail: '거래처 식사, 선물, 경조사(외부)' },
    { name: '소모품비', detail: '사무용품, 프린터 잉크/토너, 문구류, 청소용품' },
    { name: '공과금', detail: '임대료, 관리비, 전화요금, 인터넷, 우편, 전기세 등' },
    { name: '광고선전비', detail: '온라인 광고, 인쇄물, 촬영비, 홍보물 제작, 플랫폼 이용료' },
    { name: '수선유지비', detail: '사무실 수리, 장비 수리, 시설 보수' },
    { name: '차량유지비', detail: '사무차량 유류비, 차량 수리, 보험료' },
    { name: '교육훈련비', detail: '직원 교육, 세미나, 자격증, 도서 구입' },
    { name: '기타', detail: '' }
];

document.getElementById('expense-add-item').addEventListener('click', () => addExpenseItem());

function addExpenseItem() {
    const container = document.getElementById('expense-items');
    const row = document.createElement('div');
    row.className = 'expense-item-row';
    const options = EXPENSE_CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    row.innerHTML = `
        <select class="expense-item-category"><option value="">선택</option>${options}</select>
        <div class="expense-item-detail">카테고리를 선택하세요</div>
        <input type="number" placeholder="금액" class="expense-item-amount" min="0">
        <input type="text" placeholder="비고" class="expense-item-note">
        <button type="button" class="expense-item-remove" onclick="this.closest('.expense-item-row').remove(); updateExpenseTotal();">×</button>
    `;
    const sel = row.querySelector('.expense-item-category');
    const detailEl = row.querySelector('.expense-item-detail');
    sel.addEventListener('change', () => {
        const cat = EXPENSE_CATEGORIES.find(c => c.name === sel.value);
        if (!cat) { detailEl.innerHTML = '카테고리를 선택하세요'; detailEl.contentEditable = 'false'; return; }
        if (cat.name === '기타') {
            detailEl.innerHTML = '';
            detailEl.contentEditable = 'true';
            detailEl.style.color = '#333';
            detailEl.style.fontStyle = 'normal';
            detailEl.style.background = '#fff';
            detailEl.focus();
        } else {
            detailEl.textContent = cat.detail;
            detailEl.contentEditable = 'false';
            detailEl.style.color = '';
            detailEl.style.fontStyle = '';
            detailEl.style.background = '';
        }
    });
    row.querySelector('.expense-item-amount').addEventListener('input', updateExpenseTotal);
    container.appendChild(row);
}

function updateExpenseTotal() {
    let total = 0;
    document.querySelectorAll('.expense-item-amount').forEach(input => {
        total += Number(input.value) || 0;
    });
    document.getElementById('expense-total').textContent = `${total.toLocaleString()} 원`;
}

// 제출
document.getElementById('expense-submit').addEventListener('click', async () => {
    const purpose = document.getElementById('expense-purpose').value.trim();
    // 사용날짜: 비워두면 오늘 날짜로 자동 채움
    const useDateInput = document.getElementById('expense-use-date');
    let useDate = useDateInput.value;
    if (!useDate) {
        const t = new Date();
        useDate = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }

    const items = [];
    document.querySelectorAll('.expense-item-row').forEach(row => {
        const category = row.querySelector('.expense-item-category').value;
        const detail = row.querySelector('.expense-item-detail').textContent.trim();
        const amount = Number(row.querySelector('.expense-item-amount').value) || 0;
        const note = row.querySelector('.expense-item-note').value.trim();
        if (category && amount > 0) items.push({ category, detail, amount, note });
    });
    if (items.length === 0) { alert('지출 항목을 하나 이상 추가해주세요.'); return; }

    // 제목은 첫 번째 항목 카테고리로 자동 생성
    const title = items.map(i => i.category).join(', ');

    if (!confirm(`지출결의서를 제출하시겠습니까?\n사용날짜: ${useDate}\n합계: ${items.reduce((s, i) => s + i.amount, 0).toLocaleString()} 원`)) return;

    try {
        await api('/api/expense-reports', 'POST', { title, purpose, items, useDate });
        alert('지출결의서가 제출되었습니다.');
        document.getElementById('expense-purpose').value = '';
        document.getElementById('expense-use-date').value = '';
        document.getElementById('expense-items').innerHTML = '';
        addExpenseItem();
        updateExpenseTotal();
        switchExpenseTab('my');
    } catch (err) { alert('제출 실패: ' + err.message); }
});

// ============================================================
//  지출결의서 엑셀 일괄 업로드 (제주은행 통장 거래내역)
// ============================================================

// 일괄 업로드 공통 처리: 파일 → 파싱 → 사전 중복 체크 → 미리보기
async function handleExpenseBulkUpload(file) {
    const txs = await parseBankExcelFile(file);
    if (txs.length === 0) { alert('유효한 거래를 찾을 수 없습니다. 엑셀 양식을 확인해주세요.'); return; }

    // 사전 중복 체크: 이미 등록된 거래는 미리보기에서 즉시 제외
    let skippedDup = 0;
    let newTxs = txs;
    try {
        const check = await api('/api/expense-reports/check-duplicates', 'POST', {
            transactions: txs.map(t => ({ useDate: t.useDate, note: t.note, amount: t.amount }))
        });
        const dupFlags = (check.results || []).map(r => !!r.isDuplicate);
        skippedDup = dupFlags.filter(Boolean).length;
        newTxs = txs.filter((_, i) => !dupFlags[i]);
    } catch (err) {
        console.warn('중복 사전 체크 실패 (서버 응답 후 스킵으로 폴백):', err.message);
    }

    newTxs._skippedDuplicate = skippedDup;

    if (newTxs.length === 0) {
        alert(`업로드할 신규 거래가 없습니다.\n중복: ${skippedDup}건`);
        return;
    }
    showBulkExpensePreview(newTxs);
}

document.getElementById('expense-bulk-btn')?.addEventListener('click', () => {
    document.getElementById('expense-bulk-file').click();
});
document.getElementById('expense-bulk-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { await handleExpenseBulkUpload(file); }
    catch (err) { alert('파일 읽기 실패: ' + err.message); }
    finally { e.target.value = ''; }
});

// 지출조회/이력 다운로드 탭의 일괄 업로드
document.getElementById('expense-history-bulk-btn')?.addEventListener('click', () => {
    document.getElementById('expense-history-bulk-file').click();
});
document.getElementById('expense-history-bulk-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { await handleExpenseBulkUpload(file); }
    catch (err) { alert('파일 읽기 실패: ' + err.message); }
    finally { e.target.value = ''; }
});

function classifyExpenseAuto(note, merchant) {
    const t = (note || '') + ' ' + (merchant || '');
    if (/광고|네이버 보상|안내문자|GFA/i.test(t)) return '광고선전비';
    if (/대성|효돈|애월|취나물|박스구입|한라포장|택배비|씨제이대한통운|조기만/i.test(t)) return '거래처 정산';
    if (/인터넷|통신비|cctv 통신|전기세|전기료|렌탈|복합기 임대|관리비|임대료|보증금|중개사|4대보험|등기|법무|인증|수수료|토스페이먼츠|pg사|세금/i.test(t)) return '공과금';
    if (/화한|결혼|식대|간식|복리|경조사|지원금/i.test(t)) return '복리후생비';
    if (/사무용품|책상|파티션|컴퓨터|cctv 구입|아성다이소|소모품/i.test(t)) return '소모품비';
    if (/인테리어|간판|블라인드|수선|수리|보수/i.test(t)) return '수선유지비';
    if (/차량|타스만|취득세/i.test(t)) return '차량유지비';
    return '기타';
}

async function parseBankExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = new Uint8Array(ev.target.result);
                const wb = XLSX.read(data, { type: 'array', cellDates: true });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

                // 헤더 인식: 거래일자/출금금액 필수. 가맹점/메모는 양식별로 다름
                // 지원 양식: ① 거래일자/통장인자/출금금액/출금내용  ② 거래일시/적요/거래내용/출금금액/.../메모
                let headerIdx = -1, dateCol = -1, merchantCol = -1, amountCol = -1, noteCol = -1;
                for (let i = 0; i < Math.min(rows.length, 10); i++) {
                    const r = rows[i].map(c => String(c).trim());
                    const di = r.findIndex(c => /(거래일자|거래일시|거래일|사용일|이용일|날짜|일자)$|^날짜|^일자/.test(c));
                    const mi = r.findIndex(c => /(통장인자|거래내용|가맹점|상대처|상호)/.test(c));
                    // '입출금구분' 같은 헤더 제외 — 정확히 금액 컬럼만
                    const ai = r.findIndex(c => /(출금금액|이용금액|사용금액|승인금액)/.test(c) && !/(합계|총액|구분)/.test(c));
                    // '통장인자내용' 같은 헤더 제외 — '내용' 단독 매치 방지
                    // 우선순위: 출금내용(기존양식) > 메모(새양식 사용자 직접입력) > 적요(거래채널)
                    const ni = r.findIndex((c, idx) => idx !== mi && /(출금내용|메모|적요내용|적요|용도)/.test(c));
                    if (di >= 0 && ai >= 0) {
                        headerIdx = i; dateCol = di; merchantCol = mi; amountCol = ai; noteCol = ni;
                        break;
                    }
                }
                if (headerIdx < 0) return reject(new Error('엑셀 양식을 인식할 수 없습니다 (거래일자/출금금액 컬럼 필요)'));

                const txs = [];
                for (let i = headerIdx + 1; i < rows.length; i++) {
                    const r = rows[i];
                    const dateRaw = r[dateCol];
                    const merchant = String(merchantCol >= 0 ? (r[merchantCol] || '') : '').trim();
                    const amount = Number(String(r[amountCol] || '').replace(/[^\d.-]/g, '')) || 0;
                    const note = String(noteCol >= 0 ? (r[noteCol] || '') : '').trim();
                    if (!dateRaw || !amount) continue;
                    if (!note && !merchant) continue;

                    let dateStr;
                    if (dateRaw instanceof Date) {
                        dateStr = `${dateRaw.getFullYear()}-${String(dateRaw.getMonth() + 1).padStart(2, '0')}-${String(dateRaw.getDate()).padStart(2, '0')}`;
                    } else {
                        const s = String(dateRaw).trim().replace(/\./g, '-').replace(/\//g, '-');
                        const m = s.match(/(\d{4})-?(\d{1,2})-?(\d{1,2})/);
                        if (!m) continue;
                        dateStr = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
                    }

                    const category = classifyExpenseAuto(note, merchant);
                    const detail = (EXPENSE_CATEGORIES.find(c => c.name === category) || {}).detail || '';

                    txs.push({
                        useDate: dateStr,
                        category,
                        detail,
                        amount,
                        note: merchant,
                        purpose: note
                    });
                }
                resolve(txs);
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('파일 읽기 실패'));
        reader.readAsArrayBuffer(file);
    });
}

function showBulkExpensePreview(txs) {
    const byCat = {};
    txs.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
    const total = txs.reduce((s, t) => s + t.amount, 0);
    const skippedDup = txs._skippedDuplicate || 0;

    const slug = name => (name || '기타').replace(/\s+/g, '');
    const noticeHtml = skippedDup > 0
        ? `<span style="color:#9ca3af;font-size:13px;margin-left:8px;">(중복 ${skippedDup}건 자동 제외)</span>`
        : '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal" style="max-width:1080px;max-height:90vh;display:flex;flex-direction:column;">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3 style="margin:0 0 12px 0;">지출결의서 일괄 업로드 미리보기</h3>
            <div style="background:#F0F7FF;padding:14px;border-radius:8px;margin-bottom:12px;">
                <div style="font-size:15px;margin-bottom:8px;">
                    <strong>총 ${txs.length}건</strong> · 합계 <strong style="color:#0066CC;">${total.toLocaleString()}원</strong>
                    ${noticeHtml}
                </div>
                <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">💡 <strong>카테고리</strong>는 자동 분류된 결과예요. <strong>메모</strong>에 실제 사용 내역을 직접 적으면 결재 시 명확해져요.</div>
                <div>
                    ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, sum]) =>
                        `<span class="card-category-summary cat-${slug(cat)}" style="margin:2px 4px 2px 0;">${cat}: ${sum.toLocaleString()}원</span>`
                    ).join('')}
                </div>
            </div>
            <div style="flex:1;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px;">
                <table class="data-table" style="font-size:12px;margin:0;">
                    <thead style="position:sticky;top:0;background:#f9fafb;z-index:1;">
                        <tr>
                            <th style="width:90px;">사용날짜</th>
                            <th style="width:140px;">카테고리</th>
                            <th style="width:160px;">거래처</th>
                            <th>메모 (직접 입력)</th>
                            <th style="width:110px;">금액</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${txs.map((t, idx) => `<tr>
                            <td>${t.useDate}</td>
                            <td>
                                <select class="bulk-cat-select" data-idx="${idx}" style="padding:3px 6px;font-size:11px;border:1px solid #d1d5db;border-radius:4px;">
                                    ${EXPENSE_CATEGORIES.map(c => `<option value="${c.name}" ${c.name === t.category ? 'selected' : ''}>${c.name}</option>`).join('')}
                                </select>
                            </td>
                            <td>${escapeHtml(t.note)}</td>
                            <td>
                                <input type="text" class="bulk-memo-input" data-idx="${idx}"
                                    value="${escapeHtml(t.purpose || '')}"
                                    placeholder="예: 5월 효돈 정산 / 사무용품 구입 등"
                                    style="width:100%;padding:3px 6px;font-size:12px;border:1px solid #d1d5db;border-radius:4px;">
                            </td>
                            <td style="text-align:right;font-weight:600;">${t.amount.toLocaleString()}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
                <button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">취소</button>
                <button class="btn-primary" id="bulk-expense-confirm">${txs.length}건 등록</button>
            </div>
        </div>
    `;

    // 카테고리 변경 이벤트
    overlay.querySelectorAll('.bulk-cat-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const idx = Number(sel.dataset.idx);
            txs[idx].category = sel.value;
            txs[idx].detail = (EXPENSE_CATEGORIES.find(c => c.name === sel.value) || {}).detail || '';
        });
    });

    // 메모(=지출 목적) 직접 입력 이벤트 — purpose 필드를 사용자 입력으로 덮어씀
    overlay.querySelectorAll('.bulk-memo-input').forEach(inp => {
        inp.addEventListener('input', () => {
            const idx = Number(inp.dataset.idx);
            txs[idx].purpose = inp.value;
        });
    });

    overlay.querySelector('#bulk-expense-confirm').addEventListener('click', async () => {
        const btn = overlay.querySelector('#bulk-expense-confirm');
        btn.disabled = true;
        btn.textContent = '등록 중...';
        try {
            const result = await api('/api/expense-reports/bulk', 'POST', { transactions: txs });
            const skippedTxt = (result.skipped > 0) ? `\n중복 스킵: ${result.skipped}건` : '';
            alert(`등록 완료\n성공: ${result.inserted}건${skippedTxt}\n실패: ${result.failed}건`);
            overlay.remove();
            // 현재 활성 탭에 맞춰 새로고침. 조회/이력 탭에서 호출한 경우 history 갱신.
            const activeTab = document.querySelector('[data-expense-tab].active')?.dataset.expenseTab;
            if (activeTab === 'history') {
                renderExpenseHistoryList().catch(console.error);
            } else {
                renderExpenseMyList().catch(console.error);
                switchExpenseTab('my');
            }
        } catch (err) {
            alert('등록 실패: ' + err.message);
            btn.disabled = false;
            btn.textContent = `${txs.length}건 등록`;
        }
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

// 내 신청 목록
async function renderExpenseMyList() {
    try {
        const data = await api('/api/expense-reports/my');
        const tbody = document.getElementById('expense-my-list');
        if (data.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="5">신청 내역이 없습니다.</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(d => `<tr>
            <td>${d.title}</td>
            <td>${Number(d.total_amount).toLocaleString()} 원</td>
            <td>${new Date(d.created_at).toLocaleDateString()}</td>
            <td>${getExpenseStatusBadge(d.status)}</td>
            <td><button class="btn-view" onclick="viewExpenseDetail(${d.id})">상세</button></td>
        </tr>`).join('');
    } catch (err) { console.error('내 신청 목록 로드 오류:', err); }
}

// 결재 대기 목록
async function renderExpensePendingList() {
    try {
        const data = await api('/api/expense-reports/pending');
        const tbody = document.getElementById('expense-pending-list');
        if (data.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">결재 대기 건이 없습니다.</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(d => `<tr>
            <td>${d.title}</td>
            <td>${d.applicant_position} ${d.applicant_name}</td>
            <td>${Number(d.total_amount).toLocaleString()} 원</td>
            <td>${new Date(d.created_at).toLocaleDateString()}</td>
            <td>${getExpenseStatusBadge(d.status)}</td>
            <td>
                <button class="btn-view" onclick="viewExpenseDetail(${d.id})" style="margin-right:4px;">상세</button>
                <button class="btn-primary" onclick="approveExpense(${d.id})" style="padding:4px 12px;font-size:12px;margin-right:4px;">승인</button>
                <button class="btn-danger" onclick="rejectExpense(${d.id})">반려</button>
            </td>
        </tr>`).join('');
    } catch (err) { console.error('결재 대기 목록 로드 오류:', err); }
}

// 전체 이력
async function renderExpenseHistoryList() {
    try {
        const filterEl = document.getElementById('expense-history-filter');
        const selectedUser = filterEl ? filterEl.value : '';
        const startDate = document.getElementById('expense-history-start')?.value || '';
        const endDate = document.getElementById('expense-history-end')?.value || '';
        const queryParams = new URLSearchParams();
        if (selectedUser) queryParams.set('applicant_id', selectedUser);
        if (startDate) queryParams.set('start_date', startDate);
        if (endDate) queryParams.set('end_date', endDate);
        const qs = queryParams.toString();
        const url = `/api/expense-reports/history${qs ? '?' + qs : ''}`;
        const data = await api(url);
        window._lastExpenseHistory = data; // 엑셀 다운로드용 캐시
        const tbody = document.getElementById('expense-history-list');
        const summaryEl = document.getElementById('expense-history-summary');
        // 합계 계산 (반려 제외하지 않음 — 전체 결과 기준)
        const totalEl = document.getElementById('expense-history-total');
        const countEl = document.getElementById('expense-history-count');
        const sum = data.reduce((s, d) => s + (Number(d.total_amount) || 0), 0);
        if (totalEl) totalEl.textContent = sum.toLocaleString() + ' 원';
        if (countEl) countEl.textContent = data.length > 0 ? `${data.length}건` : '-';

        // 검색 영역 바로 아래 합계 요약 카드 (카드내역 스타일)
        if (summaryEl) {
            if (data.length === 0) {
                summaryEl.innerHTML = '';
            } else {
                // 카테고리별 합계 (items 펼쳐서 카테고리별 누적)
                const byCategory = {};
                data.forEach(d => {
                    try {
                        const items = typeof d.items === 'string' ? JSON.parse(d.items) : (d.items || []);
                        if (items.length === 0) {
                            const cat = d.title || '기타';
                            byCategory[cat] = (byCategory[cat] || 0) + (Number(d.total_amount) || 0);
                        } else {
                            items.forEach(it => {
                                const cat = it.category || it.item || '기타';
                                byCategory[cat] = (byCategory[cat] || 0) + (Number(it.amount) || 0);
                            });
                        }
                    } catch {}
                });
                const slug = name => (name || '기타').replace(/\s+/g, '');
                const totalCard = `<span class="card-category-summary" style="background:#0066CC;color:#fff;font-size:14px;font-weight:700;">총 합계: ${sum.toLocaleString()}원 (${data.length}건)</span>`;
                const catCards = Object.entries(byCategory)
                    .sort((a, b) => b[1] - a[1])
                    .map(([cat, amt]) => `<span class="card-category-summary cat-${slug(cat)}">${cat}: ${amt.toLocaleString()}원</span>`)
                    .join('');
                summaryEl.innerHTML = totalCard + catCards;
            }
        }

        const isAdmin = currentUser.role === 'admin';
        if (data.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="8">지출결의서가 없습니다.</td></tr>';
            const batchBtn0 = document.getElementById('expense-history-batch-approve');
            if (batchBtn0) batchBtn0.style.display = 'none';
            const checkAll0 = document.getElementById('expense-history-check-all');
            if (checkAll0) checkAll0.style.display = 'none';
            return;
        }
        const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        tbody.innerHTML = data.map(d => {
            const deleteBtn = currentUser.position === '대표' ? `<button class="btn-danger" onclick="deleteExpense(${d.id})" style="margin-left:4px;">삭제</button>` : '';
            const pdfBtn = d.status === 'approved' ? `<button class="btn-view" onclick="downloadExpensePDF(${d.id})" style="margin-left:4px;color:#7c3aed;border-color:#7c3aed;">PDF</button>` : '';
            // 비고: items의 note들을 합쳐서 표시 (어디에 쓰였는지 식별용)
            let noteText = '';
            try {
                const items = typeof d.items === 'string' ? JSON.parse(d.items) : (d.items || []);
                noteText = items.map(it => (it.note || '').trim()).filter(Boolean).join(', ');
            } catch {}
            const noteCell = noteText ? escapeHtml(noteText) : '<span style="color:#9ca3af;">-</span>';
            // 사용날짜 우선 (없으면 작성일 fallback)
            const useDateStr = d.use_date
                ? new Date(d.use_date).toLocaleDateString()
                : `<span style="color:#9ca3af;">${new Date(d.created_at).toLocaleDateString()}</span>`;
            // 승인 전(결재대기) 상태만 체크박스 표시 (admin만)
            const approvable = d.status === 'pending' || d.status === 'manager_approved';
            const checkCell = (isAdmin && approvable)
                ? `<td style="text-align:center;"><input type="checkbox" class="expense-history-check" value="${d.id}"></td>`
                : '<td></td>';
            return `<tr>
                ${checkCell}
                <td>${d.title}</td>
                <td>${d.applicant_position} ${d.applicant_name}</td>
                <td>${Number(d.total_amount).toLocaleString()} 원</td>
                <td>${useDateStr}</td>
                <td style="max-width:280px;white-space:normal;word-break:break-word;font-size:13px;color:#374151;" title="${noteText ? escapeHtml(noteText) : ''}">${noteCell}</td>
                <td>${getExpenseStatusBadge(d.status)}</td>
                <td>
                    <button class="btn-view" onclick="viewExpenseDetail(${d.id})">상세</button>
                    ${pdfBtn}
                    ${deleteBtn}
                </td>
            </tr>`;
        }).join('');

        // 일괄 승인 UI: 결재대기 항목이 있고 admin일 때만 노출
        const hasApprovable = isAdmin && data.some(d => d.status === 'pending' || d.status === 'manager_approved');
        const batchBtn = document.getElementById('expense-history-batch-approve');
        const checkAll = document.getElementById('expense-history-check-all');
        if (batchBtn) batchBtn.style.display = hasApprovable ? '' : 'none';
        if (checkAll) {
            checkAll.style.display = hasApprovable ? '' : 'none';
            checkAll.checked = false;
            checkAll.onchange = () => {
                tbody.querySelectorAll('.expense-history-check').forEach(cb => { cb.checked = checkAll.checked; });
            };
        }
    } catch (err) { console.error('전체 이력 로드 오류:', err); }
}

// 선택 일괄 승인
document.getElementById('expense-history-batch-approve')?.addEventListener('click', async () => {
    const checked = Array.from(document.querySelectorAll('#expense-history-list .expense-history-check:checked')).map(cb => Number(cb.value));
    if (checked.length === 0) { alert('승인할 항목을 선택해주세요.'); return; }
    if (!confirm(`선택한 ${checked.length}건을 승인하시겠습니까?`)) return;
    let ok = 0, fail = 0;
    const errs = [];
    for (const id of checked) {
        try { await api(`/api/expense-reports/${id}/approve`, 'PUT'); ok++; }
        catch (err) { fail++; errs.push(`#${id}: ${err.message}`); }
    }
    let msg = `승인 완료: ${ok}건`;
    if (fail > 0) msg += `\n실패: ${fail}건\n${errs.slice(0, 5).join('\n')}`;
    alert(msg);
    renderExpenseHistoryList().catch(console.error);
    renderExpensePendingList().catch(console.error);
});

// 직원 필터 로드
async function loadExpenseUserFilter() {
    try {
        const users = await api('/api/users/names');
        const filterEl = document.getElementById('expense-history-filter');
        if (!filterEl) return;
        const current = filterEl.value;
        filterEl.innerHTML = '<option value="">전체</option>' + users.map(u => `<option value="${u.id}">${u.position ? u.position + ' ' : ''}${u.name}</option>`).join('');
        if (current) filterEl.value = current;
    } catch (err) { console.error('직원 필터 로드 오류:', err); }
}

document.getElementById('expense-history-search')?.addEventListener('click', () => {
    renderExpenseHistoryList().catch(console.error);
});

// 지출결의서 조회 결과 엑셀 일괄 다운로드 (세무사 검토용)
document.getElementById('expense-history-download')?.addEventListener('click', () => {
    const data = window._lastExpenseHistory || [];
    if (data.length === 0) { alert('다운로드할 데이터가 없습니다. 먼저 검색을 실행해주세요.'); return; }

    const fmt = v => v ? new Date(v).toISOString().slice(0, 10) : '';
    const statusLabel = s => ({pending:'대기중', manager_approved:'1차 승인', approved:'최종 승인', rejected:'반려'}[s] || s);

    // 헤더
    const rows = [['사용날짜', '작성일', '신청자', '항목', '세부내용', '금액(원)', '비고', '상태']];

    let grandTotal = 0;
    // 각 결의서 → items 배열을 펼쳐서 항목별 행으로
    data.forEach(d => {
        const items = (() => {
            try { return typeof d.items === 'string' ? JSON.parse(d.items) : (d.items || []); }
            catch { return []; }
        })();
        const applicant = `${d.applicant_position || ''} ${d.applicant_name || ''}`.trim();
        const useDate = fmt(d.use_date);
        const createdDate = fmt(d.created_at);
        const status = statusLabel(d.status);

        if (items.length === 0) {
            // 항목 없는 결의서도 1행
            const amount = Number(d.total_amount) || 0;
            grandTotal += amount;
            rows.push([useDate, createdDate, applicant, d.title || '', '', amount, '', status]);
        } else {
            items.forEach(it => {
                const category = it.category || it.item || '';
                const detail = it.detail || '';
                const amount = Number(it.amount) || 0;
                const note = it.note || '';
                grandTotal += amount;
                rows.push([useDate, createdDate, applicant, category, detail, amount, note, status]);
            });
        }
    });

    // 합계 행 (빈 행 제거, 바로 합계로)
    rows.push(['', '', '', '', '총 합계', grandTotal, '', `${data.length}건`]);
    const totalRowIdx = rows.length - 1;

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
        { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
        { wch: 40 }, { wch: 14 }, { wch: 26 }, { wch: 12 }
    ];
    // 스타일 적용 (금액 컬럼=5, 합계 행)
    styleExcelSheet(ws, [5], [totalRowIdx]);
    XLSX.utils.book_append_sheet(wb, ws, '지출결의서');

    const start = document.getElementById('expense-history-start')?.value || '';
    const end = document.getElementById('expense-history-end')?.value || '';
    const range = (start || end) ? `${start || ''}~${end || ''}` : 'all';
    XLSX.writeFile(wb, `지출결의서_${range}.xlsx`);
});

function getExpenseStatusBadge(status) {
    const map = {
        'pending': '<span class="expense-status-badge pending">대기중</span>',
        'manager_approved': '<span class="expense-status-badge manager_approved">1차 승인</span>',
        'approved': '<span class="expense-status-badge approved">최종 승인</span>',
        'rejected': '<span class="expense-status-badge rejected">반려</span>'
    };
    return map[status] || status;
}

// 상세 보기 모달
window.viewExpenseDetail = async function(id) {
    try {
        const d = await api(`/api/expense-reports/${id}`);
        const items = typeof d.items === 'string' ? JSON.parse(d.items) : (d.items || []);

        // 결재란 + 도장 이미지 조회
        const detailSigIds = [d.applicant_id];
        if (d.manager_id) detailSigIds.push(d.manager_id);
        detailSigIds.push(d.ceo_id);
        const detailSigResults = await Promise.all(
            [...new Set(detailSigIds)].map(uid => api(`/api/users/${uid}/signature`).catch(() => ({ signatureImage: null })))
        );
        const detailSigMap = {};
        [...new Set(detailSigIds)].forEach((uid, i) => { detailSigMap[uid] = detailSigResults[i].signatureImage; });

        function stampAreaHtml(userId, status, fallbackText) {
            const sig = detailSigMap[userId];
            if (status && sig) return `<div class="stamp-area"><img src="${sig}" style="width:45px;height:45px;object-fit:contain;" alt="도장"></div>`;
            if (status) return `<div class="stamp-area approved">${fallbackText}</div>`;
            return `<div class="stamp-area">${fallbackText}</div>`;
        }

        let stampHtml = '<div class="expense-detail-approval">';
        stampHtml += `<div class="expense-stamp-box">
            <div class="stamp-label">신청자</div>
            ${stampAreaHtml(d.applicant_id, true, '신청')}
            <div class="stamp-name">${d.applicant_name}</div>
        </div>`;
        if (d.manager_id) {
            const mApproved = d.manager_status === 'approved';
            const mText = mApproved ? '승인' : (d.status === 'rejected' && d.rejected_by === d.manager_id ? '반려' : '대기');
            stampHtml += `<div class="expense-stamp-box">
                <div class="stamp-label">부장</div>
                ${stampAreaHtml(d.manager_id, mApproved, mText)}
                <div class="stamp-name">${d.manager_name || ''}</div>
            </div>`;
        }
        const cApproved = d.ceo_status === 'approved';
        const cText = cApproved ? '승인' : (d.status === 'rejected' && d.rejected_by === d.ceo_id ? '반려' : '대기');
        stampHtml += `<div class="expense-stamp-box">
            <div class="stamp-label">대표</div>
            ${stampAreaHtml(d.ceo_id, cApproved, cText)}
            <div class="stamp-name">${d.ceo_name || ''}</div>
        </div>`;
        stampHtml += '</div>';

        // 항목 테이블
        const itemRows = items.map(i => {
            const name = i.category || i.item || '';
            const detail = i.detail ? `<div style="font-size:12px;color:#6b7280;">${i.detail}</div>` : '';
            return `<tr><td>${name}${detail}</td><td style="text-align:right">${Number(i.amount).toLocaleString()} 원</td><td>${i.note || ''}</td></tr>`;
        }).join('');

        // 반려 사유
        const rejectHtml = d.status === 'rejected' ? `<div style="margin-top:12px;padding:12px;background:#fee2e2;border-radius:8px;"><strong>반려 사유:</strong> ${d.reject_reason || '(사유 없음)'}<br><small>반려자: ${d.rejected_by_name || ''}</small></div>` : '';

        // PDF 다운로드 버튼 (승인완료 + 관리자만)
        const pdfBtn = d.status === 'approved' && currentUser.role === 'admin'
            ? `<button class="btn-primary" onclick="downloadExpensePDF(${d.id})" style="margin-right:8px;">PDF 다운로드</button>`
            : '';

        // 재요청 버튼 (반려된 결의서 + 신청자 본인일 때만)
        const resubmitBtn = d.status === 'rejected' && d.applicant_id === currentUser.id
            ? `<button class="btn-primary" onclick="resubmitExpense(${d.id})" style="margin-right:8px;background:#0066CC;border-color:#0066CC;">🔄 재요청</button>`
            : '';

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="max-width:560px;">
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                <h3 style="text-align:center;margin-bottom:8px;">지출결의서</h3>
                ${stampHtml}
                <div style="margin-bottom:8px;"><strong>제목:</strong> ${d.title}</div>
                <div style="margin-bottom:8px;"><strong>작성일:</strong> ${new Date(d.created_at).toLocaleDateString()}</div>
                <div style="margin-bottom:8px;"><strong>사용날짜:</strong> ${d.use_date ? new Date(d.use_date).toLocaleDateString() : '-'}</div>
                <div style="margin-bottom:12px;"><strong>지출목적:</strong> ${d.purpose || '-'}</div>
                <table class="data-table">
                    <thead><tr><th>항목</th><th style="text-align:right">금액(원)</th><th>비고</th></tr></thead>
                    <tbody>${itemRows}</tbody>
                    <tfoot><tr><td><strong>합계</strong></td><td style="text-align:right"><strong>${Number(d.total_amount).toLocaleString()} 원</strong></td><td></td></tr></tfoot>
                </table>
                ${rejectHtml}
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
                    ${pdfBtn}
                    ${resubmitBtn}
                    <button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">닫기</button>
                </div>
            </div>
        `;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    } catch (err) { alert('상세 조회 실패: ' + err.message); }
};

// 재요청 (반려된 결의서를 다시 결재대기로 — 신청자 본인만)
window.resubmitExpense = async function(id) {
    if (!confirm('이 지출결의서를 다시 결재 요청하시겠습니까?\n반려 사유는 초기화되며 결재라인이 처음부터 다시 진행됩니다.')) return;
    try {
        await api(`/api/expense-reports/${id}/resubmit`, 'PUT');
        alert('재요청 완료');
        document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
        renderExpenseMyList().catch(console.error);
        renderExpenseHistoryList().catch(console.error);
    } catch (err) { alert('재요청 실패: ' + err.message); }
};

// 승인
window.approveExpense = async function(id) {
    if (!confirm('이 지출결의서를 승인하시겠습니까?')) return;
    try {
        await api(`/api/expense-reports/${id}/approve`, 'PUT');
        alert('승인 완료');
        renderExpensePendingList().catch(console.error);
        renderExpenseHistoryList().catch(console.error);
    } catch (err) { alert('승인 실패: ' + err.message); }
};

// 반려
window.rejectExpense = async function(id) {
    const reason = prompt('반려 사유를 입력해주세요:');
    if (reason === null) return;
    try {
        await api(`/api/expense-reports/${id}/reject`, 'PUT', { reason });
        alert('반려 완료');
        renderExpensePendingList().catch(console.error);
        renderExpenseHistoryList().catch(console.error);
    } catch (err) { alert('반려 실패: ' + err.message); }
};

// 삭제 (대표만)
window.deleteExpense = async function(id) {
    if (!confirm('이 지출결의서를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    try {
        await api(`/api/expense-reports/${id}`, 'DELETE');
        alert('삭제 완료');
        renderExpenseHistoryList().catch(console.error);
    } catch (err) { alert('삭제 실패: ' + err.message); }
};

// PDF 다운로드
window.downloadExpensePDF = async function(id) {
    try {
        const d = await api(`/api/expense-reports/${id}`);
        const items = typeof d.items === 'string' ? JSON.parse(d.items) : (d.items || []);

        // 결재란 데이터 + 도장 이미지 조회
        const stamps = [];
        const sigIds = [d.applicant_id];
        stamps.push({ label: '신청자', name: d.applicant_name, status: '신청', userId: d.applicant_id });
        if (d.manager_id) {
            stamps.push({ label: '부장', name: d.manager_name || '', status: d.manager_status === 'approved' ? '승인' : '', userId: d.manager_id });
            sigIds.push(d.manager_id);
        }
        stamps.push({ label: '대표', name: d.ceo_name || '', status: d.ceo_status === 'approved' ? '승인' : '', userId: d.ceo_id });
        sigIds.push(d.ceo_id);

        // 도장 이미지 병렬 조회
        const sigResults = await Promise.all(
            [...new Set(sigIds)].map(uid => api(`/api/users/${uid}/signature`).catch(() => ({ signatureImage: null })))
        );
        const sigMap = {};
        [...new Set(sigIds)].forEach((uid, i) => { sigMap[uid] = sigResults[i].signatureImage; });

        // 항목 행 HTML
        const itemRows = items.map(i => {
            const name = i.category || i.item || '';
            const detail = i.detail ? `<div style="font-size:11px;color:#6b7280;">${i.detail}</div>` : '';
            return `<tr><td style="padding:8px 12px;border:1px solid #000;text-align:left;">${name}${detail}</td>` +
                `<td style="padding:8px 12px;border:1px solid #000;text-align:right;">${Number(i.amount).toLocaleString()}</td>` +
                `<td style="padding:8px 12px;border:1px solid #000;text-align:left;">${i.note || ''}</td></tr>`;
        }).join('');

        // 결재란 HTML (도장 이미지 있으면 이미지, 없으면 텍스트)
        const stampHtml = stamps.map(s => {
            const sig = sigMap[s.userId];
            let stampContent;
            if (s.status && sig) {
                stampContent = `<img src="${sig}" style="width:50px;height:50px;object-fit:contain;" alt="도장">`;
            } else if (s.status) {
                stampContent = `<span style="font-size:16px;font-weight:bold;color:#dc2626;">${s.status}</span>`;
            } else {
                stampContent = '';
            }
            return `<td style="width:90px;border:1px solid #000;padding:0;text-align:center;vertical-align:top;">` +
                `<div style="background:#f3f4f6;padding:4px;font-size:12px;font-weight:bold;border-bottom:1px solid #000;">${s.label}</div>` +
                `<div style="height:55px;display:flex;align-items:center;justify-content:center;">${stampContent}</div>` +
                `<div style="padding:4px;font-size:12px;border-top:1px solid #000;background:#f9fafb;">${s.name}</div></td>`;
        }).join('');

        // 숨겨진 HTML 요소 생성
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:40px;box-sizing:border-box;font-family:"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo",sans-serif;';
        container.innerHTML = `
            <div style="border:2px solid #000;padding:30px;min-height:1050px;position:relative;">
                <h1 style="text-align:center;font-size:26px;letter-spacing:12px;margin:0 0 20px 0;">지출결의서</h1>
                <table style="border-collapse:collapse;margin-left:auto;margin-bottom:24px;">
                    <tr>${stampHtml}</tr>
                </table>
                <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                    <tr><td style="padding:8px 0;font-weight:bold;width:80px;">제목</td><td style="padding:8px 0;">${d.title}</td></tr>
                    <tr><td style="padding:8px 0;font-weight:bold;">사용날짜</td><td style="padding:8px 0;">${new Date(d.use_date || d.created_at).toLocaleDateString()}</td></tr>
                    <tr><td style="padding:8px 0;font-weight:bold;">지출목적</td><td style="padding:8px 0;">${d.purpose || '-'}</td></tr>
                </table>
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            <th style="padding:8px 12px;border:1px solid #000;text-align:center;width:40%;">항목</th>
                            <th style="padding:8px 12px;border:1px solid #000;text-align:center;width:30%;">금액(원)</th>
                            <th style="padding:8px 12px;border:1px solid #000;text-align:center;width:30%;">비고</th>
                        </tr>
                    </thead>
                    <tbody>${itemRows}</tbody>
                    <tfoot>
                        <tr style="background:#f9fafb;">
                            <td style="padding:8px 12px;border:1px solid #000;text-align:center;font-weight:bold;">합계</td>
                            <td style="padding:8px 12px;border:1px solid #000;text-align:right;font-weight:bold;">${Number(d.total_amount).toLocaleString()} 원</td>
                            <td style="padding:8px 12px;border:1px solid #000;"></td>
                        </tr>
                    </tfoot>
                </table>
                <div style="position:absolute;bottom:20px;left:0;right:0;text-align:center;color:#6b7280;font-size:14px;">제주아꼼이네 농업회사법인(주)</div>
            </div>
        `;
        document.body.appendChild(container);

        // html2canvas로 렌더링
        const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        document.body.removeChild(container);

        // jsPDF로 PDF 생성
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgData = canvas.toDataURL('image/png');
        const pdfW = 210;
        const pdfH = (canvas.height * pdfW) / canvas.width;
        pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
        pdf.save(`지출결의서_${d.title}.pdf`);
    } catch (err) { alert('PDF 다운로드 실패: ' + err.message); }
};

// ============================================================
//  카드이용내역 (지출결의서 페이지 내부 탭)
// ============================================================

// 카드내역 카테고리는 지출결의서(EXPENSE_CATEGORIES)와 동일하게 사용
// 옛 카테고리 → 새 카테고리 자동 매핑 (기존 데이터 호환)
const CARD_CATEGORY_MIGRATION = {
    '식비': '복리후생비',
    '교통': '업무차 교통비',
    '접대': '업무차 접대비',
    '소모품': '소모품비'
};
function normalizeCardCategory(cat) {
    return CARD_CATEGORY_MIGRATION[cat] || cat || '기타';
}
function getCardCategoryDetail(name) {
    const c = EXPENSE_CATEGORIES.find(c => c.name === name);
    return c ? c.detail : '';
}
function categorySlug(name) {
    return (name || '기타').replace(/\s+/g, '');
}
let cardTxAll = [];

// 엑셀 시트 스타일 일괄 적용 (테두리 + 천단위 콤마 + 헤더/합계 강조)
// amountCols: 천단위 콤마 적용할 0-based 컬럼 인덱스 배열
// totalRows: 합계 행으로 강조할 0-based 행 인덱스 배열 (옵션)
function styleExcelSheet(ws, amountCols = [], totalRows = []) {
    if (!ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const border = {
        top: { style: 'thin', color: { rgb: '999999' } },
        bottom: { style: 'thin', color: { rgb: '999999' } },
        left: { style: 'thin', color: { rgb: '999999' } },
        right: { style: 'thin', color: { rgb: '999999' } }
    };
    for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const ref = XLSX.utils.encode_cell({ r: R, c: C });
            if (!ws[ref]) ws[ref] = { t: 's', v: '' };
            const isHeader = R === 0;
            const isTotal = totalRows.includes(R);
            const isAmount = amountCols.includes(C);
            const s = { border, alignment: { vertical: 'center', wrapText: true } };
            if (isHeader) {
                s.font = { bold: true, sz: 11 };
                s.fill = { fgColor: { rgb: 'E6F0FA' } };
                s.alignment = { horizontal: 'center', vertical: 'center' };
            } else if (isTotal) {
                s.font = { bold: true };
                s.fill = { fgColor: { rgb: 'FFF8E1' } };
            }
            if (isAmount && !isHeader) {
                s.numFmt = '#,##0';
                s.alignment = { ...s.alignment, horizontal: 'right' };
                // 숫자 셀로 명시
                if (typeof ws[ref].v === 'number') ws[ref].t = 'n';
            }
            ws[ref].s = s;
        }
    }
}

function initCardTransactionsTab() {
    if (!currentUser) return;
    const isAccountant = currentUser.role === 'accountant';

    // 세무사: 업로드/수정/삭제 버튼 숨김
    const actionsEl = document.getElementById('card-bank-actions');
    const readonlyBadge = document.getElementById('card-readonly-badge');
    if (isAccountant) {
        if (actionsEl) {
            // 다운로드 버튼만 남김
            const uploadBtn = document.getElementById('card-upload-btn');
            if (uploadBtn) uploadBtn.style.display = 'none';
        }
        if (readonlyBadge) readonlyBadge.style.display = '';
    } else {
        const uploadBtn = document.getElementById('card-upload-btn');
        if (uploadBtn) uploadBtn.style.display = '';
        if (readonlyBadge) readonlyBadge.style.display = 'none';
    }

    // 기본값: 이번 달 1일 ~ 오늘
    const startEl = document.getElementById('card-filter-start');
    const endEl = document.getElementById('card-filter-end');
    if (startEl && !startEl.value) {
        const now = new Date();
        const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        startEl.value = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
        endEl.value = ymd(now);
    }

    loadCardTransactions().catch(console.error);
}

async function loadCardTransactions() {
    try {
        const start = document.getElementById('card-filter-start').value;
        const end = document.getElementById('card-filter-end').value;
        const params = [];
        if (start) params.push(`start_date=${start}`);
        if (end) params.push(`end_date=${end}`);
        const qs = params.length ? '?' + params.join('&') : '';
        cardTxAll = await api('/api/card-transactions' + qs);
        renderCardTransactions();
    } catch (err) {
        console.error('카드내역 로드 실패:', err);
        document.getElementById('card-tx-list').innerHTML =
            `<tr class="empty-row"><td colspan="7">불러오기 실패: ${err.message}</td></tr>`;
    }
}

function renderCardTransactions() {
    const tbody = document.getElementById('card-tx-list');
    const isAccountant = currentUser.role === 'accountant';

    if (cardTxAll.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7">카드 이용내역이 없습니다.</td></tr>';
        document.getElementById('card-tx-total').textContent = '0 원';
        document.getElementById('card-tx-count').textContent = '-';
        document.getElementById('card-bank-summary').innerHTML = '';
        return;
    }

    let total = 0;
    const byCategory = {};
    tbody.innerHTML = cardTxAll.map(tx => {
        const amount = Number(tx.amount) || 0;
        total += amount;
        const catName = normalizeCardCategory(tx.category);
        byCategory[catName] = (byCategory[catName] || 0) + amount;
        const catDetail = getCardCategoryDetail(catName);
        const catSlug = categorySlug(catName);
        const dateStr = (tx.transaction_date || '').toString().split('T')[0];
        const categoryOptions = EXPENSE_CATEGORIES.map(c =>
            `<option value="${c.name}" ${c.name === catName ? 'selected' : ''}>${c.name}</option>`
        ).join('');

        const categoryCell = isAccountant
            ? `<div class="card-category-cell">
                 <span class="card-category-badge cat-${catSlug}">${catName}</span>
                 ${catDetail ? `<div class="card-tx-cat-detail">${escapeHtml(catDetail)}</div>` : ''}
               </div>`
            : `<div class="card-category-cell">
                 <select class="card-tx-category" data-id="${tx.id}">${categoryOptions}</select>
                 <div class="card-tx-cat-detail">${escapeHtml(catDetail)}</div>
               </div>`;

        const memoCell = isAccountant
            ? `<span>${escapeHtml(tx.memo || '')}</span>`
            : `<input type="text" class="card-tx-memo" data-id="${tx.id}" value="${escapeHtml(tx.memo || '')}" placeholder="메모">`;

        const processed = !!tx.is_processed;
        const statusCell = isAccountant
            ? `<span class="card-status-badge ${processed ? 'status-done' : 'status-todo'}">${processed ? '입력' : '미입력'}</span>`
            : `<button class="card-status-btn ${processed ? 'status-done' : 'status-todo'}" onclick="toggleCardProcessed(${tx.id}, ${!processed})">${processed ? '입력' : '미입력'}</button>`;

        const actionCell = isAccountant
            ? ''
            : `<button class="btn-icon-delete" onclick="deleteCardTransaction(${tx.id})" title="삭제">🗑</button>`;

        return `<tr>
            <td>${dateStr}</td>
            <td>${escapeHtml(tx.merchant_name)}</td>
            <td style="text-align:right;font-weight:600;">${amount.toLocaleString()}</td>
            <td>${categoryCell}</td>
            <td>${memoCell}</td>
            <td>${statusCell}</td>
            <td class="card-action-col">${actionCell}</td>
        </tr>`;
    }).join('');

    document.getElementById('card-tx-total').textContent = total.toLocaleString() + ' 원';
    document.getElementById('card-tx-count').textContent = `${cardTxAll.length}건`;

    // 카테고리별 소계
    const summaryEl = document.getElementById('card-bank-summary');
    summaryEl.innerHTML = Object.entries(byCategory)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, sum]) => `<span class="card-category-summary cat-${categorySlug(cat)}">${cat}: ${sum.toLocaleString()}원</span>`)
        .join('');

    // 이벤트 바인딩 (수정 가능 모드만)
    if (!isAccountant) {
        tbody.querySelectorAll('.card-tx-category').forEach(sel => {
            sel.addEventListener('change', async () => {
                const newCat = sel.value;
                // 세부내용 즉시 반영
                const detailEl = sel.closest('.card-category-cell')?.querySelector('.card-tx-cat-detail');
                if (detailEl) detailEl.textContent = getCardCategoryDetail(newCat);
                try {
                    await api(`/api/card-transactions/${sel.dataset.id}`, 'PUT', { category: newCat });
                    const tx = cardTxAll.find(t => t.id === Number(sel.dataset.id));
                    if (tx) tx.category = newCat;
                    renderCardTransactions(); // 소계 갱신용 전체 재렌더
                } catch (err) { alert('수정 실패: ' + err.message); }
            });
        });
        tbody.querySelectorAll('.card-tx-memo').forEach(input => {
            input.addEventListener('blur', async () => {
                try {
                    await api(`/api/card-transactions/${input.dataset.id}`, 'PUT', { memo: input.value });
                    const tx = cardTxAll.find(t => t.id === Number(input.dataset.id));
                    if (tx) tx.memo = input.value;
                } catch (err) { alert('메모 저장 실패: ' + err.message); }
            });
        });
    }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 필터 이벤트
document.getElementById('card-filter-apply')?.addEventListener('click', () => loadCardTransactions());
document.getElementById('card-filter-reset')?.addEventListener('click', () => {
    document.getElementById('card-filter-start').value = '';
    document.getElementById('card-filter-end').value = '';
    loadCardTransactions();
});

// 업로드
document.getElementById('card-upload-btn')?.addEventListener('click', () => {
    document.getElementById('card-upload-file').click();
});
document.getElementById('card-upload-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const transactions = await parseCardFile(file);
        if (transactions.length === 0) { alert('파일에서 유효한 카드내역을 찾을 수 없습니다.'); return; }
        if (!confirm(`${transactions.length}건을 업로드하시겠습니까?\n(같은 날짜+가맹점+금액은 자동 스킵)`)) return;
        const result = await api('/api/card-transactions/bulk', 'POST', { transactions });
        alert(`업로드 완료\n신규: ${result.inserted}건 / 중복 스킵: ${result.skipped}건`);
        loadCardTransactions();
    } catch (err) {
        alert('업로드 실패: ' + err.message);
    } finally {
        e.target.value = '';
    }
});

async function parseCardFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = new Uint8Array(ev.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
                if (rows.length === 0) return resolve([]);
                // 헤더 인식: 날짜/가맹점/금액 키워드 찾기 (최대 30행까지 스캔)
                let headerIdx = -1, dateCol = -1, merchantCol = -1, amountCol = -1;
                // 금액 키워드는 "합계"가 들어간 셀(요약행)은 제외
                const isAmountHeader = c => /(금액|amount)/i.test(c) && !/합계|총액|total/i.test(c);
                for (let i = 0; i < Math.min(rows.length, 30); i++) {
                    const r = rows[i].map(c => String(c).trim());
                    const di = r.findIndex(c => /(사용일|이용일|거래일|승인일|날짜|일자|date)/i.test(c));
                    const mi = r.findIndex(c => /(가맹점|상호|merchant|store)/i.test(c));
                    const ai = r.findIndex(c => isAmountHeader(c));
                    if (di >= 0 && mi >= 0 && ai >= 0) {
                        headerIdx = i; dateCol = di; merchantCol = mi; amountCol = ai;
                        break;
                    }
                }
                if (headerIdx < 0) {
                    // 기본 가정: 0=날짜, 1=가맹점, 2=금액
                    headerIdx = -1; dateCol = 0; merchantCol = 1; amountCol = 2;
                }
                const transactions = [];
                for (let i = headerIdx + 1; i < rows.length; i++) {
                    const r = rows[i];
                    const dateRaw = r[dateCol];
                    const merchant = String(r[merchantCol] || '').trim();
                    let amountRaw = r[amountCol];
                    if (!dateRaw || !merchant) continue;
                    // 금액 파싱: 쉼표/공백/원 제거
                    const amount = Number(String(amountRaw).replace(/[^\d.-]/g, '')) || 0;
                    if (amount === 0) continue;
                    // 날짜 파싱
                    let dateStr;
                    if (dateRaw instanceof Date) {
                        dateStr = `${dateRaw.getFullYear()}-${String(dateRaw.getMonth() + 1).padStart(2, '0')}-${String(dateRaw.getDate()).padStart(2, '0')}`;
                    } else {
                        const s = String(dateRaw).trim().replace(/\./g, '-').replace(/\//g, '-');
                        const m = s.match(/(\d{4})-?(\d{1,2})-?(\d{1,2})/);
                        if (!m) continue;
                        dateStr = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
                    }
                    transactions.push({ transaction_date: dateStr, merchant_name: merchant, amount });
                }
                resolve(transactions);
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('파일 읽기 실패'));
        reader.readAsArrayBuffer(file);
    });
}

// 엑셀 다운로드
document.getElementById('card-download-btn')?.addEventListener('click', () => {
    if (cardTxAll.length === 0) { alert('다운로드할 데이터가 없습니다.'); return; }
    const rows = [['날짜', '가맹점명', '금액', '카테고리', '세부내용', '메모', '처리상태']];
    let cardTotal = 0;
    cardTxAll.forEach(tx => {
        const dateStr = (tx.transaction_date || '').toString().split('T')[0];
        const catName = normalizeCardCategory(tx.category);
        const amt = Number(tx.amount) || 0;
        cardTotal += amt;
        rows.push([
            dateStr,
            tx.merchant_name,
            amt,
            catName,
            getCardCategoryDetail(catName),
            tx.memo || '',
            tx.is_processed ? '입력' : '미입력'
        ]);
    });
    // 합계 행
    rows.push(['', '총 합계', cardTotal, '', '', `${cardTxAll.length}건`, '']);
    const totalRowIdx = rows.length - 1;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 40 }, { wch: 30 }, { wch: 10 }];
    // 스타일 적용 (금액 컬럼=2, 합계 행)
    styleExcelSheet(ws, [2], [totalRowIdx]);
    XLSX.utils.book_append_sheet(wb, ws, '카드이용내역');
    const start = document.getElementById('card-filter-start').value;
    const end = document.getElementById('card-filter-end').value;
    const range = (start || end) ? `${start || ''}~${end || ''}` : 'all';
    XLSX.writeFile(wb, `카드이용내역_${range}.xlsx`);
});

// 삭제
window.deleteCardTransaction = async function(id) {
    if (!confirm('이 카드내역을 삭제하시겠습니까?')) return;
    try {
        await api(`/api/card-transactions/${id}`, 'DELETE');
        loadCardTransactions();
    } catch (err) { alert('삭제 실패: ' + err.message); }
};

// 처리상태 토글 (미입력 ↔ 입력) - 같은 행의 메모도 함께 저장
window.toggleCardProcessed = async function(id, nextValue) {
    try {
        const payload = { is_processed: nextValue };
        // 같은 행의 메모 input 현재값도 같이 전송 (blur보다 click이 먼저 발생해 메모 유실 방지)
        const memoInput = document.querySelector(`.card-tx-memo[data-id="${id}"]`);
        if (memoInput) payload.memo = memoInput.value;
        await api(`/api/card-transactions/${id}`, 'PUT', payload);
        const tx = cardTxAll.find(t => t.id === id);
        if (tx) {
            tx.is_processed = nextValue;
            if (memoInput) tx.memo = memoInput.value;
        }
        renderCardTransactions();
    } catch (err) { alert('상태 변경 실패: ' + err.message); }
};

// ============================================================
//  정산관리/정산현황 탭 전환
// ============================================================
document.querySelectorAll('.settlement-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.settlement-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.settlement-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
        // 정산현황 탭 처음 열 때 초기화
        if (tab.dataset.tab === 'settlement-status' && !window._ssInitialized) {
            ssInit();
            window._ssInitialized = true;
        }
    });
});

// ============================================================
//  정산현황 (Settlement Status) - 서버 DB 기반
//  모든 함수/변수명은 ss 접두사로 충돌 방지
// ============================================================

function ssBlank() {
    return {
        settlement_scheduled: 0, unsettled: 0, current_cash: 0,
        ad_naver: 0, ad_gfa: 0,
        card_fee: 0, corp_card: 0,
        hyodong: 0, daesong: 0, aewol: 0, delivery: 0,
        coupang_unpaid: 0, selfmall_unpaid: 0,
        memo: ''
    };
}

function ssCompute(r) {
    const n = k => ssToNum(r[k]);
    const subtotal = n('current_cash')
        + n('settlement_scheduled') + n('unsettled')
        + n('coupang_unpaid') + n('selfmall_unpaid')
        + n('ad_naver') + n('ad_gfa')
        - n('card_fee') - n('corp_card');
    const total = subtotal - n('delivery') - n('hyodong') - n('daesong') - n('aewol');
    return { subtotal, total };
}

let ssAll = [];
let ssCur = null;
let ssCalYear = new Date().getFullYear();
let ssCalMonth = new Date().getMonth(); // 0-based

async function ssInit() {
    try {
        const data = await api('/api/settlement-status');
        ssAll = data.map(row => ({
            date: row.date.split('T')[0],
            record: {
                current_cash: Number(row.current_cash) || 0,
                settlement_scheduled: Number(row.settlement_scheduled) || 0,
                unsettled: Number(row.unsettled) || 0,
                coupang_unpaid: Number(row.coupang_unpaid) || 0,
                selfmall_unpaid: Number(row.selfmall_unpaid) || 0,
                ad_naver: Number(row.ad_naver) || 0,
                ad_gfa: Number(row.ad_gfa) || 0,
                card_fee: Number(row.card_fee) || 0,
                corp_card: Number(row.corp_card) || 0,
                hyodong: Number(row.hyodong) || 0,
                daesong: Number(row.daesong) || 0,
                aewol: Number(row.aewol) || 0,
                delivery: Number(row.delivery) || 0,
                memo: row.memo || ''
            }
        }));
        if (ssAll.length) ssCur = ssAll[0].date;
    } catch (err) {
        console.error('ssInit error:', err);
        ssAll = [];
        ssCur = null;
    }
    const t = new Date();
    const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    document.getElementById('ss-newDate').value = todayStr;
    document.getElementById('ss-date-input').value = ssCur || todayStr;
    // 선택된 날짜가 있으면 해당 월로 달력 이동
    if (ssCur) {
        const [y, m] = ssCur.split('-');
        ssCalYear = parseInt(y);
        ssCalMonth = parseInt(m) - 1;
    }
    ssRenderCalendar();
    ssRenderMain();
}

// 날짜 선택 시 호출
async function ssSelectDate(dateStr) {
    if (!dateStr) return;
    const existing = ssAll.find(e => e.date === dateStr);
    if (existing) {
        ssCur = dateStr;
        ssRenderCalendar();
        ssRenderMain();
        return;
    }
    const rec = ssBlank();
    ssAll.push({ date: dateStr, record: rec, _temp: true });
    ssAll.sort((a, b) => b.date.localeCompare(a.date));
    ssCur = dateStr;
    ssRenderCalendar();
    ssRenderMain();
}

function ssCalPrev() { ssCalMonth--; if (ssCalMonth < 0) { ssCalMonth = 11; ssCalYear--; } ssRenderCalendar(); }
function ssCalNext() { ssCalMonth++; if (ssCalMonth > 11) { ssCalMonth = 0; ssCalYear++; } ssRenderCalendar(); }

function ssRenderCalendar() {
    const wrap = document.getElementById('ss-cal-wrap');
    const year = ssCalYear, month = ssCalMonth;
    const firstDay = new Date(year, month, 1).getDay(); // 0=일
    const lastDate = new Date(year, month + 1, 0).getDate();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const mm = String(month + 1).padStart(2, '0');

    // 이 달에 데이터가 있는 날짜들의 금액 맵
    const amountMap = {};
    ssAll.forEach(({ date, record }) => {
        if (date.startsWith(`${year}-${mm}`)) {
            const day = parseInt(date.split('-')[2]);
            const { total } = ssCompute(record);
            amountMap[day] = total;
        }
    });

    // 전일대비 계산: 해당 날짜 기준 직전 데이터 날짜와의 차이
    const diffMap = {};
    // ssAll을 날짜 오름차순 정렬하여 전체에서 직전 데이터 찾기
    const sortedAll = [...ssAll].sort((a, b) => a.date.localeCompare(b.date));
    for (let d = 1; d <= lastDate; d++) {
        if (!amountMap.hasOwnProperty(d)) continue;
        const dateStr2 = `${year}-${mm}-${String(d).padStart(2, '0')}`;
        const idx = sortedAll.findIndex(s => s.date === dateStr2);
        if (idx > 0) {
            const prevRec = sortedAll[idx - 1].record;
            const { total: prevTotal } = ssCompute(prevRec);
            diffMap[d] = amountMap[d] - prevTotal;
        }
    }

    let html = `
    <div class="ss-cal-header">
      <button class="ss-cal-nav" onclick="ssCalPrev()">◀</button>
      <div class="ss-cal-title">${year}년 ${month + 1}월</div>
      <button class="ss-cal-nav" onclick="ssCalNext()">▶</button>
    </div>
    <div class="ss-cal-grid">`;

    // 요일 헤더
    days.forEach((d, i) => {
        const cls = i === 0 ? ' ss-cal-sun' : i === 6 ? ' ss-cal-sat' : '';
        html += `<div class="ss-cal-dayname${cls}">${d}</div>`;
    });

    // 빈 칸
    for (let i = 0; i < firstDay; i++) html += `<div class="ss-cal-cell ss-cal-empty"></div>`;

    // 날짜 칸
    for (let d = 1; d <= lastDate; d++) {
        const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`;
        const hasData = amountMap.hasOwnProperty(d);
        const isSelected = dateStr === ssCur;
        const dayOfWeek = new Date(year, month, d).getDay();
        let cls = 'ss-cal-cell';
        if (isSelected) cls += ' ss-cal-sel';
        if (hasData) cls += ' ss-cal-has';
        if (dayOfWeek === 0) cls += ' ss-cal-sun';
        if (dayOfWeek === 6) cls += ' ss-cal-sat';

        let amtHtml = '';
        if (hasData) {
            const amt = amountMap[d];
            const amtCls = amt >= 0 ? 'ss-cal-amt-pos' : 'ss-cal-amt-neg';
            const display = Math.abs(amt) >= 10000
                ? (amt >= 0 ? '' : '-') + Math.round(Math.abs(amt) / 10000).toLocaleString() + '만'
                : amt.toLocaleString();
            amtHtml = `<div class="ss-cal-amt ${amtCls}">${display}</div>`;

            if (diffMap.hasOwnProperty(d)) {
                const diff = diffMap[d];
                const sign = diff > 0 ? '+' : '';
                const diffDisplay = Math.abs(diff) >= 10000
                    ? sign + Math.round(diff / 10000).toLocaleString() + '만'
                    : sign + diff.toLocaleString();
                const diffCls = diff > 0 ? 'ss-cal-diff-up' : diff < 0 ? 'ss-cal-diff-down' : 'ss-cal-diff-zero';
                amtHtml += `<div class="ss-cal-diff ${diffCls}">${diffDisplay}</div>`;
            }
        }

        html += `<div class="${cls}" onclick="ssCalClick('${dateStr}', ${hasData})">
          <div class="ss-cal-num">${d}</div>
          ${amtHtml}
        </div>`;
    }

    html += `</div>`;
    wrap.innerHTML = html;
}

function ssCalClick(dateStr, hasData) {
    if (hasData) {
        ssCur = dateStr;
        document.getElementById('ss-date-input').value = dateStr;
        ssRenderCalendar();
        ssRenderMain();
        // 상세 영역으로 스크롤
        setTimeout(() => {
            document.getElementById('ss-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    } else {
        // 데이터 없는 날짜 → 새로 추가할지 물어봄
        if (confirm(`${dateStr} 에 정산 데이터를 추가할까요?`)) {
            ssSelectDate(dateStr);
        }
    }
}

// 기존 호환용
function ssRenderTabs() { ssRenderCalendar(); }

function ssLbl(d) { const [y, m, day] = d.split('-'); return `${y.slice(2)}.${m}.${day}`; }

async function ssRenderMain() {
    const wrap = document.getElementById('ss-wrap');
    if (!ssCur) {
        wrap.innerHTML = `<div class="ss-empty"><div class="ss-ico">📋</div><p>위에서 <b>날짜를 선택</b>하면 정산 현황을 확인할 수 있습니다.</p></div>`;
        return;
    }
    document.getElementById('ss-date-input').value = ssCur;
    const entry = ssAll.find(e => e.date === ssCur);
    const r = entry.record;

    // 정산관리 전체 미결제 금액 자동 매칭 (새 날짜에만 적용, 저장된 날짜는 DB값 유지)
    if (entry._temp) {
        try {
            const totalUnpaid = await api('/api/settlements/total-unpaid');
            r.daesong = totalUnpaid.daesung || 0;
            r.hyodong = totalUnpaid.hyodon || 0;
            r.aewol = totalUnpaid.aewol || 0;
            r.delivery = totalUnpaid.cj || 0;
        } catch (err) {
            console.error('정산항목 자동매칭 실패:', err);
        }
    }

    const { subtotal, total } = ssCompute(r);
    const n = k => parseFloat(r[k] || 0);

    wrap.innerHTML = `
    <div class="ss-date-banner">
      <div class="ss-date-banner-left">
        <div class="ss-date-banner-co">제주아꼼이네 농업회사법인(주)</div>
        <div class="ss-date-banner-title">${ssCur.split('-')[0].slice(2)}년 ${parseInt(ssCur.split('-')[1])}월 ${parseInt(ssCur.split('-')[2])}일 <span>현황</span></div>
      </div>
      <div class="ss-date-banner-right">
        <div class="ss-date-banner-day">정산일</div>
        <div class="ss-date-banner-badge">${ssCur}</div>
      </div>
    </div>
    <div class="ss-slbl">📊 요약</div>
    <div class="ss-sc-total-wrap">
      <div class="ss-sc total">
        <div class="ss-total-left">
          <div class="ss-sc-lbl">총 합계</div>
          <div class="ss-sc-sub">최종 정산 합계</div>
        </div>
        <div class="ss-total-right">
          <div class="ss-sc-val-total ${total < 0 ? 'r' : ''}" id="ss_sc_tot">${ssFmt(total)}</div>
        </div>
      </div>
    </div>
    <div class="ss-sg">
      <div class="ss-sc y ss-sc-click" onclick="document.getElementById('ss-sec-settle').scrollIntoView({behavior:'smooth'})">
        <div class="ss-sc-lbl">정산현황</div>
        <div class="ss-sc-val" id="ss_sc_settle">${ssFmt(n('current_cash') + n('settlement_scheduled') + n('unsettled') + n('coupang_unpaid') + n('selfmall_unpaid'))}</div>
        <div class="ss-sc-sub">현재현금+스토어+쿠팡+자사몰</div>
      </div>
      <div class="ss-sc ss-sc-click" onclick="document.getElementById('ss-sec-ad').scrollIntoView({behavior:'smooth'})">
        <div class="ss-sc-lbl">광고비</div>
        <div class="ss-sc-val g" id="ss_sc_ad">+${ssFmt(n('ad_naver') + n('ad_gfa'))}</div>
        <div class="ss-sc-sub">네이버 + GFA</div>
      </div>
      <div class="ss-sc r ss-sc-click" onclick="document.getElementById('ss-sec-card').scrollIntoView({behavior:'smooth'})">
        <div class="ss-sc-lbl">카드비용</div>
        <div class="ss-sc-val r" id="ss_sc_card">-${ssFmt(n('card_fee') + n('corp_card'))}</div>
        <div class="ss-sc-sub">카드이용금액 + 법인카드</div>
      </div>
      <div class="ss-sc ss-sc-click" onclick="document.getElementById('ss-sec-items').scrollIntoView({behavior:'smooth'})">
        <div class="ss-sc-lbl">정산항목</div>
        <div class="ss-sc-val ${(-n('daesong') - n('hyodong') - n('aewol') - n('delivery')) >= 0 ? 'g' : 'r'}" id="ss_sc_items">${ssFmt(-n('daesong') - n('hyodong') - n('aewol') - n('delivery'))}</div>
        <div class="ss-sc-sub">－ 대성 / 효돈 / 애월 / 택배</div>
      </div>
    </div>

    <div class="ss-slbl" id="ss-sec-settle">💰 정산 현황</div>
    <div class="ss-card">
      <div class="ss-ch">📑 정산 내역 <a class="ss-ch-link" href="https://sell.smartstore.naver.com/#/home/dashboard" target="_blank">스마트스토어 확인하기 </a></div>
      <table class="ss-tbl">
        <tr class="ss-hl"><th>현재 현금 (계좌내역) <span class="ss-badge ss-badge-plus">＋</span></th>
          <td><input class="ss-ni ss-pos" type="text" inputmode="numeric" value="${ssAddComma(r.current_cash)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'current_cash')" onblur="ssOnBlurNi(this,'current_cash')"></td></tr>
        <tr><th>스토어 정산예정 <span class="ss-badge ss-badge-plus">＋</span></th>
          <td><input class="ss-ni ss-pos" type="text" inputmode="numeric" value="${ssAddComma(r.settlement_scheduled)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'settlement_scheduled')" onblur="ssOnBlurNi(this,'settlement_scheduled')"></td></tr>
        <tr><th>스토어 미정산 <span class="ss-badge ss-badge-plus">＋</span></th>
          <td><input class="ss-ni ss-pos" type="text" inputmode="numeric" value="${ssAddComma(r.unsettled)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'unsettled')" onblur="ssOnBlurNi(this,'unsettled')"></td></tr>
        <tr><th>쿠팡 미정산 <span class="ss-badge ss-badge-plus">＋</span></th>
          <td><input class="ss-ni ss-pos" type="text" inputmode="numeric" value="${ssAddComma(r.coupang_unpaid)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'coupang_unpaid')" onblur="ssOnBlurNi(this,'coupang_unpaid')"></td></tr>
        <tr><th>자사몰 미정산 <span class="ss-badge ss-badge-plus">＋</span></th>
          <td><input class="ss-ni ss-pos" type="text" inputmode="numeric" value="${ssAddComma(r.selfmall_unpaid)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'selfmall_unpaid')" onblur="ssOnBlurNi(this,'selfmall_unpaid')"></td></tr>
        <tr class="ss-tr"><th>정산현황 합계</th>
          <td><div class="ss-cmp ss-pos" id="ss_f_settle_tot">${ssFmt(n('current_cash') + n('settlement_scheduled') + n('unsettled') + n('coupang_unpaid') + n('selfmall_unpaid'))}</div></td></tr>
      </table>
    </div>

    <div class="ss-slbl" id="ss-sec-ad">📢 광고비 <span class="ss-badge ss-badge-plus">+ 자산</span></div>
    <div class="ss-card">
      <div class="ss-ch">📈 광고비 (수취 예정 자산) <a class="ss-ch-link" href="https://ads.naver.com/manage/" target="_blank">광고 확인하기 </a></div>
      <table class="ss-tbl">
        <tr><th>네이버 광고 <span class="ss-badge ss-badge-plus">+</span></th>
          <td><input class="ss-ni ss-pos" type="text" inputmode="numeric" value="${ssAddComma(r.ad_naver)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'ad_naver')" onblur="ssOnBlurNi(this,'ad_naver')"></td></tr>
        <tr><th>GFA 광고 <span class="ss-badge ss-badge-plus">+</span></th>
          <td><input class="ss-ni ss-pos" type="text" inputmode="numeric" value="${ssAddComma(r.ad_gfa)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'ad_gfa')" onblur="ssOnBlurNi(this,'ad_gfa')"></td></tr>
        <tr class="ss-hl"><th>광고비 합계</th>
          <td><div class="ss-cmp ss-pos" id="ss_f_ad_tot">${ssFmt(n('ad_naver') + n('ad_gfa'))}</div></td></tr>
      </table>
    </div>

    <div class="ss-slbl" id="ss-sec-card">💳 카드 비용 <span class="ss-badge ss-badge-minus">- 비용</span></div>
    <div class="ss-card">
      <div class="ss-ch">💳 카드 비용 (차감 금액)</div>
      <table class="ss-tbl">
        <tr><th>카드이용금액 <span class="ss-badge ss-badge-minus">－</span></th>
          <td><input class="ss-ni ss-neg" type="text" inputmode="numeric" value="${ssAddComma(r.card_fee)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'card_fee')" onblur="ssOnBlurNi(this,'card_fee')"></td></tr>
        <tr><th>법인카드 (제주) <span class="ss-badge ss-badge-minus">－</span></th>
          <td><input class="ss-ni ss-neg" type="text" inputmode="numeric" value="${ssAddComma(r.corp_card)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'corp_card')" onblur="ssOnBlurNi(this,'corp_card')"></td></tr>
        <tr class="ss-hl"><th>카드 비용 합계</th>
          <td><div class="ss-cmp ss-neg" id="ss_f_card_tot">${ssFmt(n('card_fee') + n('corp_card'))}</div></td></tr>
      </table>
    </div>

    <div class="ss-slbl" id="ss-sec-items">📦 정산항목</div>
    <div class="ss-card">
      <div class="ss-ch">🗂️ 정산항목 <a class="ss-ch-link" href="https://jeju-acom-company.onrender.com/" target="_blank">회사 관리 확인하기 </a></div>
      <table class="ss-tbl">
        <tr><th>대성 정산예정금액 <span class="ss-badge ss-badge-minus">－</span></th>
          <td><input class="ss-ni ss-neg" type="text" inputmode="numeric" value="${ssAddComma(r.daesong)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'daesong')" onblur="ssOnBlurNi(this,'daesong')"></td></tr>
        <tr><th>효돈 정산예정금액 <span class="ss-badge ss-badge-minus">－</span></th>
          <td><input class="ss-ni ss-neg" type="text" inputmode="numeric" value="${ssAddComma(r.hyodong)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'hyodong')" onblur="ssOnBlurNi(this,'hyodong')"></td></tr>
        <tr><th>애월 정산예정금액 <span class="ss-badge ss-badge-minus">－</span></th>
          <td><input class="ss-ni ss-neg" type="text" inputmode="numeric" value="${ssAddComma(r.aewol)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'aewol')" onblur="ssOnBlurNi(this,'aewol')"></td></tr>
        <tr><th>택배 정산예정금액 <span class="ss-badge ss-badge-minus">－</span></th>
          <td><input class="ss-ni ss-neg" type="text" inputmode="numeric" value="${ssAddComma(r.delivery)}" placeholder="0" onfocus="ssOnFocusNi(this)" oninput="ssOnInputNi(this,'delivery')" onblur="ssOnBlurNi(this,'delivery')"></td></tr>
      </table>
    </div>

    <div class="ss-card" style="margin-top:8px">
      <table class="ss-tbl">
        <tr class="ss-spacer-row"><td colspan="2"></td></tr>
        <tr class="ss-tr"><th>합 계</th>
          <td><div class="ss-cmp ${subtotal < 0 ? 'ss-neg' : subtotal > 0 ? 'ss-pos' : 'ss-zer'}" id="ss_f_sub">${ssFmt(subtotal)}</div></td></tr>
        <tr class="ss-spacer-row"><td colspan="2"></td></tr>
        <tr class="ss-deduct-row"><th>카드비용 차감</th>
          <td><div class="ss-cmp ss-neg" id="ss_f_deduct_card">-${ssFmt(n('card_fee') + n('corp_card'))}</div></td></tr>
        <tr class="ss-deduct-row"><th>정산항목 차감</th>
          <td><div class="ss-cmp ss-neg" id="ss_f_deduct_items">-${ssFmt(n('daesong') + n('hyodong') + n('aewol') + n('delivery'))}</div></td></tr>
        <tr class="ss-spacer-row"><td colspan="2"></td></tr>
        <tr class="ss-total-final"><th>총 합계</th>
          <td><div class="ss-cmp ss-total-yellow" id="ss_f_tot">${ssFmt(total)}</div></td></tr>
      </table>
    </div>

    <div style="text-align:center;margin:16px 0;display:flex;justify-content:center;gap:12px;">
      <button class="ss-btn ss-by" style="padding:12px 40px;font-size:15px;font-weight:700;" onclick="ssSaveNow()">💾 저장</button>
      <button class="ss-btn ss-br" style="padding:12px 40px;font-size:15px;font-weight:700;" onclick="ssDeleteDate('${ssCur}')">🗑️ 삭제</button>
    </div>

    <div class="ss-slbl">📝 비고</div>
    <div class="ss-card">
      <textarea class="ss-memo" placeholder="비고 (예: 대성사오 21일 86만, 23일 95만 등)"
        oninput="ssInp('memo',this.value)">${r.memo || ''}</textarea>
    </div>

  `;
}

// 유틸 함수들
function ssToNum(v) { return parseFloat(String(v).replace(/,/g, '')) || 0; }
function ssAddComma(v) { const n = ssToNum(v); return n === 0 ? '' : n.toLocaleString('ko-KR'); }
function ssFmt(v) { const n = parseFloat(v) || 0; if (n === 0) return '-'; return n.toLocaleString('ko-KR'); }

function ssOnFocusNi(el) { const v = el.value; el.value = ''; el.value = v; }
function ssOnInputNi(el, field) {
    const pos = el.selectionStart;
    const raw = ssToNum(el.value);
    if (raw === 0) { el.value = ''; return; }
    const formatted = raw.toLocaleString('ko-KR');
    const oldLen = el.value.length;
    el.value = formatted;
    const newLen = formatted.length;
    const newPos = pos + (newLen - oldLen);
    try { el.setSelectionRange(newPos, newPos); } catch (e) { }
    ssInp(field, raw);
}
function ssOnBlurNi(el, field) {
    const raw = ssToNum(el.value);
    el.value = ssAddComma(raw);
    ssInp(field, raw);
}

let _ssSaveTimer;
function ssInp(field, val) {
    const entry = ssAll.find(e => e.date === ssCur);
    entry.record[field] = field === 'memo' ? val : (ssToNum(val) || 0);
    const r = entry.record;
    const n = k => ssToNum(r[k]);
    const adTot = n('ad_naver') + n('ad_gfa');
    const cardTot = n('card_fee') + n('corp_card');
    const { subtotal, total } = ssCompute(r);

    ssSetC('ss_f_ad_tot', adTot, 'ss-pos');
    ssSetC('ss_f_card_tot', cardTot, 'ss-neg');
    ssSetC('ss_f_sub', subtotal, subtotal > 0 ? 'ss-pos' : subtotal < 0 ? 'ss-neg' : 'ss-zer');
    ssSetC('ss_f_tot', total, 'ss-total-yellow');

    const settleTot = n('current_cash') + n('settlement_scheduled') + n('unsettled') + n('coupang_unpaid') + n('selfmall_unpaid');
    const ss = document.getElementById('ss_sc_settle');
    const sa = document.getElementById('ss_sc_ad');
    const scd = document.getElementById('ss_sc_card');
    const st = document.getElementById('ss_sc_tot');
    if (ss) ss.textContent = ssFmt(settleTot);
    if (sa) { sa.textContent = '+' + ssFmt(adTot); sa.className = 'ss-sc-val g'; }
    if (scd) scd.textContent = '-' + ssFmt(cardTot);
    if (st) { st.textContent = ssFmt(total); st.className = 'ss-sc-val-total ' + (total < 0 ? 'r' : ''); }
    ssSetC('ss_f_settle_tot', settleTot, 'ss-pos');
    const deductCard = n('card_fee') + n('corp_card');
    const deductItems = n('daesong') + n('hyodong') + n('aewol') + n('delivery');
    const dc = document.getElementById('ss_f_deduct_card');
    const di = document.getElementById('ss_f_deduct_items');
    if (dc) dc.textContent = '-' + ssFmt(deductCard);
    if (di) di.textContent = '-' + ssFmt(deductItems);
    const itemsTot = -n('daesong') - n('hyodong') - n('aewol') - n('delivery');
    const si = document.getElementById('ss_sc_items');
    if (si) { si.textContent = ssFmt(itemsTot); si.className = 'ss-sc-val ' + (itemsTot >= 0 ? 'g' : 'r'); }

    clearTimeout(_ssSaveTimer);
    _ssSaveTimer = setTimeout(ssPersist, 600);
}

function ssSetC(id, val, cls) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ssFmt(val); el.className = 'ss-cmp ' + cls; }
}

async function ssPersist() {
    const entry = ssAll.find(e => e.date === ssCur);
    if (!entry) return;
    try {
        await api('/api/settlement-status', 'POST', {
            date: entry.date,
            ...entry.record
        });
    } catch (err) {
        console.error('ssPersist error:', err);
    }
}

// 저장 버튼 클릭
async function ssSaveNow() {
    const entry = ssAll.find(e => e.date === ssCur);
    if (!entry) return;
    try {
        await api('/api/settlement-status', 'POST', {
            date: entry.date,
            ...entry.record
        });
        if (entry._temp) delete entry._temp;
        ssShowToast('✅ 저장 완료');
    } catch (err) {
        ssShowToast('저장 실패: ' + err.message);
    }
}

// 날짜 추가
let _ssCpRec = null;
function ssOpenAddModal() { _ssCpRec = null; document.getElementById('ss-moAdd').classList.add('open'); }
function ssCloseModal(id) { document.getElementById(id).classList.remove('open'); }
async function ssConfirmAdd() {
    const d = document.getElementById('ss-newDate').value;
    if (!d) { ssShowToast('날짜를 선택하세요'); return; }
    if (ssAll.find(e => e.date === d)) { ssShowToast('이미 존재하는 날짜입니다'); return; }
    const rec = _ssCpRec ? JSON.parse(JSON.stringify(_ssCpRec)) : ssBlank();
    try {
        await api('/api/settlement-status', 'POST', { date: d, ...rec });
        ssAll.push({ date: d, record: rec });
        ssAll.sort((a, b) => b.date.localeCompare(a.date));
        ssCur = d;
        ssCloseModal('ss-moAdd');
        ssRenderCalendar();
        ssRenderMain();
        ssShowToast(_ssCpRec ? '📋 복사 완료' : '📅 날짜 추가됨');
        _ssCpRec = null;
    } catch (err) {
        ssShowToast('저장 실패: ' + err.message);
    }
}
function ssCopyDate() {
    const entry = ssAll.find(e => e.date === ssCur);
    _ssCpRec = JSON.parse(JSON.stringify(entry.record));
    const t = new Date();
    document.getElementById('ss-newDate').value =
        `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    document.getElementById('ss-moAdd').classList.add('open');
}

// 삭제
async function ssConfirmDel() {
    try {
        await api(`/api/settlement-status/${ssCur}`, 'DELETE');
        ssAll = ssAll.filter(e => e.date !== ssCur);
        ssCur = ssAll.length ? ssAll[0].date : null;
        ssCloseModal('ss-moDel');
        ssRenderCalendar();
        ssRenderMain();
        ssShowToast('🗑️ 삭제됨');
    } catch (err) {
        ssShowToast('삭제 실패: ' + err.message);
    }
}

// 날짜 탭 X 버튼으로 삭제
async function ssDeleteDate(date) {
    if (!confirm(`${date} 정산 데이터를 삭제할까요?`)) return;
    const entry = ssAll.find(e => e.date === date);
    try {
        if (!entry._temp) {
            await api(`/api/settlement-status/${date}`, 'DELETE');
        }
        ssAll = ssAll.filter(e => e.date !== date);
        if (ssCur === date) ssCur = ssAll.length ? ssAll[0].date : null;
        ssRenderCalendar();
        ssRenderMain();
        ssShowToast('🗑️ 삭제됨');
    } catch (err) {
        ssShowToast('삭제 실패: ' + err.message);
    }
}

// CSV 내보내기
function ssExportCSV() {
    const rows = [['날짜', '정산예정', '미정산', '현재현금', '네이버광고(+)', 'GFA광고(+)', '카드이용금액(-)', '법인카드(-)',
        '효돈정산예정(-)', '대성정산예정(-)', '애월정산예정(-)', '택배정산예정(-)', '쿠팡미입금(+)', '자사몰미입금(+)', '합계', '총합계', '비고']];
    ssAll.forEach(({ date, record: r }) => {
        const n = k => parseFloat(r[k] || 0);
        const { subtotal, total } = ssCompute(r);
        rows.push([date,
            n('settlement_scheduled'), n('unsettled'), n('current_cash'),
            n('ad_naver'), n('ad_gfa'), n('card_fee'), n('corp_card'),
            n('hyodong'), n('daesong'), n('aewol'), n('delivery'),
            n('coupang_unpaid'), n('selfmall_unpaid'),
            subtotal, total, r.memo || ''
        ]);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `제주아꼼이네_정산_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    ssShowToast('📤 CSV 파일 다운로드 완료');
}

// 캡처
async function ssCaptureScreen() {
    const btn = document.getElementById('ss-captureBtn');
    const origText = btn.innerHTML;
    btn.innerHTML = '⏳ 캡처 중...';
    btn.disabled = true;
    try {
        const target = document.getElementById('ss-wrap');
        const canvas = await html2canvas(target, {
            backgroundColor: '#EEF2F9',
            scale: 2,
            useCORS: true,
            scrollY: -window.scrollY,
            windowWidth: document.documentElement.scrollWidth,
            onclone: (doc) => {
                const wrap = doc.getElementById('ss-wrap');
                const header = doc.createElement('div');
                header.style.cssText = 'background:#1B3A6B;color:#fff;padding:14px 24px;font-family:sans-serif;font-size:15px;font-weight:700;';
                header.textContent = '🍊 제주아꼼이네 정산 내역  |  ' + (ssCur || '');
                wrap.prepend(header);
                const abar = wrap.querySelector('.ss-abar');
                if (abar) abar.style.display = 'none';
            }
        });
        canvas.toBlob(async (blob) => {
            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                ssShowToast('✅ 캡처 완료! 붙여넣기(Ctrl+V) 하세요');
            } catch (e) {
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = '아꼼이네_정산_' + (ssCur || '날짜없음') + '.png';
                a.click();
                ssShowToast('📥 PNG 이미지로 저장됐어요');
            }
            btn.innerHTML = origText;
            btn.disabled = false;
        }, 'image/png');
    } catch (err) {
        ssShowToast('캡처 실패: ' + err.message);
        btn.innerHTML = origText;
        btn.disabled = false;
    }
}

// 토스트
let _ssTt;
function ssShowToast(msg) {
    const t = document.getElementById('ss-toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(_ssTt);
    _ssTt = setTimeout(() => t.classList.remove('on'), 2400);
}

// 모달 바깥 클릭 닫기
document.querySelectorAll('.ss-mo').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

// =============================================
// 순위관리 (네이버 쇼핑/광고/파워링크 추이)
// =============================================

let _rankParsed = null;       // 미리보기 직전 파싱 결과: { date, rows }
let _rankChart = null;        // Chart.js 인스턴스
let _rankData = [];           // 화면에 표시할 기간 내 데이터 캐시

function _rankFmtToday() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}

async function renderRankingsPage() {
    // 기본값 — 날짜 입력 오늘, 기간 시작=오늘-1개월, 종료=오늘
    const inp = document.getElementById('rank-input-date');
    if (inp && !inp.value) inp.value = _rankFmtToday();

    const startEl = document.getElementById('rank-range-start');
    const endEl = document.getElementById('rank-range-end');
    if (endEl && !endEl.value) endEl.value = _rankFmtToday();
    if (startEl && !startEl.value) {
        const t = new Date();
        t.setMonth(t.getMonth() - 1);
        startEl.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    }

    await loadRankings();
}

// 카톡 텍스트 파싱
// "(26.06.02. 10:16 기준)" → 날짜 추출
// "키워드(N위) 광고N위 파워링크N위" → 행 추출
function _parseRankText(text) {
    const lines = (text || '').split(/\r?\n/);
    const rows = [];
    let extractedDate = null;

    const dateRe = /\((\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*\d{1,2}:\d{2}\s*기준\)/;
    const rowRe = /^(.+?)\((\d+)위\)\s*광고\s*(\d+)위\s*파워링크\s*(\d+)위/;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        // 날짜 추출
        const dm = line.match(dateRe);
        if (dm && !extractedDate) {
            let y = parseInt(dm[1], 10);
            if (y < 100) y += 2000;
            const mo = String(parseInt(dm[2], 10)).padStart(2, '0');
            const d = String(parseInt(dm[3], 10)).padStart(2, '0');
            extractedDate = `${y}-${mo}-${d}`;
            continue;
        }

        // 키워드 행 추출
        const rm = line.match(rowRe);
        if (rm) {
            rows.push({
                keyword: rm[1].trim(),
                shoppingRank: parseInt(rm[2], 10),
                adRank: parseInt(rm[3], 10),
                powerlinkRank: parseInt(rm[4], 10)
            });
        }
    }
    return { date: extractedDate, rows };
}

document.getElementById('rank-parse-btn')?.addEventListener('click', () => {
    const text = document.getElementById('rank-input-text').value;
    const parsed = _parseRankText(text);
    if (parsed.rows.length === 0) {
        alert('파싱 가능한 키워드 행을 찾지 못했어요.\n예: 귤(16위) 광고2위 파워링크1위');
        return;
    }
    if (parsed.date) document.getElementById('rank-input-date').value = parsed.date;
    _rankParsed = parsed;

    // 미리보기 표 생성
    const wrap = document.getElementById('rank-preview-table');
    const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const rowsHtml = parsed.rows.map((r, i) => `<tr>
        <td>${escape(r.keyword)}</td>
        <td style="text-align:center;font-weight:600;">${r.shoppingRank}위</td>
        <td style="text-align:center;color:#6b7280;">${r.adRank}위</td>
        <td style="text-align:center;color:#6b7280;">${r.powerlinkRank}위</td>
    </tr>`).join('');
    wrap.innerHTML = `<table class="data-table" style="font-size:13px;">
        <thead><tr><th>키워드</th><th>쇼핑</th><th>광고</th><th>파워링크</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
    </table>`;
    document.getElementById('rank-preview-wrap').style.display = '';
});

document.getElementById('rank-clear-btn')?.addEventListener('click', () => {
    document.getElementById('rank-input-text').value = '';
    document.getElementById('rank-preview-wrap').style.display = 'none';
    _rankParsed = null;
});

document.getElementById('rank-save-btn')?.addEventListener('click', async () => {
    if (!_rankParsed || _rankParsed.rows.length === 0) { alert('먼저 정리 버튼을 눌러주세요.'); return; }
    const date = document.getElementById('rank-input-date').value;
    if (!date) { alert('날짜를 입력해주세요.'); return; }
    const btn = document.getElementById('rank-save-btn');
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
        const r = await api('/api/rankings/bulk', 'POST', { date, rows: _rankParsed.rows });
        alert(`저장 완료\n신규: ${r.inserted}건 / 덮어쓰기: ${r.updated}건`);
        document.getElementById('rank-input-text').value = '';
        document.getElementById('rank-preview-wrap').style.display = 'none';
        _rankParsed = null;
        await loadRankings();
    } catch (err) {
        alert('저장 실패: ' + err.message);
    } finally {
        btn.disabled = false; btn.textContent = '💾 저장';
    }
});

// 기간 단축 버튼
document.querySelectorAll('#rank-range-quick .btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#rank-range-quick .btn-toggle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const months = parseInt(btn.dataset.months, 10);
        const end = new Date();
        const start = new Date();
        start.setMonth(start.getMonth() - months);
        document.getElementById('rank-range-start').value = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
        document.getElementById('rank-range-end').value = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
        loadRankings();
    });
});

document.getElementById('rank-range-apply')?.addEventListener('click', () => {
    document.querySelectorAll('#rank-range-quick .btn-toggle').forEach(b => b.classList.remove('active'));
    loadRankings();
});

document.getElementById('rank-keyword-select')?.addEventListener('change', () => drawRankChart());

async function loadRankings() {
    const startDate = document.getElementById('rank-range-start').value;
    const endDate = document.getElementById('rank-range-end').value;
    try {
        const qs = new URLSearchParams();
        if (startDate) qs.set('startDate', startDate);
        if (endDate) qs.set('endDate', endDate);
        _rankData = await api(`/api/rankings?${qs.toString()}`);
        // 키워드 드롭다운 갱신
        const sel = document.getElementById('rank-keyword-select');
        const prev = sel.value;
        const keywords = [...new Set(_rankData.map(r => r.keyword))].sort((a,b) => a.localeCompare(b, 'ko'));
        sel.innerHTML = keywords.length === 0
            ? '<option value="">(없음)</option>'
            : keywords.map(k => `<option value="${k}">${k}</option>`).join('');
        if (prev && keywords.includes(prev)) sel.value = prev;
        renderRankTable();
        drawRankChart();
    } catch (err) {
        console.error('rankings load error:', err);
    }
}

function renderRankTable() {
    const tbody = document.getElementById('rank-table-body');
    if (!tbody) return;
    if (_rankData.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">기록이 없습니다.</td></tr>';
        return;
    }
    // 키워드별 시간순 정렬 (증감 계산용)
    const byKw = {};
    _rankData.slice().sort((a,b) => a.date < b.date ? -1 : 1).forEach(r => {
        if (!byKw[r.keyword]) byKw[r.keyword] = [];
        byKw[r.keyword].push(r);
    });
    // 화면에 보여줄 순서는 최신순
    const sorted = _rankData.slice().sort((a,b) => a.date < b.date ? 1 : -1);
    const diffHtml = (cur, prev) => {
        if (cur == null || prev == null) return '';
        if (cur === prev) return ' <span style="color:#9ca3af;font-size:11px;">−</span>';
        if (cur < prev) return ` <span style="color:#0066CC;font-size:11px;font-weight:700;">▲${prev - cur}</span>`;
        return ` <span style="color:#dc2626;font-size:11px;font-weight:700;">▼${cur - prev}</span>`;
    };
    tbody.innerHTML = sorted.map(r => {
        const list = byKw[r.keyword] || [];
        const idx = list.findIndex(x => x.id === r.id);
        const prev = idx > 0 ? list[idx - 1] : null;
        return `<tr>
            <td>${r.date}</td>
            <td><strong>${r.keyword}</strong></td>
            <td style="text-align:center;font-weight:700;">${r.shoppingRank ?? '-'}위${prev ? diffHtml(r.shoppingRank, prev.shoppingRank) : ''}</td>
            <td style="text-align:center;color:#6b7280;">${r.adRank ?? '-'}위${prev ? diffHtml(r.adRank, prev.adRank) : ''}</td>
            <td style="text-align:center;color:#6b7280;">${r.powerlinkRank ?? '-'}위${prev ? diffHtml(r.powerlinkRank, prev.powerlinkRank) : ''}</td>
            <td><button class="btn-danger" style="padding:3px 10px;font-size:11px;" onclick="deleteRanking(${r.id})">삭제</button></td>
        </tr>`;
    }).join('');
}

window.deleteRanking = async function(id) {
    if (!confirm('이 기록을 삭제하시겠습니까?')) return;
    try {
        await api(`/api/rankings/${id}`, 'DELETE');
        await loadRankings();
    } catch (err) { alert('삭제 실패: ' + err.message); }
};

function drawRankChart() {
    const canvas = document.getElementById('rank-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const keyword = document.getElementById('rank-keyword-select').value;
    if (!keyword) {
        if (_rankChart) { _rankChart.destroy(); _rankChart = null; }
        return;
    }
    const points = _rankData.filter(r => r.keyword === keyword).slice().sort((a,b) => a.date < b.date ? -1 : 1);
    const labels = points.map(p => p.date);
    const dsShopping = points.map(p => p.shoppingRank);
    const dsAd = points.map(p => p.adRank);
    const dsPl = points.map(p => p.powerlinkRank);

    if (_rankChart) _rankChart.destroy();
    _rankChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: '쇼핑 순위', data: dsShopping, borderColor: '#0066CC', backgroundColor: 'rgba(0,102,204,0.1)', tension: 0.25, fill: false, spanGaps: true, pointRadius: 4, pointHoverRadius: 6 },
                { label: '광고 순위', data: dsAd,       borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', tension: 0.25, fill: false, spanGaps: true, pointRadius: 4, pointHoverRadius: 6 },
                { label: '파워링크',  data: dsPl,       borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.25, fill: false, spanGaps: true, pointRadius: 4, pointHoverRadius: 6 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: `${keyword} — 순위 추이` },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}위` } }
            },
            scales: {
                y: {
                    reverse: true,           // 1위가 맨 위 (Y축 반전)
                    beginAtZero: false,
                    ticks: { stepSize: 1, callback: v => `${v}위` },
                    title: { display: true, text: '순위 (작을수록 상위)' }
                },
                x: { title: { display: true, text: '날짜' } }
            }
        }
    });
}



// =============================================
// 🎮 AGENT OFFICE (대표 전용) — 픽셀 사무실 + 실행/로그
// =============================================
let aoAgents = [];
let aoBiz = '전체';
let aoActiveRun = null;      // { runId, agentId, stepCount }
let aoRunPollTimer = null;
let aoLogPollTimer = null;
let aoEventsBound = false;

const AO_TEAMS = [
    { name: '마케팅팀', emoji: '📣' },
    { name: '재무팀', emoji: '💰' },
    { name: '법무팀', emoji: '⚖️' },
    { name: '개발부서', emoji: '💡' },
];
const AO_COLORS = {
    maru: '#F5C800', hangyeol: '#E8590C', miso: '#D6336C', geulsaem: '#7048E8', yeri: '#1098AD',
    hansu: '#2F9E44', semi: '#74B816', jiyul: '#1B3A6B', mirae: '#F76707', gian: '#0CA678',
};
const AO_ROLE_LABEL = { chief: '기획팀 실장', manager: '팀장', worker: '요원' };
const AO_STATUS_LABEL = { idle: '대기', running: '실행중', done: '완료', error: '오류' };

function aoPageActive() {
    return document.getElementById('page-agent-office')?.classList.contains('active');
}

async function renderAgentOffice() {
    aoBindEventsOnce();
    await aoRefreshAgents();
    await aoRefreshGrowth();
    await aoRefreshLog();
    aoStartLogPolling();
}

function aoBindEventsOnce() {
    if (aoEventsBound) return;
    aoEventsBound = true;
    // 사업장 필터
    document.getElementById('ao-biz-filter').addEventListener('click', (e) => {
        const btn = e.target.closest('.ao-biz-btn');
        if (!btn) return;
        document.querySelectorAll('.ao-biz-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        aoBiz = btn.dataset.biz;
        aoRenderOffice();
    });
    // 사무실/보고서함 탭
    document.querySelectorAll('.ao-view-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.ao-view-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const isOffice = tab.dataset.view === 'office';
            document.getElementById('ao-office-view').style.display = isOffice ? '' : 'none';
            document.getElementById('ao-reports-view').style.display = isOffice ? 'none' : '';
            if (!isOffice) {
                // 보고서함 열람 = 읽음 처리 → 보고함 뱃지 리셋 (9차)
                localStorage.setItem('ao_inbox_seen', String(Date.now()));
                aoSetInboxBadge(0);
                aoLoadReports();
            }
        });
    });
    document.getElementById('ao-report-search').addEventListener('click', aoLoadReports);
    const archToggle = document.getElementById('ao-report-archived');
    if (archToggle) archToggle.addEventListener('change', aoLoadReports);
    // LIVE 로그 항목 클릭 → 보고서 모달 (8차 — 모바일 동일)
    document.getElementById('ao-live-log').addEventListener('click', (e) => {
        const item = e.target.closest('[data-run-id]');
        if (item) aoOpenReport(Number(item.dataset.runId));
    });
    // v5.0 UI: [전체 보기] 토글 — 확인 완료 건 포함 표시 (기본 꺼짐 = 정리된 화면)
    const showAllToggle = document.getElementById('ao-log-showall');
    if (showAllToggle) showAllToggle.addEventListener('change', aoRefreshLog);
    // 대표 7/22: [🧹 로그 비우기] — 완료·오류 실행을 한 번에 확인 처리 (soft-delete, 전체 보기서 복구 가능)
    const clearBtn = document.getElementById('ao-log-clear');
    if (clearBtn) clearBtn.addEventListener('click', aoClearLog);
    // 상시 지시 입력바 (1.5차)
    const orderInput = document.getElementById('ao-order-input');
    document.getElementById('ao-order-send').addEventListener('click', aoSendOrder);
    aoSetupOrderImage(); // 정산관리 이미지 첨부 (대표 7/20)
    orderInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); aoSendOrder(); }
    });
}

// ---- 상시 지시 입력바 (3차: 마루 AI가 즉시 분석·배정) ----
let aoOrderPollTimer = null;
let aoWeekLessons = 0;

// 정산관리 확인표 캐시 + 모달 (대표 7/20 — 거래처 드롭다운 수정, 다중 이미지 큐, 모바일·PC 반응형)
const aoSettleCache = {};
const AO_SETTLE_PARTNERS = ['효돈농협', '대성(시온)', '기타거래처'];
let aoSettleModalData = null; // 현재 열린 확인표
const aoSettleQueue = []; // 다중 이미지 — 확인표 순차 표시
window.aoOpenSettleCache = id => { if (aoSettleCache[id]) aoShowSettlementConfirm(aoSettleCache[id]); };

// 선택 거래처의 표+합계 HTML (candidates 있으면 그걸, 없으면 구버전 r 직접)
function aoSettleBodyHtml(r, partner) {
    const c = (r.candidates && r.candidates[partner]) ? r.candidates[partner] : r;
    // 대표 7/20: 미매칭 품목은 소계 클릭 시 pricing 상품 선택(수동 매칭). 매칭된 것도 소계 클릭으로 변경 가능
    const rows = (c.rows || []).map((x, i) => {
        const unmatched = x.price == null;
        const subCell = unmatched
            ? `<span class="ao-settle-pick" style="color:#e00;font-weight:700;cursor:pointer;text-decoration:underline;" onclick="aoSettlePickItem(${i})">🔗 매칭하기</span>`
            : `<span class="ao-settle-pick" style="cursor:pointer;" onclick="aoSettlePickItem(${i})">${x.subtotal.toLocaleString()}원 ✏️</span>`;
        return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${aoEsc(x.matched || x.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${x.qty}박스</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${x.price != null ? x.price.toLocaleString() + '원' : '<span style="color:#e00;">가격없음</span>'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;font-weight:600;">${subCell}</td>
    </tr>`; }).join('');
    const warn = (c.unmatched || []).length
        ? `<div style="margin:8px 0;padding:8px 10px;background:#fff3f3;border:1px solid #f5b5b5;border-radius:8px;color:#c00;font-size:13px;">⚠️ 이 거래처 가격표에 없는 품목 ${c.unmatched.length}건 (0원 처리) — 거래처가 맞는지 확인하거나 정산관리 화면에서 수정하세요.</div>`
        : '';
    const dupWarn = c.existing
        ? `<div style="margin:8px 0;padding:8px 10px;background:#fffbe6;border:1px solid #f0d060;border-radius:8px;color:#a67c00;font-size:13px;">🔁 <strong>${aoEsc(partner)} ${aoEsc(r.date||'')}</strong> 정산이 이미 있습니다 (${c.existing.amount.toLocaleString()}원). <strong>저장하면 덮어씁니다</strong>.</div>`
        : '';
    return `${dupWarn}${warn}
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:420px;">
            <thead><tr style="background:#f7f7f7;">
                <th style="padding:8px;text-align:left;">품목</th><th style="padding:8px;text-align:right;">수량</th>
                <th style="padding:8px;text-align:right;">단가</th><th style="padding:8px;text-align:right;">소계</th>
            </tr></thead><tbody>${rows}</tbody>
            <tfoot><tr style="border-top:2px solid #333;">
                <td colspan="3" style="padding:8px;text-align:right;font-weight:700;">합계</td>
                <td style="padding:8px;text-align:right;font-weight:700;font-size:15px;color:#0a6;">${(c.total||0).toLocaleString()}원</td>
            </tr></tfoot>
        </table></div>`;
}
function aoShowSettlementConfirm(r) {
    document.querySelectorAll('.ao-settle-overlay').forEach(e => e.remove());
    aoSettleModalData = r;
    const partner = r.partner;
    const hasCand = !!r.candidates;
    // 거래처 드롭다운 (자동 인식된 값 기본 선택, 대표가 수정 가능)
    const partnerSelect = hasCand
        ? `<select id="ao-settle-partner-sel" onchange="aoSettleChangePartner(this.value)" style="font-size:15px;font-weight:600;padding:6px 10px;border-radius:8px;border:1.5px solid #4F46E5;background:#EEF0FF;">
            ${AO_SETTLE_PARTNERS.map(p => `<option value="${aoEsc(p)}"${p===partner?' selected':''}>${aoEsc(p)}${r.candidates[p] && r.candidates[p].matched ? ` (품목 ${r.candidates[p].matched}개 일치)` : ' (일치 없음)'}</option>`).join('')}
        </select>${r.auto_detected ? ' <span style="font-size:12px;color:#4F46E5;">🔍 품목으로 자동 인식 — 다르면 바꿔주세요</span>' : ''}`
        : `<strong style="color:#333;font-size:16px;">${aoEsc(partner)}</strong>`;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ao-settle-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:560px;width:94vw;">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 8px;">📋 정산관리 입력 확인</h3>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">거래처: ${partnerSelect}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            날짜: <input type="date" id="ao-settle-date" value="${aoEsc(r.date||'')}" onchange="aoSettleChangeDate(this.value)" style="font-size:14px;padding:5px 8px;border-radius:8px;border:1.5px solid #4F46E5;background:#EEF0FF;">
            <span style="color:#888;font-size:12px;">틀리면 바꿔주세요</span> · <span style="color:#666;font-size:13px;">총 ${r.box_total}박스</span>
        </div>
        <div id="ao-settle-body">${aoSettleBodyHtml(r, partner)}</div>
        <div style="display:flex;gap:8px;margin-top:16px;">
            <button class="btn-primary" id="ao-settle-save" style="flex:1;padding:12px;font-size:15px;" onclick="aoSettleSaveOcr()">✅ 저장하기</button>
            <button class="btn-secondary" style="flex:1;padding:12px;font-size:15px;" onclick="aoSettleCloseModal()">취소</button>
        </div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) aoSettleCloseModal(); });
    document.body.appendChild(overlay);
    aoSettleUpdateSaveLabel(partner);
}
window.aoSettleChangePartner = function(partner) {
    if (!aoSettleModalData) return;
    aoSettleModalData.partner = partner;
    document.getElementById('ao-settle-body').innerHTML = aoSettleBodyHtml(aoSettleModalData, partner);
    aoSettleUpdateSaveLabel(partner);
};
// 수동 매칭 (대표 7/20): 소계 클릭 → 해당 거래처 pricing 품목 선택 → 행 갱신
window.aoSettlePickItem = function(rowIdx) {
    const r = aoSettleModalData;
    if (!r) return;
    const partner = r.partner;
    const c = (r.candidates && r.candidates[partner]) ? r.candidates[partner] : r;
    const catalog = c.catalog || [];
    const row = c.rows[rowIdx];
    if (!catalog.length) return alert('이 거래처의 품목별 금액이 없습니다 — 품목별 금액을 먼저 등록하세요.');
    document.querySelectorAll('.ao-pick-overlay').forEach(e => e.remove());
    const opts = catalog.map(p => `<button class="ao-manage-item" onclick="aoSettleApplyPick(${rowIdx}, ${JSON.stringify(p.name).replace(/"/g,'&quot;')}, ${p.price})">${aoEsc(p.name)} <small>(${p.price.toLocaleString()}원)</small></button>`).join('');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ao-pick-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:520px;width:94vw;">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 4px;">🔗 품목 매칭</h3>
        <div style="color:#666;font-size:13px;margin-bottom:6px;">읽은 품목: <strong>${aoEsc(row.name)}</strong> (${row.qty}박스)</div>
        <div style="color:#888;font-size:12px;margin-bottom:12px;">아래 품목별 금액 상품 중 맞는 것을 누르세요</div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow-y:auto;">${opts}</div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};
window.aoSettleApplyPick = function(rowIdx, name, price) {
    const r = aoSettleModalData;
    const partner = r.partner;
    const c = (r.candidates && r.candidates[partner]) ? r.candidates[partner] : r;
    const row = c.rows[rowIdx];
    row.matched = name;
    row.price = price;
    row.subtotal = price * (row.qty || 0);
    // 미매칭 목록에서 제거 + 합계 재계산
    c.unmatched = (c.unmatched || []).filter(n => n !== row.name);
    c.total = c.rows.reduce((s, x) => s + (x.subtotal || 0), 0);
    document.querySelectorAll('.ao-pick-overlay').forEach(e => e.remove());
    document.getElementById('ao-settle-body').innerHTML = aoSettleBodyHtml(r, partner);
    aoSettleUpdateSaveLabel(partner);
};
// 날짜 수정 (대표 7/20 — 잘못 인식된 날짜 교정, 실수 방지)
window.aoSettleChangeDate = function(date) {
    if (!aoSettleModalData || !date) return;
    aoSettleModalData.date = date; // 저장 시 이 날짜 사용 (같은 주 가격 동일 — 저장은 항상 덮어쓰기라 안전)
};
function aoSettleUpdateSaveLabel(partner) {
    const btn = document.getElementById('ao-settle-save');
    if (!btn) return;
    const c = (aoSettleModalData.candidates && aoSettleModalData.candidates[partner]) ? aoSettleModalData.candidates[partner] : aoSettleModalData;
    btn.textContent = c.existing ? '🔁 덮어쓰기 저장' : '✅ 저장하기';
}
window.aoSettleCloseModal = function() {
    document.querySelectorAll('.ao-settle-overlay').forEach(e => e.remove());
    aoSettleModalData = null;
    aoSettleShowNextInQueue(); // 다중 이미지 — 다음 확인표
};
// 확인표 저장 → 전용 API (선택 거래처 반영, 중복 덮어쓰기)
window.aoSettleSaveOcr = async function() {
    const r = aoSettleModalData;
    if (!r) return;
    const btn = document.getElementById('ao-settle-save');
    if (btn) btn.disabled = true;
    try {
        // candidates 있으면 전용 API, 없으면 구버전 "응" 경로. 수동 매칭한 rows도 함께 전송 (대표 7/20)
        if (r.candidates && r.order_id) {
            const c = r.candidates[r.partner] || {};
            const res = await api('/api/agent-office/settlement-ocr-save', 'POST', { order_id: r.order_id, partner: r.partner, date: r.date, rows: c.rows || [] });
            showToast('✅ ' + res.message);
        } else {
            const res = await api('/api/agent-office/orders', 'POST', { content: '응' });
            aoPollOrder(res.order.id);
        }
        aoRefreshLog();
        aoSettleCloseModal();
    } catch (err) { alert(err.message); if (btn) btn.disabled = false; }
};
function aoSettleShowNextInQueue() {
    if (aoSettleQueue.length) { const next = aoSettleQueue.shift(); setTimeout(() => aoShowSettlementConfirm(next), 300); }
}

// 정산관리 이미지 첨부 (대표 7/20 — 여러 장 가능, 각 장이 독립 거래처로 처리)
let aoOrderImages = []; // [{ data, mime, name }]
function aoSetupOrderImage() {
    const fileInput = document.getElementById('ao-order-image');
    const pickBtn = document.getElementById('ao-order-image-btn');
    const preview = document.getElementById('ao-order-image-preview');
    if (!fileInput || !pickBtn) return;
    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        if (!files.length) return;
        aoOrderImages = [];
        aoAddImageFiles(files);
    });
    // 대표 7/21: 입력란에 이미지 복사→붙여넣기(Ctrl+V) 첨부 지원
    const orderInput = document.getElementById('ao-order-input');
    if (orderInput) {
        orderInput.addEventListener('paste', (e) => {
            const items = (e.clipboardData && e.clipboardData.items) || [];
            const imgs = [];
            for (const it of items) { if (it.type && it.type.indexOf('image') === 0) { const f = it.getAsFile(); if (f) imgs.push(f); } }
            if (imgs.length) { e.preventDefault(); aoAddImageFiles(imgs); showToast(`📷 이미지 ${imgs.length}장 붙여넣기 — 전송하면 마루가 판독합니다`); }
        });
    }
}
// 파일 목록을 aoOrderImages에 추가 (파일 선택·붙여넣기 공용) — 대표 7/21
function aoAddImageFiles(files) {
    let pending = files.length;
    if (!pending) return;
    files.forEach((f, i) => {
        if (f.size > 10 * 1024 * 1024) { alert(`이미지가 너무 큽니다 (10MB 이내)`); if (--pending <= 0) aoRenderImagePreview(); return; }
        const reader = new FileReader();
        reader.onload = () => { aoOrderImages.push({ data: reader.result, mime: f.type || 'image/png', name: f.name || `붙여넣기_${Date.now()}_${i}.png` }); if (--pending <= 0) aoRenderImagePreview(); };
        reader.readAsDataURL(f);
    });
}
function aoRenderImagePreview() {
    const pv = document.getElementById('ao-order-image-preview');
    if (!pv) return;
    if (!aoOrderImages.length) { pv.style.display = 'none'; pv.innerHTML = ''; return; }
    pv.style.display = '';
    const names = aoOrderImages.map(x => aoEsc(x.name)).join(', ');
    pv.innerHTML = `📷 <strong>${aoOrderImages.length}장</strong> 첨부됨 (${names}) — 각 이미지의 품목으로 거래처를 자동 인식합니다. "정산관리 올려줘" 지시하거나 바로 전송 <button class="ao-fb-btn" id="ao-order-image-clear">✕ 제거</button>`;
    document.getElementById('ao-order-image-clear').addEventListener('click', aoClearOrderImage);
}
function aoClearOrderImage() {
    aoOrderImages = [];
    const fi = document.getElementById('ao-order-image'); if (fi) fi.value = '';
    const pv = document.getElementById('ao-order-image-preview'); if (pv) { pv.style.display = 'none'; pv.innerHTML = ''; }
}

async function aoSendOrder() {
    const input = document.getElementById('ao-order-input');
    const content = input.value.trim();
    if (!content && !aoOrderImages.length) return;
    const btn = document.getElementById('ao-order-send');
    btn.disabled = true;
    try {
        if (aoOrderImages.length) {
            // 이미지 여러 장 → 각각 독립 order (각자 판독·거래처 자동 인식·확인표). 지시문(날짜 등)은 공통 적용
            const imgs = aoOrderImages.slice();
            input.value = '';
            aoClearOrderImage();
            for (const img of imgs) {
                const res = await api('/api/agent-office/orders', 'POST', { content: content || '정산관리에 올려줘', image_data: img.data, image_mime: img.mime });
                aoAppendLiveLogHtml(aoOrderLogLine(res.order));
                aoPollOrder(res.order.id);
            }
            aoSayThinking('마루', '💭', `이미지 ${imgs.length}장 판독 중`);
        } else {
            const res = await api('/api/agent-office/orders', 'POST', { content });
            input.value = '';
            aoAppendLiveLogHtml(aoOrderLogLine(res.order));
            aoSay('대표', '📢 내 오더: ' + aoTrunc(content, 24), 0); // 대표 머리말 — 답변/작업 시작까지 유지 (7/20)
            aoSayThinking('마루', '💭', '생각 중');
            aoPollOrder(res.order.id);
        }
    } catch (err) {
        alert(err.message);
    } finally {
        btn.disabled = false;
        input.focus();
    }
}

// 마루 질문 답변 모달 (대표 7/20 — 마루 클릭 시): 질문 전문 + 네/아니오
window.aoOpenMaruQuestion = function() {
    if (!aoPendingMaruQ) return;
    const q = (aoPendingMaruQ.result && aoPendingMaruQ.result.question) || '확인이 필요합니다';
    // 대표 7/22: 선택지가 있으면 각 선택지를 버튼으로 (없으면 네/아니오). 자유 입력도 가능.
    const choices = (aoPendingMaruQ.result && Array.isArray(aoPendingMaruQ.result.choices)) ? aoPendingMaruQ.result.choices.filter(Boolean) : [];
    const btnsHtml = choices.length
        ? `<div style="font-size:12px;color:#e67700;margin:14px 0 6px;">선택지 — 눌러서 고르거나 입력창에 말로 답해도 됩니다</div>
           <div style="display:flex;flex-direction:column;gap:8px;">${choices.map((c, i) => `<button class="btn-primary" style="padding:12px;font-size:15px;text-align:left;" onclick="this.closest('.modal-overlay').remove(); aoAnswerChoice(decodeURIComponent('${encodeURIComponent(c)}'))">${i + 1}. ${aoEsc(c)}</button>`).join('')}</div>`
        : `<div style="display:flex;gap:8px;margin-top:16px;">
            <button class="btn-primary" style="flex:1;padding:12px;font-size:15px;" onclick="this.closest('.modal-overlay').remove(); aoQuickAnswer(true)">✅ 네, 진행</button>
            <button class="btn-outline" style="flex:1;padding:12px;font-size:15px;" onclick="this.closest('.modal-overlay').remove(); aoQuickAnswer(false)">✕ 아니오</button>
        </div>`;
    document.querySelectorAll('.ao-maruq-overlay').forEach(e => e.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ao-maruq-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:440px;">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 10px;">🤔 마루의 질문</h3>
        <div style="background:#EEF0FF;border:2px solid #4F46E5;border-radius:10px;padding:14px;font-size:14px;line-height:1.6;white-space:pre-wrap;">${aoEsc(q)}</div>
        ${btnsHtml}
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

// 마루 질문에 네/아니오 빠른 답변 (대표 7/20 — 로그 버튼·마루 클릭으로 진행)
const aoAnsweredQ = new Set(); // 답변한 질문 order id — 폴링 재표시 억제
window.aoQuickAnswer = async function(yes) {
    if (!aoPendingMaruQ) return; // 대표 7/21: 중복 클릭 방어 — 버튼이 즉시 안 사라져 두 번 눌려 '네'가 2번 전송되던 것 차단
    // 즉시 정리 (대표 7/20): 마루·대표 머리말, LIVE 네/아니오 버튼 동시 제거 + 재표시 억제
    aoAnsweredQ.add(aoPendingMaruQ.id);
    aoPendingMaruQ = null;
    aoClearSay('마루');
    aoClearSay('대표');
    document.querySelectorAll('.ao-maruq-btns').forEach(e => e.remove());
    try {
        const res = await api('/api/agent-office/orders', 'POST', { content: yes ? '네' : '아니오' });
        aoAppendLiveLogHtml(aoOrderLogLine(res.order));
        aoSayThinking('마루', '💭', '처리 중');
        aoPollOrder(res.order.id);
    } catch (err) { alert(err.message); }
};

// 대표 7/22: 선택지 버튼 답변 — 고른 선택지 텍스트를 그대로 답으로 전송 (자유 입력과 동일 경로)
window.aoAnswerChoice = async function(text) {
    if (!aoPendingMaruQ) return; // 중복 클릭 방어
    aoAnsweredQ.add(aoPendingMaruQ.id);
    aoPendingMaruQ = null;
    aoClearSay('마루');
    aoClearSay('대표');
    document.querySelectorAll('.ao-maruq-btns').forEach(e => e.remove());
    document.querySelectorAll('.ao-maruq-overlay').forEach(e => e.remove());
    try {
        const res = await api('/api/agent-office/orders', 'POST', { content: String(text || '').trim() });
        aoAppendLiveLogHtml(aoOrderLogLine(res.order));
        aoSayThinking('마루', '💭', '처리 중');
        aoPollOrder(res.order.id);
    } catch (err) { alert(err.message); }
};

// 마루 처리 결과 폴링 (질문/완료/안내/오류가 될 때까지)
// 대표 7/20: order마다 독립 타이머 — 다중 이미지처럼 여러 order를 동시에 폴링해도 서로 죽이지 않음
// (기존엔 aoOrderPollTimer 하나를 공유해 2번째 폴링이 1번째를 clearInterval로 꺼버려 대성 확인표가 안 떴음)
function aoPollOrder(orderId) {
    let tries = 0;
    const timer = setInterval(async () => {
        if (++tries > 40) { clearInterval(timer); return; }
        try {
            const data = await api('/api/agent-office/orders/' + orderId);
            const order = data.order;
            if (order.status === '대기' || order.status === '처리중') return;
            clearInterval(timer);
            aoHandleOrderResult(order);
        } catch (e) { console.error('지시 폴링 실패:', e); }
    }, 1500);
}

// 대표 7/22: 마루 직접 답변 모달 (개념·설명·이미지 뜻 등 — 읽기 좋게 표시)
window.aoShowMaruAnswer = function(text) {
    document.querySelectorAll('.ao-answer-overlay').forEach(e => e.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ao-answer-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:520px;">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 10px;">💬 마루</h3>
        <div style="white-space:pre-wrap;word-break:break-word;line-height:1.65;font-size:14px;max-height:70vh;overflow-y:auto;">${aoEsc(text || '')}</div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};
function aoHandleOrderResult(order) {
    const r = order.result || {};
    aoClearSay('마루'); // '분석 중...' 상시 말풍선 제거
    // 대표 7/20: 질문이 아니면(작업 시작·완료) 대표 머리말 제거. 질문이면 답변까지 유지
    if (order.status !== '질문') aoClearSay('대표');
    if (order.status === '질문' && r.type === 'settlement_ocr_confirm') {
        // 정산관리 확인표 → 모달 (다중 이미지면 이미 열린 모달 뒤로 큐잉)
        if (aoSettleModalData) aoSettleQueue.push(r);
        else aoShowSettlementConfirm(r);
        showToast('정산관리 확인표 — 거래처 확인 후 저장');
    } else if (order.status === '질문') {
        // 애매한 지시 → 마루가 되묻기 (추측 실행 금지 원칙)
        aoSay('마루', '🤔 ' + (r.question || '확인이 필요합니다'), 9000);
        showToast('마루의 확인 질문 — 입력바로 답해주세요');
    } else if (order.status === '완료' && r.type === 'answer') {
        // 대표 7/22: 마루 직접 답변 (개념·설명·이미지 뜻) — 읽기 좋게 모달
        aoClearSay('마루');
        aoShowMaruAnswer(r.text || '');
        showToast('💬 마루 답변');
    } else if (order.status === '완료' && r.type === 'settlement_saved_ocr') {
        aoSay('마루', `✅ ${r.partner} 정산관리 저장 완료 (${r.box_total}박스 · ${(r.total||0).toLocaleString()}원)`, 9000);
        showToast('✅ 정산관리 저장 완료');
    } else if (order.status === '완료' && r.type === 'schedule_list') {
        // 마루 직접 처리: 일정 조회 즉답
        const preview = (r.items || []).slice(0, 3).join(' / ');
        aoSay('마루', r.count > 0 ? `📅 일정 ${r.count}건 — ${preview}` : '📅 해당 기간 일정이 없습니다', 10000);
        showToast(r.count > 0 ? `일정 ${r.count}건 조회 완료 (보고서함에서 전체 확인)` : '해당 기간 일정 없음');
    } else if (order.status === '완료' && r.type === 'schedule_created') {
        aoSay('마루', `✅ 일정 ${r.count}건 등록 완료!`, 8000);
        showToast(`✅ 일정 ${r.count}건 등록 완료`);
    } else if (order.status === '완료' && r.type === 'schedule_cancelled') {
        aoSay('마루', 'ℹ️ 일정 등록을 취소했어요', 5000);
        showToast('일정 등록 취소');
    } else if (order.status === '완료' && r.type === 'settlement_saved') {
        aoSay('마루', `✅ 저장 완료 — 총 합계 ${Math.round(r.total || 0).toLocaleString()}원`, 9000);
        showToast('✅ 정산현황 저장 — 정산관리 화면에서 수정 가능');
    } else if (order.status === '완료' && r.type === 'settlement_cancelled') {
        aoSay('마루', 'ℹ️ 정산현황 저장을 취소했어요', 5000);
        showToast('정산현황 저장 취소');
    } else if (order.status === '완료') {
        aoSay('마루', `📋 ${r.team || ''} ${r.assignee || ''} 배정 → 실행!`, 5000);
        showToast(`마루: ${r.assignee}에게 배정 · 실행 시작`);
        // 실행 추적 시작 → 서류 이동 애니메이션 + 진행 로그 재생
        const agent = aoAgents.find(a => a.name === r.assignee);
        if (r.run_id && agent) {
            aoActiveRun = { runId: r.run_id, agentId: agent.id, stepCount: 0 };
            aoSetAgentStatus(agent.id, 'running');
            aoStartRunPolling();
        }
    } else if (order.status === '피드백') {
        // 마루가 피드백으로 분류 → 해당 요원에게 전달 + 교훈 추출
        aoSay('마루', `📚 ${r.target}에게 전달했어요 — 교훈으로 정리 중입니다`, 7000);
        if (r.target) aoSay(r.target, '피드백 감사합니다! 교훈으로 정리해서 다음 작업부터 반영할게요 📚', 6000);
        showToast(`마루: ${r.target}에게 피드백 전달 (${r.kind || '코멘트'})`);
    } else if (order.status === '안내') {
        aoSay('마루', 'ℹ️ ' + (r.notice || '안내'), 9000);
        showToast(`마루: ${r.assignee || ''} 배정 기록 (실전 연결 전)`);
    } else if (order.status === '오류') {
        // 정직한 오류 표시 (허위 응답 금지)
        aoSay('마루', '⚠️ 처리 오류 — 로그 확인', 7000);
        showToast('마루 처리 오류: ' + (r.error || '알 수 없는 오류'));
    }
    aoRefreshLog();
}

// 쌓인 지시 재처리 (마루 상세 패널)
window.aoProcessOrder = async function(orderId) {
    try {
        await api('/api/agent-office/orders/' + orderId + '/process', 'POST');
        showToast('마루가 분석을 시작했습니다');
        const overlay = document.getElementById('ao-detail-overlay');
        if (overlay) overlay.remove();
        aoSayThinking('마루', '💭', '생각 중');
        aoPollOrder(orderId);
    } catch (err) { alert(err.message); }
};

// 마루 패널: 처리 대기/오류 지시 목록
async function aoLoadMaruOrders() {
    const box = document.getElementById('ao-maru-orders');
    if (!box) return;
    try {
        const data = await api('/api/agent-office/orders?limit=30');
        const pending = data.orders.filter(o => o.status === '대기' || o.status === '오류');
        if (!pending.length) { box.innerHTML = '📭 처리 대기 중인 지시가 없습니다'; return;
        }
        box.innerHTML = '<div style="font-weight:600;color:#1B3A6B;margin-bottom:4px;">📥 쌓인 지시 ' + pending.length + '건 — 마루에게 처리시킬 수 있어요</div>' +
            pending.map(o => `<div class="ao-maru-order-item">
                <span class="ao-ord-badge ao-ord-${o.status === '오류' ? 'err' : 'wait'}">[${o.status}]</span>
                <span class="ao-maru-order-text">${aoEsc(o.content)}</span>
                <button class="ao-fb-btn ao-maru-order-btn" onclick="aoProcessOrder(${o.id})">▶ 처리</button>
            </div>`).join('');
    } catch (e) { box.textContent = '지시 목록 조회 실패: ' + e.message; }
}

async function aoRefreshAgents() {
    const data = await api('/api/agent-office/agents');
    aoAgents = data.agents;
    aoRenderOffice();
    // 보고서함 에이전트 필터 옵션 (1회 채움)
    const sel = document.getElementById('ao-report-agent');
    if (sel && sel.options.length <= 1) {
        aoAgents.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.name + ' (' + a.team + ')';
            sel.appendChild(opt);
        });
    }
}

async function aoRefreshGrowth() {
    try {
        const [g, m] = await Promise.all([
            api('/api/agent-office/growth'),
            api('/api/agent-office/misroute-stats').catch(() => null), // 구버전 서버 호환
        ]);
        aoWeekLessons = g.lessons.this_week; // 지식 노트 모달 상단 표시용
        // 화면 정리 (대표 7/21): 실패 수집함을 ⚙️ 관리 안으로 이동 (바깥 칩은 관리 1개). 실패가 쌓이면 관리 칩에 건수 배지 표시
        aoManageStats = { lessons: g.lessons.total, misroute: m ? m.misroute_feedback : null, fails: (g.feedback && g.feedback.fails) || 0 };
        const failBadge = aoManageStats.fails > 0 ? ` <strong style="color:#e03131;">🧰${aoManageStats.fails}</strong>` : '';
        document.getElementById('ao-growth-widget').innerHTML =
            '<span class="ao-growth-chip ao-chip-click" onclick="aoOpenManageMenu()">⚙️ 관리' + failBadge + '</span>';
    } catch (e) { console.error('growth 조회 실패:', e); }
}
let aoManageStats = {};
// ⚙️ 관리 메뉴 — 가끔 쓰는 관리 기능 모음 (대표 7/20 화면 정리)
window.aoOpenManageMenu = function() {
    document.querySelectorAll('.ao-manage-overlay').forEach(e => e.remove());
    const misLine = aoManageStats.misroute != null
        ? `<button class="ao-manage-item" onclick="this.closest('.modal-overlay').remove();aoOpenMisrouteModal()">🚧 마루 오배정 <small>(주간 ${aoManageStats.misroute}건)</small></button>` : '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ao-manage-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:360px;">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 12px;">⚙️ 관리</h3>
        <div style="display:flex;flex-direction:column;gap:8px;">
            <button class="ao-manage-item" onclick="this.closest('.modal-overlay').remove();aoOpenFeedbackModal()">🧰 실패 수집함 <small>(${aoManageStats.fails || 0}건)</small></button>
            <button class="ao-manage-item" onclick="this.closest('.modal-overlay').remove();aoOpenLessonsModal(false)">📚 지식 노트 <small>(${aoManageStats.lessons || 0}건)</small></button>
            ${misLine}
            <button class="ao-manage-item" onclick="this.closest('.modal-overlay').remove();aoOpenArchiveModal()">🗂 통합본 아카이브</button>
            <button class="ao-manage-item" onclick="this.closest('.modal-overlay').remove();aoTelegramTest()">🔔 텔레그램 알림 테스트</button>
        </div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

// 지시 #47: 표시 시각 KST 통일 — 서버 기록(UTC)은 유지, 표시 레이어에서만 변환.
// tz 표기 없는 문자열(naive UTC)은 Z를 붙여 UTC로 해석 (브라우저 TZ 오해석 방지)
function aoKst(ts, opts) {
    if (!ts) return '';
    let s = ts;
    if (typeof s === 'string' && !/Z$|[+-]\d{2}:?\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
    return new Date(s).toLocaleString('ko-KR', Object.assign({ timeZone: 'Asia/Seoul' },
        opts || { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
}

// 지시 #36: 통합본 아카이브 — 목록 모달 + 다운로드 (대표 전용)
window.aoOpenArchiveModal = async function() {
    let data;
    try { data = await api('/api/agent-office/archive'); }
    catch (e) { return alert(e.message); }
    const files = data.files || [];
    const body = files.length
        ? '<div class="ao-run-history">' + files.map(f => {
            const dt = aoKst(f.mtime);
            const kb = Math.round((f.size || 0) / 1024 * 10) / 10;
            return '<div class="ao-run-item">📄 ' + aoEsc(f.name) + ' <small style="color:#888;">(' + kb + 'KB · ' + dt + ')</small> '
                + '<button class="ao-fb-btn" onclick="aoDownloadArchive(\'' + encodeURIComponent(f.name) + '\')">다운로드</button></div>';
        }).join('') + '</div>'
        : '<div class="ao-empty-note">아카이브가 비어 있습니다</div>';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal ao-detail-modal">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 8px;">📚 통합본 아카이브 <small style="color:#888;">(${files.length}건 · 영구 보관 — 언제든 재다운로드)</small></h3>
        ${body}
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};
window.aoDownloadArchive = async function(encName) {
    try {
        const token = localStorage.getItem('jwt_token');
        const res = await fetch('/api/agent-office/archive/' + encName + '/download', {
            headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || '다운로드 실패 (' + res.status + ')'); }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = decodeURIComponent(encName);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { alert(e.message); }
};

// 지시 #33: 이미지 미리보기 — 인증 fetch → blob URL (캐시), 썸네일 로드 + 탭하면 크게 보기
const _aoMediaUrlCache = {};
async function aoMediaBlobUrl(fileId) {
    if (_aoMediaUrlCache[fileId]) return _aoMediaUrlCache[fileId];
    const token = localStorage.getItem('jwt_token');
    const res = await fetch('/api/agent-office/files/' + fileId + '/download', {
        headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!res.ok) throw new Error('이미지 로드 실패 (' + res.status + ')');
    _aoMediaUrlCache[fileId] = URL.createObjectURL(await res.blob());
    return _aoMediaUrlCache[fileId];
}
window.aoLoadThumb = async function(fileId) {
    const img = document.getElementById('ao-thumb-' + fileId);
    if (!img || img.src) return;
    try { img.src = await aoMediaBlobUrl(fileId); } catch (e) { img.alt = '미리보기 실패'; }
};
window.aoPreviewImage = async function(fileId) {
    try {
        const url = await aoMediaBlobUrl(fileId);
        let ov = document.getElementById('ao-media-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'ao-media-overlay';
            ov.className = 'ao-media-overlay';
            ov.onclick = () => { ov.style.display = 'none'; };
            ov.innerHTML = '<img id="ao-media-overlay-img" alt="생성 이미지 크게 보기">';
            document.body.appendChild(ov);
        }
        document.getElementById('ao-media-overlay-img').src = url;
        ov.style.display = 'flex';
    } catch (e) { alert(e.message); }
};

// 지시 #26·#27: 미소 생성 승인 — 건별 비용 확인 후 서버 호출 (승인 없이 생성 불가)
window.aoGenerateMedia = async function(runId, outputIndex, grade, media, costLabel) {
    if (!confirm(`${media} ${grade} 생성을 승인할까요?\n예상 비용: ${costLabel} (승인 시에만 과금)`)) return;
    try {
        const r = await api(`/api/agent-office/runs/${runId}/generate`, 'POST', { output_index: outputIndex, grade });
        showToast('✅ ' + r.message);
        aoOpenReport(runId); // 생성 중 상태 + 진행바로 즉시 재렌더 (모달이 자동으로 폴링 시작 → 완료 시 이미지 자동 표시)
    } catch (e) { alert('생성 요청 실패: ' + e.message); }
};

// 대표 7/21: 미소 생성 진행률 + 완료 자동 표시 — 생성 중이면 진행바를 0→85% 크리핑,
//   완료(서버가 media_generating 해제)되면 모달을 자동 재렌더해 이미지/영상을 그 자리에 바로 표시 (나갔다 다시 클릭 불필요).
window._aoMediaTimers = window._aoMediaTimers || {};
window.aoPollMediaGen = function(runId, outputIndex, media) {
    if (window._aoMediaTimers[runId]) return; // 이미 폴링 중이면 중복 시작 안 함 (진행바 연속성 유지)
    const expected = media === '영상' ? 180000 : 14000; // 예상 소요(ms) — 진행바 속도 기준(실제 완료는 서버 폴링으로 확정)
    const maxMs = media === '영상' ? 7 * 60 * 1000 : 90 * 1000; // 안전 타임아웃
    const t0 = Date.now();
    let lastFetch = 0, done = false;
    const timer = setInterval(async () => {
        const elapsed = Date.now() - t0;
        const fill = document.getElementById('ao-mgfill-' + outputIndex);
        const pct = document.getElementById('ao-mgpct-' + outputIndex);
        if (fill && !done) { // 진행바 크리핑 (완료 전엔 85% 상한)
            const p = Math.min(85, Math.round((elapsed / expected) * 85));
            fill.style.width = p + '%';
            if (pct) pct.textContent = p + '%';
        }
        if (Date.now() - lastFetch >= 2000) { // 서버 폴링 2초마다
            lastFetch = Date.now();
            try {
                const run = (await api('/api/agent-office/runs/' + runId)).run;
                const rep = (run.result && run.result.report) || {};
                const stillGen = rep.media_generating && rep.media_generating.output_index === outputIndex;
                if (!stillGen) { // 완료(성공/실패) — 서버가 플래그 해제함
                    done = true;
                    clearInterval(timer); delete window._aoMediaTimers[runId];
                    if (fill) { fill.style.width = '100%'; if (pct) pct.textContent = '100%'; }
                    setTimeout(() => {
                        // 이 생성 보고 모달이 아직 열려 있으면(진행바 존재) 완료 상태로 재렌더 → 이미지/영상 그 자리에 표시
                        if (document.getElementById('ao-mgfill-' + outputIndex)) aoOpenReport(runId);
                        showToast(rep.media_error ? '⚠️ 생성 실패 — 보고서 확인' : '✅ 생성 완료!');
                    }, 400);
                }
            } catch (e) { /* 폴링 실패는 다음 회차 재시도 */ }
        }
        if (elapsed > maxMs) { clearInterval(timer); delete window._aoMediaTimers[runId]; } // 안전 중단
    }, 700);
    window._aoMediaTimers[runId] = timer;
};

// 지시 #11: 텔레그램 테스트 알림 (대표 폰 수신 확인용)
window.aoTelegramTest = async function() {
    try {
        const res = await api('/api/agent-office/telegram-test', 'POST');
        const d = res.diag || {};
        showToast('🔔 ' + res.message);
        if (!d.token_set) alert('⚠️ TELEGRAM_BOT_TOKEN이 서버에 설정되어 있지 않습니다 (Render 환경변수 확인)');
        else if (!d.chat_resolved) alert('⚠️ 수신처(chat_id)를 아직 확보하지 못했습니다 — 봇에게 아무 메시지나 1개 보낸 뒤 다시 눌러주세요' + (d.getupdates && d.getupdates.error ? '\n(오류: ' + d.getupdates.error + ')' : ''));
    } catch (e) { alert(e.message); }
};

// 4단계: 보고서 파일 다운로드 — 인증 토큰 포함 fetch → blob 저장 (adminOnly API)
window.aoDownloadFile = async function(fileId) {
    try {
        const token = localStorage.getItem('jwt_token');
        // 지시 #33·#34: ?download=1 — 이미지도 저장 동작 유지 (미리보기는 aoPreviewImage 담당)
        const res = await fetch('/api/agent-office/files/' + fileId + '/download?download=1', {
            headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '다운로드 실패 (' + res.status + ')');
        }
        const disposition = res.headers.get('Content-Disposition') || '';
        const m = disposition.match(/filename\*=UTF-8''(.+)$/);
        const filename = m ? decodeURIComponent(m[1]) : ('보고서_' + fileId + '.xlsx');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast('📎 ' + filename + ' 다운로드');
    } catch (e) { alert(e.message); }
};

// 오류 지시 확인 종결 (대표 실사용 지적 — LIVE 오류 잔존 정리, soft-close)
window.aoAckOrderError = async function(orderId) {
    try {
        const res = await api('/api/agent-office/orders/' + orderId + '/ack-error', 'POST');
        showToast('✔ ' + res.message);
        aoRefreshLog();
    } catch (e) { alert(e.message); }
};

// 지시 #4-1: 미응답 질문 수동 종결 (soft-close — 전체 보기에서 계속 조회 가능)
window.aoCloseQuestion = async function(orderId) {
    try {
        const res = await api('/api/agent-office/orders/' + orderId + '/close', 'POST');
        showToast('✔ ' + res.message);
        aoRefreshLog();
    } catch (e) { alert(e.message); }
};

// ---- v5.0 1단계: 오배정 카운트 모달 (감이 아닌 숫자로) ----
window.aoOpenMisrouteModal = async function() {
    let m;
    try { m = await api('/api/agent-office/misroute-stats?days=7'); }
    catch (e) { return alert(e.message); }
    const row = (label, val, desc) =>
        `<div class="ao-lesson-row"><strong>${label}: ${val}건</strong><span class="ao-lesson-meta">${desc}</span></div>`;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal ao-detail-modal">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 8px;">🚧 마루 오배정 카운트 <small style="color:#888;">(최근 ${m.days}일 · 지시 ${m.orders_total}건)</small></h3>
        ${row('오배정 지적', m.misroute_feedback, '마루에게 준 👎/✏️ 피드백 수')}
        ${row('응답 오염 감지', m.pollution_retries, '응답에 태그 파편이 섞여 정화기가 걸러낸 호출 수 (평시 재호출 없이 정화만)')}
        ${row('복창 후 정정', m.confirm_cancels, '확인 질문에 "아니"로 취소한 횟수')}
        <div class="ao-empty-note">이 숫자는 모델 승급/복귀 판단 근거로 사용됩니다 (v5.0 2단계)</div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

// ---- v5.0 1단계: 역량 테스트 성적표 모달 (테스트 실행분은 보고서함에 없고 여기서만 조회) ----
window.aoOpenTestResultsModal = async function() {
    let data;
    try { data = await api('/api/agent-office/runs?only_test=true&limit=20'); }
    catch (e) { return alert(e.message); }
    const runs = data.runs || [];
    const body = runs.length
        ? '<div class="ao-run-history">' + runs.map(r => {
            const dt = aoKst(r.started_at);
            const stIcon = r.status === 'done' ? '✅' : r.status === 'error' ? '❗' : '⏳';
            return '<div class="ao-run-item ao-chip-click" onclick="aoOpenReport(' + r.id + ')">' + stIcon + ' ' + dt + ' · '
                + aoEsc((r.result && r.result.summary) || '진행 중') + '</div>';
        }).join('') + '</div>'
        : '<div class="ao-empty-note">아직 역량 테스트 기록이 없습니다 — 마루 상세에서 🧪 역량 점검을 실행해보세요</div>';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal ao-detail-modal">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 8px;">🧪 역량 테스트 성적표 <small style="color:#888;">(${runs.length}건 · 보고서함과 분리 보관)</small></h3>
        ${body}
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

// ---- 픽셀 사무실 렌더 (1.5차: 조직도형 레이아웃 + 연결선) ----
function aoRenderOffice() {
    const office = document.getElementById('ao-office');
    if (!office) return;
    const chief = aoAgents.find(a => a.role === 'chief');
    const visible = a => aoBiz === '전체' || a.workplace === aoBiz || a.workplace === '공통';
    office.innerHTML = `
        <div class="ao-inbox" id="ao-inbox" onclick="aoGoReports()" title="보고서함 열기">📥
            <span class="ao-inbox-badge" id="ao-inbox-badge" style="display:none;">0</span>
            <div class="ao-inbox-label">보고함</div>
        </div>
        <div class="ao-org">
            ${aoCeoHtml()}
            <div class="ao-vline"></div>
            <div class="ao-team-tag ao-team-tag-hq">🏢 기획팀</div>
            ${chief ? aoCharHtml(chief, visible(chief)) : ''}
            <div class="ao-vline"></div>
            <div class="ao-org-teams">
                ${AO_TEAMS.map(t => {
                    const mgr = aoAgents.find(a => a.team === t.name && a.role === 'manager');
                    const members = aoAgents.filter(a => a.team === t.name && a.role === 'worker');
                    return `
                    <div class="ao-org-branch">
                        <div class="ao-team-tag" data-team="${t.name}">${t.emoji} ${t.name}</div>
                        ${mgr ? aoCharHtml(mgr, visible(mgr)) : ''}
                        ${members.length ? `
                        <div class="ao-vline ao-vline-sm"></div>
                        <div class="ao-org-members">
                            ${members.map(m => `<div class="ao-org-member">${aoCharHtml(m, visible(m))}</div>`).join('')}
                        </div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        </div>
        <div class="ao-doc-fly" id="ao-doc-fly" style="display:none;">📋</div>`;
    aoRefreshOrgFlow(); // 재렌더 후 실행 중 요원의 배정 흐름 모션 복원
}

// 대표 노드 (실제 사람 — AI 배지 없음, 왕관 표시)
function aoCeoHtml() {
    return `
    <div class="ao-agent ao-ceo" id="ao-ceo-node">
        <div class="ao-bubbles"><span class="ao-crown">👑</span></div>
        <div class="ao-sprite">
            <div class="ao-hair" style="background:#2b2b2b;"></div>
            <div class="ao-face"><span class="ao-eye"></span><span class="ao-eye"></span></div>
            <div class="ao-body" style="background:#1B3A6B;"></div>
            <div class="ao-arms"><span class="ao-arm"></span><span class="ao-arm"></span></div>
            <div class="ao-desk"><span class="ao-monitor"></span></div>
        </div>
        <div class="ao-nametag">전승범</div>
        <div class="ao-roletag">대표</div>
    </div>`;
}

function aoCharHtml(a, vis) {
    const color = AO_COLORS[a.code] || '#1B3A6B';
    const dutyLabel = a.role === 'worker' && a.duty ? '·' + a.duty : '';
    return `
    <div class="ao-agent st-${a.status || 'idle'} ${vis ? '' : 'ao-dimmed'}" data-agent-id="${a.id}" onclick="openAoDetail(${a.id})">
        <div class="ao-bubbles">
            <span class="ao-bub ao-bub-run">💼</span>
            <span class="ao-bub ao-bub-done">✅</span>
            <span class="ao-bub ao-bub-err">❗</span>
        </div>
        <div class="ao-sprite">
            <div class="ao-hair" style="background:${color};"></div>
            <div class="ao-face"><span class="ao-eye"></span><span class="ao-eye"></span></div>
            <div class="ao-body" style="background:${color};"></div>
            <div class="ao-arms"><span class="ao-arm"></span><span class="ao-arm"></span></div>
            <div class="ao-desk"><span class="ao-monitor"></span></div>
        </div>
        <div class="ao-nametag"><span class="ao-ai-badge">🤖AI</span> ${a.name}</div>
        <div class="ao-roletag">${AO_ROLE_LABEL[a.role] || a.role}${dutyLabel}</div>
        <div class="ao-progress"><div class="ao-progress-fill"></div></div>
    </div>`;
}

function aoSetAgentStatus(agentId, status) {
    const agent = aoAgents.find(a => a.id === agentId);
    if (agent) agent.status = status;
    const el = document.querySelector(`.ao-agent[data-agent-id="${agentId}"]`);
    if (el) {
        el.classList.remove('st-idle', 'st-running', 'st-done', 'st-error');
        el.classList.add('st-' + status);
    }
    aoRefreshOrgFlow(); // 대표 7/22: 배정 흐름 모션 갱신
}

// 대표 7/22: 지시 → 담당 요원까지 조직도 연결선을 진한 보라색으로 흐르게 (작업 중에만).
//   현재 running인 요원들의 경로(상단 세로선 + 해당 팀 브랜치 + 요원 멤버선)에 .ao-flow 부여,
//   나머지는 제거 → 작업이 끝나면(running 해제) 모션 자동 소멸.
// 대표 7/22 v2: 마루→담당 요원까지 '하나의 연속 실선'을 좌표로 계산해 SVG로 그림.
//   가짜요소(::after) 조각 방식의 넘침·이음새 잘림 문제 해소. 스프라이트는 선 위에 그려져 깔끔.
//   경로: 마루 스프라이트 하단 → 가로 버스 Y → 담당 팀 X → 담당 요원 스프라이트 상단.
//   작업(running)이 끝나면 오버레이 제거로 모션 사라짐.
function aoRefreshOrgFlow() {
    const office = document.getElementById('ao-office');
    if (!office) return;
    const oldSvg = office.querySelector('.ao-flow-svg');
    if (oldSvg) oldSvg.remove();
    const running = Array.from(office.querySelectorAll('.ao-agent.st-running'));
    if (!running.length) return;
    const chief = aoAgents.find(a => a.role === 'chief');
    const maruEl = chief ? office.querySelector(`.ao-agent[data-agent-id="${chief.id}"]`) : null;
    if (!maruEl) return;
    const orect = office.getBoundingClientRect();
    const spr = el => el.querySelector('.ao-sprite') || el;
    const cx = el => { const r = spr(el).getBoundingClientRect(); return Math.round(r.left + r.width / 2 - orect.left); };
    const topY = el => Math.round(spr(el).getBoundingClientRect().top - orect.top);
    const botY = el => Math.round(spr(el).getBoundingClientRect().bottom - orect.top);
    const mX = cx(maruEl), mBot = botY(maruEl);
    // 가로 버스 Y = 마루 하단과 팀 상단의 중간 (팀 컨테이너 상단 근처)
    const teams = office.querySelector('.ao-org-teams');
    const busY = teams ? Math.round(teams.getBoundingClientRect().top - orect.top) : mBot + 22;
    let paths = '';
    running.forEach(el => {
        if (el === maruEl) return; // 마루 자신 실행이면 상단만 (경로 없음)
        const tX = cx(el), tTop = topY(el);
        // 마루 아래 → 버스Y → 담당팀 X로 가로 이동 → 담당 요원 위로 세로 (요원이 팀장 아래면 팀장 뒤로 지나감)
        const pts = `${mX},${mBot} ${mX},${busY} ${tX},${busY} ${tX},${tTop}`;
        paths += `<polyline class="ao-flow-base" points="${pts}"></polyline>`
              +  `<polyline class="ao-flow-pulse" points="${pts}"></polyline>`;
    });
    if (!paths) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ao-flow-svg');
    svg.innerHTML = paths;
    office.appendChild(svg);
}
// 창 크기 변경 시 흐름선 좌표 재계산 (한 번만 바인딩)
if (!window.__aoFlowResizeBound) {
    window.__aoFlowResizeBound = true;
    window.addEventListener('resize', () => { try { aoRefreshOrgFlow(); } catch (e) { /* 무시 */ } });
}

function aoAgentElByName(name) {
    if (name === '대표' || name === '전승범') return document.getElementById('ao-ceo-node'); // 대표 머리말 지원 (7/20)
    const agent = aoAgents.find(a => a.name === name);
    return agent ? document.querySelector(`.ao-agent[data-agent-id="${agent.id}"]`) : null;
}

// 말풍선 (ms=0이면 지울 때까지 상시 표시)
function aoSay(name, text, ms = 2500) {
    const el = aoAgentElByName(name);
    if (!el) return;
    el.querySelectorAll('.ao-say').forEach(s => s.remove());
    const say = document.createElement('div');
    say.className = 'ao-say' + (ms === 0 ? ' ao-say-persist' : '');
    say.textContent = text;
    el.appendChild(say);
    if (ms > 0) setTimeout(() => say.remove(), ms);
}

function aoClearSay(name) {
    const el = aoAgentElByName(name);
    if (el) el.querySelectorAll('.ao-say').forEach(s => s.remove());
}

// 생각 중 말풍선 (💭 + 점 3개 통통 애니메이션) — 지울 때까지 상시 표시 (v5.0 UI)
function aoSayThinking(name, icon, label) {
    const el = aoAgentElByName(name);
    if (!el) return;
    el.querySelectorAll('.ao-say').forEach(s => s.remove());
    const say = document.createElement('div');
    say.className = 'ao-say ao-say-persist ao-say-think';
    say.innerHTML = icon + ' ' + aoEsc(label) + ' <span class="ao-think-dots"><span>·</span><span>·</span><span>·</span></span>';
    el.appendChild(say);
}

// 실행 진행률 바 (작업 단계 n/total)
function aoSetProgress(agentId, done, total) {
    const el = document.querySelector(`.ao-agent[data-agent-id="${agentId}"] .ao-progress-fill`);
    if (!el) return;
    const pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
    el.style.width = pct + '%';
}

// 보고함 뱃지 (오늘 완료 보고 수)
function aoSetInboxBadge(count) {
    const badge = document.getElementById('ao-inbox-badge');
    if (!badge) return;
    if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = ''; }
    else badge.style.display = 'none';
}

// 서류/보고서 아이콘 이동 애니메이션 (1.5차: 조직도 연결선을 따라 직각 경로)
function aoFlyDoc(fromEl, toEl, icon = '📋') {
    const fly = document.getElementById('ao-doc-fly');
    const office = document.getElementById('ao-office');
    if (!fly || !office || !fromEl || !toEl) return;
    const oRect = office.getBoundingClientRect();
    const f = fromEl.getBoundingClientRect();
    const t = toEl.getBoundingClientRect();
    const fx = f.left - oRect.left + f.width / 2 - 11;
    const fy = f.top - oRect.top - 6;
    const tx = t.left - oRect.left + t.width / 2 - 11;
    const ty = t.top - oRect.top - 6;
    const midY = (fy + ty) / 2; // 두 계층 사이 연결선 높이
    fly.textContent = icon;
    fly.style.transition = 'none';
    fly.style.display = 'block';
    fly.style.left = fx + 'px';
    fly.style.top = fy + 'px';
    const seg = (x, y) => {
        fly.style.transition = 'left .3s ease-in-out, top .3s ease-in-out';
        fly.style.left = x + 'px';
        fly.style.top = y + 'px';
    };
    requestAnimationFrame(() => {
        seg(fx, midY);                        // │ 세로 (연결선 진입)
        setTimeout(() => seg(tx, midY), 320); // ─ 가로 (연결선 따라 이동)
        setTimeout(() => seg(tx, ty), 640);   // │ 세로 (도착)
    });
}

// ---- 실행 ----
window.aoRunAgent = async function(agentId) {
    try {
        // 현재 사업장 필터를 함께 전달 (세미: 법인 정산 조회 / 오션라운지는 데이터 없음 안내)
        const res = await api('/api/agent-office/agents/' + agentId + '/run', 'POST', { workplace: aoBiz });
        showToast(res.message);
        aoActiveRun = { runId: res.run.id, agentId, stepCount: 0 };
        aoSetAgentStatus(agentId, 'running');
        aoStartRunPolling();
        // 모달 진행 영역 초기화
        const prog = document.getElementById('ao-detail-progress');
        if (prog) { prog.style.display = ''; prog.querySelector('.ao-prog-list').innerHTML = ''; }
        const runBtn = document.getElementById('ao-detail-run-btn');
        if (runBtn) { runBtn.disabled = true; runBtn.textContent = '⏳ 실행 중...'; }
    } catch (err) {
        alert(err.message);
    }
};

function aoStartRunPolling() {
    clearInterval(aoRunPollTimer);
    aoRunPollTimer = setInterval(async () => {
        if (!aoActiveRun) { clearInterval(aoRunPollTimer); return; }
        try {
            const data = await api('/api/agent-office/runs/' + aoActiveRun.runId);
            const run = data.run;
            aoHandleRunUpdate(run);
            if (run.status !== 'running') {
                clearInterval(aoRunPollTimer);
                aoAppendLiveLogHtml(aoRunPreviewLine(run)); // 결과 미리보기 라인 (클릭 → 보고서)
                const finishedAgentId = aoActiveRun.agentId;
                aoActiveRun = null;
                // 마루(기획팀 실장) 시험 중/생각 중 말풍선 정리
                const finishedAgent = aoAgents.find(a => a.id === finishedAgentId);
                if (finishedAgent && finishedAgent.role === 'chief') aoClearSay(finishedAgent.name);
                aoSetAgentStatus(finishedAgentId, run.status === 'done' ? 'done' : 'error');
                // 대표 7/22: 완료·오류 모두 잠시 표시 후 대기(idle)로 복귀 — 오류 마크가 조직도에 계속 남던 것 해소
                setTimeout(() => aoSetAgentStatus(finishedAgentId, 'idle'), run.status === 'done' ? 3000 : 6000);
                aoSetProgress(finishedAgentId, 0, 3); // 진행률 초기화 (다음 실행 대비)
                aoRefreshGrowth();
                aoFinishDetailProgress(run);
            }
        } catch (e) { console.error('run 폴링 실패:', e); }
    }, 1000);
}

function aoHandleRunUpdate(run) {
    if (!aoActiveRun) return;
    const steps = run.steps || [];
    const fresh = steps.slice(aoActiveRun.stepCount);
    aoActiveRun.stepCount = steps.length;
    fresh.forEach(step => {
        aoAppendLiveLog(step);
        aoAppendDetailProgress(step);
        aoAnimateStep(step, run);
    });
}

// 지시 전달 흐름 애니메이션 (마스터 지시문 2절 ②~⑤)
function aoAnimateStep(step, run) {
    const workerName = run.agent_name;
    const worker = aoAgents.find(a => a.name === workerName);
    const mgr = worker ? aoAgents.find(a => a.team === worker.team && a.role === 'manager') : null;
    const managerEl = mgr ? aoAgentElByName(mgr.name) : null;
    const maruEl = aoAgentElByName('마루');
    const workerEl = aoAgentElByName(workerName);
    const inboxEl = document.getElementById('ao-inbox');

    switch (step.kind) {
        case 'order': {
            const ceoEl = document.getElementById('ao-ceo-node');
            if (ceoEl && maruEl) aoFlyDoc(ceoEl, maruEl, '📋');
            aoSay('마루', '📋 오더 접수');
            break;
        }
        case 'route':
            aoSay('마루', step.text);
            if (maruEl && (managerEl || workerEl)) aoFlyDoc(maruEl, managerEl || workerEl, '📋');
            break;
        case 'assign':
            aoSay(step.actor, '검토 중...');
            if (managerEl && workerEl) aoFlyDoc(managerEl, workerEl, '📋');
            break;
        case 'work':
            aoSay(workerName, step.text, 2600);
            if (aoActiveRun) {
                aoActiveRun.workCount = (aoActiveRun.workCount || 0) + 1;
                if (worker) aoSetProgress(worker.id, aoActiveRun.workCount, 3);
            }
            break;
        case 'report':
            aoSay(workerName, '✅ 완료 보고');
            if (worker) aoSetProgress(worker.id, 3, 3);
            if (workerEl) aoFlyDoc(workerEl, managerEl || maruEl || workerEl, '✅');
            break;
        case 'review':
            aoSay(step.actor, '검수 완료');
            if (managerEl && maruEl) aoFlyDoc(managerEl, maruEl, '✅');
            break;
        case 'done':
            aoSay('마루', '보고 등록');
            if (maruEl && inboxEl) aoFlyDoc(maruEl, inboxEl, '✅');
            setTimeout(() => {
                const fly = document.getElementById('ao-doc-fly');
                if (fly) fly.style.display = 'none';
                // 보고함 뱃지 +1 (도착 연출)
                const badge = document.getElementById('ao-inbox-badge');
                if (badge) {
                    const cur = badge.style.display === 'none' ? 0 : (parseInt(badge.textContent) || 0);
                    aoSetInboxBadge(cur + 1);
                    const inbox = document.getElementById('ao-inbox');
                    if (inbox) { inbox.classList.remove('ao-inbox-pop'); void inbox.offsetWidth; inbox.classList.add('ao-inbox-pop'); }
                }
            }, 1100);
            break;
    }
}

// ---- LIVE 로그 (9차: 보고서 있는 항목만 클릭 가능·📄 배지, 중간 진행 로그는 클릭 불가) ----
function aoStepLogLine(step) {
    const time = new Date(step.t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `<div class="ao-log-item"><span class="ao-log-time">${time}</span> <strong>${step.actor}</strong> → ${step.text}</div>`;
}

// 완료된 실행의 결과 미리보기 라인 (클릭 → 보고서)
function aoRunPreviewLine(r) {
    const t = r.finished_at || r.started_at;
    const time = new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const res = r.result || {};
    const first = Array.isArray(res.lines) && res.lines.length ? res.lines[0] : '';
    const icon = r.status === 'done' ? '✅' : '❗';
    const text = aoTrunc(`${res.summary || (r.status === 'done' ? '완료' : '오류')}${first ? ' — ' + first : ''}`);
    const archived = r.is_deleted ? ' ao-log-archived' : '';
    // v5.0 UI: 완료·미확인 건은 눈에 띄는 "완료 카드" — 카드에서 바로 [✔확인] 가능 (받은편지함 사양)
    // 대표 7/22: 오류(error) 실행도 ✔확인으로 로그에서 치울 수 있게 (전엔 완료만 확인 가능 → 오류 로그가 영영 안 지워짐)
    const isDoneCard = r.status === 'done' && !r.is_deleted;
    const canArchive = (r.status === 'done' || r.status === 'error') && !r.is_deleted;
    const confirmBtn = canArchive
        ? `<button class="ao-fb-btn ao-card-confirm" onclick="event.stopPropagation(); aoArchiveRun(${r.id})">✔ 확인</button>` : '';
    return `<div class="ao-log-item ao-log-click ao-log-preview${archived}${isDoneCard ? ' ao-log-donecard' : ''}" data-run-id="${r.id}">
        ${confirmBtn}<span class="ao-log-time">${time}</span> ${icon} <strong>${aoEsc(r.agent_name || '')}</strong> ${aoEsc(text)}
        ${r.is_deleted ? '<span class="ao-arch-badge">확인함</span> ' : ''}<span class="ao-log-open">📄 보기</span></div>`;
}

function aoAppendLiveLogHtml(html) {
    const log = document.getElementById('ao-live-log');
    if (!log) return;
    const empty = log.querySelector('.ao-log-empty');
    if (empty) empty.remove();
    log.insertAdjacentHTML('afterbegin', html);
    while (log.children.length > 60) log.lastChild.remove();
}

function aoAppendLiveLog(step) {
    aoAppendLiveLogHtml(aoStepLogLine(step));
}

function aoEsc(s) {
    return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function aoTrunc(s, n = 95) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '...' : s;
}

// 대표 7/22: LIVE 로그에 대표 지시를 '원문 그대로' 깔끔하게 — 서브태스크/멀티 래퍼 문구 제거
function aoCleanContent(s) {
    return String(s || '')
        .replace(/\s*\[상세\s*조건[\s\S]*$/, '')      // "[상세 조건은 원지시 참조: ...]" 및 그 뒤 전부
        .replace(/\s*\[멀티\s*\d+\s*\/\s*\d+[\s\S]*$/, '') // "[멀티 1/3 — 원지시 #N]"
        .trim();
}

// 접수 지시 로그 라인 (🕐 대표 → 마루: 내용 + 마루 처리 결과)
function aoOrderLogLine(o) {
    const time = aoKst(o.created_at, { hour: '2-digit', minute: '2-digit', hour12: false });
    const st = o.status || '대기';
    const stCls = st === '완료' ? 'done' : st === '오류' ? 'err' : st === '질문' ? 'ask'
        : (st === '안내' || st === '피드백' || st === '대체됨' || st === '질문종결' || st === '응답됨') ? 'info' : 'wait';
    const r = o.result || {};
    let extra = '';
    if (st === '피드백' && r.target) extra = `<div class="ao-log-sub">📚 마루 → ${aoEsc(r.target)} 피드백 전달 (${aoEsc(r.kind || '코멘트')})</div>`;
    else if (st === '완료' && r.type === 'schedule_list') extra = `<div class="ao-log-sub">📅 마루 → 대표: 일정 ${r.count}건${(r.items && r.items.length) ? ' — ' + r.items.slice(0, 3).map(aoEsc).join(' / ') + (r.count > 3 ? ' 외' : '') : ''}</div>`;
    else if (st === '완료' && r.type === 'schedule_created') extra = `<div class="ao-log-sub">✅ 마루 → 일정 ${r.count}건 등록: ${(r.items || []).slice(0, 3).map(aoEsc).join(' / ')}</div>`;
    else if (st === '완료' && r.type === 'schedule_cancelled') extra = `<div class="ao-log-sub">ℹ️ 일정 등록 취소</div>`;
    else if (st === '완료' && r.type === 'settlement_saved') extra = `<div class="ao-log-sub">💾 마루 → 정산현황 저장 (${aoEsc(r.date || '')}) · 총 합계 ${Math.round(r.total || 0).toLocaleString()}원 — ${(r.items || []).slice(0, 3).map(aoEsc).join(' / ')}</div>`;
    else if (st === '완료' && r.type === 'settlement_cancelled') extra = `<div class="ao-log-sub">ℹ️ 정산현황 저장 취소</div>`;
    else if (st === '완료' && r.type === 'multi_dispatch') extra = `<div class="ao-log-sub">🔀 마루 → 멀티 분산 ${(r.subtasks || []).length}건 동시 배정: ${(r.subtasks || []).map((s2, i2) => '①②③④⑤'[i2] + ' ' + aoEsc(aoTrunc(s2, 40))).join(' / ')}</div>`;
    else if (st === '완료' && r.type === 'answer') extra = `<div class="ao-log-sub">💬 마루: ${aoEsc(aoTrunc(r.text || '', 140))}</div>`;
    else if (st === '질문' && r.type === 'settlement_ocr_confirm') { aoSettleCache[o.id] = r; extra = `<div class="ao-log-sub">📋 <strong>${aoEsc(r.partner)}</strong> 정산관리 입력 확인 (${r.box_total}박스 · ${(r.total||0).toLocaleString()}원) <button class="ao-fb-btn" onclick="event.stopPropagation(); aoOpenSettleCache(${o.id})">확인표 열기</button></div>`; }
    else if (st === '완료' && r.type === 'settlement_saved_ocr') extra = `<div class="ao-log-sub">✅ 마루 → ${aoEsc(r.partner)} 정산관리 저장 완료 (${r.box_total}박스 · ${(r.total||0).toLocaleString()}원)</div>`;
    else if (st === '질문' && r.type === 'settlement_ocr_need_partner') extra = `<div class="ao-log-sub">📦 품목 읽음 — 거래처만 확인 필요: "효돈농협 / 대성(시온) / 기타거래처" 중 답해주세요</div>`;
    else if (r.question && (st === '질문' || st === '응답됨' || st === '대체됨' || st === '질문종결')) {
        // 마루 질문 — 튀는 테두리로 대표 질문과 구분 (대표 7/20). 미응답(질문)이면 네/아니오 버튼
        // 대표 7/21: 이미 답변한 질문(aoAnsweredQ)은 버튼 재표시 억제 — 답변 후 폴링에 버튼이 다시 그려져 "안 사라짐"·중복 클릭 유발하던 것
        // 대표 7/22: 선택지가 2개 이상이면 [1. …][2. …] 버튼으로, 아니면 네/아니오
        const choices = Array.isArray(r.choices) ? r.choices.filter(Boolean) : [];
        const btns = (st === '질문' && !aoAnsweredQ.has(o.id))
            ? (choices.length
                ? `<div class="ao-maruq-btns">${choices.map((c, i) => `<button class="ao-maruq-choice" onclick="event.stopPropagation(); aoAnswerChoice(decodeURIComponent('${encodeURIComponent(c)}'))">${i + 1}. ${aoEsc(c)}</button>`).join('')}</div>`
                : `<div class="ao-maruq-btns"><button class="ao-maruq-yes" onclick="event.stopPropagation(); aoQuickAnswer(true)">✅ 네</button><button class="ao-maruq-no" onclick="event.stopPropagation(); aoQuickAnswer(false)">✕ 아니오</button></div>`)
            : '';
        const choiceLabel = (st === '질문' && choices.length) ? ' <span style="color:#e67700;font-size:12px;">(선택지 — 눌러서 고르거나 말로 답해도 됩니다)</span>' : '';
        extra = `<div class="ao-log-sub ao-log-maruq">🤔 <strong>마루의 질문</strong>: ${aoEsc(r.question)}${choiceLabel}${btns}</div>`;
    }
    else if (st === '완료' && r.type === 'route' && r.assignee) {
        // 대표 7/22: 흐름 한눈에 — 마루 → 팀 → 요원 배정 (짧게)
        const cond = r.conditions ? [r.conditions.item_keyword, r.conditions.period].filter(Boolean).join(' · ') : '';
        extra = `<div class="ao-log-sub">🔧 마루 → ${aoEsc(r.team || '팀')} → <strong>${aoEsc(r.assignee)}</strong> 배정${cond ? ' [' + aoEsc(cond) + ']' : ''}</div>`;
    }
    else if (st === '안내' && r.notice) extra = `<div class="ao-log-sub">ℹ️ ${aoEsc(r.notice)}</div>`;
    else if (st === '오류' && r.error) extra = `<div class="ao-log-sub ao-log-suberr">⚠️ ${aoEsc(r.error)} <button class="ao-fb-btn" onclick="event.stopPropagation(); aoAckOrderError(${o.id})">✔ 확인</button></div>`;
    const runId = o.run_id || (r && r.run_id) || null;
    // 지시 #4·#6: 종결된 질문(대체됨/질문종결/응답됨)은 흐림+배지, 미응답 질문 카드엔 [✔확인] 종결 버튼
    const closed = st === '대체됨' || st === '질문종결' || st === '응답됨';
    const archivedCls = (o.run_archived || closed) ? ' ao-log-archived' : '';
    const closeBtn = (st === '질문' && !aoAnsweredQ.has(o.id))
        ? `<button class="ao-fb-btn ao-card-confirm" onclick="event.stopPropagation(); aoCloseQuestion(${o.id})">✔ 확인</button>` : '';
    // 대표 7/21: 마루/요원 답변이 이상하면 이 지시를 실패 수집함에 담기 (처리 끝난 건만 — 대기·처리중 제외)
    const failBtn = (st !== '대기' && st !== '처리중')
        ? `<button class="ao-fb-btn ao-fail-btn" title="이 답변을 실패 수집함에 담기" onclick="event.stopPropagation(); aoMarkOrderFail(${o.id}, this)">❌ 실패</button>` : '';
    const clickAttr = runId ? ` ao-log-click" data-run-id="${runId}` : '';
    return `<div class="ao-log-item ao-log-order${archivedCls}${clickAttr}">${closeBtn}${failBtn}<span class="ao-log-time">${time}</span> 🕐 <strong>대표</strong> → 마루: ${aoEsc(aoCleanContent(o.content))} <span class="ao-ord-badge ao-ord-${stCls}">[${st}]</span>${o.run_archived ? ' <span class="ao-arch-badge">확인함</span>' : ''}${closed ? ' <span class="ao-arch-badge">' + (st === '대체됨' ? '새 지시로 대체' : st === '응답됨' ? '답변으로 이어짐' : '미응답 종결') + '</span>' : ''}${extra}</div>`;
}

async function aoRefreshLog() {
    try {
        // [전체 보기] 켜면 확인(✔) 완료 건까지 포함 — 숨김이지 삭제 아님 (soft-delete 표시 원칙)
        const showAll = !!document.getElementById('ao-log-showall')?.checked;
        const [data, orderData, remData] = await Promise.all([
            api('/api/agent-office/runs?limit=30' + (showAll ? '&include_archived=true' : '')),
            api('/api/agent-office/orders?limit=15' + (showAll ? '&include_hidden=true' : '')),
            api('/api/agent-office/today-reminders').catch(() => null), // 구버전 서버 호환
        ]);
        // 3단계: 발송·할인 일정 당일/전날 리마인드 배너 (표시만 — 실제 발송은 대표 수동)
        const remBox = document.getElementById('ao-reminders');
        if (remBox) {
            const rems = (remData && remData.reminders) || [];
            if (rems.length) {
                remBox.innerHTML = rems.map(r =>
                    `<div class="ao-reminder-item">📣 <strong>${aoEsc(r.when)} 예정</strong> ${aoEsc(r.line)}</div>`).join('');
                remBox.style.display = '';
            } else remBox.style.display = 'none';
        }
        // 보고함 뱃지: 마지막으로 보고서함을 연 이후 도착한 신규 보고만 카운트 (9차)
        const seenAt = Number(localStorage.getItem('ao_inbox_seen') || 0);
        aoSetInboxBadge(data.runs.filter(r =>
            r.status === 'done' && new Date(r.finished_at || r.started_at).getTime() > seenAt).length);
        const log = document.getElementById('ao-live-log');
        if (!log) return;
        const lines = [];
        data.runs.forEach(r => {
            // 대표 7/22: 스텝 도배 제거 — 진행중이면 최신 1줄만(작업중), 완료/오류면 미리보기(클릭→보고서)
            if (r.status === 'running') {
                const steps = r.steps || [];
                const last = steps[steps.length - 1];
                if (last) lines.push({ t: last.t, html: aoStepLogLine(last) });
            } else if (r.status === 'done' || r.status === 'error') {
                lines.push({ t: r.finished_at || r.started_at, html: aoRunPreviewLine(r) });
            }
        });
        // 대표 7/22: 완료 문서 클릭 시 '나의 질문 원본'을 함께 띄우기 위한 run_id→지시 매핑
        aoOrderByRun = {};
        orderData.orders.forEach(o => {
            if (o.run_id) aoOrderByRun[o.run_id] = o.content;
            lines.push({ t: o.created_at, html: aoOrderLogLine(o) });
        });
        lines.sort((a, b) => new Date(b.t) - new Date(a.t));
        log.innerHTML = lines.length
            ? lines.slice(0, 60).map(l => l.html).join('')
            : '<div class="ao-log-empty">아직 실행 로그가 없습니다</div>';
        // ③ 마루 머리 위 질문 말풍선 (대표 7/20): 미응답 질문이 있으면 마루가 "❓ 확인해주세요!" 표시
        //    답변한 질문(aoAnsweredQ)은 서버 반영 전이라도 재표시하지 않음 (즉시 사라짐 유지)
        aoPendingMaruQ = (orderData.orders || []).find(o => o.status === '질문' && o.result && o.result.question && !aoAnsweredQ.has(o.id)) || null;
        if (aoPendingMaruQ) aoSay('마루', '❓ 확인해주세요! (눌러서 답변)', 0);
        else if (!aoActiveRun) aoClearSay('마루'); // 실행 중이면 '생각 중' 유지
    } catch (e) { console.error('로그 조회 실패:', e); }
}
let aoPendingMaruQ = null;
let aoOrderByRun = {}; // run_id → 대표 지시 원문 (보고서 모달에서 원본 질문 표시용)

function aoStartLogPolling() {
    clearInterval(aoLogPollTimer);
    aoLogPollTimer = setInterval(() => {
        if (!aoPageActive()) { clearInterval(aoLogPollTimer); return; }
        if (aoActiveRun) return; // 실행 중엔 run 폴링이 로그를 채움
        aoRefreshLog();
        aoRefreshAgentsStatusOnly();
    }, 8000);
}

async function aoRefreshAgentsStatusOnly() {
    try {
        const data = await api('/api/agent-office/agents');
        data.agents.forEach(fresh => {
            const cur = aoAgents.find(a => a.id === fresh.id);
            if (cur && cur.status !== fresh.status) aoSetAgentStatus(fresh.id, fresh.status);
            if (cur) { cur.last_run = fresh.last_run; cur.last_run_at = fresh.last_run_at; }
        });
    } catch (e) { /* 무시 */ }
}

// ---- 에이전트 상세 패널 ----
// 대표 7/21: 직원별 특징을 같은 형식으로. 큐레이션 1줄 (요원 성격·강점)
const AO_TRAIT = {
    maru: '지시를 정확히 이해해 담당 요원에게 배정하는 AI 실장. 애매하면 추측하지 않고 되물으며, 확인 안 된 답변엔 대화를 이어 배정합니다.',
    semi: '정산현황·품목별 금액·매출을 0원 코드로 정확히 집계하는 회계 조회 담당. 없는 데이터는 지어내지 않습니다.',
    hansu: '세미의 집계를 다시 검산하고 마진을 따지는 재무팀장. 오차는 자동 보정 없이 있는 그대로 🧮로 보고합니다.',
    geulsaem: '문자·톡톡·상세페이지 카피를 쓰는 카피라이터. 대표 지시가 최우선 근거이며, "다시 써줘"에 새 안을 재생성합니다.',
    miso: '이미지·영상 시안과 프롬프트를 만들고 Gemini로 직접 생성하는 디자이너. 생성은 건별 대표 승인 후에만.',
    yeri: '인스타그램 전담 — 계정 아이디 추천·첫 영상 방향·릴스 대본·게시물 문구·해시태그를 만듭니다. 성과 분석은 대표가 준 데이터가 있을 때만 (수치는 지어내지 않음). 실제 이미지·영상 생성은 미소.',
    jiyul: '노무·법률을 노무지침만 근거로 자문하는 법무팀장. 법인(5인↑)/오션라운지(5인↓)를 구분하고, 지침 밖은 노무사 확인을 안내합니다.',
    gian: '대표 미팅 내용을 7항목 기획 보고서로 정리하는 기획자. 실물 산출물을 함께 냅니다.',
    mirae: '개발 백로그와 버전 변경사항을 관리하는 개발팀장.',
    hangyeol: '(보관) 마케팅 검수 팀장 — 현재 비활성입니다. 최종 검토는 대표가 직접 합니다.',
};
// 실제로 연결된(작동하는) 도구만 표기 — 없으면 도구 섹션 미표기 (대표 7/21)
const AO_LIVE_TOOLS = {
    miso: ['🎨 Gemini 이미지 생성', '🎬 Veo 영상 생성'],
};
window.openAoDetail = async function(agentId) {
    // ④ 마루 클릭 시 미응답 질문이 있으면 답변 모달 먼저 (대표 7/20)
    const clicked = aoAgents.find(a => a.id === agentId);
    if (clicked && clicked.role === 'chief' && aoPendingMaruQ) { aoOpenMaruQuestion(); return; }
    let data;
    try {
        data = await api('/api/agent-office/agents/' + agentId);
    } catch (err) { return alert(err.message); }
    const agent = data.agent, tools = data.tools, lessons = data.lessons, runs = data.runs;
    const feedbackList = data.feedback || [];
    const lessonProposals = lessons.filter(l => l.status === '제안');
    const activeLessons = lessons.filter(l => l.status === 'active');
    const color = AO_COLORS[agent.code] || '#1B3A6B';
    const lastDone = runs.find(r => r.status === 'done');
    const resultLines = (lastDone && lastDone.result && lastDone.result.lines) ||
        (lastDone && lastDone.result && lastDone.result.summary ? [lastDone.result.summary] : []);
    const isRunning = agent.status === 'running' || (aoActiveRun && aoActiveRun.agentId === agent.id);

    // 대표 7/21: 역량 점검·지금 실행·"팀장 실행 예정"·미팅 입력 제거 (불필요). 마루만 지시 안내 박스, 나머지는 배정 안내 1줄
    const actionHtml = agent.role === 'chief'
        ? `<div class="ao-placeholder-box">
                <div style="font-weight:600;font-size:13px;">💬 하단 입력바로 지시하면 마루가 즉시 분석·배정합니다 <span class="ao-soon-badge" style="background:#2F9E44;color:#fff;">🤖 AI 연결됨</span></div>
                <div id="ao-maru-orders" style="font-size:12px;color:#888;margin-top:4px;">대기 지시 확인 중...</div>
            </div>`
        : `<div class="ao-placeholder-box ao-soon-note">💬 대표가 지시하면 마루가 이 요원에게 배정합니다</div>`;

    const knowledge = agent.knowledge_files || [];
    const liveTools = AO_LIVE_TOOLS[agent.code] || [];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'ao-detail-overlay';
    overlay.innerHTML = `
        <div class="modal ao-detail-modal">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <div class="ao-detail-head">
                <div class="ao-detail-avatar" style="background:${color};">${agent.name.charAt(0)}</div>
                <div>
                    <h3 style="margin:0;"><span class="ao-ai-badge">🤖AI</span> ${agent.name} <small style="color:#888;">${AO_ROLE_LABEL[agent.role]}${agent.duty ? ' · ' + agent.duty : ''}</small></h3>
                    <div class="ao-detail-meta">${agent.team} · ${agent.workplace} · 상태: <strong class="ao-status-${agent.status}">${AO_STATUS_LABEL[agent.status] || agent.status}</strong>
                    ${agent.last_run_at ? ' · 마지막 실행 ' + aoKst(agent.last_run_at) : ''}</div>
                </div>
            </div>
            <h4 class="ao-sec-title">🧑‍💼 특징</h4>
            <div class="ao-result-box">${aoEsc(AO_TRAIT[agent.code] || agent.description || '')}</div>
            ${knowledge.length ? `<h4 class="ao-sec-title">📖 지식 문서</h4>
            <div class="ao-tool-list">${knowledge.map(k => '<span class="ao-knowledge-badge">' + aoEsc(k) + '</span>').join('')}</div>` : ''}
            ${liveTools.length ? `<h4 class="ao-sec-title">🛠 도구</h4>
            <div class="ao-tool-list">${liveTools.map(t => '<span class="ao-tool-badge">' + aoEsc(t) + '</span>').join('')}</div>` : ''}
            ${actionHtml}
            <div id="ao-detail-progress" style="display:${isRunning ? '' : 'none'};">
                <h4 class="ao-sec-title">⚙️ 진행상황</h4>
                <div class="ao-prog-list"></div>
            </div>
            <h4 class="ao-sec-title">📚 학습 노트 <small style="color:#aaa;">(활성 ${activeLessons.length} · 제안 ${lessonProposals.length})</small></h4>
            ${lessonProposals.length ? lessonProposals.map(l => `
                <div class="ao-lesson-prop">
                    <span class="ao-lesson-prop-text">🌱 [${aoEsc(l.category || '일반')}] ${aoEsc(l.lesson)}</span>
                    <span class="ao-lesson-btns">
                        <button class="ao-fb-btn ao-lesson-ok" onclick="aoApproveLesson(${l.id}, ${agent.id})">✔ 승인</button>
                        <button class="ao-fb-btn ao-lesson-no" onclick="aoDiscardLesson(${l.id}, ${agent.id})">✖ 폐기</button>
                    </span>
                </div>`).join('') : ''}
            ${activeLessons.length
                ? '<ul class="ao-lesson-list">' + activeLessons.map(l => '<li>[' + aoEsc(l.category || '일반') + '] ' + aoEsc(l.lesson) + '</li>').join('') + '</ul>'
                : (lessonProposals.length ? '' : '<div class="ao-empty-note">아직 학습 노트가 없습니다 — 실패 수집함을 함께 정리하면 교훈이 등록됩니다</div>')}
            <h4 class="ao-sec-title">🕘 최근 실행 이력</h4>
            ${runs.length
                ? '<div class="ao-run-history">' + runs.map(r => {
                    const dt = aoKst(r.started_at);
                    const dur = r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000) + '초' : '-';
                    const stIcon = r.status === 'done' ? '✅' : r.status === 'error' ? '❗' : '⏳';
                    return '<div class="ao-run-item">' + stIcon + ' ' + dt + ' · ' + aoEsc((r.result && r.result.summary) || '진행 중') + ' <span style="color:#aaa;">(' + dur + ')</span>' + (r.is_deleted ? ' <span class="ao-arch-badge">확인함</span>' : '') + '</div>';
                }).join('') + '</div>'
                : '<div class="ao-empty-note">아직 실행 이력이 없습니다</div>'}
        </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    if (agent.role === 'chief') aoLoadMaruOrders();
};

function aoAppendDetailProgress(step) {
    const prog = document.getElementById('ao-detail-progress');
    if (!prog) return;
    prog.style.display = '';
    const list = prog.querySelector('.ao-prog-list');
    const time = new Date(step.t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    list.insertAdjacentHTML('beforeend', `<div class="ao-prog-item ao-prog-${step.kind}"><span class="ao-log-time">${time}</span> ${step.actor} — ${step.text}</div>`);
    list.scrollTop = list.scrollHeight;
}

function aoFinishDetailProgress(run) {
    const runBtn = document.getElementById('ao-detail-run-btn');
    if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = '▶ 지금 실행';
    }
    const prog = document.getElementById('ao-detail-progress');
    if (prog && run.result && run.result.summary) {
        prog.querySelector('.ao-prog-list').insertAdjacentHTML('beforeend',
            '<div class="ao-prog-item ao-prog-final">🏁 ' + run.result.summary + '</div>');
    }
}

// 피드백 한 줄 렌더 (9.5차: 종류 라벨 + 대상 보고서 + 보기 링크)
const AO_FB_LABEL = { good: '👍 좋음', edited: '✏️ 수정', bad: '👎 다시', comment: '💬 코멘트', fail: '❌ 실패' };
function aoFbLine(f, withAgent) {
    const dt = aoKst(f.created_at);
    const label = AO_FB_LABEL[f.feedback_type] || '💬';
    const text = f.comment || f.corrected_output || '';
    const target = f.run_id
        ? ` <span class="ao-fb-target">— 대상: "${aoEsc(aoTrunc(f.run_summary || '실행 #' + f.run_id, 40))}"
            <button class="ao-fb-btn ao-fb-view" onclick="aoOpenReport(${f.run_id})">📄 보고서 보기</button></span>`
        : '';
    return `<div class="ao-fb-hist-item"><strong>${label}</strong>${withAgent ? ' <strong>' + aoEsc(f.agent_name) + '</strong>' : ''}
        <span class="ao-log-time">${dt}</span>${text ? ' ' + aoEsc(aoTrunc(text, 120)) : ''}${target}</div>`;
}

// ---- 9차: 성장 위젯 상세 모달 ----
// 지식 노트 / 이번 주 학습 모달 (요원별 그룹, 제안은 바로 승인/폐기)
window.aoOpenLessonsModal = async function(weekOnly) {
    let data;
    try { data = await api('/api/agent-office/lessons' + (weekOnly ? '?week=1' : '')); }
    catch (e) { return alert(e.message); }
    const lessons = data.lessons || [];
    const groups = {};
    lessons.forEach(l => { (groups[l.agent_name] = groups[l.agent_name] || []).push(l); });
    const fmtD = d => d ? new Date(d).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '-';
    const bodyHtml = lessons.length ? Object.entries(groups).map(([name, ls]) => `
        <h4 class="ao-sec-title">🤖 ${aoEsc(name)} <small style="color:#aaa;">(${ls.length}건)</small></h4>
        ${ls.map(l => {
            // 9.5차: 교훈 출처 (원본 피드백) 표시
            const srcText = l.src_type ? (l.src_comment || l.src_corrected || '') : '';
            const src = l.src_type
                ? `<div class="ao-lesson-src">출처: ${AO_FB_LABEL[l.src_type] || '💬'}${srcText ? ' "' + aoEsc(aoTrunc(srcText, 60)) + '"' : ''}${l.src_run_id ? ` <button class="ao-fb-btn ao-fb-view" onclick="aoOpenReport(${l.src_run_id})">📄 보고서</button>` : ''}</div>`
                : '';
            return l.status === '제안' ? `
            <div class="ao-lesson-prop">
                <span class="ao-lesson-prop-text">🌱 [${aoEsc(l.category || '일반')}] ${aoEsc(l.lesson)}${src}</span>
                <span class="ao-lesson-btns">
                    <button class="ao-fb-btn ao-lesson-ok" onclick="aoModalLessonAct(${l.id}, 'approve', ${weekOnly})">✔ 승인</button>
                    <button class="ao-fb-btn ao-lesson-no" onclick="aoModalLessonAct(${l.id}, 'discard', ${weekOnly})">✖ 폐기</button>
                </span>
            </div>` : `
            <div class="ao-lesson-row">✅ [${aoEsc(l.category || '일반')}] ${aoEsc(l.lesson)}
                <span class="ao-lesson-meta">활성 · 승인 ${fmtD(l.approved_at)}</span>${src}</div>`;
        }).join('')}`).join('')
        : `<div class="ao-empty-note">${weekOnly ? '이번 주 활성화된 교훈이 없습니다' : '등록된 교훈이 없습니다 — 피드백이 쌓이면 제안이 올라옵니다'}</div>`;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'ao-lessons-overlay';
    overlay.innerHTML = `<div class="modal ao-detail-modal">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 8px;">${weekOnly ? '🌱 이번 주 학습' : '📚 지식 노트 전체'} <small style="color:#888;">(${lessons.length}건)</small></h3>
        ${weekOnly ? '' : `<div class="ao-week-line">🌱 이번 주 +${aoWeekLessons}건</div>`}
        ${bodyHtml}
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

window.aoModalLessonAct = async function(id, act, weekOnly) {
    if (act === 'discard' && !confirm('이 교훈 제안을 폐기할까요?')) return;
    try {
        const res = await api('/api/agent-office/lessons/' + id + '/' + act, 'POST');
        showToast(res.message);
        const ov = document.getElementById('ao-lessons-overlay');
        if (ov) ov.remove();
        aoOpenLessonsModal(weekOnly);
        aoRefreshGrowth();
    } catch (e) { alert(e.message); }
};

// 실패 수집함 모달 (대표 7/21 전면 개편): 실패(fail)만 표시 — 내 질문 + 마루/요원 답변, 길면 …+클릭 전체보기, 항목별 삭제.
//   피드백 이력(칭찬·수정·코멘트)은 제거 (현재 불필요). 쌓이면 대표가 "실패수집함 정리하자"로 함께 학습.
let aoFailData = {};
window.aoExtractAnswer = function(orig) {
    if (!orig) return '';
    const s = String(orig);
    if (s[0] === '{') { // 구버전은 run 결과 JSON일 수 있음 — 요약만 추출
        try { const o = JSON.parse(s); return (o.report && (o.report.conclusion || o.summary)) || o.summary || (Array.isArray(o.lines) ? o.lines.join(' / ') : '') || ''; }
        catch (e) { return s; }
    }
    return s;
};
window.aoOpenFeedbackModal = async function() {
    let data;
    try { data = await api('/api/agent-office/feedback'); }
    catch (e) { return alert(e.message); }
    const fails = (data.feedback || []).filter(f => f.feedback_type === 'fail');
    aoFailData = {};
    const itemHtml = f => {
        const q = (f.comment || '').trim();
        const a = (aoExtractAnswer(f.original_output) || f.run_summary || '').trim();
        aoFailData[f.id] = { q, a };
        const full = `Q. ${q || '(질문 기록 없음)'}\nA. ${a || '(답변 기록 없음)'}`;
        const isLong = full.length > 90;
        const short = isLong ? full.slice(0, 90) + ' …' : full;
        return `<div class="ao-fb-hist-item" style="display:flex;gap:8px;align-items:flex-start;">
            <span style="flex:1;min-width:0;">
                ❌ <span class="ao-log-time">${aoKst(f.created_at)}</span> <strong>${aoEsc(f.agent_name)}</strong>
                <div id="ao-failtxt-${f.id}" style="white-space:pre-wrap;word-break:break-word;margin-top:2px;${isLong ? 'cursor:pointer;' : ''}" data-open="0" ${isLong ? `onclick="aoToggleFailText(${f.id}, this)"` : ''}>${aoEsc(short)}${isLong ? ' <span style="color:#3b82f6;font-size:12px;">[전체보기]</span>' : ''}</div>
            </span>
            <button class="ao-fb-btn" style="flex-shrink:0;" title="이 실패 항목 삭제" onclick="aoDeleteFail(${f.id})">🗑</button>
        </div>`;
    };
    const body = fails.length
        ? fails.map(itemHtml).join('')
        : '<div class="ao-empty-note">수집된 실패가 없습니다 — 마루 답변이 이상하면 라이브 로그의 [❌ 실패] 또는 보고서의 [❌ 실패 표시]를 눌러주세요</div>';
    document.querySelectorAll('.ao-feedback-overlay').forEach(e => e.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ao-feedback-overlay';
    overlay.innerHTML = `<div class="modal ao-detail-modal">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h3 style="margin:0 0 8px;">🧰 실패 수집함 <small style="color:#888;">(${fails.length}건 — 쌓이면 "실패수집함 정리하자"로 함께 학습)</small></h3>
        <div style="max-height:64vh;overflow-y:auto;">${body}</div>
    </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};
// 길면 …접힘 ↔ 전체보기 토글 (대표 7/21)
window.aoToggleFailText = function(id, el) {
    const d = aoFailData[id]; if (!d) return;
    const full = `Q. ${d.q || '(질문 기록 없음)'}\nA. ${d.a || '(답변 기록 없음)'}`;
    if (el.dataset.open === '1') {
        const short = full.length > 90 ? full.slice(0, 90) + ' …' : full;
        el.innerHTML = aoEsc(short) + ' <span style="color:#3b82f6;font-size:12px;">[전체보기]</span>';
        el.dataset.open = '0';
    } else {
        el.innerHTML = aoEsc(full) + ' <span style="color:#888;font-size:12px;">[접기]</span>';
        el.dataset.open = '1';
    }
};
// 실패 항목 삭제 (대표 7/21: 잘못 눌렸거나 필요 없어진 건 제거)
window.aoDeleteFail = async function(id) {
    if (!confirm('이 실패 항목을 삭제할까요?')) return;
    try {
        await api('/api/agent-office/feedback/' + id + '/delete', 'POST');
        showToast('🗑 삭제했습니다');
        aoOpenFeedbackModal();
        aoRefreshGrowth();
    } catch (e) { alert(e.message); }
};

// ---- 9차: 보고서 보관/복원 (soft-delete — 피드백·학습 노트 무영향) ----
window.aoArchiveRun = async function(runId) {
    try {
        const res = await api('/api/agent-office/runs/' + runId + '/archive', 'POST');
        showToast('✔ ' + res.message);
        aoLoadReports();
        aoRefreshLog();
    } catch (e) { alert(e.message); }
};
// 대표 7/22: LIVE 로그 일괄 정리 — 현재 로그의 완료·오류 실행을 모두 확인 처리(숨김, 삭제 아님)
window.aoClearLog = async function() {
    try {
        const data = await api('/api/agent-office/runs?limit=100');
        const targets = (data.runs || []).filter(r => (r.status === 'done' || r.status === 'error') && !r.is_deleted);
        if (!targets.length) { showToast('정리할 완료·오류 기록이 없습니다'); return; }
        if (!confirm(`완료·오류 기록 ${targets.length}건을 로그에서 치울까요?\n(삭제가 아니라 숨김입니다 — "전체 보기"에서 다시 볼 수 있어요)`)) return;
        // 순차 처리 (서버 부담 최소화). 실패 건은 건너뜀
        let ok = 0;
        for (const r of targets) {
            try { await api('/api/agent-office/runs/' + r.id + '/archive', 'POST'); ok++; } catch (e) { /* 개별 실패 무시 */ }
        }
        showToast(`🧹 ${ok}건 정리 완료`);
        aoLoadReports();
        aoRefreshLog();
    } catch (e) { alert(e.message); }
};
window.aoRestoreRun = async function(runId) {
    try {
        const res = await api('/api/agent-office/runs/' + runId + '/unarchive', 'POST');
        showToast('↩️ ' + res.message);
        aoLoadReports();
        aoRefreshLog();
    } catch (e) { alert(e.message); }
};

// 10차: 역량 점검 실행 (자동 수정 없음 — 보고서만 등록)
window.aoRunCapabilityTest = async function() {
    if (!confirm('전 요원 역량 점검을 시작할까요? (약 2~3분 소요, AI 호출 비용 발생)')) return;
    try {
        const res = await api('/api/agent-office/capability-test', 'POST');
        showToast('🧪 ' + res.message);
        const overlay = document.getElementById('ao-detail-overlay');
        if (overlay) overlay.remove();
        const maru = aoAgents.find(a => a.role === 'chief');
        if (maru && res.run) {
            aoActiveRun = { runId: res.run.id, agentId: maru.id, stepCount: 0 };
            aoSetAgentStatus(maru.id, 'running');
            aoSayThinking(maru.name, '📝', '시험 중'); // 점검 완료까지 상시 표시
            aoStartRunPolling();
        }
    } catch (err) { alert(err.message); }
};

// 보고함 클릭 → 보고서함 탭으로 이동
window.aoGoReports = function() {
    const tab = document.querySelector('.ao-view-tab[data-view="reports"]');
    if (tab) tab.click();
};

// 카피 본문 복사 (알리고 붙여넣기용)
window.aoCopyText = async function(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const text = el.textContent;
    try {
        await navigator.clipboard.writeText(text);
        showToast('📋 카피 복사 완료 — 알리고에 붙여넣으세요');
    } catch (e) {
        // 구형 브라우저 폴백
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast('📋 카피 복사 완료');
    }
};

// ---- 피드백 (👍 / ✏️수정 / 👎 / 💬) ----
window.aoSendFeedback = async function(agentId, runId, type) {
    let comment = '', corrected = '';
    if (type === 'bad') {
        comment = prompt('어떤 점이 아쉬웠나요? (교훈 기록을 위해 필수)');
        if (!comment || !comment.trim()) return;
    }
    if (type === 'comment') {
        comment = prompt('코멘트를 입력해주세요');
        if (!comment || !comment.trim()) return;
    }
    if (type === 'edited') {
        corrected = prompt('대표님 수정본을 붙여넣어 주세요 (원본과 비교해 교훈 추출용)');
        if (corrected === null) return;
    }
    try {
        await api('/api/agent-office/feedback', 'POST', {
            agent_id: agentId, run_id: runId, feedback_type: type, comment: comment, corrected_output: corrected,
        });
        const agentName = (aoAgents.find(a => a.id === agentId) || {}).name;
        if (agentName) {
            aoSay(agentName, type === 'good'
                ? '감사합니다! 😊'
                : '피드백 감사합니다! 교훈으로 정리해서 다음 작업부터 반영할게요 📚', 6000);
        }
        showToast(type === 'good' ? '피드백이 기록되었습니다 👍' : '피드백 기록 — 교훈 후보 정리 중 📚 (마루 패널에서 승인)');
        aoRefreshGrowth();
    } catch (err) { alert(err.message); }
};

// [❌ 실패 표시] 원탭 — 실패 수집함 적재 (대표 7/21: 사유 프롬프트 제거, 질문+답변 자동 캡처. 나중에 함께 정리·학습)
window.aoMarkFail = async function(agentId, runId, btnEl) {
    try {
        const res = await api('/api/agent-office/feedback', 'POST', {
            agent_id: agentId, run_id: runId, feedback_type: 'fail',
        });
        showToast('🧰 ' + res.message);
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = '❌ 수집됨'; }
        aoRefreshGrowth();
    } catch (err) { alert(err.message); }
};
// [❌ 실패] 라이브 로그용 — 마루/요원 답변(오더)을 질문+답변째 실패 수집함에 담기 (대표 7/21)
window.aoMarkOrderFail = async function(orderId, btnEl) {
    try {
        const res = await api('/api/agent-office/feedback', 'POST', { order_id: orderId, feedback_type: 'fail' });
        showToast('🧰 ' + res.message);
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = '❌ 담김'; }
        aoRefreshGrowth();
    } catch (err) { alert(err.message); }
};

// 교훈 승인/폐기 (성장시스템 3절 — 대표 승인 시에만 활성)
window.aoApproveLesson = async function(lessonId, agentId) {
    try {
        const res = await api('/api/agent-office/lessons/' + lessonId + '/approve', 'POST');
        showToast('✔ ' + res.message);
        const overlay = document.getElementById('ao-detail-overlay');
        if (overlay) overlay.remove();
        openAoDetail(agentId);
        aoRefreshGrowth();
    } catch (err) { alert(err.message); }
};
window.aoDiscardLesson = async function(lessonId, agentId) {
    if (!confirm('이 교훈 제안을 폐기할까요?')) return;
    try {
        const res = await api('/api/agent-office/lessons/' + lessonId + '/discard', 'POST');
        showToast('✖ ' + res.message);
        const overlay = document.getElementById('ao-detail-overlay');
        if (overlay) overlay.remove();
        openAoDetail(agentId);
        aoRefreshGrowth();
    } catch (err) { alert(err.message); }
};

// ---- 보고서함 ----
async function aoLoadReports() {
    const team = document.getElementById('ao-report-team').value;
    const agentId = document.getElementById('ao-report-agent').value;
    const from = document.getElementById('ao-report-from').value;
    const to = document.getElementById('ao-report-to').value;
    const includeArchived = document.getElementById('ao-report-archived')?.checked;
    const params = new URLSearchParams({ limit: 100 });
    if (team) params.set('team', team);
    if (agentId) params.set('agent_id', agentId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (includeArchived) params.set('include_archived', 'true');
    try {
        const data = await api('/api/agent-office/runs?' + params.toString());
        const tbody = document.getElementById('ao-report-tbody');
        if (!data.runs.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="ao-log-empty">조회된 실행 이력이 없습니다</td></tr>';
            return;
        }
        tbody.innerHTML = data.runs.map(r => {
            const dt = aoKst(r.started_at, { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const dur = r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000) + '초' : '-';
            const stBadge = r.status === 'done' ? '<span class="ao-st-badge ao-st-badge-done">완료</span>'
                : r.status === 'error' ? '<span class="ao-st-badge ao-st-badge-err">오류</span>'
                : '<span class="ao-st-badge ao-st-badge-run">실행중</span>';
            const hasReport = r.result && r.result.report;
            const archived = !!r.is_deleted;
            const archBtn = archived
                ? '<button class="ao-fb-btn" onclick="aoRestoreRun(' + r.id + ')">↩️ 다시 보기</button>'
                : '<button class="ao-fb-btn" onclick="aoArchiveRun(' + r.id + ')">✔ 확인</button>';
            return '<tr class="' + (archived ? 'ao-run-archived' : '') + '">' +
                '<td>' + dt + (archived ? ' <span class="ao-arch-badge">확인함</span>' : '') + '</td>' +
                '<td><span class="ao-ai-badge">🤖AI</span> ' + r.agent_name + '</td>' +
                '<td>' + r.agent_team + '</td>' +
                '<td>' + stBadge + '</td>' +
                '<td>' + ((r.result && r.result.summary) || '-') + '</td>' +
                '<td>' + dur + '</td>' +
                '<td>' + (hasReport ? '<button class="ao-fb-btn" onclick="aoOpenReport(' + r.id + ')">📄 보고서</button>' : '-')
                    + (r.result && r.result.report && r.result.report.file_id
                        ? ' <button class="ao-fb-btn" onclick="aoDownloadFile(' + r.result.report.file_id + ')">📎 다운로드</button>' : '') + '</td>' +
                '<td>' + archBtn + '</td>' +
                '</tr>';
        }).join('');
    } catch (err) { alert(err.message); }
}

// ---- 상세 보고서 모달 (2차: 세미 정산 보고서 — 표 형태) ----
window.aoOpenReport = async function(runId) {
    let run;
    try {
        run = (await api('/api/agent-office/runs/' + runId)).run;
    } catch (err) { return alert(err.message); }
    const rep = (run.result && run.result.report) || null;
    if (!run.result) return alert('아직 결과가 없는 실행입니다 (진행 중이거나 기록 없음)');

    const dt = aoKst(run.started_at, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // v5.2 (지시 #38) + 지시 #44: 팀장 검수 블록 (검수 4문) — ⚠️보완이어도 숨기지 않고 표시 (최종 판단은 대표)
    const aoReviewBlock = rev => {
        if (!rev) return '';
        const who = aoEsc(rev.reviewer || '한결');
        if (rev.error) return `<div class="ao-review-box ao-review-warn">🔍 ${who} 검수: ${aoEsc(rev.error)}</div>`;
        const pass = rev.verdict === '통과';
        return `<div class="ao-review-box ${pass ? 'ao-review-ok' : 'ao-review-warn'}">
            <div class="ao-review-head">🔍 ${who} 검수: ${pass ? '✅ 통과' : '⚠️ 보완 의견'} <small style="color:#888;">(최종 판단은 대표님)</small></div>
            ${rev.comment ? `<div class="ao-review-item">💬 ${aoEsc(rev.comment)}</div>` : ''}
            ${(rev.items || []).map(it => `<div class="ao-review-item">${it.ok ? '✅' : '⚠️'} <strong>${aoEsc(it.name)}</strong> — ${aoEsc(it.comment || '')}</div>`).join('')}
            ${(rev.fill_items || []).length ? `<div class="ao-review-item">✏️ <strong>대표가 채울 항목:</strong> ${rev.fill_items.map(aoEsc).join(', ')}</div>` : ''}
            ${rev.suggestion ? `<div class="ao-review-sug">💡 수정 제안: ${aoEsc(rev.suggestion)}<br><small style="color:#888;">반영하려면 지시 입력바에 "수정 반영해줘"라고 지시해주세요 (1회 재작성)</small></div>` : ''}
        </div>`;
    };
    // 지시 #44: 한수 검산 블록 (0원 코드 검산 — 자동 보정 없음, 오차 있는 그대로)
    const aoAuditBlock = ac => {
        if (!ac) return '';
        return `<div class="ao-review-box ${ac.ok ? 'ao-review-ok' : 'ao-review-warn'}">
            <div class="ao-review-head">🧮 한수 검산: ${ac.ok ? '✅ 일치' : `⚠️ 오차 ${Math.round(ac.diff_won || 0).toLocaleString()}원`} <small style="color:#888;">(순수 코드 재검산 — 자동 보정 없음)</small></div>
            ${(ac.checks || []).map(c => `<div class="ao-review-item">${c.ok ? '✅' : '⚠️'} ${aoEsc(c.name)}${c.note ? ' — ' + aoEsc(c.note) : ''}</div>`).join('')}
        </div>`;
    };
    let body = '';
    if (!rep) {
        // 상세 report가 없는 실행 — 요약·결과 줄만 표시 (로그 클릭으로도 열리게)
        body = `<div class="ao-result-box">${((run.result && run.result.lines) || []).map(l => '<div>· ' + aoEsc(l) + '</div>').join('') || '<div>· 결과 요약 없음</div>'}</div>`;
    } else

    if (rep.no_data) {
        body = `<div class="ao-placeholder-box ao-soon-note">📭 ${aoEsc(rep.note || '데이터 없음')}</div>`;
    } else if (rep.type === 'geulsaem_copy') {
        // 4차: 글샘 카피 보고서 — [복사] 버튼으로 알리고에 바로 붙여넣기
        const missing = rep.missing_fields || [];
        body = `
        ${aoReviewBlock(rep.review)}
        ${rep.date_warning ? `<div class="ao-review-box ao-review-warn">${aoEsc(rep.date_warning)}</div>` : ''}
        ${missing.length ? `<div class="ao-missing-box">✏️ <strong>채워야 할 항목:</strong> ${missing.map(aoEsc).join(', ')}
            <span style="color:#888;font-size:11px;">— 본문의 [ ] 자리표시를 채운 뒤 발송하세요</span></div>` : ''}
        ${rep.title_error ? `<div class="ao-soon-note" style="margin-bottom:6px;">⚠️ ${aoEsc(rep.title_error)}</div>` : ''}
        <h4 class="ao-sec-title">✍️ ${aoEsc(rep.channel)} 카피${(() => {
            // 지시 #39: 구 저장분(run #60 등) 방어 — 제목에 파편 흔적이 있으면 노출하지 않고 사유 표시
            const t = String(rep.title || '');
            if (!t) return '';
            if (/[<>{}[\]]|antml|parameter/i.test(t)) return ' · <small style="color:#b45309;">제목 추출 실패 (오염 파편 — 본문은 정상)</small>';
            return ` · 제목안 "${aoEsc(t)}"`;
        })()}</h4>
        ${(rep.versions || []).map((v, i) => `
            <div class="ao-copy-head"><strong>${aoEsc(v.label || ('버전 ' + (i + 1)))}</strong>
                <button class="ao-fb-btn" onclick="aoCopyText('ao-copy-${run.id}-${i}')">📋 복사</button></div>
            <pre class="ao-copy-body" id="ao-copy-${run.id}-${i}">${aoEsc(v.text)}</pre>`).join('')}
        ${rep.send_tip ? `<div class="ao-result-box" style="margin-top:10px;">💡 ${aoEsc(rep.send_tip)}</div>` : ''}
        <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}${rep.char_counts ? ' · ' + aoEsc(rep.char_counts) : ''} · 모델 ${aoEsc(rep.model || '')}</p>`;
    } else if (rep.type === 'capability_test') {
        // 10차: 역량 점검 보고서
        const t = rep.totals || {};
        const fails = (rep.sections || []).flatMap(s => (s.results || []).filter(r => !r.pass).map(r => ({ agent: s.agent, ...r })));
        body = `
        <h4 class="ao-sec-title">🧪 요원별 통과율 <small style="color:#888;">(소요 ${rep.duration_s || '-'}초)</small></h4>
        <div class="ao-report-table-wrap"><table class="ao-report-table">
            <thead><tr><th>요원</th><th>통과</th><th>통과율</th></tr></thead>
            <tbody>
                ${(t.by_agent || []).map(a => {
                    const pct = a.total ? Math.round(a.pass / a.total * 100) : 0;
                    return `<tr><td><span class="ao-ai-badge">🤖AI</span> ${aoEsc(a.agent)}</td><td>${a.pass}/${a.total}</td>
                        <td><span class="${pct === 100 ? 'ao-up' : 'ao-down'}">${pct}%</span></td></tr>`;
                }).join('')}
                <tr class="ao-partner-sum"><td><strong>전체</strong></td><td><strong>${t.pass}/${t.total}</strong></td>
                    <td><strong>${t.total ? Math.round(t.pass / t.total * 100) : 0}%</strong></td></tr>
            </tbody>
        </table></div>
        ${fails.length ? `
        <h4 class="ao-sec-title">❌ 실패 상세 (${fails.length}건)</h4>
        <div class="ao-report-table-wrap"><table class="ao-report-table">
            <thead><tr><th>요원</th><th>항목</th><th>기대</th><th>실제</th></tr></thead>
            <tbody>${fails.map(f => `<tr><td>${aoEsc(f.agent)}</td><td>${aoEsc(f.name)}${f.note ? '<br><small style="color:#999;">' + aoEsc(f.note) + '</small>' : ''}</td>
                <td>${aoEsc(f.expected)}</td><td class="ao-down">${aoEsc(f.actual)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="ao-result-box">✅ 전 항목 통과</div>'}
        <h4 class="ao-sec-title">📋 전체 결과</h4>
        ${(rep.sections || []).map(s => `
            <div class="ao-copy-head"><strong>🤖 ${aoEsc(s.agent)} (${s.pass}/${s.total})</strong></div>
            <div class="ao-fb-history" style="max-height:200px;">${(s.results || []).map(r =>
                `<div class="ao-fb-hist-item">${r.pass ? '✅' : '❌'} ${aoEsc(r.name)} — ${aoEsc(r.actual)}</div>`).join('')}</div>`).join('')}
        ${(rep.artifacts || []).length ? `
        <h4 class="ao-sec-title">📝 생성물 원문 (글샘·미소)</h4>
        ${rep.artifacts.map((a, i) => `
            <div class="ao-copy-head"><strong>${aoEsc(a.agent)} · ${aoEsc(a.title)}</strong>
                <button class="ao-fb-btn" onclick="aoCopyText('ao-cap-${run.id}-${i}')">📋 복사</button></div>
            <pre class="ao-copy-body" id="ao-cap-${run.id}-${i}">${aoEsc(a.text)}</pre>`).join('')}` : ''}
        <h4 class="ao-sec-title">💡 개선 제안</h4>
        <div class="ao-result-box">${(rep.suggestions || []).map(s => '<div>· ' + aoEsc(s) + '</div>').join('')}</div>
        <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
    } else if (rep.type === 'semi_day') {
        // 8차 보강: 특정 일자 통합 보고 — 일별 정산(캘린더 기준) + 정산현황 기록
        const won = n => Math.round(n || 0).toLocaleString() + '원';
        const sd = rep.settlements || {};
        const st = rep.status || {};
        let settBody;
        if (sd.has) {
            settBody = `
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>거래처</th><th>금액</th></tr></thead>
                <tbody>
                    ${(sd.partners || []).map(p => `<tr><td>🏢 ${aoEsc(p.partner)}</td><td>${won(p.amount)}</td></tr>`).join('')}
                    <tr><td>🚚 CJ택배 (박스 ${(sd.box_count || 0).toLocaleString()}개 × 3,100원)</td><td>${won(sd.cj_fee)}</td></tr>
                    <tr class="ao-partner-sum"><td><strong>합계 (캘린더 셀과 동일)</strong></td><td><strong>${won(sd.total)}</strong></td></tr>
                </tbody>
            </table></div>`;
        } else {
            settBody = `<div class="ao-empty-note">해당 날짜 일별 정산 기록이 없습니다${sd.nearest ? ` — 가장 가까운 정산: ${aoEsc(sd.nearest)}` : ''}</div>`;
        }
        let stBody;
        if (st.no_data) {
            stBody = `<div class="ao-empty-note">정산현황(현금·광고·카드) 기록 없음${st.nearest ? ` — 가장 가까운 기록: ${aoEsc(st.nearest)}` : ''}</div>`;
        } else {
            const t = st.totals || {};
            const diffCell = st.prev
                ? `<span class="${st.prev.diff >= 0 ? 'ao-up' : 'ao-down'}">${st.prev.diff >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(st.prev.diff)).toLocaleString()}원</span> <small style="color:#888;">(직전 ${aoEsc(st.prev.label || '')} ${won(st.prev.total)})</small>`
                : '<span style="color:#999;">이전 기록 없음</span>';
            stBody = `
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>구분</th><th>금액</th></tr></thead>
                <tbody>
                    <tr><td>정산현황 합계 (＋)</td><td>${won(t.settle)}</td></tr>
                    <tr><td>광고비 (＋)</td><td>${won(t.ad)}</td></tr>
                    <tr><td>카드비용 (－)</td><td>${won(t.card)}</td></tr>
                    <tr><td>정산항목 (－)</td><td>${won(t.items)}</td></tr>
                    <tr class="ao-partner-sum"><td><strong>총 합계</strong></td><td><strong>${won(t.total)}</strong></td></tr>
                    <tr><td>직전 기록 대비</td><td>${diffCell}</td></tr>
                </tbody>
            </table></div>`;
        }
        body = `
        <h4 class="ao-sec-title">📅 ${aoEsc(rep.date_label || rep.date)} 일별 정산 <small style="color:#888;">(정산관리 캘린더 기준)</small></h4>
        ${settBody}
        <h4 class="ao-sec-title">📒 정산현황 기록 <small style="color:#888;">(재무현황 입력 탭 기준)</small></h4>
        ${stBody}
        <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
    } else if (rep.type === 'semi_status') {
        // 8차: 특정 일자 정산현황 조회 보고서
        const won = n => Math.round(n || 0).toLocaleString() + '원';
        if (rep.no_data) {
            body = `
            <h4 class="ao-sec-title">📒 정산현황 ${aoEsc(rep.date_label || rep.date)}</h4>
            <div class="ao-placeholder-box ao-soon-note">📭 해당 날짜에는 정산현황 기록이 없습니다${rep.nearest ? `<br><span style="font-size:12px;color:#666;">가장 가까운 기록: <strong>${aoEsc(rep.nearest)}</strong></span>` : ''}</div>
            <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
        } else {
            const t = rep.totals || {};
            const diffCell = rep.prev
                ? `<span class="${rep.prev.diff >= 0 ? 'ao-up' : 'ao-down'}">${rep.prev.diff >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(rep.prev.diff)).toLocaleString()}원</span> <small style="color:#888;">(직전 ${aoEsc(rep.prev.label)} ${won(rep.prev.total)})</small>`
                : '<span style="color:#999;">이전 기록 없음</span>';
            body = `
            <h4 class="ao-sec-title">📒 정산현황 ${aoEsc(rep.date_label || rep.date)}</h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>구분</th><th>금액</th></tr></thead>
                <tbody>
                    <tr><td>정산현황 합계 (＋)</td><td>${won(t.settle)}</td></tr>
                    <tr><td>광고비 (＋)</td><td>${won(t.ad)}</td></tr>
                    <tr><td>카드비용 (－)</td><td>${won(t.card)}</td></tr>
                    <tr><td>정산항목 (－)</td><td>${won(t.items)}</td></tr>
                    <tr class="ao-partner-sum"><td><strong>총 합계</strong></td><td><strong>${won(t.total)}</strong></td></tr>
                    <tr><td>직전 기록 대비</td><td>${diffCell}</td></tr>
                </tbody>
            </table></div>
            ${(rep.fields || []).length ? `
            <h4 class="ao-sec-title">항목별 입력값</h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>항목</th><th>금액</th></tr></thead>
                <tbody>${rep.fields.map(f => `<tr><td>${aoEsc(f.label)}</td><td>${won(f.value)}</td></tr>`).join('')}</tbody>
            </table></div>` : ''}
            ${rep.memo ? `<div class="ao-result-box" style="margin-top:8px;">📝 ${aoEsc(rep.memo)}</div>` : ''}
            <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
        }
    } else if (rep.type === 'maru_settlement') {
        // 8차: 마루 정산현황 입력 보고서
        const won = n => Math.round(n || 0).toLocaleString() + '원';
        body = `
        <h4 class="ao-sec-title">💾 정산현황 입력 ${aoEsc(rep.date_label || rep.date)}${rep.overwrote ? ' <small style="color:#e67700;">(기존 기록 부분 덮어씀)</small>' : ''}</h4>
        <div class="ao-result-box">${(rep.saved || []).map(s => '<div>· ' + aoEsc(s) + '</div>').join('')}</div>
        <div class="ao-grand-total">총 합계 <strong>${won(rep.total)}</strong>${rep.prev_total != null ? ` <small style="color:#ccc;">(저장 전 ${won(rep.prev_total)})</small>` : ''}</div>
        <p class="ao-rep-note">ℹ️ 말씀하신 항목만 저장 (나머지 무변경) · 정산관리 → 정산현황 화면에서 수정 가능</p>`;
    } else if (rep.type === 'maru_schedule') {
        // 7차: 마루 일정 직접 처리 보고서
        body = `
        <h4 class="ao-sec-title">📅 일정 ${aoEsc(rep.op || '조회')}${rep.from ? ` <small style="color:#888;">(${rep.from} ~ ${rep.to})</small>` : ''}</h4>
        ${(rep.items || []).length
            ? `<div class="ao-result-box">${rep.items.map(i => '<div>· ' + aoEsc(i) + '</div>').join('')}</div>`
            : '<div class="ao-empty-note">해당 기간 등록된 일정이 없습니다</div>'}
        <p class="ao-rep-note">ℹ️ 표기: 날짜(요일) 시간 — 내용 (담당자) · 담당자 미지정=대표 · 삭제·수정은 프로그램 일정 화면에서 직접</p>`;
    } else if (rep.type === 'miso_prompt') {
        // 5차: 미소 프롬프트 보고서 — 영문 프롬프트(코드블록) + 한글 해석 + 비율/사용처 + [복사]
        // 지시 #26·#27: 승인 게이트 생성 버튼 (건별 비용 표기) + 생성물 📎 + 생성 중/실패 표시
        const genBtns = (o, i) => {
            if (!rep.generation_available) return '';
            if (rep.media_generating) {
                // 대표 7/21: '생성 중' 텍스트 → 진행바(0→85% 크리핑, 완료 시 100%+이미지 자동 표시). 폴링은 aoPollMediaGen이 담당
                return rep.media_generating.output_index === i
                    ? `<div class="ao-gen-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:6px;">
                         <div style="font-size:13px;color:#e67700;font-weight:600;">⏳ ${aoEsc(o.media)} 생성 중... <span id="ao-mgpct-${i}">0%</span></div>
                         <div style="height:10px;background:#eee;border-radius:6px;overflow:hidden;">
                           <div id="ao-mgfill-${i}" style="height:100%;width:0%;background:linear-gradient(90deg,#F5C800,#e67700);transition:width .5s ease;"></div>
                         </div>
                         <div style="font-size:11px;color:#999;">${o.media === '영상' ? '영상은 최대 6분 걸려요 — 완료되면 여기 바로 나옵니다 (나가지 않으셔도 돼요)' : '잠시만요 — 완료되면 이미지가 여기 바로 나옵니다 (나가지 않으셔도 돼요)'}</div>
                       </div>` : '';
            }
            const c = o.media === '영상' ? { b: '약 1,100원', g: '약 4,400원', ico: '🎬' } : { b: '약 92원', g: '약 185원', ico: '🎨' };
            return `<div class="ao-gen-row">
                <button class="ao-fb-btn" onclick="aoGenerateMedia(${run.id}, ${i}, '기본', '${o.media}', '${c.b}')">${c.ico} 기본급 생성 (${c.b})</button>
                <button class="ao-fb-btn" onclick="aoGenerateMedia(${run.id}, ${i}, '고급', '${o.media}', '${c.g}')">✨ 고급 생성 (${c.g})</button>
            </div>`;
        };
        // 지시 #33: 이미지 파일은 카드 내 썸네일(탭하면 크게 보기) — 문서·영상은 기존 다운로드 유지
        const isImg = f => /\.(png|jpe?g|gif|webp)$/i.test(f.file_name || '');
        const files = (rep.media_files || []).map(f =>
            `<div class="ao-gen-file${isImg(f) ? ' ao-gen-file-img' : ''}">
             ${isImg(f) ? `<img id="ao-thumb-${f.file_id}" class="ao-media-thumb" alt="생성 이미지 (탭하면 크게)" onclick="aoPreviewImage(${f.file_id})">` : ''}
             <span>📎 ${aoEsc(f.file_name)} <small style="color:#888;">(${aoEsc(f.grade)} · 약 ${(f.est_krw || 0).toLocaleString()}원)</small></span>
             <button class="ao-fb-btn" onclick="aoDownloadFile(${f.file_id})">다운로드</button></div>`).join('');
        // 썸네일은 모달 삽입 직후 인증 fetch로 로드 (blob URL 캐시)
        const imgIds = (rep.media_files || []).filter(isImg).map(f => f.file_id);
        if (imgIds.length) setTimeout(() => imgIds.forEach(id => aoLoadThumb(id)), 80);
        // 대표 7/21: 생성 중 상태로 모달이 열리면(생성 시작 직후 or 재열기) 진행률 폴러 자동 가동 — 완료 시 이미지 자동 표시
        if (rep.media_generating) {
            const gi = rep.media_generating.output_index;
            const gmedia = ((rep.outputs || [])[gi] || {}).media || '이미지';
            setTimeout(() => aoPollMediaGen(run.id, gi, gmedia), 120);
        }
        body = `
        ${aoReviewBlock(rep.review)}
        ${rep.concept_note ? `<div class="ao-result-box">🎨 ${aoEsc(rep.concept_note)}</div>` : ''}
        ${rep.media_error ? `<div class="ao-placeholder-box ao-soon-note">⚠️ ${aoEsc(rep.media_error)}</div>` : ''}
        ${(rep.outputs || []).map((o, i) => `
            <div class="ao-copy-head">
                <strong>${aoEsc(o.label || ('시안 ' + (i + 1)))}</strong>
                <span>
                    <span class="ao-media-badge">${o.media === '영상' ? '🎬 영상 (Veo 3.1)' : '🖼️ 이미지 (Nano Banana)'}</span>
                    <button class="ao-fb-btn" onclick="aoCopyText('ao-miso-${run.id}-${i}')">📋 프롬프트 복사</button>
                </span>
            </div>
            <pre class="ao-copy-body ao-prompt-en" id="ao-miso-${run.id}-${i}">${aoEsc(o.prompt_en)}</pre>
            <div class="ao-prompt-ko">🇰🇷 ${aoEsc(o.prompt_ko || '')}</div>
            <div class="ao-prompt-meta">비율 <strong>${aoEsc(o.ratio || '-')}</strong> · 사용처 ${aoEsc(o.usage || '-')}</div>
            ${genBtns(o, i)}`).join('')}
        ${files ? `<h4 class="ao-sec-title">📎 생성물</h4>${files}` : ''}
        <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')} · 모델 ${aoEsc(rep.model || '')}</p>`;
    } else if (rep.type === 'semi_compare') {
        // 4.5단계 ⑤: 기간 비교 보고서
        const won = n => Math.round(n || 0).toLocaleString() + '원';
        const pcell = (diff, pct) => pct === null || pct === undefined
            ? '<span style="color:#999;">데이터 없음</span>'
            : `<span class="${diff >= 0 ? 'ao-up' : 'ao-down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% (${diff >= 0 ? '+' : ''}${Math.round(diff).toLocaleString()}원)</span>`;
        if (rep.zero_result) {
            body = `<div class="ao-placeholder-box ao-soon-note">📭 ${aoEsc(rep.a.label)} · ${aoEsc(rep.b.label)} 모두 정산 데이터가 없습니다</div>`;
        } else {
            body = `
            <h4 class="ao-sec-title">📊 총액 비교 <small style="color:#888;">(증감 = ${aoEsc(rep.a.label)} 대비 ${aoEsc(rep.b.label)})</small></h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>구분</th><th>${aoEsc(rep.a.label)}</th><th>${aoEsc(rep.b.label)}</th><th>증감</th></tr></thead>
                <tbody>
                    <tr><td>상품 매출</td><td>${won(rep.a.product_total)}</td><td>${won(rep.b.product_total)}</td><td>${pcell(rep.diff.product, rep.diff.product_pct)}</td></tr>
                    <tr><td>택배(+이월)</td><td>${won(rep.a.cj_fee + rep.a.cj_carryover)}</td><td>${won(rep.b.cj_fee + rep.b.cj_carryover)}</td><td></td></tr>
                    <tr class="ao-partner-sum"><td><strong>총 결제금액</strong></td><td><strong>${won(rep.a.payment_total)}</strong></td><td><strong>${won(rep.b.payment_total)}</strong></td><td>${pcell(rep.diff.payment, rep.diff.payment_pct)}</td></tr>
                    <tr><td>정산 건수 · 박스</td><td>${rep.a.count}건 · ${rep.a.box_count}박스</td><td>${rep.b.count}건 · ${rep.b.box_count}박스</td><td>${rep.diff.count >= 0 ? '+' : ''}${rep.diff.count}건 · ${rep.diff.boxes >= 0 ? '+' : ''}${rep.diff.boxes}박스</td></tr>
                </tbody>
            </table></div>
            <h4 class="ao-sec-title">🏪 거래처별 (상품 기준)</h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>거래처</th><th>${aoEsc(rep.a.label)}</th><th>${aoEsc(rep.b.label)}</th><th>증감</th></tr></thead>
                <tbody>${(rep.partners || []).map(p =>
                    `<tr><td>${aoEsc(p.partner)}</td><td>${won(p.a)}</td><td>${won(p.b)}</td><td>${pcell(p.diff, p.pct)}</td></tr>`).join('')}
                </tbody>
            </table></div>
            <h4 class="ao-sec-title">📦 품목 TOP ${(rep.items || []).length} <small style="color:#888;">(합집합 ${rep.items_total}종 중)</small></h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>품목</th><th>${aoEsc(rep.a.label)}</th><th>${aoEsc(rep.b.label)}</th><th>증감</th></tr></thead>
                <tbody>${(rep.items || []).map(i =>
                    `<tr><td>${aoEsc(i.name)}${i.tag ? ' <span class="ao-arch-badge">' + i.tag + '</span>' : ''}</td><td>${won(i.a_amount)}</td><td>${won(i.b_amount)}</td><td>${pcell(i.diff, i.pct)}</td></tr>`).join('')}
                </tbody>
            </table></div>
            <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
        }
    } else if (rep.type === 'semi_rank') {
        // 4.5단계 ⑥: 품목 매출 기여 순위
        const won = n => Math.round(n || 0).toLocaleString() + '원';
        if (rep.zero_result) {
            body = `<div class="ao-placeholder-box ao-soon-note">📭 ${aoEsc(rep.period.label)} 정산 데이터가 없습니다${rep.nearest_month ? ' — 가장 가까운 달: ' + aoEsc(rep.nearest_month) : ''}</div>`;
        } else {
            body = `
            <h4 class="ao-sec-title">🏆 ${aoEsc(rep.period.label)} 품목 기여 순위 <small style="color:#888;">(${rep.period.from} ~ ${rep.period.to} · 상품 총액 ${won(rep.product_total)})</small></h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>순위</th><th>품목</th><th>수량</th><th>매출액</th><th>비중</th></tr></thead>
                <tbody>${(rep.rows || []).map(r =>
                    `<tr><td>${r.rank}</td><td>${aoEsc(r.name)}</td><td>${(r.qty || 0).toLocaleString()}</td><td>${won(r.amount)}</td><td>${r.share}%</td></tr>`).join('')}
                ${rep.shown_all || (rep.rows || []).length >= rep.rows_total ? '' : `<tr><td colspan="5" style="color:#888;">… 전체 ${rep.rows_total}종 중 TOP ${(rep.rows || []).length} 표시 — "전부"라고 지시하면 전 품목</td></tr>`}
                </tbody>
            </table></div>
            ${(rep.series || []).length ? `
            <h4 class="ao-sec-title">🧺 계열 합계 <small style="color:#888;">(규격 2종 이상)</small></h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>계열</th><th>수량</th><th>매출액</th><th>비중</th></tr></thead>
                <tbody>${rep.series.map(s =>
                    `<tr><td>${aoEsc(s.name)} <small style="color:#888;">(${s.members}종)</small></td><td>${(s.qty || 0).toLocaleString()}</td><td>${won(s.amount)}</td><td>${s.share}%</td></tr>`).join('')}
                </tbody>
            </table></div>` : ''}
            <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
        }
    } else if (rep.type === 'gian_plan') {
        // 지시 #49: 기안 기획안 — 7항목 (미래 검수 블록은 상단 공통)
        body = `
        ${aoReviewBlock(rep.review)}
        <div class="ao-result-box">📋 <strong>${aoEsc(rep.summary || '')}</strong></div>
        <h4 class="ao-sec-title">🎯 목적 (철학 4축·로드맵 매핑)</h4><div class="ao-result-box">${aoEsc(rep.purpose || '')}</div>
        <div class="ao-prompt-meta">대상: ${aoEsc(rep.target || '-')}</div>
        <h4 class="ao-sec-title">🗂 실행 단계 (누가·뭘·언제)</h4>
        <div class="ao-report-table-wrap"><table class="ao-report-table">
            <thead><tr><th>누가</th><th>뭘</th><th>언제</th></tr></thead>
            <tbody>${(rep.steps || []).map(s => `<tr><td>${aoEsc(s.who)}</td><td>${aoEsc(s.what)}</td><td>${aoEsc(s.when)}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="ao-prompt-meta">💰 비용: ${aoEsc(rep.cost || '-')} · 📈 지표: ${aoEsc(rep.metrics || '-')}</div>
        ${(rep.deliverables || []).length ? `<h4 class="ao-sec-title">📦 산출물 (후보·시안)</h4>${rep.deliverables.map((d2, i2) => `<pre class="ao-copy-body" id="ao-gian-d-${run.id}-${i2}">${aoEsc(d2)}</pre>`).join('')}` : ''}
        ${rep.deliverables_error ? `<div class="ao-review-box ao-review-warn">📦 ${aoEsc(rep.deliverables_error)}</div>` : ''}
        ${(rep.risks || []).length ? `<h4 class="ao-sec-title">⚠️ 리스크</h4>${rep.risks.map(r2 => `<div class="ao-review-item">⚠️ ${aoEsc(r2)}</div>`).join('')}` : ''}
        ${rep.date_warning ? `<div class="ao-review-box ao-review-warn">${aoEsc(rep.date_warning)}</div>` : ''}
        <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
    } else if (rep.type === 'yeri_analysis') {
        // 지시 #49: 예리 분석 — 데이터 없음 정직 / 표본 병기
        body = rep.no_data
            ? `<div class="ao-placeholder-box ao-soon-note">📭 데이터 없음 — 분석 불가 (감으로 채우지 않습니다)</div>
               <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`
            : `<div class="ao-result-box">📊 표본 ${rep.sample_n}건 · 상위: ${(rep.top || []).map(aoEsc).join(', ')}</div>
               <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
    } else if (rep.type === 'yeri_insta') {
        // 대표 7/22: 예리 인스타 결과물 (아이디·영상방향·대본·문구·분석)
        const kindLabel = { 아이디추천: '📛 계정 아이디 추천', 영상방향: '🎬 영상 방향·컨셉', 대본: '📝 릴스 대본', 게시물문구: '✍️ 게시물 문구', 성과분석: '📊 성과 분석' }[rep.kind] || '📱 인스타';
        body = `
        <h4 class="ao-sec-title">${kindLabel}${rep.business && rep.business !== '미정' ? ` <small style="color:#888;">(${aoEsc(rep.business)})</small>` : ''}</h4>
        <pre class="ao-copy-body" id="ao-yeri-${run.id}" style="white-space:pre-wrap;word-break:break-word;">${aoEsc(rep.body || '')}</pre>
        <button class="ao-fb-btn" onclick="aoCopyText('ao-yeri-${run.id}')">📋 복사</button>
        ${rep.hashtags ? `<h4 class="ao-sec-title">🏷 해시태그</h4><div class="ao-result-box" style="word-break:break-word;">${aoEsc(rep.hashtags)}</div>` : ''}
        <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
    } else if (rep.type === 'jiyul_labor') {
        // 지시 #45: 지율 노무 자문 — 템플릿 섹션 표시 (✅결론 ⚖️근거 💰계산 ⚠️체크 ✅액션)
        body = `
        ${rep.pending_guide ? `<div class="ao-placeholder-box ao-soon-note">📭 지침서 대기 중 — 범위 밖 (구 기록)</div>` : `
        <div class="ao-result-box">✅ <strong>${aoEsc(rep.conclusion || '')}</strong></div>
        ${rep.mode === '소속확인' ? `<div class="ao-review-box ao-review-warn">❓ ${aoEsc(rep.question_back || '')} — 지시 입력바에 답해주세요</div>` : ''}
        ${rep.legal_basis ? `<h4 class="ao-sec-title">⚖️ 법적 근거</h4><div class="ao-result-box">${aoEsc(rep.legal_basis)}</div>` : ''}
        ${rep.calculation ? `<h4 class="ao-sec-title">💰 계산·표</h4><pre class="ao-copy-body">${aoEsc(rep.calculation)}</pre>` : ''}
        ${(rep.checkpoints || []).length ? `<h4 class="ao-sec-title">⚠️ 노무사 체크포인트</h4>${rep.checkpoints.map(c => `<div class="ao-review-item">· ${aoEsc(c)}</div>`).join('')}` : ''}
        ${(rep.actions || []).length ? `<h4 class="ao-sec-title">✅ 액션 아이템</h4>${rep.actions.map(c => `<div class="ao-review-item">✅ ${aoEsc(c)}</div>`).join('')}` : ''}`}
        <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
    } else if (rep.type === 'semi_partner_week') {
        // 지시 #15: 주차×거래처 정산 (주간 정산 현황 화면과 동일 계산)
        const won = n => Math.round(n || 0).toLocaleString() + '원';
        if (rep.zero_result) {
            body = `<div class="ao-placeholder-box ao-soon-note">📭 ${aoEsc(rep.label)} ${aoEsc(rep.partner)} 정산 기록이 없습니다${rep.hint ? '<br><span style="font-size:11px;color:#999;">' + aoEsc(rep.hint) + '</span>' : ''}</div>`;
        } else if (rep.cj) {
            body = `
            <h4 class="ao-sec-title">🚚 ${aoEsc(rep.label)} CJ대한통운 택배비 <small style="color:#888;">(${rep.from} ~ ${rep.to})</small></h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <tbody>
                <tr><td>박스 수 (대성·효돈·기타 합산)</td><td>${(rep.boxes || 0).toLocaleString()}개</td></tr>
                <tr><td>택배비 (박스 × 3,100원)</td><td><strong>${won(rep.total)}</strong></td></tr>
                </tbody>
            </table></div>
            ${rep.no_file ? `<p class="ao-rep-note">ℹ️ ${aoEsc(rep.no_file)}</p>` : ''}
            <p class="ao-rep-note">ℹ️ 주간 정산 현황 화면과 동일 계산</p>`;
        } else {
            body = `
            <h4 class="ao-sec-title">📅 ${aoEsc(rep.label)} ${aoEsc(rep.partner)} 정산 <small style="color:#888;">(${rep.from} ~ ${rep.to})</small></h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <tbody>
                <tr><td>정산 건수</td><td>${rep.count || 0}건</td></tr>
                <tr><td>결제금액 합계</td><td><strong>${won(rep.total)}</strong></td></tr>
                </tbody>
            </table></div>
            ${rep.file_error ? `<p class="ao-rep-note">⚠️ ${aoEsc(rep.file_error)}</p>` : ''}
            <p class="ao-rep-note">ℹ️ 주간 정산 현황 화면의 거래처 셀과 동일 계산·동일 양식${rep.file_name ? ' — 📎 ' + aoEsc(rep.file_name) : ''}</p>`;
        }
    } else if (rep.type === 'semi_price_history') {
        // 대표 7/22: 품목별 결제가(단가) 이력 — 거래처별 · 주(날짜범위)별 단가 그리드 (매출 아님)
        const wonCell = n => (n === null || n === undefined) ? '<span style="color:#bbb;">—</span>' : `${Math.round(n).toLocaleString()}원`;
        if (rep.zero_result) {
            body = `<div class="ao-placeholder-box ao-soon-note">📭 ${aoEsc(rep.period.label)}${rep.partner ? ' · ' + aoEsc(rep.partner) : ''} 품목별 결제가(단가) 이력이 없습니다${rep.nearest_month ? '<br><span style="font-size:11px;color:#999;">단가가 등록된 가장 가까운 달: ' + aoEsc(rep.nearest_month) + '</span>' : ''}</div>`;
        } else {
            body = `
            <div class="ao-result-box" style="background:#f0f7ff;border-left:3px solid #4c6ef5;">💰 <strong>결제가(단가) 이력</strong> — 매출액이 아니라 그 시기의 <strong>단가</strong>입니다. 결제가는 주마다 변동돼요.</div>
            ${(rep.partners || []).map(p => `
                <h4 class="ao-sec-title" style="margin-top:14px;">🏪 ${aoEsc(p.partner)} <small style="color:#888;">(${p.weeks.length}주)</small></h4>
                <div class="ao-report-table-wrap"><table class="ao-report-table">
                    <thead><tr><th>품목</th>${p.weeks.map(w => `<th>${aoEsc(w.label)}</th>`).join('')}</tr></thead>
                    <tbody>
                    ${p.items.map(it => `<tr><td>${aoEsc(it.name)}</td>${it.prices.map(pr => `<td>${wonCell(pr)}</td>`).join('')}</tr>`).join('')}
                    </tbody>
                </table></div>
                ${p.items_omitted ? `<div class="ao-empty-note">… 외 ${p.items_omitted}종 생략</div>` : ''}`).join('')}
            <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
        }
    } else if (rep.type === 'semi_settlement_filtered') {
        // 3.5차: 조건 필터 보고서 (품목 키워드 · 기간)
        const won = n => Math.round(n || 0).toLocaleString() + '원';
        if (rep.no_match) {
            body = `
            <h4 class="ao-sec-title">🔍 ${aoEsc(rep.title)}</h4>
            <div class="ao-placeholder-box ao-soon-note">📭 "${aoEsc(rep.keyword)}" 품목을 찾을 수 없습니다<br>
            <span style="font-size:11px;color:#999;">(조회 기간: ${rep.period.from} ~ ${rep.period.to})</span></div>
            ${rep.available_items && rep.available_items.length ? `
            <h4 class="ao-sec-title">📦 해당 기간 등록 품목 (${rep.available_items.length}종)</h4>
            <div class="ao-tool-list">${rep.available_items.map(n => '<span class="ao-knowledge-badge">' + aoEsc(n) + '</span>').join('')}</div>`
            : '<div class="ao-empty-note">해당 기간에는 정산 데이터가 없습니다</div>'}
            <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
        } else {
            body = `
            <h4 class="ao-sec-title">🔍 ${aoEsc(rep.title)} <small style="color:#888;">(${rep.period.from} ~ ${rep.period.to})</small></h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>품목 (규격별)</th><th>수량</th><th>금액</th></tr></thead>
                <tbody>
                ${(rep.items || []).map(i =>
                    `<tr><td>${aoEsc(i.name)}</td><td>${(i.qty || 0).toLocaleString()}</td><td>${won(i.amount)}</td></tr>`).join('')}
                <tr class="ao-partner-sum"><td><strong>합계</strong></td><td><strong>${(rep.total_qty || 0).toLocaleString()}개</strong></td><td><strong>${won(rep.product_total)}</strong></td></tr>
                </tbody>
            </table></div>
            ${rep.payment_total != null ? `
            <div class="ao-grand-total">상품 ${won(rep.product_total)} + 택배비 ${won((rep.cj_fee || 0) + (rep.cj_carryover || 0))} = 총 결제금액 <strong>${won(rep.payment_total)}</strong></div>` : ''}
            <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
        }
    } else if (rep.type === 'semi_settlement') {
        const pctCell = (pct, diff) => {
            if (pct === null || pct === undefined) return '<span style="color:#999;">전년 데이터 없음</span>';
            const cls = diff >= 0 ? 'ao-up' : 'ao-down';
            return `<span class="${cls}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% (${diff >= 0 ? '+' : ''}${Math.round(diff).toLocaleString()}원)</span>`;
        };
        const won = n => Math.round(n || 0).toLocaleString() + '원';
        const yoyTable = `
        <h4 class="ao-sec-title">📈 전년 동기대비 품목별 증감 (상품 기준)</h4>
        ${rep.yoy_items && rep.yoy_items.length ? `
        <div class="ao-report-table-wrap"><table class="ao-report-table">
            <thead><tr><th>품목</th><th>올해</th><th>작년</th><th>증감</th></tr></thead>
            <tbody>${rep.yoy_items.map(i =>
                `<tr><td>${aoEsc(i.name)}</td><td>${won(i.cur_amount)}</td><td>${won(i.prev_amount)}</td><td>${pctCell(i.pct, i.diff)}</td></tr>`).join('')}
            </tbody>
        </table></div>` : '<div class="ao-empty-note">비교할 품목 데이터가 없습니다</div>'}`;

        if (rep.partners) {
            // 신형 보고서: 결제 요약(상품+택배) + 거래처별 그룹 + 총 합계
            const m = rep.month, w = rep.week;
            const cjMonthTotal = (m.cj_fee || 0) + (m.cj_carryover || 0);
            body = `
            <h4 class="ao-sec-title">📊 결제 요약 (${aoEsc(rep.workplace)})</h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>구분</th><th>기간</th><th>상품 매출</th><th>택배비</th><th>총 결제금액</th></tr></thead>
                <tbody>
                    <tr><td>이번 주</td><td>${w.from} ~ ${w.to}</td><td>${won(w.product_total)}</td><td>${won(w.cj_fee)}</td><td><strong>${won(w.payment_total)}</strong></td></tr>
                    <tr><td>이번 달</td><td>${m.from} ~ ${m.to}</td><td>${won(m.product_total)}</td>
                        <td>${won(cjMonthTotal)}${m.cj_carryover ? `<br><small style="color:#888;">(당월 ${won(m.cj_fee)} + 이월 ${won(m.cj_carryover)})</small>` : ''}</td>
                        <td><strong>${won(m.payment_total)}</strong></td></tr>
                    <tr><td>전년 동기<br><small>(상품 기준)</small></td><td>${rep.prev.from} ~ ${rep.prev.to}</td><td>${won(rep.prev.total)}</td><td>—</td><td>${pctCell(rep.total_pct, rep.total_diff)}</td></tr>
                </tbody>
            </table></div>
            <h4 class="ao-sec-title">🧾 거래처별 품목 금액 (이번 달)</h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>품목</th><th>수량</th><th>금액</th></tr></thead>
                <tbody>
                ${rep.partners.map(p =>
                    `<tr class="ao-partner-head"><td colspan="3">🏢 ${aoEsc(p.partner)}</td></tr>` +
                    (p.items.length
                        ? p.items.map(i => `<tr><td>${aoEsc(i.name)}</td><td>${(i.qty || 0).toLocaleString()}</td><td>${won(i.amount)}</td></tr>`).join('')
                        : '<tr><td colspan="3" style="color:#999;">품목 정보 없음</td></tr>') +
                    `<tr class="ao-partner-sum"><td><strong>거래처 합계 (${p.count}건)</strong></td><td></td><td><strong>${won(p.total)}</strong></td></tr>`
                ).join('')}
                <tr class="ao-partner-head"><td colspan="3">🚚 CJ택배</td></tr>
                <tr><td>택배비 (박스 ${(m.box_count || 0).toLocaleString()}개 × 3,100원)</td><td>${(m.box_count || 0).toLocaleString()}</td><td>${won(m.cj_fee)}</td></tr>
                ${m.cj_carryover ? `<tr><td>이월금액</td><td>—</td><td>${won(m.cj_carryover)}</td></tr>` : ''}
                <tr class="ao-partner-sum"><td><strong>CJ택배 합계</strong></td><td></td><td><strong>${won(cjMonthTotal)}</strong></td></tr>
                </tbody>
            </table></div>
            <div class="ao-grand-total">상품 정산 ${won(m.product_total)} + 택배비 ${won(cjMonthTotal)} = 총 결제금액 <strong>${won(m.payment_total)}</strong></div>
            ${yoyTable}
            <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
        } else {
            // 구형 보고서 호환 (거래처 그룹 도입 전 실행 기록)
            body = `
            <h4 class="ao-sec-title">📊 매출 요약 (${aoEsc(rep.workplace)})</h4>
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>구분</th><th>기간</th><th>매출 합계</th><th>정산 건수</th></tr></thead>
                <tbody>
                    <tr><td>이번 주</td><td>${rep.week.from} ~ ${rep.week.to}</td><td><strong>${won(rep.week.total)}</strong></td><td>${rep.week.count}건</td></tr>
                    <tr><td>이번 달</td><td>${rep.month.from} ~ ${rep.month.to}</td><td><strong>${won(rep.month.total)}</strong></td><td>${rep.month.count}건</td></tr>
                    <tr><td>전년 동기</td><td>${rep.prev.from} ~ ${rep.prev.to}</td><td>${won(rep.prev.total)}</td><td>${rep.prev.count}건</td></tr>
                    <tr><td>증감</td><td>—</td><td colspan="2">${pctCell(rep.total_pct, rep.total_diff)}</td></tr>
                </tbody>
            </table></div>
            <h4 class="ao-sec-title">🧾 품목별 금액 (이번 달)</h4>
            ${rep.month_items && rep.month_items.length ? `
            <div class="ao-report-table-wrap"><table class="ao-report-table">
                <thead><tr><th>품목</th><th>수량</th><th>금액</th></tr></thead>
                <tbody>${rep.month_items.map(i =>
                    `<tr><td>${aoEsc(i.name)}</td><td>${i.qty.toLocaleString()}</td><td>${won(i.amount)}</td></tr>`).join('')}
                </tbody>
            </table></div>` : '<div class="ao-empty-note">이번 달 품목 데이터가 없습니다</div>'}
            ${yoyTable}
            <p class="ao-rep-note">ℹ️ ${aoEsc(rep.note || '')}</p>`;
        }
    } else {
        body = `<div class="ao-result-box">${((run.result && run.result.lines) || []).map(l => '<div>· ' + aoEsc(l) + '</div>').join('')}</div>`;
    }

    // 대표 7/21: 재렌더 시 보고서 모달이 겹겹이 쌓여 확인을 여러 번 눌러야 하던 것 — 기존 보고서 모달을 먼저 제거(전용 클래스, 다른 모달 무영향)
    document.querySelectorAll('.ao-report-overlay').forEach(e => e.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ao-report-overlay';
    overlay.innerHTML = `
        <div class="modal ao-detail-modal" style="max-width:680px;">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3 style="margin:0 0 4px;">📄 ${aoEsc(run.agent_name)} 보고서
                ${(!run.is_deleted && !run.is_test && run.status === 'done')
                    ? `<button class="ao-fb-btn ao-modal-confirm" onclick="aoArchiveRun(${run.id}); this.closest('.modal-overlay').remove();">✔ 확인</button>` : ''}
                ${(!run.is_test && run.agent_id)
                    ? `<button class="ao-fb-btn ao-fail-btn" title="실패 수집함에 담기 (지시 #62 — 쌓이면 일괄 보강)" onclick="aoMarkFail(${run.agent_id}, ${run.id}, this)">❌ 실패 표시</button>` : ''}
                ${rep && rep.file_id ? `<button class="ao-fb-btn ao-modal-confirm" style="margin-right:6px;" onclick="aoDownloadFile(${rep.file_id})">📎 엑셀 다운로드</button>` : ''}
            </h3>
            <div class="ao-detail-meta">${aoEsc(run.agent_team)} · 실행 ${dt}</div>
            ${aoOrderByRun[run.id] ? `<div class="ao-result-box" style="margin-top:8px;background:#f5f7fb;border-left:3px solid #4c6ef5;">🕐 <strong>대표님 질문</strong>: ${aoEsc(aoCleanContent(aoOrderByRun[run.id]))}</div>` : ''}
            <div class="ao-result-box" style="margin-top:8px;"><strong>${aoEsc((run.result && run.result.summary) || '')}</strong></div>
            ${aoAuditBlock(rep && rep.audit_check)}
            ${body}
        </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}
