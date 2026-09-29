// #470 창구 대기 프로그램을 이 PC에 설치한다 — PC를 켜면 저절로 돌고, 창은 뜨지 않는다.
//   설치: node scripts/desk/install-launcher.js          (등록 + 바로 시작)
//   제거: node scripts/desk/install-launcher.js --remove
//   상태: node scripts/desk/install-launcher.js --status
//
// 방식: 시작프로그램 폴더에 vbs 한 줄짜리를 두고, 그 vbs가 창 없이 node 를 띄운다(작업 스케줄러보다 단순하고 권한도 필요 없다).
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LAUNCHER = path.join(ROOT, 'scripts', 'desk', 'launcher.js');
const STARTUP = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const VBS = path.join(STARTUP, '아꼼이-창구-대기.vbs');
const CMD = path.join(os.homedir(), '.akkome', 'launcher-start.cmd');
const LOCK_PORT = 47469;

function nodeExe() { return process.execPath; }
function running() {
    return new Promise(resolve => {
        const c = net.connect({ port: LOCK_PORT, host: '127.0.0.1' }, () => { c.destroy(); resolve(true); });
        c.on('error', () => resolve(false));
        setTimeout(() => { try { c.destroy(); } catch (e) { /* 이미 닫힘 */ } resolve(false); }, 1500);
    });
}
function writeFiles() {
    fs.mkdirSync(path.dirname(CMD), { recursive: true });
    fs.mkdirSync(STARTUP, { recursive: true });
    // 🔴 경로에 한글이 들어 있다 — .cmd 파일은 한글을 깨뜨리므로 쓰지 않고, vbs 를 UTF-16 으로 저장해 그 안에서 바로 node 를 띄운다.
    //    (UTF-8 로 저장하면 Windows 가 한글 경로를 깨뜨려 「파일을 찾을 수 없습니다」가 난다 — 2026-09-29 실측)
    const vbs = 'Set s = CreateObject("WScript.Shell")\r\n'
        + 's.CurrentDirectory = "' + ROOT + '"\r\n'
        + 's.Run """' + nodeExe() + '"" ""' + LAUNCHER + '""", 0, False\r\n';   // VBScript 안에서 "" 는 따옴표 한 개다
    fs.writeFileSync(VBS, '﻿' + vbs, 'utf16le');
    try { fs.unlinkSync(CMD); } catch (e) { /* 옛 방식 잔재 정리 */ }
}
async function main() {
    const arg = process.argv[2];
    if (arg === '--status') {
        console.log(JSON.stringify({ 등록됨: fs.existsSync(VBS), 실행중: await running(), 시작파일: VBS, 실행파일: CMD }, null, 1));
        return;
    }
    if (arg === '--remove') {
        for (const f of [VBS, CMD]) { try { fs.unlinkSync(f); } catch (e) { /* 없으면 넘어간다 */ } }
        console.log(JSON.stringify({ 제거됨: true, 안내: '이미 돌고 있는 프로그램은 PC를 다시 켜면 사라집니다' }));
        return;
    }
    writeFiles();
    if (await running()) { console.log(JSON.stringify({ 등록됨: true, 실행중: true, 안내: '이미 돌고 있어 새로 띄우지 않았습니다' })); return; }
    const child = spawn('wscript', [VBS], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    await new Promise(r => setTimeout(r, 4000));
    console.log(JSON.stringify({ 등록됨: true, 실행중: await running(), 시작파일: VBS }, null, 1));
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
