// ==========================================
// 제주아꼼이네 농업회사법인 (주) - 회사 프로그램
// ==========================================

// ---- API Helper ----
async function api(url, method = 'GET', body = null) {
    const options = { method };
    if (body) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '서버 오류' }));
        throw new Error(err.error || '서버 오류');
    }
    return res.json();
}

// 캐시 (모달 조회용)
let settlementsCache = [];
let pricingCache = [];

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
    if (pageName === 'home') renderCalendar().catch(console.error);
    if (pageName === 'settlement') renderSettlementList().catch(console.error);
    if (pageName === 'pricing') renderPricingList().catch(console.error);
}

// ---- Calendar (Home) ----
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-indexed

document.getElementById('prev-month').addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar().catch(console.error);
});

document.getElementById('next-month').addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar().catch(console.error);
});

async function renderCalendar() {
    const monthNames = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    document.getElementById('calendar-title').textContent = `${currentYear}년 ${monthNames[currentMonth]}`;

    // Update stat labels
    const monthNum = currentMonth + 1;
    document.getElementById('total-payment-label').textContent = `${monthNum}월 총 결제금액`;
    document.getElementById('daesung-payment-label').textContent = `${monthNum}월 대성(시온) 결제금액`;
    document.getElementById('hyodon-payment-label').textContent = `${monthNum}월 효돈농협 결제금액`;
    document.getElementById('cj-payment-label').textContent = `${monthNum}월 CJ택배 결제금액`;

    // Calculate payment stats from settlements
    const monthStr = `${currentYear}-${String(monthNum).padStart(2, '0')}`;
    const settlements = await api(`/api/settlements?month=${monthStr}`);

    let totalPayment = 0;
    let daesungPayment = 0;
    let hyodonPayment = 0;
    let cjPayment = 0;

    // Build daily payment map per partner
    const dailyPayments = {}; // { '2026-02-27': { daesung: 0, hyodon: 0, cj: 0 } }

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
    toggleCjMode(selectedSettlementPartner === 'CJ대한통운');
});

// CJ대한통운 모드 전환
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

// CJ 택배수량 입력 → 자동 계산
document.getElementById('cj-parcel-qty').addEventListener('input', () => {
    const qty = Number(document.getElementById('cj-parcel-qty').value) || 0;
    const amount = qty * 3100;
    document.getElementById('cj-calc-amount').textContent = amount.toLocaleString() + ' 원';
    document.getElementById('settlement-amount').value = amount;
});

// ---- 초기화 버튼 ----
document.getElementById('settlement-reset-btn').addEventListener('click', () => {
    // 날짜 초기화
    document.getElementById('settlement-date').value = '';
    // 거래처 선택 해제
    document.querySelectorAll('#settlement-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
    selectedSettlementPartner = '';
    // 결제예상금액 초기화
    document.getElementById('settlement-amount').value = '';
    // 행 목록 초기화
    document.getElementById('settlement-rows').innerHTML = '';
    resetSettlementPaste();
    // 매칭 실패 영역 숨김
    document.getElementById('sales-unmatched-container').style.display = 'none';
    // 업로드 영역 다시 표시
    document.getElementById('sales-upload-area').style.display = '';
    // CJ 모드 초기화
    toggleCjMode(false);
});

// ---- 판매현황 엑셀 업로드 ----
const salesUploadArea = document.getElementById('sales-upload-area');
const salesExcelFile = document.getElementById('sales-excel-file');

salesUploadArea.addEventListener('click', () => salesExcelFile.click());

salesExcelFile.addEventListener('change', () => {
    if (salesExcelFile.files.length > 0) {
        handleSalesExcel(salesExcelFile.files[0]);
        salesExcelFile.value = '';
    }
});

salesUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    salesUploadArea.classList.add('dragover');
});

salesUploadArea.addEventListener('dragleave', () => {
    salesUploadArea.classList.remove('dragover');
});

salesUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    salesUploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.match(/\.(xls|xlsx)$/i)) {
            handleSalesExcel(file);
        }
    }
});

