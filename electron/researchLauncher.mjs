import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWrite } from "./researchFiles.mjs";
import { acquireResearchLock } from "./researchLock.mjs";

const hash = (text) => crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
// Filled with the exact, previously shipped OS-supervisor template. Unknown
// edits are never silently overwritten, even if they retain the managed header.
const LEGACY_HASH = "deaf8abe28078991a21ff0d429407e75d08f5dde83b3d9892e3e00173e8d38eb";

export function launcherSource(config) {
  return `# Managed by Avalon; Hermes source and config are not modified.
# Avalon launcher protocol: 2
import json, os, subprocess, sys, time
from pathlib import Path
# One atomic script replacement commits both code and immutable configuration.
c = json.loads(${JSON.stringify(JSON.stringify(config))})
s = json.loads(Path(c['stateFile']).read_text(encoding='utf-8'))
flags = (subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == 'nt' else 0
env = dict(os.environ)
env.update(c.get('env', {}))
if len(sys.argv) > 1 and sys.argv[1] == '--avalon-worker':
    error_file = Path(c['stateFile']).with_name('dispatch-error.json')
    try:
        # An older runner cannot safely consume this lock protocol. Fail before
        # dispatch, never fall back to an unprotected worker.
        probe = subprocess.run([c['executable'], c['runner'], '--lock-protocol'], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if probe.returncode or probe.stdout.strip() != '2':
            raise RuntimeError('Avalon runner lock protocol mismatch')
        with open(c['logFile'], 'ab') as log:
            # The runner acquires the common OS lease exactly once, including
            # manual/headless calls. This cron supervisor never reacquires it.
            result = subprocess.run([c['executable'], c['runner'], '--schedule', c['stateFile'], '--occurrence', sys.argv[2]], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode:
            raise RuntimeError('Avalon worker failed')
        if error_file.exists(): error_file.unlink()
    except Exception as exc:
        error_file.write_text(json.dumps({'at':int(time.time()*1000),'error':str(exc)[:300]}), encoding='utf-8')
        sys.exit(1)
    sys.exit(0)
from cron.jobs import get_job
j = get_job(s['nativeId']) or {}
claim = j.get('fire_claim') or {}
occurrence = claim.get('by') or claim.get('at') or j.get('next_run_at')
if not occurrence:
    raise RuntimeError('Scheduled occurrence identity unavailable')
with open(c['logFile'], 'ab') as log:
    subprocess.Popen([sys.executable, __file__, '--avalon-worker', str(occurrence)], env=dict(os.environ), stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags, start_new_session=os.name != 'nt', close_fds=True)
print(json.dumps({'queued': True, 'scheduleId': s['id']}))
`;
}

export async function installResearchLauncher({ home, repoRoot, id, stateFile, launch, candidates }) {
  if (!/^schedule_[a-zA-Z0-9-]+$/.test(id)) throw new Error("Geçersiz başlatıcı kimliği.");
  const dir = path.join(home, "scripts");
  const script = path.join(dir, `avalon-${id}.py`), configFile = script.replace(/\.py$/, ".json");
  const config = { stateFile, ...launch, lockProtocol: 2 };
  const source = launcherSource(config);
  if (fs.existsSync(script) && fs.readFileSync(script, "utf8") === source) return script;
  const lease = await acquireResearchLock(launch.lockFile || path.join(path.dirname(stateFile), "supervisor.lock"), { repoRoot, candidates });
  if (lease.skipped) throw Object.assign(new Error("Etkin görev bitmeden başlatıcı güncellenemez; geçiş ertelendi."), { code: "LAUNCHER_BUSY" });
  try {
    const previous = fs.existsSync(script) ? fs.readFileSync(script, "utf8") : null;
    const previousConfig = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : null;
    let saved;
    if (previous && hash(previous) !== LEGACY_HASH) {
      // v2 is accepted only if it equals the template for its own saved config.
      try {
        const embedded = previous.split("\n").find((line) => line.startsWith("c = json.loads("));
        saved = JSON.parse(JSON.parse(embedded.slice("c = json.loads(".length, -1)));
      } catch { /* rejected below */ }
      if (!saved || previous !== launcherSource(saved)) throw new Error("Başlatıcı Avalon'un bilinen sürümüyle eşleşmiyor; dosya korunuyor.");
    }
    if (previous && !saved) {
      try { saved = JSON.parse(previousConfig); } catch { throw new Error("Eski başlatıcı yapılandırması okunamadı; dosyalar korunuyor."); }
    }
    if (saved && path.resolve(saved.stateFile || "") !== path.resolve(stateFile)) throw new Error("Başlatıcı başka bir görev tanımına ait; dosyalar korunuyor.");
    let backup;
    if (previous) {
      backup = path.join(dir, "avalon-backups", id, `${Date.now()}-${crypto.randomUUID()}`);
      fs.mkdirSync(backup, { recursive: true });
      fs.writeFileSync(path.join(backup, "launcher.py"), previous, { mode: 0o600 });
      if (previousConfig !== null) fs.writeFileSync(path.join(backup, "launcher.json"), previousConfig, { mode: 0o600 });
      fs.copyFileSync(stateFile, path.join(backup, "state.json"));
      const jobs = path.join(home, "cron", "jobs.json");
      if (fs.existsSync(jobs)) fs.copyFileSync(jobs, path.join(backup, "native-jobs.json"));
      atomicWrite(path.join(backup, "restore.json"), JSON.stringify({ script, configFile, stateFile, protocol: 2 }));
    }
    try {
      // The companion JSON is retained for inspection/rollback. Runtime v2
      // reads the config embedded in the atomically committed Python script.
      lease.signal.throwIfAborted();
      atomicWrite(configFile, JSON.stringify(config, null, 2) + "\n");
      atomicWrite(script, source);
    } catch (error) {
      if (previousConfig !== null) atomicWrite(configFile, previousConfig);
      else fs.rmSync(configFile, { force: true });
      if (previous !== null && fs.readFileSync(script, "utf8") !== previous) atomicWrite(script, previous);
      throw error;
    }
    return script;
  } finally { await lease.release(); }
}
