"""Serve GPT Researcher searches through the selected Hermes web provider."""
import contextlib
import json
import os
from pathlib import Path
import sys

wire = sys.stdout


def send(value):
    print(json.dumps(value, ensure_ascii=True), file=wire, flush=True)


def main():
    home = Path(os.environ["HERMES_HOME"])
    sys.path.insert(0, str(home / "hermes-agent"))
    with contextlib.redirect_stdout(sys.stderr):
        from hermes_cli.config import load_env
        for key, value in load_env().items():
            os.environ.setdefault(key, value)
        from tools.web_tools import web_search_tool
    send({"ready": True})
    for line in sys.stdin.buffer:
        request = json.loads(line)
        query = request.get("query")
        limit = request.get("limit")
        if not isinstance(query, str) or not query.strip() or len(query) > 2000 or not isinstance(limit, int) or not 1 <= limit <= 20:
            send({"id": request.get("id"), "error": "Geçersiz Hermes arama isteği."})
            continue
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result = json.loads(web_search_tool(query, limit))
            if result.get("success") is not True:
                send({"id": request["id"], "error": str(result.get("error") or "Hermes arama sağlayıcısı yanıt veremedi.")[:600]})
                continue
            rows = result.get("data", {}).get("web")
            if not isinstance(rows, list):
                raise ValueError("Invalid search response")
            sources = []
            for row in rows:
                if not isinstance(row, dict) or not isinstance(row.get("url"), str):
                    continue
                sources.append({"href": row["url"], "title": str(row.get("title") or ""),
                                "body": str(row.get("description") or row.get("content") or "")})
            send({"id": request["id"], "results": sources[:limit]})
        except Exception:
            send({"id": request["id"], "error": "Hermes arama yanıtı alınamadı veya okunamadı."})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        send({"error": "Hermes arama bağlantısı başlatılamadı."})
        sys.exit(1)
