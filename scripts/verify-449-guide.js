// #449 검증: /guide 이벤트 블록 — A(적용 전): 카드 함수 단위 + 구(HEAD)/신 서버 /guide 바이트 동일(설정 없음) · B(적용 후): 신 서버 실렌더 카드·버튼·에러 0, 구 서버 무카드
//   사용: node scripts/verify-449-guide.js a | b   (구 서버 = 리포 루트 _server_old_449.js = git show HEAD:server.js — 검증 후 삭제)
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const { spawn } = require('child_process');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 220) : '')); };
const STAGE = process.argv[2] || 'a';
const NEW = 3457, OLD = 3458, PID = 213;
function startServer(file, port) {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./${file}');`],
        { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stderr.on('data', d => { const t = String(d); if (/error/i.test(t)) console.log('  [srv ' + port + '] ' + t.slice(0, 200)); });
    return srv;
}
async function waitUp(port) { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${port}/api/public/version`); if (r.ok) return; } catch (_) { } await new Promise(r => setTimeout(r, 1000)); } throw new Error('server not up ' + port); }
const get = async (port, q) => (await fetch(`http://localhost:${port}/guide${q}`)).text();
(async () => {
    // 단위: 실코드에서 함수 추출
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const i0 = src.indexOf('function guideEventCardHtml('); const i1 = src.indexOf('\n}\n', i0) + 3;
    const g0 = src.indexOf('function guideEsc('); const g1 = src.indexOf('\n', g0) + 1;
    const fn = new Function(src.slice(g0, g1) + src.slice(i0, i1) + '; return guideEventCardHtml;')();
    const base = { enabled: true, title: 'T<script>', lines: ['L1', 'L2'], btn: 'B', url: 'https://event.akkome.com/lucky.html', start: '2026-09-10', end: '2026-09-30' };
    const at = d => new Date(d + 'T03:00:00Z').getTime();   // KST 정오
    ok(fn(null, at('2026-09-16')) === '' && fn(undefined, at('2026-09-16')) === '', '단위: 설정 없음 → 빈 문자열');
    ok(fn({ ...base, enabled: false }, at('2026-09-16')) === '', '단위: enabled=false → 빈 문자열');
    ok(fn(base, at('2026-09-09')) === '' && fn(base, at('2026-10-01')) === '', '단위: 기간 밖(9/9·10/1) → 빈 문자열');
    ok(fn(base, at('2026-09-10')) !== '' && fn(base, at('2026-09-30')) !== '', '단위: 경계일(9/10·9/30) 포함');
    ok(fn({ ...base, url: 'javascript:alert(1)' }, at('2026-09-16')) === '' && fn({ ...base, url: 'http://x.com' }, at('2026-09-16')) === '', '단위: https 외 URL 거부');
    const h = fn(base, at('2026-09-16'));
    ok(h.includes('T&lt;script&gt;') && !h.includes('T<script>') && h.includes('<p>L1</p><p>L2</p>') && h.includes('href="https://event.akkome.com/lucky.html"') && h.includes('B ›'), '단위: 이스케이프·본문·버튼·링크');
    // KST 경계: UTC 9/29 16:00 = KST 9/30 01:00 → 포함 / UTC 9/30 15:00 = KST 10/1 00:00 → 제외
    ok(fn(base, Date.parse('2026-09-29T16:00:00Z')) !== '' && fn(base, Date.parse('2026-09-30T15:00:00Z')) === '', '단위: end 판정 KST 기준');
    // 서버 2대
    const sNew = startServer('server.js', NEW), sOld = startServer('_server_old_449.js', OLD);
    try {
        await waitUp(NEW); await waitUp(OLD);
        const [nP, oP, n0, o0] = await Promise.all([get(NEW, '?p=' + PID), get(OLD, '?p=' + PID), get(NEW, ''), get(OLD, '')]);
        if (STAGE === 'a') {
            ok(nP === oP && nP.length > 2000, 'A: 설정 없음 — /guide?p= 구/신 바이트 동일', nP.length);
            ok(n0 === o0, 'A: 설정 없음 — /guide 구/신 바이트 동일', n0.length);
            ok(!nP.includes('class="ev"'), 'A: 카드 미출력');
        } else {
            ok(nP.includes('class="ev"') && nP.includes('접수·당첨 확인 바로가기') && nP.includes('href="https://event.akkome.com/lucky.html"'), 'B: 신 서버 카드 출력(제목·버튼·링크)');
            ok(!oP.includes('class="ev"'), 'B: 구 서버 카드 없음(코드 배포 전 화면 무변경)');
            ok(nP.replace(/<style>\n  \.ev[\s\S]*?<\/style>\n    <section class="ev"[\s\S]*?<\/section>/, '') === oP, 'B: 카드 블록만 빼면 구/신 바이트 동일(다른 마크업 무접촉)');
            ok(n0.includes('class="ev"'), 'B: p 없이 열어도 카드 출력');
            // 실렌더(Playwright)
            const { chromium } = require('playwright');
            const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 390, height: 844 } });
            const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
            await pg.goto(`http://localhost:${NEW}/guide?p=${PID}`, { waitUntil: 'load' });
            const ev = pg.locator('section.ev'); const vis = await ev.isVisible(); const box = await ev.boundingBox();
            const hdBox = await pg.locator('.hd').boundingBox(); const itemBox = await pg.locator('details.item').first().boundingBox();
            ok(vis && box && hdBox && itemBox && box.y > hdBox.y && box.y + box.height <= itemBox.y + 1, 'B: 실렌더 카드 보임·위치 = 헤더 아래·안내문 위', JSON.stringify({ hd: hdBox && hdBox.y, ev: box && box.y, item: itemBox && itemBox.y }));
            const btn = pg.locator('section.ev a.ev-btn'); const bb = await btn.boundingBox();
            ok(bb && bb.height >= 44 && bb.width >= 200 && (await btn.getAttribute('href')) === 'https://event.akkome.com/lucky.html' && (await btn.getAttribute('target')) === '_blank', 'B: 버튼 터치 영역 44px↑·새 창 링크', JSON.stringify(bb));
            const titleTxt = await pg.locator('details.item[open] summary').first().textContent();
            ok(/하우스감귤/.test(titleTxt || ''), 'B: 주문 상품 안내문 펼침 무회귀', titleTxt);
            ok(errs.length === 0, 'B: pageerror·console error 0', errs.join(' | '));
            await pg.screenshot({ path: path.join(__dirname, '..', 'scripts', 'guide-449-shot.png'), fullPage: false });
            await br.close();
        }
    } finally { sNew.kill(); sOld.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
