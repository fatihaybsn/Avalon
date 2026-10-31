import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import { GoogleGenAI } from "@google/genai";
import { parseEnvFile } from "../electron/configStore.mjs";
import { VoiceRelay, relayInstructions } from "../electron/voiceRelay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const credentials = { ...process.env };
parseEnvFile(path.join(root, ".env"), credentials);
parseEnvFile(path.join(os.homedir(), ".iris", ".env"), credentials);
if (!credentials.GEMINI_API_KEY) throw new Error("A configured Gemini key is required for this opt-in real-voice test.");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "iris-voice-lifecycle-app-"));
const model = credentials.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
let app;

async function sourceAudio(text) {
  let live, resolve, reject;
  const done = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  const chunks = [];
  const relay = new VoiceRelay({ send: (frame) => live.sendRealtimeInput({ text: frame }), audio: (chunk) => chunks.push(Buffer.from(chunk.data, "base64")), interrupt() {}, event: (event) => {
    if (event.type === "voice_output_end") resolve();
    if (event.type === "voice_relay_error") reject(new Error(event.error));
  } });
  const timer = setTimeout(() => reject(new Error("Source speech timed out")), 45000);
  try {
    live = await new GoogleGenAI({ apiKey: credentials.GEMINI_API_KEY }).live.connect({ model, config: { responseModalities: ["AUDIO"], outputAudioTranscription: {}, systemInstruction: relayInstructions() }, callbacks: {
      onmessage: ({ serverContent: content }) => {
        if (!content) return;
        if (content.outputTranscription?.text) relay.transcript(content.outputTranscription.text);
        for (const part of content.modelTurn?.parts || []) if (part.inlineData?.data) relay.chunk(part.inlineData);
        if (content.turnComplete) relay.turnComplete();
      }, onerror: (error) => reject(new Error(error.message)),
      onclose: () => reject(new Error("Source voice connection closed before speech completed")),
    } });
    relay.connect(); relay.enqueue(text); await done;
    const raw = Buffer.concat(chunks), input = Buffer.alloc(Math.floor(raw.length / 3) * 2);
    for (let i = 0; i < input.length / 2; i++) input.writeInt16LE(raw.readInt16LE(Math.floor(i * 1.5) * 2), i * 2);
    return Buffer.concat([Buffer.alloc(6400), input, Buffer.alloc(48000)]).toString("base64");
  } finally { clearTimeout(timer); live?.close(); }
}

