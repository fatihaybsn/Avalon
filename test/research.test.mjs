import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { ResearchStore, normalizeResearch, normalizeSchedule, canonicalUrl, readJson, writeJson } from "../electron/researchStore.mjs";
import { ResearchEngine, extractedDocuments, assertResearchTools } from "../electron/researchEngine.mjs";
import { ResearchService } from "../electron/researchService.mjs";
import { claimSchedule } from "../electron/researchRunner.mjs";
import { proposeHermesTask, claimVisibleProposal, resetHermesGate } from "../electron/hermesGate.mjs";
import { ResearchLeases } from "../electron/researchLeases.mjs";
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
  assert.throws(() => assertResearchTools({ sections: [{ tools: [{ name: "web_search" }, { name: "web_extract" }, { name: "delegate_task" }] }] }), /araç/);
});

test("read sources come from actual extraction results, not snippets, errors or model claims", () => {
  assert.deepEqual(extractedDocuments({ data: { web: [{ url: "https://example.com", description: "Search snippet" }] } }), []);
  assert.deepEqual(extractedDocuments({ results: [{ url: "https://example.com", content: "a".repeat(100), error: "forbidden" }] }), []);
  assert.equal(extractedDocuments({ results: [{ url: "https://example.com", content: "real content ".repeat(20) }] }).length, 1);
  assert.equal(extractedDocuments({ results: [{ url: "https://example.com", title: "Page not found", content: "404 ".repeat(100) }] }).length, 0);
  assert.equal(extractedDocuments({ results: [{ url: "https://linkedin.com/login", title: "LinkedIn Login", content: "Sign in ".repeat(100) }] }).length, 0);
});

test("browser snapshots retain their real URL per worker and login pages require access", () => {
  const { store, spec } = setup(), engine = new ResearchEngine({ store, state: store.create(spec) });
  try {
    engine.collect({ name: "browser_navigate", result: { success: true, url: "https://first.example/page", title: "First page" } }, "worker-a");
    engine.collect({ name: "browser_navigate", result: { success: true, url: "https://second.example/page", title: "Second page" } }, "worker-b");
    engine.collect({ name: "browser_snapshot", result: { success: true, snapshot: "First page original documented content. ".repeat(8) } }, "worker-a");
    assert.equal(engine.sources.size, 1);
    assert.match(engine.sources.get("https://first.example/page").text, /First page/);
    engine.collect({ name: "browser_navigate", result: { success: true, url: "https://linkedin.com/login", title: "LinkedIn Login", snapshot: "Please sign in to continue ".repeat(8) } }, "worker-b");
    assert.equal(engine.sources.size, 1); assert.equal(engine.access.length, 1);
    engine.collect({ name: "browser_click", result: { success: true } }, "worker-a");
    engine.collect({ name: "browser_snapshot", result: { success: true, snapshot: "Unknown redirect should not be attributed to the previous page. ".repeat(8) } }, "worker-a");
    assert.doesNotMatch(engine.sources.get("https://first.example/page").text, /Unknown redirect/);
  } finally { engine.leases.close(); }
});

function fakeBackends({ unverified = false, fail = false, sourceUrls, accessFailures = [], inaccessible = [], reportPatch = {}, failSessions = [], readable = true } = {}) {
  let serial = 0, active = 0, maximum = 0, verificationTurns = 0;
  const factory = async () => {
    const number = ++serial, id = `session-${number}`;
    const client = new EventEmitter();
    client.request = async () => ({ sections: [{ tools: [{ name: "web_search" }, { name: "web_extract" }, { name: "read_file" }] }] });
    const transport = new EventEmitter(); transport.runs = new Map();
    transport.createSession = async () => ({ id, liveSessionId: id }); transport.close = () => {}; transport.deleteSession = async () => {};
    transport.stop = async (runId) => { const run = transport.runs.get(runId); if (run) run.status = "cancelled"; };
    transport.submit = async ({ task }) => {
      if (task.includes("Find independent corroboration")) verificationTurns++;
      const runId = `run-${number}`; transport.runs.set(runId, { runId, status: "running" });
      active++; maximum = Math.max(maximum, active);
      setTimeout(() => {
        let result;
        if (task.includes("Plan a targeted")) result = { questions: ["A", "B", "C"], criteria: ["three original sources"] };
        else if (task.includes("Synthesize")) result = { report: "# Verified test report\n\nEvidence is attached.", resolved: true, gaps: [], ...reportPatch };
        else {
          const text = `Source number ${number}: the documented result is confirmed by original evidence. `.repeat(4);
          const url = sourceUrls ? sourceUrls[(number - 2) % sourceUrls.length] : `https://source-${number}.example/document`;
          if (!fail && !failSessions.includes(number)) client.emit("event", { session_id: id, type: "tool.complete", payload: { name: "web_extract", result: { results: [
            ...(readable ? [{ url, title: `Source ${number}`, content: text }] : []),
            ...accessFailures.map((failure) => typeof failure === "string" ? { url: failure, statusCode: 403, error: "forbidden" } : failure),
          ] } } });
          result = { findings: [{ text: "The observed result", url, quote: unverified ? "invented quotation never retrieved" : "the documented result is confirmed by original evidence" }], resolved: true, gaps: [], inaccessible };
        }
        active--; transport.runs.get(runId).status = (fail || failSessions.includes(number)) && !task.includes("Plan a targeted") ? "failed" : "completed";
        transport.emit("complete", { status: transport.runs.get(runId).status, output: JSON.stringify(result), error: fail ? "429 quota" : "" });
      }, 5);
      return { run_id: runId };
    };
    return { client, transport };
  };
  return { factory, maximum: () => maximum, verificationTurns: () => verificationTurns };
}

