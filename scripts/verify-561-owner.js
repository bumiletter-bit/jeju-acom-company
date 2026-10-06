// #561 검증: 에이전트 오피스 — 관리자 중 「대표만」(모두의 이력 · 승인 결재함 · 승인/반려) · 과장(role admin)은 본인 것만
//   사용: node scripts/verify-561-owner.js [스크린샷 폴더]
//   로컬 실서버 3461(스케줄러 차단) · desk/orders · desk-status 응답과 모든 쓰기 요청을 page.route 로 가로챈다 → DB 쓰기 0 · 실제 창구 호출 0(계정 id·이름만 읽음).
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT561) || 3461;
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
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'desk561-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'desk561-server.err'), 'w')] });
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

        // ══ ① 대표(admin · 대표) = 종전 관리자 화면 그대로 ═════════════════════════════════════
        const D = await open(owner, { width: 1440, height: 1000 }, 'new');
        ok('① 대표 = 탭 3개(채팅 · 이전 채팅 이력 · 승인 결재함)', await tabs(D.pg) === 'mine,all,approval', await tabs(D.pg));
        let w = await wake(D.pg);
        ok('① 대표 = 자리 비움일 때 [창구 깨우기] 보이고 눌림 가능', w.vis && !w.disabled && w.text === '창구 깨우기', JSON.stringify(w));
        let a = await acts(D.pg, 880);
        ok('① 대표 채팅 탭 = 승인 대기 카드에 [승인하고 실행]·[반려]', !!a && a.approve === 1 && a.reject === 1, JSON.stringify(a && [a.approve, a.reject]));
        a = await acts(D.pg, 850);
        ok('① 대표 채팅 탭 = 오류 카드에 [다시 맡기기]', !!a && a.retry === 1);
        await goTab(D.pg, 'all', '#desk-list .desk-h-item');
        let h = await hist(D.pg);
        ok('① 대표 이력 = 남의 대화 포함 5줄 · 줄마다 보낸 사람 이름', h.rows.length === 5 && h.who === 5, JSON.stringify(h));
        ok('① 대표 이력 = 「내 것만」 칸 보임', await vis(D.pg, '#desk-hist-mine-wrap') === 1);
        await D.pg.check('#desk-hist-mine'); await D.pg.waitForTimeout(400); h = await hist(D.pg);
        ok('① 대표 「내 것만」 체크 → 본인 3줄', h.rows.join() === '900,880,850', h.rows.join());
        await D.pg.uncheck('#desk-hist-mine'); await D.pg.waitForTimeout(400);
        await openHist(D.pg, 870); a = await acts(D.pg, 870);
        ok('① 대표 이력 = 남의 승인 대기 건을 펼치면 [승인하고 실행]·[반려](종전과 같음)', !!a && a.approve === 1 && a.reject === 1, JSON.stringify(a && [a.approve, a.reject]));
        await goTab(D.pg, 'approval', '#desk-list [data-act="approve"]');
        ok('① 대표 승인 결재함 = 승인 대기 2건 · [승인하고 실행] 2개', await vis(D.pg, '#desk-list [data-act="approve"]') === 2);
        await D.pg.click('#desk-list [data-act="approve"][data-id="870"]'); await D.pg.waitForSelector('#desk-list [data-act="approve2"][data-id="870"]', { timeout: 5000 });
        await D.pg.click('#desk-list [data-act="approve2"][data-id="870"]'); await D.pg.waitForTimeout(600);
        ok('① 대표 [승인하고 실행] 두 번 눌러 승인 요청이 나감', D.st.writes.some(x => /\/870\/approve$/.test(x.p)), JSON.stringify(D.st.writes.map(x => x.p)));
        ok('① 대표 화면 오류 0', D.errors.length === 0, D.errors.join(' | ')); await shot(D.pg, '561-owner'); await D.ctx.close();

        // ══ ② 과장(admin · 과장) — 고친 서버(본인 것만 내려옴) ═══════════════════════════════════
        const G = await open(manager, { width: 1440, height: 1000 }, 'new');
        ok('② 과장 = 탭 2개(채팅 · 이전 채팅 이력) · 승인 결재함 탭 없음', await tabs(G.pg) === 'mine,all', await tabs(G.pg));
        w = await wake(G.pg);
        ok('② 과장 = [창구 깨우기] 보이고 눌림 가능(관리자 그대로)', w.vis && !w.disabled && w.text === '창구 깨우기', JSON.stringify(w));
        ok('② 과장 = 「관리자가 깨우면…」 직원용 안내가 아님', !/관리자가 깨우면/.test(w.note), w.note);
        await G.pg.click('#desk-wake-btn'); await G.pg.waitForTimeout(500);
        ok('② 과장 [창구 깨우기] 클릭 → 깨우기 요청이 나감', G.st.writes.some(x => /\/desk\/wake$/.test(x.p)), JSON.stringify(G.st.writes.map(x => x.p)));
        a = await acts(G.pg, 880);
        ok('② 과장 채팅 탭 = 본인 승인 대기 카드에 승인·반려 버튼 없음 · 「대표 승인을 기다리고 있어요」', !!a && a.approve === 0 && a.reject === 0 && /대표 승인을 기다리고 있어요/.test(a.text), JSON.stringify(a && [a.approve, a.reject]));
        a = await acts(G.pg, 850);
        ok('② 과장 채팅 탭 = 오류 카드 [다시 맡기기]는 그대로', !!a && a.retry === 1);
        await goTab(G.pg, 'all', '#desk-list .desk-h-item');
        h = await hist(G.pg);
        ok('② 과장 이력 = 본인 3줄만 · 보낸 사람 이름 칸 없음(직원 화면과 같은 꼴)', h.rows.join() === '900,880,850' && h.who === 0, JSON.stringify(h));
        ok('② 과장 이력 = 「내 것만」 칸 없음', await vis(G.pg, '#desk-hist-mine-wrap') === 0);
        await openHist(G.pg, 880); a = await acts(G.pg, 880);
        ok('② 과장 이력 = 펼친 승인 대기 건에 승인·반려 버튼 없음', !!a && a.approve === 0 && a.reject === 0, JSON.stringify(a && [a.approve, a.reject]));
        ok('② 과장 이력 = 검색칸 · 본인 대화의 [채팅 탭에서 이어가기]는 있음(직원과 같음)', await vis(G.pg, '#desk-hist-q') === 1 && await vis(G.pg, '#desk-list .desk-h-item[data-th="880"] [data-act="resume"]') === 1);
        // 숨은 탭을 억지로 눌러도 다음 상태 확인 때 채팅으로 튕긴다
        await G.pg.evaluate(() => document.querySelector('#desk-tabs .desk-tab[data-tab="approval"]').click());
        const bounced = await waitFor(async () => (await selTab(G.pg)) === 'mine', 70000);
        ok('② 과장 = 승인 결재함을 억지로 열어도 채팅 탭으로 튕김', !!bounced, await selTab(G.pg));
        ok('② 과장 = 튕긴 뒤에도 승인 버튼 0', await vis(G.pg, '#desk-list [data-act="approve"], #desk-list [data-act="reject"]') === 0);
        ok('② 과장 화면 오류 0 · 승인/반려 요청 0', G.errors.length === 0 && !G.st.writes.some(x => /approve|reject/.test(x.p)), G.errors.join(' | ')); await shot(G.pg, '561-manager'); await G.ctx.close();

        // ══ ③ 과장 — 종전 서버(관리자면 모두 내려옴)여도 화면이 결재를 열지 않는다 ══════════════════
        const G2 = await open(manager, { width: 1440, height: 1000 }, 'old');
        ok('③ 과장·종전 서버 = 탭 2개', await tabs(G2.pg) === 'mine,all', await tabs(G2.pg));
        await goTab(G2.pg, 'all', '#desk-list .desk-h-item');
        h = await hist(G2.pg);
        ok('③ 과장·종전 서버 = 남의 줄이 내려와도 화면은 안 깨짐(5줄 · 이름 칸 없음 · 「내 것만」 없음)', h.rows.length === 5 && h.who === 0 && await vis(G2.pg, '#desk-hist-mine-wrap') === 0, JSON.stringify(h));
        await openHist(G2.pg, 870); a = await acts(G2.pg, 870);
        ok('③ 과장·종전 서버 = 남의 승인 대기 건을 펼쳐도 승인·반려 버튼 없음', !!a && a.approve === 0 && a.reject === 0, JSON.stringify(a && [a.approve, a.reject]));
        ok('③ 과장·종전 서버 화면 오류 0', G2.errors.length === 0, G2.errors.join(' | ')); await G2.ctx.close();

        // ══ ④ 과장 폰(390px) ═══════════════════════════════════════════════════════════════
        const GP = await open(manager, { width: 390, height: 844 }, 'new', { isMobile: true, hasTouch: true });
        ok('④ 과장 폰 = 탭 2개 · 가로 넘침 없음', await tabs(GP.pg) === 'mine,all' && !(await GP.pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), await tabs(GP.pg));
        await GP.pg.tap('#desk-tabs .desk-tab[data-tab="all"]'); await GP.pg.waitForSelector('#desk-list .desk-h-item', { timeout: 15000 }); await GP.pg.waitForTimeout(400);
        h = await hist(GP.pg);
        ok('④ 과장 폰 이력 = 본인 3줄 · 이름 칸 없음 · 오류 0', h.rows.length === 3 && h.who === 0 && GP.errors.length === 0, JSON.stringify(h) + GP.errors.join(' | ')); await shot(GP.pg, '561-manager-phone'); await GP.ctx.close();

        // ══ ⑤ 직원 = 종전과 같음 ════════════════════════════════════════════════════════════
        const S = await open(staff, { width: 1440, height: 1000 }, 'new');
        ok('⑤ 직원 = 탭 2개', await tabs(S.pg) === 'mine,all', await tabs(S.pg));
        w = await wake(S.pg);
        ok('⑤ 직원 = [창구 깨우기] 안 보임 · 「관리자가 깨우면…」 안내', !w.vis && /관리자가 깨우면/.test(w.note), JSON.stringify(w));
        a = await acts(S.pg, 880);
        ok('⑤ 직원 채팅 탭 = 승인·반려 버튼 없음 · 승인 기다림 안내', !!a && a.approve === 0 && a.reject === 0 && /대표 승인을 기다리고 있어요/.test(a.text));
        a = await acts(S.pg, 850);
        ok('⑤ 직원 = 오류 카드에 [다시 맡기기] 없음', !!a && a.retry === 0);
        await goTab(S.pg, 'all', '#desk-list .desk-h-item');
        h = await hist(S.pg);
        ok('⑤ 직원 이력 = 본인 3줄 · 이름 칸 없음 · 「내 것만」 없음', h.rows.join() === '900,880,850' && h.who === 0 && await vis(S.pg, '#desk-hist-mine-wrap') === 0, JSON.stringify(h));
        ok('⑤ 직원 화면 오류 0', S.errors.length === 0, S.errors.join(' | ')); await S.ctx.close();
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e)); }
    finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) srv.kill();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
