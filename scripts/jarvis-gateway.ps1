<#
.SYNOPSIS
  JARVIS Gateway (02) — ayrı profil ile normal başlatma.
.DESCRIPTION
  Projeye ait openclaw sürümünü (--profile jarvis) loopback'te çalıştırır.
  Port doluysa yabancı süreci kapatmaz; çakışmayı bildirip durur.
  FURY state/auth Sohbetini import etmez; mevcut profili üstüne yazmaz.
  Sırlar bu dosyada tutulmaz; %USERPROFILE%\.openclaw-jarvis\.env dosyasından okunur.
#>
[CmdletBinding()]
param(
  [int]$Port = 18789,
  [string]$Profile = 'jarvis',
  [switch]$InstallService
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$templateConfig = Join-Path $repoRoot 'config\jarvis.openclaw.json'
$profileDir = Join-Path $env:USERPROFILE ".openclaw-$Profile"
$profileConfig = Join-Path $profileDir 'openclaw.json'
$profileEnv = Join-Path $profileDir '.env'
$workspaceDir = Join-Path $profileDir 'workspace'
$openclawEntry = Join-Path $repoRoot 'node_modules\openclaw\openclaw.mjs'

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

# 1) Node sürümü (openclaw 2026.10.2: >=24.16 <25 veya >=26.1).
$node = (node --version) -replace '^v', ''
$major = [int]($node.Split('.')[0]); $minor = [int]($node.Split('.')[1])
$nodeOk = (($major -eq 24 -and $minor -ge 16) -or ($major -eq 26 -and $minor -ge 1) -or ($major -gt 26)) -and ($node -notmatch '-')
if (-not $nodeOk) {
  Write-Error "Node $node desteklenmiyor. openclaw 2026.10.2 için Node 24.16+ ya da 26.1+ gerekir (bu makinede beklenen: 24.20.0)."
}

# 2) Port çakışması: kimliği doğrulanamayan sürece dokunma.
if (Test-LoopbackPortOpen $Port) {
  Write-Error ("127.0.0.1:{0} dolu. Sahibini doğrulayamadığım için süreci kapatmıyorum. Proje klasöründe .\node_modules\.bin\openclaw.cmd --profile {1} gateway status --json ile bak ya da portu boşaltıp tekrar dene." -f $Port, $Profile)
}

# 3) Ayrı profil dizini/state. Varsa üstüne yazma, FURY'den import etme.
New-Item -ItemType Directory -Force $profileDir, $workspaceDir | Out-Null
if (-not (Test-Path $profileConfig)) {
  Copy-Item $templateConfig $profileConfig
  Write-Output "Profil config oluşturuldu: $profileConfig (şablondan kopya, mevcut dosya yoktu)."
} else {
  Write-Output "Mevcut profil config korundu: $profileConfig (üstüne yazılmadı)."
}

# 4) Sır dosyası repo dışında. Yoksa güvenli kurulumu göster, anahtarsız devam etme.
if (-not (Test-Path $profileEnv) -and [string]::IsNullOrWhiteSpace($env:JARVIS_GATEWAY_TOKEN)) {
  Write-Warning "Sır dosyası yok: $profileEnv"
  Write-Output 'Kurulum: Copy-Item "config\jarvis.env.example" "$env:USERPROFILE\.openclaw-jarvis\.env" ve değerleri doldur. Anahtar yokken bağlantı varmış gibi dönülmez.'
}

# Token çözülemiyorsa otomatik/geçici kimlikle başlangıca izin verme.
if (-not (Test-Path $openclawEntry)) { Write-Error 'Proje-yerel OpenClaw bulunamadı; proje klasöründe npm ci çalıştırın.' }
try { $rawConfig = Get-Content -LiteralPath $profileConfig -Raw | ConvertFrom-Json -ErrorAction Stop }
catch { Write-Error 'Profil JSON okunamadı; Gateway başlatılmadı. Mevcut profil değiştirilmedi.' }
# Dedicated Dreaming credential never replaces GEMINI_API_KEY / Live auth.
$dreamingKeyInFile = (Test-Path -LiteralPath $profileEnv) -and [bool](Select-String -LiteralPath $profileEnv -Pattern '^\s*(?:export\s+)?JARVIS_DREAMING_GEMINI_API_KEY\s*=\s*\S+' -Quiet)
if ($rawConfig.models.providers.'jarvis-dream-google'.apiKey.id -eq 'JARVIS_DREAMING_GEMINI_API_KEY' -and -not $dreamingKeyInFile -and [string]::IsNullOrWhiteSpace($env:JARVIS_DREAMING_GEMINI_API_KEY)) {
  $env:JARVIS_DREAMING_GEMINI_API_KEY = [Environment]::GetEnvironmentVariable('JARVIS_DREAMING_GEMINI_API_KEY', 'User')
  if ([string]::IsNullOrWhiteSpace($env:JARVIS_DREAMING_GEMINI_API_KEY)) { Write-Error 'Dedicated Dreaming credential missing; no Live credential fallback.' }
}
if ($rawConfig.gateway.auth.mode -ne 'token' -or -not $rawConfig.gateway.auth.token) {
  Write-Error 'JARVIS için açık token kimliği gerekli; mevcut profil değiştirilmedi. Gateway başlatılmadı.'
}
Push-Location $repoRoot
try {
  & node (Join-Path $repoRoot 'scripts\jarvis-policy-config.mjs') --check $profileConfig
  if ($LASTEXITCODE -ne 0) { Write-Error '03 host politikası doğrulanamadı; Gateway başlatılmadı.' }
  # Ön kontrol ve gerçek başlangıç aynı profil dotenv'ini görsün.
  $nodeArgs = @()
  if (Test-Path $profileEnv) { $nodeArgs += "--env-file=$profileEnv" }
  $validationOutput = & node @nodeArgs $openclawEntry --profile $Profile config validate --json 2>&1 | Out-String
  $validationExit = $LASTEXITCODE
  $validation = $null
  try { $validation = $validationOutput | ConvertFrom-Json -ErrorAction Stop } catch { }
  if ($validationExit -ne 0 -or $validation.valid -ne $true) {
    Write-Error 'Profil doğrulanamadı; Gateway başlatılmadı. jarvis-status.ps1 ile kontrol edin.'
  }
  if (@($validation.warnings | Where-Object { $_.path -eq 'gateway.auth.token' }).Count -gt 0) {
    Write-Error 'Gateway token çözülemedi; farklı kimlikle başlangıç engellendi. Yalnız kullanıcı kaydında varsa terminali/üst uygulamayı yeniden açın veya profil .env dosyasını kullanın.'
  }
} finally { Pop-Location }

# 5) Normal başlangıç: ayrı profil parametreleri açık taşınır.
$openclawArgs = @('--profile', $Profile, 'gateway', 'run', '--port', "$Port")
if ($InstallService) {
  Write-Output 'Servis kurulumu ayrı adımdır ve bu aşamada otomatik yapılmaz. Gerekirse: npm exec --no-install openclaw -- --profile jarvis gateway install'
}
Write-Output "Başlatılıyor: proje-yerel OpenClaw $($openclawArgs -join ' ')"
Push-Location $repoRoot
try { & node @nodeArgs $openclawEntry @openclawArgs } finally { Pop-Location }
