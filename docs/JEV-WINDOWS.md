# Optional Jev computer-use setup for Windows

Jev is a separate Windows desktop executor. Hermes remains the worker that understands the user's task, asks for authorization, supplies requested text or visual help, and verifies the result. Jev selects desktop actions using OpenCode `jev-1.13-free`; Windows UI Automation and Windows OCR observe the selected application locally.

**Verification status, 31 October 2026:** the pilot is now connected to the live Avalon/Hermes configuration and a real typed request → brain proposal/approval → Hermes/Jev Windows execution → exact file check → Gemini completion speech/renderer acknowledgement has passed. See [the verification report](../validation/live-jev/RESULTS.md). Jev remains a separately configured optional component; the standard Hermes installer does not enable it automatically on a new computer. The existing Hermes source patch is unchanged.

## 1 Obtain the complete reviewed source

The complete customized pilot source is bundled in **`integrations/jev`** in this Avalon repository. Its file inventory and SHA-256 values are recorded in **`compat/jev/source-manifest.json`**. The reviewed Windows port has upstream base commit `df0e6a98efe877524567af89ca036e882414e704` from `kofanlabs/typesafe-computer-use-windows`, plus the local pilot changes and added files. Cloning the upstream base alone does not reproduce this variant. No separate unpublished source download or original author's workspace is required.

The source must include `pyproject.toml`, `uv.lock`, `package.json`, `package-lock.json`, `mcp.mjs`, **`mcp-runtime.mjs`**, the complete `typesafe_computer_use` package including **`opencode.py`**, `scripts/Set-OpenCodeKey.ps1`, `scripts/Read-Key.ps1`, and the original `LICENSE`. The OCR grouping and guarded Ctrl+S changes in `windows_ocr.py`, `decide.py`, `actions.py`, and `windows.py` must be retained. These changes require no additional dependency beyond the reviewed lockfiles.

The source archive must exclude `.venv`, `node_modules`, `config`, `runs`, `.env`, credentials, screenshots, and machine-specific generated configuration. Existing virtual environments must not be copied between computers. Preserve the upstream MIT notices. The unrelated sibling `sysone` research directory is not a prerequisite.

For a first installation, open PowerShell in the Avalon repository root and run the following. It verifies the bundled source before copying it into the separate runtime directory. An existing nonempty runtime is preserved and rejected; an agent handling a repeat installation must inspect that runtime and its manifest before proceeding, rather than deleting its state.

```powershell
$ErrorActionPreference = 'Stop'
$avalonRoot = (Get-Location).ProviderPath
$jevSource = Join-Path $avalonRoot 'integrations\jev'
$jevManifestPath = Join-Path $avalonRoot 'compat\jev\source-manifest.json'
if (-not (Test-Path -LiteralPath $jevManifestPath)) { throw 'Bundled Jev source manifest is missing.' }
$jevManifest = Get-Content -LiteralPath $jevManifestPath -Raw | ConvertFrom-Json
foreach ($entry in $jevManifest.files) {
    $file = Join-Path $jevSource $entry.path
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing Jev source: $($entry.path)" }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
        throw "Jev source hash mismatch: $($entry.path)"
    }
}
$jevRoot = Join-Path $env:LOCALAPPDATA 'Avalon\Jev'
if ((Test-Path -LiteralPath $jevRoot) -and @(Get-ChildItem -LiteralPath $jevRoot -Force).Count -gt 0) {
    throw 'Jev destination is occupied; inspect the existing installation or select a new empty runtime directory.'
}
New-Item -ItemType Directory -Path $jevRoot -Force | Out-Null
foreach ($entry in $jevManifest.files) {
    $destination = Join-Path $jevRoot $entry.path
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $jevSource $entry.path) -Destination $destination
}
Copy-Item -LiteralPath $jevManifestPath -Destination (Join-Path $jevRoot 'avalon-source-manifest.json')
```

`$jevRoot` is the directory containing `mcp.mjs`, not its parent. An alternative empty local destination can be selected consistently throughout this guide. Do not copy `.venv`, `node_modules`, `config`, or `runs` from a previous installation. Keep the runtime under the same Windows account that will execute it.

