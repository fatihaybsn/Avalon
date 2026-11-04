import path from "node:path";
import { automationRoot, automationInstalled, automationResearchSpec, editorDirectory, getAutomationFlows,
  installAutomation, startAutomationHost } from "./automationRuntime.mjs";
import { listAutomationRuns } from "./automationRunner.mjs";
import { researchCard } from "./researchStore.mjs";

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

  async saveSchedule(flowId, schedule) {
    if (!automationInstalled(this.root, this.repoRoot)) throw new Error("Önce Planlama ekranından Node-RED’i kurun.");
    if (this.savingSchedule) throw new Error("Bir zamanlama zaten kaydediliyor.");
    this.savingSchedule = true;
    try {
      const flow = this.flows().find((item) => item.id === flowId);
      if (!flow || flow.error) throw new Error(flow?.error || "Akış bulunamadı.");
      const existing = this.research.store.list("schedule_").find((item) => !item.removed && item.spec?.automationFlowId === flowId);
      const spec = await this.research.specification({
        ...existing?.spec, topic: flow.name, mode: "normal", schedule,
      });
      for (const step of flow.steps) automationResearchSpec(step, spec);
      if (existing?.nativeId) return await this.research.updateSchedule(existing.id, spec);
      return await this.research.createSchedule({ ...spec, automationFlowId: flowId });
    } finally { this.savingSchedule = false; }
  }

  snapshot() {
    const installed = automationInstalled(this.root, this.repoRoot);
    const { jobs, scheduler } = this.research.scheduleSnapshot();
    const schedules = jobs.filter((job) => job.spec.automationFlowId);
    const flows = installed ? this.flows() : [];
    for (const job of schedules) {
      const id = job.spec.automationFlowId;
      if (!flows.some((flow) => flow.id === id)) flows.push({ id, name: job.name, error: "Kayıtlı akış bulunamadı." });
    }
    return { installed, supported: process.platform === "win32" && process.arch === "x64", scheduler,
      flows: flows.map(({ id, name, error, steps }) => {
        const job = schedules.find((item) => item.spec.automationFlowId === id);
        const history = listAutomationRuns(this.root, id).slice(0, 20).map((run) => ({ ...run, steps: run.steps.map((step) => {
          const state = step.researchId && this.research.store.get(step.researchId);
          return { ...step, task: state ? researchCard(state) : undefined };
        }) }));
        return { id, name, error, steps: steps?.map(({ id, name }) => ({ id, name })),
          schedule: job && { id: job.id, spec: job.spec.schedule, paused: job.paused, nextRunAt: job.nextRunAt,
            error: job.error, lastSkip: job.lastSkip },
          history };
      }),
    };
  }

  close() { if (this.editorHost?.connected) this.editorHost.disconnect(); }
}
