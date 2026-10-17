// #730 문자 목록 「더 보기」 검증 — 가짜 서버(scripts/_mock-610.js · DB·외부 호출 0)에 실제 화면을 띄워 실클릭
//   사용: node scripts/verify-730-sms-more.js   (포트 PORT610 · 없으면 3463 · 다른 Playwright 검증과 동시에 돌리지 말 것)
//   PC 1280 · 폰 390 × 첫 쪽 50 · [더 보기] → 100 → 133 「끝」 · 다시 받아도 붙인 줄 유지 · 찾기 결과에도 더 보기 · 찾기 지우면 첫 쪽부터 · 옛 서버(more 없음) = 단추 없음
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js'));
const PORT = Number(process.env.PORT610 || 3463), BASE = 'http://localhost:' + PORT;
const USER = { id: 8, name: '시험직원', position: '대리', role: 'user' };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const mock = async (p, body) => (await fetch(BASE + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();

(async () => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/_mock-610.js'), String(PORT)], { stdio: ['ignore', 'ignore', 'inherit'] });
    let up = false; for (let i = 0; i < 40 && !up; i++) { await H.sleep(250); try { up = (await fetch(BASE + '/__mock/log')).ok; } catch (e) { /* 아직 */ } }
    if (!up) { srv.kill(); throw new Error('가짜 서버가 안 떴어요(포트 ' + PORT + ')'); }
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const open = async (vw, phone) => {
        const ctx = await browser.newContext(Object.assign({ viewport: vw, serviceWorkers: 'block', reducedMotion: 'reduce' }, phone ? { isMobile: true, hasTouch: true } : {}));
        const pg = await ctx.newPage(); const errors = [], sms = [];
        pg.on('pageerror', e => errors.push(String(e))); pg.on('dialog', d => d.dismiss().catch(() => { }));
        pg.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/api/sms/threads') sms.push(u.search); });
        await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await pg.evaluate(u => { localStorage.setItem('jwt_token', 'mock.token.610'); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); localStorage.removeItem('akm_ao_theme'); }, USER);
        await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(1800);
        return { pg, ctx, errors, sms };
    };
    const plusGo = async (pg, sel) => { if (await pg.evaluate(() => { const m = document.getElementById('desk-plus'); return !!m && m.hidden; })) { await pg.click('#desk-plus-btn'); await pg.waitForTimeout(200); } await pg.click(sel); };
    const rowsAre = (pg, n) => pg.waitForFunction(x => document.querySelectorAll('#sms-list .sms-item').length === x, n, { timeout: 6000 }).then(() => true).catch(() => false);
    const st = pg => pg.evaluate(() => { const ids = Array.from(document.querySelectorAll('#sms-list .sms-item')).map(x => x.dataset.id), b = document.querySelector('#sms-list .sms-more'), e = document.querySelector('#sms-list .sms-end'), r = b ? b.getBoundingClientRect() : null;
        return { n: ids.length, uniq: new Set(ids).size, more: !!b, moreH: r ? Math.round(r.height) : 0, moreW: r ? Math.round(r.width) : 0, end: e ? e.textContent : '', cnt: (document.getElementById('sms-count') || { textContent: '' }).textContent, last: ids[ids.length - 1] || '', sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }; });
    const more = async pg => { await pg.locator('#sms-list .sms-more').scrollIntoViewIfNeeded(); await pg.click('#sms-list .sms-more'); };
    try {
        for (const [label, vw, phone] of [['PC 1280', { width: 1280, height: 900 }, false], ['폰 390', { width: 390, height: 844 }, true]]) {
            console.log('\n── ' + label);
            await mock('/__mock/reset', {}); await mock('/__mock/set', { paged: 120 });   // 대화 133개(기본 13 + 오래된 120)
            const P = await open(vw, phone), pg = P.pg;
            await plusGo(pg, '#desk-sms-now'); await pg.waitForTimeout(900);
            ok(await rowsAre(pg, 50), `[${label}] 첫 쪽 50줄`);
            let s = await st(pg);
            ok(s.more && s.moreH >= 44 && !s.end && s.cnt === '최근 50건 · 더 보기로 이어서 · 끝 4자리·전체 번호·글로 찾으면 전체에서', `[${label}] [더 보기] 단추(높이 ${s.moreH}) · 글 「${s.cnt}」`);
            const q0 = P.sms.length; await more(pg);
            ok(await rowsAre(pg, 100), `[${label}] 더 보기 → 100줄`);
            s = await st(pg);
            ok(s.uniq === 100 && P.sms.slice(q0).some(x => /offset=50/.test(x)) && s.more && s.cnt.startsWith('최근 100건'), `[${label}] 겹침 0 · offset=50 요청 · 단추 남음 · 「${s.cnt}」`);
            // 뒤에서 목록을 다시 받아도(폴링·창 돌아옴) 붙인 줄은 남는다
            await pg.waitForTimeout(1400); await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await pg.waitForTimeout(1500);
            const q1 = P.sms.length; s = await st(pg);
            ok(s.n === 100 && s.uniq === 100, `[${label}] 다시 받은 뒤에도 100줄 유지(그사이 목록 요청 ${q1 - q0}회)`);
            await more(pg);
            ok(await rowsAre(pg, 133), `[${label}] 한 번 더 → 133줄(전부)`);
            s = await st(pg);
            ok(s.uniq === 133 && !s.more && s.end === '끝 — 더 없어요' && s.cnt === '133건', `[${label}] 단추 사라짐 · 「${s.end}」 · 글 「${s.cnt}」`);
            ok(s.sw <= vw.width, `[${label}] 가로 넘침 없음(${s.sw})`);
            // 찾기 결과에도 더 보기(글 찾기 = 120건)
            await pg.fill('#sms-q', '더보기 시험'); await pg.keyboard.press('Enter');
            ok(await rowsAre(pg, 50), `[${label}] 찾기 → 첫 쪽 50줄(붙였던 줄 버림)`);
            s = await st(pg);
            ok(s.more && s.cnt === '찾은 50건 · 더 보기로 이어서', `[${label}] 찾기 결과 글 「${s.cnt}」 · 단추`);
            await more(pg); ok(await rowsAre(pg, 100), `[${label}] 찾기 더 보기 → 100`);
            const qf = P.sms.length; await more(pg); ok(await rowsAre(pg, 120), `[${label}] 찾기 더 보기 → 120(전부)`);
            s = await st(pg);
            ok(!s.more && s.end === '끝 — 더 없어요' && P.sms.slice(qf).some(x => /q=%EB%8D%94%EB%B3%B4%EA%B8%B0/.test(x) && /offset=100/.test(x)), `[${label}] 찾기 끝 · 요청에 q·offset=100`);
            await pg.fill('#sms-q', ''); await pg.keyboard.press('Enter');
            ok(await rowsAre(pg, 50), `[${label}] 찾기 지우면 다시 첫 쪽 50`);
            ok(P.errors.length === 0, `[${label}] 화면 오류 ${P.errors.length}${P.errors.length ? ' ' + P.errors[0] : ''}`);
            await P.ctx.close();
        }
        // 옛 서버(more 칸 없음) = 단추·「끝」 없음 · 종전 글
        console.log('\n── 옛 서버');
        await mock('/__mock/reset', {});
        const P = await open({ width: 1280, height: 900 }, false), pg = P.pg;
        await plusGo(pg, '#desk-sms-now'); await pg.waitForTimeout(900);
        const s = await st(pg);
        ok(s.n > 0 && !s.more && !s.end && /건$/.test(s.cnt) && !/더 보기/.test(s.cnt), `[옛 서버] ${s.n}줄 · 단추 없음 · 글 「${s.cnt}」`);
        ok(P.errors.length === 0, `[옛 서버] 화면 오류 ${P.errors.length}`);
        await P.ctx.close();
    } finally { await browser.close().catch(() => { }); srv.kill(); }
    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
