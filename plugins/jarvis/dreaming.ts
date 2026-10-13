import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
export const DREAMING_TOKEN = '__openclaw_memory_core_short_term_promotion_dream__';
export async function admitDreamingNotes(_api: OpenClawPluginApi, assertCurrent: () => void): Promise<{ admitted: number }> {
  assertCurrent();
  // Public CLI swallows recall persistence failure without its Gateway-owned
  // store. Search success or an empty sweep does not prove admission.
  throw new Error('STAGE05_BLOCKED: OpenClaw 2026.10.2 public CLI cannot admit Dreaming recalls: memory-core dreaming SQLite state store is not configured. No cloud inference dispatched.');
}
