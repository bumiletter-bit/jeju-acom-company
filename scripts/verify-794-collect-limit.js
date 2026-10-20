// #794 검증 — 1분 틱 수집기 시간 상한 · 같은 키 겹침 0 · DB pool 오류 수신·상한 · 텔레그램 무응답 상한
//   server.js 의 실제 코드 구간을 떼어 가짜 pool·가짜 수집기로 돌린다(실DB·실발송·외부 호출 0 · server.js 를 띄우지 않음)
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };
const cut = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); if (i < 0 || j < 0) throw new Error('구간 못 찾음: ' + a.slice(0, 40)); return SRC.slice(i, j); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const keep = setInterval(() => { }, 1000);   // 상한 타이머가 unref 라 시험 중 Node 가 먼저 끝나지 않게
(async () => {
    // ── ① 스케줄러 ──
    console.log('① 1분 틱 스케줄러');
    const limitBlock = cut('// ── #794 수집기 시간 상한 시작', '// ── #794 수집기 시간 상한 끝');
    const tickBlock = cut('let _naverTickBusy = false;', 'setInterval(naverAutoCollectTick, 60 * 1000);');
    ok(/if \(_collectRunning\.has\(r\.key\)\) continue;/.test(tickBlock), '틱이 「뒤에서 도는 키」를 건너뜀');
    ok(!/summary = await fn\(\)/.test(tickBlock), '옛 「await fn()」(상한 없음) 제거');
    // 가짜 세상
    const rows = [];   // naver_auto_collect 가짜 행
    const mk = (key, interval) => rows.push({ key, enabled: true, interval_min: interval, run_at_time: null, last_run_at: null, last_status: 'ok' });
    ['kakao_notify', 'lms_guide', 'qna'].forEach(k => mk(k, 3));
    const updates = [], tg = [], calls = {};
    const pool = { query: async (sql, p) => {
        if (/SELECT \* FROM naver_auto_collect/.test(sql)) return { rows: rows.map(r => Object.assign({}, r)) };
        if (/UPDATE naver_auto_collect SET last_run_at=NOW\(\)/.test(sql)) { const r = rows.find(x => x.key === p[0]); r.last_run_at = new Date(); r.last_status = p[1]; updates.push({ key: p[0], status: p[1], err: p[2] }); return { rows: [] }; }
        throw new Error('예상 밖 쿼리 ' + sql.slice(0, 60));
    } };
    let hang = null;   // kakao_notify 가 멈추게
    const sent = new Map();   // 가짜 발송 — 같은 주문이 두 번 나가면 잡힘
    const fake = (key) => async () => {
        calls[key] = (calls[key] || 0) + 1;
        if (key === 'kakao_notify' && calls[key] === 1) { hang = new Promise(r => { fake.release = r; }); await hang; sent.set('A', (sent.get('A') || 0) + 1); return '늦게 끝남'; }
        if (key === 'kakao_notify') { sent.set('A', (sent.get('A') || 0) + 1); return '다시 돎'; }
        return key + ' ok';
    };
    const names = ['collectSettlement', 'collectOrderNew', 'collectClaim', 'collectInquiry', 'collectQna', 'collectKakaoNotify', 'collectLmsGuide', 'collectProductSnapshot', 'collectCafe24Sync', 'collectCafe24Notify', 'collectCafe24Guide', 'collectCoupangNotify', 'collectCoupangGuide', 'collectWelcomeNotify', 'collectCouponExpireNotify'];
    const keyOf = { collectKakaoNotify: 'kakao_notify', collectLmsGuide: 'lms_guide', collectQna: 'qna' };
    const fns = names.map(n => keyOf[n] ? fake(keyOf[n]) : (async () => { throw new Error('부르면 안 됨 ' + n); }));
    const logs = []; const con = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
    const make = new Function('pool', 'naverRelay', 'notifyTelegram', 'NAVER_TIMER_LABELS', 'EXPERIENCE', 'console', ...names,
        limitBlock.replace(/const COLLECT_LIMIT_MIN = \{[\s\S]*?\};/, 'const COLLECT_LIMIT_MIN = { default: 5, kakao_notify: 0.004, lms_guide: 0.004, qna: 0.004 };') + tickBlock +
        '\nreturn { tick: naverAutoCollectTick, running: _collectRunning, limitMs: collectLimitMs, real: COLLECT_LIMIT_MIN };');
    // 실제 상한 표도 따로 읽어 확인
    const realTbl = new Function(limitBlock + '\nreturn { COLLECT_LIMIT_MIN, collectLimitMs };')();
    ok(realTbl.collectLimitMs('kakao_notify') === 20 * 60000 && realTbl.collectLimitMs('experience_sms') === 5 * 60000 && realTbl.collectLimitMs('product_snapshot') === 20 * 60000, '실제 상한 표 = 발송 20분 · 체험 5분(기본) · 스냅샷 20분');
    const T = make(pool, { configured: () => true }, async (t) => { tg.push(t); return 'sent'; }, {}, {}, con, ...fns);
    ok(Math.round(T.limitMs('kakao_notify')) === 240, '시험 상한 = 0.24초(가짜)');
    // 틱 1: 셋 다 처음이라 due · 기다린 시간 같으면 첫 키(kakao_notify) — 멈춤
    const t1 = Date.now(); await T.tick(); const el = Date.now() - t1;
    ok(el < 2000, `멈춘 수집기가 있어도 틱이 상한(0.24초) 뒤 풀림 (${el}ms)`);
    const u1 = updates[updates.length - 1];
    ok(u1 && u1.key === 'kakao_notify' && u1.status === 'fail' && /시간 초과/.test(u1.err), '시간 초과 = last_status fail · 메모 「시간 초과」');
    ok(tg.some(t => /시간 초과/.test(t)), '정상→실패 전환 텔레그램 1회(종전 규칙)');
    ok(T.running.has('kakao_notify'), '뒤에서 도는 키 = 실행 중 표시');
    // 틱 2·3: 다른 키가 돈다 · kakao_notify 는 건너뜀(due 여도)
    rows.find(r => r.key === 'kakao_notify').last_run_at = new Date(Date.now() - 3600e3);   // 일부러 「오래 기다림」으로 만들어도
    await T.tick(); await T.tick();
    ok(calls.lms_guide === 1 && calls.qna === 1, '다른 키(lms_guide·qna)는 다음 틱에 정상 실행');
    ok(calls.kakao_notify === 1, '같은 키(kakao_notify)는 앞 것이 끝날 때까지 다시 안 돎(겹침 0)');
    ok(sent.get('A') === undefined, '멈춘 동안 같은 발송 0회');
    // 멈춘 것 풀림 → 늦게 끝남 로그 · 실행 중 해제 · 다음 틱에 다시 돎 · 발송 합계 = 회차마다 1
    fake.release(); await sleep(20);
    ok(!T.running.has('kakao_notify'), '늦게 끝나면 실행 중 표시 풀림');
    ok(logs.some(l => /kakao_notify: 시간 초과 뒤 늦게 끝남 — 정상/.test(l)), '서버 로그 「시간 초과 뒤 늦게 끝남」');
    rows.forEach(r => { if (r.key !== 'kakao_notify') r.last_run_at = new Date(); });
    rows.find(r => r.key === 'kakao_notify').last_run_at = new Date(Date.now() - 3600e3);
    await T.tick();
    ok(calls.kakao_notify === 2 && sent.get('A') === 2, '풀린 뒤 다음 틱에 다시 돎 · 회차마다 한 번씩(동시 2개 0)');
    ok(updates[updates.length - 1].status === 'ok', '다시 돈 회차 = ok');
    ok(tg.some(t => /복구/.test(t)), '실패→정상 복구 텔레그램(종전 규칙)');
    // 실패하는 수집기 = 종전처럼 fail + 메시지
    const T2 = new Function('pool', 'naverRelay', 'notifyTelegram', 'NAVER_TIMER_LABELS', 'EXPERIENCE', 'console', ...names, limitBlock + tickBlock + '\nreturn { tick: naverAutoCollectTick, running: _collectRunning };');
    rows.length = 0; updates.length = 0; mk('qna', 3);
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
    ok(updates[0].status === 'ok' && logs.some(l => /qna: ok — 요약 3건/.test(l)), '정상 수집기 = 종전 로그·기록 그대로');

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
