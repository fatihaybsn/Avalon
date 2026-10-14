import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkLedger, ResourceOwners, installWork, publicRecord } from '../plugins/jarvis/work.ts';
import { workNoteParams } from '../plugins/jarvis/policy.ts';

function store() {
  const rows = new Map();
  return {
    rows,
    async registerIfAbsent(k, v) { if (rows.has(k)) return false; rows.set(k, structuredClone(v)); return true; },
    async lookup(k) { return structuredClone(rows.get(k)); },
    async update(k, fn) { const v = fn(structuredClone(rows.get(k))); if (v !== undefined) rows.set(k, structuredClone(v)); return v !== undefined; },
    async entriesInKeyRange(p) { return [...rows].filter(([k]) => k >= p.keyStartInclusive && k < p.keyEndExclusive).sort(([a], [b]) => a.localeCompare(b)).slice(0, p.limit).map(([key, value]) => ({ key, value: structuredClone(value) })); }
  };
}
const scope = { runId: 'native-run', taskId: 'task', projectId: 'project', userId: 'owner', deviceId: 'device', agentId: 'main', sessionId: 'sid', sessionKey: 'agent:main:jarvis:test', role: 'memory', expiresAt: Date.now() + 60000, urls: [], confirmationPaths: [] };
function setup(requestOverride) {
  const stores = new Map(), hooks = {}, methods = {}, subscriptions = [], abort = new AbortController(); let valid = true;
  const binding = { scope: { ...scope }, signal: abort.signal, assertCurrent() { if (!valid || abort.signal.aborted) throw new Error('revoked'); } };
  const live = run => run === scope.runId && valid && !abort.signal.aborted ? binding : undefined;
  const requests = [];
  const request = requestOverride ?? (async (name, params) => {
    requests.push({ name, params });
    if (name === 'sessions.describe') return { sessionId: scope.sessionId, hasActiveRun: false, activeRunIds: [] };
    if (name === 'chat.send') return { runId: params.idempotencyKey, status: 'started' };
    if (name === 'chat.abort') return { aborted: true, runIds: [scope.runId] };
  });
  const api = { runtime: { state: { openKeyedStore(opts) { assert.equal(opts.retention, 'retained'); assert.equal(opts.maxEntries, undefined); assert.equal(opts.defaultTtlMs, undefined); if (!stores.has(opts.namespace)) stores.set(opts.namespace, store()); return stores.get(opts.namespace); } }, subagent: { run: async p => { requests.push({ name: 'subagent.run', params: p }); return { runId: p.idempotencyKey, sessionKey: p.sessionKey }; }, getSessionMessages: async () => ({ messages: [{ role: 'thinking', content: 'private' }, { role: 'toolResult', toolCallId: 'real-call', content: [{ type: 'text', text: 'actual output' }] }] }) } }, logger: { error() {} }, registerGatewayMethod(n, fn) { methods[n] = fn; }, agent: { events: { registerAgentEventSubscription(s) { subscriptions.push(s); } } }, on(n, fn) { hooks[n] = fn; } };
  const work = installWork(api, live, request);
  const client = { authenticatedUserId: scope.userId, connect: { role: 'operator', scopes: ['operator.read', 'operator.write'], device: { id: scope.deviceId } } };
  async function invoke(name, p = {}, user = client, withAccess = true) {
    let response;
    await methods[`jarvis.work.${name}`]({ req: { method: `jarvis.work.${name}` }, params: { sessionKey: binding.scope.sessionKey, agentId: 'main', ...p }, client: user, sessionAccessAuthority: withAccess ? { target: { ...binding.scope }, assertCurrent: binding.assertCurrent } : undefined, respond(...r) { response = r; } });
    return response;
  }
  return { work, binding, invoke, hooks, subscriptions, stores, requests, abort, revoke() { valid = false; } };
}

