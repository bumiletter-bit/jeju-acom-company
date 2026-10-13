// #683 문자 대화 「○○님이 입력 중..」 화면 검증 — 가짜 서버(scripts/_mock-610.js · DB·외부 호출 0)에 브라우저 두 계정(A 시험직원 · B 김대리)을 띄워 실제로 친다
//   사용: node scripts/verify-683-typing.js   (포트 PORT683 · 없으면 3465 · 다른 Playwright 검증과 동시에 돌리지 말 것 · ONLY683=pc,fold,phone,phone-dark,pc-dark)
//   A 침 → B 답 칸 위 한 줄·목록 줄 · A 화면엔 자기 이름 없음 · 둘 다 침 → 양쪽 주황 띠 (2명) · 3명 · 보냄/빈 칸/닫음/시간 지남 = 풀림 · 막는 것 없음 · 옛 서버(404) = 표시 없음·다시 안 물음 · 답 칸 제자리
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT683 || 3465), BASE = 'http://localhost:' + PORT;
let pass = 0, fail = 0; const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : '  FAIL ') + m + (!c && x ? ' :: ' + x : '')); };
const J = v => JSON.stringify(v);
const mock = async (p, body) => (await fetch(BASE + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TH = 2;   // 초안 없는 사람 몫 대화

(async () => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-610.js'), String(PORT)], { stdio: ['ignore', 'ignore', 'inherit'] });
    let up = false; for (let i = 0; i < 40 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/__mock/log')).ok; } catch (e) { /* 아직 */ } }
    if (!up) { srv.kill(); throw new Error('가짜 서버가 안 떴어요(포트 ' + PORT + ')'); }
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const open = async (vw, touch, theme, who) => {
        const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'no-preference' }, touch ? { isMobile: vw.width < 700, hasTouch: true } : {}));
        const pg = await ctx.newPage(); const errors = [], toasts = [];
        pg.on('pageerror', e => errors.push(String(e)));
        await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([w, th]) => { localStorage.setItem('jwt_token', 'mock.token.' + w.k); localStorage.setItem('jwt_user', JSON.stringify({ id: w.id, name: w.name, position: '대리', role: 'user' })); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, [who, theme]);
        await pg.exposeFunction('__toast', t => toasts.push(t));
        await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1800);
        await pg.evaluate(() => { const mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && /toast/i.test(n.className || '')) window.__toast(n.textContent.trim()); }))); mo.observe(document.body, { childList: true, subtree: true }); });
        return { pg, ctx, errors, toasts };
    };
    const A_ = { k: 'u8', id: 8, name: '시험직원' }, B_ = { k: 'u9', id: 9, name: '김대리' };
    const go = async (P, id) => { await P.pg.evaluate(i => window.AkmAoDesk.openSms(i), id); await P.pg.waitForFunction(i => { const t = document.getElementById('sms-thread'); return t && t.dataset.id === String(i) && document.querySelector('#sms-msgs .sms-msg'); }, id, { timeout: 8000 }).catch(() => { }); await P.pg.waitForTimeout(500); };
    const st = P => P.pg.evaluate(id => { const el = document.getElementById('sms-typing'), ta = document.getElementById('sms-text'), sd = document.getElementById('sms-send'), ms = document.getElementById('sms-msgs'), row = document.querySelector('#sms-list .sms-item[data-id="' + id + '"] .sms-typ');
        const vis = !!el && !el.hidden && el.getClientRects().length > 0, r = vis ? el.getBoundingClientRect() : null, tr = ta ? ta.getBoundingClientRect() : null, mr = ms ? ms.getBoundingClientRect() : null, last = ms && ms.lastElementChild ? ms.lastElementChild.getBoundingClientRect() : null, dot = el && el.querySelector('.sms-typing-d i');
        return { vis, text: vis ? el.textContent.trim() : '', k: el ? el.dataset.k || '' : '', live: el ? el.getAttribute('aria-live') : '', fs: vis ? parseFloat(getComputedStyle(el).fontSize) : 0, h: r ? Math.round(r.height) : 0, color: vis ? getComputedStyle(el).color : '', bg: vis ? getComputedStyle(el).backgroundColor : '', anim: dot ? getComputedStyle(dot).animationName : '', dots: el ? el.querySelectorAll('.sms-typing-d i').length : 0,
            row: row ? row.textContent.trim() : '', rowFs: row ? parseFloat(getComputedStyle(row).fontSize) : 0, taTop: tr ? Math.round(tr.top) : -1, taH: tr ? Math.round(tr.height) : -1, sendBottom: sd ? Math.round(sd.getBoundingClientRect().bottom) : -1, above: r && tr ? r.bottom <= tr.top + 1 : null, below: r && mr ? r.top >= mr.bottom - 1 : null, lastIn: last && mr ? last.bottom <= mr.bottom + 1 && last.top >= mr.top - 1 : null, sendOff: sd ? sd.disabled : null, val: ta ? ta.value : '', over: document.documentElement.scrollWidth, vw: window.innerWidth, ih: window.innerHeight }; }, TH);
    const until = async (P, fn, ms) => { const t0 = Date.now(); let s; do { s = await st(P); if (fn(s)) return { s, ms: Date.now() - t0 }; await sleep(200); } while (Date.now() - t0 < (ms || 6000)); return { s, ms: -1 }; };
    const type = async (P, text) => { await P.pg.locator('#sms-text').click(); await P.pg.keyboard.type(text, { delay: 30 }); };
    const clear = async P => { await P.pg.locator('#sms-text').click(); await P.pg.keyboard.press('Control+A'); await P.pg.keyboard.press('Backspace'); };
    const posts = async () => (await mock('/__mock/log')).typPosts;

    try {
        const VIEWS = [['pc', { width: 1440, height: 900 }, false, null, true], ['fold', { width: 900, height: 1000 }, true, null, false], ['phone', { width: 360, height: 740 }, true, null, false], ['phone-dark', { width: 360, height: 740 }, true, 'dark', false], ['pc-dark', { width: 1440, height: 900 }, false, 'dark', false]].filter(v => !process.env.ONLY683 || process.env.ONLY683.split(',').includes(v[0]));
        for (const [name, vw, touch, theme, full] of VIEWS) {
            console.log('\n── ' + name);
            await mock('/__mock/reset', {}); await mock('/__mock/set', { noTyping: false, typTtl: 30 });
            const A = await open(vw, touch, theme, A_), B = await open(vw, touch, theme, B_);
            await go(A, TH); await go(B, TH);
            const a0 = await st(A), b0 = await st(B);
            ok(!a0.vis && !b0.vis && !a0.row && !b0.row && b0.live === 'polite', `[${name}] 아무도 안 치면 표시 없음(답 칸 위 한 줄·목록 줄 모두) · aria-live=polite`, J([a0.vis, b0.vis, b0.row, b0.live]));

            // ① A 가 친다 → B 화면에 「시험직원님이 입력 중..」 + 목록 줄 「시험직원 입력 중」 · A 화면엔 자기 이름 없음 · B 답 칸 제자리
            await type(A, '확인해 보겠습니다');
            const b1 = await until(B, s => s.vis && !!s.row), a1 = await st(A);
            ok(b1.s.vis && b1.s.text === '시험직원님이 입력 중..' && b1.s.k === 'one' && b1.s.dots === 3 && b1.s.row === '시험직원 입력 중' && b1.ms >= 0 && b1.ms <= 4500, `[${name}] A 가 치면 B 답 칸 위에 「${b1.s.text}」(점 ${b1.s.dots}개) · 목록 줄 「${b1.s.row}」 · ${b1.ms}ms 안`, J(b1));
            ok(!a1.vis && !a1.row, `[${name}] 치는 A 화면에는 자기 이름이 안 뜸(답 칸 위·목록 줄)`, J([a1.vis, a1.text, a1.row]));
            ok(b1.s.fs >= 11 && b1.s.fs <= 12 && b1.s.rowFs >= 11 && b1.s.rowFs <= 12 && b1.s.h <= 24 && b1.s.above && b1.s.below && b1.s.lastIn && b1.s.taTop === b0.taTop && b1.s.taH === b0.taH && b1.s.sendBottom === b0.sendBottom && b1.s.sendBottom <= b1.s.ih + 1 && b1.s.over <= b1.s.vw && (theme ? true : b1.s.anim === 'sms-typing'), `[${name}] 한 줄 ${b1.s.h}px · 글자 ${b1.s.fs}px(목록 ${b1.s.rowFs}px) · 대화 글 아래·답 칸 위 · 마지막 글 보임 · 답 칸 자리 그대로(${b0.taTop} → ${b1.s.taTop}) · 가로 넘침 0${theme ? '' : ' · 점 깜빡임 ' + b1.s.anim}`, J([b0, b1.s]));

            // ② B 도 친다(막는 것 없음) → B 는 응답으로 바로 주황 띠 · A 도 다음 조회에 주황 띠
            await type(B, '제가 답할게요');
            const b2 = await until(B, s => s.k === 'both', 2500), a2 = await until(A, s => s.k === 'both', 5000);
            ok(b2.s.val === '제가 답할게요' && !b2.s.sendOff && b2.s.text === '⚠ 시험직원님도 같이 작성 중입니다 (2명)' && b2.ms >= 0 && b2.ms <= 1500, `[${name}] 표시가 떠 있어도 B 는 그대로 입력·[답 보내기] 켜짐 · 치자마자(${b2.ms}ms) 주황 띠 「${b2.s.text}」`, J(b2));
            ok(a2.s.text === '⚠ 김대리님도 같이 작성 중입니다 (2명)' && a2.ms >= 0 && a2.s.bg !== 'rgba(0, 0, 0, 0)' && a2.s.bg !== b1.s.bg && a2.s.above && a2.s.lastIn && a2.s.sendBottom === a0.sendBottom && a2.s.over <= a2.s.vw, `[${name}] 먼저 치던 A 화면에도 주황 띠 「${a2.s.text}」(${a2.ms}ms · 바탕 ${a2.s.bg}) · 답 칸 자리 그대로 · 마지막 글 보임`, J([a0.sendBottom, a2]));

            if (full) {
                // ③ 세 번째 사람
                await mock('/__mock/typing', { thread: TH, id: 7, name: '박주임' });
                const b3 = await until(B, s => /3명/.test(s.text), 5000);
                ok(/^⚠ (시험직원님·박주임님|박주임님·시험직원님)도 같이 작성 중입니다 \(3명\)$/.test(b3.s.text) && b3.s.h <= 40 && b3.s.over <= b3.s.vw, `[${name}] 3명이면 「${b3.s.text}」`, J(b3));
                await mock('/__mock/typing', { thread: TH, id: 7, on: false });
                // ④ B 가 보낸다 → 종전대로 나감 · A 화면 띠 사라짐(혼자 치는 중 = 표시 없음)
                await B.pg.click('#sms-send'); await B.pg.waitForTimeout(1200);
                const log = (await mock('/__mock/log')).log.filter(l => l.action === 'reply' && l.id === TH), a4 = await until(A, s => !s.vis, 5000), b4 = await until(B, s => s.text === '시험직원님이 입력 중..', 6000);
                ok(log.length === 1 && log[0].body.text === '제가 답할게요' && B.toasts.some(t => /답을 보냈어요/.test(t)) && !a4.s.vis && a4.ms >= 0 && b4.s.text === '시험직원님이 입력 중..', `[${name}] B 가 [답 보내기] → 종전대로 나감 · A 화면 주황 띠 사라짐(${a4.ms}ms) · B 화면은 「${b4.s.text}」로`, J([log.length, a4, b4.s.text]));
                // ⑤ A 가 답 칸을 비운다 → 풀림
                await clear(A); const b5 = await until(B, s => !s.vis && !s.row, 5000); const p5 = (await posts()).filter(x => x.id === 8).pop();
                ok(!b5.s.vis && !b5.s.row && b5.ms >= 0 && p5 && p5.on === false, `[${name}] A 가 답 칸을 비우면 꺼짐 신호 → B 화면 표시·목록 줄 사라짐(${b5.ms}ms)`, J([b5, p5]));
                // ⑥ A 가 치다 대화를 닫는다 → 풀림
                await type(A, '다시'); await until(B, s => s.vis, 5000);
                await A.pg.keyboard.press('Escape'); const b6 = await until(B, s => !s.vis, 5000); const p6 = (await posts()).filter(x => x.id === 8).pop();
                ok(!b6.s.vis && b6.ms >= 0 && p6.on === false, `[${name}] A 가 대화를 닫으면 꺼짐 신호 → B 화면 표시 사라짐(${b6.ms}ms)`, J([b6.ms, p6]));
                // ⑦ 치다 멈춤 → 시간이 지나면 풀림(가짜 서버 유효 시간 4초로 줄여서) · 손님 새 글이 와도 누가 안 치면 표시 없음
                await mock('/__mock/set', { typTtl: 4 }); await go(A, TH); await clear(A); await type(A, '음'); const b7a = await until(B, s => s.vis, 5000); const b7 = await until(B, s => !s.vis, 9000);
                await mock('/__mock/push', { id: TH, text: '아직인가요?' }); await B.pg.waitForTimeout(4000); const b7c = await st(B);
                ok(b7a.s.vis && !b7.s.vis && b7.ms >= 0 && !b7c.vis && !b7c.row, `[${name}] 치다 멈추면 유효 시간 뒤 저절로 풀림(${b7.ms}ms) · 그 뒤 손님 새 글이 와도 표시 없음`, J([b7a.s.vis, b7.ms, b7c.vis]));
                await mock('/__mock/set', { typTtl: 30 });
                // ⑧ 신호 주기: 20초 동안 쉬지 않고 침 → 켜짐 신호 수(1분 = ×3)
                await clear(A); const n0 = (await posts()).length, t0 = Date.now();
                await A.pg.locator('#sms-text').click(); while (Date.now() - t0 < 20000) { await A.pg.keyboard.type('가'); await sleep(350); }
                const on20 = (await posts()).slice(n0).filter(x => x.id === 8 && x.on).length;
                ok(on20 >= 4 && on20 <= 7, `[${name}] 20초 동안 계속 치면 켜짐 신호 ${on20}번(4초에 1번 · 1분이면 약 ${on20 * 3}번)`, String(on20));
                // ⑨ 조회 주기: 문자 창이 보이는 동안 약 3초마다 · 창을 닫으면 멈춤
                const g0 = (await mock('/__mock/log')).typGets; await sleep(9000); const g1 = (await mock('/__mock/log')).typGets;
                await A.pg.evaluate(() => document.getElementById('sms-close').click()); await B.pg.evaluate(() => document.getElementById('sms-close').click()); await sleep(1500);
                const g2 = (await mock('/__mock/log')).typGets; await sleep(7000); const g3 = (await mock('/__mock/log')).typGets;
                ok(g1 - g0 >= 4 && g1 - g0 <= 8 && g3 === g2, `[${name}] 조회 = 두 화면 9초에 ${g1 - g0}번(화면당 약 3초에 1번) · 창을 닫으면 멈춤(7초 동안 ${g3 - g2}번)`, J([g0, g1, g2, g3]));
                // ⑩ 초안 대화: 열기만 하고 [이대로 보내기]를 눌러도 신호 없음 · 초안을 손으로 고치면 신호
                const n1 = (await posts()).length; await go(A, 1); await A.pg.waitForTimeout(800); const d1 = (await posts()).slice(n1).filter(x => x.tid === 1 && x.on).length;
                await A.pg.locator('#sms-text').click(); await A.pg.keyboard.press('End'); await A.pg.keyboard.type(' 감사합니다'); await sleep(600); const d2 = (await posts()).slice(n1).filter(x => x.tid === 1 && x.on).length;
                ok(d1 === 0 && d2 === 1, `[${name}] 초안이 채워진 대화를 열기만 하면 신호 없음(${d1}) · 초안을 손으로 고치면 신호(${d2})`, J([d1, d2]));
                // ⑪ 옛 서버(404): 표시 없음 · 토스트·오류 0 · 다시 묻지 않음
                await mock('/__mock/reset', {}); await mock('/__mock/set', { noTyping: true }); await mock('/__mock/typing', { thread: TH, id: 7, name: '박주임' });
                const e0 = A.errors.length, tt0 = A.toasts.length; let req = 0; const cnt = r => { if (/\/typing/.test(r.url())) req++; }; A.pg.on('request', cnt);
                await A.pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await A.pg.waitForTimeout(1800); await go(A, TH); await type(A, '옛 서버에서도 답은 그대로'); await sleep(8000); const o1 = await st(A);
                await A.pg.click('#sms-send'); await A.pg.waitForTimeout(1200); const sent = (await mock('/__mock/log')).log.filter(l => l.action === 'reply' && l.id === TH).length; A.pg.off('request', cnt);
                ok(!o1.vis && !o1.row && A.errors.length === e0 && !A.toasts.slice(tt0).some(t => !/답을 보냈어요/.test(t)) && req <= 2 && sent === 1, `[${name}] 입력 중 라우트가 없는 서버(404) = 표시 없음 · 화면 오류 0 · 오류 토스트 0 · 8초 동안 요청 ${req}번뿐(다시 안 물음) · 답 보내기는 그대로`, J([o1.vis, A.errors.slice(e0), A.toasts.slice(tt0), req, sent]));
            }
            ok(A.errors.length === 0 && B.errors.length === 0, `[${name}] 화면 오류 0`, J(A.errors.concat(B.errors).slice(0, 3)));
            await A.ctx.close(); await B.ctx.close();
        }
    } catch (e) { fail++; console.log('  FAIL 중단: ' + (e && e.stack || e)); }
    finally { await browser.close(); srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})();
