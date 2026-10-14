import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { dispatchGatewayMethod } from 'openclaw/plugin-sdk/gateway-method-runtime';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { exactKeys, text, workText, type Scope } from './policy.ts';
import type { WorkLedger, ResourceOwners } from './work.ts';

export const CODEX_AGENT = 'jarvis-codex';
export const CODEX_INSTRUCTIONS = `You are the user's selected external Codex coding worker. OpenClaw owns the task and permissions; JARVIS/Space Bunny plans and reviews the result. Work in the supplied projectRoot on the accepted request. Implement the smallest sufficient solution. Perform necessary edits, terminal commands, dependency/Git reads and relevant checks without asking about routine steps. Ask only when missing information changes the result, the plan conflicts, or the task scope must change. Report that question through native request_user_input; do not invent a human approval. JARVIS can answer technical planning questions from the accepted requirements; actual user choices and permission decisions belong to the user. Never switch worker, model or provider. Do not change JARVIS control files, memory or credentials as part of the task. Report changed files/diff, verification and remaining limitations. Execution completion is not acceptance of the result. Full access is explicitly selected; cwd is not an OS isolation guarantee.`;
export const CODEX_HANDOFF_GUIDANCE = `For this user-selected Codex task, you (JARVIS/Space Bunny) retain planning and result review. Prepare the smallest sufficient task with request, purpose, scope, relevant context, expected output and verification, using the admitted projectRoot and revision. Codex has explicit Full access and can perform routine coding/terminal/check steps without repeated questions. Give it concrete requirements and constraints. Review actual changed files/diff and verification against the user's goal; native completion alone is not acceptance. Continue/steer the same task if correction is needed. Answer technical planning questions only from accepted requirements; user preferences and actual native permission questions go to the OpenClaw user decision path. Never switch worker/model/provider, create a second planner, or claim unknown cancellation as complete.`;
type Binding = { scope: Scope; assertCurrent: () => void; signal: AbortSignal };
type Worker = { parent: Binding; key: string; sessionId: string; runId: string; busy: boolean; stopped: boolean; unresolved: boolean; decisionPending: boolean; abort: () => void };
type Request = (method: string, params: Record<string, unknown>) => Promise<Record<string, any>>;
const request: Request = async (method, params) => {
  const r = await dispatchGatewayMethod(method, params);
  if (!r.ok) throw new Error(`${r.error?.code}: ${r.error?.message}`);
  return r.payload as Record<string, any>;
};