const accessSourceUrls = ["https://first.example/a", "https://second.example/b", "https://first.example/c"];
for (const { name, options = {}, specPatch = {}, status = "completed", warning } of [
  { name: "one optional inaccessible site", options: { accessFailures: ["https://blocked.example/a"] }, warning: "https://blocked.example/a" },
  { name: "two optional inaccessible sites", options: { accessFailures: ["https://blocked.example/a", "https://other.example/b"] } },
  { name: "three inaccessible sites", options: { accessFailures: ["https://blocked.example/a", "https://other.example/b", "https://third.example/c"] }, status: "partial", warning: "3 farklı sitede" },
  { name: "repeated pages and subdomains on one inaccessible Turkish site", options: { accessFailures: ["https://www.blocked.com.tr/a", "https://news.blocked.com.tr/b", "https://blocked.com.tr/c", "https://blocked.com.tr/c"] } },
  { name: "distinct Turkish sites crossing the limit", options: { accessFailures: ["https://first.com.tr/a", "https://second.com.tr/b", "https://third.com.tr/c"] }, status: "partial" },
  { name: "a required inaccessible source from worker notes", options: { inaccessible: [{ url: "https://essential.example/a", reason: "Primary evidence missing", required: true }] }, status: "partial", warning: "gerekli kaynağa" },
  { name: "a required source reported during synthesis", options: { reportPatch: { inaccessible: [{ url: "https://essential.example/a", reason: "Primary evidence missing", required: true }] } }, status: "partial" },
  { name: "an assigned site with no readable source", options: { accessFailures: ["https://assigned.example/a"] }, specPatch: { sites: ["assigned.example"] }, status: "partial" },
  { name: "an optional failed page on an otherwise covered assigned site", options: { accessFailures: ["https://first.example/extra"] }, specPatch: { sites: ["first.example"] } },
  { name: "an explicitly assigned unreadable page on a covered site", options: { accessFailures: ["https://first.example/required"] }, specPatch: { sites: ["https://first.example/required"] }, status: "partial" },
  { name: "an access failure recovered by a successful extraction", options: { accessFailures: [accessSourceUrls[0], "https://blocked.example/a", "https://other.example/b"] } },
  { name: "a recovered required source", options: { inaccessible: [{ url: accessSourceUrls[0], reason: "Earlier failure", required: true }] } },
  { name: "a legacy URL access warning", options: { inaccessible: ["https://blocked.example/a: access denied"] }, warning: "access denied" },
  { name: "an unidentifiable access problem", options: { inaccessible: ["Sign-in is required for the primary source"] }, status: "partial" },
  { name: "unverified evidence with optional access failures", options: { accessFailures: ["https://blocked.example/a"], unverified: true }, status: "partial" },
  { name: "a single failed worker despite sufficient other sources", options: { failSessions: [2] }, status: "partial" },
  { name: "unanswered questions despite resolved wording", options: { reportPatch: { resolved: true, gaps: ["The main question remains unanswered"] } }, status: "partial" },
  { name: "an explicitly unresolved report", options: { reportPatch: { resolved: false } }, status: "partial" },
  { name: "insufficient independent coverage", options: { sourceUrls: ["https://first.example/a", "https://first.example/b", "https://first.example/c"], accessFailures: ["https://blocked.example/a"] }, status: "partial" },
  { name: "normal research with insufficient coverage for access tolerance", options: { sourceUrls: ["https://first.example/a"], accessFailures: ["https://blocked.example/a"] }, specPatch: { mode: "normal" }, status: "partial" },
  { name: "normal research without access problems", options: { sourceUrls: ["https://first.example/a"] }, specPatch: { mode: "normal" } },
  { name: "a 404 page reported without a status code", options: { accessFailures: [{ url: "https://blocked.example/a", title: "Page not found", content: "Not a usable source. ".repeat(10) }] }, warning: "https://blocked.example/a" },
  { name: "no readable sources with access problems", options: { readable: false, accessFailures: ["https://blocked.example/a"] }, status: "needs_access" },
]) {
  test(`research access tolerance handles ${name}`, async () => {
    const { root, store, spec } = setup(), state = store.create({ ...spec, ...specPatch });
    try {
      const result = await new ResearchEngine({ store, state, createBackend: fakeBackends({ sourceUrls: accessSourceUrls, ...options }).factory }).run();
      assert.equal(result.status, status);
      if (warning) {
        assert.ok(result.limitations.some((item) => item.includes(warning)));
        assert.ok(fs.readFileSync(path.join(state.outputPath, "report.md"), "utf8").includes(warning));
      }
      assert.equal(readJson(path.join(state.outputPath, "summary.json")).status, status);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test("scheduled access tolerance advances only completed evidence and retains earlier source baselines", async () => {
  const { root, store, spec } = setup(), scheduleId = "schedule_abcd1234";
  const seenFile = store.file(scheduleId, "seen.json"), prior = { "https://previous.example/a": "previous-hash" };
  writeJson(seenFile, prior);
  try {
    let completedBaseline;
    for (const [index, accessFailures] of [
      ["https://blocked.example/a"],
      ["https://blocked.example/a"],
      ["https://blocked.example/a", "https://other.example/b", "https://third.example/c"],
    ].entries()) {
      const state = store.create(spec, { scheduleId });
      const sourceUrls = index === 2 ? accessSourceUrls.map((url) => `${url}/new`) : accessSourceUrls;
      const result = await new ResearchEngine({ store, state, createBackend: fakeBackends({ sourceUrls, accessFailures }).factory }).run();
      assert.equal(result.status, index === 2 ? "partial" : "completed");
      assert.equal(result.newCount, index === 1 ? 0 : 3);
      if (index === 0) completedBaseline = readJson(seenFile);
      assert.deepEqual(readJson(seenFile), completedBaseline);
      assert.equal(readJson(seenFile)["https://previous.example/a"], prior["https://previous.example/a"]);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("deep research bounds parallel workers, verifies quotes and writes complete artifacts", async () => {
  const { store, spec } = setup(), state = store.create(spec), fake = fakeBackends();
  const result = await new ResearchEngine({ store, state, createBackend: fake.factory }).run();
  assert.equal(result.status, "completed"); assert.ok(fake.maximum() <= 3); assert.equal(fake.maximum(), 3);
  assert.ok(result.sourceCount >= 3);
  for (const name of ["plan.json", "sources.json", "findings.json", "evidence.json", "report.md", "summary.json"]) assert.ok(fs.existsSync(path.join(state.outputPath, name)), name);
  assert.ok(readJson(path.join(state.outputPath, "evidence.json")).every((claim) => claim.verified));
  assert.equal(store.get(state.id).sessionId, "chat");
});

for (const { name, urls, covered } of [
  { name: "different Turkish sites", urls: ["https://www.hurriyet.com.tr/a", "https://milliyet.com.tr/b", "https://hurriyet.com.tr/c"], covered: true },
  { name: "different UK sites", urls: ["https://www.bbc.co.uk/a", "https://reuters.co.uk/b", "https://bbc.co.uk/c"], covered: true },
  { name: "subdomains of one Turkish site", urls: ["https://www.hurriyet.com.tr/a", "https://ekonomi.hurriyet.com.tr/b", "https://hurriyet.com.tr/c"], covered: false },
  { name: "subdomains of one ordinary site", urls: ["https://www.example.com/a", "https://news.example.com/b", "https://example.com/c"], covered: false },
  { name: "independent hosted sites", urls: ["https://first.blogspot.com/a", "https://second.blogspot.com/b", "https://first.blogspot.com/c"], covered: true },
  { name: "a public suffix wildcard", urls: ["https://first.foo.ck/a", "https://second.foo.ck/b", "https://first.foo.ck/c"], covered: true },
  { name: "a public suffix exception", urls: ["https://www.ck/a", "https://news.www.ck/b", "https://www.ck/c"], covered: false },
  { name: "different IP hosts", urls: ["https://192.0.2.1/a", "https://198.51.2.1/b", "https://192.0.2.1/c"], covered: true },
  { name: "only two pages across two sites", urls: ["https://hurriyet.com.tr/a", "https://milliyet.com.tr/b"], covered: false },
]) {
  test(`deep research coverage handles ${name}`, async () => {
    const { root, store, spec } = setup(), state = store.create(spec), fake = fakeBackends({ sourceUrls: urls });
    try {
      const result = await new ResearchEngine({ store, state, createBackend: fake.factory }).run();
      assert.equal(result.status, covered ? "completed" : "partial");
      assert.equal(result.limitations.includes("Derin araştırma için yeterli bağımsız kaynak kapsamına ulaşılamadı."), !covered);
      // Sufficient coverage must end verification after its first resolved response.
      assert.equal(fake.verificationTurns(), covered ? 1 : 2);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test("invented evidence and provider failures cannot become successful research", async () => {
  for (const options of [{ unverified: true }, { fail: true }]) {
    const { store, spec } = setup(), state = store.create(spec);
    const result = await new ResearchEngine({ store, state, createBackend: fakeBackends(options).factory }).run();
    assert.notEqual(result.status, "completed"); assert.ok(fs.existsSync(path.join(state.outputPath, "report.md")));
    if (options.unverified) assert.ok(readJson(path.join(state.outputPath, "evidence.json")).every((claim) => !claim.verified));
  }
});

test("cancellation preserves evidence and never reports completion", async () => {
  const { store, spec } = setup(), state = store.create(spec);
  const engine = new ResearchEngine({ store, state, createBackend: fakeBackends().factory });
  engine.cancelled = true;
  assert.equal((await engine.run()).status, "cancelled");
  assert.ok(fs.existsSync(path.join(state.outputPath, "report.md")));
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

test("worker capacity is shared across independent research controllers", () => {
  const { store } = setup(); const a = new ResearchLeases(store.root), b = new ResearchLeases(store.root);
  const releases = [];
  try {
    releases.push(a.tryAcquire(Date.now() + 60000), a.tryAcquire(Date.now() + 60000), b.tryAcquire(Date.now() + 60000));
    assert.ok(releases.every(Boolean)); assert.equal(b.tryAcquire(Date.now() + 60000), null);
    releases.pop()(); releases.push(b.tryAcquire(Date.now() + 60000)); assert.ok(releases.at(-1));
  } finally { releases.forEach((release) => release?.()); a.close(); b.close(); }
});

test("a completed run with unchanged source evidence produces zero new findings", async () => {
  const { store, spec } = setup(); const scheduleId = "schedule_abc123"; store.save({ id: scheduleId, spec });
  for (let i = 0; i < 2; i++) {
    const state = store.create(spec, { scheduleId });
    const result = await new ResearchEngine({ store, state, createBackend: fakeBackends().factory }).run();
    assert.equal(result.status, "completed");
    assert.equal(result.newCount, i === 0 ? result.sourceCount : 0);
    assert.equal(result.changedCount, 0);
  }
});

test("an expired work budget is partial and cannot become completed from model wording", async () => {
  const { store, spec } = setup(); const state = store.create(spec); let clock = Date.now();
  const fake = fakeBackends(); const engine = new ResearchEngine({ store, state, now: () => clock, createBackend: async () => {
    const backend = await fake.factory(); const original = backend.transport.submit;
    backend.transport.submit = async (input) => { const result = await original(input); clock += 40000; return result; };
    return backend;
  } });
  const result = await engine.run(); assert.notEqual(result.status, "completed"); assert.ok(result.finishedAt);
});

test("ASAR helpers resolve to physical unpacked files", () => {
  assert.equal(nativeResourcePath(path.join("app", "app.asar"), "sidecar", "research_scheduler.py"), path.join("app", "app.asar.unpacked", "sidecar", "research_scheduler.py"));
  assert.equal(nativeResourcePath("app", "sidecar", "brain_provider.py"), path.join("app", "sidecar", "brain_provider.py"));
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
