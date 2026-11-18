// #1191 검증 — 메모함 목록 입력삭제 줄의 눌리는 매칭 배지(「네이버 3/3 매칭완료」) = 보이는 높이는 옆 알약과 같게 · 누르는 곳은 44(투명 덧판)
//   🔴 실DB·서버·네트워크 0 — verify-900-2b.js 의 가짜 서버·자료(#1132 캡처용 줄 한 벌 · S.shot1132) · #1186 직전 커밋 b754433(?v=old · BASE1191) 과 지금(?v=new) 대조
//   실행: node scripts/verify-1191-badge.js   (PORT1191 로 포트 · 기본 3462)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright');
const XLSX = require('xlsx-js-style');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ''); } };
let B = fs.readFileSync(path.join(__dirname, 'verify-900-2b.js'), 'utf8').split('\r\n').join('\n');
B = B.slice(B.indexOf('const SRC = {'), B.indexOf('(async () => {'));
const BASE = process.env.BASE1191 || 'b754433';   // 견줄 기준 = #1186(c1d49bb · 배지가 44 로 커진 판) 직전 커밋 = 대표 눈에 익은 종전 모양
if (B.split('git show HEAD:').length !== 3) throw new Error('기준 커밋 자리 못 찾음');
B = B.split('git show HEAD:').join('git show ' + BASE + ':');
const M = new Function('require', 'ROOT', 'path', 'fs', 'http', 'execSync', 'chromium', 'XLSX', 'ok', B + '\nreturn { S, serve };')(require, ROOT, path, fs, http, execSync, chromium, XLSX, ok);
const { S, serve } = M;

