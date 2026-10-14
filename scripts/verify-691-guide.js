// #691 검증: 알림톡 안내 페이지(/guide) 품목 장의 「네이버에서 구매하기」 버튼
//   ①행에 네이버 상품 번호가 있으면 버튼(https://brand.naver.com/jejuakkome/products/번호 · 새 탭 · noopener) ②번호가 없으면 버튼도 글자도 없음(종전 「구매처 링크 준비 중」 제거)
//   ③주문 표식 링크는 그 주문이 실제로 산 상품 번호(발송 기록 guide_pno)로 ④묶음 목록·삭제된 행 장도 같은 규칙 ⑤폰 390 가로 넘침 0 · 버튼 높이 44 이상
//   새 서버(SERVER691 · 없으면 ./server.js · 포트 3466) 하나만 띄운다. 실DB 읽기만(쓰기 0 · 스케줄러 막음). 브라우저 구간은 --no-browser 로 건너뛸 수 있다.
//   실행: node scripts/verify-691-guide.js [--no-browser]
require('dotenv').config();
const path = require('path'); const { spawn } = require('child_process'); const { Client } = require('pg');
const ROOT = path.join(__dirname, '..'), PORT = Number(process.env.PORT691 || 3466), SERVER = process.env.SERVER691 || './server.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + String(d).slice(0, 260) : '')); };
const start = (file, port) => spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require(${JSON.stringify(file)});`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
const waitUp = async port => { for (let i = 0; i < 90; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${port}/track-order`); if (r.status) return true; } catch (_) { } } return false; };
const URL_RE = /<a class="buy-btn" href="([^"]*)" target="_blank" rel="noopener">네이버에서 구매하기 ›<\/a>/g;
const page = async q => { const r = await fetch(`http://localhost:${PORT}/guide${q}`, { headers: { Connection: 'close' } }); const t = await r.text(); return { status: r.status, t, items: (t.match(/<details class="item"/g) || []).length, open: (t.match(/<details class="item" open>/g) || []).length, btns: [...t.matchAll(URL_RE)].map(m => m[1]), anyBtn: (t.match(/class="buy-btn"/g) || []).length }; };
const HREF = no => 'https://brand.naver.com/jejuakkome/products/' + no;

