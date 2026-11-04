param([Parameter(Mandatory = $true)][string]$Root)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$Root = [IO.Path]::GetFullPath($Root)
$runtime = Join-Path $Root 'node-red-5.0.9'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($node -and $npm -and ((& $node.Source --version) -match '^v24\.')) {
    $nodePath = $node.Source
    $npmPath = $npm.Source
} else {
    $version = '24.20.0'
    $portable = Join-Path $Root "node-v$version-win-x64"
    $nodePath = Join-Path $portable 'node.exe'
    $npmPath = Join-Path $portable 'npm.cmd'
    if (-not ((Test-Path -LiteralPath $nodePath) -and (Test-Path -LiteralPath $npmPath))) {
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
        $zip = Join-Path $Root "node-v$version-win-x64.zip"
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$version/node-v$version-win-x64.zip" -OutFile $zip -TimeoutSec 120
        $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
        if ($hash -ne '6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba') {
            throw 'Node.js arşivinin SHA-256 doğrulaması başarısız.'
        }
        Expand-Archive -LiteralPath $zip -DestinationPath $Root -Force
        Remove-Item -LiteralPath $zip
    }
}

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Destination (Join-Path $runtime 'package.json') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime-lock.json') -Destination (Join-Path $runtime 'package-lock.json') -Force
$env:PATH = "$(Split-Path -Parent $nodePath);$env:PATH"
& $npmPath ci --prefix $runtime --omit=dev --ignore-scripts --no-audit --no-fund --fetch-retries=1
if ($LASTEXITCODE -ne 0) { throw 'Node-RED bağımlılıkları kurulamadı. İnternet bağlantısını kontrol edin.' }
$manifest = Get-Content -LiteralPath (Join-Path $runtime 'node_modules\node-red\package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne '5.0.9') { throw 'Node-RED sürümü doğrulanamadı.' }
@{ node = $nodePath; version = $manifest.version } | ConvertTo-Json -Compress