test('retained metadata is stable, CAS revisions reject stale updates, duplicate events do not increment work', async () => {
  const s = store(), j = store(), p = store(), l = new WorkLedger(s, j, p);
  const r = await l.create(scope, 'source request'); assert.equal(r.record.acceptedPlan, 'source request');
  await l.change('owner', 'task', 'native:1', 'native-tool', {}, v => { v.state = 'running'; });
  const duplicate = await l.change('owner', 'task', 'native:1', 'native-tool', {}, () => { throw new Error('duplicate ran'); });
  assert.equal(duplicate.changed, false); assert.equal(duplicate.record.recordVersion, 2); assert.equal(j.rows.size, 1);
  await assert.rejects(l.create({ ...scope, runId: 'another' }, 'source request'), /identity/);
  await assert.rejects(l.get('other', 'task'), /unavailable/);
  const next = new WorkLedger(s, j, p); const old = await next.get('owner', 'task');
  assert.equal(old.runId, 'native-run'); const reconciled = await next.reconcile(old, { sessionId: 'sid', activeRunIds: [] });
  assert.equal(reconciled.state, 'unknown'); assert.match(reconciled.blocker, /not proven/);
});

test('start uses documented native dispatch once and never replays an ambiguous write', async () => {
  const x = setup(); const a = await x.invoke('start', { runId: scope.runId, message: 'source request' });
  assert.equal(a[0], true); assert.equal(a[1].record.state, 'delivered');
  assert.equal(x.requests.filter(r => r.name === 'chat.send').length, 1);
  const dup = await x.invoke('start', { runId: scope.runId, message: 'source request' });
  assert.equal(dup[0], true); assert.equal(dup[1].dispatched, false);
  assert.equal(x.requests.filter(r => r.name === 'chat.send').length, 1);
  let calls = 0;
  const y = setup(async name => { if (name === 'sessions.describe') return { sessionId: 'sid' }; calls++; throw new Error('timeout'); });
  assert.equal((await y.invoke('start', { runId: scope.runId, message: 'source request' }))[0], false);
  assert.equal((await y.invoke('start', { runId: scope.runId, message: 'source request' }))[1].dispatched, false);
  assert.equal(calls, 1); assert.equal((await y.work.ledger.get('owner', 'task')).state, 'unknown');
});

test('independent work requires a fresh native child, invokes existing subagent and retains parent work', async () => {
  const x = setup(); assert.equal((await x.invoke('start', { runId: scope.runId, message: 'test', independent: true }))[0], false);
  x.binding.scope.sessionKey = 'agent:main:subagent:jarvis:separate';
  const a = await x.invoke('start', { runId: scope.runId, message: 'test', independent: true });
  assert.equal(a[0], true); assert.equal(x.requests.at(-1).name, 'subagent.run');
  assert.equal(x.requests.some(r => /abort|steer/.test(r.name)), false);
  assert.equal(x.requests.at(-1).params.model, undefined);
});

test('host lifecycle/tool evidence persists without model reports; missing result/error absence proves nothing', async () => {
  const x = setup(); await x.work.ledger.create(scope, 'test');
  await x.subscriptions[0].handle({ runId: scope.runId, sessionId: scope.sessionId, seq: 1, stream: 'lifecycle', data: { phase: 'start', reasoning: 'private', stdout: 'hidden' } });
  assert.equal((await x.work.ledger.get('owner', 'task')).state, 'running');
  const e = { toolName: 'read', toolCallId: 'call', params: {}, runId: scope.runId };
  await x.hooks.after_tool_call(e, {}); const missing = await x.work.ledger.get('owner', 'task');
  assert.equal(missing.operation.phase, 'missing'); assert.equal(missing.operation.effect, 'unverified');
  await x.hooks.after_tool_call(e, {}); assert.equal((await x.work.ledger.get('owner', 'task')).recordVersion, missing.recordVersion);
  await x.hooks.after_tool_call({ ...e, toolCallId: 'next', result: { content: [], isError: true } }, {});
  assert.equal((await x.work.ledger.get('owner', 'task')).operation.phase, 'error');
  await x.hooks.agent_end({ runId: scope.runId, success: true, messages: [{ reasoning: 'hidden' }] }, {});
  const ended = await x.work.ledger.get('owner', 'task'); assert.equal(ended.result, 'native-ended'); assert.equal(ended.model, undefined);
  assert.equal(JSON.stringify([...x.stores.values()].map(s => [...s.rows.values()])).includes('private'), false);
  assert.equal(JSON.stringify(publicRecord(ended)).includes('owner'), false);
});

