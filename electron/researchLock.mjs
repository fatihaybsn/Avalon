import path from "node:path";
import { spawn } from "node:child_process";
import { HermesBrainBridge } from "./brainModels.mjs";
import { nativeResourcePath } from "./resourcePaths.mjs";
import { automationRoot, flowLockDirectory } from "./automationRuntime.mjs";
import { readJson } from "./researchStore.mjs";

const leases = new WeakMap();

export function researchLockFile(store, state) {
  let flow = state.spec?.automationFlowId;
  if (state.automationRunId) {
    if (!/^[a-f0-9]{64}$/.test(state.automationRunId)) throw new Error("Geçersiz otomasyon çalışma kimliği.");
    const run = readJson(path.join(automationRoot(store.root), "runs", state.automationRunId, "run.json"));
    if (!run?.flowId || run.id !== state.automationRunId) throw new Error("Otomasyon kilit kapsamı doğrulanamadı.");
    flow = run.flowId;
  }
  return flow ? path.join(flowLockDirectory(store.root, flow), "supervisor.lock")
    : store.file(state.scheduleId || state.id, "supervisor.lock");
}

export function ownsResearchLock(lease, file) {
  return leases.get(lease) === path.resolve(file) && !lease.signal.aborted;
}

// One OS lock per shared resource. A nested research step receives the actual
// in-memory lease, never an environment variable or JSON "already locked" flag.
export async function acquireResearchLock(file, { repoRoot, signal, candidates, spawnImpl = spawn } = {}) {
  signal?.throwIfAborted();
  const python = candidates || new HermesBrainBridge({ repoRoot }).candidates();
  for (const executable of python) {
    const result = await new Promise((resolve, reject) => {
      const child = spawnImpl(executable, ["-I", "-B", "-u", nativeResourcePath(repoRoot, "sidecar/research_lock.py"), file], {
        windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
      });
      const lost = new AbortController();
      let output = "", releasing = false, settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener("abort", cancel);
        if (error) { child.stdin.destroy(); child.kill(); reject(error); }
        else resolve(value);
      };
      const cancel = () => finish(signal.reason);
      const timer = setTimeout(() => finish(new Error("OS görev kilidi yanıt vermedi.")), 10000);
      signal?.addEventListener("abort", cancel, { once: true });
      const exited = new Promise((done) => child.once("close", done));
      child.on("error", (error) => error.code === "ENOENT" ? finish(null, null) : finish(error));
      child.stdin.on("error", () => {});
      child.on("close", () => {
        if (!releasing) lost.abort(Object.assign(new Error("OS kilit supervisor bağlantısı kesildi."), { code: "INTERRUPTED" }));
        if (!settled) finish(new Error("OS kilit supervisor başlatılamadı."));
      });
      child.stdout.on("data", (part) => {
        output += part;
        if (output.length > 4096) return finish(new Error("Geçersiz OS kilit yanıtı."));
        if (!output.includes("\n") || settled) return;
        let reply;
        try { reply = JSON.parse(output.split("\n")[0]); } catch { return finish(new Error("Geçersiz OS kilit yanıtı.")); }
        if (reply.protocol !== 2 || typeof reply.acquired !== "boolean") return finish(new Error("OS kilit protokolü desteklenmiyor."));
        if (!reply.acquired) { child.stdin.end(); return finish(null, { skipped: true, reason: "already_running" }); }
        let releasePromise;
        const lease = { signal: lost.signal, supervisorPid: reply.pid,
          release() {
            if (!releasePromise) {
              releasing = true;
              leases.delete(lease);
              child.stdin.end("release\n");
              releasePromise = (async () => {
                const timeout = setTimeout(() => child.kill(), 2000);
                try { await exited; } finally { clearTimeout(timeout); }
              })();
            }
            return releasePromise;
          },
        };
        leases.set(lease, path.resolve(file));
        finish(null, lease);
      });
    });
    if (result) return result;
  }
  throw new Error("OS görev kilidi için Python ortamı bulunamadı.");
}
