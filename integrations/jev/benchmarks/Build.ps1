$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Compiler)) { throw "C# compiler not found: $Compiler" }
& $Compiler /nologo /target:winexe /optimize+ /out:"$Here\GeneralFixture.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "$Here\GeneralFixture.cs"
if ($LASTEXITCODE -ne 0) { throw "Fixture compilation failed: $LASTEXITCODE" }
Get-FileHash -Algorithm SHA256 -LiteralPath "$Here\GeneralFixture.exe" | Select-Object Algorithm, Hash, Path
