# #1039-B 나스 윈도우 VM(어사이드 전용 PC) 1회 세팅 — 절차서 docs/1039-nas-aside-vm.md
#   VM(윈도우 11 · 로컬 계정 akkome)에서 「관리자 PowerShell」로:
#     powershell -NoProfile -ExecutionPolicy Bypass -File setup-aside-vm.ps1 -KeyDir E:\akm-vm            (첫 회 · 작업 등록 안 함 = 권장)
#     powershell -NoProfile -ExecutionPolicy Bypass -File setup-aside-vm.ps1 -Register                    (전환 날 · 09:30 작업 등록)
#   미리 보기(설치·복사·등록 0):  ... -File setup-aside-vm.ps1 -DryRun   (또는 -WhatIf · 노트북에서 -Root <리포> 로 점검표만 볼 수 있음)
#   다시 돌려도 안전(멱등): 있는 것은 건너뛰고 · 리포는 git pull --ff-only · .env 는 없을 때만 복사(-ForceEnv 로 덮음) · 작업은 /F 로 같은 이름 덮어 등록.
# 하는 일: ①사용자·관리자 확인 ②Node LTS·git(없으면 winget) ③리포 clone/pull ④npm ci(pg·dotenv 없을 때만) ⑤.env(USB 꾸러미에서) + 권한 좁힘
#          ⑥aside.exe 찾기(기본 자리 아니면 사용자 환경 변수 ASIDE_EXE) ⑦전원(절전·화면·디스크·최대 절전 끄기 없음) ⑧-Register 면 install-keyword-rank.js --install ⑨점검표
# 🔴 등록하지 않는 것(이 VM 에서 금지): install-notebook-alive.js(노트북 켜짐 신호 · VM 이 보내면 나스 터미널 켜기 판정이 꼬임) ·
#     install-ship-upload.js(송장 올리기 = 나스 컨테이너 몫) · install-launcher.js(창구 = 나스 컨테이너 몫). 있으면 점검표가 빨갛게 알림.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Root = 'C:\akkome\회사프로그램',
    [string]$KeyDir = '',
    [string]$ExpectUser = 'akkome',
    [string]$RepoUrl = 'https://github.com/bumiletter-bit/jeju-acom-company.git',
    [switch]$Register,
    [switch]$ForceEnv,
    [switch]$ForceRegister,
    [switch]$Reinstall,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$Dry = $DryRun -or $WhatIfPreference
$WhatIfPreference = $false   # 아래 Copy-Item 등이 스스로 건너뛰지 않게 — 드라이 판정은 $Dry 하나로
$script:Warn = New-Object System.Collections.ArrayList

function Say([string]$m) { Write-Host $m }
function Bad([string]$m) { Write-Host ('  ! ' + $m) -ForegroundColor Yellow; [void]$script:Warn.Add($m) }
function Act([string]$what, [scriptblock]$sb) {
    if ($Dry) { Write-Host ('  [드라이] ' + $what) -ForegroundColor Cyan; return }
    Write-Host ('  > ' + $what); & $sb
}
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Has-Cmd([string]$n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }
function Task-Exists([string]$name) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & cmd.exe /d /c ('schtasks /Query /TN "' + $name + '" >nul 2>nul')
    $ok = ($LASTEXITCODE -eq 0); $ErrorActionPreference = $old; return $ok
}
function Run-Native([string]$exe, [string[]]$a) {
    & $exe @a
    if ($LASTEXITCODE -ne 0) { throw ($exe + ' 실패(exit ' + $LASTEXITCODE + ')') }
}

Say ('#1039-B 어사이드 VM 세팅 ' + $(if ($Dry) { '(드라이 · 바꾸는 것 0)' } else { '' }) + ' · 리포 ' + $Root)

