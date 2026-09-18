// #452(대표 GO 9/18) 송장변환 테스트 v2 — 본 화면(app.js 송장변환)은 무접촉. 변환·시트1 스타일은 app.js의 실코드를 그대로 떼어 실행(중복 구현 0 → 시트1 = 현행과 동일).
//   추가분: ① 개별발송 번호(입력o·삭제x) 1회성 제외 ② 배송메모 해석(서버 /invoice/memo-parse)으로 「오늘 발송 아님」 후보 미리 체크 + 검토 목록
//          ③ 시트2 = 네이버 「전체주문발주발송관리」 원본 양식(안내 1행·27열·시트명 동일·시트1과 행 순서 동일·개별발송 건은 맨 아래 노란 배경)
(() => {
    const $ = id => document.getElementById(id);
    const aoEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    async function api(url, method = 'GET', body = null) {
        const token = localStorage.getItem('jwt_token');
        const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
        if (r.status === 401) { $('login-gate').style.display = ''; throw new Error('로그인 필요'); }
        return r.json();
    }
    const HDR = ['상품주문번호', '배송방법(구매자 요청)', '배송방법', '택배사', '송장번호', '구매자명', '수취인명', '옵션정보', '수량', '수취인연락처1', '수취인연락처2', '통합배송지', '배송메세지', '구매자연락처', '주문번호', '발송일', '주문상태', '결제일', '상품번호', '상품명', '정산예정금액', '주문일시', '발송기한', '구매자ID', '고객 등급', '1년 주문건수', '주문 유입경로'];
    const INSTR_A = "◈ 다운로드 받은 파일로 '엑셀 일괄발송' 처리하는 방법\r\n1. 엑셀 파일에 아래 네 가지 항목을 확인 후 입력해주세요.\r\n- 상품주문번호, 배송방법, 택배사, 송장번호\r\n- 일괄발송 처리 시, 네 개 열이 반드시 있어야 합니다.\r\n2. 발송처리할 데이터가 있는 시트명을 '발송처리'로 저장해주세요.\r\n3. '엑셀 일괄발송' 처리 시, 해당 파일로 업로드하여 처리하시면 됩니다.\r\n\r\n※ 파일 업로드 시, 1행 삭제 후 업로드 부탁 드립니다.     \r\n※ (주의) 판매채널이 선물하기 주문인 경우, 주문/배송/설치 등의 안내는 구매자 연락처가 아닌 수취인 연락처를 통해 진행해주시길 바랍니다. 선물 구매자에게 수취인의 개인정보를 전달하여 발생하는 모든 책임은 판매자 당사자에게 있습니다.";
    const INSTR_D = "◈ 각 항목 입력 방법\r\n배송방법 - 택배,등기,소포 / 퀵서비스 / 방문수령 / 직접전달\r\n택배사 - '택배,등기,소포'가 아닌 방법으로 발송하시는 경우에는 택배사 및 송장번호는 공란으로 두시면 됩니다.\r\n판매자센터 택배사 리스트에 있는 명칭 그대로 입력해주세요.\r\n해외기타택배는 택배사 리스트에 없는 경우에만 사용하셔야 하며, 국내로 들어오는 시점에 ‘판매관리 > 배송현황관리’ 메뉴에서 국내송장으로 수정하셔야 합니다.\r\n해외기타택배일 경우 “해외기타택배#택배사명”형태로 입력하시면 됩니다. (ex. 해외기타택배#ABCDE)\r\n송장번호\r\n- 발송처리 시 사용된 송장번호를 입력해주세요.";
    // 검토 목록용 넓은 날짜 표현(현행 시트1 빨간 표시 규칙 + 점 날짜) — 해석기가 null인데 이 표현이 있으면 「확인필요」
    const BROAD = /다음\s*주|다음\s*날|내일|모레|글피|\d+\s*일|\d+\s*월|\d+\s*\/\s*\d+|\d{1,2}\s*\.\s*\d{1,2}|월요|화요|수요|목요|금요|토요|일요|주말|평일|다다음|이번\s*주|일주일|이후|이전|전에|까지|늦게|천천히|나중/;   // 「추석·명절·연휴」는 인사말(풍성한 추석 되세요)에 걸려 제외 — 「명절 전에」는 「전에」로 잡힘
    const CH_LABEL = { naver: '🛒 네이버', cafe24: '🏠 자사몰', coupang: '🛍️ 쿠팡' };

    let P = null;   // app.js에서 떼어낸 실코드(변환 3종·시트1 내보내기·단가표 로드)
    async function loadProd() {
        const txt = await (await fetch('/app.js?ivt=' + Date.now())).text();
        const a = txt.indexOf('function detectSize(msg)'); const b = txt.indexOf('// 채널 초기화');
        if (a < 0 || b < 0 || b <= a) throw new Error('app.js 변환 코드 위치를 찾지 못했습니다');
        const code = txt.slice(a, b);
        P = new Function('api', 'aoEsc', 'XLSX', 'document', code + '\nreturn { convertDataSmart, convertDataJasamol, convertDataCoupang, exportInvoiceExcel, aoLoadInvoicePricing };')(api, aoEsc, XLSX, document);
        await P.aoLoadInvoicePricing();
    }

    const S = { naver: null, cafe24: [], coupang: [], merged: [], today: null };

    function rebuild() {
        const entries = [];
        if (S.naver) P.convertDataSmart(S.naver.rows).forEach((conv, i) => entries.push({ ch: 'naver', i, conv }));
        if (S.cafe24.length) P.convertDataJasamol(S.cafe24).forEach((conv, i) => entries.push({ ch: 'cafe24', i, conv }));
        if (S.coupang.length) P.convertDataCoupang(S.coupang).forEach((conv, i) => entries.push({ ch: 'coupang', i, conv }));
        entries.sort((a, b) => (a.conv['옵션정보'] || '').localeCompare(b.conv['옵션정보'] || '', 'ko'));   // = 본 화면 getMergedConverted 정렬
        const prev = new Map(S.merged.map(e => [e.ch + ':' + e.i, e]));
        entries.forEach(e => { const p = prev.get(e.ch + ':' + e.i); e.excluded = p ? p.excluded : false; e.userTouched = p ? p.userTouched : false; e.parse = p ? p.parse : null; e.flag = p ? p.flag : null; });
        S.merged = entries;
        applyIndividual();
    }
    const rawOf = e => e.ch === 'naver' ? S.naver.rows[e.i] : e.ch === 'cafe24' ? S.cafe24[e.i] : S.coupang[e.i];
    function parseNums(txt) { return String(txt || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).map(s => ({ raw: s, digits: s.replace(/\D/g, '') })); }
    function applyIndividual() {
        const ex = { naver: parseNums($('ex-naver').value), cafe24: parseNums($('ex-cafe24').value), coupang: parseNums($('ex-coupang').value) };
        const hit = { naver: 0, cafe24: 0, coupang: 0 };
        S.merged.forEach(e => {
            const raw = rawOf(e) || {};
            const tel = String(e.conv['구매자연락처'] || raw['구매자연락처'] || raw['주문자 휴대전화'] || raw['구매자전화번호'] || '').replace(/\D/g, '');
            const ids = [raw._orderId, raw['주문번호'], raw['상품주문번호'], raw._x && raw._x.orderId].filter(Boolean).map(String);
            e.individual = ex[e.ch].some(n => (n.digits.length >= 8 && tel && tel === n.digits) || (n.raw && ids.includes(n.raw)));
            if (e.individual) hit[e.ch]++;
        });
        const entered = ex.naver.length + ex.cafe24.length + ex.coupang.length;
        $('msg-ex').textContent = entered ? `입력 ${entered}개 → 개별발송으로 분류된 주문: 네이버 ${hit.naver}건 · 자사몰 ${hit.cafe24}건 · 쿠팡 ${hit.coupang}건` : '';
    }
    async function parseMemos() {
        if (!S.merged.length) return;
        const memos = S.merged.map(e => String(e.conv['배송메세지'] || ''));
        const r = await api('/api/agent-office/invoice/memo-parse', 'POST', { memos });
        if (!r.ok) throw new Error(r.message || '메모 해석 실패');
        S.today = r.today;
        S.merged.forEach((e, k) => {
            const p = r.results[k] || null; e.parse = p;
            e.flag = (p && (p.kind === 'ship' || p.kind === 'arrive') && p.reqDate && p.reqDate > S.today) ? 'excl'
                : (p && p.kind === 'ack') ? 'review'
                : (!p && BROAD.test(memos[k])) ? 'review' : null;
            if (!e.userTouched) e.excluded = (e.flag === 'excl');
        });
    }
    function statusOf(e) {
        if (e.individual) return '<span class="tag indiv">개별발송(시트2만)</span>';
        if (e.excluded) return '<span class="tag excl">제외(오늘 발송 아님)</span>';
        if (e.flag === 'review') return '<span class="tag review">확인필요</span>';
        return '';
    }
    function reqOf(e) {
        const p = e.parse; if (!p) return '';
        if (p.kind === 'ship') return `${p.reqDate} 발송 요청`;
        if (p.kind === 'arrive') return `${p.reqDate} 도착 요청`;
        return '애매함 — 직원 확인';
    }
    function cb(e, k) { return e.individual ? '' : `<input type="checkbox" data-k="${k}" ${e.excluded ? 'checked' : ''}>`; }
    function render() {
        const pv = $('preview').querySelector('tbody'); const rv = $('review').querySelector('tbody');
        pv.innerHTML = S.merged.map((e, k) => `<tr class="${e.individual ? 'indiv' : e.excluded ? 'excl' : e.flag === 'review' ? 'review' : ''}"><td>${cb(e, k)}</td><td>${k + 1}</td><td class="ch">${CH_LABEL[e.ch]}</td><td>${aoEsc(e.conv['수취인명'])}</td><td>${aoEsc(e.conv['옵션정보'])}</td><td>${aoEsc(e.conv['수량'])}</td><td>${aoEsc(String(e.conv['배송지'] || '').slice(0, 40))}</td><td class="memo">${aoEsc(e.conv['배송메세지'])}</td><td>${statusOf(e)}</td></tr>`).join('');
        const revRows = S.merged.map((e, k) => ({ e, k })).filter(({ e }) => !e.individual && (e.excluded || e.flag));
        rv.innerHTML = revRows.length ? revRows.map(({ e, k }) => `<tr class="${e.excluded ? 'excl' : 'review'}"><td>${cb(e, k)}</td><td class="ch">${CH_LABEL[e.ch]}</td><td>${aoEsc(e.conv['수취인명'])}</td><td>${aoEsc(e.conv['옵션정보'])}</td><td>${aoEsc(e.conv['수량'])}</td><td class="memo">${aoEsc(e.conv['배송메세지'])}</td><td>${aoEsc(reqOf(e))}</td><td>${statusOf(e)}</td></tr>`).join('')
            : '<tr><td colspan="8" style="color:#6B7280;">검토할 배송메모가 없습니다.</td></tr>';
        const n = S.merged.length, indiv = S.merged.filter(e => e.individual).length, excl = S.merged.filter(e => !e.individual && e.excluded).length, review = S.merged.filter(e => !e.individual && !e.excluded && e.flag === 'review').length;
        $('stats').innerHTML = `<span>전체 <b>${n}</b>건</span><span>시트1(택배사) <b>${n - indiv - excl}</b>건</span><span>개별발송 <b>${indiv}</b>건</span><span>제외 체크 <b>${excl}</b>건</span><span>확인필요 <b>${review}</b>건</span>${S.today ? `<span>기준일 ${S.today}</span>` : ''}`;
        $('btn-download').disabled = !n;
        document.querySelectorAll('#preview input[type=checkbox], #review input[type=checkbox]').forEach(el => el.addEventListener('change', () => { const e = S.merged[Number(el.dataset.k)]; e.excluded = el.checked; e.userTouched = true; render(); }));
    }
    // 입력원을 새로 넣으면 그 채널의 이전 결정(체크·직접 수정)은 버린다 — 인덱스가 같아도 다른 주문일 수 있음
    async function refreshAll(resetCh) { if (resetCh) S.merged = S.merged.filter(e => e.ch !== resetCh); rebuild(); await parseMemos(); render(); }

    // ── 시트2: 네이버 원본 양식
    const serial = iso => { const ms = Date.parse(iso || ''); return isNaN(ms) ? null : (ms + 9 * 3600e3) / 86400e3 + 25569; };
    const DATE_Z = 'yyyy/mm/dd\\ hh:mm', WON_Z = '"₩"#,##0';
    const dmLabel = v => ({ DELIVERY: '택배,등기,소포', DIRECT_DELIVERY: '직접전달', QUICK_SVC: '퀵서비스', VISIT_RECEIPT: '방문수령', NOTHING: '' })[v] ?? (v || '');
    const maskId = id => { const s = String(id || ''); return s.length > 4 ? s.slice(0, 4) + '*'.repeat(s.length - 4) : s; };
    const sCell = v => ({ t: 's', v: String(v == null ? '' : v) });
    const nCell = (v, z) => (v == null || v === '') ? sCell('') : { t: 'n', v: Number(v), z };
    const dCell = iso => { const s = serial(iso); return s == null ? sCell('') : { t: 'n', v: s, z: DATE_Z }; };
    function rowCells(i) {
        const nv = S.naver;
        if (nv.src === 'file') {
            const r = nv.hdrIdx + 1 + i; const out = [];
            for (let c = 0; c < 27; c++) { const src = nv.ws[XLSX.utils.encode_cell({ r, c })]; out.push(src ? { t: src.t, v: src.v, ...(src.z ? { z: src.z } : {}) } : sCell('')); }
            return out;
        }
        const row = nv.rows[i], x = row._x || {};
        return [sCell(x.productOrderId || row._pid), sCell(dmLabel(x.deliveryMethod)), sCell('택배,등기,소포'), sCell('CJ대한통운'), sCell(''),
            sCell(row['구매자명']), sCell(row['수취인명']), sCell(row['옵션정보']), nCell(row['수량'], null), sCell(row['수취인연락처1']), sCell(row['수취인연락처2']),
            sCell(row['통합배송지']), sCell(row['배송메세지']), sCell(row['구매자연락처']), sCell(x.orderId), sCell(''), sCell(x.productOrderStatus === 'PAYED' ? '발송대기' : (x.productOrderStatus || '')),
            dCell(x.paymentDate), sCell(x.productId), sCell(x.productName), nCell(x.expectedSettlementAmount, WON_Z), dCell(x.orderDate), dCell(x.shippingDueDate),
            sCell(maskId(x.ordererId)), sCell(''), sCell(''), sCell(x.inflowPath)];
    }
    function buildSheet2(list) {
        const ws = {}; const put = (r, c, cell) => { ws[XLSX.utils.encode_cell({ r, c })] = cell; };
        const wrap = { alignment: { wrapText: true, vertical: 'top' }, fill: { fgColor: { rgb: 'FFFFCC' } } };
        put(0, 0, { t: 's', v: INSTR_A, s: wrap }); put(0, 3, { t: 's', v: INSTR_D, s: wrap });
        HDR.forEach((h, c) => put(1, c, { t: 's', v: h, s: { font: { bold: true }, fill: { fgColor: { rgb: 'DDEBF7' } }, alignment: { horizontal: 'center' } } }));
        const ordered = list.filter(e => e.ch === 'naver').map(e => ({ i: e.i, indiv: false }));
        const indiv = S.merged.filter(e => e.ch === 'naver' && e.individual && !e.excluded).map(e => ({ i: e.i, indiv: true }));
        let r = 2;
        for (const { i, indiv: yellow } of ordered.concat(indiv)) {
            rowCells(i).forEach((cell, c) => { if (yellow) cell.s = { ...(cell.s || {}), fill: { fgColor: { rgb: 'FFF2CC' } } }; put(r, c, cell); });
            r++;
        }
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, 1), c: 26 } });
        ws['!merges'] = [{ s: { c: 0, r: 0 }, e: { c: 2, r: 0 } }, { s: { c: 3, r: 0 }, e: { c: 5, r: 0 } }];
        ws['!rows'] = [{ hpt: 150 }]; ws['!cols'] = HDR.map(() => ({ wch: 27.7 }));
        return { ws, count: ordered.length, indiv: indiv.length };
    }
    function download() {
        applyIndividual();
        const list = S.merged.filter(e => !e.individual && !e.excluded);
        if (!list.length) { $('msg-dl').textContent = '내보낼 주문이 없습니다.'; return null; }
        let captured = null; const origWrite = XLSX.writeFile;
        XLSX.writeFile = (wb, name) => { captured = { wb, name }; };
        try { P.exportInvoiceExcel(list.map(e => e.conv)); } finally { XLSX.writeFile = origWrite; }   // 시트1 = 본 화면 실코드 그대로
        if (!captured) throw new Error('시트1 생성 실패');
        let s2 = null;
        if (S.naver) { s2 = buildSheet2(list); XLSX.utils.book_append_sheet(captured.wb, s2.ws, '발주발송관리'); }
        const name = captured.name.replace(/\.xlsx$/i, '') + '_v2.xlsx';
        origWrite(captured.wb, name);
        $('msg-dl').textContent = `${name} — 시트1 ${list.length}건${s2 ? ` · 시트2 ${s2.count + s2.indiv}건(개별발송 ${s2.indiv}건 노란 표시)` : ''}`;
        return captured.wb;
    }

    // ── 입력원
    const days = ch => Math.min(Math.max(parseInt($('days-' + ch).value) || 50, 1), 180);
    const setMsg = (ch, html) => { $('msg-' + ch).innerHTML = html; };
    const markArea = (ch, label) => { const a = $('area-' + ch); a.classList.add('has-file'); $('fname-' + ch).textContent = label; };
    async function loadNaverApi() {
        setMsg('naver', `네이버 배송준비 조회 중(최근 ${days('naver')}일)…`);
        const r = await api('/api/agent-office/naver/invoice-orders-v2?days=' + days('naver'));
        if (!r.ok) { setMsg('naver', '⚠️ ' + aoEsc(r.message || '불러오기 실패')); return; }
        S.naver = { src: 'api', rows: r.rows || [] };
        markArea('naver', `🛰️ 네이버 배송준비 ${r.count}건`);
        setMsg('naver', `✅ 배송준비 <b>${r.count}건</b> 불러왔습니다(API — 비밀번호 없음).`);
        await refreshAll('naver');
    }
    async function loadOther(ch) {
        setMsg(ch, '조회 중…');
        const r = await api(`/api/agent-office/${ch}/invoice-orders?days=` + days(ch));
        if (!r.ok) { setMsg(ch, '⚠️ ' + aoEsc(r.message || '불러오기 실패')); return; }
        S[ch] = r.rows || [];
        markArea(ch, `${CH_LABEL[ch]} ${r.count}건`);
        setMsg(ch, `✅ <b>${r.count}건</b> 불러왔습니다.`);
        await refreshAll(ch);
    }
    // 네이버 다운로드 파일은 비밀번호(대표: 다운로드 시 입력)로 잠겨 있을 수 있다 — CFB 서명이면 서버(/api/invoice/decrypt)로 자동 해제
    const isEncrypted = buf => { const b = new Uint8Array(buf.slice(0, 8)); return b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0; };
    const toB64 = buf => { let bin = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); };
    async function readWorkbook(file, ch) {
        const buf = await file.arrayBuffer();
        if (isEncrypted(buf)) {
            $('area-' + ch).classList.add('decrypting'); setMsg(ch, '🔐 비밀번호 파일 — 자동 해제 중…');
            try {
                const r = await api('/api/invoice/decrypt', 'POST', { fileBase64: toB64(buf) });
                if (!r.fileBase64) throw new Error(r.error || '복호화 실패');
                return { wb: XLSX.read(r.fileBase64, { type: 'base64', cellStyles: true }), decrypted: true };
            } finally { $('area-' + ch).classList.remove('decrypting'); }
        }
        return { wb: XLSX.read(buf, { type: 'array', cellStyles: true }), decrypted: false };
    }
    async function loadFile(ch, file) {
        const { wb, decrypted } = await readWorkbook(file, ch);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        if (ch === 'naver') {
            const hdrIdx = aoa.findIndex(r => Array.isArray(r) && r.includes('상품주문번호'));
            if (hdrIdx < 0) { setMsg('naver', '⚠️ 네이버 발주발송관리 파일이 아닙니다(상품주문번호 헤더 없음)'); return; }
            const H = aoa[hdrIdx];
            const rows = aoa.slice(hdrIdx + 1).filter(r => Array.isArray(r) && r.some(v => v != null && v !== '')).map(r => { const o = {}; H.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; }); return o; });
            S.naver = { src: 'file', rows, ws, hdrIdx, fileName: file.name };
            markArea('naver', file.name);
            setMsg('naver', `✅ 주문 <b>${rows.length}건</b>${decrypted ? ' · 🔐 비밀번호 자동 해제' : ''}`);
        } else {
            const H = aoa[0] || [];
            const rows = aoa.slice(1).filter(r => Array.isArray(r) && r.some(v => v != null && v !== '')).map(r => { const o = {}; H.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; }); return o; });
            S[ch] = rows; markArea(ch, file.name); setMsg(ch, `✅ <b>${rows.length}건</b>`);
        }
        await refreshAll(ch);
    }
    function reset() {
        S.naver = null; S.cafe24 = []; S.coupang = []; S.merged = []; S.today = null;
        ['ex-naver', 'ex-cafe24', 'ex-coupang'].forEach(id => $(id).value = '');
        ['naver', 'cafe24', 'coupang'].forEach(ch => { $('area-' + ch).classList.remove('has-file'); $('fname-' + ch).textContent = ''; setMsg(ch, ''); });
        $('msg-ex').textContent = ''; $('msg-dl').textContent = ''; render();
    }

    // ── 이벤트
    document.addEventListener('DOMContentLoaded', async () => {
        if (!localStorage.getItem('jwt_token')) $('login-gate').style.display = '';
        try { await loadProd(); } catch (e) { setMsg('naver', '⚠️ ' + aoEsc(e.message)); return; }
        $('btn-naver').addEventListener('click', () => loadNaverApi().catch(e => setMsg('naver', '⚠️ ' + aoEsc(e.message))));
        $('btn-cafe24').addEventListener('click', () => loadOther('cafe24').catch(e => setMsg('cafe24', '⚠️ ' + aoEsc(e.message))));
        $('btn-coupang').addEventListener('click', () => loadOther('coupang').catch(e => setMsg('coupang', '⚠️ ' + aoEsc(e.message))));
        $('btn-reset').addEventListener('click', reset);
        $('btn-download').addEventListener('click', () => { try { download(); } catch (e) { $('msg-dl').textContent = '⚠️ ' + e.message; } });
        ['ex-naver', 'ex-cafe24', 'ex-coupang'].forEach(id => $(id).addEventListener('input', () => { applyIndividual(); render(); }));
        for (const ch of ['naver', 'cafe24', 'coupang']) {
            const area = $('area-' + ch), input = $('file-' + ch);
            area.addEventListener('click', () => input.click());
            area.addEventListener('dragover', ev => { ev.preventDefault(); area.classList.add('dragover'); });
            area.addEventListener('dragleave', () => area.classList.remove('dragover'));
            area.addEventListener('drop', ev => { ev.preventDefault(); area.classList.remove('dragover'); const f = ev.dataTransfer.files[0]; if (f) loadFile(ch, f).catch(e => setMsg(ch, '⚠️ ' + aoEsc(e.message))); });
            input.addEventListener('change', () => { const f = input.files[0]; if (f) loadFile(ch, f).catch(e => setMsg(ch, '⚠️ ' + aoEsc(e.message))); input.value = ''; });
        }
        render();
        window.__ivt = { S, refreshAll, render, download, setNaverApiRows: async rows => { S.naver = { src: 'api', rows }; await refreshAll('naver'); } };   // 검증용 훅
    });
})();
