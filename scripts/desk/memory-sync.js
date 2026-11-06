// #1043 총괄 메모리 노트북 ↔ 나스 양방향 자동 맞추기(대표 11/6 「나스 터미널에서 처리한 것도 노트북 터미널로 이어지도록」)
//   노트북 = ~/.claude/projects/C--Users-----OneDrive------------------/memory · 나스 = /volume1/docker/akkome/home/.claude/projects/-work/memory(컨테이너 akkome 1001:100)
//   손 명령:
//     node scripts/desk/memory-sync.js --dry            미리 보기(메모리 파일·나스 쓰기 0 · 지난 수동 보내기(.pending) 확정만 될 수 있음 = pack-keys --pull 미리 보기와 같음)
//     node scripts/desk/memory-sync.js                  한 번 맞추기(받기 + 보내기)
//     node scripts/desk/memory-sync.js --force a.md,b.md   「확인필요」 파일을 노트북 것으로 나스에 덮기(노트북 파일에 손으로 합친 뒤)
//     🔴 켜는 순서 = 서버 틱(memory_sync_alert · v5.9.718) 배포 → --enable
//     node scripts/desk/memory-sync.js --enable | --disable | --status   2분 자동(노트북 작업 「아꼼이-노트북-알림」 --tick 이 --auto 로 부름) 켜기·끄기·상태
//   자동(--auto) = 켜져 있을 때만 · 출력 0 · 받기·보내기 있으면 ~/.akkome/logs/memory-sync-YYYY-MM-DD.log 한 줄 · 확인필요만 남은 틱 = 알림 보낸 틱·그날 첫 틱만 ·
//     멈춤(.pending·기록 없음) = 그날 한 줄 · 나스 안 닿으면 그날 첫 실패만 한 줄(그 뒤 30번마다)
//   🔴 수동 pack-keys --only memory --out 뒤 꾸러미를 나스에 넣기 전까지(.pending) 자동·손 실행 모두 쓰기 0 으로 멈춤
// 판정(파일마다 · 기준 = 맞추기 기록 ~/.akkome/memory-sync.json 의 hashes(지난번 양쪽이 같았던 내용) · files(알던 이름) — pack-keys.js 와 같은 기록):
//   · 양쪽 같음 → 아무것도 안 함(2분마다 돌아도 나스 쪽 해시 목록 한 번 읽기뿐)
//   · 기준 있고 나스만 바뀜 → 받기 · 노트북만 바뀜 → 보내기(나스에 넣고 chown 1001:100 · chmod 600) · 둘 다 바뀜 → 「확인필요」(덮지 않음)
//   · 기준 없음(양쪽 다 있는데 내용 다름) → 「확인필요(기준 없음)」(수정 시각으로 고르지 않음 · 자동이라 보수적으로)
//   · 나스에만 있음 → 기록 files 에 있었으면 「노트북에서 지운 것」(안 되살림 · 나스 것도 안 지움) · 없었으면 나스에서 새로 쓴 것 → 받기
//   · 노트북에만 있음 → 기준 해시가 있고 노트북이 그대로면 「나스에서 지운 것」(안 보냄 · 노트북 것도 안 지움) · 그 밖 → 보내기
//   · 기록이 아예 없으면 아무것도 안 함(「먼저 수동 맞추기」) · 점(.) 파일은 안 다룸(나스 표식 .akm-memory-sync.json)
//   「확인필요」 = 텔레그램 1통(하루 1번 · 파일 이름만) = 전용 DB 표식 agent_office_config 'memory_sync_alert' {at, host, count, files(최대 10)} 를 넣음(이미 있으면 안 덮음) → 서버 1분 틱이 보내고 지움(v5.9.718) · 상태줄엔 안 올림
// 접속 = pack-keys.js 그대로(나스 user1 · 비번 ~/.akkome/nas.txt · sudo -S · 화면·로그에 비번 0). 해시·판정·기록 함수도 pack-keys.js 것을 require.
// 시험 = scripts/verify-1043-memory-sync.js(가짜 폴더 두 개 · 실나스 0 · env PACK_KEYS_LOCAL_MEM · PACK_KEYS_SYNC_STATE · MEMORY_SYNC_DIR · --fake-remote <폴더>)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const pk = require('./pack-keys.js');
const DIR = process.env.MEMORY_SYNC_DIR || path.join(os.homedir(), '.akkome');
const AUTO = path.join(DIR, 'memory-sync-auto.json');   // { enabled, alertDay, failDay, failN }
const LOCK = path.join(DIR, 'memory-sync.lock');
const LOG_DIR = path.join(DIR, 'logs');
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString();
const visible = n => !n.startsWith('.');
const HOST_TAG = (os.hostname().replace(/[^A-Za-z0-9]/g, '') || 'pc').slice(0, 24);

