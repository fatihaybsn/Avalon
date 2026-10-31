import { spokenText, conversationLanguage } from "../electron/conversationLanguage.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { deliverBrainReply, proposalReadback } from "../electron/brainReply.mjs";
import { VoiceRelay, decodeBrainReply, conversationContext, permissionNotice } from "../electron/voiceRelay.mjs";
import { AnnouncementLedger, LiveTurnState, ResumeHandleStore, hasGoogleSearchEvidence } from "../electron/liveSessionState.mjs";
import { RunRegistry, TERMINAL_RUN_STATUSES } from "../electron/runRegistry.mjs";
import { formatHermesCompletionEvent } from "../electron/hermesEvents.mjs";
import { isSleepIntent } from "../electron/sleepIntent.mjs";
import { VoiceDevice } from "../electron/voiceDevice.mjs";

// Exercise the real main-process functions and callbacks without launching
// services, using a user's configuration, or connecting to paid providers.
const source = ts.createSourceFile("main.mjs", fs.readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(["startLive", "stopLive", "sendWelcomeGreeting", "requestAutoWake", "recoverHermesRuns", "announceHermesCompletion", "startVoiceOnDevice", "handleLiveMessage", "startUserSpeechTurn", "relayUserText", "sendLiveText", "autoVoiceSleep", "recoverStalledSpeech", "announceHermesInteraction", "dismissHermesNotice"]);
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map((node) => node.getText(source)).join("\n");
const conversationFunction = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "getConversationHermes");
let completionCallback;
function findCompletion(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'transport.on' && node.arguments[0]?.text === 'complete') completionCallback = node.arguments[1].getText(source);
  ts.forEachChild(node, findCompletion);
}
findCompletion(conversationFunction);
const relayDeclaration = source.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(source) === "voiceRelay")).getText(source);

