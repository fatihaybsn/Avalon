import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { applyMemory, assertMemory } from './jarvis-memory-config.mjs';
import { applyWork, assertWork } from './jarvis-work-config.mjs';
import { applyQuick, assertQuick } from './jarvis-quick-config.mjs';
import {applyGui} from './jarvis-gui-config.mjs';
import { separateCodexTools } from './codex-worker-policy.mjs';
import {applyWorkers} from './jarvis-worker-config.mjs';
import {applyAutomations} from './jarvis-automation-config.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function applyPolicy(config, profileDir, pluginPath = path.join(repo, 'plugins', 'jarvis')) {
  const codexEnabled = config.plugins?.entries?.codex?.enabled === true;
  const workersEnabled=config.plugins?.entries?.jarvis?.config?.openCodeFullAccess===true;
  const guiNode=config.plugins?.entries?.jarvis?.config?.guiNode;
  const nativeAutomations=config.plugins?.entries?.jarvis?.config?.nativeAutomations===true;
  config.plugins ??= {};
  config.plugins.load ??= {};
  config.plugins.load.paths = [...new Set([...(config.plugins.load.paths ?? []).filter(p => !p.endsWith('plugins/jarvis') && !p.endsWith('plugins\\jarvis')), pluginPath])];
  config.plugins.entries ??= {};
  config.plugins.entries.jarvis = { enabled: true, hooks: { allowConversationAccess: true, allowPromptInjection: true }, config:{nativeRoot:path.join(repo,'native','windows')} };
  config.plugins.allow = ['jarvis', 'tavily', 'opencode', 'google', 'memory-core'];
  config.plugins.entries.tavily = { enabled: true, config: { webSearch: { baseUrl: 'https://api.tavily.com' } } };
  config.plugins.entries.firecrawl = { enabled: false };
  config.agents ??= {}; config.agents.defaults ??= {};
  config.agents.ownership = 'explicit';
  config.agents.defaults.skipBootstrap = true;
  config.agents.defaults.systemAgent = { ...config.agents.defaults.systemAgent, agentId: 'main' };
  config.agents.entries ??= {};
  config.agents.entries.main = { ...config.agents.entries.main, workspace: config.agents.defaults.workspace ?? path.join(profileDir, 'workspace'), tools: { allow: ['read', 'write', 'edit'] } };
  config.agents.entries.research = { workspace: path.join(profileDir, 'research-empty'), contextInjection: 'never', skills: [], tools: { allow: ['tavily_search', 'web_fetch'] }, subagents: { allowAgents: [] } };
  config.tools = { ...config.tools, allow: ['read', 'write', 'edit', 'tavily_search', 'web_fetch'], deny: ['exec', 'process', 'apply_patch', 'code_execution', 'browser', 'computer', 'nodes', 'message', 'sessions_spawn', 'sessions_send', 'subagents', 'gateway', 'plugins', 'openclaw', 'cron', 'automations', 'web_search', 'tavily_extract', 'jarvis_web_fetch', 'memory_search', 'memory_get'], elevated: { enabled: false }, exec: { security: 'deny', ask: 'always' }, web: { search: { enabled: false, provider: 'tavily', cacheTtlMinutes: 0 }, fetch: { enabled: true, readability: true, maxChars: 20000, maxCharsCap: 20000, maxResponseBytes: 262144, timeoutSeconds: 10, cacheTtlMinutes: 0, maxRedirects: 0, useTrustedEnvProxy: false, ssrfPolicy: { dangerouslyAllowPrivateNetwork: false, allowRfc2544BenchmarkRange: false, allowIpv6UniqueLocalRange: false } } } };
  delete config.tools.alsoAllow;
  applyMemory(config);
  const prepared = applyGui(applyQuick(applyWork(config)),guiNode);
  if(workersEnabled)applyWorkers(prepared);
  if (codexEnabled) { prepared.plugins.allow.push('codex'); separateCodexTools(prepared, profileDir); }
  if(nativeAutomations){prepared.plugins.entries.jarvis.config.nativeAutomations=true;applyAutomations(prepared);}
  return prepared;
}
export function assertPolicy(config, profileDir) {
  const expected = applyPolicy(structuredClone(config), profileDir);
  assert.deepEqual(config.plugins?.entries?.jarvis, expected.plugins.entries.jarvis, 'JARVIS hooks must be explicitly enabled');
  assert.deepEqual(config.plugins?.entries?.tavily, expected.plugins.entries.tavily, 'Official Tavily endpoint/credential policy differs');
  assert.deepEqual(config.plugins?.allow, expected.plugins.allow, 'Provider/plugin allowlist differs');
  assert.deepEqual(config.plugins?.entries?.firecrawl, { enabled: false }, 'Paid fetch fallback must remain closed');
  assert.deepEqual(config.agents?.entries?.research, expected.agents.entries.research, 'Reader isolation differs from stage 03');
  assert.deepEqual(config.agents?.entries?.main?.tools, expected.agents.entries.main.tools, 'Main tool catalog differs from stage 03');
  assert.deepEqual(config.tools, expected.tools, 'Host tool policy differs from stage 03');
  assert.equal(config.agents?.defaults?.skipBootstrap, true);
  assert.equal(config.agents?.ownership, 'explicit');
  assertWork(config);
  assertQuick(config);
  assertMemory(config);
  assert.ok(config.plugins?.load?.paths?.some(p => path.resolve(p) === path.join(repo, 'plugins', 'jarvis')), 'JARVIS plugin load path unavailable');
  const version = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules/openclaw/package.json'))).version;
  assert.equal(version, '2026.10.2', 'Review SDK contract before changing OpenClaw version');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checking = process.argv[2] === '--check';
  const filename = checking ? path.resolve(process.argv[3]) : path.join(process.env.USERPROFILE, '.openclaw-jarvis', 'openclaw.json');
  const profileDir = path.dirname(filename);
  const before = fs.readFileSync(filename, 'utf8');
  if (checking) {
    try { assertPolicy(JSON.parse(before), profileDir); console.log('JARVIS stage 03 + 05 + 06 + 07 host policy OK'); }
    catch { console.error('JARVIS stage 03/05 policy missing/changed; Gateway startup refused. Apply reviewed policy before starting.'); process.exitCode = 1; }
  } else {
  const after = JSON.stringify(applyPolicy(JSON.parse(before), profileDir), null, 2) + '\n';
  const backup = path.join(profileDir, 'openclaw.before-stage05.json');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, before, { flag: 'wx' });
  fs.writeFileSync(filename, after);
  console.log('JARVIS stage 03 + 05 policy applied; existing chat/provider/auth values preserved. Restart Gateway to load.');
  }
}
