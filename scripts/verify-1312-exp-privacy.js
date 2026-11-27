// #1312 체험 번호 자동 입력 — 네이버 예약 「개인정보 조회」 가림 대응 검증 · 🔴 실DB 0 · 실화면 0 · 어사이드 0 · 발송 0
//   scripts/vm/exp-phone-auto.js 실코드를 require 해 순수 함수(isMasked·privacyStep·privacyReason·parseRow) + main(가짜 api·가짜 Aside·임시 상태 파일) 한 틱씩
//   node scripts/verify-1312-exp-privacy.js
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const VM = require(path.join(__dirname, 'vm', 'exp-phone-auto.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra ? ' · ' + extra : '')); } };

// 가짜 줄(#997 꼴) — 정상 / 가림
const NO = ['1400000001', '1400000002', '1400000003'];
const rowOpen = no => ({ text: `확정 홍길동 010-1234-5678 ${no} 26.11.28.(토) 오후 2:00 체험`, cells: [], parts: { booker: '', label: '', sub: '', bphone: '', vphone: '' } });
const rowMasked = no => ({ text: `확정 홍*동 ***-****-5678 ${no} 26.11.28.(토) 오후 2:00 체험`, cells: [], parts: { booker: '홍*동', label: '', sub: '', bphone: '***-****-5678', vphone: '' } });
const PB_BEFORE = { btn: true, btn_text: '개인정보 조회', btn_cls: 'PrivacyAuthButton__btn' };

console.log('\n[1] 가림 판정(isMasked)');
ok('가린 번호 꼴 = 가림', VM.isMasked(rowMasked(NO[0]), PB_BEFORE));
ok('가린 번호 꼴 · 단추 없음 = 가림', VM.isMasked(rowMasked(NO[0]), { btn: false }));
ok('번호 전체 = 가림 아님(단추가 있어도)', !VM.isMasked(rowOpen(NO[0]), PB_BEFORE));
ok('번호 없음 + 단추 「개인정보 조회」 = 가림', VM.isMasked({ text: `확정 홍*동 ${NO[0]} 26.11.28.(토) 오후 2:00`, parts: {} }, PB_BEFORE));
ok('번호 없음 + 단추 「개인정보 조회」 + 이름 안 가림 = 가림 아님(워커2 점검 1 · 인증 뒤 단추 글 그대로인 화면)', !VM.isMasked({ text: `확정 홍길동 ${NO[0]} 26.11.28.(토) 오후 2:00`, parts: {} }, PB_BEFORE));
ok('20건 이상 표시', /20건 이상/.test(VM.privacyReason(20, null)) && /19건/.test(VM.privacyReason(19, null)));
ok('번호 없음 + 단추 없음 = 가림 아님(종전 「꼴 모름」 길)',!VM.isMasked({ text: `확정 홍길동 ${NO[0]}`, parts: {} }, { btn: false }));
ok('번호 없음 + 단추 「조회 해제」 = 가림 아님', !VM.isMasked({ text: `확정 홍*동 ${NO[0]}`, parts: {} }, { btn: true, btn_text: '개인정보 조회 해제' }));
ok('대리예약 칸 sub-phone 가림 = 가림', VM.isMasked({ text: `확정 김*수 대리예약 방문자: 이*희 ${NO[0]}`, parts: { vphone: '***-****-1111', bphone: '010-2222-3333' } }, { btn: false }));

console.log('\n[2] parseRow 무변경(정상 줄 = 종전 꼴)');
const p0 = VM.parseRow(rowOpen(NO[0]), NO[0]);
ok('정상 줄 = line · 예약자 번호 · 이름', p0.how === 'line' && p0.booker_phone === '01012345678' && p0.name_seen === '홍길동', JSON.stringify(p0));
const pm = VM.parseRow(rowMasked(NO[0]), NO[0]);
ok('가린 줄을 parseRow 에 넣으면 번호 0(종전 「꼴 모름」)', !pm.booker_phone && !pm.visitor_phone);

console.log('\n[3] 상태 전이(privacyStep)');
let s = VM.privacyStep(null, 'open', '2026-11-27T01:00:00.000Z');
ok('처음 open = 바뀜 · since', s.changed && s.next.state === 'open' && s.next.since === '2026-11-27T01:00:00.000Z');
const s2 = VM.privacyStep(s.next, 'open', '2026-11-27T01:10:00.000Z');
ok('open → open = 안 바뀜 · since 그대로 · seen_at 갱신', !s2.changed && s2.next.since === '2026-11-27T01:00:00.000Z' && s2.next.seen_at === '2026-11-27T01:10:00.000Z');
const s3 = VM.privacyStep(s2.next, 'masked', '2026-11-27T04:30:00.000Z');
ok('open → masked = 바뀜 · 유지 210분 · last_open', s3.changed && s3.held_ms === 210 * 60000 && s3.next.last_open.since === '2026-11-27T01:00:00.000Z' && s3.next.last_open.until === '2026-11-27T04:30:00.000Z');
ok('log 에 held_min 210', s3.next.log.slice(-1)[0].held_min === 210 && s3.next.log.slice(-1)[0].from === 'open');
const s4 = VM.privacyStep(s3.next, 'open', '2026-11-27T05:00:00.000Z');
ok('masked → open 도 기록 · last_open 남김', s4.changed && s4.next.log.slice(-1)[0].to === 'open' && s4.next.last_open && s4.held_ms === null);
let big = { state: 'open', since: 'x', log: Array.from({ length: 40 }, (_, i) => ({ i })) };
ok('log 30줄 상한', VM.privacyStep(big, 'masked', '2026-11-27T05:00:00.000Z').next.log.length === 30);

console.log('\n[4] 알림 글(privacyReason)');
const r1 = VM.privacyReason(3, s3.next);
ok('사유 머리 = 정해진 글', r1.startsWith(VM.PRIVACY_REASON));
ok('건수·유지 시간(3.5시간 · KST 10:00~13:30)', /번호 빈 예약 3건/.test(r1) && /약 3\.5시간\(11\/27 10:00~11\/27 13:30/.test(r1), r1);
ok('서버 숫자 지움 규칙에 안 걸림(7자리↑ 숫자 0)', !/\d{3,4}[-\s]?\d{4}/.test(r1), r1);
ok('직전 open 기록 없으면 유지 시간 줄 없음', VM.privacyReason(2, { state: 'masked' }) === VM.PRIVACY_REASON + ' · 번호 빈 예약 2건');

console.log('\n[4-2] 서버 텔레그램 머리(experience.js missTgText 실코드 떼어 실행)');
{
    const src = fs.readFileSync(path.join(__dirname, '..', 'experience.js'), 'utf8').replace(/\r\n/g, '\n');   // 줄 끝 CRLF 여도
    const a = src.indexOf('const MISS_CENTER_KINDS'), b = src.indexOf('\nfunction missTgText('), e = src.indexOf('\n}\n', b);
    const T = new Function(src.slice(a, src.indexOf('\n', a)) + src.slice(b, e + 2) + '\nreturn missTgText;')();
    const t1 = T(null, 'privacy', VM.privacyReason(3, null));
    ok('privacy = 「네이버 인증 필요」 · 「어사이드 멈춤」 없음', /^🍊 체험 번호 자동 입력 멈춤 · 네이버 인증 필요 · 번호 가림/.test(t1) && !/어사이드 멈춤/.test(t1), t1);
    ok('다른 id 0 갈래(login) = 종전 「어사이드 멈춤」', /어사이드 멈춤/.test(T(null, 'login', 'x')));
    ok('예약 있는 miss = 종전 글', /^🍊 체험 번호 자동 입력 못 함 · 예약 1400000001/.test(T({ order_no: '1400000001', visit_date: '2026-11-28', visit_time: '14:00' }, 'miss', 'x')));
    ok('center·vm 갈래 무변경', /^🖥️ VM 스마트스토어센터/.test(T(null, 'center_login', 'x')) && /^🖥️ VM 확인 필요/.test(T(null, 'vm_mem', 'x')));
}

console.log('\n[5] 한 틱(main · 가짜 api·Aside)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v1312-'));
function fakeTick(screen, opt = {}) {
    const calls = [];
    const items = (opt.items || NO).map((no, i) => ({ id: 200 + i, order_no: no, name_masked: '홍*동', visit_date: '2026-11-28', visit_time: '14:00' }));
    const api = async (method, p, body) => { calls.push({ method, p, body }); if (p.endsWith('/todo')) return { s: 200, j: { items, left: 20 } }; if (method === 'PUT') return { s: 200, j: { picked: 'booker_phone', sent: 'ok' } }; return { s: 200, j: { ok: true } }; };
    class Aside { constructor() { } async start() { } async stop() { } async replJson(label, code) { const no = (/keyword=(\d+)/.exec(code) || [])[1]; return screen(no); } }
    return { calls, run: () => VM.main({ api, Aside, noGuards: true, args: opt.args || ['--once'], privacyFile: path.join(tmp, opt.file || 'p.json'), nowMs: opt.nowMs }) };
}
(async () => {
    const origLog = console.log; const quiet = f => async (...a) => { console.log = () => { }; try { return await f(...a); } finally { console.log = origLog; } };
    // ① 가림 3건 = 알림 1통(miss id 0 · kind privacy) · PUT 0 · 예약별 miss 0
    let T = fakeTick(no => ({ blocked: '', rows: [rowMasked(no)], privacy: PB_BEFORE }), { file: 'a.json' });
    let code = await quiet(T.run)();
    const misses = T.calls.filter(c => /\/miss$/.test(c.p));
    ok('가림 = PUT 0', !T.calls.some(c => c.method === 'PUT'));
    ok('가림 3건 = miss 1통 · id 0 · kind privacy', misses.length === 1 && /\/auto\/0\/miss$/.test(misses[0].p) && misses[0].body.kind === 'privacy', JSON.stringify(misses.map(m => m.p)));
    ok('miss 사유 = 가림 글 · 3건', misses[0] && misses[0].body.reason.startsWith(VM.PRIVACY_REASON) && /3건/.test(misses[0].body.reason));
    ok('예약별 miss 0(todo 에서 안 걸러지게)', !T.calls.some(c => /\/auto\/20\d\/miss$/.test(c.p)));
    ok('종료 코드 2(멈춤)', code === 2);
    ok('상태 파일 = masked', JSON.parse(fs.readFileSync(path.join(tmp, 'a.json'), 'utf8')).state === 'masked');
    // ② 인증 뒤 = 밀린 3건 전부 PUT · miss 0 · 상태 open · masked → open 기록
    T = fakeTick(no => ({ blocked: '', rows: [rowOpen(no)], privacy: { btn: true, btn_text: '개인정보 조회 해제' } }), { file: 'a.json' });
    code = await quiet(T.run)();
    const puts = T.calls.filter(c => c.method === 'PUT');
    ok('인증 뒤 = 밀린 3건 PUT', puts.length === 3 && puts.every(c => c.body.booker_phone === '01012345678'));
    ok('인증 뒤 = miss 0 · 코드 0', !T.calls.some(c => /\/miss$/.test(c.p)) && code === 0);
    const st = JSON.parse(fs.readFileSync(path.join(tmp, 'a.json'), 'utf8'));
    ok('상태 masked → open 기록', st.state === 'open' && st.log.slice(-1)[0].from === 'masked' && st.log.slice(-1)[0].to === 'open');
    // ③ 정상만(처음) = 종전 저장 · 상태 open
    T = fakeTick(no => ({ blocked: '', rows: [rowOpen(no)], privacy: { btn: false } }), { file: 'b.json', items: [NO[0]] });
    code = await quiet(T.run)();
    ok('정상 줄 = 종전 저장 1 · 코드 0', T.calls.filter(c => c.method === 'PUT').length === 1 && code === 0);
    // ④ 첫 줄 정상 · 둘째 줄부터 가림(틱 중 풀림) = 1건 저장 + 알림 1통 · 상태 open → masked
    let k = 0;
    T = fakeTick(no => (k++ === 0 ? { blocked: '', rows: [rowOpen(no)], privacy: { btn: false } } : { blocked: '', rows: [rowMasked(no)], privacy: PB_BEFORE }), { file: 'c.json' });
    code = await quiet(T.run)();
    ok('틱 중 풀림 = 저장 1 · miss 1(id 0)', T.calls.filter(c => c.method === 'PUT').length === 1 && T.calls.filter(c => /\/miss$/.test(c.p)).length === 1 && T.calls.some(c => /\/auto\/0\/miss$/.test(c.p)));
    const st4 = JSON.parse(fs.readFileSync(path.join(tmp, 'c.json'), 'utf8'));
    ok('틱 중 풀림 = open → masked · last_open', st4.state === 'masked' && st4.last_open && st4.log.length === 2);
    // ⑤ dry = 상태 파일 안 씀 · PUT·miss 0
    T = fakeTick(no => ({ blocked: '', rows: [rowMasked(no)], privacy: PB_BEFORE }), { file: 'd.json', args: ['--once', '--dry'] });
    await quiet(T.run)();
    ok('dry = 상태 파일 0 · 보낸 것 0', !fs.existsSync(path.join(tmp, 'd.json')) && !T.calls.some(c => c.method !== 'GET'));
    // ⑥ 종전 길 무변경 = 로그인 화면 멈춤 · 꼴 모름 miss
    T = fakeTick(() => ({ blocked: 'login', url: 'https://nid.naver.com/' }), { file: 'e.json' });
    await quiet(T.run)();
    ok('로그인 멈춤 = 종전 miss(id 0 · kind login)', T.calls.some(c => /\/auto\/0\/miss$/.test(c.p) && c.body.kind === 'login'));
    T = fakeTick(no => ({ blocked: '', rows: [{ text: `확정 홍길동 ${no}`, cells: [], parts: {} }], privacy: { btn: false } }), { file: 'f.json', items: [NO[0]] });
    await quiet(T.run)();
    ok('꼴 모름 = 종전 예약별 miss', T.calls.some(c => /\/auto\/200\/miss$/.test(c.p) && /꼴 모름/.test(c.body.reason)));
    // ⑦ 화면 코드 문법(JS_READ 가 만든 글이 함수로 읽힘)
    let parsed = true; try { new Function('return ' + VM.JS_READ('1400000001')); } catch (e) { parsed = false; }
    ok('JS_READ 문법 OK(PrivacyAuthButton 읽기 · 가린 번호 꼴 포함)', parsed && /PrivacyAuthButton/.test(VM.JS_READ('1')) && /\\\*\{2,4\}/.test(VM.JS_READ('1')));
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log('\n[6] #1312-2 가림 알림 주기(서버 privacyTellStep 순수)');
    const EXP = require(path.join(__dirname, '..', 'experience.js'));
    const S = EXP._auto.privacyTellStep, C = { privacy_repeat_min: 60, privacy_quiet: [22, 7] };
    const at = (d, h, m) => Date.UTC(2026, 10, d, h - 9, m);   // KST d일 h:m
    let r = S(null, at(27, 13, 0), 3, C);
    ok('첫 가림 = 바로 1통(nth 1)', r.tell && r.nth === 1 && r.why === 'first');
    let st6 = r.next;
    r = S(st6, at(27, 13, 59), 3, C); ok('59분 = 0통', !r.tell && r.why === 'wait'); st6 = r.next;
    r = S(st6, at(27, 14, 1), 3, C); ok('61분 = 1통 · 2번째 · 1시간째', r.tell && r.nth === 2 && r.hours === 1, JSON.stringify(r)); st6 = r.next;
    r = S(st6, at(27, 14, 30), 3, C); ok('그 뒤 29분 = 0통', !r.tell); st6 = r.next;
    r = S(st6, at(27, 15, 5), 0, C); ok('번호 빈 예약 0건 = 0통', !r.tell && r.why === 'no_pending'); st6 = r.next;
    r = S(st6, at(27, 22, 30), 2, C); ok('밤 22:30 = 0통(quiet)', !r.tell && r.why === 'quiet'); st6 = r.next;
    r = S(st6, at(28, 3, 0), 2, C); ok('새벽 03:00 = 0통 · 날 바뀌어도 이어짐', !r.tell && r.why === 'quiet'); st6 = r.next;
    r = S(st6, at(28, 7, 0), 2, C); ok('07:00 뒤 첫 틱 = 1통 · 3번째 · 18시간째', r.tell && r.nth === 3 && r.hours === 18, JSON.stringify(r)); st6 = r.next;
    r = S(null, at(27, 23, 40), 1, C); ok('첫 알림은 밤이어도 보냄', r.tell && r.nth === 1);
    r = S({}, at(27, 13, 0), 1, C); ok('초기화({}) 뒤 = 다시 첫 통', r.tell && r.nth === 1);
    r = S({ first_at: new Date(at(26, 9, 0)).toISOString(), last_told_at: new Date(at(26, 9, 0)).toISOString(), n: 1, seen_at: new Date(at(26, 9, 0)).toISOString() }, at(27, 13, 0), 1, C);
    ok('12시간 넘게 가림 보고 없음 = 새 가림(첫 통)', r.tell && r.nth === 1);
    r = S(null, at(27, 13, 0), 1, {}); let r2 = S(r.next, at(27, 14, 0), 1, {}); ok('설정 없음 = 기본 60분', r2.tell && r2.nth === 2);
    r2 = S(r.next, at(27, 14, 0), 1, { privacy_repeat_min: 120 }); ok('privacy_repeat_min 120 = 60분엔 0통', !r2.tell);
    ok('quiet [22,7] 경계 = 21:59 아님 · 22:00 · 06:59 맞음 · 07:00 아님', !EXP._auto.privacyQuiet([22, 7], at(27, 21, 59)) && EXP._auto.privacyQuiet([22, 7], at(27, 22, 0)) && EXP._auto.privacyQuiet([22, 7], at(28, 6, 59)) && !EXP._auto.privacyQuiet([22, 7], at(28, 7, 0)));

    console.log('\n[7] #1312-2 라우트 왕복(pglite · experience.js 실제 mount · now 주입)');
    const PGL = process.env.PGLITE_PATH;
    if (!PGL) { fail++; console.log('  ❌ PGLITE_PATH 가 없어 라우트 왕복을 못 돌림'); }
    else {
        const http = require('http'), express = require(path.join(__dirname, '..', 'node_modules', 'express'));
        const { PGlite } = require(PGL); const pdb = new PGlite();
        const conv = v => (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
        const q = async (sql, p = []) => { const x = await pdb.query(sql, p.map(conv)); return { rows: x.rows, rowCount: x.affectedRows != null ? x.affectedRows : x.rows.length }; };
        const pool = { query: q, connect: async () => ({ query: q, release() { } }) };
        await pdb.query(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB)`);
        const tg = []; let NOW = at(27, 13, 0);
        const app = express(); app.use(express.json());
        const ex = EXP(app, { pool, authMiddleware: (a, b, n) => n(), adminOnly: (a, b, n) => n(), writeAudit: async () => { }, notifyTelegram: m => { tg.push(m); }, noTimers: true, now: () => NOW,
            kakaoNotify: { sendAlimtalk: async () => ({ status: 'sent' }), sendLms: async () => ({ status: 'sent' }), smsSafe: s => s } });
        await ex.ready;
        const TOKEN = 'a'.repeat(64);
        await q(`INSERT INTO agent_office_config (key, value) VALUES ('experience_auto', $1)`, [{ enabled: true, token: TOKEN, daily_max: 30, hours: [0, 24], skip: [] }]);
        const PORT = Number(process.env.PORT1312 || 3458);
        const srv = await new Promise(rs => { const s = http.createServer(app).listen(PORT, () => rs(s)); });
        const call = async (u, b) => { const x = await fetch(`http://127.0.0.1:${PORT}${u}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(b) }); return x.json(); };
        try {
            const P = n => call('/api/experience/auto/0/miss', { reason: VM.privacyReason(n, null), kind: 'privacy', pending: n });
            await P(3); ok('라우트 첫 가림 = 텔레그램 1 · 「네이버 인증 필요」', tg.length === 1 && /네이버 인증 필요/.test(tg[0]) && !/번째 알림/.test(tg[0]), tg[0]);
            NOW = at(27, 13, 59); await P(3); ok('라우트 59분 = 그대로 1', tg.length === 1);
            NOW = at(27, 14, 1); await P(3); ok('라우트 61분 = 2 · 「2번째 알림 · 가림 1시간째」', tg.length === 2 && /2번째 알림 · 가림 1시간째/.test(tg[1]), tg[1]);
            NOW = at(27, 22, 30); await P(3); ok('라우트 밤 = 그대로 2', tg.length === 2);
            NOW = at(28, 7, 5); await P(3); ok('라우트 날 바뀐 07:05 = 3 · 3번째(하루 1회 묶음에 안 걸림)', tg.length === 3 && /3번째 알림/.test(tg[2]), tg[2]);
            NOW = at(28, 9, 0); await P(0); ok('라우트 빈 예약 0건 = 그대로 3', tg.length === 3);
            NOW = at(28, 8, 10); await call('/api/experience/auto/0/miss', { reason: VM.privacyReason(2, null), kind: 'privacy' });
            ok('pending 안 보낸 옛 VM 코드 = 1건 이상으로 봄(61분 지나 4번째 · 0통으로 멈추지 않음)', tg.length === 4 && /4번째 알림/.test(tg[3]), tg[3]);
            NOW = at(28, 9, 20); await call('/api/experience/auto/0/miss', { reason: VM.privacyReason(2, null), kind: 'privacy', pending: 'x' });
            ok('pending 이 숫자 아님 = 1건 이상으로 봄(61분 지나 5번째)', tg.length === 5 && /5번째 알림/.test(tg[4]), tg[4]);
            ok('privacy 알림 머리 = 「네이버 인증 필요」 · 「어사이드 멈춤」 0', tg.slice(0, 5).filter((x, i) => i !== 3 || true).filter(x => /번호 가림/.test(x)).every(x => /^🍊 체험 번호 자동 입력 멈춤 · 네이버 인증 필요 · /.test(x) && !/어사이드 멈춤/.test(x)));
            tg.pop(); tg.pop();
            await call('/api/experience/auto/0/miss', { reason: '어사이드 네이버 로그인 풀림', kind: 'login' });
            await call('/api/experience/auto/0/miss', { reason: '어사이드 네이버 로그인 풀림', kind: 'login' });
            ok('다른 갈래(login) = 종전 하루 1통 · 「어사이드 멈춤」', tg.length === 4 && /어사이드 멈춤/.test(tg[3]));
            // 번호 저장 성공 = 초기화 → 다음 가림은 첫 통
            const id = (await q(`INSERT INTO experience_bookings (source, ext_key, order_no, name, visit_date, visit_time, date_ok, exp_count, status) VALUES ('place','place:9','9001','박*현',$1,'12:30',TRUE,1,'confirmed') RETURNING id`, ['2026-11-29'])).rows[0].id;
            const pr = await fetch(`http://127.0.0.1:${PORT}/api/experience/auto/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ order_no_seen: '9001', status_seen: '확정', visit_seen: { date: '2026-11-29', time: '12:30' }, name_seen: '박지현', visitor_phone: '010-1111-2222', booker_phone: '' }) });
            const stAfter = (await q(`SELECT value FROM agent_office_config WHERE key='experience_auto_privacy'`)).rows[0];
            ok('번호 저장 200 → 가림 상태 초기화', pr.status === 200 && stAfter && !stAfter.value.first_at, pr.status + ' ' + JSON.stringify(stAfter));
            NOW = at(28, 9, 10); await P(2); ok('초기화 뒤 가림 = 다시 첫 통', tg.length === 5 && !/번째 알림/.test(tg[4]));
        } finally { srv.close(); await pdb.close(); }
    }
    console.log(`\n${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.log = console.log; console.error(e); process.exit(1); });
