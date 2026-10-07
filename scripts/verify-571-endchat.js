// #571 검증: [채팅 종료] 확인을 PC 에서도 폰과 같게 — 누른 그 자리에서 [종료하기]·[취소]
//   종전: 답 상자가 없는 대화(최종발주 기록)는 넓은 확인 칸이 떠, PC 에서는 [종료]가 오른쪽으로 600px 넘게 떨어졌다(폰은 20px).
//   본다: PC 1440 · PC 1100 · 폰 390 에서 ①답 상자가 있는 대화 ②답 상자가 없는 대화(최종발주 기록) 둘 다
//     · [채팅 종료] 좌표 vs [종료하기] 좌표 거리 ≤ 버튼 높이 · [취소] → 원래 버튼으로 복귀(같은 자리) · [종료하기] → /hide-mine 요청(그 대화의 글 수만큼) · 넓은 확인 칸(옛 모양) 없음
//     · 밝은 화면 무회귀: 누르기 전 화면이 고치기 전 파일(BASE_REF)과 PNG 동일(이 수정은 눌렀을 때만 달라진다)
//   자료 = 가짜 대화(가로채기) · 쓰기 전부 가로챔(DB 쓰기 0) · 포트 3462(PORT571)
require('dotenv').config();
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn, execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const ROOT = path.join(__dirname, '..'), PORT = Number(process.env.PORT571) || 3462, BASE = `http://localhost:${PORT}`;
const BASE_REF = process.env.BASE_REF || '57292d2';   // 고치기 전 기준(#571 직전 커밋 — 커밋 뒤에도 같은 비교가 되게 고정)
const OLD = { 'ao-desk.js': execFileSync('git', ['show', BASE_REF + ':public/ao-desk.js'], { cwd: ROOT, maxBuffer: 1 << 26 }), 'ao-desk.css': execFileSync('git', ['show', BASE_REF + ':public/ao-desk.css'], { cwd: ROOT, maxBuffer: 1 << 26 }) };
const SHOT = (process.argv.slice(2).find(a => a.startsWith('--shot=')) || '').slice(7);
const results = []; const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 600) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const USER = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' };
const now = Date.parse('2026-10-07T03:00:00Z');
const O = (id, ago, content, extra) => Object.assign({ id, content, status: '완료', created_at: new Date(now - ago).toISOString(), processed_at: new Date(now - ago + 30e3).toISOString(), created_by: '전승범', created_by_id: USER.id, mine_hidden: false, has_image: false, file_name: null, reply_to: null, steps: [], result: { type: 'desk_answer', answer: `${id}번 답변입니다.` } }, extra || {});
const seed = () => [O(900, 5 * 60e3, '오늘 판매현황 알려줘'), O(901, 4 * 60e3, '황금향만 다시', { reply_to: 900 }),                 // 답 상자가 있는 대화(2차례)
    O(870, 40 * 60e3, '[최종발주] 10/7(수) 발송분 정리', { result: { type: 'desk_answer', answer: '대성 20박스 · 효돈 22박스' } }),   // 답 상자가 없는 대화
    O(860, 50 * 60e3, '지금 처리 중인 일', { status: '처리중', processed_at: null, result: null })];                                  // 진행 중 → [채팅 종료] 없음

