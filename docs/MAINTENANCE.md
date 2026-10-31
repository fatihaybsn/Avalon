# Session and task-history maintenance

These are optional maintenance operations, not installation steps. Installation
and provider credentials are documented in [README](../README.md#installation).
This guide replaces the maintenance-only material formerly in `Kurulum.md`.

## Remove one selected Hermes conversation

Finish or stop the selected conversation's running tasks, then close Avalon.
Use the **same actual Hermes home** configured in Avalon. The example below is
the default dedicated installation; replace it when a custom home was selected.

```powershell
$avalonHermesHome = Join-Path $env:LOCALAPPDATA 'Avalon\Hermes'
$avalonHermesBin = Join-Path $avalonHermesHome 'avalon-bin\avalon-hermes.exe'
& $avalonHermesBin sessions list --source iris --limit 100
```

Older Avalon sessions may have source `api_server`; use that source filter, or
omit the filter to inspect the intended home's recent sessions. Select the exact
session by its ID, title and date. Deleting a session removes its conversation
history and can include linked child/delegated sessions; it is not a way to stop
a running task.

After the account holder has chosen the session to remove:

```powershell
& $avalonHermesBin sessions delete 'EXACT_SESSION_ID'
& $avalonHermesBin sessions list --source iris --limit 100
```

Replace `EXACT_SESSION_ID`; do not paste the placeholder as a real ID. The CLI
asks for confirmation. `--yes` skips that prompt only after the exact target and
deletion were already authorized; it does not bypass active-session restrictions.
If deletion is refused because a session is active, finish/stop the task and
close its session first. Never empty or edit `state.db` to remove conversations.

For an existing personal Hermes installation, use its actual executable and
`HERMES_HOME` instead of the dedicated launcher shown above. Do not select a
different installation solely because it happens to appear first on PATH.

## Reset the local task-card registry

Avalon's task-card history is separate from Hermes conversation history. Close
Avalon and finish/stop active work before changing it. If an authorized user wants
to reset the local card registry, preserve a recoverable backup:

```powershell
$registryPath = Join-Path $env:USERPROFILE '.iris\run-registry.json'
$registryBackup = $registryPath + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
if (Test-Path -LiteralPath $registryPath) {
    Move-Item -LiteralPath $registryPath -Destination $registryBackup
}
```

This resets the registry when Avalon next starts; it does not delete files that
tasks created, the Markdown vault, provider keys, reminders, or Hermes permanent
memory. Renaming the registry is not a replacement for cancelling a live task.
Keep the backup until the intended result has been confirmed.
