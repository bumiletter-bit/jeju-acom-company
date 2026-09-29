// #470 창구 대기 프로그램 — 이 PC에서 조용히 돌면서 직원 지시를 창구(클코)에게 넘긴다
//
//   왜 이렇게 만들었나(2026-09-29 실측):
//   ⓐ 터미널 창을 띄워 첫 문장을 자동으로 넣는 방법은 안 된다 — 창을 열면 문장이 입력칸에 적히기만 하고 Enter를 사람이 눌러야 한다.
//   ⓑ `claude --bg`(창 없는 배경 세션)는 그때그때 준 API 키를 무시하고 대표 로그인으로 돈다 → 회사 요금 분리가 깨진다.
//   ⓒ `claude -p`(창 없이 한 건 처리)는 준 API 키를 그대로 쓴다 → 이 방식으로 지시 1건마다 창구를 부른다.
//   ⓓ 창 안에서 돌던 감시(watch.js)는 PC 메모리가 모자라면 강제로 꺼진다(9/29 실사고) — 이 프로그램은 창 밖에서 돌아 그 영향을 안 받는다.
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
const { pool, ROOT, heartbeat } = require('./_db');
const trust = require('./trust-desk');

const DESK_DIR = path.join(ROOT, '★에이전트오피스');
const KEY_FILE = path.join(os.homedir(), '.akkome', 'desk-api-key.txt');
const LOG_DIR = path.join(os.homedir(), '.akkome', 'logs');
const LOG = path.join(os.homedir(), '.akkome', 'launcher.log');
const LOCK_PORT = 47469;
const TICK_MS = 10000;
const BEAT_MS = 30000;
const RUN_TIMEOUT_MS = 25 * 60 * 1000;   // 한 건이 이보다 오래 걸리면 멈춘 것으로 본다
const MAX_TRY = 3;                       // 같은 지시를 이만큼 실패하면 오류로 돌린다
const REQ_TTL_MS = 300000;               // 이보다 오래된 화면 버튼 신호는 버린다
const MODEL = process.env.AKKOME_MODEL || 'opus';
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

const st = { busy: false, lastBeat: 0, tries: new Map(), handledReqAt: null, note: '', paused: false, lastDone: null, sub: false, onlyId: 0 };

function runDesk(order, key) {  // key 가 null 이면 콘솔 키 없이(대표 요금제로) 돈다 — 시험 전용
    return new Promise(resolve => {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const outPath = path.join(LOG_DIR, `order-${order.id}.log`);
        const out = fs.openSync(outPath, 'a');
        const env = Object.assign({}, process.env);
        if (key) env.ANTHROPIC_API_KEY = key; else delete env.ANTHROPIC_API_KEY;
        // 🔴 문장은 반드시 맨 앞 — --add-dir 는 폴더를 여러 개 받는 옵션이라 뒤에 둔 문장을 폴더로 삼킨다(실측).
        const args = [promptFor(order), '--model', MODEL, '--dangerously-skip-permissions', '--add-dir', ROOT];
        const exe = findClaude();
        if (!exe) { try { fs.closeSync(out); } catch (_) { } return resolve({ code: -1, err: 'claude 실행 파일을 찾지 못했습니다', outPath }); }
        const child = spawn(exe, args, { cwd: DESK_DIR, env, stdio: ['ignore', out, out], windowsHide: true });
        let done = false;
        const finish = r => { if (done) return; done = true; clearTimeout(timer); try { fs.closeSync(out); } catch (_) { /* 이미 닫힘 */ } resolve(r); };
        const timer = setTimeout(() => {
            log(`#${order.id} 25분을 넘겨 중단`);
            try { child.kill(); } catch (e) { /* 이미 끝남 */ }
        }, RUN_TIMEOUT_MS);
        child.on('error', e => finish({ code: -1, err: e.message, outPath }));
        child.on('exit', code => finish({ code, outPath }));
    });
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

async function nextOrder(onlyId) {
    if (onlyId) {
        const one = await pool.query(
            `SELECT id, status, created_by, created_by_id, (image_data IS NOT NULL) AS has_image
             FROM pending_orders WHERE id = $1 AND is_deleted = false AND status IN ('대기', '승인됨')`, [onlyId]);
        return one.rows[0] || null;
    }
    const r = await pool.query(
        `SELECT id, status, created_by, created_by_id, (image_data IS NOT NULL) AS has_image
         FROM pending_orders
         WHERE is_deleted = false AND status IN ('대기', '승인됨')
           AND content NOT LIKE '[검증469]%'
         ORDER BY (status = '승인됨') DESC, id ASC LIMIT 1`);
    return r.rows[0] || null;
}

async function handle(order, key) {
    st.busy = true;
    await heartbeat('busy', order.id);
    log(`#${order.id} 처리 시작 (${order.status} · ${order.created_by || '-'} · ${key ? '콘솔' : '대표 요금제'})`);
    const t0 = Date.now();
    const r = await runDesk(order, key);
    const sec = Math.round((Date.now() - t0) / 1000);
    const after = (await pool.query(`SELECT status FROM pending_orders WHERE id = $1`, [order.id])).rows[0];
    const stillOpen = !after || ['대기', '처리중', '승인됨'].includes(after.status);
    if (!stillOpen) {
        st.tries.delete(order.id);
        st.lastDone = { id: order.id, at: new Date().toISOString(), sec, status: after.status };
        log(`#${order.id} 끝 — ${after.status} (${sec}초)`);
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
            // '처리중'으로 잡혀 있으면 되돌려 다음 차례에 다시 집게 한다
            await pool.query(`UPDATE pending_orders SET status = '대기' WHERE id = $1 AND status = '처리중'`, [order.id]);
        }
    }
    st.busy = false;
    await heartbeat('idle');
    st.lastBeat = Date.now();
}

