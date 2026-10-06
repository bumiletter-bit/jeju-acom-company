// #564 「지금 챙길 일」에 대표 할 일 표시 — 대표만 보이고(과장·직원 0) 칸을 넘치지 않는지 실렌더(로컬 3457 · 쓰기 요청 막음)
const { spawn } = require('child_process'); const path = require('path'); const jwt = require('jsonwebtoken'); const { chromium } = require('playwright');
const PORT = 3457, ROOT = path.join(__dirname, '..'), SECRET = 'verifytest'; const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const U = { 대표: { id: 1, username: 'o', name: '전승범', position: '대표', role: 'admin' }, 과장: { id: 7, username: 'm', name: '조가영', position: '과장', role: 'admin' }, 직원: { id: 5, username: 's', name: '김민주', position: '팀장', role: 'user' } };
(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
    let br;
    try {
        let up = false; for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('서버 기동 실패');
        br = await chromium.launch();
        for (const [who, vw] of [['대표', 1400], ['대표', 390], ['과장', 1400], ['직원', 1400]]) {
            const ctx = await br.newContext({ viewport: { width: vw, height: 900 }, serviceWorkers: 'block' }); const pg = await ctx.newPage();
            const errs = []; pg.on('pageerror', e => errs.push(e.message));
            await pg.route('**/api/**', r => r.request().method() !== 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) : r.continue());
            await pg.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [jwt.sign(U[who], SECRET, { expiresIn: '1h' }), U[who]]);
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' }); await sleep(2500);
            await pg.evaluate(() => switchPage('agent-office')); await sleep(4500);
            const d = await pg.evaluate(() => { const ul = document.querySelector('.desk-todo'); const panel = [...document.querySelectorAll('.desk-panel')].find(p => /지금 챙길 일/.test(p.textContent)); const lis = ul ? [...ul.querySelectorAll('li')] : []; return { panel: !!panel, empty: panel ? !!panel.querySelector('.desk-empty') : null, n: lis.length, rows: lis.map(li => ({ b: li.querySelector('b').textContent, t: li.querySelector('span').textContent.slice(0, 26), over: li.scrollWidth > li.clientWidth + 1 })), pOver: panel ? panel.scrollWidth > panel.clientWidth + 1 : null, docOver: document.documentElement.scrollWidth > innerWidth + 1 }; });
            console.log('—', who, vw, JSON.stringify(d.rows.map(r => r.b + ':' + r.t)));
            if (who === '대표') { ok(d.n >= 1 && d.rows.every(r => r.b && r.t), `대표 ${vw}px = 할 일 ${d.n}줄(실DB 열린 항목 — 줄 수는 그때그때 다름)`); ok(!d.rows.some(r => r.over) && !d.pOver && !d.docOver, `대표 ${vw}px = 줄·칸·화면 가로 넘침 없음`); }
            else ok(d.panel && !d.rows.some(r => /행사 종료|자사몰 채팅|총괄에게/.test(r.t)), `${who} = 대표 할 일 안 보임(${d.n}줄${d.empty ? ' · 「챙길 일이 없어요」' : ''})`);
            ok(errs.length === 0, `${who} ${vw}px 화면 오류 ${errs.length}${errs[0] ? ' — ' + errs[0].slice(0, 100) : ''}`);
            await ctx.close();
        }
    } catch (e) { fail++; console.log('ERR', e.message.split('\n')[0]); }
    finally { if (br) await br.close(); srv.kill(); }
    console.log(`\n#564: ${pass} 통과 / ${fail} 실패`); process.exit(fail ? 1 : 0);
})();
