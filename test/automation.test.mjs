import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { runAutomation, listAutomationRuns } from "../electron/automationRunner.mjs";
import { AutomationService } from "../electron/automationService.mjs";
import { ResearchStore, writeJson, readJson } from "../electron/researchStore.mjs";
import { claimSchedule } from "../electron/researchRunner.mjs";
import { DEFAULT_BRAIN } from "../electron/brainModels.mjs";
import { automationWorkspace, validateHermesOutput, createAutomationHermes } from "../electron/automationHermes.mjs";
import { simulationHost } from "./helpers/automationSimulation.mjs";
const require = createRequire(import.meta.url);
const { compileFlow, portableFlows, checkEditorFlows } = require("../automation/flows.cjs");

const node = (id, type, next, fields = {}) => ({ id, type, z: "flow", wires: next ? [[next]] : [], ...fields });
const research = (id, next, fields = {}) => node(id, "avalon-research", next, { topic: "Prompt " + id, ...fields });
const hermes = (id, next, fields = {}) => node(id, "avalon-hermes", next, { prompt: "Task " + id, ...fields });
const linear = (...tasks) => [{ id: "flow", type: "tab", label: "Fixture" }, node("start", "avalon-start", tasks[0].id), ...tasks, node("finish", "avalon-finish")];

function fixture(t, graph) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-flow-contract-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ResearchStore(path.join(directory, "research"));
  const root = path.join(directory, "automation");
  const editorFile = path.join(root, "editor", "flows.json");
  writeJson(editorFile, graph);
  const schedule = { id: "schedule_abcdef", spec: { automationFlowId: "flow", route: DEFAULT_BRAIN,
    language: "tr", outputDirectory: path.join(directory, "reports"), runtime: { stateRoot: store.root, repoRoot: path.resolve(".") } } };
  store.save(schedule);
  const service = new AutomationService({ root: store.root, repoRoot: path.resolve("."), store, scheduleSnapshot: () => ({ jobs: [], scheduler: {} }) });
  const options = { schedule, occurrence: "one", store, getRoute: () => DEFAULT_BRAIN, startHost: simulationHost(),
    runResearch: async (id, reports) => {
      const state = store.get(id);
      assert.equal(state.spec.topic, "Prompt " + state.automationStepId);
      const output = "# " + state.task + "\n" + reports.map((item) => item.markdown).join("\n");
      fs.writeFileSync(path.join(state.outputPath, "report.md"), output);
      const result = { ...state, status: "completed", reportReady: true, output };
      store.save(result);
      return result;
    },
    runHermes: async ({ step }) => ({ status: "completed", output: step.prompt + " result" }),
  };
  return { directory, store, root, editorFile, options, service };
}

test("legacy linear research keeps prompts, settings and same-run report archive", async (t) => {
  const f = fixture(t, linear(research("r1", "r2", { mode: "normal", purpose: "Keep purpose", sites: "example.org" }), research("r2", "finish", { reportInputs: ["r1"] })));
  const run = await runAutomation(f.options);
  assert.equal(run.status, "completed", run.error);
  assert.equal(f.store.get(run.steps[0].researchId).spec.purpose, "Keep purpose");
  assert.deepEqual(f.store.get(run.steps[0].researchId).spec.sites, ["example.org"]);
  assert.match(f.store.get(run.steps[1].researchId).output, /Prompt r1/);
  assert.equal(f.service.snapshot().flows.length, 0); // runtime installation is optional in source tests
  assert.equal(listAutomationRuns(f.root, "flow")[0].steps[0].researchId, run.steps[0].researchId);
});

test("research -> Hermes -> Hermes passes explicit successful file references and exact prompts", async (t) => {
  const f = fixture(t, linear(research("r", "h1"), hermes("h1", "h2", { reportInputs: ["r"] }), hermes("h2", "finish", { reportInputs: ["h1"] })));
  let calls = 0;
  f.options.runHermes = async ({ step, inputs }) => {
    assert.equal(step.prompt, "Task " + step.id);
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].stepId, calls++ ? "h1" : "r");
    assert.ok(fs.readFileSync(inputs[0].file, "utf8").length);
    assert.equal(inputs[0].markdown, undefined);
    return { status: "completed", output: "Result " + step.id };
  };
  const run = await runAutomation(f.options);
  assert.equal(run.status, "completed", run.error);
  assert.equal(calls, 2);
  assert.ok(run.steps.every((step) => step.result.ref.runId === run.id));
});

