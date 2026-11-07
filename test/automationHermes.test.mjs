import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createAutomationHermes } from "../electron/automationHermes.mjs";
import { HermesGatewayClient } from "../electron/hermesGatewayClient.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";

function fixture(t, { client = Object.assign(new EventEmitter(), { request: async () => ({}) }), stop = async () => {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-hermes-lifetime-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const transport = {
    sessions: new Map([["session", { liveId: "live" }]]),
    createSession: async () => ({ id: "session" }), submit: async () => ({ run_id: "run" }),
    getRun: () => ({ status: "waiting_for_approval", interaction: { id: "approval", type: "approval", choices: ["once", "deny"] } }),
    stop, respond: async () => assert.fail("Stale approval reached Hermes"), close: () => client.close?.({ force: true }),
  };
  const adapter = createAutomationHermes({ spec: { outputDirectory: directory }, env: {}, cleanupTimeoutMs: 30,
    clientFactory: () => client, transportFactory: () => transport });
  const controller = new AbortController();
  const options = { step: { prompt: "offline fixture" }, inputs: [], signal: controller.signal, onUpdate() {} };
  return { directory, adapter, client, transport, controller, options };
}

test("connection loss aborts an approval wait immediately and preserves INTERRUPTED", async (t) => {
  const f = fixture(t);
  let entered, answer;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const response = new Promise((resolve) => { answer = resolve; });
  let outcome;
  const pending = f.adapter.execute({ ...f.options, requestInput: () => { entered(); return response; } });
  pending.then(() => { outcome = "completed"; }, (error) => { outcome = error.code; });
  try {
    await waiting;
    f.client.emit("disconnected");
    await new Promise(setImmediate);
    assert.equal(outcome, "INTERRUPTED");
  } finally {
    f.controller.abort(Object.assign(new Error("test cleanup"), { code: "CANCELLED" }));
    answer("once");
    await pending.catch(() => {});
    await f.adapter.close();
  }
});

test("delayed teardown after adapter close never starts another Hermes process", async (t) => {
  let spawns = 0, entered, release;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const client = new HermesGatewayClient({ candidates: () => [{ cmd: "fake", args: [] }], env: {},
    spawnImpl: () => { spawns++; throw new Error("no real process"); } });
  const f = fixture(t, { client, stop: async () => { entered(); await gate; } });
  f.transport.getRun = () => ({ status: "running", interaction: { secret: true } });
  const pending = f.adapter.execute({ ...f.options, requestInput: () => assert.fail("secret") });
  await waiting;
  const closing = f.adapter.close();
  release();
  await Promise.allSettled([pending, closing]);
  assert.equal(spawns, 0);
  assert.equal(client.closed, true);
});

for (const code of ["CANCELLED", "TIMEOUT", "INTERRUPTED"]) {
  test(`approval cancellation preserves ${code} and cleanup uses an independent signal`, async (t) => {
    let entered;
    const waiting = new Promise((resolve) => { entered = resolve; });
    const calls = [];
    const f = fixture(t, { stop: async (_run, options) => {
      calls.push(options);
      assert.equal(options.signal.aborted, false);
      assert.equal(options.start, false);
    } });
    const pending = f.adapter.execute({ ...f.options, requestInput: (_interaction, { signal }) => {
      entered();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    } });
    const rejected = assert.rejects(pending, (error) => error.code === code);
    await waiting;
    if (code === "INTERRUPTED") f.client.emit("backend-exit", { code: 1 });
    else f.controller.abort(Object.assign(new Error(code), { code }));
    await rejected;
    assert.equal(calls.length, 1);
    await f.adapter.close();
  });
}

test("cleanup deadline bounds an uncooperative stop; its late continuation cannot issue session.close", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let entered, release;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [], updates = [];
  const client = Object.assign(new EventEmitter(), { request: async (method) => { calls.push(method); }, close() { calls.push("client.close"); } });
  const f = fixture(t, { client, stop: async () => { entered(); await gate; } });
  f.transport.getRun = () => ({ status: "running", dispatchStarted: true, interaction: { secret: true } });
  const pending = f.adapter.execute({ ...f.options, onUpdate: (value) => updates.push(value), requestInput() {} });
  await waiting;
  t.mock.timers.tick(30);
  assert.equal((await pending).status, "needs_review");
  assert.equal(updates.at(-1).cancellationUnconfirmed, true);
  await f.adapter.close();
  release();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["client.close"]);
  await assert.rejects(f.adapter.execute(f.options), (error) => error.code === "INTERRUPTED");
});

test("a real transport backend exit after dispatch preserves native-work uncertainty", async (t) => {
  const f = fixture(t);
  const updates = [];
  f.client.request = async (method, params, options) => {
    options?.signal?.throwIfAborted();
    if (method === "session.create") return { session_id: "live", stored_session_id: "session" };
    if (method === "config.set") return { key: "yolo", scope: "session", value: params.value };
    options?.onDispatch?.();
    if (method === "prompt.submit") queueMicrotask(() => f.client.emit("backend-exit", { code: 1 }));
    return {};
  };
  f.client.close = () => {};
  const adapter = createAutomationHermes({ spec: { outputDirectory: f.directory }, env: {},
    clientFactory: () => f.client, transportFactory: (client) => new HermesInteractiveTransport({ client, permissionMode: "standard" }) });
  t.after(() => adapter.close());
  await assert.rejects(adapter.execute({ ...f.options, onUpdate: (update) => updates.push(update), requestInput() {} }), (error) => error.code === "INTERRUPTED");
  assert.equal(updates.at(-1).cancellationUnconfirmed, true);
});
