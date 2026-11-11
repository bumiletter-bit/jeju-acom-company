// #1107-D 화면 검증 — 톡톡 초안에 금액 자리표 「0,000원」이 남아도 [보내기]가 켜져 있는지(#1109 대표 「막기는 안 해도 돼 · 우리가 수정해서 보낼 거야」 = 막기 뺌 · 종전 = 꺼짐+안내)
//   실행: node scripts/verify-1107-ui.js   (가짜 서버 scripts/_mock-658.js · 포트 PORT1107 또는 3458 · DB·외부 호출 0)
const path = require('path'); const { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = Number(process.env.PORT1107) || 3458, BASE = 'http://localhost:' + PORT;
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null && !c ? ' — ' + String(d).slice(0, 300) : '')); };
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
(async () => {
    const srv = spawn('node', [path.join(__dirname, '_mock-658.js'), String(PORT)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 900));
    let br, code = 1;
    try {
        const DR = '네 고객님 불편드려 다시한번 죄송하구요, 저희가 고객님 네이버 아이디로 네이버페이 포인트 0,000원 지급 도와드리겠습니다.';
        await post('/__mock/push', { ch: 'talk', id: 't1', body: '보상해 주세요', draft: DR });
        br = await chromium.launch();
        for (const [vp, mobile, name] of [[{ width: 1440, height: 900 }, false, 'PC'], [{ width: 390, height: 844 }, true, '폰 390']]) {
            await post('/__mock/reset'); await post('/__mock/push', { ch: 'talk', id: 't1', body: '보상해 주세요', draft: DR });   // #1109 이제 PC 의 Ctrl+Enter 가 실제로 보내므로 폭마다 가짜 서버를 처음 상태로
            const ctx = await br.newContext({ viewport: vp, ...(mobile ? { isMobile: true, hasTouch: true } : {}) }); const pg = await ctx.newPage(); const errs = [];
            pg.on('pageerror', e => errs.push(e.message));
            await pg.goto(BASE + '/__inbox.html?ch=talk'); await pg.waitForSelector('#inb-list .sms-item[data-id="t1"] .sms-row');
            await pg.click('#inb-list .sms-item[data-id="t1"] .sms-row');
            await pg.waitForFunction(dr => (document.getElementById('inb-text') || {}).value === dr, DR, { timeout: 8000 });
            const s1 = await pg.evaluate(() => ({ dis: document.getElementById('inb-send').disabled, warn: document.getElementById('inb-warn').hidden ? '' : document.getElementById('inb-warn').textContent }));
            ok(s1.dis === false && !/0,000원/.test(s1.warn), `${name}: #1109 자리표 남은 초안도 [보내기] 켜짐 · 막기 안내 없음(대표 「우리가 수정해서 보낼 거야」)`, JSON.stringify(s1));
            await pg.fill('#inb-text', DR.replace('0,000원', '3,000원'));
            const s2 = await pg.evaluate(() => ({ dis: document.getElementById('inb-send').disabled, hid: document.getElementById('inb-warn').hidden }));
            ok(s2.dis === false && s2.hid === true, `${name}: 금액 채워도 [보내기] 켜짐 · 안내 없음`, JSON.stringify(s2));
            await pg.fill('#inb-text', DR.replace('0,000원', '10,000원'));
            ok(await pg.isEnabled('#inb-send'), `${name}: 10,000원 = 자리표 아님`);
            if (!mobile) {
                await pg.fill('#inb-text', DR); const n0 = (await (await fetch(BASE + '/__mock/log')).json()).log.filter(x => /send/.test(JSON.stringify(x))).length;
                await pg.focus('#inb-text'); await pg.keyboard.press('Control+Enter'); await pg.waitForTimeout(600);
                const n1 = (await (await fetch(BASE + '/__mock/log')).json()).log.filter(x => /send/.test(JSON.stringify(x))).length;
                const t = await pg.evaluate(() => [...document.querySelectorAll('.toast-message')].map(n => n.textContent).join(' | '));
                ok(!/0,000원/.test(t), `${name}: Ctrl+Enter = 자리표 막기 안내 없음(보내기 진행)`, n0 + '→' + n1 + ' ' + t);
            }
            ok(errs.length === 0, `${name}: 화면 오류 0`, errs.join(' | '));
            await ctx.close();
        }
        code = fail ? 1 : 0;
    } catch (e) { console.error(e); } finally { if (br) await br.close(); srv.kill(); }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(code);
})();
