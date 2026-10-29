// #917 노트북 살아 있음 신호 — 노트북(대표 PC)이 켜져 있으면 나스 터미널(총괄·워커 세션)이 켜지지 않게(대표 10/29 「노트북 켜 있으면 나스 터미널이 꺼지도록」).
//   등록: node scripts/desk/install-notebook-alive.js --install
//   상태: node scripts/desk/install-notebook-alive.js --status     (등록 여부 · 다음 실행 · 마지막 결과 · 오늘 로그 끝 · DB 0)
//   제거: node scripts/desk/install-notebook-alive.js --remove
//   한 번: node scripts/desk/install-notebook-alive.js --tick       (작업이 부르는 것 = 실DB agent_office_config 'notebook_alive' 한 줄 UPSERT)
// 방식: 작업 이름 「아꼼이-노트북-알림」 · 로그온 때 + 2분마다(끝없이 반복) · 로그인 세션에서 · 창 없음(wscript → vbs → node · install-keyword-rank.js 와 같은 꼴).
//       노트북이 꺼지거나 잠들면 작업도 멈춰 신호가 끊긴다 → 나스 sessions.js(워커3)가 「at 이 5분 안이면 노트북 켜짐」으로 보고 나스 터미널을 켜지 않거나 끈다.
// --tick 이 쓰는 것 = 이 키 하나 { at: ISO, host: 컴퓨터 이름 } · 감사 기록 없음 · 실패는 조용히(로그 한 줄) · 10초 넘으면 스스로 끝.
//   로그 = ~/.akkome/logs/notebook-alive-YYYY-MM-DD.log(하루 1파일 · 한 번에 한 줄).
const fs = require('fs'), os = require('os'), path = require('path'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const TASK = '아꼼이-노트북-알림';
const DIR = path.join(os.homedir(), '.akkome');
const LOG_DIR = path.join(DIR, 'logs');
const VBS = path.join(DIR, 'notebook-alive.vbs'), XML = path.join(DIR, 'notebook-alive-task.xml');
const KEY = 'notebook_alive';
const sch = a => execFileSync('schtasks.exe', a, { encoding: 'buffer', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const ko = buf => { try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { return buf.toString('utf8'); } };   // schtasks 출력은 CP949
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString();
const logFile = () => path.join(LOG_DIR, `notebook-alive-${kst().slice(0, 10)}.log`);
const logLine = msg => { try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(logFile(), kst().slice(0, 19) + ' ' + msg + '\n'); } catch (e) { /* 로그 실패는 무시 */ } };

function writeFiles() {
    fs.mkdirSync(DIR, { recursive: true });
    const q = s => '""' + s + '""';
    // 결과는 --tick 이 날짜 로그에 직접 쓴다 → vbs 는 창 없이 띄우고 끝날 때까지 기다리기만
    const run = 'Set s = CreateObject("WScript.Shell")\r\n'
        + 's.CurrentDirectory = "' + ROOT + '"\r\n'
        // 🔴 명령이 따옴표로 시작하면 cmd /c 가 앞뒤 따옴표를 벗겨 경로가 깨진다 → chcp 를 앞에(install-ship-upload 와 같은 꼴)
        + 'rc = s.Run("cmd /d /c chcp 65001>nul & ' + q(process.execPath) + ' ' + q(__filename) + ' --tick", 0, True)\r\n'
        + 'WScript.Quit rc\r\n';
    fs.writeFileSync(VBS, '﻿' + run, 'utf16le');
    const user = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + (process.env.USERNAME || os.userInfo().username);
    const start = kst().slice(0, 10) + 'T00:00:00';
    const xml = '<?xml version="1.0" encoding="UTF-16"?>\r\n'
        + '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n'
        + ' <RegistrationInfo><Description>노트북이 켜져 있다는 신호를 2분마다 회사프로그램 DB(notebook_alive)에 적습니다 — 켜져 있으면 나스 터미널이 켜지지 않습니다 (#917)</Description></RegistrationInfo>\r\n'
        + ' <Triggers>\r\n'
        + '  <TimeTrigger><StartBoundary>' + start + '</StartBoundary><Enabled>true</Enabled><Repetition><Interval>PT2M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>\r\n'
        + '  <LogonTrigger><Enabled>true</Enabled><UserId>' + xmlEsc(user) + '</UserId></LogonTrigger>\r\n'
        + ' </Triggers>\r\n'
        + ' <Principals><Principal id="Author"><UserId>' + xmlEsc(user) + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n'
        + ' <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'
        + '<StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><ExecutionTimeLimit>PT1M</ExecutionTimeLimit><Enabled>true</Enabled><Hidden>false</Hidden></Settings>\r\n'
        + ' <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "' + xmlEsc(VBS) + '"</Arguments><WorkingDirectory>' + xmlEsc(ROOT) + '</WorkingDirectory></Exec></Actions>\r\n'
        + '</Task>\r\n';
    fs.writeFileSync(XML, '﻿' + xml, 'utf16le');
}
function status() {
    let info = null, registered = false;
    try { const t = ko(sch(['/Query', '/TN', TASK, '/FO', 'LIST', '/V'])); registered = true; info = {}; for (const line of t.split(/\r?\n/)) { const m = line.match(/^(다음 실행 시간|마지막 실행 시간|마지막 결과|상태|Next Run Time|Last Run Time|Last Result|Status)\s*:\s*(.*)$/); if (m) info[m[1]] = m[2].trim(); } }
    catch (e) { registered = false; }
    let tail = null; try { tail = fs.readFileSync(logFile(), 'utf8').trim().split('\n').slice(-3).join('\n'); } catch (e) { /* 오늘 아직 없음 */ }
    return { 작업: TASK, 등록됨: registered, 정보: info, 실행파일: VBS, 오늘로그: logFile(), 로그끝: tail };
}
async function tick() {
    const kill = setTimeout(() => { logLine('실패: 10초 넘음'); process.exit(0); }, 10000);
    const value = { at: new Date().toISOString(), host: os.hostname() };
    try {
        const { pool } = require('./_db.js');
        try {
            await pool.query(`INSERT INTO agent_office_config (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
                              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [KEY, JSON.stringify(value)]);
            logLine('ok ' + value.at);
        } finally { try { await pool.end(); } catch (e) { /* 무시 */ } }
    } catch (e) { logLine('실패: ' + String(e.message || e).slice(0, 150)); }
    // 14일 지난 날짜 로그는 지운다(이 작업 로그만 · 2분마다 한 줄이라 하루 720줄)
    try { const cut = Date.now() - 14 * 86400e3; for (const n of fs.readdirSync(LOG_DIR)) if (/^notebook-alive-\d{4}-\d{2}-\d{2}\.log$/.test(n) && fs.statSync(path.join(LOG_DIR, n)).mtimeMs < cut) fs.unlinkSync(path.join(LOG_DIR, n)); } catch (e) { /* 무시 */ }
    clearTimeout(kill);
}
const arg = process.argv[2];
(async () => {
    if (arg === '--install') {
        writeFiles(); sch(['/Create', '/TN', TASK, '/XML', XML, '/F']);
        console.log(JSON.stringify(Object.assign({ 설치됨: true, 안내: '로그온 때와 2분마다 노트북 신호를 적습니다. 지금 한 번 = --tick' }, status()), null, 1));
    } else if (arg === '--remove') {
        try { sch(['/Delete', '/TN', TASK, '/F']); } catch (e) { /* 없으면 넘어간다 */ }
        for (const f of [VBS, XML]) { try { fs.unlinkSync(f); } catch (e) { /* 없으면 넘어간다 */ } }
        console.log(JSON.stringify({ 제거됨: true, 안내: '신호가 멈춰 5분 뒤부터 나스 터미널을 켤 수 있습니다' }));
    } else if (arg === '--status') {
        console.log(JSON.stringify(status(), null, 1));
    } else if (arg === '--print') {
        writeFiles(); console.log(JSON.stringify({ vbs: VBS, xml: XML, 등록명령: 'schtasks /Create /TN "' + TASK + '" /XML "' + XML + '" /F' }, null, 1));
    } else if (arg === '--tick') {
        await tick();
    } else console.log('사용: install-notebook-alive.js --install | --status | --remove | --tick | --print');
})().catch(e => { console.log(JSON.stringify({ ok: false, error: ko(e.stderr || Buffer.from(String(e.message))).trim().slice(0, 300) })); process.exit(1); });