test('real file effects are verified separately and shared file writes block while an exact call owns the file', async () => {
  await fs.mkdir('tmp', { recursive: true }); const root = await fs.mkdtemp(path.resolve('tmp', 'stage06-work-'));
  const target = path.join(root, 'result.txt'); const x = setup(); x.binding.scope.role = 'project'; x.binding.scope.root = root;
  await x.work.ledger.create(x.binding.scope, 'test');
  const e = { toolName: 'write', toolCallId: 'write', params: { path: target, content: 'fixed effect' } };
  await x.work.beforeTool(e, { runId: scope.runId });
  await assert.rejects(x.work.beforeTool({ ...e, toolCallId: 'another' }, { runId: scope.runId }), /busy/);
  await fs.writeFile(target, 'fixed effect'); await x.hooks.after_tool_call({ ...e, runId: scope.runId, result: { content: [{ text: 'reported' }] } }, {});
  assert.equal((await x.work.ledger.get('owner', 'task')).operation.effect, 'verified'); assert.equal(x.work.owners.snapshot().length, 0);
  await x.work.beforeTool({ ...e, toolCallId: 'failed' }, { runId: scope.runId });
  await x.hooks.after_tool_call({ ...e, toolCallId: 'failed', runId: scope.runId, result: undefined }, {});
  assert.equal((await x.work.ledger.get('owner', 'task')).operation.effect, 'unverified');
  x.abort.abort(); assert.equal(x.work.owners.snapshot().length, 0);
  await fs.unlink(target); await fs.rmdir(root);
});

test('mouse/keyboard is exclusive; separate tabs/files are independent; revoked owners and cancellation release leases', () => {
  const l = new ResourceOwners(), a = new AbortController(); let current = true;
  const assertion = () => { if (!current) throw new Error('revoked'); };
  l.claim(['input:mouse-keyboard', 'window:17'], 'one', 'c1', assertion, a.signal);
  assert.throws(() => l.claim(['input:mouse-keyboard'], 'two', 'c2', () => {}), /busy/);
  l.claim(['browser:profile-a:tab-1'], 'two', 'c2', () => {});
  l.claim(['browser:profile-a:tab-2'], 'three', 'c3', () => {});
  current = false; l.claim(['input:mouse-keyboard'], 'two', 'c4', () => {});
  l.releaseRun('two'); a.abort(); assert.equal(l.snapshot().length, 1);
  l.releaseRun('three'); assert.equal(l.snapshot().length, 0);
});

test('model schema cannot forge host state, worker identity, accepted plan, grants, hidden reasoning or applied status', () => {
  for (const field of ['state', 'result', 'acceptedPlan', 'worker', 'grant', 'reasoning', 'applied']) assert.throws(() => workNoteParams({ expectedRevision: 1, [field]: 'forged' }));
  assert.deepEqual(workNoteParams({ expectedRevision: 1, finding: 'bounded finding', nextStep: 'next' }), { expectedRevision: 1, finding: 'bounded finding', nextStep: 'next' });
});

test('project admission revision is shared while task/worker identity and revision stay independent', async () => {
  const x = setup(); await x.work.ledger.create(scope, 'first');
  await x.work.ledger.create({ ...scope, taskId: 'second', runId: 'second-native-run', sessionId: 'second-native-session' }, 'second');
  const first = await x.work.ledger.get('owner', 'task'), second = await x.work.ledger.get('owner', 'second');
  assert.equal(first.projectId, second.projectId); assert.equal(first.projectRevision, 1); assert.equal(second.projectRevision, 2);
  assert.equal(second.revision, 1); assert.notEqual(first.sessionId, second.sessionId);
  await x.work.linkWorker(scope.runId, { threadId: 'actual-thread', turnId: 'actual-turn', sessionId: 'actual-worker-session' });
  const bound = await x.work.ledger.get('owner', 'task'); assert.equal(bound.worker.threadId, 'actual-thread'); assert.equal(bound.projectId, first.projectId);
  x.revoke(); await assert.rejects(x.work.linkWorker(scope.runId, { turnId: 'forged' }), /owner/);
});

