param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $p = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -Path (Join-Path $PSScriptRoot 'Windows.cs')
    $catalog = @{ notepad = 'notepad.exe'; calculator = 'calc.exe'; paint = 'mspaint.exe' }
    function Resolve-App([string]$name) {
        if (-not $catalog.ContainsKey($name)) { throw 'Host app catalog required' }
        # No caller executable, shortcut, argument, registry command or PATH search.
        $exe = Join-Path ([Environment]::GetFolderPath('System')) $catalog[$name]
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Installed app unavailable' }
        return $exe
    }
    if ($p.action -in @('resolve','open','status','focus','minimize','restore','close')) {
        $exe = Resolve-App $p.app
        # Packaged apps have a different executable: fixed family, installed package root.
        $family = @{notepad='Microsoft.WindowsNotepad'; calculator='Microsoft.WindowsCalculator'; paint='Microsoft.Paint'}[$p.app]
        $packages = @(Get-AppxPackage -Name $family)
        $roots = @($packages | ForEach-Object { $_.InstallLocation })
        # Match only the fixed package's actual executable, never an application-name close claim.
        $windows = @([JarvisWindows]::Windows() | Where-Object {
            $w = $_; $match = $w.exe -ieq $exe
            foreach ($root in $roots) { if ($w.exe.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { $match = $true } }
            $match
        })
        $r = @{ app=$p.app; available=($packages.Count -eq 1 -or $windows.Count -gt 0); launcherExists=$true; packageVerified=($packages.Count -eq 1); packageVersions=@($packages | ForEach-Object { "$($_.Version)" }); executable=$exe; windows=$windows; running=($windows.Count -gt 0) }
        if ($p.action -eq 'open') {
            if ($windows.Count -eq 0 -or $p.notePath) {
                if($packages.Count -ne 1){throw 'Verified installed app package unavailable; Store/installation not started'}
                $start = [Diagnostics.ProcessStartInfo]::new($exe); $start.UseShellExecute = $false
                # Only the host-controlled .txt draft path can become an argument.
                if ($p.notePath) { $start.ArgumentList.Add([string]$p.notePath) }
                $proc = [Diagnostics.Process]::Start($start)
                $r.launchRequested=$true; $r.launchPid=$proc.Id
            } else { $r.launchRequested=$false; $r.alreadyOpen=$true }
            $r.confirmed=$false # launch acknowledgement is not an observed window
        } elseif ($p.action -in @('focus','minimize','restore','close')) {
            $w = $p.window
            $found = @($windows | Where-Object { $_.pid -eq $w.pid -and $_.hwnd -eq $w.hwnd -and $_.started -eq $w.started -and $_.exe -ieq $w.exe })
            if ($found.Count -ne 1) { throw 'Window identity stale or outside app target' }
            $r = [JarvisWindows]::Act($p.action, [int]$w.pid, [string]$w.started, [string]$w.exe, [long]$w.hwnd)
        }
    } elseif ($p.action -in @('audio_status','volume','mute')) {
        $r = [JarvisWindows]::Audio([string]$p.action, [double]$p.value, [bool]$p.value)
    } elseif ($p.action -eq 'media') {
        $r = [JarvisWindows]::Media([string]$p.value)
    } elseif ($p.action -in @('power_status','power')) {
        $power = Join-Path ([Environment]::GetFolderPath('System')) 'powercfg.exe'
        $modes = @{ saver='a1841308-3541-4fab-bc81-f71556f20b4a'; balanced='381b4222-f694-41f0-9685-ff5bb260df2e'; performance='8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' }
        $list = & $power /list
        if ($LASTEXITCODE -ne 0) { throw 'Cannot read installed power plans' }
        if ($p.action -eq 'power') {
            if (-not $modes.ContainsKey([string]$p.value) -or ($list -join ' ') -notmatch [regex]::Escape($modes[$p.value])) { throw 'Requested installed plan unavailable; no plan created' }
            & $power /setactive $modes[$p.value] | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Power plan rejected' }
        }
        $active = & $power /getactivescheme
        if ($LASTEXITCODE -ne 0 -or ($active -join ' ') -notmatch '[a-fA-F0-9-]{36}') { throw 'Active power plan unavailable' }
        $guid=$Matches[0]; $r=@{active=$guid; confirmed=($p.action -eq 'power' -and $guid -ieq $modes[$p.value]); installed=@($modes.Keys | Where-Object { ($list -join ' ') -match [regex]::Escape($modes[$_]) })}
    } else { throw 'Unknown narrow action' }
    $r | ConvertTo-Json -Depth 8 -Compress
} catch { @{error=$_.Exception.Message; confirmed=$false} | ConvertTo-Json -Compress; exit 1 }
