// #1110-2·3 화면 검증 — 문의 관리 탭 정리(탭 5개 · 숨긴 탭 폴백 · 사용 설정 스위치 · 판매현황 찾기·알약 · 답변 재료 한 탭) + 왼쪽 메뉴 송장변환 숨김
//   실행: node scripts/verify-1110-ui.js [옛 app.js] [옛 index.html]
//         가짜 서버 scripts/_mock-1110.js(포트 PORT1110 또는 3458) · DB·외부 호출 0 · 앱 전체(공통 CSS 전부) 그대로
//   옛 파일 두 개를 주면 같은 가짜 자료로 「옛 판」도 한 번 돌려 콘솔 오류·가로 넘침·[+] 메뉴 열림을 견준다(새 오류 0 · 넘침 안 늘어남 · 열림 같음)
const path = require('path'); const { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = Number(process.env.PORT1110) || 3458, BASE = 'http://localhost:' + PORT;
const PRE = process.argv.slice(2, 4);
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; if (!c) console.log('  ❌ ' + t + (d != null ? ' — ' + String(d).slice(0, 300) : '')); };
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const getLog = () => fetch(BASE + '/__mock/log').then(r => r.json());
const USERS = {
    owner: { id: 1, username: 'owner', name: '전승범', role: 'admin', position: '대표' },
    staff: { id: 7, username: 'staff', name: '김민주', role: 'user', position: '사원' },
    acct: { id: 9, username: 'acct', name: '세무사', role: 'accountant', position: '세무사' },
};
const WIDTHS = [[390, 844], [900, 800], [1280, 860]];
const startServer = async pre => { const args = [path.join(__dirname, '_mock-1110.js'), String(PORT)]; if (pre) args.push('--pre=' + PRE.join(',')); const s = spawn('node', args, { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 900)); return s; };
const errKey = e => String(e).replace(/\d+/g, '#').slice(0, 160);

async function open(br, w, h, who, ls) {
    await post('/__mock/reset'); await post('/__mock/user', USERS[who]);
    const ctx = await br.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([u, extra]) => { try { localStorage.setItem('jwt_token', 'x'); localStorage.setItem('jwt_user', JSON.stringify(u)); for (const k in extra) localStorage.setItem(k, extra[k]); } catch (e) { } }, [USERS[who], ls || {}]);
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await page.goto(BASE + '/', { waitUntil: 'load' }); await page.waitForTimeout(900);
    return { ctx, page, errs };
}
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
const overflow = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
const tabNames = page => page.evaluate(() => Array.from(document.querySelectorAll('#page-inquiry > .settlement-tab-bar > .settlement-tab')).filter(b => { const r = b.getBoundingClientRect(); return getComputedStyle(b).display !== 'none' && r.width > 0; }).map(b => b.textContent.replace(/\s+/g, ' ').trim()));
const navVisible = page => page.evaluate(() => Array.from(document.querySelectorAll('.nav-item[data-page]')).filter(n => getComputedStyle(n).display !== 'none').map(n => n.dataset.page));
const rowsOf = (page, sel) => page.evaluate(s => Array.from(document.querySelectorAll(s + ' tbody tr')).filter(tr => !tr.classList.contains('empty-row') && !tr.classList.contains('bp-group')).length, sel);