function revisionFlow(maxAttempts = 3) {
  return linear(research("r", "eval", { maxAttempts }), hermes("eval", "choose", { outputType: "evaluation", reportInputs: ["r"] }),
    node("choose", "switch", null, { property: "payload.value.outcome", propertyType: "msg", checkall: "false",
      rules: [{ t: "eq", v: "approved", vt: "str" }, { t: "eq", v: "revision_required", vt: "str" }, { t: "else" }],
      wires: [["finish"], ["feedback"], ["finish"]] }),
    node("feedback", "change", "r", { rules: [{ t: "set", p: "feedback", pt: "msg", to: "Eksik kaynakları tamamla", tot: "str" }] }));
}

test("conditional revision returns to research; old reports and attempt identities survive", async (t) => {
  const f = fixture(t, revisionFlow());
  let calls = 0;
  f.options.runHermes = async () => {
    const value = { outcome: ++calls === 1 ? "revision_required" : "approved" };
    return { status: "completed", output: JSON.stringify(value), value };
  };
  const run = await runAutomation(f.options);
  assert.equal(run.status, "completed", run.error);
  const reports = run.steps.filter((step) => step.kind === "research");
  assert.equal(reports.length, 2);
  assert.notEqual(reports[0].researchId, reports[1].researchId);
  assert.equal(reports[1].attempt, 2);
  assert.match(f.store.get(reports[1].researchId).spec.purpose, /Eksik kaynakları tamamla/);
  assert.ok(reports.every((step) => fs.existsSync(step.result.ref.file)));
});

test("revision budget ends a loop without dispatching another task", async (t) => {
  const f = fixture(t, revisionFlow(1));
  let calls = 0;
  f.options.runHermes = async () => { calls++; return { status: "completed", output: "Revise", value: { outcome: "revision_required" } }; };
  const run = await runAutomation(f.options);
  assert.equal(run.status, "partial");
  assert.match(run.error, /tekrar sınır/);
  assert.equal(calls, 1);
});

test("failed Hermes is never sent on success; explicit error output can recover", async (t) => {
  const graph = linear(hermes("bad", "finish", { onError: "route", wires: [["finish"], ["fallback"]] }), hermes("fallback", "finish"));
  const f = fixture(t, graph), calls = [];
  f.options.runHermes = async ({ step }) => { calls.push(step.id); return step.id === "bad" ? { status: "failed", error: "mock failure" } : { status: "completed", output: "Recovered" }; };
  const run = await runAutomation(f.options);
  assert.equal(run.status, "completed", run.error);
  assert.deepEqual(calls, ["bad", "fallback"]);
  assert.equal(run.steps[0].result.ref, undefined);
  assert.equal(run.steps[0].status, "failed");
});

test("default failure stops; catch routes errors through Node-RED", async (t) => {
  const f = fixture(t, linear(hermes("bad", "never"), hermes("never", "finish")));
  let calls = 0;
  f.options.runHermes = async () => { calls++; return { status: "failed", error: "Failed" }; };
  const failed = await runAutomation(f.options);
  assert.equal(failed.status, "failed");
  assert.equal(calls, 1);
  const graph = linear(hermes("bad", "finish", { onError: "catch" }), node("caught", "catch", "fallback", { scope: ["bad"] }), hermes("fallback", "finish"));
  writeJson(f.editorFile, graph);
  const recovered = await runAutomation({ ...f.options, occurrence: "catch", runHermes: async ({ step }) =>
    step.id === "bad" ? { status: "failed", error: "Failed" } : { status: "completed", output: "Handled" } });
  assert.equal(recovered.status, "completed", recovered.error);
});

test("duplicate task requests and duplicate scheduled occurrence do not repeat work", async (t) => {
  const f = fixture(t, linear(hermes("h", "finish")));
  let calls = 0;
  f.options.startHost = simulationHost({ duplicate: true });
  f.options.runHermes = async () => { calls++; return { status: "completed", output: "One" }; };
  const first = await runAutomation(f.options);
  const duplicate = await runAutomation(f.options);
  assert.equal(first.status, "completed", first.error);
  assert.equal(duplicate.id, first.id);
  assert.equal(calls, 1);
  assert.equal(first.steps.length, 1);
  const claim = await claimSchedule(f.store, f.options.schedule, "cron-occurrence");
  assert.equal((await claimSchedule(f.store, f.options.schedule, "cron-occurrence")).reason, "already_running");
  await claim.release();
  assert.equal((await claimSchedule(f.store, f.options.schedule, "cron-occurrence")).reason, "duplicate_occurrence");
});

