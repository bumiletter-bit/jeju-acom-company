// #470 창구 대기 프로그램 — 이 PC에서 조용히 돌면서 직원 지시를 창구(클코)에게 넘긴다
//
//   왜 이렇게 만들었나(2026-09-29 실측):
//   ⓐ 터미널 창을 띄워 첫 문장을 자동으로 넣는 방법은 안 된다 — 창을 열면 문장이 입력칸에 적히기만 하고 Enter를 사람이 눌러야 한다.
//   ⓑ `claude --bg`(창 없는 배경 세션)는 그때그때 준 API 키를 무시하고 대표 로그인으로 돈다 → 회사 요금 분리가 깨진다.
//   ⓒ `claude -p`(창 없이 한 건 처리)는 준 API 키를 그대로 쓴다 → 이 방식으로 지시 1건마다 창구를 부른다.
//   ⓓ 창 안에서 돌던 감시(watch.js)는 PC 메모리가 모자라면 강제로 꺼진다(9/29 실사고) — 이 프로그램은 창 밖에서 돌아 그 영향을 안 받는다.
//
//   #498(대표 GO 2026-10-02) 빠르게: ①새 지시 확인 10초 → 2초 ②진행 상황·답변을 쓰는 대로 화면에 ③지시를 미리 받아 창구에 건넴
//   ④단순한 일은 빠른 모델(Sonnet)·판단과 창작은 Opus ⑤중간발주는 AI 없이 바로. 규칙 = scripts/desk/fast.js
//   되돌리기 = agent_office_config 'desk_fast' 를 {"off":true} 로(대기 프로그램을 다시 띄울 필요 없음 · 10초 안에 반영)
//
// 사용: node scripts/desk/launcher.js              (상주 — 설치는 install-launcher.js)
//       node scripts/desk/launcher.js --once       (지금 대기 중인 1건만 처리하고 끝 · 시험용)
//       node scripts/desk/launcher.js --dry        (실행하지 않고 무엇을 할지만 보기)
//       node scripts/desk/launcher.js --once --id 123 --sub   (시험: 그 지시 1건만 · --sub = 콘솔 키를 쓰지 않고 대표 요금제로 — 시험은 대표 요금제로 한다는 대표 확정 9/29)
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { pool, ROOT, heartbeat, appendStep } = require('./_db');
const { claim } = require('./get');
const fast = require('./fast');
const trust = require('./trust-desk');

const DESK_DIR = path.join(ROOT, '★에이전트오피스');
const KEY_FILE = path.join(os.homedir(), '.akkome', 'desk-api-key.txt');
const LOG_DIR = path.join(os.homedir(), '.akkome', 'logs');
const LOG = path.join(os.homedir(), '.akkome', 'launcher.log');
const LOCK_PORT = 47469;
const TICK_MS = 10000;                   // 상태 기록·화면 신호 확인 주기(종전 그대로)
const POLL_MS = 2000;                    // #498 새 지시 확인 주기
const BEAT_MS = parseInt(process.env.DESK_BEAT_MS, 10) || 30000;
const RUN_TIMEOUT_MS = 25 * 60 * 1000;   // 한 건이 이보다 오래 걸리면 멈춘 것으로 본다
const DIRECT_TIMEOUT_MS = 9 * 60 * 1000; // AI 없이 바로 처리하는 일의 한도
const MAX_TRY = 3;                       // 같은 지시를 이만큼 실패하면 오류로 돌린다
const REQ_TTL_MS = 300000;               // 이보다 오래된 화면 버튼 신호는 버린다
// 시험용: DESK_FAST='{"lean":false}' 처럼 주면 DB 설정 대신 이 값을 쓴다
let ENV_FAST = null; try { ENV_FAST = process.env.DESK_FAST ? JSON.parse(process.env.DESK_FAST) : null; } catch (e) { ENV_FAST = null; }
const FORCED_MODEL = process.env.AKKOME_MODEL || '';   // 주면 모델 나누기를 하지 않고 그 모델로만 돈다(시험용)
const MODEL = FORCED_MODEL || 'opus';
// 🔴 윈도에서 'claude' 는 PowerShell 껍데기라 그대로는 못 띄운다 → 진짜 실행 파일(claude.exe)을 찾아 쓴다.
function findClaude() {
    const c = [
        process.env.AKKOME_CLAUDE_EXE,
        path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
        path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    ].filter(Boolean);
    for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) { /* 다음 후보 */ } }
    return null;
}

