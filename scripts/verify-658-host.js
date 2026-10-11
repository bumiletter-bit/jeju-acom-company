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
            ok(a1.short === '손님15' && a1.dot === '15' && a1.items === '5|2|1' && a1.title === '손님 연락', `[${name}] ② 얹은 뒤: 바로가기 「${a1.short}」(문자 7 + 톡톡 5 + 상품문의 2 + 주문문의 1) · [+] 점 ${a1.dot} · 메뉴 「손님」 묶음 숫자 ${a1.items}`);
            ok(a1.todo === '손님 연락|16건|문자 7,톡톡 5,상품문의 2,주문문의 2' && !a1.oldTodo && a1.over <= vw.width, `[${name}] ② 챙길 일 「${a1.todo}」(문자 = 안 읽음 · 톡톡·문의 = 답 안 한 것) · 종전 문자 줄은 이 줄로 합쳐짐 · 가로 ${a1.over}`);
            // ③ 바로가기 → 창(문자 탭부터) → 탭 줄
            await pg.click('#desk-short-sms'); await pg.waitForTimeout(900);
            const b1 = await st();
            const tb = await pg.evaluate(() => { const el = document.getElementById('sms-tabs'), bs = Array.from(el.querySelectorAll('.sms-tab')); const rs = bs.map(b => b.getBoundingClientRect()); return { rows: new Set(rs.map(r => Math.round(r.top))).size, minH: Math.min(...rs.map(r => Math.round(r.height))), fit: el.scrollWidth <= el.clientWidth + 1, inWin: el.getBoundingClientRect().right <= window.innerWidth + 1, role: el.getAttribute('role') }; });
            ok(b1.win && b1.tabs === '문자7*|톡톡5|상품문의2|주문문의1' && b1.cols && !b1.host && b1.hist === 'win' && tb.rows === 1 && tb.minH >= 44 && tb.role === 'tablist' && (phone || tb.fit), `[${name}] ③ 「손님 n」 → 창이 문자 탭부터(안 읽은 문자가 있어서) · 탭 줄 「${b1.tabs}」 한 줄 · 높이 ${tb.minH}px${phone ? '' : ' · 줄 안에 전부'}`);
            if (OUT) await pg.screenshot({ path: path.join(OUT, `host-${name}-sms.png`) });
            // ④ 문자 대화를 편 채 톡톡 탭으로 → 대화 칸 되돌림 · 본문 자리 넘김
            await pg.click('#sms-list .sms-item[data-id="3"] .sms-row'); await pg.waitForTimeout(700);
            const c0 = await st();
            if (phone) { await pg.evaluate(() => { const b = document.querySelector('#sms-tabs .sms-tab[data-ch="talk"]'); b.click(); }); } else await pg.click('#sms-tabs .sms-tab[data-ch="talk"]');
            await pg.waitForSelector('#inb-list .sms-item', { timeout: 8000 }).catch(() => { }); await pg.waitForTimeout(500);
            const c1 = await st(); const rows = await pg.evaluate(() => document.querySelectorAll('#inb-list .sms-item').length);
            ok(c0.hist === 'th' && c1.hist === 'win' && c1.tabs.split('|')[1].endsWith('*') && !c1.tabs.split('|')[0].endsWith('*') && c1.host && !c1.cols && c1.hostCh === 'talk' && rows === 5 && await pg.evaluate(() => !document.querySelector('#sms-pane .sms-thread')), `[${name}] ④ 문자 대화를 편 채 톡톡 탭 → 문자 대화는 접히고 뒤로가기 칸도 되돌림(${c0.hist} → ${c1.hist}) · 본문 = 톡톡 목록 ${rows}건(#inb-host) · 문자 칸은 숨김`);
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
            // ⑦ 챙길 일 채널 알약 → 그 탭 · 닫고 「문자」 항목으로 다시 열면 문자 탭
            await pg.evaluate(() => { const b = document.querySelector('#desk-todo-box .cu-go[data-cu="inquiry"]'); b.scrollIntoView({ block: 'center' }); }); await pg.click('#desk-todo-box .cu-go[data-cu="inquiry"]'); await pg.waitForTimeout(1100);
            const f1 = await st();
            await pg.evaluate(() => document.getElementById('sms-close').click()); await pg.waitForTimeout(700);
            const f2 = await st(), un = await pg.evaluate(() => document.getElementById('inb-host').children.length);
            await pg.evaluate(() => window.scrollTo(0, 0)); await pg.click('#desk-plus-btn'); await pg.waitForTimeout(300); await pg.click('#desk-sms-now'); await pg.waitForTimeout(1000);
            const f3 = await st();
            ok(f1.win && f1.hostCh === 'inquiry' && /주문문의\d*\*/.test(f1.tabs) && !f2.win && !f2.hist && f3.win && f3.tabs.split('|')[0].endsWith('*') && f3.cols && !f3.host, `[${name}] ⑦ 챙길 일 「주문문의」 알약 → 그 탭 · [닫기] 뒤 칸 정리(남은 칸 없음 · 톡톡·문의 칸 비움 ${un}) · 「문자」로 다시 열면 문자 탭`);
            // ⑧ 탭 키보드(→) · 야간 대비 · 끝
            if (!phone) { await pg.focus('#sms-tabs .sms-tab[data-ch="sms"]'); await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(700); const g = await st(); ok(g.hostCh === 'talk' && await pg.evaluate(() => (document.activeElement || {}).dataset && document.activeElement.dataset.ch) === 'talk', `[${name}] ⑧ 탭 줄 → 키로 다음 탭(톡톡) · 초점 따라감`); }
            if (theme) { const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js')); const a = await H.audit(pg, '#sms-tabs'); ok(a.fails.length === 0 && a.white.length === 0, `[${name}] 야간: 탭 줄 대비 미달 ${a.fails.length} · 흰 칸 ${a.white.length}(글자 ${a.texts}개 · 최소 ${a.minR}${a.fails.length ? ' · ' + a.fails.slice(0, 3).join(' / ') : ''})`); }
            await pg.evaluate(() => document.getElementById('sms-close').click()); await pg.waitForTimeout(600);
            const z = await st();
            ok(!z.win && !z.hist && z.over <= vw.width && errs.length === 0, `[${name}] 끝: 창 닫힘 · 남은 뒤로가기 칸 없음 · 가로 넘침 없음(${z.over}) · 화면 오류 ${errs.length}${errs.length ? ' ' + errs[0].slice(0, 160) : ''}`);
            await ctx.close();
        }
    } finally { await browser.close().catch(() => { }); s1.kill(); s2.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
