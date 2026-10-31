# Contributing

Bug reports with a redacted run folder attached are useful for reproduction.
`runs/<timestamp>/` holds the capture, the exact payload, and every probability,
so a stall can be replayed offline with `--image`.
Review screenshots, goals and traces for private information before sharing them.

## Ground rules

- Keep the action set mutually exclusive. Two options that mean the same thing
  split the vote and read as low confidence.
- The classifier picks; code decides facts. Anything the model would have to
  compute (dates, URL validity, whether a field is focused) is computed in code
  and handed over as state.
- Free text goes through `writer.py` and its structured reply guards.
  In MCP mode, `host_writer.py` delegates those replies to the current host agent.
- Keep platform calls in `windows.py` or `macos_native.py`. `macos.py` is the
  compatibility entry point that selects the platform implementation.
- Never add a path that types a password.

## Before a pull request

```
uv run ruff check . && uv run ruff format .
uv run pytest -q
node --check mcp.mjs
uv build
```

Add a replay-based note to the PR when a change alters what the model sees:
which run folder, which step, what the decision was before and after.
