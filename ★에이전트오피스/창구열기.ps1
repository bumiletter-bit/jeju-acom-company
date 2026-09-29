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
if ($args -contains "--model") { claude @args } else { claude --model opus @args }
