// Offline synthetic worker used only to test installed Hermes interrupt wiring.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWindowsServer } from '../mcp-runtime.mjs';
const root = process.env.JARVIS_OFFLINE_FIXTURE_ROOT;
if (!root) throw Error('Offline fixture root required.');
const { server, shutdown } = createWindowsServer({ root, startWorker: spec => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let ended = false;
  const finish = () => {
    if (ended) return; ended = true;
    clearInterval(child.timer);
    fs.writeFileSync(root + '/worker-stopped.json', JSON.stringify({ fixtureOnly: true, stopObserved: fs.existsSync(spec.options.env.CLICKER_STOP_FILE) }));
    child.emit('exit', 130);
  };
  child.kill = () => { finish(); return true; };
  child.timer = setInterval(() => { if (fs.existsSync(spec.options.env.CLICKER_STOP_FILE)) finish(); }, 10);
  fs.writeFileSync(root + '/worker-started.json', JSON.stringify({ stopFile: spec.options.env.CLICKER_STOP_FILE, fixtureOnly: true }));
  return child;
} });
process.once('exit', shutdown);
process.once('SIGTERM', () => { shutdown(); process.exit(0); });
await server.connect(new StdioServerTransport());
