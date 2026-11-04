import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ResearchStore, normalizeResearch, readJson } from "../electron/researchStore.mjs";
import { ResearchService } from "../electron/researchService.mjs";
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

test("20,000-character purposes survive creation and schedule edits; overflow never changes saved work", async (t) => {
  const { service, store, spec, launched, prepared, schedulerCalls } = setup(t);
  const purpose = "Şirket, görüntü işleme ve gömülü yapay zekâ.\n".repeat(500).slice(0, 19_990) + "SON-AMAÇ!!";
  assert.equal(purpose.length, 20_000);
  const selected = await service.specification({ ...spec, purpose });
  await service.start(selected);
  assert.equal(readJson(store.file(launched[0].id)).spec.purpose, purpose);
  const job = await service.createSchedule({ ...selected, schedule });
  assert.equal(readJson(store.file(job.id)).spec.purpose, purpose);
  const edited = purpose.slice(0, -10) + "YENİ-AMAÇ!";
  await service.updateSchedule(job.id, { ...selected, purpose: edited, schedule });
  const before = readJson(store.file(job.id));
  assert.equal(before.spec.purpose, edited);
  const preparedCount = prepared.length, callCount = schedulerCalls.length;
  await assert.rejects(service.specification({ ...spec, purpose: purpose + "!" }), /en fazla 20000 karakter/);
  await assert.rejects(service.updateSchedule(job.id, { ...selected, purpose: purpose + "!", schedule }), /en fazla 20000 karakter/);
  assert.deepEqual(readJson(store.file(job.id)), before);
  assert.equal(prepared.length, preparedCount);
  assert.equal(schedulerCalls.length, callCount);
  assert.equal((await service.specification({ ...spec, purpose: "" })).purpose, "");
  assert.equal((await service.specification({ ...spec, purpose: "Eski kısa amaç" })).purpose, "Eski kısa amaç");
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
