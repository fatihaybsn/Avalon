# OpenClaw Control UI

Selected files from OpenClaw 2026.10.2, commit
`b8952d477f0c932d8ddc6da5c89cab5a169b6ff1`, MIT license.
Original copyright and complete license: `vendor/openclaw/LICENSE`.
Per-file upstream URLs and SHA256: `vendor/openclaw/SOURCE.json`.

Unmodified upstream: Control UI base.css, panel-empty-state.ts,
text-direction.ts; Gateway client's device-auth.ts signature contract.
The adjacent lit/openclaw-element.ts is a JARVIS adapter using LitElement,
not the upstream base class. The application uses Vite + Lit and selected
Control UI primitives; the full Control UI or OpenClaw repository is not bundled.
Desktop-specific main, preload, renderer and layout glue are JARVIS code.
Upstream animations are disabled by the desktop stylesheet.

The selected browser Talk / Google Live sources from the same pinned commit
are preserved verbatim in vendor/talk/sources; SHA256 and provenance are in
vendor/talk/SOURCE.json. scripts/vendor-talk.mjs generates the browser-only
runtime.js, verifies original source hashes, and explicitly adapts local
microphone mute, input/sink selection and turn-scoped playback suppression.
Only Google provider-websocket / gemini-3.8-live is admitted; other transports
are excluded. Localization/error presentation and Gateway IPC are JARVIS glue.
Upstream media capture, AEC constraints, PCM queues, tool lifecycle and finalized
transcript persistence remain the pinned OpenClaw implementation.

Electron, Lit, ws and their dependency license notices are included by the
Windows packaging tool in the distribution's license files.
