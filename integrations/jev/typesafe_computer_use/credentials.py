"""OpenCode credential access for this Windows pilot."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def opencode_key_path():
    return Path(__file__).resolve().parents[1] / "config/opencode-key.dpapi"


def opencode_token():
    """Prefer the pilot's explicitly saved key over unrelated ambient keys."""
    if sys.platform != "win32" or not opencode_key_path().is_file():
        return os.environ.get("OPENCODE_API_KEY")
    from .models import Abort

    original = Path(__file__).resolve().parents[1]
    try:
        result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(original / "scripts/Read-Key.ps1"),
            ],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        raise Abort("Cannot read the pilot's OpenCode credential") from None
    if result.returncode:
        raise Abort("Cannot decrypt the pilot's OpenCode credential under this Windows account")
    return result.stdout.strip()
