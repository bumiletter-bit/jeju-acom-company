// #1293 검증 — 쿠팡 자동수집 실패 알림 = 연속 3번째부터 · 복구 알림은 실패 알림이 나간 때만 · 다른 키는 종전
//   server.js 의 「#1293 연속 실패 알림」 구간 + finishCollect 를 떼어 가짜 pool·notifyTelegram 으로 실행(실DB·텔레그램 0)
//   node scripts/verify-1293-collect-alert.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('// ── #1293 연속 실패 알림 시작'), b = src.indexOf('// ── #1293 연속 실패 알림 끝');
if (a < 0 || b < a) { console.error('구간 표식을 못 찾음'); process.exit(1); }
const f0 = src.indexOf('async function finishCollect(', b);
const f1 = src.indexOf('\nlet _naverTickBusy', f0);
if (f0 < 0 || f1 < f0) { console.error('finishCollect 를 못 찾음'); process.exit(1); }
const code = src.slice(a, b) + '\n' + src.slice(f0, f1) + '\n;this.finishCollect = finishCollect; this.collectAlertDecide = collectAlertDecide;';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

// 가짜 표: key → 줄 · noCol = fail_count 칸 없는 DB 흉내
function makeEnv(noCol) {
    const rows = new Map(), sent = [], queries = [];
    const pool = {
        async query(sql, p) {
            queries.push(sql);
            if (/^\s*UPDATE naver_auto_collect SET last_run_at/.test(sql)) {
                if (/fail_count/.test(sql) && noCol) throw new Error('column "fail_count" of relation "naver_auto_collect" does not exist');
                const r = rows.get(p[0]) || { key: p[0] };
                r.last_status = p[1]; r.last_error = p[2]; if (/fail_count/.test(sql)) r.fail_count = p[3];
                rows.set(p[0], r); return { rows: [], rowCount: 1 };
            }
            throw new Error('예상 밖 쿼리: ' + sql.slice(0, 60));
        },
    };
    const ctx = { pool, notifyTelegram: (t) => sent.push(t), NAVER_TIMER_LABELS: { coupang_guide: '쿠팡 발송안내(#401·LMS)', coupang_notify: '쿠팡 주문안내', order: '주문' }, console: { log() { } }, Number, Math, String };
    vm.createContext(ctx); vm.runInContext(code, ctx);
    // 틱처럼: 회차마다 그 순간 줄을 복사해 r 로 넘김
    const run = async (key, isFail, init) => {
        if (init && !rows.has(key)) rows.set(key, Object.assign({ key }, init));
        const r = Object.assign({ key }, rows.get(key) || {});
        await ctx.finishCollect(r, isFail ? { e: new Error('coupang_relay_error_504') } : { v: '쿠팡 0건' }, 0);
    };
    return { rows, sent, run, ctx, queries };
}

