import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simulationHost } from "./helpers/automationSimulation.mjs";
import { runAutomation } from "../electron/automationRunner.mjs";
import { readSelectedBrain, DEFAULT_BRAIN } from "../electron/brainModels.mjs";
import { ResearchStore, readJson, writeJson } from "../electron/researchStore.mjs";
import { EventEmitter } from "node:events";
import { createAutomationHermes } from "../electron/automationHermes.mjs";
import { AutomationService } from "../electron/automationService.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-automation-model-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, ".env");
  const saveSelection = (route) => fs.writeFileSync(file,
    `IRIS_BRAIN_PROVIDER=${route.provider}\nIRIS_BRAIN_MODEL=${route.modelId}\nIRIS_BRAIN_REASONING=${route.reasoning || "default"}\n`);
  return { directory, file, saveSelection };
}

test("headless model selection rereads saved Brain settings over inherited and applied settings", (t) => {
  const { file, saveSelection } = fixture(t);
  const env = { IRIS_BRAIN_PROVIDER: "evren", IRIS_BRAIN_MODEL: DEFAULT_BRAIN.modelId, IRIS_BRAIN_REASONING: "disabled" };
  assert.deepEqual(readSelectedBrain({ file, env }), { ...DEFAULT_BRAIN, reasoning: "disabled" });
  const next = { provider: "opencode", modelId: "beam-free", reasoning: "high" };
  saveSelection(next);
  fs.appendFileSync(file, "IRIS_BRAIN_APPLIED_PROVIDER=evren\nIRIS_BRAIN_APPLIED_MODEL=qwen3.8-flash-next\n");
  assert.deepEqual(readSelectedBrain({ file, env }), next);
  saveSelection({ ...next, reasoning: "default" });
  assert.deepEqual(readSelectedBrain({ file, env }), { provider: next.provider, modelId: next.modelId });
  saveSelection({ ...next, modelId: "unsupported-model" });
  assert.throws(() => readSelectedBrain({ file, env }), /desteklenen/);
});

