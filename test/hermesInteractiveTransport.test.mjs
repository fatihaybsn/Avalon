import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";
import { brainProviderSlug } from "../electron/brainReasoning.mjs";

class FakeGatewayClient extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
  }

  async start() {}

  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "session.resume") {
      return {
        session_id: "live-1",
        resumed: params.session_id,
        session_key: params.session_id,
      };
    }
    if (method === "session.create") {
      return { session_id: "live-new", stored_session_id: "stored-new" };
    }
    if (method === "config.set" && params.key === "yolo") return { key: "yolo", scope: "session", value: params.value };
    return { status: "ok" };
  }

  close() {}

  respondServerRequest(id, result, error) { this.calls.push({ responseId: id, result, error }); }
  receiveServerRequest(frame) { this.emit("server-request", frame); }
}

test("full access applies to existing and new workers and standard restores native gates before work", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client, permissionMode: "standard" });
  await transport.ensureSession("existing-worker");
  await transport.setPermissionMode("full");
  assert.deepEqual(client.calls.at(-1).params, { session_id: "live-1", key: "yolo", value: "1", scope: "session" });
  await transport.createSession({ hidden: true });
  await transport.submit({ task: "new work", sessionId: "stored-new" });
  await new Promise(setImmediate);
  const promptIndex = client.calls.findIndex((call) => call.method === "prompt.submit");
  assert.ok(client.calls.slice(0, promptIndex).some((call) => call.method === "config.set" && call.params.session_id === "live-new" && call.params.value === "1"));
  await transport.setPermissionMode("standard");
  assert.equal(transport.permissionMode, "standard");
  assert.deepEqual(client.calls.slice(-2).map((call) => call.params.value), ["0", "0"]);
  assert.ok(client.calls.filter((call) => call.method === "config.set").every((call) => call.params.scope === "session" && call.params.session_id));
});

test("enabling full access releases an existing approval but preserves clarification and secure input", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client, permissionMode: "standard" });
  const run = await transport.submit({ task: "desktop work", sessionId: "existing" });
  await new Promise(setImmediate);
  for (const method of ["approval", "clarify", "secret"]) {
    client.emit("server-request", { id: `srq-${method}`, method, params: { session_id: "live-1", questions: [{ qid: "one", question: "Question" }], prompt: "Value", choices: ["once", "deny"] } });
    await transport.setPermissionMode("full");
    if (method === "approval") {
      assert.deepEqual(client.calls.at(-1).result, { choice: "once" });
      assert.equal(transport.getRun(run.run_id).interaction, null);
    } else {
      assert.equal(transport.getRun(run.run_id).interaction.type, method);
      assert.equal(client.calls.some((call) => call.responseId === `srq-${method}`), false);
      client.emit("event", { type: "request.cancel", session_id: "live-1", payload: { id: `srq-${method}` } });
    }
  }
});

test("a rejected native mode change rolls back and never submits work with an unconfirmed mode", async () => {
  const client = new FakeGatewayClient();
  const original = client.request.bind(client);
  client.request = async (method, params) => {
    const result = await original(method, params);
    return method === "config.set" && params.value === "1" ? { key: "yolo", scope: "global", value: "1" } : result;
  };
  const transport = new HermesInteractiveTransport({ client, permissionMode: "standard" });
  await transport.ensureSession("worker");
  await assert.rejects(transport.setPermissionMode("full"), /doğrulamadı/);
  assert.equal(transport.permissionMode, "standard");
  assert.equal(client.calls.at(-1).params.value, "0");
  const full = new HermesInteractiveTransport({ client, permissionMode: "full" });
  const run = await full.submit({ task: "must wait", sessionId: "worker" });
  await new Promise(setImmediate);
  assert.equal(full.getRun(run.run_id).status, "failed");
  assert.equal(client.calls.some((call) => call.method === "prompt.submit"), false);
});

test("conversation cannot enable full access and a saved full setting cannot widen its tools", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true, permissionMode: "full" });
  await assert.rejects(transport.setPermissionMode("full"), /Geçersiz/);
  assert.equal(transport.permissionMode, null);
  assert.equal(client.calls.length, 0);
});

