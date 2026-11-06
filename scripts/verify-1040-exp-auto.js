// #1040 체험 번호 자동 입력 검증 — 🔴 실DB 0 · 발송 0 · 어사이드 0
//   ① 순수 함수(experience.js _auto · scripts/vm/exp-phone-auto.js parseRow·inWindow) 떼어 실행
//   ② 라우트 3개 왕복 = pglite(메모리 DB) + experience.js 실제 mount(noTimers) + 가짜 알림톡·텔레그램 · 포트 3458
//   pglite 경로 = env PGLITE_PATH(없으면 아래 기본 · 워커 스크래치에 깔린 것)
'use strict';
const path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '..');
const PGL = process.env.PGLITE_PATH || 'C:/Users/전승범/AppData/Local/Temp/claude/C--Users-----OneDrive------------------/309bf877-27c9-49ba-a44a-611324a7f2aa/scratchpad/pgl/node_modules/@electric-sql/pglite';
const PORT = Number(process.env.PORT1040 || 3458);
const express = require(path.join(ROOT, 'node_modules', 'express'));
const EXP = require(path.join(ROOT, 'experience.js'));
const VM = require(path.join(ROOT, 'scripts', 'vm', 'exp-phone-auto.js'));
const A = EXP._auto;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra ? ' · ' + extra : '')); } };
const kst = (h, m) => new Date(Date.UTC(2026, 10, 6, h, m));

