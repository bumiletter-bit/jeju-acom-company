// ==========================================
// 제주아꼼이네 농업회사법인 (주) - 회사 프로그램
// ==========================================

// ---- Data Store (localStorage) ----
const STORAGE_KEYS = {
    settlements: 'jejuacom_settlements',
    pricing: 'jejuacom_pricing'
};

function loadData(key) {
    try {
        return JSON.parse(localStorage.getItem(key)) || [];
    } catch {
        return [];
    }
}

function saveData(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

// ---- Navigation ----
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

    // Refresh page data
    if (pageName === 'home') renderCalendar();
    if (pageName === 'settlement') renderSettlementList();
    if (pageName === 'pricing') renderPricingList();
}

// ---- Calendar (Home) ----
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-indexed

document.getElementById('prev-month').addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
});

document.getElementById('next-month').addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
});

function renderCalendar() {
    const monthNames = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    document.getElementById('calendar-title').textContent = `${currentYear}년 ${monthNames[currentMonth]}`;

    // Update stat labels
    const monthNum = currentMonth + 1;
    document.getElementById('total-payment-label').textContent = `${monthNum}월 총 결제금액`;
    document.getElementById('daesung-payment-label').textContent = `${monthNum}월 대성(시온) 결제금액`;
    document.getElementById('hyodon-payment-label').textContent = `${monthNum}월 효돈농협 결제금액`;
    document.getElementById('cj-payment-label').textContent = `${monthNum}월 CJ택배 결제금액`;

    // Calculate payment stats from settlements
    const settlements = loadData(STORAGE_KEYS.settlements);
    const monthStr = `${currentYear}-${String(monthNum).padStart(2, '0')}`;

    let totalPayment = 0;
    let daesungPayment = 0;
    let hyodonPayment = 0;
    let cjPayment = 0;

    // Build daily payment map per partner
    const dailyPayments = {}; // { '2026-02-27': { daesung: 0, hyodon: 0, cj: 0 } }

    settlements.forEach(s => {
        if (s.date && s.date.startsWith(monthStr)) {
            const amount = s.amount || 0;
            totalPayment += amount;
            if (s.partner === '대성(시온)') daesungPayment += amount;
            if (s.partner === '효돈농협') hyodonPayment += amount;
            if (s.partner === 'CJ대한통운') cjPayment += amount;

            if (!dailyPayments[s.date]) dailyPayments[s.date] = { daesung: 0, hyodon: 0, cj: 0 };
            if (s.partner === '대성(시온)') dailyPayments[s.date].daesung += amount;
            if (s.partner === '효돈농협') dailyPayments[s.date].hyodon += amount;
            if (s.partner === 'CJ대한통운') dailyPayments[s.date].cj += amount;
        }
    });

    document.getElementById('total-payment').textContent = `${totalPayment.toLocaleString()} 원`;
    document.getElementById('daesung-payment').textContent = `${daesungPayment.toLocaleString()} 원`;
    document.getElementById('hyodon-payment').textContent = `${hyodonPayment.toLocaleString()} 원`;
    document.getElementById('cj-payment').textContent = `${cjPayment.toLocaleString()} 원`;

    // Build calendar grid
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
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
                const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isToday = (currentYear === today.getFullYear() && currentMonth === today.getMonth() && day === today.getDate());
                const isHoliday = today.getFullYear() === currentYear && today.getMonth() === currentMonth && new Date(currentYear, currentMonth, day).getDay() === 3 && day === 11;

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

    document.getElementById('calendar-body').innerHTML = html;
}

// ---- Settlement Page (정산관리) ----
let selectedSettlementPartner = null;
let settlementFiles = [];

// Set default date
document.getElementById('settlement-date').valueAsDate = new Date();

// Set default month filter
const now = new Date();
document.getElementById('settlement-month-filter').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// Partner toggle
document.getElementById('settlement-partner-group').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-toggle');
    if (!btn) return;
    document.querySelectorAll('#settlement-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSettlementPartner = btn.dataset.value;
});

// File upload
setupUpload('settlement-upload', 'settlement-file', 'settlement-preview', (files) => {
    settlementFiles = files;
});

// Month filter change
document.getElementById('settlement-month-filter').addEventListener('change', renderSettlementList);

