// #916-B 나스 창구 이전용 열쇠·설정 꾸러미 — 설계서 docs/914-nas-desk-docker.md 3-4절 목록을 한 번에 모은다.
//   미리 보기(기본): node scripts/desk/pack-keys.js            (= --dry · 묶음마다 파일 수·크기·권한·나스에서 둘 자리만 찍는다 · 복사 0 · 값 0)
//                    node scripts/desk/pack-keys.js --full     (미리 보기 + 묶음 안 파일 전부)
//   모으기:          node scripts/desk/pack-keys.js --out <빈 폴더>   🔴 총괄 지시 뒤에만 · 나스 쪽 모양(home/… · work/…) 그대로 복사 → 나스 /volume1/docker/akkome/ 아래로 옮기면 된다
//   나스 전송은 이 도구가 하지 않는다(총괄이 scp/rsync · 설계서 3-4절 명령).
// 🔴 비밀 값은 어디에도 찍지 않는다 — 찍는 것은 파일 이름·크기·권한·수정 시각뿐(.env 도 칸 이름조차 안 찍음).
//   ~/.akkome/nas.txt(나스 비번)는 빼고(설계서 3-2절 「nas.txt 제외」) · ~/.claude.json 은 MCP 의 aside(Windows 전용) 줄을 지운 사본으로 만든다.
//   권한: Windows 에서는 600/700 을 줄 수 없어 「나스에서 줄 권한」 칸으로 적어 둔다(옮긴 뒤 나스에서 chown 1001:100 · chmod).
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const HOME = os.homedir();
const MEM_PROJECT = 'C--Users-----OneDrive------------------';   // 이 프로젝트(회사프로그램)의 Claude 메모리 폴더 이름
const SKIP_AKKOME = n => n === 'nas.txt' || n === 'logs' || /^shots-/.test(n);   // 나스 비번은 보내지 않는다 · logs(286MB)·shots-*(화면 캡처)는 나스에 필요 없음(총괄 10/29)

// 묶음 = [이름, 원본, 나스에서 둘 자리(꾸러미 안 상대 경로), 나스에서 줄 권한(파일/폴더), 메모]
const ITEMS = [
    ['창구 상태·로그·콘솔 키(~/.akkome · nas.txt·logs·shots-* 뺌)', path.join(HOME, '.akkome'), 'home/.akkome', '600/700', 'desk-api-key.txt = 창구 콘솔 키(과금) · 로그·화면 캡처·옛 패치도 같이 들어감'],
    ['중계서버 SSH 열쇠', path.join(HOME, '.ssh', 'id_ed25519'), 'home/.ssh/id_ed25519', '600', '중계서버(akkome-relay) 접속'],
    ['중계서버 SSH 공개 열쇠', path.join(HOME, '.ssh', 'id_ed25519.pub'), 'home/.ssh/id_ed25519.pub', '644', ''],
    ['SSH 알려진 호스트', path.join(HOME, '.ssh', 'known_hosts'), 'home/.ssh/known_hosts', '644', '없어도 됨(첫 접속 때 다시 물음)'],
    ['Claude 대표 요금제 로그인', path.join(HOME, '.claude', '.credentials.json'), 'home/.claude/.credentials.json', '600', '없으면 컨테이너 안 /login 1회(설계서 3-4절)'],
    ['Claude 설정(참고용)', path.join(HOME, '.claude', 'settings.json'), 'home/.claude/settings.json.pc', '600', '컨테이너용은 훅 빼고 새로 · 이건 참고'],
    ['Claude 메모리(이 프로젝트)', path.join(HOME, '.claude', 'projects', MEM_PROJECT, 'memory'), 'home/.claude/projects/-work/memory', '600/700', '폴더 이름을 /work 프로젝트 꼴(-work)로 바꿔 둠'],
    ['Claude MCP·계정(.claude.json · aside 뺀 사본)', path.join(HOME, '.claude.json'), 'home/.claude.json', '600', 'mcpServers 에서 aside 지움(모든 프로젝트 칸도)'],
    ['힉스필드 CLI 로그인', path.join(HOME, '.config', 'higgsfield'), 'home/.config/higgsfield', '600/700', 'config·credentials'],
    ['.env(DB 주소 · 카페24 SFTP 값)', path.join(ROOT, '.env'), 'work/.env', '600', '카페24 SFTP 값(CAFE24_FTP_*)은 이 파일 안 — 따로 파일 없음'],
    ['창구 비공개 폴더(저장소 밖)', path.join(ROOT, '★에이전트오피스', '비공개'), 'work/★에이전트오피스/비공개', '600/700', '공유폴더 색인 옛 자리·릴스 기준 등(저장소 제외)'],
    ['창구 브랜드 그림(저장소 밖)', path.join(ROOT, '★에이전트오피스', '브랜드'), 'work/★에이전트오피스/브랜드', '644/755', '3D 아꼼이·상품 사진'],
];

