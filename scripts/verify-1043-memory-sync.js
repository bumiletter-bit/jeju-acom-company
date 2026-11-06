// #1043 메모리 양방향 맞추기 검증 — 가짜 폴더 두 개(노트북 쪽 = env PACK_KEYS_LOCAL_MEM · 나스 쪽 = fakeRemote 로컬 폴더) · 실나스 0 · 실DB 0 · 알림은 가짜 함수
//   node scripts/verify-1043-memory-sync.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'v1043-'));
const L = path.join(T, 'laptop'), R = path.join(T, 'nas'), D = path.join(T, 'akkome');
for (const d of [L, R, D]) fs.mkdirSync(d, { recursive: true });
process.env.PACK_KEYS_LOCAL_MEM = L; process.env.PACK_KEYS_NAS_MEM = '/없음-시험'; process.env.PACK_KEYS_SYNC_STATE = path.join(D, 'memory-sync.json'); process.env.MEMORY_SYNC_DIR = D;
const pk = require('./desk/pack-keys.js');
const ms = require('./desk/memory-sync.js');
let pass = 0, fail = 0;
const ok = (name, c, extra) => { if (c) pass++; else fail++; console.log((c ? '  ✓ ' : '  ✗ ') + name + (c || extra === undefined ? '' : '  → ' + JSON.stringify(extra))); };
const w = (dir, n, s, ago) => { const p = path.join(dir, n); fs.writeFileSync(p, s); const t = new Date(Date.now() - (ago || 0) * 1000); fs.utimesSync(p, t, t); };
const rd = (dir, n) => { try { return fs.readFileSync(path.join(dir, n), 'utf8'); } catch (e) { return null; } };
let puts = 0, alerts = [];
const base = ms.fakeRemote(R);
const remote = { list: () => base.list(), fetch: (a, b) => base.fetch(a, b), put: e => { puts++; return base.put(e); } };
const alert = async t => { alerts.push(t); return true; };
const run = o => ms.syncOnce(Object.assign({ remote, alert }, o || {}));

