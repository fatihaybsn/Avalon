import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {pathToFileURL} from 'node:url';

const [avalonRoot, hermesDirectory] = process.argv.slice(2);
assert(avalonRoot && hermesDirectory, 'Arguments: Avalon source root, disposable Hermes home');
const {HermesGatewayClient} = await import(pathToFileURL(path.join(avalonRoot, 'electron/hermesGatewayClient.mjs')));
const env = {...process.env, HERMES_HOME: hermesDirectory, HERMES_RUNTIME_DIR: path.join(hermesDirectory, 'tools')};
for (const key of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(key)) delete env[key];
const client = new HermesGatewayClient({candidates: () => [{cmd: path.join(hermesDirectory, 'avalon-bin/avalon-hermes.exe'), args: []}], env});
let port;
try {
  const start = Date.now();
  await client.start();
  assert(client.ready);
  assert(client.irisContractVersions.includes(1) && client.irisContractVersions.includes(2));
  port = client.port;
  assert(port > 0);
  console.log(JSON.stringify({ok: true, actualAvalonGatewayClient: true, contractVersions: client.irisContractVersions, startupMilliseconds: Date.now() - start, providerRequests: 0}));
} finally { client.close(); }

const listening = () => new Promise(resolve => {
  const socket = net.connect({host: '127.0.0.1', port});
  socket.setTimeout(400);
  socket.once('connect', () => {socket.destroy();resolve(true);});
  socket.once('error', () => resolve(false));
  socket.once('timeout', () => {socket.destroy();resolve(true);});
});
const deadline = Date.now() + 10000;
while (await listening()) {
  assert(Date.now() < deadline, 'The native launcher left an orphaned gateway after client.close()');
  await new Promise(resolve => setTimeout(resolve, 100));
}
console.log(JSON.stringify({gatewayClosedWithoutOrphan: true}));
