// #916-B 키워드 순위(#910)를 이 PC(노트북) 작업 스케줄러에 등록한다 — 창구가 나스로 가도 어사이드 일은 노트북에 남기 때문(설계서 docs/914-nas-desk-docker.md 1-0절 ①).
//   등록: node scripts/desk/install-keyword-rank.js --install     🔴 전환 날 총괄만(지금은 노트북 창구 launcher rankMaybe 가 돈다 — 둘 다 켜면 같은 날 두 번 수집될 수 있음)
//   상태: node scripts/desk/install-keyword-rank.js --status      (등록 여부 · 다음 실행 · 마지막 실행 결과 · 로그 끝 · DB 0)
//   제거: node scripts/desk/install-keyword-rank.js --remove
//   지금 한 번: node scripts/desk/install-keyword-rank.js --run   (등록된 작업을 바로 실행)
//   미리 보기: node scripts/desk/install-keyword-rank.js --print  (등록하지 않고 vbs·xml 만 써 보고 등록 명령을 보여 준다)
//   작업이 부르는 것: node scripts/desk/install-keyword-rank.js --tick  (아래 규칙대로 keyword-rank.js --apply 를 한 번 띄운다)
// 방식: 작업 이름 「아꼼이-키워드-순위」 · 매일 09:30 · 로그인 세션에서(InteractiveToken — 어사이드는 화면 있는 앱이라 로그인 세션이어야 뜬다).
//       노트북이 09:30 에 꺼져 있었으면 그날은 건너뛴다(StartWhenAvailable false · 로그온 트리거 없음) → 서버 10:00 「미수집」 알림이 알려 준다.
//       wscript 로 vbs 한 장 → vbs 가 창 없이 node(이 파일 --tick)를 띄워 끝날 때까지 기다린다(install-ship-upload.js 와 같은 꼴 · 경로에 한글이 있어 vbs·xml 은 UTF-16).
// --tick 규칙 = launcher.js rankMaybe 와 같게: 설정 keyword_rank.enabled === true 일 때만 · KST 가 설정 time(기본 09:30) 지났을 때만 ·
//       하루 표시 파일 ~/.akkome/keyword-rank.json 을 rankMaybe 와 함께 쓴다(오늘 이미 돈 날이면 건너뜀 → 노트북 창구가 아직 살아 있어도 같은 날 두 번 돌 일이 거의 없다 · 같은 분에 둘이 동시에 읽는 틈은 남으니 등록은 전환 날 노트북 창구를 내린 뒤) ·
//       결과는 ~/.akkome/logs/keyword-rank-YYYY-MM-DD.log(rankMaybe 와 같은 자리) · 20분 넘으면 자식 트리째 끈다(aside 포함). DB 는 설정 한 줄 읽기만(쓰기는 keyword-rank.js 의 종전 저장 그대로).
const fs = require('fs'), os = require('os'), path = require('path'); const { execFileSync, spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const TASK = '아꼼이-키워드-순위';
const DIR = path.join(os.homedir(), '.akkome');
const LOG_DIR = path.join(DIR, 'logs');
const VBS = path.join(DIR, 'keyword-rank-task.vbs'), LOG = path.join(DIR, 'keyword-rank-task.log'), XML = path.join(DIR, 'keyword-rank-task.xml');
const KR_STATE = path.join(DIR, 'keyword-rank.json');   // launcher.js rankMaybe 와 같은 파일(하루 한 번 표시)
const SCRIPT = path.join(ROOT, 'scripts', 'desk', 'keyword-rank.js');
const sch = a => execFileSync('schtasks.exe', a, { encoding: 'buffer', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });   // stderr 도 잡아 둔다(미등록 때 「작업을 찾을 수 없습니다」가 화면에 새지 않게)
const ko = buf => { try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { return buf.toString('utf8'); } };   // schtasks 출력은 CP949
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const now = () => new Date().toISOString();

function writeFiles() {
    fs.mkdirSync(DIR, { recursive: true });
    const q = s => '""' + s + '""';
    // 로그가 200KB 를 넘으면 비우고, node(이 파일 --tick)를 창 없이 돌려 끝날 때까지 기다린다
    const run = 'Set fso = CreateObject("Scripting.FileSystemObject")\r\n'
        + 'Set s = CreateObject("WScript.Shell")\r\n'
        + 's.CurrentDirectory = "' + ROOT + '"\r\n'
        + 'logf = "' + LOG + '"\r\n'
        + 'If fso.FileExists(logf) Then\r\n  If fso.GetFile(logf).Size > 200000 Then fso.DeleteFile logf\r\nEnd If\r\n'
        + 'rc = s.Run("cmd /d /c chcp 65001>nul & echo [%date% %time%]>>' + q(LOG) + ' & ' + q(process.execPath) + ' ' + q(__filename) + ' --tick >>' + q(LOG) + ' 2>&1", 0, True)\r\n'
        + 'WScript.Quit rc\r\n';
    fs.writeFileSync(VBS, '﻿' + run, 'utf16le');
    const user = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + (process.env.USERNAME || os.userInfo().username);
    const start = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) + 'T09:30:00';
    const xml = '<?xml version="1.0" encoding="UTF-16"?>\r\n'
        + '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n'
        + ' <RegistrationInfo><Description>네이버 키워드 순위를 어사이드로 읽어 회사프로그램 DB 에 넣습니다 (#910 · #916-B 노트북 몫)</Description></RegistrationInfo>\r\n'
        + ' <Triggers>\r\n'
        + '  <CalendarTrigger><StartBoundary>' + start + '</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>\r\n'
        + ' </Triggers>\r\n'
        + ' <Principals><Principal id="Author"><UserId>' + xmlEsc(user) + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n'
        + ' <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'
        + '<StartWhenAvailable>false</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><ExecutionTimeLimit>PT30M</ExecutionTimeLimit><Enabled>true</Enabled><Hidden>false</Hidden></Settings>\r\n'
        + ' <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "' + xmlEsc(VBS) + '"</Arguments><WorkingDirectory>' + xmlEsc(ROOT) + '</WorkingDirectory></Exec></Actions>\r\n'
        + '</Task>\r\n';
    fs.writeFileSync(XML, '﻿' + xml, 'utf16le');
}
function status() {
    let info = null, registered = false;
    try { const t = ko(sch(['/Query', '/TN', TASK, '/FO', 'LIST', '/V'])); registered = true; info = {}; for (const line of t.split(/\r?\n/)) { const m = line.match(/^(다음 실행 시간|마지막 실행 시간|마지막 결과|상태|Next Run Time|Last Run Time|Last Result|Status)\s*:\s*(.*)$/); if (m) info[m[1]] = m[2].trim(); } }
    catch (e) { registered = false; }
    let tail = null; try { tail = fs.readFileSync(LOG, 'utf8').slice(-700); } catch (e) { /* 아직 돈 적 없음 */ }
    let day = null; try { day = JSON.parse(fs.readFileSync(KR_STATE, 'utf8')); } catch (e) { /* 처음 */ }
    return { 작업: TASK, 등록됨: registered, 정보: info, 실행파일: VBS, 로그: LOG, 로그끝: tail, 하루표시: day, 수집스크립트있음: fs.existsSync(SCRIPT) };
}
// 작업 스케줄러가 부르는 한 번 — launcher.js rankMaybe 와 같은 조건으로 keyword-rank.js --apply 를 띄우고 끝날 때까지 기다린다
async function tick() {
    const k = new Date(Date.now() + 9 * 3600e3).toISOString(), today = k.slice(0, 10), hm = k.slice(11, 16);   // KST
    let last = null; try { last = JSON.parse(fs.readFileSync(KR_STATE, 'utf8')).day; } catch (e) { /* 처음 */ }
    if (last === today) return { ok: true, skip: '오늘 이미 돎(' + today + ')' };
    if (!fs.existsSync(SCRIPT)) return { ok: false, skip: 'keyword-rank.js 없음' };
    const { pool } = require('./_db.js');
    let cfg = null;
    try { cfg = (await pool.query(`SELECT value FROM agent_office_config WHERE key = 'keyword_rank'`)).rows[0]; cfg = cfg ? cfg.value : null; }
    finally { try { await pool.end(); } catch (e) { /* 무시 */ } }
    if (!cfg || cfg.enabled !== true) return { ok: true, skip: '설정 keyword_rank.enabled 꺼짐' };
    const at = /^\d{2}:\d{2}$/.test(String(cfg.time || '')) ? cfg.time : '09:30';
    if (hm < at) return { ok: true, skip: '아직 ' + at + ' 전(' + hm + ')' };
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(KR_STATE, JSON.stringify({ day: today, at: now(), by: 'task' }));
    const outPath = path.join(LOG_DIR, `keyword-rank-${today}.log`);
    const fd = fs.openSync(outPath, 'a');
    let ch;
    try { ch = spawn(process.execPath, [SCRIPT, '--apply'], { cwd: ROOT, stdio: ['ignore', fd, fd], windowsHide: true }); } finally { fs.closeSync(fd); }
    const msg = await new Promise(resolve => {
        const kill = setTimeout(() => { try { execFileSync('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch (e) { /* 이미 끝 */ } resolve('20분 넘어 끔(자식 트리 · aside 포함)'); }, 20 * 60000);
        ch.on('error', e => { clearTimeout(kill); resolve('띄우기 실패: ' + e.message); });
        ch.on('exit', code => { clearTimeout(kill); resolve(`끝(exit ${code}) · 로그 ${outPath}`); });
    });
    try { fs.writeFileSync(KR_STATE, JSON.stringify({ day: today, at: now(), by: 'task', result: msg })); } catch (e) { /* 다음 날은 그대로 */ }
    return { ok: true, ran: true, result: msg };
}
const arg = process.argv[2];
(async () => {
    if (arg === '--install') {
        writeFiles(); sch(['/Create', '/TN', TASK, '/XML', XML, '/F']);
        console.log(JSON.stringify(Object.assign({ 설치됨: true, 안내: '매일 09:30 에 키워드 순위를 한 번 수집합니다(그때 노트북이 꺼져 있으면 그날은 건너뜀). 지금 한 번 = --run' }, status()), null, 1));
    } else if (arg === '--remove') {
        try { sch(['/Delete', '/TN', TASK, '/F']); } catch (e) { /* 없으면 넘어간다 */ }
        for (const f of [VBS, XML]) { try { fs.unlinkSync(f); } catch (e) { /* 없으면 넘어간다 */ } }
        console.log(JSON.stringify({ 제거됨: true, 로그: LOG + ' (남겨 둠)' }));
    } else if (arg === '--run') {
        sch(['/Run', '/TN', TASK]); console.log(JSON.stringify({ 실행요청: true, 안내: '수집은 몇 분 걸립니다 · --status 의 로그끝을 보세요' }));
    } else if (arg === '--status') {
        console.log(JSON.stringify(status(), null, 1));
    } else if (arg === '--print') {
        writeFiles(); console.log(JSON.stringify({ vbs: VBS, xml: XML, 등록명령: 'schtasks /Create /TN "' + TASK + '" /XML "' + XML + '" /F' }, null, 1));
    } else if (arg === '--tick') {
        console.log(now() + ' ' + JSON.stringify(await tick()));
    } else console.log('사용: install-keyword-rank.js --install | --status | --remove | --run | --print | --tick');
})().catch(e => { console.log(JSON.stringify({ ok: false, error: ko(e.stderr || Buffer.from(String(e.message))).trim().slice(0, 300) })); process.exit(1); });
