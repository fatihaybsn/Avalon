// Opt-in real-service check of the default Hermes search -> Gemini voice path.
// Uses an isolated chat/config/profile and never opens the physical microphone.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import { loadEnvFiles } from "../electron/configStore.mjs";
import { HermesGatewayClient } from "../electron/hermesGatewayClient.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";
import { DEFAULT_BRAIN, validateBrainSelection } from "../electron/brainModels.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles({ repoRoot: root });
const verifyStandby = process.argv.includes("--verify-standby");
const query = process.env.IRIS_LIVE_TEST_QUERY ||
  "Webde ara: Python'ın güncel kararlı sürümü nedir? Resmî python.org sayfasını web_extract ile okuyarak doğrula. Türkçe tek kısa yanıt ve kaynak URL ver. Başka bir görev önerme.";
const route = validateBrainSelection({
  provider: process.env.IRIS_BRAIN_PROVIDER || DEFAULT_BRAIN.provider,
  modelId: process.env.IRIS_BRAIN_MODEL || DEFAULT_BRAIN.modelId,
  reasoning: process.env.IRIS_BRAIN_REASONING || "default",
});
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "iris-live-search-"));
fs.writeFileSync(path.join(temp, ".env"), "");
const client = new HermesGatewayClient({
  candidates: () => [{ cmd: process.env.HERMES_BIN || "hermes", args: [] }],
  env: { ...process.env, HERMES_TUI_TOOLSETS: "web,clarify" },
});
const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
let app, session;

