// Reproduce an old cached PWA, then upgrade to the actual mobile build.
// A private fixture server and isolated profile are used; no real app data/API.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-pwa-upgrade-"));
let old = true;
const legacyHtml = `<h1>Eski mobil arayüz</h1><script>navigator.serviceWorker.register('/sw.js')</script>`;
const legacyWorker = `self.addEventListener('install', e => e.waitUntil(caches.open('legacy').then(c => c.add('/')))); self.addEventListener('fetch', e => { if (e.request.mode === 'navigate' && !new URL(e.request.url).search) e.respondWith(caches.match('/').then(r => r || fetch(e.request))); });`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname.startsWith("/api/")) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end('{"error":"fixture pairing required"}'); }
  if (old && url.pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.end(legacyHtml); }
  if (old && url.pathname === "/sw.js") { res.setHeader("Content-Type", "application/javascript"); return res.end(legacyWorker); }
  const base = path.join(root, "dist-mobile"), file = path.resolve(base, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
fs.writeFileSync(path.join(temp, "main.cjs"), `const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,width:430,height:800,webPreferences:{contextIsolation:false,nodeIntegration:false,offscreen:true}}).loadURL('about:blank'));`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [path.join(temp, "main.cjs"), `--user-data-dir=${path.join(temp, "profile")}`], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.goto(origin); await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.getByText("Eski mobil arayüz", { exact: true }).waitFor();
  old = false;
  await page.reload(); await page.getByText("Eski mobil arayüz", { exact: true }).waitFor();
  // A normal refresh reproduced the bug. The one-time migration URL bypasses
  // the legacy precached index without deleting pairing or notification data.
  await page.goto(`${origin}/?_avalon_build=migrate`);
  await page.getByRole("button", { name: "Arayüzü güncelle", exact: true }).waitFor();
  const before = page.url(); await page.waitForTimeout(200); assert.equal(page.url(), before, "No forced page reload");
  await page.screenshot({ path: path.join(root, "workspace-review/mobile-update.png") });
  await page.getByRole("button", { name: "Arayüzü güncelle", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("_avalon_build") !== "migrate");
  await page.getByLabel("Eşleştirme kodu", { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting), null);
  await page.goto(origin); await page.getByLabel("Eşleştirme kodu", { exact: true }).waitFor();
  assert.equal(await page.getByText("Eski mobil arayüz", { exact: true }).count(), 0);
  console.log(JSON.stringify({ ok: true, staleCacheReproduced: true, migrated: true, normalReopenFresh: true, noForcedReload: true }));
} finally {
  await app?.close(); await new Promise((resolve) => server.close(resolve));
}
