// #499·#500 검증: 에이전트 오피스 「내 지시」 대화 보기 + 카드 안 승인/반려 + 폰 현황판 접기 + (#500) 늘 열린 답 칸·답에 이미지 1장·답 칸 Enter
//   #500 서버 reply 라우트 실검증만 실DB에 [검증469] 시험 지시 2건을 만들고 끝에 숨김·취소한다(그 밖의 쓰기는 전부 가로챔).
//   사용: node scripts/verify-499-chat.js [스크린샷 폴더]
//   로컬 실서버 3459(스케줄러 차단) · desk/orders 응답과 모든 쓰기 요청을 page.route로 가로챈다 → 이 스크립트의 DB 쓰기 0(로그인 우회용 대표 계정 id·이름만 읽음).
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = 3459;
const SHOT = process.argv[2] || null;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };
const info = msg => console.log('ℹ️ ' + msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(200); } return null; };

(async () => {
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'desk499-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'desk499-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        await db.end();
        const user = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' };
        const tok = jwt.sign(user, 'verifytest', { expiresIn: '20m' });

        // ── 가짜 지시 목록
        const t0 = Date.now() - 3600e3;
        const at = id => new Date(t0 + id * 1000).toISOString();
        const O = (id, content, extra) => Object.assign({ id, content, status: '완료', created_at: at(id), processed_at: at(id + 0.5), created_by: '검증499', created_by_id: user.id, has_image: false, reply_to: null, followed_by: null,
            steps: [{ t: at(id), kind: 'order', actor: '클코', text: '📥 지시 접수' }], result: { type: 'desk_answer', answer: `${id}번 답변입니다.` } }, extra || {});
        const LIVE = '판매중 품목은 27개입니다.\n' + Array.from({ length: 50 }, (_, i) => `${i + 1}번째 줄 — 길게 이어지는 답변 글입니다 황금향 가정용 3kg 33,500원`).join('\n');
        const seed = () => [
            O(10, '옛 지시 하나'), O(11, '옛 지시 둘'), O(12, '옛 지시 셋'),
            O(120, '꼬리만 남은 지시', { reply_to: 50 }),
            O(130, '혼자 있는 지시', { result: { type: 'desk_answer', title: '혼자 답', answer: '| 품목 | 수량 |\n|---|---:|\n| 황금향 | 120 |\n\n**굵은 글**' } }),
            O(140, '지금 처리 중인 지시', { status: '처리중', processed_at: null, steps: [{ t: at(140), kind: 'order', actor: '클코', text: '📥 지시 접수' }, { t: at(141), kind: 'step', actor: '클코', text: '🔎 회사프로그램 자료 조회 중' }, { t: at(142), kind: 'step', actor: '클코', text: '✍️ 답변 정리 중' }], result: { type: 'live', text: LIVE } }),
            O(150, '단골에게 쿠폰 문자 보내줘', { status: '질문', result: { type: 'question', question: '대상이 몇 명인가요? 50명이 넘으면 한 번 더 확인합니다.' } }),
            O(160, '가입 쿠폰 3,000원으로 올려줘', { status: '승인대기', result: { type: 'approval_request', action: 'coupon', summary: '가입 쿠폰 2,000원 → 3,000원', impact: '신규 가입자 전원', plan: '카페24 쿠폰 설정 변경' } }),
            O(161, '황금향 가격 내려줘', { status: '승인대기', result: { type: 'approval_request', action: 'price', summary: '황금향 3kg 33,500 → 31,500', impact: '판매가', plan: '네이버·자사몰 가격 변경' } }),
            O(200, '추석 감사 문자 문구 만들어줘', { result: { type: 'desk_answer', title: '문구 3안', answer: '1번 문구\n2번 문구\n3번 문구' } }),
            O(201, '2번을 더 짧게', { reply_to: 200 }),
            O(202, '이모지 빼줘', { reply_to: 201 }),
            O(210, '중간발주 뽑아줘', { steps: [{ t: at(210), kind: 'order', actor: '클코', text: '📥 지시 접수' }, { t: at(210), kind: 'lane', lane: 'direct', actor: '클코', text: '⚡ 바로 집계' }] }),
            O(211, '대성 것만 다시', { reply_to: 210 }),
            O(212, '효돈 것만 다시', { reply_to: 210 }),
        ];

        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const open = async (vw, extra, view) => {
            const st = { orders: seed(), gets: 0, writes: [], dialogs: 0, nextId: 300 };
            const ctx = await browser.newContext(Object.assign({ viewport: vw }, extra || {}));
            const pg = await ctx.newPage();
            const errors = [], cons = [];
            pg.on('pageerror', e => errors.push(String(e)));
            pg.on('console', m => { if (m.type() === 'error') cons.push(m.text().slice(0, 200)); });
            pg.on('dialog', d => { st.dialogs++; d.dismiss(); });
            const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
            // 모든 쓰기 요청을 가로챈다(실DB 무변경)
            await pg.route('**/api/**', route => {
                const rq = route.request();
                if (rq.method() === 'GET') return route.continue();
                const p = new URL(rq.url()).pathname; let body = null; try { body = JSON.parse(rq.postData() || 'null'); } catch (_) { }
                st.writes.push({ m: rq.method(), p, body });
                let m;
                if (p === '/api/agent-office/orders') { const o = O(st.nextId++, body && body.content, { status: '대기', processed_at: null, result: null, steps: [], created_at: new Date().toISOString() }); st.orders.push(o); return json(route, { ok: true, engine: 'desk', order: o }); }
                if ((m = /\/orders\/(\d+)\/reply$/.exec(p))) { const o = O(st.nextId++, body && body.content, { status: '대기', processed_at: null, result: null, steps: [], reply_to: Number(m[1]), created_at: new Date().toISOString(), has_image: !!(body && body.image_data) }); st.orders.push(o); const q = st.orders.find(x => x.id === Number(m[1])); if (q && q.status === '질문') q.status = '질문종결'; return json(route, { message: '답을 보냈어요', order: { id: o.id, status: '대기' } }); }
                if ((m = /\/orders\/(\d+)\/hide-mine$/.exec(p))) { st.orders = st.orders.filter(x => x.id !== Number(m[1])); return json(route, { message: '내 지시에서 지웠습니다' }); }
                if ((m = /\/orders\/(\d+)\/approve$/.exec(p))) { const q = st.orders.find(x => x.id === Number(m[1])); if (q) { q.status = '승인됨'; q.result.approved_by = '검증499 대표'; } return json(route, { message: '승인했습니다 — 창구가 실행합니다' }); }
                if ((m = /\/orders\/(\d+)\/reject$/.exec(p))) { const q = st.orders.find(x => x.id === Number(m[1])); if (q) { q.status = '반려'; q.result.rejected_by = '검증499 대표'; q.result.reject_reason = body && body.reason; } return json(route, { message: '반려했습니다' }); }
                return json(route, { ok: true });
            });
            await pg.route('**/api/agent-office/desk/orders*', route => {
                if (route.request().method() !== 'GET') return route.fallback();
                st.gets++;
                const u = new URL(route.request().url());
                st.lastQuery = u.search;
                return json(route, { orders: st.orders.slice().sort((a, b) => b.id - a.id) });
            });
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u, v]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); if (v) localStorage.setItem('akm_desk_view', v); else localStorage.removeItem('akm_desk_view'); }, [tok, user, view || null]);
            const enter = async () => {
                await pg.reload({ waitUntil: 'networkidle' });
                await pg.waitForTimeout(2500);
                await pg.evaluate(() => { const n = document.querySelector('.nav-item[data-page="agent-office"]'); if (n) n.click(); else if (typeof switchPage === 'function') switchPage('agent-office'); });
                await pg.waitForSelector('#desk-list .desk-thread-box, #desk-list .desk-card, #desk-list .desk-table, #desk-list .desk-empty', { timeout: 20000 });
                await pg.waitForTimeout(800);
            };
            await enter();
            return { pg, st, errors, cons, ctx, enter };
        };
        const shot = async (pg, name, sel) => {
            if (!SHOT) return;
            try { fs.mkdirSync(SHOT, { recursive: true }); if (sel) { await pg.evaluate(s => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'start' }); }, sel); await sleep(350); } await pg.screenshot({ path: path.join(SHOT, name + '.png'), fullPage: false }); } catch (e) { info('스크린샷 실패: ' + e.message); }
        };
        // 대화 보기 상태 읽기(재렌더마다 selector로 다시 찾는다)
        const chat = pg => pg.evaluate(() => {
            const vis = el => !!el && el.getClientRects().length > 0;
            const boxes = Array.from(document.querySelectorAll('#desk-list .desk-thread-box'));
            const vb = document.getElementById('desk-view');
            return {
                table: !!document.querySelector('#desk-list .desk-table'), cards: document.querySelectorAll('#desk-list .desk-card').length,
                viewBtn: vb ? { vis: vis(vb), text: vb.textContent.trim(), hidden: vb.hidden } : null, stored: localStorage.getItem('akm_desk_view'),
                threads: boxes.map(b => ({
                    th: Number(b.dataset.th), vis: vis(b), ov: b.classList.contains('ov'), head: (b.querySelector('.desk-th-head') || {}).textContent.replace(/\s+/g, ' ').trim(),
                    x: !!b.querySelector('[data-act="endchat"]'),   // #538 × 대신 [채팅 종료]
                    turns: Array.from(b.querySelectorAll('.desk-turn')).map(t => ({ id: Number(t.dataset.oid), last: t.classList.contains('last'), me: (t.querySelector('.desk-bub.me .desk-q') || {}).textContent, meta: (t.querySelector('.desk-bub-meta') || {}).textContent,
                        badge: (t.querySelector('.desk-bub.ai .desk-badge') || {}).textContent, ai: (t.querySelector('.desk-bub.ai') || {}).textContent.replace(/\s+/g, ' ').trim().slice(0, 160),
                        reply: Array.from(t.querySelectorAll('textarea.desk-reply-in[id^="reply-"]')).filter(vis).length, send: Array.from(t.querySelectorAll('[data-act="sendreply"]')).filter(vis).map(b => b.getAttribute('aria-label') || b.textContent.trim()), imgBtn: Array.from(t.querySelectorAll('[data-act="replyimg"]')).filter(vis).length,
                        followVis: Array.from(t.querySelectorAll('[data-act="follow"]')).filter(vis).length, followDom: t.querySelectorAll('[data-act="follow"]').length })),
                })),
                more: (document.getElementById('desk-list-more') || {}).textContent.replace(/\s+/g, ' ').trim(), full: document.getElementById('desk-listbox').classList.contains('is-full'),
                rootOverflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
            };
        });
        const geo = (pg, id) => pg.evaluate(id => {
            const t = document.querySelector(`#desk-list .desk-turn[data-oid="${id}"]`); if (!t) return null;
            const r = t.getBoundingClientRect(), me = t.querySelector('.desk-bub.me').getBoundingClientRect(), ai = t.querySelector('.desk-bub.ai').getBoundingClientRect();
            return { meRight: Math.abs(me.right - r.right) <= 2, meLeftGap: Math.round(me.left - r.left), aiLeft: Math.abs(ai.left - r.left) <= 2, meAbove: me.bottom <= ai.top + 1, meIn: me.left >= r.left - 1, aiIn: ai.right <= r.right + 1, w: Math.round(r.width) };
        }, id);
        const posts = (S, re) => S.st.writes.filter(w => re.test(w.p));
        const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';   // 1×1 그림
        const pasteImg = (pg, sel) => pg.evaluate(([sel, b64]) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u], 'shot.png', { type: 'image/png' })); const el = document.querySelector(sel); el.focus(); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return { prevented: ev.defaultPrevented, files: ev.clipboardData ? ev.clipboardData.files.length : -1 }; }, [sel, PNG]);
        const rst = (pg, id) => pg.evaluate(id => { const t = document.querySelector(`#desk-list .desk-turn[data-oid="${id}"]`); if (!t) return null; const vis = el => !!el && el.getClientRects().length > 0; const img = t.querySelector('.desk-reply-thumbs img'), ta = document.getElementById('reply-' + id); const b = t.getBoundingClientRect(), ir = img ? img.getBoundingClientRect() : null; return { thumb: vis(img), thumbs: t.querySelectorAll('.desk-reply-thumbs img').length, src: img ? img.src.slice(0, 40) : '', x: vis(t.querySelector('[data-act="replyimgx"]')), val: ta ? ta.value : null, focus: document.activeElement === ta, imgBtn: Array.from(t.querySelectorAll('[data-act="replyimg"]')).filter(vis).length, thumbIn: ir ? ir.left >= b.left - 1 && ir.right <= b.right + 1 : null }; }, id);

        // ════ 1440px
        const A = await open({ width: 1440, height: 950 });
        let c = await chat(A.pg);
        ok('기본 = 대화 보기(표·카드 아님) · [표로 보기] 버튼은 숨김(#504) · 저장값 없음', c.threads.length > 0 && !c.table && c.cards === 0 && c.viewBtn && !c.viewBtn.vis && c.viewBtn.hidden && c.stored === null, `대화 ${c.threads.length}개 · 버튼 「${c.viewBtn && c.viewBtn.text}」`);
        ok('목록 요청에 limit 60', /limit=60/.test(A.st.lastQuery || ''), A.st.lastQuery);
        const order = c.threads.map(t => t.th);
        ok('대화 묶음 10개 · 최신 대화가 위(마지막 지시 번호 순)', JSON.stringify(order) === JSON.stringify([210, 200, 161, 160, 150, 140, 130, 120, 12, 11, 10].filter(x => order.includes(x))) && order.length === 11 - 0 ? true : JSON.stringify(order) === JSON.stringify([210, 200, 161, 160, 150, 140, 130, 120, 12, 11, 10]), JSON.stringify(order));
        const T = id => c.threads.find(t => t.th === id);
        ok('3건 사슬(200→201→202) = 한 대화 · 대화 안은 시간순 · 「3번 주고받음」', !!T(200) && JSON.stringify(T(200).turns.map(t => t.id)) === '[200,201,202]' && /3번 주고받음/.test(T(200).head), T(200) && T(200).head);
        ok('가지 2개(210 ← 211·212) = 한 대화 · 시간순 · 「3번 주고받음」', !!T(210) && JSON.stringify(T(210).turns.map(t => t.id)) === '[210,211,212]' && /3번 주고받음/.test(T(210).head), T(210) && T(210).head);
        ok('부모가 목록 밖인 꼬리(120 ← 50) = 따로 한 대화 · 머리에 「↳ 50번에 이어서」', !!T(120) && T(120).turns.length === 1 && /↳ 50번에 이어서/.test(T(120).head) && !/주고받음/.test(T(120).head), T(120) && T(120).head);
        ok('1건짜리 = 「n번 주고받음」 없음', !!T(130) && T(130).turns.length === 1 && !/주고받음/.test(T(130).head));
        const g200 = await geo(A.pg, 200), g140 = await geo(A.pg, 140);
        ok('내 글 = 오른쪽 말풍선 · 클코 답 = 왼쪽 · 내 글이 위', !!g200 && g200.meRight && g200.meLeftGap > 40 && g200.aiLeft && g200.meAbove && g200.aiIn, JSON.stringify(g200));
        ok('내 말풍선 = 지시 글 + 「n번 · 시각」 · 클코 말풍선 = 답(끝난 차례엔 배지 없음)', T(200).turns[0].me === '추석 감사 문자 문구 만들어줘' && /^200번 · /.test(T(200).turns[0].meta) && !T(200).turns[0].badge && /1번 문구/.test(T(200).turns[0].ai) && /201번 답변/.test(T(200).turns[1].ai));
        const allTurns = c.threads.flatMap(t => t.turns.map(x => Object.assign({ th: t.th }, x)));
        const DONE = [120, 130, 202, 212];   // 미리보기에 보이는 끝난 대화의 마지막 차례(10·11·12는 [자세히 확인하기] 안)
        ok('#500 대화 보기 = 끝난 대화의 마지막 차례마다 답 칸이 누르지 않아도 열려 있음([이어서 보내기]·[이미지 첨부]) · [이어서 지시]·[취소] 버튼 없음', DONE.every(id => { const x = allTurns.find(t => t.id === id); return x && x.last && x.reply === 1 && x.send.join() === '이어서 보내기' && x.imgBtn === 1; }) && allTurns.every(x => x.followDom === 0), JSON.stringify(allTurns.filter(x => DONE.includes(x.id)).map(x => [x.id, x.reply, x.imgBtn])));
        ok('#500 가운데 차례(200·201·210·211)엔 답 칸 없음 · 처리 중(140)·승인대기(160·161) 대화에도 없음 · 되묻기(150)는 답 칸 1개만(「답 보내기」)', [200, 201, 210, 211, 140, 160, 161].every(id => allTurns.find(t => t.id === id).reply === 0) && allTurns.find(t => t.id === 150).reply === 1 && allTurns.find(t => t.id === 150).send.join() === '답 보내기', JSON.stringify(allTurns.map(x => [x.id, x.reply])));
        ok('× = 끝난 대화에만 · 진행 중·되묻기·승인대기 든 대화엔 없음', T(200).x && T(210).x && T(130).x && T(120).x && !T(140).x && !T(160).x && !T(161).x, JSON.stringify(c.threads.map(t => [t.th, t.x])));
        info(`참고: 되묻기(질문) 대화의 × = ${T(150).x} (hide-mine 서버 규칙은 「질문」 상태를 지울 수 있는 것으로 봄)`);
        const visTh = c.threads.filter(t => t.vis).map(t => t.th), hidTh = c.threads.filter(t => !t.vis).map(t => t.th);
        ok('미리보기 = 답할 것 없는 대화 5개 + 되묻기·승인대기 대화는 늘 보임 · 나머지 3개는 [자세히 확인하기]에', JSON.stringify(visTh) === '[210,200,161,160,150,140,130,120]' && JSON.stringify(hidTh) === '[12,11,10]' && /3건 더/.test(c.more), `보임 ${visTh.join(',')} · 숨김 ${hidTh.join(',')} · 「${c.more}」`);
        ok('가로 넘침 없음(1440)', !c.rootOverflow && !c.docOverflow);
        await shot(A.pg, '1-1440-대화보기', '#desk-listbox');

        // 답 안의 표·굵게(md)가 대화에서도 그려짐
        const md = await A.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-turn[data-oid="130"]'); return { table: t.querySelectorAll('table.desk-md-t').length, strong: t.querySelectorAll('strong').length, num: (t.querySelector('td.num') || {}).textContent, title: (t.querySelector('.desk-a-title') || {}).textContent, lane: (document.querySelector('#desk-list .desk-turn[data-oid="210"] .desk-lane') || {}).textContent }; });
        ok('대화 안 답변도 표·굵게·제목 · 길 표시(⚡ 바로 집계)', md.table === 1 && md.strong === 1 && md.num === '120' && md.title === '혼자 답' && /바로 집계/.test(md.lane || ''), JSON.stringify(md));

        // 처리 중 live
        const live = () => A.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-turn[data-oid="140"]'); const l = t && t.querySelector('.desk-a.answer.live'), sc = t && t.querySelector('[data-live]'); const vis = el => !!el && el.getClientRects().length > 0; return { live: vis(l), caret: vis(t && t.querySelector('.desk-caret')), text: sc ? sc.textContent : '', top: sc ? sc.scrollTop : 0, max: sc ? sc.scrollHeight - sc.clientHeight : 0, steps: t ? t.querySelectorAll('.desk-steps li').length : 0, working: t ? (t.querySelector('.desk-working') || {}).textContent : '', label: l ? (l.querySelector('.desk-a-label') || {}).textContent : '' }; });
        const l1 = await live();
        ok('처리 중 대화 — 쓰는 중인 답(.live) + 커서 + 단계 목록 · 글 칸이 맨 아래', l1.live && l1.caret && /쓰는 중/.test(l1.label) && l1.steps === 3 && l1.max > 0 && l1.max - l1.top < 3, JSON.stringify({ steps: l1.steps, top: l1.top, max: l1.max }));
        A.st.orders.find(o => o.id === 140).result = { type: 'live', text: LIVE + '\n51번째 줄 추가\n52번째 줄 추가' };
        const l2 = await waitFor(async () => { const s = await live(); return s.text.includes('52번째 줄') ? s : null; }, 8000);
        ok('글이 길어지면 화면도 길어지고 계속 맨 아래를 따라감(자동 새로고침)', !!l2 && l2.max > l1.max && l2.max - l2.top < 3, l2 ? `${l2.top}/${l2.max}` : '8초 안에 안 바뀜');
        await A.pg.evaluate(() => { document.querySelector('#desk-list .desk-turn[data-oid="140"] [data-live]').scrollTop = 100; });
        A.st.orders.find(o => o.id === 140).result = { type: 'live', text: LIVE + '\n51번째 줄 추가\n52번째 줄 추가\n53번째 줄 추가' };
        const l3 = await waitFor(async () => { const s = await live(); return s.text.includes('53번째 줄') ? s : null; }, 8000);
        ok('위로 올려 읽는 중이면 새 글이 와도 그 자리 유지', !!l3 && Math.abs(l3.top - 100) <= 2, l3 ? `${l3.top}/${l3.max}` : '');
        const pageY = await A.pg.evaluate(() => { const m = document.scrollingElement; return m.scrollTop; });
        await shot(A.pg, '2-1440-처리중', '#desk-list .desk-thread-box[data-th="140"]');

        // 되묻기 답 칸
        const q0 = await A.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-turn[data-oid="150"]'); const ta = document.getElementById('reply-150'); return { q: t.textContent.includes('대상이 몇 명인가요'), ta: !!ta && ta.getClientRects().length > 0, btn: !!t.querySelector('[data-act="sendreply"]'), badge: (t.querySelector('.desk-badge') || {}).textContent }; });
        ok('되묻기 대화 — 클코 질문 + 답 칸이 대화 안에 바로 보임', q0.q && q0.ta && q0.btn, JSON.stringify(q0));
        await shot(A.pg, '3-1440-되묻기', '#desk-list .desk-thread-box[data-th="150"]');
        const pq = await pasteImg(A.pg, '#reply-150');
        const tq = await waitFor(async () => { const x = await rst(A.pg, 150); return x && x.thumb ? x : null; }, 4000);
        ok('#500 되묻기 답 칸에 이미지 붙여넣기 → 칸 위 썸네일(× 있음)', pq.prevented && !!tq && /^data:image\/png;base64,/.test(tq.src) && tq.x, JSON.stringify(pq));
        info('참고: 되묻기 답 칸의 [이미지 첨부] 버튼 = ' + (tq ? tq.imgBtn : '?') + '개(0이면 붙여넣기로만 넣을 수 있음)');
        await A.pg.fill('#reply-150', '30명이야');
        // 적는 중에 새로고침이 와도 글 유지
        A.st.orders.find(o => o.id === 140).result = { type: 'live', text: LIVE + '\n54번째 줄' };
        await waitFor(async () => (await live()).text.includes('54번째 줄'), 8000);
        ok('답을 적는 중 목록이 다시 그려져도 적던 글·붙인 이미지 유지', (await A.pg.inputValue('#reply-150')) === '30명이야' && (await rst(A.pg, 150)).thumb);
        await A.pg.click('#desk-list .desk-turn[data-oid="150"] [data-act="sendreply"]');
        const pr = await waitFor(async () => posts(A, /\/orders\/150\/reply$/).length ? posts(A, /\/orders\/150\/reply$/) : null, 5000);
        ok('[답 보내기] → POST /orders/150/reply 1회 · content = 적은 글 · 붙인 이미지(image_data·image_mime)도 함께', !!pr && pr.length === 1 && pr[0].body && pr[0].body.content === '30명이야' && /^data:image\/png;base64,/.test(pr[0].body.image_data || '') && pr[0].body.image_mime === 'image/png', JSON.stringify(pr && pr.map(x => ({ content: x.body.content, image: String(x.body.image_data || '').slice(0, 22), mime: x.body.image_mime }))));
        const afterQ = await waitFor(async () => { const s = await chat(A.pg); const t = s.threads.find(x => x.th === 150); return t && t.turns.length === 2 ? { s, t } : null; }, 8000);
        ok('답한 뒤 = 같은 대화 아래에 내 답이 붙고(2번 주고받음) 그 대화가 맨 위로', !!afterQ && afterQ.s.threads[0].th === 150 && JSON.stringify(afterQ.t.turns.map(x => x.id)) === '[150,300]' && afterQ.t.turns[1].me === '30명이야' && /2번 주고받음/.test(afterQ.t.head) && afterQ.t.turns[0].badge !== '확인 필요', afterQ ? afterQ.t.head + ' · 앞 차례 배지 ' + afterQ.t.turns[0].badge : '');

        // 이어서 지시(마지막 차례)
        const f0 = await A.pg.evaluate(() => { const ta = document.getElementById('reply-202'); return { ta: !!ta && ta.getClientRects().length > 0, focus: true, rows: ta ? ta.rows : 0 }; });   // #500 누르지 않아도 열려 있다
        await A.pg.fill('#reply-202', '한 줄 더 짧게');
        await A.pg.click('#desk-list .desk-turn[data-oid="202"] [data-act="sendreply"]');
        const pf = await waitFor(async () => posts(A, /\/orders\/202\/reply$/).length ? posts(A, /\/orders\/202\/reply$/) : null, 5000);
        const afterF = await waitFor(async () => { const s = await chat(A.pg); const t = s.threads.find(x => x.th === 200); return t && t.turns.length === 4 ? { s, t } : null; }, 8000);
        ok('#500 버튼을 누르지 않고 마지막 차례 답 칸에 바로 입력 → [이어서 보내기] → POST /orders/202/reply · 같은 대화에 4번째로 붙고 맨 위로', f0.ta && f0.focus && !!pf && pf.length === 1 && pf[0].body.content === '한 줄 더 짧게' && !!afterF && afterF.s.threads[0].th === 200 && afterF.t.turns[3].me === '한 줄 더 짧게' && /4번 주고받음/.test(afterF.t.head), afterF ? afterF.t.head : JSON.stringify(f0));
        ok('진행 중 지시가 붙은 대화는 × 가 사라짐', !!afterF && afterF.t.x === false);
        ok('새로 붙은 차례가 강조(.desk-flash)되거나 화면 안에 있음', await A.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-turn[data-oid="301"]'); if (!t) return false; const r = t.getBoundingClientRect(); return t.classList.contains('desk-flash') || (r.top >= 0 && r.top < window.innerHeight); }));

        // ── #500 답 칸에 이미지 1장 · Enter 보내기
        await A.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="130"]'); if (t) t.scrollIntoView({ block: 'center' }); });
        const i0 = await rst(A.pg, 130);
        const pp = await pasteImg(A.pg, '#reply-130');
        const i1 = await waitFor(async () => { const x = await rst(A.pg, 130); return x && x.thumb ? x : null; }, 4000);
        ok('#500 답 칸에 이미지 붙여넣기(paste) → 칸 위 썸네일 1장 + × · 기본 붙여넣기는 막음 · 답 칸에 포커스', i0 && !i0.thumb && pp.prevented && !!i1 && i1.thumbs === 1 && /^data:image\/png;base64,/.test(i1.src) && i1.x && i1.focus, JSON.stringify({ before: i0 && i0.thumb, prevented: pp.prevented, after: i1 && { thumbs: i1.thumbs, focus: i1.focus } }));
        await A.pg.type('#reply-130', '글과 그림');
        A.st.orders.find(o => o.id === 140).result = { type: 'live', text: LIVE + '\n60번째 새 줄' };
        await waitFor(async () => (await live()).text.includes('60번째 새 줄'), 8000);
        const i2 = await rst(A.pg, 130);
        ok('#500 2초 새로고침으로 다시 그려진 뒤에도 썸네일·적던 글 유지', i2.thumb && i2.val === '글과 그림', JSON.stringify({ thumb: i2.thumb, val: i2.val }));
        await shot(A.pg, '8-1440-답칸-썸네일', '#desk-list .desk-thread-box[data-th="130"]');
        await A.pg.click('#desk-list .desk-turn[data-oid="130"] [data-act="replyimgx"]');
        const i3 = await rst(A.pg, 130);
        ok('#500 썸네일 × = 이미지만 빠짐 · 글은 그대로', !i3.thumb && i3.val === '글과 그림');
        const [fc] = await Promise.all([A.pg.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), A.pg.click('#desk-list .desk-turn[data-oid="130"] [data-act="replyimg"]')]);
        if (fc) await fc.setFiles({ name: '발송목록.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(PNG, 'base64') });
        const i4 = await waitFor(async () => { const x = await rst(A.pg, 130); return x && x.thumb ? x : null; }, 4000);
        ok('#500 [이미지 첨부] → 파일 고르기 → 썸네일 · 글 유지', !!fc && !!i4 && /^data:image\/jpeg;base64,/.test(i4.src) && i4.val === '글과 그림', i4 ? i4.src : '파일 고르기 창이 안 열림');
        const e0 = posts(A, /\/orders\/130\/reply$/).length;
        await A.pg.focus('#reply-130');
        await A.pg.keyboard.press('End');
        await A.pg.keyboard.press('Shift+Enter');
        await A.pg.keyboard.type('둘째 줄');
        const compR = await A.pg.evaluate(() => { const i = document.getElementById('reply-130'); const e1 = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }); i.dispatchEvent(e1); return e1.defaultPrevented; });
        await sleep(400);
        ok('#500 답 칸 Shift+Enter = 줄바꿈만 · 한글 조합 중 Enter = 안 보냄', (await A.pg.inputValue('#reply-130')) === '글과 그림\n둘째 줄' && !compR && posts(A, /\/orders\/130\/reply$/).length === e0, JSON.stringify(await A.pg.inputValue('#reply-130')));
        await A.pg.keyboard.press('Enter');
        const pe = await waitFor(async () => posts(A, /\/orders\/130\/reply$/).length > e0 ? posts(A, /\/orders\/130\/reply$/) : null, 5000);
        await sleep(700);
        ok('#500 답 칸 Enter = POST /orders/130/reply 정확히 1회 · content(줄바꿈 포함) + image_data(data:image/jpeg…) + image_mime', !!pe && pe.length === 1 && pe[0].body.content === '글과 그림\n둘째 줄' && /^data:image\/jpeg;base64,/.test(pe[0].body.image_data || '') && pe[0].body.image_mime === 'image/jpeg', pe ? JSON.stringify({ n: pe.length, content: pe[0].body.content, image: String(pe[0].body.image_data || '').slice(0, 23), mime: pe[0].body.image_mime }) : 'POST 없음');
        const i5 = await waitFor(async () => { const s = await chat(A.pg); const t = s.threads.find(x => x.th === 130); return t && t.turns.length === 2 ? t : null; }, 8000);
        const thumbsLeft = await A.pg.evaluate(() => document.querySelectorAll('#desk-list .desk-reply-thumbs').length);
        ok('#500 보낸 뒤 = 같은 대화에 내 말풍선(「이미지 첨부」 표시)으로 붙음 · 썸네일 사라짐 · 진행 중이라 답 칸 없음', !!i5 && i5.turns[1].me === '글과 그림\n둘째 줄' && /이미지 첨부/.test(i5.turns[1].meta || '') && thumbsLeft === 0 && i5.turns[0].reply === 0 && i5.turns[1].reply === 0, i5 ? i5.turns[1].meta : '');
        // 글·이미지 둘 다 없으면 안 보냄 → 이미지만으로는 보냄
        await A.pg.click('#desk-list-more');   // 120번 대화는 미리보기 5개 밖 → 크게 보기에서
        await sleep(300);
        const inFull = await A.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="120"]'); if (t) t.scrollIntoView({ block: 'center' }); const ta = document.getElementById('reply-120'); return !!ta && ta.getClientRects().length > 0; });
        ok('#500 [자세히 확인하기] 크게 보기 안의 대화에도 답 칸이 열려 있음', inFull);
        // #538: 비어 있으면 보내기 버튼이 꺼져 있다(누를 수 없음)
        const dis120 = await A.pg.evaluate(() => document.querySelector('#desk-list .desk-turn[data-oid="120"] [data-act="sendreply"]').disabled);
        ok('#500 글·이미지 둘 다 없으면 보내지 않음(#538 보내기 버튼이 꺼져 있음)', dis120 === true && posts(A, /\/orders\/120\/reply$/).length === 0);
        await pasteImg(A.pg, '#reply-120');
        await waitFor(async () => { const x = await rst(A.pg, 120); return x && x.thumb ? x : null; }, 4000);
        await A.pg.click('#desk-list .desk-turn[data-oid="120"] [data-act="sendreply"]');
        const po = await waitFor(async () => posts(A, /\/orders\/120\/reply$/).length ? posts(A, /\/orders\/120\/reply$/) : null, 5000);
        ok('#500 글 없이 이미지만 붙여도 보냄 — POST 1회 · content 빈 글 · image_data 있음', !!po && po.length === 1 && po[0].body.content === '' && /^data:image\/png;base64,/.test(po[0].body.image_data || ''), po ? JSON.stringify({ content: po[0].body.content, image: String(po[0].body.image_data || '').slice(0, 22) }) : 'POST 없음');
        await sleep(700);
        if (await A.pg.evaluate(() => document.getElementById('desk-listbox').classList.contains('is-full'))) { await A.pg.keyboard.press('Escape'); await sleep(300); }
        ok('#500 답 칸 과정에서 브라우저 기본 창 0 · pageerror 0', A.st.dialogs === 0 && A.errors.length === 0, A.errors.join(' | ').slice(0, 200));

        // 상태 고르개: 한 건이라도 맞으면 대화 통째
        await A.pg.selectOption('#desk-fs', 'work');
        await sleep(400);
        const fw = await chat(A.pg);
        ok('상태 고르개 「진행 중」 = 진행 중 지시가 든 대화만 · 대화는 통째로(끝난 앞 차례도 같이)', JSON.stringify(fw.threads.map(t => t.th).sort((a, b) => a - b)) === '[120,130,140,150,200]' && fw.threads.find(t => t.th === 200).turns.length === 4, JSON.stringify(fw.threads.map(t => [t.th, t.turns.length])));
        await A.pg.selectOption('#desk-fs', 'ask');
        await sleep(400);
        const fa = await chat(A.pg);
        ok('상태 고르개 「확인 필요」 = 승인대기 대화 2개', JSON.stringify(fa.threads.map(t => t.th).sort((a, b) => a - b)) === '[160,161]', JSON.stringify(fa.threads.map(t => t.th)));
        await A.pg.selectOption('#desk-fs', 'all');
        await sleep(400);

        // 승인: 카드 안 확인
        const ap = id => A.pg.evaluate(id => { const t = document.querySelector(`#desk-list .desk-turn[data-oid="${id}"]`); const vis = el => !!el && el.getClientRects().length > 0; return t ? { summary: t.textContent.includes('→'), approve: vis(t.querySelector('[data-act="approve"]')), reject: vis(t.querySelector('[data-act="reject"]')), confirm: vis(t.querySelector('.desk-confirm')), approve2: vis(t.querySelector('[data-act="approve2"]')), reject2: vis(t.querySelector('[data-act="reject2"]')), cancel: vis(t.querySelector('[data-act="pendcancel"]')), q: (t.querySelector('.desk-confirm-q') || {}).textContent, ta: vis(document.getElementById('reject-' + id)), focus: document.activeElement === document.getElementById('reject-' + id), badge: (t.querySelector('.desk-badge') || {}).textContent, text: t.querySelector('.desk-bub.ai').textContent.replace(/\s+/g, ' ') } : null; }, id);
        const a0 = await ap(160);
        ok('승인대기 대화 — 요청 요약 + [승인하고 실행]·[반려] 버튼', a0 && a0.summary && a0.approve && a0.reject && !a0.confirm, JSON.stringify(a0 && { approve: a0.approve, reject: a0.reject }));
        await A.pg.click('#desk-list .desk-turn[data-oid="160"] [data-act="approve"]');
        const a1 = await ap(160);
        ok('[승인하고 실행] 1번째 = 카드 안에 한 번 더 확인(브라우저 창 0) · 아직 POST 0', a1.confirm && a1.approve2 && a1.cancel && /승인할까요/.test(a1.q || '') && posts(A, /\/approve$/).length === 0 && A.st.dialogs === 0, a1.q);
        await shot(A.pg, '4-1440-승인확인', '#desk-list .desk-thread-box[data-th="160"]');
        await A.pg.click('#desk-list .desk-turn[data-oid="160"] [data-act="pendcancel"]');
        const a2 = await ap(160);
        ok('[취소] = 확인 칸 닫힘 · 원래 버튼 복귀 · POST 0', !a2.confirm && a2.approve && posts(A, /\/approve$/).length === 0);
        await A.pg.click('#desk-list .desk-turn[data-oid="160"] [data-act="approve"]');
        await A.pg.click('#desk-list .desk-turn[data-oid="160"] [data-act="approve2"]');
        const pa = await waitFor(async () => posts(A, /\/orders\/160\/approve$/).length ? posts(A, /\/orders\/160\/approve$/) : null, 5000);
        const a3 = await waitFor(async () => { const s = await ap(160); return s && !s.confirm && /승인/.test(s.text) && !s.approve ? s : null; }, 6000);
        ok('확인 칸의 [승인하고 실행] → POST /orders/160/approve 정확히 1회 · 카드가 승인됨으로', !!pa && pa.length === 1 && !!a3, a3 ? a3.badge : '카드가 안 바뀜');
        // 반려: 사유 입력
        await A.pg.click('#desk-list .desk-turn[data-oid="161"] [data-act="reject"]');
        const r1 = await ap(161);
        ok('[반려] = 카드 안에 사유 입력칸(포커스) + [반려하기]·[취소] · POST 0', r1.confirm && r1.ta && r1.focus && r1.reject2 && r1.cancel && posts(A, /\/reject$/).length === 0, JSON.stringify({ ta: r1.ta, focus: r1.focus }));
        await A.pg.fill('#reject-161', '가격은 이번 주 유지');
        await shot(A.pg, '4-1440-반려사유', '#desk-list .desk-thread-box[data-th="161"]');
        A.st.orders.find(o => o.id === 140).result = { type: 'live', text: LIVE + '\n55번째 줄' };
        await waitFor(async () => (await live()).text.includes('55번째 줄'), 8000);
        const r2 = await ap(161);
        ok('목록이 다시 그려져도 사유 글·확인 칸 유지', r2.confirm && (await A.pg.inputValue('#reject-161')) === '가격은 이번 주 유지');
        await A.pg.click('#desk-list .desk-turn[data-oid="161"] [data-act="reject2"]');
        const prj = await waitFor(async () => posts(A, /\/orders\/161\/reject$/).length ? posts(A, /\/orders\/161\/reject$/) : null, 5000);
        const r3 = await waitFor(async () => { const s = await ap(161); return s && !s.confirm && /가격은 이번 주 유지/.test(s.text) ? s : null; }, 6000);
        ok('[반려하기] → POST /orders/161/reject 1회 · body.reason = 적은 사유 · 카드에 반려 사유 표시', !!prj && prj.length === 1 && prj[0].body && prj[0].body.reason === '가격은 이번 주 유지' && !!r3, JSON.stringify(prj && prj.map(x => x.body)));
        ok('승인·반려 전 과정에서 브라우저 기본 창(confirm·prompt·alert) 0회', A.st.dialogs === 0, `${A.st.dialogs}회`);

        // × = 대화 통째 지우기
        const h0 = posts(A, /hide-mine$/).length;
        await A.pg.click('#desk-list .desk-thread-box[data-th="210"] [data-act="endchat"]');   // #538 [채팅 종료] → 카드 안 확인 → [종료]
        await A.pg.click('#desk-list .desk-thread-box[data-th="210"] .desk-end-ask [data-act="hidethread"]');
        const ph = await waitFor(async () => posts(A, /hide-mine$/).length - h0 >= 3 ? posts(A, /hide-mine$/).slice(h0) : null, 6000);
        await sleep(500);
        const ch = await chat(A.pg);
        ok('× → 그 대화의 지시 수(3)만큼 hide-mine POST(210·211·212) · 대화가 사라짐 · 다른 대화는 그대로', !!ph && ph.length === 3 && JSON.stringify(ph.map(x => Number(/orders\/(\d+)\//.exec(x.p)[1])).sort()) === '[210,211,212]' && ph.every(x => x.body && x.body.hide === true) && !ch.threads.some(t => t.th === 210) && ch.threads.some(t => t.th === 200), ph ? ph.map(x => x.p.replace('/api/agent-office', '')).join(' ') : 'POST 부족');

        // [자세히 확인하기]
        const cm = await chat(A.pg);
        const hidN = cm.threads.filter(t => !t.vis).length;
        await A.pg.click('#desk-list-more');
        await sleep(400);
        const cf = await chat(A.pg);
        ok('[자세히 확인하기] = 크게 보기 · 숨어 있던 대화까지 전부 보임 · Esc로 닫힘', hidN > 0 && cf.full && cf.threads.every(t => t.vis), `숨김 ${hidN}개 → 크게 보기에서 보임 ${cf.threads.filter(t => t.vis).length}/${cf.threads.length}`);
        await A.pg.keyboard.press('Escape');
        await sleep(400);
        ok('크게 보기 닫힘', !(await chat(A.pg)).full);

        // 새 지시 보내기 → 새 대화가 맨 위 + 강조
        await A.pg.fill('#desk-input', '새로 보낸 지시');
        await A.pg.click('#desk-send');
        const pn = await waitFor(async () => posts(A, /\/api\/agent-office\/orders$/).length ? posts(A, /\/api\/agent-office\/orders$/) : null, 5000);
        const nid = A.st.nextId - 1;
        const cn = await waitFor(async () => { const s = await chat(A.pg); return s.threads.length && s.threads[0].th === nid ? s : null; }, 8000);
        const fl = await waitFor(async () => A.pg.evaluate(id => { const t = document.querySelector(`#desk-list .desk-turn[data-oid="${id}"]`); if (!t) return null; const r = t.getBoundingClientRect(); return { flash: t.classList.contains('desk-flash'), inView: r.top >= 0 && r.bottom <= window.innerHeight + 200 }; }, nid), 4000);
        ok('[지시 보내기] → 새 대화가 맨 위 · 내 글 말풍선 + 「순서 대기」 · 강조·화면 안', !!pn && pn.length === 1 && !!cn && cn.threads[0].turns[0].me === '새로 보낸 지시' && /대기/.test(cn.threads[0].turns[0].badge || '') && !!fl && (fl.flash || fl.inView), JSON.stringify(fl));

        // 전체 지시 탭 = 표 그대로 · 버튼 숨김
        await A.pg.click('.desk-tab[data-tab="all"]');
        await A.pg.waitForSelector('#desk-list .desk-h-item', { timeout: 8000 }).catch(() => { });
        const tAll = await chat(A.pg);
        const hAll = await A.pg.evaluate(() => document.querySelectorAll('#desk-list .desk-h-item').length);
        ok('「이전 채팅 이력」 탭(#538) = 대화 한 줄씩(표 아님) · 채팅 틀 없음 · [표로 보기] 버튼 숨김', !tAll.table && hAll > 0 && tAll.threads.length === 0 && tAll.viewBtn && !tAll.viewBtn.vis);
        ok('#566 승인 결재함 탭 없음', (await A.pg.evaluate(() => document.querySelectorAll('.desk-tab[data-tab="approval"]').length)) === 0);
        await A.pg.click('.desk-tab[data-tab="mine"]');
        await A.pg.waitForSelector('#desk-list .desk-thread-box', { timeout: 8000 }).catch(() => { });
        const tMine = await chat(A.pg);
        ok('「내 지시」로 돌아오면 다시 대화 보기 · 버튼은 계속 숨김', tMine.threads.length > 0 && !tMine.table && !tMine.viewBtn.vis);

        // 표 보기 = 검증용 저장값(akm_desk_view=table)으로만(#504 전환 버튼 숨김) · 새로고침 뒤에도 기억
        await A.pg.evaluate(() => { localStorage.setItem('akm_desk_view', 'table'); });
        await A.enter();
        const v1 = await chat(A.pg);
        ok('저장값 table → 표(1440) · 대화 묶음 없음 · 버튼은 숨김', v1.table && v1.threads.length === 0 && !v1.viewBtn.vis && v1.stored === 'table');
        const rowWorks = await A.pg.evaluate(() => { const r = document.querySelector('#desk-list tr.row[data-oid="130"] .c-q'); if (!r) return false; r.click(); return !!document.querySelector('#desk-list tr.row[data-oid="130"].opened'); });
        ok('표 보기에서 줄 클릭 = 펼침(종전 동작)', rowWorks);
        await A.pg.click('#desk-list-more');
        await sleep(300);
        await A.pg.click('#desk-list tr.row[data-oid="12"] .c-q');
        const tf0 = await A.pg.evaluate(() => { const d = document.querySelector('#desk-list tr.row[data-oid="12"] + tr.detailrow'); const vis = el => !!el && el.getClientRects().length > 0; return { btn: d ? Array.from(d.querySelectorAll('[data-act="follow"]')).filter(vis).map(b => b.textContent.trim()) : null, ta: vis(document.getElementById('reply-12')) }; });
        await A.pg.click('#desk-list tr.row[data-oid="12"] + tr.detailrow [data-act="follow"]');
        const tf1 = await A.pg.evaluate(() => { const d = document.querySelector('#desk-list tr.row[data-oid="12"] + tr.detailrow'); const vis = el => !!el && el.getClientRects().length > 0; const ta = document.getElementById('reply-12'); return { ta: vis(ta), focus: document.activeElement === ta, rows: ta ? ta.rows : 0, cancel: Array.from(d.querySelectorAll('[data-act="follow"]')).filter(vis).map(b => b.textContent.trim()), img: Array.from(d.querySelectorAll('[data-act="replyimg"]')).filter(vis).length }; });
        await A.pg.click('#desk-list tr.row[data-oid="12"] + tr.detailrow [data-act="follow"]');
        const tf2 = await A.pg.evaluate(() => !!document.getElementById('reply-12'));
        ok('#500 표 보기는 종전 흐름 — 답 칸은 닫혀 있고 [이어서 지시] → 열림·포커스(+[이미지 첨부]·[취소]) → [취소]로 닫힘', tf0.btn && tf0.btn.join() === '이어서 지시' && !tf0.ta && tf1.ta && tf1.focus && tf1.cancel.join() === '취소' && tf1.img === 1 && !tf2, JSON.stringify({ tf0, tf1, tf2 }));
        await A.pg.keyboard.press('Escape');
        await sleep(300);
        await A.enter();
        const v2 = await chat(A.pg);
        ok('새로고침 뒤에도 표 보기 기억', v2.table && v2.threads.length === 0);
        await A.pg.evaluate(() => { localStorage.removeItem('akm_desk_view'); });
        await A.enter();
        const v3 = await chat(A.pg);
        ok('저장값 지우면 → 대화 묶음', v3.threads.length > 0 && !v3.table);
        await A.enter();
        ok('새로고침 뒤에도 대화 보기 기억', (await chat(A.pg)).threads.length > 0);

        // 1440: 현황판 접기 버튼 안 보임 · 현황판 보임
        const bd = pg => pg.evaluate(() => { const b = document.getElementById('desk-board-fold'), s = document.getElementById('desk-board'); const vis = el => !!el && el.getClientRects().length > 0; return { btn: vis(b), text: b ? b.textContent.trim() : '', exp: b ? b.getAttribute('aria-expanded') : null, board: vis(s), panels: s ? s.querySelectorAll('.desk-panel').length : 0, folded: s ? s.classList.contains('folded') : null, btnH: b ? Math.round(b.getBoundingClientRect().height) : 0, order: Array.from(document.querySelectorAll('#ao-desk-root .desk-main > section')).map(x => x.id || x.className.split(' ')[0]) }; });
        const b14 = await bd(A.pg);
        ok('1440px — 현황판 접기 버튼 안 보임 · 현황판은 늘 보임(4칸)', !b14.btn && b14.board && b14.panels === 4, JSON.stringify(b14));
        ok('칸 순서 그대로(지시하기 → 지시 목록 → 확인 필요 문의 → 현황판)', JSON.stringify(b14.order) === '["desk-top","desk-listbox","desk-inbox","desk-board"]', JSON.stringify(b14.order));
        ok('1440px — pageerror 0 · console error 0', A.errors.length === 0 && A.cons.length === 0, [...A.errors, ...A.cons].join(' | ').slice(0, 400));
        const otherWrites = A.st.writes.filter(w => !/\/orders(\/\d+\/(reply|hide-mine|approve|reject))?$/.test(w.p));
        info('가로챈 쓰기 요청 ' + A.st.writes.length + '건(전부 실서버 미도달)' + (otherWrites.length ? ' · 예상 밖: ' + otherWrites.map(w => w.m + ' ' + w.p).join(', ') : ''));
        await A.ctx.close();

        // ════ 1000px
        const B = await open({ width: 1000, height: 900 });
        const cb = await chat(B.pg);
        const gb = await geo(B.pg, 200);
        ok('1000px — 기본 대화 보기 · 좌우 말풍선 · 가로 넘침 없음', cb.threads.length === 11 && cb.cards === 0 && !cb.table && gb && gb.meRight && gb.aiLeft && !cb.rootOverflow && !cb.docOverflow, JSON.stringify(gb));
        await shot(B.pg, '5-1000-대화보기', '#desk-listbox');
        await B.pg.evaluate(() => { localStorage.setItem('akm_desk_view', 'table'); });
        await B.enter();
        const cb2 = await chat(B.pg);
        ok('1000px — 저장값 table = 카드 보기(종전)', cb2.cards > 0 && cb2.threads.length === 0 && !cb2.table);
        const b10 = await bd(B.pg);
        ok('1000px — 현황판 접기 버튼 안 보임 · 현황판 보임', !b10.btn && b10.board);
        ok('1000px — pageerror 0 · console error 0', B.errors.length === 0 && B.cons.length === 0, [...B.errors, ...B.cons].join(' | ').slice(0, 400));
        await B.ctx.close();

        // ════ 390px(터치)
        const P = await open({ width: 390, height: 800 }, { hasTouch: true, isMobile: true });
        const cp = await chat(P.pg);
        const gp = await geo(P.pg, 200), gp2 = await geo(P.pg, 140);
        ok('390px — 기본 대화 보기 · 내 글 오른쪽·클코 왼쪽 · 말풍선이 칸 안', cp.threads.length === 11 && gp && gp.meRight && gp.aiLeft && gp.meIn && gp.aiIn && gp2 && gp2.aiIn, JSON.stringify(gp));
        ok('390px — 가로 넘침 없음', !cp.rootOverflow && !cp.docOverflow);
        const tp = await P.pg.evaluate(() => { const vis = el => !!el && el.getClientRects().length > 0; const hs = sel => Array.from(document.querySelectorAll(sel)).filter(vis).map(b => Math.round(Math.min(b.getBoundingClientRect().height, b.getBoundingClientRect().width))); return { x: hs('#desk-list [data-act="endchat"]'), view: [44],   // #504 전환 버튼 숨김 — 자리만 둔다
             follow: hs('#desk-list [data-act="replyimg"], #desk-list textarea.desk-reply-in'), act: hs('#desk-list [data-act="approve"], #desk-list [data-act="reject"], #desk-list [data-act="sendreply"]') }; });
        ok('390px — 누르는 것 높이 44px 이상(×·보기 전환·답 칸·이미지 첨부·승인/반려/보내기)', [...tp.x, ...tp.view, ...tp.follow, ...tp.act].every(h => h >= 44), JSON.stringify({ x: Math.min(...tp.x), view: tp.view[0], follow: Math.min(...tp.follow), act: Math.min(...tp.act) }));
        await shot(P.pg, '6-390-대화보기', '#desk-listbox');
        const rp0 = await P.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-turn[data-oid="130"]'), b = t.getBoundingClientRect(); const els = [document.getElementById('reply-130'), t.querySelector('[data-act="sendreply"]'), t.querySelector('[data-act="replyimg"]')]; return { all: els.every(Boolean), inCard: els.every(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= b.left - 1 && r.right <= b.right + 1; }), h: els.map(e => Math.round(e.getBoundingClientRect().height)), overflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2 }; });
        ok('#500 390px — 답 칸·[이어서 보내기]·[이미지 첨부]가 카드 안 · 44px 이상 · 넘침 없음', rp0.all && rp0.inCard && rp0.h.every(h => h >= 44) && !rp0.overflow, JSON.stringify(rp0));
        await P.pg.tap('#reply-130');
        await P.pg.keyboard.type('폰 글');
        await P.pg.keyboard.press('Enter');
        await P.pg.keyboard.type('둘째');
        await sleep(500);
        ok('#500 390px(터치) — 답 칸 Enter = 줄바꿈(보내지 않음)', (await P.pg.inputValue('#reply-130')) === '폰 글\n둘째' && posts(P, /\/reply$/).length === 0, JSON.stringify(await P.pg.inputValue('#reply-130')));
        await pasteImg(P.pg, '#reply-130');
        const rp1 = await waitFor(async () => { const x = await rst(P.pg, 130); return x && x.thumb ? x : null; }, 4000);
        ok('#500 390px — 썸네일이 카드 안 · 글 유지', !!rp1 && rp1.thumbIn && rp1.val === '폰 글\n둘째');
        await shot(P.pg, '8-390-답칸-썸네일', '#desk-list .desk-thread-box[data-th="130"]');
        await shot(P.pg, '6-390-대화-처리중', '#desk-list .desk-thread-box[data-th="140"]');
        await shot(P.pg, '6-390-대화-승인대기', '#desk-list .desk-thread-box[data-th="160"]');
        await P.pg.tap('#desk-list .desk-turn[data-oid="161"] [data-act="reject"]');
        const rp = await P.pg.evaluate(() => { const c = document.querySelector('#desk-list .desk-turn[data-oid="161"] .desk-confirm'), t = document.querySelector('#desk-list .desk-turn[data-oid="161"]'); if (!c) return null; const a = c.getBoundingClientRect(), b = t.getBoundingClientRect(); return { in: a.left >= b.left - 1 && a.right <= b.right + 1, ta: !!document.getElementById('reject-161'), overflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2 }; });
        ok('390px — 반려 사유 입력칸이 카드 안 · 넘침 없음 · 브라우저 창 0', !!rp && rp.in && rp.ta && !rp.overflow && P.st.dialogs === 0);
        await shot(P.pg, '6-390-반려사유', '#desk-list .desk-thread-box[data-th="161"]');
        await P.pg.tap('#desk-list .desk-turn[data-oid="161"] [data-act="pendcancel"]');
        // 현황판 접기
        const p0 = await bd(P.pg);
        ok('390px — 현황판 기본 접힘 · [현황판 보기] 버튼(44px 이상 · aria-expanded=false)', p0.btn && !p0.board && p0.text === '현황판 보기' && p0.exp === 'false' && p0.btnH >= 44 && p0.panels >= 3, JSON.stringify(p0));
        await shot(P.pg, '7-390-현황판-접힘', '#desk-board-fold');
        await P.pg.tap('#desk-board-fold');
        await sleep(300);
        const p1 = await bd(P.pg);
        ok('버튼 누름 → 현황판 열림 · 「현황판 접기」 · aria-expanded=true', p1.board && p1.text === '현황판 접기' && p1.exp === 'true');
        await shot(P.pg, '7-390-현황판-열림', '#desk-board-fold');
        await P.pg.tap('#desk-board-fold');
        await sleep(300);
        const p2 = await bd(P.pg);
        ok('다시 누름 → 접힘', !p2.board && p2.text === '현황판 보기' && p2.exp === 'false');
        ok('390px — 칸 순서 그대로(버튼은 section이 아님)', JSON.stringify(p0.order) === '["desk-top","desk-listbox","desk-inbox","desk-board"]', JSON.stringify(p0.order));
        ok('390px — pageerror 0 · console error 0', P.errors.length === 0 && P.cons.length === 0, [...P.errors, ...P.cons].join(' | ').slice(0, 400));
        await P.ctx.close();
        // ════ #500 서버 reply 라우트 실검증(실DB · [검증469] 시험 지시 2건만 — 끝에 숨김·취소)
        {
            const { Client } = require('pg');
            const db2 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
            await db2.connect();
            const made = [];
            try {
                const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
                const parent = (await db2.query(`INSERT INTO pending_orders (content, status, created_by, created_by_id, result, processed_at) VALUES ($1, '완료', $2, $3, $4, NOW()) RETURNING id`, ['[검증469] #500 부모 지시', user.name, user.id, JSON.stringify({ type: 'desk_answer', answer: '시험 답' })])).rows[0].id;
                made.push(parent);
                const call = async body => { const r = await fetch(`http://localhost:${PORT}/api/agent-office/orders/${parent}/reply`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, j }; };
                const cnt = async () => (await db2.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE reply_to = $1`, [parent])).rows[0].c;
                const e1 = await call({ content: '', image_data: '' });
                ok('#500 서버: 글·이미지 둘 다 없으면 400', e1.status === 400 && (await cnt()) === 0, `${e1.status} ${e1.j && (e1.j.error || e1.j.message) || ''}`);
                const e2 = await call({ image_data: 'https://example.com/a.png', image_mime: 'image/png' });
                ok('#500 서버: data:image 로 시작하지 않는 값은 이미지로 치지 않음 → 글이 없으면 400(저장 0)', e2.status === 400 && (await cnt()) === 0, String(e2.status));
                const e3 = await call({ content: '[검증469] 큰 이미지', image_data: 'data:image/png;base64,' + 'A'.repeat(14_000_001), image_mime: 'image/png' });
                ok('#500 서버: 14MB 넘는 이미지 = 거절(400) · 저장 0', (e3.status === 400 || e3.status === 413) && (await cnt()) === 0, `${e3.status} ${e3.j && (e3.j.error || e3.j.message) || ''}`);
                const okr = await call({ content: '[검증469] #500 이어서(이미지)', image_data: PNG_URL, image_mime: 'image/png' });
                const nid = okr.j && okr.j.order && okr.j.order.id; if (nid) made.push(nid);
                const row = nid ? (await db2.query(`SELECT status, reply_to, created_by_id, image_mime, (image_data = $2) AS same, content FROM pending_orders WHERE id = $1`, [nid, PNG_URL])).rows[0] : null;
                ok('#500 서버: 이미지 붙인 이어서 지시 = 200 · 새 지시(대기)에 reply_to·image_data(보낸 값 그대로)·image_mime 저장 · 부모는 완료 그대로', okr.status === 200 && !!row && row.status === '대기' && row.reply_to === parent && row.same === true && row.image_mime === 'image/png' && row.created_by_id === user.id && (await db2.query(`SELECT status FROM pending_orders WHERE id=$1`, [parent])).rows[0].status === '완료', JSON.stringify(row && { status: row.status, reply_to: row.reply_to, same: row.same, mime: row.image_mime }));
                const lst = await fetch(`http://localhost:${PORT}/api/agent-office/desk/orders?limit=200`, { headers: { Authorization: 'Bearer ' + tok, Connection: 'close' } }).then(r => r.json());
                const li = (lst.orders || []).find(o => o.id === nid), lp = (lst.orders || []).find(o => o.id === parent);
                ok('#500 서버: 목록 응답에 has_image=true·reply_to · 이미지 원문은 안 내려감 · 부모의 followed_by = 새 지시', !!li && li.has_image === true && li.reply_to === parent && li.image_data === undefined && !!lp && lp.followed_by === nid, JSON.stringify(li && { has_image: li.has_image, reply_to: li.reply_to }));
            } catch (e) { ok('#500 서버 라우트 검증 실행', false, e.message); }
            finally {
                if (made.length) {
                    await db2.query(`UPDATE pending_orders SET is_deleted = true, status = '취소' WHERE id = ANY($1::int[])`, [made]);
                    const left = (await db2.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE id = ANY($1::int[]) AND is_deleted = false`, [made])).rows[0].c;
                    ok('#500 시험 지시 ' + made.length + '건 정리(숨김·취소)', left === 0 && made.length === 2, made.join(','));
                }
                await db2.end();
            }
        }
    } catch (e) {
        ok('검증 실행', false, e.message);
    } finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) { try { srv.kill(); } catch (_) { } }
    }
    const pass = results.filter(r => r.pass).length;
    console.log(`\n결과: ${pass}/${results.length}` + (pass === results.length ? ' ✅' : ' — 실패: ' + results.filter(r => !r.pass).map(r => r.name).join(' / ')));
    process.exit(pass === results.length ? 0 : 1);
})();
