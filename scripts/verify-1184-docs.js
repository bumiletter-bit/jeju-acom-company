// #1184 검증 — 기안서류 연차 전 갈래(A8 퇴사 결재자 · A9 종료<시작 · B3 연차 수정 기록 · B4 한 묶음·두 번 겹침)
//   server.js 의 「// === Documents API」 ~ 「// === Expense Reports API」 구간과 사용자 수정 라우트를 글자 그대로 떼어 가짜 app·메모리 pglite 로 실행
//   같은 시나리오를 고치기 전(git HEAD)·고친 뒤(작업 트리)로 돌려 표로 나란히 → 바뀐 칸이 의도한 것뿐인지 본다
//   🔴 실DB·실서버·외부·AI 0 · 실행: PGLITE_DIR=<pglite 폴더> node scripts/verify-1184-docs.js
'use strict';
const L = require('./verify-1184-lib.js');
const { ok, end } = L.counter('#1184 기안서류 검증');

const SCHEMA = `
CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL DEFAULT 'x', name VARCHAR(50) NOT NULL, position VARCHAR(50) DEFAULT '', color VARCHAR(20) DEFAULT '#3b82f6', role VARCHAR(20) DEFAULT 'user', annual_leave NUMERIC DEFAULT 15, created_at TIMESTAMP DEFAULT NOW(), deleted_at TIMESTAMP, idle_hours NUMERIC);
CREATE TABLE documents (id SERIAL PRIMARY KEY, type VARCHAR(20) NOT NULL, sub_type VARCHAR(50) NOT NULL, applicant_id INTEGER REFERENCES users(id) ON DELETE CASCADE, approver_id INTEGER REFERENCES users(id), start_date DATE NOT NULL, end_date DATE, reason TEXT DEFAULT '', status VARCHAR(20) DEFAULT 'pending', deducted_leave NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), processed_at TIMESTAMP,
  start_time VARCHAR(10), end_time VARCHAR(10), modification_type VARCHAR(20), modification_reason TEXT, new_start_date DATE, new_end_date DATE, new_start_time VARCHAR(10), new_end_time VARCHAR(10));
CREATE TABLE schedules (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, date DATE NOT NULL, title VARCHAR(200) NOT NULL, type VARCHAR(20) DEFAULT 'normal', created_at TIMESTAMP DEFAULT NOW(), document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE);
CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, action TEXT, target_type TEXT, target_id INTEGER, changes JSONB, source TEXT, actor_id INTEGER, actor_name TEXT, created_at TIMESTAMP DEFAULT NOW());
INSERT INTO users (id, username, name, position, role, annual_leave) VALUES (1, 'ceo', '대표', '대표', 'admin', 15), (2, 'a', '직원가', '사원', 'user', 15), (3, 'boo', '부장', '부장', 'user', 15), (4, 'b', '직원나', '사원', 'user', 15), (5, 'acc', '경리', '과장', 'admin', 15);
UPDATE users SET deleted_at = NOW() WHERE id = 3;
SELECT setval('users_id_seq', 10);
`;
const U = { ceo: { id: 1, name: '대표', role: 'admin', position: '대표' }, a: { id: 2, name: '직원가', role: 'user', position: '사원' }, b: { id: 4, name: '직원나', role: 'user', position: '사원' }, acc: { id: 5, name: '경리', role: 'admin', position: '과장' } };

