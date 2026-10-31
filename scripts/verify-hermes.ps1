#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$HermesHome = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Avalon\Hermes'),
    [switch]$GatewayProbe
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Avalon.Hermes.Common.psm1') -Force -DisableNameChecking
$saved = $null
try {
    $manifest = Get-AvalonPackage (Split-Path -Parent $PSScriptRoot)
    $target = Get-AvalonFullPath $HermesHome
    $saved = Set-AvalonRuntimeEnvironment $target
    $receipt = [IO.File]::ReadAllText((Join-Path $target 'avalon-runtime.json')) | ConvertFrom-Json
    if ($receipt.release -ne $manifest.release) { throw 'The installed runtime belongs to another compatibility release.' }
    Assert-AvalonInstalledPackage (Split-Path -Parent $PSScriptRoot) $target
    $launcher = Join-Path $target 'avalon-bin\avalon-hermes.exe'
    $result = Invoke-AvalonProcess $launcher @('--avalon-verify') -TimeoutSeconds 180
    Write-Output $result.Stdout.Trim()
    if ($GatewayProbe) {
        $probe = Invoke-AvalonProcess $launcher @('--avalon-gateway-probe') -TimeoutSeconds 180
        Write-Output $probe.Stdout.Trim()
        $apiProbe = Invoke-AvalonProcess $launcher @('--avalon-api-probe') -TimeoutSeconds 180
        Write-Output $apiProbe.Stdout.Trim()
    }
    exit 0
} catch {
    [Console]::Error.WriteLine('[Avalon] VERIFICATION FAILED: ' + $_.Exception.Message)
    exit 1
} finally { if ($null -ne $saved) { Restore-AvalonEnvironment $saved } }
