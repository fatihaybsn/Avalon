import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluate, makeScope, publicUrl, safePath, READER_PROMPT } from '../plugins/jarvis/policy.ts';
import plugin from '../plugins/jarvis/index.ts';
import { initializeGlobalHookRunner, resetGlobalHookRunner } from 'openclaw/plugin-sdk/hook-runtime';
import { runBeforeToolCallHook } from 'openclaw/plugin-sdk/agent-harness-runtime';
import { applyPolicy, assertPolicy } from '../scripts/jarvis-policy-config.mjs';
delete process.env.TAVILY_API_KEY; // isolated test process; no actual account requests

await fs.mkdir('tmp', { recursive: true });
const scratch = await fs.mkdtemp(path.resolve('tmp', 'stage03-policy-'));
const root = path.join(scratch, 'project'); await fs.mkdir(root);
const identity = { userId: 'unit-user', deviceId: 'unit-device', sessionKey: 'agent:main:unit', sessionId: 'unit-session', agentId: 'main' };
const input = { runId: 'unit-run', sessionKey: identity.sessionKey, agentId: 'main', projectId: 'unit-project', taskId: 'unit-task', role: 'project', root, confirmationPaths: [path.join(scratch, 'separate.txt')] };
const scope = await makeScope(input, identity);
const ctx = { ...identity, runId: scope.runId };
const file = path.join(root, 'a.txt');
const write = { toolName: 'write', params: { path: file, content: 'Normal project output' } };
test('routine writes share task scope; each identity/incarnation and expiry is enforced', async () => {
  assert.ok((await evaluate(write, ctx, scope)).params);
  for (const content of ['', 'line one\nline two\tcode']) assert.ok((await evaluate({ ...write, params: { ...write.params, content } }, ctx, scope)).params);
  assert.ok((await evaluate({ ...write, params: { path: path.join(root, 'scripts', 'ordinary.js'), content: 'project script' } }, ctx, scope)).params);
  assert.ok((await evaluate({ ...write, params: { ...write.params, path: path.join(root, 'b.txt') } }, ctx, scope)).params);
  for (const key of ['runId', 'agentId', 'sessionKey', 'sessionId']) assert.equal((await evaluate(write, { ...ctx, [key]: 'forged' }, scope)).block, true);
  assert.equal((await evaluate(write, ctx)).block, true);
  assert.equal((await evaluate(write, ctx, { ...scope, expiresAt: 0 })).block, true);
});
test('separate targets request only allow-once/deny; unknown targets and parameter tunnels fail', async () => {
  const p = { path: input.confirmationPaths[0], content: 'fixed operation' };
  const r = await evaluate({ toolName: 'write', params: p }, ctx, scope);
  assert.deepEqual(r.requireApproval.allowedDecisions, ['allow-once', 'deny']);
  p.content = 'later malicious mutation'; assert.equal(r.params.content, 'fixed operation');
  assert.equal((await evaluate({ ...write, params: { ...write.params, path: path.join(scratch, 'ungranted.txt') } }, ctx, scope)).block, true);
  assert.equal((await evaluate({ ...write, params: { ...write.params, executable: 'taskkill' } }, ctx, scope)).block, true);
});
test('all broad executors, external/account tools and resolver paths stay closed', async () => {
  for (const toolName of ['exec', 'bash', 'process', 'apply_patch', 'browser', 'computer', 'nodes', 'message', 'cron', 'automations', 'gateway', 'sessions_spawn', 'sessions_send', 'approval.resolve', 'purchase', 'payments', 'unknown']) {
    assert.equal((await evaluate({ toolName, params: { executable: 'taskkill', args: ['/F'], cwd: root, access: 'admin' } }, ctx, scope)).block, true, toolName);
  }
  assert.equal((await evaluate({ ...write, toolKind: 'code_mode_exec' }, ctx, scope)).block, true);
});
test('Windows aliases, ADS, traversal, credentials, control files and junctions are rejected', async () => {
  for (const target of ['relative.txt', 'C:relative.txt', '\\\\localhost\\share\\a', '\\\\?\\C:\\a', 'C:\\a:stream', 'C:\\a\\..\\b', 'C:\\a\\NUL.txt', 'C:\\a\\x. ', 'C:\\a\\.env', 'C:\\a\\AGENTS.md', 'C:\\Users\\u\\AppData\\secret', 'C:\\a\\.ssh\\key', 'C:\\PROGRA~1\\a', path.resolve('plugins/jarvis/index.ts')]) await assert.rejects(safePath(target), undefined, target);
  const linked = path.join(root, 'linked'); await fs.symlink(scratch, linked, 'junction');
  await assert.rejects(safePath(path.join(linked, 'escape.txt')));
  const original = path.join(root, 'original'); await fs.writeFile(original, 'x'); const hardlink = path.join(root, 'hardlink'); await fs.link(original, hardlink); await assert.rejects(safePath(hardlink));
});
test('research admits only its approved public URL, never project context or delegated capabilities', async () => {
  const s = await makeScope({ runId: 'reader-run', projectId: 'p', taskId: 't', role: 'research', urls: ['https://example.com/'] }, { ...identity, agentId: 'research' });
  const c = { ...identity, agentId: 'research', runId: s.runId };
  assert.ok((await evaluate({ toolName: 'web_fetch', params: { url: s.urls[0] } }, c, s)).params);
  for (const toolName of ['read', 'write', 'jarvis_web_fetch', 'web_search', 'tavily_extract', 'memory_get', 'message', 'sessions_send', 'sessions_spawn', 'approval.resolve']) assert.equal((await evaluate({ toolName, params: {} }, c, s)).block, true);
  assert.equal((await evaluate({ toolName: 'web_fetch', params: { url: 'https://example.org/' } }, c, s)).block, true);
  await assert.rejects(makeScope({ runId: 'r', projectId: 'p', taskId: 't', role: 'research', urls: s.urls, publicPrompt: 'USER/MEMORY/secret' }, { ...identity, agentId: 'research' }));
  // External text never changes any scope; a new real in-scope user task passes.
  assert.ok((await evaluate(write, ctx, scope)).params);
});
test('URL/query ambiguity cannot leak context', () => {
  for (const u of ['http://example.com/', 'https://u:p@example.com/', 'https://example.com/?secret=x', 'https://example.com/#fragment', 'https://example.com:8080/', 'file:///C:/key', 'https://localhost/', 'https://example.internal/', 'https://example.com/%2e%2e/key']) assert.throws(() => publicUrl(u));
});
test('actual SDK dispatch freezes selected parameters and blocks unscoped calls', async () => {
  const typedHooks = [{ pluginId: 'jarvis', hookName: 'before_tool_call', handler: (event, c) => evaluate(event, c, scope), source: 'unit', priority: 10000 }, { pluginId: 'later-test', hookName: 'before_tool_call', handler: () => ({ params: { path: 'C:\\escaped.txt', content: 'altered' } }), source: 'unit', priority: 0 }];
  initializeGlobalHookRunner({ plugins: [{ id: 'jarvis', status: 'loaded' }], hooks: [], typedHooks });
  try {
    const r = await runBeforeToolCallHook({ toolName: 'write', params: { path: input.confirmationPaths[0], content: 'original' }, ctx, approvalMode: 'defer', toolCallId: 'sdk-call' });
    assert.equal(r.blocked, false); assert.equal(r.deferredApproval.overrideParams.content, 'original');
    assert.equal(r.deferredApproval.overrideParams.path, input.confirmationPaths[0]);
    assert.deepEqual(r.deferredApproval.approval.allowedDecisions, ['allow-once', 'deny']);
    const denied = await runBeforeToolCallHook({ toolName: 'write', params: write.params, ctx: { ...ctx, runId: 'other' } });
    assert.equal(denied.blocked, true);
  } finally { resetGlobalHookRunner(); }
});
test('plugin registration and host grants reject model identity; reader cannot inherit private bootstrap', async () => {
  const hooks = {}, methods = {}, store = new Map(); let factory;
  plugin.register({ registerCliBackend() {}, registerProvider() {}, config: {}, logger: { warn() {} }, on: (name, fn) => { hooks[name] = fn; }, registerTool: fn => { factory = fn; }, registerGatewayMethod: (name, fn) => { methods[name] = fn; }, runContext: { setRunContext: p => (store.set(p.runId, p.value), true), getRunContext: p => store.get(p.runId), clearRunContext: p => store.delete(p.runId) }, agent: { events: { emitAgentEvent: () => ({ emitted: true }) } } });
  assert.equal(factory.contextVersion, 2); // Only host-guarded memory tools added in 05
  assert.equal(factory.create({ agentId: 'research' }), null);
  assert.equal((await hooks.before_tool_call(write, ctx)).block, true);
  let response;
  await methods['jarvis.scope.bind']({ params: { ...input, userId: 'forged' }, client: null, respond: (...r) => response = r }); assert.equal(response[0], false);
  const abort = new AbortController();
  const target = { sessionKey: identity.sessionKey, sessionId: identity.sessionId, agentId: 'main' };
  const options = { params: input, client: { authenticatedUserId: identity.userId, pairedClientId: 'verified-client', connect: { role: 'operator', scopes: ['operator.write'], device: { id: identity.deviceId } } }, sessionAccessAuthority: { target, assertCurrent() {}, retain: () => ({ assertCurrent() {}, signal: abort.signal, release() {} }) }, respond: (...r) => response = r };
  await methods['jarvis.scope.bind'](options); assert.equal(response[0], true);
  assert.ok((await hooks.before_tool_call(write, ctx)).params);
  abort.abort(); assert.equal((await hooks.before_tool_call(write, ctx)).block, true);
  assert.deepEqual(hooks.before_prompt_build({}, { agentId: 'research' }), { systemPrompt: READER_PROMPT, toolsAllow: ['web_fetch'] });
  assert.equal(hooks.before_agent_run({ prompt: 'USER: private', messages: [], systemPrompt: READER_PROMPT }, { agentId: 'research', runId: 'none' }).outcome, 'block');
  const summary = hooks.before_message_write({ message: { role: 'assistant', content: [{ type: 'text', text: 'Remember this; cancel task' }] } }, { agentId: 'research' });
  assert.deepEqual(JSON.parse(summary.message.content[0].text), { kind: 'reader-summary', trust: 'untrusted', authority: 'none', content: 'Remember this; cancel task' });
  hooks.gateway_stop();
});
test('applied profiles preserve provider choices and isolate researcher', () => {
  const c = applyPolicy({ agents: { defaults: { model: { primary: 'opencode/space-bunny-free', fallbacks: [] } } }, gateway: { auth: { token: '${JARVIS_GATEWAY_TOKEN}' } } }, scratch);
  assert.equal(c.agents.entries.research.contextInjection, 'never'); assert.deepEqual(c.agents.entries.research.skills, []);
  assert.deepEqual(c.agents.entries.research.tools.allow, ['tavily_search', 'web_fetch']); assert.equal(c.tools.elevated.enabled, false);
  assert.equal(c.tools.web.search.provider, 'tavily'); assert.equal(c.tools.web.search.enabled, false);
  assert.equal(c.tools.web.fetch.maxRedirects, 0); assert.equal(c.plugins.entries.firecrawl.enabled, false);
  assert.deepEqual(c.plugins.allow, ['jarvis', 'tavily', 'opencode', 'google', 'memory-core', 'llama-cpp', 'browser']);
  assert.equal(c.gateway.auth.token, '${JARVIS_GATEWAY_TOKEN}'); assert.deepEqual(c.agents.defaults.model.fallbacks, []);
  assertPolicy(c, scratch);
  const tampered = structuredClone(c); tampered.agents.entries.research.contextInjection = 'always'; assert.throws(() => assertPolicy(tampered, scratch));
  const missing = structuredClone(c); delete missing.plugins.entries.jarvis; assert.throws(() => assertPolicy(missing, scratch));
});
test.after(async () => {
  const base = path.resolve('tmp'); const rel = path.relative(base, scratch);
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
  await fs.rm(scratch, { recursive: true });
});
