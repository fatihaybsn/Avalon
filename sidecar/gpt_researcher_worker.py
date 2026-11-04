"""Run one isolated GPT Researcher job. JSON events are sent over stdout."""
import asyncio
import contextlib
import json
import os
import sys
import threading
import time

wire = sys.stdout
wire_lock = threading.Lock()


def emit(kind, **data):
    with wire_lock:
        print(json.dumps({"kind": kind, **data}, ensure_ascii=True), file=wire, flush=True)


def configure_search(key):
    import requests
    from ddgs import DDGS
    from gpt_researcher.retrievers.tavily.tavily_search import TavilySearch

    gate = threading.Lock()
    fallback = not key
    counts = {"tavily": 0, "duckduckgo": 0}
    emit("search", provider="duckduckgo" if fallback else "tavily",
         reason="missing_key" if fallback else "", counts=counts)

    def search(self, max_results=10):
        nonlocal fallback
        with gate:
            if not fallback:
                data = {"query": self.query, "search_depth": "advanced",
                        "max_results": min(20, max_results), "topic": self.topic,
                        "include_domains": self.query_domains or []}
                for attempt in range(2):
                    counts["tavily"] += 1
                    emit("search", provider="tavily", counts=counts)
                    try:
                        response = requests.post("https://api.tavily.com/search", json=data,
                                                 headers={"Authorization": f"Bearer {key}"}, timeout=25)
                    except requests.RequestException:
                        if attempt == 0:
                            time.sleep(2)
                            continue
                        emit("warning", message="Tavily bağlantısı zaman aşımına uğradı veya kurulamadı.")
                        return []
                    if response.status_code in (432, 433):
                        fallback = True
                        emit("search", provider="duckduckgo", reason="quota", counts=counts)
                        break
                    if attempt == 0 and (response.status_code == 429 or response.status_code >= 500):
                        delay = response.headers.get("Retry-After", "")
                        time.sleep(min(10, max(1, int(delay))) if delay.isdigit() else 2)
                        continue
                    if not response.ok:
                        emit("warning", message=f"Tavily HTTP {response.status_code} döndürdü.")
                        return []
                    return [{"href": row["url"], "body": row.get("content", "")}
                            for row in response.json().get("results", []) if row.get("url")]
            counts["duckduckgo"] += 1
            emit("search", provider="duckduckgo", counts=counts)

        try:
            rows = DDGS(timeout=15).text(self.query, region="tr-tr", max_results=max_results, backend="duckduckgo")
            return [{"href": row["href"], "body": row.get("body", "")} for row in rows if row.get("href")]
        except Exception:
            emit("warning", message="DuckDuckGo bu sorgu için sonuç döndüremedi.")
            return []

    TavilySearch.search = search


async def research(job):
    if job.get("parentPid"):
        import psutil
        parent = psutil.Process(job["parentPid"])

        def monitor_parent():
            while parent.is_running():
                time.sleep(1)
            os._exit(1)

        threading.Thread(target=monitor_parent, daemon=True).start()
    route = job["route"]
    os.environ.update({
        "OPENAI_BASE_URL": job["baseUrl"], "OPENAI_API_KEY": job["apiKey"],
        "FAST_LLM": f"openai:{route['modelId']}", "SMART_LLM": f"openai:{route['modelId']}",
        "STRATEGIC_LLM": f"openai:{route['modelId']}", "RETRIEVER": "tavily",
        "CONTEXT_FILTER": "keyword", "LANGUAGE": "turkish" if job["language"] == "tr" else "english",
        "DEEP_RESEARCH_BREADTH": str(job.get("breadth", 3)),
        "DEEP_RESEARCH_DEPTH": str(job.get("depth", 2)), "DEEP_RESEARCH_CONCURRENCY": "3",
        "CURATE_SOURCES": "false", "LANGCHAIN_TRACING_V2": "false", "LANGSMITH_TRACING": "false",
    })
    from gpt_researcher import GPTResearcher
    from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
    from gpt_researcher.skills.deep_research import DeepResearchSkill
    configure_search(job.get("tavilyKey", ""))

    original_provider = GenericLLMProvider.from_provider

    def model_provider(cls, provider, **kwargs):
        selected = {**job["reasoning"], **(kwargs.get("extra_body") or {})}
        if kwargs.get("reasoning_effort") is not None:
            selected.pop("reasoning_effort", None)
        kwargs.update(model=route["modelId"], timeout=60, max_retries=0, extra_body=selected)
        if route["provider"] == "opencode":
            kwargs["default_headers"] = {**(kwargs.get("default_headers") or {}),
                                         "x-opencode-session": job["runId"]}
        return original_provider("openai", **kwargs)

    GenericLLMProvider.from_provider = classmethod(model_provider)
    get_response = GenericLLMProvider.get_chat_response
    writing = False

    class ReportEvents:
        def __init__(self):
            self.first = True

        async def send_json(self, event):
            if event.get("type") == "report" and isinstance(event.get("output"), str):
                emit("report_chunk", markdown=event["output"], replace=self.first)
                self.first = False

    async def model_response(self, messages, stream, websocket=None, **kwargs):
        try:
            if writing and stream:
                websocket = ReportEvents()
            return await get_response(self, messages, stream, websocket, **kwargs)
        except Exception as exc:
            status = getattr(exc, "status_code", None)
            reason = f"HTTP {status}" if isinstance(status, int) else type(exc).__name__
            emit("warning", message=f"Model sağlayıcısı çağrısı başarısız: {reason}.")
            raise

    GenericLLMProvider.get_chat_response = model_response

    def archive(sources):
        for source in sources or []:
            if isinstance(source, dict):
                emit("source", source=source)

    add_sources = GPTResearcher.add_research_sources

    def add_and_save(self, sources):
        add_sources(self, sources)
        archive(sources)

    GPTResearcher.add_research_sources = add_and_save
    process_results = DeepResearchSkill.process_research_results

    async def process_and_save(self, query, context, *args, **kwargs):
        result = await process_results(self, query, context, *args, **kwargs)
        citations = result.get("citations", {})
        emit("findings", findings=[{"text": text, "url": citations.get(text, "")}
                                    for text in result.get("learnings", [])])
        return result

    DeepResearchSkill.process_research_results = process_and_save

    purpose = job["purpose"]
    query = f"{job['topic']}\n\n{purpose}"
    if job["sites"]:
        query += "\n\nPreferred sources: " + ", ".join(job["sites"])
    engine = GPTResearcher(query=query, report_type="deep" if job["mode"] == "deep" else "research_report",
                           verbose=False)
    emit("phase", phase="collecting")

    def progress(value):
        emit("progress", completed=value.completed_queries, total=value.total_queries)

    await engine.conduct_research(on_progress=progress)
    archive(engine.get_research_sources())
    if not engine.get_research_context():
        raise RuntimeError("Empty research context")
    emit("phase", phase="reporting")
    writing = True
    report = await engine.write_report()
    if not isinstance(report, str) or not report.strip():
        raise RuntimeError("Empty report")
    emit("report", markdown=report)


if __name__ == "__main__":
    try:
        with open(os.devnull, "w", encoding="utf-8") as quiet:
            with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                if sys.argv[1:] == ["--check"]:
                    from gpt_researcher import GPTResearcher
                    from ddgs import DDGS
                    emit("ready")
                else:
                    asyncio.run(research(json.load(sys.stdin)))
    except Exception as exc:
        status = getattr(exc, "status_code", None)
        emit("error", message=f"GPT Researcher: {type(exc).__name__}" + (f" (HTTP {status})" if status else ""))
        sys.exit(1)