test('explicit steering increments revisions, keeps admission separate from application, rejects another input identity', async () => {
  const requests = [], x = setup(async (name, params) => {
    requests.push({ name, params });
    if (name === 'sessions.describe') return { sessionId: 'sid', activeRunIds: [scope.runId], hasActiveRun: true };
    if (name === 'agent.wait') return { status: 'timeout' };
    if (name === 'chat.send') return { runId: params.idempotencyKey, status: 'started' };
  });
  await x.work.ledger.create(scope, 'source');
  const a = await x.invoke('steer', { taskId: 'task', expectedRevision: 1, inputId: 'change', message: 'Use the smaller patch\nPreserve tests' });
  assert.equal(a[0], true); assert.equal(a[1].record.revision, 2); assert.equal(a[1].record.projectRevision, 2);
  assert.equal(a[1].record.steering.change.stage, 'accepted'); assert.equal(a[1].record.result, 'unverified');
  assert.equal(requests.filter(r => r.name === 'chat.send')[0].params.queueMode, 'steer');
  await x.work.beforeTool({ toolName: 'read', toolCallId: 'new-op', params: {} }, { runId: scope.runId });
  await x.work.confirmSteer(scope.runId, 'change', 'new-op', 'applying', () => {});
  await assert.rejects(x.work.confirmSteer(scope.runId, 'change', 'new-op', 'applied', () => {}), /unverified/);
  assert.equal((await x.work.ledger.get('owner', 'task')).steering.change.stage, 'applying');
  assert.equal((await x.invoke('steer', { taskId: 'task', expectedRevision: 2, inputId: 'change', message: 'another message' }))[0], false);
  assert.equal(requests.filter(r => r.name === 'chat.send').length, 1);
});

test('an old tool result stays associated with its start revision after a user steer; missing/error never verify effect', async () => {
  const x = setup(); await x.work.ledger.create(scope, 'test');
  await x.work.beforeTool({ toolName: 'read', toolCallId: 'old-call', params: {} }, { runId: scope.runId });
  await x.work.ledger.change('owner', 'task', 'new-revision', 'user-direction', {}, r => { r.revision = 2; });
  await x.hooks.after_tool_call({ toolName: 'read', toolCallId: 'old-call', runId: scope.runId, params: {}, result: { content: [] } }, {});
  const r = await x.work.ledger.get('owner', 'task'); assert.equal(r.revision, 2); assert.equal(r.operation.revision, 1); assert.equal(r.operation.effect, 'unverified');
  await x.hooks.agent_end({ runId: scope.runId, success: true, error: 'reported error', messages: [] }, {});
  assert.equal((await x.work.ledger.get('owner', 'task')).result, 'native-error');
});

test('read retrieves the actual selected tool output without waiting for Memory Core; status remains model-free', async () => {
  const x = setup(); await x.work.ledger.create(scope, 'test');
  await x.hooks.after_tool_call({ runId: scope.runId, toolCallId: 'real-call', toolName: 'read', params: {}, result: { content: [] } }, {});
  const a = await x.invoke('read', { taskId: scope.taskId, callId: 'real-call' }, undefined, false);
  assert.equal(a[0], true); assert.equal(a[1].output.role, 'toolResult'); assert.equal(a[1].output.content[0].text, 'actual output');
  assert.equal(JSON.stringify(a).includes('private'), false); assert.equal(a[1].pauseSupported, false);
  assert.equal(x.requests.some(r => /memory|dream|chat.send/.test(r.name)), false);
});

test('cancel and steering cannot borrow another task grant; stale revision and machine-wide lock names do not authorize actions', async () => {
  const x = setup(); await x.work.ledger.create(scope, 'test');
  x.binding.scope.taskId = 'different';
  assert.equal((await x.invoke('cancel', { taskId: scope.taskId, expectedRevision: 1 }))[0], false);
  assert.equal(x.requests.some(r => r.name === 'chat.abort'), false);
  x.binding.scope.taskId = scope.taskId;
  assert.equal((await x.invoke('cancel', { taskId: scope.taskId, expectedRevision: 2 }))[0], false);
  const ok = await x.invoke('cancel', { taskId: scope.taskId, expectedRevision: 1 }); assert.equal(ok[0], true); assert.equal(ok[1].record.state, 'cancelled');
});
