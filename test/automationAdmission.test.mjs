import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { ResearchStore, readJson, writeJson } from "../electron/researchStore.mjs";
import { researchLockFile } from "../electron/researchLock.mjs";
import { AutomationService } from "../electron/automationService.mjs";
import { listAutomationRuns } from "../electron/automationRunner.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-admission-")), children = [];
  const store = new ResearchStore(path.join(root, "research"));
  const schedule = { id: "schedule_abcdef", spec: { automationFlowId: "flow", outputDirectory: root, runtime: { stateRoot: store.root, repoRoot: path.resolve(".") } } };
  store.save(schedule);
  const graph = [ { id: "flow", type: "tab" }, { id: "start", type: "avalon-start", z: "flow", wires: [["task"]] },
    { id: "task", type: "avalon-hermes", z: "flow", prompt: "offline", wires: [["finish"]] }, { id: "finish", type: "avalon-finish", z: "flow", wires: [] } ];
  writeJson(path.join(root, "automation/editor/flows.json"), graph);
  t.after(async () => {
    for (const { child } of children) if (child.exitCode == null && !child.signalCode) {
      const exited = once(child, "exit"); child.kill(); await exited;
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const start = (occurrence, state = schedule) => {
    const child = fork(path.resolve("test/helpers/automationLifetimeWorker.mjs"), [store.file(state.id), occurrence], { execArgv: [], windowsHide: true, stdio: ["ignore", "ignore", "inherit", "ipc"] });
    const messages = [], waiting = new Set();
    child.on("message", (message) => { messages.push(message); for (const notify of waiting) notify(); });
    const instance = { child, exited: once(child, "exit"), async next() {
      if (!messages.length) await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { waiting.delete(notify); reject(new Error("fixture message deadline")); }, 5000);
        const notify = () => { clearTimeout(timeout); waiting.delete(notify); resolve(); }; waiting.add(notify);
      });
      return messages.shift();
    } };
    children.push(instance); return instance;
  };
  return { root, store, schedule, graph, start };
}

test("helper crash cannot admit another worker while the previous task drains; review enables a later restart", async (t) => {
  const f = fixture(t), first = f.start("first");
  assert.equal((await first.next()).kind, "entered");
  const diagnostic = readJson(path.join(path.dirname(researchLockFile(f.store, f.schedule)), "active.lock"));
  process.kill(diagnostic.supervisorPid);
  assert.equal((await first.next()).kind, "aborted");
  const second = f.start("second"), denied = await second.next();
  assert.equal(denied.kind, "result", "Second worker must not enter Hermes during cleanup");
  assert.equal(denied.result.reason, "already_running");
  await second.exited;
  first.child.send("release");
  const ended = await first.next(); await first.exited;
  assert.equal(ended.result.status, "interrupted");
  const third = f.start("third"), review = await third.next(); await third.exited;
  assert.equal(review.result.reason, "needs_review");
  const service = new AutomationService({ root: f.store.root, repoRoot: path.resolve(".") });
  service.acknowledgeReview("flow", ended.result.id);
  const restarted = f.start("fourth"); assert.equal((await restarted.next()).kind, "entered");
  restarted.child.send("release"); assert.equal((await restarted.next()).result.status, "completed"); await restarted.exited;
});

test("terminal status during cleanup cannot bypass admission or be acknowledged early; worker death permits reviewed recovery", async (t) => {
  const f = fixture(t), first = f.start("first");
  assert.equal((await first.next()).kind, "entered");
  const run = listAutomationRuns(path.join(f.root, "automation"), "flow")[0];
  process.kill(readJson(path.join(path.dirname(researchLockFile(f.store, f.schedule)), "active.lock")).supervisorPid);
  assert.equal((await first.next()).kind, "aborted");
  writeJson(path.join(f.root, "automation/runs", run.id, "run.json"), { ...run, status: "interrupted", executionPending: true,
    steps: run.steps.map((step) => ({ ...step, cancellationUnconfirmed: true })) });
  const service = new AutomationService({ root: f.store.root, repoRoot: path.resolve(".") });
  assert.throws(() => service.acknowledgeReview("flow", run.id), /temizliği/);
  const blocked = f.start("second"); assert.equal((await blocked.next()).result.reason, "already_running"); await blocked.exited;
  first.child.kill(); await first.exited;
  const orphan = f.start("third"); assert.equal((await orphan.next()).result.reason, "needs_review"); await orphan.exited;
  service.acknowledgeReview("flow", run.id);
  const recovered = f.start("fourth"); assert.equal((await recovered.next()).kind, "entered");
  recovered.child.send("release"); assert.equal((await recovered.next()).result.status, "completed"); await recovered.exited;
});

test("normal completion releases admission for the next run without a review marker", async (t) => {
  const f = fixture(t);
  for (const occurrence of ["first", "second"]) {
    const worker = f.start(occurrence); assert.equal((await worker.next()).kind, "entered");
    worker.child.send("release");
    const result = (await worker.next()).result; await worker.exited;
    assert.equal(result.status, "completed"); assert.equal(result.executionPending, false);
  }
});

test("an independent flow remains runnable while a lost-lease owner drains", async (t) => {
  const f = fixture(t), first = f.start("first"); assert.equal((await first.next()).kind, "entered");
  process.kill(readJson(path.join(path.dirname(researchLockFile(f.store, f.schedule)), "active.lock")).supervisorPid);
  assert.equal((await first.next()).kind, "aborted");
  const other = { ...f.schedule, id: "schedule_bbbb", spec: { ...f.schedule.spec, automationFlowId: "other" } }; f.store.save(other);
  writeJson(path.join(f.root, "automation/editor/flows.json"), [...f.graph, ...f.graph.map((node) => ({ ...node,
    id: node.id === "flow" ? "other" : node.id + "2", ...(node.z ? { z: "other" } : {}),
    ...(node.wires ? { wires: node.wires.map((wire) => wire.map((id) => id + "2")) } : {}) }))]);
  const independent = f.start("other", other); assert.equal((await independent.next()).kind, "entered");
  independent.child.send("release"); assert.equal((await independent.next()).result.status, "completed"); await independent.exited;
  first.child.send("release"); await first.next(); await first.exited;
});
