/* #430 검증 — 네이버 변경목록 되감기 15→60분 + 누락 건 수기 발송 대기 행(2026090857632841)
   ① 코드: 교정 지점 2곳(kakao_notify·lms_guide) · 15분 잔재 0 · 페이지네이션(moreSequence) 존재
   ② 구간 계산: 실코드 식을 그대로 평가 — 체크포인트 −60분 · 최초(null) = 2h · 23.5h 클램프
   ③ 로컬 실서버(3457·스케줄러 차단·실DB): 이력 API 실패·보류 필터에 보류 행 노출
   ④ 실렌더: 문의 관리 → 알림 발송 이력 → 해당 행에 [오늘/내일 발송으로 안내] 버튼 (클릭 안 함 = 실발송 0) */
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const PORT = 3457, KEY = '2026090857632841';
let pass = 0, fail = 0;
const ok = (name, c, note) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + name + (note ? ' — ' + note : '')); };
(async () => {
    let srv = null, browser = null;
    try {
        const sj = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        const n60 = (sj.match(/- 60 \* 60 \* 1000, now - 23\.5 \* 3600 \* 1000\)/g) || []).length;
        const n15 = (sj.match(/- 15 \* 60 \* 1000, now - 23\.5 \* 3600 \* 1000\)/g) || []).length;
        ok('① 되감기 60분 = 2곳(주문안내·발송안내) · 15분 잔재 0', n60 === 2 && n15 === 0, `60분 ${n60} · 15분 ${n15}`);
        const fnA = sj.indexOf('async function collectKakaoNotify'), fnB = sj.indexOf('async function collectLmsGuide');
        ok('① 두 수집기 함수 안에 각각 위치', fnA > 0 && fnB > 0 && sj.indexOf('60 * 60 * 1000, now - 23.5', fnA) < fnB && sj.indexOf('60 * 60 * 1000, now - 23.5', fnB) > fnB);
        ok('① naverFetchChanges 페이지네이션(moreFrom/moreSequence·10p)', /moreSeq = \(more\.moreSequence != null\)/.test(sj) && /page < 10/.test(sj));
        // ② 구간 계산 — 실코드 식 추출·평가 (🔴 collectKakaoNotify 함수 구간에서 — 같은 변수명의 다른 수집기 식에 걸리지 않게)
        const expr = (sj.slice(fnA, fnB).match(/const fromMs = (Math\.max\([^\n]*\));/) || [])[1];
        const calc = (cp, now) => new Function('cp', 'now', 'return ' + expr)(cp, now);
        const now = Date.parse('2026-09-08T05:45:00Z');
        ok('② 체크포인트 −60분', calc('2026-09-08T05:42:00Z', now) === Date.parse('2026-09-08T04:42:00Z'), new Date(calc('2026-09-08T05:42:00Z', now)).toISOString());
        ok('② 14:12 결제 건이 14:15~15:12 틱 구간에 포함(종전 15분은 14:27까지)', calc('2026-09-08T05:42:00Z', now) < Date.parse('2026-09-08T05:12:42Z') && (Date.parse('2026-09-08T05:42:00Z') - 15 * 60000) > Date.parse('2026-09-08T05:12:42Z'));
        ok('② 체크포인트 없음 = now−2h · 23.5h 클램프', calc(null, now) === now - 2 * 3600 * 1000 && calc('2026-09-01T00:00:00Z', now) === now - 23.5 * 3600 * 1000);
        // ③ 로컬 실서버
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
        let up = false;
        for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } if (srv.exitCode !== null) break; }
        ok('③ 로컬 실서버 기동', up, up ? '' : log.slice(-300));
        if (!up) throw new Error('서버 기동 실패');
        await new Promise(r => setTimeout(r, 2500));
        const token = jwt.sign({ id: 1, username: 'ceo', name: '전승범', role: 'admin' }, 'verifytest', { expiresIn: '10m' });
        const H = { Authorization: 'Bearer ' + token };
        const j = await (await fetch(`http://localhost:${PORT}/api/agent-office/notify-logs?filter=issue&ch=naver&from=2026-09-08&to=2026-09-08&fast=1`, { headers: H })).json();
        const txt = JSON.stringify(j);
        const rowJ = (j.rows || j.logs || j.items || []).find(r => JSON.stringify(r).includes(KEY));
        ok('③ 이력 API(실패·보류 필터): 보류 행 노출 · hold-0809', txt.includes(KEY) && /hold-0809/.test(JSON.stringify(rowJ || {})), rowJ ? JSON.stringify(rowJ).slice(0, 160) : txt.slice(0, 120));
        // ④ 실렌더
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const pg = await browser.newPage();
        const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 80)));
        pg.on('dialog', d => { console.log('    dialog(거부):', d.message().slice(0, 60)); d.dismiss(); });   // confirm은 전부 거부 — 실발송 0
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' })); }, [token]);
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.waitForTimeout(3500);
        await pg.click('.nav-item[data-page="inquiry"]'); await pg.waitForTimeout(1500);
        await pg.click('#inquiry-tab-btn-notify');
        await pg.waitForFunction(() => !!document.querySelector('#notify-log-list table tbody tr'), { timeout: 20000 });
        await pg.selectOption('#notify-log-ch', 'naver');
        await pg.selectOption('#notify-log-filter', 'issue');
        await pg.waitForTimeout(3000);
        const row = await pg.evaluate((k) => { const tr = document.querySelector(`#notify-log-list tbody tr[data-okey="${k}"]`); if (!tr) return null;
            const btns = [...tr.querySelectorAll('button')].map(b => b.textContent.trim()); return { text: tr.innerText.replace(/\s+/g, ' ').slice(0, 220), btns }; }, KEY);
        ok('④ 실렌더: 보류 행 표시 + [오늘/내일 발송으로 안내] 버튼', !!row && row.btns.includes('오늘 발송으로 안내') && row.btns.includes('내일 발송으로 안내'), row ? row.btns.join(' | ') + ' · ' + row.text.slice(0, 120) : '행 없음');
        ok('④ pageerror 0', errs.length === 0, errs.join(' | ') || '없음');
    } catch (e) { ok('예외 없음', false, e.message.slice(0, 160)); }
    finally { if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail === 0 ? 0 : 1);
})();