# ① 사용자·관리자 — 작업 스케줄러 작업은 「지금 사용자」 로그인 세션에 묶이고, 로그·하루 표시는 그 사용자 집(~/.akkome)에 쌓인다
$user = $env:USERNAME
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say ('1) 사용자 ' + $user + ' · 관리자 ' + $isAdmin + ' · 집 ' + $env:USERPROFILE)
if ($user -ne $ExpectUser) {
    if ($Dry) { Bad ('사용자가 ' + $ExpectUser + ' 가 아님(드라이라 계속) — VM 에서는 ' + $ExpectUser + ' 로 로그인한 창에서 돌릴 것') }
    else { throw ('사용자가 ' + $ExpectUser + ' 가 아닙니다(' + $user + '). 다른 관리자 계정으로 올린 창이면 작업이 그 계정에 묶입니다 — ' + $ExpectUser + ' 로 로그인 → 관리자 PowerShell 로 다시') }
}
if (-not $isAdmin -and -not $Dry) { throw '관리자 PowerShell 로 열어 주세요(winget 설치·전원 설정)' }

# ② Node LTS · git
Say '2) Node · git'
Refresh-Path
if (-not (Has-Cmd 'winget') -and (-not (Has-Cmd 'node') -or -not (Has-Cmd 'git'))) { Bad 'winget 없음 — Microsoft Store 「앱 설치 관리자」 업데이트 뒤 다시(또는 Node·git 을 손으로 설치)' }
if (Has-Cmd 'node') { Say ('  node ' + (& node -v) + ' 있음') }
else { Act 'winget install OpenJS.NodeJS.LTS' { Run-Native 'winget' @('install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements'); Refresh-Path } }
if (Has-Cmd 'git') { Say ('  ' + (& git --version) + ' 있음') }
else { Act 'winget install Git.Git' { Run-Native 'winget' @('install', '--id', 'Git.Git', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements'); Refresh-Path } }

# ③ 리포 — PUBLIC 이라 https 로 받기만(push 안 함 · 이 VM 에서 코드 고치지 않음)
Say '3) 리포'
if (Test-Path (Join-Path $Root '.git')) {
    Act ('git pull --ff-only (' + $Root + ')') { Run-Native 'git' @('-C', $Root, 'pull', '--ff-only') }
} elseif (Test-Path $Root) {
    if ((Get-ChildItem -Force $Root | Measure-Object).Count -gt 0) { throw ($Root + ' 이 비어 있지 않은데 git 리포가 아닙니다 — 확인 뒤 비우거나 -Root 로 다른 자리') }
    Act ('git clone → ' + $Root) { Run-Native 'git' @('clone', '--depth', '50', $RepoUrl, $Root) }
} else {
    Act ('git clone → ' + $Root) { New-Item -ItemType Directory -Force (Split-Path $Root) | Out-Null; Run-Native 'git' @('clone', '--depth', '50', $RepoUrl, $Root) }
}

# ④ npm — keyword-rank.js 가 쓰는 것은 pg·dotenv 뿐(_db.js) · 있으면 건너뜀
Say '4) npm'
$needNpm = $Reinstall -or -not ((Test-Path (Join-Path $Root 'node_modules\pg\package.json')) -and (Test-Path (Join-Path $Root 'node_modules\dotenv\package.json')))
if ($needNpm) { Act 'npm ci --omit=dev --ignore-scripts' { Push-Location $Root; try { Run-Native 'npm.cmd' @('ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund') } finally { Pop-Location } } }
else { Say '  node_modules pg·dotenv 있음 — 건너뜀(-Reinstall 로 다시)' }

# ⑤ .env — USB 꾸러미(-KeyDir)의 .env(make-vm-env.js 로 만든 DATABASE_URL 한 줄)를 리포 자리로
Say '5) .env'
$envPath = Join-Path $Root '.env'
if ($KeyDir) {
    $srcEnv = Join-Path $KeyDir '.env'
    if (-not (Test-Path $srcEnv)) { Bad ('꾸러미에 .env 없음: ' + $srcEnv) }
    elseif ((Test-Path $envPath) -and -not $ForceEnv) { Say '  .env 이미 있음 — 그대로(-ForceEnv 로 덮음)' }
    else {
        Act ('.env 복사 ← ' + $srcEnv) {
            Copy-Item -Force $srcEnv $envPath
            & icacls.exe $envPath /inheritance:r /grant:r ($user + ':(R,W)') 'SYSTEM:(F)' '*S-1-5-32-544:(F)' | Out-Null   # 이 사용자·SYSTEM·Administrators 만
        }
    }
} elseif (-not (Test-Path $envPath)) { Bad '.env 없음 — -KeyDir <USB 꾸러미 폴더> 로 다시' }

# ⑥ aside.exe — keyword-rank.js 50행: env ASIDE_EXE 없으면 %LOCALAPPDATA%\Aside\CLI\current\aside.exe (🔴 .env 에 넣으면 효과 0 · 사용자 환경 변수만)
Say '6) 어사이드'
$asideDefault = Join-Path $env:LOCALAPPDATA 'Aside\CLI\current\aside.exe'
$asideUserEnv = [Environment]::GetEnvironmentVariable('ASIDE_EXE', 'User')
$aside = $null
if ($asideUserEnv -and (Test-Path $asideUserEnv)) { $aside = $asideUserEnv; Say ('  ASIDE_EXE(사용자 환경 변수) = ' + $aside) }
elseif (Test-Path $asideDefault) { $aside = $asideDefault; Say ('  기본 자리 ' + $aside) }
else {
    $found = $null
    foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $base -or -not (Test-Path $base)) { continue }
        $found = Get-ChildItem -Path $base -Filter 'aside.exe' -Recurse -Depth 5 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { break }
    }
    if ($found) {
        $aside = $found.FullName
        Act ('사용자 환경 변수 ASIDE_EXE = ' + $aside) { [Environment]::SetEnvironmentVariable('ASIDE_EXE', $aside, 'User'); $env:ASIDE_EXE = $aside }
    } else { Bad 'aside.exe 못 찾음 — 대표 몫: 어사이드 설치·로그인 뒤 이 스크립트 다시' }
}

# ⑦ 시간대·전원 — 작업 09:30 은 VM 현지 시각(tick 은 KST 고정 계산) → 시간대가 KST 가 아니면 엇갈림 · 09:30 에 잠들어 있으면 그날 건너뜀(StartWhenAvailable false)
Say '7) 시간대·전원'
if ((Get-TimeZone).Id -ne 'Korea Standard Time') { Act 'Set-TimeZone Korea Standard Time' { Set-TimeZone -Id 'Korea Standard Time' } } else { Say '  시간대 KST 있음' }
foreach ($k in @('standby-timeout-ac', 'standby-timeout-dc', 'monitor-timeout-ac', 'monitor-timeout-dc', 'disk-timeout-ac', 'disk-timeout-dc', 'hibernate-timeout-ac', 'hibernate-timeout-dc')) {
    Act ('powercfg /change ' + $k + ' 0') { & powercfg.exe /change $k 0 | Out-Null }
}

# ⑧ 09:30 작업 등록 — -Register 일 때만(전환 날 · 절차서 5절 순서)
Say '8) 키워드 순위 작업'
$inst = Join-Path $Root 'scripts\desk\install-keyword-rank.js'
if ($Register) {
    if (-not $aside -and -not $ForceRegister) { Bad 'aside.exe 없이 등록 안 함 — 09:30 에 전부 오류로 keyword_rank_last 를 덮음(-ForceRegister 로 강제)' }
    elseif (-not (Test-Path $envPath) -and -not $Dry) { Bad '.env 없이 등록 안 함' }
    else { Act 'node install-keyword-rank.js --install' { Push-Location $Root; try { Run-Native 'node' @($inst, '--install') | Out-Null } finally { Pop-Location } } }
} else { Say '  -Register 없음 — 등록 안 함(전환 날 -Register 로 다시)' }

# ⑨ 점검표
Say ''
Say '──── 점검표 ────'
$rows = New-Object System.Collections.ArrayList
function Row([string]$k, [bool]$ok, [string]$v) { [void]$rows.Add([pscustomobject]@{ 항목 = $k; 결과 = $(if ($ok) { 'OK' } else { 'X' }); 값 = $v }) }
Refresh-Path
$nodeV = ''; if (Has-Cmd 'node') { $nodeV = (& node -v) }
Row 'node' ([bool]$nodeV) $nodeV
$gitV = ''; if (Has-Cmd 'git') { $gitV = (& git --version) }
Row 'git' ([bool]$gitV) $gitV
Row '리포' (Test-Path (Join-Path $Root 'scripts\desk\keyword-rank.js')) $Root
Row 'pg·dotenv' ((Test-Path (Join-Path $Root 'node_modules\pg\package.json')) -and (Test-Path (Join-Path $Root 'node_modules\dotenv\package.json'))) 'node_modules'
$envOk = $false; $envKeys = '없음'
if ((Test-Path $envPath) -and $nodeV) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $chk = & node (Join-Path $Root 'scripts\vm\make-vm-env.js') --check $envPath
    $ErrorActionPreference = $old
    try { $j = $chk | ConvertFrom-Json; $envOk = [bool]$j.ok; $envKeys = 'ok ' + $j.ok + ' · 칸 ' + ($j.keys.Count) + '개 · 없음 ' + (($j.missing) -join ',') } catch { $envKeys = '읽기 실패' }
}
Row '.env(DATABASE_URL)' $envOk $envKeys
Row 'aside.exe' ([bool]$aside) $(if ($aside) { $aside } else { '없음' })
$st = $null
if ($nodeV -and (Test-Path $inst)) { try { $st = (& node $inst --status) -join "`n" | ConvertFrom-Json } catch { $st = $null } }
$reg = $false; $next = ''
if ($st) { $reg = [bool]$st.'등록됨'; if ($st.'정보') { $next = [string]$st.'정보'.'다음 실행 시간'; if (-not $next) { $next = [string]$st.'정보'.'Next Run Time' } } }
Row '작업 아꼼이-키워드-순위' ($reg -or -not $Register) $(if ($reg) { '다음 ' + $next } else { '미등록' + $(if ($Register) { '' } else { '(-Register 안 씀 · 정상)' }) })
$al = ''; try { $w = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction Stop; $al = [string]$w.AutoAdminLogon + ' · ' + [string]$w.DefaultUserName } catch { }
Row '자동 로그인(재부팅 뒤 세션)' ($al -like ('1 · ' + $ExpectUser)) $(if ($al) { $al } else { '설정 없음 — 대표 몫(절차서 6절)' })
$pc = (& powercfg.exe /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -join ' '
Row '시간대 KST' ((Get-TimeZone).Id -eq 'Korea Standard Time') ((Get-TimeZone).Id)
Row '전원 절전(AC)' ($pc -match '0x00000000') $(if ($pc -match '0x00000000') { '끄기 없음' } else { '확인 필요' })
# 🔴 금지 — 이 VM 에 있으면 안 되는 것
$noAlive = -not (Task-Exists '아꼼이-노트북-알림')
$noShip = -not (Task-Exists '아꼼이-송장-올리기')
$noDesk = -not (Test-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\아꼼이-창구-대기.vbs'))
Row '금지: 아꼼이-노트북-알림 없음' $noAlive $(if ($noAlive) { '없음' } else { '있음 → node scripts\desk\install-notebook-alive.js --remove' })
Row '금지: 아꼼이-송장-올리기 없음' $noShip $(if ($noShip) { '없음' } else { '있음 → node scripts\desk\install-ship-upload.js --remove' })
Row '금지: 창구 대기(launcher) 없음' $noDesk $(if ($noDesk) { '없음' } else { '있음 → node scripts\desk\install-launcher.js --remove' })
$rows | Format-Table -AutoSize | Out-String -Width 220 | Write-Host
if ($script:Warn.Count) { Say ('경고 ' + $script:Warn.Count + '건:'); foreach ($w2 in $script:Warn) { Say ('  - ' + $w2) } }
$bad = @($rows | Where-Object { $_.결과 -eq 'X' }).Count
Say ('끝 · X ' + $bad + '개' + $(if ($Dry) { ' · 드라이(설치·복사·등록·전원 바꾼 것 0)' } else { '' }))
