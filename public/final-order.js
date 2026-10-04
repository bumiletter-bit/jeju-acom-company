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
                                <label class="fo-check"><input type="checkbox" id="fo-cash-none"> 오늘은 없음</label>
                            </div>
                            <p class="fo-hint" id="fo-cash-note">현금, 입력삭제 건의 주소 줄이 적힌 엑셀(13칸 양식)</p>
                        </div>
                    </div>
                    <div class="fo-field">
                        <label for="fo-memo">메모 (정리 파일 줄을 그대로 붙여 넣어요)</label>
                        <textarea id="fo-memo" rows="6" spellcheck="false" placeholder="10/5&#9;010-0000-0000&#9;입력o삭제x&#9;네이버&#10;010-0000-0000 금요일 발송&#10;10/5&#9;010-0000-0000&#9;보내는이 홍길동"></textarea>
                        <p class="fo-hint">요청일자, 번호, 비고, 플랫폼 순서예요. 「개별발송처리」는 입력삭제와 같아요. 보내는이는 「보내는이 이름 (번호) (주소 …)」로 적어요.</p>
                    </div>
                    <div class="fo-acts">
                        <button type="button" class="fo-btn primary" id="fo-start" disabled>주문 불러와 시작하기</button>
                        <button type="button" class="fo-btn" id="fo-rejudge" hidden>다시 판정</button>
                        <button type="button" class="fo-btn" id="fo-reload" hidden>주문 다시 불러오기</button>
                        <span class="fo-msg" id="fo-in-msg" role="status"></span>
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
            </div>
        </div>`;
        document.body.appendChild(el);
        $('fo-close').addEventListener('click', () => close());
        el.addEventListener('mousedown', e => { if (e.target === el && !st.busy) close(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.open && !st.busy) close(); });
        window.addEventListener('popstate', () => { if (st.skipPop) { st.skipPop = false; return; } if (st.open) close(true); });
        $('fo-cash-pick').addEventListener('click', () => $('fo-cash').click());
        $('fo-cash').addEventListener('change', e => { const f = (e.target.files || [])[0]; e.target.value = ''; if (f) readCash(f); });
        $('fo-cash-none').addEventListener('change', e => { st.cashNone = e.target.checked; if (st.cashNone) { st.cash = null; st.cashName = ''; } markStale(); syncInput(); });
        $('fo-memo').addEventListener('input', markStale);
        $('fo-ship').addEventListener('change', markStale);
        $('fo-start').addEventListener('click', () => run(start));
        $('fo-rejudge').addEventListener('click', () => run(judge));
        $('fo-reload').addEventListener('click', () => run(start));
        $('fo-make').addEventListener('click', () => run(make));
        $('fo-cards').addEventListener('click', onCardClick);
        $('fo-cards').addEventListener('change', onCardChange);
        $('fo-result').addEventListener('click', onResultClick);
        $('fo-progress').addEventListener('click', e => { const b = e.target.closest('button[data-fo-load]'); if (b) run(() => b.dataset.foLoad === 'retry' ? loadChannels(CH.filter(c => st.chState[c] && st.chState[c].fail)).then(afterLoad) : skipFailed()); });
    }
    const LOCKS = ['fo-memo', 'fo-ship', 'fo-cash-pick', 'fo-cash-none'];
    async function run(fn) {
        if (st.busy || (st.ai && st.ai.running)) return; st.busy = true; $('fo-panel').classList.add('busy');
        LOCKS.forEach(id => { $(id).disabled = true; });   // 실행 중에는 입력을 잠근다 — 판정이 도는 사이 메모를 고치면 낡은 판정으로 파일이 만들어진다(워커2 재현 E)
        try { await fn(); } catch (err) { showError(err); } finally { st.busy = false; $('fo-panel').classList.remove('busy'); LOCKS.forEach(id => { $(id).disabled = id === 'fo-ship' && !st.cal; }); syncInput(); syncMake(); syncAi(); }
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
        clearMsg(); st.phase = 'loading'; st.loaded = false; st.judged = false; st.dec = new Map([...st.dec].filter(([id]) => !/^(ord|split|samb|memo):/.test(id))); st.draft = new Map(); st.ai = newAi(); st.out = null;   /* 주문에 묶인 결정만 지운다(메모 줄·현금파일·거래처 결정은 내용 기준이라 유지) */ st.files = []; $('fo-review').hidden = true; $('fo-result').hidden = true;
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
        st.prep = core().prepLines($('fo-memo').value, { realToday: cal.realToday, shipDays: cal.shipDays, noShip: [...cal.noShip], shipDate: ship });
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
            cards.push({ id, keys: es.map(keyOf), type: 'order', tag: '주문 확인', title: groupTitle(es), lines: [['손님 메모', memoOf(es[0]) || '(없음)'], ['이유', reasonOf(es[0])], ...groupLines(es)], choices: [['send', '오늘 발송', 1], ['excl', '제외']] });
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
            cards.push({ id, keys: es.map(keyOf), type: 'sender-order', tag: '보내는이', title: groupTitle(es), lines: [['손님 메모', memo], ['처리', only ? '손님 메모가 이름뿐이에요. 보내는 분으로 넣으려면 확인하고 [이대로 넣기]를 눌러 주세요.' : '손님 메모가 분명하지 않아 자동으로 바꾸지 않았어요. 보내는 분을 여기에 적어 넣거나 그대로 둘 수 있어요.'], ...groupLines(es)], sender: { name: guess, phone, addr: '', memo: only ? '' : restOf(e, true, false).rest, orig: memo } });   // 배송메세지 칸 = 보내는이 부탁 글을 뺀 나머지(#516 · 사람이 확인)
        });
        // ③-b 배송메세지 정리(#516 대표 10/4 「보내는이가 확인되면 기본 문구로 · 인사말 같은 글은 남겼다 · 당일 발송 요청도 정답은 기본 문구」)
        //   대상 = 보내는이를 바꾸는 주문(v2 자동 · 메모 줄 지정)과 당일 발송 요청 메모. 요청 글뿐이라고 확실할 때만(sure && rest==='') 자동으로 기본 문구,
        //   글이 남거나 확실하지 않으면 카드로(남길 글을 미리 채워 사람이 확인). 실자료 117건에서 「자동으로 비웠는데 수기본엔 글이 남은」 경우 0건.
        st.memoAuto = new Map(); st.memoCard = new Map();
        const memoTargets = s.merged.filter(e => {
            if (e.individual || (e.excluded && !e.userTouched) || !memoOf(e) || st.sambCard.has(keyOf(e))) return false;
            if (e.reqKind === 'today' && !e.sender) return false;                       // v2가 이미 메모를 비우는 주문(직원 줄로 그날 발송 확정)
            return (e.sender && !e.sender.ambiguous) || sm.line.has(keyOf(e)) || sameDay(e) || st.ai.memoAsk.has(keyOf(e));
        });
        groupBy(memoTargets, sameBuyerMemo).forEach(es => {
            const e = es[0];
            // #518: AI가 「남길 글」을 제안했지만 확신이 없다고 한 메모는 그 글을 미리 채워 카드로
            const r = st.ai.memoAsk.has(keyOf(e)) ? { rest: st.ai.memoAsk.get(keyOf(e)), removed: '', sure: false } : restOf(e, (e.sender && !e.sender.ambiguous) || sm.line.has(keyOf(e)), sameDay(e));
            if (r.rest === memoOf(e)) return;                                            // 뺄 것이 없음 → 원문 그대로(종전과 같음)
            if (r.sure && r.rest === '') { es.forEach(x => st.memoAuto.set(keyOf(x), true)); info.push(`배송메세지를 기본 문구로: ${groupTitle(es)} — 손님 메모 「${memoOf(e)}」`); return; }
            const id = 'memo:' + keyOf(e); es.forEach(x => st.memoCard.set(keyOf(x), id));
            cards.push({ id, keys: es.map(keyOf), type: 'memo-edit', tag: '배송메세지', title: groupTitle(es), lines: [['손님 메모', memoOf(e)], ['처리', '보내는이·발송일 부탁 글을 빼고 택배사 양식에 남길 글을 확인해 주세요. 비우면 기본 문구가 들어가요.'], ...groupLines(es)], memo: { rest: r.rest, orig: memoOf(e) } });
        });
        // ④ 메모 줄
        (s.allLines || []).forEach(l => {
            if (l.bad) { cards.push({ id: 'lbad:' + l.srcLine + ':' + l.line, type: 'line', tag: '메모 줄', title: l.line, lines: [['이유', '번호를 찾지 못했어요. 요청일자, 번호, 비고, 플랫폼 순으로 적어 주세요.']], choices: [['ok', '이 줄은 넘어감', 1]] }); return; }
            if (l.expect != null && l.hits && l.expect !== l.hits) cards.push({ id: 'lcnt:' + l.srcLine + ':' + l.line, type: 'line', tag: '메모 줄', title: l.line, lines: [['이유', `비고는 ${l.expect}건인데 실제 주문은 ${l.hits}건이에요.`]], choices: [['ok', '확인함', 1]] });
            if (!l.hits) info.push(`주문 없음: ${l.line}${l.date && l.date < s.today ? ' (지난 날짜 — 이미 처리된 듯)' : ''}`);
        });
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
        s.merged.forEach(e => { if (goingOut(e) || st.dec.has('ord:' + keyOf(e))) opts.add(String(e.conv['옵션정보'] || '')); });
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
    }
    // 카드가 맡은 주문 키들(주문 확인 카드는 같은 구매자·같은 메모 묶음일 수 있다) · 같은 주문의 다른 종류 카드 결정
    const keysOf = cd => cd.keys || [cd.id.slice(cd.id.indexOf(':') + 1)];
    const otherDec = (cd, k) => { const id = cd.type === 'order' ? 'split:' + k : st.ordCard && st.ordCard.get(k); return id ? liveDec(id) : undefined; };
    const pending = () => st.cards.filter(cd => !st.dec.has(cd.id));
    // 검증·스타일용 카드 종류(data-fo-card) — 카드 id 머리말로 정한다
    const KIND = { ord: 'order', split: 'split', samb: 'sender-memo', memo: 'memo-edit', 'samb-line': 'sender-line', lbad: 'line', lcnt: 'line', lsplit: 'line', lnoship: 'line', lnodate: 'line', snohit: 'line', cashfmt: 'cash-format', cmiss: 'cash-missing', cnot: 'cash-notindiv', cbox: 'cash-boxdiff', pick: 'partner' };
    const kindOf = cd => KIND[cd.id.split(':')[0]] || cd.type;
    function cardHtml(cd) {
        const v = st.dec.get(cd.id), done = v !== undefined;
        const lines = cd.lines.map(([k, t]) => `<div class="fo-line"><span>${esc(k)}</span><p>${esc(t)}</p></div>`).join('');
        let acts = '';
        if (cd.type === 'pick') {
            acts = `<label class="fo-pick">거래처 <select data-pick="${esc(cd.id)}"><option value="">고르기</option>${cd.picks.map(p => `<option value="${esc(p)}"${v === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>`;
        } else if (cd.type === 'memo-edit') {
            const d = v || st.draft.get(cd.id) || { memo: cd.memo.rest };
            acts = done ? `<span class="fo-done">${v.use ? `배송메세지 「${esc(v.memo || '기본 문구')}」` : '원문 그대로'}${st.ai.tag.has(cd.id) ? ' · AI: ' + esc(st.ai.tag.get(cd.id)) : ''}</span><button type="button" class="fo-btn sm" data-undo="${esc(cd.id)}">바꾸기</button>`
                : `<div class="fo-edit"><label class="wide">택배사 양식에 들어갈 배송메세지(비우면 기본 문구)<textarea data-f="memo" rows="2" maxlength="300">${esc(d.memo == null ? cd.memo.rest : d.memo)}</textarea></label></div>
                   <button type="button" class="fo-btn sm primary" data-memo="use" data-fo-act="use" data-id="${esc(cd.id)}">이대로 넣기</button><button type="button" class="fo-btn sm" data-memo="keep" data-fo-act="keep" data-id="${esc(cd.id)}">원문 그대로</button>`;
        } else if (cd.type === 'sender-edit' || cd.type === 'sender-order') {
            const ord = cd.type === 'sender-order';   // 주문 카드(손님 메모 애매) = [안 바꿈] · 메모 줄 카드 = [넣지 않음]
            const d = v || st.draft.get(cd.id) || { name: cd.sender.name || '', phone: cd.sender.phone || '', addr: cd.sender.addr || '', memo: cd.sender.memo || '' };   // draft = 아직 안 누른 카드에 적어 둔 글(다른 카드를 눌러 다시 그려도 유지)
            // #511(대표 10/4 「정답은 동호수만 남기고 김현정 드림」): 주문 카드에서는 택배사 양식에 들어갈 배송메세지도 사람이 고쳐 넣을 수 있다(프로그램이 지우지 않는다 · 비우면 기본 문구)
            const memoBox = ord ? `<label class="wide">택배사 양식에 들어갈 배송메세지(보내는이 부탁 글은 지우고 남길 것만 · 비우면 기본 문구)<textarea data-f="memo" rows="2" maxlength="300">${esc(d.memo == null ? cd.sender.memo || '' : d.memo)}</textarea></label>` : '';
            const memoDone = ord && v && v.use && typeof v.memo === 'string' && v.memo !== (cd.sender.orig || '') ? ` · 배송메세지 「${esc(v.memo || '기본 문구')}」` : '';
            acts = done ? `<span class="fo-done">${v.use ? `보내는이 ${esc(/드림$/.test(v.name) ? v.name : v.name + ' 드림')}${v.phone ? ' · ' + esc(v.phone) : ''}${v.addr ? ' · 주소 ' + esc(v.addr) : ''}${memoDone}` : ord ? '안 바꿈' : '이 줄은 넣지 않음'}${st.ai.tag.has(cd.id) ? ' · AI: ' + esc(st.ai.tag.get(cd.id)) : ''}</span><button type="button" class="fo-btn sm" data-undo="${esc(cd.id)}">바꾸기</button>`
                : `<div class="fo-edit"><label>보내는 분 이름(「드림」은 자동으로 붙어요)<input type="text" data-f="name" value="${esc(d.name)}" maxlength="20"></label><label>번호(바꿀 때만)<input type="text" data-f="phone" value="${esc(d.phone)}" inputmode="tel" maxlength="14"></label><label class="wide">보내는이 주소(바꿀 때만 · M칸에 그대로)<input type="text" data-f="addr" value="${esc(d.addr)}" maxlength="120"></label>${memoBox}</div>
                   <button type="button" class="fo-btn sm primary" data-sender="use" data-fo-act="use" data-id="${esc(cd.id)}">이대로 넣기</button><button type="button" class="fo-btn sm" data-sender="skip" data-fo-act="${ord ? 'keep' : 'skip'}" data-id="${esc(cd.id)}">${ord ? '안 바꿈' : '넣지 않음'}</button>`;
        } else if (done) {
            const lab = ((cd.choices.find(c => c[0] === v) || [])[1] || '확인함') + (st.ai.tag.has(cd.id) ? ' · AI: ' + st.ai.tag.get(cd.id) : '');
            acts = `<span class="fo-done">${esc(lab)}</span><button type="button" class="fo-btn sm" data-undo="${esc(cd.id)}">바꾸기</button>`;
        } else {
            acts = cd.choices.map(([val, lab, pri]) => `<button type="button" class="fo-btn sm${pri ? ' primary' : ''}" data-choice="${esc(val)}" data-fo-act="${esc(val)}" data-id="${esc(cd.id)}">${esc(lab)}</button>`).join('') || '<span class="fo-wait">고친 뒤 [다시 판정]을 눌러야 넘어가요</span>';
        }
        return `<article class="fo-card" data-id="${esc(cd.id)}" data-fo-card="${kindOf(cd)}"${done ? ' data-fo-done="1"' : ''} data-type="${cd.type}" data-state="${done ? 'done' : 'open'}"><div class="fo-card-top"><span class="fo-tag" data-k="${cd.type}">${esc(cd.tag)}</span><b>${esc(cd.title)}</b></div>${done && cd.type !== 'pick' && cd.type !== 'sender-edit' && cd.type !== 'sender-order' ? '' : `<div class="fo-card-body">${lines}</div>`}<div class="fo-card-acts">${acts}</div></article>`;
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
        $('fo-review').hidden = false; syncAi();
        $('fo-sum').innerHTML = `<span>기준 발송일 <b>${esc(dateLabel(s.shipDate))}</b></span><span>주문 <b>${n}</b>건</span><span>택배사 양식 <b>${n - indiv - excl}</b>건</span><span>입력삭제 <b>${indiv}</b>건</span><span>오늘 안 나감 <b>${excl}</b>건</span><span>현금파일 <b>${cashRows}</b>행</span>${st.loadedAt ? `<span>주문 불러온 시각 <b>${hm(st.loadedAt)}</b></span>` : ''}`;
        $('fo-info').innerHTML = st.info.length ? `<details><summary>참고 ${st.info.length}건 (확인만 하면 돼요)</summary><ul>${st.info.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : '';
        const open = pending(), ordOpen = open.filter(cd => cd.type === 'order').length;
        const head = st.cards.length ? `<div class="fo-cards-head"><h3>확인할 것 <b>${open.length}</b>건 <small>/ 전체 ${st.cards.length}건</small></h3>${ordOpen > 1 ? `<button type="button" class="fo-btn sm" data-bulk="send">남은 주문 확인 ${ordOpen}건 모두 오늘 발송</button>` : ''}</div>` : '<p class="fo-empty">확인할 것이 없어요. 바로 파일을 만들 수 있어요.</p>';
        // #517: 카드가 많을 때(설날 실파일 = 100장 안팎) 종류별로 걸러 본다 — 남은 건수가 있는 종류만 칩으로
        const kinds = {}; open.forEach(cd => { const k = cd.tag; kinds[k] = (kinds[k] || 0) + 1; });
        if (st.kindFilter && !kinds[st.kindFilter]) st.kindFilter = '';
        const chips = Object.keys(kinds).length > 1 ? `<div class="fo-kinds" role="group" aria-label="종류별로 보기"><button type="button" class="fo-kind${st.kindFilter ? '' : ' on'}" data-kind="">전체 ${open.length}</button>${Object.entries(kinds).map(([k, n]) => `<button type="button" class="fo-kind${st.kindFilter === k ? ' on' : ''}" data-kind="${esc(k)}">${esc(k)} ${n}</button>`).join('')}</div>` : '';
        const order = cd => (st.dec.has(cd.id) ? 1 : 0);
        const shown = st.cards.filter(cd => !st.kindFilter || (cd.tag === st.kindFilter && !st.dec.has(cd.id)));
        $('fo-cards').innerHTML = head + chips + shown.slice().sort((a, b) => order(a) - order(b)).map(cardHtml).join('');
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
        if (v === undefined) { st.dec.delete(id); if (prev && typeof prev === 'object' && prev.use) st.draft.set(id, prev); }   // [바꾸기] = 앞서 넣은 값에서 이어 고친다
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
        if (st.busy || !st.judged || st.ai.running) return;   // 판정이 실패한 뒤 남은 카드는 [다시 판정] 전까지 누를 수 없다
        const b = e.target.closest('button'); if (!b) return;
        if (b.classList.contains('fo-kind')) { st.kindFilter = b.dataset.kind || ''; return renderReview(); }
        if (b.dataset.choice) return decide(b.dataset.id, b.dataset.choice);
        if (b.dataset.undo) return decide(b.dataset.undo, undefined);
        if (b.dataset.bulk === 'send') { pending().filter(cd => cd.type === 'order').forEach(cd => st.dec.set(cd.id, 'send')); st.out = null; $('fo-result').hidden = true; return renderSummaryOnly(); }
        if (b.dataset.memo) {
            if (b.dataset.memo === 'keep') return decide(b.dataset.id, { use: false });
            const el = b.closest('.fo-card').querySelector('[data-f="memo"]');
            return decide(b.dataset.id, { use: true, memo: String((el && el.value) || '').replace(/\r/g, '').trim() });
        }
        if (b.dataset.sender) {
            const card = b.closest('.fo-card'), get = f => (card.querySelector(`[data-f="${f}"]`).value || '').trim();
            if (b.dataset.sender === 'skip') return decide(b.dataset.id, { use: false });
            const name = get('name'); if (!name) { card.querySelector('[data-f="name"]').focus(); return; }
            const memoEl = card.querySelector('[data-f="memo"]');
            return decide(b.dataset.id, { use: true, name, phone: get('phone'), addr: get('addr'), ...(memoEl ? { memo: String(memoEl.value || '').replace(/\r/g, '').trim() } : {}) });
        }
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
            const d = sambDec(e);
            if (d) { if (d.use && typeof d.memo === 'string') put(d.memo); return; }   // 보내는이 카드가 있는 주문은 그 카드의 결정만 따른다([안 바꿈]이면 원문 그대로)
            const md2 = st.memoCard && st.memoCard.get(k) ? st.dec.get(st.memoCard.get(k)) : undefined;
            if (md2) { if (md2.use && typeof md2.memo === 'string') put(md2.memo); return; }
            if (st.ai.memo.has(k)) { put(st.ai.memo.get(k)); return; }                // #518: AI가 정리한 배송메세지(확실하다고 한 것만 · 카드 없는 주문)
            if (st.memoAuto && st.memoAuto.get(k)) put('');
        });
        const picks = {}; st.cards.forEach(cd => { if (cd.type === 'pick' && st.dec.get(cd.id)) picks[cd.id.slice(5)] = st.dec.get(cd.id); });
        const out = core().buildRows({ program, cash: st.cash && st.cash.ok ? st.cash.rows : [], byPartner: st.byPartner, picks, senderByKey: senderMap().byKey, defaultMemo: DEFAULT_MEMO });
        if (out.unknown && out.unknown.length) { buildCards(); applyOrderDecisions(); renderReview(); throw new Error('거래처를 못 정한 품목이 새로 생겼어요. 위에서 골라 주세요.'); }
        const dot = mdDot(s.shipDate), files = [];
        const colorOf = name => CAT_RGB[typeof window.qtyCategory === 'function' ? window.qtyCategory(name) : ''] || null;
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
    }
    function renderResult(cpMsg) {
        const el = $('fo-result'); el.hidden = false;
        const qtyTable = p => `<table class="fo-qty" id="fo-qty-${esc(p.short)}"><tbody>${p.qty.map(q => `<tr><td style="background:#${st.colorOf(q.name) || 'FFFFFF'}">${esc(q.name)}</td><td class="n">${q.qty}</td></tr>`).join('')}<tr class="tot"><td></td><td class="n">${p.total}</td></tr></tbody></table>`;
        const partner = f => { const p = f.partner, cash = p.rows.filter(r => r.src === 'cash').length, jeju = p.rows.filter(r => r.jeju).length; return `<article class="fo-file" data-short="${esc(f.short)}"><header><h4>${esc(f.short)}</h4><p>${p.rows.length}행 · ${p.total}박스${cash ? ` · 현금파일 ${cash}행 포함` : ''}${jeju ? ` · 제주 ${jeju}행(맨 아래)` : ''}</p></header>${qtyTable(p)}<div class="fo-acts"><button type="button" class="fo-btn primary" data-fo-save="${esc(f.name)}">택배사 양식 저장</button><button type="button" class="fo-btn" data-fo-png="${esc(f.short)}">수량 이미지 저장</button></div><p class="fo-fname">${esc(f.name)}</p></article>`; };
        const store = f => `<article class="fo-file store"><header><h4>스마트스토어</h4><p>${f.rows}행${f.indiv ? ` · 입력삭제 ${f.indiv}행은 노란 줄(맨 아래)` : ''}</p></header><div class="fo-acts"><button type="button" class="fo-btn primary" data-fo-save="${esc(f.name)}">스토어 양식 저장</button></div><p class="fo-fname">${esc(f.name)}</p></article>`;
        const ps = st.files.filter(f => f.kind === 'partner'), ss = st.files.filter(f => f.kind === 'store');
        el.innerHTML = `<div class="fo-cards-head"><h3>결과 파일</h3><button type="button" class="fo-btn" id="fo-save-all">전부 저장</button></div>
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
        if (b.id === 'fo-save-all') { b.disabled = true; try { for (const f of st.files) { saveFile(f.name); await sleep(350); if (f.kind === 'partner') { savePng(f.short); await sleep(350); } } toast('전부 저장했어요'); } finally { b.disabled = false; } }
    }

    // ── #518(대표 10/4 「AI가 배송메세지를 읽고 사람처럼 처리」) AI(창구)가 손님 메모를 읽는다 ─────────────────────────
    //   규칙이 확실히 처리한 것은 그대로 두고, 카드가 뜬 주문과 「기사에게 전하는 말만은 아닌」 메모를 창구에 보낸다(직원 = 콘솔 · 대표 = 대표 요금제 — 창구 대기 프로그램이 가른다).
    //   AI는 받는 분·주소·옵션·수량을 못 건드린다(메모 글과 구매자·수취인 이름·수량만 받는다). 돌아온 판정은 확실하다고 한 것만 카드 결정으로 넣고, 나머지는 입력칸에 미리 채워 사람이 확인한다.
    function newAi() { return { id: 0, running: false, gen: 0, t0: 0, items: [], byKey: new Map(), memo: new Map(), memoAsk: new Map(), tag: new Map(), seen: new Set(), done: false, count: 0 }; }
    st.ai = newAi();
    function aiOf(e) { return st.ai.byKey.get(keyOf(e)) || null; }
    function aiHold(e) { const r = aiOf(e); return !!r && r.ship !== 'go' && !e.individual && e.reqKind !== 'today' && !(e.excluded && !e.userTouched); }
    function aiSender(e) { const r = aiOf(e); return !e.sender && !!(r && r.sender && r.sender.name) && !!String(e.conv['배송메세지'] || '').trim(); }
    const AI_COURIER = /문\s*앞|현관|경비|비밀\s*번호|비번|부재|연락|전화|문자|택배함|보관|\d+\s*층|\d+\s*동|\d+\s*호|공동|초인종|벨|\d+\s*과/g;
    const AI_PLAIN_SKIP = /선물|좋은|예쁜|맛있|신선|꼼꼼|포장|빠른|빨리|사이즈|size|감사|수고|안녕|하자|상태|크기|보내는|보낸|드림|올림|주문자|발신|from|\d+\s*일|요일|도착|발송|출고|주소|리스트|명단|메일|톡톡/i;
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
    function aiCollect() {
        const s = S(), groups = new Map(), cardOf = new Map();
        st.cards.forEach(cd => { if (AI_KIND[cd.type]) keysOf(cd).forEach(k => { (cardOf.get(k) || cardOf.set(k, []).get(k)).push(cd); }); });
        s.merged.forEach(e => {
            const memo = String(e.conv['배송메세지'] || '').trim(); if (!memo || e.individual) return;
            if (e.excluded && !e.userTouched) return;                 // v2가 스스로 뺀 주문(날짜가 분명)
            if (e.reqKind === 'today' && !e.sender) return;           // 직원 줄로 그날 발송 확정(메모는 이미 비움)
            const k = keyOf(e), cds = cardOf.get(k) || [];
            if (!cds.length) {
                if (st.memoAuto && st.memoAuto.get(k)) return;        // 규칙이 이미 기본 문구로 정함
                if (!AI_PLAIN_SKIP.test(memo)) return;                // 「문 앞에 놔주세요」처럼 기사에게 전하는 말뿐인 메모는 보내지 않는다(그대로 나감)
            }
            const gk = buyerName(e) + '|' + (cds.length ? buyerTel(e) : '') + '|' + memo + '|' + (qtyOf(e) >= 2 ? 'm' : 's');
            let g = groups.get(gk);
            if (!g) {
                const hint = [e.sender ? (e.sender.ambiguous ? '보내는이 애매' : '보내는이 자동: ' + e.sender.name) : '', e.flag === 'review' ? '날짜 확인필요' : ''].filter(Boolean).join(' · ');
                g = { keys: [], memo, buyer: buyerName(e), recv: String(e.conv['수취인명'] || ''), qty: qtyOf(e), cards: [...new Set(cds.map(c => AI_KIND[c.type]))], hint };
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
        if (!A.running && A.done && !msg.classList.contains('err')) msg.textContent = `AI가 메모 ${A.count}건을 읽었어요. 확실한 것은 처리했고(카드에 「AI」 표시 · [바꾸기]로 고칠 수 있어요), 남은 카드만 확인해 주세요.`;
        if (!A.running && !A.done && !msg.classList.contains('err')) msg.textContent = A.note || '애매한 메모를 AI가 사람처럼 읽어 카드에 채워 줘요(대표 PC의 창구가 켜져 있어야 해요).';
    }
    async function aiRead() {
        if (st.ai.running || st.busy || !st.judged || st.stale) return;
        const groups = aiCollect(), msg = $('fo-ai-msg'); msg.classList.remove('err');
        if (!groups.length) { msg.textContent = 'AI가 읽을 메모가 없어요.'; return; }
        const gen = (st.ai.gen || 0) + 1; st.ai = Object.assign(newAi(), { running: true, gen, items: groups, t0: Date.now() });
        const A = st.ai; syncAi(); syncMake(); syncInput(); msg.textContent = `메모 ${groups.length}건을 창구에 올리는 중이에요`;
        try {
            const s = S();
            const r = await window.api('/api/agent-office/final-order/memo-read', 'POST', { shipDate: s.shipDate, realToday: st.cal.realToday, shipDays: st.cal.shipDays, items: groups.map((g, i) => ({ i, memo: g.memo, buyer: g.buyer, recv: g.recv, qty: g.qty, cards: g.cards, hint: g.hint })) });
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
        } catch (err) { msg.textContent = '⚠️ AI 읽기를 못 했어요: ' + (err && err.message ? err.message : err) + ' — 카드로 직접 확인해 주세요.'; msg.classList.add('err'); }
        finally {
            const id = A.id; A.running = false; A.id = 0;
            if (id) { try { await window.api('/api/agent-office/final-order/memo-read/' + id, 'DELETE'); } catch (_) { } }   // 손님 글을 서버에 남기지 않는다
            syncAi(); syncMake(); syncInput();
        }
    }
    function aiApply(data) {
        const A = st.ai, byI = new Map(((data && Array.isArray(data.items)) ? data.items : []).map(r => [Number(r && r.i), r]));
        let n = 0;
        A.items.forEach((g, i) => {
            const r0 = byI.get(i); if (!r0) return; n++;
            const mt = aiMemoText(r0, g.memo), sd = r0.sender && String(r0.sender.name || '').trim() ? r0.sender : null;
            const r = { ship: ['go', 'hold', 'ask'].includes(r0.ship) ? r0.ship : 'ask', ship_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r0.ship_date || '')) ? r0.ship_date : null,
                sender: sd ? { name: String(sd.name).trim().replace(/\s*(드림|올림)$/, '').slice(0, 20), phone: String(sd.phone || '').trim().slice(0, 14), addr: String(sd.addr || '').trim().slice(0, 120) } : null,
                split: !!r0.split, sure: r0.sure === true && mt.safe, why: String(r0.why || '').slice(0, 60), memoText: mt.text };
            if (r.split && r.ship === 'go') r.ship = 'ask';
            g.keys.forEach(k => A.byKey.set(k, r));
        });
        A.count = n; A.done = true;
        aiToCards();
    }
    // AI 판정을 카드에 반영한다(판정을 다시 해 카드가 새로 생겨도 부른다). 사람이 이미 정했거나 [바꾸기]로 되돌린 카드는 건드리지 않는다.
    function aiToCards() {
        const A = st.ai; if (!A.done) return;
        A.memo = new Map(); A.memoAsk = new Map();
        buildCards();
        const carded = new Set(); st.cards.forEach(cd => { if (AI_KIND[cd.type]) keysOf(cd).forEach(k => carded.add(k)); });
        S().merged.forEach(e => {   // 카드가 없는 주문의 배송메세지: 확실하면 바로, 아니면 「남길 글」을 채운 카드로
            const k = keyOf(e), r = A.byKey.get(k); if (!r || carded.has(k) || r.ship !== 'go' || r.sender) return;
            const orig = String(e.conv['배송메세지'] || '').replace(/\r/g, '').trim(); if (r.memoText === orig) return;
            if (r.sure) A.memo.set(k, r.memoText); else A.memoAsk.set(k, r.memoText);
        });
        buildCards(); applyOrderDecisions();
        st.cards.forEach(cd => {
            if (!AI_KIND[cd.type] || st.dec.has(cd.id) || A.seen.has(cd.id)) return;
            const r = A.byKey.get(keysOf(cd)[0]); if (!r) return; A.seen.add(cd.id);
            const tag = v => { st.dec.set(cd.id, v); A.tag.set(cd.id, r.why || 'AI 판단'); };
            if (cd.type === 'order') { if (r.sure && r.ship === 'go') tag('send'); else if (r.sure && r.ship === 'hold') { tag('excl'); if (r.ship_date) A.tag.set(cd.id, (r.why || 'AI 판단') + ' · ' + md(r.ship_date) + ' 발송'); } }
            else if (cd.type === 'split') { if (r.sure && !r.split && r.ship === 'go') tag('all'); }
            else if (cd.type === 'sender-order') {
                if (r.sure) tag(r.sender ? { use: true, name: r.sender.name, phone: r.sender.phone, addr: r.sender.addr, memo: r.memoText } : { use: false });
                else if (r.sender) st.draft.set(cd.id, { name: r.sender.name, phone: r.sender.phone, addr: r.sender.addr, memo: r.memoText });
            } else if (cd.type === 'memo-edit') { if (r.sure) tag({ use: true, memo: r.memoText }); else st.draft.set(cd.id, { memo: r.memoText }); }
        });
        st.out = null; $('fo-result').hidden = true; st.skipDraftSave = true; renderSummaryOnly();
    }
    document.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('#fo-ai-read, #fo-ai-stop'); if (!b) return;
        if (b.id === 'fo-ai-read') aiRead(); else { st.ai.running = false; st.ai.note = 'AI 읽기를 그만뒀어요. 카드로 직접 확인해 주세요.'; syncAi(); syncMake(); syncInput(); }
    });

    window.AkmFinalOrder = { open, close, state: st };
})();
