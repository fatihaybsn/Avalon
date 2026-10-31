// Offline renderer regression: real React/Web Audio, synthetic mic, fake bridge.
// No Gemini/Hermes connections, credentials, physical microphone, or camera.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright-core";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "iris-startup-ui-"));
const screenshotDir = process.env.IRIS_STARTUP_SCREENSHOTS;
if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
const harness = path.join(temp, "main.cjs");
await fs.writeFile(harness, `
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 900,
    webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } });
  win.loadURL('about:blank');
});
`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [harness, `--user-data-dir=${path.join(temp, "profile")}`], cwd: root, env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.addInitScript(() => {
    if (location.protocol === "about:") return;
    const listeners = new Map();
    const emit = (name, value) => { for (const callback of listeners.get(name) || []) callback(value); };
    const test = window.__startupTest = { sounds: [], ok: [], pcm: [], playback: [], commands: [], done: [], events: [], scenario: "cold", emit,
      captureRequests: 0, config: { configured: true, sounds: true, startupSounds: true, startupSoundVolume: 55, wakeWord: false,
        geminiApiKey: "", geminiApiKeyConfigured: true, geminiModel: "test", geminiVoice: "Zephyr",
        hermesUrl: "http://127.0.0.1:8642", hermesKey: "", hermesBin: "", hermesHome: "", brainPath: "",
        wakeSensitivity: "balanced", showWakeDiagnostics: false, loadTestData: false, hermesSession: "test",
        userName: "Test", voices: ["Zephyr"], models: ["test"], micDevice: "", cameraDevice: "",
        speechRate: 1, brainModelStatus: { selected: { provider: "evren", modelId: "test" }, effective: null },
      } };
    const seenOk = new Set();
    new MutationObserver(() => {
      for (const row of document.querySelectorAll(".boot-line.done")) {
        if (!seenOk.has(row.textContent)) {
          seenOk.add(row.textContent);
          test.ok.push({ label: row.textContent, at: performance.now() });
        }
      }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    const originalOscillator = AudioContext.prototype.createOscillator;
    const originalBufferSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = originalBufferSource.call(this), context = this;
      const start = source.start.bind(source);
      source.start = (at = context.currentTime) => {
        const samples = source.buffer.getChannelData(0), crossings = [];
        for (let i = Math.floor(samples.length * 0.2) + 1; i < samples.length * 0.8; i++) {
          if (samples[i - 1] < 0 && samples[i] >= 0) crossings.push(i);
        }
        const row = { at, duration: source.buffer.duration, frequency: (crossings.length - 1) * source.buffer.sampleRate / (crossings.at(-1) - crossings[0]), ended: null };
        source.addEventListener("ended", () => { row.ended = performance.now(); });
        test.playback.push(row);
        return start(at);
      };
      return source;
    };
    AudioContext.prototype.createOscillator = function () {
      const oscillator = originalOscillator.call(this), context = this;
      const sound = {};
      const start = oscillator.start.bind(oscillator), stop = oscillator.stop.bind(oscillator);
      oscillator.start = (at = context.currentTime) => {
        sound.at = performance.now() + (at - context.currentTime) * 1000;
        sound.frequency = oscillator.frequency.value;
        test.sounds.push(sound); return start(at);
      };
      oscillator.stop = (at = context.currentTime) => {
        sound.end = performance.now() + (at - context.currentTime) * 1000;
        return stop(at);
      };
      return oscillator;
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      test.captureRequests++;
      if (constraints.video) throw new Error("Camera disabled by offline test");
      if (test.scenario === "mic-denied") throw new Error("Microphone denied");
      const context = new AudioContext();
      return context.createMediaStreamDestination().stream;
    };
    const event = (value) => { test.events.push({ ...value, at: performance.now() }); emit("onSidecarEvent", value); };
    test.event = event;
    test.speak = () => {
      event({ type: "audio_state", state: "speaking" });
      emit("onAudioChunk", { data: btoa("\0".repeat(2400)), mimeType: "audio/pcm;rate=24000", utteranceId: "welcome" });
      emit("onAudioOutputEnd", { utteranceId: "welcome" });
    };
    const methods = {
      getSidecarStatus: async () => ({ running: false, pid: null }),
      getAppConfig: async () => test.config, getConfig: async () => test.config,
      getConversationHistory: async () => ({ ok: true, sessionId: test.config.hermesSession, messages: [] }),
      getHermesHistory: async () => ({ ok: true, tasks: [] }), listHermesSessions: async () => ({ ok: true, sessions: test.sessions || [] }),
      startSidecar: async () => {
        const resume = test.scenario === "resume";
        event({ type: "sidecar_status", status: { running: true, pid: 1 }, resuming: resume });
        event({ type: "gemini_status", status: "connecting" });
        if (test.scenario === "slow") await new Promise((resolve) => setTimeout(resolve, 1200));
        event({ type: "gemini_status", status: "connected" });
        event({ type: "audio_state", state: "listening" });
        return { running: true, pid: 1 };
      },
      stopSidecar: async () => { event({ type: "sidecar_status", status: { running: false } }); return { running: false }; },
      notifyBootDone: () => { test.done.push(performance.now()); test.speak(); },
      sendAudioChunk: () => test.pcm.push(performance.now()),
      sendCommand: async (command) => { test.commands.push({ ...command, at: performance.now() }); return { ok: true }; },
      saveConfig: async (updates) => {
        if ("IRIS_HERMES_SESSION" in updates) test.config.hermesSession = updates.IRIS_HERMES_SESSION;
        if ("IRIS_STARTUP_SOUNDS" in updates) test.config.startupSounds = updates.IRIS_STARTUP_SOUNDS === "true";
        if ("IRIS_STARTUP_SOUND_VOLUME" in updates) test.config.startupSoundVolume = Number(updates.IRIS_STARTUP_SOUND_VOLUME);
        if ("IRIS_SPEECH_RATE" in updates) test.config.speechRate = Number(updates.IRIS_SPEECH_RATE);
        event({ type: "config_changed" }); return { ...test.config };
      },
      brainCatalog: async () => ({ models: [] }), brainStatus: async () => test.config.brainModelStatus,
      remoteStatus: async () => ({ running: false, origin: "", port: 8765 }),
    };
    window.iris = new Proxy(methods, { get(target, name) {
      if (name === "transport") return undefined;
      if (String(name).startsWith("on")) return (callback) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback); return () => listeners.get(name).delete(callback);
      };
      return target[name] || (() => Promise.resolve({ ok: true }));
    } });
  });
  const load = async (scenario, config = {}) => {
    await page.goto(pathToFileURL(path.join(root, "dist/index.html")).href);
    await page.waitForSelector(".deck");
    await page.evaluate(({ scenario, config }) => {
      window.__startupTest.scenario = scenario;
      Object.assign(window.__startupTest.config, config);
      window.__startupTest.event({ type: "config_changed" });
    }, { scenario, config });
    // Allow the async settings snapshot to commit before the wake gesture.
    await page.waitForTimeout(100);
  };
  const wake = () => page.evaluate(() => window.__startupTest.emit("onWakeRequest", { source: "manual" }));
  const result = () => page.evaluate(() => {
    const { sounds, ok, pcm, done, events } = window.__startupTest;
    return { sounds, ok, pcm, done, events };
  });
  const reports = [];

  await load("cold"); await wake();
  await page.waitForSelector(".boot");
  await page.waitForFunction(() => [...document.querySelectorAll(".boot-line")].filter((line) => line.classList.contains("done")).length === 4);
  assert.match(await page.locator(".boot-log").innerText(), /hermes brain \(optional\).*WAIT/s);
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, "boot.png"), animations: "disabled" });
  }
  await page.waitForFunction(() => window.__startupTest.done.length === 1);
  const cold = await result();
  assert.equal(cold.sounds.length, 11); // Four two-part checks + three activation voices.
  assert.equal(cold.ok.length, 4);
  for (let i = 0; i < cold.ok.length; i++) {
    if (i) assert.ok(cold.ok[i].at - cold.ok[i - 1].at >= 300, "OK rows must appear separately");
    assert.ok(Math.abs(cold.sounds[i * 2].at - cold.ok[i].at) < 80, "Each tick must follow its visible OK, not the raw result batch");
  }
  const started = cold.events.find((event) => event.type === "sidecar_status").at;
  const elapsed = cold.done[0] - started;
  assert.ok(elapsed >= 2800 && elapsed < 3700, `Startup took ${elapsed} ms`);
  assert.ok(Math.max(...cold.sounds.map((sound) => sound.end)) < cold.done[0]);
  assert.ok(cold.pcm.length > 0, "Microphone must resume between the check rhythm and activation");
  const activation = cold.sounds.slice(-3);
  assert.equal(cold.pcm.filter((at) => at > activation[0].at + 25 && at < Math.max(...activation.map((sound) => sound.end)) + 100).length, 0);
  reports.push({ scenario: "fast cold start / optional Hermes pending / PCM gate / greeting", elapsedMs: Math.round(elapsed) });

  await load("slow"); await wake(); await page.waitForSelector(".boot");
  const pending = await page.locator(".boot-line").filter({ hasText: "gemini live uplink" }).innerText();
  assert.ok(!pending.includes("OK"), "Connecting must never show OK");
  await page.waitForFunction(() => window.__startupTest.done.length === 1);
  reports.push({ scenario: "slow connection shows pending until real connection" });

  await load("cold"); await wake(); await page.waitForSelector(".boot");
  await page.evaluate(() => window.__startupTest.speak());
  const before = (await result()).sounds.length;
  await page.waitForFunction(() => window.__startupTest.done.length === 1);
  assert.equal((await result()).sounds.length, before);
  reports.push({ scenario: "early Gemini audio cancels ticks and activation" });

  await load("slow"); await wake(); await page.waitForSelector(".boot");
  await page.evaluate(() => {
    window.__startupTest.event({ type: "fatal", message: "Test connection failure" });
    window.__startupTest.event({ type: "sidecar_status", status: { running: false } });
  });
  await page.waitForSelector(".boot", { state: "detached" });
  assert.equal((await result()).done.length, 0);
  reports.push({ scenario: "failed/stopped boot has no activation or boot-done greeting" });

  for (const [scenario, config] of [["resume", {}], ["cold", { startupSounds: false }], ["cold", { startupSoundVolume: 0 }], ["cold", { sounds: false }]]) {
    await load(scenario, config); await wake();
    if (scenario === "resume") {
      await page.waitForTimeout(400);
      assert.equal(await page.locator(".boot").count(), 0);
    } else await page.waitForFunction(() => window.__startupTest.done.length === 1);
    const value = await result();
    const expected = scenario === "resume" || config.startupSounds === false ? 4 : 0; // Existing wake cue only.
    assert.equal(value.sounds.length, expected);
    reports.push({ scenario, config, oscillators: value.sounds.length });
  }

  await load("cold");
  await page.getByTitle("Settings", { exact: true }).click();
  await page.waitForSelector(".setup-card").catch(async (error) => {
    console.error(JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(-2000) }));
    throw error;
  });
  assert.equal(await page.getByLabel("Startup effects volume", { exact: true }).inputValue(), "55");
  if (screenshotDir) {
    await page.getByLabel("Startup effects volume", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshotDir, "settings.png") });
  }
  await page.getByLabel("Startup effects volume", { exact: true }).fill("25");
  await page.getByRole("button", { name: /Save/ }).click();
  await page.waitForFunction(() => window.__startupTest.config.startupSoundVolume === 25);
  assert.equal(errors.length, 0, errors.join("\n"));
  reports.push({ scenario: "settings volume saves through the bridge" });

  // Exercise the built production DSP and real AudioBufferSourceNode callbacks.
  // No network, room microphone, or generated/model audio is involved.
  await load("cold", { speechRate: 1.3, sounds: false, startupSounds: false });
  await page.evaluate(() => {
    const test = window.__startupTest;
    const pcm = new Int16Array(24000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i * 2 * Math.PI * 440 / 24000) * 1600;
    for (let i = 0; i < pcm.length; i += 2400) test.emit("onAudioChunk", { pcm: pcm.slice(i, i + 2400).buffer, utteranceId: "speed-test", mimeType: "audio/pcm;rate=24000" });
    test.emit("onAudioOutputEnd", { utteranceId: "speed-test" });
  });
  await page.waitForFunction(() => window.__startupTest.commands.some((command) => command.type === "playback_ended" && command.utteranceId === "speed-test"));
  const playback = await page.evaluate(() => ({ rows: window.__startupTest.playback, commands: window.__startupTest.commands }));
  assert.ok(Math.abs(playback.rows.reduce((n, row) => n + row.duration, 0) - Math.round(24000 / 1.3) / 24000) < 1e-6);
  assert.ok(playback.rows.filter((row) => Number.isFinite(row.frequency)).every((row) => Math.abs(row.frequency - 440) < 5));
  assert.ok(playback.rows.every((row) => row.ended != null), "acknowledgement must follow every real source end");
  assert.equal(playback.commands.filter((command) => command.type === "playback_ended").length, 1);
  reports.push({ scenario: "1.3x real browser playback preserves 440Hz and acknowledges the audible tail once", durationSeconds: playback.rows.reduce((n, row) => n + row.duration, 0) });

  await page.getByTitle("Settings", { exact: true }).click();
  const rateControls = page.getByRole("group", { name: "Konuşma hızı", exact: true });
  assert.equal(await rateControls.getByRole("button", { name: "1.3x", exact: true }).getAttribute("aria-pressed"), "true");
  await rateControls.getByRole("button", { name: "1.0x", exact: true }).click();
  await page.getByRole("button", { name: /Save/ }).click();
  await page.waitForFunction(() => window.__startupTest.config.speechRate === 1);
  reports.push({ scenario: "speech speed setting returns to 1.0x through the rendered settings UI" });
  assert.equal(errors.length, 0, errors.join("\n"));
  await load("cold", { wakeWord: true });
  assert.equal(await page.evaluate(() => window.__startupTest.captureRequests), 0, "a stale wake-word setting must not open the microphone while asleep");
  await page.getByTitle("Settings", { exact: true }).click();
  assert.equal(await page.getByLabel("Wake word", { exact: true }).count(), 0);
  assert.doesNotMatch(await page.locator("body").innerText(), /Hey Iris|Hey Avalon/);
  reports.push({ scenario: "voice wake-up stays disabled even with a stale saved setting; no idle microphone or enable control" });

  await load("cold");
  const searchLabel = page.getByText("Searching web…", { exact: true });
  const emitSearchEvents = (events) => page.evaluate(async (items) => {
    for (const event of items) window.__startupTest.event(event);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, events);
  await emitSearchEvents([
    { type: "sidecar_status", status: { running: true }, resuming: true },
    { type: "audio_state", state: "listening" },
    { type: "web_search", session_id: "other-chat", state: "searching" },
  ]);
  assert.equal(await searchLabel.count(), 0, "Background chat search must not appear in this chat");
  await emitSearchEvents([{ type: "web_search", session_id: "test", state: "searching" }]);
  assert.equal(await searchLabel.count(), 1);
  assert.doesNotMatch(await page.locator("body").innerText(), /Searching Google/);
  await emitSearchEvents([{ type: "web_search", session_id: "test", state: "idle" }]);
  assert.equal(await searchLabel.count(), 0, "Completed tools must clear the label");
  await emitSearchEvents([{ type: "brain_session", session_id: "other-chat" }]);
  assert.equal(await searchLabel.count(), 1, "Switching chats must restore that chat's active search");
  await emitSearchEvents([{ type: "brain_session", session_id: "test" }]);
  assert.equal(await searchLabel.count(), 0);
  await emitSearchEvents([{ type: "google_search", state: "searching" }]);
  assert.equal(await searchLabel.count(), 1, "Legacy search evidence must keep working with the generic label");
  await emitSearchEvents([{ type: "google_search", state: "idle" }]);
  assert.equal(await searchLabel.count(), 0);
  await page.evaluate(() => {
    window.__startupTest.sessions = ["test", "other-chat"].map((id) => ({ id, title: id, source: "iris", messageCount: 0, lastActive: 0 }));
  });
  await page.locator(".session-chip").click();
  await page.locator(".session-item").filter({ hasText: "other-chat" }).click();
  await page.waitForFunction(() => document.body.textContent.includes("Searching web…"));
  await page.locator(".session-chip").click();
  await page.locator(".session-item").filter({ hasText: "test" }).click();
  await page.waitForFunction(() => !document.body.textContent.includes("Searching web…"));
  reports.push({ scenario: "web activity uses generic wording, clears on completion, follows the selected chat and preserves legacy events" });
  assert.equal(errors.length, 0, errors.join("\n"));
  if (process.env.IRIS_STARTUP_AUDIO_PREVIEW) {
    // Render the production synthesizer itself, rather than a second imitation
    // of its envelopes. The preview compresses the quiet gap for auditioning.
    const source = ts.transpileModule(await fs.readFile(path.join(root, "src/lib/startupSounds.ts"), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    // Isolated blank renderer for the offline exporter; the app's CSP stays
    // unchanged and continues to disallow dynamic evaluation in production.
    await page.goto("about:blank");
    const rendered = await page.evaluate(async (source) => {
      const render = async (activation) => {
        const context = new OfflineAudioContext(1, 44100, 44100);
        const runningContext = new Proxy(context, { get(target, key) {
          if (key === "state") return "running";
          const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
        } });
        const exports = {};
        new Function("AudioContext", "exports", source)(function () { return runningContext; }, exports);
        exports.startupSounds.configure(true, 0.55);
        exports.startupSounds.begin();
        if (activation) exports.startupSounds.activate();
        else for (const id of ["runtime", "output", "uplink", "input"]) exports.startupSounds.check(id);
        return Array.from((await context.startRendering()).getChannelData(0));
      };
      return { checks: await render(false), activation: await render(true) };
    }, source);
    const rate = 44100, samples = new Float32Array(Math.round(rate * 1.5));
    samples.set(rendered.checks.slice(0, Math.round(rate * 0.9)));
    samples.set(rendered.activation.slice(0, Math.round(rate * 0.5)), rate);
    const wav = Buffer.alloc(44 + samples.length * 2);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
    await fs.writeFile(process.env.IRIS_STARTUP_AUDIO_PREVIEW, wav);
    reports.push({ scenario: "offline audition rendered from production synthesis", peak: Math.max(...samples.map(Math.abs)) });
  }
  console.log(JSON.stringify({ ok: true, reports, pageErrors: errors }, null, 2));
} finally {
  await app?.close();
  // The only recursive cleanup target is the explicit directory made above.
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(temp, { recursive: true, force: true });
}
