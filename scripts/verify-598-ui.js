// #598 창구 비용 줄이기(화면) 검증 — B 되묻기 카드 [이대로 진행] · C 중간발주 「직접 추가」
//   로컬 서버(포트 PORT598 · 없으면 3463) · 쓰기 전부 가로챔(DB 쓰기 0) · 지시 목록(/api/agent-office/desk/orders)과 3채널 주문은 이 파일의 가짜 응답.
//   단가표 카탈로그(/api/invoice/catalog)는 실DB 읽기. 「추가 0 = 종전과 동일」은 git HEAD 의 ao-desk.js 로 그린 PNG 와 바이트 비교.
//   사용: node scripts/verify-598-ui.js
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js'));
const PORT = parseInt(process.env.PORT598, 10) || 3463;
const PC = { width: 1440, height: 900 }, PH = { width: 390, height: 844 };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const kstDay = off => new Date(Date.now() + 9 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
const GO = '[이대로 진행]';
const CMD = 'scripts/desk/holiday.js add 2026-10-12';   // plan.cmds 안의 글 — 화면 어디에도 보이면 안 된다
const LONG = '하우스감귤 로얄과 4kg 행사 옵션을 자사몰 감귤 페이지와 대용량 페이지 두 곳 모두에 같은 추가금으로 넣고 스냅샷을 다시 받아 스킨까지 올리기';

const NAVER_ROWS = [
    { '옵션정보': '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(로얄과)', '수량': 3, '배송메세지': '' },
    { '옵션정보': '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(로얄과)', '수량': 2, '배송메세지': 'S사이즈로 부탁드려요' },
    { '옵션정보': '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(소과)', '수량': 4, '배송메세지': '문 앞' },
    { '옵션정보': '아꼼이네 상품선택: 2. 황금향 / 상품 및 과수: 황금향 선물용 - 3kg', '수량': 1, '배송메세지': '' },
    { '옵션정보': '이 세상에 없는 품목 99kg', '수량': 5, '배송메세지': '' },
];
const CP_ROWS = [{ '노출상품명(옵션명)': '하우스감귤 가정용 - 4.5kg(로얄과)', '구매수(수량)': 1, '배송메세지': '' }];
const CF_ROWS = [{ '주문상품명(세트상품 포함)': '1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 2.5kg(소과)', '수량': 2, '배송메시지': '' }];

function seed(user) {
    const t = m => new Date(Date.now() - m * 60000).toISOString();
    const base = (id, m, content, status, result) => ({ id, content, status, result, run_id: null, created_at: t(m), processed_at: t(m - 1), created_by: user.name + ' ' + (user.position || ''), created_by_id: user.id, mine_hidden: false, reply_to: null, has_image: false, steps: [] });
    return [
        base(9001, 50, '10/12 발송 쉬는 날로 넣어줘', '질문', { type: 'clarify', question: '10/12(월)을 발송휴무일로 등록할까요?', summary: '확인 필요', by: 'desk', plan: { label: '발송휴무일 10/12 등록', cmds: [['node', CMD]] } }),
        base(9002, 40, '귤 가격 좀 봐줘', '질문', { type: 'clarify', question: '어느 옵션 가격을 말씀하시는 건가요?', summary: '확인 필요', by: 'desk' }),
        base(9003, 30, '안내문 바꿔줘', '질문', { type: 'clarify', question: '어느 품목 안내문인가요?', summary: '확인 필요', by: 'desk', plan: { label: '   ', cmds: [['node', CMD]] } }),
        base(9004, 20, '4kg 행사 옵션 자사몰에도 넣어줘', '질문', { type: 'clarify', question: '두 페이지 모두에 넣을까요?', summary: '확인 필요', by: 'desk', plan: { label: LONG, cmds: [['node', CMD]] } }),
        base(9006, 15, '정산 확인', '질문', { type: 'other_kind', question: '다른 종류의 되묻기', plan: { label: '다른 종류', cmds: [['node', CMD]] } }),
        base(9005, 10, '쿠폰 만들어줘', '승인대기', { type: 'approval_request', action: 'coupon', summary: '3천원 쿠폰', impact: '전 회원', plan: '쿠폰을 발급합니다' }),
    ];
}
function routesFor(state, user) {
    return async pg => {
        const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
        await pg.route('**/api/agent-office/desk/orders*', route => json(route, { orders: state.orders.slice().sort((a, b) => b.id - a.id) }));
        await pg.route('**/api/agent-office/orders/*/reply', route => {
            const rq = route.request(), id = Number(new URL(rq.url()).pathname.split('/').slice(-2)[0]);
            let body = null; try { body = rq.postDataJSON(); } catch (e) { }
            state.replies.push({ id, body, raw: rq.postData() });
            const q = state.orders.find(o => o.id === id); if (q) q.status = '질문종결';
            const o = Object.assign({}, seed(user)[0], { id: 9100 + state.replies.length, content: body && body.content, status: '대기', result: null, reply_to: id, created_at: new Date().toISOString(), processed_at: null });
            state.orders.push(o);
            return json(route, { message: '답을 보냈어요', order: o });
        });
        const orders = rows => ({ ok: true, count: rows.length, rows, partial_adjusted: 0 });
        await pg.route('**/api/agent-office/naver/invoice-orders*', route => json(route, orders(NAVER_ROWS)));
        await pg.route('**/api/agent-office/coupang/invoice-orders*', route => json(route, orders(CP_ROWS)));
        await pg.route('**/api/agent-office/cafe24/invoice-orders*', route => json(route, orders(CF_ROWS)));
    };
}
const overflow = pg => pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
const watchToasts = pg => pg.evaluate(() => { new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && /toast/i.test(n.className || '')) window.__toast(n.textContent.trim()); }))).observe(document.body, { childList: true, subtree: true }); });
// 중간발주 카드를 열고 그림이 다 뜰 때까지
async function openQty(pg) {
    await pg.evaluate(() => document.getElementById('desk-qty-now').scrollIntoView({ block: 'center', inline: 'center' }));
    await pg.click('#desk-qty-now');
    await pg.waitForFunction(() => document.querySelectorAll('#qty-out .qty-fig img').length > 0 && document.getElementById('qty-prog').hidden, null, { timeout: 40000 }).catch(() => { });
    await pg.waitForFunction(() => Array.from(document.querySelectorAll('#qty-out .qty-fig img')).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => { });
}
async function figs(pg) {
    await pg.waitForFunction(() => Array.from(document.querySelectorAll('#qty-out .qty-fig img')).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => { });
    const raw = await pg.evaluate(async () => {
        const out = [];
        for (const f of document.querySelectorAll('#qty-out .qty-fig')) {
            const img = f.querySelector('img'); const buf = new Uint8Array(await (await fetch(img.src)).arrayBuffer()); let s = ''; buf.forEach(c => s += String.fromCharCode(c));
            out.push({ title: f.querySelector('figcaption b').textContent, sub: f.querySelector('figcaption > span').textContent, nw: img.naturalWidth, nh: img.naturalHeight, b64: btoa(s), same: f.querySelector('a[download]').href === img.src });
        }
        return out;
    });
    return raw.map(f => ({ title: f.title, sub: f.sub, nw: f.nw, nh: f.nh, same: f.same, hash: crypto.createHash('sha1').update(Buffer.from(f.b64, 'base64')).digest('hex').slice(0, 12) }));
}
const sig = fs => fs.map(f => `${f.title}|${f.sub}|${f.nw}x${f.nh}|${f.hash}`).join('\n');
const stored = pg => pg.evaluate(() => { try { return JSON.parse(sessionStorage.getItem('akm_qty_extra') || 'null'); } catch (e) { return 'bad'; } });

