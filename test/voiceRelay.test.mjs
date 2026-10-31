import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendVoiceRelayLog } from "../electron/voiceRelayLog.mjs";
import { VoiceRelay, speechMatches, decodeBrainReply, assertConversationTools, permissionNotice } from "../electron/voiceRelay.mjs";

test("permission notices contain only the short fixed sentence in Turkish or English", () => {
  assert.equal(permissionNotice("İzin ver"), "Efendim, işlem için izniniz gerekiyor; karttan onaylayabilirsiniz.");
  assert.equal(permissionNotice("Please open Calculator"), "Sir, this action needs your permission. Please use the on-screen card.");
});

test("resolving a queued permission removes only its own notice and prevents replay on reconnect", () => {
  const { relay, sent } = setup();
  relay.userStarted();
  const old = relay.enqueue("OLD-CARD", { notification: true, runId: "run-1", interactionId: "ask-1" });
  const next = relay.enqueue("NEXT-CARD", { notification: true, runId: "run-1", interactionId: "ask-2" });
  relay.enqueue("RESULT", { notification: true, completionRunId: "run-1" });
  assert.equal(relay.dismissInteractions("run-1", "ask-1"), 1);
  assert.equal(relay.queue.some((item) => item.id === old), false);
  assert.equal(relay.queue.some((item) => item.id === next), true);
  assert.equal(relay.queue.some((item) => item.completionRunId === "run-1"), true);
  relay.disconnect(); relay.connect(); relay.inputEnded();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /NEXT-CARD/);
  assert.doesNotMatch(sent[0], /OLD-CARD/);
});

test("resolving an audible permission discards its late audio until the provider turn ends", () => {
  const { relay, sent, audio, delivered, interruptions } = setup();
  const old = relay.enqueue("APPROVAL", { notification: true, runId: "run-1", interactionId: "ask-1" });
  relay.chunk({ data: "old-pcm" });
  relay.enqueue("RESULT", { notification: true, completionRunId: "run-1" });
  assert.equal(relay.dismissInteractions("run-1", "ask-1"), 1);
  assert.equal(interruptions.length, 1);
  assert.equal(relay.chunk({ data: "stale-pcm" }), false);
  assert.equal(relay.playbackEnded(old), false);
  assert.equal(sent.length, 1);
  relay.turnComplete();
  assert.equal(sent.length, 2);
  assert.match(sent[1], /RESULT/);
  relay.chunk({ data: "result-pcm" }); relay.transcript("RESULT"); relay.turnComplete();
  relay.playbackEnded(relay.pendingPlayback.keys().next().value);
  assert.deepEqual(audio.map((chunk) => chunk.data), ["old-pcm", "result-pcm"]);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].completionRunId, "run-1");
});

test("a pending playback permission can be dismissed without acknowledging it or losing another request", () => {
  const { relay, delivered, sent } = setup();
  const old = relay.enqueue("APPROVAL", { notification: true, approvalRunId: "run-1" });
  relay.chunk({ data: "pcm" }); relay.transcript("APPROVAL"); relay.turnComplete();
  relay.enqueue("OTHER", { notification: true, approvalRunId: "run-2" });
  assert.equal(relay.dismissInteractions("run-1", "approval:run-1"), 1);
  assert.equal(relay.playbackEnded(old), false);
  assert.equal(delivered.length, 0);
  assert.match(sent.at(-1), /OTHER/);
});

test("a repeated pending request is announced once and a missing provider boundary remains recoverable", () => {
  const { relay, sent } = setup();
  const options = { notification: true, runId: "run-1", interactionId: "ask-1" };
  const id = relay.enqueue("APPROVAL", options);
  assert.equal(relay.enqueue("APPROVAL", options), id);
  assert.equal(sent.length, 1);
  relay.dismissInteractions("run-1");
  relay.enqueue("RESULT", { notification: true, completionRunId: "run-1" });
  assert.equal(relay.stalledSpeech(relay.discardingNoticeSince + 21000).reason, "dismissed_notice_turn_timeout");
  relay.userStarted();
  assert.equal(relay.discardingNoticeSince, 0);
});

