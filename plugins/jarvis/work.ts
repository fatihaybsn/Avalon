import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { dispatchGatewayMethod } from 'openclaw/plugin-sdk/gateway-method-runtime';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { exactKeys, text, workText, safePath, fingerprint, type Scope } from './policy.ts';
import {isGuiTool} from './gui-policy.ts';

export type WorkRecord = {
  taskId: string; projectId: string; projectRevision: number; revision: number; recordVersion: number;
  userId: string; deviceId: string; agentId: string; sessionKey: string; sessionId: string;
  runId: string; worker?: { threadId?: string; turnId?: string; sessionId?: string; agentId?: string; sessionKey?: string; runId?: string; itemId?: string; requestId?: string | number };
  execution?: 'local' | 'codex';
  request: string; acceptedPlan?: string; model?: { plan?: string; finding?: string; sources?: string[]; rationale?: string; nextStep?: string; pendingDecision?: string };
  state: 'prepared' | 'delivered' | 'running' | 'ended' | 'failed' | 'cancel-requested' | 'cancelled' | 'unknown';
  operation?: { callId: string; tool: string; revision?: number; phase: 'observed' | 'started' | 'result' | 'error' | 'missing'; resultHash?: string; effect: 'unverified' | 'verified'; sources?: string[] };
  result: 'unverified' | 'native-ended' | 'native-error' | 'cancelled'; blocker?: string;
  steering: Record<string, { text: string; revision: number; stage: 'delivered' | 'accepted' | 'applying' | 'applied' | 'unknown' | 'rejected'; nativeInputId?: string; modelClaim?: string }>;
  generation: string; updatedAt: string; nativeSequence?: number; seen: Record<string, { revision: number; at: string; digest: string }>;
};
function openStore<T>(api: OpenClawPluginApi, namespace: string) { return api.runtime.state.openKeyedStore<T>({ namespace, retention: 'retained' }); }
type Store<T> = ReturnType<typeof openStore<T>>;
type Journal = { taskId: string; revision: number; at: string; kind: string; data: Record<string, unknown> };
type ProjectRecord = { projectId: string; userId: string; revision: number; updatedAt: string; changes: Record<string, number> };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const prefix = (user: string) => `u:${hash(user)}:t:`;
const key = (user: string, task: string) => prefix(user) + hash(task);
const now = () => new Date().toISOString();
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const terminal = (r: WorkRecord) => ['ended', 'failed', 'cancelled'].includes(r.state);
async function nativeRequest<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T> {
  const result = await dispatchGatewayMethod(method, params);
  if (!result.ok) throw new Error(`${result.error?.code ?? 'UNAVAILABLE'}: ${result.error?.message ?? 'Native request failed'}`);
  return result.payload as T;
}

