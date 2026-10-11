// #610-E · #635 에이전트 오피스 「문자」 카드 검증 — 가짜 서버(scripts/_mock-610.js · DB·외부 호출 0)에 실제 화면을 띄워 실클릭
//   사용: node scripts/verify-610-ui.js   (포트 PORT610 · 없으면 3461 · 다른 Playwright 검증과 동시에 돌리지 말 것)
//   #635(대표 10/11 「폰 문자함처럼」): 안 읽은 대화만 뜸 · 열면 배지 0 · 접으면 빠짐 · 또 오면 다시 뜸 · [이전 대화 보기] · 찾기 · 옛 서버 응답 폴백
//   PC · 폰 · PC 야간 · 폰 야간 × 목록 · 배지 · 펼침 · 사진 · 답 보내기 · 초안 보내기 · 끊김 · 챙길 일 · #633 봇 실패 · scrollWidth · 44px · Esc
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js'));
const PORT = Number(process.env.PORT610 || 3461), BASE = 'http://localhost:' + PORT;
const PC = { width: 1440, height: 900 }, PH = { width: 390, height: 844 };
const USER = { id: 8, name: '시험직원', position: '대리', role: 'user' };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const mock = async (p, body) => (await fetch(BASE + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const logOf = async () => (await mock('/__mock/log')).log;
const sumOf = async () => (await fetch(BASE + '/api/sms/summary', { headers: { Authorization: 'Bearer x' } })).json();

(async () => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-610.js'), String(PORT)], { stdio: ['ignore', 'ignore', 'inherit'] });
    let up = false; for (let i = 0; i < 40 && !up; i++) { await H.sleep(250); try { up = (await fetch(BASE + '/__mock/log')).ok; } catch (e) { /* 아직 */ } }
    if (!up) { srv.kill(); throw new Error('가짜 서버가 안 떴어요(포트 ' + PORT + ')'); }
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const open = async (vw, phone, theme, routes) => {
        const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
        const pg = await ctx.newPage(); const errors = [], toasts = [], sms = [];
        pg.on('pageerror', e => errors.push(String(e))); pg.on('dialog', d => d.dismiss().catch(() => { }));
        pg.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/sms/')) sms.push(r.method() + ' ' + u.pathname + u.search); });
        if (routes) await routes(pg);
        await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([u, th]) => { localStorage.setItem('jwt_token', 'mock.token.610'); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, [USER, theme]);
        await pg.exposeFunction('__toast', t => toasts.push(t));
        await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1800);
        await pg.evaluate(() => { const mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && /toast/i.test(n.className || '')) window.__toast(n.textContent.trim()); }))); mo.observe(document.body, { childList: true, subtree: true }); });
        return { pg, ctx, errors, toasts, sms };
    };
    const sw = pg => pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    // 돌아왔을 때처럼 바로 다시 받게 — 화면의 api() 는 같은 GET 이 잠깐 겹치면 한 번만 보내므로(#631·#637) 앞 요청과 1.4초 띄운 뒤 깨운다
    const wake = async pg => { await pg.waitForTimeout(1400); await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(900); };
    const rows = pg => pg.locator('#sms-list .sms-item').count();
    const ids = pg => pg.evaluate(() => Array.from(document.querySelectorAll('#sms-list .sms-item')).map(x => x.dataset.id).join(','));
    const chipIs = (pg, v) => pg.waitForFunction(x => { const n = document.getElementById('sms-chip-n'); return n && (x === '' ? n.hidden : (!n.hidden && n.textContent === x)); }, v, { timeout: 6000 }).then(() => true).catch(() => false);
    const rowsAre = (pg, n) => pg.waitForFunction(x => document.querySelectorAll('#sms-list .sms-item').length === x, n, { timeout: 6000 }).then(() => true).catch(() => false);
    const sheetDown = async pg => { if (await pg.evaluate(() => { const t = document.getElementById('sms-thread'); return !!t && getComputedStyle(t).position === 'fixed'; })) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(250); } };   // 폰은 대화가 화면을 덮으므로 먼저 접는다
    const openThread = async (pg, id) => { await sheetDown(pg);
        await pg.locator(`#sms-list .sms-item[data-id="${id}"] > .sms-row`).click({ timeout: 4000 }); await pg.waitForFunction(i => { const t = document.getElementById('sms-thread'); return t && t.dataset.id === String(i) && !document.querySelector('#sms-msgs .desk-empty'); }, id, { timeout: 5000 }).catch(() => { }); await pg.waitForTimeout(350); };
    const closeThread = async pg => { await pg.keyboard.press('Escape'); await pg.waitForTimeout(350); };
    const scopeBtn = async (pg, want) => { await sheetDown(pg); if ((await pg.getAttribute('#sms-scope', 'aria-pressed')) !== String(want)) { await pg.click('#sms-scope'); await pg.waitForTimeout(700); } };
    const box = async (pg, sel) => { const b = await pg.locator(sel).first().boundingBox(); return b ? { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) } : null; };
    const ctxGrant = async ctx => { try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }); } catch (e) { /* 권한 이름을 모르는 브라우저면 그대로 */ } };
    const unfold = async pg => { if (await pg.locator('#desk-board-fold').isVisible() && await pg.evaluate(() => document.getElementById('desk-board').classList.contains('folded'))) { await pg.evaluate(() => document.getElementById('desk-board-fold').click()); await pg.waitForTimeout(400); } };   // 문자 창이 떠 있으면 뒤 화면을 못 누르므로 스크립트로 펼친다(현황판 글만 읽는 용도)
    const rowOf = (pg, id) => pg.evaluate(i => { const li = document.querySelector('#sms-list .sms-item[data-id="' + i + '"]'); if (!li) return null; const q = s => li.querySelector('.sms-row ' + s), t = s => (q(s) || { textContent: '' }).textContent;
        return { tail: t('.sms-tail'), hint: t('.sms-hint'), un: t('.sms-un'), dun: li.dataset.un, badge: !!q('.desk-badge'), time: t('.sms-time'), last: t('.sms-last'), me: !!q('.sms-me'), pic: !!q('.sms-pic'), why: t('.sms-why'), tag: t('.sms-tag'), bold: li.classList.contains('unread') }; }, id);

    try {
        for (const [label, vw, phone, theme] of [['PC', PC, false, null], ['폰', PH, true, null], ['PC 야간', PC, false, 'dark'], ['폰 야간', PH, true, 'dark']]) {
            console.log('\n── ' + label);
            await mock('/__mock/reset', {});
            const P = await open(vw, phone, theme), pg = P.pg, T = P.toasts;
            const buyOf = () => pg.evaluate(() => { const el = document.getElementById('sms-order'), q = k => { const d = (el.querySelector('.sms-buy-i') || el).querySelector('dd[data-k="' + k + '"]'); return d ? d.textContent.replace(/\s+/g, ' ').trim() : null; }, i0 = el.querySelector('.sms-buy-i') || el, bs = Array.from(i0.querySelectorAll('.sms-trk')), as = Array.from(i0.querySelectorAll('.sms-trk-go')), h = el.querySelector('.sms-buy-h b'), hs = el.querySelector('.sms-buy-h small'), bd = i0.querySelector('.sms-buy-s .desk-badge'), more = document.getElementById('sms-buy-more');
                return { title: h ? h.textContent : '', badge: bd ? bd.textContent + '|' + bd.dataset.k : '', plan: q('plan'), ship: q('ship'), trk: q('trk'), who: q('who'), item: q('item'), paid: q('paid'), order: Array.from(i0.querySelectorAll('dd[data-k]')).map(d => d.dataset.k).join(','), none: el.classList.contains('none'), days: hs ? hs.textContent : '', n: el.querySelectorAll('.sms-buy-i').length, shown: Array.from(el.querySelectorAll('.sms-buy-i')).filter(x => x.getClientRects().length).length, more: more ? more.textContent + '|' + more.getAttribute('aria-expanded') + '|' + Math.round(more.getBoundingClientRect().height) : '', cap: !!el.querySelector('.sms-buy-cap'), text: el.textContent.replace(/\s+/g, ' ').trim(), nums: bs.map(b => b.textContent).join(','), hrefs: as.map(a => a.getAttribute('href') + '|' + a.target).join(','), h: bs.length ? Math.min(...bs.concat(as).map(x => Math.round(x.getBoundingClientRect().height))) : 0, over: el.scrollWidth > el.clientWidth + 1, keyFw: (el.querySelector('dd.key') ? Number(getComputedStyle(el.querySelector('dd.key')).fontWeight) : 0) }; });
            // ① 알약 · 새 폴링 없음
            const chipLabel = await pg.getAttribute('#desk-sms-now', 'aria-label');
            ok(await pg.locator('#desk-short-sms').isVisible() && (await pg.locator('#desk-short-sms').innerText()).replace(/\s+/g, '') === '문자7' && await pg.evaluate(() => !document.getElementById('desk-plus-n').hidden && document.getElementById('sms-chip-n').textContent === '7') && /안 읽은 대화 7건\(직원 확인 3 · 초안 1\)/.test(chipLabel || ''), `[${label}] #653-나 바로가기 「문자 7」 · [+] 에 점 · 메뉴 줄 숫자 7 = 안 읽은 대화 수(${chipLabel})`);
            const n0 = P.sms.length; await pg.waitForTimeout(3200);
            ok(P.sms.length === n0 && n0 <= 2, `[${label}] 카드를 안 열면 문자 요청은 요약뿐(처음 ${n0}회 · 3초 동안 추가 ${P.sms.length - n0}회)`);
            await plusGo(pg, '#desk-sms-now'); await pg.waitForTimeout(700);
            {   // #653 문자 = 화면을 덮는 전용 창(최종발주처럼)
                const w = await pg.evaluate(() => { const m = document.getElementById('desk-sms'), r = m.getBoundingClientRect(), cs = getComputedStyle(m), win = document.querySelector('.sms-win').getBoundingClientRect(); return { pos: cs.position, full: Math.round(r.width) === window.innerWidth && Math.round(r.height) === window.innerHeight, role: m.getAttribute('role'), lock: document.body.classList.contains('sms-win-open') && getComputedStyle(document.body).overflow === 'hidden', winW: Math.round(win.width), winH: Math.round(win.height), pane: !!document.querySelector('#sms-pane .sms-pane-empty'), hist: (history.state || {}).smsWin || '' }; });
                ok(w.pos === 'fixed' && w.full && w.role === 'dialog' && w.lock && w.hist === 'win' && (phone ? w.winW === vw.width && w.winH === vw.height : w.winW <= 1180 && w.winH <= vw.height - 40), `[${label}] #653 문자 창이 화면을 덮음(창 ${w.winW}×${w.winH} · 뒤 화면 스크롤 잠금 · 뒤로가기 칸 1)`);
                const cx = await box(pg, '#sms-close'), qx = await box(pg, '#sms-q'), sx = await box(pg, '#sms-scope');
                ok(cx && qx && sx && (!phone || (cx.h >= 44 && qx.h >= 44 && sx.h >= 44)), `[${label}] #653 창 머리 [닫기] ${cx && cx.h}px · 찾기 ${qx && qx.h}px · [이전 대화 보기] ${sx && sx.h}px`);
            }
            // ② 목록 = 안 읽은 대화만 · 숫자 칸·[처리함]·[끝내기] 없음
            ok(await rows(pg) === 7 && (await ids(pg)) === '12,11,7,6,3,2,1' && P.sms.some(x => /threads\?scope=active&q=&limit=50/.test(x)), `[${label}] 목록 = 안 읽은 대화 7줄 · 마지막 글 최신순(${await ids(pg)}) · 서버에 scope=active`);
            ok(await pg.evaluate(() => !document.querySelector('#sms-stat, #sms-all, #sms-done, #sms-handled, #sms-end, .sms-stat')) && (await pg.getAttribute('#sms-scope', 'aria-pressed')) === 'false' && (await pg.locator('#sms-count').innerText()) === '7건', `[${label}] 숫자 네 칸·[전체]·[끝난 대화도] 없음 · [이전 대화 보기] 꺼짐 · 「7건」`);
            ok((await pg.locator('#sms-mode').innerText()) === '초안', `[${label}] 모드 칩 「초안」`);
            ok(await sw(pg) <= vw.width, `[${label}] 목록 가로 넘침 없음(${await sw(pg)} ≤ ${vw.width})`);
            {   // #651 [직원 확인 n] · 무시 대화는 새 문자 목록·셈에 없음 · 「새 주문 n건 대기」 힌트
                const sb = await pg.evaluate(() => { const b = document.getElementById('sms-staff'); return { hid: b.hidden, n: document.getElementById('sms-staff-n').textContent, pressed: b.getAttribute('aria-pressed'), h: Math.round(b.getBoundingClientRect().height), ign: !!document.querySelector('.sms-item[data-id="13"]'), hint6: (document.querySelector('.sms-item[data-id="6"] .sms-hint') || {}).textContent }; });
                ok(!sb.hid && sb.n === '3' && sb.pressed === 'false' && (!phone || sb.h >= 44) && !sb.ign && /새 주문 1건 대기$/.test(sb.hint6 || ''), `[${label}] #651 [직원 확인 ${sb.n}] 단추(${sb.h}px) · 무시 대화는 새 문자 목록에 없음 · 힌트 「…${String(sb.hint6).slice(-10)}」`);
            }
            const r1 = await rowOf(pg, 1), r2 = await rowOf(pg, 2), r3 = await rowOf(pg, 3), r11 = await rowOf(pg, 11);
            ok(r1.tail === '010-1234-1234' && /효돈/.test(r1.hint) && r1.un === '3' && !r1.badge && r1.pic && r1.tag === '초안' && r1.bold && !r1.me && /터져서 왔어요/.test(r1.last) && /^\d\d:\d\d$|\d+\/\d+ \d\d:\d\d/.test(r1.time), `[${label}] 줄 = 전체 번호 · 손님 힌트 · 안 읽음 배지 3 · 시각 · 손님 마지막 글 · 사진 · 「초안」(상태 배지 없음 · ${JSON.stringify(r1)})`);
            ok(r2.hint === '주문을 찾지 못한 번호' && r2.why === 'AI 판단' && r2.un === '1' && r3.why === '불만·클레임' && r3.un === '2', `[${label}] 사람 몫이면 사유 알약(「${r2.why}」 · 「${r3.why}」) · 힌트 없는 번호 안내`);
            ok(r11.me && /^나: 확인하고 바로 연락드리겠습니다/.test(r11.last) && r11.why === '보내지 못함' && !r11.pic, `[${label}] 우리가 마지막이면 「나:」 머리(${r11.last.slice(0, 22)}) · 사유 「${r11.why}」`);
            {   // 배지 모양 · 사유 알약 대비(밝은 화면도)
                const g = await pg.evaluate(() => { const b = document.querySelector('#sms-list .sms-un'), w = document.querySelector('#sms-list .sms-why'), cs = e => getComputedStyle(e), r = b.getBoundingClientRect(); return { bh: Math.round(r.height), bw: Math.round(r.width), bfg: cs(b).color, bbg: cs(b).backgroundColor, wfg: cs(w).color, wbg: cs(w).backgroundColor }; });
                ok(g.bh >= 18 && g.bw >= 18 && g.bfg !== g.bbg && g.wfg !== g.wbg, `[${label}] 안 읽음 배지 ${g.bw}×${g.bh}(글 ${g.bfg} · 바탕 ${g.bbg}) · 사유 알약(글 ${g.wfg} · 바탕 ${g.wbg})`);
            }
            // ③ 이전 대화 보기
            await scopeBtn(pg, true);
            const a1 = await rowOf(pg, 4), a10 = await rowOf(pg, 10);
            ok(await rows(pg) === 13 && (await pg.getAttribute('#sms-scope', 'aria-pressed')) === 'true' && P.sms.some(x => /threads\?scope=all&q=&limit=50/.test(x)), `[${label}] [이전 대화 보기] → 13줄(읽은·끝난·무시 대화 포함) · 눌린 표시 · 서버에 scope=all`);
            ok(a1 && a1.un === '' && a1.dun === '0' && !a1.badge && !a1.bold && a1.me && a10 && a10.me, `[${label}] 읽은 대화는 배지 없음 · 굵지 않음 · 「나:」 머리(${JSON.stringify(a1)})`);
            await scopeBtn(pg, false);
            ok(await rows(pg) === 7 && (await pg.getAttribute('#sms-scope', 'aria-pressed')) === 'false', `[${label}] 다시 누르면 새 문자만(7줄)`);
            {   // #651 [직원 확인 n] = 읽었어도 사람 답이 필요한 대화만 · 보낸 글 상태(취소·보내는 중·전달 앱)
                await openThread(pg, 2); await closeThread(pg);   // 직원 몫 대화를 열어만 보고 접음 → 새 문자 목록에서는 빠진다
                await pg.click('#sms-staff'); await pg.waitForTimeout(900);
                const so = await pg.evaluate(() => ({ ids: Array.from(document.querySelectorAll('#sms-list .sms-item')).map(x => x.dataset.id).sort().join(','), why: document.querySelectorAll('#sms-list .sms-item .sms-why').length, cnt: document.getElementById('sms-count').textContent, pressed: document.getElementById('sms-staff').getAttribute('aria-pressed'), scope: document.getElementById('sms-scope').getAttribute('aria-pressed'), n: document.getElementById('sms-staff-n').textContent }));
                ok(so.ids === '11,2,3' && so.why === 3 && so.cnt === '직원 확인만 · 3건' && so.pressed === 'true' && so.scope === 'false' && so.n === '3', `[${label}] #651 열어 보고 접은 직원 몫 대화(5678)도 [직원 확인] 보기에는 남음(${JSON.stringify(so)})`);
                await pg.click('#sms-staff'); await pg.waitForTimeout(800);
                ok(await rows(pg) === 6 && (await pg.getAttribute('#sms-staff', 'aria-pressed')) === 'false' && !(await pg.locator('.sms-item[data-id="2"]').count()), `[${label}] #651 다시 누르면 새 문자만(6줄 · 열어 본 5678 은 빠져 있음)`);
                await scopeBtn(pg, true); await openThread(pg, 9);
                const ms = await pg.evaluate(() => Array.from(document.querySelectorAll('#sms-msgs .sms-msg.out')).map(m => { const b = m.querySelector('.sms-bub'), cs = getComputedStyle(b); return m.dataset.s + '|' + m.querySelector('small').textContent.replace(/\s+/g, ' ').trim().replace(/\d\d:\d\d|\d+\/\d+ /g, '').replace(/ · · /g, ' · ') + '|' + (/line-through/.test(cs.textDecorationLine || cs.textDecoration) ? '줄' : '') + (cs.borderTopStyle === 'dashed' ? '점선' : ''); }));
                ok(ms[0] === 'cancelled|봇 · · 안 보냄 · 직원이 먼저 답해서 취소|줄점선'.replace(' · · ', ' · ') || /^cancelled\|봇 · .*안 보냄 · 직원이 먼저 답해서 취소\|줄점선$/.test(ms[0]), `[${label}] #651 직원이 먼저 답해 취소된 봇 글 = 줄 긋기·점선 + 「안 보냄 · 직원이 먼저 답해서 취소」(${ms[0]})`);
                ok(/^cancelled\|봇 · .*안 보냄 · 시간이 지나 취소\|줄점선$/.test(ms[1]) && /^delivered\|직원\(오피스\) · .*전달됨\|$/.test(ms[2]) && /^sending\|직원\(오피스\) · .*보내는 중\|$/.test(ms[3]) && /^sending\|/.test(ms[4]) && ms.length === 5, `[${label}] #651 묵어서 취소 「${ms[1]}」 · 나간 글은 그대로 · 발송 중 조각 2개 「보내는 중」`);
                await closeThread(pg); await openThread(pg, 3);
                {   // #653 구매이력 여러 건 = 맨 위 1건 + [n건 더보기] → 같은 틀로 펼침 · 다시 누르면 접힘 · 폴링 뒤에도 펼친 채
                    const h1 = await buyOf();
                    await pg.click('#sms-buy-more'); await pg.waitForTimeout(250);
                    const h2 = await buyOf();
                    const rest = await pg.evaluate(() => Array.from(document.querySelectorAll('#sms-buy-rest .sms-buy-i')).map(i => (i.querySelector('.desk-badge') || {}).textContent + '|' + (i.querySelector('dd[data-k="ship"]') || {}).textContent + '|' + (i.querySelector('dd[data-k="who"]') || {}).textContent + '|' + i.querySelectorAll('.sms-trk').length + '|' + ((i.querySelector('.sms-buy-role') || {}).textContent || '')));
                    ok(h1.days === '최근 60일 · 3건' && h1.n === 3 && h1.shown === 1 && /^구매이력 2건 더보기\|false\|/.test(h1.more) && Number(h1.more.split('|')[2]) >= (phone ? 44 : 32) && h1.ship === '10/08 대성', `[${label}] #653 구매이력 3건 = 맨 위 1건(${h1.ship}) + [${h1.more.split('|')[0]}](${h1.more.split('|')[2]}px)`);
                    ok(h2.shown === 3 && /^구매이력 접기\|true\|/.test(h2.more) && h2.cap && rest[0] === '배송완료|09/22 효돈|홍길동|1|이 번호가 받는 건' && rest[1] === '배송 중 · 이동|08/30 길영|이순자|2|이 번호가 주문한 건', `[${label}] #653 더보기 → 나머지 2건이 같은 틀로(${rest.join(' / ')}) · 「20건까지」 안내`);
                    {   // #657 송장별 품목 줄 · 배지 글 = status_text · 송장 글자 크기 · 명암
                        const b7 = await pg.evaluate(() => { const it = document.querySelectorAll('#sms-buy-rest .sms-buy-i')[1], cs = (e, p) => getComputedStyle(e)[p]; const lis = Array.from(it.querySelectorAll('dd[data-k="boxes"] .sms-box-l li'));
                            const trk = document.querySelector('#sms-order .sms-trk'), dd = document.querySelector('#sms-order dd[data-k="who"]'), panel = document.getElementById('sms-order'), item = document.querySelector('#sms-order .sms-buy-i'), msgs = document.getElementById('sms-msgs');
                            return { rows: lis.map(li => li.querySelector('.sms-trk').textContent + '|' + (li.querySelector('.sms-trk-go') ? '조회' : '') + '|' + li.querySelector('.sms-box-it').textContent + '|' + li.querySelector('.desk-badge').textContent + ':' + li.querySelector('.desk-badge').dataset.k), trkRow: !!it.querySelector('dd[data-k="trk"]'), itemRow: !!it.querySelector('dd[data-k="item"]'), head: it.querySelector('.sms-buy-s .desk-badge').textContent + ':' + it.querySelector('.sms-buy-s .desk-badge').dataset.k,
                                trkFs: parseFloat(cs(trk, 'fontSize')), trkFw: cs(trk, 'fontWeight'), ddFs: parseFloat(cs(dd, 'fontSize')), trkH: Math.round(trk.getBoundingClientRect().height), goH: Math.round(document.querySelector('#sms-order .sms-trk-go').getBoundingClientRect().height), panelBg: cs(panel, 'backgroundColor'), itemBg: cs(item, 'backgroundColor'), itemBd: cs(item, 'borderTopWidth'), msgBg: msgs ? cs(msgs, 'backgroundColor') : '', hFs: parseFloat(cs(panel.querySelector('.sms-buy-h b'), 'fontSize')) }; });
                        ok(b7.rows.length === 2 && b7.rows[0] === '590123450002|조회|미니밤호박 특품 5kg|배송완료:done' && b7.rows[1] === '590123450003|조회|미니밤호박 보우짱 3kg|배송 중 · 집화 전:work' && !b7.trkRow && !b7.itemRow && b7.head === '배송 중 · 이동:work', `[${label}] #657 상자 2개 = 송장마다 한 줄 「[송장][조회] 품목 · 상태」(${b7.rows.join(' / ')}) · 따로 있던 송장·품목 줄 없음 · 배지 글 = status_text(${b7.head})`);
                        ok(b7.trkFs <= b7.ddFs + 0.6 && Number(b7.trkFw) <= 600 && (phone ? b7.trkH >= 44 && b7.goH >= 44 : b7.trkH <= 32), `[${label}] #657 송장 글자 = 값 글자 크기(${b7.trkFs}px ≤ 값 ${b7.ddFs}px · 굵기 ${b7.trkFw}) · 누르는 높이 ${b7.trkH}px${phone ? '(폰 44 유지)' : ''}`);
                        ok(b7.panelBg !== b7.itemBg && b7.panelBg !== 'rgba(0, 0, 0, 0)' && b7.itemBd === '1px' && b7.hFs >= 14, `[${label}] #657 명암: 구매이력 판(${b7.panelBg}) 위에 건별 칸(${b7.itemBg} · 테두리 1px) · 머리 글자 ${b7.hFs}px`);
                        await mock('/__mock/set', { many: true }); await closeThread(pg); await openThread(pg, 3);
                        const m0 = await buyOf();
                        await pg.click('#sms-buy-more'); await pg.waitForTimeout(250);
                        const mm = () => pg.evaluate(() => { const nx = document.getElementById('sms-buy-next'), box = document.getElementById('sms-order'), pane = document.getElementById('sms-pane'); return { shown: document.querySelectorAll('#sms-buy-rest .sms-buy-i').length, next: nx ? nx.textContent.replace(/\s+/g, ' ').trim() + '|' + Math.round(nx.getBoundingClientRect().height) : '', focus: (document.activeElement || {}).id, cap: (document.querySelector('#sms-buy-rest .sms-buy-cap') || {}).textContent || '', ratio: +(box.getBoundingClientRect().height / ((document.querySelector('#sms-pane .sms-thread') || pane).getBoundingClientRect().height || 1)).toFixed(2), scroll: box.scrollHeight > box.clientHeight + 2 }; });
                        const m1 = await mm(); await pg.click('#sms-buy-next'); await pg.waitForTimeout(250);
                        const m2 = await mm(); await pg.click('#sms-buy-next'); await pg.waitForTimeout(250);
                        const m3 = await mm(); await wake(pg); const m4 = await mm();
                        ok(m0.days === '최근 60일 · 12건' && /^구매이력 11건 더보기\|false/.test(m0.more) && m1.shown === 5 && /^5건 더보기 남은 6건\|/.test(m1.next) && Number(m1.next.split('|')[1]) >= (phone ? 44 : 32) && m2.shown === 10 && /^1건 더보기 남은 1건\|/.test(m2.next) && m2.focus === 'sms-buy-next' && m3.shown === 11 && m3.next === '' && m4.shown === 11, `[${label}] #657 12건 손님: 맨 위 1건 + [11건 더보기] → 5건(${m1.next.split('|')[0]}) → 10건 → 11건 전부(단추 없음) · 다시 받아도 펼친 채(${m4.shown})`);
                        ok(m3.ratio <= 0.5 && m3.scroll && await sw(pg) <= vw.width, `[${label}] #657 전부 펼쳐도 구매이력은 대화 칸의 절반 이하(${m3.ratio}) · 넘치는 건 카드 안에서 스크롤 · 가로 넘침 없음`);
                        await pg.click('#sms-buy-more'); await pg.waitForTimeout(250); await pg.click('#sms-buy-more'); await pg.waitForTimeout(250);
                        const m5 = await mm(); ok(m5.shown === 5, `[${label}] #657 접었다 다시 펴면 5건부터(${m5.shown})`);
                        if (theme) { const a = await H.audit(pg, '#sms-order'); ok(a.fails.length === 0 && a.white.length === 0, `[${label}] #657 야간: 구매이력 카드 대비 미달 ${a.fails.length} · 흰 칸 ${a.white.length}(글자 ${a.texts}개 · 최소 ${a.minR}${a.fails.length ? ' · ' + a.fails.slice(0, 3).join(' / ') : ''})`); }
                        await mock('/__mock/set', { many: false }); await closeThread(pg); await openThread(pg, 3); await pg.click('#sms-buy-more'); await pg.waitForTimeout(250);
                    }
                    await wake(pg); const h3 = await buyOf();
                    await pg.click('#sms-buy-more'); await pg.waitForTimeout(250); const h4 = await buyOf();
                    ok(h3.shown === 3 && h4.shown === 1 && /더보기\|false/.test(h4.more) && await sw(pg) <= vw.width, `[${label}] #653 다시 받아도 펼친 채 · 다시 누르면 접힘 · 가로 넘침 없음`);
                    await mock('/__mock/set', { history: false }); await closeThread(pg); await openThread(pg, 3);
                    const h5 = await buyOf();
                    ok(h5.days === '최근 14일' && h5.n === 1 && !h5.more && h5.ship === '10/08 대성', `[${label}] #653 history 가 없는 옛 서버 = 종전 1건(「${h5.days}」 · 더보기 없음)`);
                    await mock('/__mock/set', { history: true });
                }
                await closeThread(pg); await openThread(pg, 8);
                const gw = await pg.evaluate(() => (Array.from(document.querySelectorAll('#sms-msgs .sms-msg.out small')).pop() || {}).textContent);
                ok(/^전달 앱 · /.test(gw || ''), `[${label}] #651 실서버 발신 표시 gateway_other = 「전달 앱」(${gw})`);
                await closeThread(pg); await scopeBtn(pg, false);
                await mock('/__mock/reset', {}); await wake(pg); await rowsAre(pg, 7);
            }
            // ④ 찾기 = 이전 대화까지 전체에서 · 0.4초 멈춤 · Enter 는 바로
            await pg.fill('#sms-q', '7007'); await pg.waitForTimeout(900);
            ok(await rows(pg) === 1 && P.sms.some(x => /threads\?scope=active&q=7007/.test(x)), `[${label}] 찾기 「7007」(끝 4자리) → 1줄`);
            await pg.fill('#sms-q', '냉장'); const qn = P.sms.length; await pg.keyboard.press('Enter'); await pg.waitForTimeout(350);
            const q5 = await rowOf(pg, 5);
            ok(P.sms.length >= qn + 1 && await rows(pg) === 1 && q5 && q5.dun === '0', `[${label}] Enter 는 기다리지 않고 바로 찾음 · 읽은 대화(9090)도 찾힘 = 전체에서`);
            await pg.fill('#sms-q', '010-1234-7007'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(400);
            const qf = await ids(pg);
            await pg.fill('#sms-q', '12347'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(400);
            ok(qf === '11' && await rows(pg) === 0 && /전체 번호/.test(await pg.getAttribute('#sms-q', 'placeholder')), `[${label}] 전체 번호로 찾기 → 그 대화 1줄(${qf}) · 번호 일부(5자리)는 0건 · 칸 안내 「${await pg.getAttribute('#sms-q', 'placeholder')}」`);
            await pg.fill('#sms-q', '없는글자zz'); await pg.waitForTimeout(900);
            ok(/찾은 문자가 없어요/.test(await pg.locator('#sms-list').innerText()), `[${label}] 찾은 것 없음 안내`);
            await pg.fill('#sms-q', ''); await pg.waitForTimeout(900);
            ok(await rows(pg) === 7, `[${label}] 찾기 지우면 새 문자 7줄`);
            // ⑤ 펼침 = 읽음 · 주문 · 사진 · 초안
            const g0 = P.sms.length;
            await openThread(pg, 1);
            const th = await pg.evaluate(() => ({ bub: document.querySelectorAll('#sms-msgs .sms-bub').length, order: document.getElementById('sms-order').textContent, ta: document.getElementById('sms-text').value, btn: document.getElementById('sms-send').textContent, dis: document.getElementById('sms-send').disabled, draft: !document.getElementById('sms-draft').hidden, exp: document.querySelector('.sms-item[data-id="1"] .sms-row').getAttribute('aria-expanded'), btns: Array.from(document.querySelectorAll('#sms-reply button')).map(b => b.textContent).join('|') }));
            await pg.waitForFunction(() => Array.from(document.querySelectorAll('#sms-msgs .sms-thumb img')).every(i => i.naturalWidth > 0), null, { timeout: 4000 }).catch(() => { });
            const loaded = await pg.evaluate(() => Array.from(document.querySelectorAll('#sms-msgs .sms-thumb img')).map(i => i.naturalWidth > 0));
            ok(th.bub === 2 && loaded.length === 2 && loaded.every(Boolean) && th.exp === 'true', `[${label}] 대화 펼침 · 말풍선 2 · 사진 썸네일 2장 실제로 뜸(${JSON.stringify(loaded)})`);
            const od = await buyOf();
            ok(od.title === '구매이력' && od.badge === '배송완료|done' && od.ship === '10/09 효돈' && od.who === '홍길동' && od.item === '하우스감귤 가정용 - 4kg(로얄과)' && od.nums === '590123454821' && od.order === 'ship,trk,who,item' && od.keyFw >= 800 && !od.none && od.days === '최근 60일' && od.n === 1 && !od.more, `[${label}] #653 「구매이력」 카드 = 상태 배지 「${od.badge}」 · 발송일 ${od.ship}(굵게) · 송장 전체 · 받는 분 ${od.who} · 품목(순서 ${od.order})`);
            ok(od.hrefs === '/track?n=590123454821|_blank' && od.h >= (phone ? 44 : 32), `[${label}] #644 번호 옆 [조회] = 우리 배송조회 새 창(${od.hrefs}) · 누름 높이 ${od.h}px`);
            await ctxGrant(P.ctx); await pg.click('#sms-order .sms-trk'); await pg.waitForTimeout(400);
            const clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => '(읽기 막힘)'));
            ok(clip === '590123454821' && T.some(t => /송장번호를 복사했어요/.test(t)), `[${label}] #644 번호를 누르면 복사(클립보드 「${clip}」 · 안내 띠)`);
            await mock('/__mock/set', { trk: false }); await wake(pg);
            await pg.waitForFunction(() => !document.querySelector('#sms-order .sms-trk'), null, { timeout: 12000 }).catch(() => { });
            const odOld = await pg.evaluate(() => document.getElementById('sms-order').textContent.replace(/\s+/g, ' ').trim());
            { const o2 = await buyOf(); ok(o2.days === '최근 14일' && o2.who === '홍**' && o2.trk === '끝 4821' && o2.badge === '배송완료|done' && !(await pg.locator('#sms-order .sms-trk').count()), `[${label}] #644 옛 응답(이름 전체·trackings 없음) = 종전 order 로 물러남(「${o2.days}」) · 받는 분 「${o2.who}」 · 송장 「${o2.trk}」`); }
            await mock('/__mock/set', { trk: true }); await wake(pg);
            await pg.waitForFunction(() => !!document.querySelector('#sms-order .sms-trk'), null, { timeout: 12000 }).catch(() => { });
            ok(/^부패과가 나왔군요/.test(th.ta) && th.btn === '이대로 보내기' && !th.dis && th.draft && th.btns === '이대로 보내기', `[${label}] 봇 초안이 답 칸에 미리 · 버튼은 「${th.btns}」 하나([처리함]·[대화 끝내기] 없음)`);
            const o1 = await rowOf(pg, 1);
            ok(o1.un === '' && o1.dun === '0' && !o1.bold && await rows(pg) === 7, `[${label}] 열면 그 줄 배지 0 · 열어 둔 동안은 목록에 그대로(7줄)`);
            ok(await chipIs(pg, '6') && P.sms.slice(g0).some(x => x === 'GET /api/sms/threads/1'), `[${label}] 알약 숫자 7 → 6 · 대화는 peek 없이 읽음(읽음 처리)`);
            ok(await sw(pg) <= vw.width, `[${label}] 펼친 뒤 가로 넘침 없음(${await sw(pg)})`);
            {   // #624: 목록 줄 = 전체 번호 글자 · 대화 머리 = 누르면 전화(tel:) · phone_full 없는 옛 응답이면 종전 가림 글
                const ph = () => pg.evaluate(() => { const li = document.querySelector('#sms-list .sms-item[data-id="1"]'), t = li.querySelector('.sms-tail'), h = document.getElementById('sms-th-phone'), a = h && h.querySelector('a.sms-tel'), r = a ? a.getBoundingClientRect() : null;
                    return { tail: t.textContent, tailLink: !!t.querySelector('a') || !!t.closest('a'), head: h ? h.textContent : '', href: a ? a.getAttribute('href') : '', h: r ? Math.round(r.height) : 0, label: (document.getElementById('sms-thread') || { getAttribute() { return ''; } }).getAttribute('aria-label') || '', all: Array.from(document.querySelectorAll('#sms-list .sms-tail')).map(x => x.textContent) }; });
                const p1 = await ph();
                ok(p1.tail === '010-1234-1234' && !p1.tailLink && p1.all.length === 7 && p1.all.every(t => /^010-1234-\d{4}$/.test(t)), `[${label}] #624 목록 줄 = 전체 번호(글자만 · ${p1.all.length}줄 전부)`);
                ok(p1.head === '010-1234-1234' && p1.href === 'tel:01012341234' && p1.h >= 44 && /끝 1234/.test(p1.label), `[${label}] #624 대화 머리 번호 = 누르면 전화(href ${p1.href} · ${p1.h}px)`);
                await mock('/__mock/set', { full: false }); await wake(pg);
                await pg.waitForFunction(() => { const t = document.querySelector('#sms-list .sms-item[data-id="1"] .sms-tail'), h = document.getElementById('sms-th-phone'); return t && t.textContent === '끝 1234' && h && !h.querySelector('a'); }, null, { timeout: 15000 }).catch(() => { });
                const p2 = await ph();
                ok(p2.tail === '끝 1234' && p2.head === '010****1234' && !p2.href, `[${label}] #624 phone_full 없는 응답 = 종전 글(줄 「끝 1234」 · 머리 가림 번호)`);
                await mock('/__mock/set', { full: true }); await wake(pg);
                await pg.waitForFunction(() => { const h = document.getElementById('sms-th-phone'); return h && !!h.querySelector('a.sms-tel'); }, null, { timeout: 15000 }).catch(() => { });
            }
            ok(await rows(pg) === 7 && !!(await pg.locator('#sms-thread').count()) && (await rowOf(pg, 1)).dun === '0', `[${label}] 목록을 뒤에서 다시 받아도(서버의 새 문자 목록엔 이제 없음) 열어 둔 대화는 제자리에 그대로`);
            if (phone) {
                const g = await pg.evaluate(() => { const t = document.getElementById('sms-thread').getBoundingClientRect(), b = document.getElementById('sms-th-back'), cs = getComputedStyle(document.getElementById('sms-thread')); const br = b.getBoundingClientRect(); return { pos: cs.position, bottom: Math.round(window.innerHeight - t.bottom), left: Math.round(t.left), w: Math.round(t.width), top: Math.round(t.top), back: getComputedStyle(b).display !== 'none', bh: Math.round(br.height), x: getComputedStyle(document.getElementById('sms-th-x')).display }; });
                ok(g.pos === 'fixed' && g.bottom === 0 && g.left === 0 && g.w === vw.width && g.top === 0 && g.back && g.bh >= 44 && g.x === 'none', `[${label}] #653 폰은 대화가 화면 전체를 덮음 · 머리에 [목록](${g.bh}px · × 대신)(${JSON.stringify(g)})`);
                const small = [];
                for (const s of ['#sms-th-back', '#sms-send']) { const b = await box(pg, s); if (!b || b.h < 44) small.push(s + ' ' + JSON.stringify(b)); }
                const rh = await pg.evaluate(() => Math.min(...Array.from(document.querySelectorAll('#sms-list .sms-row')).map(e => e.getBoundingClientRect().height)));
                ok(!small.length && rh >= 44, `[${label}] 터치 요소 44px 이상(미달 ${small.join(' / ') || '없음'} · 줄 최소 ${Math.round(rh)})`);
            } else {
                const g = await pg.evaluate(() => { const r = e => e.getBoundingClientRect(), l = r(document.querySelector('.sms-left')), t = r(document.getElementById('sms-thread')), w = r(document.querySelector('.sms-win')); return { pos: getComputedStyle(document.getElementById('sms-thread')).position, side: Math.round(t.left) >= Math.round(l.right) - 1, sameTop: Math.abs(t.top - l.top) < 2, listW: Math.round(l.width), paneW: Math.round(t.width), winH: Math.round(w.height), back: getComputedStyle(document.getElementById('sms-th-back')).display, inWin: t.bottom <= w.bottom + 1 }; });
                ok(g.pos !== 'fixed' && g.side && g.sameTop && g.listW >= 300 && g.paneW > g.listW && g.back === 'none' && g.inWin, `[${label}] #653 PC 는 왼쪽 목록(${g.listW}px) + 오른쪽 대화(${g.paneW}px) 2단 · 창 안에 들어감(${JSON.stringify(g)})`);
                const x = await box(pg, '#sms-th-x'); ok(x && x.w >= 44 && x.h >= 44, `[${label}] 접기 × ${x ? x.w + 'x' + x.h : '?'}`);
            }
            if (theme) { const a = await H.audit(pg, '#desk-sms'); ok(a.dark === 'dark' && a.fails.length === 0 && a.white.length === 0, `[${label}] 야간 대비 미달 0 · 흰 칸 0(글자 ${a.texts}개 · 최소 ${a.minR}${a.fails.length ? ' · ' + a.fails.slice(0, 4).join(' / ') : ''}${a.white.length ? ' · 흰 칸 ' + a.white.slice(0, 3).join(' / ') : ''})`); }
            // ⑥ 사진 크게 보기 · Esc 순서
            await pg.locator('#sms-msgs .sms-thumb').first().click(); await pg.waitForTimeout(500);
            const v1 = await pg.evaluate(() => ({ open: !document.getElementById('sms-view').hidden, img: document.getElementById('sms-view-img').naturalWidth > 0 }));
            const vx = await box(pg, '#sms-view-x');
            ok(v1.open && v1.img && vx && vx.h >= 44, `[${label}] 썸네일 누름 → 크게 보기(사진 뜸 ${v1.img} · [닫기] 높이 ${vx ? vx.h : '?'})`);
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
            ok(await pg.evaluate(() => document.getElementById('sms-view').hidden && !!document.getElementById('sms-thread')), `[${label}] Esc 첫 번 = 사진만 닫힘(대화는 그대로)`);
            await pg.locator('#sms-msgs .sms-thumb').first().click(); await pg.waitForTimeout(300);
            await pg.mouse.click(8, vw.height - 8); await pg.waitForTimeout(300);
            ok(await pg.evaluate(() => document.getElementById('sms-view').hidden && !!document.getElementById('sms-thread')), `[${label}] 사진 바깥 누름 → 사진만 닫힘`);
            {   // #653 뒤로가기: 대화 → 목록 → 창 닫힘(페이지는 그대로) · 적던 글 보존
                await pg.fill('#sms-text', '뒤로가기 전에 적던 글'); await pg.waitForTimeout(100);
                const h0 = await pg.evaluate(() => ({ st: (history.state || {}).smsWin || '', len: history.length }));
                await pg.goBack().catch(() => { }); await pg.waitForTimeout(450);
                const b1 = await pg.evaluate(() => ({ th: !!document.getElementById('sms-thread'), win: !document.getElementById('desk-sms').hidden && document.body.classList.contains('sms-win-open'), page: document.getElementById('page-agent-office').classList.contains('active'), st: (history.state || {}).smsWin || '' }));
                ok(h0.st === 'th' && !b1.th && b1.win && b1.page && b1.st === 'win', `[${label}] #653 뒤로가기 1번 = 대화만 닫히고 목록으로(창은 그대로 · ${JSON.stringify(b1)})`);
                await scopeBtn(pg, true); await openThread(pg, 1);
                ok((await pg.locator('#sms-text').inputValue()) === '뒤로가기 전에 적던 글', `[${label}] #653 뒤로가기로 닫아도 적던 글은 그대로`);
                await pg.fill('#sms-text', ''); await pg.goBack().catch(() => { }); await pg.waitForTimeout(450);
                await pg.goBack().catch(() => { }); await pg.waitForTimeout(450);
                const b2 = await pg.evaluate(() => ({ win: !document.getElementById('desk-sms').hidden, lock: document.body.classList.contains('sms-win-open'), page: document.getElementById('page-agent-office').classList.contains('active'), url: location.pathname, st: (history.state || {}).smsWin || '' }));
                ok(!b2.win && !b2.lock && b2.page && b2.url === '/' && !b2.st, `[${label}] #653 뒤로가기 2번 더 = 목록 → 창 닫힘 · 페이지는 에이전트 오피스 그대로(${JSON.stringify(b2)})`);
                // Esc 도 같은 순서 · 화면에서 닫으면 뒤로가기 칸도 정리(남은 칸 없이)
                await plusGo(pg, '#desk-sms-now'); await pg.waitForTimeout(700); await openThread(pg, 4);
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(350);
                const e1 = await pg.evaluate(() => ({ th: !!document.getElementById('sms-thread'), win: !document.getElementById('desk-sms').hidden, st: (history.state || {}).smsWin || '' }));
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(450);
                const e2 = await pg.evaluate(() => ({ win: !document.getElementById('desk-sms').hidden, lock: document.body.classList.contains('sms-win-open'), st: (history.state || {}).smsWin || '', focus: (document.activeElement || {}).id || '' }));
                ok(!e1.th && e1.win && e1.st === 'win' && !e2.win && !e2.lock && !e2.st && e2.focus === 'desk-short-sms', `[${label}] #653 Esc 1번 = 대화 · 2번 = 창 닫힘(뒤로가기 칸 남지 않음 · 초점은 [문자] 바로가기)`);
                await mock('/__mock/reset', {});   // 다음 단계(⑦)가 기대하는 처음 상태로: 1234 대화를 안 읽음에서 다시 연다
                await plusGo(pg, '#desk-sms-now'); await pg.waitForTimeout(700); await scopeBtn(pg, false); await wake(pg); await rowsAre(pg, 7); await openThread(pg, 1);
            }
            {   // #655 쓰는 중 폴링(대화 5초 · 목록 10초)이 지나가도 답 칸 위치·초점·값·스크롤, 말풍선·목록 줄이 그대로(다시 만들지 않음)
                await pg.fill('#sms-text', ''); await pg.focus('#sms-text');
                await pg.evaluate(() => { const ta = document.getElementById('sms-text'), box = document.getElementById('sms-msgs'), list = document.getElementById('sms-list'); window.__w = { ta, msg: box.firstElementChild, row: list.querySelector('.sms-item'), top0: Math.round(ta.getBoundingClientRect().top), st0: box.scrollTop, mut: 0, blur: 0, tops: new Set() };
                    window.__w.mo = new MutationObserver(ms => { window.__w.mut += ms.filter(m => m.type === 'childList' && (m.target === box || m.target === list)).length; }); window.__w.mo.observe(box, { childList: true }); window.__w.mo.observe(list, { childList: true });
                    ta.addEventListener('blur', () => { window.__w.blur++; }); window.__w.iv = setInterval(() => window.__w.tops.add(Math.round(ta.getBoundingClientRect().top)), 100); });
                const req0 = P.sms.filter(x => /threads\/1(\?|$)/.test(x)).length;
                for (const ch of '폴링이 지나가도 그대로') { await pg.keyboard.type(ch); await pg.waitForTimeout(550); }   // 약 7초 동안 한 글자씩
                await wake(pg);   // 목록·대화를 한 번 더 강제로 다시 받게
                const w = await pg.evaluate(() => { const o = window.__w; clearInterval(o.iv); o.mo.disconnect(); const ta = document.getElementById('sms-text'), box = document.getElementById('sms-msgs'), list = document.getElementById('sms-list'); return { sameTa: ta === o.ta && ta.isConnected, focus: document.activeElement === ta, val: ta.value, sameMsg: box.firstElementChild === o.msg, sameRow: list.querySelector('.sms-item') === o.row, mut: o.mut, blur: o.blur, tops: o.tops.size, st: box.scrollTop === o.st0 }; });
                const polls = P.sms.filter(x => /threads\/1(\?|$)/.test(x)).length - req0;
                ok(polls >= 2 && w.sameTa && w.focus && w.val === '폴링이 지나가도 그대로' && w.blur === 0 && w.tops === 1 && w.st, `[${label}] #655 쓰는 동안 대화를 ${polls}번 다시 받아도 답 칸 그대로(초점 유지 · 글 온전 · 초점 빠짐 ${w.blur} · 위치 변화 ${w.tops - 1} · 스크롤 그대로)`);
                ok(w.sameMsg && w.sameRow && w.mut === 0, `[${label}] #655 바뀐 것이 없으면 말풍선·목록을 다시 만들지 않음(다시 그린 횟수 ${w.mut})`);
                await pg.fill('#sms-text', '');
            }
            // ⑦ 접으면 목록에서 빠짐 · 이전 대화 보기엔 남음
            await closeThread(pg);
            const foc = await pg.evaluate(() => { const a = document.activeElement; return a ? (a.className || a.id || a.tagName) : ''; });
            ok(!(await pg.locator('#sms-thread').count()) && await rows(pg) === 6 && !(await pg.locator('.sms-item[data-id="1"]').count()) && (await pg.locator('#sms-count').innerText()) === '6건' && await pg.locator('#desk-sms').isVisible(), `[${label}] Esc 로 접으면 대화만 접히고(카드는 그대로) 그 줄이 목록에서 빠짐(6줄 · 초점 → ${String(foc).slice(0, 24)})`);
            ok(/sms-row/.test(String(foc)), `[${label}] 접은 뒤 초점은 남은 줄로`);
            await scopeBtn(pg, true);
            const k1 = await rowOf(pg, 1);
            ok(k1 && k1.dun === '0' && k1.tag === '초안', `[${label}] 이전 대화 보기에는 그대로 있음(배지 0 · 「초안」 표시 유지)`);
            await scopeBtn(pg, false);
            // ⑧ 손님이 또 보내면 다시 뜸
            await mock('/__mock/push', { id: 1, body: '답이 없으셔서 다시 보냅니다' }); await wake(pg);
            ok(await rowsAre(pg, 7) && await chipIs(pg, '7'), `[${label}] 손님이 또 보내면 그 대화가 다시 뜸(7줄 · 알약 7)`);
            const b1 = await rowOf(pg, 1);
            ok(b1 && b1.un === '1' && /다시 보냅니다/.test(b1.last) && (await ids(pg)).split(',')[0] === '1', `[${label}] 새 글만 안 읽음 1 · 맨 위로(${await ids(pg)})`);
            // ⑨ 초안 그대로 보내기
            await openThread(pg, 1);
            ok(await pg.evaluate(() => document.querySelectorAll('#sms-msgs .sms-bub').length === 3), `[${label}] 다시 열면 이전 대화와 함께 보임(말풍선 3)`);
            await pg.click('#sms-send'); await pg.waitForTimeout(1300);
            let log = await logOf();
            const d1 = await pg.evaluate(() => ({ last: (Array.from(document.querySelectorAll('#sms-msgs .sms-msg.out small')).pop() || {}).textContent, ta: document.getElementById('sms-text').value, badge: document.getElementById('sms-th-badge').textContent, draft: document.getElementById('sms-draft').hidden, tag: !!document.querySelector('.sms-item[data-id="1"] .sms-tag') }));
            ok(log.length === 1 && log[0].action === 'send-draft' && log[0].id === 1, `[${label}] [이대로 보내기] → 가짜 서버에 send-draft 1건 도착(${JSON.stringify(log.map(l => l.action + ':' + l.id))})`);
            ok(/직원\(오피스\)/.test(d1.last || '') && /보내는 중/.test(d1.last || '') && d1.ta === '' && d1.badge === '직원 답변' && d1.draft && T.some(t => /답을 보냈어요/.test(t)), `[${label}] 보낸 답이 대화에 「${d1.last}」 · 답 칸 비움 · 머리 「${d1.badge}」 · 초안 안내 사라짐 · 안내 띠`);
            ok(await rows(pg) === 7 && !!(await pg.locator('#sms-thread').count()), `[${label}] 보낸 뒤에도 열어 둔 동안은 그대로`);
            await closeThread(pg);
            ok(await rowsAre(pg, 6) && !(await pg.locator('.sms-item[data-id="1"]').count()) && await chipIs(pg, '6'), `[${label}] 접으면 빠짐(6줄 · 알약 6)`);
            // ⑩ 직접 적어 보내기 (사람 몫 대화)
            await openThread(pg, 2);
            ok(await pg.evaluate(() => document.getElementById('sms-send').disabled && document.getElementById('sms-send').textContent === '답 보내기' && document.getElementById('sms-draft').hidden && document.getElementById('sms-text').value === '' && document.getElementById('sms-th-badge').textContent === 'AI 판단'), `[${label}] 초안 없는 사람 몫 대화 = 머리에 사유 「AI 판단」 · 빈 답 칸 · [답 보내기] 꺼짐`);
            { const o0 = await buyOf(); ok(o0.none && /^구매이력 없음 이 번호로 찾은 최근 60일 주문이 없어요$/.test(o0.text) && !o0.title, `[${label}] #653 주문 없는 번호 = 흐린 한 줄 「${o0.text}」`); }
            await pg.fill('#sms-text', '네, 50박스 가능합니다. 담당자가 오늘 중으로 연락드릴게요.'); await pg.waitForTimeout(150);
            if (phone) await pg.click('#sms-send'); else { await pg.focus('#sms-text'); await pg.keyboard.press('Control+Enter'); }
            await pg.waitForTimeout(1300);
            log = await logOf();
            const l2 = log[log.length - 1] || {};
            ok(log.length === 2 && l2.action === 'reply' && l2.id === 2 && /50박스 가능합니다/.test((l2.body || {}).text || ''), `[${label}] ${phone ? '[답 보내기]' : 'Ctrl+Enter'} → reply { text } 도착(${l2.action}:${l2.id} 「${String((l2.body || {}).text || '').slice(0, 16)}」)`);
            const d2 = await pg.evaluate(() => ({ badge: document.getElementById('sms-th-badge').textContent, who: (Array.from(document.querySelectorAll('#sms-msgs .sms-msg.out small')).pop() || {}).textContent, why: !!document.querySelector('.sms-item[data-id="2"] .sms-why') }));
            ok(d2.badge === '직원 답변' && /직원\(오피스\)/.test(d2.who || '') && !d2.why, `[${label}] 답 뒤 머리 「${d2.badge}」 · 보낸 사람 「${d2.who}」 · 사유 알약 사라짐`);
            await closeThread(pg);
            ok(await rowsAre(pg, 5) && await chipIs(pg, '5'), `[${label}] 접으면 빠짐(5줄 · 알약 5)`);
            ok((await logOf()).every(l => l.action === 'send-draft' || l.action === 'reply'), `[${label}] 여기까지 서버에 간 쓰기 = 보내기뿐(handled·close 0)`);
            // ⑪ 못 나간 답 표시 · 적던 글 지키기 · 보내기 실패
            await scopeBtn(pg, true);
            await openThread(pg, 11);
            {   // #644 상자가 둘이면 번호 둘 다 · 폰 폭에서도 가로 넘침 없음
                const two = await buyOf();
                ok(two.who === '김영희' && /× 2 · 2상자$/.test(two.item) && two.nums === '590123453306,590123453307' && !two.over && await sw(pg) <= vw.width, `[${label}] #644 받는 분 이름 전체(${two.who}) · 품목 「…${String(two.item).slice(-9)}」 · 상자 2개 = 전체 번호 둘 다(${two.nums}) · 가로 넘침 없음(${await sw(pg)})`);
            }
            const fl = await pg.evaluate(() => { const m = document.querySelector('#sms-msgs .sms-msg[data-s="failed"]'); return (m ? m.querySelector('small').textContent : '') + '|' + document.getElementById('sms-th-badge').textContent; });
            ok(/보내지 못함.*\|보내지 못함/.test(fl) && !/SEND_SMS|uid/.test(fl), `[${label}] 못 나간 답 표시 · 머리 사유 · 기술 오류 글은 안 보임(${fl})`);
            await pg.fill('#sms-text', '적다 만 글'); await openThread(pg, 4); await openThread(pg, 11);
            ok((await pg.locator('#sms-text').inputValue()) === '적다 만 글', `[${label}] 다른 대화를 봤다 와도 적던 글 그대로`);
            await mock('/__mock/set', { fail: 'reply' });
            await pg.click('#sms-send'); await pg.waitForTimeout(1100);
            ok(T.some(t => /답을 보내지 못했어요/.test(t)) && (await pg.locator('#sms-text').inputValue()) === '적다 만 글', `[${label}] 보내기 실패 → 안내 띠 · 적은 글 안 지워짐`);
            await mock('/__mock/set', { fail: '' });
            await pg.fill('#sms-text', '');
            await closeThread(pg);
            ok(await rows(pg) === 13 && !!(await pg.locator('.sms-item[data-id="11"]').count()), `[${label}] 이전 대화 보기에서는 접어도 줄이 남음(13줄)`);
if (phone) { await openThread(pg, 4); await pg.click('#sms-th-back'); await pg.waitForTimeout(350); ok(!(await pg.locator('#sms-thread').count()) && await pg.locator('#desk-sms').isVisible(), `[${label}] #653 [목록] 누름 → 대화만 접히고 목록으로`); }
            await scopeBtn(pg, false);
            // ⑫ 열어 둔 사이 손님이 또 보내면: 열린 채 새 글이 붙고(읽음) 접으면 빠진다
            await mock('/__mock/reset', {}); await wake(pg);
            ok(await rowsAre(pg, 7), `[${label}] (자료 처음으로) 7줄`);
            await openThread(pg, 6);
            const bub0 = await pg.locator('#sms-msgs .sms-bub').count();
            await mock('/__mock/push', { id: 6, body: '하나 더 여쭤볼게요' }); await wake(pg);
            await pg.waitForFunction(n => document.querySelectorAll('#sms-msgs .sms-bub').length === n + 1, bub0, { timeout: 8000 }).catch(() => { });
            const lv = await pg.evaluate(() => ({ bub: document.querySelectorAll('#sms-msgs .sms-bub').length, th: !!document.getElementById('sms-thread'), un: document.querySelector('.sms-item[data-id="6"]').dataset.un, badge: !!document.querySelector('.sms-item[data-id="6"] .sms-un') }));
            ok(lv.th && lv.bub === bub0 + 1 && lv.un === '0' && !lv.badge, `[${label}] 열어 둔 대화에 새 글이 붙음(말풍선 ${bub0} → ${lv.bub}) · 보고 있으니 배지 없음`);
            {   // 화면이 가려져 있는 동안에는 열어 둔 대화를 읽음으로 바꾸지 않는다(가려진 동안은 안 받거나 peek) — 자리 비운 사이 온 글은 안 읽음으로 남는다
                await pg.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
                const h0 = P.sms.length; await mock('/__mock/push', { id: 6, body: '자리 비운 사이 온 글' });
                await pg.waitForTimeout(7000);
                const hreq = P.sms.slice(h0).filter(x => /threads\/6/.test(x));
                const un6 = (await (await fetch(BASE + '/api/sms/threads/6?peek=1', { headers: { Authorization: 'Bearer x' } })).json()).thread.unread;
                ok(!hreq.some(x => x === 'GET /api/sms/threads/6') && un6 === 1, `[${label}] 가려진 동안 열어 둔 대화는 읽음으로 안 바꿈(그동안 요청 ${JSON.stringify(hreq)} · 서버의 안 읽음 ${un6})`);
                await pg.evaluate(() => { delete document.hidden; });
                await wake(pg);
                await pg.waitForFunction(() => Array.from(document.querySelectorAll('#sms-msgs .sms-bub')).some(b => /자리 비운 사이/.test(b.textContent)), null, { timeout: 8000 }).catch(() => { });
                ok(await pg.evaluate(() => Array.from(document.querySelectorAll('#sms-msgs .sms-bub')).some(b => /자리 비운 사이/.test(b.textContent))), `[${label}] 돌아오면 그 글이 열린 대화에 붙음(이제 읽음)`);
            }
            await closeThread(pg); await wake(pg);
            ok(await rowsAre(pg, 6) && !(await pg.locator('.sms-item[data-id="6"]').count()), `[${label}] 접으면 빠지고 다시 받아도 안 돌아옴(6줄)`);
            {   // ⑫-b 열어 둔 뒤에 봇 초안이 생겨도 답 칸에 채워진다(대표 폰 실물 10/11 — 종전엔 안내 띠만 뜨고 칸이 비어 [이대로 보내기]가 안 보였다)
                const st = () => pg.evaluate(() => ({ ta: document.getElementById('sms-text').value, btn: document.getElementById('sms-send').textContent, dis: document.getElementById('sms-send').disabled, band: !document.getElementById('sms-draft').hidden }));
                const taIs = v => pg.waitForFunction(x => document.getElementById('sms-text').value === x, v, { timeout: 8000 }).then(() => true).catch(() => false);
                await openThread(pg, 7);
                const pre = await buyOf();
                ok(pre.badge === '발송 전|wait' && pre.plan === '10/12(월)' && pre.order.indexOf('plan') === 0 && pre.paid === '10/10' && pre.item === '하우스감귤 가정용 - 4kg(로얄과) × 2' && pre.trk === null && pre.nums === '', `[${label}] #653·#654 발송 전 주문 = 배지 「${pre.badge}」 · 발송 예정 ${pre.plan}(맨 위) · 결제 ${pre.paid} · 품목 · 송장 칸 없음`);
                const e0 = await st();
                await mock('/__mock/draft', { id: 7, text: '가격표는 스마트스토어 상품 페이지에서 보실 수 있어요.' }); await wake(pg);
                const got = await taIs('가격표는 스마트스토어 상품 페이지에서 보실 수 있어요.'); const e1 = await st();
                ok(e0.ta === '' && !e0.band && e0.btn === '답 보내기' && got && e1.band && e1.btn === '이대로 보내기' && !e1.dis, `[${label}] 열어 둔 뒤에 초안이 생김 → 답 칸에 채워지고 [${e1.btn}] 켜짐(처음 「${e0.btn}」 · 안내 띠 ${e1.band})`);
                const bb = await box(pg, '#sms-send');
                ok(bb && bb.h >= 44 && await pg.locator('#sms-send').isVisible(), `[${label}] [이대로 보내기] 보임 · 높이 ${bb ? bb.h : '?'}px`);
                await wake(pg);
                ok((await st()).ta === '가격표는 스마트스토어 상품 페이지에서 보실 수 있어요.', `[${label}] 다시 받아도 채워진 초안 그대로`);
                await pg.fill('#sms-text', '직접 고치던 글'); await mock('/__mock/draft', { id: 7, text: '새로 만든 초안이에요.' }); await wake(pg); await pg.waitForTimeout(600);
                const e2 = await st();
                const nb = await pg.evaluate(() => { const b = document.getElementById('sms-draft-new'), d = document.getElementById('sms-draft'); return { k: d.dataset.k, text: d.textContent, h: b ? Math.round(b.getBoundingClientRect().height) : 0 }; });
                ok(e2.ta === '직접 고치던 글' && e2.btn === '고쳐서 보내기' && nb.k === 'new' && /초안을 새로 만들었어요/.test(nb.text) && nb.h >= 44, `[${label}] 사람이 적던 글은 새 초안이 와도 안 덮음(「${e2.ta}」 · [${e2.btn}]) · 안내 + [새 초안으로 바꾸기](${nb.h}px)`);
                await pg.click('#sms-draft-new'); await pg.waitForTimeout(250);
                const e2b = await st();
                ok(e2b.ta === '새로 만든 초안이에요.' && e2b.btn === '이대로 보내기' && await pg.evaluate(() => document.getElementById('sms-draft').dataset.k === 'std'), `[${label}] [새 초안으로 바꾸기] → 칸이 새 초안 · [${e2b.btn}]`);
                // B: 손 안 댄 초안은 새 초안이 오면 바뀐다(옛 초안이 나가지 않게)
                await mock('/__mock/draft', { id: 7, text: '세 번째 초안이에요.' });
                await pg.waitForTimeout(1400); await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // 깨운 직후 바로 본다(잠금은 0.8초뿐)
                const swapOk = await taIs('세 번째 초안이에요.');
                const sw1 = await pg.evaluate(() => ({ dis: document.getElementById('sms-send').disabled, flash: document.getElementById('sms-text').classList.contains('sms-text-new'), k: document.getElementById('sms-draft').dataset.k, band: document.getElementById('sms-draft').textContent }));
                await pg.waitForTimeout(1000);
                const sw2 = await st();
                ok(swapOk && sw2.btn === '이대로 보내기' && !sw2.dis, `[${label}] 손 안 댄 초안은 새 초안이 오면 칸도 새 초안으로 바뀜`);
                ok(sw1.k === 'chg' && /초안이 새로 바뀌었어요/.test(sw1.band) && sw1.flash && sw1.dis, `[${label}] #651 바뀐 순간: 「${sw1.band}」 띠 · 칸 강조 · [이대로 보내기] 잠깐 잠김(1초 뒤 풀림 ${!sw2.dis})`);
                await pg.fill('#sms-text', ''); await wake(pg); await pg.waitForTimeout(600);
                const e3 = await st();
                ok(e3.ta === '' && e3.band, `[${label}] 채워 준 초안을 사람이 지우면 같은 초안은 다시 안 채움`);
                // C: 내가 본 초안과 서버 초안이 다르면 보내지 않는다(409 draft_changed)
                await pg.fill('#sms-text', '세 번째 초안이에요.'); await pg.waitForTimeout(150);
                await mock('/__mock/draft', { id: 7, text: '방금 또 바뀐 초안이에요.' });   // 폴링이 새 초안을 받아 오기 전에 바로 누른다
                const before = (await logOf()).length;
                await pg.click('#sms-send'); await pg.waitForTimeout(1300);
                const lg1 = await logOf(), c1 = await st();
                const sent1 = (await (await fetch(BASE + '/api/sms/threads/7?peek=1', { headers: { Authorization: 'Bearer x' } })).json()).messages.filter(x => x.direction === 'out').length;
                ok(lg1.length === before + 1 && lg1[lg1.length - 1].action === 'send-draft' && (lg1[lg1.length - 1].body || {}).seen === '세 번째 초안이에요.' && sent1 === 1 && c1.ta === '방금 또 바뀐 초안이에요.' && c1.btn === '이대로 보내기' && T.some(t => /초안이 바뀌었어요/.test(t)), `[${label}] 폴링 사이 초안이 바뀌면 [이대로 보내기]는 안 나가고(seen 대조 409) 칸이 새 초안으로 · 안내 「초안이 바뀌었어요」(보낸 글 수 ${sent1})`);
                await pg.click('#sms-send'); await pg.waitForTimeout(1300);
                const lg = await logOf(), sent2 = (await (await fetch(BASE + '/api/sms/threads/7?peek=1', { headers: { Authorization: 'Bearer x' } })).json()).messages.filter(x => x.direction === 'out').pop();
                ok(lg.length === before + 2 && (lg[lg.length - 1].body || {}).seen === '방금 또 바뀐 초안이에요.' && sent2 && sent2.body === '방금 또 바뀐 초안이에요.', `[${label}] 확인하고 다시 누르면 그 초안이 나감(「${sent2 && sent2.body}」)`);
                await closeThread(pg);
                // G: 자동 모드에서도 사람 몫 대화에 초안이 있으면 「초안」 표시 + 칸에 채워짐
                await mock('/__mock/set', { mode: 'auto' }); await mock('/__mock/draft', { id: 3, text: '확인해 보고 바로 연락드릴게요.' }); await wake(pg);
                await pg.waitForFunction(() => !!document.querySelector('.sms-item[data-id="3"] .sms-tag'), null, { timeout: 8000 }).catch(() => { });
                const a3 = await rowOf(pg, 3);
                await openThread(pg, 3);
                const a3t = await st();
                ok(a3 && a3.tag === '초안' && a3.why === '불만·클레임' && a3t.ta === '확인해 보고 바로 연락드릴게요.' && a3t.btn === '이대로 보내기' && (await pg.locator('#sms-mode').innerText()) === '자동 답변', `[${label}] 자동 모드 + 사람 몫 + 초안 = 줄에 사유·「초안」 둘 다 · 칸에 초안 · [${a3t.btn}]`);
                await closeThread(pg); await mock('/__mock/set', { mode: 'draft' });
                // #651 유예 중인 봇 답(곧 발송)을 [보내지 않기]
                await wake(pg); await openThread(pg, 12);
                const q0 = await pg.evaluate(() => { const m = document.querySelector('#sms-msgs .sms-msg.out[data-s="queued"]'), b = m && m.querySelector('.sms-hold'); return { meta: m ? m.querySelector('small').textContent.replace(/\s+/g, ' ').trim() : '', h: b ? Math.round(b.getBoundingClientRect().height) : 0, n: document.querySelectorAll('#sms-msgs .sms-hold').length }; });
                const hb = (await logOf()).length;
                await pg.click('#sms-msgs .sms-hold'); await pg.waitForTimeout(1300);
                const q1 = await pg.evaluate(() => { const m = Array.from(document.querySelectorAll('#sms-msgs .sms-msg.out')).pop(); return { s: m.dataset.s, meta: m.querySelector('small').textContent.replace(/\s+/g, ' ').trim(), hold: !!document.querySelector('#sms-msgs .sms-hold'), badge: document.getElementById('sms-th-badge').textContent }; });
                const hl = await logOf();
                ok(/^봇 · .*곧 발송 보내지 않기$/.test(q0.meta) && q0.n === 1 && q0.h >= (phone ? 44 : 32) && hl.length === hb + 1 && hl[hl.length - 1].action === 'handled' && hl[hl.length - 1].id === 12 && q1.s === 'cancelled' && /안 보냄 · 직원이 먼저 답해서 취소/.test(q1.meta) && !q1.hold && q1.badge === '직원 답변' && T.some(t => /봇 답을 보내지 않았어요\. 봇은 이 대화에 더 답하지 않으니/.test(t)) && await pg.evaluate(() => document.activeElement && document.activeElement.id === 'sms-text'), `[${label}] #651 유예 중 봇 답 「${q0.meta}」(${q0.h}px · 두 통으로 나뉜 답인데 단추는 ${q0.n}개) → 누르면 handled 1건 · 그 글이 「${q1.meta}」 · 머리 「${q1.badge}」 · 답 칸에 초점`);
                {   // 이미 나가는 중(대기 0건)이면 막지 못했다고 알린다 — 가짜 서버가 취소 0 을 돌려주는 대화(9번: 발송 중 조각뿐)에 직접 물어 화면 글만 확인
                    const r0 = await (await fetch(BASE + '/api/sms/threads/9/handled', { method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: '{}' })).json();
                    ok(r0.ok === true && r0.cancelled === 0, `[${label}] (가짜 서버) 대기 발송이 없으면 handled 응답 cancelled 0`);
                }
                await closeThread(pg);
                await mock('/__mock/reset', {}); await wake(pg); await rowsAre(pg, 7);
                // D: 창이 초점을 잃었거나 2분 넘게 조작이 없으면 열어 둔 대화를 읽음으로 안 바꾼다(peek)
                await openThread(pg, 12);
                await pg.evaluate(() => { document.hasFocus = () => false; });
                const d0 = P.sms.length; await mock('/__mock/push', { id: 12, body: '자리 비운 사이 보낸 글' }); await wake(pg);
                await pg.waitForFunction(() => Array.from(document.querySelectorAll('#sms-msgs .sms-bub')).some(b => /자리 비운 사이 보낸/.test(b.textContent)), null, { timeout: 9000 }).catch(() => { });
                await wake(pg);
                const dreq = P.sms.slice(d0).filter(x => /threads\/12/.test(x)), dun = await rowOf(pg, 12);
                ok(dreq.length >= 1 && dreq.every(x => x === 'GET /api/sms/threads/12?peek=1') && dun && dun.un === '1' && await pg.evaluate(() => Array.from(document.querySelectorAll('#sms-msgs .sms-bub')).some(b => /자리 비운 사이 보낸/.test(b.textContent))), `[${label}] 초점 잃은 동안: 새 글은 대화에 보이되 읽음으로 안 바꿈(요청 ${dreq.length}회 전부 peek) · 줄에 안 읽음 배지 ${dun && dun.un}`);
                await pg.evaluate(() => { delete document.hasFocus; });
                await pg.mouse.move(5, 5); await pg.keyboard.press('Shift'); const d1 = P.sms.length; await wake(pg);
                await pg.waitForFunction(() => { const li = document.querySelector('.sms-item[data-id="12"]'); return li && li.dataset.un === '0'; }, null, { timeout: 12000 }).catch(() => { });
                ok(P.sms.slice(d1).some(x => x === 'GET /api/sms/threads/12') && (await rowOf(pg, 12)).dun === '0', `[${label}] 돌아와 조작하면 다음 폴링에서 읽음(배지 0)`);
                await pg.evaluate(() => { window.__aw = Date.now; Date.now = () => window.__aw() + 130000; });   // 2분 10초 뒤인 것처럼(조작 없음)
                const d2 = P.sms.length; await mock('/__mock/push', { id: 12, body: '한참 뒤 보낸 글' }); await wake(pg); await pg.waitForTimeout(1500);
                const idle = P.sms.slice(d2).filter(x => /threads\/12/.test(x));
                await pg.evaluate(() => { Date.now = window.__aw; });
                ok(idle.length >= 1 && idle.every(x => /peek=1/.test(x)), `[${label}] 2분 넘게 조작이 없으면 peek(요청 ${JSON.stringify(idle)})`);
                await closeThread(pg);
            }
            // ⑬ 끊김 · 지금 챙길 일
            await mock('/__mock/reset', {}); await mock('/__mock/set', { alive: false }); await wake(pg);
            await rowsAre(pg, 7);
            await unfold(pg);
            const dd = await pg.evaluate(() => { const li = document.querySelector('#desk-todo-box .sms-todo[data-sms="active"]'); return { note: document.getElementById('sms-note').textContent, k: document.getElementById('sms-note').dataset.k, hid: document.getElementById('sms-note').hidden, chip: document.getElementById('desk-sms-now').dataset.dead, todoDead: !!document.querySelector('#desk-todo-box .sms-todo.dead'), name: li ? li.querySelector('span').textContent : '', n: li ? li.querySelector('b').textContent : '', sub: li ? li.querySelector('small').textContent : '' }; });
            ok(!dd.hid && dd.k === 'err' && /연결이 끊겼어요/.test(dd.note) && /마지막 연결/.test(dd.note) && dd.chip === '1', `[${label}] 전달 앱 끊김 → 카드에 빨강 안내 · 알약 표시(${dd.note.slice(0, 34)}…)`);
            ok(dd.todoDead && dd.name === '안 읽은 문자' && dd.n === '7건' && /^직원 확인 3 · 초안 1 · /.test(dd.sub), `[${label}] 「지금 챙길 일」에 끊김 한 줄 + 「${dd.name} ${dd.n}」(${dd.sub.slice(0, 20)})`);
            await openThread(pg, 2);
            ok(/연결이 끊겨 있어요/.test(await pg.locator('#sms-warn').innerText()), `[${label}] 답 칸 위에 끊김 주의`);
            await closeThread(pg);
            await scopeBtn(pg, true);
            await pg.click('#sms-close'); await pg.waitForTimeout(300);
            ok(!(await pg.locator('#desk-sms').isVisible()), `[${label}] [닫기] → 카드 닫힘`);
            await unfold(pg);
            await pg.locator('#desk-todo-box .sms-todo[data-sms="active"]').scrollIntoViewIfNeeded();
            const tb = await box(pg, '#desk-todo-box .sms-todo[data-sms="active"]');
            await pg.locator('#desk-todo-box .sms-todo[data-sms="active"]').click(); await pg.waitForTimeout(900);
            const tg = await pg.evaluate(() => ({ vis: !document.getElementById('desk-sms').hidden, pressed: document.getElementById('sms-scope').getAttribute('aria-pressed'), n: document.querySelectorAll('#sms-list .sms-item').length, un: document.querySelectorAll('#sms-list .sms-item.unread').length }));
            ok(tg.vis && tg.pressed === 'false' && tg.n === 6 && tg.un === 6 && (!phone || (tb && tb.h >= 44)), `[${label}] 챙길 일 「안 읽은 문자」 누름 → 이전 대화 보기를 켜 뒀어도 새 문자만으로 열림(${JSON.stringify(tg)} · 줄 높이 ${tb ? tb.h : '?'})`);
            // #633 「봇 실패 N건」 줄 — 문자 알약 = 직원 확인이 필요한 대화만
            const bf = await pg.evaluate(() => { const li = document.querySelector('#desk-todo-box .bot-fail'); if (!li) return null; const bs = Array.from(li.querySelectorAll('.bf-go')), cs = e => getComputedStyle(e).color, plain = document.querySelector('#desk-todo-box .desk-todo li:not(.bot-fail):not(.sms-todo) b');
                return { t: li.querySelector('span').textContent + '|' + li.querySelector('b').textContent, bs: bs.map(b => b.textContent).join(','), h: Math.min(...bs.map(b => Math.round(b.getBoundingClientRect().height))), n: document.querySelectorAll('#desk-todo-box .bot-fail').length, note: li.querySelector('small i').textContent, red: !!plain && cs(li.querySelector('b')) !== cs(plain) }; });
            ok(bf && bf.t === '봇 실패|3건' && bf.bs === '톡톡 2,문자 1' && bf.n === 1 && bf.red && !/문자 답할 것/.test(bf.note), `[${label}] #633 챙길 일에 「봇 실패 3건」 한 줄 · 알약 「${bf && bf.bs}」 · 건수는 빨강(${bf && bf.note})`);
            ok(bf && bf.h >= (phone ? 44 : 32), `[${label}] #633 알약 높이 ${bf && bf.h}px`);
            await pg.click('#sms-close'); await pg.waitForTimeout(300);
            await pg.locator('#desk-todo-box .bf-go[data-bf="sms"]').scrollIntoViewIfNeeded();
            await pg.locator('#desk-todo-box .bf-go[data-bf="sms"]').click(); await pg.waitForTimeout(900);
            const bg = await pg.evaluate(() => ({ vis: !document.getElementById('desk-sms').hidden, pressed: document.getElementById('sms-staff').getAttribute('aria-pressed'), n: document.querySelectorAll('#sms-list .sms-item').length, why: document.querySelectorAll('#sms-list .sms-item .sms-why').length, cnt: document.getElementById('sms-count').textContent, page: document.getElementById('page-agent-office').classList.contains('active') }));
            ok(bg.vis && bg.n === 3 && bg.why === 3 && /^직원 확인만 · 3건$/.test(bg.cnt) && bg.pressed === 'true' && bg.page, `[${label}] #633 「문자 1」 알약 누름 → 문자 카드가 「직원 확인이 필요한 대화만」으로 열림(읽은 것 포함 · ${JSON.stringify(bg)})`);
            await pg.click('#sms-scope'); await pg.waitForTimeout(500);
            ok(await rows(pg) === 13 && (await pg.getAttribute('#sms-staff', 'aria-pressed')) === 'false' && (await pg.getAttribute('#sms-scope', 'aria-pressed')) === 'true', `[${label}] 거른 채 [이전 대화 보기]를 누르면 거르기만 풀려 전체(13줄)`);
            await scopeBtn(pg, false);
            ok(await rows(pg) === 6 && (await pg.locator('#sms-count').innerText()) === '6건', `[${label}] 다시 누르면 새 문자만(6줄)`);
            ok(await sw(pg) <= vw.width, `[${label}] 끝까지 가로 넘침 없음(${await sw(pg)})`);
            if (theme) { await openThread(pg, 3); const a = await H.audit(pg, '#desk-sms, #desk-todo-box .desk-todo'); ok(a.fails.length === 0, `[${label}] 끊김 안내·챙길 일 줄까지 야간 대비 미달 0(글자 ${a.texts}개${a.fails.length ? ' · ' + a.fails.slice(0, 4).join(' / ') : ''})`); await closeThread(pg); }
            {   // 교차 점검 A: 「자세히 확인하기」 전체 화면이 떠 있는 채 알림으로 문자를 열어도 창·대화가 보인다(창이 닫히고 읽음만 찍히던 결함)
                await sheetDown(pg); await pg.click('#sms-close').catch(() => { }); await pg.waitForTimeout(400);
                await mock('/__mock/reset', {}); await wake(pg);
                await pg.evaluate(() => { const sec = document.getElementById('desk-listbox'), S = window.__aoDesk.S; S.full = sec; sec.classList.add('is-full'); document.body.classList.add('desk-full-open'); history.pushState({ deskFull: sec.id }, ''); });   // openFull 이 하는 일 그대로
                const a0 = P.sms.length;
                const oA = await pg.evaluate(() => window.AkmAoDesk.openSms(3)); await pg.waitForTimeout(900);
                const gA = await pg.evaluate(() => ({ full: !!window.__aoDesk.S.full, win: !document.getElementById('desk-sms').hidden && document.body.classList.contains('sms-win-open'), th: (document.getElementById('sms-thread') || { dataset: {} }).dataset.id || '', st: (history.state || {}).smsWin || '', bub: document.querySelectorAll('#sms-msgs .sms-bub').length }));
                const un3 = (await (await fetch(BASE + '/api/sms/threads/3?peek=1', { headers: { Authorization: 'Bearer x' } })).json()).thread.unread;
                ok(oA === true && !gA.full && gA.win && gA.th === '3' && gA.st === 'th' && gA.bub >= 2 && un3 === 0, `[${label}] 전체 화면이 떠 있는 채 openSms(3) → 전체 화면이 닫히고 문자 창·대화가 보임(읽음 ${un3 === 0} · ${JSON.stringify(gA)})`);
                await pg.goBack().catch(() => { }); await pg.waitForTimeout(400); await pg.goBack().catch(() => { }); await pg.waitForTimeout(400);
                ok(await pg.evaluate(() => document.getElementById('desk-sms').hidden && !document.body.classList.contains('sms-win-open') && !((history.state || {}).smsWin) && !((history.state || {}).deskFull) && document.getElementById('page-agent-office').classList.contains('active')), `[${label}] 그 뒤 뒤로가기 2번 = 대화 → 창 닫힘 · 남은 칸 없음`);
                await plusGo(pg, '#desk-sms-now'); await pg.waitForTimeout(700); await scopeBtn(pg, false);
            }
            // ⑭ 빈 목록 · 꺼짐 · 모드 칩
            await mock('/__mock/reset', {});
            for (const id of [1, 2, 3, 6, 7, 11, 12]) await fetch(BASE + '/api/sms/threads/' + id, { headers: { Authorization: 'Bearer x' } });   // 전부 읽음으로
            await wake(pg);
            await rowsAre(pg, 0);
            const em = await pg.evaluate(() => { const li = document.querySelector('#sms-list .sms-none'), b = li && li.querySelector('.sms-empty-go'); return { text: li ? li.querySelector('span').textContent : '', btn: b ? b.textContent : '', h: b ? Math.round(b.getBoundingClientRect().height) : 0, chip: document.getElementById('sms-chip-n').hidden, todo: document.querySelectorAll('#desk-todo-box .sms-todo[data-sms="active"]').length }; });
            ok(em.text === '새 문자가 없어요.' && em.btn === '이전 대화 보기' && em.h >= 44 && em.chip && em.todo === 0, `[${label}] 다 읽으면 「${em.text}」 + [${em.btn}](${em.h}px) · 알약 숫자·챙길 일 줄 없음`);
            await pg.click('#sms-list .sms-empty-go'); await pg.waitForTimeout(700);
            ok(await rows(pg) === 13 && (await pg.getAttribute('#sms-scope', 'aria-pressed')) === 'true', `[${label}] 빈 목록의 [이전 대화 보기] → 13줄`);
            await scopeBtn(pg, false);
            await mock('/__mock/reset', {}); await mock('/__mock/set', { alive: true, enabled: false, mode: 'record' }); await wake(pg);
            const off = await pg.evaluate(() => ({ note: document.getElementById('sms-note').textContent, mode: document.getElementById('sms-mode').textContent, todo: document.querySelectorAll('#desk-todo-box .sms-todo').length }));
            ok(/연동이 꺼져 있어요/.test(off.note) && off.mode === '기록만' && off.todo === 0, `[${label}] 꺼짐 안내 · 모드 「${off.mode}」 · 챙길 일 줄 없음`);
            {   // #651 꺼져 있을 때 보내기 = 서버 409 글 그대로 안내 · 적은 글 유지 / staff_open 칸이 없는 서버 = 「직원 몫」 대화 수로 대신
                await mock('/__mock/reset', {}); await mock('/__mock/set', { enabled: false }); await wake(pg); await rowsAre(pg, 7);
                await openThread(pg, 2); await pg.fill('#sms-text', '꺼진 채 보내 보는 글'); const t0 = T.length; await pg.click('#sms-send'); await pg.waitForTimeout(1100);
                ok(T.slice(t0).some(t => /답을 보내지 못했어요: 문자 연동이 꺼져 있어요/.test(t)) && (await pg.locator('#sms-text').inputValue()) === '꺼진 채 보내 보는 글', `[${label}] #651 꺼져 있을 때 [답 보내기] → 「…꺼져 있어요」 안내 · 글 유지`);
                await pg.fill('#sms-text', ''); await closeThread(pg);
                await mock('/__mock/set', { enabled: true, staffOpen: false }); await wake(pg);
                await pg.waitForFunction(() => document.getElementById('sms-staff-n').textContent === '3', null, { timeout: 8000 }).catch(() => { });
                const sAlt = await sumOf();
                ok(!('staff_open' in sAlt) && (await pg.locator('#sms-staff-n').innerText()) === String(sAlt.staff_needed) && await pg.locator('#sms-staff').isVisible(), `[${label}] #651 요약에 staff_open 이 없으면 「직원 몫」 대화 수(${sAlt.staff_needed})로 대신`);
                await mock('/__mock/set', { staffOpen: true });
            }
            // ⑮ 옛 서버 응답(#635 칸 없음)에도 죽지 않는다
            await mock('/__mock/reset', {}); await mock('/__mock/set', { legacy: true }); await wake(pg);
            await rowsAre(pg, 12);
            const s0 = await sumOf();
            const lg = await pg.evaluate(() => { const li = document.querySelector('#desk-todo-box .sms-todo[data-sms="active"]'); return { n: document.querySelectorAll('#sms-list .sms-item').length, badges: document.querySelectorAll('#sms-list .sms-row > .desk-badge').length, un: document.querySelectorAll('#sms-list .sms-un').length, chip: document.getElementById('sms-chip-n').textContent, name: li ? li.querySelector('span').textContent : '', why: Array.from(document.querySelectorAll('#sms-list .sms-why')).map(x => x.textContent).join(',') }; });
            ok(!('unread_threads' in s0) && lg.n === 12 && lg.badges === 12 && lg.un === 0 && lg.chip === String(s0.staff_needed + s0.counts.draft) && lg.name === '문자 답할 것' && lg.why === '직원 확인,직원 확인,직원 확인', `[${label}] 옛 서버 응답 = 종전 목록(12줄 · 줄마다 상태 배지 · 안 읽음 배지 없음) · 알약 ${lg.chip} = 직원 몫 + 초안 대기 · 챙길 일 「${lg.name}」 · 직원 몫 줄에 「직원 확인」`);
            await openThread(pg, 2); await closeThread(pg);
            ok(await rows(pg) === 12 && !!(await pg.locator('.sms-item[data-id="2"]').count()), `[${label}] 옛 서버에서는 접어도 줄이 그대로(읽음 정보가 없으니 안 뺌)`);
            await mock('/__mock/set', { legacy: false });
            ok(P.errors.length === 0, `[${label}] 화면 오류 ${P.errors.length}${P.errors.length ? ' · ' + P.errors.slice(0, 2).join(' / ') : ''}`);
            await P.ctx.close();
        }
        {   // 문자 라우트가 없는 서버(배포 전 · 종전 서버) → 알약이 안 보이고 다른 알약은 그대로
            console.log('\n── 문자 라우트 없는 서버');
            await mock('/__mock/reset', {});
            const P = await open(PC, false, null, pg => pg.route('**/api/sms/**', r => r.fulfill({ status: 404, contentType: 'text/html', body: '<pre>Cannot GET</pre>' })));
            const g = await P.pg.evaluate(() => ({ sms: document.getElementById('desk-sms-now').hidden, chips: Array.from(document.querySelectorAll('.desk-quick2 .desk-chip')).filter(b => !b.hidden).map(b => b.textContent.trim()), menu: Array.from(document.querySelectorAll('#desk-plus .desk-mi')).filter(b => !b.hidden).map(b => b.querySelector('strong').textContent.trim()), dot: document.getElementById('desk-plus-n').hidden, card: document.getElementById('desk-sms').hidden, todo: document.querySelectorAll('.sms-todo').length }));
            ok(g.sms && g.card && g.todo === 0 && g.dot && g.chips.join('|') === '' && g.menu.join('|') === '파일 · 이미지|정산 이미지|중간발주|최종발주|배송조회 확인하기|전체 가격 확인하기', `[없는 서버] 문자 항목·바로가기·점 없음 · 나머지 메뉴 그대로(${g.menu.join('|')}) · 바로가기 「${g.chips.join('|')}」`);
            await P.pg.waitForTimeout(3000);
            ok(P.sms.length <= 1 && P.errors.length === 0, `[없는 서버] 요약은 한 번만 물어보고 그만둠(${P.sms.length}회) · 화면 오류 ${P.errors.length}`);
            await plusGo(P.pg, '#desk-ship-now'); await P.pg.waitForTimeout(400);
            ok(await P.pg.locator('#desk-ship').isVisible(), '[없는 서버] 배송조회 카드는 종전대로 열림');
            await P.ctx.close();
        }
        {   // 도구 카드는 한 번에 하나 · 알림에서 그 대화로
            console.log('\n── 다른 도구 카드와 함께 · 알림');
            await mock('/__mock/reset', {});
            const P = await open(PC, false, null), pg = P.pg;
            await plusGo(pg, '#desk-sms-now'); await pg.waitForTimeout(500); await openThread(pg, 1);
            const covered = await pg.evaluate(() => { const b = document.getElementById('desk-plus-btn').getBoundingClientRect(), top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!top && !!top.closest('#desk-sms'); });
            ok(covered, '[도구] #653 문자 창이 떠 있는 동안 뒤의 [+] 단추는 창에 가려 눌리지 않음');
            await pg.mouse.click(6, 6); await pg.waitForTimeout(450);   // 창 바깥(어두운 곳)
            ok(!(await pg.locator('#desk-sms').isVisible()) && await pg.evaluate(() => !document.body.classList.contains('sms-win-open') && !((history.state || {}).smsWin)), '[도구] #653 창 바깥(어두운 곳) 누름 → 창 닫힘(대화 포함 · 뒤로가기 칸 정리)');
            await plusGo(pg, '#desk-ship-now'); await pg.waitForTimeout(500);
            ok(await pg.locator('#desk-ship').isVisible(), '[도구] 배송조회 카드는 종전대로 열림');
            await plusGo(pg, '#desk-sms-now'); await pg.waitForTimeout(800);
            ok(await pg.locator('#desk-sms').isVisible() && !(await pg.locator('#desk-ship').isVisible()) && await rows(pg) === 6, `[도구] 문자를 열면 배송조회가 닫히고 목록이 뜸(${await rows(pg)}줄 · 읽은 1234 는 빠짐)`);
            await pg.click('#sms-close'); await pg.waitForTimeout(400);
            ok(!(await pg.locator('#desk-sms').isVisible()), '[도구] [닫기] → 창 닫힘');
            // 알림 link(agent-office?sms=ID) → app.js 가 부를 함수 = window.AkmAoDesk.openSms(id)
            ok(await pg.evaluate(() => typeof window.AkmAoDesk.openSms === 'function' && typeof window.AkmAoDesk.open === 'function'), '[알림] window.AkmAoDesk.openSms 있음(종전 open 도 그대로)');
            const o1 = await pg.evaluate(() => window.AkmAoDesk.openSms(3)); await pg.waitForTimeout(700);
            const g1 = await pg.evaluate(() => ({ card: !document.getElementById('desk-sms').hidden, open: (document.getElementById('sms-thread') || { dataset: {} }).dataset.id, bub: document.querySelectorAll('#sms-msgs .sms-bub').length, scope: document.getElementById('sms-scope').getAttribute('aria-pressed') }));
            ok(o1 === true && g1.card && g1.open === '3' && g1.bub >= 2 && g1.scope === 'false', `[알림] 카드가 닫혀 있어도 openSms(3) → 카드 열림 · 안 읽은 대화면 새 문자 목록에서 펼침(${JSON.stringify(g1)})`);
            const o2 = await pg.evaluate(() => window.AkmAoDesk.openSms(8)); await pg.waitForTimeout(900);
            const g2 = await pg.evaluate(() => ({ open: (document.getElementById('sms-thread') || { dataset: {} }).dataset.id, one: document.querySelectorAll('#sms-thread').length, scope: document.getElementById('sms-scope').getAttribute('aria-pressed'), n: document.querySelectorAll('#sms-list .sms-item').length }));
            ok(o2 === true && g2.open === '8' && g2.one === 1 && g2.scope === 'true' && g2.n === 13, `[알림] 이미 읽은 대화(4444)면 「이전 대화 보기」로 넘겨서 펼침 · 앞 대화는 접힘(${JSON.stringify(g2)})`);
            const o3 = await pg.evaluate(() => window.AkmAoDesk.openSms(8)); await pg.waitForTimeout(400);
            ok(o3 === true && await pg.evaluate(() => !!document.getElementById('sms-thread')), '[알림] 이미 열린 대화를 또 부르면 그대로 열려 있음(접히지 않음)');
            const o5 = await pg.evaluate(() => window.AkmAoDesk.openSms(9999)), o6 = await pg.evaluate(() => window.AkmAoDesk.openSms('x'));
            ok(o5 === false && o6 === false && await pg.locator('#desk-sms').isVisible(), '[알림] 없는 번호·틀린 값 → false(카드만 열린 채 · 오류 없음)');
            ok(P.sms.some(x => /GET \/api\/sms\/threads\/9999\?peek=1/.test(x)) && !P.sms.some(x => x === 'GET /api/sms/threads/9999'), '[알림] 줄만 채우려는 조회는 peek=1(읽음으로 안 바꿈)');
            ok(P.errors.length === 0, `[도구] 화면 오류 ${P.errors.length}`);
            // #633 「톡톡 2」 알약 → 문의 관리 메뉴의 「톡톡 문의」 탭(맨 끝에서 — 메뉴가 바뀌므로)
            await pg.keyboard.press('Escape'); await pg.click('#sms-close').catch(() => { });
            await unfold(pg);
            await pg.locator('#desk-todo-box .bf-go[data-bf="talk"]').click(); await pg.waitForTimeout(800);
            const tk = await pg.evaluate(() => ({ page: document.getElementById('page-inquiry').classList.contains('active') && !document.getElementById('page-agent-office').classList.contains('active'), tab: (document.querySelector('#page-inquiry .settlement-tab.active') || { id: '' }).id }));
            ok(tk.page && tk.tab === 'inquiry-tab-btn-unanswered', `[#633] 「톡톡 2」 알약 누름 → 문의 관리 메뉴 · 「톡톡 문의」 탭(${tk.tab})`);
            await P.ctx.close();
        }
    } finally { await browser.close().catch(() => { }); srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });

// #653-나: 자주 쓰는 일 알약이 입력 칸 [+] 메뉴 안으로 들어갔다 → 메뉴를 열고 그 항목을 누른다(메뉴가 없는 옛 화면이면 바로 누름)
async function plusGo(pg, sel) {
    if (await pg.evaluate(() => { const m = document.getElementById('desk-plus'); return !!m && m.hidden; })) { await pg.click('#desk-plus-btn'); await pg.waitForTimeout(200); }
    await pg.click(sel);
}