// Save
document.getElementById('settlement-save').addEventListener('click', () => {
    const date = document.getElementById('settlement-date').value;
    if (!date) return alert('날짜를 선택해주세요.');
    if (!selectedSettlementPartner) return alert('거래처를 선택해주세요.');

    const amount = Number(document.getElementById('settlement-amount').value) || 0;

    const record = {
        id: Date.now(),
        date: date,
        partner: selectedSettlementPartner,
        amount: amount,
        images: settlementFiles.map(f => f.dataUrl)
    };

    const data = loadData(STORAGE_KEYS.settlements);
    data.push(record);
    saveData(STORAGE_KEYS.settlements, data);

    // Reset form
    selectedSettlementPartner = null;
    settlementFiles = [];
    document.getElementById('settlement-amount').value = '';
    document.querySelectorAll('#settlement-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    document.getElementById('settlement-preview').innerHTML = '';

    renderSettlementList();
    alert('저장되었습니다.');
});

function renderSettlementList() {
    const monthVal = document.getElementById('settlement-month-filter').value;
    const data = loadData(STORAGE_KEYS.settlements);

    const filtered = monthVal
        ? data.filter(d => d.date && d.date.startsWith(monthVal))
        : data;

    const tbody = document.getElementById('settlement-list');
    let totalAmount = 0;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">데이터가 없습니다.</td></tr>';
    } else {
        tbody.innerHTML = filtered.map(item => {
            totalAmount += (item.amount || 0);
            return `<tr>
                <td>${item.date}</td>
                <td>${item.partner}</td>
                <td>${(item.amount || 0).toLocaleString()} 원</td>
                <td>
                    ${item.images && item.images.length > 0 ? `<button class="btn-view" onclick="viewImages(${item.id}, 'settlements')">보기</button>` : ''}
                    <button class="btn-danger" onclick="deleteSettlement(${item.id})">삭제</button>
                </td>
            </tr>`;
        }).join('');
    }

    document.getElementById('settlement-total-amount').innerHTML = `<strong>${totalAmount.toLocaleString()} 원</strong>`;
}

window.deleteSettlement = function(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    let data = loadData(STORAGE_KEYS.settlements);
    data = data.filter(d => d.id !== id);
    saveData(STORAGE_KEYS.settlements, data);
    renderSettlementList();
};

// ---- Pricing Page (품목별 금액) ----
let selectedPricingPartner = null;
let pricingFiles = [];
let pricingRows = [];

// Set default dates (this week Monday ~ Sunday)
const startOfWeek = new Date();
const dayOfWeek = startOfWeek.getDay(); // 0=일, 1=월, ...
const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
const endOfWeek = new Date(startOfWeek);
endOfWeek.setDate(endOfWeek.getDate() + 6); // Sunday

document.getElementById('pricing-start-date').value = formatDate(startOfWeek);
document.getElementById('pricing-end-date').value = formatDate(endOfWeek);

// Partner toggle
document.getElementById('pricing-partner-group').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-toggle');
    if (!btn) return;
    document.querySelectorAll('#pricing-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPricingPartner = btn.dataset.value;

    // Show rows section
    document.getElementById('pricing-rows-section').style.display = 'block';
    document.getElementById('pricing-partner-label').textContent = `${selectedPricingPartner} 단가`;

    if (pricingRows.length === 0) addPricingRow();
});

// File upload
setupUpload('pricing-upload', 'pricing-file', 'pricing-preview', (files) => {
    pricingFiles = files;
});

// Add row
document.getElementById('pricing-add-row').addEventListener('click', addPricingRow);

function addPricingRow() {
    const container = document.getElementById('pricing-rows');
    const rowId = Date.now();
    const div = document.createElement('div');
    div.className = 'pricing-row';
    div.dataset.id = rowId;
    div.innerHTML = `
        <input type="text" placeholder="품목명" class="pricing-item-name">
        <input type="number" placeholder="단가 (원)" class="pricing-item-price">
        <button class="btn-remove-row" onclick="removePricingRow(${rowId})">×</button>
    `;
    container.appendChild(div);
}

window.removePricingRow = function(id) {
    const row = document.querySelector(`.pricing-row[data-id="${id}"]`);
    if (row) row.remove();
};

