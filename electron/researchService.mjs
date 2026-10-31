import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { validateBrainSelection, brainSelectionLabel } from "./brainModels.mjs";
import { ResearchStore, normalizeResearch, researchCard, readJson, writeJson, RESEARCH_TERMINAL, scheduleLabel } from "./researchStore.mjs";

export class ResearchService {
  constructor({ root, outputRoot, repoRoot, scheduler, getRoute, getLanguage = () => "tr", prepareRoute, sessionId, configPath, emit = () => {}, notify = () => {}, executable = process.execPath, spawnImpl = spawn }) {
    Object.assign(this, { root, outputRoot, repoRoot, scheduler, getRoute, getLanguage, prepareRoute, sessionId, configPath, emit, notify, executable, spawnImpl });
    this.store = new ResearchStore(root); this.observed = new Map(); this.notices = readJson(path.join(root, "notices.json"), []);
    this.schedulerStatus = { available: false, error: "Zamanlayıcı henüz kontrol edilmedi." }; this.refreshing = false;
    this.timer = setInterval(() => this.poll(), 1000); this.timer.unref();
  }
  defaults() { return { outputDirectory: this.outputRoot, minutes: 30 }; }
  async formDefaults() { return { ...this.defaults(), route: validateBrainSelection(await this.getRoute()) }; }
  async specification(input) {
    const route = validateBrainSelection(input?.route === undefined ? await this.getRoute() : input.route);
    return normalizeResearch({ ...input, language: this.getLanguage() }, { outputRoot: this.outputRoot, sessionId: this.sessionId(), route });
  }
  runtime() {
    return { stateRoot: this.root, repoRoot: this.repoRoot, env: {
      ELECTRON_RUN_AS_NODE: "1", HERMES_HOME: process.env.HERMES_HOME || this.scheduler.home(),
      ...(process.env.HERMES_BIN ? { HERMES_BIN: process.env.HERMES_BIN } : {}),
      ...(process.env.IRIS_TEST_HOOKS === "1" ? { IRIS_TEST_HOOKS: "1", IRIS_TEST_CONFIG_PATH: this.configPath } : {}),
    } };
  }
  launch(state, args = ["--run", this.store.file(state.id)]) {
    const logFile = this.store.file(state.id, "runner.log");
    const log = fs.openSync(logFile, "a", 0o600);
    try {
      const child = this.spawnImpl(this.executable, [path.join(this.repoRoot, "electron/researchRunner.mjs"), ...args], {
        detached: true, windowsHide: true, cwd: path.dirname(this.root), env: { ...process.env, ...state.spec.runtime.env }, stdio: ["ignore", log, log],
      });
      child.on("error", () => this.store.save({ ...state, status: "failed", error: "Araştırma çalıştırıcısı başlatılamadı.", finishedAt: Date.now() }));
      child.unref(); return child;
    } finally { fs.closeSync(log); }
  }
  async start(spec) {
    spec = { ...spec, route: validateBrainSelection(spec.route) };
    await this.prepareRoute(spec.route);
    const savedSpec = { ...spec, runtime: this.runtime() }; delete savedSpec.schedule;
    const state = this.store.create(savedSpec); this.launch(state); this.poll(); return researchCard(state);
  }
  async createSchedule(spec) {
    spec = { ...spec, route: validateBrainSelection(spec.route) };
    await this.prepareRoute(spec.route);
    const id = `schedule_${crypto.randomUUID()}`;
    const state = { id, spec: { ...spec, runtime: this.runtime() }, createdAt: Date.now(), paused: false, name: spec.topic, label: scheduleLabel(spec.schedule) };
    this.store.save(state);
    const script = this.scheduler.installLauncher(id, this.store.file(id), { executable: this.executable, runner: path.join(this.repoRoot, "electron/researchRunner.mjs"), env: state.spec.runtime.env, logFile: this.store.file(id, "runner.log") });
    const result = await this.scheduler.call({ action: "create", name: `Avalon: ${spec.topic.slice(0, 90)}`, schedule: spec.schedule, script });
    if (!result.success || !result.job?.job_id) { this.store.save({ ...state, removed: true, error: result.error || "Zamanlama kaydı doğrulanamadı." }); throw new Error(result.error || "Zamanlama kaydı doğrulanamadı."); }
    Object.assign(state, { nativeId: result.job.job_id, native: result.job, script }); this.store.save(state);
    await this.refreshSchedules(); return this.publicSchedule(state);
  }
  async updateSchedule(id, input) {
    const state = this.requireSchedule(id);
    const route = validateBrainSelection(input?.route === undefined ? state.spec.route : input.route);
    const spec = normalizeResearch({ ...input, language: state.spec.language }, { outputRoot: this.outputRoot, sessionId: state.spec.sessionId, route }); if (!spec.schedule) throw new Error("Zamanlama bilgisi gerekli.");
    await this.prepareRoute(spec.route);
    const result = await this.scheduler.call({ action: "update", jobId: state.nativeId, name: `Avalon: ${spec.topic.slice(0, 90)}`, schedule: spec.schedule, script: state.script });
    if (!result.success) throw new Error(result.error || "Zamanlama güncellenemedi.");
    this.scheduler.installLauncher(id, this.store.file(id), { executable: this.executable, runner: path.join(this.repoRoot, "electron/researchRunner.mjs"), env: this.runtime().env, logFile: this.store.file(id, "runner.log") });
    this.store.save({ ...state, spec: { ...spec, runtime: this.runtime() }, name: spec.topic, label: scheduleLabel(spec.schedule), native: result.job || state.native });
    await this.refreshSchedules(); return { ok: true };
  }
  requireSchedule(id) { const state = this.store.get(id); if (!state?.nativeId || state.removed) throw new Error("Zamanlanmış görev bulunamadı."); return state; }
  async scheduleAction(id, action) {
    if (!["pause", "resume", "remove", "run"].includes(action)) throw new Error("Geçersiz zamanlama işlemi.");
    const state = this.requireSchedule(id);
    const result = await this.scheduler.call({ action, jobId: state.nativeId });
    if (!result.success) throw new Error(result.error || "Zamanlayıcı işlemi başarısız.");
    this.store.save({ ...state, ...(action === "remove" ? { removed: true } : action !== "run" ? { paused: action === "pause" } : {}), native: result.job || state.native });
    await this.refreshSchedules(); return { ok: true };
  }
  publicSchedule(state, allRuns = this.store.list()) {
    const runs = allRuns.filter((run) => run.scheduleId === state.id);
    const last = runs[0];
    return { id: state.id, name: state.name, label: state.label, paused: state.paused, spec: { ...state.spec, runtime: undefined },
      modelLabel: brainSelectionLabel(state.spec.route), nextRunAt: state.native?.next_run_at || null, lastRun: last ? researchCard(last) : null, history: runs.slice(0, 30).map(researchCard),
      error: state.error || readJson(this.store.file(state.id, "dispatch-error.json"))?.error || state.native?.last_error || state.native?.last_fire_error || "", lastSkip: readJson(this.store.file(state.id, "last-skip.json")) };
  }
  async refreshSchedules() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const status = await this.scheduler.call({ action: "status" });
      this.schedulerStatus = { available: Boolean(status.available), error: status.success === false ? status.error : status.available ? "" : "Hermes zamanlayıcısı çalışmıyor.", timezone: status.timezone };
      if (status.success) {
        const listing = await this.scheduler.call({ action: "list" });
        if (listing.success) for (const state of this.store.list("schedule_").filter((job) => !job.removed)) {
          const native = (listing.jobs || []).find((job) => job.job_id === state.nativeId);
          if (native) this.store.save({ ...state, native, paused: !native.enabled, error: "" });
          else if (state.nativeId) this.store.save({ ...state, error: "Görev Hermes zamanlayıcısında bulunamadı." });
        }
      }
      this.emit({ type: "research_schedules", ...this.scheduleSnapshot() });
    } finally { this.refreshing = false; }
  }
  scheduleSnapshot() {
    const runs = this.store.list();
    return { jobs: this.store.list("schedule_").filter((job) => !job.removed && job.nativeId).map((job) => this.publicSchedule(job, runs)), scheduler: this.schedulerStatus };
  }
  list() { this.store.reconcile(); return this.store.list().map(researchCard); }
  read(id) {
    const state = this.store.get(id); if (!state || !id.startsWith("research_")) throw new Error("Araştırma bulunamadı.");
    return { ok: true, output: state.output || "Araştırma sürüyor.", task: state.task, status: state.status, run_id: id, outputPath: state.outputPath };
  }
  stop(id) {
    const state = this.store.get(id); if (!state || !id.startsWith("research_")) throw new Error("Araştırma bulunamadı.");
    if (!RESEARCH_TERMINAL.has(state.status)) fs.writeFileSync(this.store.file(id, "cancel"), "cancel\n");
    return { status: state.status, run_id: id };
  }
  poll() {
    try {
      this.store.reconcile();
      let scheduleChanged = false;
      for (const state of this.store.list().slice(0, 200)) {
        if (this.observed.get(state.id) === state.updatedAt) continue;
        this.observed.set(state.id, state.updatedAt);
        this.emit({ type: "research_update", task: researchCard(state) });
        scheduleChanged ||= Boolean(state.scheduleId);
        if (RESEARCH_TERMINAL.has(state.status) && !this.notices.includes(state.id)) {
          this.notices = [...this.notices.slice(-999), state.id]; writeJson(path.join(this.root, "notices.json"), this.notices);
          const shouldNotify = !state.scheduleId || state.status !== "completed" || state.newCount > 0 || state.changedCount > 0;
          if (shouldNotify && state.status !== "cancelled") this.notify(state);
        }
      }
      if (scheduleChanged) this.emit({ type: "research_schedules", ...this.scheduleSnapshot() });
    } catch { /* A damaged run record must not interrupt the voice process. */ }
  }
  close() { clearInterval(this.timer); }
}
