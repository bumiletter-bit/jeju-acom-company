// #508 최종발주(대표 확정 10/4) — 에이전트 오피스 [최종발주] 버튼 → 숨은 송장변환 v2를 조종해 거래처별 택배사 양식 + 수량 표·이미지 + 스마트스토어 양식을 만든다.
//   설계서: docs/superpowers/specs/2026-10-04-final-order-design.md
//   무회귀: invoice-v2.js·invoice-sender.js·app.js 변환 구간·server.js 는 한 글자도 안 고친다. 판정·변환은 v2 실코드(iframe 안)가 하고,
//           이 파일은 조종(불러오기 클릭 · 줄 넣기 · download 가로채기)과 화면, final-order-core.js 는 새 규칙(메모 다듬기 · 현금 대조 · 거래처·정렬·제주 · 13칸 · 수량 표)을 맡는다.
//   개인정보: 주문·현금파일·결과 파일은 브라우저 메모리에서만 다루고 서버·DB에 올리지 않는다.
(() => {
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const core = () => window.FinalOrderCore;
    const DEFAULT_MEMO = '고객님의 소중한 물건으로 파손주의 부탁드리겠습니다.!';
    const CH = ['naver', 'cafe24', 'coupang'];
    const CH_LABEL = { naver: '네이버', cafe24: '자사몰', coupang: '쿠팡' };
    const CAT_RGB = { yellow: 'FFFF00', orange: 'F4B183', blue: 'BDD7EE', green: 'C6E0B4', pink: 'F4CCCC' };   // = 중간발주 색표(#502 · styles.css .qty-cat-*)
    const WD = ['일', '월', '화', '수', '목', '금', '토'];
    const md = iso => iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : '';
    const mdDot = iso => iso ? `${iso.slice(5, 7)}.${iso.slice(8, 10)}` : '';
    const dateLabel = iso => iso ? `${md(iso)} (${WD[new Date(iso + 'T00:00:00Z').getUTCDay()]})` : '';
    const digitsOf = v => String(v == null ? '' : v).replace(/\D/g, '');
    const toast = m => { if (typeof window.showToast === 'function') window.showToast(m); };

    const st = {
        built: false, open: false, busy: false, phase: 'input',   // input → loading → review → result
        frame: null, ready: null, cal: null, byPartner: null,
        cash: null, cashName: '', cashNone: false,                  // cash = core.parseCash 결과
        prep: null, loaded: false, chState: {}, cards: [], info: [],
        dec: new Map(),                                              // 카드 id → 결정값(다시 판정해도 유지)
        draft: new Map(),                                            // 카드 id → 아직 확정 안 한 입력칸 글
        out: null, files: [], fetchCount: 0,
    };

    // ── 숨은 v2 ──────────────────────────────────────────────────────────────
    const W = () => st.frame && st.frame.contentWindow;
    const D = () => st.frame && st.frame.contentDocument;
    const IVT = () => W() && W().__ivt;
    const S = () => IVT().S;
    function ensureFrame() {
        if (st.ready) return st.ready;
        st.ready = (async () => {
            const f = document.createElement('iframe');
            f.id = 'fo-frame'; f.title = '최종발주 계산용(보이지 않음)'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.style.display = 'none';
            f.src = '/invoice-v2.html?fo=1';   // ?embed=1 을 붙이지 않는다 — 붙이면 높이 메시지가 송장변환 메뉴 iframe 높이를 바꾼다(워커1 실측)
            document.body.appendChild(f); st.frame = f;
            for (let i = 0; i < 300; i++) {   // 최대 60초
                const w = f.contentWindow, iv = w && w.__ivt;
                if (iv && iv.S && iv.S.calendar) { st.cal = iv.S.calendar; return true; }
                if (!localStorage.getItem('jwt_token')) throw new Error('로그인이 풀렸어요. 새로고침해서 다시 로그인한 뒤 눌러 주세요.');
                await sleep(200);
            }
            throw new Error('송장변환 화면을 준비하지 못했어요. 새로고침 후 다시 눌러 주세요.');
        })();
        st.ready.catch(() => { if (st.frame) { st.frame.remove(); st.frame = null; } st.ready = null; });
        return st.ready;
    }
    // 세션 만료 판정: v2의 #login-gate 는 스타일시트로 늘 숨겨져 있어 쓸 수 없다(워커1 실측). v2는 401이면 안내 칸에 「로그인 필요」를 적으므로 그 글과 토큰 유무로 본다.
    const sessionLost = () => {
        if (!localStorage.getItem('jwt_token')) return true;
        const d = D(); if (!d) return false;
        return ['msg-naver', 'msg-cafe24', 'msg-coupang', 'res-all', 'msg-dl'].some(id => { const el = d.getElementById(id); return !!(el && /로그인 필요/.test(el.textContent || '')); });
    };
    const rawRow = e => { const s = S(); return (e.ch === 'naver' ? (s.naver && s.naver.rows[e.i]) : (s[e.ch] || [])[e.i]) || null; };
    const rawOf = e => rawRow(e) || {};
    // 주문 키 = 원본 행 객체에 붙인 고유값. `채널:순번`으로 하면 v2의 쿠팡 취소 재확인이 순번을 당길 때 카드 결정이 다른 주문에 걸린다(워커2 재현 B).
    const UID = new WeakMap(); let uidSeq = 0;
    const keyOf = e => { const r = rawRow(e); if (!r || typeof r !== 'object') return e.ch + '@' + e.i; let k = UID.get(r); if (!k) { k = e.ch + '#' + (++uidSeq); UID.set(r, k); } return k; };
    const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const hm = ms => { const d = new Date(ms + 9 * 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
    const buyerTel = e => digitsOf(e.conv['구매자연락처'] || rawOf(e)['구매자연락처'] || rawOf(e)['주문자 휴대전화'] || rawOf(e)['구매자전화번호']);   // = v2 telOf
    const idsOf = e => { const r = rawOf(e); return [r._orderId, r._pid, r['주문번호'], r['상품주문번호'], r._x && r._x.orderId, r._x && r._x.productOrderId].filter(Boolean).map(String); };   // = v2 idsOf
    const buyerName = e => { const r = rawOf(e); return e.conv['구매자명'] || r['구매자명'] || r['주문자명'] || r['구매자'] || String(e.conv['보내는사람'] || '').replace(/\(제주아꼼이네[^)]*\)\s*$/, '').trim(); };
    const qtyOf = e => parseInt(e.conv['수량'], 10) || 0;
    const goingOut = e => !e.individual && !e.excluded;

    // ── 화면 뼈대 ────────────────────────────────────────────────────────────
    function build() {
        if (st.built) return; st.built = true;
        const el = document.createElement('div');
        el.id = 'fo-panel'; el.className = 'fo'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'fo-title');
        el.innerHTML = `
        <div class="fo-box">
            <header class="fo-head">
                <div><h2 id="fo-title">최종발주</h2><p class="fo-sub">거래처별 택배사 양식, 수량 표, 스마트스토어 양식을 한 번에 만들어요. 송장변환 메뉴는 그대로 쓸 수 있어요.</p></div>
                <button type="button" class="fo-btn" id="fo-close">닫기</button>
            </header>
            <div class="fo-body">
                <section class="fo-sec" id="fo-in" aria-label="입력">
                    <div class="fo-grid">
                        <div class="fo-field">
                            <label for="fo-ship">기준 발송일</label>
                            <select id="fo-ship" disabled><option>달력을 불러오는 중</option></select>
                            <p class="fo-hint" id="fo-ship-note">토요일과 발송휴무일은 고를 수 없어요.</p>
                        </div>
                        <div class="fo-field">
                            <span class="fo-label" id="fo-cash-label">현금파일</span>
                            <div class="fo-cashrow" role="group" aria-labelledby="fo-cash-label">
                                <input type="file" id="fo-cash" accept=".xlsx,.xls" hidden>
                                <button type="button" class="fo-btn" id="fo-cash-pick">파일 고르기</button>
                                <button type="button" class="fo-btn sm" id="fo-cash-clear" hidden>파일 빼기</button>
                                <label class="fo-check"><input type="checkbox" id="fo-cash-none"> 오늘은 없음</label>
                            </div>
                            <p class="fo-hint" id="fo-cash-note">현금, 입력삭제 건의 주소 줄이 적힌 엑셀(13칸 양식)</p>
                        </div>
                    </div>
                    <div class="fo-field">
                        <label for="fo-memo">개별발송 처리 · 지정 발송일</label>
                        <textarea id="fo-memo" rows="6" spellcheck="false" placeholder="10/5&#9;010-0000-0000&#9;입력o삭제x&#9;네이버&#10;010-0000-0000 금요일 발송&#10;10/5&#9;010-0000-0000&#9;보내는이 홍길동"></textarea>
                        <p class="fo-hint">정리 파일 줄을 그대로 붙여 넣어요(요청일자, 번호, 비고, 플랫폼 순서).</p>
                    </div>
                    <div class="fo-acts">
                        <button type="button" class="fo-btn primary" id="fo-start" disabled>주문 불러와 시작하기</button>
                        <button type="button" class="fo-btn" id="fo-rejudge" hidden>다시 판정</button>
                        <button type="button" class="fo-btn" id="fo-reload" hidden>주문 다시 불러오기</button>
                        <span class="fo-msg" id="fo-in-msg" role="status"></span>
                        <button type="button" class="fo-btn fo-reset" id="fo-reset">초기화</button>
                    </div>
                    <div class="fo-reset-confirm" id="fo-reset-confirm" hidden role="alertdialog" aria-labelledby="fo-reset-q">
                        <p id="fo-reset-q"><b>전부 지우고 처음부터 할까요?</b> 메모 · 현금파일 · 확인 카드에서 고른 것 · 말로 바꾼 것 · 대화 · 만든 파일이 지워져요.</p>
                        <div class="fo-acts"><button type="button" class="fo-btn fo-reset solid" id="fo-reset-yes">초기화</button><button type="button" class="fo-btn" id="fo-reset-no">취소</button></div>
                    </div>
                </section>
                <section class="fo-sec" id="fo-progress" hidden aria-label="주문 불러오기" aria-live="polite"></section>
                <section class="fo-sec" id="fo-review" hidden aria-label="확인">
                    <div class="fo-sum" id="fo-sum"></div>
                    <div class="fo-ai" id="fo-ai" hidden><button type="button" class="fo-btn" id="fo-ai-read">AI에게 메모 읽히기</button><button type="button" class="fo-btn sm" id="fo-ai-stop" hidden>그만두기</button><span class="fo-msg" id="fo-ai-msg" role="status"></span></div>
                    <div class="fo-info" id="fo-info"></div>
                    <div class="fo-cards" id="fo-cards"></div>
                    <div class="fo-acts sticky">
                        <button type="button" class="fo-btn primary" id="fo-make" disabled>파일 만들기</button>
                        <span class="fo-msg" id="fo-make-msg" role="status"></span>
                    </div>
                </section>
                <section class="fo-sec" id="fo-result" hidden aria-label="결과"></section>
                <section class="fo-sec fo-chat" id="fo-chat" hidden aria-label="클코와 대화">
                    <div class="fo-cards-head"><h3>클코와 대화하는 칸</h3></div>
                    <div class="fo-patches" id="fo-patches"></div>
                    <div class="fo-thread" id="fo-chat-log" aria-live="polite"></div>
                    <div class="fo-compose">
                        <span class="fo-spark" aria-hidden="true">✦</span>
                        <textarea id="fo-chat-input" rows="2" maxlength="1500" aria-label="클코에게 말로 고칠 것 적기" placeholder="말로 고칠 것을 적어요 — 예: 김○○ 건 2박스로 · 김○○ 건 주소 ○○로 12, 301호로 바꿔줘 · 제주 건 있어?"></textarea>
                        <div class="fo-compose-row">
                            <button type="button" class="fo-btn sm" id="fo-chat-stop" hidden>그만두기</button>
                            <button type="button" class="fo-icon primary" id="fo-chat-send" aria-label="보내기" title="보내기 (Enter) · 줄바꿈은 Shift+Enter"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg></button>
                        </div>
                    </div>
                    <p class="fo-hint">바뀔 내용을 먼저 보여 주고 [적용]을 눌러야 바뀌어요. 정리 파일 줄을 붙여도 돼요.</p>
                    <span class="fo-msg" id="fo-chat-msg" role="status"></span>
                </section>
            </div>
        </div>`;
        document.body.appendChild(el);
        $('fo-close').addEventListener('click', () => close());
        el.addEventListener('mousedown', e => { if (e.target === el && !st.busy) close(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.open && !st.busy) close(); });
        window.addEventListener('popstate', () => { if (st.skipPop) { st.skipPop = false; return; } if (st.open) close(true); });
        $('fo-cash-pick').addEventListener('click', () => $('fo-cash').click());
        $('fo-cash').addEventListener('change', e => { const f = (e.target.files || [])[0]; e.target.value = ''; if (f) readCash(f); });
        $('fo-cash-clear').addEventListener('click', () => { if (st.busy) return; st.cash = null; st.cashName = ''; $('fo-cash').value = ''; markStale(); syncInput(); });
        $('fo-cash-none').addEventListener('change', e => { st.cashNone = e.target.checked; if (st.cashNone) { st.cash = null; st.cashName = ''; } markStale(); syncInput(); });
        mountMemoEd();
        $('fo-memo').addEventListener('input', () => { markStale(); fitMemoEd(); if (st.memoEd && st.judged) st.memoEd.ed.classList.add('stale'); });
        $('fo-ship').addEventListener('change', markStale);
        $('fo-start').addEventListener('click', () => run(start));
        $('fo-rejudge').addEventListener('click', () => run(judge));
        $('fo-reload').addEventListener('click', () => run(start));
        $('fo-make').addEventListener('click', () => run(make));
        $('fo-cards').addEventListener('click', onCardClick);
        $('fo-cards').addEventListener('change', onCardChange);
        $('fo-result').addEventListener('click', onResultClick);
        $('fo-chat').addEventListener('click', onChatClick);
        $('fo-reset').addEventListener('click', () => { if (st.busy) return; $('fo-reset-confirm').hidden = false; $('fo-reset-yes').focus({ preventScroll: true }); });
        $('fo-reset-no').addEventListener('click', () => { $('fo-reset-confirm').hidden = true; $('fo-reset').focus({ preventScroll: true }); });
        $('fo-reset-yes').addEventListener('click', resetAll);
        $('fo-chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); chatSend(); } });
        $('fo-progress').addEventListener('click', e => { const b = e.target.closest('button[data-fo-load]'); if (b) run(() => b.dataset.foLoad === 'retry' ? loadChannels(CH.filter(c => st.chState[c] && st.chState[c].fail)).then(afterLoad) : skipFailed()); });
    }
    const LOCKS = ['fo-memo', 'fo-ship', 'fo-cash-pick', 'fo-cash-none'];
    async function run(fn) {
        if (st.busy || (st.ai && st.ai.running)) return; st.busy = true; $('fo-panel').classList.add('busy');
        LOCKS.forEach(id => { $(id).disabled = true; });   // 실행 중에는 입력을 잠근다 — 판정이 도는 사이 메모를 고치면 낡은 판정으로 파일이 만들어진다(워커2 재현 E)
        try { await fn(); } catch (err) { showError(err); } finally { st.busy = false; $('fo-panel').classList.remove('busy'); LOCKS.forEach(id => { $(id).disabled = id === 'fo-ship' && !st.cal; }); syncInput(); syncMake(); syncAi(); syncChat(); }
        if (st.autoAi) { st.autoAi = false; if (st.judged && !st.stale) aiRead(true); }   // #520
    }
    // 실패한 채널 없이 계속: 주문은 받았는데 그 뒤 판정에서 실패한 채널이면 받은 주문도 비운다(안내 글 「결과 파일에 들어가지 않아요」와 맞게)
    async function skipFailed() {
        const s = S();
        CH.filter(c => st.chState[c] && st.chState[c].fail).forEach(c => { if (c === 'naver') s.naver = null; else s[c] = []; st.chState[c] = { fail: true, t: '이번에는 넣지 않음' }; });
        drawProgress(); st.loaded = true; st.loadedOn = kstToday(); st.loadedAt = Date.now();
        if (s.calendar) { st.cal = s.calendar; fillShip(); }
        await judge();
    }
    function showError(err) {
        const m = sessionLost() ? '로그인이 풀렸어요. 새로고침해서 다시 로그인한 뒤 처음부터 해 주세요.' : (err && err.message ? err.message : String(err));
        const where = st.phase === 'review' || st.phase === 'result' ? $('fo-make-msg') : $('fo-in-msg');
        where.textContent = '⚠️ ' + m; where.classList.add('err');
    }
    const clearMsg = () => ['fo-in-msg', 'fo-make-msg'].forEach(id => { $(id).textContent = ''; $(id).classList.remove('err'); });
    // 주문을 불러온 뒤 메모·현금파일·기준 발송일을 바꾸면 판정이 낡는다 → [다시 판정] 전에는 파일을 못 만든다
    function markStale() { if (!st.loaded || st.phase === 'loading') return; st.stale = true; st.out = null; $('fo-result').hidden = true; $('fo-in-msg').classList.remove('err'); $('fo-in-msg').textContent = '내용이 바뀌었어요. [다시 판정]을 눌러 주세요.'; syncMake(); syncAi(); }

    // ── 열기·닫기 ────────────────────────────────────────────────────────────
    async function open() {
        build();
        if (st.open) return; st.open = true;
        $('fo-panel').hidden = false; document.body.classList.add('fo-open');
        try { history.pushState({ foPanel: 1 }, ''); } catch (_) { }
        $('fo-close').focus({ preventScroll: true });
        if (!core()) { $('fo-in-msg').textContent = '⚠️ 최종발주 계산 파일을 불러오지 못했어요. 새로고침 후 다시 눌러 주세요.'; return; }
        try {
            await ensureFrame(); fillShip();
            if (!st.byPartner) st.byPartner = await loadCatalog();
        } catch (err) { showError(err); }
        syncInput();
    }
    function close(fromPop) {
        if (!st.open) return; st.open = false;
        $('fo-panel').hidden = true; document.body.classList.remove('fo-open');
        if (!fromPop && history.state && history.state.foPanel) { st.skipPop = true; history.back(); }
        const b = $('desk-final-now'); if (b) b.focus({ preventScroll: true });
    }
    async function loadCatalog() {
        const r = typeof window.api === 'function' ? await window.api('/api/invoice/catalog') : await (await fetch('/api/invoice/catalog', { headers: { Authorization: 'Bearer ' + localStorage.getItem('jwt_token') } })).json();
        if (!r || !r.byPartner) throw new Error('품목별 금액(단가표)을 불러오지 못했어요.');
        if (!Object.keys(r.byPartner).length) throw new Error('이번 주 품목별 금액이 등록돼 있지 않아요. 먼저 등록한 뒤 다시 눌러 주세요.');
        return r.byPartner;
    }
    function fillShip() {
        const sel = $('fo-ship'), cal = st.cal; if (!cal) return;
        const cur = sel.dataset.filled && cal.shipDays.includes(sel.value) ? sel.value : cal.suggested;   // 고른 날이 새 달력에 없으면(날이 바뀜) 추천일로
        sel.innerHTML = cal.shipDays.map(d => `<option value="${d}"${d === cur ? ' selected' : ''}>${esc(dateLabel(d))}${d === cal.realToday ? ' · 오늘' : ''}${d === cal.suggested ? ' · 다음 발송일' : ''}</option>`).join('');
        sel.disabled = false; sel.dataset.filled = '1';
        $('fo-ship-note').textContent = cal.suggested === cal.realToday ? '오늘 발송분 기준이에요(정오 전). 바꿀 수 있어요.' : `오늘(${md(cal.realToday)}) 발송은 끝난 것으로 보고 ${md(cal.suggested)} 발송분 기준이에요. 바꿀 수 있어요.`;
    }
    function syncInput() {
        if (!st.built) return;
        const haveCash = !!st.cash || st.cashNone;
        const ready = !!st.cal && !!st.byPartner && haveCash && !st.busy;
        $('fo-start').disabled = !ready; $('fo-start').hidden = st.loaded;
        $('fo-rejudge').hidden = !st.loaded; $('fo-rejudge').disabled = !haveCash || st.busy || st.ai.running;
        $('fo-reload').hidden = !st.loaded; $('fo-reload').disabled = !ready || st.ai.running;
        $('fo-cash-none').checked = st.cashNone;
        // #548: 파일을 고른 뒤에는 「오늘은 없음」을 누를 수 없다(파일을 빼거나 초기화하면 다시 눌림) — 「없음」 상태에서 파일을 고르면 파일이 우선
        if (!st.busy) $('fo-cash-none').disabled = !!st.cash;
        $('fo-cash-none').closest('.fo-check').classList.toggle('off', !!st.cash);
        $('fo-cash-clear').hidden = !st.cash; $('fo-cash-clear').disabled = st.busy;
        const note = $('fo-cash-note');
        if (st.cash) note.textContent = st.cash.ok ? `${st.cashName} · ${st.cash.rows.length}행(현금 ${st.cash.rows.filter(r => r.bang).length}행 · 그 밖 ${st.cash.rows.filter(r => !r.bang).length}행)` : `${st.cashName} · ⚠️ ${st.cash.error}`;
        else note.textContent = st.cashNone ? '현금파일 없이 진행해요.' : '현금, 입력삭제 건의 주소 줄이 적힌 엑셀(13칸 양식). 없으면 「오늘은 없음」을 체크해요.';
        note.classList.toggle('err', !!(st.cash && !st.cash.ok));
    }
    async function readCash(file) {
        try {
            const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
            st.cash = core().parseCash(aoa); st.cashName = file.name; st.cashNone = false;
        } catch (err) { st.cash = { ok: false, error: '엑셀을 읽지 못했어요(' + (err && err.message ? err.message : err) + ')', rows: [] }; st.cashName = file.name; st.cashNone = false; }
        markStale(); syncInput();
    }

    // ── ② 주문 불러오기 ─────────────────────────────────────────────────────
    function drawProgress(extra) {
        const row = c => { const s = st.chState[c] || { t: '기다리는 중' }; return `<li data-k="${s.fail ? 'err' : s.done ? 'done' : s.run ? 'work' : 'wait'}"><b>${CH_LABEL[c]}</b><span>${esc(s.t)}</span></li>`; };
        $('fo-progress').hidden = false;
        $('fo-progress').innerHTML = `<h3>주문 불러오기</h3><ul class="fo-ch">${CH.map(row).join('')}</ul>${extra || ''}`;
    }
    async function clickLoad(ch) {
        const doc = D(), btn = doc.getElementById('btn-' + ch), t0 = Date.now();
        st.chState[ch] = { run: true, t: '불러오는 중' }; drawProgress();
        btn.click(); st.fetchCount++;
        const tick = setInterval(() => { st.chState[ch].t = `불러오는 중 (${Math.round((Date.now() - t0) / 1000)}초)`; drawProgress(); }, 1000);
        try {
            for (let i = 0; i < 50 && !btn.disabled; i++) await sleep(20);          // 클릭 직후 disabled 가 걸린다
            while (btn.disabled) { if (Date.now() - t0 > 6 * 60e3) throw new Error(CH_LABEL[ch] + ' 조회가 6분 넘게 끝나지 않았어요.'); await sleep(200); }
        } finally { clearInterval(tick); }
        const msg = (doc.getElementById('msg-' + ch).textContent || '').trim();
        if (sessionLost()) throw new Error('로그인이 풀렸어요.');
        const n = ch === 'naver' ? (S().naver ? S().naver.rows.length : 0) : (S()[ch] || []).length;
        st.chState[ch] = /^⚠/.test(msg) || !msg ? { fail: true, t: msg ? msg.replace(/^⚠️?\s*/, '') : '응답이 없었어요' } : { done: true, t: `${n}건` };
        drawProgress();
    }
    async function loadChannels(list) { for (const ch of list) await clickLoad(ch); }   // 하나씩(동시에 누르면 v2 재판정이 겹친다)
    async function start() {
        clearMsg(); st.phase = 'loading'; st.loaded = false; st.judged = false; st.dec = new Map([...st.dec].filter(([id]) => !/^(ord|split|samb|memo):/.test(id))); st.draft = new Map(); st.ai = newAi(); st.patch = new Map(); st.recvFix = []; st.ordMemo = new Map(); st.chat.cand = []; st.chat.pending = null; st.out = null;   /* 주문에 묶인 결정만 지운다(메모 줄·현금파일·거래처 결정은 내용 기준이라 유지) */ st.files = []; $('fo-review').hidden = true; $('fo-result').hidden = true;
        await ensureFrame();
        st.chState = {}; drawProgress();
        await loadChannels(CH);
        await afterLoad();
    }
    async function afterLoad() {
        const failed = CH.filter(c => st.chState[c] && st.chState[c].fail);
        if (failed.length) {
            const all = failed.length === CH.length;
            drawProgress(`<div class="fo-acts"><button type="button" class="fo-btn primary" data-fo-load="retry">실패한 ${failed.map(c => CH_LABEL[c]).join('·')} 다시 불러오기</button>${all ? '' : `<button type="button" class="fo-btn" data-fo-load="skip">${failed.map(c => CH_LABEL[c]).join('·')} 없이 계속</button>`}</div><p class="fo-hint">실패한 채널의 주문은 결과 파일에 들어가지 않아요.</p>`);
            st.loaded = false; st.phase = 'loading'; return;   // 버튼(다시 불러오기 / 없이 계속)을 눌러야 넘어간다
        }
        st.loaded = true; st.loadedOn = kstToday(); st.loadedAt = Date.now();
        st.cal = S().calendar; fillShip();   // 다시 불러온 경우 달력(오늘·발송 가능일)을 새로
        await judge();
    }

    // ── ③ 판정 → 카드 ───────────────────────────────────────────────────────
    async function judge() {
        clearMsg();
        if (!st.loaded) throw new Error('먼저 주문을 불러와 주세요.');
        if (!st.cash && !st.cashNone) throw new Error('현금파일을 고르거나 「오늘은 없음」을 체크해 주세요.');
        const cal = st.cal, ship = $('fo-ship').value;
        if (!cal.shipDays.includes(ship)) throw new Error('기준 발송일을 다시 골라 주세요(토요일·발송휴무일은 안 돼요).');
        const sz = core().sizeLines($('fo-memo').value); st.sizeLines = sz.sizes;   // #548 「번호 + 사이즈」 줄 — 사이즈 낱말은 떼고 나머지만 종전 규칙으로
        st.prep = core().prepLines(sz.text, { realToday: cal.realToday, shipDays: cal.shipDays, noShip: [...cal.noShip], shipDate: ship });
        dayGuard();
        st.judged = false; st.out = null; st.files = []; $('fo-result').hidden = true;
        const s = S();
        s.merged.forEach(e => { e.userTouched = false; });   // 카드 결정은 판정 뒤에 다시 건다 — 앞선 결정의 흔적(제외 체크)이 카드가 사라진 주문에 남지 않게(워커2 재현 C)
        s.shipDate = ship; D().getElementById('ln-all').value = st.prep.v2Text;
        // v2 saveLines 는 실패를 안에서 삼킨다(안내 칸에 글만 적음) → 판정 결과(today)가 새로 채워졌는지로 성공을 확인한다(워커2 재현 A)
        const prevToday = s.today; s.today = null;
        await IVT().saveLines(s);
        if (sessionLost()) { s.today = prevToday; throw new Error('로그인이 풀렸어요.'); }
        if (!s.today) { s.today = prevToday; const why = (D().getElementById('res-all').textContent || '').replace(/^⚠️?\s*/, '').trim(); throw new Error('판정을 끝내지 못했어요' + (why ? `(${why})` : '') + '. 잠시 뒤 [다시 판정]을 눌러 주세요.'); }
        if (s.shipDate !== ship) throw new Error(`기준 발송일이 ${s.shipDate}로 잡혔어요. 다시 골라 주세요.`);
        st.cal = s.calendar; st.phase = 'review'; st.stale = false; st.judged = true;
        buildCards(); applyOrderDecisions(); if (st.ai.done) aiToCards(); else renderSummaryOnly();   // 결정을 건 뒤 상태로 카드를 한 번 더 만든다(현금파일 대조 문구가 결정 전 상태로 뜨지 않게)
        st.autoAi = true;   // #520: 판정이 끝나면 AI 읽기를 버튼 없이 1회 시작한다(run() 이 끝난 뒤 — 읽을 메모가 앞서 읽은 것과 같으면 다시 읽지 않는다)
    }
    // 주문을 불러온 날이 지나면 멈춘다 — v2의 날짜 가드는 [다시 판정] 때마다 기준이 오늘로 다시 적혀, 전날 불러온 주문으로 파일이 만들어질 수 있다(워커2 재현 D)
    function dayGuard() { if (st.loadedOn && st.loadedOn !== kstToday()) throw new Error(`주문을 ${md(st.loadedOn)}에 불러왔어요. [주문 다시 불러오기]를 눌러 오늘 주문으로 다시 해 주세요.`); }
    // 그 주문이 속한 보내는이 카드(묶음 카드일 수 있다)의 결정
    const sambDec = e => { const id = st.sambCard && st.sambCard.get(keyOf(e)); return id ? st.dec.get(id) : undefined; };
    function senderMap() {   // 직원 메모의 보내는이 지정(확실한 것 + 카드에서 사람이 확정한 것) → 주문 키별
        const list = [];
        (st.prep.senders || []).forEach(sd => {
            if (!sd.ambiguous) { list.push(sd); return; }
            const d = st.dec.get('samb-line:' + sd.srcLine + ':' + sd.raw);
            if (d && d.use && d.name) list.push({ ...sd, name: d.name, phone: d.phone || '', addr: d.addr || '', ambiguous: false });
        });
        const orders = S().merged.map(e => ({ key: keyOf(e), digits: buyerTel(e), ids: idsOf(e), recipient: String(e.conv['수취인명'] || '').trim() }));
        const res = core().applySenders(list, orders);
        res.line = new Set(res.byKey.keys());   // 메모 줄로 지정한 주문(이 주문은 보내는이 카드를 띄우지 않는다)
        // #509: 손님 메모가 애매해 v2가 안 바꾼 주문 — 카드에서 사람이 직접 적어 넣은 보내는이(메모 줄 지정이 있으면 그쪽이 우선)
        S().merged.forEach(e => { const k = keyOf(e), d = sambDec(e); if (d && d.use && d.name && !res.byKey.has(k)) res.byKey.set(k, { name: d.name, phone: d.phone || null, addr: d.addr || null }); });
        return res;
    }
    function reasonOf(e) {
        if (e.req) {
            const l = e.req;
            if (e.reqKind === 'past') return `메모 줄의 요청일(${md(l.date)})이 지난 날짜예요.`;
            if (e.reqKind === 'nodate') return '메모 줄에 날짜가 없어요.';
            if (e.reqKind === 'partial') return `메모 줄 「${l.note}」 — 일부만 지정돼 있어요.`;
        }
        const p = e.parse;
        if (p && p.kind === 'arrive') return `${p.reqDate} 도착 요청 — 기준일에 보내도 닿을 수 있어 확인이 필요해요.`;
        if (p && p.kind === 'ship') return `${p.reqDate} 발송 요청`;
        const ai = aiOf(e);
        return ai && ai.why ? 'AI가 읽음: ' + ai.why : '손님 메모에 날짜 표현이 있는데 뜻이 분명하지 않아요.';
    }
    // #548 받는 분 번호로 적힌 메모 줄 — 번호 전체가 「수취인연락처1/2」와 같은 주문(자리표시 번호·8자리 미만은 제외). 끝자리만 같은 것은 보지 않는다.
    const NO_TEL = new Set(['01000000000', '0000000000', '00000000000']);
    function recvMatches(l) {
        const d = String((l && l.digits) || ''); if (d.length < 8 || NO_TEL.has(d)) return [];
        return S().merged.filter(e => [e.conv['수취인연락처1'], e.conv['수취인연락처2'], rawOf(e)['수취인연락처1'], rawOf(e)['수취인연락처2']].some(v => digitsOf(v) === d));
    }
    // #548 「번호 + 사이즈」 줄: 그 번호(구매자 번호 또는 주문번호)의 주문 중 귤 품목(옵션 이름에 「귤」)에만 「2S사이즈로!」 꼬리. 황금향 같은 과수 지정 품목은 건드리지 않고 참고 목록에만.
    //   본 화면 실코드(app.js addSizeSuffix)는 손님 메모에 사이즈 말이 있으면 품목을 가리지 않고 붙인다 — 직원 줄은 대표 뜻대로 귤만.
    function sizeApply() {
        const s = S(), tails = new Map(), res = new Map(), info = [];
        (st.sizeLines || []).forEach(z => {
            const hit = s.merged.filter(e => (z.digits.length >= 8 && !NO_TEL.has(z.digits) && buyerTel(e) === z.digits) || idsOf(e).includes(z.key));
            if (!hit.length) { const rv = recvMatches(z); res.set(z.srcLine, rv.length ? { k: 'warn', t: '받는 분 번호', rv } : { k: 'none', t: '주문 없음' }); return; }
            const okE = hit.filter(e => /귤/.test(String(e.conv['옵션정보'] || ''))), tail = z.size + '사이즈로!';
            okE.forEach(e => tails.set(keyOf(e), tail));
            const no = new Map(); hit.filter(e => !okE.includes(e)).forEach(e => { const o = core().stripTail(String(e.conv['옵션정보'] || ''), inCatalog); no.set(o, (no.get(o) || 0) + 1); });
            no.forEach((n, o) => info.push(`사이즈 지정 대상 아님: ${o} ${n}건 (메모 줄 「${z.raw}」 — 귤 주문에만 붙여요)`));
            if (okE.length) info.push(`메모 줄로 사이즈 지정: ${z.raw} → 귤 주문 ${okE.length}건에 「${tail}」`);
            res.set(z.srcLine, okE.length ? { k: 'ok', t: `사이즈 지정 ${okE.length}건`, n: okE.length } : { k: 'warn', t: '귤 주문 없음', tip: '사이즈를 붙일 귤 주문이 없어요' });
        });
        st.sizeTail = tails; st.sizeRes = res; return info;
    }
    // 그 주문만 가리키는 주문번호 열쇠(v2 가 찾을 수 있는 값 중 다른 주문과 겹치지 않는 것 · 없으면 첫 값)
    function uniqueId(e) {
        const mine = idsOf(e), others = new Set(); S().merged.forEach(x => { if (x !== e) idsOf(x).forEach(v => others.add(v)); });
        return mine.find(v => !others.has(v)) || mine[0] || '';
    }
    // 메모 칸의 그 줄에서 번호 자리만 주문번호로 바꾼다(여러 건이면 같은 줄을 건수만큼) → 다시 판정하면 v2 가 원래 규칙대로 처리한다
    async function applyRecv(id) {
        const cd = st.cards.find(c => c.id === id); if (!cd || !cd.recv || st.busy) return;
        const byKey = new Map(S().merged.map(e => [keyOf(e), e])), es = cd.recv.keys.map(k => byKey.get(k)).filter(Boolean);
        const memo = $('fo-memo'), lines = memo.value.replace(/\r/g, '').split('\n'), raw = lines[cd.recv.srcLine];
        const m = raw == null ? null : raw.match(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g);
        const tok = (m || []).find(t => digitsOf(t) === cd.recv.digits);
        const made = es.map(e => { const key = uniqueId(e); if (!key || !tok) return null; let ln = raw.replace(tok, key);
            if (ln.includes('\t')) { const c = ln.split('\t'); while (c.length < 4) c.push(''); c[3] = CH_LABEL[e.ch] || '네이버'; ln = c.join('\t'); }
            else if (e.ch !== 'naver' && !/자사몰|카페|쿠팡/.test(ln)) ln += ' ' + CH_LABEL[e.ch];
            return ln; }).filter(Boolean);
        if (!made.length || made.length !== es.length) { $('fo-make-msg').textContent = '이 줄은 자동으로 바꾸지 못했어요. 메모 칸에서 번호를 구매자 번호로 고쳐 [다시 판정]을 눌러 주세요.'; return; }
        const had = st.phase === 'result' && st.files.length > 0;
        lines.splice(cd.recv.srcLine, 1, ...made); memo.value = lines.join('\n');
        (st.recvFix = st.recvFix || []).push({ raw: String(raw).trim(), n: made.length });
        st.out = null; st.files = []; $('fo-result').hidden = true; clearMsg();
        for (let i = 0; i < 1200 && st.ai.running; i++) await sleep(500);
        await run(judge);
        if (had) await remake();
    }
    // #548 메모 칸 줄별 확인 표시(송장변환 v2 #457 과 같은 뜻) — 왼쪽 표시 칸 · 줄 높이 24px 로 맞춤 · 스크롤 같이 · 입력이 바뀌면 흐리게
    const MEMO_LH = 24, MEMO_MIN = 5, MEMO_MAX = 14;
    function mountMemoEd() {
        const ta = $('fo-memo'); if (!ta || st.memoEd) return;
        const ed = document.createElement('div'); ed.className = 'fo-ed'; const gut = document.createElement('div'); gut.className = 'fo-gut'; gut.id = 'fo-memo-gut';
        ta.parentNode.insertBefore(ed, ta); ed.appendChild(gut); ed.appendChild(ta);
        const bar = document.createElement('div'); bar.className = 'fo-linebar'; bar.id = 'fo-memo-bar'; bar.setAttribute('role', 'status'); ed.parentNode.insertBefore(bar, ed.nextSibling);
        st.memoEd = { ed, gut, bar, ta, marks: [] };
        ta.addEventListener('scroll', () => { gut.scrollTop = ta.scrollTop; });
        gut.addEventListener('click', e => { const m = e.target.closest('.m[data-i]'); if (m) selectMemoLine(Number(m.dataset.i)); });
        bar.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b) return; const M = st.memoEd.marks, cur = st.memoEd.cur == null ? -1 : st.memoEd.cur; let i = M.findIndex((x, j) => j > cur && x && x.k === b.dataset.k); if (i < 0) i = M.findIndex(x => x && x.k === b.dataset.k); if (i >= 0) selectMemoLine(i); });
        fitMemoEd();
    }
    function fitMemoEd() {
        const E = st.memoEd; if (!E) return;
        const n = E.ta.value ? E.ta.value.split('\n').length : 0, rows = Math.max(MEMO_MIN, Math.min(MEMO_MAX, n));
        E.ta.style.height = (rows * MEMO_LH + 20) + 'px'; E.gut.style.height = E.ta.style.height; E.gut.scrollTop = E.ta.scrollTop;
    }
    function selectMemoLine(i) {
        const E = st.memoEd; if (!E) return; const lines = E.ta.value.split('\n'); if (i < 0 || i >= lines.length) return;
        const start = lines.slice(0, i).reduce((a, x) => a + x.length + 1, 0);
        E.cur = i; E.ta.focus(); E.ta.setSelectionRange(start, start + lines[i].length);
        E.ta.scrollTop = Math.max(0, i * MEMO_LH - E.ta.clientHeight / 2 + MEMO_LH); E.gut.scrollTop = E.ta.scrollTop;
        E.gut.querySelectorAll('.m.cur').forEach(x => x.classList.remove('cur')); const m = E.gut.querySelector('.m[data-i="' + i + '"]'); if (m) m.classList.add('cur');
    }
    // 줄 상태: ok 확인완료 / warn 확인 필요(지난 날짜·날짜 없음·일부만·건수 다름·받는 분 번호·형식) / none 주문 없음 / 빈칸(판정 전·빈 줄)
    function memoMarks() {
        const E = st.memoEd, s = S(); if (!E || !st.judged || !st.prep || !s) return [];
        const n = E.ta.value ? E.ta.value.split('\n').length : 0, marks = new Array(n).fill(null);
        const put = (i, st2) => { if (i == null || i < 0 || i >= n) return; const rank = { warn: 3, none: 2, ok: 1 }; if (!marks[i] || rank[st2.k] > rank[marks[i].k]) marks[i] = st2; };
        const kindTxt = { past: '지난 날짜', nodate: '날짜 없음', partial: '일부만 지정' };
        (s.allLines || []).forEach(l => {
            if (l.bad) return put(l.srcLine, { k: 'warn', t: '형식 확인', tip: '번호를 찾지 못했어요' });
            if (!l.hits) return put(l.srcLine, recvMatches(l).length && st.dec.get('lrecv:' + l.srcLine + ':' + l.line) !== 'ok' ? { k: 'warn', t: '받는 분 번호', tip: '구매자가 아니라 받는 분 번호예요 — 아래 카드에서 적용하거나 넘어가요' } : { k: 'none', t: '주문 없음', tip: l.date && l.date < s.today ? '지난 날짜 — 이미 처리된 듯' : '배송준비에 이 번호의 주문이 없어요' });
            const rows = l.hitRows || [], warn = rows.filter(e => e.req === l && kindTxt[e.reqKind]);
            if (warn.length) return put(l.srcLine, { k: 'warn', t: `확인 필요 ${warn.length}/${l.hits}건`, tip: [...new Set(warn.map(e => kindTxt[e.reqKind]))].join(' · ') });
            if (l.expect != null && l.expect !== l.hits) return put(l.srcLine, { k: 'warn', t: `건수 다름 ${l.hits}건`, tip: `비고는 ${l.expect}건인데 실제 ${l.hits}건` });
            put(l.srcLine, { k: 'ok', t: `확인완료 ${l.hits}건`, tip: '' });
        });
        (st.prep.notes || []).forEach(x => { if (['line-split', 'line-noship', 'indiv-nodate'].includes(x.type)) put(x.srcLine, { k: 'warn', t: '확인 필요', tip: x.detail || '' }); });
        (st.sizeRes || new Map()).forEach((r, i) => {
            if (i < 0 || i >= n) return;
            if (r.k === 'ok' && marks[i] && marks[i].k === 'ok') { marks[i] = { k: 'ok', t: marks[i].t + ' · 사이즈', tip: r.t }; return; }
            const z = (st.sizeLines || []).find(x => x.srcLine === i);
            if (r.rv && z && st.dec.get('lrecv:' + i + ':' + z.raw) === 'ok') return put(i, { k: 'none', t: '주문 없음', tip: '받는 분 번호 — 넘어감' });
            put(i, { k: r.k, t: r.t, tip: r.tip || (r.rv ? '구매자가 아니라 받는 분 번호예요 — 아래 카드에서 적용하거나 넘어가요' : '') });
        });
        const sm = senderMap(), nohit = new Set((sm.nohit || []).map(x => x.srcLine + ':' + x.raw));
        (st.prep.senders || []).forEach(sd => {
            if (nohit.has(sd.srcLine + ':' + sd.raw)) return put(sd.srcLine, { k: 'none', t: '주문 없음', tip: '보내는이를 넣을 주문이 배송준비에 없어요' });
            if (sd.ambiguous) { const d = st.dec.get('samb-line:' + sd.srcLine + ':' + sd.raw); return put(sd.srcLine, d ? { k: 'ok', t: d.use ? '보내는이 확인' : '넣지 않음', tip: '' } : { k: 'warn', t: '확인 필요', tip: '보내는이 이름·번호·주소를 아래 카드에서 확인해 주세요' }); }
            put(sd.srcLine, { k: 'ok', t: '보내는이 확인', tip: '' });
        });
        return marks;
    }
    function renderMemoGut() {
        const E = st.memoEd; if (!E) return; fitMemoEd();
        const marks = memoMarks(); E.marks = marks; E.cur = null; E.ed.classList.toggle('stale', !!st.stale);
        const ic = { ok: '✓', warn: '⚠', none: '✕' };
        E.gut.innerHTML = marks.map((m, i) => m ? `<div class="m ${m.k}" data-i="${i}" title="${esc(m.tip || '')}"><span>${ic[m.k]} ${esc(m.t)}</span></div>` : '<div class="m"></div>').join('');
        E.gut.scrollTop = E.ta.scrollTop;
        const cnt = { ok: 0, warn: 0, none: 0 }; marks.forEach(m => { if (m) cnt[m.k]++; });
        const chip = (k, label) => cnt[k] ? `<button type="button" class="${k}" data-k="${k}" title="누르면 그 줄로 가요">${label} <b>${cnt[k]}</b>줄</button>` : '';
        E.bar.innerHTML = cnt.ok + cnt.warn + cnt.none ? chip('warn', '⚠ 확인 필요') + chip('none', '✕ 주문 없음') + chip('ok', '✓ 확인완료') + '<span class="stale-note">내용이 바뀌었어요. [다시 판정]을 누르면 표시가 새로 떠요.</span>' : '';
    }
    function buildCards() {
        const c = core(), s = S(), cards = [], info = [];
        const orderLine = e => `${CH_LABEL[e.ch]} · ${buyerName(e)}${e.conv['수취인명'] && e.conv['수취인명'] !== buyerName(e) ? ' → ' + e.conv['수취인명'] : ''} · ${e.conv['옵션정보']} · ${e.conv['수량']}박스`;
        const memoOf = e => String(e.conv['배송메세지'] || '').trim();
        const sm = senderMap();
        // ① 주문 확인(v2 확인필요)
        // #510(대표 10/4 실물): 「배송 전에 미리 연락주세요」처럼 날짜가 없는 흔한 메모는 카드로 띄우지 않는다(그대로 발송 · 메모 글자 그대로).
        //   v2는 「전에·이전·이후·까지」만 있어도 확인필요로 표시한다(송장변환 화면은 그대로) — 여기서는 서버가 날짜를 못 읽었고(parse 없음) 날짜·요일·미루기 표현도 없으면 카드에서 뺀다.
        const DATEISH = /다음\s*주|다음\s*날|내일|모레|글피|\d+\s*일|\d+\s*월|\d+\s*\/\s*\d+|\d{1,2}\s*\.\s*\d{1,2}|월요|화요|수요|목요|금요|토요|일요|주말|평일|다다음|이번\s*주|일주일|추석\s*전|명절\s*전|연휴\s*전|늦게|천천히|나중/;
        // #512(실파일 시험): 같은 구매자가 같은 메모로 여러 건 주문하면 카드가 건수만큼 떴다 → 한 장으로 묶어 한 번에 정한다(구매자 번호 + 메모 + 이유가 같을 때만)
        const groupBy = (list, keyFn) => { const g = new Map(); list.forEach(e => { const k = keyFn(e) || 'solo|' + keyOf(e); (g.get(k) || g.set(k, []).get(k)).push(e); }); return [...g.values()]; };
        const sameBuyerMemo = e => { const t = buyerTel(e), m = memoOf(e); return t && m ? e.ch + '|' + t + '|' + m : null; };
        const groupLines = es => (es.length > 1 ? [['묶음', `같은 구매자 · 같은 메모 주문 ${es.length}건에 함께 적용돼요 — ${es.map(e => `${e.conv['수취인명'] || ''} ${e.conv['수량']}박스`).join(' · ')}`]] : []);
        const groupTitle = es => orderLine(es[0]) + (es.length > 1 ? ` 외 ${es.length - 1}건` : '');
        st.ordCard = new Map(); st.sambCard = new Map();
        // #512: 메모의 날짜가 전부 기준 발송일이면(「15일(화)에 출고 부탁」) 그대로 보내면 되는 건이라 카드에서 뺀다 — 서버가 날짜를 못 읽은 주문에만 적용(실자료 8건 모두 그날 나감)
        //   #517(설날 실파일): 「2월 11일 배송 요청」처럼 「배송」이라고 적어 서버가 확인형(ack)으로 읽은 것도, 날짜가 전부 기준 발송일이면 그날 보내는 것이 최선이라 카드에서 뺀다(도착·범위 말이 있으면 sameDayOnly 가 거짓).
        const sameDay = e => !e.req && (!e.parse || e.parse.kind === 'ack') && typeof c.sameDayOnly === 'function' && c.sameDayOnly(memoOf(e), s.shipDate);
        //   #517: v2 가 표시하지 못하는 한 글자 요일 꼴(「14토까지」 「11수나 12목에 발송」 「목금 도착요망」)도 주문 확인 카드로
        //   (「2월」의 월 · 「11일」의 일 · 「금일」은 요일이 아니라서 글자 묶음에서 뺀다)
        const DAYCHAR = /\d{1,2}\s*[화수목금토](?:까지|에|나|이나|요일)|[월화수목금토]{2,3}\s*[ㅡ\-~]?\s*(?:에\s*)?(?:도착|발송|배송|받)/;
        //   날짜 글자 검사는 전화번호를 지운 글로(「010.1234.5678」의 점·숫자가 날짜로 읽혀 헛카드 — 설날 실자료 4건)
        const noTel = m => m.replace(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, ' ');
        const needsOrderCard = e => !(e.individual || e.reqKind === 'today' || (e.excluded && !e.userTouched))
            && ((e.flag === 'review' && (e.req || e.parse || DATEISH.test(noTel(memoOf(e))) || DAYCHAR.test(noTel(memoOf(e))))) || (!e.flag && !e.req && DAYCHAR.test(noTel(memoOf(e)))))
            && !sameDay(e);
        const needsOrderCardAi = e => needsOrderCard(e) || aiHold(e);   // #518: 규칙은 그냥 보내려던 주문인데 AI가 「오늘 안 나감/사람 확인」으로 읽은 것도 카드로
        groupBy(s.merged.filter(needsOrderCardAi), e => { const k = sameBuyerMemo(e); return k ? k + '|' + reasonOf(e) : null; }).forEach(es => {
            const id = 'ord:' + keyOf(es[0]); es.forEach(e => st.ordCard.set(keyOf(e), id));
            cards.push({ id, keys: es.map(keyOf), type: 'order', tag: '주문 확인', title: groupTitle(es), lines: [['손님 메모', memoOf(es[0]) || '(없음)'], ['이유', reasonOf(es[0])], ...groupLines(es)], choices: [['send', '오늘 발송', 1], ['excl', '제외']], memoOrig: memoOf(es[0]), memoPre: (() => { const o = memoOf(es[0]), r = aiOf(es[0]); if (!r || r.memo == null) return o; const t = aiMemoText(r, o); return t && t.safe ? t.text : o; })() });
        });
        // ② 나눠 보내기 신호(손님 메모)
        s.merged.forEach(e => {
            if (e.individual || (e.excluded && !e.userTouched)) return;   // v2가 스스로 뺀 주문(뒤 날짜)은 오늘 안 나가므로 대상 아님
            const sig = c.splitSignal({ memo: memoOf(e), qty: qtyOf(e), buyerDigits: buyerTel(e), recvDigits: [digitsOf(e.conv['수취인연락처1']), digitsOf(e.conv['수취인연락처2'])].filter(Boolean) });
            if (!sig) return;
            cards.push({ id: 'split:' + keyOf(e), type: 'split', tag: '나눠 보내기', title: orderLine(e), lines: [['손님 메모', memoOf(e)], ['이유', sig.why], ['처리', '따로 보낼 박스가 있으면 메모에 입력삭제 줄을 넣고 현금파일에 주소 줄을 적은 뒤 [다시 판정]을 눌러 주세요.']], choices: [['excl', '오늘은 제외(주소 받은 뒤 처리)', 1], ['all', '주문 주소로 전부 발송']] });   // #512 실자료: 이런 메모 10건 중 주문 주소로 그대로 다 나간 것은 0건 → 「제외」를 앞에
        });
        // ③ 손님 메모의 보내는이 — 애매해서 v2가 안 바꾼 건(직원 줄로 지정한 주문은 제외)
        //   v2가 스스로 뺀 주문(오늘 안 나감)은 대상 아님 · 같은 구매자·같은 메모는 한 장으로 묶음(#512)
        //   대상 = ⓐv2가 애매로 잡은 주문 ⓑv2가 보내는이 판정을 안 했는데 메모가 이름 한 덩어리뿐인 주문(#512 — 사람은 보내는이로 처리했다)
        const hintOf = e => (typeof c.senderHint === 'function' ? c.senderHint(memoOf(e), buyerName(e)) : null) || {};
        // 요청 글(보내는이 부탁 · 당일 발송 부탁)을 뺀 나머지 — core.memoRest 가 없으면 원문 그대로(아무것도 안 바꿈)
        const restOf = (e, sender, day) => (typeof c.memoRest === 'function' ? c.memoRest(memoOf(e), { sender: !!sender, sameDay: !!day, buyerName: buyerName(e) }) : null) || { rest: memoOf(e), removed: '', sure: false };
        const nameOnly = e => !e.sender && !!memoOf(e) && !!hintOf(e).nameOnly;
        //   #517(설날 실파일): ⓒ보내는이 낱말을 잘못 친 메모(「보낸는이 ○○○ 로 변경」 — v2 는 못 읽는다)도 카드로 · v2 가 「…부탁드림」의 「드림」 때문에 애매로 잡은 것(「박스옆에 보관부탁드림」)은 보내는이 글이 아니라 카드에서 뺀다
        const SENDER_TYPO = /보낸는\s*(?:이|분|사람)|보네는\s*(?:이|분|사람)|보내는\s*곳\s*[:：]/;
        const SENDER_WORD = /보내[시]?는\s*(?:이|분|사람)|보낸\s*(?:이|분|사람)|발신|발송인|보내는이/;
        const notSender = e => !!(e.sender && e.sender.ambiguous) && !SENDER_WORD.test(memoOf(e)) && !hintOf(e).name && /(?:부탁|요청|문의|연락|확인|전달|말씀|안내|보관|배송)\s*드림/.test(memoOf(e));
        //   core.senderCue = v2 가 판정하지 않았지만 사람은 보내는이로 처리한 꼴(「보내시는 분」 「FROM:」 · 메모에 구매자 이름이 서명처럼 든 것) — 자동이 아니라 카드로
        const typoSender = e => !e.sender && !!memoOf(e) && (SENDER_TYPO.test(memoOf(e)) || (typeof c.senderCue === 'function' && !!c.senderCue(memoOf(e), buyerName(e))));
        groupBy(s.merged.filter(e => !(e.individual || sm.line.has(keyOf(e)) || (e.excluded && !e.userTouched)) && (((e.sender && e.sender.ambiguous) && !notSender(e)) || nameOnly(e) || typoSender(e) || aiSender(e))), sameBuyerMemo).forEach(es => {
            const e = es[0], id = 'samb:' + keyOf(e); es.forEach(x => st.sambCard.set(keyOf(x), id));
            // #509(대표 10/4 실물): 손님 메모는 우리가 못 고친다 → 이 카드에서 보내는 분을 바로 적어 넣는다. 입력칸은 메모에서 읽어낸 값으로 미리 채움(사람이 확인·수정 — 자동 적용 아님)
            const buyer = buyerName(e), memo = memoOf(e), hint = hintOf(e), only = nameOnly(e);
            const guess = (hint.name && String(hint.name).trim()) || (e.sender && e.sender.name && String(e.sender.name).trim()) || (buyer && memo.replace(/\s/g, '').includes(buyer.replace(/\s/g, '')) ? buyer : '');
            // 번호 칸: 메모에 전화번호가 하나만 있고 구매자·수취인 번호가 아니면 미리 채움(같은 번호면 바꿀 것이 없어 빈칸)
            const known = [buyerTel(e), digitsOf(e.conv['수취인연락처1']), digitsOf(e.conv['수취인연락처2'])].filter(Boolean);
            const phone = (e.sender && e.sender.phone) || (hint.phone && !known.includes(digitsOf(hint.phone)) ? hint.phone : '');
            cards.push({ id, keys: es.map(keyOf), type: 'sender-order', tag: '보내는이', title: groupTitle(es), lines: [['손님 메모', memo], ['처리', only ? '손님 메모가 이름뿐이에요. 보내는 분으로 넣으려면 확인하고 [이대로 넣기]를 눌러 주세요.' : '손님 메모가 분명하지 않아 자동으로 바꾸지 않았어요. 보내는 분을 여기에 적어 넣거나 그대로 둘 수 있어요.'], ...groupLines(es)], sender: { name: guess, phone, addr: '', memo: only ? '' : restOf(e, true, false).rest, orig: memo }, ...(st.ai.tailAsk.get(keyOf(e)) ? { tail: st.ai.tailAsk.get(keyOf(e)) } : {}) });   // 배송메세지 칸 = 보내는이 부탁 글을 뺀 나머지(#516 · 사람이 확인)
        });
        // ③-b 배송메세지 정리(#516 대표 10/4 「보내는이가 확인되면 기본 문구로 · 인사말 같은 글은 남겼다 · 당일 발송 요청도 정답은 기본 문구」)
        //   대상 = 보내는이를 바꾸는 주문(v2 자동 · 메모 줄 지정)과 당일 발송 요청 메모. 요청 글뿐이라고 확실할 때만(sure && rest==='') 자동으로 기본 문구,
        //   글이 남거나 확실하지 않으면 카드로(남길 글을 미리 채워 사람이 확인). 실자료 117건에서 「자동으로 비웠는데 수기본엔 글이 남은」 경우 0건.
        st.memoAuto = new Map(); st.memoCard = new Map();
        const memoTargets = s.merged.filter(e => {
            if (e.individual || (e.excluded && !e.userTouched) || !memoOf(e) || st.sambCard.has(keyOf(e))) return false;
            if (e.reqKind === 'today' && !e.sender) return false;                       // v2가 이미 메모를 비우는 주문(직원 줄로 그날 발송 확정)
            return (e.sender && !e.sender.ambiguous) || sm.line.has(keyOf(e)) || sameDay(e) || st.ai.memoAsk.has(keyOf(e)) || st.ai.tailAsk.has(keyOf(e));
        });
        const tailAskOf = es => { for (const x of es) { const t = st.ai.tailAsk.get(keyOf(x)); if (t) return t; } return null; };   // #525: AI가 손님 메모에서 읽은 「품목 뒤에 붙일 말」(자동으로 붙이지 않는다 — 카드에서 확인)
        groupBy(memoTargets, sameBuyerMemo).forEach(es => {
            const e = es[0];
            // #518: AI가 「남길 글」을 제안했지만 확신이 없다고 한 메모는 그 글을 미리 채워 카드로
            const r = st.ai.memoAsk.has(keyOf(e)) ? { rest: st.ai.memoAsk.get(keyOf(e)), removed: '', sure: false } : restOf(e, (e.sender && !e.sender.ambiguous) || sm.line.has(keyOf(e)), sameDay(e));
            const tail = tailAskOf(es);
            if (r.rest === memoOf(e) && !tail) return;                                   // 뺄 것이 없음 → 원문 그대로(종전과 같음)
            if (r.sure && r.rest === '' && !tail) { es.forEach(x => st.memoAuto.set(keyOf(x), true)); info.push(`배송메세지를 기본 문구로: ${groupTitle(es)} — 손님 메모 「${memoOf(e)}」`); return; }
            const id = 'memo:' + keyOf(e); es.forEach(x => st.memoCard.set(keyOf(x), id));
            cards.push({ id, keys: es.map(keyOf), type: 'memo-edit', tag: '배송메세지', title: groupTitle(es), lines: [['손님 메모', memoOf(e)], ['처리', '보내는이·발송일 부탁 글을 빼고 택배사 양식에 남길 글을 확인해 주세요. 비우면 기본 문구가 들어가요.'], ...groupLines(es)], memo: { rest: r.rest, orig: memoOf(e) }, ...(tail ? { tail } : {}) });
        });
        // #548 「번호 + 사이즈」 줄 — 귤 주문에만 자동으로 꼬리 · 받는 분 번호였으면 확인 카드
        info.push(...sizeApply());
        (st.sizeLines || []).forEach(z => {
            const r = st.sizeRes.get(z.srcLine); if (!r) return;
            if (r.rv) {
                if ((s.allLines || []).some(l => l.srcLine === z.srcLine)) return;   // 날짜도 같이 적힌 줄은 아래 메모 줄 쪽 카드 하나로
                const rid = 'lrecv:' + z.srcLine + ':' + z.raw;
                if (st.dec.get(rid) !== 'ok') cards.push({ id: rid, type: 'line', tag: '메모 줄', title: z.raw, recv: { srcLine: z.srcLine, digits: z.digits, keys: r.rv.map(keyOf) },
                    lines: [['이유', '이 번호는 구매자가 아니라 받는 분 번호예요. 메모 줄은 구매자 번호(또는 주문번호)로 찾기 때문에 지금은 어느 주문에도 안 붙었어요.'], ...r.rv.slice(0, 8).map((e, i) => [r.rv.length > 1 ? `주문 ${i + 1}` : '주문', orderLine(e)]), ['처리', '적용하면 이 줄의 번호를 그 주문의 주문번호로 바꿔 다시 판정해요(사이즈는 귤 주문에만 붙어요).']],
                    choices: [['apply', r.rv.length > 1 ? `${r.rv.length}건 모두 적용` : '이 주문에 적용', 1], ['ok', '넘어감']] });
                else { cards.push({ id: rid, type: 'line', tag: '메모 줄', title: z.raw, lines: [['이유', '받는 분 번호로 적힌 줄이에요.']], choices: [['apply', '적용', 1], ['ok', '넘어감']] }); info.push(`주문 없음: ${z.raw} (받는 분 번호 — 넘어감)`); }
            } else if (r.k === 'none') info.push(`주문 없음: ${z.raw}`);
            else if (r.k === 'warn') info.push(`사이즈를 붙일 귤 주문이 없어요: ${z.raw}`);
        });
        // ④ 메모 줄
        (s.allLines || []).forEach(l => {
            if (l.bad) { cards.push({ id: 'lbad:' + l.srcLine + ':' + l.line, type: 'line', tag: '메모 줄', title: l.line, lines: [['이유', '번호를 찾지 못했어요. 요청일자, 번호, 비고, 플랫폼 순으로 적어 주세요.']], choices: [['ok', '이 줄은 넘어감', 1]] }); return; }
            if (l.expect != null && l.hits && l.expect !== l.hits) cards.push({ id: 'lcnt:' + l.srcLine + ':' + l.line, type: 'line', tag: '메모 줄', title: l.line, lines: [['이유', `비고는 ${l.expect}건인데 실제 주문은 ${l.hits}건이에요.`]], choices: [['ok', '확인함', 1]] });
            if (!l.hits) {
                // #548(대표 10/6 실발주): 메모 줄의 번호가 구매자가 아니라 받는 분 번호였던 경우 — 번호가 통째로 같은 주문만 후보(끝 4자리만 같은 주문은 띄우지 않는다)
                const rv = recvMatches(l), rid = 'lrecv:' + l.srcLine + ':' + l.line;
                if (rv.length && st.dec.get(rid) !== 'ok') {
                    cards.push({ id: rid, type: 'line', tag: '메모 줄', title: l.line, recv: { srcLine: l.srcLine, digits: l.digits, keys: rv.map(keyOf) },
                        lines: [['이유', '이 번호는 구매자가 아니라 받는 분 번호예요. 메모 줄은 구매자 번호(또는 주문번호)로 찾기 때문에 지금은 어느 주문에도 안 붙었어요.'], ...rv.slice(0, 8).map((e, i) => [rv.length > 1 ? `주문 ${i + 1}` : '주문', orderLine(e)]), ...(rv.length > 8 ? [['', `그 밖에 ${rv.length - 8}건`]] : []), ['처리', '적용하면 이 줄의 번호를 그 주문의 주문번호로 바꿔 다시 판정해요.']],
                        choices: [['apply', rv.length > 1 ? `${rv.length}건 모두 적용` : '이 주문에 적용', 1], ['ok', '넘어감']] });
                } else {
                    if (rv.length) cards.push({ id: rid, type: 'line', tag: '메모 줄', title: l.line, lines: [['이유', '받는 분 번호로 적힌 줄이에요.']], choices: [['apply', '적용', 1], ['ok', '넘어감']] });   // 넘어간 카드(끝난 것으로 보임 · [바꾸기]로 다시)
                    info.push(`주문 없음: ${l.line}${rv.length ? ' (받는 분 번호 — 넘어감)' : l.date && l.date < s.today ? ' (지난 날짜 — 이미 처리된 듯)' : ''}`);
                }
            }
        });
        (st.recvFix || []).forEach(x => info.push(`받는 분 번호로 적은 줄을 주문번호로 바꿈: ${x.raw} → ${x.n}건`));
        (st.prep.notes || []).forEach(n => {
            if (n.type === 'line-split') cards.push({ id: 'lsplit:' + n.srcLine + ':' + n.raw, type: 'line', tag: '메모 줄', title: n.raw, lines: [['이유', '일부 박스만 따로 보내는 줄이에요. 프로그램이 박스를 나누지 않아요.'], ['처리', /입력\s*[oO○0]?\s*[·,]?\s*삭제|개별\s*발송/.test(n.raw) ? '이 줄은 입력삭제라 그 주문이 통째로 택배사 양식에서 빠져요. 현금파일에 그 주문의 박스를 전부(주문 주소로 가는 박스 포함) 적어 주세요. 박스 수가 다르면 「박스 수」 카드가 떠요.' : '따로 보낼 박스는 현금파일에 주소 줄을 적고, 이 구매자를 입력삭제로 적은 뒤 [다시 판정]을 눌러 주세요.']], choices: [['ok', '확인함', 1]] });
            else if (n.type === 'line-noship') cards.push({ id: 'lnoship:' + n.srcLine + ':' + n.raw, type: 'line', tag: '메모 줄', title: n.raw, lines: [['이유', n.detail || '요청한 날이 토요일이거나 발송휴무일이에요.']], choices: [['ok', '확인함', 1]] });
            else if (n.type === 'weekday') info.push(`요일 풀이: ${n.raw} → ${n.detail}`);
            else if (n.type === 'indiv-today') info.push(`날짜 없는 개별발송 줄: ${n.raw} → ${n.detail || '기준 발송일 개별발송으로 읽었어요'}`);
            else if (n.type === 'indiv-nodate') cards.push({ id: 'lnodate:' + n.srcLine + ':' + n.raw, type: 'line', tag: '메모 줄', title: n.raw, lines: [['이유', '개별발송 줄에 날짜가 없어요. 요청일자를 적고 [다시 판정]을 눌러 주세요.']], choices: [['ok', '확인함', 1]] });
        });
        (st.prep.senders || []).forEach(sd => {
            if (sd.ambiguous) cards.push({ id: 'samb-line:' + sd.srcLine + ':' + sd.raw, type: 'sender-edit', tag: '보내는이 메모', title: sd.raw, lines: [['이유', sd.why || '이름, 번호, 주소가 어디까지인지 분명하지 않아요.']], sender: sd });
        });
        sm.nohit.forEach(sd => cards.push({ id: 'snohit:' + sd.srcLine + ':' + sd.raw, type: 'line', tag: '보내는이 메모', title: sd.raw, lines: [['이유', '이 번호의 주문이 배송준비에 없어요. 보내는이를 넣을 주문이 없어요.']], choices: [['ok', '확인함', 1]] }));
        // ⑤ 현금파일 대조
        const orders = s.merged.map(e => ({ key: keyOf(e), digits: buyerTel(e), qty: qtyOf(e), individual: !!e.individual, excluded: !!e.excluded, buyer: buyerName(e) }));
        if (st.cash && !st.cash.ok) cards.push({ id: 'cashfmt', type: 'block', tag: '현금파일', title: st.cashName, lines: [['이유', st.cash.error], ['처리', '파일을 고쳐 다시 고른 뒤 [다시 판정]을 눌러 주세요. 현금파일 없이 하려면 「오늘은 없음」을 체크해요.']], choices: [] });
        const chk = c.cashCheck({ orders, cash: st.cash && st.cash.ok ? st.cash.rows : [] });
        // 현금파일 카드 id 에는 내용(박스·행 수)을 넣는다 — 파일을 고쳐 내용이 달라지면 다시 묻게(워커2 지적 G)
        chk.missing.forEach(m => cards.push({ id: `cmiss:${m.digits}:${m.qty}`, type: 'cash', tag: '현금파일', title: `${m.buyer} · 입력삭제 ${m.qty}박스`, lines: [['이유', '입력삭제로 적었는데 현금파일에 이 구매자의 주소 줄이 없어요. 이대로면 택배사 파일에 없어 발송이 빠져요.'], ['처리', '현금파일에 주소 줄을 적어 다시 고른 뒤 [다시 판정]을 눌러 주세요.']], choices: [['skip', '주소 줄 없이 진행(다른 방법으로 보냄)']] }));
        chk.notIndiv.forEach(m => cards.push({ id: `cnot:${m.digits}:${[].concat(m.cashRows).join('.')}:${m.allExcluded ? 'x' : 'o'}`, type: 'cash', tag: '현금파일', title: `${m.buyer} · 현금파일 ${[].concat(m.cashRows).length}행(엑셀 ${[].concat(m.cashRows).join(', ')}행)`, lines: [['이유', m.allExcluded ? '현금파일에 이 구매자의 줄이 있는데, 주문은 오늘 안 나가는 건(뒤 날짜)이에요. 이대로면 현금파일 주소로는 오늘 나가요.' : '현금파일에 이 구매자의 줄이 있는데 주문은 입력삭제가 아니에요. 이대로면 주문 주소로도 나가고 현금파일 주소로도 나가요.'], ['처리', '입력삭제가 맞으면 메모에 입력삭제 줄을 넣고 [다시 판정]을 눌러 주세요.']], choices: [['extra', m.allExcluded ? '현금파일 줄은 오늘 보내는 게 맞음' : '둘 다 보내는 게 맞음(추가 발송)']] }));
        (chk.mixed || []).forEach(m => info.push(`${m.buyer}: 입력삭제 주문과 주문 주소로 나가는 주문이 함께 있어요(주문 ${m.orderKeys.length}건은 택배사 양식에 그대로).`));
        chk.boxDiff.forEach(m => cards.push({ id: `cbox:${m.digits}:${m.orderQty}:${m.cashQty}`, type: 'cash', tag: '박스 수', title: `${m.buyer} · 주문 ${m.orderQty}박스 / 현금파일 ${m.cashQty}박스`, lines: [['이유', m.cashQty > m.orderQty ? '현금파일이 주문보다 많아요(서비스·추가 발송일 수 있어요).' : '현금파일이 주문보다 적어요. 빠진 박스가 없는지 확인해 주세요.']], choices: [['ok', '확인함 — 이대로', 1]] }));
        (chk.strangers || []).forEach(x => info.push(`현금파일에만 있는 구매자(재발송 등): 엑셀 ${[].concat(x.rows).join(', ')}행`));
        (chk.unchecked || []).forEach(x => info.push(`번호가 가려진 입력삭제 주문(선물하기 등)은 현금파일과 대조하지 못했어요: ${x.buyer || ''} ${x.qty || ''}박스`));
        // ⑥ 거래처를 못 정한 품목
        const opts = new Set();
        s.merged.forEach(e => { if (goingOut(e) || st.dec.has('ord:' + keyOf(e))) opts.add(optOf(e)); });   // #525: 대화 칸에서 품목 이름을 바꾼 주문은 새 이름으로
        (st.cash && st.cash.ok ? st.cash.rows : []).forEach(r => opts.add(r.opt));
        [...opts].filter(o => !c.partnerOf(o, st.byPartner)).sort().forEach(o => cards.push({ id: 'pick:' + o, type: 'pick', tag: '거래처', title: o || '(옵션정보 빈칸)', lines: [['이유', '품목별 금액에 없는 이름이라 어느 거래처 파일에 넣을지 몰라요.']], picks: Object.keys(st.byPartner) }));
        // 오늘 안 나가는 주문(v2가 손님 메모·직원 줄의 뒤 날짜로 스스로 뺀 것) — 어느 주문인지 볼 수 있게 참고 목록에
        s.merged.forEach(e => { if (!e.individual && e.excluded && !e.userTouched) info.push(`오늘 안 나감: ${orderLine(e)} — ${e.req ? `메모 줄 요청일 ${md(e.req.date)}` : `손님 메모 「${memoOf(e)}」`}`); });
        s.merged.forEach(e => { const k = keyOf(e); if (st.ai.memo.has(k) && goingOut(e)) info.push(`AI가 배송메세지 정리: ${orderLine(e)} — 「${memoOf(e)}」 → 「${st.ai.memo.get(k) || '기본 문구'}」`); });
        st.cards = cards; st.info = info;
        // 사라진 주문 카드의 옛 결정은 지운다(같은 카드가 나중에 다시 뜨면 새로 묻는다)
        const live = new Set(cards.map(cd => cd.id));
        [...st.dec.keys()].forEach(id => { if (/^(ord|split|samb|memo):/.test(id) && !live.has(id)) st.dec.delete(id); });
    }
    // 지금 떠 있는 카드의 결정만 인정한다(사라진 카드의 옛 결정이 주문을 빼지 않게 — 워커2 재현 C)
    const liveDec = id => (st.cards.some(cd => cd.id === id) ? st.dec.get(id) : undefined);
    function applyOrderDecisions() {   // 카드 결정 → v2 상태(제외 체크). 판정(saveLines) 뒤마다 다시 건다
        const byKey = new Map(S().merged.map(e => [keyOf(e), e]));
        st.cards.forEach(cd => {
            if (cd.type !== 'order' && cd.type !== 'split') return;
            const v = st.dec.get(cd.id); if (!v) return;
            keysOf(cd).forEach(k => {
                const e = byKey.get(k); if (!e) return;
                // 같은 주문에 「주문 확인」과 「나눠 보내기」 카드가 둘 다 있으면 하나라도 제외면 제외
                e.excluded = v === 'excl' || otherDec(cd, k) === 'excl'; e.userTouched = true;
            });
        });
        // #525: 대화 칸에서 사람이 말로 시킨 제외·다시 넣기(카드 결정보다 뒤에 건다 — 가장 나중에 한 말)
        if (st.patch && st.patch.size) byKey.forEach((e, k) => { const p = st.patch.get(k); if (p && typeof p.excl === 'boolean' && !e.individual) { e.excluded = p.excl; e.userTouched = true; } });
    }
    // 카드가 맡은 주문 키들(주문 확인 카드는 같은 구매자·같은 메모 묶음일 수 있다) · 같은 주문의 다른 종류 카드 결정
    const keysOf = cd => cd.keys || [cd.id.slice(cd.id.indexOf(':') + 1)];
    const otherDec = (cd, k) => { const id = cd.type === 'order' ? 'split:' + k : st.ordCard && st.ordCard.get(k); return id ? liveDec(id) : undefined; };
    // #526(대표 10/5 「적용하면 이건 안 떠야 해」): 대화 칸에서 말로 정한 것이 그 카드가 묻던 것을 이미 정했으면 카드는 끝난 것으로 본다(묶음 카드는 묶인 주문 전부가 정해졌을 때만).
    //   결과 파일은 원래부터 말로 바꾼 것이 카드 결정보다 우선이다 — 여기서는 화면 표시와 「확인할 것」 건수만 그에 맞춘다. [바꾸기] = 그 말을 되돌린다.
    function patchDec(cd) {
        if (!st.patch || !st.patch.size) return undefined;
        const ps = keysOf(cd).map(k => st.patch.get(k)); if (!ps.length || ps.some(p => !p)) return undefined;
        const all = fn => ps.every(fn), p0 = ps[0];
        if (cd.type === 'order') return all(p => typeof p.excl === 'boolean' && p.excl === p0.excl) ? { byChat: true, v: p0.excl ? 'excl' : 'send' } : undefined;
        if (cd.type === 'split') return all(p => typeof p.excl === 'boolean' && p.excl === p0.excl) ? { byChat: true, v: p0.excl ? 'excl' : 'all' } : undefined;
        if (cd.type === 'sender-order') return all(p => p.sender && p.sender.name) ? { byChat: true, v: { use: true, name: p0.sender.name, phone: p0.sender.phone || '', addr: p0.sender.addr || '', ...(p0.memo != null ? { memo: p0.memo } : {}), ...(p0.tail ? { tail: p0.tail } : {}) } } : undefined;
        if (cd.type === 'memo-edit') {
            if (all(p => p.memo != null)) return { byChat: true, v: { use: true, memo: p0.memo, ...(p0.tail ? { tail: p0.tail } : {}) } };
            if (cd.tail && all(p => p.tail != null) && cd.memo.rest === cd.memo.orig) return { byChat: true, v: { use: true, memo: cd.memo.orig, ...(p0.tail ? { tail: p0.tail } : {}) } };   // 품목 뒤에 붙일 말만 묻던 카드
        }
        return undefined;
    }
    const closed = cd => st.dec.has(cd.id) || !!patchDec(cd);
    const pending = () => st.cards.filter(cd => !closed(cd));
    // 검증·스타일용 카드 종류(data-fo-card) — 카드 id 머리말로 정한다
    const KIND = { ord: 'order', split: 'split', samb: 'sender-memo', memo: 'memo-edit', 'samb-line': 'sender-line', lbad: 'line', lcnt: 'line', lsplit: 'line', lnoship: 'line', lnodate: 'line', lrecv: 'line-recv', snohit: 'line', cashfmt: 'cash-format', cmiss: 'cash-missing', cnot: 'cash-notindiv', cbox: 'cash-boxdiff', pick: 'partner' };
    const kindOf = cd => KIND[cd.id.split(':')[0]] || cd.type;
    // #525: AI가 손님 메모에서 읽은 「품목 뒤에 붙일 말」 입력칸 — 사람이 [이대로 넣기]를 눌러야 옵션 칸 끝에 붙는다(비우면 안 붙임)
    const tailBoxHtml = (cd, d) => (cd.tail ? `<label class="wide">품목 뒤에 붙일 말(옵션 칸 끝에 붙어요 · 비우면 안 붙임)<input type="text" data-f="tail" value="${esc(d && d.tail != null ? d.tail : cd.tail)}" maxlength="80"></label>` : '');
    function cardHtml(cd) {
        const pd = patchDec(cd), v = pd ? pd.v : st.dec.get(cd.id), done = v !== undefined;
        if (pd) {   // 말로 정한 카드 — 무엇으로 정했는지와 [바꾸기](그 말을 되돌림)
            const lab = cd.type === 'order' || cd.type === 'split' ? ((cd.choices.find(c => c[0] === v) || [])[1] || (v === 'send' ? '오늘 발송' : '제외'))
                : cd.type === 'sender-order' ? `보내는이 ${/드림$/.test(v.name) ? v.name : v.name + ' 드림'}${v.phone ? ' · ' + v.phone : ''}${typeof v.memo === 'string' ? ` · 배송메세지 「${v.memo || '기본 문구'}」` : ''}${v.tail ? ` · 품목 뒤 「${v.tail}」` : ''}`
                : `배송메세지 「${v.memo || '기본 문구'}」${v.tail ? ` · 품목 뒤 「${v.tail}」` : ''}`;
            return `<article class="fo-card" data-id="${esc(cd.id)}" data-fo-card="${kindOf(cd)}" data-fo-done="1" data-by-chat="1" data-type="${cd.type}" data-state="done"><div class="fo-card-top"><span class="fo-tag" data-k="${cd.type}">${esc(cd.tag)}</span><b>${esc(cd.title)}</b><span class="fo-aibadge fo-chatbadge" data-chat-badge="1">말로 정함</span></div><div class="fo-card-acts"><span class="fo-done">${esc(lab)} · 말로 정함</span><button type="button" class="fo-btn sm" data-unpatch-card="${esc(cd.id)}">바꾸기</button></div></article>`;
        }
        // #520: AI가 입력칸을 채워 둔 열린 카드에는 그 사실과 이유를 한 줄로(사람이 눌러야 끝난다)
        const aiNote = !done && st.ai.hint && st.ai.hint.has(cd.id) ? `<div class="fo-line fo-ai-note" data-ai-note="1"><span>AI</span><p>${esc(st.ai.hint.get(cd.id))}</p></div>` : '';
        const lines = cd.lines.map(([k, t]) => `<div class="fo-line"><span>${esc(k)}</span><p>${esc(t)}</p></div>`).join('') + aiNote;
        let acts = '';
        if (cd.type === 'pick') {
            acts = `<label class="fo-pick">거래처 <select data-pick="${esc(cd.id)}"><option value="">고르기</option>${cd.picks.map(p => `<option value="${esc(p)}"${v === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>`;
        } else if (cd.type === 'memo-edit') {
            const d = v || st.draft.get(cd.id) || { memo: cd.memo.rest };
            const tailBox = tailBoxHtml(cd, d);
            acts = done ? `<span class="fo-done">${v.use ? `배송메세지 「${esc(v.memo || '기본 문구')}」${v.tail ? ` · 품목 뒤 「${esc(normTail(v.tail))}」` : ''}` : cd.tail ? '안 바꿈' : '원문 그대로'}${st.ai.tag.has(cd.id) ? ' · AI: ' + esc(st.ai.tag.get(cd.id)) : ''}</span><button type="button" class="fo-btn sm" data-undo="${esc(cd.id)}">바꾸기</button>`
                : `<div class="fo-edit"><label class="wide">택배사 양식에 들어갈 배송메세지(비우면 기본 문구)<textarea data-f="memo" rows="2" maxlength="300">${esc(d.memo == null ? cd.memo.rest : d.memo)}</textarea></label>${tailBox}</div>
                   <button type="button" class="fo-btn sm primary" data-memo="use" data-fo-act="use" data-id="${esc(cd.id)}">이대로 넣기</button><button type="button" class="fo-btn sm" data-memo="keep" data-fo-act="keep" data-id="${esc(cd.id)}">${cd.tail ? '안 바꿈' : '원문 그대로'}</button>`;
        } else if (cd.type === 'sender-edit' || cd.type === 'sender-order') {
            const ord = cd.type === 'sender-order';   // 주문 카드(손님 메모 애매) = [안 바꿈] · 메모 줄 카드 = [넣지 않음]
            const d = v || st.draft.get(cd.id) || { name: cd.sender.name || '', phone: cd.sender.phone || '', addr: cd.sender.addr || '', memo: cd.sender.memo || '' };   // draft = 아직 안 누른 카드에 적어 둔 글(다른 카드를 눌러 다시 그려도 유지)
            // #511(대표 10/4 「정답은 동호수만 남기고 김현정 드림」): 주문 카드에서는 택배사 양식에 들어갈 배송메세지도 사람이 고쳐 넣을 수 있다(프로그램이 지우지 않는다 · 비우면 기본 문구)
            const memoBox = ord ? `<label class="wide">택배사 양식에 들어갈 배송메세지(보내는이 부탁 글은 지우고 남길 것만 · 비우면 기본 문구)<textarea data-f="memo" rows="2" maxlength="300">${esc(d.memo == null ? cd.sender.memo || '' : d.memo)}</textarea></label>` : '';
            const memoDone = (ord && v && v.use && typeof v.memo === 'string' && v.memo !== (cd.sender.orig || '') ? ` · 배송메세지 「${esc(v.memo || '기본 문구')}」` : '') + (v && v.use && v.tail ? ` · 품목 뒤 「${esc(normTail(v.tail))}」` : '');
            acts = done ? `<span class="fo-done">${v.use ? `보내는이 ${esc(/드림$/.test(v.name) ? v.name : v.name + ' 드림')}${v.phone ? ' · ' + esc(v.phone) : ''}${v.addr ? ' · 주소 ' + esc(v.addr) : ''}${memoDone}` : ord ? '안 바꿈' : '이 줄은 넣지 않음'}${st.ai.tag.has(cd.id) ? ' · AI: ' + esc(st.ai.tag.get(cd.id)) : ''}</span><button type="button" class="fo-btn sm" data-undo="${esc(cd.id)}">바꾸기</button>`
                : `<div class="fo-edit"><label>보내는 분 이름(「드림」 자동)<input type="text" data-f="name" value="${esc(d.name)}" maxlength="20"></label><label>번호(바꿀 때만)<input type="text" data-f="phone" value="${esc(d.phone)}" inputmode="tel" maxlength="14"></label><label class="wide">보내는이 주소(바꿀 때만 · M칸에 그대로)<input type="text" data-f="addr" value="${esc(d.addr)}" maxlength="120"></label>${memoBox}${ord ? tailBoxHtml(cd, d) : ''}</div>
                   <button type="button" class="fo-btn sm primary" data-sender="use" data-fo-act="use" data-id="${esc(cd.id)}">이대로 넣기</button><button type="button" class="fo-btn sm" data-sender="skip" data-fo-act="${ord ? 'keep' : 'skip'}" data-id="${esc(cd.id)}">${ord ? '안 바꿈' : '넣지 않음'}</button>`;
        } else if (done) {
            const om = cd.type === 'order' && v === 'send' && st.ordMemo && st.ordMemo.has(cd.id) ? ` · 배송메세지 「${st.ordMemo.get(cd.id) || '기본 문구'}」` : '';
            const lab = ((cd.choices.find(c => c[0] === v) || [])[1] || '확인함') + om + (st.ai.tag.has(cd.id) ? ' · AI: ' + st.ai.tag.get(cd.id) : '');
            acts = `<span class="fo-done">${esc(lab)}</span><button type="button" class="fo-btn sm" data-undo="${esc(cd.id)}">바꾸기</button>`;
        } else {
            // #548: 주문 확인 카드에서도 택배사 양식에 들어갈 배송메세지를 고쳐 넣을 수 있다([오늘 발송]을 누를 때만 반영 · 원문과 같으면 종전대로)
            const od = cd.type === 'order' ? st.draft.get(cd.id) : null;
            const ordBox = cd.type === 'order' ? `<div class="fo-edit"><label class="wide">택배사 양식에 들어갈 배송메세지(오늘 발송일 때만 · 비우면 기본 문구)<textarea data-f="memo" rows="2" maxlength="300">${esc(od && od.memo != null ? od.memo : cd.memoPre || '')}</textarea></label></div>` : '';
            acts = ordBox + cd.choices.map(([val, lab, pri]) => `<button type="button" class="fo-btn sm${pri ? ' primary' : ''}" data-choice="${esc(val)}" data-fo-act="${esc(val)}" data-id="${esc(cd.id)}">${esc(lab)}</button>`).join('') || '<span class="fo-wait">고친 뒤 [다시 판정]을 눌러야 넘어가요</span>';
        }
        return `<article class="fo-card" data-id="${esc(cd.id)}" data-fo-card="${kindOf(cd)}"${done ? ' data-fo-done="1"' : ''} data-type="${cd.type}" data-state="${done ? 'done' : 'open'}"><div class="fo-card-top"><span class="fo-tag" data-k="${cd.type}">${esc(cd.tag)}</span>${done && st.ai.tag.has(cd.id) ? '<span class="fo-aibadge" data-ai-badge>AI가 처리</span>' : ''}<b>${esc(cd.title)}</b></div>${done && cd.type !== 'pick' && cd.type !== 'sender-edit' && cd.type !== 'sender-order' ? '' : `<div class="fo-card-body">${lines}</div>`}<div class="fo-card-acts">${acts}</div></article>`;
    }
    // 다시 그리기 전에, 아직 확정하지 않은 카드의 입력칸 글을 떠 둔다(워커1 관찰: 다른 카드를 누르면 적다 만 글이 사라졌다)
    function saveDrafts() {
        if (st.skipDraftSave) { st.skipDraftSave = false; return; }   // AI가 입력칸 미리 채움을 넣은 직후에는 화면의 옛 값을 떠 가지 않는다
        document.querySelectorAll('#fo-cards .fo-card[data-state="open"]').forEach(card => {
            const fs = card.querySelectorAll('[data-f]'); if (!fs.length) return;
            const d = {}; fs.forEach(el => { d[el.dataset.f] = el.value; }); st.draft.set(card.dataset.id, d);
        });
    }
    function renderReview() {
        saveDrafts();
        const s = S(), m = s.merged;
        const n = m.length, indiv = m.filter(e => e.individual).length, excl = m.filter(e => !e.individual && e.excluded).length;
        const cashRows = st.cash && st.cash.ok ? st.cash.rows.length : 0;
        $('fo-review').hidden = false; syncAi(); syncChat();
        $('fo-sum').innerHTML = `<span>기준 발송일 <b>${esc(dateLabel(s.shipDate))}</b></span><span>주문 <b>${n}</b>건</span><span>택배사 양식 <b>${n - indiv - excl}</b>건</span><span>입력삭제 <b>${indiv}</b>건</span><span>오늘 안 나감 <b>${excl}</b>건</span><span>현금파일 <b>${cashRows}</b>행</span><span id="fo-jeju">제주도 배송 <b>${esc(jejuText())}</b></span>${st.loadedAt ? `<span>주문 불러온 시각 <b>${hm(st.loadedAt)}</b></span>` : ''}`;
        $('fo-info').innerHTML = st.info.length ? `<details><summary>참고 ${st.info.length}건 (확인만 하면 돼요)</summary><ul>${st.info.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : '';
        const open = pending(), ordOpen = open.filter(cd => cd.type === 'order').length;
        const head = st.cards.length ? `<div class="fo-cards-head"><h3>확인할 것 <b>${open.length}</b>건 <small>/ 전체 ${st.cards.length}건</small></h3>${ordOpen > 1 ? `<button type="button" class="fo-btn sm" data-bulk="send">남은 주문 확인 ${ordOpen}건 모두 오늘 발송</button>` : ''}</div>` : '<p class="fo-empty">확인할 것이 없어요. 바로 파일을 만들 수 있어요.</p>';
        // #517: 카드가 많을 때(설날 실파일 = 100장 안팎) 종류별로 걸러 본다 — 남은 건수가 있는 종류만 칩으로
        const kinds = {}; open.forEach(cd => { const k = cd.tag; kinds[k] = (kinds[k] || 0) + 1; });
        if (st.kindFilter && !kinds[st.kindFilter]) st.kindFilter = '';
        const chips = Object.keys(kinds).length > 1 ? `<div class="fo-kinds" role="group" aria-label="종류별로 보기"><button type="button" class="fo-kind${st.kindFilter ? '' : ' on'}" data-kind="">전체 ${open.length}</button>${Object.entries(kinds).map(([k, n]) => `<button type="button" class="fo-kind${st.kindFilter === k ? ' on' : ''}" data-kind="${esc(k)}">${esc(k)} ${n}</button>`).join('')}</div>` : '';
        const order = cd => (closed(cd) ? 1 : 0);
        const shown = st.cards.filter(cd => !st.kindFilter || (cd.tag === st.kindFilter && !closed(cd)));
        $('fo-cards').innerHTML = head + chips + shown.slice().sort((a, b) => order(a) - order(b)).map(cardHtml).join('');
        renderMemoGut();
        syncMake();
    }
    function syncMake() {
        if (!st.built || st.phase === 'input' || st.phase === 'loading') return;
        const left = pending().length, btn = $('fo-make');
        btn.disabled = st.busy || left > 0 || !!st.stale || !st.judged || st.ai.running;
        if (!$('fo-make-msg').classList.contains('err')) $('fo-make-msg').textContent = st.stale || !st.judged ? '위의 [다시 판정]을 먼저 눌러 주세요.' : left ? `확인할 것이 ${left}건 남았어요.` : '';
    }
    function decide(id, v) {
        saveDrafts(); const prev = st.dec.get(id); st.draft.delete(id);
        if (v === undefined) { st.dec.delete(id); if (prev && typeof prev === 'object' && prev.use) st.draft.set(id, prev); if (st.ordMemo && st.ordMemo.has(id)) st.draft.set(id, { memo: st.ordMemo.get(id) }); }   // [바꾸기] = 앞서 넣은 값에서 이어 고친다
        else st.dec.set(id, v);
        st.out = null; $('fo-result').hidden = true; clearMsg(); applyOrderDecisions(); if (v === undefined) resetOrder(id); renderSummaryOnly();
    }
    function resetOrder(id) {   // 결정을 되돌리면 v2 판정값으로
        if (!/^(ord|split):/.test(id)) return;
        const cd = st.cards.find(c => c.id === id); if (!cd) return;
        const byKey = new Map(S().merged.map(x => [keyOf(x), x]));
        keysOf(cd).forEach(k => { const e = byKey.get(k); if (!e) return; const other = otherDec(cd, k); e.excluded = other === 'excl'; e.userTouched = !!other; });
    }
    function renderSummaryOnly() { buildCards(); applyOrderDecisions(); renderReview(); }
    function onCardClick(e) {
        if (st.busy || !st.judged) return;   // 판정이 실패한 뒤 남은 카드는 [다시 판정] 전까지 누를 수 없다 · #520: AI가 읽는 동안에도 카드는 누를 수 있다(사람이 정한 카드는 AI가 덮지 않는다)
        const b = e.target.closest('button'); if (!b) return;
        if (b.classList.contains('fo-kind')) { st.kindFilter = b.dataset.kind || ''; return renderReview(); }
        if (b.dataset.choice === 'apply' && /^lrecv:/.test(b.dataset.id)) return applyRecv(b.dataset.id);
        if (b.dataset.choice) { const ocd = st.cards.find(c => c.id === b.dataset.id); if (ocd && ocd.type === 'order') { const el = b.closest('.fo-card').querySelector('[data-f="memo"]'), val = el ? String(el.value || '').replace(/\r/g, '').trim() : null; st.ordMemo = st.ordMemo || new Map(); if (b.dataset.choice === 'send' && val != null && val !== (ocd.memoOrig || '')) st.ordMemo.set(ocd.id, val); else st.ordMemo.delete(ocd.id); } }
        if (b.dataset.choice) return decide(b.dataset.id, b.dataset.choice);
        if (b.dataset.undo) return decide(b.dataset.undo, undefined);
        if (b.dataset.unpatchCard) return unpatchCard(b.dataset.unpatchCard);
        if (b.dataset.bulk === 'send') { pending().filter(cd => cd.type === 'order').forEach(cd => st.dec.set(cd.id, 'send')); st.out = null; $('fo-result').hidden = true; return renderSummaryOnly(); }
        if (b.dataset.memo) {
            if (b.dataset.memo === 'keep') return decide(b.dataset.id, { use: false });
            const el = b.closest('.fo-card').querySelector('[data-f="memo"]');
            const tl = b.closest('.fo-card').querySelector('[data-f="tail"]');
            return decide(b.dataset.id, { use: true, memo: String((el && el.value) || '').replace(/\r/g, '').trim(), ...(tl && tl.value.trim() ? { tail: tl.value.trim() } : {}) });
        }
        if (b.dataset.sender) {
            const card = b.closest('.fo-card'), get = f => (card.querySelector(`[data-f="${f}"]`).value || '').trim();
            if (b.dataset.sender === 'skip') return decide(b.dataset.id, { use: false });
            const name = get('name'); if (!name) { card.querySelector('[data-f="name"]').focus(); return; }
            const memoEl = card.querySelector('[data-f="memo"]'), tailEl = card.querySelector('[data-f="tail"]');
            return decide(b.dataset.id, { use: true, name, phone: get('phone'), addr: get('addr'), ...(memoEl ? { memo: String(memoEl.value || '').replace(/\r/g, '').trim() } : {}), ...(tailEl && tailEl.value.trim() ? { tail: tailEl.value.trim() } : {}) });
        }
    }
    // 말로 정한 카드의 [바꾸기]: 그 카드가 묻던 것에 해당하는 말만 되돌린다(제외를 되돌리면 엔진 판정값으로 돌아가야 하므로 다시 판정)
    async function unpatchCard(id) {
        const cd = st.cards.find(c => c.id === id); if (!cd) return;
        const drop = cd.type === 'order' || cd.type === 'split' ? ['excl'] : cd.type === 'sender-order' ? ['sender', 'memo', 'tail'] : ['memo', 'tail'];
        keysOf(cd).forEach(k => { const p = Object.assign({}, st.patch.get(k) || {}); drop.forEach(f => delete p[f]); if (Object.keys(p).length) st.patch.set(k, p); else st.patch.delete(k); });
        st.dec.delete(id);   // 앞서 카드에서 눌러 둔 결정도 함께 풀어 다시 묻는다
        const had = st.phase === 'result' && st.files.length > 0;
        st.out = null; st.files = []; $('fo-result').hidden = true; clearMsg();
        if (drop[0] === 'excl') { for (let i = 0; i < 1200 && st.ai.running; i++) await sleep(500); await run(judge); } else renderSummaryOnly();
        syncChat(); if (had) await remake();
    }
    function onCardChange(e) { const sel = e.target.closest('select[data-pick]'); if (sel && !st.busy && st.judged) decide(sel.dataset.pick, sel.value || undefined); }

    // ── ④ 파일 만들기 ───────────────────────────────────────────────────────
    async function make() {
        clearMsg();
        st.out = null; st.files = []; $('fo-result').hidden = true;
        dayGuard();
        if (st.stale || !st.judged) throw new Error('내용이 바뀌었어요. [다시 판정]을 먼저 눌러 주세요.');
        if (pending().length) throw new Error('확인할 것이 남아 있어요.');
        const w = W(), orig = w.XLSX.writeFile; let wb;
        w.XLSX.writeFile = () => { };                                  // v2가 직접 저장하지 못하게 — 워크북만 받는다
        try { wb = await IVT().download(); } finally { w.XLSX.writeFile = orig; }
        if (sessionLost()) throw new Error('로그인이 풀렸어요.');
        if (!wb) throw new Error((D().getElementById('msg-dl').textContent || '내보낼 주문이 없어요.').replace(/^⚠️?\s*/, ''));
        const s = S(), list = s.merged.filter(goingOut), ws1 = wb.Sheets.Sheet1;   // download 뒤에 계산(쿠팡 취소 재확인이 목록을 바꿀 수 있다)
        const rows1 = ws1 && ws1['!ref'] ? w.XLSX.utils.decode_range(ws1['!ref']).e.r : 0;
        if (rows1 !== list.length) throw new Error(`택배사 양식 행 수가 맞지 않아요(시트 ${rows1}행 / 주문 ${list.length}건). 다시 판정해 주세요.`);
        const program = list.map((e, i) => ({ key: keyOf(e), cells: 'ABCDEFGHIJK'.split('').map(col => { const x = ws1[col + (i + 2)]; return x ? { v: x.v == null ? '' : x.v, s: x.s, t: x.t } : { v: '' }; }) }));
        // #511: 보내는이 카드에서 사람이 고쳐 넣은 배송메세지(원문과 다를 때만) — 색 표시는 보통 칸 서식으로(사람이 처리한 칸). 비웠으면 core 가 기본 문구를 넣는다.
        //   #516: 배송메세지 카드에서 정한 글 · 요청 글뿐이라 자동으로 기본 문구가 되는 주문(st.memoAuto)도 여기서 덮는다.
        list.forEach((e, i) => {
            const k = keyOf(e), orig = String(e.conv['배송메세지'] || '').replace(/\r/g, '').trim();
            const put = text => { if (text !== orig) program[i].cells[9] = { v: text, t: 's', s: program[i].cells[3].s }; };
            const oid = st.ordCard && st.ordCard.get(k);   // #548 주문 확인 카드에서 고쳐 넣은 배송메세지([오늘 발송]으로 정한 것만)
            if (oid && st.ordMemo && st.ordMemo.has(oid) && st.dec.get(oid) === 'send') { put(st.ordMemo.get(oid)); return; }
            const d = sambDec(e);
            if (d) { if (d.use && typeof d.memo === 'string') put(d.memo); return; }   // 보내는이 카드가 있는 주문은 그 카드의 결정만 따른다([안 바꿈]이면 원문 그대로)
            const md2 = st.memoCard && st.memoCard.get(k) ? st.dec.get(st.memoCard.get(k)) : undefined;
            if (md2) { if (md2.use && typeof md2.memo === 'string') put(md2.memo); return; }
            if (st.ai.memo.has(k)) { put(st.ai.memo.get(k)); return; }                // #518: AI가 정리한 배송메세지(확실하다고 한 것만 · 카드 없는 주문)
            if (st.memoAuto && st.memoAuto.get(k)) put('');
        });
        // #525: 대화 칸에서 사람이 말로 시킨 주문만 덮는다(받는 분·옵션·수량·주소·배송메세지 · 연보라 칸). 다른 행은 엔진 결과 그대로.
        const sby = senderMap().byKey;
        list.forEach((e, i) => {
            const p = st.patch.get(keyOf(e)), tl = tailOf(e), c = program[i].cells, base = c[3].s, lilac = v => ({ v, t: typeof v === 'number' ? 'n' : 's', s: patchStyle(base) });
            if (tl !== undefined) c[4] = lilac(withTail(String(p && p.opt != null ? p.opt : c[4].v), tl));   // 품목 뒤 요청 꼬리(대화 또는 카드에서 사람이 확인)
            if (!p) return;
            if (p.opt != null && tl === undefined) c[4] = lilac(p.opt);
            if (p.recv != null) c[3] = lilac(p.recv);
            if (p.qty != null) c[5] = lilac(p.qty);
            if (p.addr != null) c[8] = lilac(p.addr);
            if (p.memo != null) c[9] = lilac(p.memo);
            if (p.sender && p.sender.name) sby.set(keyOf(e), { name: p.sender.name, phone: p.sender.phone || null, addr: p.sender.addr || null });
        });
        const picks = {}; st.cards.forEach(cd => { if (cd.type === 'pick' && st.dec.get(cd.id)) picks[cd.id.slice(5)] = st.dec.get(cd.id); });
        const out = core().buildRows({ program, cash: st.cash && st.cash.ok ? st.cash.rows : [], byPartner: st.byPartner, picks, senderByKey: sby, defaultMemo: DEFAULT_MEMO });
        if (out.unknown && out.unknown.length) { buildCards(); applyOrderDecisions(); renderReview(); throw new Error('거래처를 못 정한 품목이 새로 생겼어요. 위에서 골라 주세요.'); }
        const dot = mdDot(s.shipDate), files = [];
        const colorOf = name => (/!$/.test(name) && !inCatalog(name) && core().stripTail(name, inCatalog) !== name ? CAT_RGB.orange : CAT_RGB[typeof window.qtyCategory === 'function' ? window.qtyCategory(name) : '']) || null;   // #525: 요청 꼬리가 붙은 줄 = 사이즈 꼬리 줄과 같은 주황
        const shorts = out.partners.map(p => p.short);
        out.partners.forEach(p => {
            if (!p.rows.length) return;
            if (shorts.filter(x => x === p.short).length > 1) p.short = p.name.replace(/[\\/:*?"<>|]/g, '');   // 짧은 이름이 겹치면 온 이름으로(파일 이름 충돌 방지)
            const pw = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(pw, core().sheetOf(XLSX, p), 'Sheet1');
            XLSX.utils.book_append_sheet(pw, core().qtySheetOf(XLSX, p, colorOf), '수량');
            files.push({ kind: 'partner', short: p.short, name: `제주아꼼이네송장(${p.short}) ${dot}.xlsx`, wb: pw, partner: p, png: `수량(${p.short}) ${dot}.png` });
        });
        const store = wb.Sheets['발주발송관리'];
        if (store) { const sw = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(sw, store, '발주발송관리'); const rg = w.XLSX.utils.decode_range(store['!ref']); files.push({ kind: 'store', name: `스마트스토어 발주발송관리 ${dot}.xlsx`, wb: sw, rows: Math.max(rg.e.r - 1, 0), indiv: s.merged.filter(e => e.ch === 'naver' && e.individual && !e.excluded).length }); }
        st.out = out; st.files = files; st.colorOf = colorOf; st.phase = 'result';
        renderResult(D().getElementById('msg-coupang').textContent || '');
        sendLog();   // #525: 전체 지시에 남길 정리 기록 1건(다시 만들면 같은 기록을 고쳐 씀) — 실패해도 파일 만들기는 성공
    }
    function renderResult(cpMsg) {
        const el = $('fo-result'); el.hidden = false;
        const qtyTable = p => `<table class="fo-qty" id="fo-qty-${esc(p.short)}"><tbody>${p.qty.map(q => `<tr><td style="background:#${st.colorOf(q.name) || 'FFFFFF'}">${esc(q.name)}</td><td class="n">${q.qty}</td></tr>`).join('')}<tr class="tot"><td></td><td class="n">${p.total}</td></tr></tbody></table>`;
        const partner = f => { const p = f.partner, cash = p.rows.filter(r => r.src === 'cash').length, jeju = p.rows.filter(r => r.jeju).length; return `<article class="fo-file" data-short="${esc(f.short)}"><header><h4>${esc(f.short)}</h4><p>${p.rows.length}행 · ${p.total}박스${cash ? ` · 현금파일 ${cash}행 포함` : ''}${jeju ? ` · 제주 ${jeju}행(맨 아래)` : ''}</p></header>${qtyTable(p)}<div class="fo-acts"><button type="button" class="fo-btn primary" data-fo-save="${esc(f.name)}">택배사 양식 저장</button><button type="button" class="fo-btn" data-fo-png="${esc(f.short)}">수량 이미지 저장</button></div><p class="fo-fname">${esc(f.name)}</p></article>`; };
        const store = f => `<article class="fo-file store"><header><h4>스마트스토어</h4><p>${f.rows}행${f.indiv ? ` · 입력삭제 ${f.indiv}행은 노란 줄(맨 아래)` : ''}</p></header><div class="fo-acts"><button type="button" class="fo-btn primary" data-fo-save="${esc(f.name)}">스토어 양식 저장</button></div><p class="fo-fname">${esc(f.name)}</p></article>`;
        const ps = st.files.filter(f => f.kind === 'partner'), ss = st.files.filter(f => f.kind === 'store');
        const pl = patchLines();
        el.innerHTML = `<div class="fo-cards-head"><h3>결과 파일</h3><button type="button" class="fo-btn" id="fo-save-all" title="엑셀 파일만 받아요. 수량 이미지는 엑셀의 수량 시트에도 있고, 아래 버튼으로 따로 받을 수 있어요">파일 ${st.files.length}개 전부 저장</button></div>
            <p class="fo-jeju" id="fo-jeju-result">제주도 배송: <b>${esc(jejuText())}</b></p>
            ${pl.length ? `<div class="fo-patched" id="fo-patched"><b>말로 바꾼 것 ${pl.length}건</b> (바뀐 칸은 연보라색)<ul>${pl.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
            ${/재확인 실패/.test(cpMsg) ? `<p class="fo-hint err">${esc(cpMsg.replace(/^⚠️?\s*/, ''))}</p>` : /취소/.test(cpMsg) && /자동 제외/.test(cpMsg) ? `<p class="fo-hint">${esc(cpMsg.replace(/^🛡️\s*/, ''))}</p>` : ''}
            <div class="fo-files">${ps.map(partner).join('')}${ss.map(store).join('')}</div>
            <p class="fo-hint">색이 칠해진 배송메세지 칸(보내는이·사이즈·날짜 요청)은 송장변환과 같아요. 확인하고 지워 주세요. 메모나 현금파일을 고치면 [다시 판정] 후 다시 만들어요.</p>`;
        el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    function saveFile(name) { const f = st.files.find(x => x.name === name); if (!f) return; XLSX.writeFile(f.wb, f.name); }
    function savePng(short) {
        const f = st.files.find(x => x.short === short); if (!f) return;
        const p = f.partner, dpr = 2, rowH = 34, padX = 12, font = '600 15px Pretendard, "Malgun Gothic", sans-serif';
        const cv = document.createElement('canvas'), g = cv.getContext('2d'); g.font = font;
        const nameW = Math.ceil(Math.max(260, ...p.qty.map(q => g.measureText(q.name).width)) + padX * 2), qtyW = 96, Wd = nameW + qtyW, H = rowH * (p.qty.length + 1);
        cv.width = Wd * dpr; cv.height = H * dpr; g.scale(dpr, dpr); g.font = font; g.textBaseline = 'middle';
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, Wd, H);
        const cell = (x, y, wd, fill, text, right) => { if (fill) { g.fillStyle = fill; g.fillRect(x, y, wd, rowH); } g.strokeStyle = '#000000'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, wd - 1, rowH - 1); g.fillStyle = '#000000'; g.textAlign = right ? 'right' : 'left'; g.fillText(String(text), right ? x + wd - padX : x + padX, y + rowH / 2 + 1); };
        // 대표가 보내던 표와 같은 모양: 품목 칸만 색 · 수량 칸과 합계 줄은 흰색
        p.qty.forEach((q, i) => { cell(0, i * rowH, nameW, '#' + (st.colorOf(q.name) || 'FFFFFF'), q.name); cell(nameW, i * rowH, qtyW, null, q.qty, true); });
        cell(0, p.qty.length * rowH, nameW, null, ''); cell(nameW, p.qty.length * rowH, qtyW, null, p.total, true);
        cv.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.png; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
    }
    async function onResultClick(e) {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.foSave) { saveFile(b.dataset.foSave); toast('저장했어요: ' + b.dataset.foSave); return; }
        if (b.dataset.foPng) { savePng(b.dataset.foPng); return; }
        if (b.id === 'fo-save-all') { b.disabled = true; try { for (const f of st.files) { saveFile(f.name); await sleep(350); } toast(`파일 ${st.files.length}개를 저장했어요(수량 이미지는 아래 버튼으로 따로)`); /* #548(대표 10/6): 수량 이미지는 엑셀 수량 시트에 이미 있어 전부 저장에서는 뺀다 */ } finally { b.disabled = false; } }
    }

    // ── #518(대표 10/4 「AI가 배송메세지를 읽고 사람처럼 처리」) AI(창구)가 손님 메모를 읽는다 ─────────────────────────
    //   규칙이 확실히 처리한 것은 그대로 두고, 카드가 뜬 주문과 「기사에게 전하는 말만은 아닌」 메모를 창구에 보낸다(직원 = 콘솔 · 대표 = 대표 요금제 — 창구 대기 프로그램이 가른다).
    //   AI는 받는 분·주소·옵션·수량을 못 건드린다(메모 글과 구매자·수취인 이름·수량만 받는다). 돌아온 판정은 확실하다고 한 것만 카드 결정으로 넣고, 나머지는 입력칸에 미리 채워 사람이 확인한다.
    function newAi() { return { id: 0, running: false, gen: 0, t0: 0, items: [], byKey: new Map(), memo: new Map(), memoAsk: new Map(), tag: new Map(), hint: new Map(), tailAsk: new Map(), seen: new Set(), done: false, count: 0, sig: '' }; }
    st.ai = newAi();
    function aiOf(e) { return st.ai.byKey.get(keyOf(e)) || null; }
    function aiHold(e) { const r = aiOf(e); return !!r && r.ship !== 'go' && !e.individual && e.reqKind !== 'today' && !(e.excluded && !e.userTouched); }
    function aiSender(e) { const r = aiOf(e); return !e.sender && !!(r && r.sender && r.sender.name) && !!String(e.conv['배송메세지'] || '').trim(); }
    const AI_COURIER = /문\s*앞|현관|경비|비밀\s*번호|비번|부재|연락|전화|문자|택배함|보관|\d+\s*층|\d+\s*동|\d+\s*호|공동|초인종|벨|\d+\s*과/g;
    const AI_PLAIN_SKIP = /\d+\s*과|과수|선물|좋은|예쁜|맛있|신선|꼼꼼|포장|빠른|빨리|사이즈|size|감사|수고|안녕|하자|상태|크기|보내는|보낸|드림|올림|주문자|발신|from|\d+\s*일|요일|도착|발송|출고|주소|리스트|명단|메일|톡톡/i;
    const aiSquash = s => String(s || '').replace(/\s+/g, '');
    // AI가 돌려준 「남길 글」 검사 — 원문에 있는 글자만으로 이루어졌는지 · 기사에게 전하는 낱말을 빠뜨리지 않았는지. 어긋나면 확실하지 않은 것으로 본다(사람이 카드로 확인)
    function aiMemoText(r, orig) {
        const m = String(r.memo == null ? '그대로' : r.memo).trim();
        if (m === '그대로') return { text: orig, safe: true };
        const courier = orig.replace(/주문자/g, '').match(AI_COURIER) || [];   // 「주문자」 안의 「문자」는 기사용 낱말이 아니다(실측 2건이 헛걸림)
        if (m === '기본' || m === '') return { text: '', safe: !courier.length };
        const o = aiSquash(orig);
        const partsOk = m.split(/\n+/).map(aiSquash).filter(Boolean).every(p => o.includes(p));
        const lost = courier.some(w => !aiSquash(m).includes(aiSquash(w)));
        return { text: partsOk ? m : orig, safe: partsOk && !lost };
    }
    const AI_KIND = { order: 'order', split: 'split', 'sender-order': 'sender', 'memo-edit': 'memo' };
    // #520: 그 주문 배송지의 동·호수 조각만(「115동402호」 「301호」 — 없으면 빈칸). 메모에 적힌 동·호수가 배송지와 다른지 AI가 견주게 한다. 주소 전체·전화는 보내지 않는다.
    function unitOf(e) {
        const a = String(e.conv['배송지'] || rawOf(e)['통합배송지'] || '');
        const m = a.match(/(\d{1,4}|[A-Za-z])\s*동\s*(\d{1,4})\s*호/); if (m) return `${m[1]}동${m[2]}호`;
        const h = a.match(/(\d{1,4})\s*호(?![가-힣])/); return h ? `${h[1]}호` : '';
    }
    // 메모에 동·호 숫자가 적혀 있으면 배송지 동·호수와 같아야 「확실」로 본다(AI가 확실하다고 답해도 화면에서 한 번 더 — 대표 10/4 「115동1202호 … 보내는사람」 · 배송지 115동402호 실사고).
    //   배송지에서 동·호수를 못 읽었으면(빈칸) 견줄 수 없어 통과.
    function unitOk(memo, unit) {
        const m = String(memo || ''); if (!/\d\s*(?:동|호)/.test(m) || !unit) return true;
        const u = unit.match(/^(?:(\w+)동)?(\d+)호$/); if (!u) return true;
        const full = [...m.matchAll(/(\d{1,4}|[A-Za-z])\s*동\s*(\d{1,4})\s*호/g)].map(x => [x[1], x[2]]);
        if (full.length) return full.every(([d, h]) => h === u[2] && (!u[1] || d === u[1]));
        const hos = [...m.matchAll(/(\d{1,4})\s*호(?![가-힣])/g)].map(x => x[1]), dongs = [...m.matchAll(/(\d{1,4})\s*동(?![가-힣])/g)].map(x => x[1]);
        return hos.every(h => h === u[2]) && dongs.every(d => !u[1] || d === u[1]);
    }
    const aiSig = groups => groups.map(g => [g.buyer, g.memo, g.qty, g.unit, g.keys.length].join('\u0001')).sort().join('\u0002');
    function aiCollect() {
        const s = S(), groups = new Map(), cardOf = new Map();
        st.cards.forEach(cd => { if (AI_KIND[cd.type]) keysOf(cd).forEach(k => { (cardOf.get(k) || cardOf.set(k, []).get(k)).push(cd); }); });
        s.merged.forEach(e => {
            const memo = String(e.conv['배송메세지'] || '').trim(); if (!memo || e.individual) return;
            if (e.excluded && !e.userTouched) return;                 // v2가 스스로 뺀 주문(날짜가 분명)
            if (e.reqKind === 'today' && !e.sender) return;           // 직원 줄로 그날 발송 확정(메모는 이미 비움)
            const k = keyOf(e), cds = cardOf.get(k) || [];
            const sized = /사이즈로!\s*$/.test(String(e.conv['옵션정보'] || ''));   // #523: v2가 메모의 사이즈 요청을 옵션에 붙인 주문(「…2S사이즈로!」) — 메모에 남은 사이즈 글을 AI가 정리하게 보낸다
            if (!cds.length) {
                if (st.memoAuto && st.memoAuto.get(k)) return;        // 규칙이 이미 기본 문구로 정함
                if (!AI_PLAIN_SKIP.test(memo) && !sized) return;                // 「문 앞에 놔주세요」처럼 기사에게 전하는 말뿐인 메모는 보내지 않는다(그대로 나감)
            }
            const unit = unitOf(e);
            // 메모에 동·호수가 적혀 있으면 배송지 동·호수가 다른 주문끼리는 묶지 않는다(견줄 값이 다르다)
            const gk = buyerName(e) + '|' + (cds.length ? buyerTel(e) : '') + '|' + memo + '|' + (qtyOf(e) >= 2 ? 'm' : 's') + (/\d\s*(?:동|호)/.test(memo) ? '|' + unit : '');
            let g = groups.get(gk);
            if (!g) {
                const hint = [e.sender ? (e.sender.ambiguous ? '보내는이 애매' : '보내는이 자동: ' + e.sender.name) : '', e.flag === 'review' ? '날짜 확인필요' : '', sized ? '사이즈 요청은 옵션에 반영됨' : ''].filter(Boolean).join(' · ');
                g = { keys: [], memo, buyer: buyerName(e), recv: String(e.conv['수취인명'] || ''), qty: qtyOf(e), cards: [...new Set(cds.map(c => AI_KIND[c.type]))], hint, unit };
                groups.set(gk, g);
            }
            g.keys.push(k);
        });
        return [...groups.values()];
    }
    function syncAi() {
        const bar = $('fo-ai'); if (!bar) return; const A = st.ai, msg = $('fo-ai-msg');
        bar.hidden = !(st.phase === 'review' || st.phase === 'result');
        const btn = $('fo-ai-read'); btn.disabled = A.running || st.busy || !st.judged || !!st.stale; btn.textContent = A.done ? 'AI에게 다시 읽히기' : 'AI에게 메모 읽히기';
        $('fo-ai-stop').hidden = !A.running;
        if (!A.running && A.done && !msg.classList.contains('err')) msg.textContent = `AI가 메모 ${A.count}건을 읽었어요. 확실한 것은 처리했고(보라색 「AI가 처리」 표시가 붙은 카드 · [바꾸기]로 고칠 수 있어요), 애매한 것은 입력칸에 채워 두었으니 남은 카드만 확인해 주세요.`;
        if (!A.running && !A.done && !msg.classList.contains('err')) msg.textContent = A.note || '판정이 끝나면 애매한 메모를 AI가 한 번 더 읽어 카드에 채워 줘요(대표 PC의 창구가 켜져 있어야 해요).';
    }
    // auto = 판정 직후 자동 시작(#520). 읽을 메모가 앞서 읽은 것과 같으면 다시 읽지 않는다(판정을 다시 해도 앞선 결과를 그대로 쓴다).
    async function aiRead(auto) {
        if (st.ai.running || st.busy || !st.judged || st.stale) return;
        const groups = aiCollect(), msg = $('fo-ai-msg'), sig = aiSig(groups), prev = st.ai;
        if (auto && (!groups.length || (prev.sig === sig && (prev.done || prev.failed)))) return;   // 같은 묶음이 실패했으면 자동으로는 다시 올리지 않는다(버튼으로)
        msg.classList.remove('err');
        if (!groups.length) { msg.textContent = 'AI가 읽을 메모가 없어요.'; return; }
        // 앞서 읽은 결과는 새 결과가 올 때까지 그대로 둔다(AI 때문에 뜬 카드와 그 카드의 사람 결정이 읽는 동안 사라지지 않게)
        st.ai = Object.assign(newAi(), { running: true, gen: (prev.gen || 0) + 1, items: groups, t0: Date.now(), sig, byKey: prev.byKey, memo: prev.memo, memoAsk: prev.memoAsk, tag: prev.tag, hint: prev.hint, tailAsk: prev.tailAsk, seen: auto ? prev.seen : new Set(), done: prev.done, count: prev.count });   // 버튼으로 다시 읽히면 아직 안 정한 카드는 새 결과로 다시 채운다
        const A = st.ai; syncAi(); syncMake(); syncInput(); msg.textContent = `메모 ${groups.length}건을 창구에 올리는 중이에요`;
        try {
            const s = S();
            const r = await window.api('/api/agent-office/final-order/memo-read', 'POST', { shipDate: s.shipDate, realToday: st.cal.realToday, shipDays: st.cal.shipDays, items: groups.map((g, i) => ({ i, memo: g.memo, buyer: g.buyer, recv: g.recv, qty: g.qty, cards: g.cards, hint: g.hint, unit: g.unit })) });
            if (!r || !r.ok || !r.id) throw new Error((r && (r.message || r.error)) || '요청을 올리지 못했어요');
            A.id = r.id;
            for (;;) {
                await sleep(3000);
                if (!A.running || st.ai !== A) return;
                const q = await window.api('/api/agent-office/final-order/memo-read/' + A.id), sec = Math.round((Date.now() - A.t0) / 1000);
                if (q && q.state === 'done') { A.running = false; aiApply(q.data); break; }
                if (q && q.state === 'fail') throw new Error(q.message || '창구가 처리하지 못했어요');
                msg.textContent = (q && q.status === '대기' ? (sec > 40 ? '창구가 아직 집지 않았어요. 대표 PC가 꺼져 있으면 AI 읽기를 쓸 수 없어요([그만두기]를 누르고 카드로 확인해도 돼요)' : '창구에 올렸어요') : `AI가 메모 ${groups.length}건을 읽고 있어요`) + ` · ${sec}초`;
                if (sec > 900) throw new Error('15분이 지나도 끝나지 않았어요');
            }
        } catch (err) { A.failed = true; msg.textContent = '⚠️ AI 읽기를 못 했어요: ' + (err && err.message ? err.message : err) + ' — 카드로 직접 확인해 주세요.'; msg.classList.add('err'); }
        finally {
            const id = A.id; A.running = false; A.id = 0;
            if (id) { try { await window.api('/api/agent-office/final-order/memo-read/' + id, 'DELETE'); } catch (_) { } }   // 손님 글을 서버에 남기지 않는다
            syncAi(); syncMake(); syncInput();
        }
    }
    function aiApply(data) {
        const A = st.ai, byI = new Map(((data && Array.isArray(data.items)) ? data.items : []).map(r => [Number(r && r.i), r]));
        let n = 0;
        A.byKey = new Map();
        A.items.forEach((g, i) => {
            const r0 = byI.get(i); if (!r0) return; n++;
            const mt = aiMemoText(r0, g.memo), sd = r0.sender && String(r0.sender.name || '').trim() ? r0.sender : null;
            const r = { ship: ['go', 'hold', 'ask'].includes(r0.ship) ? r0.ship : 'ask', ship_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r0.ship_date || '')) ? r0.ship_date : null,
                sender: sd ? { name: String(sd.name).trim().replace(/\s*(드림|올림)$/, '').slice(0, 20), phone: String(sd.phone || '').trim().slice(0, 14), addr: String(sd.addr || '').trim().slice(0, 120) } : null,
                split: !!r0.split, sure: r0.sure === true && mt.safe, why: String(r0.why || '').slice(0, 60), memoText: mt.text,
                tail: typeof r0.tail === 'string' && !/[\r\n]/.test(r0.tail) ? normTail(r0.tail) : '' };   // #525: 품목 뒤에 붙일 말(「17과로!」) — 자동으로 붙이지 않고 카드에서 사람이 확인
            if (r.split && r.ship === 'go') r.ship = 'ask';
            g.keys.forEach(k => A.byKey.set(k, r));
        });
        A.count = n; A.done = true;
        aiToCards();
    }
    // AI 판정을 카드에 반영한다(판정을 다시 해 카드가 새로 생겨도 부른다). 사람이 이미 정했거나 [바꾸기]로 되돌린 카드는 건드리지 않는다.
    function aiToCards() {
        const A = st.ai; if (!A.done) return;
        // 사람이 적다 만 글을 먼저 떠 둔다(AI가 읽는 동안에도 카드를 고칠 수 있다) · 입력 중이던 칸은 다시 그린 뒤 되찾는다
        st.skipDraftSave = false; saveDrafts();
        const act = document.activeElement, actCard = act && act.closest ? act.closest('#fo-cards .fo-card') : null;
        const focus = actCard && act.dataset && act.dataset.f ? { id: actCard.dataset.id, f: act.dataset.f, a: act.selectionStart, b: act.selectionEnd } : null;
        A.memo = new Map(); A.memoAsk = new Map();
        A.tailAsk = new Map(); A.byKey.forEach((r, k) => { if (r.tail && r.ship === 'go') A.tailAsk.set(k, r.tail); });
        buildCards();
        const carded = new Set(); st.cards.forEach(cd => { if (AI_KIND[cd.type]) keysOf(cd).forEach(k => carded.add(k)); });
        const byKeyE = new Map(S().merged.map(e => [keyOf(e), e]));
        const memoRaw = e => String(e.conv['배송메세지'] || '').replace(/\r/g, '').trim();
        const unitFine = k => { const e = byKeyE.get(k); return !e || unitOk(memoRaw(e), unitOf(e)); };
        S().merged.forEach(e => {   // 카드가 없는 주문의 배송메세지: 확실하면 바로(동·호수가 배송지와 다르면 확실로 보지 않는다), 아니면 「남길 글」을 채운 카드로
            const k = keyOf(e), r = A.byKey.get(k); if (!r || carded.has(k) || r.ship !== 'go' || r.sender) return;
            const orig = memoRaw(e); if (r.memoText === orig && !r.tail) return;
            if (r.sure && unitFine(k) && !r.tail) A.memo.set(k, r.memoText); else A.memoAsk.set(k, r.memoText);   // 품목 뒤에 붙일 말이 있으면 늘 카드로(사람 확인)
        });
        buildCards(); applyOrderDecisions();
        const same = (a, b) => ['name', 'phone', 'addr', 'memo'].every(f => String((a && a[f]) || '') === String((b && b[f]) || ''));
        st.cards.forEach(cd => {
            if (!AI_KIND[cd.type] || closed(cd) || A.seen.has(cd.id)) return;
            const r = A.byKey.get(keysOf(cd)[0]); if (!r) return; A.seen.add(cd.id);
            const tag = v => { st.dec.set(cd.id, v); A.tag.set(cd.id, r.why || 'AI 판단'); };
            // #520 절충(대표 10/4 밤 「AI가 확실한 건 알아서 처리 · 애매한 문구만 사람에게」): 보내는이·배송메세지 카드는 ①AI가 확실 ②안전장치 통과(r.sure 에 들어 있음) ③메모의 동·호수 = 배송지 일 때만 닫는다.
            //   그 밖에는 입력칸만 채우고 이유를 적어 사람이 누르게 한다. 사람이 이미 고쳐 적은 칸은 닫지도 덮지도 않는다.
            const unitBad = !keysOf(cd).every(unitFine), closable = r.sure && !unitBad && !r.tail && !cd.tail && !keysOf(cd).some(k => A.tailAsk.has(k));   // 품목 뒤에 붙일 말이 걸린 카드는 닫지 않는다(한 카드에 묶인 주문 중 하나라도)
            const note = t => A.hint.set(cd.id, t + (r.why ? ' · ' + r.why : '') + (unitBad ? ` · 메모의 동·호수가 배송지(${unitOf(byKeyE.get(keysOf(cd)[0]))})와 달라요 — 확인해 주세요` : r.sure ? '' : ' · AI도 확실하지 않대요'));
            if (cd.type === 'order') { if (r.sure && r.ship === 'go') tag('send'); else if (r.sure && r.ship === 'hold') { tag('excl'); if (r.ship_date) A.tag.set(cd.id, (r.why || 'AI 판단') + ' · ' + md(r.ship_date) + ' 발송'); } }
            else if (cd.type === 'split') { if (r.sure && !r.split && r.ship === 'go') tag('all'); }
            else if (cd.type === 'sender-order') {
                const base = { name: cd.sender.name || '', phone: cd.sender.phone || '', addr: cd.sender.addr || '', memo: cd.sender.memo || '' }, cur = st.draft.get(cd.id);
                if (cur && !same(cur, base)) { note('AI가 읽은 값은 넣지 않았어요(직접 고쳐 적은 글이 있어요)'); return; }
                if (closable) { st.draft.delete(cd.id); tag(r.sender ? { use: true, name: r.sender.name, phone: r.sender.phone, addr: r.sender.addr, memo: r.memoText } : { use: false }); }
                else if (r.sender) { st.draft.set(cd.id, { name: r.sender.name, phone: r.sender.phone, addr: r.sender.addr, memo: r.memoText, ...(r.tail ? { tail: r.tail } : {}) }); note(r.tail ? 'AI가 읽은 값이에요(품목 뒤에 붙일 말 포함 — 확인해 주세요)' : 'AI가 읽은 값이에요'); }
                else note('AI는 보내는이를 바꿔 달라는 글이 아니라고 봤어요');
            } else if (cd.type === 'memo-edit') {
                const cur = st.draft.get(cd.id);
                if (cur && String(cur.memo || '') !== String(cd.memo.rest || '') && String(cur.memo || '') !== r.memoText) { note('AI가 읽은 값은 넣지 않았어요(직접 고쳐 적은 글이 있어요)'); return; }
                if (closable) { st.draft.delete(cd.id); tag({ use: true, memo: r.memoText }); }
                else { st.draft.set(cd.id, { memo: r.memoText, ...(r.tail ? { tail: r.tail } : {}) }); note(r.tail ? 'AI가 읽은 값이에요(품목 뒤에 붙일 말 포함 — 확인해 주세요)' : 'AI가 읽은 값이에요'); }
            }
        });
        st.out = null; $('fo-result').hidden = true; st.skipDraftSave = true; renderSummaryOnly();
        if (focus) { const el = [...document.querySelectorAll('#fo-cards .fo-card')].find(c => c.dataset.id === focus.id); const f = el && el.querySelector(`[data-f="${focus.f}"]`); if (f) { f.focus({ preventScroll: true }); try { f.setSelectionRange(focus.a, focus.b); } catch (_) { } } }
    }
    document.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('#fo-ai-read, #fo-ai-stop'); if (!b) return;
        if (b.id === 'fo-ai-read') aiRead(false); else { st.ai.running = false; st.ai.failed = true; st.ai.note ='AI 읽기를 그만뒀어요. 카드로 직접 확인해 주세요.'; syncAi(); syncMake(); syncInput(); }
    });

    // ── #525(대표 GO 10/5) 클코와 대화하는 칸 — 말로 고치기 · 제주 건 · 정리 기록 ─────────────────────────
    //   직원이 대화 칸에 직접 적은 말만 주문을 바꾼다(받는 분·주소·수량·품목 이름 포함). AI가 손님 메모만 보고 스스로 그 칸들을 바꾸는 일은 없다.
    //   AI에게는 지시 글과 「후보 주문」의 이름·옵션·수량·메모·동호수·거래처·상태만 보낸다(주소 전체·전화는 보내지 않는다).
    //   돌아온 actions 는 화면이 검사한다(주소·받는 분 글자는 사람이 적은 글 안에 있어야 함 · 품목 이름은 단가표에 있는 이름만) → 「바뀔 내용」을 보여 주고 [적용]을 눌러야 바뀐다.
    st.patch = new Map(); st.chat = { log: [], cand: [], pending: null, running: false, id: 0, t0: 0 }; st.logId = 0;
    const LILAC = 'E4DFEC';   // 말로 바꾼 칸(연보라) — 연파랑(보내는이)·연노랑(확인)·연주황(사이즈)·노랑(제주)과 겹치지 않게
    function patchStyle(base) { return Object.assign({}, base || {}, { fill: { patternType: 'solid', fgColor: { rgb: LILAC } } }); }
    // 품목 뒤 「요청 꼬리」(「 17과로!」 — v2 의 「 S사이즈로!」와 같은 꼴). 품목 이름은 그대로 두고 옵션 칸 끝에만 붙인다 → 거래처 찾기는 꼬리를 떼고, 수량 표에는 따로 한 줄(주황).
    //   tailOf: 대화로 시킨 것(st.patch.tail — '' = 꼬리 떼기)이 먼저, 없으면 카드에서 사람이 [이대로 넣기]로 확인한 것. undefined = 손대지 않음.
    const inCatalog = n => Object.values(st.byPartner || {}).some(a => (a || []).includes(n));
    const normTail = t => { const x = String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, 80); return x && !x.endsWith('!') ? x + '!' : x; };
    const withTail = (name, t) => core().stripTail(name, inCatalog) + (t ? ' ' + t : '');
    function tailOf(e) {
        const k = keyOf(e), p = st.patch.get(k); if (p && p.tail != null) return p.tail;
        if (st.sizeTail && st.sizeTail.has(k)) return st.sizeTail.get(k);   // #548 직원이 메모 줄에 적은 사이즈(손님 메모로 붙은 꼬리보다 먼저)
        for (const id of [st.memoCard && st.memoCard.get(k), st.sambCard && st.sambCard.get(k)]) { const d = id ? liveDec(id) : null; if (d && d.use && d.tail) return normTail(d.tail); }
        return undefined;
    }
    function optOf(e) { const p = st.patch.get(keyOf(e)), base = String((p && p.opt != null ? p.opt : e.conv['옵션정보']) || ''), t = tailOf(e); return t === undefined ? base : withTail(base, t); }
    const addrOf = e => { const p = st.patch.get(keyOf(e)); return String((p && p.addr != null ? p.addr : (e.conv['배송지'] || rawOf(e)['통합배송지'])) || ''); };
    const qtyNow = e => { const p = st.patch.get(keyOf(e)); return p && p.qty != null ? p.qty : qtyOf(e); };
    const whoOf = e => { const b = buyerName(e), r = String(e.conv['수취인명'] || ''); return b + (r && r !== b ? ' → ' + r : ''); };
    const partnerShort = opt => { const c = core(), p = c.partnerOf(opt, st.byPartner || {}) || st.dec.get('pick:' + opt) || null; return p ? c.shortPartner(p) : ''; };
    // 제주도 배송(주소가 「제주」로 시작 — 택배사 양식에서 맨 아래 노란 줄과 같은 기준) 거래처별 건수
    function jejuCount() {
        const c = core(), m = new Map(); if (!c || !st.byPartner) return m;
        Object.keys(st.byPartner).forEach(p => m.set(c.shortPartner(p), 0));
        const add = (opt, addr) => { if (!c.isJeju(addr)) return; const k = partnerShort(opt) || '거래처 미정'; m.set(k, (m.get(k) || 0) + 1); };
        S().merged.forEach(e => { if (goingOut(e)) add(optOf(e), addrOf(e)); });
        (st.cash && st.cash.ok ? st.cash.rows : []).forEach(r => add(String(r.opt || ''), String((r.cells || [])[8] || '')));
        return m;
    }
    function jejuText() { const m = jejuCount(); return m.size ? [...m].map(([k, n]) => `${k} ${n ? n + '건' : '없음'}`).join(' · ') : '없음'; }
    // 말로 바꾼 것 목록 — screen = 화면용(값 포함) · log = 정리 기록용(주소 글자는 넣지 않는다)
    function patchItems() {
        const byKey = new Map(S().merged.map(e => [keyOf(e), e])), out = [], groups = new Map();
        st.patch.forEach((p, k) => {
            const e = byKey.get(k); if (!e) return; const who = whoOf(e), b = buyerName(e);
            const add = (kind, screen, log) => out.push({ key: k, kind, screen: `${kind}: ${screen}`, log });
            if (p.addr != null) add('주소 변경', who, b);   // 목록·정리 기록에는 이름만(주소 글자는 넣지 않는다 — 바뀐 주소는 결과 파일의 연보라 칸에서 본다)
            if (p.recv != null) add('받는 분 변경', `${who} → ${p.recv}`, `${b}: ${e.conv['수취인명'] || ''} → ${p.recv}`);
            if (p.qty != null) add('수량 변경', `${who} — ${qtyOf(e)} → ${p.qty}박스`, `${b}: ${qtyOf(e)} → ${p.qty}박스`);
            if (p.optAll) { const g = groups.get(p.optAll) || []; g.push(k); groups.set(p.optAll, g); }
            else if (p.opt != null) add('품목 이름 변경', `${who} — ${e.conv['옵션정보']} → ${p.opt}`, `${e.conv['옵션정보']} → ${p.opt}`);
            if (p.tail != null) add('품목 뒤 요청', `${who} — ${p.tail ? '「' + p.tail + '」' : '꼬리 뗌'}`, `${b}: ${p.tail || '꼬리 뗌'}`);
            if (p.sender && p.sender.name) add('보내는이 변경', `${who} — ${p.sender.name} 드림`, `${b}: ${p.sender.name} 드림`);
            if (p.memo != null) add('배송메세지 변경', `${who} — 「${p.memo || '기본 문구'}」`, b);
            if (p.excl === true) add('오늘 제외', who, b);
            if (p.excl === false) add('오늘 발송으로', who, b);
        });
        // #535: 품목 통째로 바꾼 묶음은 한 줄로(되돌리기 = 그 묶음 전부)
        groups.forEach((ks, gid) => { const g = (st.optAll && st.optAll.get(gid)) || { from: '', to: '' }; out.push({ key: 'all:' + gid, kind: '품목 통째로 변경', screen: `품목 통째로 변경 ${ks.length}건: ${g.from} → ${g.to}`, log: `${g.from} → ${g.to} (${ks.length}건)` }); });
        return out;
    }
    const patchLines = () => patchItems().map(x => x.screen);
    function renderPatches() {
        const el = $('fo-patches'); if (!el) return; const items = patchItems();
        const keys = [...new Set(items.map(x => x.key))];
        el.innerHTML = items.length ? `<b>말로 바꾼 것 ${items.length}건</b><ul>${keys.map(k => `<li><span>${items.filter(x => x.key === k).map(x => esc(x.screen)).join(' · ')}</span><button type="button" class="fo-btn sm" data-unpatch="${esc(k)}">되돌리기</button></li>`).join('')}</ul>` : '';
    }
    // #526: 에이전트 오피스 「내 지시」 대화 보기와 같은 모양(시간 표시는 없음) — 내 말 = 오른쪽 연한 인디고 말풍선 · 클코 답 = 왼쪽 인디고 띠 카드(「클코 답변」 배지 · 본문 · 아래 버튼 띠)
    function renderChat() {
        const el = $('fo-chat-log'); if (!el) return; const C = st.chat;
        const ai = (inner, acts, attr) => `<div class="fo-bub ai"${attr || ''}><div class="fo-a${acts ? ' has-acts' : ''}"><span class="fo-a-label">클코 답변</span>${inner}</div>${acts || ''}</div>`;
        el.innerHTML = C.log.map((m, i) => {
            if (m.preview) {
                const live = C.pending && C.pending.at === i;
                // #528 주소 줄: 도로명 주소 검색 결과(확인됨 / 후보 고르기 / 못 찾음 → 그대로 넣을지 묻기)
                const addrHtml = (x, idx) => { const Q = x.addrQ; if (!Q) return ''; const on = v => (String(Q.sel) === String(v) ? ' on' : ''), btn = (v, t) => (live ? `<button type="button" class="fo-btn sm fo-addr-opt${on(v)}" data-addr-pick="${idx}:${v}" aria-pressed="${String(Q.sel) === String(v)}">${esc(t)}</button>` : '');
                    if (Q.sel === 'skip') return `<div class="fo-addr" data-addr-state="skip"><span class="fo-addr-note">이 주소는 넣지 않아요.</span></div>`;
                    if (Q.state === 'one') return `<div class="fo-addr" data-addr-state="one"><span class="fo-addr-ok">도로명 주소 확인됨</span></div>`;
                    if (Q.state === 'multi') return `<div class="fo-addr" data-addr-state="multi"><span class="fo-addr-note">비슷한 주소가 여러 개예요. 맞는 것을 골라 주세요.</span><div class="fo-addr-opts">${Q.cands.map((c, k) => btn(k, c.part + (c.bd ? ` (${c.bd})` : ''))).join('')}${btn('raw', '적은 그대로 넣기')}</div></div>`;
                    return `<div class="fo-addr" data-addr-state="${Q.state}"><span class="fo-addr-note">${Q.state === 'fail' ? `주소 검색을 하지 못했어요${Q.err ? `(${esc(Q.err)})` : ''}` : '주소를 찾지 못했어요'} — 적은 글자 그대로 넣을까요?</span><div class="fo-addr-opts">${btn('raw', '그대로 넣기')}${btn('skip', '취소')}</div></div>`; };
                const list = `<ul class="fo-a-list">${m.preview.map((x, idx) => `<li class="${x.ok ? '' : 'bad'}">${esc(x.line)}${x.ok || (x.addrQ && x.addrQ.sel === 'skip') ? '' : ' — ' + esc(x.why)}${addrHtml(x, idx)}</li>`).join('')}</ul>`;
                const need = live && m.preview.some(addrNeedsPick);
                const acts = `<div class="fo-a-acts">${live ? `<button type="button" class="fo-btn sm primary" data-chat="apply"${need ? ' disabled' : ''}>적용</button><button type="button" class="fo-btn sm" data-chat="cancel">취소</button>${need ? '<span class="fo-done">주소를 먼저 골라 주세요</span>' : ''}` : `<span class="fo-done">${esc(m.state || '')}</span>`}</div>`;
                return ai(`<p>${esc(m.text)}</p>${list}`, acts, ` data-chat-preview="${live ? 'open' : 'closed'}"`);
            }
            return m.who === 'me' ? `<div class="fo-bub me"><p>${esc(m.text)}</p></div>` : ai(`<p>${esc(m.text)}</p>`);
        }).join('') + (C.running ? `<div class="fo-bub ai live" data-chat-live="1"><div class="fo-a"><span class="fo-a-label">클코 답변 · 쓰는 중</span><p id="fo-chat-live">${esc(C.live || '클코에게 물어보는 중이에요')}</p></div></div>` : '');
        el.hidden = !el.innerHTML;
        const last = el.lastElementChild; if (last && typeof last.scrollIntoView === 'function' && C.log.length) last.scrollIntoView({ block: 'nearest' });
    }
    const chatLive = t => { st.chat.live = t; const el = $('fo-chat-live'); if (el) el.textContent = t; else renderChat(); };
    function syncChat() {
        const sec = $('fo-chat'); if (!sec) return; const C = st.chat;
        sec.hidden = !(st.loaded && (st.phase === 'review' || st.phase === 'result'));
        $('fo-chat-send').disabled = C.running || st.busy || !st.judged || !!C.pending;
        $('fo-chat-input').disabled = C.running;
        $('fo-chat-stop').hidden = !C.running;
        $('fo-chat-log').hidden = !C.log.length && !C.running;   // 대화가 없으면 빈 대화 틀을 보이지 않는다
        renderPatches();
    }
    const chatSay = (who, text, extra) => { st.chat.log.push(Object.assign({ who, text: String(text || '') }, extra || {})); if (st.chat.log.length > 60) st.chat.log.splice(0, st.chat.log.length - 60); renderChat(); return st.chat.log.length - 1; };
    const sq = s => String(s == null ? '' : s).replace(/\s+/g, '');
    const meText = () => sq(st.chat.log.filter(m => m.who === 'me').map(m => m.text).join('\n'));
    // 정리 파일 줄로 읽히는 줄(휴대폰 번호 · 상품주문번호 · 자사몰 주문번호가 든 줄)은 규칙이 처리한다 — 메모 칸에 쌓고 다시 판정
    const LINEISH = /01\d[-.\s]?\d{3,4}[-.\s]?\d{4}|\d{16,}|\d{8}-\d{7}/;
    const CHAT_TALK = /해\s*줘|해\s*주세요|해\s*줄래|바꿔|변경해|수정|확인|표시|맞는지|맞아|됐어|되었|있어\s*\??|인지|빼\s*줘|넣어\s*줘|붙여|떼\s*줘|지워|알려|\d+\s*과\s*로|사이즈로|\?/;
    const CHAT_PHONE = /01\d[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
    const chatMask = s => String(s || '').replace(CHAT_PHONE, m => '(전화 끝 ' + m.replace(/\D/g, '').slice(-4) + ')');   // 클코에게 보내는 글에는 전화번호를 끝 4자리만 남긴다(주문은 화면이 찾는다)
    const CHAT_STOP = /^(건|주소|박스|수량|품목|이름|오늘|발송|제외|제주|바꿔줘|바꿔|변경|빼줘|있어|있나요|없어|으로|해줘|주문|고객|보내는이|받는|사람|배송|메세지|미매칭)$/;
    // 지시 글에서 후보 주문을 뽑는다: 구매자·수취인 이름 · 전화 끝 4자리 · 「미매칭」 · 품목 낱말
    function chatCandidates(text) {
        const s = S(), t = sq(text), out = [], seen = new Set();
        const push = e => { const k = keyOf(e); if (!seen.has(k)) { seen.add(k); out.push(e); } };
        // #533: 「끝 4자리」 대조는 전화번호를 통째로 적은 부분을 지운 글에서만 — 「010-2222-3333」의 가운데 2222 가 끝 번호 2222 인 다른 주문을 끌어오던 것
        const four = (String(text).replace(CHAT_PHONE, ' ').match(/(?<!\d)\d{4}(?!\d)/g) || []);
        const fullTels = (String(text).match(CHAT_PHONE) || []).map(x => x.replace(/\D/g, ''));
        s.merged.forEach(e => {
            const b = sq(buyerName(e)), r = sq(e.conv['수취인명']);
            if (fullTels.length && [buyerTel(e), digitsOf(e.conv['수취인연락처1']), digitsOf(e.conv['수취인연락처2'])].some(x => x && fullTels.includes(x))) return push(e);   // #527 번호를 통째로 적은 경우(하이픈 없이 붙여 적어도)
            if ((b.length >= 2 && t.includes(b)) || (r.length >= 2 && t.includes(r))) return push(e);
            const tails = [buyerTel(e), digitsOf(e.conv['수취인연락처1'])].filter(x => x.length >= 8).map(x => x.slice(-4));
            if (four.some(f => tails.includes(f))) push(e);
        });
        if (!out.length && /미매칭/.test(text)) s.merged.forEach(e => { const o = optOf(e); if (/^\[미매칭\]/.test(o) || !partnerShort(o)) push(e); });
        if (!out.length) {
            const words = String(text).split(/[\s,.:;!?「」"'()~]+/).map(w => w.replace(/(으로|로|을|를|이|가|은|는|에|도|만)$/, '')).filter(w => /^[가-힣A-Za-z0-9]{2,}$/.test(w) && /[가-힣]/.test(w) && !CHAT_STOP.test(w));
            const hit = s.merged.filter(e => words.some(w => optOf(e).includes(w)));
            if (hit.length && hit.length <= 80) hit.forEach(push);
        }
        return out.slice(0, 80).map((e, i) => ({ n: i + 1, key: keyOf(e) }));
    }
    // #535: 품목(꼬리 뗀 이름)별 건수 — 「○○ 전부 △△로」(optall)에서 클코가 from 을 고를 때 본다. 택배사 양식으로 나가는 주문만(현금파일 행은 빼고).
    const baseName = e => core().stripTail(optOf(e), inCatalog);
    function itemCounts() {
        const m = new Map(); S().merged.filter(goingOut).forEach(e => { const k = baseName(e), x = m.get(k) || { name: k, n: 0, q: 0 }; x.n++; x.q += qtyNow(e); m.set(k, x); });
        return [...m.values()].sort((a, b) => b.n - a.n);
    }
    // #535 「품목 통째로 바꾸기」: from 품목으로 나가는 주문 전부를 to 로(꼬리는 그대로). 주문을 클코에게 다 보내지 않고 화면이 직접 찾는다. 현금파일 행은 손대지 않는다.
    function optAllItem(a, names) {
        const c = core(), from = String((a && a.from) || '').trim(), to = String((a && a.to) || '').trim(), head = '품목 통째로 바꾸기';
        const bad = why => ({ ok: false, line: `${head}: ${from || '(이름 없음)'} → ${to || '(이름 없음)'}`, why });
        if (!names.has(from) || !names.has(to)) return bad('품목별 금액(단가표)에 없는 이름이에요');
        if (from === to) return bad('같은 품목이에요');
        const hit = S().merged.filter(e => goingOut(e) && baseName(e) === from);
        if (!hit.length) return bad('오늘 택배사 양식으로 나가는 주문 중에 그 품목이 없어요');
        const boxes = hit.reduce((t, e) => t + qtyNow(e), 0), pf = partnerShort(from), pt = partnerShort(to);
        const cashN = (st.cash && st.cash.ok ? st.cash.rows : []).filter(r => c.stripTail(String(r.opt || ''), inCatalog) === from).length;
        const sets = hit.map(e => { const cur = optOf(e); return { key: keyOf(e), opt: to + cur.slice(baseName(e).length) }; });   // 꼬리(「 S사이즈로!」 등)는 그대로 붙여 둔다
        return { ok: true, all: true, from, to, sets, line: `${head}: ${from} ${hit.length}건(${boxes}박스) → ${to}${pf !== pt ? ` · 거래처 ${pf || '미정'} → ${pt || '미정'}` : ''}${cashN ? ` · 현금파일에 같은 품목 ${cashN}행은 그대로예요` : ''}` };
    }
    function chatSummary() {
        const s = S(), m = s.merged, going = m.filter(goingOut), c = core();
        const by = new Map(); going.forEach(e => { const k = partnerShort(optOf(e)) || '거래처 미정'; const x = by.get(k) || { n: 0, q: 0 }; x.n++; x.q += qtyNow(e); by.set(k, x); });
        (st.cash && st.cash.ok ? st.cash.rows : []).forEach(r => { const k = partnerShort(String(r.opt || '')) || '거래처 미정'; const x = by.get(k) || { n: 0, q: 0 }; x.n++; x.q += Number(r.qty) || 0; by.set(k, x); });
        // #526: 「미매칭」 = 옵션 글자가 「[미매칭]」으로 시작(단가표에 없는 이름) 또는 거래처 미정. 카드에서 거래처를 골랐어도 이름은 여전히 미매칭이다(실사용에서 0건으로 세어 AI가 못 찾았다고 답함)
        const unAll = going.filter(e => /^\[미매칭\]/.test(optOf(e)) || !partnerShort(optOf(e))), un = unAll.length, unPicked = unAll.filter(e => !!partnerShort(optOf(e))).length;
        return [`기준 발송일 ${s.shipDate}`, `주문 ${m.length}건 · 택배사 양식 ${going.length}건 · 입력삭제 ${m.filter(e => e.individual).length}건 · 오늘 안 나감 ${m.filter(e => !e.individual && e.excluded).length}건 · 현금파일 ${st.cash && st.cash.ok ? st.cash.rows.length : 0}행`,
            `거래처별: ${[...by].map(([k, x]) => `${k} ${x.n}건(${x.q}박스)`).join(' · ') || '없음'}`, `제주도 배송: ${jejuText()}`, `단가표에 없는 품목 이름(미매칭) ${un}건${unPicked ? `(그중 ${unPicked}건은 거래처만 골라 둠 · 이름은 그대로 미매칭)` : ''}`, `남은 확인 카드 ${pending().length}건 · 말로 바꾼 것 ${patchItems().length}건`, `품목별(택배사 양식으로 나가는 주문 · 꼬리 뗀 이름): ${itemCounts().map(x => `「${x.name}」 ${x.n}건(${x.q}박스)`).join(' · ') || '없음'}`].filter(Boolean).join('\n').slice(0, 4000);
    }
    async function chatSend() {
        const el = $('fo-chat-input'), msg = $('fo-chat-msg'), C = st.chat; const text = String(el.value || '').replace(/\r/g, '').trim();
        if (!text || C.running || st.busy || C.pending) return;
        if (!st.judged || st.stale) { msg.textContent = '위의 [다시 판정]을 먼저 눌러 주세요.'; return; }
        msg.textContent = ''; el.value = '';
        // #527(대표 실물 10/5 「010-… 주문건 황금향 3키로 선물용 맞는지 확인하고 10과로! 로 표시해줘」가 정리 줄로 읽혀 클코에게 안 갔다):
        //   번호가 든 줄이라도 「해줘·바꿔·수정·확인·표시·맞는지·○과로」 같은 시키는 말이 있으면 정리 줄이 아니라 말이다(번호는 그 주문을 찾는 데 쓴다).
        const isRule = l => LINEISH.test(l) && !CHAT_TALK.test(l);
        const lines = text.split('\n'), rule = lines.filter(isRule), talk = lines.filter(l => !isRule(l)).join('\n').trim();
        chatSay('me', text);
        if (rule.length) {
            if (st.ai.running) { chatSay('ai', 'AI가 메모를 읽는 중이라 정리 줄을 아직 못 넣었어요. 읽기가 끝난 뒤 다시 보내 주세요.'); return; }
            const had = st.phase === 'result' && st.files.length > 0, memo = $('fo-memo');
            memo.value = (memo.value.trim() ? memo.value.replace(/\s+$/, '') + '\n' : '') + rule.join('\n');
            await run(judge);
            { const rc = chatCandidates(rule.join('\n')); if (rc.length) st.chat.cand = rc; }   // #527 바로 뒤에 「이건 …」이라고 하면 방금 정리 줄의 주문을 가리킨다
            chatSay('ai', `정리 줄 ${rule.length}줄을 메모 칸에 넣고 다시 판정했어요.${pending().length ? ` 확인할 카드가 ${pending().length}건 있어요.` : ''}`);
            if (had) await remake();
        }
        if (talk) await chatAsk(talk);
    }
    async function remake() {   // 파일이 이미 만들어져 있었으면 고친 내용으로 다시 만든다(남은 카드가 있거나 AI가 읽는 중이면 안내만)
        for (let i = 0; i < 1200 && st.ai.running; i++) await sleep(500);
        if (pending().length) { $('fo-chat-msg').textContent = '확인할 카드가 남아 있어요. 처리한 뒤 [파일 만들기]를 눌러 주세요.'; return; }
        await run(make);
        if (st.phase === 'result' && st.out) chatSay('ai', '고친 내용으로 파일을 다시 만들었어요.');
    }
    async function chatAsk(text) {
        const C = st.chat, msg = $('fo-chat-msg'), s = S();
        for (let i = 0; i < 1800 && st.ai.running; i++) { msg.textContent = 'AI가 손님 메모를 읽는 중이에요. 끝나면 이어서 물어볼게요.'; await sleep(500); }
        const cand = chatCandidates(text); if (cand.length) C.cand = cand;   // 후보를 못 찾으면 앞서 보여 준 번호를 그대로 쓴다(「2번으로」처럼 이어서 답할 때)
        const byKey = new Map(s.merged.map(e => [keyOf(e), e]));
        const orders = C.cand.map(c => { const e = byKey.get(c.key); return e ? { n: c.n, buyer: buyerName(e), recv: String(e.conv['수취인명'] || ''), opt: optOf(e), qty: qtyNow(e), memo: String(e.conv['배송메세지'] || '').trim().slice(0, 300), unit: unitOf(e), partner: partnerShort(optOf(e)) || '미정', state: e.individual ? '입력삭제' : e.excluded ? '오늘 안 나감' : '오늘 발송' } : null; }).filter(Boolean);
        const catalog = {}; let left = 200; Object.entries(st.byPartner || {}).forEach(([p, names]) => { const take = (names || []).slice(0, Math.max(left, 0)); left -= take.length; catalog[p] = take; });
        const history = C.log.slice(0, -1).filter(m => !m.preview).slice(-6).map(m => ({ who: m.who === 'me' ? 'me' : 'ai', text: chatMask(m.text).slice(0, 300) }));
        C.running = true; C.t0 = Date.now(); C.id = 0; C.live = '클코에게 물어보는 중이에요'; msg.textContent = ''; syncChat(); renderChat();
        try {
            const r = await window.api('/api/agent-office/final-order/memo-read', 'POST', { kind: 'chat', shipDate: s.shipDate, realToday: st.cal.realToday, shipDays: st.cal.shipDays, ask: chatMask(text).slice(0, 1500), orders, catalog, summary: chatSummary(), history });
            if (!r || !r.ok || !r.id) throw new Error((r && (r.message || r.error)) || '요청을 올리지 못했어요');
            C.id = r.id;
            for (;;) {
                await sleep(2000);
                if (!C.running) return;
                const q = await window.api('/api/agent-office/final-order/memo-read/' + C.id), sec = Math.round((Date.now() - C.t0) / 1000);
                if (q && q.state === 'done') { await chatResult(q.data || {}); break; }
                if (q && q.state === 'fail') throw new Error(q.message || '클코가 처리하지 못했어요');
                if (q && q.status === '대기' && sec > 40) throw new Error('지금은 말로 고치기를 쓸 수 없어요(대표 PC의 창구가 꺼져 있어요) — 정리 줄과 카드로 진행하세요');
                if (sec > 600) throw new Error('10분이 지나도 답이 없어요');
                chatLive(`클코가 읽고 있어요 · ${sec}초`);
            }
            msg.textContent = '';
        } catch (err) { msg.textContent = ''; chatSay('ai', '⚠️ ' + (err && err.message ? err.message : err)); }
        finally {
            const id = C.id; C.running = false; C.id = 0; renderChat();
            if (id) { try { await window.api('/api/agent-office/final-order/memo-read/' + id, 'DELETE'); } catch (_) { } }   // 대화 글을 서버에 남기지 않는다
            syncChat();
        }
    }
    // 돌아온 actions 검사 → 「바뀔 내용」 미리 보기(적용은 사람이 눌러야)
    async function chatResult(data) {
        const C = st.chat, s = S(), byKey = new Map(s.merged.map(e => [keyOf(e), e])), mine = meText();
        const names = new Set(); Object.values(st.byPartner || {}).forEach(a => (a || []).forEach(n => names.add(n)));
        const inMine = v => { const x = sq(v); return x.length >= 1 && mine.includes(x); };
        const items = (Array.isArray(data.actions) ? data.actions : []).slice(0, 80).map(a => {
            if (a && a.op === 'optall') return optAllItem(a, names);
            const c = C.cand.find(x => x.n === Number(a && a.n)), e = c ? byKey.get(c.key) : null;
            if (!a || !e) return { ok: false, line: `${a && a.n != null ? a.n + '번' : '주문'}`, why: '어느 주문인지 찾지 못했어요' };
            const who = `${c.n}. ${whoOf(e)}`, bad = (line, why) => ({ ok: false, line: `${who} — ${line}`, why }), good = (line, set) => ({ ok: true, key: c.key, line: `${who} — ${line}`, set });
            const p = st.patch.get(c.key) || {};
            switch (a.op) {
                case 'exclude': return e.individual ? bad('오늘 제외', '입력삭제 주문이에요') : good('오늘 제외(택배사·스토어 파일에서 빠져요)', { excl: true });
                case 'include': return e.individual ? bad('오늘 발송으로', '입력삭제 주문이에요') : good('오늘 발송으로', { excl: false });
                case 'indiv': return buyerTel(e) ? good('입력삭제로(이 구매자의 주문이 택배사 양식에서 빠져요 · 현금파일에 주소 줄이 있어야 해요)', { indiv: true }) : bad('입력삭제로', '구매자 번호가 없어 정리 줄을 만들 수 없어요');
                // #528: 주소 글자는 이 대화에서 사람이 적은 글, 또는 그 주문의 손님 배송메세지 안에 그대로 있어야 한다(「메모에 적힌 주소로 바꿔줘」). 통과하면 도로명 주소 검색으로 확인한다(아래 addrLookup).
                case 'addr': { const t = String(a.text || '').trim(), inMemo = sq(t).length >= 5 && sq(e.conv['배송메세지']).includes(sq(t));
                    if (!(sq(t).length >= 5 && (inMine(t) || inMemo))) return bad(`주소 → 「${t}」`, '주소 글자를 다시 적어 주세요(적어 주신 글이나 손님 메모에 그대로 있는 주소만 넣어요)');
                    return Object.assign(good(`주소: 「${addrOf(e)}」 → 「${t}」`, { addr: t }), { addrQ: { raw: t, head: `${who} — 주소: 「${addrOf(e)}」 → `, state: 'wait', cands: [], sel: null } }); }
                case 'recv': { const t = String(a.name || '').trim(); return t && inMine(t) ? good(`받는 분: ${e.conv['수취인명'] || ''} → ${t}`, { recv: t }) : bad(`받는 분 → ${t}`, '받는 분 이름을 다시 적어 주세요'); }
                case 'qty': { const q = Number(a.qty); return Number.isInteger(q) && q >= 1 && q <= 999 ? good(`수량: ${qtyNow(e)} → ${q}박스`, { qty: q }) : bad(`수량 → ${a.qty}`, '수량은 1~999 사이 숫자여야 해요'); }
                case 'opt': { const t = String(a.name || '').trim(); return names.has(t) ? good(`품목 이름: ${optOf(e)} → ${t}`, { opt: t }) : bad(`품목 이름 → ${t}`, '품목별 금액(단가표)에 없는 이름이에요'); }
                case 'sender': { const t = String(a.name || '').trim().replace(/\s*(드림|올림)$/, ''), ph = String(a.phone || '').trim(), ad = String(a.addr || '').trim();
                    if (!t || !inMine(t)) return bad(`보내는이 → ${t}`, '보내는 분 이름을 다시 적어 주세요');
                    if ((ph && !sq(st.chat.log.filter(m => m.who === 'me').map(m => m.text).join(' ')).replace(/\D/g, '').includes(digitsOf(ph))) || (ad && !inMine(ad))) return bad(`보내는이 → ${t}`, '보내는 분 번호·주소를 다시 적어 주세요');
                    return good(`보내는이: ${t} 드림${ph ? ' · ' + ph : ''}${ad ? ' · 주소 ' + ad : ''}`, { sender: { name: t, phone: ph, addr: ad } }); }
                case 'memo': { const t = String(a.text == null ? '' : a.text).replace(/\r/g, '').trim(), orig = sq(e.conv['배송메세지']); return t === '' || inMine(t) || orig.includes(sq(t)) ? good(`배송메세지: 「${p.memo != null ? p.memo : String(e.conv['배송메세지'] || '').trim() || '(없음)'}」 → 「${t || '기본 문구'}」`, { memo: t }) : bad(`배송메세지 → 「${t}」`, '배송메세지 글을 다시 적어 주세요'); }
                case 'tail': { const raw = String(a.text == null ? '' : a.text); if (/[\r\n]/.test(raw) || raw.trim().length > 80) return bad('품목 뒤에 붙일 말', '한 줄 80자까지만 붙일 수 있어요');
                    const t = normTail(raw), cur = optOf(e);
                    // #553(대표 10/6 실사고): 사이즈(2S·S·M·L) 꼬리는 귤 품목에만 — 황금향·레몬·키위는 사이즈로 지정하지 않는다(황금향은 과수 지정). 같은 손님의 귤 + 황금향 두 주문에 한꺼번에 붙던 것을 화면에서 막는다
                    if (t && /^(?:[2-4]?[SML]|2?XL)\s*(?:사이즈)?(?:로)?!?$/i.test(t.replace(/\s/g, '')) && !/귤/.test(String(e.conv['옵션정보'] || ''))) return bad(`사이즈 지정: ${cur}`, '이 품목은 사이즈(2S·S·M)로 지정하지 않아요 — 귤만 사이즈 지정이에요(황금향은 과수로)');
                    return t ? good(`품목 뒤에 붙일 말: ${cur} → ${withTail(cur, t)}`, { tail: t }) : good(`품목 뒤 꼬리 떼기: ${cur} → ${withTail(cur, '')}`, { tail: '' }); }
                default: return bad(String(a.op || ''), '모르는 지시예요');
            }
        });
        const reply = String(data.reply || '').trim();
        if (!items.length) { chatSay('ai', reply || '바꿀 것이 없어요.'); return; }
        // #528: 주소는 도로명 주소 검색으로 확인한 뒤에 미리 보기를 띄운다(1건 = 그 주소로 · 여러 건 = 고르기 · 못 찾음 = 물어봄 — 조용히 그대로 넣지 않는다)
        const qs = items.filter(x => x.ok && x.addrQ);
        if (qs.length) { chatLive('주소를 도로명 주소로 찾는 중이에요'); for (const x of qs) { await addrLookup(x); if (!C.running) return; } }
        const okN = items.filter(x => x.ok).length;
        const at = chatSay('ai', (reply ? reply + '\n' : '') + (okN ? `바뀔 내용 ${okN}건이에요. 맞으면 [적용]을 눌러 주세요.` : '바꿀 수 있는 것이 없어요.'), { preview: items, state: okN ? '' : '적용할 것 없음' });
        if (okN) { C.pending = { at, items }; renderChat(); }
    }
    // 도로명 주소 검색(주문 정리기 #395·#444 와 같은 통로·같은 규칙): 검색어/상세 나누기 → 원문 그대로 검색 → 정확히 1건(또는 검색한 도로명+번호와 정확히 같은 후보가 1건)일 때만 확정.
    //   넣는 글자 = 검색 결과의 도로명 주소(시·도 전체 이름) + 빈칸 + 상세(적은 그대로 — 정리·축약 없음). 우편번호는 넣지 않는다.
    const addrText = (j, detail) => String(j.roadAddrPart1 || '').trim() + (detail ? ' ' + detail : '');
    async function addrLookup(x) {
        const Q = x.addrQ, oo = window.__ooTest;
        const setOne = j => { Q.state = 'one'; Q.sel = 'one'; Q.road = addrText(j, Q.detail); x.set.addr = Q.road; x.line = Q.head + `「${Q.road}」`; };
        try {
            if (!oo || typeof oo.splitAddr !== 'function') throw new Error('주소 검색 도구를 불러오지 못했어요');
            const [body, detail] = oo.splitAddr(Q.raw); Q.detail = detail || '';
            const tries = [body]; const sb = oo.searchBody(body); if (sb && sb !== body) tries.push(sb);
            let list = null, fallback = false, err = '';
            for (let t = 0; t < tries.length && !list; t++) {
                const d = await window.api('/api/agent-office/juso?keyword=' + encodeURIComponent(tries[t]));
                if (d && d.error) { err = d.error === 'NOKEY' ? '주소 검색 승인키가 서버에 없어요' : String(d.error); continue; }
                const c = d && d.results && d.results.common; if (!c) continue;
                if (c.errorCode !== '0') { err = c.errorMessage || c.errorCode; continue; }
                const ls = d.results.juso || []; if (ls.length) { list = ls; fallback = t > 0; }
            }
            if (!list) { Q.state = err ? 'fail' : 'none'; Q.err = err; return; }
            const uniq = [...new Set(list.map(j => j.roadAddrPart1 + '|' + j.zipNo))];
            const ex = !fallback && uniq.length > 1 ? oo.exactMatches(tries[0], list, Q.detail) : [];
            if (!fallback && (list.length === 1 || uniq.length === 1)) setOne(list[0]);
            else if (ex.length === 1) setOne(ex[0]);
            else { Q.state = 'multi'; Q.cands = list.slice(0, 7).map(j => ({ road: addrText(j, Q.detail), part: String(j.roadAddrPart1 || ''), bd: String(j.bdNm || ''), jibun: String(j.jibunAddr || '') })); }
        } catch (e) { Q.state = 'fail'; Q.err = (e && e.message) || String(e); }
    }
    // 미리 보기에서 주소 고르기: 'raw' = 적은 그대로 · 'skip' = 이 주소는 넣지 않음 · 숫자 = 후보 번호
    function addrPick(i, v) {
        const P = st.chat.pending; if (!P) return; const x = P.items[i]; if (!x || !x.addrQ) return; const Q = x.addrQ;
        Q.sel = v; x.ok = v !== 'skip';
        const text = v === 'raw' ? Q.raw : v === 'skip' ? null : (Q.cands[Number(v)] || {}).road;
        if (text) { x.set.addr = text; x.line = Q.head + `「${text}」`; }
        if (!P.items.some(y => y.ok)) { st.chat.log[P.at].state = '취소함'; st.chat.pending = null; syncChat(); }
        renderChat();
    }
    const addrNeedsPick = x => !!(x.addrQ && x.ok && !x.addrQ.sel);
    async function chatApply() {
        const C = st.chat, P = C.pending; if (!P || st.busy) return;
        const had = st.phase === 'result' && st.files.length > 0, s = S(), byKey = new Map(s.merged.map(e => [keyOf(e), e])), indiv = [];
        P.items.filter(x => x.ok).forEach(x => {
            if (x.all) { const gid = 'g' + Date.now() + Math.random().toString(36).slice(2, 6); st.optAll = st.optAll || new Map(); st.optAll.set(gid, { from: x.from, to: x.to }); x.sets.forEach(z => st.patch.set(z.key, Object.assign({}, st.patch.get(z.key) || {}, { opt: z.opt, optAll: gid }))); return; }
            if (x.set.indiv) { const e = byKey.get(x.key); if (e) indiv.push(`${md(s.shipDate)}\t${buyerTel(e)}\t입력o삭제x\t${CH_LABEL[e.ch] || '네이버'}`); return; }
            const np = Object.assign({}, st.patch.get(x.key) || {}, x.set); if (x.set.opt != null) delete np.optAll;   // 한 건만 따로 바꾸면 묶음에서 빠진다
            st.patch.set(x.key, np);
        });
        C.log[P.at].state = '적용함'; C.pending = null;
        st.out = null; st.files = []; $('fo-result').hidden = true; clearMsg();
        if (indiv.length) { const memo = $('fo-memo'); memo.value = (memo.value.trim() ? memo.value.replace(/\s+$/, '') + '\n' : '') + [...new Set(indiv)].join('\n'); for (let i = 0; i < 1200 && st.ai.running; i++) await sleep(500); await run(judge); }
        else renderSummaryOnly();
        renderChat(); syncChat();
        if (had) await remake(); else $('fo-chat-msg').textContent = pending().length ? '적용했어요. 남은 카드를 처리하고 [파일 만들기]를 눌러 주세요.' : '적용했어요. [파일 만들기]를 눌러 주세요.';
    }
    async function onChatClick(e) {
        const b = e.target.closest('button'); if (!b) return; const C = st.chat;
        if (b.id === 'fo-chat-send') return chatSend();
        if (b.id === 'fo-chat-stop') { C.running = false; $('fo-chat-msg').textContent = '그만뒀어요.'; syncChat(); renderChat(); return; }
        if (b.dataset.addrPick) { const [i, v] = b.dataset.addrPick.split(':'); return addrPick(Number(i), v); }
        if (b.dataset.chat === 'apply') { if (C.pending && C.pending.items.some(addrNeedsPick)) return; return chatApply(); }
        if (b.dataset.chat === 'cancel' && C.pending) { C.log[C.pending.at].state = '취소함'; C.pending = null; renderChat(); syncChat(); return; }
        if (b.dataset.unpatch && !st.busy) {
            const had = st.phase === 'result' && st.files.length > 0, uk = b.dataset.unpatch;
            if (uk.startsWith('all:')) { const gid = uk.slice(4); [...st.patch].forEach(([k, p]) => { if (p.optAll !== gid) return; const np = Object.assign({}, p); delete np.opt; delete np.optAll; if (Object.keys(np).length) st.patch.set(k, np); else st.patch.delete(k); }); if (st.optAll) st.optAll.delete(gid); }
            else st.patch.delete(uk);
            st.out = null; st.files = []; $('fo-result').hidden = true;
            for (let i = 0; i < 1200 && st.ai.running; i++) await sleep(500);
            await run(judge);   // 제외를 되돌리면 엔진 판정값으로 돌아가야 하므로 판정을 다시 한다
            if (had) await remake();
        }
    }
    // 전체 지시에 남길 정리 기록 1건 — [파일 만들기]가 끝날 때(다시 만들면 같은 기록을 고쳐 씀). 주소·전화 글자는 넣지 않는다.
    function logLines() {
        const s = S(), m = s.merged, out = st.out, L = [];
        L.push(out.partners.map(p => `${p.short} ${p.rows.length}건(${p.total}박스)`).join(' · ') || '택배사 양식 0건');
        L.push(`제주도 배송: ${jejuText()}`);
        L.push(`현금파일 ${st.cash && st.cash.ok ? st.cash.rows.length : 0}행 · 입력삭제 ${m.filter(e => e.individual).length}건 · 오늘 안 나감 ${m.filter(e => !e.individual && e.excluded).length}건`);
        const sp = [], items = patchItems(), kinds = ['주소 변경', '받는 분 변경', '수량 변경', '품목 통째로 변경', '품목 이름 변경', '품목 뒤 요청', '배송메세지 변경'];
        kinds.forEach(k => { const xs = items.filter(x => x.kind === k); if (xs.length) sp.push(`· ${k} ${xs.length}건: ${[...new Set(xs.map(x => x.log))].slice(0, 6).join(', ')}${xs.length > 6 ? ' 외' : ''}`); });
        const szN = m.filter(e => goingOut(e) && st.sizeTail && st.sizeTail.has(keyOf(e))).length; if (szN) sp.push(`· 메모 줄로 사이즈 지정 ${szN}건`);
        const cardTail = m.filter(e => goingOut(e) && !(st.patch.get(keyOf(e)) || {}).tail && !(st.sizeTail && st.sizeTail.has(keyOf(e))) && tailOf(e)); if (cardTail.length) sp.push(`· 품목 뒤 요청(손님 메모 · 카드에서 확인) ${cardTail.length}건: ${cardTail.slice(0, 6).map(e => `${buyerName(e)} ${tailOf(e)}`).join(', ')}`);
        const sm = senderMap().byKey; let rule = 0, ai = 0, hand = 0;
        m.filter(goingOut).forEach(e => { const k = keyOf(e), p = st.patch.get(k); if (p && p.sender && p.sender.name) hand++; else if (sm.has(k)) { const id = st.sambCard && st.sambCard.get(k); if (id && st.ai.tag.has(id)) ai++; else hand++; } else if (e.sender && !e.sender.ambiguous) rule++; });
        if (rule + ai + hand) sp.push(`· 보내는이 변경 ${rule + ai + hand}건 (규칙 ${rule} · AI가 처리 ${ai} · 직접 ${hand})`);
        const ex = m.filter(e => !e.individual && e.excluded);
        const why = e => { const p = st.patch.get(keyOf(e)); if (p && p.excl === true) return '말로 제외'; const id = st.ordCard && st.ordCard.get(keyOf(e)); if (id && st.dec.get(id) === 'excl') return st.ai.tag.has(id) ? 'AI: ' + st.ai.tag.get(id) : '카드에서 제외'; if (e.req) return `메모 줄 ${md(e.req.date)}`; if (e.parse && e.parse.reqDate) return `${e.parse.reqDate} ${e.parse.kind === 'arrive' ? '도착' : '발송'} 요청`; return '손님 메모'; };
        if (ex.length) { sp.push(`· 오늘 제외 ${ex.length}건${ex.length > 12 ? ' (앞 12건만 적음)' : ''}`); ex.slice(0, 12).forEach(e => sp.push(`   - ${buyerName(e)} (${why(e)})`)); }
        if ((st.recvFix || []).length) sp.push(`· 받는 분 번호로 적은 메모 줄을 주문번호로 바꿈 ${st.recvFix.reduce((a, x) => a + x.n, 0)}건`);
        if (sp.length) L.push('특이사항', ...sp);
        return L.map(t => String(t).replace(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '(번호)').slice(0, 200)).slice(0, 40);
    }
    async function sendLog() {
        try {
            const r = await window.api('/api/agent-office/final-order/log', 'POST', Object.assign({ shipDate: S().shipDate, lines: logLines() }, st.logId ? { id: st.logId } : {}));
            if (r && r.ok && r.id) st.logId = r.id;
        } catch (_) { /* 기록을 못 남겨도 파일은 만들어졌다 */ }
    }

    // ── #530(대표 10/5) [초기화] — 최종발주를 방금 연 상태로 ─────────────────────────────────────
    //   메모·현금파일·기준 발송일·카드 결정·적다 만 글·AI 결과·말로 바꾼 것·대화·결과 파일·정리 기록 번호를 비우고, 숨은 계산 화면(v2)도 새로 연다.
    //   돌고 있는 AI 읽기·대화 요청은 [그만두기]와 같게 정리한다(각 요청의 finally 가 서버 묶음을 DELETE).
    async function resetAll() {
        if (st.busy) return;
        $('fo-reset-confirm').hidden = true;
        st.ai.running = false; st.chat.running = false; st.autoAi = false;
        st.busy = true; $('fo-panel').classList.add('busy'); $('fo-reset').disabled = true;
        try {
            $('fo-memo').value = ''; $('fo-chat-input').value = '';
            st.cash = null; st.cashName = ''; st.cashNone = false; $('fo-cash').value = '';
            st.prep = null; st.loaded = false; st.judged = false; st.stale = false; st.loadedOn = null; st.loadedAt = 0; st.chState = {}; st.cards = []; st.info = []; st.kindFilter = '';
            st.dec = new Map(); st.draft = new Map(); st.ai = newAi(); st.patch = new Map(); st.recvFix = []; st.ordMemo = new Map();
            st.chat = { log: [], cand: [], pending: null, running: false, id: 0, t0: 0 }; st.logId = 0;
            st.out = null; st.files = []; st.phase = 'input'; renderMemoGut();
            ['fo-review', 'fo-result', 'fo-progress', 'fo-chat'].forEach(id => { $(id).hidden = true; });
            $('fo-progress').innerHTML = ''; $('fo-cards').innerHTML = ''; $('fo-info').innerHTML = ''; $('fo-sum').innerHTML = ''; $('fo-result').innerHTML = '';
            clearMsg(); $('fo-chat-msg').textContent = ''; $('fo-ai-msg').textContent = ''; $('fo-ai-msg').classList.remove('err'); renderChat(); renderPatches();
            // 숨은 계산 화면도 새로(불러온 주문·줄·체크가 남지 않게) → 달력을 다시 받아 기준 발송일을 추천값으로
            if (st.frame) { st.frame.remove(); st.frame = null; } st.ready = null; st.cal = null;
            const sel = $('fo-ship'); sel.dataset.filled = ''; sel.innerHTML = '<option value="">달력을 불러오는 중</option>'; sel.disabled = true;
            await ensureFrame(); fillShip();
        } catch (err) { showError(err); }
        finally { st.busy = false; $('fo-panel').classList.remove('busy'); $('fo-reset').disabled = false; LOCKS.forEach(id => { $(id).disabled = id === 'fo-ship' && !st.cal; }); syncInput(); syncAi(); syncChat(); }
        toast('처음 상태로 돌렸어요');
    }

    window.AkmFinalOrder = { open, close, state: st };
})();
