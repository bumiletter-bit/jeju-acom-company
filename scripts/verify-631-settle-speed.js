// #631 정산관리 달력 입금 체크 버퍼링(대표 10/11) — 체크 한 번에 나가는 요청 수·겹침·걸린 시간 + api() GET 겹침 제거·쓰기 뒤 무효화 + 무회귀(달력·목록·주간·날짜 창 그대로)
//   로컬 서버(포트 PORT631 · 없으면 3466 · 스케줄러 막음 · 실DB 읽기) · 쓰기 요청(PUT/POST/DELETE)은 전부 가로채 가짜 응답 → DB 쓰기 0
//   실행: node scripts/verify-631-settle-speed.js
const { spawn } = require('child_process'); const path = require('path'); const jwt = require('jsonwebtoken'); const { chromium } = require('playwright');
const PORT = Number(process.env.PORT631 || 3466), ROOT = path.join(__dirname, '..'), SECRET = 'verifytest', BASE = 'http://localhost:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + d : '')); };
(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
    let br;
    try {
        let up = false; for (let i = 0; i < 90; i++) { await sleep(1000); try { const r = await fetch(BASE + '/track-order'); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('로컬 서버가 안 떴어요');
        const user = { id: 1, username: 'o', name: '전승범', position: '대표', role: 'admin' };
        const token = jwt.sign(user, SECRET, { expiresIn: '20m' });
        br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
        const writes = [], reqs = [];
        await ctx.route('**/api/**', r => {
            const q = r.request(), m = q.method(), u = new URL(q.url()).pathname + (new URL(q.url()).search || '');
            if (m !== 'GET') { writes.push(m + ' ' + u); if (/toggle-paid/.test(u)) return r.fulfill({ json: { ok: true, id: 1, isPaid: true, paid: true } }); return r.fulfill({ json: { ok: true } }); }
            reqs.push({ u, t: Date.now() }); r.continue();
        });
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e.message || e)));
        await pg.goto(BASE + '/'); await pg.evaluate(a => { localStorage.setItem('jwt_token', a.t); localStorage.setItem('jwt_user', JSON.stringify(a.u)); }, { t: token, u: user });
        await pg.goto(BASE + '/'); await pg.waitForSelector('.nav-item[data-page="settlement"]', { timeout: 30000 });
        const cnt = from => reqs.slice(from).filter(r => r.u.indexOf('/api/prepayments') === 0).length;   // 배경 폴링(알림 등)은 빼고 그 주소만 센다
        const idle = async (ms = 1200) => { let last = reqs.length, quiet = 0; for (let i = 0; i < 60; i++) { await sleep(200); if (reqs.length === last) { quiet += 200; if (quiet >= ms) return; } else { last = reqs.length; quiet = 0; } } };

        console.log('① api() 겹침 제거 · 쓰기 뒤 무효화(단위)');
        {
            const n0 = reqs.length;
            const r1 = await pg.evaluate(async () => { const a = api('/api/prepayments'), b = api('/api/prepayments'); const [x, y] = await Promise.all([a, b]); return { same: true, eq: JSON.stringify(x) === JSON.stringify(y) }; });
            await idle(600);
            ok(r1.eq && cnt(n0) === 1, '같은 GET 둘을 동시에 → 요청 1번 · 같은 답', JSON.stringify({ r1, n: cnt(n0) }));
            const n1 = reqs.length;
            await pg.evaluate(async () => { await api('/api/prepayments'); await api('/api/settlements/999999/toggle-paid', 'PUT'); await api('/api/prepayments'); });
            await idle(600);
            ok(cnt(n1) === 1 && writes.some(w => /PUT .*999999\/toggle-paid/.test(w)), '쓰기(PUT) 뒤의 같은 GET 은 다시 청함(옛 답 안 씀) · 1.2초 안 재사용은 1번', JSON.stringify({ n: cnt(n1) }));
            const n2 = reqs.length;
            await pg.evaluate(async () => { await new Promise(r => setTimeout(r, 1400)); await api('/api/prepayments'); await new Promise(r => setTimeout(r, 1400)); await api('/api/prepayments'); });
            await idle(600);
            ok(cnt(n2) === 2, '1.2초가 지나면 다시 청함', String(cnt(n2)));
            const r4 = await pg.evaluate(async () => { try { await api('/api/no-such-route-631'); return 'no-throw'; } catch (e) { try { await api('/api/no-such-route-631'); return 'no-throw2'; } catch (e2) { return 'threw'; } } });
            ok(r4 === 'threw', '실패한 요청은 나누지 않고 둘 다 오류를 던짐', r4);
        }

        console.log('② 정산관리 — 처음 그리기');
        reqs.length = 0;
        await pg.click('.nav-item[data-page="settlement"]'); await pg.waitForSelector('td[onclick*="showSettlementDayModal"]', { timeout: 40000 }); await idle(1500);
        const first = await pg.evaluate(() => ({ title: document.getElementById('settlement-calendar-title').textContent, cells: document.querySelectorAll('td[onclick^="showSettlementDayModal"]').length, list: document.querySelectorAll('#settlement-list tr').length, weekly: !!document.getElementById('weekly-settlement-list'), expected: document.getElementById('expected-payment').textContent }));
        const dup0 = reqs.map(r => r.u).filter((u, i, a) => a.indexOf(u) !== i);
        ok(first.cells >= 28 && first.weekly && /원/.test(first.expected), '달력 칸 ' + first.cells + ' · 주간 표 · 총 결제예정금액 글(' + first.expected + ')', JSON.stringify(first));
        ok(dup0.length === 0, '처음 그리기에 같은 GET 중복 0(요청 ' + reqs.length + '개)', dup0.join(','));
        ok(errs.length === 0, '화면 오류 0', errs.join(' | '));

        // 체크할 날짜 = 이 달 자료 중 첫 줄(없으면 지난달로 이동)
        let day = await pg.evaluate(async () => { const t = document.getElementById('settlement-calendar-title').textContent.match(/(\d{4})년 (\d{1,2})월/); const ms = t[1] + '-' + String(t[2]).padStart(2, '0'); const rows = await api('/api/settlements?month=' + ms); return rows.length ? String(rows[0].date).slice(0, 10) : null; });
        if (!day) { await pg.click('#settlement-cal-prev, [onclick*="prevSettlementMonth"], .settlement-cal-prev'); await idle(1500); day = await pg.evaluate(async () => { const t = document.getElementById('settlement-calendar-title').textContent.match(/(\d{4})년 (\d{1,2})월/); const ms = t[1] + '-' + String(t[2]).padStart(2, '0'); const rows = await api('/api/settlements?month=' + ms); return rows.length ? String(rows[0].date).slice(0, 10) : null; }); }
        ok(!!day, '체크할 정산 날짜 찾음 ' + day);

        console.log('③ 날짜 창 열고 입금 체크 — 요청 수·겹침·시간');
        await pg.evaluate(d => showSettlementDayModal(d), day); await sleep(300);
        const m0 = await pg.evaluate(() => { const m = document.getElementById('settlement-day-modal'); return m ? { date: m.dataset.date, btns: m.querySelectorAll('button[onclick^="toggleSettlementPaid"]').length, cj: m.querySelectorAll('button[onclick^="toggleCjDailyPaid"]').length } : null; });
        ok(!!m0 && m0.date === day && m0.btns >= 1, '날짜 창 열림 · 체크 단추 ' + (m0 && m0.btns) + '개', JSON.stringify(m0));
        reqs.length = 0; const w0 = writes.length; const t0 = Date.now();
        await pg.click('#settlement-day-modal button[onclick^="toggleSettlementPaid"]');
        await pg.waitForFunction(() => { const m = document.getElementById('settlement-day-modal'); return m && m.dataset.rerendered !== '1' && m.isConnected; }, null, { timeout: 15000 }).catch(() => { });
        await idle(1200); const burstMs = Date.now() - t0;
        const urls = reqs.map(r => r.u), dups = urls.filter((u, i, a) => a.indexOf(u) !== i);
        const span = reqs.length ? reqs[reqs.length - 1].t - reqs[0].t : 0;
        const m1 = await pg.evaluate(() => { const m = document.getElementById('settlement-day-modal'); return { open: !!m, date: m && m.dataset.date, cells: document.querySelectorAll('td[onclick^="showSettlementDayModal"]').length, expected: document.getElementById('expected-payment').textContent, weeklyRows: document.querySelectorAll('#weekly-settlement-list tr').length }; });
        ok(writes.length - w0 === 1 && /PUT .*toggle-paid/.test(writes[writes.length - 1]), '체크 → PUT 1번(가짜 응답 · DB 쓰기 0)', writes.slice(w0).join(','));
        ok(dups.length === 0, '#631 체크 뒤 다시 읽기에 같은 GET 중복 0(요청 ' + urls.length + '개)', dups.join(','));
        ok(urls.length <= 9, '#631 요청 수 9개 이하(종전 13개쯤 · 달력 5 + 목록 1 + 주간의 지난달·다음달 2 + CJ 2)', urls.join(' , '));
        ok(span <= 800, '#631 요청들이 거의 동시에 나감(첫 요청 → 마지막 요청 시작 ' + span + 'ms · 종전은 차례로)', String(span));
        ok(m1.open && m1.date === day && m1.cells >= 28 && /원/.test(m1.expected), '무회귀: 날짜 창은 같은 날짜로 유지 · 달력·합계 다시 그려짐', JSON.stringify(m1));
        console.log('    (체크 → 화면 안정까지 ' + (burstMs - 1200) + 'ms쯤 · 로컬 서버 → 실DB 기준)');
        ok(errs.length === 0, '화면 오류 0', errs.join(' | '));
        await ctx.close();
    } catch (e) { fail++; console.log('  ✗ 중단: ' + e.message); }
    finally { if (br) await br.close().catch(() => { }); srv.kill(); }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
