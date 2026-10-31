$runsPath = Join-Path $PSScriptRoot '..\runs'
Get-ChildItem -LiteralPath $runsPath -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    [IO.File]::WriteAllText((Join-Path $_.FullName 'STOP'), 'stop')
}
Write-Host 'A stop was requested for all active runs.'
