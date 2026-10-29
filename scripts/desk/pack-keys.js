// #916-B 나스 창구 이전용 열쇠·설정 꾸러미 — 설계서 docs/914-nas-desk-docker.md 3-4절 목록을 한 번에 모은다.
//   미리 보기(기본): node scripts/desk/pack-keys.js            (= --dry · 묶음마다 파일 수·크기·권한·나스에서 둘 자리만 찍는다 · 복사 0 · 값 0)
//                    node scripts/desk/pack-keys.js --full     (미리 보기 + 묶음 안 파일 전부)
//   모으기:          node scripts/desk/pack-keys.js --out <빈 폴더>   🔴 총괄 지시 뒤에만 · 나스 쪽 모양(home/… · work/…) 그대로 복사 → 나스 /volume1/docker/akkome/ 아래로 옮기면 된다
//   묶음 하나만:    node scripts/desk/pack-keys.js --only memory [--out <빈 폴더>]   (#917 · 쉼표로 여럿 · 이름 = 아래 KEYS · 전환 순간 노트북 최신 메모리만 다시 보낼 때)
//     🔴 나스에서 겹칠 때 덮어쓰기 허용은 memory 묶음만(OVERWRITE_OK) — 나머지 묶음은 종전대로 「새 파일만」(cp -a -n). --out 결과 JSON 의 overwrite_ok·new_only 로 알려 준다.
//   나스 전송은 이 도구가 하지 않는다(총괄이 scp/rsync · 설계서 3-4절 명령).
// 🔴 비밀 값은 어디에도 찍지 않는다 — 찍는 것은 파일 이름·크기·권한·수정 시각뿐(.env 도 칸 이름조차 안 찍음).
//   ~/.akkome/nas.txt(나스 비번)는 빼고(설계서 3-2절 「nas.txt 제외」) · ~/.claude.json 은 MCP 의 aside(Windows 전용) 줄을 지운 사본으로 만든다.
//   권한: Windows 에서는 600/700 을 줄 수 없어 「나스에서 줄 권한」 칸으로 적어 둔다(옮긴 뒤 나스에서 chown 1001:100 · chmod).
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const HOME = os.homedir();
const MEM_PROJECT = 'C--Users-----OneDrive------------------';   // 이 프로젝트(회사프로그램)의 Claude 메모리 폴더 이름
const LOCAL_MEM = process.env.PACK_KEYS_LOCAL_MEM || path.join(HOME, '.claude', 'projects', MEM_PROJECT, 'memory');   // 시험용 env(임시 폴더) · 꾸러미 memory 묶음 원본도 이것
const SKIP_AKKOME = n => n === 'nas.txt' || n === 'logs' || /^shots-/.test(n);   // 나스 비번은 보내지 않는다 · logs(286MB)·shots-*(화면 캡처)는 나스에 필요 없음(총괄 10/29)

