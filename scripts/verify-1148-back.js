// #1148 검증 — 발주 메모함 폰 뒤로가기 = 한 번에 맨 위 한 겹만(확인 창 → 줄 카드 → 매칭 판 → 목록 → 메모함)
//   🔴 실DB·서버(server.js)·네트워크 0 — verify-900-2b.js 의 가짜 서버·자료(verify-1142-px.js 와 같은 덧댐) + ao-desk.js 의 실제 겹 기록 구간(HB · hbPush/hbDrop/hbPop)을 그대로 떼어 실음
//   두 길: A = 에이전트 오피스에서 연 메모함(AkmAoDesk 기록) · B = 최종발주 창 위에서 연 메모함(foPanel · 이 파일 OWN 기록 · 최종발주 창은 popstate 한 번에 닫히는 흉내)
//   실행: node scripts/verify-1148-back.js   (PORT1148 로 포트 · 기본 3462 · OLD1148=1 = 고치기 전 HEAD 로 같은 순서를 돌려 「지금 동작」 표만 봄)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright');
const XLSX = require('xlsx-js-style');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ''); } };

let B = fs.readFileSync(path.join(__dirname, 'verify-900-2b.js'), 'utf8').split('\r\n').join('\n');
B = B.slice(B.indexOf('const SRC = {'), B.indexOf('(async () => {'));
const patch = (a, b) => { if (B.split(a).length !== 2) throw new Error('덧댐 자리 못 찾음: ' + a.slice(0, 60)); B = B.replace(a, () => b); };
patch('function pxList() {', 'function pxList() { const L = pxList0(); return S.mut ? S.mut(L) : L; }\nfunction pxList0() {');
patch('try { S.puts.push(JSON.parse(b)); } catch (e) { }', 'try { const j = JSON.parse(b); j._id = Number(u.pathname.split(\'/\').pop()); S.puts.push(j); } catch (e) { }');
// 겹 기록(ao-desk.js 실코드) 싣기 + 첫 칸 앞에 다른 쪽(/away) 한 칸 = 뒤로가기가 새면 그 쪽으로 나감
patch('<script src="/xlsx.js"></script>', '<script src="/hb.js"></script><script src="/xlsx.js"></script>');
patch("if (u.pathname === '/xlsx.js')", "if (u.pathname === '/hb.js') return send(200, HBJS, 'text/javascript; charset=utf-8');\n        if (u.pathname === '/away') return send(200, '<!doctype html><title>away</title>떠남', 'text/html; charset=utf-8');\n        if (u.pathname === '/xlsx.js')");
const DESK = fs.readFileSync(path.join(ROOT, 'public', 'ao-desk.js'), 'utf8').split('\r\n').join('\n');
const h0 = DESK.indexOf('    const HB = { stack: []'), h1 = DESK.indexOf('    const TOOLS = [', h0);
if (h0 < 0 || h1 < 0) throw new Error('ao-desk.js 겹 기록 구간 못 찾음');
const HBJS = `(function(){\n${DESK.slice(h0, h1)}\nwindow.addEventListener('popstate', hbPop);\nwindow.AkmAoDesk = { hbPush, hbDrop, _hb: HB };\n` +
    // 최종발주 창 흉내(final-order.js 176·490·503 꼴): 열면 foPanel 칸 · popstate 오면 닫힘 — 이 듣개는 메모함(om.js)보다 뒤에 붙는다(실제 순서와 같음)
    `window.__fo = { open: false, closes: 0 }; window.__foOpen = () => { history.pushState({ foPanel: 1 }, ''); __fo.open = true; };\n` +
    `window.__foListen = () => window.addEventListener('popstate', () => { if (__fo.open) { __fo.open = false; __fo.closes++; } });\n})();`;
