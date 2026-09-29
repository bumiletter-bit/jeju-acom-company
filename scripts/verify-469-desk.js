// #469 검증: 클코 창구 — 서버 전환(AI 호출 0)·창구 스크립트 왕복·승인 흐름·정산 판독값→확인표(기존 계산과 동일)·실렌더·다른 메뉴 무회귀
//   로컬 실서버(3457 · 5초 이하 주기만 살리고 나머지 setInterval 무력화) + 실DB. 시험 지시는 끝에 soft-delete, 시험 알림은 삭제.
//   🔴 ANTHROPIC_API_KEY를 비워 기동 → AI 경로가 불리면 오류가 나므로 "AI 호출 0"이 기계적으로 증명된다.
require('dotenv').config();
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const jwt = require('jsonwebtoken');
const PORT = 3457, ROOT = path.join(__dirname, '..');
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const desk = (script, ...args) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'desk', script), ...args.map(String)], { cwd: ROOT, encoding: 'utf8' });
const tmpJson = obj => { const f = path.join(os.tmpdir(), 'desk469-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

(async () => {
    let srv = null, browser = null, db = null;
    const made = [], madeFiles = [];
    let S_nid0 = null;
    try {
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY;
        srv = spawn(process.execPath, ['-e', `const si=global.setInterval; global.setInterval=(f,ms,...a)=> (ms<=5000 ? si(f,ms,...a) : {unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'desk469-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'desk469-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동', up);
        if (!up) throw new Error('server not up');
        const { Client } = require('pg');
        db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const staff = (await db.query(`SELECT id, name, position FROM users WHERE role <> 'admin' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        const tokA = jwt.sign({ id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, 'verifytest', { expiresIn: '20m' });
        const tokS = jwt.sign({ id: staff.id, name: staff.name, position: staff.position || '', role: 'staff' }, 'verifytest', { expiresIn: '20m' });
        const call = async (tok, method, url, body) => {
            const opt = { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Connection: 'close' }, body: body ? JSON.stringify(body) : undefined };
            let r; try { r = await fetch(`http://localhost:${PORT}${url}`, opt); } catch (e) { await sleep(300); r = await fetch(`http://localhost:${PORT}${url}`, opt); } // 끊긴 keep-alive 소켓 재시도
            let j = null; try { j = await r.json(); } catch (_) { }
            return { status: r.status, j };
        };
        const nid0 = (await db.query(`SELECT COALESCE(MAX(id),0)::int m FROM notifications`)).rows[0].m;
        S_nid0 = nid0;
        const row = async id => (await db.query(`SELECT id, status, result, run_id, created_by_id FROM pending_orders WHERE id=$1`, [id])).rows[0];

        // ── 1. 접수: AI 없이 '대기'
        const runsBefore = (await db.query(`SELECT COALESCE(MAX(id),0)::int m FROM agent_runs`)).rows[0].m;
        const p1 = await call(tokS, 'POST', '/api/agent-office/orders', { content: '[검증469] 오늘 발송 박스 수 알려줘' });
        made.push(p1.j.order.id);
        ok('직원 지시 접수 200 · engine=desk · 상태 대기', p1.status === 200 && p1.j.engine === 'desk' && p1.j.order.status === '대기', `#${p1.j.order.id} ${p1.j.order.status}`);
        await sleep(1500);
        const r1 = await row(p1.j.order.id);
        const runsAfter = (await db.query(`SELECT COALESCE(MAX(id),0)::int m FROM agent_runs`)).rows[0].m;
        ok('접수 뒤에도 대기 유지 · 실행 기록 0 · 오류 아님(AI 키 없이 기동 = AI 경로 미호출)', r1.status === '대기' && r1.run_id == null && runsAfter === runsBefore && r1.created_by_id === staff.id);
        const long = await call(tokS, 'POST', '/api/agent-office/orders', { content: '가'.repeat(2001) });
        ok('2000자 초과 거절(400)', long.status === 400);
        const noAuth = await fetch(`http://localhost:${PORT}/api/agent-office/desk-status`);
        ok('창구 상태 API 인증 필요', noAuth.status === 401 || noAuth.status === 403);

        // ── 2. 창구 상태: heartbeat 전후
        await db.query(`DELETE FROM agent_office_config WHERE key='desk_heartbeat'`);
        const s0 = await call(tokS, 'GET', '/api/agent-office/desk-status');
        ok('heartbeat 없음 = 자리 비움 · 대기 1건 이상', s0.j.state === 'offline' && s0.j.online === false && s0.j.waiting >= 1);

        // ── 3. 창구 스크립트 왕복: 받기 → 단계 → 답변
        const got = JSON.parse(desk('get.js', p1.j.order.id));
        ok('get.js = 처리중으로 집음 · 실행 기록 생성 · 내용 전달', got.ok && got.content.includes('[검증469]') && !!got.run_id && (await row(p1.j.order.id)).status === '처리중');
        const got2 = JSON.parse(desk('get.js', p1.j.order.id));
        ok('같은 지시 두 번 집기 불가', got2.ok === false);
        // ⚠️ 대표 PC의 대기 프로그램이 돌고 있으면 30초마다 heartbeat(idle)를 덮어쓴다 → 한 번 더 확인한다(#472)
        let s1 = await call(tokS, 'GET', '/api/agent-office/desk-status');
        if (!(s1.j.state === 'busy' && s1.j.order_id === p1.j.order.id)) {
            desk('step.js', p1.j.order.id, '검증', '중');
            s1 = await call(tokS, 'GET', '/api/agent-office/desk-status');
        }
        ok('처리 중 상태 표시(busy · 지시 번호)', s1.j.state === 'busy' && s1.j.order_id === p1.j.order.id, s1.j.state + ' / ' + s1.j.order_id);
        desk('step.js', p1.j.order.id, '정산관리', '조회', '중');
        desk('respond.js', p1.j.order.id, tmpJson({ kind: 'answer', title: '오늘 발송 박스', answer: '검증용 답변입니다.\n둘째 줄' }));
        const r3 = await row(p1.j.order.id);
        const run3 = (await db.query(`SELECT status, steps, result FROM agent_runs WHERE id=$1`, [r3.run_id])).rows[0];
        ok('답변 저장 = 완료 · desk_answer · 실행 기록 done · 단계 3줄 · 행위자 클코', r3.status === '완료' && r3.result.type === 'desk_answer' && run3.status === 'done' && run3.steps.length === 3 && run3.steps[0].actor === '클코' && run3.result.lines.length === 2);
        const n1 = (await db.query(`SELECT title FROM notifications WHERE user_id=$1 AND type='desk' AND id > $2 ORDER BY id DESC LIMIT 1`, [staff.id, nid0])).rows[0];
        ok('요청자 종 알림 기록', !!n1 && /답했어요/.test(n1.title));
        let again = ''; try { desk('respond.js', p1.j.order.id, tmpJson({ kind: 'answer', answer: 'x' })); } catch (e) { again = String(e.stderr || e.message); }
        ok('완료된 지시에 다시 답 올리기 거부', /상태라 결과를 올릴 수 없습니다/.test(again));
        const s2 = await call(tokS, 'GET', '/api/agent-office/desk-status');
        ok('답변 뒤 대기 중(idle)', s2.j.state === 'idle');

        // ── 4. 승인 흐름
        const p2 = await call(tokS, 'POST', '/api/agent-office/orders', { content: '[검증469] 회원 test 에게 5% 쿠폰 발급해줘' });
        made.push(p2.j.order.id);
        desk('get.js', p2.j.order.id);
        desk('respond.js', p2.j.order.id, tmpJson({ kind: 'approval', action: 'coupon', summary: '[검증469] 5% 쿠폰 1장 발급', impact: '회원 1명 · 쿠폰 1장', plan: '승인되면 발급 후 보유 확인' }));
        ok('승인 요청 = 승인대기', (await row(p2.j.order.id)).status === '승인대기');
        const nA = (await db.query(`SELECT COUNT(*)::int c FROM notifications WHERE type='desk' AND title LIKE '%승인 요청%' AND id > $1`, [nid0])).rows[0].c;
        const admins = (await db.query(`SELECT COUNT(*)::int c FROM users WHERE role='admin' AND deleted_at IS NULL`)).rows[0].c;
        ok('승인 요청 알림 = 활성 관리자 수만큼', nA === admins, `${nA}/${admins}`);
        const ap0 = await call(tokS, 'POST', `/api/agent-office/orders/${p2.j.order.id}/approve`);
        ok('직원은 승인 불가(403)', ap0.status === 403 && (await row(p2.j.order.id)).status === '승인대기');
        const ap1 = await call(tokA, 'POST', `/api/agent-office/orders/${p2.j.order.id}/approve`);
        const r4 = await row(p2.j.order.id);
        ok('대표 승인 = 승인됨 · 승인자 기록', ap1.status === 200 && r4.status === '승인됨' && /대표/.test(r4.result.approved_by || ''));
        const ap2 = await call(tokA, 'POST', `/api/agent-office/orders/${p2.j.order.id}/approve`);
        ok('같은 요청 두 번 승인 불가(400)', ap2.status === 400);
        const got4 = JSON.parse(desk('get.js', p2.j.order.id));
        ok('승인된 지시를 창구가 다시 집음 · 승인 내용 전달', got4.ok && got4.approved_request && got4.approved_request.action === 'coupon');
        desk('respond.js', p2.j.order.id, tmpJson({ kind: 'answer', answer: '[검증469] 실행하지 않은 시험 답변' }));
        const p3 = await call(tokS, 'POST', '/api/agent-office/orders', { content: '[검증469] 가격 바꿔줘' });
        made.push(p3.j.order.id);
        desk('get.js', p3.j.order.id);
        desk('respond.js', p3.j.order.id, tmpJson({ kind: 'approval', action: 'price', summary: '[검증469] 가격 변경', impact: '-', plan: '-' }));
        const rj = await call(tokA, 'POST', `/api/agent-office/orders/${p3.j.order.id}/reject`, { reason: '시험 반려' });
        const r5 = await row(p3.j.order.id);
        ok('반려 = 반려 상태 · 사유 기록 · 창구가 집지 못함', rj.status === 200 && r5.status === '반려' && r5.result.reject_reason === '시험 반려' && JSON.parse(desk('get.js', p3.j.order.id)).ok === false);

        // ── 5. 정산 판독값 → 확인표: 기존 계산 함수와 같은 결과
        const pr = (await db.query(`SELECT partner, items FROM pricing WHERE (start_date IS NULL OR start_date <= (NOW()+interval '9 hours')::date) AND (end_date IS NULL OR end_date >= (NOW()+interval '9 hours')::date) AND partner='효돈농협' ORDER BY start_date DESC NULLS LAST, id DESC LIMIT 1`)).rows[0];
        if (!pr || !Array.isArray(pr.items) || pr.items.length < 2) ok('이번 주 효돈 단가표 있음(정산 판독 검증 전제)', false, '단가표 없음 — 이 절 생략');
        else {
            const a = pr.items[0], b = pr.items[1];
            const items = [{ name: '고당도 하우스감귤 / 상품 및 과수: ' + a.name, qty: 3 }, { name: '고당도 하우스감귤 / 상품 및 과수: ' + b.name, qty: 2 }, { name: '[검증469] 없는 품목', qty: 1 }];
            const expect = Number(a.price) * 3 + Number(b.price) * 2;
            const D = (await db.query(`SELECT to_char((NOW()+interval '9 hours')::date,'YYYY-MM-DD') d`)).rows[0].d; // 오늘(KST) — 단가표가 있는 날짜
            const stCount = async () => (await db.query(`SELECT COUNT(*)::int c, COALESCE(SUM(amount),0)::text a FROM settlements WHERE date::text=$1`, [D])).rows[0];
            const st0 = await stCount();
            const p4 = await call(tokA, 'POST', '/api/agent-office/orders', { content: '[검증469] 효돈 정산관리에 올려줘', image_data: 'data:image/png;base64,iVBORw0KGgo=', image_mime: 'image/png' });
            made.push(p4.j.order.id);
            ok('이미지 지시도 AI 없이 대기', p4.j.order.status === '대기');
            const g4 = JSON.parse(desk('get.js', p4.j.order.id));
            ok('첨부 이미지를 파일로 받음', !!g4.image_path && fs.existsSync(g4.image_path));
            try { fs.unlinkSync(g4.image_path); } catch (_) { }
            desk('respond.js', p4.j.order.id, tmpJson({ kind: 'ocr', partner: '효돈농협유통센터', items, date: D }));
            let r6 = null;
            for (let i = 0; i < 20; i++) { await sleep(1000); r6 = await row(p4.j.order.id); if (r6.status === '질문' || r6.status === '오류') break; }
            const c = r6.result || {};
            ok('서버가 확인표 생성(질문 · settlement_ocr_confirm)', r6.status === '질문' && c.type === 'settlement_ocr_confirm', r6.status + ' ' + (c.error || ''));
            ok('거래처 효돈농협 · 날짜 오늘 · 6박스', c.partner === '효돈농협' && c.date === D && c.box_total === 6, `${c.partner} ${c.date} ${c.box_total}`);
            ok('금액 = 단가표 단가 × 수량(직접 계산과 동일) · 미매칭 1건', Number(c.total) === expect && (c.unmatched || []).length === 1, `${c.total} vs ${expect}`);
            ok('거래처 후보 3곳 계산 보존(확인표 드롭다운용)', c.candidates && Object.keys(c.candidates).length === 3);
            const st1 = await stCount();
            ok('확인 전에는 정산관리에 저장되지 않음(오늘 정산 행·금액 무변동)', st1.c === st0.c && st1.a === st0.a);
            // "아니오" 즉답 = AI 없이 서버가 취소 처리
            const no = await call(tokA, 'POST', '/api/agent-office/orders', { content: '아니오' });
            made.push(no.j.order.id);
            const r7 = await row(p4.j.order.id);
            ok('"아니오" = 즉시 취소(창구 거치지 않음) · 저장 0', no.j.order.status === '안내' && r7.status === '취소' && (await stCount()).a === st0.a, `${no.j.order.status} / ${r7.status}`);
        }

        // ── 6. 현황판
        const bS = await call(tokS, 'GET', '/api/agent-office/desk/board');
        const bA = await call(tokA, 'GET', '/api/agent-office/desk/board');
        ok('현황판 200 · 채널·발송·할 일 배열', bS.status === 200 && Array.isArray(bS.j.channels) && Array.isArray(bS.j.ship) && Array.isArray(bS.j.todo));
        ok('매출(정산 회차)은 대표에게만', bS.j.sales === undefined && Array.isArray(bA.j.sales));
        const mine = await call(tokS, 'GET', '/api/agent-office/desk/orders?mine=1');
        ok('내 지시 목록 = 내 것만 · 이미지 원문 미포함', mine.j.orders.length >= 3 && mine.j.orders.every(o => o.created_by_id === staff.id && o.image_data === undefined));

        // ── 6-b. 내 지시에서 지우기(#469-c)
        const hA = await call(tokA, 'POST', `/api/agent-office/orders/${p1.j.order.id}/hide-mine`, { hide: true });
        ok('남의 지시는 지울 수 없음(400)', hA.status === 400);
        const pw = await call(tokS, 'POST', '/api/agent-office/orders', { content: '[검증469] 대기 중 지우기 시도' });
        made.push(pw.j.order.id);
        const hW = await call(tokS, 'POST', `/api/agent-office/orders/${pw.j.order.id}/hide-mine`, { hide: true });
        ok('처리 전(대기) 지시는 지울 수 없음(400)', hW.status === 400);
        const hS = await call(tokS, 'POST', `/api/agent-office/orders/${p3.j.order.id}/hide-mine`, { hide: true });
        const mine2 = await call(tokS, 'GET', '/api/agent-office/desk/orders?mine=1');
        const all2 = await call(tokS, 'GET', '/api/agent-office/desk/orders?limit=100');
        const rowH = (await db.query(`SELECT is_deleted, mine_hidden, status FROM pending_orders WHERE id=$1`, [p3.j.order.id])).rows[0];
        ok('끝난 내 지시 지우기 = 내 지시에서 빠짐 · 전체 지시엔 남음 · 삭제 아님 · 상태 무변경', hS.status === 200 && !mine2.j.orders.some(o => o.id === p3.j.order.id) && all2.j.orders.some(o => o.id === p3.j.order.id) && rowH.is_deleted === false && rowH.mine_hidden === true && rowH.status === '반려');
        const hU = await call(tokS, 'POST', `/api/agent-office/orders/${p3.j.order.id}/hide-mine`, { hide: false });
        ok('되돌리기 = 내 지시에 다시 보임', hU.status === 200 && (await call(tokS, 'GET', '/api/agent-office/desk/orders?mine=1')).j.orders.some(o => o.id === p3.j.order.id));

        // ── 6-c. 파일 첨부(#469-i): 창구가 만든 엑셀 → DB 보관 → 내려받기
        const ExcelJS = require('exceljs');
        const xlPath = path.join(os.tmpdir(), '검증469_이익률계산기.xlsx');
        { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('이익률'); ws.addRow(['품목', '판매가', '결제가', '이익']); ws.addRow(['시험', 62800, 47000, { formula: 'B2-C2' }]); await wb.xlsx.writeFile(xlPath); }
        const pf = await call(tokS, 'POST', '/api/agent-office/orders', { content: '[검증469] 이익률 계산기 만들어줘' });
        made.push(pf.j.order.id);
        desk('get.js', pf.j.order.id);
        desk('respond.js', pf.j.order.id, tmpJson({ kind: 'answer', title: '이익률 계산기', answer: '[검증469] 시험용 계산기입니다.', attachments: [xlPath] }));
        const rf = await row(pf.j.order.id);
        const fileId = ((rf.result.files || []).find(f => f.file_id) || {}).file_id;
        madeFiles.push(fileId);
        const frow = fileId ? (await db.query(`SELECT filename, size_bytes FROM report_files WHERE id=$1`, [fileId])).rows[0] : null;
        ok('첨부 = DB 보관 · 답변에 파일 번호', !!fileId && frow && frow.filename === '검증469_이익률계산기.xlsx' && frow.size_bytes === fs.statSync(xlPath).size);
        const dl = await fetch(`http://localhost:${PORT}/api/agent-office/files/${fileId}/download?download=1`, { headers: { Authorization: 'Bearer ' + tokS, Connection: 'close' } });
        const dlBuf = Buffer.from(await dl.arrayBuffer());
        ok('직원 계정으로 내려받기 200 · 엑셀 형식 · 내용 동일', dl.status === 200 && /spreadsheetml/.test(dl.headers.get('content-type') || '') && dlBuf.equals(fs.readFileSync(xlPath)));
        let badExt = ''; const pbad = path.join(os.tmpdir(), 'desk469-bad.exe'); fs.writeFileSync(pbad, 'x');
        const pb = await call(tokS, 'POST', '/api/agent-office/orders', { content: '[검증469] 형식 시험' }); made.push(pb.j.order.id); desk('get.js', pb.j.order.id);
        try { desk('respond.js', pb.j.order.id, tmpJson({ kind: 'answer', answer: 'x', attachments: [pbad] })); } catch (e) { badExt = String(e.stderr || e.message); }
        ok('허용하지 않는 형식은 거부 · 지시는 처리중 그대로', /올릴 수 없는 형식/.test(badExt) && (await row(pb.j.order.id)).status === '처리중');

        // ── 7. 실렌더
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const open = async (tok, user, vw) => {
            const ctx = await browser.newContext({ viewport: vw || { width: 1000, height: 900 } });   // 1024 미만 = 카드 보기(#472)
            const pg = await ctx.newPage();
            const errors = []; pg.on('pageerror', e => errors.push(String(e)));
            pg.on('dialog', d => d.accept());
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); }, [tok, user]);
            await pg.reload({ waitUntil: 'networkidle' });
            await pg.waitForTimeout(2500);
            await pg.evaluate(() => { const n = document.querySelector('.nav-item[data-page="agent-office"]'); if (n) n.click(); else if (typeof switchPage === 'function') switchPage('agent-office'); });
            await pg.waitForSelector('#desk-list .desk-card, #desk-list .desk-table, #desk-list .desk-empty', { timeout: 20000 });
            await pg.waitForTimeout(800);
            return { pg, errors, ctx };
        };
        const A = await open(tokA, { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' });
        const v = await A.pg.evaluate(() => {
            const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
            return {
                root: vis(document.getElementById('ao-desk-root')), legacyOffice: vis(document.getElementById('ao-office')), legacyBar: vis(document.getElementById('ao-order-bar')),
                biz: vis(document.getElementById('ao-biz-filter')), title: document.querySelector('#desk-ask h2').textContent,
                clock: document.getElementById('desk-clock').textContent, state: document.getElementById('desk-state-text').textContent,
                img: document.getElementById('desk-char').naturalWidth, panels: document.querySelectorAll('#desk-board .desk-panel').length,
                weather: /날씨/.test(document.getElementById('ao-desk-root').textContent), maru: /마루/.test(document.getElementById('ao-desk-root').textContent),
                approvalTab: !document.getElementById('desk-tab-approval').hidden, overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
            };
        });
        ok('새 화면 표시 · 종전 조직도·입력바·법인/오션라운지 필터 숨김', v.root && !v.legacyOffice && !v.legacyBar && !v.biz);
        ok('「클코에게 지시하기」 · 시계 · 창구 상태 · 캐릭터 그림 로드', v.title === '클코에게 지시하기' && /\d\d:\d\d/.test(v.clock) && !!v.state && v.img > 0, `${v.clock} / ${v.state}`);
        ok('현황판 4칸(대표: 채널·발송·할 일·정산 회차) · 날씨 없음 · 「마루」 글자 없음', v.panels === 4 && !v.weather && !v.maru);
        ok('대표 = 대표 확인함 탭 보임 · 가로 넘침 없음', v.approvalTab && !v.overflow);
        // 지시 보내기(실클릭) — POST는 가로채 실DB 무변경
        const posts = [];
        await A.pg.route('**/api/agent-office/orders', route => { if (route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok', engine: 'desk', order: { id: 0, status: '대기' } }) }); } return route.continue(); });
        await A.pg.fill('#desk-input', '화면 검증 지시');
        await A.pg.click('#desk-send');
        await A.pg.waitForTimeout(800);
        ok('입력 → [지시 보내기] 실클릭 = POST 1회 · 입력칸 비워짐', posts.length === 1 && posts[0].content === '화면 검증 지시' && (await A.pg.inputValue('#desk-input')) === '');
        await A.pg.click('#desk-send');
        await A.pg.waitForTimeout(300);
        ok('빈 입력은 보내지 않음', posts.length === 1);
        await A.pg.unroute('**/api/agent-office/orders');
        // 전체 지시 탭: 검증 답변 카드
        await A.pg.click('.desk-tab[data-tab="all"]');
        await A.pg.waitForSelector(`#desk-list .desk-card[data-oid="${p1.j.order.id}"]`, { timeout: 10000 });
        const card = await A.pg.evaluate(id => { const c = document.querySelector(`#desk-list .desk-card[data-oid="${id}"]`); return { badge: c.querySelector('.desk-badge').textContent, a: c.querySelector('.desk-a').textContent, copy: !!c.querySelector('[data-act="copy"]') }; }, p1.j.order.id);
        ok('답변 카드 = 완료 배지 · 제목·본문 · [답변 복사]', card.badge === '완료' && card.a.includes('오늘 발송 박스') && card.a.includes('검증용 답변입니다.') && card.copy);
        const rejCard = await A.pg.evaluate(id => { const c = document.querySelector(`#desk-list .desk-card[data-oid="${id}"]`); return c ? c.textContent : ''; }, p3.j.order.id);
        const dlReq = [];
        A.pg.on('request', rq => { if (rq.url().includes('/api/agent-office/files/') && rq.url().includes('/download')) dlReq.push(rq.url()); });
        const fbtn = await A.pg.evaluate(id => { const c = document.querySelector(`#desk-list .desk-card[data-oid="${id}"]`); const b = c && c.querySelector('[data-act="file"]'); return b ? { text: b.textContent, h: Math.round(b.getBoundingClientRect().height) } : null; }, pf.j.order.id);
        if (fbtn) { await A.pg.click(`#desk-list .desk-card[data-oid="${pf.j.order.id}"] [data-act="file"]`); await A.pg.waitForTimeout(1500); }
        ok('파일 카드 = [내려받기] 버튼 · 실클릭 = 내려받기 요청 1회', !!fbtn && /검증469_이익률계산기.xlsx 내려받기/.test(fbtn.text) && fbtn.h >= 40 && dlReq.length === 1 && dlReq[0].includes('/files/' + fileId + '/'), JSON.stringify(fbtn));
        ok('반려 카드 = 사유 표시 · 승인 버튼 없음', /시험 반려/.test(rejCard) && !/승인하고 실행/.test(rejCard));
        // #469-b: 보고서함 탭 없음 — 탭 = 내 지시·전체 지시(+관리자 대표 확인함)
        const tabs = await A.pg.evaluate(() => {
            const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
            return { names: Array.from(document.querySelectorAll('#desk-tabs .desk-tab')).filter(vis).map(t => t.dataset.tab), rep: vis(document.getElementById('ao-reports-view')), repExists: !!document.getElementById('ao-report-tbody'), text: /보고서함/.test(document.getElementById('ao-desk-root').textContent) };
        });
        ok('보고서함 탭·표 없음 · 탭 = 내 지시·전체 지시·대표 확인함(관리자) · 마크업 id는 보존', tabs.names.join(',') === 'mine,all,approval' && !tabs.rep && tabs.repExists && !tabs.text, tabs.names.join(','));
        // 오늘 할 일 알림 = 「지금 챙길 일」 칸 (일정표와 같은 조건)
        const rem = await call(tokS, 'GET', '/api/agent-office/today-reminders');
        const brd = await call(tokS, 'GET', '/api/agent-office/desk/board');
        const remTodo = (brd.j.todo || []).filter(t => t.key === 'remind');
        ok('현황판 할 일의 일정 줄 = 기존 오늘 할 일 알림과 같은 건수·같은 문구', remTodo.length === rem.j.reminders.length && remTodo.every((t, i) => t.label === rem.j.reminders[i].line && t.when === rem.j.reminders[i].when), `${remTodo.length}건`);
        await A.pg.route('**/api/agent-office/desk/board', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [], ship: [], sales: [], is_admin: true, todo: [{ key: 'remind', when: '내일', label: '9/30(수) 14:00 황금향 특가 문자 [문자발송]', count: 1, where: '일정 · 문자발송' }, { key: 'reward', label: '룰렛 당첨 미지급', count: 2, where: '문의 관리 · 당첨 지급' }] }) }));
        await A.pg.evaluate(() => __aoDesk.loadBoard());
        await A.pg.waitForTimeout(600);
        const todoTxt = await A.pg.evaluate(() => Array.from(document.querySelectorAll('#desk-board .desk-todo li')).map(li => li.querySelector('span').textContent + '|' + li.querySelector('b').textContent + '|' + li.querySelector('small').textContent));
        ok('할 일 칸 표시 = 일정 줄은 「내일」 · 다른 항목은 건수', todoTxt.length === 2 && todoTxt[0] === '9/30(수) 14:00 황금향 특가 문자 [문자발송]|내일|일정 · 문자발송' && /\|2건\|/.test(todoTxt[1]), todoTxt.join(' / '));
        await A.pg.unroute('**/api/agent-office/desk/board');
        // 확인표 창(기존 모달) 열기 — 가짜 확인표
        await A.pg.click('.desk-tab[data-tab="all"]');
        await A.pg.waitForSelector('#desk-list .desk-card', { timeout: 10000 });
        const modalOk = await A.pg.evaluate(() => { try { aoShowSettlementConfirm({ type: 'settlement_ocr_confirm', order_id: 0, partner: '효돈농협', date: '2031-01-06', box_total: 1, rows: [{ name: 'x', matched: 'x', qty: 1, price: 1000, subtotal: 1000 }], total: 1000, unmatched: [], candidates: { '효돈농협': { rows: [{ name: 'x', matched: 'x', qty: 1, price: 1000, subtotal: 1000 }], total: 1000, unmatched: [], box_total: 1, catalog: [] } } }); return !!document.querySelector('.ao-settle-overlay'); } catch (e) { return String(e); } });
        ok('정산 확인표 창(기존)이 새 화면에서 열림', modalOk === true, String(modalOk));
        await A.pg.evaluate(() => { document.querySelectorAll('.ao-settle-overlay').forEach(e => e.remove()); aoSettleModalData = null; });
        ok('대표 화면 페이지 오류 0', A.errors.length === 0, A.errors.slice(0, 2).join(' | '));

        // 직원 화면 + 폰 폭
        const B = await open(tokS, { id: staff.id, name: staff.name, position: staff.position || '', role: 'staff' }, { width: 390, height: 844 });
        const w = await B.pg.evaluate(() => ({ approvalTab: !document.getElementById('desk-tab-approval').hidden, panels: document.querySelectorAll('#desk-board .desk-panel').length, overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
            sendH: document.getElementById('desk-send').getBoundingClientRect().height, mineOnly: Array.from(document.querySelectorAll('#desk-list .desk-card')).length }));
        ok('직원(390px) = 대표 확인함 탭 없음 · 현황판 3칸(정산 회차 없음) · 가로 넘침 없음 · 버튼 44px 이상', !w.approvalTab && w.panels === 3 && !w.overflow && w.sendH >= 44, JSON.stringify(w));
        // 내 지시 × 실클릭(직원 · 390px)
        const xInfo = await B.pg.evaluate(ids => { const c = id => document.querySelector(`#desk-list .desk-card[data-oid="${id}"]`); const done = c(ids[0]), wait = c(ids[1]); const x = done && done.querySelector('.desk-x'); const r = x ? x.getBoundingClientRect() : null; return { doneX: !!x, size: r ? [Math.round(r.width), Math.round(r.height)] : null, waitX: !!(wait && wait.querySelector('.desk-x')), waitCard: !!wait }; }, [p1.j.order.id, pw.j.order.id]);
        ok('내 지시 카드: 끝난 지시에 × (44px) · 대기 중 지시엔 × 없음', xInfo.doneX && xInfo.size[0] >= 44 && xInfo.size[1] >= 44 && xInfo.waitCard && !xInfo.waitX, JSON.stringify(xInfo));
        await B.pg.click(`#desk-list .desk-card[data-oid="${p1.j.order.id}"] .desk-x`);
        await B.pg.waitForTimeout(900);
        const goneMine = await B.pg.evaluate(id => !document.querySelector(`#desk-list .desk-card[data-oid="${id}"]`), p1.j.order.id);
        await B.pg.click('.desk-tab[data-tab="all"]');
        await B.pg.waitForSelector(`#desk-list .desk-card[data-oid="${p1.j.order.id}"]`, { timeout: 10000 });
        const inAll = await B.pg.evaluate(id => { const c = document.querySelector(`#desk-list .desk-card[data-oid="${id}"]`); return { has: !!c, x: !!(c && c.querySelector('.desk-x')) }; }, p1.j.order.id);
        await B.pg.click('.desk-tab[data-tab="mine"]');
        await B.pg.waitForTimeout(1200);
        const stillGone = await B.pg.evaluate(id => !document.querySelector(`#desk-list .desk-card[data-oid="${id}"]`), p1.j.order.id);
        ok('× 실클릭 = 내 지시에서 사라짐 · 전체 지시엔 그대로(× 없음) · 다시 와도 안 보임', goneMine && inAll.has && !inAll.x && stillGone);
        ok('직원 화면 페이지 오류 0', B.errors.length === 0, B.errors.slice(0, 2).join(' | '));

        // 다른 메뉴 무회귀
        const pages = ['main', 'schedule', 'settlement', 'pricing', 'invoice', 'inquiry', 'data'];
        const bad = [];
        for (const p of pages) {
            const r = await A.pg.evaluate(async name => { const n = document.querySelector(`.nav-item[data-page="${name}"]`); if (!n) return 'no-nav'; n.click(); await new Promise(r => setTimeout(r, 700)); const el = document.getElementById('page-' + name); return el && el.classList.contains('active') && el.offsetHeight > 50 ? 'ok' : 'blank'; }, p);
            if (r !== 'ok' && r !== 'no-nav') bad.push(p + ':' + r);
        }
        const dark = await A.pg.evaluate(() => { const el = document.getElementById('page-data'); return !!el.querySelector('.desk'); });
        ok('다른 메뉴 7곳 진입 정상 · 어두운 테마가 다른 메뉴에 새지 않음 · 오류 0', bad.length === 0 && !dark && A.errors.length === 0, bad.join(',') || A.errors.slice(0, 2).join(' | '));

        // #472 넓은 화면(PC) = 표 보기 · 오른쪽 칸(LIVE 로그·오늘 일정·업무 현황) · 상태 고르개
        const W = await open(tokA, { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, { width: 1440, height: 950 });
        await W.pg.waitForSelector('#desk-list .desk-table, #desk-list .desk-empty', { timeout: 20000 });
        const wide = await W.pg.evaluate(() => {
            const q = sel => document.querySelector(sel);
            const th = Array.from(document.querySelectorAll('#desk-list .desk-table th')).map(e => e.textContent.trim());
            const side = ['desk-live', 'desk-today', 'desk-prog'].map(id => { const e = document.getElementById(id); return e ? e.textContent.trim().length > 0 : false; });
            return {
                table: !!q('#desk-list .desk-table'), card: !!q('#desk-list .desk-card'), th,
                side, quick: document.querySelectorAll('#desk-quick button').length,
                filter: !!q('#desk-fs'), weather: /날씨|구름|℃/.test(document.getElementById('ao-desk-root').textContent),
                light: getComputedStyle(q('.desk-panel')).backgroundColor,
                overflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2,
            };
        });
        ok('PC = 표 보기(카드 아님) · 머리글 6칸', wide.table && !wide.card && wide.th.length === 6, wide.th.join(' | '));
        ok('오른쪽 칸 3개가 내용을 그린다', wide.side.every(Boolean), JSON.stringify(wide.side));
        ok('빠른 실행 5개 · 상태 고르개 · 날씨 없음', wide.quick === 5 && wide.filter && !wide.weather, '버튼 ' + wide.quick + '개');
        ok('밝은 화면 · 가로 넘침 없음', /255, 255, 255/.test(wide.light) && !wide.overflow, wide.light);
        const more = await W.pg.$('#desk-list .desk-more');
        if (more) {
            await more.click(); await W.pg.waitForTimeout(600);
            const opened = await W.pg.evaluate(() => !!document.querySelector('#desk-list .detailrow'));
            ok('표에서 ⋯ 를 누르면 자세한 내용이 펼쳐진다', opened);
        } else ok('표에 펼칠 행이 없어 건너뜀', true);
        await W.pg.selectOption('#desk-fs', 'err');
        await W.pg.waitForTimeout(600);
        const filtered = await W.pg.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#desk-list .desk-table tr.row'));
            const bad = rows.filter(r => !/오류|반려/.test(r.querySelector('.desk-badge').textContent)).length;
            return { rows: rows.length, bad, empty: !!document.querySelector('#desk-list .desk-empty') };
        });
        ok('상태 고르개 = 고른 것만 남는다', filtered.bad === 0, JSON.stringify(filtered));
        ok('넓은 화면 페이지 오류 0', W.errors.length === 0, W.errors.slice(0, 2).join(' | '));
    } catch (e) {
        ok('검증 중 예외 없음', false, e.message);
    } finally {
        try {
            if (db) {
                if (made.length) {
                    await db.query(`UPDATE pending_orders SET is_deleted=true WHERE id = ANY($1::int[])`, [made]);
                    await db.query(`UPDATE agent_runs SET is_deleted=true WHERE id IN (SELECT run_id FROM pending_orders WHERE id = ANY($1::int[]) AND run_id IS NOT NULL)`, [made]);
                }
                if (madeFiles.filter(Boolean).length) await db.query(`UPDATE report_files SET is_deleted=true WHERE id = ANY($1::int[])`, [madeFiles.filter(Boolean)]);
                if (S_nid0 != null) await db.query(`DELETE FROM notifications WHERE type='desk' AND id > $1`, [S_nid0]);
                await db.query(`DELETE FROM agent_office_config WHERE key='desk_heartbeat'`);
                const left = (await db.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE content LIKE '[검증469]%' AND is_deleted=false`)).rows[0].c;
                ok('시험 지시 정리(숨김 처리) · 시험 알림 삭제', left === 0, `시험 지시 ${made.length}건`);
                await db.end();
            }
        } catch (e) { console.error('정리 실패:', e.message); }
        if (browser) await browser.close().catch(() => { });
        if (srv) srv.kill();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과 ${pass}/${results.length}`);
        process.exit(pass === results.length ? 0 : 1);
    }
})();
