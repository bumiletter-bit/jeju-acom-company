// ==========================================
// 제주아꼼이네 농업회사법인 (주) - 회사 프로그램
// ==========================================

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
}

function updateUserUI() {
    if (!currentUser) return;
    document.getElementById('welcome-message').textContent =
        `${currentUser.position} ${currentUser.name}님 안녕하세요`;
    document.getElementById('annual-leave-count').textContent = currentUser.annualLeave;
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
    });
});

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
        document.getElementById('approval-pending-card').style.display = currentUser?.role === 'admin' ? '' : 'none';
        if (currentUser?.role === 'admin') renderApprovalList().catch(console.error);
        if (currentUser) document.getElementById('doc-applicant').value = `${currentUser.position} ${currentUser.name}`;
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
    if (pageName === 'ai-workspace') renderAIWorkspace().catch(console.error);
    if (pageName === 'data' && currentUser?.role === 'admin') renderUserList().catch(console.error);
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
                let scheduleHtml = '';
                if (daySchedules.length > 0) {
                    scheduleHtml = '<div class="day-schedules">';
                    daySchedules.forEach(s => {
                        const typeIcon = s.type === 'vacation' ? '🏖️ ' : s.type === 'attendance' ? '📌 ' : s.type === 'duty' ? '🔴 ' : '';
                        scheduleHtml += `<div class="day-schedule-item" style="border-left:3px solid ${s.userColor};" title="${s.userName}: ${s.title}">${typeIcon}${s.title}</div>`;
                    });
                    scheduleHtml += '</div>';
                }

                html += `<td class="${classes.join(' ')}" data-date="${dateStr}" onclick="openScheduleModal('${dateStr}')">
                    <span class="day-number">${isToday ? '오늘' : day}</span>
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
                    <button class="btn-toggle" data-value="vacation">휴가</button>
                    <button class="btn-toggle" data-value="attendance">근태</button>
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

        try {
            await api('/api/schedules', 'POST', { date: dateStr, title, type: selectedType });
            overlay.remove();
            await renderScheduleCalendar();
            if (selectedType === 'vacation') {
                const me = await api('/api/auth/me');
                currentUser = me;
                localStorage.setItem('jwt_user', JSON.stringify(me));
                document.getElementById('annual-leave-count').textContent = me.annualLeave;
            }
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
                return `<div class="schedule-detail-item" style="border-left:3px solid ${s.userColor};">
                    <div><strong>${s.userName}</strong>${typeLabel}: ${s.title}</div>
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
        document.getElementById('annual-leave-count').textContent = me.annualLeave;
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};

