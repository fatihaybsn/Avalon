$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
$keyPath = Join-Path $PSScriptRoot '..\config\opencode-key.dpapi'
$secret = (Get-Content -LiteralPath $keyPath -Raw).Trim() | ConvertTo-SecureString
$keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr); $secret.Dispose() }
