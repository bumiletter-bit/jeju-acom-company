// #827-B 검증 — scripts/desk/scratch-clean.js 의 clean() 을 가짜 ROOT(os.tmpdir 아래) + 가짜 상태 조회로 돌린다. 실DB 읽기·쓰기 0 · 실제 .scratch 무접촉.
// 사용: node scripts/verify-827-scratch-clean.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clean, readConfig } = require('./desk/scratch-clean');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const NOW = Date.now();
const DAY = 86400e3;
const old = (NOW - 30 * DAY) / 1000, fresh = (NOW - 1 * DAY) / 1000;

function mk(root, name, files, folderT, fileT) {
    const d = path.join(root, name);
    fs.mkdirSync(d, { recursive: true });
    for (const [f, t] of Object.entries(files || {})) {
        const p = path.join(d, f);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, 'x'.repeat(1000));
        fs.utimesSync(p, t || fileT || old, t || fileT || old);
    }
    // 하위 폴더 mtime 도 오래되게(파일을 만들며 바뀜)
    for (const f of Object.keys(files || {})) { const sub = path.dirname(path.join(d, f)); if (sub !== d) fs.utimesSync(sub, old, old); }
    fs.utimesSync(d, folderT || old, folderT || old);
    return d;
}

function build() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v827-'));
    mk(root, '.scratch101', { 'result.json': old });                       // 오래됨 · 완료 → 지움
    mk(root, '.scratch102', { 'result.json': old, 'sub/a.png': old });     // 오래됨 · 취소 · 하위 폴더 → 지움
    mk(root, '.scratch103', { 'result.json': old }, fresh);               // 폴더 자체가 최근 → 둠
    mk(root, '.scratch104', { 'result.json': old, 'b.txt': fresh });      // 안에 최근 파일 하나 → 둠
    mk(root, '.scratch105', { 'result.json': old });                       // busy id → 둠
    mk(root, '.scratch106', { 'result.json': old });                       // DB 에 없음 → 둠
    mk(root, '.scratch107', { 'result.json': old });                       // 진행 중(대기) → 둠
    mk(root, '.scratch108', { 'result.json': old });                       // 질문 → 둠
    mk(root, '.scratch109', { 'result.json': old });                       // 모르는 상태 → 둠
    mk(root, '.scratch110', { 'result.json': old });                       // 지운 행(대기지만 is_deleted) → 지움
    mk(root, '.scratchx', { 'result.json': old });                         // 이름 다름
    mk(root, '.scratch12a', { 'result.json': old });                       // 이름 다름
    mk(root, '.scratch', { 'result.json': old });                          // 이름 다름(번호 없음)
    fs.writeFileSync(path.join(root, '.scratch111'), 'file');              // 파일(폴더 아님)
    fs.utimesSync(path.join(root, '.scratch111'), old, old);
    // 링크(정션) — 만들 수 있을 때만
    const outside = mk(fs.mkdtempSync(path.join(os.tmpdir(), 'v827o-')), 'target', { 'keep.txt': old });
    let linked = false;
    try { fs.symlinkSync(outside, path.join(root, '.scratch112'), 'junction'); linked = true; } catch (e) { /* 권한 없음 */ }
    mk(root, '.scratch113', { 'result.json': old });                       // 안에 링크 → 둠
    try { fs.symlinkSync(outside, path.join(root, '.scratch113', 'lnk'), 'junction'); } catch (e) { /* 권한 없음 */ }
    fs.utimesSync(path.join(root, '.scratch113'), old, old);
    return { root, outside, linked };
}

const STATUS = new Map([
    [101, { status: '완료', is_deleted: false }], [102, { status: '취소', is_deleted: false }], [103, { status: '완료', is_deleted: false }],
    [104, { status: '완료', is_deleted: false }], [105, { status: '완료', is_deleted: false }], [107, { status: '대기', is_deleted: false }],
    [108, { status: '질문', is_deleted: false }], [109, { status: '새상태', is_deleted: false }], [110, { status: '대기', is_deleted: true }],
    [112, { status: '완료', is_deleted: false }], [113, { status: '완료', is_deleted: false }],
]);
let asked = null;
const statusOf = async ids => { asked = ids.slice().sort((a, b) => a - b); return new Map(ids.filter(i => STATUS.has(i)).map(i => [i, STATUS.get(i)])); };
const exists = (root, n) => fs.existsSync(path.join(root, n));

