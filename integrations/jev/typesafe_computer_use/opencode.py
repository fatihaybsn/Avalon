"""Original TypeSafe SDK, configured for OpenCode Jev Free. No JSON conversion."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import httpx2
from typesafe_sdk import RetryPolicy, TypeSafeClient

from .credentials import opencode_token
from .models import Abort

BASE_URL = "https://opencode.ai/inference/systemone"
ENDPOINT = BASE_URL + "/v1/systemone"
MODEL = "jev-1.13-free"


def make_opencode_client(*, api_key=None, transport=None):
    key = api_key or opencode_token()
    if not isinstance(key, str) or not key.strip() or any(char.isspace() for char in key):
        raise Abort("OpenCode key missing; use scripts/Set-OpenCodeKey.ps1 locally")

    def check_stop():
        stop = os.environ.get("CLICKER_STOP_FILE")
        if stop and Path(stop).exists():
            raise Abort("host requested stop")

    def before(request):
        check_stop()
        body = json.loads(request.content)
        if str(request.url) != ENDPOINT or request.method != "POST" or body.get("model") != MODEL:
            raise Abort("Only the official OpenCode endpoint and jev-1.13-free are permitted")
        if client.calls >= 40:
            raise Abort("OpenCode pilot request budget reached")
        client.calls += 1
        request.extensions["jev_started"] = time.perf_counter()

    def after(response):
        try:
            check_stop()
            if not response.is_success:
                # Never expose provider response bodies/credentials, retry or switch models.
                raise Abort(f"OpenCode HTTP {response.status_code}; stopped without retry or paid fallback")
            response.read()
            try:
                body = response.json()
            except ValueError:
                raise Abort("OpenCode returned invalid JSON") from None
            if not isinstance(body, dict) or body.get("model") != MODEL:
                raise Abort("OpenCode returned an unexpected model; no input permitted")
            check_stop()
        finally:
            client.api_elapsed_ms.append(round((time.perf_counter() - response.request.extensions["jev_started"]) * 1000, 2))

    http = httpx2.Client(
        transport=transport,
        timeout=10,
        follow_redirects=False,
        trust_env=False,
        event_hooks={"request": [before], "response": [after]},
    )
    client = TypeSafeClient(api_key=key, base_url=BASE_URL, model=MODEL, retry=RetryPolicy(max_retries=0), http_client=http)
    client.calls = 0
    client.api_elapsed_ms = []
    return client
