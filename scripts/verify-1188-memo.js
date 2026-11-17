// #1188 검증 — 발주 메모함 ⓐ 1박스 박스별 줄 목록 글(바뀐 것 중심) ⓑ 기사님 전달 글뿐인 보통 줄 = 「배송메세지 아님」 알약 + 줄 카드 안내 띠([배송메세지로 넣기][이대로 저장])
//   🔴 실DB·서버(server.js)·네트워크 0 — verify-900-2b.js 의 가짜 서버·자료(verify-1148-back.js 와 같은 덧댐) · 쓰기 꼴 요청은 가짜 서버 안에서만 기록
//   기준 = #1188 직전 커밋 c7f90f3(?v=old · BASE1188 로 바꿈) 과 지금 파일(?v=new)을 같은 가짜 자료로 띄워 견줌(달라져야 할 줄만 달라졌나)
//   실행: node scripts/verify-1188-memo.js   (PORT1188 로 포트 · 기본 3462)
'use strict';
const path = require('path'), http = require('http'), fs = require('fs'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright');
const XLSX = require('xlsx-js-style');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 1200) : ''); } };

let B = fs.readFileSync(path.join(__dirname, 'verify-900-2b.js'), 'utf8').split('\r\n').join('\n');
B = B.slice(B.indexOf('const SRC = {'), B.indexOf('(async () => {'));
const BASE = process.env.BASE1188 || 'c7f90f3';   // 견줄 기준 = #1188 이 들어가기 직전 커밋(v5.9.826) — HEAD 는 #1188 배포 뒤라 지금 파일과 같음
if (B.split('git show HEAD:').length !== 3) throw new Error('기준 커밋 자리 못 찾음');
B = B.split('git show HEAD:').join('git show ' + BASE + ':');
const patch = (a, b) => { if (B.split(a).length !== 2) throw new Error('덧댐 자리 못 찾음: ' + a.slice(0, 60)); B = B.replace(a, () => b); };
patch('function pxList() {', 'function pxList() { const L = pxList0(); return S.mut ? S.mut(L) : L; }\nfunction pxList0() {');
patch('try { S.puts.push(JSON.parse(b)); } catch (e) { }', 'try { const j = JSON.parse(b); j._id = Number(u.pathname.split(\'/\').pop()); S.puts.push(j); } catch (e) { }');
patch('<script src="/xlsx.js"></script>', '<script src="/hb.js"></script><script src="/xlsx.js"></script>');
patch("if (u.pathname === '/xlsx.js')", "if (u.pathname === '/hb.js') return send(200, HBJS, 'text/javascript; charset=utf-8');\n        if (u.pathname === '/away') return send(200, '<!doctype html><title>away</title>떠남', 'text/html; charset=utf-8');\n        if (u.pathname === '/xlsx.js')");
const DESK = fs.readFileSync(path.join(ROOT, 'public', 'ao-desk.js'), 'utf8').split('\r\n').join('\n');
const h0 = DESK.indexOf('    const HB = { stack: []'), h1 = DESK.indexOf('    const TOOLS = [', h0);
if (h0 < 0 || h1 < 0) throw new Error('ao-desk.js 겹 기록 구간 못 찾음');
const HBJS = `(function(){\n${DESK.slice(h0, h1)}\nwindow.addEventListener('popstate', hbPop);\nwindow.AkmAoDesk = { hbPush, hbDrop, _hb: HB };\n})();`;
const M = new Function('require', 'ROOT', 'path', 'fs', 'http', 'execSync', 'chromium', 'XLSX', 'ok', 'HBJS', B + '\nreturn { S, serve, until, PXL, CAT };')(require, ROOT, path, fs, http, execSync, chromium, XLSX, ok, HBJS);
const { S, serve, CAT } = M;
const dg = s => String(s || '').replace(/\D/g, '');
// 크롬 「기록 조작 막이」 흉내(verify-1148-back.js 와 같음) = 사람 손 없이 쌓은 기록 칸 셈
const ACT = `(() => { let act = false; window.__noAct = [];
  ['pointerdown', 'keydown', 'click', 'touchend'].forEach(t => window.addEventListener(t, e => { if (e.isTrusted) act = true; }, true));
  const P = history.pushState.bind(history);
  history.pushState = function (st) { if (!act) window.__noAct.push(JSON.stringify(st && (st.k || st.omOwn || st.foPanel) || '?')); act = false; return P.apply(null, arguments); };
})();`;

// ── 가짜 자료 한 벌(이름·번호 전부 가짜) ──
const K = n => '010-2696-' + String(n).padStart(4, '0');
const B0 = () => ({ t: '', o: '', n: '', p: '', p2: '', a: '', m: '', s: '', sn: '', sp: '' });
const PNO = id => '2026111700000' + id;
const DOOR = '현관비밀번호 1212', LONG_ADDR = '서울특별시 송파구 올림픽로 300 롯데월드타워 101동 1001호';
function mut(L) {
    const Ln = (id, note, more) => Object.assign({ id, kind: 'line', state: 'open', sure: true, check_why: [], key: K(id), note, plat: '네이버', ship_date: null, line: [K(id), note, '네이버'].filter(Boolean).join(' '), checked: { plat: '네이버', as: 'buyer', at: '2026-11-17T03:00:00.000Z' }, badge: { kind: 'line', state: 'ok', t: '매칭완료', why: '', type: 'other' } }, more || {});
    const Bx = (id, boxes, note, more) => Ln(id, note, Object.assign({ boxes, line: ['', K(id), note, '네이버'].join('\t'), checked: { plat: '네이버', as: 'buyer', at: '2026-11-17T03:00:00.000Z', buyer: K(id), pno: PNO(id) }, badge: { kind: 'line', state: 'ok', t: '박스별 ' + boxes.length + '박스', why: '', type: 'box' } }, more || {}));
    const rows = [
        Bx(501, [Object.assign(B0(), { m: DOOR })], '박스별 1박스 · 박스1=그대로(배송메세지 바꿈)'),
        Bx(502, [Object.assign(B0(), { n: '김받는', a: LONG_ADDR, m: '문 앞에 놔주세요' })], '박스별 1박스 · 박스1=그대로(받는 분·주소·배송메세지 바꿈)'),
        Bx(503, [Object.assign(B0(), { t: 'S사이즈로!' }), Object.assign(B0(), { m: '경비실' })], '박스별 2박스 · 박스1=S · 박스2=그대로(배송메세지 바꿈)'),
        Ln(504, DOOR),
        Ln(505, '20일 발송'),
        Ln(506, '입력o삭제x', { badge: { m: 1, n: 1, later: 0, later_date: null, service: 0, pre: false, item_diff: false, state: 'ok' } }),
        Ln(507, 'S사이즈로', { badge: { kind: 'line', state: 'ok', t: '매칭완료', why: '', type: 'size' } }),
        Ln(508, ''),
        Ln(509, '현관 비번 1234 20일 발송'),
        Ln(510, '보내는이 홍길동 문 앞'),
        Ln(511, '배송메모 문 앞에 놔주세요', { checked: { plat: '네이버', as: 'buyer', at: '2026-11-17T03:00:00.000Z', ship_memo: '문 앞에 놔주세요' } }),
        Ln(512, '문 앞에 놔주세요', { ship_date: '2026-12-15', line: ['12/15', K(512), '문 앞에 놔주세요', '네이버'].join('\t') }),
        Bx(514, [Object.assign(B0(), { t: 'S사이즈로!', sn: '홍보내 드림', s: '' })], '박스별 1박스 · 박스1=S(보내는 분 바꿈)'),
        Bx(515, [Object.assign(B0(), { s: '1' })], '박스별 1박스 · 박스1=안 보냄'),
        Ln(516, '큰 걸로 부탁드려요'),
        Ln(517, '경비실에 맡겨주세요 3층'),
        Ln(523, '현관 비번 1234', { key: '2026111700000523', line: '2026111700000523 현관 비번 1234 네이버', checked: { plat: '네이버', as: 'order', at: '2026-11-17T03:00:00.000Z' } }),   // 점검 5) 주문번호 줄 = 알약·띠 없음
        Ln(524, '1호 선물세트로 부탁'),   // 점검 5) 「1호」 = 호수 아님
        Ln(525, '101동 1203호 앞에'),     // 동·호수 꼴 = 알약
        Ln(528, '1203호 앞에 두세요'),    // 3자리↑ 호수 = 알약
    ];
    if (S.extra) rows.push(...S.extra(Ln, Bx));
    L.entries.push({ id: 700, created_at: new Date().toISOString(), source: 'manual', raw: '', rows: rows.filter(r => !S.deleted.has(r.id)) });
    return L;
}
const ord = (id, more) => Object.assign({ as: 'buyer', plat: '네이버', pno: PNO(id), order_no: '20261117' + id, option: CAT[0], qty: 1, recv_name: '받는손님', addr: '서울 송파구 올림픽로 1', buyer_phone: K(id) }, more || {});
const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === 'at' ? undefined : x)));

