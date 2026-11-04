import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { HermesBrainBridge } from "./brainModels.mjs";
import { reasoningBody } from "./brainReasoning.mjs";
import { nativeResourcePath } from "./resourcePaths.mjs";
import { atomicWrite, canonicalUrl } from "./researchFiles.mjs";

export function researchScope(spec) {
  if (spec.mode !== "deep") return {};
  return {
    breadth: spec.breadth ?? (spec.minutes > 60 ? 5 : spec.minutes > 30 ? 4 : 3),
    depth: spec.depth ?? 2,
  };
}

export function publishResearch(state, record, writeJson) {
  const { outputPath } = state;
  writeJson(path.join(outputPath, "sources.json"), record.sources);
  const findings = record.findings.filter((item) => item && typeof item.text === "string");
  writeJson(path.join(outputPath, "evidence.json"), findings.length
    ? findings.map(({ url, text }) => ({ url: canonicalUrl(url) || "", text, verified: false }))
    : record.sources.map(({ url, text, title }) => ({ url, text, title, verified: false })));
  writeJson(path.join(outputPath, "findings.json"), record.findings);
  const output = record.report || "# " + state.task + "\n\n" +
    (state.spec.language === "en" ? "Report unavailable. Saved material is in sources.json and findings.json." :
      "Rapor hazırlanamadı. Kaydedilen malzeme sources.json ve findings.json dosyalarında.");
  atomicWrite(path.join(outputPath, "report.md"), output + "\n");
  writeJson(path.join(outputPath, "summary.json"), { ...state, elapsedMs: Math.max(0, (state.finishedAt || Date.now()) - (state.startedAt || state.createdAt)), output: undefined, spec: { ...state.spec, runtime: undefined } });
  return output;
}

