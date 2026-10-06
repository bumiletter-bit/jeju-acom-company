// #504 검증: 에이전트 오피스 대화 보기 — 첨부 사진·영상 바로 보기(.desk-media · 크게 보기) · 대화 틀 인디고 테두리 · × 둥근 버튼 · 전환 버튼 숨김 · 동시 처리 문구
//   사용: node scripts/verify-504-media.js [스크린샷 폴더]
//   로컬 실서버 3459(스케줄러 차단) · desk/orders·desk-status·files/:id/download 를 page.route 로 가짜 응답 → DB 쓰기 0(로그인 우회용 대표 계정 id·이름만 읽음).
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
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// 2×2 짙은 인디고 PNG(크게 보기 캡처에서 보이게)
const PNG_BIG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGNgYGD4z8DAwPAfAAoLA/0GoY4rAAAAAElFTkSuQmCC', 'base64');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41'), Buffer.alloc(64)]);   // 머리만 든 가짜 mp4(재생은 안 됨 · src 설정만 본다)

(async () => {
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'desk504-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'desk504-server.err'), 'w')] });
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

        const t0 = Date.now() - 3600e3;
        const at = id => new Date(t0 + id * 1000).toISOString();
        const O = (id, content, extra) => Object.assign({ id, content, status: '완료', created_at: at(id), processed_at: at(id + 0.5), created_by: '검증504', created_by_id: user.id, has_image: false, reply_to: null, followed_by: null,
            steps: [{ t: at(id), kind: 'order', actor: '클코', text: '📥 지시 접수' }], result: { type: 'desk_answer', answer: `${id}번 답변입니다.` } }, extra || {});
        const seed = () => [
            O(300, '중간발주 뽑아줘', { result: { type: 'desk_answer', title: '중간발주 집계 (10-03 09:12)', answer: '거래처별 수량 표입니다.', files: [{ file_id: 901, label: '중간발주_대성(시온)_1003.png' }, { file_id: 902, label: '중간발주_효돈농협_1003.jpg' }, { file_id: 903, label: '릴스_초안.mp4' }, { file_id: 904, label: '수량표.xlsx' }] } }),
            O(301, '사진 못 받는 경우', { result: { type: 'desk_answer', answer: '사진이 하나 있어요.', files: [{ file_id: 905, label: '없는사진.png' }] } }),
            O(302, '그냥 글 답', {}),
            O(304, '행사 그림 만들어줘', { result: { type: 'desk_answer', answer: '그림 2장입니다.', files: [{ url: 'https://img.test/a/hf_1.png', label: '이미지 1 — 글자 있는 것' }, { url: 'https://img.test/a/hf_2.webp?x=1', label: '이미지 2' }, { url: 'https://img.test/a/clip.mp4', label: '영상' }, { url: 'https://img.test/a/page', label: '결과 페이지' }, { url: 'javascript:alert(1)//x.png', label: '나쁜 주소' }] } }),
            O(303, '처리 중 건', { status: '처리중', processed_at: null, result: { type: 'live', text: '쓰는 중…' } }),
        ];
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const open = async (vw, extra) => {
            const st = { orders: seed(), files: {}, status: { state: 'idle', online: true, waiting: 0, working: 0, order_id: null, can_wake: true, launcher: { on: true }, approval: 0 }, writes: [], gets: 0 };
            const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: "block" }, extra || {}));   // 서비스 워커는 가짜 그림 주소(img.test)를 못 받는다
            const pg = await ctx.newPage();
            const errors = [], cons = [];
            pg.on('pageerror', e => errors.push(String(e)));
            pg.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) cons.push(m.text().slice(0, 200)); });   // 일부러 404로 응답한 시험 파일(905)의 자원 오류 줄은 제외
            pg.on('dialog', d => d.dismiss());
            const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
            await pg.route('**/api/**', route => { const rq = route.request(); if (rq.method() === 'GET') return route.continue(); st.writes.push(rq.method() + ' ' + new URL(rq.url()).pathname); return json(route, { ok: true }); });
            await pg.route('**/api/agent-office/desk/orders*', route => { if (route.request().method() !== 'GET') return route.fallback(); st.gets++; return json(route, { orders: st.orders.slice().sort((a, b) => b.id - a.id) }); });
            await pg.route('**/api/agent-office/desk-status', route => json(route, st.status));
            await pg.route('**/api/agent-office/files/*/download', route => {
                const id = Number(/files\/(\d+)\//.exec(route.request().url())[1]);
                st.files[id] = (st.files[id] || 0) + 1;
                if (id === 901 || id === 902) return route.fulfill({ status: 200, contentType: id === 901 ? 'image/png' : 'image/jpeg', body: PNG_BIG });
                if (id === 903) return route.fulfill({ status: 200, contentType: 'video/mp4', body: MP4 });
                if (id === 904) return route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from('PK') });
                return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"없는 파일"}' });
            });
            await pg.route('https://img.test/**', route => /.mp4/.test(route.request().url()) ? route.fulfill({ status: 200, contentType: 'video/mp4', body: MP4 }) : route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BIG }));
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); localStorage.removeItem('akm_desk_view'); }, [tok, user]);
            await pg.reload({ waitUntil: 'networkidle' });
            await pg.waitForTimeout(2500);
            await pg.evaluate(() => { const n = document.querySelector('.nav-item[data-page="agent-office"]'); if (n) n.click(); else if (typeof switchPage === 'function') switchPage('agent-office'); });
            await pg.waitForSelector('#desk-list .desk-thread-box', { timeout: 20000 });
            await pg.waitForTimeout(1200);
            const setStatus = async s => { Object.assign(st.status, s); await pg.evaluate(() => window.__aoDesk.loadStatus()); await sleep(250); };
            return { pg, st, errors, cons, ctx, setStatus };
        };
        const shot = async (pg, name, sel) => { if (!SHOT) return; try { fs.mkdirSync(SHOT, { recursive: true }); if (sel) { await pg.evaluate(s => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'start' }); }, sel); await sleep(350); } await pg.screenshot({ path: path.join(SHOT, name + '.png'), fullPage: false }); } catch (e) { info('스크린샷 실패: ' + e.message); } };
        const media = pg => pg.evaluate(() => {
            const vis = el => !!el && el.getClientRects().length > 0;
            const R = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
            const turn = document.querySelector('#desk-list .desk-turn[data-oid="300"]'), box = turn && turn.closest('.desk-thread-box');
            const m = turn ? turn.querySelector('.desk-media') : null;
            const imgs = m ? Array.from(m.querySelectorAll('img')) : [], vids = m ? Array.from(m.querySelectorAll('video')) : [];
            const btns = turn ? Array.from(turn.querySelectorAll('[data-act="file"]')).map(b => b.textContent.trim()) : [];
            const fail = document.querySelector('#desk-list .desk-turn[data-oid="301"] .desk-media-item');
            const failBtn = document.querySelector('#desk-list .desk-turn[data-oid="301"] [data-act="file"]');
            const bs = box ? getComputedStyle(box) : null;
            const xs = Array.from(document.querySelectorAll('#desk-list .desk-thread-box [data-act="endchat"]')).filter(vis);   // #538 × 대신 [채팅 종료]
            const xcs = xs[0] ? getComputedStyle(xs[0]) : null;
            const z = document.getElementById('desk-zoom');
            const vb = document.getElementById('desk-view');
            return {
                media: !!m, imgs: imgs.map(i => ({ src: (i.getAttribute('src') || '').slice(0, 5), vis: vis(i), w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height), file: i.dataset.file, zoom: i.dataset.act, alt: i.alt })),
                vids: vids.map(v => ({ src: (v.getAttribute('src') || '').slice(0, 5), controls: v.controls, vis: vis(v), file: v.dataset.file })),
                btns, mediaIn: m && box ? (() => { const a = R(m), b = R(box); return a.l >= b.l - 1 && a.r <= b.r + 1; })() : null, mediaOverflow: m ? m.scrollWidth > m.clientWidth + 2 : null,
                xlsxMedia: m ? m.textContent.includes('xlsx') : false,
                fail: fail ? { cls: fail.classList.contains('fail'), cap: (fail.querySelector('figcaption') ? getComputedStyle(fail.querySelector('figcaption'), '::after').content : ''), src: fail.querySelector('img') ? (fail.querySelector('img').getAttribute('src') || '') : null } : null, failBtn: !!failBtn,
                box: bs ? { border: bs.borderTopColor, w: bs.borderTopWidth, radius: bs.borderTopLeftRadius, shadow: bs.boxShadow } : null, boxes: document.querySelectorAll('#desk-list .desk-thread-box').length,
                x: xs.length ? Object.assign(R(xs[0]), { radius: xcs.borderTopLeftRadius, border: xcs.borderTopColor, bg: xcs.backgroundColor, color: xcs.color }) : null,
                zoom: z ? { vis: vis(z), hiddenAttr: z.hidden, display: getComputedStyle(z).display, covers: (() => { const i = document.querySelector('#desk-list .desk-media img'); if (!i) return null; const r = i.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 1, r.top + 1); return !!(top && z.contains(top)); })(), img: z.querySelector('img') ? (z.querySelector('img').getAttribute('src') || '').slice(0, 5) : null, role: z.getAttribute('role'), fixed: getComputedStyle(z).position } : null,
                viewBtn: vb ? { hidden: vb.hidden, vis: vis(vb) } : null, say: document.getElementById('desk-say').textContent,
                rootOverflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
            };
        });

        // ════ 1440
        const A = await open({ width: 1440, height: 950 });
        let m = await waitFor(async () => { const x = await media(A.pg); return x.media && x.imgs.length === 2 && x.imgs.every(i => i.src === 'blob:') && x.vids.length === 1 && x.vids[0].src === 'blob:' ? x : null; }, 10000);
        if (!m) m = await media(A.pg);
        ok('① 사진 2장 = .desk-media 안 <img>(src blob:) 바로 보임 · data-file · 누르면 크게(data-act=zoom)', m.media && m.imgs.length === 2 && m.imgs.every(i => i.src === 'blob:' && i.vis && i.w > 0 && i.zoom === 'zoom') && m.imgs.map(i => i.file).join() === '901,902', JSON.stringify(m.imgs));
        ok('① mp4 1개 = <video controls>(src blob:) 그 자리', m.vids.length === 1 && m.vids[0].src === 'blob:' && m.vids[0].controls && m.vids[0].file === '903', JSON.stringify(m.vids));
        ok('① xlsx 는 미리 보기 없이 내려받기 버튼만 · 내려받기 버튼 4개 그대로', !m.xlsxMedia && m.btns.length === 4 && m.btns.every(b => /내려받기$/.test(b)) && m.btns.some(b => /xlsx/.test(b)), m.btns.join(' | '));
        ok('① 파일 요청 = 사진 2 + 영상 1 = 3회 · xlsx 요청 0', Object.keys(A.st.files).filter(k => k !== '905').length === 3 && A.st.files[901] === 1 && A.st.files[902] === 1 && A.st.files[903] === 1 && !A.st.files[904], JSON.stringify(A.st.files));
        // 새로고침 3회 뒤에도 재요청 0
        A.st.orders.find(o => o.id === 303).result = { type: 'live', text: '쓰는 중… 1' };
        const g0 = A.st.gets;
        await waitFor(async () => A.st.gets >= g0 + 3, 12000);
        await sleep(600);
        const m2 = await media(A.pg);
        ok('① 2초 새로고침 3회 뒤에도 파일 재요청 0(S.media 캐시) · 사진·영상 그대로 보임', A.st.files[901] === 1 && A.st.files[902] === 1 && A.st.files[903] === 1 && m2.imgs.length === 2 && m2.imgs.every(i => i.src === 'blob:') && m2.vids[0].src === 'blob:', `요청 ${JSON.stringify(A.st.files)} · 목록 요청 ${A.st.gets - g0}회`);
        ok('① 미리 보기 묶음이 대화 틀 안 · 가로 넘침 없음', m2.mediaIn === true && !m2.mediaOverflow && !m2.rootOverflow);
        // 받기 실패(404)
        ok('① 받기 실패(404) = .fail 표시(「미리 보기를 못 불러왔어요」) · 내려받기 버튼은 그대로', !!m2.fail && m2.fail.cls && /미리 보기를 못 불러왔어요/.test(m2.fail.cap || '') && m2.failBtn && A.st.files[905] >= 1, JSON.stringify(m2.fail));
        await shot(A.pg, '1-1440-대화-사진첨부', '#desk-list .desk-thread-box[data-th="300"]');
        // 크게 보기
        await A.pg.click('#desk-list .desk-turn[data-oid="300"] .desk-media img[data-file="901"]');
        await sleep(300);
        const z1 = await media(A.pg);
        ok('① 사진 클릭 → #desk-zoom(고정 전체 화면 · role=dialog) 보임 · 큰 사진 src blob:', !!z1.zoom && z1.zoom.vis && z1.zoom.img === 'blob:' && z1.zoom.role === 'dialog' && z1.zoom.fixed === 'fixed', JSON.stringify(z1.zoom));
        await shot(A.pg, '2-1440-크게보기');
        await A.pg.keyboard.press('Escape');
        await sleep(200);
        const z2 = await media(A.pg);
        ok('① Esc → 닫힘(화면에서 사라지고 아래 사진을 다시 누를 수 있음)', !!z2.zoom && !z2.zoom.vis && !z2.zoom.covers, JSON.stringify(z2.zoom) + (z2.zoom && z2.zoom.hiddenAttr && z2.zoom.vis ? ' ← hidden 속성은 붙었지만 .desk-zoom{display:flex}가 이겨 덮개가 그대로 남음(.desk [hidden] 규칙은 body 직속 요소엔 안 미침)' : ''));
        const why = await A.pg.evaluate(() => { const i = document.querySelector('#desk-list .desk-turn[data-oid="300"] .desk-media img[data-file="902"]'); const r = i.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: r.width, h: r.height, inView: r.top >= 0 && r.bottom <= innerHeight, top: top ? top.tagName + '.' + top.className : null }; });
        info('두 번째 사진 클릭 전 상태: ' + JSON.stringify(why));
        await A.pg.evaluate(() => document.querySelector('#desk-list .desk-turn[data-oid="300"] .desk-media img[data-file="902"]').scrollIntoView({ block: 'center' }));
        await A.pg.locator('#desk-list .desk-turn[data-oid="300"] .desk-media img[data-file="902"]').click({ force: true, timeout: 5000 });
        await sleep(200);
        await A.pg.locator('#desk-zoom').click({ force: true, timeout: 5000 });
        await sleep(200);
        const z3b = await media(A.pg);
        if (z3b.zoom && z3b.zoom.vis) { await A.pg.evaluate(() => { const z = document.getElementById('desk-zoom'); z.style.display = 'none'; }); info('덮개가 안 닫혀 다음 검사를 위해 검증이 강제로 숨김'); }
        await sleep(200);
        ok('① 다시 열고 아무 데나 누르면 닫힘 · 크게 보기 열어도 파일 재요청 0', !!z3b.zoom && !z3b.zoom.vis && !z3b.zoom.covers && A.st.files[902] === 1, JSON.stringify(z3b.zoom));
        // 대화 틀
        ok('② 대화 틀 .desk-thread-box = 인디고 테두리 2px #A5ACFF · 둥근 모서리 · 대화마다(5개)', m2.box && m2.box.border === 'rgb(165, 172, 255)' && parseFloat(m2.box.w) >= 2 && parseFloat(m2.box.radius) >= 12 && m2.boxes === 5, JSON.stringify(m2.box));
        const comp = await A.pg.evaluate(() => { const c = getComputedStyle(document.querySelector('.desk-compose')); return { border: c.borderTopColor, w: c.borderTopWidth }; });
        ok('② #550 맨 위 입력 상자는 답 상자와 같은 옅은 인디고 테두리(#C7CBFF) — 대화 틀(#A5ACFF 2px)보다 가늘다', comp.border === 'rgb(199, 203, 255)' && parseFloat(comp.w) <= parseFloat(m2.box.w), JSON.stringify(comp));
        await A.pg.focus('#reply-302');
        await sleep(200);
        const fw = await A.pg.evaluate(() => { const b = document.querySelector('#desk-list .desk-turn[data-oid="302"]').closest('.desk-thread-box'); const c = getComputedStyle(b); return { border: c.borderTopColor, shadow: c.boxShadow }; });
        ok('② 답 칸에 포커스 → 그 대화 틀 테두리 진해짐(+링)', fw.border === 'rgb(79, 70, 229)' && /rgba\(79, 70, 229/.test(fw.shadow), JSON.stringify(fw));
        // × 버튼
        ok('③ #538 [채팅 종료] = 조용한 글자 버튼(높이 44px · 대화 머리의 × 는 없음)', !!m2.x && m2.x.h >= 44 && await A.pg.evaluate(() => document.querySelectorAll('#desk-list .desk-th-head .desk-x').length === 0), JSON.stringify(m2.x));
        await A.pg.hover('#desk-list .desk-thread-box [data-act="endchat"]');
        await sleep(250);
        const xh = await A.pg.evaluate(() => { const x = document.querySelector('#desk-list .desk-thread-box [data-act="endchat"]'); const c = getComputedStyle(x); return { bg: c.backgroundColor, color: c.color }; });
        ok('③ [채팅 종료] hover = 옅은 바탕 + 진한 글자', xh.bg !== 'rgba(0, 0, 0, 0)' && xh.color !== 'rgb(255, 255, 255)', JSON.stringify(xh));
        // ④ 전환 버튼
        ok('④ [표로 보기] 버튼 숨김(hidden)', !!m2.viewBtn && m2.viewBtn.hidden && !m2.viewBtn.vis);
        // ⑤ 동시 처리 문구
        const cut = (t, n) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
        const LONG = '판매현황에서 지금 판매중인 품목이 몇 개인지 알려줘 — 보고만, 아무것도 바꾸지 말 것';
        await A.setStatus({ state: 'busy', working: 1, order_id: 77, working_list: [{ id: 77, created_by: '조가영 과장', content: LONG, reply_to: null, parent_content: null }] });
        const s1 = (await media(A.pg)).say;
        ok('⑤ #506 1건(긴 요청) → 「조가영 과장님의 "요청 24자…" 처리 중이에요」', s1 === `조가영 과장님의 "${cut(LONG, 24)}" 처리 중이에요` && /…" 처리 중이에요$/.test(s1), s1);
        await A.setStatus({ state: 'busy', working: 1, order_id: 78, working_list: [{ id: 78, created_by: '전승범 대표', content: '고 진행해 — 효돈 것만 다시 뽑아서 올려줘', reply_to: 70, parent_content: '중간발주 뽑아줘' }] });
        const s2 = (await media(A.pg)).say;
        ok('⑤ #506 이어서 지시 → 원래 요청 + (이어서: "16자…")', s2 === `전승범 대표님의 "중간발주 뽑아줘" (이어서: "${cut('고 진행해 — 효돈 것만 다시 뽑아서 올려줘', 16)}") 처리 중이에요`, s2);
        await A.setStatus({ state: 'busy', working: 3, order_id: 77, working_list: [{ id: 77, created_by: '전승범 대표', content: '중간발주 뽑아줘', reply_to: null, parent_content: null }, { id: 79, created_by: '조가영 과장', content: '정산 이미지 올려줘 — 효돈 10/3', reply_to: null, parent_content: null }, { id: 80, created_by: '', content: '톡톡 답변 추천', reply_to: null, parent_content: null }] });
        const s3 = (await media(A.pg)).say;
        ok('⑤ #506 3건 → 「3건 처리 중 — 전승범 대표님 "…" · 조가영 과장님 "…14자…" · 직원 "…"」(이름 없으면 「직원」)', s3 === `3건 처리 중 — 전승범 대표님 "중간발주 뽑아줘" · 조가영 과장님 "${cut('정산 이미지 올려줘 — 효돈 10/3', 14)}" · 직원 "톡톡 답변 추천"`, s3);
        await A.setStatus({ state: 'busy', working: 3, order_id: 77, working_list: undefined });
        const s3f = (await media(A.pg)).say;
        await A.setStatus({ state: 'busy', working: 1, order_id: 77, working_list: [] });
        const s1f = (await media(A.pg)).say;
        await A.setStatus({ state: 'idle', working: 0, order_id: null, working_list: [] });
        ok('⑤ working_list 없음·빈 배열(옛 서버·폴백) → 「지시 3건을 동시에 처리하고 있어요.」 / 「지금 지시를 처리하고 있어요.」', s3f === '지시 3건을 동시에 처리하고 있어요.' && s1f === '지금 지시를 처리하고 있어요.', `${s3f} / ${s1f}`);
        ok('1440 — 가로 넘침 0 · pageerror 0 · console error 0 · 쓰기 요청 0', !m2.docOverflow && A.errors.length === 0 && A.cons.length === 0 && A.st.writes.length === 0, [...A.errors, ...A.cons, ...A.st.writes].join(' | ').slice(0, 300));
        await A.ctx.close();

        // ════ 1000
        const B = await open({ width: 1000, height: 900 });
        const mb = await waitFor(async () => { const x = await media(B.pg); return x.imgs.length === 2 && x.imgs.every(i => i.src === 'blob:') ? x : null; }, 10000) || await media(B.pg);
        ok('1000 — 사진 2·영상 1 보임 · 틀 안 · 가로 넘침 0 · 오류 0', mb.imgs.length === 2 && mb.imgs.every(i => i.src === 'blob:') && mb.vids.length === 1 && mb.mediaIn === true && !mb.docOverflow && !mb.rootOverflow && B.errors.length === 0 && B.cons.length === 0);
        await B.ctx.close();

        // ════ 390(터치)
        const P = await open({ width: 390, height: 800 }, { hasTouch: true, isMobile: true });
        const mp = await waitFor(async () => { const x = await media(P.pg); return x.imgs.length === 2 && x.imgs.every(i => i.src === 'blob:') ? x : null; }, 10000) || await media(P.pg);
        ok('390 — 사진·영상 보임 · 틀 안 · 가로 넘침 0', mp.imgs.length === 2 && mp.imgs.every(i => i.src === 'blob:' && i.w > 0) && mp.vids.length === 1 && mp.mediaIn === true && !mp.docOverflow && !mp.rootOverflow, JSON.stringify(mp.imgs.map(i => [i.w, i.h])));
        ok('390 — [채팅 종료] 44px', !!mp.x && mp.x.w >= 44 && mp.x.h >= 44, JSON.stringify(mp.x && { w: mp.x.w, h: mp.x.h }));
        await shot(P.pg, '3-390-대화-사진첨부', '#desk-list .desk-thread-box[data-th="300"]');
        await P.pg.tap('#desk-list .desk-turn[data-oid="300"] .desk-media img[data-file="901"]');
        await sleep(300);
        const zp = await media(P.pg);
        ok('390 — 사진 탭 → 크게 보기 · 탭으로 닫힘', !!zp.zoom && zp.zoom.vis && zp.zoom.img === 'blob:', JSON.stringify(zp.zoom));
        await shot(P.pg, '3-390-크게보기');
        await P.pg.tap('#desk-zoom');
        await sleep(200);
        const zpc = await media(P.pg);
        ok('390 — 탭으로 닫힘 · pageerror 0 · console error 0', !zpc.zoom.vis && !zpc.zoom.covers && P.errors.length === 0 && P.cons.length === 0, [...P.errors, ...P.cons].join(' | ').slice(0, 300));
        await P.ctx.close();

        // ════ #536 주소로 온 그림(file_id 없음)도 바로 보인다
        const U = await open({ width: 1440, height: 950 });
        const um = () => U.pg.evaluate(() => {
            const turn = document.querySelector('#desk-list .desk-turn[data-oid="304"]'); if (!turn) return null;
            const m = turn.querySelector('.desk-media');
            const imgs = m ? Array.from(m.querySelectorAll('img')) : [], vids = m ? Array.from(m.querySelectorAll('video')) : [];
            const z = document.getElementById('desk-zoom');
            return { imgs: imgs.map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth, ref: i.getAttribute('referrerpolicy'), file: i.dataset.file || '' })), vids: vids.map(v => v.getAttribute('src')),
                links: Array.from(turn.querySelectorAll('.desk-files a.desk-link')).map(a => a.getAttribute('href')), zoom: z && !z.hidden ? (z.querySelector('img') || {}).src : null };
        });
        const u1 = await waitFor(async () => { const x = await um(); return x && x.imgs.length === 2 && x.imgs.every(i => i.w > 0) ? x : null; }, 10000) || await um();
        ok('#536 주소 그림 2장 바로 보임(png · webp?질의)', !!u1 && u1.imgs.length === 2 && u1.imgs.every(i => i.w > 0 && String(i.src).startsWith('https://img.test/') && i.ref === 'no-referrer' && !i.file), JSON.stringify(u1 && u1.imgs));
        ok('#536 주소 영상 1개 · 확장자 없는 주소·https 아닌 주소는 미리 보기 없음', !!u1 && u1.vids.length === 1 && /clip.mp4$/.test(u1.vids[0]), JSON.stringify(u1 && u1.vids));
        ok('#536 열기 링크는 종전대로 5개 그대로', !!u1 && u1.links.length === 5, JSON.stringify(u1 && u1.links.length));
        await sleep(2500);
        const u2 = await um();
        ok('#536 2초 새로고침 뒤에도 그대로 보임', !!u2 && u2.imgs.length === 2 && u2.imgs.every(i => i.w > 0));
        await U.pg.click('#desk-list .desk-turn[data-oid="304"] .desk-media img');
        await sleep(250);
        const u3 = await um();
        ok('#536 누르면 크게 보기', !!u3 && /hf_1.png$/.test(u3.zoom || ''), String(u3 && u3.zoom));
        ok('#536 pageerror 0 · 쓰기 0', U.errors.length === 0 && U.st.writes.length === 0, U.errors.join(' | ').slice(0, 200));
        await U.ctx.close();
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
