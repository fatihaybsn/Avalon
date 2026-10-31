$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $root

Write-Host 'Jev Computer Use - Windows installer' -ForegroundColor Cyan
$launcher = Get-Command py.exe -ErrorAction SilentlyContinue
if ($launcher) {
    & py.exe -3 -c 'import sys; assert sys.version_info >= (3,12)' 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 or newer is required: https://www.python.org/downloads/' }
    & py.exe -3 -m venv .venv
} else {
    & python.exe -c 'import sys; assert sys.version_info >= (3,12)' 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 or newer is required: https://www.python.org/downloads/' }
    & python.exe -m venv .venv
}

& '.\.venv\Scripts\python.exe' -m pip install --upgrade pip
& '.\.venv\Scripts\python.exe' -m pip install -e .

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20 or newer is required for the MCP server: https://nodejs.org/'
}
& node.exe -e 'const [major]=process.versions.node.split(".").map(Number); if(major<20) process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 20 or newer is required: https://nodejs.org/' }
& npm.cmd ci --no-audit --no-fund
& (Join-Path $PSScriptRoot 'Generate-McpConfig.ps1')

Write-Host ''
Write-Host 'Installation complete.' -ForegroundColor Green
Write-Host 'Next: open 1-Start.cmd, save your API key, then add mcp-config.json to your MCP host.'