function setup(t, { legacy = false, resume = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "iris-voice-lifecycle-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const events = [], frames = [], sent = [], connections = [], attached = [], watched = [];
  const timers = new Map();
  const state = { deviceUiContexts: new Map(), spokenText, conversationLanguage, deliverBrainReply, proposalReadback,
    path, VoiceRelay, decodeBrainReply, conversationContext, permissionNotice, formatHermesCompletionEvent, isSleepIntent, hasGoogleSearchEvidence, TERMINAL_RUN_STATUSES,
    process: { env: { GEMINI_API_KEY: "isolated-test-key" }, pid: 1 },
    voiceDevice: new VoiceDevice(),
    runRegistry: new RunRegistry({ filePath: path.join(temp, "runs.json") }),
    announcementLedger: new AnnouncementLedger(), completionAnnouncements: new Set(), speechGeneration: 0,
    voiceEnabled: true, liveSession: null, liveStatus: { running: false, pid: null }, ai: null,
    liveConnectionId: 0, connectInFlight: false, shuttingDown: false, intentionalClose: false,
    autoWakePending: false, autoWakeTimer: null, reconnectTimer: null, reconnectAttempts: 0,
    relayRecovering: false, relayRecoveryAttempts: new Set(),
    closedDuringConnect: false, sessionUsedHandle: false, sessionConnectedAt: 0,
    welcomeGreeted: false, welcomeFallbackTimer: null, userInputSeenSinceStart: false,
    handleRefreshPromise: null, sleepRequestTimer: null, sleepFinalizeTimer: null, pendingSleepRequest: null,
    localSpeechActive: false, localSpeechSources: new Set(), userSpeechTurn: false,
    autoSlept: false, activeLiveToolBatches: new Set(), latestRelayUserEpoch: -1, latestRelayUserText: "", relayControlEpoch: -1,
    pendingHermesInteractions: new Map(), pendingHermesApprovals: new Map(), hermesRuns: new Map(), conversationTurns: new Map(),
    userTranscriptBuffer: "", modelTranscriptBuffer: "", modelTranscriptSettled: false, lastUserRoute: "direct", MIN_AUDIBLE_READBACK_CHARS: 48,
    liveTurnState: new LiveTurnState(), liveToolCoordinator: { cancel() {} },
    resumeHandles: new ResumeHandleStore({ ttlMs: 7200000 }),
    rendererBridge: { ready: true }, mainWindow: { isDestroyed: () => false, showInactive() {} },
    remoteServer: null, remoteState: { offer() {} },
    userConfigPath: () => path.join(temp, ".env"), appendVoiceRelayLog() {},
    brainRelayEnabled: () => !legacy, autoWakeOnHermes: () => true, userDisplayName: () => "Fatih", hermesSessionId: () => "session-a",
    emitEvent: (event) => events.push(event), emitToRenderer: (channel, payload) => frames.push({ channel, payload }),
    attachConversationSource: async (owner, result) => { attached.push({ owner, result }); },
    watchHermesRun: (id) => watched.push(id),
    getHermesProposal: () => null, hasPendingProposal: () => false,
    markModelTurnComplete() {}, markModelTurnInterrupted() {}, resetHermesGate() {},
    stopAutoSleepTimer() {}, startAutoSleepTimer() {}, stopHandleRefresh() {}, scheduleHandleRefresh() {}, closePreviewSession() {},
    endResponseWait() {}, beginResponseWait() {}, setGoogleSearchActive() {}, settleResumeGreeting() {}, updateTrayMenu() {},
    waitForResumeGreeting: async () => {},
    flushTranscripts() {}, clearTranscriptBuffers() { state.userTranscriptBuffer = ""; state.modelTranscriptBuffer = ""; },
    bumpVoiceActivity() {}, noteModelTurnActivity() {}, scheduleUserTranscriptFlush() {}, scheduleModelTranscriptFlush() {}, finalizeSleepAfterTurn() {},
    classifyRoute: () => "conversation", emitSleepRequest() {},
    loadUserContext: () => ({ text: "" }), currentIrisUiContext: () => ({}), getIrisUiContext: () => ({}),
    connectLiveWithTimeout: (promise) => promise, queueMicrotask,
    freshResumeHandle: () => state.resumeHandles.fresh(),
    buildLiveConfig: (handle) => ({ sessionResumption: handle ? { handle } : {} }),
    getConversationHermes: () => ({ submit: () => state.submit(), getObservedRuntime: () => null }),
    submit: async () => ({ run_id: "conversation-1", session_id: "session-a" }),
    writeUserConfig() {},
    setTimeout: (fn, ms) => { const id = {}; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  state.GoogleGenAI = class {
    live = { connect: (options) => {
      const session = {
        sendRealtimeInput: (frame) => sent.push(frame.text),
        close: () => { session.closed = true; options.callbacks.onclose({ reason: "closed" }); },
        message: (serverContent) => options.callbacks.onmessage({ serverContent }),
        drop: () => options.callbacks.onclose({ reason: "test drop" }),
        options,
      };
      connections.push(session);
      return state.connect ? state.connect(session) : (options.callbacks.onopen(), Promise.resolve(session));
    } };
  };
  if (resume) state.resumeHandles.update("valid-test-handle");
  const context = vm.createContext(state);
  vm.runInContext(`${functions}\n${relayDeclaration}\n globalThis.relay = voiceRelay; globalThis.completeConversation = ${completionCallback};`, context);
  const runTimers = async (ms) => {
    for (const [id, timer] of [...timers]) if (timer.ms === ms && timers.delete(id)) await timer.fn();
    await Promise.resolve(); await Promise.resolve();
  };
  return { state, events, frames, sent, connections, attached, watched, runTimers, relay: state.relay };
}

function seed(state, runId = "old", status = "completed") {
  state.runRegistry.start({ runId, task: "Task", sessionId: "session-a" });
  state.runRegistry.update(runId, { status, output: status === "completed" ? "Eski sonuç." : "" });
}

test("short permission notices preserve the actual-playback gate and resolved cards cannot become voice-ready again", async (t) => {
  const h = setup(t); await h.state.startLive();
  const card = { id: "srq-card", type: "approval", question: "DO-NOT-READ-DETAILS", command: "DO-NOT-READ-COMMAND", choices: ["once", "always", "deny"] };
  h.state.pendingHermesInteractions.set("worker", { ...card, stage: "awaiting_model", userResponse: "" });
  h.state.announceHermesInteraction("worker", "task", card);
  const id = h.relay.active.id;
  assert.equal(h.relay.active.text, permissionNotice());
  assert.doesNotMatch(h.sent.at(-1), /DO-NOT-READ|once|always|deny/);
  h.relay.chunk({ data: "pcm" }); h.relay.transcript(permissionNotice()); h.relay.turnComplete();
  assert.equal(h.state.pendingHermesInteractions.get("worker").stage, "awaiting_model");
  h.relay.playbackEnded(id);
  assert.equal(h.state.pendingHermesInteractions.get("worker").stage, "awaiting_user");
  h.state.announceHermesInteraction("worker", "task", { ...card, id: "srq-next" });
  const next = h.relay.active.id;
  h.relay.chunk({ data: "pcm" }); h.relay.transcript(permissionNotice()); h.relay.turnComplete();
  h.state.pendingHermesInteractions.delete("worker");
  h.state.dismissHermesNotice("worker", "srq-next");
  assert.equal(h.relay.playbackEnded(next), false);
  assert.equal(h.state.pendingHermesInteractions.size, 0);
});

test("restart restores active runs without announcing or rewriting historical results in either mode", async (t) => {
  for (const legacy of [false, true]) {
    const h = setup(t, { legacy }); seed(h.state); seed(h.state, "running", "running");
    const before = fs.readFileSync(h.state.runRegistry.filePath, "utf8");
    await h.state.recoverHermesRuns();
    assert.deepEqual(h.watched, ["running"]);
    assert.equal(h.relay.queue.length, 0);
    assert.equal(h.state.announcementLedger.pendingCount, 0);
    assert.equal(h.attached.length, 0);
    assert.equal(h.events.some((event) => event.type === "hermes_completion"), false);
    assert.equal(fs.readFileSync(h.state.runRegistry.filePath, "utf8"), before);
  }
});

test("manual wake greets once after boot or resume; early user input suppresses it", async (t) => {
  for (const resume of [false, true]) {
    const h = setup(t, { resume }); await h.state.startVoiceOnDevice("desktop");
    h.state.sendWelcomeGreeting(); h.state.sendWelcomeGreeting(); await h.runTimers(8000);
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0], /Merhaba efendim, bugün ne yapıyoruz/);
    await h.state.stopLive({ reason: "user" });
    await h.state.startVoiceOnDevice("desktop"); h.state.sendWelcomeGreeting();
    assert.equal(h.sent.length, 2);
  }
  const h = setup(t); await h.state.startLive();
  h.connections[0].message({ inputTranscription: { text: "Merhaba", finished: true } });
  h.state.sendWelcomeGreeting(); await h.runTimers(8000);
  assert.equal(h.sent.length, 0);
});

test("new completions wake silently, deduplicate side effects, and are announced only after playback", async (t) => {
  const h = setup(t); seed(h.state, "new");
  const result = { runId: "new", task: "Task", status: "completed", output: "Yeni sonuç." };
  h.state.announceHermesCompletion(result); h.state.announceHermesCompletion(result);
  assert.equal(h.attached.length, 1);
  assert.equal(h.relay.queue.length, 1);
  assert.equal(h.events.filter((event) => event.type === "hermes_completion").length, 1);
  await h.state.startVoiceOnDevice("desktop", { wakeReason: "notification" });
  h.state.sendWelcomeGreeting(); await h.runTimers(8000);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /Yeni sonuç/);
  const id = h.relay.active.id;
  h.connections[0].message({ outputTranscription: { text: "Yeni sonuç." }, modelTurn: { parts: [{ inlineData: { data: "cGNt", mimeType: "audio/pcm;rate=24000" } }] }, turnComplete: true });
  assert.equal(h.state.runRegistry.get("new").announcedAt, 0);
  assert.equal(h.relay.playbackEnded(id), true);
  assert.ok(h.state.runRegistry.get("new").announcedAt > 0);
});

