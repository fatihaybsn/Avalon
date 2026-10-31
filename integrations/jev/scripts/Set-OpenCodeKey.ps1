$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
$secret = Read-Host 'OpenCode API key (hidden)' -AsSecureString
try {
    if ($secret.Length -lt 20) { throw 'Invalid key length; nothing saved.' }
    $configFolder = Join-Path $PSScriptRoot '..\config'
    New-Item -ItemType Directory -Force -Path $configFolder | Out-Null
    $keyFile = Join-Path $configFolder 'opencode-key.dpapi'
    [IO.File]::WriteAllText($keyFile, (ConvertFrom-SecureString -SecureString $secret), [Text.Encoding]::ASCII)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $fileAcl = New-Object Security.AccessControl.FileSecurity
    $fileAcl.SetOwner($identity.User)
    $fileAcl.SetAccessRuleProtection($true, $false)
    $fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity.User, 'FullControl', 'Allow')))
    Set-Acl -LiteralPath $keyFile -AclObject $fileAcl
    Write-Host 'OpenCode credential saved.'
} finally { $secret.Dispose() }