// An observation adapter over the existing plugin state table. No dispatcher,
// replay loop, job queue, model selection, or persisted executable grants.
export class WorkLedger {
  readonly generation = randomUUID();
  readonly store: Store<WorkRecord>;
  readonly journal: Store<Journal>;
  readonly projects: Store<ProjectRecord>;
  constructor(store: Store<WorkRecord>, journal: Store<Journal>, projects: Store<ProjectRecord>) {
    this.store = store; this.journal = journal; this.projects = projects;
    if (!store.update || !store.entriesInKeyRange) throw new Error('Native retained state/update/range capabilities required');
  }
  async projectRevision(userId: string, projectId: string, changeId: string) {
    if (!this.projects.update) throw new Error('Native atomic project metadata update unavailable');
    let revision = 0;
    await this.projects.update!(key(userId, projectId), old => {
      const p = old ?? { userId, projectId, revision: 0, updatedAt: now(), changes: {} };
      const change = hash(changeId);
      if (p.changes[change]) { revision = p.changes[change]; return undefined; }
      p.revision++; p.updatedAt = now(); p.changes[change] = p.revision; revision = p.revision; return p;
    });
    return revision;
  }
  async create(scope: Scope, request: string) {
    const r: WorkRecord = { taskId: scope.taskId, projectId: scope.projectId, projectRevision: 0, revision: 1, recordVersion: 1, userId: scope.userId, deviceId: scope.deviceId, agentId: scope.agentId, sessionKey: scope.sessionKey, sessionId: scope.sessionId, runId: scope.runId, request, acceptedPlan: request, state: 'prepared', result: 'unverified', steering: {}, generation: this.generation, updatedAt: now(), seen: {} };
    const created = await this.store.registerIfAbsent(key(scope.userId, scope.taskId), r);
    if (!created) {
      const old = await this.get(scope.userId, scope.taskId);
      if (old.runId !== scope.runId || old.sessionId !== scope.sessionId || old.request !== request || old.projectId !== scope.projectId) throw new Error('Task identity already used; no replay');
    }
    else {
      const projectRevision = await this.projectRevision(scope.userId, scope.projectId, `task:${scope.taskId}`);
      await this.store.update!(key(scope.userId, scope.taskId), record => { if (!record) throw new Error('Task metadata unavailable'); record.projectRevision = projectRevision; return record; });
    }
    return { created, record: await this.get(scope.userId, scope.taskId) };
  }
  async get(user: string, task: string) {
    const r = await this.store.lookup(key(user, task));
    if (!r || r.userId !== user) throw new Error('Task unavailable to this principal');
    return r;
  }
  async list(user: string, after = '') {
    const p = prefix(user);
    if (after && (!after.startsWith(p) || after.length !== p.length + 64)) throw new Error('Invalid record cursor');
    const rows = await this.store.entriesInKeyRange!({ keyStartInclusive: after ? after + '\0' : p, keyEndExclusive: p + '\uffff', limit: 50, order: 'asc' });
    return { records: rows.map(e => e.value), cursor: rows.length === 50 ? rows.at(-1)!.key : undefined };
  }
  async change(user: string, task: string, eventId: string, kind: string, data: Record<string, unknown>, apply: (r: WorkRecord) => void, assertCurrent: () => void = () => {}) {
    assertCurrent();
    data = json(data); // Native state rejects undefined, even in optional metadata.
    let changed = false; let stamp: WorkRecord['seen'][string] | undefined;
    const digest = fingerprint({ kind, data });
    // Supported native atomic updater: the callback is synchronous and small.
    // No async read/write pair can lose a racing host observation or revision.
    await this.store.update!(key(user, task), r => {
      assertCurrent();
      if (!r) throw new Error('Missing native task metadata');
      if (r.seen[eventId]) { stamp = r.seen[eventId]; if (stamp.digest !== digest) throw new Error('Conflicting duplicate host event'); return undefined; }
      apply(r); r.recordVersion++; r.updatedAt = now(); stamp = { revision: r.revision, at: r.updatedAt, digest }; r.seen[eventId] = stamp; changed = true; return json(r);
    });
    const r = await this.get(user, task);
    // Retained journal and summary are intentionally not a second task engine.
    // A failed journal write is surfaced; a duplicate can repair the journal.
    await this.journal.registerIfAbsent(`${key(user, task)}:e:${hash(eventId)}`, { taskId: task, revision: stamp!.revision, at: stamp!.at, kind, data });
    return { changed, record: r };
  }
  async reconcile(r: WorkRecord, native: { sessionId?: unknown; hasActiveRun?: unknown; activeRunIds?: unknown; run?: Record<string, unknown> }) {
    if (terminal(r)) return r;
    const different = r.generation !== this.generation;
    const sameSession = native.sessionId === (r.execution === 'codex' ? r.worker?.sessionId : r.sessionId);
    const run = native.run;
    const finished = sameSession && run && ['ok', 'error'].includes(String(run.status)) && typeof run.endedAt === 'number';
    const active = sameSession && Array.isArray(native.activeRunIds) && native.activeRunIds.includes(r.execution === 'codex' ? r.worker?.runId : r.runId);
    if (!different && (active || run?.status === 'pending')) return r;
    const data = { different, sameSession, active, status: run?.status, endedAt: run?.endedAt, stopReason: run?.stopReason };
    return (await this.change(r.userId, r.taskId, `reconcile:${this.generation}:${fingerprint(data)}`, 'native-reconciliation', data, current => {
      current.state = finished ? run.status === 'ok' ? 'ended' : 'failed' : 'unknown';
      if (finished) current.result = run.status === 'ok' ? 'native-ended' : 'native-error';
      current.blocker = finished ? run.stopReason ? `Native terminal reason: ${String(run.stopReason).slice(0, 100)}` : undefined : !sameSession ? 'Native session incarnation changed; old authority expired' : active ? 'Native run observed; previous tool/process authority is not restored' : 'Previous run not proven live; inspect native history before continuing';
      current.generation = this.generation;
    })).record;
  }
}

