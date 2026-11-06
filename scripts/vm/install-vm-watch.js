// #1041-b-A 나스 VM 러너(scripts/vm/vm-watch.js)를 VM 작업 스케줄러에 올린다(install-exp-phone-auto.js 와 같은 꼴).
//   🔴 나스 VM(어사이드 전용 PC · 사용자 akkome)에서만 등록 — 노트북·나스 창구에 등록하면 「[VM]」 지시를 엉뚱한 기계가 집는다.
//   등록: node scripts/vm/install-vm-watch.js --install   · 상태: --status(등록·다음/마지막 실행·로그 끝·.env 이름만 · DB 0)
//   제거: --remove   · 지금 띄우기: --run   · 미리 보기: --print(vbs·xml 만 쓰고 등록 명령을 보여 줌)
// 방식: 작업 「아꼼이-VM러너」 · 로그온 때 한 번 시작(LogonTrigger · 그 사용자) · 로그인 세션(InteractiveToken — 어사이드는 화면 있는 앱) ·
//   계속 도는 프로세스(ExecutionTimeLimit PT0S = 무제한) · 이미 돌면 새로 안 띄움(IgnoreNew) · 죽으면 1분 뒤 다시(RestartOnFailure 999번) ·
//   wscript → vbs(창 없이) → node vm-watch.js(끝날 때까지 기다림 · 출력 = ~/.akkome/vm-watch-task.log · 20만 바이트 넘으면 비움)
//   지시 결과 로그 = ~/.akkome/logs/vm-watch-YYYY-MM-DD.log(vm-watch.js 가 씀)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const TASK = '아꼼이-VM러너';
const DIR = path.join(os.homedir(), '.akkome');
const VBS = path.join(DIR, 'vm-watch-task.vbs'), LOG = path.join(DIR, 'vm-watch-task.log'), XML = path.join(DIR, 'vm-watch-task.xml');
const SCRIPT = path.join(ROOT, 'scripts', 'vm', 'vm-watch.js');
const ENV_KEYS = ['DATABASE_URL'];
const sch = a => execFileSync('schtasks.exe', a, { encoding: 'buffer', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const ko = buf => { try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { return buf.toString('utf8'); } };   // schtasks 출력은 CP949
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function writeFiles() {
    fs.mkdirSync(DIR, { recursive: true });
    const q = s => '""' + s + '""';
    const run = 'Set fso = CreateObject("Scripting.FileSystemObject")\r\n'
        + 'Set s = CreateObject("WScript.Shell")\r\n'
        + 's.CurrentDirectory = "' + ROOT + '"\r\n'
        + 'logf = "' + LOG + '"\r\n'
        + 'If fso.FileExists(logf) Then\r\n  If fso.GetFile(logf).Size > 200000 Then fso.DeleteFile logf\r\nEnd If\r\n'
        + 'rc = s.Run("cmd /d /c chcp 65001>nul & echo [%date% %time%] start>>' + q(LOG) + ' & ' + q(process.execPath) + ' ' + q(SCRIPT) + ' >>' + q(LOG) + ' 2>&1", 0, True)\r\n'
        + 'WScript.Quit rc\r\n';
    fs.writeFileSync(VBS, '﻿' + run, 'utf16le');
    const user = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + (process.env.USERNAME || os.userInfo().username);
    const xml = '<?xml version="1.0" encoding="UTF-16"?>\r\n'
        + '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n'
        + ' <RegistrationInfo><Description>총괄이 창구 대기열에 넣은 「[VM]」 지시를 나스 VM 어사이드로 처리합니다 (#1041-b · 나스 VM 전용)</Description></RegistrationInfo>\r\n'
        + ' <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>' + xmlEsc(user) + '</UserId><Delay>PT30S</Delay></LogonTrigger></Triggers>\r\n'
        + ' <Principals><Principal id="Author"><UserId>' + xmlEsc(user) + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n'
        + ' <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'
        + '<StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit>'
        + '<RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure><Enabled>true</Enabled><Hidden>false</Hidden></Settings>\r\n'
        + ' <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "' + xmlEsc(VBS) + '"</Arguments><WorkingDirectory>' + xmlEsc(ROOT) + '</WorkingDirectory></Exec></Actions>\r\n'
        + '</Task>\r\n';
    fs.writeFileSync(XML, '﻿' + xml, 'utf16le');
}
function envKeys() {   // 이름과 「값 있음」만(값은 찍지 않음)
    let text = ''; try { text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch (e) { return { env있음: false }; }
    const r = { env있음: true };
    for (const k of ENV_KEYS) { const m = text.match(new RegExp('^\\s*(?:export\\s+)?' + k + '\\s*=(.*)$', 'm')); r[k] = !m ? '없음' : (m[1].trim() ? '있음' : '빈 칸'); }
    return r;
}
function status() {
    let info = null, registered = false;
    try { const t = ko(sch(['/Query', '/TN', TASK, '/FO', 'LIST', '/V'])); registered = true; info = {}; for (const line of t.split(/\r?\n/)) { const m = line.match(/^(다음 실행 시간|마지막 실행 시간|마지막 결과|상태|Next Run Time|Last Run Time|Last Result|Status)\s*:\s*(.*)$/); if (m) info[m[1]] = m[2].trim(); } }
    catch (e) { registered = false; }
    let tail = null; try { tail = fs.readFileSync(LOG, 'utf8').slice(-700); } catch (e) { /* 아직 돈 적 없음 */ }
    return { 작업: TASK, 등록됨: registered, 정보: info, 실행파일: VBS, 로그: LOG, 로그끝: tail, 지시로그: path.join(DIR, 'logs', 'vm-watch-<날짜>.log'), 스크립트있음: fs.existsSync(SCRIPT), env: envKeys() };
}
const arg = process.argv[2];
(async () => {
    if (arg === '--install') {
        writeFiles(); sch(['/Create', '/TN', TASK, '/XML', XML, '/F']);
        console.log(JSON.stringify(Object.assign({ 설치됨: true, 안내: '로그온 때 시작 · 지금 띄우기 = --run' }, status()), null, 1));
    } else if (arg === '--remove') {
        try { sch(['/End', '/TN', TASK]); } catch (e) { /* 안 돌면 넘어감 */ }
        try { sch(['/Delete', '/TN', TASK, '/F']); } catch (e) { /* 없으면 넘어감 */ }
        for (const f of [VBS, XML]) { try { fs.unlinkSync(f); } catch (e) { /* 없으면 넘어감 */ } }
        console.log(JSON.stringify({ 제거됨: true, 로그: LOG + ' (남겨 둠)', 안내: '돌던 node 가 남아 있으면 작업 관리자에서 vm-watch.js node 를 끄세요(/End 는 wscript 만 끌 수 있음)' }));
    } else if (arg === '--run') {
        sch(['/Run', '/TN', TASK]); console.log(JSON.stringify({ 실행요청: true, 안내: '--status 의 로그끝 · 지시로그를 보세요' }));
    } else if (arg === '--status') {
        console.log(JSON.stringify(status(), null, 1));
    } else if (arg === '--print') {
        writeFiles(); console.log(JSON.stringify({ vbs: VBS, xml: XML, 등록명령: 'schtasks /Create /TN "' + TASK + '" /XML "' + XML + '" /F' }, null, 1));
    } else console.log('사용: install-vm-watch.js --install | --status | --remove | --run | --print');
})().catch(e => { console.log(JSON.stringify({ ok: false, error: ko(e.stderr || Buffer.from(String(e.message))).trim().slice(0, 300) })); process.exit(1); });
