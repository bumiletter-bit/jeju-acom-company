// #1088 검증 — 쉼 창 없애고 어사이드 잠금 줄 세우기(keyword-rank.js krLockWait·withKrLock · vm-watch 순위 갈래 KR_LOCK_HELD · exp-phone-auto 창·krBusy)
//   실DB 0 · 어사이드 0 · 네트워크 0 · 임시 홈 폴더 안 가짜 잠금 파일만
//   사용: node scripts/verify-1088-queue.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'v1088-'));
const HOMED = path.join(T, 'home'); fs.mkdirSync(path.join(HOMED, '.akkome'), { recursive: true });
process.env.USERPROFILE = HOMED; process.env.HOME = HOMED;
process.env.KR_LOCK_WAIT_MS = '1500'; process.env.KR_LOCK_POLL_MS = '150'; process.env.KR_LOCK_TOUCH_MS = '100';
delete process.env.KR_LOCK_HELD;
const K = require('./desk/keyword-rank.js');
const E = require('./vm/exp-phone-auto.js');
const LOCK = path.join(HOMED, '.akkome', 'exp-phone-auto.lock');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); } };
const logs = []; const log = m => logs.push(m);
const rm = () => { try { fs.unlinkSync(LOCK); } catch (e) { /* 없음 */ } };

