// #653-나 입력 칸 [+] 메뉴 검증 — 가짜 서버(scripts/_mock-610.js · DB·외부 호출 0)에 실제 화면을 띄워 실클릭
//   사용: node scripts/verify-653-plus.js   (포트 PORT653 · 없으면 3465 · 다른 Playwright 검증과 동시에 돌리지 말 것 · SHOTS=폴더 를 주면 그림도 남김)
//   PC · 폰 · PC 야간 · 폰 야간 × 바로가기 · 메뉴 열기(묶음·항목·높이·화면 안) · 키보드(↑↓ End Esc Enter) · 바깥 누름 · 문자 창 · 파일 고르기 · 가로 넘침 · 야간 대비
const path = require('path'), fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), W = ROOT, OUT = process.env.SHOTS || '';
const PORT = Number(process.env.PORT653 || 3465), BASE = 'http://localhost:' + PORT;
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : '  FAIL ') + m); };
(async () => {
    if (OUT) fs.mkdirSync(OUT, { recursive: true });
    const srv = spawn(process.execPath, [path.join(W, 'scripts/_mock-610.js'), String(PORT)], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch();
    try {
        for (const [name, vw, phone, theme] of [['pc', { width: 1440, height: 900 }, false, null], ['phone', { width: 390, height: 844 }, true, null], ['fold', { width: 900, height: 1000 }, false, null] /* 대표·회사폰 = 폴드 펼침(약 900) */, ['pc-dark', { width: 1440, height: 900 }, false, 'dark'], ['phone-dark', { width: 390, height: 844 }, true, 'dark']]) {
            await fetch(BASE + '/__mock/reset', { method: 'POST' });
            const ctx = await browser.newContext(Object.assign({ viewport: vw, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await pg.evaluate(th => { localStorage.setItem('jwt_token', 'mock.token.x'); localStorage.setItem('jwt_user', JSON.stringify({ id: 8, name: '시험직원', position: '대리', role: 'user' })); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); localStorage.removeItem('akm_desk_plus_recent'); }, theme);
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1800);
            const s0 = await pg.evaluate(() => ({ shorts: Array.from(document.querySelectorAll('#desk-shorts .desk-short')).map(b => b.textContent.trim()).join('|'), plusN: document.getElementById('desk-plus-n').textContent + '|' + document.getElementById('desk-plus-n').hidden, menu: document.getElementById('desk-plus').hidden, over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
            ok(s0.shorts === '문자7' && s0.plusN === '7|false' && s0.menu && s0.over <= vw.width, `[${name}] 처음: 바로가기 「${s0.shorts}」 · [+] 배지 ${s0.plusN} · 메뉴 닫힘 · 가로 ${s0.over}`);
            if (OUT) await pg.screenshot({ path: path.join(OUT, `plus-${name}-closed.png`), clip: phone ? undefined : { x: 240, y: 0, width: 1200, height: 420 } });
            await pg.click('#desk-plus-btn'); await pg.waitForTimeout(350);
            const m1 = await pg.evaluate(() => { const m = document.getElementById('desk-plus'), r = m.getBoundingClientRect(); const items = Array.from(m.querySelectorAll('.desk-mi')).filter(b => !b.hidden); return { open: !m.hidden, exp: document.getElementById('desk-plus-btn').getAttribute('aria-expanded'), names: items.map(b => b.querySelector('strong').textContent).join('|'), groups: Array.from(m.querySelectorAll('.desk-plus-g')).filter(g => !g.hidden).map(g => g.querySelector('b').textContent).join('|'), minH: Math.min(...items.map(b => Math.round(b.getBoundingClientRect().height))), inView: r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 && r.top >= 0, focus: (document.activeElement || {}).id, pos: getComputedStyle(m).position, w: Math.round(r.width), smsN: document.getElementById('sms-chip-n').textContent }; });
            ok(m1.open && m1.exp === 'true' && m1.names === '파일 · 이미지|정산 이미지|중간발주|최종발주|배송조회 확인하기|전체 가격 확인하기|문자' && m1.groups === '첨부|발주|확인|손님' && m1.minH >= (phone ? 56 : 44) && m1.inView && m1.focus === 'desk-attach' && m1.smsN === '7' && (phone ? m1.pos === 'fixed' : m1.pos === 'absolute'), `[${name}] 메뉴 열림: ${m1.groups} · 항목 ${m1.names.split('|').length}개(최소 ${m1.minH}px) · ${m1.pos} ${m1.w}px · 화면 안 ${m1.inView} · 첫 항목에 초점`);
            if (OUT) await pg.screenshot({ path: path.join(OUT, `plus-${name}-open.png`), clip: phone ? undefined : { x: 240, y: 0, width: 1200, height: 640 } });
            if (theme) { const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js')); const a = await H.audit(pg, '#desk-plus, #desk-shorts, #desk-plus-btn'); ok(a.fails.length === 0 && a.white.length === 0, `[${name}] 야간 대비 미달 ${a.fails.length} · 흰 칸 ${a.white.length}(글자 ${a.texts}개 · 최소 ${a.minR}${a.fails.length ? ' · ' + a.fails.slice(0, 3).join(' / ') : ''})`); }
            if (!phone) {
                await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown'); const f2 = await pg.evaluate(() => document.activeElement.id);
                await pg.keyboard.press('End'); const f3 = await pg.evaluate(() => document.activeElement.id);
                await pg.keyboard.press('ArrowDown'); const f4 = await pg.evaluate(() => document.activeElement.id);
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
                const f5 = await pg.evaluate(() => ({ menu: document.getElementById('desk-plus').hidden, focus: document.activeElement.id }));
                ok(f2 === 'desk-qty-now' && f3 === 'desk-sms-now' && f4 === 'desk-attach' && f5.menu && f5.focus === 'desk-plus-btn', `[${name}] 키보드: ↓↓ = ${f2} · End = ${f3} · ↓(돌아옴) = ${f4} · Esc → 닫힘 + 초점 [+]`);
                await pg.keyboard.press('ArrowDown'); await pg.waitForTimeout(200); await pg.keyboard.press('End'); await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(700);
                const p1 = await pg.evaluate(() => ({ menu: document.getElementById('desk-plus').hidden, price: !!document.getElementById('desk-price') && !document.getElementById('desk-price').hidden, shorts: Array.from(document.querySelectorAll('#desk-shorts .desk-short')).map(b => b.textContent.trim()).join('|') }));
                ok(p1.menu && p1.price && p1.shorts === '문자7' && await pg.evaluate(() => { try { return localStorage.getItem('akm_desk_plus_recent') === null; } catch (e) { return false; } }), `[${name}] ↓ 로 열고 Enter 로 「전체 가격 확인하기」 → 카드 열림 · 메뉴 닫힘 · 바로가기는 그대로 「문자 n」 하나(최근 쓴 것은 안 뜸 · 기억도 안 남김 · 「${p1.shorts}」)`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(250); await pg.mouse.click(1000, 700); await pg.waitForTimeout(250);
                ok(await pg.evaluate(() => document.getElementById('desk-plus').hidden), `[${name}] 바깥 누름 → 닫힘`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(250); await pg.keyboard.press('Tab'); await pg.waitForTimeout(200);
                ok(await pg.evaluate(() => document.getElementById('desk-plus').hidden && document.activeElement.id === 'desk-plus-btn'), `[${name}] Tab → 메뉴 닫힘 · 초점은 [+]`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(250); await pg.click('#desk-price-now'); await pg.waitForTimeout(500);
                const pf = await pg.evaluate(() => ({ open: !!document.getElementById('desk-price') && !document.getElementById('desk-price').hidden, focusIn: !!document.activeElement.closest('#desk-price') }));
                ok(pf.open && pf.focusIn, `[${name}] 가격 카드가 열려 있을 때 메뉴에서 또 고르면 닫히지 않고 그 카드로(초점 이동)`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(250);
                const oc = await pg.evaluate(() => window.AkmAoDesk.openSms(3)); await pg.waitForTimeout(900);
                ok(oc === true && await pg.evaluate(() => document.getElementById('desk-plus').hidden && document.getElementById('desk-plus-btn').getAttribute('aria-expanded') === 'false' && !document.getElementById('desk-sms').hidden), `[${name}] 메뉴가 열린 채 문자 창이 뜨면(알림) 메뉴는 닫힘`);
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(350); await pg.keyboard.press('Escape'); await pg.waitForTimeout(450);
                const bz = await pg.evaluate(() => { const it = document.getElementById('desk-qty-now'); it.disabled = true; window.__aoDesk.plusBusy(); const sc = document.getElementById('desk-short-qty'); const r = { busy: it.dataset.busy || '', short: sc ? sc.disabled + '|' + sc.textContent.trim() : '(바로가기 없음)' }; it.disabled = false; window.__aoDesk.plusBusy(); const sc2 = document.getElementById('desk-short-qty'); r.after = (it.dataset.busy || '') + '|' + (sc2 ? sc2.disabled + '|' + sc2.textContent.trim() : ''); return r; });
                ok(bz.busy === '집계 중' && bz.short === '(바로가기 없음)' && bz.after === '|', `[${name}] 집계 중이면 메뉴 항목에 「집계 중」(중간발주 바로가기는 이제 없음) · 끝나면 원래대로(${JSON.stringify(bz)})`);
            } else {
                await pg.touchscreen.tap(195, 60); await pg.waitForTimeout(300);
                ok(await pg.evaluate(() => document.getElementById('desk-plus').hidden && document.getElementById('desk-plus-back').hidden), `[${name}] 시트 바깥(어두운 곳) 누름 → 닫힘`);
                await pg.waitForTimeout(300);
                ok(await pg.evaluate(() => !(history.state && history.state.deskPlus) && !document.body.classList.contains('desk-plus-open')), `[${name}] 바깥 누름으로 닫으면 뒤로가기 칸·스크롤 잠금도 풀림`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(300);
                const d1 = await pg.evaluate(() => ({ st: !!(history.state && history.state.deskPlus), lock: getComputedStyle(document.body).overflow === 'hidden' }));
                await pg.goBack().catch(() => { }); await pg.waitForTimeout(400);
                const d2 = await pg.evaluate(() => ({ menu: document.getElementById('desk-plus').hidden, page: document.getElementById('page-agent-office').classList.contains('active'), url: location.pathname, st: !!(history.state && history.state.deskPlus), lock: document.body.classList.contains('desk-plus-open') }));
                ok(d1.st && d1.lock && d2.menu && d2.page && d2.url === '/' && !d2.st && !d2.lock, `[${name}] 폰 시트: 떠 있는 동안 뒤 화면 스크롤 잠금 · 뒤로가기 = 시트만 닫힘(페이지 그대로 · ${JSON.stringify(d2)})`);
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(300); await pg.click('#desk-sms-now'); await pg.waitForTimeout(1100);
                const d3 = await pg.evaluate(() => ({ win: !document.getElementById('desk-sms').hidden && document.body.classList.contains('sms-win-open'), st: (history.state || {}).smsWin || '', menu: document.getElementById('desk-plus').hidden }));
                await pg.goBack().catch(() => { }); await pg.waitForTimeout(450);
                const d4 = await pg.evaluate(() => ({ win: document.getElementById('desk-sms').hidden, plus: !!(history.state && history.state.deskPlus), sms: (history.state || {}).smsWin || '', page: document.getElementById('page-agent-office').classList.contains('active') }));
                ok(d3.win && d3.st === 'win' && d3.menu && d4.win && !d4.plus && !d4.sms && d4.page, `[${name}] 시트에서 「문자」 → 시트 칸을 되돌린 뒤 문자 창이 뜸 · 뒤로가기 1번에 창 닫힘 · 남는 칸 없음(${JSON.stringify(d4)})`);
            }
            await pg.click('#desk-short-sms'); await pg.waitForTimeout(800);
            ok(await pg.evaluate(() => !document.getElementById('desk-sms').hidden && document.body.classList.contains('sms-win-open')), `[${name}] 바로가기 「문자 7」 → 문자 창 열림`);
            await pg.click('#sms-close'); await pg.waitForTimeout(400);
            ok(await pg.evaluate(() => document.activeElement.id) === 'desk-short-sms', `[${name}] 창을 닫으면 초점이 그 바로가기로`);
            await pg.click('#desk-plus-btn'); await pg.waitForTimeout(300);
            const [chooser] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null), pg.click('#desk-attach')]);
            await pg.waitForTimeout(200);
            ok(!!chooser && await pg.evaluate(() => document.getElementById('desk-plus').hidden), `[${name}] 「파일 · 이미지」 → 파일 고르기 창 · 메뉴 닫힘`);
            const over = await pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
            ok(over <= vw.width && errs.length === 0, `[${name}] 끝까지 가로 넘침 없음(${over}) · 화면 오류 ${errs.length}${errs.length ? ' ' + errs[0].slice(0, 120) : ''}`);
            await ctx.close();
        }
        // ════ #653-다(대표 10/11 「모두 진행해」): ①대화 틀 한 겹 ②맨 위 대화만 답 칸 ③흐린 「채팅 종료」 ④챙길 일 자리 ⑤초록은 [복사] 글자에만 — PC · 폴드 900 · 폰 (+ 야간)
        const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
        const O = (id, min, content, extra) => Object.assign({ id, content, status: '완료', created_at: ago(min), processed_at: ago(min - 0.5), created_by: '시험직원 대리', created_by_id: 8, mine_hidden: false, has_image: false, reply_to: null, followed_by: null, steps: [], result: { type: 'desk_answer', answer: '답변입니다.' } }, extra || {});
        const ORDERS = [
            O(2301, 6, '오늘 황금향 판매현황 알려줘', { result: { type: 'desk_answer', answer: '━━━ ① 오늘 주문 ━━━\n스마트스토어 42건\n\n━━━ ② 품목별 ━━━\n황금향 가정용 3kg 21건' } }),
            O(2302, 4, '선물용만 다시 보여줘', { reply_to: 2301, result: { type: 'desk_answer', answer: '황금향 선물용 5kg 9건이에요.' } }),
            O(2290, 35, '내일 발송 휴무 안내 문구 써줘', { result: { type: 'desk_answer', answer: '내일은 발송을 쉬어 갑니다.' } }),
            O(2285, 48, '보관법 알려줘', { result: { type: 'desk_answer', answer: '서늘한 곳에 두세요.' } }),
            O(2280, 70, '정산관리에 올려줘', { status: '질문', processed_at: ago(69), result: { type: 'desk_question', question: '거래처가 효돈인지 대성인지 알려 주세요.' } }),
        ];
        const BOARD = { is_admin: false, channels: [{ ch: 'naver', today: 42, yesterday: 51 }], ship: [], live: [], today: [], progress: [],
            todo: [{ key: 'botfail', label: '봇 실패', count: 3, talk: 2, sms: 1, where: '톡톡 2 · 문자 1' }, { key: 'fail', label: '알림 발송 실패', count: 2, where: '문의 관리 · 알림 발송 이력' }, { key: 'reward', label: '룰렛 당첨 미지급', count: 1, where: '문의 관리 · 당첨 지급' }, { key: 'remind', when: '오늘', label: '황금향 특가 문자 [문자발송]', count: 1, where: '일정 · 문자발송' }, { key: 'remind', when: '내일', label: '톡톡 단체 발송 [톡톡발송]', count: 1, where: '일정 · 톡톡발송' }] };
        for (const [name, vw, phone, theme] of [['다-pc', { width: 1440, height: 900 }, false, null], ['다-fold', { width: 900, height: 1000 }, false, null], ['다-phone', { width: 390, height: 844 }, true, null], ['다-fold-dark', { width: 900, height: 1000 }, false, 'dark'], ['다-phone-dark', { width: 390, height: 844 }, true, 'dark']]) {
            await fetch(BASE + '/__mock/reset', { method: 'POST' });
            const ctx = await browser.newContext(Object.assign({ viewport: vw, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
            const json = (r, b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
            await pg.route('**/api/agent-office/desk/orders*', r => r.request().method() === 'GET' ? json(r, { orders: ORDERS }) : r.fallback());
            await pg.route('**/api/agent-office/desk/board*', r => json(r, BOARD));
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await pg.evaluate(th => { localStorage.setItem('jwt_token', 'mock.token.x'); localStorage.setItem('jwt_user', JSON.stringify({ id: 8, name: '시험직원', position: '대리', role: 'user' })); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, theme);
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(2200);
            const wide = vw.width > 1180;
            // ④ 챙길 일 자리 — #666(대표 10/12 「원래 있던 자리에」): 다시 현황판 셋째 칸(채널별 주문 · 발송 박스 다음 · 채팅 목록·손님 연락 카드 아래). 폰(640 이하)은 현황판을 접어 둬도 이 칸만은 늘 보임(#666-b)
            const tdOf = () => pg.evaluate(() => { const b = document.getElementById('desk-todo-box'), bd = document.getElementById('desk-board'), lb = document.getElementById('desk-listbox'), ib = document.getElementById('desk-inbox'); const lis = Array.from(b.querySelectorAll('.desk-todo > li')); const vis = e => e.getClientRects().length > 0; const r = b.getBoundingClientRect();
                return { inBoard: b.parentNode === bd && bd.children[2] === b, inSide: !!document.querySelector('#ao-desk-root .desk-side #desk-todo-box'), below: !vis(b) || (r.top >= lb.getBoundingClientRect().bottom - 1 && r.top >= ib.getBoundingClientRect().bottom - 1), n: lis.length, shown: lis.filter(vis).length, more: !!document.getElementById('desk-todo-more'), cnt: document.getElementById('desk-todo-n').textContent, over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }; });
            let td = await tdOf(); const folded = vw.width <= 640, sh0 = td.shown;
            if (folded) { await pg.evaluate(() => document.getElementById('desk-board-fold').scrollIntoView({ block: 'center' })); await pg.click('#desk-board-fold'); await pg.waitForTimeout(300); td = await tdOf(); }
            ok(td.inBoard && !td.inSide && td.below && td.n === 5 && td.shown === 5 && (!folded || sh0 === 5) && !td.more && td.cnt === '5건' && td.over <= vw.width, `[${name}] ④ #666 「지금 챙길 일」 = 현황판 셋째 칸(채팅 목록·손님 연락 카드 아래 · 오른쪽 칸엔 없음) · 5건 전부 보임(더 보기 없음 · #668-b 안 읽은 문자 줄은 없음)${folded ? ' · 폰은 현황판을 접어 둬도 이 칸은 보임(' + sh0 + '건)' : ''} · 가로 ${td.over}`);
            const bfGo = await pg.evaluate(() => { const b = document.querySelector('#desk-todo-box .bf-go[data-bf="sms"]'); return !!b && b.getClientRects().length > 0; });
            if (bfGo) { await pg.click('#desk-todo-box .bf-go[data-bf="sms"]'); await pg.waitForTimeout(900); ok(await pg.evaluate(() => !document.getElementById('desk-sms').hidden), `[${name}] ④ 옮긴 칸에서도 봇 실패 「문자」 단추 → 문자 창 열림`);
                if (name === '다-fold') { const two = await pg.evaluate(() => { const l = document.querySelector('#desk-sms .sms-left'), p = document.getElementById('sms-pane'); const a = l.getBoundingClientRect(), b = p.getBoundingClientRect(); return { lw: Math.round(a.width), pw: Math.round(b.width), side: b.left >= a.right - 1 && Math.abs(a.top - b.top) < 4, pos: getComputedStyle(p).position }; }); ok(two.lw > 200 && two.pw > 300 && two.side && two.pos !== 'fixed', `[${name}] 폴드 900: 문자 창 = 2단(목록 ${two.lw} + 대화 ${two.pw} 나란히 · 대표가 맘에 들어 한 꼴 그대로)`); }
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(350); await pg.keyboard.press('Escape'); await pg.waitForTimeout(450); if (await pg.evaluate(() => !document.getElementById('desk-sms').hidden)) { await pg.evaluate(() => document.getElementById('sms-close') && document.getElementById('sms-close').click()); await pg.waitForTimeout(400); } }
            else ok(false, `[${name}] ④ 봇 실패 「문자」 단추가 보이지 않음`);
            // ①②③⑤ 대화 틀
            const th = await pg.evaluate(() => { const cs = (e, p) => e ? getComputedStyle(e)[p] : null; const boxes = Array.from(document.querySelectorAll('#desk-list .desk-thread-box')).filter(b => b.getClientRects().length > 0);
                const one = b => ({ th: Number(b.dataset.th), ta: b.querySelectorAll('.desk-turn.last textarea.desk-reply-in').length, fold: Array.from(b.querySelectorAll('.desk-follow-open')).map(x => x.textContent.trim() + ':' + Math.round(x.getBoundingClientRect().height)).join(), end: Array.from(b.querySelectorAll('[data-act="endchat"]')).map(x => cs(x, 'color') + '/' + cs(x, 'backgroundColor') + '/' + cs(x, 'borderTopColor') + '/' + Math.round(x.getBoundingClientRect().height)).join(), bw: cs(b, 'borderTopWidth') });
                const a = document.querySelector('#desk-list .desk-a.answer'), sh = document.querySelector('#desk-list .desk-sec-head'), sc = document.querySelector('#desk-list .desk-sec-copy:not(.desk-a-copy)'), acts = document.querySelector('#desk-list .desk-a-acts');
                return { boxes: boxes.map(one), aBorder: cs(a, 'borderLeftWidth') + '|' + cs(a, 'borderTopWidth') + '|' + cs(a, 'boxShadow'), secBg: cs(sh, 'backgroundColor'), secB: cs(sh.querySelector('b'), 'color'), copy: cs(sc, 'color'), actsBg: cs(acts, 'backgroundColor'), actsBl: cs(acts, 'borderLeftWidth'), over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }; });
            const B = id => th.boxes.find(b => b.th === id) || {};
            ok(th.boxes.length === 4 && th.boxes[0].th === 2301 && B(2301).ta === 1 && B(2301).fold === '' && B(2290).ta === 0 && /^이어서 지시:(4[4-9]|[5-9]\d)$/.test(B(2290).fold) && B(2285).ta === 0 && /^이어서 지시:/.test(B(2285).fold) && B(2280).ta === 1 && B(2280).fold === '', `[${name}] ② 답 칸 = 맨 위 대화만 펼침 · 나머지 끝난 대화는 「이어서 지시」 한 줄(44px 이상) · 되묻기(확인 필요)는 답 칸 그대로(${JSON.stringify(th.boxes.map(b => [b.th, b.ta, b.fold]))})`);
            ok(th.boxes.every(b => b.bw === '1px') && th.aBorder === '0px|0px|none' && th.actsBl === '0px' && th.actsBg === 'rgba(0, 0, 0, 0)', `[${name}] ① 대화 틀 테두리 한 겹(1px) · 답 카드·복사 띠의 안쪽 상자 없음(${th.aBorder} · 띠 ${th.actsBg})`);
            if (!theme) ok(th.boxes.filter(b => b.end).every(b => /^rgb\(102, 112, 133\)\/rgba\(0, 0, 0, 0\)\/rgba\(0, 0, 0, 0\)\/(4[4-9]|[5-9]\d)$/.test(b.end)) && th.boxes.filter(b => b.end).length >= 3 && th.secBg === 'rgb(248, 249, 252)' && th.secB === 'rgb(16, 24, 40)' && th.copy === 'rgb(5, 96, 58)', `[${name}] ③ 「채팅 종료」 = 흐린 글자 단추(회색 글 · 바탕·테두리 없음 · 44px) ⑤ 묶음 머리 = 옅은 회색 + 진한 글 · 초록은 [복사] 글자에만(${th.secBg} · ${th.secB} · ${th.copy})`);
            else { const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js')); const a = await H.audit(pg, '#desk-todo-box, #desk-list .desk-thread-box'); ok(a.fails.length === 0 && a.white.length === 0, `[${name}] 야간 대비 미달 ${a.fails.length} · 흰 칸 ${a.white.length}(글자 ${a.texts}개 · 최소 ${a.minR}${a.fails.length ? ' · ' + a.fails.slice(0, 3).join(' / ') : ''})`); }
            // ② 접힌 줄 → 누르면 펼쳐지고 커서 · 종료 확인은 빨강 그대로
            await pg.click('#desk-list .desk-thread-box[data-th="2290"] .desk-follow-open'); await pg.waitForTimeout(450);
            const op = await pg.evaluate(() => ({ focus: (document.activeElement || {}).id, fold: !!document.querySelector('#desk-list .desk-thread-box[data-th="2290"] .desk-follow-open'), top: !!document.getElementById('reply-2302') }));
            await pg.fill('#reply-2290', '쓰던 글'); await pg.waitForTimeout(2600);
            const keep = await pg.evaluate(() => { const t = document.getElementById('reply-2290'); return t ? t.value : null; });
            ok(op.focus === 'reply-2290' && !op.fold && op.top && keep === '쓰던 글', `[${name}] ② 「이어서 지시」 누름 → 답 칸 펼침 + 커서 · 맨 위 대화 답 칸은 그대로 · 다시 그려져도 쓰던 글 유지`);
            await pg.click('#desk-list .desk-thread-box[data-th="2285"] .desk-th-head'); await pg.waitForTimeout(450);
            ok(await pg.evaluate(() => (document.activeElement || {}).id) === 'reply-2285', `[${name}] ② 접힌 대화의 머리 줄을 눌러도 답 칸이 펴지고 커서`);
            await pg.evaluate(() => { const b = document.querySelector('#desk-list .desk-thread-box[data-th="2285"] [data-act="endchat"]'); b.scrollIntoView({ block: 'center' }); }); await pg.click('#desk-list .desk-thread-box[data-th="2285"] [data-act="endchat"]'); await pg.waitForTimeout(350);
            const ask = await pg.evaluate(() => { const y = document.querySelector('#desk-list [data-act="hidethread"]'); return y ? getComputedStyle(y).backgroundColor + '|' + y.textContent.trim() + '|' + (document.activeElement === y) : ''; });
            ok(theme ? /\|종료하기\|true$/.test(ask) : /^rgb\((217, 45, 32|180, 35, 24)\)\|종료하기\|true$/.test(ask) /* 빨강(마우스가 올라가 있으면 진한 빨강) */, `[${name}] ③ 누르면 그 자리에 [종료하기](빨강 · 초점) — 확인 단추는 종전대로(${ask})`);
            const over = await pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
            ok(over <= vw.width && errs.length === 0, `[${name}] 가로 넘침 없음(${over} ≤ ${vw.width}) · 화면 오류 ${errs.length}${errs.length ? ' ' + errs[0].slice(0, 120) : ''}`);
            if (OUT) await pg.screenshot({ path: path.join(OUT, `da-${name}.png`), fullPage: true });
            await ctx.close();
        }
    } finally { await browser.close().catch(() => { }); srv.kill(); }
    console.log(`
결과: ${pass}/${pass + fail}`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
