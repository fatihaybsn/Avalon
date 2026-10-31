# Live Avalon / Hermes / Jev verification

31 October 2026. **Passed** using real providers and the actual Avalon application.

A typed request produced a real brain task proposal. After one-time approval,
the Hermes worker invoked Jev, supplied three real `typesafe_respond` host
responses, used `vision_analyze`, and verified the saved file through a read-only
terminal command. No simulated model, host response, completion or playback was
substituted. The task wrote `Jev Avalon doğrulaması başarılı.` in Notepad and
saved a new file with exactly those UTF-8 bytes and no final newline.

The real worker returned `Jev doğrulaması tamamlandı.`. Gemini generated audio;
its returned transcription matched that text exactly, and the renderer emitted
the matching completion-run playback acknowledgement. The complete check took
163.65 seconds including startup, the real brain, approvals and host assistance.
This is not the earlier deterministic-host 11.2-second save measurement.

The real Python Jev worker also passed a separate observation-only cancellation
check: cancelling its pending MCP request created STOP and terminated the worker.
The cancellation check did not issue desktop input.

Additional checks: **272 Avalon Node tests, 208 Jev Python tests, and 6 Jev MCP
tests passed**. The runtime was installed from the bundled source/lock into a
separate environment; credentials remained outside the repository.

Evidence: [structured results](RESULTS.json), [verified file](verified-output.txt),
and [cancellation result](cancellation.json). Raw local diagnostics are referenced
by latest.json and are not an installation dependency.

Scope: one Windows Notepad workflow. The test used a typed request and silent
microphone input; completion audio/renderer playback were verified, not human
hearing or microphone speech recognition. The existing Hermes source patch was
unchanged. Live connection settings and routing skill were installed in the
actual selected Hermes home, with a backup of the prior settings.

## Recorded model requests

The successful workflow recorded 9 Jev decision requests, 11 main worker
requests, 2 conversation/context requests, 1 vision request and 1 automatic
title request: 24 text/vision model calls. Gemini used one Live connection
with 7 speech-generation starts, including 2 interrupted starts; this does
not mean 7 independent HTTP requests or 7 completed spoken replies.
See [request-count evidence](model-request-counts.json).
