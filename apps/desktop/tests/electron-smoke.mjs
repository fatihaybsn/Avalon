import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.JARVIS_DESKTOP_DEV;
const dev = process.argv.includes('--dev'), packaged = process.argv.includes('--packaged');
let server;
if (dev) { server = await createServer(); await server.listen(); env.JARVIS_DESKTOP_DEV = '1'; }
const application = await electron.launch({ ...(packaged ? { executablePath: path.resolve('release/win-unpacked/JARVIS.exe') } : {}), args: packaged ? ['--enable-logging=stderr'] : ['.', '--enable-logging=stderr'], env });
try {
  const page = await application.firstWindow();
  await page.waitForFunction(() => !!window.jarvis);
  await page.waitForFunction(() => ['connected', 'pairing', 'auth', 'blocked'].includes(document.querySelector('jarvis-app')?.data?.connection?.phase), undefined, { timeout: 60000 });
  // Authentication is published before the asynchronous native record read.
  // Await that read before asserting its result.
  await page.evaluate(() => window.jarvis.action({ type: 'refresh' }));
  const snapshot = await page.evaluate(async () => (await window.jarvis.action({ type: 'snapshot' })).snapshot);
  console.log('REAL_CONNECTION', snapshot.connection.phase, snapshot.connection.version ?? '', snapshot.connection.deviceId ?? '', snapshot.connection.requestId ?? '', snapshot.connection.detail);
  if (snapshot.connection.phase === 'connected') assert.equal(snapshot.workAvailable, true, 'Signed Electron operator could not read current stage06 host records');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  const prefs = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
  const reject = await page.evaluate(() => window.jarvis.action({ type: 'rpc', method: 'approval.resolve' }));
  assert.equal(reject.ok, false);
  const before = page.url();
  await page.evaluate(() => { window.open('https://example.com'); location.href = 'https://example.com'; });
  await page.waitForTimeout(300); assert.equal(page.url(), before); assert.equal(application.windows().length, 1);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await application.evaluate(({ BrowserWindow }) => ({ count: BrowserWindow.getAllWindows().length, visible: BrowserWindow.getAllWindows()[0].isVisible() } )).then(v => v.count === 1 && !v.visible), true);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await page.reload(); await page.waitForFunction(() => !!document.querySelector('jarvis-app')?.data);
  const after = await page.evaluate(async () => (await window.jarvis.action({ type: 'snapshot' })).snapshot);
  assert.equal(after.connection.deviceId, snapshot.connection.deviceId);
  assert.equal(after.connection.phase, snapshot.connection.phase);
  await fs.mkdir('../../tmp/stage04', { recursive: true });
  await page.evaluate(() => window.jarvis.action({ type: 'refresh' }));
  await page.screenshot({ path: '../../tmp/stage04/desktop.png' });
  console.log('PASS', dev ? 'Vite dev' : packaged ? 'Windows exe' : 'Built app', 'Electron sandbox, narrow IPC, navigation/popup rejection, X -> tray and renderer reload lifetime');
  if (snapshot.connection.phase !== 'connected') process.exitCode = 2;
} finally { await application.close(); await server?.close(); }