test("current Hermes approval frames preserve exact ids, offered scopes and cancellation", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client });
  const run = await transport.submit({ task: "Desktop action", sessionId: "stored-1" });
  await new Promise(setImmediate);
  const frame = { id: "srq-action", method: "approval", params: { session_id: "live-1", request_id: "queue-1", command: "click calculator", choices: ["once", "deny"] } };
  client.emit("server-request", frame);
  assert.equal(transport.getRun(run.run_id).status, "waiting_for_approval");
  await assert.rejects(transport.respond(run.run_id, { interactionId: frame.id, type: "approval", value: "always" }), /not offered/);
  await transport.respond(run.run_id, { interactionId: frame.id, type: "approval", value: "deny" });
  assert.deepEqual(client.calls.at(-1), { responseId: frame.id, result: { choice: "deny" }, error: undefined });
  await assert.rejects(transport.respond(run.run_id, { interactionId: frame.id, type: "approval", value: "once" }), /No pending/);
  client.emit("server-request", { ...frame, id: "srq-next" });
  client.emit("event", { type: "request.cancel", session_id: "live-1", payload: { id: "srq-next" } });
  assert.equal(transport.getRun(run.run_id).interaction, null);
  client.emit("server-request", { ...frame, id: "srq-wrong", params: { ...frame.params, session_id: "other-session" } });
  assert.equal(client.calls.at(-1).error.code, 4404);
});

test("batch clarify uses sequential Iris cards and one result with all answers", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client });
  const run = await transport.submit({ task: "Clarify", sessionId: "stored-1" });
  await new Promise(setImmediate);
  client.emit("server-request", { id: "srq-batch", method: "clarify", params: { session_id: "live-1", questions: [
    { qid: "a", question: "Which app?", choices: ["Calculator"] }, { qid: "b", question: "Which action?" },
  ] } });
  let pending = transport.getRun(run.run_id).interaction;
  await transport.respond(run.run_id, { interactionId: pending.id, type: "clarify", value: "Calculator" });
  pending = transport.getRun(run.run_id).interaction;
  assert.equal(pending.question, "Which action?");
  assert.equal(client.calls.some((call) => call.responseId), false);
  await transport.respond(run.run_id, { interactionId: pending.id, type: "clarify", value: "Open" });
  assert.deepEqual(client.calls.at(-1), { responseId: "srq-batch", result: { answers: { a: "Calculator", b: "Open" }, outcome: "submitted" }, error: undefined });
});

test("sudo and secret remain masked and unsupported UI bridges return an explicit error", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client });
  const run = await transport.submit({ task: "Secure prompt", sessionId: "stored-1" });
  await new Promise(setImmediate);
  for (const type of ["sudo", "secret"]) {
    client.emit("server-request", { id: `srq-${type}`, method: type, params: { session_id: "live-1", env_var: "TEST_KEY", prompt: "Enter value" } });
    const pending = transport.getRun(run.run_id).interaction;
    assert.equal(pending.secret, true);
    await transport.respond(run.run_id, { interactionId: pending.id, type, value: "test-only" });
    assert.deepEqual(client.calls.at(-1).result, { value: "test-only" });
  }
  client.emit("server-request", { id: "srq-preview", method: "preview.read", params: { session_id: "live-1" } });
  assert.equal(client.calls.at(-1).error.code, 4404);
  client.emit("server-request", { id: "srq-unknown", method: "unknown", params: {} });
  assert.equal(client.calls.at(-1).error.code, -32601);
});

test("native route changes preserve transcript identity and include revision/generation fences", async () => {
  class RoutedGateway extends FakeGatewayClient {
    async request(method, params) {
      const result = await super.request(method, params);
      if (method === "session.resume") return { ...result, revision: 4, execution_generation: 2 };
      return result;
    }
  }
  const client = new RoutedGateway();
  const effective = [];
  const transport = new HermesInteractiveTransport({ client, onRoute: (id, route) => effective.push({ id, route }) });
  const route = { provider: "opencode", modelId: "beam-free" };
  await transport.switchModel("existing-chat", route);
  const mutation = client.calls.find((call) => call.method === "session.mutate").params;
  assert.equal(mutation.session_id, "existing-chat");
  assert.equal(mutation.expected_revision, 4);
  assert.equal(mutation.expected_generation, 2);
  assert.deepEqual(mutation.payload, { provider: "iris-opencode", model: "beam-free" });
  assert.equal(client.calls.some((call) => call.method === "session.create"), false);
  assert.deepEqual(effective, [{ id: "existing-chat", route }]);
  await transport.submit({ task: "work", sessionId: "existing-chat", route });
  await assert.rejects(transport.switchModel("existing-chat", { provider: "evren", modelId: "glm-5.3" }), /çalışıyor/);
});