function walk(src, rel, out, skipTop) {
    let st; try { st = fs.statSync(src); } catch (e) { return out; }
    if (st.isDirectory()) {
        for (const n of fs.readdirSync(src)) { if (skipTop && !rel && SKIP_AKKOME(n)) { out.skipped.push(n); continue; } walk(path.join(src, n), rel ? rel + '/' + n : n, out, skipTop); }
    } else out.files.push({ rel, size: st.size, mode: (st.mode & 0o777).toString(8), mtime: st.mtime.toISOString().slice(0, 16) });
    return out;
}
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n >= 1024 ? Math.round(n / 1024) + 'KB' : n + 'B';

function scan() {
    return ITEMS.map(([name, src, dest, perm, memo]) => {
        const exists = fs.existsSync(src), isDir = exists && fs.statSync(src).isDirectory();
        const r = walk(src, '', { files: [], skipped: [] }, src === path.join(HOME, '.akkome'));
        if (exists && !isDir) r.files[0].rel = path.basename(src);
        return { name, src, dest, perm, memo, exists, isDir, files: r.files, skipped: r.skipped, bytes: r.files.reduce((a, f) => a + f.size, 0) };
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

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const outDir = oi >= 0 ? args[oi + 1] : null;
const full = args.includes('--full');
const items = scan();
if (!outDir) {
    // 미리 보기 — 값 0
    let n = 0, b = 0;
    for (const it of items) {
        n += it.files.length; b += it.bytes;
        console.log(`\n■ ${it.name}${it.exists ? '' : '  🔴 없음'}\n  원본 ${it.src}\n  나스 /volume1/docker/akkome/${it.dest}  (권한 ${it.perm})\n  ${it.files.length}개 · ${kb(it.bytes)}${it.skipped.length ? ' · 뺌: ' + it.skipped.join(', ') : ''}${it.memo ? '\n  메모: ' + it.memo : ''}`);
        const show = full ? it.files : it.files.slice(0, 12);
        for (const f of show) console.log(`    ${f.mode}  ${kb(f.size).padStart(7)}  ${f.mtime}  ${f.rel}`);
        if (show.length < it.files.length) console.log(`    … ${it.files.length - show.length}개 더(--full)`);
    }
    if (fs.existsSync(path.join(HOME, '.claude.json'))) { try { console.log(`\n(.claude.json 사본에서 지울 aside MCP 줄: ${claudeJsonNoAside(path.join(HOME, '.claude.json')).removed}곳)`); } catch (e) { console.log('\n(.claude.json 읽기 실패: ' + e.message + ')'); } }
    console.log(`\n합계 ${items.length}묶음 · ${n}개 · ${kb(b)} · 없는 묶음 ${items.filter(i => !i.exists).length} — 미리 보기(복사 0). 모으기 = --out <빈 폴더>(총괄 지시 뒤)`);
    process.exit(0);
}
// 모으기 — 빈 폴더에만(덮어쓰기 0)
const OUT = path.resolve(outDir);
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) { console.log(JSON.stringify({ ok: false, error: '--out 폴더가 비어 있지 않습니다(덮어쓰지 않음): ' + OUT })); process.exit(1); }
let copied = 0, bytes = 0;
for (const it of items) {
    if (!it.exists) continue;
    for (const f of it.files) {
        const from = it.isDir ? path.join(it.src, ...f.rel.split('/')) : it.src;
        const to = it.isDir ? path.join(OUT, ...it.dest.split('/'), ...f.rel.split('/')) : path.join(OUT, ...it.dest.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (it.src === path.join(HOME, '.claude.json')) fs.writeFileSync(to, claudeJsonNoAside(from).text);
        else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
        copied++; bytes += f.size;
    }
}
console.log(JSON.stringify({ ok: true, out: OUT, copied, size: kb(bytes), 다음: '나스로 옮긴 뒤 sudo chown -R 1001:100 · .ssh 700 · 열쇠·키·.env·.credentials 600 (설계서 3-4절)' }));
