// Offline real-renderer UI/performance checks; no account, camera or microphone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright-core";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-research-ui-"));
fs.writeFileSync(path.join(temp, "main.cjs"), `const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');app.whenReady().then(()=>new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{contextIsolation:false,nodeIntegration:false,backgroundThrottling:false,offscreen:true}}).loadURL('about:blank'));`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(temp, "main.cjs"), `--user-data-dir=${path.join(temp, "profile")}`, "--mute-audio"], env });
try {
  const page = await app.firstWindow(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.addInitScript(() => {
    if (location.protocol === "about:") return;
    const listeners = new Map();
    const test = window.__researchUi = { commands: [], proposals: [], updates: [], catalogFailures: 0, defaultsFailures: 0, globalModelChanges: 0, contexts: 0, disposed: 0, session: "ui-test", maximized: false,
      emit: (channel, event) => { for (const fn of listeners.get(channel) || []) fn(event); } };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); test.contexts++; } close() { test.disposed++; return super.close(); } };
    const config = { configured: true, userName: "Test", sounds: false, startupSounds: false, startupSoundVolume: 55, speechRate: 1, permissionMode: "standard", conversationLanguage: "tr", wakeWord: false,
      geminiApiKeyConfigured: true, geminiModel: "test", geminiVoice: "Zephyr", hermesSession: "ui-test", loadTestData: false, brainPath: "", micDevice: "", cameraDevice: "",
      brainModelStatus: { selected: { provider: "opencode", modelId: "big-pickle" }, effective: null, pending: true }, voices: ["Zephyr"], models: ["test"] };
    const activeRoute = { provider: "evren", modelId: "qwen3.8-flash-next", reasoning: "disabled" };
    const catalog = { configured: { evren: true, opencode: true }, models: [
      { provider: "evren", modelId: "qwen3.8-flash-next", label: "Qwen 3.8 Flash Next", reasoningOptions: [{ value: "default", label: "Varsayılan" }, { value: "disabled", label: "Kapalı" }, { value: "high", label: "Yüksek" }] },
      { provider: "opencode", modelId: "beam-free", label: "Beam Free", reasoningOptions: [{ value: "default", label: "Varsayılan" }, { value: "low", label: "Düşük" }, { value: "high", label: "Yüksek" }] },
      { provider: "opencode", modelId: "big-pickle", label: "Big Pickle", reasoningOptions: [{ value: "default", label: "Varsayılan" }] },
    ] };
    const jobs = [{ id: "schedule_abcdef", name: "İlan takibi", label: "Her gün 09:00 (Europe/Istanbul)", paused: false, nextRunAt: "2026-10-29T09:00:00+03:00", lastRun: null, history: [], error: "",
      modelLabel: "OpenCode Free / Beam Free · düşünme: Yüksek",
      spec: { topic: "İlan takibi", purpose: "Yeni ilanları bul", sites: ["example.com"], minutes: 30, mode: "deep", route: { provider: "opencode", modelId: "beam-free", reasoning: "high" }, outputDirectory: "C:\\Test\\Research", schedule: { kind: "daily", time: "09:00", day: 6, timezone: "Europe/Istanbul" } } }];
    const methods = { getAppConfig: async () => config, getConfig: async () => config, getSidecarStatus: async () => ({ running: false }),
      listHermesSessions: async () => ({ ok: true, sessions: [] }), getHermesHistory: async () => ({ ok: true, tasks: [] }), getConversationHistory: async () => ({ ok: true, sessionId: "ui-test", messages: [] }),
      brainStatus: async () => config.brainModelStatus, brainCatalog: async () => { if (test.catalogFailures > 0) { test.catalogFailures--; throw new Error("Offline catalog failure"); } return catalog; }, remoteStatus: async () => ({ running: false }),
      selectBrain: async () => { test.globalModelChanges++; throw new Error("Research must not change the chat model"); },
      getWindowState: async () => ({ maximized: test.maximized }), toggleMaximize: async () => { test.maximized = !test.maximized; return { maximized: test.maximized }; },
      listReminders: async () => [],
      listResearch: async () => [], researchDefaults: async () => { if (test.defaultsFailures > 0) { test.defaultsFailures--; throw new Error("Active model unavailable"); } return { outputDirectory: "C:\\Test\\Research", minutes: 30, route: { ...activeRoute } }; },
      proposeResearch: async (input) => { test.proposals.push(input); return { ok: true, proposalId: "proposal" }; },
      listResearchSchedules: async () => ({ jobs, scheduler: { available: true } }),
      updateResearchSchedule: async (id, input) => { test.updates.push({ id, input }); jobs[0].spec = input; return { ok: true }; },
      researchScheduleAction: async (id, action) => { test.commands.push({ id, action }); if (action === "pause") jobs[0].paused = true; return { ok: true }; },
      sendCommand: async (command) => { test.commands.push(command); return { ok: true }; }, sendUiContext: () => {}, notifyBootDone: () => {},
      toggleHud: async () => { test.emit("onHudMode", { mode: "hud" }); return { mode: "hud" }; },
    };
    window.iris = new Proxy(methods, { get(target, name) {
      if (name === "transport") return undefined;
      if (String(name).startsWith("on")) return (fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); };
      return target[name] || (() => Promise.resolve({ ok: true }));
    } });
  });
  await page.goto(pathToFileURL(path.join(root, "dist/index.html")).href); await page.waitForSelector(".deck");
  await page.waitForTimeout(300);
  const frames = async () => page.evaluate(() => new Promise((resolve) => {
    const rows = []; let last = performance.now(), start = last;
    function next(now) { rows.push(now - last); last = now; if (now - start < 2200) requestAnimationFrame(next); else { rows.shift(); rows.sort((a,b)=>a-b); resolve({ count: rows.length, p95: rows[Math.floor(rows.length * .95)], average: rows.reduce((a,b)=>a+b,0)/rows.length }); } }
    requestAnimationFrame(next);
  }));
  const baseline = await frames();
  if (!process.argv.includes("--baseline")) {
    const speak = () => page.evaluate(() => {
      const test = window.__researchUi, pcm = new Int16Array(2400); for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i * Math.PI * 2 * 440 / 24000) * 1000;
      const bytes = new Uint8Array(pcm.buffer); let data = ""; for (const value of bytes) data += String.fromCharCode(value);
      const utteranceId = crypto.randomUUID(); test.emit("onAudioChunk", { utteranceId, mimeType: "audio/pcm;rate=24000", data: btoa(data) }); test.emit("onAudioOutputEnd", { utteranceId });
    });
    await speak(); await page.waitForFunction(() => window.__researchUi.commands.some((x) => x.type === "playback_ended"));
    const before = await page.evaluate(() => ({ contexts: window.__researchUi.contexts, disposed: window.__researchUi.disposed }));
    await page.getByRole("button", { name: "Pencereyi büyüt", exact: true }).click();
    await page.getByRole("button", { name: "Pencereyi geri getir", exact: true }).click();
    await page.getByRole("tab", { name: "Çalışmalar", exact: true }).click();
    await page.getByRole("button", { name: "＋ Yeni araştırma", exact: true }).click();
    await page.getByText("Gelişmiş seçenekler", { exact: true }).click();
    const modelSelect = page.getByLabel("Araştırma sağlayıcısı ve modeli", { exact: true });
    const reasoningSelect = page.getByLabel("Araştırma düşünme seviyesi", { exact: true });
    await modelSelect.waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Araştırma sağlayıcısı ve modeli"]')?.value === "evren/qwen3.8-flash-next");
    assert.equal(await reasoningSelect.inputValue(), "disabled", "Use the active route, not a pending chat selection");
    await modelSelect.selectOption("opencode/beam-free");
    assert.equal(await reasoningSelect.inputValue(), "default");
    await reasoningSelect.selectOption("high");
    await page.getByLabel("Konu", { exact: true }).fill("Python sürümlerini araştır");
    await page.screenshot({ path: path.join(temp, "research-model-form.png") });
    await page.getByRole("button", { name: "Öneriyi göster", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__researchUi.proposals[0].mode), "deep");
    assert.deepEqual(await page.evaluate(() => {
      const { breadth, depth, minutes } = window.__researchUi.proposals[0];
      return { breadth, depth, hasMinutes: minutes !== undefined };
    }), { breadth: 3, depth: 2, hasMinutes: false });
    assert.deepEqual(await page.evaluate(() => window.__researchUi.proposals[0].route), { provider: "opencode", modelId: "beam-free", reasoning: "high" });
    await page.getByRole("tab", { name: "Planlama", exact: true }).click();
    await page.getByText("İlan takibi", { exact: true }).waitFor();
    await page.getByText("Model: OpenCode Free / Beam Free · düşünme: Yüksek", { exact: true }).waitFor();
    await page.locator(".planned-research").getByText("Diğer işlemler", { exact: true }).click();
    await page.getByRole("button", { name: "Duraklat", exact: true }).click();
    await page.getByRole("button", { name: "Devam et", exact: true }).waitFor();
    await page.getByText("＋ Yeni", { exact: true }).click();
    await page.getByRole("button", { name: "Zamanlanmış araştırma", exact: true }).click();
    await page.getByText("Gelişmiş seçenekler", { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Araştırma düşünme seviyesi"]')?.value === "disabled");
    await modelSelect.selectOption("opencode/big-pickle");
    assert.equal(await reasoningSelect.isDisabled(), true);
    assert.equal(await reasoningSelect.locator("option").count(), 1);
    assert.equal(await reasoningSelect.inputValue(), "default");
    await modelSelect.selectOption("opencode/beam-free");
    await reasoningSelect.selectOption("low");
    await page.getByLabel("Konu", { exact: true }).fill("Haftalık ilan taraması");
    await page.getByLabel("Tekrar", { exact: true }).selectOption("weekly");
    await page.getByLabel("Gün", { exact: true }).selectOption("6");
    await page.getByRole("button", { name: "Öneriyi göster", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__researchUi.proposals[1].schedule.day), 6);
    assert.equal(await page.evaluate(() => window.__researchUi.proposals[1].schedule.timezone), "Europe/Istanbul");
    assert.deepEqual(await page.evaluate(() => window.__researchUi.proposals[1].route), { provider: "opencode", modelId: "beam-free", reasoning: "low" });
    await page.getByRole("button", { name: "Düzenle", exact: true }).click();
    await page.getByText("Gelişmiş seçenekler", { exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Araştırma sağlayıcısı ve modeli"]')?.disabled);
    assert.equal(await modelSelect.inputValue(), "opencode/beam-free");
    assert.equal(await reasoningSelect.inputValue(), "high", "Editing must use the saved task route");
    await modelSelect.selectOption("evren/qwen3.8-flash-next");
    await reasoningSelect.selectOption("disabled");
    await page.getByRole("button", { name: "Değişiklikleri kaydet", exact: true }).click();
    await page.waitForFunction(() => window.__researchUi.updates.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__researchUi.updates[0].input.route), { provider: "evren", modelId: "qwen3.8-flash-next", reasoning: "disabled" });
    await page.evaluate(() => { window.__researchUi.catalogFailures = 1; });
    await page.getByRole("tab", { name: "Çalışmalar", exact: true }).click();
    await page.getByRole("button", { name: "＋ Yeni araştırma", exact: true }).click();
    await page.getByText("Gelişmiş seçenekler", { exact: true }).click();
    await page.getByText(/Offline catalog failure/).waitFor();
    assert.equal(await modelSelect.isDisabled(), true);
    await page.getByRole("button", { name: "Model listesini yeniden dene", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Araştırma sağlayıcısı ve modeli"]')?.disabled);
    assert.equal(await modelSelect.inputValue(), "evren/qwen3.8-flash-next");
    assert.equal(await reasoningSelect.inputValue(), "disabled");
    await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await page.evaluate(() => { window.__researchUi.defaultsFailures = 1; });
    await page.getByRole("tab", { name: "Çalışmalar", exact: true }).click();
    await page.getByRole("button", { name: "＋ Yeni araştırma", exact: true }).click();
    await page.getByText("Gelişmiş seçenekler", { exact: true }).click();
    await page.getByLabel("Konu", { exact: true }).fill("Retry defaults");
    await page.getByText("Active model unavailable", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Öneriyi göster", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Etkin modeli yeniden al", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Araştırma sağlayıcısı ve modeli"]')?.value === "evren/qwen3.8-flash-next");
    await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__researchUi.globalModelChanges), 0);
    await page.getByRole("tab", { name: "Çalışmalar", exact: true }).click();
    await speak(); await page.waitForFunction(() => window.__researchUi.commands.filter((x) => x.type === "playback_ended").length === 2);
    assert.deepEqual(await page.evaluate(() => ({ contexts: window.__researchUi.contexts, disposed: window.__researchUi.disposed })), before, "Window/task controls must not rebuild audio contexts");
    await page.evaluate(() => {
      const send = () => { for (let n = 0; n < 3; n++) window.__researchUi.emit("onSidecarEvent", { type: "research_update", task: { id: `research_abcdef${n}`, kind: "deep_research", sessionId: "ui-test", task: `Research ${n}`, status: "running", phase: "collecting", updatedAt: Date.now(), startedAt: Date.now() - 10000, deadline: Date.now() + 60000, sourceCount: 3, steps: [] } }); };
      send(); window.__researchUi.updates = setInterval(send, 1000);
    });
    const duringUpdates = await frames();
    assert.ok(duringUpdates.p95 < Math.max(60, baseline.p95 * 2), "Research updates must not cause sustained frame stalls");
    const imagePath = process.env.IRIS_RESEARCH_SCREENSHOT || path.join(temp, "research-ui.png"); await page.screenshot({ path: imagePath });
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(JSON.stringify({ ok: true, baseline, duringUpdates, audioPreserved: true, screenshot: imagePath, formScreenshot: path.join(temp, "research-model-form.png") }));
  } else console.log(JSON.stringify({ baseline }));
} finally { await app.close(); }