test("new workers receive an explicit provider/model and never inherit a parent's older route", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client });
  await transport.createSession({ parentSessionId: "old-chat", hidden: true, route: { provider: "evren", modelId: "glm-5.3" } });
  const params = client.calls.find((call) => call.method === "session.create").params;
  assert.equal(params.provider, "iris-evren"); assert.equal(params.model, "glm-5.3");
  assert.equal(params.parent_session_id, "old-chat"); assert.equal(params.hidden, true);
});

test("a reasoning-only switch uses an isolated native provider and waits for its committed identity", async () => {
  const client = new FakeGatewayClient();
  const original = client.request.bind(client);
  client.request = async (method, params) => {
    const result = await original(method, params);
    return method === "config.set" ? { ...result, deferred: true } : result;
  };
  const effective = [];
  const transport = new HermesInteractiveTransport({ client, onRoute: (_id, route) => effective.push(route) });
  const base = { provider: "evren", modelId: "qwen3.8-flash-next" };
  const target = { ...base, reasoning: "disabled" };
  await transport.createSession({ route: base });
  await transport.switchModel("stored-new", target);
  assert.match(client.calls.find((c) => c.method === "config.set").params.value, /--provider iris-evren-qwen3-8-flash-next-disabled --session$/);
  client.emit("event", { type: "session.info", session_id: "live-new", payload: { model: base.modelId, provider: "iris-evren" } });
  assert.deepEqual(effective, [base]);
  client.emit("event", { type: "session.info", session_id: "live-new", payload: { model: base.modelId, provider: `custom:${brainProviderSlug(target)}` } });
  assert.deepEqual(effective, [base, target]);
});

test("standalone desktop model changes stay session-scoped and deferred picks are not advertised as active", async () => {
  const client = new FakeGatewayClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => {
    const value = await request(method, params);
    return method === "config.set" ? { key: "model", value: params.value, scope: "session", deferred: true } : value;
  };
  const effective = [];
  const transport = new HermesInteractiveTransport({ client, onRoute: (_id, route) => effective.push(route) });
  const route = { provider: "evren", modelId: "glm-5.3" };
  await transport.switchModel("chat", route);
  const set = client.calls.find((call) => call.method === "config.set").params;
  assert.equal(set.session_id, "live-1");
  assert.equal(set.value, "glm-5.3 --provider iris-evren --session");
  assert.doesNotMatch(set.value, /--global/);
  assert.equal(effective.length, 0);
  client.emit("event", { type: "session.info", session_id: "live-1", payload: { model: "glm-5.3", provider: "custom" } });
  assert.deepEqual(effective, [route]);
});

test("a model guard does not emit an effective route until its token is confirmed", async () => {
  const client = new FakeGatewayClient();
  const original = client.request.bind(client);
  client.request = async (method, params) => {
    const result = await original(method, params);
    if (method === "session.resume") return { ...result, revision: 3, execution_generation: 1 };
    if (method === "session.mutate" && !params.payload.confirm) return { status: "confirmation_required", confirm: "token", confirm_message: "Context warning" };
    return result;
  };
  let effective = 0;
  const transport = new HermesInteractiveTransport({ client, onRoute: () => effective++ });
  const route = { provider: "evren", modelId: "glm-5.3" };
  await assert.rejects(transport.switchModel("chat", route), (error) => error.confirmation.confirm === "token");
  assert.equal(effective, 0);
  await transport.switchModel("chat", route, { confirm: "token" });
  assert.equal(effective, 1);
});

