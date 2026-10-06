// #569 시공용 탐침: node scripts/ao-dark/probe.js <메뉴,메뉴…> [--phone] [--user=대표|과장|직원] [--shot=폴더] [--modals]
//   그 메뉴를 야간으로 열어 대비 미달·흰 칸을 찍어 본다(탭을 차례로 눌러 가며). 검증이 아니라 예외표를 채우기 위한 도구.
const path = require('path'), fs = require('fs');
const H = require('./harness.js');
const args = process.argv.slice(2), pages = (args.find(a => !a.startsWith('--')) || 'schedule').split(',');
const phone = args.includes('--phone'), who = (args.find(a => a.startsWith('--user=')) || '--user=대표').slice(7), shot = (args.find(a => a.startsWith('--shot=')) || '').slice(7);
(async () => {
    const h = await H.start(Number(process.env.PORT569) || 3461, 'probe569');
    try {
        const P = await h.open(h.users[who], phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, { phone, theme: 'dark', page: pages[0], pages });
        const all = new Map(), whites = new Map();
        const take = async (tag) => { const a = await H.audit(P.pg); a.fails.forEach(f => { if (!all.has(f)) all.set(f, tag); }); a.white.forEach(f => { if (!whites.has(f)) whites.set(f, tag); }); return a; };
        for (const page of pages) {
            const at = await H.navTo(P.pg, page, phone);
            let a = await take(page);
            console.log(`\n== ${page}(실제 ${at}) dark=${a.dark} 글자 ${a.texts} 최저 ${a.minR} 넘침 ${a.overflow}`);
            if (shot) { fs.mkdirSync(shot, { recursive: true }); await P.pg.screenshot({ path: path.join(shot, `probe-${page}${phone ? '-phone' : ''}.png`), fullPage: false }); }
            // 탭처럼 생긴 것을 차례로 눌러 본다(쓰기는 가로채져 있다)
            const tabs = await P.pg.evaluate(() => { const act = document.querySelector('.page.active'); if (!act) return 0; const els = Array.from(act.querySelectorAll('[class*="tab"]')).filter(e => /^(BUTTON|A|LI|DIV|SPAN)$/.test(e.tagName) && e.getClientRects().length && !e.querySelector('[class*="tab"]') && (e.onclick || e.tagName === 'BUTTON' || e.dataset.tab) && e.textContent.trim().length < 20); els.forEach((e, i) => e.setAttribute('data-probe-tab', i)); return els.length; });
            for (let i = 0; i < Math.min(tabs, 14); i++) { const ok = await P.pg.locator(`[data-probe-tab="${i}"]`).click({ timeout: 2500 }).then(() => true).catch(() => false); if (!ok) continue; await P.pg.waitForTimeout(700); const lbl = await P.pg.evaluate(i => { const e = document.querySelector(`[data-probe-tab="${i}"]`); return e ? e.textContent.trim().slice(0, 14) : ''; }, i); a = await take(page + ' › ' + lbl); if (shot) await P.pg.screenshot({ path: path.join(shot, `probe-${page}-tab${i}${phone ? '-phone' : ''}.png`), fullPage: false }); }
        }
        if (args.includes('--modals')) {
            const n = await P.pg.evaluate(() => { const ms = Array.from(document.querySelectorAll('.modal, .modal-overlay, [id$="-modal"]')).filter(m => !m.closest('#login-page')); ms.forEach((m, i) => m.setAttribute('data-probe-modal', i)); return ms.length; });
            for (let i = 0; i < n; i++) { const id = await P.pg.evaluate(i => { const m = document.querySelector(`[data-probe-modal="${i}"]`); m.dataset.pd = m.style.display; m.style.display = 'flex'; return m.id || m.className; }, i); await P.pg.waitForTimeout(150); await take('모달 ' + id); if (shot && i < 40) await P.pg.screenshot({ path: path.join(shot, `probe-modal-${i}.png`) }); await P.pg.evaluate(i => { const m = document.querySelector(`[data-probe-modal="${i}"]`); m.style.display = m.dataset.pd || 'none'; }, i); }
            console.log('모달 ' + n + '개 열어 봄');
        }
        console.log(`\n대비 미달 ${all.size}`); for (const [f, t] of all) console.log('  [' + t + '] ' + f);
        console.log(`\n흰 칸 ${whites.size}`); for (const [f, t] of whites) console.log('  [' + t + '] ' + f);
        console.log('\n화면 오류 ' + P.errors.length, P.errors.slice(0, 3).join(' | '));
    } finally { await h.stop(); }
    setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error(e); process.exit(1); });
