<#
.SYNOPSIS
  JARVIS (02) — kısa başlangıç/ayar okuma. Gerçek anahtarları yazdırmaz.
.DESCRIPTION
  Node, paket sürümü, profil yolları, port, config doğrulama ve model/Talk
  ayarını okur. Anahtar yokken bağlantı varmış gibi dönmez; eksik hesap
  durumunu açık gösterir. API çağrıları yalnız doğru yapılandırmada denenir.
#>
[CmdletBinding()]
param(
  [int]$Port = 18789,
  [string]$Profile = 'jarvis'
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $env:USERPROFILE ".openclaw-$Profile"
$profileConfig = Join-Path $profileDir 'openclaw.json'
$profileEnv = Join-Path $profileDir '.env'

function Get-Presence([string]$name) {
  $v = [Environment]::GetEnvironmentVariable($name, 'User')
  if ([string]::IsNullOrEmpty($v)) { $v = [Environment]::GetEnvironmentVariable($name, 'Process') }
  if ([string]::IsNullOrEmpty($v) -and (Test-Path $profileEnv)) {
    $line = Select-String -Path $profileEnv -Pattern ("^{0}=(.+)$" -f $name) -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($line -and $line.Matches[0].Groups[1].Value.Trim().Length -gt 0) { return 'PRESENT (dosyada)' }
  }
  if (-not [string]::IsNullOrEmpty($v)) { return 'PRESENT (ortamda)' }
  return 'MISSING'
}

function Test-LoopbackPortOpen([int]$p) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $r = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $ok = $r.AsyncWaitHandle.WaitOne(800)
    $connected = $ok -and $c.Connected
    $c.Close()
    return $connected
  } catch { return $false }
}

$pkg = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$cfg = $null
if (Test-Path (Join-Path $repoRoot 'config\jarvis.openclaw.json')) {
  $cfg = Get-Content (Join-Path $repoRoot 'config\jarvis.openclaw.json') -Raw | ConvertFrom-Json
}

[pscustomobject]@{
  node              = (node --version)
  npm               = (npm --version)
  openclaw_pinned   = $pkg.dependencies.openclaw
  gateway_profile   = $Profile
  profile_dir       = $profileDir
  profile_config    = if (Test-Path $profileConfig) { 'EXISTS (korunur)' } else { 'MISSING (ilk başlatmada şablondan kopyalanır)' }
  port              = $Port
  port_state        = if (Test-LoopbackPortOpen $Port) { 'OPEN (çakışma: dokunulmadı)' } else { 'CLOSED (başlatılabilir)' }
  primary_model     = $cfg.agents.defaults.model.primary
  model_fallbacks   = if ($cfg.agents.defaults.model.fallbacks.Count -eq 0) { 'yok (sessiz fallback kapalı)' } else { ($cfg.agents.defaults.model.fallbacks -join ',') }
  talk_provider     = $cfg.talk.realtime.provider
  talk_transport    = $cfg.talk.realtime.transport
  talk_brain        = $cfg.talk.realtime.brain
  talk_routing      = $cfg.talk.realtime.consultRouting
  talk_model        = $cfg.talk.realtime.providers.google.model
  JARVIS_GATEWAY_TOKEN = Get-Presence 'JARVIS_GATEWAY_TOKEN'
  OPENCODE_API_KEY     = Get-Presence 'OPENCODE_API_KEY'
  GEMINI_API_KEY       = Get-Presence 'GEMINI_API_KEY'
} | Format-List

if ((Get-Presence 'OPENCODE_API_KEY') -eq 'MISSING') {
  Write-Output 'Space Bunny (opencode/space-bunny-free): hesap eksik — model çağrısı yapılmadı. Anahtarı %USERPROFILE%\.openclaw-jarvis\.env dosyasına koyup `openclaw --profile jarvis models list --provider opencode` ile doğrula.'
}
if ((Get-Presence 'GEMINI_API_KEY') -eq 'MISSING') {
  Write-Output 'Google Live (gemini-3.8-live): anahtar yok — ses 11. aşamaya kadar kapalı sayılır, bağlantı varmış gibi gösterilmiyor.'
}