function log(msg) {
    const line = new Date().toISOString() + ' ' + msg;
    try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + '\n'); } catch (e) { /* 기록 실패는 무시 */ }
    if (process.stdout.isTTY) console.log(line);
}
function trimLog() {
    try { const s = fs.statSync(LOG); if (s.size > 512 * 1024) fs.writeFileSync(LOG, fs.readFileSync(LOG, 'utf8').split('\n').slice(-400).join('\n')); } catch (e) { /* 없음 */ }
    // #498 지시별 기록이 진행 상황까지 담아 커졌다 → 14일 지난 것은 지운다
    try {
        for (const f of fs.readdirSync(LOG_DIR)) {
            if (!/^order-\d+\.log$/.test(f)) continue;
            const p = path.join(LOG_DIR, f);
            if (Date.now() - fs.statSync(p).mtimeMs > 14 * 86400e3) fs.unlinkSync(p);
        }
    } catch (e) { /* 폴더 없음 */ }
    // #598 A: 앞 판정 보관함에서 7일 지난 것을 덜어 낸다(시작할 때 + 하루 한 번) · 주인 없는 쪽지(하루 넘은 것)도 치운다
    try { const c = JSON.parse(fs.readFileSync(MEMO_CACHE, 'utf8')); const p = fast.memoCachePut(c, {}, []); if (Object.keys(p.items).length !== Object.keys(c.items || {}).length) fs.writeFileSync(MEMO_CACHE, JSON.stringify(p)); } catch (e) { /* 보관함 없음·깨짐 — 대조 때 없는 것으로 본다 */ }
    try { for (const f of fs.readdirSync(LOG_DIR)) { if (!/^memo-reuse-\d+\.json$/.test(f)) continue; const p = path.join(LOG_DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > 86400e3) fs.unlinkSync(p); } } catch (e) { /* 폴더 없음 */ }
}
async function cfgGet(key) {
    const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [key]);
    return r.rows[0] ? r.rows[0].value : null;
}
async function cfgSet(key, value) {
    await pool.query(
        `INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(value)]);
}
function readKey() {
    try {
        const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
        return /^sk-ant-/.test(k) ? k : null;
    } catch (e) { return null; }
}
// 창구에게 건네는 첫 문장 — 규칙은 ★에이전트오피스/CLAUDE.md 가 이미 담고 있다(여기선 무엇을 할지만 짚어 준다)
function promptFor(o) {
    return `새 지시 #${o.id} 가 들어왔습니다(${o.status}${o.has_image ? ' · 이미지 있음' : ''}).\n`
        + `CLAUDE.md의 「일하는 순서」대로 처리하세요: node scripts/desk/get.js ${o.id} 로 받고, 처리한 뒤 node scripts/desk/respond.js ${o.id} <결과.json> 으로 결과를 올립니다.\n`
        + `이 실행은 지시 한 건만 처리하고 끝납니다 — 감시(watch.js)는 돌리지 마세요. 결과를 올린 뒤 한 줄로 끝내면 됩니다.\n`
        + `get.js가 「이미 처리 중」이라고 하면 다른 창이 집어 간 것이니 아무것도 하지 말고 끝내세요.`;
}
// #498 미리 받아 둔 지시를 문장에 넣어 준다 — 창구가 get.js를 부르는 한 차례를 줄인다(내용은 get.js가 내주는 것과 같다)
//   #580 B: inl = fast.inlineFinalOrder() 결과(최종발주 규칙 문서·자료를 미리 읽은 것) — 있으면 그 글을 지시 바로 뒤에 싣는다(읽는 호출 1~2번이 준다)
function promptPrefetched(o, got, inl) {
    return `새 지시 #${o.id} 를 대기 프로그램이 이미 받아 두었습니다(상태는 이미 '처리중'). 아래가 get.js가 내주는 내용 그대로입니다 — get.js를 다시 부르지 마세요.\n`
        + '<지시>\n' + JSON.stringify(inl ? inl.got : got, null, 2) + '\n</지시>\n'
        + (inl ? inl.text : '')
        + `CLAUDE.md의 「일하는 순서」에서 받기 다음 단계부터 평소와 똑같이 처리하고, node scripts/desk/respond.js ${o.id} <결과.json> 으로 결과를 올립니다.\n`
        + `이 실행은 지시 한 건만 처리하고 끝납니다 — 감시(watch.js)는 돌리지 마세요. 결과를 올린 뒤 한 줄로 끝내면 됩니다.\n`
        + HINTS(o.id);
}
// 창구가 매번 헤매던 두 가지(결과 형식·조회 방법)를 미리 알려 준다 — 규칙은 그대로, 길만 짧게(워커 실측: 형식을 몰라 4차례·12초를 썼다)
function HINTS(id) {
    return `\n[빠르게 일하는 법]\n`
        + `· 결과 파일은 Write 도구로 ${path.join(ROOT, '.scratch' + id, 'result.json')} 에 씁니다(직원 화면에 쓰는 대로 보입니다). 맨 위 열쇠는 "kind" 입니다 — 답: {"kind":"answer","title":"한 줄 제목","answer":"답변 글","attachments":["파일 경로"]} · 되묻기: {"kind":"question","question":"…"} · 정산 이미지: {"kind":"ocr","partner":"거래처","items":[{"name":"품목","qty":수량}],"date":"YYYY-MM-DD"} · 그 밖(approval·refuse·error)은 respond.js 머리말 그대로.\n`
        + `· 회사프로그램 자료 조회는 node scripts/desk/q.js "SELECT …" 한 번이면 됩니다(읽기 전용 · 컬럼은 node scripts/desk/q.js --cols 테이블). 값을 바꾸는 일은 종전 도구·방법 그대로입니다.\n`
        + `· 짧아진 것은 길뿐입니다 — 확인·계산·대조는 종전과 똑같이 합니다(예: 박스재고는 업무지식의 계산 그대로, 저장된 값만 읽고 끝내지 않기). 날짜·시각은 SQL에서 한국 시각으로 바꿔 읽습니다.
`
        + `· 손님에게 나갈 문구에 발송일(「당일 발송」 등)을 적을 때는 발송휴무 달력을 먼저 확인하고, 업무지식에 확정된 사실(반품·보관·후숙 등)은 빠뜨리지 않습니다.
`
        + `· 누구·무엇·언제가 빠져 짐작해야 하는 지시는 answer로 닫지 말고 question(되묻기)으로 올립니다 — 직원 화면에 답 칸이 열립니다.
`
        + `· 답변은 한국어로, 평소 기준(업무지식.md) 그대로 씁니다.`;
}

const st = { active: false, busy: false, lastBeat: 0, tries: new Map(), handledReqAt: null, note: '', paused: false, lastDone: null, sub: false, onlyId: 0, forceWarm: false, lastSlow: 0, running: new Map(), directBusy: false, fast: fast.settings(null), key: null, planTried: new Set(), lastTrim: Date.now() };

function runDesk(order, key, opt) {  // key 가 null 이면 콘솔 키 없이(대표 요금제로) 돈다 · opt = { model, prompt, stream, runId, live }
    opt = opt || {};
    return new Promise(resolve => {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const outPath = path.join(LOG_DIR, `order-${order.id}.log`);
        const out = fs.openSync(outPath, 'a');
        const env = Object.assign({}, process.env);
        if (key) env.ANTHROPIC_API_KEY = key; else delete env.ANTHROPIC_API_KEY;
        // 🔴 문장은 반드시 맨 앞 — --add-dir 는 폴더를 여러 개 받는 옵션이라 뒤에 둔 문장을 폴더로 삼킨다(실측).
        const args = [opt.prompt || promptFor(order), '--model', opt.model || MODEL, '--dangerously-skip-permissions', '--add-dir', ROOT];
        if (opt.stream) args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages');
        // 가볍게: 대표 개인 설정(도구를 쓸 때마다 울리는 알림 훅·플러그인)과 외부 연결(MCP)을 창구 실행에서 뺀다.
        //   창구 규칙(★에이전트오피스의 CLAUDE.md·settings.json)은 그대로 읽는다 · 생각 깊이는 종전 값(high)을 그대로 준다.
        if (opt.lean) args.push('--setting-sources', 'project,local', '--strict-mcp-config');
        if (opt.effort) args.push('--effort', opt.effort);
        const exe = findClaude();
        if (!exe) { try { fs.closeSync(out); } catch (_) { } return resolve({ code: -1, err: 'claude 실행 파일을 찾지 못했습니다', outPath, info: {} });
        }
        const child = spawn(exe, args, { cwd: DESK_DIR, env, stdio: ['ignore', opt.stream ? 'pipe' : out, out], windowsHide: true });
        let done = false;
        const info = {};
        if (opt.stream) {
            // #498 도구 호출은 「지금 하는 일」 한 줄로, 답변 글은 적는 대로 미리 보여 준다(기록 실패는 처리에 영향 없음)
            const watcher = fast.streamWatcher({
                onStep: text => {
                    if (!opt.runId) return;
                    appendStep(opt.runId, 'work', text).then(() => heartbeat('busy', order.id)).catch(e => log('단계 기록 실패(무시): ' + e.message));
                },
                onLive: text => {
                    if (!opt.live) return;
                    pool.query(`UPDATE pending_orders SET result = $2 WHERE id = $1 AND status = '처리중'`,
                        [order.id, JSON.stringify({ type: 'live', text: String(text).slice(0, 20000) })]).catch(e => log('미리 보기 기록 실패(무시): ' + e.message));
                },
                onResult: r => { Object.assign(info, r); },
            });
            let buf = '';
            child.stdout.setEncoding('utf8');   // 한글이 조각 경계에서 깨지지 않게
            child.stdout.on('data', d => {
                try { fs.writeSync(out, d); } catch (_) { /* 기록 실패는 무시 */ }
                buf += d;
                let i;
                while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { watcher.line(line); } catch (e) { /* 한 줄 해석 실패는 무시 */ } }
            });
        }
        const finish = r => { if (done) return; done = true; clearTimeout(timer); try { fs.closeSync(out); } catch (_) { /* 이미 닫힘 */ } resolve(r); };
        const timer = setTimeout(() => {
            log(`#${order.id} 25분을 넘겨 중단`);
            try { child.kill(); } catch (e) { /* 이미 끝남 */ }
        }, RUN_TIMEOUT_MS);
        child.on('error', e => finish({ code: -1, err: e.message, outPath, info }));
        child.on('exit', code => finish({ code, outPath, info }));
    });
}

