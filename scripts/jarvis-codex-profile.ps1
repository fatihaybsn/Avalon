param([ValidateSet('Login','Check')][string]$Action='Check')
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$entryPath=Join-Path $projectPath 'node_modules/openclaw/openclaw.mjs'
if($Action -eq 'Login') {
    # The user runs this interactively. No Desktop/FURY credentials are imported.
    & node $entryPath --profile jarvis models auth login --provider openai --method device-code --profile-id openai:jarvis-codex --agent jarvis-codex
    if($LASTEXITCODE){throw 'Codex sign-in failed; no alternate account/API-key fallback.'}
} else {
    & node $entryPath --profile jarvis gateway call jarvis.codex.setup --json
    if($LASTEXITCODE){throw 'Native Codex setup status unavailable.'}
}