test("explicit stop clears speech and future background results remain silent", async (t) => {
  const h = setup(t, { resume: true }); await h.state.startLive({ wakeReason: "notification" });
  seed(h.state); h.state.announceHermesCompletion({ runId: "old", task: "old", status: "completed", output: "Eski sonuç." });
  const old = h.relay.active.id;
  h.state.announcementLedger.sendNow("legacy active", () => {}); h.state.announcementLedger.enqueue("legacy queued");
  const connection = h.connections[0];
  await h.state.stopLive({ reason: "user" });
  connection.message({ outputTranscription: { text: "late" }, modelTurn: { parts: [{ inlineData: { data: "cGNt" } }] }, turnComplete: true });
  assert.equal(h.relay.queue.length, 0); assert.equal(h.relay.pendingPlayback.size, 0);
  assert.equal(h.relay.playbackEnded(old), false);
  assert.equal(h.state.announcementLedger.requeueInFlight(), 0);
  assert.equal(h.state.runRegistry.get("old").announcedAt, 0);
  h.state.announceHermesCompletion({ runId: "future", task: "future", status: "completed", output: "Yeni sonuç." });
  await h.runTimers(4000);
  assert.equal(h.state.liveStatus.running, false);
  assert.equal(h.connections.length, 1);
  assert.equal(h.sent.filter((text) => /Merhaba efendim/.test(text)).length, 0);
});