// ── #498 ③ 켜 둔 창구 — 지시마다 새로 켜지 않고, 한 번 켠 창구를 잠깐 살려 두었다가 다음 지시에 다시 쓴다
//   워커 실측(10/2): 살려 둔 프로세스도 준 키를 그대로 따르고(요금 분리 유지), 「/clear」를 넣으면 앞 대화를 잊는다(지시끼리 섞이지 않음).
//   요금·모델은 프로세스마다 정해지므로 (요금 종류 × 모델)별로 하나씩 둔다. 20분 동안 일이 없으면 끈다(메모리 약 230MB씩).
//   끄는 법: agent_office_config 'desk_fast' 에 {"warm":false}. 살려 둔 창구가 죽었거나 바쁘면 종전처럼 새로 켠다.
const warm = new Map();
const WARM_IDLE_MS = 20 * 60 * 1000;
const PARALLEL = Math.max(1, Math.min(8, parseInt(process.env.DESK_PARALLEL, 10) || 4));   // #503(대표 10/3 「창구 4개」): 동시에 돌리는 창구 수
const WARM_MAX = PARALLEL;
const warmKey = (key, model, effort) => (key ? 'key' : 'sub') + ':' + model + (effort ? ':' + effort : '');
function warmSpawn(key, model, lean, effort) {
    const exe = findClaude();
    if (!exe) return null;
    const env = Object.assign({}, process.env);
    if (key) env.ANTHROPIC_API_KEY = key; else delete env.ANTHROPIC_API_KEY;
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--model', model, '--dangerously-skip-permissions', '--add-dir', ROOT];
    if (lean) args.push('--setting-sources', 'project,local', '--strict-mcp-config');
    if (effort) args.push('--effort', effort);
    const child = spawn(exe, args, { cwd: DESK_DIR, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const w = { k: warmKey(key, model, effort), child, busy: false, dead: false, last: Date.now(), onLine: null, onExit: null, used: 0 };
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (w.onLine) { try { w.onLine(line); } catch (e) { /* 무시 */ } } }
    });
    const gone = () => { if (w.dead) return; w.dead = true; if (warm.get(w.k) === w) warm.delete(w.k); if (w.onExit) { try { w.onExit(); } catch (e) { /* 무시 */ } } };
    child.on('exit', gone);
    child.on('error', gone);
    child.stdin.on('error', () => { /* 이미 닫힌 창구에 쓰려 한 경우 — exit 가 처리한다 */ });
    warm.set(w.k, w);
    return w;
}
function warmSend(w, text) {
    w.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n');
}
function warmEnd(w) { try { w.child.stdin.end(); } catch (e) { /* 무시 */ } setTimeout(() => { if (!w.dead) { try { w.child.kill(); } catch (e) { /* 무시 */ } } }, 5000).unref(); }
function warmReap(all) {
    for (const w of warm.values()) if (!w.busy && (all || Date.now() - w.last > WARM_IDLE_MS)) { warm.delete(w.k); warmEnd(w); }
}
function runWarm(order, key, opt) {
    const model = opt.model || MODEL;
    let w = warm.get(warmKey(key, model, opt.effort));
    const reused = !!(w && !w.dead && !w.busy);
    if (!reused && !(w && w.busy)) {
        // 살려 두는 창구는 2개까지 — 넘으면 가장 오래 쉰 것을 끈다(메모리 아끼기)
        const idle = [...warm.values()].filter(x => !x.busy).sort((a, b) => a.last - b.last);
        while (warm.size >= WARM_MAX && idle.length) { const x = idle.shift(); warm.delete(x.k); warmEnd(x); }
    }
    if (!reused) w = (w && w.busy) ? null : warmSpawn(key, model, opt.lean, opt.effort);
    if (!w) return runDesk(order, key, opt);   // 살려 둔 창구가 바쁘거나 못 켰으면 종전 방식
    return new Promise(resolve => {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const outPath = path.join(LOG_DIR, `order-${order.id}.log`);
        const out = fs.openSync(outPath, 'a');
        const info = { warm: reused ? 'reused' : 'new' };
        let done = false;
        const finish = code => {
            if (done) return; done = true; clearTimeout(timer);
            try { fs.closeSync(out); } catch (_) { /* 이미 닫힘 */ }
            w.onExit = null;
            if (w.dead) { w.onLine = null; return resolve({ code, outPath, info }); }
            // 다음 지시와 섞이지 않게 앞 대화를 비운다 — 비우기가 끝나야 다시 쓸 수 있다(15초 안에 안 끝나면 끈다)
            const guard = setTimeout(() => { if (warm.get(w.k) === w) warm.delete(w.k); warmEnd(w); }, 15000);
            w.onLine = line => { if (line.includes('"type":"result"')) { clearTimeout(guard); w.onLine = null; w.busy = false; w.last = Date.now(); w.used++; } };
            try { warmSend(w, '/clear'); } catch (e) { clearTimeout(guard); if (warm.get(w.k) === w) warm.delete(w.k); warmEnd(w); }
            resolve({ code, outPath, info });
        };
        const watcher = fast.streamWatcher({
            onStep: text => { if (opt.runId) appendStep(opt.runId, 'work', text).then(() => heartbeat('busy', order.id)).catch(e => log('단계 기록 실패(무시): ' + e.message)); },
            onLive: text => {
                if (!opt.live) return;
                pool.query(`UPDATE pending_orders SET result = $2 WHERE id = $1 AND status = '처리중'`,
                    [order.id, JSON.stringify({ type: 'live', text: String(text).slice(0, 20000) })]).catch(e => log('미리 보기 기록 실패(무시): ' + e.message));
            },
            onResult: r => { Object.assign(info, r); finish(r.is_error ? 1 : 0); },
        });
        const timer = setTimeout(() => { log(`#${order.id} 25분을 넘겨 중단`); try { w.child.kill(); } catch (e) { /* 이미 끝남 */ } }, RUN_TIMEOUT_MS);
        w.busy = true;
        w.onLine = line => { try { fs.writeSync(out, line + '\n'); } catch (_) { /* 무시 */ } watcher.line(line); };
        w.onExit = () => finish(-1);
        try { warmSend(w, opt.prompt); } catch (e) { finish(-1); }
    });
}

