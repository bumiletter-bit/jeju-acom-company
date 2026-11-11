// #1110-4 화면 검증 — 문의 관리 「응대 현황」 탭(숫자 카드·채팅 미리보기·쓴 재료 링크) + #1111-B 알림 종 「🟥 확인 필요」 맨 위·빨강 띠·알림 링크
//   실행: node scripts/verify-1110-4-ui.js   (가짜 서버 scripts/_mock-1110.js · 포트 PORT1110 또는 3458 · DB·외부·AI 0 · 앱 전체 CSS 그대로)
const path = require('path'); const { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = Number(process.env.PORT1110) || 3458, BASE = 'http://localhost:' + PORT;
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; if (!c) console.log('  ❌ ' + t + (d != null ? ' — ' + String(d).slice(0, 400) : '')); };
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const getLog = () => fetch(BASE + '/__mock/log').then(r => r.json());
const USERS = { owner: { id: 1, username: 'owner', name: '전승범', role: 'admin', position: '대표' }, staff: { id: 7, username: 'staff', name: '김민주', role: 'user', position: '사원' } };
const iso = minAgo => new Date(Date.now() - minAgo * 60000).toISOString();
const NOTIS = [
    { id: 5, type: 'info', title: '보통 알림(가장 새것)', message: '보통 글', link: 'documents', isRead: false, createdAt: iso(1) },
    { id: 4, type: 'cs', title: '🟥 확인 필요 · 가격 어긋남 2곳', message: '타이벡 3kg 네이버 19,800 ↔ 쿠팡 20,800\n→ 전체 가격 확인하기에서 확인', link: 'agent-office?price=1', level: 'alert', isRead: false, createdAt: iso(30) },
    { id: 3, type: 'info', title: '보통 알림 둘', message: '보통 글 둘', link: 'inquiry', isRead: false, createdAt: iso(40) },
    { id: 2, type: 'cs', title: '🟥 확인 필요 · 6시간 넘게 답 안 한 문의 3건', message: '→ 손님 연락에서 확인', link: 'agent-office?inbox=open', isRead: false, createdAt: iso(90) },   // level 칸 없는 옛 꼴 = 제목 머리로 판정
    { id: 1, type: 'cs', title: '🟥 확인 필요 · 읽은 것', message: '이미 읽음', link: 'rankings', level: 'alert', isRead: true, createdAt: iso(200) },
];

async function open(br, w, h, who, ls, rv) {
    await post('/__mock/reset'); await post('/__mock/user', USERS[who]); await post('/__mock/set', { rv: rv || {}, notis: NOTIS });
    const ctx = await br.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([u, extra]) => { try { localStorage.setItem('jwt_token', 'x'); localStorage.setItem('jwt_user', JSON.stringify(u)); for (const k in extra) localStorage.setItem(k, extra[k]); } catch (e) { } }, [USERS[who], ls || { akm_last_page: 'inquiry' }]);
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|초기화 오류|renderSettlement|선결제 목록 오류|주간 정산 현황 오류|rankings load error/.test(m.text())) errs.push('console: ' + m.text()); });   // 가짜 서버가 다른 메뉴 목록을 빈 값으로 줘서 나는 잡음은 뺀다(응대 현황·문의 관리 오류는 그대로 잡힘)
    await page.goto(BASE + '/', { waitUntil: 'load' }); await page.waitForTimeout(1000);
    return { ctx, page, errs };
}
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
const txt = (page, sel) => page.evaluate(s => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim(), sel);
const logMsgs = page => page.evaluate(() => Array.from(document.querySelectorAll('#rv-log .rv-msg')).map(e => ({ cls: e.className.replace('rv-msg ', ''), t: e.textContent.replace(/\s+/g, ' ').trim() })));
const ask = async (page, text) => { await page.fill('#rv-text', text); await page.click('#rv-send'); await page.waitForFunction(() => !document.querySelector('#rv-log .rv-msg.wait'), null, { timeout: 8000 }); await page.waitForTimeout(150); };

