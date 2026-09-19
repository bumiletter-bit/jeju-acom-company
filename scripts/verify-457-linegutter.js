// #457 검증: 송장변환 v2 — ①메뉴(끼우기) 높이 되먹임 제거·빈 화면 짧게 ②붙여넣기 칸 줄별 판정 표시(확인완료/확인필요/주문 없음) + 요약 칩 + 문제 줄로 이동
//   로컬 실서버 자동 기동 · 실DB 읽기만 · 원본 = Downloads의 9/18 09:26 네이버 파일(인자로 다른 파일 지정 가능)
//   사용: node scripts/verify-457-linegutter.js [원본.xlsx] [스크린샷 저장 폴더]
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const { spawn } = require('child_process');
const jwt = require('jsonwebtoken'); const XLSX = require('xlsx-js-style');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 220) : '')); };
const PORT = 3457, BASE = `http://localhost:${PORT}`;
const XLS = process.argv[2] || 'C:/Users/전승범/Downloads/스마트스토어_전체주문발주발송관리_20260918_0926.xlsx', SHOT = process.argv[3] || '';
const TOKEN = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
(async () => {
    if (!fs.existsSync(XLS)) { console.log('원본 파일 없음 — 중단'); process.exit(1); }
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: 'ignore' });
    try {
        for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/public/version`); if (r.ok) break; } catch (_) { } await new Promise(r => setTimeout(r, 1000)); }
        const aoa = XLSX.utils.sheet_to_json(XLSX.readFile(XLS).Sheets['발주발송관리'], { header: 1, defval: '' }); const hi = aoa.findIndex(r => r.includes('상품주문번호')); const H = aoa[hi];
        const rows = aoa.slice(hi + 1).filter(r => r[H.indexOf('상품주문번호')]); const byTel = {}; rows.forEach(r => { const t = String(r[H.indexOf('구매자연락처')]).replace(/\D/g, ''); if (t.length >= 10) byTel[t] = (byTel[t] || 0) + 1; });
        const one = Object.keys(byTel).find(t => byTel[t] === 1), two = Object.keys(byTel).find(t => byTel[t] === 2), many = Object.keys(byTel).find(t => byTel[t] >= 3);
        const { chromium } = require('playwright'); const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
        await ctx.addInitScript(t => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범' })); }, TOKEN);
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));

        // ① 메뉴(끼우기) 높이: 빈 화면이 계속 자라지 않고, 내용 높이와 같고, 탭을 바꾸면 줄어든다
        await pg.goto(`${BASE}/`, { waitUntil: 'load' }); await pg.waitForTimeout(2500); await pg.evaluate(() => switchPage('invoice')); await pg.waitForTimeout(4000);
        const frameH = () => pg.evaluate(() => Math.round(document.getElementById('invoice-v2-frame').getBoundingClientRect().height));
        const h1 = await frameH(); await pg.waitForTimeout(5000); const h2 = await frameH();
        const fr = pg.frames().find(f => /invoice-v2/.test(f.url()));
        const inner = await fr.evaluate(() => ({ main: Math.ceil(document.querySelector('.main-content').getBoundingClientRect().bottom + scrollY), review: getComputedStyle(document.getElementById('review-card')).display, preview: getComputedStyle(document.getElementById('preview-card')).display }));
        ok(h1 === h2, '① 빈 화면 높이가 5초 뒤에도 그대로(되먹임 없음)', `${h1} → ${h2}`);
        ok(Math.abs(h1 - inner.main) <= 16 && h1 < 1700, '① 프레임 높이 = 내용 높이(빈 화면 1,700px 미만 — 종전 4,100px+)', `프레임 ${h1} · 내용 ${inner.main}`);
        ok(inner.review === 'none' && inner.preview === 'none', '① 주문 없을 땐 검토·미리보기 카드 숨김');
        await fr.click('#ivt-mode-qty'); await pg.waitForTimeout(2500); const hq = await frameH();
        await fr.click('#ivt-mode-convert'); await pg.waitForTimeout(2500); const hc = await frameH();
        ok(hq < h1 && Math.abs(hc - h1) <= 16, '① 중간발주 탭으로 가면 줄고, 돌아오면 원래 높이(줄어들 줄 앎)', `송장 ${h1} → 중간발주 ${hq} → 송장 ${hc}`);

        // ② 줄별 판정 — 독립 페이지에서 실파일로
        await pg.goto(`${BASE}/invoice-v2.html`, { waitUntil: 'load' }); await pg.waitForFunction(() => window.__ivt, null, { timeout: 20000 });
        const geo0 = await pg.evaluate(() => { const ta = document.getElementById('ln-all'), cs = getComputedStyle(ta); return { wrapped: ta.parentNode.classList.contains('ivt-ed'), lh: cs.lineHeight, pt: cs.paddingTop, h: Math.round(ta.getBoundingClientRect().height), gutH: Math.round(document.querySelector('#ln-all').parentNode.querySelector('.ivt-gut').getBoundingClientRect().height) }; });
        ok(geo0.wrapped && geo0.lh === '24px' && geo0.pt === '10px' && geo0.h === 5 * 24 + 20 && geo0.gutH === geo0.h, '② 칸 장착: 줄 높이 24px · 빈 칸 = 5줄 높이 · 표시 칸과 같은 높이', JSON.stringify(geo0));
        await pg.waitForFunction(() => __ivt.S.today, null, { timeout: 20000 });
        const today = await pg.evaluate(() => __ivt.S.today); const usd = iso => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(2, 4)}`;
        const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); const past = d.toISOString().slice(0, 10);
        const LINES = ['요청일자\t번호\t비고\t플랫폼', `${usd(today)}\t${one}\t입력o삭제x\t네이버`, `${usd(today)}\t${two}\t입력o삭제x 3건\t네이버`, '', `${usd(today)}\t010-1234-0000\t\t네이버`, `${usd(past)}\t${many}\t\t네이버`, '그냥 메모 한 줄'];
        await pg.fill('#ln-all', LINES.join('\n')); await pg.click('#save-all'); await pg.waitForTimeout(400); await pg.waitForFunction(() => !document.getElementById('save-all').disabled); await pg.waitForTimeout(300);
        const marks = () => pg.evaluate(() => Array.from(document.querySelectorAll('#ln-all')[0].parentNode.querySelectorAll('.ivt-gut .m')).map(m => (m.className.replace('m', '').trim() || '-') + ':' + m.textContent.trim()));
        const m0 = await marks();
        ok(m0.length === LINES.length && m0[0] === '-:' && m0[3] === '-:' && [1, 2, 4, 5].every(i => /^wait:/.test(m0[i])) && /^warn:.*형식/.test(m0[6]), '② 주문 불러오기 전: 줄마다 「불러오기 전」 · 헤더/빈 줄은 표시 없음 · 형식 오류 줄 표시', JSON.stringify(m0));
        await pg.setInputFiles('#file-naver', XLS); await pg.waitForFunction(n => document.querySelectorAll('#preview tbody tr').length === n, rows.length, { timeout: 30000 }); await pg.waitForTimeout(800);
        const m1 = await marks();
        ok(/^ok:.*확인완료 1건/.test(m1[1]) && /^warn:.*건수 다름 2건/.test(m1[2]) && /^none:.*주문 없음/.test(m1[4]) && new RegExp('^warn:.*확인필요 ' + byTel[many] + '/' + byTel[many] + '건').test(m1[5]) && /^warn:.*형식/.test(m1[6]), '② 주문 불러온 뒤: 확인완료 1건 / 건수 다름 2건(비고 3건) / 주문 없음 / 지난 날짜 확인필요 n/n건 / 형식 확인', JSON.stringify(m1));
        const bar = await pg.evaluate(() => Array.from(document.querySelectorAll('#save-all')[0].parentNode.querySelectorAll('.ivt-linebar button')).map(b => b.className + '|' + b.textContent.replace(/\s+/g, ' ').trim()));
        ok(bar.length === 3 && /^warn\|.*확인필요 3줄/.test(bar[0]) && /^none\|.*주문 없음 1줄/.test(bar[1]) && /^ok\|.*확인완료 1줄/.test(bar[2]), '② 요약 칩: 확인필요 3 · 주문 없음 1 · 확인완료 1(문제가 앞)', JSON.stringify(bar));
        const geo = await pg.evaluate(() => { const ta = document.getElementById('ln-all'), g = ta.parentNode.querySelector('.ivt-gut'); const ms = Array.from(g.querySelectorAll('.m')); return { h: Math.round(ta.getBoundingClientRect().height), tops: ms.map(m => m.offsetTop - g.offsetTop), review: getComputedStyle(document.getElementById('review-card')).display }; });
        ok(geo.h === LINES.length * 24 + 20 && geo.tops.every((t, i) => t === 10 + i * 24) && geo.review !== 'none', '② 칸 높이 = 줄 수(7줄)에 맞춤 · 표시가 줄마다 24px 간격으로 정렬 · 주문이 생기면 검토 카드 표시', JSON.stringify({ h: geo.h, tops: geo.tops.slice(0, 4) }));
        // 문제 줄로 이동: 확인필요 칩을 누를 때마다 다음 확인필요 줄 선택(2 → 5 → 6 → 2)
        const sel = async () => pg.evaluate(() => { const ta = document.getElementById('ln-all'); return ta.value.slice(0, ta.selectionStart).split('\n').length - 1; });
        const seq = []; for (let i = 0; i < 4; i++) { await pg.click('.ivt-linebar button.warn'); seq.push(await sel()); }
        ok(JSON.stringify(seq) === '[2,5,6,2]', '② 「확인필요」 칩 클릭 → 확인필요 줄을 차례로 선택(돌아옴)', JSON.stringify(seq));
        await pg.click('.ivt-linebar button.none'); ok((await sel()) === 4 && (await pg.evaluate(() => document.querySelector('.ivt-gut .m.cur') && document.querySelector('.ivt-gut .m.cur').dataset.i)) === '4', '② 「주문 없음」 칩 클릭 → 그 줄 선택 + 표시 칸 강조');
        // 저장 뒤 내용 수정 → 표시 흐림 + 다시 저장 안내 → 저장하면 복구
        await pg.click('#ln-all'); await pg.keyboard.press('End'); await pg.keyboard.type(' ');
        const stale = await pg.evaluate(() => ({ cls: document.getElementById('ln-all').parentNode.classList.contains('stale'), note: getComputedStyle(document.querySelector('.ivt-linebar .stale-note')).display }));
        ok(stale.cls && stale.note !== 'none', '② 저장 뒤 내용을 고치면 표시가 흐려지고 「다시 저장」 안내');
        await pg.click('#save-all'); await pg.waitForTimeout(400); await pg.waitForFunction(() => !document.getElementById('save-all').disabled); await pg.waitForTimeout(300);
        ok(!(await pg.evaluate(() => document.getElementById('ln-all').parentNode.classList.contains('stale'))), '② 다시 저장 → 표시 복구');
        // 긴 목록: 40줄 → 칸은 14줄 높이까지만 · 표시 칸 스크롤 동기
        await pg.fill('#ln-all', Array.from({ length: 40 }, (_, i) => `${usd(today)}\t010-7000-${String(1000 + i)}\t\t네이버`).join('\n')); await pg.click('#save-all'); await pg.waitForTimeout(400); await pg.waitForFunction(() => !document.getElementById('save-all').disabled); await pg.waitForTimeout(300);
        const long = await pg.evaluate(() => { const ta = document.getElementById('ln-all'), g = ta.parentNode.querySelector('.ivt-gut'); ta.scrollTop = 300; ta.dispatchEvent(new Event('scroll')); return { h: Math.round(ta.getBoundingClientRect().height), n: g.querySelectorAll('.m').length, sync: g.scrollTop === ta.scrollTop && ta.scrollTop > 0 }; });
        ok(long.h === 14 * 24 + 20 && long.n === 40 && long.sync, '② 40줄: 칸 높이는 14줄까지만 · 표시 40개 · 스크롤 동기', JSON.stringify(long));
        if (SHOT) { await pg.fill('#ln-all', LINES.join('\n')); await pg.click('#save-all'); await pg.waitForTimeout(900); await pg.locator('#ln-all').scrollIntoViewIfNeeded(); const card = pg.locator('#ln-all').locator('xpath=ancestor::div[contains(@class,"card")][1]'); await card.screenshot({ path: path.join(SHOT, 'v457-lines.png') }); console.log('  📷 스크린샷 저장'); }
        // 초기화 → 표시·칩 비움 + 검토 카드 다시 숨김
        pg.on('dialog', dlg => dlg.accept()); await pg.click('#btn-reset'); await pg.waitForTimeout(500);
        const rst = await pg.evaluate(() => ({ marks: document.querySelectorAll('.ivt-gut')[1] ? 0 : 0, m: document.getElementById('ln-all').parentNode.querySelectorAll('.ivt-gut .m span').length, bar: document.getElementById('save-all').parentNode.querySelector('.ivt-linebar').children.length, review: getComputedStyle(document.getElementById('review-card')).display, note: getComputedStyle(document.getElementById('save-all').parentNode.querySelector('.ivt-note')).display }));
        ok(rst.m === 0 && rst.bar === 0 && rst.review === 'none' && rst.note !== 'none', '② 초기화 → 표시·칩 비움 · 안내 문구 복귀 · 검토 카드 다시 숨김', JSON.stringify(rst));
        // 중간발주 탭도 같은 칸
        await pg.click('#ivt-mode-qty'); const qed = await pg.evaluate(() => document.getElementById('qln-all').parentNode.classList.contains('ivt-ed') && !!document.getElementById('qsave-all').parentNode.querySelector('.ivt-linebar'));
        ok(qed, '② 중간발주 탭 붙여넣기 칸에도 같은 줄별 표시 장착');
        ok(errs.length === 0, 'pageerror 0', errs.join(' | '));
        await br.close();
    } finally { srv.kill(); }
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