(async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
    const srv = start(SERVER, PORT); let err = ''; srv.stderr.on('data', d => { err += String(d); });
    try {
        if (!await waitUp(PORT)) throw new Error('서버가 안 떴어요: ' + err.slice(0, 300));
        const HAS = `shipping_guide IS NOT NULL AND btrim(shipping_guide) <> ''`;
        const one = async sql => (await db.query(sql)).rows[0] || null;
        const withNo = await one(`SELECT id, name, naver_product_no FROM bot_products WHERE deleted_at IS NULL AND status = '판매중' AND naver_product_no IS NOT NULL AND ${HAS} ORDER BY id DESC LIMIT 1`);
        const noNo = await one(`SELECT id, name, status FROM bot_products WHERE deleted_at IS NULL AND naver_product_no IS NULL AND ${HAS} ORDER BY id LIMIT 1`);
        const offNo = await one(`SELECT id, name, status, naver_product_no FROM bot_products WHERE deleted_at IS NULL AND status <> '판매중' AND naver_product_no IS NOT NULL AND ${HAS} ORDER BY id DESC LIMIT 1`);
        const delNo = await one(`SELECT id, name, naver_product_no FROM bot_products WHERE deleted_at IS NOT NULL AND naver_product_no IS NOT NULL AND ${HAS} ORDER BY id DESC LIMIT 1`);
        const delNoNo = await one(`SELECT id, name FROM bot_products WHERE deleted_at IS NOT NULL AND naver_product_no IS NULL AND ${HAS} ORDER BY id DESC LIMIT 1`);
        const tok = await one(`SELECT l.guide_token, l.guide_pno FROM lms_guide_log l JOIN bot_products p ON p.id = l.guide_pid WHERE l.guide_token IS NOT NULL AND l.guide_pno IS NOT NULL AND p.deleted_at IS NULL AND p.${HAS} ORDER BY l.id DESC LIMIT 1`);
        const tokOther = await one(`SELECT l.guide_token, l.guide_pno, p.naver_product_no FROM lms_guide_log l JOIN bot_products p ON p.id = l.guide_pid WHERE l.guide_token IS NOT NULL AND l.guide_pno IS NOT NULL AND p.deleted_at IS NULL AND p.naver_product_no IS NOT NULL AND p.naver_product_no <> l.guide_pno AND p.${HAS} ORDER BY l.id DESC LIMIT 1`);
        const sell = (await db.query(`SELECT name, shipping_guide, naver_product_no FROM bot_products WHERE deleted_at IS NULL AND status = '판매중' AND ${HAS}`)).rows;
        console.log(`  (고른 것: 번호 있음 ${withNo && withNo.id} · 번호 없음 ${noNo && noNo.id}(${noNo && noNo.status}) · 판매중 아님+번호 ${offNo && offNo.id} · 삭제+번호 ${delNo && delNo.id} · 삭제+번호 없음 ${delNoNo && delNoNo.id} · 표식 ${tok ? '있음' : '없음'} · 표식(행과 다른 상품) ${tokOther ? '있음' : '없음'})`);

        console.log('① 번호가 있는 행 — 버튼');
        if (withNo) { const a = await page('?p=' + withNo.id); ok(a.status === 200 && a.items === 1 && a.open === 1 && a.btns.length === 1 && a.btns[0] === HREF(withNo.naver_product_no) && a.anyBtn === 1, `판매중 품목(${withNo.id}): 버튼 1개 · 링크 = 그 행의 네이버 상품(${withNo.naver_product_no}) · 새 탭 · noopener`, a.btns.join(',') + ' / ' + a.anyBtn); } else ok(false, '번호 있는 판매중 행이 없어 못 봄');
        { const a = await page('?p=621'); const r = await one(`SELECT naver_product_no, deleted_at FROM bot_products WHERE id = 621`); if (r && !r.deleted_at && r.naver_product_no) ok(a.btns.length === 1 && a.btns[0] === HREF(r.naver_product_no), `그린레몬 못난이(621): 링크 = ${r.naver_product_no}`, a.btns.join(',')); }
        if (offNo) { const a = await page('?p=' + offNo.id); ok(a.items === 1 && a.btns.length === 1 && a.btns[0] === HREF(offNo.naver_product_no), `판매중 아닌 품목(${offNo.id} · ${offNo.status}): 번호가 있으면 같은 버튼`, a.btns.join(',')); }
        if (delNo) { const a = await page('?p=' + delNo.id); ok(a.items === 1 && a.open === 1 && a.btns.length === 1 && a.btns[0] === HREF(delNo.naver_product_no), `삭제된 품목(${delNo.id}): 번호가 있으면 같은 버튼`, a.btns.join(',')); }

        console.log('② 번호가 없는 행 — 버튼도 글자도 없음');
        if (noNo) { const a = await page('?p=' + noNo.id); ok(a.status === 200 && a.items === 1 && a.open === 1 && a.anyBtn === 0, `번호 없는 품목(${noNo.id} · ${noNo.status}): 안내문은 뜨고 버튼 0`, a.anyBtn); } else console.log('    (번호 없는 행이 없어 건너뜀)');
        if (delNoNo) { const a = await page('?p=' + delNoNo.id); ok(a.items === 1 && a.anyBtn === 0, `삭제+번호 없는 품목(${delNoNo.id}): 버튼 0`, a.anyBtn); }

        console.log('③ 주문 표식 링크 — 그 주문이 산 상품으로');
        if (tok) { const a = await page('?p=' + tok.guide_token); ok(a.status === 200 && a.items === 1 && a.btns.length === 1 && a.btns[0] === HREF(tok.guide_pno), `표식 링크: 버튼 링크 = 발송 기록의 상품 번호(${tok.guide_pno})`, a.btns.join(',')); } else console.log('    (표식 기록이 없어 건너뜀)');
        if (tokOther) { const a = await page('?p=' + tokOther.guide_token); ok(a.btns.length === 1 && a.btns[0] === HREF(tokOther.guide_pno) && a.btns[0] !== HREF(tokOther.naver_product_no), `표식 링크(행 번호 ${tokOther.naver_product_no} ≠ 산 상품 ${tokOther.guide_pno}): 산 상품 쪽으로`, a.btns.join(',')); } else console.log('    (행 번호와 산 상품이 다른 표식 기록이 없어 그 갈래는 건너뜀)');
        { const a = await page('?p=8999999999999'); ok(a.status === 200 && a.items > 0 && a.open === (a.items === 1 ? 1 : 0), '기록 없는 표식: 500 없이 묶음 목록'); }

        console.log('④ 묶음 목록(고른 품목 없음)');
        { const a = await page(''); const g = new Map(); for (const r of sell) { const k = String(r.shipping_guide).trim(); if (!g.has(k)) g.set(k, new Set()); if (r.naver_product_no) g.get(k).add(String(r.naver_product_no)); }
          const want = [...g.values()].filter(s => s.size === 1).map(s => HREF([...s][0])).sort();
          ok(a.status === 200 && a.items === g.size && JSON.stringify(a.btns.slice().sort()) === JSON.stringify(want) && a.anyBtn === want.length, `묶음 ${g.size}장 · 버튼 ${want.length}개 = 묶인 행의 네이버 상품이 하나인 묶음마다 그 번호`, `화면 ${a.btns.length} / 기대 ${want.length}`); }

        console.log('⑤ 옛 글자·옛 스타일 없음 · 바깥 코드');
        for (const [label, q] of [['번호 있음', withNo ? '?p=' + withNo.id : ''], ['번호 없음', noNo ? '?p=' + noNo.id : ''], ['목록', '']]) { const a = await page(q); ok(!/구매처 링크 준비 중|buy-slot/.test(a.t), `${label}: 「구매처 링크 준비 중」·옛 칸 없음`); }
        { const a = await page(withNo ? '?p=' + withNo.id : ''); ok(/\.buy-btn \{[^}]*min-height:46px[^}]*background:var\(--navy\)/.test(a.t) && !/\.buy-btn \{[^}]*#(?!FFFDF5)[0-9A-Fa-f]{3,6}/.test(a.t.match(/\.buy-btn \{[^}]*\}/)[0]), '버튼 스타일 = 이벤트 버튼과 같은 색(--navy · #FFFDF5) · 높이 46'); }
        { const fs = require('fs'); const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'); const g = src.slice(src.indexOf("app.get('/guide'"), src.indexOf("app.get('/track'"));
          ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(g), '/guide 구획에 쓰기 0'); ok(/\^\\d\{6,18\}\$/.test(g), '번호는 숫자 6~18자리일 때만 링크로'); }

        if (!process.argv.includes('--no-browser')) {
            console.log('⑥ 폰 390 실렌더');
            const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright')); const br = await chromium.launch();
            try {
                const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 80)));
                for (const [label, q] of [['고른 품목', withNo ? '?p=' + withNo.id : ''], ['묶음 목록', '']]) {
                    await pg.goto(`http://localhost:${PORT}/guide${q}`, { waitUntil: 'networkidle' });
                    if (!q) await pg.evaluate(() => document.querySelectorAll('details.item').forEach(d => { d.open = true; }));
                    const m = await pg.evaluate(() => { const bs = [...document.querySelectorAll('a.buy-btn')].map(b => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { h: r.height, l: r.left, rt: r.right, bg: cs.backgroundColor, fg: cs.color }; }); return { over: document.documentElement.scrollWidth - window.innerWidth, bs }; });
                    ok(m.over <= 0 && m.bs.length > 0 && m.bs.every(b => b.h >= 44 && b.l >= 0 && b.rt <= 390), `${label}: 가로 넘침 0 · 버튼 ${m.bs.length}개 높이 ${Math.round(Math.min(...m.bs.map(b => b.h)))}px 이상 · 화면 안`, JSON.stringify(m).slice(0, 200));
                }
                ok(errs.length === 0, '페이지 오류 0', errs.join(' | '));
            } finally { await br.close(); }
        }
    } catch (e) { ok(false, '예외', e.message); }
    finally { try { srv.kill(); } catch (_) { } await db.end().catch(() => { }); }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