test("full protocol pauses for clarification and resumes with the chosen answer", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client });
  const interactions = [];
  const completed = [];
  transport.on("interaction", (event) => interactions.push(event));
  transport.on("complete", (event) => completed.push(event));

  const run = await transport.submit({
    task: "Compare deployment options",
    sessionId: "stored-1",
    instructions: "Use the full interaction channel.",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(client.calls.some((call) => call.method === "prompt.submit"));

  client.emit("event", {
    type: "clarify.request",
    session_id: "live-1",
    payload: {
      request_id: "clarify-1",
      question: "Which environment?",
      choices: ["Staging", "Production"],
    },
  });
  assert.equal(interactions[0].interaction.type, "clarify");
  assert.equal(transport.getRun(run.run_id).status, "waiting_for_input");

  await transport.respond(run.run_id, {
    interactionId: "clarify-1",
    type: "clarify",
    value: "Staging",
  });
  assert.deepEqual(
    client.calls.find((call) => call.method === "clarify.respond").params,
    { request_id: "clarify-1", answer: "Staging" },
  );

  client.emit("event", {
    type: "message.complete",
    session_id: "live-1",
    payload: { status: "complete", text: "Deployed to staging." },
  });
  assert.equal(completed[0].status, "completed");
  assert.equal(completed[0].output, "Deployed to staging.");
});

test("full protocol preserves complete streamed output", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client });
  const completed = [];
  transport.on("complete", (event) => completed.push(event));
  await transport.submit({ task: "Return a long result", sessionId: "stored-1" });
  await new Promise((resolve) => setImmediate(resolve));
  const first = "A".repeat(15000);
  const second = "B".repeat(15000);
  client.emit("event", {
    type: "message.delta",
    session_id: "live-1",
    payload: { text: first },
  });
  client.emit("event", {
    type: "message.delta",
    session_id: "live-1",
    payload: { text: second },
  });
  client.emit("event", {
    type: "message.complete",
    session_id: "live-1",
    payload: { status: "complete" },
  });
  assert.equal(completed[0].output, first + second);
});

test("approval, sudo, and secret requests use their exact response methods", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client });
  const run = await transport.submit({ task: "Interactive task", sessionId: "stored-1" });
  await new Promise((resolve) => setImmediate(resolve));

  client.emit("event", {
    type: "approval.request",
    session_id: "live-1",
    payload: { command: "send-email", description: "External action" },
  });
  let pending = transport.getRun(run.run_id).interaction;
  await transport.respond(run.run_id, {
    interactionId: pending.id,
    type: "approval",
    value: "once",
  });
  assert.equal(
    client.calls.find((call) => call.method === "approval.respond").params.choice,
    "once",
  );

  client.emit("event", {
    type: "sudo.request",
    session_id: "live-1",
    payload: { request_id: "sudo-1" },
  });
  pending = transport.getRun(run.run_id).interaction;
  await transport.respond(run.run_id, {
    interactionId: pending.id,
    type: "sudo",
    value: "password",
  });
  assert.equal(
    client.calls.find((call) => call.method === "sudo.respond").params.password,
    "password",
  );

  client.emit("event", {
    type: "secret.request",
    session_id: "live-1",
    payload: { request_id: "secret-1", env_var: "API_KEY", prompt: "Enter API key" },
  });
  pending = transport.getRun(run.run_id).interaction;
  await transport.respond(run.run_id, {
    interactionId: pending.id,
    type: "secret",
    value: "secret-value",
  });
  assert.equal(
    client.calls.find((call) => call.method === "secret.respond").params.value,
    "secret-value",
  );
});

