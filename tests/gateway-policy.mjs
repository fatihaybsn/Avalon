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
config.plugins.entries['jarvis-policy-test'] = { enabled: true, hooks: { allowConversationAccess: true, allowPromptInjection: true } };
await fs.writeFile(configPath, JSON.stringify(config));
const env = { ...process.env, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_STATE_DIR: scratch, OPENCLAW_GATEWAY_TOKEN: token };
env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --max-semi-space-size=4`.trim();
delete env.OPENCODE_API_KEY; delete env.GEMINI_API_KEY;
delete env.TAVILY_API_KEY;
process.env.OPENCLAW_CONFIG_PATH = configPath; process.env.OPENCLAW_STATE_DIR = scratch; process.env.OPENCLAW_GATEWAY_TOKEN = token;
const child = spawn(process.execPath, ['node_modules/openclaw/openclaw.mjs', 'gateway', 'run', '--port', String(port), '--verbose'], { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', b => { logs = (logs + b.toString()).slice(-12000); }); child.stderr.on('data', b => { logs = (logs + b.toString()).slice(-12000); });
let reviewer, requester, limited;
try {
  // Do not let client identity initialization compete with Gateway state bootstrap.
  const startDeadline = Date.now() + 300000;
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
  if (!process.argv.includes('--work-only')) {
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
  }
  const workSession = await reviewer.request('sessions.create', { agentId: 'main', label: 'stage06-native-work' });
  const workKey = workSession.key ?? workSession.sessionKey, runId = 'stage06-native-run', taskId = 'stage06-native-task';
  await reviewer.request('jarvis.scope.bind', { sessionKey: workKey, agentId: 'main', runId, taskId, projectId: 'stage06-project', role: 'project', root: target });
  await reviewer.request('jarvis_test.arm', { sessionKey: workKey, agentId: 'main', runId });
  const started = await reviewer.request('jarvis.work.start', { sessionKey: workKey, agentId: 'main', runId, message: `STAGE06_HOST_TEST_ONLY:${runId}` });
  assert.equal(started.dispatched, true); assert.equal(started.record.runId, runId);
  const waitHeld = async id => {
    const deadline = Date.now() + 90000;
    while (!(await reviewer.request('jarvis_test.hold-status', { runId: id })).held) { assert.ok(Date.now() < deadline, 'Provider-free fixture did not capture native run'); await new Promise(r => setTimeout(r, 100)); }
  };
  await waitHeld(runId);
  const file = path.join(target, 'stage06.txt');
  const effect = await reviewer.request('jarvis_test.work-effect', { sessionKey: workKey, agentId: 'main', runId, toolCallId: 'stage06-write', path: file, content: 'Stage06 actual native host effect' });
  assert.equal(effect.written, true);
  const read = await requester.request('jarvis.work.read', { sessionKey: workKey, agentId: 'main', taskId });
  assert.equal(read.record.operation.effect, 'verified'); assert.equal(read.record.operation.phase, 'result');
  assert.equal(read.record.model, undefined); assert.equal(read.pauseSupported, false);
  await reviewer.request('jarvis_test.work-effect', { sessionKey: workKey, agentId: 'main', runId, toolCallId: 'stage06-write', path: file, content: 'Stage06 actual native host effect', replayResult: true });
  const duplicate = await requester.request('jarvis.work.read', { sessionKey: workKey, agentId: 'main', taskId });
  assert.equal(duplicate.record.recordVersion, read.record.recordVersion);
  await assert.rejects(reviewer.request('jarvis.work.steer', { sessionKey: workKey, agentId: 'main', taskId, expectedRevision: 99, inputId: 'stale', message: 'stale revision' }));
  const childKey = 'agent:main:subagent:jarvis:stage06-independent';
  await reviewer.request('sessions.create', { key: childKey, agentId: 'main', displayName: 'Stage06 native independent child' });
  await reviewer.request('jarvis.scope.bind', { sessionKey: childKey, agentId: 'main', runId: 'stage06-child-run', taskId: 'stage06-child-task', projectId: 'stage06-project', role: 'project', root: target });
  const childStarted = await reviewer.request('jarvis.work.start', { sessionKey: childKey, agentId: 'main', runId: 'stage06-child-run', message: 'STAGE06_HOST_TEST_ONLY', independent: true });
  assert.equal(childStarted.dispatched, true); assert.equal(childStarted.record.runId, 'stage06-child-run');
  assert.equal((await reviewer.request('jarvis_test.hold-status', { runId })).held, true, 'Independent child cancelled its parent');
  const childWait = await reviewer.request('agent.wait', { runId: 'stage06-child-run', timeoutMs: 30000 });
  assert.equal(childWait.status, 'error'); // Catalog/provider intentionally unavailable in the disposable child profile.
  const childRead = await reviewer.request('jarvis.work.read', { sessionKey: childKey, agentId: 'main', taskId: 'stage06-child-task' });
  assert.equal(childRead.record.result, 'native-error');
  await reviewer.request('jarvis_test.release', { runId });
  await reviewer.request('agent.wait', { runId, timeoutMs: 30000 });
  const beforeReload = await reviewer.request('jarvis.work.read', { sessionKey: workKey, agentId: 'main', taskId });
  await reviewer.request('plugins.reload', { plugins: [{ pluginId: 'jarvis' }] });
  const retained = await reviewer.request('jarvis.work.read', { sessionKey: workKey, agentId: 'main', taskId });
  assert.equal(retained.record.taskId, taskId); assert.equal(retained.record.operation.effect, 'verified');
  assert.notEqual(retained.record.result, 'success'); assert.equal(retained.record.request, beforeReload.record.request);
  console.log('PASS stage06 real native dispatch, retained metadata/project revision, host hook/actual effect, duplicate identity, independent subagent/parent isolation, explicit child failure, stale steer and reload without replay; parent provider gated, no successful model claimed');
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
