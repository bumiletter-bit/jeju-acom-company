// #470 창구 대기 프로그램을 이 PC에 설치한다 — PC를 켜면 저절로 돌고, 창은 뜨지 않는다.
//   설치: node scripts/desk/install-launcher.js          (등록 + 바로 시작)
//   제거: node scripts/desk/install-launcher.js --remove
//   상태: node scripts/desk/install-launcher.js --status
//
// 방식: 시작프로그램 폴더에 vbs 한 줄짜리를 두고, 그 vbs가 창 없이 node 를 띄운다(작업 스케줄러보다 단순하고 권한도 필요 없다).
// #701(대표 「근본 고쳐줘」 10/14): vbs 가 띄우는 것은 감시자 launcher-guard.js — 감시자가 launcher.js 를 자식으로 띄우고 죽으면 다시 켠다(5초 · 연속이면 최대 60초).
//   --status 는 감시자(47470)·창구(47469) 둘 다 보여 준다. 감시자 밖에서 돌던 옛 창구가 있으면 감시자는 기다렸다가 그것이 끝난 뒤 이어받는다(옛 창구는 taskkill /PID 로 내리면 됨).
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LAUNCHER = path.join(ROOT, 'scripts', 'desk', 'launcher.js');
const GUARD = path.join(ROOT, 'scripts', 'desk', 'launcher-guard.js');
const STARTUP = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const VBS = path.join(STARTUP, '아꼼이-창구-대기.vbs');
const CMD = path.join(os.homedir(), '.akkome', 'launcher-start.cmd');
const PID_FILE = path.join(os.homedir(), '.akkome', 'launcher-guard.pid');
const LOCK_PORT = 47469;         // 창구(launcher.js)
const GUARD_PORT = 47470;        // 감시자(launcher-guard.js)

function nodeExe() { return process.execPath; }
function portBusy(port) {
    return new Promise(resolve => {
        const c = net.connect({ port, host: '127.0.0.1' }, () => { c.destroy(); resolve(true); });
        c.on('error', () => resolve(false));
        setTimeout(() => { try { c.destroy(); } catch (e) { /* 이미 닫힘 */ } resolve(false); }, 1500);
    });
}
function running() { return portBusy(LOCK_PORT); }
function guardRunning() { return portBusy(GUARD_PORT); }
function guardPid() { try { return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10) || null; } catch (e) { return null; } }
function writeFiles() {
    fs.mkdirSync(path.dirname(CMD), { recursive: true });
    fs.mkdirSync(STARTUP, { recursive: true });
    // 🔴 경로에 한글이 들어 있다 — .cmd 파일은 한글을 깨뜨리므로 쓰지 않고, vbs 를 UTF-16 으로 저장해 그 안에서 바로 node 를 띄운다.
    //    (UTF-8 로 저장하면 Windows 가 한글 경로를 깨뜨려 「파일을 찾을 수 없습니다」가 난다 — 2026-09-29 실측)
    const vbs = 'Set s = CreateObject("WScript.Shell")\r\n'
        + 's.CurrentDirectory = "' + ROOT + '"\r\n'
        + 's.Run """' + nodeExe() + '"" ""' + GUARD + '""", 0, False\r\n';   // VBScript 안에서 "" 는 따옴표 한 개다 · #701 감시자를 띄운다(감시자가 launcher.js 를 켬)
    fs.writeFileSync(VBS, '﻿' + vbs, 'utf16le');
    try { fs.unlinkSync(CMD); } catch (e) { /* 옛 방식 잔재 정리 */ }
}
async function status() {
    let vbsTarget = null;
    try { const t = fs.readFileSync(VBS, 'utf16le'); vbsTarget = /launcher-guard\.js/.test(t) ? '감시자(launcher-guard.js)' : /launcher\.js/.test(t) ? '창구만(launcher.js · 옛 방식)' : '알 수 없음'; } catch (e) { vbsTarget = null; }
    return { 등록됨: fs.existsSync(VBS), 시작파일이_띄우는_것: vbsTarget, 감시자_실행중: await guardRunning(), 감시자_pid: guardPid(), 창구_실행중: await running(), 시작파일: VBS, 창구: LAUNCHER, 감시자: GUARD };
}
async function main() {
    const arg = process.argv[2];
    if (arg === '--status') { console.log(JSON.stringify(await status(), null, 1)); return; }
    if (arg === '--remove') {
        for (const f of [VBS, CMD]) { try { fs.unlinkSync(f); } catch (e) { /* 없으면 넘어간다 */ } }
        console.log(JSON.stringify({ 제거됨: true, 안내: '이미 돌고 있는 프로그램(감시자·창구)은 PC를 다시 켜면 사라집니다(지금 내리려면 taskkill /PID <감시자 pid> /T)' }));
        return;
    }
    writeFiles();
    if (await guardRunning()) { console.log(JSON.stringify(Object.assign({ 안내: '감시자가 이미 돌고 있어 새로 띄우지 않았습니다(시작파일만 새로 씀)' }, await status()), null, 1)); return; }
    const child = spawn('wscript', [VBS], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    await new Promise(r => setTimeout(r, 6000));
    const s = await status();
    if (s.감시자_실행중 && !s.창구_실행중) s.안내 = '감시자는 떴고 창구는 켜는 중이거나(몇 초) 옛 창구가 끝나길 기다리는 중입니다 — ~/.akkome/launcher.log 끝 줄 확인';
    console.log(JSON.stringify(s, null, 1));
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
