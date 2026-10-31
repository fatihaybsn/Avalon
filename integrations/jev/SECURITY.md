# Security and privacy

This agent can capture and interact with a selected native Windows window. Keep
private or unrelated windows closed, select a unique target title, and do not use
the computer at the same time as an active run.

Screen text and accessibility labels are sent to the configured Jev provider.
Screenshots, OCR, goals, decisions, and action traces are stored locally under
`runs/`; that folder is ignored by Git. API keys saved through `1-Start.cmd` are
encrypted with Windows DPAPI and can only be decrypted by the Windows account
that saved them.

The runtime refuses password fields and does not bypass UAC, lock screens, or
Windows access controls. Review consequential actions such as sending,
publishing, purchasing, deleting, or changing account security before authorizing
them. Move the mouse to the upper-left corner or use `0-Stop.cmd` to request a
stop; an input already sent cannot be undone.

Please report security issues privately to the repository owner. Never attach API
keys, private screenshots, or run folders to a public issue.
