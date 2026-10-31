"""Pinned Windows launcher, local-only compatibility checks, and first-install configuration.

Only --prepare is called with an explicit home. The minted native launcher binds
its home and checks this file, the manifest and its receipt before loading it.
No verification action makes a model request or prints credentials.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import re
import runpy
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request


class CompatibilityError(RuntimeError):
    pass


def digest(path: Path, *, text=False) -> str:
    data = path.read_bytes()
    return hashlib.sha256(data.replace(b"\r\n", b"\n") if text else data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    os.replace(temp, path)


def beneath(path: Path, root: Path) -> Path:
    result = path.resolve()
    if not result.is_relative_to(root.resolve()):
        raise CompatibilityError("A runtime path escapes the dedicated home")
    return result


def manifest_for(home):
    return read_json(home / "avalon-compat/compat/hermes/compatibility.json")


def git_run(git, source, *args):
    proc = subprocess.run([str(git), "-C", str(source), "-c", "core.fsmonitor=false", *args],
                          stdin=subprocess.DEVNULL, capture_output=True, encoding="utf-8", errors="replace",
                          timeout=90, creationflags=subprocess.CREATE_NO_WINDOW)
    if proc.returncode:
        raise CompatibilityError("Git identity check failed (exit %s)" % proc.returncode)
    return proc.stdout.strip()


def verify_source(home, manifest, git):
    source = beneath(home / "hermes-agent", home)
    if git_run(git, source, "rev-parse", "HEAD") != manifest["baseCommit"]:
        raise CompatibilityError("Hermes HEAD changed; an Avalon compatibility release is required")
    for item in manifest["files"] + manifest["locks"]:
        path = beneath(source / item["path"], source)
        if not path.is_file() or digest(path, text=True) != item["sha256"]:
            raise CompatibilityError("Hermes file identity changed: " + item["path"])
    changed = set(git_run(git, source, "diff", "--name-only", "--no-ext-diff", "--no-renames", "HEAD", "--").splitlines())
    expected = {f["path"] for f in manifest["files"] if f["baseSha256"] is not None}
    if changed != expected:
        raise CompatibilityError("Unexpected tracked Hermes changes")
    untracked = set(git_run(git, source, "ls-files", "--others", "--exclude-standard").splitlines())
    expected_new = {f["path"] for f in manifest["files"] if f["baseSha256"] is None}
    if untracked != expected_new:
        raise CompatibilityError("Unexpected untracked Hermes files")
    if git_run(git, source, "diff", "--cached", "--name-only"):
        raise CompatibilityError("Hermes contains staged changes")
    return source


def activate(home, source):
    # Match the upstream installation-bound runtime bootstrap's environment,
    # but select dependencies without running its source-update repair path.
    os.environ["HERMES_HOME"] = str(home)
    os.environ["HERMES_RUNTIME_DIR"] = str(home / "tools")
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    for key in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "HERMES_INSTALL_ROOT", "__HERMES_ACTIVATED"):
        os.environ.pop(key, None)
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(source))
    from pm.environments import activate_dependencies, selected_venv
    selected = beneath(selected_venv(source), home / "installs")
    if not (selected / "pyvenv.cfg").is_file():
        raise CompatibilityError("The selected PM dependency environment is missing")
    activate_dependencies(source)
    return selected


def verify_imports(home, manifest, selected, *, deep=False):
    spec = importlib.util.find_spec("agent")
    if spec is None or spec.origin is None:
        raise CompatibilityError("The selected environment cannot resolve Hermes agent")
    runtime_root = Path(spec.origin).resolve().parent.parent
    beneath(runtime_root, home)
    checked = 0
    # PM also snapshots the source for editable installs. Both the actual import
    # root and that snapshot must contain the customized production files.
    workspace = beneath(selected.parent / "workspace", home)
    inventory = manifest["runtimeInventory"] if deep else [f for f in manifest["files"] if f["runtime"]]
    for checked_root in (workspace,):
        for item in inventory:
            # Inventory names are fixed by the authenticated package. Re-resolving
            # every ancestor per file is needlessly expensive on Windows.
            path = checked_root / item["path"]
            if not path.is_file() or digest(path, text=True) != item["sha256"]:
                raise CompatibilityError("The loaded Hermes workspace is incompatible: " + item["path"])
            checked += 1
    for item in manifest["files"]:
        if not item["runtime"]:
            continue
        name = item["path"][:-3].replace("/", ".")
        module = importlib.util.find_spec(name)
        if module is None or not module.origin or digest(Path(module.origin), text=True) != item["sha256"]:
            raise CompatibilityError("An import resolves to an unpatched module: " + name)
        beneath(Path(module.origin), home)
    # These tests exercise the actual imported helpers, not a source-string search.
    from types import SimpleNamespace
    from tui_gateway.iris_contract import validate_iris_contract, iris_contract_scope, iris_final_response_policy
    from tui_gateway.iris_reply_repair import decode_reply, plain_reply, repair_kwargs
    c1 = {"version": 1, "instructions": "Speak only the prepared reply."}
    c2 = {**c1, "version": 2, "final_reply_repair": "plain_text_once"}
    for c in (c1, c2):
        if validate_iris_contract(c, "voice-live")["version"] != c["version"]:
            raise CompatibilityError("Conversation contract version check failed")
    agent = SimpleNamespace(valid_tool_names={"web_search", "web_extract", "clarify"}, ephemeral_system_prompt="prior")
    try:
        with iris_contract_scope(agent, c1):
            if c1["instructions"] not in agent.ephemeral_system_prompt:
                raise CompatibilityError("Contract scope was not applied")
            raise LookupError("scope-test")
    except LookupError:
        pass
    if agent.ephemeral_system_prompt != "prior":
        raise CompatibilityError("Contract scope was not restored")
    agent.valid_tool_names.add("terminal")
    try:
        with iris_contract_scope(agent, c1):
            pass
    except ValueError:
        pass
    else:
        raise CompatibilityError("Conversation tool restriction is absent")
    if iris_final_response_policy(c1) is not None or iris_final_response_policy(c2) is None:
        raise CompatibilityError("Final response policy scope is invalid")
    if decode_reply('{"reply":"Ready.","proposal":null}')["reply"] != "Ready." or not plain_reply("Ready.") or plain_reply('{"broken":'):
        raise CompatibilityError("Reply decoding check failed")
    request = {"model": "qwen3.8-flash-next", "messages": [{"role": "system", "content": "Existing instructions."}, {"role": "user", "content": "Local compatibility check."}], "tools": [{}], "max_tokens": 512, "extra_body": {"thinking": False}}
    repaired = repair_kwargs(request, "Ready.")
    if "tools" in repaired or "tools" not in request or repaired["max_tokens"] != 512:
        raise CompatibilityError("Bounded reply request check failed")
    return {"ok": True, "contractVersions": [1, 2], "runtimePythonFilesChecked": checked,
            "loadedSource": str(runtime_root), "selectedEnvironment": str(selected), "providerRequests": 0}


def parse_env(path):
    result = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if line.strip().startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) > 1 and value[0] in "\"'" and value[-1] == value[0]:
                value = value[1:-1]
            result[key.strip()] = value
    return result


def update_env(path, updates, backup_root):
    old = path.read_text(encoding="utf-8-sig") if path.is_file() else ""
    output = []; written = set()
    for line in old.splitlines():
        key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
        if key in updates:
            if key not in written:
                output.append(key + "=" + updates[key]); written.add(key)
        else:
            output.append(line)
    output.extend(key + "=" + value for key, value in updates.items() if key not in written)
    text = "\n".join(output) + "\n"
    if text != old:
        if old:
            backup_root.mkdir(parents=True, exist_ok=True)
            backup = backup_root / ("environment-" + time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3) + ".env")
            backup.write_text(old, encoding="utf-8")
        temp = path.with_name(path.name + ".avalon-tmp")
        temp.write_text(text, encoding="utf-8"); os.replace(temp, path)


def load_yaml_config(path):
    import hermes_yaml as yaml
    from ruamel.yaml.error import YAMLError
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8-sig")) if path.is_file() else {}
    except YAMLError:
        raise CompatibilityError("Invalid YAML in the dedicated Hermes config; inspect that local file") from None
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise CompatibilityError("Hermes config.yaml must contain a mapping")
    return value


def configure_home(home):
    import hermes_yaml as yaml
    config_path = home / "config.yaml"
    current = load_yaml_config(config_path)
    for name in ("updates", "providers", "terminal"):
        if name in current and not isinstance(current[name], dict):
            raise CompatibilityError("Hermes config section must be a mapping: " + name)
    current.setdefault("updates", {}).update(check=False, auto_switch_parked_branch=False, pre_update_backup="quick")
    current.setdefault("model", {"default": "qwen3.8-flash-next", "provider": "iris-evren", "base_url": "https://evren-llmapi.ssyz.org.tr/v1"})
    current.setdefault("providers", {}).setdefault("iris-evren", {"name": "Avalon Evren", "api": "https://evren-llmapi.ssyz.org.tr/v1", "key_env": "IRIS_EVREN_API_KEY", "api_mode": "chat_completions"})
    current.setdefault("terminal", {}).setdefault("backend", "local")
    text = yaml.safe_dump(current, sort_keys=False, allow_unicode=True)
    if not config_path.is_file() or config_path.read_text(encoding="utf-8-sig") != text:
        if config_path.is_file():
            backup = home / "backups" / ("config-" + time.strftime("%Y%m%d-%H%M%S") + ".yaml")
            backup.parent.mkdir(parents=True, exist_ok=True); backup.write_bytes(config_path.read_bytes())
        config_path.write_text(text, encoding="utf-8")
    env_path = home / ".env"
    env = parse_env(env_path)
    token = env.get("API_SERVER_KEY") or secrets.token_hex(32)
    if len(token) < 32:
        raise CompatibilityError("The existing local API secret is too short; configure a strong secret before proceeding")
    port = env.get("API_SERVER_PORT")
    if port:
        try:
            valid_port = 1 <= int(port) <= 65535
        except ValueError:
            valid_port = False
        if not valid_port:
            raise CompatibilityError("The existing local API port is invalid")
    if not port:
        with socket.socket() as listener:
            try:
                listener.bind(("127.0.0.1", 8642))
            except OSError:
                listener.bind(("127.0.0.1", 0))
            port = str(listener.getsockname()[1])
    update_env(env_path, {"API_SERVER_ENABLED": "true", "API_SERVER_HOST": "127.0.0.1",
                         "API_SERVER_PORT": port, "API_SERVER_KEY": token}, home / "backups")
    # Hermes supports externally stewarded source distributions. This prevents
    # its pre-import source updater/completion path from taking ownership.
    write_json(home / "hermes-agent/install-stamp.json", {"schemaVersion": 1,
               "distribution": "avalon", "updateMechanism": "external",
               "compatibilityRelease": manifest_for(home)["release"]})


def verify_update_policy(home):
    config = load_yaml_config(home / "config.yaml")
    updates = config.get("updates", {})
    if updates.get("check") is not False or updates.get("auto_switch_parked_branch") is not False:
        raise CompatibilityError("The dedicated runtime's passive update policy was changed")


def mint_launcher(home, receipt):
    from hermes_cli._launchers import _store_script_maker
    python = Path(receipt["python"])
    maker_type = _store_script_maker(python)
    if maker_type is None:
        raise CompatibilityError("The pinned Python lacks its native Windows launcher generator")
    paths = [home / "avalon-compat/scripts/hermes-runtime.py", home / "avalon-compat/compat/hermes/compatibility.json"]
    checks = [(str(p.relative_to(home)), digest(p)) for p in paths]
    checks.append(("avalon-runtime.json", digest(home / "avalon-runtime.pending.json")))
    script = "import os,sys,hashlib,runpy\nfrom pathlib import Path\n"
    script += "h=Path(sys.argv[0]).resolve().parent.parent\n"
    script += "checks=" + repr(checks) + "\n"
    script += "for n,v in checks:\n p=h/n\n if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=v:\n  sys.stderr.write('[Avalon] Compatibility guard/receipt changed; launch refused.\\n');sys.exit(72)\n"
    script += "os.environ['HERMES_HOME']=str(h)\n"
    script += "runpy.run_path(str(h/'avalon-compat/scripts/hermes-runtime.py'),run_name='__main__')\n"

    class GuardMaker(maker_type):
        def _get_script_text(self, entry):
            return script

    directory = home / "avalon-bin"; directory.mkdir(exist_ok=True)
    maker = GuardMaker(None, str(directory), add_launchers=True)
    maker.executable = str(python); maker.variants = {""}; maker.clobber = True
    for name in ("avalon-hermes", "hermes"):
        maker.make(name + " = hermes_cli.main:main", {"interpreter_args": ["-I", "-B", "-X", "utf8"]})
    if not (directory / "avalon-hermes.exe").is_file():
        raise CompatibilityError("Native launcher generation failed")


def prepare(home, git):
    manifest = manifest_for(home)
    source = verify_source(home, manifest, git)
    selected = activate(home, source)
    result = verify_imports(home, manifest, selected, deep=True)
    configure_home(home)
    receipt = {"schemaVersion": 1, "release": manifest["release"], "home": str(home),
               "python": str(Path(sys.executable).resolve()), "pythonSha256": digest(Path(sys.executable)),
               "git": str(Path(git).resolve()), "baseCommit": manifest["baseCommit"],
               "powerShellModulePath": os.environ.get("PSModulePath", ""),
               "installStampSha256": digest(home / "hermes-agent/install-stamp.json")}
    write_json(home / "avalon-runtime.pending.json", receipt)
    mint_launcher(home, receipt)
    os.replace(home / "avalon-runtime.pending.json", home / "avalon-runtime.json")
    write_json(home / "avalon-last-verification.json", result)
    print(json.dumps({"ok": True, "prepared": True, "release": manifest["release"], "runtimePythonFilesChecked": result["runtimePythonFilesChecked"]}))


def configure_app(home, app_root):
    package = read_json(app_root / "package.json")
    if package.get("productName") != "Avalon" or not (app_root / "electron/main.mjs").is_file():
        raise CompatibilityError("The application path is not an Avalon source checkout")
    env = parse_env(home / ".env")
    port = int(env.get("API_SERVER_PORT", "8642"))
    token = env.get("API_SERVER_KEY", "")
    if not token or not 1 <= port <= 65535 or env.get("API_SERVER_HOST") != "127.0.0.1":
        raise CompatibilityError("The local API configuration is invalid")
    update_env(app_root / ".env", {"HERMES_HOME": str(home), "HERMES_BIN": str(home / "avalon-bin/avalon-hermes.exe"),
               "HERMES_API_URL": "http://127.0.0.1:" + str(port), "API_SERVER_KEY": token,
               "IRIS_HERMES_SOURCE": str(home / "hermes-agent"), "IRIS_BRAIN_RELAY": "true",
               "IRIS_HERMES_TRANSPORT": "interactive"}, home / "backups")
    print(json.dumps({"ok": True, "applicationEnvironmentConfigured": True, "providerKeysChanged": False}))


def stop_own_process(proc):
    if proc.poll() is None:
        subprocess.run([str(Path(os.environ["WINDIR"]) / "System32/taskkill.exe"), "/PID", str(proc.pid), "/T", "/F"],
                       capture_output=True, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
    proc.wait(timeout=20)


def gateway_probe(home):
    from websockets.sync.client import connect
    token = secrets.token_urlsafe(32)
    env = {**os.environ, "HERMES_DASHBOARD_SESSION_TOKEN": token, "HERMES_DESKTOP": "1"}
    proc = subprocess.Popen([str(home / "avalon-bin/avalon-hermes.exe"), "serve", "--host", "127.0.0.1", "--port", "0"],
                            env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW)
    lines = queue.Queue()
    tail = []
    def collect():
        for line in proc.stdout:
            lines.put(line)
        lines.put(None)
    thread = threading.Thread(target=collect, daemon=True); thread.start()
    deadline = time.monotonic() + 100
    try:
        port = None
        while time.monotonic() < deadline:
            try:
                line = lines.get(timeout=max(.01, deadline - time.monotonic()))
            except queue.Empty:
                break
            if line is None:
                detail = "".join(tail[-15:]).replace(token, "[redacted]")
                raise CompatibilityError("The gateway exited before its ready signal:\n" + detail)
            tail.append(line)
            match = re.search(r"HERMES_(?:BACKEND|DASHBOARD)_READY port=(\d+)", line)
            if match:
                port = int(match[1]); break
        if port is None:
            raise CompatibilityError("The gateway did not become ready within 100 seconds")
        with connect("ws://127.0.0.1:%s/api/ws?token=%s" % (port, token), open_timeout=15, close_timeout=5) as ws:
            ready = None
            for _ in range(30):
                frame = json.loads(ws.recv(timeout=15))
                if frame.get("params", {}).get("type") == "gateway.ready":
                    ready = frame["params"]["payload"]; break
            if ready is None or not {1, 2}.issubset(ready.get("iris_contract_versions", [])):
                raise CompatibilityError("The running gateway does not advertise conversation contracts 1 and 2")
        print(json.dumps({"ok": True, "authenticatedGatewayProbe": True, "contractVersions": ready["iris_contract_versions"], "providerRequests": 0}))
    finally:
        stop_own_process(proc)
        if proc.stdout:
            proc.stdout.close()


def api_probe(home):
    env = parse_env(home / ".env")
    port = int(env["API_SERVER_PORT"])
    key = env["API_SERVER_KEY"]
    if env.get("API_SERVER_HOST") != "127.0.0.1" or not 1 <= port <= 65535:
        raise CompatibilityError("The local API must use a valid loopback address and port")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def healthy():
        request = urllib.request.Request("http://127.0.0.1:%s/health/detailed" % port, headers={"Authorization": "Bearer " + key})
        try:
            with opener.open(request, timeout=2) as response:
                return response.status == 200 and isinstance(json.load(response), dict)
        except (OSError, ValueError, urllib.error.HTTPError):
            return False
    if healthy():
        print(json.dumps({"ok": True, "authenticatedLocalApiProbe": True, "reusedExistingGateway": True, "providerRequests": 0}))
        return
    proc = subprocess.Popen([str(home / "avalon-bin/avalon-hermes.exe"), "gateway", "run"], env=os.environ.copy(),
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW)
    tail = []
    def collect():
        for line in proc.stdout:
            tail.append(line)
            if len(tail) > 40:
                del tail[0]
    threading.Thread(target=collect, daemon=True).start()
    try:
        deadline = time.monotonic() + 75
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                detail = "".join(tail[-15:]).replace(key, "[redacted]")
                raise CompatibilityError("The local API gateway exited before readiness:\n" + detail)
            if healthy():
                print(json.dumps({"ok": True, "authenticatedLocalApiProbe": True, "reusedExistingGateway": False, "providerRequests": 0}))
                return
            time.sleep(.2)
        raise CompatibilityError("The authenticated local API did not become ready within 75 seconds")
    finally:
        stop_own_process(proc)
        if proc.stdout:
            proc.stdout.close()


def main():
    args = sys.argv[1:]
    if args[:1] == ["--prepare"]:
        if len(args) != 4 or args[2] != "--git":
            raise CompatibilityError("Invalid runtime preparation arguments")
        return prepare(Path(args[1]).resolve(), Path(args[3]).resolve())
    home = Path(os.environ["HERMES_HOME"]).resolve()
    receipt = read_json(home / "avalon-runtime.json")
    os.environ["PSModulePath"] = receipt["powerShellModulePath"]
    if Path(receipt["home"]).resolve() != home or Path(receipt["python"]).resolve() != Path(sys.executable).resolve():
        raise CompatibilityError("This launcher was moved or uses a different interpreter; rerun setup in a new dedicated location")
    if digest(Path(sys.executable)) != receipt["pythonSha256"]:
        raise CompatibilityError("The pinned Python executable changed")
    manifest = manifest_for(home)
    if digest(home / "hermes-agent/install-stamp.json") != receipt["installStampSha256"]:
        raise CompatibilityError("The external update-steward stamp changed")
    source = verify_source(home, manifest, receipt["git"])
    selected = activate(home, source)
    result = verify_imports(home, manifest, selected, deep=(args == ["--avalon-verify"]))
    verify_update_policy(home)
    if args == ["--avalon-verify"]:
        print(json.dumps({**result, "release": manifest["release"]})); return
    if args == ["--avalon-gateway-probe"]:
        return gateway_probe(home)
    if args == ["--avalon-api-probe"]:
        return api_probe(home)
    if len(args) == 2 and args[0] == "--avalon-configure-app":
        return configure_app(home, Path(args[1]).resolve())
    from hermes_cli._parser import command_argv
    command = command_argv(args)
    if command[:1] == ["update"] or command[:1] == ["--run-module"] or (command[:1] == ["pm"] and command[1:2] not in (["doctor"], ["status"], ["env"])):
        raise CompatibilityError("Independent source/dependency updates are disabled for this Avalon runtime")
    if any(value.startswith("--avalon-") for value in args):
        raise CompatibilityError("Unknown Avalon launcher operation")
    sys.argv = [str(home / "avalon-bin/avalon-hermes.exe"), *args]
    import hermes_bootstrap  # the external steward skips independent source completion
    os.environ["PATH"] = str(home / "avalon-bin") + os.pathsep + os.environ.get("PATH", "")
    os.environ["HERMES_BIN"] = str(home / "avalon-bin/avalon-hermes.exe")
    runpy.run_module("hermes_cli.main", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    try:
        main()
    except (CompatibilityError, OSError, ValueError, KeyError, ImportError, subprocess.SubprocessError) as exc:
        # No credential values or provider request payloads are part of these errors.
        print("[Avalon] " + str(exc), file=sys.stderr)
        raise SystemExit(72) from None