function unit() {
    console.log('\n[1] 이름 대조');
    ok('가린 이름 일치 전*범 = 전승범', A.autoNameOk('전*범', '전승범'));
    ok('가린 이름 「님」·빈칸 무시', A.autoNameOk('전*범님', ' 전승범 님'));
    ok('끝 글자 다름 = 거름', !A.autoNameOk('전*범', '전승법'));
    ok('첫 글자 다름 = 거름', !A.autoNameOk('전*범', '김승범'));
    ok('글자 수 다름 = 거름', !A.autoNameOk('전*범', '전승범이'));
    ok('전부 가림 = 거름', !A.autoNameOk('***', '홍길동'));
    ok('화면 이름에 * = 거름', !A.autoNameOk('전*범', '전*범'));
    ok('안 가린 이름 = 완전 일치', A.autoNameOk('홍길동', '홍길동') && !A.autoNameOk('홍길동', '홍길순'));
    ok('DB 이름 없음 = 거름', !A.autoNameOk(null, '홍길동'));

    console.log('\n[2] 번호 고르기(이용고객 먼저)');
    ok('규칙 상수 = 이용고객 → 예약자', JSON.stringify(A.PHONE_PICK_ORDER) === '["visitor_phone","booker_phone"]');
    let p = A.autoPickPhone({ visitor_phone: '010-1111-2222', booker_phone: '01033334444' });
    ok('둘 다 있음 = 이용고객', p && p.phone === '01011112222' && p.picked === 'visitor_phone');
    p = A.autoPickPhone({ visitor_phone: '', booker_phone: '010 3333 4444' });
    ok('이용고객 빈칸 = 예약자', p && p.phone === '01033334444' && p.picked === 'booker_phone');
    p = A.autoPickPhone({ visitor_phone: '02-123-4567', booker_phone: '01033334444' });
    ok('이용고객 꼴 틀림(02) = 예약자', p && p.picked === 'booker_phone');
    ok('둘 다 없음 = null', A.autoPickPhone({}) === null);

    console.log('\n[3] 시간 창(08~21 · 09:25~09:45 건너뜀)');
    const c = A.AUTO_DEFAULT;
    ok('07:59 밖', !A.autoInWindow(c, kst(7, 59)));
    ok('08:00 안', A.autoInWindow(c, kst(8, 0)));
    ok('09:24 안', A.autoInWindow(c, kst(9, 24)));
    ok('09:25 건너뜀', !A.autoInWindow(c, kst(9, 25)));
    ok('09:44 건너뜀', !A.autoInWindow(c, kst(9, 44)));
    ok('09:45 안', A.autoInWindow(c, kst(9, 45)));
    ok('20:59 안 · 21:00 밖', A.autoInWindow(c, kst(20, 59)) && !A.autoInWindow(c, kst(21, 0)));
    ok('VM 쪽 창도 같음', VM.inWindow({ hours: [8, 21], skip: ['09:25', '09:45'] }, kst(9, 30)) === false && VM.inWindow({ hours: [8, 21], skip: ['09:25', '09:45'] }, kst(10, 0)) === true);

    console.log('\n[4] 서버 재대조(autoCheck)');
    const row = { source: 'place', status: 'confirmed', order_no: '1396624487', name: '박*현', visit_date: '2026-11-09', visit_time: '12:30' };
    const good = { order_no_seen: '1396624487', status_seen: '확정', visit_seen: { date: '2026-11-09', time: '12:30' }, name_seen: '박지현', visitor_phone: '01011112222', booker_phone: '01033334444' };
    let r = A.autoCheck(row, good);
    ok('전부 맞음 = 통과 · 이용고객 번호 · 이름 전체', r.ok && r.phone === '01011112222' && r.name === '박지현');
    ok('예약번호 다름', A.autoCheck(row, { ...good, order_no_seen: '1396624488' }).reason === 'order_no');
    ok('날짜 다름', A.autoCheck(row, { ...good, visit_seen: { date: '2026-11-10', time: '12:30' } }).reason === 'date');
    ok('시간 다름', A.autoCheck(row, { ...good, visit_seen: { date: '2026-11-09', time: '13:30' } }).reason === 'time');
    ok('시간 9:05 = 09:05 같게 봄', A.autoCheck({ ...row, visit_time: '09:05' }, { ...good, visit_seen: { date: '2026-11-09', time: '9:05' } }).ok);
    ok('이름 다름', A.autoCheck(row, { ...good, name_seen: '김지현' }).reason === 'name');
    ok('화면 상태 취소', A.autoCheck(row, { ...good, status_seen: '취소' }).reason === 'status_seen');
    ok('DB 상태 취소', A.autoCheck({ ...row, status: 'canceled' }, good).reason === 'status_db');
    ok('수기(manual) 줄 거름', A.autoCheck({ ...row, source: 'manual' }, good).reason === 'source');
    ok('번호 둘 다 없음', A.autoCheck(row, { ...good, visitor_phone: null, booker_phone: null }).reason === 'phone');
    ok('보낸 phone 이 규칙과 다름', A.autoCheck(row, { ...good, phone: '01033334444' }).reason === 'phone_pick');

    console.log('\n[5] VM 화면 줄 판독(parseRow)');
    let q = VM.parseRow({ text: '확정 홍길동 010-1234-5678 1396624487 26.11.09.(일) 12:30 체험 1', cells: [] }, '1396624487');
    ok('#997 꼴 = 예약자 번호 · 날짜·시간', q.how === 'line' && q.booker_phone === '01012345678' && !q.visitor_phone && q.visit_seen.date === '2026-11-09' && q.visit_seen.time === '12:30' && q.status_seen === '확정' && q.name_seen === '홍길동');
    q = VM.parseRow({ text: '확정 1396624487 …', cells: [{ h: '상태', t: '확정' }, { h: '예약자', t: '홍길동 010-1234-5678' }, { h: '이용고객', t: '김영희 010-9999-8888' }, { h: '예약번호', t: '1396624487' }, { h: '이용일시', t: '26.11.09.(일) 오후 1:30' }] }, '1396624487');
    ok('머리글 칸 = 이용고객·예약자 둘 다', q.how === 'cells' && q.visitor_phone === '01099998888' && q.booker_phone === '01012345678' && q.name_seen === '홍길동');
    ok('「오후 1:30」 = 13:30', q.visit_seen.time === '13:30');
    q = VM.parseRow({ text: '확정 예약번호 1396624487 이용일시 26.11.09.(일) 오전 10:00 예약자 홍길동 010-1234-5678 이용고객 김영희 010-9999-8888', cells: [] }, '1396624487');
    ok('줄 안 낱말 꼴 = 둘 다', q.how === 'labels' && q.visitor_phone === '01099998888' && q.booker_phone === '01012345678' && q.visit_seen.time === '10:00');
    q = VM.parseRow({ text: '이상한 꼴 1396624487', cells: [] }, '1396624487');
    ok('꼴 모름 = how 빈칸(저장 안 함)', !q.how && !q.booker_phone);
    let js = VM.JS_READ('1396624487'); let syn = true; try { new Function('return ' + js); } catch (e) { syn = false; }
    ok('화면 코드 문법', syn);
    ok('목록 주소 = keyword=예약번호', VM.LIST_URL('1396624487') === 'https://partner.booking.naver.com/bizes/1258756/booking-list-view?keyword=1396624487');
}