// 판매현황 엑셀 파싱 + 품목별 금액 매칭
function handleSalesExcel(file) {
    if (!selectedSettlementPartner) {
        alert('먼저 거래처를 선택해주세요.');
        return;
    }

    const settlementDate = document.getElementById('settlement-date').value;
    if (!settlementDate) {
        alert('먼저 날짜를 선택해주세요.');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            if (jsonData.length === 0) return alert('엑셀에 데이터가 없습니다.');

            // 헤더에서 옵션명/수량 컬럼 찾기
            const header = jsonData[0].map(h => String(h || '').trim());
            let nameCol = -1;
            let qtyCol = -1;

            header.forEach((h, i) => {
                const lower = h.toLowerCase();
                if (lower.includes('옵션명') || lower.includes('품목명') || lower.includes('상품명') || lower.includes('품목') || lower.includes('옵션')) nameCol = i;
                if (lower.includes('수량') || lower.includes('판매수량') || lower.includes('주문수량') || lower.includes('qty')) qtyCol = i;
            });

            // 컬럼을 못 찾으면 추정
            if (nameCol === -1) nameCol = 0;
            if (qtyCol === -1) qtyCol = header.length >= 2 ? header.length - 1 : 1;

            console.log('=== 판매현황 엑셀 파싱 ===');
            console.log('헤더:', header, '품목컬럼:', nameCol, '수량컬럼:', qtyCol);

            // 엑셀에서 품목명 + 수량 추출
            const salesItems = [];
            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;

                const name = String(row[nameCol] || '').trim();
                const qty = parseInt(String(row[qtyCol] || '0').replace(/[,\s]/g, ''), 10) || 0;

                if (name && qty > 0) {
                    salesItems.push({ name, qty });
                }
            }

            console.log('=== 추출된 판매 항목 ===', salesItems);

            if (salesItems.length === 0) {
                alert('엑셀에서 품목/수량 데이터를 찾을 수 없습니다.');
                return;
            }

            // 품목별 금액에서 단가 조회 (async)
            const pricingItems = await getPricingForDate(selectedSettlementPartner, settlementDate);
            console.log('=== 품목별 금액 데이터 ===', pricingItems);

            // 디버그: 조회된 품목별 금액 목록 표시
            const pricingDebug = pricingItems.length > 0
                ? pricingItems.map(p => p.name + ' (' + p.price + '원)').join('\n')
                : '(없음)';
            console.log('[디버그] 거래처:', selectedSettlementPartner, '날짜:', settlementDate);
            console.log('[디버그] 품목별 금액:\n' + pricingDebug);

            if (pricingItems.length === 0) {
                alert('해당 날짜(' + settlementDate + ') / 거래처(' + selectedSettlementPartner + ')의 품목별 금액이 등록되지 않았습니다.\n먼저 품목별 금액에서 단가를 등록해주세요.');
                return;
            }

            // 매칭: 판매현황 품목명 → 품목별 금액 품목명
            const matched = [];
            const unmatched = [];

            for (const item of salesItems) {
                const result = matchSalesToPricing(item.name, pricingItems);
                if (result) {
                    matched.push({
                        pricingName: result.name,
                        price: result.price,
                        qty: item.qty,
                        originalName: item.name
                    });
                } else {
                    unmatched.push(item);
                }
            }

            // 같은 품목 수량 합산
            const grouped = {};
            for (const item of matched) {
                const key = item.pricingName;
                if (!grouped[key]) {
                    grouped[key] = { name: item.pricingName, price: item.price, qty: 0 };
                }
                grouped[key].qty += item.qty;
            }
            const groupedList = Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

            // 정산 폼에 채우기
            document.getElementById('settlement-rows').innerHTML = '';
            for (const item of groupedList) {
                addSettlementRow(item.name, item.price, item.qty);
            }
            for (const item of unmatched) {
                addSettlementRow(item.name, 0, item.qty);
            }

            if (groupedList.length > 0 || unmatched.length > 0) {
                showSettlementRows();
                updateSettlementTotal();
            }

            // 매칭 실패 항목 표시
            const unmatchedContainer = document.getElementById('sales-unmatched-container');
            if (unmatched.length > 0) {
                document.getElementById('sales-unmatched-list').innerHTML = unmatched.map(item =>
                    '<div class="ocr-unmatched-item">' +
                    '<span class="unmatched-name" title="' + item.name + '">' + item.name + '</span>' +
                    '<span class="unmatched-qty">' + item.qty + '개</span>' +
                    '</div>'
                ).join('');
                unmatchedContainer.style.display = 'block';
            } else {
                unmatchedContainer.style.display = 'none';
            }

            // 결과 알림 (상세)
            let msg = '=== 매칭 결과 ===\n';
            msg += '품목별 금액 등록: ' + pricingItems.length + '개\n';
            msg += '매칭 성공: ' + groupedList.length + '개 / 실패: ' + unmatched.length + '개\n\n';
            if (groupedList.length > 0) {
                msg += '[매칭 성공]\n';
                groupedList.forEach(g => { msg += '  ' + g.name + ' (' + g.price + '원 x ' + g.qty + ')\n'; });
            }
            if (unmatched.length > 0) {
                msg += '\n[매칭 실패]\n';
                unmatched.forEach(u => { msg += '  ' + u.name + '\n'; });
            }
            alert(msg);

        } catch (err) {
            alert('엑셀 파일을 읽는데 실패했습니다: ' + err.message);
            console.error('Sales Excel Error:', err);
        }
    };
    reader.readAsArrayBuffer(file);
}

