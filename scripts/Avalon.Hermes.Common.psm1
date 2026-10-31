Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-AvalonFullPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'An absolute directory is required.' }
    $provider = $null; $drive = $null
    $expanded = [Environment]::ExpandEnvironmentVariables($Path)
    # PowerShell's Set-Location does not update .NET's process directory.
    # Resolve '.' through the active filesystem provider before canonicalizing.
    $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($expanded,[ref]$provider,[ref]$drive)
    if ($provider.Name -ne 'FileSystem') { throw 'A filesystem directory is required.' }
    return [IO.Path]::GetFullPath($resolved).TrimEnd('\','/')
}

function Get-AvalonHash([string]$Path, [switch]$Text) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($Text) { $bytes = [Text.Encoding]::UTF8.GetBytes([Text.Encoding]::UTF8.GetString($bytes).Replace("`r`n", "`n")) }
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}

function Write-AvalonJson([string]$Path, $Value) {
    $text = ($Value | ConvertTo-Json -Depth 30) + "`n"
    [IO.File]::WriteAllText($Path, $text, (New-Object Text.UTF8Encoding($false)))
}

function ConvertTo-AvalonArgument([AllowEmptyString()][string]$Value) {
    # CommandLineToArgvW/CRT quoting, including trailing backslashes and empty arguments.
    $b = New-Object Text.StringBuilder
    [void]$b.Append('"'); $slashes = 0
    foreach ($c in $Value.ToCharArray()) {
        if ($c -eq '\') { $slashes++; continue }
        if ($c -eq '"') { [void]$b.Append(('\' * ($slashes * 2 + 1))); [void]$b.Append('"') }
        else { [void]$b.Append(('\' * $slashes)); [void]$b.Append($c) }
        $slashes = 0
    }
    [void]$b.Append(('\' * ($slashes * 2))); [void]$b.Append('"')
    return $b.ToString()
}

function Invoke-AvalonProcess {
    param([string]$File, [string[]]$Arguments = @(), [string]$Directory = '',
          [int]$TimeoutSeconds = 180, [string]$Log = '', [switch]$AllowFailure)
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = (@($Arguments | ForEach-Object { ConvertTo-AvalonArgument $_ }) -join ' ')
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
    if ($Directory) { $info.WorkingDirectory = $Directory }
    $proc = New-Object Diagnostics.Process
    $proc.StartInfo = $info
    try {
        if (-not $proc.Start()) { throw "Could not start $File" }
        $stdout = $proc.StandardOutput.ReadToEndAsync(); $stderr = $proc.StandardError.ReadToEndAsync()
        if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
            # Only the process created above, and its children, are stopped.
            & "$env:WINDIR\System32\taskkill.exe" /PID $proc.Id /T /F 2>&1 | Out-Null
            throw "Process timed out after $TimeoutSeconds seconds: $File. Installation state is retained for inspection."
        }
        $proc.WaitForExit()
        $result = [pscustomobject]@{ ExitCode = $proc.ExitCode; Stdout = $stdout.GetAwaiter().GetResult(); Stderr = $stderr.GetAwaiter().GetResult() }
        if ($Log) { [IO.File]::WriteAllText($Log, $result.Stdout + "`n" + $result.Stderr, (New-Object Text.UTF8Encoding($false))) }
        if ($result.ExitCode -ne 0 -and -not $AllowFailure) {
            $tail = ($result.Stdout + "`n" + $result.Stderr)
            if ($tail.Length -gt 3500) { $tail = $tail.Substring($tail.Length - 3500) }
            throw "Process failed (exit $($result.ExitCode)): $File`n$tail"
        }
        return $result
    } finally { $proc.Dispose() }
}

function Get-AvalonPackage([string]$Root) {
    $path = Join-Path $Root 'compat\hermes\compatibility.json'
    $m = [IO.File]::ReadAllText($path) | ConvertFrom-Json
    if ($m.schemaVersion -ne 1 -or $m.baseCommit -notmatch '^[a-f0-9]{40}$') { throw 'Unsupported compatibility manifest.' }
    foreach ($pair in @(@('avalon-hermes.patch',$m.patchSha256), @('upstream-install.ps1',$m.installerSha256))) {
        if ((Get-AvalonHash (Join-Path $Root ('compat\hermes\' + $pair[0]))) -ne $pair[1]) { throw "Package integrity failed: $($pair[0])" }
    }
    foreach ($asset in $m.assets) {
        if ($asset.path -match '(^[\/]|\.\.|:)') { throw 'Unsafe package asset path.' }
        if ((Get-AvalonHash (Join-Path $Root $asset.path)) -ne $asset.sha256) { throw "Package integrity failed: $($asset.path)" }
    }
    return $m
}

function Get-AvalonGit([string]$HermesDirectory) {
    $candidate = Join-Path $HermesDirectory 'tools\git-2.53.0+3-win32-x64\cmd\git.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    $command = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Assert-AvalonInstalledPackage([string]$Root, [string]$HermesDirectory) {
    $expected = Join-Path $Root 'compat\hermes\compatibility.json'
    $installed = Join-Path $HermesDirectory 'avalon-compat\compat\hermes\compatibility.json'
    if (-not (Test-Path -LiteralPath $installed) -or (Get-AvalonHash $expected) -ne (Get-AvalonHash $installed)) {
        throw 'The installed compatibility manifest differs from this package. A tested release migration or a new dedicated home is required.'
    }
}

function Get-AvalonSourceState([string]$Source, $Manifest, [string]$Git) {
    $head = Invoke-AvalonProcess $Git @('-C',$Source,'rev-parse','HEAD')
    if ($head.Stdout.Trim() -ne $Manifest.baseCommit) { throw 'Hermes HEAD does not match the approved commit. No reset was performed.' }
    $post = $true; $pre = $true
    foreach ($entry in $Manifest.files) {
        $p = Join-Path $Source $entry.path
        $exists = Test-Path -LiteralPath $p -PathType Leaf
        $hash = if ($exists) { Get-AvalonHash $p -Text } else { '' }
        if ($hash -ne $entry.sha256) { $post = $false }
        if ($null -eq $entry.baseSha256) { if ($exists) { $pre = $false } }
        elseif ($hash -ne $entry.baseSha256) { $pre = $false }
    }
    if (-not $pre -and -not $post) { throw 'Hermes contains partial or unknown changes. Inspect it or choose a new dedicated home; existing files were preserved.' }
    $diff = Invoke-AvalonProcess $Git @('-C',$Source,'-c','core.fsmonitor=false','diff','--name-only','--no-ext-diff','--no-renames','HEAD','--')
    $actual = @($diff.Stdout -split "`r?`n" | Where-Object { $_ })
    $expected = @()
    if ($post) { $expected = @($Manifest.files | Where-Object { $null -ne $_.baseSha256 } | ForEach-Object { $_.path }) }
    if ((@($actual | Sort-Object) -join "`n") -cne (@($expected | Sort-Object) -join "`n")) { throw 'Unexpected tracked Hermes changes. No source repair was attempted.' }
    $new = Invoke-AvalonProcess $Git @('-C',$Source,'ls-files','--others','--exclude-standard')
    $actualNew = @($new.Stdout -split "`r?`n" | Where-Object { $_ })
    $expectedNew = @()
    if ($post) { $expectedNew = @($Manifest.files | Where-Object { $null -eq $_.baseSha256 } | ForEach-Object { $_.path }) }
    if ((@($actualNew | Sort-Object) -join "`n") -cne (@($expectedNew | Sort-Object) -join "`n")) { throw 'Unexpected untracked Hermes files. No files were deleted.' }
    $staged = Invoke-AvalonProcess $Git @('-C',$Source,'diff','--cached','--quiet') -AllowFailure
    if ($staged.ExitCode -ne 0) { throw 'The Hermes index contains staged changes; installation was refused.' }
    return $(if ($post) { 'patched' } else { 'base' })
}

function Set-AvalonRuntimeEnvironment([string]$HermesDirectory) {
    $saved = @{}
    # A .NET/Python parent can pass PowerShell 7's module path to Windows
    # PowerShell 5.1, hiding built-ins such as Get-FileHash during bootstrap.
    $moduleDirectories = @((Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules'),
        (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'))
    $documentsDirectory = [Environment]::GetFolderPath('MyDocuments')
    if ($documentsDirectory) { $moduleDirectories += (Join-Path $documentsDirectory 'WindowsPowerShell\Modules') }
    $windowsModules = $moduleDirectories -join ';'
    $values = @{ HERMES_HOME=$HermesDirectory; HERMES_RUNTIME_DIR=(Join-Path $HermesDirectory 'tools');
        UV_CACHE_DIR=(Join-Path $HermesDirectory 'cache\uv'); UV_PYTHON_INSTALL_DIR=(Join-Path $HermesDirectory 'bootstrap-python');
        UV_NO_CONFIG='1'; PYTHONUTF8='1'; PYTHONIOENCODING='utf-8'; PYTHONDONTWRITEBYTECODE='1';
        PYTHONPATH=''; PYTHONHOME=''; VIRTUAL_ENV=''; HERMES_INSTALL_ROOT=''; HERMES_PYTHON=''; __HERMES_ACTIVATED=''; PSModulePath=$windowsModules }
    foreach ($key in $values.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key,'Process')
        [Environment]::SetEnvironmentVariable($key,$values[$key],'Process')
    }
    foreach ($key in @('PATH','HERMES_BIN','IRIS_HERMES_SOURCE','IRIS_START_PROD','IRIS_BRAIN_RELAY','IRIS_HERMES_TRANSPORT','HERMES_API_URL','API_SERVER_KEY','ELECTRON_RUN_AS_NODE')) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key,'Process')
    }
    return $saved
}

function Restore-AvalonEnvironment($Saved) {
    foreach ($key in $Saved.Keys) { [Environment]::SetEnvironmentVariable($key,$Saved[$key],'Process') }
}

Export-ModuleMember -Function *-Avalon*