test("cancellation cannot start a later task even if a mock ignores its signal", async (t) => {
  const f = fixture(t, linear(hermes("h", "never"), hermes("never", "finish")));
  let calls = 0;
  f.options.runHermes = async ({ signal }) => {
    calls++;
    writeJson(path.join(f.root, "runs", fs.readdirSync(path.join(f.root, "runs"))[0], "cancel.json"), {});
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    return { status: "completed", output: "Late" };
  };
  const run = await runAutomation(f.options);
  assert.equal(run.status, "cancelled");
  assert.equal(calls, 1);
  assert.equal(run.steps[1].status, "waiting");
});

test("Node-RED interruption and stale process reconciliation are durable and never replay completed work", async (t) => {
  const f = fixture(t, linear(hermes("h", "finish")));
  f.options.startHost = simulationHost({ onReply(message, child) { if (message.kind === "start") child.emit("disconnect"); } });
  const result = await runAutomation(f.options);
  assert.equal(result.status, "interrupted");
  assert.equal((await runAutomation(f.options)).status, "interrupted");
  const file = path.join(f.root, "runs", result.id, "run.json");
  writeJson(file, { ...result, status: "running", pid: 2147483647, steps: [{ id: "h", status: "waiting_for_approval", taskId: "native-id" }] });
  assert.equal(listAutomationRuns(f.root, "flow")[0].status, "interrupted");
  assert.equal(readJson(file).steps[0].taskId, "native-id");
  assert.equal(readJson(file).steps[0].status, "interrupted");
});

test("flow editing cannot mutate the saved execution snapshot", async (t) => {
  const f = fixture(t, linear(hermes("h", "finish")));
  const original = fs.readFileSync(f.editorFile, "utf8");
  f.options.startHost = simulationHost({ onReady() { writeJson(f.editorFile, linear(hermes("other", "finish"))); } });
  const run = await runAutomation(f.options);
  assert.equal(run.status, "completed", run.error);
  assert.equal(run.steps[0].id, "h");
  const revision = readJson(path.join(f.root, "runs", run.id, "revision.json"));
  assert.equal(revision.steps[0].prompt, "Task h");
  assert.notEqual(fs.readFileSync(f.editorFile, "utf8"), original);
});

