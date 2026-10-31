import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import crypto from "node:crypto";
import http from "node:http";
import WebSocket from "ws";
import { RemoteState } from "../electron/remoteState.mjs";
import { RemoteServer } from "../electron/remoteServer.mjs";
import { VoiceDevice } from "../electron/voiceDevice.mjs";
import { proposeHermesTask, markModelTurnInterrupted, restartProposalReadback, claimConfirmedProposal, getHermesProposal, resetHermesGate } from "../electron/hermesGate.mjs";

function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-remote-"));
  const state = new RemoteState({ file: path.join(dir, "remote.json"), ...options });
  t.after(() => { state.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { state, dir };
}
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/example", keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } };
function pair(state) { const { code } = state.newCode(); const token = state.pairDevice(code, "Android"); return { token, device: state.authenticate(token) }; }

test("pairing is single-use, bounded, persists only token hashes and supports revocation", (t) => {
  const { state, dir } = setup(t);
  const { token, device } = pair(state);
  assert.ok(device); assert.equal(state.authenticate("wrong"), null);
  assert.doesNotMatch(fs.readFileSync(state.file, "utf8"), new RegExp(token));
  assert.equal(JSON.stringify(state.status()).includes("tokenHash"), false);
  assert.throws(() => state.pairDevice("123456"));
  const restored = new RemoteState({ file: path.join(dir, "remote.json") }); t.after(() => restored.close());
  assert.equal(restored.authenticate(token), device);
  state.revoke(); assert.equal(state.authenticate(token), null);
  const p = state.newCode();
  for (let i = 0; i < 5; i++) assert.throws(() => state.pairDevice("invalid"));
  assert.throws(() => state.pairDevice(p.code));
});

test("mutating commands are deduplicated across retries and restart, including uncertain in-flight requests", async (t) => {
  const { state } = setup(t); const { device } = pair(state); let calls = 0;
  const id = crypto.randomUUID();
  const operation = () => { calls++; return { run_id: "r", status: "started" }; };
  await state.execute(device, id, "submit", ["task"], operation);
  await state.execute(device, id, "submit", ["task"], operation);
  const restored = new RemoteState({ file: state.file }); t.after(() => restored.close());
  await restored.execute(device, id, "submit", ["task"], operation); assert.equal(calls, 1);
  await assert.rejects(state.execute(device, id, "submit", ["other"], operation), /farklı/);
  let release; const held = new Promise((resolve) => { release = resolve; });
  const pendingId = crypto.randomUUID();
  const running = state.execute(device, pendingId, "approve", [], () => held);
  await assert.rejects(state.execute(device, pendingId, "approve", [], operation), /alınmış/);
  release({ ok: true }); await running;
});

test("notifications are opt-in, independent of speech, deduplicated and contain no task secrets", async (t) => {
  const sent = []; const { state } = setup(t, { sendPush: async (...args) => sent.push(args) }); pair(state); state.subscribe(subscription);
  state.offer({ id: "off", runId: "r", kind: "done" }); assert.equal(state.data.outbox.length, 0);
  state.setNotifications(true);
  state.offer({ id: "off", runId: "r", kind: "done" }); assert.equal(state.data.outbox.length, 0, "enabling cannot replay old events");
  const value = { id: "once", runId: "r", kind: "input", question: "secret-command", password: "private" };
  state.offer(value); state.offer(value); assert.equal(state.data.outbox.length, 1);
  state.data.outbox[0].next = 0; await state.flush(); assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0][1], /secret-command|private/);
  state.offer({ id: "visible", runId: "r", kind: "input" }); state.viewed(["visible"]); assert.equal(state.data.outbox.length, 0);
  state.offer({ id: "already-resolved", runId: "r", kind: "input" }); state.isCurrent = () => false;
  state.data.outbox[0].next = 0; await state.flush(); assert.equal(sent.length, 1); assert.equal(state.data.outbox.length, 0);
  state.offer({ id: "disabled", runId: "r", kind: "done" }); state.setNotifications(false); assert.equal(state.data.outbox.length, 0);
  assert.equal(state.status().notifications, false);
});

test("push failures do not fail tasks; expired subscriptions are removed and arbitrary endpoints rejected", async (t) => {
  const { state } = setup(t, { sendPush: async () => { throw { statusCode: 410 }; } }); pair(state);
  assert.throws(() => state.subscribe({ ...subscription, endpoint: "https://127.0.0.1/private" }));
  state.subscribe(subscription); state.setNotifications(true); state.offer({ id: "gone", kind: "done" });
  state.data.outbox[0].next = 0; await state.flush();
  assert.equal(state.status().pushReady, false); assert.equal(state.data.outbox.length, 0);
});

test("replacing a phone while a push is in flight cannot erase the new phone's subscription", async (t) => {
  let reject;
  const held = new Promise((_resolve, fail) => { reject = fail; });
  const { state } = setup(t, { sendPush: () => held }); pair(state); state.subscribe(subscription); state.setNotifications(true);
  state.offer({ id: "old-device", kind: "done" }); state.data.outbox[0].next = 0;
  const sending = state.flush();
  pair(state); state.subscribe(subscription);
  reject({ statusCode: 410 }); await sending;
  assert.equal(state.status().pushReady, true);
});