function setup() {
  const sent = [], audio = [], events = [], delivered = [], interruptions = [];
  const relay = new VoiceRelay({ send: (v) => sent.push(v), audio: (v) => audio.push(v), interrupt: () => interruptions.push(true), event: (v) => events.push(v), delivered: (v) => delivered.push(v) });
  relay.connect();
  return { relay, sent, audio, events, delivered, interruptions };
}

test("unsolicited Gemini audio is silent; Qwen answers wait for the input generation to end", () => {
  const { relay, audio, sent } = setup();
  relay.userStarted();
  assert.equal(relay.chunk({ data: "unwanted" }), false);
  relay.enqueue("Bu tasarımı birlikte değerlendirelim.");
  assert.equal(sent.length, 0);
  relay.turnComplete();
  assert.equal(sent.length, 0, "an interrupted old completion cannot speak over an open user turn");
  relay.inputEnded();
  assert.equal(sent.length, 1);
  relay.chunk({ data: "authorized" });
  assert.deepEqual(audio.map((v) => v.data), ["authorized"]);
});

test("approval audio streams immediately and fidelity differences do not bypass the playback barrier", () => {
  const { relay, audio, delivered, events, interruptions } = setup();
  const id = relay.enqueue("Bu dosyayı düzenle. Onaylıyor musun?", { critical: true, proposalId: "proposal-1" });
  relay.chunk({ data: "pcm" });
  assert.equal(audio.length, 1, "approval audio must be audible before its transcription or turn completion");
  assert.equal(delivered.length, 0);
  assert.equal(relay.playbackEnded(id), false, "an early acknowledgement cannot mark an unfinished readback as heard");
  relay.transcript("Bu dosyayı düzenleyeyim. Onaylıyor musun?");
  relay.turnComplete();
  assert.equal(audio.length, 1, "already-streamed audio must not be replayed at completion");
  assert.equal(delivered.length, 0);
  assert.ok(events.some((v) => v.type === "voice_fidelity" && v.matches === false));
  assert.equal(events.some((v) => v.type === "voice_relay_error"), false);
  assert.equal(interruptions.length, 0);
  assert.equal(relay.playbackEnded(id), true);
  assert.equal(relay.playbackEnded(id), false);
  assert.equal(delivered[0].proposalId, "proposal-1");
});

test("a streamed notification is acknowledged once after playback, not at server turn completion", () => {
  const { relay, audio, delivered } = setup();
  const id = relay.enqueue("Araştırma tamamlandı.", { critical: true, notification: true });
  relay.chunk({ data: "pcm" });
  assert.equal(audio.length, 1);
  relay.transcript("Araştırma tamamlandı!");
  relay.turnComplete();
  assert.equal(audio.length, 1);
  assert.equal(delivered.length, 0);
  assert.equal(relay.playbackEnded(id), true);
  assert.equal(relay.playbackEnded(id), false);
  assert.equal(delivered.length, 1);
});

test("barge-in invalidates old speech and late playback acknowledgements", () => {
  const { relay, sent, delivered } = setup();
  const old = relay.enqueue("Eski cevap");
  relay.transcript("Eski cevap");
  relay.chunk({ data: "pcm" });
  relay.turnComplete();
  relay.enqueue("Eski devam");
  relay.userStarted();
  assert.equal(relay.playbackEnded(old), false);
  relay.enqueue("Yeni cevap");
  relay.inputEnded();
  relay.turnComplete();
  assert.equal(sent.length, 2);
  assert.match(sent[1], /Yeni cevap/);
  assert.equal(delivered.length, 0);
});

test("a protocol cancellation alone does not create another user turn", () => {
  const { relay } = setup();
  relay.userStarted();
  relay.inputEnded();
  const epoch = relay.epoch;
  relay.cancel();
  assert.equal(relay.epoch, epoch);
  assert.equal(relay.inputOpen, false);
});

test("interrupted speech cannot leave completion notifications waiting on a stale busy flag", () => {
  const { relay, sent } = setup();
  relay.authorizeTool("Tamam.");
  relay.userStarted();
  relay.cancel();
  relay.inputEnded();
  relay.enqueue("Görev tamamlandı.", { notification: true, completionRunId: "done" });
  assert.equal(sent.length, 1, "delivery must start without waiting for a server completion or watchdog");
  assert.match(sent[0], /Görev tamamlandı/);
});

