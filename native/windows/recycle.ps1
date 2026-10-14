param()
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
    $p=[Console]::In.ReadToEnd() | ConvertFrom-Json
    $target=[IO.Path]::GetFullPath([string]$p.path)
    $root=[IO.Path]::GetFullPath([string]$p.root).TrimEnd('\')
    if (-not $target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or $target -match '(?i)\\(\$Recycle\.Bin|Windows|Program Files[^\\]*|ProgramData|AppData|\.git|\.openclaw[^\\]*|\.codex|\.ssh)(\\|$)') { throw 'Protected path or scope escape' }
    $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($target))
    if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'Only local fixed NTFS recycle supported' }
    # Refuse unknown/disabled per-volume capacity; never infer capacity from 1 GB.
    $volume=Get-CimInstance Win32_Volume -Filter "DriveLetter='$($drive.Name.Substring(0,2))'"
    if (-not $volume -or $volume.DeviceID -notmatch '\{[a-fA-F0-9-]{36}\}') { throw 'Volume identity unavailable' }
    $volumeId=$Matches[0]
    $settings=Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\$volumeId" -ErrorAction Stop
    if ($settings.NukeOnDelete -ne 0 -or $null -eq $settings.MaxCapacity -or $settings.MaxCapacity -le 0) { throw 'Recycle disabled or capacity unknown' }
    $capacity=[long]$settings.MaxCapacity * 1MB
    $entry=Get-Item -LiteralPath $target -Force
    $all=[Collections.Generic.List[object]]::new(); $all.Add($entry)
    # Check before descending; never traverse a junction, including ancestors.
    $cursor=$entry; while($cursor) {if($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse point forbidden'}; $cursor=if($cursor -is [IO.FileInfo]){$cursor.Directory}else{$cursor.Parent}}
    $bytes=0L
    for($i=0; $i -lt $all.Count; $i++) {
        if($all.Count -gt 10000){throw 'Target exceeds bounded inspection'}
        $e=$all[$i]
        if($e.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse point forbidden'}
        if($e.PSIsContainer){foreach($child in Get-ChildItem -LiteralPath $e.FullName -Force){$all.Add($child)}}
        else {
            # fsutil emits every hardlink name. Failure or multiple entries closes admission.
            $links=& (Join-Path ([Environment]::GetFolderPath('System')) 'fsutil.exe') hardlink list $e.FullName
            if($LASTEXITCODE -ne 0 -or @($links | Where-Object { $_.Trim() }).Count -ne 1){throw 'Hardlink identity unavailable or multiple links'}
            $bytes += $e.Length
        }
        if($e.FullName -match '(?i)\\(AGENTS\.md|\.env[^\\]*|.*\.(pem|key|pfx|p12)|auth-profiles\.json|credentials[^\\]*|\$Recycle\.Bin)(\\|$)'){throw 'Protected descendant'}
    }
    Add-Type -Path (Join-Path $PSScriptRoot 'Recycle.cs')
    $used=[JarvisRecycle]::Used($drive.Name)
    if($used -lt 0 -or $bytes -ge ($capacity-$used) -or $bytes -ge $drive.AvailableFreeSpace){throw 'Insufficient or uncertain recycle capacity; no permanent deletion'}
    $r=[JarvisRecycle]::Run($target)
    $r | ConvertTo-Json -Compress
} catch {@{error=$_.Exception.Message;recycled=$false;confirmed=$false;retryAllowed=$false}|ConvertTo-Json -Compress;exit 1}
