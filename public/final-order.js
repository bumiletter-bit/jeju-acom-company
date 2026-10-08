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
    const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
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
                <button type="button" class="fo-theme" id="fo-theme" aria-label="야간 화면 켜기·끄기" title="야간 화면 켜기·끄기"></button>
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
                    <div class="fo-acts">
                        <button type="button" class="fo-btn primary" id="fo-start" disabled>주문 불러와 시작하기</button>
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
                <!-- #572(대표 10/7 「틀 순서를 불러오기 밑으로 · AI 가 인식 · 이미지도」): 메모 칸은 주문을 불러온 뒤에 — 규칙이 먼저 읽고, 못 읽은 줄만 클코가 틀로 고쳐 쓰고, 사진(폰 메모 캡처)은 클코가 틀 줄로 읽는다 -->
                <section class="fo-sec" id="fo-memo-sec" hidden aria-label="개별발송 처리 · 지정 발송일">
                    <div class="fo-field">
                        <label for="fo-memo">개별발송 처리 · 지정 발송일</label>
                        <textarea id="fo-memo" rows="6" spellcheck="false" placeholder="10/5&#9;010-0000-0000&#9;입력o삭제x&#9;네이버&#10;010-0000-0000 금요일 발송&#10;010-0000-0000 2S사이즈&#10;10/5&#9;010-0000-0000&#9;보내는이 홍길동"></textarea>
                        <p class="fo-hint">정리 파일 줄을 그대로 붙여 넣어요(요청일자, 번호, 비고, 플랫폼 순서). 틀에 안 맞는 줄은 클코가 틀로 고쳐 쓰고, 폰 메모 캡처는 [사진으로 넣기]로 읽혀요.</p>
                    </div>
                    <div class="fo-acts">
                        <button type="button" class="fo-btn primary" id="fo-rejudge">확인</button>
                        <input type="file" id="fo-memo-file" accept="image/*" hidden>
                        <button type="button" class="fo-btn" id="fo-memo-photo" title="폰 메모 캡처·사진을 클코가 읽어 정리 줄로 넣어요">사진으로 넣기</button>
                        <span class="fo-stale" id="fo-stale-msg" role="alert" hidden>내용이 바뀌었어요 · [다시 판정]을 눌러 주세요</span>
                        <span class="fo-msg" id="fo-memo-msg" role="status"></span>
                    </div>
                    <div class="fo-aiband" id="fo-memo-band" role="status" aria-live="polite" hidden></div>
                </section>
                <section class="fo-sec" id="fo-review" hidden aria-label="확인">
                    <div class="fo-aiband" id="fo-ai-band" role="status" aria-live="polite" hidden></div>
                    <div class="fo-aimiss" id="fo-ai-miss" role="status" aria-live="polite" hidden></div>
                    <div class="fo-sum" id="fo-sum"></div>
                    <div class="fo-ai" id="fo-ai" hidden><button type="button" class="fo-btn" id="fo-ai-read">AI에게 메모 읽히기</button><button type="button" class="fo-btn sm" id="fo-ai-stop" hidden>그만두기</button><span class="fo-msg" id="fo-ai-msg" role="status"></span></div>
                    <div class="fo-info" id="fo-info"></div>
                    <div class="fo-find" id="fo-find"><label class="fo-find-lab" for="fo-find-q">주문 찾아 고치기</label><div class="fo-find-box"><input type="text" id="fo-find-q" inputmode="search" placeholder="이름 · 번호 끝자리 · 옵션 · 주문번호" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="fo-find-list"><div class="fo-find-list" id="fo-find-list" role="listbox" aria-label="찾은 주문" hidden></div></div></div>
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
                            <input type="file" id="fo-chat-file" accept="image/*" hidden>
                            <button type="button" class="fo-icon" id="fo-chat-attach" aria-label="사진 첨부" title="사진 첨부 — 번호·사이즈 요청 목록을 찍어 보내면 클코가 읽어 정리 줄로 넣어요"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M8 5l1.2-2h5.6L16 5"/></svg></button>
                            <span class="fo-tag" id="fo-chat-chip" hidden></span>
                            <span class="fo-grow" aria-hidden="true"></span>
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
        $('fo-theme').addEventListener('click', () => { if (window.AkmAoTheme && typeof window.AkmAoTheme.toggle === 'function') window.AkmAoTheme.toggle(); });   // #568: 야간 화면 전환(에이전트 오피스 본체의 버튼과 같은 동작 · 없으면 아무 일도 안 함)
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
        {   // #583-j: 떠 있는 버튼(오른쪽 아래 · [파일 만들기] 줄 위) — 「방금 보던 곳으로」(맨 위로 간 뒤 5초) · 「다음 확인 (N) →」 · 「↑ 맨 위」
            const fl = document.createElement('div'); fl.className = 'fo-float'; fl.id = 'fo-float'; fl.hidden = true;
            fl.innerHTML = '<button type="button" class="fo-fbtn back" id="fo-back" hidden>방금 보던 곳으로</button><button type="button" class="fo-fbtn next" id="fo-next" hidden></button><button type="button" class="fo-fbtn" id="fo-top" hidden aria-label="맨 위로">↑ 맨 위</button>';
            $('fo-panel').querySelector('.fo-box').appendChild(fl);
            fl.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.id === 'fo-top') floatTop(); else if (b.id === 'fo-back') floatBack(); else if (b.id === 'fo-next') floatNext(); });
            let raf = 0; foScroller().addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; floatSync(); }); }, { passive: true });
        }
        $('fo-find-q').addEventListener('input', findDraw);   // #583-h
        $('fo-find-q').addEventListener('focus', () => { if ($('fo-find-q').value.trim()) findDraw(); });
        $('fo-find-q').addEventListener('keydown', e => {
            if (!FD.open) return; const n = FD.keys.length;
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) { e.preventDefault(); findAct(Math.max(0, Math.min(n - 1, FD.act + (e.key === 'ArrowDown' ? 1 : -1)))); }
            else if (e.key === 'Enter' && FD.act >= 0) { e.preventDefault(); findPick(FD.act); }
        });
        $('fo-find-list').addEventListener('click', e => { const b = e.target.closest('.fo-find-row'); if (b) findPick(Number(b.dataset.find)); });
        $('fo-ai-miss').addEventListener('click', e => {   // #583-f
            const b = e.target.closest('button'); if (!b || st.busy || !st.judged) return;
            if (b.dataset.aiRetry) return aiRead(false);
            if (b.dataset.missKeep) { st.missAsk = true; renderReview(); const y = $('fo-ai-miss').querySelector('[data-miss-keep-yes]'); if (y) y.focus({ preventScroll: true }); return; }   // 한 번 더 확인(「N건을 손님 글 그대로 둡니다」)
            if (b.dataset.missKeepNo) { st.missAsk = false; return renderReview(); }
            if (b.dataset.missKeepYes) { st.missAsk = false; pending().filter(cd => cd.type === 'ai-miss').forEach(cd => st.dec.set(cd.id, 'keep')); st.out = null; $('fo-result').hidden = true; renderSummaryOnly(); }
        });
        $('fo-cards').addEventListener('input', onFixInput);   // #583-g2
        $('fo-result').addEventListener('click', onResultClick);
        $('fo-info').addEventListener('click', e => { const fb = e.target.closest('button[data-info-flip]'); if (fb) { e.preventDefault(); if (!st.busy && st.judged) infoFlip(Number(fb.dataset.infoFlip)); return; } const li = e.target.closest('li[data-info]'); if (!li || !li.querySelector('[data-info-go]') || String(window.getSelection && window.getSelection()).trim()) return; e.preventDefault(); infoGo(Number(li.dataset.info)); });   // #583 ⑨
        // #583-A(워커2 조사): 캡처는 보통 클립보드 — 메모 구획에 붙여넣기(Ctrl+V)·끌어다 놓기로도 사진을 넣는다(종전엔 아무 일도 없었다)
        { const sec = $('fo-memo-sec'), pickImg = list => Array.from(list || []).find(x => /^image\//.test(x.type) || IMG_EXT.test(x.name || ''));
          sec.addEventListener('paste', e => { const f = pickImg(e.clipboardData && e.clipboardData.files); if (f) { e.preventDefault(); memoPhoto(f); } });
          sec.addEventListener('dragover', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); sec.classList.add('fo-drop'); } });
          sec.addEventListener('dragleave', () => sec.classList.remove('fo-drop'));
          sec.addEventListener('drop', e => { sec.classList.remove('fo-drop'); const f = pickImg(e.dataTransfer && e.dataTransfer.files); if (f) { e.preventDefault(); memoPhoto(f); } }); }
        $('fo-chat').addEventListener('click', onChatClick);
        $('fo-reset').addEventListener('click', () => { if (st.busy) return; $('fo-reset-confirm').hidden = false; $('fo-reset-yes').focus({ preventScroll: true }); });
        $('fo-reset-no').addEventListener('click', () => { $('fo-reset-confirm').hidden = true; $('fo-reset').focus({ preventScroll: true }); });
        $('fo-reset-yes').addEventListener('click', resetAll);
        $('fo-chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); chatSend(); } });
        // #570-b(대표 10/7 「사이즈 요청 이미지로 찍어서 보내도 되게」): 대화 칸에 사진 1장 — 클코가 읽어 「번호 사이즈」 정리 줄로 돌려주면 화면이 메모 칸에 넣는다
        $('fo-memo-photo').addEventListener('click', () => { if (!st.busy && !st.memoAsk) $('fo-memo-file').click(); });   // #572
        $('fo-memo-file').addEventListener('change', async e => { const f = (e.target.files || [])[0]; e.target.value = ''; if (f) await memoPhoto(f); });
        $('fo-chat-attach').addEventListener('click', () => { if (!st.chat.running) $('fo-chat-file').click(); });
        $('fo-chat-file').addEventListener('change', async e => { const f = (e.target.files || [])[0]; e.target.value = ''; if (f) await setChatImg(f); });
        $('fo-chat-chip').addEventListener('click', e => { if (e.target.closest('[data-chat="unimg"]')) { st.chat.img = null; renderChatChip(); } });
        $('fo-chat-input').addEventListener('paste', async e => { const f = Array.from((e.clipboardData && e.clipboardData.files) || []).find(x => /^image\//.test(x.type)); if (f) { e.preventDefault(); await setChatImg(f); } });
        $('fo-progress').addEventListener('click', e => { const b = e.target.closest('button[data-fo-load]'); if (b) run(() => b.dataset.foLoad === 'retry' ? loadChannels(CH.filter(c => st.chState[c] && st.chState[c].fail)).then(afterLoad) : skipFailed()); });
    }
    const LOCKS = ['fo-memo', 'fo-ship', 'fo-cash-pick', 'fo-cash-none'];
    async function run(fn) {
        if (st.busy || (st.ai && st.ai.running)) return; st.busy = true; $('fo-panel').classList.add('busy');
        LOCKS.forEach(id => { $(id).disabled = true; });   // 실행 중에는 입력을 잠근다 — 판정이 도는 사이 메모를 고치면 낡은 판정으로 파일이 만들어진다(워커2 재현 E)
        try { await fn(); } catch (err) { showError(err); } finally { st.busy = false; $('fo-panel').classList.remove('busy'); LOCKS.forEach(id => { $(id).disabled = id === 'fo-ship' && !st.cal; }); syncInput(); syncMake(); syncAi(); syncChat(); }
        if (st.autoAi) { st.autoAi = false; if (st.judged && !st.stale) aiRead(true); }   // #520
        if (fn === judge && st.judged && !st.stale) lineFixAuto();   // #572 규칙이 못 읽은 메모 줄만 클코가 틀로 고쳐 쓰게(기다리지 않음)
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
    function markStale() { if (!st.loaded || st.phase === 'loading') return; st.stale = true; st.out = null; $('fo-result').hidden = true; clearMsg(); syncMake(); syncAi(); syncRejudgeLabel(); }
    // #575: 버튼 글은 낡음(stale) 상태와 늘 같이 간다 — markStale 에서도, syncInput 에서도 이 한 곳을 부른다(워커1 발견: 메모 입력·기준일 변경 때 글이 안 바뀜)
    function syncRejudgeLabel() { const b = $('fo-rejudge'); if (!b) return; const stale = !!(st.stale || !st.judged); b.textContent = stale ? '다시 판정' : '확인'; b.classList.toggle('stale', stale); const sm = $('fo-stale-msg'); if (sm) sm.hidden = !(st.stale && st.loaded); }   // #583 ④ 빨강 안내는 [확인]·[사진으로 넣기] 옆에

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
        optClose(false); findClose(true);
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
        $('fo-memo-sec').hidden = !st.loaded;   // #572 메모 칸은 주문을 불러온 뒤에
        $('fo-rejudge').hidden = !st.loaded; $('fo-rejudge').disabled = !haveCash || st.busy || st.ai.running;
        // #575(대표 10/7): 버튼 이름 = 평소 [확인] · 메모·현금파일·기준일이 바뀌어 판정이 낡으면 [다시 판정] — 판정하면 다시 [확인]
        syncRejudgeLabel();
        $('fo-memo-photo').disabled = !st.loaded || st.busy || !!st.memoAsk;
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
        const sz = core().sizeLines($('fo-memo').value); st.sizeLines = sz.sizes; st.upLines = sz.ups || [];   // #548 「번호 + 사이즈」 줄 — 사이즈 낱말은 떼고 나머지만 종전 규칙으로
        // #570: 사이즈 말이 있는데 못 읽은 줄(「2S싸이즈」 「S size로」 같은 꼴) — 조용히 「오늘 발송」 줄로 읽히지 않게 줄별 표시와 대화 답에서 알린다
        { const got = new Set(sz.sizes.map(z => z.srcLine));
          st.sizeMiss = String($('fo-memo').value || '').split('\n').map((raw, i) => ({ srcLine: i, raw: raw.replace(/\r/g, '').trim() }))
              .filter(x => !got.has(x.srcLine) && LINEISH.test(x.raw) && SIZE_HINT.test(x.raw.replace(LINEISH, ' '))); }
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
            const okE = hit.filter(e => sizeItem(e.conv['옵션정보'])), tail = z.size + '사이즈로!';
            okE.forEach(e => tails.set(keyOf(e), tail));
            const no = new Map(); hit.filter(e => !okE.includes(e)).forEach(e => { const o = core().stripTail(String(e.conv['옵션정보'] || ''), inCatalog); no.set(o, (no.get(o) || 0) + 1); });
            no.forEach((n, o) => info.push({ t: `사이즈 지정 대상 아님: ${o} ${n}건 (메모 줄 「${z.raw}」 — 귤 로얄과 주문에만 붙여요 · 선물용 제외)`, keys: hit.filter(e => !okE.includes(e) && core().stripTail(String(e.conv['옵션정보'] || ''), inCatalog) === o).map(keyOf), line: z.srcLine }));
            if (okE.length) info.push({ t: `메모 줄로 사이즈 지정: ${z.raw} → 귤 주문 ${okE.length}건에 「${tail}」`, keys: okE.map(keyOf), line: z.srcLine });
            // #570: 「s사이즈 2건」처럼 건수를 적었는데 실제 주문 수와 다르면 붙이되 표시로 알린다(v2 의 「건수 다름」과 같은 뜻)
            const cntOff = z.expect != null && z.expect !== hit.length;
            if (cntOff) info.push({ t: `건수 다름: ${z.raw} — 적은 건수 ${z.expect}건 · 실제 주문 ${hit.length}건(귤 로얄과 ${okE.length}건에 붙임)`, line: z.srcLine });
            res.set(z.srcLine, okE.length ? (cntOff ? { k: 'warn', t: `건수 다름 ${hit.length}건 · 사이즈 ${okE.length}건`, n: okE.length, tip: `적은 건수 ${z.expect}건인데 실제 주문 ${hit.length}건 — 귤 로얄과 ${okE.length}건에 붙였어요` } : { k: 'ok', t: `사이즈 지정 ${okE.length}건`, n: okE.length }) : { k: 'warn', t: '귤 로얄과 주문 없음', tip: '사이즈를 붙일 귤 로얄과 주문이 없어요' });
        });
        // #583 ⑥ 「번호 업그레이드」 줄: 카드에서 고른 사이즈(st.dec)를 그 손님의 귤 로얄과 주문에 붙인다
        const upRes = new Map();
        (st.upLines || []).forEach(u => {
            const id = 'lup:' + u.srcLine + ':' + u.raw, d = st.dec.get(id), size = /^(?:2S|S|M|L)$/.test(String(d || '')) ? d : null;
            const hit = s.merged.filter(e => (u.digits.length >= 8 && !NO_TEL.has(u.digits) && buyerTel(e) === u.digits) || idsOf(e).includes(u.key));
            const okE = hit.filter(e => sizeItem(e.conv['옵션정보']));
            if (size && okE.length) { okE.forEach(e => tails.set(keyOf(e), size + '사이즈로!')); info.push({ t: `메모 줄(업그레이드)로 사이즈 지정: ${u.raw} → 귤 로얄과 주문 ${okE.length}건에 「${size}사이즈로!」`, keys: okE.map(keyOf), line: u.srcLine }); }
            upRes.set(u.srcLine, { id, hit, okE, size, skip: d === 'skip' });
        });
        st.upRes = upRes;
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
        // #570 사이즈 말이 있는데 못 읽은 줄 — 보통 줄로 먼저 「확인 필요」(같은 warn 등급)가 붙어 put() 으로는 못 덮으므로 직접 덮고 종전 표시는 뒤에 이어 적는다
        (st.sizeMiss || []).forEach(x => { if (x.srcLine < 0 || x.srcLine >= n) return; const prev = marks[x.srcLine]; marks[x.srcLine] = { k: 'warn', t: '사이즈 못 읽음' + (prev && prev.t ? ' · ' + prev.t : ''), tip: '사이즈 말이 있는데 읽지 못했어요 — 「번호 2S사이즈」처럼 다시 적어 주세요(지금은 사이즈 없이 보통 줄로 읽혔어요)' + (prev && prev.tip ? ' · ' + prev.tip : '') }; });
        // #583 ⑥ 업그레이드 줄 — 사이즈를 고르기 전에는 확인 필요
        (st.upRes || new Map()).forEach((r, i) => {
            if (i < 0 || i >= n) return;
            if (r.size && r.okE.length) { marks[i] = marks[i] && marks[i].k !== 'ok' ? marks[i] : { k: 'ok', t: `사이즈 지정 ${r.okE.length}건`, tip: r.size + '사이즈로!' }; return; }
            if (r.skip) return put(i, { k: 'none', t: '넘어감', tip: '업그레이드 줄 — 넘어감' });
            put(i, !r.hit.length ? { k: 'none', t: '주문 없음', tip: '배송준비에 이 번호의 주문이 없어요' } : { k: 'warn', t: r.okE.length ? '사이즈 고르기' : '귤 로얄과 주문 없음', tip: r.okE.length ? '아래 「메모 재확인」 카드에서 사이즈를 눌러 주세요' : '사이즈를 붙일 귤 로얄과 주문이 없어요' });
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
        // #583-i(대표 실물 10/8): 카드 머리는 「지금 나갈 옵션」(고친 옵션명·꼬리 반영)으로 — 고쳐도 머리가 옛 꼬리(「S사이즈로!」)로 남아 안 바뀐 것처럼 보였다. 참고 줄 글은 종전대로 주문 원문.
        const orderLineNow = e => `${CH_LABEL[e.ch]} · ${buyerName(e)}${e.conv['수취인명'] && e.conv['수취인명'] !== buyerName(e) ? ' → ' + e.conv['수취인명'] : ''} · ${optOf(e)} · ${e.conv['수량']}박스`;
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
        const groupTitle = es => orderLineNow(es[0]) + (es.length > 1 ? ` 외 ${es.length - 1}건` : '');
        st.ordCard = new Map(); st.sambCard = new Map();
        // #583 ⑦: 카드에 손님 번호(메모 줄은 번호로 적는다) · ⑤: 메모 칸의 그 줄 원문
        const fmtTel = d => (d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d);
        const telLine = e => { const b = buyerTel(e), r = [digitsOf(e.conv['수취인연락처1']), digitsOf(e.conv['수취인연락처2'])].filter(x => x && x !== b); return ['번호', (b ? '구매자 ' + fmtTel(b) : '구매자 번호 없음') + (r.length ? ' · 받는 분 ' + [...new Set(r)].map(fmtTel).join(', ') : '')]; };
        const memoLines = String($('fo-memo').value || '').replace(/\r/g, '').split('\n');
        const lineRaw = l => String(memoLines[l.srcLine] != null && memoLines[l.srcLine].trim() ? memoLines[l.srcLine] : l.line || '').trim();
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
            // #583 ⑤(대표 10/8): 직원이 메모 칸에 적은 줄 때문에 뜬 카드는 손님 메모 카드(주문 확인)와 다른 종류 「메모 재확인」(빨강)으로 — 그 줄 원문(클코가 고쳐 쓴 줄이면 원래 적은 줄도)을 같이 보여 준다
            const rq = es[0].req, rc = !!rq, rl = rc ? lineRaw(rq) : '', ro = rc && st.lineFix ? st.lineFix.get(rl) : null;
            cards.push({ id, keys: es.map(keyOf), fix: es.map(keyOf), fixF: ['name', 'phone', 'addr', 'opt'], type: 'order', tag: rc ? '메모 재확인' : '주문 확인', ...(rc ? { recheck: true } : {}), title: groupTitle(es), lines: [telLine(es[0]), ...(rc ? [...(ro ? [['원래 적은 줄', ro]] : []), [ro ? '클코가 고친 줄' : '직원 메모 줄', rl]] : []), ['손님 메모', memoOf(es[0]) || '(없음)'], ['이유', reasonOf(es[0])], ...groupLines(es)], choices: [['send', '오늘 발송', 1], ['excl', '제외']], memoOrig: memoOf(es[0]), memoPre: (() => { const o = memoOf(es[0]), r = aiOf(es[0]); if (!r || r.memo == null) return o; const t = aiMemoText(r, o); return t && t.safe ? t.text : o; })() });
        });
        // ② 나눠 보내기 신호(손님 메모)
        s.merged.forEach(e => {
            if (e.individual || (e.excluded && !e.userTouched)) return;   // v2가 스스로 뺀 주문(뒤 날짜)은 오늘 안 나가므로 대상 아님
            const sig = c.splitSignal({ memo: memoOf(e), qty: qtyOf(e), buyerDigits: buyerTel(e), recvDigits: [digitsOf(e.conv['수취인연락처1']), digitsOf(e.conv['수취인연락처2'])].filter(Boolean) });
            if (!sig) return;
            cards.push({ id: 'split:' + keyOf(e), fix: [keyOf(e)], fixF: ['name', 'phone', 'addr', 'memo', 'opt'], type: 'split', tag: '나눠 보내기', title: orderLineNow(e), lines: [telLine(e), ['손님 메모', memoOf(e)], ['이유', sig.why], ['처리', '따로 보낼 박스가 있으면 메모에 입력삭제 줄을 넣고 현금파일에 주소 줄을 적은 뒤 [다시 판정]을 눌러 주세요.']], choices: [['excl', '오늘은 제외(주소 받은 뒤 처리)', 1], ['all', '주문 주소로 전부 발송']] });   // #512 실자료: 이런 메모 10건 중 주문 주소로 그대로 다 나간 것은 0건 → 「제외」를 앞에
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
            cards.push({ id, keys: es.map(keyOf), fix: es.map(keyOf), fixF: ['opt'], type: 'sender-order', tag: '보내는이', title: groupTitle(es), lines: [telLine(e), ['손님 메모', memo], ['처리', only ? '손님 메모가 이름뿐이에요. 보내는 분으로 넣으려면 확인하고 [이대로 넣기]를 눌러 주세요.' : '손님 메모가 분명하지 않아 자동으로 바꾸지 않았어요. 보내는 분을 여기에 적어 넣거나 그대로 둘 수 있어요.'], ...groupLines(es)], sender: { name: guess, phone, addr: '', memo: only ? '' : restOf(e, true, false).rest, orig: memo }, ...(st.ai.tailAsk.get(keyOf(e)) ? { tail: st.ai.tailAsk.get(keyOf(e)) } : {}) });   // 배송메세지 칸 = 보내는이 부탁 글을 뺀 나머지(#516 · 사람이 확인)
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
            if (r.sure && r.rest === '' && !tail) { es.forEach(x => st.memoAuto.set(keyOf(x), true)); info.push({ t: `배송메세지를 기본 문구로: ${groupTitle(es)} — 손님 메모 「${memoOf(e)}」 → 「기본 문구」`, keys: es.map(keyOf) }); return; }
            const id = 'memo:' + keyOf(e); es.forEach(x => st.memoCard.set(keyOf(x), id));
            cards.push({ id, keys: es.map(keyOf), fix: es.map(keyOf), fixF: ['name', 'phone', 'addr', 'opt'], type: 'memo-edit', tag: '배송메세지', title: groupTitle(es), lines: [telLine(e), ['손님 메모', memoOf(e)], ['처리', '보내는이·발송일 부탁 글을 빼고 택배사 양식에 남길 글을 확인해 주세요. 비우면 기본 문구가 들어가요.'], ...groupLines(es)], memo: { rest: r.rest, orig: memoOf(e) }, ...(tail ? { tail } : {}) });
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
            } else if (r.k === 'none') info.push({ t: `주문 없음: ${z.raw}`, line: z.srcLine });
            else if (r.k === 'warn' && !r.n) info.push({ t: `사이즈를 붙일 귤 로얄과 주문이 없어요: ${z.raw}`, line: z.srcLine });
        });
        // #583 ⑥ 「번호 업그레이드」 줄 — 사이즈를 카드에서 눌러 고른다(귤 로얄과만 · 아니면 이유)
        (st.upLines || []).forEach(u => {
            const r = st.upRes && st.upRes.get(u.srcLine); if (!r) return;
            const no = r.hit.filter(e => !r.okE.includes(e));
            const why = !r.hit.length ? '이 번호(구매자 번호·주문번호)의 주문이 배송준비에 없어요.' : !r.okE.length ? '사이즈(2S·S·M·L)는 귤 로얄과 주문에만 붙여요(선물용·소과·중대과·황금향 등은 제외). 이 손님 주문에는 해당 품목이 없어요.' : '';
            cards.push({ id: r.id, type: 'sizeup', tag: '메모 재확인', recheck: true, title: u.raw, keys: r.hit.map(keyOf), ...(r.hit.length ? { fix: r.hit.map(keyOf), fixF: ['name', 'phone', 'addr', 'memo', 'opt'] } : {}), sizes: r.okE.length ? ['2S', 'S', 'M', 'L'] : [], okN: r.okE.length,
                lines: [['직원 메모 줄', u.raw], ...(r.hit.length ? [telLine(r.hit[0])] : []), ...r.hit.slice(0, 6).map((e, i) => [r.hit.length > 1 ? `주문 ${i + 1}` : '주문', orderLine(e) + (r.okE.includes(e) ? '' : ' — 사이즈 지정 대상 아님')]), ...(r.hit.length > 6 ? [['', `그 밖에 ${r.hit.length - 6}건`]] : []),
                    why ? ['안 되는 이유', why] : ['처리', `사이즈를 누르면 귤 로얄과 주문 ${r.okE.length}건의 옵션 끝에 「○사이즈로!」가 붙어요${no.length ? ` (다른 품목 ${no.length}건은 그대로)` : ''}.`],
                    ...(u.expect != null && u.expect !== r.hit.length ? [['건수', `적은 건수 ${u.expect}건 · 실제 주문 ${r.hit.length}건`]] : [])],
                choices: [['skip', '넘어감']] });
        });
        // #583 ⑤ 클코가 틀로 고쳐 쓴 직원 메모 줄 — 원문과 고친 줄을 나란히 보여 주고 사람이 정한다(이대로 / 원문대로 = 고침을 버리고 규칙 판정으로 / 제외 = 그 줄 빼기)
        if (st.lineFix) st.lineFix.forEach((orig, fixed) => {
            if (!memoLines.some(x => x.trim() === fixed)) return;
            cards.push({ id: 'lfix:' + fixed, type: 'line', tag: '메모 재확인', recheck: true, title: fixed, lines: [['원래 적은 줄', orig], ['클코가 고친 줄', fixed], ['처리', '클코가 틀에 맞게 고쳐 쓴 줄이에요(번호는 그대로). 맞으면 [이대로], 아니면 [원문대로](고침을 버리고 적은 그대로 다시 판정) 또는 [제외](이 줄을 메모 칸에서 뺌).']], choices: [['ok', '이대로', 1], ['orig', '원문대로'], ['drop', '제외']] });
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
                    info.push({ t: `주문 없음: ${l.line}${rv.length ? ' (받는 분 번호 — 넘어감)' : l.date && l.date < s.today ? ' (지난 날짜 — 이미 처리된 듯)' : ''}`, line: l.srcLine });
                }
            }
        });
        (st.recvFix || []).forEach(x => info.push(`받는 분 번호로 적은 줄을 주문번호로 바꿈: ${x.raw} → ${x.n}건`));
        (st.prep.notes || []).forEach(n => {
            if (n.type === 'line-split') cards.push({ id: 'lsplit:' + n.srcLine + ':' + n.raw, type: 'line', tag: '메모 줄', title: n.raw, lines: [['이유', '일부 박스만 따로 보내는 줄이에요. 프로그램이 박스를 나누지 않아요.'], ['처리', /입력\s*[oO○0]?\s*[·,]?\s*삭제|개별\s*발송/.test(n.raw) ? '이 줄은 입력삭제라 그 주문이 통째로 택배사 양식에서 빠져요. 현금파일에 그 주문의 박스를 전부(주문 주소로 가는 박스 포함) 적어 주세요. 박스 수가 다르면 「박스 수」 카드가 떠요.' : '따로 보낼 박스는 현금파일에 주소 줄을 적고, 이 구매자를 입력삭제로 적은 뒤 [다시 판정]을 눌러 주세요.']], choices: [['ok', '확인함', 1]] });
            else if (n.type === 'line-noship') cards.push({ id: 'lnoship:' + n.srcLine + ':' + n.raw, type: 'line', tag: '메모 줄', title: n.raw, lines: [['이유', n.detail || '요청한 날이 토요일이거나 발송휴무일이에요.']], choices: [['ok', '확인함', 1]] });
            else if (n.type === 'weekday') info.push({ t: `요일 풀이: ${n.raw} → ${n.detail}`, line: n.srcLine });
            else if (n.type === 'indiv-today') info.push({ t: `날짜 없는 개별발송 줄: ${n.raw} → ${n.detail || '기준 발송일 개별발송으로 읽었어요'}`, line: n.srcLine });
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
        const handExcl = e => { const p = st.patch.get(keyOf(e)); return p && typeof p.excl === 'boolean' && !e.individual ? p : null; };
        s.merged.forEach(e => { if (!e.individual && e.excluded && !e.userTouched && !handExcl(e)) info.push({ t: `오늘 안 나감: ${orderLine(e)} — ${e.req ? `메모 줄 요청일 ${md(e.req.date)}` : `손님 메모 「${memoOf(e)}」`}`, keys: [keyOf(e)], flip: 'send', ...(e.req ? { line: e.req.srcLine } : {}) }); });
        // #583-c(대표 10/8 「오늘 안 나감을 오늘 발송으로 되살리는 길」): 사람이 버튼으로 발송일 판정을 뒤집은 주문 — 참고 줄에 남기고 반대 버튼을 둔다
        s.merged.forEach(e => { const p = handExcl(e); if (p && p.exclBy === 'card') info.push({ t: `${p.excl ? '오늘 안 나감으로' : '오늘 발송으로'} 바꿈(사람): ${orderLine(e)}${memoOf(e) ? ` — 손님 메모 「${memoOf(e)}」` : ''}`, keys: [keyOf(e)], flip: p.excl ? 'send' : 'excl' }); });
        s.merged.forEach(e => { const k = keyOf(e); if (st.ai.memo.has(k) && goingOut(e)) info.push(`AI가 배송메세지 정리: ${orderLine(e)} — 「${memoOf(e)}」 → 「${st.ai.memo.get(k) || '기본 문구'}」`); });
        // #583-f(대표 10/8): AI 읽기가 실패했거나 꺼져 있으면, AI 에 올렸던 메모 가운데 다른 확인 카드가 없는 것을 전부 「메모 확인」 카드로 — 사람이 [그대로 두기]/[기본 문구로]/[제외]를 정해야 파일을 만들 수 있다.
        //   기본 문구·기사님에게 하는 말뿐인 메모는 애초에 AI 에 안 올리므로 카드도 없다. AI 가 다시 읽어 성공하면 이 카드들은 사라지고 AI 결과(AI 처리 카드·확인 카드)로 바뀐다.
        st.missCard = new Map();
        if (st.ai.failed && !st.ai.running) {
            const byK = new Map(s.merged.map(e => [keyOf(e), e])), hasAiCard = k => cards.some(c => AI_KIND[c.type] && (c.keys || [c.id.slice(c.id.indexOf(':') + 1)]).includes(k));
            (st.ai.items || []).forEach(g => {
                const es = (g.keys || []).map(k => byK.get(k)).filter(e => e && !e.individual && (!(e.excluded && !e.userTouched) || e._missExcl) && memoOf(e) === g.memo && !st.ai.byKey.has(keyOf(e)) && !hasAiCard(keyOf(e)) && !st.missCard.has(keyOf(e)));
                if (!es.length) return; const id = 'aimiss:' + keyOf(es[0]); es.forEach(e => st.missCard.set(keyOf(e), id));
                cards.push({ id, keys: es.map(keyOf), fix: es.map(keyOf), fixF: ['name', 'phone', 'addr', 'opt'], type: 'ai-miss', tag: '메모 확인', title: groupTitle(es),
                    lines: [telLine(es[0]), ['손님 메모', g.memo], ['이유', st.ai.off ? 'AI 읽기가 꺼져 있어 사람이 확인해야 해요.' : 'AI가 이 메모를 읽지 못했어요.'], ['처리', '택배 기사님에게 전할 말이면 [그대로 두기], 우리(판매자)에게 한 부탁이면 [기본 문구로]를 눌러 주세요.'], ...groupLines(es)],
                    choices: [['keep', '그대로 두기'], ['def', '기본 문구로'], ['excl', '제외']] });
            });
        }
        s.merged.forEach(e => { const p = st.patch.get(keyOf(e)); if (p && p.tailBy === 'card' && p.tail != null) info.push({ t: p.tail ? `꼬리 지정(사람): ${orderLine(e)}에 「${p.tail}」` : `꼬리 뗌(사람): ${orderLine(e)}`, keys: [keyOf(e)] }); });   // #583-g2
        // #583 ⑨: 참고 줄에서 연 「직접 고치기」 카드(카드가 없는 주문) — 확인할 것에 세지 않는다
        { const byK = new Map(s.merged.map(e => [keyOf(e), e])); [...st.fixOpen].forEach(k => { const e = byK.get(k); if (!e) { st.fixOpen.delete(k); return; } if (cards.some(c => c.fix && c.fix.includes(k))) return;
            // #583-h: 입력삭제 주문은 택배사 양식에서 빠지고 현금파일 주소 줄이 나간다 → 여기서는 옵션명 뒤 꼬리만(같은 구매자 번호의 현금파일 줄 옵션 끝에 붙는다)
            cards.push(e.individual ? { id: 'fix:' + k, type: 'fix', tag: '직접 고치기', title: orderLineNow(e), keys: [k], fix: [k], fixF: ['opt'], tailOnly: true, lines: [telLine(e), ['손님 메모', memoOf(e) || '(없음)'], ['지금 옵션', optOf(e)], ['입력삭제', '이 주문은 현금파일의 주소 줄로 나가요. 주소·보내는 분·배송메세지는 현금파일에서 고치고, 여기서는 옵션명 뒤에 붙일 말만 넣어요(같은 구매자 번호의 현금파일 줄 옵션 끝에 붙어요).']], choices: [] }
                : { id: 'fix:' + k, type: 'fix', tag: '직접 고치기', title: orderLineNow(e), keys: [k], fix: [k], fixF: ['name', 'phone', 'addr', 'memo', 'opt'], lines: [telLine(e), ['손님 메모', memoOf(e) || '(없음)'], ['지금 옵션', optOf(e)]], choices: [] }); }); }
        st.cards = cards; st.info = info;
        // 사라진 주문 카드의 옛 결정은 지운다(같은 카드가 나중에 다시 뜨면 새로 묻는다)
        const live = new Set(cards.map(cd => cd.id));
        [...st.dec.keys()].forEach(id => { if (/^(ord|split|samb|memo):/.test(id) && !live.has(id)) st.dec.delete(id); });
    }
    // 지금 떠 있는 카드의 결정만 인정한다(사라진 카드의 옛 결정이 주문을 빼지 않게 — 워커2 재현 C)
    const liveDec = id => (st.cards.some(cd => cd.id === id) ? st.dec.get(id) : undefined);
    function applyOrderDecisions() {   // 카드 결정 → v2 상태(제외 체크). 판정(saveLines) 뒤마다 다시 건다
        const byKey = new Map(S().merged.map(e => [keyOf(e), e]));
        // #583-f 「메모 확인」 카드의 [제외] — 카드가 사라졌거나 결정이 바뀌면 원래대로(오늘 발송)
        byKey.forEach((e, k) => { const id = st.missCard && st.missCard.get(k), ex = !!id && st.dec.get(id) === 'excl'; if (ex) { e.excluded = true; e.userTouched = true; e._missExcl = true; } else if (e._missExcl) { e.excluded = false; e.userTouched = false; e._missExcl = false; } });
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
    const closed = cd => cd.type === 'fix' || st.dec.has(cd.id) || !!patchDec(cd);
    const pending = () => st.cards.filter(cd => !closed(cd));
    // 검증·스타일용 카드 종류(data-fo-card) — 카드 id 머리말로 정한다
    const KIND = { aimiss: 'ai-miss', lup: 'size-up', lfix: 'line-fix', fix: 'fix', ord: 'order', split: 'split', samb: 'sender-memo', memo: 'memo-edit', 'samb-line': 'sender-line', lbad: 'line', lcnt: 'line', lsplit: 'line', lnoship: 'line', lnodate: 'line', lrecv: 'line-recv', snohit: 'line', cashfmt: 'cash-format', cmiss: 'cash-missing', cnot: 'cash-notindiv', cbox: 'cash-boxdiff', pick: 'partner' };
    const kindOf = cd => KIND[cd.id.split(':')[0]] || cd.type;
    // #525: AI가 손님 메모에서 읽은 「품목 뒤에 붙일 말」 입력칸 — 사람이 [이대로 넣기]를 눌러야 옵션 칸 끝에 붙는다(비우면 안 붙임)
    const tailBoxHtml = (cd, d) => (cd.tail ? `<label class="wide">품목 뒤에 붙일 말(옵션 칸 끝에 붙어요 · 비우면 안 붙임)<input type="text" data-f="tail" value="${esc(d && d.tail != null ? d.tail : cd.tail)}" maxlength="80"></label>` : '');
    // #583 ①: AI가 닫은 카드에 적는 「무엇을 어떻게 바꿨는지」 한 줄
    function aiDid(cd, v) {
        const why = st.ai.tag.get(cd.id) || '', q = t => `「${t || '기본 문구'}」`; let t = '처리했어요';
        if (cd.type === 'order') t = v === 'send' ? '오늘 발송으로 정했어요' : '오늘은 보내지 않게 뺐어요';
        else if (cd.type === 'split') t = '주문 주소로 전부 발송으로 정했어요';
        else if (cd.type === 'sender-order') t = v && v.use ? `보내는 분을 「${/드림$/.test(v.name) ? v.name : v.name + ' 드림'}」으로 바꿨어요${typeof v.memo === 'string' && v.memo !== (cd.sender.orig || '') ? ` · 배송메세지 ${q(cd.sender.orig)} → ${q(v.memo)}` : ''}` : '보내는이는 바꾸지 않았어요';
        else if (cd.type === 'memo-edit') t = v && v.use ? `배송메세지 ${q(cd.memo.orig)} → ${q(v.memo)}` : '배송메세지는 그대로 뒀어요';
        return t + (why ? ' — ' + why : '');
    }
    // #583 ⑦(대표 10/8 「확인 카드에서 전부 고치기」): 카드 안 접이식 「이 주문 직접 고치기」 — 보내는 분 이름·번호·주소 · 배송메세지 · 옵션명.
    //   [적용] = 대화 칸에서 말로 바꾼 것과 같은 길(st.patch → 결과 파일의 연보라 칸 · 「말로 바꾼 것」 목록 · [되돌리기]). 그 카드에 이미 있는 입력칸(배송메세지·보내는이)은 겹쳐 두지 않는다(cd.fixF).
    st.fixDraft = new Map(); st.fixOpen = new Set();
    const FIX_LABEL = { name: '보내는 분 이름(바꿀 때만 · 「드림」 자동)', phone: '보내는 분 번호(바꿀 때만)', addr: '보내는이 주소(바꿀 때만)', memo: '택배사 양식 배송메세지(비우면 기본 문구)', opt: '옵션명(품목별 금액에 있는 이름만)' };
    function fixCur(cd) {
        const byKey = new Map(S().merged.map(e => [keyOf(e), e])), es = (cd.fix || []).map(k => byKey.get(k)).filter(Boolean); if (!es.length) return null;
        const e = es[0], p = st.patch.get(keyOf(e)) || {}, sd = p.sender || {};
        return { es, sameOpt: es.every(x => baseName(x) === baseName(e)), byCard: es.some(x => (st.patch.get(keyOf(x)) || {}).by === 'card'),
            cur: { name: sd.name || '', phone: sd.phone || '', addr: sd.addr || '', memo: p.memo != null ? p.memo : String(e.conv['배송메세지'] || '').replace(/\r/g, '').trim(), opt: baseName(e), tail: (() => { const full = optOf(e), b0 = baseName(e); return full.length > b0.length && full.startsWith(b0) ? full.slice(b0.length).trim() : ''; })() } };
    }
    // #583-b(대표 10/8 「옵션명을 누르면 단가표 이름 목록이 펼쳐지게」): 옵션명 칸 = 고르는 목록(그 주문의 거래처 품목이 먼저 · 다른 거래처는 아래 묶음) · 품목이 많으면 위에 글자 거르기 칸
    function optGroups(cur) {
        const bp = st.byPartner || {}, c = core(), mine = c.partnerOf(cur, bp), ps = Object.keys(bp).sort((a, b) => (a === mine ? -1 : b === mine ? 1 : 0));
        return ps.map(p => ({ p: c.shortPartner(p) + (p === mine ? ' (이 주문의 거래처)' : ''), names: [...new Set(bp[p] || [])] })).filter(g => g.names.length);
    }
    // #583-g1(대표 10/8 「브라우저 기본 목록 말고 우리 디자인으로」): 옵션명 = 입력칸처럼 생긴 버튼 → 누르면 펼쳐지는 목록 창(거래처 묶음 머리 · 지금 값 체크 · 위에 글자 거르기 · ↑↓/Enter/Esc · 바깥 누름 닫기 · 폰은 아래에서 올라오는 시트).
    //   창은 카드 밖(#fo-panel 바로 아래)에 하나만 둔다 — 카드가 다시 그려져도(AI 결과 도착 등) 열린 채로 남고, 고를 때 그 카드의 숨은 칸([data-x="opt"])을 다시 찾아 값을 넣는다. 값은 종전처럼 단가표 이름만.
    const OP = { open: false, id: '', cur: '', sel: '', act: -1, n: 0 };
    const optBtn = () => [...document.querySelectorAll('#fo-cards [data-optbtn]')].find(b => b.dataset.optbtn === OP.id) || null;
    const optMobile = () => window.matchMedia('(max-width: 640px)').matches;
    function optEl() {
        let p = $('fo-optpanel'); if (p) return p;
        const host = $('fo-panel'), bk = document.createElement('div'); bk.className = 'fo-optback'; bk.id = 'fo-optback'; bk.hidden = true; host.appendChild(bk);
        p = document.createElement('div'); p.className = 'fo-optpanel'; p.id = 'fo-optpanel'; p.hidden = true; p.tabIndex = -1; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', '옵션명 고르기');
        p.innerHTML = '<div class="fo-optpanel-head"><b>옵션명 고르기</b><span class="fo-optpanel-n" data-optn aria-live="polite"></span><button type="button" class="fo-optpanel-x" data-optclose>닫기</button></div>'
            + '<div class="fo-optpanel-q"><input type="text" inputmode="search" id="fo-optq" placeholder="검색 (예: 2.5 · 로얄과 4kg)" aria-label="옵션명 검색" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="fo-optrows"></div>'
            + '<div class="fo-optrows" id="fo-optrows" role="listbox" aria-label="품목별 금액에 있는 이름"></div>';
        host.appendChild(p);
        p.addEventListener('click', e => { if (e.target.closest('[data-optclose]')) return optClose(true); const r = e.target.closest('.fo-optrow'); if (r) optPick(r.dataset.v); });
        p.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (OP.n) optAct(OP.act < 0 ? (e.key === 'ArrowDown' ? 0 : OP.n - 1) : Math.max(0, Math.min(OP.n - 1, OP.act + (e.key === 'ArrowDown' ? 1 : -1)))); }
            else if (e.key === 'Home' && OP.n && e.target.id !== 'fo-optq') { e.preventDefault(); optAct(0); }
            else if (e.key === 'End' && OP.n && e.target.id !== 'fo-optq') { e.preventDefault(); optAct(OP.n - 1); }
            else if (e.key === 'Enter') { e.preventDefault(); const r = $('fo-optrows').querySelector('.fo-optrow.act'); if (r) optPick(r.dataset.v); }
            else if (e.key === 'Tab') { e.preventDefault(); optClose(true); }
        });
        $('fo-optq').addEventListener('input', () => optDraw());
        bk.addEventListener('click', () => optClose(false));
        return p;
    }
    function optDraw() {
        // 연관검색처럼(대표 10/8): 「2.5」만 쳐도 「2.5kg」가 든 품목 전부 · 띄어쓰기·괄호·「kg」 유무 무시 · 띄어 쓴 낱말은 모두 포함 · 맞는 글자 옅은 강조
        const sq = t => String(t || '').toLowerCase().replace(/kg/g, '').replace(/[\s()\[\]{}·:,\/\-_~*]/g, '');
        const raw = String($('fo-optq').value || '').toLowerCase().split(/\s+/).filter(Boolean), ws = raw.map(sq).filter(Boolean), hit = n => { const x = sq(n); return ws.every(w => x.includes(w)); }, gs = optGroups(OP.cur);
        const mark = n => {   // 원문에서 글자 그대로 찾아지는 낱말만 강조(「kg」를 뗀 꼴도)
            const low = n.toLowerCase(), rg = []; [...new Set(raw.concat(raw.map(w => w.replace(/kg/g, ''))))].filter(Boolean).forEach(w => { for (let k = low.indexOf(w); k >= 0; k = low.indexOf(w, k + w.length)) rg.push([k, k + w.length]); });
            if (!rg.length) return esc(n); rg.sort((a, b) => a[0] - b[0]); let out = '', at = 0;
            rg.forEach(([a, b]) => { if (b <= at) return; a = Math.max(a, at); out += esc(n.slice(at, a)) + '<mark class="fo-optmk">' + esc(n.slice(a, b)) + '</mark>'; at = b; });
            return out + esc(n.slice(at));
        };
        let i = 0, h = ''; const row = (n, extra) => `<button type="button" role="option" class="fo-optrow${n === OP.sel ? ' on' : ''}" id="fo-optrow-${i}" data-i="${i++}" data-v="${esc(n)}" aria-selected="${n === OP.sel}"><span class="fo-optrow-t">${mark(n)}${extra || ''}</span>${n === OP.sel ? '<span class="fo-optck" aria-hidden="true"></span>' : ''}</button>`;
        const lost = [...new Set([OP.cur, OP.sel])].filter(n => n && !gs.some(g => g.names.includes(n)) && hit(n));   // 단가표에 없는 지금 이름(거래처 미정)도 보이게
        if (lost.length) h += '<div class="fo-optgrp" role="presentation">지금 이름(단가표에 없음)</div>' + lost.map(n => row(n)).join('');
        gs.forEach(g => { const ns = g.names.filter(hit); if (ns.length) h += `<div class="fo-optgrp" role="presentation">${esc(g.p)}</div>` + ns.map(n => row(n)).join(''); });
        $('fo-optrows').innerHTML = h || '<p class="fo-optnone">없음 — 품목별 금액에 등록해 주세요.</p>';
        OP.n = i; const cnt = $('fo-optpanel').querySelector('[data-optn]'); cnt.textContent = ws.length ? `${i}개` : `전체 ${i}개`;
        const on = $('fo-optrows').querySelector('.fo-optrow.on'); optAct(on ? Number(on.dataset.i) : (ws.length && i ? 0 : -1));
    }
    function optAct(i) {
        OP.act = i; const rows = $('fo-optrows'); rows.querySelectorAll('.fo-optrow.act').forEach(r => r.classList.remove('act'));
        const r = i >= 0 ? rows.querySelector(`.fo-optrow[data-i="${i}"]`) : null;
        if (r) { r.classList.add('act'); $('fo-optq').setAttribute('aria-activedescendant', r.id); if (typeof r.scrollIntoView === 'function') r.scrollIntoView({ block: 'nearest' }); } else $('fo-optq').removeAttribute('aria-activedescendant');
    }
    function optPlace() {
        const p = $('fo-optpanel'), b = optBtn(); if (!p || !b) return;
        if (optMobile()) { ['left', 'top', 'width', 'maxHeight', 'bottom'].forEach(k => { p.style[k] = ''; }); return; }   // 폰 = 시트(자리·크기는 CSS)
        const r = b.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth, w = Math.max(300, Math.min(560, r.width)), below = vh - r.bottom - 12, above = r.top - 12, up = below < 280 && above > below;
        p.style.width = w + 'px'; p.style.left = Math.max(8, Math.min(vw - w - 8, r.left)) + 'px'; p.style.maxHeight = Math.max(200, Math.min(440, up ? above : below)) + 'px';
        if (up) { p.style.top = ''; p.style.bottom = (vh - r.top + 6) + 'px'; } else { p.style.bottom = ''; p.style.top = (r.bottom + 6) + 'px'; }
        p.dataset.up = up ? '1' : '';
    }
    function optOpen(btn) {
        if (st.busy || btn.disabled) return; const box = btn.closest('.fo-optpick'), hid = box && box.querySelector('[data-x="opt"]'); if (!hid) return;
        const p = optEl(); OP.open = true; OP.id = btn.dataset.optbtn; OP.cur = btn.dataset.cur || ''; OP.sel = hid.value; $('fo-optq').value = '';
        p.hidden = false; $('fo-optback').hidden = false; btn.setAttribute('aria-expanded', 'true'); optPlace(); optDraw();
        if (optMobile()) p.focus({ preventScroll: true }); else $('fo-optq').focus({ preventScroll: true });   // 폰은 자판이 시트를 가리지 않게 거르기 칸에 바로 커서를 두지 않는다
    }
    function optClose(focusBack) {
        if (!OP.open) return; OP.open = false; const p = $('fo-optpanel'), b = optBtn();
        if (p) p.hidden = true; if ($('fo-optback')) $('fo-optback').hidden = true;
        if (b) { b.setAttribute('aria-expanded', 'false'); if (focusBack) b.focus({ preventScroll: true }); }
    }
    function optPick(v) {
        const b = optBtn(); if (!b) return optClose(false);
        const box = b.closest('.fo-optpick'), hid = box.querySelector('[data-x="opt"]'); hid.value = v; box.querySelector('.fo-optbtn-t').textContent = v; b.setAttribute('aria-label', '옵션명 고르기 — 지금: ' + v);
        box.classList.toggle('changed', v !== (b.dataset.cur || ''));
        tailSync(b.closest('.fo-fix')); optClose(true);
    }
    document.addEventListener('pointerdown', e => { if (OP.open && !(e.target.closest && (e.target.closest('#fo-optpanel') || e.target.closest('[data-optbtn]')))) optClose(false); }, true);
    document.addEventListener('keydown', e => { if (OP.open && e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); optClose(true); } }, true);   // 창만 닫는다(최종발주 화면의 Esc 닫기보다 먼저)
    window.addEventListener('resize', () => { if (OP.open) optPlace(); });
    // #583-h(대표 「고」 10/8): 「주문 찾아 고치기」 — 카드도 참고 줄도 없는 평범한 주문에 「직접 고치기」를 여는 길. 이름·받는 분·번호 끝자리·옵션 낱말·주문번호로 찾는다(목록 창과 같은 정규화 · 치는 즉시 · 최대 8건).
    //   줄을 누르면 그 주문의 카드로 가거나(있으면) 「직접 고치기」 카드를 새로 띄운다(확인할 것에 안 셈 · [닫기]). 입력삭제 주문도 찾힌다(꼬리만 — 현금파일 줄에 붙는다).
    const FD = { open: false, act: -1, keys: [] }, FIND_MAX = 8;
    const findSq = t => String(t || '').toLowerCase().replace(/kg/g, '').replace(/[\s()\[\]{}·:,\/\-_~*]/g, '');
    function findOrders(q) {
        const ws = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).map(w => ({ t: findSq(w), d: /^[\d\-]+$/.test(w) ? w.replace(/\D/g, '') : '' })).filter(w => w.t || w.d);
        if (!ws.length) return [];
        return S().merged.filter(e => {
            const hay = findSq([buyerName(e), e.conv['수취인명'], optOf(e), CH_LABEL[e.ch]].join(' ')), nums = [buyerTel(e), digitsOf(e.conv['수취인연락처1']), digitsOf(e.conv['수취인연락처2'])].filter(Boolean), ids = idsOf(e).map(digitsOf).filter(Boolean);
            return ws.every(w => (w.d && w.d.length >= 3 ? nums.some(n => n.endsWith(w.d) || (w.d.length >= 7 && n.includes(w.d))) || ids.some(n => n === w.d || (w.d.length >= 6 && n.endsWith(w.d))) : false) || (!!w.t && hay.includes(w.t)));
        });
    }
    function findState(e) {
        const k = keyOf(e); if (e.individual) return ['입력삭제', 'indiv'];
        const cd = st.cards.find(c => c.type !== 'fix' && ((c.keys || [c.id.slice(c.id.indexOf(':') + 1)]).includes(k)));
        if (cd && !closed(cd)) return ['확인할 카드 있음', 'warn']; if (cd && isAiDone(cd)) return [e.excluded ? 'AI 처리 · 오늘 안 나감' : 'AI 처리', 'memo'];
        if (e.excluded) return ['오늘 안 나감', 'warn']; return [cd ? '오늘 발송 · 카드 있음' : '오늘 발송', 'size'];
    }
    function findDraw() {
        const inp = $('fo-find-q'), box = $('fo-find-list'), q = String(inp.value || '').trim();
        if (!q || !st.judged) { FD.open = false; FD.keys = []; box.hidden = true; box.innerHTML = ''; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); return; }
        const all = findOrders(q), show = all.slice(0, FIND_MAX); FD.keys = show.map(keyOf); FD.open = true; box.hidden = false; inp.setAttribute('aria-expanded', 'true');
        const tel4 = e => { const d = buyerTel(e); return d ? '번호 끝 ' + d.slice(-4) : ''; };
        box.innerHTML = show.length ? show.map((e, i) => { const stt = findState(e); return `<button type="button" role="option" class="fo-find-row" id="fo-find-row-${i}" data-find="${i}" aria-selected="false"><span class="fo-find-t"><b>${esc(whoOf(e))}</b><span>${esc(CH_LABEL[e.ch] || '')} · ${esc(optOf(e))} · ${esc(String(qtyNow(e)))}박스${tel4(e) ? ' · ' + esc(tel4(e)) : ''}</span></span><span class="fo-ibadge" data-k="${stt[1]}">${esc(stt[0])}</span></button>`; }).join('') + (all.length > show.length ? `<p class="fo-find-more">외 ${all.length - show.length}건 — 글자를 더 적어 좁혀 주세요.</p>` : '') : '<p class="fo-find-more" data-find-none="1">맞는 주문이 없어요 — 이름·번호 끝자리·옵션 낱말을 다시 확인해 주세요.</p>';
        findAct(show.length ? 0 : -1);
    }
    function findAct(i) {
        FD.act = i; const box = $('fo-find-list'); box.querySelectorAll('.fo-find-row').forEach(x => { const on = Number(x.dataset.find) === i; x.classList.toggle('act', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); if (on && typeof x.scrollIntoView === 'function') x.scrollIntoView({ block: 'nearest' }); });
        if (i >= 0) $('fo-find-q').setAttribute('aria-activedescendant', 'fo-find-row-' + i); else $('fo-find-q').removeAttribute('aria-activedescendant');
    }
    function findClose(clear) { FD.open = false; FD.keys = []; const box = $('fo-find-list'), inp = $('fo-find-q'); if (!box) return; box.hidden = true; box.innerHTML = ''; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); if (clear) inp.value = ''; }
    function findPick(i) { const k = FD.keys[i]; if (!k || st.busy || !st.judged) return; findClose(true); fixGo([k]); }
    document.addEventListener('pointerdown', e => { if (FD.open && !(e.target.closest && e.target.closest('#fo-find'))) findClose(false); }, true);
    document.addEventListener('keydown', e => { if (FD.open && e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); findClose(false); } }, true);   // 목록만 닫는다(최종발주 화면의 Esc 닫기보다 먼저)
    // #583-g2(대표 10/8 「옵션명을 고른 뒤 그 뒤에 붙일 꼬리를 쓰는 칸」): 택배사 양식 옵션 칸에 「옵션명 + 꼬리」로 그대로 나간다. 꼴은 기존 꼬리와 같게 — 「2S사이즈로!」 「15과로!」(숫자·사이즈만 적으면 꼴을 맞춰 준다).
    //   사이즈 꼬리는 귤 로얄과만(#554) — 다른 품목에 쓰면 막지 않고 칸 아래에 안내만(직원이 알고 쓰는 것).
    const TAIL_SIZE_IN = /^(2S|2L|S|M|L)\s*(?:사이즈)?\s*(?:로)?\s*!?$/i, TAIL_GWA_IN = /^(\d{1,2})\s*과?\s*(?:로)?\s*!?$/;
    const MANGAM = /황금향|한라봉|레드향|천혜향|카라향|만감/;
    function tailNorm(raw) {
        const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim(); if (!t) return '';
        let m = t.match(TAIL_SIZE_IN); if (m) return m[1].toUpperCase() + '사이즈로!';
        m = t.match(TAIL_GWA_IN); if (m) return Number(m[1]) + '과로!';
        return normTail(t.slice(0, 40));
    }
    const tailIsSize = t => /^(?:2S|2L|S|M|L)사이즈로!$/.test(t);
    function tailChips(opt, tv) {
        const on = tailNorm(tv), chip = (v, lab) => `<button type="button" class="fo-chip${on === v ? ' on' : ''}" data-tailset="${esc(v)}" aria-pressed="${on === v}">${esc(lab)}</button>`;
        let h = '';
        if (sizeItem(opt)) h = ['2S', 'S', 'M', 'L'].map(z => chip(z + '사이즈로!', z)).join('');
        else if (MANGAM.test(opt)) h = (st.tailRecent || []).map(v => chip(v, v.replace(/로!$/, ''))).join('') + '<span class="fo-chiphint">과수는 숫자만 적으면 돼요(15 → 「15과로!」)</span>';
        return h + '<button type="button" class="fo-chip clear" data-tailset=""' + (on ? '' : ' hidden') + '>꼬리 없음</button>';
    }
    function tailSync(fx) {
        const tb = fx && fx.querySelector('[data-tailbox]'); if (!tb) return;
        const opt = (fx.querySelector('[data-x="opt"]') || {}).value || '', ti = tb.querySelector('[data-x="tail"]');
        // #583-j(검증에서 발견): 칸에 글을 적은 뒤 칩을 바로 누르면, 누르는 순간 칸이 초점을 잃으며 칩 줄을 새로 그려 그 누름이 사라졌다 → 칩 종류가 같으면 새로 그리지 않고 켜짐 표시만 바꾼다
        const cb = tb.querySelector('[data-tailchips]'), on = tailNorm(ti.value), kind = sizeItem(opt) ? 'S' : MANGAM.test(opt) ? 'G:' + (st.tailRecent || []).join(',') : '-';
        if (cb.dataset.k !== kind) { cb.innerHTML = tailChips(opt, ti.value); cb.dataset.k = kind; }
        else cb.querySelectorAll('.fo-chip').forEach(c => { if (c.classList.contains('clear')) { c.hidden = !on; return; } const is = c.dataset.tailset === on; c.classList.toggle('on', is); c.setAttribute('aria-pressed', is ? 'true' : 'false'); });
        tb.querySelector('[data-tailwarn]').hidden = !(tailIsSize(tailNorm(ti.value)) && !sizeItem(opt));
    }
    function onFixInput(e) { const ti = e.target.closest && e.target.closest('input[data-x="tail"]'); if (ti) tailSync(ti.closest('.fo-fix')); }
    function fixHtml(cd, opts) {
        if (!cd.fix || !cd.fixF) return ''; const F = fixCur(cd); if (!F) return '';
        const fd = st.fixDraft.get(cd.id) || {}, val = f => esc(fd.vals && fd.vals[f] != null ? fd.vals[f] : F.cur[f]), wide = f => (f === 'name' || f === 'phone' ? '' : ' class="wide"');
        const optSel = fd.vals && fd.vals.opt != null ? fd.vals.opt : F.cur.opt;
        const dis = F.sameOpt ? '' : ' disabled', optDis = F.sameOpt && !cd.tailOnly ? '' : ' disabled', tv = fd.vals && fd.vals.tail != null ? fd.vals.tail : F.cur.tail;
        const optBox = () => `<div class="wide fo-optpick${optSel !== F.cur.opt ? ' changed' : ''}" data-optpick><span class="fo-optlab">${cd.tailOnly ? '옵션명(입력삭제 주문 — 현금파일 줄 그대로)' : FIX_LABEL.opt}${F.sameOpt ? '' : ' — 묶인 주문의 품목이 달라 여기서는 못 바꿔요'}</span><input type="hidden" data-x="opt" value="${esc(optSel)}"${optDis}><button type="button" class="fo-optbtn" data-optbtn="${esc(cd.id)}" data-cur="${esc(F.cur.opt)}" aria-haspopup="listbox" aria-expanded="false" aria-label="옵션명 고르기 — 지금: ${esc(optSel)}"${optDis}><span class="fo-optbtn-t">${esc(optSel)}</span><span class="fo-optbtn-ar" aria-hidden="true"></span></button></div>`
            + `<div class="wide fo-tailbox" data-tailbox><label>옵션명 뒤에 붙일 말(비우면 안 붙임 · 택배사 양식 옵션 칸 끝에 그대로)<input type="text" data-x="tail" value="${esc(tv)}" maxlength="40" placeholder="예: 2S사이즈로! · 15과로!" autocomplete="off"${dis}></label><div class="fo-tailchips" data-tailchips>${F.sameOpt ? tailChips(optSel, tv) : ''}</div><p class="fo-tailwarn" data-tailwarn role="status"${tailIsSize(tailNorm(tv)) && !sizeItem(optSel) ? '' : ' hidden'}>사이즈 지정은 귤 로얄과만 해요 · 황금향 같은 만감류는 과수(「15과로!」)로 적어 주세요.</p></div>`;
        const field = f => f === 'memo' ? `<label class="wide">${FIX_LABEL.memo}<textarea data-x="memo" rows="2" maxlength="300">${val('memo')}</textarea></label>`
            : f === 'opt' ? optBox()
            : `<label${wide(f)}>${FIX_LABEL[f]}<input type="text" data-x="${f}" value="${val(f)}" maxlength="${f === 'name' ? 20 : f === 'phone' ? 14 : 120}"${f === 'phone' ? ' inputmode="tel"' : ''}></label>`;
        const open = cd.type === 'fix' || fd.open || F.byCard || (opts && opts.open);   // 여기서 고친 것이 있으면 펼쳐 둔다([되돌리기]가 보이게)
        // #583-c: 발송일 판정 뒤집기 줄 — 참고 줄에서 연 카드와 사람이 뒤집은 주문 카드에만(열린 주문 확인 카드는 [오늘 발송]/[제외]가 이미 있다)
        const flipOk = (cd.type === 'fix' || (opts && opts.flip)) && F.es.every(e => !e.individual), exN = F.es.filter(e => e.excluded).length, hand = F.es.some(e => typeof (st.patch.get(keyOf(e)) || {}).excl === 'boolean');
        const flipRow = !flipOk || (exN && exN < F.es.length) ? '' : `<div class="fo-flip" data-flip-row="${exN ? 'excl' : 'send'}"><span class="fo-flip-now" data-k="${exN ? 'excl' : 'send'}">지금: ${exN ? '오늘 안 나감' : '오늘 발송'}${hand ? ' (사람이 바꿈)' : ''}</span><button type="button" class="fo-btn sm${exN ? ' primary' : ''}" data-flip="${exN ? 'send' : 'excl'}" data-id="${esc(cd.id)}">${exN ? '오늘 발송으로' : '오늘 안 나감으로'}</button><p class="fo-flip-note">${exN ? '배송메세지 칸은 택배사 양식 글만 바꿔요 · 발송일을 바꾸려면 [오늘 발송으로]를 눌러요(이번 발주 파일에 들어가요).' : '배송메세지 칸은 택배사 양식 글만 바꿔요 · 오늘 보내지 않으려면 [오늘 안 나감으로]를 눌러요.'}</p></div>`;
        return `<details class="fo-fix" data-fix="${esc(cd.id)}"${open ? ' open' : ''}><summary>이 주문 직접 고치기 <small>${cd.fixF.map(f => ({ name: '보내는 분', phone: '', addr: '보내는이 주소', memo: '배송메세지', opt: '옵션명' }[f])).filter(Boolean).join(' · ')}${F.es.length > 1 ? ` · 묶인 ${F.es.length}건 모두` : ''}</small></summary>${flipRow}<div class="fo-edit">${cd.fixF.map(field).join('')}</div><div class="fo-card-acts"><button type="button" class="fo-btn sm primary" data-fix-apply="${esc(cd.id)}">적용</button>${F.byCard ? `<button type="button" class="fo-btn sm" data-fix-undo="${esc(cd.id)}">되돌리기</button>` : ''}<span class="fo-msg" data-fix-msg role="status">${F.byCard ? '여기서 고친 것이 있어요(결과 파일의 연보라 칸).' : ''}</span></div></details>`;
    }
    async function fixApply(id, btn) {
        const cd = st.cards.find(c => c.id === id), box = btn.closest('.fo-fix'), F = cd && fixCur(cd); if (!cd || !box || !F || st.busy) return;
        const msg = box.querySelector('[data-fix-msg]'), say = t => { msg.textContent = t; msg.classList.add('err'); };
        const get = f => { const el = box.querySelector(`[data-x="${f}"]`); return el && !el.disabled ? String(el.value || '').replace(/\r/g, '').trim() : null; };
        const v = { name: get('name'), phone: get('phone'), addr: get('addr'), memo: get('memo'), opt: get('opt') }, set = {};
        if (v.name != null && (v.name !== F.cur.name || v.phone !== F.cur.phone || v.addr !== F.cur.addr)) {
            if (!v.name) { say(v.phone || v.addr ? '보내는 분 이름을 적어 주세요.' : '보내는 분을 지우려면 [되돌리기]를 눌러 주세요.'); box.querySelector('[data-x="name"]').focus(); return; }
            set.sender = { name: v.name.replace(/\s*(드림|올림)$/, ''), phone: v.phone || '', addr: v.addr || '' };
        }
        if (v.memo != null && v.memo !== F.cur.memo) set.memo = v.memo;
        if (v.opt != null && v.opt !== F.cur.opt) { if (!inCatalog(v.opt)) { say('품목별 금액(단가표)에 없는 이름이에요 — 목록에서 골라 주세요.'); (box.querySelector('[data-optbtn]') || box.querySelector('[data-x="opt"]')).focus(); return; } set.opt = v.opt; }
        { const tr = get('tail'); if (tr != null) { const tv = tailNorm(tr); if (tv !== F.cur.tail || F.es.some(e => String(optOf(e)).trim() !== withTail(set.opt != null ? set.opt : baseName(e), tv))) { set.tail = tv; set.tailBy = 'card'; }   // #583-i: 비교 기준 = 지금 실제로 나갈 옵션 글(옵션명 + 꼬리 · 손님 메모로 붙은 꼬리 포함) — 묶인 주문 가운데 하나라도 다르면 적용 else if (set.opt != null && F.cur.tail && F.es.some(e => tailOf(e) === undefined)) { set.tail = F.cur.tail; set.tailBy = 'card'; }   // 옵션명만 바꿔도 손님 메모로 붙어 있던 꼬리는 칸에 보이는 그대로 남긴다
            if (set.tail && /^\d+과로!$/.test(set.tail)) st.tailRecent = [set.tail].concat((st.tailRecent || []).filter(x => x !== set.tail)).slice(0, 4); } }
        if (!Object.keys(set).length) { say(F.byCard ? '바꾼 것이 없어요 — 앞서 고친 내용은 이미 적용돼 있어요(위 카드 머리와 「말로 바꾼 것」 목록에서 볼 수 있어요).' : '바꾼 것이 없어요.'); return; }
        F.es.forEach(e => { const k = keyOf(e), np = Object.assign({}, st.patch.get(k) || {}, set, { by: 'card' }); if (set.opt != null) delete np.optAll; st.patch.set(k, np); });
        st.fixDraft.set(id, { open: true }); box.dataset.skip = '1';
        const had = st.phase === 'result' && st.files.length > 0;
        st.out = null; st.files = []; $('fo-result').hidden = true; clearMsg(); renderSummaryOnly(); syncChat(); toast('고친 내용을 적용했어요');
        if (had) await remake();
    }
    async function fixUndo(id) {
        const cd = st.cards.find(c => c.id === id), F = cd && fixCur(cd); if (!F || st.busy) return;
        F.es.forEach(e => { const k = keyOf(e), p = Object.assign({}, st.patch.get(k) || {}); if (p.by !== 'card') return; ['sender', 'memo', 'opt', 'optAll', 'by'].forEach(f => delete p[f]); if (p.tailBy === 'card') { delete p.tail; delete p.tailBy; } if (Object.keys(p).length) st.patch.set(k, p); else st.patch.delete(k); });
        st.fixDraft.set(id, { open: true }); const box = document.querySelector(`#fo-cards .fo-fix[data-fix="${window.CSS && CSS.escape ? CSS.escape(id) : id}"]`); if (box) box.dataset.skip = '1';
        const had = st.phase === 'result' && st.files.length > 0;
        st.out = null; st.files = []; $('fo-result').hidden = true; clearMsg(); renderSummaryOnly(); syncChat();
        if (had) await remake();
    }
    // #583-c: 발송일 판정을 사람이 뒤집는다 — 대화 칸의 「오늘 발송으로/제외」와 같은 길(st.patch.excl → applyOrderDecisions → 결과 파일 · 「말로 바꾼 것」 목록 · [되돌리기]).
    //   앞서 뒤집은 것을 되돌릴 때는 그 말을 지우고 다시 판정한다(엔진 판정값으로). 배송메세지 칸에 적어 둔 글이 있으면 같이 넣는다(비우면 기본 문구).
    async function exclFlip(keys, toSend, memoVal) {
        if (st.busy || !keys.length) return false;
        const byKey = () => new Map(S().merged.map(e => [keyOf(e), e])); let m = byKey(), back = false;
        keys = keys.filter(k => m.get(k) && !m.get(k).individual); if (!keys.length) return false;
        keys.forEach(k => {
            const p = Object.assign({}, st.patch.get(k) || {});
            if (typeof p.excl === 'boolean' && p.excl === toSend) { delete p.excl; delete p.exclBy; back = true; } else { p.excl = !toSend; p.exclBy = 'card'; }
            if (toSend && memoVal != null) { p.memo = memoVal; p.by = 'card'; }
            if (Object.keys(p).length) st.patch.set(k, p); else st.patch.delete(k);
        });
        const had = st.phase === 'result' && st.files.length > 0;
        st.out = null; st.files = []; $('fo-result').hidden = true; clearMsg();
        if (back) {
            for (let i = 0; i < 1200 && st.ai.running; i++) await sleep(500);
            await run(judge); m = byKey();
            keys.forEach(k => { const e = m.get(k); if (e && !e.individual && !!e.excluded === toSend) st.patch.set(k, Object.assign({}, st.patch.get(k) || {}, { excl: !toSend, exclBy: 'card' })); });   // 엔진 판정이 바라는 쪽과 다르면 사람 결정으로 남긴다
        }
        applyOrderDecisions(); renderSummaryOnly(); syncChat(); toast(toSend ? '오늘 발송으로 바꿨어요' : '오늘 안 나감으로 바꿨어요');
        if (had) await remake();
        return true;
    }
    async function onFlipClick(b) {
        const cd = st.cards.find(c => c.id === b.dataset.id), F = cd && fixCur(cd); if (!F) return;
        const toSend = b.dataset.flip === 'send', box = b.closest('.fo-fix'), el = box && box.querySelector('[data-x="memo"]'), mv = el ? String(el.value || '').replace(/\r/g, '').trim() : null;
        const keys = F.es.map(keyOf); keys.forEach(k => st.fixOpen.add(k)); st.fixDraft.set(cd.id, { open: true }); if (box) box.dataset.skip = '1';
        await exclFlip(keys, toSend, toSend && mv != null && mv !== F.cur.memo ? mv : null);   // #583-j: 카드 안에서 누른 것이라 자리 그대로(참고 줄의 버튼만 그 카드로 이동)
    }
    function goKeys(keys) { const i = st.info.findIndex(it => typeof it === 'object' && it.keys && it.keys.some(k => keys.includes(k))); if (i >= 0) return infoGo(i); const cd = st.cards.find(c => c.fix && keys.some(k => c.fix.includes(k))), el = cd && [...document.querySelectorAll('#fo-cards .fo-card')].find(c => c.dataset.id === cd.id); if (el) el.scrollIntoView({ block: 'center' }); }
    async function infoFlip(i) {
        const it = st.info[i]; if (!it || typeof it !== 'object' || !it.flip || !(it.keys || []).length) return;
        it.keys.forEach(k => st.fixOpen.add(k));
        if (await exclFlip(it.keys.slice(), it.flip === 'send', null)) goKeys(it.keys);
    }
    // #583 ⑤ 클코가 고쳐 쓴 줄을 [원문대로](고침을 버리고 적은 그대로 → 규칙 판정) 또는 [제외](그 줄을 뺌)
    async function lineFixBack(id, how) {
        const fixed = id.slice(5), orig = st.lineFix && st.lineFix.get(fixed); if (orig == null || st.busy) return;
        const memo = $('fo-memo'), lines = memo.value.replace(/\r/g, '').split('\n'), i = lines.findIndex(x => x.trim() === fixed); if (i < 0) return;
        if (how === 'orig') lines[i] = orig; else lines.splice(i, 1);
        memo.value = lines.join('\n'); st.lineFix.delete(fixed); st.dec.delete(id);
        (st.lineFixTried = st.lineFixTried || new Set()).add(orig);   // 같은 줄을 클코에게 다시 묻지 않는다
        const had = st.phase === 'result' && st.files.length > 0;
        st.out = null; st.files = []; $('fo-result').hidden = true; clearMsg();
        for (let k = 0; k < 1200 && st.ai.running; k++) await sleep(500);
        await run(judge);
        if (had) await remake();
    }
    // #583 ⑨: 「참고」 줄을 누르면 그 주문의 카드(없으면 「직접 고치기」 카드를 새로)로 가거나 메모 칸의 그 줄로 간다
    function infoGo(i) {
        const it = st.info[i]; if (!it || typeof it !== 'object') return;
        const keys = it.keys || [];
        if (keys.length) fixGo(keys);
        else if (it.line != null) { $('fo-memo-sec').scrollIntoView({ block: 'center' }); selectMemoLine(it.line); }
    }
    // 그 주문의 카드(없으면 「직접 고치기」 카드를 새로)로 가서 펼친다 — 참고 줄 [고치기]와 「주문 찾아 고치기」(#583-h)가 같이 쓴다
    function fixGo(keys) {
        st.anchor = null;
        {
            let cd = st.cards.find(c => c.fix && keys.some(k => c.fix.includes(k)));
            if (!cd) { keys.slice(0, 1).forEach(k => st.fixOpen.add(k)); renderSummaryOnly(); cd = st.cards.find(c => c.id === 'fix:' + keys[0]); }
            if (!cd) return;
            if (st.kindFilter) { st.kindFilter = ''; renderReview(); }
            const find = () => [...document.querySelectorAll('#fo-cards .fo-card')].find(c => c.dataset.id === cd.id); let el = find(); if (!el) return;
            if (!el.querySelector('.fo-fix')) { st.fixOpen.add(keys.find(k => cd.fix.includes(k))); renderReview(); el = find(); if (!el) return; }   // 끝난 카드에도 「직접 고치기」를 띄운다
            const d = el.querySelector('.fo-fix'); if (d) d.open = true;
            el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            el.classList.add('fo-flash'); setTimeout(() => el.classList.remove('fo-flash'), 1800);
            const f = el.querySelector('.fo-fix [data-x]:not([disabled]):not([type="hidden"])'); if (f) f.focus({ preventScroll: true });
            return true;
        }
    }
    function cardHtml(cd) {
        const pd = patchDec(cd), v = pd ? pd.v : st.dec.get(cd.id), done = v !== undefined;
        const byBtn = !!pd && keysOf(cd).every(k => (st.patch.get(k) || {}).exclBy === 'card');   // #583-c: 버튼으로 발송일 판정을 뒤집은 것
        if (pd) {   // 말로 정한 카드 — 무엇으로 정했는지와 [바꾸기](그 말을 되돌림)
            const lab = cd.type === 'order' || cd.type === 'split' ? ((cd.choices.find(c => c[0] === v) || [])[1] || (v === 'send' ? '오늘 발송' : '제외'))
                : cd.type === 'sender-order' ? `보내는이 ${/드림$/.test(v.name) ? v.name : v.name + ' 드림'}${v.phone ? ' · ' + v.phone : ''}${typeof v.memo === 'string' ? ` · 배송메세지 「${v.memo || '기본 문구'}」` : ''}${v.tail ? ` · 품목 뒤 「${v.tail}」` : ''}`
                : `배송메세지 「${v.memo || '기본 문구'}」${v.tail ? ` · 품목 뒤 「${v.tail}」` : ''}`;
            return `<article class="fo-card" data-id="${esc(cd.id)}" data-fo-card="${kindOf(cd)}" data-fo-done="1" data-by-chat="1" data-type="${cd.type}" data-state="done"><div class="fo-card-top"><span class="fo-tag" data-k="${cd.type}">${esc(cd.tag)}</span><b>${esc(cd.title)}</b><span class="fo-aibadge fo-chatbadge" data-chat-badge="1">${byBtn ? '사람이 정함' : '말로 정함'}</span></div><div class="fo-card-acts"><span class="fo-done">${esc(lab)} · ${byBtn ? '사람이 정함' : '말로 정함'}</span><button type="button" class="fo-btn sm" data-unpatch-card="${esc(cd.id)}">바꾸기</button></div>${cd.type === 'order' && (cd.fix || []).some(k => st.fixOpen.has(k)) ? fixHtml(Object.assign({}, cd, { fixF: ['name', 'phone', 'addr', 'memo', 'opt'] }), { flip: true, open: true }) : ''}</article>`;
        }
        // #520: AI가 입력칸을 채워 둔 열린 카드에는 그 사실과 이유를 한 줄로(사람이 눌러야 끝난다)
        const aiNote = !done && st.ai.hint && st.ai.hint.has(cd.id) ? `<div class="fo-line fo-ai-note" data-ai-note="1"><span>AI</span><p>${esc(st.ai.hint.get(cd.id))}</p></div>` : '';
        const aiDone = done && st.ai.tag.has(cd.id);   // #583 ①: AI가 닫은 카드는 접지 않는다 — 손님 메모(형광)와 「무엇을 어떻게 바꿨는지」 한 줄
        const lines = cd.lines.map(([k, t]) => `<div class="fo-line"${k === '손님 메모' ? ' data-memo-line="1"' : ''}><span>${esc(k)}</span><p>${k === '손님 메모' && t && t !== '(없음)' ? `<mark class="fo-hl">${esc(t)}</mark>` : esc(t)}</p></div>`).join('') + aiNote + (aiDone ? `<div class="fo-line fo-ai-did" data-ai-did="1"><span>AI 처리</span><p>${esc(aiDid(cd, v))}</p></div>` : '');
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
        } else if (cd.type === 'fix') {
            acts = `<span class="fo-done">참고 목록에서 연 주문이에요 — 아래에서 고치고 [적용]을 눌러요.</span><button type="button" class="fo-btn sm" data-fix-close="${esc(cd.fix[0])}">닫기</button>`;
        } else if (cd.type === 'sizeup') {
            acts = done ? `<span class="fo-done">${v === 'skip' ? '넘어감' : `${esc(v)}사이즈로! · 귤 로얄과 ${cd.okN}건`}</span><button type="button" class="fo-btn sm" data-undo="${esc(cd.id)}">바꾸기</button>`
                : (cd.sizes.length ? `<div class="fo-sizes" role="group" aria-label="사이즈 고르기">${cd.sizes.map(z => `<button type="button" class="fo-btn fo-size" data-size="${z}" data-fo-act="size-${z}" data-id="${esc(cd.id)}">${z}</button>`).join('')}</div>` : '') + `<button type="button" class="fo-btn sm" data-choice="skip" data-fo-act="skip" data-id="${esc(cd.id)}">넘어감</button>`;
        } else if (done) {
            const om = cd.type === 'order' && v === 'send' && st.ordMemo && st.ordMemo.has(cd.id) ? ` · 배송메세지 「${st.ordMemo.get(cd.id) || '기본 문구'}」` : '';
            const lab = ((cd.choices.find(c => c[0] === v) || [])[1] || '확인함') + om + (st.ai.tag.has(cd.id) ? ' · AI: ' + st.ai.tag.get(cd.id) : '');
            const flipBtn = cd.type === 'order' && st.ai.tag.has(cd.id) && (v === 'excl' || v === 'send') ? `<button type="button" class="fo-btn sm${v === 'excl' ? ' primary' : ''}" data-choice="${v === 'excl' ? 'send' : 'excl'}" data-ai-flip="1" data-id="${esc(cd.id)}">${v === 'excl' ? '오늘 발송으로' : '오늘 안 나감으로'}</button>` : '';   // #583-c ③
            acts = `<span class="fo-done">${esc(lab)}</span>${flipBtn}<button type="button" class="fo-btn sm" data-undo="${esc(cd.id)}">바꾸기</button>`;
        } else {
            // #548: 주문 확인 카드에서도 택배사 양식에 들어갈 배송메세지를 고쳐 넣을 수 있다([오늘 발송]을 누를 때만 반영 · 원문과 같으면 종전대로)
            const od = cd.type === 'order' ? st.draft.get(cd.id) : null;
            const ordBox = cd.type === 'order' ? `<div class="fo-edit"><label class="wide">택배사 양식에 들어갈 배송메세지(오늘 발송일 때만 · 비우면 기본 문구)<textarea data-f="memo" rows="2" maxlength="300">${esc(od && od.memo != null ? od.memo : cd.memoPre || '')}</textarea></label></div>` : '';
            acts = ordBox + cd.choices.map(([val, lab, pri]) => `<button type="button" class="fo-btn sm${pri ? ' primary' : ''}" data-choice="${esc(val)}" data-fo-act="${esc(val)}" data-id="${esc(cd.id)}">${esc(lab)}</button>`).join('') || '<span class="fo-wait">고친 뒤 [다시 판정]을 눌러야 넘어가요</span>';
        }
        return `<article class="fo-card" data-id="${esc(cd.id)}" data-fo-card="${kindOf(cd)}"${done ? ' data-fo-done="1"' : ''}${cd.recheck ? ' data-recheck="1"' : ''}${aiDone ? ' data-ai-done="1"' : ''} data-type="${cd.type}" data-state="${done || cd.type === 'fix' ? 'done' : 'open'}"><div class="fo-card-top"><span class="fo-tag" data-k="${cd.recheck ? 'recheck' : cd.type}">${esc(cd.tag)}</span>${aiDone ? '<span class="fo-aibadge" data-ai-badge>AI가 처리</span>' : ''}<b>${esc(cd.title)}</b></div>${done && !aiDone && cd.type !== 'pick' && cd.type !== 'sender-edit' && cd.type !== 'sender-order' && cd.type !== 'fix' ? '' : `<div class="fo-card-body">${lines}</div>`}<div class="fo-card-acts">${acts}</div>${!done || aiDone || cd.type === 'fix' || (cd.fix || []).some(k => st.fixOpen.has(k)) ? fixHtml(cd) : ''}</article>`;
    }
    // 다시 그리기 전에, 아직 확정하지 않은 카드의 입력칸 글을 떠 둔다(워커1 관찰: 다른 카드를 누르면 적다 만 글이 사라졌다)
    function saveDrafts() {
        document.querySelectorAll('#fo-cards details.fo-fix').forEach(d => { if (d.dataset.skip) return; const vals = {}; d.querySelectorAll('[data-x]').forEach(el => { if (!el.disabled) vals[el.dataset.x] = el.value; }); if (d.open) st.fixDraft.set(d.dataset.fix, { open: true, vals }); else st.fixDraft.delete(d.dataset.fix); });   // #583 ⑦ 적다 만 「직접 고치기」 글
        if (st.skipDraftSave) { st.skipDraftSave = false; return; }   // AI가 입력칸 미리 채움을 넣은 직후에는 화면의 옛 값을 떠 가지 않는다
        document.querySelectorAll('#fo-cards .fo-card[data-state="open"]').forEach(card => {
            const fs = card.querySelectorAll('[data-f]'); if (!fs.length) return;
            const d = {}; fs.forEach(el => { d[el.dataset.f] = el.value; }); st.draft.set(card.dataset.id, d);
        });
    }
    const isAiDone = cd => st.dec.has(cd.id) && st.ai.tag.has(cd.id) && !patchDec(cd);
    // #583 ⑨(대표 10/8): 참고 줄 — 종류 배지 · 손님 메모 원문 형광 · 바뀐 결과(「기본 문구」「2S사이즈로!」) 굵은 인디고 · 누르면 그 주문 카드·메모 줄로
    const INFO_KIND = [[/^오늘 (?:발송|안 나감)으로 바꿈/, '사람이 바꿈', 'hand'], [/^꼬리 (?:지정|뗌)\(사람\)/, '사이즈·과수', 'size'], [/^AI가|^배송메세지를 기본 문구로/, '배송메세지', 'memo'], [/^사이즈 지정 대상 아님|^사이즈를 붙일|^건수 다름/, '사이즈 확인', 'warn'], [/사이즈 지정/, '사이즈', 'size'], [/^오늘 안 나감/, '오늘 안 나감', 'warn'], [/^주문 없음/, '주문 없음', 'warn'], [/개별발송|입력삭제/, '개별발송', 'indiv'], [/^요일 풀이/, '요일', 'plain'], [/현금파일/, '현금파일', 'plain'], [/받는 분 번호/, '메모 줄', 'plain']];
    function infoHtml(it, i) {
        const t = typeof it === 'string' ? it : it.t, go = typeof it === 'object' && ((it.keys && it.keys.length) || it.line != null);
        const kd = INFO_KIND.find(k => k[0].test(t)), body = t;   // 글은 줄이지 않는다(배지는 덧붙임)
        let h = esc(body).replace(/손님 메모 「([^」]*)」/g, '손님 메모 <mark class="fo-hl">$1</mark>').replace(/→ 「([^」]*)」/g, '→ <b class="fo-em">$1</b>').replace(/에 「([^」]*)」/g, '에 <b class="fo-em">$1</b>');
        const badge = kd ? `<span class="fo-ibadge" data-k="${kd[2]}">${kd[1]}</span>` : '';
        return `<li data-info="${i}"${kd ? ` data-info-kind="${kd[2]}"` : ''}>${badge}<span class="fo-itext">${h}</span>${typeof it === 'object' && it.flip && it.keys && it.keys.length ? `<button type="button" class="fo-btn sm fo-igo fo-iflip" data-info-flip="${i}">${it.flip === 'send' ? '오늘 발송으로' : '오늘 안 나감으로'}</button>` : ''}${go ? `<button type="button" class="fo-btn sm fo-igo" data-info-go="${i}">${typeof it === 'object' && it.keys && it.keys.length ? '고치기' : '줄 보기'}</button>` : ''}</li>`;
    }
    function renderReview() {
        const peek = anchorLive() ? null : anchorPeek();   // #583-j
        saveDrafts();
        const s = S(), m = s.merged;
        const n = m.length, indiv = m.filter(e => e.individual).length, excl = m.filter(e => !e.individual && e.excluded).length;
        const cashRows = st.cash && st.cash.ok ? st.cash.rows.length : 0;
        $('fo-review').hidden = false; syncAi(); syncChat();
        $('fo-sum').innerHTML = `<span>기준 발송일 <b>${esc(dateLabel(s.shipDate))}</b></span><span>주문 <b>${n}</b>건</span><span>택배사 양식 <b>${n - indiv - excl}</b>건</span><span>입력삭제 <b>${indiv}</b>건</span><span>오늘 안 나감 <b>${excl}</b>건</span><span>현금파일 <b>${cashRows}</b>행</span><span id="fo-jeju">제주도 배송 <b>${esc(jejuText())}</b></span>${st.loadedAt ? `<span>주문 불러온 시각 <b>${hm(st.loadedAt)}</b></span>` : ''}`;
        { const wasOpen = !!($('fo-info').querySelector('details') || {}).open;
          $('fo-info').innerHTML = st.info.length ? `<details${wasOpen ? ' open' : ''}><summary>참고 ${st.info.length}건 (확인만 하면 돼요 · 줄을 누르면 그 주문·메모 줄로 가요)</summary><ul>${st.info.map(infoHtml).join('')}</ul></details>` : ''; }
        const open = pending(), ordOpen = open.filter(cd => cd.type === 'order').length;
        const aiDoneN = st.cards.filter(isAiDone).length, total = st.cards.filter(cd => cd.type !== 'fix').length;
        const head = total || st.cards.length ? `<div class="fo-cards-head"><h3>확인할 것 <b>${open.length}</b>건 <small>/ 전체 ${total}건${aiDoneN ? ` · AI 처리 ${aiDoneN}건` : ''}</small></h3>${ordOpen > 1 ? `<button type="button" class="fo-btn sm" data-bulk="send">남은 주문 확인 ${ordOpen}건 모두 오늘 발송</button>` : ''}</div>` : '<p class="fo-empty">확인할 것이 없어요. 바로 파일을 만들 수 있어요.</p>';
        // #517: 카드가 많을 때(설날 실파일 = 100장 안팎) 종류별로 걸러 본다 — 남은 건수가 있는 종류만 칩으로
        const kinds = {}; open.forEach(cd => { const k = cd.tag; kinds[k] = (kinds[k] || 0) + 1; });
        if (st.kindFilter && !(st.kindFilter === '@ai' ? aiDoneN : kinds[st.kindFilter])) st.kindFilter = '';
        const chips = Object.keys(kinds).length > 1 || aiDoneN ? `<div class="fo-kinds" role="group" aria-label="종류별로 보기"><button type="button" class="fo-kind${st.kindFilter ? '' : ' on'}" data-kind="">전체 ${open.length}</button>${Object.entries(kinds).map(([k, n]) => `<button type="button" class="fo-kind${k === '메모 재확인' ? ' recheck' : ''}${st.kindFilter === k ? ' on' : ''}" data-kind="${esc(k)}">${esc(k)} ${n}</button>`).join('')}${aiDoneN ? `<button type="button" class="fo-kind ai${st.kindFilter === '@ai' ? ' on' : ''}" data-kind="@ai">AI 처리 ${aiDoneN}</button>` : ''}</div>` : '';   // #583 ①: AI가 닫은 카드만 모아 보기
        const order = cd => (closed(cd) ? 1 : 0);
        const shown = st.cards.filter(cd => !st.kindFilter || (st.kindFilter === '@ai' ? isAiDone(cd) : cd.tag === st.kindFilter && !closed(cd)));
        $('fo-cards').innerHTML = head + chips + shown.slice().sort((a, b) => order(a) - order(b)).map(cardHtml).join('');
        { const mb = $('fo-ai-miss'), miss = st.cards.filter(cd => cd.type === 'ai-miss'), left = miss.filter(cd => !closed(cd)).length;   // #583-f
          mb.hidden = !miss.length;
          mb.innerHTML = miss.length ? `<b>${st.ai.off ? `AI 읽기가 꺼져 있어 손님 메모 ${miss.length}건을 사람이 확인해야 해요` : `AI가 메모 ${miss.length}건을 읽지 못했어요`}</b><span>${left ? `아래 「메모 확인」 카드 ${left}건을 정하거나 AI에게 다시 읽혀 주세요.` : '카드는 모두 정했어요 · AI에게 다시 읽힐 수도 있어요.'}</span><span class="fo-aimiss-acts"><button type="button" class="fo-btn sm primary" data-ai-retry="1">AI에게 다시 읽기</button>${left > 1 ? (st.missAsk ? `<span class="fo-aimiss-ask" data-miss-ask="1">${left}건을 손님 글 그대로 둡니다</span><button type="button" class="fo-btn sm" data-miss-keep-yes="1">그대로 두기</button><button type="button" class="fo-btn sm" data-miss-keep-no="1">취소</button>` : `<button type="button" class="fo-btn sm" data-miss-keep="1">남은 ${left}건 모두 그대로 두기</button>`) : ''}</span>` : '';
          if (left < 2) st.missAsk = false; }
        renderMemoGut();
        syncMake();
        if (FD.open) findDraw();   // #583-h
        if (anchorLive()) anchorApply(st.anchor, true); else if (peek) anchorApply(peek, false);   // #583-j: 조작하던 카드(없으면 보던 카드)를 같은 자리에
        floatSync();
        if (OP.open) { if (optBtn()) { optBtn().setAttribute('aria-expanded', 'true'); optPlace(); } else optClose(false); }   // #583-g1: 카드가 다시 그려져도 목록 창은 그대로
    }
    function syncMake() {
        setTimeout(floatSync, 0);   // #583-j: [파일 만들기]가 켜지고 꺼질 때 떠 있는 버튼도 맞춘다
        if (!st.built || st.phase === 'input' || st.phase === 'loading') return;
        const left = pending().length, btn = $('fo-make');
        btn.disabled = st.busy || left > 0 || !!st.stale || !st.judged || st.ai.running;
        if (!$('fo-make-msg').classList.contains('err')) $('fo-make-msg').textContent = st.stale || !st.judged ? '위의 [다시 판정]을 먼저 눌러 주세요.' : left ? `확인할 것이 ${left}건 남았어요.` : '';
    }
    function decide(id, v) {
        saveDrafts(); const prev = st.dec.get(id); st.draft.delete(id); st.ai.tag.delete(id);   // #583: 사람이 정하거나 [바꾸기]한 카드는 더는 「AI가 처리」가 아니다
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
    // #583-j(대표 실물 10/8 「적용하면 밑으로 가 버려 다시 올려야 한다 → 작업하던 칸으로」): 카드를 조작해 목록이 다시 그려질 때 그 카드를 화면의 같은 자리에 둔다.
    //   누를 때 그 카드의 화면 안 높이를 적어 두고(st.anchor), 다시 그린 뒤 같은 카드(같은 주문)를 찾아 그 높이로 맞춘다. 눌러서 끝난(열림 → 닫힘) 카드는 아래로 내려가므로 바로 다음 카드를 그 자리에 둔다.
    //   파일을 다시 만드는 동안(적용 → 다시 만들기)에도 유지한다 — 결과 파일 쪽으로 화면을 끌고 가지 않는다. 카드 밖을 누르거나 손으로 화면을 움직이면 그만둔다.
    st.anchor = null; const ANCHOR_MS = 20000;
    const ANCHOR_ATTRS = ['data-fix-apply', 'data-fix-undo', 'data-flip', 'data-tailset', 'data-choice', 'data-undo', 'data-size', 'data-memo', 'data-sender', 'data-optbtn', 'data-unpatch-card', 'data-fix-close', 'data-ai-flip'];
    const cardKeys = id => { const cd = st.cards.find(c => c.id === id); return cd ? (cd.fix || keysOf(cd)) : []; };
    const foScroller = () => document.querySelector('#fo-panel .fo-body');
    function anchorSet(card, btn) {
        if (!card) { st.anchor = null; return; }
        const nx = card.nextElementSibling, at = btn ? ANCHOR_ATTRS.find(a => btn.hasAttribute(a)) : '';
        st.anchor = { id: card.dataset.id, keys: cardKeys(card.dataset.id), top: card.getBoundingClientRect().top, wasOpen: card.dataset.state === 'open', nextId: nx && nx.classList.contains('fo-card') ? nx.dataset.id : '', attr: at || '', val: at ? btn.getAttribute(at) : '', t: Date.now() };
    }
    function anchorApply(a, focus) {
        if (!a) return false; const sc = foScroller(), all = [...document.querySelectorAll('#fo-cards .fo-card')]; if (!sc || !all.length) return false;
        const byId = id => (id ? all.find(c => c.dataset.id === id) : null);
        let el = byId(a.id) || all.find(c => cardKeys(c.dataset.id).some(k => a.keys.includes(k))), moved = false;
        if (!el || (a.wasOpen && el.dataset.state !== 'open')) { const nx = byId(a.nextId); if (nx) { el = nx; moved = true; a.id = nx.dataset.id; a.keys = cardKeys(a.id); a.wasOpen = nx.dataset.state === 'open'; a.attr = ''; const n2 = nx.nextElementSibling; a.nextId = n2 && n2.classList.contains('fo-card') ? n2.dataset.id : ''; } }
        if (!el) return false;
        a.wasOpen = el.dataset.state === 'open';
        sc.scrollTop += el.getBoundingClientRect().top - a.top;
        if (focus && !(document.activeElement && document.activeElement !== document.body && document.contains(document.activeElement) && document.activeElement.closest('#fo-panel'))) {
            const same = a.attr ? [...el.querySelectorAll('[' + a.attr + ']')].find(x => x.getAttribute(a.attr) === a.val && !x.disabled) : null;
            const t = same || (moved ? el.querySelector('[data-fo-act]') : null) || el.querySelector('.fo-fix[open] [data-x]:not([disabled]):not([type="hidden"])') || el.querySelector('button:not([disabled])');
            if (t) t.focus({ preventScroll: true });
        }
        return true;
    }
    const anchorLive = () => { const a = st.anchor; if (a && Date.now() - a.t > ANCHOR_MS) st.anchor = null; return st.anchor; };
    // 조작한 카드가 없을 때(AI 결과 도착 · 다시 판정)에도 보던 자리가 튀지 않게: 화면 맨 위에 걸친 카드를 잠깐 기준으로 삼는다
    function anchorPeek() {
        const sc = foScroller(); if (!sc || sc.scrollTop <= 0) return null; const top0 = sc.getBoundingClientRect().top;
        const c = [...document.querySelectorAll('#fo-cards .fo-card')].find(x => x.getBoundingClientRect().bottom > top0 + 8); if (!c) return null;
        return { id: c.dataset.id, keys: cardKeys(c.dataset.id), top: c.getBoundingClientRect().top, wasOpen: c.dataset.state === 'open', nextId: (c.nextElementSibling && c.nextElementSibling.classList.contains('fo-card') ? c.nextElementSibling.dataset.id : ''), attr: '', val: '', t: Date.now() };
    }
    document.addEventListener('pointerdown', e => { if (st.anchor && !(e.target.closest && e.target.closest('#fo-cards .fo-card'))) st.anchor = null; }, true);
    // 떠 있는 버튼: 한 화면 넘게 내려가면 「↑ 맨 위」 · 아직 안 정한 카드가 있으면 「다음 확인 (N) →」(지금 보는 곳 다음 카드로 · 끝까지 가면 처음부터) · 다 정했으면 「확인 끝 · 파일 만들기」
    const FL = { back: null, timer: 0 };
    const smoothOk = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollToY = (sc, y) => { if (typeof sc.scrollTo === 'function') sc.scrollTo({ top: Math.max(0, y), behavior: smoothOk() ? 'smooth' : 'auto' }); else sc.scrollTop = Math.max(0, y); };
    function floatSync() {
        const fl = $('fo-float'), sc = foScroller(); if (!fl || !sc) return;
        const rev = st.judged && (st.phase === 'review' || st.phase === 'result') && !$('fo-review').hidden, left = rev ? pending().length : 0, mk = $('fo-make');
        const top = $('fo-top'), nx = $('fo-next'), bk = $('fo-back');
        top.hidden = !(sc.scrollTop > sc.clientHeight);
        if (rev && left > 0) { nx.hidden = false; nx.dataset.mode = 'next'; nx.textContent = '다음 확인 (' + left + ') →'; }
        else if (rev && st.phase === 'review' && st.cards.length && mk && !mk.disabled) { nx.hidden = false; nx.dataset.mode = 'make'; nx.textContent = '확인 끝 · 파일 만들기'; }
        else nx.hidden = true;
        bk.hidden = !FL.back;
        fl.hidden = top.hidden && nx.hidden && bk.hidden;
    }
    function floatTop() {
        const sc = foScroller(); if (!sc) return; st.anchor = null;
        FL.back = { y: sc.scrollTop }; clearTimeout(FL.timer); FL.timer = setTimeout(() => { FL.back = null; floatSync(); }, 5000);
        scrollToY(sc, 0); floatSync();
    }
    function floatBack() { const sc = foScroller(); if (!sc || !FL.back) return; const y = FL.back.y; FL.back = null; clearTimeout(FL.timer); scrollToY(sc, y); floatSync(); }
    function floatNext() {
        const sc = foScroller(), nx = $('fo-next'); if (!sc) return; st.anchor = null;
        if (nx.dataset.mode === 'make') { const mk = $('fo-make'); mk.scrollIntoView({ block: 'center', behavior: smoothOk() ? 'smooth' : 'auto' }); mk.focus({ preventScroll: true }); return; }
        if (st.kindFilter) { st.kindFilter = ''; renderReview(); }
        const open = [...document.querySelectorAll('#fo-cards .fo-card[data-state="open"]')]; if (!open.length) return;
        const t0 = sc.getBoundingClientRect().top, c = open.find(x => x.getBoundingClientRect().top > t0 + 24) || open[0];
        scrollToY(sc, sc.scrollTop + c.getBoundingClientRect().top - t0 - 12);
        document.querySelectorAll('#fo-cards .fo-card.fo-flash').forEach(x => x.classList.remove('fo-flash'));
        c.classList.add('fo-flash'); setTimeout(() => c.classList.remove('fo-flash'), 1800);
        const b = c.querySelector('[data-fo-act], .fo-edit input, .fo-edit textarea, button:not([disabled])'); if (b) b.focus({ preventScroll: true });
    }
    ['wheel', 'touchmove'].forEach(ev => document.addEventListener(ev, e => { if (st.anchor && e.target.closest && e.target.closest('#fo-panel')) st.anchor = null; }, { passive: true, capture: true }));
    function onCardClick(e) {
        if (st.busy || !st.judged) return;   // 판정이 실패한 뒤 남은 카드는 [다시 판정] 전까지 누를 수 없다 · #520: AI가 읽는 동안에도 카드는 누를 수 있다(사람이 정한 카드는 AI가 덮지 않는다)
        const b = e.target.closest('button'); if (!b) return;
        anchorSet(b.closest('.fo-card'), b);   // #583-j
        if (b.classList.contains('fo-kind')) { st.kindFilter = b.dataset.kind || ''; return renderReview(); }
        if (b.dataset.choice === 'apply' && /^lrecv:/.test(b.dataset.id)) return applyRecv(b.dataset.id);
        if (b.dataset.size) return decide(b.dataset.id, b.dataset.size);   // #583 ⑥
        if ((b.dataset.choice === 'orig' || b.dataset.choice === 'drop') && /^lfix:/.test(b.dataset.id)) return lineFixBack(b.dataset.id, b.dataset.choice);   // #583 ⑤
        if (b.dataset.optbtn) return OP.open && OP.id === b.dataset.optbtn ? optClose(true) : optOpen(b);   // #583-g1
        if ('tailset' in b.dataset) { const fx = b.closest('.fo-fix'), ti = fx && fx.querySelector('[data-x="tail"]'); if (ti && !ti.disabled) { ti.value = b.dataset.tailset; tailSync(fx); } return; }   // #583-g2
        if (b.dataset.flip) return onFlipClick(b);   // #583-c
        if (b.dataset.fixApply) return fixApply(b.dataset.fixApply, b);
        if (b.dataset.fixUndo) return fixUndo(b.dataset.fixUndo);
        if (b.dataset.fixClose) { st.fixOpen.delete(b.dataset.fixClose); return renderSummaryOnly(); }
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
    function onCardChange(e) { if (e.target.closest('select[data-pick]')) anchorSet(e.target.closest('.fo-card'), null);   // #583-j
        const ti = e.target.closest('input[data-x="tail"]'); if (ti) { ti.value = tailNorm(ti.value); return tailSync(ti.closest('.fo-fix')); }   // #583-g2: 칸을 떠날 때 꼴을 맞춘다(「2s」 → 「2S사이즈로!」 · 「15」 → 「15과로!」)
        const sel = e.target.closest('select[data-pick]'); if (sel && !st.busy && st.judged) decide(sel.dataset.pick, sel.value || undefined); }

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
            { const mid = st.missCard && st.missCard.get(k); if (mid && st.dec.get(mid) === 'def') { put(''); return; } }   // #583-f 「메모 확인」 카드에서 [기본 문구로]
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
        const out = core().buildRows({ program, cash: cashRowsWithSize(st.cash && st.cash.ok ? st.cash.rows : []), byPartner: st.byPartner, picks, senderByKey: sby, defaultMemo: DEFAULT_MEMO });
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
        if (anchorLive()) anchorApply(st.anchor, true);   // #583-j: 카드에서 고쳐서 다시 만든 파일 — 작업하던 카드 자리 그대로
        else el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    function saveFile(name) { const f = st.files.find(x => x.name === name); if (!f) return; XLSX.writeFile(f.wb, f.name); }
    function savePng(short) {
        const f = st.files.find(x => x.short === short); if (!f) return;
        qtyCanvas(f).toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.png; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
    }
    // 수량 표 그림(거래처별) — [수량 이미지 저장] 과 정리 기록 첨부(#570)가 같은 그림을 쓴다. 화면 색과 무관하게 흰 바탕·검은 글자·품목 색을 직접 그린다
    function qtyCanvas(f) {
        const p = f.partner, dpr = 2, rowH = 34, padX = 12, font = '600 15px Pretendard, "Malgun Gothic", sans-serif';
        const cv = document.createElement('canvas'), g = cv.getContext('2d'); g.font = font;
        const nameW = Math.ceil(Math.max(260, ...p.qty.map(q => g.measureText(q.name).width)) + padX * 2), qtyW = 96, Wd = nameW + qtyW, H = rowH * (p.qty.length + 1);
        cv.width = Wd * dpr; cv.height = H * dpr; g.scale(dpr, dpr); g.font = font; g.textBaseline = 'middle';
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, Wd, H);
        const cell = (x, y, wd, fill, text, right) => { if (fill) { g.fillStyle = fill; g.fillRect(x, y, wd, rowH); } g.strokeStyle = '#000000'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, wd - 1, rowH - 1); g.fillStyle = '#000000'; g.textAlign = right ? 'right' : 'left'; g.fillText(String(text), right ? x + wd - padX : x + padX, y + rowH / 2 + 1); };
        // 대표가 보내던 표와 같은 모양: 품목 칸만 색 · 수량 칸과 합계 줄은 흰색
        p.qty.forEach((q, i) => { cell(0, i * rowH, nameW, '#' + (st.colorOf(q.name) || 'FFFFFF'), q.name); cell(nameW, i * rowH, qtyW, null, q.qty, true); });
        cell(0, p.qty.length * rowH, nameW, null, ''); cell(nameW, p.qty.length * rowH, qtyW, null, p.total, true);
        return cv;
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
    // #583-e(대표 10/8 효돈 파일 406행 — 「싱싱한 귤로 보내주세요」「빠르게 배송해 주세요」처럼 우리에게 한 말이 배송메세지에 그대로 실림): 종전엔 아래 낱말표에 걸리는 메모만 AI 에 보냈다 → 뒤집어서
    //   「기본 문구」와 「택배 기사님에게 하는 말뿐인 메모」만 빼고 전부 보낸다. 기사님 말 판정은 좁게: 기사님 낱말(문 앞·부재 시·경비실·공동현관 비번·배송 전 연락 …)과 부탁 말씨를 지우고 나면 글자가 남지 않을 때만.
    const AI_DRIVER_CORE = /문\s*앞|현관|대문|부재|경비실|관리실|관리\s*사무소|택배\s*(?:함|보관함|실)|무인\s*택배|공동\s*현관|비밀\s*번호|비번|(?:배송|배달|방문|도착|오시기)\s*전|연락|전화|문자|벨|초인종|노크/;
    const AI_DRIVER_WORDS = /현관\s*문?\s*앞?|대문\s*앞?|문\s*앞|부재\s*중|부재\s*시|집에\s*없으면|없으면|없을\s*(?:시|때|경우)|경비실|관리\s*사무소|관리실|무인\s*택배\s*(?:보관)?함|택배\s*(?:보관함|함|실)|공동\s*현관\s*문?|출입문|비밀\s*번호|비번|(?:배송|배달|방문|도착|오시기)\s*전|미리|먼저|꼭|연락|전화|문자|초인종|벨|노크|누르지\s*(?:말고|마시고|말아)?|누르고|눌러|놓아\s*두(?:고|세요)?|놓아|놓고|놔\s*두(?:고|세요)?|놔|두고|두세요|둬|맡겨|넣어|보관|해\s*주(?:세요|시면|십시오|셔요)?|주세요|주시면|주십시오|주셔요|부탁\s*(?:드립니다|드려요|드리겠습니다|합니다|해요)?|바랍니다|감사\s*(?:합니다|해요|드립니다)?|하세요|합니다|해요|됩니다|돼요|세요|에다가|에다|에서|으로|에|로|는|은|을|를|도|만|요/g;
    function aiDriverOnly(memoRaw) {
        const m = String(memoRaw || '').replace(/\s+/g, ' ').trim(); if (!m || m === DEFAULT_MEMO) return true;
        if (!AI_DRIVER_CORE.test(m)) return false;
        return !/[가-힣A-Za-z]/.test(m.replace(AI_DRIVER_WORDS, ' '));
    }
    const AI_PLAIN_SKIP = /배송자|발송자|송하인|보내는\s*자|\d+\s*과|과수|선물|좋은|예쁜|맛있|신선|꼼꼼|포장|빠른|빨리|사이즈|size|감사|수고|안녕|하자|상태|크기|보내는|보낸|드림|올림|주문자|발신|from|\d+\s*일|요일|도착|발송|출고|주소|리스트|명단|메일|톡톡/i;
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
                if (aiDriverOnly(memo) && !AI_PLAIN_SKIP.test(memo) && !sized) return;   // #583-e: 기본 문구 · 택배 기사님에게 하는 말뿐인 메모(「문 앞에 놔주세요」)만 안 보낸다(그대로 나감) — 그 밖의 메모는 전부 AI 가 읽는다
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
    // #583 ③(대표 10/8 「AI 읽는 중 강조」): AI·클코가 읽는 동안 큰 띠 — 손님 메모 읽기는 확인 구획 맨 위, 메모 줄 고쳐 쓰기·사진 읽기는 메모 구획. 초는 1초마다(시작 시각 기준 · #580 과 같은 꼴)
    const BAND = { ai: null, memo: null }; let bandTimer = 0;
    function bandDraw() {
        const draw = (el, b) => { if (!el) return; el.hidden = !b; if (!b) { el.innerHTML = ''; return; }
            const sec = Math.max(0, Math.round((Date.now() - b.t0) / 1000)), t = sec >= 90 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
            if (el.dataset.t !== b.text || !el.firstChild) { el.dataset.t = b.text; el.innerHTML = `<span class="fo-aiband-dot" aria-hidden="true"></span><b>${esc(b.text)}</b><span class="fo-aiband-sub">작업 중입니다 · 기다려 주세요 · <span class="fo-aiband-sec">${t}</span></span>`; }
            else { const s2 = el.querySelector('.fo-aiband-sec'); if (s2) s2.textContent = t; } };
        draw($('fo-ai-band'), BAND.ai); draw($('fo-memo-band'), BAND.memo);
        if ((BAND.ai || BAND.memo) && !bandTimer) bandTimer = setInterval(bandDraw, 1000);
        if (!BAND.ai && !BAND.memo && bandTimer) { clearInterval(bandTimer); bandTimer = 0; }
    }
    function band(where, text) { BAND[where] = text ? { text, t0: (BAND[where] && BAND[where].t0) || Date.now() } : null; bandDraw(); }
    function syncAi() {
        const bar = $('fo-ai'); if (!bar) return; const A = st.ai, msg = $('fo-ai-msg');
        band('ai', A.running ? `AI가 손님 메모 ${A.items.length}건을 읽고 있어요` : '');
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
        const A = st.ai; let waitOnly = false; if (prev.failed && st.judged) renderSummaryOnly();   // #583-f: 다시 읽는 동안에는 「메모 확인」 카드를 걷는다
        syncAi(); syncMake(); syncInput(); msg.textContent = `메모 ${groups.length}건을 창구에 올리는 중이에요`;
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
                waitOnly = !!(q && q.status === '대기');
                msg.textContent = (q && q.status === '대기' ? (sec > 40 ? '창구가 아직 집지 않았어요. 대표 PC가 꺼져 있으면 AI 읽기를 쓸 수 없어요([그만두기]를 누르고 카드로 확인해도 돼요)' : '창구에 올렸어요') : `AI가 메모 ${groups.length}건을 읽고 있어요`) + ` · ${sec}초`;
                if (sec > 900) throw new Error('15분이 지나도 끝나지 않았어요');
            }
        } catch (err) { A.failed = true; A.off = waitOnly; msg.textContent = '⚠️ AI 읽기를 못 했어요: ' + (err && err.message ? err.message : err) + ' — 카드로 직접 확인해 주세요.'; msg.classList.add('err'); }
        finally {
            const id = A.id; A.running = false; A.id = 0;
            if (id) { try { await window.api('/api/agent-office/final-order/memo-read/' + id, 'DELETE'); } catch (_) { } }   // 손님 글을 서버에 남기지 않는다
            syncAi(); syncMake(); syncInput();
            if (A.failed && st.ai === A && st.judged && !st.busy && (st.phase === 'review' || st.phase === 'result')) renderSummaryOnly();   // #583-f: 못 읽은 메모를 카드로
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
        const memoDec = new Map([...st.dec].filter(([id]) => /^memo:/.test(id)));   // #583 ①: AI 때문에 생긴 배송메세지 카드의 결정 — 아래 첫 buildCards(AI 값 비운 상태)가 「사라진 카드」로 보고 지우므로 떠 두었다가 되살린다
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
            A.memoAsk.set(k, r.memoText);   // #583 ①(대표 10/8 「AI 수정 건은 다 볼 수 있게」): 확실한 것도 카드 없이 조용히 바꾸지 않고 「배송메세지」 카드로 만들어 아래에서 AI가 닫는다(결과 파일 값은 같다)   // 품목 뒤에 붙일 말이 있으면 늘 카드로(사람 확인)
        });
        buildCards(); memoDec.forEach((v, id) => { if (!st.dec.has(id) && st.cards.some(cd => cd.id === id)) st.dec.set(id, v); }); applyOrderDecisions();
        const same = (a, b) => ['name', 'phone', 'addr', 'memo'].every(f => String((a && a[f]) || '') === String((b && b[f]) || ''));
        st.cards.forEach(cd => {
            if (!AI_KIND[cd.type] || closed(cd) || A.seen.has(cd.id)) return;
            const r = A.byKey.get(keysOf(cd)[0]); if (!r) return; A.seen.add(cd.id);
            const tag = v => { st.dec.set(cd.id, v); A.tag.set(cd.id, r.why || 'AI 판단'); };
            // #520 절충(대표 10/4 밤 「AI가 확실한 건 알아서 처리 · 애매한 문구만 사람에게」): 보내는이·배송메세지 카드는 ①AI가 확실 ②안전장치 통과(r.sure 에 들어 있음) ③메모의 동·호수 = 배송지 일 때만 닫는다.
            //   그 밖에는 입력칸만 채우고 이유를 적어 사람이 누르게 한다. 사람이 이미 고쳐 적은 칸은 닫지도 덮지도 않는다.
            const unitBad = !keysOf(cd).every(unitFine), closable = r.sure && !unitBad && !r.tail && !cd.tail && !keysOf(cd).some(k => A.tailAsk.has(k));   // 품목 뒤에 붙일 말이 걸린 카드는 닫지 않는다(한 카드에 묶인 주문 중 하나라도)
            const note = t => A.hint.set(cd.id, t + (r.why ? ' · ' + r.why : '') + (unitBad ? ` · 메모의 동·호수가 배송지(${unitOf(byKeyE.get(keysOf(cd)[0]))})와 달라요 — 확인해 주세요` : r.sure ? '' : ' · AI도 확실하지 않대요'));
            if (cd.recheck) return;   // #583 ⑤: 직원 메모 줄 때문에 뜬 카드는 AI가 닫지 않는다(AI는 손님 메모만 본다)
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
                if (closable && keysOf(cd).every(k => { const x = A.byKey.get(k); return x && x.sure && x.memoText === r.memoText; })) { st.draft.delete(cd.id); tag({ use: true, memo: r.memoText }); }
                else { st.draft.set(cd.id, { memo: r.memoText, ...(r.tail ? { tail: r.tail } : {}) }); note(r.tail ? 'AI가 읽은 값이에요(품목 뒤에 붙일 말 포함 — 확인해 주세요)' : 'AI가 읽은 값이에요'); }
            }
        });
        st.out = null; $('fo-result').hidden = true; st.skipDraftSave = true; renderSummaryOnly();
        if (focus) { const el = [...document.querySelectorAll('#fo-cards .fo-card')].find(c => c.dataset.id === focus.id); const f = el && el.querySelector(`[data-f="${focus.f}"]`); if (f) { f.focus({ preventScroll: true }); try { f.setSelectionRange(focus.a, focus.b); } catch (_) { } } }
    }
    document.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('#fo-ai-read, #fo-ai-stop'); if (!b) return;
        if (b.id === 'fo-ai-read') aiRead(false); else { st.ai.running = false; st.ai.failed = true; st.ai.off = true; st.ai.note ='AI 읽기를 그만뒀어요. 카드로 직접 확인해 주세요.'; syncAi(); syncMake(); syncInput(); if (st.judged && !st.busy) renderSummaryOnly(); }
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
    // #554(대표 확정 10/6): 사이즈(2S·S·M) 지정 품목 = 귤 로얄과(선물용 제외) — app.js addSizeSuffix 와 같은 기준
    const sizeItem = s => { s = String(s || ''); return /귤/.test(s) && /로얄과/.test(s) && !/선물용/.test(s); };
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
        const last = el.lastElementChild; if (last && typeof last.scrollIntoView === 'function' && C.log.length) { if (anchorLive()) el.scrollTop = el.scrollHeight; else last.scrollIntoView({ block: 'nearest' }); }   // #583-j: 카드에서 고치는 중이면 대화 칸으로 화면을 끌고 가지 않는다(검증에서 발견 — 「다시 만들었어요」 한 줄이 화면을 아래로 내렸다)
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
    // ── #572(대표 10/7) 메모 칸 = 규칙이 먼저, 틀 밖은 클코가 ───────────────────────────────────────────
    // 입력삭제 손님의 사이즈 지정(「번호 입력o삭제x 2S사이즈」): 입력삭제 주문은 택배사 양식에서 빠지고 현금파일 주소 줄이 나가므로 그 줄의 옵션에 꼬리를 붙인다(귤 로얄과만 · 이미 꼬리가 있으면 그대로)
    function cashRowsWithSize(rows) {
        const by = new Map(); (st.sizeLines || []).forEach(z => { if (z.digits && z.digits.length >= 8) by.set(z.digits, z.size + '사이즈로!'); });
        (st.upLines || []).forEach(u => { const r = st.upRes && st.upRes.get(u.srcLine); if (r && r.size && u.digits && u.digits.length >= 8) by.set(u.digits, r.size + '사이즈로!'); });   // #583 ⑥
        const hand = new Map(); S().merged.forEach(e => { const p = st.patch.get(keyOf(e)); if (e.individual && p && p.tailBy === 'card' && p.tail != null) { const d = buyerTel(e); if (d && d.length >= 8) hand.set(d, p.tail); } });   // #583-g2: 입력삭제 손님 주문에 사람이 넣은 꼬리(품목을 가리지 않는다 — 사람이 정한 것)
        if (!by.size && !hand.size) return rows;
        return rows.map(r => { const opt = String(r.opt || ''), dg = String(r.digits || '');
            if (hand.has(dg)) { const o2 = withTail(opt, hand.get(dg)); if (o2 === opt) return r; const c2 = r.cells.slice(); c2[4] = o2; return Object.assign({}, r, { opt: o2, cells: c2 }); }
            const tail = by.get(dg); if (!tail || !sizeItem(opt) || /사이즈로!$/.test(opt)) return r;
            const opt2 = withTail(opt, tail), cells = r.cells.slice(); cells[4] = opt2; return Object.assign({}, r, { opt: opt2, cells }); });
    }
    // 사진 1장을 긴 변 1600px JPEG data URL 로
    async function imgToDataUrl(file) {
        if (!/^image\//.test(file.type) && !IMG_EXT.test(file.name || '')) throw new Error('사진 파일만 붙일 수 있어요(캡처한 PNG·JPG).');   // #583-A: 종류 칸이 빈 파일은 확장자로
        const url = URL.createObjectURL(file); const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('이 사진 형식은 열 수 없어요 — 화면 캡처(PNG·JPG)로 다시 넣어 주세요')); i.src = url; });
        const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        return { name: String(file.name || '사진.jpg').slice(0, 60), data: cv.toDataURL('image/jpeg', 0.85), mime: 'image/jpeg' };
    }
    // 클코(창구)에게 묻고 결과 data({ reply, actions })를 받는다 — 대화 칸(chatAsk)과 같은 길 · 받은 뒤 서버 묶음은 지운다
    async function askDesk(ask, img, onTick) {
        const s = S();
        const body = Object.assign({ kind: 'chat', shipDate: s.shipDate, realToday: st.cal.realToday, shipDays: st.cal.shipDays, ask: String(ask).slice(0, 1500), orders: [], catalog: {}, summary: chatSummary(), history: [] }, img ? { image_data: img.data, image_mime: img.mime } : {});
        const r = await window.api('/api/agent-office/final-order/memo-read', 'POST', body);
        if (!r || !r.ok || !r.id) throw new Error((r && (r.message || r.error)) || '요청을 올리지 못했어요');
        const id = r.id, t0 = Date.now(); let idle0 = 0;   // #583-A: 창구는 같은 사람 지시를 하나씩 집는다 — 내 손님 메모 읽기가 도는 동안의 「대기」는 꺼진 것이 아니라 줄 선 것
        try {
            for (;;) {
                await sleep(2000);
                const q = await window.api('/api/agent-office/final-order/memo-read/' + id); let sec = Math.round((Date.now() - t0) / 1000);
                if (onTick) onTick(sec);
                if (q && q.status === '대기') { if (st.ai.running) { idle0 = 0; continue; } if (!idle0) idle0 = Date.now(); sec = Math.round((Date.now() - idle0) / 1000) + 0; if (sec <= 40) continue; }
                if (q && q.state === 'done') return q.data || {};
                if (q && q.state === 'fail') throw new Error(q.message || '클코가 처리하지 못했어요');
                if (q && q.status === '대기') throw new Error('지금은 클코를 쓸 수 없어요(대표 PC의 창구가 꺼져 있어요) — 줄을 직접 틀에 맞춰 적어 주세요');
                if (Date.now() - t0 > 900e3) throw new Error('15분이 지나도 답이 없어요');
            }
        } finally { try { await window.api('/api/agent-office/final-order/memo-read/' + id, 'DELETE'); } catch (_) { } }
    }
    const linesOf = data => [...new Set((Array.isArray(data && data.actions) ? data.actions : []).filter(a => a && a.op === 'lines').flatMap(a => String(a.text == null ? '' : a.text).replace(/\r/g, '').split('\n')).map(l => l.replace(/[ ]+$/, '')).filter(l => l.trim()))].slice(0, 80);
    const memoNote = (text, err) => { const m = $('fo-memo-msg'); if (!m) return; m.textContent = text || ''; m.classList.toggle('err', !!err); };
    // 폰 메모 캡처를 클코가 읽어 틀 줄로 → 메모 칸 끝에 넣고 다시 판정
    async function memoPhoto(file) {
        if (!st.loaded || st.busy || st.memoAsk) return;
        st.memoAsk = true; syncInput();
        try {
            memoNote('사진을 줄이는 중…');
            const img = await imgToDataUrl(file);
            memoNote('클코가 사진을 읽는 중이에요…'); band('memo', '클코가 사진을 읽고 있어요');
            const data = await askDesk('[사진 첨부] 폰 메모·목록 사진이에요. 한 줄에 하나씩 정리 줄 틀(요청일자<TAB>번호<TAB>비고<TAB>플랫폼 또는 「번호 요청말」)로 읽어 주세요.', img, sec => memoNote(`클코가 사진을 읽는 중이에요 · ${sec}초`));
            const lines = linesOf(data).filter(l => LINEISH.test(l));
            const reply = String(data.reply || '').trim();
            if (!lines.length) { memoNote(reply || '사진에서 번호가 든 줄을 읽지 못했어요 — 글로 적어 주세요.', true); chatSay('ai', reply || '사진에서 번호가 든 줄을 읽지 못했어요.'); return; }
            chatSay('me', `📷 ${img.name} (메모 칸에 사진으로 넣기)`);
            if (reply) chatSay('ai', reply);
            if (st.ai.running) { memoNote(`사진에서 ${lines.length}줄을 읽었어요 — AI가 손님 메모를 다 읽으면 메모 칸에 넣을게요.`); band('memo', `사진에서 읽은 ${lines.length}줄을 넣으려고 기다리고 있어요`); for (let i = 0; i < 1800 && st.ai.running; i++) await sleep(500); }
            st.memoAsk = false; band('memo', ''); syncInput();
            const put = await addRuleLines(lines, `사진에서 읽은 ${lines.length}줄을 메모 칸에 넣고`);
            if (put) memoNote(`사진에서 ${lines.length}줄을 넣었어요 — 왼쪽 줄별 표시와 아래 대화 답을 확인해 주세요.`);
            else memoNote(`⚠️ 사진에서 읽은 ${lines.length}줄을 아직 못 넣었어요 — 대화 칸에 적어 둔 줄을 메모 칸에 붙여 넣어 주세요.`, true), chatSay('ai', '사진에서 읽은 줄이에요(메모 칸에 붙여 넣어 주세요):\n' + lines.join('\n'));
        } catch (err) { const m = (err && err.message ? err.message : String(err)); memoNote('⚠️ ' + m, true); chatSay('ai', '⚠️ 사진으로 넣기를 못 했어요: ' + m); }
        finally { st.memoAsk = false; band('memo', ''); syncInput(); }
    }
    // 규칙이 못 읽은 줄(형식 확인 · 사이즈 못 읽음)만 클코에게 보내 틀로 고쳐 받는다. 번호는 《번호n》 자리표로 바꿔 보내 숫자를 못 바꾸게 하고, 돌아온 줄의 자리표·숫자를 되맞춰 검사한 뒤 바꿔 넣는다.
    const FIX_RE = /^(?:⚠ )?(?:형식 확인|사이즈 못 읽음)/;
    const NUM_RE = /01\d[-.\s]?\d{3,4}[-.\s]?\d{4}|\d{8}-\d{7}|\d{10,}/g;
    async function lineFixAuto() {
        const E = st.memoEd; if (!E || !st.loaded || !st.judged || st.stale || st.memoAsk || st.busy) return;
        const lines = String(E.ta.value || '').split('\n'), tried = st.lineFixTried || (st.lineFixTried = new Set());
        const targets = lines.map((raw, i) => ({ i, raw: raw.replace(/\r/g, '') })).filter(x => x.raw.trim() && E.marks[x.i] && FIX_RE.test(E.marks[x.i].t || '') && !tried.has(x.raw.trim()));
        if (!targets.length) return;
        targets.forEach(x => tried.add(x.raw.trim()));
        const toks = new Map(); let k = 0;
        const masked = targets.map(x => x.raw.replace(NUM_RE, m => { k++; toks.set(`《번호${k}》`, m); return `《번호${k}》`; }));
        st.memoAsk = true; syncInput();
        try {
            memoNote(`틀에 안 맞는 줄 ${targets.length}줄을 클코가 틀로 고쳐 쓰는 중이에요…`); band('memo', `클코가 메모 줄 ${targets.length}줄을 읽고 있어요`);
            const data = await askDesk('[정리 줄 고쳐 쓰기]\n' + masked.join('\n'), null, sec => memoNote(`틀에 안 맞는 줄 ${targets.length}줄을 클코가 고쳐 쓰는 중 · ${sec}초`));
            const got = linesOf(data);
            const digitsOfLine = s => (String(s).match(NUM_RE) || []).map(v => v.replace(/\D/g, '')).join('|');
            const out = [], changed = [];
            targets.forEach((x, j) => {
                const myToks = [...toks.keys()].filter(t => masked[j].includes(t));
                const cand = got[j] && myToks.every(t => got[j].includes(t)) && myToks.length ? got[j] : got.find(l => myToks.length && myToks.every(t => l.includes(t)));
                if (!cand) return;
                let fixed = cand; toks.forEach((num, t) => { fixed = fixed.split(t).join(num); });
                if (/《번호\d+》/.test(fixed) || digitsOfLine(fixed) !== digitsOfLine(x.raw)) return;   // 자리표가 남거나 숫자가 달라지면 안 넣는다
                if (fixed.trim() === x.raw.trim()) return;   // 클코가 뜻을 몰라 원문 그대로 돌려준 줄
                out.push({ i: x.i, fixed }); changed.push(`· 「${x.raw.trim()}」 → 「${fixed.trim()}」`);
            });
            const reply = String(data.reply || '').trim();
            if (!out.length) { memoNote(reply || '클코도 그 줄들을 틀로 바꾸지 못했어요 — 직접 틀에 맞춰 적어 주세요.', true); return; }
            out.forEach(o => { lines[o.i] = o.fixed; (st.lineFix = st.lineFix || new Map()).set(o.fixed.trim(), targets.find(x => x.i === o.i).raw.trim()); });   // #583 ⑤ 고친 줄 → 원문(「메모 재확인」 카드)
            st.memoAsk = false; syncInput();
            E.ta.value = lines.join('\n');
            chatSay('ai', `틀에 안 맞던 줄 ${out.length}줄을 클코가 틀로 고쳐 썼어요(번호는 그대로):\n${changed.join('\n')}${targets.length > out.length ? `\n그대로 둔 줄 ${targets.length - out.length}줄은 직접 틀에 맞춰 적어 주세요.` : ''}`);
            memoNote(`클코가 ${out.length}줄을 틀로 고쳐 썼어요 — 다시 판정했어요.`);
            await run(judge);
        } catch (err) { memoNote('⚠️ ' + (err && err.message ? err.message : err), true); }
        finally { st.memoAsk = false; band('memo', ''); syncInput(); }
    }
    // #570-b 사진 첨부: 긴 변 1600px 로 줄여 JPEG 로(서버 한도 10MB · 창구가 읽기엔 충분) · 칩에 이름 표시
    async function setChatImg(file) {
        if (!/^image\//.test(file.type)) { $('fo-chat-msg').textContent = '사진 파일만 붙일 수 있어요.'; return; }
        try {
            const url = URL.createObjectURL(file); const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('사진을 읽지 못했어요')); i.src = url; });
            const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
            cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
            const data = cv.toDataURL('image/jpeg', 0.85);
            st.chat.img = { name: String(file.name || '사진.jpg').slice(0, 60), data, mime: 'image/jpeg' }; renderChatChip(); $('fo-chat-msg').textContent = '';
        } catch (err) { $('fo-chat-msg').textContent = '⚠️ ' + (err && err.message ? err.message : err); }
    }
    function renderChatChip() { const c = $('fo-chat-chip'), im = st.chat.img; if (!c) return; c.hidden = !im; c.innerHTML = im ? `📷 <span class="fo-chip-name" title="${esc(im.name)}">${esc(im.name)}</span> <button type="button" class="fo-x" data-chat="unimg" aria-label="사진 빼기" title="사진 빼기">×</button>` : ''; }
    const chatSay = (who, text, extra) => { st.chat.log.push(Object.assign({ who, text: String(text || '') }, extra || {})); if (st.chat.log.length > 60) st.chat.log.splice(0, st.chat.log.length - 60); renderChat(); return st.chat.log.length - 1; };
    const sq = s => String(s == null ? '' : s).replace(/\s+/g, '');
    const meText = () => sq(st.chat.log.filter(m => m.who === 'me').map(m => m.text).join('\n'));
    // 정리 파일 줄로 읽히는 줄(휴대폰 번호 · 상품주문번호 · 자사몰 주문번호가 든 줄)은 규칙이 처리한다 — 메모 칸에 쌓고 다시 판정
    const LINEISH = /01\d[-.\s]?\d{3,4}[-.\s]?\d{4}|\d{16,}|\d{8}-\d{7}/;
    const CHAT_TALK = /해\s*줘|해\s*주세요|해\s*줄래|바꿔|변경해|수정|확인|표시|맞는지|맞아|됐어|되었|있어\s*\??|인지|빼\s*줘|넣어\s*줘|붙여|떼\s*줘|지워|알려|\d+\s*과\s*로|사이즈로|\?/;
    const CHAT_PHONE = /01\d[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
    const SIZE_HINT = /사이즈|싸이즈|size|(?:^|[^a-z0-9가-힣])2?[sml](?:[^a-z0-9가-힣]|$)/i;   // #570 사이즈 말처럼 보이는 것(못 읽은 줄 알림용)
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
    // #570 메모 칸 「번호 + 사이즈」 줄의 결과를 글로(대화 답 · 클코에게 주는 요약 공용). from = 이 줄 번호부터만(없으면 전부).
    function sizeReport(from) {
        const res = st.sizeRes || new Map(), zs = (st.sizeLines || []).filter(z => from == null || z.srcLine >= from), miss = (st.sizeMiss || []).filter(x => from == null || x.srcLine >= from);
        if (!zs.length && !miss.length) return '';
        const okZ = zs.filter(z => { const r = res.get(z.srcLine); return r && r.n; }), okN = okZ.reduce((a, z) => a + (res.get(z.srcLine).n || 0), 0);
        const L = [];
        if (okZ.length) L.push(`사이즈 지정 ${okZ.length}줄 → 귤 로얄과 주문 ${okN}건에 사이즈 꼬리를 붙였어요(옵션 끝 「S사이즈로!」 — 파일에 그대로 나가요).`);
        zs.forEach(z => { const r = res.get(z.srcLine); if (!r || (r.k === 'ok')) return; L.push(`· 「${z.raw}」 — ${r.t}${r.tip ? ' · ' + r.tip : r.rv ? ' · 받는 분 번호 — 아래 카드에서 적용하거나 넘어가요' : ''}`); });
        miss.forEach(x => L.push(`· 「${x.raw}」 — 사이즈를 못 읽었어요 → 「번호 2S사이즈」처럼 다시 적어 주세요(지금은 사이즈 없이 보통 줄로 읽혔어요)`));
        return L.join('\n');
    }
    function chatSummary() {
        const s = S(), m = s.merged, going = m.filter(goingOut), c = core();
        const sizeSum = (() => { const zs = st.sizeLines || [], miss = st.sizeMiss || []; if (!zs.length && !miss.length) return '메모 칸 사이즈 지정 줄: 없음';
            const res = st.sizeRes || new Map(); let okL = 0, okN = 0, none = 0, warn = 0; zs.forEach(z => { const r = res.get(z.srcLine); if (!r) return; if (r.n) { okL++; okN += r.n; } else if (r.k === 'none') none++; else warn++; });
            return `메모 칸 사이즈 지정 줄 ${zs.length + miss.length}줄(화면이 이미 처리 — 다시 시킬 필요 없음): 붙임 ${okL}줄(귤 로얄과 주문 ${okN}건에 꼬리) · 귤 로얄과 주문 없음 등 확인 ${warn}줄 · 주문 없음 ${none}줄 · 사이즈 못 읽음 ${miss.length}줄(직원이 「번호 2S사이즈」 꼴로 다시 적어야 함)`; })();
        const by = new Map(); going.forEach(e => { const k = partnerShort(optOf(e)) || '거래처 미정'; const x = by.get(k) || { n: 0, q: 0 }; x.n++; x.q += qtyNow(e); by.set(k, x); });
        (st.cash && st.cash.ok ? st.cash.rows : []).forEach(r => { const k = partnerShort(String(r.opt || '')) || '거래처 미정'; const x = by.get(k) || { n: 0, q: 0 }; x.n++; x.q += Number(r.qty) || 0; by.set(k, x); });
        // #526: 「미매칭」 = 옵션 글자가 「[미매칭]」으로 시작(단가표에 없는 이름) 또는 거래처 미정. 카드에서 거래처를 골랐어도 이름은 여전히 미매칭이다(실사용에서 0건으로 세어 AI가 못 찾았다고 답함)
        const unAll = going.filter(e => /^\[미매칭\]/.test(optOf(e)) || !partnerShort(optOf(e))), un = unAll.length, unPicked = unAll.filter(e => !!partnerShort(optOf(e))).length;
        return [`기준 발송일 ${s.shipDate}`, `주문 ${m.length}건 · 택배사 양식 ${going.length}건 · 입력삭제 ${m.filter(e => e.individual).length}건 · 오늘 안 나감 ${m.filter(e => !e.individual && e.excluded).length}건 · 현금파일 ${st.cash && st.cash.ok ? st.cash.rows.length : 0}행`,
            `거래처별: ${[...by].map(([k, x]) => `${k} ${x.n}건(${x.q}박스)`).join(' · ') || '없음'}`, `제주도 배송: ${jejuText()}`, `단가표에 없는 품목 이름(미매칭) ${un}건${unPicked ? `(그중 ${unPicked}건은 거래처만 골라 둠 · 이름은 그대로 미매칭)` : ''}`, `남은 확인 카드 ${pending().length}건 · 말로 바꾼 것 ${patchItems().length}건`, `품목별(택배사 양식으로 나가는 주문 · 꼬리 뗀 이름): ${itemCounts().map(x => `「${x.name}」 ${x.n}건(${x.q}박스)`).join(' · ') || '없음'}`, sizeSum].filter(Boolean).join('\n').slice(0, 4000);
    }
    // #570(대표 10/7): 줄 끝·맨 아래의 「변경해줘」「다 해줘」 같은 시키는 말만 있는 것은 위 정리 줄들을 가리키는 말 — 그 줄들은 화면이 처리하므로 클코에게 보내지 않는다
    const CMD_TAIL = /\s+(?:다\s*|전부\s*|모두\s*|싹\s*)?(?:변경|수정|적용|반영|표시|처리)?\s*(?:해\s*줘요?|해\s*주세요|해\s*줄래|해\s*주라|부탁해요?|부탁드려요?|부탁)\s*[!.~]*$/;
    const CMD_ONLY = /^\s*(?:다|전부|모두|싹|이거|이것|위에?|위\s*줄들?|전체|전부\s*다|이대로)?\s*(?:변경|수정|적용|반영|표시|처리)?\s*(?:해\s*줘요?|해\s*주세요|해\s*줄래|해\s*주라|부탁해요?|부탁드려요?|부탁|해)\s*[!.~]*$/;
    // 정리 줄이면 그 글(시키는 말 꼬리를 뗀 것)을, 아니면 null. 번호가 든 줄의 「s사이즈로」는 시키는 말이 아니라 사이즈 지정(#548 sizeLines 가 읽는다)
    const ruleOf = l => { const l2 = l.replace(CMD_TAIL, '').trim(); return LINEISH.test(l) && !CHAT_TALK.test(l2.replace(/사이즈\s*로/g, '사이즈')) ? l2 : null; };
    // 정리 줄을 메모 칸에 넣고 다시 판정한 뒤 줄별 결과를 답한다(직원이 적은 줄 · 클코가 사진에서 읽은 줄 공용)
    async function addRuleLines(rule, head) {
        if (st.ai.running) { chatSay('ai', 'AI가 메모를 읽는 중이라 정리 줄을 아직 못 넣었어요. 읽기가 끝난 뒤 다시 보내 주세요.'); return false; }
        const had = st.phase === 'result' && st.files.length > 0, memo = $('fo-memo');
        const base = memo.value.trim() ? memo.value.replace(/\s+$/, '').split('\n').length : 0;   // #570 방금 넣은 줄의 시작 번호(줄별 결과를 이 줄들만 보여 준다)
        memo.value = (memo.value.trim() ? memo.value.replace(/\s+$/, '') + '\n' : '') + rule.join('\n');
        await run(judge);
        { const rc = chatCandidates(rule.join('\n')); if (rc.length) st.chat.cand = rc; }   // #527 바로 뒤에 「이건 …」이라고 하면 방금 정리 줄의 주문을 가리킨다
        // #570(대표 10/7 실사고 「연락처 옆에 요청 사이즈야 다 해줘」): 어느 줄이 붙었고 어느 줄을 못 읽었는지 바로 보여 준다(종전엔 「정리 줄 N줄을 넣었어요」뿐)
        const rep = sizeReport(base);
        chatSay('ai', `${head || `정리 줄 ${rule.length}줄을 메모 칸에 넣고`} 다시 판정했어요.${rep ? '\n' + rep : ''}${pending().length ? `\n확인할 카드가 ${pending().length}건 있어요.` : ''}`);
        if (had) await remake();
        return true;
    }
    async function chatSend() {
        const el = $('fo-chat-input'), msg = $('fo-chat-msg'), C = st.chat; let text = String(el.value || '').replace(/\r/g, '').trim();
        const img = C.img || null;
        if ((!text && !img) || C.running || st.busy || C.pending) return;
        if (!st.judged || st.stale) { msg.textContent = '위의 [다시 판정]을 먼저 눌러 주세요.'; return; }
        msg.textContent = ''; el.value = '';
        // #527(대표 실물 10/5 「010-… 주문건 황금향 3키로 선물용 맞는지 확인하고 10과로! 로 표시해줘」가 정리 줄로 읽혀 클코에게 안 갔다):
        //   번호가 든 줄이라도 「해줘·바꿔·수정·확인·표시·맞는지·○과로」 같은 시키는 말이 있으면 정리 줄이 아니라 말이다(번호는 그 주문을 찾는 데 쓴다).
        const lines = text.split('\n').filter(l => l.trim()), rule = lines.map(ruleOf).filter(Boolean);
        let talk = lines.filter(l => ruleOf(l) == null).join('\n').trim();
        if (rule.length && talk && CMD_ONLY.test(talk)) talk = '';   // #570 「…(번호 줄들)… 변경해줘」 = 위 줄들을 하라는 말 — 화면이 처리했으니 클코에게 묻지 않는다
        if (img && !talk) talk = '[사진 첨부] 사진에 적힌 번호와 요청(사이즈 등)을 정리 줄로 읽어 주세요.';
        chatSay('me', (text || '') + (img ? `${text ? '\n' : ''}📷 ${img.name}` : ''));
        C.img = null; renderChatChip();
        if (rule.length) await addRuleLines(rule);
        if (talk) await chatAsk(talk, img);
    }
    async function remake() {   // 파일이 이미 만들어져 있었으면 고친 내용으로 다시 만든다(남은 카드가 있거나 AI가 읽는 중이면 안내만)
        for (let i = 0; i < 1200 && st.ai.running; i++) await sleep(500);
        if (pending().length) { $('fo-chat-msg').textContent = '확인할 카드가 남아 있어요. 처리한 뒤 [파일 만들기]를 눌러 주세요.'; return; }
        await run(make);
        if (st.phase === 'result' && st.out) chatSay('ai', '고친 내용으로 파일을 다시 만들었어요.');
    }
    async function chatAsk(text, img) {
        const C = st.chat, msg = $('fo-chat-msg'), s = S();
        for (let i = 0; i < 1800 && st.ai.running; i++) { msg.textContent = 'AI가 손님 메모를 읽는 중이에요. 끝나면 이어서 물어볼게요.'; await sleep(500); }
        const cand = chatCandidates(text); if (cand.length) C.cand = cand;   // 후보를 못 찾으면 앞서 보여 준 번호를 그대로 쓴다(「2번으로」처럼 이어서 답할 때)
        const byKey = new Map(s.merged.map(e => [keyOf(e), e]));
        const orders = C.cand.map(c => { const e = byKey.get(c.key); return e ? { n: c.n, buyer: buyerName(e), recv: String(e.conv['수취인명'] || ''), opt: optOf(e), qty: qtyNow(e), memo: String(e.conv['배송메세지'] || '').trim().slice(0, 300), unit: unitOf(e), partner: partnerShort(optOf(e)) || '미정', state: e.individual ? '입력삭제' : e.excluded ? '오늘 안 나감' : '오늘 발송' } : null; }).filter(Boolean);
        const catalog = {}; let left = 200; Object.entries(st.byPartner || {}).forEach(([p, names]) => { const take = (names || []).slice(0, Math.max(left, 0)); left -= take.length; catalog[p] = take; });
        const history = C.log.slice(0, -1).filter(m => !m.preview).slice(-6).map(m => ({ who: m.who === 'me' ? 'me' : 'ai', text: chatMask(m.text).slice(0, 300) }));
        C.running = true; C.t0 = Date.now(); C.id = 0; C.live = '클코에게 물어보는 중이에요'; msg.textContent = ''; syncChat(); renderChat();
        try {
            const r = await window.api('/api/agent-office/final-order/memo-read', 'POST', Object.assign({ kind: 'chat', shipDate: s.shipDate, realToday: st.cal.realToday, shipDays: st.cal.shipDays, ask: chatMask(text).slice(0, 1500), orders, catalog, summary: chatSummary(), history }, img ? { image_data: img.data, image_mime: img.mime } : {}));
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
        // #570-b 클코가 사진에서 읽은 「번호 + 요청」 줄(op lines) — 직원이 직접 적은 정리 줄과 같은 길로 메모 칸에 넣는다(적용 버튼 없이 · 결과는 줄별 표시와 답으로)
        if (C.linesToAdd && C.linesToAdd.length) { const L = C.linesToAdd; C.linesToAdd = null; await addRuleLines(L, `사진에서 읽은 ${L.length}줄을 메모 칸에 넣고`); }
    }
    // 돌아온 actions 검사 → 「바뀔 내용」 미리 보기(적용은 사람이 눌러야)
    async function chatResult(data) {
        const C = st.chat, s = S(), byKey = new Map(s.merged.map(e => [keyOf(e), e])), mine = meText();
        const names = new Set(); Object.values(st.byPartner || {}).forEach(a => (a || []).forEach(n => names.add(n)));
        const inMine = v => { const x = sq(v); return x.length >= 1 && mine.includes(x); };
        const rawActs = Array.isArray(data.actions) ? data.actions : [];
        // #570-b op lines = 사진에서 읽은 정리 줄 — 번호가 든 줄만 · 80줄까지 · 적용 미리 보기가 아니라 바로 메모 칸으로(chatAsk 끝에서)
        const readLines = [...new Set(rawActs.filter(a => a && a.op === 'lines').flatMap(a => String(a.text == null ? '' : a.text).replace(/\r/g, '').split('\n')).map(l => l.trim()).filter(l => l && l.length <= 200 && LINEISH.test(l)))].slice(0, 80);
        if (readLines.length) C.linesToAdd = readLines;
        const items = rawActs.filter(a => !(a && a.op === 'lines')).slice(0, 80).map(a => {
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
                    if (t && /^(?:[2-4]?[SML]|2?XL)\s*(?:사이즈)?(?:로)?!?$/i.test(t.replace(/\s/g, '')) && !sizeItem(e.conv['옵션정보'])) return bad(`사이즈 지정: ${cur}`, '이 품목은 사이즈(2S·S·M)로 지정하지 않아요 — 귤만 사이즈 지정이에요(로얄과만 · 선물용·소과·중대과 제외 · 황금향은 과수로)');
                    return t ? good(`품목 뒤에 붙일 말: ${cur} → ${withTail(cur, t)}`, { tail: t }) : good(`품목 뒤 꼬리 떼기: ${cur} → ${withTail(cur, '')}`, { tail: '' }); }
                default: return bad(String(a.op || ''), '모르는 지시예요');
            }
        });
        const reply = String(data.reply || '').trim();
        if (!items.length) { if (reply || !readLines.length) chatSay('ai', reply || '바꿀 것이 없어요.'); return; }
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
            // #570(대표 10/7 「최종발주 이미지 안 들어가는 거 들어가게」): 거래처별 수량 표 그림을 정리 기록에 첨부 — 에이전트 오피스 기록에서 중간발주처럼 바로 보인다
            let images = [];
            try { images = st.files.filter(f => f.kind === 'partner' && f.partner && f.partner.qty && f.partner.qty.length).slice(0, 5).map(f => ({ name: f.png, data: qtyCanvas(f).toDataURL('image/png') })).filter(x => x.data.length < 2.5e6); } catch (_) { images = []; }
            const r = await window.api('/api/agent-office/final-order/log', 'POST', Object.assign({ shipDate: S().shipDate, lines: logLines(), images }, st.logId ? { id: st.logId } : {}));
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
            $('fo-memo').value = ''; $('fo-chat-input').value = ''; st.lineFixTried = null; st.lineFix = null; st.fixDraft = new Map(); st.memoAsk = false; memoNote(''); band('memo', ''); band('ai', '');   // #572
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