async function world(which) {
    const src = L.srcOf('server.js', which), n = L.norm(src);
    const a = n.indexOf('// === Documents API (기안서류) ==='), b = n.indexOf('// === Expense Reports API (지출결의서) ===');
    if (a < 0 || b < 0) throw new Error('구간 표 없음');
    const region = n.slice(a, b);
    const W = await L.makeDb(SCHEMA);
    const app = L.fakeApp(), notes = [];
    const writeAudit = async ({ action, targetType, targetId = null, changes = null, source = 'admin_api', actor = null }) => {
        await W.pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [action, targetType, targetId, changes ? JSON.stringify(changes) : null, source, actor && actor.id || null, actor && actor.name || null]);
    };
    const body = [
        L.constLine(src, 'isOwnerUser'), L.fn(src, 'adminOnly'), L.fn(src, 'calcWorkHours'),
        region,
        L.route(src, 'put', '/api/users/:id'),
        'return null;',
    ].join('\n');
    L.load(['app', 'pool', 'authMiddleware', 'createNotification', 'writeAudit', 'adminActor', 'authUserCacheDrop', '_idleCache', 'bcrypt', 'console'],
        [app, W.pool, (q, r, nx) => nx(), async (...x) => { notes.push(x); }, writeAudit, req => ({ id: req.user.id, name: req.user.name }), () => { }, { at: 0 }, { hash: async s => 'h:' + s }, { log() { }, error() { } }], body);
    W.app = app; W.notes = notes;
    W.leave = async id => Number((await W.q('SELECT annual_leave FROM users WHERE id = $1', [id]))[0].annual_leave);
    W.doc = async id => (await W.q('SELECT id, status, deducted_leave, start_date, end_date FROM documents WHERE id = $1', [id]))[0] || null;
    W.sched = async id => Number((await W.q('SELECT count(*)::int AS n FROM schedules WHERE document_id = $1', [id]))[0].n);
    W.call = (m, url, user, body) => app.call(m, url, { user, body }).then(r => r, e => ({ code: 'THROW', body: { error: e.message } }));
    return W;
}

