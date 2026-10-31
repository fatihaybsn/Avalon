# General Windows benchmark

`GeneralFixture.exe` provides eight deterministic, local WinForms task
families. Every run writes its natural-language goal to `case.json`, logs UI
mutations to `events.jsonl`, and independently evaluates the final state in
`result.json`. No business service or user account is involved.

Families: `form`, `long-list`, `menu-dialog`, `grid`, `text-editor`,
`dynamic`, `ocr-visual`, and `recovery`.

Build:

```powershell
.\Build.ps1
```

Run one case:

```powershell
.\GeneralFixture.exe form 11 C:\path\to\run-folder
```

Seeds ending in 0–4 are development, 5–7 are rotating regression, and 8–9
are holdout. Holdout cases must not guide implementation changes. A benchmark
runner must reset the process and output directory for each engine, alternate
engine order, and accept success only from `result.json` plus final-screen
inspection. Failed and incomplete runs remain in aggregate statistics.
