import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { automationRoot, automationInstalled, automationResearchSpec, editorDirectory, getAutomationFlows,
  installAutomation, startAutomationHost } from "./automationRuntime.mjs";
import { listAutomationRuns, automationNeedsReview, activeAutomationRun } from "./automationRunner.mjs";
import { researchCard, readJson, writeJson } from "./researchStore.mjs";
import { brainSelectionLabel } from "./brainModels.mjs";
import { nativeResourcePath } from "./resourcePaths.mjs";

const require = createRequire(import.meta.url);

export class AutomationService {
  constructor(research) {
    this.research = research;
    this.root = automationRoot(research.root);
    this.repoRoot = research.repoRoot;
  }

  async install() {
    this.installation ??= installAutomation(this.root, this.repoRoot);
    try { await this.installation; } finally { this.installation = null; }
  }

  async editor() {
    if (this.editorUrl && this.editorHost?.connected) return this.editorUrl;
    if (!this.editorStart) this.editorStart = new Promise((resolve, reject) => {
      const host = startAutomationHost({ root: this.root, repoRoot: this.repoRoot, mode: "editor",
        userDir: editorDirectory(this.root), log: path.join(this.root, "editor.log") });
      this.editorHost = host;
      const timer = setTimeout(() => {
        host.kill();
        reject(new Error("Node-RED düzenleyicisi başlatılamadı."));
      }, 30000);
      const fail = (error) => { clearTimeout(timer); reject(error); };
      host.once("error", fail);
      host.once("exit", () => {
        if (this.editorHost === host) this.editorUrl = null;
        fail(new Error("Node-RED düzenleyicisi kapandı."));
      });
      host.once("message", (message) => {
        clearTimeout(timer);
        if (message.kind !== "ready" || !Number.isInteger(message.port) || !/^[a-f0-9]{64}$/.test(message.token)) {
          fail(new Error(message.error || "Node-RED düzenleyicisi hazır değil."));
          host.kill();
          return;
        }
        this.editorUrl = `http://127.0.0.1:${message.port}/?access_token=${message.token}`;
        resolve(this.editorUrl);
      });
    });
    try { return await this.editorStart; } finally { this.editorStart = null; }
  }

  flows() { return getAutomationFlows(this.root, this.repoRoot); }

  async saveSchedule(flowId, schedule, existingOnly = false) {
    if (!automationInstalled(this.root, this.repoRoot)) throw new Error("Önce Planlama ekranından Node-RED’i kurun.");
    if (this.savingSchedule) throw new Error("Bir zamanlama zaten kaydediliyor.");
    this.savingSchedule = true;
    try {
      const flow = this.flows().find((item) => item.id === flowId);
      if (!flow || flow.error) throw new Error(flow?.error || "Akış bulunamadı.");
      const existing = this.research.store.list("schedule_").find((item) => !item.removed && item.nativeId && item.spec?.automationFlowId === flowId);
      if (existingOnly && !existing?.nativeId) throw new Error("Mobilde yalnızca mevcut zamanlamalar düzenlenebilir.");
      const spec = await this.research.specification({
        ...existing?.spec, route: undefined, topic: flow.name, mode: "normal", schedule,
      });
      for (const step of flow.steps.filter((step) => step.kind === "research")) automationResearchSpec(step, spec);
      if (existing?.nativeId) return await this.research.updateSchedule(existing.id, spec);
      return await this.research.createSchedule({ ...spec, automationFlowId: flowId });
    } finally { this.savingSchedule = false; }
  }

  cancelRun(flowId, runId) {
    if (!/^[a-f0-9]{64}$/.test(runId) ||
        !listAutomationRuns(this.root, flowId).some((run) => run.id === runId && run.status === "running")) {
      throw new Error("İptal edilecek etkin otomasyon turu bulunamadı.");
    }
    writeJson(path.join(this.root, "runs", runId, "cancel.json"), { requestedAt: Date.now() });
    return { ok: true };
  }

  async run(flowId) {
    const flow = this.flows().find((item) => item.id === flowId);
    if (!flow || flow.error) throw new Error(flow?.error || "Akış bulunamadı.");
    if (automationNeedsReview(this.root, flowId)) throw new Error("Önceki Hermes görevinin dış işlemlerini inceleyip inceleme kaydını onaylayın.");
    if (activeAutomationRun(this.root, flowId)) throw new Error("Önceki çalıştırıcı henüz güvenli biçimde sonlanmadı.");
    // Persisted/PID state is diagnostic. The shared runner's OS lease makes
    // the authoritative overlap decision for manual and scheduled starts.
    const configured = this.research.store.list("schedule_").find((item) => !item.removed && item.nativeId && item.spec?.automationFlowId === flowId);
    const spec = await this.research.specification({ ...configured?.spec, route: undefined, topic: flow.name, mode: "normal", schedule: undefined });
    await this.research.prepareRoute(spec.route);
    const state = { id: `schedule_${crypto.randomUUID()}`, manual: true, createdAt: Date.now(),
      spec: { ...spec, automationFlowId: flowId, runtime: this.research.runtime() } };
    this.research.store.save(state);
    const child = this.research.launch(state, ["--automation", this.research.store.file(state.id), "--occurrence", "manual"]);
    if (child?.once) await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    return { ok: true };
  }

