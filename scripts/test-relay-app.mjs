import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import { GoogleGenAI } from "@google/genai";
import { loadEnvFiles } from "../electron/configStore.mjs";
import { HermesGatewayClient } from "../electron/hermesGatewayClient.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";
import { conversationContext, VoiceRelay, relayInstructions } from "../electron/voiceRelay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles({ repoRoot: root });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "iris-relay-app-"));
const client = new HermesGatewayClient({ candidates: () => [{ cmd: process.env.HERMES_BIN || "hermes", args: [] }], env: { ...process.env, HERMES_TUI_TOOLSETS: "web,clarify" } });
const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
let app, session;

async function sourceAudio(text) {
  let live, resolve, reject;
  const done = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  const chunks = [];
  const relay = new VoiceRelay({ send: (frame) => live.sendRealtimeInput({ text: frame }), audio: (chunk) => chunks.push(Buffer.from(chunk.data, "base64")), interrupt() {}, event: (event) => {
    if (event.type === "voice_output_end") resolve();
    if (event.type === "voice_relay_error") reject(new Error(event.error));
  } });
  const timer = setTimeout(() => reject(new Error("Source voice generation timed out")), 45000);
  try {
    live = await new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).live.connect({ model: process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview", config: { responseModalities: ["AUDIO"], outputAudioTranscription: {}, systemInstruction: relayInstructions(), speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_LIVE_VOICE || "Zephyr" } } } }, callbacks: {
      onmessage: ({ serverContent: c }) => {
        if (!c) return;
        if (c.outputTranscription?.text) relay.transcript(c.outputTranscription.text);
        for (const part of c.modelTurn?.parts || []) if (part.inlineData?.data) relay.chunk(part.inlineData);
        if (c.turnComplete) relay.turnComplete();
      }, onerror: (error) => reject(new Error(error.message)),
    } });
    relay.connect(); relay.enqueue(text, { critical: true }); await done;
    const raw = Buffer.concat(chunks);
    const input = Buffer.alloc(Math.floor(raw.length / 3) * 2);
    for (let i = 0; i < input.length / 2; i++) input.writeInt16LE(raw.readInt16LE(Math.floor(i * 1.5) * 2), i * 2);
    return Buffer.concat([Buffer.alloc(6400), input, Buffer.alloc(48000)]).toString("base64");
  } finally { clearTimeout(timer); live?.close(); }
}