(async () => {
    const PORT = Number(process.env.PORT1191 || 3462);
    const srv = await serve(PORT), base = `http://127.0.0.1:${PORT}/`;
    const browser = await chromium.launch(); const pe = [];
    const open = async (v, vp) => { Object.assign(S, { px: true, shot1132: true, deleted: new Set(), puts: [], pairs: [], saves: [], badges: {}, lookup: {} });
        const cx = await browser.newContext(vp); const p = await cx.newPage(); p.on('pageerror', e => pe.push(String(e)));
        await p.goto(base + '?v=' + v); await p.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await p.waitForSelector('#om-list .om-ml[data-id="401"]'); await p.waitForTimeout(700); return { cx, p }; };
    // 401 = 입력삭제 줄(눌리는 배지 button.om-badge) · 406 = 사이즈 줄(「네이버 매칭완료」 알약 span.om-lbadge)
    const measure = p => p.evaluate(() => { const li = document.querySelector('#om-list .om-ml[data-id="401"]'); li.scrollIntoView({ block: 'center' });
        const b = li.querySelector('button.om-badge'), t = li.querySelector('.om-ml-t'), ck = li.querySelector('.om-ck'), pl = document.querySelector('#om-list .om-ml[data-id="406"] .om-lbadge');
        const R = e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom, r: r.right }; }, rb = R(b), cx = rb.x + rb.w / 2, cy = rb.y + rb.h / 2;
        const at = (x, y) => { const e = document.elementFromPoint(x, y); return !e ? 'none' : e.closest('button.om-badge') ? 'badge' : e.closest('.om-ml-t') ? 'text' : e.closest('.om-ck') ? 'check' : e.closest('.om-x') ? 'del' : (e.closest('.om-ml') || {}).dataset ? 'row:' + e.closest('.om-ml').dataset.id : e.className; };
        const rt = R(t), rl = R(li);
        return { badgeH: Math.round(rb.h * 10) / 10, pillH: Math.round(R(pl).h * 10) / 10, rowH: Math.round(rl.h), headH: Math.round(R(li.querySelector('.om-ml-h')).h), textH: Math.round(rt.h), cx, cy, liTop: rl.y, textTop: rt.y,
            up: at(cx, cy - 21), dn: at(cx, cy + 21), mid: at(cx, cy), text: at(rt.x + rt.w / 2, rt.y + rt.h / 2), textTopEdge: at(rt.x + 30, rt.y + 2), check: at(R(ck).x + R(ck).w / 2, R(ck).y + R(ck).h / 2),
            hitIn: cy - 22 >= rl.y - 0.5 && cy + 22 <= rt.y + 0.5, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor, text401: b.textContent.trim(), text406: pl.textContent.trim() }; });
    try {
        for (const [w, h] of [[390, 844], [884, 1000]]) {
            const vp = { viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 };
            const O = await open('old', vp), N = await open('new', vp);
            const o = await measure(O.p), n = await measure(N.p);
            console.log(`폭 ${w} — #1186 직전: 배지 ${o.badgeH} · 알약 ${o.pillH} · 줄 ${o.rowH} / 지금: 배지 ${n.badgeH} · 알약 ${n.pillH} · 줄 ${n.rowH} · 글 「${n.text401}」 vs 「${n.text406}」`);
            ok(o.badgeH === 28, `폭 ${w} (기준) #1186 직전(b754433) 배지 보이는 높이 = 28`, o.badgeH);
            ok(n.badgeH === 28 && n.badgeH === o.badgeH, `폭 ${w} ① 배지 보이는 높이 = 28 = #1186 직전 값과 같음(44 아님)`, { badge: n.badgeH, base: o.badgeH });
            ok(n.up === 'badge' && n.dn === 'badge' && n.mid === 'badge', `폭 ${w} ② 배지 위아래 21px(누르는 곳 44) = 배지가 잡힘`, { up: n.up, mid: n.mid, dn: n.dn });
            ok(n.text === 'text' && n.textTopEdge === 'text' && n.check === 'check', `폭 ${w} ② 줄 글(가운데·맨 위 2px) = 줄 글 · 체크 칸 = 체크 칸(엉뚱한 것 안 잡힘)`, { text: n.text, edge: n.textTopEdge, check: n.check });
            ok(n.hitIn, `폭 ${w} ② 누르는 곳 44 가 그 줄 머리 여백 안(윗줄·줄 글과 겹침 0)`, { cy: n.cy, liTop: n.liTop, textTop: n.textTop });
            ok(n.headH === o.headH && n.rowH - o.rowH === n.textH - o.textH, `폭 ${w} 배지가 든 머리 줄 높이 = #1186 직전과 같음(${o.headH} = ${n.headH}) · 줄 전체 차이 ${n.rowH - o.rowH}px 는 줄 글 단추 높이 차이(${o.textH} → ${n.textH} · #1186 의 줄 글 44 규칙 · 이번에 안 건드림)뿐`, { o: [o.rowH, o.headH, o.textH], n: [n.rowH, n.headH, n.textH] });
            await N.p.touchscreen.tap(n.cx, n.cy + 19); await N.p.waitForSelector('#om-card:not([hidden]) .om-pxs-sum', { timeout: 5000 }).catch(() => null);
            ok(await N.p.evaluate(() => { const c = document.getElementById('om-card'); return !!(c && !c.hidden && c.querySelector('.om-pxs-sum')); }), `폭 ${w} ③ 배지 아래쪽 여백(가운데 +19px)을 tap = 매칭 판 열림`);
            await N.p.click('#om-card .om-back[data-cact="cancel"]'); await N.p.waitForTimeout(600);
            { const L6 = N.p.locator('#om-list .om-ml[data-id="406"] .om-ml-t'); await L6.scrollIntoViewIfNeeded(); await N.p.waitForTimeout(200); const b6 = await L6.boundingBox(); await N.p.touchscreen.tap(b6.x + b6.width / 2, b6.y + b6.height / 2); } await N.p.waitForSelector('#om-card:not([hidden]) .om-rowcard', { timeout: 5000 }).catch(() => null);
            ok(await N.p.evaluate(() => { const c = document.getElementById('om-card'); return !!(c && !c.hidden && c.querySelector('.om-rowcard') && !c.querySelector('.om-pxs-sum')); }), `폭 ${w} ③ 옆 줄(사이즈 줄 406) 글을 tap = 줄 카드(매칭 판 아님 · 입력삭제 줄 글은 #1124 부터 매칭 판이 맞음)`);
            await N.p.click('#om-card .om-back[data-cact="cancel"]'); await N.p.waitForTimeout(400);
            await N.p.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark')); const d = await measure(N.p);
            ok(d.badgeH === 28 && d.up === 'badge' && d.dn === 'badge', `폭 ${w} 야간 = 같은 높이(28)·같은 누름 자리`, { badge: d.badgeH });
            await O.cx.close(); await N.cx.close();
        }
        // PC(마우스 · 폭 1280) = 그 미디어 줄 밖 → HEAD 와 같음
        { const vp = { viewport: { width: 1280, height: 900 } }; const O = await open('old', vp), N = await open('new', vp); const o = await measure(O.p), n = await measure(N.p);
          ok(o.badgeH === n.badgeH && o.rowH === n.rowH, `PC 1280(마우스) = 배지·줄 높이 #1186 직전과 같음(${n.badgeH} · ${n.rowH})`, { o: [o.badgeH, o.rowH], n: [n.badgeH, n.rowH] }); await O.cx.close(); await N.cx.close(); }
        ok(pe.length === 0, '화면 오류 0', pe.slice(0, 3));
    } catch (e) { failN++; console.log('  ❌ 실행 오류', e && e.stack || e); }
    await browser.close(); await new Promise(r => srv.close(r));
    console.log(`\n#1191 검증: ${pass}/${pass + failN} 통과` + (failN ? ` · 실패 ${failN}` : ''));
    process.exit(failN ? 1 : 0);
})();