  respond(flowId, runId, attemptId, interactionId, value) {
    const run = listAutomationRuns(this.root, flowId).find((item) => item.id === runId && item.status === "running");
    const step = run?.steps.find((item) => item.attemptId === attemptId && item.interaction?.id === interactionId);
    if (!step || typeof value !== "string" || value.length > 12000 ||
        !["approval", "clarify"].includes(step.interaction.type) ||
        (step.interaction.type === "approval" && !step.interaction.choices.includes(value))) throw new Error("Bekleyen kullanıcı isteği bulunamadı veya yanıt geçersiz.");
    writeJson(path.join(this.root, "runs", run.id, attemptId + ".response.json"), { interactionId, value });
    return { ok: true };
  }

  acknowledgeReview(flowId, runId) {
    if (activeAutomationRun(this.root, flowId)) throw new Error("Çalıştırıcı temizliği bitmeden inceleme onaylanamaz. Önce etkin çalıştırıcıyı durdurun.");
    const run = listAutomationRuns(this.root, flowId).find((item) => item.id === runId && item.status !== "running");
    if (!run?.steps.some((step) => step.cancellationUnconfirmed)) throw new Error("İncelenecek belirsiz Hermes görevi bulunamadı.");
    writeJson(path.join(this.root, "runs", run.id, "reviewed.json"), { runId: run.id, acknowledgedAt: Date.now() });
    return { ok: true };
  }

  exportFlow(flowId) {
    const flow = this.flows().find((item) => item.id === flowId);
    if (!flow || flow.error) throw new Error(flow?.error || "Akış bulunamadı.");
    const { portableFlows } = require(nativeResourcePath(this.repoRoot, "automation/flows.cjs"));
    return portableFlows(flow.graph);
  }

  outputDirectory(flowId, runId, attemptId) {
    const step = listAutomationRuns(this.root, flowId).find((run) => run.id === runId)?.steps.find((item) => item.attemptId === attemptId);
    const directory = step?.workingDirectory || step?.outputPath;
    if (!directory || !fs.existsSync(directory)) throw new Error("Görev çıktı klasörü bulunamadı.");
    return directory;
  }

  importFlow(value) {
    const { checkEditorFlows, compileFlow } = require(nativeResourcePath(this.repoRoot, "automation/flows.cjs"));
    checkEditorFlows(value);
    const tabs = value.filter((node) => node.type === "tab");
    if (!tabs.length) throw new Error("JSON en az bir akış içermeli.");
    for (const tab of tabs) compileFlow(value, tab.id);
    if (this.flows().some((flow) => listAutomationRuns(this.root, flow.id).some((run) => run.status === "running"))) throw new Error("Çalışan otomasyon bitince içe aktarın.");
    const file = path.join(editorDirectory(this.root), "flows.json");
    const saved = readJson(file, []);
    if (value.some((node) => saved.some((existing) => existing.id === node.id))) throw new Error("Düğüm kimlikleri mevcut akışla çakışıyor. Node-RED içe aktarımını kullanın.");
    checkEditorFlows([...saved, ...value]);
    this.close(); this.editorUrl = null;
    writeJson(file, [...saved, ...value]);
    return { ok: true };
  }

  snapshot(scheduledOnly = false) {
    const installed = automationInstalled(this.root, this.repoRoot);
    const { jobs, scheduler } = this.research.scheduleSnapshot();
    const schedules = jobs.filter((job) => job.spec.automationFlowId);
    const flows = installed ? this.flows() : [];
    for (const job of schedules) {
      const id = job.spec.automationFlowId;
      if (!flows.some((flow) => flow.id === id)) flows.push({ id, name: job.name, error: "Kayıtlı akış bulunamadı." });
    }
    return { installed, supported: process.platform === "win32" && process.arch === "x64", scheduler,
      flows: flows.filter(({ id }) => !scheduledOnly || schedules.some((job) => job.spec.automationFlowId === id)).map(({ id, name, error, steps }) => {
        const job = schedules.find((item) => item.spec.automationFlowId === id);
        const history = listAutomationRuns(this.root, id).slice(0, scheduledOnly ? 3 : 20).map((run) => ({ id: run.id,
          startedAt: run.startedAt, status: run.status, error: run.error,
          modelLabel: run.route ? brainSelectionLabel(run.route) : undefined, steps: run.steps.map((step) => {
          const state = step.researchId && this.research.store.get(step.researchId);
          let output = "";
          if (step.kind === "hermes" && step.outputPath) {
            try { output = fs.readFileSync(path.join(step.outputPath, "output.md"), "utf8"); } catch { /* unfinished */ }
          }
          return { ...step, files: step.result?.ref?.files || [], task: state ? researchCard(state) : step.kind === "hermes" ? {
            id: step.taskId || step.attemptId || step.id, kind: "automation", task: step.name, status: step.status, updatedAt: step.finishedAt || step.startedAt || run.startedAt,
            output, outputPath: step.outputPath, error: step.error,
          } : undefined };
        }) }));
        const review = automationNeedsReview(this.root, id);
        return { id, name, error, needsReview: review ? { runId: review.id } : undefined, steps: steps?.map(({ id, name }) => ({ id, name })),
          schedule: job && { id: job.id, spec: job.spec.schedule, paused: job.paused, nextRunAt: job.nextRunAt,
            error: job.error, lastSkip: job.lastSkip },
          history };
      }),
    };
  }

  close() { if (this.editorHost?.connected) this.editorHost.disconnect(); }
}
