# Windows compatibility package validation

Date: 30 October 2026. Release: `avalon-hermes-2026.10.30.1`.
Target: native Windows x64; Windows PowerShell 5.1 and PowerShell 7.

## Final package result

**20 integration tests passed; 0 failures, 0 errors, 0 skipped.**
Elapsed: 77.44 seconds. See [machine-readable results](final-package-results.json).
The tested scripts match [their recorded SHA-256 values](final-script-hashes-before.json).

The final run reused an installer-owned disposable TEMP installation and its existing
managed dependencies. Its compatibility assets and native guard were refreshed
to the final package before testing. No source/dependency download was repeated.
This is a final integration run, not a second cold-install measurement.

Coverage includes source/runtime inventory, repeat installation under both
PowerShell versions, authenticated WebSocket and HTTP startup, blocked updates,
rejected source/guard/workspace tampering, preservation of unknown destinations,
wrong-revision rejection, configuration/key preservation, actual Avalon gateway
and HTTP clients, managed-Python provider adapter, native argument quoting,
relative paths, and **the real Electron executable launched from an application
path containing spaces**. The Electron smoke application uses an isolated profile,
checks the startup environment, and exits; it is not a full interactive UI test.

## Earlier completed checks

- A real cold installation without system Git passed 19 integration tests,
  including the private pinned portable-Git bootstrap. That run took about
  27.5 minutes, mostly downloading/installing dependencies. Its application-launch
  check preceded the final direct-Electron launcher change. See
  [cold-install evidence](windows-verified-release.json).
- The four custom Hermes regression files passed **53 tests** using the upstream
  `scripts/run_tests.sh` runner in a separate PM-built test environment.
  See [runner result](final-hermes-regressions/canonical-hermes-tests.json)
  and [test output](final-hermes-regressions/canonical-hermes-tests.log).
  The Hermes patch did not change after these tests.

## Scope and installation handoff

No real provider prompt, provider billing/free entitlement, microphone conversation,
physical Android pairing or delivered phone notification was tested. Those require
the user's accounts, permissions and devices. Local runtime readiness does not
establish those external capabilities. The tests made zero model-provider requests.

The ZIP is a compatibility/documentation overlay, not the complete Avalon application.
Its contents must be merged into the intended Avalon source repository before
publication. The README clone example now uses GitHub owner `Avalon` and repository `avalon`. Follow [the runbook](../INSTALL-WINDOWS.md).

Existing application and personal Hermes source were not edited by this finalization.
Disposable TEMP test installations were retained; they are not included in the ZIP.
There is no installer, test, or cleanup process intentionally left running.

## Documentation update: 31 October 2026

The README, runbook and optional Jev guide were expanded after the above Hermes
validation. The routing proposal is provided as documentation under
`docs/jev/windows-task-routing.md`; it has not been installed into a live profile.
No Hermes patch, installer/runtime script or Jev source was changed by this
documentation update. The complete customized Jev source is not included in this
ZIP, and its public release identity remains a prerequisite. The guide describes
a manual integration, not an already validated unattended Jev installer.
The 20/53 results above retain their original Hermes scope and do not certify
Jev, current provider access, or the complete Avalon/brain/Jev/voice chain.

## Repository consolidation: 31 October 2026

The earlier delivery-overlay and missing-Jev-source statements above describe
previous artifacts. In this source checkout, the tested Hermes compatibility
payload is now included under scripts/compat/tests, and 72 reviewed Jev source
files are bundled under integrations/jev with compat/jev/source-manifest.json.
No separate private workspace or desktop delivery folder is needed for setup.
The payload hashes, offline Jev lock consistency and documentation links were
checked; see repository-payload.json. No cold installation, new provider prompt,
or complete real Hermes/Jev/voice-chain test was performed during consolidation.
Live runtime source and profile settings were not changed.

## Subsequent live Jev/Avalon verification: 31 October 2026

The earlier incomplete-integration statements above are historical. The actual
selected Hermes profile is now connected to Jev. A real typed Avalon request,
brain proposal/approval, Hermes/Jev host handoffs, exact Notepad file content,
Gemini completion transcription and renderer playback acknowledgement passed.
The separate real Python MCP cancellation check also passed. See
[live verification](live-jev/RESULTS.md) for scope and evidence.
272 Avalon, 208 Jev Python and 6 Jev MCP tests passed during this change.