// node 스크립트 한 개를 돌려 출력을 받는다(AI 없음)
function runNode(script, args, timeoutMs) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [path.join(__dirname, script)].concat(args || []), { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let out = '', err = '', done = false;
        const finish = code => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err }); };
        const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* 이미 끝남 */ } finish(-2); }, timeoutMs || 120000);
        child.stdout.on('data', d => { out += d.toString('utf8'); });
        child.stderr.on('data', d => { err += d.toString('utf8'); });
        child.on('error', e => { err += e.message; finish(-1); });
        child.on('exit', finish);
    });
}
// #498 ⑤ 중간발주 — AI 없이 바로: 회사프로그램과 같은 집계·그림(qty-image.js)을 돌려 결과만 올린다(콘솔 요금 0)
async function runDirectQty(order, got) {
    const say = t => got.run_id ? appendStep(got.run_id, 'work', t).catch(() => { }) : null;
    await say('📦 중간발주 집계 중 — 3채널 주문을 불러와요 (AI 없이 바로 · 1~2분)');
    const r = await runNode('qty-image.js', [], DIRECT_TIMEOUT_MS);
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const resFile = path.join(LOG_DIR, `direct-${order.id}.json`);
    let payload;
    if (r.code === 0) {
        try { const a = fast.qtyAnswer(r.out); payload = { kind: 'answer', title: a.title, answer: a.answer, attachments: a.attachments }; }
        catch (e) { payload = { kind: 'error', error: '중간발주 집계 결과를 정리하지 못했어요: ' + e.message }; }
    } else {
        const why = (r.err || r.out || '').split(/\r?\n/).filter(Boolean).slice(-1)[0] || (r.code === -2 ? '시간이 너무 오래 걸렸어요' : '알 수 없는 오류');
        payload = { kind: 'error', error: '중간발주를 집계하지 못했어요 — ' + String(why).replace(/^ERR\s*/, '').slice(0, 300) + ' (잠시 뒤 다시 눌러 주세요. 송장변환 > 중간발주에서도 바로 볼 수 있어요)' };
    }
    fs.writeFileSync(resFile, JSON.stringify(payload));
    const up = await runNode('respond.js', [String(order.id), resFile], 120000);
    if (up.code !== 0) log(`#${order.id} 바로 처리 결과 올리기 실패: ${(up.err || up.out).slice(0, 200)}`);
    return { code: up.code === 0 ? 0 : 1, outPath: resFile, info: { direct: true } };
}

// ── #598 A: 최종발주 메모 읽기 — 앞서 판정한 같은 메모는 다시 묻지 않는다(규칙·열쇠 = fast.memoPlan · 끄기 = desk_fast {"memo_reuse":false})
//   앞 판정 보관함 = ~/.akkome/memo-reuse.json(7일 · 열쇠는 해시). 서버는 결과를 화면이 받아 가면 지우므로(손님 글 보관 안 함) DB 에는 앞 판정이 없다.
//   돌려주는 값: null(재사용 안 함 · 종전대로) / { all:true, payload }(새 메모 0건 → AI 없이 바로) / { part:true }(새 메모만 자료 파일에 남김 · 합치기는 respond.js)
const MEMO_CACHE = path.join(os.homedir(), '.akkome', 'memo-reuse.json');
const memoSide = id => path.join(LOG_DIR, 'memo-reuse-' + id + '.json');
function memoPrepare(order, got) {
    const fm = got.final_order_memo;
    try { fs.unlinkSync(memoSide(order.id)); } catch (e) { /* 앞 시도의 쪽지 없음 */ }
    const payload = JSON.parse(fs.readFileSync(fm.payload_path, 'utf8'));
    if (payload.type !== 'fo_memo' || !Array.isArray(payload.items) || !payload.items.length) return null;
    const rules = fs.readFileSync(fm.rules, 'utf8');
    let cache = null; try { if (fs.existsSync(MEMO_CACHE)) cache = JSON.parse(fs.readFileSync(MEMO_CACHE, 'utf8')); } catch (e) { cache = null; log(`#${order.id} 앞 판정 보관함을 읽지 못함 — 전부 새로 읽음: ${e.message}`); }
    const plan = fast.memoPlan(payload, cache, rules, Date.now());
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (!plan.fresh.length) {
        const items = plan.reused;
        return { all: true, n: items.length, payload: { kind: 'answer', title: `메모 ${items.length}건 읽음`, answer: `${fast.memoSummary(items)} (앞 판정 재사용 ${items.length}건)`, data: { items } } };
    }
    // 쪽지: 이번에 읽은 판정을 보관함에 넣을 열쇠 + 합칠 앞 판정(없으면 빈 목록 — 보관만 한다)
    fs.writeFileSync(memoSide(order.id), JSON.stringify({ keys: plan.keys, reused: plan.reused, order: plan.order, total: plan.total }));
    if (!plan.reused.length) return { part: true, reused: 0, fresh: plan.fresh.length };
    fs.writeFileSync(fm.payload_path, JSON.stringify(Object.assign({}, payload, { items: plan.fresh }), null, 1));   // 새 메모만(원래 i 그대로)
    fm.count = plan.fresh.length;
    return { part: true, reused: plan.reused.length, fresh: plan.fresh.length };
}
async function runMemoReuse(order, got, m) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const resFile = path.join(LOG_DIR, `direct-${order.id}.json`);
    fs.writeFileSync(resFile, JSON.stringify(m.payload));
    const up = await runNode('respond.js', [String(order.id), resFile], 120000);
    try { fs.unlinkSync(resFile); } catch (e) { /* 무시 */ }   // 판정 글이 들어 있어 남기지 않는다
    try { fs.unlinkSync(got.final_order_memo.payload_path); } catch (e) { /* 이미 없음 */ }
    if (up.code !== 0) log(`#${order.id} 앞 판정 재사용 결과 올리기 실패: ${(up.err || up.out).slice(0, 200)}`);
    return { code: up.code === 0 ? 0 : 1, outPath: '', info: { direct: true } };
}

