// #610-E 에이전트 오피스 「문자」 카드 검증 — 가짜 서버(scripts/_mock-610.js · DB·외부 호출 0)에 실제 화면을 띄워 실클릭
//   사용: node scripts/verify-610-ui.js   (포트 PORT610 · 없으면 3461 · 다른 Playwright 검증과 동시에 돌리지 말 것)
//   PC · 폰 · PC 야간 · 폰 야간 × 목록 · 거르기 · 찾기 · 펼침 · 사진 · 답 보내기 · 초안 보내기 · 처리함 · 끝내기 · 끊김 · scrollWidth · 44px · Esc
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
    const wake = async pg => { await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(900); };   // 돌아왔을 때처럼 바로 다시 받게
    const rows = pg => pg.locator('#sms-list .sms-item').count();
    const openThread = async (pg, id) => { if (await pg.evaluate(() => { const t = document.getElementById('sms-thread'); return !!t && getComputedStyle(t).position === 'fixed'; })) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(250); }   // 폰 시트는 목록을 덮으므로 먼저 접는다
        await pg.locator(`#sms-list .sms-item[data-id="${id}"] > .sms-row`).click({ timeout: 4000 }); await pg.waitForFunction(i => { const t = document.getElementById('sms-thread'); return t && t.closest('.sms-item').dataset.id === String(i) && !document.querySelector('#sms-msgs .desk-empty'); }, id, { timeout: 5000 }).catch(() => { }); await pg.waitForTimeout(350); };
    const box = async (pg, sel) => { const b = await pg.locator(sel).first().boundingBox(); return b ? { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) } : null; };

    try {
        for (const [label, vw, phone, theme] of [['PC', PC, false, null], ['폰', PH, true, null], ['PC 야간', PC, false, 'dark'], ['폰 야간', PH, true, 'dark']]) {
            console.log('\n── ' + label);
            await mock('/__mock/reset', {});
            const P = await open(vw, phone, theme), pg = P.pg, T = P.toasts;
            // ① 알약 · 새 폴링 없음
            ok(await pg.locator('#desk-sms-now').isVisible() && (await pg.locator('#sms-chip-n').innerText()) === '4', `[${label}] 알약 「문자」 보임 · 볼 것 숫자 4(직원 몫 3 + 초안 대기 1)`);
            const n0 = P.sms.length; await pg.waitForTimeout(3200);
            ok(P.sms.length === n0 && n0 <= 2, `[${label}] 카드를 안 열면 문자 요청은 요약뿐(처음 ${n0}회 · 3초 동안 추가 ${P.sms.length - n0}회)`);
            await pg.click('#desk-sms-now'); await pg.waitForTimeout(700);
            // ② 목록 · 머리
            ok(await rows(pg) === 12, `[${label}] 목록 12줄(${await rows(pg)})`);
            ok((await pg.locator('#sms-mode').innerText()) === '초안', `[${label}] 모드 칩 「초안」`);
            const cells = await pg.locator('#sms-stat li b').allInnerTexts();
            const cellNames = (await pg.locator('#sms-stat li span').allInnerTexts()).join('/');
            ok(cells.join(',') === '3,1,5,2' && cellNames === '직원 몫/초안 대기/봇 답/처리됨', `[${label}] 숫자 칸 = ${cellNames}(「쿨다운」 없음) · ${cells.join(',')}`);
            ok(await sw(pg) <= vw.width, `[${label}] 목록 가로 넘침 없음(${await sw(pg)} ≤ ${vw.width})`);
            const r1 = await pg.evaluate(() => { const li = document.querySelector('#sms-list .sms-item[data-id="1"]'); return { tail: li.querySelector('.sms-tail').textContent, hint: li.querySelector('.sms-hint').textContent, badge: li.querySelector('.desk-badge').textContent, pic: !!li.querySelector('.sms-pic'), tag: !!li.querySelector('.sms-tag'), time: li.querySelector('.sms-time').textContent }; });
            ok(r1.tail === '끝 1234' && /효돈/.test(r1.hint) && r1.badge === '초안 대기' && r1.pic && r1.tag && /^\d\d:\d\d$|\d+\/\d+ \d\d:\d\d/.test(r1.time), `[${label}] 줄 = 끝 4자리 · 손님 힌트 · 상태 배지 · 시각 · 사진 · 초안 표시(${JSON.stringify(r1)})`);
            ok((await pg.locator('#sms-list .sms-item[data-id="2"] .sms-hint').innerText()) === '주문을 찾지 못한 번호', `[${label}] 힌트 없는 번호 안내`);
            // ③ 거르기
            await pg.click('#sms-stat li[data-b="staff_needed"]'); await pg.waitForTimeout(600);
            const f = await pg.evaluate(() => ({ n: document.querySelectorAll('#sms-list .sms-item').length, all: Array.from(document.querySelectorAll('#sms-list .sms-item')).every(x => x.dataset.st === 'staff_needed'), pressed: document.querySelector('#sms-stat li[data-b="staff_needed"]').getAttribute('aria-pressed'), btn: !document.getElementById('sms-all').hidden }));
            ok(f.n === 3 && f.all && f.pressed === 'true' && f.btn, `[${label}] 「직원 몫」 칸 누름 → 3줄 전부 직원 몫 · 눌린 표시 · [전체] 보임(${JSON.stringify(f)})`);
            ok(P.sms.some(x => /threads\?status=staff_needed/.test(x)), `[${label}] 거르기는 서버에 status=staff_needed 로 물어봄`);
            await pg.click('#sms-all'); await pg.waitForTimeout(600);
            ok(await rows(pg) === 12, `[${label}] [전체] → 12줄`);
            await pg.focus('#sms-stat li[data-b="draft"]'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(600);
            ok(await rows(pg) === 1 && P.sms.some(x => /threads\?status=draft/.test(x)), `[${label}] 자판(Enter)으로 「초안 대기」 → 1줄(서버에 status=draft)`);
            await pg.click('#sms-stat li[data-b="draft"]'); await pg.waitForTimeout(600);
            ok(await rows(pg) === 12, `[${label}] 같은 칸 다시 누름 → 전체`);
            // ④ 찾기
            await pg.fill('#sms-q', '7007'); await pg.waitForTimeout(900);
            ok(await rows(pg) === 1, `[${label}] 찾기 「7007」 → 1줄`);
            await pg.fill('#sms-q', '없는글자zz'); await pg.waitForTimeout(900);
            ok(/찾은 문자가 없어요/.test(await pg.locator('#sms-list').innerText()), `[${label}] 찾은 것 없음 안내`);
            await pg.fill('#sms-q', ''); await pg.waitForTimeout(900);
            // ⑤ 펼침 · 주문 · 사진 · 초안
            await openThread(pg, 1);
            const th = await pg.evaluate(() => ({ bub: document.querySelectorAll('#sms-msgs .sms-bub').length, thumbs: Array.from(document.querySelectorAll('#sms-msgs .sms-thumb img')).map(i => i.naturalWidth > 0), order: document.getElementById('sms-order').textContent, ta: document.getElementById('sms-text').value, btn: document.getElementById('sms-send').textContent, dis: document.getElementById('sms-send').disabled, draft: !document.getElementById('sms-draft').hidden, exp: document.querySelector('.sms-item[data-id="1"] .sms-row').getAttribute('aria-expanded') }));
            await pg.waitForFunction(() => Array.from(document.querySelectorAll('#sms-msgs .sms-thumb img')).every(i => i.naturalWidth > 0), null, { timeout: 4000 }).catch(() => { });
            const loaded = await pg.evaluate(() => Array.from(document.querySelectorAll('#sms-msgs .sms-thumb img')).map(i => i.naturalWidth > 0));
            ok(th.bub === 2 && loaded.length === 2 && loaded.every(Boolean) && th.exp === 'true', `[${label}] 대화 펼침 · 말풍선 2 · 사진 썸네일 2장 실제로 뜸(${JSON.stringify(loaded)})`);
            ok(/10\/09 발송/.test(th.order) && /송장 끝 4821/.test(th.order) && /배송완료/.test(th.order), `[${label}] 주문 힌트 한 줄(${th.order.slice(0, 60)})`);
            ok(/^부패과가 나왔군요/.test(th.ta) && th.btn === '이대로 보내기' && !th.dis && th.draft, `[${label}] 초안 모드 · 봇 초안이 답 칸에 미리 · 버튼 「${th.btn}」`);
            ok(await sw(pg) <= vw.width, `[${label}] 펼친 뒤 가로 넘침 없음(${await sw(pg)})`);
            if (phone) {
                const g = await pg.evaluate(() => { const t = document.getElementById('sms-thread').getBoundingClientRect(), b = document.getElementById('sms-back'), cs = getComputedStyle(document.getElementById('sms-thread')); return { pos: cs.position, bottom: Math.round(window.innerHeight - t.bottom), left: Math.round(t.left), w: Math.round(t.width), top: Math.round(t.top), back: getComputedStyle(b).display !== 'none' && !b.hidden }; });
                ok(g.pos === 'fixed' && g.bottom === 0 && g.left === 0 && g.w === vw.width && g.top > 40 && g.back, `[${label}] 폰은 아래에서 올라오는 시트(${JSON.stringify(g)})`);
                const small = [];
                for (const s of ['#sms-th-x', '#sms-send', '#sms-handled', '#sms-end', '#sms-close', '#sms-q']) { const b = await box(pg, s); if (!b || b.h < 44 || (s === '#sms-th-x' && b.w < 44)) small.push(s + ' ' + JSON.stringify(b)); }
                const rh = await pg.evaluate(() => Math.min(...Array.from(document.querySelectorAll('#sms-list .sms-row, #sms-stat li')).map(e => e.getBoundingClientRect().height)));
                ok(!small.length && rh >= 44, `[${label}] 터치 요소 44px 이상(미달 ${small.join(' / ') || '없음'} · 줄·칸 최소 ${Math.round(rh)})`);
            } else {
                const g = await pg.evaluate(() => ({ pos: getComputedStyle(document.getElementById('sms-thread')).position, back: getComputedStyle(document.getElementById('sms-back')).display }));
                ok(g.pos !== 'fixed' && g.back === 'none', `[${label}] PC 는 그 줄 아래에 펼침(${JSON.stringify(g)})`);
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
            // ⑦ 초안 그대로 보내기
            await pg.click('#sms-send'); await pg.waitForTimeout(1300);
            let log = await logOf();
            const d1 = await pg.evaluate(() => ({ last: (Array.from(document.querySelectorAll('#sms-msgs .sms-msg.out small')).pop() || {}).textContent, ta: document.getElementById('sms-text').value, chip: document.getElementById('sms-chip-n').textContent, badge: document.querySelector('.sms-item[data-id="1"] .desk-badge').textContent }));
            ok(log.length === 1 && log[0].action === 'send-draft' && log[0].id === 1, `[${label}] [이대로 보내기] → 가짜 서버에 send-draft 1건 도착(${JSON.stringify(log.map(l => l.action + ':' + l.id))})`);
            ok(/직원\(오피스\)/.test(d1.last || '') && /보내는 중/.test(d1.last || '') && d1.ta === '' && d1.chip === '3' && d1.badge === '직원 답변' && T.some(t => /답을 보냈어요/.test(t)), `[${label}] 보낸 답이 대화에 「${d1.last}」 · 답 칸 비움 · 알약 3(초안 대기 0) · 「직원 답변」 · 안내 띠`);
            // ⑧ 직접 적어 보내기 (다른 대화)
            await openThread(pg, 2);
            ok(await pg.evaluate(() => document.getElementById('sms-send').disabled && document.getElementById('sms-send').textContent === '답 보내기' && document.getElementById('sms-draft').hidden && document.getElementById('sms-text').value === ''), `[${label}] 초안 없는 대화 = 빈 답 칸 · [답 보내기] 꺼짐`);
            ok(/찾은 최근 주문이 없어요/.test(await pg.locator('#sms-order').innerText()), `[${label}] 주문 없는 번호 안내`);
            await pg.fill('#sms-text', '네, 50박스 가능합니다. 담당자가 오늘 중으로 연락드릴게요.'); await pg.waitForTimeout(150);
            if (phone) await pg.click('#sms-send'); else { await pg.focus('#sms-text'); await pg.keyboard.press('Control+Enter'); }
            await pg.waitForTimeout(1300);
            log = await logOf();
            const l2 = log[log.length - 1] || {};
            ok(log.length === 2 && l2.action === 'reply' && l2.id === 2 && /50박스 가능합니다/.test((l2.body || {}).text || ''), `[${label}] ${phone ? '[답 보내기]' : 'Ctrl+Enter'} → reply { text } 도착(${l2.action}:${l2.id} 「${String((l2.body || {}).text || '').slice(0, 16)}」)`);
            const d2 = await pg.evaluate(() => ({ badge: document.getElementById('sms-th-badge').textContent, who: (Array.from(document.querySelectorAll('#sms-msgs .sms-msg.out small')).pop() || {}).textContent, handled: document.getElementById('sms-handled').disabled }));
            ok(d2.badge === '직원 답변' && /직원\(오피스\)/.test(d2.who || '') && d2.handled, `[${label}] 답 뒤 상태 「${d2.badge}」 · 보낸 사람 표시 「${d2.who}」 · [처리함] 꺼짐`);
            // ⑨ 처리함
            await openThread(pg, 3);
            await pg.click('#sms-handled'); await pg.waitForTimeout(1200);
            log = await logOf();
            ok(log.length === 3 && log[2].action === 'handled' && log[2].id === 3 && (await pg.locator('#sms-th-badge').innerText()) === '직원 답변' && T.some(t => /처리함으로 표시/.test(t)), `[${label}] [처리함] → handled 도착 · 상태 직원 답변 · 안내 띠`);
            ok((await pg.locator('#sms-chip-n').innerText()) === '1', `[${label}] 알약 숫자 1 로 줄어듦`);
            // ⑩ 적던 글 지키기 · 실패 표시 · 끝내기
            await openThread(pg, 11);
            const fl = await pg.evaluate(() => { const m = document.querySelector('#sms-msgs .sms-msg[data-s="failed"]'); return m ? m.querySelector('small').textContent : ''; });
            ok(/보내지 못함/.test(fl), `[${label}] 못 나간 답 표시 「${fl}」`);
            await pg.fill('#sms-text', '적다 만 글'); await openThread(pg, 4); await openThread(pg, 11);
            ok((await pg.locator('#sms-text').inputValue()) === '적다 만 글', `[${label}] 다른 대화를 봤다 와도 적던 글 그대로`);
            await mock('/__mock/set', { fail: 'reply' });
            await pg.click('#sms-send'); await pg.waitForTimeout(1100);
            ok(T.some(t => /답을 보내지 못했어요/.test(t)) && (await pg.locator('#sms-text').inputValue()) === '적다 만 글', `[${label}] 보내기 실패 → 안내 띠 · 적은 글 안 지워짐`);
            await mock('/__mock/set', { fail: '' });
            await pg.fill('#sms-text', '');
            const before = (await logOf()).length;
            await pg.click('#sms-end'); await pg.waitForTimeout(1200);
            log = await logOf();
            ok(log.length === before + 1 && log[log.length - 1].action === 'close' && log[log.length - 1].id === 11 && !(await pg.locator('#sms-thread').count()) && (await pg.locator('.sms-item[data-id="11"] .desk-badge').innerText()) === '끝난 대화', `[${label}] [대화 끝내기] → close 도착 · 대화 접힘 · 「끝난 대화」`);
            // ⑪ Esc · 바깥 누름
            await openThread(pg, 4); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
            ok(!(await pg.locator('#sms-thread').count()) && await pg.locator('#desk-sms').isVisible(), `[${label}] Esc → 대화만 접힘(카드는 그대로)`);
            if (phone) { await openThread(pg, 4); await pg.touchscreen.tap(195, 30); await pg.waitForTimeout(350); ok(!(await pg.locator('#sms-thread').count()), `[${label}] 시트 바깥(어두운 곳) 누름 → 접힘`); }
            // ⑫ 거르기 중 상태가 바뀐 대화는 맨 위에 남는다
            await mock('/__mock/reset', {}); await wake(pg);
            await pg.click('#sms-stat li[data-b="staff_needed"]'); await pg.waitForTimeout(600);
            await openThread(pg, 2); await pg.click('#sms-handled'); await pg.waitForTimeout(1300);
            const mv = await pg.evaluate(() => ({ th: !!document.getElementById('sms-thread'), moved: !!document.querySelector('#sms-list .sms-item.moved[data-id="2"]'), n: document.querySelectorAll('#sms-list .sms-item').length }));
            ok(mv.th && mv.moved && mv.n === 3, `[${label}] 「직원 몫」만 보다가 처리함 → 열어 둔 대화는 안 사라지고 안내와 함께 남음(${JSON.stringify(mv)})`);
            await pg.keyboard.press('Escape'); await pg.click('#sms-all'); await pg.waitForTimeout(500);
            // ⑬ 끊김 · 지금 챙길 일
            await mock('/__mock/set', { alive: false }); await wake(pg);
            const dd = await pg.evaluate(() => ({ note: document.getElementById('sms-note').textContent, k: document.getElementById('sms-note').dataset.k, hid: document.getElementById('sms-note').hidden, chip: document.getElementById('desk-sms-now').dataset.dead, todoDead: !!document.querySelector('#desk-board .sms-todo.dead'), todoNeed: (document.querySelector('#desk-board .sms-todo[data-sms="staff_needed"] b') || {}).textContent }));
            ok(!dd.hid && dd.k === 'err' && /연결이 끊겼어요/.test(dd.note) && /마지막 연결/.test(dd.note) && dd.chip === '1', `[${label}] 전달 앱 끊김 → 카드에 빨강 안내 · 알약 표시(${dd.note.slice(0, 34)}…)`);
            ok(dd.todoDead && dd.todoNeed === '3건', `[${label}] 「지금 챙길 일」에 끊김 한 줄 + 「문자 답할 것 ${dd.todoNeed}」`);
            await openThread(pg, 1);
            ok(/연결이 끊겨 있어요/.test(await pg.locator('#sms-warn').innerText()), `[${label}] 답 칸 위에 끊김 주의`);
            await pg.keyboard.press('Escape');
            await pg.click('#sms-close'); await pg.waitForTimeout(300);
            ok(!(await pg.locator('#desk-sms').isVisible()), `[${label}] [닫기] → 카드 닫힘`);
            if (await pg.locator('#desk-board-fold').isVisible() && await pg.evaluate(() => document.getElementById('desk-board').classList.contains('folded'))) { await pg.click('#desk-board-fold'); await pg.waitForTimeout(400); }
            await pg.locator('#desk-board .sms-todo[data-sms="staff_needed"]').scrollIntoViewIfNeeded();
            const tb = await box(pg, '#desk-board .sms-todo[data-sms="staff_needed"]');
            await pg.locator('#desk-board .sms-todo[data-sms="staff_needed"]').click(); await pg.waitForTimeout(800);
            const tg = await pg.evaluate(() => ({ vis: !document.getElementById('desk-sms').hidden, pressed: (document.querySelector('#sms-stat li[data-b="staff_needed"]') || { getAttribute: () => '' }).getAttribute('aria-pressed'), n: document.querySelectorAll('#sms-list .sms-item').length }));
            ok(tg.vis && tg.pressed === 'true' && tg.n === 2 && (!phone || (tb && tb.h >= 44)), `[${label}] 챙길 일 「문자 답할 것」 누름 → 문자 카드가 직원 몫만으로 열림(${JSON.stringify(tg)} · 줄 높이 ${tb ? tb.h : '?'})`);
            ok(await sw(pg) <= vw.width, `[${label}] 끝까지 가로 넘침 없음(${await sw(pg)})`);
            if (theme) { await openThread(pg, 3); const a = await H.audit(pg, '#desk-sms, #desk-board .desk-todo'); ok(a.fails.length === 0, `[${label}] 끊김 안내·챙길 일 줄까지 야간 대비 미달 0(글자 ${a.texts}개${a.fails.length ? ' · ' + a.fails.slice(0, 4).join(' / ') : ''})`); await pg.keyboard.press('Escape'); }
            // ⑭ 꺼짐 · 모드 칩 · counts 없는 서버
            await mock('/__mock/set', { alive: true, enabled: false, mode: 'record', counts: false }); await wake(pg);
            const off = await pg.evaluate(() => ({ note: document.getElementById('sms-note').textContent, mode: document.getElementById('sms-mode').textContent, todo: document.querySelectorAll('#desk-board .sms-todo').length, cells: Array.from(document.querySelectorAll('#sms-stat li b')).map(b => b.textContent).join(',') }));
            ok(/연동이 꺼져 있어요/.test(off.note) && off.mode === '기록만' && off.todo === 0, `[${label}] 꺼짐 안내 · 모드 「${off.mode}」 · 챙길 일 줄 없음`);
            await pg.click('#sms-all').catch(() => { }); await pg.waitForTimeout(700);
            const c2 = (await pg.locator('#sms-stat li b').allInnerTexts()).join(',');
            ok(c2 === '2,1,5,3', `[${label}] 요약에 counts 가 없어도 숫자 칸은 목록으로 셈(${c2})`);
            ok(P.errors.length === 0, `[${label}] 화면 오류 ${P.errors.length}${P.errors.length ? ' · ' + P.errors.slice(0, 2).join(' / ') : ''}`);
            await P.ctx.close();
        }
        {   // 문자 라우트가 없는 서버(배포 전 · 종전 서버) → 알약이 안 보이고 다른 알약은 그대로
            console.log('\n── 문자 라우트 없는 서버');
            await mock('/__mock/reset', {});
            const P = await open(PC, false, null, pg => pg.route('**/api/sms/**', r => r.fulfill({ status: 404, contentType: 'text/html', body: '<pre>Cannot GET</pre>' })));
            const g = await P.pg.evaluate(() => ({ sms: document.getElementById('desk-sms-now').hidden, chips: Array.from(document.querySelectorAll('.desk-quick2 .desk-chip')).filter(b => !b.hidden).map(b => b.textContent.trim()), card: document.getElementById('desk-sms').hidden, todo: document.querySelectorAll('.sms-todo').length }));
            ok(g.sms && g.card && g.todo === 0 && g.chips.join('|') === '중간발주|최종발주|정산 이미지|배송조회 확인하기|전체 가격 확인하기', `[없는 서버] 알약 숨김 · 종전 알약 4개 그대로(${g.chips.join('|')})`);
            await P.pg.waitForTimeout(3000);
            ok(P.sms.length <= 1 && P.errors.length === 0, `[없는 서버] 요약은 한 번만 물어보고 그만둠(${P.sms.length}회) · 화면 오류 ${P.errors.length}`);
            await P.pg.click('#desk-ship-now'); await P.pg.waitForTimeout(400);
            ok(await P.pg.locator('#desk-ship').isVisible(), '[없는 서버] 배송조회 카드는 종전대로 열림');
            await P.ctx.close();
        }
        {   // 도구 카드는 한 번에 하나
            console.log('\n── 다른 도구 카드와 함께');
            await mock('/__mock/reset', {});
            const P = await open(PC, false, null), pg = P.pg;
            await pg.click('#desk-sms-now'); await pg.waitForTimeout(500); await openThread(pg, 1);
            await pg.click('#desk-ship-now'); await pg.waitForTimeout(500);
            ok(await pg.locator('#desk-ship').isVisible() && !(await pg.locator('#desk-sms').isVisible()), '[도구] 배송조회를 열면 문자 카드는 닫힘');
            await pg.click('#desk-sms-now'); await pg.waitForTimeout(600);
            ok(await pg.locator('#desk-sms').isVisible() && !(await pg.locator('#desk-ship').isVisible()) && await rows(pg) === 12, '[도구] 문자를 다시 열면 배송조회가 닫히고 목록이 뜸');
            await pg.click('#desk-sms-now'); await pg.waitForTimeout(300);
            ok(!(await pg.locator('#desk-sms').isVisible()), '[도구] 알약을 한 번 더 누르면 닫힘');
            // 알림 link(agent-office?sms=ID) → app.js 가 부를 함수 = window.AkmAoDesk.openSms(id)
            ok(await pg.evaluate(() => typeof window.AkmAoDesk.openSms === 'function' && typeof window.AkmAoDesk.open === 'function'), '[알림] window.AkmAoDesk.openSms 있음(종전 open 도 그대로)');
            const o1 = await pg.evaluate(() => window.AkmAoDesk.openSms(3)); await pg.waitForTimeout(700);
            const g1 = await pg.evaluate(() => ({ card: !document.getElementById('desk-sms').hidden, open: (document.getElementById('sms-thread') || { closest: () => ({ dataset: {} }) }).closest('.sms-item').dataset.id, bub: document.querySelectorAll('#sms-msgs .sms-bub').length, pick: document.querySelectorAll('#sms-stat li[aria-pressed="true"]').length }));
            ok(o1 === true && g1.card && g1.open === '3' && g1.bub >= 2 && g1.pick === 0, `[알림] 카드가 닫혀 있어도 openSms(3) → 카드 열림 · 그 대화 펼침(${JSON.stringify(g1)})`);
            const o2 = await pg.evaluate(() => window.AkmAoDesk.openSms(8)); await pg.waitForTimeout(700);
            ok(o2 === true && await pg.evaluate(() => document.getElementById('sms-thread').closest('.sms-item').dataset.id === '8' && document.querySelectorAll('#sms-thread').length === 1), '[알림] 다른 대화가 열려 있을 때 openSms(8) → 그 대화로 바뀜(한 개만 열림)');
            const o3 = await pg.evaluate(() => window.AkmAoDesk.openSms(8)); await pg.waitForTimeout(400);
            ok(o3 === true && await pg.evaluate(() => !!document.getElementById('sms-thread')), '[알림] 이미 열린 대화를 또 부르면 그대로 열려 있음(접히지 않음)');
            await pg.click('#sms-stat li[data-b="staff_needed"]'); await pg.waitForTimeout(500);
            const o4 = await pg.evaluate(() => window.AkmAoDesk.openSms(10)); await pg.waitForTimeout(700);
            ok(o4 === true && await pg.evaluate(() => document.getElementById('sms-thread').closest('.sms-item').dataset.id === '10' && document.querySelectorAll('#sms-list .sms-item').length === 12), '[알림] 거르기 중이어도 openSms(10) → 전체로 풀고 그 대화(끝난 대화)까지 열림');
            const o5 = await pg.evaluate(() => window.AkmAoDesk.openSms(9999)), o6 = await pg.evaluate(() => window.AkmAoDesk.openSms('x'));
            ok(o5 === false && o6 === false && await pg.locator('#desk-sms').isVisible(), '[알림] 없는 번호·틀린 값 → false(카드만 열린 채 · 오류 없음)');
            // 직원 몫 0 · 초안만 있을 때: 알약 숫자·챙길 일 줄이 초안 대기로
            await pg.keyboard.press('Escape'); await pg.click('#sms-close');
            for (const id of [2, 3, 11]) await fetch(BASE + '/api/sms/threads/' + id + '/handled', { method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: '{}' });
            await wake(pg);
            const dr = await pg.evaluate(() => ({ chip: document.getElementById('sms-chip-n').textContent, hid: document.getElementById('sms-chip-n').hidden, label: document.getElementById('desk-sms-now').getAttribute('aria-label'), todo: (document.querySelector('#desk-board .sms-todo') || { dataset: {} }).dataset.sms, todoText: (document.querySelector('#desk-board .sms-todo') || { textContent: '' }).textContent }));
            ok(dr.chip === '1' && !dr.hid && /초안 대기 1/.test(dr.label) && dr.todo === 'draft' && /1건/.test(dr.todoText), `[초안만] 직원 몫 0 · 초안 대기 1 → 알약 숫자 1 · 챙길 일 줄은 초안 대기로 열림(${dr.label})`);
            if (await pg.locator('#desk-board-fold').isVisible() && await pg.evaluate(() => document.getElementById('desk-board').classList.contains('folded'))) { await pg.click('#desk-board-fold'); await pg.waitForTimeout(300); }
            await pg.locator('#desk-board .sms-todo').click(); await pg.waitForTimeout(700);
            ok(await pg.evaluate(() => (document.querySelector('#sms-stat li[data-b="draft"]') || { getAttribute: () => '' }).getAttribute('aria-pressed') === 'true' && document.querySelectorAll('#sms-list .sms-item').length === 1 && document.querySelector('#sms-list .sms-item').dataset.st === 'draft'), '[초안만] 챙길 일 줄 누름 → 「초안 대기」만 1줄');
            ok(P.errors.length === 0, `[도구] 화면 오류 ${P.errors.length}`);
            await P.ctx.close();
        }
    } finally { await browser.close().catch(() => { }); srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
