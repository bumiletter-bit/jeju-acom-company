// #470 창구 폴더를 「신뢰한 폴더」로 미리 등록한다 — 창이 열릴 때 확인 화면에서 멈추지 않게 (사람이 없어도 열리도록)
// 사용: node scripts/desk/trust-desk.js         (등록·확인)
//       node scripts/desk/trust-desk.js --check (확인만 · 0=등록됨 1=없음)
// 🔴 Claude Code가 ~/.claude.json 을 통째로 다시 쓰면서 이 항목이 지워질 수 있다 → 창을 열기 직전에 매번 확인한다(launcher가 그렇게 한다).
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(os.homedir(), '.claude.json');
const DESK_DIR = path.resolve(__dirname, '..', '..', '★에이전트오피스');
// 이 파일의 키는 슬래시 방향이 섞여 있다(둘 다 쓰인 흔적) → 두 가지 모두 넣어 어느 쪽으로 찾아도 걸리게 한다.
const KEYS = [DESK_DIR.split('\\').join('/'), DESK_DIR.split('/').join('\\')];

function read() {
    const raw = fs.readFileSync(FILE, 'utf8');
    const j = JSON.parse(raw);           // 깨진 파일이면 여기서 멈춘다(덮어쓰지 않는다)
    if (!j.projects) j.projects = {};
    return j;
}
function isTrusted(j) {
    return KEYS.some(k => j.projects[k] && j.projects[k].hasTrustDialogAccepted === true);
}
function ensure() {
    const j = read();
    if (isTrusted(j)) return { changed: false, keys: KEYS.filter(k => j.projects[k]) };
    for (const k of KEYS) {
        const p = j.projects[k] || {};
        p.hasTrustDialogAccepted = true;
        p.bypassPermissionsModeAccepted = true; // 「권한 건너뛰기」 경고도 미리 받아 둔다
        if (!Array.isArray(p.allowedTools)) p.allowedTools = [];
        if (!Array.isArray(p.history)) p.history = [];
        j.projects[k] = p;
    }
    const tmp = FILE + '.akkome.tmp';
    fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
    fs.renameSync(tmp, FILE);            // 같은 디스크 = 한 번에 바뀐다(반쯤 쓰인 파일이 남지 않는다)
    return { changed: true, keys: KEYS };
}

if (require.main === module) {
    try {
        if (process.argv.includes('--check')) {
            const ok = isTrusted(read());
            console.log(JSON.stringify({ trusted: ok, dir: DESK_DIR }));
            process.exit(ok ? 0 : 1);
        }
        const r = ensure();
        console.log(JSON.stringify(Object.assign({ dir: DESK_DIR }, r)));
    } catch (e) { console.error('ERR', e.message); process.exit(2); }
}
module.exports = { ensure, isTrusted, read, DESK_DIR };