async function tick(mode) {
    const [req, autoCfg] = await Promise.all([cfgGet('desk_wake_request'), cfgGet('desk_auto')]);
    st.paused = !!(autoCfg && autoCfg.on === false);

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
    if (!key) st.note = '콘솔 API 키 파일이 없습니다 (' + KEY_FILE + ')';
    else if (st.paused) st.note = '꺼 둔 상태입니다 — 화면에서 [창구 켜기]를 누르면 다시 받습니다';
    else st.note = '';

    const active = !!key && !st.paused;
    if (active && !st.busy && Date.now() - st.lastBeat >= BEAT_MS) { await heartbeat('idle'); st.lastBeat = Date.now(); }

    await cfgSet('desk_launcher', {
        at: new Date().toISOString(), host: os.hostname(), on: active, busy: st.busy, note: st.note,
        last_done: st.lastDone, handled_req_at: st.handledReqAt, mode: 'headless',
    });

    if (st.paused && !st.sub) return false;
    if (st.busy) return false;
    const o = await nextOrder(st.onlyId);
    if (!o) return false;
    const mine = (await subscriptionUsers()).has(Number(o.created_by_id));   // 대표 본인 지시인가
    if (!mine && !st.sub && !key) { st.note = '콘솔 API 키 파일이 없어 직원 지시를 처리하지 못합니다'; return false; }
    if (mode === 'dry') { log(`(시험) 처리할 지시 #${o.id} ${o.status}`); return true; }
    try { trust.ensure(); } catch (e) { /* 신뢰 등록은 창을 직접 열 때만 필요하다 */ }
    await handle(o, (st.sub || mine) ? null : key);
    return true;
}

async function main() {
    const mode = process.argv.includes('--dry') ? 'dry' : process.argv.includes('--once') ? 'once' : null;
    st.sub = process.argv.includes('--sub');
    const idx = process.argv.indexOf('--id');
    st.onlyId = idx > 0 ? parseInt(process.argv[idx + 1], 10) || 0 : 0;
    if (mode) {
        const did = await tick(mode);
        console.log(JSON.stringify({ ok: true, did, note: st.note }));
        await pool.end();
        return;
    }
    await new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', e => reject(e.code === 'EADDRINUSE' ? new Error('이미 실행 중입니다') : e));
        srv.listen(LOCK_PORT, '127.0.0.1', () => resolve(srv));
    });
    trimLog();
    log('대기 프로그램 시작 host=' + os.hostname() + ' model=' + MODEL);
    for (;;) {
        try { await tick(null); } catch (e) { log('주기 오류(재시도): ' + e.message); }
        await new Promise(r => setTimeout(r, TICK_MS));
    }
}
main().catch(async e => { log('종료: ' + e.message); try { await pool.end(); } catch (_) { /* 무시 */ } process.exit(e.message === '이미 실행 중입니다' ? 0 : 1); });
