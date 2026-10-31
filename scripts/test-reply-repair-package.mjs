import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import { extractFile } from "@electron/asar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = path.resolve(process.argv[2] || path.join(root, "release/win-unpacked/Avalon.exe"));
const archive = path.join(path.dirname(executablePath), "resources/app.asar");
const modules = (await fs.readdir(path.join(root, "electron"))).filter((file) => /\.(mjs|cjs)$/.test(file));
for (const file of modules.map((file) => `electron/${file}`)) {
  assert.deepEqual(extractFile(archive, file), await fs.readFile(path.join(root, file)), `Packaged source differs: ${file}`);
}
const manifest = JSON.parse(extractFile(archive, "package.json"));
assert.equal(manifest.main, "electron/main.mjs");
assert.equal(manifest.productName, "Avalon");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "avalon-repair-package-smoke-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env)) if (/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key)) delete env[key];
Object.assign(env, {
  IRIS_TEST_HOOKS: "1", IRIS_TEST_SKIP_WELCOME: "1", IRIS_TEST_CONFIG_PATH: path.join(temp, ".env"),
  IRIS_TEST_RUN_REGISTRY_PATH: path.join(temp, "runs.json"), IRIS_HERMES_AUTOSTART: "false",
  IRIS_REMOTE_ENABLED: "false", IRIS_LOAD_TEST_DATA: "false", IRIS_WAKE_WORD: "false",
  IRIS_USER_PROFILE_PATH: path.join(temp, "profile.md"), HERMES_HOME: path.join(temp, "hermes"),
});
await fs.writeFile(env.IRIS_TEST_CONFIG_PATH, "IRIS_HERMES_AUTOSTART=false\nIRIS_WAKE_WORD=false\n");
let app;
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${path.join(temp, "electron")}`], cwd: root, env });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.prototype.show = function () {};
    for (const win of BrowserWindow.getAllWindows()) win.hide();
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.waitForFunction(() => Boolean(window.iris?.getConfig), undefined, { timeout: 15000 });
  const config = await page.evaluate(() => window.iris.getConfig());
  assert.equal(config.wakeWord, false);
  assert.equal(await app.evaluate(({ app: instance }) => instance.getName()), "Avalon");
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ ok: true, packagedModules: modules.length, application: "Avalon", wakeWord: false, pageErrors }));
} finally {
  await app?.close();
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith("avalon-repair-package-smoke-"));
  await fs.rm(temp, { recursive: true, force: true });
}
