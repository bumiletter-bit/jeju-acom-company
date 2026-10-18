// #759 창구용 — 자사몰 실화면에서 옵션 하나를 담아 결제창(주문서) 최종 금액까지 확인(결제 직전 멈춤 · 장바구니 비움 · DB 쓰기 0)
//   흐름 = scripts/verify-428-checkout.js 한 건과 같다(폰 390 · 품목 단추(#755) → 옵션 줄 → 구매하기 → 카페24 확인 레이어 없이 장바구니 → 주문서)
//   node scripts/desk/mall-checkout.js <네이버 상품번호> "<옵션 줄에 보이는 글자 일부>" [기대 금액]
//   require('./mall-checkout').checkout(no, has, want) → { ok, layer, final, expect, on_order, row_text, row_price, errs }
const M = require('./_mall');
const V = 'mc' + Date.now();
async function checkout(no, has, want, opt) {   // opt.setup(ctx) = 시험용(응답 바꿔 끼우기 · 창구 실사용엔 안 씀)
    const { chromium } = M.NM('playwright');
    const br = await chromium.launch();
    try {
        const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', ...((opt && opt.ctx) || {}) });
        if (opt && opt.setup) await opt.setup(ctx);
        const pg = await ctx.newPage(); pg.on('dialog', d => d.accept());
        const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 90)));
        const clearBasket = async () => {
            await pg.waitForTimeout(1500);
            await pg.goto('https://akkome.com/order/basket.html?v=' + V + Math.random(), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
            await pg.waitForTimeout(2500);
            for (let k = 0; k < 4; k++) {
                const left = await pg.evaluate(() => document.querySelectorAll('.xans-order-list tbody tr, .xans-order-list .ec-base-prdInfo').length);
                if (!left) break;
                await pg.evaluate(() => { const chk = document.querySelector('input.allCheck, input[type="checkbox"]'); if (chk && !chk.checked) chk.click(); const a = [...document.querySelectorAll('a, button')].find(x => x.offsetParent && /전체삭제|선택삭제|삭제/.test((x.textContent || '').trim())); if (a) a.click(); });
                await pg.waitForTimeout(2000);
            }
        };
        await clearBasket();
        const out = { no: String(no), has };
        try {
            await pg.goto(`https://akkome.com/?v=${V}${no}#p/${no}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await pg.waitForFunction(() => document.querySelector('.pd-dim.show'), null, { timeout: 30000 });
            await pg.waitForTimeout(1500);
            await pg.locator('#pdOrder').tap(); await pg.waitForTimeout(1400);
            const row = pg.locator('.pd-dim .opt-row[data-opt-sel]', { hasText: has }).first();
            const info = await row.evaluate(el => ({ t: el.getAttribute('data-opt-text') || '', c24t: el.getAttribute('data-opt-c24t') || '', price: parseInt(el.getAttribute('data-opt-price'), 10) }));
            out.row_text = info.t; out.row_c24t = info.c24t; out.row_price = info.price;
            const ogi = await row.evaluate(el => { const g = el.closest('[data-og-grp]'); return g && g.hidden ? g.getAttribute('data-og-grp') : null; });   // #755 품목 단추 먼저
            if (ogi != null) { await pg.locator(`.pd-dim [data-og="${ogi}"]`).tap(); await pg.waitForTimeout(700); }
            await row.tap(); await pg.waitForTimeout(700);
            await pg.locator('#pdOrder').tap(); await pg.waitForTimeout(5000);
            out.layer = await pg.evaluate(() => { const l = document.querySelector('#akmOptList'); return !!(l && l.offsetParent); });   // 확인 레이어 = 카페24 글자를 못 찾음(원터치 깨짐)
            if (!out.layer) {
                await pg.waitForURL(/basket\.html/, { timeout: 30000 }).catch(() => { });
                if (!/basket/.test(pg.url())) await pg.goto('https://akkome.com/order/basket.html?v=' + V, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await pg.waitForTimeout(2500);
                await pg.evaluate(() => { const a = [...document.querySelectorAll('a, button')].find(x => x.offsetParent && /전체.?상품.?주문|전체.?주문|주문하기/.test((x.textContent || '').trim())); if (a) a.click(); });
                await pg.waitForTimeout(5000);
                if (/login/.test(pg.url())) {
                    await pg.evaluate(() => { const a = [...document.querySelectorAll('a, button, input[type=button], input[type=submit]')].find(x => x.offsetParent && /비회원.?구매/.test((x.textContent || x.value || '').trim())); if (a) a.click(); });
                    await pg.waitForTimeout(6000);
                }
                const txt = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
                const f = (txt.match(/최종 결제 금액\s*([\d,]+)원/) || [])[1];
                out.final = f ? Number(f.replace(/,/g, '')) : null;
                out.on_order = /orderform/.test(pg.url());
            }
            out.expect = want != null ? Number(want) : info.price;
            out.ok = !out.layer && !!out.on_order && out.final === out.expect;
        } catch (e) { out.ok = false; out.error = String(e.message || e).slice(0, 120); }
        await clearBasket();
        out.errs = errs;
        if (errs.length) out.ok = false;
        return out;
    } finally { await br.close(); }
}
module.exports = { checkout };
if (require.main === module) {
    const [no, has, want] = process.argv.slice(2);
    (async () => {
        if (!no || !has) throw new Error('사용: mall-checkout.js <네이버 상품번호> "<옵션 글자 일부>" [기대 금액]');
        console.log(JSON.stringify(await checkout(no, has, want != null ? want : null), null, 1));
        await M.pool.end();
    })().catch(async e => { console.log(JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 300) })); try { await M.pool.end(); } catch (_) { } process.exit(1); });
}
