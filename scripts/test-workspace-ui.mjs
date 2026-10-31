// Offline desktop/mobile interaction and geometry checks. All application APIs
// are fixtures; no provider, microphone, remote device or packaging involved.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "workspace-review"); fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-workspace-ui-"));
fs.writeFileSync(path.join(temp, "main.cjs"), `const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,width:1280,height:720,webPreferences:{contextIsolation:false,nodeIntegration:false,offscreen:true}}).loadURL('about:blank'));`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [path.join(temp, "main.cjs"), `--user-data-dir=${path.join(temp, "profile")}`, "--mute-audio"], env });
try {
  const page = await app.firstWindow(), errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "workspace.test") {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = path.join(root, "dist-mobile", rel);
      if (!file.startsWith(path.join(root, "dist-mobile") + path.sep) || !fs.existsSync(file)) return route.abort();
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
      return route.fulfill({ path: file, contentType: mime[path.extname(file)] || "application/octet-stream" });
    }
    if (["http:", "https:"].includes(url.protocol)) return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => {
    const handlers = new Map(), emit = (channel, value) => handlers.get(channel)?.forEach((fn) => fn(value));
    const fixture = window.__workspace = { calls: [], audio: 0, reminders: [], emit };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); fixture.audio++; } };
    if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {} });
    navigator.mediaDevices.getUserMedia = async () => { throw new Error("A silent operation requested a microphone"); };
    const config = { configured: true, userName: "Test", sounds: false, startupSounds: false, speechRate: 1, permissionMode: "standard", conversationLanguage: "tr", hermesSession: "ui-test", brainPath: "", models: [], voices: [], brainModelStatus: { selected: { provider: "opencode", modelId: "big-pickle" }, effective: null } };
    const task = { id: "research_test", sessionId: "ui-test", task: "Uzun Türkçe başlıklı araştırmanın sonuçları ve sonraki adımlar", kind: "deep_research", status: "completed", output: "Planlama notu: toplantı yarın. Planlama sonucu doğrulandı.", updatedAt: Date.now(), steps: [] };
    const methods = {
      getConfig: async () => config, getAppConfig: async () => config,
      getSidecarStatus: async () => ({ running: false }), listHermesSessions: async () => ({ ok: true, sessions: [] }), getHermesHistory: async () => ({ ok: true, tasks: [] }),
      getConversationHistory: async () => ({ ok: true, sessionId: "ui-test", messages: [] }), listResearch: async () => [task],
      getWindowState: async () => ({ maximized: false }), listResearchSchedules: async () => ({ jobs: [], scheduler: { available: true } }),
      sendMessage: async (input) => { fixture.calls.push({ method: "sendMessage", input }); emit("onSidecarEvent", { type: "transcript", speaker: "you", text: input.text, session_id: "ui-test" }); return { ok: true, id: input.id }; },
      searchSources: async () => ({ results: [{ kind: "note", path: "brain:test.md", title: "Toplantı notları", snippet: "Planlama içeriği burada bulunur." }] }),
      readMemoryNote: async () => ({ ok: true, content: "Planlama içeriği. İkinci Planlama eşleşmesi." }), readTaskResult: async () => ({ ok: true, output: task.output }),
      listReminders: async () => fixture.reminders,
      saveReminder: async (input) => { const item = { ...input, id: "reminder_test", revision: 1, nextAt: Date.now() + 3600000, history: [] }; fixture.reminders.push(item); emit("onSidecarEvent", { type: "reminders_changed" }); return item; },
      remoteStatus: async () => ({ voice: { deviceId: null, generation: 0 } }),
      researchDefaults: async () => ({ outputDirectory: "C:\\Test\\Research", route: { provider: "opencode", modelId: "big-pickle" } }), brainCatalog: async () => ({ models: [] }),
      sendUiContext() {}, notifyBootDone() {},
      toggleHud: async () => { emit("onHudMode", { mode: "hud" }); },
    };
    const api = new Proxy(methods, { get(target, name) {
      if (name === "transport") return undefined;
      if (String(name).startsWith("on")) return (fn) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); return () => handlers.get(name).delete(fn); };
      return target[name] || (() => Promise.resolve({ ok: true }));
    } }); window.iris = api;
    const snapshot = () => ({ config, sessionId: "ui-test", tasks: [task], messages: fixture.calls.filter((x) => x.method === "sendMessage").map((x) => ({ id: x.input.id, speaker: "you", text: x.input.text })), proposal: null, remote: { voice: { generation: 0 }, paired: true }, live: { running: false } });
    window.fetch = async (url, options) => {
      if (String(url).startsWith("/api/")) {
        if (String(url).endsWith("/state")) return new Response(JSON.stringify(snapshot()), { status: 200 });
        const call = JSON.parse(options.body); fixture.calls.push({ method: call.method });
        return new Response(JSON.stringify({ result: await api[call.method](...call.args) }), { status: 200 });
      }
      throw new Error("Unexpected external fetch");
    };
    window.WebSocket = class { static OPEN = 1; readyState = 1; constructor() { setTimeout(() => this.onopen?.(), 0); } send() {} close() { this.readyState = 3; } };
  });
  async function geometry(label) {
    const bad = await page.evaluate(() => {
      const visible = (x) => x.getBoundingClientRect().width && x.getBoundingClientRect().height && getComputedStyle(x).visibility !== "hidden" && !x.closest("[hidden]");
      const violations = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) violations.push("page horizontal overflow");
      for (const group of document.querySelectorAll(".composer form,.composer-voice,.workspace-nav,.mobile-nav,.research-tabs,.research-actions,.find-bar")) {
        const children = [...group.children].filter(visible);
        for (let i = 0; i < children.length; i++) {
          const a = children[i].getBoundingClientRect();
          if (a.left < -1 || a.right > innerWidth + 1) violations.push(`${children[i].textContent}: offscreen`);
          for (const child of children.slice(i + 1)) { const b = child.getBoundingClientRect(); if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) violations.push("controls overlap"); }
        }
      }
      const top = document.querySelector(".deck-top")?.getBoundingClientRect(), nav = document.querySelector(".workspace-nav")?.getBoundingClientRect();
      if (top && nav?.height && nav.top < top.bottom - 1) violations.push("header/navigation overlap");
      return violations;
    });
    assert.deepEqual(bad, [], `${label}: ${bad.join(", ")}`);
  }
  await page.goto(pathToFileURL(path.join(root, "dist/index.html")).href);
  await page.getByLabel("Mesaj", { exact: true }).waitFor();
  for (const [width, height] of [[800,600], [1024,768], [1280,720], [1920,1080]]) {
    await page.setViewportSize({ width, height }); await geometry(`desktop ${width}`);
    await page.screenshot({ path: path.join(output, `desktop-${width}.png`) });
  }
  await page.evaluate(() => {
    const emit = window.__workspace.emit;
    emit("onSidecarEvent", { type: "sidecar_status", status: { running: true } });
    emit("onSidecarEvent", { type: "gemini_status", status: "connected" });
    emit("onSidecarEvent", { type: "hermes_status", status: "ready" });
    emit("onSidecarEvent", { type: "audio_state", state: "listening" });
  });
  await page.locator(".deck-center .telemetry").waitFor();
  const proportions = await page.evaluate(() => ({ left: document.querySelector(".deck-left").getBoundingClientRect().width, center: document.querySelector(".deck-center").getBoundingClientRect().width, right: document.querySelector(".deck-right").getBoundingClientRect().width }));
  assert.ok(proportions.left <= 360 && proportions.right <= 400 && proportions.center > proportions.right);
  await page.locator(".deck-center").getByRole("button", { name: "Mikrofonu sustur", exact: true }).click();
  await page.locator(".deck-center .t-btn.muted").waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".deck-center .t-btn.muted")).color === "rgb(245, 176, 74)");
  await page.screenshot({ path: path.join(output, "desktop-voice-layout.png") });
  assert.ok(await page.locator(".deck-center .telemetry").textContent().then((text) => text.includes("HERMES") && text.includes("RUNS") && text.includes("SESSION")));
  await geometry("desktop active voice controls");
  await page.evaluate(() => window.__workspace.emit("onSidecarEvent", { type: "sidecar_status", status: { running: false } }));
  await page.getByLabel("Mesaj", { exact: true }).fill("Sessiz mesaj"); await page.getByRole("button", { name: "Gönder", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__workspace.audio), 0);
  assert.ok(await page.evaluate(() => window.__workspace.calls.some((x) => x.method === "sendMessage" && x.input)));
  await page.getByRole("tab", { name: "Notlar", exact: true }).click();
  await page.getByLabel("Notlarda ve sonuçlarda ara").fill("Planlama"); await page.getByRole("button", { name: "Ara", exact: true }).click();
  await page.getByRole("button", { name: "Toplantı notları" }).click(); await page.getByLabel("İçinde bul", { exact: true }).fill("Planlama");
  assert.equal(await page.locator("mark").count(), 2); await page.getByRole("button", { name: "Sonraki eşleşme" }).click();
  await page.getByRole("tab", { name: "Planlama", exact: true }).click();
  await page.getByText("＋ Yeni", { exact: true }).click(); await page.getByRole("button", { name: "Hatırlatıcı", exact: true }).click();
  await page.getByLabel("Başlık", { exact: true }).fill("Türkçe uzun hatırlatma başlığı: toplantıya hazırlan ve araştırma sonuçlarını kontrol et"); await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByText("Türkçe uzun hatırlatma başlığı: toplantıya hazırlan ve araştırma sonuçlarını kontrol et", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "desktop-planning.png") });
  await page.setViewportSize({ width: 800, height: 600 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)); await geometry("desktop 200% zoom");
  await page.screenshot({ path: path.join(output, "desktop-zoom.png") });

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await page.goto("https://workspace.test/"); await page.getByLabel("Mesaj", { exact: true }).waitFor();
  for (const width of [360,390,430]) {
    await page.setViewportSize({ width, height: 800 }); await geometry(`mobile ${width}`);
    await page.screenshot({ path: path.join(output, `mobile-${width}.png`) });
  }
  await page.getByLabel("Mesaj", { exact: true }).fill("Telefondan sessiz mesaj"); await page.getByRole("button", { name: "Gönder", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__workspace.audio), 0);
  assert.ok(await page.evaluate(() => window.__workspace.calls.some((x) => x.method === "sendMessage" && x.input)));
  assert.equal(await page.evaluate(() => window.__workspace.calls.some((x) => x.method === "startSidecar")), false);
  await page.getByRole("button", { name: "Görevler", exact: true }).click(); await page.getByRole("tab", { name: "Planlama", exact: true }).click();
  await page.getByText("＋ Yeni", { exact: true }).click(); await page.getByRole("button", { name: "Hatırlatıcı", exact: true }).click();
  await geometry("mobile reminder form"); await page.screenshot({ path: path.join(output, "mobile-reminder.png") });
  await page.getByLabel("Başlık", { exact: true }).fill("Telefon hatırlatması"); await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText("Telefon hatırlatması", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, "mobile-planning.png") }); await geometry("mobile planning");
  await page.getByRole("button", { name: "Notlar", exact: true }).click(); await page.getByLabel("Notlarda ve sonuçlarda ara").fill("Planlama"); await page.getByRole("button", { name: "Ara", exact: true }).click(); await page.getByRole("button", { name: "Toplantı notları" }).click();
  await page.getByLabel("İçinde bul", { exact: true }).fill("Planlama"); assert.equal(await page.locator("mark").count(), 2);
  await geometry("mobile find"); await page.setViewportSize({ width: 800, height: 360 }); await geometry("mobile landscape");
  await page.getByRole("button", { name: "Sohbet", exact: true }).click();
  await page.evaluate(() => { document.documentElement.classList.add("keyboard-open"); });
  assert.equal(await page.locator(".mobile-nav").isVisible(), false); await geometry("mobile keyboard layout");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, silent: true, desktopSizes: 4, mobileSizes: 3, zoom: true, notes: true, reminders: true, screenshots: output }));
} finally { await app.close(); }
