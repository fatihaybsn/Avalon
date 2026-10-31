#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$HermesHome = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Avalon\Hermes'),
    [string]$AvalonRoot = '',
    [switch]$SkipGatewayProbe
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Avalon.Hermes.Common.psm1') -Force -DisableNameChecking
$saved = $null; $mutex = $null; $locked = $false
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
        throw 'This release supports native Windows x64. ARM64 and other operating systems require a separately validated package.'
    }
    $packageRoot = Split-Path -Parent $PSScriptRoot
    $manifest = Get-AvalonPackage $packageRoot
    $target = Get-AvalonFullPath $HermesHome
    $profilePath = Get-AvalonFullPath ([Environment]::GetFolderPath('UserProfile'))
    $defaultHermes = Get-AvalonFullPath (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'hermes')
    $forbidden = @($profilePath,$defaultHermes,(Join-Path $profilePath '.hermes'))
    $desktopDirectory = [Environment]::GetFolderPath('Desktop')
    if ($desktopDirectory) { $forbidden += Get-AvalonFullPath $desktopDirectory }
    if ($target.Length -lt 12 -or $forbidden -contains $target) { throw 'A dedicated Avalon Hermes directory is required. The existing personal Hermes home must not be used.' }
    if ($AvalonRoot) {
        $AvalonRoot = Get-AvalonFullPath $AvalonRoot
        $appPackage = [IO.File]::ReadAllText((Join-Path $AvalonRoot 'package.json')) | ConvertFrom-Json
        if ($appPackage.productName -ne 'Avalon' -or -not (Test-Path -LiteralPath (Join-Path $AvalonRoot 'electron\main.mjs'))) { throw 'AvalonRoot is not the expected application source directory.' }
        if ($AvalonRoot -eq $target -or $AvalonRoot.StartsWith($target + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'HermesHome must not contain the Avalon checkout.' }
    }
    $lockBytes = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($target.ToLowerInvariant()))
    $mutex = New-Object Threading.Mutex($false,('Local\AvalonHermes-' + ([BitConverter]::ToString($lockBytes)).Replace('-','')))
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Another installer owns this Hermes home. Wait for it to finish.' }
    $owner = Join-Path $target 'avalon-install-owner.json'
    if (Test-Path -LiteralPath $target) {
        if ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'A junction/symlink cannot be used as the Hermes home.' }
        if (-not (Test-Path -LiteralPath $owner) -and @(Get-ChildItem -LiteralPath $target -Force).Count -gt 0) { throw 'The destination is nonempty and is not owned by this installer. Choose a new dedicated directory.' }
    } else { [IO.Directory]::CreateDirectory($target) | Out-Null }
    if (Test-Path -LiteralPath $owner) {
        $old = [IO.File]::ReadAllText($owner) | ConvertFrom-Json
        if ($old.release -ne $manifest.release) { throw 'A different compatibility release owns this destination. No migration was attempted.' }
    } else { Write-AvalonJson $owner @{ release=$manifest.release; schemaVersion=1; createdUtc=[DateTime]::UtcNow.ToString('o') } }
    [IO.Directory]::CreateDirectory((Join-Path $target 'logs')) | Out-Null
    $saved = Set-AvalonRuntimeEnvironment $target
    $source = Join-Path $target 'hermes-agent'
    if ((Test-Path -LiteralPath $source) -and ((Get-Item -LiteralPath $source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The source checkout cannot be a junction or symbolic link.' }
    $shell = (Get-Process -Id $PID).Path
    $upstream = Join-Path $packageRoot 'compat\hermes\upstream-install.ps1'
    $stageArgs = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$upstream,'-HermesHome',$target,'-InstallDir',$source,'-Commit',$manifest.baseCommit,'-NonInteractive')
    $git = Get-AvalonGit $target
    if (-not $git) {
        Write-Host '[Avalon] Installing the upstream hash-pinned portable Git in the dedicated home.'
        Invoke-AvalonProcess $shell ($stageArgs + @('-Stage','prerequisites')) -TimeoutSeconds 1800 -Log (Join-Path $target 'logs\bootstrap-git.log') | Out-Null
        $git = Get-AvalonGit $target
        if (-not $git) { throw 'The pinned Git bootstrap did not provide git.exe.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $source '.git'))) {
        if (Test-Path -LiteralPath $source) {
            if (@(Get-ChildItem -LiteralPath $source -Force).Count -gt 0) { throw 'The source destination is occupied and is not a Git checkout.' }
        } else { [IO.Directory]::CreateDirectory($source) | Out-Null }
        Invoke-AvalonProcess $git @('init','--quiet',$source) | Out-Null
        Invoke-AvalonProcess $git @('-C',$source,'config','core.autocrlf','false') | Out-Null
        Invoke-AvalonProcess $git @('-C',$source,'config','core.longpaths','true') | Out-Null
        Invoke-AvalonProcess $git @('-C',$source,'remote','add','origin',$manifest.repository) | Out-Null
    }
    $head = Invoke-AvalonProcess $git @('-C',$source,'rev-parse','--verify','HEAD') -AllowFailure
    if ($head.ExitCode -ne 0) {
        $occupied = @(Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -ne '.git' })
        if ($occupied.Count) { throw 'An incomplete checkout contains files. It was preserved; inspect it before retrying.' }
        Write-Host '[Avalon] Fetching the exact Hermes base commit (no latest-branch checkout).'
        $fetched = $false
        foreach ($attempt in 1..3) {
            $fetch = Invoke-AvalonProcess $git @('-C',$source,'fetch','--depth','1','origin',$manifest.baseCommit) -TimeoutSeconds 900 -AllowFailure -Log (Join-Path $target 'logs\git-fetch.log')
            if ($fetch.ExitCode -eq 0) { $fetched = $true; break }
            Write-Warning "Git fetch attempt $attempt failed; the partial download is retained for retry."
        }
        if (-not $fetched) { throw 'Unable to download the approved Hermes commit. Check network/proxy access; rerun this same command.' }
        Invoke-AvalonProcess $git @('-C',$source,'checkout','--detach','FETCH_HEAD') -TimeoutSeconds 300 | Out-Null
    }
    $state = Get-AvalonSourceState $source $manifest $git
    $patch = Join-Path $packageRoot 'compat\hermes\avalon-hermes.patch'
    if ($state -eq 'base') {
        Write-Host '[Avalon] Checking and applying the complete compatibility patch (including added files).'
        Invoke-AvalonProcess $git @('-C',$source,'apply','--check','--whitespace=nowarn',$patch) | Out-Null
        $backup = Join-Path $target ('backups\before-patch-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff'))
        foreach ($entry in $manifest.files | Where-Object { $null -ne $_.baseSha256 }) {
            $destination = Join-Path $backup $entry.path
            [IO.Directory]::CreateDirectory((Split-Path -Parent $destination)) | Out-Null
            [IO.File]::Copy((Join-Path $source $entry.path),$destination,$false)
        }
        Invoke-AvalonProcess $git @('-C',$source,'apply','--whitespace=nowarn',$patch) | Out-Null
    }
    if ((Get-AvalonSourceState $source $manifest $git) -ne 'patched') { throw 'Post-patch verification failed.' }
    $receipt = Join-Path $target 'avalon-runtime.json'
    $launcher = Join-Path $target 'avalon-bin\avalon-hermes.exe'
    if (-not (Test-Path -LiteralPath $receipt)) {
        Write-Host '[Avalon] Installing upstream-managed, locked Python dependencies and supported tools. This can take several minutes.'
        Write-Host ('[Avalon] Dependency log: ' + (Join-Path $target 'logs\bootstrap-dependencies.log'))
        Invoke-AvalonProcess $shell ($stageArgs + @('-Stage','python-deps')) -TimeoutSeconds 3600 -Log (Join-Path $target 'logs\bootstrap-dependencies.log') | Out-Null
        $facts = [IO.File]::ReadAllText((Join-Path $target 'tools\facts.json')) | ConvertFrom-Json
        $python = Join-Path (Join-Path $target 'tools') ($facts.packages.python.entry + '\python.exe')
        if (-not (Test-Path -LiteralPath $python)) { throw 'PM did not publish its managed Python interpreter.' }
        # Copy a self-contained verifier/guard beside the runtime, not a path back to the downloaded ZIP.
        foreach ($relative in @('compat/hermes/compatibility.json','compat/hermes/avalon-hermes.patch','compat/hermes/upstream-install.ps1','compat/hermes/LICENSE.hermes') + @($manifest.assets | ForEach-Object { $_.path })) {
            $from = Join-Path $packageRoot $relative; $to = Join-Path (Join-Path $target 'avalon-compat') $relative
            [IO.Directory]::CreateDirectory((Split-Path -Parent $to)) | Out-Null
            if (Test-Path -LiteralPath $to) { if ((Get-AvalonHash $from) -ne (Get-AvalonHash $to)) { throw "Existing compatibility asset differs: $relative" } }
            else { [IO.File]::Copy($from,$to,$false) }
        }
        $git = Get-AvalonGit $target
        $preparation = Invoke-AvalonProcess $python @('-I','-B','-X','utf8',(Join-Path $packageRoot 'scripts\hermes-runtime.py'),'--prepare',$target,'--git',$git) -TimeoutSeconds 300 -Log (Join-Path $target 'logs\prepare-runtime.log')
        Write-Host $preparation.Stdout.Trim()
    }
    Assert-AvalonInstalledPackage $packageRoot $target
    if (-not (Test-Path -LiteralPath $launcher)) { throw 'Runtime receipt exists without its launcher. Inspect this installation; no unverified repair was attempted.' }
    Write-Host '[Avalon] Verifying the native launcher, source identity, dependency selection, and imported compatibility modules.'
    $verification = Invoke-AvalonProcess $launcher @('--avalon-verify') -TimeoutSeconds 180
    Write-Host $verification.Stdout.Trim()
    if ($AvalonRoot) {
        Invoke-AvalonProcess $launcher @('--avalon-configure-app',$AvalonRoot) -TimeoutSeconds 180 | ForEach-Object { Write-Host $_.Stdout.Trim() }
    }
    if (-not $SkipGatewayProbe) {
        Write-Host '[Avalon] Testing an authenticated local gateway connection without a model request.'
        $probe = Invoke-AvalonProcess $launcher @('--avalon-gateway-probe') -TimeoutSeconds 180 -Log (Join-Path $target 'logs\gateway-probe.log')
        Write-Host $probe.Stdout.Trim()
        Write-Host '[Avalon] Testing the authenticated local HTTP API without a model request.'
        $apiProbe = Invoke-AvalonProcess $launcher @('--avalon-api-probe') -TimeoutSeconds 180 -Log (Join-Path $target 'logs\api-probe.log')
        Write-Host $apiProbe.Stdout.Trim()
    } else {
        Write-Warning 'Gateway/API startup probes were explicitly skipped; only source/runtime identity has been checked.'
    }
    Write-Host ('[Avalon] READY. HERMES_HOME=' + $target)
    Write-Host ('[Avalon] HERMES_BIN=' + $launcher)
    Write-Host '[Avalon] No system/user PATH entry or unrelated Hermes installation was changed.'
    exit 0
} catch {
    [Console]::Error.WriteLine('[Avalon] INSTALLATION FAILED: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $saved) { Restore-AvalonEnvironment $saved }
    if ($locked -and $null -ne $mutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