(async () => {
    const { root, outside, linked } = build();
    console.log('가짜 ROOT = ' + root + (linked ? '' : ' (정션 못 만듦 — 링크 항목 일부 건너뜀)'));

    console.log('[dry]');
    const d = await clean({ root, days: 14, apply: false, busyIds: new Set([105]), statusOf, now: NOW });
    const dn = d.targets.map(t => t.name).sort();
    ok(JSON.stringify(dn) === JSON.stringify(['.scratch101', '.scratch102', '.scratch110']), 'dry 대상 = 101·102·110 (' + dn.join(',') + ')');
    ok(d.deleted === 0, 'dry 는 지운 것 0');
    ok(['.scratch101', '.scratch102', '.scratch110', '.scratch103', '.scratch104'].every(n => exists(root, n)), 'dry 뒤 폴더 그대로');
    ok(d.bytes === 4000, 'dry 바이트 합 4000 (' + d.bytes + ')');
    ok((d.skipped['이름 다름'] || []).sort().join(',') === '.scratch,.scratch12a,.scratchx', '이름 다름 3개');
    ok((d.skipped['최근(14일 안)'] || []).sort().join(',') === '.scratch103,.scratch104', '최근(폴더 mtime·안 파일) 103·104');
    ok((d.skipped['처리 중'] || []).join(',') === '.scratch105', 'busy 105');
    ok((d.skipped['지시 행 없음'] || []).join(',') === '.scratch106', 'DB 없음 106');
    ok((d.skipped['진행 중 상태'] || []).sort().join(',') === '.scratch107,.scratch108', '진행 중 107(대기)·108(질문)');
    ok((d.skipped['모르는 상태(새상태)'] || []).join(',') === '.scratch109', '모르는 상태 109');
    ok((d.skipped['실제 폴더 아님'] || []).includes('.scratch111'), '파일 111 = 실제 폴더 아님');
    if (linked) ok((d.skipped['실제 폴더 아님'] || []).includes('.scratch112'), '정션 112 = 실제 폴더 아님');
    if (fs.existsSync(path.join(root, '.scratch113', 'lnk'))) ok((d.skipped['안에 링크'] || []).includes('.scratch113'), '안에 링크 113');
    ok(asked && !asked.includes(105) && !asked.includes(103) && !asked.includes(104), 'DB 는 1차 통과한 것만 물음(' + (asked || []).join(',') + ')');

    console.log('[apply]');
    const a = await clean({ root, days: 14, apply: true, busyIds: new Set([105]), statusOf, now: NOW });
    ok(a.deleted === 3, 'apply 지움 3 (' + a.deleted + ')');
    ok(!exists(root, '.scratch101') && !exists(root, '.scratch102') && !exists(root, '.scratch110'), '101·102·110 사라짐');
    ok(['.scratch103', '.scratch104', '.scratch105', '.scratch106', '.scratch107', '.scratch108', '.scratch109', '.scratchx', '.scratch12a', '.scratch', '.scratch111', '.scratch113'].every(n => exists(root, n)), '나머지 전부 남음');
    ok(fs.existsSync(path.join(outside, 'keep.txt')), '링크 너머 바깥 파일 무사');

    console.log('[days 조절]');
    const a2 = await clean({ root, days: 0.5, apply: false, busyIds: new Set(), statusOf, now: NOW });   // 1 미만 → 1일
    ok(a2.days === 1, 'days 하한 1');
    ok(a2.targets.map(t => t.name).includes('.scratch105'), 'busy 풀리면 105 대상');

    console.log('[DB 오류]');
    let threw = false;
    try { await clean({ root, days: 14, apply: true, busyIds: new Set(), statusOf: async () => { throw new Error('가짜 DB 오류'); }, now: NOW }); } catch (e) { threw = /가짜/.test(e.message); }
    ok(threw, 'DB 오류면 던짐');
    ok(exists(root, '.scratch105') && exists(root, '.scratch104'), 'DB 오류 뒤 하나도 안 지움');

    console.log('[설정 읽기 · 가짜 pool]');
    const fp = v => ({ query: async () => ({ rows: v === undefined ? [] : [{ value: v }] }) });
    ok((await readConfig(fp(undefined))).enabled === false, '키 없음 = 꺼짐');
    ok((await readConfig(fp({ enabled: 'true' }))).enabled === false, 'enabled 글자 "true" = 꺼짐');
    const c3 = await readConfig(fp({ enabled: true, keep_days: 30 }));
    ok(c3.enabled === true && c3.keep_days === 30, 'enabled true · keep_days 30');
    ok((await readConfig(fp({ enabled: true }))).keep_days === 14, 'keep_days 없으면 14');

    try { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(path.dirname(outside), { recursive: true, force: true }); } catch (e) { /* 남아도 tmp */ }
    console.log(`결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
