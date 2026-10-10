// #612 에이전트 오피스 「전체 가격 확인하기」 카드 검증 — 가짜 서버(scripts/_mock-612.js · 실제 price-check.js 로 만든 보고 · DB·외부 호출 0)에 실제 화면을 띄워 실클릭
//   사용: node scripts/verify-612-ui.js   (포트 PORT612 · 없으면 3465 · 다른 Playwright 검증과 동시에 돌리지 말 것)
//   PC · 폰 · PC 야간 · 폰 야간 × 알약 · 스냅샷 시각 · 표 · 어긋난 줄 · 보기 3종 · 종류 칩(참고 포함) · 찾기 · 복사 · 다시 확인 · 안 파는 옵션 구획 · 등급 설정 저장(POST 도착) · scrollWidth · 44px · Esc · 대비
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js'));
const PORT = Number(process.env.PORT612 || 3465), BASE = 'http://localhost:' + PORT;
const PC = { width: 1440, height: 900 }, PH = { width: 390, height: 844 };
const ADMIN = { id: 1, name: '시험대표', position: '대표', role: 'admin' }, STAFF = { id: 8, name: '시험직원', position: '대리', role: 'user' };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const mock = async (p, body) => (await fetch(BASE + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
const logOf = async () => (await mock('/__mock/log')).log;
const sorted = o => JSON.stringify(Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {}));

(async () => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-612.js'), String(PORT)], { stdio: ['ignore', 'ignore', 'inherit'] });
    let up = false; for (let i = 0; i < 40 && !up; i++) { await H.sleep(250); try { up = (await fetch(BASE + '/__mock/log')).ok; } catch (e) { /* 아직 */ } }
    if (!up) { srv.kill(); throw new Error('가짜 서버가 안 떴어요(포트 ' + PORT + ')'); }
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const open = async (vw, phone, theme, user) => {
        const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] }, phone ? { isMobile: true, hasTouch: true } : {}));
        const pg = await ctx.newPage(); const errors = [], toasts = [], reqs = [];
        pg.on('pageerror', e => errors.push(String(e))); pg.on('dialog', d => d.dismiss().catch(() => { }));
        pg.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/price-check')) reqs.push(r.method() + ' ' + u.pathname + u.search); });
        await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await pg.evaluate(([u, th]) => { localStorage.setItem('jwt_token', u.role === 'admin' ? 'mock.token.612.admin' : 'mock.token.612.staff'); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); if (th) localStorage.setItem('akm_ao_theme', th); else localStorage.removeItem('akm_ao_theme'); }, [user || ADMIN, theme]);
        await pg.exposeFunction('__toast', t => toasts.push(t));
        await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1800);
        await pg.evaluate(() => { const mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && /toast/i.test(n.className || '')) window.__toast(n.textContent.trim()); }))); mo.observe(document.body, { childList: true, subtree: true }); });
        return { pg, ctx, errors, toasts, reqs };
    };
    const sw = pg => pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    const loaded = pg => pg.waitForFunction(() => { const o = document.getElementById('pc-out'), p = document.getElementById('pc-prog'); return o && p && p.hidden && (o.querySelector('.pc-group') || o.querySelector('.desk-empty')); }, null, { timeout: 8000 }).catch(() => { });
    const stat = pg => pg.evaluate(() => ({
        groups: document.querySelectorAll('#pc-out .pc-group').length, rows: document.querySelectorAll('#pc-out tbody tr').length,
        bad: document.querySelectorAll('#pc-out tr.pc-bad').length, off: document.querySelectorAll('#pc-out tr.pc-off').length, sep: document.querySelectorAll('#pc-out tr.pc-sep').length, lines: document.querySelectorAll('#pc-out .pc-issues li').length,
        view: (document.querySelector('#pc-views button[aria-pressed="true"]') || { dataset: {} }).dataset.view || '', count: document.getElementById('pc-count').textContent, sub: document.getElementById('pc-sub').textContent,
    }));
    const size = (pg, sel) => pg.evaluate(s => Array.from(document.querySelectorAll(s)).filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className || e.textContent.slice(0, 8), w: Math.round(r.width), h: Math.round(r.height) }; }), sel);
    const view = async (pg, v) => { await pg.click(`#pc-views button[data-view="${v}"]`); await pg.waitForTimeout(200); };

    try {
        for (const [label, vw, phone, theme] of [['PC', PC, false, null], ['폰', PH, true, null], ['PC 야간', PC, false, 'dark'], ['폰 야간', PH, true, 'dark']]) {
            console.log('\n── ' + label);
            await mock('/__mock/reset', {});
            const P = await open(vw, phone, theme), pg = P.pg, T = P.toasts;
            // ① 알약 · 닫힌 화면은 종전 그대로
            const chips = await pg.evaluate(() => Array.from(document.querySelectorAll('.desk-quick2 .desk-chip')).filter(b => !b.hidden).map(b => b.textContent.trim()));
            ok(chips.join('|') === '중간발주|최종발주|정산 이미지|배송조회 확인하기|전체 가격 확인하기', `[${label}] 알약 5개 · 「전체 가격 확인하기」가 배송조회 옆(${chips.join('|')})`);
            ok(await pg.evaluate(() => !document.getElementById('desk-price')) && P.reqs.length === 0, `[${label}] 누르기 전에는 카드도 요청도 없음(칸 순서 종전 그대로 · 요청 ${P.reqs.length}회)`);
            const chipBox = await size(pg, '.desk-quick2 .desk-chip');
            ok(await sw(pg) <= vw.width && (!phone || chipBox.every(b => b.h >= 44)), `[${label}] 알약 줄 가로 넘침 없음(${await sw(pg)} ≤ ${vw.width})${phone ? ' · 알약 높이 44 이상(' + Math.min(...chipBox.map(b => b.h)) + ')' : ''}`);
            if (phone) { const tops = await pg.evaluate(() => [...new Set(Array.from(document.querySelectorAll('.desk-quick2 .desk-chip')).filter(b => !b.hidden).map(b => Math.round(b.getBoundingClientRect().top)))].length); ok(tops >= 2 && tops <= 3, `[${label}] 폰 알약은 줄바꿈(${tops}줄)`); }

            // ② 열기 · 머리 · 스냅샷 시각 · 칩
            await pg.click('#desk-price-now'); await loaded(pg);
            let s = await stat(pg);
            ok(P.reqs.join(',') === 'GET /api/price-check', `[${label}] 열 때 요청 1회(refresh 없음 · ${P.reqs.join(',')})`);
            ok(s.sub === '어긋남 4건', `[${label}] 머리 = 어긋남 4건(참고 2건은 안 셈 · 「${s.sub}」)`);
            const wh = await pg.evaluate(() => { const w = document.getElementById('pc-when'); const b = w.querySelector('b'); return { hid: w.hidden, b: b.textContent, fs: parseFloat(getComputedStyle(b).fontSize), fw: getComputedStyle(b).fontWeight, span: w.querySelector('span').textContent, em: !!w.querySelector('em') }; });
            ok(!wh.hid && /^네이버 \d+\/\d+ \d\d:\d\d 값$/.test(wh.b) && wh.fs >= 16 && Number(wh.fw) >= 700, `[${label}] 스냅샷 시각 크게(「${wh.b}」 · ${wh.fs}px · 굵기 ${wh.fw})`);
            ok(/자사몰은 방금 값/.test(wh.span) && /낮에 고친 네이버 가격은 내일 새벽 뒤에 확인/.test(wh.span) && /확인 \d+\/\d+ \d\d:\d\d/.test(wh.span) && !wh.em, `[${label}] 안내 = 자사몰은 방금 값 · 네이버는 새벽 값 · 낮에 고친 건 내일 새벽 뒤`);
            const cells = await pg.evaluate(() => Array.from(document.querySelectorAll('#pc-stat li')).map(li => li.querySelector('span').textContent.trim() + ' ' + li.querySelector('b').textContent + (li.dataset.ref ? '(참고칩)' : li.dataset.k ? '(' + li.dataset.k + ')' : '')).join(' / '));
            ok(cells === '페이지끼리 값 다름 1(err) / 자사몰≠네이버 1(err) / VIP가 더 비쌈 1(err) / 한쪽만 안 바뀜 1(wait) / 자사몰에 없음 참고 1(참고칩) / VIP와 일반 값 같음 참고 1(참고칩)', `[${label}] 칩 = 어긋남 4종 + 참고 2종(회색 따로) — ${cells}`);
            ok(s.view === (phone ? 'issue' : 'multi'), `[${label}] 보기 기본 = ${phone ? '어긋난 것만(폰)' : '여러 페이지(PC)'}(${s.view})`);
            if (phone) ok(s.groups === 2 && s.rows === 7, `[${label}] 폰 기본 = 어긋난 옵션 2 · 페이지 줄 7(${s.groups} · ${s.rows})`);
            else ok(s.groups === 7 && s.rows === 20, `[${label}] PC 기본 = 여러 페이지에 걸린 옵션 7 · 줄 20(${s.groups} · ${s.rows})`);
            ok(/쿠팡은 가격 조회 API가 없어/.test(await pg.locator('.pc-hint').innerText()), `[${label}] 쿠팡 빠짐 안내 한 줄`);

            // ③ 표: 전체 보기에서 줄 표시
            await view(pg, 'all'); s = await stat(pg);
            ok(s.view === 'all' && s.groups === 8 && s.rows === 21, `[${label}] [전체] → 옵션 8 · 줄 21(${s.groups} · ${s.rows})`);
            ok(s.bad === 4 && s.off === 7 && s.lines === 6, `[${label}] 빨간 줄 4 · 안 파는·제외 줄(회색) 7 · 이유 줄 6(어긋남 4 + 참고 2) — ${JSON.stringify({ bad: s.bad, off: s.off, lines: s.lines })}`);
            const g1 = await pg.evaluate(() => { const g = Array.from(document.querySelectorAll('#pc-out .pc-group')).find(x => /하우스감귤 선물용/.test(x.querySelector('.pc-h').textContent)); const trs = Array.from(g.querySelectorAll('tbody tr')); return { head: g.querySelector('.pc-h').textContent.replace(/\s+/g, ' ').trim(), pages: trs.map(t => t.dataset.page + (t.classList.contains('pc-bad') ? '!' : '') + (t.classList.contains('pc-off') ? '×' : '') + (t.classList.contains('pc-sep') ? '|' : '')), name: trs[0].querySelector('.pc-pname').textContent, meta: trs.map(t => t.querySelector('.desk-badge').textContent + '/' + t.querySelector('.pc-ch').textContent), price: trs.map(t => t.querySelector('.pc-price b').textContent), small: trs.map(t => (t.querySelector('.pc-price small') || { textContent: '' }).textContent), chg: trs.map(t => t.querySelector('.pc-chg').textContent), otxt: trs[0].querySelector('.pc-otxt').textContent, bg: getComputedStyle(trs[0].querySelector('td')).backgroundColor, bg1: getComputedStyle(trs[1].querySelector('td')).backgroundColor, sepTop: getComputedStyle(trs[3].querySelector('td')).borderTopWidth, thead: !!g.querySelector('thead th[scope="col"]') }; });
            ok(g1.pages.join(' ') === 'naver:1! naver:4 mall:11× naver:3|', `[${label}] 줄 순서 = 일반(네이버 → 자사몰) 뒤에 VIP · 어긋난 줄만 빨강 · 판매 안 하는 줄 회색 · VIP 앞 구분선(${g1.pages.join(' ')})`);
            ok(g1.name === '제주 노지 감귤 타이벡 하우스' && g1.meta.join(' ') === '일반/네이버 선물/네이버 일반/자사몰 VIP/네이버' && /하우스감귤 선물용 - 3kg/.test(g1.otxt), `[${label}] 줄 머리 = 페이지 이름 + 등급 칩 + 채널 + 그 페이지의 옵션 글자(${g1.meta.join(' ')})`);
            ok(g1.price.join(' ') === '34,500원 33,500원 38,999원 33,500원' && /페이지끼리 값 다름 · 한쪽만 안 바뀜/.test(g1.small[0]) && g1.small[2] === '판매 안 함', `[${label}] 결제가(천 단위) + 줄 아래 이유(「${g1.small[0]}」) · 「판매 안 함」`);
            ok(/^\d+\/\d+ 이전부터 그대로$/.test(g1.chg[0]) && /^바뀜 \d+\/\d+ · 앞 값 34,500$/.test(g1.chg[1]) && g1.chg[2] === '바뀐 날 모름', `[${label}] 바뀐 날 = 「${g1.chg[0]}」 · 「${g1.chg[1]}」 · 자사몰 「${g1.chg[2]}」`);
            ok(g1.bg !== g1.bg1 && g1.sepTop === '2px' && g1.thead, `[${label}] 빨간 줄 배경이 다름(${g1.bg} ≠ ${g1.bg1}) · VIP 구분선 2px · 표 머리(읽기 프로그램용)`);
            ok(/어긋남 2/.test(g1.head) && /참고 1/.test(g1.head), `[${label}] 묶음 머리에 어긋남·참고 수(「${g1.head.slice(-16)}」)`);
            const lines = await pg.evaluate(() => { const g = Array.from(document.querySelectorAll('#pc-out .pc-group')).find(x => /황금향 선물용 - 3kg/.test(x.querySelector('.pc-h').textContent)); return { bad: g.querySelectorAll('tr.pc-bad').length, li: Array.from(g.querySelectorAll('.pc-issues li')).map(l => l.querySelector('.desk-badge').textContent + '(' + l.querySelector('.desk-badge').dataset.k + '): ' + l.querySelector('span').textContent) }; });
            ok(lines.bad === 3 && lines.li.length === 2 && /^자사몰≠네이버\(err\): 네이버 「제주 황금향 가정용 선물용」 41,800원 ↔ 자사몰 「제주 황금향 가정용 선물용」 42,800원/.test(lines.li[0]) && /^VIP가 더 비쌈\(err\)/.test(lines.li[1]), `[${label}] 자사몰≠네이버 = 두 줄 다 빨강 + VIP가 더 비쌈 줄 빨강 · 표 아래 이유 줄(종류 칩 + 서버 글)`);
            const ign = await pg.evaluate(() => { const t = document.querySelector('#pc-out tr[data-page="naver:6"]'); return t.className + '|' + t.querySelector('.pc-price small').textContent; });
            ok(/pc-off/.test(ign) && /제외한 페이지/.test(ign), `[${label}] 제외한 페이지 줄 = 회색 · 「제외한 페이지」`);

            // ④ 넘침 · 폭 · 터치 · 대비
            ok(await sw(pg) <= vw.width, `[${label}] 카드 가로 넘침 없음(${await sw(pg)} ≤ ${vw.width})`);
            const tw = await pg.evaluate(() => Array.from(document.querySelectorAll('#pc-out .pc-tw')).map(w => w.scrollWidth - w.clientWidth).filter(x => x > 1).length);
            ok(tw === 0, `[${label}] 표가 틀 안에 다 들어감(옆으로 밀 일 없음 · 넘치는 표 ${tw})`);
            const clip = await pg.evaluate(() => Array.from(document.querySelectorAll('#pc-out .pc-price b, #pc-out .pc-pname')).filter(e => e.scrollWidth > e.clientWidth + 1).length);
            ok(clip === 0, `[${label}] 가격·페이지 이름 잘림 없음(${clip})`);
            if (phone) { const small = (await size(pg, '#desk-price button, #desk-price #pc-stat li, #desk-price #pc-q, #desk-price summary')).filter(b => b.h < 44); ok(small.length === 0, `[${label}] 누르는 것 전부 44px 이상(미달 ${small.length}${small.length ? ' · ' + JSON.stringify(small.slice(0, 3)) : ''})`); }
            else { const small = (await size(pg, '#desk-price button, #desk-price #pc-q')).filter(b => b.h < 40); ok(small.length === 0, `[${label}] 버튼·찾기 칸 40px 이상(미달 ${small.length})`); }
            { const a = await H.audit(pg, '#desk-price'); ok(a.fails.length === 0 && (!theme || (a.dark === 'dark' && a.white.length === 0)), `[${label}] 글자 대비 미달 0${theme ? ' · 야간 흰 칸 0' : ''}(글자 ${a.texts}개 · 최소 ${a.minR}${a.fails.length ? ' · ' + a.fails.slice(0, 4).join(' / ') : ''}${theme && a.white.length ? ' · 흰 칸 ' + a.white.slice(0, 3).join(' / ') : ''})`); }

            // ⑤ 보기 · 종류 칩 · 찾기
            await view(pg, 'issue'); s = await stat(pg);
            ok(s.groups === 2 && s.rows === 7 && s.bad === 4, `[${label}] [어긋난 것만] → 옵션 2 · 줄 7(페이지 전부 보여 견줌) · 빨간 줄 4`);
            await view(pg, 'multi'); s = await stat(pg);
            ok(s.groups === 7, `[${label}] [여러 페이지] → 한 페이지뿐인 옵션 빼고 7`);
            await pg.click('#pc-stat li[data-kind="mall_vs_naver"]'); await pg.waitForTimeout(200); s = await stat(pg);
            ok(s.groups === 1 && s.lines === 1 && s.view === '' && /자사몰≠네이버/.test(s.count) && (await pg.getAttribute('#pc-stat li[data-kind="mall_vs_naver"]', 'aria-pressed')) === 'true', `[${label}] 칩 「자사몰≠네이버」 → 그 옵션 1 · 그 종류 이유 줄만 1 · 눌린 표시(${s.count})`);
            await pg.focus('#pc-stat li[data-kind="vip_same"]'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200); s = await stat(pg);
            ok(s.groups === 1 && s.lines === 1 && /VIP와 일반 값 같음/.test(await pg.locator('#pc-out .pc-issues li').innerText()), `[${label}] 자판(Enter)으로 참고 칩 「VIP와 일반 값 같음」 → 옵션 1`);
            await pg.click('#pc-stat li[data-kind="vip_same"]'); await pg.waitForTimeout(200); s = await stat(pg);
            ok(s.groups === 7 && s.view === 'multi', `[${label}] 같은 칩 다시 누름 → 앞서 고른 보기(여러 페이지)로`);
            await view(pg, 'all');
            await pg.fill('#pc-q', '레몬'); await pg.waitForTimeout(450); s = await stat(pg);
            ok(s.groups === 2, `[${label}] 찾기 「레몬」(옵션 이름) → 2`);
            await pg.fill('#pc-q', '추석 과일'); await pg.waitForTimeout(450); s = await stat(pg);
            ok(s.groups === 1 && s.rows === 4, `[${label}] 찾기 「추석 과일」(페이지 이름) → 그 페이지가 걸린 옵션 1`);
            await pg.fill('#pc-q', '없는글자zz'); await pg.waitForTimeout(450);
            ok(/찾는 품목·옵션·페이지가 없어요/.test(await pg.locator('#pc-out').innerText()), `[${label}] 찾는 것이 없으면 안내 한 줄`);
            await pg.fill('#pc-q', ''); await pg.waitForTimeout(450);

            // ⑥ 안 파는 옵션끼리 다름 — 맨 아래 접이식
            const offBox = await pg.evaluate(() => { const d = document.getElementById('pc-off'); const out = document.getElementById('pc-out'); return { hid: d.hidden, open: d.open, sum: document.getElementById('pc-off-sum').textContent, below: d.getBoundingClientRect().top >= out.getBoundingClientRect().bottom - 1 }; });
            ok(!offBox.hid && !offBox.open && offBox.sum === '지금 안 파는 옵션끼리 값이 다름 1건(참고)' && offBox.below, `[${label}] 「${offBox.sum}」 접이식이 표 아래에 접힌 채`);
            await pg.click('#pc-off > summary'); await pg.waitForTimeout(200);
            const offIn = await pg.evaluate(() => { const g = document.querySelector('#pc-off-out .pc-group'); return g ? g.querySelector('.pc-h').textContent + '|' + Array.from(g.querySelectorAll('.pc-price b')).map(b => b.textContent).join(',') : ''; });
            ok(/한라봉 가정용/.test(offIn) && /36,000원,38,000원/.test(offIn) && await sw(pg) <= vw.width, `[${label}] 펼치면 그 옵션의 두 값(36,000 · 38,000) · 넘침 없음`);
            await pg.click('#pc-off > summary'); await pg.waitForTimeout(150);

            // ⑦ 요약 복사
            T.length = 0; await pg.click('#pc-copy'); await pg.waitForTimeout(400);
            const clipText = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '');
            ok(/^\[가격 확인 · 네이버 \d+\/\d+ \d\d:\d\d 값\] 어긋난 것 4건/.test(clipText) && clipText.includes('■ ') && /▶ 34,500원 · 네이버 제주 노지 감귤 타이벡 하우스/.test(clipText) && /33,500원 · 네이버 명절 혼합 과일 페이지 \[VIP\]/.test(clipText) && clipText.includes('→ [페이지끼리 값 다름] ') && clipText.includes('→ [자사몰≠네이버] ') && !/참고|VIP와 일반 값 같음|자사몰에 없음|레몬|한라봉/.test(clipText), `[${label}] [요약 복사] = 어긋난 옵션만 · 페이지별 값(▶ 어긋난 줄) · 이유 · 참고와 맞는 옵션은 없음(${clipText.length}자)`);
            ok(T.some(t => /복사했어요/.test(t)), `[${label}] 복사 알림(${T.join(' / ')})`);

            // ⑧ 다시 확인 · 실패 · 자사몰 조회 실패
            const n0 = P.reqs.length; T.length = 0;
            await pg.click('#pc-refresh'); await loaded(pg); await pg.waitForTimeout(300);
            ok(P.reqs.slice(n0).join(',') === 'GET /api/price-check?refresh=1' && T.some(t => /다시 확인했어요/.test(t)), `[${label}] [다시 확인] → refresh=1 로 1회 · 알림(${P.reqs.slice(n0).join(',')})`);
            await mock('/__mock/set', { fail: 'report' });
            await pg.click('#pc-refresh'); await loaded(pg); await pg.waitForTimeout(300);
            const er = await pg.evaluate(() => ({ t: document.getElementById('pc-note').textContent, k: document.getElementById('pc-note').dataset.k, hid: document.getElementById('pc-note').hidden, groups: document.querySelectorAll('#pc-out .pc-group').length, dis: document.getElementById('pc-refresh').disabled }));
            ok(!er.hid && er.k === 'err' && /앞서 받은 가격/.test(er.t) && er.groups === 8 && !er.dis, `[${label}] 다시 확인 실패 → 빨간 안내 + 앞서 받은 표는 그대로(옵션 ${er.groups}) · 버튼 다시 켜짐`);
            await mock('/__mock/set', { fail: '', mall: 'error' });
            await pg.click('#pc-refresh'); await loaded(pg); await pg.waitForTimeout(300);
            const me = await pg.evaluate(() => { const w = document.getElementById('pc-when'); const em = w.querySelector('em'); return { em: em ? em.textContent : '', span: w.querySelector('span').textContent, note: document.getElementById('pc-note').hidden }; });
            ok(/자사몰 조회 실패: 카페24 토큰 만료/.test(me.em) && /네이버 페이지끼리만 견줬/.test(me.em) && !/자사몰은 방금 값/.test(me.span) && me.note, `[${label}] 자사몰을 못 읽으면 서버 안내 글을 띄움(「${me.em.slice(0, 34)}…」)`);
            await mock('/__mock/set', { mall: '' });
            await pg.click('#pc-refresh'); await loaded(pg); await pg.waitForTimeout(300);

            // ⑨ 등급 설정(관리자) — 저장 POST 도착 · 있던 설정을 지우지 않음
            ok(await pg.locator('#pc-set').isVisible(), `[${label}] 관리자에게 「페이지 등급 설정」 접이식 보임`);
            await pg.click('#pc-set > summary'); await pg.waitForFunction(() => document.querySelectorAll('#pc-set-list .pc-set-row').length > 0, null, { timeout: 5000 }).catch(() => { });
            const rows = await pg.evaluate(() => Array.from(document.querySelectorAll('#pc-set-list .pc-set-row')).map(r => r.dataset.key + '=' + r.querySelector('select').value + (r.querySelector('input').checked ? '!' : '')));
            ok(rows.length === 13 && rows.includes('naver:3=vip') && rows.includes('naver:4=gift') && rows.includes('naver:6=normal!') && rows.includes('mall:12=vip') && rows.includes('mall:13=bulk'), `[${label}] 설정 줄 13(페이지 · 지금 등급 · 제외) — ${rows.slice(0, 6).join(' ')} …`);
            const keyText = await pg.locator('.pc-set-row[data-key="mall:12"] small').innerText();
            ok(/자사몰 · cafe24:12/.test(keyText), `[${label}] 자사몰 줄은 저장 키(cafe24:번호)로 보임(「${keyText}」)`);
            ok(await sw(pg) <= vw.width, `[${label}] 설정 펼친 뒤 가로 넘침 없음(${await sw(pg)})`);
            await pg.click('#pc-set-save'); await pg.waitForTimeout(250);
            ok(/바뀐 것이 없어요/.test(await pg.locator('#pc-set-msg').innerText()) && !(await logOf()).some(x => x.action === 'save'), `[${label}] 안 바꾸고 [저장] → 「바뀐 것이 없어요」 · POST 0`);
            await pg.selectOption('.pc-set-row[data-key="naver:7"] select', 'vip');
            await pg.locator('.pc-set-row[data-key="naver:5"] input[type="checkbox"]').check();
            await pg.locator('.pc-set-row[data-key="mall:12"] input[type="checkbox"]').check();
            const n1 = P.reqs.length; T.length = 0;
            await pg.click('#pc-set-save'); await pg.waitForFunction(() => /저장하고 가격을 다시 확인/.test(document.getElementById('pc-set-msg').textContent), null, { timeout: 8000 }).catch(() => { });
            const saved = (await logOf()).filter(x => x.action === 'save');
            const want = { 'naver:3': { tier: 'vip', note: 'VIP', ignore: false }, 'naver:6': { tier: 'normal', note: '', ignore: true }, 'cafe24:13': { tier: 'bulk', note: '메모 유지', ignore: false }, 'naver:7': { tier: 'vip', note: '', ignore: false }, 'naver:5': { tier: 'normal', note: '', ignore: true }, 'cafe24:12': { tier: 'vip', note: '', ignore: true } };
            ok(saved.length === 1 && sorted(saved[0].body) === sorted(want), `[${label}] [저장] → POST 1회 = 있던 설정 3개(메모 유지 · 등급 없던 것은 지금 등급) + 바꾼 3개 · 자사몰 키는 cafe24: (${saved[0] ? Object.keys(saved[0].body).join(' ') : '없음'})`);
            ok(saved[0] && !Object.keys(saved[0].body).some(k => /^mall:/.test(k)), `[${label}] POST 에 mall: 키 없음(서버가 버리는 꼴)`);
            const seq = P.reqs.slice(n1).join(',');
            ok(/^POST \/api\/price-check\/pages,GET \/api\/price-check\?refresh=1/.test(seq) && T.some(t => /저장했어요/.test(t)) && /3개 페이지를 저장하고 가격을 다시 확인/.test(await pg.locator('#pc-set-msg').innerText()), `[${label}] 저장 뒤 가격 다시 확인(${seq})`);
            await view(pg, 'all');
            const after = await pg.evaluate(() => { const a = document.querySelector('#pc-out tr[data-page="naver:7"]'), b = document.querySelector('#pc-out tr[data-page="mall:12"]'), c = document.querySelector('.pc-set-row[data-key="naver:7"] select'); return { vip: a.querySelector('.desk-badge').textContent, ign: b.className + '|' + (b.querySelector('.pc-price small') || { textContent: '' }).textContent, sel: c ? c.value : '' }; });
            ok(after.vip === 'VIP' && /pc-off/.test(after.ign) && /제외한 페이지/.test(after.ign) && after.sel === 'vip', `[${label}] 다시 그린 표·설정 줄에 새 등급·제외 반영(${after.vip} · ${after.ign.split('|')[1]})`);
            await mock('/__mock/set', { fail: 'save' });
            await pg.selectOption('.pc-set-row[data-key="naver:7"] select', 'normal'); await pg.click('#pc-set-save'); await pg.waitForTimeout(500);
            const sm = await pg.evaluate(() => ({ t: document.getElementById('pc-set-msg').textContent, k: document.getElementById('pc-set-msg').dataset.k, dis: document.getElementById('pc-set-save').disabled }));
            ok(sm.k === 'err' && /저장하지 못했어요/.test(sm.t) && !sm.dis, `[${label}] 저장 실패 → 빨간 글 · 버튼 다시 켜짐(「${sm.t.slice(0, 30)}」)`);
            await mock('/__mock/set', { fail: '' });

            // ⑩ Esc · 닫기 · 다시 열기(재요청 없음) · 다른 도구와 한 번에 하나
            await pg.focus('#pc-q'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(250);
            ok(await pg.evaluate(() => document.getElementById('desk-price').hidden && document.activeElement && document.activeElement.id === 'desk-price-now'), `[${label}] Esc → 카드 닫힘 · 초점이 알약으로`);
            const n2 = P.reqs.length; await pg.click('#desk-price-now'); await pg.waitForTimeout(300);
            ok(await pg.locator('#desk-price').isVisible() && P.reqs.length === n2 && (await stat(pg)).groups > 0, `[${label}] 다시 열면 받은 자료 그대로(재요청 0)`);
            await pg.click('#desk-ship-now'); await pg.waitForTimeout(400);
            ok(await pg.evaluate(() => document.getElementById('desk-price').hidden && !document.getElementById('desk-ship').hidden), `[${label}] 배송조회를 열면 가격 카드는 닫힘(한 번에 하나)`);
            await pg.click('#desk-price-now'); await pg.waitForTimeout(300);
            ok(await pg.evaluate(() => !document.getElementById('desk-price').hidden && document.getElementById('desk-ship').hidden), `[${label}] 가격 카드를 열면 배송조회는 닫힘`);
            await pg.click('#pc-close'); await pg.waitForTimeout(200);
            ok(await pg.evaluate(() => document.getElementById('desk-price').hidden), `[${label}] [닫기]`);
            ok(P.errors.length === 0, `[${label}] 화면 오류 0${P.errors.length ? ' · ' + P.errors.slice(0, 2).join(' / ') : ''}`);
            await P.ctx.close();
        }

        // 직원 계정 · 어긋남 0 · 첫 요청 실패
        console.log('\n── 직원 · 빈 상태 · 실패');
        await mock('/__mock/reset', {});
        {
            const P = await open(PC, false, null, STAFF), pg = P.pg;
            await pg.click('#desk-price-now'); await loaded(pg);
            ok((await stat(pg)).groups === 7 && await pg.evaluate(() => document.getElementById('pc-set').hidden), `[직원] 표는 보이고 「페이지 등급 설정」은 숨김`);
            ok(!P.reqs.some(r => /pages/.test(r)) && P.errors.length === 0 && !(await logOf()).some(x => x.action === 'save'), `[직원] 설정 요청 0 · 저장 0 · 화면 오류 0`);
            await P.ctx.close();
        }
        await mock('/__mock/set', { clean: true });
        {
            const P = await open(PH, true, null, ADMIN), pg = P.pg;
            await pg.click('#desk-price-now'); await loaded(pg);
            const e = await pg.evaluate(() => ({ sub: document.getElementById('pc-sub').textContent, k: document.getElementById('pc-sub').dataset.k, out: document.getElementById('pc-out').textContent, copy: document.getElementById('pc-copy').disabled, chips: Array.from(document.querySelectorAll('#pc-stat li b')).map(b => b.textContent).join(''), off: document.getElementById('pc-off').hidden }));
            ok(e.sub === '어긋난 가격 없음' && !e.k && /어긋난 가격이 없어요/.test(e.out) && e.copy && e.chips === '000000' && !e.off, `[어긋남 0 · 폰] 머리 「어긋난 가격 없음」 · 빈 안내 · [요약 복사] 꺼짐 · 안 파는 옵션 구획은 그대로`);
            await pg.click('#pc-views button[data-view="multi"]'); await pg.waitForTimeout(200);
            ok((await stat(pg)).groups === 7 && await pg.evaluate(() => document.querySelectorAll('#pc-out tr.pc-bad, #pc-out .pc-issues li').length === 0), `[어긋남 0 · 폰] [여러 페이지] → 옵션 7 · 빨간 줄·이유 줄 0`);
            ok(await sw(pg) <= 390, `[어긋남 0 · 폰] 가로 넘침 없음`);
            await P.ctx.close();
        }
        await mock('/__mock/set', { clean: false, fail: 'report' });
        {
            const P = await open(PC, false, null, ADMIN), pg = P.pg;
            await pg.click('#desk-price-now'); await loaded(pg); await pg.waitForTimeout(300);
            const e = await pg.evaluate(() => ({ t: document.getElementById('pc-note').textContent, k: document.getElementById('pc-note').dataset.k, out: document.getElementById('pc-out').textContent, dis: document.getElementById('pc-refresh').disabled, when: document.getElementById('pc-when').hidden }));
            ok(e.k === 'err' && /가격을 불러오지 못했어요/.test(e.t) && /네이버 스냅샷을 읽지 못했습니다/.test(e.t) && /아직 불러온 가격이 없어요/.test(e.out) && !e.dis && e.when, `[첫 요청 실패] 빨간 안내(서버 글 포함) + 빈 안내 · [다시 확인] 켜짐`);
            await pg.click('#pc-set > summary'); await pg.waitForTimeout(300);
            ok(/가격을 먼저 불러와야/.test(await pg.locator('#pc-set-list').innerText()) && !P.reqs.some(r => /pages/.test(r)), `[첫 요청 실패] 설정을 펼쳐도 「가격을 먼저 불러와야」 · 요청 0`);
            await mock('/__mock/set', { fail: '' });
            await pg.click('#pc-refresh'); await loaded(pg); await pg.waitForTimeout(400);
            ok((await stat(pg)).groups === 7 && await pg.evaluate(() => document.getElementById('pc-note').hidden) && await pg.locator('#pc-set-list .pc-set-row').count() === 13, `[첫 요청 실패] [다시 확인]으로 복구(안내 사라짐 · 옵션 7 · 펼쳐 둔 설정 줄 13)`);
            ok(P.errors.length === 0, `[첫 요청 실패] 화면 오류 0`);
            await P.ctx.close();
        }
        const writes = (await logOf()).filter(x => x.action === 'other-write');
        ok(writes.length === 0, `가격 카드가 다른 쓰기 요청을 만들지 않음(${writes.length})`);
    } catch (e) { fail++; console.log('  ❌ 검증 중 예외: ' + (e.stack || e.message)); }
    finally { await browser.close().catch(() => { }); srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}` + (fail ? `  (실패 ${fail})` : '  전부 통과'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
