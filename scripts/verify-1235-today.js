// #1235 검증 — 오늘 챙길 일 띠 · 메뉴 숫자 배지 (가짜 서버 · 실DB 0 · 외부 호출 0 · 포트 3458)
//   가짜 서버 = express + 실제 today-summary.js 모듈(가짜 pool·인증) + 그 화면들이 부르는 API 의 가짜 자료(분기 여는 자료) + public/ 그대로
//   ① 순수: today-rules.js 판정 = 옮기기 전 식(ao-ordermemo badgeK·lineTone · ao-exp noPhone · app.js rvAll) — 모든 조합에서 같은 값
//   ② 띠 숫자 = 그 메뉴 안 숫자(응대 현황 「아직 안 답함」 · 메모함 빨강 줄 · 체험 「번호 미입력」 · 일정 칩 「오늘 일정」)
//   ③ 계정별(대표·관리자(대표 아님)·직원·세무사) 항목·배지 · ④ 끔·전체 실패·일부 실패·전부 0 · ⑤ today-rules.js 가 안 실려도 메모함·체험 화면 같은 결과
//   ⑥ 390·884·1280 넘침·누름 44·메뉴 글 밀림 · 야간 · 그림(390 주간·야간) → ~/.akkome/wip-1235/shots/(저장소 밖)
//   사용: node scripts/verify-1235-today.js
'use strict';
const ROOT = require('path').join(__dirname, '..');
const path = require('path'), fs = require('fs');
const express = require(path.join(ROOT, 'node_modules/express'));
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
const R = require(path.join(ROOT, 'public/today-rules.js'));
const OUT = path.join(require('os').homedir(), '.akkome', 'wip-1235', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3458, B = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 200) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = R.kstToday(), addD = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

// ── ① 순수 비교(옮기기 전 식 = 그대로 베껴 둔 것)
function pure() {
    console.log('\n① 공용 판정 = 옮기기 전 식');
    const OLD_K = { allnormal: 'ok', normal_later: 'later', normal_split: 'later', ok: 'ok', split: 'later', sent_split: 'later', short: 'short', over: 'over', unknown: 'unk', pre: 'unk', personal: 'pers' };
    const oldBadgeK = b => (b.unsure > 0 && !['over', 'personal', 'unknown'].includes(b.state)) ? 'short' : (OLD_K[b.state] || 'unk');
    const oldTone = (lb, ib) => lb ? (lb.state === 'ok' ? 'ok' : lb.state === 'fail' ? 'bad' : '') : ib ? ({ ok: 'ok', over: 'bad', short: 'bad' }[oldBadgeK(ib)] || '') : '';
    const oldNoPhone = (b, t) => (b.source === 'place' || b.source === 'manual') && b.status === 'confirmed' && !(b.phone && String(b.phone).length >= 10) && (!b.visit_date || b.visit_date >= t);
    const oldRvOpen = d => { if (!d || !d.channels) return d ? (d.all ? d.all.open : null) : null; let n = 0; for (const k of ['talk', 'qna', 'inquiry']) { const c = d.channels[k]; if (c) n += Number(c.open) || 0; } return n; };
    let n = 0, bad = 0;
    const states = Object.keys(OLD_K).concat(['weird', undefined]);
    for (const st of states) for (const u of [0, 1, 2, undefined]) { const b = { state: st, unsure: u }; n++; if (R.memoBadgeK(b) !== oldBadgeK(b)) bad++; if (R.memoLineTone(null, b) !== oldTone(null, b)) bad++; }
    for (const ls of ['ok', 'fail', 'unknown', undefined]) for (const st of states) { const lb = { kind: 'line', state: ls }, ib = { state: st, unsure: 1 }; n++; if (R.memoLineTone(lb, ib) !== oldTone(lb, ib)) bad++; if (R.memoLineTone(lb, null) !== oldTone(lb, null)) bad++; }
    ok(bad === 0, `메모함 배지 색·줄 색 ${n}조합 같음`, bad ? bad + '곳 다름' : null);
    let m = 0, bad2 = 0;
    for (const source of ['place', 'manual', 'store', 'x']) for (const status of ['confirmed', 'visited', 'cancelled']) for (const phone of [null, '', '0101', '0101234567', '01012345678']) for (const vd of [null, addD(-1), today, addD(3)]) { const b = { source, status, phone, visit_date: vd }; m++; if (R.expNoPhone(b, today) !== oldNoPhone(b, today)) bad2++; }
    ok(bad2 === 0, `체험 번호 미입력 ${m}조합 같음`, bad2 ? bad2 + '곳 다름' : null);
    const ds = [null, { all: { open: 4 } }, { channels: { talk: { open: 2 }, qna: { open: '3' }, sms: { open: 9 } } }, { channels: {} }, { channels: { inquiry: { open: null } } }];
    ok(ds.every(d => R.inqOpen(d) === oldRvOpen(d) || (d && !d.channels && d.all && R.inqOpen(d) === Number(d.all.open))), '응대 현황 「아직 안 답함」 합 같음(문자 제외)');
}

