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
    }
    if (pageName === 'pricing') renderPricingList().catch(console.error);
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

async function renderScheduleCalendar() {
    const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    document.getElementById('schedule-calendar-title').textContent = `${scheduleYear}년 ${monthNames[scheduleMonth]}`;

    const monthStr = `${scheduleYear}-${String(scheduleMonth + 1).padStart(2, '0')}`;
    const schedules = await api(`/api/schedules?month=${monthStr}`);

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
                        const typeIcon = s.type === 'vacation' ? '🏖️ ' : s.type === 'attendance' ? '📌 ' : '';
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
                const typeLabel = s.type === 'vacation' ? ' (휴가)' : s.type === 'attendance' ? ' (근태)' : '';
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
});

document.getElementById('settlement-next-month').addEventListener('click', () => {
    settlementCalMonth++;
    if (settlementCalMonth > 11) { settlementCalMonth = 0; settlementCalYear++; }
    renderSettlementCalendar().catch(console.error);
});

async function renderSettlementCalendar() {
    const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    document.getElementById('settlement-calendar-title').textContent = `${settlementCalYear}년 ${monthNames[settlementCalMonth]}`;

    const monthNum = settlementCalMonth + 1;
    document.getElementById('total-payment-label').textContent = `${monthNum}월 총 결제금액`;
    document.getElementById('daesung-payment-label').textContent = `${monthNum}월 대성(시온) 결제금액`;
    document.getElementById('hyodon-payment-label').textContent = `${monthNum}월 효돈농협 결제금액`;
    document.getElementById('cj-payment-label').textContent = `${monthNum}월 CJ택배 결제금액`;

    const monthStr = `${settlementCalYear}-${String(monthNum).padStart(2, '0')}`;
    const settlements = await api(`/api/settlements?month=${monthStr}`);

    let totalPayment = 0, daesungPayment = 0, hyodonPayment = 0, cjPayment = 0;
    const dailyPayments = {};

    settlements.forEach(s => {
        const amount = s.amount || 0;
        totalPayment += amount;
        if (s.partner === '대성(시온)') daesungPayment += amount;
        if (s.partner === '효돈농협') hyodonPayment += amount;
        if (s.partner === 'CJ대한통운') cjPayment += amount;

        if (!dailyPayments[s.date]) dailyPayments[s.date] = { daesung: 0, hyodon: 0, cj: 0 };
        if (s.partner === '대성(시온)') dailyPayments[s.date].daesung += amount;
        if (s.partner === '효돈농협') dailyPayments[s.date].hyodon += amount;
        if (s.partner === 'CJ대한통운') dailyPayments[s.date].cj += amount;
    });

    document.getElementById('total-payment').textContent = `${totalPayment.toLocaleString()} 원`;
    document.getElementById('daesung-payment').textContent = `${daesungPayment.toLocaleString()} 원`;
    document.getElementById('hyodon-payment').textContent = `${hyodonPayment.toLocaleString()} 원`;
    document.getElementById('cj-payment').textContent = `${cjPayment.toLocaleString()} 원`;

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

                const dp = dailyPayments[dateStr];
                let qtyHtml = '';
                if (dp) {
                    qtyHtml = '<div class="day-payments">';
                    if (dp.daesung) qtyHtml += `<div class="day-payment-item daesung"><span class="dot dot-daesung"></span>${dp.daesung.toLocaleString()}</div>`;
                    if (dp.hyodon) qtyHtml += `<div class="day-payment-item hyodon"><span class="dot dot-hyodon"></span>${dp.hyodon.toLocaleString()}</div>`;
                    if (dp.cj) qtyHtml += `<div class="day-payment-item cj"><span class="dot dot-cj"></span>${dp.cj.toLocaleString()}</div>`;
                    qtyHtml += '</div>';
                }

                html += `<td class="${classes.join(' ')}">
                    <span class="day-number">${isToday ? '오늘' : day}</span>
                    ${qtyHtml}
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

document.getElementById('settlement-reset-btn').addEventListener('click', () => {
    document.getElementById('settlement-date').value = '';
    document.querySelectorAll('#settlement-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    selectedSettlementPartner = '';
    document.getElementById('settlement-amount').value = '';
    document.getElementById('settlement-rows').innerHTML = '';
    resetSettlementPaste();
    document.getElementById('sales-unmatched-container').style.display = 'none';
    document.getElementById('sales-upload-area').style.display = '';
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

            const matched = [], unmatched = [];
            for (const item of salesItems) {
                const result = matchSalesToPricing(item.name, pricingItems);
                if (result) matched.push({ pricingName: result.name, price: result.price, qty: item.qty, originalName: item.name });
                else unmatched.push(item);
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
                document.getElementById('sales-unmatched-list').innerHTML = unmatched.map(item =>
                    '<div class="ocr-unmatched-item"><span class="unmatched-name" title="' + item.name + '">' + item.name + '</span><span class="unmatched-qty">' + item.qty + '개</span></div>'
                ).join('');
                unmatchedContainer.style.display = 'block';
            } else { unmatchedContainer.style.display = 'none'; }

            let msg = '=== 매칭 결과 ===\n매칭 성공: ' + groupedList.length + '개 / 실패: ' + unmatched.length + '개\n';
            if (groupedList.length > 0) { msg += '\n[매칭 성공]\n'; groupedList.forEach(g => { msg += '  ' + g.name + ' (' + g.price + '원 x ' + g.qty + ')\n'; }); }
            if (unmatched.length > 0) { msg += '\n[매칭 실패]\n'; unmatched.forEach(u => { msg += '  ' + u.name + '\n'; }); }
            alert(msg);
        } catch (err) {
            alert('엑셀 파일을 읽는데 실패했습니다: ' + err.message);
            console.error('Sales Excel Error:', err);
        }
    };
    reader.readAsArrayBuffer(file);
}

function matchSalesToPricing(salesName, pricingItems) {
    for (const p of pricingItems) { if (p.name === salesName) return p; }
    const salesLower = salesName.toLowerCase();
    let bestMatch = null, bestKeywordCount = 0;
    for (const p of pricingItems) {
        const keywords = p.name.split(/\s+/).filter(k => k.length > 0);
        const allMatch = keywords.every(kw => containsKeyword(salesLower, kw.toLowerCase()));
        if (allMatch && keywords.length > bestKeywordCount) { bestKeywordCount = keywords.length; bestMatch = p; }
    }
    return bestMatch;
}

function containsKeyword(text, keyword) {
    let idx = 0;
    while (idx <= text.length - keyword.length) {
        const pos = text.indexOf(keyword, idx);
        if (pos === -1) return false;
        if (/^\d/.test(keyword) && pos > 0 && /\d/.test(text[pos - 1])) { idx = pos + 1; continue; }
        return true;
    }
    return false;
}

async function getPricingForDate(partner, dateStr) {
    const pricingData = await api('/api/pricing');
    const applicable = pricingData.filter(p => p.partner === partner && p.startDate <= dateStr && p.endDate >= dateStr);
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
        toggleCjMode(false);
        await renderSettlementList();
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
    try { await api(`/api/settlements/${id}`, 'DELETE'); await renderSettlementList(); } catch (err) { alert('삭제 실패: ' + err.message); }
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

function updateDocEndDateVisibility() {
    const showEndDate = currentDocType === 'vacation' && selectedDocSubType === '연차';
    document.getElementById('doc-end-date-group').style.display = showEndDate ? '' : 'none';
}

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

    const body = {
        type: currentDocType,
        subType: selectedDocSubType,
        approverId: Number(approverId),
        startDate,
        endDate: (currentDocType === 'vacation' && selectedDocSubType === '연차') ? endDate || startDate : startDate,
        reason
    };

    try {
        await api('/api/documents', 'POST', body);
        alert('서류가 제출되었습니다.');

        document.getElementById('doc-start-date').value = '';
        document.getElementById('doc-end-date').value = '';
        document.getElementById('doc-reason').value = '';

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

        tbody.innerHTML = docs.map(d => {
            const statusClass = d.status === 'approved' ? 'status-approved' : d.status === 'rejected' ? 'status-rejected' : 'status-pending';
            const statusLabel = d.status === 'approved' ? '승인' : d.status === 'rejected' ? '반려' : '대기중';
            const dateStr = d.startDate === d.endDate ? d.startDate : `${d.startDate} ~ ${d.endDate}`;
            const canDelete = d.status === 'pending';

            return `<tr>
                <td>${d.subType}</td>
                <td>${dateStr}</td>
                <td>${d.reason || '-'}</td>
                <td>${d.approverName || '-'}</td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td>${canDelete ? `<button class="btn-danger" onclick="deleteDocument(${d.id})">삭제</button>` : ''}</td>
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
    if (!confirm('서류를 삭제하시겠습니까?\n연차가 차감된 경우 복구됩니다.')) return;
    try {
        await api(`/api/documents/${id}`, 'DELETE');
        const me = await api('/api/auth/me');
        currentUser = me;
        localStorage.setItem('jwt_user', JSON.stringify(me));
        document.getElementById('annual-leave-count').textContent = me.annualLeave;
        await renderDocList();
    } catch (err) {
        alert('삭제 실패: ' + err.message);
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
