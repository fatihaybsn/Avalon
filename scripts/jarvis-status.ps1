<#
.SYNOPSIS
  JARVIS (02) — kısa başlangıç/ayar okuma. Gerçek anahtarları yazdırmaz.
.DESCRIPTION
  Node, paket sürümü, profil yolları, port, config doğrulama ve model/Talk
  ayarını gerçek profilden okur. Kayıtlı sır ile bu sürecin gördüğü sırrı
  ayırır; bağlantıyı yalnız kimliği doğrulanan Gateway health sonucuyla gösterir.
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
$openclawEntry = Join-Path $repoRoot 'node_modules\openclaw\openclaw.mjs'

function Get-Presence([string]$name) {
  $registered = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'User'))
  $inProcess = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))
  $inFile = $false
  if (Test-Path $profileEnv) {
    $line = Select-String -LiteralPath $profileEnv -Pattern ("^\s*(?:export\s+)?{0}\s*=\s*(.*)$" -f [regex]::Escape($name)) -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($line) {
      $value = $line.Matches[0].Groups[1].Value.Trim()
      if ($value.StartsWith('"') -or $value.StartsWith("'")) {
        $value = $value.Trim([char[]]@('"', "'"))
      } else { $value = ($value -split '#', 2)[0].Trim() }
      $inFile = -not [string]::IsNullOrWhiteSpace($value)
    }
  }
  return 'kullanıcı kaydı: {0}; bu süreç: {1}; profil .env: {2}' -f $(if ($registered) { 'PRESENT' } else { 'MISSING' }), $(if ($inProcess) { 'PRESENT' } else { 'MISSING' }), $(if ($inFile) { 'PRESENT' } else { 'MISSING' })
}

function Invoke-OpenClawJson([string[]]$CliArguments) {
  # Ham CLI çıktısı sır/ayar içerebilir; yalnız gerekli durum alanları gösterilir.
  Push-Location $repoRoot
  try {
    # config validate bu sürümde profil dotenv'ini yüklemez; Node yalnız
    # çocuk CLI'ye yükler, bu sürecin veya kullanıcı kaydının sırlarını değiştirmez.
    $nodeArgs = @()
    if (Test-Path $profileEnv) { $nodeArgs += "--env-file=$profileEnv" }
    $raw = & node @nodeArgs $openclawEntry --profile $Profile @CliArguments 2>&1 | Out-String
    $code = $LASTEXITCODE
    $data = $null
    try { $data = $raw | ConvertFrom-Json -ErrorAction Stop } catch { }
    return [pscustomobject]@{ ExitCode = $code; Data = $data }
  } finally { Pop-Location }
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
$configSource = 'MISSING'
$configState = 'NOT_CONFIGURED'
$tokenState = 'NOT_CHECKED'
if (Test-Path $profileConfig) {
  $configSource = "PROFILE: $profileConfig"
  try {
    $cfg = Get-Content -LiteralPath $profileConfig -Raw | ConvertFrom-Json -ErrorAction Stop
    $configState = 'NOT_VALIDATED'
  } catch { $configState = 'INVALID_JSON (şablona geçilmedi)' }
} elseif (Test-Path (Join-Path $repoRoot 'config\jarvis.openclaw.json')) {
  $configSource = 'TEMPLATE ONLY (profil henüz oluşturulmadı)'
  $cfg = Get-Content (Join-Path $repoRoot 'config\jarvis.openclaw.json') -Raw | ConvertFrom-Json
}
if (-not $PSBoundParameters.ContainsKey('Port') -and $cfg.gateway.port) { $Port = [int]$cfg.gateway.port }
$portOpen = Test-LoopbackPortOpen $Port
$healthState = if ($portOpen) { 'UNVERIFIED (açık port bağlantı kanıtı değildir)' } else { 'STOPPED (port kapalı)' }
if ($configState -eq 'NOT_VALIDATED' -and (Test-Path $openclawEntry)) {
  $validation = Invoke-OpenClawJson @('config', 'validate', '--json')
  if ($validation.ExitCode -eq 0 -and $validation.Data.valid -eq $true) {
    $configState = 'VALID'
    $tokenWarnings = @($validation.Data.warnings | Where-Object { $_.path -eq 'gateway.auth.token' })
    $tokenState = if ($tokenWarnings.Count -gt 0) { 'UNAVAILABLE (token ayarında uyarı var)' } else { 'NO_CONFIG_WARNING (Gateway kimliği health ile sınanır)' }
    if ($portOpen) {
      $health = Invoke-OpenClawJson @('gateway', 'health', '--json', '--port', "$Port", '--timeout', '3000')
      $healthState = if ($health.ExitCode -eq 0 -and $health.Data.ok -eq $true) { 'OK (kimlik doğrulanan Gateway)' } else { 'FAILED (Gateway kimliği/erişimi doğrulanamadı)' }
    }
  } else { $configState = 'INVALID_OR_UNVERIFIED' }
}
if (-not (Test-Path $openclawEntry)) { $configState = 'CLI_MISSING (npm ci gerekli)' }
if ($tokenState.StartsWith('UNAVAILABLE')) {
  Write-Warning 'Gateway token ayarı bu CLI sürecinde çözülemedi. Yalnız kullanıcı kaydında varsa terminali/üst uygulamayı yeniden açın veya profil .env dosyasını kullanın. Çalışan Gateway ayrı bir süreçtir; anahtarı aldığının kanıtı health sonucudur.'
}

[pscustomobject]@{
  node              = (node --version)
  npm               = (npm --version)
  openclaw_pinned   = $pkg.dependencies.openclaw
  gateway_profile   = $Profile
  profile_dir       = $profileDir
  profile_config    = if (Test-Path $profileConfig) { 'EXISTS (korunur)' } else { 'MISSING (ilk başlatmada şablondan kopyalanır)' }
  config_source     = $configSource
  config_validation = $configState
  gateway_token     = $tokenState
  port              = $Port
  port_state        = if ($portOpen) { 'OPEN (sahibi health ile sınanır)' } else { 'CLOSED' }
  gateway_health    = $healthState
  primary_model     = $cfg.agents.defaults.model.primary
  model_fallbacks   = if ($null -eq $cfg.agents.defaults.model.fallbacks) { 'UNSPECIFIED' } elseif ($cfg.agents.defaults.model.fallbacks.Count -eq 0) { 'yok (sessiz fallback kapalı)' } else { ($cfg.agents.defaults.model.fallbacks -join ',') }
  talk_provider     = $cfg.talk.realtime.provider
  talk_transport    = $cfg.talk.realtime.transport
  talk_brain        = $cfg.talk.realtime.brain
  talk_routing      = $cfg.talk.realtime.consultRouting
  talk_model        = $cfg.talk.realtime.providers.google.model
  JARVIS_GATEWAY_TOKEN = Get-Presence 'JARVIS_GATEWAY_TOKEN'
  OPENCODE_API_KEY     = Get-Presence 'OPENCODE_API_KEY'
  GEMINI_API_KEY       = Get-Presence 'GEMINI_API_KEY'
  TAVILY_API_KEY       = Get-Presence 'TAVILY_API_KEY'
} | Format-List

Write-Output 'Anahtar satırları yalnız saklama/erişim durumudur; model veya Google Live bağlantı testi değildir. Space Bunny için kabul edilmiş OpenCode işçisi yolu korunur; ses 11. aşamada doğrulanır.'
