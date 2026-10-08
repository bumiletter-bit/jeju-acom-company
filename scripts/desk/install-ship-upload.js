// #594 송장 올리기를 이 PC 작업 스케줄러에 등록한다 — 매일 14:30 + 로그온 때 한 번, 창 없이 ship-upload.js --days 3 을 돌린다.
//   등록: node scripts/desk/install-ship-upload.js --install
//   상태: node scripts/desk/install-ship-upload.js --status      (등록 여부 · 다음 실행 · 마지막 실행 결과 · 로그 끝)
//   제거: node scripts/desk/install-ship-upload.js --remove
//   지금 한 번: node scripts/desk/install-ship-upload.js --run   (등록된 작업을 바로 실행)
// 방식: 작업 이름 「아꼼이-송장-올리기」. 작업은 wscript 로 vbs 한 장을 부르고, vbs 가 창 없이 node 를 띄워 결과를 로그에 남긴다
//       (경로에 한글이 있어 .cmd 는 쓰지 않는다 · vbs 와 작업 XML 은 UTF-16 으로 저장 — install-launcher.js 와 같은 이유).
//       14:30 에 PC 가 꺼져 있었으면 켜진 뒤 바로 한 번 돈다(StartWhenAvailable). 창구 대기 프로그램과는 무관하다.
const fs = require('fs'), os = require('os'), path = require('path'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const TASK = '아꼼이-송장-올리기';
const DIR = path.join(os.homedir(), '.akkome');
const VBS = path.join(DIR, 'ship-upload.vbs'), LOG = path.join(DIR, 'ship-upload.log'), XML = path.join(DIR, 'ship-upload-task.xml');
const SCRIPT = path.join(ROOT, 'scripts', 'desk', 'ship-upload.js');
const sch = a => execFileSync('schtasks.exe', a, { encoding: 'buffer', windowsHide: true });
const ko = buf => { try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { return buf.toString('utf8'); } };   // schtasks 출력은 CP949
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function writeFiles() {
    fs.mkdirSync(DIR, { recursive: true });
    // vbs: 로그가 200KB 를 넘으면 비우고, node 를 창 없이 돌려 끝날 때까지 기다린 뒤 결과(JSON)를 로그에 덧붙인다
    const q = s => '""' + s + '""';
    // cmd /c 로 돌리되 명령 줄을 vbs(UTF-16) 안에서 넘겨 한글 경로가 깨지지 않게 한다(창 0 · 끝날 때까지 기다림)
    const run = 'Set fso = CreateObject("Scripting.FileSystemObject")\r\n'
        + 'Set s = CreateObject("WScript.Shell")\r\n'
        + 's.CurrentDirectory = "' + ROOT + '"\r\n'
        + 'logf = "' + LOG + '"\r\n'
        + 'If fso.FileExists(logf) Then\r\n  If fso.GetFile(logf).Size > 200000 Then fso.DeleteFile logf\r\nEnd If\r\n'
        + 'rc = s.Run("cmd /d /c chcp 65001>nul & echo [%date% %time%]>>' + q(LOG) + ' & ' + q(process.execPath) + ' ' + q(SCRIPT) + ' --days 3 >>' + q(LOG) + ' 2>&1", 0, True)\r\n'
        + 'WScript.Quit rc\r\n';
    fs.writeFileSync(VBS, '﻿' + run, 'utf16le');
    const user = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + (process.env.USERNAME || os.userInfo().username);
    const start = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) + 'T14:30:00';
    const xml = '<?xml version="1.0" encoding="UTF-16"?>\r\n'
        + '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n'
        + ' <RegistrationInfo><Description>송장 색인의 최근 3일 운송장을 회사프로그램 DB(delivery_shipments)에 올립니다 (#594)</Description></RegistrationInfo>\r\n'
        + ' <Triggers>\r\n'
        + '  <CalendarTrigger><StartBoundary>' + start + '</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>\r\n'
        + '  <LogonTrigger><Enabled>true</Enabled><UserId>' + xmlEsc(user) + '</UserId><Delay>PT3M</Delay></LogonTrigger>\r\n'
        + ' </Triggers>\r\n'
        + ' <Principals><Principal id="Author"><UserId>' + xmlEsc(user) + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n'
        + ' <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'
        + '<StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><ExecutionTimeLimit>PT1H</ExecutionTimeLimit><Enabled>true</Enabled><Hidden>false</Hidden></Settings>\r\n'
        + ' <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "' + xmlEsc(VBS) + '"</Arguments><WorkingDirectory>' + xmlEsc(ROOT) + '</WorkingDirectory></Exec></Actions>\r\n'
        + '</Task>\r\n';
    fs.writeFileSync(XML, '﻿' + xml, 'utf16le');
}
function status() {
    let info = null, registered = false;
    try { const t = ko(sch(['/Query', '/TN', TASK, '/FO', 'LIST', '/V'])); registered = true; info = {}; for (const line of t.split(/\r?\n/)) { const m = line.match(/^(다음 실행 시간|마지막 실행 시간|마지막 결과|상태|Next Run Time|Last Run Time|Last Result|Status)\s*:\s*(.*)$/); if (m) info[m[1]] = m[2].trim(); } }
    catch (e) { registered = false; }
    let tail = null; try { const t = fs.readFileSync(LOG, 'utf8'); tail = t.slice(-700); } catch (e) { /* 아직 돈 적 없음 */ }
    return { 작업: TASK, 등록됨: registered, 정보: info, 실행파일: VBS, 로그: LOG, 로그끝: tail };
}
const arg = process.argv[2];
try {
    if (arg === '--install') {
        writeFiles(); sch(['/Create', '/TN', TASK, '/XML', XML, '/F']);
        console.log(JSON.stringify(Object.assign({ 설치됨: true, 안내: '매일 14:30 과 로그온 3분 뒤에 최근 3일 송장을 올립니다. 지금 한 번 돌리려면 --run' }, status()), null, 1));
    } else if (arg === '--remove') {
        try { sch(['/Delete', '/TN', TASK, '/F']); } catch (e) { /* 없으면 넘어간다 */ }
        for (const f of [VBS, XML]) { try { fs.unlinkSync(f); } catch (e) { /* 없으면 넘어간다 */ } }
        console.log(JSON.stringify({ 제거됨: true, 로그: LOG + ' (남겨 둠)' }));
    } else if (arg === '--run') {
        sch(['/Run', '/TN', TASK]); console.log(JSON.stringify({ 실행요청: true, 안내: '1~3분 뒤 --status 의 로그끝을 보세요' }));
    } else if (arg === '--status') {
        console.log(JSON.stringify(status(), null, 1));
    } else if (arg === '--print') {   // 등록하지 않고 만들 파일만 써 보고 등록 명령을 보여 준다
        writeFiles(); console.log(JSON.stringify({ vbs: VBS, xml: XML, 등록명령: 'schtasks /Create /TN "' + TASK + '" /XML "' + XML + '" /F' }, null, 1));
    } else console.log('사용: install-ship-upload.js --install | --status | --remove | --run | --print');
} catch (e) { console.log(JSON.stringify({ ok: false, error: ko(e.stderr || Buffer.from(String(e.message))).trim().slice(0, 300) })); process.exit(1); }
