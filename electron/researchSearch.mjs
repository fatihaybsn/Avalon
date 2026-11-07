import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { nativeResourcePath } from "./resourcePaths.mjs";

export class ResearchSearch {
  constructor({ bridge, repoRoot, spawnWorker = spawn }) {
    Object.assign(this, { bridge, repoRoot, spawnWorker });
    this.sequence = 0;
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.closed = false;
  }

  start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const python = this.bridge.python || this.bridge.candidates()[0];
      const child = this.child = this.spawnWorker(python,
        ["-B", "-X", "utf8", "-u", nativeResourcePath(this.repoRoot, "sidecar", "research_search.py")], {
          windowsHide: true, cwd: this.bridge.home(),
          env: { ...process.env, HERMES_HOME: this.bridge.home(), PYTHONIOENCODING: "utf-8" },
          stdio: ["pipe", "pipe", "ignore"],
        });
      const timer = setTimeout(() => fail("Hermes arama bağlantısı zaman aşımına uğradı."), 30000);
      this.rejectStartup = (message) => { clearTimeout(timer); reject(new Error(message)); };
      const fail = (message) => this.close(message);
      this.lines = createInterface({ input: child.stdout });
      this.lines.on("line", (line) => {
        try {
          if (line.length > 2_000_000) throw new Error("Search response too large");
          const value = JSON.parse(line);
          if (value.ready === true) { clearTimeout(timer); this.rejectStartup = undefined; resolve(); return; }
          const request = this.pending.get(value.id);
          if (!request) return fail("Hermes arama yanıtı istekle eşleştirilemedi.");
          clearTimeout(request.timer);
          this.pending.delete(value.id);
          if (value.error) request.reject(new Error(String(value.error).slice(0, 600)));
          else if (Array.isArray(value.results) && value.results.every((row) => row &&
            typeof row.href === "string" && row.href && typeof row.body === "string")) request.resolve(value.results);
          else request.reject(new Error("Hermes arama yanıtı geçersiz."));
        } catch { fail("Hermes arama yanıtı okunamadı."); }
      });
      child.stdin.on("error", () => fail("Hermes arama bağlantısı kapandı."));
      child.once("error", () => fail("Hermes arama çalışma ortamı başlatılamadı."));
      child.once("close", () => fail("Hermes arama çalışma ortamı kapandı."));
    });
    return this.starting;
  }

  search(query, limit = 10) {
    const result = this.queue.then(async () => {
      if (this.closed) throw new Error("Hermes arama bağlantısı kapalı.");
      if (typeof query !== "string" || !query.trim() || query.length > 2000 ||
          !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Geçersiz arama isteği.");
      await this.start();
      if (this.closed) throw new Error("Hermes arama bağlantısı kapalı.");
      return new Promise((resolve, reject) => {
        const id = ++this.sequence;
        const timer = setTimeout(() => this.close("Hermes arama isteği zaman aşımına uğradı."), 120000);
        this.pending.set(id, { resolve, reject, timer });
        this.child.stdin.write(JSON.stringify({ id, query, limit }) + "\n");
      });
    });
    this.queue = result.catch(() => {});
    return result;
  }

  close(message = "Hermes arama işlemi durduruldu.") {
    if (this.closed) return;
    this.closed = true;
    this.rejectStartup?.(message);
    this.rejectStartup = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
    this.lines?.close();
    this.child?.kill();
  }
}
