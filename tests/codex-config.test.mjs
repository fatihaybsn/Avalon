import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCodex } from '../scripts/jarvis-codex-config.mjs';

const binary = 'C:\\private\\codex.exe';
const base = { agents: { defaults: { model: { primary: 'opencode/space-bunny-free' } } }, tools: { exec: { security: 'deny', ask: 'always' }, elevated: { enabled: false } }, plugins: { entries: { jarvis: { enabled: true } } } };
test('preparation cannot enable execution, supervision, model fallback or automatic approval', () => {
  const c = prepareCodex(base, binary, []), e = c.plugins.entries.codex;
  assert.equal(e.enabled, false);
  assert.equal(e.config.supervision.enabled, false);
  assert.equal(e.config.appServer.approvalsReviewer, 'user');
  assert.equal(e.config.appServer.approvalPolicy, 'on-request');
  assert.equal(e.config.appServer.sandbox, 'read-only');
  assert.equal(e.config.appServer.cyberFailover.mode, 'off');
  assert.equal(e.config.appServer.loopDetectionPreToolUseRelay, true);
  assert.deepEqual(c.tools, base.tools); assert.deepEqual(c.agents, base.agents);
  assert.equal(base.plugins.entries.codex, undefined);
});
test('native identity and environment stay explicit; desktop home and credentials are not imported', () => {
  const e = prepareCodex(base, binary, ['JARVIS_CUSTOM_KEY', 'GEMINI_API_KEY', 'OPENCLAW_GATEWAY_TOKEN', 'PATH']).plugins.entries.codex.config.appServer;
  assert.equal(e.command, binary); assert.equal(e.homeScope, 'agent'); assert.equal(e.transport, 'stdio');
  for (const name of ['JARVIS_CUSTOM_KEY', 'GEMINI_API_KEY', 'OPENCLAW_GATEWAY_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']) assert.ok(e.clearEnv.includes(name));
  assert.ok(!e.clearEnv.includes('PATH'));
  assert.ok(e.args.includes('windows.sandbox="unelevated"'));
  assert.throws(() => prepareCodex(base, 'codex.exe'), /Explicit/);
});
