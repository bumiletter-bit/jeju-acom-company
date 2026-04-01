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

    // 관리자 전용 메뉴 숨김 (정산관리, 품목별 금액, 데이터관리)
    const adminOnlyPages = ['settlement', 'pricing', 'data'];
    adminOnlyPages.forEach(page => {
        const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navEl) navEl.style.display = currentUser.role === 'admin' ? '' : 'none';
    });

    // 관리자 전용 📢 지시사항 버튼
    const announcementBtn = document.getElementById('announcement-btn');
    if (announcementBtn) announcementBtn.style.display = currentUser.role === 'admin' ? '' : 'none';
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
    const adminOnlyPages = ['settlement', 'pricing', 'data'];
    if (adminOnlyPages.includes(pageName) && currentUser?.role !== 'admin') {
        pageName = 'schedule';
    }

    navItems.forEach(n => n.classList.remove('active'));
    pages.forEach(p => p.classList.remove('active'));

    document.querySelector(`[data-page="${pageName}"]`).classList.add('active');
    document.getElementById(`page-${pageName}`).classList.add('active');

    if (pageName === 'schedule') renderScheduleCalendar().catch(console.error);
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
    if (pageName === 'lunch') renderLunchPage().catch(console.error);
    if (pageName === 'planner') renderPlannerPage().catch(console.error);
    if (pageName === 'inventory') renderBoxInventory().catch(console.error);
    if (pageName === 'cs-room') renderCsTemplates().catch(console.error);
    if (pageName === 'ai-workspace') renderAIWorkspace().catch(console.error);
    if (pageName === 'data' && currentUser?.role === 'admin') renderUserList().catch(console.error);
    if (pageName === 'myinfo') renderMyInfoPage();
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

    // 사용자별 범례
    const userMap = {};
    schedules.forEach(s => {
        if (!userMap[s.userId]) userMap[s.userId] = { name: s.userName, color: s.userColor };
    });
    document.getElementById('schedule-legend').innerHTML = Object.values(userMap).map(u =>
        `<span class="legend-dot" style="background:${u.color}"></span><span>${u.name}</span>`
    ).join('');

    // 일별 일정
    const dailySchedules = {};
    schedules.forEach(s => {
        if (!dailySchedules[s.date]) dailySchedules[s.date] = [];
        dailySchedules[s.date].push(s);
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
                        const typeIcon = s.type === 'vacation' ? '🏖️ ' : s.type === 'attendance' ? '📌 ' : '';
                        if (s.type === 'normal') {
                            const checked = s.isCompleted ? 'checked' : '';
                            const completedClass = s.isCompleted ? ' schedule-completed' : '';
                            scheduleHtml += `<div class="day-schedule-item${completedClass}" style="border-left:3px solid ${s.userColor};" title="${s.userName}: ${s.title}"><label class="schedule-check" onclick="event.stopPropagation();"><input type="checkbox" ${checked} onchange="toggleScheduleComplete(${s.id}, this)"><span class="schedule-checkmark"></span></label><span class="schedule-text">${s.title}</span></div>`;
                        } else {
                            scheduleHtml += `<div class="day-schedule-item" style="border-left:3px solid ${s.userColor};" title="${s.userName}: ${s.title}">${typeIcon}${s.title}</div>`;
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

    let daesungPayment = 0, hyodonPayment = 0, cjPayment = 0;
    const dailyPayments = {};

    settlements.forEach(s => {
        const amount = s.amount || 0;
        const isPaid = s.isPaid || false;

        if (!dailyPayments[s.date]) dailyPayments[s.date] = {
            daesung: 0, hyodon: 0, cj: 0,
            daesungPaid: 0, hyodonPaid: 0, cjPaid: 0,
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

        // CJ택배비 자동 계산: 대성/효돈 정산의 items 수량 합계 × 3,100원
        // CJ 결제완료는 대성/효돈과 독립적으로 cjPaidMap에서 관리
        if (s.partner === '대성(시온)' || s.partner === '효돈농협') {
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
        document.getElementById('cj-payment').textContent = `${(totalUnpaid.cj || 0).toLocaleString()} 원`;
        document.getElementById('expected-payment').textContent = `${(totalUnpaid.total || 0).toLocaleString()} 원`;

        // 선결제 라인 숨김 (총합에 이미 반영됨)
        document.getElementById('daesung-prepay-line').style.display = 'none';
        document.getElementById('hyodon-prepay-line').style.display = 'none';
    } catch (err) {
        console.error('전체 미정산 합계 로드 오류:', err);
        // 폴백: 현재 월 데이터만 표시
        document.getElementById('daesung-payment').textContent = `${daesungPayment.toLocaleString()} 원`;
        document.getElementById('hyodon-payment').textContent = `${hyodonPayment.toLocaleString()} 원`;
        document.getElementById('expected-payment').textContent = `${(daesungPayment + hyodonPayment + cjTotal).toLocaleString()} 원`;
    }

    // 달력용 선결제 내역 (해당 월)
    const dailyPrepayments = {};
    prepayments.forEach(p => {
        if (p.date && p.date.startsWith(monthStr)) {
            if (!dailyPrepayments[p.date]) dailyPrepayments[p.date] = [];
            const shortName = p.partner === '대성(시온)' ? '대성' : (p.partner === '효돈농협' ? '효돈' : p.partner);
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
                        contentHtml += `<div class="day-prepay-item">${item.name} 선결제 ${item.amount.toLocaleString()}원</div>`;
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
                    if (dp.cj) {
                        const allPaid = dp.cjPaid === dp.cj;
                        const cls = allPaid ? 'day-payment-item cj paid' : 'day-payment-item cj';
                        contentHtml += `<div class="${cls}"><span class="pay-label">CJ</span><span class="pay-amount">${dp.cj.toLocaleString()}원</span></div>`;
                    }
                    const dayTotal = (dp.daesung || 0) + (dp.hyodon || 0) + (dp.cj || 0);
                    const dayTotalPaid = (dp.daesungPaid || 0) + (dp.hyodonPaid || 0) + (dp.cjPaid || 0);
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

    // 대성, 효돈 entries
    ['대성(시온)', '효돈농협'].forEach(partner => {
        const entries = dp.entries.filter(e => e.partner === partner);
        if (!entries.length) return;
        entries.forEach(e => {
            total += e.amount;
            const paidClass = e.isPaid ? 'settlement-day-entry paid' : 'settlement-day-entry';
            const btnText = e.isPaid ? '✅ 완료' : '☐ 결제완료';
            const btnClass = e.isPaid ? 'btn-paid active' : 'btn-paid';
            entriesHtml += `<div class="${paidClass}">
                <span class="entry-partner">${partner}</span>
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
            detailEl.innerHTML = `대성(시온) <strong>${data.daesung}건</strong> + 효돈농협 <strong>${data.hyodon}건</strong> = 총 <strong>${data.totalBoxes}건</strong>`;
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
    else if (/블러드오렌지|블러드/.test(t)) fruit = '블러드오렌지';
    else if (/비가림|감귤/.test(t)) fruit = '비가림귤';
    else if (/수라향/.test(t)) fruit = '수라향';
    else if (/자몽/.test(t)) fruit = '자몽';
    else if (/천혜향/.test(t)) fruit = '천혜향';
    else if (/레드향/.test(t)) fruit = '레드향';
    else if (/한라봉/.test(t)) fruit = '한라봉';
    else if (/레몬/.test(t)) fruit = '레몬';

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

    // 중량 추출
    let weight = null;
    const wMatch = t.match(/(\d+)\s*kg/i);
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
                    <td style="text-align:center"><input type="number" class="settlement-qty-input" data-idx="${idx}" value="${qty}" min="0" style="width:70px;text-align:center;padding:4px 6px;border:1px solid #F5A623;border-radius:4px;font-size:14px;"></td>
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
            <h3>${item.date} - ${item.partner} 상세${isEditMode ? ' <span style="color:#F5A623;font-size:14px;">[수정모드]</span>' : ''}</h3>
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
            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i]; if (!row || row.length === 0) continue;
                const name = String(row[nameCol] || '').trim();
                let price = 0;
                if (priceCol >= 0 && row[priceCol] != null) price = Number(String(row[priceCol]).replace(/[,원\s]/g, '')) || 0;
                if (name) addPricingRow(name, price);
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
    lines.forEach(line => {
        const parts = line.split(/\t/).map(s => s.trim()).filter(s => s);
        let name = '', price = 0;
        if (parts.length >= 2) { price = Number(parts[parts.length - 1].replace(/[,원\s]/g, '')) || 0; name = parts.slice(0, parts.length - 1).join(' '); }
        else { const match = line.match(/^(.+?)\s{2,}([\d,]+)/); if (match) { name = match[1].trim(); price = Number(match[2].replace(/,/g, '')) || 0; } else { name = line.trim(); } }
        if (name && !name.match(/^(옵션명|품목명|상품명|단가|가격)$/)) addPricingRow(name, price);
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

function addPricingRow(name, price) {
    name = name || ''; price = price || '';
    const container = document.getElementById('pricing-rows');
    const div = document.createElement('div');
    div.className = 'pricing-row';
    div.innerHTML = `<input type="text" placeholder="품목명" class="pricing-item-name" value="${name}"><input type="number" placeholder="단가 (원)" class="pricing-item-price" value="${price}"><button class="btn-remove-row" onclick="removePricingRow(this)">×</button>`;
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
            if (name) rows.push({ name, price: Number(price) || 0 });
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

async function renderPricingList() {
    const data = await api('/api/pricing');
    pricingCache = data;
    const tbody = document.getElementById('pricing-list');

    if (data.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">설정된 금액이 없습니다.</td></tr>';
    } else {
        let rows = '';
        data.forEach(item => {
            const items = item.items || [];
            if (items.length === 0) {
                rows += `<tr><td>${item.startDate} ~ ${item.endDate}</td><td>${item.partner}</td><td>-</td><td>-</td></tr>`;
            } else {
                const colorClass = item.partner === '대성(시온)' ? 'pricing-daesung' : 'pricing-hyodon';
                items.forEach((it, idx) => {
                    rows += `<tr class="${colorClass}">
                        ${idx === 0 ? `<td rowspan="${items.length}">${item.startDate} ~ ${item.endDate}<br><button class="btn-danger" style="margin-top:6px" onclick="deletePricing(${item.id})">삭제</button></td>` : ''}
                        ${idx === 0 ? `<td rowspan="${items.length}">${item.partner}</td>` : ''}
                        <td>${it.name}</td><td>${(it.price || 0).toLocaleString()} 원</td>
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
                <td>${u.role === 'admin' ? '관리자' : '직원'}</td>
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
    const typeLabels = { vacation: '휴가신청서', attendance: '근태신청서', reason: '시말서' };
    document.getElementById('doc-form-title').textContent = typeLabels[currentDocType] + ' 작성';

    document.getElementById('doc-vacation-type-group').style.display = currentDocType === 'vacation' ? '' : 'none';
    document.getElementById('doc-attendance-type-group').style.display = currentDocType === 'attendance' ? '' : 'none';
    document.getElementById('doc-reason-type-group').style.display = currentDocType === 'reason' ? '' : 'none';

    if (currentDocType === 'vacation') selectedDocSubType = '연차';
    else if (currentDocType === 'attendance') selectedDocSubType = '휴직';
    else selectedDocSubType = '지각';

    const activeGroup = document.getElementById(`doc-${currentDocType}-type-group`);
    if (activeGroup) {
        activeGroup.querySelectorAll('.btn-toggle').forEach((b, i) => b.classList.toggle('active', i === 0));
    }

    updateDocEndDateVisibility();
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
    // 휴가신청서 연차/시간차는 사유란 숨김
    const hideReason = currentDocType === 'vacation' && (selectedDocSubType === '연차' || selectedDocSubType === '시간차');
    document.getElementById('doc-reason-group').style.display = hideReason ? 'none' : '';
    if (hideReason) document.getElementById('doc-reason').value = '';
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
['vacation', 'attendance', 'reason'].forEach(type => {
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
        approverList = await api('/api/users/approvers');
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
    const reason = document.getElementById('doc-reason').value.trim();

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

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서' };

        tbody.innerHTML = docs.map(d => {
            const dateStr = d.startDate === d.endDate ? d.startDate : `${d.startDate} ~ ${d.endDate}`;
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
                    const newDate = d.newStartDate === d.newEndDate ? d.newStartDate : `${d.newStartDate} ~ ${d.newEndDate}`;
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

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서' };

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
        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서' };
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
    const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', leave_adjustment: '연차 조정' };

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

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서' };
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

// 기안서류 개별 PDF 다운로드
window.downloadDocPDF = async function(id) {
    try {
        const docs = await api('/api/documents/history?');
        const d = docs.find(doc => doc.id === id);
        if (!d) { alert('문서를 찾을 수 없습니다.'); return; }

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서' };
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

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        const typeLabel = `${typeLabels[d.type] || d.type} - ${d.subType}`;
        const docTitle = d.type === 'vacation' ? '휴가신청서' : d.type === 'attendance' ? '근태신청서' : '시말서';

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
        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서', leave_adjustment: '연차 조정' };
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

    // 대표/부장만 연차 조정 버튼 표시
    const addBtn = document.getElementById('btn-add-leave-adj');
    if (addBtn) {
        addBtn.style.display = (currentUser.position === '부장' || currentUser.position === '대표') ? '' : 'none';
    }

    try {
        const data = await api('/api/leave-adjustments');
        const tbody = document.getElementById('leave-adj-list');
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">연차 조정 내역이 없습니다.</td></tr>';
            return;
        }
        const canAdjust = currentUser.position === '부장' || currentUser.position === '대표';
        tbody.innerHTML = data.map(d => {
            const date = new Date(d.createdAt).toLocaleDateString('ko-KR');
            const adjSign = d.adjustment > 0 ? '+' : '';
            return `<tr>
                <td>${date}</td>
                <td>${d.userPosition ? d.userPosition + ' ' : ''}${d.userName}</td>
                <td style="font-weight:600; color:${d.adjustment > 0 ? '#2563eb' : '#dc2626'};">${adjSign}${d.adjustment}일</td>
                <td>${d.reason}</td>
                <td>${d.adjustedByName}</td>
                <td>${canAdjust ? `<button class="btn-view-items" onclick="deleteLeaveAdj(${d.id})" style="color:#dc2626;">취소</button>` : ''}</td>
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
        await api('/api/leave-adjustments', {
            method: 'POST',
            body: JSON.stringify({ user_id: Number(userId), adjustment, reason })
        });
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
        await api(`/api/leave-adjustments/${id}`, { method: 'DELETE' });
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
            const total = item.companyStock + item.daesongStock;
            return `
                <div class="leave-summary-card">
                    <div class="emp-name">${item.productName}</div>
                    <div class="leave-numbers" style="margin-top:12px;">
                        <div>총주문량<span class="num">${total}</span></div>
                        <div>업체재고<span class="num used ${isAdmin ? 'box-editable' : ''}" ${isAdmin ? `onclick="editBoxStock(${item.id},'company')"` : ''} data-box-id="${item.id}" data-box-field="company">${item.companyStock}</span></div>
                        <div>대성(시온)<span class="num remaining ${isAdmin ? 'box-editable' : ''}" ${isAdmin ? `onclick="editBoxStock(${item.id},'daesong')"` : ''} data-box-id="${item.id}" data-box-field="daesong">${item.daesongStock}</span></div>
                    </div>
                </div>
            `;
        }).join('');

        document.getElementById('box-inventory-save-row').style.display = 'none';
    } catch (err) {
        console.error('renderBoxInventory error:', err);
    }
}

window.editBoxStock = function(id, field) {
    const item = boxInventoryData.find(i => i.id === id);
    if (!item) return;
    const label = field === 'company' ? '업체재고' : '대성(시온)재고';
    const current = field === 'company' ? item.companyStock : item.daesongStock;
    const val = prompt(`${item.productName} - ${label} 수량 입력:`, current);
    if (val === null) return;
    const num = parseInt(val);
    if (isNaN(num) || num < 0) { alert('올바른 숫자를 입력해주세요.'); return; }

    if (field === 'company') item.companyStock = num;
    else item.daesongStock = num;

    // UI 즉시 반영
    const total = item.companyStock + item.daesongStock;
    const card = document.querySelector(`[data-box-id="${id}"][data-box-field="company"]`).closest('.leave-summary-card');
    card.querySelector('.num:first-of-type').textContent = total;
    card.querySelector('[data-box-field="company"]').textContent = item.companyStock;
    card.querySelector('[data-box-field="daesong"]').textContent = item.daesongStock;

    document.getElementById('box-inventory-save-row').style.display = '';
};

window.saveBoxInventory = async function() {
    try {
        for (const item of boxInventoryData) {
            await api(`/api/box-inventory/${item.id}`, 'PUT', {
                companyStock: item.companyStock,
                daesongStock: item.daesongStock
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
    '★추천 선물세트 / 상품 및 과수: 레드향&한라봉&천혜향 3kg(3종세트)',
    '★추천 선물세트 / 상품 및 과수: 레드향&한라봉&천혜향 5kg(3종세트)',
    '★추천 선물세트 / 상품 및 과수: 수라향&한라봉&천혜향 3kg(3종세트)',
    '★추천 선물세트 / 상품 및 과수: 수라향&한라봉&천혜향 5kg(3종세트)',
    '과수 및 크기: 제주 레몬3kg(중대과)',
    '과수 및 크기: 제주 레몬5kg(중대과)',
    '과수 및 크기: 제주 레몬10kg(중대과)',
    '과수 및 크기: 제주 못난이 레몬5kg(랜덤과)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 가정용 - 3kg(중소과 18과 전후)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 가정용 - 5kg(중소과 28과 전후)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 가정용 - 9kg(중과 45과 전후)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 선물용 - 3kg(대과 7~13과)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 선물용 - 5kg(대과 12~22과)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 못난이 - 5kg(랜덤과)',
    '하우스 한라봉 / 상품 및 과수: 한라봉 못난이 - 10kg(랜덤과)',
    '알알톡톡 레드향 / 상품 및 과수: 레드향 가정용 - 3kg(중소과 18과 전후)',
    '알알톡톡 레드향 / 상품 및 과수: 레드향 가정용 - 5kg(중소과 28과 전후)',
    '알알톡톡 레드향 / 상품 및 과수: 레드향 가정용 - 9kg(중과 45과 전후)',
    '알알톡톡 레드향 / 상품 및 과수: 레드향 못난이 - 5kg(랜덤과)',
    '과즙팡팡 천혜향 / 상품 및 과수: 천혜향 선물용 - 3kg(대과 7~13과)',
    '과즙팡팡 천혜향 / 상품 및 과수: 천혜향 선물용 - 5kg(대과 12~22과)',
    '프리미엄 천혜향 / 상품 및 과수: 천혜향 선물용 - 5kg(대과 12~22과)',
    '과즙팡팡 천혜향 / 상품 및 과수: 천혜향 가정용 - 3kg(중소과 15과 전후)',
    '과즙팡팡 천혜향 / 상품 및 과수: 천혜향 가정용 - 5kg(중소과 25과 전후)',
    '과즙팡팡 천혜향 / 상품 및 과수: 천혜향 가정용 - 9kg(중과 45과 전후)',
    '노지 한라봉 / 상품 및 과수: 한라봉 가정용 - 10kg(랜덤과)',
    '노지 한라봉 / 상품 및 과수: 한라봉 가정용 - 5kg(랜덤과)',
    '노지 한라봉 / 상품 및 과수: 한라봉 못난이 - 5kg(랜덤과)',
    '노지 한라봉 / 상품 및 과수: 한라봉 못난이 - 10kg(랜덤과)',
    '제주자몽 / 상품 및 과수: 제주자몽 가정용 3kg(10과전후)',
    '제주자몽 / 상품 및 과수: 제주자몽 가정용 5kg(17과전후)',
    '제주자몽 / 상품 및 과수: 제주자몽 선물용 3kg(10과전후)',
    '제주자몽 / 상품 및 과수: 제주자몽 선물용 5kg(17과전후)',
    '고당도 비가림귤 / 상품 및 과수: 로얄과 - 3kg(가정용 2S~M)',
    '고당도 비가림귤 / 상품 및 과수: 로얄과 - 5kg(가정용 2S~M)',
    '고당도 비가림귤 / 상품 및 과수: 프리미엄 로얄과 - 3kg(선물용 2S~M)',
    '고당도 비가림귤 / 상품 및 과수: 중대과 - 5kg(가정용 L이상)',
    '프리미엄 선물용 / 상품 및 과수: 프리미엄 선물용 레드향 - 2kg',
    '프리미엄 선물용 / 상품 및 과수: 프리미엄 선물용 한라봉 - 2kg',
    '프리미엄 선물용 / 상품 및 과수: 프리미엄 선물용 천혜향 - 2kg',
    '블러드오렌지 / 상품 및 과수: 블러드오렌지 가정용 5kg(랜덤과)',
    '블러드오렌지 / 상품 및 과수: 블러드오렌지 가정용 3kg(랜덤과)',
    '살살녹는 수라향 / 상품 및 과수: 수라향 선물용 - 5kg(중대과 15~25과)',
    '살살녹는 수라향 / 상품 및 과수: 수라향 선물용 - 3kg(중대과 10~16과)',
    '살살녹는 수라향 / 상품 및 과수: 수라향 가정용 - 5kg(랜덤과)',
    '살살녹는 수라향 / 상품 및 과수: 수라향 가정용 - 3kg(랜덤과)',
    '살살녹는 수라향 / 상품 및 과수: 수라향 못난이 - 5kg(랜덤과)',
    '고당도 비가림귤 / 상품 및 과수: 소과 - 5kg(가정용 2S미만)',
    '과즙팡팡 천혜향 / 상품 및 과수: 꼬마 천혜향 가정용 - 5kg(30과 전후)',
    '과즙팡팡 천혜향 / 상품 및 과수: 꼬마 천혜향 가정용 - 9kg(55과 전후)',
    '하우스 한라봉 / 상품 및 과수: 꼬마 한라봉 - 5kg(30과 전후)',
    '하우스 한라봉 / 상품 및 과수: 꼬마 한라봉 - 9kg(54과 전후)',
    '제주 하귤 / 상품 및 과수: 하귤 가정용 4.5kg(랜덤과)',
    '제주 하귤 / 상품 및 과수: 하귤 가정용 9kg(랜덤과)',
    '새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - 3kg(24과 전후)',
    '새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - 5kg(40과 전후)',
    '새콤달콤 카라향 / 상품 및 과수: 카라향 선물용 - 2kg(10~17과)',
]);

// 상품 카탈로그 매칭
function matchProduct(rawText) {
    const t = rawText || '';
    const wm = t.match(/(\d+\.?\d*)\s*kg/i);
    if (!wm) return '[미매칭] ' + t.trim();
    const w = parseFloat(wm[1]);
    const wStr = w + 'kg';

    let result = null;

    if (/수라향.*한라봉.*천혜향|한라봉.*천혜향.*수라향|수라향.*천혜향.*한라봉/.test(t)) {
        result = '★추천 선물세트 / 상품 및 과수: 수라향&한라봉&천혜향 ' + wStr + '(3종세트)';
    } else if (/3종세트|레드향.*한라봉.*천혜향|한라봉.*천혜향.*레드향/.test(t)) {
        result = '★추천 선물세트 / 상품 및 과수: 레드향&한라봉&천혜향 ' + wStr + '(3종세트)';
    } else if (/블러드오렌지|블러드\s*오렌지/.test(t)) {
        result = '블러드오렌지 / 상품 및 과수: 블러드오렌지 가정용 ' + wStr + '(랜덤과)';
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
        else result = '과수 및 크기: 제주 레몬' + wStr + '(중대과)';
    } else if (/비가림|감귤/.test(t)) {
        if (/소과|2S미만/.test(t)) result = '고당도 비가림귤 / 상품 및 과수: 소과 - ' + wStr + '(가정용 2S미만)';
        else if (/선물용|프리미엄\s*로얄/.test(t)) result = '고당도 비가림귤 / 상품 및 과수: 프리미엄 로얄과 - ' + wStr + '(선물용 2S~M)';
        else if (/중대과|[lL]이상|대과/.test(t)) result = '고당도 비가림귤 / 상품 및 과수: 중대과 - ' + wStr + '(가정용 L이상)';
        else result = '고당도 비가림귤 / 상품 및 과수: 로얄과 - ' + wStr + '(가정용 2S~M)';
    } else if (/자몽/.test(t)) {
        const type = /선물/.test(t) ? '선물용' : '가정용';
        const detail = w === 3 ? '10과전후' : w === 5 ? '17과전후' : '';
        result = '제주자몽 / 상품 및 과수: 제주자몽 ' + type + ' ' + wStr + '(' + detail + ')';
    } else if (/카라향/.test(t)) {
        if (/선물/.test(t)) {
            result = '새콤달콤 카라향 / 상품 및 과수: 카라향 선물용 - ' + wStr + '(10~17과)';
        } else {
            const detail = w === 3 ? '24과 전후' : w === 5 ? '40과 전후' : '';
            result = '새콤달콤 카라향 / 상품 및 과수: 카라향 가정용 - ' + wStr + '(' + detail + ')';
        }
    } else if (/하귤/.test(t)) {
        result = '제주 하귤 / 상품 및 과수: 하귤 가정용 ' + wStr + '(랜덤과)';
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
                else detail = w === 3 ? '중소과 18과 전후' : w === 5 ? '중소과 28과 전후' : '';
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
        cols.forEach(col => {
            const ref = col + r;
            let style = dStyle;
            if (isUnmatched && col === 'E') style = dRed;
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
// 점심메뉴
// =============================================

let lunchRestaurants = [];
let lunchSession = null;
let lunchVotes = [];
let lunchMyVote = null;

async function renderLunchPage() {
    const adminCard = document.getElementById('lunch-admin-card');
    if (adminCard) adminCard.style.display = '';

    try {
        const data = await api('/api/lunch/today');
        lunchRestaurants = data.restaurants || [];
        lunchSession = data.session;
        lunchVotes = data.votes || [];
        lunchMyVote = data.myVote;

        renderLunchVoteGrid();
        renderLunchVoteResult(lunchVotes);
    } catch (err) {
        console.error('점심메뉴 로드 오류:', err);
    }

    loadLadderMembers().catch(console.error);
    renderLunchAdminPanel().catch(console.error);
}

// 사다리 게임
let ladderAllUsers = [];
let ladderPlayers = [];
let ladderGameData = null; // 생성된 사다리 데이터 저장

async function loadLadderMembers() {
    try {
        ladderAllUsers = await api('/api/users/names');
        renderLadderSelect();
        renderLadderChips();
    } catch (err) {
        console.error('사다리 멤버 로드 오류:', err);
    }
}

function renderLadderSelect() {
    const select = document.getElementById('ladder-user-select');
    if (!select) return;
    const addedIds = new Set(ladderPlayers.map(p => p.id));
    select.innerHTML = '<option value="">-- 멤버 선택 --</option>' +
        ladderAllUsers.filter(u => !addedIds.has(u.id))
            .map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}

function renderLadderChips() {
    const container = document.getElementById('ladder-members');
    if (!container) return;
    if (ladderPlayers.length === 0) {
        container.innerHTML = '<p style="color:#9ca3af; font-size:13px;">멤버를 추가해주세요 (2명 이상)</p>';
        return;
    }
    container.innerHTML = ladderPlayers.map(p =>
        `<div class="ladder-member-chip selected">
            <span class="chip-dot" style="background:${p.color}"></span>${p.name}
            <button style="background:none;border:none;cursor:pointer;font-size:16px;color:#94a3b8;margin-left:4px;padding:0;" onclick="removeLadderMember(${p.id})">&times;</button>
        </div>`
    ).join('');
}

window.addLadderMember = function() {
    const select = document.getElementById('ladder-user-select');
    const id = Number(select.value);
    if (!id) return alert('멤버를 선택해주세요.');
    const user = ladderAllUsers.find(u => u.id === id);
    if (!user || ladderPlayers.find(p => p.id === id)) return;
    ladderPlayers.push(user);
    renderLadderSelect();
    renderLadderChips();
};

window.removeLadderMember = function(id) {
    ladderPlayers = ladderPlayers.filter(p => p.id !== id);
    renderLadderSelect();
    renderLadderChips();
};

window.resetLadderGame = function() {
    ladderPlayers = [];
    ladderGameData = null;
    document.getElementById('ladder-canvas-wrap').style.display = 'none';
    document.getElementById('ladder-result').style.display = 'none';
    const cover = document.getElementById('ladder-cover');
    if (cover) cover.classList.remove('revealed');
    renderLadderSelect();
    renderLadderChips();
};

window.revealLadder = function() {
    const cover = document.getElementById('ladder-cover');
    if (cover) cover.classList.add('revealed');
    // 애니메이션 시작
    if (ladderGameData) runLadderAnimation(ladderGameData);
};

window.startLadderGame = function() {
    if (ladderPlayers.length < 2) return alert('2명 이상 추가해주세요.');

    document.getElementById('ladder-result').style.display = 'none';
    const cover = document.getElementById('ladder-cover');
    if (cover) cover.classList.remove('revealed');

    const wrap = document.getElementById('ladder-canvas-wrap');
    wrap.style.display = '';

    const canvas = document.getElementById('ladder-canvas');
    const ctx = canvas.getContext('2d');
    const players = [...ladderPlayers];
    const n = players.length;

    const canvasWidth = Math.max(350, n * 80);
    canvas.width = canvasWidth;
    canvas.height = 380;

    const padX = 40;
    const topY = 50;
    const botY = 340;
    const gap = n > 1 ? (canvasWidth - padX * 2) / (n - 1) : 0;

    // 가로선 생성
    const rungs = [];
    const rungRows = 8;
    const rowH = (botY - topY) / (rungRows + 1);
    for (let r = 1; r <= rungRows; r++) {
        const y = topY + r * rowH;
        for (let i = 0; i < n - 1; i++) {
            if (Math.random() < 0.5) {
                if (rungs.length > 0) {
                    const last = rungs[rungs.length - 1];
                    if (last.y === y && last.col === i - 1) continue;
                }
                rungs.push({ col: i, y });
            }
        }
    }

    const winnerCol = Math.floor(Math.random() * n);

    function tracePath(startCol) {
        let col = startCol;
        const path = [{ x: padX + col * gap, y: topY }];
        const sortedRungs = [...rungs].sort((a, b) => a.y - b.y);
        for (const rung of sortedRungs) {
            if (rung.col === col) {
                path.push({ x: padX + col * gap, y: rung.y });
                col++;
                path.push({ x: padX + col * gap, y: rung.y });
            } else if (rung.col === col - 1) {
                path.push({ x: padX + col * gap, y: rung.y });
                col--;
                path.push({ x: padX + col * gap, y: rung.y });
            }
        }
        path.push({ x: padX + col * gap, y: botY });
        return { path, endCol: col };
    }

    const paths = players.map((_, i) => tracePath(i));
    const winnerStartIdx = paths.findIndex(p => p.endCol === winnerCol);

    // 사다리 데이터 저장
    ladderGameData = { players, n, canvasWidth, padX, topY, botY, gap, rungs, winnerCol, paths, winnerStartIdx };

    // 초기 그리기 (이름 + 세로선 + 하단 결과만, 가로선은 커버로 가림)
    drawLadderBase(ladderGameData);
};

function drawLadderBase(data) {
    const { players, n, padX, topY, botY, gap, rungs, winnerCol } = data;
    const canvas = document.getElementById('ladder-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 세로선
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    for (let i = 0; i < n; i++) {
        const x = padX + i * gap;
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, botY);
        ctx.stroke();
    }

    // 가로선
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.5;
    for (const rung of rungs) {
        const x1 = padX + rung.col * gap;
        const x2 = padX + (rung.col + 1) * gap;
        ctx.beginPath();
        ctx.moveTo(x1, rung.y);
        ctx.lineTo(x2, rung.y);
        ctx.stroke();
    }

    // 이름 (상단)
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#334155';
    players.forEach((p, i) => {
        ctx.fillText(p.name, padX + i * gap, topY - 12);
    });

    // 하단 결과
    for (let i = 0; i < n; i++) {
        const x = padX + i * gap;
        if (i === winnerCol) {
            ctx.fillStyle = '#dc2626';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText('당첨!', x, botY + 28);
        } else {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '13px sans-serif';
            ctx.fillText('꽝', x, botY + 25);
        }
    }
}

function runLadderAnimation(data) {
    const { players, winnerStartIdx, paths } = data;
    const canvas = document.getElementById('ladder-canvas');
    const ctx = canvas.getContext('2d');

    const winnerPath = paths[winnerStartIdx].path;
    const segLengths = [];
    let totalSteps = 0;
    for (let i = 1; i < winnerPath.length; i++) {
        const dx = winnerPath[i].x - winnerPath[i - 1].x;
        const dy = winnerPath[i].y - winnerPath[i - 1].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segLengths.push(len);
        totalSteps += len;
    }

    const animDuration = 2000;
    let animStart = null;

    function animate(timestamp) {
        if (!animStart) animStart = timestamp;
        const progress = Math.min((timestamp - animStart) / animDuration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const targetDist = eased * totalSteps;

        drawLadderBase(data);

        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(winnerPath[0].x, winnerPath[0].y);

        let dist = 0;
        for (let i = 0; i < segLengths.length; i++) {
            if (dist + segLengths[i] <= targetDist) {
                ctx.lineTo(winnerPath[i + 1].x, winnerPath[i + 1].y);
                dist += segLengths[i];
            } else {
                const remain = targetDist - dist;
                const ratio = remain / segLengths[i];
                const x = winnerPath[i].x + (winnerPath[i + 1].x - winnerPath[i].x) * ratio;
                const y = winnerPath[i].y + (winnerPath[i + 1].y - winnerPath[i].y) * ratio;
                ctx.lineTo(x, y);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.fillStyle = '#f59e0b';
                ctx.fill();
                break;
            }
        }
        ctx.stroke();

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            const winner = players[winnerStartIdx];
            const resultEl = document.getElementById('ladder-result');
            resultEl.style.display = '';
            resultEl.innerHTML = `
                <div class="ladder-result-card">
                    <div class="ladder-result-emoji">🎉</div>
                    <div class="ladder-result-label">오늘의 주인공은...</div>
                    <div class="ladder-result-name">${winner.name}</div>
                    <p style="margin-top:8px; color:#92400e; font-size:14px;">축하합니다! 오늘 밥값은 ${winner.name}님이 쏩니다! 🍚</p>
                </div>
            `;
        }
    }

    requestAnimationFrame(animate);
}

async function handleLunchRandom() {
    if (lunchRestaurants.length === 0) {
        alert('등록된 식당이 없습니다');
        return;
    }
    document.getElementById('lunch-random-empty').style.display = 'none';
    document.getElementById('lunch-random-result').style.display = 'none';

    runRouletteAnimation(lunchRestaurants, (winner) => {
        document.getElementById('lunch-random-name').textContent = winner;
        document.getElementById('lunch-random-result').style.display = '';
    });
}
window.handleLunchRandom = handleLunchRandom;

window.resetLunchRandom = function() {
    document.getElementById('lunch-random-result').style.display = 'none';
    document.getElementById('lunch-slot-area').style.display = 'none';
    document.getElementById('lunch-random-empty').style.display = '';
};

function runRouletteAnimation(restaurants, callback) {
    const slotArea = document.getElementById('lunch-slot-area');
    const reel = document.getElementById('lunch-slot-reel');
    slotArea.style.display = '';

    const names = restaurants.map(r => r.name);
    const winnerIdx = Math.floor(Math.random() * names.length);
    const winner = names[winnerIdx];

    const spinItems = [];
    for (let i = 0; i < 25; i++) {
        spinItems.push(names[Math.floor(Math.random() * names.length)]);
    }
    spinItems.push(winner);

    reel.innerHTML = spinItems.map(n => `<div class="lunch-slot-item">${n}</div>`).join('');
    reel.style.transition = 'none';
    reel.style.transform = 'translateY(0)';

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const itemH = 60;
            const target = -(spinItems.length - 1) * itemH;
            reel.style.transition = 'transform 3s cubic-bezier(0.15, 0.85, 0.35, 1)';
            reel.style.transform = `translateY(${target}px)`;
        });
    });

    setTimeout(() => {
        slotArea.style.display = 'none';
        callback(winner);
    }, 3300);
}

function renderLunchVoteGrid() {
    const container = document.getElementById('lunch-vote-grid');
    const emptyEl = document.getElementById('lunch-vote-empty');

    if (!lunchRestaurants || lunchRestaurants.length === 0) {
        container.innerHTML = '';
        emptyEl.style.display = '';
        return;
    }
    emptyEl.style.display = 'none';

    const voteCounts = {};
    lunchVotes.forEach(v => { voteCounts[v.menu_name] = (voteCounts[v.menu_name] || 0) + 1; });
    const maxVotes = Math.max(0, ...Object.values(voteCounts));

    const totalVotes = lunchVotes.length;
    const statusEl = document.getElementById('lunch-vote-status');
    statusEl.textContent = totalVotes > 0 ? `총 ${totalVotes}명 투표` : '아직 투표가 없습니다';

    container.innerHTML = lunchRestaurants.map(r => {
        const count = voteCounts[r.name] || 0;
        const isMyVote = lunchMyVote === r.name;
        const isWinner = maxVotes > 0 && count === maxVotes;

        return `<div class="lunch-vote-item ${isMyVote ? 'voted' : ''} ${isWinner ? 'winner' : ''}"
                     onclick="voteLunchMenu('${r.name.replace(/'/g, "\\'")}')">
                    ${isWinner && count > 0 ? '<span class="lunch-vote-item-crown">👑</span>' : ''}
                    <div class="lunch-vote-item-name">${r.name}</div>
                    <div class="lunch-vote-item-count">${count > 0 ? count + '표' : '투표하기'}</div>
                </div>`;
    }).join('');
}

function renderLunchVoteResult(votes) {
    const container = document.getElementById('lunch-vote-result');
    if (!votes || votes.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';

    const voteCounts = {};
    const voters = {};
    votes.forEach(v => {
        voteCounts[v.menu_name] = (voteCounts[v.menu_name] || 0) + 1;
        if (!voters[v.menu_name]) voters[v.menu_name] = [];
        voters[v.menu_name].push({ name: v.user_name, color: v.user_color });
    });

    const sorted = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
    const maxV = sorted[0][1];

    container.innerHTML = `
        <h3 style="margin:20px 0 12px; font-size:16px;">📊 투표 현황</h3>
        ${sorted.map(([name, count]) => `
            <div class="lunch-vote-row">
                <span class="lunch-vote-name">${name}</span>
                <div class="lunch-vote-bar-wrap">
                    <div class="lunch-vote-bar" style="width:${(count / maxV) * 100}%"></div>
                </div>
                <span class="lunch-vote-count">${count}표</span>
                <div class="lunch-vote-voters">
                    ${voters[name].map(v => `<span class="lunch-voter-dot" style="background:${v.color}" title="${v.name}"></span>`).join('')}
                </div>
            </div>
        `).join('')}
    `;
}

async function voteLunchMenu(name) {
    try {
        const data = await api('/api/lunch/vote', 'POST', { menuName: name });
        lunchVotes = data.votes;
        lunchMyVote = data.myVote;
        if (!lunchSession) {
            const todayData = await api('/api/lunch/today');
            lunchSession = todayData.session;
            lunchRestaurants = todayData.restaurants || lunchRestaurants;
        }
        renderLunchVoteGrid();
        renderLunchVoteResult(lunchVotes);
    } catch (err) {
        alert(err.message || '투표 실패');
    }
}
window.voteLunchMenu = voteLunchMenu;

async function renderLunchAdminPanel() {
    try {
        const menus = await api('/api/lunch/menus');
        const container = document.getElementById('lunch-restaurant-list');
        if (!menus || menus.length === 0) {
            container.innerHTML = '<p style="color:#9ca3af;">등록된 식당이 없습니다.</p>';
            return;
        }
        container.innerHTML = menus.map(m => `
            <div class="lunch-restaurant-tag">
                <span>${m.name}</span>
                <button class="btn-tag-delete" onclick="deleteLunchMenu(${m.id})" title="삭제">&times;</button>
            </div>
        `).join('');
    } catch (err) {
        console.error('식당 목록 오류:', err);
    }
}

async function addLunchRestaurant() {
    const name = document.getElementById('lunch-restaurant-name').value.trim();
    if (!name) return alert('식당 이름을 입력하세요');
    try {
        await api('/api/lunch/menus', 'POST', { name });
        document.getElementById('lunch-restaurant-name').value = '';
        await renderLunchAdminPanel();
        const data = await api('/api/lunch/today');
        lunchRestaurants = data.restaurants || [];
        renderLunchVoteGrid();
    } catch (err) {
        alert(err.message || '추가 실패');
    }
}
window.addLunchRestaurant = addLunchRestaurant;

async function deleteLunchMenu(id) {
    if (!confirm('이 식당을 삭제하시겠습니까?')) return;
    try {
        await api(`/api/lunch/menus/${id}`, 'DELETE');
        await renderLunchAdminPanel();
        const data = await api('/api/lunch/today');
        lunchRestaurants = data.restaurants || [];
        renderLunchVoteGrid();
    } catch (err) {
        alert(err.message || '삭제 실패');
    }
}
window.deleteLunchMenu = deleteLunchMenu;

async function resetLunchVotes() {
    if (!confirm('오늘의 투표 결과를 초기화하시겠습니까?')) return;
    try {
        await api('/api/lunch/today', 'DELETE');
        lunchSession = null;
        lunchVotes = [];
        lunchMyVote = null;
        document.getElementById('lunch-random-result').style.display = 'none';
        document.getElementById('lunch-random-empty').style.display = '';
        renderLunchVoteGrid();
        renderLunchVoteResult([]);
    } catch (err) {
        alert(err.message || '초기화 실패');
    }
}
window.resetLunchVotes = resetLunchVotes;

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
            tbody.innerHTML = '<tr class="empty-row"><td colspan="5">선결제 내역이 없습니다.</td></tr>';
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

document.getElementById('prepay-save').addEventListener('click', async () => {
    const partner = document.getElementById('prepay-partner').value;
    const amount = Number(document.getElementById('prepay-amount').value);
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
        alert('선결제이 추가되었습니다.');
    } catch (err) {
        alert('추가 실패: ' + err.message);
    }
});

window.deletePrepayment = async function(id) {
    if (!confirm('이 선결제 내역을 삭제하시겠습니까?')) return;
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
            let daesungTotal = 0, hyodonTotal = 0, cjTotal = 0;

            // CJ 일별 금액을 날짜별로 모아서 결제완료 여부 확인
            const cjByDate = {};

            settlements.forEach(s => {
                if (s.date >= week.start && s.date <= week.end) {
                    if (s.partner === '대성(시온)') {
                        if (!s.isPaid) daesungTotal += (s.amount || 0);
                        const items = s.items || [];
                        const cjCost = items.reduce((sum, item) => sum + (item.qty || 0), 0) * 3100;
                        if (!cjByDate[s.date]) cjByDate[s.date] = 0;
                        cjByDate[s.date] += cjCost;
                    }
                    if (s.partner === '효돈농협') {
                        if (!s.isPaid) hyodonTotal += (s.amount || 0);
                        const items = s.items || [];
                        const cjCost = items.reduce((sum, item) => sum + (item.qty || 0), 0) * 3100;
                        if (!cjByDate[s.date]) cjByDate[s.date] = 0;
                        cjByDate[s.date] += cjCost;
                    }
                }
            });

            // CJ: 결제완료 안 된 날짜 금액만 합산
            Object.keys(cjByDate).forEach(date => {
                if (!weeklyCjPaidMap[date]) {
                    cjTotal += cjByDate[date];
                }
            });

            // 해당 주차 선결제 합계
            let weekPrepay = 0;
            prepayments.forEach(p => {
                if (p.date >= week.start && p.date <= week.end) {
                    weekPrepay += (p.amount || 0);
                }
            });

            const weekTotal = daesungTotal + hyodonTotal + cjTotal - weekPrepay;

            // 날짜 라벨: M/D 형태
            const sDate = new Date(week.start + 'T00:00:00');
            const eDate = new Date(week.end + 'T00:00:00');
            const startLabel = `${sDate.getMonth() + 1}/${sDate.getDate()}`;
            const endLabel = `${eDate.getMonth() + 1}/${eDate.getDate()}`;
            const weekLabel = `${idx + 1}주차<br><span style="font-size:11px; color:#6b7280;">${startLabel} ~ ${endLabel}</span>`;

            html += `<tr>
                <td>${weekLabel}</td>
                <td>${daesungTotal > 0 ? daesungTotal.toLocaleString() + ' 원' : '-'}</td>
                <td>${hyodonTotal > 0 ? hyodonTotal.toLocaleString() + ' 원' : '-'}</td>
                <td>${cjTotal > 0 ? cjTotal.toLocaleString() + ' 원' : '-'}</td>
                <td>${weekPrepay > 0 ? '<span style="color:#8b5cf6;">-' + weekPrepay.toLocaleString() + ' 원</span>' : '-'}</td>
                <td><strong>${weekTotal !== 0 ? weekTotal.toLocaleString() + ' 원' : '-'}</strong></td>
            </tr>`;
        });

        tbody.innerHTML = html;
    } catch (err) {
        console.error('주간 정산 현황 오류:', err);
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">로드 실패</td></tr>';
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

// =============================================
// AI 작업방
// =============================================

let aiCurrentConvId = null;

function showAIChatEmpty() {
    const container = document.getElementById('ai-chat-messages');
    container.innerHTML = `
        <div class="ai-chat-empty">
            <div style="font-size:48px; margin-bottom:16px;">🤖</div>
            <p>새 대화를 시작하거나 기존 대화를 선택하세요</p>
            <p style="font-size:13px; color:#999; margin-top:8px;">마케팅 문구, 홍보 콘텐츠 등을 요청해보세요</p>
        </div>
    `;
    document.getElementById('ai-input-area').style.display = 'none';
}

async function renderAIWorkspace() {
    try {
        const convs = await api('/api/ai/conversations');
        const listEl = document.getElementById('ai-conv-list');
        if (!convs || convs.length === 0) {
            listEl.innerHTML = '<p style="color:#adb5bd; font-size:13px; text-align:center; padding:20px 0;">대화가 없습니다</p>';
            if (aiCurrentConvId) {
                aiCurrentConvId = null;
                showAIChatEmpty();
            }
        } else {
            listEl.innerHTML = convs.map(c => {
                const isOwner = currentUser && (c.user_id === currentUser.id || currentUser.role === 'admin');
                return `
                <div class="ai-conv-item ${aiCurrentConvId === c.id ? 'active' : ''}" onclick="loadConversation(${c.id})">
                    <div class="ai-conv-item-info">
                        <span class="ai-conv-item-title">${c.title}</span>
                        <span class="ai-conv-item-author">${c.user_name}</span>
                    </div>
                    <div class="ai-conv-item-actions">
                        ${isOwner ? `<button class="ai-conv-item-edit" onclick="event.stopPropagation(); renameConversation(${c.id}, '${c.title.replace(/'/g, "\\'")}')" title="이름 수정">✏️</button>` : ''}
                        ${isOwner ? `<button class="ai-conv-item-delete" onclick="event.stopPropagation(); deleteConversation(${c.id})" title="삭제">&times;</button>` : ''}
                    </div>
                </div>`;
            }).join('');
        }
    } catch (err) {
        console.error('AI 작업방 로드 오류:', err);
    }
}

function createNewConversation() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal" style="max-width:400px;">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3>새 작업방 만들기</h3>
            <div class="form-group" style="margin-top:16px;">
                <label>작업방 이름</label>
                <input type="text" id="new-conv-title" class="form-input" placeholder="예: 문구지시방, 이미지작업" autofocus>
            </div>
            <div style="display:flex; gap:8px; margin-top:16px;">
                <button class="btn-primary" style="flex:1;" id="new-conv-create-btn">만들기</button>
                <button class="btn-outline" style="flex:1;" onclick="this.closest('.modal-overlay').remove()">취소</button>
            </div>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const titleInput = overlay.querySelector('#new-conv-title');
    titleInput.focus();

    async function doCreate() {
        const title = titleInput.value.trim();
        if (!title) return alert('작업방 이름을 입력해주세요.');
        try {
            const conv = await api('/api/ai/conversations', 'POST', { title });
            aiCurrentConvId = conv.id;
            document.getElementById('ai-chat-messages').innerHTML = '';
            document.getElementById('ai-input-area').style.display = '';
            document.getElementById('ai-message-input').value = '';
            document.getElementById('ai-message-input').focus();
            overlay.remove();
            await renderAIWorkspace();
        } catch (err) {
            alert(err.message || '대화 생성 실패');
        }
    }

    overlay.querySelector('#new-conv-create-btn').addEventListener('click', doCreate);
    titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
}
window.createNewConversation = createNewConversation;

async function loadConversation(id) {
    try {
        aiCurrentConvId = id;
        const data = await api(`/api/ai/conversations/${id}`);
        document.getElementById('ai-input-area').style.display = '';
        renderAIMessages(data.messages);

        // 대화 목록에서 active 표시 업데이트
        document.getElementById('ai-conv-list').querySelectorAll('.ai-conv-item').forEach(el => {
            const isActive = el.getAttribute('onclick')?.includes(`(${id})`);
            el.classList.toggle('active', isActive);
        });
    } catch (err) {
        alert(err.message || '대화 로드 실패');
    }
}
window.loadConversation = loadConversation;

function renderAIMessages(messages) {
    const container = document.getElementById('ai-chat-messages');
    if (!messages || messages.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = messages.map(m => {
        let bubbleContent;
        if (m.message_type === 'image' && m.role === 'assistant') {
            try {
                const imgData = JSON.parse(m.content);
                bubbleContent = `<div class="ai-message-bubble ai-image-bubble">
                    <img src="${escapeHtml(imgData.url)}" alt="생성된 이미지" class="ai-generated-image" onclick="window.open(this.src,'_blank')" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <div class="ai-image-expired" style="display:none;">이미지가 만료되었습니다</div>
                    ${imgData.revised_prompt ? `<div class="ai-image-prompt">${escapeHtml(imgData.revised_prompt)}</div>` : ''}
                </div>`;
            } catch (e) {
                bubbleContent = `<div class="ai-message-bubble ai-image-bubble">
                    <img src="${escapeHtml(m.content)}" alt="생성된 이미지" class="ai-generated-image" onclick="window.open(this.src,'_blank')" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <div class="ai-image-expired" style="display:none;">이미지가 만료되었습니다</div>
                </div>`;
            }
        } else {
            bubbleContent = `<div class="ai-message-bubble">${escapeHtml(m.content)}</div>`;
        }
        const senderName = m.role === 'user' ? (m.sender_name || '사용자') : 'AI';
        return `<div class="ai-message ${m.role}">
            <div class="ai-message-sender">${senderName}</div>
            ${bubbleContent}
        </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// === 이미지 첨부 관련 ===
let aiAttachedImage = null; // { base64, mimeType, name }

function handleImageAttach(event) {
    const file = event.target.files[0];
    if (!file) return;
    processAttachedFile(file);
    event.target.value = '';
}
window.handleImageAttach = handleImageAttach;

function processAttachedFile(file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        alert('지원하지 않는 이미지 형식입니다.\n(jpg, png, gif, webp만 가능)');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        alert('파일 크기가 10MB를 초과합니다.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const base64Full = e.target.result;
        const base64Data = base64Full.split(',')[1];
        aiAttachedImage = { base64: base64Data, mimeType: file.type, name: file.name };

        const preview = document.getElementById('ai-image-preview');
        const previewImg = document.getElementById('ai-preview-img');
        previewImg.src = base64Full;
        preview.style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

function removeAttachedImage() {
    aiAttachedImage = null;
    const preview = document.getElementById('ai-image-preview');
    if (preview) preview.style.display = 'none';
    document.getElementById('ai-file-input').value = '';
}
window.removeAttachedImage = removeAttachedImage;

async function sendAIMessage() {
    const input = document.getElementById('ai-message-input');
    const sendBtn = document.getElementById('ai-send-btn');
    const message = input.value.trim();
    const hasImage = !!aiAttachedImage;
    if (!message && !hasImage) return;
    if (!aiCurrentConvId) return;

    const displayMessage = hasImage ? `📎 ${message || '이미지 분석 요청'}` : message;
    const imageForSend = hasImage ? { ...aiAttachedImage } : null;

    // 사용자 메시지 즉시 표시
    const container = document.getElementById('ai-chat-messages');
    let userBubble = '';
    if (hasImage) {
        userBubble = `<div class="ai-message-bubble">
            <img src="data:${imageForSend.mimeType};base64,${imageForSend.base64}" alt="첨부 이미지" style="max-width:200px; max-height:150px; border-radius:8px; display:block; margin-bottom:6px;">
            ${message ? escapeHtml(message) : '<span style="color:#868e96;">이미지 분석 요청</span>'}
        </div>`;
    } else {
        userBubble = `<div class="ai-message-bubble">${escapeHtml(message)}</div>`;
    }
    container.innerHTML += `
        <div class="ai-message user">
            <div class="ai-message-sender">${currentUser?.name || '나'}</div>
            ${userBubble}
        </div>
    `;
    input.value = '';
    input.style.height = 'auto';
    removeAttachedImage();

    // 로딩 표시
    container.innerHTML += `
        <div class="ai-typing" id="ai-typing-indicator">
            <div class="ai-typing-dot"></div>
            <div class="ai-typing-dot"></div>
            <div class="ai-typing-dot"></div>
            ${hasImage ? '<span style="margin-left:8px; font-size:12px; color:#868e96;">이미지 분석 중...</span>' : ''}
        </div>
    `;
    container.scrollTop = container.scrollHeight;

    sendBtn.disabled = true;
    input.disabled = true;

    try {
        const body = { conversationId: aiCurrentConvId, message: message || '' };
        if (imageForSend) {
            body.image = imageForSend.base64;
            body.imageMimeType = imageForSend.mimeType;
        }
        const data = await api('/api/ai/chat', 'POST', body);

        // 로딩 제거
        const typing = document.getElementById('ai-typing-indicator');
        if (typing) typing.remove();

        // AI 응답 표시
        container.innerHTML += `
            <div class="ai-message assistant">
                <div class="ai-message-sender">AI</div>
                <div class="ai-message-bubble">${escapeHtml(data.reply)}</div>
            </div>
        `;
        container.scrollTop = container.scrollHeight;

        // 대화 목록 갱신 (제목이 업데이트되었을 수 있음)
        renderAIWorkspace();
    } catch (err) {
        const typing = document.getElementById('ai-typing-indicator');
        if (typing) typing.remove();
        container.innerHTML += `
            <div class="ai-message assistant">
                <div class="ai-message-sender">AI</div>
                <div class="ai-message-bubble" style="color:var(--danger);">오류: ${err.message || 'AI 응답 생성에 실패했습니다'}</div>
            </div>
        `;
        container.scrollTop = container.scrollHeight;
    } finally {
        sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
    }
}
window.sendAIMessage = sendAIMessage;

async function sendAIImage() {
    const input = document.getElementById('ai-message-input');
    const sendBtn = document.getElementById('ai-send-btn');
    const imageBtn = document.getElementById('ai-image-btn');
    const prompt = input.value.trim();
    if (!prompt || !aiCurrentConvId) return;

    const hasImage = !!aiAttachedImage;
    const imageForSend = hasImage ? { ...aiAttachedImage } : null;

    // 사용자 메시지 표시
    const container = document.getElementById('ai-chat-messages');
    let userBubble = '';
    if (hasImage) {
        userBubble = `<div class="ai-message-bubble">
            <img src="data:${imageForSend.mimeType};base64,${imageForSend.base64}" alt="참고 이미지" style="max-width:200px; max-height:150px; border-radius:8px; display:block; margin-bottom:6px;">
            🎨 ${escapeHtml(prompt)}
        </div>`;
    } else {
        userBubble = `<div class="ai-message-bubble">🎨 ${escapeHtml(prompt)}</div>`;
    }
    container.innerHTML += `
        <div class="ai-message user">
            <div class="ai-message-sender">${currentUser?.name || '나'}</div>
            ${userBubble}
        </div>
    `;
    input.value = '';
    input.style.height = 'auto';
    removeAttachedImage();

    container.innerHTML += `
        <div class="ai-typing" id="ai-typing-indicator">
            <div class="ai-typing-dot"></div>
            <div class="ai-typing-dot"></div>
            <div class="ai-typing-dot"></div>
            <span style="margin-left:8px; font-size:12px; color:#868e96;">이미지 생성 중...</span>
        </div>
    `;
    container.scrollTop = container.scrollHeight;

    sendBtn.disabled = true;
    imageBtn.disabled = true;
    input.disabled = true;

    try {
        const body = { conversationId: aiCurrentConvId, prompt: prompt };
        if (imageForSend) {
            body.referenceImage = imageForSend.base64;
            body.referenceImageMimeType = imageForSend.mimeType;
        }
        const data = await api('/api/ai/image', 'POST', body);

        const typing = document.getElementById('ai-typing-indicator');
        if (typing) typing.remove();

        container.innerHTML += `
            <div class="ai-message assistant">
                <div class="ai-message-sender">AI</div>
                <div class="ai-message-bubble ai-image-bubble">
                    <img src="${escapeHtml(data.imageUrl)}" alt="생성된 이미지" class="ai-generated-image" onclick="window.open(this.src,'_blank')" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <div class="ai-image-expired" style="display:none;">이미지가 만료되었습니다</div>
                    ${data.revisedPrompt ? `<div class="ai-image-prompt">${escapeHtml(data.revisedPrompt)}</div>` : ''}
                </div>
            </div>
        `;
        container.scrollTop = container.scrollHeight;
        renderAIWorkspace();
    } catch (err) {
        const typing = document.getElementById('ai-typing-indicator');
        if (typing) typing.remove();
        container.innerHTML += `
            <div class="ai-message assistant">
                <div class="ai-message-sender">AI</div>
                <div class="ai-message-bubble" style="color:var(--danger);">오류: ${err.message || '이미지 생성에 실패했습니다'}</div>
            </div>
        `;
        container.scrollTop = container.scrollHeight;
    } finally {
        sendBtn.disabled = false;
        imageBtn.disabled = false;
        input.disabled = false;
        input.focus();
    }
}
window.sendAIImage = sendAIImage;

async function deleteConversation(id) {
    if (!confirm('이 대화를 삭제하시겠습니까?')) return;
    try {
        await api(`/api/ai/conversations/${id}`, 'DELETE');
        if (aiCurrentConvId === id) {
            aiCurrentConvId = null;
            showAIChatEmpty();
        }
        await renderAIWorkspace();
    } catch (err) {
        alert(err.message || '삭제 실패');
    }
}
window.deleteConversation = deleteConversation;

async function renameConversation(id, currentTitle) {
    const newTitle = prompt('작업방 이름 수정', currentTitle);
    if (!newTitle || newTitle.trim() === '' || newTitle.trim() === currentTitle) return;
    try {
        await api(`/api/ai/conversations/${id}/title`, 'PUT', { title: newTitle.trim() });
        await renderAIWorkspace();
    } catch (err) {
        alert(err.message || '이름 수정 실패');
    }
}
window.renameConversation = renameConversation;

// Enter 키로 전송 (Shift+Enter는 줄바꿈) + 드래그 앤 드롭
document.addEventListener('DOMContentLoaded', () => {
    const aiInput = document.getElementById('ai-message-input');
    if (aiInput) {
        aiInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAIMessage();
            }
        });
        aiInput.addEventListener('input', () => {
            aiInput.style.height = 'auto';
            aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px';
        });
    }

    // 업무일지 월 이동 버튼
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

    // 드래그 앤 드롭 이미지 첨부
    const chatMessages = document.getElementById('ai-chat-messages');
    if (chatMessages) {
        let dragCounter = 0;
        chatMessages.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            chatMessages.classList.add('drag-over');
        });
        chatMessages.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                chatMessages.classList.remove('drag-over');
            }
        });
        chatMessages.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        chatMessages.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            chatMessages.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                processAttachedFile(file);
            }
        });
    }
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
    // 관리자이면 직원 선택 드롭다운 표시
    const adminCard = document.getElementById('worklog-admin-card');
    if (currentUser?.role === 'admin') {
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
        if (currentUser?.role === 'admin' && selectedUser) {
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

    const isViewingOther = currentUser?.role === 'admin' && document.getElementById('worklog-user-select')?.value;

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
        if (parsed && typeof parsed.morning === 'string') return parsed;
    } catch (e) {}
    // 기존 단일 텍스트 호환: 전체를 오전에 넣기
    return { morning: content || '', afternoon: '' };
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

    if (log) {
        const parsed = parseWorklogContent(log.content);
        morningEl.value = parsed.morning;
        afternoonEl.value = parsed.afternoon;
        worklogEditId = log.id;
        deleteBtn.style.display = '';
        titleEl.textContent = '업무일지 수정';
        saveBtn.textContent = '수정';
    } else {
        morningEl.value = '';
        afternoonEl.value = '';
        worklogEditId = null;
        deleteBtn.style.display = 'none';
        titleEl.textContent = '업무일지 작성';
        saveBtn.textContent = '저장';
    }

    // 관리자가 다른 직원 것 보는 경우 읽기 전용
    const isViewingOther = currentUser?.role === 'admin' && document.getElementById('worklog-user-select')?.value;
    morningEl.readOnly = !!isViewingOther;
    afternoonEl.readOnly = !!isViewingOther;
    saveBtn.style.display = isViewingOther ? 'none' : '';
    deleteBtn.style.display = isViewingOther ? 'none' : (log ? '' : 'none');

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
    if (!morning && !afternoon) {
        alert('오전 또는 오후 업무 내용을 입력해주세요.');
        return;
    }
    const content = JSON.stringify({ morning, afternoon });

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
    // 신청자 표시
    document.getElementById('expense-applicant').value = `${currentUser.position} ${currentUser.name}`;
    // 결재라인 표시
    renderExpenseApprovalLine();
    // 탭 권한
    const isPending = currentUser.role === 'admin';
    document.getElementById('expense-tab-pending').style.display = isPending ? '' : 'none';
    document.getElementById('expense-tab-history').style.display = currentUser.role === 'admin' ? '' : 'none';
    // 항상 작성 탭으로 초기화
    switchExpenseTab('write');
    // 항목 초기화
    const itemsEl = document.getElementById('expense-items');
    if (itemsEl.children.length === 0) addExpenseItem();
    // 목록 로드
    renderExpenseMyList().catch(console.error);
    if (isPending) renderExpensePendingList().catch(console.error);
    if (currentUser.role === 'admin') {
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
    ['write', 'pending', 'my', 'history'].forEach(s => {
        const el = document.getElementById(`expense-section-${s}`);
        if (el) el.style.display = s === tabName ? '' : 'none';
    });
    if (tabName === 'my') renderExpenseMyList().catch(console.error);
    if (tabName === 'pending') renderExpensePendingList().catch(console.error);
    if (tabName === 'history') renderExpenseHistoryList().catch(console.error);
}

// 결재라인 표시
function renderExpenseApprovalLine() {
    const el = document.getElementById('expense-approval-line');
    let steps = [];
    steps.push({ label: '신청자', name: `${currentUser.position} ${currentUser.name}` });

    if (currentUser.position === '대표') {
        steps.push({ label: '최종결재', name: `${currentUser.name} (자체)` });
    } else if (currentUser.role === 'admin') {
        steps.push({ label: '최종결재', name: '전승범 대표' });
    } else {
        steps.push({ label: '1차 결재', name: '전연희 부장' });
        steps.push({ label: '2차 결재', name: '전승범 대표' });
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

    if (!confirm(`지출결의서를 제출하시겠습니까?\n합계: ${items.reduce((s, i) => s + i.amount, 0).toLocaleString()} 원`)) return;

    try {
        await api('/api/expense-reports', 'POST', { title, purpose, items });
        alert('지출결의서가 제출되었습니다.');
        document.getElementById('expense-purpose').value = '';
        document.getElementById('expense-items').innerHTML = '';
        addExpenseItem();
        updateExpenseTotal();
        switchExpenseTab('my');
    } catch (err) { alert('제출 실패: ' + err.message); }
});

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
        const tbody = document.getElementById('expense-history-list');
        if (data.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">지출결의서가 없습니다.</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(d => {
            const deleteBtn = currentUser.position === '대표' ? `<button class="btn-danger" onclick="deleteExpense(${d.id})" style="margin-left:4px;">삭제</button>` : '';
            const pdfBtn = d.status === 'approved' ? `<button class="btn-view" onclick="downloadExpensePDF(${d.id})" style="margin-left:4px;color:#7c3aed;border-color:#7c3aed;">PDF</button>` : '';
            return `<tr>
                <td>${d.title}</td>
                <td>${d.applicant_position} ${d.applicant_name}</td>
                <td>${Number(d.total_amount).toLocaleString()} 원</td>
                <td>${new Date(d.created_at).toLocaleDateString()}</td>
                <td>${getExpenseStatusBadge(d.status)}</td>
                <td>
                    <button class="btn-view" onclick="viewExpenseDetail(${d.id})">상세</button>
                    ${pdfBtn}
                    ${deleteBtn}
                </td>
            </tr>`;
        }).join('');
    } catch (err) { console.error('전체 이력 로드 오류:', err); }
}

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

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="max-width:560px;">
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                <h3 style="text-align:center;margin-bottom:8px;">지출결의서</h3>
                ${stampHtml}
                <div style="margin-bottom:8px;"><strong>제목:</strong> ${d.title}</div>
                <div style="margin-bottom:8px;"><strong>작성일:</strong> ${new Date(d.created_at).toLocaleDateString()}</div>
                <div style="margin-bottom:12px;"><strong>지출목적:</strong> ${d.purpose || '-'}</div>
                <table class="data-table">
                    <thead><tr><th>항목</th><th style="text-align:right">금액(원)</th><th>비고</th></tr></thead>
                    <tbody>${itemRows}</tbody>
                    <tfoot><tr><td><strong>합계</strong></td><td style="text-align:right"><strong>${Number(d.total_amount).toLocaleString()} 원</strong></td><td></td></tr></tfoot>
                </table>
                ${rejectHtml}
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
                    ${pdfBtn}
                    <button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">닫기</button>
                </div>
            </div>
        `;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    } catch (err) { alert('상세 조회 실패: ' + err.message); }
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
                    <tr><td style="padding:8px 0;font-weight:bold;">작성일</td><td style="padding:8px 0;">${new Date(d.created_at).toLocaleDateString()}</td></tr>
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