test("required dispatch approval waits for a matching UI reply and is not an implicit permission", async (t) => {
  const f = fixture(t, linear(hermes("h", "finish", { requireApproval: true })));
  let calls = 0;
  f.options.runHermes = async () => { calls++; return { status: "completed", output: "Approved task" }; };
  const pending = runAutomation(f.options);
  let active, step;
  for (let count = 0; count < 200; count++) {
    active = listAutomationRuns(f.root, "flow")[0];
    step = active?.steps.find((item) => item.interaction);
    if (step) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(step?.interaction);
  assert.equal(calls, 0);
  assert.throws(() => f.service.respond("flow", active.id, step.attemptId, "stale", "once"), /Bekleyen/);
  assert.throws(() => f.service.respond("flow", active.id, step.attemptId, step.interaction.id, "always"), /geçersiz/);
  f.service.respond("flow", active.id, step.attemptId, step.interaction.id, "once");
  assert.equal((await pending).status, "completed");
  assert.equal(calls, 1);
});

test("missing branch output and malformed or unsupported nodes are rejected", async (t) => {
  const f = fixture(t, linear(hermes("h1", "h2"), hermes("h2", "finish", { reportInputs: ["h1"] })));
  f.options.startHost = simulationHost({ onMessage(message) { if (message.id === "h2") message.outputs = {}; } });
  const run = await runAutomation(f.options);
  assert.equal(run.status, "partial");
  assert.match(run.error, /tamamlanmış çıktı/);
  assert.throws(() => checkEditorFlows([{ id: "exec", type: "exec" }]), /Desteklenmeyen/);
  assert.throws(() => compileFlow(linear(hermes("h", "missing")), "flow"), /bağlantı/);
  assert.throws(() => checkEditorFlows([node("change", "change", null, { rules: [{ t: "set", p: "avalon.outputs", pt: "msg", to: "{}", tot: "json" }] })]), /yalnızca/);
  assert.throws(() => checkEditorFlows([node("switch", "switch", null, { property: "payload", propertyType: "jsonata", checkall: "false", rules: [] })]), /Koşul/);
});

test("portable template drops credentials, prompts, private paths and arbitrary change values", () => {
  const graph = linear(hermes("h", "change", { prompt: "secret-key C:\\Users\\private", workingDirectory: "C:\\Users\\private",
    unknownApiKey: "secret-key", requiredFiles: "private.txt" }),
    node("change", "change", "finish", { rules: [{ t: "set", p: "feedback", pt: "msg", to: "secret-key /home/private", tot: "str" }] }));
  graph[0].label = "secret-key";
  const output = portableFlows(graph);
  assert.doesNotMatch(JSON.stringify(output), /secret-key|private|C:\\\\Users/);
  assert.ok(compileFlow(output, output[0].id));
});

test("mechanical output and workspace checks reject blank, invalid, missing and escaping outputs", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-workspace-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cwd = automationWorkspace({ workingDirectory: "project" }, { outputDirectory: directory }, {});
  assert.throws(() => automationWorkspace({ workingDirectory: "../outside" }, { outputDirectory: directory }, {}), /kökün dışında/);
  const evaluate = (step, output) => validateHermesOutput(step, { status: "completed", output }, cwd);
  assert.throws(() => evaluate({}, " "), /boş/);
  assert.throws(() => evaluate({ outputType: "json" }, "broken"), /JSON/);
  assert.throws(() => evaluate({ outputType: "json", requiredFields: "sources" }, "{}"), /alan eksik/);
  assert.throws(() => evaluate({ outputType: "files", requiredFiles: "missing.md" }, "Done"), /bulunamadı/);
  assert.throws(() => evaluate({ requiredFiles: "../outside" }, "Done"), /kapsam dışında/);
  fs.writeFileSync(path.join(cwd, "result.md"), "# Simulated artifact");
  assert.equal(evaluate({ outputType: "files", requiredFiles: "result.md" }, "Done").files.length, 1);
  assert.equal(evaluate({ outputType: "evaluation" }, '{"outcome":"needs_review"}').value.outcome, "needs_review");
  assert.throws(() => evaluate({ outputType: "evaluation" }, '{"outcome":"failed"}'), /başarısız/);
});

test("Hermes adapter reuses native submit/respond/stop without granting an approval itself", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-hermes-adapter-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const client = Object.assign(new EventEmitter(), { request: async () => ({}) });
  let submitted, answered = false, stopped = 0;
  const transport = { sessions: new Map([["session", { liveId: "live" }]]), createSession: async () => ({ id: "session" }),
    submit: async (input) => { submitted = input; return { run_id: "run" }; },
    getRun: () => answered ? { status: "completed", output: "Native result" } :
      { status: "waiting_for_approval", interaction: { id: "approval", type: "approval", question: "Allow?", choices: ["once", "deny"] } },
    respond: async (_id, response) => { assert.equal(response.value, "once"); answered = true; },
    stop: async () => { stopped++; }, close() {},
  };
  const adapter = createAutomationHermes({ spec: { outputDirectory: directory, route: DEFAULT_BRAIN }, env: {}, clientFactory: () => client, transportFactory: () => transport });
  let asked = false;
  const result = await adapter.execute({ step: { prompt: "Exact prompt", outputType: "text" }, inputs: [{ file: "/fixture/report.md" }],
    signal: new AbortController().signal, onUpdate() {}, requestInput: async () => { asked = true; assert.equal(answered, false); return "once"; } });
  assert.equal(result.status, "completed");
  assert.equal(submitted.task, "Exact prompt");
  assert.match(submitted.instructions, /fixture\/report.md/);
  assert.equal(asked, true);
  assert.equal(stopped, 0);
  adapter.close();
});

test("needs_review evaluation is not reported as a successful completed flow", async (t) => {
  const f = fixture(t, linear(hermes("h", "finish", { outputType: "evaluation" })));
  f.options.runHermes = async () => ({ status: "completed", output: "Review", value: { outcome: "needs_review" } });
  assert.equal((await runAutomation(f.options)).status, "needs_review");
});