// ── #598 B: 되묻기에 실어 둔 명령(result.plan) — 답이 화면 버튼 글 「[이대로 진행]」이면 AI 없이 그 명령만 실행(끄기 = desk_fast {"plan":false})
//   조건(하나라도 아니면 null → 종전 AI 길): 원 지시가 창구의 되묻기(clarify) · plan 이 허용 목록 통과 · 원 지시와 답 모두 대표 계정(승인 없이 바로 실행하는 계정 — get.js from_role admin 과 같은 기준)
//   · 그 되묻기에 「[이대로 진행]」을 실행한 적이 없음(두 번 보내는 일 방지). 직원 지시는 종전대로 AI → 승인 흐름.
async function planLookup(order) {
    if (!order.reply_to || order.has_image || order.status !== '대기' || !fast.planGo(order.content)) return null;
    const p = (await pool.query(`SELECT id, status, result, created_by_id FROM pending_orders WHERE id = $1 AND is_deleted = false`, [order.reply_to])).rows[0];
    if (!p || !p.result || p.result.type !== 'clarify' || !['질문', '질문종결'].includes(p.status)) return null;
    const chk = fast.planCheck(p.result.plan);
    if (!chk.ok) { if (p.result.plan) log(`#${order.id} 정해 둔 명령을 쓰지 않음 — ${chk.why} (종전 AI 길)`); return null; }
    if (!order.created_by_id || !p.created_by_id) return null;
    const us = (await pool.query(`SELECT id FROM users WHERE id = ANY($1::int[]) AND deleted_at IS NULL AND role = 'admin' AND position = '대표'`, [[order.created_by_id, p.created_by_id]])).rows.map(r => Number(r.id));
    if (!us.includes(Number(order.created_by_id)) || !us.includes(Number(p.created_by_id))) return null;
    // 두 번 실행 방지: 같은 되묻기에 이미 실행한 답이 있거나(버튼 두 번), 이 지시가 실행 도중 끊긴 적이 있으면 다시 돌리지 않고 알린다
    const dup = (await pool.query(`SELECT id FROM pending_orders WHERE (reply_to = $1 OR id = $2) AND is_deleted = false AND result->>'plan_run' = 'yes' ORDER BY id LIMIT 1`, [p.id, order.id])).rows[0];
    if (dup || st.planTried.has(order.id)) return Object.assign(chk, { stop: dup && Number(dup.id) !== Number(order.id) ? `이 확인의 명령(${chk.label})은 앞에서 이미 실행했어요. 다시 실행하지 않았어요 — 더 필요한 것이 있으면 글로 지시해 주세요.` : `「${chk.label}」 실행이 도중에 끊겼어요. 어디까지 됐는지 모르므로 다시 실행하지 않았어요 — 상태를 확인해 달라고 글로 지시해 주세요.` });
    return chk;
}
function runScript(script, args, timeoutMs) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [path.join(__dirname, script)].concat(args), { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });   // 셸을 거치지 않는다(인자 배열 그대로)
        let out = '', err = '', done = false;
        const finish = code => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err }); };
        const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* 이미 끝남 */ } finish(-2); }, timeoutMs);
        child.stdout.on('data', d => { out += d.toString('utf8'); if (out.length > 400000) out = out.slice(-200000); });
        child.stderr.on('data', d => { err += d.toString('utf8'); if (err.length > 400000) err = err.slice(-200000); });
        child.on('error', e => { err += e.message; finish(-1); });
        child.on('exit', finish);
    });
}
async function runPlan(order, got, plan) {
    if (plan.stop) {
        const rf = path.join(LOG_DIR, `direct-${order.id}.json`); fs.mkdirSync(LOG_DIR, { recursive: true }); fs.writeFileSync(rf, JSON.stringify({ kind: 'error', error: plan.stop }));
        const u = await runNode('respond.js', [String(order.id), rf], 120000);
        return { code: u.code === 0 ? 0 : 1, outPath: rf, info: { direct: true } };
    }
    st.planTried.add(order.id);
    const say = t => got.run_id ? appendStep(got.run_id, 'work', t).catch(() => { }) : null;
    // 실행을 시작했다는 표시를 먼저 남긴다 — 도중에 꺼져도 같은 명령을 두 번 돌리지 않게(다시 시도는 AI 길로 간다)
    await pool.query(`UPDATE pending_orders SET result = $2 WHERE id = $1 AND status = '처리중'`, [order.id, JSON.stringify({ type: 'live', text: `실행 중: ${plan.label}`, plan_run: 'yes' })]);
    const runs = [];
    for (const [i, c] of plan.cmds.entries()) {
        await say(`▶ ${plan.label} (${i + 1}/${plan.cmds.length}) — AI 없이 정해 둔 명령 그대로`);
        const args = c.args.map(a => a === '{id}' ? String(order.id) : a);
        const r = await runScript(c.script, args, RUN_TIMEOUT_MS - 60000);
        runs.push({ script: c.script, args, code: r.code, out: r.out, err: r.err });
        log(`#${order.id} 정해 둔 명령 ${i + 1}/${plan.cmds.length} ${c.script} ${args[0] || ''} → exit ${r.code}`);
        if (r.code !== 0) break;
    }
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const resFile = path.join(LOG_DIR, `direct-${order.id}.json`);
    fs.writeFileSync(resFile, JSON.stringify(fast.planAnswer(plan.label, runs, plan.cmds.length)));
    const up = await runNode('respond.js', [String(order.id), resFile], 120000);
    if (up.code !== 0) log(`#${order.id} 정해 둔 명령 결과 올리기 실패: ${(up.err || up.out).slice(0, 200)}`);
    else await pool.query(`UPDATE pending_orders SET result = result || '{"plan_run":"yes"}'::jsonb WHERE id = $1`, [order.id]).catch(() => { });
    return { code: up.code === 0 ? 0 : 1, outPath: resFile, info: { direct: true } };
}

