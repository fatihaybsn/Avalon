# Installs the pinned research worker beside Avalon's user settings.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $env:USERPROFILE '.iris\gpt-researcher-0.16.0'
$hermes = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
$manifest = Get-Content -Raw (Join-Path $root 'compat\hermes\compatibility.json') | ConvertFrom-Json
$uvPath = Join-Path $hermes ("tools\uv-" + $manifest.uvVersion + "-win32-x64\uv.exe")
if (-not (Test-Path -LiteralPath $uvPath)) {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    $uvPath = if ($uv) { $uv.Source } else { Join-Path $env:USERPROFILE '.local\bin\uv.exe' }
    if (-not (Test-Path -LiteralPath $uvPath)) { throw 'Avalon araştırma kurulumu için uv bulunamadı. Önce Hermes kurulumunu tamamlayın.' }
}
$python = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    & $uvPath venv --allow-existing --python 3.12 $venv
    if ($LASTEXITCODE -ne 0) { throw 'Araştırma Python ortamı oluşturulamadı.' }
}
& $uvPath pip sync --python $python (Join-Path $root 'sidecar\gpt-researcher.lock')
if ($LASTEXITCODE -ne 0) { throw 'GPT Researcher bağımlılıkları kurulamadı.' }

# The pinned 0.16.0 wheel defines a function before importing its annotations.
$file = Join-Path $venv 'Lib\site-packages\gpt_researcher\actions\query_processing.py'
$text = [IO.File]::ReadAllText($file)
if ($text.StartsWith("import json_repair") -and $text.Contains('def _normalize_sub_queries(parsed: Any,')) {
    [IO.File]::WriteAllText($file, "from __future__ import annotations`n" + $text, [Text.UTF8Encoding]::new($false))
}
# Keep provider recovery bounded in the pinned wheel without stacking SDK retries.
$llmFile = Join-Path $venv 'Lib\site-packages\gpt_researcher\utils\llm.py'
$llmText = [IO.File]::ReadAllText($llmFile)
$bounded = $llmText.Replace('max_attempts = 1 if (stream and websocket is not None) else 10', 'max_attempts = 1 if (stream and websocket is not None) else 3')
if ($bounded -ne $llmText) { [IO.File]::WriteAllText($llmFile, $bounded, [Text.UTF8Encoding]::new($false)) }
& $python -I -u (Join-Path $root 'sidecar\gpt_researcher_worker.py') --check
if ($LASTEXITCODE -ne 0) { throw 'GPT Researcher yükleme kontrolü başarısız.' }