test("voice ownership fences late frames; replaying a proposal after handoff never supplies consent", () => {
  const owner = new VoiceDevice(); assert.equal(owner.accepts("desktop"), true);
  const first = owner.claim("phone"); assert.equal(owner.accepts("desktop"), false);
  owner.release("phone"); const second = owner.claim("phone");
  assert.equal(owner.accepts("phone", first.generation), false); assert.equal(owner.accepts("phone", second.generation), true);
  const renewed = owner.claim("phone", { renew: true });
  assert.equal(owner.accepts("phone", second.generation), false); assert.equal(owner.accepts("phone", renewed.generation), true);
  resetHermesGate(); const { proposal } = proposeHermesTask("same task", "normal", { sessionId: "chat" });
  markModelTurnInterrupted(); assert.equal(restartProposalReadback({ proposalId: proposal.id, sessionId: "wrong" }), false);
  assert.equal(restartProposalReadback({ proposalId: proposal.id, sessionId: "chat" }), true);
  assert.equal(getHermesProposal().stage, "awaiting_readback");
  assert.equal(claimConfirmedProposal({ proposalId: proposal.id, sessionId: "chat" }).ok, false); resetHermesGate();
});

test("HTTP and WebSocket adapters enforce host/origin/auth, app methods, request identity and audio ownership", async (t) => {
  const { state, dir } = setup(t); const owner = new VoiceDevice(); let calls = 0; const received = [];
  fs.mkdirSync(path.join(dir, "web")); fs.writeFileSync(path.join(dir, "web", "index.html"), "Iris");
  const server = new RemoteServer({ state, root: path.join(dir, "web"), origin: "https://iris.example.ts.net", port: 0,
    snapshot: () => ({ tasks: [] }), invoke: () => { calls++; return { ok: true }; }, voiceOwner: () => owner.status(),
    onAudio: (data) => received.push(data.toString()), onControl() {}, onAudioDisconnect: (id, generation) => { if (owner.accepts(id, generation)) owner.release(id); } });
  await server.start(); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`, origin = server.origin;
  // Node fetch rewrites Host; use an HTTP client that models the TLS reverse proxy.
  const fetch = (url, options = {}) => new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = ""; res.on("data", (part) => { body += part; });
      res.on("end", () => resolve({ status: res.statusCode, json: async () => JSON.parse(body), headers: { get: (name) => Array.isArray(res.headers[name]) ? res.headers[name].join("; ") : res.headers[name] } }));
    });
    req.on("error", reject); req.end(options.body);
  });
  const headers = { Host: server.host, Origin: origin, "Content-Type": "application/json" };
  let response = await fetch(`${base}/api/v1/state`, { headers }); assert.equal(response.status, 401);
  response = await fetch(`${base}/`, { headers: { Host: "evil.example" } }); assert.equal(response.status, 403);
  const { code } = state.newCode();
  response = await fetch(`${base}/api/v1/pair`, { method: "POST", headers, body: JSON.stringify({ code }) });
  assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);
  const auth = { ...headers, Cookie: cookie };
  response = await fetch(`${base}/api/v1/state`, { headers: { ...auth, Origin: "https://evil.example" } }); assert.equal(response.status, 403);
  response = await fetch(`${base}/api/v1/state`, { headers: auth }); assert.deepEqual(await response.json(), { tasks: [] });
  const body = JSON.stringify({ method: "saveConfig", args: [{}], requestId: crypto.randomUUID() });
  for (let i = 0; i < 2; i++) { response = await fetch(`${base}/api/v1/rpc`, { method: "POST", headers: auth, body }); assert.equal(response.status, 200); }
  assert.equal(calls, 1);
  response = await fetch(`${base}/api/v1/rpc`, { method: "POST", headers: auth, body: JSON.stringify({ method: "exec", args: ["arbitrary"] }) }); assert.equal(response.status, 400);
  const device = state.data.device.id; owner.claim(device);
  const events = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/events`, { headers: auth });
  await once(events, "open"); const eventFrames = []; events.on("message", (data) => eventFrames.push(JSON.parse(data)));
  server.publish("live:audio", { data: "must-not-broadcast" });
  server.publish("sidecar:event", { type: "brain_status", status: "running" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(eventFrames.map((frame) => frame.channel), ["sidecar:event"]);
  events.close();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/audio`, { headers: auth });
  await once(ws, "open"); ws.send(Buffer.from("pcm!"));
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.deepEqual(received, ["pcm!"]);
  const closed = once(ws, "close"); const renewed = owner.claim(device, { renew: true }); ws.send(Buffer.from("late")); await closed;
  assert.equal(owner.accepts(device, renewed.generation), true, "old socket closure cannot release the new generation on the same phone");
  assert.deepEqual(received, ["pcm!"]);
  state.revoke(); response = await fetch(`${base}/api/v1/state`, { headers: auth }); assert.equal(response.status, 401);
});
