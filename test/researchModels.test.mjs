import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { ResearchStore, normalizeResearch, readJson } from "../electron/researchStore.mjs";
import { ResearchService } from "../electron/researchService.mjs";
import { ResearchEngine, RESEARCH_AUTONOMY_POLICY } from "../electron/researchEngine.mjs";
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
function nativeBackends(onPrompt) {
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
        const complete = () => {
          let result;
          if (params.text.includes("Plan a targeted")) result = { questions: ["A", "B", "C"], criteria: ["original evidence"] };
          else if (params.text.includes("Synthesize")) result = { report: "Verified research report", resolved: true, gaps: [] };
          else {
            const url = `https://source-${id}.example/document`, quote = "the documented result is supported by original evidence";
            client.emit("event", { session_id: id, type: "tool.complete", payload: { name: "web_extract", result: { url, content: `${quote}. `.repeat(5) } } });
            result = { findings: [{ text: "Documented finding", url, quote }], resolved: true, gaps: [], inaccessible: [] };
          }
          client.emit("event", { session_id: id, type: "message.complete", payload: { status: "complete", text: JSON.stringify(result) } });
        };
        if (!onPrompt?.({ client, params, id, calls, complete })) complete();
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

for (const scheduled of [false, true]) {
  test(`20,000-character purpose reaches every native research stage (${scheduled ? "scheduled" : "immediate"})`, async (t) => {
    const { root, store, spec } = setup(t), peer = nativeBackends();
    const savedEnv = { ...process.env };
    t.after(() => { for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });
    const purpose = "ğ".repeat(19_990) + "SON-AMAÇ!!";
    const runtime = { stateRoot: store.root, repoRoot: root, env: { IRIS_TEST_HOOKS: "1", IRIS_TEST_CONFIG_PATH: path.join(root, "test.env") } };
    const savedSpec = { ...normalizeResearch({ ...spec, purpose }), runtime };
    const state = scheduled ? { id: "schedule_abcdef1234", spec: { ...savedSpec, schedule } } : store.create(savedSpec);
    if (scheduled) store.save(state);
    const args = scheduled ? ["--schedule", store.file(state.id), "--occurrence", "long-purpose"] : ["--run", store.file(state.id)];
    const result = await runEntry(args, { createBackend: peer.factory });
    assert.equal(result.status, "completed");
    assert.equal(readJson(path.join(result.outputPath, "summary.json")).spec.purpose, purpose);
    const prompts = peer.calls.filter((call) => call.method === "prompt.submit").map((call) => call.params.text);
    for (const stage of ["Plan a targeted", "Assigned subquestion", "Find independent corroboration", "Synthesize"]) {
      assert.ok(prompts.some((prompt) => prompt.includes(stage)), `Missing stage: ${stage}`);
    }
    assert.ok(prompts.every((prompt) => prompt.includes(`Purpose: ${purpose}\nPreferred sites:`)), "No stage may truncate the purpose");
  });
}

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

function askClarification({ client, id, complete }, { batch = false, repeat = false } = {}) {
  let count = 0;
  if (batch) {
    client.respondServerRequest = (responseId, result, error) => {
      if (result?.outcome === "submitted") complete();
      client.batchResponse = { responseId, result, error };
    };
    client.emit("server-request", { id: "batch", method: "clarify", params: { session_id: id, questions: [
      { qid: "scope", question: "Hangi araştırma kapsamı?", choices: ["Ankara", "İstanbul"] },
      { qid: "format", question: "Hangi rapor biçimi?" },
    ] } });
  } else {
    const original = client.request.bind(client);
    const ask = () => client.emit("event", { session_id: id, type: "clarify.request", payload: {
      request_id: `clarify-${++count}`, question: `Araştırmanın kapsamı ne olmalı? (${count})`, choices: ["Ankara", "İstanbul"],
    } });
    client.request = async (method, params) => {
      const result = await original(method, params);
      if (method === "clarify.respond") queueMicrotask(repeat ? ask : complete);
      return result;
    };
    ask();
  }
  return true;
}

for (const scheduled of [false, true]) {
  for (const [mode, stage] of [["deep", "Plan a targeted"], ["deep", "Assigned subquestion"], ["deep", "Find independent corroboration"], ["deep", "Synthesize"], ["normal", "Assigned subquestion"], ["normal", "Synthesize"]]) {
    test(`unattended clarification continues in ${mode} / ${stage} (${scheduled ? "scheduled" : "immediate"})`, async (t) => {
      const { root, store, spec } = setup(t);
      const savedEnv = { ...process.env };
      t.after(() => { for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });
      let asked = false;
      const peer = nativeBackends((context) => {
        if (asked || !context.params.text.includes(stage)) return false;
        asked = true;
        return askClarification(context);
      });
      const runtime = { stateRoot: store.root, repoRoot: root, env: { IRIS_TEST_HOOKS: "1", IRIS_TEST_CONFIG_PATH: path.join(root, "test.env") } };
      const state = scheduled ? { id: "schedule_abcdef1234", spec: { ...spec, mode, schedule, runtime } } : store.create({ ...spec, mode, runtime });
      if (scheduled) store.save(state);
      const result = await runEntry(scheduled ? ["--schedule", store.file(state.id), "--occurrence", "clarification"] : ["--run", store.file(state.id)], { createBackend: peer.factory });
      assert.equal(asked, true);
      assert.equal(result.status, "completed");
      assert.equal(result.interactionLog.length, 1);
      assert.match(result.interactionLog[0].question, /Araştırmanın kapsamı/);
      assert.equal(peer.calls.find((call) => call.method === "clarify.respond").params.answer, RESEARCH_AUTONOMY_POLICY);
      assert.equal(readJson(path.join(result.outputPath, "summary.json")).interactionLog[0].question, result.interactionLog[0].question);
      assert.match(fs.readFileSync(path.join(result.outputPath, "report.md"), "utf8"), /Araştırmanın kapsamı/);
      assert.doesNotMatch(result.output, /İnsan müdahalesi veya oturum gerekiyor/);
    });
  }
}

test("a native multi-question clarification group gets policy replies without inventing user choices", async (t) => {
  const { store, spec } = setup(t); let asked = false, clientWithBatch;
  const peer = nativeBackends((context) => {
    if (asked) return false;
    asked = true; clientWithBatch = context.client;
    return askClarification(context, { batch: true });
  });
  const result = await new ResearchEngine({ store, state: store.create(spec), createBackend: peer.factory }).run();
  assert.equal(result.status, "completed");
  assert.deepEqual(clientWithBatch.batchResponse.result, { answers: { scope: RESEARCH_AUTONOMY_POLICY, format: RESEARCH_AUTONOMY_POLICY }, outcome: "submitted" });
  assert.deepEqual(result.interactionLog.map((entry) => entry.question), ["Hangi araştırma kapsamı?", "Hangi rapor biçimi?"]);
});

for (const phase of ["Plan a targeted", "Assigned subquestion"]) {
  test(`repeated clarification stops only its turn and is never labelled access (${phase})`, async (t) => {
    const { store, spec } = setup(t); let asked = false;
    const peer = nativeBackends((context) => {
      if (asked || !context.params.text.includes(phase)) return false;
      asked = true; return askClarification(context, { repeat: true });
    });
    const result = await new ResearchEngine({ store, state: store.create(spec), createBackend: peer.factory }).run();
    assert.equal(result.status, "partial");
    assert.match(result.output, /yeniden kullanıcı yanıtı istendi/);
    assert.match(result.output, /Araştırmanın kapsamı ne olmalı\?/);
    assert.equal(peer.calls.filter((call) => call.method === "clarify.respond").length, 1);
    assert.ok(result.sourceCount >= 3, "Fallback questions and independent workers must preserve usable evidence");
  });
}

for (const type of ["approval", "secret", "sudo"]) {
  test(`unattended ${type} cannot grant access or persist secret request content`, async (t) => {
    const { store, spec } = setup(t); let requested = false;
    const peer = nativeBackends(({ client, params, id, calls }) => {
      if (requested || !params.text.includes("Assigned subquestion")) return false;
      requested = true;
      client.respondServerRequest = (responseId, result, error) => calls.push({ method: "server.response", responseId, result, error });
      client.emit("server-request", { id: "protected-request", method: type, params: {
        session_id: id, description: "Korumalı bir işlem için izin gerekli.", command: "DO_NOT_PERSIST_COMMAND_SECRET",
        prompt: "DO_NOT_PERSIST_SECRET_PROMPT", env_var: "DO_NOT_PERSIST_SECRET_NAME", choices: ["once", "session", "always", "deny"],
      } });
      return true;
    });
    const result = await new ResearchEngine({ store, state: store.create(spec), createBackend: peer.factory }).run();
    assert.equal(result.status, "partial"); assert.ok(result.sourceCount >= 3);
    const reply = peer.calls.find((call) => call.method === "server.response" && call.result);
    if (type === "approval") assert.deepEqual(reply.result, { choice: "deny" });
    else assert.equal(reply, undefined, "No secret or password value may be supplied");
    for (const file of [store.file(result.id), path.join(result.outputPath, "summary.json"), path.join(result.outputPath, "report.md")]) {
      assert.doesNotMatch(fs.readFileSync(file, "utf8"), /DO_NOT_PERSIST/);
    }
    assert.equal(result.interactionLog[0].type, type);
    if (type === "approval") assert.match(result.output, /Korumalı bir işlem/);
  });
}

for (const cancellation of [true, false]) {
  test(`an interaction response cannot hold a turn past ${cancellation ? "cancellation" : "its deadline"}`, async (t) => {
    const { store, spec } = setup(t);
    let entered, release;
    const responding = new Promise((resolve) => { entered = resolve; });
    const held = new Promise((resolve) => { release = resolve; });
    const peer = nativeBackends(({ client, id }) => {
      const original = client.request.bind(client);
      client.request = async (method, params) => {
        if (method === "clarify.respond") { entered(); await held; }
        return original(method, params);
      };
      client.emit("event", { session_id: id, type: "clarify.request", payload: { request_id: "held", question: "Eksik kapsam?" } });
      return true;
    });
    const state = store.create(spec), engine = new ResearchEngine({ store, state, createBackend: peer.factory });
    state.deadline = Date.now() + (cancellation ? 5000 : 250); engine.workDeadline = state.deadline;
    const turn = engine.turn("Plan a targeted investigation", { planning: true }); turn.catch(() => {});
    try {
      await responding;
      if (cancellation) { engine.cancelled = true; await engine.stopActive(); }
      await assert.rejects(turn, cancellation ? /Kullanıcı durdurdu/ : /Süre doldu/);
      const log = JSON.stringify(readJson(store.file(state.id)).interactionLog);
      release(); await new Promise(setImmediate);
      assert.equal(JSON.stringify(readJson(store.file(state.id)).interactionLog), log, "Late responses cannot mutate completed turn diagnostics");
    } finally { release(); engine.leases.close(); }
  });
}

test("interaction diagnostics are bounded and accept legacy runs without an interaction log", (t) => {
  const { store, spec } = setup(t), state = store.create(spec);
  const engine = new ResearchEngine({ store, state });
  try {
    for (let index = 0; index < 45; index++) engine.recordInteraction({ type: "clarify", question: `Question ${index}` }, "Policy applied");
    assert.equal(state.interactionLog.length, 40);
    assert.equal(state.interactionLog[0].question, "Question 5");
    assert.equal(readJson(store.file(state.id)).interactionLog.at(-1).question, "Question 44");
  } finally { engine.leases.close(); }
});

test("clarification response failures retain the actual question without becoming access failures", async (t) => {
  const { store, spec } = setup(t); let asked = false;
  const peer = nativeBackends(({ client, id }) => {
    if (asked) return false;
    asked = true;
    const original = client.request.bind(client);
    client.request = (method, params) => method === "clarify.respond" ? Promise.reject(new Error("RPC disconnected")) : original(method, params);
    client.emit("event", { session_id: id, type: "clarify.request", payload: { request_id: "broken", question: "Yanıtlanması gereken gerçek soru?" } });
    return true;
  });
  const result = await new ResearchEngine({ store, state: store.create(spec), createBackend: peer.factory }).run();
  assert.equal(result.status, "failed");
  assert.match(result.output, /gerçek soru/);
  assert.match(result.error, /otomatik yanıt iletilemedi/);
});

test("an approval required before any sources is still a genuine needs_access result", async (t) => {
  const { store, spec } = setup(t);
  const peer = nativeBackends(({ client, id, calls }) => {
    client.respondServerRequest = (responseId, result, error) => calls.push({ method: "server.response", responseId, result, error });
    client.emit("server-request", { id: "approval-before-sources", method: "approval", params: { session_id: id, description: "Korunan dosyayı okumak için izin gerekli.", choices: ["once", "deny"] } });
    return true;
  });
  const result = await new ResearchEngine({ store, state: store.create(spec), createBackend: peer.factory }).run();
  assert.equal(result.status, "needs_access"); assert.equal(result.sourceCount, 0);
  assert.match(result.error, /Korunan dosyayı okumak/);
  assert.deepEqual(peer.calls.find((call) => call.method === "server.response" && call.result).result, { choice: "deny" });
});
