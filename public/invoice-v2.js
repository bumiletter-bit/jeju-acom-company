// #452(대표 GO 9/18) 송장변환 v2(/invoice-v2.html) — #452-p부터 회사프로그램 「송장변환」 메뉴 안에 iframe(?embed=1)으로 끼워 정식 사용. app.js 송장변환·중간발주 코드는 무접촉(구버전은 index.html에 숨김 — #invoice-legacy).
//   변환·시트1 스타일·중간발주 집계/렌더는 app.js의 실코드를 그대로 떼어 실행(중복 구현 0).
//   [송장 변환 탭] ① 개별발송·지정 발송일 = 정리 파일(요청일자·번호·비고·플랫폼) 줄을 채널별 칸 1개에 붙여넣고 [저장하기](#452-j) ② 배송메모 해석(서버 /invoice/memo-parse)으로 「오늘 발송 아님」 후보 미리 체크 + 검토 목록
//                 ③ 시트2 = 네이버 「전체주문발주발송관리」 원본 양식(안내 1행·27열·시트명 동일·시트1과 행 순서 동일·개별발송 건은 맨 아래 노란 배경)
//   [중간발주 탭 — 독립] 자체 3채널 불러오기 → 같은 정리 파일 줄(입력삭제 = 그날 나가는 실물량이라 포함) + 배송메모 검토 → 제외 체크 건만 집계에서 뺀 수량(체크 바꾸면 즉시 재집계)
//   줄 규칙(대표 9/18): 요청일자 = 오늘 + 「입력o삭제x」 → 개별발송 · 오늘 + 비고 없음(메모무시 등) → 오늘 발송(손님 배송메모보다 우선) · 오늘보다 뒤 → 제외 체크 · 지난 날짜·날짜 없음·「n건 중 1건」(수취인 이름 없으면) → 확인필요(사람이 결정)
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
    const isoOf = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return isNaN(dt) ? null : dt.toISOString().slice(0, 10); };
    const mdLabel = iso => iso ? `${parseInt(iso.slice(5, 7))}/${parseInt(iso.slice(8, 10))}` : '';
    // embed(iframe) 모드: 내용 높이(달력 팝업 포함)를 바깥 페이지에 알려 iframe이 스크롤 없이 늘어나게 — 렌더·달력 열림/닫힘 때 즉시 + 주기
    const IS_EMBED = () => document.body.classList.contains('embed') && window.parent !== window;
    function postHeight() {
        if (!IS_EMBED()) return;
        try { const pop = document.querySelector('.akm-cal.ivt-cal'); const popBottom = pop && pop.style.display !== 'none' ? pop.getBoundingClientRect().bottom + window.scrollY + 16 : 0; window.parent.postMessage({ type: 'ivt-height', h: Math.max(document.documentElement.scrollHeight, popBottom) }, location.origin); } catch (_) { }
    }

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
    // ids: { ln: 붙여넣기 칸 1개, save: 저장 버튼, res: 결과 표, review, preview|null, stats } · allowIndiv: 입력삭제 → 개별발송 분류 여부(중간발주는 false = 실물량 포함)
    const makeCtx = (ids, allowIndiv) => ({ ids, allowIndiv, naver: null, cafe24: [], coupang: [], merged: [], today: null, shipDate: null, calendar: null, fetchedOn: null, lines: { naver: [], cafe24: [], coupang: [] } });
    const rawOf = (ctx, e) => e.ch === 'naver' ? ctx.naver.rows[e.i] : ctx[e.ch][e.i];
    const telOf = (ctx, e) => { const raw = rawOf(ctx, e) || {}; return String(e.conv['구매자연락처'] || raw['구매자연락처'] || raw['주문자 휴대전화'] || raw['구매자전화번호'] || '').replace(/\D/g, ''); };
    const idsOf = (ctx, e) => { const raw = rawOf(ctx, e) || {}; return [raw._orderId, raw._pid, raw['주문번호'], raw['상품주문번호'], raw._x && raw._x.orderId, raw._x && raw._x.productOrderId].filter(Boolean).map(String); };
    const matchKey = (ctx, e, digits, key) => (digits.length >= 8 && !PLACEHOLDER.has(digits) && telOf(ctx, e) === digits) || (key && idsOf(ctx, e).includes(key));
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
        const next = before.split('\n').map(line => line.split(/([,;\t])/).map(part => (/[,;\t]/.test(part) ? part : part.replace(/\S+/g, tok => (/^[\d\-\s]+$/.test(tok) ? fmtTel(tok) : tok)))).join('')).join('\n');
        if (next !== before) { el.value = next; if (atEnd) el.setSelectionRange(next.length, next.length); }
    }
    // 요청일자 해석: 9/20/26 · 2026-09-20 · 9.20 · 9월 20일 · 20일 · 오늘/내일 → YYYY-MM-DD (연도 없으면 올해 — 오늘보다 300일 넘게 앞이면 내년)
    function parseDate(s, today) {
        s = String(s || '').trim(); if (!s) return null;
        const ty = +today.slice(0, 4), tm = +today.slice(5, 7), td = +today.slice(8, 10);
        if (/^오늘$/.test(s)) return today;
        if (/^내일$/.test(s)) return new Date(Date.parse(today) + 86400e3).toISOString().slice(0, 10);
        let m, y = null, mo = null, d = null;
        if ((m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
        else if ((m = s.match(/^(\d{1,2})[-./](\d{1,2})(?:[-./](\d{2,4}))?/))) { mo = +m[1]; d = +m[2]; if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
        else if ((m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/))) { mo = +m[1]; d = +m[2]; }
        else if ((m = s.match(/^(\d{1,2})\s*일/))) { d = +m[1]; mo = tm; if (d < td - 15) { mo = tm + 1; } }
        else return null;
        if (mo > 12 && d <= 12 && !y) return null;   // 애매한 D/M 형식은 안 받음
        if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
        if (y == null) { y = ty; if (mo > 12) { mo -= 12; y++; } }
        let iso = isoOf(y, mo, d); if (!iso) return null;
        if (!m[3] && !/^\d{4}/.test(s) && Date.parse(iso) < Date.parse(today) - 300 * 86400e3) iso = isoOf(y + 1, mo, d);
        return iso;
    }
    const chOfText = t => /자사몰|카페|cafe/i.test(t) ? 'cafe24' : /쿠팡|coupang/i.test(t) ? 'coupang' : /네이버|스토어|스마트|naver/i.test(t) ? 'naver' : null;
    // 정리 파일 한 줄 → { date, key, digits, note, indiv, recipient, partial, ch } · 탭(엑셀 복사) 또는 공백 구분 · 첫 칸이 날짜가 아니면 「번호 (날짜 표현)」 옛 형식으로 읽음
    function parseLines(txt, boxCh, today) {
        const out = [];
        for (const raw of String(txt || '').split(/\n/)) {
            const line = raw.replace(/\r/g, '').trim(); if (!line) continue;
            if (/^요청일자|전화번호 또는 상품주문번호|^플[렛랫]폼/.test(line)) continue;   // 헤더 줄(예시 번호가 섞여 있어도 건너뜀)
            let date = null, key = '', note = '', plat = '';
            if (line.includes('\t')) {
                const c = line.split('\t').map(s => s.trim());
                date = parseDate(c[0], today); key = c[1] || ''; note = c[2] || ''; plat = c[3] || '';
                if (!date && c[0] && /\d{8,}/.test(c[0].replace(/\D/g, ''))) { key = c[0]; note = [c[1], c[2]].filter(Boolean).join(' '); plat = c[3] || c[2] || ''; }
            } else {
                const t = line.split(/\s+/);
                if (parseDate(t[0], today)) { date = parseDate(t[0], today); key = t[1] || ''; note = t.slice(2).join(' '); }
                else { key = t[0]; note = t.slice(1).join(' '); if (!date) { const dm = note.match(/\d{1,2}\s*[\/.월]\s*\d{1,2}\s*일?|\d{1,2}\s*일|오늘|내일/); if (dm) date = parseDate(dm[0], today); } }
            }
            const digits = key.replace(/\D/g, '');
            if (!key || (digits.length < 8 && !/\d{8,}/.test(key))) { out.push({ line, bad: true, boxCh }); continue; }
            const ch = chOfText(plat) || chOfText(note) || (/^\d{8}-\d{7}$/.test(key) ? 'cafe24' : boxCh);   // 자사몰 주문번호(YYYYMMDD-NNNNNNN)는 플랫폼 칸 없어도 자사몰
            const rec = note.match(/수취인\s*[:：]?\s*([가-힣]{2,5})/);
            out.push({ line, date, key, digits, note, plat, ch, boxCh,
                indiv: /입력\s*[oO○0]\s*[·,]?\s*삭제\s*[xX×]|입력\s*삭제/i.test(note),
                recipient: rec ? rec[1] : null,
                partial: !rec && /\d+\s*건\s*중|만\s*\)|만$/.test(note),
                expect: (m => m ? +m[1] : null)(note.match(/중\s*(\d+)\s*건/) || note.match(/(\d+)\s*건/)),   // 비고의 건수 — 실제 매칭 건수와 다르면 경고
                hits: 0, applied: 0 });
        }
        return out;
    }
    function rebuild(ctx) {
        const entries = [];
        if (ctx.naver) P.convertDataSmart(ctx.naver.rows).forEach((conv, i) => entries.push({ ch: 'naver', i, conv }));
        if (ctx.cafe24.length) P.convertDataJasamol(ctx.cafe24).forEach((conv, i) => entries.push({ ch: 'cafe24', i, conv }));
        if (ctx.coupang.length) P.convertDataCoupang(ctx.coupang).forEach((conv, i) => entries.push({ ch: 'coupang', i, conv }));
        entries.sort((a, b) => (a.conv['옵션정보'] || '').localeCompare(b.conv['옵션정보'] || '', 'ko'));   // = 본 화면 getMergedConverted 정렬
        const prev = new Map(ctx.merged.map(e => [e.ch + ':' + e.i, e]));
        entries.forEach(e => { const p = prev.get(e.ch + ':' + e.i); e.excluded = p ? p.excluded : false; e.userTouched = p ? p.userTouched : false; e.parse = p ? p.parse : null; e.flag = p ? p.flag : null; e.memoFlag = p ? p.memoFlag : null; e.individual = false; e.req = null; e.reqKind = null; });
        ctx.merged = entries;
    }
    const flagOf = (p, memo, today) => (p && (p.kind === 'ship' || p.kind === 'arrive') && p.reqDate && p.reqDate > today) ? 'excl' : (p && p.kind === 'ack') ? 'review' : (!p && BROAD.test(memo)) ? 'review' : null;
    // 손님 배송메모 → 서버 해석 → 자동 체크/확인필요(직원 줄이 없는 주문만 최종 반영 — applyLines가 덮어씀)
    // 기준일(ctx.today) = 「기준 발송일」 — 서버가 발송휴무일 달력으로 계산한 다음 발송일(오늘이 발송일이고 정오 전이면 오늘). 직원이 셀렉트로 바꿀 수 있다(ctx.shipDate).
    async function parseMemos(ctx) {
        const memos = ctx.merged.map(e => String(e.conv['배송메세지'] || ''));
        const r = await api('/api/agent-office/invoice/memo-parse', 'POST', { memos, baseDate: ctx.shipDate || null });
        if (!r.ok) throw new Error(r.message || '메모 해석 실패');
        ctx.today = r.today; ctx.shipDate = r.today; ctx.calendar = { realToday: r.realToday, suggested: r.suggested, shipDays: r.shipDays || [], noShip: new Set(r.noShip || []), reasons: r.noShipReasons || {} }; ctx.fetchedOn = kstToday();
        fillShipInput(ctx);
        ctx.merged.forEach((e, k) => { const p = r.results[k] || null; e.parse = p; e.memoFlag = flagOf(p, memos[k], ctx.today); });
    }
    function fillShipInput(ctx) {
        const inp = $(ctx.ids.ship); if (!inp || !ctx.calendar) return;
        const cal = ctx.calendar, d = ctx.shipDate;
        inp.value = `${dateLabel(d)}${d === cal.realToday ? ' · 오늘' : ''}${d === cal.suggested ? ' · 다음 발송일' : ' · 직접 선택'}`; inp.dataset.iso = d;
        const note = $(ctx.ids.shipNote); if (note) note.textContent = d === cal.suggested
            ? (d === cal.realToday ? '오늘 발송분 기준(정오 전) — 달력을 눌러 바꿀 수 있어요' : `오늘(${mdLabel(cal.realToday)}) 발송은 끝난 것으로 보고 ${mdLabel(d)} 발송분 기준 — 토요일·발송휴무일은 달력에서 자동 제외`)
            : `직접 고른 날짜 기준(달력의 다음 발송일은 ${mdLabel(cal.suggested)})`;
    }
    // 📅 기준 발송일 달력 — 본 화면 akm-cal 디자인(styles.css 클래스 재사용) + 발송 불가일(토요일·발송휴무일·지난 날) 비활성 + 「다음 발송일」 표시. 날짜를 누르면 그날 기준으로 즉시 재판정.
    const ShipCal = (() => {
        let pop = null, cur = null, viewY = 0, viewM = 0;
        const iso3 = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        function ensure() {
            if (pop) return;
            pop = document.createElement('div'); pop.className = 'akm-cal ivt-cal'; pop.style.display = 'none'; document.body.appendChild(pop);
            pop.addEventListener('click', e => {
                const nav = e.target.closest('[data-nav]'); if (nav) { viewM += parseInt(nav.dataset.nav, 10); while (viewM < 0) { viewM += 12; viewY--; } while (viewM > 11) { viewM -= 12; viewY++; } render(); return; }
                if (e.target.closest('[data-next]')) { pick(cur.calendar.suggested); return; }
                const day = e.target.closest('[data-date]'); if (day && !day.disabled) pick(day.dataset.date);
            });
            document.addEventListener('mousedown', e => { if (!isOpen()) return; if (pop.contains(e.target) || (cur && e.target === $(cur.ids.ship))) return; close(); });
            document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
            // 🔴 resize에 close()하면 안 된다 — embed(iframe) 모드에선 달력이 열려 높이가 늘 때 바깥이 iframe을 키우고 그 순간 resize가 와서 열리자마자 닫혔음(대표 실물 9/18). 위치만 다시 잡는다.
            window.addEventListener('resize', () => { if (isOpen() && cur) place(); });
        }
        function place() {
            const input = $(cur.ids.ship); const r = input.getBoundingClientRect(); const pw = pop.offsetWidth, ph = pop.offsetHeight; let left = r.left, top = r.bottom + 6;
            if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
            if (top + ph > window.innerHeight - 8 && r.top - ph - 6 > 0 && !document.body.classList.contains('embed')) top = r.top - ph - 6;   // embed에선 아래로 열고 iframe이 늘어남
            pop.style.left = `${left + window.scrollX}px`; pop.style.top = `${top + window.scrollY}px`;
        }
        function render() {
            const cal = cur.calendar, sel = cur.shipDate, todayIso = cal.realToday;
            const startDow = new Date(Date.UTC(viewY, viewM, 1)).getUTCDay(); let cells = '';
            for (let i = 0; i < 42; i++) {
                const dt = new Date(Date.UTC(viewY, viewM, i - startDow + 1)); const dIso = iso3(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()); const dow = i % 7;
                const off = dow === 6 || cal.noShip.has(dIso), past = dIso < todayIso;
                const cls = ['akm-cal-day']; if (dt.getUTCMonth() !== viewM) cls.push('out'); if (dow === 0) cls.push('sun'); else if (dow === 6) cls.push('sat');
                if (dIso === todayIso) cls.push('today'); if (dIso === sel) cls.push('sel'); if (off) cls.push('off'); if (past && !off) cls.push('past');
                const tip = off ? (dow === 6 && !cal.noShip.has(dIso) ? '토요일 — 발송 없음' : '발송휴무일' + (cal.reasons[dIso] ? ' · ' + cal.reasons[dIso] : '')) : past ? '지난 날짜' : '';
                const lab = dIso === cal.suggested ? '<i>다음 발송일</i>' : off ? '<i class="x">휴무</i>' : '';
                cells += `<button type="button" class="${cls.join(' ')}" data-date="${dIso}" title="${aoEsc(tip)}"${off || past ? ' disabled' : ''}><span>${dt.getUTCDate()}</span>${lab}</button>`;
            }
            pop.innerHTML = `<div class="akm-cal-head"><button type="button" class="akm-cal-nav" data-nav="-1" title="이전 달">‹</button><div class="akm-cal-title">${viewY}년 ${viewM + 1}월</div><button type="button" class="akm-cal-nav" data-nav="1" title="다음 달">›</button></div>
                <div class="akm-cal-week"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
                <div class="akm-cal-grid">${cells}</div>
                <div class="akm-cal-foot"><span class="ivt-cal-legend"><b class="n">다음 발송일</b> · <s>휴무·토요일</s> = 선택 불가</span><button type="button" class="akm-cal-today-btn" data-next="1">다음 발송일(${mdLabel(cal.suggested)})로</button></div>`;
        }
        function pick(d) { const ctx = cur; close(); if (!ctx || ctx.shipDate === d) return; ctx.shipDate = d; saveLines(ctx); }
        function isOpen() { return !!pop && pop.style.display !== 'none'; }
        function close() { if (pop) pop.style.display = 'none'; cur = null; postHeight(); }
        function open(ctx) {
            ensure(); if (!ctx.calendar) return;
            if (cur === ctx && isOpen()) { close(); return; }
            cur = ctx; const v = ctx.shipDate || ctx.calendar.realToday; viewY = +v.slice(0, 4); viewM = +v.slice(5, 7) - 1; render();
            pop.style.visibility = 'hidden'; pop.style.display = 'block'; place(); pop.style.visibility = 'visible'; postHeight();
        }
        return { open, close, isOpen };
    })();
    // 직원 줄(정리 파일) 읽기 — 칸 1개, 플랫폼 칸으로 채널 구분(없으면 네이버). 같은 주문에 줄이 여럿이면 오늘 > 뒤 날짜(가까운 순) > 지난 날짜(최근 순) > 날짜 없음
    function readLines(ctx) {
        const today = ctx.today || kstToday();
        const all = parseLines($(ctx.ids.ln).value, 'naver', today);
        ctx.lines = { naver: [], cafe24: [], coupang: [] }; all.forEach(l => { if (!l.bad) ctx.lines[l.ch].push(l); });
        ctx.allLines = all;
    }
    // force = 저장하기/불러오기 시점: 직원 줄이 잡은 주문은 이전 수동 체크를 덮는다(줄이 더 새 정보). 다운로드 시점(force=false)엔 그 뒤 직원이 만진 체크를 존중.
    function applyLines(ctx, force = true) {
        const today = ctx.today || kstToday();
        const rank = l => !l.date ? 3e15 : l.date === today ? 0 : l.date > today ? 1e15 + Date.parse(l.date) : 2e15 - Date.parse(l.date);
        ctx.allLines.forEach(l => { l.hits = 0; l.applied = 0; l.hitRows = []; });
        ctx.merged.forEach(e => {
            e.individual = false; e.req = null; e.reqKind = null; e.reqToday = false;
            const cands = ctx.lines[e.ch].filter(l => matchKey(ctx, e, l.digits, l.key) && (!l.recipient || String(e.conv['수취인명'] || '').trim() === l.recipient));
            cands.forEach(l => { l.hits++; l.hitRows.push(e); });
            // 직원 줄 없음 → 손님 메모 판정 그대로
            if (!cands.length) { e.flag = e.memoFlag; if (!e.userTouched) e.excluded = (e.memoFlag === 'excl'); return; }
            const l = cands.sort((a, b) => rank(a) - rank(b))[0]; e.req = l; if (force) e.userTouched = false;
            if (l.partial) { e.reqKind = 'partial'; e.flag = 'review'; if (!e.userTouched) e.excluded = false; return; }
            if (!l.date) { e.reqKind = 'nodate'; e.flag = 'review'; if (!e.userTouched) e.excluded = false; return; }
            if (l.date > today) { e.reqKind = 'future'; e.flag = 'excl'; if (!e.userTouched) e.excluded = true; l.applied++; return; }
            if (l.date < today) { e.reqKind = 'past'; e.flag = 'review'; if (!e.userTouched) e.excluded = false; return; }
            // 오늘
            if (l.indiv && ctx.allowIndiv) { e.reqKind = 'indiv'; e.individual = true; e.flag = null; e.excluded = false; l.applied++; return; }
            e.reqKind = 'today'; e.reqToday = true; e.flag = 'review'; if (!e.userTouched) e.excluded = false; l.applied++;
        });
    }
    // 저장 결과 표(알림 발송 이력 표와 같은 짜임: 플랫폼 · 요청날짜 · 구매자 · 품목 · 수량 · 수신 · 판정 · 처리) — 주문 1건당 1행, 주문 없는 줄은 1행
    const chPill = ch => { const m = { cafe24: ['🏠 자사몰', '#EEF2FF', '#4F46E5'], coupang: ['🛍️ 쿠팡', '#FDF3E2', '#B26A00'], naver: ['🛒 네이버', '#E8F8EF', '#1E8E4E'] }[ch] || ['?', '#F2F4F7', '#667085']; return `<span class="pill" style="background:${m[1]}; color:${m[2]}; font-size:11px; white-space:nowrap;">${m[0]}</span>`; };
    const WD = ['일', '월', '화', '수', '목', '금', '토'];
    const dateLabel = iso => iso ? `${mdLabel(iso)} (${WD[new Date(iso + 'T00:00:00Z').getUTCDay()]})` : '—';
    const pillOk = '<span class="pill pill-ok">✅ 확인완료</span>', pillNone = '<span class="pill pill-off">❌ 주문 없음</span>', pillWarn = '<span class="pill pill-wait">⚠️ 확인필요</span>';
    // 처리 칸: 그 주문에 실제로 적용된 결과(e.reqKind 기준 — 같은 손님에 줄이 여럿이면 우선 줄이 이김)
    const actOf = (e, l, ctx) => {
        const k = e.reqKind, d = e.req && e.req.date;
        if (e.req !== l) return { p: pillOk, a: `<span class="act warn">다른 줄(${dateLabel(d)}) 우선 적용</span>` };
        if (k === 'future') return { p: pillOk, a: ctx.allowIndiv ? `<span class="act del">🗑 삭제완료 · ${mdLabel(d)} 발송분</span><span class="sub">시트1·시트2 모두 빠짐</span>` : `<span class="act del">🗑 집계 제외 · ${mdLabel(d)} 발송분</span>` };
        if (k === 'indiv') return { p: pillOk, a: `<span class="act indiv">✂ 입력삭제 · 시트2 노란 행</span><span class="sub">시트1(택배사)에서만 빠짐</span>` };
        if (k === 'today') return { p: pillOk, a: ctx.allowIndiv ? `<span class="act ok">🚚 ${mdLabel(d)} 발송</span>${e.parse ? '<span class="sub">손님 메모보다 우선 · 시트1 배송메모 비움</span>' : ''}` : `<span class="act ok">📦 집계 포함${l.indiv ? ' · 입력삭제' : ''}</span>` };
        if (k === 'past') return { p: pillWarn, a: `<span class="act warn">⚠ 지난 날짜 확인</span><span class="sub">아직 배송준비 — 검토 목록에서 결정</span>` };
        if (k === 'nodate') return { p: pillWarn, a: `<span class="act warn">⚠ 날짜 없음 확인</span>` };
        if (k === 'partial') return { p: pillWarn, a: `<span class="act warn">⚠ 부분 지정 확인</span><span class="sub">수취인 이름이 없어 자동 적용 안 함</span>` };
        return { p: pillOk, a: '' };
    };
    function renderResults(ctx) {
        const el = $(ctx.ids.res); if (!el) return;
        const all = ctx.allLines || []; const today = ctx.today || kstToday();
        if (!all.length) { el.innerHTML = ''; return; }
        if (!ctx.merged.length) { el.innerHTML = `<div class="notice">⚠️ 먼저 주문을 불러오세요 — 저장된 ${all.length}줄은 불러오는 순간 자동으로 적용됩니다.</div>`; return; }
        const rows = [];
        all.forEach((l, k) => {
            if (l.bad) { rows.push(`<tr data-k="${k}"><td>${chPill(null)}</td><td>—</td><td colspan="4" style="color:#B45309;">형식 오류: ${aoEsc(l.line)}<span class="sub">요청일자 · 번호 · 비고 · 플랫폼 순으로</span></td><td>${pillWarn}</td><td></td></tr>`); return; }
            const warn = l.expect != null && l.hits && l.expect !== l.hits ? `<span class="sub" style="color:#B45309;">⚠ 비고 ${l.expect}건과 다름(실제 ${l.hits}건)</span>` : '';
            if (!l.hits) { rows.push(`<tr data-k="${k}"><td>${chPill(l.ch)}</td><td>${dateLabel(l.date)}</td><td>—</td><td class="item">—${l.note ? `<span class="sub">${aoEsc(l.note)}</span>` : ''}</td><td>—</td><td>${aoEsc(fmtTel(l.key))}</td><td>${pillNone}</td><td><span class="act none">${l.date && l.date < today ? '이미 처리된 듯' : '배송준비에 없음'}</span></td></tr>`); return; }
            l.hitRows.forEach((e, j) => {
                const { p, a } = actOf(e, l, ctx); const raw = rawOf(ctx, e) || {};
                const buyer = e.conv['구매자명'] || raw['구매자명'] || raw['주문자명'] || raw['구매자'] || '—'; const rcv = e.conv['수취인명'] || '';
                rows.push(`<tr data-k="${k}"><td>${chPill(e.ch)}</td><td>${dateLabel(l.date)}</td><td>${aoEsc(buyer)}${rcv && rcv !== buyer ? `<span class="sub">→ ${aoEsc(rcv)}</span>` : ''}</td><td class="item" title="${aoEsc(e.conv['옵션정보'])}">${aoEsc(e.conv['옵션정보'])}${l.note ? `<span class="note">📋 ${aoEsc(l.note)}</span>` : ''}</td><td>${aoEsc(e.conv['수량'])}</td><td>${aoEsc(fmtTel(l.key))}</td><td>${p}${j === 0 ? warn : ''}</td><td>${a}</td></tr>`);
            });
        });
        const okL = all.filter(l => !l.bad && l.hits && l.hitRows.every(e => e.req !== l || !['past', 'nodate', 'partial'].includes(e.reqKind))).length;
        const warnL = all.filter(l => l.bad || (l.hits && l.hitRows.some(e => e.req === l && ['past', 'nodate', 'partial'].includes(e.reqKind)))).length;
        const noneL = all.filter(l => !l.bad && !l.hits).length;
        el.innerHTML = `<div class="sum">저장 <b>${all.length}</b>줄 → ✅ 확인완료 <b>${okL}</b>줄(주문 ${all.reduce((s, l) => s + (l.hits || 0), 0)}건) · ⚠️ 확인필요 <b>${warnL}</b>줄 · ❌ 주문 없음 <b>${noneL}</b>줄 · 기준일 ${today}</div>`
            + `<div class="table-scroll-wrapper ivt"><table class="data-table"><thead><tr><th>플랫폼</th><th>요청날짜</th><th>구매자</th><th>품목</th><th>수량</th><th>수신</th><th>판정</th><th>처리</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    }
    const statusOf = e => e.individual ? '<span class="tag indiv">개별발송(시트2만)</span>'
        : e.excluded ? (e.req ? `<span class="tag excl">제외(요청 ${mdLabel(e.req.date)})</span>` : '<span class="tag excl">제외(기준일 발송 아님)</span>')
        : e.reqKind === 'today' ? `<span class="tag review">${mdLabel(e.req.date)} 발송(요청)</span>`
        : e.reqKind === 'partial' ? '<span class="tag review">부분 지정 확인</span>'
        : e.reqKind === 'past' ? '<span class="tag review">지난 요청일 확인</span>'
        : e.reqKind === 'nodate' ? '<span class="tag review">요청일 없음 확인</span>'
        : e.flag === 'review' ? '<span class="tag review">확인필요</span>' : '';
    function reqOf(e) {
        if (e.req) {
            const l = e.req;
            if (e.reqKind === 'today') return `요청 ${mdLabel(l.date)} = 기준 발송일 → 발송(메모 무시)`;
            if (e.reqKind === 'indiv') return `${mdLabel(l.date)} 개별발송(입력o·삭제x)`;
            if (e.reqKind === 'future') return `요청 ${mdLabel(l.date)} 발송`;
            if (e.reqKind === 'past') return `요청 ${mdLabel(l.date)} — 지난 날짜`;
            if (e.reqKind === 'partial') return '「' + l.note + '」 — 직접 확인';
            return '요청일 없음 — 직접 확인';
        }
        const p = e.parse; if (!p) return '';
        if (p.kind === 'ship') return `${p.reqDate} 발송 요청`;
        if (p.kind === 'arrive') return `${p.reqDate} 도착 요청`;
        return '애매함 — 직원 확인';
    }
    // 배송메모 칸 = 손님 원문만(엑셀에 들어가는 값 그대로). 직원 줄(📋)은 「읽어낸 요청」 칸에 — 대표 지적(9/18): 메모 칸에 겹쳐 보이니 실제 메모로 오해
    // 배송메모는 검토의 핵심이라 흰 상자 + 왼쪽 인디고 선으로 강조(#452-u 대표). 빈 메모는 옅게 「—」
    const memoCell = e => { const m = String(e.conv['배송메세지'] || '').trim(); return m ? `<div class="memo-box">${aoEsc(m)}</div>` : '<div class="memo-box empty">—</div>'; };
    const reqCell = e => (e.req ? `<span class="note">📋 ${aoEsc([e.req.date ? mdLabel(e.req.date) : '', e.req.key, e.req.note].filter(Boolean).join(' '))}</span>` : '') + aoEsc(reqOf(e));
    const cb = (e, k) => e.individual ? '' : `<input type="checkbox" data-k="${k}" ${e.excluded ? 'checked' : ''}>`;
    const rowClass = e => e.individual ? 'indiv' : e.excluded ? 'excl' : e.flag === 'review' ? 'review' : '';
    const FILTERS = [['all', '전체'], ['excl', '제외 체크'], ['review', '확인필요']];
    function render(ctx, onChange) {
        const rv = $(ctx.ids.review).querySelector('tbody');
        const all = ctx.merged.map((e, k) => ({ e, k })).filter(({ e }) => !e.individual && (e.excluded || e.flag));
        const f = ctx.reviewFilter || 'all';
        // 필터 목록은 버튼을 누른 시점에 고정(키 스냅샷) — 체크를 바꿔도 행이 사라지지 않아 실수로 눌러도 바로 되돌릴 수 있다(대표 실물 9/18). 저장/불러오기(refresh)·필터 변경 때 다시 계산.
        const key = e => e.ch + ':' + e.i;
        if (f !== 'all' && !ctx.reviewFilterKeys) ctx.reviewFilterKeys = new Set(all.filter(({ e }) => f === 'excl' ? e.excluded : (!e.excluded && e.flag === 'review')).map(({ e }) => key(e)));
        const revRows = f === 'all' ? all : all.filter(({ e }) => ctx.reviewFilterKeys.has(key(e)));
        const cnt = { all: all.length, excl: all.filter(x => x.e.excluded).length, review: all.filter(x => !x.e.excluded && x.e.flag === 'review').length };
        const fl = $(ctx.ids.filter); if (fl) { fl.innerHTML = FILTERS.map(([v, t]) => `<button type="button" class="btn-sm btn-outline${f === v ? ' active' : ''}" data-f="${v}">${t} <b>${cnt[v]}</b></button>`).join(''); fl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { ctx.reviewFilter = b.dataset.f; ctx.reviewFilterKeys = null; render(ctx, onChange); })); }
        rv.innerHTML = revRows.length ? revRows.map(({ e, k }) => `<tr class="${e.excluded ? 'excl' : 'review'}"><td>${cb(e, k)}</td><td class="ch">${CH_LABEL[e.ch]}</td><td>${aoEsc(e.conv['수취인명'])}</td><td>${aoEsc(e.conv['옵션정보'])}</td><td>${aoEsc(e.conv['수량'])}</td><td class="memo">${memoCell(e)}</td><td class="req">${reqCell(e)}</td><td>${statusOf(e)}</td></tr>`).join('')
            : `<tr><td colspan="8" style="color:#6B7280;">${f === 'all' ? '검토할 배송메모가 없습니다.' : '이 조건에 해당하는 건이 없습니다.'}</td></tr>`;
        if (ctx.ids.preview) {
            $(ctx.ids.preview).querySelector('tbody').innerHTML = ctx.merged.map((e, k) => `<tr class="${rowClass(e)}"><td>${cb(e, k)}</td><td>${k + 1}</td><td class="ch">${CH_LABEL[e.ch]}</td><td>${aoEsc(e.conv['수취인명'])}</td><td>${aoEsc(e.conv['옵션정보'])}</td><td>${aoEsc(e.conv['수량'])}</td><td>${aoEsc(String(e.conv['배송지'] || '').slice(0, 40))}</td><td class="memo">${memoCell(e)}${e.req ? `<span class="note">📋 ${aoEsc([e.req.date ? mdLabel(e.req.date) : '', e.req.note].filter(Boolean).join(' '))}</span>` : ''}</td><td>${statusOf(e)}</td></tr>`).join('');
        }
        const n = ctx.merged.length, indiv = ctx.merged.filter(e => e.individual).length, excl = ctx.merged.filter(e => !e.individual && e.excluded).length, review = ctx.merged.filter(e => !e.individual && !e.excluded && e.flag === 'review').length;
        $(ctx.ids.stats).innerHTML = ctx.ids.preview
            ? `<span>전체 <b>${n}</b>건</span><span>시트1(택배사) <b>${n - indiv - excl}</b>건</span><span>개별발송 <b>${indiv}</b>건</span><span>제외 체크 <b>${excl}</b>건</span><span>확인필요 <b>${review}</b>건</span>${ctx.today ? `<span>기준 발송일 <b>${dateLabel(ctx.today)}</b></span>` : ''}`
            : `<span>전체 <b>${n}</b>건</span><span>집계 대상 <b>${n - excl}</b>건</span><span>제외 체크 <b>${excl}</b>건</span><span>확인필요 <b>${review}</b>건</span>${ctx.today ? `<span>기준 발송일 <b>${dateLabel(ctx.today)}</b></span>` : ''}`;
        const scope = [ctx.ids.review, ctx.ids.preview].filter(Boolean).map(id => '#' + id + ' input[type=checkbox]').join(', ');
        document.querySelectorAll(scope).forEach(el => el.addEventListener('change', () => { const e = ctx.merged[Number(el.dataset.k)]; e.excluded = el.checked; e.userTouched = true; render(ctx, onChange); if (onChange) onChange(); }));
        // 행 어디를 눌러도 체크 토글(#452-u 대표): 체크박스·글자 드래그 선택 중이면 제외. 개별발송 행(체크박스 없음)은 무반응
        [ctx.ids.review, ctx.ids.preview].filter(Boolean).forEach(id => document.querySelectorAll('#' + id + ' tbody tr').forEach(tr => {
            const cbEl = tr.querySelector('input[type=checkbox]'); if (!cbEl) return; tr.classList.add('clickable');
            tr.addEventListener('click', ev => { if (ev.target.closest('input, a, button, label')) return; const sel = window.getSelection && window.getSelection(); if (sel && String(sel).trim()) return; cbEl.checked = !cbEl.checked; cbEl.dispatchEvent(new Event('change', { bubbles: true })); });
        }));
    }
    function dateGuard(ctx, msgId) {   // 페이지를 전날부터 열어 두면 기준 발송일 계산이 낡는다 → 다운로드·집계 전에 막고 다시 불러오게
        if (ctx.fetchedOn && ctx.fetchedOn !== kstToday()) { $(msgId).textContent = `⚠️ ${ctx.fetchedOn}에 불러온 화면이에요(기준 발송일 ${ctx.shipDate}). 새로고침 후 주문을 다시 불러와 검토해주세요.`; return false; }
        if (ctx.shipDate && ctx.shipDate < kstToday()) { $(msgId).textContent = `⚠️ 기준 발송일(${ctx.shipDate})이 이미 지났어요. 기준 발송일을 다시 골라주세요.`; return false; }
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
    const C = makeCtx({ ln: 'ln-all', save: 'save-all', res: 'res-all', review: 'review', preview: 'preview', stats: 'stats', ship: 'ship-date', shipNote: 'ship-note', filter: 'review-filter' }, true);
    const days = ch => Math.min(Math.max(parseInt($('days-' + ch).value) || 50, 1), 180);
    const setMsg = (ch, html) => { $('msg-' + ch).innerHTML = html; };
    const markArea = (ch, label) => { $('area-' + ch).classList.add('has-file'); $('fname-' + ch).textContent = label; };
    async function refreshC(resetCh) { if (resetCh) C.merged = C.merged.filter(e => e.ch !== resetCh); rebuild(C); await parseMemos(C); readLines(C); applyLines(C); C.reviewFilterKeys = null; render(C); renderResults(C); $('btn-download').disabled = !C.merged.length; }
    // 진행률 표시 — 본 화면 aoProgressBarTicker와 같은 모양(구버전에 있던 것 · #452-s 이식). 네이버 40일 = 40회+ 호출이라 40초 넘게 걸림
    function progressTicker(el, estSec, label, extraFn) {
        if (!el) return () => {};
        const t0 = Date.now();
        const draw = () => {
            const s = Math.round((Date.now() - t0) / 1000); const pct = Math.min(95, Math.round((s / Math.max(estSec, 3)) * 100));
            el.innerHTML = `<div style="font-size:13px;color:#e67700;font-weight:600;">⏳ ${label} <strong>${pct}%</strong> <span style="color:#999;font-weight:400;">(${s}초 경과)</span></div><div style="height:10px;background:#eee;border-radius:6px;overflow:hidden;margin-top:4px;"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#F5C800,#e67700);transition:width .5s ease;"></div></div>`
                + (extraFn ? `<div style="font-size:12px;color:var(--text-mid,#667085);margin-top:4px;">${extraFn(s)}</div>` : '') + `<div style="font-size:11px;color:#999;margin-top:2px;">잠시만요 — 완료되면 여기 바로 표시됩니다 (나가지 않으셔도 돼요)</div>`;
        };
        draw(); const iv = setInterval(draw, 1000); return () => clearInterval(iv);
    }
    async function loadNaverApi() {
        const d = days('naver'); const btn = $('btn-naver'); btn.disabled = true;
        const stop = progressTicker($('msg-naver'), d * 1.3 + 8, `네이버 배송준비 조회 중... (최근 ${d}일)`);
        try {
            await P.aoLoadInvoicePricing();   // #440 동일: 클릭마다 단가표 품목명 새로 읽기(주중 이름 변경·주 바뀜)
            const r = await fetchChannel('naver', d); stop();
            if (!r.ok) { setMsg('naver', '⚠️ ' + aoEsc(r.message || '불러오기 실패')); return; }
            C.naver = { src: 'api', rows: r.rows || [] }; markArea('naver', `🛰️ 네이버 배송준비 ${r.count}건`);
            setMsg('naver', `✅ 배송준비 <b>${r.count}건</b> 불러왔습니다.${r.partial_adjusted ? ` · 부분취소 수량 반영 ${r.partial_adjusted}건` : ''}`);
            await refreshC('naver');
        } finally { stop(); btn.disabled = false; }
    }
    async function loadOther(ch) {
        const btn = $('btn-' + ch); btn.disabled = true;
        const stop = progressTicker($('msg-' + ch), 12, `${CH_LABEL[ch]} 조회 중... (최근 ${days(ch)}일)`);
        try {
            await P.aoLoadInvoicePricing();
            const r = await fetchChannel(ch, days(ch)); stop();
            if (!r.ok) { setMsg(ch, '⚠️ ' + aoEsc(r.message || '불러오기 실패')); return; }
            C[ch] = r.rows || []; markArea(ch, `${CH_LABEL[ch]} ${r.count}건`); setMsg(ch, `✅ <b>${r.count}건</b> 불러왔습니다.${r.partial_adjusted ? ` · 부분취소 수량 반영 ${r.partial_adjusted}건` : ''}`);
            if (ch === 'coupang') C.coupangLoadedAt = new Date().toISOString();   // 변환 직전 취소 재확인 기준 시각(구버전 Task 4와 동일)
            await refreshC(ch);
        } finally { stop(); btn.disabled = false; }
    }
    // 구버전 [통합 변환] 클릭 시 하던 쿠팡 취소 재확인(대표 7/26 지시문 §5) 이식 — 쿠팡은 상품준비중에도 취소요청이 생기므로 다운로드 직전 API로 불러온 쿠팡분만 재조회해 자동 제외. 실패해도 변환은 진행+경고.
    async function recheckCoupang() {
        if (!C.coupangLoadedAt || !C.coupang.length) return 0;
        try {
            const r = await api('/api/agent-office/coupang/canceled-since?since=' + encodeURIComponent(C.coupangLoadedAt));
            if (!r.ok) throw new Error(r.message || '재확인 실패');
            const canceled = new Set((r.canceled || []).map(String));
            C.coupangLoadedAt = new Date().toISOString();
            if (!canceled.size) return 0;
            const keep = C.coupang.filter(row => !canceled.has(String(row._orderId || '')));
            const removed = C.coupang.length - keep.length; if (!removed) return 0;
            const newIdx = new Map(keep.map((row, i) => [row, i]));   // 남은 쿠팡 행의 검토 결정(체크 등)은 새 위치로 옮겨 보존
            C.merged = C.merged.filter(e => e.ch !== 'coupang' || newIdx.has(C.coupang[e.i])).map(e => (e.ch === 'coupang' ? Object.assign(e, { i: newIdx.get(C.coupang[e.i]) }) : e));
            C.coupang = keep; rebuild(C); readLines(C); applyLines(C, false); render(C);
            setMsg('coupang', `🛡️ 변환 직전 재확인: 쿠팡 취소 요청 <b>${removed}건</b>을 자동 제외했습니다.`);
            return removed;
        } catch (e) { setMsg('coupang', `⚠️ 쿠팡 취소 재확인 실패(${aoEsc(String(e.message || e))}) — 변환은 진행합니다. Wing에서 취소 여부를 확인해주세요.`); return 0; }
    }
    async function loadFile(ch, file) {
        $('area-' + ch).classList.add('decrypting');
        let wbInfo; try { await P.aoLoadInvoicePricing(); wbInfo = await readWorkbook(file); } finally { $('area-' + ch).classList.remove('decrypting'); }
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
        C.naver = null; C.cafe24 = []; C.coupang = []; C.merged = []; C.today = null; C.allLines = [];
        $('ln-all').value = ''; $('res-all').innerHTML = '';
        CH.forEach(ch => { $('area-' + ch).classList.remove('has-file'); $('fname-' + ch).textContent = ''; setMsg(ch, ''); });
        $('msg-dl').textContent = ''; render(C); $('btn-download').disabled = true;
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
        // #452-t(대표 9/18 실물): 원본 파일과 동일하게 — 배송방법(구매자 요청)·배송방법 = 「택배,등기,소포」(네이버 API가 deliveryMethod를 비워 보내 빈칸이었음), 택배사 = 빈칸(택배사가 바뀔 수 있어 미리 안 넣음)
        return [sCell(x.productOrderId || row._pid), sCell(dmLabel(x.deliveryMethod) || '택배,등기,소포'), sCell('택배,등기,소포'), sCell(''), sCell(''),
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
    async function download() {
        const cpRemoved = await recheckCoupang();
        readLines(C); applyLines(C, false); renderResults(C);
        if (!dateGuard(C, 'msg-dl')) return null;
        const list = C.merged.filter(e => !e.individual && !e.excluded);
        if (!list.length) { $('msg-dl').textContent = '내보낼 주문이 없습니다.'; return null; }
        let captured = null; const origWrite = XLSX.writeFile;
        XLSX.writeFile = (wb, name) => { captured = { wb, name }; };
        // 시트1 = 본 화면 실코드 그대로. 단 직원 줄이 「기준일 발송」으로 확정한 주문은 손님 배송메모를 비워 택배사 시트에서 헷갈리지 않게(#452-m 대표). 시트2(네이버 원본)는 그대로.
        const memoCleared = list.filter(e => e.reqKind === 'today').length;
        try { P.exportInvoiceExcel(list.map(e => e.reqKind === 'today' ? { ...e.conv, '배송메세지': '' } : e.conv)); } finally { XLSX.writeFile = origWrite; }
        if (!captured) throw new Error('시트1 생성 실패');
        let s2 = null;
        if (C.naver) { s2 = buildSheet2(list); XLSX.utils.book_append_sheet(captured.wb, s2.ws, '발주발송관리'); }
        const name = captured.name.replace(/\.xlsx$/i, '') + '_v2.xlsx';
        origWrite(captured.wb, name);
        $('msg-dl').textContent = `${name} — 기준 발송일 ${mdLabel(C.shipDate)} · 시트1 ${list.length}건${memoCleared ? `(요청 줄로 발송 확정한 ${memoCleared}건은 배송메모 비움)` : ''}${s2 ? ` · 시트2 ${s2.count + s2.indiv}건(개별발송 ${s2.indiv}건 노란 표시)` : ''}${cpRemoved ? ` · 🛡️ 쿠팡 취소 ${cpRemoved}건 자동 제외` : ''}`;
        return captured.wb;
    }

    // ── 중간발주 탭(독립) ─────────────────────────────────────────────────────────
    const Q = makeCtx({ ln: 'qln-all', save: 'qsave-all', res: 'qres-all', review: 'qreview', preview: null, stats: 'qstats', ship: 'qship-date', shipNote: 'qship-note', filter: 'qreview-filter' }, false);
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
        const chState = { nv: '⏳ 조회 중', cp: '⏳ 조회 중', cf: '⏳ 조회 중' };   // 구버전과 같은 채널별 진행 표시
        const stop = progressTicker($('invoice-qty-msg'), d * 1.3 + 10, `3채널 배송준비 조회 중... (최근 ${d}일)`, () => `🛰️ 네이버: ${chState.nv} · 🛒 쿠팡: ${chState.cp} · 🏠 자사몰: ${chState.cf}`);
        const track = (p, key) => p.then(v => { chState[key] = (v && v.ok) ? `✅ ${v.count || 0}건` : '⚠️ 실패'; return v; }, e => { chState[key] = '⚠️ 실패'; throw e; });
        try {
            await P.aoLoadInvoicePricing();   // #440 동일
            const [nv, cp, cf] = await Promise.allSettled([track(fetchChannel('naver', d), 'nv'), track(fetchChannel('coupang', d), 'cp'), track(fetchChannel('cafe24', d), 'cf')]);
            stop(); $('invoice-qty-msg').innerHTML = '🔄 <b>2/2 변환·합산 중...</b>';
            const val = rv => rv.status === 'fulfilled' && rv.value && rv.value.ok ? rv.value : { ok: false, message: rv.status === 'fulfilled' ? (rv.value && rv.value.message) || '불러오기 실패' : (rv.reason && rv.reason.message) || String(rv.reason) };
            const N = val(nv), P2 = val(cp), F = val(cf);
            if (!N.ok && !P2.ok && !F.ok) { $('invoice-qty-msg').textContent = `⚠️ 3채널 모두 실패 — 네이버: ${N.message} / 쿠팡: ${P2.message} / 자사몰: ${F.message}`; return; }
            Q.naver = N.ok ? { src: 'api', rows: N.rows || [] } : null; Q.coupang = P2.ok ? (P2.rows || []) : []; Q.cafe24 = F.ok ? (F.rows || []) : []; Q.merged = [];
            await refreshQ();
            const fail = [!N.ok && `네이버: ${aoEsc(N.message)}`, !P2.ok && `쿠팡: ${aoEsc(P2.message)}`, !F.ok && `자사몰: ${aoEsc(F.message)}`].filter(Boolean).join(' / ');
            if (fail) $('invoice-qty-msg').innerHTML += `<br><span style="color:var(--danger,#F04438);">⚠️ 실패 채널 제외하고 집계됨 — ${fail}</span>`;
        } catch (e) { $('invoice-qty-msg').textContent = '⚠️ ' + e.message; }
        finally { stop(); btn.disabled = false; }
    }
    async function refreshQ() {
        rebuild(Q); await parseMemos(Q); readLines(Q); applyLines(Q); Q.reviewFilterKeys = null; render(Q, recomputeQ); renderResults(Q); $('qreview-card').style.display = Q.merged.length ? '' : 'none';
        if (Q.merged.length) { if (!dateGuard(Q, 'invoice-qty-msg')) return; recomputeQ(); }
    }
    function resetQ() { Q.naver = null; Q.cafe24 = []; Q.coupang = []; Q.merged = []; Q.today = null; Q.allLines = []; $('qln-all').value = ''; $('qres-all').innerHTML = ''; $('qreview-card').style.display = 'none'; $('invoice-qty-msg').textContent = ''; P.resetInvoiceQty(); }
    function switchMode(mode) {
        $('invoice-convert-mode').style.display = mode === 'qty' ? 'none' : '';
        $('invoice-qty-mode').style.display = mode === 'qty' ? '' : 'none';
        $('ivt-mode-convert').classList.toggle('active', mode !== 'qty'); $('ivt-mode-qty').classList.toggle('active', mode === 'qty');
    }
    // [저장하기] = 칸의 줄을 읽어 즉시 적용 + 결과 표(주문 미로드면 안내만, 불러올 때 자동 적용)
    async function saveLines(ctx) {
        const btn = $(ctx.ids.save); btn.disabled = true;
        try {
            formatTextarea($(ctx.ids.ln));
            if (ctx === C) { await refreshC(); } else { await refreshQ(); }
            if (!ctx.merged.length) { readLines(ctx); applyLines(ctx); renderResults(ctx); }
        } catch (e) { $(ctx.ids.res).innerHTML = `<div class="notice">⚠️ ${aoEsc(e.message)}</div>`; }
        finally { btn.disabled = false; }
    }

    // ── 이벤트 ───────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
        if (!localStorage.getItem('jwt_token')) $('login-gate').style.display = '';
        try { await loadProd(); } catch (e) { setMsg('naver', '⚠️ ' + aoEsc(e.message)); return; }
        $('btn-naver').addEventListener('click', () => loadNaverApi().catch(e => setMsg('naver', '⚠️ ' + aoEsc(e.message))));
        $('btn-cafe24').addEventListener('click', () => loadOther('cafe24').catch(e => setMsg('cafe24', '⚠️ ' + aoEsc(e.message))));
        $('btn-coupang').addEventListener('click', () => loadOther('coupang').catch(e => setMsg('coupang', '⚠️ ' + aoEsc(e.message))));
        $('btn-reset').addEventListener('click', resetC);
        $('btn-download').addEventListener('click', async () => { const b = $('btn-download'); b.disabled = true; try { await download(); } catch (e) { $('msg-dl').textContent = '⚠️ ' + e.message; } finally { b.disabled = !C.merged.length; } });
        $('save-all').addEventListener('click', () => saveLines(C));
        $('qsave-all').addEventListener('click', () => saveLines(Q));
        $('ship-date').addEventListener('click', () => ShipCal.open(C));
        $('qship-date').addEventListener('click', () => ShipCal.open(Q));
        for (const ch of CH) {
            const area = $('area-' + ch), input = $('file-' + ch);
            area.addEventListener('click', () => input.click());
            area.addEventListener('dragover', ev => { ev.preventDefault(); area.classList.add('dragover'); });
            area.addEventListener('dragleave', () => area.classList.remove('dragover'));
            area.addEventListener('drop', ev => { ev.preventDefault(); area.classList.remove('dragover'); const f = ev.dataTransfer.files[0]; if (f) loadFile(ch, f).catch(e => setMsg(ch, '⚠️ ' + aoEsc(e.message))); });
            input.addEventListener('change', () => { const f = input.files[0]; if (f) loadFile(ch, f).catch(e => setMsg(ch, '⚠️ ' + aoEsc(e.message))); input.value = ''; });
        }
        $('ivt-mode-convert').addEventListener('click', () => switchMode('convert'));
        $('ivt-mode-qty').addEventListener('click', () => switchMode('qty'));
        $('ivt-qty-start').addEventListener('click', () => runQty());
        $('ivt-qty-reset').addEventListener('click', resetQ);
        C.allLines = []; Q.allLines = []; render(C);
        // embed(iframe) 모드: 내용 높이를 바깥 페이지에 알려 iframe이 스크롤 없이 늘어나게
        if (IS_EMBED()) { new ResizeObserver(postHeight).observe(document.body); postHeight(); setInterval(postHeight, 1500); }
        if (localStorage.getItem('jwt_token')) { parseMemos(C).then(() => { Q.shipDate = null; return parseMemos(Q); }).catch(() => {}); }   // 기준 발송일 셀렉트 먼저 채움(주문 없이도)
        window.__ivt = { S: C, Q, refreshAll: refreshC, refreshQ, render: () => render(C), download, fmtTel, parseDate, parseLines, switchMode, runQty, qtyTotal: () => P.qtyTotal(), saveLines, ShipCal,
            setNaverApiRows: async rows => { C.naver = { src: 'api', rows }; await refreshC('naver'); },
            setRows: async (ch, rows) => { C[ch] = rows; await refreshC(ch); },
            setQRows: async (nvRows, cfRows, cpRows) => { Q.naver = nvRows ? { src: 'api', rows: nvRows } : null; Q.cafe24 = cfRows || []; Q.coupang = cpRows || []; Q.merged = []; await refreshQ(); } };   // 검증용 훅
    });
})();