test("reconnect and handoff preserve results without greetings; idle does not erase pending speech", async (t) => {
  const h = setup(t, { resume: true }); await h.state.startLive({ wakeReason: "notification" });
  h.relay.enqueue("Sonuç hazır.", { notification: true, completionRunId: "r" });
  const original = h.relay.active.id;
  h.connections[0].drop(); await h.runTimers(500);
  assert.notEqual(h.relay.active.id, original);
  assert.equal(h.sent.filter((text) => /Sonuç hazır/.test(text)).length, 2);
  assert.equal(h.sent.some((text) => /Merhaba/.test(text)), false);
  await h.state.startVoiceOnDevice("phone");
  assert.equal(h.relay.queue.length, 1);
  assert.equal(h.state.welcomeGreeted, true);
  await h.state.stopLive({ reason: "idle", preserveProposal: true });
  assert.equal(h.relay.queue.length, 1);
});

test("a stop during connection/handle refresh fences late success, failure and retries", async (t) => {
  for (const reject of [false, true]) {
    const h = setup(t, { resume: true });
    let finish;
    h.state.connect = (session) => new Promise((resolve, fail) => { finish = () => reject ? fail(new Error("old failure")) : resolve(session); });
    const opening = h.state.startLive();
    await h.state.stopLive({ reason: "user" }); finish(); await opening;
    assert.equal(h.state.liveSession, null);
    assert.equal(h.state.liveStatus.running, false);
    assert.equal(h.connections.length, 1, "a rejected old resume must not start a new connection");
  }
  const h = setup(t); let finish;
  h.state.handleRefreshPromise = new Promise((resolve) => { finish = resolve; });
  const opening = h.state.startLive(); await h.state.stopLive({ reason: "user" }); finish(); await opening;
  assert.equal(h.connections.length, 0);
});

test("old connection callbacks cannot replace a newer user connection", async (t) => {
  const h = setup(t); let finish;
  h.state.connect = (session) => new Promise((resolve) => { finish = () => resolve(session); });
  const old = h.state.startLive(); await h.state.stopLive({ reason: "user" });
  h.state.connect = null; await h.state.startLive(); const current = h.state.liveSession;
  h.connections[0].options.callbacks.onopen(); finish(); await old;
  assert.equal(h.state.liveSession, current); assert.equal(h.state.connectInFlight, false);
  assert.equal(h.connections[0].closed, true);
});

test("manual stop cancels scheduled auto-wake and server reconnect", async (t) => {
  const h = setup(t);
  h.state.requestAutoWake("new result", "hermes_result");
  await h.state.stopLive({ reason: "user" }); await h.runTimers(4000);
  assert.equal(h.connections.length, 0);
  await h.state.startLive({ wakeReason: "notification" }); h.connections[0].drop();
  await h.state.stopLive({ reason: "session_switch" }); await h.runTimers(500);
  assert.equal(h.connections.length, 1);
});

test("a delayed renderer wake from before an explicit stop cannot open voice", async (t) => {
  const h = setup(t);
  h.state.requestAutoWake("result", "hermes_result");
  const wake = h.frames.find((frame) => frame.channel === "iris:wake").payload;
  await h.state.stopLive({ reason: "user" });
  await h.state.startVoiceOnDevice("desktop", { wakeReason: "notification", wakeGeneration: wake.generation });
  assert.equal(h.connections.length, 0);
});

test("late conversation submission failures and successes cannot queue speech or change session after stop", async (t) => {
  for (const reject of [false, true]) {
    const h = setup(t); let finish;
    h.state.submit = () => new Promise((resolve, fail) => { finish = () => reject ? fail(new Error("late brain failure")) : resolve({ run_id: "old-brain", session_id: "wrong-session" }); });
    h.relay.userStarted();
    const question = h.state.relayUserText("Nasılsın?");
    await h.state.stopLive({ reason: "user" }); finish(); await question;
    assert.equal(h.relay.queue.length, 0);
    assert.equal(h.state.conversationTurns.size, 0);
    assert.equal(h.events.some((event) => event.type === "brain_session"), false);
  }
});

