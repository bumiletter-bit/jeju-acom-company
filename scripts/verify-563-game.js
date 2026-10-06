// #563 검증: 데이터관리 > 게임 운영 설정 — 「업그레이드 이용권(주문 중량 → 상향 발송 중량)」 표 제거
//   사용: node scripts/verify-563-game.js
//   로컬 실서버 3461(스케줄러 차단) · 설정은 실서버에서 한 번 읽어(읽기) 두 화면에 같은 값을 내려 준다 · 저장(PUT)은 가로채 본문만 받는다 → DB 쓰기 0.
//   「종전」 = git HEAD 의 public/app.js 를 끼운 화면 · 「지금」 = 작업 트리. 같은 조작을 하고 나가는 저장 본문을 비교한다.
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT563) || 3461;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + String(note).slice(0, 600) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'game563-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'game563-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        await db.end();
        const user = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' };
        const tok = jwt.sign(user, 'verifytest', { expiresIn: '30m' });
        const live = await (await fetch(`http://localhost:${PORT}/api/agent-office/mall-game-config`, { headers: { Authorization: 'Bearer ' + tok } })).json();
        ok('실제 설정 읽음(읽기만) — 확률 ' + ((live.config && live.config.probabilities) || []).length + '칸 · upgrade_map ' + ((live.config && live.config.upgrade_map) || []).length + '줄', !!live.config && Array.isArray(live.config.upgrade_map) && live.config.upgrade_map.length > 0, JSON.stringify(live.config && live.config.upgrade_map));
        const OLD_APP = execFileSync('git', ['show', 'HEAD:public/app.js'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
        ok('종전 app.js(git HEAD)에는 표 코드가 있음 · 지금 app.js 에는 없음', /mg-up-from-/.test(OLD_APP) && !/mg-up-from-|upRows|\bupN\b/.test(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8')));

        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const open = async old => {
            const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block' });
            const pg = await ctx.newPage(); const errors = [], puts = [], dialogs = [];
            pg.on('pageerror', e => errors.push(String(e)));
            pg.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
            await pg.route('**/api/**', route => {
                const rq = route.request(), p = new URL(rq.url()).pathname;
                if (p === '/api/agent-office/mall-game-config') {
                    if (rq.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(live) });
                    puts.push(JSON.parse(rq.postData() || 'null'));
                    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, config: live.config }) });
                }
                if (rq.method() === 'GET') return route.continue();
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
            });
            if (old) await pg.route('**/app.js*', route => route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: OLD_APP }));
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'data'); }, [tok, user]);
            await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(2500);
            await pg.addStyleTag({ content: '.ao-settle-overlay{display:none!important}' });
            await pg.waitForSelector('#mall-game-config #mg-percent-0', { timeout: 20000 });
            return { pg, ctx, errors, puts, dialogs };
        };
        const snap = pg => pg.evaluate(() => { const el = document.getElementById('mall-game-config');
            return { text: el.innerText, ids: Array.from(el.querySelectorAll('input')).map(i => i.id), vals: Object.fromEntries(Array.from(el.querySelectorAll('input')).map(i => [i.id, i.value])), heads: Array.from(el.querySelectorAll('h3')).map(h => h.textContent.trim()), tables: el.querySelectorAll('table').length, btns: Array.from(el.querySelectorAll('button')).map(b => b.textContent.trim()), sum: document.getElementById('mg-sum').textContent.trim(), card: document.getElementById('mall-game-card').getClientRects().length > 0 }; });
        const save = async P => { const n = P.puts.length; await P.pg.click('#mall-game-config button.btn-primary'); await P.pg.waitForTimeout(900); return P.puts.length > n ? P.puts[P.puts.length - 1] : null; };
        const S = o => JSON.stringify(o);
        // 키 순서를 무시한 비교(같은 값인지) — 종전 화면은 upgrade_map 줄을 { from, to } 로 다시 만들었고, 지금은 DB 가 준 순서({ to, from }) 그대로 보낸다
        const C = o => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v);

        const O = await open(true), N = await open(false);
        const so = await snap(O.pg), sn = await snap(N.pg);
        ok('종전 화면에는 표가 있었음(시험이 옛 코드를 실제로 띄움) — 표 2개 · 입력칸 ' + so.ids.length, so.tables === 2 && so.ids.some(i => /^mg-up-/.test(i)) && /상향 발송 중량/.test(so.text));
        ok('지금 화면 = 게임 설정 카드 보임 · 「업그레이드 이용권 — 주문 중량 → 상향 발송 중량」 머리글·표 없음(표 1개 = 확률표)', sn.card && sn.tables === 1 && !/상향 발송 중량/.test(sn.text) && !sn.ids.some(i => /^mg-up-/.test(i)) && !sn.heads.some(h => /업그레이드 이용권/.test(h)), sn.heads.join(' | '));
        ok('룰렛 경품 「업그레이드 이용권」 줄은 확률표에 그대로', Object.entries(sn.vals).some(([k, v]) => /^mg-label-/.test(k) && v === '업그레이드 이용권'));
        const rest = so.ids.filter(i => !/^mg-up-/.test(i));
        ok('나머지 입력칸 ' + sn.ids.length + '개 = 종전과 같은 칸·같은 값(순서 포함)', S(rest) === S(sn.ids) && rest.every(i => so.vals[i] === sn.vals[i]), rest.filter(i => so.vals[i] !== sn.vals[i]).join());
        ok('머리글 = 종전에서 「업그레이드 이용권」 한 줄만 빠짐', S(so.heads.filter(h => !/업그레이드 이용권/.test(h))) === S(sn.heads) && so.heads.length - sn.heads.length === 1, sn.heads.join(' | '));
        ok('확률 합계 표시 그대로(「' + sn.sum + '」) · 버튼 = 저장 · 대표 확정값으로 복원', sn.sum === so.sum && /100\.0%/.test(sn.sum) && S(sn.btns) === S(so.btns) && S(sn.btns) === S(['저장', '대표 확정값으로 복원']), sn.btns.join());

        // ① 아무것도 안 바꾸고 [저장]
        let a = await save(O), b = await save(N);
        ok('① 그대로 [저장] → 저장 요청이 한 번 나감(종전·지금 모두)', !!a && !!b && O.dialogs.length === 0 && N.dialogs.length === 0, [O.dialogs.join(), N.dialogs.join()].join(' / '));
        ok('① 나가는 본문이 종전과 같음(키 ' + (b && b.config ? Object.keys(b.config).length : 0) + '개 전부 같은 값 · 바깥 키 순서도 같음 · 다른 점 = upgrade_map 줄 안의 from/to 적힌 순서뿐)', !!a && !!b && C(a) === C(b) && S(Object.keys(a.config)) === S(Object.keys(b.config)) && S(Object.assign({}, a.config, { upgrade_map: 0 })) === S(Object.assign({}, b.config, { upgrade_map: 0 })), b && b.config ? Object.keys(b.config).join() : '');
        ok('① upgrade_map = 받아 둔 값 그대로 다시 나감', !!b && S(b.config.upgrade_map) === S(live.config.upgrade_map), b && S(b.config.upgrade_map));
        const drift = b ? Object.keys(live.config).filter(k => !(k in b.config)) : ['?'];
        ok('① 받은 설정의 키가 본문에 전부 들어 있음(안 보내 기본값으로 돌아갈 칸 0)', drift.length === 0, drift.join());
        // ② 값 몇 개를 바꾸고 [저장] — 두 화면에 같은 조작
        for (const P of [O, N]) { await P.pg.fill('#mg-tree-goal', '120'); await P.pg.fill('#mg-coupon-days', '45'); await P.pg.fill('#mg-phys-limit', '20'); await P.pg.fill('#mg-points-0', '3'); }
        a = await save(O); b = await save(N);
        ok('② 값 4개를 바꾼 뒤 [저장] → 본문이 종전과 같음 · 바꾼 값이 실림', !!a && !!b && C(a) === C(b) && S(Object.assign({}, a.config, { upgrade_map: 0 })) === S(Object.assign({}, b.config, { upgrade_map: 0 })) && b.config.tree_goal_water === 120 && b.config.coupon_valid_days === 45 && b.config.physical_monthly_limit === 20 && b.config.probabilities[0].points === 3 && S(b.config.upgrade_map) === S(live.config.upgrade_map));
        // ③ 합계가 100이 아니면 막힘(종전과 같음)
        for (const P of [O, N]) { const v = await P.pg.inputValue('#mg-percent-0'); await P.pg.fill('#mg-percent-0', String(Number(v) + 1)); }
        const n0 = O.puts.length, n1 = N.puts.length; a = await save(O); b = await save(N);
        const sum2 = await N.pg.evaluate(() => document.getElementById('mg-sum').textContent.trim());
        ok('③ 확률 합계가 100%가 아니면 저장 안 나감 · 알림창 · 합계 줄 경고(종전과 같음)', !a && !b && O.puts.length === n0 && N.puts.length === n1 && O.dialogs.length === 1 && N.dialogs.length === 1 && /101\.0%/.test(sum2), sum2);
        // ④ [대표 확정값으로 복원] — 확인창을 닫으면(취소) 아무것도 안 나감
        await N.pg.click('#mall-game-config button.btn-outline'); await N.pg.waitForTimeout(500);
        ok('④ [대표 확정값으로 복원] 클릭 → 확인창 뜸 · 취소하면 요청 0', N.dialogs.length === 2 && N.puts.length === n1, N.dialogs.slice(-1).join());
        ok('화면 오류 0(지금 화면)', N.errors.length === 0, N.errors.join(' | '));
        await O.ctx.close(); await N.ctx.close();
    } catch (e) { ok('실행 오류 없음', false, e && e.stack ? e.stack.split('\n').slice(0, 8).join(' / ') : String(e)); }
    finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) srv.kill();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
    }
})();