try {
  session = await transport.createSession();
  const seeded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Session seed timed out")), 90000);
    transport.once("complete", (item) => { clearTimeout(timer); item.status === "completed" ? resolve() : reject(new Error(item.error)); });
  });
  await transport.submit({ task: "Bu bir bağlantı testidir. Yalnızca hazır de.", kind: "conversation", sessionId: session.id, context: conversationContext() });
  await seeded;
  // Release the native transcript lease before the app resumes this session.
  await client.request("session.close", { session_id: session.liveSessionId });
  const pcm = await sourceAudio("Bana sadece bağlantı hazır diyerek cevap ver.");
  const env = { ...process.env, IRIS_START_PROD: "1", IRIS_BRAIN_RELAY: "true", IRIS_TEST_HOOKS: "1", IRIS_TEST_SKIP_WELCOME: "1", IRIS_TEST_CONFIG_PATH: path.join(temp, ".env"), IRIS_TEST_RUN_REGISTRY_PATH: path.join(temp, "runs.json"), IRIS_HERMES_SESSION: session.id, IRIS_HERMES_AUTOSTART: "false", IRIS_WAKE_WORD: "false", IRIS_LOAD_TEST_DATA: "false", IRIS_AUTO_SLEEP_SECONDS: "120" };
  delete env.ELECTRON_RUN_AS_NODE;
  // Real room microphone/VAD must not interfere with deterministic injected PCM.
  // Chromium loops this silent capture fixture; output playback remains real.
  const silence = Buffer.alloc(44 + 32000);
  silence.write("RIFF", 0); silence.writeUInt32LE(silence.length - 8, 4); silence.write("WAVEfmt ", 8);
  silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
  silence.writeUInt32LE(16000, 24); silence.writeUInt32LE(32000, 28); silence.writeUInt16LE(2, 32);
  silence.writeUInt16LE(16, 34); silence.write("data", 36); silence.writeUInt32LE(32000, 40);
  const capture = path.join(temp, "silence.wav"); fs.writeFileSync(capture, silence);
  app = await electron.launch({ args: [path.join(root, "electron/main.mjs"), `--user-data-dir=${path.join(temp, "chromium")}`, "--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${capture}`, "--autoplay-policy=no-user-gesture-required"], cwd: root, env });
  const page = await app.firstWindow();
  await page.waitForSelector(".deck", { timeout: 30000 });
  await app.evaluate(() => globalThis.__irisTest.hideWindow());
  await page.locator('button[title="Settings"]').click();
  await page.waitForFunction(() => document.querySelectorAll('select[aria-label="Beyin sağlayıcısı ve modeli"] option').length === 14);
  const groups = await page.locator('select[aria-label="Beyin sağlayıcısı ve modeli"] optgroup').evaluateAll((items) => items.map((item) => ({ label: item.label, count: item.children.length })));
  assert.deepEqual(groups, [{ label: "Evren", count: 5 }, { label: "OpenCode Free", count: 9 }]);
  await page.locator('.setup-head button[title="Close"]').click();
  console.log("Brain picker groups verified: Evren (5), OpenCode Free (9).");
  await page.evaluate(() => {
    window.__relayEvents = [];
    window.iris.onSidecarEvent((event) => window.__relayEvents.push(event));
  });
  await page.evaluate(() => window.iris.startSidecar());
  console.log("Electron Live session connected; feeding real PCM to Gemini input.");
  await page.evaluate(async (base64) => {
    const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    for (let i = 0; i < raw.length; i += 640) {
      window.iris.sendAudioChunk(raw.slice(i, i + 640).buffer);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }, pcm);
  await page.waitForFunction(() => window.__relayEvents.some((e) => e.type === "voice_fidelity" && e.matches), undefined, { timeout: 90000 });
  const events = await page.evaluate(() => window.__relayEvents);
  assert.ok(events.some((e) => e.type === "transcript" && e.speaker === "you" && /bağlantı/i.test(e.text)));
  assert.ok(events.some((e) => e.type === "transcript" && e.speaker === "hermes" && /hazır/i.test(e.text)));
  assert.equal(events.some((e) => e.type === "transcript" && e.speaker === "gemini"), false);
  await page.waitForTimeout(3000);
  const state = await app.evaluate(() => globalThis.__irisTest.relayState());
  assert.equal(state.playback, 0, "renderer must acknowledge actual audio completion");
  console.log("Real PCM → input transcript → Hermes/Qwen → matching Gemini speech → playback acknowledgement passed.");
  await page.evaluate(() => window.iris.stopSidecar());
  await app.evaluate(() => globalThis.__irisTest.simulateHermesComplete("Relay test research", "Test araştırması tamamlandı."));
  await page.waitForFunction(() => window.__relayEvents.some((e) => e.type === "voice_fidelity" && e.expected === "Test araştırması tamamlandı." && e.matches), undefined, { timeout: 45000 });
  console.log("Completion notification woke Avalon and read the original result.");
  if (process.argv.includes("--with-work")) {
    const outputFile = path.join(temp, "worker-test.txt");
    const request = `Bu bir otomasyon testidir. ${outputFile} dosyasını oluştur ve içine yalnızca relay-ok yaz. Başlamadan önce görev önerisi hazırla.`;
    await page.waitForTimeout(3000);
    await page.evaluate(() => { window.__relayEvents = []; });
    await page.evaluate((text) => window.iris.sendCommand({ type: "text", text }), request);
    await page.waitForFunction(() => window.__relayEvents.some((e) => e.type === "brain_proposal" && e.proposal_id), undefined, { timeout: 90000 });
    const proposal = await page.evaluate(() => window.__relayEvents.find((e) => e.type === "brain_proposal" && e.proposal_id));
    assert.equal(fs.existsSync(outputFile), false, "conversation cannot write the file before approval");
    const decision = await page.evaluate((id) => window.iris.respondTaskProposal(id, "once"), proposal.proposal_id);
    assert.notEqual(decision.status, "blocked");
    assert.notEqual(decision.status, "error");
    await page.evaluate(() => window.iris.sendCommand({ type: "text", text: "Dosya görevi arka planda sürsün. Bu sohbet mesajına yalnızca merhaba diyerek yanıt ver." }));
    await page.waitForFunction(() => window.__relayEvents.some((e) => e.type === "transcript" && e.speaker === "hermes" && /merhaba/i.test(e.text)), undefined, { timeout: 90000 });
    await page.waitForFunction(() => window.__relayEvents.some((e) => e.type === "hermes_completion" && e.task.includes("worker-test.txt")), undefined, { timeout: 90000 });
    assert.equal(fs.readFileSync(outputFile, "utf8").trim(), "relay-ok");
    console.log("Explicit proposal approval → separate Hermes worker → file result, with conversation continuing, passed.");
  }
  await page.evaluate(() => { window.__relayEvents = []; });
  await page.evaluate(() => window.iris.sendCommand({ type: "text", text: "Avalon, uykuya geç." }));
  await page.waitForFunction(() => window.__relayEvents.some((e) => e.type === "voice_fidelity" && e.expected === "Görüşürüz." && e.matches), undefined, { timeout: 45000 });
  await page.waitForFunction(() => window.__relayEvents.some((e) => e.type === "sidecar_status" && e.status?.running === false), undefined, { timeout: 20000 });
  await page.evaluate(() => window.iris.startSidecar());
  const restored = await page.evaluate(() => window.iris.getConversationHistory());
  assert.equal(restored.sessionId, session.id);
  assert.ok(restored.messages.some((m) => m.speaker === "hermes"));
  console.log("Turkish voice-coordination sleep, verified farewell playback, wake and same-session history passed.");
} catch (error) {
  if (app) {
    console.error("Relay state:", await app.evaluate(() => globalThis.__irisTest.relayState()).catch(() => null));
    console.error("Recent relay events:", await (await app.firstWindow()).evaluate(() => window.__relayEvents?.filter((e) => !["hermes_task_event", "hermes_task_update"].includes(e.type)).slice(-15)).catch(() => null));
  }
  throw error;
} finally {
  await app?.close().catch(() => undefined);
  if (session) await transport.deleteSession(session.id).catch(() => undefined);
  transport.close({ force: true });
  // Keep test diagnostics on failure without touching any user configuration.
  console.log(`Isolated app test directory: ${temp}`);
}