const ROWS = [];
async function scenario(W) {
    const R = {};   // 단계 이름 → 「코드 · 연차」
    const rec = async (k, res, uid = 2, extra = '') => { R[k] = `${res.code} · 연차 ${await W.leave(uid)}${extra}`; return res; };
    let r = await rec('① 연차 2일 제출', await W.call('POST', '/api/documents', U.a, { type: 'vacation', subType: '연차', approverId: 1, startDate: '2026-11-20', endDate: '2026-11-21', reason: 't' }));
    const d1 = r.body && r.body.id;
    await rec('② 대표 반려', await W.call('PUT', `/api/documents/${d1}/reject`, U.ceo));
    await rec('③ 반려 서류 고쳐 재제출', await W.call('PUT', `/api/documents/${d1}`, U.a, { startDate: '2026-11-20', endDate: '2026-11-21' }), 2, ' · ' + (await W.doc(d1)).status);
    await rec('④ 대표 승인', await W.call('PUT', `/api/documents/${d1}/approve`, U.ceo), 2, ' · ' + (await W.doc(d1)).status);
    await W.call('PUT', `/api/documents/${d1}/request-modification`, U.a, { modification_type: 'modify', modification_reason: '하루 더', new_start_date: '2026-11-20', new_end_date: '2026-11-22' });
    await rec('⑤ 수정(3일로) 승인', await W.call('PUT', `/api/documents/${d1}/approve-modification`, U.ceo), 2, ' · 일정 ' + await W.sched(d1));
    await W.call('PUT', `/api/documents/${d1}/request-modification`, U.a, { modification_type: 'cancel', modification_reason: '취소' });
    await rec('⑥ 취소 승인', await W.call('PUT', `/api/documents/${d1}/approve-modification`, U.ceo), 2, ' · ' + (await W.doc(d1)).status + ' · 일정 ' + await W.sched(d1));
    await rec('⑦ 취소 서류 삭제', await W.call('DELETE', `/api/documents/${d1}`, U.a));
    // A9 종료 < 시작
    r = await rec('⑧ 끝날 < 시작일 제출', await W.call('POST', '/api/documents', U.a, { type: 'vacation', subType: '연차', approverId: 1, startDate: '2026-11-25', endDate: '2026-11-23' }));   // 이틀 거꾸로 = 전 코드는 −1일 차감(연차가 늘어남)
    if (r.body && r.body.id) await rec('⑨ 그 서류 반려', await W.call('PUT', `/api/documents/${r.body.id}/reject`, U.ceo)); else R['⑨ 그 서류 반려'] = '(서류 없음) · 연차 ' + await W.leave(2);
    await rec('⑩ 시간차 끝 < 시작 제출', await W.call('POST', '/api/documents', U.a, { type: 'vacation', subType: '시간차', approverId: 1, startDate: '2026-11-26', startTime: '14:00', endTime: '10:00' }));
    // B4 겹침
    r = await W.call('POST', '/api/documents', U.a, { type: 'vacation', subType: '연차', approverId: 1, startDate: '2026-12-01', endDate: '2026-12-01' });
    let x = r.body.id; let rr = await Promise.all([W.call('PUT', `/api/documents/${x}/reject`, U.ceo), W.call('PUT', `/api/documents/${x}/reject`, U.ceo)]);
    R['⑪ 같은 서류 반려 두 번 겹침'] = rr.map(z => z.code).join('/') + ' · 연차 ' + await W.leave(2);
    r = await W.call('POST', '/api/documents', U.a, { type: 'vacation', subType: '연차', approverId: 1, startDate: '2026-12-02', endDate: '2026-12-02' });
    x = r.body.id; rr = await Promise.all([W.call('DELETE', `/api/documents/${x}`, U.a), W.call('DELETE', `/api/documents/${x}`, U.a)]);
    R['⑫ 같은 서류 삭제 두 번 겹침'] = rr.map(z => z.code).join('/') + ' · 연차 ' + await W.leave(2);
    r = await W.call('POST', '/api/documents', U.a, { type: 'vacation', subType: '연차', approverId: 1, startDate: '2026-12-03', endDate: '2026-12-03' });
    x = r.body.id; await W.call('PUT', `/api/documents/${x}/approve`, U.ceo); await W.call('PUT', `/api/documents/${x}/request-modification`, U.a, { modification_type: 'cancel', modification_reason: 'c' });
    rr = await Promise.all([W.call('PUT', `/api/documents/${x}/approve-modification`, U.ceo), W.call('PUT', `/api/documents/${x}/approve-modification`, U.ceo)]);
    R['⑬ 취소 승인 두 번 겹침'] = rr.map(z => z.code).join('/') + ' · 연차 ' + await W.leave(2);
    r = await W.call('POST', '/api/documents', U.a, { type: 'vacation', subType: '연차', approverId: 1, startDate: '2026-12-04', endDate: '2026-12-04' });
    x = r.body.id; rr = await Promise.all([W.call('PUT', `/api/documents/${x}/reject`, U.ceo), W.call('DELETE', `/api/documents/${x}`, U.a)]);
    R['⑭ 반려와 삭제 겹침'] = rr.map(z => z.code).join('/') + ' · 연차 ' + await W.leave(2);
    // 잔여 1 에서 1일 두 건 동시 제출
    await W.q('UPDATE users SET annual_leave = 1 WHERE id = 4');
    rr = await Promise.all([1, 2].map(i => W.call('POST', '/api/documents', U.b, { type: 'vacation', subType: '연차', approverId: 1, startDate: '2026-12-1' + i, endDate: '2026-12-1' + i })));
    R['⑮ 잔여 1 · 1일 두 건 동시 제출'] = rr.map(z => z.code).join('/') + ' · 연차 ' + await W.leave(4);
    // 잔여 부족 PUT = 그대로
    await W.q('UPDATE users SET annual_leave = 3 WHERE id = 4');
    r = await W.call('POST', '/api/documents', U.b, { type: 'vacation', subType: '연차', approverId: 1, startDate: '2026-12-20', endDate: '2026-12-21' });
    const y = r.body.id;
    r = await W.call('PUT', `/api/documents/${y}`, U.b, { startDate: '2026-12-20', endDate: '2026-12-27' });
    R['⑯ 잔여 부족 수정(2→8일)'] = `${r.code} · 연차 ${await W.leave(4)} · 서류 ${Number((await W.doc(y)).deducted_leave)}일 · 일정 ${await W.sched(y)} · 「${String(r.body.error || '').slice(0, 14)}」`;
    // A8 퇴사 결재자
    await W.q(`INSERT INTO documents (id, type, sub_type, applicant_id, approver_id, start_date, end_date, status, deducted_leave) VALUES (900, 'vacation', '시간차', 4, 3, '2026-11-10', '2026-11-10', 'pending', 0.5), (901, 'vacation', '연차', 4, 3, '2026-11-11', '2026-11-11', 'modification_pending', 1)`);
    await W.q(`UPDATE documents SET modification_type = 'cancel', modification_reason = 'x' WHERE id = 901`);
    const pend = await W.call('GET', '/api/documents?status=pending', U.ceo);
    R['⑰ 대표 결재 대기 목록에 퇴사 결재자 서류'] = (pend.body || []).filter(d => d.id === 900 || d.id === 901).map(d => d.id).join(',') || '없음';
    const pendB = await W.call('GET', '/api/documents?status=pending', U.b);
    R['⑱ 직원 결재 대기 목록'] = String((pendB.body || []).length) + '건';
    R['⑲ 직원이 퇴사 결재자 서류 승인'] = (await W.call('PUT', '/api/documents/900/approve', U.b)).code + ' · ' + (await W.doc(900)).status;
    R['⑳ 경리(관리자·대표 아님) 승인'] = (await W.call('PUT', '/api/documents/900/approve', U.acc)).code + ' · ' + (await W.doc(900)).status;
    R['㉑ 대표가 퇴사 결재자 서류 승인'] = (await W.call('PUT', '/api/documents/900/approve', U.ceo)).code + ' · ' + (await W.doc(900)).status;
    await W.q('UPDATE users SET annual_leave = 3 WHERE id = 4');
    R['㉒ 대표가 퇴사 결재자 취소요청 승인'] = (await W.call('PUT', '/api/documents/901/approve-modification', U.ceo)).code + ' · ' + (await W.doc(901)).status + ' · 연차 ' + await W.leave(4);
    // ② 서로가 서로의 결재자인 두 사람 동시 제출(직원가 → 결재 직원나 · 직원나 → 결재 직원가) — 둘 다 200 · 둘 다 차감
    await W.q('UPDATE users SET annual_leave = 10 WHERE id IN (2, 4)');
    rr = await Promise.all([W.call('POST', '/api/documents', U.a, { type: 'vacation', subType: '연차', approverId: 4, startDate: '2026-12-15', endDate: '2026-12-15' }), W.call('POST', '/api/documents', U.b, { type: 'vacation', subType: '연차', approverId: 2, startDate: '2026-12-16', endDate: '2026-12-16' })]);
    R['㉔ 서로 결재자 두 사람 동시 제출'] = rr.map(z => z.code).join('/') + ' · 연차 ' + await W.leave(2) + '/' + await W.leave(4);
    // B3 연차 직접 수정 기록
    await W.call('PUT', '/api/users/4', U.ceo, { annualLeave: 7.5 });
    await W.call('PUT', '/api/users/4', U.ceo, { name: '직원나' });
    const au = await W.q(`SELECT action, changes FROM audit_logs WHERE target_type = 'user' ORDER BY id`);
    R['㉓ 직원 수정 연차 9→7.5 기록'] = au.length ? au.map(z => `${z.action} ${z.changes.before && z.changes.before.annual_leave}→${z.changes.after && z.changes.after.annual_leave}`).join(' | ') : '기록 없음';
    return R;
}

