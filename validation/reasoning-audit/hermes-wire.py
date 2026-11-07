"""Capture the installed Hermes builder plus real SDK serialization, without network or config writes."""
import json
import os
import sys
from pathlib import Path

home = Path(os.environ.get("HERMES_HOME", str(Path.home() / "AppData/Local/hermes")))
sys.path.insert(0, str(home / "hermes-agent"))
from hermes_cli.config import load_config_readonly
from hermes_cli.runtime_provider_custom import _custom_provider_request_overrides
from hermes_constants import parse_reasoning_effort
from agent.transports.chat_completions import ChatCompletionsTransport
from providers import get_provider_profile
from openai import OpenAI
import httpx

config = load_config_readonly()
global_effort = (config.get("agent") or {}).get("reasoning_effort")
reasoning_config = parse_reasoning_effort(global_effort)
transport = ChatCompletionsTransport()
captured = []

def capture(request):
    captured.append(json.loads(request.content))
    return httpx.Response(200, json={"id": "audit", "object": "chat.completion", "created": 0,
        "model": "fixture", "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}]})

results = []
with httpx.Client(transport=httpx.MockTransport(capture)) as http_client:
    with OpenAI(api_key="audit-fixture", base_url="https://evren-llmapi.ssyz.org.tr/v1", http_client=http_client) as client:
        controls = json.loads(Path(__file__).with_name("ui-controls.json").read_text(encoding="utf-8"))
        for control in controls:
                model, name, body = control["model"], control["selection"], control["body"]
                entry = {"extra_body": body} if body else {}
                kwargs = transport.build_kwargs(model, [{"role": "user", "content": "fixture"}],
                    provider_profile=get_provider_profile("custom:iris-evren"),
                    base_url="https://evren-llmapi.ssyz.org.tr/v1", reasoning_config=reasoning_config,
                    max_tokens=32, max_tokens_param_fn=lambda n: {"max_tokens": n},
                    request_overrides=_custom_provider_request_overrides(entry))
                client.chat.completions.create(**kwargs)
                wire = captured[-1]
                results.append({"model": model, "selection": name,
                    "builder_top_level_reasoning_effort": kwargs.get("reasoning_effort"),
                    "extra_body": kwargs.get("extra_body"),
                    "serialized_controls": {k: v for k, v in wire.items() if k in ("thinking", "reasoning_effort", "reasoning", "think")}})

evidence = {"global_reasoning_effort": global_effort, "parsed_reasoning_config": reasoning_config,
    "method": "Installed Hermes ChatCompletionsTransport + provider profile + custom-provider overrides + actual OpenAI SDK; httpx MockTransport captures final JSON, no network or config writes.",
    "results": results}
target = Path(__file__).with_name("hermes-wire.json")
target.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
print(json.dumps(evidence))
