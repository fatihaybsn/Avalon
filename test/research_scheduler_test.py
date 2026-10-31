"""Offline adapter contract tests. Hermes modules are entirely fake."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("avalon_scheduler", ROOT / "sidecar/research_scheduler.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.old_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = str(self.home)
        self.calls = []
        self.zone = "Europe/Istanbul"
        self.live = True
        self.run_result = None
        self.modules = {}
        def module(name, **values):
            self.modules[name] = sys.modules.get(name)
            value = types.ModuleType(name)
            for key, item in values.items():
                setattr(value, key, item)
            sys.modules[name] = value
            return value
        hc = module("hermes_cli")
        hc.config = module("hermes_cli.config", load_env=lambda: {})
        hc.cron = module("hermes_cli.cron", _builtin_gateway_liveness=lambda: self.live)
        module("tools")
        module("tools.cronjob_tools", cronjob=lambda **kwargs: self.call(kwargs))
        module("cron")
        module("cron.jobs", get_job=lambda _: {}, get_ticker_heartbeat_age=lambda: 1 if self.live else 1000,
               ticker_heartbeat_writer_alive=lambda: self.live)
        module("hermes_time", get_timezone=lambda: ZoneInfo(self.zone))
        scripts = self.home / "scripts"
        scripts.mkdir()
        self.script = scripts / "avalon-schedule_abcdef.py"
        self.script.write_text("# test\n")

    def call(self, request):
        self.calls.append(request)
        if self.run_result is not None:
            return json.dumps(self.run_result)
        return json.dumps({"success": True, "job": {"job_id": "native-test", "enabled": True}})

    def tearDown(self):
        for name, value in self.modules.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value
        if self.old_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self.old_home
        self.temp.cleanup()

    def request(self, kind="daily"):
        return {"action": "create", "name": "Avalon test", "script": str(self.script), "schedule": {"kind": kind, "time": "09:15", "day": 6, "date": "2035-01-01"}}

    def test_cron_uses_native_api_relative_script_and_correct_day(self):
        self.assertTrue(adapter.main(self.request("weekly"))["success"])
        self.assertEqual(self.calls[0]["script"], self.script.name)
        self.assertEqual(self.calls[0]["schedule"], "15 9 * * 6")
        self.assertTrue(self.calls[0]["no_agent"])
        self.assertEqual(self.calls[0]["deliver"], "local")

    def test_unavailable_scheduler_never_claims_job_was_created(self):
        self.live = False
        with self.assertRaisesRegex(ValueError, "çalışmıyor"):
            adapter.main(self.request())
        self.assertFalse(self.calls)

    def test_timezone_mismatch_does_not_edit_global_settings(self):
        self.zone = "America/New_York"
        with self.assertRaisesRegex(ValueError, "saat dilimi"):
            adapter.main(self.request())
        self.assertFalse(self.calls)

    def test_one_shot_has_explicit_istanbul_offset(self):
        adapter.main(self.request("once"))
        self.assertEqual(self.calls[0]["schedule"], "2035-01-01T09:15:00+03:00")

    def test_script_cannot_escape_managed_directory(self):
        request = self.request()
        request["script"] = str(self.home / "outside.py")
        with self.assertRaisesRegex(ValueError, "launcher"):
            adapter.main(request)
        self.assertFalse(self.calls)

    def test_failed_native_dispatch_is_not_reported_as_success(self):
        self.run_result = {"success": True, "job": {"executed": True, "execution_success": False, "execution_error": "Launcher failed"}}
        result = adapter.main({"action": "run", "jobId": "fake-native"})
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "Launcher failed")


if __name__ == "__main__":
    unittest.main()
