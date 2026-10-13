import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { getMemoryCapabilityRegistration } from 'openclaw/plugin-sdk/memory-host-core';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { noteView, readNote, refreshNoteView } from './notes.ts';
export const DREAMING_TOKEN = '__openclaw_memory_core_short_term_promotion_dream__';
type Permit = { callId: string; runId: string; query: string; assertCurrent: () => void };
const permits = new Map<string, Permit>();
export function admitNativeRecallCall(event: { toolName: string; toolCallId?: string; params: Record<string, unknown> }, ctx: { agentId?: string; runId?: string }) {
  const p = event.toolCallId ? permits.get(event.toolCallId) : undefined;
  if (!p || ctx.agentId !== 'main' || ctx.runId !== p.runId || event.toolName !== 'memory_search') return undefined;
  p.assertCurrent();
  if (JSON.stringify(event.params) !== JSON.stringify({ query: p.query, maxResults: 1, minScore: 0.99, corpus: 'memory' })) return { block: true, blockReason: 'Native recall parameters differ from host selection' };
  return { params: event.params };
}
export async function readNativeDreaming(api: OpenClawPluginApi) {
  void api;
  // Public caller-scoped dispatch: no official-plugin trust impersonation,
  // owner credential or synthetic scope. Only called inside admitted RPCs.
  const { dispatchGatewayMethod } = await import('openclaw/plugin-sdk/gateway-method-runtime');
  const response = await dispatchGatewayMethod('doctor.memory.status', { agentId: 'main' });
  if (!response.ok) throw new Error(response.error?.message ?? 'Native status refused');
  return (response.payload as { dreaming: { shortTermEntries: { path: string; snippet: string; recallCount: number; key: string }[]; promotedEntries: { path: string; key: string }[]; shortTermCount: number; promotedTotal: number } }).dreaming;
}
export async function admitDreamingNotes(api: OpenClawPluginApi, assertCurrent: () => void, selectedIds: string[], sessionKey: string, verifyNative?: () => ReturnType<typeof readNativeDreaming>) {
  assertCurrent();
  const workspace = api.runtime.agent.resolveAgentWorkspaceDir(api.config, 'main');
  const registration = getMemoryCapabilityRegistration();
  if (registration?.pluginId !== 'memory-core' || !registration.capability.runtime) throw new Error('Builtin native Memory Core required');
  const { manager, error } = await registration.capability.runtime.getMemorySearchManager({ cfg: api.config, agentId: 'main' });
  if (!manager?.sync) throw new Error(error ?? 'Supported native index synchronization unavailable');
  if (selectedIds.length > 6 || new Set(selectedIds).size !== selectedIds.length) throw new Error('At most six distinct selected note IDs');
  const views = selectedIds.map(id => { const n = refreshNoteView(workspace, id, assertCurrent); const v = noteView(workspace, n); if (!v) throw new Error('Note excluded or exceeds native snippet budget; source remains immediately readable'); return { ...v, id: n.id, revision: n.revision }; });
  const assertSelected = () => { assertCurrent(); for (const view of views) if (readNote(workspace, view.id).revision !== view.revision || fs.readFileSync(path.join(workspace, view.path), 'utf8') !== view.text) throw new Error('REVISION_CONFLICT: selected daily view changed'); };
  if (!views.length) return { admitted: 0, selected: 0, evidence: [] };
  await manager.sync({ reason: 'jarvis-selected-daily-notes', force: true });
  assertSelected();
  // Daily ingestion is coupled to Light/REM transcript ingestion in 2026.10.2.
  // This exception exists only in a temporary host tool surface, never in the
  // live model/client configuration or a model-supplied grant.
  const cfg = structuredClone(api.config);
  cfg.tools = { ...cfg.tools, allow: ['memory_search'], deny: cfg.tools?.deny?.filter(n => n !== 'memory_search') };
  cfg.agents!.entries!.main!.tools = { allow: ['memory_search'] };
  const evidence = [];
  const { createOpenClawCodingTools } = await import('openclaw/plugin-sdk/agent-harness');
  const existing = verifyNative ? await verifyNative() : undefined;
  assertSelected();
  for (const view of views) {
    const known = existing?.shortTermEntries.find(e => e.path === view.path && e.snippet.startsWith(view.marker) && e.recallCount > 0);
    if (known) { evidence.push({ path: view.path, key: known.key, observed: 'native-store' }); continue; }
    const callId = `jarvis-native-recall-${randomUUID()}`, runId = `jarvis-dream-${randomUUID()}`;
    permits.set(callId, { callId, runId, query: view.marker, assertCurrent: assertSelected });
    try {
      const tools = createOpenClawCodingTools({ config: cfg, sessionConfigSource: 'pinned', agentId: 'main', sessionKey, runId, workspaceDir: workspace, runtimeToolAllowlist: ['memory_search'], includeToolSearchControls: false });
      const tool = tools.find(t => t.name === 'memory_search');
      if (!tool) throw new Error('Public SDK could not materialize host-only native memory_search');
      const output = await tool.execute(callId, { query: view.marker, maxResults: 1, minScore: 0.99, corpus: 'memory' });
      const details = output.details as { results?: { path: string; snippet: string }[] };
      if (details?.results?.length !== 1 || details.results[0].path !== view.path || !details.results[0].snippet.includes(view.marker)) throw new Error('Native index freshness/selected hit not confirmed; no cloud dispatch');
      assertSelected();
      if (!verifyNative) {
        evidence.push({ path: view.path, observed: 'fresh-native-tool-result; persistence must be observed through host status' });
        continue;
      }
      let found;
      for (let attempt = 0; attempt < 40; attempt++) {
        found = (await verifyNative()).shortTermEntries.find(e => e.path === view.path && e.snippet.startsWith(view.marker) && e.recallCount > 0);
        assertSelected();
        if (found) break;
        await delay(100);
      }
      if (!found) throw new Error('Native search returned a fresh hit but recall persistence was not observed; no sweep/cloud dispatch');
      evidence.push({ path: view.path, key: found.key });
    } finally { permits.delete(callId); }
  }
  return { ...(verifyNative ? { admitted: evidence.length } : { requested: evidence.length }), selected: views.length, evidence };
}