// Save pricing
document.getElementById('pricing-save').addEventListener('click', () => {
    const startDate = document.getElementById('pricing-start-date').value;
    const endDate = document.getElementById('pricing-end-date').value;
    if (!startDate || !endDate) return alert('기간을 선택해주세요.');
    if (!selectedPricingPartner) return alert('거래처를 선택해주세요.');

    // Collect rows
    const rows = [];
    document.querySelectorAll('#pricing-rows .pricing-row').forEach(row => {
        const name = row.querySelector('.pricing-item-name').value.trim();
        const price = row.querySelector('.pricing-item-price').value;
        if (name) {
            rows.push({ name, price: Number(price) || 0 });
        }
    });

    const record = {
        id: Date.now(),
        startDate,
        endDate,
        partner: selectedPricingPartner,
        items: rows,
        images: pricingFiles.map(f => f.dataUrl)
    };

    const data = loadData(STORAGE_KEYS.pricing);
    data.push(record);
    saveData(STORAGE_KEYS.pricing, data);

    // Reset
    selectedPricingPartner = null;
    pricingFiles = [];
    document.querySelectorAll('#pricing-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    document.getElementById('pricing-preview').innerHTML = '';
    document.getElementById('pricing-rows').innerHTML = '';
    document.getElementById('pricing-rows-section').style.display = 'none';

    renderPricingList();
    alert('저장되었습니다.');
});

function renderPricingList() {
    const data = loadData(STORAGE_KEYS.pricing);
    const tbody = document.getElementById('pricing-list');

    if (data.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">설정된 금액이 없습니다.</td></tr>';
    } else {
        tbody.innerHTML = data.map(item => {
            return `<tr>
                <td>${item.startDate} ~ ${item.endDate}</td>
                <td>${item.partner}</td>
                <td>${item.items ? item.items.length : 0}</td>
                <td>
                    ${item.images && item.images.length > 0 ? `<button class="btn-view" onclick="viewImages(${item.id}, 'pricing')">보기</button>` : ''}
                    <button class="btn-danger" onclick="deletePricing(${item.id})">삭제</button>
                </td>
            </tr>`;
        }).join('');
    }
}

window.deletePricing = function(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    let data = loadData(STORAGE_KEYS.pricing);
    data = data.filter(d => d.id !== id);
    saveData(STORAGE_KEYS.pricing, data);
    renderPricingList();
};

// ---- Image Viewer Modal ----
window.viewImages = function(id, type) {
    const storageKey = type === 'settlements' ? STORAGE_KEYS.settlements : STORAGE_KEYS.pricing;
    const data = loadData(storageKey);
    const item = data.find(d => d.id === id);
    if (!item || !item.images || item.images.length === 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3>첨부 이미지</h3>
            <div class="modal-images">
                ${item.images.map(img => `<img src="${img}" alt="첨부이미지">`).join('')}
            </div>
        </div>
    `;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
};

// ---- File Upload Helper ----
function setupUpload(areaId, inputId, previewId, callback) {
    const area = document.getElementById(areaId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    let files = [];

    area.addEventListener('click', () => input.click());

    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('dragover');
    });

    area.addEventListener('dragleave', () => {
        area.classList.remove('dragover');
    });

    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    input.addEventListener('change', () => {
        handleFiles(input.files);
        input.value = '';
    });

    function handleFiles(fileList) {
        Array.from(fileList).forEach(file => {
            if (!file.type.match(/image\/(jpeg|png)/)) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                const fileObj = { name: file.name, dataUrl: e.target.result };
                files.push(fileObj);
                renderPreview();
                callback(files);
            };
            reader.readAsDataURL(file);
        });
    }

    function renderPreview() {
        preview.innerHTML = files.map((f, i) => `
            <div class="preview-item">
                <img src="${f.dataUrl}" alt="${f.name}">
                <button class="remove-btn" data-index="${i}">×</button>
            </div>
        `).join('');

        preview.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                files.splice(Number(btn.dataset.index), 1);
                renderPreview();
                callback(files);
            });
        });
    }
}

// ---- Utility ----
function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ---- Date input click opens picker ----
document.querySelectorAll('input[type="date"]').forEach(input => {
    input.addEventListener('click', () => {
        if (input.showPicker) input.showPicker();
    });
});

// ---- Init ----
renderCalendar();
renderSettlementList();
renderPricingList();
