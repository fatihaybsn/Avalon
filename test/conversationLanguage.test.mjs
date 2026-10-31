import test from "node:test";
import assert from "node:assert/strict";
import { conversationLanguage, languageInstructions, spokenText } from "../electron/conversationLanguage.mjs";
import { conversationInstructions, permissionNotice, relayInstructions } from "../electron/voiceRelay.mjs";
import { proposalReadback } from "../electron/brainReply.mjs";

test("English changes only conversation language clauses and leaves shared contracts intact", () => {
  assert.equal(conversationLanguage({}), "tr");
  assert.equal(conversationLanguage({ IRIS_CONVERSATION_LANGUAGE: "en" }), "en");
  assert.equal(languageInstructions("tr"), "");
  const english = conversationInstructions("en");
  assert.equal(english.replace("in English. Think", "in their language. Think")
    .replace('scope, in English"', 'scope, in the user\'s language"')
    .replace(`\n${languageInstructions("en")}`, ""), conversationInstructions("tr"));
  assert.match(english, /final task results/);
  assert.match(relayInstructions(), /No preface, summary, translation/);
});

test("English permission and fixed speech do not depend on Turkish user input", () => {
  assert.equal(permissionNotice("Evet, bu dosyayı aç", "en"), "Sir, this action needs your permission. Please use the on-screen card.");
  assert.equal(permissionNotice("İzin ver", "tr"), "Efendim, işlem için izniniz gerekiyor; karttan onaylayabilirsiniz.");
  assert.equal(spokenText("taskSubmitted", "en"), "I've sent the request to start the task.");
  assert.equal(spokenText("taskSubmitted", "tr"), "Görevi başlatma isteğini gönderdim.");
  assert.equal(spokenText("goodbye", "en"), "Goodbye.");
});

test("English fallback confirmations preserve exact targets and existing readbacks stay immutable", () => {
  const task = { summary: "Create Fatih.txt", task: "Goal:\nCreate Fatih.txt\n\nConstraints:\nDo not overwrite" };
  assert.equal(proposalReadback(task, "en"), "Create Fatih.txt\nDo you approve starting this task?");
  assert.equal(proposalReadback(task, "tr"), "Create Fatih.txt\nBaşlatmamı onaylıyor musun?");
  const readback = "Fatih.txt dosyasını oluşturacağım. Onaylıyor musun?";
  assert.equal(proposalReadback({ ...task, readback }, "en"), readback);
});
