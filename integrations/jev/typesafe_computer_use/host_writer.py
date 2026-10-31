"""Pause the original writer/answer calls and ask whichever agent owns the run.

The live Python process retains the screen and loop state. The MCP host reads
one request, supplies a schema-checked reply, then the same loop resumes.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

from .models import Abort


def atomic_json(path: Path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def validate_reply(reply, properties):
    if not isinstance(reply, dict) or set(reply) != set(properties):
        raise ValueError("Reply must contain exactly the requested fields.")
    for name, spec in properties.items():
        expected = {"boolean": bool, "string": str}[spec["type"]]
        if type(reply[name]) is not expected:
            raise ValueError(f"Invalid type for {name}.")
        if isinstance(reply[name], str) and len(reply[name]) > 8000:
            raise ValueError("Host reply exceeds the text limit.")


class HostWriter:
    def __init__(self, folder: str):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)

    def structured(self, system, packet, properties, image=None, **unused):
        request_id = str(uuid.uuid4())
        image_path = None
        if image is not None:
            image_path = self.folder / f"{request_id}.png"
            preview = image.copy()
            preview.thumbnail((1568, 1568))
            preview.save(image_path)
        request = {
            "id": request_id,
            "system": system,
            "packet": packet,
            "properties": properties,
            "imagePath": str(image_path) if image_path else None,
        }
        atomic_json(self.folder / "request.json", request)
        response_path = self.folder / f"{request_id}.response.json"
        deadline = time.monotonic() + 1800
        while time.monotonic() < deadline:
            stop = os.environ.get("CLICKER_STOP_FILE")
            if stop and Path(stop).exists():
                raise Abort("host requested stop")
            if response_path.exists():
                reply = json.loads(response_path.read_text(encoding="utf-8-sig"))
                validate_reply(reply, properties)
                (self.folder / "request.json").unlink(missing_ok=True)
                return reply
            time.sleep(0.1)
        raise Abort("host response timed out")
