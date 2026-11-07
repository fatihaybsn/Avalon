"""Capture current Hermes/SDK request controls without network or configuration writes."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(os.environ["HERMES_HOME"]) / "hermes-agent"))
from hermes_cli.config import load_config_readonly
from hermes_cli.runtime_provider_custom import _custom_provider_request_overrides
from hermes_constants import parse_reasoning_effort
from agent.transports.chat_completions import ChatCompletionsTransport
from providers import get_provider_profile
from openai import OpenAI
import httpx

config = load_config_readonly()
current = (config.get("agent") or {}).get("reasoning_effort")
controls = json.load(sys.stdin)
captured = []

def capture(request):
    captured.append(json.loads(request.content))
    return httpx.Response(200, json={"id": "audit", "object": "chat.completion", "created": 0,
        "model": "fixture", "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}]})

results = []
transport = ChatCompletionsTransport()
with httpx.Client(transport=httpx.MockTransport(capture)) as http_client:
    with OpenAI(api_key="audit-fixture", base_url="https://evren-llmapi.ssyz.org.tr/v1", http_client=http_client) as client:
        for global_effort in dict.fromkeys([current, "none", "low", "high"]):
            for control in controls:
                kwargs = transport.build_kwargs(control["model"], [{"role": "user", "content": "fixture"}],
                    provider_profile=get_provider_profile("custom:iris-" + control["provider"]),
                    base_url=control["baseUrl"], reasoning_config=parse_reasoning_effort(global_effort),
                    max_tokens=32, max_tokens_param_fn=lambda n: {"max_tokens": n},
                    request_overrides=_custom_provider_request_overrides({"extra_body": control["body"]}))
                client.chat.completions.create(**kwargs)
                results.append({"global": global_effort, "provider": control["provider"], "model": control["model"],
                    "selection": control["selection"], "controls": {k: v for k, v in captured[-1].items()
                    if k in ("thinking", "reasoning_effort", "reasoning", "think")}})
configured = {slug: {"api": entry.get("api"), "api_mode": entry.get("api_mode"), "extra_body": entry.get("extra_body")}
    for slug, entry in (config.get("providers") or {}).items() if slug.startswith("iris-") and isinstance(entry, dict)}
print(json.dumps({"current_global": current, "configured_avalon_providers": configured,
    "agent_max_tokens": (config.get("agent") or {}).get("max_tokens"),
    "model_max_tokens": (config.get("model") or {}).get("max_tokens"), "results": results}))
