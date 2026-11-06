// #1041-b-A 검증 — scripts/vm/vm-watch.js(나스 VM 러너) · 실DB 0 · 어사이드 0 · claude 0(가짜 실행 파일) · 네트워크 0
//   pglite(가짜 DB) + 임시 홈 폴더(잠금·상태·로그·vm-out) + 가짜 claude(.js) + 가짜 keyword-rank(.js)
//   사용: node scripts/verify-1041-vm-watch.js   (pglite 경로 = env PGLITE_PATH · 없으면 아래 기본)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const PGL = process.env.PGLITE_PATH || 'C:/Users/전승범/AppData/Local/Temp/claude/C--Users-----OneDrive------------------/309bf877-27c9-49ba-a44a-611324a7f2aa/scratchpad/pgl/node_modules/@electric-sql/pglite';
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'v1041-'));
const HOMED = path.join(T, 'home'); fs.mkdirSync(path.join(HOMED, '.akkome'), { recursive: true });
process.env.USERPROFILE = HOMED; process.env.HOME = HOMED;   // require 전에(잠금·상태 경로가 이 홈으로)
const FAKE_CLAUDE = path.join(T, 'fake-claude.js'), FAKE_RANK = path.join(T, 'fake-rank.js'), MODE = path.join(T, 'mode.txt'), CALLS = path.join(T, 'calls.txt'), RANKED = path.join(T, 'ranked.txt');
fs.writeFileSync(FAKE_CLAUDE, `
const fs = require('fs'); let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(CALLS)}, 'x');
  const mode = fs.readFileSync(${JSON.stringify(MODE)}, 'utf8').trim();
  const args = process.argv.slice(2).join(' ');
  if (!/-p/.test(args) || !/--allowedTools mcp__aside__repl,mcp__aside__exec --/.test(args) || !/--disallowedTools Bash,\\S*Read,Grep,Glob/.test(args) || require('path').basename(require('path').dirname(process.cwd())) !== 'vm-out' || require('path').basename(process.cwd()) !== ((/지시 #(\\d+)/.exec(input) || [])[1]) || !process.cwd().startsWith(${JSON.stringify(HOMED)}) || !/--model claude-opus-5-5/.test(args)) { console.log(JSON.stringify({ is_error: true, result: 'bad args ' + args + ' cwd=' + process.cwd() })); process.exit(1); }
  const id = (/지시 #(\\d+)/.exec(input) || [])[1];
  const done = text => console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text }));
  if (mode === 'fail') { console.error('fake fail'); process.exit(1); }
  if (mode === 'hang') { setTimeout(() => {}, 600000); return; }
  if (mode === 'slow') { setTimeout(() => done('늦은 답 #' + id), 1500); return; }
  const out = (/(\\S+vm-out\\S*) 폴더/.exec(input) || [])[1];
  require('fs').writeFileSync(out + '/cap.png', 'PNGDATA');
  done('답 #' + id + ' · 본문=' + /\\[지시\\]\\n([^\\n]*)/.exec(input)[1] + '\\nATTACH: ' + out + '/cap.png\\nATTACH: ' + ${JSON.stringify(path.join(T, 'secret.txt'))});
});`);
fs.writeFileSync(path.join(T, 'secret.txt'), 'DATABASE_URL=xx');
fs.writeFileSync(FAKE_RANK, `require('fs').writeFileSync(${JSON.stringify(RANKED)}, process.argv.slice(2).join(' '));`);
process.env.VM_CLAUDE_BIN = FAKE_CLAUDE; process.env.VM_RANK_SCRIPT = FAKE_RANK; process.env.VM_ORDER_LIMIT_MS = '4000';
process.env.VM_TOUCH_MS = '300';   // 도는 동안 heartbeat 갱신을 시험에서 빨리
const W = require('./vm/vm-watch.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); } };
const calls = () => { try { return fs.readFileSync(CALLS, 'utf8').length; } catch (e) { return 0; } };
const mode = m => fs.writeFileSync(MODE, m);

function units() {
    console.log('\n[1] 순위 갈래 판정');
    for (const s of ['[VM] 순위 확인', '[VM] 키워드 순위 다시', '[VM] 순위 다시 해줘', '[VM]순위 다시', '[VM] 키워드 순위 확인해줘']) ok('순위 = ' + s, W.isRank(s));
    for (const s of ['[VM] 순위 확인하고 체험 예약도 봐 줘 그리고 스마트플레이스 예약자관리 화면도', '[VM] 체험 예약 확인', '[VM] 쇼핑 순위가 왜 떨어졌는지 화면 보고 알려줘 자세히 원인까지', '[VM]', '[VM] 키워드 순위 관리 화면 고쳐줘', '[VM] 키워드 순위가 왜 떨어졌어', '[VM] 키워드 순위표 엑셀로 뽑아줘']) ok('순위 아님 = ' + s, !W.isRank(s));
    console.log('\n[2] 첨부 거름(지시 폴더 안·형식·크기)');
    const d = path.join(W.OUT_DIR, '77'); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'a.png'), 'x'); fs.writeFileSync(path.join(d, 'b.exe'), 'x'); fs.writeFileSync(path.join(d, 'empty.csv'), '');
    const a = W.takeAttach(`답\nATTACH: ${path.join(d, 'a.png')}\nATTACH: "${path.join(d, 'b.exe')}"\nATTACH: ${path.join(T, 'secret.txt')}\nATTACH: ${path.join(d, '..', '78', 'x.png')}\nATTACH: ${path.join(d, 'empty.csv')}\n끝`, 77);
    ok('남는 첨부 = a.png 하나', a.files.length === 1 && a.files[0].endsWith('a.png'), a.files);
    ok('버린 첨부 4개(exe·폴더 밖 2·빈 파일)', a.dropped.length === 4, a.dropped);
    ok('답 글에서 ATTACH 줄 빠짐', a.answer === '답\n끝', a.answer);
    console.log('\n[3] 09:25~09:45 쉼');
    const k = hm => new Date(Date.UTC(2026, 10, 6, +hm.slice(0, 2), +hm.slice(3)));
    ok('claude 길 09:20 쉼', W.inSkip(k('09:20'), false)); ok('claude 길 09:19 안 쉼', !W.inSkip(k('09:19'), false)); ok('claude 길 09:45 안 쉼', !W.inSkip(k('09:45'), false));
    ok('순위 갈래 09:10 쉼', W.inSkip(k('09:10'), true)); ok('순위 갈래 09:09 안 쉼', !W.inSkip(k('09:09'), true)); ok('순위 갈래 09:44 쉼', W.inSkip(k('09:44'), true));
    ok('claude 도구 = 어사이드 둘만 · Read·Grep·Glob 막음', W.ALLOWED === 'mcp__aside__repl,mcp__aside__exec' && /Read,Grep,Glob/.test(W.DENIED));
    console.log('[3b] 잠금 wx');
    ok('잡기 1번째 = 성공', W.lockTake()); ok('잡기 2번째 = 실패(이미 있음)', !W.lockTake()); W.lockFree(); ok('풀면 파일 없음', !fs.existsSync(W.LOCK));
    fs.writeFileSync(W.LOCK, '999'); const old = new Date(Date.now() - 20 * 60000); fs.utimesSync(W.LOCK, old, old);
    ok('15분 넘은 낡은 잠금 = 지우고 잡음', W.lockTake() && fs.readFileSync(W.LOCK, 'utf8') === 'vm-watch:' + process.pid); W.lockFree();
    ok('프롬프트에 본문·쓰기 금지·ATTACH 안내', /\[지시\]\n하이/.test(W.promptFor({ id: 5, content: '[VM] 하이' })) && /누르지 않는다/.test(W.promptFor({ id: 5, content: '[VM] x' })) && /ATTACH:/.test(W.promptFor({ id: 5, content: '[VM] x' })));
}

