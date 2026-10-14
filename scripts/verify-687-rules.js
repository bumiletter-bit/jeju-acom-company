// #687 회사 규정 검증 — ① 서버 라우트(로컬 실서버 · 실DB · 시험 번호 계정 ≥ 990000 · 가짜 PDF) ② 알림(모듈 따로 장착 · 가짜 알림 함수) ③ 화면(Playwright 실클릭 · 올리기 POST 는 가로챔)
//   실행: node scripts/verify-687-rules.js   (포트 3465 · PORT687 로 바꿈 · JWT_SECRET=local687 · setInterval 차단)
//   실DB 에 남기는 것: 시험 계정이 올린 company_rules 줄(uploaded_by ≥ 990000 · 실제 직원에게는 안 보임) — 끝에 지운다. audit_logs 는 FK 로 시험 계정 줄이 안 들어간다.
require('dotenv').config();
const path = require('path'), { spawn } = require('child_process'); const jwt = require('jsonwebtoken'); const { Pool } = require('pg');
const PORT = Number(process.env.PORT687) || 3465, BASE = 'http://localhost:' + PORT, ROOT = path.join(__dirname, '..'), SECRET = 'local687';
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d == null ? '' : ' — ' + String(d).slice(0, 400))); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const U = { admin: { id: 990687, username: 't687a', name: '시험경리', role: 'admin', position: '과장' }, owner: { id: 990688, username: 't687o', name: '시험대표', role: 'admin', position: '대표' },
    a: { id: 990689, username: 't687s', name: '시험직원', role: 'user', position: '사원' }, pc: { id: 990690, username: 't687pc', name: '시험발주컴퓨터', role: 'user', position: '직원' }, tax: { id: 990691, username: 't687t', name: '시험세무사', role: 'accountant', position: '세무사' } };