test("existing automation takes current Brain settings once per run and preserves its schedule", async (t) => {
  const { directory, file, saveSelection } = fixture(t);
  const automationRoot = path.join(directory, "automation");
  const store = new ResearchStore(path.join(directory, "research"));
  const repoRoot = path.resolve(".");
  writeJson(path.join(automationRoot, "editor", "flows.json"), [
    { id: "flow", type: "tab", label: "Fixture" },
    { id: "start", type: "avalon-start", z: "flow", wires: [["first"]] },
    { id: "first", type: "avalon-research", z: "flow", topic: "First", wires: [["second"]] },
    { id: "second", type: "avalon-research", z: "flow", topic: "Second", reportInputs: ["first"], wires: [["finish"]] },
    { id: "finish", type: "avalon-finish", z: "flow", wires: [] },
  ]);
  const schedule = { id: "schedule_abcdef", spec: {
    automationFlowId: "flow", route: { ...DEFAULT_BRAIN, reasoning: "disabled" },
    outputDirectory: path.join(directory, "reports"), language: "tr", runtime: { stateRoot: store.root, repoRoot },
  } };
  store.save(schedule);
  const original = fs.readFileSync(store.file(schedule.id), "utf8");
  const first = { provider: "opencode", modelId: "beam-free", reasoning: "high" };
  const next = { provider: "evren", modelId: "deepseek-v4.1-flash", reasoning: "medium" };
  saveSelection(first);
  let routeReads = 0, hosts = 0;
  const simulate = simulationHost();
  const startHost = (options) => { hosts++; return simulate(options); };
  for (const [occurrence, expected] of [["first-run", first], ["next-run", next]]) {
    let calls = 0;
    const result = await runAutomation({ schedule, occurrence, store, startHost,
      getRoute: () => { routeReads++; return readSelectedBrain({ file }); },
      runResearch: async (id, reports) => {
        const state = store.get(id);
        assert.deepEqual(state.spec.route, expected);
        assert.deepEqual(reports, calls ? [{ name: "First", markdown: "# Fixture" }] : []);
        if (++calls === 1) saveSelection(next);
        fs.writeFileSync(path.join(state.outputPath, "report.md"), "# Fixture");
        const finished = { ...state, status: "completed", reportReady: true, output: "# Fixture" };
        store.save(finished);
        return finished;
      },
    });
    assert.equal(result.status, "completed", result.error);
    assert.equal(calls, 2);
    assert.deepEqual(result.route, expected);
    assert.deepEqual(readJson(path.join(automationRoot, "runs", result.id, "run.json")).route, expected);
    assert.equal(fs.readFileSync(store.file(schedule.id), "utf8"), original);
  }
  assert.equal(routeReads, 2);
  saveSelection({ ...next, modelId: "unsupported-model" });
  const failed = await runAutomation({ schedule, occurrence: "invalid-model", store, startHost,
    getRoute: () => readSelectedBrain({ file }), runResearch: () => assert.fail("Invalid selection must not start research"),
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /desteklenen/);
  assert.equal(hosts, 2);
});

function hermesFixture(t, timeoutMs = 5000) {
  const { directory } = fixture(t);
  const store = new ResearchStore(path.join(directory, "research"));
  const root = path.join(directory, "automation");
  writeJson(path.join(root, "editor", "flows.json"), [
    { id: "flow", type: "tab", label: "Lifecycle" },
    { id: "start", type: "avalon-start", z: "flow", wires: [["h"]] },
    { id: "h", type: "avalon-hermes", z: "flow", prompt: "offline task", timeoutMs, wires: [["finish"]] },
    { id: "finish", type: "avalon-finish", z: "flow", wires: [] },
  ]);
  const schedule = { id: "schedule_lifetime", spec: { automationFlowId: "flow", outputDirectory: directory,
    language: "tr", runtime: { stateRoot: store.root, repoRoot: path.resolve(".") } } };
  const options = { schedule, occurrence: "offline", store, startHost: simulationHost(), getRoute: () => DEFAULT_BRAIN };
  return { root, store, options };
}

for (const cause of ["CANCELLED", "TIMEOUT", "INTERRUPTED"]) {
  test(`runner clears a persisted approval, joins cleanup and records ${cause} separately`, async (t) => {
    const f = hermesFixture(t, cause === "TIMEOUT" ? 1000 : 5000);
    const controller = new AbortController();
    const events = [];
    const client = Object.assign(new EventEmitter(), { request: async (method, _params, options) => {
      assert.equal(options.start, false);
      events.push(method);
      return {};
    } });
    let interaction = { id: "approval", type: "approval", choices: ["once", "deny"] };
    const transport = { sessions: new Map([["session", { liveId: "live" }]]),
      createSession: async () => ({ id: "session" }), submit: async () => ({ run_id: "run" }),
      getRun: () => ({ status: "waiting_for_approval", dispatchStarted: true, interaction }),
      respond: () => assert.fail("Stale approval sent"),
      stop: async (_id, options) => { assert.equal(options.signal.aborted, false); events.push("stop"); await new Promise(setImmediate); events.push("cleanup-finished"); },
      close() { events.push("closed"); },
    };
    let observed;
    f.options.createHermes = (options) => {
      const adapter = createAutomationHermes({ ...options, env: {}, clientFactory: () => client, transportFactory: () => transport });
      const execute = adapter.execute;
      adapter.execute = (request) => execute({ ...request, requestInput: (input, scope) => {
        const pending = request.requestInput(input, scope);
        const runDirectory = path.join(f.root, "runs", fs.readdirSync(path.join(f.root, "runs"))[0]);
        observed = readJson(path.join(runDirectory, "run.json"));
        assert.equal(observed.steps[0].status, "waiting_for_approval");
        const responseFile = path.join(runDirectory, observed.steps[0].attemptId + ".response.json");
        if (cause === "INTERRUPTED") client.emit("disconnected");
        if (cause === "CANCELLED") controller.abort(Object.assign(new Error("user cancellation"), { code: cause }));
        // This late mailbox answer must never reach Hermes after the signal.
        if (cause !== "TIMEOUT") writeJson(responseFile, { interactionId: input.id, value: "once" });
        return pending;
      } });
      return adapter;
    };
    const result = await runAutomation({ ...f.options, signal: controller.signal });
    const step = result.steps[0];
    assert.equal(result.status, cause === "CANCELLED" ? "cancelled" : cause === "TIMEOUT" ? "needs_review" : "interrupted");
    assert.equal(step.result?.code || step.code, cause);
    assert.equal(step.interaction, undefined);
    assert.equal(step.cancellationUnconfirmed, true);
    assert.ok(events.indexOf("cleanup-finished") < events.indexOf("closed"));
    assert.ok(events.includes("session.close"));
    const persisted = readJson(path.join(f.root, "runs", result.id, "run.json"));
    assert.equal(persisted.steps[0].interaction, undefined);
    assert.equal(fs.existsSync(path.join(f.root, "runs", result.id, step.attemptId + ".response.json")), false);
    const service = new AutomationService({ root: f.store.root, repoRoot: path.resolve("."), store: f.store, scheduleSnapshot: () => ({ jobs: [], scheduler: {} }) });
    assert.throws(() => service.respond("flow", result.id, step.attemptId, interaction.id, "once"), /Bekleyen/);
    interaction = null;
  });
}

test("runner cancellation during native preparation records confirmed non-dispatch and ignores its late continuation", async (t) => {
  const f = hermesFixture(t);
  const controller = new AbortController();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const client = Object.assign(new EventEmitter(), {
    async request(method, params, options) {
      calls.push(method);
      if (method === "session.create") return { session_id: "live", stored_session_id: "session" };
      if (method === "config.set") {
        controller.abort(Object.assign(new Error("cancel during permissions"), { code: "CANCELLED" }));
        await gate;
        return { key: "yolo", scope: "session", value: params.value };
      }
      options?.signal?.throwIfAborted();
      options?.onDispatch?.();
      return {};
    },
    close() { calls.push("closed"); },
  });
  f.options.createHermes = (options) => createAutomationHermes({ ...options, env: {}, clientFactory: () => client });
  const result = await runAutomation({ ...f.options, signal: controller.signal });
  const file = path.join(f.root, "runs", result.id, "run.json");
  const finalRecord = fs.readFileSync(file, "utf8");
  assert.equal(result.status, "cancelled");
  assert.equal(result.steps[0].cancellationUnconfirmed, false);
  assert.equal(calls.includes("prompt.submit"), false);
  assert.equal(calls.includes("session.interrupt"), false);
  assert.equal(calls.at(-1), "closed");
  release();
  await new Promise(setImmediate);
  assert.equal(fs.readFileSync(file, "utf8"), finalRecord);
  assert.equal(calls.includes("prompt.submit"), false);
});
