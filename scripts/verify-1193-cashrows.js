// #1193 검증 — 발주 메모함 「현금 줄」 판(대표 폰 앱 = 올렸다 내리면 줄 2개가 안 그려짐 · 건드리면 다시 나옴)의 시험 표식(?om1193=1 · 2 · 끔 0)
//   ① 표식 없음 = HEAD 와 픽셀 같음(폭 390·690·884) ② 표식 1·2 = 표식 없음과 모양 같음(픽셀·줄 높이) ③ 터치로 올렸다 내린 뒤 보이는 줄 전부 이름·체크 있음 · 그려진 줄 수 = 자료 줄 수(46)
//   🔴 실DB·서버·네트워크 0 — verify-900-2b.js 의 가짜 서버·자료 · HEAD(?v=old) 와 지금(?v=new) 대조
//   🔴 한계 = 헤드리스 크로미움에서는 원래 증상(안 그려짐)이 재현되지 않음 → 이 검증은 「무회귀·모양 같음」만 본다. 고쳐졌는지는 대표 폰 앱에서만 확인됨.
//   실행: node scripts/verify-1193-cashrows.js   (PORT1193 로 포트 · 기본 3462)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright');
const XLSX = require('xlsx-js-style');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ''); } };
let B = fs.readFileSync(path.join(__dirname, 'verify-900-2b.js'), 'utf8').split('\r\n').join('\n');
B = B.slice(B.indexOf('const SRC = {'), B.indexOf('(async () => {'));
const M = new Function('require', 'ROOT', 'path', 'fs', 'http', 'execSync', 'chromium', 'XLSX', 'ok', '__dirname', B + '\nreturn { S, serve };')(require, ROOT, path, fs, http, execSync, chromium, XLSX, ok, __dirname);
const { S, serve } = M;
const N = 46;

