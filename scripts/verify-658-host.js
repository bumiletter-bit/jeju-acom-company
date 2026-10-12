// #658 「끼우는 자리」 합친 검증 — 실제 화면(index.html + ao-desk.js)에 ao-inbox.js·css 를 얹어, 문자 창의 채널 탭·뒤로가기·Esc·들어오는 길을 실클릭으로 본다
//   가짜 서버 2개: scripts/_mock-610.js(화면·문자 API · PORT658H 없으면 3465) + scripts/_mock-658.js(/api/inbox/* · PORT658I 없으면 3457) · DB·외부 호출 0
//   사용: node scripts/verify-658-host.js   (다른 Playwright 검증과 같은 포트로 동시에 돌리지 말 것 · SHOTS=폴더 를 주면 그림도 남김)
//   index.html 에 ao-inbox 두 줄이 아직 없어도(배포 때 총괄이 넣음) 돌도록 이 검증이 직접 얹는다. 이미 들어 있으면 얹지 않는다.
const path = require('path'), fs = require('fs');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), OUT = process.env.SHOTS || '';
const P1 = Number(process.env.PORT658H || 3465), P2 = Number(process.env.PORT658I || 3457), BASE = 'http://localhost:' + P1, INB = 'http://localhost:' + P2;
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : '  FAIL ') + m); };
(async () => {
    if (OUT) fs.mkdirSync(OUT, { recursive: true });
    const s1 = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-610.js'), String(P1)], { stdio: 'ignore' });
    const s2 = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-658.js'), String(P2)], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1600));
    const browser = await chromium.launch();
    try {
        for (const [name, vw, phone, theme] of [['pc', { width: 1440, height: 900 }, false, null], ['fold', { width: 900, height: 1000 }, false, null], ['phone', { width: 390, height: 844 }, true, null], ['fold-dark', { width: 900, height: 1000 }, false, 'dark'], ['phone-dark', { width: 390, height: 844 }, true, 'dark']]) {
            await fetch(BASE + '/__mock/reset', { method: 'POST' }); await fetch(INB + '/__mock/reset', { method: 'POST' });
            const ctx = await browser.newContext(Object.assign({ viewport: vw, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
            await pg.route('**/api/inbox/**', async r => {   // 톡톡·문의 API 는 둘째 가짜 서버로 넘긴다
                const q = r.request(), u = new URL(q.url());
                try { const x = await fetch(INB + u.pathname + u.search, { method: q.method(), headers: { 'Content-Type': 'application/json' }, body: q.method() === 'GET' ? undefined : (q.postData() || '{}') }); r.fulfill({ status: x.status, contentType: 'application/json', body: await x.text() }); }
                catch (e) { r.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false,"error":"가짜 서버에 닿지 못함"}' }); }
            });
            const jget = async url => (await fetch(url, { headers: { Authorization: 'Bearer x' } })).json();
            await pg.route('**/api/agent-office/desk/inbox**', async r => {
                const q = r.request();
                try {
                    if (q.method() === 'POST') { const b = q.postDataJSON() || {}; const x = await fetch(INB + '/api/inbox/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ch: b.kind, id: b.id, undo: !!b.undo }) }); return r.fulfill({ status: x.status, contentType: 'application/json', body: JSON.stringify({ ok: x.ok, message: b.undo ? '다시 대기로 돌렸어요' : '확인했습니다' }) }); }
                    const out = { days: 30, counts: {}, more: { sms: 0, talk: 0, qna: 0, inquiry: 0 }, at: new Date().toISOString() };
                    const c = (await jget(INB + '/api/inbox/counts')).counts || {};
                    for (const ch of ['talk', 'qna', 'inquiry']) { out[ch] = ((await jget(INB + '/api/inbox/threads?ch=' + ch + '&scope=all')).threads || []).map(x => Object.assign({}, x, { kind: ch, tkey: x.id })); out.counts[ch] = { open: (c[ch] || {}).open || 0, ai: 0, staff: 0 }; }
                    const sm = await jget(BASE + '/api/sms/summary'), th = (await jget(BASE + '/api/sms/threads?scope=all&q=&limit=50')).items || [];
                    out.sms = th.filter(x => x.status !== 'ignored').map(x => Object.assign({}, x, { kind: 'sms', done: false, last_text: x.last_dir === 'out' ? x.last_out_text : x.last_in_text, needs_reply: !['closed', 'ignored'].includes(x.status) && (x.unread > 0 || !!x.needs_staff) }));
                    out.counts.sms = { open: sm.open_threads };
                    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
                } catch (e) { r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"가짜 서버에 닿지 못함"}' }); }
            });
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await pg.evaluate(th => { localStorage.setItem('jwt_token', 'mock.token.x'); localStorage.setItem('jwt_user', JSON.stringify({ id: 8, name: '시험직원', position: '대리', role: 'user' })); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, theme);
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(2200);
            const st = () => pg.evaluate(() => { const vis = e => !!e && e.getClientRects().length > 0; const tabs = Array.from(document.querySelectorAll('#sms-tabs .sms-tab'));
                return { tabsVis: vis(document.getElementById('sms-tabs')), tabs: tabs.map(b => b.textContent.replace(/\s+/g, '') + (b.getAttribute('aria-selected') === 'true' ? '*' : '')).join('|'), title: document.getElementById('sms-title').textContent, short: Array.from(document.querySelectorAll('#desk-shorts .desk-short')).map(b => b.textContent.replace(/\s+/g, '')).join('|'), dot: document.getElementById('desk-plus-n').hidden ? '' : document.getElementById('desk-plus-n').textContent,
                    items: ['talk', 'qna', 'inquiry'].map(k => { const b = document.getElementById('desk-inb-' + k), n = document.getElementById('inb-n-' + k); return b.hidden ? '-' : (n.hidden ? '0' : n.textContent); }).join('|'), win: !document.getElementById('desk-sms').hidden && document.body.classList.contains('sms-win-open'), host: vis(document.getElementById('inb-host')), cols: vis(document.querySelector('#desk-sms .sms-cols')), hist: (history.state || {}).smsWin || '', hostCh: document.getElementById('inb-host').dataset.ch || '',
                    todo: (() => { const li = document.querySelector('#desk-todo-box .sms-todo.cust'); return li ? li.querySelector('span').textContent + '|' + li.querySelector('b').textContent + '|' + Array.from(li.querySelectorAll('.cu-go')).map(b => b.textContent).join(',') : ''; })(), oldTodo: !!document.querySelector('#desk-todo-box .sms-todo[data-sms="active"]'), over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }; });
            // ① ao-inbox 가 없을 때(옛 캐시·배포 전) = 종전 그대로
            const had = await pg.evaluate(() => !!window.AkmInbox);
            if (!had) {
                const a0 = await st();
                ok(!a0.tabsVis && a0.title === '문자' && a0.short === '문자7' && a0.dot === '7' && a0.items === '-|-|-' && a0.oldTodo && !a0.todo, `[${name}] ① ao-inbox 가 없으면 종전 그대로: 탭 줄 없음 · 제목 「문자」 · 바로가기 「${a0.short}」 · [+] 메뉴에 톡톡·문의 항목 없음 · 챙길 일은 「안 읽은 문자」 줄`);
                await pg.addStyleTag({ url: '/ao-inbox.css' }); await pg.addScriptTag({ url: '/ao-inbox.js' });
            }
            await pg.waitForFunction(() => window.AkmInbox && window.AkmInbox.available() && document.querySelector('#desk-shorts .desk-short') && /손님/.test(document.querySelector('#desk-shorts .desk-short').textContent), null, { timeout: 15000 }).catch(() => { });
            await pg.waitForTimeout(600);
            const a1 = await st();
            const C = (await jget(INB + '/api/inbox/counts')).counts, NO = ['talk', 'qna', 'inquiry'].map(k => C[k].open), SUM = 7 + NO.reduce((a, b) => a + b, 0);   // #660: 톡톡·문의 숫자 = 답 안 한 것(서버 counts.open 그대로)
            ok(NO.every(n => n > 0) && a1.short === '손님' + SUM && a1.dot === String(SUM) && a1.items === NO.join('|') && a1.title === '손님 연락', `[${name}] ② 얹은 뒤: 바로가기 「${a1.short}」(문자 안 읽음 7 + 톡톡·상품문의·주문문의 답 안 한 것 ${NO.join(' + ')}) · [+] 점 ${a1.dot} · 메뉴 「손님」 묶음 숫자 ${a1.items}`);
            ok(a1.todo === '' && !a1.oldTodo && a1.over <= vw.width, `[${name}] ② #661 챙길 일에 「손님 연락」 줄 없음(종전 문자 줄도 없음 — 숫자는 손님 연락 카드에만) · 가로 ${a1.over}`);
            // ③ 바로가기 → 창(문자 탭부터) → 탭 줄
            await pg.click('#desk-short-sms'); await pg.waitForTimeout(900);
            const b1 = await st();
            const tb = await pg.evaluate(() => { const el = document.getElementById('sms-tabs'), bs = Array.from(el.querySelectorAll('.sms-tab')); const rs = bs.map(b => b.getBoundingClientRect()); return { rows: new Set(rs.map(r => Math.round(r.top))).size, minH: Math.min(...rs.map(r => Math.round(r.height))), fit: el.scrollWidth <= el.clientWidth + 1, inWin: el.getBoundingClientRect().right <= window.innerWidth + 1, role: el.getAttribute('role') }; });
            ok(b1.win && b1.tabs === `문자7*|톡톡${NO[0]}|상품문의${NO[1]}|주문문의${NO[2]}` && b1.cols && !b1.host && b1.hist === 'win' && tb.rows === 1 && tb.minH >= 44 && tb.role === 'tablist' && (phone || tb.fit), `[${name}] ③ 「손님 n」 → 창이 문자 탭부터(안 읽은 문자가 있어서) · 탭 줄 「${b1.tabs}」 한 줄 · 높이 ${tb.minH}px${phone ? '' : ' · 줄 안에 전부'}`);
            if (OUT) await pg.screenshot({ path: path.join(OUT, `host-${name}-sms.png`) });
            // ④ 문자 대화를 편 채 톡톡 탭으로 → 대화 칸 되돌림 · 본문 자리 넘김
            await pg.click('#sms-list .sms-item[data-id="3"] .sms-row'); await pg.waitForTimeout(700);
            const c0 = await st();
            if (phone) { await pg.evaluate(() => { const b = document.querySelector('#sms-tabs .sms-tab[data-ch="talk"]'); b.click(); }); } else await pg.click('#sms-tabs .sms-tab[data-ch="talk"]');
            await pg.waitForSelector('#inb-list .sms-item', { timeout: 8000 }).catch(() => { }); await pg.waitForTimeout(500);
            const c1 = await st(); const rows = await pg.evaluate(() => document.querySelectorAll('#inb-list .sms-item').length), allN = ((await jget(INB + '/api/inbox/threads?ch=talk&scope=all')).threads || []).length, openN = await pg.evaluate(() => (document.getElementById('inb-open-n') || {}).textContent || '');
            ok(c0.hist === 'th' && c1.hist === 'win' && c1.tabs.split('|')[1].endsWith('*') && !c1.tabs.split('|')[0].endsWith('*') && c1.host && !c1.cols && c1.hostCh === 'talk' && rows === allN && openN === String(NO[0]) && await pg.evaluate(() => !document.querySelector('#sms-pane .sms-thread')), `[${name}] ④ 문자 대화를 편 채 톡톡 탭 → 문자 대화는 접히고 뒤로가기 칸도 되돌림(${c0.hist} → ${c1.hist}) · 본문 = 톡톡 전체 대화 ${rows}건(#inb-host · [답 안 한 것만 ${openN}]) · 문자 칸은 숨김`);
            if (!phone) { const two = await pg.evaluate(() => { const l = document.querySelector('#inb-host .sms-left'), p = document.querySelector('#inb-host .sms-pane'); if (!l || !p) return null; const a = l.getBoundingClientRect(), b = p.getBoundingClientRect(); return { lw: Math.round(a.width), pw: Math.round(b.width), side: b.left >= a.right - 1 && Math.abs(a.top - b.top) < 4 }; }); ok(two && two.lw > 200 && two.pw > 300 && two.side, `[${name}] ④ 톡톡 탭도 문자와 같은 2단(목록 ${two && two.lw} + 대화 ${two && two.pw})`); }
            // ⑤ 톡톡 대화 펴기 → 뒤로가기 1번 = 대화만 접힘 · 2번 = 창 닫힘
            await pg.click('#inb-list .sms-item[data-id="t1"] .sms-row'); await pg.waitForTimeout(800);
            const d1 = await st(), o1 = await pg.evaluate(() => window.AkmInbox.isOpen());
            if (OUT) await pg.screenshot({ path: path.join(OUT, `host-${name}-talk.png`) });
            await pg.goBack().catch(() => { }); await pg.waitForTimeout(600);
            const d2 = await st(), o2 = await pg.evaluate(() => window.AkmInbox.isOpen());
            await pg.goBack().catch(() => { }); await pg.waitForTimeout(600);
            const d3 = await st();
            ok(o1 && d1.hist === 'th' && !o2 && d2.hist === 'win' && d2.win && d2.host && !d3.win && !d3.hist && await pg.evaluate(() => document.getElementById('page-agent-office').classList.contains('active') && location.pathname === '/'), `[${name}] ⑤ 톡톡 대화를 펴면 칸 하나(${d1.hist}) · 뒤로가기 1번 = 대화만 접힘(창·탭 그대로) · 2번 = 창 닫힘(페이지 그대로)`);
            // ⑥ [+] 메뉴 「상품문의」 → 그 탭 · Esc 순서(대화 → 창) · 닫은 뒤 초점
            await pg.click('#desk-plus-btn'); await pg.waitForTimeout(300); await pg.click('#desk-inb-qna'); await pg.waitForTimeout(1100);
            await pg.waitForSelector('#inb-list .sms-item', { timeout: 8000 }).catch(() => { });
            const e1 = await st();
            await pg.click('#inb-list .sms-item[data-id="q1"] .sms-row'); await pg.waitForTimeout(800);
            const e2 = await st();
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(600);
            const e3 = await st(), eo = await pg.evaluate(() => window.AkmInbox.isOpen());
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(700);
            const e4 = await st();
            ok(e1.win && e1.hostCh === 'qna' && /상품문의\d*\*/.test(e1.tabs) && e1.hist === 'win' && e2.hist === 'th' && !eo && e3.win && e3.hist === 'win' && !e4.win && !e4.hist, `[${name}] ⑥ [+] 「상품문의」 → 그 탭으로 열림 · 대화 펴고 Esc 1번 = 대화 접힘(칸 ${e2.hist} → ${e3.hist}) · 2번 = 창 닫힘`);
            // ⑦ #661 손님 연락 카드: 칩 = 창의 [답 안 한 것만 n](네 채널) · 줄 → 그 대화 · 카드 [확인] → 창 숫자도 줄어듦 · 닫고 「문자」 항목으로 다시 열면 문자 탭
            await pg.evaluate(() => { __aoDesk.S.inboxAt = 0; return __aoDesk.loadInbox(); }); await pg.waitForTimeout(600);
            const cu = () => pg.evaluate(() => ({ chips: ['sms', 'talk', 'qna', 'inquiry'].map(k => document.getElementById('inbox-n-' + k).textContent).join('|'), rows: document.querySelectorAll('#desk-inbox-list .desk-cu').length, kinds: Array.from(new Set(Array.from(document.querySelectorAll('#desk-inbox-list .desk-cu')).map(r => r.dataset.kind))).sort().join(','), win: (() => { const c = window.AkmInbox.counts(); return ['talk', 'qna', 'inquiry'].map(k => c[k].needs).join('|'); })(), smsOpen: (document.getElementById('sms-open-n') || {}).textContent || '', over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
            const k1 = await cu();
            ok(k1.chips === '7|' + NO.join('|') && k1.chips.split('|').slice(1).join('|') === k1.win && k1.smsOpen === '7' && k1.kinds === 'inquiry,qna,sms,talk' && k1.over <= vw.width, `[${name}] ⑦ #661 카드 칩 「${k1.chips}」 = 창의 [답 안 한 것만](문자 ${k1.smsOpen} · 톡톡·상품문의·주문문의 ${k1.win}) · 네 채널이 한 목록(${k1.rows}줄) · 가로 ${k1.over}`);
            await pg.click('#desk-inbox-tabs button[data-k="inquiry"]'); await pg.waitForTimeout(300);
            const iq = await pg.evaluate(() => { const r = document.querySelector('#desk-inbox-list .desk-cu[data-kind="inquiry"]'); r.scrollIntoView({ block: 'center' }); return r.dataset.id; });
            await pg.click('#desk-inbox-list .desk-cu[data-kind="inquiry"] .desk-cu-row'); await pg.waitForTimeout(1300);
            const f1 = await st(), f1o = await pg.evaluate(() => ({ open: window.AkmInbox.isOpen(), id: (document.querySelector('#inb-host .sms-item.open') || { dataset: {} }).dataset.id || '' }));
            await pg.evaluate(() => document.getElementById('sms-close').click()); await pg.waitForTimeout(900);
            const f2 = await st(), un = await pg.evaluate(() => document.getElementById('inb-host').children.length);
            ok(f1.win && f1.hostCh === 'inquiry' && /주문문의\d*\*/.test(f1.tabs) && f1o.open && f1o.id === iq && !f2.win && !f2.hist, `[${name}] ⑦ #661 카드의 주문 문의 줄 누름 → 손님 연락 창 주문문의 탭의 그 대화(${f1o.id}) · [닫기] 뒤 칸 정리(톡톡·문의 칸 비움 ${un})`);
            await pg.click('#desk-inbox-tabs button[data-k="talk"]'); await pg.waitForTimeout(300);
            await pg.evaluate(() => { const b = document.querySelector('#desk-inbox-list .desk-cu.wait[data-kind="talk"] .desk-cu-ok'); b.scrollIntoView({ block: 'center' }); }); await pg.click('#desk-inbox-list .desk-cu.wait[data-kind="talk"] .desk-cu-ok'); await pg.waitForTimeout(1500);
            const k2 = await cu(), a2 = await st();
            ok(k2.chips.split('|')[1] === String(NO[0] - 1) && k2.win.split('|')[0] === String(NO[0] - 1) && a2.items.split('|')[0] === String(NO[0] - 1) && a2.short === '손님' + (Number(a2.dot)) && Number(a2.dot) === (await pg.evaluate(() => Number((document.getElementById('sms-chip-n') || {}).textContent) || 0)) + NO.reduce((x, y) => x + y, 0) - 1, `[${name}] ⑦ #661 카드에서 톡톡 [확인] → 카드 칩 ${NO[0]} → ${k2.chips.split('|')[1]} · 창 숫자·[+] 메뉴·바로가기도 같이 줄어듦(${a2.short} · 카드 ${k2.chips} · 창 ${k2.win} · 메뉴 ${a2.items})`);
            await pg.click('#desk-inbox-tabs button[data-k="talk"]'); await pg.waitForTimeout(200);
            {   // #663 카드 = 대기 줄만 · 대기 0 이면 빈 상태 + 「손님 연락 창 열기」
                const w0 = await pg.evaluate(() => { const r = Array.from(document.querySelectorAll('#desk-inbox-list .desk-cu')); return { n: r.length, wait: r.filter(x => x.classList.contains('wait')).length, bg: new Set(r.map(x => getComputedStyle(x.querySelector('.desk-cu-ch')).backgroundColor)).size }; });
                await pg.click('#desk-inbox-tabs button[data-k="inquiry"]'); await pg.waitForTimeout(300);
                for (let i = 0; i < 6 && await pg.locator('#desk-inbox-list .desk-cu[data-kind="inquiry"] .desk-cu-ok').count(); i++) { await pg.evaluate(() => document.querySelector('#desk-inbox-list .desk-cu[data-kind="inquiry"] .desk-cu-ok').scrollIntoView({ block: 'center' })); await pg.click('#desk-inbox-list .desk-cu[data-kind="inquiry"] .desk-cu-ok'); await pg.waitForTimeout(1300); }
                const w1 = await pg.evaluate(() => ({ none: (document.querySelector('#desk-inbox-list .desk-cu-none') || {}).textContent || '', chip: document.getElementById('inbox-n-inquiry').textContent, win: window.AkmInbox.counts().inquiry.needs }));
                await pg.evaluate(() => document.querySelector('#desk-inbox-list .desk-cu-link').scrollIntoView({ block: 'center' })); await pg.click('#desk-inbox-list .desk-cu-link'); await pg.waitForTimeout(1300);
                const w2 = await st(); await pg.evaluate(() => document.getElementById('sms-close').click()); await pg.waitForTimeout(900);
                await pg.click('#desk-inbox-tabs button[data-k="inquiry"]'); await pg.waitForTimeout(200);
                ok(w0.n > 0 && w0.n === w0.wait && w0.n === SUM - 1 && w0.bg === 4 && /주문문의 미처리 건이 없어요/.test(w1.none) && w1.chip === '0' && w1.win === 0 && w2.win && w2.hostCh === 'inquiry', `[${name}] ⑦ #663 카드 = 대기 줄만 ${w0.n}줄(= 칩 합) · 채널 색 ${w0.bg}가지 · 주문 문의를 다 [확인]하면 「${w1.none.trim()}」 · 링크 → 손님 연락 창 주문문의 탭`);
            }
            await pg.evaluate(() => window.scrollTo(0, 0)); await pg.click('#desk-plus-btn'); await pg.waitForTimeout(300); await pg.click('#desk-sms-now'); await pg.waitForTimeout(1000);
            const f3 = await st();
            ok(f3.win && f3.tabs.split('|')[0].endsWith('*') && f3.cols && !f3.host, `[${name}] ⑦ 「문자」로 다시 열면 문자 탭`);
            // ⑧ 탭 키보드(→) · 야간 대비 · 끝
            if (!phone) { await pg.focus('#sms-tabs .sms-tab[data-ch="sms"]'); await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(700); const g = await st(); ok(g.hostCh === 'talk' && await pg.evaluate(() => (document.activeElement || {}).dataset && document.activeElement.dataset.ch) === 'talk', `[${name}] ⑧ 탭 줄 → 키로 다음 탭(톡톡) · 초점 따라감`); }
            if (theme) { const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js')); const a = await H.audit(pg, '#sms-tabs'); ok(a.fails.length === 0 && a.white.length === 0, `[${name}] 야간: 탭 줄 대비 미달 ${a.fails.length} · 흰 칸 ${a.white.length}(글자 ${a.texts}개 · 최소 ${a.minR}${a.fails.length ? ' · ' + a.fails.slice(0, 3).join(' / ') : ''})`); }
            await pg.evaluate(() => document.getElementById('sms-close').click()); await pg.waitForTimeout(600);
            const z = await st();
            ok(!z.win && !z.hist && z.over <= vw.width && errs.length === 0, `[${name}] 끝: 창 닫힘 · 남은 뒤로가기 칸 없음 · 가로 넘침 없음(${z.over}) · 화면 오류 ${errs.length}${errs.length ? ' ' + errs[0].slice(0, 160) : ''}`);
            {   // #668(대표 10/12 「[+] 처음 누르면 손님 건이 늦게 나오던데」): 문자 요약·톡톡 숫자 답이 2초 늦게 와도 [+] 를 누른 직후 「손님」 네 줄이 보인다(지난 기억) · 숫자 = 손님 연락 카드 칩과 같은 수 · 답이 온 뒤 메뉴 높이 그대로
                const slow = r => setTimeout(() => r.fallback().catch(() => { }), 2000);
                await pg.route('**/api/inbox/counts**', slow); await pg.route('**/api/sms/summary**', slow);
                const menu = () => pg.evaluate(() => { const vis = e => !!e && !e.hidden && e.getClientRects().length > 0, ids = ['desk-sms-now', 'desk-inb-talk', 'desk-inb-qna', 'desk-inb-inquiry'], nid = ['sms-chip-n', 'inb-n-talk', 'inb-n-qna', 'inb-n-inquiry'];
                    return { rows: ids.filter(i => vis(document.getElementById(i))).length, nums: nid.map(i => { const n = document.getElementById(i); return n.hidden ? '0' : n.textContent; }).join('|'), h: Math.round(document.getElementById('desk-plus').getBoundingClientRect().height), dot: (() => { const n = document.getElementById('desk-plus-n'); return n.hidden ? '0' : n.textContent; })(), short: Array.from(document.querySelectorAll('#desk-shorts .desk-short')).map(b => b.textContent.replace(/\s+/g, '')).join(','), chips: ['sms', 'talk', 'qna', 'inquiry'].map(k => document.getElementById('inbox-n-' + k).textContent).join('|'), sumDone: !!window.AkmInbox && window.AkmInbox.available() }; });
                await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#desk-plus-btn', { state: 'visible' });
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(150); const q1 = await menu();
                await pg.waitForTimeout(4200); const q2 = await menu(); const tot = q2.chips.split('|').reduce((n, v) => n + Number(v), 0);
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
                ok(q1.rows === 4 && !q1.sumDone && q2.sumDone && q1.nums === q2.nums && q2.nums === q2.chips && q1.h === q2.h && q2.dot === String(tot) && q1.dot === q2.dot && q2.short === (tot > 0 ? '손님' + tot : ''), `[${name}] #668 숫자 답이 2초 늦어도 [+] 누른 직후 「손님」 ${q1.rows}줄(기억한 숫자 ${q1.nums}) → 답 뒤 ${q2.nums} = 카드 칩 ${q2.chips} · [+] 점·바로가기 ${q2.dot}(네 채널 미처리 합) · 메뉴 높이 ${q1.h} → ${q2.h}`);
                await pg.evaluate(() => localStorage.removeItem('akm_desk_cust'));
                await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#desk-plus-btn', { state: 'visible' });
                await pg.click('#desk-plus-btn'); await pg.waitForTimeout(150); const q3 = await menu();
                await pg.waitForTimeout(4200); const q4 = await menu();
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
                ok(q3.rows === 0 && q4.rows === 4 && q4.nums === q2.nums && await pg.evaluate(() => { try { const v = JSON.parse(localStorage.getItem('akm_desk_cust')); return v.sms === true && v.inb === true; } catch (e) { return false; } }), `[${name}] #668 이 브라우저에서 처음(기억 없음)이면 답이 온 뒤 ${q4.rows}줄(${q3.rows} → ${q4.rows}) · 그때 기억해 다음부터 바로`);
                await pg.unroute('**/api/inbox/counts**', slow); await pg.unroute('**/api/sms/summary**', slow);
            }
            {   // #676(대표 10/12 폴드 실물): 챙길 일 「봇 실패」 알약 = 문의 관리로 보내지 않고 손님 연락 창의 그 대화로 · 거기서 [확인]하면 줄이 바로 빠짐 · 뒤로가기 = 에이전트 오피스 그대로
                await fetch(BASE + '/__mock/reset', { method: 'POST' }); await fetch(INB + '/__mock/reset', { method: 'POST' });
                const openIds = async () => ((await jget(INB + '/api/inbox/threads?ch=talk&scope=open')).threads || []).map(x => x.id);
                const all0 = await openIds(); let pick = all0.slice(0, 1), smsIds = [2];
                const bRoute = async r => { const now = await openIds(), tk = pick.filter(i => now.includes(i)), sm = smsIds.length; const todo = [{ key: 'fail', label: '알림 발송 실패', count: 2, where: '문의 관리 · 알림 발송 이력' }];
                    if (tk.length + sm > 0) todo.unshift({ key: 'botfail', label: '봇 실패', count: tk.length + sm, talk: tk.length, sms: sm, where: '톡톡 ' + tk.length + ' · 문자 ' + sm, talk_ids: tk, sms_ids: smsIds, items: [], more: 0 });
                    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [], ship: [], todo, live: [], today: [], progress: [], is_admin: false }) }); };
                await pg.route('**/api/agent-office/desk/board*', bRoute);
                const reB = async () => { await pg.evaluate(() => __aoDesk.loadBoard()); await pg.waitForTimeout(300); if (await pg.evaluate(() => { const b = document.getElementById('desk-board-fold'); return !!b && b.getClientRects().length > 0 && !document.querySelector('#desk-todo-box').getClientRects().length; })) { await pg.evaluate(() => document.getElementById('desk-board-fold').scrollIntoView({ block: 'center' })); await pg.click('#desk-board-fold'); await pg.waitForTimeout(300); } };
                const pill = async k => { await pg.evaluate(k => document.querySelector('#desk-todo-box .bf-go[data-bf="' + k + '"]').scrollIntoView({ block: 'center' }), k); await pg.click('#desk-todo-box .bf-go[data-bf="' + k + '"]'); await pg.waitForTimeout(1500); };
                const bf = () => pg.evaluate(() => { const li = document.querySelector('#desk-todo-box .bot-fail'), vis = e => !!e && e.getClientRects().length > 0, th = document.getElementById('inb-thread');
                    return { pills: li ? Array.from(li.querySelectorAll('.bf-go')).map(b => b.textContent).join(',') : '', note: li ? li.querySelector('small i').textContent : '', h: li ? Math.min(...Array.from(li.querySelectorAll('.bf-go')).map(b => Math.round(b.getBoundingClientRect().height))) : 0, page: document.getElementById('page-agent-office').classList.contains('active') && !document.getElementById('page-inquiry').classList.contains('active'), win: document.body.classList.contains('sms-win-open'), ch: (document.querySelector('#sms-tabs .sms-tab[aria-selected="true"]') || { dataset: {} }).dataset.ch || '', open: (window.AkmInbox._state.open || ''), title: vis(th) ? (document.getElementById('inb-th-title') || {}).textContent || '' : '', rows: document.querySelectorAll('#inb-list .sms-item').length, only: (document.getElementById('inb-open') || { getAttribute() { return ''; } }).getAttribute('aria-pressed'), hist: (history.state || {}).smsWin || '', smsOpen: (document.querySelector('#sms-list .sms-item.open') || { dataset: {} }).dataset.id || '', over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }; });
                await reB(); const f0 = await bf();
                await pill('talk'); const f1 = await bf();
                ok(f0.pills === '톡톡 1,문자 1' && f0.note === '봇이 답을 못 낸 건 · 누르면 그 대화로' && f0.h >= (vw.width <= 720 ? 44 : 32) && f1.page && f1.win && f1.ch === 'talk' && f1.open.indexOf(pick[0]) >= 0 && f1.hist === 'th' && f1.over <= vw.width, `[${name}] #676 「톡톡 1」 알약(${f0.h}px · 「${f0.note}」) → 문의 관리가 아니라 손님 연락 창 톡톡 탭의 그 대화(${f1.title}) · 메뉴는 에이전트 오피스 그대로 · 가로 ${f1.over}`, JSON.stringify(f1));
                await pg.click('#inb-done'); await pg.waitForTimeout(2600); const f2 = await bf();
                ok(f2.pills === '문자 1' && f2.win, `[${name}] #676 그 대화에서 [확인] → 챙길 일 「봇 실패」 줄에서 톡톡이 바로 빠짐(「${f0.pills}」 → 「${f2.pills}」)`, JSON.stringify(f2));
                await pg.goBack(); await pg.waitForTimeout(500); const g1 = await bf(); await pg.goBack(); await pg.waitForTimeout(700); const g2 = await bf();
                ok(g1.win && !g1.title && g1.page && !g2.win && g2.page, `[${name}] #676 뒤로가기 실클릭: 대화 → 목록 → 창 닫힘 · 끝까지 에이전트 오피스(다른 메뉴로 안 나감)`, JSON.stringify([g1.win, g1.title, g2.win, g2.page]));
                pick = (await openIds()).slice(0, 2); await reB(); const f3 = await bf();
                await pill('talk'); const f4 = await bf(); const on = (await openIds()).length;
                ok(f3.pills === '톡톡 2,문자 1' && f4.win && f4.ch === 'talk' && !f4.title && f4.only === 'true' && f4.rows === on && f4.page, `[${name}] #676 톡톡 여러 건 → 톡톡 탭 [미처리] 켜진 목록(${f4.rows}줄 = 미처리 ${on})`, JSON.stringify(f4));
                await pg.evaluate(() => document.getElementById('sms-close').click()); await pg.waitForTimeout(900); await reB();
                await pill('sms'); const f5 = await bf();
                ok(f5.win && f5.ch === 'sms' && f5.smsOpen === '2' && f5.page, `[${name}] #676 「문자 1」 알약 → 문자 탭의 그 대화(대화 ${f5.smsOpen})`, JSON.stringify(f5));
                await pg.evaluate(() => document.getElementById('sms-close').click()); await pg.waitForTimeout(900);
                await pg.evaluate(() => localStorage.removeItem('akm_inb_only_open_talk')); await pg.unroute('**/api/agent-office/desk/board*', bRoute);
            }
            await ctx.close();
        }
    } finally { await browser.close().catch(() => { }); s1.kill(); s2.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
