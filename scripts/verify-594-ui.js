// #594 배송조회 카드 · #595 중간발주(브라우저가 바로 그림) 화면 검증 — 로컬 서버(포트 PORT594 · 없으면 3463) · 쓰기 전부 가로챔(DB 쓰기 0)
//   배송 API(/api/delivery/*)와 3채널 주문 조회는 이 파일의 가짜 응답으로 끼운다(서버 계약 = CLAUDE.md #594 절). 단가표 카탈로그(/api/invoice/catalog)는 실DB 읽기.
//   사용: node scripts/verify-594-ui.js [--shots <폴더>]
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js'));
const PORT = parseInt(process.env.PORT594, 10) || 3463;
const SHOTS = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();
const PC = { width: 1440, height: 900 }, PH = { width: 390, height: 844 };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const kstDay = off => new Date(Date.now() + 9 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
const Y = kstDay(-1), D2 = kstDay(-2), D3 = kstDay(-3);   // D3 = 송장 없는 날(고른 날) · D2 = 올린 엑셀의 발송일(올리면 기간이 이 날로 바뀌어야 한다)
const SUMMARY_TEXT = `${Y.slice(5).replace('-', '/')} 발송 1,609건 (중복 15건)\n배송완료 1262 / 배송출발 258 / 간선상하차 78 / 미배송 1 / 사고 0\n(집화 10)`;
const FULL_PHONE = '010-9876-5432';   // 응답에 없어야 하는 꼴(끝 4자리만 온다) — 화면에 통째로 안 보이는지 확인용
const summaryDone = () => ({
    ok: true, from: Y, to: Y, shipments: 1609, checked: 1609,
    counts: { 배송완료: 1262, 배송출발: 258, 간선상하차: 78, 집화: 10, 미배송: 1, 사고: 0, 기타: 0, 조회실패: 0 },
    dup: { person: 15 }, summary_text: SUMMARY_TEXT,
    by_date: [{ date: Y, partner: '효돈', n: 1203, counts: { 배송완료: 960, 배송출발: 180, 간선상하차: 52, 집화: 10, 미배송: 1 } }, { date: Y, partner: '대성', n: 406, counts: { 배송완료: 302, 배송출발: 78, 간선상하차: 26 } }],
    trouble: [
        { tracking: '680012345671', ship_date: Y, partner: '효돈', recipient: '김*수', phone_tail: '5432', region: '경기 성남시', option: '하우스감귤 가정용 - 4.5kg(로얄과)', qty: 2, bucket: '미배송', label: '미배송(고객부재)', msg: '고객 부재로 배송하지 못했습니다', event_time: Y + 'T09:12:00+09:00', branch: '성남분당', driver: { name: '박기사', phone: '010-1111-2222' }, days: 2, memo: '문 앞에 놓아 주세요' },
        { tracking: '680012345672', ship_date: Y, partner: '효돈', recipient: '이*영', phone_tail: '0099', region: '제주 서귀포시', option: '황금향 선물용 - 3kg', qty: 1, bucket: '집화 정체', label: '집화처리', msg: '', event_time: Y + 'T18:40:00+09:00', branch: '서귀포효돈', driver: { name: '', phone: '' }, days: 1 },
        { tracking: '680012345673', ship_date: Y, partner: '대성', recipient: '최*', phone_tail: '7777', region: '부산 해운대구', option: '레드키위 3kg(로얄과)', qty: 1, bucket: '조회실패', label: '조회 실패', msg: 'CJ 응답 없음', branch: '', driver: null, days: 1 },
        { tracking: '680012345674', ship_date: Y, partner: '대성', recipient: '정*호', phone_tail: '1234', region: '서울 강남구', option: '미니밤호박 특품 5kg', qty: 3, bucket: '사고', label: '사고(파손)', msg: '상품 파손 접수', event_time: Y + 'T11:05:00+09:00', branch: '강남역삼', driver: { name: '한기사', phone: '01033334444' }, days: 2 },
    ],
    checked_at: new Date().toISOString(),
});
const summaryNotChecked = () => ({ ok: true, from: Y, to: Y, shipments: 1609, checked: 0, counts: {}, dup: { person: 0 }, summary_text: '', by_date: [], trouble: [], checked_at: null });
const summaryEmpty = (d) => ({ ok: true, from: d, to: d, shipments: 0, checked: 0, counts: {}, by_date: [], trouble: [] });

// 3채널 주문(가짜) — 옵션 글자는 실제 스토어 옵션 꼴. 매칭 결과는 화면이 쓰는 함수로 다시 계산해 대조한다
const NAVER_ROWS = [
    { '옵션정보': '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(로얄과)', '수량': 3, '배송메세지': '' },
    { '옵션정보': '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(로얄과)', '수량': 2, '배송메세지': 'S사이즈로 부탁드려요' },
    { '옵션정보': '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(소과)', '수량': 4, '배송메세지': '문 앞' },
    { '옵션정보': '아꼼이네 상품선택: 2. 황금향 / 상품 및 과수: 황금향 선물용 - 3kg', '수량': 1, '배송메세지': '' },
    { '옵션정보': '이 세상에 없는 품목 99kg', '수량': 5, '배송메세지': '' },
];
const CP_ROWS = [{ '노출상품명(옵션명)': '하우스감귤 가정용 - 4.5kg(로얄과)', '구매수(수량)': 1, '배송메세지': '' }];
const CF_ROWS = [{ '주문상품명(세트상품 포함)': '1. (제철)고당도 하우스감귤 · 하우스감귤 가정용 - 2.5kg(소과)', '수량': 2, '배송메시지': '' }];

function routesFor(state) {
    return async (pg) => {
        const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
        await pg.route('**/api/delivery/**', async route => {
            const rq = route.request(), u = new URL(rq.url()), m = rq.method();
            state.calls.push(m + ' ' + u.pathname + u.search);
            if (m === 'GET' && u.pathname === '/api/delivery/track/status') {
                if (state.job) { state.job.done = Math.min(state.job.total, state.job.done + (state.step || 700)); if (state.job.done >= state.job.total) { state.done = true; const j = Object.assign({}, state.job, { state: 'done' }); state.job = null; return json(route, j); } return json(route, Object.assign({ state: 'running' }, state.job)); }
                return json(route, { state: 'idle' });
            }
            if (m === 'GET' && u.pathname === '/api/delivery/summary') {
                const from = u.searchParams.get('from');
                if (from !== Y) return json(route, state.uploaded === from ? Object.assign(summaryNotChecked(), { from, to: from, shipments: 12 }) : summaryEmpty(from));
                return json(route, state.done ? summaryDone() : summaryNotChecked());
            }
            if (m === 'POST' && u.pathname === '/api/delivery/track') {
                const body = rq.postDataJSON() || {}; state.posts.push(body);
                if (body.from !== Y && state.uploaded !== body.from) return json(route, { ok: false, error: '그 기간 송장이 아직 안 올라왔어요 — 엑셀을 끌어다 놓거나 대표 PC 색인 올리기를 기다려 주세요', need_upload: true });
                state.done = false; state.job = { id: 7, total: 1609, done: 350, from: body.from, to: body.to, started_at: new Date().toISOString() };
                return json(route, { ok: true, job: Object.assign({ state: 'running' }, state.job) });
            }
            if (m === 'POST' && u.pathname === '/api/delivery/shipments/upload') {
                const b = rq.postDataJSON() || {};
                state.uploads.push({ name: b.name, hasFile: /^data:[^,]*;base64,[A-Za-z0-9+/=]+$/.test(String(b.data || '')), date: b.date || null, auth: /^Bearer .+/.test(rq.headers()['authorization'] || '') });
                if (state.uploadFail) return json(route, { ok: false, error: '운송장 번호 칸을 찾지 못했어요' }, 400);
                if (!b.date && !/\d{1,2}\.\d{1,2}/.test(String(b.name))) return json(route, { ok: false, error: '발송일을 알 수 없어요 — 파일 이름에 「10.07」 꼴이 없으면 날짜를 골라 주세요' }, 400);
                state.uploaded = D2; return json(route, { ok: true, date: D2, rows: 12, upserted: 12 });
            }
            return json(route, { ok: false, error: 'mock 없음' }, 404);
        });
        const orders = rows => ({ ok: true, count: rows.length, rows, partial_adjusted: 0 });
        await pg.route('**/api/agent-office/naver/invoice-orders*', route => { state.calls.push('GET naver'); return state.naverFail ? json(route, { error: '중계서버 응답 없음' }, 500) : json(route, orders(NAVER_ROWS)); });
        await pg.route('**/api/agent-office/coupang/invoice-orders*', route => { state.calls.push('GET coupang'); return json(route, orders(CP_ROWS)); });
        await pg.route('**/api/agent-office/cafe24/invoice-orders*', route => { state.calls.push('GET cafe24'); return json(route, orders(CF_ROWS)); });
    };
}
const newState = () => ({ calls: [], posts: [], uploads: [], job: null, done: false, uploaded: null });
const overflow = pg => pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
const shot = async (pg, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }).catch(() => { }); };

