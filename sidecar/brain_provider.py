"""Private stdio adapter to the installed Hermes configuration and model transport.

No credentials in argv/logs. This is not a second agent or an OpenCode server.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


ENDPOINTS = {
    "evren": "https://evren-llmapi.ssyz.org.tr/v1",
    "opencode": "https://opencode.ai/inference/openai/v1",
}


def credential(config, env, provider, supplied=""):
    if supplied:
        return supplied.strip()
    key_name = f"IRIS_{provider.upper()}_API_KEY"
    if env.get(key_name):
        return env[key_name].strip()
    if provider == "opencode":
        return (env.get("OPENCODE_ZEN_API_KEY") or env.get("OPENCODE_API_KEY") or "").strip()
    # Reuse only a key explicitly bound to Evren, never another endpoint's key.
    entries = list((config.get("providers") or {}).values()) + list(config.get("custom_providers") or [])
    entries.append(config.get("model") or {})
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("api") or entry.get("base_url") or "").rstrip("/") != ENDPOINTS[provider]:
            continue
        name = entry.get("key_env") or entry.get("api_key_env")
        value = env.get(name, "") if name else entry.get("api_key", "")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def error_result(exc, key):
    status = getattr(exc, "status_code", None)
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        detail = body.get("error", body)
        message = detail.get("message", "") if isinstance(detail, dict) else str(detail)
    else:
        message = str(exc)
    if key:
        message = message.replace(key, "[redacted]")
    headers = getattr(getattr(exc, "response", None), "headers", {}) or {}
    return {"ok": False, "httpStatus": status, "error": message[:900], "retryAfter": headers.get("retry-after")}


def main(payload):
    home = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))
    source = Path(os.environ.get("IRIS_HERMES_SOURCE", str(home / "hermes-agent")))
    if source.exists():
        sys.path.insert(0, str(source))
    from hermes_cli.config import load_config_readonly, load_env, save_config

    provider = payload.get("provider")
    if provider not in ENDPOINTS:
        raise ValueError("Unknown Avalon brain provider")
    config = load_config_readonly()
    env = {**os.environ, **load_env()}
    key = credential(config, env, provider, str(payload.get("apiKey") or ""))
    action = payload.get("action", "info")
    if action == "info":
        # The caller is Electron main, never the renderer.
        result = {"configured": bool(key), "key": key, "baseUrl": ENDPOINTS[provider]}
        if payload.get("includeResearchSearch") is True:
            result["tavilyKey"] = env.get("TAVILY_API_KEY", "")
        return result
    if not key:
        return {"ok": False, "error": "Bu sağlayıcı için API anahtarı kaydedilmemiş.", "kind": "credentials"}
    if action == "prepare":
        from hermes_cli.fallback_config import get_fallback_chain
        if get_fallback_chain(config):
            return {"ok": False, "kind": "configuration", "error": "Hermes profilinde otomatik model fallback ayarı var. Avalon bu ayarı değiştirmedi; açık model seçimi için fallback kapalı olmalıdır."}
        import re
        slug = payload.get("providerSlug") or f"iris-{provider}"
        if not re.fullmatch(rf"iris-{provider}(?:-[a-z0-9-]+)?", slug):
            raise ValueError("Invalid Avalon provider alias")
        key_name = f"IRIS_{provider.upper()}_API_KEY"
        # Add only our own provider. Never change model:, tools or other providers.
        entry = {"name": f"Avalon {provider.title()}", "api": ENDPOINTS[provider],
                 "key_env": key_name, "api_mode": "chat_completions"}
        if payload.get("extraBody"):
            entry["extra_body"] = payload["extraBody"]
        previous = (config.get("providers") or {}).get(slug)
        if previous != entry:
            save_config({"providers": {slug: entry}}, merge_existing=True)
        if load_env().get(key_name) != key:
            from hermes_cli.credential_lifecycle import save_provider_env_credential
            save_provider_env_credential(key_name, key)
        return {"ok": True, "provider": slug, "model": payload["modelId"]}
    if action != "probe":
        raise ValueError("Unknown brain operation")
    from openai import OpenAI
    from agent.transports.chat_completions import ChatCompletionsTransport

    # Exercise Hermes' real wire builder and decoder, with a harmless local tool.
    transport = ChatCompletionsTransport()
    client = OpenAI(api_key=key, base_url=ENDPOINTS[provider], timeout=35, max_retries=0)
    tools = [{"type": "function", "function": {"name": "iris_probe_add", "description": "Add two integers.",
              "parameters": {"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
                             "required": ["a", "b"], "additionalProperties": False}}}]
    messages = [{"role": "system", "content": "You are running an isolated compatibility test. Use iris_probe_add for 2+3. After its result reply ONLY with JSON: {\"reply\":\"Sonuç 5.\",\"proposal\":null}."},
                {"role": "user", "content": "İki ile üçün toplamını verilen araçla hesapla."}]
    try:
        kwargs = transport.build_kwargs(payload["modelId"], messages, tools, max_tokens=1536,
                                        max_tokens_param_fn=lambda n: {"max_tokens": n})
        if payload.get("extraBody"):
            kwargs["extra_body"] = payload["extraBody"]
        if provider == "opencode":
            kwargs["extra_headers"] = {"x-opencode-session": payload["sessionId"]}
        raw = client.chat.completions.create(**kwargs)
        answer = transport.normalize_response(raw)
        if not answer.tool_calls:
            return {"ok": True, "accessible": True, "toolsVerified": False,
                    "message": "Yanıt alındı; araç döngüsü doğrulanmadı."}
        messages.append(raw.choices[0].message.model_dump(exclude_none=True))
        for call in answer.tool_calls:
            args = json.loads(call.arguments)
            if call.name != "iris_probe_add" or any(type(args.get(n)) is not int for n in ("a", "b")):
                return {"ok": False, "kind": "protocol", "error": "Model geçersiz deneme aracı üretti."}
            messages.append({"role": "tool", "tool_call_id": call.id,
                             "content": json.dumps({"sum": args["a"] + args["b"]})})
        kwargs = transport.build_kwargs(payload["modelId"], messages, tools, max_tokens=1536,
                                        max_tokens_param_fn=lambda n: {"max_tokens": n})
        if payload.get("extraBody"):
            kwargs["extra_body"] = payload["extraBody"]
        if provider == "opencode":
            kwargs["extra_headers"] = {"x-opencode-session": payload["sessionId"]}
        final = transport.normalize_response(client.chat.completions.create(**kwargs))
        try:
            parsed = json.loads((final.content or "").strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip())
        except (ValueError, TypeError):
            parsed = {}
        verified = isinstance(parsed.get("reply"), str) and "5" in parsed["reply"] and parsed.get("proposal", "missing") is None
        return {"ok": True, "accessible": True, "toolsVerified": verified,
                "message": "Araç sonucu ve Avalon yanıt sözleşmesi doğrulandı." if verified else "Araç çağrıldı; Avalon yanıt sözleşmesi doğrulanmadı."}
    except Exception as exc:
        return error_result(exc, key)
    finally:
        client.close()


if __name__ == "__main__":
    try:
        result = main(json.load(sys.stdin))
    except Exception as exc:
        # Never leak config values, provider payloads or exception reprs.
        result = {"ok": False, "error": f"Hermes brain adapter: {type(exc).__name__}", "kind": "runtime"}
    print(json.dumps(result, ensure_ascii=True))
