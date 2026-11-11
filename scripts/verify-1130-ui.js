// #1130 화면 검증 — 손님 연락 창 상품문의 답 칸 [초안 만들기](서버가 can_draft 줄 때만) · 누르면 칸에 초안 · [지우기] = 칸 + 서버 초안(본 글 그대로일 때)
//   가짜 서버 scripts/_mock-658.js(MOCK658_POST_DRAFT=1 · DB·외부 0) + Playwright · 포트 PORT1130U(기본 3458)
//   실행: node scripts/verify-1130-ui.js
'use strict';
const path = require('path'); const { spawn } = require('child_process'); const { chromium } = require('playwright');
const PORT = Number(process.env.PORT1130U) || 3458, BASE = 'http://localhost:' + PORT;
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null && !c ? ' — ' + String(d).slice(0, 300) : '')); };
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const log = () => fetch(BASE + '/__mock/log').then(r => r.json());
(async () => {
    const run = async flag => {
        const srv = spawn('node', [path.join(__dirname, '_mock-658.js'), String(PORT)], { stdio: 'ignore', env: Object.assign({}, process.env, flag ? { MOCK658_POST_DRAFT: '1' } : { MOCK658_POST_DRAFT: '' }) }); await new Promise(r => setTimeout(r, 900));
        const br = await chromium.launch();
        try {
            await post('/__mock/reset');
            const ctx = await br.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
            await pg.goto(BASE + '/__inbox.html?ch=qna'); await pg.waitForSelector('#inb-list .sms-item[data-id="q2"] .sms-row');
            await pg.click('#inb-list .sms-item[data-id="q2"] .sms-row'); await pg.waitForSelector('#inb-text'); await pg.waitForTimeout(300);
            const b0 = await pg.evaluate(() => { const r = document.querySelector('.sms-reply-row'), mk = document.getElementById('inb-mkdraft'); return { mk: !!mk, txt: mk ? mk.textContent : '', btns: r ? [...r.querySelectorAll('button')].map(b => b.id) : [], over: r ? r.scrollWidth - r.clientWidth : -1, h: mk ? mk.getBoundingClientRect().height : 0 }; });
            if (!flag) { ok(!b0.mk && b0.btns.join() === 'inb-clear,inb-send', '서버 can_draft 없음(옛 꼴) = [초안 만들기] 안 보임 · [지우기][답변 등록] 종전', JSON.stringify(b0)); ok(errs.length === 0, '오류 0', errs.join()); return; }
            ok(b0.mk && b0.txt === '초안 만들기' && b0.btns.join() === 'inb-clear,inb-mkdraft,inb-send' && b0.over <= 0 && b0.h >= 44, '상품문의 답 칸 = [지우기][초안 만들기][답변 등록] 한 줄 · 넘침 0 · 44px', JSON.stringify(b0));
            await pg.click('#inb-mkdraft'); await pg.waitForFunction(() => /봇 초안/.test(document.getElementById('inb-text').value), null, { timeout: 5000 });
            let g = await log(); ok(g.log.filter(x => x.op === 'draft' && x.ch === 'qna' && x.id === 'q2').length === 1 && !(await pg.isHidden('#inb-draft')), '누르면 POST …/qna/q2/draft 1번 · 칸에 초안 · 「봇이 만든 초안」 띠', JSON.stringify(g.log.slice(-3)));
            await pg.click('#inb-clear'); await pg.waitForTimeout(600); g = await log();
            ok((await pg.inputValue('#inb-text')) === '' && g.log.some(x => x.op === 'draft-clear' && x.ch === 'qna' && x.hit), '[지우기] = 칸 비움 + 서버 초안 지움(qna draft-clear hit)', JSON.stringify(g.log.slice(-2)));
            ok(errs.length === 0, '오류 0', errs.join());
        } finally { await br.close(); srv.kill(); await new Promise(r => setTimeout(r, 300)); }
    };
    console.log('Ⅰ 서버가 상품문의 초안 만들기를 줄 때'); await run(true);
    console.log('Ⅱ 옛 서버 꼴(can_draft 없음)'); await run(false);
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('💥', e); process.exit(1); });