## 2 Install the isolated dependencies

Requirements are native Windows x64, an interactive Windows account, Node.js 20+ and npm, `uv`, and an installed Windows OCR language. Avalon's Node.js 24 requirement also satisfies Jev. The reviewed pilot uses CPython **3.14.4 x64**; other Python versions allowed by `pyproject.toml` are not thereby validated. Jev gets its own `.venv`; nothing is installed into Hermes' managed Python environment.

Install `uv` using its [official Windows installation instructions](https://docs.astral.sh/uv/getting-started/installation/) if it is absent, then open a terminal in which `uv`, `node.exe`, and `npm.cmd` are available. The pilot used uv 0.11.8. The commands below use the checked-in dependency lock, consistent with [uv project environment management](https://docs.astral.sh/uv/guides/projects/).

Run in a dedicated PowerShell terminal; replace the default path if a different destination was selected:

```powershell
$ErrorActionPreference = 'Stop'
$jevRoot = Join-Path $env:LOCALAPPDATA 'Avalon\Jev'
Set-Location -LiteralPath $jevRoot
foreach ($file in @('pyproject.toml','uv.lock','package.json','package-lock.json','mcp.mjs','mcp-runtime.mjs','typesafe_computer_use\opencode.py')) {
    if (-not (Test-Path -LiteralPath (Join-Path $jevRoot $file))) {
        throw "Incomplete reviewed Jev source: $file"
    }
}
Get-Command uv,node.exe,npm.cmd -ErrorAction Stop | Out-Null
& node.exe -e 'if (parseInt(process.versions.node) < 20) process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 20 or newer is required.' }
$env:UV_PROJECT_ENVIRONMENT = Join-Path $jevRoot '.venv'
& uv python install 3.14.4
if ($LASTEXITCODE -ne 0) { throw 'Jev Python provisioning failed.' }
& uv sync --locked --python 3.14.4 --no-dev
if ($LASTEXITCODE -ne 0) { throw 'Jev locked dependency installation failed.' }
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Jev MCP dependency installation failed.' }
$jevPython = Join-Path $jevRoot '.venv\Scripts\python.exe'
& $jevPython -c 'from typesafe_computer_use.windows_ocr import engine; print(engine().recognizer_language.language_tag)'
if ($LASTEXITCODE -ne 0) { throw 'Windows OCR is unavailable; install a supported OCR language in Windows Settings and retry.' }
@'
from typesafe_computer_use.opencode import MODEL, ENDPOINT
assert MODEL == 'jev-1.13-free'
print(MODEL)
print(ENDPOINT)
'@ | & $jevPython -
if ($LASTEXITCODE -ne 0) { throw 'The reviewed OpenCode Jev adapter is missing or cannot import.' }
```

`--locked` must fail if the project and lockfile disagree; the installer must not silently regenerate the lock. The existing `Install-Windows.cmd`/`scripts/Install-Windows.ps1` is not the release procedure: it installs with an unlocked editable pip command and does not check every native command's exit code. `$ErrorActionPreference = 'Stop'` alone does not make failed native commands stop Windows PowerShell 5.1. The explicit checks above are intentional.

## 3 Store the OpenCode API key

An API key for an OpenCode account with access to this Jev endpoint is required. It is independent of the Gemini voice key, Evren brain key, and generated local Hermes `API_SERVER_KEY`. An existing OpenCode account key may be used only if it has the necessary entitlement; entering it in Avalon's brain settings does not automatically populate Jev's credential store. Obtain the key from the account holder's OpenCode Console. The `free` model identifier is not a promise of permanent availability, unlimited quota, or zero billing.

The recommended entry point is the supplied hidden-input script:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $jevRoot 'scripts\Set-OpenCodeKey.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Jev credential setup failed.' }
```

The account holder enters the key at the hidden prompt. It is saved at **`<JEV_ROOT>\config\opencode-key.dpapi`**, protected with Windows DPAPI for that Windows account. This is the precise key destination; plaintext does not belong in YAML, source code, a command-line argument, or a README. The runtime decrypts it with `scripts/Read-Key.ps1`. That helper outputs the secret to its caller and must not be run manually, logged, or pasted into a chat.

Alternatively, when no saved DPAPI file exists, the runtime accepts **`OPENCODE_API_KEY`** in the MCP process environment. The Python CLI also reads `<JEV_ROOT>\.env` under the documented working directory; a protected local `.env` may contain `OPENCODE_API_KEY=<ACCOUNT_KEY>`. This optional plaintext file must be excluded from Git and shared archives. Saved DPAPI credentials take precedence. No `ANTHROPIC_API_KEY` is needed on the MCP host-writer path; do not configure a separate paid writer as an automatic fallback.

Run Hermes, Node and the Jev worker under the same Windows account that saved the DPAPI key. A service or scheduled task under another account cannot reuse that encrypted file. If decryption fails, re-enter the credential under the intended account rather than copying another user's file.

## 4 Merge the MCP registration into the selected Hermes home

Finish the main README's pinned Hermes installation first. Select its **actual** home, including any custom `-HermesHome` value. The default is `%LOCALAPPDATA%\Avalon\Hermes`; do not accidentally edit a personal `%LOCALAPPDATA%\hermes` installation.

Back up `<HERMES_HOME>\config.yaml`. Generate the following YAML fragment in the same PowerShell terminal. It prints paths and policy only, never a key:

```powershell
$hermesHome = Join-Path $env:LOCALAPPDATA 'Avalon\Hermes'
$jevNode = (Get-Command node.exe -ErrorAction Stop).Source
$jevNodeYaml = ConvertTo-Json -InputObject $jevNode -Compress
$jevEntryYaml = ConvertTo-Json -InputObject (Join-Path $jevRoot 'mcp.mjs') -Compress
@"
mcp_servers:
  jev_windows_pilot:
    enabled: true
    command: $jevNodeYaml
    args:
      - $jevEntryYaml
    timeout: 200
    trust: untrusted