// ── 가짜 서버
const USERS = { owner: { id: 1, username: 'o', name: '시험대표', role: 'admin', position: '대표', color: '#4F46E5' }, admin2: { id: 3, username: 'a', name: '시험과장', role: 'admin', position: '과장', color: '#12B76A' }, staff: { id: 2, username: 's', name: '시험직원', role: 'staff', position: '대리', color: '#F79009' }, acct: { id: 4, username: 't', name: '시험세무', role: 'accountant', position: '세무사', color: '#667085' } };
const S = { mode: 'normal', statsFail: false, allFail: false };   // mode = normal · zero · off
function memoEntries() {
    if (S.mode === 'zero') return [{ id: 1, created_at: new Date().toISOString(), created_by: '시험', source: 'manual', tags: [], raw: '', rows: [{ id: 11, entry_id: 1, kind: 'line', key: '01011112222', line: '01011112222 S사이즈', note: 'S사이즈', sure: true, state: 'open', check_why: [], missing: [], badge: { kind: 'line', state: 'ok', t: '매칭완료' } }] }];
    const L = (id, badge, line) => ({ id, entry_id: 1, kind: 'line', key: '0101234' + String(1000 + id), line: line || ('0101234' + String(1000 + id) + ' S사이즈'), note: 'S사이즈', plat: '', sure: true, state: 'open', check_why: [], missing: [], ship_date: null, boxes: null, checked: null, ...(badge ? { badge } : {}) });
    return [{ id: 1, created_at: new Date().toISOString(), created_by: '시험', source: 'manual', tags: [], raw: '', rows: [
        L(1, { kind: 'line', state: 'fail', why: '주문 없음' }),
        L(2, { kind: 'line', state: 'ok', t: '매칭완료' }),
        L(3, { state: 'short', n: 1, m: 2 }, '01012341003 입력삭제'),
        L(4, { state: 'ok', n: 2, m: 2, unsure: 1 }, '01012341004 입력삭제'),
        L(5, { state: 'over', n: 3, m: 2 }, '01012341005 입력삭제'),
        L(6, { state: 'personal', n: 1, m: 1, unsure: 1 }, '01012341006 입력삭제'),
        L(7, { state: 'unknown' }, '01012341007 입력삭제'),
        L(8, null),
        { id: 9, entry_id: 1, kind: 'cash', cells: ['시험 드림', '01099998888', '받는분', '01077776666', '제주시 어딘가 1', '노지감귤 5kg', '1'], sure: true, state: 'open', check_why: [], missing: [], indiv: true, service: false, exp_site: false },
    ] }];
}
const EXP = () => S.mode === 'zero' ? [] : [
    { id: 1, source: 'place', status: 'confirmed', name: '가', phone: null, visit_date: today, visit_time: '10:00', date_ok: true, exp_count: 2 },
    { id: 2, source: 'manual', status: 'confirmed', name: '나', phone: '0101', visit_date: addD(1), visit_time: '11:00', date_ok: true, exp_count: 1 },
    { id: 3, source: 'place', status: 'confirmed', name: '다', phone: '01012345678', visit_date: addD(2), visit_time: '13:00', date_ok: true, exp_count: 1 },
    { id: 4, source: 'place', status: 'cancelled', name: '라', phone: null, visit_date: addD(3), visit_time: '14:00', date_ok: true, exp_count: 1 },
    { id: 5, source: 'store', status: 'confirmed', name: '마', phone: null, visit_date: addD(4), visit_time: '15:00', date_ok: true, exp_count: 1 },
    { id: 6, source: 'place', status: 'confirmed', name: '바', phone: null, visit_date: addD(-1), visit_time: '10:30', date_ok: true, exp_count: 1 },
    { id: 7, source: 'manual', status: 'confirmed', name: '사', phone: null, visit_date: null, visit_time: null, date_ok: false, exp_count: 1 },
];
const SCHED = () => S.mode === 'zero' ? [] : [{ id: 1, date: today, type: 'work', title: '시험 일정 1', userName: '시험대표' }, { id: 2, date: today, type: 'personal', title: '시험 일정 2', userName: '시험대표' }, { id: 3, date: today, type: 'duty', userName: '시험직원', title: '당직' }];
const STATS = () => ({ days: 7, from: addD(-6), to: today, channels: S.mode === 'zero' ? { talk: { total: 3, bot: 3, staff: 0, open: 0 } } : { talk: { total: 10, bot: 5, staff: 2, open: 3 }, qna: { total: 4, bot: 2, staff: 1, open: 1 }, inquiry: { total: 2, bot: 1, staff: 0, open: 1 }, sms: { total: 9, bot: 0, staff: 0, open: 9 } }, all: { total: 25, bot: 8, staff: 3, open: 14 } });
const RECON = () => ({ today, rows: S.mode === 'zero' ? [{ expect_date: addD(-1), basis_start: addD(-2), basis_end: addD(-2), status: 'ok' }] : [{ expect_date: addD(-3), basis_start: addD(-4), basis_end: addD(-4), status: 'ok' }, { expect_date: addD(-1), basis_start: addD(-2), basis_end: addD(-2), status: 'warn', settle_amount: 100000, input_sum: 90000 }, { expect_date: addD(2), basis_start: addD(1), basis_end: addD(1), status: 'no-input' }] });
let SUMMARY_HITS = 0, TS_MOD = null; const HITS = { memo: 0, stats: 0, exp: 0 }, LOGS = [];
const setMode = (m, sf, af) => { S.mode = m; S.statsFail = !!sf; S.allFail = !!af; if (TS_MOD) TS_MOD._t.clear(); };
function startServer() {
    const app = express(); app.use(express.json());
    const auth = (req, res, next) => { const t = String(req.headers.authorization || '').replace('Bearer ', ''); const u = USERS[t]; if (!u) return res.status(401).json({ error: '인증' }); req.user = u; next(); };
    const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: '관리자만' });
    const pool = { query: async (sql) => {
        if (/today_summary/.test(sql)) return { rows: S.mode === 'off' ? [{ value: { enabled: false } }] : [] };
        if (/pending_orders/.test(sql)) return { rows: [{ n: S.mode === 'zero' ? 0 : 2 }] };
        throw new Error('가짜 pool 모르는 쿼리');
    } };
    app.use((req, res, next) => { if (req.path === '/api/today-summary') SUMMARY_HITS++; next(); });
    TS_MOD = require(path.join(ROOT, 'today-summary.js'))(app, { pool, authMiddleware: auth, log: { error: (...a) => LOGS.push(a.join(' ')) } });
    app.get('/api/auth/me', auth, (req, res) => res.json(req.user));
    app.get('/api/agent-office/response-stats', auth, (req, res) => (HITS.stats++, S.statsFail || S.allFail) ? res.status(500).json({ error: 'x' }) : res.json(STATS()));
    app.get('/api/order-memo', auth, (req, res) => { HITS.memo++; if (S.allFail) return res.status(500).json({ error: 'x' }); const entries = memoEntries(); const rows = entries.flatMap(e => e.rows); res.json({ ok: true, keep_days: 30, ship_date: addD(1), entries, counts: { open: rows.length, unsure: 0, stale: 0, wait: 0, next: rows.length, cleared: 0 } }); });
    app.get('/api/agent-office/experience', auth, (req, res) => (HITS.exp++, S.allFail) ? res.status(500).json({ error: 'x' }) : res.json({ ok: true, items: EXP(), sales: [], settings_view: { alimtalk: true } }));
    app.get('/api/agent-office/settle-recon', auth, adminOnly, (req, res) => res.json(RECON()));
    app.get('/api/schedules', auth, (req, res) => res.json(SCHED()));
    app.get('/api/notifications', auth, (req, res) => res.json([]));
    app.get('/api/notifications/unread-count', auth, (req, res) => res.json({ count: 0 }));
    app.all('/api/*', auth, (req, res) => res.json(req.method === 'GET' ? (/list|s$/.test(req.path) ? [] : {}) : { ok: true }));
    app.use(express.static(path.join(ROOT, 'public')));
    return new Promise(r => { const s = app.listen(PORT, '127.0.0.1', () => r(s)); });
}

