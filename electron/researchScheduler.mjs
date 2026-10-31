import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { writeJson } from "./researchStore.mjs";
import { nativeResourcePath } from "./resourcePaths.mjs";

export class ResearchScheduler {
  constructor({ bridge, repoRoot, home, env = process.env }) { Object.assign(this, { bridge, repoRoot, home, env }); }
  async call(request) {
    let lastError = "Hermes Python ortamı bulunamadı.";
    for (const python of this.bridge.candidates()) {
      const result = await new Promise((resolve) => {
        const child = spawn(python, ["-B", nativeResourcePath(this.repoRoot, "sidecar/research_scheduler.py")], {
          env: { ...this.env, HERMES_HOME: this.home(), PYTHONIOENCODING: "utf-8" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "", settled = false;
        const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
        const timer = setTimeout(() => { child.kill(); finish({ success: false, error: "Zamanlayıcı bağlantısı zaman aşımına uğradı." }); }, 30000);
        child.stdout.on("data", (part) => { output = `${output}${part}`.slice(-2_000_000); });
        child.stderr.on("data", () => {});
        child.on("error", () => finish(null));
        child.on("close", () => { try { finish(JSON.parse(output.trim().split(/\r?\n/).at(-1))); } catch { finish(null); } });
        child.stdin.on("error", () => {}); child.stdin.end(JSON.stringify(request));
      });
      if (result) return result;
      lastError = "Hermes zamanlayıcı adaptörü yüklenemedi.";
    }
    return { success: false, error: lastError };
  }
  installLauncher(id, stateFile, launch) {
    const dir = path.join(this.home(), "scripts"); fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, `avalon-${id}.py`);
    const temporary = `${script}.${process.pid}.tmp`;
    writeJson(script.replace(/\.py$/, ".json"), { stateFile, ...launch });
    fs.writeFileSync(temporary, `# Managed by Avalon; Hermes source and config are not modified.
import json, os, subprocess, sys, time
from pathlib import Path
c = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
s = json.loads(Path(c['stateFile']).read_text(encoding='utf-8'))
flags = (subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == 'nt' else 0
env = dict(os.environ)
env.update(c.get('env', {}))
if len(sys.argv) > 1 and sys.argv[1] == '--avalon-worker':
    # An OS-owned lock is released even if the supervisor crashes. The native
    # scheduler dispatch can return promptly; its 1h script timeout does not
    # bound a 2h research run. Research state owns the actual completion status.
    lock = open(str(Path(c['stateFile']).with_name('supervisor.lock')), 'a+b')
    try:
        if os.fstat(lock.fileno()).st_size == 0:
            lock.write(b'0'); lock.flush()
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        Path(c['stateFile']).with_name('last-skip.json').write_text(json.dumps({'reason':'already_running','at':int(time.time()*1000)}))
        lock.close()
        sys.exit(0)
    error_file = Path(c['stateFile']).with_name('dispatch-error.json')
    try:
        with open(c['logFile'], 'ab') as log:
            result = subprocess.run([c['executable'], c['runner'], '--schedule', c['stateFile'], '--occurrence', sys.argv[2]], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except Exception:
        error_file.write_text(json.dumps({'at':int(time.time()*1000),'error':'Avalon arka plan çalıştırıcısı başlatılamadı. Uygulama yolunu kontrol et.'}))
        lock.close()
        sys.exit(1)
    if result.returncode:
        error_file.write_text(json.dumps({'at':int(time.time()*1000),'error':'Avalon arka plan çalıştırıcısı hata ile kapandı. Son çalışma kaydını kontrol et.'}))
    elif error_file.exists():
        error_file.unlink()
    lock.close()
    sys.exit(result.returncode)
from cron.jobs import get_job
j = get_job(s['nativeId']) or {}
claim = j.get('fire_claim') or {}
occurrence = claim.get('by') or claim.get('at') or j.get('next_run_at')
if not occurrence:
    raise RuntimeError('Scheduled occurrence identity unavailable')
with open(c['logFile'], 'ab') as log:
    subprocess.Popen([sys.executable, __file__, '--avalon-worker', str(occurrence)], env=dict(os.environ), stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags, start_new_session=os.name != 'nt', close_fds=True)
print(json.dumps({'queued': True, 'scheduleId': s['id']}))
`, { mode: 0o600 });
    fs.renameSync(temporary, script);
    return script;
  }
}