function readAuto() { try { return JSON.parse(fs.readFileSync(AUTO, 'utf8')); } catch (e) { return {}; } }
function writeAuto(o) { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(AUTO, JSON.stringify(o)); } catch (e) { /* 무시 */ } }
function logLine(msg) { try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(path.join(LOG_DIR, `memory-sync-${kst().slice(0, 10)}.log`), kst().slice(0, 19) + ' ' + msg + '\n'); } catch (e) { /* 무시 */ } }

// 작은 ustar 묶음(이름 ≤100바이트 · 권한 600 · 소유 1001:100 · 수정 시각 그대로) — 나스 GNU tar 가 풂
function tarPack(entries) {
    const out = [];
    const oct = (n, len) => Buffer.from(n.toString(8).padStart(len - 1, '0') + '\0', 'ascii');
    for (const e of entries) {
        const h = Buffer.alloc(512), nb = Buffer.from(e.name, 'utf8');
        if (nb.length > 100) throw new Error('파일 이름이 100바이트를 넘음: ' + e.name);
        nb.copy(h, 0); oct(0o600, 8).copy(h, 100); oct(1001, 8).copy(h, 108); oct(100, 8).copy(h, 116);
        oct(e.buf.length, 12).copy(h, 124); oct(Math.floor(e.mtime / 1000), 12).copy(h, 136);
        h.fill(0x20, 148, 156); h[156] = 0x30; Buffer.from('ustar\u000000', 'ascii').copy(h, 257);
        let sum = 0; for (const b of h) sum += b;
        Buffer.from(sum.toString(8).padStart(6, '0') + '\0 ', 'ascii').copy(h, 148);
        out.push(h, e.buf, Buffer.alloc((512 - (e.buf.length % 512)) % 512));
    }
    out.push(Buffer.alloc(1024));
    return Buffer.concat(out);
}

