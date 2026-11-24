# BSO 현장 상담 서버 시작 (ThinkPad) — Fold8는 Tailscale Serve(tailnet 전용 HTTPS)로 접속
# - 서버는 127.0.0.1에만 바인딩, 앱 토큰 + 이 PC의 Tailscale 로그인만 허용.
# - Funnel(인터넷 공개)·포트포워딩·방화벽 변경 없음. 키 값은 출력하지 않는다.
# 사용: powershell -ExecutionPolicy Bypass -File scripts\start_field_server.ps1 [-Page dist\notice-field\molit-2025-456-field.html] [-EnvFile <.env>]
param(
  [string]$Page = 'dist\notice-field\molit-2025-456-field.html',
  [string]$EnvFile = '',
  [int]$Port = 4190
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path $ts)) { throw 'Tailscale이 설치되어 있지 않습니다.' }
$status = & $ts status --json | ConvertFrom-Json
if ($status.BackendState -ne 'Running') { throw "Tailscale 상태: $($status.BackendState) — 로그인 후 다시 실행하세요." }
$login = $status.User."$($status.Self.UserID)".LoginName
if (-not (Test-Path $Page)) { throw "현장 페이지가 없습니다: $Page (npm run notice:field:build -- --index <색인> 으로 먼저 빌드)" }
if (-not $EnvFile) {
  # 워크트리에서 실행하면 저장소 루트의 .env를 쓴다.
  $candidates = @((Join-Path $repo '.env'), (Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $repo))) '.env'))
  $EnvFile = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $EnvFile) { throw '.env를 찾지 못했습니다. -EnvFile로 지정하세요.' }

& $ts serve --bg --https=443 "http://127.0.0.1:$Port" | Out-Null
& $ts serve status
Write-Host "Fold8: https://$($status.Self.DNSName.TrimEnd('.'))/pair  (코드: local-data\field-server\pair-code.txt)"
# 서버가 새 페어링 코드를 쓴 뒤 메모장으로 연다(채팅·로그에는 출력하지 않음).
$pair = Join-Path $repo 'local-data\field-server\pair-code.txt'
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "Start-Sleep -Seconds 4; notepad.exe '$pair'"
node scripts/field_server.js --page $Page --port $Port --require-token --allowed-login $login --env $EnvFile
