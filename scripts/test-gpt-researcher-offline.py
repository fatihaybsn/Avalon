"""Exercise the pinned GPT Researcher pipeline without making network requests."""
import asyncio
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("worker", ROOT / "sidecar/gpt_researcher_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
from gpt_researcher.retrievers.tavily.tavily_search import TavilySearch
from gpt_researcher.skills.browser import BrowserManager

SOURCE = "https://example.org/source"
events = []
worker.emit = lambda kind, **payload: events.append((kind, payload))


def check_quota():
    with patch("requests.post", return_value=SimpleNamespace(status_code=432)) as tavily, patch("ddgs.DDGS") as ddg:
        ddg.return_value.text.return_value = [{"href": SOURCE, "body": "result"}]
        worker.configure_search("test-key")
        assert TavilySearch("first").search()
        assert TavilySearch("second").search()
        assert tavily.call_count == 1 and ddg.return_value.text.call_count == 2
        assert tavily.call_args.kwargs["json"]["search_depth"] == "advanced"
        assert any(payload.get("reason") == "quota" for _, payload in events)


def check_search_queries():
    full = "Şirket araştırması\n" + "Private profile and archive. " * 100
    response = SimpleNamespace(status_code=200, ok=True, json=lambda: {
        "results": [{"url": SOURCE, "content": "Evidence"}]
    })
    with patch("requests.post", return_value=response) as request:
        worker.configure_search("test-key", initial_query=full, initial_topic="Türkiye Jetson robotik şirketleri")
        assert TavilySearch(full).search()
        assert request.call_args.kwargs["json"]["query"] == "Türkiye Jetson robotik şirketleri"
        request.reset_mock()
        query = "Jetson robotik TensorRT görüntü işleme " * 30
        assert TavilySearch(query + "site:example.org/docs").search()
        sent = [call.kwargs["json"] for call in request.call_args_list]
        assert len(sent) > 1 and all(len(item["query"]) <= 400 for item in sent)
        assert " ".join(item["query"] for item in sent) == " ".join(query.split())
        assert all(item["include_domains"] == ["example.org"] for item in sent)
        assert all("Private profile" not in item["query"] for item in sent)


def check_hermes_search():
    response = SimpleNamespace(status_code=200, ok=True, json=lambda: {
        "results": [{"url": SOURCE, "content": "Tavily fallback evidence"}]
    })

    def input_for(*responses):
        return io.TextIOWrapper(io.BytesIO(b"".join(json.dumps(row).encode() + b"\n" for row in responses)))

    primary = [{"href": SOURCE, "body": "Hermes evidence"}]
    with (patch.object(sys, "stdin", input_for({"id": 1, "error": "Provider busy"},
                                               {"id": 2, "results": primary},
                                               {"id": 3, "results": []})),
          patch("requests.post", return_value=response) as tavily, patch("ddgs.DDGS") as ddg):
        events.clear()
        worker.configure_search("backup-key", use_hermes=True)
        assert TavilySearch("first site:example.org").search()[0]["body"] == "Tavily fallback evidence"
        assert TavilySearch("second").search() == primary
        assert TavilySearch("no matches").search() == []
        assert tavily.call_count == 1 and not ddg.called
        assert tavily.call_args.kwargs["json"]["include_domains"] == ["example.org"]
        requests = [payload for kind, payload in events if kind == "search_request"]
        assert [item["id"] for item in requests] == [1, 2, 3]
        assert "site:example.org" in requests[0]["query"]
        assert any(payload.get("reason") == "hermes_error" for _, payload in events)

    for status in (432, 433, 401, 403):
        with (patch.object(sys, "stdin", input_for({"id": 1, "error": "unavailable"},
                                                   {"id": 2, "error": "unavailable"},
                                                   {"id": 3, "results": primary})),
              patch("requests.post", return_value=SimpleNamespace(status_code=status, ok=False)) as tavily,
              patch("ddgs.DDGS") as ddg):
            errors = worker.configure_search("exhausted-key", use_hermes=True)
            assert TavilySearch("first").search() == []
            assert TavilySearch("second").search() == []
            assert TavilySearch("third").search() == primary
            assert tavily.call_count == 1 and not ddg.called and errors

    with (patch.object(sys, "stdin", input_for({"id": 99, "results": primary})),
          patch("requests.post") as tavily, patch("ddgs.DDGS") as ddg):
        errors = worker.configure_search("", use_hermes=True)
        assert TavilySearch("no backup").search() == []
        assert not tavily.called and not ddg.called and errors


async def check_model_retry():
    class Busy(Exception):
        status_code = 429

    async def call():
        if not events:
            raise Busy()
        return "ready"

    async def stalled():
        await asyncio.sleep(1)

    events.clear()
    assert await worker.retry_model(call, budget=1, initial_delay=0) == "ready"
    assert any(kind == "warning" for kind, _ in events)
    try:
        await worker.retry_model(stalled, budget=0.05, attempt_timeout=0.01, initial_delay=0)
    except TimeoutError as error:
        assert "15 dakika" in str(error)
    else:
        raise AssertionError("Expected the model retry deadline to expire")


async def model(self, messages, stream, websocket=None, **kwargs):
    assert self.llm.model_name == "qwen3.8-flash-next"
    assert self.llm.extra_body["thinking"] is False
    prompt = str(messages)
    if stream:
        assert "handoff marker from the earlier report" in prompt
        output = "# Research report\n\nThe test product uses Jetson."
        if websocket:
            await websocket.send_json({"type": "report", "output": output})
        return output
    if '"researchGoal"' in prompt:
        return '[{"query":"jetson product","researchGoal":"Verify Jetson"}]'
    if '"followUpQuestions"' in prompt:
        return '{"learnings":[{"insight":"The product uses Jetson.","sourceUrl":"https://example.org/source"}],"followUpQuestions":[]}'
    if '"questions"' in prompt:
        return '{"questions":["What does the product use?"]}'
    if "agent_role_prompt" in prompt:
        return '{"server":"Research Agent","agent_role_prompt":"Research the question."}'
    if "using only the supplied material" in prompt:
        assert "handoff marker from the earlier report" in prompt
        return "# Strategy\n\nUse the prior evidence."
    return '["jetson product"]'


async def browse(self, urls):
    data = [{"url": SOURCE, "raw_content": "The product runs Jetson and TensorRT. " * 8,
             "title": "Company", "image_urls": []}]
    self.researcher.add_research_sources(data)
    return data


def check_pipeline():
    events.clear()
    job = {"route": {"provider": "evren", "modelId": "qwen3.8-flash-next"},
           "baseUrl": "https://example.org/v1", "apiKey": "test", "tavilyKey": "test",
           "reasoning": {"thinking": False}, "language": "tr", "mode": "deep",
           "breadth": 3, "depth": 1, "topic": "Jetson products", "purpose": "Full instructions " * 150, "sites": [],
           "reports": [{"name": "Prior research", "markdown": "handoff marker from the earlier report"}]}
    response = SimpleNamespace(status_code=200, ok=True, json=lambda: {
        "results": [{"url": SOURCE, "content": "The product uses Jetson."}]
    })
    with (patch.object(GenericLLMProvider, "get_chat_response", model),
          patch.object(BrowserManager, "browse_urls", browse),
          patch("requests.post", return_value=response) as request):
        asyncio.run(worker.research(job))
    assert request.call_args_list[0].kwargs["json"]["query"] == job["topic"]
    assert all(len(call.kwargs["json"]["query"]) <= 400 for call in request.call_args_list)
    for expected in ("source", "findings", "report_chunk", "report"):
        assert any(kind == expected for kind, _ in events), (expected, [kind for kind, _ in events])
    events.clear()
    with (patch.object(GenericLLMProvider, "get_chat_response", model),
          patch.object(BrowserManager, "browse_urls", browse),
          patch("requests.post", return_value=response) as request):
        asyncio.run(worker.research({**job, "mode": "normal"}))
    assert any(kind == "report" for kind, _ in events)
    assert all(len(call.kwargs["json"]["query"]) <= 400 for call in request.call_args_list)
    assert all("handoff marker" not in call.kwargs["json"]["query"] for call in request.call_args_list)
    events.clear()
    with (patch.object(GenericLLMProvider, "get_chat_response", model),
          patch.object(BrowserManager, "browse_urls", side_effect=AssertionError("Synthesis browsed")),
          patch("requests.post", side_effect=AssertionError("Synthesis searched"))):
        asyncio.run(worker.research({**job, "mode": "synthesis"}))
    assert events == [("phase", {"phase": "reporting"}), ("report", {"markdown": "# Strategy\n\nUse the prior evidence."})]

    first = "First evidence https://example.org/one\n\n" + "a" * 32_000
    last = "Pending record https://example.org/two\n\n" + "b" * 24_000
    profile = {"name": "Profile", "kind": "document", "markdown": "Fixture profile."}
    reports = [{"name": "First", "markdown": first}, {"name": "Last", "markdown": last}, profile]
    batches = []

    async def synthesize(self, messages, stream, websocket=None, **kwargs):
        prompt = messages[-1]["content"]
        if "Extract evidence notes" in messages[0]["content"]:
            batch = worker.json.loads(prompt.split("\n\n", 1)[1])
            assert sum(len(item["markdown"]) for item in batch) <= 40_000
            batches.extend(batch)
            return batch[0]["markdown"].split("\n", 1)[0]
        assert "https://example.org/one" in prompt and "https://example.org/two" in prompt
        assert "Fixture profile." in prompt and "a" * 100 not in prompt
        return "# Combined strategy"

    events.clear()
    with (patch.object(GenericLLMProvider, "get_chat_response", synthesize),
          patch("requests.post", side_effect=AssertionError("Synthesis searched"))):
        asyncio.run(worker.research({**job, "mode": "synthesis", "reports": reports}))
    assert "".join(item["markdown"] for item in batches) == first + last
    assert events[-1] == ("report", {"markdown": "# Combined strategy"})


def check_utf8_worker():
    captured = []

    class Model(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            captured.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            response = json.dumps({"id": "fixture", "object": "chat.completion", "created": 0,
                                   "model": "fixture", "choices": [{"index": 0, "finish_reason": "stop",
                                   "message": {"role": "assistant", "content": "Şirket geçmişi korundu."}}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

    server = HTTPServer(("127.0.0.1", 0), Model)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        purpose = "İşlenmiş şirket geçmişi ve yeni fırsatlar."
        job = {"route": {"provider": "evren", "modelId": "fixture"}, "apiKey": "fixture",
               "baseUrl": f"http://127.0.0.1:{server.server_port}/v1", "reasoning": {},
               "language": "tr", "mode": "synthesis", "topic": "Şirket araştırması",
               "purpose": purpose, "sites": []}
        # Exercise binary UTF-8 input even with the legacy -I invocation on Windows.
        process = subprocess.run([sys.executable, "-I", "-u", str(ROOT / "sidecar/gpt_researcher_worker.py")],
                                 input=json.dumps(job, ensure_ascii=False).encode("utf-8"),
                                 capture_output=True, timeout=30)
        assert process.returncode == 0, process.stdout.decode("ascii", errors="replace")
        assert purpose in captured[0]["messages"][-1]["content"]
        assert json.loads(process.stdout.splitlines()[-1]) == {"kind": "report", "markdown": "Şirket geçmişi korundu."}
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    import os
    with open(os.devnull, "w", encoding="utf-8") as quiet, contextlib.redirect_stdout(quiet):
        check_quota()
        check_search_queries()
        check_hermes_search()
        asyncio.run(check_model_retry())
        check_pipeline()
        check_utf8_worker()
    print("GPT Researcher offline pipeline, Hermes primary and Tavily fallback passed.")
