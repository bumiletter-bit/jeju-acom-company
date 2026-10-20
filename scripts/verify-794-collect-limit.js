// #794·#796 검증 — 1분 틱 수집기 「풀어 주는 시간」 · 실패 대신 오래 걸리는 중 · 60분 경고 · 같은 키·알리고 묶음 겹침 0 · DB pool 오류 수신·상한 · 텔레그램 무응답 상한
//   server.js 의 실제 코드 구간을 떼어 가짜 pool·가짜 수집기로 돌린다(실DB·실발송·외부 호출 0 · server.js 를 띄우지 않음)
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };
const cut = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); if (i < 0 || j < 0) throw new Error('구간 못 찾음: ' + a.slice(0, 40)); return SRC.slice(i, j); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const keep = setInterval(() => { }, 1000);   // 상한 타이머가 unref 라 시험 중 Node 가 먼저 끝나지 않게
(async () => {
    // ── ① 스케줄러(#794 → #796 「실패 대신 오래 걸리는 중」) ──
    console.log('① 1분 틱 스케줄러');
    const limitBlock = cut('// ── #794 수집기 시간 상한 시작', '// ── #794 수집기 시간 상한 끝');
    const tickBlock = cut('// 한 회차가 끝났을 때 기록', 'setInterval(naverAutoCollectTick, 60 * 1000);');
    ok(/if \(collectBlocked\(r\.key\)\) continue;/.test(tickBlock), '틱이 「뒤에서 도는 키·같은 알리고 묶음」을 건너뜀');
    ok(!/summary = await fn\(\)/.test(tickBlock) && !/시간 초과\(/.test(tickBlock), '옛 「await fn()」·「시간 초과 = fail」 없음');
    const realTbl = new Function(limitBlock + '\nreturn { COLLECT_LIMIT_MIN, COLLECT_WARN_MIN, COLLECT_GROUP, collectLimitMs };')();
    ok(['kakao_notify', 'lms_guide', 'product_snapshot', 'qna', 'experience_sms', 'cafe24_sync'].every(k => realTbl.collectLimitMs(k) === 5 * 60000) && realTbl.COLLECT_WARN_MIN === 60, '실제 값 = 모든 키 5분에 풀어 줌 · 60분 경고');
    ok(['kakao_notify', 'lms_guide', 'cafe24_notify', 'cafe24_guide', 'coupang_notify', 'coupang_guide', 'welcome_notify', 'coupon_expire_notify', 'experience_sms'].every(k => realTbl.COLLECT_GROUP[k] === 'aligo') && !realTbl.COLLECT_GROUP.qna && !realTbl.COLLECT_GROUP.product_snapshot, '알리고 묶음 9키 · 문의·스냅샷은 묶음 밖');
    const names = ['collectSettlement', 'collectOrderNew', 'collectClaim', 'collectInquiry', 'collectQna', 'collectKakaoNotify', 'collectLmsGuide', 'collectProductSnapshot', 'collectCafe24Sync', 'collectCafe24Notify', 'collectCafe24Guide', 'collectCoupangNotify', 'collectCoupangGuide', 'collectWelcomeNotify', 'collectCouponExpireNotify'];
    const keyOf = { collectKakaoNotify: 'kakao_notify', collectLmsGuide: 'lms_guide', collectQna: 'qna', collectProductSnapshot: 'product_snapshot' };
    const logs = []; const con = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
    // 가짜 세상 하나 만들기 — rows·updates·tg·calls 와 「멈출 키」 조절
    function world(keys, prior) {
        const W = { rows: [], updates: [], memos: [], tg: [], calls: {}, sent: new Map(), hold: {} };
        keys.forEach(k => W.rows.push({ key: k, enabled: true, interval_min: 3, run_at_time: null, last_run_at: null, last_status: (prior && prior[k]) || 'ok' }));
        const pool = { query: async (sql, p) => {
            if (/SELECT \* FROM naver_auto_collect/.test(sql)) return { rows: W.rows.map(r => Object.assign({}, r)) };
            if (/UPDATE naver_auto_collect SET last_run_at=NOW\(\)/.test(sql)) { if (W.updDelay) await sleep(W.updDelay); const r = W.rows.find(x => x.key === p[0]); r.last_run_at = new Date(); r.last_status = p[1]; W.updates.push({ key: p[0], status: p[1], err: p[2] }); return { rows: [] }; }
            if (/UPDATE naver_auto_collect SET last_error=\$2, updated_at=NOW\(\) WHERE key=\$1/.test(sql)) { W.memos.push({ key: p[0], err: p[1] }); return { rows: [] }; }
            throw new Error('예상 밖 쿼리 ' + sql.slice(0, 60));
        } };
        const fake = (key) => async () => {
            W.calls[key] = (W.calls[key] || 0) + 1;
            const h = W.hold[key];
            if (h && W.calls[key] === 1) { const r = await new Promise(res => { h.release = res; }); if (r === 'throw') throw new Error('늦은 실패'); }
            if (key === 'kakao_notify' || key === 'lms_guide') W.sent.set(key, (W.sent.get(key) || 0) + 1);
            return key + ' 끝';
        };
        const fns = names.map(n => keyOf[n] ? fake(keyOf[n]) : (async () => { throw new Error('부르면 안 됨 ' + n); }));
        const make = new Function('pool', 'naverRelay', 'notifyTelegram', 'NAVER_TIMER_LABELS', 'EXPERIENCE', 'console', ...names,
            limitBlock.replace(/const COLLECT_LIMIT_MIN = \{[\s\S]*?\};/, 'const COLLECT_LIMIT_MIN = { default: 0.004 };').replace(/const COLLECT_WARN_MIN = \d+;/, 'const COLLECT_WARN_MIN = 0.006;') + tickBlock +
            '\nreturn { tick: naverAutoCollectTick, running: _collectRunning };');
        Object.assign(W, make(pool, { configured: () => true }, async (t) => { W.tg.push(t); return 'sent'; }, {}, {}, con, ...fns));
        W.due = (k) => { W.rows.forEach(r => { r.last_run_at = new Date(); }); W.rows.find(r => r.key === k).last_run_at = new Date(Date.now() - 3600e3); };
        return W;
    }
    // A. 알리고 키(kakao_notify)가 오래 걸림 → 0.24초에 풀림 · 실패 아님 · 알림 0 · 같은 묶음(lms_guide) 기다림 · 묶음 밖(qna) 돎 · 60분(가짜 0.36초) 경고 1번 · 정상 끝 = ok + 늦게 끝남 · 복구 알림 0
    const A = world(['kakao_notify', 'lms_guide', 'qna']); A.hold.kakao_notify = {};
    A.due('kakao_notify'); const t1 = Date.now(); await A.tick(); const el = Date.now() - t1;
    ok(el < 2000, `오래 걸리는 수집이 있어도 풀어 주는 시간(0.24초) 뒤 틱이 풀림 (${el}ms)`);
    ok(A.updates.length === 0 && A.memos.length === 1 && /오래 걸리는 중\(\d+분째/.test(A.memos[0].err), '넘은 순간 = last_status 안 바꿈 · 메모 「오래 걸리는 중(n분째)」만');
    ok(A.rows.find(r => r.key === 'kakao_notify').last_status === 'ok' && A.tg.length === 0, '실패 표시 0 · 텔레그램 0');
    ok(A.running.has('kakao_notify'), '뒤에서 도는 키 = 실행 중 표시');
    A.due('lms_guide'); await A.tick();
    ok(!A.calls.lms_guide, '같은 알리고 묶음(lms_guide)은 앞 것이 끝날 때까지 기다림(발송 동시 0)');
    A.due('qna'); await A.tick();
    ok(A.calls.qna === 1, '묶음 밖 키(qna)는 다음 틱에 정상 실행');
    A.due('kakao_notify'); await A.tick();
    ok(A.calls.kakao_notify === 1 && !A.sent.get('kakao_notify'), '같은 키 재실행 0 · 멈춘 동안 발송 0');
    await sleep(450);
    ok(A.tg.length === 1 && /분째 안 끝남 — 확인 필요/.test(A.tg[0]), '경고 시간(가짜 0.36초) 넘으면 텔레그램 경고 1번');
    await sleep(400);
    ok(A.tg.length === 1, '경고는 그 회차에 한 번만');
    A.hold.kakao_notify.release('ok'); await sleep(30);
    const ua = A.updates.find(u => u.key === 'kakao_notify');
    ok(ua && ua.status === 'ok' && /^늦게 끝남\(\d+분\)$/.test(ua.err), '정상으로 끝남 = ok + 「늦게 끝남(n분)」');
    ok(A.tg.length === 1 && !A.running.has('kakao_notify'), '직전이 정상 = 복구 알림 0 · 실행 중 표시 풀림');
    A.due('lms_guide'); await A.tick();
    ok(A.calls.lms_guide === 1 && A.sent.get('lms_guide') === 1, '풀린 뒤 같은 묶음(lms_guide) 실행');
    A.due('kakao_notify'); await A.tick();
    ok(A.calls.kakao_notify === 2 && A.sent.get('kakao_notify') === 2, '다음 회차 kakao_notify 다시 돎 · 회차마다 한 번씩(동시 2개 0)');
    ok(/알리고 발송 묶음\(주문안내·발송안내 등\)도 같이 기다리는 중/.test(A.tg[0]), '알리고 묶음 키 경고 = 「알리고 발송 묶음도 같이 기다리는 중」 한 줄');
    // E. #796-a 경합: 늦게 끝난 회차의 기록(UPDATE last_run_at)이 느린 사이에 틱이 돌아도 같은 키를 곧바로 한 번 더 돌리지 않음
    const E = world(['kakao_notify', 'qna']); E.hold.kakao_notify = {};
    E.due('kakao_notify'); await E.tick();
    E.updDelay = 300; E.hold.kakao_notify.release('ok'); await sleep(30);   // 끝났지만 기록은 아직(0.3초 걸림)
    E.rows.find(r => r.key === 'kakao_notify').last_run_at = new Date(Date.now() - 3600e3);   // 옛 last_run_at(오래 기다림)처럼 보이게
    E.rows.find(r => r.key === 'qna').last_run_at = new Date();
    ok(E.running.has('kakao_notify'), '기록 전에는 실행 중 표시 유지');
    await E.tick();
    ok(E.calls.kakao_notify === 1, '기록 전 틱 = 같은 키 다시 안 돎(곧바로 두 번 0)');
    await sleep(400);
    ok(!E.running.has('kakao_notify') && E.updates.some(u => u.key === 'kakao_notify' && u.status === 'ok'), '기록 뒤 실행 중 표시 풀림');
    E.updDelay = 0;
    // B. 오래 걸리다 실패로 끝남 = 종전 실패 길(fail + 정상→실패 알림 1번)
    const B = world(['product_snapshot']); B.hold.product_snapshot = {};
    B.rows[0].last_run_at = null; await B.tick();   // 하루 1회 키 = 오늘 아직 안 돈 것으로
    ok(B.updates.length === 0 && B.tg.length === 0, '스냅샷 오래 걸림 = 실패 표시·알림 0');
    await sleep(450);
    ok(B.tg.length === 1 && /분째 안 끝남/.test(B.tg[0]) && !/알리고/.test(B.tg[0]), '묶음 밖 키(스냅샷) 경고엔 알리고 줄 없음');
    B.tg.length = 0;
    B.hold.product_snapshot.release('throw'); await sleep(30);
    ok(B.updates[0] && B.updates[0].status === 'fail' && B.updates[0].err === '늦은 실패' && B.tg.length === 1 && /자동수집 실패 — 늦은 실패/.test(B.tg[0]), '늦게 실패 = fail + 실패 알림 1번(종전 꼴)');
    // C. 직전이 실패였는데 늦게 정상 = 복구 알림(종전 규칙)
    const C = world(['qna'], { qna: 'fail' }); C.hold.qna = {};
    C.due('qna'); await C.tick();
    C.hold.qna.release('ok'); await sleep(30);
    ok(C.updates[0] && C.updates[0].status === 'ok' && C.tg.length === 1 && /복구/.test(C.tg[0]), '직전 실패 → 늦게 정상 = 복구 알림 1번');
    // D. 보통 실패·동기 실패·정상 = 종전과 같음
    const T2 = new Function('pool', 'naverRelay', 'notifyTelegram', 'NAVER_TIMER_LABELS', 'EXPERIENCE', 'console', ...names, limitBlock + tickBlock + '\nreturn { tick: naverAutoCollectTick, running: _collectRunning };');
    const rows = [{ key: 'qna', enabled: true, interval_min: 3, run_at_time: null, last_run_at: null, last_status: 'ok' }], updates = [];
    const pool = { query: async (sql, p) => {
        if (/SELECT \* FROM naver_auto_collect/.test(sql)) return { rows: rows.map(r => Object.assign({}, r)) };
        if (/UPDATE naver_auto_collect SET last_run_at=NOW\(\)/.test(sql)) { rows[0].last_run_at = new Date(); rows[0].last_status = p[1]; updates.push({ key: p[0], status: p[1], err: p[2] }); return { rows: [] }; }
        throw new Error('예상 밖 쿼리 ' + sql.slice(0, 60));
    } };
    const fns2 = names.map(n => n === 'collectQna' ? (async () => { throw new Error('네이버 500'); }) : (async () => 'x'));
    const W2 = T2(pool, { configured: () => true }, async () => 'sent', {}, {}, con, ...fns2);
    await W2.tick();
    ok(updates[0] && updates[0].status === 'fail' && updates[0].err === '네이버 500' && !W2.running.has('qna'), '보통 실패 = 종전과 같은 기록 · 실행 중 표시 남지 않음');
    const fns3 = names.map(n => n === 'collectQna' ? (() => { throw new Error('동기 오류'); }) : (async () => 'x'));
    rows[0].last_run_at = null; updates.length = 0;
    const W3 = T2(pool, { configured: () => true }, async () => 'sent', {}, {}, con, ...fns3);
    await W3.tick();
    ok(updates[0] && updates[0].err === '동기 오류', '동기로 던지는 수집기도 실패로 기록(틱 안 죽음)');
    const fns4 = names.map(n => n === 'collectQna' ? (async () => '요약 3건') : (async () => 'x'));
    rows[0].last_run_at = null; updates.length = 0; logs.length = 0;
    const W4 = T2(pool, { configured: () => true }, async () => 'sent', {}, {}, con, ...fns4);
    await W4.tick();
    ok(updates[0].status === 'ok' && updates[0].err === null && logs.some(l => /qna: ok — 요약 3건/.test(l)), '정상 수집기 = 종전 로그·기록 그대로(메모 칸 비움)');

    // ── ② DB pool ──
    console.log('② DB pool');
    const dbBlock = cut('const dbConfig = {', 'app.disable(');
    ok(/connectionTimeoutMillis: 15000/.test(dbBlock) && /statement_timeout: 60000/.test(dbBlock), 'connectionTimeoutMillis 15초 · statement_timeout 60초');
    ok(/pool\.on\('error'/.test(dbBlock), "pool.on('error') 있음");
    const { Pool } = require('pg');
    const p = new Function('Pool', 'process', 'console', dbBlock.replace(/connectionString: process\.env\.DATABASE_URL/, "connectionString: 'postgres://x:y@127.0.0.1:1/z'") + '\nreturn { pool, dbConfig };')(Pool, { env: {} }, con);
    let alive = true; try { p.pool.emit('error', new Error('Connection terminated unexpectedly')); } catch (e) { alive = false; }
    ok(alive && logs.some(l => /쉬는 연결 오류/.test(l)), '쉬는 연결 오류 이벤트 = 로그만 · 프로세스 계속');
    ok(p.pool.options.statement_timeout === 60000 && p.pool.options.connectionTimeoutMillis === 15000, 'pg Pool 이 두 값을 받음(pg 8.19 = 연결 시작 매개변수로 statement_timeout 전송)');
    const pgClient = fs.readFileSync(require.resolve('pg/lib/client.js'), 'utf8');
    ok(/params\.statement_timeout/.test(pgClient), 'pg client 가 statement_timeout 을 서버로 보냄(코드 확인)');
    await p.pool.end().catch(() => { });

    // ── ③ 텔레그램 ──
    console.log('③ 텔레그램');
    const tgBlock = cut('let _tgChatId = null;', 'async function telegramChatId() {') + cut('async function notifyTelegram(text) {', '\n}\n') + '\n}\n';
    ok((SRC.match(/signal: AbortSignal\.timeout\(TG_TIMEOUT_MS\)/g) || []).length === 3, 'sendMessage + getUpdates 2곳 = 10초 상한');
    let fetchCalls = 0;
    const hangFetch = (url, opt) => { fetchCalls++; return new Promise((_, rej) => { if (opt && opt.signal) opt.signal.addEventListener('abort', () => rej(opt.signal.reason || new Error('abort'))); }); };
    const audits = [];
    const N = new Function('fetch', 'process', 'telegramChatId', 'tgMask', 'writeAudit', 'AbortSignal', 'setTimeout',
        tgBlock.replace('const TG_TIMEOUT_MS = 10000;', 'const TG_TIMEOUT_MS = 200;') + '\nreturn notifyTelegram;')(
        hangFetch, { env: { TELEGRAM_BOT_TOKEN: 't' } }, async () => '1', s => s, async (a) => { audits.push(a); }, AbortSignal, (f, ms) => setTimeout(f, ms === 5000 ? 50 : ms));
    const t0 = Date.now(); const r = await N('시험'); const tt = Date.now() - t0;
    ok(r === 'failed' && fetchCalls === 2, `무응답 = 던지지 않고 'failed' · 재시도 1회 (${tt}ms)`);
    ok(tt < 1500, '상한에서 풀림(실서버 = 10초 + 5초 쉼 + 10초 = 최대 약 25초)');
    ok(audits.length === 1 && audits[0].action === 'telegram_fail', '실패는 audit telegram_fail 한 줄(종전 그대로)');
    const sendTickSrc = fs.readFileSync(path.join(__dirname, '..', 'sms', 'index.js'), 'utf8');
    ok(/if \(notifyTelegram\) await notifyTelegram\(/.test(sendTickSrc), '문자 sendTick 의 await notifyTelegram 그대로(이제 최대 약 25초에 풀림)');

    console.log(`\n결과 ${pass}/${pass + fail}`);
    clearInterval(keep); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