// 나스 쪽 = { list() → Map(이름 → {m,h}) + .mark · fetch(names, dir) · put(entries[{name,buf,mtime}]) }
function realRemote() {
    return {
        list: () => pk.nasMem(),
        fetch: (names, dir) => pk.nasFetch(names, dir),
        async put(entries) {
            // ①user1 의 /tmp 에 묶음 올리기(sudo 없음 = 표준 입력에 비번이 섞이지 않음) ②sudo 로 memory 폴더에 풀고 소유·권한 맞춘 뒤 묶음 지움
            //   임시 파일 이름에 이 컴퓨터 이름 → 시작 때 지난 회차(자체 30초 종료 등) 잔재를 이 컴퓨터 것만 지움(잠금 파일로 같은 컴퓨터 동시 실행 0)
            const tag = HOST_TAG;
            const tmp = (await pk.nasExec(`sh -c 'rm -f /tmp/akm-mem-${tag}-*; f=$(mktemp /tmp/akm-mem-${tag}-XXXXXX) && cat > "$f" && echo "$f"'`, false, false, tarPack(entries))).trim();
            if (!new RegExp('^/tmp/akm-mem-' + tag + '-[A-Za-z0-9]+$').test(tmp)) throw new Error('나스 임시 파일 경로가 이상함');
            await pk.nasExec(`sh -c 'tar -xf ${tmp} -C ${pk.NAS_MEM} --no-same-owner --no-overwrite-dir && chown 1001:100 ${pk.NAS_MEM}/* ${pk.NAS_MEM}/${pk.MARK} && find ${pk.NAS_MEM} -maxdepth 1 -type f -exec chmod 600 {} +; rc=$?; rm -f ${tmp}; exit $rc'`, true);
        },
    };
}
function fakeRemote(dir) {   // 시험용 — 나스 대신 로컬 폴더
    return {
        async list() {
            const m = new Map(fs.readdirSync(dir).filter(n => visible(n) && fs.statSync(path.join(dir, n)).isFile()).map(n => { const p = path.join(dir, n); return [n, { m: Math.floor(fs.statSync(p).mtimeMs / 1000) * 1000, h: pk.sha(fs.readFileSync(p)) }]; }));
            try { m.mark = JSON.parse(fs.readFileSync(path.join(dir, pk.MARK), 'utf8')); } catch (e) { m.mark = null; }
            return m;
        },
        async fetch(names, to) { for (const n of names) fs.copyFileSync(path.join(dir, n), path.join(to, n)); },
        async put(entries) { for (const e of entries) { const p = path.join(dir, e.name); fs.writeFileSync(p, e.buf); const t = new Date(Math.floor(e.mtime / 1000) * 1000); fs.utimesSync(p, t, t); } },
    };
}