async function routes() {
    console.log('\n[6] 라우트 왕복(pglite)');
    const { PGlite } = require(PGL);
    const db = new PGlite();
    const conv = v => (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
    const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; };
    const pool = { query: q, connect: async () => ({ query: q, release() { } }) };
    await db.query(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB)`);
    const audits = [], tg = [], sends = [];
    const app = express(); app.use(express.json());
    const api = EXP(app, { pool, authMiddleware: (r, s, n) => { r.user = { id: 1, name: '시험' }; n(); }, adminOnly: (r, s, n) => n(), writeAudit: async a => { audits.push(a); },
        notifyTelegram: m => { tg.push(m); }, noTimers: true,
        kakaoNotify: { sendAlimtalk: async o => { sends.push(o); return { status: 'sent' }; }, sendLms: async o => { sends.push(o); return { status: 'sent' }; }, smsSafe: s => s } });
    await api.ready;
    const T = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), F = new Date(Date.now() + 9 * 3600e3 + 3 * 86400e3).toISOString().slice(0, 10), P = new Date(Date.now() + 9 * 3600e3 - 2 * 86400e3).toISOString().slice(0, 10);
    const ins = async (o) => (await q(`INSERT INTO experience_bookings (source, ext_key, order_no, name, phone, visit_date, visit_time, date_ok, exp_count, status, contact_at) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,1,$8,$9) RETURNING id`,
        [o.source || 'place', o.key, o.no, o.name, o.phone || null, o.date || F, o.time || '12:30', o.status || 'confirmed', o.contact || null])).rows[0].id;
    const idA = await ins({ key: 'place:1001', no: '1001', name: '박*현' });
    const idB = await ins({ source: 'manual', key: 'manual:x', no: 'M1', name: '수기' });
    const idC = await ins({ key: 'place:1003', no: '1003', name: '취*', status: 'canceled' });
    const idD = await ins({ key: 'place:1004', no: '1004', name: '지*', date: P });
    const idE = await ins({ key: 'place:1005', no: '1005', name: '번*있', phone: '01055556666' });
    const idF = await ins({ key: 'place:1006', no: '1006', name: '사*', contact: new Date().toISOString() });
    const idG = await ins({ key: 'place:1007', no: '1007', name: '박*수', time: '14:00' });
    await q(`INSERT INTO agent_office_config (key, value) VALUES ('experience_notify', $1)`, [{ enabled: true, recv_from: '00:00', recv_to: '23:59', alimtalk: { enabled: true, confirm_tpl: 'UN_1894', remind_tpl: 'UN_1895' } }]);
    const srv = await new Promise(r => { const s = http.createServer(app).listen(PORT, () => r(s)); });
    const TOKEN = 'a'.repeat(64);
    const call = async (m, u, b, tok = TOKEN) => { const r = await fetch(`http://127.0.0.1:${PORT}${u}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (e) { } return { s: r.status, j }; };
    const setCfg = v => q(`INSERT INTO agent_office_config (key, value) VALUES ('experience_auto', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [v]);
    try {
        ok('설정 없음 = 503(잠김)', (await call('GET', '/api/experience/auto/todo')).s === 503);
        await setCfg({ enabled: false, token: TOKEN, daily_max: 30, hours: [0, 24], skip: [] });
        ok('토큰 틀림 = 401', (await call('GET', '/api/experience/auto/todo', null, 'b'.repeat(64))).s === 401);
        ok('토큰 없음 = 401', (await call('GET', '/api/experience/auto/todo', null, '')).s === 401);
        ok('enabled false = 403', (await call('GET', '/api/experience/auto/todo')).s === 403);
        await setCfg({ enabled: true, token: TOKEN, daily_max: 30, hours: [0, 24], skip: [] });
        ok('PUT 도 토큰 틀림 401', (await call('PUT', `/api/experience/auto/${idA}`, {}, 'c'.repeat(64))).s === 401);
        let t = await call('GET', '/api/experience/auto/todo');
        const ids = (t.j.items || []).map(x => x.id).sort((a, b) => a - b);
        ok('todo = 플레이스·확정·번호 없음·오늘 이후만(A·G)', t.s === 200 && JSON.stringify(ids) === JSON.stringify([idA, idG].sort((a, b) => a - b)), JSON.stringify(ids) + ' 제외 기대 ' + [idB, idC, idD, idE, idF]);
        ok('todo 응답에 번호 칸 없음', !JSON.stringify(t.j).match(/01\d{8,9}/) && !('phone' in ((t.j.items || [])[0] || {})));
        const body = (no, nm, extra) => ({ order_no_seen: no, status_seen: '확정', visit_seen: { date: F, time: '12:30' }, name_seen: nm, visitor_phone: '010-1111-2222', booker_phone: '010-3333-4444', ...(extra || {}) });
        let r = await call('PUT', `/api/experience/auto/${idA}`, body('1001', '김지현'));
        ok('이름 불일치 = 400 name · 저장 0', r.s === 400 && r.j.reason === 'name');
        r = await call('PUT', `/api/experience/auto/${idA}`, body('1001', '박지현', { visit_seen: { date: F, time: '13:00' } }));
        ok('시간 불일치 = 400 time', r.s === 400 && r.j.reason === 'time');
        let row = (await q(`SELECT phone, contact_at FROM experience_bookings WHERE id=$1`, [idA])).rows[0];
        ok('불일치 뒤 DB 그대로(번호 빈칸)', !row.phone && !row.contact_at);
        r = await call('POST', `/api/experience/auto/${idA}/miss`, { reason: '이름이 달라요 010-1111-2222' });
        ok('miss 1번째 = 텔레그램 1', r.s === 200 && r.j.told === true && tg.length === 1);
        ok('텔레그램에 손님 번호 없음', !/\d{4}\D?\d{4}/.test(tg[0].replace(/1001/, '')), tg[0]);
        r = await call('POST', `/api/experience/auto/${idA}/miss`, { reason: '또' });
        ok('miss 2번째 같은 날 = 텔레그램 0', r.j.told === false && tg.length === 1 && r.j.n === 2);
        t = await call('GET', '/api/experience/auto/todo');
        ok('miss 30분 안 = todo 에서 빠짐', !(t.j.items || []).some(x => x.id === idA));
        const sends0 = sends.length;
        r = await call('PUT', `/api/experience/auto/${idA}`, body('1001', '박지현'));
        ok('대조 통과 = 200 · 이용고객 번호', r.s === 200 && r.j.picked === 'visitor_phone', JSON.stringify(r.j));
        row = (await q(`SELECT phone, name, contact_by, contact_at, sms_recv_at, sms_recv_via FROM experience_bookings WHERE id=$1`, [idA])).rows[0];
        ok('DB phone = 이용고객 · name = 화면 이름 · contact_by aside-auto', row.phone === '01011112222' && row.name === '박지현' && row.contact_by === 'aside-auto' && !!row.contact_at);
        ok('접수 알림톡 즉시 1통(sendRecvNow · 받는 번호 = 이용고객)', sends.length === sends0 + 1 && sends[sends.length - 1].receiver === '01011112222' && r.j.sent === 'sent' && !!row.sms_recv_at && row.sms_recv_via === 'alimtalk');
        const au = audits.filter(a => a.action === 'experience_phone_auto');
        ok('audit experience_phone_auto 1줄 · 끝 4자리만', au.length === 1 && !/0101111|0103333/.test(JSON.stringify(au[0].changes)) && au[0].changes.after.phone === '…2222' && au[0].actor.name === 'aside-auto');
        r = await call('PUT', `/api/experience/auto/${idA}`, body('1001', '박지현'));
        ok('다시 저장 = 409(덮지 않음)', r.s === 409 && r.j.reason === 'already');
        r = await call('PUT', `/api/experience/auto/${idF}`, body('1006', '사람'));
        ok('사람이 넣은 줄(contact_at) = 409', r.s === 409);
        r = await call('PUT', `/api/experience/auto/${idG}`, body('1007', '박영수', { visit_seen: { date: F, time: '14:00' } }));
        ok('같은 번호 다른 예약(가족) = 저장 · dup_ids 기록', r.s === 200 && Array.isArray(r.j.dup_ids) && r.j.dup_ids.includes(idA), JSON.stringify(r.j));
        r = await call('PUT', `/api/experience/auto/${idG}`, body('1007', '박영수', { visitor_phone: '', visit_seen: { date: F, time: '14:00' } }));
        ok('저장 뒤 같은 줄 = 409', r.s === 409);
        const idH = await ins({ key: 'place:1008', no: '1008', name: '정*' , time: '15:00' });
        r = await call('PUT', `/api/experience/auto/${idH}`, { order_no_seen: '1008', status_seen: '확정', visit_seen: { date: F, time: '15:00' }, name_seen: '정민', visitor_phone: null, booker_phone: '01077778888' });
        ok('이용고객 칸 없음 = 예약자 번호로 저장', r.s === 200 && r.j.picked === 'booker_phone');
        const idI = await ins({ key: 'place:1009', no: '1009', name: '최*', time: '15:00' });
        await setCfg({ enabled: true, token: TOKEN, daily_max: 3, hours: [0, 24], skip: [] });
        t = await call('GET', '/api/experience/auto/todo');
        ok('하루 상한(3 저장함) = todo 빈 목록 · 하루 상한', t.j.items.length === 0 && t.j.reason === '하루 상한');
        r = await call('PUT', `/api/experience/auto/${idI}`, { order_no_seen: '1009', status_seen: '확정', visit_seen: { date: F, time: '15:00' }, name_seen: '최민', booker_phone: '01012121212' });
        ok('하루 상한 = PUT 429', r.s === 429);
        await setCfg({ enabled: true, token: TOKEN, daily_max: 30, hours: [kst(0, 0).getUTCHours(), kst(0, 0).getUTCHours()], skip: [] });
        t = await call('GET', '/api/experience/auto/todo');
        ok('시간 밖 = todo 빈 목록 · 시간 밖', t.j.items.length === 0 && t.j.reason === '시간 밖');
        await setCfg({ enabled: true, token: TOKEN, daily_max: 30, hours: [0, 24], skip: [] });
        const tg0 = tg.length;
        r = await call('POST', `/api/experience/auto/0/miss`, { reason: '네이버 보안 확인 화면', kind: 'security' });
        const r2 = await call('POST', `/api/experience/auto/0/miss`, { reason: '네이버 보안 확인 화면', kind: 'security' });
        ok('id 0 멈춤 알림 = 하루 1번', r.j.told === true && r2.j.told === false && tg.length === tg0 + 1);
        ok('없는 예약 miss = 404', (await call('POST', `/api/experience/auto/999999/miss`, { reason: 'x' })).s === 404);
        ok('없는 예약 PUT = 404', (await call('PUT', `/api/experience/auto/999999`, {})).s === 404);
        // 기존 화면 길 무변경 스모크 = 목록 GET 이 그대로 돎
        const g = await call('GET', `/api/agent-office/experience?from=${T}&to=${F}`, null, null);
        ok('기존 목록 GET 200 · A 번호 보임', g.s === 200 && (g.j.items || []).some(x => x.id === idA && x.phone === '01011112222'));
    } finally { srv.close(); }
}

(async () => {
    unit();
    await routes();
    console.log(`\n결과 ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ''}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('검증 오류:', e); process.exit(1); });
