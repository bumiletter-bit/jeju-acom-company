// #483 검증: 문의 관리 > 판매현황·가격 — 품목별 묶음 표시(화면만) · 행 수·저장 흐름 무회귀
//   node scripts/verify-483-botprod-group.js   (로컬 실서버 3457 자동 기동 · 실DB 읽기 · 저장은 가로채 DB 무변경)
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const { Client } = require('pg');
const PORT = 3457, ROOT = path.join(__dirname, '..');
const results = [];
const ok = (n, p, note) => { results.push(p); console.log((p ? '✅' : '❌') + ' ' + n + (note ? ' — ' + note : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}});require('./server.js')`],
        { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'v483.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'v483.err'), 'w')] });
    let browser;
    try {
        let up = false; for (let i = 0; i < 60 && !up; i++) { await sleep(1000); try { await fetch(`http://localhost:${PORT}/`); up = true; } catch (_) { } }
        ok('로컬 실서버 기동', up); if (!up) throw new Error('server not up');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const n = Number((await db.query(`SELECT count(*) FROM bot_products WHERE deleted_at IS NULL`)).rows[0].count);
        await db.end();
        const user = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' };
        const tok = jwt.sign(user, 'verifytest', { expiresIn: '20m' });
        browser = await chromium.launch();
        const pg = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errs = []; pg.on('pageerror', e => errs.push(String(e)));
        await pg.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', u); }, [tok, JSON.stringify(user)]);
        const puts = [];
        await pg.route('**/api/agent-office/bot-products/*', r => { if (r.request().method() === 'PUT') { puts.push(r.request().postDataJSON()); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok', product: {} }) }); } return r.continue(); });
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await sleep(2500);
        await pg.evaluate(() => { switchPage('inquiry'); });
        await sleep(800);
        await pg.click('#inquiry-tab-btn-products');
        await pg.waitForSelector('#botprod-list tr[id^="botprod-row-"]', { timeout: 20000 });
        const v = await pg.evaluate(() => {
            const trs = Array.from(document.querySelectorAll('#botprod-list tbody tr'));
            const groups = []; let cur = null;
            for (const tr of trs) {
                if (tr.classList.contains('bp-group')) { cur = { name: tr.textContent.trim(), rows: [] }; groups.push(cur); }
                else if (cur) cur.rows.push({ name: tr.querySelector('td').firstChild.textContent.trim(), status: (tr.querySelector('[data-bp-status].btn-primary') || {}).textContent });
            }
            return { rows: trs.filter(t => t.id.startsWith('botprod-row-')).length, groups };
        });
        ok('행 수 = 판매현황 전체(빠지거나 겹친 것 0)', v.rows === n, `${v.rows}/${n}`);
        const base = s => { s = String(s).trim(); if (s.includes(' / ')) return s.split(' / ')[0].trim(); return s.replace(/^[^:]{1,20}:\s*/, '').replace(/\s*\d+(\.\d+)?\s*kg.*$/i, '').trim() || s; };
        const allSameGroup = v.groups.every(g => g.rows.every(r => g.name.startsWith(base(r.name).replace(/\s+/g, ' ')) || g.name.includes(base(r.name))));
        const badG = v.groups.filter(g => !g.rows.every(r => g.name.startsWith(base(r.name) + ' '))).map(g => g.name.slice(0, 30));
        ok('묶음마다 같은 품목만(이름의 「 / 」 앞이 같음)', badG.length === 0, v.groups.length + '묶음 ' + badG.join(' | '));
        const ord = { '준비중': 0, '판매중': 1, '품절': 2 };
        const inOrder = v.groups.every(g => g.rows.every((r, i) => i === 0 || (ord[g.rows[i - 1].status] ?? 3) <= (ord[r.status] ?? 3)));
        ok('묶음 안 순서 = 준비중 → 판매중 → 품절 → 시즌종료', inOrder);
        const act = g => g.rows.some(r => r.status === '준비중' || r.status === '판매중');
        const firstInactive = v.groups.findIndex(g => !act(g));
        ok('파는 중인 품목 묶음이 위 · 품절·시즌종료만 남은 묶음이 아래', firstInactive === -1 || v.groups.slice(firstInactive).every(g => !act(g)), v.groups.map(g => (act(g) ? '●' : '○')).join(''));
        const hdr = v.groups[0] && v.groups[0].name;
        ok('묶음 머리글에 개수·상태별 개수', /\d+개 · /.test(hdr || ''), hdr);
        // 저장 흐름 무회귀: 가격을 고치면 그 행의 [저장]만 켜지고, 누르면 PUT 1회(가로채기)
        const id = await pg.evaluate(() => document.querySelector('#botprod-list tr[id^="botprod-row-"]').id.replace('botprod-row-', ''));
        const before = await pg.inputValue(`#botprod-price-${id}`);
        await pg.fill(`#botprod-price-${id}`, before + '1');
        const en = await pg.evaluate(i => !document.getElementById('botprod-save-' + i).disabled, id);
        await pg.click(`#botprod-save-${id}`);
        await sleep(800);
        ok('가격 수정 → 그 행 [저장] 켜짐 → 저장 요청 1회(가로챔 · DB 무변경)', en && puts.length === 1 && puts[0].price === before + '1', JSON.stringify(puts[0] || {}).slice(0, 80));
        ok('페이지 오류 0', errs.length === 0, errs.slice(0, 2).join(' | '));
    } catch (e) { ok('검증 중 예외 없음', false, e.message); }
    finally { try { await browser && browser.close(); } catch (_) { } srv.kill(); }
    console.log(`\n결과 ${results.filter(Boolean).length}/${results.length}`);
    process.exit(results.every(Boolean) ? 0 : 1);
})();
