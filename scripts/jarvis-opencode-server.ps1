param([ValidateSet('Start','Check')][string]$Action='Check')
$ErrorActionPreference='Stop'
$repoPath=Split-Path -Parent $PSScriptRoot
if($Action -eq 'Start') {
 if([string]::IsNullOrWhiteSpace($env:OPENCODE_API_KEY)) {$env:OPENCODE_API_KEY=[Environment]::GetEnvironmentVariable('OPENCODE_API_KEY','User')}
 & node (Join-Path $repoPath 'scripts/jarvis-opencode-profile.mjs') serve
} else {& node (Join-Path $repoPath 'scripts/jarvis-opencode-profile.mjs') status}
if($LASTEXITCODE){throw 'Private OpenCode unavailable; no alternate service/model fallback.'}
