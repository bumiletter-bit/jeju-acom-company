# 에이전트오피스 창구 열기 — 이 창에서만 콘솔 API 키로 Claude Code를 실행한다.
# 다른 터미널(대표 개발용 창)의 로그인에는 영향을 주지 않는다: 키를 이 창의 환경 변수로만 넣기 때문이다.
# 키 파일은 저장소 밖에 둔다: %USERPROFILE%\.akkome\desk-api-key.txt (한 줄 · 대표가 직접 저장)

# 유료(콘솔 과금) 창이라 이 폴더 안에서 실행했을 때만 연다 — 다른 폴더에서 실수로 여는 것을 막는다(대표 9/29).
$here = (Get-Location).ProviderPath.TrimEnd('\')
if ($here -ne $PSScriptRoot.TrimEnd('\')) {
    Write-Host ""
    Write-Host "akkome 은 ★에이전트오피스 폴더 안에서만 열립니다 (콘솔 요금이 나가는 창입니다)." -ForegroundColor Yellow
    Write-Host "지금 폴더: $here"
    Write-Host "열 폴더  : $PSScriptRoot"
    Write-Host ""
    exit 1
}

# 시험 열기(AKKOME_TEST=1): 콘솔 키를 넣지 않는다 = 대표 요금제로 열린다. 창이 열리고 첫 말이 들어가는지만 본다(감시 안 함).
# 시험은 대표 요금제, 콘솔은 직원이 회사프로그램으로 실제 지시할 때만(대표 확정 2026-09-29).
if ($env:AKKOME_TEST -eq '1') {
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
    Set-Location $PSScriptRoot
    $repoRootT = Split-Path $PSScriptRoot -Parent
    Write-Host "시험 열기 — 대표 요금제로 엽니다(콘솔 요금 없음)." -ForegroundColor Cyan
    claude "창구 열기 시험입니다. 도구를 쓰지 말고 '시험 확인'이라고만 답하세요." --model opus --dangerously-skip-permissions --add-dir $repoRootT
    exit 0
}

$keyFile = Join-Path $env:USERPROFILE ".akkome\desk-api-key.txt"
if (-not (Test-Path $keyFile)) {
    Write-Host ""
    Write-Host "키 파일이 없습니다: $keyFile" -ForegroundColor Yellow
    Write-Host "콘솔(console.anthropic.com)에서 만든 API 키를 그 파일에 한 줄로 저장한 뒤 다시 실행하세요."
    Write-Host ""
    exit 1
}
$key = (Get-Content $keyFile -Raw).Trim()
if ($key -notmatch '^sk-ant-') {
    Write-Host "키 형식이 맞지 않습니다(sk-ant- 로 시작해야 합니다). 파일 내용을 확인하세요." -ForegroundColor Yellow
    exit 1
}
$env:ANTHROPIC_API_KEY = $key
Remove-Variable key
Set-Location $PSScriptRoot
Write-Host "콘솔 API 키로 창구를 엽니다. 열리면 '창구 시작'을 입력하세요." -ForegroundColor Green
# 모델: 콘솔은 모델마다 단가가 다르다 → 창구는 Opus로 고정(대표 9/29). 다른 모델로 열려면 --model 값을 직접 붙인다.
# 작업 범위: 창구는 상위 폴더(회사프로그램)의 스크립트·문서·그림을 읽어야 한다 → 열 때 작업 범위에 넣어 "폴더 밖 읽기" 질문으로 멈추지 않게 한다.
$repoRoot = Split-Path $PSScriptRoot -Parent
# 허용 질문 없이 연다(대표 확정 9/29) — 창구가 질문에 멈추면 직원 지시가 쌓이기 때문이다.
# 막아야 할 일(배포·커밋·코드 수정·삭제)은 이 폴더의 .claude\settings.json 금지 목록과 CLAUDE.md 0번 규칙이 맡는다.
$base = @("--dangerously-skip-permissions", "--add-dir", $repoRoot)
# 자동 열기(AKKOME_AUTO=1 · 대기 프로그램이 연 창): 첫 말 "창구 시작"을 넣어 바로 감시를 켠다.
$first = @()
if ($env:AKKOME_AUTO -eq '1') { $first = @("창구 시작") }
# 🔴 첫 문장은 맨 앞에 둔다 — --add-dir 뒤에 두면 폴더 이름으로 먹혀 문장이 사라진다(실측).
if ($args -contains "--model") { claude @first @base @args } else { claude @first --model opus @base @args }