async function apiCheck() {
    console.log('\n②-a 서버 셈(브라우저 없이 · 실제 today-summary.js · 그 화면 API 를 같은 토큰으로 다시 부름)');
    const get = tok => new Promise(r => require('http').get({ host: '127.0.0.1', port: PORT, path: '/api/today-summary', headers: { authorization: 'Bearer ' + tok } }, s => { let b = ''; s.on('data', d => b += d); s.on('end', () => r(JSON.parse(b))); }));
    const memoBad = memoEntries().flatMap(e => e.rows).filter(R.memoRowBad).length, expN = EXP().filter(b => R.expNoPhone(b, today)).length, inqN = R.inqOpen(STATS());
    let d = await get('owner');
    ok(d.ok && d.counts.memo === memoBad && memoBad === 4, '메모함 확인 필요 = 화면 판정 4줄(fail·short·확인 줄·over · personal·unknown·ok 는 아님)', JSON.stringify(d.counts));
    ok(d.counts.exp === expN && expN === 3, '체험 번호 미입력 = 3건(오늘·내일·날짜 없음 · 지난날·취소·스토어·번호 있음 빠짐)');
    ok(d.counts.inq === inqN && inqN === 5, '미답 = 5건(톡톡 3 + 상품문의 1 + 고객문의 1 · 문자 9 제외)');
    ok(d.counts.appr === 2 && d.counts.recon && d.counts.recon.status === 'warn' && d.counts.recon.expect_date === addD(-1), '대표 = 승인 2 · 정산 대조 = 오늘 이전 최근 회차(warn · 앞날 no-input 무시)', JSON.stringify(d.counts.recon));
    d = await get('admin2'); ok(d.counts.appr === null && d.counts.recon === null && d.counts.memo === 4, '관리자(대표 아님) = 승인·정산 null');
    d = await get('staff'); ok(d.counts.appr === null && d.counts.recon === null && d.counts.inq === 5, '직원 = 승인·정산 null · 나머지 같음');
    d = await get('acct'); ok(d.ok && JSON.stringify(d.counts) === '{}', '세무사 = 빈 값');
    S.mode = 'off'; d = await get('owner'); ok(d.off === true, '끔 = { off:true }(캐시보다 먼저 봄)'); setMode('normal');
    setMode('normal', true); await get('owner'); setMode('normal', true); d = await get('staff'); ok(d.counts.inq === null && d.counts.memo === 4, '응대 숫자만 실패 = inq null · 나머지 그대로'); setMode('normal');
    setMode('normal'); const h0 = HITS.memo, h1 = HITS.stats; const [p1, p2, p3] = await Promise.all([get('owner'), get('staff'), get('admin2')]);
    ok(HITS.memo - h0 === 1 && HITS.stats - h1 === 1 && p1.counts.memo === 4 && p2.counts.memo === 4 && p3.counts.inq === 5, '공용 한 벌 + 진행 중 합치기 = 같은 순간 세 계정 → 안쪽 호출 1번씩 · 값 같음', `memo ${HITS.memo - h0} · stats ${HITS.stats - h1}`);
    const h2 = HITS.memo; await get('staff'); ok(HITS.memo === h2, '60초 안 다른 계정 = 안쪽 호출 0(공용 캐시)');
    setMode('normal', false, true); d = await get('owner'); ok(d.counts.inq === null && d.counts.memo === null && d.counts.exp === null && d.counts.appr === 2, '세 화면 API 전부 실패 = null(0 아님) · 승인은 따로'); setMode('normal');
    const first = LOGS.filter(l => /첫 안쪽 호출/.test(l)), failL = LOGS.filter(l => /미답 문의 못 읽음/.test(l));
    ok(first.length === 1 && /첫 안쪽 호출: 성공$/.test(first[0]) && !/d/.test(first[0].replace('#1235', '')), '서버 로그 = 기동 뒤 첫 안쪽 호출 「성공」 한 줄(숫자 없음)', first.join(' | '));
    ok(failL.length === 1, '같은 사유 실패 로그 = 10분에 1번(응대 실패 2회 → 1줄)', failL.length);
    d = await get('staff'); setMode('zero'); const d2 = await get('staff'); setMode('normal'); ok(d2.counts.memo === 0 && d2.counts.exp === 0 && d2.counts.inq === 0, '전부 0 자료 = 0 · 0 · 0');
}