// =============================================
// 정산관리 캘린더 (기존 홈에서 이동)
// =============================================
let settlementCalYear = new Date().getFullYear();
let settlementCalMonth = new Date().getMonth();

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
    document.getElementById('expected-payment-label').textContent = `${monthNum}월 결제예정금액`;
    document.getElementById('daesung-payment-label').textContent = `${monthNum}월 대성(시온)`;
    document.getElementById('hyodon-payment-label').textContent = `${monthNum}월 효돈농협`;
    document.getElementById('cj-payment-label').textContent = `${monthNum}월 CJ택배`;

    const monthStr = `${settlementCalYear}-${String(monthNum).padStart(2, '0')}`;
    const [settlements, prepayments] = await Promise.all([
        api(`/api/settlements?month=${monthStr}`),
        api('/api/prepayments')
    ]);

    let daesungPayment = 0, hyodonPayment = 0, cjPayment = 0;
    const dailyPayments = {};

    settlements.forEach(s => {
        const amount = s.amount || 0;
        if (s.partner === '대성(시온)') daesungPayment += amount;
        if (s.partner === '효돈농협') hyodonPayment += amount;

        if (!dailyPayments[s.date]) dailyPayments[s.date] = { daesung: 0, hyodon: 0, cj: 0 };
        if (s.partner === '대성(시온)') dailyPayments[s.date].daesung += amount;
        if (s.partner === '효돈농협') dailyPayments[s.date].hyodon += amount;

        // CJ택배비 자동 계산: 대성/효돈 정산의 items 수량 합계 × 3,100원
        if (s.partner === '대성(시온)' || s.partner === '효돈농협') {
            const items = s.items || [];
            const boxCount = items.reduce((sum, item) => sum + (item.qty || 0), 0);
            const cjCost = boxCount * 3100;
            dailyPayments[s.date].cj += cjCost;
            cjPayment += cjCost;
        }
    });

    document.getElementById('cj-payment').textContent = `${cjPayment.toLocaleString()} 원`;

    // 선결제 잔액 조회 → 대성/효돈 카드에 선결제 차감 표시
    let daesungPrepay = 0, hyodonPrepay = 0;
    try {
        const balances = await api('/api/prepayments/balance');
        balances.forEach(b => {
            if (b.partner === '대성(시온)') daesungPrepay = b.prepaidTotal || 0;
            else if (b.partner === '효돈농협') hyodonPrepay = b.prepaidTotal || 0;
        });
    } catch (err) {
        console.error('선결제 잔액 로드 오류:', err);
    }

    // 대성 카드: 정산 - 선결제
    const daesungNet = daesungPayment - daesungPrepay;
    document.getElementById('daesung-payment').textContent = `${daesungNet.toLocaleString()} 원`;
    const daesungPrepayLine = document.getElementById('daesung-prepay-line');
    if (daesungPrepay > 0) {
        daesungPrepayLine.textContent = `선결제 -${daesungPrepay.toLocaleString()}원`;
        daesungPrepayLine.style.display = '';
    } else {
        daesungPrepayLine.style.display = 'none';
    }

    // 효돈 카드: 정산 - 선결제
    const hyodonNet = hyodonPayment - hyodonPrepay;
    document.getElementById('hyodon-payment').textContent = `${hyodonNet.toLocaleString()} 원`;
    const hyodonPrepayLine = document.getElementById('hyodon-prepay-line');
    if (hyodonPrepay > 0) {
        hyodonPrepayLine.textContent = `선결제 -${hyodonPrepay.toLocaleString()}원`;
        hyodonPrepayLine.style.display = '';
    } else {
        hyodonPrepayLine.style.display = 'none';
    }

    // 결제예정금액 = (대성-선결제) + (효돈-선결제) + CJ
    const expectedPayment = daesungNet + hyodonNet + cjPayment;
    document.getElementById('expected-payment').textContent = `${expectedPayment.toLocaleString()} 원`;

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
                    if (dp.daesung) contentHtml += `<div class="day-payment-item daesung"><span class="pay-label">대성</span><span class="pay-amount">${dp.daesung.toLocaleString()}원</span></div>`;
                    if (dp.hyodon) contentHtml += `<div class="day-payment-item hyodon"><span class="pay-label">효돈</span><span class="pay-amount">${dp.hyodon.toLocaleString()}원</span></div>`;
                    if (dp.cj) contentHtml += `<div class="day-payment-item cj"><span class="pay-label">CJ</span><span class="pay-amount">${dp.cj.toLocaleString()}원</span></div>`;
                    const dayTotal = (dp.daesung || 0) + (dp.hyodon || 0) + (dp.cj || 0);
                    if (dayTotal > 0) contentHtml += `<div class="day-total"><span class="pay-label">합계</span><span class="pay-amount">${dayTotal.toLocaleString()}원</span></div>`;
                    contentHtml += '</div>';
                }

                html += `<td class="${classes.join(' ')}">
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

// =============================================
// 정산관리 (기존 기능 유지)
// =============================================
let selectedSettlementPartner = null;

document.getElementById('settlement-date').valueAsDate = new Date();

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

            const header = jsonData[0].map(h => String(h || '').trim());
            let nameCol = -1, qtyCol = -1;
            header.forEach((h, i) => {
                const lower = h.toLowerCase();
                if (lower.includes('옵션명') || lower.includes('품목명') || lower.includes('상품명') || lower.includes('품목') || lower.includes('옵션')) nameCol = i;
                if (lower.includes('수량') || lower.includes('판매수량') || lower.includes('주문수량') || lower.includes('qty')) qtyCol = i;
            });
            if (nameCol === -1) nameCol = 0;
            if (qtyCol === -1) qtyCol = header.length >= 2 ? header.length - 1 : 1;

            const salesItems = [];
            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;
                const name = String(row[nameCol] || '').trim();
                const qty = parseInt(String(row[qtyCol] || '0').replace(/[,\s]/g, ''), 10) || 0;
                if (name && qty > 0) salesItems.push({ name, qty });
            }

            if (salesItems.length === 0) { alert('엑셀에서 품목/수량 데이터를 찾을 수 없습니다.'); return; }

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

    // 과일명 추출 (3종세트 우선)
    let fruit = null;
    if (/3종세트/.test(t)) fruit = '3종세트';
    else if (/비가림|감귤/.test(t)) fruit = '비가림귤';
    else if (/천혜향/.test(t)) fruit = '천혜향';
    else if (/레드향/.test(t)) fruit = '레드향';
    else if (/한라봉/.test(t)) fruit = '한라봉';
    else if (/레몬/.test(t)) fruit = '레몬';

    // 용도/등급 추출
    let grade = null;
    if (/로얄과/.test(t)) grade = '로얄과';
    else if (/소과/.test(t)) grade = '소과';
    else if (/중대과/.test(t)) grade = '중대과';
    else if (/못난이/.test(t)) grade = '못난이';
    else if (/선물용/.test(t)) grade = '선물용';
    else if (/프리미엄/.test(t)) grade = '선물용';
    else if (/가정용/.test(t)) grade = '가정용';

    // 중량 추출
    let weight = null;
    const wMatch = t.match(/(\d+)\s*kg/i);
    if (wMatch) weight = wMatch[1] + 'kg';

    return { fruit, grade, weight };
}

function matchSalesToPricing(salesName, pricingItems) {
    // 1차: 정확한 이름 매칭
    for (const p of pricingItems) { if (p.name === salesName) return p; }

    // 2차: 특징 기반 매칭 (과일명 + 용도 + 중량)
    const sf = extractFeatures(salesName);
    if (!sf.fruit) return null;

    let bestMatch = null, bestScore = 0;
    for (const p of pricingItems) {
        const pf = extractFeatures(p.name);
        if (!pf.fruit || sf.fruit !== pf.fruit) continue;

        let score = 1; // 과일명 일치
        let mismatch = false;

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
    const pricingData = await api('/api/pricing');
    let applicable = pricingData.filter(p => p.partner === partner && p.startDate <= dateStr && p.endDate >= dateStr);

    // 가격 동결: 해당 주간 가격이 없으면 가장 최근 가격 사용
    if (applicable.length === 0) {
        const past = pricingData
            .filter(p => p.partner === partner && p.endDate < dateStr)
            .sort((a, b) => b.endDate.localeCompare(a.endDate));
        if (past.length > 0) applicable = [past[0]];
    }

    if (applicable.length === 0) return [];
    const itemMap = {};
    applicable.sort((a, b) => a.id - b.id);
    applicable.forEach(p => { (p.items || []).forEach(item => { itemMap[item.name] = item.price; }); });
    return Object.entries(itemMap).map(([name, price]) => ({ name, price }));
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
            return `<tr>
                <td>${item.date}</td>
                <td>${item.partner} ${fromPricingBadge}</td>
                <td>${(item.amount || 0).toLocaleString()} 원</td>
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

    const rows = item.items.map(i => `<tr><td>${i.name}</td><td style="text-align:right">${(i.price || 0).toLocaleString()} 원</td><td style="text-align:center">${i.qty || 1}</td><td style="text-align:right">${(i.subtotal || i.price || 0).toLocaleString()} 원</td></tr>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3>${item.date} - ${item.partner} 상세</h3>
            <table class="data-table">
                <thead><tr><th>품목명</th><th style="text-align:right">단가</th><th style="text-align:center">수량</th><th style="text-align:right">소계</th></tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr><td colspan="3"><strong>합계</strong></td><td style="text-align:right"><strong>${(item.amount || 0).toLocaleString()} 원</strong></td></tr></tfoot>
            </table>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
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
        await renderSettlementList();
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

// 탭 전환
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
    const typeLabels = { vacation: '휴가신청서', attendance: '근태신청서', reason: '사유서' };
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
    document.getElementById('doc-approver').value = '';
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
    const isTime = currentDocType === 'vacation' && selectedDocSubType === '시간차';
    const showEndDate = currentDocType === 'vacation' && (selectedDocSubType === '연차' || selectedDocSubType === '병가' || selectedDocSubType === '시간차');
    document.getElementById('doc-end-date-group').style.display = showEndDate ? '' : 'none';
    document.getElementById('doc-start-time-group').style.display = isTime ? '' : 'none';
    document.getElementById('doc-end-time-group').style.display = isTime ? '' : 'none';
    document.getElementById('doc-time-hours-group').style.display = isTime ? '' : 'none';
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

function calcTimeLeave() {
    const startDate = document.getElementById('doc-start-date').value;
    const endDate = document.getElementById('doc-end-date').value;
    const startTime = document.getElementById('doc-start-time').value;
    const endTime = document.getElementById('doc-end-time').value;
    const display = document.getElementById('doc-time-hours');
    if (!startTime || !endTime || !startDate) { display.textContent = ''; return; }
    const sd = endDate || startDate;
    const s = new Date(`${startDate}T${startTime}`);
    const e = new Date(`${sd}T${endTime}`);
    const hours = (e - s) / (1000 * 60 * 60);
    if (hours <= 0) { display.textContent = '시간을 확인해주세요'; return; }
    const days = Math.round(hours / 8 * 10) / 10;
    display.textContent = `사용시간: ${hours}시간 (연차 ${days}일 차감)`;
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

// 결재자 목록 로드
async function loadApprovers() {
    try {
        approverList = await api('/api/users/approvers');
        const select = document.getElementById('doc-approver');
        select.innerHTML = '<option value="">결재자를 선택하세요</option>' +
            approverList.map(a => `<option value="${a.id}">${a.position ? a.position + ' ' : ''}${a.name}</option>`).join('');
    } catch (err) {
        console.error('loadApprovers error:', err);
    }
}

// 서류 제출
document.getElementById('doc-submit').addEventListener('click', async () => {
    const approverId = document.getElementById('doc-approver').value;
    const startDate = document.getElementById('doc-start-date').value;
    const endDate = document.getElementById('doc-end-date').value;
    const reason = document.getElementById('doc-reason').value.trim();

    if (!startDate) return alert('날짜를 선택해주세요.');
    if (!approverId) return alert('결재자를 선택해주세요.');

    const isTime = currentDocType === 'vacation' && selectedDocSubType === '시간차';
    const hasEndDate = currentDocType === 'vacation' && (selectedDocSubType === '연차' || selectedDocSubType === '병가' || selectedDocSubType === '시간차');

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
        document.getElementById('annual-leave-count').textContent = me.annualLeave;

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
            // 수정: 대기중/반려 → 본인, 승인 → 관리자
            const canEdit = (d.status === 'pending' && isMine) || (d.status === 'rejected' && isMine) || (d.status === 'approved' && isAdmin);
            // 삭제: 대기중 → 본인/관리자, 승인 → 관리자만, 반려 → 본인/관리자
            const canDelete = (d.status === 'pending' && (isMine || isAdmin)) || (d.status === 'approved' && isAdmin) || (d.status === 'rejected' && (isMine || isAdmin));

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

// 결재 대기 목록 (관리자)
async function renderApprovalList() {
    try {
        const docs = await api('/api/documents?status=pending');
        const tbody = document.getElementById('approval-pending-list');

        if (docs.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="5">대기 중인 결재가 없습니다.</td></tr>';
            return;
        }

        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '사유서' };

        tbody.innerHTML = docs.map(d => {
            const dateStr = d.startDate === d.endDate ? d.startDate : `${d.startDate} ~ ${d.endDate}`;
            return `<tr>
                <td>${typeLabels[d.type] || d.type} - ${d.subType}</td>
                <td>${d.applicantPosition ? d.applicantPosition + ' ' : ''}${d.applicantName}</td>
                <td>${dateStr}</td>
                <td>${d.reason || '-'}</td>
                <td>
                    <button class="btn-approve" onclick="approveDocument(${d.id})">승인</button>
                    <button class="btn-reject" onclick="rejectDocument(${d.id})">반려</button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('renderApprovalList error:', err);
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
        document.getElementById('annual-leave-count').textContent = me.annualLeave;
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
    const approverOptions = approvers.map(a => `<option value="${a.id}" ${a.id === doc.approverId ? 'selected' : ''}>${a.position ? a.position + ' ' : ''}${a.name}</option>`).join('');

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
                <label>결재자</label>
                <select id="edit-doc-approver" class="form-input">
                    <option value="">결재자를 선택하세요</option>
                    ${approverOptions}
                </select>
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
    const approverId = document.getElementById('edit-doc-approver').value;

    if (!startDate) return alert('시작일을 입력하세요.');
    if (!approverId) return alert('결재자를 선택하세요.');

    try {
        await api(`/api/documents/${id}`, 'PUT', { subType, startDate, endDate, reason, approverId: Number(approverId) });
        closeEditDocModal();
        const me = await api('/api/auth/me');
        currentUser = me;
        localStorage.setItem('jwt_user', JSON.stringify(me));
        document.getElementById('annual-leave-count').textContent = me.annualLeave;
        await renderDocList();
        if (currentUser.role === 'admin') await renderApprovalList();
        alert(type === 'rejected' ? '재제출되었습니다.' : '수정되었습니다.');
    } catch (err) {
        alert('수정 실패: ' + err.message);
    }
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
        document.getElementById('annual-leave-count').textContent = me.annualLeave;
        alert('반려되었습니다.');
    } catch (err) {
        alert('반려 실패: ' + err.message);
    }
};

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

