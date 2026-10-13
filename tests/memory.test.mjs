import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import plugin from '../plugins/jarvis/index.ts';
import { readNote, writeNote, memoryParams, MEMORY_TOOLS } from '../plugins/jarvis/notes.ts';
import { evaluate, makeScope } from '../plugins/jarvis/policy.ts';
import { applyPolicy, assertPolicy } from '../scripts/jarvis-policy-config.mjs';
import { registerMemoryCapability, clearMemoryPluginState } from 'openclaw/plugin-sdk/memory-host-core';

fs.mkdirSync('tmp', { recursive: true });
const scratch = fs.mkdtempSync(path.resolve('tmp/stage05-memory-'));
const project = path.join(scratch, 'project'); fs.mkdirSync(project);
const workspace = path.join(scratch, 'workspace'); fs.mkdirSync(workspace);
const identity = { userId: 'verified-user', deviceId: 'verified-device', agentId: 'main', sessionId: 'session-one', sessionKey: 'agent:main:one' };
const input = { runId: 'memory-run', taskId: 'memory-task', projectId: 'avalon', role: 'project', root: project };
const scope = await makeScope(input, identity);
const origin = { ...identity, kind: 'user', runId: scope.runId, taskId: scope.taskId, projectId: scope.projectId };
const first = () => writeNote(workspace, { expectedRevision: 0, category: 'preference', content: 'Kısa cevap tercih ediyorum.' }, origin, () => {});

