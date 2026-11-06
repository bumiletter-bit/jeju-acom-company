// #1043-b server.js memorySyncAlertTick 떼어 실행 검증 — 가짜 설정·가짜 query·가짜 텔레그램 · 실DB 0 · 외부 발송 0
//   node scripts/verify-1043b-alert.js
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('async function memorySyncAlertTick(d)');
const b = src.indexOf('\nif (process.env.RENDER) setInterval(() => { memorySyncAlertTick()', a);
if (a < 0 || b < 0) throw new Error('memorySyncAlertTick 못 찾음');
const memorySyncAlertTick = new Function('naverCfgGet', 'pool', 'notifyTelegram', src.slice(a, b) + '\nreturn memorySyncAlertTick;')(null, null, null);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('✓', m); } else { fail++; console.log('✗', m); } };
function fake(value, sendResult) {
    const st = { value, sent: [], queries: [] };
    st.d = {
        get: async k => (k === 'memory_sync_alert' ? st.value : null),
        query: async (s, p) => { st.queries.push({ s, p }); if (/^DELETE/.test(s)) st.value = null; else if (/^UPDATE/.test(s)) st.value = Object.assign({}, st.value, { fails: p[0] }); },
        send: async t => { st.sent.push(t); return sendResult; },
    };
    return st;
}
(async () => {
    // ① 키 있음 → 1통 + 삭제
    const s1 = fake({ at: '2026-11-06T10:00:00Z', host: 'notebook', count: 2, files: ['a.md', 'b.md'] }, 'sent');
    const r1 = await memorySyncAlertTick(s1.d);
    ok(r1 === 1 && s1.sent.length === 1 && s1.value === null, '① 키 있음 → 텔레그램 1통 + 키 삭제');
    ok(/확인필요 2개 — a\.md, b\.md/.test(s1.sent[0] || '') && /--force <파일>/.test(s1.sent[0] || ''), '① 글 = 개수·파일 이름·안내');
    // ② 키 없음 → 0
    const s2 = fake(null, 'sent');
    const r2 = await memorySyncAlertTick(s2.d);
    ok(r2 === 0 && s2.sent.length === 0 && s2.queries.length === 0, '② 키 없음 → 보내기 0 · 쿼리 0');
    // ③ 보내기 실패 → 키 유지(fails+1) · 4번째 실패에 삭제
    const s3 = fake({ count: 1, files: ['c.md'] }, 'failed');
    const r3 = await memorySyncAlertTick(s3.d);
    ok(r3 === 0 && s3.value && s3.value.fails === 1 && !s3.queries.some(q => /^DELETE/.test(q.s)), '③ 보내기 실패 → 키 유지(fails 1)');
    await memorySyncAlertTick(s3.d); await memorySyncAlertTick(s3.d);
    ok(s3.value && s3.value.fails === 3, '③ 3번 실패까지 유지');
    const r3b = await memorySyncAlertTick(s3.d);
    ok(r3b === -1 && s3.value === null, '③ 3번 넘게 실패 → 지움');
    console.log(`\n${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})();