(async () => {
    const h = await H.start(PORT, 'v594');
    try {
        const CASES = [['대표 PC', h.users.대표, PC, false, null], ['직원 PC', h.users.직원, PC, false, null], ['직원 폰', h.users.직원, PH, true, null], ['대표 PC 야간', h.users.대표, PC, false, 'dark'], ['직원 폰 야간', h.users.직원, PH, true, 'dark']];
        for (const [label, user, vw, phone, theme] of CASES) {
            console.log('\n■ #594 배송조회 — ' + label);
            const st = newState();
            const P = await h.open(user, vw, { phone, page: 'agent-office', theme, routes: routesFor(st) }); const pg = P.pg;
            await P.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` }).catch(() => { });
            const toasts = []; await pg.exposeFunction('__toast', t => toasts.push(t));
            await pg.evaluate(() => { new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && /toast/i.test(n.className || '')) window.__toast(n.textContent.trim()); }))).observe(document.body, { childList: true, subtree: true }); });
            const chip = await pg.evaluate(() => { const b = document.getElementById('desk-ship-now'); if (!b) return null; const r = b.getBoundingClientRect(); const all = Array.from(document.querySelectorAll('.desk-quick2 .desk-chip')).map(x => x.textContent.trim()); return { text: b.textContent.trim(), h: Math.round(r.height), vis: b.getClientRects().length > 0, all }; });
            ok(chip && chip.vis && chip.text === '배송조회 확인하기' && chip.h >= 44, `알약 「${chip && chip.text}」 높이 ${chip && chip.h}px · 자주 쓰는 일 = ${chip && chip.all.join(' / ')}`);
            const chipsIn = await pg.evaluate(() => { const box = document.querySelector('.desk-topbox').getBoundingClientRect(); const rs = Array.from(document.querySelectorAll('.desk-quick2 .desk-chip')).map(b => b.getBoundingClientRect()); return { n: rs.length, allIn: rs.every(r => r.left >= box.left - 1 && r.right <= box.right + 1 && r.left >= 0 && r.right <= window.innerWidth && r.width > 20), rows: new Set(rs.map(r => Math.round(r.top))).size, minH: Math.min(...rs.map(r => Math.round(r.height))), sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }; });
            ok(chipsIn.n === 4 && chipsIn.allIn && chipsIn.minH >= 44 && chipsIn.sw <= vw.width && (phone ? chipsIn.rows <= 2 : chipsIn.rows === 1), `알약 4개가 밀지 않아도 전부 보임(${chipsIn.rows}줄 · 높이 ${chipsIn.minH}px 이상 · 가로 넘침 0)`);
            ok(await pg.evaluate(() => document.getElementById('desk-ship').hidden && document.getElementById('desk-qty').hidden), '처음엔 도구 카드 둘 다 닫혀 있음');
            await pg.evaluate(() => document.getElementById('desk-ship-now').scrollIntoView({ block: 'center', inline: 'center' }));
            await pg.click('#desk-ship-now'); await pg.waitForFunction(() => document.querySelector('#ship-out .ship-empty'), null, { timeout: 8000 }).catch(() => { });
            const o1 = await pg.evaluate(() => ({ open: !document.getElementById('desk-ship').hidden, from: document.getElementById('ship-from').value, to: document.getElementById('ship-to').value, empty: (document.querySelector('#ship-out .ship-empty') || {}).textContent || '' }));
            ok(o1.open && o1.from === Y && o1.to === Y, `누르면 카드가 열리고 기간 = 어제~어제(${o1.from} ~ ${o1.to})`);
            ok(/1,609건이 올라와 있고 아직 조회하지 않았어요/.test(o1.empty) && st.posts.length === 0 && st.calls.some(c => c.startsWith('GET /api/delivery/track/status')), `열 때는 묻지 않고 안내만(「${o1.empty.slice(0, 26)}…」 · POST ${st.posts.length})`);
            // 달력
            await pg.click('#ship-from'); await pg.waitForTimeout(300);
            ok(await pg.evaluate(() => !!document.querySelector('.akm-cal-grid') && document.querySelector('.akm-cal-grid').getClientRects().length > 0), '날짜 칸 = 공용 달력(akm-date)이 열림');
            await pg.keyboard.press('Escape'); await pg.mouse.click(5, 5).catch(() => { }); await pg.waitForTimeout(200);
            // 조회
            st.step = 400;
            await pg.click('#ship-go');
            await pg.waitForFunction(() => /\d/.test(document.getElementById('ship-prog-n').textContent), null, { timeout: 6000 }).catch(() => { });
            const pr = await pg.evaluate(() => ({ vis: !document.getElementById('ship-prog').hidden, n: document.getElementById('ship-prog-n').textContent, t: document.getElementById('ship-prog-text').textContent, dis: document.getElementById('ship-go').disabled, bar: document.getElementById('ship-prog-bar').style.transform }));
            ok(pr.vis && /^[\d,]+ \/ 1,609$/.test(pr.n) && pr.dis, `진행 줄 「${pr.t} ${pr.n}」 · 막대 ${pr.bar} · [조회] 잠김`);
            ok(st.posts.length === 1 && st.posts[0].from === Y && st.posts[0].to === Y && !('force' in st.posts[0]), `POST /api/delivery/track 1회 = ${JSON.stringify(st.posts[0])}`);
            await pg.waitForFunction(() => document.getElementById('ship-sum-text'), null, { timeout: 20000 }).catch(() => { });
            const nStatus = st.calls.filter(c => c.startsWith('GET /api/delivery/track/status')).length;
            const r = await pg.evaluate(() => {
                const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
                return { sum: (q('#ship-sum-text') || {}).textContent || '', prog: !q('#ship-prog').hidden, go: q('#ship-go').disabled,
                    stat: qa('.ship-stat li').map(li => li.querySelector('span').textContent + ' ' + li.querySelector('b').textContent + (li.dataset.k ? ' [' + li.dataset.k + ']' : '')),
                    by: qa('.ship-by tbody tr').map(tr => tr.innerText.replace(/\s+/g, ' ').trim()), byHead: qa('.ship-by thead th').map(x => x.textContent),
                    tr: qa('.ship-tr tbody tr').map(tr => ({ badge: tr.querySelector('.desk-badge').textContent, k: tr.querySelector('.desk-badge').dataset.k, text: tr.innerText.replace(/\s+/g, ' ').trim(), tel: (tr.querySelector('a.ship-tel') || {}).href || '' })),
                    meta: (q('.ship-meta span') || {}).textContent || '', h: (qa('.ship-h').pop() || {}).textContent || '', all: q('#desk-ship').innerText };
            });
            ok(nStatus >= 3, `2초마다 상태를 물음(상태 조회 ${nStatus}회)`);
            ok(r.sum === SUMMARY_TEXT && !r.prog && !r.go, '끝나면 요약 글 = 서버 summary_text 그대로(줄바꿈 포함) · 진행 줄 사라짐 · [조회] 풀림');
            ok(r.stat.join(' | ') === '배송완료 1,262 | 배송출발 258 | 간선상하차 78 | 집화 10 [wait] | 미배송 1 [ask] | 사고 0 | 기타 0 | 조회실패 0', `상태별 건수 = ${r.stat.join(' | ')}`);
            ok(r.by.length === 2 && /효돈 1,203 960 180 52 10 1/.test(r.by[0]) && /대성 406 302 78 26 0 0/.test(r.by[1]), `발송일·거래처 표 ${r.by.length}줄(${r.byHead.join('·')}) — ${r.by[0]}`);
            ok(r.tr.length === 4 && r.tr.map(x => x.badge + ':' + x.k).join() === '미배송:ask,집화 정체:wait,조회실패:mute,사고:err', `확인할 건 ${r.tr.length}줄 · 배지 = ${r.tr.map(x => x.badge + ':' + x.k).join()} · 머리 「${r.h}」`);
            ok(/김\*수 끝 5432 경기 성남시 하우스감귤 가정용 - 4\.5kg\(로얄과\) × 2 미배송\(고객부재\) 고객 부재로 배송하지 못했습니다/.test(r.tr[0].text) && /성남분당/.test(r.tr[0].text) && /손님 메모 · 문 앞에 놓아 주세요/.test(r.tr[0].text) && /2일째/.test(r.tr[0].text) && /박기사 ?010-1111-2222/.test(r.tr[0].text), `첫 줄 = ${r.tr[0].text.slice(0, 110)}…`);
            ok(r.tr[0].tel === 'tel:01011112222' && r.tr[3].tel === 'tel:01033334444' && r.tr[1].tel === '' && r.tr[2].tel === '', `기사 번호 = 전화 걸기 링크(${r.tr[0].tel}) · 기사 없는 줄은 빈칸`);
            ok(!r.all.includes(FULL_PHONE) && !/undefined|null|NaN/.test(r.all), '손님 전체 번호 없음 · undefined/null/NaN 글자 없음');
            ok(/송장 1,609건 중 1,609건 조회 · 같은 분 여러 상자 15건 · .+ 기준/.test(r.meta), `조회 기준 줄 = ${r.meta}`);
            // 복사
            await pg.bringToFront(); await pg.evaluate(() => navigator.clipboard.writeText('비움')).catch(() => { });
            await pg.click('#ship-copy'); await pg.waitForTimeout(500);
            const clip = await pg.evaluate(() => navigator.clipboard.readText().then(t => t.split('\r\n').join('\n'))).catch(() => null);   // 윈도우 클립보드는 줄바꿈을 CRLF 로 돌려준다
            ok(toasts.some(t => /요약을 복사했어요/.test(t)) && (clip === null || clip === SUMMARY_TEXT), `[복사] → 토스트 「${toasts[toasts.length - 1] || ''}」 · 클립보드 ${clip === null ? '(읽기 불가)' : clip === SUMMARY_TEXT ? '요약과 같음' : '다름: ' + JSON.stringify(String(clip).slice(0, 50))}`);
            // 크기·넘침
            const g = await pg.evaluate(() => { const R = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }; const tw = document.querySelector('.ship-tr').parentElement; return { close: R('#ship-close'), go: R('#ship-go'), copy: R('#ship-copy'), force: R('#ship-force'), pick: R('#ship-pick'), date: R('#ship-from'), tel: R('a.ship-tel'), twScroll: tw.scrollWidth > tw.clientWidth + 1, twW: tw.clientWidth }; });
            const min = phone ? 44 : 32;
            ok([g.close, g.go, g.copy, g.force, g.pick, g.date].every(x => x && x[1] >= (phone ? 44 : 40)) && g.tel[1] >= min, `누르는 것 높이 — 닫기 ${g.close[1]} · 조회 ${g.go[1]} · 복사 ${g.copy[1]} · 다시 조회 ${g.force[1]} · 파일 고르기 ${g.pick[1]} · 날짜 ${g.date[1]} · 기사 번호 ${g.tel[1]}`);
            const sw = await overflow(pg);
            ok(sw <= vw.width && (!phone || g.twScroll), `가로 넘침 없음(${sw} ≤ ${vw.width})${phone ? ' · 이상 건 표는 틀 안에서 가로로 밀림' : ''}`);
            if (theme) { const a = await H.audit(pg, '#desk-ship'); ok(a.fails.length === 0 && a.dark === 'dark', `야간 대비 미달 ${a.fails.length}(글자 ${a.texts}개 · 최저 ${a.minR})${a.fails.length ? ' — ' + a.fails.slice(0, 4).join(' / ') : ''}`); }
            await shot(pg, '594-' + label.replace(/\s/g, '') + '-결과');
            // 전부 다시 조회(force)
            st.step = 2000;
            await pg.click('#ship-force'); await pg.waitForFunction(() => !document.getElementById('ship-prog').hidden, null, { timeout: 5000 }).catch(() => { });
            ok(st.posts.length === 2 && st.posts[1].force === true && st.posts[1].from === Y, `[전부 다시 조회] = POST ${JSON.stringify(st.posts[1])}`);
            await pg.waitForFunction(() => document.getElementById('ship-prog').hidden && document.getElementById('ship-sum-text'), null, { timeout: 15000 }).catch(() => { });
            // 송장 없는 날 → 안내 + 올리기
            await pg.evaluate(d => { const f = document.getElementById('ship-from'), t = document.getElementById('ship-to'); f.value = d; t.value = d; f.dispatchEvent(new Event('change', { bubbles: true })); }, D3);
            await pg.waitForFunction(() => document.getElementById('ship-drop').classList.contains('want'), null, { timeout: 6000 }).catch(() => { });
            const e1 = await pg.evaluate(() => ({ t: (document.querySelector('#ship-out .ship-empty') || {}).textContent || '', want: document.getElementById('ship-drop').classList.contains('want'), sum: !!document.getElementById('ship-sum-text') }));
            ok(/송장이 아직 안 올라왔어요/.test(e1.t) && e1.want && !e1.sum, `송장 0건인 날 = 「${e1.t.slice(0, 30)}…」 · 올리기 칸 강조`);
            await pg.click('#ship-go'); await pg.waitForTimeout(900);
            const e2 = await pg.evaluate(() => ({ t: (document.querySelector('#ship-out .ship-empty') || {}).textContent || '', prog: !document.getElementById('ship-prog').hidden, go: document.getElementById('ship-go').disabled }));
            ok(/송장이 아직 안 올라왔어요 — 엑셀을 끌어다 놓거나/.test(e2.t) && !e2.prog && !e2.go, `그날 [조회] → 서버 안내 그대로(need_upload) · 진행 줄 없음 · [조회] 풀림`);
            // 올리기 실패 → 성공(파일 고르기)
            const xlsx = { name: `${D2.slice(5).replace('-', '.')} 효돈.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK\u0003\u0004 가짜 엑셀') };
            st.uploadFail = true;
            await pg.setInputFiles('#ship-file', xlsx); await pg.waitForFunction(() => document.getElementById('ship-up-msg').dataset.k === 'err', null, { timeout: 5000 }).catch(() => { });
            const u0 = await pg.evaluate(() => document.getElementById('ship-up-msg').textContent);
            ok(u0 === '운송장 번호 칸을 찾지 못했어요', `올리기 실패 = 서버 글 그대로 「${u0}」`);
            st.uploadFail = false;
            await pg.setInputFiles('#ship-file', { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }); await pg.waitForTimeout(300);
            ok(await pg.evaluate(() => document.getElementById('ship-up-msg').textContent) === '엑셀 파일(xlsx)만 올릴 수 있어요' && st.uploads.length === 1, '엑셀이 아닌 파일은 올리지 않고 안내');
            await pg.setInputFiles('#ship-file', xlsx); await pg.waitForFunction(() => document.getElementById('ship-up-msg').dataset.k === 'ok', null, { timeout: 5000 }).catch(() => { });
            await pg.waitForTimeout(600);
            const u1 = await pg.evaluate(() => ({ m: document.getElementById('ship-up-msg').textContent, from: document.getElementById('ship-from').value, t: (document.querySelector('#ship-out .ship-empty') || {}).textContent || '', want: document.getElementById('ship-drop').classList.contains('want') }));
            const up = st.uploads[st.uploads.length - 1];
            ok(up && up.hasFile && up.auth && up.name === xlsx.name && up.date === null && /송장 12건을 올렸어요/.test(u1.m) && u1.from === D2 && /12건이 올라와/.test(u1.t) && !u1.want, `파일 고르기 → JSON { name, data(base64) } + 로그인 토큰 ·「${u1.m}」 · 기간 ${u1.from} · 「${u1.t.slice(0, 18)}…」`);
            // 파일 이름에 날짜가 없으면 고른 발송일로 한 번 더
            const b0 = st.uploads.length;
            await pg.setInputFiles('#ship-file', Object.assign({}, xlsx, { name: '효돈 송장.xlsx' })); await pg.waitForFunction(() => /고른 발송일로/.test(document.getElementById('ship-up-msg').textContent), null, { timeout: 5000 }).catch(() => { });
            ok(st.uploads.length === b0 + 2 && st.uploads[b0].date === null && st.uploads[b0 + 1].date === D2, `이름에 날짜 없는 파일 → 고른 발송일(${D2})을 붙여 한 번 더(「${await pg.evaluate(() => document.getElementById('ship-up-msg').textContent)}」)`);
            // 끌어다 놓기
            const before = st.uploads.length;
            await pg.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['PK'], '10.06 대성.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const d = document.getElementById('ship-drop'); d.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); const drag = d.classList.contains('drag'); d.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); window.__drag = drag; });
            await pg.waitForTimeout(900);
            ok(st.uploads.length === before + 1 && st.uploads[before].hasFile && await pg.evaluate(() => window.__drag && !document.getElementById('ship-drop').classList.contains('drag')), '엑셀 끌어다 놓기 → 올리기 1회(끄는 동안 칸 강조 · 놓으면 풀림)');
            // 닫기
            await pg.click('#ship-close'); await pg.waitForTimeout(200);
            ok(await pg.evaluate(() => document.getElementById('desk-ship').hidden && document.activeElement === document.getElementById('desk-ship-now')), '[닫기] → 카드 닫힘 · 초점은 알약으로');
            const nAfter = st.calls.length; await pg.waitForTimeout(2600);
            ok(st.calls.length === nAfter, '닫은 뒤에는 서버에 더 묻지 않음');
            const writes = P.writes.filter(w => !/\/api\/delivery\//.test(w));
            ok(P.errors.length === 0 && writes.length === 0, `화면 오류 ${P.errors.length}${P.errors.length ? ' — ' + P.errors[0].slice(0, 120) : ''} · 배송 API 밖 쓰기 ${writes.length}`);

            // ── #595 중간발주
            console.log('■ #595 중간발주 — ' + label);
            const c0 = st.calls.length;
            await pg.evaluate(() => document.getElementById('desk-qty-now').scrollIntoView({ block: 'center', inline: 'center' }));
            await pg.click('#desk-qty-now');
            await pg.waitForFunction(() => document.querySelectorAll('#qty-out .qty-fig img').length > 0 && document.getElementById('qty-prog').hidden, null, { timeout: 40000 }).catch(() => { });
            await pg.waitForFunction(() => Array.from(document.querySelectorAll('#qty-out .qty-fig img')).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => { });
            const q = await pg.evaluate(async () => {
                const figs = Array.from(document.querySelectorAll('#qty-out .qty-fig'));
                const out = [];
                for (const f of figs) {
                    const img = f.querySelector('img'), a = f.querySelector('a[download]');
                    const buf = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
                    out.push({ title: f.querySelector('figcaption b').textContent, sub: f.querySelector('figcaption > span').textContent, nw: img.naturalWidth, nh: img.naturalHeight, cw: Math.round(img.getBoundingClientRect().width), png: buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47, bytes: buf.length, file: a.getAttribute('download'), same: a.href === img.src, copy: !!f.querySelector('[data-qty-copy]'), aH: Math.round(a.getBoundingClientRect().height), unmatched: f.classList.contains('unmatched') });
                }
                return { open: !document.getElementById('desk-qty').hidden, shipHidden: document.getElementById('desk-ship').hidden, figs: out, meta: (document.querySelector('#qty-out .ship-meta span') || {}).textContent || '', sub: document.getElementById('qty-sub').textContent, note: document.getElementById('qty-note').hidden ? '' : document.getElementById('qty-note').textContent, btn: document.getElementById('desk-qty-now').disabled };
            });
            const callsQ = st.calls.slice(c0);
            ok(q.open && q.shipHidden && !q.btn, '「중간발주」 알약 → 중간발주 카드가 열림(배송조회 카드는 닫힘) · 끝나면 알약 풀림');
            ok(['GET naver', 'GET coupang', 'GET cafe24'].every(k => callsQ.includes(k)) && !P.writes.some(w => /\/api\/agent-office\/orders/.test(w)), `3채널을 브라우저가 바로 조회 · 창구 지시(POST /api/agent-office/orders) ${P.writes.filter(w => /\/api\/agent-office\/orders/.test(w)).length}회`);
            // 기대값: 화면이 쓰는 함수(app.js)로 같은 자료를 다시 계산
            const exp = await pg.evaluate(([nv, cp, cf]) => {
                const lines = [];
                const add = (opt, memo, qty) => lines.push({ opt: addSizeSuffix(String(opt || ''), String(memo || '').trim()), qty: parseInt(qty) || 1 });
                nv.forEach(r => add(r['옵션정보'], r['배송메세지'], r['수량'])); cf.forEach(r => add(r['주문상품명(세트상품 포함)'], r['배송메시지'], r['수량'])); cp.forEach(r => add(r['노출상품명(옵션명)'], r['배송메세지'], r['구매수(수량)']));
                const by = {}; let un = 0, unKinds = new Set(); const names = [];
                for (const g of lines) {
                    const sm = /^(.*?)\s+(2S|S|M)사이즈로!$/.exec(g.opt); let name = matchProduct(sm ? sm[1] : g.opt);
                    if (name.startsWith('[미매칭]')) { un += g.qty; unKinds.add(g.opt); continue; }
                    if (sm) name += ' ' + sm[2] + '사이즈로!';
                    const p = aoItemPartner(name.replace(/\s+(2S|S|M)사이즈로!$/, '')) || '기타';
                    (by[p] = by[p] || { total: 0, names: new Set() }); by[p].total += g.qty; by[p].names.add(name); names.push(name + ' → ' + qtyCategory(name));
                }
                return { by: Object.fromEntries(Object.entries(by).map(([p, v]) => [p, { total: v.total, kinds: v.names.size }])), un, unKinds: unKinds.size, names: [...new Set(names)] };
            }, [NAVER_ROWS, CP_ROWS, CF_ROWS]);
            const got = Object.fromEntries(q.figs.filter(f => !f.unmatched).map(f => [f.title, f.sub]));
            const want = Object.fromEntries(Object.entries(exp.by).map(([p, v]) => [p, `${v.kinds}종 · 합계 ${v.total}박스`]));
            ok(JSON.stringify(got) === JSON.stringify(want) && Object.keys(want).length >= 1, `거래처별 그림 = ${JSON.stringify(got)} (기대 ${JSON.stringify(want)})`);
            ok(exp.names.some(n => /S사이즈로! → orange/.test(n)), `손님 메모의 사이즈 요청은 따로 줄(주황) — ${exp.names.filter(n => /사이즈로!/.test(n)).join(' / ') || '없음'}`);
            const um = q.figs.find(f => f.unmatched);
            ok(exp.un > 0 ? !!um && um.sub.startsWith(`${exp.unKinds}종 · 합계 ${exp.un}박스`) : !um, `미매칭은 따로 한 장 — ${um ? um.title + ' ' + um.sub : '없음'}`);
            const tag = kstDay(0).slice(5, 7) + kstDay(0).slice(8, 10);
            ok(q.figs.length >= 2 && q.figs.every(f => f.png && f.nw > 100 && f.nh > 40 && f.bytes > 800 && f.same && f.file === `중간발주_${f.title}_${tag}.png`), `PNG ${q.figs.length}장 — ${q.figs.map(f => `${f.file} ${f.nw}×${f.nh} ${Math.round(f.bytes / 1024)}KB`).join(' · ')}`);
            ok(q.figs.every(f => (phone ? f.cw <= Math.round(f.nw / 2) && f.cw <= vw.width - 40 : f.cw === Math.round(f.nw / 2)) && f.aH >= (phone ? 44 : 40)), `화면에는 절반 크기(2배율 그림)로${phone ? ' · 폰은 카드 너비에 맞춰 줄임(' + q.figs.map(f => f.cw).join('·') + 'px)' : ''} · [내려받기] 높이 ${q.figs[0] && q.figs[0].aH}`);
            ok(/주문 네이버 5 · 쿠팡 1 · 자사몰 1/.test(q.meta) && /조회 · 최근 20일/.test(q.sub), `머리 = ${q.sub} · ${q.meta}`);
            if (q.figs[0] && q.figs[0].copy) { await pg.click('[data-qty-copy="0"]'); await pg.waitForTimeout(600); ok(toasts.some(t => /그림을 복사했어요|그림 복사를 막고/.test(t)), `[그림 복사] → 「${toasts[toasts.length - 1]}」`); }
            const sw2 = await overflow(pg);
            ok(sw2 <= vw.width, `가로 넘침 없음(${sw2} ≤ ${vw.width})`);
            if (theme) { const a = await H.audit(pg, '#desk-qty'); ok(a.fails.length === 0, `야간 대비 미달 ${a.fails.length}(글자 ${a.texts}개)${a.fails.length ? ' — ' + a.fails.slice(0, 3).join(' / ') : ''}`); }
            await shot(pg, '595-' + label.replace(/\s/g, '') + '-결과');
            if (SHOTS && label === '대표 PC') for (let i = 0; i < q.figs.length; i++) { const b64 = await pg.evaluate(async i => { const img = document.querySelectorAll('#qty-out .qty-fig img')[i]; const buf = new Uint8Array(await (await fetch(img.src)).arrayBuffer()); let s = ''; buf.forEach(c => s += String.fromCharCode(c)); return btoa(s); }, i); fs.writeFileSync(path.join(SHOTS, '브라우저_' + q.figs[i].file), Buffer.from(b64, 'base64')); }
            // 한 채널 실패 → 나머지로 집계 + 안내
            st.naverFail = true;
            await pg.click('#qty-again'); await pg.waitForFunction(() => !document.getElementById('qty-note').hidden && document.getElementById('qty-prog').hidden, null, { timeout: 40000 }).catch(() => { });
            const q2 = await pg.evaluate(() => ({ note: document.getElementById('qty-note').textContent, figs: document.querySelectorAll('#qty-out .qty-fig').length, meta: (document.querySelector('#qty-out .ship-meta span') || {}).textContent || '' }));
            ok(/불러오지 못한 채널은 빼고 집계했어요 · 네이버:/.test(q2.note) && q2.figs >= 1 && /네이버 실패/.test(q2.meta), `[다시 집계] 네이버 실패 → 「${q2.note.slice(0, 40)}…」 · 그림 ${q2.figs}장`);
            await pg.click('#qty-close'); await pg.waitForTimeout(200);
            ok(await pg.evaluate(() => document.getElementById('desk-qty').hidden && document.activeElement === document.getElementById('desk-qty-now')), '[닫기] → 카드 닫힘 · 초점은 알약으로');
            ok(P.errors.length === 0, `화면 오류 ${P.errors.length}${P.errors.length ? ' — ' + P.errors[0].slice(0, 140) : ''}`);
            await P.ctx.close();
        }
        // ── 실서버 응답(로컬 서버가 실DB 를 읽음 · 가짜 응답 없음 · [조회]는 누르지 않는다) — 카드가 서버 값 그대로 그리는지
        const REAL = (() => { const i = process.argv.indexOf('--real'); return i > 0 ? process.argv[i + 1] : Y; })();
        for (const [label, user, vw, phone, theme] of [['직원 PC', h.users.직원, PC, false, null], ['직원 폰 야간', h.users.직원, PH, true, 'dark']]) {
            console.log(`\n■ 실서버 응답 ${REAL} — ` + label);
            const P = await h.open(user, vw, { phone, page: 'agent-office', theme }); const pg = P.pg;
            await pg.click('#desk-ship-now'); await pg.waitForTimeout(600);
            await pg.evaluate(d => { const f = document.getElementById('ship-from'), t = document.getElementById('ship-to'); f.value = d; t.value = d; f.dispatchEvent(new Event('change', { bubbles: true })); }, REAL);
            await pg.waitForFunction(() => document.querySelector('#ship-out > *'), null, { timeout: 30000 }).catch(() => { });
            await pg.waitForTimeout(800);
            const api = await pg.evaluate(d => fetch('/api/delivery/summary?from=' + d + '&to=' + d, { headers: { Authorization: 'Bearer ' + localStorage.getItem('jwt_token') } }).then(r => r.json()), REAL);
            const v = await pg.evaluate(() => { const qa = s => Array.from(document.querySelectorAll(s)); return { sum: (document.getElementById('ship-sum-text') || {}).textContent, stat: Object.fromEntries(qa('.ship-stat li').map(li => [li.querySelector('span').textContent, li.querySelector('b').textContent.replace(/,/g, '')])), tr: qa('.ship-tr tbody tr').length, badges: [...new Set(qa('.ship-tr .desk-badge').map(b => b.textContent + ':' + b.dataset.k))], by: qa('.ship-by tbody tr').length, empty: (document.querySelector('#ship-out .ship-empty') || {}).textContent || '', text: document.getElementById('desk-ship').innerText, tels: qa('.ship-tr a.ship-tel').length }; });
            if (!api || !(api.shipments > 0)) { ok(/송장이 아직 안 올라왔어요/.test(v.empty), `그날 송장 0건 → 안내(「${v.empty.slice(0, 24)}…」) — 다른 날은 --real YYYY-MM-DD`); }
            else if (!(api.checked > 0)) { ok(/아직 조회하지 않았어요/.test(v.empty), `송장 ${api.shipments}건 · 미조회 → 「${v.empty.slice(0, 30)}…」`); }
            else {
                ok(v.sum === api.summary_text, `요약 글 = 서버 값(${JSON.stringify(String(v.sum).split('\n')[0])})`);
                ok(Object.entries(api.counts).every(([k, n]) => String(v.stat[k]) === String(n)), `상태별 건수 = 서버 counts ${JSON.stringify(api.counts)}`);
                ok(v.tr === api.trouble.length && v.by === api.by_date.length, `확인할 건 ${v.tr}줄(서버 ${api.trouble.length}) · 발송일·거래처 ${v.by}줄(서버 ${api.by_date.length}) · 배지 ${v.badges.join(' ')} · 기사 전화 링크 ${v.tels}`);
                ok(!/undefined|null|NaN|\[object/.test(v.text) && !/01\d-?\d{3,4}-?\d{4}/.test(v.text.replace(/끝 \d{4}/g, '')) === (v.tels === 0), '빈 값 글자(undefined·null·NaN) 없음 · 전화번호 꼴은 기사 번호뿐');
            }
            const sw = await overflow(pg); ok(sw <= vw.width, `가로 넘침 없음(${sw} ≤ ${vw.width})`);
            if (theme) { const a = await H.audit(pg, '#desk-ship'); ok(a.fails.length === 0, `야간 대비 미달 ${a.fails.length}(글자 ${a.texts}개)${a.fails.length ? ' — ' + a.fails.slice(0, 3).join(' / ') : ''}`); }
            ok(P.errors.length === 0 && P.writes.length === 0, `화면 오류 ${P.errors.length} · 쓰기 ${P.writes.length}`);
            await shot(pg, '594-실서버-' + label.replace(/\s/g, ''));
            await P.ctx.close();
        }
    } finally { await h.stop(); }
    console.log(`\n결과: ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ''}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
