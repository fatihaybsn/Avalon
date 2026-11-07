import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { HermesGatewayClient } from "../electron/hermesGatewayClient.mjs";

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
  }

  kill() {
    if (this.exitCode != null) return;
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
    setImmediate(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            jsonrpc: "2.0",
            method: "event",
            params: { type: "gateway.ready", payload: {} },
          }),
        }),
      );
    });
  }

  send(raw) {
    const request = JSON.parse(raw);
    (this.sent ||= []).push(request);
    if (!request.method || request.id == null) return;
    setImmediate(() => {
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { method: request.method, ok: true },
          }),
        }),
      );
    });
  }

  close() {
    this.readyState = 3;
  }
}

test("late cleanup RPC cannot implicitly reopen an explicitly closed gateway", async () => {
  let spawns = 0;
  const client = new HermesGatewayClient({ candidates: () => [{ cmd: "fake", args: [] }],
    spawnImpl: () => { spawns++; throw new Error("fake spawn"); }, env: {} });
  client.close();
  await assert.rejects(client.request("session.close", { session_id: "old-session" }), /closed/i);
  assert.equal(spawns, 0);
  assert.equal(client.closed, true);
});

test("close during startup cancels that lifetime without trying a fallback candidate", async () => {
  let spawns = 0;
  const client = new HermesGatewayClient({ candidates: () => [{ cmd: "first", args: [] }, { cmd: "fallback", args: [] }],
    spawnImpl: () => { spawns++; return new FakeChild(); }, env: {}, startupTimeoutMs: 100 });
  const starting = client.start();
  const rejected = assert.rejects(starting, /closed/i);
  client.close({ force: true });
  await rejected;
  assert.equal(spawns, 1);
});

test("RPC cancellation while awaiting startup never writes to the socket", async () => {
  let child;
  const client = new HermesGatewayClient({ candidates: () => [{ cmd: "fake", args: [] }], env: {}, WebSocketImpl: FakeWebSocket,
    spawnImpl: () => (child = new FakeChild()) });
  const cancellation = new AbortController();
  let dispatched = false;
  const request = client.request("prompt.submit", {}, { signal: cancellation.signal, onDispatch: () => { dispatched = true; } });
  await new Promise(setImmediate);
  cancellation.abort(new Error("cancel before socket"));
  await assert.rejects(request, /cancel before socket/);
  child.stdout.write("HERMES_BACKEND_READY port=43212\n");
  await client.start();
  assert.equal(dispatched, false);
  assert.equal(client.socket.sent.some((frame) => frame.method === "prompt.submit"), false);
  client.close();
});

test("first-use autostart and ordinary candidate fallback still work; teardown never autostarts", async () => {
  let spawns = 0;
  const client = new HermesGatewayClient({ candidates: () => [{ cmd: "missing", args: [] }, { cmd: "fake", args: [] }], env: {}, WebSocketImpl: FakeWebSocket,
    spawnImpl: () => {
      if (++spawns === 1) throw new Error("missing candidate");
      const child = new FakeChild();
      setImmediate(() => child.stdout.write("HERMES_BACKEND_READY port=43213\n"));
      return child;
    } });
  await assert.rejects(client.request("session.close", {}, { start: false }), /not connected/);
  assert.equal(spawns, 0);
  assert.equal((await client.request("session.create")).ok, true);
  assert.equal(spawns, 2);
  client.close();
  await assert.rejects(client.request("session.close", {}, { start: false }), /closed/i);
});