// 묶음 = [이름, 원본, 나스에서 둘 자리(꾸러미 안 상대 경로), 나스에서 줄 권한(파일/폴더), 메모]
const ITEMS = [
    ['창구 상태·로그·콘솔 키(~/.akkome · nas.txt·logs·shots-* 뺌)', path.join(HOME, '.akkome'), 'home/.akkome', '600/700', 'desk-api-key.txt = 창구 콘솔 키(과금) · 로그·화면 캡처·옛 패치도 같이 들어감'],
    ['중계서버 SSH 열쇠', path.join(HOME, '.ssh', 'id_ed25519'), 'home/.ssh/id_ed25519', '600', '중계서버(akkome-relay) 접속'],
    ['중계서버 SSH 공개 열쇠', path.join(HOME, '.ssh', 'id_ed25519.pub'), 'home/.ssh/id_ed25519.pub', '644', ''],
    ['SSH 알려진 호스트', path.join(HOME, '.ssh', 'known_hosts'), 'home/.ssh/known_hosts', '644', '없어도 됨(첫 접속 때 다시 물음)'],
    ['Claude 대표 요금제 로그인', path.join(HOME, '.claude', '.credentials.json'), 'home/.claude/.credentials.json', '600', '없으면 컨테이너 안 /login 1회(설계서 3-4절)'],
    ['Claude 설정(참고용)', path.join(HOME, '.claude', 'settings.json'), 'home/.claude/settings.json.pc', '600', '컨테이너용은 훅 빼고 새로 · 이건 참고'],
    ['Claude 메모리(이 프로젝트)', LOCAL_MEM, 'home/.claude/projects/-work/memory', '600/700', '폴더 이름을 /work 프로젝트 꼴(-work)로 바꿔 둠'],
    ['Claude MCP·계정(.claude.json · aside 뺀 사본)', path.join(HOME, '.claude.json'), 'home/.claude.json', '600', 'mcpServers 에서 aside 지움(모든 프로젝트 칸도)'],
    ['힉스필드 CLI 로그인', path.join(HOME, '.config', 'higgsfield'), 'home/.config/higgsfield', '600/700', 'config·credentials'],
    ['.env(DB 주소 · 카페24 SFTP 값)', path.join(ROOT, '.env'), 'work/.env', '600', '카페24 SFTP 값(CAFE24_FTP_*)은 이 파일 안 — 따로 파일 없음'],
    ['창구 비공개 폴더(저장소 밖)', path.join(ROOT, '★에이전트오피스', '비공개'), 'work/★에이전트오피스/비공개', '600/700', '공유폴더 색인 옛 자리·릴스 기준 등(저장소 제외)'],
    ['창구 브랜드 그림(저장소 밖)', path.join(ROOT, '★에이전트오피스', '브랜드'), 'work/★에이전트오피스/브랜드', '644/755', '3D 아꼼이·상품 사진'],
];
// #917 묶음 짧은 이름(--only) — ITEMS 와 같은 순서
const KEYS = ['akkome', 'ssh-key', 'ssh-pub', 'known-hosts', 'credentials', 'settings', 'memory', 'claude-json', 'higgsfield', 'env', 'private', 'brand'];
const OVERWRITE_OK = new Set(['memory']);   // 나스에 이미 있어도 덮어도 되는 묶음(노트북이 최신 정본)

function walk(src, rel, out, skipTop) {
    let st; try { st = fs.statSync(src); } catch (e) { return out; }
    if (st.isDirectory()) {
        for (const n of fs.readdirSync(src)) { if (skipTop && !rel && SKIP_AKKOME(n)) { out.skipped.push(n); continue; } walk(path.join(src, n), rel ? rel + '/' + n : n, out, skipTop); }
    } else out.files.push({ rel, size: st.size, mode: (st.mode & 0o777).toString(8), mtime: st.mtime.toISOString().slice(0, 16) });
    return out;
}
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n >= 1024 ? Math.round(n / 1024) + 'KB' : n + 'B';

function scan() {
    return ITEMS.map(([name, src, dest, perm, memo], i) => ({ key: KEYS[i], name, src, dest, perm, memo })).filter(x => !ONLY || ONLY.includes(x.key)).map(({ key, name, src, dest, perm, memo }) => {
        const exists = fs.existsSync(src), isDir = exists && fs.statSync(src).isDirectory();
        const r = walk(src, '', { files: [], skipped: [] }, src === path.join(HOME, '.akkome'));
        if (exists && !isDir) r.files[0].rel = path.basename(src);
        return { key, name, src, dest, perm, memo, exists, isDir, files: r.files, skipped: r.skipped, bytes: r.files.reduce((a, f) => a + f.size, 0) };
    });
}
// .claude.json 에서 aside MCP 를 지운 사본(값은 찍지 않고 바로 파일로)
function claudeJsonNoAside(src) {
    const j = JSON.parse(fs.readFileSync(src, 'utf8'));
    let removed = 0;
    const strip = o => { if (o && o.mcpServers && o.mcpServers.aside) { delete o.mcpServers.aside; removed++; } };
    strip(j); for (const p of Object.values(j.projects || {})) strip(p);
    return { text: JSON.stringify(j, null, 2), removed };
}

