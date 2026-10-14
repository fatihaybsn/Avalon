// Loaded only by the disposable integration profile. Never a model tool.
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { runBeforeToolCallHook, runAgentHarnessAfterToolCallHook } from 'openclaw/plugin-sdk/agent-harness-runtime';
import { dispatchGatewayMethod } from 'openclaw/plugin-sdk/gateway-method-runtime';
import fs from 'node:fs/promises';

export default definePluginEntry({ id: 'jarvis-policy-test', name: 'Isolated approval test', description: 'Disposable authenticated SDK/registry test', register(api) {
  // Stage 06 fixture only: hold a real native turn before provider I/O, then
  // return an explicit block. No fake successful model or external call.
  const held = new Map<string, () => void>();
  const armed = new Map<string, string>();
  api.registerGatewayMethod('jarvis_test.arm', ({ params, respond, sessionAccessAuthority }) => {
    sessionAccessAuthority!.assertCurrent(); armed.set(sessionAccessAuthority!.target.sessionKey, String(params.runId)); respond(true, { armed: true });
  }, { scope: 'operator.write', profileAccess: 'required', sessionAccess: { mode: 'write' } });
  api.on('before_agent_reply', async (event, ctx) => {
    const marker = /STAGE06_HOST_TEST_ONLY:([a-z0-9-]+)/.exec(event.cleanedBody)?.[1];
    const runId = marker && [...armed.values()].includes(marker) ? marker : undefined;
    if (!runId) return;
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, 120000); timer.unref(); held.set(runId, () => { clearTimeout(timer); resolve(); }); });
    held.delete(runId);
    for (const [sessionKey, id] of armed) if (id === runId) armed.delete(sessionKey);
    return { handled: true, reason: 'Stage06 native admission fixture handled before provider I/O; no model or fulfilled task claimed' };
  }, { eligibleTriggers: ['user'], timeoutMs: 120000 });
  api.registerGatewayMethod('jarvis_test.hold-status', ({ params, respond }) => respond(true, { held: held.has(String(params.runId)) }), { scope: 'operator.read', profileAccess: 'required' });
  api.registerGatewayMethod('jarvis_test.release', ({ params, respond }) => { const release = held.get(String(params.runId)); release?.(); respond(true, { released: Boolean(release) }); }, { scope: 'operator.write', profileAccess: 'required' });
  api.registerGatewayMethod('jarvis_test.work-effect', async options => {
    const target = options.sessionAccessAuthority?.target; if (!target) throw new Error('Test authority required');
    const params = { path: options.params.path, content: options.params.content };
    const runId = String(options.params.runId), toolCallId = String(options.params.toolCallId);
    if (options.params.replayResult !== true) {
      const gate = await runBeforeToolCallHook({ toolName: 'write', toolCallId, params, ctx: { ...target, runId }, approvalMode: 'defer' });
      if (gate.blocked || gate.deferredApproval) { options.respond(true, { blocked: true }); return; }
      options.sessionAccessAuthority!.assertCurrent();
      await fs.writeFile(String(params.path), String(params.content));
    }
    await runAgentHarnessAfterToolCallHook({ ...target, runId, toolName: 'write', toolCallId, startArgs: params, result: { content: [{ type: 'text', text: 'Fixture write returned' }] } });
    options.respond(true, { written: true });
  }, { scope: 'operator.write', profileAccess: 'required', sessionAccess: { mode: 'write' } });
  api.registerGatewayMethod('jarvis_test.probe', async options => {
    const target = options.sessionAccessAuthority?.target;
    if (!target) throw new Error('Test session authority unavailable');
    const gate = await runBeforeToolCallHook({ toolName: 'write', toolCallId: String(options.params.toolCallId), params: { path: options.params.path, content: options.params.content }, ctx: { ...target, runId: String(options.params.runId) }, approvalMode: 'defer' });
    if (gate.blocked || !gate.deferredApproval) { options.respond(true, { blocked: true, reason: gate.blocked ? gate.reason : 'Gate did not defer approval' }); return; }
    const { approval, overrideParams } = gate.deferredApproval;
    const snapshot = structuredClone(overrideParams) as { path: string; content: string };
    const response = await dispatchGatewayMethod('plugin.approval.request', { pluginId: approval.pluginId, title: approval.title, description: approval.description, allowedDecisions: approval.allowedDecisions, severity: approval.severity, toolName: 'write', toolCallId: options.params.toolCallId, agentId: target.agentId, sessionKey: target.sessionKey, timeoutMs: 60000, twoPhase: false }, { expectFinal: true, timeoutMs: 65000 });
    const payload = response.payload as { decision?: string } | undefined;
    const allowed = response.ok && payload?.decision === 'allow-once';
    options.sessionAccessAuthority?.assertCurrent();
    if (allowed) await fs.writeFile(snapshot.path, snapshot.content);
    options.respond(true, { blocked: !allowed, decision: payload?.decision ?? 'unavailable', reason: response.error?.message, snapshot });
  }, { scope: 'operator.write', profileAccess: 'required', sessionAccess: { mode: 'write' } });
} });