// 판매현황 품목명 → 품목별 금액 매칭 (키워드 기반)
function matchSalesToPricing(salesName, pricingItems) {
    // 1순위: 정확히 일치
    for (const p of pricingItems) {
        if (p.name === salesName) return p;
    }

    // 2순위: 키워드 매칭
    const salesLower = salesName.toLowerCase();
    let bestMatch = null;
    let bestKeywordCount = 0;

    for (const p of pricingItems) {
        const keywords = p.name.split(/\s+/).filter(k => k.length > 0);
        const allMatch = keywords.every(kw => containsKeyword(salesLower, kw.toLowerCase()));

        if (allMatch && keywords.length > bestKeywordCount) {
            bestKeywordCount = keywords.length;
            bestMatch = p;
        }
    }

    if (bestMatch) {
        console.log('[매칭 성공]', salesName, '→', bestMatch.name, '(키워드', bestKeywordCount + '개)');
    } else {
        console.log('[매칭 실패]', salesName);
    }

    return bestMatch;
}

// 키워드가 텍스트에 포함되는지 확인
function containsKeyword(text, keyword) {
    let idx = 0;
    while (idx <= text.length - keyword.length) {
        const pos = text.indexOf(keyword, idx);
        if (pos === -1) return false;
        if (/^\d/.test(keyword) && pos > 0 && /\d/.test(text[pos - 1])) {
            idx = pos + 1;
            continue;
        }
        return true;
    }
    return false;
}

// 해당 날짜/거래처의 품목별 단가 조회
async function getPricingForDate(partner, dateStr) {
    const pricingData = await api('/api/pricing');
    const applicable = pricingData.filter(p => {
        return p.partner === partner && p.startDate <= dateStr && p.endDate >= dateStr;
    });

    if (applicable.length === 0) return [];

    // 여러 기간이 겹치면 최신 기록 우선
    const itemMap = {};
    applicable.sort((a, b) => a.id - b.id);
    applicable.forEach(p => {
        (p.items || []).forEach(item => {
            itemMap[item.name] = item.price;
        });
    });

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

// Settlement rows (결제가 입력)
document.getElementById('settlement-add-row').addEventListener('click', () => addSettlementRow());

function addSettlementRow(name, price, qty) {
    name = name || '';
    price = price || '';
    qty = qty || 1;
    const subtotal = (Number(price) || 0) * (Number(qty) || 0);

    const container = document.getElementById('settlement-rows');
    const rowId = Date.now() + Math.random();
    const div = document.createElement('div');
    div.className = 'settlement-row';
    div.dataset.id = rowId;
    div.innerHTML = `
        <input type="text" placeholder="품목명" class="s-item-name" value="${name}">
        <input type="number" placeholder="단가" class="s-item-price" value="${price}">
        <input type="number" placeholder="수량" class="s-item-qty" value="${qty}">
        <span class="s-item-subtotal">${subtotal.toLocaleString()} 원</span>
        <button class="btn-remove-row" onclick="removeSettlementRow(this)">×</button>
    `;
    container.appendChild(div);

    showSettlementRows();

    // 소계 자동 계산
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

window.removeSettlementRow = function(btn) {
    btn.closest('.settlement-row').remove();
    updateSettlementTotal();
};

function updateSettlementTotal() {
    let total = 0;
    document.querySelectorAll('#settlement-rows .settlement-row').forEach(row => {
        const price = Number(row.querySelector('.s-item-price').value) || 0;
        const qty = Number(row.querySelector('.s-item-qty').value) || 0;
        total += price * qty;
    });
    document.getElementById('settlement-amount').value = total;
}

// Month filter change
document.getElementById('settlement-month-filter').addEventListener('change', () => {
    renderSettlementList().catch(console.error);
});

// Save
document.getElementById('settlement-save').addEventListener('click', async () => {
    try {
        const date = document.getElementById('settlement-date').value;
        if (!date) return alert('날짜를 선택해주세요.');
        if (!selectedSettlementPartner) return alert('거래처를 선택해주세요.');

        let items = [];
        let amount = 0;

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

        const record = {
            date: date,
            partner: selectedSettlementPartner,
            amount: amount,
            items: items
        };

        await api('/api/settlements', 'POST', record);

        // Reset form
        selectedSettlementPartner = null;
        document.getElementById('settlement-amount').value = '';
        document.querySelectorAll('#settlement-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
        document.getElementById('settlement-rows').innerHTML = '';
        resetSettlementPaste();
        toggleCjMode(false);

        await renderSettlementList();
        alert('저장되었습니다.');
    } catch (err) {
        alert('저장 실패: ' + err.message);
        console.error('Settlement save error:', err);
    }
});

async function renderSettlementList() {
    const monthVal = document.getElementById('settlement-month-filter').value;
    const url = monthVal ? `/api/settlements?month=${monthVal}` : '/api/settlements';
    const data = await api(url);

    // 캐시 업데이트 (상세보기 모달용)
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
    try {
        await api(`/api/settlements/${id}`, 'DELETE');
        await renderSettlementList();
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};

window.viewSettlementItems = function(id) {
    const item = settlementsCache.find(d => d.id === id);
    if (!item || !item.items || item.items.length === 0) return;

    const rows = item.items.map(i => `
        <tr>
            <td>${i.name}</td>
            <td style="text-align:right">${(i.price || 0).toLocaleString()} 원</td>
            <td style="text-align:center">${i.qty || 1}</td>
            <td style="text-align:right">${(i.subtotal || i.price || 0).toLocaleString()} 원</td>
        </tr>
    `).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            <h3>${item.date} - ${item.partner} 상세</h3>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>품목명</th>
                        <th style="text-align:right">단가</th>
                        <th style="text-align:center">수량</th>
                        <th style="text-align:right">소계</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="3"><strong>합계</strong></td>
                        <td style="text-align:right"><strong>${(item.amount || 0).toLocaleString()} 원</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
};

// ---- Pricing Page (품목별 금액) ----
let selectedPricingPartner = null;

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
});

// Pricing Excel upload / paste
const pricingPasteArea = document.getElementById('pricing-paste-area');
const pricingExcelInput = document.getElementById('pricing-excel-file');

pricingPasteArea.addEventListener('click', () => pricingExcelInput.click());

pricingExcelInput.addEventListener('change', () => {
    if (pricingExcelInput.files.length > 0) {
        parsePricingExcel(pricingExcelInput.files[0]);
        pricingExcelInput.value = '';
    }
});

pricingPasteArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    pricingPasteArea.classList.add('dragover');
});

