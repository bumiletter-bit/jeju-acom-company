// #1109 화면 검증 — 문자·톡톡 답 칸 단추 한 줄 [지우기] [글자 수] [초안 만들기] [답 보내기]
//   가짜 서버 2개(scripts/_mock-610.js 문자 · scripts/_mock-658.js 톡톡 · DB·외부 호출 0) + Playwright 실클릭
//   폭 344(폴드7 접힘)·390(폰)·900·1280 × 밝음·야간 = 한 줄 · 44px · 답 보내기 가장 넓음 · 지우기 가장 좁음 · 넘침 0 · 오류 0 / 문자 [초안 만들기] 누름 → 만드는 중 → 칸 채움 · 재료 없음 안내 / 톡톡 [지우기]
//   실행: node scripts/verify-1109-ui.js   (포트 PORT1109 또는 3458·3459 · 다른 Playwright 검증과 동시에 돌리지 말 것)
const path = require('path'); const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const P1 = Number(process.env.PORT1109 || 3458), P2 = P1 + 1, B1 = 'http://localhost:' + P1, B2 = 'http://localhost:' + P2;
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (!c && d != null ? ' — ' + String(d).slice(0, 400) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (b, p, body) => fetch(b + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
const VW = [{ w: 344, h: 780, phone: true, n: '폴드7 접힘 344' }, { w: 390, h: 844, phone: true, n: '폰 390' }, { w: 900, h: 900, phone: false, n: '900' }, { w: 1280, h: 800, phone: false, n: 'PC 1280' }];
// 한 줄 재기: 단추들의 위·높이·폭 + 줄 넘침
const measure = (pg, ids) => pg.evaluate(ids => {
    const row = document.getElementById(ids.send).closest('.sms-reply-row'); const r0 = row.getBoundingClientRect();
    const box = id => { const n = document.getElementById(id); if (!n || !n.offsetParent) return null; const r = n.getBoundingClientRect(); return { t: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), x: Math.round(r.left), txt: n.textContent.trim(), dis: !!n.disabled }; };
    return { clear: box(ids.clear), len: box(ids.len), mk: box(ids.mk), send: box(ids.send), rowOver: row.scrollWidth - row.clientWidth, rowR: Math.round(r0.right), page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), vw: innerWidth };
}, ids);
function checkRow(m, label) {
    const btns = [m.clear, m.mk, m.send].filter(Boolean);
    ok(btns.length === 3, `${label}: 단추 3개 보임(지우기·초안 만들기·답 보내기)`, JSON.stringify(m));
    if (btns.length !== 3) return;
    ok(btns.every(b => Math.abs(b.t - m.send.t) <= 2), `${label}: 한 줄`, JSON.stringify(btns.map(b => b.t)));
    ok(btns.every(b => b.h >= 44), `${label}: 높이 44px 이상`, JSON.stringify(btns.map(b => b.h)));
    ok(m.clear.x < m.mk.x && m.mk.x < m.send.x, `${label}: 순서 = 지우기 → 초안 만들기 → 답 보내기`, JSON.stringify(btns.map(b => b.x)));
    ok(m.send.w > m.mk.w && m.send.w > m.clear.w && m.clear.w <= m.mk.w, `${label}: 답 보내기 가장 넓음 · 지우기 가장 좁음`, JSON.stringify(btns.map(b => b.w)));
    ok(m.mk.x - (m.clear.x + m.clear.w) >= 16 || (m.len && m.len.w > 0), `${label}: 지우기와 다음 단추 사이 16px 이상`, m.mk.x - (m.clear.x + m.clear.w));
    ok(m.rowOver <= 0 && m.page <= m.vw, `${label}: 넘침 0(줄 ${m.rowOver} · 화면 ${m.page}/${m.vw})`);
}
(async () => {
    const s1 = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-610.js'), String(P1)], { stdio: ['ignore', 'ignore', 'inherit'] });
    const s2 = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-658.js'), String(P2)], { stdio: ['ignore', 'ignore', 'inherit'] });
    let up = false; for (let i = 0; i < 40 && !up; i++) { await sleep(250); try { up = (await fetch(B1 + '/__mock/log')).ok && (await fetch(B2 + '/__mock/log')).ok; } catch (e) { } }
    const { chromium } = require('playwright'); const browser = await chromium.launch(); let code = 1;
    try {
        if (!up) throw new Error('가짜 서버가 안 떴어요');
        for (const theme of ['', 'dark']) for (const v of VW) {
            const L = `[문자 ${v.n}${theme ? ' 야간' : ''}]`;
            const ctx = await browser.newContext(Object.assign({ viewport: { width: v.w, height: v.h }, serviceWorkers: 'block', reducedMotion: 'reduce' }, v.phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
            await pg.goto(B1 + '/', { waitUntil: 'domcontentloaded' });
            await pg.evaluate(th => { localStorage.setItem('jwt_token', 'mock.token.610'); localStorage.setItem('jwt_user', JSON.stringify({ id: 8, name: '시험직원', position: '대리', role: 'user' })); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, theme);
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1600);
            await post(B1, '/__mock/reset'); await post(B1, '/__mock/set', { draftMs: 700, draftNo: false });
            await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(900);
            if (await pg.evaluate(() => { const m = document.getElementById('desk-plus'); return !!m && m.hidden; })) { await pg.click('#desk-plus-btn'); await pg.waitForTimeout(200); }
            await pg.click('#desk-sms-now'); await pg.waitForTimeout(900);   // 문자 창 열기(verify-610-ui plusGo 와 같은 길)
            await pg.locator('#sms-list .sms-item[data-id="6"] > .sms-row').click({ timeout: 5000 });
            await pg.waitForFunction(() => { const t = document.getElementById('sms-thread'); return t && t.dataset.id === "6" && document.getElementById("sms-mkdraft"); }, null, { timeout: 6000 });
            await pg.waitForTimeout(400);
            const ids = { clear: 'sms-clear', len: 'sms-len', mk: 'sms-mkdraft', send: 'sms-send' };
            const m0 = await measure(pg, ids); checkRow(m0, L);
            ok(m0.mk && m0.mk.txt === '초안 만들기' && m0.clear.dis && m0.send.dis, `${L} 처음 = 「초안 만들기」 · 칸 비어 지우기·답 보내기 꺼짐`, JSON.stringify(m0));
            await pg.click('#sms-mkdraft');
            await pg.waitForTimeout(250);
            const mid = await pg.evaluate(() => ({ t: document.getElementById('sms-mkdraft').textContent, busy: document.getElementById('sms-mkdraft').getAttribute('aria-busy'), dis: document.getElementById('sms-mkdraft').disabled }));
            ok(mid.t === '만드는 중…' && mid.busy === 'true' && mid.dis, `${L} 누르면 「만드는 중…」(aria-busy · 연타 막힘)`, JSON.stringify(mid));
            await pg.waitForFunction(() => /누름 초안입니다/.test((document.getElementById('sms-text') || {}).value || ''), null, { timeout: 6000 }).catch(() => { });
            const m1 = await measure(pg, ids); const v1 = await pg.inputValue('#sms-text');
            ok(/누름 초안입니다/.test(v1) && m1.mk.txt === '초안 다시 만들기' && !m1.send.dis && !m1.clear.dis && m1.send.txt === '이대로 보내기', `${L} 초안 = 칸 채움 · 「초안 다시 만들기」 · [이대로 보내기] 켜짐`, JSON.stringify([v1, m1.mk && m1.mk.txt, m1.send && m1.send.txt]));
            checkRow(m1, L + ' 초안 뒤');
            const lg = (await (await fetch(B1 + '/__mock/log')).json()).log.filter(x => x.action === 'draft');
            ok(lg.length === 1 && lg[0].id === 6, `${L} 서버 요청 = draft 1번(연타 0)`, JSON.stringify(lg));
            await pg.click('#sms-clear'); await pg.waitForTimeout(500);
            const lgc = (await (await fetch(B1 + '/__mock/log')).json()).log.filter(x => x.action === 'draft-clear');
            ok(await pg.inputValue('#sms-text') === '' && lgc.length === 1 && /누름 초안입니다/.test(lgc[0].body && lgc[0].body.seen) && await pg.evaluate(() => document.getElementById('sms-mkdraft').textContent) === '초안 만들기', `${L} [지우기] = 칸 비움 + 눌러 만든 서버 초안도 비움(draft-clear 1번 · 「초안 만들기」로)`, JSON.stringify(lgc));
            if (!theme && v.w === 1280) {   // #1109 자리표가 남아도 [답 보내기] 안 막음(대표) · 손으로 쓴 글을 [지우기] 하면 서버 초안 안 건드림
                await post(B1, '/__mock/set', { draftPh: true, draftMs: 50 }); await pg.click('#sms-mkdraft');
                await pg.waitForFunction(() => /0,000원/.test((document.getElementById('sms-text') || {}).value || ''), null, { timeout: 6000 }).catch(() => { });
                const ph = await pg.evaluate(() => ({ dis: document.getElementById('sms-send').disabled, w: document.getElementById('sms-warn').hidden ? '' : document.getElementById('sms-warn').textContent }));
                ok(!ph.dis && !/0,000원/.test(ph.w), `${L} 자리표 남은 초안도 [답 보내기] 켜짐 · 막기 안내 없음(대표 「우리가 수정해서 보낼 거야」)`, JSON.stringify(ph));
                await pg.fill('#sms-text', '네 고객님 포인트 3,000원 지급 도와드리겠습니다.'); await pg.waitForTimeout(150);
                ok(await pg.isEnabled('#sms-send') && await pg.evaluate(() => document.getElementById('sms-warn').hidden), `${L} 금액 채우면 켜짐 · 안내 사라짐`);
                const n0 = (await (await fetch(B1 + '/__mock/log')).json()).log.filter(x => x.action === 'draft-clear').length;
                await pg.click('#sms-clear'); await pg.waitForTimeout(400);
                const n1 = (await (await fetch(B1 + '/__mock/log')).json()).log.filter(x => x.action === 'draft-clear').length;
                ok(n1 === n0, `${L} 고친 글 [지우기] = 칸만(서버 초안 그대로 · 종전)`, n0 + '→' + n1);
                await post(B1, '/__mock/set', { draftPh: false });
            }
            if (v.phone) {   // 자판 열림(#1097 sms-ta-on)에서도 한 줄·44px
                await pg.focus('#sms-text'); await pg.waitForTimeout(300); checkRow(await measure(pg, ids), L + ' 답 칸 초점');
                await pg.evaluate(() => document.activeElement && document.activeElement.blur());
            }
            if (!theme && v.w === 1280) {   // 재료 없음 안내
                await post(B1, '/__mock/set', { draftNo: true, draftMs: 50 }); await pg.click('#sms-mkdraft'); await pg.waitForTimeout(900);
                const t = await pg.evaluate(() => [...document.querySelectorAll('.toast, .toast-message, [class*="toast"]')].map(n => n.textContent).join(' | '));
                ok(/재료가 없어요/.test(t) && await pg.isEnabled('#sms-mkdraft'), `${L} 재료 없음 = 안내 · 단추 다시 켜짐`, t);
                await post(B1, '/__mock/set', { draftNo: false });
            }
            ok(errs.length === 0, `${L} 화면 오류 0`, errs.join(' | '));
            await ctx.close();
        }
        // 톡톡
        for (const theme of ['', 'dark']) for (const v of VW) {
            const L = `[톡톡 ${v.n}${theme ? ' 야간' : ''}]`;
            const ctx = await browser.newContext(Object.assign({ viewport: { width: v.w, height: v.h } }, v.phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
            await post(B2, '/__mock/reset');
            await pg.goto(B2 + '/__inbox.html?ch=talk' + (theme ? '&theme=dark' : '')); if (theme) await pg.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
            await pg.waitForSelector('#inb-list .sms-item[data-id="t1"] .sms-row'); await pg.click('#inb-list .sms-item[data-id="t1"] .sms-row');
            await pg.waitForSelector('#inb-mkdraft', { timeout: 6000 }); await pg.waitForTimeout(300);
            const ids = { clear: 'inb-clear', len: 'inb-len', mk: 'inb-mkdraft', send: 'inb-send' };
            const m = await measure(pg, ids); checkRow(m, L);
            await pg.fill('#inb-text', '보낼 글'); await pg.waitForTimeout(100);
            ok(await pg.isEnabled('#inb-clear'), `${L} 글 있으면 [지우기] 켜짐`);
            await pg.click('#inb-clear'); await pg.waitForTimeout(150);
            ok(await pg.inputValue('#inb-text') === '' && await pg.isDisabled('#inb-clear'), `${L} [지우기] = 칸 비움 · 다시 꺼짐`);
            ok(errs.length === 0, `${L} 화면 오류 0`, errs.join(' | '));
            await ctx.close();
        }
        code = fail ? 1 : 0;
    } catch (e) { console.error(e); } finally { await browser.close(); s1.kill(); s2.kill(); }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(code);
})();
