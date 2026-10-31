// Synthetic worker only: no Windows I/O, model call, or API credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWindowsServer } from '../mcp-runtime.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const body = response => JSON.parse(response.content.find(item => item.type === 'text').text);
async function until(condition) {
  const deadline = Date.now() + 5000;
  while (!condition()) { if (Date.now() > deadline) throw Error('Fixture condition timed out'); await delay(10); }
}
async function harness(t, mode = 'handoff') {
  const root = mkdtempSync(path.join(tmpdir(), 'jarvis-mcp-offline-'));
  const workers = [];
  const runtime = createWindowsServer({ root, startWorker: spec => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const host = spec.options.env.CLICKER_HOST_DIR, stop = spec.options.env.CLICKER_STOP_FILE;
    const folder = path.dirname(host);
    let ended = false;
    const end = outcome => {
      if (ended) return; ended = true; clearInterval(child.watcher); clearTimeout(child.launch);
      writeFileSync(path.join(folder, 'run.json'), JSON.stringify({ outcome, fixtureOnly: true }));
      child.emit('exit', outcome === 'done' ? 0 : 130);
    };
    child.kill = () => { child.killed = true; end('aborted'); return true; };
    workers.push({ child, folder, stop });
    child.launch = setTimeout(() => {
      if (mode === 'handoff') {
        mkdirSync(host, { recursive: true });
        const image = path.join(host, 'fixture.png'), id = randomUUID();
        writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'));
        writeFileSync(path.join(host, 'request.json'), JSON.stringify({ id, imagePath: image, packet: { fixtureOnly: true }, properties: { achieved: { type: 'boolean' }, text: { type: 'string' } } }));
        child.requestId = id;
      }
    }, 20);
    child.watcher = setInterval(() => {
      if (existsSync(stop) && mode !== 'ignore-stop') return end('aborted');
      if (child.requestId && existsSync(path.join(host, `${child.requestId}.response.json`))) {
        unlinkSync(path.join(host, 'request.json')); end('done');
      }
    }, 10);
    return child;
  } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'jarvis-offline-fixture', version: '1' });
  await runtime.server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { runtime.shutdown(); await client.close(); await runtime.server.close(); });
  const call = (name, args = {}, options) => client.callTool({ name, arguments: args }, undefined, options);
  return { runtime, call, workers, client };
}

test('handoff carries real MCP ImageContent; valid response resumes SAME worker without polling', async t => {
  const { call, workers } = await harness(t);
  const started = await call('typesafe_run', { goal: 'Synthetic fixture', windowTitle: 'Fixture' });
  assert.equal(started.isError, undefined);
  const state = body(started);
  assert.equal(state.status, 'needs_host');
  assert.equal(started.content[1].type, 'image');
  assert.equal(started.content[1].mimeType, 'image/png');
  const stale = await call('typesafe_respond', { runId: state.runId, requestId: randomUUID(), reply: { achieved: true, text: 'fixture' } });
  assert.equal(stale.isError, true);
  const invalid = await call('typesafe_respond', { runId: state.runId, requestId: state.request.id, reply: { achieved: 'yes', text: 'fixture' } });
  assert.equal(invalid.isError, true);
  const done = body(await call('typesafe_respond', { runId: state.runId, requestId: state.request.id, reply: { achieved: true, text: 'fixture' } }));
  assert.equal(done.status, 'done');
  assert.equal(workers.length, 1);
  assert.equal(done.report.fixtureOnly, true);
});

test('cancelling an in-flight MCP call stops its background worker', async t => {
  const { call, workers, runtime } = await harness(t, 'waiting');
  const controller = new AbortController();
  const pending = call('typesafe_run', { goal: 'Synthetic fixture', windowTitle: 'Fixture' }, { signal: controller.signal });
  const rejected = assert.rejects(pending);
  await until(() => workers.length === 1);
  controller.abort(); await rejected;
  await until(() => existsSync(workers[0].stop));
  await until(() => runtime.snapshot().status === 'aborted');
  assert.equal(runtime.snapshot().stopReason, 'host request cancelled');
});

test('deadline terminates a worker that ignores cooperative STOP', async t => {
  const { call, workers } = await harness(t, 'ignore-stop');
  const done = body(await call('typesafe_run', { goal: 'Synthetic fixture', windowTitle: 'Fixture', timeoutSeconds: 1 }));
  assert.equal(done.status, 'aborted');
  assert.equal(done.stopReason, 'task deadline reached');
  assert.equal(workers[0].child.killed, true);
});

test('run identifiers isolate follow-up tools and concurrent starts are refused', async t => {
  const { call, workers } = await harness(t, 'waiting');
  const started = body(await call('typesafe_run', { goal: 'Synthetic fixture', windowTitle: 'Fixture', waitForEvent: false }));
  assert.deepEqual(body(await call('typesafe_status')), { status: 'busy' });
  assert.equal((await call('typesafe_stop', { runId: randomUUID() })).isError, true);
  assert.equal((await call('typesafe_run', { goal: 'Another fixture', windowTitle: 'Fixture' })).isError, true);
  assert.equal(workers.length, 1);
  assert.equal(body(await call('typesafe_stop', { runId: started.runId })).status, 'aborted');
});

test('MCP disconnect terminates its worker', async t => {
  const { call, client, runtime } = await harness(t, 'waiting');
  await call('typesafe_run', { goal: 'Synthetic fixture', windowTitle: 'Fixture', waitForEvent: false });
  await client.close();
  await until(() => runtime.snapshot().status === 'aborted');
  assert.equal(runtime.snapshot().stopReason, 'MCP connection closed');
});

test('read-only tools advertise their annotations; window selection is mandatory', async t => {
  const { client, call, workers } = await harness(t);
  const tools = (await client.listTools()).tools;
  for (const name of ['typesafe_status', 'typesafe_windows', 'typesafe_wait'])
    assert.equal(tools.find(tool => tool.name === name).annotations.readOnlyHint, true);
  assert.equal((await call('typesafe_run', { goal: 'Missing target' })).isError, true);
  assert.equal(workers.length, 0);
});