(async () => {
    let br, code = 1, srv;
    try {
        srv = spawn('node', [path.join(__dirname, '_mock-1110.js'), String(PORT)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 900));
        br = await chromium.launch();
        for (const [w, h] of [[390, 844], [900, 800], [1280, 860]]) for (const who of ['owner', 'staff']) {
            const tag = `[${w}·${who}] `;
            const o = await open(br, w, h, who); const { page } = o;
            // ── 기본 탭·배치
            const st = await page.evaluate(() => ({ act: document.querySelector('#page-inquiry > .settlement-tab-bar > .settlement-tab.active')?.id, ov: getComputedStyle(document.getElementById('inquiry-tab-overview')).display, sc: getComputedStyle(document.getElementById('inquiry-tab-scenario')).display, head: getComputedStyle(document.getElementById('inquiry-mat-head')).display }));
            ok(st.act === 'inquiry-tab-btn-overview' && st.ov !== 'none' && st.sc === 'none' && st.head === 'none', tag + '기본 탭 = 응대 현황', JSON.stringify(st));
            ok(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)) === 0, tag + '가로 넘침 0');
            const bar = await page.evaluate(() => { const b = document.querySelector('#page-inquiry > .settlement-tab-bar'); const ts = Array.from(b.querySelectorAll('.settlement-tab')).filter(x => getComputedStyle(x).display !== 'none'); const tops = new Set(ts.map(x => Math.round(x.getBoundingClientRect().top))); return { n: ts.length, rows: tops.size, scroll: b.scrollWidth > b.clientWidth + 1 }; });
            ok(bar.n === 6 && bar.rows === 1, tag + '탭 6개 한 줄' + (bar.scroll ? '(가로 밀기)' : ''), JSON.stringify(bar));
            const cols = await page.evaluate(() => { const l = document.querySelector('.rv-left').getBoundingClientRect(), r = document.querySelector('.rv-right').getBoundingClientRect(); return { side: Math.abs(l.top - r.top) < 40 && r.left > l.right - 2, lw: Math.round(l.width), rw: Math.round(r.width) }; });
            ok(w >= 900 ? cols.side : !cols.side, tag + (w >= 900 ? '두 칸(왼쪽 설정·오른쪽 채팅)' : '한 칸(폰)'), JSON.stringify(cols));
            // ── 숫자 카드
            ok(await txt(page, '#rv-nums') === '48%봇이 답함53건 36%직원이 답함32건 5건아직 안 답함눌러서 답하러 가기'.replace(/ /g, ' ') || /59%봇이 답함53건/.test(await txt(page, '#rv-nums')), tag + '전체 숫자(53/90 = 59%)', await txt(page, '#rv-nums'));
            ok(/36%직원이 답함32건/.test(await txt(page, '#rv-nums')) && /5건아직 안 답함/.test(await txt(page, '#rv-nums')), tag + '직원 36% · 안 답함 5건');
            await page.evaluate(() => window.rvSetCh('talk')); ok(/40%봇이 답함20건/.test(await txt(page, '#rv-nums')) && /50%직원이 답함25건/.test(await txt(page, '#rv-nums')), tag + '톡톡 알약', await txt(page, '#rv-nums'));
            await page.evaluate(() => window.rvSetCh('inquiry')); ok(/최근 7일 손님 글이 없어요/.test(await txt(page, '#rv-nums')), tag + '0건 채널 빈 안내');
            await page.evaluate(() => window.rvSetCh('sms')); ok(/이 채널 숫자를 못 읽었어요/.test(await txt(page, '#rv-nums')), tag + '못 읽은 채널(null) 안내');
            await page.evaluate(() => window.rvSetCh('all')); await page.evaluate(() => window.rvSetDays(30)); await page.waitForTimeout(400);
            ok(/38%봇이 답함133건/.test(await txt(page, '#rv-nums')) && /27건아직 안 답함/.test(await txt(page, '#rv-nums')) && await page.evaluate(() => document.querySelector('#rv-days .settlement-tab.active').textContent === '30일'), tag + '30일 = 다시 읽어 다른 값', await txt(page, '#rv-nums'));
            await page.evaluate(() => window.rvSetDays(7)); await page.waitForTimeout(400);
            ok(/손님 대화 기준/.test(await txt(page, '#rv-range')) && /11\/05 ~ 11\/11/.test(await txt(page, '#rv-range')), tag + '기간·기준 한 줄', await txt(page, '#rv-range'));
            // ── 사용 설정(이 탭으로 옮김 · id 하나)
            ok(await page.evaluate(() => document.querySelectorAll('#inquiry-auto-reply-toggle').length === 1 && !!document.querySelector('#rv-settings #inquiry-auto-reply-toggle') && !!document.querySelector('#rv-settings #inq-set-qna') && !document.querySelector('#inquiry-mat-head #inq-set-qna')), tag + '사용 설정 = 응대 현황 탭 안(한 곳)');
            ok(/상품문의 자동 등록/.test(await txt(page, '#inq-set-qna')) && /켜짐/.test(await txt(page, '#inq-set-qna')) && /꺼짐/.test(await txt(page, '#inq-set-userinq')), tag + '자동 등록 상태(숫자 API 값)');
            ok(/문자 초안\(사람이 보냄\)/.test(await txt(page, '#rv-set-more')) && /톡톡 하루 1번 답\(매일 9시 새로\)/.test(await txt(page, '#rv-set-more')), tag + '보기만 2칸(문자 모드·톡톡 하루 1번)', await txt(page, '#rv-set-more'));
            const g = (await getLog()).gets;
            ok(g.includes('/api/agent-office/response-stats') && !g.includes('/api/agent-office/naver/qnas') && !g.includes('/api/agent-office/naver/inquiries'), tag + '진입 때 목록 GET 2번 안 부름(숫자 API 한 길)', g.filter(x => /naver\/(qnas|inquiries)|response-stats/.test(x)).join(','));
            if (who === 'owner') {
                ok(await vis(page, '#inquiry-auto-reply-wrap') === true && await page.evaluate(() => !!document.querySelector('#inq-set-qna input') && !!document.querySelector('#inq-set-userinq input')), tag + '대표 = 스위치 3개');
                await page.click('#inq-set-userinq input'); await page.waitForTimeout(400);
                const a = (await getLog()).log.find(x => x.p === '/api/agent-office/naver/inquiry-auto-post');
                ok(a && a.body.enabled === true && /켜짐/.test(await txt(page, '#inq-set-userinq')), tag + '고객문의 스위치 켬 → 종전 PUT', JSON.stringify(a));
            } else ok(await vis(page, '#inquiry-auto-reply-wrap') === false && await page.evaluate(() => !document.querySelector('#rv-settings input[type=checkbox]:not(#inquiry-auto-reply-toggle)')), tag + '직원 = 스위치 없음(상태만)');
            // ── 미리보기: 처음 · 칩 · 답 · 쓴 재료
            ok(/손님이 물어볼 만한 질문을 넣어 보세요/.test(await txt(page, '#rv-log')), tag + '처음 빈 안내');
            ok(await page.evaluate(() => document.querySelectorAll('#rv-chips .rv-chip').length) === 8, tag + '칩 8개');
            ok(/오늘 남은 미리보기 97번/.test(await txt(page, '#rv-foot')) && /보내거나 기록하지 않아요/.test(await txt(page, '#rv-foot')) && /톡톡은 재료를 고친 뒤 최대 5분/.test(await txt(page, '#rv-foot')), tag + '아래 안내(남은 횟수·기록 안 함·톡톡 차이)', await txt(page, '#rv-foot'));
            await page.click('#rv-chips .rv-chip'); await page.waitForFunction(() => !document.querySelector('#rv-log .rv-msg.wait') && document.querySelectorAll('#rv-log .rv-msg').length >= 2, null, { timeout: 8000 });
            let ms = await logMsgs(page);
            ok(ms.length === 2 && ms[0].cls === 'me' && ms[0].t === '사이즈 지정 되나요?' && /^bot/.test(ms[1].cls) && /\[talk\] 사이즈 지정 되나요\? 에 대한 답이에요/.test(ms[1].t), tag + '칩 → 손님 말풍선 + 봇 답(톡톡)', JSON.stringify(ms));
            ok(/쓴 재료: 시나리오 16/.test(ms[1].t) && /2\.1초/.test(ms[1].t), tag + '쓴 재료·걸린 시간');
            ok(/실제 답과 조금 다를 수 있어요\(사진 요청 줄 생략 등\)/.test(ms[1].t), tag + '#1110-4b 톡톡 답 아래 「실제와 조금 다를 수 있어요」 한 줄');
            const sent = (await getLog()).log.filter(x => x.p === '/api/agent-office/response-preview').pop();
            ok(sent && sent.body.channel === 'talk' && sent.body.text === '사이즈 지정 되나요?', tag + '요청 꼴 { channel, text }', JSON.stringify(sent && sent.body));
            ok(/오늘 남은 미리보기 96번/.test(await txt(page, '#rv-foot')), tag + '남은 횟수 줄어듦');
            // 채널 바꿔 묻기 + 재료 2개(하나는 없는 번호) + HTML 글자 그대로
            await page.evaluate(() => window.rvSetPch('qna')); ok(/상품문의\(공개 게시판\)/.test(await txt(page, '#rv-foot')), tag + '채널 바꾸면 안내 글 바뀜');
            await post('/__mock/set', { rv: { next: 'two' } }); await ask(page, '두 재료 <i>글</i>');
            ms = await logMsgs(page);
            ok(ms.length === 4 && ms[2].t === '두 재료 <i>글</i>' && /<b>굵게<\/b> 아님 & 그대로/.test(ms[3].t) && await page.evaluate(() => !document.querySelector('#rv-log .rv-msg b:not(.x)') || Array.from(document.querySelectorAll('#rv-log .rv-msg.bot b')).length === 0), tag + '답·질문의 태그 글자는 그대로 보임(끼워 넣기 0)', JSON.stringify(ms.slice(2)));
            ok(/시나리오 16 · 시나리오 99/.test(ms[3].t) && await page.evaluate(() => { const last = Array.from(document.querySelectorAll('#rv-log .rv-msg.bot')).pop(); return last.querySelectorAll('button.rv-link').length === 1 && last.querySelector('.rv-meta span') != null; }), tag + '아는 번호만 링크 · 모르는 번호는 글자만');
            ok(await page.evaluate(() => /줄\s*$/.test(Array.from(document.querySelectorAll('#rv-log .rv-msg.bot')).pop().firstChild.textContent) && getComputedStyle(document.querySelector('#rv-log .rv-msg.bot')).whiteSpace.startsWith('pre')), tag + '줄바꿈 유지');
            // 가격 즉답 · 넘김 · 오류 · 상한 · 준비 중
            await post('/__mock/set', { rv: { next: 'price' } }); await ask(page, '5kg 얼마예요?'); ms = await logMsgs(page);
            ok(/가격 바로 답\(AI 없이\)/.test(ms[ms.length - 1].t), tag + '가격 즉답 표시');
            ok(!/실제 답과 조금 다를/.test(ms[ms.length - 1].t), tag + '#1110-4b 톡톡 아닌 채널 = 그 안내 줄 없음');
            await page.evaluate(() => window.rvSetPch('sms')); await post('/__mock/set', { rv: { next: 'smsrule' } }); await ask(page, '귤이 물러서 왔어요'); ms = await logMsgs(page);
            ok(/정해 둔 글\(AI 없이\)/.test(ms[ms.length - 1].t) && !/쓴 재료 표시 없음/.test(ms[ms.length - 1].t) && /정해 둔 <b>사과<\/b> 초안이 먼저예요/.test(ms[ms.length - 1].t) && await page.evaluate(() => { const last = Array.from(document.querySelectorAll('#rv-log .rv-msg.bot')).pop(); return !!last.querySelector('.rv-note') && !last.querySelector('.rv-note b'); }), tag + '#1110-4b 문자 불만 = 「정해 둔 글(AI 없이)」 + 안내 줄(글자 그대로)', JSON.stringify(ms[ms.length - 1]));
            await page.evaluate(() => window.rvSetPch('qna'));
            await post('/__mock/set', { rv: { next: 'skip' } }); await ask(page, '감사합니다'); ms = await logMsgs(page);
            ok(ms[ms.length - 1].cls === 'skip' && /봇이 답하지 않아요/.test(ms[ms.length - 1].t) && /답변 재료에서 글 추가하기/.test(ms[ms.length - 1].t), tag + '넘김 = 호박 띠 + 재료 추가 링크', JSON.stringify(ms[ms.length - 1]));
            await post('/__mock/set', { rv: { next: 'err' } }); await ask(page, '오류 나는 글'); ms = await logMsgs(page);
            ok(ms[ms.length - 1].cls === 'err' && /AI 오류/.test(ms[ms.length - 1].t) && /다시 물어보기/.test(ms[ms.length - 1].t), tag + '오류 = 붉은 띠 + 다시 물어보기');
            const n0 = ms.length;
            await page.click('#rv-log [data-rv-retry]'); await page.waitForFunction(() => !document.querySelector('#rv-log .rv-msg.wait') && !document.querySelector('#rv-log .rv-msg.err'), null, { timeout: 8000 }); ms = await logMsgs(page);
            ok(ms.length === n0 && /^bot/.test(ms[ms.length - 1].cls) && /오류 나는 글 에 대한 답/.test(ms[ms.length - 1].t) && ms.filter(m => m.t === '오류 나는 글').length === 1, tag + '다시 물어보기 = 같은 질문 한 번만 · 오류 띠가 답으로 바뀜', JSON.stringify(ms.slice(-2)));
            await post('/__mock/set', { rv: { next: 'day_cap' } }); await ask(page, '상한'); ms = await logMsgs(page);
            ok(ms[ms.length - 1].cls === 'err' && /다 썼어요/.test(ms[ms.length - 1].t) && !/다시 물어보기/.test(ms[ms.length - 1].t) && /오늘 남은 미리보기 0번/.test(await txt(page, '#rv-foot')), tag + '하루 상한 = 다시 단추 없음 · 남은 0번');
            await page.evaluate(() => window.rvSetPch('talk')); await post('/__mock/set', { rv: { next: 'bot_old' } }); await ask(page, '톡톡 준비 중'); ms = await logMsgs(page);
            ok(ms[ms.length - 1].cls === 'err' && /톡톡 미리보기는 준비 중/.test(ms[ms.length - 1].t) && !/다시 물어보기/.test(ms[ms.length - 1].t), tag + '톡톡봇 옛 판 = 「준비 중」 안내(화면 안 죽음)');
            await post('/__mock/set', { rv: { next: '404' } }); await ask(page, '서버에 기능 없음'); ms = await logMsgs(page);
            ok(ms[ms.length - 1].cls === 'err' && /아직 준비 중/.test(ms[ms.length - 1].t), tag + '서버에 주소 없음(404) = 준비 중 안내');
            // 만드는 중: 입력·칩 잠금 · Enter 로 보내기
            await post('/__mock/set', { rv: { delay: 1200 } });
            await page.fill('#rv-text', '엔터로 보내기'); await page.press('#rv-text', 'Enter'); await page.waitForTimeout(250);
            const busy = await page.evaluate(() => ({ send: document.getElementById('rv-send').disabled, ta: document.getElementById('rv-text').disabled, chips: Array.from(document.querySelectorAll('#rv-chips .rv-chip')).every(b => b.disabled), wait: !!document.querySelector('#rv-log .rv-msg.wait'), val: document.getElementById('rv-text').value }));
            ok(busy.send && busy.ta && busy.chips && busy.wait && busy.val === '', tag + 'Enter = 보내기 · 만드는 중 잠금', JSON.stringify(busy));
            await page.waitForFunction(() => !document.querySelector('#rv-log .rv-msg.wait'), null, { timeout: 8000 });
            ok(await page.evaluate(() => !document.getElementById('rv-send').disabled && !document.getElementById('rv-text').disabled), tag + '끝나면 풀림');
            await post('/__mock/set', { rv: { delay: 0 } });
            await page.fill('#rv-text', '첫 줄'); await page.press('#rv-text', 'Shift+Enter'); await page.waitForTimeout(100);
            ok(await page.evaluate(() => /첫 줄\n/.test(document.getElementById('rv-text').value)), tag + 'Shift+Enter = 줄바꿈(안 보냄)'); await page.fill('#rv-text', '');
            // 쓴 재료 → 그 시나리오 편집 → 돌아오면 대화 남음
            const before = (await logMsgs(page)).length;
            await page.evaluate(() => document.querySelector('#rv-log button.rv-link[onclick^="gotoScenario"]').click()); await page.waitForTimeout(500);
            ok(await page.evaluate(() => getComputedStyle(document.getElementById('inquiry-tab-scenario')).display !== 'none' && getComputedStyle(document.getElementById('inquiry-edit-card')).display !== 'none' && /#16/.test(document.getElementById('inquiry-edit-title').textContent) && getComputedStyle(document.getElementById('inquiry-mat-head')).display !== 'none'), tag + '「시나리오 16」 → 답변 재료 탭 그 글 편집 카드');
            await page.evaluate(() => window.switchInquiryTab('overview')); await page.waitForTimeout(300);
            ok((await logMsgs(page)).length === before && await page.evaluate(() => getComputedStyle(document.getElementById('inquiry-mat-head')).display === 'none'), tag + '돌아오면 대화 그대로 · 답변 재료 머리 숨김');
            ok(/늘 쓰는 글 4개 보기/.test(await txt(page, '#rv-mat-links')) && /기간 있는 글 4개 보기\(오늘 적용 2\)/.test(await txt(page, '#rv-mat-links')), tag + '연결된 재료 수', await txt(page, '#rv-mat-links'));
            await page.evaluate(() => document.querySelectorAll('#rv-mat-links .rv-link')[1].click()); await page.waitForTimeout(400);
            ok(await page.evaluate(() => getComputedStyle(document.getElementById('inquiry-tab-season')).display !== 'none'), tag + '기간 있는 글 링크 → 그 칸');
            // 닿는 크기(폰)
            if (w === 390) {
                await page.evaluate(() => window.switchInquiryTab('overview')); await page.waitForTimeout(300);
                const hs = await page.evaluate(() => ['#rv-send', '#rv-text', '#rv-chips .rv-chip', '#rv-ch .settlement-tab', '#rv-pch .settlement-tab'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().height)));
                ok(hs.every(x => x >= 44), tag + '폰 닿는 높이 ≥44(보내기·입력·칩·알약)', hs.join(','));
                ok(await page.evaluate(() => { const g = document.querySelector('.rv-grid').getBoundingClientRect(); return g.right <= window.innerWidth + 1 && g.left >= 0; }), tag + '폰 화면 안');
            }
            ok(o.errs.length === 0, tag + '콘솔 오류 0', o.errs.slice(0, 3).join(' | '));
            await o.ctx.close();
        }
        // ── 숫자 API 가 없거나(옛 서버) 실패할 때 = 종전 길로 물러남 · 화면 안 죽음
        for (const mode of ['404', '500']) {
            const o = await open(br, 1280, 860, 'owner', null, { stats: mode }); const { page } = o; const tag = `[숫자 API ${mode}] `;
            ok(/숫자를 못 읽었어요/.test(await txt(page, '#rv-nums')) && /다시 읽기/.test(await txt(page, '#rv-nums')), tag + '숫자 자리 안내 + 다시 읽기');
            const g = (await getLog()).gets;
            ok(g.includes('/api/agent-office/naver/qnas') && g.includes('/api/agent-office/naver/inquiries') && /켜짐/.test(await txt(page, '#inq-set-qna')), tag + '스위치 상태는 종전 목록 GET 으로');
            await ask(page, '숫자가 없어도 물어보기'); ok(/에 대한 답이에요/.test((await logMsgs(page)).pop().t), tag + '미리보기는 계속 됨');
            await post('/__mock/set', { rv: { stats: 'ok' } }); await page.evaluate(() => document.querySelector('#rv-nums .rv-link').click()); await page.waitForTimeout(500);
            ok(/봇이 답함/.test(await txt(page, '#rv-nums')), tag + '[다시 읽기] 뒤 숫자 나옴');
            await o.ctx.close();
        }
        // ── 새로고침 복원: 옛 값(scenario)은 그대로 존중 · 숨긴 탭 값은 답변 재료로
        { const o = await open(br, 1280, 860, 'staff', { akm_last_page: 'inquiry', akm_inq_tab: 'scenario' });
          ok(await o.page.evaluate(() => document.querySelector('#page-inquiry > .settlement-tab-bar > .settlement-tab.active')?.id === 'inquiry-tab-btn-scenario' && getComputedStyle(document.getElementById('inquiry-tab-overview')).display === 'none' && getComputedStyle(document.getElementById('inquiry-mat-head')).display !== 'none'), '[복원] 저장된 답변 재료 탭 그대로');
          ok(/켜짐/.test(await txt(o.page, '#inq-set-qna')), '[복원] 다른 탭으로 들어와도 스위치 상태는 채워 둠'); await o.ctx.close(); }
        { const o = await open(br, 1280, 860, 'staff', { akm_last_page: 'inquiry', akm_inq_tab: 'overview' });
          ok(await o.page.evaluate(() => document.querySelector('#page-inquiry > .settlement-tab-bar > .settlement-tab.active')?.id === 'inquiry-tab-btn-overview') && /봇이 답함/.test(await txt(o.page, '#rv-nums')), '[복원] 저장된 응대 현황 탭'); await o.ctx.close(); }
        // ── #1111-B 알림 종: 확인 필요(안 읽은 것) 맨 위 + 빨강 띠 · 링크
        for (const [w, h] of [[390, 844], [1280, 860]]) {
            const o = await open(br, w, h, 'owner', { akm_last_page: 'inquiry' }); const { page } = o; const tag = `[알림 종 ${w}] `;
            await page.evaluate(() => renderNotificationList()); await page.waitForTimeout(400);
            const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#noti-list .noti-hist-item')).map(e => ({ id: Number(e.dataset.id), alert: e.classList.contains('nh-alert'), bg: getComputedStyle(e).backgroundColor, sh: getComputedStyle(e).boxShadow })));
            ok(rows.map(r => r.id).join(',') === '4,2,5,3', tag + '순서 = 확인 필요(4·2) 먼저 · 나머지 종전 순서(5·3) · 읽은 것(1)은 없음', rows.map(r => r.id).join(','));
            ok(rows[0].alert && rows[1].alert && !rows[2].alert && !rows[3].alert, tag + 'level alert + 제목 머리 🟥(옛 꼴) 둘 다 표시');
            ok(rows[0].bg !== rows[2].bg && /240, 68, 56|rgb\(240/.test(rows[0].sh), tag + '빨강 띠·바탕이 보통 알림과 다름', rows[0].bg + ' / ' + rows[0].sh + ' ↔ ' + rows[2].bg);
            await o.ctx.close();
        }
        { const o = await open(br, 1280, 860, 'owner', { akm_last_page: 'inquiry' }); const { page } = o;
          for (const [link, pg] of [['inquiry', 'page-inquiry'], ['rankings', 'page-rankings'], ['settlement', 'page-settlement']]) { await page.evaluate(l => window.notiGo(l), link); await page.waitForTimeout(400); ok(await page.evaluate(id => document.getElementById(id)?.classList.contains('active'), pg), '[알림 링크] ' + link + ' → 그 메뉴'); }
          await page.evaluate(() => { window.__clicked = []; document.addEventListener('click', e => { const b = e.target.closest('#desk-price-now, #desk-plus [data-mk="inb"]'); if (b) window.__clicked.push(b.dataset.mk === 'inb' ? 'inb' : b.id); }, true); });
          await page.evaluate(() => window.notiGo('agent-office?price=1')); await page.waitForTimeout(1500);
          ok(await page.evaluate(() => document.getElementById('page-agent-office')?.classList.contains('active') && window.__clicked.includes('desk-price-now')), '[알림 링크] agent-office?price=1 → 에이전트 오피스 「전체 가격 확인하기」 누름');
          await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.keyboard.press('Escape');
          await page.evaluate(() => { window.__inb = 0; if (window.AkmAoDesk) { const f = window.AkmAoDesk.openInbox; window.AkmAoDesk.openInbox = function () { window.__inb++; return f.apply(this, arguments); }; } });
          await page.evaluate(() => window.notiGo('agent-office?inbox=open')); await page.waitForTimeout(1500);
          ok(await page.evaluate(() => window.__clicked.includes('inb') || window.__inb > 0), '[알림 링크] agent-office?inbox=open → 손님 연락 열기 시도');
          ok(o.errs.length === 0, '[알림 링크] 콘솔 오류 0', o.errs.slice(0, 3).join(' | ')); await o.ctx.close(); }
        code = fail ? 1 : 0;
    } catch (e) { console.error('검증 오류:', e); }
    finally { if (br) await br.close(); if (srv) srv.kill(); }
    console.log(`#1110-4 화면 검증: 통과 ${pass} · 실패 ${fail}`);
    process.exit(code);
})();