(async () => {
    const B = await scenario(await world('before'));
    const A = await scenario(await world('after'));
    console.log('\n단계 | 고치기 전 | 고친 뒤');
    for (const k of Object.keys(A)) console.log(`${k} | ${B[k]} | ${A[k]}`);
    console.log('');
    // 그대로여야 하는 칸
    for (const k of ['① 연차 2일 제출', '② 대표 반려', '③ 반려 서류 고쳐 재제출', '④ 대표 승인', '⑤ 수정(3일로) 승인', '⑥ 취소 승인', '⑦ 취소 서류 삭제', '⑱ 직원 결재 대기 목록', '⑲ 직원이 퇴사 결재자 서류 승인', '⑳ 경리(관리자·대표 아님) 승인'])
        ok(A[k] === B[k], '무변: ' + k, `전 ${B[k]} / 뒤 ${A[k]}`);
    ok(/^200 · 연차 13$/.test(A['① 연차 2일 제출']) && /^200 · 연차 15$/.test(A['② 대표 반려']) && /연차 13 · pending/.test(A['③ 반려 서류 고쳐 재제출']) && /연차 12 · 일정 3/.test(A['⑤ 수정(3일로) 승인']) && /연차 15 · cancelled · 일정 0/.test(A['⑥ 취소 승인']) && /^200 · 연차 15$/.test(A['⑦ 취소 서류 삭제']), '제출→반려→재제출→승인→수정→취소→삭제 연차 13·15·13·13·12·15·15');
    ok(/^400 · 연차 15$/.test(A['⑧ 끝날 < 시작일 제출']) && /^200 · 연차 15$/.test(B['⑧ 끝날 < 시작일 제출']), 'A9 끝날 < 시작일(이틀 거꾸로) = 400(전 = 200 으로 받고 −1일로 저장 · 잔여는 그대로)', [B['⑧ 끝날 < 시작일 제출'], A['⑧ 끝날 < 시작일 제출']]);
    ok(/연차 15$/.test(A['⑨ 그 서류 반려']) && /^200 · 연차 14$/.test(B['⑨ 그 서류 반려']), 'A9 전 = 그 서류를 반려하면 −1 을 더해 연차 1일이 깎임(14) · 뒤 = 서류가 안 생겨 15', [B['⑨ 그 서류 반려'], A['⑨ 그 서류 반려']]);
    ok(/^400 · 연차 15$/.test(A['⑩ 시간차 끝 < 시작 제출']), 'A9 시간차 끝 < 시작 = 400', A['⑩ 시간차 끝 < 시작 제출']);
    ok(A['⑪ 같은 서류 반려 두 번 겹침'] === '200/400 · 연차 15' && /^200\/200 · 연차 15$/.test(B['⑪ 같은 서류 반려 두 번 겹침']), 'B4 반려 두 번 겹침 = 한 번만 복구(전 = 둘 다 200 · 14→13→15 로 두 번 복구)', [B['⑪ 같은 서류 반려 두 번 겹침'], A['⑪ 같은 서류 반려 두 번 겹침']]);
    ok(A['⑫ 같은 서류 삭제 두 번 겹침'] === '200/404 · 연차 15', 'B4 삭제 두 번 겹침 = 한 번만', [B['⑫ 같은 서류 삭제 두 번 겹침'], A['⑫ 같은 서류 삭제 두 번 겹침']]);
    ok(A['⑬ 취소 승인 두 번 겹침'] === '200/400 · 연차 15', 'B4 취소 승인 두 번 겹침 = 한 번만', [B['⑬ 취소 승인 두 번 겹침'], A['⑬ 취소 승인 두 번 겹침']]);
    ok(/^(200\/404|200\/400|400\/200|404\/200|200\/200) · 연차 15$/.test(A['⑭ 반려와 삭제 겹침']), 'B4 반려·삭제 겹침 = 연차는 한 번만(반려 뒤 삭제 = 200/200 이 정상 · 반려 서류 삭제는 복구 없음)', [B['⑭ 반려와 삭제 겹침'], A['⑭ 반려와 삭제 겹침']]);
    ok(/^(200\/400|400\/200) · 연차 0$/.test(A['⑮ 잔여 1 · 1일 두 건 동시 제출']), 'B4 잔여 1 에서 두 건 동시 = 하나만 통과(연차 음수 X)', [B['⑮ 잔여 1 · 1일 두 건 동시 제출'], A['⑮ 잔여 1 · 1일 두 건 동시 제출']]);
    ok(/^400 · 연차 1 · 서류 2일 · 일정 2/.test(A['⑯ 잔여 부족 수정(2→8일)']) && A['⑯ 잔여 부족 수정(2→8일)'].split('「')[0] === B['⑯ 잔여 부족 수정(2→8일)'].split('「')[0] && A['⑯ 잔여 부족 수정(2→8일)'] === B['⑯ 잔여 부족 수정(2→8일)'], '잔여 부족 수정 = 400 · 연차·서류·일정 그대로 · 안내 숫자도 종전과 같음', [B['⑯ 잔여 부족 수정(2→8일)'], A['⑯ 잔여 부족 수정(2→8일)']]);
    ok(A['⑰ 대표 결재 대기 목록에 퇴사 결재자 서류'] === '900,901' || A['⑰ 대표 결재 대기 목록에 퇴사 결재자 서류'] === '901,900', 'A8 대표 목록에 퇴사 결재자 서류 2건(전 = 없음)', [B['⑰ 대표 결재 대기 목록에 퇴사 결재자 서류'], A['⑰ 대표 결재 대기 목록에 퇴사 결재자 서류']]);
    ok(/^403 · pending/.test(A['⑲ 직원이 퇴사 결재자 서류 승인']) && /^403 · pending/.test(A['⑳ 경리(관리자·대표 아님) 승인']), 'A8 대표 아닌 사람은 그대로 403');
    ok(/^200 · approved/.test(A['㉑ 대표가 퇴사 결재자 서류 승인']) && /^403/.test(B['㉑ 대표가 퇴사 결재자 서류 승인']), 'A8 대표 승인 200(전 = 403)', [B['㉑ 대표가 퇴사 결재자 서류 승인'], A['㉑ 대표가 퇴사 결재자 서류 승인']]);
    ok(/^200 · cancelled · 연차 4$/.test(A['㉒ 대표가 퇴사 결재자 취소요청 승인']), 'A8 대표 취소요청 승인 = 연차 1일 복구', A['㉒ 대표가 퇴사 결재자 취소요청 승인']);
    ok(A['㉓ 직원 수정 연차 9→7.5 기록'] === 'annual_leave_edit 9→7.5' &&B['㉓ 직원 수정 연차 9→7.5 기록'] === '기록 없음', 'B3 연차 바꿀 때만 audit 1건(이름만 바꾼 수정은 기록 없음)', [B['㉓ 직원 수정 연차 9→7.5 기록'], A['㉓ 직원 수정 연차 9→7.5 기록']]);
    ok(A['㉔ 서로 결재자 두 사람 동시 제출'] === '200/200 · 연차 9/9', '② 서로 결재자 동시 제출 = 둘 다 200 · 각 1일 차감', A['㉔ 서로 결재자 두 사람 동시 제출']);
    // ② 사람 줄 잠금 = FOR NO KEY UPDATE(서류 INSERT 의 외래키 KEY SHARE 와 안 부딪힘 · FOR UPDATE 는 부딪혀 서로 결재자 동시 제출이 교착) — pglite 는 한 세션이라 잠금 충돌 자체는 못 보여 줌 → 글자로 확인
    { const src = L.norm(L.srcOf('server.js', 'after')); const nk = (src.match(/FROM users WHERE id = \$1 FOR NO KEY UPDATE/g) || []).length, fu = (src.match(/FROM users WHERE id = \$1 FOR UPDATE/g) || []).length;
      ok(nk === 2 && fu === 0, '② users 줄 잠금 = FOR NO KEY UPDATE 2곳(POST·PUT) · FOR UPDATE 0', { nk, fu }); }
    end();
})().catch(e => { console.error('검증 실패:', e); process.exit(1); });
