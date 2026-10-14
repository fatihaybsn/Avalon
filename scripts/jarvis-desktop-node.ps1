[CmdletBinding()]
param([int]$Port=18789)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path -Parent $PSScriptRoot
$desktopSession=[Diagnostics.Process]::GetCurrentProcess().SessionId
if(-not [Environment]::UserInteractive -or $desktopSession -eq 0 -or -not (Get-Process explorer -ErrorAction SilentlyContinue | Where-Object SessionId -eq $desktopSession)) { throw 'Native desktop node requires the signed-in interactive Windows session; service session is not a desktop.' }
$profileDir=Join-Path $env:USERPROFILE '.openclaw-jarvis-desktop'
$mainEnv=Join-Path $env:USERPROFILE '.openclaw-jarvis/.env'
$token=$env:JARVIS_GATEWAY_TOKEN
if(-not $token -and (Test-Path -LiteralPath $mainEnv)) {
  foreach($line in [IO.File]::ReadAllLines($mainEnv)) {
    if($line -match '^\s*JARVIS_GATEWAY_TOKEN\s*=\s*(.+?)\s*$') { $token=$Matches[1].Trim().Trim('"').Trim("'") }
  }
}
if(-not $token) { throw 'Existing Gateway token unavailable; pairing is not bypassed.' }
if(-not (Test-Path -LiteralPath (Join-Path $profileDir 'openclaw.json'))) { throw 'Run scripts/jarvis-gui-config.mjs --prepare-node before starting the native node.' }
$env:OPENCLAW_GATEWAY_TOKEN=$token
$env:OPENCLAW_NO_AUTO_UPDATE='1'
$nodeEntry=Join-Path $repoRoot 'node_modules/openclaw/openclaw.mjs'
Push-Location $repoRoot
try { & node --max-semi-space-size=4 $nodeEntry --profile jarvis-desktop node run --host 127.0.0.1 --port "$Port" --display-name 'JARVIS Windows Desktop' }
finally { Pop-Location }
