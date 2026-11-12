# 관리자 노트북 에이전트를 이 Windows PC 의 작업 스케줄러에 설치합니다 (맥의 install.sh 와 같은 일정).
#   powershell -ExecutionPolicy Bypass -File scripts\install-agents.ps1                    둘 다 설치
#   powershell -ExecutionPolicy Bypass -File scripts\install-agents.ps1 -Only usage        사용 분석만 (한 시간마다)
#   powershell -ExecutionPolicy Bypass -File scripts\install-agents.ps1 -Only build        제작 맡기기만 (10분마다)
#   powershell -ExecutionPolicy Bypass -File scripts\install-agents.ps1 -Uninstall         제거
# 필요한 것: 이 PC 의 Claude Code 로그인, Supabase MCP 연결 (claude mcp list 에서 supabase √),
#           제작 맡기기는 열쇠 파일 ~/.dshs42-build-agent.json
# 로그인한 동안에만 돌고, 창은 뜨지 않습니다 (conhost --headless). 기록: ~/.dshs42-logs
param([ValidateSet("all", "usage", "build")] [string]$Only = "all", [switch]$Uninstall)
$ErrorActionPreference = "Stop"

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node).Source
$agents = @(
  @{ key = "usage"; name = "dshs42 usage-agent"; script = "usage-agent\run.mjs"; minutes = 60 },
  @{ key = "build"; name = "dshs42 build-agent"; script = "build-agent\run.mjs"; minutes = 10 }
) | Where-Object { $Only -eq "all" -or $_.key -eq $Only }

foreach ($a in $agents) {
  Unregister-ScheduledTask -TaskName $a.name -Confirm:$false -ErrorAction SilentlyContinue
  if ($Uninstall) { Write-Output "제거했어요: $($a.name)"; continue }
  if ($a.key -eq "build" -and -not (Test-Path "$HOME\.dshs42-build-agent.json")) {
    Write-Output "주의: 열쇠 파일 ~/.dshs42-build-agent.json 이 없어요. 맥에 있는 파일을 옮기거나 관리자에게 열쇠 등록을 부탁하세요 (agenttasks.sql 의 agent_keys)."
  }
  $action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "--headless `"$node`" `"$dir\$($a.script)`"" -WorkingDirectory (Split-Path "$dir\$($a.script)")
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $a.minutes)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $a.name -Action $action -Trigger $trigger -Settings $settings | Out-Null
  Write-Output "설치했어요: $($a.name) ($($a.minutes)분마다)"
}
