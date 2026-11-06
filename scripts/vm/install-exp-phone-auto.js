// #1040-B 체험 예약 번호 자동 읽기(scripts/vm/exp-phone-auto.js · #1040-A 워커2 · 설계서 docs/1039-exp-phone-auto.md)를 나스 VM 작업 스케줄러에 올린다.
//   🔴 나스 VM(어사이드 전용 PC · 사용자 akkome)에서만 등록 — 노트북에 등록하면 어사이드 일이 두 기계에서 돈다(절차서 docs/1039-nas-aside-vm.md).
//   등록: node scripts/vm/install-exp-phone-auto.js --install     (보통은 setup-aside-vm.ps1 -Register 가 부름)
//   상태: node scripts/vm/install-exp-phone-auto.js --status      (등록 여부 · 다음 실행 · 마지막 결과 · 로그 끝 · 스크립트 있음 · .env 두 칸 이름만 · DB 0 · 서버 호출 0)
//   제거: node scripts/vm/install-exp-phone-auto.js --remove
//   지금 한 번: node scripts/vm/install-exp-phone-auto.js --run   (등록된 작업을 바로 실행)
//   미리 보기: node scripts/vm/install-exp-phone-auto.js --print  (등록하지 않고 vbs·xml 만 써 보고 등록 명령을 보여 준다)
//   작업이 부르는 것: node scripts/vm/install-exp-phone-auto.js --tick  (exp-phone-auto.js --once 를 한 번 띄우고 끝날 때까지 기다림)
// 방식(install-keyword-rank.js 와 같은 꼴): 작업 이름 「아꼼이-체험번호-자동」 · 하루 종일 10분마다(00:00 시작 · 반복 PT10M · 길이 P1D) ·
//   로그인 세션에서(InteractiveToken — 어사이드는 화면 있는 앱) · 앞 틱이 아직 돌면 새 틱은 건너뜀(IgnoreNew) · 놓친 틱은 따라잡지 않음(StartWhenAvailable false).
//   시각 판단(08~21시 · 09:25~09:45 키워드 순위 피하기 · 잠금 파일)은 exp-phone-auto.js 가 한다 — 이 도구는 시각을 안 본다.
//   한 틱 8분 넘으면 자식 트리째 끈다(aside 포함) · 결과 = ~/.akkome/logs/exp-phone-auto-YYYY-MM-DD.log(종료 코드 한 줄 · 다시 돌리지 않음).
//   wscript 로 vbs 한 장 → vbs 가 창 없이 node(이 파일 --tick)를 띄워 끝날 때까지 기다린다(경로에 한글이 있어 vbs·xml 은 UTF-16).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'); const { execFileSync, spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const TASK = '아꼼이-체험번호-자동';
const DIR = path.join(os.homedir(), '.akkome');
const LOG_DIR = path.join(DIR, 'logs');
const VBS = path.join(DIR, 'exp-phone-auto-task.vbs'), LOG = path.join(DIR, 'exp-phone-auto-task.log'), XML = path.join(DIR, 'exp-phone-auto-task.xml');
const SCRIPT = path.join(ROOT, 'scripts', 'vm', 'exp-phone-auto.js');
const TICK_LIMIT_MS = 8 * 60000;   // 10분 간격 안에서 끝나게(작업 ExecutionTimeLimit PT9M 이 그 뒤를 받친다)
const ENV_KEYS = ['EXP_AUTO_API', 'EXP_AUTO_TOKEN'];
const sch = a => execFileSync('schtasks.exe', a, { encoding: 'buffer', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const ko = buf => { try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { return buf.toString('utf8'); } };   // schtasks 출력은 CP949
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const now = () => new Date().toISOString();

function writeFiles() {
    fs.mkdirSync(DIR, { recursive: true });
    const q = s => '""' + s + '""';
    const run = 'Set fso = CreateObject("Scripting.FileSystemObject")\r\n'
        + 'Set s = CreateObject("WScript.Shell")\r\n'
        + 's.CurrentDirectory = "' + ROOT + '"\r\n'
        + 'logf = "' + LOG + '"\r\n'
        + 'If fso.FileExists(logf) Then\r\n  If fso.GetFile(logf).Size > 200000 Then fso.DeleteFile logf\r\nEnd If\r\n'
        + 'rc = s.Run("cmd /d /c chcp 65001>nul & echo [%date% %time%]>>' + q(LOG) + ' & ' + q(process.execPath) + ' ' + q(__filename) + ' --tick >>' + q(LOG) + ' 2>&1", 0, True)\r\n'
        + 'WScript.Quit rc\r\n';
    fs.writeFileSync(VBS, '﻿' + run, 'utf16le');
    const user = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + (process.env.USERNAME || os.userInfo().username);
    const start = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00';
    const xml = '<?xml version="1.0" encoding="UTF-16"?>\r\n'
        + '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n'
        + ' <RegistrationInfo><Description>체험 예약(플레이스) 번호 미입력 줄을 어사이드로 읽어 서버 API 로 저장합니다 (#1039-C · #1040 · 나스 VM 전용)</Description></RegistrationInfo>\r\n'
        + ' <Triggers>\r\n'
        + '  <CalendarTrigger><Repetition><Interval>PT10M</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>'
        + '<StartBoundary>' + start + '</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>\r\n'
        + ' </Triggers>\r\n'
        + ' <Principals><Principal id="Author"><UserId>' + xmlEsc(user) + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n'
        + ' <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'
        + '<StartWhenAvailable>false</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><ExecutionTimeLimit>PT9M</ExecutionTimeLimit><Enabled>true</Enabled><Hidden>false</Hidden></Settings>\r\n'
        + ' <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "' + xmlEsc(VBS) + '"</Arguments><WorkingDirectory>' + xmlEsc(ROOT) + '</WorkingDirectory></Exec></Actions>\r\n'
        + '</Task>\r\n';
    fs.writeFileSync(XML, '﻿' + xml, 'utf16le');
}
// .env 두 칸 = 이름과 「값 있음」만(값은 안 읽어 찍지 않음)
function envKeys() {
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
    return { 작업: TASK, 등록됨: registered, 정보: info, 실행파일: VBS, 로그: LOG, 로그끝: tail, 결과로그: path.join(LOG_DIR, 'exp-phone-auto-<날짜>.log'), 스크립트있음: fs.existsSync(SCRIPT), env: envKeys() };
}
async function tick() {
    if (!fs.existsSync(SCRIPT)) return { ok: false, skip: 'exp-phone-auto.js 없음(리포 pull 필요)' };
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // KST
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const outPath = path.join(LOG_DIR, `exp-phone-auto-${today}.log`);
    const fd = fs.openSync(outPath, 'a');
    fs.writeSync(fd, `\n--- ${now()} 틱 시작\n`);
    let ch;
    try { ch = spawn(process.execPath, [SCRIPT, '--once'], { cwd: ROOT, stdio: ['ignore', fd, fd], windowsHide: true }); } finally { fs.closeSync(fd); }
    const msg = await new Promise(resolve => {
        const kill = setTimeout(() => { try { execFileSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch (e) { /* 이미 끝 */ } resolve('8분 넘어 끔(자식 트리 · aside 포함)'); }, TICK_LIMIT_MS);
        ch.on('error', e => { clearTimeout(kill); resolve('띄우기 실패: ' + e.message); });
        ch.on('exit', code => { clearTimeout(kill); resolve(`끝(exit ${code}${code === 0 ? '' : code === 2 ? ' · 일부 실패/멈춤' : ' · 스크립트 오류'})`); });
    });
    try { fs.appendFileSync(outPath, `--- ${now()} ${msg}\n`); } catch (e) { /* 기록 실패 무시 */ }
    return { ok: true, ran: true, result: msg, log: outPath };
}
const arg = process.argv[2];
(async () => {
    if (arg === '--install') {
        writeFiles(); sch(['/Create', '/TN', TASK, '/XML', XML, '/F']);
        console.log(JSON.stringify(Object.assign({ 설치됨: true, 안내: '하루 종일 10분마다 한 번(시각 판단은 exp-phone-auto.js). 지금 한 번 = --run' }, status()), null, 1));
    } else if (arg === '--remove') {
        try { sch(['/Delete', '/TN', TASK, '/F']); } catch (e) { /* 없으면 넘어간다 */ }
        for (const f of [VBS, XML]) { try { fs.unlinkSync(f); } catch (e) { /* 없으면 넘어간다 */ } }
        console.log(JSON.stringify({ 제거됨: true, 로그: LOG + ' (남겨 둠)' }));
    } else if (arg === '--run') {
        sch(['/Run', '/TN', TASK]); console.log(JSON.stringify({ 실행요청: true, 안내: '--status 의 로그끝 · 결과로그를 보세요' }));
    } else if (arg === '--status') {
        console.log(JSON.stringify(status(), null, 1));
    } else if (arg === '--print') {
        writeFiles(); console.log(JSON.stringify({ vbs: VBS, xml: XML, 등록명령: 'schtasks /Create /TN "' + TASK + '" /XML "' + XML + '" /F' }, null, 1));
    } else if (arg === '--tick') {
        console.log(now() + ' ' + JSON.stringify(await tick()));
    } else console.log('사용: install-exp-phone-auto.js --install | --status | --remove | --run | --print | --tick');
})().catch(e => { console.log(JSON.stringify({ ok: false, error: ko(e.stderr || Buffer.from(String(e.message))).trim().slice(0, 300) })); process.exit(1); });