const coreDirectory = process.env.AVALON_TEST_NODE_RED_DIR || path.join(os.homedir(), ".iris", "automation", "node-red-5.0.9");
test("installed Node-RED switch/change core nodes execute the revision loop in memory (no server)", {
  skip: !fs.existsSync(path.join(coreDirectory, "node_modules", "@node-red", "nodes", "package.json")),
}, async (t) => {
  const f = fixture(t, revisionFlow());
  f.options.startHost = simulationHost({ coreDirectory });
  let count = 0;
  f.options.runHermes = async () => {
    const value = { outcome: ++count === 1 ? "revision_required" : "approved" };
    return { status: "completed", output: JSON.stringify(value), value };
  };
  const run = await runAutomation(f.options);
  assert.equal(run.status, "completed", run.error);
  assert.equal(count, 2);
  assert.equal(run.steps.filter((step) => step.id === "r").length, 2);
});

test("timed out Hermes stops safely instead of entering a retry while cancellation is uncertain", async (t) => {
  const f = fixture(t, linear(hermes("h", "finish", { timeoutMs: 1000, onError: "route", wires: [["finish"], ["never"]] }), hermes("never", "finish")));
  let calls = 0;
  f.options.runHermes = async () => { calls++; return new Promise(() => {}); };
  const run = await runAutomation(f.options);
  assert.equal(run.status, "needs_review");
  assert.equal(run.steps[0].cancellationUnconfirmed, true);
  assert.match(run.error, /zaman aşımı/);
  assert.equal(calls, 1);
});

test("native Hermes disconnection is interrupted and pending native work is stopped", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-hermes-disconnect-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const client = Object.assign(new EventEmitter(), { request: async () => ({}) });
  let stopped = 0;
  const transport = { sessions: new Map([["session", { liveId: "live" }]]), createSession: async () => ({ id: "session" }),
    submit: async () => { queueMicrotask(() => client.emit("disconnected")); return { run_id: "run" }; },
    getRun: () => ({ status: "running" }), stop: async () => { stopped++; }, close() {},
  };
  const adapter = createAutomationHermes({ spec: { outputDirectory: directory, route: DEFAULT_BRAIN }, env: {},
    clientFactory: () => client, transportFactory: () => transport });
  await assert.rejects(adapter.execute({ step: { prompt: "Task" }, inputs: [], signal: new AbortController().signal, onUpdate() {} }),
    { code: "INTERRUPTED" });
  assert.equal(stopped, 1);
  adapter.close();
});

test("Hermes secret requests require review and never enter the persisted answer mailbox", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-hermes-secret-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const client = Object.assign(new EventEmitter(), { request: async () => ({}) });
  let stopped = false;
  const transport = { sessions: new Map([["session", { liveId: "live" }]]), createSession: async () => ({ id: "session" }),
    submit: async () => ({ run_id: "run" }), getRun: () => ({ status: "waiting_for_input", interaction: { secret: true, type: "secret" } }),
    stop: async () => { stopped = true; }, close() {},
  };
  const adapter = createAutomationHermes({ spec: { outputDirectory: directory }, env: {}, clientFactory: () => client, transportFactory: () => transport });
  const result = await adapter.execute({ step: { prompt: "Task" }, inputs: [], signal: new AbortController().signal,
    onUpdate() {}, requestInput: () => assert.fail("Secrets cannot be persisted") });
  assert.equal(result.status, "needs_review");
  assert.equal(stopped, true);
  adapter.close();
});

test("shipped examples validate and editor JavaScript parses without opening a browser", async () => {
  const { Script } = await import("node:vm");
  for (const filename of fs.readdirSync("automation/nodes/examples")) {
    const flows = JSON.parse(fs.readFileSync(path.join("automation/nodes/examples", filename), "utf8"));
    for (const tab of flows.filter((item) => item.type === "tab")) assert.ok(compileFlow(flows, tab.id));
  }
  const html = fs.readFileSync("automation/nodes/avalon.html", "utf8");
  const source = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
  assert.ok(new Script(source));
});

function installedFixture(f) {
  const version = JSON.parse(fs.readFileSync("automation/package.json", "utf8")).dependencies["node-red"];
  writeJson(path.join(f.root, "install.json"), { node: process.execPath, version });
  writeJson(path.join(f.root, "node-red-" + version, "node_modules/node-red/package.json"), { version });
}

