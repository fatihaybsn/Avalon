import path from "node:path";
import { spawn } from "node:child_process";
import { installResearchLauncher } from "./researchLauncher.mjs";
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
  async installLauncher(id, stateFile, launch) {
    return installResearchLauncher({ home: this.home(), repoRoot: this.repoRoot || path.resolve("."), id, stateFile, launch,
      candidates: this.bridge?.candidates() });
  }
}
