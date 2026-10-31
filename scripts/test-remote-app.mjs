// Opt-in end-to-end test: real Electron + private HTTPS + Android-sized Chrome.
// Uses isolated local settings/registry and a new Hermes session. No user files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { _electron, chromium } from "playwright-core";
import { loadEnvFiles } from "../electron/configStore.mjs";
import { HermesGatewayClient } from "../electron/hermesGatewayClient.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); loadEnvFiles({ repoRoot: root });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "iris-mobile-app-"));
const origin = process.env.IRIS_REMOTE_ORIGIN;
assert.ok(origin?.startsWith("https://"), "Run npm run setup:remote first");
const env = { ...process.env, IRIS_START_PROD: "1", IRIS_TEST_HOOKS: "1", IRIS_TEST_SKIP_WELCOME: "1", IRIS_TEST_CONFIG_PATH: path.join(temp, ".env"), IRIS_TEST_RUN_REGISTRY_PATH: path.join(temp, "runs.json"), IRIS_HERMES_SESSION: `iris-mobile-test-${Date.now()}`, IRIS_HERMES_AUTOSTART: "false", IRIS_WAKE_WORD: "false", IRIS_LOAD_TEST_DATA: "false", IRIS_AUTO_SLEEP_SECONDS: "300", IRIS_REMOTE_ENABLED: "true" };
delete env.ELECTRON_RUN_AS_NODE;
const silence = Buffer.alloc(44 + 32000); silence.write("RIFF"); silence.writeUInt32LE(silence.length - 8, 4); silence.write("WAVEfmt ", 8); silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22); silence.writeUInt32LE(16000, 24); silence.writeUInt32LE(32000, 28); silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34); silence.write("data", 36); silence.writeUInt32LE(32000, 40); const capture = path.join(temp, "silent.wav"); fs.writeFileSync(capture, silence);
let app, browser, seed, page;
const seedClient = new HermesGatewayClient({ candidates: () => [{ cmd: process.env.HERMES_BIN || "hermes", args: [] }], env: { ...process.env, HERMES_TUI_TOOLSETS: "web,clarify" } });
const seedTransport = new HermesInteractiveTransport({ client: seedClient, conversationOnly: true });
try {
  // An existing valid empty session prevents the UI's normal "newest chat"
  // fallback from attaching a test to any real user conversation.
  seed = await seedTransport.createSession(); env.IRIS_HERMES_SESSION = seed.id;
  await seedClient.request("session.close", { session_id: seed.liveSessionId });
  app = await _electron.launch({ args: [path.join(root, "electron/main.mjs"), `--user-data-dir=${path.join(temp, "electron")}`, "--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${capture}`], cwd: root, env });
  const desktop = await app.firstWindow(); await desktop.waitForSelector(".deck", { timeout: 30000 });
  await app.evaluate(() => globalThis.__irisTest.hideWindow());
  for (let i = 0; i < 50; i++) {
    const state = await app.evaluate(() => globalThis.__irisTest.remoteStatus());
    if (state.error) throw new Error(state.error);
    if (state.running) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${capture}`] });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, permissions: ["microphone", "notifications"] });
  page = await context.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin); await page.getByLabel("Eşleştirme kodu").waitFor();
  const { code } = await app.evaluate(() => globalThis.__irisTest.remotePairCode());
  await page.getByLabel("Eşleştirme kodu").fill(code); await page.getByRole("button", { name: "Eşleştir", exact: true }).click();
  await page.getByRole("button", { name: "Konuşmaya bağlan", exact: true }).waitFor({ timeout: 45000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.getAppManifest");
  assert.deepEqual((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors.filter((e) => e.errorId !== "in-incognito"), [], "PWA must be installable (test context is incognito)");
  const controlsOnly = process.argv.includes("--controls-only");
  if (!controlsOnly) {
  await page.evaluate(() => {
    window.__mobileEvents = []; window.iris.onSidecarEvent((event) => window.__mobileEvents.push(event));
    window.__microphoneRequests = 0; const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => { window.__microphoneRequests++; return getUserMedia(...args); };
  });
  await page.getByLabel("Mesaj", { exact: true }).fill("Bu bir bağlantı testidir. Yalnızca bağlantı hazır diyerek Türkçe cevap ver. Görev önerme.");
  await page.getByRole("button", { name: "Gönder", exact: true }).click();
  await page.waitForFunction(() => window.__mobileEvents.some((e) => e.type === "voice_playback_complete"), null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.__microphoneRequests), 0, "typing does not request microphone access");
  await page.getByRole("button", { name: "Mikrofonu aç", exact: true }).click();
  await page.getByRole("button", { name: "Mikrofonu kapat", exact: true }).waitFor({ timeout: 30000 });
  const voice = await page.evaluate(() => window.__mobileEvents.filter((e) => ["voice_fidelity", "voice_playback_complete"].includes(e.type)));
  assert.ok(voice.some((e) => e.type === "voice_fidelity" && /hazır/i.test(e.expected)));
  assert.notEqual((await app.evaluate(() => globalThis.__irisTest.remoteProbe())).voice.deviceId, "desktop");
  console.log("Private HTTPS pairing → real Hermes reply → Gemini audio over binary WebSocket → Chrome playback acknowledgement passed.");
  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await page.getByLabel("Beyin sağlayıcısı ve modeli").waitFor();
  await page.waitForFunction(() => document.querySelectorAll('select[aria-label="Beyin sağlayıcısı ve modeli"] option').length === 14, null, { timeout: 30000 });
  assert.equal(await page.locator('select[aria-label="Beyin sağlayıcısı ve modeli"] option').count(), 14);
  assert.equal(await page.locator('select[aria-label="Beyin sağlayıcısı ve modeli"] optgroup').count(), 2);
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), "activated");
  const cacheURLs = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((r) => r.url)))).flat());
  assert.equal(cacheURLs.some((url) => url.includes("/api/")), false);
  if (process.argv.includes("--with-work")) {
    await page.getByRole("button", { name: "Konuşma", exact: true }).click();
    const output = path.join(temp, "mobile-result.txt");
    await page.getByLabel("Mesaj", { exact: true }).fill(`Bu zararsız testte ${output.replaceAll("\\", "/")} dosyasını oluştur, içine yalnızca mobile-ok yaz. Önce görev önerisi hazırla ve onayımı bekle.`);
    await page.getByRole("button", { name: "Gönder", exact: true }).click();
    await page.getByRole("button", { name: "Onayla", exact: true }).waitFor({ timeout: 90000 });
    assert.equal(fs.existsSync(output), false);
    await page.getByRole("button", { name: "Onayla", exact: true }).click();
    await page.waitForFunction(() => window.__mobileEvents.some((e) => e.type === "hermes_completion" && e.output?.includes("mobile")), null, { timeout: 90000 });
    assert.equal(fs.readFileSync(output, "utf8").trim(), "mobile-ok");
    console.log("Mobile approval → isolated native Hermes worker → harmless file result passed.");
  }
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "Konuşmayı bitir", exact: true }).click();
  assert.equal((await app.evaluate(() => globalThis.__irisTest.remoteProbe())).voice.deviceId, null);
  }
  const newSession = await page.evaluate(() => window.iris.createHermesSession());
  assert.ok(newSession.id);
  await page.evaluate((id) => window.iris.saveConfig({ IRIS_HERMES_SESSION: id, IRIS_USER_NAME: "Mobile test" }), newSession.id);
  await desktop.waitForFunction((id) => document.querySelector(".session-chip")?.getAttribute("title")?.includes(id), newSession.id, { timeout: 15000 });
  assert.equal(await desktop.evaluate(async () => (await window.iris.getConfig()).userName), "Mobile test");
  console.log("Mobile chat selection and shared settings synchronize to the desktop UI; PWA installability passed.");
  if (!controlsOnly) {
  await desktop.evaluate(() => window.iris.claimDesktopVoice());
  assert.equal((await app.evaluate(() => globalThis.__irisTest.remoteProbe())).voice.deviceId, "desktop");
  }
  await page.screenshot({ path: path.join(temp, "mobile.png"), fullPage: true });
  console.log(`Mobile controls passed. Screenshot: ${path.join(temp, "mobile.png")}`);
} catch (error) {
  console.error("Diagnostics:", await app?.evaluate(() => globalThis.__irisTest.relayState()).catch(() => null));
  console.error("Isolated test conversation:", await page?.locator(".mobile-chat").innerText().catch(() => "unavailable"));
  await page?.screenshot({ path: path.join(temp, "failure.png"), fullPage: true }).catch(() => {});
  console.error("Test directory:", temp); throw error;
} finally {
  await browser?.close();
  await app?.evaluate(() => globalThis.__irisTest.remoteTestCleanup()).catch(() => {});
  await app?.close();
  if (seed) await seedTransport.deleteSession(seed.id).catch(() => {});
  seedTransport.close({ force: true });
}
