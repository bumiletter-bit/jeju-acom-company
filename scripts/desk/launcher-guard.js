// #701(대표 「근본 고쳐줘」 10/14) 창구 대기 프로그램 감시자 — launcher.js 를 자식으로 띄우고, 죽으면 다시 켠다.
//   · 다시 켜기 = 5초 뒤 · 1분 안에 또 죽으면 10·20·40·60초로 늘림(1분 넘게 살았으면 5초로 되돌림) · 로그 「창구 다시 켬(n회)」
//   · 조용한 죽음 0 = 자식의 stdout/stderr 를 ~/.akkome/launcher-child.log 에 남긴다(종전 vbs 는 창 없이 띄워 마지막 오류 글이 사라졌음) · 종료 코드·신호·산 시간을 launcher.log 에
//   · 한 번만 돈다 = 포트 47470(감시자) — 두 번째 감시자는 「이미 실행 중」 한 줄 적고 바로 끝
//   · 창구(47469)가 감시자 밖에서 이미 돌고 있으면 띄우지 않고 15초마다 보다가 자리가 비면 이어받는다(두 창구가 같은 지시를 집지 않게 · 교체 때 옛 창구를 내리면 저절로 넘어옴)
//   · 텔레그램 없음(로그만 · 대표 보류 건) · [창구 깨우기]는 DB 신호(desk_wake_request)라 이 프로그램과 무관
// 사용: node scripts/desk/launcher-guard.js        (상주 · 설치 = install-launcher.js 가 시작프로그램 vbs 로 이걸 띄움)
//       node scripts/desk/launcher.js --once …      (시험은 종전처럼 launcher 를 직접)
// 시험용 env: GUARD_CHILD(자식 스크립트) · GUARD_LOCK_PORT · GUARD_LOG · GUARD_CHILD_LOG · GUARD_RESTART_MS
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LAUNCHER = path.join(__dirname, 'launcher.js');
const CHILD = process.env.GUARD_CHILD || LAUNCHER;
const LOCK_PORT = parseInt(process.env.GUARD_LOCK_PORT, 10) || 47470;   // 감시자 자신
const LAUNCHER_PORT = 47469;                                              // launcher.js 의 잠금 포트(그 파일과 같은 값)
const AK = path.join(os.homedir(), '.akkome');
const LOG = process.env.GUARD_LOG || path.join(AK, 'launcher.log');
const CHILD_LOG = process.env.GUARD_CHILD_LOG || path.join(AK, 'launcher-child.log');
const PID_FILE = path.join(AK, 'launcher-guard.pid');
const RESTART_MS = parseInt(process.env.GUARD_RESTART_MS, 10) || 5000;
const MAX_BACKOFF_MS = 60000, STABLE_MS = 60000, WAIT_OTHER_MS = 15000;

function log(msg) {
    const line = new Date().toISOString() + ' [감시자] ' + msg;
    try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + '\n'); } catch (e) { /* 기록 실패는 무시 */ }
    if (process.stdout.isTTY) console.log(line);
}
function portBusy(port) {
    return new Promise(resolve => {
        const c = net.connect({ port, host: '127.0.0.1' }, () => { c.destroy(); resolve(true); });
        c.on('error', () => resolve(false));
        setTimeout(() => { try { c.destroy(); } catch (e) { /* 이미 닫힘 */ } resolve(false); }, 1500);
    });
}
function trimChildLog() {
    try { const s = fs.statSync(CHILD_LOG); if (s.size > 1024 * 1024) fs.writeFileSync(CHILD_LOG, fs.readFileSync(CHILD_LOG, 'utf8').split('\n').slice(-2000).join('\n')); } catch (e) { /* 없음 */ }
}