// #474 요금 나누기(대표 확정 2026-09-30): 대표 본인 계정이 넣은 지시 = 이 PC에 로그인된 대표 요금제(키 없이 실행),
//   그 밖의 모든 지시(조가영 포함) = 콘솔 API 키. 개인 요금제는 본인 것만 처리해야 하기 때문이다.
//   누가 대표인지 = agent_office_config 'desk_subscription_users' {ids:[...]} · 없으면 username 'admin' 한 명.
let subIds = null, subAt = 0;
async function subscriptionUsers() {
    if (subIds && Date.now() - subAt < 300000) return subIds;
    try {
        const c = await cfgGet('desk_subscription_users');
        if (c && Array.isArray(c.ids) && c.ids.length) subIds = new Set(c.ids.map(Number));
        else subIds = new Set((await pool.query(`SELECT id FROM users WHERE username = 'admin' AND deleted_at IS NULL`)).rows.map(r => r.id));
    } catch (e) { subIds = subIds || new Set(); }
    subAt = Date.now();
    return subIds;
}

const ORDER_COLS = `o.id, o.status, o.created_by, o.created_by_id, (o.image_data IS NOT NULL) AS has_image, o.content, o.reply_to, o.file_name,
                    (SELECT p.content FROM pending_orders p WHERE p.id = o.reply_to) AS parent_content`;
async function nextOrder(onlyId) {
    const busyUsers = new Set([...st.running.values()].map(x => Number(x.by)));
    // #580 C: 그 사람의 돌고 있는 일이 전부 「정산 이미지 판독」이고 새 지시도 정산 이미지면 같이 돌린다(끄기 = desk_fast {"settlepar":false})
    const mixedUsers = new Set([...st.running.values()].filter(x => !x.settle).map(x => Number(x.by)));
    const sameUserBusy = o => o.created_by_id != null && busyUsers.has(Number(o.created_by_id))
        && !(!st.fast.off && st.fast.settlepar && fast.settleImage(o) && !mixedUsers.has(Number(o.created_by_id)));
    const blocked = o => st.running.has(o.id) || sameUserBusy(o)
        || (st.directBusy && !st.fast.off && st.fast.direct && fast.route(o, null).lane === 'direct_qty');
    if (onlyId) {
        const one = await pool.query(
            `SELECT ${ORDER_COLS} FROM pending_orders o WHERE o.id = $1 AND o.is_deleted = false AND o.status IN ('대기', '승인됨')`, [onlyId]);
        const o = one.rows[0] || null;
        return o && !blocked(o) ? o : null;
    }
    const r = await pool.query(
        `SELECT ${ORDER_COLS} FROM pending_orders o
         WHERE o.is_deleted = false AND o.status IN ('대기', '승인됨')
           AND o.content NOT LIKE '[검증469]%'
         ORDER BY (o.status = '승인됨') DESC, o.id ASC LIMIT 20`);
    // #503 같은 사람의 지시는 한 번에 하나(이어서 지시가 앞 답을 받아야 하므로 차례를 지킨다) · 돌고 있는 건 제외 · 중간발주(바로 처리)는 조회 통로가 하나라 한 번에 하나
    for (const o of r.rows) if (!blocked(o)) return o;
    return null;
}

async function writeState() {
    await cfgSet('desk_launcher', {
        at: new Date().toISOString(), host: os.hostname(), on: !!st.active, busy: st.running.size > 0, running: [...st.running.keys()], parallel: PARALLEL, note: st.note,
        last_done: st.lastDone, handled_req_at: st.handledReqAt, mode: 'headless', fast: st.fast.off ? 'off' : 'on',
    });
}

