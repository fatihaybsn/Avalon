# OpenCode Jev Free — Windows notes

The agent uses the original TypeSafe SDK directly against OpenCode. Its API path
contains `/systemone`; this is the required OpenCode protocol name, not another
configured cloud provider.

- Provider: OpenCode only. Model: `jev-1.13-free` only.
- Local perception: Windows UI Automation and Windows.Media.Ocr.
- Capture: PrintWindow for the observed, pinned window.
- Input: UIA actions where supported, guarded keyboard/mouse fallback.
- Host: the existing MCP host supplies text/URLs and independent final checks.
- Key setup: `scripts/Set-OpenCodeKey.ps1`; encrypted local DPAPI storage.

`typesafe_run` requires a unique windowTitle. Preserve runId when responding or
stopping. Run/respond wait until meaningful events, with an overall deadline;
interruption reaches the worker through its STOP file. An unresponsive worker
is terminated after a short grace period. ImageContent accompanies host images.

Primary-display operation is supported. Mixed-DPI/secondary screens and arbitrary
GPU-rendered windows are not comprehensively validated. Unreadable capture or a
target change stops the task. Password fields and protected applications are
refused. Consequential actions require explicit user authorization.

Screen text goes to OpenCode for decisions. Screenshots and traces remain in the
local `runs/` directory; that folder and `config/` are excluded from Git.

Existing local tests and a direct API request succeeded. These do not establish
success or a speedup on every Windows task. Live Hermes registration, real
Windows input, Qwen visual help and Avalon readout remain separately approved
integration steps. The existing Cua infrastructure is unaffected.
