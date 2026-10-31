import { spokenText, conversationLanguage } from "../electron/conversationLanguage.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { VoiceRelay, permissionNotice } from "../electron/voiceRelay.mjs";
import { AnnouncementLedger } from "../electron/liveSessionState.mjs";

const source = ts.createSourceFile("main.mjs", fs.readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(["handleInteractiveRequest", "announceHermesInteraction", "announceHermesApproval", "dismissHermesNotice"]);
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map((node) => node.getText(source)).join("\n");
function setup({ legacy = false, language = "Tamam" } = {}) {
  const sent = [], events = [], offers = [];
  const relay = new VoiceRelay({ send: (frame) => sent.push(frame), audio() {}, interrupt() {} });
  relay.connect();
  const state = { spokenText, conversationLanguage, permissionNotice, voiceRelay: relay, latestRelayUserText: language, announcementLedger: new AnnouncementLedger(),
    brainRelayEnabled: () => !legacy, liveSession: {}, pendingHermesInteractions: new Map(),
    conversationHermes: null, runRegistry: { setInteraction() {}, get: () => ({ sessionId: "chat" }) },
    offerPhoneInput: (...args) => offers.push(args), emitEvent: (event) => events.push(event), requestAutoWake() {},
    mainWindow: { isDestroyed: () => false, showInactive() {} }, userDisplayName: () => "Fatih", sendLiveText: (text) => sent.push(text) };
  vm.createContext(state); vm.runInContext(functions, state);
  return { state, relay, sent, events, offers };
}
const card = { id: "srq-1", type: "approval", question: "CARD-DETAIL-DO-NOT-READ", command: "TECHNICAL-COMMAND-DO-NOT-READ", choices: ["once", "session", "always", "deny"], secret: false };

test("native permission cards keep every detail on screen but voice receives only the short notice", () => {
  const f = setup();
  f.state.handleInteractiveRequest({ runId: "run-1", task: "PRIVATE-TASK", interaction: card });
  const visible = f.events.find((event) => event.type === "hermes_interaction").interaction;
  assert.equal(visible.command, card.command);
  assert.equal(visible.question, card.question);
  assert.deepEqual(visible.choices, card.choices);
  assert.equal(f.offers[0][2].command, card.command);
  assert.equal(f.relay.active.text, permissionNotice("Tamam"));
  assert.doesNotMatch(f.sent[0], /CARD-DETAIL|TECHNICAL-COMMAND|PRIVATE-TASK|once|always|deny/);
  assert.match(f.sent[0], /srq-1/);
});

test("HTTP approvals and legacy voice events never include approval contents in the readout", () => {
  for (const legacy of [false, true]) {
    const f = setup({ legacy, language: "Please open Calculator" });
    f.state.announceHermesApproval("run-1", "PRIVATE-TASK", { command: card.command, reason: card.question, choices: card.choices });
    assert.match(f.sent[0], /Sir, this action needs your permission/);
    assert.doesNotMatch(f.sent[0], /CARD-DETAIL|TECHNICAL-COMMAND|PRIVATE-TASK/);
    if (legacy) assert.match(f.sent[0], /Never read, summarize or invent card contents/);
    else assert.equal(f.relay.active.text, permissionNotice("Please open Calculator"));
  }
});

test("clarification questions remain usable and secure cards never speak their contents", () => {
  const f = setup();
  f.state.handleInteractiveRequest({ runId: "run-1", task: "task", interaction: { id: "clarify-1", type: "clarify", question: "Which app?", choices: ["Calculator", "Notepad"] } });
  assert.match(f.sent[0], /Which app/);
  assert.match(f.sent[0], /Calculator/);
  const secure = setup();
  secure.state.handleInteractiveRequest({ runId: "run-1", task: "task", interaction: { id: "secret-1", type: "secret", secret: true, question: "SECRET-DO-NOT-READ" } });
  assert.equal(secure.sent.length, 0);
});

test("resolved notice cleanup targets exact run/request IDs in both speech and legacy queues", () => {
  const f = setup();
  f.relay.userStarted();
  f.relay.enqueue("OLD", { notification: true, runId: "run-1", interactionId: "request-1" });
  f.relay.enqueue("NEW", { notification: true, runId: "run-1", interactionId: "request-2" });
  f.state.announcementLedger.enqueue("SYSTEM_EVENT_HERMES_INTERACTION_REQUIRED\nrun_id: run-1\ninteraction_id: request-1");
  f.state.announcementLedger.enqueue("SYSTEM_EVENT_HERMES_INTERACTION_REQUIRED\nrun_id: run-10\ninteraction_id: request-1");
  f.state.announcementLedger.enqueue("SYSTEM_EVENT_HERMES_COMPLETE\nrun_id: run-1");
  f.state.dismissHermesNotice("run-1", "request-1");
  assert.equal(f.relay.queue.length, 1);
  assert.equal(f.relay.queue[0].interactionId, "request-2");
  assert.equal(f.state.announcementLedger.pending.length, 2);
  assert.ok(f.state.announcementLedger.pending.every((text) => !text.endsWith("run-1\ninteraction_id: request-1")));
});