// ── #917 메모리 맞추기(노트북 ↔ 나스) ───────────────────────────────────────────────────
//   받기(나스 → 노트북): node scripts/desk/pack-keys.js --pull memory [--apply]      (기본 = 미리 보기 · 쓰기 0)
//   보내기(노트북 → 나스): node scripts/desk/pack-keys.js --only memory --out <빈 폴더> [--force 파일,…]
//   🔴 순서 = 먼저 --pull(나스에서 적은 것 받기) → 그다음 --out(나스 폴더 비우고 넣기). 거꾸로 하면 지난 나스 세션 메모리가 지워진다.
//   기준 = 맞추기 기록 ~/.akkome/memory-sync.json { files: 지난번에 알던 이름, hashes: 지난번 양쪽이 같았던 내용(sha256) }.
//   파일마다:
//     · 양쪽 내용 같음 → 건너뜀
//     · 기준 해시가 있고 한쪽만 바뀜 → 바뀐 쪽을 따름(받기 = 나스만 바뀌었으면 받음 · 보내기 = 노트북 것이 나감)
//     · 기준 해시가 있고 양쪽 다 바뀜 → 「확인필요(양쪽 바뀜)」 · 덮지 않음 = 받기는 노트북 유지 · 보내기는 꾸러미에 나스 쪽 내용을 넣어 나스 것을 지킴 →
//       총괄이 노트북 파일에 손으로 합친 뒤 --out … --force 그파일 로 노트북 것을 내보냄(MEMORY.md 는 줄 단위라 합치기 쉬움)
//     · 기준 해시가 없음(기록 처음·새 파일) → 받기는 수정 시각이 늦은 쪽(나스가 늦으면 받음) · 보내기는 노트북 것
//     · 나스에만 있음 → 기록 files 에 있었으면 「노트북에서 지운 것」(안 되살림) · 없었으면 나스에서 새로 쓴 것(받음) · 기록이 아예 없으면 「확인필요(기록 없음)」
//     · 노트북에만 있음 → 그대로(지우지 않음)
//   접속 = 나스 user1(비번 ~/.akkome/nas.txt · 찍지 않음) · 폴더가 akkome 700 이라 sudo -S(비번은 stdin 으로만). 받은 파일은 나스 수정 시각으로 맞춤.
const NAS_MEM = process.env.PACK_KEYS_NAS_MEM || '/volume1/docker/akkome/home/.claude/projects/-work/memory';   // 시험용 env(나스 임시 사본)
const SYNC_STATE = process.env.PACK_KEYS_SYNC_STATE || path.join(HOME, '.akkome', 'memory-sync.json');
const sha = buf => require('crypto').createHash('sha256').update(buf).digest('hex');
const qsh = n => "'" + String(n).replace(/'/g, "'\\''") + "'";
function memState() { try { const j = JSON.parse(fs.readFileSync(SYNC_STATE, 'utf8')); return { files: new Set(j.files || []), hashes: j.hashes || {} }; } catch (e) { return null; } }
// 보내기(--out) 기록은 곧바로 확정하지 않는다 — 꾸러미가 나스에 실제로 들어갔는지 모르므로 .pending 에 두었다가,
// 다음 --pull/--out 때 나스 내용이 그 꾸러미와 똑같으면(이름·해시 전부) 그때 확정한다. 안 들어갔으면 옛 기록 그대로(노트북 최신 파일을 옛 나스 것으로 되돌리는 일 막음).
const SYNC_PENDING = SYNC_STATE.replace(/\.json$/, '') + '.pending.json';
function promotePending(nas) {
    let p; try { p = JSON.parse(fs.readFileSync(SYNC_PENDING, 'utf8')); } catch (e) { return null; }
    const b = p.bundle || {}, names = Object.keys(b);
    const delivered = names.length === nas.size && names.every(n => nas.get(n) && nas.get(n).h === b[n]);
    if (!delivered) return '지난 보내기(' + String(p.at).slice(0, 16) + ')가 나스에 안 들어감 — 기록 확정 안 함';
    delete p.bundle; fs.writeFileSync(SYNC_STATE, JSON.stringify(p)); fs.unlinkSync(SYNC_PENDING);
    return '지난 보내기(' + String(p.at).slice(0, 16) + ') 나스 들어감 확인 → 기록 확정';
}
function localMem() { return new Map(fs.readdirSync(LOCAL_MEM).filter(n => fs.statSync(path.join(LOCAL_MEM, n)).isFile()).map(n => { const p = path.join(LOCAL_MEM, n); return [n, { m: fs.statSync(p).mtimeMs, h: sha(fs.readFileSync(p)) }]; })); }
// 새 기록 = 맞춘 뒤 양쪽이 같은 파일만 그 해시로 · 아직 다른 파일(양쪽 바뀜 등)은 옛 기준 해시 유지 · files = 노트북 + 안 받고 둔 나스 전용(지운 것·확인필요)
function memSyncSave(how, after, extra, bundle) {   // bundle 이 있으면(보내기) .pending 으로만
    try {
        const old = memState() || { files: new Set(), hashes: {} };
        const hashes = {};
        for (const [n, v] of after.local) { const nv = after.nas.get(n); if (nv && nv.h === v.h) hashes[n] = v.h; else if (old.hashes[n]) hashes[n] = old.hashes[n]; }
        const known = new Set(after.local.keys()); for (const n of extra || []) known.add(n);
        const rec = { at: new Date().toISOString(), how, files: [...known].sort(), hashes };
        if (bundle) fs.writeFileSync(SYNC_PENDING, JSON.stringify(Object.assign(rec, { bundle })));
        else { fs.writeFileSync(SYNC_STATE, JSON.stringify(rec)); try { fs.unlinkSync(SYNC_PENDING); } catch (e) { /* 없음 */ } }
    } catch (e) { /* 기록 실패 = 다음엔 「처음」처럼 보수적으로 */ }
}
function nasExec(cmd, sudo, binary) {
    const { Client } = require(path.join(ROOT, 'node_modules', 'ssh2'));
    const kv = {}; for (const l of fs.readFileSync(path.join(HOME, '.akkome', 'nas.txt'), 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    return new Promise((resolve, reject) => {
        const c = new Client(); const out = [], err = [];
        c.on('ready', () => c.exec(sudo ? `sudo -S -p "" ${cmd}` : cmd, (e, st) => {
            if (e) { c.end(); return reject(e); }
            if (sudo) st.write(kv.pw + '\n');
            st.on('data', d => out.push(d)); st.stderr.on('data', d => err.push(d));
            st.on('close', code => { c.end(); const o = Buffer.concat(out); if (code) return reject(new Error('나스 명령 실패(exit ' + code + '): ' + Buffer.concat(err).toString('utf8').split(kv.pw).join('<pw>').slice(0, 200))); resolve(binary ? o : o.toString('utf8')); });
        })).on('error', reject).connect({ host: '192.168.0.22', port: 22, username: kv.id, password: kv.pw, readyTimeout: 15000 });
    });
}
// 나스 목록: 이름 \t 수정 시각(초) \t sha256 — 맨 위 파일만(메모리 폴더는 평평함)
async function nasMem() {
    const raw = await nasExec(`sh -c 'cd ${NAS_MEM} && for f in *; do [ -f "$f" ] || continue; printf "%s\\t%s\\t%s\\n" "$f" "$(stat -c %Y "$f")" "$(sha256sum "$f" | cut -c1-64)"; done'`, true);
    return new Map(raw.split('\n').filter(Boolean).map(l => { const [n, m, h] = l.split('\t'); return [n, { m: Number(m) * 1000, h }]; }));
}
async function nasFetch(names, dir) {   // 나스 파일들을 dir 에 풀어 둔다(tar)
    const tarBuf = await nasExec(`tar -C ${qsh(NAS_MEM)} -cf - -- ${names.map(qsh).join(' ')}`, true, true);
    fs.writeFileSync(path.join(dir, '.m.tar'), tarBuf);
    require('child_process').execFileSync('tar', ['-xf', '.m.tar'], { cwd: dir, stdio: 'ignore' });
    fs.unlinkSync(path.join(dir, '.m.tar'));
}
// 한 파일 판정(받기 기준) — 'same' | 'take' | 'keep' | 'conflict'
function judge(l, v, base) {
    if (l.h === v.h) return 'same';
    if (base) { const lc = l.h !== base, nc = v.h !== base; if (lc && nc) return 'conflict'; return nc ? 'take' : 'keep'; }
    return v.m > l.m ? 'take' : 'keep';
}
async function pullMemory(apply) {
    const nas = await nasMem(); const pend = promotePending(nas); const local = localMem(), st = memState();
    const r = { same: [], take: [], keep: [], conflict: [], nas_new: [], deleted_on_laptop: [], unsure: [], laptop_only: [] };
    for (const [n, v] of nas) {
        const l = local.get(n);
        if (l) r[judge(l, v, st && st.hashes[n])].push(n);
        else if (!st) r.unsure.push(n);
        else if (st.files.has(n)) r.deleted_on_laptop.push(n);
        else r.nas_new.push(n);
    }
    for (const n of local.keys()) if (!nas.has(n)) r.laptop_only.push(n);
    const get = [...r.take, ...r.nas_new];
    const sum = { nas: nas.size, laptop: local.size, 같음: r.same.length, 받을것_나스만바뀜또는더새로움: r.take, 받을것_나스에서새로씀: r.nas_new, 노트북유지_노트북만바뀜또는더새로움: r.keep, 확인필요_양쪽바뀜: r.conflict, 노트북에서지움_안되살림: r.deleted_on_laptop, 확인필요_기록없음: r.unsure, 노트북에만_그대로: r.laptop_only.length, 기록: st ? '있음' : '없음(처음)', 지난보내기: pend || '없음' };
    if (apply && get.length) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akm-mem-'));
        try { await nasFetch(get, tmp); for (const n of get) { const dst = path.join(LOCAL_MEM, n); fs.copyFileSync(path.join(tmp, n), dst); const t = new Date(nas.get(n).m); fs.utimesSync(dst, t, t); } }
        finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    if (apply) memSyncSave('pull', { local: localMem(), nas }, [...r.deleted_on_laptop, ...r.unsure]);
    console.log(JSON.stringify(Object.assign({ ok: true, mode: apply ? 'apply' : 'dry', 받음: apply ? get.length : 0, 받을것: get.length }, sum), null, 1));
}
// 보내기 전 판정 — 꾸러미에 넣을 내용: 기본 노트북 것 · 양쪽 바뀜(--force 아닌 것)은 나스 것을 넣어 나스 쪽을 지킴
async function pushPlan(force) {
    const nas = await nasMem(); const pend = promotePending(nas); const local = localMem(), st = memState();
    const conflict = [], forced = [];
    for (const [n, l] of local) {
        const v = nas.get(n); if (!v || v.h === l.h) continue;
        const base = st && st.hashes[n];
        if (base && l.h !== base && v.h !== base) { if (force.includes(n)) forced.push(n); else conflict.push(n); }
    }
    return { nas, local, conflict, forced, pend };
}

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const outDir = oi >= 0 ? args[oi + 1] : null;
const full = args.includes('--full');
const ni = args.indexOf('--only');
const ONLY = ni >= 0 ? String(args[ni + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : null;
if (ONLY) { const bad = ONLY.filter(k => !KEYS.includes(k)); if (bad.length || !ONLY.length) { console.log(JSON.stringify({ ok: false, error: '--only 이름이 틀렸습니다: ' + (bad.join(',') || '(빈칸)') + ' · 쓸 수 있는 이름 = ' + KEYS.join(', ') })); process.exit(1); } }
// #917 --pull memory = 거꾸로(나스 → 노트북) · 아래 pullMemory
if (args.includes('--pull')) {
    const what = args[args.indexOf('--pull') + 1];
    if (what !== 'memory') { console.log(JSON.stringify({ ok: false, error: '--pull 은 memory 만 됩니다(--pull memory)' })); process.exit(1); }
    pullMemory(args.includes('--apply')).catch(e => { console.log(JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 300) })); process.exit(1); });
    return;   // CommonJS 맨 위 return = 아래 미리 보기·모으기는 안 돈다
}
const items = scan();
if (!outDir) {
    // 미리 보기 — 값 0
    let n = 0, b = 0;
    for (const it of items) {
        n += it.files.length; b += it.bytes;
        console.log(`\n■ [${it.key}] ${it.name}${OVERWRITE_OK.has(it.key) ? '  (나스에서 덮어쓰기 허용)' : ''}${it.exists ? '' : '  🔴 없음'}\n  원본 ${it.src}\n  나스 /volume1/docker/akkome/${it.dest}  (권한 ${it.perm})\n  ${it.files.length}개 · ${kb(it.bytes)}${it.skipped.length ? ' · 뺌: ' + it.skipped.join(', ') : ''}${it.memo ? '\n  메모: ' + it.memo : ''}`);
        const show = full ? it.files : it.files.slice(0, 12);
        for (const f of show) console.log(`    ${f.mode}  ${kb(f.size).padStart(7)}  ${f.mtime}  ${f.rel}`);
        if (show.length < it.files.length) console.log(`    … ${it.files.length - show.length}개 더(--full)`);
    }
    if ((!ONLY || ONLY.includes('claude-json')) && fs.existsSync(path.join(HOME, '.claude.json'))) { try { console.log(`\n(.claude.json 사본에서 지울 aside MCP 줄: ${claudeJsonNoAside(path.join(HOME, '.claude.json')).removed}곳)`); } catch (e) { console.log('\n(.claude.json 읽기 실패: ' + e.message + ')'); } }
    console.log(`\n합계${ONLY ? '(--only ' + ONLY.join(',') + ')' : ''} ${items.length}묶음 · ${n}개 · ${kb(b)} · 없는 묶음 ${items.filter(i => !i.exists).length} — 미리 보기(복사 0). 모으기 = --out <빈 폴더>(총괄 지시 뒤)`);
    process.exit(0);
}
// 모으기 — 빈 폴더에만(덮어쓰기 0)
const OUT = path.resolve(outDir);
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) { console.log(JSON.stringify({ ok: false, error: '--out 폴더가 비어 있지 않습니다(덮어쓰지 않음): ' + OUT })); process.exit(1); }
const fi = args.indexOf('--force');
const FORCE = fi >= 0 ? String(args[fi + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : [];
(async () => {
    const memIt = items.find(i => i.key === 'memory' && i.exists);
    // #917 메모리가 들어가면 나스와 먼저 견줌 — 양쪽 다 바뀐 파일은 노트북 것을 넣지 않고 나스 것을 넣는다(나스 폴더를 비우고 넣어도 나스 쪽이 지켜짐)
    const plan = memIt ? await pushPlan(FORCE) : null;
    let copied = 0, bytes = 0;
    for (const it of items) {
        if (!it.exists) continue;
        for (const f of it.files) {
            if (plan && it === memIt && plan.conflict.includes(f.rel)) continue;
            const from = it.isDir ? path.join(it.src, ...f.rel.split('/')) : it.src;
            const to = it.isDir ? path.join(OUT, ...it.dest.split('/'), ...f.rel.split('/')) : path.join(OUT, ...it.dest.split('/'));
            fs.mkdirSync(path.dirname(to), { recursive: true });
            if (it.src === path.join(HOME, '.claude.json')) fs.writeFileSync(to, claudeJsonNoAside(from).text);
            else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
            copied++; bytes += f.size;
        }
    }
    if (plan && plan.conflict.length) { const d = path.join(OUT, ...memIt.dest.split('/')); fs.mkdirSync(d, { recursive: true }); await nasFetch(plan.conflict, d); copied += plan.conflict.length; }
    if (plan) {   // 나스가 받게 될 내용 = 꾸러미 내용 → 그것과 노트북이 같은 파일만 기준 해시로(양쪽 바뀜은 옛 기준 유지 = 다음에도 확인필요)
        const after = new Map([...plan.local].map(([n, v]) => [n, { h: plan.conflict.includes(n) ? plan.nas.get(n).h : v.h }]));
        memSyncSave('push', { local: plan.local, nas: after }, null, Object.fromEntries([...after].map(([n, v]) => [n, v.h])));   // .pending — 나스에 실제로 들어간 것이 확인될 때 확정
    }
    console.log(JSON.stringify({ ok: true, out: OUT, only: ONLY, copied, size: kb(bytes), overwrite_ok: items.filter(i => OVERWRITE_OK.has(i.key)).map(i => i.dest), new_only: items.filter(i => !OVERWRITE_OK.has(i.key)).map(i => i.dest),
        메모리_확인필요_양쪽바뀜_나스것넣음: plan ? plan.conflict : [], 메모리_force_노트북것넣음: plan ? plan.forced : [], 지난보내기: plan ? (plan.pend || '없음') : undefined,
        다음: '나스로 옮긴 뒤 sudo chown -R 1001:100 · .ssh 700 · 열쇠·키·.env·.credentials 600 (설계서 3-4절) · memory 는 나스 폴더를 비우고 넣기' + (plan && plan.conflict.length ? ' · 양쪽 바뀐 파일은 노트북 파일에 손으로 합친 뒤 --force 로 다시' : '') }));
})().catch(e => { console.log(JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 300) })); process.exit(1); });