test("only outstanding tool calls block delivery; finishing a silent tool immediately releases the queue", () => {
  const { relay, sent } = setup();
  relay.toolCalls([{ id: "context" }, { id: "control" }]);
  relay.enqueue("Sonuç hazır.", { notification: true });
  relay.turnComplete();
  relay.toolsFinished(["context", "unknown"]);
  assert.equal(sent.length, 0, "a real outstanding control must still be protected");
  relay.toolsFinished(["control"]);
  assert.equal(sent.length, 1);
});

test("tool cancellation targets its own speech and preserves other readback and playback barriers", () => {
  const { relay, sent, delivered } = setup();
  relay.toolCalls([{ id: "old" }, { id: "current" }]);
  const id = relay.authorizeTool("Tamam.", { toolCallId: "current" });
  relay.enqueue("Görev tamamlandı.", { notification: true });
  relay.toolsFinished(["old"], { cancelled: true });
  relay.toolsFinished(["current"]);
  assert.equal(relay.active.id, id);
  assert.equal(sent.length, 0);
  relay.turnComplete();
  assert.equal(relay.active.id, id, "the empty tool-call boundary must preserve its authorized result");
  relay.transcript("Tamam.");
  relay.chunk({ data: "pcm" });
  relay.turnComplete();
  assert.equal(sent.length, 0, "server completion must still wait for real playback");
  relay.toolsFinished(["current"], { cancelled: true });
  assert.equal(sent.length, 1);
  assert.equal(relay.playbackEnded(id), false);
  assert.equal(delivered.length, 0, "a cancelled readback cannot count as heard approval");
});

test("queued work notifications wait for the answer to a new user question", () => {
  const { relay, sent } = setup();
  relay.userStarted();
  relay.brainPending = relay.epoch;
  relay.enqueue("İş tamamlandı.", { notification: true });
  relay.inputEnded();
  assert.equal(sent.length, 0);
  relay.brainPending = 0;
  relay.enqueue("Sorunun cevabı.", { priority: true });
  assert.match(sent[0], /Sorunun cevabı/);
  assert.equal(relay.queue.length, 1);
});

test("user interruption stops a result without restarting it after the answer; explicit rereading still works", () => {
  for (const outputEnded of [false, true]) {
    const { relay, sent, delivered } = setup();
    const old = relay.enqueue("Sonucun tamamı.", { notification: true, completionRunId: "r" });
    relay.transcript("Sonucun"); relay.chunk({ data: "pcm" });
    if (outputEnded) relay.turnComplete();
    relay.userStarted();
    relay.brainPending = relay.epoch;
    relay.inputEnded();
    assert.equal(sent.length, 1);
    assert.equal(relay.queue.length, 0);
    assert.equal(relay.playbackEnded(old), false);
    relay.brainPending = 0;
    const answer = relay.enqueue("Sorunun yanıtı.", { priority: true });
    relay.transcript("Sorunun yanıtı."); relay.chunk({ data: "pcm" }); relay.turnComplete();
    relay.playbackEnded(answer);
    assert.equal(sent.length, 2);
    assert.equal(relay.active, null);
    assert.equal(delivered.filter((item) => item.completionRunId === "r").length, 0);
    const requested = relay.enqueue("Sonucun tamamı.", { priority: true });
    assert.equal(sent.length, 3);
    assert.equal(relay.active.id, requested, "a later explicit request is still readable");
  }
});

test("user speech drops queued result retries but preserves unread new results and native approvals", () => {
  const { relay } = setup();
  relay.enqueue("Yarım kalan sonuç.", { notification: true, completionRunId: "old" });
  relay.pendingTools.add("control");
  relay.cancel({ preserveNotifications: true, reason: "model_interruption" });
  const fresh = relay.enqueue("Yeni görevin sonucu.", { notification: true, completionRunId: "new" });
  const approval = relay.enqueue("İşlem onayını bekliyorum.", { notification: true, critical: true, approvalRunId: "approval" });
  relay.userStarted();
  assert.deepEqual(relay.queue.map((item) => item.id), [fresh, approval]);
  assert.equal(relay.queue.some((item) => item.completionRunId === "old"), false);
});