async function dbtests() {
    console.log('\n[4] pglite 왕복');
    const { PGlite } = require(PGL);
    const pg = new PGlite();
    const conv = v => Buffer.isBuffer(v) ? new Uint8Array(v) : Array.isArray(v) ? '{' + v.join(',') + '}' : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
    const db = { query: async (sql, p = []) => { const r = await pg.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; } };
    await pg.exec(`
        CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT NOT NULL, status VARCHAR(20) DEFAULT '대기', created_at TIMESTAMP DEFAULT NOW(), is_deleted BOOLEAN DEFAULT false,
            result JSONB, run_id INTEGER, processed_at TIMESTAMP, created_by TEXT, image_data TEXT, created_by_id INTEGER);
        CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, action VARCHAR(50), target_type VARCHAR(50), target_id INTEGER, changes JSONB, source VARCHAR(20), actor_name VARCHAR(100), created_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE agents (id SERIAL PRIMARY KEY, role VARCHAR(10), is_deleted BOOLEAN DEFAULT false);
        INSERT INTO agents (role) VALUES ('chief');
        CREATE TABLE agent_runs (id SERIAL PRIMARY KEY, agent_id INTEGER, status VARCHAR(20) DEFAULT 'running', steps JSONB DEFAULT '[]', result JSONB, started_at TIMESTAMP DEFAULT NOW(), finished_at TIMESTAMP, is_test BOOLEAN DEFAULT false);
        CREATE TABLE report_files (id SERIAL PRIMARY KEY, filename VARCHAR(200), run_id INTEGER, data BYTEA, size_bytes INTEGER, is_deleted BOOLEAN DEFAULT false);
        CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INTEGER, type VARCHAR(50), title VARCHAR(200), message TEXT, link VARCHAR(100), pushed_at TIMESTAMP);
        CREATE TABLE users (id INTEGER PRIMARY KEY, role VARCHAR(20), deleted_at TIMESTAMP);
        INSERT INTO users (id, role) VALUES (5, 'admin'), (6, 'staff');
        CREATE TABLE agent_office_config (key VARCHAR(50) PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMP DEFAULT NOW());`);
    const add = async (content, by, who) => Number((await db.query(`INSERT INTO pending_orders (content, created_by, created_by_id) VALUES ($1, $3, $2) RETURNING id`, [content, by == null ? 990054 : by, who || '총괄'])).rows[0].id);
    const row = async id => (await db.query(`SELECT status, result, run_id FROM pending_orders WHERE id = $1`, [id])).rows[0];
    const s1 = await add('[VM] 직원이 직접 친 지시', 6, '직원');
    const a = await add('[VM] a 체험 예약 화면 봐줘', 5), b = await add('[VM] b'), c = await add('[검증469] [VM] c'), d = await add('창구 일반 지시 d', 5);

    mode('ok');
    ok('집는 것 = a(직원이 직접 친 앞 줄 s1 은 건너뜀)', await W.pick(db) === a);
    ok('직원 줄은 집기 UPDATE 도 막힘', await W.claim(db, s1) === null && (await row(s1)).status === '대기');
    const r1 = await W.pollOnce(db);
    const ra = await row(a);
    ok('a 처리 → 완료', r1.did && ra.status === '완료', r1);
    ok('답 끝줄 「나스 VM 어사이드 처리」 · 본문 전달', /답 #\d+ · 본문=a 체험 예약 화면 봐줘/.test(ra.result.answer) && /— 나스 VM 어사이드 처리$/.test(ra.result.answer), ra.result.answer);
    ok('첨부 안내 「10일 뒤 지워져요」', /첨부는 10일 뒤 여기서 지워져요/.test(ra.result.answer));
    ok('첨부 1개 올림(지시 폴더 밖 secret.txt 는 안 올림)', ra.result.files.length === 1 && ra.result.files[0].label === 'cap.png' && /올리지 못한 첨부: secret\.txt/.test(ra.result.answer), ra.result.files);
    ok('report_files 1행 · run_id 연결', Number((await db.query(`SELECT COUNT(*)::int n FROM report_files WHERE run_id = $1`, [ra.run_id])).rows[0].n) === 1);
    ok('agent_runs 끝남(done)', (await db.query(`SELECT status FROM agent_runs WHERE id = $1`, [ra.run_id])).rows[0].status === 'done');
    const au = (await db.query(`SELECT action, source FROM audit_logs WHERE target_id = $1 ORDER BY id`, [a])).rows.map(x => x.action + '/' + x.source).join(',');
    ok('audit = desk_claim/vm · desk_respond/vm', au === 'desk_claim/vm,desk_respond/vm', au);
    ok('요청자(5)에게 종 알림 1건', Number((await db.query(`SELECT COUNT(*)::int n FROM notifications WHERE user_id = 5`)).rows[0].n) === 1);
    const cfg = (await db.query(`SELECT key FROM agent_office_config ORDER BY key`)).rows.map(x => x.key);
    ok('vm_heartbeat 만 씀(desk_heartbeat 안 건드림)', cfg.includes('vm_heartbeat') && !cfg.includes('desk_heartbeat'), cfg);
    ok('claude 1번 불림', calls() === 1, calls());
    ok('잠금 파일 풀림', !fs.existsSync(W.LOCK));

    console.log('\n[5] 잠금·쉼 때 안 집음');
    fs.writeFileSync(W.LOCK, '12345');
    const r2 = await W.pollOnce(db);
    ok('체험 번호 잠금 있음 → 건너뜀', r2.skipped && (await row(b)).status === '대기', r2);
    ok('남의 잠금은 안 지움', fs.readFileSync(W.LOCK, 'utf8') === '12345');
    fs.unlinkSync(W.LOCK);
    const KR = path.join(HOMED, '.akkome', 'keyword-rank.json');
    fs.writeFileSync(KR, JSON.stringify({ day: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), at: new Date().toISOString() }));
    const r2b = await W.pollOnce(db);
    ok('키워드 순위 도는 중 → 건너뜀', r2b.skipped === '키워드 순위 도는 중' || (W.inSkip(new Date(Date.now() + 9 * 3600e3)) && r2b.skipped), r2b);
    fs.unlinkSync(KR);

    console.log('\n[6] 실패 길 = 대기 1회 → 오류');
    mode('fail');
    const before = calls();
    const r3 = await W.handle(db, b);
    ok('첫 실패 → 대기로 되돌림', r3.did && !r3.ok && (await row(b)).status === '대기', r3);
    const r4 = await W.handle(db, b);
    const rb = await row(b);
    ok('두 번째 실패 → 오류 + 사유', rb.status === '오류' && /claude 실패/.test(rb.result.error), rb);
    ok('claude 2번 불림', calls() - before === 2);
    ok('시험 계정(990054) 지시는 종 알림 0', Number((await db.query(`SELECT COUNT(*)::int n FROM notifications WHERE user_id = 990054`)).rows[0].n) === 0);
    ok('시도 횟수 파일 비워짐', !(String(b) in JSON.parse(fs.readFileSync(W.STATE, 'utf8'))));
    ok('[검증469]·창구·직원 지시는 끝까지 안 집음', await W.pick(db) === null && (await row(s1)).status === '대기' && (await row(c)).status === '대기' && (await row(d)).status === '대기');

    console.log('\n[7] 정해진 명령 갈래(순위 다시 → keyword-rank --apply · claude 0)');
    const e = await add('[VM] 순위 다시', 5);
    await db.query(`INSERT INTO agent_office_config (key, value) VALUES ('keyword_rank_last', $1)`, [{ date: '2026-11-06', at: new Date(Date.now() + 3000).toISOString(), rows: [{ keyword: '귤' }, { keyword: '감귤' }], errors: [{ keyword: '황금향' }] }]);
    const c0 = calls();
    const r5 = await W.handle(db, e);
    const re = await row(e);
    ok('순위 갈래로 처리 → 완료', r5.rank && re.status === '완료', r5);
    ok('요약 = 수집 2개 · 실패 1개 · 실패 키워드', /수집 2개 · 실패 1개/.test(re.result.answer) && /실패: 황금향/.test(re.result.answer), re.result.answer);
    ok('가짜 keyword-rank 에 --apply', fs.existsSync(RANKED) && fs.readFileSync(RANKED, 'utf8') === '--apply');
    ok('claude 안 불림', calls() === c0);
    ok('첨부 없으면 10일 안내 없음', !/10일 뒤/.test(re.result.answer));
    const e2 = await add('[VM] 키워드 순위 확인', 5);
    await db.query(`UPDATE agent_office_config SET value = $1 WHERE key = 'keyword_rank_last'`, [{ date: '2026-11-05', at: '2026-11-05T00:30:00Z', rows: [{ keyword: '귤' }] }]);
    await W.handle(db, e2);
    ok('결과를 안 남긴 순위(옛 기록) = 실패 → 대기 1회', (await row(e2)).status === '대기');
    await db.query(`UPDATE agent_office_config SET value = $1 WHERE key = 'keyword_rank_last'`, [{ date: '2026-11-06', at: new Date(Date.now() + 3000).toISOString(), rows: [], errors: [], blocked: { kind: 'security', keyword: '귤', skipped: 8 } }]);
    await W.handle(db, e2);
    const re2 = await row(e2);
    ok('보안 확인 막힘 = 완료 + 「막힘 = security」 안내', re2.status === '완료' && /막힘 = security/.test(re2.result.answer), re2.result.answer);

    console.log('\n[8] 도는 사이 대기로 되돌려진 줄 → 중복 실행 0');
    const s2 = await add('[VM] 창구가 승인 뒤 넘긴 줄', 6, '창구 → VM'); mode('ok');
    ok('직원 지시라도 「창구 → VM」 이면 집음', await W.pick(db) === s2); await db.query(`UPDATE pending_orders SET is_deleted = true WHERE id = $1`, [s2]);
    mode('slow');
    const f = await add('[VM] f 느린 일', 5);
    const c1 = calls();
    const p = W.handle(db, f);
    const hbNow = async () => ((await db.query(`SELECT value FROM agent_office_config WHERE key = 'vm_heartbeat'`)).rows[0] || {}).value || {};
    await new Promise(r => setTimeout(r, 700));
    const hb1 = await hbNow();
    await db.query(`UPDATE pending_orders SET status = '대기' WHERE id = $1`, [f]);   // 창구·서버 기동 복구가 되돌린 꼴
    await new Promise(r => setTimeout(r, 600));
    const hb2 = await hbNow();
    ok('도는 동안 vm_heartbeat 갱신(busy · order_id · pid)', hb1.state === 'busy' && hb2.state === 'busy' && Number(hb2.order_id) === f && Number(hb2.pid) === process.pid && hb2.at > hb1.at, { hb1, hb2 });
    const r6 = await p;
    ok('되돌려졌어도 결과 올림 → 완료', r6.ok && (await row(f)).status === '완료', r6);
    ok('다시 안 집음', await W.pick(db) === null);
    await db.query(`UPDATE pending_orders SET status = '대기' WHERE id = $1`, [f]);   // 끝난 뒤에 또 되돌림
    ok('끝난 줄이 또 되돌려져도 안 집음', await W.pick(db) === null);
    ok('그 줄은 완료로 되돌려 둠', (await row(f)).status === '완료');
    ok('claude 는 1번만', calls() - c1 === 1, calls() - c1);

    console.log('\n[9] 하루 2번 넘게 안 집음 · 10분 상한 · 기동 복구');
    const g = await add('[VM] g', 5);
    for (let i = 0; i < 2; i++) await db.query(`INSERT INTO audit_logs (action, target_type, target_id, source) VALUES ('desk_claim', 'pending_order', $1, 'vm')`, [g]);
    ok('오늘 2번 집은 줄은 안 집음', await W.pick(db) === null);
    await db.query(`UPDATE pending_orders SET is_deleted = true WHERE id = $1`, [g]);
    mode('hang');
    const h = await add('[VM] h 멈추는 일', 5);
    const t0 = Date.now();
    const r7 = await W.handle(db, h);
    ok('상한(시험 4초) 넘으면 끄고 대기 1회', !r7.ok && (await row(h)).status === '대기' && Date.now() - t0 < 12000, { r7, ms: Date.now() - t0 });
    await db.query(`UPDATE pending_orders SET status = '처리중' WHERE id = $1`, [h]);
    const k1 = await add('창구 지시 처리중'); await db.query(`UPDATE pending_orders SET status = '처리중' WHERE id = $1`, [k1]);
    const os2 = require('os'), hbSet = pid => db.query(`INSERT INTO agent_office_config (key, value) VALUES ('vm_heartbeat', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [{ at: new Date().toISOString(), state: 'busy', order_id: h, host: os2.hostname(), pid }]);
    await hbSet(process.ppid);
    ok('살아 있는 다른 러너가 돌리는 중(heartbeat 2분 안) = 안 되돌림', (await W.recoverOwn(db)).length === 0 && (await row(h)).status === '처리중');
    await hbSet(process.pid);
    // 처리중 5줄 = ①직원 [VM](창구 몫) ②h(총괄 990054) ③관리자(5) [VM] ④「창구 → VM」 [VM] ⑤창구 일반 → ②③④ 만 되돌림
    const st1 = await add('[VM] 직원 처리중', 6, '직원'), ad1 = await add('[VM] 관리자 처리중', 5), dk1 = await add('[VM] 창구가 넘긴 처리중', 6, '창구 → VM');
    await db.query(`UPDATE pending_orders SET status = '처리중' WHERE id = ANY($1::int[])`, [[st1, ad1, dk1]]);
    const rec = (await W.recoverOwn(db)).sort((x, y) => x - y);
    ok('heartbeat 가 나 자신(앞 러너 죽고 다시 뜸) = 되돌림 · 처리중 5줄 중 VM 몫 3줄만', JSON.stringify(rec) === JSON.stringify([h, ad1, dk1].sort((x, y) => x - y)) && (await row(k1)).status === '처리중' && (await row(st1)).status === '처리중', rec);
    await pg.close();
}

(async () => {
    units();
    await dbtests();
    console.log(`\n결과: ${pass}/${pass + fail}`);
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) { /* 남아도 무해 */ }
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('검증 오류:', e.stack || e); process.exit(1); });
