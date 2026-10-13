[CmdletBinding()]
param([switch]$Deep)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $env:USERPROFILE '.openclaw-jarvis'
$configPath = Join-Path $profileDir 'openclaw.json'
$env:OPENCLAW_STATE_DIR = $profileDir
$env:OPENCLAW_CONFIG_PATH = $configPath
if (-not (Test-Path -LiteralPath $configPath)) { throw 'JARVIS profile missing; template is not a running memory installation.' }
$settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$provider = $settings.models.providers.'llama-cpp'
Write-Output ('Memory provider: {0}; fallback: {1}' -f $settings.memory.search.provider, $settings.memory.search.fallback)
if (-not $provider.localService) {
  Write-Output 'BLOCKED: managed llama.cpp embedding-only setup missing. EmbeddingGemma (~0.3 GB model file) and verified Windows runtime require download. This is not total RAM usage.'
  Write-Output 'Setup: node node_modules/openclaw/openclaw.mjs --profile jarvis models auth login --agent main --provider llama-cpp --method local; decline chat, accept embedding-only.'
}
$nodeArgs = @()
$profileEnv = Join-Path $profileDir '.env'
if (Test-Path -LiteralPath $profileEnv) { $nodeArgs += "--env-file=$profileEnv" }
if (-not $env:JARVIS_GATEWAY_TOKEN) { $env:JARVIS_GATEWAY_TOKEN = [Environment]::GetEnvironmentVariable('JARVIS_GATEWAY_TOKEN', 'User') }
$cliArgs = @('--profile', 'jarvis', 'memory', 'status', '--agent', 'main', '--json')
if ($Deep) { $cliArgs += '--deep' }
Push-Location $repoRoot
try { & node @nodeArgs (Join-Path $repoRoot 'node_modules/openclaw/openclaw.mjs') @cliArgs; $result = $LASTEXITCODE }
finally { Pop-Location }
exit $result
