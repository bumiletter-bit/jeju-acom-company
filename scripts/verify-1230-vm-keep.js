// #1230 검증 — scripts/vm/vm-watch.js 센터 로그인 유지(JS_KEEP)의 「로그인하기」 첫 화면 한 단계 · ok 판정 강화 · 직영몰 스토어 알림 · 포인트·배송지 지시문 스토어 확인 줄
//   실DB 0 · 어사이드 0 · claude 0 · 네트워크 0 · 임시 홈 폴더(잠금·상태·로그)
//   ① JS_KEEP 글 자체를 가짜 탭(tabs·openTab)으로 실행(기다림은 0초로 바꿔 끼움) ② keepMaybe 를 _setKeep 가짜 어사이드로 ③ promptFor 글
//   사용: node scripts/verify-1230-vm-keep.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'v1230-'));
const HOMED = path.join(T, 'home'); fs.mkdirSync(path.join(HOMED, '.akkome'), { recursive: true });
process.env.USERPROFILE = HOMED; process.env.HOME = HOMED;   // require 전에(잠금·상태 경로가 이 홈으로)
delete process.env.EXP_AUTO_API; delete process.env.EXP_AUTO_TOKEN;
process.env.VM_CENTER_FAIL_TELL = '3';   // #1297 기본은 「끔」 → 종전(#1295 연속 3번째 1통) 단언들은 변수를 3 으로 켠 꼴로 봄 · 끈 꼴은 「#1297」 단언에서 변수를 지우고 봄
const W = require('./vm/vm-watch.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' · ' + extra : '')); } };

// ── 가짜 화면 ──
const DASH = 'https://sell.smartstore.naver.com/#/home/dashboard', FIRST = DASH, FIRST2 = 'https://sell.smartstore.naver.com/#/home/about', LOGIN = 'https://accounts.commerce.naver.com/login?url=x';
const head = store => `메인 메뉴로 바로가기\n네이버\n스마트스토어센터\nN+ 사업자몰쇼핑파트너센터네이버애즈마이비즈\nbumi님내정보\n스토어 이동 \n로그아웃\n좌측 내비게이션 펼쳐보기\n${store}\n통합 매니저\n수취인명\n검색하기\n상품관리`;
const SCREENS = {
    dash: { u: DASH, txt: head('제주아꼼이네'), out: true, first: false, store: '제주아꼼이네' },
    biz: { u: DASH, txt: head('제주아꼼이네 직영몰'), out: true, first: false, store: '제주아꼼이네 직영몰' },
    first: { u: FIRST, txt: '스마트스토어센터\n로그인하기\n가입하기\n판매자 가입 안내', out: false, first: true, store: '' },
    first2: { u: FIRST2, txt: '스마트스토어센터\n로그인하기\n가입하기', out: false, first: true, store: '' },   /* 첫 화면 주소가 대시보드가 아닌 꼴(실제 주소는 못 봄 = 두 꼴 다 검증) */
    login: { u: LOGIN, txt: '커머스ID 로그인\n아이디\n비밀번호\n네이버 아이디로 간편 로그인', out: false, first: false, store: '', simple: true },
    loginNoBtn: { u: LOGIN, txt: '커머스ID 로그인\n아이디\n비밀번호', out: false, first: false, store: '' },
    phone: { u: 'https://nid.naver.com/login/ext/deviceConfirm', txt: '새로운 기기 로그인 · 2단계 인증 · 휴대폰으로 승인 요청을 보냈습니다', out: false, first: false, store: '', simple: true },
    blank: { u: DASH, txt: '', out: false, first: false, store: '' },
    other: { u: 'https://www.naver.com/', txt: '네이버', out: false, first: false, store: '' },
};
// 탭 하나 = 지금 화면 이름 + 누름·새로고침에 따른 다음 화면(plan)
function mkTab(start, plan, log, name) {
    const t = { name, screen: start, closed: false, looks: 0,
        url() { if (t.closed) throw new Error('닫힌 탭'); return SCREENS[t.screen].u; },
        async reload() { log.push(name + ':reload'); if (plan.onReload) t.screen = plan.onReload(t) || t.screen; },
        async evaluate(fn) {
            if (t.closed) throw new Error('닫힌 탭');
            const src = String(fn), S = SCREENS[t.screen];
            if (/location\.reload/.test(src)) { log.push(name + ':reload2'); return; }
            if (/el\.click\(\)/.test(src) && /로그인하기/.test(src)) { const hit = !!S.first && !plan.firstDead; log.push(name + ':tap로그인하기=' + hit); if (hit && plan.onFirst) plan.onFirst(t); return hit; }
            if (/el\.click\(\)/.test(src) && /간편/.test(src)) { const hit = !!S.simple; log.push(name + ':tap간편=' + hit); if (hit && plan.onSimple) plan.onSimple(t); return hit; }
            t.looks++; if (plan.onLook) plan.onLook(t);
            const N = SCREENS[t.screen];   /* 실제 화면처럼 = 머리 글에서 스토어 이름을 정규식으로 읽음(JS_KEEP 안 정규식과 같은 꼴을 여기서 다시 돌려 봄) */
            const m = /로그아웃\s*\n\s*좌측 내비게이션 펼쳐보기\s*\n\s*([^\n]{1,40})/.exec(N.txt.slice(0, 1500));
            return { txt: N.txt.slice(0, 2000), out: /로그아웃/.test(N.txt.slice(0, 1500)), first: !!N.first, store: m ? m[1].trim() : '' };
        } };
    return t;
}
const CLOCK = { t: 0 };   /* #1281-b 그 실행에서 기다린 ms 합 */
const CLOSED = [];   /* #1242 그 실행에서 닫힌 탭 이름 */
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
async function runKeep(tabs, openTab, code) {
    const out = []; const fakeConsole = { log: s => out.push(s) }; const fastTimeout = (fn, ms) => { CLOCK.t += Number(ms) || 0; Promise.resolve().then(fn); return 0; };   /* #1281-b 가짜 시계 = 기다린 ms 를 더함(실제로는 바로) */
    CLOCK.t = 0; const FakeDate = { now: () => CLOCK.t };
    CLOSED.length = 0; const closeTab = async t => { if (!t || t.closed) throw new Error('이미 닫힌 탭'); t.closed = true; CLOSED.push(t.name); };
    await new AsyncFunction('tabs', 'openTab', 'console', 'setTimeout', 'closeTab', 'Date', code || W.JS_KEEP)(tabs, openTab, fakeConsole, fastTimeout, closeTab, FakeDate);
    return JSON.parse(out[out.length - 1]);
}

(async () => {
    console.log('── ① JS_KEEP 화면 갈래');
    let log, tabs, r, t;
    const noOpen = async () => { throw new Error('openTab 불림'); };

    log = []; t = mkTab('dash', {}, log, 'A'); r = await runKeep([t], noOpen);
    ok('대시보드(스마트스토어) = ok · 누름 0 · 스토어 이름 읽음', r.state === 'ok' && !r.clicked && !r.first && r.store === '제주아꼼이네' && !log.some(x => /tap/.test(x)), JSON.stringify(r) + log);

    log = []; t = mkTab('biz', {}, log, 'A'); r = await runKeep([t], noOpen);
    ok('대시보드(직영몰) = ok + store 「제주아꼼이네 직영몰」 · 누름 0', r.state === 'ok' && r.store === '제주아꼼이네 직영몰' && !log.some(x => /tap/.test(x)), JSON.stringify(r));

    log = []; t = mkTab('first', { onFirst: x => { x.screen = 'login'; }, onSimple: x => { x.screen = 'dash'; } }, log, 'A'); r = await runKeep([t], noOpen);
    ok('로그인 안 된 첫 화면 → 「로그인하기」 1회 → 「간편 로그인」 1회 → relogin(같은 탭)', r.state === 'relogin' && r.first === true && r.clicked === true && log.filter(x => /tap로그인하기=true/.test(x)).length === 1 && log.filter(x => /tap간편=true/.test(x)).length === 1 && r.store === '제주아꼼이네', JSON.stringify(r) + log);

    log = []; tabs = []; t = mkTab('first', {}, log, 'A'); const pop = mkTab('login', { onSimple: x => { x.closed = true; t.screen = 'dash'; } }, log, 'P');
    t = mkTab('first', { onFirst: () => { tabs.push(pop); } }, log, 'A'); pop.plan = null; tabs.push(t);
    pop.evaluate = (orig => async fn => { const s = String(fn); if (/el\.click\(\)/.test(s) && /간편/.test(s)) { log.push('P:tap간편=true'); pop.closed = true; t.screen = 'dash'; return true; } return orig(fn); })(pop.evaluate);
    r = await runKeep(tabs, noOpen);
    ok('첫 화면 → 로그인 화면이 새 탭으로 뜸 → 간편 로그인 → 그 탭 닫힘 → 처음 탭 새로고침해 relogin', r.state === 'relogin' && r.first && r.clicked && log.includes('P:tap간편=true') && log.filter(x => x === 'A:reload').length === 2, JSON.stringify(r) + log);

    log = []; t = mkTab('first', { firstDead: true }, log, 'A'); r = await runKeep([t], noOpen);
    ok('첫 화면인데 「로그인하기」가 안 눌림 = login_fail(ok 로 안 침)', r.state === 'login_fail' && !r.first && !r.clicked && r.store === '', JSON.stringify(r));

    log = []; t = mkTab('first', { onFirst: () => { } }, log, 'A'); r = await runKeep([t], noOpen);
    ok('「로그인하기」를 눌러도 화면 그대로 = login_fail', r.state === 'login_fail' && r.first === true, JSON.stringify(r));

    log = []; t = mkTab('first', { onFirst: x => { x.screen = 'dash'; } }, log, 'A'); r = await runKeep([t], noOpen);
    ok('「로그인하기」만으로 바로 대시보드 = relogin(간편 로그인 누름 0)', r.state === 'relogin' && r.first && !r.clicked, JSON.stringify(r));

    log = []; t = mkTab('first', { onFirst: x => { x.screen = 'phone'; } }, log, 'A'); r = await runKeep([t], noOpen);
    ok('「로그인하기」 뒤 2단계·폰 승인 화면 = need_phone(간편 로그인 안 누름)', r.state === 'need_phone' && !log.some(x => /tap간편/.test(x)), JSON.stringify(r) + log);

    console.log('── 종전 갈래 무회귀');
    log = []; t = mkTab('dash', { onReload: () => 'login', onSimple: x => { x.screen = 'dash'; } }, log, 'A'); r = await runKeep([t], noOpen);
    ok('새로고침하니 커머스ID 로그인 화면 → 간편 로그인 → relogin(「로그인하기」 누름 0)', r.state === 'relogin' && r.clicked && !r.first && !log.some(x => /tap로그인하기/.test(x)), JSON.stringify(r) + log);

    log = []; t = mkTab('dash', { onReload: () => 'loginNoBtn' }, log, 'A'); r = await runKeep([t], noOpen);
    ok('로그인 화면 · 간편 로그인 단추 없음 = login_fail', r.state === 'login_fail' && !r.clicked, JSON.stringify(r));

    log = []; t = mkTab('dash', { onReload: () => 'phone' }, log, 'A'); r = await runKeep([t], noOpen);
    ok('2단계·폰 승인 화면 = need_phone · 누름 0', r.state === 'need_phone' && !log.some(x => /tap/.test(x)), JSON.stringify(r));

    log = []; t = mkTab('dash', { onReload: () => 'login', onSimple: x => { x.screen = 'phone'; } }, log, 'A'); r = await runKeep([t], noOpen);
    ok('간편 로그인 뒤 폰 승인 화면 = need_phone', r.state === 'need_phone' && r.clicked, JSON.stringify(r));

    log = []; t = mkTab('dash', { onReload: () => 'login', onSimple: () => { } }, log, 'A'); r = await runKeep([t], noOpen);
    ok('간편 로그인 눌러도 로그인 화면 그대로 = login_fail', r.state === 'login_fail' && r.clicked, JSON.stringify(r));

    log = []; t = mkTab('dash', { onReload: () => 'other' }, log, 'A'); r = await runKeep([t], noOpen);
    ok('센터가 아닌 주소 = unknown', r.state === 'unknown' && r.store === '', JSON.stringify(r));

    log = []; let opened = 0; const nt = mkTab('dash', {}, log, 'N'); r = await runKeep([mkTab('other', {}, log, 'X')], async u => { opened++; ok('  (새 탭 주소 = 대시보드)', u === DASH); return nt; });
    ok('센터 탭이 없으면 새 탭 1개 · opened true · 다른 탭은 안 건드림', r.state === 'ok' && r.opened === true && opened === 1 && !log.some(x => /^X:/.test(x)), JSON.stringify(r) + log);

    log = []; const nf = mkTab('first2', { onFirst: x => { x.screen = 'login'; }, onSimple: x => { x.screen = 'dash'; } }, log, 'N'); r = await runKeep([], async () => nf);
    ok('탭 없음 → 새 탭이 첫 화면(주소가 대시보드 아님)으로 열림 → 「로그인하기」 → 간편 로그인 → relogin', r.state === 'relogin' && r.opened && r.first && r.clicked, JSON.stringify(r) + log);

    console.log('── ok 판정 강화');
    log = []; t = mkTab('blank', {}, log, 'A'); r = await runKeep([t], noOpen);
    ok('센터 주소인데 머리 글이 안 보임(#1281 네 번 봐도) = unknown(주소만으로 ok 아님)', r.state === 'unknown' && t.looks === 4, JSON.stringify(r) + ' looks ' + t.looks);

    log = []; t = mkTab('blank', { onLook: x => { if (x.looks >= 2) x.screen = 'dash'; } }, log, 'A'); r = await runKeep([t], noOpen);
    ok('머리 글이 늦게 그려짐(두 번째에 보임) = ok', r.state === 'ok' && r.store === '제주아꼼이네', JSON.stringify(r));

    ok('유지 코드 = 센터 첫 화면만(지급·주문 화면 주소·저장 낱말 없음 · #1082 조건 그대로)', /home\/dashboard/.test(W.JS_KEEP) && !/point|benefit|pay-order|저장|지급/.test(W.JS_KEEP) && /간편\\s\*로그인/.test(W.JS_KEEP));
    ok('유지 코드 = [스토어 이동]을 누르지 않음(자동 이동 X)', !/스토어\s*이동/.test(W.JS_KEEP));

    console.log('── ② keepMaybe(가짜 어사이드)');
    const told = []; let next = null; const seen = [];
    W._setKeep(() => ({ start: async () => ({}), replJson: async (title) => { seen.push(title); if (next === 'throw') throw new Error('어사이드 응답 없음'); return next; }, stop: async () => { } }), async (reason, kind) => { told.push({ reason, kind }); return true; });
    const state = () => JSON.parse(fs.readFileSync(W.KEEP_STATE, 'utf8'));
    const reset = () => { try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ } };

    reset(); next = { state: 'ok', clicked: false, first: false, opened: false, where: 'sell.smartstore.naver.com/', store: '제주아꼼이네' };
    let k = await W.keepMaybe(true);
    ok('ok + 스마트스토어 = ok · 알림 0', k.state === 'ok' && told.length === 0 && state().result === 'ok' && !state().phone_at);

    next = { state: 'ok', where: 'sell.smartstore.naver.com/' }; k = await W.keepMaybe(true);
    ok('ok · store 칸 없음(옛 꼴) = ok · 알림 0', k.state === 'ok' && told.length === 0);

    next = { state: 'ok', clicked: false, first: false, opened: false, where: 'sell.smartstore.naver.com/', store: '제주아꼼이네 직영몰' }; k = await W.keepMaybe(true);
    ok('ok + 직영몰 = wrong_store · 텔레그램 1통(갈래 center_store) · 3시간 쉼 안 걸림', k.state === 'wrong_store' && k.login === 'ok' && told.length === 1 && told[0].kind === 'center_store' && /직영몰로 열려 있음/.test(told[0].reason) && told[0].reason.length <= 120 && state().result === 'wrong_store' && !state().phone_at, JSON.stringify(told));

    k = await W.keepMaybe(true);
    ok('같은 날 다시 직영몰 = wrong_store 지만 알림 추가 0(하루 1통)', k.state === 'wrong_store' && told.length === 1);

    fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ ...state(), store_told_day: '2026-01-01' })); k = await W.keepMaybe(true);
    ok('날이 바뀌면 다시 1통', told.length === 2 && told[1].kind === 'center_store');

    next = { state: 'relogin', clicked: true, first: true, where: 'sell.smartstore.naver.com/', store: '제주아꼼이네 직영몰' }; fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ ...state(), store_told_day: '2026-01-01' })); k = await W.keepMaybe(true);
    ok('다시 로그인됐는데 직영몰 = wrong_store(login = relogin) · 알림', k.state === 'wrong_store' && k.login === 'relogin' && told.length === 3);

    reset(); told.length = 0; next = { state: 'relogin', clicked: true, first: true, where: 'sell.smartstore.naver.com/', store: '제주아꼼이네' }; k = await W.keepMaybe(true);
    ok('relogin + 스마트스토어 = relogin · 알림 0', k.state === 'relogin' && told.length === 0);

    next = { state: 'login_fail', clicked: false, first: false, where: 'sell.smartstore.naver.com/', store: '' }; k = await W.keepMaybe(true);
    ok('#1295 login_fail 1번째 = 알림 0 · 3시간 쉼 0 · 셈 1(다음 30분 틱이 다시 누름)', k.state === 'login_fail' && told.length === 0 && !state().phone_at && state().fail_n === 1, JSON.stringify(told));
    seen.length = 0; k = await W.keepMaybe(true);
    ok('#1295 2번째 = 알림 0 · 쉼 0 · 셈 2 · 누름 있는 유지 틱 그대로', told.length === 0 && !state().phone_at && state().fail_n === 2 && /#1082/.test(seen[0] || ''), JSON.stringify(seen));
    next = 'throw'; await W.keepMaybe(true); next = { state: 'unknown', where: 'x', store: '' }; await W.keepMaybe(true);
    ok('#1295 사이에 어사이드 오류·판정 못 함 = 셈 그대로 2 · 알림 0', state().fail_n === 2 && told.length === 0);
    next = { state: 'login_fail', clicked: true, first: true, waited: 6, where: 'accounts.commerce.naver.com/login', store: '' }; k = await W.keepMaybe(true);
    ok('#1295 3번째 = 텔레그램 1통(갈래 center_login · 「간편 로그인 안 됨 · 연속 3번」 · 120자 안) · 3시간 쉼', told.length === 1 && told[0].kind === 'center_login' && /간편 로그인 안 됨 · 연속 3번/.test(told[0].reason) && told[0].reason.length <= 120 && !!state().phone_at && state().fail_n === 3, JSON.stringify(told));
    ok('#1295 실패 단서가 상태 파일에 남음(어느 화면·무엇을 눌렀나)', String(state().center_why || '').includes('first=1 clicked=1 waited=6 opened=0 @accounts.commerce.naver.com/login'), state().center_why);
    { const ago31 = new Date(Date.now() - 31 * 60000).toISOString(); fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ ...state(), at: ago31, phone_at: ago31 })); }   /* 31분 흐른 꼴(3시간 쉼 안) */
    seen.length = 0; next = { state: 'logged_out', ro: true, where: 'x' }; k = await W.keepMaybe();
    ok('#1295 알린 뒤 31분 = 종전 쉼 길(읽기만 틱이 돎 · 누름 0 · 알림 0 · 셈 그대로)', k !== null && k.state === 'logged_out' && seen.length === 1 && /#1281/.test(seen[0] || '') && told.length === 1 && state().fail_n === 3, JSON.stringify(seen));
    next = { state: 'relogin', clicked: true, first: true, where: 'x', store: '제주아꼼이네' }; k = await W.keepMaybe(true);
    ok('#1295 복구(relogin) = 셈 0 · 단서 지움 · 알림 추가 0', state().fail_n === 0 && !state().center_why && told.length === 1);
    next = { state: 'login_fail', where: 'x', store: '' }; await W.keepMaybe(true); await W.keepMaybe(true);
    ok('#1295 복구 뒤 다시 실패 2번 = 처음부터 셈(2) · 알림 0', state().fail_n === 2 && told.length === 1);
    next = { state: 'ok', where: 'x', store: '제주아꼼이네' }; await W.keepMaybe(true);
    ok('#1295 1~2번 끊겼다 스스로 살아남 = 0통 · 셈 0', state().fail_n === 0 && told.length === 1);
    next = { state: 'login_fail', where: 'x', store: '' }; await W.keepMaybe(true); next = { state: 'need_phone', where: 'nid.naver.com/login' }; await W.keepMaybe(true);
    ok('#1295 폰 승인이 보이면 = 종전처럼 바로 1통 · 실패 셈 0', told.length === 2 && /2단계·폰 승인/.test(told[1].reason) && state().fail_n === 0 && !!state().phone_at);

    console.log('── #1297 간편 로그인 실패 알림 기본 끔(변수 없음·0·글자) · 변수 N = 그 번째 1통');
    for (const v of [undefined, '', '0', '-2', 'abc']) {
        if (v === undefined) delete process.env.VM_CENTER_FAIL_TELL; else process.env.VM_CENTER_FAIL_TELL = v;
        reset(); told.length = 0; seen.length = 0; next = { state: 'login_fail', clicked: true, first: true, waited: 6, where: 'accounts.commerce.naver.com/login', store: '' };
        for (let i = 0; i < 25; i++) await W.keepMaybe(true);
        ok('#1297 변수 ' + (v === undefined ? '없음' : JSON.stringify(v)) + ' = 25번 연속 실패해도 0통 · 3시간 쉼 0 · 셈 25 · 매번 누름 있는 틱 · 단서 남음', told.length === 0 && !state().phone_at && state().fail_n === 25 && seen.length === 25 && seen.every(x => /#1082/.test(x || '')) && /first=1 clicked=1/.test(state().center_why || ''), JSON.stringify(told));
    }
    delete process.env.VM_CENTER_FAIL_TELL;
    next = { state: 'need_phone', where: 'nid.naver.com/login' }; await W.keepMaybe(true);
    ok('#1297 끈 채로도 폰 승인 = 바로 1통 · 3시간 쉼 · 실패 셈 0', told.length === 1 && told[0].kind === 'center_login' && /2단계·폰 승인/.test(told[0].reason) && !!state().phone_at && state().fail_n === 0);
    ok('#1297 폰 승인 글 = 할 일(승인) + 안 하면 밀리는 것([VM] 지시 실패) · 「멈춤」 글 없음 · 120자 안', /승인해 주세요/.test(told[0].reason) && /승인 전엔 포인트 지급·배송지 변경 \[VM\] 지시가 실패해요/.test(told[0].reason) && !/멈춤/.test(told[0].reason) && told[0].reason.length <= 120, told[0].reason.length + '자');
    process.env.VM_CENTER_FAIL_TELL = '1'; reset(); told.length = 0; next = { state: 'login_fail', where: 'x', store: '' }; await W.keepMaybe(true);
    ok('#1297 변수 1 = 첫 실패에 1통 + 3시간 쉼 · 글에 「그 전엔 … 멈춤」 없음 · 120자 안', told.length === 1 && /간편 로그인 안 됨\)/.test(told[0].reason) && /스스로 다시 로그인해 봐요/.test(told[0].reason) && !/멈춤/.test(told[0].reason) && told[0].reason.length <= 120 && !!state().phone_at, told[0] && told[0].reason);
    process.env.VM_CENTER_FAIL_TELL = '99'; reset(); told.length = 0; for (let i = 0; i < 19; i++) await W.keepMaybe(true);
    const n19 = told.length; await W.keepMaybe(true);
    ok('#1297 변수 99 = 상한 20(19번까지 0통 · 20번째 1통 「연속 20번」 · 120자 안)', n19 === 0 && told.length === 1 && /연속 20번/.test(told[0].reason) && told[0].reason.length <= 120, told[0] && told[0].reason.length + '자');
    process.env.VM_CENTER_FAIL_TELL = '3';

    reset(); told.length = 0; next = { state: 'need_phone', where: 'nid.naver.com/login' }; k = await W.keepMaybe(true);
    ok('need_phone = 종전 알림(center_login · 「2단계·폰 승인」) · 3시간 쉼', k.state === 'need_phone' && told.length === 1 && told[0].kind === 'center_login' && /2단계·폰 승인/.test(told[0].reason) && !!state().phone_at);

    reset(); told.length = 0; next = { state: 'unknown', where: 'sell.smartstore.naver.com/', store: '' }; k = await W.keepMaybe(true);
    ok('unknown = 알림 0 · 쉼 0(다음 30분에 다시 봄)', k.state === 'unknown' && told.length === 0 && !state().phone_at);

    next = 'throw'; k = await W.keepMaybe(true);
    ok('어사이드 오류 = error · 알림 0', k.state === 'error' && told.length === 0);

    console.log('── #1230-② unknown 연속 3번');
    reset(); told.length = 0; next = { state: 'unknown', where: 'sell.smartstore.naver.com/', store: '' };
    await W.keepMaybe(true); await W.keepMaybe(true);
    ok('unknown 2번까지 = 알림 0 · 셈 2', told.length === 0 && state().unknown_n === 2);
    next = 'throw'; await W.keepMaybe(true); next = { state: 'unknown', where: 'sell.smartstore.naver.com/', store: '' };
    ok('사이에 어사이드 오류 = 셈 그대로 2', state().unknown_n === 2 && told.length === 0);
    k = await W.keepMaybe(true);
    ok('3번째 = 텔레그램 1통(갈래 center_unknown · 120자 안) · 쉼 없음', k.state === 'unknown' && told.length === 1 && told[0].kind === 'center_unknown' && /3번 연속 못 읽음/.test(told[0].reason) && told[0].reason.length <= 120 && !state().phone_at && state().unknown_n === 3, JSON.stringify(told));
    await W.keepMaybe(true);
    ok('4번째(같은 날) = 알림 추가 0 · 셈 4', told.length === 1 && state().unknown_n === 4);
    next = { state: 'ok', where: 'x', store: '제주아꼼이네' }; await W.keepMaybe(true);
    ok('ok 가 오면 셈 0', state().unknown_n === 0 && told.length === 1);
    next = { state: 'unknown', where: 'x', store: '' }; await W.keepMaybe(true); await W.keepMaybe(true);
    ok('다시 unknown 2번 = 셈 2 · 알림 0(처음부터 다시 셈)', state().unknown_n === 2 && told.length === 1);
    next = { state: 'login_fail', where: 'x', store: '' }; await W.keepMaybe(true);
    ok('login_fail 이 오면 unknown 셈 0(#1295 첫 실패는 알림 0 · 실패 셈 1)', state().unknown_n === 0 && told.length === 1 && state().fail_n === 1);

    console.log('── #1230-② 스토어 이름 못 읽음 · 머리 범위 3,000자');
    const LOGD = path.join(HOMED, '.akkome', 'logs'); const logText = () => { try { return fs.readdirSync(LOGD).filter(f => /^vm-watch-/.test(f)).map(f => fs.readFileSync(path.join(LOGD, f), 'utf8')).join('\n'); } catch (e) { return ''; } };
    reset(); const before = (logText().match(/스토어 이름 못 읽음/g) || []).length;
    next = { state: 'ok', where: 'x', store: '' }; await W.keepMaybe(true);
    const mid = (logText().match(/스토어 이름 못 읽음/g) || []).length;
    next = { state: 'ok', where: 'x', store: '제주아꼼이네' }; await W.keepMaybe(true);
    const after = (logText().match(/스토어 이름 못 읽음/g) || []).length;
    ok('ok 인데 스토어 이름 빈칸 = 로그 「스토어 이름 못 읽음」 1줄 · 이름 있으면 0줄', mid === before + 1 && after === mid, `${before}/${mid}/${after}`);
    {
        const pad = '공지 '.repeat(800);   /* 머리 앞에 2,400자 = 종전 1,500자 범위 밖 */
        SCREENS.far = { u: DASH, txt: pad + head('제주아꼼이네'), out: true, first: false, store: '제주아꼼이네' };
        const lg = []; const r2 = await runKeep([mkTab('far', {}, lg, 'A')], async () => { throw new Error('openTab 불림'); });
        ok('유지 코드 머리 범위 = 3,000자(코드 글자)', /b\.slice\(0, 3000\)/.test(W.JS_KEEP) && !/b\.slice\(0, 1500\)/.test(W.JS_KEEP), JSON.stringify(r2));
    }

    reset(); next = { state: 'ok', where: 'x', store: '제주아꼼이네' }; k = await W.keepMaybe(); const k2 = await W.keepMaybe();
    ok('30분 간격 그대로(바로 다시 부르면 안 돎)', k && k.state === 'ok' && k2 === null);
    W._setKeep(null, null);

    console.log('── #1242 뒷정리(이 틱이 연 탭 닫기) · 기다림 · 새 탭 다시 열기');
    {
        const noOpen2 = async () => { throw new Error('openTab 불림'); };
        let lg = [], tb = mkTab('dash', {}, lg, 'A'), rr = await runKeep([tb], noOpen2);
        ok('원래 열려 있던 센터 탭 = 닫지 않음(closed 0)', rr.state === 'ok' && rr.closed === 0 && !tb.closed && CLOSED.length === 0, JSON.stringify(rr));
        lg = []; let nt2 = mkTab('dash', {}, lg, 'N'); rr = await runKeep([], async () => nt2);
        ok('이 틱이 새로 연 탭 = ok 뒤 닫음(closed 1)', rr.state === 'ok' && rr.opened && rr.closed === 1 && nt2.closed && rr.store === '제주아꼼이네', JSON.stringify(rr));
        lg = []; nt2 = mkTab('first2', { onFirst: x => { x.screen = 'login'; }, onSimple: x => { x.screen = 'dash'; } }, lg, 'N'); rr = await runKeep([], async () => nt2);
        ok('새로 연 탭에서 다시 로그인(relogin) = 닫음', rr.state === 'relogin' && rr.closed === 1 && nt2.closed, JSON.stringify(rr));
        lg = []; nt2 = mkTab('blank', {}, lg, 'N'); rr = await runKeep([], async () => nt2);
        ok('새로 연 탭이 끝내 안 그려짐(unknown) = 닫음(쌓이지 않게)', rr.state === 'unknown' && rr.closed === 1 && nt2.closed, JSON.stringify(rr));
        lg = []; nt2 = mkTab('phone', {}, lg, 'N'); rr = await runKeep([], async () => nt2);
        ok('폰 승인 화면(need_phone) = 탭 남김(사람이 풀어야 함)', rr.state === 'need_phone' && rr.closed === 0 && !nt2.closed, JSON.stringify(rr));
        lg = []; nt2 = mkTab('loginNoBtn', {}, lg, 'N'); rr = await runKeep([], async () => nt2);
        ok('로그인 실패(login_fail) = 탭 남김', rr.state === 'login_fail' && rr.closed === 0 && !nt2.closed, JSON.stringify(rr));
        lg = []; const pop2 = mkTab('login', {}, lg, 'P'), tabs2 = []; const a2 = mkTab('first', { onFirst: () => { tabs2.push(pop2); } }, lg, 'A'); tabs2.push(a2);
        pop2.evaluate = (orig => async fn => { const s2 = String(fn); if (/el\.click\(\)/.test(s2) && /간편/.test(s2)) { a2.screen = 'dash'; return true; } return orig(fn); })(pop2.evaluate);
        rr = await runKeep(tabs2, noOpen2);
        ok('원래 탭 + 새로 뜬 로그인 탭 = 로그인 탭만 닫음(원래 탭은 남김)', rr.closed === 1 && pop2.closed && !a2.closed, JSON.stringify(rr) + CLOSED);
        let tries = 0; lg = []; nt2 = mkTab('dash', {}, lg, 'N'); rr = await runKeep([], async () => { tries++; if (tries === 1) throw new Error('Tab X is no longer available.'); return nt2; });
        ok('새 탭 열기가 한 번 실패(어사이드 막 켜짐) = 1번 더 열어 ok', rr.state === 'ok' && tries === 2 && rr.opened, JSON.stringify(rr) + ' tries ' + tries);
        tries = 0; let threw = ''; try { await runKeep([], async () => { tries++; throw new Error('Tab X is no longer available.'); }); } catch (e) { threw = e.message; }
        ok('두 번 다 실패 = 오류로 끝(다음 30분에 다시) · 더 안 누름', tries === 2 && /no longer available/.test(threw), threw + ' tries ' + tries);
        /* 점검 반영 ②: 누르기 전부터 있던 로그인 탭(앞선 지시가 사람 몫으로 남긴 것)은 이 틱 것이 아님 */
        { const lg3 = [], old = mkTab('login', {}, lg3, 'OLD'), tabs3 = [old]; const a3 = mkTab('first', { onFirst: x => { x.screen = 'login'; }, onSimple: x => { x.screen = 'dash'; } }, lg3, 'A'); tabs3.push(a3);
          const r3 = await runKeep(tabs3, noOpen2);
          ok('전부터 있던 로그인 탭 = 건드리지 않음(누름·닫기 0) · 내 탭에서 로그인', r3.state === 'relogin' && !old.closed && !lg3.some(x => /^OLD:tap/.test(x)) && r3.closed === 0, JSON.stringify(r3) + lg3); }
        { const lg3 = [], old = mkTab('phone', {}, lg3, 'OLD'), pop3 = mkTab('login', {}, lg3, 'P'), tabs3 = [old]; const a3 = mkTab('first', { onFirst: () => { tabs3.push(pop3); } }, lg3, 'A'); tabs3.push(a3);
          pop3.evaluate = (orig => async fn => { const s3 = String(fn); if (/el\.click\(\)/.test(s3) && /간편/.test(s3)) { a3.screen = 'dash'; return true; } return orig(fn); })(pop3.evaluate);
          const r3 = await runKeep(tabs3, noOpen2);
          ok('전부터 있던 보안 확인 탭 + 새로 뜬 로그인 탭 = 새 탭만 닫음', r3.state === 'relogin' && r3.closed === 1 && pop3.closed && !old.closed && !a3.closed, JSON.stringify(r3) + CLOSED); }
        /* 점검 반영 ③: 첫 열기가 「실패」로 돌아왔는데 탭은 생겨 있던 때 = 여분 하나만 닫음 */
        { const lg3 = [], ghost = mkTab('dash', {}, lg3, 'G'), keepOld = mkTab('other', {}, lg3, 'X'), oldSell = mkTab('biz', {}, lg3, 'S'), real = mkTab('dash', {}, lg3, 'N'), tabs3 = [keepOld]; let n3 = 0;
          const r3 = await runKeep(tabs3, async () => { n3++; if (n3 === 1) { tabs3.push(ghost); throw new Error('Tab X is no longer available.'); } tabs3.push(real); return real; });
          ok('다시 연 탭 + 첫 시도가 남긴 센터 탭 = 둘 다 닫음(closed 2) · 다른 탭은 그대로', r3.state === 'ok' && r3.closed === 2 && real.closed && ghost.closed && !keepOld.closed, JSON.stringify(r3) + CLOSED);
          const tabs4 = [oldSell]; let n4 = 0; const real4 = mkTab('dash', {}, lg3, 'N4');   /* 전부터 있던 센터 탭(대시보드 주소가 아닌 꼴로 흉내 = 찾기에 안 걸리게 주소만 바꿈) */
          oldSell.url = () => 'https://sell.smartstore.naver.com/#/products/list';
          const r4 = await runKeep(tabs4, async () => { n4++; if (n4 === 1) throw new Error('Tab X is no longer available.'); tabs4.push(real4); return real4; });
          ok('다시 열기 뒤에도 전부터 있던 센터 탭은 안 닫음(내가 연 것만 closed 1)', r4.state === 'ok' && r4.closed === 1 && real4.closed && !oldSell.closed, JSON.stringify(r4) + CLOSED); }
        ok('기다림 = 첫 읽기 7초 · 다시 보기 6초(코드 글자)', /await wait\(7000\);/.test(W.JS_KEEP) && /await wait\(6000\); a = await look\(\); \}/.test(W.JS_KEEP) && !/await wait\(5000\);\s*\/\*/.test(W.JS_KEEP));
        ok('유지 코드 = 여전히 센터 첫 화면만(#1082 조건) · [스토어 이동] 없음', /home\/dashboard/.test(W.JS_KEEP) && !/point|benefit|pay-order|저장|지급/.test(W.JS_KEEP) && !/스토어\s*이동/.test(W.JS_KEEP));
    }

    console.log('── #1297 보완 = 알림을 안 보내는 실패 틱은 이 틱이 연 탭을 닫음');
    {
        const noOpenQ = async () => { throw new Error('openTab 불림'); };
        let lg = [], nt = mkTab('first', {}, lg, 'N'), rq = await runKeep([], async () => nt, W.JS_KEEP_QUIET);
        ok('조용한 코드 · 새로 연 탭이 login_fail = 그 탭 닫음(closed 1)', rq.state === 'login_fail' && rq.opened === true && rq.closed === 1 && nt.closed, JSON.stringify(rq));
        lg = []; nt = mkTab('first', {}, lg, 'N'); rq = await runKeep([], async () => nt, W.JS_KEEP);
        ok('종전 코드(알림을 보내는 틱) · 같은 꼴 = 화면 남김(closed 0)', rq.state === 'login_fail' && rq.closed === 0 && !nt.closed, JSON.stringify(rq));
        lg = []; const old = mkTab('first', {}, lg, 'A'); rq = await runKeep([old], noOpenQ, W.JS_KEEP_QUIET);
        ok('조용한 코드 · 원래 열려 있던 탭이 login_fail = 닫지 않음(closed 0)', rq.state === 'login_fail' && rq.closed === 0 && !old.closed && CLOSED.length === 0, JSON.stringify(rq));
        lg = []; nt = mkTab('phone', {}, lg, 'N'); rq = await runKeep([], async () => nt, W.JS_KEEP_QUIET);
        ok('조용한 코드 · 폰 승인 화면 = 종전처럼 남김(closed 0)', rq.state === 'need_phone' && rq.closed === 0 && !nt.closed, JSON.stringify(rq));
        ok('조용한 코드 = QUIET 표식만 다름(누름·판정 줄은 종전 코드와 같음)', /const QUIET = true;/.test(W.JS_KEEP_QUIET) && /const QUIET = false;/.test(W.JS_KEEP) && W.JS_KEEP_QUIET.replace('const QUIET = true;', 'const QUIET = false;') === W.JS_KEEP);
        const codes = []; let nx = { state: 'login_fail', where: 'x', store: '' };
        W._setKeep(() => ({ start: async () => ({}), replJson: async (title, code) => { codes.push(code === W.JS_KEEP_QUIET ? 'quiet' : code === W.JS_KEEP ? 'keep' : code === W.JS_KEEP_RO ? 'ro' : '?'); return nx; }, stop: async () => { } }), async () => true);
        const wipe = () => { try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ } };
        delete process.env.VM_CENTER_FAIL_TELL; wipe(); for (let i = 0; i < 5; i++) await W.keepMaybe(true);
        ok('변수 없음(끔) = 실패가 이어져도 매 틱 조용한 코드', codes.join(',') === 'quiet,quiet,quiet,quiet,quiet', codes.join(','));
        process.env.VM_CENTER_FAIL_TELL = '3'; wipe(); codes.length = 0; for (let i = 0; i < 3; i++) await W.keepMaybe(true);
        ok('변수 3 = 1·2번째 조용한 코드 · 알림을 보내는 3번째는 종전 코드(화면 남김)', codes.join(',') === 'quiet,quiet,keep', codes.join(','));
        process.env.VM_CENTER_FAIL_TELL = '1'; wipe(); codes.length = 0; await W.keepMaybe(true);
        ok('변수 1 = 첫 틱부터 종전 코드', codes.join(',') === 'keep', codes.join(','));
        process.env.VM_CENTER_FAIL_TELL = '3'; wipe(); W._setKeep(null, null);
    }
    console.log('── #1266 간편 로그인 뒤 로그인 창(OAuth 팝업) 기다림 · heartbeat 센터 결과');
    {
        SCREENS.oauth = { u: 'https://accounts.commerce.naver.com/oauth/callback?code=x', txt: '로그인 처리 중', out: false, first: false, store: '' };
        SCREENS.popPhone = { u: 'https://nid.naver.com/login/ext/deviceConfirm', txt: '새로운 기기 로그인 · 2단계 인증 · 휴대폰으로 승인 요청을 보냈습니다', out: false, first: false, store: '' };
        const noOpen3 = async () => { throw new Error('openTab 불림'); };
        const taps = lg => lg.filter(x => /tap간편=true/.test(x)).length;
        /* 팝업이 늦게 닫힘: 간편 로그인 → 새 로그인 창이 뜸 · 처음 탭은 로그인 화면 그대로 → 창을 3번째 볼 때 닫힘 → 처음 탭 새로고침하면 대시보드 */
        { const lg = [], tabs5 = []; let peeks = 0, done = false; const pop5 = mkTab('oauth', { onLook: x => { peeks++; if (peeks >= 3) { x.closed = true; done = true; } } }, lg, 'P');
          const a5 = mkTab('first', { onFirst: x => { x.screen = 'login'; }, onSimple: () => { tabs5.push(pop5); }, onReload: () => (done ? 'dash' : null) }, lg, 'A'); tabs5.push(a5);
          const r5 = await runKeep(tabs5, noOpen3);
          ok('팝업이 늦게 닫힘 → 기다린 뒤 처음 탭 새로고침 → relogin · 간편 로그인 1번만 · waited ≥ 1', r5.state === 'relogin' && r5.clicked && taps(lg) === 1 && r5.waited >= 1 && r5.store === '제주아꼼이네' && lg.includes('A:reload'), JSON.stringify(r5) + lg); }
        /* 끝내 첫 화면: 팝업이 상한(6번)까지 안 닫힘 · 새로고침해도 로그인 화면 = login_fail · 팝업은 안 닫음(사람 몫) */
        { const lg = [], tabs6 = []; const pop6 = mkTab('oauth', {}, lg, 'P');
          const a6 = mkTab('first', { onFirst: x => { x.screen = 'login'; }, onSimple: () => { tabs6.push(pop6); } }, lg, 'A'); tabs6.push(a6);
          const r6 = await runKeep(tabs6, noOpen3);
          ok('팝업이 끝내 안 닫히고 새로고침해도 로그인 전 = login_fail · 간편 로그인 1번만 · 기다림 상한 6 · 팝업 안 닫음', r6.state === 'login_fail' && r6.clicked && taps(lg) === 1 && r6.waited === 6 && !pop6.closed && r6.closed === 0 && r6.store === '', JSON.stringify(r6) + lg); }
        /* 팝업이 닫혔는데도 처음 탭이 첫 화면 = login_fail(종전 실패 길) */
        { const lg = [], tabs7 = []; const pop7 = mkTab('oauth', { onLook: x => { x.closed = true; } }, lg, 'P');
          const a7 = mkTab('first', { onFirst: x => { x.screen = 'login'; }, onSimple: x => { tabs7.push(pop7); x.screen = 'first'; } }, lg, 'A'); tabs7.push(a7);
          const r7 = await runKeep(tabs7, noOpen3);
          ok('팝업은 닫혔는데 처음 탭이 여전히 「로그인하기」 첫 화면 = login_fail · 「로그인하기」·간편 로그인 다시 안 누름', r7.state === 'login_fail' && taps(lg) === 1 && lg.filter(x => /tap로그인하기=true/.test(x)).length === 1, JSON.stringify(r7) + lg); }
        /* 팝업이 2단계·폰 승인 화면 = need_phone · 그 창 그대로 */
        { const lg = [], tabs8 = []; const pop8 = mkTab('popPhone', {}, lg, 'P');
          const a8 = mkTab('dash', { onReload: () => 'login', onSimple: () => { tabs8.push(pop8); } }, lg, 'A'); tabs8.push(a8);
          const r8 = await runKeep(tabs8, noOpen3);
          ok('새로 뜬 로그인 창이 2단계·폰 승인 = need_phone · 창 안 닫음 · 기다림 0', r8.state === 'need_phone' && !pop8.closed && r8.waited === 0 && taps(lg) === 1, JSON.stringify(r8) + lg); }
        /* 팝업 없음 = 종전: 바로 되면 새로고침 추가 0 · 안 되면 login_fail */
        { const lg = []; const a9 = mkTab('dash', { onReload: () => 'login', onSimple: x => { x.screen = 'dash'; } }, lg, 'A'); const r9 = await runKeep([a9], noOpen3);
          ok('팝업 없음 · 바로 로그인됨 = relogin · 기다림 0 · 새로고침은 처음 1번뿐(종전과 같음)', r9.state === 'relogin' && r9.waited === 0 && lg.filter(x => x === 'A:reload').length === 1, JSON.stringify(r9) + lg); }
        { const lg = []; let n = 0; const a10 = mkTab('dash', { onReload: () => { n++; return 'login'; }, onSimple: () => { } }, lg, 'A'); const r10 = await runKeep([a10], noOpen3);
          ok('팝업 없음 · 눌러도 그대로 = login_fail · 기다림 0 · 간편 로그인 1번만(한 번 더 새로고침해 보고 판정)', r10.state === 'login_fail' && r10.waited === 0 && taps(lg) === 1 && n === 2, JSON.stringify(r10) + lg); }
        /* 느린 로그인: 팝업 없이 처음 탭이 늦게 넘어감 → 다시 보기에서 relogin */
        { const lg = []; let n = 0; const a11 = mkTab('dash', { onReload: () => { n++; return n === 1 ? 'login' : 'dash'; }, onSimple: () => { } }, lg, 'A'); const r11 = await runKeep([a11], noOpen3);
          ok('팝업 없음 · 8초엔 로그인 화면이었지만 새로고침하니 대시보드 = relogin', r11.state === 'relogin' && taps(lg) === 1 && r11.store === '제주아꼼이네', JSON.stringify(r11) + lg); }
        /* 로그인된 뒤 남은 팝업은 닫음(이 틱에 뜬 것만) · 전부터 있던 로그인 탭은 그대로 */
        { const lg = [], tabs12 = []; const old12 = mkTab('loginNoBtn', {}, lg, 'O'); const pop12 = mkTab('oauth', {}, lg, 'P');
          const a12 = mkTab('dash', { onReload: () => 'login', onSimple: x => { tabs12.push(pop12); x.screen = 'dash'; } }, lg, 'A'); tabs12.push(old12, a12);
          const r12 = await runKeep(tabs12, noOpen3);
          ok('바로 로그인됐는데 로그인 창이 남음 = relogin · 그 창만 닫음 · 전부터 있던 로그인 탭·센터 탭은 안 닫음', r12.state === 'relogin' && pop12.closed && !old12.closed && !a12.closed && r12.closed === 1, JSON.stringify(r12) + CLOSED); }
        ok('유지 코드 = 간편 로그인 누르는 곳 1곳 · 비밀번호·금고 낱말 0 · 기다림 상한 6번', (W.JS_KEEP.match(/간편\\s\*로그인/g) || []).length === 1 && !/password|비밀번호|금고|vault|fill\(|\.type\(/i.test(W.JS_KEEP) && /i < 6/.test(W.JS_KEEP));
        /* heartbeat 센터 결과 */
        const st5 = () => { try { return JSON.parse(fs.readFileSync(W.KEEP_STATE, 'utf8')); } catch (e) { return {}; } };
        try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ }
        const hb = async () => { const q = []; await W.heartbeat({ query: async (sql, args) => { q.push(JSON.parse(args[0])); } }, 'idle'); return q[0]; };
        let h = await hb();
        ok('유지가 한 번도 안 돈 PC = heartbeat 에 center 칸 없음(종전 꼴)', h && !('center' in h) && h.state === 'idle', JSON.stringify(h));
        const told5 = []; let next5 = { state: 'relogin', clicked: true, first: true, where: 'sell.smartstore.naver.com/', store: '제주아꼼이네' };
        W._setKeep(() => ({ start: async () => ({}), replJson: async () => next5, stop: async () => { } }), async (reason, kind) => { told5.push({ reason, kind }); return true; });
        await W.keepMaybe(true); h = await hb();
        ok('유지 뒤 heartbeat.center = { state relogin · at · store 제주아꼼이네 }', h.center && h.center.state === 'relogin' && h.center.store === '제주아꼼이네' && h.center.at === st5().center_at && !Number.isNaN(Date.parse(h.center.at)), JSON.stringify(h));
        next5 = { state: 'login_fail', clicked: true, first: true, waited: 8, where: 'sell.smartstore.naver.com/', store: '' }; await W.keepMaybe(true); h = await hb();
        ok('#1295 첫 실패 = heartbeat.center { state login_fail · fail_n 1 · why 단서 } · 텔레그램 0 · 쉼 0', h.center.state === 'login_fail' && h.center.fail_n === 1 && /first=1 clicked=1 waited=8/.test(h.center.why || '') && told5.length === 0 && !st5().phone_at, JSON.stringify(h.center));
        await W.keepMaybe(true); await W.keepMaybe(true); h = await hb();
        ok('연속 3번 실패 뒤 heartbeat.center.state = login_fail · fail_n 3 · 텔레그램 1통(center_login · 「간편 로그인 안 됨」) · 3시간 쉼', h.center.fail_n === 3 && h.center.state === 'login_fail' && h.center.store === '' && told5.length === 1 && told5[0].kind === 'center_login' && /간편 로그인 안 됨/.test(told5[0].reason) && !!st5().phone_at, JSON.stringify(h) + JSON.stringify(told5));
        next5 = { state: 'ok', where: 'x', store: '제주아꼼이네 직영몰' }; await W.keepMaybe(true); h = await hb();
        ok('직영몰로 열림 = heartbeat.center.state wrong_store · store 직영몰', h.center.state === 'wrong_store' && /직영몰/.test(h.center.store), JSON.stringify(h.center));
        fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ ...st5(), at: '2026-01-01T00:00:00.000Z' })); h = await hb();
        ok('상태 파일 at 을 앞당겨 써도(어사이드 다시 열기) center.at 은 실제 유지 시각 그대로', h.center.at === st5().center_at && h.center.at !== '2026-01-01T00:00:00.000Z');
    }

    console.log('── #1242 메모리(커밋) 감시 · 메모리 부족 알림');
    {
        const told2 = []; W._setKeep(() => ({ start: async () => ({}), replJson: async () => ({ state: 'ok', store: '제주아꼼이네' }), stop: async () => { } }), async (reason, kind) => { told2.push({ reason, kind }); return true; });
        const st2 = () => { try { return JSON.parse(fs.readFileSync(W.KEEP_STATE, 'utf8')); } catch (e) { return {}; } };
        try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ }
        let reads = 0; W._setMem(() => { reads++; return { free_mb: 11990, total_mb: 15339 }; });
        let m = await W.memMaybe();
        ok('여유 넉넉(11,990MB) = 재고 기록 · 알림 0', m && m.free_mb === 11990 && W.MEM.free_mb === 11990 && W.MEM.total_mb === 15339 && told2.length === 0 && reads === 1);
        ok('1시간 안 다시 = 안 잼', (await W.memMaybe()) === null && reads === 1);
        const q = []; await W.heartbeat({ query: async (sql, args) => { q.push(JSON.parse(args[0])); } }, 'idle');
        ok('heartbeat 에 commit_free_mb·commit_total_mb·mem_at 실림', q.length === 1 && q[0].commit_free_mb === 11990 && q[0].commit_total_mb === 15339 && !!q[0].mem_at && q[0].state === 'idle' && q[0].pid === process.pid, JSON.stringify(q[0]));
        W._setMem(() => ({ free_mb: 800, total_mb: 16221 })); m = await W.memMaybe(true);
        ok('여유 800MB(< 1,024) = 텔레그램 1통(갈래 vm_mem · 120자 안)', told2.length === 1 && told2[0].kind === 'vm_mem' && /여유 800MB/.test(told2[0].reason) && told2[0].reason.length <= 120 && st2().mem_told_day, JSON.stringify(told2));
        await W.memMaybe(true);
        ok('같은 날 다시 낮음 = 알림 추가 0', told2.length === 1);
        fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ ...st2(), mem_told_day: '2026-01-01' })); await W.memMaybe(true);
        ok('날이 바뀌면 다시 1통', told2.length === 2 && told2[1].kind === 'vm_mem');
        W._setMem(() => null); const before = W.MEM.free_mb; m = await W.memMaybe(true);
        ok('못 잼(null · 윈도우 아님·명령 실패) = 조용히 넘어감 · 앞 값 그대로', m === null && W.MEM.free_mb === before && told2.length === 2);
        W._setMem(() => { throw new Error('powershell 없음'); }); m = await W.memMaybe(true);
        ok('재는 중 오류 = 조용히 넘어감', m === null && told2.length === 2);
        const q0 = []; W._setMem(null); await W.heartbeat({ query: async (sql, args) => { q0.push(JSON.parse(args[0])); } }, 'idle');
        ok('아직 잰 적 없으면 heartbeat 는 종전 꼴(메모리 칸 없음)', q0.length === 1 && !('commit_free_mb' in q0[0]), JSON.stringify(q0[0]));
        ok('메모리 부족 글 판정 = OutOfMemory · bun.report · out of memory / 보통 오류는 아님', W.isOomText('Decompression error: OutOfMemory') && W.isOomText('https://bun.report/1.4.4/wa1424') && W.isOomText('JavaScript heap out of memory') && !W.isOomText('exit 3') && !W.isOomText('10분 넘어 끔') && !W.isOomText(''));
        /* claudeOnce 실패 길 = 가짜 실행 파일이 메모리 부족 글을 내고 죽음 */
        const fake = path.join(T, 'fake-oom.js'); fs.writeFileSync(fake, "process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write(process.env.FAKE_ERR || 'boom'); process.exit(Number(process.env.FAKE_CODE || 1)); });");
        process.env.VM_CLAUDE_BIN = fake; told2.length = 0; try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ }
        W._setMem(() => ({ free_mb: 390, total_mb: 16221 }));
        process.env.FAKE_ERR = 'Decompression error: OutOfMemory';
        let c1 = await W.claudeOnce(null, { id: 9001, content: '[VM] 시험' }, 'm', 20000, '시험', T);
        ok('Claude 가 OutOfMemory 로 죽음 = 실패 답 그대로 + 텔레그램 vm_oom 1통(+ 여유가 낮으면 vm_mem 도)', c1.ok === false && /OutOfMemory/.test(c1.why) && told2.some(x => x.kind === 'vm_oom' && x.reason.length <= 120) && told2.filter(x => x.kind === 'vm_oom').length === 1 && told2.some(x => x.kind === 'vm_mem'), JSON.stringify([c1, told2]));
        const n1 = told2.length; process.env.FAKE_ERR = 'https://bun.report/1.4.4/wa1424a542'; c1 = await W.claudeOnce(null, { id: 9002, content: '[VM] 시험' }, 'm', 20000, '시험', T);
        ok('같은 날 또 죽음(bun 충돌 주소) = 실패 답 · 알림 추가 0', c1.ok === false && /bun\.report/.test(c1.why) && told2.length === n1);
        try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ } told2.length = 0; process.env.FAKE_ERR = 'Error: network timeout'; c1 = await W.claudeOnce(null, { id: 9003, content: '[VM] 시험' }, 'm', 20000, '시험', T);
        ok('보통 실패(메모리 아님) = 알림 0 · 실패 답 종전 꼴', c1.ok === false && /claude 실패: Error: network timeout/.test(c1.why) && told2.length === 0, JSON.stringify([c1, told2]));
        delete process.env.VM_CLAUDE_BIN; delete process.env.FAKE_ERR; W._setMem(null); W._setKeep(null, null);
    }

    console.log('── #1242-2 어사이드 앱 다시 열기(누수 돌려받기)');
    {
        const st3 = () => { try { return JSON.parse(fs.readFileSync(W.KEEP_STATE, 'utf8')); } catch (e) { return {}; } };
        const wipe = () => { try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ } };
        let kills = 0; W._setAsideKill(() => { kills++; return true; });
        W._setRecycleAt('4');   /* #1314 이 묶음은 종전 「4」(04:00~04:59) 값으로 = 종전 단언 그대로 */
        const at = h => Date.UTC(2026, 10, 22, h - 9, 30, 0);   /* KST h시 30분 */
        const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        wipe(); W._setMem(() => ({ free_mb: 9000, total_mb: 15339 })); await W.memMaybe(true);
        ok('여유 넉넉(9,000MB) · 04시 아님 = 안 끔', (await W.asideRecycleMaybe(at(15))) === null && kills === 0);
        W._setMem(() => ({ free_mb: 2500, total_mb: 15339 })); await W.memMaybe(true);
        let rr = await W.asideRecycleMaybe(at(15));
        ok('여유 2,500MB(< 3,072) = 어사이드 앱 끔 1회 · 기록(low) · 유지 틱은 약 75초 뒤로 당김(keep_retry 1) · 메모리 다시 재게 · 04시대가 아니라 그날 치 기록은 안 함', rr && rr.why === 'low' && rr.killed && kills === 1 && st3().aside_recycle_why === 'low' && !!st3().aside_recycle_low_at && Date.parse(st3().at) === at(15) - 30 * 60000 + 75000 && st3().keep_retry === 1 && !st3().aside_recycle_day && W.MEM.at === 0, JSON.stringify([rr, st3()]));
        await W.memMaybe(true);
        ok('껐는데도 여유가 낮음 = 2시간 안에는 또 끄지 않음(주인이 다른 것 = 메모리 알림 몫)', (await W.asideRecycleMaybe(at(15) + 30 * 60000)) === null && kills === 1);
        rr = await W.asideRecycleMaybe(at(15) + 121 * 60000);
        ok('2시간 지나도 낮으면 한 번 더', rr && rr.why === 'low' && kills === 2);
        wipe(); W._setMem(() => ({ free_mb: 9000, total_mb: 15339 })); await W.memMaybe(true); kills = 0;
        rr = await W.asideRecycleMaybe(at(4));
        ok('04시(KST) · 오늘 아직 안 함 = 하루 1번 끔(daily) · 날짜 기록', rr && rr.why === 'daily' && kills === 1 && st3().aside_recycle_day === today, JSON.stringify([rr, st3()]));
        ok('같은 날 04시에 다시 = 안 끔', (await W.asideRecycleMaybe(at(4) + 20 * 60000)) === null && kills === 1);
        wipe(); fs.writeFileSync(W.LOCK, '99999'); kills = 0;
        ok('남의 잠금(체험 번호 틱 등)이 있으면 안 끔 · 잠금 안 지움', (await W.asideRecycleMaybe(at(4))) === null && kills === 0 && fs.readFileSync(W.LOCK, 'utf8') === '99999' && !st3().aside_recycle_day);
        fs.unlinkSync(W.LOCK);
        W._setAsideKill(() => false); rr = await W.asideRecycleMaybe(at(4));
        ok('끌 앱이 없음(이미 꺼짐) = 기록은 남기고 조용히 넘어감 · 잠금 풀림', rr && rr.killed === false && st3().aside_recycle_day === today && !fs.existsSync(W.LOCK));
        W._setAsideKill(() => { throw new Error('taskkill 없음'); }); wipe(); rr = await W.asideRecycleMaybe(at(4));
        ok('끄는 중 오류 = 잠금 풀고 넘어감(러너 안 죽음)', rr && rr.killed === false && !fs.existsSync(W.LOCK));
        W._setMem(null); wipe(); W._setAsideKill(() => { kills++; return true; }); kills = 0;
        ok('메모리를 아직 못 쟀고 04시도 아님 = 안 끔', (await W.asideRecycleMaybe(at(15))) === null && kills === 0);
        /* 끈 뒤 = 로그인 유지가 30분을 기다리지 않고 바로 돎 */
        W._setMem(() => ({ free_mb: 2000, total_mb: 15339 })); await W.memMaybe(true);
        const seen3 = []; W._setKeep(() => ({ start: async () => ({}), replJson: async () => { seen3.push(1); return { state: 'relogin', store: '제주아꼼이네', closed: 1 }; }, stop: async () => { } }), async () => true);
        fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ at: new Date().toISOString(), result: 'ok' }));
        ok('(앞서) 방금 유지 틱이 돈 상태 = 30분 안이라 안 돎', (await W.keepMaybe()) === null && seen3.length === 0);
        const shift = ms => fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ ...st3(), at: new Date(Date.parse(st3().at) - ms).toISOString() }));   /* 시간이 ms 만큼 흐른 꼴 */
        await W.asideRecycleMaybe(Date.now());
        ok('어사이드 끈 직후(0초) = 유지 틱 아직 안 돎(켜지는 중)', kills === 1 && (await W.keepMaybe()) === null && seen3.length === 0 && st3().keep_retry === 1);
        shift(60000); ok('60초 뒤 = 아직', (await W.keepMaybe()) === null && seen3.length === 0);
        shift(20000); let k3 = await W.keepMaybe();
        ok('약 75초 뒤 = 유지 틱이 돌아 다시 켜고 로그인 확인(relogin) · keep_retry 풀림 · 다음은 종전 30분', k3 && k3.state === 'relogin' && seen3.length === 1 && st3().keep_retry === 0 && (await W.keepMaybe()) === null, JSON.stringify([k3, st3()]));
        /* 끈 뒤 첫 틱이 오류(어사이드가 아직 켜지는 중) = 90초 뒤 1번만 더 */
        let mode3 = 'throw'; W._setKeep(() => ({ start: async () => ({}), replJson: async () => { seen3.push(mode3); if (mode3 === 'throw') throw new Error('Tab X is no longer available.'); return { state: 'ok', store: '제주아꼼이네', closed: 1 }; }, stop: async () => { } }), async () => true);
        fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ at: new Date().toISOString(), result: 'ok' })); W._setMem(() => ({ free_mb: 2000, total_mb: 15339 })); await W.memMaybe(true); seen3.length = 0;
        await W.asideRecycleMaybe(Date.now() + 3 * 3600e3); shift(3 * 3600e3 + 80000); k3 = await W.keepMaybe();
        ok('끈 뒤 첫 틱이 오류 = error 기록 · 90초 뒤 다시 돌게 당김(keep_retry 0)', k3 && k3.state === 'error' && seen3.length === 1 && st3().keep_retry === 0 && Math.abs(Date.parse(st3().at) - (Date.now() - 30 * 60000 + 90000)) < 5000, JSON.stringify([k3, st3()]));
        ok('바로는 안 돎', (await W.keepMaybe()) === null && seen3.length === 1);
        shift(95000); mode3 = 'ok'; k3 = await W.keepMaybe();
        ok('90초 뒤 다시 = ok', k3 && k3.state === 'ok' && seen3.length === 2);
        mode3 = 'throw'; fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ at: new Date(Date.now() - 31 * 60000).toISOString(), result: 'ok', keep_retry: 0 })); k3 = await W.keepMaybe();
        ok('보통 때의 오류(다시 열기와 무관) = 종전대로 30분 뒤(당기지 않음)', k3 && k3.state === 'error' && Math.abs(Date.parse(st3().at) - Date.now()) < 5000 && (await W.keepMaybe()) === null);
        /* 04시대에 여유가 낮아 끈 경우 = 그날 하루 1번 치도 한 것으로 */
        wipe(); W._setMem(() => ({ free_mb: 2500, total_mb: 15339 })); await W.memMaybe(true); kills = 0;
        rr = await W.asideRecycleMaybe(at(4));
        ok('04시대에 low 로 끔 = aside_recycle_day 도 기록 · 같은 시간대 daily 로 또 끄지 않음', rr && rr.why === 'low' && st3().aside_recycle_day === today && kills === 1, JSON.stringify([rr, st3()]));
        W._setMem(() => ({ free_mb: 9000, total_mb: 15339 })); await W.memMaybe(true);
        ok('  (이어서 04시대 · 여유 넉넉) = 안 끔', (await W.asideRecycleMaybe(at(4) + 10 * 60000)) === null && kills === 1);
        ok('끄는 명령 = 데몬 + 앱 본체만 · CLI 경로(\\CLI\\)는 빼고 · taskkill /IM 안 씀', /aside-daemon\.exe/.test(W.ASIDE_KILL_PS) && /Aside\.exe/.test(W.ASIDE_KILL_PS) && /ExecutablePath -notmatch '\\\\CLI\\\\'/.test(W.ASIDE_KILL_PS) && !/taskkill/i.test(W.ASIDE_KILL_PS));
        /* #1314 기본 06:30 · 「H:MM」 · 60분 창 */
        const atm = (h, m) => Date.UTC(2026, 10, 22, h - 9, m, 0);
        W._setRecycleAt(); delete process.env.VM_ASIDE_RECYCLE_HOUR; W._setRecycleAt();
        ok('#1314 기본 = 06:30', W.recycleLabel(W.parseRecycleAt(undefined)) === '06:30' && W.recycleLabel(W.parseRecycleAt(null)) === '06:30');
        ok('#1314 값 꼴 = 「6:30」 06:30 · 「4」 04:00 · 「04:05」 · 빈 값·음수·「25」·「6:75」·「abc」 = 끔', W.recycleLabel(W.parseRecycleAt('6:30')) === '06:30' && W.recycleLabel(W.parseRecycleAt('4')) === '04:00' && W.recycleLabel(W.parseRecycleAt('04:05')) === '04:05' && ['', ' ', '-1', '25', '6:75', 'abc'].every(v => W.parseRecycleAt(v) === null));
        const A630 = W.parseRecycleAt(null), A4 = W.parseRecycleAt('4');
        ok('#1314 창 = 06:29 아님 · 06:30·06:45·07:29 맞음 · 07:30·07:31 아님', !W.inRecycleWindow(A630, atm(6, 29)) && W.inRecycleWindow(A630, atm(6, 30)) && W.inRecycleWindow(A630, atm(6, 45)) && W.inRecycleWindow(A630, atm(7, 29)) && !W.inRecycleWindow(A630, atm(7, 30)) && !W.inRecycleWindow(A630, atm(7, 31)));
        ok('#1314 「4」 = 04:00~04:59(종전 그 시 꼴) · 03:59·05:00 아님', W.inRecycleWindow(A4, atm(4, 0)) && W.inRecycleWindow(A4, atm(4, 59)) && !W.inRecycleWindow(A4, atm(3, 59)) && !W.inRecycleWindow(A4, atm(5, 0)));
        ok('#1314 끔(null) = 창 없음', !W.inRecycleWindow(null, atm(6, 45)));
        wipe(); W._setMem(() => ({ free_mb: 9000, total_mb: 15339 })); await W.memMaybe(true); W._setAsideKill(() => { kills++; return true; }); kills = 0;
        ok('#1314 기본값 06:29 = 안 끔', (await W.asideRecycleMaybe(atm(6, 29))) === null && kills === 0);
        rr = await W.asideRecycleMaybe(atm(6, 45));
        ok('#1314 기본값 06:45(밀린 틱) = 하루 1번 끔 · 날짜 기록', rr && rr.why === 'daily' && kills === 1 && st3().aside_recycle_day === today, JSON.stringify([rr, st3()]));
        ok('#1314 같은 날 07:10 다시 = 안 끔', (await W.asideRecycleMaybe(atm(7, 10))) === null && kills === 1);
        wipe(); ok('#1314 06:30 정각 = 끔', (await W.asideRecycleMaybe(atm(6, 30))) && kills === 2);
        wipe(); ok('#1314 07:31(창 놓침) = 그날 건너뜀', (await W.asideRecycleMaybe(atm(7, 31))) === null && kills === 2);
        wipe(); ok('#1314 04:30(옛 시각) = 이제 안 끔', (await W.asideRecycleMaybe(atm(4, 30))) === null && kills === 2);
        W._setRecycleAt(''); wipe(); ok('#1314 빈 값 = 하루 1번 끔(06:45에도 안 함)', (await W.asideRecycleMaybe(atm(6, 45))) === null && kills === 2);
        W._setRecycleAt();
        W._setAsideKill(null); W._setMem(null); W._setKeep(null, null); wipe();
    }

    console.log('── #1281 단추 늦게 뜸 · 쉼 중 상태 읽기만');
    {
        let log, t, r; const noOpen = async () => { throw new Error('openTab 불림'); };
        log = []; t = mkTab('dash', { onReload: () => 'loginNoBtn', onLook: x => { if (x.screen === 'loginNoBtn' && x.looks >= 4) x.screen = 'login'; }, onSimple: x => { x.screen = 'dash'; } }, log, 'A'); r = await runKeep([t], noOpen);
        ok('커머스ID 화면에서 간편 로그인 단추가 늦게 뜸 = 기다렸다 1번 누름 → relogin(종전 = 6초 1번 찾고 login_fail)', r.state === 'relogin' && r.clicked && log.filter(x => x === 'A:tap간편=true').length === 1 && log.filter(x => x === 'A:tap간편=false').length >= 1, JSON.stringify(r) + log);

        log = []; t = mkTab('dash', { onReload: () => 'loginNoBtn' }, log, 'A'); r = await runKeep([t], noOpen);
        ok('끝내 단추 없음 = login_fail · 찾기는 최대 10번(무한 대기 X)', r.state === 'login_fail' && !r.clicked && log.filter(x => /tap간편/.test(x)).length === 10, JSON.stringify(r) + ' taps ' + log.filter(x => /tap간편/.test(x)).length);

        log = []; t = mkTab('dash', { onReload: () => 'loginNoBtn', onLook: x => { if (x.screen === 'loginNoBtn' && x.looks >= 3) x.screen = 'phone'; } }, log, 'A'); r = await runKeep([t], noOpen);
        ok('단추 기다리는 중 폰 승인 화면 = need_phone · 누름 0', r.state === 'need_phone' && !log.some(x => /tap간편=true/.test(x)), JSON.stringify(r) + log);

        log = []; t = mkTab('first', { onFirst: () => { }, onLook: x => { if (x.screen === 'first' && x.looks >= 3) x.screen = 'login'; }, onSimple: x => { x.screen = 'dash'; } }, log, 'A'); r = await runKeep([t], noOpen);
        ok('「로그인하기」 뒤 커머스ID 화면이 늦게 뜸 = 기다렸다 간편 로그인 → relogin(「로그인하기」 1번만)', r.state === 'relogin' && r.first && r.clicked && log.filter(x => /tap로그인하기=true/.test(x)).length === 1, JSON.stringify(r) + log);

        let n = 0; log = []; t = mkTab('dash', { onReload: () => { n++; return n === 1 ? 'login' : 'login'; }, onSimple: () => { }, onLook: x => { if (x.screen === 'login' && log.includes('A:tap간편=true') && x.looks >= 3) x.screen = 'dash'; } }, log, 'A'); r = await runKeep([t], noOpen);
        ok('간편 로그인 누른 뒤 늦게 넘어감(새로고침 뒤에도 로그인 화면 · 8초 뒤 다시 보니 대시보드) = relogin · 누름 1번', r.state === 'relogin' && log.filter(x => x === 'A:tap간편=true').length === 1, JSON.stringify(r) + log + ' looks ' + t.looks);

        ok('읽기만 코드(JS_KEEP_RO) = 누름 막이 RO 표식 · 종전 코드는 RO false', /const RO = true;/.test(W.JS_KEEP_RO) && /const RO = false;/.test(W.JS_KEEP) && W.JS_KEEP_RO.replace('const RO = true;', '') === W.JS_KEEP.replace('const RO = false;', ''));
        log = []; t = mkTab('dash', {}, log, 'A'); r = await runKeep([t], noOpen, W.JS_KEEP_RO);
        ok('읽기만 · 대시보드 = ok · 누름 0 · 스토어 이름', r.state === 'ok' && r.ro === true && r.store === '제주아꼼이네' && !log.some(x => /tap/.test(x)), JSON.stringify(r));
        log = []; t = mkTab('first', { onFirst: x => { x.screen = 'login'; } }, log, 'A'); r = await runKeep([t], noOpen, W.JS_KEEP_RO);
        ok('읽기만 · 로그인 안 된 첫 화면 = logged_out · 「로그인하기」 누름 0', r.state === 'logged_out' && !r.first && !log.some(x => /tap/.test(x)), JSON.stringify(r) + log);
        log = []; t = mkTab('dash', { onReload: () => 'login', onSimple: x => { x.screen = 'dash'; } }, log, 'A'); r = await runKeep([t], noOpen, W.JS_KEEP_RO);
        ok('읽기만 · 커머스ID 로그인 화면 = logged_out · 간편 로그인 누름 0', r.state === 'logged_out' && !r.clicked && !log.some(x => /tap/.test(x)), JSON.stringify(r) + log);
        log = []; t = mkTab('dash', { onReload: () => 'phone' }, log, 'A'); r = await runKeep([t], noOpen, W.JS_KEEP_RO);
        ok('읽기만 · 폰 승인 화면 = need_phone · 누름 0', r.state === 'need_phone' && !log.some(x => /tap/.test(x)), JSON.stringify(r));
        log = []; const nt = mkTab('first2', {}, log, 'N'); r = await runKeep([], async () => nt, W.JS_KEEP_RO);
        ok('읽기만 · 센터 탭 없어 새로 연 탭이 로그인 전 = logged_out · 그 탭은 닫음(쌓이지 않게)', r.state === 'logged_out' && r.opened && CLOSED.includes('N') && !log.some(x => /tap/.test(x)), JSON.stringify(r) + CLOSED);

        console.log('── #1281-b 어사이드 repl 상한(120초) 안 · 읽기만 폰 승인 탭 닫기');
        log = []; t = mkTab('dash', { onReload: () => 'loginNoBtn' }, log, 'A'); r = await runKeep([t], noOpen);
        ok('단추 끝내 없음 = 찾기 10번 이하 · 기다림 합 < 50초(시작 35초 안에서만 찾음)', r.state === 'login_fail' && CLOCK.t < 50000 && log.filter(x => /tap간편/.test(x)).length <= 10, 'clock ' + CLOCK.t + ' taps ' + log.filter(x => /tap간편/.test(x)).length);
        log = []; t = mkTab('blank', { onLook: x => { if (x.looks >= 4) x.screen = 'first'; } }, log, 'A'); r = await runKeep([t], noOpen);
        ok('최악 길(빈 머리 3번 → 「로그인하기」 → 커머스ID 안 뜸) = 기다림 합 < 100초', CLOCK.t < 100000 && r.state === 'login_fail', JSON.stringify(r) + ' clock ' + CLOCK.t);
        { const tabsW = []; const pw = mkTab('login', {}, log, 'P'); log = []; const tw = mkTab('dash', { onReload: () => 'loginNoBtn', onLook: x => { if (x.screen === 'loginNoBtn' && x.looks >= 4) x.screen = 'login'; }, onSimple: () => { if (!tabsW.includes(pw)) tabsW.push(pw); } }, log, 'A'); tabsW.push(tw);
          r = await runKeep(tabsW, noOpen);
          ok('최악 길(단추 늦게 → 누름 → 로그인 창이 안 닫힘 30초 → 새로고침 → 로그인 전) = 기다림 합 < 110초(repl 120초 안) · 8초 재확인은 100초 넘으면 건너뜀', r.state === 'login_fail' && r.clicked && CLOCK.t < 110000, JSON.stringify(r) + ' clock ' + CLOCK.t); }
        log = []; const np = mkTab('phone', {}, log, 'N'); r = await runKeep([], async () => np, W.JS_KEEP_RO);
        ok('읽기만 · 새로 연 탭이 폰 승인 화면 = need_phone · 그 탭 닫음 · 누름 0', r.state === 'need_phone' && r.opened && CLOSED.includes('N') && !log.some(x => /tap/.test(x)), JSON.stringify(r) + CLOSED);
        log = []; const np2 = mkTab('phone', {}, log, 'N'); r = await runKeep([], async () => np2);
        ok('누름 있는 틱 · 새로 연 탭이 폰 승인 화면 = need_phone · 탭 그대로(사람이 풀 화면 · 종전)', r.state === 'need_phone' && !CLOSED.includes('N'), JSON.stringify(r) + CLOSED);
        { const src = fs.readFileSync(path.join(__dirname, 'vm', 'vm-watch.js'), 'utf8');
          ok('경주 상한 = 5분 · 오류 글도 5분 · 잠금 낡음 판정(15분)보다 짧음', /rej\(new Error\('센터 유지 5분 넘음'\)\), 5 \* 60000\)/.test(src) && !/센터 유지 3분 넘음/.test(src) && /LOCK_STALE_MS = 15 \* 60000/.test(src)); }

        const told6 = [], seen6 = []; let next6 = null;
        W._setKeep(() => ({ start: async () => ({}), replJson: async (title, code) => { seen6.push({ title, ro: /const RO = true;/.test(code) }); return next6; }, stop: async () => { } }), async (reason, kind) => { told6.push({ reason, kind }); return true; });
        const st6 = () => JSON.parse(fs.readFileSync(W.KEEP_STATE, 'utf8')); const ago = m => new Date(Date.now() - m * 60000).toISOString();
        const put6 = o => { try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ } fs.writeFileSync(W.KEEP_STATE, JSON.stringify(o)); };
        const FAILED = { phone_at: ago(31), at: ago(31), result: 'login_fail', center_at: ago(31), center_state: 'login_fail', center_store: '' };

        put6(FAILED); next6 = { state: 'ok', where: 'sell.smartstore.naver.com/', store: '제주아꼼이네', ro: true }; let k6 = await W.keepMaybe();
        ok('login_fail 뒤 쉼 중(31분) · 사람 손으로 로그인됨 = 읽기만 틱 → ok · 쉼 풀림 · heartbeat center ok · 텔레그램 0', k6 && k6.state === 'ok' && seen6.length === 1 && seen6[0].ro && /#1281/.test(seen6[0].title) && !st6().phone_at && st6().center_state === 'ok' && told6.length === 0, JSON.stringify(st6()) + JSON.stringify(seen6));
        next6 = { state: 'ok', where: 'x', store: '제주아꼼이네' }; fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ ...st6(), at: ago(31) })); k6 = await W.keepMaybe();
        ok('쉼 풀린 뒤 다음 틱 = 종전 유지 틱(누름 있는 코드)', k6 && k6.state === 'ok' && seen6.length === 2 && !seen6[1].ro, JSON.stringify(seen6));

        put6(FAILED); seen6.length = 0; next6 = { state: 'logged_out', where: 'sell.smartstore.naver.com/home', store: '', ro: true }; k6 = await W.keepMaybe();
        ok('쉼 중 · 아직 로그아웃 = 읽기만(누름 0) · 쉼 그대로 · heartbeat center = login_fail 그대로 · 텔레그램 0', k6 && k6.state === 'logged_out' && seen6.length === 1 && seen6[0].ro && st6().phone_at === FAILED.phone_at && st6().center_state === 'login_fail' && st6().center_at === FAILED.center_at && st6().ro_result === 'logged_out' && told6.length === 0, JSON.stringify(st6()));
        ok('  그 뒤 30분 안 = 안 돎', (await W.keepMaybe()) === null && seen6.length === 1);

        put6({ ...FAILED, at: ago(5) }); seen6.length = 0; ok('쉼 중이라도 직전 틱 30분 안 = 안 돎', (await W.keepMaybe()) === null && seen6.length === 0);

        put6({ ...FAILED, phone_at: ago(181), at: ago(181) }); seen6.length = 0; next6 = { state: 'relogin', clicked: true, where: 'x', store: '제주아꼼이네' }; k6 = await W.keepMaybe();
        ok('3시간 쉼이 지나면 = 종전 유지 틱(누름 있음)', k6 && k6.state === 'relogin' && seen6.length === 1 && !seen6[0].ro);

        put6({ ...FAILED, result: 'need_phone', center_state: 'need_phone' }); seen6.length = 0; next6 = { state: 'need_phone', where: 'nid.naver.com/login', ro: true }; k6 = await W.keepMaybe();
        ok('폰 승인 쉼 중 · 아직 폰 승인 화면 = 읽기만 · 쉼 그대로 · 알림 0(누르기 재시도 0)', k6 && k6.state === 'need_phone' && seen6[0].ro && st6().phone_at === FAILED.phone_at && told6.length === 0);
        put6({ ...FAILED, result: 'need_phone', center_state: 'need_phone' }); seen6.length = 0; next6 = { state: 'ok', where: 'x', store: '제주아꼼이네 직영몰', ro: true }; k6 = await W.keepMaybe();
        ok('쉼 중 읽어 보니 로그인됐는데 직영몰 = 쉼 풀림 + 종전 직영몰 알림 1통', k6 && k6.state === 'wrong_store' && !st6().phone_at && told6.length === 1 && told6[0].kind === 'center_store', JSON.stringify(told6));

        put6({ ...FAILED, fail_n: 3 }); seen6.length = 0; next6 = { state: 'login_fail', where: 'x', store: '' }; k6 = await W.keepMaybe(true);   /* #1295 쉼은 연속 3번 실패 뒤에만 걸리므로 그때의 셈(3)을 같이 둠 */
        ok('force = 쉼 무시 종전 길(누름 있는 코드 · 종전 알림 · #1295 연속 4번)', k6 && k6.state === 'login_fail' && !seen6[0].ro && told6.length === 2 && told6[1].kind === 'center_login' && told6[1].reason.includes('연속 4번') && st6().fail_n === 4);
        W._setKeep(null, null); try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ }
    }

    console.log('── ③ 지시문');
    const P = W.promptFor({ id: 1, content: '[VM] 아이디 abc123 포인트 보상 5,000 · 사유 타이벡 파손 보상처리' });
    const A = W.promptFor({ id: 2, content: '[VM] 배송지 변경 주문번호 2026110170868221 → 제주시 서흘길 9, 3층' }, { sentToday: false });
    const G = W.promptFor({ id: 3, content: '[VM] 센터 로그인 상태만 확인해 주세요' });
    const cnt = (s, re) => (s.match(re) || []).length;
    ok('포인트 지시문 = 포인트 갈래 · 스토어 확인 줄 1개 · (a) 다음 (b-t) 앞', W.isPoint('[VM] 아이디 abc123 포인트 보상 5,000') && cnt(P, /\(a-2\) #1230 스토어 확인/g) === 1 && P.indexOf('(a) 스마트스토어센터 로그인') < P.indexOf('(a-2)') && P.indexOf('(a-2)') < P.indexOf('(b-t)'));
    ok('배송지 지시문 = 배송지 갈래 · 스토어 확인 줄 1개 · (a) 다음 (b-t) 앞', W.isAddr('[VM] 배송지 변경 주문번호 2026110170868221 → 제주시 서흘길 9, 3층') && cnt(A, /\(a-2\) #1230 스토어 확인/g) === 1 && A.indexOf('(a) 센터 로그인') < A.indexOf('(a-2)') && A.indexOf('(a-2)') < A.indexOf('(b-t)'));
    ok('스토어 확인 줄 = 직영몰이면 [스토어 이동] → 다시 읽기 → 아니면 지급·저장 없이 멈춤 · 직영몰 주문은 안 함', /\[스토어 이동\]/.test(P) && /지급·저장하지 말고 멈춰/.test(P) && /직영몰 주문은 VM 이 안 해요/.test(P) && /이름을 다시 읽는다/.test(P));
    ok('그 밖 지시(조회)에는 스토어 확인 줄 없음(종전 그대로)', cnt(G, /#1230/g) === 0);
    ok('#1242 뒷정리 줄(연 탭 닫기) = 포인트·배송지·조회 지시문 모두 1줄', [P, A, G].every(x => cnt(x, /⑦뒷정리\(#1242\)/g) === 1 && /closeTab/.test(x)));
    ok('포인트·배송지 기존 절차 줄 그대로((b-0)·(c)·(d)·(e)·(f) · 배송지 (b)~(h)·(i))', ['(b-0)', '(b-1)', '(c) 중복 막기', '(d) 지급 화면', '(d-2)', '(e) 끝 보고', '(f) (b) 길', '(g) 지시 글 꼴'].every(x => P.includes(x)) && ['(b) 판매관리', '(c) 그 주문의', '(d) 저장 뒤', '(e) 멈춤', '(f) 지시에 배송 메모', '(g) 끝 보고', '(h) 지시 글 꼴', '(i) 오늘 최종발주'].every(x => A.includes(x)));

    console.log(`\n합계 ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ''}`);
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) { /* 임시 폴더 */ }
    process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1); });
