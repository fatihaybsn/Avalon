#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$HermesHome = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Avalon\Hermes'),
    [string]$TestEnvironment = '',
    [string]$ReportDirectory = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Avalon.Hermes.Common.psm1') -Force -DisableNameChecking
$saved = $null
$prior = @{}
try {
    $target = Get-AvalonFullPath $HermesHome
    $saved = Set-AvalonRuntimeEnvironment $target
    $source = Join-Path $target 'hermes-agent'
    $receipt = [IO.File]::ReadAllText((Join-Path $target 'avalon-runtime.json')) | ConvertFrom-Json
    Invoke-AvalonProcess (Join-Path $target 'avalon-bin\avalon-hermes.exe') @('--avalon-verify') -TimeoutSeconds 180 | Out-Null
    if (-not $TestEnvironment) { $TestEnvironment = Join-Path $target 'validation-test-venv' }
    $TestEnvironment = Get-AvalonFullPath $TestEnvironment
    if (-not $ReportDirectory) { $ReportDirectory = Join-Path $target 'logs\contract-tests' }
    $ReportDirectory = Get-AvalonFullPath $ReportDirectory
    [IO.Directory]::CreateDirectory($ReportDirectory) | Out-Null
    $testPython = Join-Path $TestEnvironment 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $TestEnvironment)) {
        Write-Host '[Avalon] Building a separate, locked test environment through Hermes PM.'
        Invoke-AvalonProcess $receipt.python @('-B','-X','utf8','-m','pm.build_env','--source',$source,'--out',$TestEnvironment,'--extra','all','--group','dev','--group','test') -Directory $source -TimeoutSeconds 3600 -Log (Join-Path $ReportDirectory 'build-test-environment.log') | Out-Null
    }
    if (-not (Test-Path -LiteralPath $testPython)) { throw 'The test environment is incomplete. Choose a new TestEnvironment; no files were deleted.' }
    Invoke-AvalonProcess $testPython @('-I','-c','import pytest') | Out-Null
    $git = Get-AvalonGit $target
    $gitRoot = Split-Path -Parent (Split-Path -Parent $git)
    $bash = Join-Path $gitRoot 'usr\bin\bash.exe'
    if (-not (Test-Path -LiteralPath $bash)) { throw 'Git Bash is required for the upstream canonical test runner.' }
    $env:PATH = (Split-Path -Parent $bash) + ';' + (Join-Path $gitRoot 'bin') + ';' + $env:PATH
    foreach ($key in @('HERMES_PYTHON','HERMES_TEST_WORKERS','HERMES_TEST_FILE_RETRIES')) { $prior[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
    $env:HERMES_PYTHON = $testPython.Replace('\','/')
    $env:HERMES_TEST_WORKERS = '2'
    $env:HERMES_TEST_FILE_RETRIES = '0'
    $files = @('tests/tui_gateway/test_iris_contract.py','tests/tui_gateway/test_iris_reply_repair.py','tests/agent/test_final_reply_request.py','tests/agent/test_final_reply_policy_persistence.py')
    Write-Host '[Avalon] Running the four compatibility test files through scripts/run_tests.sh.'
    $result = Invoke-AvalonProcess $bash (@('./scripts/run_tests.sh') + $files) -Directory $source -TimeoutSeconds 1800 -Log (Join-Path $ReportDirectory 'canonical-hermes-tests.log')
    Write-Output $result.Stdout
    Write-AvalonJson (Join-Path $ReportDirectory 'canonical-hermes-tests.json') @{ ok=$true; files=$files; canonicalRunner='scripts/run_tests.sh'; providerRequests=0 }
    exit 0
} catch {
    [Console]::Error.WriteLine('[Avalon] REGRESSION TESTS FAILED: ' + $_.Exception.Message)
    exit 1
} finally {
    foreach ($key in $prior.Keys) { [Environment]::SetEnvironmentVariable($key,$prior[$key],'Process') }
    if ($null -ne $saved) { Restore-AvalonEnvironment $saved }
}
