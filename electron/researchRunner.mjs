// Headless entry point. Never imports main.mjs, Electron UI, Gemini or audio.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./configStore.mjs";
import { ResearchStore, readJson, writeJson, RESEARCH_TERMINAL } from "./researchStore.mjs";
import { runGPTResearch } from "./gptResearch.mjs";
import { validateBrainSelection } from "./brainModels.mjs";
import { runAutomation, automationNeedsReview, activeAutomationRun } from "./automationRunner.mjs";
import { automationRoot, flowLockDirectory } from "./automationRuntime.mjs";
import { acquireResearchLock, ownsResearchLock, researchLockFile } from "./researchLock.mjs";
import { processAlive } from "./researchStore.mjs";

function researchAdmission(store, file) {
  const matching = store.list("research_").filter((run) => (run.executionPending || run.startedAt) && researchLockFile(store, run) === file);
  // Reuse checkpoint recovery for dead owners before starting another run.
  store.reconcile({ force: true, ids: matching.map((run) => run.id) });
  return matching.some((run) => (!RESEARCH_TERMINAL.has(run.status) || run.executionPending) && processAlive(run.pid));
}

export async function claimSchedule(store, schedule, occurrence, { lease: inherited, ...options } = {}) {
  const file = researchLockFile(store, schedule);
  if (inherited && !ownsResearchLock(inherited, file)) throw new Error("Geçersiz görev kilidi devri.");
  const lease = inherited || await acquireResearchLock(file, { repoRoot: schedule.spec?.runtime?.repoRoot || path.resolve("."), ...options });
  if (lease.skipped) return lease;
  const flow = schedule.spec?.automationFlowId;
  const lockFile = flow ? path.join(flowLockDirectory(store.root, flow), "active.lock") : store.file(schedule.id, "active.lock");
  const token = crypto.randomUUID();
  const release = async () => {
    try { if (readJson(lockFile)?.token === token) fs.rmSync(lockFile, { force: true }); }
    finally { if (!inherited) await lease.release(); }
  };
  try {
    if (flow && activeAutomationRun(automationRoot(store.root), flow)) { await release(); return { skipped: true, reason: "already_running" }; }
    if (flow && automationNeedsReview(automationRoot(store.root), flow)) { await release(); return { skipped: true, reason: "needs_review" }; }
    // This record describes the OS-owned lease; it never grants admission.
    writeJson(lockFile, { pid: process.pid, supervisorPid: lease.supervisorPid, token, at: Date.now() });
    const occurrenceFile = store.file(schedule.id, `occurrence-${crypto.createHash("sha256").update(occurrence).digest("hex")}.json`);
    if (fs.existsSync(occurrenceFile)) { await release(); return { skipped: true, reason: "duplicate_occurrence" }; }
    writeJson(occurrenceFile, { occurrence, at: Date.now() });
    return { release };
  } catch (error) { await release(); throw error; }
}

export async function runEntry(args = process.argv.slice(2), { spawnWorker, resolveModel, reports, parentSignal, startHost, runHermes, getRoute, lockLease } = {}) {
  const scheduled = args[0] === "--schedule" || args[0] === "--automation";
  if (!scheduled && args[0] !== "--run") throw new Error("Expected --run, --schedule or --automation");
  const stateFile = path.resolve(args[1] || "");
  let state = readJson(stateFile);
  if (!state?.id || !state?.spec) throw new Error("Research specification unavailable");
  const runtime = state.spec.runtime;
  if (!runtime?.stateRoot || !runtime?.repoRoot) throw new Error("Research runtime unavailable");
  const store = new ResearchStore(runtime.stateRoot);
  if (store.file(state.id) !== stateFile) throw new Error("Research state path mismatch");
  Object.assign(process.env, runtime.env || {});
  loadEnvFiles({ repoRoot: runtime.repoRoot });
  const lockFile = researchLockFile(store, state);
  if (lockLease && !ownsResearchLock(lockLease, lockFile)) throw new Error("Geçersiz görev kilidi devri.");
  const lease = lockLease || await acquireResearchLock(lockFile, { repoRoot: runtime.repoRoot, signal: parentSignal });
  if (lease.skipped) {
    writeJson(store.file(state.id, "last-skip.json"), { ...lease, at: Date.now() });
    return lease;
  }
  parentSignal = parentSignal ? AbortSignal.any([parentSignal, lease.signal]) : lease.signal;
  let release;
  let researchExecution = false;
  try {
    // Re-read all mutable admission state only after OS exclusion is held.
    state = store.get(state.id);
    parentSignal.throwIfAborted();
    if (!lockLease && researchAdmission(store, lockFile)) return { skipped: true, reason: "already_running" };
    if (scheduled) {
      if (state.removed || state.paused) return { skipped: true, reason: "paused_or_removed" };
      const occurrenceIndex = args.indexOf("--occurrence");
      const occurrence = args[occurrenceIndex + 1];
      if (occurrenceIndex < 0 || !occurrence || occurrence.length > 300) throw new Error("Scheduled occurrence missing");
      const claim = await claimSchedule(store, state, occurrence, { lease });
      if (claim.skipped) {
        writeJson(store.file(state.id, "last-skip.json"), { ...claim, at: Date.now(), occurrence });
        return claim;
      }
      release = claim.release;
      if (state.spec.automationFlowId) {
        const controller = new AbortController();
        const stop = () => controller.abort(Object.assign(new Error("Otomasyon çalıştırıcısı durduruldu."), { code: "CANCELLED" }));
        process.once("SIGTERM", stop); process.once("SIGINT", stop);
        try {
          return await runAutomation({
            schedule: state, occurrence, store, startHost, runHermes, getRoute,
            signal: parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal,
            runResearch: (id, inputs, signal) => runEntry(["--run", store.file(id)], {
              spawnWorker, resolveModel, reports: inputs, parentSignal: signal, lockLease: lease,
            }),
          });
        } finally { process.off("SIGTERM", stop); process.off("SIGINT", stop); }
      }
      state = store.create(state.spec, { scheduleId: state.id, occurrence });
    } else if (RESEARCH_TERMINAL.has(state.status) || state.startedAt) return { skipped: true, reason: "already_started" };
    try {
      state.executionPending = true;
      state.pid = process.pid;
      store.save(state);
      researchExecution = true;
      state.spec = { ...state.spec, route: validateBrainSelection(state.spec.route) };
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGTERM", stop); process.once("SIGINT", stop);
      const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
      try { return await runGPTResearch({ store, state, writeJson, readJson, signal, spawnWorker, resolveModel, reports }); }
      finally { process.off("SIGTERM", stop); process.off("SIGINT", stop); }
    } catch (error) {
      Object.assign(state, { status: "failed", finishedAt: Date.now(), error: String(error.message).slice(0, 1000) });
      store.save(state);
      throw error;
    }
  } finally {
    try { if (researchExecution) { state.executionPending = false; store.save(state); } }
    finally { try { await release?.(); } finally { if (!lockLease) await lease.release(); } }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--lock-protocol") { console.log("2"); }
  else {
    runEntry().then((result) => { console.log(JSON.stringify({ id: result.id, status: result.status, skipped: result.skipped, reason: result.reason })); })
      .catch(() => { console.error("Avalon research runner failed. See the saved run state."); process.exitCode = 1; });
  }
}
