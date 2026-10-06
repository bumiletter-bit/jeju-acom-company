// #566 검증: 에이전트 오피스 — 「승인 결재함」 탭 없음(모든 계정) · 승인 대기 건이 생기면 대표만 카드에서 승인/반려
//   사용: node scripts/verify-566-tabs.js [스크린샷 폴더]
//   로컬 실서버 3461(스케줄러 차단) · desk/orders · desk-status 응답과 모든 쓰기 요청을 page.route 로 가로챈다 → DB 쓰기 0 · 실제 창구 호출 0(계정 id·이름만 읽음).
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT566) || 3461;
const SHOT = process.argv[2] || null;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 260) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(200); } return null; };

(async () => {
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'desk566-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'desk566-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const mgr = (await db.query(`SELECT id, name, position FROM users WHERE role = 'admin' AND position <> '대표' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        const stf = (await db.query(`SELECT id, name, position FROM users WHERE role <> 'admin' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        await db.end();
        const owner = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' };
        const manager = { id: mgr ? mgr.id : 999001, name: mgr ? mgr.name : '검증과장', position: (mgr && mgr.position) || '과장', role: 'admin' };
        const staff = { id: stf.id, name: stf.name, position: stf.position || '사원', role: 'user' };
        ok('실DB에 대표가 아닌 관리자 계정이 있음(직급 ' + manager.position + ')', !!mgr);
        const isOwner = u => u.role === 'admin' && u.position === '대표';

        const now = Date.now();
        const mkSeed = (me, other) => {
            const O = (id, ago, content, extra) => Object.assign({ id, content, status: '완료', created_at: new Date(now - ago).toISOString(), processed_at: new Date(now - ago + 30e3).toISOString(), created_by: '검증561', created_by_id: me, mine_hidden: false, has_image: false, reply_to: null, followed_by: null,
                steps: [], result: { type: 'desk_answer', answer: `${id}번 답변입니다.` } }, extra || {});
            const ap = s => ({ type: 'approval_request', summary: s, impact: '손님 3명', plan: '쿠폰 발급' });
            return [
                O(900, 5 * 60e3, '오늘 판매현황 알려줘'),
                O(880, 10 * 60e3, '내가 올린 쿠폰 요청', { status: '승인대기', processed_at: null, result: ap('내 쿠폰 요청') }),
                O(870, 15 * 60e3, '다른 직원의 쿠폰 요청', { status: '승인대기', processed_at: null, created_by: '다른직원', created_by_id: other, result: ap('남의 쿠폰 요청') }),
                O(860, 20 * 60e3, '다른 직원의 문의', { created_by: '다른직원', created_by_id: other }),
                O(850, 25 * 60e3, '오류가 났던 일', { status: '오류', result: { type: 'error', error: '시간 초과' } }),
            ];
        };

        const { chromium } = require('playwright');
        browser = await chromium.launch();
        // mode: 'new' = 고친 서버(대표가 아니면 본인 것만) · 'old' = 종전 서버(관리자면 모두) — 화면이 서버에 기대지 않는지 본다
        const open = async (user, vw, mode, extra) => {
            const other = user.id === staff.id ? owner.id : staff.id;
            const st = { orders: mkSeed(user.id, other), writes: [], state: 'offline' };
            const ctx = await browser.newContext(Object.assign({ viewport: vw }, extra || {}));
            const pg = await ctx.newPage(); const errors = [];
            pg.on('pageerror', e => errors.push(String(e)));
            pg.on('dialog', d => d.dismiss());
            const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
            await pg.route('**/api/**', route => {
                const rq = route.request();
                if (rq.method() === 'GET') return route.continue();
                const p = new URL(rq.url()).pathname; let body = null; try { body = JSON.parse(rq.postData() || 'null'); } catch (_) { }
                st.writes.push({ m: rq.method(), p, body });
                return json(route, { ok: true });
            });
            await pg.route('**/api/agent-office/desk-status*', route => json(route, { state: st.state, can_wake: true, waiting: 0, working: 0, approval: 2, launcher: { note: '' }, last_seen: new Date(now - 600e3).toISOString() }));
            await pg.route('**/api/agent-office/desk/orders*', route => {
                if (route.request().method() !== 'GET') return route.fallback();
                const sp = new URL(route.request().url()).searchParams; let rows = st.orders.slice().sort((a, b) => b.id - a.id);
                const all = mode === 'old' ? user.role === 'admin' : isOwner(user);
                if (sp.get('history') === '1') { if (!all) rows = rows.filter(o => o.created_by_id === user.id); }
                else if (sp.get('status')) { rows = rows.filter(o => o.status === sp.get('status')); if (!all) rows = rows.filter(o => o.created_by_id === user.id); }
                else rows = rows.filter(o => o.created_by_id === user.id && !o.mine_hidden);
                return json(route, { orders: rows.slice(0, Number(sp.get('limit')) || 40) });
            });
            const tok = jwt.sign(user, 'verifytest', { expiresIn: '30m' });
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); localStorage.removeItem('akm_desk_view'); }, [tok, user]);
            await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(2500);
            await pg.evaluate(() => { const n = document.querySelector('.nav-item[data-page="agent-office"]'); if (n) n.click(); else if (typeof switchPage === 'function') switchPage('agent-office'); });
            await pg.waitForSelector('#desk-list .desk-thread-box, #desk-list .desk-empty', { timeout: 20000 }); await pg.waitForTimeout(900);
            // 확인표 창이 실DB 대기 건으로 떠 있으면 클릭을 가린다(#548 함정) → 시험에서는 숨긴다
            await pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important}' });
            return { pg, st, errors, ctx };
        };
        const shot = async (pg, name) => { if (!SHOT) return; try { fs.mkdirSync(SHOT, { recursive: true }); await pg.screenshot({ path: path.join(SHOT, name + '.png'), fullPage: true }); } catch (_) { } };
        const vis = (pg, sel) => pg.evaluate(s => Array.from(document.querySelectorAll(s)).filter(e => e.getClientRects().length > 0).length, sel);
        const tabs = pg => pg.evaluate(() => Array.from(document.querySelectorAll('#desk-tabs .desk-tab')).filter(t => t.getClientRects().length > 0).map(t => t.dataset.tab).join());
        const selTab = pg => pg.evaluate(() => { const t = document.querySelector('#desk-tabs .desk-tab[aria-selected="true"]'); return t ? t.dataset.tab : ''; });
        const goTab = async (pg, tab, sel) => { await pg.click(`#desk-tabs .desk-tab[data-tab="${tab}"]`); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(500); };
        const hist = pg => pg.evaluate(() => ({ rows: Array.from(document.querySelectorAll('#desk-list .desk-h-item')).map(e => Number(e.dataset.th)), who: document.querySelectorAll('#desk-list .desk-h-who').length }));
        const openHist = async (pg, id) => { await pg.click(`#desk-list .desk-h-item[data-th="${id}"] .desk-h-row`); await pg.waitForSelector(`#desk-list .desk-h-item[data-th="${id}"].open`, { timeout: 8000 }); await pg.waitForTimeout(300); };
        const acts = (pg, id) => pg.evaluate(i => { const it = document.querySelector(`#desk-list .desk-h-item[data-th="${i}"], #desk-list .desk-thread-box[data-th="${i}"]`); if (!it) return null; const n = s => Array.from(it.querySelectorAll(s)).filter(e => e.getClientRects().length > 0).length; return { approve: n('[data-act="approve"]'), reject: n('[data-act="reject"]'), retry: n('[data-act="retry"]'), text: it.innerText }; }, id);
        const wake = pg => pg.evaluate(() => { const b = document.getElementById('desk-wake-btn'), n = document.getElementById('desk-wake-note'); return { vis: b.getClientRects().length > 0, disabled: b.disabled, text: b.textContent.trim(), note: n.textContent.trim() }; });

        // ══ 대표 · 과장 · 직원 × PC(1440) · 폰(390) ═════════════════════════════════════════════
        const rootText = pg => pg.evaluate(() => document.getElementById('ao-desk-root').innerText);
        const noTab = pg => pg.evaluate(() => document.querySelectorAll('[data-tab="approval"], #desk-tab-approval, #desk-approval-n').length);
        const over = pg => pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        for (const [who, user] of [['대표', owner], ['과장', manager], ['직원', staff]]) {
            for (const dev of ['PC', '폰']) {
                const phone = dev === '폰', tag = who + '·' + dev;
                const P = await open(user, phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, 'new', phone ? { isMobile: true, hasTouch: true } : null);
                const press = sel => phone ? P.pg.tap(sel) : P.pg.click(sel);
                ok('[' + tag + '] 탭 = 채팅 · 이전 채팅 이력 2개 · 승인 결재함 탭 요소 0', await tabs(P.pg) === 'mine,all' && await noTab(P.pg) === 0, await tabs(P.pg));
                let txt = await rootText(P.pg);
                ok('[' + tag + '] 채팅 탭 화면에 「승인 결재함」「대표 확인함」 글자 0', !/승인 결재함|대표 확인함/.test(txt));
                let a = await acts(P.pg, 880);
                if (who === '대표') {
                    ok('[' + tag + '] 채팅 탭 = 본인 승인 대기 카드에 [승인하고 실행]·[반려](안전망)', !!a && a.approve === 1 && a.reject === 1, JSON.stringify(a && [a.approve, a.reject]));
                    await press('#desk-list [data-act="approve"][data-id="880"]'); await P.pg.waitForSelector('#desk-list [data-act="approve2"][data-id="880"]', { timeout: 5000 });
                    await press('#desk-list [data-act="approve2"][data-id="880"]'); await P.pg.waitForTimeout(600);
                    ok('[' + tag + '] [승인하고 실행] → 확인 → 승인 요청이 나감', P.st.writes.some(x => /\/880\/approve$/.test(x.p)), JSON.stringify(P.st.writes.map(x => x.p)));
                } else {
                    ok('[' + tag + '] 채팅 탭 = 승인 대기 카드에 승인·반려 버튼 없음 · 「대표 승인을 기다리고 있어요」', !!a && a.approve === 0 && a.reject === 0 && /대표 승인을 기다리고 있어요/.test(a.text), JSON.stringify(a && [a.approve, a.reject]));
                }
                await press('#desk-tabs .desk-tab[data-tab="all"]'); await P.pg.waitForSelector('#desk-list .desk-h-item', { timeout: 15000 }); await P.pg.waitForTimeout(500);
                const h = await hist(P.pg);
                ok('[' + tag + '] 이전 채팅 이력 = ' + (who === '대표' ? '모두 5줄' : '본인 3줄') + ' · 승인 대기 건에 「확인 필요」 표시', h.rows.length === (who === '대표' ? 5 : 3) && await P.pg.evaluate(() => /확인 필요/.test(document.querySelector('#desk-list .desk-h-item[data-th="880"]').innerText)), JSON.stringify(h));
                if (who === '대표') {
                    await press('#desk-list .desk-h-item[data-th="870"] .desk-h-row'); await P.pg.waitForSelector('#desk-list .desk-h-item[data-th="870"].open', { timeout: 8000 }); await P.pg.waitForTimeout(300);
                    a = await acts(P.pg, 870);
                    ok('[' + tag + '] 이력에서 남의 승인 대기 건을 펼치면 [승인하고 실행]·[반려]', !!a && a.approve === 1 && a.reject === 1, JSON.stringify(a && [a.approve, a.reject]));
                    await press('#desk-list [data-act="reject"][data-id="870"]'); await P.pg.waitForSelector('#desk-list [data-act="reject2"][data-id="870"]', { timeout: 5000 });
                    await press('#desk-list [data-act="reject2"][data-id="870"]'); await P.pg.waitForTimeout(600);
                    ok('[' + tag + '] 이력에서 [반려] → [반려하기] → 반려 요청이 나감', P.st.writes.some(x => /\/870\/reject$/.test(x.p)), JSON.stringify(P.st.writes.map(x => x.p)));
                } else {
                    await press('#desk-list .desk-h-item[data-th="880"] .desk-h-row'); await P.pg.waitForSelector('#desk-list .desk-h-item[data-th="880"].open', { timeout: 8000 }); await P.pg.waitForTimeout(300);
                    a = await acts(P.pg, 880);
                    ok('[' + tag + '] 이력에서 승인 대기 건을 펼쳐도 승인·반려 버튼 없음 · 승인/반려 요청 0', !!a && a.approve === 0 && a.reject === 0 && !P.st.writes.some(x => /approve|reject/.test(x.p)));
                }
                txt = await rootText(P.pg);
                ok('[' + tag + '] 이력 탭 화면에도 그 글자 0 · 가로 넘침 없음 · 화면 오류 0', !/승인 결재함|대표 확인함/.test(txt) && !(await over(P.pg)) && P.errors.length === 0, P.errors.join(' | '));
                // 상태 확인이 한 번 더 돈 뒤에도(승인 대기 숫자 2 가 내려와도) 탭·배지가 생기지 않는다
                await P.pg.evaluate(() => window.__aoDesk && window.__aoDesk.loadStatus && window.__aoDesk.loadStatus()); await P.pg.waitForTimeout(500);
                ok('[' + tag + '] 상태를 다시 받아도 탭 2개 그대로 · 오류 0', await tabs(P.pg) === 'mine,all' && await noTab(P.pg) === 0 && P.errors.length === 0, P.errors.join(' | '));
                await shot(P.pg, '566-' + who + (phone ? '-phone' : '-pc')); await P.ctx.close();
            }
        }
        // ══ 종전 서버 꼴(관리자면 모두 내려옴)에서 과장 ════════════════════════════════════════════
        const G2 = await open(manager, { width: 1440, height: 1000 }, 'old');
        await goTab(G2.pg, 'all', '#desk-list .desk-h-item');
        await openHist(G2.pg, 870); const a2 = await acts(G2.pg, 870);
        ok('[과장·종전 서버] 탭 2개 · 남의 승인 대기 건을 펼쳐도 버튼 없음 · 오류 0', await tabs(G2.pg) === 'mine,all' && !!a2 && a2.approve === 0 && a2.reject === 0 && G2.errors.length === 0);
        await G2.ctx.close();
        // 남은 글자(소스)
        const src = fs.readFileSync(path.join(ROOT, 'public/ao-desk.js'), 'utf8').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');
        ok('ao-desk.js 실행 코드에 「승인 결재함」「대표 확인함」 · approval 탭 처리 0(주석 제외 · approval_request 판정만 남음)', !/승인 결재함|대표 확인함|desk-tab-approval|desk-approval-n|'approval'/.test(src) && /approval_request/.test(src));
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e)); }
    finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) srv.kill();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