const M = new Function('require', 'ROOT', 'path', 'fs', 'http', 'execSync', 'chromium', 'XLSX', 'ok', 'HBJS', B + '\nreturn { S, serve, until, PXL, CAT };')(require, ROOT, path, fs, http, execSync, chromium, XLSX, ok, HBJS);
const { S, serve, until, PXL, CAT } = M;
const dg = s => String(s || '').replace(/\D/g, '');
// #1157 크롬 「기록 조작 막이」 흉내 — 사람 손(누름·키)이 없이 쌓은 기록 칸(pushState)이 있으면, 그 앞 칸은 폰 뒤로가기 단추가 건너뜀(손 한 번 = 칸 하나 · 쌓으면 손 소모)
//   → 뒤로가기 처리(popstate) 안에서 칸을 다시 쌓으면 다음 뒤로가기가 목록 칸을 건너뛰어 메모함·앱까지 빠짐(설치형 앱 = 바닥에서 앱 꺼짐). page.goBack 은 건너뛰기를 안 해 이 셈으로 잡는다
const ACT = `(() => { let act = false; window.__noAct = [];
  ['pointerdown', 'keydown', 'click', 'touchend'].forEach(t => window.addEventListener(t, e => { if (e.isTrusted) act = true; }, true));
  const P = history.pushState.bind(history);
  history.pushState = function (st) { if (!act) window.__noAct.push(JSON.stringify(st && (st.k || st.omOwn || st.foPanel) || '?')); act = false; return P.apply(null, arguments); };
})();`;
function mut(L) {
    const extra = (id, nm, qty, more) => Object.assign({ id, kind: 'cash', state: 'open', sure: true, check_why: [], addr_ok: null, indiv: true, service: false, cells: ['홍길동 드림', PXL, '제주시 연삼로 1066-31', nm, CAT[0], String(qty), '010-3300-0' + id, '', '경기 성남시 분당구 판교역로 ' + id, '', PXL, '', ''] }, more || {});
    const e140 = L.entries.find(e => e.id === 140); if (e140) e140.rows.push(extra(204, '둘째주소손님', 2));
    return L;
}