test("Hermes results remain visible in the existing automation history and safe sharing round-trips", async (t) => {
  const f = fixture(t, linear(hermes("h", "finish")));
  installedFixture(f);
  const result = await runAutomation(f.options);
  const snapshot = f.service.snapshot();
  assert.equal(snapshot.flows[0].history[0].steps[0].task.output, "Task h result");
  assert.equal(f.service.outputDirectory("flow", result.id, result.steps[0].attemptId), result.steps[0].outputPath);
  const template = f.service.exportFlow("flow");
  assert.equal(f.service.importFlow(template).ok, true);
  assert.equal(f.service.flows().length, 2);
  assert.throws(() => f.service.importFlow(template), /çakışıyor/);
});

test("manual automation does not require a second scheduler, and Hermes-only schedule settings remain valid", async (t) => {
  const f = fixture(t, linear(hermes("h", "finish")));
  installedFixture(f);
  let launched, saved;
  f.service.research.specification = async () => ({ topic: "Fixture", route: DEFAULT_BRAIN, mode: "normal", language: "tr", outputDirectory: path.join(f.directory, "reports") });
  f.service.research.prepareRoute = async () => {};
  f.service.research.runtime = () => f.options.schedule.spec.runtime;
  f.service.research.launch = (state, args) => { launched = { state, args }; };
  f.service.research.createSchedule = async (spec) => { saved = spec; return { ok: true }; };
  await f.service.run("flow");
  assert.equal(launched.args[0], "--automation");
  assert.equal(launched.state.spec.automationFlowId, "flow");
  assert.equal(launched.state.nativeId, undefined);
  await f.service.saveSchedule("flow", { kind: "weekly", day: 1, time: "11:30", timezone: "Europe/Istanbul" });
  assert.equal(saved.automationFlowId, "flow");
});

test("scheduled and manual entry points use the same mock adapters and occurrence deduplication", async (t) => {
  const { runEntry } = await import("../electron/researchRunner.mjs");
  const f = fixture(t, linear(hermes("h", "finish")));
  let calls = 0;
  const adapters = { startHost: simulationHost(), getRoute: () => DEFAULT_BRAIN,
    runHermes: async () => { calls++; return { status: "completed", output: "Mock scheduled result" }; } };
  const args = ["--schedule", f.store.file(f.options.schedule.id), "--occurrence", "native-fire"];
  assert.equal((await runEntry(args, adapters)).status, "completed");
  assert.equal((await runEntry(args, adapters)).reason, "duplicate_occurrence");
  assert.equal((await runEntry(["--automation", args[1], "--occurrence", "manual-fire"], adapters)).status, "completed");
  assert.equal(calls, 2);
});

test("a final failed result cannot become completed because editor JSON lists nodes in a different order", async (t) => {
  const graph = linear(hermes("first", "last"), hermes("last", "finish", { onError: "route", wires: [["finish"], ["finish"]] }));
  [graph[2], graph[3]] = [graph[3], graph[2]];
  const f = fixture(t, graph);
  f.options.runHermes = async ({ step }) => step.id === "first" ? { status: "completed", output: "Prior success" } : { status: "failed", error: "Final failure" };
  const run = await runAutomation(f.options);
  assert.equal(run.status, "partial");
  assert.equal(run.error, "Final failure");
});

test("production host settings load exactly the intended native and Avalon node files without starting Node-RED", {
  skip: !fs.existsSync(path.join(coreDirectory, "node_modules", "@node-red", "registry", "package.json")),
}, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-node-inventory-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { runtimeSettings } = require("../automation/host.cjs");
  const fromInstall = createRequire(path.join(coreDirectory, "package.json"));
  t.mock.method(fromInstall("@node-red/util").i18n, "registerMessageCatalog", async () => {});
  const localFilesystem = require(path.join(path.dirname(fromInstall.resolve("@node-red/registry/package.json")), "lib/localfilesystem.js"));
  localFilesystem.init({ ...runtimeSettings(coreDirectory, directory), version: "5.0.9" });
  const inventory = localFilesystem.getNodeFiles(true);
  assert.deepEqual(Object.keys(inventory["node-red"].nodes).sort(), ["avalon", "catch", "change", "comment", "switch"]);
});

