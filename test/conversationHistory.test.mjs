import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { decodeBrainReply } from "../electron/voiceRelay.mjs";
import { proposalReadback } from "../electron/brainReply.mjs";

const source = ts.createSourceFile("main.mjs", fs.readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "fetchConversationHistory").getText(source);

function fixture(messages, request) {
  const events = [];
  const context = vm.createContext({ hermesSessionId: () => "original-chat", brainRelayEnabled: () => true,
    hermesRequest: request || (async () => ({ data: messages })), decodeBrainReply, proposalReadback,
    formatHermesBrief: (proposal) => `Goal:\n${proposal.goal}`, emitEvent: (event) => events.push(event) });
  vm.runInContext(fn, context);
  return { load: () => context.fetchConversationHistory(), events };
}

test("a malformed archived reply cannot hide the conversation or change the saved messages", async () => {
  const messages = [
    { id: 1, role: "user", content: "Önceki konuşmamız" },
    { id: 2, role: "assistant", content: '{"reply":"Geçerli yanıt","proposal":null}' },
    { id: 3, role: "assistant", content: '{"reply":"Eksik kapanış' },
    { id: 4, role: "user", content: "Sonraki soru" },
    { id: 5, role: "assistant", content: '{"reply":"Sonraki yanıt","proposal":null}' },
  ];
  const before = JSON.stringify(messages), { load, events } = fixture(messages);
  const result = await load();
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "original-chat");
  assert.equal(result.messages.length, 5);
  assert.equal(result.messages[2].text, messages[2].content);
  assert.equal(result.messages.at(-1).text, "Sonraki yanıt");
  assert.equal(JSON.stringify(messages), before);
  assert.equal(events.length, 1);
  assert.ok(!events[0].message.includes("Eksik kapanış"), "diagnostics must not contain conversation content");
  assert.throws(() => decodeBrainReply(messages[2].content), /malformed/);
});

test("history preserves its hidden-context filters, legacy text and last-100 window", async () => {
  const messages = Array.from({ length: 110 }, (_, id) => ({ id, role: "user", content: `Message ${id}` }));
  messages.push({ id: 111, role: "user", display_kind: "hidden", content: "private context" },
    { id: 112, role: "user", content: "Stored source for the conversation: hidden" },
    { id: 113, role: "assistant", content: "Legacy spoken answer" });
  const result = await fixture(messages).load();
  assert.equal(result.ok, true);
  assert.equal(result.messages.length, 100);
  assert.equal(result.messages.at(-1).text, "Legacy spoken answer");
  assert.equal(result.messages.some((message) => message.text.includes("hidden") || message.text.includes("private context")), false);
});

test("a failed history connection is reported as a load error without inventing or deleting messages", async () => {
  const result = await fixture([], async () => { throw new Error("offline"); }).load();
  assert.equal(result.ok, false);
  assert.equal(result.error, "offline");
  assert.equal(result.messages.length, 0);
});
