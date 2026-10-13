// Disposable Gateway/profile; no live model calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import assert from 'node:assert/strict';
import { applyPolicy } from '../scripts/jarvis-policy-config.mjs';
import { resolveInstalledTavily } from '../scripts/tavily-installation.mjs';

await fs.mkdir('tmp', { recursive: true });
const scratch = await fs.mkdtemp(path.resolve('tmp', 'stage03-gateway-'));
const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port; await new Promise(r => listener.close(r));
const token = randomBytes(32).toString('hex');
const configPath = path.join(scratch, 'openclaw.json');
const config = applyPolicy({ gateway: { mode: 'local', port, bind: 'loopback', auth: { mode: 'token', token } }, agents: { defaults: { workspace: path.join(scratch, 'workspace'), model: { primary: 'opencode/space-bunny-free', fallbacks: [] }, utilityModel: '' } } }, scratch);
config.gateway.controlUi = { allowedOrigins: [`http://127.0.0.1:${port}`] };
config.plugins.load.paths.push(path.resolve('tests/fixtures/approval-plugin'));
config.plugins.load.paths.push(resolveInstalledTavily());
config.plugins.load.paths.push(path.join(os.homedir(), '.openclaw-jarvis/extensions/llama-cpp'));
config.plugins.allow.push('jarvis-policy-test');
config.plugins.entries['jarvis-policy-test'] = { enabled: true };
await fs.writeFile(configPath, JSON.stringify(config));
const env = { ...process.env, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_STATE_DIR: scratch, OPENCLAW_GATEWAY_TOKEN: token };
delete env.OPENCODE_API_KEY; delete env.GEMINI_API_KEY;
delete env.TAVILY_API_KEY;
process.env.OPENCLAW_CONFIG_PATH = configPath; process.env.OPENCLAW_STATE_DIR = scratch; process.env.OPENCLAW_GATEWAY_TOKEN = token;
const child = spawn(process.execPath, ['node_modules/openclaw/openclaw.mjs', 'gateway', 'run', '--port', String(port), '--verbose'], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', b => { logs = (logs + b.toString()).slice(-12000); }); child.stderr.on('data', b => { logs = (logs + b.toString()).slice(-12000); });
let reviewer, requester, limited;
try {
  // Do not let client identity initialization compete with Gateway state bootstrap.
  const startDeadline = Date.now() + 180000;
  while (true) {
    // The listener binds before slow plugin/auth sidecars settle. Wait for the
    // public native readiness surface, not an open TCP port or longer WS timer.
    let ready = false;
    try { const response = await fetch(`http://127.0.0.1:${port}/readyz`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000), redirect: 'error' }); ready = response.ok; await response.body?.cancel(); } catch { /* startup remains pending */ }
    if (ready) break;
    if (child.exitCode !== null || Date.now() > startDeadline) throw new Error('Test Gateway did not start');
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  const { GatewayClient } = await import('openclaw/plugin-sdk/gateway-runtime');
  const buildId = JSON.parse(await fs.readFile('node_modules/openclaw/dist/build-info.json', 'utf8')).buildId;
  const events = [];
  const hello = new Promise((resolve, reject) => {
    reviewer = new GatewayClient({ url: `ws://127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, token, clientName: 'openclaw-control-ui', clientBuildId: buildId, clientDisplayName: 'JARVIS isolated policy test', mode: 'ui', role: 'operator', scopes: ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'], caps: ['plugin-approvals'], onHelloOk: resolve, onEvent: e => events.push(e), onConnectError: error => { if (child.exitCode !== null) reject(error); } });
    reviewer.start();
  });
  await Promise.race([hello, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Test Gateway startup timeout')), 45000); timer.unref(); })]);
  const connectPeer = (scopes) => new Promise(resolve => {
    const peer = new GatewayClient({ url: `ws://127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, token, clientName: 'openclaw-control-ui', clientBuildId: buildId, clientDisplayName: 'JARVIS isolated test actor', mode: 'ui', role: 'operator', scopes, caps: [], onHelloOk: () => resolve(peer) }); peer.start();
  });
  requester = await connectPeer(['operator.read', 'operator.write', 'operator.approvals']);
  limited = await connectPeer(['operator.read', 'operator.write']);
  const status = await reviewer.request('jarvis.policy.status', {});
  assert.deepEqual(status.tools, ['web_fetch']); assert.equal(status.search.depth, 'advanced'); console.log('PASS real Gateway startup, official native web profile and missing-key catalog');
  const session = await reviewer.request('sessions.create', { agentId: 'main', label: 'stage03-test' });
  const key = session.key ?? session.sessionKey;
  const target = path.join(scratch, 'project'); await fs.mkdir(target);
  try {
    const bound = await reviewer.request('jarvis.scope.bind', { sessionKey: key, agentId: 'main', runId: 'integration-run', projectId: 'integration-project', taskId: 'integration-task', role: 'project', root: target, confirmationPaths: [path.join(scratch, 'separate.txt')] });
    assert.equal(bound.bound, true); console.log('PASS actual paired-client/session scope binding');
  } catch (error) { console.log('SCOPE_BIND_BLOCKED', error.message); throw error; }
  const saved = await reviewer.request('jarvis.memory.write', { sessionKey: key, agentId: 'main', runId: 'integration-run', expectedRevision: 0, category: 'preference', content: 'Isolated stage05 fixture preference' });
  assert.equal(saved.note.origin.kind, 'user'); assert.equal(saved.note.revision, 1);
  const otherSession = await reviewer.request('sessions.create', { agentId: 'main', label: 'stage05-memory-other' });
  const otherKey = otherSession.key ?? otherSession.sessionKey;
  const shared = await requester.request('jarvis.memory.read', { sessionKey: otherKey, agentId: 'main', id: saved.note.id });
  assert.equal(shared.content, saved.note.content);
  const memoryBound = await requester.request('jarvis.scope.bind', { sessionKey: otherKey, agentId: 'main', runId: 'memory-only-integration', projectId: 'personal', taskId: 'memory-only-task', role: 'memory', userInput: 'Short test preference' });
  assert.equal(memoryBound.bound, true);
  const daily = await requester.request('jarvis.memory.write', { sessionKey: otherKey, agentId: 'main', runId: 'memory-only-integration', expectedRevision: 0, category: 'preference', content: 'Memory-only admitted fixture preference' });
  assert.equal(daily.note.origin.kind, 'user'); assert.equal(daily.note.origin.projectId, 'personal');
  await assert.rejects(reviewer.request('jarvis.memory.write', { sessionKey: key, agentId: 'main', runId: 'integration-run', id: saved.note.id, expectedRevision: 0, category: 'correction', content: 'Stale correction' }), /REVISION_CONFLICT/);
  await assert.rejects(reviewer.request('jarvis.memory.write', { sessionKey: key, agentId: 'main', runId: 'integration-run', expectedRevision: 0, category: 'preference', content: 'Spoof', userId: 'spoof' }));
  const researchSession = await reviewer.request('sessions.create', { agentId: 'research', label: 'stage05-denied' });
  await assert.rejects(reviewer.request('jarvis.memory.read', { sessionKey: researchSession.key ?? researchSession.sessionKey, agentId: 'research', id: saved.note.id }));
  const jobs = await reviewer.request('cron.list', { includeDisabled: true });
  const dream = jobs.jobs.find(j => j.declarationKey?.includes('memory') || j.name === 'Memory Dreaming Promotion');
  assert.ok(dream); assert.equal(dream.schedule.expr, '0 */6 * * *'); assert.equal(dream.schedule.tz, 'Europe/Istanbul'); assert.equal(dream.payload.lightContext, true);
  console.log('PASS real admitted note write/CAS, shared chat read, researcher denial and native six-hour Dreaming schedule');
  // The actual loaded JARVIS hook runs in the actual Gateway. The test-only RPC
  // drives its deferred snapshot through authenticated core registry dispatch.
  const separate = path.join(scratch, 'separate.txt');
  for (const decision of ['allow-always', 'deny', 'allow-once']) {
    const execution = requester.request('jarvis_test.probe', { sessionKey: key, agentId: 'main', runId: 'integration-run', toolCallId: `integration-${decision}`, path: separate, content: 'fixed preview' }, { timeoutMs: 70000 });
    const event = await Promise.race([new Promise(resolve => {
      const timer = setInterval(() => { const e = events.find(e => e.event === 'plugin.approval.requested' && e.payload?.request?.toolCallId === `integration-${decision}`); if (e) { clearInterval(timer); resolve(e); } }, 100); timer.unref();
    }), execution.then(result => { throw new Error(`Probe returned before approval event: ${result.reason ?? result.decision}`); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('No approval event')), 20000); timer.unref(); })]);
    const id = event.payload.id;
    const pending = await reviewer.request('approval.get', { id });
    assert.equal(pending.approval.status, 'pending');
    assert.deepEqual(event.payload.request.allowedDecisions, ['allow-once', 'deny']);
    await assert.rejects(fs.access(separate)); // no effect before real verdict
    await assert.rejects(limited.request('approval.resolve', { id, kind: 'plugin', decision: 'allow-once' }));
    await reviewer.request('approval.resolve', { id, kind: 'plugin', decision });
    const result = await execution;
    assert.equal(result.blocked, decision !== 'allow-once');
    if (decision === 'allow-once') assert.equal(await fs.readFile(separate, 'utf8'), 'fixed preview');
    else await assert.rejects(fs.access(separate));
    console.log(`PASS requireApproval -> native registry -> ${decision}: ${result.blocked ? 'no write' : 'fixed write executed'}`);
  }
} catch (error) {
  // No credential, raw config or auth output in failure diagnostics.
  console.error('INTEGRATION_FAILED', error.message.replaceAll(token, '[redacted]'));
  console.error(logs.replaceAll(token, '[redacted]').slice(-4000));
  process.exitCode = 1;
} finally {
  reviewer?.stop();
  requester?.stop(); limited?.stop();
  if (child.exitCode === null) {
    child.kill('SIGTERM'); // exact spawned disposable test PID only
    await new Promise(resolve => child.once('exit', resolve));
  }
  const rel = path.relative(path.resolve('tmp'), scratch);
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
  // SDK's process-local SQLite handles close at process exit on Windows.
  // The invoking shell removes this exact verified test path after exit.
  console.log('TEST_PROFILE_TO_REMOVE', scratch);
}