(async () => {
    const PORT = Number(process.env.PORT1188 || 3462);
    const srv = await serve(PORT), base = `http://127.0.0.1:${PORT}/`;
    const browser = await chromium.launch();
    const pe = [];
    const reset = () => { Object.assign(S, { px: true, px2: false, px3: false, pxHide: false, pxOrig: false, deleted: new Set(), puts: [], pairs: [], services: [], saves: [], mut, listDelay: 0, badges: {}, preview: null, extra: null, calls: [] });
        S.lookup = { [dg(K(504))]: [ord(504)], [dg(K(508))]: [ord(508)], [dg(K(517))]: [ord(517), ord(517, { pno: PNO(517) + '9', order_no: '202611175179', option: CAT[2], recv_name: '둘째주문' })], [dg(K(601))]: [ord(601)], [dg(K(602))]: [ord(602, { qty: 3 })], [dg(K(502))]: [ord(502)] }; };
    async function newPage(v, vp) {
        const cx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, vp || {})); const p = await cx.newPage(); p.on('pageerror', e => pe.push(String(e)));
        await cx.addInitScript(ACT);
        await p.goto(base + 'away'); await p.goto(base + '?v=' + v);
        await p.evaluate(() => window.AkmOrderMemo.open({ noFocus: true })); await p.waitForSelector('#om-list .om-ml'); await p.waitForTimeout(900);
        await p.evaluate(() => { window.__noAct = []; });
        return { cx, p };
    }
    const listOf = p => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#om-list .om-ml')].map(li => [li.dataset.id, { html: li.outerHTML, text: (li.querySelector('.om-ml-l') || {}).textContent || '', pills: [...li.querySelectorAll('.om-ml-h .om-pill')].map(x => x.textContent.trim()) }])));
    const openEdit = async (p, id) => { await p.click(`#om-list .om-ml[data-id="${id}"] .om-ml-t`); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard'); await p.waitForTimeout(900); };
    const closeCard = async p => { await p.click('#om-card .om-back[data-cact="cancel"]'); await p.waitForTimeout(200); const d = p.locator('#om-card [data-cact="discard"]'); if (await d.count()) { await d.click(); } await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(800); };
    const cardNorm = p => p.evaluate(() => { const c = document.getElementById('om-card'); return c.querySelector('.om-card-b').innerHTML.replace(/<div class="om-smb-w" id="om-smb-\d+"><\/div>\s*/g, '').replace(/\s+/g, ' '); });
    const band = p => p.evaluate(() => { const b = document.querySelector('#om-card .om-smb'); return b ? { t: b.querySelector('.om-smb-t b').textContent, sub: b.querySelector('.om-smb-t span').textContent, btns: [...b.querySelectorAll('button')].map(x => x.textContent.trim()), hint: (b.querySelector('.om-acts span') || {}).textContent || '' } : null; });
    const paste = async (p, text, rows) => { S.preview = { ok: true, rows }; await p.fill('#om-raw', text); await p.click('#om-go'); await p.waitForSelector('#om-card:not([hidden]) .om-rowcard', { timeout: 8000 }); await p.waitForTimeout(900); };
    const pv = (id, note) => ({ kind: 'line', key: K(id), note, plat: '네이버', line: ['', K(id), note, '네이버'].join('\t'), sure: true, check_why: [] });
    const toasts = p => p.evaluate(() => (window.__toasts || []).slice());
    try {
        // ── 1. 목록: ⓐ 표시 글 · ⓑ 알약 · 그 밖 줄은 HEAD 와 같은 글자 ──
        console.log('1 목록(ⓐ 표시 글 · ⓑ 알약 · HEAD 대조)');
        reset(); const O = await newPage('old'), N = await newPage('new');
        const lo = await listOf(O.p), ln = await listOf(N.p);
        ok(ln['501'].text === `${K(501)} 배송메세지 → ${DOOR}`, 'ⓐ 1박스·배송메세지만 = 「번호 배송메세지 → 글」', { now: ln['501'].text, old: lo['501'].text });
        ok(/받는 분 → 김받는/.test(ln['502'].text) && /주소 → 서울특별시 송파구 올림픽로 300 롯데월…/.test(ln['502'].text) && /배송메세지 → 문 앞에 놔주세요/.test(ln['502'].text) && !/박스1=|1박스 그대로/.test(ln['502'].text), 'ⓐ 1박스·받는 분+주소+배송메세지 = 바꾼 칸마다 · 긴 주소는 말줄임', ln['502'].text);
        ok(ln['514'].text === `${K(514)} 보내는 분 → 홍보내 드림 · 사이즈 → S`, 'ⓐ 1박스·사이즈+보내는 분', ln['514'].text);
        ok(ln['515'].text === `${K(515)} 안 보냄`, 'ⓐ 1박스·안 보냄', ln['515'].text);
        ok(ln['503'].text === lo['503'].text && ln['503'].html === lo['503'].html, 'ⓐ 2박스 박스별 줄 = 종전 글 그대로', { now: ln['503'].text });
        ok(/1박스 그대로\(배송메세지 바꿈\)/.test(lo['501'].text), '(기준) HEAD 의 1박스 글 = 「1박스 그대로(배송메세지 바꿈)」', lo['501'].text);
        const pillIds = Object.keys(ln).filter(id => ln[id].pills.includes('배송메세지 아님')).sort();
        ok(pillIds.join() === '504,517,525,528', 'ⓑ 「배송메세지 아님」 알약 = 현관·경비실·동호수 글 보통 줄(504·517·525·528)에만', pillIds);
        ok(!ln['523'].pills.includes('배송메세지 아님') && !ln['524'].pills.includes('배송메세지 아님'), '점검 5) 주문번호 줄(523)·「1호 선물세트」(524) = 알약 없음', [ln['523'].pills, ln['524'].pills]);
        ok(['505', '506', '507', '508', '509', '510', '511', '512', '516', '190'].every(id => ln[id] && !ln[id].pills.includes('배송메세지 아님')), 'ⓑ 날짜 글·입력삭제·사이즈·빈 글·날짜 섞인 글·보내는이·배송메모 줄·발송일 있는 줄·기사님 말 아닌 글 = 알약 없음');
        const same = Object.keys(lo).filter(id => !['501', '502', '514', '515', '504', '517', '525', '528'].includes(id));
        const diff = same.filter(id => !ln[id] || ln[id].html !== lo[id].html);
        ok(Object.keys(lo).length === Object.keys(ln).length && diff.length === 0, `그 밖 줄 ${same.length}개 = HEAD 와 줄 마크업 글자까지 같음`, diff);
        ok(['504', '517', '525', '528'].every(id => ln[id].html.replace(/<span class="om-pill k-nosm"[^>]*>배송메세지 아님<\/span>/, '') === lo[id].html), '알약 줄(504·517) = 알약 하나만 더해짐(나머지 같음)');
        ok(['501', '502', '514', '515'].every(id => ln[id].pills.join() === lo[id].pills.join()), 'ⓐ 1박스 줄 알약은 그대로(글만 바뀜)', { now: ln['501'].pills, old: lo['501'].pills });

        // ── 2. 고치기 카드: 띠 뜨는 줄 / 안 뜨는 줄 · 안 뜨는 줄은 HEAD 와 같음 ──
        console.log('2 고치기 카드(띠 · HEAD 대조)');
        for (const id of ['505', '506', '507', '508', '511', '516', '501', '523', '524']) {
            await openEdit(O.p, id); await openEdit(N.p, id);
            const a = await cardNorm(O.p), b = await cardNorm(N.p), bd = await band(N.p);
            ok(!bd && a === b, `줄 ${id} 카드 = 띠 없음 · 카드 본문이 HEAD 와 같음`, { band: bd, same: a === b });
            await closeCard(O.p); await closeCard(N.p);
        }
        await openEdit(N.p, '504');
        let bd = await band(N.p);
        ok(!!bd && bd.t === '이 글은 택배 양식 배송메세지에 저절로 안 들어가요' && bd.btns.join('|') === '배송메세지로 넣기|이대로 저장', '줄 504 카드 = 안내 띠 + [배송메세지로 넣기][이대로 저장]', bd);
        // [이대로 저장] = HEAD 의 [고친 대로 저장] 과 같은 본문
        await openEdit(O.p, '504'); S.puts = []; await O.p.click('#om-card-save'); await O.p.waitForTimeout(900); const putOld = strip(S.puts);
        S.puts = []; await N.p.click('#om-card .om-smb [data-cact="smkeep"]'); await N.p.waitForTimeout(900); const putNew = strip(S.puts);
        ok(putOld.length === 1 && JSON.stringify(putOld) === JSON.stringify(putNew) && S.deleted.size === 0 && S.saves.length === 0, '[이대로 저장] = HEAD 의 저장과 같은 PUT 본문 1건 · 지움 0 · 새 줄 0', { putOld, putNew });
        await O.cx.close(); await N.cx.close();

        // ── 3. [배송메세지로 넣기] (고치기 카드 · 주문 1건·1박스) ──
        console.log('3 [배송메세지로 넣기] 고치기 카드 → 고객정보수정 판');
        reset(); let X = await newPage('new'); let p = X.p;
        await openEdit(p, '504'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card:not([hidden]) .om-ce'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        let st = await p.evaluate(() => ({ h: document.querySelector('#om-card-t').textContent, note: document.querySelector('#om-card .om-smb-n').textContent, m: [...document.querySelectorAll('#om-card [data-cact="bxf"][data-k="m"]')].map(i => i.value) }));
        ok(/고객정보수정/.test(st.h) && st.m.length === 1 && st.m[0] === DOOR && /넣어 뒀어요/.test(st.note) && /옛 보통 줄은 지워요/.test(st.note) && /닫으면 보통 줄로 남아요/.test(st.note), '고객정보수정 판이 열리고 배송메세지 칸에 글이 미리 · 안내 한 줄', st);
        ok(S.saves.length === 0 && S.puts.length === 0 && S.deleted.size === 0, '누르기만 = 서버 쓰기 0(저장은 [저장])');
        await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        let sv = S.saves[0] && S.saves[0].rows && S.saves[0].rows[0];
        ok(S.saves.length === 1 && S.saves[0].rows.length === 1 && sv.boxes.length === 1 && sv.boxes[0].m === DOOR && sv.checked.pno === PNO(504) && /^박스별 1박스/.test(sv.note) && dg(sv.key) === dg(K(504)), '[저장] = 박스별 줄 POST · boxes[0].m = 글 · checked.pno = 그 주문', sv);
        ok(S.deleted.has(504) && S.deleted.size === 1 && S.puts.length === 0, '저장된 뒤 옛 보통 줄(504)만 지움(비운 것으로)', [...S.deleted]);
        ok((await toasts(p)).some(t => /옛 보통 줄은 지웠어요/.test(t)), '안내 = 「옛 보통 줄은 지웠어요」');
        let l2 = await listOf(p);
        ok(!l2['504'], '목록에서 옛 줄 사라짐');
        await X.cx.close();

        // ── 4. 주문 2건 = 주문 고르기 · 고른 주문에만 ──
        console.log('4 주문 2건 = 주문 고르기');
        reset(); X = await newPage('new'); p = X.p;
        await openEdit(p, '517'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        st = await p.evaluate(() => ({ note: document.querySelector('#om-card .om-smb-n').textContent, m: document.querySelectorAll('#om-card [data-cact="bxf"][data-k="m"]').length, fix: document.querySelectorAll('#om-card [data-cact="cefix"]').length }));
        ok(st.m === 0 && st.fix === 2 && /넣을 주문의 \[고치기\]를 눌러 주세요/.test(st.note), '주문 2건 = 미리 안 고름 · 「넣을 주문의 [고치기]를 눌러 주세요」', st);
        await p.click(`#om-card [data-cact="cefix"][data-o="${PNO(517)}9"]`); await p.waitForTimeout(400);
        st = await p.evaluate(() => [...document.querySelectorAll('#om-card [data-cact="bxf"][data-k="m"]')].map(i => i.value));
        ok(st.length === 1 && st[0] === '경비실에 맡겨주세요 3층', '둘째 주문 [고치기] = 그 주문 배송메세지 칸에 글', st);
        await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        sv = S.saves[0] && S.saves[0].rows[0];
        ok(S.saves.length === 1 && S.saves[0].rows.length === 1 && sv.checked.pno === PNO(517) + '9' && sv.boxes[0].m === '경비실에 맡겨주세요 3층' && S.deleted.has(517), '저장 = 고른 주문(pno) 박스별 줄 1개 · 옛 줄 지움', sv);
        await X.cx.close();

        // ── 5. 그 주문에 박스별 줄이 이미 있음 = 저장된 값 위에(덮어 지우지 않음 · PUT) ──
        console.log('5 이미 박스별 줄이 있는 주문');
        reset(); S.extra = Ln => [Ln(518, '공동현관 #1234', { key: K(502), line: K(502) + ' 공동현관 #1234 네이버' })]; X = await newPage('new'); p = X.p;
        await openEdit(p, '518'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        let pu = S.puts.find(x => x._id === 502);
        ok(S.saves.length === 0 && !!pu && pu.boxes[0].m === '공동현관 #1234' && pu.boxes[0].n === '김받는' && pu.boxes[0].a === LONG_ADDR && pu.checked.pno === PNO(502) && S.deleted.has(518) && S.deleted.size === 1, '이미 배송메세지가 저장된 박스별 줄(502) = 넘어온 새 글로 바뀜(PUT m = 새 글) · 받는 분·주소 그대로 · 저장된 뒤 옛 보통 줄 지움', { pu, del: [...S.deleted] });
        await X.cx.close();
        reset(); S.extra = Ln => [Ln(518, '공동현관 #1234', { key: K(502), line: K(502) + ' 공동현관 #1234 네이버' })]; X = await newPage('new'); p = X.p;
        await openEdit(p, '518'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        st = await p.evaluate(() => ({ note: document.querySelector('#om-card .om-smb-n').textContent, m: [...document.querySelectorAll('#om-card [data-cact="bxf"][data-k="m"]')].map(i => i.value) }));
        ok(st.m.join() === '공동현관 #1234' && !/이미 배송메세지가 있어요/.test(st.note) && /넣어 뒀어요/.test(st.note), '판 = 칸에 새 글이 들어 있음 · 「이미 배송메세지가 있어요」 안내 줄 없음', st);
        await p.fill('#om-card [data-cact="bxf"][data-k="m"]', '공동현관 #1234'); await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        pu = S.puts.find(x => x._id === 502);
        ok(!!pu && pu.boxes[0].m === '공동현관 #1234' && pu.boxes[0].n === '김받는' && S.deleted.has(518) && S.deleted.size === 1, '칸을 같은 글로 다시 적어 저장해도 = PUT m 새 글 · 받는 분 그대로 · 옛 보통 줄 지움', { pu, del: [...S.deleted] });
        await X.cx.close();
        // 이미 박스별 줄이 있는데 배송메세지는 비어 있음 = 빈 칸에만 넣음(받는 분 그대로)
        reset(); S.extra = (Ln, Bx) => [Bx(520, [Object.assign(B0(), { n: '기존받는' })], '박스별 1박스 · 박스1=그대로(받는 분 바꿈)'), Ln(521, '문 앞에 놔주세요', { key: K(520), line: K(520) + ' 문 앞에 놔주세요 네이버' })]; S.lookup[dg(K(520))] = [ord(520)]; X = await newPage('new'); p = X.p;
        await openEdit(p, '521'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        pu = S.puts.find(x => x._id === 520);
        ok(S.saves.length === 0 && !!pu && pu.boxes[0].m === '문 앞에 놔주세요' && pu.boxes[0].n === '기존받는' && S.deleted.has(521) && S.deleted.size === 1, '박스별 줄은 있는데 배송메세지가 비었음 = 빈 칸에 넣고 받는 분 그대로 PUT · 옛 보통 줄 지움', { pu, del: [...S.deleted] });
        await X.cx.close();
        // 점검 2) 저장된 박스별 줄 박스 수(2) ≠ 지금 주문(1박스) = 안 채움 · 판도 안 열림 · 저장 쓰기 0
        reset(); S.extra = Ln => [Ln(522, '경비실에 맡겨주세요', { key: K(503), line: K(503) + ' 경비실에 맡겨주세요 네이버' })]; S.lookup[dg(K(503))] = [ord(503)]; X = await newPage('new'); p = X.p;
        await openEdit(p, '522'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        st = await p.evaluate(() => ({ note: document.querySelector('#om-card .om-smb-n').textContent, m: document.querySelectorAll('#om-card [data-cact="bxf"]').length }));
        ok(st.m === 0 && /박스 수가 다른 박스별 줄이 저장돼 있어요/.test(st.note) && /닫으면 보통 줄로 남아요/.test(st.note), '점검 2) 박스 수가 다르면 미리 안 채움 · 안내만', st);
        await p.click('#om-card [data-cact="cefix"]'); await p.waitForTimeout(400);
        ok((await p.evaluate(() => document.querySelectorAll('#om-card [data-cact="bxf"]').length)) === 0 && (await toasts(p)).some(t => /박스 수가 다른 박스별 줄/.test(t)), '점검 2) [고치기]를 눌러도 판이 안 열림(옛 받는 분·주소를 빈칸으로 덮는 저장 길 없음) + 안내');
        await p.click('#om-card-save'); await p.waitForTimeout(700);
        ok(S.puts.length === 0 && S.saves.length === 0 && S.deleted.size === 0, '점검 2) [저장]을 눌러도 서버 쓰기 0(바꾼 것 없음)', { puts: S.puts.length, saves: S.saves.length });
        await X.cx.close();
        // 점검 3) 미리 채운 글을 지우고 다른 글로 저장 = 박스별 줄은 저장되지만 옛 보통 줄은 안 지움
        reset(); X = await newPage('new'); p = X.p;
        await openEdit(p, '504'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        await p.fill('#om-card [data-cact="bxf"][data-k="m"]', '전혀 다른 글'); await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        ok(S.saves.length === 1 && S.saves[0].rows[0].boxes[0].m === '전혀 다른 글' && S.deleted.size === 0, '점검 3) 넘긴 글이 저장에 안 들어갔으면 옛 보통 줄 안 지움', [...S.deleted]);
        await X.cx.close();
        // 점검 4) 2박스 주문 · 저장된 박스별 줄의 박스 주소가 서로 다름 = 안 채움 + 안내
        reset(); S.extra = (Ln, Bx) => [Bx(526, [Object.assign(B0(), { a: '서울 강남구 1' }), Object.assign(B0(), { a: '부산 해운대구 2' })], '박스별 2박스 · 박스1=그대로(주소 바꿈) · 박스2=그대로(주소 바꿈)'), Ln(527, '부재 시 문 앞', { key: K(526), line: K(526) + ' 부재 시 문 앞 네이버' })]; S.lookup[dg(K(526))] = [ord(526, { qty: 2 })]; X = await newPage('new'); p = X.p;
        await openEdit(p, '527'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        await p.click('#om-card [data-cact="cefix"]'); await p.waitForTimeout(400);
        st = await p.evaluate(() => ({ note: document.querySelector('#om-card .om-smb-n').textContent, m: [...document.querySelectorAll('#om-card [data-cact="bxf"][data-k="m"]')].map(i => i.value), a: [...document.querySelectorAll('#om-card [data-cact="bxf"][data-k="a"]')].map(i => i.value) }));
        ok(st.m.length === 2 && st.m.every(v => v === '') && st.a.join('|') === '서울 강남구 1|부산 해운대구 2' && /박스마다 주소가 달라요 · 넣을 박스에 직접 넣어 주세요/.test(st.note), '점검 4) 박스마다 주소가 다르면 배송메세지 안 채움(주소는 그대로 깔림) + 「박스마다 주소가 달라요」', st);
        await X.cx.close();

        // ── 5-b. 한 번호에 주문 3건(1박스 + 2박스 + 쿠팡 1박스 · 받는 분 다름) + 그 번호의 사이즈 줄·다른 주문 박스별 줄 ──
        console.log('5-b 주문 3건(판매처 섞임) · 2건에 차례로 · 같은 번호 다른 줄 무접촉');
        const three = () => { S.extra = (Ln, Bx) => [Ln(530, '공동현관 비번 #4321', { key: K(530) }), Ln(531, 'S사이즈로', { key: K(530), line: K(530) + ' S사이즈로 네이버', badge: { kind: 'line', state: 'ok', t: '매칭완료', why: '', type: 'size' } }), Bx(532, [Object.assign(B0(), { n: '기존받는' })], '박스별 1박스 · 박스1=그대로(받는 분 바꿈)', { key: K(530), line: ['', K(530), '박스별 1박스 · 박스1=그대로(받는 분 바꿈)', '네이버'].join('\t'), checked: { plat: '네이버', as: 'buyer', at: '2026-11-17T03:00:00.000Z', buyer: K(530), pno: 'A1' } })];
            S.lookup[dg(K(530))] = [ord(530, { pno: 'A1', order_no: 'OA1', recv_name: '김하나', addr: '서울 1' }), ord(530, { pno: 'A2', order_no: 'OA2', qty: 2, option: CAT[2], recv_name: '이두리', addr: '부산 2' }), ord(530, { pno: 'A3', order_no: 'OA3', plat: '쿠팡', recv_name: '박세나', addr: '제주 3' })]; };
        reset(); three(); X = await newPage('new'); p = X.p;
        await openEdit(p, '530'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        st = await p.evaluate(() => ({ fix: document.querySelectorAll('#om-card [data-cact="cefix"]').length, m: document.querySelectorAll('#om-card [data-cact="bxf"]').length, note: document.querySelector('#om-card .om-smb-n').textContent }));
        ok(st.fix === 3 && st.m === 0 && /넣을 주문의 \[고치기\]를 눌러 주세요/.test(st.note), '주문 3건 = 미리 안 고름 · 주문 고르기', st);
        await closeCard(p);
        ok(S.saves.length === 0 && S.puts.length === 0 && S.deleted.size === 0 && !!(await listOf(p))['530'], '주문을 안 고르고 닫음 = 서버 쓰기 0 · 보통 줄 그대로');
        await openEdit(p, '530'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        await p.click('#om-card [data-cact="cefix"][data-o="A2"]'); await p.waitForTimeout(400); await p.click('#om-card [data-cact="cefix"][data-o="A3"]'); await p.waitForTimeout(400);
        st = await p.evaluate(() => ({ m: [...document.querySelectorAll('#om-card [data-cact="bxf"][data-k="m"]')].map(i => [i.dataset.x, i.value].join(':')), note: document.querySelector('#om-card .om-smb-n').textContent }));
        ok(st.m.join('|') === 'A2:공동현관 비번 #4321|A2:공동현관 비번 #4321|A3:공동현관 비번 #4321' && /넣어 뒀어요\(주문 2건\)/.test(st.note), '둘째(2박스)·셋째(쿠팡) 주문 [고치기] = 그 두 주문 칸에만 글(첫째 주문 판은 안 열림) · 「주문 2건」', st);
        await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        const r3 = (S.saves[0] && S.saves[0].rows) || [], by = pn => r3.find(x => x.checked && x.checked.pno === pn);
        ok(S.saves.length === 1 && r3.length === 2 && by('A2').boxes.length === 2 && by('A2').boxes.every(b => b.m === '공동현관 비번 #4321') && by('A2').plat === '네이버' && by('A3').boxes.length === 1 && by('A3').boxes[0].m === '공동현관 비번 #4321' && by('A3').plat === '쿠팡' && !by('A1'), '저장 = 박스별 줄 2개(pno A2·A3 각각 · 판매처 각각) · 첫째 주문(A1) 줄 없음', r3.map(x => [x.checked.pno, x.plat, x.boxes.length]));
        ok(S.puts.length === 0 && S.deleted.has(530) && S.deleted.size === 1, '같은 번호의 사이즈 줄(531)·다른 주문 박스별 줄(532) = 무접촉(PUT 0 · 지움은 옛 보통 줄 530 하나 · 한 번의 [저장] 뒤)', { puts: S.puts.map(x => x._id), del: [...S.deleted] });
        await X.cx.close();
        // 주문 2건(1박스+1박스) 중 첫째만
        reset(); S.extra = Ln => [Ln(535, '택배함에 넣어주세요', { key: K(535) })]; S.lookup[dg(K(535))] = [ord(535, { pno: 'B1', order_no: 'OB1', recv_name: '김하나' }), ord(535, { pno: 'B2', order_no: 'OB2', recv_name: '이두리', addr: '대구 9' })]; X = await newPage('new'); p = X.p;
        await openEdit(p, '535'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        await p.click('#om-card [data-cact="cefix"][data-o="B1"]'); await p.waitForTimeout(400); await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        ok(S.saves.length === 1 && S.saves[0].rows.length === 1 && S.saves[0].rows[0].checked.pno === 'B1' && S.saves[0].rows[0].boxes[0].m === '택배함에 넣어주세요' && S.deleted.has(535), '주문 2건 중 첫째만 고름 = 그 주문(pno B1) 줄 하나만 저장', S.saves[0] && S.saves[0].rows.map(x => x.checked.pno));
        await X.cx.close();

        // ── 6. 붙여 넣기 결과(한 줄) ──
        console.log('6 붙여 넣기 결과 카드(한 줄)');
        reset(); X = await newPage('new'); p = X.p;
        await paste(p, K(601) + ' 현관번호 1212', [pv(601, '현관번호 1212')]);
        bd = await band(p);
        ok(!!bd && bd.btns.join('|') === '배송메세지로 넣기|이대로 저장', '정리 결과 카드(한 줄) = 띠 + 두 단추', bd);
        await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(600);
        st = await p.evaluate(() => ({ note: document.querySelector('#om-card .om-smb-n').textContent, m: [...document.querySelectorAll('#om-card [data-cact="bxf"][data-k="m"]')].map(i => i.value), raw: document.getElementById('om-raw').value }));
        ok(st.m.join() === '현관번호 1212' && !/옛 줄/.test(st.note) && st.raw !== '', '고객정보수정 판 = 글 미리 채움 · 저장 전이라 넣기 칸 글은 그대로', st);
        await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        sv = S.saves[0] && S.saves[0].rows[0];
        ok(S.saves.length === 1 && sv.boxes[0].m === '현관번호 1212' && sv.checked.pno === PNO(601) && S.deleted.size === 0 && S.puts.length === 0 && (await p.evaluate(() => document.getElementById('om-raw').value)) === '', '저장 = 박스별 줄 POST 1건 · 지움 0 · 넣기 칸 비움', sv);
        await X.cx.close();
        // 한 줄 [이대로 저장] = HEAD 저장과 같은 POST
        reset(); const O2 = await newPage('old'), N2 = await newPage('new');
        await paste(O2.p, K(601) + ' 현관번호 1212', [pv(601, '현관번호 1212')]); S.saves = []; await O2.p.click('#om-card-save'); await O2.p.waitForSelector('#om-card', { state: 'hidden' }); await O2.p.waitForTimeout(600); const so = strip(S.saves);
        await paste(N2.p, K(601) + ' 현관번호 1212', [pv(601, '현관번호 1212')]); S.saves = []; await N2.p.click('#om-card .om-smb [data-cact="smkeep"]'); await N2.p.waitForSelector('#om-card', { state: 'hidden' }); await N2.p.waitForTimeout(600); const sn = strip(S.saves);
        ok(so.length === 1 && JSON.stringify(so) === JSON.stringify(sn), '정리 결과 [이대로 저장] = HEAD 저장과 같은 POST 본문', { so, sn });
        await O2.cx.close(); await N2.cx.close();

        // ── 7. 붙여 넣기 결과(여러 줄) = 눌러 두고 [저장] ──
        console.log('7 붙여 넣기 결과 카드(여러 줄)');
        reset(); X = await newPage('new'); p = X.p;
        await paste(p, 'x', [pv(602, '문 앞에 놔주세요'), pv(603, '보내는이 홍길동')]);
        bd = await band(p);
        ok(!!bd && bd.btns.join('|') === '배송메세지로 넣기' && /그대로 두려면 아래 \[저장\]/.test(bd.hint), '여러 줄 카드 = 띠 + [배송메세지로 넣기] 하나(이대로는 아래 [저장])', bd);
        await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForTimeout(300); bd = await band(p);
        ok(bd.btns.join() === '배송메세지로 넣기 취소' && /이 줄도 보통 줄로 먼저 저장하고/.test(bd.hint) && /그 판을 닫으면 보통 줄로 남아요/.test(bd.hint) && S.saves.length === 0, '누름 = 대기 표시(취소 가능) · 아직 저장 0', bd);
        await p.click('#om-card-save'); await p.waitForSelector('#om-card .om-ce', { timeout: 8000 }); await p.waitForTimeout(900);
        ok(S.saves.length === 1 && S.saves[0].rows.length === 2 && S.saves[0].rows.map(r => r.note).join('|') === '문 앞에 놔주세요|보내는이 홍길동' && !S.saves[0].rows[0].boxes, 'B1 [저장] = 현관 글 줄도 보통 줄로 먼저 저장(두 줄 다 · 종전 꼴)', S.saves[0] && S.saves[0].rows.map(r => r.note));
        ok(/닫으면 보통 줄로 남아요/.test(await p.evaluate(() => document.querySelector('#om-card .om-smb-n').textContent)), 'B1 이어 뜬 판 안내 = 「닫으면 보통 줄로 남아요」');
        st = await p.evaluate(() => ({ h: document.querySelector('#om-card-t').textContent, fix: document.querySelectorAll('#om-card [data-cact="cefix"]').length, m: document.querySelectorAll('#om-card [data-cact="bxf"][data-k="m"]').length }));
        ok(/고객정보수정/.test(st.h) && st.fix === 1 && st.m === 0, '이어서 고객정보수정 판 · 3박스 주문이라 미리 안 고름(주문 고르기)', st);
        await p.click('#om-card [data-cact="cefix"]'); await p.waitForTimeout(400);
        st = await p.evaluate(() => [...document.querySelectorAll('#om-card [data-cact="bxf"][data-k="m"]')].map(i => i.value));
        ok(st.length === 3 && st.every(v => v === '문 앞에 놔주세요'), '[고치기] = 3박스 배송메세지 칸 모두에 글', st);
        await p.click('#om-card-save'); await p.waitForSelector('#om-card', { state: 'hidden' }); await p.waitForTimeout(900);
        sv = S.saves[1] && S.saves[1].rows[0];
        ok(S.saves.length === 2 && sv.boxes.length === 3 && sv.boxes.every(b => b.m === '문 앞에 놔주세요') && sv.checked.pno === PNO(602) && S.deleted.has(900) && S.deleted.size === 1, '저장 = 박스별 줄(3박스 · pno) POST · 먼저 저장해 둔 보통 줄(가짜 id 900)만 지움', { sv, del: [...S.deleted] });
        await X.cx.close();
        // B1 = 이어 뜬 판을 × · Esc · 뒤로가기로 닫음 / 주문 못 찾음 = 보통 줄이 서버에 남음(지움 0)
        for (const how of ['×', 'Esc', '뒤로가기', '주문 못 찾음']) {
            reset(); if (how === '주문 못 찾음') S.lookup = {}; X = await newPage('new'); p = X.p;
            await paste(p, 'x', [pv(602, '문 앞에 놔주세요'), pv(603, '보내는이 홍길동')]);
            await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForTimeout(300); await p.click('#om-card-save'); await p.waitForSelector('#om-card .om-ce', { timeout: 8000 }); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(900);
            const nt = await p.evaluate(() => document.querySelector('#om-card .om-smb-n').textContent);
            if (how === '주문 못 찾음') ok(/주문을 못 찾아 배송메세지로 넣지 못했어요 · 닫으면 보통 줄로 남아요/.test(nt), 'B1 주문 못 찾음 = 「넣지 못했어요 · 닫으면 보통 줄로 남아요」', nt);
            if (how === 'Esc') await p.keyboard.press('Escape'); else if (how === '뒤로가기') await p.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => null); else await p.click('#om-card .om-back[data-cact="cancel"]');
            await p.waitForTimeout(900);
            const gone = await p.evaluate(() => { const c = document.getElementById('om-card'); return !c || c.hidden; });
            ok(gone && S.saves.length === 1 && S.saves[0].rows.some(r => r.note === '문 앞에 놔주세요' && !r.boxes) && S.deleted.size === 0 && S.puts.length === 0, `B1 판을 ${how}(으)로 닫음 = 묻지 않고 닫힘 · 현관 글은 보통 줄로 서버에 남음(지움 0)`, { gone, saves: S.saves.map(x => x.rows.map(r => r.note)), del: [...S.deleted] });
            await X.cx.close();
        }
        // B1 = 두 줄을 눌러 둠 → 첫 판을 닫아도 둘 다 보통 줄로 남음 / 첫 판을 저장하면 둘째 판이 이어 뜸
        for (const first of ['닫음', '저장']) {
            reset(); X = await newPage('new'); p = X.p;
            await paste(p, 'x', [pv(601, '경비실에 맡겨주세요'), pv(602, '문 앞에 놔주세요'), pv(603, '보내는이 홍길동')]);
            for (const ri of [0, 1]) { await p.click(`#om-card .om-smb [data-cact="smgo"][data-ri="${ri}"]`); await p.waitForTimeout(200); }
            await p.click('#om-card-save'); await p.waitForSelector('#om-card .om-ce', { timeout: 8000 }); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(900);
            const saved3 = S.saves.length === 1 && S.saves[0].rows.length === 3 && S.saves[0].rows.every(r => !r.boxes);
            if (first === '닫음') {
                await p.click('#om-card .om-back[data-cact="cancel"]'); await p.waitForTimeout(900);
                const gone = await p.evaluate(() => { const c = document.getElementById('om-card'); return !c || c.hidden; });
                ok(saved3 && gone && S.saves.length === 1 && S.deleted.size === 0, 'B1 두 줄 눌러 둠 → 첫 판을 닫음 = 세 줄 다 보통 줄로 저장돼 있음 · 지움 0 · 다음 판 안 뜸', { saves: S.saves.map(x => x.rows.length), del: [...S.deleted] });
            } else {
                await p.click('#om-card-save'); await p.waitForTimeout(1500); await p.waitForSelector('#om-card .om-ce', { timeout: 8000 }); await p.waitForTimeout(900);
                const h2 = await p.evaluate(() => document.querySelector('#om-card .om-rowcard h4').textContent);
                ok(saved3 && S.saves.length === 2 && S.saves[1].rows[0].boxes[0].m === '경비실에 맡겨주세요' && S.deleted.has(900) && S.deleted.size === 1 && /0602/.test(h2), 'B1 두 줄 눌러 둠 → 첫 판 저장 = 첫 글 박스별 줄 + 그 보통 줄만 지움 → 둘째 번호 판이 이어 뜸', { h2, del: [...S.deleted] });
                await p.click('#om-card .om-back[data-cact="cancel"]'); await p.waitForTimeout(900);
                ok(S.saves.length === 2 && S.deleted.size === 1, 'B1 둘째 판을 닫음 = 둘째 글은 보통 줄로 남음(지움 그대로 1)', [...S.deleted]);
            }
            await X.cx.close();
        }
        // 여러 줄 · 안 누르고 저장 = HEAD 와 같은 POST
        reset(); const O3 = await newPage('old'), N3 = await newPage('new');
        for (const [pp, key] of [[O3.p, 'o'], [N3.p, 'n']]) { await paste(pp, 'x', [pv(602, '문 앞에 놔주세요'), pv(603, '보내는이 홍길동')]); S.saves = []; await pp.click('#om-card-save'); await pp.waitForSelector('#om-card', { state: 'hidden' }); await pp.waitForTimeout(600); S['_' + key] = strip(S.saves); }
        ok(S._o.length === 1 && S._o[0].rows.length === 2 && JSON.stringify(S._o) === JSON.stringify(S._n), '여러 줄 · 안 누르고 [저장] = HEAD 와 같은 POST(두 줄)', { o: S._o, n: S._n });
        await O3.cx.close(); await N3.cx.close();

        // ── 8. 직접 입력(치는 중엔 안 바뀜 · 칸을 떠나면 띠) · 주문 못 찾음 ──
        console.log('8 직접 입력 · 주문 못 찾음');
        reset(); X = await newPage('new'); p = X.p;
        await openEdit(p, '508');
        ok(!(await band(p)), '빈 글 줄 카드 = 띠 없음');
        await p.click('#om-f-0-note'); await p.keyboard.type('경비실에 맡겨주세요'); await p.waitForTimeout(500);
        const typing = await p.evaluate(() => ({ band: !!document.querySelector('#om-card .om-smb'), v: document.getElementById('om-f-0-note').value, focus: document.activeElement && document.activeElement.id }));
        ok(!typing.band && typing.v === '경비실에 맡겨주세요' && typing.focus === 'om-f-0-note', '치는 중 = 띠 안 뜸 · 칸 값·초점 그대로', typing);
        await p.keyboard.press('Tab'); await p.waitForTimeout(700);
        bd = await band(p);
        ok(!!bd && bd.btns.join('|') === '배송메세지로 넣기|이대로 저장' && (await p.evaluate(() => document.getElementById('om-f-0-note').value)) === '경비실에 맡겨주세요', '칸을 떠난 뒤 = 띠 뜸 · 칸 값 그대로', bd);
        await p.click('#om-f-0-note'); await p.keyboard.press('Control+A'); await p.keyboard.type('20일 발송'); await p.keyboard.press('Tab'); await p.waitForTimeout(700);
        ok(!(await band(p)), '글을 날짜 글로 바꾸고 떠남 = 띠 사라짐');
        await closeCard(p);
        S.lookup = {};   // 주문 못 찾음
        await openEdit(p, '504'); await p.click('#om-card .om-smb [data-cact="smgo"]'); await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(400);
        st = await p.evaluate(() => document.querySelector('#om-card .om-smb-n').textContent);
        ok(/주문을 못 찾아 배송메세지로 넣지 못했어요 · 닫으면 보통 줄로 남아요/.test(st), '주문 못 찾음 = 「넣지 못했어요 · 닫으면 보통 줄로 남아요」', st);
        await closeCard(p);
        ok(S.saves.length === 0 && S.deleted.size === 0 && !!(await listOf(p))['504'], '닫음 = 서버 쓰기 0 · 줄 504 그대로');
        await X.cx.close();

        // ── 9. 폰 390 · 폴드 펼침(720·884) = 넘침 0 · 누름 자리 44 · 터치 tap · 뒤로가기 한 겹 ──
        console.log('9 폰·폴드 폭(넘침·누름 자리·tap·뒤로가기)');
        for (const [w, h] of [[390, 844], [720, 900], [884, 1000]]) {
            reset(); X = await newPage('new', { viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }); p = X.p;
            const pill = await p.evaluate(() => { const li = document.querySelector('#om-list .om-ml[data-id="504"]'), pl = li.querySelector('.k-nosm'), r = pl.getBoundingClientRect(), lr = li.getBoundingClientRect(), t = document.querySelector('#om-list .om-ml[data-id="502"] .om-ml-l').getBoundingClientRect(); return { in: r.left >= lr.left - 0.5 && r.right <= lr.right + 0.5, doc: document.documentElement.scrollWidth <= window.innerWidth, t502: t.right <= window.innerWidth + 0.5 }; });
            ok(pill.in && pill.doc && pill.t502, `폭 ${w} 목록 = 알약·1박스 글이 줄 안 · 가로 넘침 0`, pill);
            { const L0 = p.locator('#om-list .om-ml[data-id="504"] .om-ml-t'); await L0.scrollIntoViewIfNeeded(); await p.waitForTimeout(200); const b = await L0.boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } await p.waitForSelector('#om-card:not([hidden]) .om-smb'); await p.waitForTimeout(900);
            const m = await p.evaluate(() => { const c = document.getElementById('om-card'), cb = c.querySelector('.om-card-b'), b = c.querySelector('.om-smb'), cr = c.getBoundingClientRect(), br = b.getBoundingClientRect(); const bt = [...b.querySelectorAll('button')].map(x => { const r = x.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), in: r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5 }; }); return { over: cb.scrollWidth - cb.clientWidth, doc: document.documentElement.scrollWidth - window.innerWidth, in: br.left >= cr.left - 0.5 && br.right <= cr.right + 0.5, bt }; });
            ok(m.over <= 0 && m.doc <= 0 && m.in && m.bt.length === 2 && m.bt.every(x => x.in && x.h >= 44 && x.w >= 44), `폭 ${w} 줄 카드 띠 = 넘침 0 · 단추 2개 높이 44 이상`, m);
            { const L1 = p.locator('#om-card .om-smb [data-cact="smgo"]'); await L1.scrollIntoViewIfNeeded(); await p.waitForTimeout(200); const b = await L1.boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } await p.waitForSelector('#om-card .om-smb-n'); await p.waitForTimeout(900);
            const m2 = await p.evaluate(() => { const c = document.getElementById('om-card'), cb = c.querySelector('.om-card-b'), n = c.querySelector('.om-smb-n').getBoundingClientRect(), cr = c.getBoundingClientRect(); return { over: cb.scrollWidth - cb.clientWidth, doc: document.documentElement.scrollWidth - window.innerWidth, in: n.left >= cr.left - 0.5 && n.right <= cr.right + 0.5, m: [...c.querySelectorAll('[data-cact="bxf"][data-k="m"]')].map(i => i.value), hb: (window.AkmAoDesk._hb.stack || []).map(e => e.k).join(',') }; });
            ok(m2.over <= 0 && m2.doc <= 0 && m2.in && m2.m.join() === DOOR, `폭 ${w} tap [배송메세지로 넣기] = 고객정보수정 판 · 글 미리 · 넘침 0`, m2);
            // 뒤로가기 = 카드만 닫힘 → 목록 → 메모함 닫힘(한 번에 한 겹 · 손 없이 쌓은 기록 칸 0)
            const lay = () => p.evaluate(() => { if (location.pathname === '/away' || !window.AkmAoDesk) return '떠남'; const q = id => document.getElementById(id), vis = id => !!(q(id) && !q(id).hidden); return [vis('desk-om') ? '메모함' : '', vis('om-card') ? '카드' : ''].filter(Boolean).join('>') || '없음'; });
            const back = async () => { await p.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => null); await p.waitForTimeout(900); return lay(); };
            const a0 = await lay(), a1 = await back(), a2 = await back(), a3 = await back(), na = await p.evaluate(() => (window.__noAct || []).slice()).catch(() => []);
            ok(a0 === '메모함>카드' && a1 === '메모함' && a2 === '없음' && a3 === '떠남' && na.length === 0 && S.saves.length === 0 && S.deleted.size === 0, `폭 ${w} 뒤로가기 = 카드 → 목록 → 메모함 닫힘 → 떠남(한 겹씩 · 손 없이 쌓은 칸 0 · 쓰기 0)`, { a0, a1, a2, a3, na });
            await X.cx.close();
        }
        // 야간 = 알약·띠 글자 대비
        reset(); X = await newPage('new'); p = X.p;
        await p.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
        const lum = c => { const a = c.match(/[\d.]+/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
        const dk = await p.evaluate(() => { const pl = document.querySelector('#om-list .k-nosm'), cs = getComputedStyle(pl); return { fg: cs.color, bg: cs.backgroundColor }; });
        ok(/251, 191, 74/.test(dk.fg) && /251, 191, 74/.test(dk.bg), '야간 = 알약이 야간 호박색 줄을 탐', dk);
        await p.evaluate(() => document.documentElement.removeAttribute('data-ao-theme'));
        const lt = await p.evaluate(() => { const pl = document.querySelector('#om-list .k-nosm'), cs = getComputedStyle(pl); return { fg: cs.color, bg: cs.backgroundColor }; });
        const cr = (lum(lt.bg) + 0.05) / (lum(lt.fg) + 0.05);
        ok(cr >= 4.5, `주간 알약 글자 대비 ${cr.toFixed(1)}:1 (4.5 이상)`, lt);
        await X.cx.close();
        ok(pe.length === 0, '화면 오류(pageerror) 0', pe.slice(0, 3));
    } catch (e) { failN++; console.log('  ❌ 실행 오류', e && e.stack || e); }
    await browser.close(); await new Promise(r => srv.close(r));
    console.log(`\n#1188 검증: ${pass}/${pass + failN} 통과` + (failN ? ` · 실패 ${failN}` : ''));
    process.exit(failN ? 1 : 0);
})();