test("legacy manual resume uses one welcome and notification wake adds no greeting", async (t) => {
  const h = setup(t, { legacy: true, resume: true });
  await h.state.startLive(); h.state.sendWelcomeGreeting();
  assert.equal(h.sent.length, 1); assert.match(h.sent[0], /Merhaba efendim/);
  await h.state.stopLive({ reason: "user" });
  await h.state.startLive({ wakeReason: "notification" }); h.state.sendWelcomeGreeting();
  assert.equal(h.sent.length, 1);
});

test("a silent ordinary reply recovers on a fresh connection once and waits for real playback", async (t) => {
  const h = setup(t); await h.state.startLive({ wakeReason: "notification" });
  const old = h.relay.enqueue("Rica ederim! İyi günler dilerim.");
  h.relay.waitStartedAt -= 21000;
  await h.state.recoverStalledSpeech();
  assert.equal(h.connections.length, 2);
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1], /Rica ederim/);
  const retry = h.relay.active.id;
  assert.notEqual(retry, old);
  h.connections[1].message({ outputTranscription: { text: "Rica ederim! İyi günler dilerim." }, modelTurn: { parts: [{ inlineData: { data: "cGNt" } }] }, turnComplete: true });
  assert.equal(h.relay.playbackEnded(old), false);
  assert.equal(h.relay.playbackEnded(retry), true);
  assert.equal(h.sent.some((text) => text.includes("Merhaba efendim")), false);
});

test("a repeatedly silent reply ends with an explicit error instead of reconnecting forever", async (t) => {
  const h = setup(t); await h.state.startLive({ wakeReason: "notification" });
  h.relay.enqueue("Sevindim, sağ ol!"); h.relay.waitStartedAt -= 21000;
  await h.state.recoverStalledSpeech(); h.relay.waitStartedAt -= 21000;
  await h.state.recoverStalledSpeech(); await h.state.recoverStalledSpeech();
  assert.equal(h.connections.length, 2);
  assert.equal(h.relay.active, null);
  assert.ok(h.events.some((event) => event.type === "voice_relay_error" && event.reason === "delivery_retry_exhausted"));
});

test("a no-speech status cannot acknowledge a result and recovers once before real delivery", async (t) => {
  const h = setup(t); seed(h.state, "failed-readout");
  await h.state.startLive({ wakeReason: "notification" });
  const output = "Dosyayı sildim. Diğer dosyaları korudum ve sonucu kontrol ettim. ".repeat(20).slice(0, 790);
  h.state.announceHermesCompletion({ runId: "failed-readout", task: "Task", status: "completed", output });
  const old = h.relay.active.id;
  h.connections[0].message({ outputTranscription: { text: "[No speech output]" }, modelTurn: { parts: [{ inlineData: { data: "cGNt" } }] }, turnComplete: true });
  assert.equal(h.relay.playbackEnded(old), false);
  assert.equal(h.state.runRegistry.get("failed-readout").announcedAt, 0);
  assert.equal(h.relay.stalledSpeech().reason, "no_speech_output");
  await h.state.recoverStalledSpeech();
  assert.equal(h.connections.length, 2);
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1], /without a status message/);
  const retry = h.relay.active.id;
  assert.notEqual(retry, old);
  h.connections[1].message({ outputTranscription: { text: output }, modelTurn: { parts: [{ inlineData: { data: "cGNt" } }] }, turnComplete: true });
  assert.equal(h.relay.playbackEnded(old), false);
  assert.equal(h.state.runRegistry.get("failed-readout").announcedAt, 0);
  assert.equal(h.relay.playbackEnded(retry), true);
  assert.ok(h.state.runRegistry.get("failed-readout").announcedAt > 0);
});

