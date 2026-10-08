// #584 에이전트 오피스 [복사] 보강 검증 — 접힌 이력 줄 [복사] · 막힌 브라우저에서 글 골라 두기 · 폰 44px · 가로 넘침 · 야간 대비 (포트 3463 · 실DB 읽기 · 쓰기 가로채기)
const path = require('path');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js'));
const PC = { width: 1440, height: 900 }, PH = { width: 390, height: 844 };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
(async () => {
    const h = await H.start(3463, 'v584');
    try {
        const SH = { id: 8, name: '현승협', position: '대리', role: 'user' };
        const prep = async (P, deny) => {
            const pg = P.pg; const toasts = [];
            await pg.exposeFunction('__toast', t => toasts.push(t));
            await pg.evaluate(() => { const mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && /toast/i.test(n.className || '')) window.__toast(n.textContent.trim()); }))); mo.observe(document.body, { childList: true, subtree: true }); });
            if (deny) await pg.evaluate(() => { try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('NotAllowedError')), readText: () => Promise.reject(new Error('x')) } }); } catch (e) { } document.execCommand = () => false; });
            await pg.evaluate(() => document.querySelector('#desk-tabs .desk-tab[data-tab="all"]').click()); await pg.waitForTimeout(1500);
            return toasts;
        };
        for (const [label, vw, phone, theme] of [['PC', PC, false, null], ['폰', PH, true, null], ['PC 야간', PC, false, 'dark']]) {
            const P = await h.open(SH, vw, { phone, page: 'agent-office', theme });
            await P.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3463' });
            const toasts = await prep(P, false); const pg = P.pg;
            const rows = await pg.locator('#desk-list .desk-h-item').count();
            const btns = pg.locator('#desk-list .desk-h-item > .desk-h-copy');
            const nb = await btns.count();
            ok(rows > 0 && nb > 0 && nb <= rows, `[${label}] 접힌 이력 줄 ${rows}개 중 답이 있는 줄에 [복사] ${nb}개`);
            const box = await btns.first().boundingBox();
            ok(box && (phone ? box.height >= 44 && box.width >= 44 : box.height >= 32), `[${label}] [복사] 크기 ${box ? Math.round(box.width) + 'x' + Math.round(box.height) : '?'}`);
            const sw = await pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
            ok(sw <= vw.width, `[${label}] 가로 넘침 없음(scrollWidth ${sw} ≤ ${vw.width})`);
            // 겹침: [복사]가 줄의 글자 위에 얹히지 않는지(글 칸 오른쪽 끝 < 버튼 왼쪽)
            const ovl = await pg.evaluate(() => { const it = document.querySelector('#desk-list .desk-h-item:has(> .desk-h-copy)'); if (!it) return null; const b = it.querySelector(':scope > .desk-h-copy').getBoundingClientRect(); const t = it.querySelector('.desk-h-text').getBoundingClientRect(); const m = it.querySelector('.desk-h-meta').getBoundingClientRect(); return { tr: Math.round(t.right), mr: Math.round(m.right), bl: Math.round(b.left) }; });
            ok(ovl && ovl.tr <= ovl.bl + 1 && ovl.mr <= ovl.bl + 1, `[${label}] 버튼이 글·배지와 안 겹침(${JSON.stringify(ovl)})`);
            // 검색 뒤에도 남는지
            const first = await pg.locator('#desk-list .desk-h-item .desk-h-text').first().innerText();
            const word = (first.match(/[가-힣A-Za-z]{2,}/g) || [])[0] || '';
            await pg.fill('#desk-hist-q', word); await pg.waitForTimeout(1200);
            const nb2 = await pg.locator('#desk-list .desk-h-item > .desk-h-copy').count();
            ok(nb2 > 0, `[${label}] 검색 「${word}」 결과에도 [복사] ${nb2}개`);
            await pg.locator('#desk-list .desk-h-item > .desk-h-copy').first().click({ timeout: 3000 }); await pg.waitForTimeout(700);
            const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '');
            ok(toasts.some(t => /복사했어요/.test(t)) && clip.length > 10, `[${label}] 접힌 줄 [복사] → 토스트 「${toasts[toasts.length - 1] || ''}」 · 클립보드 ${clip.length}자`);
            const stillCollapsed = await pg.evaluate(() => !document.querySelector('#desk-list .desk-h-item.open'));
            ok(stillCollapsed, `[${label}] 눌러도 줄이 펼쳐지지 않음(복사만)`);
            if (theme) { const a = await H.audit(pg, '#desk-list'); ok(a.fails.length === 0, `[${label}] 야간 대비 미달 0(글자 ${a.texts}개)`); }
            ok(P.errors.length === 0 && P.writes.length === 0, `[${label}] 화면 오류 ${P.errors.length} · 쓰기 ${P.writes.length}`);
            await P.ctx.close();
        }
        {   // 막힌 브라우저 — 펼친 카드의 [답변 복사] → 글 골라 두기
            const P = await h.open(SH, PC, { page: 'agent-office' }); const toasts = await prep(P, true); const pg = P.pg;
            await pg.locator('#desk-list .desk-h-item .desk-h-row').first().click({ timeout: 3000 }); await pg.waitForTimeout(600);
            const b = pg.locator('#desk-list .desk-h-item.open button[data-act="copy"], #desk-list .desk-h-item.open button[data-act="copysec"]').first();
            ok(await b.count() > 0, '[막힘] 펼친 카드에 복사 버튼');
            await b.click({ timeout: 3000 }); await pg.waitForTimeout(600);
            const sel = await pg.evaluate(() => String(window.getSelection()).trim().length);
            ok(toasts.some(t => /골라 두었어요/.test(t)) && sel > 10, `[막힘] 토스트 「${toasts[toasts.length - 1] || ''}」 · 골라 둔 글 ${sel}자`);
            // 접힌 줄의 [복사]는 글이 없어 안내만
            await pg.evaluate(() => { const o = document.querySelector('#desk-list .desk-h-item.open .desk-h-row'); if (o) o.click(); }); await pg.waitForTimeout(500);
            const cb = pg.locator('#desk-list .desk-h-item > .desk-h-copy').first();
            if (await cb.count()) { await cb.click({ timeout: 3000 }); await pg.waitForTimeout(500); ok(/직접 선택해/.test(toasts[toasts.length - 1] || ''), `[막힘] 접힌 줄 [복사] → 안내 「${toasts[toasts.length - 1] || ''}」`); }
            await P.ctx.close();
        }
    } finally { await h.stop(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
