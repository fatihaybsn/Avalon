$ErrorActionPreference = 'Stop'
$portRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $portRoot
$env:PYTHONUTF8 = '1'
while ($true) {
    Clear-Host
    Write-Host 'OPENCODE JEV FREE - WINDOWS' -ForegroundColor Cyan
    Write-Host '1 - Check installation status'
    Write-Host '2 - Open usage and agent guide'
    Write-Host '3 - Change API key (hidden input)'
    Write-Host '4 - Generate and open MCP configuration'
    Write-Host '5 - Stop active runs'
    Write-Host '0 - Exit'
    switch (Read-Host 'Choice') {
        '1' { & '.venv/Scripts/python.exe' -c 'from typesafe_computer_use.credentials import opencode_token; from typesafe_computer_use.opencode import MODEL; from typesafe_computer_use.windows_ocr import engine; print("OpenCode key available:", bool(opencode_token())); print("Model:", MODEL); print("Local OCR:", engine().recognizer_language.language_tag); print("Writer: current MCP host agent")' }
        '2' { Start-Process notepad.exe -ArgumentList ('"'+(Join-Path $portRoot 'WINDOWS.md')+'"') }
        '3' { & (Join-Path $PSScriptRoot 'Set-OpenCodeKey.ps1') }
        '4' { & (Join-Path $PSScriptRoot 'Generate-McpConfig.ps1'); Start-Process notepad.exe -ArgumentList ('"'+(Join-Path $portRoot 'mcp-config.json')+'"') }
        '5' { & (Join-Path $PSScriptRoot 'Stop.ps1') }
        '0' { exit }
    }
    [void](Read-Host 'Press Enter to return to the menu')
}