test("a repeated no-speech status keeps the result unannounced and cannot loop recovery", async (t) => {
  const h = setup(t); seed(h.state, "repeated-readout");
  await h.state.startLive({ wakeReason: "notification" });
  h.relay.enqueue("Sonucu hazırladım ve doğruladım.", { notification: true, completionRunId: "repeated-readout" });
  const failedFrame = { outputTranscription: { text: "[No speech output]" }, modelTurn: { parts: [{ inlineData: { data: "cGNt" } }] }, turnComplete: true };
  h.connections[0].message(failedFrame);
  await h.state.recoverStalledSpeech();
  h.connections[1].message(failedFrame);
  await h.state.recoverStalledSpeech();
  await h.state.recoverStalledSpeech();
  assert.equal(h.connections.length, 2);
  assert.equal(h.relay.active, null);
  assert.equal(h.state.runRegistry.get("repeated-readout").announcedAt, 0);
  assert.equal(h.events.filter((event) => event.type === "voice_relay_error" && event.reason === "delivery_retry_exhausted").length, 1);
});

test("user speech, brain work and intentional stop fence silence recovery", async (t) => {
  const h = setup(t); await h.state.startLive({ wakeReason: "notification" });
  h.relay.enqueue("Yanıt."); h.relay.waitStartedAt -= 21000;
  h.state.localSpeechActive = true; await h.state.recoverStalledSpeech();
  h.state.localSpeechActive = false; h.relay.brainPending = 1; await h.state.recoverStalledSpeech();
  h.relay.brainPending = 0;
  assert.equal(h.connections.length, 1);
  const recovery = h.state.recoverStalledSpeech();
  await h.state.stopLive({ reason: "user" }); await recovery;
  assert.equal(h.connections.length, 1);
  assert.equal(h.relay.queue.length, 0);
});

test("a late protocol interruption retries an unheard reply but never revives real barge-in", async (t) => {
  const h = setup(t); await h.state.startLive({ wakeReason: "notification" });
  const id = h.relay.enqueue("Rica ederim.");
  h.connections[0].message({ interrupted: true, turnComplete: true });
  await Promise.resolve();
  assert.equal(h.sent.length, 2);
  assert.notEqual(h.relay.active.id, id);
  h.state.startUserSpeechTurn();
  h.connections[0].message({ interrupted: true, turnComplete: true });
  await Promise.resolve();
  assert.equal(h.sent.length, 2);
  assert.equal(h.relay.active, null);
  assert.equal(h.relay.queue.length, 0);
});


test("typed submission survives voice stop without opening a voice connection", async (t) => {
  const h = setup(t); h.state.voiceEnabled = false;
  let finish; h.state.submit = () => new Promise((resolve) => { finish = () => resolve({ run_id: "text-turn", session_id: "session-a" }); });
  const sending = h.state.relayUserText("Merhaba?", h.relay.epoch, { text: true, deviceId: "phone", sessionId: "session-a", speechGeneration: 0 });
  await h.state.stopLive({ reason: "user" }); finish(); await sending;
  assert.equal(h.state.conversationTurns.get("text-turn").text, true);
  assert.equal(h.connections.length, 0);
  h.state.requestAutoWake("result", "hermes_result"); await h.runTimers(4000);
  assert.equal(h.connections.length, 0);
});


test("a typed reply completes visibly after voice stops and never auto-wakes", async (t) => {
  const h = setup(t); h.state.voiceEnabled = false;
  h.state.conversationTurns.set("text-1", { text: true, speak: false, epoch: 0, deviceId: "phone", speechGeneration: 0, sessionId: "session-a", language: "tr" });
  await h.state.stopLive({ reason: "user" });
  await h.state.completeConversation({ runId: "text-1", kind: "conversation", status: "completed", output: JSON.stringify({ reply: "Yazılı yanıt hazır.", proposal: null }) });
  assert.ok(h.events.some((x) => x.type === "transcript" && x.text === "Yazılı yanıt hazır."));
  assert.equal(h.relay.queue.length, 0); assert.equal(h.connections.length, 0);
});

test("a typed reminder opens a review draft without running a worker or starting speech", async (t) => {
  const h = setup(t); h.state.voiceEnabled = false;
  h.state.conversationTurns.set("text-reminder", { text: true, speak: false, epoch: 0, deviceId: "phone", speechGeneration: 0, sessionId: "session-a", language: "tr" });
  await h.state.completeConversation({ runId: "text-reminder", kind: "conversation", status: "completed", output: JSON.stringify({ reply: "", proposal: { goal: "Toplantıyı hatırlat", reminder: { title: "Toplantı", schedule: { kind: "daily", time: "09:00" } } } }) });
  assert.ok(h.events.some((x) => x.type === "reminder_draft" && x.draft.title === "Toplantı"));
  assert.equal(h.relay.queue.length, 0); assert.equal(h.connections.length, 0);
});
