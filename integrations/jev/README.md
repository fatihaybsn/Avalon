# OpenCode Jev Free — Windows Computer Use

A Windows desktop agent using OpenCode `jev-1.13-free`, local UI Automation/OCR,
and the existing TypeSafe SDK. The Python package and six MCP tool names retain
their upstream names for compatibility.

## Setup

Requires Windows 10/11, Python 3.12+, Node.js 20+, and an OpenCode API key.
The isolated pilot already has its dependencies installed.

1. For a fresh checkout, run `Install-Windows.cmd`.
2. Run `scripts/Set-OpenCodeKey.ps1` to enter the key in a hidden local prompt,
   or choose Change API key in `1-Start.cmd`.
3. Generate the MCP configuration and register it in your host only after the
   separate live integration approval.

The sole Jev provider is OpenCode. The endpoint and `jev-1.13-free` model are
fixed in `typesafe_computer_use/opencode.py`. Paid model overrides, redirects
and automatic provider fallback are rejected.

The saved key is `config/opencode-key.dpapi`, protected for the current Windows
account and excluded from Git. `OPENCODE_API_KEY` is supported if no saved key
exists. Never put a real key in source, JSON/YAML or command-line arguments.

## MCP workflow

1. `typesafe_windows`: identify one unique target window title.
2. `typesafe_run`: supply the goal and exact windowTitle; act=false by default.
   Act=true needs user authorization. The call waits for needs_host or completion.
3. On needs_host, inspect the request and attached image; the host supplies text,
   URL or final-screen interpretation through `typesafe_respond`.
4. Preserve runId on follow-up calls. Respond waits for the next meaningful event;
   do not poll while a run/respond call is pending.
5. Verify completion independently. A Jev DONE decision alone is not proof.

Use `typesafe_status` or `typesafe_wait` only when needed. `typesafe_stop`, host
cancellation, connection shutdown, task deadlines and the top-left mouse gesture
stop the worker. Already-sent input cannot be undone.

The target HWND/PID and its owned dialogs remain pinned. A changed target aborts
before input. Only one desktop executor should act at a time.

## Validation

```text
.venv/Scripts/python.exe -m pytest -q
node --test tests/mcp-runtime.test.mjs
.venv/Scripts/ruff.exe check .
.venv/Scripts/ruff.exe format --check .
node --check mcp.mjs
node --check mcp-runtime.mjs
```

`python -m scripts.opencode_check` sends one REAL public-fixture request with
Choice, Noul and Score; it does not control Windows. The existing successful
HTTP 200 evidence is in the parent review directory; cleanup needs no new call.

Real Windows/Qwen/voice task success remains a separate approved pilot.
See `WINDOWS.md` and `SECURITY.md` for platform limits and data handling.

## Attribution

Independent Windows port based on kofanlabs/typesafe-computer-use-windows and
awlevin/typesafe-computer-use (upstream cc7b5066ae1a07b5e3182e8f87a9b5b6dfdcffc1).
Original MIT license and notices are preserved in `LICENSE`. Historical macOS
reference material remains in `docs/upstream-macos-reference.md`.