const tok = u => jwt.sign(u, SECRET, { expiresIn: '1h' });
const PDF = tag => Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\n% ' + tag + '\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const call = async (u, url, method, body) => { const r = await fetch(BASE + url, { method: method || 'GET', headers: Object.assign({ Authorization: 'Bearer ' + tok(u) }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const ct = r.headers.get('content-type') || ''; if (/pdf/.test(ct)) return { status: r.status, ct, cd: r.headers.get('content-disposition') || '', cc: r.headers.get('cache-control') || '', buf: Buffer.from(await r.arrayBuffer()) }; let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, body: j || {} }; };
const up = (u, o) => call(u, '/api/rules', 'POST', Object.assign({ title: '급여규정', version: '2025 제정', effective_date: '2025-01-01', name: '급여규정_2025.pdf', data: PDF('pay1').toString('base64'), notify: false }, o));

(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
    const clean = async () => { try { await pool.query(`DELETE FROM company_rules WHERE uploaded_by >= 990000`); } catch (e) { /* 표가 아직 없으면 지울 것도 없다 */ } };
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'ignore'] });
    let br, code = 1;
    try {
        let upOk = false; for (let i = 0; i < 60 && !upOk; i++) { await sleep(1000); try { upOk = (await fetch(BASE + '/api/rules', { headers: { Authorization: 'Bearer ' + tok(U.a) } })).status === 200; } catch (_) { } }
        if (!upOk) throw new Error('서버가 안 떴거나 /api/rules 가 200 이 아님');
        await clean();

        console.log('① 서버 — 권한·올리기·목록·보기·내려받기·지우기');
        ok((await call(U.a, '/api/rules')).body.items.length === 0, '처음: 시험 계정 목록 0건');
        ok((await fetch(BASE + '/api/rules')).status === 401, '토큰 없이 → 401');
        ok((await up(U.a)).status === 403 && (await up(U.pc)).status === 403, '직원·발주컴퓨터 계정 올리기 → 403');
        const bads = [[{ data: Buffer.from('hello, not a pdf').toString('base64') }, /PDF 파일만/], [{ title: '' }, /제목/], [{ effective_date: '2026/1/1' }, /시행일/], [{ data: '' }, /파일이 없어요/], [{ data: Buffer.alloc(5 * 1024 * 1024 + 10, 0x25).toString('base64') }, /너무 커요/]];
        let badOk = 0; for (const [o, re] of bads) { const r = await up(U.admin, o); if (r.status === 400 && re.test(r.body.error)) badOk++; else console.log('     어긋남', JSON.stringify(o).slice(0, 50), r.status, r.body && r.body.error); }
        ok(badOk === bads.length, `잘못된 올리기 ${bads.length}종 → 400 + 사람 말 안내(PDF 아님 · 제목 없음 · 시행일 꼴 · 빈 파일 · 5MB 초과)`, badOk);
        const u1 = await up(U.admin); ok(u1.status === 200 && u1.body.ok && u1.body.id > 0 && u1.body.prev_versions === 0 && u1.body.notified === 0, '관리자 올리기(급여규정 2025) → 200 · id · 첫 판 · notify:false 면 알림 0', JSON.stringify(u1.body));
        await sleep(30);
        const u2 = await up(U.admin, { version: '2026 개정안', effective_date: '2026-11-01', name: '급여규정_2026.pdf', data: 'data:application/pdf;base64,' + PDF('pay2').toString('base64') }); ok(u2.status === 200 && u2.body.prev_versions === 1, '같은 제목 다시(2026 개정안 · data: 머리말 붙여도) → 새 판 · 옛 판 1', JSON.stringify(u2.body));
        const u3 = await up(U.owner, { title: '인사규정', version: '', effective_date: null, name: '인사규정.pdf', data: PDF('hr').toString('base64') }); ok(u3.status === 200 && u3.body.prev_versions === 0, '대표가 인사규정(개정판·시행일 없이) → 200');
        const L = (await call(U.a, '/api/rules')).body.items;
        ok(L.length === 3 && L[0].title === '급여규정' && L[0].id === u2.body.id && L[0].version === '2026 개정안' && L[0].effective_date === '2026-11-01' && L[1].id === u1.body.id && L[2].title === '인사규정' && L[2].version === '' && L[2].effective_date === null && L.every(x => !('data' in x) && x.size > 0 && x.created_at && x.file_name), '직원 목록: 제목순 · 같은 제목은 최신 판 먼저 · 바이트 없음 · 개정판·시행일·올린 날·크기', JSON.stringify(L.map(x => [x.title, x.version, x.effective_date])));
        ok((await call(U.pc, '/api/rules')).body.items.length === 3 && (await call(U.tax, '/api/rules')).body.items.length === 3, '발주컴퓨터(user)·세무사 토큰도 목록 200(세무사는 화면에 내 정보 메뉴가 없어 자연 제외)');
        const f1 = await call(U.a, '/api/rules/' + u2.body.id + '/file'); ok(f1.status === 200 && /application\/pdf/.test(f1.ct) && /^inline;/.test(f1.cd) && /no-store/.test(f1.cc) && f1.buf.equals(PDF('pay2')) && /2026%20%EA%B0%9C%EC%A0%95%EC%95%88/.test(f1.cd), '직원 [보기] → PDF 바이트 그대로 · inline · 캐시 금지 · 파일 이름에 제목·개정판', f1.cd);
        const f2 = await call(U.pc, '/api/rules/' + u1.body.id + '/file?dl=1'); ok(f2.status === 200 && /^attachment;/.test(f2.cd) && f2.buf.equals(PDF('pay1')), '발주컴퓨터 [내려받기](?dl=1) → attachment · 옛 판도 열림');
        ok((await call(U.a, '/api/rules/999999999/file')).status === 404 && (await call(U.a, '/api/rules/abc/file')).status === 400, '없는 번호 404 · 글자 번호 400');
        ok((await call(U.a, '/api/rules/' + u3.body.id, 'DELETE')).status === 403, '직원 지우기 → 403');
        const del = await call(U.admin, '/api/rules/' + u3.body.id, 'DELETE'); const L2 = (await call(U.a, '/api/rules')).body.items;
        ok(del.status === 200 && L2.length === 2 && !L2.some(x => x.id === u3.body.id) && (await call(U.a, '/api/rules/' + u3.body.id + '/file')).status === 404 && (await call(U.admin, '/api/rules/' + u3.body.id, 'DELETE')).status === 404, '관리자(경리) 지우기 → 목록·파일에서 빠짐(soft) · 두 번째는 404');
        const dbRow = (await pool.query(`SELECT deleted_at IS NOT NULL AS gone, deleted_by, length(data) AS len FROM company_rules WHERE id = $1`, [u3.body.id])).rows[0]; ok(dbRow && dbRow.gone && dbRow.deleted_by === U.admin.id && dbRow.len === PDF('hr').length, '지운 줄은 DB 에 남음(deleted_at·deleted_by · 파일 그대로)');
        const real = (await pool.query(`SELECT id FROM users WHERE deleted_at IS NULL AND id < 990000 ORDER BY id LIMIT 1`)).rows[0];
        if (real) { const rl = await call({ id: real.id, username: 'x', name: 'x', role: 'user', position: '' }, '/api/rules'); ok(rl.status === 200 && !rl.body.items.some(x => x.title === '급여규정' && x.version === '2026 개정안' && x.id === u2.body.id), '실제 계정 목록에는 시험 문서가 안 보임(실DB 검증이 라이브에 새지 않음)'); }

        console.log('② 알림 — 모듈을 따로 장착(가짜 알림 함수 · 가짜 audit)');
        {
            const notes = [], audits = []; const dummy = { get() { }, post() { }, delete() { } };
            const mod = require('../rules.js')(dummy, { pool, authMiddleware: null, adminOnly: null, writeAudit: async a => { audits.push(a); }, createNotification: async (...a) => { notes.push(a); } });
            await mod.ready;
            const want = (await pool.query(`SELECT id FROM users WHERE deleted_at IS NULL AND COALESCE(role,'') <> 'accountant' AND id < 990000`)).rows.map(x => x.id).sort((a, b) => a - b);
            const r = await mod.register({ title: '복무규정', version: '시험', effectiveDate: '2026-12-01', name: 'x.pdf', buf: PDF('n1'), notify: true, actor: { id: U.admin.id, name: U.admin.name, role: 'admin' } });
            const got = notes.map(n => n[0]).sort((a, b) => a - b);
            ok(r.code === 200 && r.body.notified === want.length && want.length > 0 && JSON.stringify(got) === JSON.stringify(want), `올리면 전 직원에게 알림 1건씩(퇴사·세무사·시험 계정 제외 · ${want.length}명)`, JSON.stringify([r.body, got.length]));
            ok(notes.every(n => n[1] === 'rules' && n[2] === '새 회사 규정이 올라왔어요' && /^복무규정 · 시험 · 시행 2026-12-01 — 내 정보 > 회사 규정에서 볼 수 있어요\.$/.test(n[3]) && n[4] === 'myinfo?rules=1'), '알림 = type rules · 제목·개정판·시행일 · 링크 myinfo?rules=1', JSON.stringify(notes[0]));
            const r2 = await mod.register({ title: '복무규정', version: '시험2', effectiveDate: null, name: 'y.pdf', buf: PDF('n2'), notify: true, actor: { id: U.admin.id, name: U.admin.name, role: 'admin' } });
            ok(r2.body.prev_versions === 1 && notes.length === want.length * 2 && notes[notes.length - 1][2] === '회사 규정이 새 판으로 올라왔어요' && !/시행/.test(notes[notes.length - 1][3]), '같은 제목 새 판 → 「새 판으로 올라왔어요」 · 시행일 없으면 그 글 없음');
            const r3 = await mod.register({ title: '복무규정', version: '시험3', effectiveDate: null, name: 'z.pdf', buf: PDF('n3'), notify: false, actor: { id: U.admin.id, name: U.admin.name, role: 'admin' } });
            ok(r3.body.notified === 0 && notes.length === want.length * 2, 'notify:false 면 알림 0');
            ok(audits.length === 3 && audits.every(a => a.source === 'rules' && a.action === 'rules_upload' && a.targetType === 'company_rule' && a.actor.id === U.admin.id) && audits[1].changes.prev_versions === 1, 'audit: 올림마다 source rules · prev_versions');
            await pool.query(`DELETE FROM company_rules WHERE title = '복무규정' AND uploaded_by >= 990000`);   // ③ 화면은 ① 의 두 판(급여규정)만 본다
        }

        console.log('③ 화면 — 내 정보 > 회사 규정');
        const { chromium } = require('playwright'); br = await chromium.launch();
        const openPg = async (u, vp, mobile, dark) => { const ctx = await br.newContext(Object.assign({ viewport: vp, serviceWorkers: 'block', reducedMotion: 'reduce', acceptDownloads: true }, mobile ? { isMobile: true, hasTouch: true } : {})); const pg = await ctx.newPage(); const errs = [], posts = [];
            pg.on('pageerror', e => errs.push(String(e).slice(0, 160))); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
            await pg.route('**/api/**', r => { const q = r.request(), p = new URL(q.url()).pathname; if (p === '/api/auth/me') return r.fulfill({ json: { id: u.id, username: u.username, name: u.name, position: u.position, color: '#4F46E5', role: u.role, annualLeave: 0, hasSignature: false } });
                if (p === '/api/rules' && q.method() === 'POST') { posts.push(JSON.parse(q.postData() || '{}')); return r.fulfill({ json: { ok: true, id: 777, prev_versions: 1, notified: 5 } }); }   // 올리기는 가로챔(화면만 본다)
                if (q.method() !== 'GET' && !/\/api\/(rules|notifications)/.test(p)) return r.fulfill({ json: { ok: true } }); return r.continue(); });
            await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await pg.evaluate(([t, usr, d]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(usr)); localStorage.setItem('akm_last_page', 'myinfo'); if (d) localStorage.setItem('akm_ao_theme', 'dark'); else localStorage.removeItem('akm_ao_theme'); }, [tok(u), u, !!dark]);
            await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForFunction(() => window.AkmRules && window.AkmPayslip && document.querySelector('.page.active'), null, { timeout: 30000 }); await pg.waitForTimeout(1200);
            await pg.evaluate(() => { if (!document.getElementById('page-myinfo').classList.contains('active')) switchPage('myinfo'); }); await pg.waitForTimeout(500);
            return { ctx, pg, errs, posts }; };
        const audit = pg => pg.evaluate(() => { const W = window.innerWidth, root = document.getElementById('page-myinfo'), vis = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'; const all = [...root.querySelectorAll('*')].filter(vis);
            const clip = e => { for (let n = e.parentElement; n; n = n.parentElement) { if (getComputedStyle(n).overflowX !== 'visible') { const r = n.getBoundingClientRect(); if (r.right <= W + 1 && r.left >= -1) return true; } } return false; };
            const off = all.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !clip(e); }).map(e => e.className || e.tagName).slice(0, 5);
            const small = [...root.querySelectorAll('#myinfo-tabs button, #myinfo-pane-rules button, #myinfo-pane-rules a, #myinfo-pane-rules input[type="text"], #myinfo-pane-rules summary, #cr-drop')].filter(e => vis(e) && !e.disabled).map(e => [e.id || e.className || e.tagName, Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 44);
            return { doc: document.documentElement.scrollWidth - W, off, small }; });
        const rowsOf = pg => pg.evaluate(() => ({ cur: [...document.querySelectorAll('#cr-list > .cr-list > .ps-row')].map(r => r.querySelector('b').textContent.replace(/\s+/g, ' ').trim()), subs: [...document.querySelectorAll('#cr-list > .cr-list > .ps-row .ps-row-sub')].map(x => x.textContent),
            old: [...document.querySelectorAll('#cr-list details.cr-old')].map(d => [d.querySelector('summary').textContent, d.open, d.querySelectorAll('.ps-row').length]), del: document.querySelectorAll('#cr-list [data-cr="del"]').length, form: !!document.getElementById('cr-send'), dl: [...document.querySelectorAll('#cr-list [data-cr="dl"]')].map(a => a.getAttribute('download')) }));
        // 직원 — PC 1440
        {
            const s = await openPg(U.a, { width: 1440, height: 900 });
            const t0 = await s.pg.evaluate(() => ({ tabs: [...document.querySelectorAll('#myinfo-tabs .ps-tab')].map(b => b.textContent + (b.classList.contains('active') ? '*' : '')).join('|'), info: !document.getElementById('myinfo-pane-info').hidden, pay: !document.getElementById('myinfo-pane-pay').hidden, rules: !document.getElementById('myinfo-pane-rules').hidden }));
            ok(t0.tabs === '내 정보*|급여명세서|회사 규정' && t0.info && !t0.pay && !t0.rules, '탭 [내 정보|급여명세서|회사 규정] · 처음은 내 정보', JSON.stringify(t0));
            await s.pg.click('#myinfo-tabs .ps-tab[data-pstab="rules"]'); await s.pg.waitForSelector('#cr-list .ps-row', { timeout: 10000 });
            const p1 = await s.pg.evaluate(() => ({ info: !document.getElementById('myinfo-pane-info').hidden, pay: !document.getElementById('myinfo-pane-pay').hidden, rules: !document.getElementById('myinfo-pane-rules').hidden, active: document.querySelector('#myinfo-tabs .ps-tab.active').dataset.pstab }));
            ok(!p1.info && !p1.pay && p1.rules && p1.active === 'rules', '[회사 규정] 탭 → 그 판만 보임(내 정보·급여명세서 판 숨김)', JSON.stringify(p1));
            const r1 = await rowsOf(s.pg);
            ok(r1.cur.length === 2 && r1.cur[0] === '급여규정 2026 개정안' && r1.cur[1] === '인사규정' === false || (r1.cur.length === 1 && r1.cur[0] === '급여규정 2026 개정안'), '목록: 최신 판만 줄로(급여규정 2026 개정안 · 지운 인사규정은 없음)', JSON.stringify(r1.cur));
            ok(/시행 2026-11-01 · 올린 날 \d{4}-\d{2}-\d{2} · PDF \d+KB/.test(r1.subs[0]) && r1.old.length === 1 && r1.old[0][0] === '이전 판 1' && r1.old[0][1] === false && r1.old[0][2] === 1 && r1.del === 0 && !r1.form && r1.dl[0] === '급여규정_2026 개정안.pdf', '줄 = 개정판·시행일·올린 날·크기 · 「이전 판 1」 접힘 · 직원은 지우기·올리기 없음 · 내려받기 파일 이름', JSON.stringify(r1));
            await s.pg.click('#cr-list details.cr-old summary'); await s.pg.waitForTimeout(200); const r2 = await rowsOf(s.pg); const oldRow = await s.pg.evaluate(() => { const r = document.querySelector('#cr-list details.cr-old .ps-row'); return r ? [r.querySelector('b').textContent.replace(/\s+/g, ' ').trim(), r.querySelector('.ps-badge').textContent] : null; });
            ok(r2.old[0][1] === true && oldRow && oldRow[0] === '급여규정 2025 제정' && oldRow[1] === '이전 판', '「이전 판 1」 누르면 옛 판 줄(급여규정 2025 제정 · 이전 판 배지)');
            await s.pg.locator('#cr-list > .cr-list > .ps-row [data-cr="view"]').first().click(); await s.pg.waitForFunction(() => !document.getElementById('cr-view').hidden, null, { timeout: 15000 });
            const v = await s.pg.evaluate(() => ({ title: document.getElementById('cr-view-title').textContent, src: document.getElementById('cr-view-frame').src.slice(0, 5), dl: document.getElementById('cr-view-dl').download, focus: document.activeElement.id, lock: document.body.classList.contains('ps-view-open'), ps: document.getElementById('ps-view').hidden }));
            ok(v.title === '급여규정 2026 개정안' && v.src === 'blob:' && v.dl === '급여규정 2026 개정안.pdf' && v.focus === 'cr-view-x' && v.lock && v.ps, '[보기] → 보기 창(PDF blob) · [내려받기] · 초점 [닫기] · 급여명세서 창은 안 열림', JSON.stringify(v));
            await s.pg.keyboard.press('Escape'); await s.pg.waitForTimeout(250); const c1 = await s.pg.evaluate(() => ({ hid: document.getElementById('cr-view').hidden, src: document.getElementById('cr-view-frame').getAttribute('src'), focus: (document.activeElement.dataset || {}).cr, lock: document.body.classList.contains('ps-view-open') }));
            ok(c1.hid && !c1.src && c1.focus === 'view' && !c1.lock, 'Esc → 창 닫힘 · PDF 내림 · 초점이 누른 [보기]로', JSON.stringify(c1));
            const [dlEv] = await Promise.all([s.pg.waitForEvent('download', { timeout: 15000 }).catch(() => null), s.pg.locator('#cr-list > .cr-list > .ps-row [data-cr="dl"]').first().click()]);
            ok(!!dlEv && dlEv.suggestedFilename() === '급여규정_2026 개정안.pdf' && s.pg.url().startsWith(BASE + '/'), '[내려받기] → 파일 저장(토큰으로 받아서) · 화면은 그대로', dlEv && dlEv.suggestedFilename());
            await s.pg.click('#myinfo-tabs .ps-tab[data-pstab="pay"]'); await s.pg.waitForTimeout(400); const p2 = await s.pg.evaluate(() => ({ pay: !document.getElementById('myinfo-pane-pay').hidden, rules: !document.getElementById('myinfo-pane-rules').hidden }));
            ok(p2.pay && !p2.rules, '[급여명세서] 탭으로 돌아가면 회사 규정 판 숨김(급여명세서 무회귀)');
            await s.pg.evaluate(() => { switchPage('schedule'); }); await s.pg.waitForTimeout(400); await s.pg.evaluate(() => notiGo('myinfo?rules=1')); await s.pg.waitForTimeout(900);
            const ng = await s.pg.evaluate(() => ({ page: document.querySelector('.page.active').id, rules: !document.getElementById('myinfo-pane-rules').hidden, pay: !document.getElementById('myinfo-pane-pay').hidden, rows: document.querySelectorAll('#cr-list .ps-row').length, active: document.querySelector('#myinfo-tabs .ps-tab.active').dataset.pstab }));
            ok(ng.page === 'page-myinfo' && ng.rules && !ng.pay && ng.rows >= 1 && ng.active === 'rules', '알림 링크(myinfo?rules=1) → 내 정보 > 회사 규정 탭 · 목록 뜸', JSON.stringify(ng));
            await s.pg.evaluate(() => notiGo('myinfo?pay=1')); await s.pg.waitForTimeout(700); const ng2 = await s.pg.evaluate(() => ({ rules: !document.getElementById('myinfo-pane-rules').hidden, pay: !document.getElementById('myinfo-pane-pay').hidden }));
            ok(!ng2.rules && ng2.pay, '급여명세서 알림 링크(myinfo?pay=1)도 그대로(회사 규정 판은 숨김)');
            await s.pg.click('#myinfo-tabs .ps-tab[data-pstab="rules"]'); await s.pg.waitForTimeout(300); await s.pg.focus('#myinfo-tabs .ps-tab.active'); await s.pg.keyboard.press('ArrowRight'); await s.pg.waitForTimeout(200);
            const kb1 = await s.pg.evaluate(() => document.querySelector('#myinfo-tabs .ps-tab.active').dataset.pstab); await s.pg.keyboard.press('ArrowLeft'); await s.pg.waitForTimeout(200); const kb2 = await s.pg.evaluate(() => document.querySelector('#myinfo-tabs .ps-tab.active').dataset.pstab);
            ok(kb1 === 'info' && kb2 === 'rules', '탭 화살표 키: 회사 규정 → (오른쪽) 내 정보 → (왼쪽) 회사 규정', kb1 + '/' + kb2);
            const a = await audit(s.pg); ok(a.doc <= 0 && a.off.length === 0 && a.small.length === 0 && s.errs.length === 0, 'PC 1440: 넘침 0 · 틀 밖 0 · 44px 미만 0 · 오류 0', JSON.stringify([a, s.errs]));
            await s.ctx.close();
        }
        // 직원 — 폰 390(주간·야간) · 보기 = 새 탭
        for (const dark of [false, true]) {
            const s = await openPg(U.pc, { width: 390, height: 844 }, true, dark); await s.pg.click('#myinfo-tabs .ps-tab[data-pstab="rules"]'); await s.pg.waitForSelector('#cr-list .ps-row', { timeout: 10000 }); await s.pg.waitForTimeout(300);
            const a = await audit(s.pg), th = await s.pg.evaluate(() => document.documentElement.getAttribute('data-ao-theme') || '');
            ok((dark ? th === 'dark' : th === '') && a.doc <= 0 && a.off.length === 0 && a.small.length === 0 && s.errs.length === 0, `폰 390${dark ? ' 야간' : ''}(발주컴퓨터 계정): 목록 · 넘침 0 · 누르는 것 44px · 오류 0`, JSON.stringify([th, a, s.errs]));
            if (!dark) { const [popup] = await Promise.all([s.ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null), s.pg.locator('#cr-list [data-cr="view"]').first().click()]); await s.pg.waitForTimeout(1200);
                ok(!!popup && await s.pg.evaluate(() => document.getElementById('cr-view').hidden), '폰: [보기] = 새 탭으로 열림(화면 안 창 아님)'); }
            await s.ctx.close();
        }
        // 빈 상태(시험 문서가 없는 다른 시험 계정이 아니라 — 시험 쪽은 다 보이므로 임시로 전부 지운 뒤 본다)
        { const keep = (await pool.query(`SELECT id FROM company_rules WHERE uploaded_by >= 990000 AND deleted_at IS NULL`)).rows.map(x => x.id); await pool.query(`UPDATE company_rules SET deleted_at = NOW() WHERE id = ANY($1::int[])`, [keep]);
            const s = await openPg(U.a, { width: 900, height: 1000 }); await s.pg.click('#myinfo-tabs .ps-tab[data-pstab="rules"]'); await s.pg.waitForFunction(() => /아직 올라온/.test(document.getElementById('cr-list').textContent), null, { timeout: 10000 });
            const a = await audit(s.pg); ok(/아직 올라온 회사 규정이 없어요\. 올라오면 알림으로 알려 드려요\./.test(await s.pg.textContent('#cr-list')) && a.doc <= 0 && a.small.length === 0 && s.errs.length === 0, '폴드 900 · 빈 상태 글 · 넘침 0 · 44px · 오류 0'); await s.ctx.close();
            await pool.query(`UPDATE company_rules SET deleted_at = NULL WHERE id = ANY($1::int[])`, [keep]); }
        // 관리자(경리) — 폴드 900 · 올리기(POST 가로챔) · 지우기 단추
        {
            const s = await openPg(U.admin, { width: 900, height: 1000 }); await s.pg.click('#myinfo-tabs .ps-tab[data-pstab="rules"]'); await s.pg.waitForSelector('#cr-drop', { timeout: 10000 }); await s.pg.waitForSelector('#cr-list .ps-row', { timeout: 10000 });
            const g = await s.pg.evaluate(() => ({ send: document.getElementById('cr-send').disabled, notify: document.getElementById('cr-notify').checked, title: document.getElementById('cr-title').value, del: document.querySelectorAll('#cr-list [data-cr="del"]').length, date: document.getElementById('cr-date').classList.contains('akm-date') }));
            ok(g.send && g.notify && g.title === '' && g.del >= 1 && g.date, '관리자: 올리기 칸(제목·개정판·시행일 달력·알림 체크) · 파일 없으면 [올리기] 꺼짐 · 줄마다 [지우기]', JSON.stringify(g));
            await s.pg.setInputFiles('#cr-file', [{ name: '메모.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]); await s.pg.waitForTimeout(300);
            ok(await s.pg.evaluate(() => document.getElementById('cr-send').disabled && /PDF 가 아니에요/.test(document.body.textContent)), 'PDF 아닌 파일 → 안 받음 + 안내');
            await s.pg.setInputFiles('#cr-file', [{ name: '복무규정_2026.pdf', mimeType: 'application/pdf', buffer: PDF('ui') }]); await s.pg.waitForTimeout(300);
            await s.pg.click('#cr-send'); await s.pg.waitForTimeout(400); ok(s.posts.length === 0 && /규정 제목을 적어 주세요/.test(await s.pg.textContent('#cr-msg')) && await s.pg.evaluate(() => document.activeElement.id === 'cr-title'), '제목 없이 [올리기] → 요청 0 · 안내 · 초점 제목 칸');
            await s.pg.fill('#cr-title', '복무규정'); await s.pg.fill('#cr-version', '2026 제정'); await s.pg.evaluate(() => { document.getElementById('cr-date').value = '2026-12-01'; });
            await s.pg.click('#cr-send'); await s.pg.waitForFunction(() => /올렸어요/.test(document.getElementById('cr-msg').textContent), null, { timeout: 15000 });
            const p = s.posts[0]; ok(s.posts.length === 1 && p.title === '복무규정' && p.version === '2026 제정' && p.effective_date === '2026-12-01' && p.name === '복무규정_2026.pdf' && p.notify === true && /^JVBERi0/.test(p.data), '[올리기] → POST(제목·개정판·시행일·파일·알림)', JSON.stringify(Object.assign({}, p, { data: (p && p.data || '').slice(0, 8) })));
            const after = await s.pg.evaluate(() => ({ msg: document.getElementById('cr-msg').textContent, title: document.getElementById('cr-title').value, drop: document.getElementById('cr-drop').textContent, send: document.getElementById('cr-send').disabled }));
            ok(/「복무규정 2026 제정」 올렸어요 · 옛 판 1건은 「이전 판」으로 · 알림 5명/.test(after.msg) && after.title === '' && /끌어다 놓거나/.test(after.drop) && after.send, '올린 뒤: 결과 글(옛 판 · 알림 명수) · 칸 비움 · 파일 비움', JSON.stringify(after));
            const delBtn = s.pg.locator('#cr-list details.cr-old [data-cr="del"]').first(); await s.pg.click('#cr-list details.cr-old summary'); await s.pg.waitForTimeout(200); await delBtn.click(); await s.pg.waitForTimeout(200);
            ok(await delBtn.evaluate(b => b.dataset.sure === '1' && b.textContent === '정말 지우기'), '[지우기] 한 번 → 「정말 지우기」(두 번 눌러야)');
            await delBtn.click(); await s.pg.waitForTimeout(1200); const r3 = await rowsOf(s.pg);
            ok(r3.old.length === 0 && r3.cur[0] === '급여규정 2026 개정안' && (await call(U.a, '/api/rules')).body.items.length === 1, '두 번째 누름 → 옛 판(2025) 지워짐 · 「이전 판」 사라짐 · 서버 목록 1건');
            const a = await audit(s.pg); ok(a.doc <= 0 && a.off.length === 0 && a.small.length === 0 && s.errs.length === 0, '폴드 900 관리자: 넘침 0 · 틀 밖 0 · 44px · 오류 0', JSON.stringify([a, s.errs]));
            await s.ctx.close();
        }
        code = fail ? 1 : 0;
    } catch (e) { console.error('ERR', e.stack || e.message); code = 1; }
    finally { if (br) await br.close().catch(() => { }); srv.kill(); await clean(); const left = await pool.query(`SELECT count(*)::int AS n FROM company_rules WHERE uploaded_by >= 990000`).catch(() => ({ rows: [{ n: '?' }] })); console.log('  정리: 시험 줄 남은 것 =', left.rows[0].n); await pool.end().catch(() => { }); }
    console.log(`\n결과: ${pass}/${pass + fail}`); setTimeout(() => process.exit(code), 300);
})();