export async function runGPTResearch({ state, store, writeJson, readJson, signal, spawnWorker = spawn, resolveModel }) {
  const root = state.spec.runtime.repoRoot;
  const startedAt = Date.now();
  state.spec = { ...state.spec, ...researchScope(state.spec) };
  delete state.spec.minutes;
  Object.assign(state, { startedAt, pid: process.pid, status: "running", phase: "planning", activeWorkers: 0 });
  const sources = new Map(), limitations = [];
  const record = { engine: "gpt-researcher", runId: state.id, sources: [], findings: [], report: "" };
  const save = (patch = {}) => { Object.assign(state, patch); store.save(state); };
  const checkpoint = () => {
    record.sources = [...sources.values()];
    writeJson(store.file(state.id, "checkpoint.json"), record);
  };
  save();
  let child, cancelled = false, workerError = "", reportComplete = false;
  const stop = () => { cancelled = true; child?.kill(); };
  const monitor = setInterval(() => {
    if (signal.aborted || fs.existsSync(store.file(state.id, "cancel"))) stop();
    else save();
  }, 1000);
  signal.addEventListener("abort", stop, { once: true });
  try {
    const route = state.spec.route;
    const bridge = new HermesBrainBridge({ repoRoot: root });
    const info = await (resolveModel ? resolveModel(route) : bridge.call({ action: "info", provider: route.provider, includeResearchSearch: true }));
    if (!info.configured || !info.key || !info.baseUrl) throw new Error("Seçili sağlayıcının model bağlantısı bulunamadı.");
    if (cancelled || signal.aborted || fs.existsSync(store.file(state.id, "cancel"))) stop();
    if (!cancelled) {
      const python = path.join(os.homedir(), ".iris", "gpt-researcher-0.16.0", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
      const script = nativeResourcePath(root, "sidecar", "gpt_researcher_worker.py");
      child = spawnWorker(python, ["-I", "-u", script], { windowsHide: true, cwd: state.outputPath, stdio: ["pipe", "pipe", "ignore"],
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:SYSTEMROOT|WINDIR|PATH|TEMP|TMP|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|PROGRAMDATA|HTTPS?_PROXY|NO_PROXY|SSL_CERT_FILE|REQUESTS_CA_BUNDLE)$/i.test(key))) });
      const finished = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        if (cancelled || signal.aborted || workerError || line.length > 12_000_000) return;
        try {
          const event = JSON.parse(line);
          if (event.kind === "source") {
            const url = canonicalUrl(event.source?.url || event.source?.href);
            const text = event.source?.raw_content || event.source?.content || event.source?.text;
            if (!url || typeof text !== "string" || !text.trim()) return;
            if ((sources.get(url)?.text.length || 0) >= text.length) return;
            sources.set(url, { url, title: String(event.source.title || ""), text, fetchedAt: Date.now() });
            checkpoint(); save({ sourceCount: sources.size });
          } else if (event.kind === "findings" && Array.isArray(event.findings)) {
            record.findings.push(...event.findings); checkpoint();
          } else if (["report", "report_chunk"].includes(event.kind) && typeof event.markdown === "string") {
            reportComplete = event.kind === "report";
            record.report = reportComplete ? event.markdown.trim() : (event.replace ? "" : record.report) + event.markdown;
            checkpoint(); atomicWrite(path.join(state.outputPath, "report.md"), record.report + "\n"); save({ output: record.report });
          } else if (event.kind === "phase" && ["planning", "collecting", "reporting"].includes(event.phase)) {
            save({ phase: event.phase, lastActivity: event.phase === "reporting" ? "GPT Researcher raporu yazıyor." : "GPT Researcher kaynak topluyor." });
          } else if (event.kind === "progress" && state.phase === "collecting") {
            save({ lastActivity: `GPT Researcher kaynak topluyor. ${event.completed}/${event.total} arama kolu tamamlandı.` });
          } else if (event.kind === "search") {
            const message = event.reason === "quota" ? "Tavily kotası doldu. Arama DuckDuckGo ile devam ediyor." :
              event.reason === "missing_key" ? "Tavily anahtarı bulunamadı. DuckDuckGo kullanılıyor." : "";
            if (message) limitations.push(message);
            save({ searchProvider: event.provider, searchCounts: event.counts,
              ...(message ? { searchNotice: message, lastActivity: message } : {}) });
          } else if (event.kind === "warning") {
            if (!limitations.includes(event.message)) limitations.push(event.message);
            save({ lastActivity: event.message });
          } else if (event.kind === "error") workerError = event.message;
        } catch {
          workerError = "Araştırmanın ara kaydı yazılamadı veya okunamadı.";
          child.kill();
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ ...state.spec, runtime: undefined, ...researchScope(state.spec), runId: state.id, parentPid: process.pid, baseUrl: info.baseUrl,
        apiKey: info.key, tavilyKey: process.env.TAVILY_API_KEY || info.tavilyKey || "", reasoning: reasoningBody(route) }));
      const exitCode = await finished;
      lines.close();
      if (signal.aborted || fs.existsSync(store.file(state.id, "cancel"))) cancelled = true;
      if (exitCode !== 0 && !workerError) workerError = "GPT Researcher işlemi tamamlanamadı.";
    }
  } catch (error) {
    workerError = error.code === "ENOENT" ? "GPT Researcher çalışma ortamı bulunamadı. Avalon araştırma kurulumunu çalıştırın." : error.message;
  } finally {
    clearInterval(monitor);
    signal.removeEventListener("abort", stop);
  }

  if (workerError && !cancelled) limitations.push(workerError);
  const usable = sources.size || record.findings.length || record.report;
  const status = cancelled ? "cancelled" : reportComplete && !workerError ? "completed" : usable ? "partial" : "failed";
  Object.assign(state, { status, phase: "done", activeWorkers: 0, finishedAt: Date.now(), sourceCount: sources.size,
    reportMode: record.report ? "synthesized" : "fallback", reportReady: reportComplete,
    limitations: [...new Set(limitations)], error: status === "failed" ? workerError || "Araştırma sonucu üretilemedi." : "",
    lastActivity: status === "completed" ? "Araştırma tamamlandı." : "Mevcut araştırma çıktıları kaydedildi." });
  if (state.scheduleId) {
    const file = store.file(state.scheduleId, "seen.json"), seen = readJson(file, {});
    const hashes = Object.fromEntries([...sources.values()].map(({ url, text }) => [url, crypto.createHash("sha256").update(text).digest("hex")]));
    state.newCount = Object.keys(hashes).filter((url) => !seen[url]).length;
    state.changedCount = Object.keys(hashes).filter((url) => seen[url] && seen[url] !== hashes[url]).length;
    if (status === "completed") writeJson(file, { ...seen, ...hashes });
  }
  checkpoint();
  state.output = publishResearch(state, record, writeJson);
  save();
  return state;
}
