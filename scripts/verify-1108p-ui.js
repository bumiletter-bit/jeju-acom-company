// #1108-③ 화면 검증(#1118 = 띠는 대표 계정만 · 관리자·직원은 안 뜸) — 톡톡·문자 답을 보낸 뒤 「포인트 지급 지시」 띠(금액·사유 미리 채움 · [지시 만들기] = 에이전트 오피스 지시 1건 · 1회용 · 금액 없으면 안 뜸)
//   가짜 서버 2개(scripts/_mock-658.js 톡톡 · scripts/_mock-610.js 문자 · DB·외부 호출 0) + Playwright 실클릭 · 폭 344·390·1280 (1280 은 밝음·야간)
//   실행: node scripts/verify-1108p-ui.js   (포트 PORT1108 또는 3458·3459)
const path = require('path'); const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const P1 = Number(process.env.PORT1108 || 3458), P2 = P1 + 1, BS = 'http://localhost:' + P1, BT = 'http://localhost:' + P2;
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (!c && d != null ? ' — ' + String(d).slice(0, 400) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (b, p, body) => fetch(b + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
const orders = async b => ((await (await fetch(b + '/__mock/log')).json()).log || []).filter(x => x.action === 'order');
const OWNER = { id: 1, name: '대표', role: 'admin', position: '대표' }, WHO_NO = [{ n: '관리자', u: { id: 2, name: '관리자', role: 'admin', position: '팀장' } }, { n: '직원', u: { id: 8, name: '시험직원', role: 'user', position: '대리' } }];
const VW = [{ w: 344, h: 780, phone: true, n: '344', theme: '' }, { w: 390, h: 844, phone: true, n: '390', theme: '' }, { w: 1280, h: 800, phone: false, n: '1280', theme: '' }, { w: 1280, h: 800, phone: false, n: '1280 야간', theme: 'dark' }];
const band = pg => pg.evaluate(() => { const b = document.querySelector('.akm-point'); if (!b) return null; const q = s => b.querySelector(s); const r = s => { const n = q(s); if (!n) return null; const x = n.getBoundingClientRect(); return { h: Math.round(x.height), w: Math.round(x.width) }; };
    const ta = b.parentElement.querySelector('textarea'); return { amt: q('.akm-point-amt') && q('.akm-point-amt').value, why: q('.akm-point-why') && q('.akm-point-why').value, note: (q('.akm-point-n') || {}).textContent || '', go: r('.akm-point-go'), x: r('.akm-point-x'), amtBox: r('.akm-point-amt'), beforeTa: !!ta && !!(b.compareDocumentPosition(ta) & Node.DOCUMENT_POSITION_FOLLOWING), txt: b.textContent, over: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth }; });
(async () => {
    const s1 = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-610.js'), String(P1)], { stdio: ['ignore', 'ignore', 'inherit'] });
    const s2 = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-658.js'), String(P2)], { stdio: ['ignore', 'ignore', 'inherit'] });
    let up = false; for (let i = 0; i < 40 && !up; i++) { await sleep(250); try { up = (await fetch(BS + '/__mock/log')).ok && (await fetch(BT + '/__mock/log')).ok; } catch (e) { } }
    const { chromium } = require('playwright'); const browser = await chromium.launch(); let code = 1;
    try {
        if (!up) throw new Error('가짜 서버가 안 떴어요');
        for (const v of VW) {
            // ── 톡톡
            { const L = `[톡톡 ${v.n}]`; await post(BT, '/__mock/reset');
              const ctx = await browser.newContext(Object.assign({ viewport: { width: v.w, height: v.h } }, v.phone ? { isMobile: true, hasTouch: true } : {})); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
              await ctx.addInitScript(u => { window.currentUser = u; }, OWNER);   // #1118 가짜 톡톡 창엔 app.js 가 없어 계정을 직접 둠
              await pg.goto(BT + '/__inbox.html?ch=talk'); if (v.theme) await pg.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
              await pg.waitForSelector('#inb-list .sms-item[data-id="t1"] .sms-row'); await pg.click('#inb-list .sms-item[data-id="t1"] .sms-row'); await pg.waitForSelector('#inb-text');
              // 금액 없는 글 = 띠 없음
              await pg.fill('#inb-text', '네 고객님 소정의 포인트 넣어드렸어요 감사합니다'); await pg.click('#inb-send'); await pg.waitForTimeout(900);
              ok(!(await band(pg)), `${L} 금액 없는 글(소정의 포인트) = 띠 없음`);
              await pg.fill('#inb-text', '네 고객님 불편드려 죄송하구요, 네이버페이 포인트 3,000원 지급 도와드리겠습니다.'); await pg.click('#inb-send');
              await pg.waitForSelector('.akm-point', { timeout: 6000 }).catch(() => { });
              const b = await band(pg);
              ok(b && b.amt === '3,000' && /보상처리$/.test(b.why) && b.why.length <= 15 && b.beforeTa && !/💰/.test(b.txt), `${L} 보낸 뒤 띠 = 금액 3,000 미리 채움 · 사유 「…보상처리」 · 답 칸 위 · 이모지 없음`, JSON.stringify(b));
              ok(b && b.go.h >= 44 && b.x.h >= 44 && b.amtBox.h >= 44 && b.over <= 0, `${L} 단추·칸 44px · 넘침 0`, JSON.stringify(b && [b.go, b.x, b.amtBox, b.over]));
              await pg.fill('.akm-point-amt', '5000'); await pg.click('.akm-point-why'); await pg.fill('.akm-point-why', '타이벡 감귤 보상처리');
              const o0 = (await orders(BT)).length; await pg.click('.akm-point-go'); await pg.waitForTimeout(700);
              const os = await orders(BT), c = os.length ? String(os[os.length - 1].body.content) : '';
              ok(os.length === o0 + 1 && /^\[VM\] 포인트 보상 지급 · 톡톡 #\S+ · \d{1,2}\/\d{1,2} \d{2}:\d{2} 무렵 대화 · 톡톡 첫마디: .+ · 품목 .+ · 사유 타이벡 감귤 보상처리 · 5,000원$/.test(c), `${L} [지시 만들기] = 지시 1건(고친 금액 5,000 · 사유 · 줄번호·시각·첫마디·품목)`, c);
              const done = await pg.evaluate(() => (document.querySelector('.akm-point') || {}).textContent || '');
              ok(/지시를 만들었어요\(#\d+\)/.test(done), `${L} 만든 뒤 띠 = 「지시를 만들었어요(#번호)」`, done);
              await pg.waitForTimeout(3300); ok(!(await band(pg)), `${L} 3초 뒤 띠 사라짐`);
              ok(errs.length === 0, `${L} 화면 오류 0`, errs.join(' | ')); await ctx.close(); }
            // ── 문자
            { const L = `[문자 ${v.n}]`; await post(BS, '/__mock/reset');
              const ctx = await browser.newContext(Object.assign({ viewport: { width: v.w, height: v.h }, serviceWorkers: 'block', reducedMotion: 'reduce' }, v.phone ? { isMobile: true, hasTouch: true } : {})); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
              await pg.goto(BS + '/', { waitUntil: 'domcontentloaded' });
              await pg.evaluate(th => { localStorage.setItem('jwt_token', 'mock.token.610'); localStorage.setItem('jwt_user', JSON.stringify({ id: 8, name: '시험직원', position: '대리', role: 'user' })); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); sessionStorage.clear(); }, v.theme);
              await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1500);
              await pg.evaluate(u => Object.assign(currentUser, u), OWNER);   // #1118 가짜 서버 /api/auth/me 가 늘 직원을 돌려줘 화면 안에서 대표로
              if (await pg.evaluate(() => { const m = document.getElementById('desk-plus'); return !!m && m.hidden; })) { await pg.click('#desk-plus-btn'); await pg.waitForTimeout(200); }
              await pg.click('#desk-sms-now'); await pg.waitForTimeout(900);
              await pg.locator('#sms-list .sms-item[data-id="6"] > .sms-row').click({ timeout: 5000 }); await pg.waitForSelector('#sms-text');
              await pg.fill('#sms-text', '네 고객님 포인트 2천원 넣어드리겠습니다'); await pg.click('#sms-send');
              await pg.waitForSelector('.akm-point', { timeout: 6000 }).catch(() => { });
              const b = await band(pg);
              ok(b && b.amt === '2,000' && /^(하우스감귤|감귤) 보상처리$/.test(b.why) && /네이버 주문 손님만/.test(b.note) && b.beforeTa, `${L} 보낸 뒤 띠 = 2,000 · 사유 = 주문 줄 품목(하우스감귤 · 없으면 감귤)+보상처리 · 「네이버 주문 손님만」 한 줄`, JSON.stringify(b));
              ok(b && b.go.h >= 44 && b.x.h >= 44 && b.over <= 0, `${L} 44px · 넘침 0`, JSON.stringify(b && [b.go, b.x, b.over]));
              const o0 = (await orders(BS)).length; await pg.click('.akm-point-go'); await pg.waitForTimeout(700);
              const os = await orders(BS), c = os.length ? String(os[os.length - 1].body.content) : '';
              ok(os.length === o0 + 1 && /^\[VM\] 포인트 보상 지급 · 문자 보낸 번호 \d{3}-\d{3,4}-\d{4} · 사유 (하우스감귤|감귤) 보상처리 · 2,000원$/.test(c), `${L} [지시 만들기] = 지시 1건(번호·사유·금액)`, c);
              // [닫기] = 지시 0 · 같은 글로는 다시 안 뜸
              await pg.waitForTimeout(3300);
              await pg.fill('#sms-text', '포인트 1만원 지급 도와드리겠습니다'); await pg.click('#sms-send'); await pg.waitForSelector('.akm-point', { timeout: 6000 }).catch(() => { });
              const o1 = (await orders(BS)).length; await pg.click('.akm-point-x'); await pg.waitForTimeout(300);
              ok(!(await band(pg)) && (await orders(BS)).length === o1, `${L} [닫기] = 띠 사라짐 · 지시 0`);
              ok(errs.length === 0, `${L} 화면 오류 0`, errs.join(' | ')); await ctx.close(); }
        }
        // #1118 대표 아닌 계정(관리자·직원) = 금액 든 답을 보내도 띠 0 · 지시 0 (톡톡·문자 · 1280)
        for (const w of WHO_NO) {
            { await post(BT, '/__mock/reset'); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
              await ctx.addInitScript(u => { window.currentUser = u; }, w.u);
              await pg.goto(BT + '/__inbox.html?ch=talk'); await pg.waitForSelector('#inb-list .sms-item[data-id="t1"] .sms-row'); await pg.click('#inb-list .sms-item[data-id="t1"] .sms-row'); await pg.waitForSelector('#inb-text');
              await pg.fill('#inb-text', '네 고객님 네이버페이 포인트 3,000원 지급 도와드리겠습니다.'); await pg.click('#inb-send'); await pg.waitForTimeout(1500);
              ok(!(await band(pg)) && (await orders(BT)).length === 0 && errs.length === 0, `[톡톡 ${w.n}] 금액 든 답 보내도 띠 0 · 지시 0 · 오류 0`, errs.join(' | ')); await ctx.close(); }
            { await post(BS, '/__mock/reset'); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', reducedMotion: 'reduce' }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
              await pg.goto(BS + '/', { waitUntil: 'domcontentloaded' });
              await pg.evaluate(() => { localStorage.setItem('jwt_token', 'mock.token.610'); localStorage.setItem('jwt_user', JSON.stringify({ id: 8, name: '시험직원', position: '대리', role: 'user' })); localStorage.setItem('akm_last_page', 'agent-office'); localStorage.removeItem('akm_ao_theme'); sessionStorage.clear(); });
              await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1500);
              await pg.evaluate(u => Object.assign(currentUser, u), w.u);
              if (await pg.evaluate(() => { const m = document.getElementById('desk-plus'); return !!m && m.hidden; })) { await pg.click('#desk-plus-btn'); await pg.waitForTimeout(200); }
              await pg.click('#desk-sms-now'); await pg.waitForTimeout(900);
              await pg.locator('#sms-list .sms-item[data-id="6"] > .sms-row').click({ timeout: 5000 }); await pg.waitForSelector('#sms-text');
              await pg.fill('#sms-text', '네 고객님 포인트 2천원 넣어드리겠습니다'); await pg.click('#sms-send'); await pg.waitForTimeout(1500);
              ok(!(await band(pg)) && (await orders(BS)).length === 0 && errs.length === 0, `[문자 ${w.n}] 금액 든 답 보내도 띠 0 · 지시 0 · 오류 0`, errs.join(' | ')); await ctx.close(); }
        }
        code = fail ? 1 : 0;
    } catch (e) { console.error(e); } finally { await browser.close(); s1.kill(); s2.kill(); }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(code);
})();
