// #1184 검증 — 에이전트 오피스 지시 권한(A1) + 진행 중 지시 가벼운 조회(B10 ?ids=)
//   server.js 의 지시 라우트(이어서 지시 · 목록 · 닫기 · 오류 닫기 · 1건 조회 · 첨부 내려받기)를 글자 그대로 떼어 가짜 app·메모리 pglite 로 실행
//   직원 토큰으로 남의 번호 = 403 · 본인 = 200 · 대표 = 200 · 작성자 번호 빈 옛 지시 = 대표만 · 「[이벤트그림]」 = 이벤트 화면이 같이 봄(무변) · 고치기 전/뒤 나란히
//   🔴 실DB·실서버·외부·AI 0 · 실행: PGLITE_DIR=<pglite 폴더> node scripts/verify-1184-desk.js
'use strict';
const L = require('./verify-1184-lib.js');
const { ok, end } = L.counter('#1184 지시 권한 검증');

const SCHEMA = `
CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, status VARCHAR(20) DEFAULT '대기', result JSONB, run_id INTEGER, created_at TIMESTAMP DEFAULT NOW(), processed_at TIMESTAMP, created_by TEXT, created_by_id INTEGER, is_deleted BOOLEAN DEFAULT false,
  image_data TEXT, image_mime VARCHAR(40), file_name TEXT, image_more JSONB, mine_hidden BOOLEAN DEFAULT false, hist_hidden BOOLEAN DEFAULT false, payload JSONB, reply_to INTEGER);
CREATE TABLE agent_runs (id SERIAL PRIMARY KEY, steps JSONB DEFAULT '[]'::jsonb, result JSONB, is_deleted BOOLEAN DEFAULT false, status TEXT);
CREATE TABLE report_files (id SERIAL PRIMARY KEY, filename VARCHAR(200) NOT NULL, run_id INTEGER, data BYTEA NOT NULL, size_bytes INTEGER, created_at TIMESTAMP DEFAULT NOW(), is_deleted BOOLEAN DEFAULT false, purged_at TIMESTAMP);
INSERT INTO agent_runs (id, steps, result) VALUES (10, '[{"t":"a"},{"t":"b"}]', null), (11, '[]', '{"file_id": 4}'), (12, '[{"t":"x"}]', null);
-- 2 = 직원가 · 4 = 직원나 · 1 = 대표
INSERT INTO pending_orders (id, content, status, result, run_id, created_by, created_by_id) VALUES
 (101, '가의 지시', '질문', '{"type":"question","question":"?"}', 10, '직원가', 2),
 (102, '나의 지시', '질문', '{"type":"question","question":"?"}', null, '직원나', 4),
 (103, '가의 오류', '오류', '{"error":"x"}', null, '직원가', 2),
 (104, '나의 오류', '오류', '{"error":"x"}', null, '직원나', 4),
 (105, '옛 지시(작성자 번호 없음)', '완료', '{"answer":"a"}', null, '옛사람', null),
 (106, '[이벤트그림] 회차 #1 · 자리 hero', '완료', '{"files":[{"label":"a.png","file_id":3}]}', null, '직원가', 2),
 (107, '나의 처리중', '처리중', '{"type":"live","text":"쓰는 중"}', 12, '직원나', 4),
 (108, '가의 처리중', '처리중', '{"type":"live","text":"가 쓰는 중"}', null, '직원가', 2),
 (109, '나의 끝난 지시', '완료', '{"answer":"done","files":[{"label":"b.xlsx","file_id":2}]}', null, '직원나', 4),
 (110, '대표의 일정 지시', '완료', '{"type":"schedule_list"}', 11, '대표', 1);
INSERT INTO report_files (id, filename, run_id, data) VALUES (1, 'run10.xlsx', 10, '\\x01'), (2, 'b.xlsx', null, '\\x02'), (3, 'a.png', null, '\\x03'), (4, '일정.xlsx', null, '\\x04'), (5, '주인없음.xlsx', null, '\\x05');
`;
const U = { ceo: { id: 1, name: '대표', role: 'admin', position: '대표' }, a: { id: 2, name: '직원가', role: 'user', position: '사원' }, b: { id: 4, name: '직원나', role: 'user', position: '사원' }, acc: { id: 5, name: '경리', role: 'admin', position: '과장' } };

