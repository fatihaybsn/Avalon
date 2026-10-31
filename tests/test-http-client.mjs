import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const [root, hermesDirectory, environmentFile] = process.argv.slice(2);
const {parseEnvFile} = await import(pathToFileURL(path.join(root, 'electron/configStore.mjs')));
const {HermesClient} = await import(pathToFileURL(path.join(root, 'electron/hermesClient.mjs')));
const settings = {};
parseEnvFile(environmentFile, settings);
assert(settings.API_SERVER_KEY && settings.HERMES_API_URL, 'The fields consumed by electron/main.mjs are required');
const client = new HermesClient({baseUrl: settings.HERMES_API_URL, apiKey: settings.API_SERVER_KEY, defaultTimeoutMs: 1500});
const env = {...process.env};
for (const key of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(key)) delete env[key];
const child = spawn(path.join(hermesDirectory, 'avalon-bin/avalon-hermes.exe'), ['gateway', 'run'], {env, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true});
try {
  const deadline = Date.now() + 70000;
  let ready = false;
  while (Date.now() < deadline) {
    assert(child.exitCode == null, 'Gateway exited before the HTTP client became ready');
    try { await client.request('GET', '/health/detailed', undefined, {retries: 0, timeoutMs: 1500}); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  assert(ready, 'Authenticated HTTP request through Avalon\'s actual HermesClient failed');
  console.log(JSON.stringify({ok: true, actualAvalonHttpClient: true, configurationKey: 'API_SERVER_KEY', providerRequests: 0}));
} finally {
  if (child.exitCode == null) child.kill();
  await new Promise(resolve => {if (child.exitCode != null) resolve(); else {child.once('exit', resolve);setTimeout(resolve, 5000).unref();}});
}
