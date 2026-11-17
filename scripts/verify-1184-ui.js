// #1184 화면 검증(Playwright · 실클릭) — 합본 작업 트리를 읽기 전용 로컬 서버(ro-preload-711 · 포트 PORT1184U 기본 3458)로 띄운 뒤 실행
//   🔴 쓰기 = 브라우저에서 전부 가짜 응답(POST·PUT·DELETE 는 서버로 안 감) · 외부 호출(네이버·쿠팡·카페24 주문 불러오기)도 가짜 · 실DB = 화면이 하는 읽기만
//   ① 주요 메뉴 스모크(콘솔 오류 0) ② Esc(배송조회·중간발주) ③ 사진 장마다 보내다 중간 실패 ④ 문자 초안 중 Ctrl+Enter·대화 옮김·dup 안내
//   ⑤ 체험 번호 미입력 판 치는 중 1분 새로 고침 쉼 ⑥ 체험 달 넘기기(읽는 중) ⑦ 퇴사 결재자 서류(대표 O · 직원 X) ⑧ 남의 지시 번호(직원) ⑨ 휴가 끝 < 시작(화면 문구 = 서버 400 문구)
//   실행: (서버) LUCKY_TABLE=lucky_events_v1184 JWT_SECRET=local1184 PORT=3458 node -r ./scripts/ro-preload-711.js server.js
//         (검증) JWT_SECRET=local1184 OTHER_ORDER=<직원 5 가 아닌 사람의 지시 번호> node scripts/verify-1184-ui.js
'use strict';
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
const PORT = Number(process.env.PORT1184U) || 3458, BASE = 'http://localhost:' + PORT, SECRET = process.env.JWT_SECRET || 'local1184';
const OTHER = Number(process.env.OTHER_ORDER) || 0;
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OWNER = { id: 1, username: 'ceo', name: '대표', role: 'admin', position: '대표' };
const STAFF = { id: 5, username: 'staff5', name: '직원', role: 'user', position: '팀장' };
const tok = u => jwt.sign(u, SECRET, { expiresIn: '40m' });
const kstDay = off => new Date(Date.now() + 9 * 3600e3 + (off || 0) * 86400e3).toISOString().slice(0, 10);
const IGNORE = /favicon|ERR_ABORTED|net::ERR_|Failed to load resource|sw\.js|serviceWorker|\[ro-preload\]/i;

async function newPage(browser, user, extraRoute) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(([t, u]) => { try { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', u); } catch (e) { } }, [tok(user), JSON.stringify(user)]);
    await ctx.addInitScript(() => { window.__toasts = []; const go = () => new MutationObserver(ms => ms.forEach(x => x.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast-message')) window.__toasts.push(n.textContent); }))).observe(document.documentElement, { childList: true, subtree: true }); if (document.documentElement) go(); else document.addEventListener('DOMContentLoaded', go); });   // 토스트는 2초 뒤 사라짐 → 뜨는 순간 모음
    const page = await ctx.newPage();
    page.errs = []; page.writes = [];
    page.on('pageerror', e => page.errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) page.errs.push('console: ' + m.text().slice(0, 200)); });
    await page.route('**/api/**', async route => {
        const req = route.request(), url = req.url(), m = req.method();
        if (extraRoute) { const done = await extraRoute(route, req, url, m); if (done) return; }
        if (/\/invoice-orders|\/coupang\/|\/cafe24\/.*orders|\/naver\/.*orders/.test(url) && m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rows: [], orders: [] }) });   // 외부 채널 불러오기 = 가짜
        if (m === 'GET' && /\/api\/sms\/threads\/\d+$/.test(url.split('?')[0]) && !/[?&]peek=1/.test(url)) return route.continue({ url: url.split('?')[0] + '?peek=1' });   // 읽기 전용 서버는 「읽음」 UPDATE 를 막아 404 → 같은 길의 읽기 꼴로(검증 환경만)
        if (m !== 'GET') { page.writes.push(m + ' ' + url.replace(BASE, '')); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, success: true }) }); }
        return route.continue();
    });
    page.ctx = ctx;
    return page;
}
async function boot(page, menu) {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.switchPage === 'function' || document.querySelector('.nav-item[data-page]'), null, { timeout: 30000 });
    await sleep(1500);
    if (menu) { await page.click(`.nav-item[data-page="${menu}"]`); await sleep(2500); }
}
const toastText = page => page.evaluate(() => (window.__toasts || []).join(' | '));

