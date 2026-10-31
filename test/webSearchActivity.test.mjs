import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { bindConversationWebSearch } from "../electron/webSearchActivity.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";

function fixture() {
  const transport = new EventEmitter(), runs = new Map(), events = [];
  transport.getRun = (id) => runs.get(id);
  bindConversationWebSearch(transport, (event) => events.push(event));
  const add = (id, sessionId = "chat-a", kind = "conversation") => runs.set(id, { runId: id, storedSessionId: sessionId, kind });
  const tool = (runId, toolId, name, event = "tool.started", isError = false) =>
    transport.emit("run-event", { runId, toolId, tool: name, event, isError });
  return { transport, runs, events, add, tool };
}

test("web activity follows actual tools and waits for all overlapping calls", () => {
  const f = fixture(); f.add("run");
  f.transport.emit("run-event", { runId: "run", event: "message.delta", delta: "Searching..." });
  f.tool("unknown", "x", "web_search"); f.tool("run", "clarify", "clarify");
  assert.equal(f.events.length, 0);
  f.tool("run", "s1", "web_search"); f.tool("run", "s2", "web_search"); f.tool("run", "e", "web_extract");
  f.tool("run", "s1", "web_search", "tool.completed");
  f.tool("run", "s2", "web_search", "tool.completed");
  assert.equal(f.events.at(-1).state, "searching");
  f.tool("run", "e", "web_extract", "tool.completed", true);
  assert.equal(f.events.at(-1).state, "idle");
  assert.equal(f.events.at(-1).is_error, true);
  assert.ok(f.events.every((event) => event.session_id === "chat-a"));
  assert.equal(f.events[0].tool_event, "tool.started");
});

test("activity stays scoped to chats and completion clears interrupted tools", () => {
  const f = fixture(); f.add("a1"); f.add("a2"); f.add("b", "chat-b"); f.add("context", "chat-a", "context"); f.add("worker", "chat-a", "task");
  f.tool("context", "c", "web_search"); f.tool("worker", "w", "web_search");
  assert.equal(f.events.length, 0);
  f.tool("a1", "s1", "web_search"); f.tool("a2", "s2", "web_extract"); f.tool("b", "s3", "web_search");
  f.transport.emit("complete", { ...f.runs.get("a1"), status: "cancelled" });
  assert.equal(f.events.at(-1).state, "searching");
  f.transport.emit("complete", { ...f.runs.get("a2"), status: "failed" });
  assert.equal(f.events.at(-1).session_id, "chat-a");
  assert.equal(f.events.at(-1).state, "idle");
  f.tool("b", "s3", "web_search", "tool.completed");
  assert.equal(f.events.at(-1).session_id, "chat-b");
  assert.equal(f.events.at(-1).state, "idle");
});

test("real transport tool frames and backend failure clear the observer", async () => {
  const client = new EventEmitter();
  client.irisContractVersions = [2];
  client.request = async (method) => method === "session.create"
    ? { session_id: "live", stored_session_id: "chat" }
    : method === "tools.show" ? { sections: [{ tools: [{ name: "web_search" }, { name: "web_extract" }] }] } : { status: "ok" };
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
  const events = []; bindConversationWebSearch(transport, (event) => events.push(event));
  await transport.submit({ task: "Search", kind: "conversation" });
  await new Promise(setImmediate);
  client.emit("event", { type: "tool.start", session_id: "live", payload: { name: "web_search", tool_id: "search" } });
  assert.equal(events.at(-1).state, "searching");
  client.emit("backend-exit", { code: 1 });
  assert.equal(events.at(-1).state, "idle");
  assert.equal(events.at(-1).session_id, "chat");
});
