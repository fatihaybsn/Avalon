import assert from 'node:assert/strict';
export const memoryTools = ['jarvis_memory_search', 'jarvis_memory_get', 'jarvis_note_read', 'jarvis_note_write'];
// User-selected Dreaming model only; the primary agent and Live model stay separate.
export const dreamingModels = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
export const dreamingModel = `jarvis-dream-google/${dreamingModels[0]}`;
export function applyMemory(config) {
  // Install only the dedicated Dreaming route; preserve primary/Live and other
  // provider credentials. Both fresh installs and older profiles use this path.
  config.models ??= {}; config.models.providers ??= {};
  config.models.providers['jarvis-dream-google'] = {
    api: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: { source: 'env', provider: 'jarvis-dreaming', id: 'JARVIS_DREAMING_GEMINI_API_KEY' },
    models: dreamingModels.map(id => ({ id, name: `${id} (selected Dreaming only)`, reasoning: true, input: ['text'], contextWindow: 1048576, maxTokens: 65536, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }))
  };
  config.secrets ??= {}; config.secrets.providers ??= {};
  config.secrets.providers['jarvis-dreaming'] = { source: 'env', allowlist: ['JARVIS_DREAMING_GEMINI_API_KEY'] };
  config.memory = { citations: 'on', search: { enabled: true, provider: 'local', fallback: 'none', sources: ['memory'], rememberAcrossConversations: false, experimental: { sessionMemory: false }, extraPaths: [], local: { modelPath: 'hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf' }, query: { maxResults: 6, minScore: 0.35 } } };
  config.plugins.slots = { ...config.plugins.slots, memory: 'memory-core' };
  config.plugins.entries['llama-cpp'] = { enabled: true };
  config.plugins.allow.push('llama-cpp');
  config.plugins.entries['memory-core'] = { enabled: true, subagent: { allowModelOverride: true, allowedModels: [dreamingModel] }, config: { memoryPolicy: { excludeSessions: { chatTypes: ['direct', 'group', 'channel'] } }, dreaming: { enabled: true, frequency: '0 */6 * * *', timezone: 'Europe/Istanbul', model: dreamingModel, storage: { mode: 'separate', separateReports: false }, phases: { light: { enabled: false }, rem: { enabled: false }, deep: { enabled: true, limit: 6, minScore: 0.1, minRecallCount: 1, minUniqueQueries: 1, maxPromotedSnippetTokens: 160, maxPriorEntryLossFraction: 0 } } } } };
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
  const dream = config.models?.providers?.['jarvis-dream-google'];
  assert.ok(dream, 'Dedicated Dreaming provider missing; apply stage 05 policy');
  if (dream) {
    assert.equal(dream.api, 'google-generative-ai');
    assert.equal(dream.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
    assert.deepEqual(dream.models.map(m => m.id), dreamingModels);
    assert.deepEqual(dream.apiKey, { source: 'env', provider: 'jarvis-dreaming', id: 'JARVIS_DREAMING_GEMINI_API_KEY' });
    assert.deepEqual(config.secrets?.providers?.['jarvis-dreaming'], { source: 'env', allowlist: ['JARVIS_DREAMING_GEMINI_API_KEY'] });
  }
}
