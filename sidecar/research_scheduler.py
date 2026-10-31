"""Avalon-owned stdio adapter to Hermes' native cron API. No config/source edits."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys


def main(request):
    try:
        import hermes_cli.config
    except ImportError:
        sys.path.insert(0, str(Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))) / "hermes-agent"))
    from hermes_cli.config import load_env
    for key, value in load_env().items():
        os.environ.setdefault(key, value)
    from tools.cronjob_tools import cronjob
    from cron.jobs import get_job, get_ticker_heartbeat_age, ticker_heartbeat_writer_alive
    from hermes_time import get_timezone
    from datetime import datetime
    from zoneinfo import ZoneInfo
    action = request.get("action")
    age = get_ticker_heartbeat_age()
    alive = ticker_heartbeat_writer_alive()
    try:
        from hermes_cli.cron import _builtin_gateway_liveness
        gateway_alive = _builtin_gateway_liveness()
    except Exception:
        gateway_alive = None
    timezone = get_timezone()
    timezone_name = str(timezone) if timezone else "system"
    if timezone is None:
        # Hermes uses the OS clock when no zone is configured. Accept a system
        # clock equivalent to Istanbul without changing any Hermes setting.
        year = datetime.now().year
        dates = [datetime(y, month, 15, 12) for y in (year, year + 1) for month in (1, 4, 7, 10)]
        if all(value.astimezone().utcoffset() == value.replace(tzinfo=ZoneInfo("Europe/Istanbul")).utcoffset() for value in dates):
            timezone_name = "Europe/Istanbul"
    scheduler = {"available": bool(gateway_alive is True or (alive and age is not None and age < 180)), "heartbeatAge": age, "timezone": timezone_name}
    if action == "status":
        return {"success": True, **scheduler}
    if action not in {"create", "update", "list", "pause", "resume", "remove", "run"}:
        raise ValueError("Unsupported scheduler operation")
    if action in {"create", "update", "resume", "run"} and not scheduler["available"]:
        raise ValueError("Hermes zamanlayıcısı çalışmıyor. Zamanlama kaydedilmedi/başlatılmadı.")
    if action in {"create", "update"}:
        schedule = request["schedule"]
        if schedule["kind"] == "once":
            when = datetime.fromisoformat(schedule["date"] + "T" + schedule["time"]).replace(tzinfo=ZoneInfo("Europe/Istanbul"))
            if when.timestamp() <= __import__("time").time():
                raise ValueError("Çalışma zamanı gelecekte olmalı.")
            expression = when.isoformat()
        else:
            if scheduler["timezone"] != "Europe/Istanbul":
                raise ValueError("Hermes saat dilimi Europe/Istanbul olmalı. Genel ayar otomatik değiştirilmedi.")
            hour, minute = schedule["time"].split(":")
            expression = f"{int(minute)} {int(hour)} * * " + ("*" if schedule["kind"] == "daily" else str(schedule["day"]))
        script = Path(request["script"]).resolve()
        scripts_root = (Path(os.environ["HERMES_HOME"]) / "scripts").resolve()
        if not script.is_relative_to(scripts_root) or not script.name.startswith("avalon-") or not script.is_file():
            raise ValueError("Invalid Avalon scheduler launcher")
        result = json.loads(cronjob(action=action, job_id=request.get("jobId"), name=request["name"],
            schedule=expression, script=script.name, interpreter=sys.executable, no_agent=True, deliver="local"))
    else:
        result = json.loads(cronjob(action=action, job_id=request.get("jobId"), include_disabled=True))
    if action == "run":
        job = result.get("job") or {}
        if job.get("execution_error") or job.get("execution_skipped") or job.get("execution_success") is False:
            result = {**result, "success": False, "error": job.get("execution_error") or job.get("execution_skipped") or "Zamanlayıcı başlatıcısı başarısız oldu."}
    return {**result, "scheduler": scheduler}


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read())
        with contextlib.redirect_stdout(io.StringIO()):
            result = main(request)
    except Exception as exc:
        result = {"success": False, "error": str(exc)[:700]}
    print(json.dumps(result, ensure_ascii=True))
