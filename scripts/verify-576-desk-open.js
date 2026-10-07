// #576 검증: 알림에서 그 채팅으로 — window.AkmAoDesk.open(지시 id)
//   본다(PC 1440 · 폰 390):
//     · 채팅 탭에 있는 대화(마지막 차례 · 앞 차례 · 첫 화면 5건 밖) → 채팅 탭 · 그 틀이 보이는 화면 안 · desk-flash · 자판을 띄우지 않음(답 칸에 초점 없음)
//     · 검색·상태 고르기가 걸려 있어도 찾아감 · 이력 탭에서 불러도 채팅 탭으로
//     · 종료한(hide-mine) 대화 · 남의 대화(대표) · 이력 2쪽째의 옛 대화 → 「이전 채팅 이력」 탭 · 펼쳐짐 · 그 줄이 화면 안
//     · 없는 번호 · 이상한 값 → false · 탭·검색 그대로 · 오류 0
//     · 크게 보기(is-full)에서도 · 다른 메뉴에서 넘어오자마자 불러도(app.js 흐름) · 직원 계정은 남의 것 못 엶
//     · 밝은 화면 무회귀: 부르기 전 목록이 고치기 전 파일(BASE_REF)과 PNG 동일
//   자료 = 가짜 대화(가로채기) · 쓰기 전부 가로챔(DB 쓰기 0 — 요청 수도 0 이어야 한다) · 포트 3461(PORT576)
require('dotenv').config();
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const ROOT = path.join(__dirname, '..'), PORT = Number(process.env.PORT576) || 3461, BASE = `http://localhost:${PORT}`;
const BASE_REF = process.env.BASE_REF || '5f7eb8d';   // 고치기 전 기준(#576 직전 커밋)
const OLD = { 'ao-desk.js': execFileSync('git', ['show', BASE_REF + ':public/ao-desk.js'], { cwd: ROOT, maxBuffer: 1 << 26 }) };
const results = []; const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 600) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OWNER = { id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' };
const STAFF = { id: 3, username: 'staff', role: 'staff', name: '정지현', position: '사원' };
const now = Date.parse('2026-10-07T03:00:00Z');
const O = (id, content, extra) => Object.assign({ id, content, status: '완료', created_at: new Date(now - (2000 - id) * 60e3).toISOString(), processed_at: new Date(now - (2000 - id) * 60e3 + 30e3).toISOString(), created_by: '전승범', created_by_id: 1, mine_hidden: false, has_image: false, file_name: null, reply_to: null, steps: [], result: { type: 'desk_answer', answer: `${id}번 답변입니다.\n둘째 줄\n셋째 줄` } }, extra || {});
function seed() {
    const a = [];
    for (let i = 0; i < 9; i++) a.push(O(1910 + i, `새 대화 ${i + 1}`));                           // 채팅 탭 위쪽을 채우는 대화 9개 → 아래 대화는 첫 화면 5건 밖
    a.push(O(1900, '오늘 판매현황 알려줘'), O(1901, '황금향만 다시', { reply_to: 1900 }));          // 대표 · 열려 있음(2차례)
    a.push(O(1800, '옛 대화 첫 글'), O(1801, '옛 대화 둘째 글', { reply_to: 1800 }), O(1802, '옛 대화 셋째 글', { reply_to: 1801 }));
    a.push(O(1700, '종료한 대화', { mine_hidden: true }), O(1701, '종료한 대화에 이어서', { reply_to: 1700, mine_hidden: true }));
    a.push(O(1600, '조가영이 보낸 지시', { created_by: '조가영', created_by_id: 2 }));
    a.push(O(1500, '정지현이 보낸 지시', { created_by: '정지현', created_by_id: 3 }), O(1501, '정지현이 종료한 대화', { created_by: '정지현', created_by_id: 3, mine_hidden: true }));
    for (let i = 0; i < 70; i++) a.push(O(1300 + i, `지난 대화 ${i + 1}`, { mine_hidden: true }));   // 이력 1쪽(60건)을 넘기는 줄
    a.push(O(1250, '아주 옛 대화', { mine_hidden: true }));
    return a.sort((x, y) => y.id - x.id);
}

(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] }); srv.stdout.on('data', () => { }); srv.stderr.on('data', () => { });
    let br;
    try {
        for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/public/version')).ok) break; } catch (_) { } await sleep(1000); }
        const { chromium } = require('playwright'); br = await chromium.launch();
        const open = async (vw, phone, o) => {
            o = o || {}; const user = o.user || OWNER;
            const st = { orders: seed(), writes: [], gets: [] };
            const ctx = await br.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errors = []; pg.on('pageerror', e => errors.push(String(e))); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text()) && !(user.role !== 'admin' && /초기화 오류: Error: 관리자 권한이 필요합니다/.test(m.text()))   /* 직원 계정으로 열 때 app.js init 이 내는 글(app.js renderSettlementList 경로 · ao-desk 와 무관) */) errors.push('console: ' + m.text()); }); pg.on('dialog', d => d.dismiss().catch(() => { }));
            const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
            await pg.route('**/api/**', route => { const rq = route.request(), u = new URL(rq.url());
                if (rq.method() !== 'GET') { st.writes.push(rq.method() + ' ' + u.pathname); return json(route, { ok: true }); }
                if (u.pathname === '/api/agent-office/desk/orders') {
                    st.gets.push(u.search);
                    const hist = u.searchParams.get('history') === '1', lim = Math.min(Number(u.searchParams.get('limit')) || 40, 200), before = Number(u.searchParams.get('before')) || 0, q = (u.searchParams.get('q') || '').toLowerCase();
                    const owner = user.id === 1;
                    let rows = st.orders.filter(x => hist ? (owner || x.created_by_id === user.id) : (x.created_by_id === user.id && !x.mine_hidden));
                    if (before) rows = rows.filter(x => x.id < before);
                    if (q) rows = rows.filter(x => x.content.toLowerCase().includes(q));
                    return json(route, { orders: rows.slice(0, lim), is_admin: user.role === 'admin' });
                }
                if (u.pathname === '/api/agent-office/desk/inbox') return json(route, { items: [], rows: [] });
                return route.continue(); });
            if (o.old) for (const f of Object.keys(OLD)) await pg.route('**/' + f + '*', route => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: OLD[f] }));
            const tok = jwt.sign(user, 'verifytest', { expiresIn: '60m' });
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u, view, last]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', last); if (view) localStorage.setItem('akm_desk_view', view); else localStorage.removeItem('akm_desk_view'); localStorage.setItem('akm_ao_theme', 'light'); }, [tok, user, o.view || '', o.start || 'agent-office']);
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(2000);
            if (!o.start) { await pg.evaluate(() => { if (typeof switchPage === 'function') switchPage('agent-office'); }); await pg.waitForTimeout(1200); }
            await pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important} #desk-clock,#desk-date,.desk-caret,#desk-char{visibility:hidden!important} *{caret-color:transparent!important}' });
            return { pg, ctx, st, errors };
        };
        const listShot = async pg => { await pg.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }); await pg.mouse.move(2, 2); await pg.waitForTimeout(250); let b = await pg.locator('#desk-list').screenshot({ animations: 'disabled' }); for (let i = 0; i < 5; i++) { await pg.waitForTimeout(300); const b2 = await pg.locator('#desk-list').screenshot({ animations: 'disabled' }); if (b2.equals(b)) break; b = b2; } return b; };
        // open(id) 를 부르고 180ms 뒤(강조가 켜져 있는 동안)의 상태를 읽는다
        const call = (pg, id) => pg.evaluate(async id => {
            const ret = await window.AkmAoDesk.open(id);
            await new Promise(r => setTimeout(r, 180));
            const vv = window.visualViewport, vh = vv ? vv.height : window.innerHeight, vtop = vv ? vv.offsetTop : 0;
            const inV = e => { if (!e || !e.getClientRects().length) return false; const r = e.getBoundingClientRect(); return r.bottom > vtop + 4 && r.top < vtop + vh - 4; };
            const fullIn = e => { if (!e || !e.getClientRects().length) return false; const r = e.getBoundingClientRect(); return r.top >= vtop - 1 && r.bottom <= vtop + vh + 1; };
            const turn = document.querySelector('#desk-list .desk-turn[data-oid="' + id + '"]') || document.querySelector('#desk-list [data-oid="' + id + '"]');
            const box = turn && turn.closest('.desk-thread-box'), item = turn && turn.closest('.desk-h-item'), row = item && item.querySelector('.desk-h-row');
            const full = document.querySelector('.desk .is-full'), bar = full && full.querySelector('.desk-fullbar');
            const ae = document.activeElement;
            return { ret, tab: (document.querySelector('#desk-tabs .desk-tab[aria-selected="true"]') || {}).dataset.tab, turn: !!turn, turnVis: inV(turn), bubIn: fullIn(turn && turn.querySelector('.desk-bub.me')),
                box: !!box, boxOv: !!(box && box.classList.contains('ov')), boxFlash: !!(box && box.classList.contains('desk-flash')), turnFlash: !!(turn && turn.classList.contains('desk-flash')),
                cboxIn: box ? fullIn(box.querySelector('.desk-turn.last .desk-cbox')) : null, th: box ? box.dataset.th : item ? item.dataset.th : null,
                item: !!item, itemOpen: !!(item && item.classList.contains('open')), expanded: row ? row.getAttribute('aria-expanded') : null, rowIn: fullIn(row), rowTop: row ? Math.round(row.getBoundingClientRect().top - vtop) : null, barH: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
                turnsInItem: item ? item.querySelectorAll('.desk-turn').length : 0, focusTa: !!(ae && /TEXTAREA|INPUT/.test(ae.tagName)), q: document.getElementById('desk-hist-q').value, fs: document.getElementById('desk-fs').value, isFull: !!full, vh: Math.round(vh) };
        }, id);
        const state = pg => pg.evaluate(() => ({ tab: (document.querySelector('#desk-tabs .desk-tab[aria-selected="true"]') || {}).dataset.tab, q: document.getElementById('desk-hist-q').value, fs: document.getElementById('desk-fs').value, n: document.querySelectorAll('#desk-list [data-th]').length, flash: document.querySelectorAll('#desk-list .desk-flash').length, sy: Math.round(window.scrollY) }));
        const tabTo = async (pg, tab, phone) => { const s = `#desk-tabs .desk-tab[data-tab="${tab}"]`; await pg.locator(s).scrollIntoViewIfNeeded(); if (phone) await pg.tap(s); else await pg.click(s); await pg.waitForTimeout(700); };

        for (const [dev, vw, phone] of [['PC 1440', { width: 1440, height: 1000 }, false], ['폰 390', { width: 390, height: 844 }, true]]) {
            const A = await open(vw, phone, { old: true }), P = await open(vw, phone), pg = P.pg;
            const a0 = await listShot(A.pg), b0 = await listShot(pg);
            ok(`[${dev}] 부르기 전 채팅 목록 = 고치기 전 파일과 PNG 동일`, a0.equals(b0), `${a0.length}b / ${b0.length}b`);
            await A.ctx.close();
            const pre = await pg.evaluate(() => ({ api: typeof (window.AkmAoDesk && window.AkmAoDesk.open), ov1900: !!document.querySelector('#desk-list .desk-thread-box[data-th="1900"].ov'), ov1800: !!document.querySelector('#desk-list .desk-thread-box[data-th="1800"].ov'), n: document.querySelectorAll('#desk-list .desk-thread-box').length }));
            ok(`[${dev}] 준비: window.AkmAoDesk.open 있음 · 채팅 탭 대화 11개 · 1900·1800 대화는 첫 화면 5건 밖(접힘)`, pre.api === 'function' && pre.n === 11 && pre.ov1900 && pre.ov1800, JSON.stringify(pre));

            // ① 채팅 탭의 마지막 차례
            let r = await call(pg, 1901);
            ok(`[${dev}] ① 채팅 탭 대화의 마지막 차례(1901) → 'mine' · 채팅 탭 · 접힘 풀림 · 그 차례가 화면 안 · 답 상자 전체가 화면 안 · 대화 틀 desk-flash`, r.ret === 'mine' && r.tab === 'mine' && r.th === '1900' && !r.boxOv && r.turnVis && r.cboxIn === true && r.boxFlash && r.turnFlash, JSON.stringify(r));
            ok(`[${dev}] ① 자판을 띄우지 않음(답 칸·입력칸에 초점 없음)`, !r.focusTa, String(r.focusTa));
            // ② 대화의 첫 차례 id(답 차례가 아닌 뿌리) · 가운데 차례
            r = await call(pg, 1900);
            ok(`[${dev}] ② 같은 대화의 앞 차례(1900) → 그 말풍선이 화면 안 · 그 차례 desk-flash`, r.ret === 'mine' && r.th === '1900' && r.bubIn && r.turnFlash && r.boxFlash, JSON.stringify(r));
            r = await call(pg, 1801);
            ok(`[${dev}] ② 3차례 대화의 가운데 차례(1801) → 대화 1800 을 찾아 그 말풍선이 화면 안 · 접힘 풀림`, r.ret === 'mine' && r.th === '1800' && !r.boxOv && r.bubIn && r.turnFlash, JSON.stringify(r));
            // ③ 검색·상태 고르기가 걸려 있을 때
            await pg.fill('#desk-hist-q', '새 대화'); await pg.waitForTimeout(500);
            await pg.selectOption('#desk-fs', { index: 1 }); await pg.waitForTimeout(300);
            const s3 = await state(pg);
            r = await call(pg, 1901);
            ok(`[${dev}] ③ 검색어·상태 고르기가 걸려 그 대화가 안 보일 때도 찾아감(검색 비움 · 상태 = 전체)`, s3.q === '새 대화' && s3.fs !== 'all' && r.ret === 'mine' && r.turnVis && r.q === '' && r.fs === 'all', JSON.stringify({ before: s3, after: r }));
            // ④ 이력 탭에서 불러도 채팅 탭으로
            await tabTo(pg, 'all', phone);
            r = await call(pg, 1901);
            ok(`[${dev}] ④ 이전 채팅 이력 탭에 있다가 불러도 채팅 탭으로 넘어가 그 대화`, r.ret === 'mine' && r.tab === 'mine' && r.box && r.turnVis && r.boxFlash, JSON.stringify(r));
            // ⑤ 종료한 대화 → 이력 탭
            r = await call(pg, 1701);
            ok(`[${dev}] ⑤ 종료한(hide-mine) 대화의 답 차례(1701) → 'all' · 이전 채팅 이력 탭 · 대화 1700 펼쳐짐(2차례) · 그 차례 desk-flash`, r.ret === 'all' && r.tab === 'all' && r.th === '1700' && r.itemOpen && r.expanded === 'true' && r.turnsInItem === 2 && r.turnFlash, JSON.stringify(r));
            ok(`[${dev}] ⑤ 펼친 대화의 한 줄이 보이는 화면 안(위에서 ${r.rowTop}px / 화면 ${r.vh}px)`, r.rowIn && r.rowTop >= 0 && r.rowTop < r.vh * 0.6, JSON.stringify({ rowTop: r.rowTop, vh: r.vh }));
            // ⑥ 남의 대화(대표)
            r = await call(pg, 1600);
            ok(`[${dev}] ⑥ 남(조가영)의 지시(1600) → 대표는 이력 탭에서 펼쳐 봄`, r.ret === 'all' && r.tab === 'all' && r.th === '1600' && r.itemOpen && r.rowIn && r.turnFlash, JSON.stringify(r));
            // ⑦ 이력 2쪽째의 옛 대화
            const g0 = P.st.gets.length;
            r = await call(pg, 1250);
            const pages = P.st.gets.slice(g0).filter(s => /history=1/.test(s) && /before=/.test(s)).length;
            ok(`[${dev}] ⑦ 이력 첫 60건 밖의 옛 대화(1250) → 다음 쪽을 받아(${pages}회) 펼쳐 보여 줌`, r.ret === 'all' && r.th === '1250' && r.itemOpen && r.rowIn && pages >= 1, JSON.stringify(r));
            // ⑧ 없는 번호·이상한 값 — 이력 탭에서
            const sA = await state(pg); const errA = P.errors.length;
            const bad = await pg.evaluate(async () => { const out = []; for (const v of [99999, 0, -3, 'abc', null, undefined, 12.5, {}]) out.push(await window.AkmAoDesk.open(v)); return out; });
            await pg.waitForTimeout(300); const sA2 = await state(pg);
            ok(`[${dev}] ⑧ 없는 번호·이상한 값 8가지 → 전부 false · 이력 탭 그대로 · 화면 위치 그대로 · 오류 0`, bad.every(x => x === false) && sA2.tab === 'all' && sA2.n === sA.n && sA2.sy === sA.sy && P.errors.length === errA, JSON.stringify({ bad, sA, sA2 }));
            // ⑧-b 채팅 탭에서 검색 중일 때 없는 번호 → 검색도 그대로
            await tabTo(pg, 'mine', phone); await pg.fill('#desk-hist-q', '새 대화 3'); await pg.waitForTimeout(500);
            const sB = await state(pg); const none = await pg.evaluate(() => window.AkmAoDesk.open(424242)); await pg.waitForTimeout(300); const sB2 = await state(pg);
            ok(`[${dev}] ⑧ 채팅 탭에서 검색 중에 없는 번호 → false · 탭·검색어·목록 그대로 · 강조 0`, none === false && sB2.tab === 'mine' && sB2.q === '새 대화 3' && sB2.n === sB.n && sB2.flash === 0, JSON.stringify({ sB, sB2 }));
            await pg.fill('#desk-hist-q', ''); await pg.waitForTimeout(500);
            // ⑨ 크게 보기에서
            await pg.locator('#desk-list-more').scrollIntoViewIfNeeded(); if (phone) await pg.tap('#desk-list-more'); else await pg.click('#desk-list-more'); await pg.waitForTimeout(500);
            r = await call(pg, 1801);
            ok(`[${dev}] ⑨ 크게 보기(is-full)에서 채팅 탭 대화(1801) → 크게 보기 그대로 · 그 말풍선이 화면 안`, r.isFull && r.ret === 'mine' && r.th === '1800' && r.bubIn && r.turnFlash, JSON.stringify(r));
            r = await call(pg, 1700);
            ok(`[${dev}] ⑨ 크게 보기에서 종료한 대화(1700) → 크게 보기 그대로 · 이력 탭 · 펼친 줄이 위 띠(${r.barH}px) 아래 화면 안`, r.isFull && r.ret === 'all' && r.tab === 'all' && r.itemOpen && r.rowIn && r.rowTop >= r.barH - 1, JSON.stringify(r));
            await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
            // ⑩ 연달아 부르면 마지막 것만
            const two = await pg.evaluate(async () => { const a = window.AkmAoDesk.open(1701), b = window.AkmAoDesk.open(1901); return [await a, await b]; }); await pg.waitForTimeout(300);
            const sC = await state(pg);
            ok(`[${dev}] ⑩ 연달아 두 번 부르면 뒤의 것만 따라감(앞 = false · 뒤 = 'mine' · 채팅 탭)`, two[0] === false && two[1] === 'mine' && sC.tab === 'mine', JSON.stringify({ two, sC }));
            ok(`[${dev}] 쓰기 요청 0 · 화면 오류 0`, P.st.writes.length === 0 && P.errors.length === 0, P.st.writes.concat(P.errors).slice(0, 4).join(' | '));
            await P.ctx.close();

            // ⑪ app.js 흐름: 다른 메뉴에 있다가 메뉴를 바꾸고 곧바로 부름(에이전트 오피스를 아직 한 번도 안 연 상태)
            const Q = await open(vw, phone, { start: 'schedule' });
            const q0 = await Q.pg.evaluate(() => ({ page: (document.querySelector('.page.active') || {}).id, api: typeof (window.AkmAoDesk && window.AkmAoDesk.open), mounted: !!document.getElementById('desk-list') }));
            const early = await Q.pg.evaluate(() => window.AkmAoDesk.open(1901).then(v => v));   // 메뉴를 안 바꾸고 부르면(5초 기다린 뒤) 조용히 false
            const s11 = await Q.pg.evaluate(() => (document.querySelector('.page.active') || {}).id);
            ok(`[${dev}] ⑪ 다른 메뉴(일정표)에 그대로 있으면 false · 메뉴 안 바뀜 · 오류 0`, q0.page === 'page-schedule' && q0.api === 'function' && early === false && s11 === 'page-schedule' && Q.errors.length === 0, JSON.stringify({ q0, early, s11 }));
            await Q.pg.evaluate(() => { switchPage('agent-office'); });
            r = await call(Q.pg, 1901);
            ok(`[${dev}] ⑪ 메뉴를 바꾸고 곧바로(첫 그리기 전) 불러도 그 대화로`, r.ret === 'mine' && r.th === '1900' && r.turnVis && r.cboxIn === true && r.boxFlash && !r.focusTa, JSON.stringify(r));
            await Q.pg.evaluate(() => { switchPage('schedule'); }); await Q.pg.waitForTimeout(500);
            await Q.pg.evaluate(() => { switchPage('agent-office'); });
            r = await call(Q.pg, 1700);
            ok(`[${dev}] ⑪ 다시 다른 메뉴 → 돌아오며 종료한 대화(1700)를 부르면 이력 탭에서 펼쳐짐`, r.ret === 'all' && r.tab === 'all' && r.itemOpen && r.rowIn, JSON.stringify(r));
            ok(`[${dev}] ⑪ 쓰기 요청 0 · 오류 0`, Q.st.writes.length === 0 && Q.errors.length === 0, Q.st.writes.concat(Q.errors).slice(0, 4).join(' | '));
            await Q.ctx.close();

            // ⑫ 직원 계정
            const T = await open(vw, phone, { user: STAFF });
            r = await call(T.pg, 1500);
            ok(`[${dev}] ⑫ 직원: 본인 채팅(1500) → 채팅 탭`, r.ret === 'mine' && r.tab === 'mine' && r.turnVis && r.boxFlash, JSON.stringify(r));
            r = await call(T.pg, 1501);
            ok(`[${dev}] ⑫ 직원: 본인이 종료한 대화(1501) → 이력 탭에서 펼쳐짐`, r.ret === 'all' && r.tab === 'all' && r.itemOpen && r.rowIn, JSON.stringify(r));
            const sT = await state(T.pg); const no = await T.pg.evaluate(() => window.AkmAoDesk.open(1900)); await T.pg.waitForTimeout(300); const sT2 = await state(T.pg);
            ok(`[${dev}] ⑫ 직원: 남(대표)의 지시 번호(1900) → false · 탭 그대로 · 남의 글이 화면에 없음`, no === false && sT2.tab === sT.tab && !(await T.pg.evaluate(() => /판매현황 알려줘/.test(document.getElementById('desk-list').textContent))), JSON.stringify({ no, sT, sT2 }));
            ok(`[${dev}] ⑫ 쓰기 요청 0 · 오류 0`, T.st.writes.length === 0 && T.errors.length === 0, T.st.writes.concat(T.errors).slice(0, 4).join(' | '));
            await T.ctx.close();
        }
        // ⑬ 표 보기(akm_desk_view = table · 넓은 화면)
        {
            const V = await open({ width: 1440, height: 1000 }, false, { view: 'table' });
            const r = await V.pg.evaluate(async () => { const ret = await window.AkmAoDesk.open(1801); await new Promise(r => setTimeout(r, 180)); const e = document.querySelector('#desk-list [data-oid="1801"]'); const b = e && e.getBoundingClientRect(); return { ret, tag: e && e.tagName, flash: !!(e && e.classList.contains('desk-flash')), vis: !!b && b.bottom > 0 && b.top < window.innerHeight }; });
            ok('[표 보기] 표로 보는 설정이어도 그 줄로 옮겨 강조 · 오류 0', r.ret === 'mine' && r.flash && r.vis && V.errors.length === 0, JSON.stringify(r) + V.errors.join('|'));
            await V.ctx.close();
        }
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 6).join(' / ') : String(e)); }
    finally { try { if (br) await br.close(); } catch (_) { } srv.kill(); const pass = results.filter(r => r.pass).length; console.log(`\n결과: ${pass}/${results.length}`); setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300); }
})();