(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] }); srv.stdout.on('data', () => { }); srv.stderr.on('data', () => { });
    let br;
    try {
        for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/public/version')).ok) break; } catch (_) { } await sleep(1000); }
        const { chromium } = require('playwright'); br = await chromium.launch();
        const open = async (vw, phone, old) => {
            const st = { orders: seed(), writes: [] };
            const ctx = await br.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errors = []; pg.on('pageerror', e => errors.push(String(e))); pg.on('dialog', d => d.dismiss().catch(() => { }));
            const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
            await pg.route('**/api/**', route => { const rq = route.request(), u = new URL(rq.url());
                if (rq.method() !== 'GET') { let body = null; try { body = JSON.parse(rq.postData() || 'null'); } catch (_) { } st.writes.push({ m: rq.method(), p: u.pathname, body }); const m = u.pathname.match(/\/orders\/(\d+)\/hide-mine$/); if (m) { const o = st.orders.find(x => x.id === Number(m[1])); if (o) o.mine_hidden = !!(body && body.hide); } return json(route, { ok: true }); }
                if (u.pathname === '/api/agent-office/desk/orders') { const hist = u.searchParams.get('history') === '1'; return json(route, { orders: st.orders.filter(o => hist || !o.mine_hidden), is_admin: true, more: false }); }
                if (/\/api\/agent-office\/(desk-status|desk\/board|desk\/inbox)/.test(u.pathname)) return route.continue();
                return route.continue(); });
            if (old) for (const f of Object.keys(OLD)) await pg.route('**/' + f + '*', route => route.fulfill({ status: 200, contentType: f.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8', body: OLD[f] }));
            const tok = jwt.sign(USER, 'verifytest', { expiresIn: '60m' });
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); localStorage.removeItem('akm_desk_view'); localStorage.setItem('akm_ao_theme', 'light'); }, [tok, USER]);
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(2000);
            await pg.evaluate(() => { if (typeof switchPage === 'function') switchPage('agent-office'); }); await pg.waitForTimeout(1200);
            await pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important} #desk-clock,#desk-date,.desk-caret,#desk-char{visibility:hidden!important} *{caret-color:transparent!important}' });
            return { pg, ctx, st, errors };
        };
        const rect = (pg, sel) => pg.evaluate(q => { const e = document.querySelector(q); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }, sel);
        const listShot = async pg => { await pg.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }); await pg.mouse.move(2, 2); await pg.waitForTimeout(250); let b = await pg.locator('#desk-list').screenshot({ animations: 'disabled' }); for (let i = 0; i < 5; i++) { await pg.waitForTimeout(300); const b2 = await pg.locator('#desk-list').screenshot({ animations: 'disabled' }); if (b2.equals(b)) break; b = b2; } return b; };

        for (const [dev, vw, phone] of [['PC 1440', { width: 1440, height: 1000 }, false], ['PC 1100', { width: 1100, height: 900 }, false], ['폰 390', { width: 390, height: 844 }, true]]) {
            // 밝은 화면 무회귀(누르기 전)
            const A = await open(vw, phone, true), B = await open(vw, phone, false);
            const a0 = await listShot(A.pg), b0 = await listShot(B.pg);
            ok(`[${dev}] 누르기 전 채팅 목록 = 고치기 전 파일과 PNG 동일`, a0.equals(b0), `${a0.length}b / ${b0.length}b`);
            await A.ctx.close();
            const P = B, pg = P.pg;
            const info = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#desk-list .desk-thread-box')].map(b => [b.dataset.th, { cbox: !!b.querySelector('.desk-cbox'), end: !!b.querySelector('[data-act="endchat"]') }])));
            ok(`[${dev}] 준비: 대화 3개 — 900(답 상자 있음 · 종료 버튼) · 870(최종발주 기록 = 답 상자 없음 · 종료 버튼) · 860(진행 중 = 종료 버튼 없음)`, info['900'] && info['900'].cbox && info['900'].end && info['870'] && !info['870'].cbox && info['870'].end && info['860'] && !info['860'].end, JSON.stringify(info));
            for (const [th, label, n] of [['900', '답 상자가 있는 대화', 2], ['870', '답 상자가 없는 대화(최종발주 기록)', 1]]) {
                const box = `#desk-list .desk-thread-box[data-th="${th}"]`;
                await pg.locator(box + ' [data-act="endchat"]').scrollIntoViewIfNeeded(); await pg.waitForTimeout(250);
                const e0 = await rect(pg, box + ' [data-act="endchat"]');
                if (phone) await pg.tap(box + ' [data-act="endchat"]'); else await pg.click(box + ' [data-act="endchat"]'); await pg.waitForTimeout(350);
                const y = await rect(pg, box + ' [data-act="hidethread"]'), no = await rect(pg, box + ' [data-act="endno"]');
                const st = await pg.evaluate(q => { const b = document.querySelector(q); const ask = b.querySelector('.desk-end-ask'); const yb = b.querySelector('[data-act="hidethread"]'); return { cls: ask && ask.className, role: ask && ask.getAttribute('role'), label: ask && ask.getAttribute('aria-label'), yes: yb && yb.textContent.trim(), yesCls: yb && yb.className, wide: !!b.querySelector('.desk-end-ask:not(.in)'), still: !!b.querySelector('[data-act="endchat"]'), focus: document.activeElement && document.activeElement.getAttribute('data-act') }; }, box);
                if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await pg.screenshot({ path: path.join(SHOT, `571-${dev.replace(/\s/g, '')}-${th}-확인.png`) }); }
                const dx = y && e0 ? Math.abs(y[0] - e0[0]) : 999, dy = y && e0 ? Math.abs(y[1] - e0[1]) : 999;
                // 누른 점([채팅 종료] 한가운데)이 [종료하기] 안에 있어야 손이 안 움직인다
                const cx = e0 ? e0[0] + e0[2] / 2 : -1, cy = e0 ? e0[1] + e0[3] / 2 : -1; const under = y && cx >= y[0] && cx <= y[0] + y[2] && cy >= y[1] && cy <= y[1] + y[3];
                ok(`[${dev}] ${label}: [채팅 종료]를 누른 그 자리에 [종료하기] — 좌표 차이 (${dx},${dy}) ≤ 버튼 높이 ${e0 ? e0[3] : '?'} · 누른 점이 [종료하기] 안`, !!y && dx <= e0[3] && dy <= e0[3] && under && st.yes === '종료하기' && /yes/.test(st.yesCls || '') && !st.still, `[채팅 종료] ${JSON.stringify(e0)} → [종료하기] ${JSON.stringify(y)} · [취소] ${JSON.stringify(no)}`);
                ok(`[${dev}] ${label}: 넓은 확인 칸(옛 모양) 없음 · 묶음 이름(aria-label)에 안내 유지 · 초점이 [종료하기]`, !st.wide && /desk-end-ask in/.test(st.cls || '') && st.role === 'group' && /이전 채팅 이력에서 다시 볼 수 있어요/.test(st.label || '') && st.focus === 'hidethread' && !!no && Math.abs(no[1] - y[1]) <= 2, JSON.stringify(st));
                // [취소] → 원래 버튼이 같은 자리로
                const w0 = P.st.writes.length; if (phone) await pg.tap(box + ' [data-act="endno"]'); else await pg.click(box + ' [data-act="endno"]'); await pg.waitForTimeout(300);
                const e1 = await rect(pg, box + ' [data-act="endchat"]');
                ok(`[${dev}] ${label}: [취소] → [채팅 종료]가 같은 자리로 돌아옴 · 요청 0`, JSON.stringify(e1) === JSON.stringify(e0) && !(await rect(pg, box + ' [data-act="hidethread"]')) && P.st.writes.length === w0, `${JSON.stringify(e0)} → ${JSON.stringify(e1)}`);
                // 같은 자리를 두 번 눌러 종료(좌표로 누른다 — 손이 안 움직여도 되는지)
                const tapAt = async () => { if (phone) await pg.touchscreen.tap(cx, cy); else await pg.mouse.click(cx, cy); };
                await tapAt(); await pg.waitForTimeout(350); await tapAt(); await pg.waitForTimeout(700);
                const hides = P.st.writes.slice(w0).filter(w => /\/hide-mine$/.test(w.p) && w.body && w.body.hide === true).map(w => Number(w.p.match(/orders\/(\d+)\//)[1])).sort();
                const gone = await pg.evaluate(q => !document.querySelector(q), box);
                ok(`[${dev}] ${label}: 같은 점을 두 번 누르면 종료 — /hide-mine 요청 ${n}건(그 대화의 글 전부) · 채팅 탭에서 내려감`, hides.length === n && gone, `요청 대상 ${hides.join(',')} · 목록에서 사라짐 ${gone}`);
            }
            ok(`[${dev}] 화면 오류 0`, P.errors.length === 0, P.errors.slice(0, 3).join(' | '));
            await P.ctx.close();
        }
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 6).join(' / ') : String(e)); }
    finally { try { if (br) await br.close(); } catch (_) { } srv.kill(); const pass = results.filter(r => r.pass).length; console.log(`\n결과: ${pass}/${results.length}`); setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300); }
})();