test("uncertain interrupted Hermes blocks subsequent scheduled/manual work until the user reviews that exact run", async (t) => {
  const { automationNeedsReview } = await import("../electron/automationRunner.mjs");
  const f = fixture(t, linear(hermes("h", "finish")));
  installedFixture(f);
  const run = await runAutomation(f.options);
  const file = path.join(f.root, "runs", run.id, "run.json");
  writeJson(file, { ...run, status: "running", pid: 2147483647,
    steps: run.steps.map((step) => ({ ...step, status: "running", taskId: "native-task", dispatchStatus: "submitted" })) });
  assert.equal(automationNeedsReview(f.root, "flow").id, run.id);
  assert.equal(f.service.snapshot().flows[0].needsReview.runId, run.id);
  assert.equal((await claimSchedule(f.store, f.options.schedule, "next-fire")).reason, "needs_review");
  await assert.rejects(f.service.run("flow"), /inceleyip/);
  const blocked = await runAutomation({ ...f.options, occurrence: "blocked", runHermes: () => assert.fail("Must not dispatch") });
  assert.equal(blocked.reason, "needs_review");
  assert.throws(() => f.service.acknowledgeReview("other-flow", run.id), /bulunamadı/);
  f.service.acknowledgeReview("flow", run.id);
  assert.equal(automationNeedsReview(f.root, "flow"), undefined);
  const claim = await claimSchedule(f.store, f.options.schedule, "next-fire");
  assert.equal(claim.skipped, undefined);
  await claim.release();
  assert.ok(fs.existsSync(run.steps[0].result.ref.file));
});

test("mis-typed approval settings cannot silently disable requested confirmation", () => {
  assert.throws(() => compileFlow(linear(hermes("h", "finish", { requireApproval: "true" })), "flow"), /Başlatma onayı/);
});

test("an ambiguous native dispatch becomes review-required and sends an interrupt to its dedicated session", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-hermes-ambiguous-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const client = Object.assign(new EventEmitter(), { request: async (method) => { calls.push(method); return {}; } });
  const transport = { sessions: new Map([["session", { liveId: "live" }]]), createSession: async () => ({ id: "session" }),
    submit: async () => ({ run_id: "run" }), getRun: () => ({ status: "failed", error: "RPC timeout", dispatchUncertain: true }), close() {},
  };
  const updates = [];
  const adapter = createAutomationHermes({ spec: { outputDirectory: directory }, env: {},
    clientFactory: () => client, transportFactory: () => transport });
  const result = await adapter.execute({ step: { prompt: "Task" }, inputs: [], signal: new AbortController().signal, onUpdate: (update) => updates.push(update) });
  assert.equal(result.status, "needs_review");
  assert.ok(updates.some((update) => update.cancellationUnconfirmed));
  assert.ok(calls.includes("session.interrupt"));
  adapter.close();
});

test("manual start preserves the existing scheduled output directory while rereading the current model", async (t) => {
  const f = fixture(t, linear(hermes("h", "finish")));
  const customDirectory = path.join(f.directory, "custom-output");
  f.store.save({ ...f.options.schedule, nativeId: "native", spec: { ...f.options.schedule.spec, outputDirectory: customDirectory } });
  f.service.research.specification = async (input) => {
    assert.equal(input.outputDirectory, customDirectory);
    assert.equal(input.route, undefined);
    return { ...input, route: DEFAULT_BRAIN };
  };
  f.service.research.prepareRoute = async () => {};
  f.service.research.runtime = () => f.options.schedule.spec.runtime;
  let launched;
  f.service.research.launch = (state) => { launched = state; };
  await f.service.run("flow");
  assert.equal(launched.spec.outputDirectory, customDirectory);
});

test("cancelling before dispatch approval does not create native-task uncertainty or start work", async (t) => {
  const { automationNeedsReview } = await import("../electron/automationRunner.mjs");
  const f = fixture(t, linear(hermes("h", "finish", { requireApproval: true })));
  const pending = runAutomation({ ...f.options, runHermes: () => assert.fail("Not approved") });
  let run;
  for (let i = 0; i < 200; i++) {
    run = listAutomationRuns(f.root, "flow")[0];
    if (run?.steps[0]?.interaction) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(run.steps[0].interaction);
  f.service.cancelRun("flow", run.id);
  assert.equal((await pending).status, "cancelled");
  assert.equal(automationNeedsReview(f.root, "flow"), undefined);
});