(async () => {
    // 준비 — 양쪽 같은 7개 + 기록 없음 상태
    const names = ['MEMORY.md', 'a.md', 'b.md', 'c.md', 'd.md', 'gone.md', 'nasgone.md'];
    for (const n of names) { w(L, n, 'v1 ' + n, 600); w(R, n, 'v1 ' + n, 600); }
    console.log('[0] 기록 없음');
    let s = await run();
    ok('기록 없으면 아무것도 안 함(ok:false)', s.ok === false && puts === 0, s);

    console.log('[1] 같음 = 0건');
    pk.memSyncSave('test', { local: pk.localMem(), nas: await base.list() }, []);
    s = await run();
    ok('같음 7 · 받기 0 · 보내기 0', s.같음 === 7 && !s.받기.length && !s.보내기.length, s);
    ok('나스 쓰기 0(put 0)', puts === 0, puts);

    console.log('[2] 나스만 바뀜 = 받기');
    w(R, 'a.md', 'v2 nas a', 0);
    s = await run();
    ok('받기 = a.md', s.받기.join() === 'a.md', s.받기);
    ok('노트북 a.md = 나스 내용', rd(L, 'a.md') === 'v2 nas a');
    ok('노트북 a.md 수정 시각 = 나스 것(초)', Math.floor(fs.statSync(path.join(L, 'a.md')).mtimeMs / 1000) === Math.floor(fs.statSync(path.join(R, 'a.md')).mtimeMs / 1000));
    ok('표식 파일 갱신(how auto)', JSON.parse(rd(R, pk.MARK) || '{}').how === 'auto');

    console.log('[3] 노트북만 바뀜 = 보내기');
    w(L, 'b.md', 'v2 laptop b', 0);
    s = await run();
    ok('보내기 = b.md', s.보내기.join() === 'b.md', s.보내기);
    ok('나스 b.md = 노트북 내용', rd(R, 'b.md') === 'v2 laptop b');
    s = await run();
    ok('다시 돌리면 0건(기준 갱신됨)', s.같음 === 7 && !s.받기.length && !s.보내기.length, s);

    console.log('[4] 둘 다 바뀜 = 확인필요');
    w(L, 'c.md', 'v2 laptop c', 0); w(R, 'c.md', 'v2 nas c', 0);
    const before = puts;
    s = await run();
    ok('확인필요_양쪽바뀜 = c.md', s.확인필요_양쪽바뀜.join() === 'c.md', s);
    ok('양쪽 덮지 않음', rd(L, 'c.md') === 'v2 laptop c' && rd(R, 'c.md') === 'v2 nas c');
    ok('나스 쓰기 0', puts === before, puts - before);
    const a0 = alerts[0] || {};
    ok('알림 1통 = memory_sync_alert 꼴 {at, host, count, files}(이름만)', alerts.length === 1 && a0.count === 1 && JSON.stringify(a0.files) === '["c.md"]' && !!a0.at && !!a0.host && !/v2/.test(JSON.stringify(a0)) && Object.keys(a0).sort().join() === 'at,count,files,host', alerts);
    s = await run();
    ok('다음 회차도 확인필요 유지', s.확인필요_양쪽바뀜.join() === 'c.md');
    ok('같은 날 알림 더 없음', alerts.length === 1 && s.알림 === '오늘 이미 보냄', s.알림);
    s = await run({ dry: true, force: ['c.md'] });
    ok('--dry --force = 계획만(나스 그대로)', s.force_노트북것보냄.join() === 'c.md' && rd(R, 'c.md') === 'v2 nas c');
    s = await run({ force: ['c.md'] });
    ok('--force c.md = 노트북 것으로 나스 덮음', rd(R, 'c.md') === 'v2 laptop c' && s.force_노트북것보냄.join() === 'c.md');
    s = await run();
    ok('force 뒤 확인필요 0', !s.확인필요_양쪽바뀜.length && s.같음 === 7, s);

    console.log('[5] 나스 새 파일 = 받기');
    w(R, 'nas-new.md', 'from nas chief', 0);
    s = await run();
    ok('나스에서새로씀 = nas-new.md · 받음', s.나스에서새로씀.join() === 'nas-new.md' && rd(L, 'nas-new.md') === 'from nas chief', s);

    console.log('[6] 노트북에서 지운 파일 = 안 되살림');
    fs.unlinkSync(path.join(L, 'gone.md'));
    s = await run();
    ok('노트북에서지움 = gone.md', s.노트북에서지움_안되살림.join() === 'gone.md', s);
    ok('노트북에 안 되살아남 · 나스 것도 안 지움', rd(L, 'gone.md') === null && rd(R, 'gone.md') !== null);
    s = await run();
    ok('다음 회차도 그대로', s.노트북에서지움_안되살림.join() === 'gone.md' && rd(L, 'gone.md') === null);

    console.log('[7] 수동 보내기 대기(.pending) 중 자동 = 쓰기 0 · 노트북 최신 유지(워커3 재현 꼴)');
    w(L, 'd.md', 'v2 laptop d (newest)', 0);   // 노트북이 고침 · 나스는 옛 v1
    const lm = pk.localMem();
    pk.memSyncSave('push', { local: lm, nas: lm }, null, Object.fromEntries([...lm].map(([n, v]) => [n, v.h])), 'pid1043');   // = pack-keys --only memory --out 이 남기는 .pending
    const stBefore = fs.readFileSync(pk.SYNC_STATE, 'utf8'), pp = puts;
    s = await run();
    ok('ok:false pending · 쓰기 0', s.ok === false && s.pending === true && puts === pp, s);
    ok('노트북 d.md 그대로 · 나스 d.md 그대로 · .pending 남음', rd(L, 'd.md') === 'v2 laptop d (newest)' && rd(R, 'd.md') === 'v1 d.md' && fs.existsSync(pk.SYNC_PENDING));
    ok('기준 해시 안 올라감(d.md)', JSON.parse(fs.readFileSync(pk.SYNC_STATE, 'utf8')).hashes['d.md'] === JSON.parse(stBefore).hashes['d.md']);
    w(R, 'd.md', 'v2 laptop d (newest)', 0); fs.writeFileSync(path.join(R, pk.MARK), JSON.stringify({ id: 'pid1043', at: new Date().toISOString() }));   // 총괄이 꾸러미를 나스에 넣음
    s = await run();
    ok('넣은 뒤 다음 회차 = 확정 · .pending 지움 · 노트북 최신 유지', s.ok && !fs.existsSync(pk.SYNC_PENDING) && rd(L, 'd.md') === 'v2 laptop d (newest)' && !s.받기.includes('d.md'), s);

    console.log('[덤] 나스에서 지움 · 노트북 새 파일 · 점 파일 · dry');
    fs.unlinkSync(path.join(R, 'nasgone.md'));
    s = await run();
    ok('나스에서 지운 파일(노트북 그대로) = 안 보냄', s.나스에서지움_안보냄.join() === 'nasgone.md' && rd(R, 'nasgone.md') === null && rd(L, 'nasgone.md') !== null, s);
    w(L, 'laptop-new.md', 'from laptop', 0); w(L, '.hidden', 'x', 0);
    const p0 = puts;
    s = await run({ dry: true });
    ok('--dry = 보내기 계획만 · 나스 쓰기 0', s.보내기.join() === 'laptop-new.md' && puts === p0 && rd(R, 'laptop-new.md') === null, s);
    s = await run();
    ok('노트북 새 파일 보냄 · 점 파일 안 보냄', rd(R, 'laptop-new.md') === 'from laptop' && rd(R, '.hidden') === null);

    console.log('[묶음] ustar 를 tar 가 풂');
    const tb = ms.tarPack([{ name: 'x-1.md', buf: Buffer.from('한글 내용\n'), mtime: Date.UTC(2026, 10, 6, 1, 2, 3) }, { name: pk.MARK, buf: Buffer.from('{}'), mtime: Date.now() }]);
    const X = path.join(T, 'tar'); fs.mkdirSync(X); fs.writeFileSync(path.join(X, 'm.tar'), tb);
    let tarOk = false; try { execFileSync('tar', ['-xf', 'm.tar'], { cwd: X, stdio: 'ignore' }); tarOk = true; } catch (e) { /* 실패 */ }
    ok('tar 풀기 성공 · 내용 같음', tarOk && rd(X, 'x-1.md') === '한글 내용\n' && rd(X, pk.MARK) === '{}');
    ok('수정 시각 보존', tarOk && Math.floor(fs.statSync(path.join(X, 'x-1.md')).mtimeMs / 1000) === Date.UTC(2026, 10, 6, 1, 2, 3) / 1000);

    console.log('[CLI] pack-keys 그대로 · memory-sync --auto 꺼짐');
    const env = Object.assign({}, process.env);
    const pkOut = execFileSync(process.execPath, [path.join(__dirname, 'desk', 'pack-keys.js'), '--only', 'memory'], { env, encoding: 'utf8' });
    ok('pack-keys --only memory 미리 보기 그대로 돎', /합계\(--only memory\)/.test(pkOut));
    const autoOut = execFileSync(process.execPath, [path.join(__dirname, 'desk', 'memory-sync.js'), '--auto', '--fake-remote', R], { env, encoding: 'utf8' });
    ok('--auto 는 --enable 전엔 아무것도 안 함(출력 0)', autoOut === '');
    w(L, 'cli.md', 'cli', 0);
    execFileSync(process.execPath, [path.join(__dirname, 'desk', 'memory-sync.js'), '--enable'], { env });
    execFileSync(process.execPath, [path.join(__dirname, 'desk', 'memory-sync.js'), '--auto', '--fake-remote', R], { env, encoding: 'utf8' });
    ok('--enable 뒤 --auto = 보냄 · 로그 한 줄', rd(R, 'cli.md') === 'cli' && fs.readdirSync(path.join(D, 'logs')).some(n => /^memory-sync-/.test(n)));
    // 확인필요만 남은 틱 = 그날 첫 틱만 로그(2분마다 쌓이지 않게)
    w(L, 'e.md', 'v2 laptop e', 0); w(R, 'e.md', 'v2 nas e', 0);
    const logf = path.join(D, 'logs', fs.readdirSync(path.join(D, 'logs')).find(n => /^memory-sync-/.test(n)));
    for (let i = 0; i < 3; i++) execFileSync(process.execPath, [path.join(__dirname, 'desk', 'memory-sync.js'), '--auto', '--fake-remote', R], { env });
    ok('확인필요 3틱 = 로그 1줄', fs.readFileSync(logf, 'utf8').split('\n').filter(l => /확인필요 e\.md/.test(l)).length === 1, fs.readFileSync(logf, 'utf8'));
    // .pending 멈춤 = 그날 한 줄
    pk.memSyncSave('push', { local: pk.localMem(), nas: pk.localMem() }, null, {}, 'pid-x');
    for (let i = 0; i < 3; i++) execFileSync(process.execPath, [path.join(__dirname, 'desk', 'memory-sync.js'), '--auto', '--fake-remote', R], { env });
    ok('.pending 멈춤 3틱 = 로그 1줄', fs.readFileSync(logf, 'utf8').split('\n').filter(l => /멈춤: 수동 보내기 대기/.test(l)).length === 1);
    execFileSync(process.execPath, [path.join(__dirname, 'desk', 'memory-sync.js'), '--disable'], { env });

    fs.rmSync(T, { recursive: true, force: true });
    console.log(`\n${pass}/${pass + fail} ${fail ? '실패 있음' : '통과'}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.log('오류', e); process.exit(1); });
