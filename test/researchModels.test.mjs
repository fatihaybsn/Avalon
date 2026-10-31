import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { ResearchStore, normalizeResearch, readJson } from "../electron/researchStore.mjs";
import { ResearchService } from "../electron/researchService.mjs";
import { ResearchEngine } from "../electron/researchEngine.mjs";
import { runEntry } from "../electron/researchRunner.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";
import { brainProviderSlug } from "../electron/brainReasoning.mjs";
import { proposeHermesTask, claimVisibleProposal, resetHermesGate } from "../electron/hermesGate.mjs";

const chatRoute = { provider: "evren", modelId: "qwen3.8-flash-next", reasoning: "disabled" };
const researchRoute = { provider: "opencode", modelId: "beam-free", reasoning: "high" };
const schedule = { kind: "daily", time: "09:00", day: 6, timezone: "Europe/Istanbul" };

function setup(t, prepare = async () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-research-models-"));
  const store = new ResearchStore(path.join(root, "state"));
  const spec = normalizeResearch({ topic: "Research model isolation", outputDirectory: path.join(root, "output"), minutes: 1 }, { sessionId: "owner", route: chatRoute });
  const prepared = [], launched = [], schedulerCalls = [];
  let current = { ...chatRoute };
  const scheduler = { home: () => root, installLauncher: () => "launcher.py", call: async (request) => {
    schedulerCalls.push(request);
    return { success: true, available: true, job: { job_id: "native-job" }, jobs: [{ job_id: "native-job", enabled: true }] };
  } };
  const service = new ResearchService({ root: store.root, repoRoot: root, outputRoot: spec.outputDirectory, scheduler,
    getRoute: async () => ({ ...current }), getLanguage: () => "tr", sessionId: () => "owner",
    prepareRoute: async (route) => { prepared.push({ ...route }); await prepare(route); } });
  service.launch = (state) => launched.push(state);
  t.after(() => { service.close(); resetHermesGate(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, spec, service, prepared, launched, schedulerCalls, setChat: (route) => { current = route; } };
}

// Real Hermes transport with an offline RPC peer: records the actual session.create wire.
function nativeBackends() {
  const calls = [];
  let serial = 0;
  return { calls, factory: async () => {
    const id = `worker-${++serial}`, client = new EventEmitter();
    client.close = () => {};
    client.request = async (method, params) => {
      calls.push({ method, params });
      if (method === "session.create") return { session_id: id, stored_session_id: id };
      if (method === "tools.show") return { sections: [{ tools: [{ name: "web_search" }, { name: "web_extract" }] }] };
      if (method === "prompt.submit") setTimeout(() => {
        let result;
        if (params.text.includes("Plan a targeted")) result = { questions: ["A", "B", "C"], criteria: ["original evidence"] };
        else if (params.text.includes("Synthesize")) result = { report: "Verified research report", resolved: true, gaps: [] };
        else {
          const url = `https://source-${id}.example/document`, quote = "the documented result is supported by original evidence";
          client.emit("event", { session_id: id, type: "tool.complete", payload: { name: "web_extract", result: { url, content: `${quote}. `.repeat(5) } } });
          result = { findings: [{ text: "Documented finding", url, quote }], resolved: true, gaps: [], inaccessible: [] };
        }
        client.emit("event", { session_id: id, type: "message.complete", payload: { status: "complete", text: JSON.stringify(result) } });
      }, 5);
      return { status: "ok" };
    };
    const transport = new HermesInteractiveTransport({ client, getRoute: () => { throw new Error("A research turn must carry its pinned route"); } });
    return { client, transport };
  } };
}

test("research defaults capture the active route and explicit selection never changes the chat", async (t) => {
  const { service, spec, prepared, setChat } = setup(t);
  const defaults = await service.formDefaults();
  assert.deepEqual(defaults.route, chatRoute);
  const selected = { ...researchRoute };
  const explicit = await service.specification({ ...spec, route: selected });
  selected.reasoning = "low";
  assert.deepEqual(explicit.route, researchRoute);
  assert.deepEqual((await service.formDefaults()).route, chatRoute);
  const { route: _route, ...legacy } = spec;
  assert.deepEqual((await service.specification(legacy)).route, chatRoute);
  assert.deepEqual(prepared, [], "Form defaults and validation must not apply a model");
  setChat({ provider: "evren", modelId: "glm-5.3" });
  assert.deepEqual(explicit.route, researchRoute);
});

test("invalid research routes are rejected before preparing, scheduling or launching", async (t) => {
  const { service, spec, store, prepared, launched, schedulerCalls } = setup(t);
  for (const route of [null, {}, { provider: "opencode", modelId: "unknown" }, { provider: "opencode", modelId: "big-pickle", reasoning: "high" }]) {
    await assert.rejects(service.specification({ ...spec, route }));
    await assert.rejects(service.start({ ...spec, route }));
    await assert.rejects(service.createSchedule({ ...spec, route, schedule }));
  }
  assert.deepEqual(prepared, []); assert.deepEqual(launched, []); assert.deepEqual(schedulerCalls, []);
  assert.deepEqual(store.list(), []);
});

test("research model preparation failures cannot create a run or schedule", async (t) => {
  const { service, spec, store, launched, schedulerCalls } = setup(t, async () => { throw new Error("Provider unavailable"); });
  await assert.rejects(service.start({ ...spec, route: researchRoute }), /Provider unavailable/);
  await assert.rejects(service.createSchedule({ ...spec, route: researchRoute, schedule }), /Provider unavailable/);
  assert.deepEqual(launched, []); assert.deepEqual(schedulerCalls, []);
  assert.deepEqual(store.list(), []); assert.deepEqual(store.list("schedule_"), []);
  assert.deepEqual((await service.formDefaults()).route, chatRoute);
});

test("a confirmed research proposal retains its route after a chat model change", async (t) => {
  const { service, spec, prepared, launched, setChat } = setup(t);
  const selected = await service.specification({ ...spec, route: researchRoute });
  resetHermesGate();
  const staged = proposeHermesTask("Research using the selected model", "normal", { sessionId: "owner", researchSpec: selected });
  selected.route.reasoning = "low";
  setChat({ provider: "evren", modelId: "glm-5.3", reasoning: "high" });
  const approved = claimVisibleProposal({ sessionId: "owner", proposalId: staged.proposal.id });
  assert.equal(approved.ok, true);
  await service.start(approved.proposal.researchSpec);
  assert.deepEqual(prepared, [researchRoute]); assert.deepEqual(launched[0].spec.route, researchRoute);
});

test("schedule edits preserve omitted routes and apply explicit routes only to future runs", async (t) => {
  const { service, store, spec, prepared } = setup(t);
  const created = await service.createSchedule({ ...spec, route: researchRoute, schedule });
  assert.match(created.modelLabel, /düşünme: Yüksek/);
  const saved = store.get(created.id);
  const running = store.create(saved.spec, { scheduleId: saved.id });
  const { route: _route, ...legacyEdit } = saved.spec;
  await service.updateSchedule(saved.id, { ...legacyEdit, topic: "Changed topic" });
  assert.deepEqual(store.get(saved.id).spec.route, researchRoute);
  await service.updateSchedule(saved.id, { ...legacyEdit, route: chatRoute });
  assert.deepEqual(store.get(saved.id).spec.route, chatRoute);
  assert.deepEqual(running.spec.route, researchRoute);
  assert.deepEqual(store.get(running.id).spec.route, researchRoute);
  const before = store.get(saved.id);
  await assert.rejects(service.updateSchedule(saved.id, { ...legacyEdit, route: { provider: "evren", modelId: "unknown" } }));
  assert.deepEqual(store.get(saved.id).spec, before.spec);
  assert.deepEqual(prepared, [researchRoute, researchRoute, chatRoute]);
});

test("schedule preparation failure retains its previous pinned selection", async (t) => {
  const { service, store, spec, schedulerCalls } = setup(t, async (route) => { if (route.provider === "opencode") throw new Error("Missing credentials"); });
  const job = await service.createSchedule({ ...spec, schedule });
  const before = store.get(job.id), callCount = schedulerCalls.length;
  await assert.rejects(service.updateSchedule(job.id, { ...before.spec, route: researchRoute }), /Missing credentials/);
  assert.deepEqual(store.get(job.id).spec, before.spec);
  assert.equal(schedulerCalls.length, callCount);
});

test("parallel research engines pin different thinking levels on every native worker session", async (t) => {
  const { store, spec } = setup(t);
  const routes = [chatRoute, { ...chatRoute, reasoning: "high" }, researchRoute];
  const peers = routes.map(() => nativeBackends());
  const engines = routes.map((route, index) => new ResearchEngine({ store, state: store.create({ ...spec, route }), createBackend: peers[index].factory }));
  const results = await Promise.all(engines.map((engine) => engine.run()));
  results.forEach((result) => assert.equal(result.status, "completed"));
  peers.forEach((peer, index) => {
    const sessions = peer.calls.filter((call) => call.method === "session.create");
    assert.equal(sessions.length, 6, "Planning, collection, verification and synthesis must all be pinned");
    for (const { params } of sessions) {
      assert.equal(params.model, routes[index].modelId); assert.equal(params.provider, brainProviderSlug(routes[index]));
    }
    assert.equal(peer.calls.some((call) => call.method === "config.set"), false, "No chat/global model changes are needed");
  });
});

test("headless scheduled runs validate saved routes and use their model and reasoning without UI", async (t) => {
  const { root, store, spec } = setup(t);
  const savedEnv = { ...process.env };
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });
  const runtime = { stateRoot: store.root, repoRoot: root, env: { IRIS_TEST_HOOKS: "1", IRIS_TEST_CONFIG_PATH: path.join(root, "test.env") } };
  const id = "schedule_abcdef1234", peer = nativeBackends();
  store.save({ id, spec: { ...spec, route: researchRoute, runtime, schedule } });
  const result = await runEntry(["--schedule", store.file(id), "--occurrence", "first"], { createBackend: peer.factory });
  assert.equal(result.status, "completed"); assert.deepEqual(result.spec.route, researchRoute);
  assert.ok(peer.calls.filter((call) => call.method === "session.create").every((call) => call.params.provider === brainProviderSlug(researchRoute)));
  store.save({ id, spec: { ...spec, route: { provider: "evren", modelId: "removed-model" }, runtime, schedule } });
  await assert.rejects(runEntry(["--schedule", store.file(id), "--occurrence", "invalid"], { createBackend: peer.factory }), /desteklenen/);
  const failed = store.list().find((run) => run.occurrence === "invalid");
  assert.equal(failed.status, "failed"); assert.match(failed.error, /desteklenen/);
  assert.equal(fs.existsSync(store.file(id, "active.lock")), false);
  const legacyId = "schedule_abcdef5678", legacyPeer = nativeBackends();
  store.save({ id: legacyId, spec: { ...spec, route: { provider: "evren", modelId: "qwen3.8-flash-next" }, runtime, schedule } });
  assert.equal((await runEntry(["--schedule", store.file(legacyId), "--occurrence", "legacy"], { createBackend: legacyPeer.factory })).status, "completed");
  assert.ok(legacyPeer.calls.filter((call) => call.method === "session.create").every((call) => call.params.provider === "iris-evren"));
});
