// #945 검증 — 연차 조정 알림 · 내 정보 연차 칸 · 0.125 단위
//   🔴 실DB 쓰기 0: ① 라우트 = server.js 그 구간을 떼어 메모리 pglite 로 ② 화면 = 진짜 server.js + ro-preload(쓰기 삼킴 · 타이머 0) + API 전부 가로챔
//   실행: PGLITE_DIR=<pglite 폴더> node scripts/verify-945-leave-adj.js   (PORT945 · 기본 3469)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), PORT = Number(process.env.PORT945) || 3469;
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 400))); };
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite')), express = require(path.join(ROOT, 'node_modules', 'express'));
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('구간 못 찾음 ' + a); return src.slice(i, j); };
(async () => {
    console.log('① 라우트(메모리 DB)');
    const db = new PGlite(), q = async (s, p = []) => { const r = await db.query(s, p); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; }, pool = { query: q };
    await db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, annual_leave NUMERIC DEFAULT 15);
        CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INTEGER, type TEXT, title TEXT, message TEXT, link TEXT, created_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE documents (id SERIAL PRIMARY KEY, applicant_id INTEGER, type TEXT, sub_type TEXT, status TEXT, deducted_leave NUMERIC, reason TEXT, start_date DATE);
        CREATE TABLE leave_adjustments (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), adjustment DECIMAL(5,2) NOT NULL, reason VARCHAR(200) NOT NULL, adjusted_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW());
        INSERT INTO users VALUES (1,'대표',15),(7,'직원',10),(8,'다른직원',5);
        INSERT INTO leave_adjustments (user_id, adjustment, reason, adjusted_by) VALUES (7, 0.50, '옛 줄', 1);`);
    const alter = (src.match(/ALTER TABLE leave_adjustments ALTER COLUMN adjustment TYPE DECIMAL\(6,3\)/) || [''])[0]; ok(!!alter, 'initDB 에 칸 넓히기 문장'); await db.query(alter); await db.query(alter);
    ok((await q('select adjustment from leave_adjustments')).rows[0].adjustment.startsWith('0.5'), '칸 넓힌 뒤 옛 줄 값 그대로 · 두 번 돌려도 오류 0');
    const createNotification = new Function('pool', 'console', cut('async function createNotification(', "app.get('/api/notifications'") + '\nreturn createNotification;')(pool, { error() {} });
    const app = express(); app.use(express.json()); let me = { id: 1, name: '대표', role: 'admin' }; const auth = (r, s, n) => { r.user = me; n(); };
    new Function('app', 'pool', 'authMiddleware', 'adminOnly', 'createNotification', 'console', cut('// #945 내 연차 조정 내역', '// 연차 조정 내역') + cut('// 연차 조정 삭제/취소', "console.error('DELETE /api/leave-adjustments error:'") + "console.error('x', err); res.status(500).json({ error: err.message }); } });")(app, pool, auth, auth, createNotification, { error() {} });
    const srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, '127.0.0.1', () => r(s)); });
    const call = async (m, u, b) => { const r = await fetch(`http://127.0.0.1:${PORT}${u}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
    const notes = async () => (await q('select * from notifications order by id')).rows;
    let r = await call('POST', '/api/leave-adjustments', { user_id: 7, adjustment: 0.5, reason: '대체근무로 일수추가' }); let n = await notes();
    ok(r.s === 200 && n.length === 1 && n[0].user_id === 7 && n[0].type === 'leave_adj' && n[0].link === 'myinfo?leave=1', '추가 = 대상자에게 알림 1건 · 종류·링크', n);
    ok(n[0].title === '연차가 추가됐어요' && n[0].message === '연차 0.5일이 추가됐어요 · 사유: 대체근무로 일수추가 · 남은 연차 10.5일', '알림 글 = 소수 그대로 · 사유 · 남은 연차', n[0].message);
    r = await call('POST', '/api/leave-adjustments', { user_id: 7, adjustment: -0.375, reason: '3시간 차감' }); n = await notes();
    ok(n[1].title === '연차가 차감됐어요' && n[1].message === '연차 0.375일이 차감됐어요 · 사유: 3시간 차감 · 남은 연차 10.125일', '차감 · 0.375 그대로 · 남은 연차', n[1].message);
    const row = (await q('select adjustment from leave_adjustments where reason=$1', ['3시간 차감'])).rows[0].adjustment, u7 = (await q('select annual_leave from users where id=7')).rows[0].annual_leave; ok(Number(row) === -0.375 && Number(u7) === 10.125, '이력 칸 = -0.375(반올림 없음) · 잔여연차 일치', [row, u7]);
    me = { id: 7, name: '직원', role: 'admin' }; r = await call('POST', '/api/leave-adjustments', { user_id: 7, adjustment: 1, reason: '본인' }); n = await notes(); ok(r.s === 200 && n.length === 2, '조정한 사람 본인 = 알림 안 받음', n.length);
    r = await call('POST', '/api/leave-adjustments', { user_id: 7, adjustment: 0, reason: 'x' }); ok(r.s === 400 && (await notes()).length === 2, '0 = 400 · 알림 없음', r.s);
    r = await call('POST', '/api/leave-adjustments', { user_id: 7, adjustment: 0.0001, reason: 'x' }); ok(r.s === 400, '반올림해 0 이 되는 값 = 400', r.s);
    { const c0 = (await q('select count(*)::int n from leave_adjustments')).rows[0].n; r = await call('POST', '/api/leave-adjustments', { user_id: 7, adjustment: 0.1, reason: 'x' }); ok(r.s === 400 && r.j.error === '0.125 단위로 넣어 주세요' && (await q('select count(*)::int n from leave_adjustments')).rows[0].n === c0 && (await notes()).length === 2, 'API 직접 0.1 = 400 · 저장·알림 없음', r.s); }
    me = { id: 1, name: '대표', role: 'admin' }; { const add = await call('POST', '/api/leave-adjustments', { user_id: 8, adjustment: 0.375, reason: '취소할 줄' }), before = (await notes()).length; r = await call('DELETE', '/api/leave-adjustments/' + add.j.id); n = await notes(); const c = n[n.length - 1];
      ok(r.s === 200 && n.length === before + 1 && c.user_id === 8 && c.type === 'leave_adj' && c.link === 'myinfo?leave=1' && c.title === '연차 조정이 취소됐어요' && c.message === '연차 조정 0.375일이 취소됐어요 · 사유: 취소할 줄 · 남은 연차 5일', '조정 취소 = 대상자 알림 · 잔여연차 원복(소수 남음 0)', c);
      const self = await call('POST', '/api/leave-adjustments', { user_id: 1, adjustment: 1, reason: '본인 줄' }), n0 = (await notes()).length; r = await call('DELETE', '/api/leave-adjustments/' + self.j.id); ok(r.s === 200 && (await notes()).length === n0, '본인 줄 취소 = 알림 안 받음', r.s);
      r = await call('DELETE', '/api/leave-adjustments/99999'); ok(r.s === 404, '없는 줄 취소 = 404 · 종전', r.s); }
    await q(`INSERT INTO documents (applicant_id, type, sub_type, status, deducted_leave, reason, start_date) VALUES (7,'vacation','대체근무','approved',-1,'수기','2026-01-01'), (7,'vacation','연차','approved',1,'일반 휴가','2026-12-01'), (8,'vacation','','approved',-2,'다른 직원','2026-12-01')`);
    await q(`INSERT INTO leave_adjustments (user_id, adjustment, reason, adjusted_by) VALUES (8, 3, '다른 직원 조정', 1)`);
    me = { id: 7, name: '직원', role: 'staff' }; r = await call('GET', '/api/leave-adjustments/mine');
    ok(r.s === 200 && r.j.items.length === 3 && !r.j.items.some(x => /다른 직원|일반 휴가/.test(x.reason)), '내 내역 = 본인 것만 · 3줄 · 일반 휴가 제외', r.j); ok(r.j.annualLeave === 11.125, '잔여연차', r.j.annualLeave);
    me = { id: 8, name: '다른직원', role: 'staff' }; r = await call('GET', '/api/leave-adjustments/mine'); ok(r.j.items.some(x => x.reason === '다른 직원' && x.adjustment === 2) && r.j.items.some(x => x.reason === '다른 직원 조정'), '수기 이력 추가일수 = 양수로 포함', r.j);
    await new Promise(x => srv.close(x));

    console.log('② 화면(진짜 server.js · 쓰기 삼킴 · API 가로챔)');
    const child = spawn(process.execPath, ['-r', './scripts/ro-preload-711.js', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'local945', LUCKY_TABLE: 'lucky_events_v945', RENDER: '' }, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
    const base = `http://127.0.0.1:${PORT}`; let up = false; for (let i = 0; i < 80 && !up; i++) { await new Promise(x => setTimeout(x, 500)); try { up = (await fetch(base + '/api/public/version')).status === 200; } catch (e) { /* 기다림 */ } }
    ok(up, 'server.js 기동(장착 변경 · TDZ 없음)', log.slice(-400));
    const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright')), jwt = require(path.join(ROOT, 'node_modules', 'jsonwebtoken')), br = await chromium.launch();
    try {
        for (const [w, h, mob] of [[390, 844, true], [1280, 900, false]]) {
            const U = { id: 990945, username: 't945', name: '시험', role: 'admin', position: '대표', color: '#3b82f6', annualLeave: 10 }, posts = [], errs = [], ctx = await br.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', reducedMotion: 'reduce', ...(mob ? { isMobile: true, hasTouch: true } : {}) }), pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
            const NOTE = { id: 5, type: 'leave_adj', title: '연차가 추가됐어요', message: '연차 0.5일이 추가됐어요 · 사유: 대체근무 · 남은 연차 10.5일', link: 'myinfo?leave=1', isRead: false, createdAt: new Date().toISOString() };
            await pg.route('**/api/**', r => { const q = r.request(), p = new URL(q.url()).pathname, m = q.method();
                if (p === '/api/auth/me') return r.fulfill({ json: U });
                if (p === '/api/leave-adjustments/mine') return r.fulfill({ json: { annualLeave: 10.875, items: [{ at: '2026-11-01T01:00:00Z', adjustment: 0.5, reason: '대체근무<b>' }, { at: '2026-10-01T01:00:00Z', adjustment: -0.375, reason: '3시간 차감' }] } });
                if (p === '/api/notifications' && m === 'GET') return r.fulfill({ json: [NOTE] });
                if (p === '/api/leave-adjustments' && m === 'POST') { posts.push(q.postDataJSON()); return r.fulfill({ json: { success: true, id: 9 } }); }
                if (p === '/api/leave-adjustments' && m === 'GET') return r.fulfill({ json: [] });
                if (p === '/api/users') return r.fulfill({ json: [{ id: 7, name: '직원', position: '사원', annualLeave: 10, role: 'staff' }] });
                if (m !== 'GET') return r.fulfill({ json: { ok: true } });
                return r.fulfill({ json: [] }); });
            await pg.goto(base + '/', { waitUntil: 'domcontentloaded' }); await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [jwt.sign(U, 'local945'), U]); await pg.reload({ waitUntil: 'load' }); await pg.waitForFunction(() => typeof window.notiGo === 'function'); await pg.waitForTimeout(700);
            await pg.evaluate(() => window.notiGo('myinfo?leave=1')); await pg.waitForTimeout(800);
            let s = await pg.evaluate(() => { const c = document.getElementById('myinfo-leave'); return { vis: !!c && c.offsetParent !== null, left: document.getElementById('myinfo-leave-left').textContent, lis: [...document.querySelectorAll('#myinfo-leave-adj li')].map(l => l.textContent.trim()), html: document.getElementById('myinfo-leave-adj').innerHTML, tab: (document.querySelector('#myinfo-tabs .ps-tab.active') || {}).textContent, sw: document.documentElement.scrollWidth, iw: innerWidth, top: c ? c.getBoundingClientRect().top : -1, ih: innerHeight }; });
            ok(s.vis && s.tab === '내 정보', `[${w}] 알림 링크 = 내 정보 탭 · 연차 칸`, s); ok(s.left === '10일 7시간', `[${w}] 잔여연차 표시`, s.left); ok(s.lis.length === 2 && /\+0\.5일/.test(s.lis[0]) && /-0\.375일/.test(s.lis[1]) && !/<b>/.test(s.html.replace(/<b class="[pm]">/g, '')), `[${w}] 최근 내역 2줄 · 소수 그대로 · 사유 글자 그대로(태그 안 됨)`, s.lis); ok(s.sw <= s.iw, `[${w}] 가로 넘침 0`, s);
            await pg.evaluate(() => window.openLeaveAdjModal()); await pg.waitForTimeout(300);
            const f = await pg.evaluate(() => { const i = document.getElementById('adj-days'); return { step: i.step, min: i.min, note: i.parentElement.parentElement.querySelector('small').textContent, opts: document.getElementById('adj-employee').options.length }; }); ok(f.step === '0.125' && f.min === '0.125' && /3시간 = 0\.375/.test(f.note), `[${w}] 입력 칸 0.125 · 안내 글`, f);
            await pg.evaluate(() => { document.getElementById('adj-days').value = '0.375'; document.getElementById('adj-reason').value = '3시간'; const s = document.getElementById('adj-employee'); s.value = s.options[s.options.length - 1].value; window.saveLeaveAdj(); }); await pg.waitForTimeout(300);
            ok(posts.length === 1 && posts[0].adjustment === 0.375, `[${w}] 0.375 저장 요청`, posts);
            await pg.evaluate(() => { window.openLeaveAdjModal(); }); await pg.waitForTimeout(200); await pg.evaluate(() => { document.getElementById('adj-days').value = '0.3'; document.getElementById('adj-reason').value = '틀림'; const s = document.getElementById('adj-employee'); s.value = s.options[s.options.length - 1].value; window.saveLeaveAdj(); }); await pg.waitForTimeout(200); ok(posts.length === 1, `[${w}] 0.3(단위 밖) = 저장 안 함`, posts);
            ok(!errs.length, `[${w}] 스크립트 오류 0`, errs); await ctx.close();
        }
    } finally { await br.close(); child.kill(); }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
