import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/mobile/api.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("mobile forwards wake provenance and explicit stop reaches server before socket closure", async () => {
  const calls = [], order = [], sockets = [];
  let finishStop;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
    close() { order.push("socket closed"); this.readyState = 3; this.onclose?.(); }
  }
  const context = vm.createContext({
    exports: {}, crypto, Uint8Array, ArrayBuffer, URL, WebSocket: Socket,
    location: { protocol: "https:", host: "iris.test" }, window: { setTimeout, clearTimeout }, clearTimeout,
    fetch: async (_url, options) => {
      const call = JSON.parse(options.body); calls.push(call);
      if (call.method === "stopSidecar") {
        order.push("stop requested");
        await new Promise((resolve) => { finishStop = resolve; });
        order.push("server cleared speech");
      }
      const result = call.method === "remoteStatus" ? { voice: { generation: 7 } } : { running: call.method !== "stopSidecar" };
      return { status: 200, ok: true, json: async () => ({ result }) };
    },
  });
  vm.runInContext(source, context);
  const { api } = context.exports.mobileConnection(() => assert.fail("unexpected unauthorized response"));
  const options = { wakeReason: "notification", wakeGeneration: 3 };
  await api.startSidecar(options);
  assert.deepEqual(calls[0].args, [options]);
  const stopping = api.stopSidecar();
  assert.deepEqual(order, ["stop requested"]);
  assert.deepEqual(calls.at(-1).args, [7]);
  finishStop(); await stopping;
  assert.deepEqual(order, ["stop requested", "server cleared speech", "socket closed"]);
  assert.equal(sockets[0].readyState, 3);
});