async function world(which) {
    const src = L.srcOf('server.js', which);
    const W = await L.makeDb(SCHEMA);
    const app = L.fakeApp(), intake = [];
    const parts = [
        L.constLine(src, 'isOwnerUser'), L.constLine(src, 'deskOrderMine') || '', L.constLine(src, 'DESK_TEST_UID_MIN'), L.constLine(src, 'deskIsTestUid'), L.constLine(src, 'deskNoTestSql'),
        L.fn(src, 'ownerOnly'), L.fn(src, 'adminOnly'), L.fn(src, 'handleAdminErr'), L.fn(src, 'deskAttachOf'), L.constLine(src, 'DESK_ACTIVE_STATUS'),
        "const DESK_FILE_EXT = ['xlsx','xls','csv','pdf','txt'];",
        L.route(src, 'post', '/api/agent-office/orders/:id/reply'),
        L.route(src, 'get', '/api/agent-office/desk/orders'),
        L.route(src, 'post', '/api/agent-office/orders/:id/close'),
        L.route(src, 'post', '/api/agent-office/orders/:id/ack-error'),
        L.route(src, 'get', '/api/agent-office/orders/:id'),
        L.route(src, 'get', '/api/agent-office/files/:id/download'),
        'return null;'];
    L.load(['app', 'pool', 'authMiddleware', 'writeAudit', 'adminActor', 'deskIntake', 'aoEngineCache', 'DB_RET_DEFAULT', 'dbRetentionCfg', 'naverCfgGet', 'console'],
        [app, W.pool, (q, r, nx) => nx(), async () => { }, req => ({ id: req.user.id }), async o => { intake.push(o.id); }, 'desk', { report_days: 30 }, () => ({ report_days: 30 }), async () => null, { log() { }, error() { } }], parts.join('\n'));
    W.call = (m, url, user, body) => app.call(m, url, { user, body }).then(r => r, e => ({ code: 'THROW', body: { error: e.message } }));
    W.st = async id => (await W.q('SELECT status FROM pending_orders WHERE id = $1', [id]))[0].status;
    return W;
}

