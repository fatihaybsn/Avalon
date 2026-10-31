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
  assert.deepEqual(FakeWebSocket.instances[0].sent[0], {
    jsonrpc: "2.0", method: "client.capabilities", params: { server_requests: true },
  });
  assert.match(FakeWebSocket.instances[0].url, /^ws:\/\/127\.0\.0\.1:43210\/api\/ws\?token=/);
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
