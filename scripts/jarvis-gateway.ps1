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
$nodeOk = (($major -eq 24 -and $minor -ge 16) -or ($major -eq 26))
if (-not $nodeOk) {
  Write-Error "Node $node desteklenmiyor. openclaw 2026.10.2 için Node 24.16+ ya da 26.1+ gerekir (bu makinede beklenen: 24.20.0)."
}

# 2) Port çakışması: kimliği doğrulanamayan sürece dokunma.
if (Test-LoopbackPortOpen $Port) {
  Write-Error ("127.0.0.1:{0} dolu. Sahibini doğrulayamadıgim için süreci kapatmıyorum. npx openclaw --profile {1} gateway status --json` ile bak ya da portu boşaltıp tekrar dene." -f $Port, $Profile)
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
if (-not (Test-Path $profileEnv)) {
  Write-Warning "Sır dosyası yok: $profileEnv"
  Write-Output 'Kurulum: Copy-Item "config\jarvis.env.example" "$env:USERPROFILE\.openclaw-jarvis\.env" ve değerleri doldur. Anahtar yokken bağlantı varmış gibi dönülmez.'
}

# 5) Normal başlangıç: ayrı profil parametreleri açık taşınır.
$openclawArgs = @('--profile', $Profile, 'gateway', 'run', '--port', "$Port")
if ($InstallService) {
  Write-Output 'Servis kurulumu ayrı adımdır ve bu aşamada otomatik yapılmaz. Gerekirse: npm exec --no-install openclaw -- --profile jarvis gateway install'
}
Write-Output "Başlatılıyor: npm exec --no-install openclaw -- $($openclawArgs -join ' ')"
& npm exec --no-install openclaw -- @openclawArgs