(async () => {
    const h = await H.start(PORT, 'v598');
    try {
        const CASES = [['대표 PC', h.users.대표, PC, false, null], ['직원 PC', h.users.직원, PC, false, null], ['직원 폰', h.users.직원, PH, true, null], ['대표 PC 야간', h.users.대표, PC, false, 'dark'], ['직원 폰 야간', h.users.직원, PH, true, 'dark']];
        for (const [label, user, vw, phone, theme] of CASES) {
            // ───────── B. 되묻기 카드 [이대로 진행]
            console.log('\n■ #598-B [이대로 진행] — ' + label);
            const st = { orders: seed(user), replies: [] };
            const P = await h.open(user, vw, { phone, page: 'agent-office', theme, routes: routesFor(st, user) }); const pg = P.pg;
            const toasts = []; await pg.exposeFunction('__toast', t => toasts.push(t)); await watchToasts(pg);
            await pg.waitForFunction(() => document.querySelectorAll('#desk-list [data-act="plango"]').length > 0, null, { timeout: 15000 }).catch(() => { });
            const b = await pg.evaluate(() => {
                const bs = Array.from(document.querySelectorAll('#desk-list [data-act="plango"]'));
                const list = document.getElementById('desk-list');
                return { n: bs.length, items: bs.map(x => { const r = x.getBoundingClientRect(); return { id: x.dataset.id, text: x.textContent, h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right), cls: x.className, next: x.closest('.desk-plan').nextElementSibling ? x.closest('.desk-plan').nextElementSibling.className : '', prev: x.closest('.desk-plan').previousElementSibling ? x.closest('.desk-plan').previousElementSibling.textContent : '' }; }), html: list.innerHTML, text: list.innerText, cbox: list.querySelectorAll('.desk-cbox').length, appr: /쿠폰을 발급합니다/.test(list.innerText) };
            });
            const b1 = b.items.find(x => x.id === '9001'), b4 = b.items.find(x => x.id === '9004');
            ok(b.n === 2 && !!b1 && !!b4, `버튼은 plan.label 이 있는 되묻기에만(${b.items.map(x => x.id + '번').join(' · ')}) — plan 없음(9002)·label 빈칸(9003)·type 이 clarify 가 아님(9006)·승인 요청의 글자 plan(9005)에는 없음`);
            ok(b1 && b1.text === '이대로 진행 · 발송휴무일 10/12 등록', `글 = 「${b1 && b1.text}」`);
            ok(b1 && /10\/12\(월\)을 발송휴무일로/.test(b1.prev) && /desk-cbox|desk-reply/.test(b1.next), `자리 = 질문 글 바로 아래 · 답 칸 바로 위(다음 = ${b1 && b1.next.split(' ').slice(0, 2).join('.')}) · 답 칸 ${b.cbox}개`);
            ok(b.items.every(x => x.h >= 44 && x.l >= 0 && x.r <= vw.width), `높이 ${b.items.map(x => x.h).join('·')}px(44 이상) · 화면 안(${b.items.map(x => x.l + '~' + x.r).join(' / ')})`);
            ok(b4 && b4.text === '이대로 진행 · ' + LONG.slice(0, 60) + '…' && (await overflow(pg)) <= vw.width, `긴 label 은 60자에서 줄임(${b4 && b4.text.length}자) · 가로 넘침 ${await overflow(pg)} ≤ ${vw.width}`);
            ok(!b.html.includes('holiday.js') && !b.text.includes('holiday.js'), 'plan.cmds 는 화면(글·속성)에 없음');
            if (theme) { const a = await H.audit(pg, '#desk-list'); ok(a.fails.length === 0, `야간 대비 미달 ${a.fails.length}(글자 ${a.texts}개)${a.fails.length ? ' — ' + a.fails.slice(0, 3).join(' / ') : ''}`); }
            // 답 칸에 다른 글이 적혀 있어도 고정 글만 간다
            await pg.evaluate(() => { const ta = document.getElementById('reply-9001'); if (ta) { ta.value = '아니 13일로'; ta.dispatchEvent(new Event('input', { bubbles: true })); } });
            await pg.evaluate(() => document.querySelector('#desk-list [data-act="plango"][data-id="9001"]').scrollIntoView({ block: 'center' }));
            await pg.click('#desk-list [data-act="plango"][data-id="9001"]');
            await pg.waitForFunction(() => !document.querySelector('#desk-list [data-act="plango"][data-id="9001"]'), null, { timeout: 10000 }).catch(() => { });
            await pg.waitForTimeout(500);
            const r0 = st.replies[0] || {};
            ok(st.replies.length === 1 && r0.id === 9001, `누르면 POST 1회 · 주소 = /orders/9001/reply(원 지시 id = reply_to)`);
            ok(r0.raw === JSON.stringify({ content: GO }) && r0.body && r0.body.content === GO && r0.body.content.length === 8, `보낸 글 = 정확히 「${r0.body && r0.body.content}」(다른 칸 없음 · 답 칸에 적던 글·이미지 안 섞임) — ${r0.raw}`);
            const a1 = await pg.evaluate(() => ({ n: document.querySelectorAll('#desk-list [data-act="plango"]').length, text: document.getElementById('desk-list').innerText }));
            ok(a1.n === 1 && a1.text.includes('[이대로 진행]') && toasts.some(t => /답을 보냈어요/.test(t)), `보낸 뒤 = 그 질문의 버튼 사라짐(남은 버튼 ${a1.n}) · 새 카드에 「[이대로 진행]」 · 토스트 「${toasts[toasts.length - 1]}」`);
            // 종전 답 길(직접 적어 보내기)은 그대로
            await pg.evaluate(() => { const ta = document.getElementById('reply-9002'); ta.scrollIntoView({ block: 'center' }); ta.focus(); });
            await pg.fill('#reply-9002', '아니오, 4.5kg 로얄과요'); await pg.click('#desk-list [data-act="sendreply"][data-id="9002"]');
            await pg.waitForFunction(() => !document.getElementById('reply-9002') || !document.getElementById('reply-9002').value, null, { timeout: 10000 }).catch(() => { });
            await pg.waitForTimeout(300);
            ok(st.replies.length === 2 && st.replies[1].id === 9002 && st.replies[1].body.content === '아니오, 4.5kg 로얄과요', `「아니오」는 종전 길 그대로(답 칸에 적어 보내기 → 「${st.replies[1] && st.replies[1].body.content}」)`);
            if (user.position === '대표') {   // 이전 채팅 이력 탭에서는 답을 못 보내므로 버튼도 없다
                st.orders = seed(user);
                await pg.click('#desk-tab-all'); await pg.waitForTimeout(1500);
                const al = await pg.evaluate(() => ({ n: document.querySelectorAll('#desk-list [data-act="plango"]').length, sel: document.getElementById('desk-tab-all').getAttribute('aria-selected') }));
                ok(al.sel === 'true' && al.n === 0, `「이전 채팅 이력」 탭에는 버튼 없음(${al.n})`);
                await pg.click('.desk-tab[data-tab="mine"]'); await pg.waitForTimeout(800);
            }
            ok(P.errors.length === 0 && P.writes.length === 0, `화면 오류 ${P.errors.length}${P.errors.length ? ' — ' + P.errors[0].slice(0, 140) : ''} · 가짜 응답 밖 쓰기 ${P.writes.length}`);

            // ───────── C. 중간발주 「직접 추가」
            console.log('■ #598-C 중간발주 직접 추가 — ' + label);
            await pg.evaluate(() => sessionStorage.removeItem('akm_qty_extra'));
            await openQty(pg);
            const f0 = await figs(pg);
            if (label === '대표 PC' || label === '직원 폰') {   // 추가 0 = 종전(git HEAD 의 ao-desk.js)과 같은 그림
                const O = await h.open(user, vw, { phone, page: 'agent-office', theme, old: true, routes: routesFor({ orders: [], replies: [] }, user) });
                await openQty(O.pg); const fo = await figs(O.pg); await O.ctx.close();
                ok(f0.length >= 2 && sig(f0) === sig(fo), `추가 행 0 = 종전과 같음 — 그림 ${f0.length}장 제목·글·크기·PNG 바이트 동일(${f0.map(f => f.title + ' ' + f.hash).join(' · ')})`);
            }
            const e0 = await pg.evaluate(() => { const d = document.getElementById('qty-extra'), s = d && d.querySelector('summary'); return d ? { open: d.open, sumH: Math.round(s.getBoundingClientRect().height), sum: s.textContent.trim(), rows: d.querySelectorAll('.qty-xrow').length, after: !!(d.previousElementSibling && d.previousElementSibling.id === 'qty-figs') } : null; });
            ok(e0 && !e0.open && e0.rows === 0 && e0.sum === '직접 추가' && e0.sumH >= 44 && e0.after, `그림 아래 「직접 추가」 접이식 — 처음엔 닫힘 · 행 0 · 누름 칸 ${e0 && e0.sumH}px`);
            await pg.click('#qty-extra > summary'); await pg.click('#qty-extra-add');
            // 기대값: 화면이 쓰는 함수(app.js)로 같은 자료를 다시 계산
            const exp = await pg.evaluate(([nv, cp, cf]) => {
                const lines = []; const add = (opt, memo, qty) => lines.push({ opt: addSizeSuffix(String(opt || ''), String(memo || '').trim()), qty: parseInt(qty) || 1 });
                nv.forEach(r => add(r['옵션정보'], r['배송메세지'], r['수량'])); cf.forEach(r => add(r['주문상품명(세트상품 포함)'], r['배송메시지'], r['수량'])); cp.forEach(r => add(r['노출상품명(옵션명)'], r['배송메세지'], r['구매수(수량)']));
                const by = {};
                for (const g of lines) {
                    const sm = /^(.*?)\s+(2S|S|M)사이즈로!$/.exec(g.opt); let name = matchProduct(sm ? sm[1] : g.opt); if (name.startsWith('[미매칭]')) continue;
                    const plain = name; if (sm) name += ' ' + sm[2] + '사이즈로!';
                    const p = aoItemPartner(plain) || '기타'; (by[p] = by[p] || { total: 0, names: [], plain: [] }); by[p].total += g.qty; if (!by[p].names.includes(name)) by[p].names.push(name); if (!sm && !by[p].plain.includes(plain)) by[p].plain.push(plain);
                }
                const cat = Object.fromEntries(Object.entries(aoInvoicePricingByPartner).map(([p, s]) => [p, [...s]]));
                return { by, partners: Object.keys(cat).sort((a, b) => a.localeCompare(b, 'ko')), cat };
            }, [NAVER_ROWS, CP_ROWS, CF_ROWS]);
            const TP = Object.keys(exp.by).find(p => p !== '기타' && exp.by[p].plain.length);   // 시험할 거래처 = 집계에 줄이 있는 단가표 거래처
            const N1 = TP && exp.by[TP].plain[0];
            const row0 = await pg.evaluate(() => { const r = document.querySelector('.qty-xrow[data-i="0"]'); if (!r) return null; const hs = Array.from(r.querySelectorAll('select, input, button')).map(x => Math.round(x.getBoundingClientRect().height)); return { ps: Array.from(r.querySelectorAll('.qty-xp option')).map(o => o.value), p: r.querySelector('.qty-xp').value, ns: Array.from(r.querySelectorAll('.qty-xn option')).map(o => o.value), free: !!r.querySelector('.qty-xf'), minH: Math.min(...hs), n: hs.length, labels: Array.from(r.querySelectorAll('select, input, button')).every(x => x.getAttribute('aria-label')), dirty: !document.getElementById('qty-extra-dirty').hidden, focus: document.activeElement.className }; });
            ok(row0 && JSON.stringify(row0.ps) === JSON.stringify(exp.partners) && exp.partners.length >= 1, `[+ 행] → 거래처 고르기 = 단가표 거래처 ${row0 && row0.ps.length}곳(${row0 && row0.ps.join(' · ')})`);
            ok(row0 && JSON.stringify(row0.ns.slice(0, -1).sort()) === JSON.stringify((exp.cat[row0.p] || []).slice().sort()) && row0.ns[row0.ns.length - 1] === '' && !row0.free, `품목 고르기 = 「${row0 && row0.p}」 단가표 이름 ${row0 && row0.ns.length - 1}개 + 맨 끝 「단가표에 없는 품목 (직접 적기)」`);
            ok(row0 && row0.minH >= 44 && row0.labels && /qty-xp/.test(row0.focus), `행 안 칸·버튼 ${row0 && row0.n}개 높이 ${row0 && row0.minH}px 이상 · 이름표(aria-label) 있음 · 초점은 새 행 거래처로`);
            // 수량 빈칸·0 거부
            const tN = toasts.length;
            await pg.click('#qty-extra-go'); await pg.waitForTimeout(500);
            await pg.fill('.qty-xrow[data-i="0"] .qty-xq', '0'); await pg.click('#qty-extra-go'); await pg.waitForTimeout(500);
            await pg.fill('.qty-xrow[data-i="0"] .qty-xq', '1.5'); await pg.click('#qty-extra-go'); await pg.waitForTimeout(500);
            const rej = toasts.slice(tN);
            ok(rej.length === 3 && rej.every(t => t === '수량은 1 이상 숫자로 적어 주세요') && sig(await figs(pg)) === sig(f0) && (await stored(pg)) === null && await pg.evaluate(() => document.activeElement.classList.contains('qty-xq')), `수량 빈칸·0·1.5 → 거부 토스트 ${rej.length}번(「${rej[0]}」) · 그림 그대로 · 저장 없음 · 초점은 수량 칸`);
            // 1행: 집계에 이미 있는 품목 18 · 2행: 단가표에 없는 품목(글자 입력) 15
            await pg.selectOption('.qty-xrow[data-i="0"] .qty-xp', TP); await pg.waitForTimeout(150);
            await pg.selectOption('.qty-xrow[data-i="0"] .qty-xn', N1); await pg.waitForTimeout(150);
            await pg.fill('.qty-xrow[data-i="0"] .qty-xq', '18');
            await pg.click('#qty-extra-add'); await pg.waitForTimeout(150);
            const inherit = await pg.evaluate(() => document.querySelector('.qty-xrow[data-i="1"] .qty-xp').value);
            await pg.selectOption('.qty-xrow[data-i="1"] .qty-xn', ''); await pg.waitForTimeout(150);
            const freeFocus = await pg.evaluate(() => document.activeElement.classList.contains('qty-xf'));
            await pg.click('#qty-extra-go'); await pg.waitForTimeout(400);
            ok(inherit === TP && freeFocus && toasts[toasts.length - 1] === '품목 이름을 적어 주세요', `둘째 행은 앞 행 거래처(${inherit})를 이어받음 · 「직접 적기」를 고르면 글자 칸이 뜨고 초점 · 이름 빈칸이면 「${toasts[toasts.length - 1]}」`);
            await pg.fill('.qty-xrow[data-i="1"] .qty-xf', '현금건 시험품목 9kg'); await pg.fill('.qty-xrow[data-i="1"] .qty-xq', '15');
            const keep = await pg.evaluate(() => ({ q0: document.querySelector('.qty-xrow[data-i="0"] .qty-xq').value, n0: document.querySelector('.qty-xrow[data-i="0"] .qty-xn').value }));
            await pg.click('#qty-extra-go');
            await pg.waitForFunction(() => /직접 추가 33박스 포함/.test(document.getElementById('qty-figs').textContent), null, { timeout: 10000 }).catch(() => { });
            const f1 = await figs(pg);
            const o0 = f0.find(f => f.title === TP), o1 = f1.find(f => f.title === TP), B0 = exp.by[TP];
            ok(keep.q0 === '18' && keep.n0 === N1, '행을 더 넣어도 앞 행에 적은 값은 그대로');
            ok(o1 && o1.sub === `${B0.names.length + 1}종 · 합계 ${B0.total + 33}박스 · 직접 추가 33박스 포함`, `「${TP}」 그림 글 = 「${o1 && o1.sub}」(집계 ${B0.names.length}종 ${B0.total}박스 + 추가 18·15 · 이미 있는 품목은 종 수에 안 더함)`);
            const rowH = o0 ? (o0.nh / 2 - 1) / (B0.names.length + 1) : 0;
            ok(o0 && o1 && Number.isInteger(rowH) && o1.nh - o0.nh === 2 * rowH * 2 && o1.nw >= o0.nw && o1.hash !== o0.hash && o1.same, `PNG 에 줄 2개가 더 들어감 — 높이 ${o0 && o0.nh} → ${o1 && o1.nh}px(한 줄 ${rowH * 2}px × 2) · 너비 ${o0 && o0.nw} → ${o1 && o1.nw} · [내려받기] = 새 그림`);
            ok(f1.length === f0.length && f1.filter(f => f.title !== TP).every(f => { const p = f0.find(x => x.title === f.title); return p && p.hash === f.hash && p.sub === f.sub; }), `다른 그림(${f1.filter(f => f.title !== TP).map(f => f.title).join(' · ')})은 바이트 그대로`);
            // 그림 속 「(추가)」 줄: 같은 줄 집합으로 화면 함수가 직접 그린 PNG 와 바이트 비교는 내부 함수라 못 하므로 — 줄 색(주황·흰색)으로 줄 위치를 읽는다
            const px = await pg.evaluate(async ([title, rowH]) => {
                const fig = Array.from(document.querySelectorAll('#qty-out .qty-fig')).find(f => f.querySelector('figcaption b').textContent === title), img = fig.querySelector('img');
                const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
                const rows = Math.round((img.naturalHeight / 2 - 1) / rowH) - 1, ink = [];
                for (let i = 0; i <= rows; i++) { const y = (1 + i * rowH) * 2 + 4; let dark = 0; const d = g.getImageData(4, y, img.naturalWidth - 8, rowH * 2 - 8).data; for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] < 200) dark++; ink.push(dark); }
                const last = g.getImageData(6, (1 + rows * rowH) * 2 + 6, 1, 1).data;
                return { rows, ink, lastYellow: last[0] > 240 && last[1] > 240 && last[2] < 40 };
            }, [TP, rowH]);
            ok(px.rows === B0.names.length + 2 && px.ink.every(n => n > 20) && px.lastYellow, `그림 픽셀 — 품목 줄 ${px.rows}개(집계 ${B0.names.length} + 추가 2) 전부 글자가 찍힘 · 맨 아래 합계 줄 노랑`);
            const s1 = await stored(pg);
            ok(s1 && s1.day === kstDay(0) && JSON.stringify(s1.rows) === JSON.stringify([{ partner: TP, name: N1, qty: 18 }, { partner: TP, name: '현금건 시험품목 9kg', qty: 15 }]), `sessionStorage = 오늘(${s1 && s1.day}) · ${JSON.stringify(s1 && s1.rows)}`);
            const e1 = await pg.evaluate(() => ({ n: document.getElementById('qty-extra-n').textContent, dirty: !document.getElementById('qty-extra-dirty').hidden, hs: Array.from(document.querySelectorAll('#qty-extra select, #qty-extra input, #qty-extra button, #qty-extra summary')).map(x => Math.round(x.getBoundingClientRect().height)) }));
            ok(e1.n === '2행 · 33박스 들어가 있어요' && !e1.dirty && Math.min(...e1.hs) >= 44 && /직접 추가 2행을 넣어 그림을 다시 만들었어요/.test(toasts[toasts.length - 1]), `머리 「직접 추가 ${e1.n}」 · 토스트 「${toasts[toasts.length - 1]}」 · 누르는 것 ${e1.hs.length}개 전부 ${Math.min(...e1.hs)}px 이상`);
            const sw = await overflow(pg);
            ok(sw <= vw.width, `가로 넘침 없음(${sw} ≤ ${vw.width})`);
            if (theme) { const a = await H.audit(pg, '#desk-qty'); ok(a.fails.length === 0, `야간 대비 미달 ${a.fails.length}(글자 ${a.texts}개)${a.fails.length ? ' — ' + a.fails.slice(0, 3).join(' / ') : ''}`); }
            // [다시 집계] 뒤에도 그대로
            await pg.click('#qty-again'); await pg.waitForFunction(() => document.getElementById('qty-prog').hidden && /직접 추가 33박스 포함/.test((document.getElementById('qty-figs') || {}).textContent || ''), null, { timeout: 40000 }).catch(() => { });
            ok(sig(await figs(pg)) === sig(f1) && await pg.evaluate(() => document.querySelectorAll('.qty-xrow').length === 2 && document.getElementById('qty-extra').open), '[다시 집계] 뒤에도 추가 행 2개·그림 그대로');
            // 새로고침 뒤 유지
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(2200); await watchToasts(pg);
            await openQty(pg);
            const f2 = await figs(pg);
            const e2 = await pg.evaluate(() => ({ open: document.getElementById('qty-extra').open, rows: Array.from(document.querySelectorAll('.qty-xrow')).map(r => [r.querySelector('.qty-xp').value, (r.querySelector('.qty-xf') || r.querySelector('.qty-xn')).value, r.querySelector('.qty-xq').value, !!r.querySelector('.qty-xf')].join('|')), n: document.getElementById('qty-extra-n').textContent }));
            ok(sig(f2) === sig(f1) && e2.open && JSON.stringify(e2.rows) === JSON.stringify([`${TP}|${N1}|18|false`, `${TP}|현금건 시험품목 9kg|15|true`]), `새로고침 뒤 = 행 2개 그대로(${e2.rows.join(' / ')}) · 접이식 열림 · 그림 바이트 동일`);
            // 행 빼기 → 안내 → 다시 만들기
            await pg.click('.qty-xrow[data-i="0"] .qty-xx');
            const d1 = await pg.evaluate(() => ({ dirty: !document.getElementById('qty-extra-dirty').hidden, rows: document.querySelectorAll('.qty-xrow').length, focus: document.activeElement.id }));
            const stale = sig(await figs(pg)) === sig(f2);
            await pg.click('#qty-extra-go'); await pg.waitForFunction(() => /직접 추가 15박스 포함/.test(document.getElementById('qty-figs').textContent), null, { timeout: 10000 }).catch(() => { });
            const f3 = await figs(pg), o3 = f3.find(f => f.title === TP), s3 = await stored(pg);
            ok(d1.dirty && d1.rows === 1 && d1.focus === 'qty-extra-add' && stale, '[×] → 행이 빠지고 「[그림 다시 만들기]를 눌러야 그림에 들어가요」 안내 · 그림은 아직 그대로 · 초점은 [+ 행]');
            ok(o3 && o3.sub === `${B0.names.length + 1}종 · 합계 ${B0.total + 15}박스 · 직접 추가 15박스 포함` && s3 && s3.rows.length === 1, `[그림 다시 만들기] → 「${o3 && o3.sub}」 · 저장 ${s3 && s3.rows.length}행`);
            // 다음날 = 비움(저장된 날짜를 어제로 바꿔 두고 새로고침)
            await pg.evaluate(y => { const j = JSON.parse(sessionStorage.getItem('akm_qty_extra')); j.day = y; sessionStorage.setItem('akm_qty_extra', JSON.stringify(j)); }, kstDay(-1));
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(2200); await watchToasts(pg);
            await openQty(pg);
            const f4 = await figs(pg);
            const e4 = await pg.evaluate(() => ({ open: document.getElementById('qty-extra').open, rows: document.querySelectorAll('.qty-xrow').length, n: document.getElementById('qty-extra-n').textContent }));
            ok(sig(f4) === sig(f0) && !e4.open && e4.rows === 0 && e4.n === '' && (await stored(pg)) === null, `날짜가 바뀌면 비움 — 행 ${e4.rows} · 저장 없음 · 그림이 추가 전과 바이트 동일`);
            // 추가 없이 [그림 다시 만들기] = 종전 그림
            await pg.click('#qty-extra > summary'); await pg.click('#qty-extra-go'); await pg.waitForTimeout(700);
            ok(sig(await figs(pg)) === sig(f0) && /직접 추가 없이 그림을 다시 만들었어요/.test(toasts[toasts.length - 1]), `행 0 으로 [그림 다시 만들기] → 종전 그림 그대로(「${toasts[toasts.length - 1]}」)`);
            ok(P.errors.length === 0 && P.writes.length === 0 && st.replies.length === 2, `화면 오류 ${P.errors.length}${P.errors.length ? ' — ' + P.errors[0].slice(0, 140) : ''} · 창구 지시(POST) 0 — 중간발주 내내 서버 쓰기 ${P.writes.length}`);
            await P.ctx.close();
        }
    } catch (e) { ok(false, '검증 실행 — ' + (e && e.stack || e)); }
    finally { await h.stop(); }
    console.log(`\n결과: ${pass}/${pass + fail}` + (fail ? ' ❌' : ' ✅'));
    process.exit(fail ? 1 : 0);
})();