const firstRunning = () => { const it = st.running.keys().next(); return it.done ? null : it.value; };
async function handle(order, key) {
    st.running.set(order.id, { by: order.created_by_id, at: Date.now(), settle: fast.settleImage(order) });   // settle = 정산 이미지 판독(#580 C)
    await heartbeat('busy', firstRunning() || order.id);
    await writeState();
    // #475 처리하는 동안에도 「살아 있다」는 신호를 계속 보낸다.
    //   종전엔 시작할 때 한 번만 보내 2분 넘게 걸리는 지시는 화면이 「자리 비움」으로 바뀌었다(PC가 꺼진 것으로 오해).
    const keep = setInterval(async () => {
        try {
            const cur = (await pool.query(`SELECT status FROM pending_orders WHERE id = $1`, [order.id])).rows[0];
            const open = !cur || ['대기', '처리중', '승인됨'].includes(cur.status);
            if (open) await heartbeat('busy', firstRunning() || order.id); else if (!st.running.size) await heartbeat('idle');
            await writeState();
        } catch (e) { log('처리 중 신호 실패(무시): ' + e.message); }
    }, BEAT_MS);
    const f = st.fast;
    const rt = f.off ? { lane: 'ai', model: MODEL, why: '종전 방식' }
        : fast.route(order, f.route ? FORCED_MODEL : (FORCED_MODEL || 'opus'));
    if (rt.lane === 'direct_qty' && !f.direct) { rt.lane = 'ai'; rt.model = MODEL; rt.why = '바로 처리 꺼짐'; }
    // #598 B: 되묻기에 실어 둔 명령 + 화면 버튼 답 「[이대로 진행]」 → AI 없이 그 명령만(미리 받기가 켜져 있을 때)
    let plan = null;
    if (rt.lane === 'ai' && !f.off && f.plan && f.prefetch) { try { plan = await planLookup(order); } catch (e) { plan = null; log(`#${order.id} 정해 둔 명령 확인 실패(종전 AI 길): ${e.message}`); } }
    if (plan) { rt.lane = 'plan'; rt.model = null; rt.why = '정해 둔 명령 — AI 없이'; }
    log(`#${order.id} 처리 시작 (${order.status} · ${order.created_by || '-'} · ${rt.lane === 'ai' ? (key ? '콘솔' : '대표 요금제') + ' · ' + rt.model : 'AI 없음'} · ${rt.why})`);
    const t0 = Date.now();
    let r = { code: -1, outPath: '', info: {} };
    try {
        // 미리 받기: 대기 프로그램이 지시를 집어(처리중) 내용을 문장에 넣어 준다. 끄면 종전처럼 창구가 get.js로 받는다.
        let got = null;
        if (rt.lane !== 'ai' || f.prefetch) {
            got = await claim(order.id);
            if (!got.ok) { log(`#${order.id} 다른 곳에서 이미 집어 감 — 건너뜀`); got = null; r = { code: 0, outPath: '', info: { skipped: true } }; }
        }
        // 어느 길로 처리하는지 화면에 한 줄(답변 옆 작은 표시로도 쓰인다)
        // #598 A: 최종발주 메모 읽기 — 앞 판정 재사용(전부 같으면 AI 없이 · 일부면 새 메모만 자료 파일에 남긴다)
        let memo = null;
        if (got && rt.lane === 'ai' && !f.off && f.memo_reuse && f.prefetch && got.final_order_memo && /^(\[검증469\]\s*)?\[최종발주 메모 읽기\]/.test(order.content || '')) {
            try { memo = memoPrepare(order, got); } catch (e) { memo = null; try { fs.unlinkSync(memoSide(order.id)); } catch (_) { /* 없음 */ } log(`#${order.id} 앞 판정 재사용 준비 실패(전부 새로 읽음): ${e.message}`); }
            if (memo && memo.all) { rt.lane = 'memo_reuse'; rt.model = null; }
            if (memo) log(`#${order.id} 메모 재사용 ${memo.all ? memo.n + '건 전부 — AI 없이' : memo.reused + '건 · 새로 읽기 ' + memo.fresh + '건'}`);
        }
        if (got && got.run_id) await appendStep(got.run_id, 'lane', rt.lane === 'direct_qty' ? '📦 바로 처리' : rt.lane === 'memo_reuse' ? '♻ 앞 판정 재사용' : rt.lane === 'plan' ? '▶ 정해 둔 명령 실행' : rt.model === 'sonnet' ? '⚡ 빠른 답' : '🧠 깊은 답').catch(() => { });
        if (rt.lane === 'direct_qty') { if (got) r = await runDirectQty(order, got); }
        else if (rt.lane === 'memo_reuse') r = await runMemoReuse(order, got, memo);
        else if (rt.lane === 'plan') { if (got) r = await runPlan(order, got, plan); }
        else if (f.prefetch) {
            const run = (f.warm || st.forceWarm) && f.stream ? runWarm : runDesk;
            // #580 B: 최종발주 메모 읽기·대화는 규칙 문서와 자료를 미리 읽어 지시문에 넣는다(끄기 = desk_fast {"inline":false} · 못 읽으면 종전대로 창구가 읽는다)
            let inl = null;
            if (got && f.inline) { try { inl = fast.inlineFinalOrder(got, p => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }); } catch (e) { inl = null; log(`#${order.id} 규칙 미리 넣기 실패(종전 방식으로): ${e.message}`); } }
            if (inl) log(`#${order.id} 규칙 문서 미리 넣음 (${inl.name}${inl.withData ? ' + 자료' : ''} · ${inl.text.length}자)`);
            if (got) r = await run(order, key, { model: rt.model, prompt: promptPrefetched(order, got, inl), stream: f.stream, lean: f.lean, effort: f.effort, runId: got.run_id, live: f.stream && order.status !== '승인됨' });
            // 미리 넣은 경우 자료 파일은 여기서 지운다(창구에게 「지우지 말라」고 했으므로) — 다시 시도하게 되면 받기(claim)가 파일을 새로 쓴다
            if (inl && inl.cleanup) { try { fs.unlinkSync(inl.cleanup); } catch (e) { /* 이미 없음 */ } }
        } else {
            let runId = null;
            if (f.stream) {   // 미리 받기를 껐을 때: 단계 기록에 쓸 실행 번호는 창구가 받은 뒤에야 생긴다 → 잠깐 기다렸다 찾는다
                setTimeout(async () => { try { runId = (await pool.query(`SELECT run_id FROM pending_orders WHERE id = $1`, [order.id])).rows[0].run_id; } catch (e) { /* 무시 */ } }, 20000).unref();
            }
            r = await runDesk(order, key, { model: rt.model, stream: f.stream, lean: f.lean, effort: f.effort, get runId() { return runId; }, live: f.stream && order.status !== '승인됨' });
        }
    } catch (e) { log(`#${order.id} 처리 중 오류: ${e.message}`); }
    finally { clearInterval(keep); try { fs.unlinkSync(memoSide(order.id)); } catch (_) { /* respond.js 가 이미 치웠거나 없음(#598 A) */ } }
    const sec = Math.round((Date.now() - t0) / 1000);
    const after = (await pool.query(`SELECT status FROM pending_orders WHERE id = $1`, [order.id])).rows[0];
    const stillOpen = !after || ['대기', '처리중', '승인됨'].includes(after.status);
    const info = r.info || {};
    const costNote = (info.cost_usd != null ? ` · $${Number(info.cost_usd).toFixed(3)} · ${info.turns || '?'}턴` : '') + (info.warm ? ` · 켜 둔 창구(${info.warm === 'reused' ? '다시 씀' : '새로 켬'})` : '');
    if (!stillOpen) {
        st.tries.delete(order.id);
        st.lastDone = { id: order.id, at: new Date().toISOString(), sec, status: after.status, model: rt.lane === 'ai' ? rt.model : 'none' };
        log(`#${order.id} 끝 — ${after.status} (${sec}초${costNote})`);
    } else {
        const n = (st.tries.get(order.id) || 0) + 1;
        st.tries.set(order.id, n);
        log(`#${order.id} 결과가 안 올라옴 (${n}/${MAX_TRY} · exit=${r.code} · ${sec}초 · 기록 ${r.outPath})`);
        if (n >= MAX_TRY) {
            await pool.query(
                `UPDATE pending_orders SET status = '오류', result = $2, processed_at = NOW() WHERE id = $1 AND status <> '완료'`,
                [order.id, JSON.stringify({ type: 'error', error: `창구가 ${MAX_TRY}번 시도했지만 결과를 올리지 못했습니다. 대표 창에서 확인해 주세요.` })]);
            st.tries.delete(order.id);
            log(`#${order.id} 오류로 돌림`);
        } else {
            // '처리중'으로 잡혀 있으면 되돌려 다음 차례에 다시 집게 한다(쓰다 만 미리 보기는 지운다)
            await pool.query(`UPDATE pending_orders SET status = '대기', result = CASE WHEN result->>'type' = 'live' THEN NULL ELSE result END WHERE id = $1 AND status = '처리중'`, [order.id]);
        }
    }
    st.running.delete(order.id);
    if (st.running.size) await heartbeat('busy', firstRunning()); else await heartbeat('idle');
    st.lastBeat = Date.now();
    try { await writeState(); } catch (e) { /* 다음 주기에 다시 적는다 */ }
}