async function dbAlert(info) {   // 전용 표식 'memory_sync_alert' — 서버 1분 틱이 텔레그램 1통 뒤 지움 · 이미 있으면 덮지 않음
    const { pool } = require('./_db.js');
    try {
        const r = await pool.query(`INSERT INTO agent_office_config (key, value, updated_at) VALUES ('memory_sync_alert', $1::jsonb, NOW()) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(info)]);
        return r.rowCount > 0;
    } finally { try { await pool.end(); } catch (e) { /* 무시 */ } }
}

// 한 번 맞추기 — opts { remote, dry, force:[이름], alert(text) → Promise<bool> }
async function syncOnce(opts) {
    const remote = opts.remote, force = opts.force || [], dry = !!opts.dry;
    const nas0 = await remote.list();
    const nas = new Map([...nas0].filter(([n]) => visible(n))); nas.mark = nas0.mark;
    const pend = pk.promotePending(nas);   // 지난 수동 보내기(pack-keys --out)가 나스에 들어갔는지 먼저 확정
    const st = pk.memState();
    const local = new Map([...pk.localMem()].filter(([n]) => visible(n)));
    const r = { same: [], pull: [], push: [], conflict: [], conflict_nobase: [], forced: [], nas_new: [], deleted_on_laptop: [], deleted_on_nas: [], laptop_new: [] };
    // 🔴 수동 보내기(pack-keys --only memory --out)가 아직 나스에 안 들어감(.pending) = 쓰기 0 으로 멈춤 — 여기서 기준을 올리면, 그 뒤 꾸러미가 나스에 들어갈 때
    //   나스 옛 파일이 「나스만 바뀜」으로 보여 노트북 최신 편집이 조용히 되돌아간다(#1043 워커3 교차 점검) · 나스에 넣으면 다음 회차 promotePending 이 확정하고 풀림
    if (fs.existsSync(pk.SYNC_PENDING)) return { ok: false, pending: true, mode: dry ? 'dry' : 'run', error: '수동 보내기 대기 중(.pending) — 꾸러미를 나스에 넣은 뒤 다음 회차', nas: nas.size, laptop: local.size, 지난보내기: pend || '없음' };
    if (!st) return { ok: false, mode: dry ? 'dry' : 'run', error: '맞추기 기록 없음(~/.akkome/memory-sync.json) — 먼저 pack-keys.js 로 수동 맞추기 1회', nas: nas.size, laptop: local.size, 지난보내기: pend || '없음' };
    for (const n of new Set([...local.keys(), ...nas.keys()])) {
        const l = local.get(n), v = nas.get(n), base = st.hashes[n];
        if (l && v) {
            if (l.h === v.h) { r.same.push(n); continue; }
            const j = base ? pk.judge(l, v, base) : 'nobase';
            if (j === 'take') r.pull.push(n);
            else if (j === 'keep') r.push.push(n);
            else if (force.includes(n)) { r.forced.push(n); r.push.push(n); }
            else (j === 'nobase' ? r.conflict_nobase : r.conflict).push(n);
        } else if (v) {
            if (st.files.has(n)) r.deleted_on_laptop.push(n); else { r.nas_new.push(n); r.pull.push(n); }
        } else {
            if (base && l.h === base) r.deleted_on_nas.push(n); else { r.laptop_new.push(n); r.push.push(n); }
        }
    }
    const sum = {
        ok: true, mode: dry ? 'dry' : 'run', nas: nas.size, laptop: local.size, 같음: r.same.length,
        받기: r.pull, 보내기: r.push, 확인필요_양쪽바뀜: r.conflict, 확인필요_기준없음: r.conflict_nobase, force_노트북것보냄: r.forced,
        나스에서새로씀: r.nas_new, 노트북에서새로씀: r.laptop_new, 노트북에서지움_안되살림: r.deleted_on_laptop, 나스에서지움_안보냄: r.deleted_on_nas,
        지난보내기: pend || '없음',
    };
    if (dry) return sum;
    const changed = r.pull.length || r.push.length;
    if (r.pull.length) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akm-msync-'));
        try {
            await remote.fetch(r.pull, tmp);
            for (const n of r.pull) { const dst = path.join(pk.LOCAL_MEM, n); fs.copyFileSync(path.join(tmp, n), dst); const t = new Date(nas.get(n).m); fs.utimesSync(dst, t, t); }
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    const nasAfter = new Map(nas);
    if (changed) {   // 보낼 파일 + 표식(.akm-memory-sync.json · 받기만 했어도 갱신)
        const entries = r.push.map(n => { const p = path.join(pk.LOCAL_MEM, n); return { name: n, buf: fs.readFileSync(p), mtime: fs.statSync(p).mtimeMs }; });
        const now = Date.now();
        entries.push({ name: pk.MARK, buf: Buffer.from(JSON.stringify({ id: require('crypto').randomBytes(8).toString('hex'), at: new Date(now).toISOString(), how: 'auto', host: os.hostname() })), mtime: now });
        await remote.put(entries);
        for (const n of r.push) nasAfter.set(n, { m: fs.statSync(path.join(pk.LOCAL_MEM, n)).mtimeMs, h: local.get(n).h });
    }
    pk.memSyncSave('auto', { local: new Map([...pk.localMem()].filter(([n]) => visible(n))), nas: nasAfter }, r.deleted_on_laptop);
    const need = [...r.conflict, ...r.conflict_nobase];
    if (need.length && opts.alert) {
        const a = readAuto(), day = kst().slice(0, 10);
        if (a.alertDay !== day) {
            const info = { at: new Date().toISOString(), host: os.hostname(), count: need.length, files: need.slice(0, 10) };
            let sent = false; try { sent = await opts.alert(info); } catch (e) { sent = false; }
            if (sent) writeAuto(Object.assign(readAuto(), { alertDay: day }));
            sum.알림 = sent ? '보냄' : '못 보냄(표식이 이미 있거나 DB 실패)';
        } else sum.알림 = '오늘 이미 보냄';
    }
    return sum;
}

function takeLock() {
    try { fs.mkdirSync(DIR, { recursive: true }); const fd = fs.openSync(LOCK, 'wx'); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return true; }
    catch (e) {
        try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 3 * 60e3) { fs.unlinkSync(LOCK); return takeLock(); } } catch (e2) { /* 무시 */ }
        return false;
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const fi = args.indexOf('--force'), fr = args.indexOf('--fake-remote');
    const force = fi >= 0 ? String(args[fi + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : [];
    const fake = fr >= 0 ? args[fr + 1] : process.env.MEMORY_SYNC_FAKE_REMOTE;
    const auto = args.includes('--auto'), dry = args.includes('--dry');
    if (args.includes('--enable') || args.includes('--disable')) {
        const on = args.includes('--enable'); writeAuto(Object.assign(readAuto(), { enabled: on, changed_at: new Date().toISOString() }));
        console.log(JSON.stringify({ ok: true, 자동: on ? '켬(노트북 작업 「아꼼이-노트북-알림」 2분마다)' : '끔' }));
        process.exit(0);
    }
    if (args.includes('--status')) { const a = readAuto(); console.log(JSON.stringify({ 자동: a.enabled ? '켬' : '끔', 마지막알림: a.alertDay || '없음', 오늘실패: a.failDay === kst().slice(0, 10) ? a.failN : 0, 기록: fs.existsSync(pk.SYNC_STATE) ? pk.SYNC_STATE : '없음', 로그: path.join(LOG_DIR, 'memory-sync-<날짜>.log') }, null, 1)); process.exit(0); }
    if (auto && !readAuto().enabled) process.exit(0);   // 자동은 --enable 뒤에만(총괄 신호)
    if (!takeLock()) { if (!auto) console.log(JSON.stringify({ ok: false, error: '다른 맞추기가 도는 중(잠금 ' + LOCK + ')' })); process.exit(auto ? 0 : 1); }
    const kill = setTimeout(() => { try { fs.unlinkSync(LOCK); } catch (e) { /* 무시 */ } if (auto) logLine('실패: 30초 넘음'); else console.log(JSON.stringify({ ok: false, error: '30초 넘음' })); process.exit(auto ? 0 : 1); }, 30000);   // 노트북 작업 상한 1분 = 신호 10초 + 이것 30초(tick 은 35초 상한)
    syncOnce({ remote: fake ? fakeRemote(path.resolve(fake)) : realRemote(), dry, force, alert: (dry || fake) ? null : dbAlert }).then(sum => {
        if (auto) {
            const a = readAuto();
            if (a.failDay) writeAuto(Object.assign(a, { failDay: null, failN: 0 }));
            const day = kst().slice(0, 10), b = readAuto(), need = sum.ok ? sum.확인필요_양쪽바뀜.length + sum.확인필요_기준없음.length : 0;
            if (!sum.ok) { if (b.stopLogDay !== day + sum.error) { writeAuto(Object.assign(b, { stopLogDay: day + sum.error })); logLine('멈춤: ' + sum.error); } }
            else if (sum.받기.length || sum.보내기.length || (need && (sum.알림 === '보냄' || b.needLogDay !== day))) {
                if (need) writeAuto(Object.assign(b, { needLogDay: day }));
                logLine(`받기 ${sum.받기.join(',') || '0'} · 보내기 ${sum.보내기.join(',') || '0'}` + (sum.확인필요_양쪽바뀜.length + sum.확인필요_기준없음.length ? ` · 확인필요 ${[...sum.확인필요_양쪽바뀜, ...sum.확인필요_기준없음].join(',')}${sum.알림 ? ' (' + sum.알림 + ')' : ''}` : ''));
            }
        } else console.log(JSON.stringify(sum, null, 1));
    }).catch(e => {
        const msg = String(e && e.message || e).slice(0, 200);
        if (auto) {   // 나스 안 닿음 등 = 조용히 · 그날 첫 실패만 한 줄(그 뒤 30번마다)
            const a = readAuto(), day = kst().slice(0, 10), n = a.failDay === day ? (a.failN || 0) + 1 : 1;
            writeAuto(Object.assign(a, { failDay: day, failN: n }));
            if (n === 1 || n % 30 === 0) logLine(`실패(오늘 ${n}번째): ${msg}`);
        } else { console.log(JSON.stringify({ ok: false, error: msg })); process.exitCode = 1; }
    }).finally(() => { clearTimeout(kill); try { fs.unlinkSync(LOCK); } catch (e) { /* 무시 */ } });
}
module.exports = { syncOnce, fakeRemote, tarPack };
