# Avalon: Windows installation runbook

This source repository includes the Avalon application, Hermes compatibility files under `scripts` and `compat/hermes`, integration tests, and the customized optional Jev source under `integrations/jev`. The installer fetches the exact Hermes base; the full upstream Hermes repository is not vendored here. No separate local delivery folder is required.

The supported target is native Windows 10/11 **x64**, using Windows PowerShell 5.1 or PowerShell 7. An internet connection and several gigabytes of free space are needed for the first installation. ARM64 and other operating systems are outside this package's validated target.

## 1 Prepare the application checkout

Node.js 24 LTS and npm should be installed for the Avalon desktop application. Git is normally used to clone Avalon; if an archive is used without Git, the Hermes setup script can bootstrap its hash-pinned portable Git privately.

Clone or extract the complete Avalon source repository. The documented scripts and manifests are already in its root-relative locations. Existing installed runtimes are preserved; do not copy another machine's environments or credentials into this checkout.

From the directory containing Avalon's `package.json`:

```powershell
npm.cmd ci
npm.cmd run build
```

No separate system Python, WSL, Docker, Hermes Desktop, or OpenCode CLI installation is required. Hermes' pinned installer provisions its managed Python and supported tools.

## 2 Install the compatible Hermes runtime

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\setup-hermes.ps1 -AvalonRoot .
```

The execution-policy override applies only to this process; the script does not change the machine's execution policy.

The default dedicated home is `%LOCALAPPDATA%\Avalon\Hermes`. A different empty local directory can be selected:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\setup-hermes.ps1 -AvalonRoot . -HermesHome "D:\Avalon Runtime\Hermes"
```

The installer:

1. Validates the packaged patch, bootstrap script, and support-file hashes.
2. Refuses an unowned nonempty destination and serializes concurrent installs for the same home.
3. Fetches Hermes commit `bf0203a794a07aac3ff764972ab9087baa4e4f4e` rather than following a moving branch.
4. Checks the baseline and applies the complete patch, including all added files. The modified baseline files are backed up first.
5. Uses the bundled, pinned upstream installer's dependency stage. Hermes PM owns Python dependencies; the installer does not run a raw `pip install` or upgrade the source.
6. Checks the customized source and the selected PM workspace, including 2,479 production Python files in the deep check.
7. Creates native guarded launchers under `avalon-bin`, outside Hermes' self-maintained `bin` directory.
8. Registers external update ownership and disables passive update checks for this dedicated installation.
9. Generates a local API secret, chooses an available loopback API port, and merges the connection fields into the specified Avalon checkout's `.env`.
10. Tests the authenticated WebSocket contract and local HTTP API without submitting a model prompt.

Relative paths follow PowerShell's active `Set-Location`. The installer also isolates Windows PowerShell module paths for subprocess compatibility; it does not change system module settings. The installed Hermes home must not be moved because its managed environments and launchers contain absolute paths. The downloaded compatibility package can be moved or removed after installation.

The final status is `READY` only after the requested checks complete. A network/download failure retains logs and resumable state. The same command can be rerun. A partially changed patch, unsupported revision, or modified compatibility package is rejected rather than reset or repaired blindly.

`-SkipGatewayProbe` explicitly skips both service-startup probes; it should be used only when that limitation is understood. It does not establish that the services can start.

## 3 Supply model credentials

The recommended setup uses **two external API keys**:

| Key | Location and purpose |
|---|---|
| Gemini API key | Entered in Avalon's initial setup/Settings; supplies the implemented real-time voice connection. Stored in `%USERPROFILE%\.iris\.env` as `GEMINI_API_KEY`. |
| Evren API key | Entered in Settings → Brain, then tested and applied. Stored by the provider adapter in the selected Hermes home's `.env` as `IRIS_EVREN_API_KEY`. |
| Local Hermes API secret | Generated automatically; mirrored to Avalon's repository `.env` as `API_SERVER_KEY`. It is not purchased from a provider. |

