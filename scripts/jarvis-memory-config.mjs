import assert from 'node:assert/strict';
export const memoryTools = ['jarvis_memory_search', 'jarvis_memory_get', 'jarvis_note_read', 'jarvis_note_write'];
export function applyMemory(config) {
  config.memory = { citations: 'on', search: { enabled: true, provider: 'local', fallback: 'none', sources: ['memory'], rememberAcrossConversations: false, experimental: { sessionMemory: false }, extraPaths: [], local: { modelPath: 'hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf' }, query: { maxResults: 6, minScore: 0.35 } } };
  config.plugins.slots = { ...config.plugins.slots, memory: 'memory-core' };
  config.plugins.entries['llama-cpp'] = { enabled: true };
  config.plugins.allow.push('llama-cpp');
  config.plugins.entries['memory-core'] = { enabled: true, subagent: { allowModelOverride: true, allowedModels: ['jarvis-opencode-memory/space-bunny-free'] }, config: { memoryPolicy: { excludeSessions: { chatTypes: ['direct', 'group', 'channel'] } }, dreaming: { enabled: true, frequency: '0 */6 * * *', timezone: 'Europe/Istanbul', model: 'jarvis-opencode-memory/space-bunny-free', storage: { mode: 'separate', separateReports: false }, phases: { light: { enabled: false }, rem: { enabled: false }, deep: { enabled: true, limit: 6, minScore: 0.1, minRecallCount: 1, minUniqueQueries: 1, maxPromotedSnippetTokens: 160, maxPriorEntryLossFraction: 0 } } } } };
  // In this release both light and REM ingest transcripts even without session
  // search. Exclusion lists do not match missing metadata. Disable these two
  // ingestion phases; the native deep sweep remains scheduled, note/recall only.
  config.agents.entries.main.tools.allow.push(...memoryTools);
  delete config.agents.entries.main.memory; // inherit the single exact local config
  config.agents.entries.research.memory = { search: { enabled: false, rememberAcrossConversations: false, experimental: { sessionMemory: false } } };
  config.tools.allow.push(...memoryTools);
  config.agents.defaults.compaction = { ...config.agents.defaults.compaction, memoryFlush: { enabled: false } };
  config.agents.defaults.userTimezone = 'Europe/Istanbul';
  config.agents.defaults.contextInjection = 'never';
  config.hooks ??= {}; config.hooks.internal ??= {}; config.hooks.internal.entries ??= {};
  config.hooks.internal.entries['session-memory'] = { enabled: false };
  config.cron = { ...config.cron, enabled: true };
  return config;
}
export function assertMemory(config) {
  const expected = applyMemory({ agents: { defaults: {}, entries: { main: { tools: { allow: [] } }, research: {} } }, plugins: { entries: {}, allow: [] }, tools: { allow: [] } });
  assert.deepEqual(config.memory, expected.memory, 'Memory must be builtin local notes only, no fallback');
  assert.equal(config.plugins?.slots?.memory, 'memory-core');
  assert.deepEqual(config.plugins?.entries?.['memory-core'], expected.plugins.entries['memory-core']);
  assert.equal(config.hooks?.internal?.entries?.['session-memory']?.enabled, false);
  assert.equal(config.agents?.defaults?.compaction?.memoryFlush?.enabled, false);
  assert.equal(config.agents?.defaults?.contextInjection, 'never');
  assert.equal(config.agents?.entries?.main?.memory, undefined, 'No per-agent provider/source override');
  assert.equal(config.cron?.enabled, true);
  const llama = config.models?.providers?.['llama-cpp'];
  if (llama) { assert.deepEqual(llama.models, [], 'Embedding-only provider cannot have chat models'); assert.ok(llama.localService, 'llama.cpp must be managed'); assert.match(llama.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/); }
  assert.equal(config.agents?.defaults?.model?.primary, 'opencode/space-bunny-free');
  assert.deepEqual(config.agents?.defaults?.model?.fallbacks, []);
}
