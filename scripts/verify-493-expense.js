/* #493(대표 10/1): 지출결의서 ①승인 전 수정 ②항목 「급여」 ③선택 일괄 삭제 — 로컬 실서버(3457) + 실DB 읽기·시험 행만 쓰기(끝에 삭제) + 실렌더·실클릭
   서버 검사 = PUT /api/expense-reports/:id (본인 pending OK · 승인된 건 400 · 남의 건 직원 403) — 시험 행은 SQL로 넣고 끝에 SQL로 지움(알림 0).
   화면 검사 = 목록 GET은 가짜 데이터로 route · PUT/DELETE/approve는 가로채 기록(실DB 무변경). node scripts/verify-493-expense.js */
require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const PORT = 3457;
let pass = 0, fail = 0;
const ok = (t, c, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
let srv, browser, db;
const testIds = [];
(async () => {
    srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
        { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
    if (!up) throw new Error('server not up');
    db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND role='admin' AND deleted_at IS NULL LIMIT 1`)).rows[0];
    const staff = (await db.query(`SELECT id, name, position FROM users WHERE role='user' AND position IN ('팀장','대리') AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
    ok('대표·직원 계정 확인', !!ceo && !!staff, `${ceo && ceo.name} / ${staff && staff.name}`);
    const tok = u => jwt.sign({ id: u.id, name: u.name, position: u.position || '대표', role: u.role || (u.position ? 'staff' : 'admin') }, 'verifytest', { expiresIn: '15m' });
    const ceoTok = jwt.sign({ id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, 'verifytest', { expiresIn: '15m' });
    const staffTok = jwt.sign({ id: staff.id, name: staff.name, position: staff.position, role: 'user' }, 'verifytest', { expiresIn: '15m' });
    const api = (p, m, body, t) => fetch(`http://localhost:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));

    // ── 서버: 시험 행 2건(SQL — 알림 0) ──
    const items0 = [{ category: '소모품비', detail: '사무용품', amount: 12000, note: '[검증493] 시험' }];
    const r1 = await db.query(`INSERT INTO expense_reports (title, applicant_id, total_amount, purpose, items, ceo_id, use_date, status) VALUES ('[검증493] 소모품비', $1, 12000, '검증', $2, $1, '2026-10-01', 'pending') RETURNING id`, [ceo.id, JSON.stringify(items0)]);
    const r2 = await db.query(`INSERT INTO expense_reports (title, applicant_id, total_amount, purpose, items, ceo_id, use_date, status, ceo_status, ceo_approved_at) VALUES ('[검증493] 승인된건', $1, 5000, '검증', $2, $1, '2026-10-01', 'approved', 'approved', NOW()) RETURNING id`, [ceo.id, JSON.stringify(items0)]);
    const idP = r1.rows[0].id, idA = r2.rows[0].id; testIds.push(idP, idA);
    const newItems = [{ category: '급여', detail: '직원 급여, 상여, 수당, 퇴직금', amount: 1500000, note: '[검증493] 수정' }, { category: '기타', detail: '검증 기타', amount: 500, note: '' }];
    const e1 = await api(`/api/expense-reports/${idP}`, 'PUT', { title: '급여, 기타', purpose: '수정됨', items: newItems, useDate: '2026-09-30' }, ceoTok);
    const row = (await db.query(`SELECT title, purpose, total_amount, items, use_date::text, status FROM expense_reports WHERE id=$1`, [idP])).rows[0];
    ok('서버 PUT 승인 전 수정 → 200 · 제목·목적·항목·합계·사용날짜 갱신', e1.status === 200 && row.title === '급여, 기타' && row.purpose === '수정됨' && Number(row.total_amount) === 1500500 && row.items.length === 2 && row.items[0].category === '급여' && row.use_date === '2026-09-30' && row.status === 'pending', JSON.stringify({ s: e1.status, row: { t: row.title, total: row.total_amount, d: row.use_date } }));
    const e2 = await api(`/api/expense-reports/${idA}`, 'PUT', { title: 'x', purpose: '', items: newItems, useDate: null }, ceoTok);
    ok('서버 PUT 승인된 건 → 400 거부', e2.status === 400, e2.json.error);
    const e3 = await api(`/api/expense-reports/${idP}`, 'PUT', { title: 'x', purpose: '', items: newItems, useDate: null }, staffTok);
    ok('서버 PUT 남의 건(직원) → 403 거부', e3.status === 403, e3.json.error);
    const e4 = await api(`/api/expense-reports/${idP}`, 'PUT', { title: 'x', purpose: '', items: [], useDate: null }, ceoTok);
    ok('서버 PUT 항목 0건 → 400', e4.status === 400, e4.json.error);
    const d1 = await api(`/api/expense-reports/${idA}`, 'DELETE', null, ceoTok);
    ok('서버 DELETE 승인된 건 → 400(대표도 불가 · #493-b)', d1.status === 400, d1.json.error);
    const d2 = await api(`/api/expense-reports/${idP}`, 'DELETE', null, staffTok);
    ok('서버 DELETE 남의 승인 전 건(직원) → 403', d2.status === 403, d2.json.error);
    const r3 = await db.query(`INSERT INTO expense_reports (title, applicant_id, total_amount, purpose, items, ceo_id, use_date, status) VALUES ('[검증493] 직원건', $1, 7000, '검증', $2, $3, '2026-10-01', 'pending') RETURNING id`, [staff.id, JSON.stringify(items0), ceo.id]);
    const idS = r3.rows[0].id; testIds.push(idS);
    const d3 = await api(`/api/expense-reports/${idS}`, 'DELETE', null, staffTok);
    const gone = (await db.query('SELECT 1 FROM expense_reports WHERE id=$1', [idS])).rowCount === 0;
    ok('서버 DELETE 본인 승인 전 건(직원) → 200 · 실삭제', d3.status === 200 && gone);
    const d4 = await api(`/api/expense-reports/${idP}`, 'DELETE', null, ceoTok);
    const goneP = (await db.query('SELECT 1 FROM expense_reports WHERE id=$1', [idP])).rowCount === 0;
    ok('서버 DELETE 대표 → 승인 전 건 200 · 실삭제', d4.status === 200 && goneP);

    // ── 화면(대표) ──
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    const fake = [
        { id: 9001, title: '소모품비', applicant_id: ceo.id, applicant_name: ceo.name, applicant_position: '대표', total_amount: 12000, purpose: '검증 목적', use_date: '2026-10-01', created_at: '2026-10-01T01:00:00Z', status: 'pending', ceo_id: ceo.id, ceo_status: 'pending', items: [{ category: '소모품비', detail: '사무용품', amount: 12000, note: '프린터 잉크' }, { category: '기타', detail: '직접 적은 상세', amount: 3000, note: '' }] },
        { id: 9002, title: '복리후생비', applicant_id: ceo.id, applicant_name: ceo.name, applicant_position: '대표', total_amount: 30000, purpose: '', use_date: '2026-09-29', created_at: '2026-09-29T01:00:00Z', status: 'approved', ceo_id: ceo.id, ceo_status: 'approved', items: [{ category: '복리후생비', amount: 30000, note: '' }] },
        { id: 9003, title: '공과금', applicant_id: staff.id, applicant_name: staff.name, applicant_position: staff.position, total_amount: 50000, purpose: '', use_date: '2026-09-28', created_at: '2026-09-28T01:00:00Z', status: 'pending', ceo_id: ceo.id, ceo_status: 'pending', items: [{ category: '공과금', amount: 50000, note: '' }] },
    ];
    async function openPage(user, token) {
        const pg = await browser.newPage();
        const errors = [], calls = [], dialogs = [];
        pg.on('pageerror', e => errors.push(String(e)));
        pg.on('dialog', d => { dialogs.push(d.message().slice(0, 160)); d.accept(); });
        await pg.route('**/api/expense-reports/**', route => {
            const req = route.request(); const url = req.url(); const m = req.method();
            const idm = url.match(/expense-reports\/(\d+)(\/\w+)?(\?|$)/);
            if (m === 'GET' && /\/my(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fake.filter(f => f.applicant_id === user.id)) });
            if (m === 'GET' && /\/pending(\?|$)/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fake.filter(f => f.status === 'pending')) });
            if (m === 'GET' && /\/history/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fake) });
            if (m === 'GET' && idm) { const f = fake.find(x => x.id === Number(idm[1])); return route.fulfill({ status: f ? 200 : 404, contentType: 'application/json', body: JSON.stringify(f || { error: 'nf' }) }); }
            if (m === 'PUT' || m === 'DELETE') { calls.push({ m, url: url.replace(/^.*\/api/, '/api'), body: req.postDataJSON ? req.postDataJSON() : null }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }); }
            return route.continue();
        });
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [token, user]);
        await pg.reload({ waitUntil: 'networkidle' });
        await pg.waitForTimeout(2500);
        await pg.evaluate(() => { const h = setInterval(() => {}, 1e9); for (let i = 1; i <= h; i++) clearInterval(i); });
        await pg.evaluate(() => switchPage('expense'));
        await pg.waitForTimeout(500);
        return { pg, errors, calls, dialogs };
    }
    const tab = (pg, name) => pg.evaluate(n => { const t = document.querySelector(`[data-expense-tab="${n}"]`); t && t.click(); }, name);

    const C = await openPage({ id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, ceoTok);
    // ② 급여 항목
    const cats = await C.pg.evaluate(() => [...document.querySelectorAll('#expense-items .expense-item-category option')].map(o => o.value));
    ok('작성 탭 항목 선택에 「급여」 있음(기타 바로 앞)', cats.includes('급여') && cats.indexOf('급여') === cats.indexOf('기타') - 1, cats.join('/'));
    // ① 내 신청 목록 → 수정 버튼(pending만) → 작성 탭 프리필 → 수정 저장 = PUT
    await tab(C.pg, 'my');
    await C.pg.waitForFunction(() => document.querySelectorAll('#expense-my-list tr:not(.empty-row)').length > 0, null, { timeout: 10000 });
    const myBtns = await C.pg.evaluate(() => [...document.querySelectorAll('#expense-my-list tr')].map(tr => ({ t: tr.children[0].textContent.trim(), edit: !!tr.querySelector('.expense-edit-btn') })));
    ok('내 신청 목록: 결재 대기 행만 [✏️ 수정]', myBtns.find(x => x.t === '소모품비').edit && !myBtns.find(x => x.t === '복리후생비').edit, JSON.stringify(myBtns));
    const myDel = await C.pg.evaluate(() => [...document.querySelectorAll('#expense-my-list tr')].map(tr => ({ t: tr.children[0].textContent.trim(), del: !!tr.querySelector('.expense-del-btn') })));
    ok('내 신청 목록: 승인 전 행만 [삭제](승인된 행 없음 · #493-b)', myDel.find(x => x.t === '소모품비').del && !myDel.find(x => x.t === '복리후생비').del, JSON.stringify(myDel));
    await C.pg.click('#expense-my-list .expense-edit-btn');
    await C.pg.waitForTimeout(600);
    const form = await C.pg.evaluate(() => ({
        writeShown: document.getElementById('expense-section-write').style.display !== 'none',
        bar: document.getElementById('expense-edit-bar').style.display !== 'none', barText: document.getElementById('expense-edit-bar').textContent.trim().slice(0, 12),
        btn: document.getElementById('expense-submit').textContent.trim(),
        purpose: document.getElementById('expense-purpose').value, useDate: document.getElementById('expense-use-date').value,
        rows: [...document.querySelectorAll('#expense-items .expense-item-row')].map(r => ({ cat: r.querySelector('.expense-item-category').value, detail: r.querySelector('.expense-item-detail').textContent.trim(), amt: r.querySelector('.expense-item-amount').value, note: r.querySelector('.expense-item-note').value })),
        total: document.getElementById('expense-total').textContent.trim(),
    }));
    ok('수정 클릭 → 작성 탭 열림 + 「#9001 수정 중」 띠 + 버튼 「수정 저장」', form.writeShown && form.bar && /#9001 수정 중/.test(form.barText) && form.btn === '수정 저장', JSON.stringify({ bar: form.barText, btn: form.btn }));
    ok('프리필: 목적·사용날짜·항목 2행(카테고리·상세·금액·비고)·합계', form.purpose === '검증 목적' && form.useDate === '2026-10-01' && form.rows.length === 2 && form.rows[0].cat === '소모품비' && form.rows[0].amt === '12000' && form.rows[0].note === '프린터 잉크' && form.rows[1].cat === '기타' && form.rows[1].detail === '직접 적은 상세' && form.rows[1].amt === '3000' && form.total === '15,000 원', JSON.stringify(form.rows) + ' ' + form.total);
    // 금액 바꾸고 급여 행 추가 후 저장
    await C.pg.fill('#expense-items .expense-item-row:nth-child(1) .expense-item-amount', '20000');
    await C.pg.click('#expense-add-item');
    await C.pg.selectOption('#expense-items .expense-item-row:nth-child(3) .expense-item-category', '급여');
    await C.pg.fill('#expense-items .expense-item-row:nth-child(3) .expense-item-amount', '100000');
    await C.pg.click('#expense-submit');
    await C.pg.waitForTimeout(800);
    const put = C.calls.find(c => c.m === 'PUT' && /\/api\/expense-reports\/9001$/.test(c.url));
    ok('[수정 저장] → PUT /api/expense-reports/9001 (제목 자동 = 항목 나열 · 합계 123,000)', !!put && put.body && put.body.title === '소모품비, 기타, 급여' && put.body.items.length === 3 && put.body.items.reduce((s, i) => s + i.amount, 0) === 123000 && put.body.useDate === '2026-10-01', JSON.stringify(put && put.body && { title: put.body.title, n: put.body.items.length }));
    const after = await C.pg.evaluate(() => ({ bar: document.getElementById('expense-edit-bar').style.display, btn: document.getElementById('expense-submit').textContent.trim(), myShown: document.getElementById('expense-section-my').style.display !== 'none', editId: window._expenseEditId || null }));
    ok('저장 뒤 수정 모드 해제(띠 숨김·버튼 「제출」·내 신청 목록으로)', after.bar === 'none' && after.btn === '제출' && after.myShown && !after.editId, JSON.stringify(after));
    // 상세 모달에도 수정 버튼(pending) · 승인된 건엔 없음
    C.dialogs.length = 0; await C.pg.evaluate(() => viewExpenseDetail(9001)); try { await C.pg.waitForSelector('.modal-overlay', { timeout: 20000 }); } catch (e) { console.log('   (modal 9001 미표시 · dialogs=' + JSON.stringify(C.dialogs) + ')'); }
    const m1 = await C.pg.evaluate(() => !!document.querySelector('.modal-overlay .expense-edit-btn'));
    await C.pg.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(o => o.remove()));
    await C.pg.evaluate(() => viewExpenseDetail(9002)); try { await C.pg.waitForSelector('.modal-overlay', { timeout: 20000 }); } catch (e) { console.log('   (modal 9002 미표시 · dialogs=' + JSON.stringify(C.dialogs) + ')'); }
    const m2 = await C.pg.evaluate(() => !!document.querySelector('.modal-overlay .expense-edit-btn'));
    await C.pg.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(o => o.remove()));
    await C.pg.waitForFunction(() => !document.querySelector('.modal-overlay'));
    ok('상세 창: 결재 대기 건 [수정] 있음 · 승인된 건 없음', m1 && !m2);
    // ③ 결재 대기 탭 선택 삭제
    await tab(C.pg, 'pending');
    await C.pg.waitForFunction(() => document.querySelectorAll('#expense-pending-list tr:not(.empty-row)').length > 0, null, { timeout: 10000 });
    const pend = await C.pg.evaluate(() => ({ del: document.getElementById('expense-pending-batch-delete').style.display !== 'none', app: document.getElementById('expense-pending-batch-approve').style.display !== 'none', checks: document.querySelectorAll('#expense-pending-list .expense-pending-check').length }));
    ok('결재 대기 탭: [🗑 선택 삭제] 노출(대표) · [선택 승인] 무회귀', pend.del && pend.app && pend.checks === 2, JSON.stringify(pend));
    await C.pg.click('#expense-pending-check-all');
    C.calls.length = 0;
    await C.pg.click('#expense-pending-batch-delete');
    await C.pg.waitForTimeout(800);
    const dels = C.calls.filter(c => c.m === 'DELETE').map(c => c.url);
    ok('전체선택 → [선택 삭제] → DELETE 2건(9001·9003)', dels.length === 2 && dels.some(u => /\/9001$/.test(u)) && dels.some(u => /\/9003$/.test(u)), dels.join(' '));
    // ③ 이력 탭: 대표는 승인된 행도 체크 가능 · 선택 승인은 대기 건만 · 선택 삭제는 전부
    await tab(C.pg, 'history');
    await C.pg.waitForFunction(() => document.querySelectorAll('#expense-history-list tr:not(.empty-row)').length > 0, null, { timeout: 10000 });
    const hist = await C.pg.evaluate(() => ({ del: document.getElementById('expense-history-batch-delete').style.display !== 'none', app: document.getElementById('expense-history-batch-approve').style.display !== 'none', checks: document.querySelectorAll('#expense-history-list .expense-history-check').length, checkAll: document.getElementById('expense-history-check-all').style.display !== 'none' }));
    ok('이력 탭(대표): 승인 전 2행만 체크박스(승인된 행 제외 · #493-b) · [선택 승인]·[선택 삭제]·전체선택 노출', hist.checks === 2 && hist.del && hist.app && hist.checkAll, JSON.stringify(hist));
    const histDelBtns = await C.pg.evaluate(() => [...document.querySelectorAll('#expense-history-list tr')].map(tr => !!tr.querySelector('.btn-danger')));
    ok('이력 탭: 승인된 행에 단건 [삭제] 없음', histDelBtns.filter(Boolean).length === 2, JSON.stringify(histDelBtns));
    await C.pg.click('#expense-history-check-all');
    C.calls.length = 0;
    await C.pg.click('#expense-history-batch-approve');
    await C.pg.waitForTimeout(800);
    const apps = C.calls.filter(c => /\/approve$/.test(c.url)).map(c => c.url);
    ok('전체선택 → [선택 승인] = 결재 대기 2건만 approve(승인된 9002 제외)', apps.length === 2 && !apps.some(u => /9002\//.test(u)), apps.join(' '));
    await C.pg.waitForTimeout(500);
    await C.pg.click('#expense-history-check-all'); // 재렌더 뒤 다시 전체선택
    C.calls.length = 0;
    await C.pg.click('#expense-history-batch-delete');
    await C.pg.waitForTimeout(800);
    const dels2 = C.calls.filter(c => c.m === 'DELETE').map(c => c.url);
    ok('이력 탭 [선택 삭제] → DELETE 2건(승인된 건 제외)', dels2.length === 2 && !dels2.some(u => /9002$/.test(u)), dels2.join(' '));
    ok('대표 화면 페이지 오류 0', C.errors.length === 0, C.errors.join(' | '));
    await C.pg.close();
    // ── 화면(직원): 선택 삭제 숨김 · 승인된 행 체크박스 없음 · 내 목록 수정 버튼은 본인 pending만 ──
    const S = await openPage({ id: staff.id, name: staff.name, position: staff.position, role: 'user' }, staffTok);
    await tab(S.pg, 'my');
    await S.pg.waitForFunction(() => document.querySelectorAll('#expense-my-list tr:not(.empty-row)').length > 0, null, { timeout: 10000 });
    const sMy = await S.pg.evaluate(() => document.querySelectorAll('#expense-my-list .expense-edit-btn').length);
    ok('직원 내 신청 목록: 본인 결재 대기 건 [수정] 1개', sMy === 1, sMy);
    const sTabs = await S.pg.evaluate(() => ({ pendingTab: document.getElementById('expense-tab-pending').style.display, histTab: document.getElementById('expense-tab-history').style.display, delP: document.getElementById('expense-pending-batch-delete').style.display, delH: document.getElementById('expense-history-batch-delete').style.display }));
    ok('직원: 결재 대기·이력 탭 숨김(종전) · 선택 삭제 버튼 숨김', sTabs.pendingTab === 'none' && sTabs.histTab === 'none' && sTabs.delP === 'none' && sTabs.delH === 'none', JSON.stringify(sTabs));
    ok('직원 화면 페이지 오류 0', S.errors.length === 0, S.errors.join(' | '));
    await S.pg.close();
})().catch(e => { console.error('ERR', e.message); fail++; })
.finally(async () => {
    try { if (db && testIds.length) { await db.query(`DELETE FROM expense_reports WHERE id = ANY($1) AND title LIKE '[검증493]%'`, [testIds]); console.log('  🧹 시험 행 삭제', testIds.join(',')); } } catch (e) { console.log('cleanup err', e.message); }
    try { await db?.end(); } catch {}
    try { await browser?.close(); } catch {}
    try { srv?.kill(); } catch {}
    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
});
