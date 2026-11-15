// #1166 검증 — 메모함 발송일 기본 달력(대표 11/15 「스위치 말고 바로」) · 기기별 [직접 입력] = v5.9.812 글자 입력(그 무회귀 = v5.9.812 판 900-2b·1142-px·1148-back 을 om_cal_off 로 돌려 봄)
//   켬 = 폰(터치) OS 날짜 칸(투명 type=date · 값은 fill 로 넣음 = OS 창 흉내) · PC 직접 그린 달력([확인]) · 날짜 고르는 동안 카드 다시 그리기 보류 · 기록 판 · 켜고 끄기
//   🔴 실DB·서버(server.js)·네트워크 0 — verify-1148-back.js 의 가짜 서버·겹 기록을 떼어 씀 · 누름 = touchscreen.tap(폰) / click(PC)
//   실행: node scripts/verify-1166-cal-beta.js   (PORT1166 로 포트 · 기본 3462)
'use strict';
const path = require('path'), fs = require('fs');
let code = fs.readFileSync(path.join(__dirname, 'verify-1148-back.js'), 'utf8').split('\r\n').join('\n');
code = code.slice(0, code.indexOf('\n(async () => {')).replace("'use strict';", '');
const H = new Function('require', '__dirname', code + '\nreturn { S, serve, until, PXL, mut, ACT, ok, get pass() { return pass; }, get failN() { return failN; } };')(require, __dirname);
const { S, serve, until, PXL, mut, ACT, ok } = H;
const { chromium } = require('playwright');
const PXK = '010-3292-0535', RECV = '0502-1234-5678', dg = s => String(s || '').replace(/\D/g, '');
const kIso = n => new Date(Date.now() + 9 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const mdw = d => { const t = new Date(d + 'T00:00:00Z'); return (t.getUTCMonth() + 1) + '/' + t.getUTCDate() + '(' + '일월화수목금토'[t.getUTCDay()] + ')'; };
const D1 = kIso(2), HOL = kIso(4), PAST = kIso(-2);

(async () => {
    const PORT = Number(process.env.PORT1166 || 3462);
    const srv = await serve(PORT), base = `http://127.0.0.1:${PORT}/`;
    const browser = await chromium.launch(); const pe = [];
    const reset = () => {
        Object.assign(S, { px: true, px2: false, px3: false, pxHide: false, pxOrig: false, deleted: new Set(), puts: [], pairs: [], services: [], saves: [], mut, listDelay: 0, badges: {} });
        const o = (no, qty, opt, as) => ({ as: as || 'buyer', plat: '네이버', buyer_name: '강명희', recv_name: '이하정', recv_initial: '이', addr: '충남 천안시', option: opt, qty, order_no: no, pno: no, paid_at: '2026-11-14 11:35', buyer_phone: '010-5738-4123' });
        S.lookup = { [dg(PXL)]: [o('2026111400000011', 3, '타이벡감귤 5kg')], [dg(RECV)]: [o('2026111400000021', 1, '타이벡감귤 5kg', 'recv')], [dg(PXK)]: [o('2026111446930531', 4, '고당도 타이벡감귤 / 상품 및 과수: 선물용 - 3kg(로얄과 2S~M)'), o('2026111446930532', 8, '고당도 타이벡감귤 / 상품 및 과수: 가정용 - 5kg(로얄과 2S~M)')] };
    };
    async function newPage(w, h, touch, opt) {
        opt = opt || {};
        const cx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 }); await cx.addInitScript(ACT);
        await cx.route('**/api/agent-office/shipping-holidays', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [{ id: 1, holiday_date: HOL, reason: '시험 휴무', no_ship: true, no_arrive: false }] }) }));
        const p = await cx.newPage(); p.on('pageerror', e => pe.push(w + 'x' + h + ' ' + String(e)));
        await p.addInitScript(() => { window.__toasts = []; const t = () => { const o = window.showToast; window.showToast = function (m) { window.__toasts.push(String(m)); if (o) try { o.apply(this, arguments); } catch (e) { } }; }; document.addEventListener('DOMContentLoaded', t); });
        await p.goto(base + 'away'); await p.goto(base + '?v=new');
        if (opt.fo) await p.evaluate(() => { __foListen(); __foOpen(); });
        await p.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await p.waitForSelector('#om-list .om-ml'); await p.waitForTimeout(700);
        return { cx, p };
    }
    const press = async (p, sel, touch) => { const l = p.locator(sel).first(); await l.scrollIntoViewIfNeeded().catch(() => { }); if (!touch) return l.click(); const b = await l.boundingBox(); if (!b) throw new Error('누를 곳 없음 ' + sel); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
    const OPEN = {
        '줄카드(현금표)': async (p, t) => { if (await p.locator('#om-prev-open').isVisible()) { await press(p, '#om-prev-open', t); await p.waitForTimeout(600); } await press(p, '#om-ctw .om-ct-open', t); await p.waitForSelector('#om-card:not([hidden]) #om-f-0-date'); await p.waitForTimeout(500); return { k: 'fd', sel: '#om-f-0-date' }; },
        '#938 주문별': async (p, t) => { S.preview = { ok: true, rows: [{ kind: 'line', key: PXK, note: '입력o삭제x', plat: '네이버', line: ['', PXK, '입력o삭제x', '네이버'].join('\t'), sure: true, check_why: [] }] }; await p.evaluate(x => window.AkmOrderMemo.fromText(x), PXK + ' 입력o삭제x 네이버'); await p.waitForSelector('#om-card:not([hidden]) #om-ord-0 .om-ordl', { timeout: 10000 }); await p.waitForTimeout(500); return { k: 'ord', sel: `#om-ord-0 input[data-${t ? 'omnat' : 'omcal'}="ord"][data-o="2026111446930532"]` }; },
        '#1027 고객정보수정(0502 받는 분)': async (p, t) => { await press(p, '.om-tag[data-tag="cedit"]', t); await p.waitForSelector('#om-tp-tel'); await press(p, '#om-tp-tel', t); if (t) await p.setViewportSize({ width: p.viewportSize().width, height: 430 }); await p.keyboard.type(dg(RECV), { delay: 15 }); await press(p, '#om-tp-go', t); if (t) await p.setViewportSize({ width: p.viewportSize().width, height: 854 }); await p.waitForSelector('#om-card:not([hidden]) [data-cact="cefix"]', { timeout: 10000 }); await press(p, '#om-card [data-cact="cefix"]', t); await p.waitForSelector(`#om-card input[data-${t ? 'omnat' : 'omcal'}="ce"]`); await p.waitForTimeout(150); return { k: 'ce', sel: `#om-card input[data-${t ? 'omnat' : 'omcal'}="ce"]` }; },
    };
    const shown = (p, sel) => p.evaluate(s => { const i = document.querySelector(s); if (!i) return null; const w = i.closest('.om-sdw'); return { v: i.value, show: w ? w.querySelector('.om-sdv').value : i.value, x: w ? !w.querySelector('.om-sdx').hidden : null }; }, sel);
    const logTxt = p => p.evaluate(async () => { const b = document.querySelector('#om-calb [data-calb="log"]'); if (!b) return ''; b.click(); await new Promise(r => setTimeout(r, 50)); const t = (document.querySelector('#om-callog pre') || {}).textContent || ''; const x = document.querySelector('#om-callog [data-cl="x"]'); if (x) x.click(); return t; });
    // ── 폰 = OS 날짜 칸 ──
    async function phoneCase(w, h, key, opt) {
        opt = opt || {}; reset(); const { cx, p } = await newPage(w, h, true, opt); const tag = `폰 ${w}x${h}${opt.fo ? ' 최종발주 위' : ''}${opt.viaUrl ? ' (?omcal=1)' : ''} · ${key}`;
        try {
            const { k, sel } = await OPEN[key](p, true);
            const m0 = await p.evaluate(s => { const i = document.querySelector(s); window.__nat = i; return { type: i && i.type, min: i && i.min, chip: ((document.querySelector('#om-card .om-calb-card [data-calb="off"]') || {}).textContent || '') === '직접 입력', sdv: !!(i && i.closest('.om-sdw') && i.closest('.om-sdw').querySelector('.om-sdv')) }; }, sel);
            ok(m0.type === 'date' && m0.min === kIso(0) && m0.chip && m0.sdv, tag + ' 칸 = 투명 type=date(min 오늘) + 보이는 칸 · 카드 머리 [직접 입력]', m0);
            await press(p, sel, true);   // 손가락이 OS 날짜 창을 엶(창은 흉내 못 함 = 초점까지)
            for (const ms of [300, 1000, 2000]) { await p.waitForTimeout(ms === 300 ? 300 : ms === 1000 ? 700 : 1000); }
            const same = await p.evaluate(s => ({ same: window.__nat === document.querySelector(s) && window.__nat.isConnected, focus: document.activeElement === window.__nat }), sel);
            if (k === 'fd' && !opt.fo) {   /* OS 창이 2초 안에 값 없이 닫힘 2번 = 안내 한 줄(자동 전환 X) */
                const n0 = await p.evaluate(() => window.__toasts.length); await press(p, '#om-card-t', true); await p.waitForTimeout(100);
                for (let t = 0; t < 2; t++) { await press(p, sel, true); await p.waitForTimeout(250); await press(p, '#om-card-t', true); await p.waitForTimeout(150); }   /* 칸 누름(OS 창 열림) → 값 없이 바로 떠남 × 2 */
                const q = await p.evaluate(([s, n]) => ({ ts: window.__toasts.slice(n), type: document.querySelector(s).type }), [sel, n0]);
                ok(q.ts.some(t => /달력이 잘 안 열리면 위 \[직접 입력\]을 눌러 주세요/.test(t)) && q.type === 'date', tag + ' OS 날짜 창이 2초 안에 값 없이 닫힘 연달아 = 「달력이 잘 안 열리면 [직접 입력]」 안내 · 자동 전환 없음', q);
            }
            ok(same.same, tag + ' OS 날짜 창이 떠 있는 2초 동안 칸 노드 그대로(다시 그리기 보류)', same);
            await p.locator(sel).first().fill(HOL); await p.waitForTimeout(150);
            const h1 = await shown(p, sel), t1 = await p.evaluate(() => window.__toasts.slice(-1)[0] || '');
            await p.locator(sel).first().fill(PAST).catch(() => { }); await p.waitForTimeout(150);
            const h2 = await shown(p, sel);
            await p.locator(sel).first().fill(D1); await p.waitForTimeout(250);
            const s1 = await shown(p, sel);
            ok(h1.show === '' && /발송 휴무일이에요/.test(t1) && h2.show === '' && s1.show === mdw(D1) && (k === 'ord' || s1.x === true), tag + ' 휴무일 = 안 바뀜 + 「발송 휴무일이에요」 · 지난 날 = 안 바뀜 · ' + mdw(D1) + ' = 칸 「' + mdw(D1) + '」' + (k === 'ord' ? '' : ' + [×]'), { h1, t1, h2, s1 });
            const fit = await p.evaluate(s => { const i = document.querySelector(s), w = i.closest('.om-sdw'), v = w.querySelector('.om-sdv'), f = i.closest('.om-f'), hd = document.querySelector('#om-card .om-card-h'); return { fit: v.scrollWidth <= v.clientWidth, red: !!(f && f.classList.contains('blank')), hdOver: hd ? [...hd.querySelectorAll('button, h3')].filter(e => e.getBoundingClientRect().height > 48).length : 0, sw: document.documentElement.scrollWidth, iw: innerWidth }; }, sel);
            ok(fit.fit && !fit.red && !fit.hdOver && fit.sw <= fit.iw, tag + ' 고른 칸 「' + mdw(D1) + '」 안 잘림 · 빨간 칸 아님 · 카드 머리 줄 안 꺾임 · 가로 넘침 0', fit);
            const SH = process.env.SHOT1166 && !opt.fo && !opt.viaUrl ? path.join(process.env.SHOT1166, `phone-${w}x${h}-${k}`) : '';
            if (SH) await p.screenshot({ path: SH + '.png' }).catch(() => { });
            if (w <= 480) await p.evaluate(async () => { const b = document.querySelector('#om-card .om-calb-card [data-calb="off"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); await new Promise(r => setTimeout(r, 800)); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })); });   /* 좁은 폰 = [직접 입력] 길게 누름 */
            else await press(p, '#om-card .om-calb-card [data-calb="log"]', true);
            await p.waitForSelector('#om-callog pre'); if (SH) await p.screenshot({ path: SH + '-log.png' }).catch(() => { }); const lg = await p.textContent('#om-callog pre'); await press(p, '#om-callog [data-cl="x"]', true);   /* 카드 머리 [기록] 실제 tap */
            ok(/OS 날짜 칸 누름/.test(lg) && /OS 날짜 고름/.test(lg) && !/날짜 고르는 중!/.test(lg) && !/01[016-9]-?\d{3,4}-?\d{4}|0502/.test(lg), tag + ' 기록(좁은 폰 = [직접 입력] 길게 · 넓으면 「기록」 tap) = OS 날짜 칸 누름·고름 기록 · 고르는 중 다시 그리기 0 · 번호 0', lg.split('\n').slice(-6));
            if (k === 'fd') {
                await press(p, '#om-f-0-date + .om-sdx', true); await p.waitForTimeout(120); const c1 = await shown(p, sel);
                await p.locator(sel).fill(D1); await p.waitForTimeout(150);
                S.puts = []; await until(() => p.evaluate(() => !/확인 중/.test(document.getElementById('om-card-save').textContent))); await press(p, '#om-card-save', true); await until(() => S.puts.length, 8000);
                const r = S.puts[S.puts.length - 1] || {};
                ok(c1.show === '' && c1.x === false && r.ship_date === D1, tag + ' [×] = 칸 비움(다음 발주) · 다시 ' + mdw(D1) + ' 저장 = PUT ship_date ' + D1, { c1, sd: r.ship_date });
            }
            if (k === 'ord') { const r0 = await shown(p, sel); S.saves = []; await press(p, '#om-card-save', true); await until(() => S.saves.length, 8000); const rows = (S.saves[0] && S.saves[0].rows) || []; ok(r0 && r0.show === mdw(D1) && rows.length === 2 && rows.some(x => x.key === '2026111446930532' && x.ship_date === D1), tag + ' 저장 = 주문번호 줄 2(B ' + D1 + ' · #938 꼴)', rows.map(x => [x.key, x.ship_date])); }
            if (k === 'ce') {
                const ceSel = '#om-card input[data-omnat="ce"]'; const cv = await shown(p, ceSel);
                S.saves = []; await press(p, '#om-card-save', true); await until(() => S.saves.length, 8000); const rows = (S.saves[0] && S.saves[0].rows) || [];
                ok(rows.some(x => x.ship_date === D1 && x.note === mdw(D1).replace(/\(.\)$/, '') + ' 발송'), tag + ' 저장 = 날짜 줄(ship_date ' + D1 + ' · 「M/D 발송」)', { cv, rows: rows.map(x => [x.key, x.ship_date, x.note]) });
            }
        } catch (e) { ok(false, tag + ' 실행 오류 ' + (e && e.message || e)); }
        finally { await cx.close(); }
    }
    // ── PC = 직접 그린 달력([확인]) ──
    async function pcCase(key) {
        reset(); const { cx, p } = await newPage(1280, 900, false); const tag = 'PC 1280 · ' + key;
        try {
            const { k, sel } = await OPEN[key](p, false);
            await p.evaluate(s => { window.__inp = document.querySelector(s); }, sel);
            await p.click(sel); await p.waitForSelector('#om-cal:not([hidden])'); await p.waitForTimeout(1200);
            const same = await p.evaluate(s => ({ open: !document.getElementById('om-cal').hidden, same: window.__inp === document.querySelector(s) && window.__inp.isConnected }), sel);
            ok(same.open && same.same, tag + ' 달력 뜬 1.2초 동안 칸 그대로(다시 그리기 보류) · 달력 열림', same);
            for (let i = 0; i < 3 && !(await p.locator(`#om-cal .akm-cal-day[data-d="${D1}"]:not(.out)`).count()); i++) await p.click('#om-cal [data-nav="1"]');
            await p.click(`#om-cal .akm-cal-day[data-d="${D1}"]:not(.out)`); const mid = await p.evaluate(s => ({ on: !document.getElementById('om-cal').hidden, v: document.querySelector(s).value }), sel);
            await p.click('#om-cal [data-cal="ok"]'); await p.waitForTimeout(150); const v = await p.evaluate(s => document.querySelector(s).value, sel);
            ok(mid.on && mid.v !== mdw(D1) && v === mdw(D1), tag + ' 날 = 고른 날만 · [확인] = 칸 「' + mdw(D1) + '」', { mid, v });
        } catch (e) { ok(false, tag + ' 실행 오류 ' + (e && e.message || e)); }
        finally { await cx.close(); }
    }
    try {
        for (const [w, h] of [[384, 854], [384, 430], [720, 900]]) for (const key of Object.keys(OPEN)) await phoneCase(w, h, key);
        await phoneCase(384, 854, '줄카드(현금표)', { fo: true });
        for (const key of Object.keys(OPEN)) await pcCase(key);
        // [직접 입력] = 이 기기 글자 칸(v5.9.812 꼴 · 기억) · [달력으로] = 되돌림
        { reset(); const { cx, p } = await newPage(384, 854, true); await OPEN['줄카드(현금표)'](p, true);
          await press(p, '#om-card .om-calb-card [data-calb="off"]', true); await p.waitForTimeout(200);
          const st = await p.evaluate(() => { const i = document.getElementById('om-f-0-date'); return { type: i.type, ro: i.readOnly, ls: localStorage.getItem('om_cal_off'), btn: (document.querySelector('#om-card .om-calb-card [data-calb]') || {}).textContent || '', ph: i.placeholder }; });
          await p.locator('#om-f-0-date').fill('11/30'); await p.waitForTimeout(80); const tv = await p.evaluate(() => document.getElementById('om-f-0-date').value);
          await press(p, '#om-card .om-calb-card [data-calb="on"]', true); await p.waitForTimeout(200);
          const st2 = await p.evaluate(() => { const i = document.getElementById('om-f-0-date'); return { type: i.type, ls: localStorage.getItem('om_cal_off'), v: i.value, show: i.closest('.om-sdw') ? i.closest('.om-sdw').querySelector('.om-sdv').value : null }; });
          ok(st.type === 'text' && !st.ro && st.ls === '1' && st.btn === '달력으로' && /예\) 10\/30/.test(st.ph) && tv === '11/30' && st2.type === 'date' && st2.ls === null && /^11\/30\(.\)$/.test(st2.show || ''), '[직접 입력] = 글자 칸(「예) 10/30」 · 11/30 침 · 이 기기 기억 om_cal_off) · [달력으로] = OS 날짜 칸(친 값 「11/30(요일)」 그대로)', { st, tv, st2 }); await cx.close(); }
        { reset(); const { cx, p } = await newPage(384, 854, true); await p.goto(base + '?v=new&omcal=0'); await p.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await p.waitForSelector('#om-list .om-ml'); await OPEN['줄카드(현금표)'](p, true);
          const st = await p.evaluate(() => ({ type: document.getElementById('om-f-0-date').type, ls: localStorage.getItem('om_cal_off') })); await p.evaluate(() => localStorage.removeItem('om_cal_off'));
          ok(st.type === 'text' && st.ls === '1', '주소 ?omcal=0 = 이 기기 직접 입력(안내용 · ?omcal=1 = 달력)', st); await cx.close(); }
        ok(pe.length === 0, '스크립트 오류 0', pe.slice(0, 5));
    } catch (e) { ok(false, '실행 오류 ' + (e && e.stack || e)); }
    finally { await browser.close(); srv.close(); }
    console.log(`\n결과 ${H.pass}/${H.pass + H.failN}`); process.exit(H.failN ? 1 : 0);
})();
