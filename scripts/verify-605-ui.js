// #605 에이전트 오피스 — 되묻기(질문) 대화 [채팅 종료] · 이전 채팅 이력 [지우기] 검증 (포트 3462)
//   실DB 쓰기 = 시험 지시뿐: 없는 직원 번호(990605) 이름으로 「[시험605]」 지시를 직접 넣고(대기 프로그램·서버가 집지 않는 상태 = 질문·완료만),
//   화면에서 실제로 눌러 /close · /hide-mine 을 실서버(로컬)로 보낸 뒤 끝에 전부 is_deleted=true. 발송·손님 자료 0. 「판독완료」는 응답만 바꿔 흉내(실DB 에 넣으면 서버가 확인표를 만들려 든다)
//   🔵 「[검증…」 머리말을 쓰지 않는 이유: 이력(history=1)이 그 머리말을 걸러 내 이력 줄 시험이 안 된다 → 시험 동안(2~3분) 대표의 전체 이력에 「[시험605]」 줄이 잠깐 보일 수 있다
const path = require('path');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js'));
const PORT = Number(process.env.PORT605) || 3462;
const PC = { width: 1440, height: 900 }, PH = { width: 390, height: 844 };
const GHOST = { id: 990605, name: '시험605', position: '사원', role: 'user' };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
(async () => {
    const { Client } = require('pg');
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const h = await H.start(PORT, 'v605');
    await db.connect();
    const mk = async (content, status, result, hidden) => (await db.query(
        `INSERT INTO pending_orders (content, status, result, created_by, created_by_id, mine_hidden, processed_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING id`,
        ['[시험605] ' + content, status, JSON.stringify(result), GHOST.name, GHOST.id, !!hidden])).rows[0].id;
    const row = async id => (await db.query(`SELECT status, COALESCE(mine_hidden,false) AS mh, COALESCE(hist_hidden,false) AS hh, is_deleted AS del FROM pending_orders WHERE id=$1`, [id])).rows[0];
    try {
        await db.query(`UPDATE pending_orders SET is_deleted = true, mine_hidden = true WHERE created_by_id = $1 AND is_deleted = false`, [GHOST.id]);   // 앞선 시험이 끊겨 남은 것
        const jwt = require('jsonwebtoken');
        const allIds = [];
        for (const [label, vw, phone, theme] of [['PC', PC, false, null], ['폰', PH, true, null], ['PC 야간', PC, false, 'dark']]) {
            const A = await mk('정산관리 올려줘(되묻기)', '질문', { type: 'clarify', question: '[시험605] 효돈 10/9 정산으로 저장할까요?' }, false);
            const D = await mk('정산 이미지(처리 중 흉내)', '완료', { type: 'desk_answer', answer: '[시험605] 처리 중 흉내' }, false);
            const B = await mk('어제 주문 몇 건이야(끝난 대화)', '완료', { type: 'desk_answer', answer: '[시험605] 어제 주문은 12건이에요. 시험 답변입니다.' }, true);
            const C = await mk('열려 있는 끝난 대화', '완료', { type: 'desk_answer', answer: '[시험605] 열려 있는 대화의 답이에요.' }, false);
            // 사슬(대표 실물 #1798 → #1801): 종결된 되묻기에 이어서 답해 새 되묻기가 생긴 대화
            const E1 = await mk('정산관리 올려줘(사슬 첫 차례)', '질문종결', { type: 'clarify', question: '[시험605] 저장할까요?' }, false);
            const E2 = await mk('네', '질문', { type: 'clarify', question: '[시험605] 직원 권한이라 저장이 안 돼요. 어떻게 할까요?' }, false);
            await db.query(`UPDATE pending_orders SET reply_to = $1 WHERE id = $2`, [E1, E2]);
            allIds.push(A, B, C, D, E1, E2);
            const real = [];
            const routes = async pg => {
                // 없는 직원 번호라 /api/auth/me 가 404(→ 로그인 화면) → 이 응답만 채워 준다
                await pg.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: GHOST.id, username: 'test605', name: GHOST.name, position: GHOST.position, color: '#4F46E5', role: 'user', annualLeave: 0, hasSignature: false }) }));
                await pg.route('**/api/agent-office/**', async route => {
                    const rq = route.request(), u = new URL(rq.url());
                    if (rq.method() === 'GET' && u.pathname === '/api/agent-office/desk/orders') {   // 목록은 늘 새로(저장해 둔 응답을 쓰지 않는다) · D 는 「판독완료」로 보이게
                        const r = await route.fetch(); const j = await r.json();
                        (j.orders || []).forEach(o => { if (o.id === D && u.searchParams.get('mine') === '1') o.status = '판독완료'; });
                        return route.fulfill({ status: r.status(), contentType: 'application/json', body: JSON.stringify(j) });
                    }
                    if (rq.method() === 'POST' && /^\/api\/agent-office\/orders\/\d+\/(close|hide-mine)$/.test(u.pathname)) {
                        const id = Number(u.pathname.split('/')[4]);
                        if (!allIds.includes(id)) { real.push('막음 ' + u.pathname); return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"시험 지시가 아님"}' }); }
                        real.push(u.pathname.replace('/api/agent-office/orders/', '') + (rq.postData() ? ' ' + rq.postData() : '')); return route.continue();
                    }
                    return route.fallback();
                });
            };
            const P = await h.open(GHOST, vw, { phone, page: 'agent-office', theme, routes }); const pg = P.pg;
            const toasts = []; await pg.exposeFunction('__toast', t => toasts.push(t));
            await pg.evaluate(() => { const mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && /toast/i.test(n.className || '')) window.__toast(n.textContent.trim()); }))); mo.observe(document.body, { childList: true, subtree: true }); });
            const box = oid => `#desk-list .desk-thread-box:has([data-oid="${oid}"])`;
            // ── ① 채팅 탭: 되묻기 대화에 [채팅 종료]
            await pg.waitForSelector(box(A), { timeout: 15000 });
            const eb = pg.locator(box(A) + ' [data-act="endchat"]');
            ok(await eb.count() === 1, `[${label}] 되묻기(질문) 대화에 [채팅 종료] 1개`);
            const g = await pg.evaluate(sel => { const b = document.querySelector(sel + ' [data-act="endchat"]'), cb = document.querySelector(sel + ' .desk-cbox'); if (!b) return null; const r = b.getBoundingClientRect(), c = cb ? cb.getBoundingClientRect() : null, send = cb ? cb.querySelector('[data-act="sendreply"]').getBoundingClientRect() : null; return { w: Math.round(r.width), h: Math.round(r.height), inBox: !!(c && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom), clear: !send || r.right <= send.left + 1 || r.left >= send.right - 1 }; }, box(A));
            ok(g && g.h >= 44 && g.w >= 44 && g.inBox && g.clear, `[${label}] [채팅 종료] 크기 ${g && g.w}x${g && g.h} · 답 상자 안 · 보내기 버튼과 안 겹침(${JSON.stringify(g)})`);
            ok(await pg.locator(box(A) + ' .desk-reply-in').count() === 1, `[${label}] 답 칸은 그대로(답해도 되고 종료해도 됨)`);
            const dEnd = await pg.locator(box(D) + ' [data-act="endchat"]').count(), dNote = await pg.locator(box(D) + ' .desk-chatbar .desk-h-note').innerText().catch(() => '');
            ok(dEnd === 0 && /끝난 뒤 종료/.test(dNote), `[${label}] 판독완료(서버가 집는 중) 대화엔 버튼 없음 · 안내 「${dNote}」`);
            ok(await pg.locator(box(C) + ' [data-act="endchat"]').count() === 1, `[${label}] 끝난 대화의 [채팅 종료]는 종전대로`);
            await eb.click({ timeout: 4000 }); await pg.waitForTimeout(400);
            const yes = pg.locator(box(A) + ' [data-act="hidethread"]');
            ok(await yes.count() === 1 && await pg.locator(box(A) + ' [data-act="endno"]').count() === 1, `[${label}] 누르면 같은 자리에 [종료하기]·[취소]`);
            await yes.click({ timeout: 4000 });
            await pg.waitForFunction(sel => !document.querySelector(sel), box(A), { timeout: 15000 }).catch(() => { });
            await pg.waitForTimeout(500);
            const ra = await row(A);
            ok(ra.status === '질문종결' && ra.mh === true && ra.hh === false && ra.del === false, `[${label}] 실DB: ${A}번 = ${ra.status} · 내 목록 숨김 ${ra.mh} · 이력 숨김 ${ra.hh}(종료만으로는 이력에 남음) · 삭제 아님(${!ra.del})`);
            ok(await pg.locator(box(A)).count() === 0 && toasts.some(t => /전체 지시에는 남아 있어요/.test(t)), `[${label}] 채팅 탭에서 사라짐 · 토스트 「${toasts[toasts.length - 1] || ''}」`);
            ok(real.join(' | ').indexOf(A + '/close') === 0 && real.some(x => x.indexOf(A + '/hide-mine') === 0), `[${label}] 보낸 순서 = close → hide-mine(${real.join(' | ')})`);
            {   // 사슬: 한 대화로 묶이고 [채팅 종료] 1개 → close 는 마지막 질문에만 · hide-mine 은 둘 다 · 대화 통째로 사라짐
                const same = await pg.evaluate(([a, b]) => { const x = document.querySelector(`#desk-list [data-oid="${a}"]`), y = document.querySelector(`#desk-list [data-oid="${b}"]`); return !!x && !!y && x.closest('.desk-thread-box') === y.closest('.desk-thread-box'); }, [E1, E2]);
                const ee = pg.locator(box(E2) + ' [data-act="endchat"]');
                ok(same && await ee.count() === 1, `[${label}] 사슬(질문종결 → 이어서 답 → 질문): 한 대화 · [채팅 종료] 1개`);
                const n0 = real.length;
                await ee.click({ timeout: 4000 }); await pg.waitForTimeout(400);
                await pg.locator(box(E2) + ' [data-act="hidethread"]').click({ timeout: 4000 });
                await pg.waitForFunction(sel => !document.querySelector(sel), box(E2), { timeout: 15000 }).catch(() => { });
                await pg.waitForTimeout(400);
                const r1 = await row(E1), r2 = await row(E2), sent = real.slice(n0);
                ok(sent.filter(x => x.endsWith('/close')).join() === E2 + '/close' && sent.some(x => x.indexOf(E1 + '/hide-mine') === 0) && sent.some(x => x.indexOf(E2 + '/hide-mine') === 0), `[${label}] 사슬: close 는 마지막 질문(${E2})에만 · hide-mine 은 둘 다(${sent.join(' | ')})`);
                ok(r1.status === '질문종결' && r2.status === '질문종결' && r1.mh && r2.mh && !r1.del && !r2.del && await pg.locator(`#desk-list [data-oid="${E1}"], #desk-list [data-oid="${E2}"]`).count() === 0, `[${label}] 사슬: 실DB 둘 다 질문종결·내 목록 숨김 · 채팅 탭에서 대화 통째로 사라짐`);
            }
            let sw = await pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
            ok(sw <= vw.width, `[${label}] 채팅 탭 가로 넘침 없음(${sw})`);
            if (theme) { const a = await H.audit(pg, '#desk-list'); ok(a.fails.length === 0, `[${label}] 채팅 탭 야간 대비 미달 0(글자 ${a.texts}개${a.fails.length ? ' · ' + a.fails.slice(0, 3).join(' / ') : ''})`); }
            // ── ② 이전 채팅 이력: [지우기]
            await pg.evaluate(() => document.querySelector('#desk-tabs .desk-tab[data-tab="all"]').click());
            const item = oid => `#desk-list .desk-h-item[data-th="${oid}"]`;
            await pg.waitForSelector(item(B), { timeout: 15000 });
            const dels = await pg.evaluate(ids => ids.map(id => { const it = document.querySelector(`#desk-list .desk-h-item[data-th="${id}"]`); return it ? it.querySelectorAll(':scope > .desk-h-del').length : -1; }), [A, B, C, D]);
            ok(dels.join(',') === '1,1,1,1', `[${label}] 이력 줄마다 [지우기](종료한 되묻기·끝난 대화·열려 있는 끝난 대화 · ${dels.join(',')})`);
            const gg = await pg.evaluate(sel => { const it = document.querySelector(sel); const d = it.querySelector(':scope > .desk-h-del').getBoundingClientRect(), c = it.querySelector(':scope > .desk-h-copy'), cr = c ? c.getBoundingClientRect() : null, t = it.querySelector('.desk-h-text').getBoundingClientRect(), m = it.querySelector('.desk-h-meta').getBoundingClientRect(), ir = it.getBoundingClientRect(); const left = cr ? Math.min(cr.left, d.left) : d.left; return { w: Math.round(d.width), h: Math.round(d.height), copy: !!cr, gap: cr ? Math.round(d.left - cr.right) : null, textClear: t.right <= left + 1 && m.right <= left + 1, inside: d.right <= ir.right && d.top >= ir.top - 1 && d.bottom <= ir.bottom + 1 }; }, item(B));
            ok(gg.h >= (phone ? 44 : 32) && gg.w >= 44 && gg.copy && gg.gap >= 2 && gg.textClear && gg.inside, `[${label}] [지우기] ${gg.w}x${gg.h} · [복사]와 간격 ${gg.gap}px · 글·배지와 안 겹침(${gg.textClear}) · 줄 안(${gg.inside})`);
            const del = pg.locator(item(B) + ' > .desk-h-del');
            await del.click({ timeout: 4000 }); await pg.waitForTimeout(400);
            const mid = await row(B);
            ok(await pg.locator(item(B) + ' > .desk-h-del').innerText() === '확인' && !await pg.locator(item(B) + '.open').count() && toasts.some(t => /한 번 더 누르면/.test(t)) && mid.del === false, `[${label}] 첫 누름 = 확인 물음(버튼 「확인」 · 줄 안 펼쳐짐 · 아직 안 지움)`);
            const nReal = real.length;
            await pg.locator(item(B) + ' > .desk-h-del').click({ timeout: 4000 });
            await pg.waitForFunction(sel => !document.querySelector(sel), item(B), { timeout: 15000 }).catch(() => { });
            await pg.waitForTimeout(400);
            const rb = await row(B);
            ok(await pg.locator(item(B)).count() === 0 && toasts.some(t => /내 이력에서 지웠어요/.test(t)), `[${label}] 둘째 누름 → 그 줄 사라짐 · 토스트 「${toasts[toasts.length - 1] || ''}」`);
            ok(rb.del === false && rb.mh === true && rb.hh === true && real.slice(nReal).some(x => x.indexOf(B + '/hide-mine') === 0 && /"hist":true/.test(x)), `[${label}] 실DB: ${B}번 삭제 아님(${!rb.del}) · 이력 숨김 ${rb.hh} · hide-mine {hist:true} 보냄`);
            // 펼친 대화의 아래쪽 [지우기] + 열려 있는 대화(C)를 지우면 채팅 탭에서도 내려감
            await pg.locator(item(C) + ' .desk-h-row').click({ timeout: 4000 }); await pg.waitForTimeout(500);
            const fd = pg.locator(item(C) + ' .desk-h-foot [data-act="histdel"]');
            const fb = await fd.boundingBox();
            ok(await fd.count() === 1 && await pg.locator(item(C) + ' > .desk-h-del').count() === 0 && fb && fb.height >= (phone ? 44 : 32), `[${label}] 펼친 대화는 아래쪽에 [지우기](${fb ? Math.round(fb.width) + 'x' + Math.round(fb.height) : '?'})`);
            await fd.click({ timeout: 4000 }); await pg.waitForTimeout(400);
            await pg.locator(item(C) + ' .desk-h-foot [data-act="histdel"]').click({ timeout: 4000 });
            await pg.waitForFunction(sel => !document.querySelector(sel), item(C), { timeout: 15000 }).catch(() => { });
            const rc = await row(C);
            ok(await pg.locator(item(C)).count() === 0 && rc.mh === true && rc.hh === true && rc.del === false, `[${label}] 열려 있던 끝난 대화도 지워짐(내 목록 숨김 ${rc.mh} · 이력 숨김 ${rc.hh} · 삭제 아님)`);
            sw = await pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
            ok(sw <= vw.width, `[${label}] 이력 탭 가로 넘침 없음(${sw})`);
            if (theme) { const a = await H.audit(pg, '#desk-list'); ok(a.fails.length === 0, `[${label}] 이력 탭 야간 대비 미달 0(글자 ${a.texts}개${a.fails.length ? ' · ' + a.fails.slice(0, 3).join(' / ') : ''})`); }
            // 새로고침 뒤에도 내 이력에 안 돌아옴(서버 hist_hidden)
            await pg.reload({ waitUntil: 'networkidle' }).catch(() => { }); await pg.waitForTimeout(2200);
            await pg.evaluate(() => document.querySelector('#desk-tabs .desk-tab[data-tab="all"]').click());
            await pg.waitForSelector(item(A), { timeout: 15000 }).catch(() => { });
            ok(await pg.locator(item(B)).count() === 0 && await pg.locator(item(C)).count() === 0 && await pg.locator(item(A)).count() === 1, `[${label}] 새로고침 뒤: 지운 2줄 안 보임 · 안 지운 줄(${A}번)은 그대로`);
            await pg.evaluate(() => document.querySelector('#desk-tabs .desk-tab[data-tab="mine"]').click()); await pg.waitForTimeout(1500);
            ok(await pg.locator(box(C)).count() === 0 && await pg.locator(box(D)).count() === 1, `[${label}] 채팅 탭: 지운 대화 없음 · 손 안 댄 대화는 그대로`);
            ok(P.errors.length === 0 && real.every(x => !/^막음/.test(x)) && P.writes.every(w => !/\/orders\//.test(w)), `[${label}] 화면 오류 ${P.errors.length} · 시험 지시 밖 쓰기 0(실제 보낸 것 ${real.length}건)`);
            await P.ctx.close();
            {   // 다른 세션(새 브라우저 · 새 로그인 · 저장된 것 없음)에서도 지운 줄은 안 보인다
                const P2 = await h.open(GHOST, vw, { phone, page: 'agent-office', theme, routes }); const p2 = P2.pg;
                await p2.evaluate(() => document.querySelector('#desk-tabs .desk-tab[data-tab="all"]').click());
                await p2.waitForSelector(item(A), { timeout: 15000 }).catch(() => { });
                ok(await p2.locator(item(B)).count() === 0 && await p2.locator(item(C)).count() === 0 && await p2.locator(item(A)).count() === 1, `[${label}] 새 세션(새 로그인): 지운 2줄 안 보임 · 종료만 한 줄(${A}번)은 이력에 있음`);
                await P2.ctx.close();
            }
            // ── ③ 대표: 전체 이력에는 지운 것까지 그대로(실서버 응답)
            const tok = jwt.sign(h.users.대표, 'verifytest', { expiresIn: '10m' });
            const j = await (await fetch(`http://localhost:${PORT}/api/agent-office/desk/orders?history=1&limit=200&q=${encodeURIComponent('시험605')}`, { headers: { Authorization: 'Bearer ' + tok } })).json();
            const seen = new Set((j.orders || []).map(o => o.id));
            ok([A, B, C].every(id => seen.has(id)), `[${label}] 대표 전체 이력 응답에 종료·지운 대화 3건 모두 있음(${[A, B, C].map(id => id + ':' + seen.has(id)).join(' ')})`);
        }
        {   // 대표 화면: 전체 이력에 줄이 보이고 [지우기]는 없다(대표는 전부 보는 자리)
            const P = await h.open(h.users.대표, PC, { page: 'agent-office' }); const pg = P.pg;
            await pg.evaluate(() => document.querySelector('#desk-tabs .desk-tab[data-tab="all"]').click()); await pg.waitForTimeout(1500);
            await pg.fill('#desk-hist-q', '시험605'); await pg.waitForTimeout(2500);
            const n = await pg.locator('#desk-list .desk-h-item').count(), nd = await pg.locator('#desk-list [data-act="histdel"]').count();
            const has = await pg.evaluate(ids => ids.filter(id => document.querySelector(`#desk-list .desk-h-item[data-th="${id}"]`)).length, allIds);
            ok(n >= 12 && has >= 12 && nd === 0, `[대표 화면] 「시험605」 검색 = ${n}줄(지운·종료한 것 ${has}줄 포함) · [지우기] ${nd}개`);
            ok(P.errors.length === 0 && P.writes.every(w => !/\/orders\//.test(w)), `[대표 화면] 화면 오류 ${P.errors.length} · 지시 쓰기 0`);
            await P.ctx.close();
        }
    } catch (e) { fail++; console.log('  ❌ 중단: ' + (e && e.stack || e)); }
    finally {
        const c = await db.query(`UPDATE pending_orders SET is_deleted = true, mine_hidden = true WHERE created_by_id = $1 AND is_deleted = false RETURNING id`, [GHOST.id]).catch(() => ({ rows: [] }));
        const left = (await db.query(`SELECT COUNT(*)::int AS n FROM pending_orders WHERE created_by_id = $1 AND is_deleted = false`, [GHOST.id]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
        ok(left === 0, `정리: 시험 지시 ${c.rows.length}건 is_deleted=true · 남은 것 ${left}`);
        await db.end().catch(() => { }); await h.stop();
        console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
    }
})();