const NODE = process.env.GUARD_NODE || process.execPath;   // 시험용(없는 경로를 주면 spawn 'error' 길을 본다)
let child = null, restarts = 0, backoff = RESTART_MS, startedAt = 0, stopping = false, waitingLogged = false, restartTimer = null;
// 다시 켜기 예약 한 곳 — 'error'(띄우기 실패)와 'exit'(죽음)가 둘 다 와도 한 번만(#701 보완)
function scheduleRestart(lived) {
    if (stopping || restartTimer) return;
    backoff = (lived < STABLE_MS && restarts > 0) ? Math.min(MAX_BACKOFF_MS, backoff * 2) : RESTART_MS;
    restarts++;
    log(`창구 다시 켬(${restarts}회) ${backoff / 1000}초 뒤`);
    restartTimer = setTimeout(() => { restartTimer = null; start(); }, backoff);
}
async function start() {
    if (stopping) return;
    if (CHILD === LAUNCHER && await portBusy(LAUNCHER_PORT)) {   // 감시자 밖의 창구가 돌고 있다 — 기다렸다가 이어받는다
        if (!waitingLogged) { waitingLogged = true; log('창구가 이미(감시자 밖에서) 돌고 있어 띄우지 않고 기다림 — 그 창구가 끝나면 이어받음'); }
        setTimeout(start, WAIT_OTHER_MS);
        return;
    }
    waitingLogged = false;
    trimChildLog();
    let out;
    try { fs.mkdirSync(path.dirname(CHILD_LOG), { recursive: true }); out = fs.openSync(CHILD_LOG, 'a'); } catch (e) { out = 'ignore'; }
    try { if (out !== 'ignore') fs.appendFileSync(CHILD_LOG, `\n===== ${new Date().toISOString()} 창구 켬 =====\n`); } catch (e) { /* 무시 */ }
    const env = Object.assign({}, process.env, { DESK_GUARDED: '1', GUARD_PID: String(process.pid) });
    child = spawn(NODE, [CHILD], { cwd: ROOT, env, stdio: ['ignore', out, out], windowsHide: true });
    startedAt = Date.now();
    let closed = false; const closeOut = () => { if (closed) return; closed = true; try { if (out !== 'ignore') fs.closeSync(out); } catch (e) { /* 무시 */ } };
    log(`창구 켬 pid=${child.pid || '?'}${restarts ? ` (다시 켬 ${restarts}회째)` : ''} child=${path.basename(CHILD)}`);
    child.on('error', e => { log('창구 띄우기 실패: ' + e.message); closeOut(); child = null; scheduleRestart(Date.now() - startedAt); });
    child.on('exit', (code, signal) => {
        closeOut();
        const lived = Date.now() - startedAt;
        child = null;
        log(`창구 종료 code=${code === null ? '' : code} signal=${signal || ''} (${Math.round(lived / 1000)}초 살았음)`);
        scheduleRestart(lived);
    });
}
function shutdown(why, code) {
    if (stopping) return;
    stopping = true;
    log('감시자 종료(' + why + ')' + (child ? ' · 창구 pid=' + child.pid + ' 도 끝냄' : ''));
    try { if (child) child.kill(); } catch (e) { /* 무시 */ }
    try { fs.unlinkSync(PID_FILE); } catch (e) { /* 없음 */ }
    setTimeout(() => process.exit(code), 300).unref();
}
process.on('uncaughtException', e => { log('감시자 치명 오류 → 종료 1: ' + String(e && e.stack || e).replace(/\s+/g, ' ').slice(0, 600)); shutdown('치명 오류', 1); });
process.on('unhandledRejection', e => { log('감시자 처리 안 된 거부 → 종료 1: ' + String(e && e.stack || e).replace(/\s+/g, ' ').slice(0, 600)); shutdown('거부', 1); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) { try { process.on(sig, () => shutdown('신호 ' + sig, 0)); } catch (e) { /* 이 OS 에 없는 신호 */ } }
process.on('exit', code => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' [감시자] 끝 code=' + code + '\n'); } catch (e) { /* 무시 */ } });

(async () => {
    await new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', e => reject(e.code === 'EADDRINUSE' ? new Error('이미 실행 중입니다') : e));
        srv.listen(LOCK_PORT, '127.0.0.1', () => resolve(srv));
    }).catch(e => {
        if (e.message === '이미 실행 중입니다') { log('감시자가 이미 돌고 있어(포트 ' + LOCK_PORT + ') 이 실행은 바로 끝냄'); process.exit(0); }
        throw e;
    });
    try { fs.mkdirSync(AK, { recursive: true }); fs.writeFileSync(PID_FILE, String(process.pid)); } catch (e) { /* 무시 */ }
    log('감시자 시작 pid=' + process.pid + ' host=' + os.hostname() + ' child=' + CHILD + ' 다시 켜기 ' + RESTART_MS / 1000 + '초(최대 ' + MAX_BACKOFF_MS / 1000 + '초)');
    await start();
})().catch(e => { log('감시자 시작 실패: ' + e.message); process.exit(1); });
