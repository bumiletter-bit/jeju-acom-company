# 에이전트오피스 창구 열기 — 이 창에서만 콘솔 API 키로 Claude Code를 실행한다.
# 다른 터미널(대표 개발용 창)의 로그인에는 영향을 주지 않는다: 키를 이 창의 환경 변수로만 넣기 때문이다.
# 키 파일은 저장소 밖에 둔다: %USERPROFILE%\.akkome\desk-api-key.txt (한 줄 · 대표가 직접 저장)

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
claude @args