export async function codexContract(p: Record<string, unknown>, scope: Scope, revision: number) {
  if (scope.role !== 'project' || !scope.root) throw new Error('Current project task required');
  if (p.worker !== 'codex' || p.expectedRevision !== revision) throw new Error('Explicit Codex choice and current revision required');
  if (typeof p.projectRoot !== 'string' || path.win32.normalize(p.projectRoot).toLowerCase() !== path.win32.normalize(scope.root).toLowerCase()) throw new Error('Project root differs from admitted task');
  const root = await fs.realpath(scope.root);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Project directory required');
  const model = text(p.model, 'selected Codex model', 160);
  if (!/^openai\/[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Explicit official OpenAI model selection required; no model fallback');
  const contract = Object.fromEntries(['request','purpose','scope','context','output','verification'].map(k => [k, workText(p[k], k, k === 'context' ? 12000 : 4000)]));
  return { ...contract, worker: 'codex', projectRoot: root, model, permissionMode: 'full', taskId: scope.taskId, projectId: scope.projectId, revision };
}

// Ephemeral connection authority over native OpenClaw sessions, not a second
// executor, scheduler, approval registry, task store, or model loop.
export function installCodex(api: OpenClawPluginApi, live: (run?: string) => Binding | undefined, ledger: WorkLedger, rpc: Request = request, owners?: ResourceOwners) {
  const workers = new Map<string, Worker>();
  const starting = new Set<string>();
  const authReady = () => {
    const dir = api.runtime.agent.resolveAgentDir(api.config, CODEX_AGENT);
    const store = api.runtime.modelAuth.ensureAuthProfileStore(dir, { allowKeychainPrompt: false, config: api.config });
    const auth = store.profiles['openai:jarvis-codex'];
    return auth?.provider === 'openai' && (auth.type === 'oauth' || auth.type === 'token');
  };
  api.registerGatewayMethod('jarvis.codex.setup', async ({ respond }) => {
    const appServer = api.config.plugins?.entries?.codex?.config?.appServer as { command?: string; sandbox?: string } | undefined;
    try { respond(true, { workerAgent: CODEX_AGENT, enabled: api.config.plugins?.entries?.codex?.enabled === true, binary: appServer?.command, pinnedVersion: '0.160.0', fullAccessConfigured: appServer?.sandbox === 'danger-full-access', authReady: authReady(), authProfile: 'openai:jarvis-codex', model: 'Explicit user/account-supported selection required at handoff; no forced default', liveTurnVerified: false }); }
    catch { respond(true, { workerAgent: CODEX_AGENT, authReady: false, reason: 'Dedicated Codex account not connected; no fallback', liveTurnVerified: false }); }
  }, { scope: 'operator.read', profileAccess: 'required' });
  const current = (w: Worker) => {
    w.parent.assertCurrent();
    if (w.parent.signal.aborted || w.parent.scope.expiresAt <= Date.now() || !live(w.parent.scope.runId) || w.stopped) throw new Error('Codex task authority expired');
  };
  const record = async (w: Worker, id: string, kind: string, data: Record<string, unknown>, apply: (r: any) => void = () => {}) => {
    return ledger.change(w.parent.scope.userId, w.parent.scope.taskId, id, kind, data, apply);
  };
  const interrupt = async (w: Worker) => {
    if (w.stopped) return { cancellationConfirmed: false, reason: 'Interrupt already requested; inspect native status rather than blindly retry' };
    w.stopped = true;
    await record(w, `codex-interrupt:${w.runId}`, 'codex-interrupt-request', { runId: w.runId }, r => { r.state = 'cancel-requested'; r.blocker = 'Native interrupt requested; child-process stop not proven'; });
    // Native Codex harness translates chat.abort to turn/interrupt. No taskkill.
    const receipt = await rpc('chat.abort', { sessionKey: w.key, agentId: CODEX_AGENT, runId: w.runId });
    return { native: receipt, cancellationConfirmed: false, reason: 'Interrupt receipt alone does not prove every child process stopped' };
  };
  const send = async (w: Worker, message: string) => {
    if (!authReady()) throw new Error('Dedicated Codex subscription login required; no API-key or account fallback');
    current(w); if (w.unresolved || w.busy || w.decisionPending) throw new Error('Native request pending/unresolved; inspect current status');
    const questions = await rpc('question.list', {});
    if (!Array.isArray(questions.questions)) throw new Error('Native pending-question state unavailable');
    if (questions.questions.some((q: any) => q.sessionKey === w.key && q.status === 'pending')) throw new Error('Native question pending; use the OpenClaw user decision path');
    if (!owners) throw new Error('Native stage06 project ownership unavailable');
    owners.claim([`file:${w.parent.scope.root}`], w.parent.scope.runId, w.key, () => current(w), w.parent.signal);
    w.busy = true; w.runId = randomUUID();
    await record(w, `codex-dispatch:${w.runId}`, 'codex-dispatch-attempt', { runId: w.runId }, r => { r.state = 'delivered'; r.worker = { ...r.worker, runId: w.runId }; });
    current(w);
    try {
      const receipt = await rpc('chat.send', { sessionKey: w.key, agentId: CODEX_AGENT, sessionId: w.sessionId, message, idempotencyKey: w.runId, deliver: false });
      if (receipt.runId !== w.runId) throw new Error('Native run identity mismatch');
      current(w); return receipt;
    } catch (e) {
      w.unresolved = true;
      await record(w, `codex-unknown:${w.runId}`, 'codex-dispatch-unresolved', {}, r => { r.state = 'unknown'; r.blocker = 'Native dispatch outcome unresolved; no automatic replay/fallback'; });
      throw e;
    }
  };
  const method: Parameters<OpenClawPluginApi['registerGatewayMethod']>[1] = async options => {
    const { params: p, client, sessionAccessAuthority: access, respond, req } = options;
    try {
      const b = live(String(p.runId));
      if (!b || !access || client?.invalidated || client?.connect.role !== 'operator' || !client.connect.scopes?.includes('operator.admin') || (client.authenticatedUserProfile?.profileId ?? client.authenticatedUserId) !== b.scope.userId || client.connect.device?.id !== b.scope.deviceId || access.target.sessionId !== b.scope.sessionId || access.target.sessionKey !== b.scope.sessionKey) throw new Error('Current original operator/admin task authority required for selected Full access');
      const assert = () => { access.assertCurrent(); b.assertCurrent(); if (!live(b.scope.runId) || client.invalidated) throw new Error('Task authority revoked'); };
      assert();
      const action = req.method.split('.').at(-1);
      const old = workers.get(b.scope.runId);
      if (action === 'start') {
        exactKeys(p, ['sessionKey','agentId','runId','worker','projectRoot','expectedRevision','model','request','purpose','scope','context','output','verification']);
        if (!authReady()) throw new Error('Dedicated Codex subscription login required; run scripts/jarvis-codex-profile.ps1 -Action Login yourself');
        if (old || starting.has(b.scope.runId)) throw new Error('Codex already attempted for this task; use status/continue, never replay');
        starting.add(b.scope.runId);
        try {
        const r = (await ledger.create(b.scope, workText(p.request, 'request', 4000))).record;
        const contract = await codexContract(p, b.scope, r.revision); assert();
        const w: Worker = { parent: b, key: `agent:${CODEX_AGENT}:jarvis:${randomUUID()}`, sessionId: '', runId: '', busy: false, stopped: false, unresolved: false, decisionPending: false, abort: () => { void interrupt(w).catch(e => api.logger.error(`Codex interrupt unresolved: ${e instanceof Error ? e.message : 'unknown'}`)); } };
        workers.set(b.scope.runId, w);
        await record(w, 'codex-admission', 'codex-admission', contract, v => { v.execution = 'codex'; v.state = 'prepared'; });
        try {
          // No parent transcript fork; only the bounded handoff is sent.
          const created = await rpc('sessions.create', { key: w.key, idempotencyKey: w.key, agentId: CODEX_AGENT, model: contract.model, agentRuntime: 'codex', permissionMode: 'full', cwd: contract.projectRoot, label: `Codex ${b.scope.taskId}`.slice(0,64) });
          if (created.key !== w.key || typeof created.sessionId !== 'string') throw new Error('Native session identity mismatch');
          w.sessionId = created.sessionId; assert();
          await record(w, 'codex-session', 'codex-native-session', { key: w.key, sessionId: w.sessionId }, v => { v.worker = { agentId: CODEX_AGENT, sessionKey: w.key, sessionId: w.sessionId }; });
          b.signal.addEventListener('abort', w.abort, { once: true });
          const receipt = await send(w, `${CODEX_INSTRUCTIONS}\n\n${JSON.stringify(contract)}`);
          respond(true, { worker: 'codex', native: receipt, fullAccess: true, reviewRequired: true });
        } catch (e) { w.unresolved = true; await record(w, 'codex-start-error', 'codex-start-error', {}, v => { v.state = 'unknown'; v.blocker = 'Codex unavailable or start outcome unresolved; inspect native session; no fallback'; }); throw e; }
        return;
        } finally { starting.delete(b.scope.runId); }
      }
      exactKeys(p, ['sessionKey','agentId','runId','expectedRevision','message','inputId']);
      if (!old) throw new Error('No current admitted Codex worker');
      const w = old; const r = await ledger.get(b.scope.userId, b.scope.taskId);
      if (action !== 'status' && p.expectedRevision !== r.revision) throw new Error('Task revision changed');
      if (action === 'status') {
        const native = await rpc('sessions.describe', { key: w.key, agentId: CODEX_AGENT });
        const result = w.runId ? await rpc('agent.wait', { runId: w.runId, timeoutMs: 0 }) : {};
        const reply = result.terminalReply?.disposition === 'visible' ? result.terminalReply.text : undefined;
        const diff = await rpc('sessions.diff', { sessionKey: w.key, agentId: CODEX_AGENT });
        const questions = await rpc('question.list', {});
        const pending = Array.isArray(questions.questions) ? questions.questions.filter((q: any) => q.sessionKey === w.key && q.status === 'pending').map((q: any) => ({ id: q.id, status: q.status, expiresAtMs: q.expiresAtMs })) : undefined;
        assert(); respond(true, { worker: r.worker, state: r.state, revision: r.revision, nativeActive: (native.session ?? native).hasActiveRun, diff, pendingQuestions: pending, questionPath: 'OpenClaw native user decision; no model resolver', result: typeof reply === 'string' ? reply.slice(0, 24000) : undefined, reviewRequired: true, cancellationConfirmed: false }); return;
      }
      if (action === 'interrupt') { respond(true, await interrupt(w)); return; }
      current(w);
      if (w.decisionPending) throw new Error('Native approval resolution not yet proven; wait for native completion or cancel');
      const message = workText(p.message, 'continuation', 12000), inputId = text(p.inputId, 'inputId', 128);
      if (message.trimStart().startsWith('/')) throw new Error('Runtime/model/permission commands cannot replace a task continuation');
      const native = await rpc('sessions.describe', { key: w.key, agentId: CODEX_AGENT });
      const row = native.session ?? native;
      if (row.sessionId !== w.sessionId) throw new Error('Native session incarnation changed');
      if (row.pendingQuestion || row.pendingApproval || row.queued === true) throw new Error('Native user decision/queue unresolved; use the OpenClaw user decision path');
      const questions = await rpc('question.list', {});
      if (!Array.isArray(questions.questions) || questions.questions.some((q: any) => q.sessionKey === w.key && q.status === 'pending')) throw new Error('Native question state pending/unavailable; no replacement input identity');
      if (action === 'steer' && (!row.hasActiveRun || !row.activeRunIds?.includes(w.runId))) throw new Error('Exact active native run required');
      if (action === 'continue' && row.hasActiveRun) throw new Error('Native run still active; use steer');
      const changed = await record(w, `codex-input:${inputId}`, 'codex-continuation', { action, message, inputId }, v => { if (v.revision !== p.expectedRevision) throw new Error('Revision conflict'); v.revision++; });
      if (!changed.changed) { respond(true, { dispatched: false }); return; }
      assert();
      if (action === 'steer') {
        const receipt = await rpc('chat.send', { sessionKey: w.key, agentId: CODEX_AGENT, sessionId: w.sessionId, message, idempotencyKey: inputId, queueMode: 'steer', deliver: false });
        respond(true, { native: receipt, revision: changed.record.revision, applied: false });
      } else if (action === 'continue') {
        w.busy = false; respond(true, { native: await send(w, message), revision: changed.record.revision });
      } else throw new Error('Unsupported Codex control');
    } catch (e) { respond(false, undefined, { code: 'INVALID_REQUEST', message: e instanceof Error ? e.message : 'Codex request failed' }); }
  };
  // SDK session-scoped registrations require operator.write; the handler above
  // additionally enforces operator.admin for the explicitly selected Full access.
  for (const name of ['start','status','continue','steer','interrupt']) api.registerGatewayMethod(`jarvis.codex.${name}`, method, { scope: 'operator.write', profileAccess: 'required', sessionAccess: { mode: 'write' } });
  api.agent.events.registerAgentEventSubscription({ id: 'jarvis-codex-native', streams: ['codex_app_server.lifecycle','codex_app_server.item','lifecycle','approval'], async handle(e) {
    const w = [...workers.values()].find(w => w.runId === e.runId); if (!w || e.sessionId && e.sessionId !== w.sessionId) return;
    try {
      const d = e.data;
      if (!['codex_app_server.lifecycle','codex_app_server.item','lifecycle','approval'].includes(e.stream)) return;
      if (e.stream === 'codex_app_server.item' && d.type === 'reasoning') return;
      const data = Object.fromEntries(['phase','threadId','turnId','itemId','type','requestId','status'].filter(k => typeof d[k] === 'string' || typeof d[k] === 'number').map(k => [k, d[k]]));
      await record(w, `codex-event:${w.runId}:${e.seq}`, `native-${e.stream}`, data, r => {
        if (typeof d.threadId === 'string') r.worker.threadId = d.threadId;
        if (typeof d.turnId === 'string') r.worker.turnId = d.turnId;
        if (typeof d.itemId === 'string') r.worker.itemId = d.itemId;
        if (d.requestId !== undefined) r.worker.requestId = d.requestId;
        if (e.stream === 'lifecycle' && d.phase === 'start') r.state = 'running';
        if (e.stream === 'lifecycle' && d.phase === 'end') { w.busy = false; w.decisionPending = false; if (!w.stopped) owners?.releaseCall(w.parent.scope.runId,w.key); r.state = w.stopped ? 'unknown' : 'ended'; r.result = 'native-ended'; r.blocker = w.stopped ? 'Native run ended after interrupt; child-process termination not proven' : 'Execution ended; JARVIS result review required'; }
        if (e.stream === 'lifecycle' && d.phase === 'error') { w.busy = false; w.decisionPending = false; r.state = 'failed'; r.result = 'native-error'; }
        if (e.stream === 'approval') { w.decisionPending = true; r.blocker = 'Native user decision pending in OpenClaw; models cannot resolve it'; }
      });
    } catch (error) { w.unresolved = true; api.logger.error(`Codex host observation unavailable: ${error instanceof Error ? error.message : 'unknown'}`); }
  } });
  api.on('before_prompt_build', (_event, ctx) => {
    if (ctx.agentId === 'main' && ctx.runId && workers.has(ctx.runId)) return { appendSystemContext: CODEX_HANDOFF_GUIDANCE };
    if (ctx.agentId !== CODEX_AGENT) return;
    const w = [...workers.values()].find(w => w.runId === ctx.runId && w.key === ctx.sessionKey);
    if (!w) throw new Error('Unadmitted Codex worker'); current(w);
    return { systemPrompt: CODEX_INSTRUCTIONS };
  });
  api.on('before_agent_reply', (_event, ctx) => {
    if (ctx.agentId !== CODEX_AGENT) return;
    const w = [...workers.values()].find(w => w.runId === ctx.runId && w.key === ctx.sessionKey);
    try { if (!w) throw new Error('Unadmitted Codex worker'); current(w); }
    catch { return { handled: true, reason: 'Codex requires a live explicit JARVIS handoff; no ambient worker/model execution' }; }
  }, { priority: 10000 });
  api.on('gateway_stop', async () => {
    for (const w of workers.values()) { w.parent.signal.removeEventListener('abort', w.abort); if (w.busy && !w.stopped) await interrupt(w).catch(() => {}); }
    workers.clear();
  });
  return {
    interruptParent: async (runId: string) => { const w = workers.get(runId); if (!w) throw new Error('No current Codex worker'); return interrupt(w); },
    beforeTool(event: { toolName: string }, ctx: { agentId?: string; runId?: string; sessionId?: string; sessionKey?: string }) {
      if (ctx.agentId !== CODEX_AGENT) return undefined;
      const w = [...workers.values()].find(w => w.runId === ctx.runId && w.sessionId === ctx.sessionId && w.key === ctx.sessionKey);
      try { if (!w) throw new Error('No current Codex task'); current(w); if (!w.busy || w.unresolved) throw new Error('Native turn not currently admitted');
        // Generic dynamic exec is excluded by the leaf's minimal profile.
        // Only Codex's normalized coding/file/process tool names cross relay.
        if (!['exec','bash','read','write','edit','apply_patch','process','code_execution'].includes(event.toolName)) throw new Error('Non-coding host capability unavailable to Codex');
        return {};
      } catch (e) { return { block: true, blockReason: e instanceof Error ? e.message : 'Codex guard unavailable' }; }
    },
  };
}
