[CmdletBinding()]
param([switch]$WorkOnly)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$scratchBase = [IO.Path]::GetFullPath((Join-Path $repoRoot 'tmp'))
Push-Location $repoRoot
try {
  $testArgs = @('--max-semi-space-size=4', 'tests/gateway-policy.mjs')
  if ($WorkOnly) { $testArgs += '--work-only' }
  & node @testArgs | ForEach-Object {
    $line = "$_"
    if ($line.StartsWith('TEST_PROFILE_TO_REMOVE ')) {
      $testProfile = [IO.Path]::GetFullPath($line.Substring('TEST_PROFILE_TO_REMOVE '.Length))
      # Child already exited. Verify the exact test-owned path before removal.
      if (-not $testProfile.StartsWith($scratchBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($testProfile)).StartsWith('stage03-gateway-')) { throw 'Unexpected cleanup path' }
      $script:cleanupTestProfile = $testProfile
    } else { Write-Output $line }
  }
  $testExit = $LASTEXITCODE
  if ($script:cleanupTestProfile) { Remove-Item -LiteralPath $script:cleanupTestProfile -Recurse -Force }
  exit $testExit
} finally { Pop-Location }
