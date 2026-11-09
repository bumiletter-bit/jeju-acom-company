// #975 검증 — 창구 힉스필드 로그인 풀림 알림(판별 · 신호·할 일 · 서버 틱 알림 왕복 · 정상 0 · 중복 0 · 복구)
//   가짜 pool(메모리) — 실DB 쓰기 0 · higgsfield 실행 0 · server.js 틱은 소스에서 떼어 가짜 자료로 실행
//   node scripts/verify-975-hf.js
'use strict';
process.env.DESK_LOG = require('path').join(require('os').tmpdir(), 'verify-975-launcher.log');
const fs = require('fs'), path = require('path');
const L = require('./desk/launcher.js');
const { pool: realPool } = require('./desk/_db.js');
const T = L._t975;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' → ' + JSON.stringify(a));
function fakePool() {
    const cfg = new Map(), audits = [];
    return { cfg, audits, query: async (s, v = []) => {
        if (/^SELECT value FROM agent_office_config WHERE key = \$1/.test(s)) return { rows: cfg.has(v[0]) ? [{ value: cfg.get(v[0]) }] : [] };
        if (/SELECT value FROM agent_office_config WHERE key = 'owner_todo'/.test(s)) return { rows: cfg.has('owner_todo') ? [{ value: cfg.get('owner_todo') }] : [] };
        if (/INSERT INTO agent_office_config\(key, value\) VALUES\('owner_todo'/.test(s)) { cfg.set('owner_todo', JSON.parse(v[0])); return { rows: [] }; }
        if (/INSERT INTO agent_office_config \(key, value\) VALUES \(\$1, \$2::jsonb\)/.test(s)) { cfg.set(v[0], JSON.parse(v[1])); return { rows: [] }; }
        if (/INSERT INTO audit_logs/.test(s)) { audits.push(v); return { rows: [] }; }
        if (/^UPDATE agent_office_config SET value = value \|\|/.test(s)) {
            const f = cfg.get('desk_higgsfield_login');
            if (!f || f.done === true || f.notified === true) return { rows: [], rowCount: 0 };
            f.notified = true; return { rows: [{ value: f }], rowCount: 1 };
        }
        throw new Error('가짜 pool 이 모르는 SQL: ' + s.slice(0, 80));
    } };
}
// server.js 에서 틱 함수만 떼어 실행(실코드)
function serverTick(p, notes, owner) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
    const a = src.indexOf('async function deskHiggsfieldLoginTick()'), b = src.indexOf('setInterval(() => { deskHiggsfieldLoginTick()');
    if (a < 0 || b < 0) throw new Error('서버 틱 표식 없음');
    return new Function('pool', 'deskOwnerAccount', 'createNotification', src.slice(a, b) + '\nreturn deskHiggsfieldLoginTick;')(   // #1071 대표 계정 찾기 하나로
        p, async () => owner, async (...x) => { notes.push(x); });
}
(async () => {
    const Y = '2026-11-02';
    console.log('① 판별');
    eq(T.hfClassify(0, 'bumi****@gmail.com — max plan, 1522.15 credits'), 'ok', '로그인 상태 실제 글');
    eq(T.hfClassify(1, 'Error: x\nHint: Run: hf auth login'), 'fail', '힌트 글 + 실패 코드');
    eq(T.hfClassify(0, 'Hint: Run: hf auth login'), 'fail', '힌트 글 + 코드 0');
    eq(T.hfClassify(1, 'request failed (no response received)'), 'maybe', 'request failed = 한 번 더');
    eq(T.hfClassify(null, ''), 'unknown', '시간 초과·명령 없음');
    eq(T.hfClassify(1, 'something else'), 'unknown', '모르는 실패');
    eq(T.hfClassify(0, ''), 'unknown', '코드 0 빈 글');
    ok(T.HF_ORDER_RE.test('힉스필드 로그인 필요') && T.HF_ORDER_RE.test('Hint: Run: hf auth login') && !T.HF_ORDER_RE.test('그림 다 만들었어요'), '지시 답 글 판별');
    console.log('② 신호·할 일·알림 왕복');
    const logs = [], P = fakePool(), notes = [], d = { pool: P, log: m => logs.push(m), now: () => Date.parse(Y + 'T01:00:00Z') };
    P.cfg.set('owner_todo', { items: [{ n: 26, text: '다른 할 일', at: '2026-10-20' }] });
    const tick = serverTick(P, notes, { id: 1, name: '대표' });
    eq(await tick(), 0, '신호 없으면 알림 0');
    eq(await T.hfNote('ok', d), { skipped: 'closed' }, '정상 + 신호 없음 = 쓰기 0');
    eq(P.cfg.has(T.HF_FLAG), false, '정상일 때 신호 없음');
    eq(P.audits.length, 0, '정상일 때 audit 0');
    const r1 = await T.hfNote('fail', d);
    ok(r1.flagged && r1.todo_n === 27, '풀림 → 할 일 27');
    const it = P.cfg.get('owner_todo').items.find(x => x.n === 27);
    ok(it && it.text === T.HF_TODO_TEXT && !it.done && it.text.length <= 140 && /hf auth login/.test(it.text) && !/어사이드/.test(it.text), '할 일 글(140자 안 · 실제 길)');
    eq(P.cfg.get('owner_todo').items.length, 2, '다른 할 일 그대로');
    eq(await T.hfNote('fail', d), { skipped: 'open' }, '풀린 동안 다시 봐도 쓰기 0');
    eq(P.cfg.get('owner_todo').items.length, 2, '할 일 중복 0');
    eq(await tick(), 1, '서버 틱 알림 1');
    eq(notes.length, 1, '알림 1통');
    eq([notes[0][0], notes[0][1]], [1, 'desk_login'], '대표에게 · 종류');
    ok(/hf auth login/.test(notes[0][3]) && !/어사이드/.test(notes[0][3]), '알림 글 = 실제 길');
    eq(await tick(), 0, '다음 틱 알림 0');
    eq(await tick(), 0, '그다음 틱 알림 0');
    eq(notes.length, 1, '중복 알림 0');
    eq(await T.hfNote('unknown', d), { skipped: 'unknown' }, '모름 = 그대로');
    ok(P.cfg.get(T.HF_FLAG).done === false, '모름에 내려가지 않음');
    console.log('③ 복구');
    eq(await T.hfNote('ok', d), { cleared: true }, '복구');
    ok(P.cfg.get('owner_todo').items.find(x => x.n === 27).done === true, '할 일 내림');
    ok(P.cfg.get('owner_todo').items.find(x => x.n === 26).done !== true, '다른 할 일 그대로 열림');
    ok(P.cfg.get(T.HF_FLAG).done === true, '신호 내림');
    eq(await tick(), 0, '복구 뒤 알림 0');
    eq(await T.hfNote('ok', d), { skipped: 'closed' }, '복구 뒤 정상 = 쓰기 0');
    console.log('④ 다시 풀림 = 새로 1번');
    const r2 = await T.hfNote('fail', d);
    ok(r2.flagged && r2.todo_n === 28, '새 할 일 28');
    eq(await tick(), 1, '다시 알림 1');
    eq(notes.length, 2, '합계 2통');
    console.log('⑤ 대표 계정 못 찾음 = 안 죽음');
    const P2 = fakePool(), n2 = []; P2.cfg.set(T.HF_FLAG, { done: false, notified: false });
    eq(await serverTick(P2, n2, null)(), 0, '대표 없음 0');
    eq(n2.length, 0, '알림 0');
    console.log(`결과: ${pass}/${pass + fail}`);
    await realPool.end().catch(() => {});
    process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
