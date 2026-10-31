#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$AvalonRoot,
    [string]$HermesHome = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Avalon\Hermes'),
    [switch]$Build
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Avalon.Hermes.Common.psm1') -Force -DisableNameChecking
$saved = $null
try {
    $target = Get-AvalonFullPath $HermesHome
    $appRoot = Get-AvalonFullPath $AvalonRoot
    $manifest = Get-AvalonPackage (Split-Path -Parent $PSScriptRoot)
    $receipt = [IO.File]::ReadAllText((Join-Path $target 'avalon-runtime.json')) | ConvertFrom-Json
    if ($receipt.release -ne $manifest.release) { throw 'The installed compatibility release differs from this package.' }
    Assert-AvalonInstalledPackage (Split-Path -Parent $PSScriptRoot) $target
    $saved = Set-AvalonRuntimeEnvironment $target
    $launcher = Join-Path $target 'avalon-bin\avalon-hermes.exe'
    $check = Invoke-AvalonProcess $launcher @('--avalon-verify') -TimeoutSeconds 180
    if (([IO.File]::ReadAllText((Join-Path $appRoot 'package.json')) | ConvertFrom-Json).productName -ne 'Avalon') { throw 'AvalonRoot is not an Avalon checkout.' }
    if ($Build) {
        Push-Location -LiteralPath $appRoot
        try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'The Avalon build failed.' } }
        finally { Pop-Location }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'dist\index.html')) -or -not (Test-Path -LiteralPath (Join-Path $appRoot 'dist-mobile\index.html'))) { throw 'Both Avalon builds are required. Run npm.cmd ci and npm.cmd run build first, or use -Build.' }
    $electron = Join-Path $appRoot 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) { throw 'The Electron executable is missing. Run npm.cmd ci before starting Avalon.' }
    $env:HERMES_BIN = $launcher
    $env:PATH = (Join-Path $target 'avalon-bin') + ';' + $env:PATH
    $env:IRIS_BRAIN_RELAY = 'true'
    $env:IRIS_HERMES_TRANSPORT = 'interactive'
    $env:IRIS_HERMES_SOURCE = Join-Path $target 'hermes-agent'
    $localApi = @{}
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $target '.env'))) {
        if ($line -match '^\s*(API_SERVER_(?:KEY|PORT|HOST))\s*=(.*)$') { $localApi[$Matches[1]] = $Matches[2].Trim().Trim('"',"'") }
    }
    if (-not $localApi['API_SERVER_KEY'] -or $localApi['API_SERVER_HOST'] -ne '127.0.0.1') { throw 'The dedicated local API configuration is incomplete.' }
    $env:API_SERVER_KEY = $localApi['API_SERVER_KEY']
    $env:HERMES_API_URL = 'http://127.0.0.1:' + $localApi['API_SERVER_PORT']
    $env:IRIS_START_PROD = '1'
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Push-Location -LiteralPath $appRoot
    # Avoid the existing shell=true .cmd trampoline, which breaks on spaces.
    # The pipeline also makes Windows PowerShell wait for the GUI executable.
    try { & $electron '.' | Out-Host; $resultCode = $LASTEXITCODE }
    finally { Pop-Location }
    exit $resultCode
} catch {
    [Console]::Error.WriteLine('[Avalon] START FAILED: ' + $_.Exception.Message)
    exit 1
} finally { if ($null -ne $saved) { Restore-AvalonEnvironment $saved } }
