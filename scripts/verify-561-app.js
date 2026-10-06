// #561 화면 검증(app.js) — 대표·과장·직원으로 실렌더: 데이터관리 메뉴 · 문의 관리의 전체 스위치·삭제·수정 이력 · 과장이 계속 쓰는 메뉴
//   로컬 서버 3457(스케줄러 막음) · 쓰기 요청은 전부 막는다(GET 만 통과) → DB 쓰기 0
const { spawn } = require('child_process'); const path = require('path'); const jwt = require('jsonwebtoken'); const { chromium } = require('playwright');
const PORT = 3457, ROOT = path.join(__dirname, '..'), SECRET = 'verifytest';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const U = { 대표: { id: 1, username: 'o', name: '전승범', position: '대표', role: 'admin' }, 과장: { id: 7, username: 'm', name: '조가영', position: '과장', role: 'admin' }, 직원: { id: 5, username: 's', name: '김민주', position: '팀장', role: 'user' } };
(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
    let br;
    try {
        let up = false; for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('서버 기동 실패');
        br = await chromium.launch();
        for (const who of Object.keys(U)) {
            console.log('—', who);
            const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' }); const pg = await ctx.newPage();
            const errs = []; pg.on('pageerror', e => errs.push(e.message));
            let writes = 0; await pg.route('**/api/**', r => { if (r.request().method() !== 'GET') { writes++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); } return r.continue(); });
            const tok = jwt.sign(U[who], SECRET, { expiresIn: '1h' });
            await pg.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [tok, U[who]]);
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' }); await sleep(3500);
            const vis = sel => pg.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && e.getClientRects().length > 0; }, sel);
            const nav = async p => vis(`.nav-item[data-page="${p}"]`);
            const dataNav = await nav('data'), setNav = await nav('settlement'), priNav = await nav('pricing');
            ok(dataNav === (who === '대표'), `데이터관리 메뉴 ${dataNav ? '보임' : '안 보임'}`);
            ok(setNav === (who !== '직원') && priNav === (who !== '직원'), `정산관리 ${setNav ? '보임' : '안 보임'} · 품목별 금액 ${priNav ? '보임' : '안 보임'}`);
            // 억지로 데이터관리 열기
            await pg.evaluate(() => switchPage('data')); await sleep(800);
            const dataOpen = await pg.evaluate(() => { const e = document.getElementById('page-data') || document.querySelector('[id$="data-page"], #data-page'); const a = document.querySelector('.page.active, .page-section.active'); return { active: a ? a.id : '', dataShown: !!(e && getComputedStyle(e).display !== 'none') }; });
            ok(who === '대표' ? dataOpen.dataShown || /data/.test(dataOpen.active) : !/data/.test(dataOpen.active) && !dataOpen.dataShown, `switchPage('data') → 열린 화면 = ${dataOpen.active}`);
            // 과장이 계속 쓰는 화면 — 실제로 열리는지
            if (who !== '직원') for (const p of ['settlement', 'pricing']) { await pg.evaluate(x => switchPage(x), p); await sleep(900); const a = await pg.evaluate(() => { const a = document.querySelector('.page.active, .page-section.active'); return a ? a.id : ''; }); ok(a.includes(p), `${p} 열림(${a})`); }
            // 문의 관리 — 실제 메뉴 클릭
            const inqNav = await pg.$('.nav-item[data-page="inquiry"]');
            if (inqNav) { await inqNav.click(); await sleep(2500); } else { await pg.evaluate(() => switchPage('inquiry')); await sleep(2500); }
            const sw = await vis('#inquiry-auto-reply-wrap'), rows = await pg.evaluate(() => document.querySelectorAll('#inquiry-scenario-list tr, #inquiry-list tr, #inquiry-table tbody tr').length), cnt = await pg.evaluate(() => (document.getElementById('inquiry-count') || {}).textContent || '');
            ok(!!sw === (who === '대표'), `자동답변 전체 스위치 ${sw ? '보임' : '안 보임'}`);
            ok(/\d+건/.test(cnt), `시나리오 목록 표시 ${cnt}`);
            const hist = await vis('#inquiry-history-card');
            ok(!!hist === (who === '대표'), `수정 이력 카드 ${hist ? '보임' : '안 보임'}`);
            // 시나리오 한 줄을 눌러 수정 창 → 삭제 버튼
            const row = await pg.$('#page-inquiry tbody tr, [id*="inquiry"] tbody tr');
            if (row) { await row.click(); await sleep(900); const del = await vis('#btn-inquiry-delete'); ok(!!del === (who === '대표'), `수정 창의 [삭제] ${del ? '보임' : '안 보임'}`); const save = await vis('#btn-inquiry-save'); ok(save, '수정 창에 [저장]은 있음(편집은 그대로)'); await pg.keyboard.press('Escape'); await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; m.classList.remove('active', 'show'); }); }); }
            else ok(false, '시나리오 행을 못 찾음');
            // 판매현황 탭 — 삭제 버튼
            const tab = await pg.$('[onclick*="products"], [data-tab="products"]');
            if (tab) { await tab.click(); await sleep(2500); const delN = await pg.evaluate(() => [...document.querySelectorAll('button')].filter(b => /deleteBotProd/.test(b.getAttribute('onclick') || '')).length); const rowsN = await pg.evaluate(() => document.querySelectorAll('[onclick*="saveBotProd"], [onchange*="BotProd"], [onclick*="BotProd"]').length); ok(who === '대표' ? true : delN === 0, `판매현황 [삭제] 버튼 ${delN}개 · 품목 조작 요소 ${rowsN}`); ok(rowsN > 0, '판매현황 목록 표시'); }
            else ok(false, '판매현황 탭을 못 찾음');
            ok(errs.length === 0, `화면 오류 ${errs.length}${errs.length ? ' — ' + errs[0].slice(0, 120) : ''} · 막은 쓰기 요청 ${writes}`);
            await ctx.close();
        }
    } catch (e) { fail++; console.log('ERR', e.message.split('\n')[0]); }
    finally { if (br) await br.close(); srv.kill(); }
    console.log(`\n#561 화면(app.js): ${pass} 통과 / ${fail} 실패`); process.exit(fail ? 1 : 0);
})();
