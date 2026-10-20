// #799 화면 실클릭 — 에이전트 오피스 「내 지시」에서 처리 중·순서 대기 대화에도 [채팅 종료] → /end → 종결 · 질문 = 종전 /close · 끝난 대화 = 종전 그대로
//   로컬 서버 = 실DB 「읽기 전용」(scripts/ro-preload-711.js · 쓰기 문장 전부 삼킴 · 타이머 0) · 포트 PORT799(기본 3458)
//   지시 목록은 가짜(브라우저에서 응답을 바꿔 끼움 · 시험 번호 계정 990799) · 화면의 모든 쓰기 요청(POST)은 브라우저에서 가로채 기록만(실DB 쓰기 0)
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT799) || 3458;
const USER = { id: 990799, name: '시험799', position: '사원', role: 'user' };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const env = { ...process.env, JWT_SECRET: 'verify799', PORT: String(PORT), LUCKY_TABLE: 'lucky_events_v799' };
    delete env.ANTHROPIC_API_KEY; delete env.RENDER;
    const logF = path.join(os.tmpdir(), 'v799-server.log');
    const srv = spawn(process.execPath, ['-r', path.join(ROOT, 'scripts', 'ro-preload-711.js'), 'server.js'], { cwd: ROOT, env, stdio: ['ignore', fs.openSync(logF, 'w'), fs.openSync(logF + '.err', 'w')], windowsHide: true });
    console.log('로컬 서버 pid', srv.pid, '(끝나면 이 pid 로 내림)');
    let browser;
    try {
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('서버가 안 뜸 — ' + logF);
        ok(/실DB 읽기 전용/.test(fs.readFileSync(logF, 'utf8')), '로컬 서버 = 읽기 전용 preload 로 떠 있음');
        const now = new Date().toISOString();
        const mk = (id, status, content, result) => ({ id, content, status, result, run_id: null, created_at: now, processed_at: status === '처리중' || status === '대기' ? null : now, created_by: USER.name, created_by_id: USER.id, mine_hidden: false, hist_hidden: false, has_image: false, reply_to: null });
        const P = 9799001, W = 9799002, Q = 9799003, D = 9799004;
        const store = new Map([
            [P, mk(P, '처리중', '[시험799] 메일 계산서 찾아줘(처리 중)', { type: 'live', text: '메일 찾는 중…' })],
            [W, mk(W, '대기', '[시험799] 아침 정리(순서 대기)', null)],
            [Q, mk(Q, '질문', '[시험799] 정산 올려줘(되묻기)', { type: 'clarify', question: '[시험799] 저장할까요?' })],
            [D, mk(D, '완료', '[시험799] 끝난 대화', { type: 'desk_answer', answer: '[시험799] 답이에요.' })],
        ]);
        const posts = [];
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
        const pg = await ctx.newPage(); const errors = [];
        pg.on('pageerror', e => errors.push(String(e).slice(0, 160)));
        pg.on('dialog', d => d.dismiss().catch(() => { }));
        await pg.route('**/api/**', async route => {
            const rq = route.request(), u = new URL(rq.url());
            if (u.pathname === '/api/auth/me') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: USER.id, username: 'test799', name: USER.name, position: USER.position, color: '#4F46E5', role: 'user', annualLeave: 0, hasSignature: false }) });
            if (rq.method() === 'GET' && u.pathname === '/api/agent-office/desk/orders') {
                const mine = u.searchParams.get('mine') === '1';
                const list = [...store.values()].filter(o => !(mine && o.mine_hidden));
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: list }) });
            }
            if (rq.method() !== 'GET') {   // 쓰기 = 기록만(가짜 상태 바꿈) · 실서버로 안 감
                const m = u.pathname.match(/^\/api\/agent-office\/orders\/(\d+)\/(end|close|hide-mine)$/);
                posts.push(rq.method() + ' ' + u.pathname.replace('/api/agent-office/orders/', ''));
                if (m) {
                    const o = store.get(Number(m[1]));
                    if (o && m[2] === 'end') { if (!['대기', '처리중', '질문'].includes(o.status)) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"x"}' }); o.result = { type: 'closed_by_user', text: '사람이 종료했어요(시험799)', from: o.status }; o.status = '질문종결'; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: '종료했어요', was: o.result.from }) }); }
                    if (o && m[2] === 'close') { o.status = '질문종결'; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' }); }
                    if (o && m[2] === 'hide-mine') { o.mine_hidden = true; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' }); }
                }
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
            }
            return route.fallback();
        });
        const jwt = require('jsonwebtoken');
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); localStorage.removeItem('akm_desk_view'); }, [jwt.sign(USER, 'verify799', { expiresIn: '30m' }), USER]);
        await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(2500);
        await pg.evaluate(() => { const t = document.querySelector('#desk-tabs .desk-tab[data-tab="mine"]'); if (t) t.click(); }); await pg.waitForTimeout(1500);
        const toasts = []; await pg.exposeFunction('__toast', t => toasts.push(t));
        await pg.evaluate(() => { const mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && /toast/i.test(n.className || '')) window.__toast(n.textContent.trim()); }))); mo.observe(document.body, { childList: true, subtree: true }); });
        const endBtn = id => pg.locator(`#desk-list [data-act="endchat"][data-id="${id}"]`);
        for (const [id, name] of [[P, '처리 중'], [W, '순서 대기'], [Q, '질문'], [D, '끝난 대화']]) ok(await endBtn(id).count() === 1, `${name} 대화에 [채팅 종료] 보임`);
        ok(await pg.locator('#desk-list .desk-h-note', { hasText: '처리 중이라 끝난 뒤 종료할 수 있어요' }).count() === 0, '「처리 중이라 끝난 뒤 종료」 안내 없음(이제 누를 수 있음)');
        // 처리 중 → 채팅 종료 → 종료하기(실클릭 · 손가락)
        const tapEnd = async id => {
            await endBtn(id).scrollIntoViewIfNeeded(); await endBtn(id).tap();
            const y = pg.locator(`#desk-list [data-act="hidethread"][data-id="${id}"]`); await y.waitFor({ timeout: 5000 }); const note = await pg.locator('#desk-list .desk-end-ask .desk-end-stop').count(); await y.tap(); await pg.waitForTimeout(900); return note;
        };
        posts.length = 0; ok(await tapEnd(P) === 1, '처리 중 종료 확인 자리에 「창구가 하던 일을 멈추고 다음 지시로 넘어가요」');
        ok(posts[0] === `POST ${P}/end` && posts[1] === `POST ${P}/hide-mine` && posts.length === 2, `처리 중 = /end → /hide-mine (${posts.join(' · ')})`);
        ok(store.get(P).status === '질문종결' && store.get(P).result.type === 'closed_by_user', '처리 중 → 종결(사람이 종료)');
        ok(await pg.locator(`#desk-list [data-oid="${P}"]`).count() === 0, '내 지시에서 그 대화 사라짐');
        ok(toasts.some(t => /하던 일을 멈추고 다음 지시로/.test(t)), '토스트 「창구가 하던 일을 멈추고 다음 지시로 넘어가요」');
        posts.length = 0; ok(await tapEnd(W) === 1, '순서 대기 종료 확인 자리에도 같은 한 줄');
        ok(posts[0] === `POST ${W}/end` && posts[1] === `POST ${W}/hide-mine`, `순서 대기 = /end → /hide-mine (${posts.join(' · ')})`);
        ok(store.get(W).status === '질문종결', '순서 대기 → 바로 종결(집히지 않음)');
        posts.length = 0; ok(await tapEnd(Q) === 0, '질문 종료 확인엔 그 줄 없음(종전 그대로)');
        ok(posts[0] === `POST ${Q}/close` && posts[1] === `POST ${Q}/hide-mine` && !posts.some(p => /end$/.test(p)), `질문 = 종전 /close → /hide-mine (${posts.join(' · ')})`);
        posts.length = 0; ok(await tapEnd(D) === 0, '끝난 대화 종료 확인엔 그 줄 없음');
        ok(posts.length === 1 && posts[0] === `POST ${D}/hide-mine`, `끝난 대화 = 종전 /hide-mine 만 (${posts.join(' · ')})`);
        await pg.waitForTimeout(1500);
        ok(await pg.locator('#desk-list [data-act="endchat"]').count() === 0, '다시 불러와도 종료한 대화 안 돌아옴');
        ok(errors.length === 0, '화면 오류 0' + (errors.length ? ' — ' + errors.join(' | ') : ''));
        const blocked = (fs.readFileSync(logF, 'utf8').match(/쓰기 차단/g) || []).length;
        console.log('  (참고) 로컬 서버가 삼킨 쓰기 문장 ' + blocked + '건(기동 initDB·복구 등 — 실DB 반영 0)');
    } catch (e) { fail++; console.log('  ❌ ERR ' + (e.stack || e.message)); }
    finally {
        if (browser) await browser.close().catch(() => { });
        try { process.kill(srv.pid); } catch (_) { }
        await sleep(800);
        let alive = true; try { process.kill(srv.pid, 0); } catch (_) { alive = false; }
        console.log('로컬 서버 pid ' + srv.pid + (alive ? ' 아직 살아 있음 ❌' : ' 내림 ✅'));
    }
    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})();
