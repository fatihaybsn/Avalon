// Loaded only by the disposable integration profile. Never a model tool.
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { runBeforeToolCallHook } from 'openclaw/plugin-sdk/agent-harness-runtime';
import { dispatchGatewayMethod } from 'openclaw/plugin-sdk/gateway-method-runtime';
import fs from 'node:fs/promises';

export default definePluginEntry({ id: 'jarvis-policy-test', name: 'Isolated approval test', description: 'Disposable authenticated SDK/registry test', register(api) {
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