test('source/date/project/id/revision and correction lineage persist immediately', () => {
  fs.writeFileSync(path.join(project, 'report.md'), 'Separate project result');
  const a = first(); const b = writeNote(workspace, { id: a.note.id, expectedRevision: 1, category: 'correction', content: 'Ayrıntılı cevap tercih ediyorum.', derivedFrom: [{ id: a.note.id, revision: 1 }], artifacts: [path.join(project, 'report.md')] }, origin, () => {}, project);
  assert.equal(readNote(workspace, a.note.id).content, b.note.content);
  assert.equal(readNote(workspace, a.note.id, 1).content, a.note.content);
  assert.equal(b.note.origin.userId, identity.userId); assert.ok(Date.parse(b.note.recordedAt));
  assert.equal(b.note.supersedes.revision, 1); assert.equal(b.note.derivedFrom[0].id, a.note.id);
  assert.throws(() => writeNote(workspace, { id: a.note.id, expectedRevision: 1, category: 'correction', content: 'Stale' }, origin, () => {}), /REVISION_CONFLICT/);
});
test('cross-process CAS permits one successor and preserves the previous note', async () => {
  const a = first(); const worker = path.resolve('plugins/jarvis/notes.ts');
  const run = () => new Promise(resolve => {
    const code = `import {writeNote} from ${JSON.stringify(new URL('file:///' + worker.replaceAll('\\', '/')).href)}; try {writeNote(${JSON.stringify(workspace)},${JSON.stringify({ id: a.note.id, expectedRevision: 1, category: 'correction', content: 'Concurrent correction' })},${JSON.stringify(origin)},()=>{}); process.exit(0);} catch {process.exit(2);}`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'ignore', windowsHide: true }); child.on('exit', resolve);
  });
  assert.deepEqual((await Promise.all([run(), run()])).sort(), [0, 2]);
  assert.equal(readNote(workspace, a.note.id).revision, 2); assert.equal(readNote(workspace, a.note.id, 1).content, a.note.content);
});
test('model/web cannot spoof user preferences; bounded input and references required', () => {
  const protectedNote = first();
  assert.throws(() => writeNote(workspace, { id: protectedNote.note.id, expectedRevision: 1, category: 'inference', content: 'Overwrite a user preference as inference' }, { ...origin, kind: 'model' }, () => {}), /cannot supersede/);
  assert.equal(readNote(workspace, protectedNote.note.id).revision, 1);
  for (const kind of ['model', 'web']) assert.throws(() => writeNote(workspace, { expectedRevision: 0, category: 'preference', content: 'User supposedly said' }, { ...origin, kind }, () => {}), /User statements/);
  const draft = { expectedRevision: 0, category: 'inference', content: 'Model inference' };
  assert.throws(() => writeNote(workspace, { ...draft, userId: 'forged' }, origin, () => {}), /Unknown/);
  assert.throws(() => writeNote(workspace, { ...draft, content: 'x'.repeat(1801) }, origin, () => {}));
  assert.throws(() => writeNote(workspace, { ...draft, derivedFrom: [{ id: randomUUID(), revision: 1 }] }, origin, () => {}));
  assert.throws(() => writeNote(workspace, { ...draft, artifacts: [path.join(scratch, 'outside.md')] }, origin, () => {}, project));
  assert.throws(() => writeNote(workspace, draft, origin, () => { throw new Error('revoked'); }), /revoked/);
});
test('only source paths and bounded reads/queries; research and stale scope denied', async () => {
  for (const p of ['../USER.md', 'memory/.dreams/state.json', 'memory/../raw.md', 'memory/a.md:ads', 'sessions/raw.jsonl', 'memory/a.txt', 'C:\\USER.md']) assert.throws(() => memoryParams('jarvis_memory_get', { path: p }));
  assert.throws(() => memoryParams('jarvis_memory_search', { query: 'x', corpus: 'sessions' }));
  const ctx = { ...identity, runId: scope.runId };
  assert.ok((await evaluate({ toolName: 'jarvis_memory_search', params: { query: 'Türkçe' } }, ctx, scope)).params);
  for (const name of MEMORY_TOOLS) {
    assert.equal((await evaluate({ toolName: name, params: {} }, ctx)).block, true);
    assert.equal((await evaluate({ toolName: name, params: {} }, { ...ctx, agentId: 'research' }, { ...scope, agentId: 'research', role: 'research' })).block, true);
  }
  const memory = await makeScope({ runId: 'memory-only', taskId: 'task', projectId: 'personal', role: 'memory', userInput: 'Kısa\n yanıtları tercih ediyorum.' }, identity);
  assert.equal(memory.userStatement, 'Kısa yanıtları tercih ediyorum.');
  assert.equal(Object.hasOwn({ ...memory }, 'userStatement'), false);
  assert.equal(JSON.stringify(memory).includes('Kısa'), false);
  const memoryCtx = { ...identity, runId: memory.runId };
  assert.ok((await evaluate({ toolName: 'jarvis_memory_search', params: { query: 'tercihler' } }, memoryCtx, memory)).params);
  for (const toolName of ['read', 'write', 'edit', 'exec', 'web_fetch']) assert.equal((await evaluate({ toolName, params: { path: path.join(project, 'report.md'), content: 'no file authority' } }, memoryCtx, memory)).block, true);
  await assert.rejects(makeScope({ runId: 'memory-only', taskId: 'task', projectId: 'personal', role: 'memory', root: project }, identity));
  await assert.rejects(makeScope({ runId: 'reader', taskId: 'task', projectId: 'public', role: 'research', query: 'public query', userInput: 'private statement' }, { ...identity, agentId: 'research' }));
});
test('junction and hardlink publication refused without changing targets', () => {
  const outside = path.join(scratch, 'outside'); fs.mkdirSync(outside);
  const linked = path.join(scratch, 'linked-workspace'); fs.symlinkSync(outside, linked, 'junction');
  assert.throws(() => writeNote(linked, { expectedRevision: 0, category: 'finding', content: 'test' }, origin, () => {}), /Linked/);
  const a = first(); const filename = path.join(workspace, a.path); fs.linkSync(filename, path.join(outside, 'linked.md'));
  assert.throws(() => writeNote(workspace, { id: a.note.id, expectedRevision: 1, category: 'correction', content: 'test' }, origin, () => {}), /Linked/);
});
test('public config refuses cloud fallback, raw hooks, chat model and changed Dreaming', () => {
  const config = applyPolicy({ agents: { defaults: { workspace, model: { primary: 'opencode/space-bunny-free', fallbacks: [] } } } }, scratch);
  assertPolicy(config, scratch);
  for (const change of [c => c.memory.search.fallback = 'openai', c => c.memory.search.experimental.sessionMemory = true, c => c.hooks.internal.entries['session-memory'].enabled = true, c => c.plugins.entries['memory-core'].config.dreaming.frequency = '* * * * *', c => c.models = { providers: { 'llama-cpp': { models: [{ id: 'chat' }] } } }]) { const c = structuredClone(config); change(c); assert.throws(() => assertPolicy(c, scratch)); }
});
test('admitted operator writes user notes, different authorized chat reads, revoked authority blocks', async () => {
  const methods = {}, hooks = {}, store = new Map(); let factory;
  const config = applyPolicy({ agents: { defaults: { workspace, model: { primary: 'opencode/space-bunny-free', fallbacks: [] } } } }, scratch);
  plugin.register({ registerCliBackend() {}, registerProvider() {}, config, runtime: { agent: { resolveAgentWorkspaceDir: () => workspace } }, logger: { warn() {} }, on: (name, fn) => hooks[name] = fn, registerTool: f => factory = f, registerGatewayMethod: (name, fn) => methods[name] = fn, runContext: { setRunContext: p => (store.set(p.runId, p.value), true), getRunContext: p => store.get(p.runId), clearRunContext: p => store.delete(p.runId) } });
  const abort = new AbortController(); let current = true;
  const authority = { target: identity, assertCurrent() { if (!current) throw new Error('revoked'); }, retain: () => ({ assertCurrent() { if (!current) throw new Error('revoked'); }, signal: abort.signal, release() {} }) };
  const client = { authenticatedUserId: identity.userId, connect: { role: 'operator', scopes: ['operator.write'], device: { id: identity.deviceId } } };
  let result; const respond = (...r) => result = r;
  await methods['jarvis.scope.bind']({ params: input, client, sessionAccessAuthority: authority, respond }); assert.equal(result[0], true);
  await methods['jarvis.memory.write']({ params: { runId: scope.runId, expectedRevision: 0, category: 'decision', content: 'Only local memory' }, client, sessionAccessAuthority: authority, respond }); assert.equal(result[0], true);
  const id = result[1].note.id;
  const currentPath = result[1].path;
  const other = { ...identity, sessionId: 'session-two', sessionKey: 'agent:main:two' };
  const userInput = 'Kısa yanıtları tercih ediyorum.';
  await methods['jarvis.scope.bind']({ params: { runId: 'other-run', taskId: 'other-task', projectId: 'personal', role: 'memory', userInput }, client, sessionAccessAuthority: { ...authority, target: other }, respond });
  const tools = factory.create({ ...other, assertInvocationCurrent() { if (!current) throw new Error('revoked'); } });
  const read = tools.find(t => t.name === 'jarvis_note_read');
  const note = await read.execute('call', { id }); assert.equal(note.details.content, 'Only local memory');
  const hits = [{ path: currentPath, source: 'memory', snippet: 'current', score: 1 }, { path: 'sessions/raw.jsonl', source: 'sessions', snippet: 'private raw', score: 1 }];
  registerMemoryCapability('memory-core', { runtime: { getMemorySearchManager: async () => ({ manager: { search: async (_query, options) => { assert.deepEqual(options.sources, ['memory']); assert.equal(options.sessionKey, other.sessionKey); return hits; }, status: () => ({ provider: 'local', fts: { enabled: true, available: true }, vector: { enabled: true }, custom: { providerState: { mode: 'ready' } } }), readFile: async p => p }, error: undefined }), authorizeSearchHits: async ({ hits }) => hits } });
  const search = tools.find(t => t.name === 'jarvis_memory_search');
  let found = await search.execute('search', { query: 'local memory' }); assert.equal(found.details.results.length, 1);
  assert.equal(found.details.results[0].provenance.originClass, 'owner'); assert.equal(found.details.results[0].sourceRecord.id, id);
  writeNote(workspace, { id, expectedRevision: 1, category: 'correction', content: 'Latest corrected local memory' }, origin, () => {});
  found = await search.execute('search', { query: 'local memory' }); assert.equal(found.details.results.length, 0); // old vector hits cannot reintroduce superseded facts
  await assert.rejects(tools.find(t => t.name === 'jarvis_memory_get').execute('get', { path: currentPath }), /Superseded/);
  const web = writeNote(workspace, { expectedRevision: 0, category: 'finding', content: 'Unverified external claim', sources: ['https://example.com/source'] }, { ...origin, kind: 'web' }, () => {});
  hits.splice(0, hits.length, { path: web.path, snippet: 'external claim', score: 1, provenance: { originClass: 'agent' } });
  found = await search.execute('search', { query: 'external claim' }); assert.equal(found.details.results[0].provenance.originClass, 'untrusted');
  clearMemoryPluginState();
  const write = tools.find(t => t.name === 'jarvis_note_write');
  await assert.rejects(write.execute('call', { expectedRevision: 0, category: 'preference', content: 'Spoof' }), /User statements/);
  await assert.rejects(write.execute('call', { source: 'user', expectedRevision: 0, category: 'preference', content: 'User supposedly prefers a different thing' }), /exact complete/);
  await assert.rejects(write.execute('call', { source: 'user', expectedRevision: 0, category: 'preference', content: userInput, sources: ['https://example.com/invented-source'] }), /must occur/);
  const preference = await write.execute('call', { source: 'user', expectedRevision: 0, category: 'preference', content: userInput });
  assert.equal(preference.details.note.origin.kind, 'user'); assert.ok(preference.details.note.origin.userInputHash); assert.equal(preference.details.note.content, userInput);
  assert.equal(readNote(workspace, preference.details.note.id).revision, 1);
  current = false; await assert.rejects(read.execute('call', { id }), /revoked/);
  hooks.gateway_stop();
});
test.after(() => { assert.ok(scratch.startsWith(path.resolve('tmp') + path.sep)); fs.rmSync(scratch, { recursive: true }); });
