// #452(대표 GO 9/18) 송장변환 테스트 v2 — 본 화면(app.js 송장변환·중간발주)은 무접촉. 변환·시트1 스타일·중간발주 집계/렌더는 app.js의 실코드를 그대로 떼어 실행(중복 구현 0).
//   [송장 변환 탭] ① 개별발송 번호(입력o·삭제x) 1회성 제외(채널별) ② ☎ 지정 발송일 요청(채널별·직원 메모 우선) ③ 배송메모 해석(서버 /invoice/memo-parse)으로 「오늘 발송 아님」 후보 미리 체크 + 검토 목록
//                 ④ 시트2 = 네이버 「전체주문발주발송관리」 원본 양식(안내 1행·27열·시트명 동일·시트1과 행 순서 동일·개별발송 건은 맨 아래 노란 배경)
//   [중간발주 탭 — 독립] 자체 3채널 불러오기 → ☎ 지정 발송일 요청(채널별) + 배송메모 검토 → 제외 체크 건만 집계에서 뺀 수량(체크 바꾸면 즉시 재집계). 입력삭제 칸 없음(개별발송도 실물량이라 포함).
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
    // 검토 목록용 넓은 날짜 표현(현행 시트1 빨간 표시 규칙 + 점 날짜·명절 전) — 해석기가 null인데 이 표현이 있으면 「확인필요」
    const BROAD = /다음\s*주|다음\s*날|내일|모레|글피|\d+\s*일|\d+\s*월|\d+\s*\/\s*\d+|\d{1,2}\s*\.\s*\d{1,2}|월요|화요|수요|목요|금요|토요|일요|주말|평일|다다음|이번\s*주|일주일|이후|이전|전에|추석\s*전|명절\s*전|연휴\s*전|까지|늦게|천천히|나중/;
    const CH = ['naver', 'cafe24', 'coupang'];
    const CH_LABEL = { naver: '🛒 네이버', cafe24: '🏠 자사몰', coupang: '🛍️ 쿠팡' };
    const PLACEHOLDER = new Set(['01000000000', '0000000000', '00000000000']);   // 네이버 선물하기 등 번호 비공개 주문의 자리표시 번호 — 실데이터에 존재(9/18 1건) → 어떤 칸에 적혀도 매칭 금지
    const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

    let P = null;   // app.js에서 떼어낸 실코드(변환 3종·시트1 내보내기·단가표 로드·중간발주 집계/렌더)
    async function loadProd() {
        const txt = await (await fetch('/app.js?ivt=' + Date.now())).text();
        const a = txt.indexOf('function detectSize(msg)'); const b = txt.indexOf('// 채널 초기화');
        const q0 = txt.indexOf('let qtyAggregated = [];'); const q1 = txt.indexOf('window.resetInvoiceQty = resetInvoiceQty;');
        if (a < 0 || b < 0 || b <= a || q0 < 0 || q1 < 0) throw new Error('app.js 변환/중간발주 코드 위치를 찾지 못했습니다');
        const code = txt.slice(a, b) + '\n' + txt.slice(q0, q1 + 'window.resetInvoiceQty = resetInvoiceQty;'.length);
        // 본 화면 setupQtyStart IIFE는 버튼 id(invoice-qty-start)가 없어 자동 무시(if (!btn) return)
        P = new Function('api', 'aoEsc', 'XLSX', 'document', 'aoProgressBarTicker', code + '\nreturn { convertDataSmart, convertDataJasamol, convertDataCoupang, exportInvoiceExcel, aoLoadInvoicePricing, setQtyRows: (rows) => { qtyManual = []; qtyRowsMain = rows; recomputeQtyAggregate(); }, qtyTotal: () => qtyAggregated.reduce((s, it) => s + it.qty, 0), resetInvoiceQty };')(api, aoEsc, XLSX, document, () => () => {});
        await P.aoLoadInvoicePricing();
    }

    // ── 공용 상태/로직(탭마다 ctx 하나) ─────────────────────────────────────────
    const makeCtx = (ids) => ({ ids, naver: null, cafe24: [], coupang: [], merged: [], today: null, reqs: { naver: [], cafe24: [], coupang: [] } });
    const rawOf = (ctx, e) => e.ch === 'naver' ? ctx.naver.rows[e.i] : ctx[e.ch][e.i];
    const telOf = (ctx, e) => { const raw = rawOf(ctx, e) || {}; return String(e.conv['구매자연락처'] || raw['구매자연락처'] || raw['주문자 휴대전화'] || raw['구매자전화번호'] || '').replace(/\D/g, ''); };
    const idsOf = (ctx, e) => { const raw = rawOf(ctx, e) || {}; return [raw._orderId, raw._pid, raw['주문번호'], raw['상품주문번호'], raw._x && raw._x.orderId, raw._x && raw._x.productOrderId].filter(Boolean).map(String); };
    const matchKey = (ctx, e, digits, key) => (digits.length >= 8 && !PLACEHOLDER.has(digits) && telOf(ctx, e) === digits) || (key && idsOf(ctx, e).includes(key));
    function parseNums(txt) { return String(txt || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).map(s => ({ raw: s, digits: s.replace(/\D/g, '') })); }
    // 전화번호 자동 하이픈(01011121111 → 010-1112-1111 · 0505… 12자리 → 4-4-4 · 02 서울 → 2-4-4/2-3-4). 주문번호 등 0으로 시작하지 않는 값·문자 섞인 값은 그대로.
    function fmtTel(tok) {
        const d = tok.replace(/\D/g, '');
        if (!/^0\d{8,11}$/.test(d) || d !== tok.replace(/[\s\-]/g, '')) return tok;
        if (d.length === 11) return d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
        if (d.length === 12) return d.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3');
        if (d.length === 10) return d.startsWith('02') ? d.replace(/^(02)(\d{4})(\d{4})$/, '$1-$2-$3') : d.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
        if (d.length === 9 && d.startsWith('02')) return d.replace(/^(02)(\d{3})(\d{4})$/, '$1-$2-$3');
        return tok;
    }
    function formatTextarea(el) {
        const before = el.value; const atEnd = el.selectionStart === before.length;
        const next = before.split('\n').map(line => line.split(/([,;])/).map(part => (/[,;]/.test(part) ? part : part.replace(/\S+/g, tok => (/^[\d\-\s]+$/.test(tok) ? fmtTel(tok) : tok)))).join('')).join('\n');
        if (next !== before) { el.value = next; if (atEnd) el.setSelectionRange(next.length, next.length); }
    }
    // ☎ 지정 발송일 요청(직원 메모): 「010-0000-0000 21일 발송」 — 첫 토큰 = 연락처/주문번호, 나머지 = 날짜 표현(키워드 없으면 「발송」)
    function parseReqLines(txt) {
        return String(txt || '').split(/\n/).map(s => s.trim()).filter(Boolean).map(line => {
            const m = line.match(/^(\S+)\s+(.+)$/); if (!m) return { line, bad: true };
            const key = m[1], digits = key.replace(/\D/g, ''); let text = m[2].trim();
            if (!/(발송|출고|출발|보내|도착|받|수령|까지|배송)/.test(text)) text += ' 발송';
            return { line, key, digits, text };
        });
    }
    function rebuild(ctx) {
        const entries = [];
        if (ctx.naver) P.convertDataSmart(ctx.naver.rows).forEach((conv, i) => entries.push({ ch: 'naver', i, conv }));
        if (ctx.cafe24.length) P.convertDataJasamol(ctx.cafe24).forEach((conv, i) => entries.push({ ch: 'cafe24', i, conv }));
        if (ctx.coupang.length) P.convertDataCoupang(ctx.coupang).forEach((conv, i) => entries.push({ ch: 'coupang', i, conv }));
        entries.sort((a, b) => (a.conv['옵션정보'] || '').localeCompare(b.conv['옵션정보'] || '', 'ko'));   // = 본 화면 getMergedConverted 정렬
        const prev = new Map(ctx.merged.map(e => [e.ch + ':' + e.i, e]));
        entries.forEach(e => { const p = prev.get(e.ch + ':' + e.i); e.excluded = p ? p.excluded : false; e.userTouched = p ? p.userTouched : false; e.parse = p ? p.parse : null; e.flag = p ? p.flag : null; e.individual = false; e.req = null; });
        ctx.merged = entries;
    }
    function applyIndividual(ctx) {
        if (!ctx.ids.ex) return;
        const ex = {}; CH.forEach(ch => { ex[ch] = parseNums($(ctx.ids.ex[ch]).value); });
        const hit = { naver: 0, cafe24: 0, coupang: 0 };
        ctx.merged.forEach(e => { e.individual = ex[e.ch].some(n => matchKey(ctx, e, n.digits, n.raw)); if (e.individual) hit[e.ch]++; });
        const entered = CH.reduce((s, ch) => s + ex[ch].length, 0);
        $(ctx.ids.msgEx).textContent = entered ? `입력 ${entered}개 → 개별발송으로 분류된 주문: 네이버 ${hit.naver}건 · 자사몰 ${hit.cafe24}건 · 쿠팡 ${hit.coupang}건` : '';
    }
    const flagOf = (p, memo, today) => (p && (p.kind === 'ship' || p.kind === 'arrive') && p.reqDate && p.reqDate > today) ? 'excl' : (p && p.kind === 'ack') ? 'review' : (!p && BROAD.test(memo)) ? 'review' : null;
    async function parseMemos(ctx) {
        if (!ctx.merged.length) return;
        CH.forEach(ch => { ctx.reqs[ch] = parseReqLines($(ctx.ids.req[ch]).value); });
        const memos = ctx.merged.map(e => String(e.conv['배송메세지'] || ''));
        const reqAll = CH.flatMap(ch => ctx.reqs[ch].filter(q => !q.bad).map(q => ({ ch, q })));
        const r = await api('/api/agent-office/invoice/memo-parse', 'POST', { memos: memos.concat(reqAll.map(x => x.q.text)) });
        if (!r.ok) throw new Error(r.message || '메모 해석 실패');
        ctx.today = r.today;
        const reqParse = new Map(); reqAll.forEach((x, i) => reqParse.set(x.q, r.results[memos.length + i] || null));
        let hit = 0;
        ctx.merged.forEach((e, k) => {
            const q = ctx.reqs[e.ch].find(q => !q.bad && matchKey(ctx, e, q.digits, q.key)) || null; e.req = q;
            if (q) {   // 직원 메모 우선 — 오늘(null)도 검토 목록에 정보로
                hit++; const p = reqParse.get(q); e.parse = p; e.reqToday = !p;
                e.flag = (p && (p.kind === 'ship' || p.kind === 'arrive') && p.reqDate && p.reqDate > ctx.today) ? 'excl' : 'review';
            } else { const p = r.results[k] || null; e.parse = p; e.reqToday = false; e.flag = flagOf(p, memos[k], ctx.today); }
            if (!e.userTouched) e.excluded = (e.flag === 'excl');
        });
        const total = CH.reduce((s, ch) => s + ctx.reqs[ch].length, 0), bad = CH.reduce((s, ch) => s + ctx.reqs[ch].filter(q => q.bad).length, 0);
        const unmatched = reqAll.filter(x => !ctx.merged.some(e => e.req === x.q)).length;
        $(ctx.ids.msgReq).textContent = total ? `입력 ${total}줄 → 매칭 주문 ${hit}건${unmatched ? ` · 주문 없음 ${unmatched}줄` : ''}${bad ? ` · 형식 오류 ${bad}줄(연락처 뒤에 날짜를 적어주세요)` : ''}` : '';
    }
    const statusOf = e => e.individual ? '<span class="tag indiv">개별발송(시트2만)</span>'
        : e.excluded ? (e.req ? '<span class="tag excl">제외(☎ 지정일)</span>' : '<span class="tag excl">제외(오늘 발송 아님)</span>')
        : e.flag === 'review' ? (e.reqToday ? '<span class="tag review">☎ 오늘 발송</span>' : '<span class="tag review">확인필요</span>') : '';
    function reqOf(e) {
        const p = e.parse; const pre = e.req ? '☎ ' : '';
        if (!p) return e.req ? '☎ 지정일 = 오늘 → 오늘 발송' : '';
        if (p.kind === 'ship') return `${pre}${p.reqDate} 발송 요청`;
        if (p.kind === 'arrive') return `${pre}${p.reqDate} 도착 요청`;
        return pre + '애매함 — 직원 확인';
    }
    const memoCell = e => (e.req ? `<b>☎ ${aoEsc(e.req.line)}</b>${e.conv['배송메세지'] ? '\n' + aoEsc(e.conv['배송메세지']) : ''}` : aoEsc(e.conv['배송메세지']));
    const cb = (e, k) => e.individual ? '' : `<input type="checkbox" data-k="${k}" ${e.excluded ? 'checked' : ''}>`;
    const rowClass = e => e.individual ? 'indiv' : e.excluded ? 'excl' : e.flag === 'review' ? 'review' : '';
    function render(ctx, onChange) {
        const rv = $(ctx.ids.review).querySelector('tbody');
        const revRows = ctx.merged.map((e, k) => ({ e, k })).filter(({ e }) => !e.individual && (e.excluded || e.flag));
        rv.innerHTML = revRows.length ? revRows.map(({ e, k }) => `<tr class="${e.excluded ? 'excl' : 'review'}"><td>${cb(e, k)}</td><td class="ch">${CH_LABEL[e.ch]}</td><td>${aoEsc(e.conv['수취인명'])}</td><td>${aoEsc(e.conv['옵션정보'])}</td><td>${aoEsc(e.conv['수량'])}</td><td class="memo">${memoCell(e)}</td><td>${aoEsc(reqOf(e))}</td><td>${statusOf(e)}</td></tr>`).join('')
            : '<tr><td colspan="8" style="color:#6B7280;">검토할 배송메모가 없습니다.</td></tr>';
        if (ctx.ids.preview) {
            $(ctx.ids.preview).querySelector('tbody').innerHTML = ctx.merged.map((e, k) => `<tr class="${rowClass(e)}"><td>${cb(e, k)}</td><td>${k + 1}</td><td class="ch">${CH_LABEL[e.ch]}</td><td>${aoEsc(e.conv['수취인명'])}</td><td>${aoEsc(e.conv['옵션정보'])}</td><td>${aoEsc(e.conv['수량'])}</td><td>${aoEsc(String(e.conv['배송지'] || '').slice(0, 40))}</td><td class="memo">${memoCell(e)}</td><td>${statusOf(e)}</td></tr>`).join('');
        }
        const n = ctx.merged.length, indiv = ctx.merged.filter(e => e.individual).length, excl = ctx.merged.filter(e => !e.individual && e.excluded).length, review = ctx.merged.filter(e => !e.individual && !e.excluded && e.flag === 'review').length;
        $(ctx.ids.stats).innerHTML = ctx.ids.preview
            ? `<span>전체 <b>${n}</b>건</span><span>시트1(택배사) <b>${n - indiv - excl}</b>건</span><span>개별발송 <b>${indiv}</b>건</span><span>제외 체크 <b>${excl}</b>건</span><span>확인필요 <b>${review}</b>건</span>${ctx.today ? `<span>기준일 ${ctx.today}</span>` : ''}`
            : `<span>전체 <b>${n}</b>건</span><span>집계 대상 <b>${n - excl}</b>건</span><span>제외 체크 <b>${excl}</b>건</span><span>확인필요 <b>${review}</b>건</span>${ctx.today ? `<span>기준일 ${ctx.today}</span>` : ''}`;
        const scope = [ctx.ids.review, ctx.ids.preview].filter(Boolean).map(id => '#' + id + ' input[type=checkbox]').join(', ');
        document.querySelectorAll(scope).forEach(el => el.addEventListener('change', () => { const e = ctx.merged[Number(el.dataset.k)]; e.excluded = el.checked; e.userTouched = true; render(ctx, onChange); if (onChange) onChange(); }));
    }
    function dateGuard(ctx, msgId) {   // 페이지를 전날부터 열어 두면 기준일이 어제로 남는다 → 다운로드·집계 전에 막고 다시 불러오게
        if (ctx.today && ctx.today !== kstToday()) { $(msgId).textContent = `⚠️ 기준일이 ${ctx.today} → ${kstToday()}로 바뀌었어요. 새로고침 후 주문을 다시 불러와 검토해주세요.`; return false; }
        return true;
    }
    // 네이버 다운로드 파일은 비밀번호(대표: 다운로드 시 입력)로 잠겨 있을 수 있다 — CFB 서명이면 서버(/api/invoice/decrypt)로 자동 해제
    const isEncrypted = buf => { const b = new Uint8Array(buf.slice(0, 8)); return b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0; };
    const toB64 = buf => { let bin = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); };
    async function readWorkbook(file) {
        const buf = await file.arrayBuffer();
        if (isEncrypted(buf)) {
            const r = await api('/api/invoice/decrypt', 'POST', { fileBase64: toB64(buf) });
            if (!r.fileBase64) throw new Error(r.error || '복호화 실패');
            return { wb: XLSX.read(r.fileBase64, { type: 'base64', cellStyles: true }), decrypted: true };
        }
        return { wb: XLSX.read(buf, { type: 'array', cellStyles: true }), decrypted: false };
    }
    function rowsFromSheet(ws, hdrIdx) {
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        const H = aoa[hdrIdx] || [];
        return aoa.slice(hdrIdx + 1).filter(r => Array.isArray(r) && r.some(v => v != null && v !== '')).map(r => { const o = {}; H.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; }); return o; });
    }
    async function fetchChannel(ch, days) {
        return ch === 'naver' ? api('/api/agent-office/naver/invoice-orders-v2?days=' + Math.min(days, 180))
            : api(`/api/agent-office/${ch}/invoice-orders?days=` + Math.min(days, ch === 'coupang' ? 31 : 90));
    }

    // ── 송장 변환 탭 ─────────────────────────────────────────────────────────────
    const C = makeCtx({ ex: { naver: 'ex-naver', cafe24: 'ex-cafe24', coupang: 'ex-coupang' }, req: { naver: 'req-naver', cafe24: 'req-cafe24', coupang: 'req-coupang' }, msgEx: 'msg-ex', msgReq: 'msg-req', review: 'review', preview: 'preview', stats: 'stats' });
    const days = ch => Math.min(Math.max(parseInt($('days-' + ch).value) || 50, 1), 180);
    const setMsg = (ch, html) => { $('msg-' + ch).innerHTML = html; };
    const markArea = (ch, label) => { $('area-' + ch).classList.add('has-file'); $('fname-' + ch).textContent = label; };
    async function refreshC(resetCh) { if (resetCh) C.merged = C.merged.filter(e => e.ch !== resetCh); rebuild(C); applyIndividual(C); await parseMemos(C); render(C); $('btn-download').disabled = !C.merged.length; }
    async function loadNaverApi() {
        setMsg('naver', `네이버 배송준비 조회 중(최근 ${days('naver')}일)…`);
        const r = await fetchChannel('naver', days('naver'));
        if (!r.ok) { setMsg('naver', '⚠️ ' + aoEsc(r.message || '불러오기 실패')); return; }
        C.naver = { src: 'api', rows: r.rows || [] }; markArea('naver', `🛰️ 네이버 배송준비 ${r.count}건`); setMsg('naver', `✅ 배송준비 <b>${r.count}건</b> 불러왔습니다(API — 비밀번호 없음).`);
        await refreshC('naver');
    }
    async function loadOther(ch) {
        setMsg(ch, '조회 중…');
        const r = await fetchChannel(ch, days(ch));
        if (!r.ok) { setMsg(ch, '⚠️ ' + aoEsc(r.message || '불러오기 실패')); return; }
        C[ch] = r.rows || []; markArea(ch, `${CH_LABEL[ch]} ${r.count}건`); setMsg(ch, `✅ <b>${r.count}건</b> 불러왔습니다.`);
        await refreshC(ch);
    }
    async function loadFile(ch, file) {
        $('area-' + ch).classList.add('decrypting');
        let wbInfo; try { wbInfo = await readWorkbook(file); } finally { $('area-' + ch).classList.remove('decrypting'); }
        const { wb, decrypted } = wbInfo; const ws = wb.Sheets[wb.SheetNames[0]];
        if (ch === 'naver') {
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
            const hdrIdx = aoa.findIndex(r => Array.isArray(r) && r.includes('상품주문번호'));
            if (hdrIdx < 0) { setMsg('naver', '⚠️ 네이버 발주발송관리 파일이 아닙니다(상품주문번호 헤더 없음)'); return; }
            const rows = rowsFromSheet(ws, hdrIdx);
            C.naver = { src: 'file', rows, ws, hdrIdx, fileName: file.name }; markArea('naver', file.name); setMsg('naver', `✅ 주문 <b>${rows.length}건</b>${decrypted ? ' · 🔐 비밀번호 자동 해제' : ''}`);
        } else { const rows = rowsFromSheet(ws, 0); C[ch] = rows; markArea(ch, file.name); setMsg(ch, `✅ <b>${rows.length}건</b>`); }
        await refreshC(ch);
    }
    function resetC() {
        C.naver = null; C.cafe24 = []; C.coupang = []; C.merged = []; C.today = null;
        ['ex-naver', 'ex-cafe24', 'ex-coupang', 'req-naver', 'req-cafe24', 'req-coupang'].forEach(id => $(id).value = '');
        CH.forEach(ch => { $('area-' + ch).classList.remove('has-file'); $('fname-' + ch).textContent = ''; setMsg(ch, ''); });
        $('msg-ex').textContent = ''; $('msg-req').textContent = ''; $('msg-dl').textContent = ''; render(C); $('btn-download').disabled = true;
    }
    // 시트2: 네이버 원본 양식
    const serial = iso => { const ms = Date.parse(iso || ''); return isNaN(ms) ? null : (ms + 9 * 3600e3) / 86400e3 + 25569; };
    const DATE_Z = 'yyyy/mm/dd\\ hh:mm', WON_Z = '"₩"#,##0';
    const dmLabel = v => ({ DELIVERY: '택배,등기,소포', DIRECT_DELIVERY: '직접전달', QUICK_SVC: '퀵서비스', VISIT_RECEIPT: '방문수령', NOTHING: '' })[v] ?? (v || '');
    const maskId = id => { const s = String(id || ''); return s.length > 4 ? s.slice(0, 4) + '*'.repeat(s.length - 4) : s; };
    const sCell = v => ({ t: 's', v: String(v == null ? '' : v) });
    const nCell = (v, z) => (v == null || v === '') ? sCell('') : { t: 'n', v: Number(v), z };
    const dCell = iso => { const s = serial(iso); return s == null ? sCell('') : { t: 'n', v: s, z: DATE_Z }; };
    function rowCells(i) {
        const nv = C.naver;
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
        const indiv = C.merged.filter(e => e.ch === 'naver' && e.individual && !e.excluded).map(e => ({ i: e.i, indiv: true }));
        let r = 2;
        for (const { i, indiv: yellow } of ordered.concat(indiv)) { rowCells(i).forEach((cell, c) => { if (yellow) cell.s = { ...(cell.s || {}), fill: { fgColor: { rgb: 'FFF2CC' } } }; put(r, c, cell); }); r++; }
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, 1), c: 26 } });
        ws['!merges'] = [{ s: { c: 0, r: 0 }, e: { c: 2, r: 0 } }, { s: { c: 3, r: 0 }, e: { c: 5, r: 0 } }];
        ws['!rows'] = [{ hpt: 150 }]; ws['!cols'] = HDR.map(() => ({ wch: 27.7 }));
        return { ws, count: ordered.length, indiv: indiv.length };
    }
    function download() {
        applyIndividual(C);
        if (!dateGuard(C, 'msg-dl')) return null;
        const list = C.merged.filter(e => !e.individual && !e.excluded);
        if (!list.length) { $('msg-dl').textContent = '내보낼 주문이 없습니다.'; return null; }
        let captured = null; const origWrite = XLSX.writeFile;
        XLSX.writeFile = (wb, name) => { captured = { wb, name }; };
        try { P.exportInvoiceExcel(list.map(e => e.conv)); } finally { XLSX.writeFile = origWrite; }   // 시트1 = 본 화면 실코드 그대로
        if (!captured) throw new Error('시트1 생성 실패');
        let s2 = null;
        if (C.naver) { s2 = buildSheet2(list); XLSX.utils.book_append_sheet(captured.wb, s2.ws, '발주발송관리'); }
        const name = captured.name.replace(/\.xlsx$/i, '') + '_v2.xlsx';
        origWrite(captured.wb, name);
        $('msg-dl').textContent = `${name} — 시트1 ${list.length}건${s2 ? ` · 시트2 ${s2.count + s2.indiv}건(개별발송 ${s2.indiv}건 노란 표시)` : ''}`;
        return captured.wb;
    }

    // ── 중간발주 탭(독립) ─────────────────────────────────────────────────────────
    const Q = makeCtx({ ex: null, req: { naver: 'qreq-naver', cafe24: 'qreq-cafe24', coupang: 'qreq-coupang' }, msgEx: null, msgReq: 'qmsg-req', review: 'qreview', preview: null, stats: 'qstats' });
    // 행 → 본 화면 집계 키(옵션정보·수량) 변환은 본 화면 setupQtyStart와 동일. 제외 체크 건만 뺀다(개별발송 개념 없음 = 전부 실물량).
    function qtyRows() {
        const rows = [], skipped = { n: 0, qty: 0 };
        for (const e of Q.merged) {
            const raw = rawOf(Q, e) || {};
            const row = e.ch === 'naver' ? raw : e.ch === 'coupang' ? { '옵션정보': raw['노출상품명(옵션명)'] || raw['등록상품명'] || '', '수량': raw['구매수(수량)'] } : { '옵션정보': raw['주문상품명(세트상품 포함)'] || '', '수량': raw['수량'] };
            if (e.excluded) { skipped.n++; skipped.qty += parseInt(row['수량']) || 1; continue; }
            rows.push(row);
        }
        return { rows, skipped };
    }
    function recomputeQ() {
        const { rows, skipped } = qtyRows();
        P.setQtyRows(rows);
        $('invoice-qty-result').style.display = '';
        $('invoice-qty-msg').innerHTML = `✅ 배송준비 <b>${rows.length}건</b> 집계 — 제외 체크된 지정일 요청 <b>${skipped.n}건(수량 ${skipped.qty})</b>은 뺐습니다. 아래 검토 목록에서 체크를 바꾸면 수량이 바로 다시 계산됩니다. (기준일 ${Q.today || kstToday()})`;
    }
    async function runQty() {
        const btn = $('ivt-qty-start'); btn.disabled = true;
        const d = Math.min(Math.max(parseInt($('ivt-qty-days').value) || 50, 1), 180);
        $('invoice-qty-msg').textContent = `3채널 배송준비 조회 중… (최근 ${d}일)`;
        try {
            const [nv, cp, cf] = await Promise.allSettled([fetchChannel('naver', d), fetchChannel('coupang', d), fetchChannel('cafe24', d)]);
            const val = rv => rv.status === 'fulfilled' && rv.value && rv.value.ok ? rv.value : { ok: false, message: rv.status === 'fulfilled' ? (rv.value && rv.value.message) || '불러오기 실패' : (rv.reason && rv.reason.message) || String(rv.reason) };
            const N = val(nv), P2 = val(cp), F = val(cf);
            if (!N.ok && !P2.ok && !F.ok) { $('invoice-qty-msg').textContent = `⚠️ 3채널 모두 실패 — 네이버: ${N.message} / 쿠팡: ${P2.message} / 자사몰: ${F.message}`; return; }
            Q.naver = N.ok ? { src: 'api', rows: N.rows || [] } : null; Q.coupang = P2.ok ? (P2.rows || []) : []; Q.cafe24 = F.ok ? (F.rows || []) : []; Q.merged = [];
            await refreshQ();
            const fail = [!N.ok && `네이버: ${aoEsc(N.message)}`, !P2.ok && `쿠팡: ${aoEsc(P2.message)}`, !F.ok && `자사몰: ${aoEsc(F.message)}`].filter(Boolean).join(' / ');
            if (fail) $('invoice-qty-msg').innerHTML += `<br><span style="color:var(--danger,#F04438);">⚠️ 실패 채널 제외하고 집계됨 — ${fail}</span>`;
        } catch (e) { $('invoice-qty-msg').textContent = '⚠️ ' + e.message; }
        finally { btn.disabled = false; }
    }
    async function refreshQ() {
        rebuild(Q); await parseMemos(Q); render(Q, recomputeQ); $('qreview-card').style.display = Q.merged.length ? '' : 'none';
        if (Q.merged.length) { if (!dateGuard(Q, 'invoice-qty-msg')) return; recomputeQ(); }
    }
    function resetQ() { Q.naver = null; Q.cafe24 = []; Q.coupang = []; Q.merged = []; Q.today = null; ['qreq-naver', 'qreq-cafe24', 'qreq-coupang'].forEach(id => $(id).value = ''); $('qmsg-req').textContent = ''; $('qreview-card').style.display = 'none'; $('invoice-qty-msg').textContent = ''; P.resetInvoiceQty(); }
    function switchMode(mode) {
        $('invoice-convert-mode').style.display = mode === 'qty' ? 'none' : '';
        $('invoice-qty-mode').style.display = mode === 'qty' ? '' : 'none';
        $('ivt-mode-convert').classList.toggle('active', mode !== 'qty'); $('ivt-mode-qty').classList.toggle('active', mode === 'qty');
    }

    // ── 이벤트 ───────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
        if (!localStorage.getItem('jwt_token')) $('login-gate').style.display = '';
        try { await loadProd(); } catch (e) { setMsg('naver', '⚠️ ' + aoEsc(e.message)); return; }
        $('btn-naver').addEventListener('click', () => loadNaverApi().catch(e => setMsg('naver', '⚠️ ' + aoEsc(e.message))));
        $('btn-cafe24').addEventListener('click', () => loadOther('cafe24').catch(e => setMsg('cafe24', '⚠️ ' + aoEsc(e.message))));
        $('btn-coupang').addEventListener('click', () => loadOther('coupang').catch(e => setMsg('coupang', '⚠️ ' + aoEsc(e.message))));
        $('btn-reset').addEventListener('click', resetC);
        $('btn-download').addEventListener('click', () => { try { download(); } catch (e) { $('msg-dl').textContent = '⚠️ ' + e.message; } });
        ['ex-naver', 'ex-cafe24', 'ex-coupang'].forEach(id => $(id).addEventListener('input', () => { formatTextarea($(id)); applyIndividual(C); render(C); }));
        let t1 = null; ['req-naver', 'req-cafe24', 'req-coupang'].forEach(id => $(id).addEventListener('input', () => { formatTextarea($(id)); clearTimeout(t1); t1 = setTimeout(() => refreshC().catch(e => $('msg-req').textContent = '⚠️ ' + e.message), 400); }));
        for (const ch of CH) {
            const area = $('area-' + ch), input = $('file-' + ch);
            area.addEventListener('click', () => input.click());
            area.addEventListener('dragover', ev => { ev.preventDefault(); area.classList.add('dragover'); });
            area.addEventListener('dragleave', () => area.classList.remove('dragover'));
            area.addEventListener('drop', ev => { ev.preventDefault(); area.classList.remove('dragover'); const f = ev.dataTransfer.files[0]; if (f) loadFile(ch, f).catch(e => setMsg(ch, '⚠️ ' + aoEsc(e.message))); });
            input.addEventListener('change', () => { const f = input.files[0]; if (f) loadFile(ch, f).catch(e => setMsg(ch, '⚠️ ' + aoEsc(e.message))); input.value = ''; });
        }
        // 중간발주 탭
        $('ivt-mode-convert').addEventListener('click', () => switchMode('convert'));
        $('ivt-mode-qty').addEventListener('click', () => switchMode('qty'));
        $('ivt-qty-start').addEventListener('click', () => runQty());
        $('ivt-qty-reset').addEventListener('click', resetQ);
        let t2 = null; ['qreq-naver', 'qreq-cafe24', 'qreq-coupang'].forEach(id => $(id).addEventListener('input', () => { formatTextarea($(id)); if (!Q.merged.length) return; clearTimeout(t2); t2 = setTimeout(() => refreshQ().catch(e => $('qmsg-req').textContent = '⚠️ ' + e.message), 400); }));
        render(C);
        window.__ivt = { S: C, Q, refreshAll: refreshC, refreshQ, render: () => render(C), download, fmtTel, switchMode, runQty, qtyTotal: () => P.qtyTotal(),
            setNaverApiRows: async rows => { C.naver = { src: 'api', rows }; await refreshC('naver'); },
            setRows: async (ch, rows) => { C[ch] = rows; await refreshC(ch); },
            setQRows: async (nvRows, cfRows, cpRows) => { Q.naver = nvRows ? { src: 'api', rows: nvRows } : null; Q.cafe24 = cfRows || []; Q.coupang = cpRows || []; Q.merged = []; await refreshQ(); } };   // 검증용 훅
    });
})();