test("closing during handshake rejects old work and an explicit new start owns all new state", async () => {
  const sockets = [];
  let socketCreated;
  class HeldSocket extends FakeWebSocket {
    constructor(url) { super(url); sockets.push(this); socketCreated?.(); }
  }
  let spawns = 0;
  const client = new HermesGatewayClient({ candidates: () => [{ cmd: "fake", args: [] }], env: {}, WebSocketImpl: HeldSocket,
    spawnImpl: () => { spawns++; const child = new FakeChild(); setImmediate(() => child.stdout.write("HERMES_BACKEND_READY port=43214\n")); return child; } });
  const created = new Promise((resolve) => { socketCreated = resolve; });
  const old = client.request("prompt.submit");
  const rejected = assert.rejects(old, /closed/i);
  await created;
  client.close({ force: true });
  const next = client.start();
  await rejected;
  await next;
  assert.equal(spawns, 2);
  assert.equal(client.ready, true);
  assert.equal(client.socket, sockets[1]);
  assert.equal(sockets[0].sent?.some((frame) => frame.method === "prompt.submit") || false, false);
  assert.equal((await client.request("session.create")).ok, true);
  client.close();
});

test("spawns hermes serve, authenticates the socket, and correlates RPC responses", async () => {
  const child = new FakeChild();
  const spawnImpl = (_command, args, options) => {
    assert.deepEqual(args.slice(-5), ["serve", "--host", "127.0.0.1", "--port", "0"]);
    assert.ok(options.env.HERMES_DASHBOARD_SESSION_TOKEN);
    assert.equal("TERMINAL_CWD" in options.env, false);
    setImmediate(() => child.stdout.write("HERMES_BACKEND_READY port=43210\n"));
    return child;
  };
  const client = new HermesGatewayClient({
    candidates: () => [{ cmd: "hermes", args: [] }],
    WebSocketImpl: FakeWebSocket,
    spawnImpl,
    env: {},
    startupTimeoutMs: 1000,
  });
  await client.start();
  assert.deepEqual(client.socket.sent[0], {
    jsonrpc: "2.0", method: "client.capabilities", params: { server_requests: true },
  });
  assert.match(client.socket.url, /^ws:\/\/127\.0\.0\.1:43210\/api\/ws\?token=/);
  const result = await client.request("session.create", { source: "iris" });
  assert.deepEqual(result, { method: "session.create", ok: true });
  client.close();
});

test("server requests are answered once, cancelled by exact id, and re-advertised after reconnect", async () => {
  const child = new FakeChild();
  const client = new HermesGatewayClient({ candidates: () => [{ cmd: "hermes", args: [] }], WebSocketImpl: FakeWebSocket,
    spawnImpl: () => { setImmediate(() => child.stdout.write("HERMES_BACKEND_READY port=43211\n")); return child; }, env: {} });
  const requests = [];
  client.on("server-request", (frame) => requests.push(frame));
  await client.start();
  const socket = client.socket;
  const deliver = (frame) => socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
  const approval = { jsonrpc: "2.0", id: "srq-test", method: "approval", params: { session_id: "live-1" } };
  deliver(approval); deliver(approval);
  assert.equal(requests.length, 1);
  client.respondServerRequest(approval.id, { choice: "deny" });
  assert.deepEqual(socket.sent.at(-1), { jsonrpc: "2.0", id: "srq-test", result: { choice: "deny" } });
  assert.throws(() => client.respondServerRequest(approval.id, { choice: "once" }), /no longer pending/);
  deliver({ ...approval, id: "srq-cancel" });
  deliver({ method: "event", params: { type: "request.cancel", session_id: "live-1", payload: { id: "srq-cancel" } } });
  assert.throws(() => client.respondServerRequest("srq-cancel", { choice: "once" }), /no longer pending/);
  socket.dispatchEvent(new Event("close"));
  await client.connect();
  assert.equal(client.socket.sent[0].method, "client.capabilities");
  // An old connection cannot cancel or answer a replay on the new socket.
  client.receiveServerRequest(approval);
  deliver({ method: "event", params: { type: "request.cancel", payload: { id: approval.id } } });
  client.respondServerRequest(approval.id, { choice: "once" });
  assert.equal(client.socket.sent.at(-1).result.choice, "once");
  client.close();
});