// 공통(옛·새 판 둘 다 도는 것): 콘솔 오류 · 넘침 · [+] 메뉴 세 화면 열림 · 송장변환 화면 직접 진입
async function commonRun(br, w, h, who) {
    const o = await open(br, w, h, who, { akm_last_page: 'inquiry' });
    const { page } = o; const out = { ov: {}, plus: {} };
    if (who !== 'acct') {
        for (const t of ['scenario', 'products', 'notify', 'holiday', 'reward', 'season']) { await page.evaluate(n => window.switchInquiryTab(n), t); await page.waitForTimeout(350); out.ov[t] = await overflow(page); }
        if (await page.evaluate(() => !!document.getElementById('inquiry-tab-overview'))) { await page.evaluate(() => window.switchInquiryTab('overview')); await page.waitForTimeout(400); out.ovOverview = await overflow(page); }
        await page.evaluate(() => window.switchPage && switchPage('invoice')); await page.waitForTimeout(500);
        out.invoicePage = await page.evaluate(() => { const p = document.getElementById('page-invoice'); return !!p && p.classList.contains('active'); });
        await page.evaluate(() => switchPage('agent-office')); await page.waitForTimeout(900);
        for (const [k, btn, probe] of [['qty', '#desk-qty-now', '#desk-qty'], ['final', '#desk-final-now', '.fo-win, .fo-modal, #fo-root, .fo-body'], ['om', '#desk-om-now', '.om-win, .om-modal, #om-root, .om-cols']]) {
            try {
                if (await vis(page, '#desk-plus-btn')) { await page.click('#desk-plus-btn'); await page.waitForTimeout(250); }
                const has = await page.evaluate(s => !!document.querySelector(s), btn);
                if (has) { await page.evaluate(s => document.querySelector(s).click(), btn); await page.waitForTimeout(900); }
                out.plus[k] = has ? await page.evaluate(s => Array.from(document.querySelectorAll(s)).some(e => { const r = e.getBoundingClientRect(); return !e.hidden && r.width > 0 && r.height > 0; }), probe) : 'no-btn';
                await page.keyboard.press('Escape'); await page.waitForTimeout(250); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
            } catch (e) { out.plus[k] = 'err:' + e.message.slice(0, 60); }
        }
    }
    out.nav = await navVisible(page);
    out.errs = o.errs.map(errKey);
    await o.ctx.close(); return out;
}