(async () => {
    console.log('\n[1] 잠금 자리');
    ok('keyword-rank 잠금 = ~/.akkome/exp-phone-auto.lock(VM 러너·체험 틱과 같은 파일)', K.KR_LOCK === LOCK, K.KR_LOCK);
    const vmSrc = fs.readFileSync(path.join(__dirname, 'vm', 'vm-watch.js'), 'utf8');
    ok('vm-watch 잠금도 같은 이름', /path\.join\(DIR, 'exp-phone-auto\.lock'\)/.test(vmSrc));

    console.log('\n[2] 비어 있으면 바로 잡고 끝나면 풂');
    rm(); logs.length = 0;
    let inside = null;
    const r1 = await K.withKrLock(log, async lk => { inside = fs.readFileSync(LOCK, 'utf8'); return lk; });
    ok('바로 잡음 · 기다림 거의 0', r1.took && r1.waited_ms < 1000, r1);
    ok('도는 동안 잠금 = keyword-rank:pid', inside === 'keyword-rank:' + process.pid, inside);
    ok('끝나면 풀림', !fs.existsSync(LOCK));

    console.log('\n[3] 남(VM 러너)이 잡고 있음 → 기다림 → 풀리면 돎');
    fs.writeFileSync(LOCK, 'vm-watch:4242'); logs.length = 0;
    setTimeout(() => { try { fs.unlinkSync(LOCK); } catch (e) { /* */ } }, 500);
    const t3 = Date.now(); let ran3 = false;
    const r3 = await K.withKrLock(log, async lk => { ran3 = true; return lk; });
    ok('풀린 뒤 잡고 돎', ran3 && r3.took && !r3.gave_up, r3);
    ok('기다린 시간 ≈ 0.5초 이상 · 상한 전', r3.waited_ms >= 400 && Date.now() - t3 < 1500, r3);
    ok('기다림 로그(누가 잡았나 · 다시 간격)', logs.some(m => /잠금 잡혀 있음\(vm-watch:4242\)/.test(m)), logs);
    ok('끝나면 내 잠금 풀림', !fs.existsSync(LOCK));

    console.log('\n[4] 상한(시험 1.5초) 넘김 → 그냥 돎(순위 안 빠뜨림) · 남의 잠금 안 지움');
    fs.writeFileSync(LOCK, 'vm-watch:4343'); logs.length = 0;
    const iv = setInterval(() => { const t = new Date(); try { fs.utimesSync(LOCK, t, t); } catch (e) { /* */ } }, 100);   // 살아 있는 러너처럼 mtime 갱신
    let ran4 = false;
    const r4 = await K.withKrLock(log, async lk => { ran4 = true; return lk; });
    clearInterval(iv);
    ok('상한 넘김 = gave_up · 그래도 돎', ran4 && r4.gave_up && !r4.took && r4.waited_ms >= 1500, r4);
    ok('넘김 로그', logs.some(m => /기다려도 안 풀림\(vm-watch:4343\).*그냥 돎/.test(m)), logs);
    ok('남의 잠금은 그대로(안 지움)', fs.readFileSync(LOCK, 'utf8') === 'vm-watch:4343');
    rm();

    console.log('\n[5] 낡은 잠금(15분 넘음) = 지우고 바로 잡음');
    fs.writeFileSync(LOCK, 'vm-watch:9'); const old = new Date(Date.now() - 16 * 60000); fs.utimesSync(LOCK, old, old);
    const r5 = await K.withKrLock(log, async lk => lk);
    ok('낡은 잠금 = 바로 잡음', r5.took && r5.waited_ms < 1000, r5);
    ok('끝나면 풀림', !fs.existsSync(LOCK));

    console.log('\n[6] 예외 때도 풀림 · 도는 동안 mtime 갱신');
    rm(); let mt0 = 0, mt1 = 0, err = null;
    try {
        await K.withKrLock(log, async () => { mt0 = fs.statSync(LOCK).mtimeMs; await sleep(350); mt1 = fs.statSync(LOCK).mtimeMs; throw new Error('어사이드 터짐'); });
    } catch (e) { err = e.message; }
    ok('예외는 그대로 위로', err === '어사이드 터짐', err);
    ok('예외 뒤 잠금 풀림', !fs.existsSync(LOCK));
    ok('도는 동안 mtime 갱신(시험 0.1초 간격)', mt1 > mt0, { mt0, mt1 });

    console.log('\n[7] KR_LOCK_HELD=1(VM 러너 순위 갈래가 이미 잡음) = 안 기다림 · 안 건드림');
    fs.writeFileSync(LOCK, 'vm-watch:7777'); process.env.KR_LOCK_HELD = '1';
    const t7 = Date.now(); let ran7 = false;
    const r7 = await K.withKrLock(log, async lk => { ran7 = true; return lk; });
    delete process.env.KR_LOCK_HELD;
    ok('바로 돎 · held parent', ran7 && r7.held === 'parent' && Date.now() - t7 < 300, r7);
    ok('부모 잠금 그대로', fs.readFileSync(LOCK, 'utf8') === 'vm-watch:7777');
    rm();
    ok('vm-watch 순위 갈래가 KR_LOCK_HELD=1 을 넘김', /\[script, '--apply'\], \{[^\n]*env: \{ \.\.\.process\.env, KR_LOCK_HELD: '1' \}/.test(vmSrc));
    ok('vm-watch run() 이 env 를 spawn 에 넘김', /spawn\(cmd, a, \{ cwd: cwd \|\| ROOT, env: env \|\| process\.env,/.test(vmSrc));

    console.log('\n[8] main 이 어사이드 부분을 잠금으로 감쌈 · 기다린 시간 기록 · 예외 풀기');
    const kSrc = fs.readFileSync(path.join(__dirname, 'desk', 'keyword-rank.js'), 'utf8');
    ok('main = withKrLock 안에서 Aside 시작', /await withKrLock\(log, async lk => \{\s*\/\/[^\n]*\n\s*const aside = new Aside\(ASIDE_EXE, log\);/.test(kSrc));
    ok('keyword_rank_last.lock_wait_ms · lock_gave_up', /last\.lock_wait_ms = lk\.waited_ms; if \(lk\.gave_up\) last\.lock_gave_up = true;/.test(kSrc));
    ok('main().catch 에서도 krLockFree', /main\(\)\.catch\(e => \{[^\n]*krLockFree\(\);/.test(kSrc));
    const iSrc = fs.readFileSync(path.join(__dirname, 'desk', 'install-keyword-rank.js'), 'utf8');
    ok('작업 상한 20분 → 55분(기다림 35 + 수집 20)', /55 \* 60000/.test(iSrc) && !/\}, 20 \* 60000\)/.test(iSrc));

    console.log('\n[9] exp-phone-auto · vm-watch 쉼 창');
    const k = (hm, d) => new Date(Date.UTC(2026, 10, d || 10, Number(hm.slice(0, 2)), Number(hm.slice(3))));
    const eSrc = fs.readFileSync(path.join(__dirname, 'vm', 'exp-phone-auto.js'), 'utf8');
    ok('체험 틱 로컬 창 skip 없음', /const LOCAL_WINDOW = \{ hours: \[8, 21\], skip: null \}/.test(eSrc));
    ok('inWindow 09:30 = 열림(skip null) · 08~21 그대로', E.inWindow({ hours: [8, 21], skip: null }, k('09:30')) && E.inWindow({ hours: [8, 21], skip: null }, k('09:44')) && !E.inWindow({ hours: [8, 21], skip: null }, k('07:59')) && !E.inWindow({ hours: [8, 21], skip: null }, k('21:00')));
    ok('inWindow 서버 skip 이 [] 여도 열림', E.inWindow({ hours: [8, 21], skip: [] }, k('09:30')));
    const KS = path.join(HOMED, '.akkome', 'keyword-rank.json'), now = Date.now(), today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
    fs.writeFileSync(KS, JSON.stringify({ day: today, at: new Date(now - 50 * 60000).toISOString() }));
    ok('krBusy = 50분 전 시작(잠금 기다리는 중) → 아직 도는 중', E.krBusy(now) === true);
    fs.writeFileSync(KS, JSON.stringify({ day: today, at: new Date(now - 61 * 60000).toISOString() }));
    ok('krBusy = 61분 넘음 → 죽은 표식', E.krBusy(now) === false);
    fs.writeFileSync(KS, JSON.stringify({ day: today, at: new Date(now - 5 * 60000).toISOString(), result: '끝' }));
    ok('krBusy = 결과 있음 → 안 바쁨', E.krBusy(now) === false);
    const W = require('./vm/vm-watch.js');
    for (const [c, hm] of [['[VM] 순위 다시', '09:15'], ['[VM] 체험 예약 화면 봐줘', '09:30'], ['[VM] 포인트 지급 1,000 아이디 abc', '09:05']]) ok('vm-watch 쉼 없음 = ' + c.slice(5) + ' ' + hm, W.skipWhy(c, k(hm)) === '');
    ok('vm-watch keepMaybe 쉼 창 줄 없음', !/inSkip\(kstNow\(\), true\) \|\| busyWhy\(\)/.test(vmSrc) && /if \(busyWhy\(\)\) return null;/.test(vmSrc));

    console.log(`\n결과: ${pass}/${pass + fail}`);
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) { /* 무시 */ }
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