(async () => {
    const PORT = Number(process.env.PORT1148 || 3462);
    const srv = await serve(PORT), base = `http://127.0.0.1:${PORT}/`;
    const browser = await chromium.launch();
    const reset = () => { Object.assign(S, { px: true, px2: false, px3: false, pxHide: false, pxOrig: false, deleted: new Set(), puts: [], pairs: [], services: [], saves: [], mut, listDelay: 0, badges: {} }); S.lookup = { [dg(PXL)]: [{ as: 'buyer', plat: '네이버', pno: '2026111400000011', order_no: '2026111400000001', option: '타이벡감귤 5kg', qty: 3, recv_name: '구매자손님', addr: '서울 송파구 올림픽로 1' }] }; };
    const pe = [];
    // 지금 열린 겹 = 메모함 · 카드(판 | 줄 카드 | 기타) · 확인 창 · 품목 고르기 · 저장 묻기 · 최종발주 · 떠났나
    const layers = p => p.evaluate(() => {
        if (location.pathname === '/away') return { away: true, s: '떠남' }; if (!window.AkmAoDesk) return { away: true, s: '떠남(더 앞)' };
        const q = id => document.getElementById(id), vis = id => !!(q(id) && !q(id).hidden), C = q('om-card');
        const om = vis('desk-om'), card = !!(C && !C.hidden), kind = !card ? '' : C.querySelector('.om-pxs-sum') ? '판' : '줄카드', ask = vis('om-ask'), opt = vis('om-optpop'), conf = !!(C && C.querySelector('.om-confirm'));
        const prev = !!(q('desk-om') && q('desk-om').classList.contains('prev-open'));
        const cal = vis('om-cal');   /* #1161 발송일 달력 */
        const s = [om ? '메모함' : '', prev ? '현금표' : '', card ? kind : '', opt ? '품목' : '', cal ? '달력' : '', ask ? '확인창' : '', conf ? '묻기' : ''].filter(Boolean).join('>') || '없음';
        return { na: (window.__noAct || []).slice(), away: false, om, card, kind, ask, opt, conf, s, fo: !!(window.__fo && window.__fo.open), hb: (window.AkmAoDesk._hb.stack || []).map(e => e.k).join(','), pend: C ? C.querySelectorAll('.om-pxrow-pend, .om-pend-t').length : 0, chk: C ? [...C.querySelectorAll('.om-pairx-b input[data-cact="pxchk"]:checked')].map(i => i.dataset.v).join() : '', qv: (C && C.querySelector('[id^="om-px-q-"]') || {}).value || '' };
    });
    const back = async p => { await p.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => null); await p.waitForTimeout(900); return layers(p); };
    const settle = p => p.waitForTimeout(900);   // ao-desk hbSync 의 되돌리기(최대 700ms)가 끝나게
    async function newPage(fo) {
        const cx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }); const p = await cx.newPage(); p.on('pageerror', e => pe.push(String(e)));
        await cx.addInitScript(ACT);
        await p.goto(base + 'away'); await p.goto(base + (process.env.OLD1148 ? '?v=old' : '?v=new'));   // OLD1148=1 = 고치기 전(HEAD) 동작 표
        if (fo) await p.evaluate(() => { __foListen(); __foOpen(); });
        await p.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await p.waitForSelector('#om-list .om-ml'); await settle(p);
        await p.evaluate(() => { window.__noAct = []; });   /* 여기까지 = 시험 틀이 연 것(사람 손 아님) — 셈에서 뺌 */
        return { cx, p };
    }
    const openPanel = async p => { await p.locator('#om-list .om-ml', { hasText: PXL }).locator('.om-ml-px, .om-badge').first().click(); await p.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await settle(p); };
    const openRow = async p => { const po = p.locator('#om-prev-open'); if (await po.isVisible()) { await po.click(); await settle(p); } await p.locator('#om-ctw .om-ct-open').first().click(); await p.waitForSelector('#om-card:not([hidden])'); await settle(p); };
    const openRowFromPanel = async p => { await p.click('#om-card .om-px-paired [data-cact="pxrowopen"][data-v="204"]'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await settle(p); };
    const T = {}, NA = {};
    const seq = async (name, fo, setup, n) => {
        reset(); const { cx, p } = await newPage(fo); const st0 = await setup(p); const a = [st0 || await layers(p)];
        for (let i = 0; i < (n || 3); i++) a.push(await back(p));
        T[name + (fo ? ' [최종발주 위]' : '')] = a.map(x => x.s + (x.fo ? '+최종발주' : '')).join(' → ');
        a.noAct = a.reduce((m, x) => (x.na && x.na.length > m.length ? x.na : m), []); NA[name + (fo ? ' [최종발주 위]' : '')] = a.noAct.join(',');
        await cx.close(); return a;
    };
    try {
        for (const fo of [false, true]) {
            const tag = fo ? ' [최종발주 위]' : '';
            console.log(fo ? 'B 최종발주 창 위에서 연 메모함' : 'A 에이전트 오피스에서 연 메모함');
            // ① 목록 → 줄 카드
            let a = await seq('① 목록→줄카드', fo, async p => { await openRow(p); }, 4);
            ok(a[0].s === '메모함>현금표>줄카드' && a[1].s === '메모함>현금표' && a[2].s === '메모함' && a[3].s === '없음', '①' + tag + ' (폰 = 현금 줄 표 판에서) 줄 카드 → back = 현금 줄 표 → back = 목록 → back = 메모함 닫힘', T['① 목록→줄카드' + tag]);
            ok(fo ? (a[3].fo && !a[4].fo && !a[4].away) : a[4].away, '①' + tag + (fo ? ' 메모함이 닫힐 때까지 최종발주 창 그대로 · 그다음 back = 최종발주 창 닫힘' : ' 그다음 back = 그때야 화면 떠남'), T['① 목록→줄카드' + tag]);
            // ② 목록 → 매칭 판
            a = await seq('② 목록→판', fo, async p => { await openPanel(p); });
            ok(a[0].s === '메모함>판' && a[1].s === '메모함' && a[2].s === '없음', '②' + tag + ' 매칭 판 → back = 목록 → back = 메모함 닫힘', T['② 목록→판' + tag]);
            // ③ 판 → 줄 글 → 줄 카드 (대기 체크·찾기 글자 그대로)
            a = await seq('③ 판→줄카드', fo, async p => {
                await openPanel(p);
                const ck = p.locator('#om-card .om-pairx-b input[data-cact="pxchk"]').first(); if (await ck.count()) await ck.check();
                const qq = p.locator('#om-card [id^="om-px-q-"]').first(); if (await qq.count()) await qq.fill('손님');
                await p.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="201"]'); await p.waitForTimeout(200);
                const s0 = await layers(p); await openRowFromPanel(p); const s1 = await layers(p); s1.pre = s0; return s1;
            }, 4);
            ok(a[0].s === '메모함>줄카드' && a[1].s === '메모함>판' && a[2].s === '메모함' && a[3].s === '없음', '③' + tag + ' 판에서 연 줄 카드 → back = 판 → back = 목록 → back = 메모함 닫힘', T['③ 판→줄카드' + tag]);
            ok(a[1].pend === a[0].pre.pend && a[1].pend > 0 && a[1].chk === a[0].pre.chk && a[1].qv === a[0].pre.qv && S.puts.length === 0, '③' + tag + ' back 으로 판에 돌아옴 = 대기([현금으로 변경])·체크·찾기 글자 그대로 · 서버 쓰기 0', { pre: a[0].pre, back: a[1], puts: S.puts.length });
            // ③-b 판 → 줄 카드 → × → back(판 닫힘 한 겹만)
            a = await seq('③-b 판→줄카드→×', fo, async p => { await openPanel(p); await openRowFromPanel(p); await p.click('#om-card .om-back[data-cact="cancel"]'); await p.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await settle(p); });
            ok(a[0].s === '메모함>판' && a[1].s === '메모함' && a[2].s === '없음', '③-b' + tag + ' 줄 카드 ×로 판에 온 뒤 back = 목록 → back = 메모함 닫힘(헛돎·두 겹 닫힘 없음)', T['③-b 판→줄카드→×' + tag]);
            // ③-c 판 → 줄 카드 → 고침 → back = 묻기 → back = …
            a = await seq('③-c 판→줄카드 고침', fo, async p => { await openPanel(p); await openRowFromPanel(p); await p.fill('#om-f-0-c3', '고친주소'); await p.waitForTimeout(100); });
            ok(a[0].s === '메모함>줄카드' && a[1].s === '메모함>줄카드>묻기' && S.puts.length === 0, '③-c' + tag + ' 고친 줄 카드 back = 「저장 안 하고 닫을까요?」(종전 규칙)', T['③-c 판→줄카드 고침' + tag]);
            // #1157(대표 11/15 「매칭 주소 카드 눌렀다 뒤로가기 → 입력삭제 창 → 거기서 뒤로가기 하면 어플이 꺼져」) = 판 → 줄 카드 → back(판) → back 에서 목록 칸을 건너뜀
            //   셈 = 뒤로가기 처리 중에 사람 손 없이 쌓은 기록 칸 0(크롬은 그 앞 칸을 건너뜀) + 한 번에 한 겹
            const no0 = (a, m) => ok(a.noAct.length === 0, m + ' · 손 없이 쌓은 기록 칸 0(앞 칸 건너뜀 없음)', a.noAct);
            a = await seq('⑥ 판→줄카드→back→back→back', fo, async p => { await openPanel(p); await openRowFromPanel(p); }, 4);
            ok(a[0].s === '메모함>줄카드' && a[1].s === '메모함>판' && a[2].s === '메모함' && a[3].s === '없음', '⑥' + tag + ' 줄 카드 → back = 판 → back = 목록 → back = 메모함 닫힘', T['⑥ 판→줄카드→back→back→back' + tag]); no0(a, '⑥' + tag);
            a = await seq('⑥-b 판→줄카드→저장→back', fo, async p => { await openPanel(p); await openRowFromPanel(p); await p.fill('#om-f-0-c3', '고친주소2'); await p.click('#om-card-save'); await p.waitForSelector('#om-card:not([hidden]) .om-pxs-sum', { timeout: 8000 }); await settle(p); });
            ok(a[0].s === '메모함>판' && a[1].s === '메모함' && a[2].s === '없음', '⑥-b' + tag + ' 줄 카드 [저장]으로 판에 온 뒤 back = 목록 → back = 메모함 닫힘', T['⑥-b 판→줄카드→저장→back' + tag]); no0(a, '⑥-b' + tag);
            a = await seq('⑥-c 대기→줄카드→×→back', fo, async p => { await openPanel(p); await p.click('#om-card .om-px-paired [data-cact="pxdetach"][data-v="201"]'); await p.waitForTimeout(200); await openRowFromPanel(p); await p.click('#om-card .om-back[data-cact="cancel"]'); await p.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await settle(p); });
            ok(a[0].s === '메모함>판' && a[0].pend > 0 && a[1].s === '메모함' && a[2].s === '없음' && S.puts.length === 0, '⑥-c' + tag + ' [현금으로 변경] 대기 뒤 줄 카드 열고 × → 판(대기 그대로) → back = 목록 → back = 메모함 닫힘', T['⑥-c 대기→줄카드→×→back' + tag]); no0(a, '⑥-c' + tag);
            a = await seq('⑥-d 줄카드 두 번', fo, async p => { await openPanel(p); await openRowFromPanel(p); await back(p); await openRowFromPanel(p); await p.click('#om-card .om-back[data-cact="cancel"]'); await p.waitForSelector('#om-card:not([hidden]) .om-pxs-sum'); await settle(p); await openRowFromPanel(p); }, 4);
            ok(a[0].s === '메모함>줄카드' && a[1].s === '메모함>판' && a[2].s === '메모함' && a[3].s === '없음', '⑥-d' + tag + ' 줄 카드를 back·×로 두 번 닫고 세 번째 연 뒤 back = 판 → 목록 → 메모함 닫힘', T['⑥-d 줄카드 두 번' + tag]); no0(a, '⑥-d' + tag);
            ok(fo ? (a[3].fo && !a[4].fo && !a[4].away) : a[4].away, '⑥-d' + tag + ' 그다음 back = ' + (fo ? '최종발주 창 닫힘' : '그때야 화면 떠남'), T['⑥-d 줄카드 두 번' + tag]);
            a = await seq('⑥-e 판→줄카드→메모함 닫기', fo, async p => { await openPanel(p); await openRowFromPanel(p); await p.evaluate(() => window.AkmOrderMemo.close()); await settle(p); }, 2);
            ok(a[0].s === '없음' && (fo ? (a[0].fo && !a[1].fo && !a[1].away) : a[1].away), '⑥-e' + tag + ' 판 위 줄 카드에서 메모함을 닫음 = 감춘 판 칸도 같이 빠짐 → back 한 번에 ' + (fo ? '최종발주 창 닫힘' : '화면 떠남') + '(헛돎 없음)', T['⑥-e 판→줄카드→메모함 닫기' + tag]);
            // ④ 줄 카드 안 확인 창(품목 고르기 판) · 메모함 지우기 확인 창
            a = await seq('④ 줄카드→품목고르기', fo, async p => { await openRow(p); const b = p.locator('#om-card [data-cact="opt"]').first(); if (await b.count()) { await b.click(); await settle(p); } });
            ok(a[0].s === '메모함>현금표>줄카드>품목' && a[1].s === '메모함>현금표>줄카드' && a[2].s === '메모함>현금표' && a[3].s === '메모함', '④' + tag + ' 품목 고르기 → back = 줄 카드 → back = 목록', T['④ 줄카드→품목고르기' + tag]);
            a = await seq('④-b 지우기 확인창', fo, async p => { const x = p.locator('#om-list [data-act="del"], #om-ctw [data-act="del"]').first(); if (await x.count()) { await x.click(); await settle(p); } });
            ok(a[0].s === '메모함>확인창' && a[1].s === '메모함' && a[2].s === '없음', '④-b' + tag + ' 지우기 확인 창 → back = 목록 → back = 메모함 닫힘', T['④-b 지우기 확인창' + tag]);
            // ⑦ #1167 폰 = 그린 달력(인디고 · [취소][확인]) · 달력 뜬 채 back = 달력만 닫힘 → back = 현금표 → 목록 · 기록 칸 손 없이 안 쌓임
            a = await seq('⑦ 줄카드→발송일 달력', fo, async p => { await openRow(p); { const b = await p.locator('#om-f-0-date').first().boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } await p.waitForSelector('#om-cal:not([hidden])'); await settle(p); }, 4);
            ok(a[0].s === '메모함>현금표>줄카드>달력' && a[1].s === '메모함>현금표' && a[2].s === '메모함' && a[3].s === '없음', '⑦' + tag + ' #1169 달력은 기록 안 씀 = 달력 뜬 채 back = 카드와 함께 닫힘(고친 것 없음) → back = 목록 → back = 메모함 닫힘 · 한 번에 한 겹', T['⑦ 줄카드→발송일 달력' + tag]); no0(a, '⑦' + tag);
            // ⑦-b 날 → [확인] 뒤 back = 「저장 안 하고 닫을까요?」(고친 것 = 발송일)
            a = await seq('⑦-b 달력 고름→back', fo, async p => { await openRow(p); { const b = await p.locator('#om-f-0-date').first().boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } await p.waitForSelector('#om-cal:not([hidden])'); { const b = await p.locator('#om-cal [data-pick="tomorrow"]').first().boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } { const b = await p.locator('#om-cal [data-cal="ok"]').first().boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } await settle(p); }, 2);
            ok(a[0].s === '메모함>현금표>줄카드' && a[1].s === '메모함>현금표>줄카드>묻기' && S.puts.length === 0, '⑦-b' + tag + ' [내일] → [확인] = 달력 닫힘(기록 칸도 빠짐) → back = 「저장 안 하고 닫을까요?」(종전 규칙)', T['⑦-b 달력 고름→back' + tag]); no0(a, '⑦-b' + tag);
            // ⑤ 추가(새 글 정리) 카드
            a = await seq('⑤ 정리 결과 카드', fo, async p => {
                S.preview = { ok: true, rows: [{ kind: 'line', key: '010-4400-5678', note: '큰 걸로', plat: '네이버', line: ['', '010-4400-5678', '큰 걸로', '네이버'].join('\t'), sure: true, check_why: [] }] };
                await p.fill('#om-raw', '010-4400-5678 큰 걸로'); await p.click('#om-go'); await p.waitForSelector('#om-card:not([hidden])', { timeout: 8000 }); await settle(p);
            });
            ok(a[0].s.startsWith('메모함>줄카드') && a[1].s !== '없음' && !a[1].away, '⑤' + tag + ' 정리 결과 카드 → back = 묻기 또는 목록(메모함은 안 닫힘)', T['⑤ 정리 결과 카드' + tag]);
        }
        console.log('  지금 동작', JSON.stringify(T, null, 1));
        console.log('  손 없이 쌓은 기록 칸(장면별)', JSON.stringify(Object.fromEntries(Object.entries(NA).filter(([, v]) => v)), null, 1));
        ok(pe.length === 0, '스크립트 오류 0', pe.slice(0, 5));
    } catch (e) { failN++; console.log('  ❌ 실행 오류', e && e.stack || e); console.log('  지금까지', JSON.stringify(T, null, 1)); }
    finally { await browser.close(); srv.close(); }
    console.log(`\n결과 ${pass}/${pass + failN}`); process.exit(failN ? 1 : 0);
})();