An eligible OpenCode Console key is optional and distinct from the Evren key. Current provider restrictions and costs are explained in [README](README.md#accounts-and-costs). A `free` model name is not proof of available free access through Hermes.

The generated Hermes `.env` and Avalon `.env` should be **merged**, not replaced by a sample file. Existing provider keys and unrelated options are preserved. The connection script never prints the generated secret. It does not request, generate, or verify the user's real provider keys.

For agent-assisted manual credential entry, the account holder can supply:

```text
Avalon user configuration: %USERPROFILE%\.iris\.env
  GEMINI_API_KEY=<Google AI Studio key>

Dedicated Hermes configuration: %LOCALAPPDATA%\Avalon\Hermes\.env
  IRIS_EVREN_API_KEY=<Evren account key>
```

The actual dedicated path must replace the default if `-HermesHome` was used. Paths in `.env` files should be actual absolute paths, not unresolved `%VARIABLE%` placeholders. The existing `.iris` and `IRIS_*` identifiers are required by the running code.

## 4 Start Avalon through the guarded entry point

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-avalon.ps1 -AvalonRoot .
```

`-HermesHome` should be added when a custom runtime directory was selected. `-Build` can be added to rebuild before launch; `npm ci` must already have completed.

This entry point launches the native Electron executable directly, avoiding the `.cmd` shell trampoline's failure on paths containing spaces. It verifies compatibility before starting Electron, supplies the matching API connection in the process environment, and puts the guarded Hermes alias first on that process's PATH. No system or user PATH entry is changed. An ordinary `npm start` or direct executable launch bypasses this outer preflight and PATH protection, so it is not the documented protected launch method.

The app's built-in gateway autostart remains enabled by default. Manual background scheduling can use the exact pinned executable, without choosing a different Hermes from PATH:

```powershell
$avalonHermesHome = Join-Path $env:LOCALAPPDATA 'Avalon\Hermes'
$avalonHermesBin = Join-Path $avalonHermesHome 'avalon-bin\avalon-hermes.exe'
& $avalonHermesBin gateway run
```

That foreground terminal must remain open. An already-running gateway for the same installation should be reused. For unattended operation, the same command can be registered deliberately with Windows Task Scheduler under the installation owner's account. The package does not silently register a startup task or install another Windows service.

In Avalon, the initial wizard should be completed, including display name, Gemini key/voice, and device permissions. The Hermes URL/key/path should already reflect the generated connection. Settings → Brain should then be used to enter, test, and **apply** the chosen provider/model. Model access and a real voice/task exchange must be checked separately from local runtime readiness.

## 5 Verify or troubleshoot

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\verify-hermes.ps1 -GatewayProbe
```

Without `-GatewayProbe`, verification checks source, package identity, the dependency selection/workspace, and actual compatibility imports. With it, local services are also exercised. The startup probes can start a gateway, so existing scheduled work and normal gateway behavior should be considered on a previously used home. They do not constitute a provider-key, speech, tool-account, or physical-phone test.

Useful files under the selected Hermes home:

```text
avalon-install-owner.json             Installer ownership/release
avalon-runtime.json                   Runtime identity, not provider secrets
avalon-bin/avalon-hermes.exe           Guarded executable configured in Avalon
avalon-bin/hermes.exe                  Guarded alias for child processes
avalon-compat/                        Installed self-contained guard/package
hermes-agent/install-stamp.json       External update ownership
.env                                 Local API settings and provider credentials
config.yaml                          Hermes preferences and providers
backups/                             Pre-patch/config/environment backups
logs/                                Bootstrap, preparation and probe logs
```

The generated port is normally `8642` when it is available. The `.env` connection contains the actual selected port; the installer does not stop a process already using `8642`.

Independent `hermes update`, dependency mutation through the guarded CLI, a changed commit/patch, and modified guard/receipt files are rejected. Normal source editing, administrator access, or an explicitly selected unrelated executable can bypass application-level protection; this is not an operating-system write lock. Future upgrades require a new tested compatibility package, not a blind `git pull`.

## Optional Jev executor

Jev is not installed by `setup-hermes.ps1`. Follow [the full manual Jev procedure](docs/JEV-WINDOWS.md) only when requested. It requires the complete customized pilot source, a separate locked Python environment, Windows OCR, Node dependencies, an OpenCode key saved by `Set-OpenCodeKey.ps1`, a merged Hermes MCP entry, and the proposed host routing skill. The key is stored in `<JEV_ROOT>\config\opencode-key.dpapi`; it is not copied from the Avalon brain settings.

The complete customized Jev source is bundled at `integrations/jev`; `compat/jev/source-manifest.json` records its identity. The guide verifies those files before copying them to a separate runtime. The Hermes patch stays unchanged. The earlier Hermes tests have their own scope. A subsequent [live Jev/Avalon verification](validation/live-jev/RESULTS.md) passed for one Notepad workflow and completion speech; new installations should run the documented opt-in check.

## 6 Android and notifications

The phone setup is documented in [README → Android setup](README.md#android-setup). It uses the same desktop installation, Tailscale on both devices, a private HTTPS origin, a pairing code, and a browser push subscription. These account/permission steps require the account holder or access to the physical phone. No installer should report phone notifications as verified merely because desktop setup passed.

## Validation commands

Installer integration tests are intentionally restricted to disposable directories under TEMP:

```powershell
python .\tests\test-windows-package.py --without-system-git --avalon-root .
```

These developer tests require Python 3.12+ for the test driver; this is not a system-Python prerequisite for installing Avalon/Hermes. After installation, the managed Python path is also recorded in `avalon-runtime.json` and can run that driver.

The custom Hermes regression files are run through the upstream canonical runner in a separate PM-built test environment:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tests\test-hermes-regressions.ps1
```

Actual test results and the tested scope are recorded in [validation/RESULTS.md](validation/RESULTS.md).

### GPT Researcher research runtime

After Hermes setup, set `HERMES_HOME` to the installation path and run the research installer from the Avalon checkout:

```powershell
$env:HERMES_HOME = Join-Path $env:LOCALAPPDATA 'Avalon\Hermes'
npm.cmd run setup:research
```

For a custom installation, use the same absolute path as `-HermesHome`. The installer prepares a separate Python 3.12 environment and checks that GPT Researcher loads. Both immediate and scheduled research reuse the existing Evren or OpenCode model credentials.

GPT Researcher plans the research and writes reports. Search queries first use Hermes's installed web search tool and its provider selection. Only queries that fail there try the optional Tavily Advanced backup. The next query starts with Hermes again. Hermes's free providers can have availability and rate limits.

For the backup, obtain a key from [Tavily](https://app.tavily.com/) and set `TAVILY_API_KEY` in `%USERPROFILE%\.iris\.env`. Avalon reads the saved key at the start of each research run, so a changed key applies to new runs. This file takes precedence over inherited terminal or Windows values. `TAVILY_API_KEY=` disables the backup while keeping Hermes as primary. If Tavily's quota or access is exhausted, it is skipped for the remainder of that run; subsequent queries still try Hermes. These research paths do not switch directly to DuckDuckGo. The task card and run summary show the provider and fallback notices. See [Tavily credit pricing](https://docs.tavily.com/documentation/api-credits).

Deep research defaults to breadth 3 and depth 2. Increasing either can increase runtime and search usage. Avalon shows elapsed time and saves partial material if you stop the task.

### Optional Node-RED workflow automation

On Windows x64, complete the Hermes and GPT Researcher setup above, then open **Planlama → Otomasyonlar → Kur** in Avalon. With internet access, Avalon installs the pinned Node-RED runtime in your Windows user profile and starts it when needed. **Yeni otomasyon oluştur / düzenle** opens the visual editor. New profiles include research-only, research + Hermes, and bounded revision examples. Existing flows are preserved. See the [README workflow guide](README.md#workflow-automation-with-node-red) for requirements, report handoff, scheduling, and supported flow types. The [automation guide](docs/AUTOMATION.md) documents native Hermes permissions, safe JSON sharing, and offline simulation tests.
