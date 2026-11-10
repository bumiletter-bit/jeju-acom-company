// #1093 검증 — 문자 「손님 글」 띠 없앰 · 대화 말풍선·답 칸 글씨 75% (가짜 서버 scripts/_mock-610.js · 앱 공통 CSS 전부 실린 실제 화면 · DB·외부 0)
//   390·880·1280 × 밝음·야간 · 폰 자판 흉내(visualViewport) 1회 · 사용: node scripts/verify-1093-sms-font.js (포트 PORT1093 · 없으면 3463 · 다른 Playwright 와 동시에 돌리지 말 것)
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT1093 || 3463), BASE = 'http://localhost:' + PORT;
const USER = { id: 8, name: '시험직원', position: '대리', role: 'user' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };

(async () => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-610.js'), String(PORT)], { stdio: ['ignore', 'ignore', 'inherit'] });
    let up = false; for (let i = 0; i < 40 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/__mock/log')).ok; } catch (e) { /* 아직 */ } }
    if (!up) { srv.kill(); throw new Error('가짜 서버가 안 떴어요'); }
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const ALL = [[{ width: 390, height: 844 }, true, ''], [{ width: 390, height: 844 }, true, 'dark'], [{ width: 880, height: 900 }, false, ''], [{ width: 880, height: 900 }, false, 'dark'], [{ width: 1280, height: 900 }, false, ''], [{ width: 1280, height: 900 }, false, 'dark']];
    const cases = process.env.ALL1093 ? ALL : ALL.filter(([v, , t]) => !t && v.width !== 1280);   // #1094 작은 수정 = 390·880 밝음만(ALL1093=1 이면 전부)
    try {
        for (const [vw, phone, theme] of cases) {
            const label = vw.width + (theme ? ' 야간' : ' 밝음');
            const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errors = [];
            pg.on('pageerror', e => errors.push(String(e))); pg.on('dialog', d => d.dismiss().catch(() => { }));
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([u, th]) => { localStorage.setItem('jwt_token', 'mock.token.610'); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, [USER, theme]);
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1800);
            if (await pg.evaluate(() => { const m = document.getElementById('desk-plus'); return !!m && m.hidden; })) { await pg.click('#desk-plus-btn'); await pg.waitForTimeout(200); }
            await pg.click('#desk-sms-now'); await pg.waitForTimeout(900);   // [+] → 문자(verify-730 plusGo 꼴)
            await pg.waitForSelector('#sms-list .sms-item > .sms-row', { timeout: 8000 });
            const id = await pg.evaluate(() => (document.querySelector('#sms-list .sms-item[data-id="3"]') || document.querySelector('#sms-list .sms-item')).dataset.id);   // 3번 = 구매이력 여러 건(가짜 서버)
            await pg.locator(`#sms-list .sms-item[data-id="${id}"] > .sms-row`).click({ timeout: 4000 });
            await pg.waitForFunction(i => { const t = document.getElementById('sms-thread'); return t && t.dataset.id === String(i) && document.querySelectorAll('#sms-msgs .sms-bub').length > 0; }, id, { timeout: 6000 });
            await pg.waitForTimeout(400);
            const m = await pg.evaluate(() => {
                const fs = el => el ? parseFloat(getComputedStyle(el).fontSize) : null, lh = el => el ? getComputedStyle(el).lineHeight : null;
                const bub = document.querySelector('#sms-msgs .sms-msg.in .sms-bub') || document.querySelector('#sms-msgs .sms-bub'), out = document.querySelector('#sms-msgs .sms-msg.out .sms-bub');
                const ta = document.getElementById('sms-text'), time = document.querySelector('#sms-msgs .sms-msg small'), last = document.querySelector('#sms-list .sms-last');
                return { bub: fs(bub), bubLh: lh(bub), out: fs(out), ta: fs(ta), taLh: lh(ta), time: fs(time), last: fs(last), row: (() => { const r = document.querySelector('#sms-list .sms-item > .sms-row'); const g = q => { const e = r && r.querySelector(q); return e ? parseFloat(getComputedStyle(e).fontSize) : null; }; return { tail: g('.sms-tail'), hint: g('.sms-hint'), time: g('.sms-time'), last: g('.sms-last'), out: (() => { const e = document.querySelector('#sms-list .sms-out'); return e ? parseFloat(getComputedStyle(e).fontSize) : null; })() }; })(), q: (() => { const e = document.getElementById('sms-q'); return e ? parseFloat(getComputedStyle(e).fontSize) : null; })(), cust: !!document.getElementById('sms-cust'), dark: document.documentElement.dataset.aoTheme || '', sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) };
            });
            ok(m.bub === 11.6 && (m.out == null || m.out === 11.6), `[${label}] #1094 말풍선 글씨 11.6px = 14.5×0.8(손님 ${m.bub} · 우리·봇 ${m.out}) · 줄 간격 ${m.bubLh}`);
            ok(m.ta === (phone ? 12.8 : 11.6), `[${label}] #1094 답 칸 글씨 ${m.ta}px(기대 ${phone ? '12.8 = 16×0.8' : '11.6 = 14.5×0.8'}) · 줄 간격 ${m.taLh}`);
            ok(m.time === 11.5, `[${label}] 시간 글씨 그대로 11.5px(${m.time})`);
            console.log('     목록 줄 실측 = ' + JSON.stringify(m.row) + ' · 찾기 칸 ' + m.q + 'px');
            ok(m.row.tail === 11.6 && m.row.hint === 10.4 && m.row.time === 9.6 && m.row.last === 10.8 && (m.row.out == null || m.row.out === 10), `[${label}] #1094 목록 = 번호 11.6 · 요약 ${m.row.hint} · 시간 ${m.row.time} · 마지막 글 ${m.row.last} · 「나:」 ${m.row.out}(원래의 80%)`);
            ok(m.q != null && m.q >= 13, `[${label}] 찾기 칸 글씨 그대로(${m.q}px)`);
            ok(!m.cust, `[${label}] 「손님 글」 띠(#sms-cust) 없음`);
            ok(m.sw <= vw.width, `[${label}] 가로 넘침 없음(${m.sw} ≤ ${vw.width})`);
            if (theme) ok(m.dark === 'dark', `[${label}] 야간 테마 켜짐`);
            // 답 칸 초점 → 띠 안 뜸 · 자판 흉내(visualViewport 높이 줄이기) → sms-kb-on · 자동 높이 그대로
            await pg.focus('#sms-text'); await pg.waitForTimeout(300);
            ok(await pg.evaluate(() => !document.getElementById('sms-cust') && !document.querySelector('.sms-cust')), `[${label}] 답 칸 초점 때도 띠 없음`);
            if (phone && !theme) {
                const kb = await pg.evaluate(async () => {
                    const real = window.visualViewport, H = window.innerHeight - 330;
                    const fake = new EventTarget(); Object.defineProperties(fake, { height: { get: () => H }, width: { get: () => window.innerWidth }, offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 } });
                    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
                    real.dispatchEvent(new Event('resize')); fake.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize'));
                    await new Promise(r => setTimeout(r, 400));
                    const card = document.getElementById('desk-sms');
                    const ta = document.getElementById('sms-text'); ta.value = '줄1\n줄2\n줄3\n줄4\n줄5\n줄6\n줄7'; ta.dispatchEvent(new Event('input', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 200));
                    const od = document.getElementById('sms-order'), i0 = od && od.querySelector('.sms-buy-i'), ms = document.getElementById('sms-msgs');
                    const or = od ? od.getBoundingClientRect() : null, ir = i0 ? i0.getBoundingClientRect() : null;
                    return { on: card.classList.contains('sms-kb-on'), vh: card.style.getPropertyValue('--sms-vh'), taH: Math.round(ta.getBoundingClientRect().height), lh: parseFloat(getComputedStyle(ta).lineHeight),
                        od: od ? { h: Math.round(or.height), sh: od.scrollHeight, ch: od.clientHeight, mh: getComputedStyle(od).maxHeight, cls: od.className, more: !!od.querySelector('#sms-buy-more') } : null,
                        i0: ir ? { top: Math.round(ir.top - or.top), h: Math.round(ir.height), cut: ir.bottom > or.bottom + 1 } : null, msgsH: ms ? Math.round(ms.getBoundingClientRect().height) : null };
                });
                console.log('     자판 흉내 실측 = ' + JSON.stringify({ 구매이력: kb.od, 첫카드: kb.i0, 대화칸높이: kb.msgsH }));
                ok(kb.od && kb.od.mh !== '44px', `[${label}] 자판 때 구매이력 44px 고정 없음(max-height ${kb.od && kb.od.mh})`);
                ok(!kb.i0 || !kb.i0.cut, `[${label}] 자판 때 구매이력 최근 1건 카드 안 잘림(카드 ${kb.i0 && kb.i0.h}px · 칸 ${kb.od && kb.od.h}px)`);
                ok(kb.on && kb.vh === (844 - 330) + 'px', `[${label}] 자판 흉내 → sms-kb-on · 창 높이 ${kb.vh}`);
                ok(kb.taH > 60 && kb.taH <= Math.round(kb.lh * 4 + 40), `[${label}] 자판 때 답 칸 자동 높이 ≤ 4줄(${kb.taH}px · 줄 ${kb.lh}px)`);
            }
            ok(errors.length === 0, `[${label}] 페이지 오류 0${errors.length ? ' :: ' + errors.slice(0, 2).join(' | ') : ''}`);
            await ctx.close();
        }
    } finally { await browser.close(); srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