"@
```

Merge the **`jev_windows_pilot` child entry** under the existing `mcp_servers` mapping in `<HERMES_HOME>\config.yaml`. Do not duplicate the top-level mapping, replace the file, remove other servers, or copy example paths. Keep the server name `jev_windows_pilot`: the routing instructions depend on its generated tool names. The pilot's generic `Generate-McpConfig.ps1` produces a different `mcpServers` JSON schema and server name; that output is not the Hermes configuration above. The earlier proposal was deliberately disabled; enabling the installed entry is a separate, explicit setup step.

Hermes launches `node.exe` with the absolute `mcp.mjs` path over stdio. Jev resolves its own source root, `.venv`, and `runs` directory from that file, so it does not depend on Hermes' current directory. No listening HTTP port, new Windows service, OpenCode CLI, or OpenAI-compatible brain-model entry is required. Its fixed decision endpoint is `https://opencode.ai/inference/systemone/v1/systemone`, using the TypeSafe SDK protocol.

## 5 Install the host routing instructions and restart

Copy [the proposed Jev routing skill](jev/windows-task-routing.md) from this Avalon documentation into `<HERMES_HOME>\skills\productivity\windows-task-routing\SKILL.md`, after backing up an existing skill. This is an instruction-file installation, not a Hermes core patch. It remains a pilot policy until the complete integration is accepted.

Restart the Hermes processes serving this Avalon installation and start a new worker task so discovery and cached tool inventories reflect the registration. Use the main README's protected launch procedure. Do not interrupt unrelated installations or assume a running conversation refreshes its tools automatically.

Confirm that the **execution worker** exposes all six tools:

```text
mcp__jev_windows_pilot__typesafe_status
mcp__jev_windows_pilot__typesafe_windows
mcp__jev_windows_pilot__typesafe_run
mcp__jev_windows_pilot__typesafe_respond
mcp__jev_windows_pilot__typesafe_wait
mcp__jev_windows_pilot__typesafe_stop
```

The restricted conversation session must retain only its existing read-only tools. Registering MCP globally is not permission to widen the conversation contract. If the execution worker cannot discover the tools, inspect that session's MCP/toolset selection before changing source code.

