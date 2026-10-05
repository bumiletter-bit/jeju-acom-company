// #538 검증: 에이전트 오피스 「채팅 / 이전 채팅 이력 / 승인 결재함」
//   사용: node scripts/verify-538-chat.js [스크린샷 폴더]
//   로컬 실서버 3461(스케줄러 차단) · desk/orders 응답과 모든 쓰기 요청을 page.route 로 가로챈다 → DB 쓰기 0 · 실제 창구 호출 0(로그인 우회용 계정 id·이름만 읽음).
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT538) || 3461;
const SHOT = process.argv[2] || null;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 260) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(150); } return null; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'desk538-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'desk538-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const stf = (await db.query(`SELECT id, name, position FROM users WHERE role <> 'admin' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        await db.end();
        const admin = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' };
        const staff = { id: stf.id, name: stf.name, position: stf.position || '사원', role: 'user' };

        // ── 가짜 채팅 목록(me = 보는 사람 · other = 다른 직원)
        const DAY = 86400e3, now = Date.now();
        const mkSeed = (me, other) => {
            const O = (id, ago, content, extra) => Object.assign({ id, content, status: '완료', created_at: new Date(now - ago).toISOString(), processed_at: new Date(now - ago + 30e3).toISOString(), created_by: '검증538', created_by_id: me, mine_hidden: false, has_image: false, reply_to: null, followed_by: null,
                steps: [], result: { type: 'desk_answer', answer: `${id}번 답변입니다.` } }, extra || {});
            const rows = [
                O(900, 5 * 60e3, '오늘 판매현황 알려줘'),                                                     // 오늘 · 열림
                O(901, 4 * 60e3, '황금향만 다시', { reply_to: 900 }),
                O(902, 3 * 60e3, '표로 정리해줘', { reply_to: 901 }),
                O(890, 20 * 60e3, '지금 처리 중인 일', { status: '처리중', processed_at: null, result: null }),      // 진행 중 → 채팅 종료 없음
                O(880, 30 * 60e3, '쿠폰 문자 보내줘', { status: '질문', result: { type: 'question', question: '대상이 몇 명인가요?' } }),
                O(870, 40 * 60e3, '[최종발주] 10/5(월) 발송분', { result: { type: 'desk_answer', answer: '대성 10건 · 효돈 12건' } }),
                O(800, DAY + 60e3, '어제 정산 확인해줘', { mine_hidden: true, has_image: true }),              // 어제 · 종료한 대화(2차례)
                O(801, DAY, '효돈만 다시', { reply_to: 800, mine_hidden: true }),
                O(790, DAY + 3600e3, '다른 직원의 문의', { created_by: '다른직원', created_by_id: other }),      // 남의 대화
                O(700, 40 * DAY, '지난달 보고서 만들어줘', { mine_hidden: true, result: { type: 'desk_answer', answer: '보고서입니다.', files: [{ label: '보고서.xlsx', file_id: 77 }] } }),
                O(690, 41 * DAY, '오류가 났던 일', { status: '오류', mine_hidden: true, result: { type: 'error', error: '시간 초과' } }),
                O(650, 42 * DAY, '부모가 범위 밖인 꼬리', { reply_to: 5, mine_hidden: true }),
            ];
            for (let i = 0; i < 70; i++) rows.push(O(500 - i, 60 * DAY + i * 3600e3, `옛 채팅 ${i + 1}번째 글`, { mine_hidden: true }));
            return rows;
        };

        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const open = async (user, vw, extra) => {
            const other = user.id === admin.id ? staff.id : admin.id;
            const st = { orders: mkSeed(user.id, other), writes: [], dialogs: 0, nextId: 1000, hq: [] };
            const ctx = await browser.newContext(Object.assign({ viewport: vw }, extra || {}));
            const pg = await ctx.newPage(); const errors = [];
            pg.on('pageerror', e => errors.push(String(e)));
            pg.on('dialog', d => { st.dialogs++; d.dismiss(); });
            const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
            await pg.route('**/api/**', route => {
                const rq = route.request();
                if (rq.method() === 'GET') return route.continue();
                const p = new URL(rq.url()).pathname; let body = null; try { body = JSON.parse(rq.postData() || 'null'); } catch (_) { }
                st.writes.push({ m: rq.method(), p, body });
                let m;
                if ((m = /\/orders\/(\d+)\/reply$/.exec(p))) { const o = { id: st.nextId++, content: body && body.content, status: '대기', created_at: new Date().toISOString(), processed_at: null, created_by: '검증538', created_by_id: user.id, mine_hidden: false, has_image: !!(body && body.image_data), reply_to: Number(m[1]), followed_by: null, steps: [], result: null }; st.orders.push(o); return json(route, { ok: true, message: '보냈어요', order: { id: o.id } }); }
                if ((m = /\/orders\/(\d+)\/hide-mine$/.exec(p))) { const o = st.orders.find(x => x.id === Number(m[1])); if (o) o.mine_hidden = !(body && body.hide === false); return json(route, { ok: true }); }
                return json(route, { ok: true });
            });
            await pg.route('**/api/agent-office/desk/orders*', route => {
                if (route.request().method() !== 'GET') return route.fallback();
                const u = new URL(route.request().url()), sp = u.searchParams; let rows = st.orders.slice().sort((a, b) => b.id - a.id);
                if (sp.get('history') === '1') {
                    st.hq.push(u.search);
                    if (user.role !== 'admin') rows = rows.filter(o => o.created_by_id === user.id);
                    const q = sp.get('q'); if (q) rows = rows.filter(o => String(o.content).includes(q) || String((o.result && o.result.answer) || '').includes(q));
                    const before = Number(sp.get('before')); if (before) rows = rows.filter(o => o.id < before);
                } else if (sp.get('status')) rows = rows.filter(o => o.status === sp.get('status'));
                else rows = rows.filter(o => o.created_by_id === user.id && !o.mine_hidden);
                return json(route, { orders: rows.slice(0, Number(sp.get('limit')) || 40) });
            });
            await pg.route('**/api/agent-office/files/*/download', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
            const tok = jwt.sign(user, 'verifytest', { expiresIn: '30m' });
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); localStorage.removeItem('akm_desk_view'); }, [tok, user]);
            await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(2500);
            await pg.evaluate(() => { const n = document.querySelector('.nav-item[data-page="agent-office"]'); if (n) n.click(); else if (typeof switchPage === 'function') switchPage('agent-office'); });
            await pg.waitForSelector('#desk-list .desk-thread-box, #desk-list .desk-empty', { timeout: 20000 }); await pg.waitForTimeout(900);
            return { pg, st, errors, ctx };
        };
        const shot = async (pg, name) => { if (!SHOT) return; try { fs.mkdirSync(SHOT, { recursive: true }); await pg.screenshot({ path: path.join(SHOT, name + '.png'), fullPage: true }); } catch (_) { } };
        const tabs = pg => pg.evaluate(() => Array.from(document.querySelectorAll('#desk-tabs .desk-tab')).map(t => ({ tab: t.dataset.tab, text: t.childNodes[0].textContent.trim(), vis: t.getClientRects().length > 0, sel: t.getAttribute('aria-selected') })));
        const overflow = pg => pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        const toast = pg => pg.evaluate(() => Array.from(document.querySelectorAll('.toast, .toast-message, #toast, [class*="toast"]')).map(e => e.textContent.trim()).filter(Boolean).join(' | '));
        const goTab = async (pg, tab, sel) => { await pg.click(`#desk-tabs .desk-tab[data-tab="${tab}"]`); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(500); };

        // ══ ① 탭 이름·권한 ════════════════════════════════════════════════════════════════
        const A = await open(admin, { width: 1440, height: 1000 });
        let tb = await tabs(A.pg);
        ok('① 탭 이름 = 채팅 · 이전 채팅 이력 · 승인 결재함(data-tab 은 mine/all/approval 그대로)', tb.map(t => t.tab + ':' + t.text).join() === 'mine:채팅,all:이전 채팅 이력,approval:승인 결재함', JSON.stringify(tb.map(t => t.text)));
        ok('① 관리자 = 세 탭 모두 보임 · 처음 고른 탭 = 채팅', tb.every(t => t.vis) && tb[0].sel === 'true');
        const txt0 = await A.pg.evaluate(() => document.getElementById('ao-desk-root').innerText);
        ok('① 화면에 옛 이름(내 지시 · 전체 지시 · 대표 확인함)이 남아 있지 않음', !/내 지시|전체 지시|대표 확인함/.test(txt0), (txt0.match(/내 지시|전체 지시|대표 확인함/g) || []).join());

        // ══ ② 답 칸 모양 ═════════════════════════════════════════════════════════════════
        const box = pg => pg.evaluate(() => {
            const b = document.querySelector('#desk-list .desk-thread-box[data-th="900"] .desk-cbox'); if (!b) return null;
            const ta = b.querySelector('textarea'), plus = b.querySelector('[data-act="replyimg"]'), send = b.querySelector('[data-act="sendreply"]'), r = el => el.getBoundingClientRect(), cs = getComputedStyle(b);
            return { radius: parseFloat(cs.borderTopLeftRadius), taAbove: r(ta).bottom <= r(plus).top + 1, plusLeft: r(plus).left < r(send).left, sameRow: Math.abs(r(plus).top - r(send).top) < 2, plusIn: r(plus).left >= r(b).left && r(plus).bottom <= r(b).bottom + 1, sendIn: r(send).right <= r(b).right + 1,
                size: [r(plus).width, r(plus).height, r(send).width, r(send).height].map(Math.round), round: [getComputedStyle(plus).borderTopLeftRadius, getComputedStyle(send).borderTopLeftRadius], labels: [plus.getAttribute('aria-label'), send.getAttribute('aria-label')], text: (plus.textContent + send.textContent).trim(), disabled: send.disabled,
                wordBtns: Array.from(b.querySelectorAll('button')).map(x => x.textContent.trim()).filter(Boolean), thumbs: b.querySelectorAll('.desk-thumb img').length, thumbAbove: b.querySelector('.desk-thumb') ? r(b.querySelector('.desk-thumb')).bottom <= r(ta).top + 1 : null };
        });
        let bx = await box(A.pg);
        ok('② 이어서 보내는 칸 = 둥근 상자 하나 안에 글 칸(위) + 아래 줄 왼쪽 「+」 · 오른쪽 화살표', !!bx && bx.radius >= 16 && bx.taAbove && bx.plusLeft && bx.sameRow && bx.plusIn && bx.sendIn, JSON.stringify(bx));
        ok('② 두 버튼은 둥근 아이콘(44px 이상 · 글자 없음 · aria-label 「이미지 첨부」「이어서 보내기」) · 비었으면 보내기 꺼짐', !!bx && bx.size.every(n => n >= 44) && bx.round.every(v => v === '50%') && bx.text === '' && bx.wordBtns.length === 0 && bx.labels.join() === '이미지 첨부,이어서 보내기' && bx.disabled === true, JSON.stringify(bx && [bx.size, bx.labels, bx.disabled]));
        await A.pg.fill('#reply-902', '더 짧게'); bx = await box(A.pg);
        ok('② 글을 적으면 보내기 켜짐', bx.disabled === false);
        await A.pg.fill('#reply-902', ''); bx = await box(A.pg);
        ok('② 지우면 다시 꺼짐', bx.disabled === true);
        // 이미지 붙여넣기
        await A.pg.evaluate(b64 => { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([u8], 'p.png', { type: 'image/png' })); const ta = document.getElementById('reply-902'); ta.focus(); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, PNG.toString('base64'));
        await waitFor(async () => (await box(A.pg)).thumbs === 1, 4000); bx = await box(A.pg);
        ok('② 이미지 붙여넣기 → 상자 안 글 칸 위에 썸네일 · 글이 없어도 보내기 켜짐', bx.thumbs === 1 && bx.thumbAbove === true && bx.disabled === false, JSON.stringify([bx.thumbs, bx.thumbAbove, bx.disabled]));
        await A.pg.fill('#reply-902', '그림 참고해서 다시'); await A.pg.click('#desk-list .desk-thread-box[data-th="900"] [data-act="sendreply"]');
        const sent = await waitFor(async () => A.st.writes.find(w => /\/orders\/902\/reply$/.test(w.p)), 5000);
        ok('② 화살표 → POST /orders/902/reply · content = 적은 글 · image_data·image_mime 함께', !!sent && sent.body.content === '그림 참고해서 다시' && /^data:image\/png;base64,/.test(sent.body.image_data || '') && sent.body.image_mime === 'image/png', sent && JSON.stringify({ c: sent.body.content, mime: sent.body.image_mime }));
        await A.pg.waitForTimeout(1200);
        // 되묻기 답 칸도 같은 모양
        const qb = await A.pg.evaluate(() => { const b = document.querySelector('#desk-list [data-oid="880"] .desk-cbox'); return b ? { labels: Array.from(b.querySelectorAll('button')).map(x => x.getAttribute('aria-label')), dis: b.querySelector('[data-act="sendreply"]').disabled } : null; });
        ok('② 되묻기 답 칸도 같은 상자(「이미지 첨부」「답 보내기」 · 비었으면 꺼짐)', !!qb && qb.labels.join() === '이미지 첨부,답 보내기' && qb.dis === true, JSON.stringify(qb));
        ok('② 맨 위 새 지시 입력칸은 그대로(#desk-input · #desk-attach · #desk-send)', await A.pg.evaluate(() => !!document.querySelector('#desk-ask #desk-input') && !!document.getElementById('desk-attach') && !!document.getElementById('desk-send') && !document.querySelector('#desk-ask .desk-cbox')));
        await shot(A.pg, '538-1-chat-1440');

        // ══ ③ 대화 경계 · 채팅 종료 ══════════════════════════════════════════════════════
        const B = await open(admin, { width: 1440, height: 1000 });
        const th = await B.pg.evaluate(() => { const bs = Array.from(document.querySelectorAll('#desk-list .desk-thread-box')).filter(b => b.getClientRects().length); const gaps = []; for (let i = 1; i < bs.length; i++) gaps.push(Math.round(bs[i].getBoundingClientRect().top - bs[i - 1].getBoundingClientRect().bottom));
            return { n: bs.length, gaps, heads: bs.map(b => { const h = b.querySelector('.desk-th-head'); return h ? [(h.querySelector('.desk-th-when') || {}).textContent || '', (h.querySelector('.desk-th-sum') || {}).textContent || ''] : null; }), x: document.querySelectorAll('#desk-list .desk-th-head .desk-x, #desk-list .desk-thread-box .desk-x').length,
                end: Object.fromEntries(bs.map(b => [b.dataset.th, b.querySelectorAll('[data-act="endchat"]').length])) }; });
        ok('③ 인접한 두 대화 틀 사이 간격 16px 이상 · 틀마다 머리 줄(시작 시각 + 첫 글 한 줄)', th.n >= 4 && th.gaps.every(g => g >= 16) && th.heads.every(h => h && /시작$/.test(h[0]) && h[1].length > 0), JSON.stringify({ gaps: th.gaps, head: th.heads[0] }));
        ok('③ 대화 오른쪽 위 × 없음 · [채팅 종료]는 끝난 대화에만(진행 중 890 · 되묻기 880 에는 없음 · 최종발주 기록 870 에는 있음)', th.x === 0 && th.end['900'] === 1 && th.end['890'] === 0 && th.end['880'] === 0 && th.end['870'] === 1, JSON.stringify(th.end));
        const endPos = await B.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="900"]'), c = t.querySelector('.desk-cbox').getBoundingClientRect(), e = t.querySelector('[data-act="endchat"]').getBoundingClientRect(); return { right: e.left >= c.right - 1, h: Math.round(e.height), text: t.querySelector('[data-act="endchat"]').textContent.trim() }; });
        ok('③ [채팅 종료] = 상자 밖 오른쪽 · 44px', endPos.right && endPos.h >= 44 && endPos.text === '채팅 종료', JSON.stringify(endPos));
        await B.pg.click('#desk-list .desk-thread-box[data-th="900"] [data-act="endchat"]'); await B.pg.waitForTimeout(300);
        const ask = await B.pg.evaluate(() => { const a = document.querySelector('#desk-list .desk-thread-box[data-th="900"] .desk-end-ask'); return a ? a.innerText.replace(/\s+/g, ' ') : ''; });
        ok('③ 누르면 카드 안에서 한 번 확인(브라우저 확인창 0) · 아직 요청 안 나감', /이 채팅을 종료할까요/.test(ask) && B.st.dialogs === 0 && !B.st.writes.some(w => /hide-mine/.test(w.p)), ask);
        await B.pg.click('#desk-list .desk-thread-box[data-th="900"] [data-act="endno"]'); await B.pg.waitForTimeout(300);
        ok('③ [취소] → 확인 닫힘 · 요청 0', await B.pg.evaluate(() => !document.querySelector('#desk-list .desk-end-ask')) && !B.st.writes.some(w => /hide-mine/.test(w.p)));
        await B.pg.click('#desk-list .desk-thread-box[data-th="900"] [data-act="endchat"]'); await B.pg.waitForTimeout(250);
        await B.pg.click('#desk-list .desk-thread-box[data-th="900"] .desk-end-ask [data-act="hidethread"]');
        await waitFor(async () => B.st.writes.filter(w => /hide-mine/.test(w.p)).length >= 3, 5000); await B.pg.waitForTimeout(500);
        const hw = B.st.writes.filter(w => /hide-mine/.test(w.p)); const tz = await toast(B.pg);
        ok('③ [종료] → hide-mine 요청 수 = 차례 수(3) · 전부 hide:true · 대화가 채팅 탭에서 사라짐 · 토스트', hw.length === 3 && hw.every(w => w.body && w.body.hide === true) && hw.map(w => w.p.match(/(\d+)\/hide/)[1]).sort().join() === '900,901,902' && await B.pg.evaluate(() => !document.querySelector('#desk-list .desk-thread-box[data-th="900"]')) && /채팅을 종료했어요 · 이전 채팅 이력에서 다시 볼 수 있어요/.test(tz), tz.slice(0, 80));

        // ══ ④ 이전 채팅 이력 ═════════════════════════════════════════════════════════════
        await goTab(B.pg, 'all', '#desk-list .desk-h-item');
        const hist = pg => pg.evaluate(() => { const vis = el => el.getClientRects().length > 0; const items = Array.from(document.querySelectorAll('#desk-list .desk-h-item'));
            return { n: items.length, days: Array.from(document.querySelectorAll('#desk-list .desk-h-day')).map(d => d.textContent), table: !!document.querySelector('#desk-list table'), bar: vis(document.getElementById('desk-histbar')), mineToggle: vis(document.getElementById('desk-hist-mine-wrap')), fs: vis(document.getElementById('desk-fs')),
                rows: items.map(it => ({ th: it.dataset.th, when: it.querySelector('.desk-h-when').textContent, who: (it.querySelector('.desk-h-who') || {}).textContent || null, text: it.querySelector('.desk-h-text').textContent, n: (it.querySelector('.desk-h-n') || {}).textContent || '', badge: (it.querySelector('.desk-h-row .desk-badge') || {}).textContent || '', clip: !!it.querySelector('.desk-h-clip'), open: it.classList.contains('open'), vis: vis(it), h: Math.round(it.querySelector('.desk-h-row').getBoundingClientRect().height) })),
                more: (() => { const m = document.querySelector('#desk-list [data-act="histmore"]'); return m ? { has: true } : { has: false }; })() }; });
        let H = await hist(B.pg); const row = id => H.rows.find(r => r.th === String(id));
        ok('④ 이력 = 표가 아니라 대화 한 줄씩 · 검색칸 보임 · 관리자에겐 「내 것만」 · 상태 고르개는 숨김', !H.table && H.n > 10 && H.bar && H.mineToggle && !H.fs, JSON.stringify({ n: H.n, bar: H.bar }));
        ok('④ 첫 조회 = ?history=1&limit=60', /history=1/.test(B.st.hq[0] || '') && /limit=60/.test(B.st.hq[0] || ''), B.st.hq[0]);
        ok('④ 날짜 묶음 머리글(오늘 · 어제 · 그 전은 「N월」)', H.days[0] === '오늘' && H.days.includes('어제') && H.days.some(d => /^(\d{4}년 )?\d{1,2}월$/.test(d)), JSON.stringify(H.days));
        ok('④ 한 줄 = 대화 단위(900~902 는 한 줄 · 「3번 주고받음」 · 첫 글) · 관리자에겐 보낸 사람', !!row(900) && !row(901) && !row(902) && /^[34]번 주고받음$/.test(row(900).n) && row(900).text === '오늘 판매현황 알려줘' && row(900).who === '검증538' && row(790).who === '다른직원', JSON.stringify(row(900)));
        ok('④ 상태 배지는 문제 있을 때만(되묻기 = 확인 필요 · 오류 · 진행 중) · 끝난 대화엔 없음 · 첨부 표시', row(880).badge === '확인 필요' && row(690).badge === '오류' && row(890).badge === '진행 중' && row(800).badge === '' && row(800).clip && row(700).clip && !row(790).clip, JSON.stringify([row(880).badge, row(690).badge, row(890).badge, row(800).badge]));
        ok('④ 부모가 조회 범위 밖인 꼬리(650)는 그 줄이 뿌리 · 최종발주 정리 기록(870)도 한 줄', !!row(650) && !!row(870));
        const gapsH = await B.pg.evaluate(() => { const its = Array.from(document.querySelectorAll('#desk-list .desk-h-item')).filter(i => i.getClientRects().length); const g = []; for (let i = 1; i < its.length; i++) if (its[i].previousElementSibling === its[i - 1]) g.push(Math.round(its[i].getBoundingClientRect().top - its[i - 1].getBoundingClientRect().bottom)); return { g, border: getComputedStyle(its[0]).borderTopWidth }; });
        ok('④ 대화 한 줄마다 카드(테두리)로 떨어져 있음(줄 사이 간격 6px 이상)', gapsH.g.length > 0 && gapsH.g.every(x => x >= 6) && parseFloat(gapsH.border) >= 1, JSON.stringify(gapsH));
        // 펼침(읽기 전용)
        await B.pg.click('#desk-list .desk-h-item[data-th="800"] .desk-h-row'); await B.pg.waitForTimeout(400);
        const op = id => B.pg.evaluate(id => { const it = document.querySelector(`#desk-list .desk-h-item[data-th="${id}"]`); if (!it) return null; const b = it.querySelector('.desk-h-body'); const prev = it.previousElementSibling, next = it.nextElementSibling, r = el => el.getBoundingClientRect();
            return { open: it.classList.contains('open'), bw: parseFloat(getComputedStyle(it).borderTopWidth), bc: getComputedStyle(it).borderTopColor, head: b ? (b.querySelector('.desk-h-head') || {}).textContent : '', me: b ? Array.from(b.querySelectorAll('.desk-bub.me .desk-q')).map(x => x.textContent) : [], ai: b ? b.querySelectorAll('.desk-bub.ai').length : 0, ta: b ? b.querySelectorAll('textarea').length : 0, copy: b ? b.querySelectorAll('[data-act="copy"]').length : 0, follow: b ? b.querySelectorAll('[data-act="follow"], [data-act="sendreply"]').length : 0,
                resume: b && b.querySelector('[data-act="resume"]') ? b.querySelector('[data-act="resume"]').textContent.trim() : null, gapTop: prev && prev.classList.contains('desk-h-item') ? Math.round(r(it).top - r(prev).bottom) : null, gapBot: next && next.classList.contains('desk-h-item') ? Math.round(r(next).top - r(it).bottom) : null }; }, id);
        let o8 = await op(800);
        ok('④ 줄을 누르면 그 자리에서 말풍선으로 펼쳐짐(내 글 2 · 클코 답 2 · 답변 복사 있음) · 읽기 전용(답 칸·이어서 지시 없음)', o8.open && o8.me.join('|') === '어제 정산 확인해줘|효돈만 다시' && o8.ai === 2 && o8.copy === 2 && o8.ta === 0 && o8.follow === 0, JSON.stringify(o8));
        ok('④ 펼친 대화는 한 틀(인디고 테두리 2px)로 감싸지고 위아래 대화와 16px 이상 떨어짐 · 머리에 「시작 날짜·시각 · N번 주고받음」', o8.bw >= 2 && /165, 172, 255|79, 70, 229/.test(o8.bc) && (o8.gapTop == null || o8.gapTop >= 16) && (o8.gapBot == null || o8.gapBot >= 16) && /시작 · 2번 주고받음$/.test(o8.head), JSON.stringify([o8.bw, o8.bc, o8.gapTop, o8.gapBot, o8.head]));
        ok('④ 종료해 둔 내 대화 = [이 채팅 다시 이어가기]', o8.resume === '이 채팅 다시 이어가기');
        await B.pg.click('#desk-list .desk-h-item[data-th="790"] .desk-h-row'); await B.pg.waitForTimeout(300);
        await B.pg.click('#desk-list .desk-h-item[data-th="870"] .desk-h-row'); await B.pg.waitForTimeout(300);
        await B.pg.click('#desk-list .desk-h-item[data-th="880"] .desk-h-row'); await B.pg.waitForTimeout(300);
        const o79 = await op(790), o87 = await op(870), o88 = await op(880);
        ok('④ 남의 대화(790)·최종발주 정리 기록(870)에는 다시 이어가기 버튼 없음 · 되묻기(880)는 답 칸 없이 안내만', o79.open && o79.resume === null && o87.open && o87.resume === null && o88.ta === 0 && o88.resume === '채팅 탭에서 이어가기', JSON.stringify([o79.resume, o87.resume, o88.resume, o88.ta]));
        await shot(B.pg, '538-2-history-1440');
        // 더 보기
        if (await B.pg.isVisible('#desk-list-more')) { await B.pg.click('#desk-list-more'); await B.pg.waitForTimeout(400); }
        H = await hist(B.pg); const n0 = H.n;
        ok('④ 60건을 채워 받았으면 맨 아래 [더 보기]', H.more.has);
        const hq0 = B.st.hq.length; await B.pg.click('#desk-list [data-act="histmore"]');
        await waitFor(async () => B.st.hq.slice(hq0).some(q => /before=/.test(q)), 5000); await B.pg.waitForTimeout(600);
        const mq = B.st.hq.slice(hq0).find(q => /before=/.test(q)) || ''; H = await hist(B.pg);
        const minFirst = Math.min(...B.st.orders.slice().sort((a, b) => b.id - a.id).slice(0, 60).map(o => o.id));
        ok('④ [더 보기] → ?history=1&before=(받은 것 중 가장 작은 번호)&limit=60 · 줄이 늘어남 · 끝까지 받으면 버튼 사라짐', new RegExp('before=' + minFirst + '(&|$)').test(mq) && /history=1/.test(mq) && H.n > n0 && !H.more.has, mq + ' · ' + n0 + ' → ' + H.n);
        // 내 것만
        await B.pg.check('#desk-hist-mine'); await B.pg.waitForTimeout(300); H = await hist(B.pg);
        ok('④ 「내 것만」 → 남의 대화가 빠짐', !row(790) && !!row(800)); await B.pg.uncheck('#desk-hist-mine'); await B.pg.waitForTimeout(200);
        // 검색
        const hq1 = B.st.hq.length; await B.pg.fill('#desk-hist-q', '보고서'); await B.pg.waitForTimeout(150);
        const early = B.st.hq.slice(hq1).some(q => /q=/.test(q));
        await waitFor(async () => B.st.hq.slice(hq1).some(q => /q=/.test(q)), 4000); await B.pg.waitForTimeout(500);
        const sq = B.st.hq.slice(hq1).find(q => /q=/.test(q)) || ''; H = await hist(B.pg);
        ok('④ 검색 = 입력을 멈춘 뒤(350ms) ?history=1&q=검색어 · 맞는 대화만 남음', !early && decodeURIComponent(sq).includes('q=보고서') && /history=1/.test(sq) && H.n === 1 && row(700), sq + ' · ' + H.n);
        await B.pg.fill('#desk-hist-q', '세상에없는말'); await B.pg.waitForTimeout(1200);
        ok('④ 찾는 글이 없으면 안내 글', /찾는 글이 든 채팅이 없어요/.test(await B.pg.evaluate(() => document.getElementById('desk-list').innerText)));
        await B.pg.fill('#desk-hist-q', ''); await B.pg.waitForTimeout(1200);
        // 다시 이어가기
        H = await hist(B.pg); if (!row(800).open) { await B.pg.click('#desk-list .desk-h-item[data-th="800"] .desk-h-row'); await B.pg.waitForTimeout(300); }
        const w0 = B.st.writes.length; await B.pg.click('#desk-list .desk-h-item[data-th="800"] [data-act="resume"]');
        await B.pg.waitForSelector('#desk-list .desk-thread-box[data-th="800"]', { timeout: 15000 }); await B.pg.waitForTimeout(900);
        const rw = B.st.writes.slice(w0).filter(w => /hide-mine/.test(w.p));
        const rs = await B.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="800"]'), r = t.getBoundingClientRect(); return { tab: document.querySelector('#desk-tabs .desk-tab[aria-selected="true"]').dataset.tab, vis: t.getClientRects().length > 0, inView: r.top < window.innerHeight && r.bottom > 0, focus: document.activeElement && document.activeElement.id }; });
        ok('④ [이 채팅 다시 이어가기] → 숨겨 둔 차례마다 hide-mine { hide:false }(2회) → 채팅 탭으로 옮겨 그 대화가 보이고 답 칸에 커서', rw.length === 2 && rw.every(w => w.body && w.body.hide === false) && rs.tab === 'mine' && rs.vis && rs.inView && rs.focus === 'reply-801', JSON.stringify([rw.length, rs]));
        // 이미 채팅 탭에 있는 대화 = 요청 없이 이동만
        await goTab(B.pg, 'all', '#desk-list .desk-h-item');
        if (!(await B.pg.evaluate(() => document.querySelector('#desk-list .desk-h-item[data-th="800"]').classList.contains('open')))) { await B.pg.click('#desk-list .desk-h-item[data-th="800"] .desk-h-row'); await B.pg.waitForTimeout(300); }
        const lbl = await B.pg.evaluate(() => document.querySelector('#desk-list .desk-h-item[data-th="800"] [data-act="resume"]').textContent.trim());
        const w1 = B.st.writes.length; await B.pg.click('#desk-list .desk-h-item[data-th="800"] [data-act="resume"]'); await B.pg.waitForSelector('#desk-list .desk-thread-box[data-th="800"]', { timeout: 15000 }); await B.pg.waitForTimeout(500);
        ok('④ 이미 채팅 탭에 떠 있는 대화 = 버튼 「채팅 탭에서 이어가기」 · 되살리기 요청 없이 이동만', lbl === '채팅 탭에서 이어가기' && B.st.writes.slice(w1).filter(w => /hide-mine/.test(w.p)).length === 0);
        // ⑤ 승인 결재함
        await B.pg.click('#desk-tabs .desk-tab[data-tab="approval"]'); await B.pg.waitForTimeout(1200);
        ok('⑤ 승인 결재함 = 종전 동작(승인 대기만 조회 · 없으면 안내 글) · 이력 검색칸 숨김', /승인을 기다리는 요청이 없어요/.test(await B.pg.evaluate(() => document.getElementById('desk-list').innerText)) && !(await B.pg.isVisible('#desk-histbar')));
        ok('가로 넘침 없음(1440px) · 화면 오류 0 · 브라우저 확인창 0', !(await overflow(B.pg)) && A.errors.length === 0 && B.errors.length === 0 && B.st.dialogs === 0, [...A.errors, ...B.errors].join(' | '));
        await A.ctx.close(); await B.ctx.close();

        // ══ ⑥ 직원 · 폰 390px ════════════════════════════════════════════════════════════
        const P = await open(staff, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
        tb = await tabs(P.pg);
        ok('⑥ 직원 = 채팅 · 이전 채팅 이력 보임 · 승인 결재함은 안 보임', tb.find(t => t.tab === 'mine').vis && tb.find(t => t.tab === 'all').vis && !tb.find(t => t.tab === 'approval').vis, JSON.stringify(tb.map(t => [t.text, t.vis])));
        const pm = await P.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="900"]'); const c = t.querySelector('.desk-cbox').getBoundingClientRect(), e = t.querySelector('[data-act="endchat"]').getBoundingClientRect(), hs = Array.from(t.querySelectorAll('.desk-cbtn, [data-act="endchat"]')).map(b => Math.round(b.getBoundingClientRect().height));
            const bs = Array.from(document.querySelectorAll('#desk-list .desk-thread-box')).filter(b => b.getClientRects().length); const gaps = []; for (let i = 1; i < bs.length; i++) gaps.push(Math.round(bs[i].getBoundingClientRect().top - bs[i - 1].getBoundingClientRect().bottom));
            return { below: e.top >= c.bottom - 1, hs, gaps, over: document.documentElement.scrollWidth > window.innerWidth + 1, boxW: Math.round(c.width), inW: c.right <= window.innerWidth }; });
        ok('⑥ 390px 채팅 탭: 답 상자가 화면 안 · [채팅 종료]는 아래 줄 · 누르는 것 44px 이상 · 대화 틀 간격 16px 이상 · 가로 넘침 0', pm.below && pm.hs.every(h => h >= 44) && pm.gaps.every(g => g >= 16) && !pm.over && pm.inW, JSON.stringify(pm));
        await shot(P.pg, '538-3-chat-390');
        await P.pg.tap('#desk-tabs .desk-tab[data-tab="all"]'); await P.pg.waitForSelector('#desk-list .desk-h-item', { timeout: 15000 }); await P.pg.waitForTimeout(500);
        H = await hist(P.pg);
        ok('⑥ 직원 이력: 본인 것만(남의 대화 없음) · 보낸 사람 칸·「내 것만」 없음 · 종료한 대화도 보임', !row(790) && !!row(800) && H.rows.every(r => r.who === null) && !H.mineToggle, JSON.stringify({ n: H.n, mine: H.mineToggle }));
        ok('⑥ 390px 이력: 줄 높이 44px 이상 · 가로 넘침 0', H.rows.filter(r => r.vis).every(r => r.h >= 44) && !(await overflow(P.pg)), JSON.stringify(H.rows.filter(r => r.vis).map(r => r.h).slice(0, 6)));
        await P.pg.tap('#desk-list .desk-h-item[data-th="800"] .desk-h-row'); await P.pg.waitForTimeout(400);
        const pOver = await overflow(P.pg);
        await shot(P.pg, '538-4-history-390');
        const pw0 = P.st.writes.length; await P.pg.tap('#desk-list .desk-h-item[data-th="800"] [data-act="resume"]');
        await P.pg.waitForSelector('#desk-list .desk-thread-box[data-th="800"]', { timeout: 15000 }); await P.pg.waitForTimeout(600);
        ok('⑥ 390px: 펼쳐도 가로 넘침 0 · 직원도 [이 채팅 다시 이어가기] 됨(hide:false 2회 → 채팅 탭)', !pOver && P.st.writes.slice(pw0).filter(w => /hide-mine/.test(w.p) && w.body.hide === false).length === 2 && (await tabs(P.pg)).find(t => t.sel === 'true').tab === 'mine');
        ok('⑥ 화면 오류 0 · 브라우저 확인창 0(폰)', P.errors.length === 0 && P.st.dialogs === 0, P.errors.join(' | '));
        await P.ctx.close();
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e)); }
    finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) srv.kill();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