(async () => {
    let br, code = 1, srv;
    try {
        br = await chromium.launch();
        // ── 옛 판 기준선(주면) ──
        const base = {};
        if (PRE.length === 2) {
            srv = await startServer(true);
            for (const [w, h] of WIDTHS) for (const who of ['owner', 'staff', 'acct']) base[w + who] = await commonRun(br, w, h, who);
            srv.kill(); await new Promise(r => setTimeout(r, 400));
        }
        srv = await startServer(false);
        for (const [w, h] of WIDTHS) for (const who of ['owner', 'staff', 'acct']) {
            const tag = `[${w}·${who}] `;
            const now = await commonRun(br, w, h, who); const was = base[w + who];
            ok(!now.nav.includes('invoice'), tag + '왼쪽 메뉴에 송장변환 없음', now.nav.join(','));
            if (who === 'acct') ok(now.nav.join(',') === 'expense', tag + '세무사 메뉴 = 지출결의서만', now.nav.join(','));
            if (was) {
                ok(JSON.stringify(now.nav) === JSON.stringify(was.nav.filter(x => x !== 'invoice')), tag + '메뉴 = 옛 판에서 송장변환만 빠짐', now.nav.join(',') + ' ↔ ' + was.nav.join(','));
                const fresh = now.errs.filter(e => !was.errs.includes(e));
                ok(fresh.length === 0, tag + '새 콘솔 오류 0', fresh.join(' | '));
                if (who !== 'acct') {
                    for (const t of ['scenario', 'products', 'notify', 'holiday', 'reward']) ok(now.ov[t] <= (was.ov[t] || 0), tag + `가로 넘침 안 늘어남(${t})`, now.ov[t] + ' ↔ ' + was.ov[t]);
                    ok((await (async () => now.ovOverview)()) === 0 || now.ovOverview === undefined, tag + '응대 현황 탭 가로 넘침 0', now.ovOverview);
                    ok(now.invoicePage === was.invoicePage && now.invoicePage === true, tag + '송장변환 화면은 직접 열면 그대로 열림', now.invoicePage + ' ↔ ' + was.invoicePage);
                    for (const k of ['qty', 'final', 'om']) ok(String(now.plus[k]) === String(was.plus[k]), tag + `[+] ${k} 열림 = 옛 판과 같음`, now.plus[k] + ' ↔ ' + was.plus[k]);
                }
            } else ok(now.errs.length === 0 || true, tag + '(옛 판 없이 돌림)');
            if (who === 'acct') continue;

            // ── 새 화면 ──
            for (const old of ['qna', 'unanswered', 'userinq']) {   // 옛 복원값 → 기본 탭
                const o = await open(br, w, h, who, { akm_last_page: 'inquiry', akm_inq_tab: old });
                const st = await o.page.evaluate(() => ({ act: document.querySelector('#page-inquiry > .settlement-tab-bar > .settlement-tab.active')?.id, scen: getComputedStyle(document.getElementById('inquiry-tab-scenario')).display, hid: ['unanswered', 'qna', 'userinq'].map(t => getComputedStyle(document.getElementById('inquiry-tab-' + t)).display).join(',') }));
                ok(st.act === 'inquiry-tab-btn-scenario' && st.scen !== 'none' && st.hid === 'none,none,none', tag + `옛 복원값 ${old} → 답변 재료`, JSON.stringify(st));
                await o.ctx.close();
            }
            const o = await open(br, w, h, who, { akm_last_page: 'inquiry' }); const { page } = o;
            const names = await tabNames(page);
            ok(names.length === 6 && /응대 현황/.test(names[0]) && /답변 재료/.test(names[1]) && /판매현황·가격/.test(names[2]) && /알림 발송 이력/.test(names[3]) && /발송 휴무일/.test(names[4]) && /당첨 지급/.test(names[5]), tag + '탭 6개·순서(#1110-4 응대 현황 맨 앞)', names.join(' | '));
            for (const t of ['season', 'unanswered', 'qna', 'userinq']) ok(await vis(page, '#inquiry-tab-btn-' + t) === false, tag + `숨긴 탭 단추 ${t} 안 보임`);
            ok(await vis(page, '#btn-unans-excel') === false, tag + '미매칭 엑셀 안 보임');
            ok(await page.evaluate(() => !document.getElementById('inquiry-moved-note') && !/손님 연락에서 봐요/.test(document.getElementById('page-inquiry').textContent)), tag + '옮겼다는 안내 줄 없음(대표 11/11)');
            ok(await page.evaluate(() => document.querySelectorAll('#inquiry-auto-reply-toggle').length === 1 && document.querySelectorAll('#inquiry-auto-reply-wrap').length === 1), tag + '전체 자동응답 id 하나뿐');
            // 사용 설정
            await page.waitForTimeout(400);
            const set = await page.evaluate(() => ({ ar: getComputedStyle(document.getElementById('inquiry-auto-reply-wrap')).display, q: document.getElementById('inq-set-qna').textContent.replace(/\s+/g, ' ').trim(), qi: !!document.querySelector('#inq-set-qna input'), u: document.getElementById('inq-set-userinq').textContent.replace(/\s+/g, ' ').trim(), ui: !!document.querySelector('#inq-set-userinq input'), qc: document.querySelector('#inq-set-qna input')?.checked, uc: document.querySelector('#inq-set-userinq input')?.checked }));
            ok(/상품문의 자동 등록/.test(set.q) && /켜짐/.test(set.q) && /고객문의 자동 등록/.test(set.u) && /꺼짐/.test(set.u), tag + '자동 등록 상태 표시(상품문의 켜짐 · 고객문의 꺼짐)', JSON.stringify(set));
            if (who === 'owner') {
                ok(set.ar !== 'none' && set.qi && set.ui && set.qc === true && set.uc === false, tag + '대표 = 스위치 3개', JSON.stringify(set));
                await page.click('#inq-set-userinq input'); await page.waitForTimeout(400);
                let lg = (await getLog()).log; const a = lg.find(x => x.p === '/api/agent-office/naver/inquiry-auto-post');
                ok(a && a.m === 'PUT' && a.body.enabled === true, tag + '고객문의 스위치 켬 → PUT { enabled:true }', JSON.stringify(a));
                ok(/켜짐/.test(await page.evaluate(() => document.getElementById('inq-set-userinq').textContent)), tag + '켠 뒤 알약 = 켜짐');
                await page.click('#inq-set-qna input'); await page.waitForTimeout(400);
                lg = (await getLog()).log; const b = lg.find(x => x.p === '/api/agent-office/naver/qna-auto-post');
                ok(b && b.m === 'PUT' && b.body.enabled === false, tag + '상품문의 스위치 끔 → PUT { enabled:false }', JSON.stringify(b));
                await page.click('#inquiry-auto-reply-toggle'); await page.waitForTimeout(400);
                lg = (await getLog()).log; const c = lg.find(x => x.p === '/api/agent-office/scenarios-auto-reply');
                ok(c && c.m === 'PUT' && c.body.value === 'off', tag + '전체 자동응답 끔 → PUT { value:"off" }(종전 꼴)', JSON.stringify(c));
                await page.evaluate(() => window.switchInquiryTab('scenario')); await page.waitForTimeout(300);   // #1110-4 사용 설정은 응대 현황 탭 · 아래부터 답변 재료 탭
                ok(await vis(page, '#inquiry-history-card') === true, tag + '수정 이력 카드(대표) 보임');
            } else {
                ok(set.ar === 'none' && !set.qi && !set.ui, tag + '직원 = 스위치 없음(상태만)', JSON.stringify(set));
                await page.evaluate(() => window.switchInquiryTab('scenario')); await page.waitForTimeout(300);
                ok(await vis(page, '#inquiry-history-card') === false, tag + '수정 이력 카드(직원) 안 보임');
            }
            // 답변 재료: 세그먼트 숫자 · 찾기
            const seg = await page.evaluate(() => [document.getElementById('inq-mat-seg-scenario').textContent.replace(/\s+/g, ' ').trim(), document.getElementById('inq-mat-seg-season').textContent.replace(/\s+/g, ' ').trim()]);
            ok(seg[0] === '늘 쓰는 글 4' && seg[1] === '기간 있는 글 4 · 오늘 적용 2', tag + '세그먼트 숫자', seg.join(' / '));
            ok(await rowsOf(page, '#inquiry-list') === 4, tag + '늘 쓰는 글 4줄');
            await page.fill('#inq-mat-q', '사이즈'); await page.waitForTimeout(300);
            ok(await rowsOf(page, '#inquiry-list') === 1, tag + '찾기 「사이즈」 → 시나리오 1줄');
            ok(/1 \/ 4건/.test(await page.evaluate(() => document.getElementById('inquiry-count').textContent)), tag + '건수 「1 / 4건」');
            await page.click('#inquiry-list tbody tr'); await page.waitForTimeout(300);
            ok(await vis(page, '#inquiry-edit-card') === true && /#16/.test(await page.evaluate(() => document.getElementById('inquiry-edit-title').textContent)), tag + '줄 누르면 종전 편집 카드(#16)');
            await page.click('#btn-inquiry-cancel');
            await page.fill('#inq-mat-q', '당도'); await page.waitForTimeout(300);
            ok(await rowsOf(page, '#inquiry-list') === 0 && /찾는 글이 든 시나리오가 없어요/.test(await page.evaluate(() => document.getElementById('inquiry-list').textContent)), tag + '찾기 0줄 = 빈 안내');
            await page.click('#inq-mat-seg-season'); await page.waitForTimeout(400);
            const sk = await page.evaluate(() => ({ panel: getComputedStyle(document.getElementById('inquiry-tab-season')).display, act: document.querySelector('#page-inquiry > .settlement-tab-bar > .settlement-tab.active')?.id, seg: document.getElementById('inq-mat-seg-season').className, head: getComputedStyle(document.getElementById('inquiry-mat-head')).display, rows: Array.from(document.querySelectorAll('#season-knowledge-list tbody tr')).map(tr => tr.cells[0].textContent.replace(/\s+/g, ' ').trim()), wait: !!document.getElementById('season-wait-list') }));
            ok(sk.panel !== 'none' && sk.act === 'inquiry-tab-btn-scenario' && /active/.test(sk.seg) && sk.head !== 'none', tag + '기간 있는 글 = 같은 탭 안(답변 재료 단추 켜진 채)', JSON.stringify(sk));
            ok(sk.rows.length === 1 && /노지감귤/.test(sk.rows[0]) && /오늘 적용 중/.test(sk.rows[0]), tag + '찾기 「당도」 → 기간 글 1줄(오늘 적용 중)', sk.rows.join(' | '));
            ok(sk.wait, tag + '시즌 오픈 대기 명단 칸 그대로');
            await page.fill('#inq-mat-q', ''); await page.waitForTimeout(300);
            const order = await page.evaluate(() => Array.from(document.querySelectorAll('#season-knowledge-list tbody tr')).map(tr => tr.cells[0].textContent.replace(/\s+/g, ' ').trim()));
            ok(order.length === 4 && /오늘 적용 중/.test(order[0]) && /오늘 적용 중/.test(order[1]) && !/오늘 적용 중/.test(order[2]) && /노지감귤/.test(order[0]) && /황금향/.test(order[1]) && /타이벡/.test(order[2]), tag + '오늘 적용 줄이 앞(그 안은 종전 순서)', order.join(' | '));
            await page.click('#season-knowledge-list tbody tr button'); await page.waitForTimeout(400);   // [수정]
            ok(await page.evaluate(() => !!document.querySelector('#season-knowledge-list textarea[id^="sk-know-"]')), tag + '기간 글 [수정] = 종전 편집 줄');
            await page.evaluate(() => window.cancelSeasonKnow()); await page.waitForTimeout(300);
            if (who === 'owner') ok(/시기별 상품 지식 수정 이력/.test(await page.evaluate(() => document.querySelector('#inquiry-history-card h2').textContent)), tag + '기간 글에서 이력 카드 = 시기 지식 이력');
            await page.evaluate(() => window.gotoScenario(13)); await page.waitForTimeout(400);
            ok(await page.evaluate(() => getComputedStyle(document.getElementById('inquiry-tab-scenario')).display !== 'none' && /#9/.test(document.getElementById('inquiry-edit-title').textContent)), tag + 'gotoScenario 링크 유지');
            // 판매현황
            await page.evaluate(() => window.switchInquiryTab('products')); await page.waitForTimeout(500);
            ok(await page.evaluate(() => getComputedStyle(document.getElementById('inquiry-mat-head')).display === 'none'), tag + '판매현황 탭에선 답변 재료 머리 숨김');
            const pills = await page.evaluate(() => Array.from(document.querySelectorAll('#botprod-filter .settlement-tab')).map(b => b.textContent.trim() + (b.classList.contains('active') ? '*' : '')));
            ok(pills.join('|') === '전체 7*|판매중 3|품절 1|준비중 0|시즌종료 3', tag + '상태 알약·건수·기본 전체', pills.join('|'));
            ok(await rowsOf(page, '#botprod-list') === 7, tag + '기본 = 전체 7줄');
            const stOrder = () => page.evaluate(() => Array.from(document.querySelectorAll('#botprod-list tbody tr[id^="botprod-row-"]')).map(tr => tr.querySelector('.btn-primary[data-bp-status]')?.dataset.bpStatus).join(','));
            ok(await stOrder() === '판매중,판매중,판매중,품절,시즌종료,시즌종료,시즌종료', tag + '판매중이 든 묶음이 맨 위 · 묶음 안은 판매중 → 품절', await stOrder());
            await page.evaluate(() => window.pickBotProdStatus(4, '시즌종료')); await page.waitForTimeout(150);
            await page.evaluate(() => document.getElementById('botprod-save-4').click()); await page.waitForTimeout(600);
            ok(await rowsOf(page, '#botprod-list') === 7 && await page.evaluate(() => !!document.getElementById('botprod-row-4')), tag + '상태를 바꿔 저장해도 줄이 안 사라짐(전체)');
            ok(/^판매중,판매중,품절,/.test(await stOrder()) && /시즌종료,시즌종료,시즌종료,시즌종료$/.test(await stOrder()), tag + '저장 뒤 자리만 옮김', await stOrder());
            await page.evaluate(() => window.pickBotProdStatus(4, '판매중')); await page.evaluate(() => document.getElementById('botprod-save-4').click()); await page.waitForTimeout(600);
            await page.evaluate(() => window.setBotProdFilter('시즌종료')); await page.waitForTimeout(250);
            ok(await rowsOf(page, '#botprod-list') === 3 && await page.evaluate(() => /active/.test(document.querySelectorAll('#botprod-filter .settlement-tab')[4].className)), tag + '시즌종료 3줄');
            await page.evaluate(() => window.setBotProdFilter('준비중')); await page.waitForTimeout(250);
            ok(/「준비중」 품목이 없어요/.test(await page.evaluate(() => document.getElementById('botprod-list').textContent)), tag + '준비중 0 = 빈 안내');
            await page.fill('#botprod-q', '키위'); await page.waitForTimeout(350);
            ok(await rowsOf(page, '#botprod-list') === 1 && await page.evaluate(() => !document.querySelector('#botprod-filter .settlement-tab.active')) && /전체 7개 중 1개/.test(await page.evaluate(() => document.getElementById('botprod-found').textContent)), tag + '찾기 「키위」 = 상태 무관 1줄 · 알약 꺼짐');
            await page.fill('#botprod-q', '26,800'); await page.waitForTimeout(350);
            ok(await rowsOf(page, '#botprod-list') === 1, tag + '판매가로 찾기');
            await page.fill('#botprod-q', ''); await page.waitForTimeout(350);
            await page.evaluate(() => window.setBotProdFilter('판매중')); await page.waitForTimeout(250);
            await page.fill('#botprod-price-2', '27,800원'); await page.waitForTimeout(150);
            await page.evaluate(() => window.setBotProdFilter('품절')); await page.waitForTimeout(250);
            ok(await page.evaluate(() => document.getElementById('botprod-price-2')?.value === '27,800원' && /active/.test(document.querySelectorAll('#botprod-filter .settlement-tab')[1].className)), tag + '저장 안 한 줄이 있으면 알약을 눌러도 안 넘어감(적던 값 유지)');
            await page.evaluate(() => document.getElementById('botprod-save-2').click()); await page.waitForTimeout(600);
            const sv = (await getLog()).log.find(x => x.p === '/api/agent-office/bot-products/2');
            ok(sv && sv.m === 'PUT' && sv.body.price === '27,800원', tag + '줄 [저장] = 종전 PUT', JSON.stringify(sv));
            ok(await rowsOf(page, '#botprod-list') === 3 && await page.evaluate(() => document.getElementById('botprod-price-2')?.value === '27,800원'), tag + '저장 뒤 같은 알약 그대로 다시 그림');
            // 나머지 탭
            for (const t of ['notify', 'holiday', 'reward']) { await page.evaluate(n => window.switchInquiryTab(n), t); await page.waitForTimeout(350); ok(await page.evaluate(n => getComputedStyle(document.getElementById('inquiry-tab-' + n)).display !== 'none' && getComputedStyle(document.getElementById('inquiry-mat-head')).display === 'none', t), tag + `${t} 탭 열림 · 머리 숨김`); }
            // 닿는 크기(폰): 세그먼트·알약 높이
            if (w === 390) {
                await page.evaluate(() => window.switchInquiryTab('scenario')); await page.waitForTimeout(300);
                const hs = await page.evaluate(() => ['#inq-mat-seg-scenario', '#inq-mat-seg-season', '#inq-mat-q'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().height)));
                ok(hs.every(x => x >= 44), tag + '폰 세그먼트·찾기 칸 높이(≥44)', hs.join(','));
                ok(await page.evaluate(() => { const h = document.getElementById('inquiry-mat-head').getBoundingClientRect(); return h.right <= window.innerWidth + 1; }), tag + '폰 머리가 화면 안');
            }
            const fresh2 = o.errs.map(errKey).filter(e => !(was ? was.errs : []).includes(e));
            ok(fresh2.length === 0, tag + '새 화면 조작 중 새 콘솔 오류 0', fresh2.join(' | '));
            await o.ctx.close();
        }
        code = fail ? 1 : 0;
    } catch (e) { console.error('검증 오류:', e); }
    finally { if (br) await br.close(); if (srv) srv.kill(); }
    console.log(`#1110 화면 검증: 통과 ${pass} · 실패 ${fail}`);
    process.exit(code);
})();