pricingPasteArea.addEventListener('dragleave', () => {
    pricingPasteArea.classList.remove('dragover');
});

pricingPasteArea.addEventListener('drop', (e) => {
    e.preventDefault();
    pricingPasteArea.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.match(/\.(xls|xlsx)$/i)) {
            parsePricingExcel(file);
            return;
        }
    }
    const text = e.dataTransfer.getData('text');
    if (text) parsePricingText(text);
});

pricingPasteArea.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    if (text) parsePricingText(text);
});

document.getElementById('page-pricing').addEventListener('paste', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    if (text) parsePricingText(text);
});

function parsePricingExcel(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            if (jsonData.length === 0) return alert('엑셀에 데이터가 없습니다.');

            const header = jsonData[0].map(h => String(h || '').trim());
            let nameCol = -1;
            let priceCol = -1;

            header.forEach((h, i) => {
                const lower = h.toLowerCase();
                if (lower.includes('옵션명') || lower.includes('품목명') || lower.includes('상품명') || lower.includes('품목')) nameCol = i;
                if (lower.includes('단가') || lower.includes('가격') || lower.includes('금액')) priceCol = i;
            });

            if (nameCol === -1) nameCol = 0;
            if (priceCol === -1) priceCol = header.length >= 2 ? 1 : -1;

            document.getElementById('pricing-rows').innerHTML = '';

            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;
                const name = String(row[nameCol] || '').trim();
                let price = 0;
                if (priceCol >= 0 && row[priceCol] != null) {
                    price = Number(String(row[priceCol]).replace(/[,원\s]/g, '')) || 0;
                }
                if (name) addPricingRow(name, price);
            }

            showPricingRows();
        } catch (err) {
            alert('엑셀 파일을 읽는데 실패했습니다: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function parsePricingText(text) {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    document.getElementById('pricing-rows').innerHTML = '';

    lines.forEach(line => {
        const parts = line.split(/\t/).map(s => s.trim()).filter(s => s);
        let name = '';
        let price = 0;

        if (parts.length >= 2) {
            const priceStr = parts[parts.length - 1].replace(/[,원\s]/g, '');
            price = Number(priceStr) || 0;
            name = parts.slice(0, parts.length - 1).join(' ');
        } else {
            const match = line.match(/^(.+?)\s{2,}([\d,]+)/);
            if (match) {
                name = match[1].trim();
                price = Number(match[2].replace(/,/g, '')) || 0;
            } else {
                name = line.trim();
            }
        }

        if (name && !name.match(/^(옵션명|품목명|상품명|단가|가격)$/)) {
            addPricingRow(name, price);
        }
    });

    showPricingRows();
}

function showPricingRows() {
    document.getElementById('pricing-rows-header').style.display = 'flex';
    document.getElementById('pricing-add-row').style.display = '';
    document.getElementById('pricing-paste-area').style.display = 'none';
}

function resetPricingPaste() {
    document.getElementById('pricing-rows-header').style.display = 'none';
    document.getElementById('pricing-add-row').style.display = 'none';
    document.getElementById('pricing-paste-area').style.display = '';
}

// Add row
document.getElementById('pricing-add-row').addEventListener('click', () => addPricingRow());

function addPricingRow(name, price) {
    name = name || '';
    price = price || '';
    const container = document.getElementById('pricing-rows');
    const rowId = Date.now() + Math.random();
    const div = document.createElement('div');
    div.className = 'pricing-row';
    div.dataset.id = rowId;
    div.innerHTML = `
        <input type="text" placeholder="품목명" class="pricing-item-name" value="${name}">
        <input type="number" placeholder="단가 (원)" class="pricing-item-price" value="${price}">
        <button class="btn-remove-row" onclick="removePricingRow(this)">×</button>
    `;
    container.appendChild(div);
    showPricingRows();
}

window.removePricingRow = function(btn) {
    btn.closest('.pricing-row').remove();
};

// Save pricing
document.getElementById('pricing-save').addEventListener('click', async () => {
    try {
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

        if (rows.length === 0) return alert('품목을 입력해주세요.');

        const record = {
            startDate,
            endDate,
            partner: selectedPricingPartner,
            items: rows
        };

        // 서버에서 pricing + settlement 동시 저장
        await api('/api/pricing', 'POST', record);

        // Reset
        selectedPricingPartner = null;
        document.querySelectorAll('#pricing-partner-group .btn-toggle').forEach(b => b.classList.remove('active'));
        document.getElementById('pricing-rows').innerHTML = '';
        resetPricingPaste();

        await renderPricingList();
        await renderSettlementList();
        alert('저장되었습니다.');
    } catch (err) {
        alert('저장 실패: ' + err.message);
        console.error('Pricing save error:', err);
    }
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
                rows += `<tr>
                    <td>${item.startDate} ~ ${item.endDate}</td>
                    <td>${item.partner}</td>
                    <td>-</td>
                    <td>-</td>
                </tr>`;
            } else {
                const colorClass = item.partner === '대성(시온)' ? 'pricing-daesung' : 'pricing-hyodon';
                items.forEach((it, idx) => {
                    rows += `<tr class="${colorClass}">
                        ${idx === 0 ? `<td rowspan="${items.length}">${item.startDate} ~ ${item.endDate}<br><button class="btn-danger" style="margin-top:6px" onclick="deletePricing(${item.id})">삭제</button></td>` : ''}
                        ${idx === 0 ? `<td rowspan="${items.length}">${item.partner}</td>` : ''}
                        <td>${it.name}</td>
                        <td>${(it.price || 0).toLocaleString()} 원</td>
                    </tr>`;
                });
            }
        });
        tbody.innerHTML = rows;
    }
}

window.deletePricing = async function(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
        await api(`/api/pricing/${id}`, 'DELETE');
        await renderPricingList();
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};

// ---- Image Viewer Modal ----
window.viewImages = function(id, type) {
    const cache = type === 'settlements' ? settlementsCache : pricingCache;
    const item = cache.find(d => d.id === id);
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

// ---- Excel Upload Helper ----
function setupExcelUpload(areaId, inputId, previewId, callback) {
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
            if (!file.name.match(/\.(xls|xlsx)$/i)) return;
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
            <div class="excel-preview-item">
                <span class="excel-icon">📊</span>
                <span class="excel-name">${f.name}</span>
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
async function init() {
    try {
        await renderCalendar();
        await renderSettlementList();
        await renderPricingList();
    } catch (err) {
        console.error('초기화 오류:', err);
    }
}
init();