test("transport retry preserves queue order but rejects old playback acknowledgements", () => {
  const { relay, sent, delivered } = setup();
  const old = relay.enqueue("Birinci sonuç.", { notification: true, completionRunId: "r1" });
  relay.enqueue("İkinci sonuç.", { notification: true, completionRunId: "r2" });
  relay.transcript("Birinci sonuç."); relay.chunk({ data: "pcm" }); relay.turnComplete();
  relay.disconnect();
  const retry = relay.queue[0].id;
  assert.notEqual(retry, old);
  relay.disconnect();
  assert.equal(relay.queue.length, 2, "a repeated disconnect cannot duplicate a result");
  relay.connect();
  assert.match(sent[1], /Birinci sonuç/);
  relay.transcript("Birinci sonuç."); relay.chunk({ data: "pcm" }); relay.turnComplete();
  assert.equal(relay.playbackEnded(old), false);
  assert.equal(delivered.length, 0);
  relay.playbackEnded(retry);
  assert.match(sent[2], /İkinci sonuç/);
});

test("explicit reset clears speech without delivery and rejects old proposal acknowledgements", () => {
  const { relay, sent, delivered } = setup();
  const proposal = relay.enqueue("Bu işi onaylıyor musun?", { proposalId: "p", critical: true });
  relay.transcript("Bu işi onaylıyor musun?"); relay.chunk({ data: "pcm" }); relay.turnComplete();
  relay.enqueue("Eski sonuç.", { notification: true, completionRunId: "old" });
  const epoch = relay.epoch;
  relay.reset();
  assert.equal(relay.epoch, epoch + 1);
  assert.equal(relay.connected, false);
  assert.equal(relay.pendingPlayback.size, 0);
  assert.equal(relay.playbackEnded(proposal), false);
  relay.connect();
  assert.equal(sent.length, 1);
  assert.equal(delivered.length, 0);
  relay.enqueue("Yeni sonuç.", { notification: true, completionRunId: "new" });
  assert.match(sent[1], /Yeni sonuç/);
});

test("protocol interruption preserves a result, but actual user input discards its automatic retry", () => {
  const { relay, sent } = setup();
  const old = relay.enqueue("Sonuç hazır.", { notification: true, completionRunId: "r" });
  relay.chunk({ data: "pcm" });
  const epoch = relay.epoch;
  relay.cancel({ preserveNotifications: true });
  assert.equal(relay.epoch, epoch);
  assert.equal(sent.length, 1);
  assert.equal(relay.queue.length, 1);
  assert.notEqual(relay.queue[0].id, old);
  relay.userStarted();
  assert.equal(relay.queue.length, 0);
});

test("a text-only server turn never counts as an audible readback", () => {
  const { relay, delivered } = setup();
  const id = relay.enqueue("Onaylıyor musun?", { critical: true });
  relay.transcript("Onaylıyor musun?");
  relay.turnComplete();
  assert.equal(relay.playbackEnded(id), false);
  assert.equal(delivered.length, 0);
});

test("a tool-call boundary cannot consume the authorization for the later tool-result speech", () => {
  const { relay, audio, delivered } = setup();
  const id = relay.authorizeTool("Görüşürüz.", { sleep: true });
  relay.enqueue("Araştırma tamamlandı.", { notification: true });
  relay.turnComplete();
  assert.equal(relay.active.id, id);
  assert.equal(audio.length, 0);
  relay.transcript("Görüşürüz.");
  relay.chunk({ data: "farewell" });
  relay.turnComplete();
  assert.equal(relay.active, null);
  assert.equal(delivered.length, 0);
  assert.equal(relay.playbackEnded(id), true);
  assert.equal(delivered[0].sleep, true);
});

test("speech comparison preserves negation, amounts and added interpretations", () => {
  assert.equal(speechMatches("Evet, uygula.", "Evet uygula!"), true);
  assert.equal(speechMatches("Uygulama.", "Uygula."), false);
  assert.equal(speechMatches("15 dosya", "50 dosya"), false);
  assert.equal(speechMatches("Sonuç hazır.", "Sonuç hazır. Bence çok iyi."), false);
});