(async () => {
    console.log('① 쿠팡 실패 1·2회 → 0통 / 3회 → 1통 / 4·5회 → 그대로 / 성공 → 복구 1통');
    {
        const E = makeEnv(false), K = 'coupang_guide';
        await E.run(K, true, { last_status: 'ok', fail_count: 0 });
        ok(E.sent.length === 0 && E.rows.get(K).fail_count === 1 && E.rows.get(K).last_status === 'fail', '1회 실패 = 알림 0 · 횟수 1 · last_status fail 기록');
        ok(E.rows.get(K).last_error === 'coupang_relay_error_504', '1회 실패도 last_error 기록(화면 종전)');
        await E.run(K, true);
        ok(E.sent.length === 0 && E.rows.get(K).fail_count === 2, '2회 실패 = 알림 0 · 횟수 2');
        await E.run(K, true);
        ok(E.sent.length === 1 && /쿠팡 발송안내\(#401·LMS\)\] 자동수집 실패\(연속 3번째\) — coupang_relay_error_504/.test(E.sent[0]), '3회 실패 = 1통 「연속 3번째」');
        await E.run(K, true); await E.run(K, true);
        ok(E.sent.length === 1 && E.rows.get(K).fail_count === 5, '4·5회 실패 = 더 안 옴(종전처럼 한 번)');
        await E.run(K, false);
        ok(E.sent.length === 2 && /✅ \[쿠팡 발송안내\(#401·LMS\)\] 자동수집 복구/.test(E.sent[1]) && E.rows.get(K).fail_count === 0, '성공 = 복구 1통 · 횟수 0');
        await E.run(K, false);
        ok(E.sent.length === 2, '연속 성공 = 더 안 옴');
    }
    console.log('② 쿠팡 실패 2회 뒤 성공 → 실패·복구 0통 · 다음 실패 줄은 1부터');
    {
        const E = makeEnv(false), K = 'coupang_notify';
        await E.run(K, true, { last_status: 'ok', fail_count: 0 });
        await E.run(K, true);
        await E.run(K, false);
        ok(E.sent.length === 0 && E.rows.get(K).fail_count === 0, '실패 2 → 성공 = 0통');
        await E.run(K, true); await E.run(K, true);
        ok(E.sent.length === 0 && E.rows.get(K).fail_count === 2, '다시 실패 2 = 0통(횟수 새로 셈)');
        await E.run(K, true);
        ok(E.sent.length === 1, '다시 3번째 = 1통');
    }
    console.log('③ 네이버·카페24·쿠폰 키 = 종전(1번째 실패 1통 · 복구 1통 · 연속 실패 반복 0)');
    for (const K of ['order', 'cafe24_guide', 'coupon_expire_notify', 'lms_guide']) {
        const E = makeEnv(false);
        await E.run(K, true, { last_status: 'ok', fail_count: null });
        ok(E.sent.length === 1 && /자동수집 실패 — coupang_relay_error_504$/.test(E.sent[0]), K + ' 1회 실패 = 1통(「연속」 글 없음 = 종전 문구)');
        await E.run(K, true);
        ok(E.sent.length === 1, K + ' 2회 실패 = 더 안 옴');
        await E.run(K, false);
        ok(E.sent.length === 2 && /자동수집 복구/.test(E.sent[1]), K + ' 성공 = 복구 1통');
    }
    {
        const E = makeEnv(false);
        await E.run('order', true, { last_status: 'fail', fail_count: null });   // 배포 전부터 실패 중
        ok(E.sent.length === 0, '네이버 키 직전 실패(칸 NULL) 뒤 또 실패 = 0통(종전)');
    }
    console.log('④ 배포 직후(fail_count NULL) 쿠팡 키');
    {
        const E = makeEnv(false), K = 'coupang_guide';
        await E.run(K, true, { last_status: 'fail', fail_count: null });   // 종전 코드가 이미 실패 알림을 보낸 상태
        ok(E.sent.length === 0 && E.rows.get(K).fail_count === 4, '직전 실패 + NULL = 이미 알린 것으로 봄 → 0통');
        await E.run(K, false);
        ok(E.sent.length === 1 && /복구/.test(E.sent[0]), '그 뒤 성공 = 복구 1통(종전 실패 알림의 짝)');
    }
    {
        const E = makeEnv(false), K = 'coupang_guide';
        await E.run(K, false, { last_status: 'ok', fail_count: null });
        ok(E.sent.length === 0 && E.rows.get(K).fail_count === 0, '직전 정상 + NULL → 성공 = 0통 · 횟수 0');
        await E.run(K, true); await E.run(K, true);
        ok(E.sent.length === 0, '그 뒤 실패 2 = 0통');
        await E.run(K, true);
        ok(E.sent.length === 1, '3번째 = 1통');
    }
    console.log('⑤ fail_count 칸이 없는 DB = 기록은 종전 쿼리로(저장 막힘 0)');
    {
        const E = makeEnv(true), K = 'order';
        await E.run(K, true, { last_status: 'ok' });
        ok(E.rows.get(K).last_status === 'fail' && E.rows.get(K).last_error === 'coupang_relay_error_504' && E.sent.length === 1, '칸 없음 = 종전 UPDATE 로 기록 · 네이버 1통');
        ok(E.queries.filter(q => /UPDATE/.test(q)).length === 2, 'UPDATE 2번(새 → 실패 → 종전)');
    }
    {
        const E = makeEnv(true), K = 'coupang_guide';
        await E.run(K, true, { last_status: 'ok' });
        ok(E.sent.length === 1 && /자동수집 실패 — coupang_relay_error_504$/.test(E.sent[0]), '칸 없음 + 쿠팡 1번째 실패 = 종전 꼴 1통(「연속」 글 없음)');
        await E.run(K, true);
        ok(E.sent.length === 1, '칸 없음 + 쿠팡 2번째 실패 = 더 안 옴(종전)');
        await E.run(K, false);
        ok(E.sent.length === 2 && /복구/.test(E.sent[1]), '칸 없음 + 쿠팡 성공 = 복구 1통(종전)');
        await E.run(K, false);
        ok(E.sent.length === 2, '칸 없음 + 연속 성공 = 더 안 옴');
    }
    {
        const E = makeEnv(false), K = 'coupang_guide';
        E.rows.set(K, { key: K, last_status: 'ok', fail_count: 0 });
        const q0 = E.ctx.pool.query; let n = 0;
        E.ctx.pool.query = async (sql, p) => { n++; throw new Error('Connection terminated unexpectedly'); };
        let thrown = null;
        try { await E.ctx.finishCollect(Object.assign({}, E.rows.get(K)), { e: new Error('x') }, 0); } catch (e) { thrown = e; }
        E.ctx.pool.query = q0;
        ok(thrown && /Connection terminated/.test(thrown.message) && n === 1 && E.sent.length === 0, '칸과 무관한 DB 오류 = 폴백 없이 throw(쿼리 1번 · 알림 0)');
    }
    console.log('⑥ 늦게 끝남·판정표');
    {
        const E = makeEnv(false), K = 'coupang_guide';
        E.rows.set(K, { key: K, last_status: 'ok', fail_count: 0 });
        await E.ctx.finishCollect(Object.assign({}, E.rows.get(K)), { v: '끝' }, 7);
        ok(E.rows.get(K).last_error === '늦게 끝남(7분)' && E.rows.get(K).last_status === 'ok' && E.sent.length === 0, '늦게 끝난 정상 = 메모 · 알림 0(종전)');
        const d = E.ctx.collectAlertDecide;
        ok(d({ key: 'coupang_x', last_status: 'fail', fail_count: 2 }, 'fail').alert === 'fail', 'coupang_ 로 시작하는 새 키도 같은 규칙');
        ok(d({ key: 'coupon_expire_notify', last_status: 'ok', fail_count: 0 }, 'fail').alert === 'fail', 'coupon_ 은 쿠팡 아님 = 1번째 알림');
        ok(d({ key: 'coupang_guide', last_status: 'fail', fail_count: 'x' }, 'ok').alert === 'recover', '이상한 값 = NULL 처럼(직전 실패 → 복구 1통)');
    }
    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
