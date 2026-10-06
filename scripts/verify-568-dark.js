// #568 검증: 에이전트 오피스 야간 화면(ao-desk) — 밝은 화면 무회귀 · 어두운 화면 대비 · 전환 동작
//   사용: node scripts/verify-568-dark.js [스크린샷 폴더]   (대표에게 보낼 4장도 그 폴더에 저장)
//   로컬 실서버 3461(스케줄러 차단) · desk/orders · desk-status 는 가짜 · 그 밖의 GET 은 처음 받은 응답을 저장해 모든 화면에 똑같이 돌려준다(화면끼리 비교하려고) · 쓰기 요청은 전부 가로챔 → DB 쓰기 0.
//   「종전」 = git HEAD 의 ao-desk.css/js 를 끼운 화면.
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT568) || 3461;
const SHOT = process.argv[2] || path.join(os.tmpdir(), 'shot568');
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 1800) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'dark568-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'dark568-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const stf = (await db.query(`SELECT id, name, position FROM users WHERE role NOT IN ('admin','accountant') AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        await db.end();
        const owner = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' };
        const staff = { id: stf.id, name: stf.name, position: stf.position || '사원', role: 'user' };
        const OLD = { css: execFileSync('git', ['show', 'HEAD:public/ao-desk.css'], { cwd: ROOT }).toString('utf8'), js: execFileSync('git', ['show', 'HEAD:public/ao-desk.js'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }).toString('utf8') };
        const CUR = fs.readFileSync(path.join(ROOT, 'public/ao-desk.css'), 'utf8');
        const cut = CUR.indexOf('/* ═══ #568 야간 화면');
        ok('ao-desk.css: 종전 내용은 한 글자도 안 바뀜(#568 블록은 끝에 덧붙이기만)', cut > 0 && CUR.slice(0, cut).replace(/\s+$/, '') === OLD.css.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n').join(CUR.includes('\r\n') ? '\r\n' : '\n'), 'cut ' + cut);
        const blk = CUR.slice(cut).replace(/\/\*[\s\S]*?\*\//g, '');
        const loose = []; { const re = /(^|})\s*([^{}@]+)\{/g; let m; while ((m = re.exec(blk))) { const sel = m[2].trim(); if (/^(\d+%|from|to)(\s*,\s*(\d+%|from|to))*$/.test(sel)) continue; for (const part of sel.split(',')) { const p = part.trim(); if (!/data-ao-theme="dark"/.test(p) && !/^\.desk-theme\b/.test(p) && !/^\.desk-theme-slot\b/.test(p)) loose.push(p); } } }
        ok('#568 블록의 규칙은 전부 html[data-ao-theme="dark"] 아래(예외 = 전환 버튼 .desk-theme 과 그 자리 칸)', loose.length === 0, loose.slice(0, 8).join(' | '));

        // ── 가짜 채팅 목록
        const DAY = 86400e3, now = Date.now();
        const LONG = ['요청하신 세 가지를 한 번에 정리했어요.', '', '━━━ ① 문자(LMS) ━━━', '[제주아꼼이네] 황금향이 가장 맛있는 때예요', '', '★ 이번 주 수확분은 과즙이 가득해요', '▶ 선물용 3kg · 5kg 모두 준비했어요', '', '━━━ ② 톡톡 ━━━', '안녕하세요, 제주아꼼이네입니다. **이번 주 수확분**이 나왔어요.', '1. 가정용 5kg', '2. 선물용 3kg', '', '━━━ ③ 확인한 것 ━━━', '| 품목 | 판매가 | 상태 |', '|---|---:|---|', '| 황금향 가정용 5kg | 33,500 | 판매중 |', '| 하우스감귤 4kg | 29,000 | 판매중 |', '', '설정 키는 `notify_name_tail` 이에요.'].join('\n');
        const mkSeed = (me, other) => {
            const O = (id, ago, content, extra) => Object.assign({ id, content, status: '완료', created_at: new Date(now - ago).toISOString(), processed_at: new Date(now - ago + 30e3).toISOString(), created_by: '검증568', created_by_id: me, mine_hidden: false, has_image: false, reply_to: null, followed_by: null,
                steps: [], result: { type: 'desk_answer', answer: `${id}번 답변입니다.` } }, extra || {});
            return [
                O(900, 5 * 60e3, '황금향 문자·톡톡 문구 만들어줘', { result: { type: 'desk_answer', title: '황금향 홍보 문구 3종', answer: LONG, files: [{ label: '보고서.xlsx', file_id: 77 }] }, steps: [{ t: new Date(now - 5 * 60e3).toISOString(), text: '🧠 꼼꼼한 답', lane: 'opus' }] }),
                O(901, 4 * 60e3, '더 짧게 줄여줘', { reply_to: 900, result: { type: 'desk_answer', answer: '짧게 줄였어요.\n\n★ 황금향 지금이 제철\n▶ 3kg · 5kg 준비' } }),
                O(890, 20 * 60e3, '지금 처리 중인 일', { status: '처리중', processed_at: null, result: null, steps: [{ t: new Date(now - 60e3).toISOString(), text: '🔎 회사프로그램 자료 조회 중' }], live: '지금까지 확인한 내용이에요' }),
                O(885, 25 * 60e3, '기다리는 일', { status: '대기', processed_at: null, result: null }),
                O(880, 30 * 60e3, '쿠폰 문자 보내줘', { status: '질문', result: { type: 'question', question: '대상이 몇 명인가요?' } }),
                O(875, 35 * 60e3, '가입 쿠폰 올려줘', { status: '승인대기', processed_at: null, result: { type: 'approval_request', summary: '가입 쿠폰 2,000원 → 3,000원', impact: '신규 가입자 전원', plan: '카페24 쿠폰 설정 변경' } }),
                O(872, 38 * 60e3, '오류가 난 일', { status: '오류', result: { type: 'error', error: '시간 초과' } }),
                O(870, 40 * 60e3, '[최종발주] 10/5(월) 발송분', { result: { type: 'desk_answer', answer: '대성 10건 · 효돈 12건' } }),
                O(868, 45 * 60e3, '엑셀 봐줘', { file_name: '수량표.xlsx' }),
                O(800, DAY + 60e3, '어제 정산 확인해줘', { mine_hidden: true, has_image: true }),
                O(801, DAY, '효돈만 다시', { reply_to: 800, mine_hidden: true }),
                O(790, DAY + 3600e3, '다른 직원의 문의', { created_by: '다른직원', created_by_id: other }),
                O(700, 40 * DAY, '지난달 보고서 만들어줘', { mine_hidden: true }),
                O(690, 41 * DAY, '오류가 났던 일', { status: '오류', mine_hidden: true, result: { type: 'error', error: '시간 초과' } }),
            ];
        };

        const IB = (kind, id, state, seen, extra) => Object.assign({ kind, id: kind + id, at: new Date(now - id * 3600e3).toISOString(), item: '황금향 5kg', question: '선물용으로 보내려는데 이번 주 안에 도착할까요? 포장도 궁금해요.', state, seen: !!seen, seen_by: seen ? '검증568' : null, why: state === 'open' ? '사람 확인 필요' : '' }, extra || {});
        const INBOX = {
            talk: [IB('talk', 1, 'open'), IB('talk', 2, 'ai', false, { answer: '안녕하세요, 제주아꼼이네입니다. 내일 발송 예정이에요.' }), IB('talk', 3, 'staff', false, { answer: '봇 답변입니다.', staff: '직원이 다시 안내드렸어요.' }), IB('talk', 4, 'ai', true, { answer: '확인한 건의 답변입니다.' })],
            qna: [IB('qna', 1, 'open', false, { draft: '초안: 수요일 발송 예정입니다.' }), IB('qna', 2, 'ai', false, { answer: '자동 등록된 답변입니다.' }), IB('qna', 3, 'ai', true, { answer: '확인한 상품 문의 답변.' })],
            inquiry: [IB('inquiry', 1, 'open'), IB('inquiry', 2, 'ai', false, { answer: '주문 문의 자동 답변입니다.' }), IB('inquiry', 3, 'open', true)],
        };
        const inboxOf = seen => { const pick = k => INBOX[k].filter(x => seen || !x.seen); const cnt = k => ({ open: INBOX[k].filter(x => !x.seen && x.state === 'open').length, ai: INBOX[k].filter(x => !x.seen && x.state === 'ai').length, staff: INBOX[k].filter(x => !x.seen && x.state === 'staff').length }); return { days: 7, counts: { talk: cnt('talk'), qna: cnt('qna'), inquiry: cnt('inquiry') }, talk: pick('talk'), qna: pick('qna'), inquiry: pick('inquiry') }; };
        const dOf = i => new Date(now + 9 * 3600e3 - i * DAY).toISOString().slice(0, 10);
        const boardOf = user => ({ is_admin: user.role === 'admin', channels: [{ ch: 'naver', today: 41, yesterday: 38 }, { ch: 'mall', today: 3, yesterday: 5 }, { ch: 'coupang', today: 0, yesterday: 2 }],
            ship: [{ d: dOf(0), boxes: 120 }, { d: dOf(1), boxes: 951 }, { d: dOf(2), boxes: 0 }, { d: dOf(3), boxes: 310 }], todo: [{ key: 'owner', label: '하우스감귤 4kg 행사 종료', when: '10/11', where: '대표 할 일' }, { key: 'inq', label: '미답변 상품 문의', count: 2, where: '문의 관리' }],
            sales: [{ d: dOf(1), orders: 52, pay: 1512000 }, { d: dOf(2), orders: 40, pay: 1104500 }],
            live: [{ processed_at: new Date(now - 600e3).toISOString(), status: '완료', text: '중간발주 집계' }, { processed_at: new Date(now - 1200e3).toISOString(), status: '질문', text: '쿠폰 문자 대상 확인' }, { processed_at: new Date(now - 1800e3).toISOString(), status: '오류', text: '시간 초과로 멈춘 일' }],
            today: [{ title: '가영 당직', is_completed: true, category: '일반', user_name: '조가영' }, { title: '하우스귤 문자 톡톡', is_completed: false, start_time: '10:00:00', category: '톡톡발송', user_name: '전승범' }],
            progress: [{ key: 'order', label: '주문 확인', done: 1359, total: 1372 }, { key: 'ship', label: '발송 처리', done: 39, total: 39 }, { key: 'qna', label: '고객 문의', done: 1, total: 4 }, { key: 'settle', label: '정산 등록', done: 2, total: 2 }] });
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const cache = new Map();   // 실서버 GET 응답을 처음 한 번만 받아 모든 화면에 같은 값으로
        const open = async (user, vw, opt) => {
            opt = opt || {};
            const other = user.id === owner.id ? staff.id : owner.id;
            const st = { orders: mkSeed(user.id, other), writes: [] };
            const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce' }, opt.phone ? { isMobile: true, hasTouch: true } : {}));
            const pg = await ctx.newPage(); const errors = [];
            pg.on('pageerror', e => errors.push(String(e)));
            pg.on('dialog', d => d.dismiss());
            const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
            await pg.route('**/api/**', async route => {
                const rq = route.request(), u = new URL(rq.url());
                if (rq.method() !== 'GET') { st.writes.push(rq.method() + ' ' + u.pathname); return json(route, { ok: true }); }
                const key = user.id + ' ' + u.pathname + u.search;
                if (cache.has(key)) return route.fulfill(cache.get(key));
                try { const r = await route.fetch(); const body = await r.body(); const v = { status: r.status(), headers: r.headers(), body }; cache.set(key, v); return route.fulfill(v); } catch (e) { return route.abort(); }
            });
            await pg.route('**/api/agent-office/desk-status*', route => json(route, { state: opt.state || 'idle', online: true, can_wake: true, waiting: 1, working: 1, approval: 0, launcher: { on: true, note: '' }, working_list: [{ created_by: '검증568', content: '지금 처리 중인 일' }] }));
            await pg.route('**/api/agent-office/desk/orders*', route => {
                if (route.request().method() !== 'GET') return route.fallback();
                const sp = new URL(route.request().url()).searchParams; let rows = st.orders.slice().sort((a, b) => b.id - a.id);
                if (sp.get('history') === '1') { if (!(user.role === 'admin' && user.position === '대표')) rows = rows.filter(o => o.created_by_id === user.id); const q = sp.get('q'); if (q) rows = rows.filter(o => String(o.content).includes(q)); }
                else rows = rows.filter(o => o.created_by_id === user.id && !o.mine_hidden);
                return json(route, { orders: rows.slice(0, Number(sp.get('limit')) || 40) });
            });
            await pg.route('**/api/agent-office/desk/inbox*', route => { if (route.request().method() !== 'GET') return route.fallback(); return json(route, inboxOf(new URL(route.request().url()).searchParams.get('seen') === '1')); });
            await pg.route('**/api/agent-office/desk/board*', route => json(route, boardOf(user)));
            await pg.route('**/api/agent-office/files/*/download', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
            if (opt.old) {
                await pg.route('**/ao-desk.css*', route => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: OLD.css }));
                await pg.route('**/ao-desk.js*', route => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: OLD.js }));
            }
            const tok = jwt.sign(user, 'verifytest', { expiresIn: '60m' });
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u, th, lp]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', lp); localStorage.removeItem('akm_desk_view'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, [tok, user, opt.theme || null, opt.page || 'agent-office']);
            await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(2500);
            // 움직이는 곳(시계·날짜·커서) 고정 · 실DB 대기 확인표 창 숨김(#548 함정) · 전환 버튼은 비교에서 뺀다(opt.maskBtn)
            await pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important} #desk-clock,#desk-date,.desk-caret,#desk-char{visibility:hidden!important} *{caret-color:transparent!important}' + (opt.maskBtn ? ' #desk-theme{visibility:hidden!important}' : '') });
            if ((opt.page || 'agent-office') === 'agent-office') { await pg.waitForSelector('#desk-list .desk-thread-box, #desk-list .desk-empty', { timeout: 20000 }); await pg.waitForTimeout(1200); }
            return { pg, st, errors, ctx };
        };
        const shotBuf = pg => pg.screenshot({ fullPage: true, animations: 'disabled' });
        const save = (name, buf) => { try { fs.mkdirSync(SHOT, { recursive: true }); fs.writeFileSync(path.join(SHOT, name + '.png'), buf); } catch (_) { } return path.join(SHOT, name + '.png'); };
        const goHist = async pg => { await pg.click('#desk-tabs .desk-tab[data-tab="all"]'); await pg.waitForSelector('#desk-list .desk-h-item', { timeout: 15000 }); await pg.waitForTimeout(500); await pg.click('#desk-list .desk-h-item[data-th="900"] .desk-h-row'); await pg.waitForSelector('#desk-list .desk-h-item[data-th="900"].open', { timeout: 8000 }); await pg.waitForTimeout(400); };
        const goFull = async pg => { await pg.click('#desk-tabs .desk-tab[data-tab="mine"]'); await pg.waitForSelector('#desk-list .desk-thread-box', { timeout: 15000 }); await pg.click('#desk-list-more'); await pg.waitForSelector('.desk-listbox.is-full', { timeout: 8000 }); await pg.waitForTimeout(600); };
        const openBoard = async pg => { if (await pg.evaluate(() => { const b = document.getElementById('desk-board-fold'); return b.getClientRects().length > 0 && b.getAttribute('aria-expanded') !== 'true'; })) { await pg.click('#desk-board-fold'); await pg.waitForTimeout(350); } };
        const ibTab = async (pg, k) => { await pg.click('#desk-inbox-tabs button[data-k="' + k + '"]'); await pg.waitForTimeout(350); };
        const ibOpenFirst = async pg => { const row = pg.locator('#desk-inbox-list tr.desk-ib-row').first(); if (await row.count()) { await row.click(); await pg.waitForTimeout(300); return 'row'; } const more = pg.locator('#desk-inbox-list [data-ib="more"]').first(); if (await more.count()) { await more.click(); await pg.waitForTimeout(300); } return 'card'; };
        const ibSeen = async (pg, on) => { if ((await pg.isChecked('#desk-inbox-seen')) !== on) { await pg.click('#desk-inbox-seen'); await pg.waitForTimeout(700); } };
        const attr = pg => pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme') || '');

        // ══ A. 밝은 화면 무회귀 — 종전(git HEAD) vs 지금(전환 끔) 스크린샷 픽셀 비교 ═══════════════════════
        for (const [who, user] of [['대표', owner], ['직원', staff]]) {
            for (const [dev, vw, phone] of [['PC', { width: 1440, height: 1000 }, false], ['폰', { width: 390, height: 844 }, true]]) {
                const A = await open(user, vw, { old: true, phone }), B = await open(user, vw, { phone, maskBtn: true });
                const diffs = [];
                for (const P of [A, B]) await openBoard(P.pg);
                const goIb = async pg => { await ibSeen(pg, true); await ibTab(pg, 'qna'); await ibOpenFirst(pg); };
                const goIb2 = async pg => { await ibTab(pg, 'inquiry'); await ibOpenFirst(pg); };
                const goIb3 = async pg => { await ibTab(pg, 'talk'); await ibOpenFirst(pg); await ibSeen(pg, false); };
                for (const [view, go] of [['채팅', null], ['문의 상품Q&A 펼침·확인한 건', goIb], ['문의 주문 문의', goIb2], ['문의 톡톡', goIb3], ['이력', goHist], ['크게 보기', goFull]]) {
                    if (go) { await go(A.pg); await go(B.pg); }
                    const a = await shotBuf(A.pg), b = await shotBuf(B.pg);
                    if (!a.equals(b)) { diffs.push(view); save(`568-diff-${who}-${dev}-${view}-old`, a); save(`568-diff-${who}-${dev}-${view}-new`, b); }
                    if (view === '크게 보기') { for (const P of [A, B]) { await P.pg.keyboard.press('Escape'); await P.pg.waitForTimeout(300); } }
                }
                ok(`A [${who}·${dev}] 밝은 화면 = 종전과 픽셀 동일(채팅+현황판 펼침+문의 줄 · 문의 세 탭·줄 펼침·확인한 건 · 이력 펼침 · 크게 보기 — 전환 버튼 자리만 가림)`, diffs.length === 0 && (await attr(B.pg)) === '' && A.errors.length + B.errors.length === 0, diffs.join() + ' ' + [...A.errors, ...B.errors].join(' | '));
                await A.ctx.close(); await B.ctx.close();
            }
        }

        // ══ B. 어두운 화면 — 대비 자동 측정 · 흰 바탕으로 남은 칸 ═════════════════════════════════════
        const audit = pg => pg.evaluate(() => {
            const parse = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
            const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
            const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
            const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
            const bgOf = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); let c = parse(cs.backgroundColor); if (cs.backgroundImage && /gradient/.test(cs.backgroundImage)) { const g = cs.backgroundImage.match(/rgba?\([^)]+\)/g); if (g) c = parse(g[g.length - 1]); } if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; } } let base = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };
            const visible = el => { if (!el.getClientRects().length) return false; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false; } return true; };
            const opac = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
            const name = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
            const roots = [document.querySelector('.sidebar'), document.getElementById('page-agent-office'), document.querySelector('.mobile-menu-btn'), document.querySelector('.mobile-noti-btn'), document.getElementById('desk-zoom')].filter(Boolean);
            const fails = [], white = [], seen = new Set(); let texts = 0, dim = 0, minR = 99;
            for (const root of roots) {
                const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                for (let n = tw.nextNode(); n; n = tw.nextNode()) {
                    const t = n.nodeValue.trim(); if (!t) continue; const el = n.parentElement; if (!el || !visible(el) || el.closest('.desk-sr, [data-ao-legacy], script, style, option')) continue;
                    if (!/[0-9A-Za-z가-힣]/.test(t)) continue;   // 그림 글자·기호만 있는 토막 제외
                    const cs = getComputedStyle(el), fg0 = parse(cs.color); if (!fg0) continue;
                    const r0 = el.getBoundingClientRect(); if (r0.width < 2 || r0.height < 2) continue;
                    const bg = bgOf(el), o = opac(el), fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * o], bg);
                    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
                    const px = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700, need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
                    texts++;
                    if (el.closest('[disabled], [aria-disabled="true"]')) { dim++; continue; }   // 꺼진 버튼은 대비 기준 예외(WCAG)
                    minR = Math.min(minR, ratio);
                    if (ratio < need) { const k = name(el) + '|' + cs.color + '|' + bg.map(Math.round).slice(0, 3).join(); if (!seen.has(k)) { seen.add(k); fails.push(`${name(el)} 「${t.slice(0, 14)}」 ${ratio.toFixed(2)}:1(필요 ${need}) 글자 ${cs.color} 바탕 rgb(${bg.map(Math.round).slice(0, 3).join(',')})`); } }
                }
                for (const el of [root, ...root.querySelectorAll('*')]) {
                    if (!visible(el) || el.closest('[data-ao-legacy]') || /^(IMG|VIDEO|SVG|PATH|MARK)$/i.test(el.tagName)) continue;
                    const cs = getComputedStyle(el), c = parse(cs.backgroundColor); if (!c || c[3] < 0.9) continue;
                    const r = el.getBoundingClientRect(); if (r.width * r.height < 150) continue;
                    if (Math.min(c[0], c[1], c[2]) > 170) { /* 흰색에 가까운 바탕만(초록 막대 같은 색 표시는 제외) */ const k = name(el); if (!seen.has('w' + k)) { seen.add('w' + k); white.push(`${k} ${cs.backgroundColor} ${Math.round(r.width)}×${Math.round(r.height)}`); } }
                }
                for (const el of root.querySelectorAll('input, textarea')) {   // 안내 글(placeholder)
                    if (!visible(el) || !el.placeholder || el.value) continue;
                    const pc = parse(getComputedStyle(el, '::placeholder').color), bg = bgOf(el); if (!pc) continue;
                    const fg = over(pc, bg), ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05); texts++;
                    if (ratio < 4.5) fails.push(`${name(el)} 안내 글 ${ratio.toFixed(2)}:1`);
                }
            }
            const bodyBg = parse(getComputedStyle(document.body).backgroundColor), mainBg = parse(getComputedStyle(document.querySelector('.main-content')).backgroundColor);
            return { fails, white, texts, dim, minR: Number(minR.toFixed(2)), pageBg: bodyBg && mainBg ? [lum(bodyBg), lum(mainBg)].map(v => Number(v.toFixed(3))) : null, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
        });
        const report = (tag, a) => {
            ok(`B [${tag}] 대비 미달 0 (글자 ${a.texts}토막 측정 · 가장 낮은 대비 ${a.minR}:1 · 꺼진 버튼 ${a.dim}토막 제외)`, a.fails.length === 0, a.fails.slice(0, 12).join(' ‖ '));
            ok(`B [${tag}] 흰 바탕으로 남은 칸 0 · 화면 바탕도 어두움`, a.white.length === 0 && a.pageBg && a.pageBg.every(v => v < 0.05), a.white.slice(0, 10).join(' ‖ ') + ' ' + JSON.stringify(a.pageBg));
        };
        const paths = [];
        for (const [who, user] of [['대표', owner], ['직원', staff]]) {
            for (const [dev, vw, phone] of [['PC', { width: 1440, height: 1000 }, false], ['폰', { width: 390, height: 844 }, true]]) {
                const tag = who + '·' + dev;
                const D = await open(user, vw, { phone, state: who === '직원' ? 'offline' : 'idle' });
                ok(`C [${tag}] 처음 = 밝은 화면(속성 없음 · 버튼 「야간 화면으로 바꾸기」 · 눌림 false)`, (await attr(D.pg)) === '' && await D.pg.evaluate(() => { const b = document.getElementById('desk-theme'); return b.getAttribute('aria-label') === '야간 화면으로 바꾸기' && b.getAttribute('aria-pressed') === 'false' && !!b.querySelector('svg'); }));
                const br = await D.pg.evaluate(() => { const r = document.getElementById('desk-theme').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
                if (phone) await D.pg.tap('#desk-theme'); else await D.pg.click('#desk-theme');
                await D.pg.waitForTimeout(400);
                ok(`C [${tag}] 버튼 누름 → 어두운 화면(속성 dark · 기억 dark · 버튼 「밝은 화면으로 바꾸기」) · 버튼 ${br.join('×')}px`, (await attr(D.pg)) === 'dark' && await D.pg.evaluate(() => localStorage.getItem('akm_ao_theme') === 'dark' && document.getElementById('desk-theme').getAttribute('aria-pressed') === 'true') && br[0] >= (phone ? 44 : 40) && br[1] >= (phone ? 44 : 40));
                await openBoard(D.pg);
                let a = await audit(D.pg); report(tag + ' 채팅+현황판+문의', a);
                const ibN = await D.pg.evaluate(() => ({ rows: document.querySelectorAll('#desk-inbox-list tr.desk-ib-row, #desk-inbox-list .desk-ib').length, badge: document.getElementById('inbox-n-talk').textContent, wrap: document.querySelectorAll('#desk-inbox-list .table-scroll-wrapper').length, panels: document.querySelectorAll('#desk-board .desk-panel').length }));
                ok('B [' + tag + '] 시험 자료가 실제로 떴음 — 문의 ' + ibN.rows + '줄 · 톡톡 배지 ' + ibN.badge + ' · 현황판 ' + ibN.panels + '칸' + (phone ? '' : ' · 표 감싼 칸 ' + ibN.wrap), ibN.rows === 3 && ibN.badge === '3' && ibN.panels === (who === '대표' ? 4 : 3) && (phone || ibN.wrap === 1), JSON.stringify(ibN));
                for (const k of ['talk', 'qna', 'inquiry']) {
                    await ibSeen(D.pg, false); await ibTab(D.pg, k); a = await audit(D.pg); report(tag + ' 문의 ' + k, a);
                    await ibOpenFirst(D.pg); a = await audit(D.pg); report(tag + ' 문의 ' + k + ' 줄 펼침', a);
                    await ibSeen(D.pg, true); a = await audit(D.pg); report(tag + ' 문의 ' + k + ' 확인한 건도 보기', a);
                    if (!phone) { const r2 = D.pg.locator('#desk-inbox-list tr.desk-ib-row').nth(1); if (await r2.count()) { await r2.hover(); await D.pg.waitForTimeout(120); a = await audit(D.pg); report(tag + ' 문의 ' + k + ' 줄 hover', a); await D.pg.mouse.move(2, 2); } }
                }
                await D.pg.click('#desk-inbox-more').catch(() => { }); if (await D.pg.locator('.desk-inbox.is-full').count()) { await D.pg.waitForTimeout(500); a = await audit(D.pg); report(tag + ' 문의 크게 보기', a); await D.pg.keyboard.press('Escape'); await D.pg.waitForTimeout(300); }
                await ibSeen(D.pg, false); await ibTab(D.pg, 'talk');
                ok(`B [${tag}] 가로 넘침 없음`, !a.overflow);
                if (who === '대표') await D.pg.evaluate(() => document.querySelectorAll('#desk-clock, #desk-date, #desk-char').forEach(e => e.style.setProperty('visibility', 'visible', 'important')));
                if (who === '대표') { await D.pg.evaluate(() => window.scrollTo(0, 0)); await D.pg.waitForTimeout(200); }
                if (who === '대표') paths.push(save(`568-대표확인-${phone ? '폰' : 'PC'}-메인`, await D.pg.screenshot({ fullPage: false, animations: 'disabled' })));
                if (who === '대표') {
                    // 대표 확정 3가지 실측
                    const m = await D.pg.evaluate(() => { const g = (s, p) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[p] : null; }; return {
                        chip: ['backgroundColor', 'borderTopColor', 'color'].map(p => g('#desk-qty-now', p)), state: ['backgroundColor', 'borderTopColor', 'color'].map(p => g('#desk-state', p)),
                        label: g('#desk-list .desk-a.answer .desk-a-label', 'color'), title: g('#desk-list .desk-a.answer .desk-a-title', 'color'), bar: g('#desk-list .desk-a.answer', 'borderLeftColor'), lime: getComputedStyle(document.documentElement).getPropertyValue('--d-lime').trim() }; });
                    const hex = c => { const p = c.match(/\d+/g).map(Number); return '#' + p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase(); };
                    ok(`B [${tag}] 「중간발주」 버튼 = 「대기 중」 알약과 같은 바탕·테두리·흰 글씨`, m.chip[0] === m.state[0] && m.chip[1] === m.state[1] && m.chip[2] === m.state[2] && m.chip[2] === 'rgb(255, 255, 255)', JSON.stringify([m.chip, m.state]));
                    ok(`B [${tag}] 「클코 답변」 표지 · 답 제목 · 답 상자 왼쪽 선 = 라임(${m.lime})`, !!m.label && [m.label, m.title, m.bar].every(c => hex(c) === m.lime.toUpperCase()), [m.label, m.title, m.bar].join(' / '));
                }
                // 상태: hover · focus · active(누르고 있는 중) — 상태를 건 채로 다시 측정
                const stFails = [];
                for (const sel of ['#desk-qty-now', '#desk-list .desk-a-acts .desk-btn', '#desk-list .desk-sec-copy', '#desk-tabs .desk-tab[data-tab="all"]', '#desk-list .desk-endbtn', '#desk-theme', '.sidebar .nav-item[data-page="schedule"]', '#desk-list-more']) {
                    const loc = D.pg.locator(sel).first(); if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) continue;
                    if (!phone) { await loc.hover().catch(() => { }); await D.pg.waitForTimeout(120); const h = await audit(D.pg); h.fails.forEach(f => stFails.push('hover ' + sel + ' → ' + f)); h.white.forEach(f => stFails.push('hover 흰 칸 ' + f)); await D.pg.mouse.down(); await D.pg.waitForTimeout(80); const ac = await audit(D.pg); ac.fails.forEach(f => stFails.push('active ' + sel + ' → ' + f)); await D.pg.mouse.move(2, 2); await D.pg.mouse.up(); }
                    await loc.focus().catch(() => { }); await D.pg.waitForTimeout(80); const fo = await audit(D.pg); fo.fails.forEach(f => stFails.push('focus ' + sel + ' → ' + f));
                }
                await D.pg.fill('#desk-input', '시험 글'); await D.pg.waitForTimeout(150); { const t = await audit(D.pg); t.fails.forEach(f => stFails.push('입력 중 → ' + f)); t.white.forEach(f => stFails.push('입력 중 흰 칸 ' + f)); } await D.pg.fill('#desk-input', '');
                ok(`B [${tag}] 상태(hover · focus · active · 입력 중 · 꺼진 보내기)에서도 대비 미달·흰 칸 0`, stFails.length === 0, [...new Set(stFails)].slice(0, 8).join(' ‖ '));
                // 이력 · 검색 형광 · 크게 보기
                await goHist(D.pg); a = await audit(D.pg); report(tag + ' 이력 펼침', a);
                if (who === '대표') await D.pg.evaluate(() => document.querySelectorAll('#desk-clock, #desk-date, #desk-char').forEach(e => e.style.setProperty('visibility', 'visible', 'important')));
                if (who === '대표') paths.push(save(`568-대표확인-${phone ? '폰' : 'PC'}-답변펼침`, await D.pg.screenshot({ fullPage: false, animations: 'disabled' })));
                await D.pg.fill('#desk-hist-q', '황금향'); await D.pg.waitForTimeout(900); a = await audit(D.pg); report(tag + ' 이력 검색(형광)', a);
                const hl = await D.pg.evaluate(() => { const m = document.querySelector('#desk-list mark.desk-hl'); if (!m) return null; return getComputedStyle(m).backgroundColor; });
                ok(`B [${tag}] 검색 형광 표시가 뜸(어두운 화면용 색)`, !!hl && hl !== 'rgb(255, 243, 176)', hl);
                await D.pg.fill('#desk-hist-q', ''); await D.pg.waitForTimeout(600);
                await goFull(D.pg); a = await audit(D.pg); report(tag + ' 크게 보기', a); await D.pg.keyboard.press('Escape'); await D.pg.waitForTimeout(300);
                // 표 보기(PC)
                if (!phone) {
                    await D.pg.click('#desk-tabs .desk-tab[data-tab="mine"]'); await D.pg.waitForTimeout(500);
                    await D.pg.evaluate(() => { localStorage.setItem('akm_desk_view', 'table'); window.__aoDesk.S.view = 'table'; window.__aoDesk.renderList(); }); await D.pg.waitForTimeout(500);
                    const tv = await D.pg.evaluate(() => ({ rows: document.querySelectorAll('#desk-list .desk-table tr.row').length, wrap: document.querySelectorAll('#desk-list .table-scroll-wrapper').length }));
                    ok('B [' + tag + '] 표 보기 화면이 실제로 떴음(줄 ' + tv.rows + ' · 표 감싼 칸 ' + tv.wrap + ')', tv.rows > 3 && tv.wrap === 1);
                    a = await audit(D.pg); report(tag + ' 표 보기', a);
                    await D.pg.click('#desk-list .desk-table tr.row >> nth=0'); await D.pg.waitForTimeout(400); a = await audit(D.pg); report(tag + ' 표 보기 줄 펼침', a);
                    await D.pg.hover('#desk-list .desk-table tr.row >> nth=2'); await D.pg.waitForTimeout(150); a = await audit(D.pg); report(tag + ' 표 보기 줄 hover', a); await D.pg.mouse.move(2, 2);
                    await D.pg.evaluate(() => { localStorage.removeItem('akm_desk_view'); window.__aoDesk.S.view = 'chat'; window.__aoDesk.renderList(); }); await D.pg.waitForTimeout(400);
                }
                // 전환: 새로고침 뒤 유지 · 다른 메뉴 → 밝게 · 돌아오면 다시 어둡게 · 끄기
                await D.pg.reload({ waitUntil: 'networkidle' }); await D.pg.waitForTimeout(2500);
                ok(`C [${tag}] 새로고침 뒤에도 어두운 화면 유지`, (await attr(D.pg)) === 'dark');
                await D.pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important}' });
                const nav = async p => { if (phone && await D.pg.evaluate(() => !document.querySelector('.sidebar').classList.contains('mobile-open'))) { await D.pg.click('.mobile-menu-btn'); await D.pg.waitForTimeout(450); } await D.pg.click(`.sidebar-nav .nav-item[data-page="${p}"]`); await D.pg.waitForTimeout(700); };
                if (phone) { await D.pg.click('.mobile-menu-btn'); await D.pg.waitForTimeout(450); a = await audit(D.pg); report(tag + ' 메뉴 열림', a); }
                await nav('myinfo');
                const away = await D.pg.evaluate(() => ({ attr: document.documentElement.getAttribute('data-ao-theme') || '', body: getComputedStyle(document.body).backgroundColor, side: getComputedStyle(document.querySelector('.sidebar')).backgroundColor }));
                ok(`C [${tag}] 다른 메뉴(내 정보)로 가면 밝은 화면(속성 없음 · 바탕·왼쪽 메뉴 밝은 색)`, away.attr === '' && away.side === 'rgb(255, 255, 255)' && away.body !== 'rgb(14, 17, 34)', JSON.stringify(away));
                await nav('agent-office'); await D.pg.waitForTimeout(600);
                ok(`C [${tag}] 에이전트 오피스로 돌아오면 다시 어두운 화면`, (await attr(D.pg)) === 'dark');
                if (phone) await D.pg.tap('#desk-theme'); else await D.pg.click('#desk-theme'); await D.pg.waitForTimeout(300);
                ok(`C [${tag}] 다시 누르면 밝은 화면(속성 없음 · 기억 light)`, (await attr(D.pg)) === '' && await D.pg.evaluate(() => localStorage.getItem('akm_ao_theme') === 'light'));
                ok(`C [${tag}] 화면 오류 0 · 전환이 서버에 보낸 요청 0`, D.errors.length === 0 && D.st.writes.length === 0, D.errors.join(' | ') + D.st.writes.join());
                await D.ctx.close();
            }
        }

        // ══ D. 전환을 켠 사람의 다른 메뉴 화면 = 안 켠 사람과 픽셀 동일 ═══════════════════════════════════
        for (const [dev, vw, phone] of [['PC', { width: 1440, height: 1000 }, false], ['폰', { width: 390, height: 844 }, true]]) {
            const bad = [], moving = [];
            for (const page of ['myinfo', 'schedule', 'worklog', 'planner']) {
                const L = await open(owner, vw, { phone, page }), K = await open(owner, vw, { phone, page, theme: 'dark' });
                const a = await shotBuf(L.pg), b = await shotBuf(K.pg);
                const a2 = a.equals(b) ? a : await shotBuf(L.pg);   // 다르면 밝은 사람 화면을 한 번 더 찍어 본다 — 그것끼리도 다르면 스스로 움직이는 화면(비교 불가)
                if (!a.equals(b) && !a.equals(a2)) { moving.push(page); } else if (!a.equals(b) || (await attr(K.pg)) !== '') { bad.push(page); save(`568-other-${dev}-${page}-light`, a); save(`568-other-${dev}-${page}-darkuser`, b); }
                await L.ctx.close(); await K.ctx.close();
            }
            ok(`D [대표·${dev}] 야간 화면을 켠 사람도 다른 메뉴(내 정보 · 일정 · 업무일지 · 마이 플래너)는 종전과 픽셀 동일 · 속성 없음${moving.length ? ' (스스로 움직여 비교 못 한 화면: ' + moving.join() + ')' : ''}`, bad.length === 0 && moving.length <= 1, bad.join());
        }
        // 저장소가 막힌 브라우저(localStorage 예외)에서도 화면이 뜬다
        {
            const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
            const res = await pg.evaluate(() => 1).then(() => true);
            ok('E 전환 코드 문법(node --check 는 따로) · 기억 읽기·쓰기는 try/catch 로 감쌈', res && /try \{ return localStorage\.getItem\(THEME_KEY\)/.test(fs.readFileSync(path.join(ROOT, 'public/ao-desk.js'), 'utf8')) && /try \{ localStorage\.setItem\(THEME_KEY/.test(fs.readFileSync(path.join(ROOT, 'public/ao-desk.js'), 'utf8')));
            await ctx.close();
        }
        console.log('\n대표 확인용 스크린샷:\n' + paths.join('\n'));
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 10).join(' / ') : String(e)); }
    finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) srv.kill();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