test("normal readout differences remain diagnostic and do not cut off streaming speech", () => {
  const { relay, audio, events, interruptions } = setup();
  relay.enqueue("Bu tasarım uygundur.");
  relay.transcript("Bu tasarım");
  relay.chunk({ data: "first" });
  relay.transcript(" uygun değildir.");
  assert.equal(relay.chunk({ data: "different remainder" }), true);
  relay.turnComplete();
  assert.deepEqual(audio.map((v) => v.data), ["first", "different remainder"]);
  assert.equal(interruptions.length, 0);
  assert.ok(events.some((v) => v.type === "voice_fidelity" && v.matches === false));
  assert.equal(events.some((v) => v.type === "voice_relay_error"), false);
});

test("real user barge-in still interrupts a streaming approval and invalidates its acknowledgement", () => {
  const { relay, audio, delivered, interruptions } = setup();
  const id = relay.enqueue("Bu görevi başlatmamı onaylıyor musun?", { critical: true, proposalId: "p" });
  relay.chunk({ data: "first" });
  relay.userStarted();
  assert.equal(interruptions.length, 1);
  assert.equal(relay.chunk({ data: "late" }), false);
  relay.turnComplete();
  assert.equal(relay.playbackEnded(id), false);
  assert.equal(delivered.length, 0);
  assert.deepEqual(audio.map((v) => v.data), ["first"]);
});

test("completion readout variations are logged without silencing the result or losing playback acknowledgement", () => {
  const { relay, audio, events, delivered } = setup();
  const id = relay.enqueue("Dilara oluşturuldu: C:\\Users\\Fatih\\Desktop\\Dilara, 23:56.", { notification: true, completionRunId: "completed-run" });
  relay.transcript("Dilara oluşturuldu. Saat yirmi üç elli altı.");
  assert.equal(relay.chunk({ data: "pcm" }), true);
  relay.turnComplete();
  assert.equal(audio.length, 1);
  assert.ok(events.some((event) => event.type === "voice_fidelity" && event.matches === false));
  assert.equal(relay.playbackEnded(id), true);
  assert.equal(delivered[0].completionRunId, "completed-run");
});

test("an intentionally requested no-speech status phrase is still valid spoken content", () => {
  const { relay, delivered } = setup();
  const id = relay.enqueue("No speech output", { notification: true, completionRunId: "quoted-status" });
  relay.transcript("[No speech output]");
  relay.chunk({ data: "cGNt" });
  relay.turnComplete();
  assert.equal(relay.playbackEnded(id), true);
  assert.equal(delivered.length, 1);
});

test("notification watchdog detects silence but protects input, brain work and long playback", () => {
  const { relay } = setup();
  relay.enqueue("Sonuç hazır.", { notification: true, completionRunId: "r" });
  const now = relay.waitStartedAt + 25000;
  assert.equal(relay.stalledNotification(now).reason, "no_audio");
  relay.inputOpen = true;
  assert.equal(relay.stalledNotification(now), null);
  relay.inputOpen = false;
  relay.brainPending = 1;
  assert.equal(relay.stalledNotification(now), null);
  relay.brainPending = 0;
  relay.transcript("Sonuç hazır.");
  relay.chunk({ data: "pcm" });
  relay.active.audioDurationMs = 120000;
  relay.turnComplete();
  const item = [...relay.pendingPlayback.values()][0];
  assert.equal(relay.stalledNotification(item.playbackStartedAt + 40000), null);
  assert.equal(relay.stalledNotification(item.playbackStartedAt + 140000).reason, "playback_ack_missing");
});

test("ordinary silence is recoverable, while already audible replies and active tools are protected", () => {
  const { relay } = setup();
  const id = relay.enqueue("Rica ederim.");
  const now = relay.waitStartedAt + 25000;
  const stalled = relay.stalledSpeech(now);
  assert.equal(stalled.utterance_id, id);
  relay.toolCalls([{ id: "control" }]); assert.equal(relay.stalledSpeech(now), null);
  relay.toolsFinished(["control"]);
  relay.inputOpen = true; assert.equal(relay.stalledSpeech(now), null);
  relay.inputOpen = false; relay.chunk({ data: "pcm" });
  assert.equal(relay.stalledSpeech(now), null, "never replay an already audible ordinary reply");
});