try {
  session = await transport.createSession({ route });
  // Release the transcript lease before Avalon resumes this isolated chat.
  await client.request("session.close", { session_id: session.liveSessionId });
  const capture = path.join(temp, "silence.wav"), silence = Buffer.alloc(32044);
  silence.write("RIFF"); silence.writeUInt32LE(silence.length - 8, 4); silence.write("WAVEfmt ", 8);
  silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
  silence.writeUInt32LE(16000, 24); silence.writeUInt32LE(32000, 28); silence.writeUInt16LE(2, 32);
  silence.writeUInt16LE(16, 34); silence.write("data", 36); silence.writeUInt32LE(32000, 40);
  fs.writeFileSync(capture, silence);
  const env = {
    ...process.env,
    IRIS_BRAIN_RELAY: "true", IRIS_START_PROD: "1", IRIS_TEST_HOOKS: "1",
    IRIS_TEST_SKIP_WELCOME: "1", IRIS_TEST_CONFIG_PATH: path.join(temp, ".env"),
    IRIS_TEST_RUN_REGISTRY_PATH: path.join(temp, "runs.json"), IRIS_HERMES_SESSION: session.id,
    // The HTTP history service may have a stale list of empty chats. Disable
    // that optional service so startup cannot replace our new isolated chat.
    HERMES_API_URL: "http://127.0.0.1:1",
    IRIS_LOAD_TEST_DATA: "false", IRIS_WAKE_WORD: "false", IRIS_REMOTE_ENABLED: "false",
    IRIS_HERMES_AUTOSTART: "false", IRIS_AUTO_WAKE_ON_HERMES: "false",
    IRIS_BRAIN_AUTO_INDEX: "false", IRIS_BRAIN_PATH: path.join(temp, "vault"),
    IRIS_AUTO_SLEEP_SECONDS: "15",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [path.join(root, "electron/main.mjs"), `--user-data-dir=${path.join(temp, "chromium")}`,
      "--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${capture}`, "--autoplay-policy=no-user-gesture-required"],
    cwd: root, env,
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".deck", { timeout: 30000 });
  assert.equal((await page.evaluate(() => window.iris.getConfig())).hermesSession, session.id, "The test must keep its own chat");
  await app.evaluate(() => globalThis.__irisTest.hideWindow());
  await page.evaluate(() => {
    window.__liveSearchTest = { events: [], audioChunks: 0, searching: false, sleptDuringSearch: false, labelSeen: false };
    window.iris.onSidecarEvent((event) => {
      const test = window.__liveSearchTest;
      test.events.push(event);
      if (event.type === "web_search") test.searching = event.state === "searching";
      if (event.type === "sidecar_status" && !event.status?.running && test.searching) test.sleptDuringSearch = true;
    });
    window.iris.onAudioChunk(() => window.__liveSearchTest.audioChunks++);
    new MutationObserver(() => {
      if (document.body.textContent.includes("Searching web…")) window.__liveSearchTest.labelSeen = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const startStatus = await page.evaluate(() => window.iris.startSidecar({ mode: "none" }));
  assert.equal(startStatus.running, true, "Gemini Live must connect before the test submits a prompt");
  await page.waitForFunction(() => !document.querySelector(".boot"), undefined, { timeout: 15000 });
  console.log("Default Hermes conversation connected; starting real web search.");
  await page.evaluate((text) => {
    window.__liveSearchTest.events = []; window.__liveSearchTest.audioChunks = 0;
    return window.iris.sendCommand({ type: "text", text });
  }, query);
  await page.waitForFunction(() => window.__liveSearchTest.events.some((event) =>
    event.type === "voice_playback_complete" || event.type === "voice_relay_error"), undefined, { timeout: 180000 });
  const result = await page.evaluate(() => {
    const test = window.__liveSearchTest;
    return {
      responses: test.events.filter((event) => event.type === "transcript" && event.speaker === "hermes").map((event) => event.text),
      searchEvents: test.events.filter((event) => event.type === "web_search"),
      errors: test.events.filter((event) => event.type === "voice_relay_error").map((event) => event.error),
      played: test.events.some((event) => event.type === "voice_playback_complete"),
      audioChunks: test.audioChunks, sleptDuringSearch: test.sleptDuringSearch, labelSeen: test.labelSeen,
    };
  });
  assert.deepEqual(result.errors, [], "The real search/voice path reported an error");
  assert.ok(result.responses.length && result.played && result.audioChunks, "A brain answer and actual voice playback are required");
  assert.match(result.responses.join("\n"), /https?:\/\//, "The answer must include a source URL");
  for (const tool of ["web_search", "web_extract"]) {
    assert.ok(result.searchEvents.some((event) => event.tool === tool && event.tool_event === "tool.completed" && !event.is_error), `${tool} must really complete successfully`);
  }
  assert.ok(result.searchEvents.every((event) => event.session_id === session.id), "Search events must belong to the isolated chat");
  assert.equal(result.searchEvents.at(-1)?.state, "idle", "Search status must clear");
  assert.equal(result.sleptDuringSearch, false, "Avalon must stay awake during web tools");
  assert.equal(result.labelSeen, true, "The real renderer must show Searching web…");
  if (verifyStandby) {
    await page.waitForFunction(() => window.__liveSearchTest.events.some((event) =>
      event.type === "sidecar_status" && !event.status?.running), undefined, { timeout: 60000 });
    assert.equal(await app.evaluate(() => globalThis.__irisTest.isAutoSlept()), true, "Idle must end in real standby");
  }
  console.log(JSON.stringify({ ok: true, route, standbyVerified: verifyStandby, ...result }));
} catch (error) {
  if (app) console.error("Search test state:", await app.evaluate(() => ({ live: globalThis.__irisTest.isLive(), relay: globalThis.__irisTest.relayState() })).catch(() => null));
  if (app) console.error("Search test events:", await (await app.firstWindow()).evaluate(() => window.__liveSearchTest?.events
    .filter((event) => ["sidecar_status", "gemini_status", "fatal", "voice_relay_error", "web_search"].includes(event.type)).slice(-15)).catch(() => null));
  throw error;
} finally {
  await app?.close().catch(() => undefined);
  if (session) await transport.deleteSession(session.id).catch(() => undefined);
  transport.close({ force: true });
  console.log(`Isolated search test diagnostics: ${temp}`);
}