// Process-local leases only. The live 03 capability is checked on every claim;
// task labels and retained rows never grant access. Resource identities are
// exact files/targets, with one global input owner only for mouse/keyboard.
export class ResourceOwners {
  private held = new Map<string, { runId: string; callId: string; assertCurrent: () => void; signal?: AbortSignal; cleanup: () => void }>();
  claim(resources: string[], runId: string, callId: string, assertCurrent: () => void, signal?: AbortSignal) {
    assertCurrent(); if (signal?.aborted) throw new Error('Invocation cancelled');
    if (resources.some(r => !['input:mouse-keyboard','system:default-audio','system:active-power-plan'].includes(r) && !/^(file|window|browser):\S.{0,2047}$/.test(r))) throw new Error('Exact host resource identity required; application-wide locks unavailable');
    for(const [key,owner] of this.held)try{owner.assertCurrent();if(owner.signal?.aborted)throw new Error('Expired');}catch{owner.cleanup();this.held.delete(key);}
    for (const resource of resources) {
      const old = this.held.get(resource);
      if (old) { try { old.assertCurrent(); if (old.signal?.aborted) throw new Error('Expired'); } catch { old.cleanup(); this.held.delete(resource); } }
      const current = this.held.get(resource);
      if (current && (current.runId !== runId || current.callId !== callId)) throw new Error(`Shared resource busy: ${resource}`);
      if(resource.startsWith('file:')) for(const [other,owner] of this.held) {
        if(!other.startsWith('file:') || owner.runId===runId&&owner.callId===callId)continue;
        const a=resource.toLowerCase(),b=other.toLowerCase();
        if(a.startsWith(b+'\\') || b.startsWith(a+'\\'))throw new Error(`Overlapping file subtree busy: ${resource}`);
      }
    }
    for (const resource of resources) {
      const onAbort = () => this.releaseCall(runId, callId);
      this.held.get(resource)?.cleanup(); this.held.set(resource, { runId, callId, assertCurrent, signal, cleanup: () => signal?.removeEventListener('abort', onAbort) });
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  }
  releaseCall(run: string, call: string) { for (const [k, v] of this.held) if (v.runId === run && v.callId === call) { v.cleanup(); this.held.delete(k); } }
  releaseRun(run: string) { for (const [k, v] of this.held) if (v.runId === run) { v.cleanup(); this.held.delete(k); } }
  snapshot() { return [...this.held].map(([resource, owner]) => ({ resource, runId: owner.runId, callId: owner.callId })); }
}

export function installWork(api: OpenClawPluginApi, live: (runId?: string) => { scope: Scope; assertCurrent: () => void; signal: AbortSignal } | undefined, request = nativeRequest) {
  const ledger = new WorkLedger(openStore<WorkRecord>(api, 'work-records'), openStore<Journal>(api, 'work-evidence'), openStore<ProjectRecord>(api, 'work-projects'));
  const owners = new ResourceOwners();
  const expected = new Map<string, { target: string; digest: string }>();
  let observationError = false;
  let workerInterrupt: ((runId: string) => Promise<unknown>) | undefined;
  const fail = (e: unknown) => { observationError = true; api.logger.error(`JARVIS work observation unavailable: ${e instanceof Error ? e.message : 'native state failed'}`); };
  const mutate = async (runId: string, id: string, kind: string, data: Record<string, unknown>, update: (r: WorkRecord) => void) => {
    const binding = live(runId); if (!binding) return;
    const scope = binding.scope;
    const r = await ledger.store.lookup(key(scope.userId, scope.taskId)); if (!r) return;
    if (r.runId !== runId || r.sessionId !== scope.sessionId) return;
    return ledger.change(scope.userId, scope.taskId, id, kind, data, update);
  };
  const nativeObservation = async (r: WorkRecord) => {
    let native: Record<string, unknown>;
    try { native = await request<Record<string, unknown>>('sessions.describe', { key: r.execution === 'codex' ? r.worker?.sessionKey : r.sessionKey, agentId: r.execution === 'codex' ? r.worker?.agentId : r.agentId }); }
    catch { return { nativeUnavailable: true }; } // Original principal's retained metadata survives deleted/unreadable native rows.
    const row = (native.session ?? native) as Record<string, unknown>;
    if (!terminal(r) && r.execution !== 'local') {
      try { row.run = await request<Record<string, unknown>>('agent.wait', { runId: r.execution === 'codex' ? r.worker?.runId : r.runId, timeoutMs: 0 }); }
      catch { row.run = { status: 'unavailable' }; }
    }
    return row;
  };
  const method: Parameters<OpenClawPluginApi['registerGatewayMethod']>[1] = async options => {
    const { params, client, respond, sessionAccessAuthority: access, req } = options;
    try {
      const user = client?.authenticatedUserProfile?.profileId ?? client?.authenticatedUserId;
      if (!user || !client?.connect.device?.id || client.invalidated || client.connect.role !== 'operator') throw new Error('Authenticated operator session required');
      const current = () => { access?.assertCurrent(); if (client.invalidated) throw new Error('Operator disconnected/revoked'); };
      current();
      const name = req.method;
      const write = !['jarvis.work.read', 'jarvis.work.status'].includes(name);
      if (write && !access) throw new Error('Native write session authority required');
      if (write && !client.connect.scopes?.includes('operator.write')) throw new Error('Write scope required');
      if (name === 'jarvis.work.status' && params.taskId === undefined) {
        exactKeys(params, ['sessionKey', 'agentId', 'cursor']);
        const result = await ledger.list(user, params.cursor === undefined ? '' : text(params.cursor, 'cursor'));
        const records: WorkRecord[] = [];
        for (const r of result.records) {
          // Check canonical native read visibility per record, never expose all
          // rows just because the caller can read the selected conversation.
          const native = await nativeObservation(r);
          records.push(await ledger.reconcile(r, native));
        }
        const runs = new Set(records.map(r => r.runId));
        current(); respond(true, { ...result, records: records.map(publicRecord), resources: owners.snapshot().filter(r => runs.has(r.runId)), pauseSupported: false, observationError }); return;
      }
      if (name === 'jarvis.work.start') {
        if (!access) throw new Error('Write authority required');
        exactKeys(params, ['sessionKey', 'agentId', 'runId', 'message', 'independent']);
        const runId = text(params.runId, 'runId', 128), message = workText(params.message, 'message', 16000);
        if (message.trimStart().startsWith('/')) throw new Error('Slash commands are outside work ingress');
        const binding = live(runId);
        if (!binding || binding.scope.userId !== user || binding.scope.deviceId !== client.connect.device.id || binding.scope.sessionId !== access.target.sessionId || binding.scope.sessionKey !== access.target.sessionKey) throw new Error('Current matching 03 task grant required');
        const assert = () => { current(); binding.assertCurrent(); if (!live(runId)) throw new Error('Task grant revoked'); };
        const native = await request<Record<string, unknown>>('sessions.describe', { key: access.target.sessionKey, agentId: access.target.agentId });
        const row = (native.session ?? native) as Record<string, unknown>;
        assert(); if (row.hasActiveRun === true || row.queued === true) throw new Error('Session busy: use a separate native child session for independent work');
        if (params.independent !== undefined && typeof params.independent !== 'boolean') throw new Error('Invalid independent flag');
        if (params.independent && !access.target.sessionKey.startsWith('agent:main:subagent:')) throw new Error('Independent work requires an explicit fresh native subagent session');
        const created = await ledger.create(binding.scope, message); assert();
        // No retry after a retained admission attempt, even if the transport
        // timed out. Native receipts/history must be inspected by read/status.
        if (!created.created) { respond(true, { record: publicRecord(created.record), dispatched: false }); return; }
        await mutate(runId, 'dispatch', 'dispatch-attempt', {}, r => { r.state = 'delivered'; });
        try {
          const accepted = params.independent ? await api.runtime.subagent.run({ sessionKey: binding.scope.sessionKey, message, idempotencyKey: runId, deliver: false, promptMode: 'minimal', assertCurrent: assert }) : await request<Record<string, unknown>>('chat.send', { sessionKey: binding.scope.sessionKey, agentId: binding.scope.agentId, sessionId: binding.scope.sessionId, message, idempotencyKey: runId, queueMode: 'followup', deliver: false });
          if (accepted.runId !== runId) throw new Error('Native run identity differs; inspect before continuation');
          await ledger.change(user, binding.scope.taskId, 'dispatch-ack', 'native-admission', { runId }, () => {});
          respond(true, { record: publicRecord(await ledger.get(user, binding.scope.taskId)), dispatched: true });
        } catch (e) {
          await ledger.change(user, binding.scope.taskId, 'dispatch-unknown', 'dispatch-unresolved', {}, r => { if (!terminal(r)) { r.state = 'unknown'; r.blocker = 'Native dispatch outcome unresolved; never automatically replay'; } }); throw e;
        }
        return;
      }
      exactKeys(params, name === 'jarvis.work.read' || name === 'jarvis.work.status' ? ['sessionKey', 'agentId', 'taskId', 'callId'] : name === 'jarvis.work.cancel' ? ['sessionKey', 'agentId', 'taskId', 'expectedRevision'] : ['sessionKey', 'agentId', 'taskId', 'expectedRevision', 'inputId', 'message', 'acceptPlan']);
      const r = await ledger.get(user, text(params.taskId, 'taskId'));
      if (r.sessionKey !== params.sessionKey || r.agentId !== params.agentId || access && (r.sessionId !== access.target.sessionId || r.sessionKey !== access.target.sessionKey)) throw new Error('Task belongs to a different native session incarnation');
      const row = await nativeObservation(r);
      current();
      const reconciled = await ledger.reconcile(r, row);
      if (name === 'jarvis.work.read' || name === 'jarvis.work.status') {
        let output: unknown;
        if (r.execution === 'local') {
          const call=text(params.callId ?? r.operation?.callId,'callId',256);
          const evidence=await ledger.journal.lookup(`${key(user,r.taskId)}:e:${hash(`tool-result:${call}`)}`);
          output=evidence?.data.localOutput;
        } else if (params.callId !== undefined) {
          const call = text(params.callId, 'callId', 256);
          if (!r.seen[`tool-result:${call}`] || row.sessionId !== r.sessionId) throw new Error('Output not observed for this task/session incarnation');
          const history = await api.runtime.subagent.getSessionMessages({ sessionKey: r.sessionKey, limit: 100 });
          // Only the requested visible tool result; no hidden reasoning, logs,
          // unrelated stdout or complete transcript in the compact status.
          const actual = history.messages.find(m => { const v = m as Record<string, unknown>; return v.role === 'toolResult' && v.toolCallId === call; }) as { content?: unknown; toolName?: unknown } | undefined;
          if (!actual) throw new Error('Requested native output not found in current bounded history');
          const parts = Array.isArray(actual.content) ? actual.content.filter(p => p?.type === 'text' && typeof p.text === 'string') : [];
          const content = parts.map(p => p.text).join('\n');
          output = { role: 'toolResult', toolCallId: call, content: [{ type: 'text', text: content.slice(0, 12000) }], truncated: content.length > 12000 };
        }
        else if (name === 'jarvis.work.read' && row.sessionId === (r.execution === 'codex' ? r.worker?.sessionId : r.sessionId)) {
          const native = await request<Record<string, unknown>>('agent.wait', { runId: r.execution === 'codex' ? r.worker?.runId : r.runId, timeoutMs: 0 });
          const reply = native.terminalReply as { disposition?: unknown; text?: unknown } | undefined;
          const visible = reply?.disposition === 'visible' && typeof reply.text === 'string' ? reply.text : typeof native.error === 'string' ? native.error : undefined;
          if (visible) output = { role: reply?.disposition === 'visible' ? 'assistant' : 'native-error', content: [{ type: 'text', text: visible.slice(0, 12000) }], truncated: visible.length > 12000, runId: r.runId };
        }
        current(); respond(true, { record: publicRecord(reconciled), output, outputUnavailable: name === 'jarvis.work.read' && output === undefined, resources: owners.snapshot().filter(v => v.runId === r.runId), pauseSupported: false, observationError }); return;
      }
      if (params.expectedRevision !== r.revision || terminal(r) || r.generation !== ledger.generation) throw new Error('Stale or ended task; read current native status');
      const binding = live(r.runId);
      if (binding && (binding.scope.userId !== user || binding.scope.deviceId !== client.connect.device.id || binding.scope.taskId !== r.taskId)) throw new Error('Cannot borrow a different task grant');
      current(); binding?.assertCurrent();
      if (name === 'jarvis.work.cancel') {
        if (r.execution === 'codex') {
          if (!workerInterrupt) throw new Error('Native Codex interrupt path unavailable');
          const receipt = await workerInterrupt(r.runId);
          current(); respond(true, { record: publicRecord(await ledger.get(user, r.taskId)), native: receipt }); return;
        }
        await ledger.change(user, r.taskId, `cancel:${r.revision}`, 'cancel-request', {}, v => { v.state = 'cancel-requested'; }, current);
        const receipt = await request<Record<string, unknown>>('chat.abort', { sessionKey: r.sessionKey, agentId: r.agentId, runId: r.runId });
        if (receipt.aborted === true && Array.isArray(receipt.runIds) && receipt.runIds.includes(r.runId)) {
          await ledger.change(user, r.taskId, `cancel-ack:${r.revision}`, 'native-cancel', {}, v => { v.state = 'cancelled'; v.result = 'cancelled'; }); owners.releaseRun(r.runId);
        }
        current(); respond(true, { record: publicRecord(await ledger.get(user, r.taskId)), native: receipt }); return;
      }
      if (name !== 'jarvis.work.steer') throw new Error('Unsupported work operation');
      if (!binding) throw new Error('Current original task grant required for steering; record label grants no authority');
      const inputId = text(params.inputId, 'inputId', 128), message = workText(params.message, 'message', 1800);
      if (r.steering[inputId] && r.steering[inputId].text !== message) throw new Error('Steering input identity already bound to another message');
      if (params.acceptPlan !== undefined && (typeof params.acceptPlan !== 'string' || params.acceptPlan !== r.model?.plan)) throw new Error('Only the current proposed plan can be explicitly accepted');
      if (message.trimStart().startsWith('/')) throw new Error('Slash commands are outside work steering');
      if (!Array.isArray(row.activeRunIds) || row.activeRunIds.length !== 1 || row.activeRunIds[0] !== r.runId) throw new Error('Exact native active owner required');
      const result = await ledger.change(user, r.taskId, `steer:${inputId}`, 'steer-delivery', { inputId }, v => {
        if (v.revision !== params.expectedRevision) throw new Error('Revision conflict');
        if (params.acceptPlan !== undefined && v.model?.plan !== params.acceptPlan) throw new Error('Proposed plan changed before user acceptance');
        v.revision++; v.steering[inputId] = { text: message, revision: v.revision, stage: 'delivered', nativeInputId: inputId };
        if (params.acceptPlan !== undefined) v.acceptedPlan = String(params.acceptPlan);
      }, current);
      if (!result.changed) { respond(true, { record: publicRecord(result.record), dispatched: false }); return; }
      const projectRevision = await ledger.projectRevision(user, r.projectId, `steer:${r.taskId}:${inputId}`);
      await ledger.change(user, r.taskId, `project-steer:${inputId}`, 'project-revision', { projectRevision }, v => { v.projectRevision = projectRevision; }, current);
      try {
        // Explicit native session steering; no interrupt/supersede fallback.
        const receipt = await request<Record<string, unknown>>('chat.send', { sessionKey: r.sessionKey, agentId: r.agentId, sessionId: r.sessionId, message, idempotencyKey: inputId, queueMode: 'steer', deliver: false });
        await ledger.change(user, r.taskId, `steer-ack:${inputId}`, 'steer-native-admission', { inputId, nativeStatus: receipt.status }, v => { v.steering[inputId].stage = receipt.runId === inputId && ['started', 'ok', 'accepted', 'in_flight'].includes(String(receipt.status)) ? 'accepted' : 'unknown'; v.blocker = 'Steering admission only; consumption/application not yet proven'; });
      } catch (e) { await ledger.change(user, r.taskId, `steer-unknown:${inputId}`, 'steer-unresolved', {}, v => { v.steering[inputId].stage = 'unknown'; }); throw e; }
      current(); respond(true, { record: publicRecord(await ledger.get(user, r.taskId)) });
    } catch (e) { respond(false, undefined, { code: 'INVALID_REQUEST', message: e instanceof Error ? e.message : 'Native work unavailable' }); }
  };
  for (const name of ['start', 'read', 'status', 'steer', 'cancel']) api.registerGatewayMethod(`jarvis.work.${name}`, method, { scope: name === 'read' || name === 'status' ? 'operator.read' : 'operator.write', profileAccess: 'required', ...(name === 'read' || name === 'status' ? {} : { sessionAccess: { mode: 'write' as const } }) });

  api.agent.events.registerAgentEventSubscription({ id: 'jarvis-work-facts', streams: ['lifecycle', 'tool', 'error', 'approval'], async handle(e) {
    try {
      await mutate(e.runId, `native:${e.seq}`, `native-${e.stream}`, { stream: e.stream, seq: e.seq, phase: e.data.phase, kind: e.data.kind, toolCallId: typeof e.data.toolCallId === 'string' ? e.data.toolCallId : undefined, name: typeof e.data.name === 'string' ? e.data.name : undefined }, r => {
        if (e.sessionId && e.sessionId !== r.sessionId) return;
        if (r.nativeSequence !== undefined && e.seq <= r.nativeSequence) return;
        r.nativeSequence = e.seq;
        if (e.stream === 'lifecycle' && e.data.phase === 'start') r.state = 'running';
        if (e.stream === 'lifecycle' && e.data.phase === 'end') { r.state = 'ended'; r.result = 'native-ended'; }
        if (e.stream === 'error' || e.stream === 'lifecycle' && e.data.phase === 'error') { r.state = 'failed'; r.result = 'native-error'; r.blocker = 'Native runtime error; inspect current output'; }
        if (e.stream === 'approval') r.blocker = 'Native approval event observed; read canonical approval registry';
        if (e.stream === 'tool' && typeof e.data.toolCallId === 'string' && typeof e.data.name === 'string') {
          const callId = e.data.toolCallId;
          if (!r.seen[`tool-result:${callId}`] && ['start', 'result'].includes(String(e.data.phase))) r.operation = { callId, tool: e.data.name, revision: r.seen[`tool-start:${callId}`]?.revision, phase: e.data.phase === 'start' ? 'started' : e.data.isError === true ? 'error' : e.data.result === undefined ? 'missing' : 'result', effect: 'unverified' };
        }
      });
      if (e.stream === 'error' || e.stream === 'lifecycle' && ['end', 'error'].includes(String(e.data.phase))) owners.releaseRun(e.runId);
    } catch (e) { fail(e); }
  } });
  api.on('agent_end', async (event, ctx) => {
    const run = event.runId ?? ctx.runId; if (!run) return;
    try { await mutate(run, 'agent-end', 'native-agent-end', { success: event.success, hasError: Boolean(event.error) }, r => {
      const completed = event.success === true && !event.error;
      r.state = completed ? 'ended' : 'failed'; r.result = completed ? 'native-ended' : 'native-error';
      if (!completed) r.blocker = 'Native agent ended without successful execution; inspect output';
    }); } finally { owners.releaseRun(run); for (const k of expected.keys()) if (k.startsWith(run + ':')) expected.delete(k); }
  }, { priority: 11000 });
  api.on('after_tool_call', async (event, ctx) => {
    const run = event.runId ?? ctx.runId, call = event.toolCallId ?? ctx.toolCallId;
    if (!run || !call) return;
    try {
      const currentBinding = live(run);
      let observedRevision: number | undefined;
      if (currentBinding) {
        const recorded = await ledger.store.lookup(key(currentBinding.scope.userId, currentBinding.scope.taskId));
        if (recorded?.seen[`tool-result:${call}`]) return;
        observedRevision = recorded?.seen[`tool-start:${call}`]?.revision;
      }
      const result = event.result as { isError?: boolean; error?: unknown; success?: boolean; details?: { error?: unknown; results?: { url?: unknown }[]; url?: unknown } } | undefined;
      const error = Boolean(event.error || result?.isError === true || result?.error || result?.success === false || result?.details?.error);
      let verified = false;
      const expectation = expected.get(`${run}:${call}`);
      const binding = live(run);
      if (!error && event.result !== undefined && expectation && binding) {
        try {
          binding.assertCurrent(); const target = await safePath(event.params.path ?? event.params.file_path);
          if (target.toLowerCase() === expectation.target.toLowerCase()) {
            const observed = hash(await fs.readFile(target, 'utf8')); binding.assertCurrent(); verified = expectation.digest === observed;
          }
        } catch { /* Returned result remains recorded; unreadable effect is unverified. */ }
      }
      const sources = [...(result?.details?.results ?? []), { url: result?.details?.url }].flatMap(v => typeof v.url === 'string' && /^https:\/\//.test(v.url) ? [v.url.slice(0, 2048)] : []).slice(0, 8);
      const local=(await ledger.store.lookup(key(binding?.scope.userId ?? '',binding?.scope.taskId ?? '')))?.execution === 'local';
      const localOutput=local ? {content:[{type:'text',text:JSON.stringify(event.result ?? {error:event.error ?? 'Missing local result'}).slice(0,12000)}],truncated:JSON.stringify(event.result ?? {}).length>12000} : undefined;
      await mutate(run, `tool-result:${call}`, 'after-tool-result', { callId: call, tool: event.toolName, observedRevision, present: event.result !== undefined, error, verified, sources,localOutput }, r => {
        r.operation = { callId: call, tool: event.toolName, revision: observedRevision, phase: error ? 'error' : event.result === undefined ? 'missing' : 'result', effect: verified ? 'verified' : 'unverified', ...(event.result !== undefined ? { resultHash: fingerprint(event.result) } : {}), sources };
        if (error || event.result === undefined) r.blocker = error ? 'Tool error observed; effect may still require inspection' : 'Tool result missing; success unknown';
        if(r.execution==='local')r.state=error?'failed':event.result===undefined?'unknown':'ended';
      });
    } finally { owners.releaseCall(run, call); expected.delete(`${run}:${call}`); }
  });
  api.on('gateway_stop', () => { for (const v of owners.snapshot()) owners.releaseRun(v.runId); expected.clear(); });
  return {
    ledger, owners,
    setWorkerInterrupt: (handler: (runId: string) => Promise<unknown>) => { workerInterrupt = handler; },
    async confirmSteer(runId: string, inputId: string, callId: string, stage: 'applying' | 'applied', assertNativeEvidence: () => void) {
      const binding = live(runId); if (!binding) throw new Error('Current steering owner required');
      const current = () => { binding.assertCurrent(); if (!live(runId)) throw new Error('Task authority expired'); assertNativeEvidence(); };
      current();
      return ledger.change(binding.scope.userId, binding.scope.taskId, `steer-evidence:${inputId}:${callId}:${stage}`, 'host-steer-evidence', { inputId, callId, stage }, r => {
        const steer = r.steering[inputId];
        if (!steer || !['accepted', 'applying'].includes(steer.stage) || r.operation?.callId !== callId || r.operation.revision !== steer.revision) throw new Error('Exact native steering input/operation/revision evidence required');
        if (stage === 'applied' && r.operation.effect !== 'verified') throw new Error('Associated actual effect is unverified');
        steer.stage = stage;
      }, current);
    },
    // Used only by a future admitted host worker adapter after receiving real
    // provider identifiers. Neither model tools nor client params expose it.
    async linkWorker(runId: string, identity: { threadId?: string; turnId?: string; sessionId?: string }) {
      const binding = live(runId); if (!binding) throw new Error('Current worker owner required');
      exactKeys(identity, ['threadId', 'turnId', 'sessionId']);
      const worker = Object.fromEntries(Object.entries(identity).map(([k, v]) => [k, text(v, k, 256)]));
      if (!Object.keys(worker).length) throw new Error('Concrete native worker identity required');
      binding.assertCurrent();
      return mutate(runId, `worker:${fingerprint(worker)}`, 'host-worker-identity', worker, r => { r.worker = { ...r.worker, ...worker }; });
    },
    release: (runId: string) => { owners.releaseRun(runId); for (const k of expected.keys()) if (k.startsWith(runId + ':')) expected.delete(k); },
    async prepareLocal(scope: Scope, call: string) {
      const result=await ledger.create(scope,scope.userStatement ?? 'Exact authenticated local operation');
      if(result.record.seen[`tool-start:${call}`]) throw new Error('Local call already attempted; inspect native record, never replay');
      await ledger.change(scope.userId,scope.taskId,`local-admission:${call}`,'local-admission',{callId:call},r=>{r.execution='local';r.state='prepared';r.blocker=undefined;});
      return result.record;
    },
    async ensureLocal(scope: Scope) {
      const existing=await ledger.store.lookup(key(scope.userId,scope.taskId));
      if(existing){if(existing.runId!==scope.runId || existing.sessionId!==scope.sessionId)throw new Error('Native task identity changed');return existing;}
      return await ledger.create(scope,scope.userStatement ?? 'Exact authenticated local operation');
    },
    async assertLocalResult(scope: Scope,call:string) {
      const record=await ledger.get(scope.userId,scope.taskId);
      const evidence=await ledger.journal.lookup(`${key(scope.userId,scope.taskId)}:e:${hash(`tool-result:${call}`)}`);
      if(!record.seen[`tool-result:${call}`] || !evidence)throw new Error('Local result record unavailable; effect may have happened, inspect before any retry');
    },
    async beforeTool(event: { toolName: string; params: Record<string, unknown>; toolCallId?: string }, ctx: { runId?: string; toolCallId?: string; abortSignal?: AbortSignal }) {
      const run = ctx.runId, call = event.toolCallId ?? ctx.toolCallId, binding = live(run);
      if (!run || !binding) return;
      const record = await ledger.store.lookup(key(binding.scope.userId, binding.scope.taskId));
      if (!record) return; // Existing 03/05 callers remain valid; no made-up task.
      if (!call) throw new Error('Host tool call identity required');
      binding.assertCurrent();
      const resources: string[] = [];
      if(isGuiTool(event.toolName)) {
        // Same owner across both paths; conservative shared desktop exclusion.
        // No second session/queue and no driver-specific input lease.
        resources.push('input:mouse-keyboard');
        if(event.params.windowRef)resources.push(`window:${String(event.params.node)}:${String(event.params.windowRef)}`);
      }
      if (['write', 'edit'].includes(event.toolName)) {
        const target = await safePath(event.params.path ?? event.params.file_path);
        resources.push(`file:${path.win32.normalize(target).toLowerCase()}`);
        if (event.toolName === 'write' && typeof event.params.content === 'string') expected.set(`${run}:${call}`, { target, digest: hash(event.params.content) });
        if (event.toolName === 'edit') {
          const old = event.params.oldText ?? event.params.old_string, replacement = event.params.newText ?? event.params.new_string;
          const content = await fs.readFile(target, 'utf8');
          if (typeof old === 'string' && old && typeof replacement === 'string' && content.split(old).length === 2) expected.set(`${run}:${call}`, { target, digest: hash(content.replace(old, replacement)) });
        }
      }
      if (['jarvis_recycle', 'jarvis_draft'].includes(event.toolName)) resources.push(`file:${String(event.params.path).toLowerCase()}`);
      if (event.toolName === 'jarvis_windows') {
        const w=event.params.window as Record<string, unknown> | undefined;
        if(w) resources.push(`window:${fingerprint({pid:w.pid,started:w.started,exe:path.win32.normalize(String(w.exe)).toLowerCase(),hwnd:w.hwnd})}`);
        if(['open','focus','minimize','restore','media'].includes(String(event.params.action))) resources.push('input:mouse-keyboard');
        if(['volume','mute','audio_status'].includes(String(event.params.action)))resources.push('system:default-audio');
        if(['power','power_status'].includes(String(event.params.action)))resources.push('system:active-power-plan');
      }
      if(event.toolName === 'browser') {
        resources.push(`browser:${String(event.params.profile)}:${String(event.params.targetId ?? 'lifecycle').toLowerCase()}`);
        if(event.params.action === 'focus') resources.push('input:mouse-keyboard');
      }
      if(event.toolName==='jarvis_draft' && event.params.show)resources.push('input:mouse-keyboard');
      owners.claim(resources, run, call, () => { binding.assertCurrent(); if (!live(run)) throw new Error('Run authority expired'); }, ctx.abortSignal ?? binding.signal);
      try { await mutate(run, `tool-start:${call}`, 'tool-observed', { callId: call, tool: event.toolName, resources }, r => { r.operation = { callId: call, tool: event.toolName, revision: r.revision, phase: 'observed', effect: 'unverified' }; }); }
      catch (e) { owners.releaseCall(run, call); expected.delete(`${run}:${call}`); throw e; }
    }
  };
}

export function publicRecord(r: WorkRecord) {
  const { userId: _user, deviceId: _device, seen: _seen, generation: _generation, ...record } = r;
  return record;
}