test("text without any audio stays recoverable and never counts as delivered", () => {
  const { relay, delivered } = setup();
  const id = relay.enqueue("Yanıt.");
  relay.transcript("Yanıt."); relay.turnComplete();
  assert.equal(relay.stalledSpeech().utterance_id, id);
  assert.equal(relay.playbackEnded(id), false);
  assert.equal(delivered.length, 0);
});

test("unheard model interruptions retry once; real speech and audible replies do not replay", () => {
  const { relay, sent, events } = setup();
  relay.enqueue("Yanıt.");
  assert.equal(relay.cancel({ preserveUnheard: true }), true);
  relay.pump();
  assert.equal(relay.cancel({ preserveUnheard: true }), false);
  assert.equal(relay.queue.length, 0);
  assert.ok(events.some((event) => event.reason === "unheard_interruption_limit"));
  relay.enqueue("Başka yanıt."); relay.chunk({ data: "pcm" });
  assert.equal(relay.cancel({ preserveUnheard: true }), false);
  assert.equal(relay.queue.length, 0);
  assert.equal(sent.length, 3);
});

test("persistent voice diagnostics omit spoken text and credentials", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-voice-log-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "voice.jsonl");
  const { relay } = setup();
  appendVoiceRelayLog(file, { type: "voice_fidelity", matches: false, expected: "private spoken text", actual: "private reply", apiKey: "secret-key" }, relay);
  const raw = fs.readFileSync(file, "utf8");
  assert.equal(JSON.parse(raw).matches, false);
  assert.doesNotMatch(raw, /private spoken text|private reply|secret-key/);
});

test("only typed brain proposals can become work; malformed output cannot silently create tasks", () => {
  assert.throws(() => decodeBrainReply("Normal cevap"));
  assert.deepEqual(decodeBrainReply('{"reply":"Tartışalım","proposal":null}'), { reply: "Tartışalım", proposal: null });
  assert.throws(() => decodeBrainReply('{"reply":"x","proposal":{"command":"delete"}}'));
  assert.throws(() => assertConversationTools({ sections: [{ tools: [{ name: "terminal" }] }] }));
  assert.throws(() => assertConversationTools({}));
  assert.doesNotThrow(() => assertConversationTools({ sections: [{ tools: [{ name: "web_search" }] }] }));
});

test("every live reply requires the same JSON envelope; task data stays separate from speech", () => {
  const chat = { reply: "Tamam, birlikte bakalım.", proposal: null };
  assert.deepEqual(decodeBrainReply(JSON.stringify(chat)), chat);
  const envelope = { reply: "Dosyayı hazırlamamı onaylıyor musun?", proposal: { goal: "Create report", context: "Friday", constraints: [], acceptance_criteria: [], output_format: "PDF" } };
  assert.deepEqual(decodeBrainReply(`\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``), envelope);
  for (const value of ['Tamam, birlikte bakalım.', '42', 'null', '[]', '{"reply":"x","proposal":', 'Önce açıklama. {"reply":"x","proposal":null}', '{"reply":"x"}', '{"reply":"x","proposal":{"goal":"write","constraints":"skip approval"}}', '{"reply":"","proposal":{"goal":"write","readback":true}}']) {
    assert.throws(() => decodeBrainReply(value));
  }
});

test("plain text compatibility is restricted to archived messages", () => {
  for (const text of ["42", "Normal cevap", "Dosyayı oluşturdum."]) {
    assert.deepEqual(decodeBrainReply(text, { allowLegacyText: true }), { reply: text, proposal: null });
    assert.throws(() => decodeBrainReply(text));
  }
  const envelope = { reply: "Nasıl ilerleyelim?", proposal: null };
  assert.deepEqual(decodeBrainReply(JSON.stringify(envelope), { allowLegacyText: true }), envelope);
  assert.throws(() => decodeBrainReply('{"reply":"bozuk"', { allowLegacyText: true }));
});