// 10초마다: 화면 버튼 신호·설정·상태 기록(종전 tick의 앞부분 그대로)
async function slowTick() {
    const [req, autoCfg, fastCfg] = await Promise.all([cfgGet('desk_wake_request'), cfgGet('desk_auto'), cfgGet('desk_fast')]);
    st.paused = !!(autoCfg && autoCfg.on === false);
    st.fast = fast.settings(ENV_FAST || fastCfg);
    if (Date.now() - st.lastTrim > 86400e3) { st.lastTrim = Date.now(); trimLog(); }   // 하루 한 번(상주 시작 때는 main 이 이미 돌렸다)
    warmReap(!st.fast.warm && !st.forceWarm);   // 오래 쉰 창구는 끈다(켜 둔 창구를 안 쓰는 설정이면 전부)

    // 화면 버튼 신호(켜기/끄기)
    const reqAt = req && req.at ? Date.parse(req.at) : NaN;
    const isNew = Number.isFinite(reqAt) && req.at !== st.handledReqAt && Date.now() - reqAt < REQ_TTL_MS;
    if (req && req.at && req.at !== st.handledReqAt) {
        st.handledReqAt = req.at;
        if (isNew) {
            const on = req.action !== 'sleep';
            st.paused = !on;
            await cfgSet('desk_auto', { on, by: req.by || null, at: new Date().toISOString() });
            log(on ? '화면에서 창구 켜기' : '화면에서 창구 끄기');
        }
    }

    const key = readKey();
    st.key = key;
    if (!key) st.note = '콘솔 API 키 파일이 없습니다 (' + KEY_FILE + ')';
    else if (st.paused) st.note = '꺼 둔 상태입니다 — 화면에서 [창구 켜기]를 누르면 다시 받습니다';
    else st.note = '';

    const active = !!key && !st.paused;
    if (active && !st.running.size && Date.now() - st.lastBeat >= BEAT_MS) { await heartbeat('idle'); st.lastBeat = Date.now(); }

    st.active = active;
    await writeState();
}

async function tick(mode) {
    if (mode || Date.now() - st.lastSlow >= TICK_MS) { await slowTick(); st.lastSlow = Date.now(); }
    const key = st.key;
    if (st.paused && !st.sub) return false;
    if (st.running.size >= PARALLEL) return false;
    const o = await nextOrder(st.onlyId);
    if (!o) return false;
    const mine = (await subscriptionUsers()).has(Number(o.created_by_id));   // 대표 본인 지시인가
    const direct = !st.fast.off && st.fast.direct && fast.route(o, null).lane === 'direct_qty';   // AI를 안 쓰는 일은 키가 없어도 된다
    if (!mine && !st.sub && !key && !direct) { st.note = '콘솔 API 키 파일이 없어 직원 지시를 처리하지 못합니다'; return false; }
    if (mode === 'dry') { const rt = st.fast.off ? { lane: 'ai', model: MODEL, why: '종전 방식' } : fast.route(o, FORCED_MODEL); log(`(시험) 처리할 지시 #${o.id} ${o.status} → ${rt.lane} ${rt.model || ''} (${rt.why})`); return true; }
    try { trust.ensure(); } catch (e) { /* 신뢰 등록은 창을 직접 열 때만 필요하다 */ }
    if (direct) st.directBusy = true;
    const p = handle(o, (st.sub || mine) ? null : key).catch(e => log(`#${o.id} 처리 실패: ${e.message}`)).finally(() => { if (direct) st.directBusy = false; });
    if (mode && !st.multi) await p;   // 시험(--once 1건)은 끝까지 기다린다 · --ids 여러 건과 상주 모드는 바로 다음 자리를 본다
    return true;
}

async function main() {
    const mode = process.argv.includes('--dry') ? 'dry' : process.argv.includes('--once') ? 'once' : null;
    st.sub = process.argv.includes('--sub');
    const idx = process.argv.indexOf('--id');
    st.onlyId = idx > 0 ? parseInt(process.argv[idx + 1], 10) || 0 : 0;
    if (mode) {
        // 시험: --ids 1,2,3 = 그 지시들을 한 프로세스에서 차례로 · --warm = 켜 둔 창구 방식으로(설정과 무관하게)
        st.forceWarm = process.argv.includes('--warm');
        const li = process.argv.indexOf('--ids');
        const ids = li > 0 ? String(process.argv[li + 1] || '').split(',').map(x => parseInt(x, 10)).filter(Boolean) : [st.onlyId];
        const runs = [];
        st.multi = ids.length > 1;
        // 지정한 지시들도 상주 모드와 같은 규칙(같은 사람은 차례로 · 중간발주는 한 번에 하나)으로 자리가 날 때 띄운다
        const left = [...ids]; const t0 = Date.now();
        while (left.length && Date.now() - t0 < RUN_TIMEOUT_MS) {
            for (const id of [...left]) {
                st.onlyId = id;
                const did = await tick(mode);
                if (did) { runs.push({ id, did }); left.splice(left.indexOf(id), 1); continue; }
                const cur = (await pool.query(`SELECT status FROM pending_orders WHERE id = $1`, [id])).rows[0];
                if (!cur || !['대기', '승인됨'].includes(cur.status)) { runs.push({ id, did: false, status: cur ? cur.status : '없음' }); left.splice(left.indexOf(id), 1); }
            }
            if (left.length) await new Promise(r => setTimeout(r, 1000));
        }
        while (st.running.size) await new Promise(r => setTimeout(r, 500));
        for (let i = 0; i < 20 && [...warm.values()].some(w => w.busy); i++) await new Promise(r => setTimeout(r, 500));
        warmReap(true);
        console.log(JSON.stringify({ ok: true, did: runs.some(x => x.did), note: st.note, last: st.lastDone, runs }));
        await pool.end();
        return;
    }
    await new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', e => reject(e.code === 'EADDRINUSE' ? new Error('이미 실행 중입니다') : e));
        srv.listen(LOCK_PORT, '127.0.0.1', () => resolve(srv));
    });
    trimLog();
    log('대기 프로그램 시작 host=' + os.hostname() + ' model=' + (FORCED_MODEL || '자동(sonnet/opus)') + ' #498 · 동시 ' + PARALLEL + '개 #503');
    for (;;) {
        try { await tick(null); } catch (e) { log('주기 오류(재시도): ' + e.message); }
        await new Promise(r => setTimeout(r, st.fast.poll ? POLL_MS : TICK_MS));
    }
}
main().catch(async e => { log('종료: ' + e.message); try { await pool.end(); } catch (_) { /* 무시 */ } process.exit(e.message === '이미 실행 중입니다' ? 0 : 1); });
