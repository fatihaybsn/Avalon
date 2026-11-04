"""Exercise the pinned GPT Researcher pipeline without making network requests."""
import asyncio
import contextlib
import importlib.util
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
        assert "5 dakika" in str(error)
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
           "breadth": 3, "depth": 1, "topic": "Jetson products", "purpose": "Short report", "sites": [],
           "reports": [{"name": "Prior research", "markdown": "handoff marker from the earlier report"}]}
    response = SimpleNamespace(status_code=200, ok=True, json=lambda: {
        "results": [{"url": SOURCE, "content": "The product uses Jetson."}]
    })
    with (patch.object(GenericLLMProvider, "get_chat_response", model),
          patch.object(BrowserManager, "browse_urls", browse),
          patch("requests.post", return_value=response)):
        asyncio.run(worker.research(job))
    for expected in ("source", "findings", "report_chunk", "report"):
        assert any(kind == expected for kind, _ in events), (expected, [kind for kind, _ in events])
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


if __name__ == "__main__":
    import os
    with open(os.devnull, "w", encoding="utf-8") as quiet, contextlib.redirect_stdout(quiet):
        check_quota()
        asyncio.run(check_model_retry())
        check_pipeline()
    print("GPT Researcher offline pipeline and Tavily quota fallback passed.")