async function scenario(W) {
    const R = {};
    const c = async (k, m, url, user, body) => { const r = await W.call(m, url, user, body); R[k] = r.code; return r; };
    // 목록(무변이어야 함 · 앞 단계가 지시를 만들기 전에 봄)
    const lm = await W.call('GET', '/api/agent-office/desk/orders?mine=1', U.a);
    R['목록 · 직원가 내 지시'] = (lm.body.orders || []).map(o => o.id + ':' + o.status).join(',');
    const la = await W.call('GET', '/api/agent-office/desk/orders?history=1', U.ceo);
    R['목록 · 대표 이력'] = (la.body.orders || []).map(o => o.id).join(',');
    // 1건 조회
    await c('조회 · 직원가 → 남의(102)', 'GET', '/api/agent-office/orders/102', U.a);
    await c('조회 · 직원가 → 내(101)', 'GET', '/api/agent-office/orders/101', U.a);
    await c('조회 · 대표 → 남의(102)', 'GET', '/api/agent-office/orders/102', U.ceo);
    await c('조회 · 경리(관리자) → 남의(102)', 'GET', '/api/agent-office/orders/102', U.acc);
    await c('조회 · 직원 → 옛 지시(번호 없음 105)', 'GET', '/api/agent-office/orders/105', U.a);
    await c('조회 · 대표 → 옛 지시(105)', 'GET', '/api/agent-office/orders/105', U.ceo);
    await c('조회 · 직원나 → 남의 [이벤트그림](106)', 'GET', '/api/agent-office/orders/106', U.b);
    await c('조회 · 없는 번호', 'GET', '/api/agent-office/orders/999', U.a);
    const one = await W.call('GET', '/api/agent-office/orders/101', U.a);
    R['조회 응답 칸'] = Object.keys(one.body.order || {}).sort().join(',');
    // 닫기(질문 종결)
    await c('닫기 · 직원가 → 남의(102)', 'POST', '/api/agent-office/orders/102/close', U.a); R['닫기 뒤 102 상태'] = await W.st(102);
    await c('닫기 · 직원나 → 내(102)', 'POST', '/api/agent-office/orders/102/close', U.b); R['닫기 뒤 102 상태 (2)'] = await W.st(102);
    await c('닫기 · 대표 → 남의(101)', 'POST', '/api/agent-office/orders/101/close', U.ceo);
    // 오류 닫기
    await c('오류 닫기 · 직원가 → 남의(104)', 'POST', '/api/agent-office/orders/104/ack-error', U.a); R['오류 닫기 뒤 104'] = await W.st(104);
    await c('오류 닫기 · 직원가 → 내(103)', 'POST', '/api/agent-office/orders/103/ack-error', U.a);
    await c('오류 닫기 · 대표 → 남의(104)', 'POST', '/api/agent-office/orders/104/ack-error', U.ceo);
    // 이어서 지시
    await c('이어서 · 직원가 → 옛 지시(105)', 'POST', '/api/agent-office/orders/105/reply', U.a, { content: '이어서' });
    await c('이어서 · 직원가 → 남의(109)', 'POST', '/api/agent-office/orders/109/reply', U.a, { content: '이어서' });
    await c('이어서 · 직원나 → 내(109)', 'POST', '/api/agent-office/orders/109/reply', U.b, { content: '이어서' });
    await c('이어서 · 대표 → 옛 지시(105)', 'POST', '/api/agent-office/orders/105/reply', U.ceo, { content: '이어서' });
    // 첨부 내려받기
    await c('파일 · 직원가 → 내 실행 기록 파일(1)', 'GET', '/api/agent-office/files/1/download', U.a);
    await c('파일 · 직원나 → 남의 실행 기록 파일(1)', 'GET', '/api/agent-office/files/1/download', U.b);
    await c('파일 · 직원나 → 내 답 첨부(2)', 'GET', '/api/agent-office/files/2/download', U.b);
    await c('파일 · 직원가 → 남의 답 첨부(2)', 'GET', '/api/agent-office/files/2/download', U.a);
    await c('파일 · 직원나 → 남의 [이벤트그림] 후보(3)', 'GET', '/api/agent-office/files/3/download', U.b);
    await c('파일 · 직원가 → 대표 일정 파일(4)', 'GET', '/api/agent-office/files/4/download', U.a);
    await c('파일 · 대표 → 일정 파일(4)', 'GET', '/api/agent-office/files/4/download', U.ceo);
    await c('파일 · 대표 → 주인 없는 파일(5)', 'GET', '/api/agent-office/files/5/download', U.ceo);
    await c('파일 · 직원 → 주인 없는 파일(5)', 'GET', '/api/agent-office/files/5/download', U.a);
    await c('파일 · 없는 번호', 'GET', '/api/agent-office/files/77/download', U.a);
    const f2 = await W.call('GET', '/api/agent-office/files/2/download', U.b);
    R['파일 본문·머리'] = Buffer.from(f2.body || '').toString('hex') + ' ' + f2.headers['Content-Type'];
    // ?ids= 가벼운 조회(뒤에만 있음)
    const li = await W.call('GET', '/api/agent-office/desk/orders?ids=107,108,abc,107', U.b);
    R['ids · 직원나 107,108'] = li.body.light ? (li.body.orders || []).map(o => `${o.id}:${o.status}:${(o.steps || []).length}:${o.result && o.result.text || ''}`).join(',') : '(없는 길)';
    const lc = await W.call('GET', '/api/agent-office/desk/orders?ids=107,108,109', U.ceo);
    R['ids · 대표 107,108,109'] = lc.body.light ? (lc.body.orders || []).map(o => `${o.id}:${o.status}:${o.result ? 'r' : '-'}`).sort().join(',') : '(없는 길)';
    const le = await W.call('GET', '/api/agent-office/desk/orders?ids=', U.ceo);
    R['ids · 빈 값'] = le.body.light ? String((le.body.orders || []).length) : '(없는 길)';
    return R;
}

