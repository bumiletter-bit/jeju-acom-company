// #1016-B 미리보기 — 실제 네이버 편집기 CSS(_preview-se.js pageDoc)로
//   ① HTML 파일(폰 390 · 끼운 블록 점선 표시 · 열면 그 자리로 스크롤) ② 끼운 자리 앞뒤 잘라 찍은 JPEG(PC 860 · 폰 390)
//   node pv.js <새 상세.html> <이름> <out 폴더>
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/전승범/OneDrive/문서/★제주아꼼이네 회사프로그램';
const PV = require(ROOT + '/scripts/desk/_preview.js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const MARK = '<style>[id^="SE-1016"].se-component{outline:3px dashed #ff3b30;outline-offset:2px}</style>';
const JUMP = '<script>addEventListener("load",()=>{const e=document.querySelector(\'[id^="SE-1016"].se-component\');if(e)e.scrollIntoView({block:"center"})})</script>';
(async () => {
    const [file, name, outDir] = process.argv.slice(2);
    const html = fs.readFileSync(file, 'utf8');
    fs.mkdirSync(outDir, { recursive: true });
    const res = {};
    const b = await chromium.launch();
    try {
        for (const w of [390, 860]) {
            const doc = PV.pageDoc(html, w) + MARK + JUMP;
            if (w === 390) { const f = path.join(outDir, `${name}_폰390.html`); fs.writeFileSync(f, doc); res.html = f; }
            else { const f = path.join(outDir, `${name}_PC860.html`); fs.writeFileSync(f, doc); res.html_pc = f; }
            const pg = await b.newPage({ viewport: { width: w, height: 1200 } });
            await pg.route(/^https:\/\/(editor-static|ssl)\.pstatic\.net\/.*\.css(\?.*)?$/, async rt => { try { await rt.fulfill({ response: await rt.fetch({ timeout: 8000 }) }); } catch (e) { await rt.abort().catch(() => { }); } });
            await pg.setContent(doc, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await pg.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });
            await PV.settle(pg);
            const cssOk = await pg.evaluate(() => [...document.querySelectorAll('link[data-se]')].every(l => l.dataset.ok));
            const box = await pg.evaluate(() => {
                const els = [...document.querySelectorAll('[id^="SE-1016"].se-component')];
                const all = [...document.querySelectorAll('.se-main-container > .se-component')];
                const i0 = all.indexOf(els[0]), i1 = all.indexOf(els[els.length - 1]);
                const pre = all[Math.max(0, i0 - 1)], post = all[Math.min(all.length - 1, i1 + 1)];
                const r0 = pre.getBoundingClientRect(), r1 = post.getBoundingClientRect();
                const im=els.map(e=>e.querySelector('img')).find(Boolean);return { y: r0.top + scrollY, h: r1.bottom - r0.top, n: els.length, bw: im?Math.round(im.getBoundingClientRect().width):0 };
            });
            const f = path.join(outDir, `${name}_${w === 390 ? '폰390' : 'PC860'}_자리.jpg`);
            await pg.screenshot({ path: f, type: 'jpeg', quality: 75, clip: { x: 0, y: Math.max(0, box.y - 10), width: w, height: Math.min(box.h + 20, 6000) }, fullPage: true });
            res[w] = { jpg: f, naver_css: cssOk, added: box.n, banner_w: box.bw };
            await pg.close();
        }
    } finally { await b.close(); }
    console.log(JSON.stringify(res));
})();
