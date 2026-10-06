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
                if (p === '/api/agent-office/orders') { const isF = !!(body && body.file_name); const o = { id: st.nextId++, content: body && body.content, status: '대기', created_at: new Date().toISOString(), processed_at: null, created_by: '검증538', created_by_id: user.id, mine_hidden: false, has_image: !!(body && body.image_data) && !isF, file_name: isF ? body.file_name : null, reply_to: null, followed_by: null, steps: [], result: null }; st.orders.push(o); return json(route, { ok: true, message: '보냈어요', order: { id: o.id } }); }
                if ((m = /\/orders\/(\d+)\/reply$/.exec(p))) { const o = { id: st.nextId++, content: body && body.content, status: '대기', created_at: new Date().toISOString(), processed_at: null, created_by: '검증538', created_by_id: user.id, mine_hidden: false, has_image: !!(body && body.image_data) && !(body && body.file_name), file_name: (body && body.file_name) || null, reply_to: Number(m[1]), followed_by: null, steps: [], result: null }; st.orders.push(o); return json(route, { ok: true, message: '보냈어요', order: { id: o.id } }); }
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
                else { (st.mq = st.mq || []).push(u.search); rows = rows.filter(o => o.created_by_id === user.id && !o.mine_hidden); }
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
        ok('① 탭 이름 = 채팅 · 이전 채팅 이력(#566 승인 결재함 탭 없음 · data-tab 은 mine/all 그대로)', tb.map(t => t.tab + ':' + t.text).join() === 'mine:채팅,all:이전 채팅 이력', JSON.stringify(tb.map(t => t.text)));
        ok('① 관리자 = 두 탭 모두 보임 · 처음 고른 탭 = 채팅', tb.every(t => t.vis) && tb[0].sel === 'true');
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
        ok('② 두 버튼은 둥근 아이콘(44px 이상 · 글자 없음 · aria-label 「이미지 첨부」「이어서 보내기」) · 비었으면 보내기 꺼짐', !!bx && bx.size.every(n => n >= 44) && bx.round.every(v => v === '50%') && bx.text === '' && bx.wordBtns.filter(w => w !== '채팅 종료').length === 0 && bx.labels.join() === '이미지·파일 첨부,이어서 보내기' && bx.disabled === true, JSON.stringify(bx && [bx.size, bx.labels, bx.disabled]));
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
        ok('② 되묻기 답 칸도 같은 상자(「이미지 첨부」「답 보내기」 · 비었으면 꺼짐)', !!qb && qb.labels.join() === '이미지·파일 첨부,답 보내기' && qb.dis === true, JSON.stringify(qb));
        ok('② #550 맨 위 입력칸도 답 상자와 같은 모양(.desk-cbox) · id 그대로(#desk-input · #desk-attach · #desk-send)', await A.pg.evaluate(() => !!document.querySelector('#desk-ask .desk-cbox #desk-input') && !!document.getElementById('desk-attach') && !!document.getElementById('desk-send')));
        await shot(A.pg, '538-1-chat-1440');

        // ══ ③ 대화 경계 · 채팅 종료 ══════════════════════════════════════════════════════
        const B = await open(admin, { width: 1440, height: 1000 });
        const th = await B.pg.evaluate(() => { const bs = Array.from(document.querySelectorAll('#desk-list .desk-thread-box')).filter(b => b.getClientRects().length); const gaps = []; for (let i = 1; i < bs.length; i++) gaps.push(Math.round(bs[i].getBoundingClientRect().top - bs[i - 1].getBoundingClientRect().bottom));
            return { n: bs.length, gaps, heads: bs.map(b => { const h = b.querySelector('.desk-th-head'); return h ? [(h.querySelector('.desk-th-when') || {}).textContent || '', (h.querySelector('.desk-th-sum') || {}).textContent || ''] : null; }), x: document.querySelectorAll('#desk-list .desk-th-head .desk-x, #desk-list .desk-thread-box .desk-x').length,
                end: Object.fromEntries(bs.map(b => [b.dataset.th, b.querySelectorAll('[data-act="endchat"]').length])) }; });
        ok('③ 인접한 두 대화 틀 사이 간격 16px 이상 · 틀마다 머리 줄(시작 시각 + 첫 글 한 줄)', th.n >= 4 && th.gaps.every(g => g >= 16) && th.heads.every(h => h && /시작$/.test(h[0]) && h[1].length > 0), JSON.stringify({ gaps: th.gaps, head: th.heads[0] }));
        ok('③ 대화 오른쪽 위 × 없음 · [채팅 종료]는 끝난 대화에만(진행 중 890 · 되묻기 880 에는 없음 · 최종발주 기록 870 에는 있음)', th.x === 0 && th.end['900'] === 1 && th.end['890'] === 0 && th.end['880'] === 0 && th.end['870'] === 1, JSON.stringify(th.end));
        const endPos = await B.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="900"]'), c = t.querySelector('.desk-cbox').getBoundingClientRect(), e = t.querySelector('[data-act="endchat"]').getBoundingClientRect(); const p = t.querySelector('.desk-cbox [data-act="replyimg"]').getBoundingClientRect(), s = t.querySelector('.desk-cbox [data-act="sendreply"]').getBoundingClientRect(), tb = t.getBoundingClientRect(), ecs = getComputedStyle(t.querySelector('[data-act="endchat"]')); return { right: !!t.querySelector('.desk-cbox [data-act="endchat"]') && e.left >= p.right && e.right <= s.left && Math.abs(e.top - p.top) < 3, full: c.width >= tb.width - 80, red: ecs.color + ' / ' + ecs.backgroundColor, h: Math.round(e.height), text: t.querySelector('[data-act="endchat"]').textContent.trim() }; });
        ok('③ [채팅 종료] = 답 상자 안 「+」 바로 옆(#541) · 44px · 붉은 음영 · 상자가 틀 너비를 다 씀', endPos.right && endPos.full && endPos.h >= 44 && endPos.text === '채팅 종료' && endPos.red === 'rgb(180, 35, 24) / rgb(254, 228, 226)', JSON.stringify(endPos));
        await B.pg.click('#desk-list .desk-thread-box[data-th="900"] [data-act="endchat"]'); await B.pg.waitForTimeout(300);
        const ask = await B.pg.evaluate(() => { const a = document.querySelector('#desk-list .desk-thread-box[data-th="900"] .desk-end-ask'); return a ? a.innerText.replace(/\s+/g, ' ') : ''; });
        const askPos = await B.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="900"]'), a = t.querySelector('.desk-cbox .desk-end-ask.in'), y = a && a.querySelector('[data-act="hidethread"]'), p = t.querySelector('.desk-cbox [data-act="replyimg"]'); if (!a || !y || !p) return null; const ry = y.getBoundingClientRect(), rp = p.getBoundingClientRect(), cs = getComputedStyle(y); return { inBox: true, sameRow: Math.abs(ry.top - rp.top) < 3, nextToPlus: ry.left - rp.right < 16 && ry.left >= rp.right, h: Math.round(ry.height), bg: cs.backgroundColor, label: a.getAttribute('aria-label') }; });
        ok('③ 누르면 답 상자 안 같은 자리에서 한 번 확인(#559 — [종료하기]가 「+」 바로 옆 · 붉은 채움 · 44px · 브라우저 확인창 0) · 아직 요청 안 나감', /종료하기/.test(ask) && /취소/.test(ask) && !!askPos && askPos.sameRow && askPos.nextToPlus && askPos.h >= 44 && (askPos.bg === 'rgb(217, 45, 32)' || askPos.bg === 'rgb(180, 35, 24)') && /이전 채팅 이력/.test(askPos.label) && B.st.dialogs === 0 && !B.st.writes.some(w => /hide-mine/.test(w.p)), ask + ' ' + JSON.stringify(askPos));
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
        ok('⑤ #566 승인 결재함 탭 없음(대표 화면에도) · 화면에 그 이름 0', (await B.pg.evaluate(() => document.querySelectorAll('[data-tab="approval"], #desk-tab-approval').length + (/승인 결재함/.test(document.getElementById('ao-desk-root').innerText) ? 1 : 0))) === 0);   // #543 검색칸은 세 탭 모두
        ok('가로 넘침 없음(1440px) · 화면 오류 0 · 브라우저 확인창 0', !(await overflow(B.pg)) && A.errors.length === 0 && B.errors.length === 0 && B.st.dialogs === 0, [...A.errors, ...B.errors].join(' | '));
        await A.ctx.close(); await B.ctx.close();

        // ══ ⑥ 직원 · 폰 390px ════════════════════════════════════════════════════════════
        const P = await open(staff, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
        tb = await tabs(P.pg);
        ok('⑥ 직원 = 채팅 · 이전 채팅 이력 보임 · 승인 결재함은 안 보임', tb.find(t => t.tab === 'mine').vis && tb.find(t => t.tab === 'all').vis && !tb.find(t => t.tab === 'approval'), JSON.stringify(tb.map(t => [t.text, t.vis])));
        const pm = await P.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="900"]'); const c = t.querySelector('.desk-cbox').getBoundingClientRect(), e = t.querySelector('[data-act="endchat"]').getBoundingClientRect(), hs = Array.from(t.querySelectorAll('.desk-cbtn, [data-act="endchat"]')).map(b => Math.round(b.getBoundingClientRect().height));
            const bs = Array.from(document.querySelectorAll('#desk-list .desk-thread-box')).filter(b => b.getClientRects().length); const gaps = []; for (let i = 1; i < bs.length; i++) gaps.push(Math.round(bs[i].getBoundingClientRect().top - bs[i - 1].getBoundingClientRect().bottom));
            return { below: e.top >= c.top && e.bottom <= c.bottom + 1 && e.right <= c.right, hs, gaps, over: document.documentElement.scrollWidth > window.innerWidth + 1, boxW: Math.round(c.width), inW: c.right <= window.innerWidth }; });
        ok('⑥ 390px 채팅 탭: 답 상자가 화면 안 · [채팅 종료]는 상자 안 · 누르는 것 44px 이상 · 대화 틀 간격 16px 이상 · 가로 넘침 0', pm.below && pm.hs.every(h => h >= 44) && pm.gaps.every(g => g >= 16) && !pm.over && pm.inW, JSON.stringify(pm));
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

        // ══ ⑦ #543 검색칸(세 탭) · 강조 · 누르면 답 칸으로 · 본문 눌러 접기 ══════════════════════════
        const C = await open(admin, { width: 1440, height: 1000 });
        const vis538 = pg => pg.evaluate(() => ({ bar: document.getElementById('desk-histbar').getClientRects().length > 0, ph: document.getElementById('desk-hist-q').placeholder, val: document.getElementById('desk-hist-q').value, x: document.getElementById('desk-hist-x').getClientRects().length > 0, ths: Array.from(document.querySelectorAll('#desk-list .desk-thread-box')).filter(b => b.getClientRects().length).map(b => b.dataset.th), hl: Array.from(document.querySelectorAll('#desk-list mark.desk-hl')).map(m => m.textContent), empty: (document.querySelector('#desk-list .desk-empty') || {}).textContent || '' }));
        let sv = await vis538(C.pg);
        ok('⑦ 채팅 탭에도 검색칸(자리표시 글 「보낸 글이나 답변에서 찾기」)', sv.bar && sv.ph === '보낸 글이나 답변에서 찾기' && sv.ths.length >= 4, JSON.stringify(sv.ths));
        const g0 = C.st.hq.length + 0; const gets0 = C.st.gets || 0;
        await C.pg.type('#desk-hist-q', '황금'); await C.pg.waitForTimeout(120); sv = await vis538(C.pg);
        ok('⑦ 채팅 탭: 치는 즉시 걸러짐(「황금」 → 그 글이 든 대화 900 만 · 한 차례라도 맞으면 대화 통째) · 서버 조회 없이', sv.ths.join() === '900' && C.st.hq.length === g0, JSON.stringify(sv.ths));
        ok('⑦ 맞는 낱말에 형광 표시(mark) · × 보임', sv.hl.length >= 1 && sv.hl.every(t => t === '황금') && sv.x, JSON.stringify(sv.hl));
        const turns7 = await C.pg.evaluate(() => document.querySelectorAll('#desk-list .desk-thread-box[data-th="900"] .desk-turn').length);
        ok('⑦ 걸러도 그 대화의 차례는 전부 보임(3차례)', turns7 === 3, String(turns7));
        await C.pg.fill('#desk-hist-q', '세상에없는말'); await C.pg.waitForTimeout(150); sv = await vis538(C.pg);
        ok('⑦ 맞는 것이 없으면 안내 글', sv.ths.length === 0 && /찾는 글이 든 채팅이 없어요/.test(sv.empty));
        await C.pg.click('#desk-hist-x'); await C.pg.waitForTimeout(150); sv = await vis538(C.pg);
        ok('⑦ × → 검색어 지워지고 전부 다시 보임', sv.val === '' && !sv.x && sv.ths.length >= 4);
        // 탭마다 값이 따로
        await C.pg.fill('#desk-hist-q', '쿠폰'); await C.pg.waitForTimeout(120);
        await goTab(C.pg, 'all', '#desk-list .desk-h-item'); const vAll0 = await C.pg.inputValue('#desk-hist-q');
        const hqA = C.st.hq.length; await C.pg.type('#desk-hist-q', '보고'); await C.pg.waitForTimeout(110);
        const inst = await C.pg.evaluate(() => Array.from(document.querySelectorAll('#desk-list .desk-h-item')).filter(i => i.getClientRects().length).map(i => i.dataset.th));
        const serverYet = C.st.hq.slice(hqA).some(q => /q=/.test(q));
        ok('⑦ 이력 탭: 검색어는 탭마다 따로(채팅 탭의 「쿠폰」이 안 넘어옴) · 치는 즉시 받아 둔 줄에서 걸러짐(서버 답 전)', vAll0 === '' && inst.join() === '700' && !serverYet, JSON.stringify({ vAll0, inst, serverYet }));
        await waitFor(async () => C.st.hq.slice(hqA).some(q => /q=/.test(q)), 3000); await C.pg.waitForTimeout(400);
        const sq7 = C.st.hq.slice(hqA).filter(q => /q=/.test(q)).pop() || '';
        const hlA = await C.pg.evaluate(() => ({ n: document.querySelectorAll('#desk-list .desk-h-item').length, hl: Array.from(document.querySelectorAll('#desk-list .desk-h-text mark.desk-hl')).map(m => m.textContent) }));
        ok('⑦ 이력 탭: 250ms 쯤 뒤 서버 ?history=1&q= 결과로 바꿔 끼움 · 한 줄 글에 형광', decodeURIComponent(sq7).includes('q=보고') && hlA.n === 1 && hlA.hl.join() === '보고', sq7);
        await C.pg.click('#desk-hist-x'); await C.pg.waitForTimeout(900);
        await C.pg.click('#desk-tabs .desk-tab[data-tab="mine"]'); await C.pg.waitForTimeout(900);
        ok('⑦ 채팅 탭에도 검색칸 · 「내 것만」은 이력 탭에만', await C.pg.isVisible('#desk-hist-q') && !(await C.pg.isVisible('#desk-hist-mine-wrap')));
        await goTab(C.pg, 'mine', '#desk-list .desk-thread-box, #desk-list .desk-empty');
        ok('⑦ 채팅 탭으로 돌아오면 그 탭의 검색어(「쿠폰」)가 그대로', (await C.pg.inputValue('#desk-hist-q')) === '쿠폰' && (await vis538(C.pg)).ths.join() === '880');
        await C.pg.click('#desk-hist-x'); await C.pg.waitForTimeout(200);
        // 대화 머리 줄 = 답 칸으로
        await C.pg.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
        await C.pg.click('#desk-list .desk-thread-box[data-th="900"] .desk-th-head .desk-th-sum'); await C.pg.waitForTimeout(700);
        const f7 = await C.pg.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(); return { id: a.id, inView: r.top >= 0 && r.bottom <= window.innerHeight }; });
        ok('⑦ 채팅 탭: 대화 머리 줄을 누르면 그 대화의 답 칸으로 옮겨 커서', f7.id === 'reply-902' && f7.inView, JSON.stringify(f7));
        await C.pg.evaluate(() => document.activeElement.blur());
        await C.pg.click('#desk-list .desk-thread-box[data-th="900"] [data-act="copy"]'); await C.pg.waitForTimeout(300);
        ok('⑦ 버튼(답변 복사)을 누를 땐 답 칸으로 옮기지 않음', await C.pg.evaluate(() => document.activeElement.id !== 'reply-902'));
        // 이력: 본문 눌러 접기
        await goTab(C.pg, 'all', '#desk-list .desk-h-item');
        await C.pg.click('#desk-list .desk-h-item[data-th="800"] .desk-h-row'); await C.pg.waitForTimeout(300);
        await C.pg.click('#desk-list .desk-h-item[data-th="800"] .desk-h-body [data-act="copy"]'); await C.pg.waitForTimeout(250);
        const stay = await C.pg.evaluate(() => document.querySelector('#desk-list .desk-h-item[data-th="800"]').classList.contains('open'));
        await C.pg.click('#desk-list .desk-h-item[data-th="800"] .desk-h-head'); await C.pg.waitForTimeout(300);
        const shut1 = await C.pg.evaluate(() => !document.querySelector('#desk-list .desk-h-item[data-th="800"]').classList.contains('open'));
        await C.pg.click('#desk-list .desk-h-item[data-th="800"] .desk-h-row'); await C.pg.waitForTimeout(300);
        await C.pg.click('#desk-list .desk-h-item[data-th="800"] .desk-h-body .desk-turn', { position: { x: 12, y: 6 } }); await C.pg.waitForTimeout(300);
        const shut2 = await C.pg.evaluate(() => !document.querySelector('#desk-list .desk-h-item[data-th="800"]').classList.contains('open'));
        ok('⑦ 이력: 펼친 대화의 머리 줄·말풍선 빈 곳을 누르면 접힘 · 안의 버튼을 누를 땐 그대로', stay && shut1 && shut2, JSON.stringify({ stay, shut1, shut2 }));
        // 음영
        const tone = await C.pg.evaluate(() => { const it = Array.from(document.querySelectorAll('#desk-list .desk-h-item:not(.open)')).find(i => i.getClientRects().length), cs = getComputedStyle(it), day = getComputedStyle(document.querySelector('#desk-list .desk-h-day')); const whoM = document.querySelector('#desk-list .desk-h-who.mine'), whoO = document.querySelector('#desk-list .desk-h-who:not(.mine)');
            return { bg: cs.backgroundColor, bl: cs.borderLeftWidth, bt: cs.borderTopWidth, bc: cs.borderTopColor, dayBg: day.backgroundColor, dayR: parseFloat(day.borderTopLeftRadius), mine: whoM ? getComputedStyle(whoM).color : '', other: whoO ? getComputedStyle(whoO).color : '' }; });
        ok('⑦ 이력 한 줄 = 옅은 인디고 바탕 + 옅은 인디고 테두리(왼쪽 띠 없음) · 날짜는 알약 · 내 것/남의 것은 이름 색으로', tone.bg === 'rgb(247, 247, 255)' && tone.bl === tone.bt && tone.bc === 'rgb(224, 226, 255)' && tone.dayBg === 'rgb(238, 240, 244)' && tone.dayR >= 12 && tone.mine && tone.other && tone.mine !== tone.other, JSON.stringify(tone));
        await shot(C.pg, '543-1-history-tone-1440');
        // 크게 보기에서 다시 이어가기
        await C.pg.click('#desk-list-more'); await C.pg.waitForTimeout(400);
        const ft = await C.pg.evaluate(() => ({ full: document.getElementById('desk-listbox').classList.contains('is-full'), title: document.getElementById('desk-full-title').textContent }));
        ok('⑦ 크게 보기 제목 = 탭 이름(이전 채팅 이력)', ft.full && ft.title === '이전 채팅 이력', JSON.stringify(ft));
        await C.pg.click('#desk-list .desk-h-item[data-th="700"] .desk-h-row'); await C.pg.waitForTimeout(300);
        const w7 = C.st.writes.length; await C.pg.click('#desk-list .desk-h-item[data-th="700"] [data-act="resume"]');
        await C.pg.waitForSelector('#desk-list .desk-thread-box[data-th="700"]', { timeout: 15000 }); await C.pg.waitForTimeout(900);
        const r7 = await C.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="700"]'), r = t.getBoundingClientRect(), a = document.activeElement, ar = a.getBoundingClientRect(); return { tab: document.querySelector('#desk-tabs .desk-tab[aria-selected="true"]').dataset.tab, vis: t.getClientRects().length > 0, focus: a.id, focusIn: ar.top >= 0 && ar.bottom <= window.innerHeight, title: document.getElementById('desk-full-title').textContent, full: document.getElementById('desk-listbox').classList.contains('is-full') }; });
        ok('⑦ 크게 보기(is-full)에서 [이 채팅 다시 이어가기] → hide:false → 채팅 탭으로 넘어가 그 대화가 보이고 답 칸에 커서(화면 안)', C.st.writes.slice(w7).filter(w => /hide-mine/.test(w.p) && w.body.hide === false).length === 1 && r7.tab === 'mine' && r7.vis && r7.focus === 'reply-700' && r7.focusIn && r7.title === '채팅', JSON.stringify(r7));
        if (r7.full) { await C.pg.keyboard.press('Escape'); await C.pg.waitForTimeout(300); }
        // 60건 밖
        const D0 = await open(admin, { width: 1440, height: 1000 });
        for (let i = 0; i < 64; i++) D0.st.orders.push({ id: 2000 + i, content: '채팅 탭을 채우는 글 ' + i, status: '완료', created_at: new Date().toISOString(), processed_at: new Date().toISOString(), created_by: '검증538', created_by_id: admin.id, mine_hidden: false, has_image: false, reply_to: null, followed_by: null, steps: [], result: { type: 'desk_answer', answer: 'ok' } });
        await goTab(D0.pg, 'all', '#desk-list .desk-h-item'); await D0.pg.fill('#desk-hist-q', '어제 정산'); await D0.pg.waitForTimeout(900);
        await D0.pg.click('#desk-list .desk-h-item[data-th="800"] .desk-h-row'); await D0.pg.waitForTimeout(300);
        await D0.pg.click('#desk-list .desk-h-item[data-th="800"] [data-act="resume"]');
        const far = await waitFor(async () => D0.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="800"]'); return t && t.getClientRects().length > 0 && document.activeElement.id === 'reply-801'; }), 15000);
        if (!far) console.log('  dbg far', JSON.stringify(await D0.pg.evaluate(() => { const e = document.querySelector('#desk-list [data-oid="801"]'); return { tab: document.querySelector('#desk-tabs .desk-tab[aria-selected="true"]').dataset.tab, has801: !!e, th: e && e.closest('.desk-thread-box') ? e.closest('.desk-thread-box').dataset.th : null, act: document.activeElement.id || document.activeElement.tagName, n: document.querySelectorAll('#desk-list .desk-thread-box').length }; })));
        ok('⑦ 다시 이어간 대화가 채팅 탭 60건 밖이어도 한 번 더 넉넉히 받아(?mine=1&limit=200) 찾아 감', !!far && (D0.st.mq || []).some(q => /limit=200/.test(q)), JSON.stringify((D0.st.mq || []).slice(-2)));
        await D0.ctx.close();

        // ══ ⑧ #544 파일 첨부 ══════════════════════════════════════════════════════════════
        const mkFile = (name, type, size) => ({ name, mimeType: type, buffer: Buffer.alloc(size || 2048, 0x41) });
        const topInfo = pg => pg.evaluate(() => ({ accept: document.getElementById('desk-file').accept, label: document.getElementById('desk-attach').getAttribute('aria-label'), chips: Array.from(document.querySelectorAll('#desk-thumbs .desk-filechip')).map(c => [c.querySelector('.desk-filechip-name').textContent, c.querySelector('.desk-filechip-size').textContent, !!c.querySelector('button')]), thumbs: document.querySelectorAll('#desk-thumbs .desk-thumb').length }));
        const pick = async (pg, sel, files) => { const [fc] = await Promise.all([pg.waitForEvent('filechooser', { timeout: 5000 }), pg.click(sel)]); await fc.setFiles(files); await pg.waitForTimeout(500); };
        await goTab(C.pg, 'mine', '#desk-list .desk-thread-box');
        await pick(C.pg, '#desk-attach', [mkFile('발주명단.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 3000)]);
        let ti = await topInfo(C.pg);
        ok('⑧ 맨 위 클립: 이미지 + xlsx·xls·csv·pdf·txt 를 고를 수 있음 · aria-label 「이미지·파일 첨부」', /image\/\*/.test(ti.accept) && ['.xlsx', '.xls', '.csv', '.pdf', '.txt'].every(x => ti.accept.includes(x)) && ti.label === '이미지·파일 첨부', ti.accept);
        ok('⑧ 파일을 고르면 썸네일 자리에 칩(이름 + 크기 + ×)', ti.chips.length === 1 && ti.chips[0][0] === '발주명단.xlsx' && /KB$/.test(ti.chips[0][1]) && ti.chips[0][2] && ti.thumbs === 0, JSON.stringify(ti.chips));
        await C.pg.fill('#desk-input', '이 명단으로 정리해줘'); const w8 = C.st.writes.length; await C.pg.click('#desk-send');
        const p8 = await waitFor(async () => C.st.writes.slice(w8).find(w => w.p === '/api/agent-office/orders'), 5000); await C.pg.waitForTimeout(900);
        ok('⑧ 보내기 → POST /orders 본문에 content · file_name · image_data(data URL) · image_mime', !!p8 && p8.body.content === '이 명단으로 정리해줘' && p8.body.file_name === '발주명단.xlsx' && /^data:[^;,]*;base64,/.test(p8.body.image_data || '') && !!p8.body.image_mime, p8 && JSON.stringify({ f: p8.body.file_name, m: p8.body.image_mime, d: String(p8.body.image_data).slice(0, 30) }));
        const meta8 = await C.pg.evaluate(() => Array.from(document.querySelectorAll('#desk-list .desk-bub-meta')).map(m => m.textContent).find(t => /발주명단/.test(t)) || '');
        ok('⑧ 보낸 뒤 내 말풍선 아래 「📎 파일이름」 · 칩은 사라짐', /📎 발주명단\.xlsx/.test(meta8) && (await topInfo(C.pg)).chips.length === 0, meta8);
        await pick(C.pg, '#desk-attach', [mkFile('a.csv', 'text/csv'), mkFile('b.pdf', 'application/pdf')]); ti = await topInfo(C.pg); let tz8 = await toast(C.pg);
        ok('⑧ 파일을 여러 개 고르면 첫 것만 + 안내', ti.chips.length === 1 && ti.chips[0][0] === 'a.csv' && /파일은 한 번에 1개만/.test(tz8), JSON.stringify(ti.chips));
        await C.pg.click('#desk-thumbs .desk-filechip button'); await C.pg.waitForTimeout(200);
        ok('⑧ 칩의 × → 첨부 빠짐', (await topInfo(C.pg)).chips.length === 0);
        await pick(C.pg, '#desk-attach', [mkFile('위험.exe', 'application/octet-stream')]); ti = await topInfo(C.pg); tz8 = await toast(C.pg);
        ok('⑧ 허용 밖 확장자(exe)는 붙지 않고 안내', ti.chips.length === 0 && ti.thumbs === 0 && /첨부할 수 있는 파일은 이미지 · 엑셀/.test(tz8), tz8.slice(-70));
        await pick(C.pg, '#desk-attach', [mkFile('큰파일.pdf', 'application/pdf', 10 * 1024 * 1024 + 10)]); ti = await topInfo(C.pg); tz8 = await toast(C.pg);
        ok('⑧ 10MB 초과는 붙지 않고 안내', ti.chips.length === 0 && /10MB보다 큰 파일/.test(tz8), tz8.slice(-50));
        await pick(C.pg, '#desk-attach', [{ name: 'p.png', mimeType: 'image/png', buffer: PNG }]); ti = await topInfo(C.pg);
        const w8b = C.st.writes.length; await C.pg.fill('#desk-input', '그림 봐줘'); await C.pg.click('#desk-send');
        const p8b = await waitFor(async () => C.st.writes.slice(w8b).find(w => w.p === '/api/agent-office/orders'), 5000); await C.pg.waitForTimeout(700);
        ok('⑧ 이미지는 종전대로(썸네일 · 요청 본문에 file_name 없음)', ti.thumbs === 1 && ti.chips.length === 0 && !!p8b && /^data:image\/png;base64,/.test(p8b.body.image_data) && p8b.body.file_name === undefined, p8b && JSON.stringify(Object.keys(p8b.body)));
        const [fcS] = await Promise.all([C.pg.waitForEvent('filechooser', { timeout: 5000 }), C.pg.click('#desk-settle-now')]); const accS = await C.pg.evaluate(() => document.getElementById('desk-file').accept); await fcS.setFiles([]);
        ok('⑧ 「정산 이미지」 버튼은 이미지 전용 그대로(accept = image/*)', accS === 'image/*', accS); await C.pg.fill('#desk-input', '');
        // 답 상자
        await pick(C.pg, '#desk-list .desk-thread-box[data-th="870"] ~ .desk-thread-box [data-act="replyimg"], #desk-list .desk-turn[data-oid="700"] [data-act="replyimg"]', [mkFile('수정본.pdf', 'application/pdf', 5000)]);
        const rc = await C.pg.evaluate(() => { const b = document.querySelector('#desk-list .desk-cbox .desk-filechip'); if (!b) return null; const box = b.closest('.desk-cbox'); return { id: box.dataset.cbox, name: b.querySelector('.desk-filechip-name').textContent, label: box.querySelector('[data-act="replyimg"]').getAttribute('aria-label'), sendOn: !box.querySelector('[data-act="sendreply"]').disabled, above: b.getBoundingClientRect().bottom <= box.querySelector('textarea').getBoundingClientRect().top + 1 }; });
        ok('⑧ 답 상자의 「+」도 파일을 받음: 글 칸 위에 칩 · 글 없이도 보내기 켜짐 · aria-label 「이미지·파일 첨부」', !!rc && rc.name === '수정본.pdf' && rc.label === '이미지·파일 첨부' && rc.sendOn && rc.above, JSON.stringify(rc));
        const w8c = C.st.writes.length; await C.pg.fill('#reply-' + rc.id, '이걸로 다시'); await C.pg.click('#desk-list .desk-cbox[data-cbox="' + rc.id + '"] [data-act="sendreply"]');
        const p8c = await waitFor(async () => C.st.writes.slice(w8c).find(w => /\/reply$/.test(w.p)), 5000); await C.pg.waitForTimeout(600);
        ok('⑧ 답 보내기 → POST /orders/:id/reply 본문에 file_name · data URL', !!p8c && p8c.body.file_name === '수정본.pdf' && p8c.body.content === '이걸로 다시' && /^data:application\/pdf;base64,/.test(p8c.body.image_data), p8c && p8c.p);
        await goTab(C.pg, 'all', '#desk-list .desk-h-item');
        const clip8 = await C.pg.evaluate(() => Array.from(document.querySelectorAll('#desk-list .desk-h-item')).filter(i => /이 명단으로 정리해줘/.test(i.textContent)).map(i => !!i.querySelector('.desk-h-clip')));
        ok('⑧ 이력 탭의 첨부 클립 표시가 파일(file_name)도 봄', clip8.length === 1 && clip8[0] === true, JSON.stringify(clip8));
        ok('⑦⑧ 가로 넘침 0 · 화면 오류 0 · 브라우저 확인창 0(1440px)', !(await overflow(C.pg)) && C.errors.length === 0 && C.st.dialogs === 0, C.errors.join(' | '));
        await C.ctx.close();

        // ══ ⑨ 폰 390px ═══════════════════════════════════════════════════════════════════
        const Q = await open(staff, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
        await Q.pg.fill('#desk-hist-q', '황금'); await Q.pg.waitForTimeout(150);
        const q9 = await Q.pg.evaluate(() => ({ ths: Array.from(document.querySelectorAll('#desk-list .desk-thread-box')).filter(b => b.getClientRects().length).map(b => b.dataset.th), xh: Math.round(document.getElementById('desk-hist-x').getBoundingClientRect().height), over: document.documentElement.scrollWidth > window.innerWidth + 1 }));
        ok('⑨ 390px: 검색 즉시 걸러짐 · × 44px · 가로 넘침 0', q9.ths.join() === '900' && q9.xh >= 44 && !q9.over, JSON.stringify(q9));
        await Q.pg.tap('#desk-hist-x'); await Q.pg.waitForTimeout(200);
        await Q.pg.tap('#desk-tabs .desk-tab[data-tab="all"]'); await Q.pg.waitForSelector('#desk-list .desk-h-item', { timeout: 15000 }); await Q.pg.waitForTimeout(400);
        await Q.pg.tap('#desk-list-more'); await Q.pg.waitForTimeout(400);
        await Q.pg.tap('#desk-list .desk-h-item[data-th="800"] .desk-h-row'); await Q.pg.waitForTimeout(300);
        await shot(Q.pg, '543-2-history-full-390');
        await Q.pg.tap('#desk-list .desk-h-item[data-th="800"] [data-act="resume"]');
        const r9 = await waitFor(async () => Q.pg.evaluate(() => { const t = document.querySelector('#desk-list .desk-thread-box[data-th="800"]'); const a = document.activeElement, ar = a.getBoundingClientRect(); return t && t.getClientRects().length > 0 && a.id === 'reply-801' && ar.top >= 0 && ar.bottom <= window.innerHeight ? { tab: document.querySelector('#desk-tabs .desk-tab[aria-selected="true"]').dataset.tab } : null; }), 15000);
        ok('⑨ 390px 크게 보기에서 [이 채팅 다시 이어가기] → 채팅 탭 · 그 대화 · 답 칸 커서가 화면 안', !!r9 && r9.tab === 'mine', JSON.stringify(r9));
        await pick(Q.pg, '#desk-list .desk-cbox[data-cbox="801"] [data-act="replyimg"]', [mkFile('아주아주아주아주아주아주아주아주아주아주아주아주아주아주 긴 이름의 파일.xlsx', 'application/octet-stream', 4000)]);
        const c9 = await Q.pg.evaluate(() => { const c = document.querySelector('#desk-list .desk-cbox[data-cbox="801"] .desk-filechip'); if (!c) return null; const r = c.getBoundingClientRect(), b = c.closest('.desk-cbox').getBoundingClientRect(); return { inBox: r.right <= b.right + 1, xh: Math.round(c.querySelector('button').getBoundingClientRect().height), over: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
        ok('⑨ 390px: 긴 파일 이름 칩이 상자 안에서 말줄임 · × 44px · 가로 넘침 0', !!c9 && c9.inBox && c9.xh >= 44 && !c9.over, JSON.stringify(c9));
        await shot(Q.pg, '543-3-chat-filechip-390');
        ok('⑨ 화면 오류 0 · 브라우저 확인창 0(폰)', Q.errors.length === 0 && Q.st.dialogs === 0, Q.errors.join(' | '));
        await Q.ctx.close();

        // ══ ⑩ #552 글 칸 글씨 17px · 답변 묶음별 [복사] ══════════════════════════════════════════
        const SEC_ANS = ['요청하신 3가지를 만들었어요.', '━━━━━━━━━━', '━━━ ① 문자(LMS) ━━━', '', '[제주아꼼이네] 문자 첫 줄', '━━━━━━━━', '문자 둘째 줄', '', '━━━ ② 톡톡(이미지형 카드) ━━━', '톡톡 **굵은** 글', '', '━━━ ③ 톡톡 이미지 ━━━', '이미지 설명 글', '━━━ 확인한 것 · 발송 전 볼 곳 ━━━', '- 대상 50명'].join('\n');
        const addSec = st => { const mk2 = (id, content, answer) => ({ id, content, status: '완료', created_at: new Date().toISOString(), processed_at: new Date().toISOString(), created_by: '검증538', created_by_id: admin.id, mine_hidden: false, has_image: false, reply_to: null, followed_by: null, steps: [], result: { type: 'desk_answer', answer } }); st.orders.push(mk2(3001, '문자 톡톡 이미지 만들어줘', SEC_ANS), mk2(3002, '묶음 없는 답', '그냥 한 덩어리 답입니다.\n━━━━━━━━\n구분 줄 아래 글')); };
        const stubClip = pg => pg.evaluate(() => { window.__clip = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip.push(t); return Promise.resolve(); } } }); });
        const secInfo = (pg, oid) => pg.evaluate(oid => { const t = document.querySelector(`#desk-list [data-oid="${oid}"]`); if (!t) return null; const hs = Array.from(t.querySelectorAll('.desk-sec-head'));
            return { heads: hs.map(h => h.querySelector('b').textContent), btns: hs.map(h => { const b = h.querySelector('[data-act="copysec"]'), r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), h: Math.round(r.height), right: r.left > h.querySelector('b').getBoundingClientRect().left }; }), md: t.querySelectorAll('.desk-a.answer .desk-md').length, hr: t.querySelectorAll('.desk-a.answer hr').length, all: t.querySelectorAll('[data-act="copy"]').length, strong: t.querySelectorAll('.desk-a.answer strong').length, text: (t.querySelector('.desk-a.answer') || {}).innerText || '' }; }, oid);
        const E = await open(admin, { width: 1440, height: 1000 });
        addSec(E.st); await goTab(E.pg, 'all', '#desk-list .desk-h-item'); await goTab(E.pg, 'mine', '#desk-list .desk-thread-box[data-th="3001"]'); await stubClip(E.pg);
        const fs17 = await E.pg.evaluate(() => { const a = getComputedStyle(document.getElementById('desk-input')), r = document.querySelector('#desk-list .desk-cbox .desk-reply-in'), b = getComputedStyle(r); return { top: a.fontSize, reply: b.fontSize, topH: Math.round(document.getElementById('desk-input').getBoundingClientRect().height), replyH: Math.round(r.getBoundingClientRect().height), ph: getComputedStyle(r, '::placeholder').fontSize, btn: Math.round(document.querySelector('#desk-list .desk-cbox .desk-cbtn').getBoundingClientRect().height) }; });
        ok('⑩ⓐ 글 쓰는 칸 글씨 17px(맨 위 입력칸 · 답 상자 · 자리표시 글도) · 칸 최소 56px · 버튼 44px 그대로', fs17.top === '17px' && fs17.reply === '17px' && fs17.ph === '17px' && fs17.topH >= 56 && fs17.replyH >= 56 && fs17.replyH <= 60 && fs17.btn === 44, JSON.stringify(fs17));
        let s1 = await secInfo(E.pg, 3001);
        ok('⑩ⓑ 묶음 머리(「━━━ 글 ━━━」)가 있는 답 = 묶음 4개마다 머리 오른쪽에 [복사](aria-label 「… 복사」) · 맨 아래 [답변 복사]는 그대로', !!s1 && s1.heads.join('|') === '① 문자(LMS)|② 톡톡(이미지형 카드)|③ 톡톡 이미지|확인한 것 · 발송 전 볼 곳' && s1.btns.length === 4 && s1.btns[0].label === '① 문자(LMS) 복사' && s1.btns.every(b => b.right) && s1.all === 1 && s1.strong === 1, JSON.stringify(s1 && { heads: s1.heads, btns: s1.btns.map(b => b.label) }));
        ok('⑩ⓓ 본문 안의 글자 없는 「━━━━」 줄은 묶음 머리로 안 봄(구분선 2개로 그려짐 · 묶음 수 그대로)', !!s1 && s1.hr === 2 && s1.heads.length === 4 && /요청하신 3가지를 만들었어요/.test(s1.text), String(s1 && s1.hr));
        await E.pg.click('#desk-list [data-oid="3001"] [data-act="copysec"][data-sec="0"]'); await E.pg.waitForTimeout(300);
        await E.pg.click('#desk-list [data-oid="3001"] [data-act="copysec"][data-sec="1"]'); await E.pg.waitForTimeout(300);
        await E.pg.click('#desk-list [data-oid="3001"] [data-act="copysec"][data-sec="3"]'); await E.pg.waitForTimeout(300);
        const clip = await E.pg.evaluate(() => window.__clip), tz10 = await toast(E.pg);
        ok('⑩ⓑ [복사] → 그 묶음의 본문만(머리 줄 없음 · 다른 묶음 글 없음 · 원문 글자 그대로 — 굵게 표시 기호·안쪽 구분 줄 포함 · 앞뒤 빈 줄 정리)', clip.length === 3 && clip[0] === '[제주아꼼이네] 문자 첫 줄\n━━━━━━━━\n문자 둘째 줄' && clip[1] === '톡톡 **굵은** 글' && clip[2] === '- 대상 50명', JSON.stringify(clip));
        ok('⑩ⓑ 토스트 「① 문자(LMS)를 복사했어요」', /① 문자\(LMS\)를 복사했어요/.test(tz10) && /발송 전 볼 곳을 복사했어요/.test(tz10), tz10.slice(-90));
        await E.pg.click('#desk-list [data-oid="3001"] [data-act="copy"]'); await E.pg.waitForTimeout(300);
        ok('⑩ⓑ 맨 아래 [답변 복사] = 답 전체(종전과 같음)', (await E.pg.evaluate(() => window.__clip[3])) === SEC_ANS);
        const s2 = await secInfo(E.pg, 3002);
        ok('⑩ⓒ 묶음 머리가 없는 답 = 묶음 [복사] 0 · 종전과 같은 그리기(한 덩어리 · 구분선 1개 · [답변 복사] 1개)', !!s2 && s2.heads.length === 0 && s2.md === 1 && s2.hr === 1 && s2.all === 1 && /그냥 한 덩어리 답입니다/.test(s2.text), JSON.stringify(s2 && { md: s2.md, hr: s2.hr }));
        // 이력 탭 펼친 대화에도
        await E.pg.evaluate(() => window.scrollTo(0, 0)); await goTab(E.pg, 'all', '#desk-list .desk-h-item'); await E.pg.click('#desk-list .desk-h-item[data-th="3001"] .desk-h-row'); await E.pg.waitForTimeout(300); await stubClip(E.pg);
        const sH = await secInfo(E.pg, 3001);
        await E.pg.click('#desk-list .desk-h-item[data-th="3001"] [data-act="copysec"][data-sec="2"]'); await E.pg.waitForTimeout(300);
        const stillOpen = await E.pg.evaluate(() => document.querySelector('#desk-list .desk-h-item[data-th="3001"]').classList.contains('open'));
        ok('⑩ 이전 채팅 이력의 펼친 대화에도 같은 묶음 [복사] · 눌러도 대화가 접히지 않음', !!sH && sH.btns.length === 4 && (await E.pg.evaluate(() => window.__clip[0])) === '이미지 설명 글' && stillOpen, JSON.stringify(sH && sH.heads));
        ok('⑩ 화면 오류 0(1440px)', E.errors.length === 0, E.errors.join(' | ')); await E.ctx.close();
        const F = await open(staff, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
        F.st.orders.push({ id: 3001, content: '문자 톡톡 이미지 만들어줘', status: '완료', created_at: new Date().toISOString(), processed_at: new Date().toISOString(), created_by: '검증538', created_by_id: staff.id, mine_hidden: false, has_image: false, reply_to: null, followed_by: null, steps: [], result: { type: 'desk_answer', answer: SEC_ANS } });
        await F.pg.tap('#desk-tabs .desk-tab[data-tab="all"]'); await F.pg.waitForSelector('#desk-list .desk-h-item', { timeout: 15000 }); await F.pg.tap('#desk-tabs .desk-tab[data-tab="mine"]'); await F.pg.waitForSelector('#desk-list .desk-thread-box[data-th="3001"]', { timeout: 15000 }); await F.pg.waitForTimeout(400);
        const sF = await secInfo(F.pg, 3001), fF = await F.pg.evaluate(() => ({ fs: getComputedStyle(document.getElementById('desk-input')).fontSize, over: document.documentElement.scrollWidth > window.innerWidth + 1 }));
        await shot(F.pg, '552-1-sections-390');
        ok('⑩ⓔ 390px: 묶음 [복사] 누르는 높이 44px 이상 · 글 칸 글씨 17px · 가로 넘침 0 · 오류 0', !!sF && sF.btns.length === 4 && sF.btns.every(b => b.h >= 44) && fF.fs === '17px' && !fF.over && F.errors.length === 0, JSON.stringify({ h: sF && sF.btns.map(b => b.h), fF }));
        await F.ctx.close();

        // ───────── ⑪ #557 채팅 글 크기·강약(대표 10/6 — 구조는 그대로 · 본문 16 / 제목 18 / 부가 정보 12) ─────────
        const ANS557 = ['문구를 만들었어요. 아래 2가지입니다.', '', '━━━ ① 문자(LMS) ━━━', '[제주아꼼이네] 황금향이 가장 맛있는 때예요', '', '안녕하세요, 제주아꼼이네입니다.', '지난번 보내 드린 황금향은 맛있게 드셨나요?', '★ 이번 주 수확분은 과즙이 가득해요', '★ 선물용 3kg · 5kg 모두 준비했어요', '▶ 주문: 스마트스토어에서 검색', '▶ 문의: 010-0000-0000', '※ 오전 8시 이전 주문은 당일 발송해요', '', '━━━ ② 확인한 것 ━━━', '확인한 항목이에요.', '1. 가격은 판매현황과 대조했어요', '2. 수신 거부 고객은 뺐어요', '', '| 항목 | 값 |', '|---|---|', '| 대상 | 412명 |'].join('\n');
        const mk557 = uid => [
            { id: 3101, content: '추석 뒤에 황금향 재구매 안내 문자랑 톡톡 문구 만들어줘. 대상은 최근 두 달 구매 고객이고 톤은 부드럽게 해줘. 길게 적어도 괜찮아.', status: '완료', created_at: new Date().toISOString(), processed_at: new Date().toISOString(), created_by: '검증538', created_by_id: uid, mine_hidden: false, has_image: false, reply_to: null, followed_by: null, steps: [{ t: new Date().toISOString(), kind: 'lane', lane: 'opus', actor: '클코', text: '🧠 꼼꼼한 답' }], result: { type: 'desk_answer', title: '재구매 안내 문구 2종을 만들었어요 — 발송 전 대상 수만 확인해 주세요', answer: ANS557 } },
            { id: 3102, content: '오늘 발송 몇 건이야?', status: '완료', created_at: new Date(Date.now() - 60e3).toISOString(), processed_at: new Date().toISOString(), created_by: '검증538', created_by_id: uid, mine_hidden: false, has_image: false, reply_to: null, followed_by: null, steps: [], result: { type: 'desk_answer', answer: '오늘 발송은 43건이에요.\n택배 접수는 오후 3시까지예요.' } }];
        const m557 = pg => pg.evaluate(() => {
            const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
            const bgOf = el => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor, m = b.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) >= 0.99)) return b; } return 'rgb(255,255,255)'; };
            const cr = el => { const a = lum(getComputedStyle(el).color), b = lum(bgOf(el)); return Math.round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * 100) / 100; };
            const fs = el => el ? getComputedStyle(el).fontSize : '', T = document.querySelector('#desk-list [data-oid="3101"]'), U = document.querySelector('#desk-list [data-oid="3102"]'); if (!T) return null;
            const A = T.querySelector('.desk-a.answer'), me = T.querySelector('.desk-bub.me'), box = T.closest('.desk-thread-box, .desk-h-body') || T.parentElement;
            const title = A.querySelector('.desk-a-title'), lab = A.querySelector('.desk-a-label'), lane = A.querySelector('.desk-lane'), meta = me.querySelector('.desk-bub-meta');
            const lns = Array.from(A.querySelectorAll('.desk-md-ln')).map(l => ({ t: l.textContent.trim().slice(0, 1), sym: l.classList.contains('sym'), mt: parseFloat(getComputedStyle(l).marginTop) }));
            const cs = getComputedStyle(box), inner = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), tr = title.getBoundingClientRect(), ar = A.getBoundingClientRect(), lr = lane ? lane.getBoundingClientRect() : null;
            return { body: fs(A), p: fs(A.querySelector('.desk-md-p')), li: fs(A.querySelector('.desk-md-l li')), td: fs(A.querySelector('.desk-md-t td')), lh: Math.round(parseFloat(getComputedStyle(A).lineHeight) / parseFloat(fs(A)) * 100) / 100,
                title: fs(title), titleW: getComputedStyle(title).fontWeight, titleLh: Math.round(parseFloat(getComputedStyle(title).lineHeight) / parseFloat(fs(title)) * 100) / 100, pW: getComputedStyle(A.querySelector('.desk-md-p')).fontWeight, titleFull: tr.width >= (ar.width - 40), titleBelowLane: !lr || tr.top >= lr.bottom - 1,
                noTitle: !!U && !U.querySelector('.desk-a-title'), body2: U ? fs(U.querySelector('.desk-a.answer')) : '',
                meQ: fs(me.querySelector('.desk-q')), meRatio: Math.round(me.getBoundingClientRect().width / inner * 1000) / 1000, ansRatio: Math.round(ar.width / inner * 1000) / 1000,
                lab: fs(lab), lane: fs(lane), meta: fs(meta), cLab: cr(lab), cLane: lane ? cr(lane) : 99, cMeta: cr(meta), lns,
                olMt: parseFloat(getComputedStyle(A.querySelector('.desk-md-l')).marginTop), text: A.querySelector('.desk-sec-body').textContent,
                padBox: parseFloat(cs.paddingLeft), padAns: parseFloat(getComputedStyle(A).paddingLeft), padSec: parseFloat(getComputedStyle(A.querySelector('.desk-sec-body')).paddingLeft),
                over: document.documentElement.scrollWidth > window.innerWidth + 1, sizes: Array.from(new Set([fs(A), fs(title), fs(lab), fs(lane), fs(meta)])).length,
                small: Array.from(T.querySelectorAll('button')).filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5).map(b => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 12)) };
        });
        const gap557 = m => { const L = m.lns, i = k => L.findIndex(l => l.t === k); const s1 = i('★'), a1 = i('▶'), n1 = i('※'); return { firstStar: L[s1].mt, secondStar: L[s1 + 1].mt, firstArrow: L[a1].mt, secondArrow: L[a1 + 1].mt, note: L[n1].mt, plain: L.filter(l => !l.sym).map(l => l.mt) }; };
        const G7 = await open(staff, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
        mk557(staff.id).forEach(o => G7.st.orders.push(o));
        await G7.pg.tap('#desk-tabs .desk-tab[data-tab="all"]'); await G7.pg.waitForSelector('#desk-list .desk-h-item', { timeout: 15000 }); await G7.pg.tap('#desk-tabs .desk-tab[data-tab="mine"]'); await G7.pg.waitForSelector('#desk-list [data-oid="3101"] .desk-a.answer', { timeout: 15000 }); await G7.pg.waitForTimeout(400);
        await stubClip(G7.pg);
        const g = await m557(G7.pg), gg = gap557(g); await shot(G7.pg, '557-1-type-390');
        ok('⑪ⓐ 390px: 클코 답 본문 12.3px(문단·목록·표 같은 크기) · 줄 높이 1.6 안팎', g.body === '12.3px' && g.p === '12.3px' && g.li === '12.3px' && g.td === '12.3px' && g.lh >= 1.55 && g.lh <= 1.65, JSON.stringify({ body: g.body, p: g.p, li: g.li, td: g.td, lh: g.lh }));
        ok('⑪ⓐ 부가 정보(번호·시각 · 처리 길 칩 · 「클코 답변」 표지) 11px · 대비 4.5:1 이상', g.meta === '11px' && g.lane === '11px' && g.lab === '11px' && g.cMeta >= 4.5 && g.cLane >= 4.5 && g.cLab >= 4.5, JSON.stringify({ meta: g.cMeta, lane: g.cLane, lab: g.cLab }));
        ok('⑪ⓑ 답 제목 14px 굵게(줄 높이 1.35 안팎) · 본문은 보통 굵기 · 제목은 처리 길 칩 아래 줄에서 폭을 다 씀', g.title === '14px' && Number(g.titleW) >= 700 && g.titleLh >= 1.3 && g.titleLh <= 1.4 && Number(g.pW) <= 500 && g.titleFull && g.titleBelowLane, JSON.stringify({ t: g.title, w: g.titleW, lh: g.titleLh, pW: g.pW, full: g.titleFull, below: g.titleBelowLane }));
        ok('⑪ⓑ 제목 없는 답은 그대로(제목 칸 없음 · 본문 12.3px)', g.noTitle && g.body2 === '12.3px');
        ok('⑪ⓒ 내 말풍선 글 12.3px · 폭은 대화 틀 안 폭의 85% 이하 · 클코 답은 폭을 다 씀', g.meQ === '12.3px' && g.meRatio <= 0.851 && g.meRatio >= 0.7 && g.ansRatio >= 0.99, JSON.stringify({ me: g.meRatio, ans: g.ansRatio }));
        ok('⑪ⓓ 기호 줄: 앞 글과 6~8px 띄움 · 같은 기호끼리는 붙임(★★ · ▶▶) · 다른 기호로 바뀌면 다시 띄움 · 보통 줄은 0', gg.firstStar >= 6 && gg.firstStar <= 8 && gg.secondStar === 0 && gg.firstArrow >= 6 && gg.firstArrow <= 8 && gg.secondArrow === 0 && gg.note >= 6 && gg.note <= 8 && gg.plain.every(v => v === 0), JSON.stringify(gg));
        ok('⑪ⓓ 번호 목록도 앞 글과 6~8px', g.olMt >= 6 && g.olMt <= 8, String(g.olMt));
        await G7.pg.tap('#desk-list [data-oid="3101"] [data-act="copysec"][data-sec="0"]'); await G7.pg.waitForTimeout(300);
        const c557 = await G7.pg.evaluate(() => window.__clip[0]);
        ok('⑪ⓓ 글자는 한 자도 안 바뀜 — 묶음 [복사] 결과 = 원문 그대로(줄바꿈·기호·빈 줄 포함)', c557 === ANS557.split('\n').slice(3, 12).join('\n'), JSON.stringify(c557).slice(0, 120));
        ok('⑪ⓔ 390px: 안쪽 좌우 여백 줄임(대화 틀 8 · 답 칸 10 · 묶음 틀 10) · 누르는 것 44px 이상 · 가로 넘침 0 · 오류 0', g.padBox === 8 && g.padAns === 10 && g.padSec === 10 && g.small.length === 0 && !g.over && G7.errors.length === 0, JSON.stringify({ box: g.padBox, ans: g.padAns, sec: g.padSec, small: g.small, err: G7.errors }));
        ok('⑪ 글씨 크기 3단계 이내(18 / 16 / 12)', g.sizes <= 3, String(g.sizes));
        // 이전 채팅 이력의 펼친 대화에도 같은 글 크기
        await G7.pg.evaluate(() => window.scrollTo(0, 0)); await G7.pg.tap('#desk-tabs .desk-tab[data-tab="all"]'); await G7.pg.waitForSelector('#desk-list .desk-h-item[data-th="3101"]', { timeout: 15000 }); await G7.pg.tap('#desk-list .desk-h-item[data-th="3101"] .desk-h-row'); await G7.pg.waitForTimeout(400);
        const gh = await m557(G7.pg);
        ok('⑪ 이전 채팅 이력의 펼친 대화에도 같은 글 크기(본문 12.3 · 제목 14 · 내 글 12.3 · 부가 11) · 가로 넘침 0', !!gh && gh.body === '12.3px' && gh.title === '14px' && gh.meQ === '12.3px' && gh.meta === '11px' && !gh.over, gh ? JSON.stringify({ b: gh.body, t: gh.title, me: gh.meQ, meta: gh.meta, meR: gh.meRatio }) : 'null');
        await G7.ctx.close();
        const H7 = await open(ceo, { width: 1440, height: 900 });
        mk557(ceo.id).forEach(o => H7.st.orders.push(o));
        await goTab(H7.pg, 'all', '#desk-list .desk-h-item'); await goTab(H7.pg, 'mine', '#desk-list [data-oid="3101"] .desk-a.answer'); await H7.pg.waitForTimeout(400);
        const h = await m557(H7.pg), hh = gap557(h); await shot(H7.pg, '557-2-type-1440');
        ok('⑪ⓕ 1440px: 본문 12.3px · 제목 14px · 내 글 12.3px · 부가 11px(대비 4.5 이상) · 기호 줄 간격 같음 · 내 말풍선 85% 이하 · 가로 넘침 0 · 오류 0', h.body === '12.3px' && h.td === '12.3px' && h.title === '14px' && h.meQ === '12.3px' && h.meta === '11px' && h.cMeta >= 4.5 && h.cLane >= 4.5 && h.cLab >= 4.5 && hh.firstStar >= 6 && hh.secondStar === 0 && h.meRatio <= 0.851 && !h.over && H7.errors.length === 0, JSON.stringify({ b: h.body, td: h.td, me: h.meRatio, c: [h.cMeta, h.cLane, h.cLab], err: H7.errors }));
        // 표 보기 자세히 칸에도 같은 글 크기
        await H7.pg.evaluate(() => { localStorage.setItem('akm_desk_view', 'table'); }); await H7.pg.reload({ waitUntil: 'networkidle' }); await H7.pg.waitForTimeout(2500);
        await H7.pg.evaluate(() => { const n = document.querySelector('.nav-item[data-page="agent-office"]'); if (n) n.click(); document.querySelectorAll('.ao-settle-overlay').forEach(e => e.remove()); });
        const tb7 = await H7.pg.waitForSelector('#desk-list tr.row', { timeout: 15000 }).then(() => true).catch(() => false);
        if (tb7) {
            await H7.pg.evaluate(() => { const r = Array.from(document.querySelectorAll('#desk-list tr.row')).find(x => /재구매 안내/.test(x.textContent)); if (r) r.click(); }); await H7.pg.waitForTimeout(500);
            const tv7 = await H7.pg.evaluate(() => { const a = Array.from(document.querySelectorAll('#desk-list .desk-a.answer')).find(x => x.querySelector('.desk-a-title')); return a ? { b: getComputedStyle(a).fontSize, t: getComputedStyle(a.querySelector('.desk-a-title')).fontSize } : null; });
            ok('⑪ 표 보기 자세히 칸에도 같은 글 크기(본문 12.3 · 제목 14)', !!tv7 && tv7.b === '12.3px' && tv7.t === '14px', JSON.stringify(tv7));
        } else ok('⑪ 표 보기 자세히 칸에도 같은 글 크기(본문 12.3 · 제목 14)', false, '표 보기를 열지 못함');
        await H7.ctx.close();
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e)); }
    finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) srv.kill();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