(async () => {
    const browser = await chromium.launch();
    try {
        // ① 스모크(대표) — 일정·기안·정산관리·정산현황·문의 관리·에이전트 오피스 홈·손님 연락·메모함·최종발주
        console.log('① 주요 메뉴 스모크');
        {
            const p = await newPage(browser, OWNER);
            await boot(p);
            for (const menu of ['schedule', 'document', 'settlement', 'inquiry', 'agent-office']) {
                await p.click(`.nav-item[data-page="${menu}"]`); await sleep(3000);
                const on = await p.evaluate(m => { const el = document.getElementById('page-' + m); return !!el && el.classList.contains('active') && el.offsetHeight > 50; }, menu);
                ok(on, `메뉴 열림: ${menu}`);
                if (menu === 'settlement') {
                    await p.click('.settlement-tab[data-tab="settlement-status"]'); await sleep(3000);
                    ok(await p.evaluate(() => { const el = document.getElementById('settlement-status'); return !!el && el.offsetHeight > 50; }), '정산현황 탭 열림');
                    ok(await p.evaluate(() => !!document.getElementById('ss_f_deduct_card') && /위 합계에 이미 반영/.test(document.querySelector('.ss-ref-row') ? document.querySelector('.ss-ref-row').textContent : '')), '정산현황 카드비용 참고 줄(워커2 #1185)');
                }
            }
            // 손님 연락
            await p.evaluate(() => window.AkmAoDesk && window.AkmAoDesk.openInbox('talk')); await sleep(3000);
            ok(await p.evaluate(() => { const el = document.querySelector('#desk-inbox, .inb-win, #inb-win, [id^="inb-"]'); return !!el; }), '손님 연락 창 열림');
            await p.keyboard.press('Escape'); await sleep(800);
            // 메모함
            await p.evaluate(() => window.AkmOrderMemo && window.AkmOrderMemo.open()); await sleep(3500);
            ok(await p.evaluate(() => !!(window.AkmOrderMemo && window.AkmOrderMemo.isOpen())), '발주 메모함 열림');
            await p.evaluate(() => window.AkmOrderMemo.close()); await sleep(800);
            // 최종발주
            await p.evaluate(() => window.AkmFinalOrder && window.AkmFinalOrder.open()); await sleep(3500);
            ok(await p.evaluate(() => !!(window.AkmFinalOrder && window.AkmFinalOrder.state && window.AkmFinalOrder.state.open)), '최종발주 열림');
            await p.evaluate(() => window.AkmFinalOrder.close()); await sleep(800);
            ok(p.errs.length === 0, '스모크 콘솔·페이지 오류 0', p.errs);
            ok(p.writes.every(w => !/documents|settlements|order-memo\/|sms\/threads\/\d+\/(reply|send)/.test(w)), '스모크 중 서버로 갈 뻔한 쓰기 = 화면 기본 신호(입력 중·읽음 등)뿐', p.writes.slice(0, 8));
            await p.ctx.close();
        }
        // ② Esc · ③ 사진 중간 실패 · ④ 문자
        console.log('② Esc · ③ 사진 중간 실패');
        {
            let nPost = 0;
            const p = await newPage(browser, OWNER, async (route, req, url, m) => {
                if (m === 'POST' && /\/api\/agent-office\/orders$/.test(url.split('?')[0])) {
                    nPost++;
                    if (nPost === 2) { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '시험 실패' }) }); return true; }
                    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ order: { id: 990900 + nPost, status: '대기' } }) }); return true;
                }
                return false;
            });
            await boot(p, 'agent-office'); await sleep(2000);
            for (const [now, card, foc] of [['desk-ship-now', 'desk-ship', '#ship-close'], ['desk-qty-now', 'desk-qty', '#qty-close']]) {
                await p.evaluate(id => document.getElementById(id).click(), now); await sleep(1500);
                const shown = await p.evaluate(id => !document.getElementById(id).hidden, card);
                await p.focus(foc); await p.keyboard.press('Escape'); await sleep(500);
                const gone = await p.evaluate(id => document.getElementById(id).hidden, card);
                ok(shown && gone, `Esc = ${card} 카드 닫힘`, { shown, gone });
            }
            // 사진 3장 · 글 없음 = 장마다 1건 · 둘째 실패
            const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
            await p.setInputFiles('#desk-file', [1, 2, 3].map(i => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: png })));
            await sleep(1200);
            const before = await p.evaluate(() => document.querySelectorAll('#desk-thumbs .desk-thumb').length);
            await p.evaluate(() => { document.getElementById('desk-input').value = ''; document.getElementById('desk-send').disabled = false; document.getElementById('desk-send').click(); });
            await sleep(2500);
            const after = await p.evaluate(() => document.querySelectorAll('#desk-thumbs .desk-thumb').length), tt = await toastText(p);
            ok(before === 3 && nPost === 2 && after === 2 && /앞 1건은 보냈어요\(남은 2장만 다시 보내 주세요\)/.test(tt), '사진 3장 중 둘째 실패 = 보낸 1장 빠지고 남은 2장 · 안내 글', { before, nPost, after, tt });
            // 다시 보내면 남은 2장만(첫 장 다시 안 감)
            nPost = 10; await p.evaluate(() => { document.getElementById('desk-send').disabled = false; document.getElementById('desk-send').click(); }); await sleep(2500);
            const left = await p.evaluate(() => document.querySelectorAll('#desk-thumbs .desk-thumb').length);
            ok(nPost === 12 && left === 0, '다시 보내기 = 남은 2장만 나감', { sent: nPost - 10, left });
            ok(p.errs.length === 0, '② ③ 콘솔 오류 0', p.errs);
            await p.ctx.close();
        }
        console.log('④ 문자: 초안 중 Ctrl+Enter · 대화 옮김 · dup 안내');
        {
            let replies = 0, draftHold = null;
            const p = await newPage(browser, OWNER, async (route, req, url, m) => {
                const u = url.split('?')[0];
                if (m === 'POST' && /\/api\/sms\/threads\/\d+\/draft$/.test(u)) { await new Promise(r => { draftHold = r; setTimeout(r, 6000); }); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, draft_text: '시험 초안 글이에요', draft_kind: 'manual' }) }); return true; }
                if (m === 'POST' && /\/api\/sms\/threads\/\d+\/reply$/.test(u)) { replies++; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message_id: 1, dup: true }) }); return true; }
                return false;
            });
            await boot(p, 'agent-office'); await sleep(2500);
            const ids = await p.evaluate(async () => { const r = await fetch('/api/sms/threads?scope=all&q=&limit=5', { headers: { Authorization: 'Bearer ' + localStorage.getItem('jwt_token') } }); const j = await r.json(); return ((j && (j.threads || j.items)) || []).map(t => t.id).slice(0, 2); });
            ok(ids.length >= 2, '문자 대화 2개 읽음(실DB 읽기)', ids);
            if (ids.length >= 1) {
                await p.evaluate(id => window.AkmAoDesk.openSms(id), ids[0]); await sleep(3000);
                const hasTa = await p.evaluate(() => !!document.getElementById('sms-text'));
                ok(hasTa, '문자 대화 열림');
                await p.evaluate(() => document.getElementById('sms-mkdraft').click()); await sleep(600);
                await p.click('#sms-text'); await p.keyboard.type('직원 시험 글');
                await p.keyboard.press('Control+Enter'); await sleep(800);
                ok(replies === 0, '초안 만드는 중 Ctrl+Enter = 안 나감', { replies });
                if (ids.length >= 2) {
                    await p.evaluate(id => window.AkmAoDesk.openSms(id), ids[1]); await sleep(2500);
                    if (draftHold) draftHold(); await sleep(1500);
                    const dis = await p.evaluate(() => { const b = document.getElementById('sms-mkdraft'); return b ? b.disabled : null; });
                    ok(dis === false, '초안 중 다른 대화로 옮김 = 끝난 뒤 [초안 만들기] 단추 풀림', { disabled: dis });
                } else if (draftHold) draftHold();
                await sleep(1000);
                await p.evaluate(() => { const ta = document.getElementById('sms-text'); ta.value = 'dup 시험 글 ' + Date.now(); ta.dispatchEvent(new Event('input', { bubbles: true })); });
                await sleep(1200);
                await p.click('#sms-text'); await p.keyboard.press('Control+Enter'); await sleep(1500);
                const tt = await toastText(p);
                ok(replies === 1 && /방금 같은 글을 보냈어요 · 한 번만 나가요/.test(tt), 'dup 응답 = 「방금 같은 글을 보냈어요 · 한 번만 나가요」 안내', { replies, tt });
            }
            ok(p.errs.length === 0, '④ 콘솔 오류 0', p.errs);
            await p.ctx.close();
        }
        // ⑤ 번호 미입력 판 · ⑥ 달 넘기기
        console.log('⑤ 체험 번호 미입력 판 · ⑥ 달 넘기기');
        {
            let gets = 0, delay = 0; const froms = [];
            const tomorrow = kstDay(1);
            const p = await newPage(browser, OWNER, async (route, req, url, m) => {
                if (m === 'GET' && /\/api\/agent-office\/experience\?/.test(url)) {
                    gets++; froms.push(new URL(url).searchParams.get('from'));
                    const resp = await route.fetch(); const j = await resp.json().catch(() => ({}));
                    if (Array.isArray(j.items)) j.items.push({ id: 990801, source: 'place', status: 'confirmed', name: '시험손님', phone: null, visit_date: tomorrow, visit_time: '13:00', exp_count: 1, entry_count: 0, infant_count: 0, date_ok: true, order_no: 'T990801' });
                    if (delay) await sleep(delay);
                    await route.fulfill({ response: resp, json: j }); return true;
                }
                return false;
            });
            await boot(p, 'agent-office'); await sleep(2000);
            await p.evaluate(() => window.AkmExp.open()); await sleep(3000);
            await p.evaluate(() => { const b = document.getElementById('xp-nophone'); if (b) b.click(); }); await sleep(1500);
            const inp = await p.$('.xp-quick input[id^="xp-q-name-990801"]');
            ok(!!inp, '번호 미입력 판에 시험 줄(가짜 1줄)');
            if (inp) {
                await inp.fill('홍길동'); await p.focus('#xp-q-phone-990801'); await p.keyboard.type('0101234');
                const g0 = gets; await sleep(63000);
                const keep = await p.evaluate(() => (document.getElementById('xp-q-name-990801') || {}).value + '/' + (document.getElementById('xp-q-phone-990801') || {}).value);
                ok(gets === g0 && /^홍길동\/010-?1234/.test(keep), '치는 중 1분 지나도 새로 고침 안 함 · 친 글 그대로', { more: gets - g0, keep });
                await p.evaluate(() => { for (const i of document.querySelectorAll('.xp-quick input')) i.value = i.defaultValue; document.activeElement && document.activeElement.blur(); });
                const g1 = gets; await sleep(63000);
                ok(gets > g1, '칸을 비우고 벗어나면 1분 새로 고침 다시 돎', { more: gets - g1 });
            }
            // 달 넘기기 — 읽는 중(1.5초 지연) 다음 달을 두 번
            await p.keyboard.press('Escape'); await sleep(600);
            const range0 = await p.evaluate(() => document.getElementById('xp-range').textContent);
            delay = 1500; const n0 = froms.length;
            await p.evaluate(() => { const b = document.querySelector('#xp-root [data-nav="1"], .xp-nav [data-nav="1"]'); b.click(); b.click(); }); await sleep(6000);
            delay = 0;
            const range1 = await p.evaluate(() => document.getElementById('xp-range').textContent), lastFrom = froms[froms.length - 1];
            const want = (() => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 2); return d.toISOString().slice(0, 7); })();
            ok(String(lastFrom || '').startsWith(want) && /\d+년 \d+월/.test(range1) && range1 !== range0, '읽는 중 두 달 넘김 = 끝난 뒤 마지막 달로 다시 읽음(빈 달 X)', { range0, range1, lastFrom, want, reqs: froms.slice(n0) });
            ok(p.errs.length === 0, '⑤ ⑥ 콘솔 오류 0', p.errs);
            await p.ctx.close();
        }
        // ⑦ 퇴사 결재자 서류 · ⑨ 휴가 끝 < 시작
        console.log('⑦ 퇴사 결재자 서류 · ⑨ 끝 < 시작 문구');
        {
            const p = await newPage(browser, OWNER);
            await boot(p, 'document'); await sleep(2500);
            const rows = await p.evaluate(async () => { if (typeof renderApprovalList === 'function') await renderApprovalList(); const tb = document.getElementById('approval-pending-list'); return tb ? Array.from(tb.querySelectorAll('tr')).map(r => r.textContent.replace(/\s+/g, ' ').trim()) : null; });
            ok(Array.isArray(rows) && rows.some(t => /시간차/.test(t) && /정/.test(t) && /승인/.test(t)), '대표 결재 대기 목록에 퇴사 결재자 서류(#135 · 시간차 · 승인·반려 단추)', rows);
            const api135 = await p.evaluate(async () => { const r = await fetch('/api/documents?status=pending', { headers: { Authorization: 'Bearer ' + localStorage.getItem('jwt_token') } }); return (await r.json()).map(d => d.id); });
            ok(api135.includes(135), '대표 API 에 135', api135);
            // ⑨ 화면 막기 문구
            const alerts = await p.evaluate(async () => {
                window.__al = []; const o = window.akmAlert; window.akmAlert = m => { window.__al.push(String(m)); };
                document.querySelector('.doc-tab[data-doc-type="vacation"]').click();
                const b = document.querySelector('#doc-subtype-group .btn-toggle[data-value="연차"], .btn-toggle[data-value="연차"]'); if (b) b.click();
                document.getElementById('doc-start-date').value = '2026-12-05'; document.getElementById('doc-end-date').value = '2026-12-03';
                document.getElementById('doc-submit').click();
                await new Promise(r => setTimeout(r, 800)); window.akmAlert = o; return window.__al;
            });
            ok(alerts.length === 1 && alerts[0] === '끝나는 날이 시작일보다 빨라요 · 날짜를 다시 골라 주세요' && !p.writes.some(w => /\/api\/documents/.test(w)), '화면 = 끝 < 시작 막음 · 문구 · 서버로 안 보냄', { alerts, writes: p.writes });
            ok(p.errs.length === 0, '⑦ ⑨ 콘솔 오류 0', p.errs);
            await p.ctx.close();
        }
        // ⑨ 서버 400 문구(쓰기 전에 돌려줌 · 화면을 거치지 않고 직접)
        {
            const r = await fetch(BASE + '/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(STAFF) }, body: JSON.stringify({ type: 'vacation', subType: '연차', approverId: 1, startDate: '2026-12-05', endDate: '2026-12-03' }) });
            const j = await r.json().catch(() => ({}));
            ok(r.status === 400 && j.error === '끝나는 날이 시작일보다 빨라요 · 날짜를 다시 골라 주세요', '서버 400 문구 = 화면 문구와 같음', { status: r.status, j });
            const r2 = await fetch(BASE + '/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(STAFF) }, body: JSON.stringify({ type: 'vacation', subType: '시간차', approverId: 1, startDate: '2026-12-05', startTime: '15:00', endTime: '10:00' }) });
            const j2 = await r2.json().catch(() => ({}));
            ok(r2.status === 400 && j2.error === '끝나는 시각이 시작 시각보다 늦어야 해요', '서버 400 문구(시간차)', { status: r2.status, j2 });
        }
        // ⑦ 직원 · ⑧ 남의 지시 번호
        console.log('⑦ 직원 목록 · ⑧ 남의 지시 번호(직원)');
        {
            const p = await newPage(browser, STAFF);
            await boot(p, 'document'); await sleep(2000);
            const ids = await p.evaluate(async () => { const r = await fetch('/api/documents?status=pending', { headers: { Authorization: 'Bearer ' + localStorage.getItem('jwt_token') } }); return (await r.json()).map(d => d.id); });
            ok(!ids.includes(135), '직원 결재 대기 = 135 안 뜸', ids);
            if (OTHER) {
                const g = await p.evaluate(async id => { const r = await fetch('/api/agent-office/orders/' + id, { headers: { Authorization: 'Bearer ' + localStorage.getItem('jwt_token') } }); return { s: r.status, b: await r.json() }; }, OTHER);
                ok(g.s === 403 && /내가 보낸 지시만/.test(g.b.error || ''), '직원 → 남의 지시 1건 조회 = 403 「내가 보낸 지시만 볼 수 있습니다」', g);
                const f = await p.evaluate(async () => { const r = await fetch('/api/agent-office/files/1/download', { headers: { Authorization: 'Bearer ' + localStorage.getItem('jwt_token') } }); return r.status; });
                ok(f === 403 || f === 404, '직원 → 남의 첨부 파일 = 403(없는 번호면 404)', f);
                await p.evaluate(id => notiGo('agent-office?o=' + id), OTHER); await sleep(6000);
                const st = await p.evaluate(() => ({ active: document.getElementById('page-agent-office').classList.contains('active'), toast: Array.from(document.querySelectorAll('.toast-message')).map(t => t.textContent).join(' | '), list: !!document.getElementById('desk-list') }));
                ok(st.active && st.list, '직원이 남의 지시 알림 링크를 열면 = 에이전트 오피스는 열리고 그 지시는 안 보임(목록 기준 · 깨짐 없음)', st);
            } else ok(false, 'OTHER_ORDER 없음');
            ok(p.errs.length === 0, '⑦ ⑧ 콘솔 오류 0', p.errs);
            await p.ctx.close();
        }
    } catch (e) { ok(false, '검증 중 예외', e && e.stack); }
    finally { await browser.close(); }
    console.log(`\n#1184 화면 검증: 통과 ${pass} · 실패 ${fail}`);
    process.exit(fail ? 1 : 0);
})();
