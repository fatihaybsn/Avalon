// Headless entry point. Never imports main.mjs, Electron UI, Gemini or audio.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./configStore.mjs";
import { ResearchStore, readJson, writeJson, processAlive, RESEARCH_TERMINAL } from "./researchStore.mjs";
import { runGPTResearch } from "./gptResearch.mjs";
import { validateBrainSelection } from "./brainModels.mjs";

export function claimSchedule(store, schedule, occurrence) {
  const lockFile = store.file(schedule.id, "active.lock");
  const previous = readJson(lockFile);
  if (previous && processAlive(previous.pid)) return { skipped: true, reason: "already_running" };
  if (previous) fs.rmSync(lockFile, { force: true });
  let lock;
  try { lock = fs.openSync(lockFile, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") return { skipped: true, reason: "already_running" }; throw error; }
  const token = crypto.randomUUID();
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token, at: Date.now() })); fs.closeSync(lock);
  const release = () => { if (readJson(lockFile)?.token === token) fs.rmSync(lockFile, { force: true }); };
  const occurrenceFile = store.file(schedule.id, `occurrence-${crypto.createHash("sha256").update(occurrence).digest("hex")}.json`);
  if (fs.existsSync(occurrenceFile)) { release(); return { skipped: true, reason: "duplicate_occurrence" }; }
  writeJson(occurrenceFile, { occurrence, at: Date.now() });
  return { release };
}

export async function runEntry(args = process.argv.slice(2), { spawnWorker, resolveModel } = {}) {
  const scheduled = args[0] === "--schedule";
  if (!scheduled && args[0] !== "--run") throw new Error("Expected --run or --schedule");
  const stateFile = path.resolve(args[1] || "");
  let state = readJson(stateFile);
  if (!state?.id || !state?.spec) throw new Error("Research specification unavailable");
  const runtime = state.spec.runtime;
  if (!runtime?.stateRoot || !runtime?.repoRoot) throw new Error("Research runtime unavailable");
  const store = new ResearchStore(runtime.stateRoot);
  if (store.file(state.id) !== stateFile) throw new Error("Research state path mismatch");
  Object.assign(process.env, runtime.env || {});
  loadEnvFiles({ repoRoot: runtime.repoRoot });
  let release;
  if (scheduled) {
    if (state.removed || state.paused) return { skipped: true, reason: "paused_or_removed" };
    const occurrenceIndex = args.indexOf("--occurrence");
    const occurrence = args[occurrenceIndex + 1];
    if (occurrenceIndex < 0 || !occurrence || occurrence.length > 300) throw new Error("Scheduled occurrence missing");
    const claim = claimSchedule(store, state, occurrence);
    if (claim.skipped) {
      writeJson(store.file(state.id, "last-skip.json"), { ...claim, at: Date.now(), occurrence });
      return claim;
    }
    release = claim.release;
    state = store.create(state.spec, { scheduleId: state.id, occurrence });
  } else if (RESEARCH_TERMINAL.has(state.status) || (state.pid && processAlive(state.pid))) return { skipped: true, reason: "already_started" };
  try {
    state.spec = { ...state.spec, route: validateBrainSelection(state.spec.route) };
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
    try { return await runGPTResearch({ store, state, writeJson, readJson, signal: controller.signal, spawnWorker, resolveModel }); }
    finally { process.off("SIGTERM", stop); process.off("SIGINT", stop); }
  } catch (error) {
    store.save({ ...state, status: "failed", finishedAt: Date.now(), error: String(error.message).slice(0, 1000) });
    throw error;
  } finally { release?.(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEntry().then((result) => { console.log(JSON.stringify({ id: result.id, status: result.status, skipped: result.skipped, reason: result.reason })); })
    .catch(() => { console.error("Avalon research runner failed. See the saved run state."); process.exitCode = 1; });
}