async function main() {
    pure();
    const srv = await startServer();
    await apiCheck();
    if (process.env.AKM_NOPW === '1') { srv.close(); console.log(`\n══ 합계(브라우저 없이) ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ''}`); process.exit(fail ? 1 : 0); }
    const br = await chromium.launch();
    const errs = [];
    const page = async (who, w, theme, block) => {
        const cx = await br.newContext({ viewport: { width: w, height: 900 }, ...(w < 900 ? { isMobile: true, hasTouch: true } : {}) });
        await cx.addInitScript(([u, th]) => { localStorage.setItem('jwt_token', u.k); localStorage.setItem('jwt_user', JSON.stringify(u.u)); localStorage.setItem('akm_ao_theme', th); }, [{ k: who, u: USERS[who] }, theme || 'light']);
        if (block) await cx.route(/today-rules\.js/, r => r.abort());
        const pg = await cx.newPage(); pg.on('pageerror', e => errs.push(who + '/' + w + ' ' + e.message));
        await pg.goto(B + '/', { waitUntil: 'load' }); await sleep(2500);
        return { cx, pg };
    };
    const band = pg => pg.evaluate(() => { const b = document.getElementById('today-band'); return { hidden: !b || b.hidden, items: b ? [...b.querySelectorAll('.tb-item')].map(x => ({ k: x.dataset.ts, l: x.querySelector('.tb-l').textContent, n: x.querySelector('.tb-n').textContent, cls: x.className })) : [], none: b ? !!b.querySelector('.tb-none') : false }; });
    const badges = pg => pg.evaluate(() => { const o = {}; document.querySelectorAll('.nav-item[data-page]').forEach(n => { const b = n.querySelector('.nav-badge'); if (b) o[n.dataset.page] = (b.classList.contains('is-urgent') ? '!' : '') + b.textContent; }); return o; });
    try {
        console.log('\n② 띠 숫자 = 메뉴 안 숫자 (대표 · 1280)');
        let { cx, pg } = await page('owner', 1280);
        let bd = await band(pg); const byK = Object.fromEntries(bd.items.map(x => [x.k, x]));
        ok(!bd.hidden && bd.items.map(x => x.k).join(',') === 'recon,appr,inq,memo,exp,today', '대표 띠 순서 = 정산 대조 → 승인 → 미답 → 메모함 → 체험 → 오늘 일정', bd.items.map(x => x.k).join(','));
        ok(byK.recon && /차이 큼/.test(byK.recon.n) && /정산 대조/.test(byK.recon.l) && /is-fill/.test(byK.recon.cls), '정산 대조 = 최근 회차 warn · 채움 1칸', byK.recon && byK.recon.l + ' ' + byK.recon.n);
        ok(bd.items.filter(x => /is-fill/.test(x.cls)).length === 1, '채움은 1칸만');
        ok(byK.memo && /is-urgent/.test(byK.memo.cls) && !/is-fill/.test(byK.memo.cls) && byK.memo.l === '메모함 빨강 줄', '메모함 = 「메모함 빨강 줄」 · 빨강 테두리(채움 아님)', byK.memo && byK.memo.l);
        const al = await pg.evaluate(() => ['inquiry', 'agent-office', 'settlement', 'schedule'].map(p => (document.querySelector(`.nav-item[data-page="${p}"]`) || {}).getAttribute ? document.querySelector(`.nav-item[data-page="${p}"]`).getAttribute('aria-label') : null));
        ok(al[0] === '문의 관리 (5건)' && al[1] === '에이전트 오피스 (6건)' && al[2] === '정산관리 (확인 필요)' && al[3] === null, '배지 메뉴 aria-label 「(n건)」 · 배지 없는 메뉴는 그대로', JSON.stringify(al));
        ok(byK.appr && byK.appr.n === '2건', '승인 대기 2건');
        const chip = await pg.evaluate(() => { const c = [...document.querySelectorAll('#schedule-brief .sch-b-chip')].find(x => /오늘 일정/.test(x.textContent)); return c ? c.querySelector('b').textContent : null; });
        ok(byK.today && chip && byK.today.n === chip, '오늘 일정 띠 = 일정 칩', (byK.today && byK.today.n) + ' / 칩 ' + chip);
        const bg = await badges(pg);
        ok(bg['agent-office'] === '!6' && bg.inquiry === '5' && bg.settlement === '!!', '배지 = 에이전트 오피스 !6(메모 4 + 승인 2 · 빨강) · 문의 관리 5 · 정산관리 !', JSON.stringify(bg));
        // 메모함 열어 빨강 줄 셈
        await pg.click('#today-band .tb-item[data-ts="memo"]'); await sleep(1800);
        const red = await pg.evaluate(() => document.querySelectorAll('#om-list .om-ml-l.c-bad').length);
        ok(byK.memo && byK.memo.n === red + '줄', '메모함 띠 = 메모함 빨강 줄', byK.memo && byK.memo.n + ' / 화면 ' + red);
        await pg.keyboard.press('Escape'); await sleep(600);
        // 체험 열어 번호 미입력
        await pg.evaluate(() => { if (window.AkmOrderMemo && window.AkmOrderMemo.isOpen()) window.AkmOrderMemo.close(); }); await sleep(400);
        await pg.click('#today-band .tb-item[data-ts="exp"]'); await sleep(2200);
        const np = await pg.evaluate(() => { const p = document.getElementById('xp-nophone'); return p ? p.textContent : null; });
        const npTitle = await pg.evaluate(() => { const t = document.querySelector('.xp-layer h3, .xp-daytitle, .xp-day-h'); return t ? t.textContent : ''; });
        ok(byK.exp && np && np.includes(byK.exp.n), '체험 띠 = 「번호 미입력 n건」', (byK.exp && byK.exp.n) + ' / ' + np + ' ' + npTitle.slice(0, 30));
        await pg.evaluate(() => { if (window.AkmExp && window.AkmExp.isOpen()) window.AkmExp.close(); }); await sleep(400);
        // 승인 대기 → 에이전트 오피스 「이전 채팅 이력」(모두) 탭
        await pg.click('#today-band .tb-item[data-ts="appr"]'); await sleep(2500);
        const tabOn = await pg.evaluate(() => { const t = document.querySelector('#desk-tabs .desk-tab[data-tab="all"]'); return { page: (document.querySelector('.nav-item.active') || {}).dataset ? document.querySelector('.nav-item.active').dataset.page : null, sel: t ? t.getAttribute('aria-selected') : null }; });
        ok(tabOn.page === 'agent-office' && tabOn.sel === 'true', '승인 대기 누름 = 에이전트 오피스 · 「이전 채팅 이력」(승인 카드 탭) 열림', JSON.stringify(tabOn));
        await pg.click('.nav-item[data-page="schedule"]'); await sleep(1200);
        // 문의 관리 응대 현황
        await pg.click('#today-band .tb-item[data-ts="inq"]'); await sleep(1800);
        const rv = await pg.evaluate(() => { const b = document.querySelector('.rv-num.is-open b'); return b ? b.textContent : null; });
        ok(byK.inq && rv === byK.inq.n, '미답 띠 = 응대 현황 「아직 안 답함」(문자 제외)', (byK.inq && byK.inq.n) + ' / ' + rv);
        await cx.close();

        console.log('\n③ 계정별');
        ({ cx, pg } = await page('admin2', 1280)); bd = await band(pg);
        ok(bd.items.map(x => x.k).join(',') === 'memo,inq,exp,today', '관리자(대표 아님) = 정산 대조·승인 없음', bd.items.map(x => x.k).join(','));
        ok(!(await badges(pg)).settlement && (await badges(pg))['agent-office'] === '!4', '관리자 배지 = 에이전트 오피스 !4 · 정산 배지 없음', JSON.stringify(await badges(pg))); await cx.close();
        ({ cx, pg } = await page('staff', 1280)); bd = await band(pg);
        ok(bd.items.map(x => x.k).join(',') === 'memo,inq,exp,today' && /is-fill/.test(bd.items[0].cls), '직원 = 메모함(채움) → 미답 → 체험 → 오늘 일정', bd.items.map(x => x.k + (/is-fill/.test(x.cls) ? '*' : '')).join(','));
        await cx.close();
        const hits0 = SUMMARY_HITS;
        ({ cx, pg } = await page('acct', 1280)); bd = await band(pg);
        ok(bd.hidden && !Object.keys(await badges(pg)).length && SUMMARY_HITS === hits0, '세무사 = 띠·배지 없음 · 요청 0', `hidden ${bd.hidden} · 요청 ${SUMMARY_HITS - hits0}`); await cx.close();

        console.log('\n④ 끔 · 전체 실패 · 일부 실패 · 전부 0');
        setMode('off'); ({ cx, pg } = await page('owner', 1280)); bd = await band(pg);
        ok(bd.hidden && !Object.keys(await badges(pg)).length, '끔(설정 today_summary {enabled:false}) = 띠·배지 숨김'); await cx.close();
        setMode('normal');
        ({ cx } = { cx: await br.newContext({ viewport: { width: 1280, height: 900 } }) });
        await cx.addInitScript(u => { localStorage.setItem('jwt_token', 'owner'); localStorage.setItem('jwt_user', JSON.stringify(u)); }, USERS.owner);
        await cx.route(/\/api\/today-summary/, r => r.fulfill({ status: 500, body: '{}' }));
        pg = await cx.newPage(); pg.on('pageerror', e => errs.push('down ' + e.message)); await pg.goto(B + '/', { waitUntil: 'load' }); await sleep(2500); bd = await band(pg);
        ok(bd.hidden && !Object.keys(await badges(pg)).length, '서버 실패(500) = 띠·배지 숨김 · 화면 오류 0'); await cx.close();
        setMode('normal', true); ({ cx, pg } = await page('staff', 1280)); bd = await band(pg);
        ok(!bd.hidden && bd.items.map(x => x.k).join(',') === 'memo,exp,today' && !(await badges(pg)).inquiry, '응대 숫자만 실패 = 그 칸·배지만 빠짐', bd.items.map(x => x.k).join(',')); await cx.close(); setMode('normal');
        setMode('normal', false, true); ({ cx, pg } = await page('staff', 1280)); bd = await band(pg);
        ok(!bd.hidden && !bd.none && bd.items.map(x => x.k).join(',') === 'today' && !Object.keys(await badges(pg)).length, '서버 항목 전부 실패 = 「없음 ✓」 아님 · 일정 칸만 · 배지 없음', bd.items.map(x => x.k).join(',') + ' none ' + bd.none); await cx.close();
        setMode('zero', false, true); ({ cx, pg } = await page('staff', 1280)); bd = await band(pg);
        ok(bd.hidden, '전부 실패 + 오늘 일정 0 = 띠 숨김'); await cx.close();
        setMode('zero'); ({ cx, pg } = await page('owner', 1280)); bd = await band(pg);
        ok(!bd.hidden && bd.none && !bd.items.length && !Object.keys(await badges(pg)).length, '전부 0 = 「오늘 챙길 일 없음 ✓」 한 줄 · 배지 없음'); await cx.close(); setMode('normal');

        console.log('\n⑤ today-rules.js 가 안 실려도(안전망) 메모함·체험 같은 결과');
        ({ cx, pg } = await page('owner', 1280, 'light', true));
        const noRules = await pg.evaluate(() => typeof window.AKMToday === 'undefined');
        await pg.evaluate(() => window.AkmOrderMemo.open()); await sleep(1800);
        const red2 = await pg.evaluate(() => document.querySelectorAll('#om-list .om-ml-l.c-bad').length);
        await pg.evaluate(() => window.AkmOrderMemo.close()); await sleep(400);
        await pg.evaluate(() => window.AkmExp.open()); await sleep(2000);
        const np2 = await pg.evaluate(() => (document.getElementById('xp-nophone') || {}).textContent || null);
        ok(noRules && red2 === 4 && /번호 미입력 3건/.test(np2 || ''), '공용 파일 없음 → 종전 식 = 빨강 4줄 · 번호 미입력 3건(공용 파일 있을 때와 같음)', `rules 없음 ${noRules} · ${red2} · ${np2}`);
        await cx.close();

        console.log('\n⑥ 폭·누름·메뉴 · 야간 · 그림');
        for (const w of [390, 884, 1280]) {
            ({ cx, pg } = await page('owner', w));
            const m = await pg.evaluate(() => { const items = [...document.querySelectorAll('#today-band .tb-item')]; const navs = [...document.querySelectorAll('.nav-item[data-page]')].filter(n => n.querySelector('.nav-badge')).map(n => { const t = n.querySelector('.nav-text'); return { over: t ? t.scrollWidth > t.clientWidth + 1 : false, h: n.getBoundingClientRect().height }; });
                return { pageOver: document.scrollingElement.scrollWidth - window.innerWidth, minH: Math.min(...items.map(x => x.getBoundingClientRect().height)), bandH: document.getElementById('today-band').getBoundingClientRect().height, navOver: navs.filter(x => x.over).length, navH: navs.map(x => Math.round(x.h)) }; });
            ok(m.pageOver <= 0 && m.minH >= 44 && m.navOver === 0, `${w} = 문서 가로 넘침 0 · 띠 칸 높이 ≥ 44 · 배지 붙은 메뉴 글 잘림 0`, JSON.stringify(m));
            if (w === 390) {
                await pg.screenshot({ path: path.join(OUT, '390-light-top.png'), clip: { x: 0, y: 0, width: 390, height: 520 } });
                const hb = await pg.$('.mobile-menu-btn, #mobile-menu-btn, .hamburger, [aria-label*="메뉴"]'); if (hb) { await hb.tap().catch(() => {}); await sleep(600); await pg.screenshot({ path: path.join(OUT, '390-light-menu.png') }); }
            }
            await cx.close();
        }
        ({ cx, pg } = await page('owner', 390, 'dark'));
        const dk = await pg.evaluate(() => { const n = document.querySelector('#today-band .tb-item:not(.is-fill):not(.is-urgent) .tb-n'), bdg = document.querySelector('.nav-item[data-page="inquiry"] .nav-badge'); return { attr: document.documentElement.getAttribute('data-ao-theme'), n: n ? getComputedStyle(n).color : null, b: bdg ? getComputedStyle(bdg).color : null }; });
        ok(dk.attr === 'dark' && dk.n === 'rgb(197, 238, 79)' && dk.b === 'rgb(197, 238, 79)', '야간 = 띠 숫자·배지 라임(#C5EE4F)', JSON.stringify(dk));
        await pg.screenshot({ path: path.join(OUT, '390-dark-top.png'), clip: { x: 0, y: 0, width: 390, height: 520 } });
        const hb = await pg.$('.mobile-menu-btn, #mobile-menu-btn, .hamburger, [aria-label*="메뉴"]'); if (hb) { await hb.tap().catch(() => {}); await sleep(600); await pg.screenshot({ path: path.join(OUT, '390-dark-menu.png') }); }
        await cx.close();
        ok(errs.length === 0, '화면 오류(pageerror) 0', errs.slice(0, 3).join(' | '));
    } finally { await br.close(); srv.close(); }
    console.log(`\n══ 합계 ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ''} · 그림 = ${OUT}`);
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('실행 오류', e); process.exit(2); });