test("tasks in one stored session queue without interrupting the active turn", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client });
  const first = await transport.submit({ task: "First", sessionId: "stored-1" });
  const second = await transport.submit({ task: "Second", sessionId: "stored-1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    client.calls.filter((call) => call.method === "prompt.submit").length,
    1,
  );
  assert.equal(transport.getRun(second.run_id).status, "queued");

  client.emit("event", {
    type: "message.complete",
    session_id: "live-1",
    payload: { status: "complete", text: "First done" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    client.calls.filter((call) => call.method === "prompt.submit").length,
    2,
  );
  assert.equal(transport.getRun(first.run_id).status, "completed");
});

test("new sessions defer to Hermes terminal.cwd unless Iris has an explicit override", async () => {
  const defaultClient = new FakeGatewayClient();
  const defaultTransport = new HermesInteractiveTransport({ client: defaultClient });
  await defaultTransport.createSession();
  const defaultCreate = defaultClient.calls.find((call) => call.method === "session.create");
  assert.equal("cwd" in defaultCreate.params, false);

  const explicitClient = new FakeGatewayClient();
  const explicitTransport = new HermesInteractiveTransport({
    client: explicitClient,
    defaultCwd: "/safe/workspace",
  });
  await explicitTransport.createSession();
  const explicitCreate = explicitClient.calls.find((call) => call.method === "session.create");
  assert.equal(explicitCreate.params.cwd, "/safe/workspace");
});

test("conversation forwards literal speech into a real session only after checking its tool boundary", async () => {
  const client = new FakeGatewayClient();
  client.irisContractVersions = [1];
  const original = client.request.bind(client);
  client.request = async (method, params) => method === "tools.show"
    ? { sections: [{ tools: [{ name: "web_search" }, { name: "clarify" }] }] }
    : original(method, params);
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
  const text = "Kuyruk kullanmayalım. Bütçe 15.000 TL; /src/main.ts dosyasını tartışalım.";
  await transport.submit({ task: text, sessionId: "stored-1", kind: "conversation", context: "Read-only context" });
  await new Promise((resolve) => setImmediate(resolve));
  const prompt = client.calls.find((call) => call.method === "prompt.submit");
  assert.equal(prompt.params.text, text);
  assert.equal(prompt.params.voice_context, "Read-only context");
  assert.equal(prompt.params.voice_turn, undefined, "must not switch away from the session's main model");
  assert.equal(prompt.params.surface, "voice-live");
  assert.equal(prompt.params.iris_contract.version, 1);
  assert.match(prompt.params.iris_contract.instructions, /first person/);
  assert.doesNotMatch(prompt.params.voice_context, /first person/);
});

test("ignored tool restrictions fail closed before any user speech reaches the agent", async () => {
  const client = new FakeGatewayClient();
  client.irisContractVersions = [1];
  const original = client.request.bind(client);
  client.request = async (method, params) => method === "tools.show"
    ? { sections: [{ tools: [{ name: "terminal" }] }] } : original(method, params);
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
  const run = await transport.submit({ task: "Explain the architecture", sessionId: "stored-1", kind: "conversation" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transport.getRun(run.run_id).status, "failed");
  assert.equal(client.calls.some((call) => call.method === "prompt.submit"), false);
});

test("v2 requests one final-text recovery only for a visible conversation and keeps v1 for context", async () => {
  const client = new FakeGatewayClient();
  client.irisContractVersions = [1, 2];
  const original = client.request.bind(client);
  client.request = async (method, params) => method === "tools.show"
    ? { sections: [{ tools: [{ name: "web_search" }, { name: "web_extract" }, { name: "clarify" }] }] }
    : original(method, params);
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
  const completions = [];
  transport.on("complete", (item) => completions.push(item));
  const run = await transport.submit({ task: "Adın ne?", sessionId: "stored-1", kind: "conversation" });
  await new Promise(setImmediate);
  const prompt = client.calls.find((call) => call.method === "prompt.submit").params;
  assert.equal(prompt.iris_contract.version, 2);
  assert.equal(prompt.iris_contract.final_reply_repair, "plain_text_once");
  client.emit("event", { type: "message.delta", session_id: "live-1", payload: { delta: "Ben Avalon." } });
  assert.equal(completions.length, 0);
  assert.equal(transport.getRun(run.run_id).status, "running");
  const repaired = '{"reply":"Ben Avalon.","proposal":null}';
  client.emit("event", { type: "message.complete", session_id: "live-1", payload: { text: repaired, status: "complete" } });
  assert.equal(completions.length, 1);
  assert.equal(completions[0].output, repaired, "authoritative corrected text replaces streamed prose");
  await transport.submit({ task: "Hidden context", sessionId: "stored-1", kind: "context" });
  await new Promise(setImmediate);
  const context = client.calls.filter((call) => call.method === "prompt.submit").at(-1).params;
  assert.equal(context.iris_contract.version, 1);
  assert.equal(context.iris_contract.final_reply_repair, undefined);
});

test("stop during a v2 turn discards a late repaired completion", async () => {
  const client = new FakeGatewayClient();
  client.irisContractVersions = [1, 2];
  const original = client.request.bind(client);
  client.request = async (method, params) => method === "tools.show"
    ? { sections: [{ tools: [] }] } : original(method, params);
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
  const run = await transport.submit({ task: "Selam", sessionId: "stored-1", kind: "conversation" });
  await new Promise(setImmediate);
  await transport.stop(run.run_id);
  assert.equal(client.calls.at(-1).method, "session.interrupt");
  client.emit("event", { type: "message.complete", session_id: "live-1", payload: {
    status: "complete", text: '{"reply":"Geç yanıt.","proposal":null}',
  } });
  assert.equal(transport.getRun(run.run_id).status, "cancelled");
});

test("a backend exit while awaiting recovery cannot become a later successful completion", async () => {
  const client = new FakeGatewayClient();
  client.irisContractVersions = [1, 2];
  const original = client.request.bind(client);
  client.request = async (method, params) => method === "tools.show"
    ? { sections: [{ tools: [] }] } : original(method, params);
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
  const completed = [];
  transport.on("complete", (item) => completed.push(item));
  const run = await transport.submit({ task: "Adın ne?", sessionId: "stored-1", kind: "conversation" });
  await new Promise(setImmediate);
  client.emit("backend-exit", { code: 1 });
  client.emit("event", { type: "message.complete", session_id: "live-1", payload: {
    status: "complete", text: '{"reply":"Ben Avalon.","proposal":null}',
  } });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "failed");
  assert.equal(transport.getRun(run.run_id).status, "failed");
});

test("unsupported conversation contracts fail explicitly without submitting a turn", async () => {
  const client = new FakeGatewayClient();
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
  const run = await transport.submit({ task: "Hello", sessionId: "stored-1", kind: "conversation" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transport.getRun(run.run_id).status, "failed");
  assert.match(transport.getRun(run.run_id).error, /v1/);
  assert.equal(client.calls.some((call) => call.method === "prompt.submit"), false);
});

test("consecutive conversation turns keep their literal text, context and contract", async () => {
  const client = new FakeGatewayClient();
  client.irisContractVersions = [1];
  const original = client.request.bind(client);
  client.request = (method, params) => method === "tools.show" ? { sections: [{ tools: [{ name: "clarify" }] }] } : original(method, params);
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
  await transport.submit({ task: "Edge AI", sessionId: "stored-1", kind: "conversation", context: "first" });
  await transport.submit({ task: "Türkiye için", sessionId: "stored-1", kind: "conversation", context: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  client.emit("event", { type: "message.complete", session_id: "live-1", payload: { text: "Konuşalım.", status: "complete" } });
  await new Promise((resolve) => setImmediate(resolve));
  const turns = client.calls.filter((call) => call.method === "prompt.submit").map((call) => call.params);
  assert.deepEqual(turns.map((turn) => [turn.text, turn.voice_context]), [["Edge AI", "first"], ["Türkiye için", "second"]]);
  assert.deepEqual(turns[0].iris_contract, turns[1].iris_contract);
  client.emit("event", { type: "session.info", session_id: "live-1", payload: { model: "observed-model", provider: "observed-provider" } });
  assert.deepEqual(transport.getObservedRuntime("stored-1"), { model: "observed-model", provider: "observed-provider" });
});

test("queued conversation turns retain their selected language without changing literal input or tools", async () => {
  const client = new FakeGatewayClient();
  client.irisContractVersions = [1];
  const original = client.request.bind(client);
  client.request = (method, params) => method === "tools.show" ? { sections: [{ tools: [{ name: "clarify" }] }] } : original(method, params);
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
  await transport.submit({ task: "Birlikte düşünelim", sessionId: "stored-1", kind: "conversation", language: "en" });
  await transport.submit({ task: "Devam edelim", sessionId: "stored-1", kind: "conversation", language: "tr" });
  await new Promise(setImmediate);
  client.emit("event", { type: "message.complete", session_id: "live-1", payload: { text: "Let's discuss it.", status: "complete" } });
  await new Promise(setImmediate);
  const turns = client.calls.filter((call) => call.method === "prompt.submit").map((call) => call.params);
  assert.deepEqual(turns.map((turn) => turn.text), ["Birlikte düşünelim", "Devam edelim"]);
  assert.match(turns[0].iris_contract.instructions, /Talk directly to the user in English/);
  assert.match(turns[1].iris_contract.instructions, /Talk directly to the user in their language/);
  assert.doesNotMatch(turns[1].iris_contract.instructions, /English mode is selected/);
  assert.equal(turns[0].iris_contract.version, turns[1].iris_contract.version);
});