(async () => {
    const PORT = Number(process.env.PORT1193 || 3462);
    const srv = await serve(PORT), base = `http://127.0.0.1:${PORT}/`;
    const browser = await chromium.launch(); const pe = [];
    const open = async (q, w, h) => { S.n = N; S.ent = 6;
        const cx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
        const p = await cx.newPage(); p.on('pageerror', e => pe.push(String(e)));
        await p.goto(base + q); await p.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await p.waitForTimeout(1000);
        const btn = p.locator('#om-prev-open'); if (await btn.isVisible()) await btn.tap();
        await p.waitForSelector('#om-ctw tbody tr'); await p.waitForTimeout(700); return { cx, p }; };
    const info = p => p.evaluate(async () => { const trs = [...document.querySelectorAll('#om-ctw tbody tr')], vh = innerHeight;
        const vis = trs.filter(t => { const r = t.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; });
        const bad = t => { const o = t.querySelector('.om-ct-open'), c = t.querySelector('input[type=checkbox]'); return !o || !o.textContent.trim() || !c || !o.getClientRects().length || !c.getClientRects().length; };
        const sc = [...document.querySelectorAll('.om-prev, .om-prev-b')].find(e => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY));
        const data = await fetch('/api/order-memo').then(r => r.json()).then(b => b.entries.flatMap(e => e.rows).filter(r => r.kind === 'cash').length);
        const t = document.querySelector('#om-ctw table');
        return { n: trs.length, data, head: document.getElementById('om-prev-d').textContent, vis: vis.length, blankVis: vis.filter(bad).length, blankAll: trs.filter(bad).length, top: sc ? sc.scrollTop : -1, max: sc ? sc.scrollHeight - sc.clientHeight : -1,
            tops: trs.map(x => x.getBoundingClientRect().top), hsum: trs.reduce((a, x) => a + x.getBoundingClientRect().height, 0), tw: Math.round(t.getBoundingClientRect().width * 100) / 100, th: Math.round(t.getBoundingClientRect().height * 100) / 100,
            lab: getComputedStyle(document.getElementById('om-prev-d'), '::after').content, hh: document.querySelector('.om-prev-h').getBoundingClientRect().height, bc: getComputedStyle(t).borderCollapse, wc: getComputedStyle(t).willChange, mark: document.documentElement.getAttribute('data-om1193'), ls: localStorage.getItem('om1193') }; });
    const setTop = (p, f) => p.evaluate(f => { const sc = [...document.querySelectorAll('.om-prev, .om-prev-b')].find(e => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)); if (sc) sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * f); }, f);
    const shots = async p => { const a = []; for (const f of [0, 0.37, 1]) { await setTop(p, f); await p.waitForTimeout(150); a.push(await p.screenshot({ animations: 'disabled' })); } await setTop(p, 0); return a; };
    const same = (a, b) => a.length === b.length && a.every((x, i) => x.equals(b[i]));
    const near = (a, b) => Math.max(...a.tops.map((v, i) => Math.abs(v - b.tops[i]))) <= 0.5 && Math.abs(a.hsum - b.hsum) <= 0.5 && a.tw === b.tw && a.th === b.th;   // separate 꼴 = 표 머리·맨 끝 줄이 반 픽셀씩 주고받음(합·픽셀은 같음)
    // 표식 2(따로 그리는 층) = 글자 가장자리 다듬기가 몇 점 달라짐 → 다른 점 수·가장 큰 색 차이를 잼
    const pxDiff = (p, a, b) => p.evaluate(async ([a, b]) => { const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; }); const px = im => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
        let n = 0, mx = 0, tot = 0; for (let k = 0; k < a.length; k++) { const A = await load(a[k]), B2 = await load(b[k]); if (A.width !== B2.width || A.height !== B2.height) return { n: -1, mx: 255, tot: 1 }; const x = px(A), y = px(B2); tot += x.length / 4; for (let i = 0; i < x.length; i += 4) { const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2])); if (d) { n++; if (d > mx) mx = d; } } } return { n, mx, tot }; }, [a.map(x => x.toString('base64')), b.map(x => x.toString('base64'))]);
    const swipe = async (cx, p, w, h, dy) => { const cdp = await cx.newCDPSession(p), x = w / 2, y0 = dy < 0 ? h * 0.75 : h * 0.3, steps = 12;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
        for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + Math.max(-h * 0.5, Math.min(h * 0.5, dy)) * i / steps }] }); await p.waitForTimeout(12); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(600); await cdp.detach(); };
    try {
        for (const [w, h] of [[390, 844], [690, 900], [884, 1104]]) {
            const O = await open('?v=old', w, h), Z = await open('?v=new', w, h);
            const so = await shots(O.p), sz = await shots(Z.p), iz = await info(Z.p);
            ok(iz.mark === null && iz.ls === null, `폭 ${w} 표식 없음 = html 에 표식 속성 없음`, iz.mark);
            ok(same(so, sz), `폭 ${w} ① 표식 없음 = HEAD 와 픽셀 같음(맨 위·가운데·맨 아래 3장)`);
            ok(iz.n === N && iz.data === N && iz.head.indexOf(N + '줄') >= 0, `폭 ${w} 그려진 줄 ${iz.n} = 자료 현금 줄 ${iz.data} = 머리 글 「${iz.head.slice(0, 12)}…」`, iz);
            for (const k of ['1', '2']) {
                const T = await open('?v=new&om1193=' + k, w, h), it = await info(T.p);
                ok(it.lab.indexOf('시험 ' + k) >= 0 && iz.lab === 'none', `폭 ${w} 표식 ${k} = 판 머리 줄 끝에 「시험 ${k}」 글(표식 없음 = 글 없음) · 머리 높이 ${iz.hh} → ${it.hh}`, [iz.lab, it.lab]);
                ok(it.hh === iz.hh, `폭 ${w} 표식 ${k} = 「시험 ${k}」 글이 붙어도 판 머리 높이 그대로(${it.hh})`, [iz.hh, it.hh]);
                await T.p.addStyleTag({ content: '#om-prev-d::after{content:none!important}' });   /* 아래 픽셀 대조는 그 글만 가리고(표 모양 비교) */
                const st = await shots(T.p);
                ok(it.mark === k && it.ls === k, `폭 ${w} 표식 ${k} = html[data-om1193="${k}"] · 기기에 남음`, [it.mark, it.ls]);
                if (w > 720) ok(it.bc === 'separate' && (k === '2' ? it.wc === 'transform' : it.wc === 'auto'), `폭 ${w} 표식 ${k} = 새 CSS 먹음(border-collapse ${it.bc} · will-change ${it.wc})`, [it.bc, it.wc]);
                else ok(it.bc === iz.bc && it.wc === iz.wc, `폭 ${w} 표식 ${k} = 접은 폭(카드 꼴)은 새 CSS 안 먹음(${it.bc})`, [it.bc, it.wc]);
                ok(near(it, iz), `폭 ${w} 표식 ${k} ② 줄 46개 자리(반 픽셀 안)·줄 높이 합·표 폭·높이 = 표식 없음과 같음(표 ${it.tw}×${it.th})`, { z: [iz.tw, iz.th, iz.hsum], t: [it.tw, it.th, it.hsum] });
                if (k === '1' || w <= 720) ok(same(st, sz), `폭 ${w} 표식 ${k} ② 픽셀 = 표식 없음과 같음(가로줄·체크·배지 · 3장)`);
                else { const d = await pxDiff(T.p, st, sz); console.log(`     폭 ${w} 표식 2 다른 점 ${d.n} / ${d.tot}(${(d.n / d.tot * 100).toFixed(4)}%) · 가장 큰 색 차이 ${d.mx}/255`); ok(d.n >= 0 && d.n / d.tot < 0.0005 && d.mx <= 24, `폭 ${w} 표식 2 ② 모양 = 표식 없음과 같음(다른 점 0.05% 미만 · 색 차이 24/255 이하 = 글자 가장자리뿐)`, d); }
                ok(it.n === N && it.blankAll === 0, `폭 ${w} 표식 ${k} 그려진 줄 ${it.n} = 자료 ${it.data} · 이름·체크 빈 줄 0`, it.blankAll);
                let worst = 0, moved = 0; for (const dy of [-600, -900, -900, 700, 900, -1500, 2500]) { await swipe(T.cx, T.p, w, h, dy); const i = await info(T.p); worst = Math.max(worst, i.blankVis); moved = Math.max(moved, i.top); if (i.n !== N) worst = 99; }
                ok(moved > 200 && worst === 0, `폭 ${w} 표식 ${k} ③ 터치로 내렸다 올리기 7번 = 보이는 줄 전부 이름·체크 있음 · 줄 수 ${N} 그대로(가장 멀리 ${Math.round(moved)}px)`, { worst, moved });
                if (k === '1') { await T.p.goto(base + '?v=new&om1193=0'); const off = await T.p.evaluate(() => [document.documentElement.getAttribute('data-om1193'), localStorage.getItem('om1193')]); ok(off[0] === null && off[1] === null, `폭 ${w} ?om1193=0 = 표식 꺼짐(속성·기기 값 지워짐)`, off); }
                await T.cx.close();
            }
            { let worst = 0, moved = 0; for (const dy of [-600, -900, -900, 700, 900, -1500, 2500]) { await swipe(Z.cx, Z.p, w, h, dy); const i = await info(Z.p); worst = Math.max(worst, i.blankVis); moved = Math.max(moved, i.top); }
              ok(moved > 200 && worst === 0, `폭 ${w} 표식 없음 ③ 터치로 내렸다 올리기 = 빈 줄 0(헤드리스에서는 원래도 재현 안 됨)`, { worst, moved }); }
            await O.cx.close(); await Z.cx.close();
        }
        ok(pe.length === 0, '화면 오류 0', pe.slice(0, 3));
    } catch (e) { failN++; console.log('  ❌ 실행 오류', e && e.stack || e); }
    await browser.close(); await new Promise(r => srv.close(r));
    console.log(`\n#1193 검증: ${pass}/${pass + failN} 통과` + (failN ? ` · 실패 ${failN}` : ''));
    process.exit(failN ? 1 : 0);
})();
