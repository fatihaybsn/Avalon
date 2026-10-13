import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolveInstalledTavily } from './tavily-installation.mjs';
import { assertPolicy } from './jarvis-policy-config.mjs';
import { makeScope, evaluate } from '../plugins/jarvis/policy.ts';

// One explicit account check through the installed official tool, no model,
// private context, alternate transport, retry or provider fallback.
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw-jarvis', 'openclaw.json'), 'utf8'));
assertPolicy(config, path.join(os.homedir(), '.openclaw-jarvis'));
if (!/^tvly-\S+$/.test(process.env.TAVILY_API_KEY ?? '')) {
  console.log(JSON.stringify({ ok: false, category: 'missing-key' }));
  process.exit(1);
}
const root = resolveInstalledTavily();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vendor = (await import(pathToFileURL(path.join(root, pkg.openclaw.runtimeExtensions[0])).href)).default;
let factory;
vendor.register({ config, registerTool: (fn, options) => { if (options.name === 'tavily_search') factory = fn; }, registerWebSearchProvider() {} });
const identity = { userId: 'local-account-verification', deviceId: 'local-terminal', sessionKey: 'account-verification', sessionId: 'account-verification', agentId: 'research' };
const scope = await makeScope({ runId: 'tavily-account-verification', projectId: 'stage03', taskId: 'verify-tavily-access', role: 'research', query: 'OpenClaw official Tavily plugin documentation' }, identity);
const gate = await evaluate({ toolName: 'tavily_search', params: { query: scope.query } }, { ...identity, runId: scope.runId }, scope);
if (gate.block || !gate.params) throw new Error('Research policy rejected account verification');
try {
  const result = await factory({ config }).execute(scope.runId, gate.params);
  const details = result.details;
  console.log(JSON.stringify({ ok: true, provider: details.provider, searchDepth: gate.params.search_depth, results: details.results?.length ?? 0, untrusted: details.externalContent?.untrusted === true, verification: 'official-tool-account-access', planVerified: false }));
} catch (error) {
  // Never print raw provider errors, bodies or credential-bearing arguments.
  const message = String(error?.message ?? '');
  const status = message.match(/\((\d{3})\)/)?.[1];
  const category = /432|429|quota|credit|limit/i.test(message) ? 'quota/rate-limit' : /401|403|auth|api.key/i.test(message) ? 'authentication/access' : 'network/response';
  console.log(JSON.stringify({ ok: false, category, ...(status ? { status: Number(status) } : {}) }));
  process.exitCode = 1;
}
