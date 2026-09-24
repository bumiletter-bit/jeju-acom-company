// #468 검증(실렌더): 정산현황 달력 대조 표시·상세 카드·저장 후 갱신·알림 링크 탭 이동 · 기존 입력 표 무회귀
//   로컬 실서버(3457·setInterval 무력화·실DB 읽기만) + Playwright. 🔴 대조 API는 가짜 행으로 가로채기 · 저장 POST 가로채기 = 실DB 무변경.
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
        const tbl = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='naver_settle_recon'`)).rows[0].n;
        const admins = (await db.query(`SELECT id, name FROM users WHERE role='admin' AND deleted_at IS NULL ORDER BY id`)).rows;
        await db.end();
        ok('DB 테이블 naver_settle_recon 생성(컬럼 29) · 활성 관리자 = 대표·조가영 2명', tbl === 29 && admins.length === 2, admins.map(a => a.name).join('·') + ` · cols ${tbl}`);
        const token = jwt.sign({ id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, 'verifytest', { expiresIn: '15m' });
        const H = { Authorization: 'Bearer ' + token };
        const api1 = await (await fetch(`http://localhost:${PORT}/api/agent-office/settle-recon`, { headers: H })).json();
        ok('대조 API 200 · rows 배열 · today', Array.isArray(api1.rows) && /^\d{4}-\d{2}-\d{2}$/.test(api1.today), `${api1.rows.length}행`);
        const noAuth = await fetch(`http://localhost:${PORT}/api/agent-office/settle-recon`);
        ok('대조 API 인증 필요(401/403)', noAuth.status === 401 || noAuth.status === 403);

        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const pg = await browser.newPage();
        const errors = [], posts = [];
        pg.on('pageerror', e => errors.push(String(e)));
        pg.on('dialog', d => d.accept());
        const fake = { today: '2026-09-24', rows: [
            { expect_date: '2026-09-18', basis_start: '2026-09-17', basis_end: '2026-09-17', complete_date: '2026-09-18', pay_amount: 34286100, commission: -2297807, benefit: -77700, return_care: -20000, deduction: 0, settle_amount: 31890593, case_total: 31890593, in_period: 31988293, in_period_count: 640, carried_in: 0, carried_in_count: 0, unknown_amount: 0, unknown_count: 0, pending_out_count: 3, input_sum: 34810387, input_dates: [{ date: '2026-09-17' }], diff1: 2822094, status: 'warn', detail: {} },
            { expect_date: '2026-09-21', basis_start: '2026-09-18', basis_end: '2026-09-20', complete_date: '2026-09-21', pay_amount: 68035900, commission: -4494017, benefit: -230900, return_care: -61350, deduction: -6700, settle_amount: 63242933, case_total: 63242933, in_period: 63541883, in_period_count: 1190, carried_in: 120000, carried_in_count: 3, unknown_amount: 0, unknown_count: 0, pending_out_count: 0, reversal: -66414, reversal_count: 2, input_sum: 63914574, input_dates: [{ date: '2026-09-18', scheduled: 23327884, unsettled: 292915 }, { date: '2026-09-20', scheduled: 23317068, unsettled: 40597506, used: true }], diff1: 372691, status: 'ok', detail: {} },
            { expect_date: '2026-09-22', basis_start: '2026-09-21', basis_end: '2026-09-21', complete_date: '2026-09-22', pay_amount: 25786800, commission: -1718277, benefit: -119009, return_care: -15800, deduction: 0, settle_amount: 23933714, case_total: 23933714, in_period: 24068523, in_period_count: 500, carried_in: 0, carried_in_count: 0, unknown_amount: 0, unknown_count: 0, pending_out_count: 0, input_sum: null, input_dates: [], diff1: null, status: 'no-input', detail: {} },
        ] };
        await pg.route('**/api/agent-office/settle-recon*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fake) }));
        await pg.route('**/api/settlement-status', route => { if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().postDataJSON()) }); } route.continue(); });
        await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [token, { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }]);
        await pg.reload({ waitUntil: 'networkidle' });
        await pg.waitForTimeout(2500);
        await pg.evaluate(() => { const h = setInterval(() => {}, 1e9); for (let i = 1; i <= h; i++) clearInterval(i); });
        // 알림 링크 방식으로 진입(page:tab) — 정산관리 → 정산현황 탭
        await pg.evaluate(() => { const nav = document.querySelector('.nav-item[data-page="settlement"]'); nav && nav.click(); });
        await pg.waitForTimeout(500);
        await pg.evaluate(() => { const tb = document.querySelector('.settlement-tab[data-tab="settlement-status"]'); tb && tb.click(); });
        await pg.waitForFunction(() => document.querySelectorAll('#ss-cal-wrap .ss-cal-cell').length > 20, null, { timeout: 15000 });
        await pg.evaluate(() => { ssCalYear = 2026; ssCalMonth = 8; ssRenderCalendar(); });
        const cal = await pg.evaluate(() => { const m = {}; document.querySelectorAll('#ss-cal-wrap .ss-cal-cell').forEach(c => { const n = c.querySelector('.ss-cal-num'); const b = c.querySelector('.ss-cal-recon'); if (n && b) m[n.textContent.trim()] = b.textContent.trim(); }); return m; });
        ok('달력 표시 = 17 ⚠️ · 18·20 ✅(묶음) · 19(토·행 없음) 표시 없음 · 21 📝(미입력) · 22 ⏳(넣은 값 있고 회차 전) · 23 표시 없음', cal['17'] === '⚠️' && cal['18'] === '✅' && !cal['19'] && cal['20'] === '✅' && cal['21'] === '📝' && cal['22'] === '⏳' && !cal['23'], JSON.stringify(cal));
        await pg.evaluate(() => ssSelectDate('2026-09-17'));
        await pg.waitForFunction(() => !!document.getElementById('ss-recon-card'), null, { timeout: 8000 });
        const c17 = await pg.evaluate(() => document.getElementById('ss-recon-card').innerText.replace(/\s+/g, ' '));
        ok('9/17 카드 = ⚠️ 차이 큼 배지 · 「실제와의 차이」 −2,919,794 큰 숫자 · 취소·이월 −2,822,094 ⚠️(세부: 넣은 값 34,810,387 − 정산 31,988,293) · 네이버 조정 −97,700(세부 아래 줄) · 취소·회수 −66,414 · 집화 대기 3건 · 합계 = 실제와의 차이 · 실입금 31,890,593',
            /9\/17\(목\) 발송분/.test(c17) && /⚠️ 차이 큼/.test(c17) && /실제와의 차이 넣은 값 34,810,387 → 실입금 31,890,593 −2,919,794/.test(c17) && /적게 들어옴/.test(c17)
            && /발주 후 취소·집화 이월 −2,822,094 ⚠️ 넣은 값 34,810,387 − 실제 정산 31,988,293\(640건\)/.test(c17) && /취소·이월 차이가 큽니다/.test(c17)
            && /네이버 조정 \(정산예정에 없는 사후 차감\) −97,700 리뷰 적립·등급 쿠폰 등 혜택 −77,700 · 반품안심케어 −20,000 · 공제 환급 0/.test(c17)
            && /집화 대기 \(다음 정산으로 넘어감\) 3건/.test(c17) && /합계 = 실제와의 차이 −2,919,794/.test(c17), c17.slice(0, 220));
        const tblRows = await pg.evaluate(() => document.querySelectorAll('#ss-wrap .ss-tbl:not(.ss-recon-tbl) tr').length);
        const inputVal = await pg.evaluate(() => document.querySelector('#ss-wrap input[oninput*="settlement_scheduled"]').value);
        ok('기존 정산 내역 표·입력값 무회귀(정산예정 34,810,387 그대로)', inputVal === '34,810,387' && tblRows >= 15, `rows ${tblRows}`);
        // 🔴 총 합계 무회귀(대표 9/24): 화면 총 합계 = 실DB 9/17 행을 기존 공식(ssCompute)으로 계산한 값 · 대조 카드가 합계 계산에 끼어들지 않음
        const ssApi = await (await fetch(`http://localhost:${PORT}/api/settlement-status`, { headers: H })).json();
        const row17 = ssApi.find(r => String(r.date).startsWith('2026-09-17'));
        const n = k => Number(row17[k]) || 0;
        const expectTotal = n('current_cash') + n('settlement_scheduled') + n('unsettled') + n('coupang_unpaid') + n('selfmall_unpaid') + n('ad_naver') + n('ad_gfa') - n('card_fee') - n('corp_card') - n('delivery') - n('hyodong') - n('daesong') - n('aewol');
        const shownTotal = await pg.evaluate(() => (document.querySelector('#ss-wrap .ss-sc.total') || {}).innerText || '');
        const calTotal = await pg.evaluate(() => { const c = [...document.querySelectorAll('#ss-cal-wrap .ss-cal-cell')].find(x => (x.querySelector('.ss-cal-num') || {}).textContent === '17'); return c ? c.querySelector('.ss-cal-amt').textContent : ''; });
        ok('총 합계 무회귀 = 기존 공식값과 동일 · 달력 금액 동일', shownTotal.replace(/[^0-9,\-]/g, '').includes(expectTotal.toLocaleString()) && calTotal === Math.round(expectTotal / 10000).toLocaleString() + '만', `${expectTotal.toLocaleString()} / 셀 ${calTotal}`);
        const cardCls = await pg.evaluate(() => { const c = document.getElementById('ss-recon-card'); return c.className + '|' + (c.querySelector('.ss-ch') ? 'ss-ch' : '') + '|' + (c.querySelector('table.ss-tbl') ? 'ss-tbl' : '') + '|inputs=' + c.querySelectorAll('input').length; });
        ok('디자인 = 기존 카드·제목·표 클래스 재사용 · 카드 안 입력칸 0(합계 계산 무접촉)', cardCls === 'ss-card|ss-ch|ss-tbl|inputs=0', cardCls);
        await pg.evaluate(() => ssSelectDate('2026-09-20'));
        await pg.waitForTimeout(400);
        const c20 = await pg.evaluate(() => document.getElementById('ss-recon-card').innerText.replace(/\s+/g, ' '));
        ok('9/20 카드 = 묶음(9/18~9/20) ✅ · 넣은 값 63,914,574(9/20 기록 기준: 정산예정 + 미정산) · 유입 +120,000(3건) · 취소·회수 −66,414(2건) · 실입금 63,242,933', /9\/18~9\/20 발송분 묶음/.test(c20) && /63,914,574/.test(c20) && /넣은 값 = 9\/20 기록\(정산예정 23,317,068 \+ 미정산 40,597,506\)/.test(c20) && /전날 집화 지연분 유입 \+120,000 3건/.test(c20) && /앞서 정산된 주문의 취소·회수 −66,414 2건/.test(c20) && /63,242,933/.test(c20) && /✅ 일치/.test(c20) && /합계 = 실제와의 차이 −671,641/.test(c20), c20.slice(0, 200));
        await pg.evaluate(() => ssSelectDate('2026-09-21'));
        await pg.waitForTimeout(400);
        const c21 = await pg.evaluate(() => document.getElementById('ss-recon-card').innerText.replace(/\s+/g, ' '));
        ok('9/21 카드 = 📝 미입력 배지 · 실입금 23,933,714 큰 숫자 · 「정산현황이 비어 있어」 안내 · 차이 내역엔 취소·이월 줄 없음', /📝 미입력/.test(c21) && /네이버 실입금/.test(c21) && /23,933,714/.test(c21) && /비어 있어/.test(c21) && !/발주 후 취소·집화 이월/.test(c21), c21.slice(0, 160));
        await pg.evaluate(() => ssSelectDate('2026-09-23'));
        await pg.waitForTimeout(400);
        const c23 = await pg.evaluate(() => document.getElementById('ss-recon-card').innerText.replace(/\s+/g, ' '));
        ok('9/23 카드 = 회차 없음 안내(발주 없는 날)', /비교할 네이버 정산이 없습니다|네이버 정산이 잡히면/.test(c23), c23.slice(0, 100));
        // 저장 버튼 → POST 가로채기 → 대조 재조회 1회 이상
        await pg.evaluate(() => ssSelectDate('2026-09-17'));
        await pg.waitForTimeout(300);
        let reconCalls = 0; pg.on('request', r => { if (/settle-recon/.test(r.url())) reconCalls++; });
        await pg.evaluate(() => ssSaveNow());
        await pg.waitForTimeout(1200);
        ok('저장 = POST 1회(가로채기·실DB 무변경) → 대조 재조회 호출', posts.length === 1 && posts[0].date === '2026-09-17' && reconCalls >= 1);
        // 알림 링크 page:tab 이동
        await pg.evaluate(() => { const nav = document.querySelector('.nav-item[data-page="agent-office"]') || document.querySelector('.nav-item'); nav && nav.click(); });
        await pg.waitForTimeout(300);
        await pg.route('**/api/notifications/*/read', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await pg.evaluate(() => clickNotification(999999999, 'settlement:settlement-status'));
        await pg.waitForTimeout(600);
        const tabActive = await pg.evaluate(() => { const t = document.querySelector('.settlement-tab[data-tab="settlement-status"]'); return !!(t && t.classList.contains('active')); });
        ok('알림 클릭(settlement:settlement-status) = 정산관리 → 정산현황 탭 활성', tabActive);
        ok('페이지 에러 0', errors.length === 0, errors[0]);
    } catch (e) { ok('예외 없음', false, String(e && e.message || e)); }
    finally { if (browser) await browser.close(); if (srv) srv.kill(); }
    const fail = results.filter(r => !r.pass).length;
    console.log(`\n결과: ${results.length - fail}/${results.length}${fail ? ' — 실패 ' + fail : ''}`);
    process.exit(fail ? 1 : 0);
})();