// 상품 카탈로그 매칭
function matchProduct(rawText) {
    const t = rawText || '';
    const wm = t.match(/(\d+)\s*kg/i);
    if (!wm) return t.trim();
    const w = parseInt(wm[1]);
    const wStr = w + 'kg';

    if (/3종세트/.test(t)) return '★추천 선물세트 / 상품 및 과수: 레드향&한라봉&천혜향 ' + wStr + '(3종세트)';
    if (/레몬/.test(t)) return '과수 및 크기: 제주 레몬' + wStr + '(중대과)';
    if (/비가림|감귤/.test(t)) {
        if (/선물용|프리미엄\s*로얄/.test(t)) return '고당도 비가림귤 / 상품 및 과수: 프리미엄 로얄과 - ' + wStr + '(선물용 2S~M)';
        return '고당도 비가림귤 / 상품 및 과수: 로얄과 - ' + wStr + '(가정용 2S~M)';
    }

    let fruit;
    if (/레드향/.test(t)) fruit = '레드향';
    else if (/한라봉/.test(t)) fruit = '한라봉';
    else if (/천혜향/.test(t)) fruit = '천혜향';
    else return t.trim();

    if (w === 2 && /프리미엄/.test(t)) return '프리미엄 선물용 / 상품 및 과수: 프리미엄 선물용 ' + fruit + ' - 2kg';

    let type;
    if (/못난이/.test(t)) type = '못난이';
    else if (/선물용/.test(t)) type = '선물용';
    else type = '가정용';

    let category;
    if (fruit === '레드향') category = '알알톡톡 레드향';
    else if (fruit === '천혜향') category = '과즙팡팡 천혜향';
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

    let fruitLabel = fruit;
    if (fruit === '레드향' && w === 9) fruitLabel = '★레드향';
    return category + ' / 상품 및 과수: ' + fruitLabel + ' ' + type + ' - ' + wStr + '(' + detail + ')';
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
        cols.forEach(col => {
            const ref = col + r;
            let style = dStyle;
            if (isDateReq && col === 'J') style = dRed;
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
    if (adminCard) adminCard.style.display = currentUser?.role === 'admin' ? '' : 'none';

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

    if (currentUser?.role === 'admin') renderLunchAdminPanel().catch(console.error);
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

        const [settCurr, settPrev, settNext, prepayments] = await Promise.all([
            api(`/api/settlements?month=${monthStr}`),
            api(`/api/settlements?month=${prevMonthStr}`),
            api(`/api/settlements?month=${nextMonthStr}`),
            api('/api/prepayments')
        ]);
        const settlements = [...settPrev, ...settCurr, ...settNext];

        const weeks = getWeeksInMonth(settlementCalYear, settlementCalMonth);

        if (weeks.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">데이터가 없습니다.</td></tr>';
            return;
        }

        let html = '';
        weeks.forEach((week, idx) => {
            let daesungTotal = 0, hyodonTotal = 0, cjTotal = 0;

            settlements.forEach(s => {
                if (s.date >= week.start && s.date <= week.end) {
                    if (s.partner === '대성(시온)') {
                        daesungTotal += (s.amount || 0);
                        const items = s.items || [];
                        cjTotal += items.reduce((sum, item) => sum + (item.qty || 0), 0) * 3100;
                    }
                    if (s.partner === '효돈농협') {
                        hyodonTotal += (s.amount || 0);
                        const items = s.items || [];
                        cjTotal += items.reduce((sum, item) => sum + (item.qty || 0), 0) * 3100;
                    }
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
            listEl.innerHTML = convs.map(c => `
                <div class="ai-conv-item ${aiCurrentConvId === c.id ? 'active' : ''}" onclick="loadConversation(${c.id})">
                    <span class="ai-conv-item-title">${c.title}</span>
                    <button class="ai-conv-item-delete" onclick="event.stopPropagation(); deleteConversation(${c.id})" title="삭제">&times;</button>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('AI 작업방 로드 오류:', err);
    }
}

async function createNewConversation() {
    try {
        const conv = await api('/api/ai/conversations', 'POST');
        aiCurrentConvId = conv.id;
        document.getElementById('ai-chat-messages').innerHTML = '';
        document.getElementById('ai-input-area').style.display = '';
        document.getElementById('ai-message-input').value = '';
        document.getElementById('ai-message-input').focus();
        await renderAIWorkspace();
    } catch (err) {
        alert(err.message || '대화 생성 실패');
    }
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
        return `<div class="ai-message ${m.role}">
            <div class="ai-message-sender">${m.role === 'user' ? '나' : 'AI'}</div>
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
            <div class="ai-message-sender">나</div>
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
            <div class="ai-message-sender">나</div>
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