## 6 Execute and validate a bounded task

1. Call `typesafe_status` to check readiness, then `typesafe_windows` to select one **exact, unique** target title.
2. After the requested action has been authorized, call `typesafe_run` with `goal`, `windowTitle`, `act: true`, `steps: 20`, `timeoutSeconds: 120`, and `waitForEvent: true`. `act` defaults to false. Observation-only runs still call the model and can consume provider quota.
3. Retain the returned `runId`. When the status is `needs_host`, the Hermes worker reads the request, inspects any attached image and supplies the exact requested fields through `typesafe_respond(runId, requestId, reply, waitForEvent: true)`. The standalone executor cannot supply its own host answers. In Avalon, this host is the Hermes worker, not Gemini's voice session or the deterministic benchmark script.
4. If the selected brain cannot consume the returned image, use its supported image-analysis tool/auxiliary vision route. Otherwise report the missing capability. The pilot has not established that every Evren/OpenCode brain route can provide this help.
5. Do not poll while run/respond is pending. The task deadline includes time waiting for host help and is capped at 180 seconds; Hermes' 200-second MCP timeout leaves room for worker termination. Split longer work into separately verified tasks.
6. Verify the requested result independently. A Jev `DONE` decision is not proof, and a low-confidence stop after a correct save is not a reason to repeat input blindly. Stop with `typesafe_stop(runId)` when requested; retain cancellation and the upper-left-corner emergency stop.

Only one executor should control the desktop. The current MCP server prevents a second run in that server instance; it does **not** implement a cross-process lock shared with CUA. The installation/operator must prevent overlapping Jev/CUA tasks. Jev may use foreground focus and keyboard/mouse input; do not advertise CUA's background-input behavior for Jev. Locked sessions, UAC/protected applications, arbitrary GPU-rendered windows, secondary displays and mixed DPI are not established supported workflows. Screen text is sent to OpenCode; local screenshots and traces are kept in `<JEV_ROOT>\runs` and must not be published.

Validate in stages: imports/OCR/key availability without printing secrets; MCP discovery and status; cancellation; then an authorized empty-Notepad task that saves exact supplied text to a new file. Verify the file bytes, followed by an actual Avalon task-card result and, when requested, voice delivery. Phone pairing remains the main README's separate setup; Jev runs on the PC, not the phone.

The earlier speed pilot used a deterministic host. A subsequent real Avalon/Hermes host test now also passed, including three host handoffs, visual help, exact saved-file content, matching Gemini completion transcription and renderer playback acknowledgement. A separate real Python-worker MCP cancellation check passed. These results do not establish a universal speedup. `scripts/live-speed.mjs` performs real desktop actions and provider calls; it is a developer benchmark, not an installation health check.

## Maintainer release checklist

This repository includes the full customized source, license, lockfiles, routing proposal and source manifest. The real development-machine host/task/audio checks and Python-worker cancellation passed; a new installation must still verify its own accounts, active desktop, OCR and final result. Regenerate the source manifest if the bundled Jev files change. Keep the existing Hermes source pin and patch; any future core change requires its own compatibility review.

## Opt-in live Avalon check

Open one new empty Notepad window and use its exact observed title. From the
Avalon repository root, after completing the separate setup above:

```powershell
$env:AVALON_JEV_TEST_WINDOW_TITLE = Read-Host 'Exact title of the empty Notepad window'
node .\scripts\test-jev-avalon-live.mjs --run-live
if ($LASTEXITCODE -ne 0) { throw 'The real Jev/Avalon check did not pass; inspect its report.' }
```

This deliberately uses real provider quota, writes a new test file through
Notepad and generates completion audio. It uses an isolated Electron profile
and settings file, silent microphone input and the real Avalon IPC/renderer.
The new test conversation is explicitly selected. It never simulates the model,
answers Jev host packets itself, or fabricates playback acknowledgements.
The full local report path and a summary under `validation/live-jev` are printed.
Do not run this as a hidden background health check or while another desktop
executor is active.
