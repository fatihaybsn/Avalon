import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { acquireResearchLock, researchLockFile } from "../electron/researchLock.mjs";
import { claimSchedule, runEntry } from "../electron/researchRunner.mjs";
import { ResearchStore, writeJson, readJson } from "../electron/researchStore.mjs";
import { DEFAULT_BRAIN } from "../electron/brainModels.mjs";
import { simulationHost } from "./helpers/automationSimulation.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const repoRoot = path.resolve(".");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-os-lock-"));
  const store = new ResearchStore(path.join(root, "research"));
  store.testChildren = [];
  t.after(async () => {
    for (const child of store.testChildren) if (child.exitCode == null && !child.signalCode) { child.kill(); await once(child, "exit"); }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const make = (id, flow) => {
    const state = { id, spec: { topic: "offline", route: DEFAULT_BRAIN, outputDirectory: path.join(root, "reports"),
      runtime: { stateRoot: store.root, repoRoot }, ...(flow ? { automationFlowId: flow } : {}) } };
    store.save(state); return state;
  };
  return { root, store, make };
}

async function worker(t, store) {
  const child = fork(path.resolve("test/helpers/researchLockWorker.mjs"), [store.root], { windowsHide: true, stdio: ["ignore", "ignore", "inherit", "ipc"] });
  store.testChildren.push(child);
  t.after(async () => { if (child.exitCode == null && !child.signalCode) { child.kill(); await once(child, "exit"); } });
  assert.equal((await once(child, "message"))[0].kind, "ready");
  return { child, async call(message) { const reply = once(child, "message"); child.send(message); return (await reply)[0]; } };
}

test("two independent workers reject stale-lock races; OS ownership survives corrupt/deleted PID diagnostics", { timeout: 15000 }, async (t) => {
  const f = fixture(t), state = f.make("schedule_1111", "shared");
  const file = researchLockFile(f.store, state), diagnostic = path.join(path.dirname(file), "active.lock");
  writeJson(diagnostic, { pid: 2147483647, token: "stale" });
  const a = await worker(t, f.store), b = await worker(t, f.store);
  const responses = await Promise.all([a.call({ kind: "claim", id: state.id, occurrence: "same" }), b.call({ kind: "claim", id: state.id, occurrence: "same" })]);
  assert.equal(responses.filter((item) => !item.skipped).length, 1);
  assert.equal(responses.filter((item) => item.reason === "already_running").length, 1);
  const owner = responses[0].skipped ? b : a, contender = responses[0].skipped ? a : b;
  fs.rmSync(diagnostic, { force: true });
  assert.equal((await contender.call({ kind: "claim", id: state.id, occurrence: "other" })).reason, "already_running");
  writeJson(diagnostic, { pid: process.pid, token: "unrelated-live-pid" });
  await owner.call({ kind: "release" });
  assert.equal(fs.existsSync(file), true, "OS lock inode must never be removed");
  assert.equal((await contender.call({ kind: "claim", id: state.id, occurrence: "same" })).reason, "duplicate_occurrence");
  assert.equal((await contender.call({ kind: "claim", id: state.id, occurrence: "other" })).skipped, undefined);
  await contender.call({ kind: "release" });
});

test("owner process crash releases its pipe-owned OS lock for the second worker", { timeout: 15000 }, async (t) => {
  const f = fixture(t), state = f.make("schedule_1111");
  const a = await worker(t, f.store), b = await worker(t, f.store);
  assert.equal((await a.call({ kind: "claim", id: state.id, occurrence: "first" })).skipped, undefined);
  assert.equal((await b.call({ kind: "claim", id: state.id, occurrence: "next" })).reason, "already_running");
  a.child.kill(); await once(a.child, "exit");
  let reply;
  for (let count = 0; count < 20; count++) {
    reply = await b.call({ kind: "claim", id: state.id, occurrence: "next" });
    if (!reply.skipped) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(reply.skipped, undefined);
  await b.call({ kind: "release" });
});

test("scope is per automation flow / research schedule / standalone run, never global output directory", async (t) => {
  const f = fixture(t), a = f.make("schedule_a", "same-flow"), b = f.make("schedule_b", "same-flow");
  const c = f.make("schedule_c", "other-flow"), d = f.make("schedule_d"), e = f.make("schedule_e");
  const first = await claimSchedule(f.store, a, "one");
  try {
    assert.equal((await claimSchedule(f.store, b, "one")).reason, "already_running");
    const others = await Promise.all([c, d, e].map((state) => claimSchedule(f.store, state, "one")));
    assert.ok(others.every((claim) => !claim.skipped));
    await Promise.all(others.map((claim) => claim.release()));
    assert.equal(researchLockFile(f.store, { id: "research_1111", scheduleId: d.id, spec: d.spec }), researchLockFile(f.store, d));
    assert.notEqual(researchLockFile(f.store, { id: "research_1111", spec: d.spec }), researchLockFile(f.store, { id: "research_2222", spec: d.spec }));
  } finally { await first.release(); }
});

test("failed occurrence persistence releases exclusion and forged in-memory lock handoffs fail closed", async (t) => {
  const f = fixture(t), state = f.make("schedule_1111");
  await assert.rejects(claimSchedule(f.store, state, "x", { lease: { signal: new AbortController().signal } }), /Geçersiz/);
  const rename = fs.renameSync;
  const patch = t.mock.method(fs, "renameSync", (from, to) => {
    if (path.basename(to).startsWith("occurrence-")) throw new Error("disk fixture failure");
    return rename(from, to);
  });
  await assert.rejects(claimSchedule(f.store, state, "x"), /disk fixture/);
  patch.mock.restore();
  const next = await claimSchedule(f.store, state, "x");
  assert.equal(next.skipped, undefined); await next.release(); await next.release();
});

test("loss of the actual OS supervisor invalidates its in-memory lease", async (t) => {
  const f = fixture(t), state = f.make("schedule_1111");
  const lease = await acquireResearchLock(researchLockFile(f.store, state), { repoRoot });
  const stopped = new Promise((resolve) => lease.signal.addEventListener("abort", resolve, { once: true }));
  process.kill(lease.supervisorPid);
  await stopped;
  assert.equal(lease.signal.reason.code, "INTERRUPTED");
  await assert.rejects(claimSchedule(f.store, state, "x", { lease }), /Geçersiz/);
  await lease.release();
});

test("headless standalone runs share admission, ignore stale PID diagnostics and never replay a completed run", async (t) => {
  const f = fixture(t);
  const run = f.store.create(f.make("schedule_ffff").spec);
  run.pid = process.pid; f.store.save(run);
  let entered, release, calls = 0;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const adapters = { resolveModel: async () => { calls++; entered(); await gate; throw new Error("offline fixture"); } };
  const args = ["--run", f.store.file(run.id)];
  const pending = runEntry(args, adapters);
  await waiting;
  assert.equal((await runEntry(args, adapters)).reason, "already_running");
  release(); await pending;
  assert.equal((await runEntry(args, adapters)).reason, "already_started");
  assert.equal(calls, 1);
});

test("headless automation and its nested research reuse one lease; competing manual/scheduled entry cannot dispatch", async (t) => {
  const f = fixture(t), state = f.make("schedule_eeee", "flow");
  writeJson(path.join(f.root, "automation", "editor", "flows.json"), [
    { id: "flow", type: "tab", label: "Offline" },
    { id: "start", type: "avalon-start", z: "flow", wires: [["research"]] },
    { id: "research", type: "avalon-research", z: "flow", topic: "offline", wires: [["finish"]] },
    { id: "finish", type: "avalon-finish", z: "flow", wires: [] },
  ]);
  let entered, release;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const adapters = { startHost: simulationHost(), getRoute: () => DEFAULT_BRAIN, resolveModel: async () => ({ configured: true, key: "offline", baseUrl: "https://example.invalid/v1" }),
    spawnWorker() {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() {} });
      child.stdin.once("data", async () => { entered(); await gate; child.stdout.write(JSON.stringify({ kind: "report", markdown: "# Offline" }) + "\n"); child.stdout.end(); queueMicrotask(() => child.emit("close", 0)); });
      return child;
    } };
  const pending = runEntry(["--automation", f.store.file(state.id), "--occurrence", "manual"], adapters);
  await Promise.race([waiting, pending.then((result) => { throw new Error("Run ended before the fixture worker: " + result.error); })]);
  assert.equal((await runEntry(["--schedule", f.store.file(state.id), "--occurrence", "cron"], adapters)).reason, "already_running");
  const nested = f.store.list("research_")[0];
  assert.equal((await runEntry(["--run", f.store.file(nested.id)], adapters)).reason, "already_running");
  release();
  assert.equal((await pending).status, "completed");
  assert.equal(fs.existsSync(f.store.file(state.id, "active.lock")), false);
});

test("research admission blocks terminal-but-draining work and reconciles dead owners before the next occurrence", async (t) => {
  const f = fixture(t), schedule = f.make("schedule_aaaa");
  const prior = f.store.create(schedule.spec, { scheduleId: schedule.id });
  f.store.save({ ...prior, status: "cancelled", startedAt: Date.now(), pid: process.pid, executionPending: true });
  const args = ["--schedule", f.store.file(schedule.id), "--occurrence", "next"];
  assert.equal((await runEntry(args, { resolveModel: () => assert.fail("draining owner must exclude a new run") })).reason, "already_running");
  f.store.save({ ...f.store.get(prior.id), status: "running", pid: 2147483647 });
  writeJson(f.store.file(prior.id, "checkpoint.json"), { engine: "gpt-researcher", runId: prior.id, sources: [], findings: [], report: "# Recovered fixture" });
  await runEntry(args, { resolveModel: async () => ({ configured: false }) });
  assert.equal(f.store.get(prior.id).status, "interrupted");
  assert.equal(f.store.get(prior.id).executionPending, false);
  assert.match(fs.readFileSync(path.join(prior.outputPath, "report.md"), "utf8"), /Recovered fixture/);
});