try {
  const pcm = await sourceAudio("Nasılsın?");
  const capture = path.join(temp, "silence.wav"), silence = Buffer.alloc(32044);
  silence.write("RIFF"); silence.writeUInt32LE(silence.length - 8, 4); silence.write("WAVEfmt ", 8); silence.writeUInt32LE(16, 16);
  silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22); silence.writeUInt32LE(16000, 24); silence.writeUInt32LE(32000, 28);
  silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34); silence.write("data", 36); silence.writeUInt32LE(32000, 40); fs.writeFileSync(capture, silence);
  fs.writeFileSync(path.join(temp, ".env"), "");
  const old = { runId: "old-result", task: "Historical task", sessionId: "isolated-test-session", status: "completed", output: "Bu eski sonuç okunmamalı.", createdAt: Date.now() - 60000, updatedAt: Date.now() - 60000, announcedAt: 0 };
  fs.writeFileSync(path.join(temp, "runs.json"), JSON.stringify({ version: 1, runs: [old] }));
  const env = {
    ...process.env,
    GEMINI_API_KEY: credentials.GEMINI_API_KEY,
    GEMINI_LIVE_MODEL: model, GEMINI_LIVE_VOICE: credentials.GEMINI_LIVE_VOICE || "Zephyr",
    HERMES_HOME: path.join(temp, "hermes"), HERMES_API_URL: "http://127.0.0.1:1",
    IRIS_USER_NAME: "Fatih", IRIS_START_PROD: "1", IRIS_BRAIN_RELAY: "true",
    IRIS_TEST_HOOKS: "1", IRIS_TEST_SKIP_WELCOME: "0",
    IRIS_TEST_CONFIG_PATH: path.join(temp, ".env"), IRIS_TEST_RUN_REGISTRY_PATH: path.join(temp, "runs.json"),
    IRIS_HERMES_SESSION: "isolated-test-session", IRIS_HERMES_AUTOSTART: "false", IRIS_HERMES_TRANSPORT: "runs_api",
    IRIS_REMOTE_ENABLED: "false", IRIS_WAKE_WORD: "false", IRIS_LOAD_TEST_DATA: "false",
    IRIS_BRAIN_AUTO_INDEX: "false", IRIS_BRAIN_PATH: path.join(temp, "vault"),
    IRIS_AUTO_SLEEP_SECONDS: "120", IRIS_AUTO_WAKE_ON_HERMES: "true",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.join(root, "electron", "main.mjs"), `--user-data-dir=${path.join(temp, "chromium")}`, "--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${capture}`, "--autoplay-policy=no-user-gesture-required"], cwd: root, env });
  const page = await app.firstWindow(); await page.waitForSelector(".deck", { timeout: 30000 });
  await app.evaluate(() => globalThis.__irisTest.hideWindow());
  await page.evaluate(() => { window.__lifecycleEvents = []; window.iris.onSidecarEvent((event) => window.__lifecycleEvents.push(event)); });
  const waitPlayed = () => page.waitForFunction(() => window.__lifecycleEvents.some((event) => event.type === "voice_playback_complete"), undefined, { timeout: 45000 });
  const clear = () => page.evaluate(() => { window.__lifecycleEvents = []; });
  await page.evaluate(() => window.iris.startSidecar()); await waitPlayed();
  let events = await page.evaluate(() => window.__lifecycleEvents);
  assert.equal(events.filter((event) => event.type === "voice_queued").length, 1);
  assert.ok(events.some((event) => event.type === "voice_fidelity" && event.expected.includes("Merhaba Fatih")));
  console.log("Real greeting and renderer playback acknowledgement passed; historical result stayed silent.");

  await app.evaluate(() => globalThis.__irisTest.setConversationReplyForTest("İyiyim, teşekkürler."));
  await clear();
  await app.evaluate(() => globalThis.__irisTest.simulateHermesComplete("Isolated result", "Test sonucu hazır. Bu sonuç yalnızca ses akışını kontrol etmek için oluşturuldu. Eski görevler bu testte yeniden okunmaz. Kullanıcı bir soru sorarsa önce o soruya yanıt verilir ve ardından bu sonucun tamamı baştan okunur."));
  await page.waitForFunction(() => window.__lifecycleEvents.some((event) => event.type === "voice_audio_started"), undefined, { timeout: 45000 });
  await page.evaluate(() => window.iris.sendCommand({ type: "speech_activity", source: "test", active: true }));
  await page.evaluate(async (base64) => {
    const raw = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    for (let offset = 0; offset < raw.length; offset += 640) {
      window.iris.sendAudioChunk(raw.slice(offset, offset + 640).buffer);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await window.iris.sendCommand({ type: "speech_activity", source: "test", active: false });
  }, pcm);
  await page.waitForFunction(() => window.__lifecycleEvents.filter((event) => event.type === "voice_playback_complete").length >= 2, undefined, { timeout: 90000 });
  events = await page.evaluate(() => window.__lifecycleEvents);
  const speech = events.filter((event) => event.type === "voice_fidelity").map((event) => event.expected);
  const answer = speech.findIndex((text) => text === "İyiyim, teşekkürler.");
  assert.ok(answer >= 0 && speech.slice(answer + 1).some((text) => text.startsWith("Test sonucu hazır.")));
  console.log("Real PCM interruption → isolated brain answer → result restart and actual playback passed.");

  await clear();
  await app.evaluate(() => globalThis.__irisTest.simulateHermesComplete("Stopped result", "Bu uzun test sonucunun okuması kullanıcı tarafından durdurulacak. ".repeat(8)));
  await page.waitForFunction(() => window.__lifecycleEvents.some((event) => event.type === "voice_audio_started"), undefined, { timeout: 45000 });
  await page.evaluate(() => window.iris.stopSidecar()); await clear();
  await page.evaluate(() => window.iris.startSidecar()); await waitPlayed();
  events = await page.evaluate(() => window.__lifecycleEvents);
  assert.equal(events.filter((event) => event.type === "voice_queued").length, 1);
  assert.ok(events.some((event) => event.type === "voice_fidelity" && event.expected.includes("Merhaba Fatih")));
  assert.equal(events.some((event) => event.type === "voice_started" && event.run_id), false);
  console.log("Manual stop/reopen greeted once without replaying the interrupted result.");
  await page.evaluate(() => window.iris.stopSidecar());
} finally {
  await app?.close();
  console.log(`Isolated voice test directory: ${temp}`);
}
