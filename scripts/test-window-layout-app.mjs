// Offline native Electron window/HUD regression. No Gemini/Hermes services.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-window-app-"));
fs.writeFileSync(path.join(temp, ".env"), "");
const env = { ...process.env, GEMINI_API_KEY: "offline-not-a-key", HERMES_API_URL: "http://127.0.0.1:1", HERMES_HOME: path.join(temp, "hermes"),
  IRIS_START_PROD: "1", IRIS_TEST_HOOKS: "1", IRIS_TEST_CONFIG_PATH: path.join(temp, ".env"), IRIS_TEST_RUN_REGISTRY_PATH: path.join(temp, "runs.json"),
  IRIS_HERMES_SESSION: "offline-window-test", IRIS_HERMES_AUTOSTART: "false", IRIS_BRAIN_AUTO_INDEX: "false", IRIS_BRAIN_PATH: path.join(temp, "vault"),
  IRIS_HERMES_TRANSPORT: "runs_api", HERMES_BIN: path.join(temp, "no-runtime.exe"),
  IRIS_REMOTE_ENABLED: "false", IRIS_LOAD_TEST_DATA: "false", IRIS_WAKE_WORD: "false" };
delete env.ELECTRON_RUN_AS_NODE;
const packagedExecutable = process.argv[2] ? path.resolve(process.argv[2]) : null;
const args = [...(packagedExecutable ? [] : [path.join(root, "electron/main.mjs")]), `--user-data-dir=${path.join(temp, "profile")}`];
let app;
const pause = () => new Promise((resolve) => setTimeout(resolve, 400));
const menuState = (instance) => instance.evaluate(({ BrowserWindow, Menu }) => {
  const win = BrowserWindow.getAllWindows()[0];
  return {
    visible: win.isMenuBarVisible(), autoHide: win.isMenuBarAutoHide(),
    // Hiding the native strip must leave the menu and accelerators attached.
    items: Menu.getApplicationMenu()?.items.map((item) => ({ label: item.label, roles: item.submenu?.items.map((entry) => entry.role) })),
  };
});
async function launch() {
  const instance = await electron.launch({ args, env, cwd: root, ...(packagedExecutable ? { executablePath: packagedExecutable } : {}) });
  const page = await instance.firstWindow(); await page.waitForSelector(".deck", { timeout: 30000 });
  await instance.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.hide(); win.show = () => {}; win.focus = () => {};
    globalThis.__windowCalls = [];
    for (const name of ["setAlwaysOnTop", "setIgnoreMouseEvents", "setVisibleOnAllWorkspaces"]) {
      const original = win[name].bind(win); win[name] = (...values) => { globalThis.__windowCalls.push({ name, values }); return original(...values); };
    }
  });
  return { instance, page };
}
try {
  let launched = await launch(); app = launched.instance; let page = launched.page;
  assert.equal((await page.evaluate(() => window.iris.getWindowState())).maximized, true, "First launch fills the work area");
  const proposal = await page.evaluate((outputDirectory) => window.iris.proposeResearch({ topic: "Offline research proposal", mode: "deep", minutes: 30, sites: [], outputDirectory }), path.join(temp, "output"));
  assert.equal(proposal.ok, true);
  assert.equal((await page.evaluate((id) => window.iris.respondTaskProposal(id, "deny"), proposal.proposalId)).status, "discarded");
  assert.deepEqual(await page.evaluate(() => window.iris.listResearch()), [], "A proposal/decline must not start any research or model connection");
  const deckMenu = process.platform !== "darwin" ? await menuState(app) : null;
  await page.evaluate(() => window.iris.toggleHud()); await pause();
  if (deckMenu) {
    const hudMenu = await menuState(app);
    assert.equal(hudMenu.visible, false, "HUD must not cover other apps with its native menu bar");
    assert.equal(hudMenu.autoHide, false, "Alt must not reveal the menu over other apps");
    assert.deepEqual(hudMenu.items, deckMenu.items, "HUD preserves the menu and its shortcuts");
  }
  await page.evaluate(() => window.iris.toggleHud()); await pause();
  assert.equal((await page.evaluate(() => window.iris.getWindowState())).maximized, true, "HUD restores maximized deck");
  if (deckMenu) assert.deepEqual(await menuState(app), deckMenu, "Deck restores the previous menu visibility");
  await page.evaluate(() => window.iris.toggleHud());
  await new Promise((resolve) => setTimeout(resolve, 20));
  await page.evaluate(() => window.iris.toggleHud());
  await new Promise((resolve) => setTimeout(resolve, 20));
  await page.evaluate(() => window.iris.toggleHud()); await pause();
  await page.evaluate(() => window.iris.toggleHud()); await pause();
  assert.equal((await page.evaluate(() => window.iris.getWindowState())).maximized, true, "Rapid HUD toggles preserve the deck snapshot");
  if (deckMenu) assert.deepEqual(await menuState(app), deckMenu, "Rapid HUD toggles preserve the menu snapshot");
  const calls = await app.evaluate(() => globalThis.__windowCalls);
  assert.ok(calls.some((c) => c.name === "setAlwaysOnTop" && c.values[0] === true && c.values[1] === "screen-saver"));
  assert.ok(calls.some((c) => c.name === "setIgnoreMouseEvents" && c.values[0] === true && c.values[1].forward === true));
  assert.ok(calls.some((c) => c.name === "setIgnoreMouseEvents" && c.values[0] === false));
  assert.equal(await app.evaluate(() => globalThis.__irisTest.isLive()), false, "Window/HUD changes never open a voice connection");
  await page.evaluate(() => window.iris.toggleMaximize()); await pause();
  assert.equal((await page.evaluate(() => window.iris.getWindowState())).maximized, false);
  await app.close(); app = null;
  launched = await launch(); app = launched.instance; page = launched.page;
  assert.equal((await page.evaluate(() => window.iris.getWindowState())).maximized, false, "Last deck state persists across restart");
  console.log(JSON.stringify({ ok: true, firstLaunchMaximized: true, hudRestored: true, hudMenuHidden: Boolean(deckMenu), rapidToggleSafe: true, persisted: true, noVoiceConnection: true, diagnostics: temp }));
} finally { await app?.close(); }
