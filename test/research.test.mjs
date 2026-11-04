import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ResearchStore, normalizeResearch, normalizeSchedule, canonicalUrl, readJson, writeJson } from "../electron/researchStore.mjs";
import { ResearchService } from "../electron/researchService.mjs";
import { claimSchedule } from "../electron/researchRunner.mjs";
import { proposeHermesTask, claimVisibleProposal, resetHermesGate } from "../electron/hermesGate.mjs";
import { nativeResourcePath } from "../electron/resourcePaths.mjs";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-research-test-"));
  const store = new ResearchStore(path.join(root, "state"));
  const spec = normalizeResearch({ topic: "A research question", minutes: 1, outputDirectory: path.join(root, "output") }, { sessionId: "chat", route: { provider: "evren", modelId: "qwen3.8-flash-next" } });
  return { root, store, spec };
}

test("research input, source URLs and schedule data are bounded and structured", () => {
  const { spec } = setup();
  assert.equal(spec.minutes, 1);
  assert.throws(() => normalizeResearch({ ...spec, minutes: 121 }), /Süre/);
  assert.throws(() => normalizeSchedule({ kind: "weekly", time: "25:00" }), /saat/);
  assert.throws(() => normalizeSchedule({ kind: "weekly", time: "09:00", day: -1 }), /günü/);
  assert.equal(canonicalUrl("https://example.com/jobs?id=1&utm_source=x#section"), "https://example.com/jobs?id=1");
  assert.equal(canonicalUrl("https://secret:password@example.com/"), null);
  assert.equal(canonicalUrl("file:///private"), null);
});

test("scheduled runs reject overlap and replay of the same occurrence", () => {
  const { store, spec } = setup();
  const schedule = { id: "schedule_abcdef", spec };
  store.save(schedule);
  const first = claimSchedule(store, schedule, "2026-10-29T09:00:00+03:00"); assert.equal(first.skipped, undefined);
  assert.equal(claimSchedule(store, schedule, "another").reason, "already_running");
  first.release();
  assert.equal(claimSchedule(store, schedule, "2026-10-29T09:00:00+03:00").reason, "duplicate_occurrence");
  const next = claimSchedule(store, schedule, "2026-10-30T09:00:00+03:00"); assert.equal(next.skipped, undefined); next.release();
});

test("orphaned runs are interrupted and research metadata remains bound to approval", () => {
  const { store, spec } = setup(); const state = store.create(spec);
  writeJson(store.file(state.id), { ...state, pid: 2147483647, updatedAt: Date.now() - 60000 });
  store.reconcile(); assert.equal(store.get(state.id).status, "interrupted");
  resetHermesGate();
  const staged = proposeHermesTask("Research", "normal", { sessionId: "chat", researchSpec: spec });
  const approved = claimVisibleProposal({ sessionId: "chat", proposalId: staged.proposal.id });
  assert.equal(approved.proposal.researchSpec.topic, spec.topic);
  assert.equal(claimVisibleProposal({ sessionId: "chat", proposalId: staged.proposal.id }).ok, false);
});

test("scheduled notification stays quiet for unchanged success and still reports errors", () => {
  const { store, root, spec } = setup(), notices = [], updates = [];
  const service = new ResearchService({ root: store.root, outputRoot: spec.outputDirectory, repoRoot: root, scheduler: {}, emit: (event) => updates.push(event), notify: (state) => notices.push(state.id) });
  try {
    for (const [index, status, newCount] of [[1, "completed", 0], [2, "completed", 1], [3, "failed", 0]]) {
      const run = store.create(spec, { scheduleId: "schedule_abcdef" });
      store.save({ ...run, status, newCount, finishedAt: Date.now() });
      service.poll();
    }
    assert.equal(notices.length, 2); assert.ok(updates.length);
    service.poll(); assert.equal(notices.length, 2);
  } finally { service.close(); }
});

test("ASAR helpers resolve to physical unpacked files", () => {
  assert.equal(nativeResourcePath(path.join("app", "app.asar"), "sidecar", "research_scheduler.py"), path.join("app", "app.asar.unpacked", "sidecar", "research_scheduler.py"));
  assert.equal(nativeResourcePath("app", "sidecar", "brain_provider.py"), path.join("app", "sidecar", "brain_provider.py"));
});

test("atomic research writes tolerate a Windows rename lock without removing the previous record", { skip: process.platform !== "win32" }, (t) => {
  const { root } = setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "atomic.json");
  writeJson(file, { revision: 1 });
  const rename = fs.renameSync;
  let attempts = 0;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === file && ++attempts <= 2) {
      assert.deepEqual(readJson(file), { revision: 1 });
      throw Object.assign(new Error("temporary lock"), { code: "EPERM" });
    }
    return rename(from, to);
  });
  writeJson(file, { revision: 2 });
  assert.equal(attempts, 3);
  assert.deepEqual(readJson(file), { revision: 2 });
});

test("scheduled editing retains its pinned model, language and owner chat", async () => {
  const { store, spec, root } = setup(); const pinned = { ...spec, language: "en", schedule: normalizeSchedule({ kind: "daily", time: "09:00" }) };
  const id = "schedule_abc123"; store.save({ id, spec: pinned, nativeId: "native-test", script: "owned.py", name: "old", createdAt: Date.now() });
  let launcherUpdated = false;
  const scheduler = { home: () => root, installLauncher: (jobId, stateFile, launch) => { assert.equal(jobId, id); assert.equal(stateFile, store.file(id)); assert.equal(launch.executable, process.execPath); launcherUpdated = true; }, call: async (request) => request.action === "list" ? { success: true, jobs: [{ job_id: "native-test", enabled: true }] } : { success: true, available: true, job: { job_id: "native-test", enabled: true } } };
  const service = new ResearchService({ root: store.root, repoRoot: root, outputRoot: spec.outputDirectory, scheduler,
    getRoute: async () => ({ provider: "opencode", modelId: "other-model" }), prepareRoute: async () => {}, sessionId: () => "different-chat" });
  try {
    await service.updateSchedule(id, { ...pinned, topic: "Updated scope" });
    assert.equal(launcherUpdated, true);
    assert.deepEqual(service.store.get(id).spec.route, spec.route);
    assert.equal(service.store.get(id).spec.language, "en"); assert.equal(service.store.get(id).spec.sessionId, "chat");
  } finally { service.close(); }
});
