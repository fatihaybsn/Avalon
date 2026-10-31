$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$config = @{
    mcpServers = @{
        'jev-computer-use' = @{
            command = (Get-Command node.exe).Source
            args = @((Join-Path $root 'mcp.mjs'))
        }
    }
}
$json = $config | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $root 'mcp-config.json'), $json, [Text.UTF8Encoding]::new($false))
Write-Host ('MCP configuration created: ' + (Join-Path $root 'mcp-config.json')) -ForegroundColor Green
