// #658 화면 검증: 문자 전용 창의 톡톡 | 상품문의 | 주문문의 탭(public/ao-inbox.js · ao-inbox.css) — 가짜 서버(scripts/_mock-658.js) + Playwright 실클릭
//   실행: node scripts/verify-658-ui.js   (포트 3466 · PORT658 로 바꿈 · DB·외부 호출 0)
//   시험 화면 = /__inbox.html(문자 창과 같은 틀에 탭 줄과 #inb-host 만 · ao-desk.js 없이) — ao-desk.js 탭 줄이 붙은 뒤의 합친 검증은 따로.
const path = require('path'); const fs = require('fs'); const { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = Number(process.env.PORT658) || 3466, BASE = 'http://localhost:' + PORT;
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 300) : '')); return !!c; };
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const log = () => fetch(BASE + '/__mock/log').then(r => r.json());
const row = id => `#inb-list .sms-item[data-id="${id}"] .sms-row`;
const toastOf = pg => pg.evaluate(() => [...document.querySelectorAll('.toast-message')].map(n => n.textContent).join(' | '));

(async () => {
    const srv = spawn('node', [path.join(__dirname, '_mock-658.js'), String(PORT)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 900));
    let br, code = 1;
    try {
        br = await chromium.launch();
        const open = async (q, vp, mobile) => { const ctx = await br.newContext({ viewport: vp || { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); }); await pg.goto(BASE + '/__inbox.html?' + (q || 'ch=talk')); await pg.waitForFunction(() => document.querySelector('#inb-list li'), null, { timeout: 8000 }); await pg.waitForTimeout(250); return { ctx, pg, errs }; };

        console.log('① 목록·탭');
        await post('/__mock/reset');
        let a = await open('ch=talk');
        let L = await a.pg.evaluate(() => [...document.querySelectorAll('#inb-list .sms-item')].map(li => ({ id: li.dataset.id, un: li.dataset.un, cls: li.className, title: li.querySelector('.inb-title').textContent, why: (li.querySelector('.sms-why') || {}).textContent || '', badge: (li.querySelector('.sms-un') || {}).textContent || '' })));
        ok(L.length === 5 && L.every(x => /unread/.test(x.cls)) && !L.some(x => x.id === 't4'), '톡톡 탭: 안 읽은 대화만 5건(읽은 t4 는 없음) · 전부 안 읽음 표시', L.map(x => x.id + ':' + x.badge).join(' '));
        ok(L.find(x => x.id === 't2').why === '불만·클레임' && L.find(x => x.id === 't1').badge === '2', '줄: 사람 답이 필요한 사유 표식 · 안 읽은 글 수 배지');
        ok(await a.pg.evaluate(() => { const c = window.__counts; return c && c.talk.unread === 5 && c.talk.needs === 5 && c.qna.unread === 2 && c.qna.needs === 2 && c.inquiry.unread === 1 && c.inquiry.needs === 2 && AkmInbox.available() === true && JSON.stringify(AkmInbox.counts()) === JSON.stringify(c); }), 'onCounts·counts(): 안 읽음 톡톡 5 · 상품문의 2 · 주문문의 1 / 답 안 한 것 5 · 2 · 2 · available() true');
        const tint = await a.pg.evaluate(() => { const u = getComputedStyle(document.querySelector('#inb-list .sms-item.unread .sms-row')).backgroundColor, c = getComputedStyle(document.querySelector('.sms-win')).backgroundColor; return [u, c]; });
        ok(tint[0] !== tint[1] && tint[0] !== 'rgba(0, 0, 0, 0)', '안 읽은 줄에 명암(바탕이 창 바탕과 다름)', tint.join(' / '));
        await a.pg.click('#sms-tabs [data-ch="qna"]'); await a.pg.waitForSelector(row('q1'));
        L = await a.pg.evaluate(() => [...document.querySelectorAll('#inb-list .sms-item')].map(li => li.dataset.id + (li.querySelector('.sms-tag') ? '+초안' : '') + (li.querySelector('.sms-hint') ? '+sub' : '')));
        ok(L.join() === 'q1+초안+sub,q2+sub' && await a.pg.getAttribute('#inb-q', 'placeholder') === '상품·글로 찾기', '상품문의 탭으로 바꿈: 2건 · 초안 표시 · 상품문의 찾기 칸', L.join());
        await a.pg.click('#sms-tabs [data-ch="inquiry"]'); await a.pg.waitForSelector(row('i1'));
        ok(await a.pg.locator('#inb-list .sms-item').count() === 1 && (await a.pg.textContent('#inb-open')).replace(/\s+/g, ' ') === '답 안 한 것 2', '주문문의 탭: 새 글 1건 · [답 안 한 것 2] 단추');
        await a.pg.click('#inb-open'); await a.pg.waitForSelector(row('i2'));
        ok(await a.pg.locator('#inb-list .sms-item').count() === 2 && await a.pg.getAttribute('#inb-open', 'aria-pressed') === 'true' && /답 안 한 것만 · 2건/.test(await a.pg.textContent('#inb-count')) && await a.pg.evaluate(() => !document.querySelector('#inb-list .sms-item[data-id="i2"]').classList.contains('unread') && document.querySelector('#inb-list .sms-item[data-id="i2"]').classList.contains('needs')), '[답 안 한 것] → 읽었어도 아직 답 안 한 대화까지 2건(scope=open) · 단추 켜짐');
        await a.pg.click('#inb-open'); await a.pg.waitForFunction(() => document.querySelectorAll('#inb-list .sms-item').length === 1);

        console.log('② 열면 읽음 · 대화');
        await a.pg.click('#sms-tabs [data-ch="talk"]'); await a.pg.waitForSelector(row('t2'));
        await a.pg.click(row('t2')); await a.pg.waitForSelector('#inb-msgs .sms-msg');
        let lg = await log();
        ok(lg.log.some(x => x.op === 'get' && x.id === 't2' && !x.peek) && lg.threads.find(t => t.id === 't2').read, '대화를 열면 서버에 읽음(peek 아님)');
        const th = await a.pg.evaluate(() => ({ msgs: document.querySelectorAll('#inb-msgs .sms-msg').length, out: document.querySelectorAll('#inb-msgs .sms-msg.out').length, who: (document.querySelector('#inb-msgs .sms-msg.out small') || {}).textContent, img: !!document.querySelector('#inb-msgs .sms-thumb img[src]'), title: document.getElementById('inb-th-title').textContent, why: document.getElementById('inb-th-badge').textContent, dot: getComputedStyle(document.querySelector('.inb-dot')).backgroundColor, un: document.querySelector('#inb-list .sms-item[data-id="t2"]').dataset.un, on: window.__on.slice(), open: AkmInbox.isOpen(), pub: !!document.getElementById('inb-public'), mk: !!document.getElementById('inb-mkdraft'), send: document.getElementById('inb-send').textContent, dis: document.getElementById('inb-send').disabled }));
        ok(th.msgs === 4 && th.out === 1 && /^봇 · /.test(th.who) && th.img && th.title === '한라산바람' && th.why === '불만·클레임', '대화: 글 4개 · 봇 답 표시 · 사진 · 머리 이름·사유', JSON.stringify(th).slice(0, 200));
        ok(th.un === '0' && th.on.join() === 'true' && th.open, '연 줄의 배지 사라짐 · onThread(true) 1번 · isOpen()');
        ok(!th.pub && th.mk && th.send === '답 보내기' && th.dis, '톡톡 입력 칸: [초안 만들기] 있음 · 공개 게시판 줄 없음 · 빈 칸이면 보내기 꺼짐');
        await a.pg.click(row('t1')); await a.pg.waitForFunction(() => document.getElementById('inb-th-title').textContent === '귤좋아');
        ok(await a.pg.evaluate(() => window.__on.join()) === 'true', '다른 대화로 옮길 때는 onThread 를 안 부름');
        await a.pg.click('#inb-scope'); await a.pg.waitForSelector(row('t4')); await a.pg.click(row('t2'));   /* 읽은 대화는 새 글 목록에서 빠지므로 이전 대화까지 펴 놓고 이어 간다 */ await a.pg.waitForFunction(() => document.getElementById('inb-th-title').textContent === '한라산바람');
        await a.pg.click('#inb-msgs .sms-thumb'); await a.pg.waitForTimeout(150);
        const v1 = await a.pg.evaluate(() => !document.getElementById('inb-view').hidden && !!document.getElementById('inb-view-img').getAttribute('src'));
        const b1 = await a.pg.evaluate(() => [AkmInbox.back(), document.getElementById('inb-view').hidden, AkmInbox.isOpen()]);
        ok(v1 && b1.join() === 'true,true,true', '사진 크게 보기 → back() = 사진만 닫음(대화는 그대로)', b1.join());

        console.log('③ 톡톡 보내기 · 초안');
        await a.pg.fill('#inb-text', '직접 적은 답입니다'); await a.pg.click('#inb-send'); await a.pg.waitForFunction(() => document.querySelectorAll('#inb-msgs .sms-msg.out').length === 2, null, { timeout: 8000 });
        lg = await log(); let s = lg.log.filter(x => x.op === 'send').pop();
        ok(s && s.ch === 'talk' && s.id === 't2' && s.text === '직접 적은 답입니다' && s.seen === '' && /톡톡으로 답을 보냈어요/.test(await toastOf(a.pg)) && await a.pg.inputValue('#inb-text') === '', '톡톡 답 보내기: 서버에 글·seen 빈 값 · 칸 비움 · 안내 · 대화에 내 답이 붙음', JSON.stringify(s));
        await a.pg.click(row('t1')); await a.pg.waitForFunction(() => document.getElementById('inb-th-title').textContent === '귤좋아'); await a.pg.waitForSelector('#inb-mkdraft:not([disabled])');
        await a.pg.click('#inb-mkdraft'); await a.pg.waitForFunction(() => document.getElementById('inb-text').value.length > 5, null, { timeout: 8000 });
        const d1 = await a.pg.evaluate(() => ({ v: document.getElementById('inb-text').value, band: !document.getElementById('inb-draft').hidden, send: document.getElementById('inb-send').textContent, mk: document.getElementById('inb-mkdraft').textContent }));
        ok(/봇 초안 1/.test(d1.v) && d1.band && d1.send === '이대로 보내기' && d1.mk === '초안 다시 만들기', '[초안 만들기] → 칸에 초안 · 안내 띠 · 단추 「이대로 보내기」', JSON.stringify(d1).slice(0, 160));
        await a.pg.fill('#inb-text', d1.v + ' 고쳐 씀'); ok(await a.pg.textContent('#inb-send') === '고쳐서 보내기', '초안을 고치면 「고쳐서 보내기」');
        await a.pg.click('#inb-mkdraft'); await a.pg.waitForSelector('#inb-draft-new', { timeout: 8000 });
        ok(/고쳐 씀$/.test(await a.pg.inputValue('#inb-text')), '적던 글이 있으면 새 초안이 덮지 않음 · [새 초안으로 바꾸기] 안내');
        await a.pg.click('#inb-draft-new'); ok(/봇 초안 2/.test(await a.pg.inputValue('#inb-text')) && await a.pg.textContent('#inb-send') === '이대로 보내기', '[새 초안으로 바꾸기] → 칸이 새 초안으로');
        await post('/__mock/set', { swap: '서버에서 바뀐 초안입니다' });
        await a.pg.click('#inb-send'); await a.pg.waitForFunction(() => document.getElementById('inb-text').value === '서버에서 바뀐 초안입니다', null, { timeout: 8000 });
        lg = await log();
        ok(lg.log.some(x => x.op === 'conflict') && !lg.log.some(x => x.op === 'send' && x.id === 't1') && /초안이 바뀌었어요/.test(await toastOf(a.pg)), '화면이 본 초안(seen)과 서버 초안이 다르면 409 → 안 나감 · 칸이 새 초안으로 · 안내');
        await a.pg.waitForTimeout(900); await a.pg.click('#inb-send'); await a.pg.waitForFunction(() => document.querySelectorAll('#inb-msgs .sms-msg.out').length === 1, null, { timeout: 8000 });
        lg = await log(); s = lg.log.filter(x => x.op === 'send').pop();
        ok(s.id === 't1' && s.text === '서버에서 바뀐 초안입니다' && s.seen === '서버에서 바뀐 초안입니다', '다시 누르면 본 초안 그대로 나감(seen = 그 초안)', JSON.stringify(s));
        await post('/__mock/set', { fail: 'send' });
        await a.pg.click(row('t3')); await a.pg.waitForFunction(() => document.getElementById('inb-th-title').textContent === '노을진바다'); await a.pg.waitForSelector('#inb-text');
        await a.pg.fill('#inb-text', '보내다 실패할 글'); await a.pg.keyboard.press('Control+Enter'); await a.pg.waitForFunction(() => /보내지 못했어요/.test([...document.querySelectorAll('.toast-message')].map(n => n.textContent).join()), null, { timeout: 8000 });
        ok(await a.pg.inputValue('#inb-text') === '보내다 실패할 글' && /네이버가 거절했어요/.test(await toastOf(a.pg)), '보내기 실패: 글은 칸에 그대로 · 사유 안내(Ctrl+Enter 로 보냄)');
        await post('/__mock/set', { fail: 'draft' }); await a.pg.fill('#inb-text', ''); await a.pg.click('#inb-mkdraft'); await a.pg.waitForFunction(() => /초안을 만들지 못했어요/.test([...document.querySelectorAll('.toast-message')].map(n => n.textContent).join()), null, { timeout: 8000 });
        ok(await a.pg.inputValue('#inb-text') === '' && await a.pg.isEnabled('#inb-mkdraft'), '초안 만들기 실패: 안내 · 단추 다시 켜짐');
        await post('/__mock/set', { fail: '' });
        await a.pg.fill('#inb-text', '적다 만 글'); await a.pg.click(row('t6')); await a.pg.waitForFunction(() => /긴 대화명/.test(document.getElementById('inb-th-title').textContent)); await a.pg.click(row('t3')); await a.pg.waitForFunction(() => document.getElementById('inb-th-title').textContent === '노을진바다'); await a.pg.waitForSelector('#inb-text');
        ok(await a.pg.inputValue('#inb-text') === '적다 만 글', '적던 글은 다른 대화를 보고 와도 그대로');
        await a.pg.click(row('t5')); await a.pg.waitForSelector('.inb-lock');
        const lk = await a.pg.evaluate(() => ({ t: document.querySelector('.inb-lock').textContent, k: document.querySelector('.inb-lock').dataset.k, ta: !!document.getElementById('inb-text') }));
        ok(/카카오 채널 대화는 여기서 보낼 수 없어요/.test(lk.t) && lk.k === 'lock' && !lk.ta, '카카오 대화: 입력 칸 대신 보낼 수 없는 사유', lk.t);

        console.log('④ 안 읽음으로 · 이전 대화 · 찾기 · 접기');
        await a.pg.click(row('t3')); await a.pg.waitForSelector('#inb-unread'); await a.pg.fill('#inb-text', ''); const onBefore = await a.pg.evaluate(() => window.__on.length);
        await a.pg.click('#inb-unread'); await a.pg.waitForFunction(() => !AkmInbox.isOpen()); await a.pg.waitForTimeout(500);
        lg = await log();
        ok(lg.log.some(x => x.op === 'unread' && x.id === 't3') && !lg.threads.find(t => t.id === 't3').read && await a.pg.locator(row('t3')).count() === 1 && await a.pg.evaluate(n => window.__on.length === n + 1 && window.__on[n] === false, onBefore), '[안 읽음으로]: 서버에 안 읽음 · 대화 접힘(onThread(false)) · 목록에 그대로 남음');
        await a.pg.click('#inb-scope'); await a.pg.waitForFunction(() => document.getElementById('inb-scope').getAttribute('aria-pressed') === 'false'); await post('/__mock/push', { ch: 'talk', id: 't6', body: '새 글' }); await a.pg.evaluate(() => AkmInbox.refresh(true)); await a.pg.waitForSelector(row('t6'), { timeout: 8000 });
        await a.pg.click(row('t6')); await a.pg.waitForSelector('#inb-msgs .sms-msg'); await a.pg.click('#inb-x'); await a.pg.waitForTimeout(400);
        ok(await a.pg.locator(row('t6')).count() === 0 && await a.pg.evaluate(() => document.querySelector('#inb-pane .sms-pane-empty') && !document.getElementById('inb-host').classList.contains('inb-open')), '읽은 대화를 접으면 「새 글」 목록에서 빠짐 · 오른쪽 칸 비움');
        await a.pg.click('#inb-scope'); await a.pg.waitForSelector(row('t4'));
        ok(await a.pg.locator('#inb-list .sms-item').count() === 6 && await a.pg.getAttribute('#inb-scope', 'aria-pressed') === 'true', '[이전 대화 보기] → 읽은 대화까지 6건 · 단추 켜짐');
        await a.pg.fill('#inb-q', '견적'); await a.pg.waitForFunction(() => document.querySelectorAll('#inb-list .sms-item').length === 1, null, { timeout: 8000 });
        ok(await a.pg.locator(row('t3')).count() === 1, '찾기: 글로 1건');
        await a.pg.fill('#inb-q', '없는말없는말'); await a.pg.waitForFunction(() => /찾은 글이 없어요/.test(document.getElementById('inb-list').textContent), null, { timeout: 8000 });
        ok(true, '찾기 결과 없음 안내');
        await a.pg.fill('#inb-q', ''); await a.pg.waitForSelector(row('t4')); await a.pg.click(row('t4')); await a.pg.waitForSelector('#inb-msgs .sms-msg');
        await a.pg.keyboard.press('Escape'); await a.pg.waitForTimeout(200);
        const esc1 = await a.pg.evaluate(() => [window.__esc, AkmInbox.isOpen(), window.__on.length]); const onN = esc1[2];
        await a.pg.keyboard.press('Escape'); const esc2 = await a.pg.evaluate(() => window.__esc);
        ok(esc1[0] === true && esc1[1] === false && esc2 === false && await a.pg.evaluate(n => window.__on.length === n, onN), 'back(): 열린 대화를 접고 true(onThread 안 부름) · 접을 것이 없으면 false', JSON.stringify([esc1, esc2]));
        ok(a.errs.length === 0, '오류 0', a.errs.join(' | ')); await a.ctx.close();

        console.log('⑤ 상품문의·주문문의 등록');
        await post('/__mock/reset');
        a = await open('ch=qna');
        await a.pg.click(row('q1')); await a.pg.waitForFunction(() => (document.getElementById('inb-text') || {}).value);
        const q1 = await a.pg.evaluate(() => ({ v: document.getElementById('inb-text').value, pub: (document.getElementById('inb-public') || {}).textContent || '', send: document.getElementById('inb-send').textContent, mk: !!document.getElementById('inb-mkdraft'), meta: document.getElementById('inb-meta').textContent, desc: document.getElementById('inb-text').getAttribute('aria-describedby') }));
        ok(/로얄과는 S~M/.test(q1.v) && q1.send === '이대로 등록' && !q1.mk && /공개 게시판에 올라가요/.test(q1.pub) && q1.desc === 'inb-public' && /공개/.test(q1.meta), '상품문의: 서버 초안이 칸에 · 「이대로 등록」 · 입력 칸 위 공개 게시판 한 줄(서버 pii_note) · [초안 만들기] 없음', JSON.stringify(q1).slice(0, 200));
        let dialogs = 0; a.pg.on('dialog', d => { dialogs++; d.dismiss(); });
        await a.pg.click('#inb-send'); await a.pg.waitForSelector('.inb-lock[data-k="done"]', { timeout: 8000 });
        lg = await log(); s = lg.log.filter(x => x.op === 'send').pop();
        const done = await a.pg.evaluate(() => ({ t: document.querySelector('.inb-lock').textContent, ta: !!document.getElementById('inb-text'), badge: document.getElementById('inb-th-badge').textContent, out: document.querySelectorAll('#inb-msgs .sms-msg.out').length }));
        ok(dialogs === 0 && s.ch === 'qna' && s.id === 'q1' && s.seen === q1.v && s.text === q1.v && lg.log.filter(x => x.op === 'send').length === 1, '확인 창 없이 누르면 바로 등록(서버에 1번 · seen = 본 초안)', JSON.stringify({ dialogs, n: lg.log.filter(x => x.op === 'send').length }));
        ok(/등록됨 · 수정은 스마트스토어 센터에서/.test(done.t) && !done.ta && done.badge === '답함' && done.out === 1 && /답변을 등록했어요/.test(await toastOf(a.pg)), '등록 뒤: 입력 칸 대신 「등록됨 · 수정은 스마트스토어 센터에서」 · 답함 표시 · 내 답이 대화에', done.t);
        await a.pg.click(row('q2')); await a.pg.waitForFunction(() => document.getElementById('inb-th-title').textContent === '제주 황금향 선물용 3kg'); await a.pg.waitForSelector('#inb-text');
        const q2 = await a.pg.evaluate(() => ({ warn: document.getElementById('inb-warn').hidden ? '' : document.getElementById('inb-warn').textContent, note: (document.querySelector('#inb-msgs .inb-note') || {}).textContent || '' }));
        ok(await a.pg.inputValue('#inb-text') === '' && await a.pg.textContent('#inb-send') === '답변 등록' && await a.pg.isDisabled('#inb-send') && /자동 등록이 실패했던 문의예요: 네이버 응답 500/.test(q2.warn) && q2.note === '봇이 넘긴 글', '초안 없는 문의: 빈 칸 · 「답변 등록」 꺼짐 · 자동 등록 실패 사유 줄 · 손님 글에 봇이 안 답한 사유', JSON.stringify(q2));
        await post('/__mock/set', { fail: 'already' }); await a.pg.fill('#inb-text', '뒤늦게 적은 답'); await a.pg.click('#inb-send'); await a.pg.waitForSelector('.inb-lock[data-k="done"]', { timeout: 8000 }); await post('/__mock/set', { fail: '' });
        lg = await log(); ok(/이미 답변한 문의예요/.test(await toastOf(a.pg)) && !lg.log.some(x => x.op === 'send' && x.id === 'q2') && /스마트스토어 센터에서/.test(await a.pg.textContent('.inb-lock')), '그 사이 다른 사람이 답한 문의(409 already): 안내 · 초안 바뀜으로 오해하지 않음 · 입력 칸이 「이미 답변」으로');
        await a.pg.click('#sms-tabs [data-ch="inquiry"]'); await a.pg.waitForSelector(row('i1')); await a.pg.click(row('i1')); await a.pg.waitForFunction(() => (document.getElementById('inb-text') || {}).value);
        ok(!await a.pg.locator('#inb-public').count() && /배송 문의/.test(await a.pg.textContent('#inb-meta')), '주문문의: 공개 게시판 줄 없음 · 주문 정보 줄');
        const iv = await a.pg.inputValue('#inb-text'); await a.pg.fill('#inb-text', iv + ' (고침)'); ok(await a.pg.textContent('#inb-send') === '고쳐서 등록', '초안을 고치면 「고쳐서 등록」');
        await a.pg.click('#inb-send'); await a.pg.waitForSelector('.inb-lock[data-k="done"]', { timeout: 8000 });
        lg = await log(); s = lg.log.filter(x => x.op === 'send').pop();
        ok(s.ch === 'inquiry' && s.id === 'i1' && / \(고침\)$/.test(s.text) && s.seen === iv, '주문문의 등록: 고친 글이 나가고 seen = 본 초안');
        await post('/__mock/push', { ch: 'talk', id: 't4', body: '또 여쭤봐요' }); await a.pg.evaluate(() => AkmInbox.refresh(true)); await a.pg.waitForFunction(() => window.__counts && window.__counts.talk.unread === 6, null, { timeout: 8000 });
        ok(true, '다른 탭에 새 글이 오면 탭 숫자가 바뀜(톡톡 6)');
        ok(a.errs.length === 0, '오류 0', a.errs.join(' | ')); await a.ctx.close();

        console.log('⑥ 알림에서 바로 열기 · 뒤에서 받을 때 읽음 안 바꿈 · 라우트 없는 서버');
        await post('/__mock/reset');
        a = await open('ch=talk&open=t4');
        await a.pg.waitForSelector('#inb-msgs .sms-msg');
        ok(await a.pg.evaluate(() => document.getElementById('inb-th-title').textContent === '귤러버' && window.__on.join() === 'true' && document.querySelectorAll('#inb-list .sms-item[data-id="t4"].open').length === 1), 'mount({ openId }) : 목록 밖(읽은) 대화도 펴짐 · 줄이 목록에 놓임 · onThread(true) 1번');
        await a.pg.evaluate(() => { AkmInbox._state.actAt = Date.now() - 200000; }); await post('/__mock/push', { ch: 'talk', id: 't4', body: '자리 비운 사이 온 글' });
        await a.pg.evaluate(() => AkmInbox.refresh(true)); await a.pg.waitForFunction(() => /자리 비운 사이 온 글/.test(document.getElementById('inb-msgs').textContent), null, { timeout: 8000 });
        lg = await log();
        ok(lg.log.filter(x => x.op === 'get' && x.id === 't4').pop().peek === true && !lg.threads.find(t => t.id === 't4').read, '2분 넘게 손대지 않았으면 뒤에서 받을 때 peek(안 읽음 유지)');
        await a.pg.evaluate(() => AkmInbox.unmount());
        ok(await a.pg.evaluate(() => document.getElementById('inb-host').innerHTML === '' && !AkmInbox.isOpen() && AkmInbox.back() === false), 'unmount(): 칸 비움 · 대화 접힘');
        await a.ctx.close();
        await post('/__mock/set', { gone: true });
        const g = await br.newPage(); await g.goto(BASE + '/__inbox.html?nomount=1'); await g.evaluate(() => AkmInbox.refresh(true)); await g.waitForTimeout(700);
        ok(await g.evaluate(() => AkmInbox.available() === false && AkmInbox.counts() === null), '/api/inbox 가 없는 서버: available() false · counts() null(탭 줄을 숨길 근거)'); await g.close();
        await post('/__mock/set', { gone: false });

        console.log('⑦ 폰 390 · 폴드 900 · PC · 야간');
        for (const [nm, w, h, mobile, q] of [['폰 390', 390, 800, true, 'ch=qna'], ['폴드 900', 900, 860, false, 'ch=qna'], ['PC 1440', 1440, 900, false, 'ch=qna'], ['폰 390 야간', 390, 800, true, 'ch=qna&dark=1'], ['폴드 900 야간', 900, 860, false, 'ch=talk&dark=1']]) {
            await post('/__mock/reset');
            const v = await open(q, { width: w, height: h }, mobile); const id = /talk/.test(q) ? 't6' : 'q1';
            const m0 = await v.pg.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, small: [...document.querySelectorAll('#inb-host button, #inb-host input')].filter(n => n.offsetParent).map(n => { const r = n.getBoundingClientRect(); return r.height < 44 ? (n.id || n.className) + ' ' + Math.round(r.height) : null; }).filter(Boolean) }));
            await v.pg.click(row(id)); await v.pg.waitForSelector('#inb-send'); await v.pg.waitForTimeout(400);
            const m = await v.pg.evaluate(() => { const th = document.getElementById('inb-thread').getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
                const over = [...document.querySelectorAll('#inb-thread *')].filter(n => n.offsetParent && n.getBoundingClientRect().right > W + 1).map(n => n.id || n.className).slice(0, 4);
                const small = [...document.querySelectorAll('#inb-thread button, #inb-thread textarea')].filter(n => n.offsetParent).map(n => { const r = n.getBoundingClientRect(), min = window.matchMedia('(max-width: 720px)').matches || n.id === 'inb-send' || n.id === 'inb-mkdraft' ? 44 : 36; return r.height < min ? (n.id || n.className) + ' ' + Math.round(r.height) : null; }).filter(Boolean);
                const send = document.getElementById('inb-send').getBoundingClientRect(), back = document.getElementById('inb-back');
                const lum = c => { const a = c.match(/[\d.]+/g).map(Number).slice(0, 3).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
                const cr = (f, b) => { const x = lum(f), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
                const pub = document.getElementById('inb-public'), bub = document.querySelector('#inb-msgs .sms-bub'), cs = n => getComputedStyle(n);
                return { doc: document.documentElement.scrollWidth - W, over, small, full: th.left <= 0 && th.right >= W - 1 && th.top <= 1, sendIn: send.bottom <= H + 1 && send.right <= W + 1, backShown: !!back.offsetParent, cols: getComputedStyle(document.querySelector('.inb-cols')).gridTemplateColumns.split(' ').length,
                    pubCr: pub ? cr(cs(pub).color, cs(pub).backgroundColor) : 9, bubCr: cr(cs(bub).color, cs(bub).backgroundColor), card: cs(document.querySelector('.sms-win')).backgroundColor }; });
            const ph = w <= 720;
            ok(m0.doc <= 0 && m.doc <= 0 && m.over.length === 0 && m.sendIn, `${nm}: 가로 넘침 0 · 보내기 단추가 화면 안`, JSON.stringify({ d0: m0.doc, d: m.doc, over: m.over }));
            ok(m0.small.length === 0 && m.small.length === 0, `${nm}: 누르는 것 ${ph ? '44px' : '44px(머리 보조 단추 36px)'} 이상`, m0.small.concat(m.small).join(' / '));
            ok(ph ? (m.full && m.backShown && m.cols === 1) : (!m.full && !m.backShown && m.cols === 2), `${nm}: ${ph ? '대화가 전체 화면 · 「목록」 단추' : '2단(목록 | 대화)'}`, JSON.stringify({ full: m.full, back: m.backShown, cols: m.cols }));
            ok(m.pubCr >= 4.5 && m.bubCr >= 4.5 && (/dark/.test(q) ? !/255, 255, 255/.test(m.card) : true), `${nm}: 글자 대비 4.5 이상(공개 게시판 줄 ${m.pubCr.toFixed(1)} · 말풍선 ${m.bubCr.toFixed(1)})${/dark/.test(q) ? ' · 창 바탕이 어두움' : ''}`, m.card);
            if (process.env.SHOT_DIR) { fs.mkdirSync(process.env.SHOT_DIR, { recursive: true }); await v.pg.screenshot({ path: path.join(process.env.SHOT_DIR, '658-' + nm.replace(/\s+/g, '-') + '.png') }); }
            ok(v.errs.length === 0, `${nm}: 오류 0`, v.errs.join(' | ')); await v.ctx.close();
        }
        console.log('교차 점검 보완(워커3)');
        await post('/__mock/reset');
        {
            const b = await open('ch=talk');
            await b.pg.click(row('t2')); await b.pg.waitForSelector('#inb-text');
            await b.pg.click('#inb-mkdraft'); await b.pg.waitForFunction(() => document.getElementById('inb-text').value.length > 5, null, { timeout: 8000 });
            await b.pg.fill('#inb-text', '직원이 적던 글입니다'); await b.pg.waitForTimeout(900);
            await post('/__mock/set', { swap: '서버에서 바뀐 초안 둘' });
            await b.pg.click('#inb-send'); await b.pg.waitForSelector('#inb-draft-new', { timeout: 8000 });
            let g = await log();
            ok(await b.pg.inputValue('#inb-text') === '직원이 적던 글입니다' && g.log.some(x => x.op === 'conflict') && !g.log.some(x => x.op === 'send') && /적던 글은 그대로/.test(await toastOf(b.pg)), '적던 글로 보내다 409(초안 바뀜) → 글은 그대로 · [새 초안으로 바꾸기] 띠만 · 안 나감');
            await b.pg.waitForTimeout(900); await b.pg.focus('#inb-text');
            await b.pg.evaluate(() => { const ta = document.getElementById('inb-text'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })); const q = document.getElementById('inb-q'); q.value = '조합중'; q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); });
            await b.pg.waitForTimeout(700); g = await log();
            const held = !g.log.some(x => x.op === 'send') && await b.pg.inputValue('#inb-text') === '직원이 적던 글입니다' && await b.pg.locator('#inb-list .sms-item').count() === 5;
            await b.pg.evaluate(() => { document.getElementById('inb-q').value = ''; }); await b.pg.focus('#inb-text'); await b.pg.keyboard.press('Control+Enter'); await b.pg.waitForFunction(() => document.querySelectorAll('#inb-msgs .sms-msg.out').length >= 1, null, { timeout: 8000 });
            g = await log(); const s2 = g.log.filter(x => x.op === 'send').pop();
            ok(held && s2 && s2.id === 't2' && s2.text === '직원이 적던 글입니다' && s2.seen === '서버에서 바뀐 초안 둘', '한글 조합 중 Ctrl+Enter·찾기 Enter 는 넘김(안 나감 · 목록 그대로) · 조합이 끝난 Ctrl+Enter 는 나감(seen = 본 초안)', JSON.stringify(s2 || {}));
            ok(b.errs.length === 0, '보완 PC: 오류 0', b.errs.join(' | ')); await b.ctx.close();
            const p = await open('ch=talk', { width: 390, height: 844 }, true);
            await p.pg.click(row('t3')); await p.pg.waitForSelector('#inb-msgs .sms-msg'); await p.pg.fill('#inb-text', '쓰던 답');
            await p.pg.evaluate(() => AkmInbox.mount(AkmInbox._state.host, { ch: 'talk', openId: 't3' })); await p.pg.waitForTimeout(500);
            ok(await p.pg.evaluate(() => AkmInbox.isOpen() && document.getElementById('inb-thread').dataset.id === 't3' && document.getElementById('inb-text').value === '쓰던 답'), '폰: 펴 둔 대화를 알림 길(openId)로 다시 열어도 편 채 · 쓰던 글 그대로');
            await p.pg.evaluate(() => document.querySelector('#inb-list .sms-item[data-id="t3"] .sms-row').click()); await p.pg.waitForTimeout(400);
            ok(await p.pg.evaluate(() => !AkmInbox.isOpen()) && p.errs.length === 0, '폰: 목록에서 같은 줄을 직접 누르면 종전대로 접힘 · 오류 0', p.errs.join(' | ')); await p.ctx.close();
        }
        code = fail ? 1 : 0;
    } catch (e) { console.error('ERR', e.stack || e.message); code = 1; }
    finally { if (br) await br.close().catch(() => { }); srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    setTimeout(() => process.exit(code), 200);
})();