(async () => {
    const B = await scenario(await world('before'));
    const A = await scenario(await world('after'));
    console.log('\n항목 | 고치기 전 | 고친 뒤');
    for (const k of Object.keys(A)) console.log(`${k} | ${B[k]} | ${A[k]}`);
    console.log('');
    const expect = {
        '조회 · 직원가 → 남의(102)': 403, '조회 · 직원가 → 내(101)': 200, '조회 · 대표 → 남의(102)': 200, '조회 · 경리(관리자) → 남의(102)': 403,
        '조회 · 직원 → 옛 지시(번호 없음 105)': 403, '조회 · 대표 → 옛 지시(105)': 200, '조회 · 직원나 → 남의 [이벤트그림](106)': 200, '조회 · 없는 번호': 404,
        '닫기 · 직원가 → 남의(102)': 400, '닫기 뒤 102 상태': '질문', '닫기 · 직원나 → 내(102)': 200, '닫기 뒤 102 상태 (2)': '질문종결', '닫기 · 대표 → 남의(101)': 200,
        '오류 닫기 · 직원가 → 남의(104)': 400, '오류 닫기 뒤 104': '오류', '오류 닫기 · 직원가 → 내(103)': 200, '오류 닫기 · 대표 → 남의(104)': 200,
        '이어서 · 직원가 → 옛 지시(105)': 403, '이어서 · 직원가 → 남의(109)': 403, '이어서 · 직원나 → 내(109)': 200, '이어서 · 대표 → 옛 지시(105)': 200,
        '파일 · 직원가 → 내 실행 기록 파일(1)': 200, '파일 · 직원나 → 남의 실행 기록 파일(1)': 403, '파일 · 직원나 → 내 답 첨부(2)': 200, '파일 · 직원가 → 남의 답 첨부(2)': 403,
        '파일 · 직원나 → 남의 [이벤트그림] 후보(3)': 200, '파일 · 직원가 → 대표 일정 파일(4)': 403, '파일 · 대표 → 일정 파일(4)': 200, '파일 · 대표 → 주인 없는 파일(5)': 200, '파일 · 직원 → 주인 없는 파일(5)': 403, '파일 · 없는 번호': 404,
    };
    for (const [k, v] of Object.entries(expect)) ok(A[k] === v, `뒤: ${k} = ${v}`, `전 ${B[k]} · 뒤 ${A[k]}`);
    // 전에는 열려 있던 구멍(전 = 200 이던 것이 뒤 = 403/400 인지)
    ok(B['조회 · 직원가 → 남의(102)'] === 200 && B['닫기 · 직원가 → 남의(102)'] === 200 && B['오류 닫기 · 직원가 → 남의(104)'] === 200 && B['파일 · 직원가 → 남의 답 첨부(2)'] === 200 && B['이어서 · 직원가 → 옛 지시(105)'] === 200, '전 = 남의 지시 조회·닫기·오류 닫기·파일·옛 지시 이어쓰기가 열려 있었음(재현)');
    for (const k of ['조회 · 직원가 → 내(101)', '조회 · 대표 → 남의(102)', '조회 · 직원나 → 남의 [이벤트그림](106)', '이어서 · 직원나 → 내(109)', '파일 · 직원나 → 내 답 첨부(2)', '파일 본문·머리', '목록 · 직원가 내 지시', '목록 · 대표 이력', '조회 응답 칸'])
        ok(A[k] === B[k], '무변: ' + k, `전 ${B[k]} · 뒤 ${A[k]}`);
    ok(A['ids · 직원나 107,108'] === '107:처리중:1:쓰는 중', 'ids = 내 처리중 줄만(남의 108 은 안 옴) · 단계 1 · 쓰는 중 답', A['ids · 직원나 107,108']);
    ok(A['ids · 대표 107,108,109'] === '107:처리중:r,108:처리중:r,109:완료:-', 'ids = 대표는 전부 · 끝난 줄은 결과를 안 싣음', A['ids · 대표 107,108,109']);
    ok(A['ids · 빈 값'] === '0', 'ids 빈 값 = 0줄');
    end();
})().catch(e => { console.error('검증 실패:', e); process.exit(1); });
