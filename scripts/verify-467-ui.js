// #467 검증(실렌더): 당첨 지급 탭 「쿠폰·알림」 칸·[🎫 발급+안내] 버튼 · 알림 이력 채널 「룰렛」 필터 · 타이머 라벨 · 기존 채널 무회귀
//   로컬 실서버(3457·setInterval 무력화·실DB 읽기만) + Playwright. 🔴 발급 POST·지급 PUT은 라우트 가로채기 = 실DB·카페24 무변경.
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path');
const PORT = 3457;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };
(async () => {
    let srv = null, browser = null;
    try {
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: 'ignore' });
        let up = false;
        for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 1000)); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' LIMIT 1`)).rows[0];
        const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='reward_grants'`)).rows.map(r => r.column_name);
        const timer = (await db.query(`SELECT key, enabled, run_at_time FROM naver_auto_collect WHERE key='coupon_expire_notify'`)).rows[0];
        await db.end();
        ok('DB additive 컬럼 11종·타이머 시드(10:00·ON)', ['coupon_no', 'issue_no', 'issued_at', 'expires_at', 'used_at', 'used_order_id', 'notify_issue_status', 'notify_issue_at', 'notify_expire_status', 'notify_expire_at', 'grant_error'].every(c => cols.includes(c)) && timer && timer.run_at_time === '10:00' && timer.enabled === true, JSON.stringify(timer));
        const token = jwt.sign({ id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, 'verifytest', { expiresIn: '15m' });
        const H = { Authorization: 'Bearer ' + token };
        // API: 목록에 새 컬럼 · 이력 ch=coupon · 타이머 목록
        const gl = await (await fetch(`http://localhost:${PORT}/api/agent-office/reward-grants?status=all`, { headers: H })).json();
        ok('reward-grants API = 새 컬럼 동봉·pending 0', Array.isArray(gl.grants) && gl.grants.length >= 7 && 'expires_at' in gl.grants[0] && 'notify_issue_status' in gl.grants[0] && gl.pending === 0, `${gl.grants.length}건`);
        const nl = await (await fetch(`http://localhost:${PORT}/api/agent-office/notify-logs?ch=coupon&fast=1&period=all`, { headers: H })).json();
        const nlN = await (await fetch(`http://localhost:${PORT}/api/agent-office/notify-logs?ch=naver&fast=1`, { headers: H })).json();
        ok('알림 이력 ch=coupon 200(룰렛 행만) · ch=naver 무회귀', Array.isArray(nl.rows) && nl.rows.every(r => /^coupon(-exp)?:/.test(String(r.order_key))) && Array.isArray(nlN.rows) && nlN.rows.every(r => !/^(c24|cp|join|coupon|coupon-exp):/.test(String(r.order_key))), `룰렛 ${nl.rows.length}건 · 네이버 ${nlN.rows.length}건`);
        const tm = await (await fetch(`http://localhost:${PORT}/api/agent-office/naver/auto-collect`, { headers: H })).json();
        ok('타이머 목록에 coupon_expire_notify', (tm.timers || []).some(t => t.key === 'coupon_expire_notify'));
        // POST grant 가드(비쿠폰·이미 처리) — 실DB 무변경 경로만
        const granted = gl.grants.find(g => g.status === 'granted' && /^coupon/.test(g.kind));
        const r409 = await fetch(`http://localhost:${PORT}/api/agent-office/reward-grants/${granted.id}/grant`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' });
        const up5 = gl.grants.find(g => g.kind === 'upgrade');
        const r400 = up5 ? await fetch(`http://localhost:${PORT}/api/agent-office/reward-grants/${up5.id}/grant`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' }) : { status: 400 };
        ok('발급 POST 가드 = 이미 처리 409 · 쿠폰 아님 400(카페24 호출 0)', r409.status === 409 && r400.status === 400);

        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const pg = await browser.newPage();
        const errors = [], posted = [], puts = [];
        pg.on('pageerror', e => errors.push(String(e)));
        pg.on('dialog', d => d.accept());
        // 목록 응답에 가짜 미지급 쿠폰 행 1개 주입(실DB 무변경) + 발급 POST·PUT 가로채기
        await pg.route('**/api/agent-office/reward-grants?*', async route => {
            const res = await route.fetch(); const j = await res.json();
            j.grants.unshift({ id: 999999, kind: 'coupon10', amount: 1, status: 'pending', created_at: new Date().toISOString(), member_key: 'test@n', nickname: '테스트', grant_error: null });
            j.grants.unshift({ id: 999998, kind: 'coupon5', amount: 1, status: 'pending', created_at: new Date().toISOString(), member_key: 'fail@n', nickname: null, grant_error: '발급 후 보유 0장(기대 1) — 지급완료 표시 안 함' });
            j.pending = 2;
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
        });
        await pg.route('**/api/agent-office/reward-grants/*/grant', route => { posted.push(route.request().url()); route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"발급을 시작했습니다(테스트 가로채기)"}' }); });
        await pg.route('**/api/agent-office/reward-grants/*', route => { if (route.request().method() === 'PUT') { puts.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' }); } route.continue(); });
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [token, { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }]);
        await pg.reload({ waitUntil: 'networkidle' });
        await pg.waitForTimeout(2500);
        await pg.evaluate(() => { const h = setInterval(() => {}, 1e9); for (let i = 1; i <= h; i++) clearInterval(i); });
        await pg.evaluate(() => switchPage('inquiry'));
        await pg.waitForTimeout(600);
        await pg.evaluate(() => switchInquiryTab('reward'));
        await pg.waitForFunction(() => document.querySelectorAll('#reward-list tbody tr').length > 0, null, { timeout: 15000 });
        const st = await pg.evaluate(() => {
            const ths = [...document.querySelectorAll('#reward-list thead th')].map(t => t.textContent.trim());
            const rows = [...document.querySelectorAll('#reward-list tbody tr')].map(tr => ({ txt: tr.textContent.replace(/\s+/g, ' ').trim(), btns: [...tr.querySelectorAll('button')].map(b => b.textContent.trim()) }));
            return { ths, rows, h2: document.querySelector('#inquiry-tab-reward h2').textContent };
        });
        ok('당첨 지급 탭 = 「쿠폰·알림」 헤더 7칸 · 설명 문구 갱신', st.ths.length === 7 && st.ths[5] === '쿠폰·알림' && /자동 발급/.test(st.h2), st.ths.join('|'));
        const pend = st.rows.find(r => /test@n/.test(r.txt)), pendFail = st.rows.find(r => /fail@n/.test(r.txt));
        ok('미지급 쿠폰 행 = [🎫 발급+안내] + [수동 지급완료] · 자동 발급 대기 표기', !!pend && pend.btns[0] === '🎫 발급+안내' && pend.btns[1] === '수동 지급완료' && /자동 발급 대기/.test(pend.txt));
        ok('자동 발급 실패 행 = ⚠️ 사유 표기', !!pendFail && /자동 발급 실패/.test(pendFail.txt) && /보유 0장/.test(pendFail.txt));
        await pg.evaluate(() => switchRewardSub('all'));
        await pg.waitForFunction(() => document.querySelectorAll('#reward-list tbody tr').length > 5, null, { timeout: 15000 });
        const all = await pg.evaluate(() => [...document.querySelectorAll('#reward-list tbody tr')].map(tr => ({ txt: tr.textContent.replace(/\s+/g, ' ').trim(), btns: [...tr.querySelectorAll('button')].map(b => b.textContent.trim()) })));
        const g7 = all.find(r => /3354900610@n/.test(r.txt) && /10% 할인/.test(r.txt)), gUp = all.find(r => /업그레이드/.test(r.txt));
        ok('지급완료 쿠폰 행 = 만료·발급안내 표기 + [되돌리기] · 업그레이드 행 = 「—」', !!g7 && /만료 \d\d\/\d\d|쿠폰번호 없음/.test(g7.txt) && /발급안내/.test(g7.txt) && g7.btns[0] === '되돌리기' && !!gUp && /—/.test(gUp.txt), g7 && g7.txt.slice(0, 120));
        // 실클릭: [🎫 발급+안내] → confirm 수락 → POST 가로채기 1회 · [수동 지급완료] → PUT 1회
        await pg.evaluate(() => switchRewardSub('pending'));
        await pg.waitForFunction(() => [...document.querySelectorAll('#reward-list button')].some(b => b.textContent.includes('발급+안내')), null, { timeout: 15000 });
        await pg.click('#reward-list tr:has-text("test@n") button:has-text("발급+안내")');
        await pg.waitForTimeout(800);
        await pg.click('#reward-list tr:has-text("test@n") button:has-text("수동 지급완료")');
        await pg.waitForTimeout(800);
        ok('실클릭 = 발급 POST 1회(/999999/grant) · 수동 지급 PUT 1회 · 실DB 무변경', posted.length === 1 && /999999\/grant$/.test(posted[0]) && puts.length === 1 && /999999$/.test(puts[0]));
        // 알림 이력 탭 채널 필터 「룰렛」 · 타이머 라벨
        await pg.evaluate(() => switchInquiryTab('notify'));
        await pg.waitForTimeout(1500);
        const nf = await pg.evaluate(() => { const s = document.getElementById('notify-log-ch'); return s ? [...s.options].map(o => o.value + ':' + o.textContent.trim()) : null; });
        ok('알림 이력 채널 필터에 🎡 룰렛', !!nf && nf.some(o => o === 'coupon:🎡 룰렛'), nf && nf.join(' '));
        await pg.evaluate(() => switchPage('data'));
        await pg.waitForTimeout(2500);
        const tl = await pg.evaluate(() => [...document.querySelectorAll('td')].map(t => t.textContent.trim()).filter(t => /룰렛 · 쿠폰 만료/.test(t)));
        ok('타이머 카드 라벨 = 🎡 룰렛 · 쿠폰 만료 7일 전 안내 + 검수중 표기', tl.length === 1 && /검수중/.test(tl[0]), tl[0]);
        ok('페이지 에러 0', errors.length === 0, errors[0]);
    } catch (e) { ok('예외 없음', false, String(e && e.message || e)); }
    finally { if (browser) await browser.close(); if (srv) srv.kill(); }
    const fail = results.filter(r => !r.pass).length;
    console.log(`\n결과: ${results.length - fail}/${results.length}${fail ? ' — 실패 ' + fail : ''}`);
    process.exit(fail ? 1 : 0);
})();
