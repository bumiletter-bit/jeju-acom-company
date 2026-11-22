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
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
async function runKeep(tabs, openTab) {
    const out = []; const fakeConsole = { log: s => out.push(s) }; const fastTimeout = (fn) => { Promise.resolve().then(fn); return 0; };
    await new AsyncFunction('tabs', 'openTab', 'console', 'setTimeout', W.JS_KEEP)(tabs, openTab, fakeConsole, fastTimeout);
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
    ok('센터 주소인데 머리 글이 안 보임(두 번 봐도) = unknown(주소만으로 ok 아님)', r.state === 'unknown' && t.looks === 2, JSON.stringify(r) + ' looks ' + t.looks);

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
    ok('login_fail = 종전 알림(갈래 center_login · 「간편 로그인 안 됨」) · 3시간 쉼', k.state === 'login_fail' && told.length === 1 && told[0].kind === 'center_login' && /간편 로그인 안 됨/.test(told[0].reason) && !!state().phone_at, JSON.stringify(told));

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
    ok('login_fail 이 오면 셈 0(그 알림은 종전 갈래)', state().unknown_n === 0 && told.length === 2 && told[1].kind === 'center_login');

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

    console.log('── ③ 지시문');
    const P = W.promptFor({ id: 1, content: '[VM] 아이디 abc123 포인트 보상 5,000 · 사유 타이벡 파손 보상처리' });
    const A = W.promptFor({ id: 2, content: '[VM] 배송지 변경 주문번호 2026110170868221 → 제주시 서흘길 9, 3층' }, { sentToday: false });
    const G = W.promptFor({ id: 3, content: '[VM] 센터 로그인 상태만 확인해 주세요' });
    const cnt = (s, re) => (s.match(re) || []).length;
    ok('포인트 지시문 = 포인트 갈래 · 스토어 확인 줄 1개 · (a) 다음 (b-t) 앞', W.isPoint('[VM] 아이디 abc123 포인트 보상 5,000') && cnt(P, /\(a-2\) #1230 스토어 확인/g) === 1 && P.indexOf('(a) 스마트스토어센터 로그인') < P.indexOf('(a-2)') && P.indexOf('(a-2)') < P.indexOf('(b-t)'));
    ok('배송지 지시문 = 배송지 갈래 · 스토어 확인 줄 1개 · (a) 다음 (b-t) 앞', W.isAddr('[VM] 배송지 변경 주문번호 2026110170868221 → 제주시 서흘길 9, 3층') && cnt(A, /\(a-2\) #1230 스토어 확인/g) === 1 && A.indexOf('(a) 센터 로그인') < A.indexOf('(a-2)') && A.indexOf('(a-2)') < A.indexOf('(b-t)'));
    ok('스토어 확인 줄 = 직영몰이면 [스토어 이동] → 다시 읽기 → 아니면 지급·저장 없이 멈춤 · 직영몰 주문은 안 함', /\[스토어 이동\]/.test(P) && /지급·저장하지 말고 멈춰/.test(P) && /직영몰 주문은 VM 이 안 해요/.test(P) && /이름을 다시 읽는다/.test(P));
    ok('그 밖 지시(조회)에는 스토어 확인 줄 없음(종전 그대로)', cnt(G, /#1230/g) === 0);
    ok('포인트·배송지 기존 절차 줄 그대로((b-0)·(c)·(d)·(e)·(f) · 배송지 (b)~(h)·(i))', ['(b-0)', '(b-1)', '(c) 중복 막기', '(d) 지급 화면', '(d-2)', '(e) 끝 보고', '(f) (b) 길', '(g) 지시 글 꼴'].every(x => P.includes(x)) && ['(b) 판매관리', '(c) 그 주문의', '(d) 저장 뒤', '(e) 멈춤', '(f) 지시에 배송 메모', '(g) 끝 보고', '(h) 지시 글 꼴', '(i) 오늘 최종발주'].every(x => A.includes(x)));

    console.log(`\n합계 ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ''}`);
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) { /* 임시 폴더 */ }
    process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1); });
