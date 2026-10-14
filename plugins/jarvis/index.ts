import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { makeScope, evaluate, READER_PROMPT, publicUrl, fingerprint, WORK_TOOLS, workNoteParams, protectHostRepo, type Scope } from './policy.ts';
import { isBlockedHostnameOrIp, resolvePinnedHostnameWithPolicy } from 'openclaw/plugin-sdk/ssrf-runtime';
import { getMemoryCapabilityRegistration } from 'openclaw/plugin-sdk/memory-host-core';
import { MEMORY_TOOLS, memoryParams, originFor, readNote, writeNote, currentDerivedText } from './notes.ts';
import { buildMemoryBackend } from './opencode-memory.ts';
import { buildGuiBackend } from './opencode-gui.ts';
import {configureGuiPolicy,isGuiTool,GuiObservations,GUI_ROLE,GUI_MCP_NAMES} from './gui-policy.ts';
import { buildDreamProvider, DREAM_ROUTE, DREAM_MODELS } from './gemini-dreaming.ts';
import { admitDreamingNotes, admitNativeRecallCall, readNativeDreaming, DREAMING_TOKEN } from './dreaming.ts';
import fs from 'node:fs';
import path from 'node:path';
import { installWork } from './work.ts';
import { createQuickTools, preserveFile, configureNativeRoot, localCall } from './quick.ts';
import { QUICK_TOOLS, operationHash } from './quick-policy.ts';
import { runBeforeToolCallHook, runAgentHarnessAfterToolCallHook } from 'openclaw/plugin-sdk/agent-harness-runtime';
import { dispatchGatewayMethod } from 'openclaw/plugin-sdk/gateway-method-runtime';
const scopeMetadata = (scope: Scope) => { const {quick: _quick, ...metadata}=scope; return metadata; };

export default definePluginEntry({
  id: 'jarvis', name: 'JARVIS permissions', description: 'Scoped host policy; no model-owned grants or resolver',
  register(api) {
    if(api.pluginConfig?.nativeRoot) { configureNativeRoot(api.pluginConfig.nativeRoot); protectHostRepo(path.resolve(String(api.pluginConfig.nativeRoot),'../..')); }
    if(api.pluginConfig?.guiNode)configureGuiPolicy(api.pluginConfig.guiNode,api.pluginConfig.nativeRoot);
    const guiObservations=new GuiObservations();
    let dreamingActive = false;
    let stopped = false;
    // Only completed availability failures may resume at the next native cron.
    // Unknown transport outcomes and host boundary failures remain held.
    const completionBlock = 'DREAMING_CONFIGURATION_BLOCKED: the dedicated Gemini free-tier route and its separate SecretRef must be configured. No alternate provider, paid fallback or unselected memory prompt is admitted.';
    let modelEvidence: Parameters<NonNullable<Parameters<typeof buildMemoryBackend>[0]>['onDecision']>[0] | undefined;
    let dreamingStatus: { phase: string; error?: string; admitted?: number; at?: string; evidence?: unknown } = { phase: 'idle' };
    api.registerCliBackend(buildMemoryBackend({ workspace: () => api.runtime.agent.resolveAgentWorkspaceDir(api.config, 'main'), onDecision: evidence => { modelEvidence = evidence; dreamingStatus = { ...dreamingStatus, phase: 'structured-decision', at: new Date().toISOString() }; } }));
    api.registerCliBackend(buildGuiBackend());
    api.registerProvider(buildDreamProvider(() => api.runtime.agent.resolveAgentWorkspaceDir(api.config, 'main'), evidence => {
      modelEvidence = evidence; dreamingStatus = { phase: 'structured-decision', evidence, at: new Date().toISOString() };
      api.logger.info(`JARVIS Dreaming host-validated decision: ${JSON.stringify(evidence)}`);
    }, message => { dreamingStatus = { phase: 'failed', error: message, at: new Date().toISOString() }; }));
    api.registerGatewayMethod('jarvis.memory.dreaming.status', async ({ respond }) => {
      try {
        const native = await readNativeDreaming(api);
        const file = path.join(workspace(), 'MEMORY.md');
        const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        const consolidated = new Set<string>();
        let consolidatedSection = false;
        for (const line of content.split(/\r?\n/)) {
          if (line.startsWith('## ')) consolidatedSection = line.startsWith('## Consolidated Memory (');
          const marker = /^<!-- openclaw-memory-promotion:(.+) -->$/.exec(line);
          if (consolidatedSection && marker) consolidated.add(marker[1]);
        }
        const published = modelEvidence && modelEvidence.keys.every(key => native.promotedEntries.some(e => e.key === key) && consolidated.has(key));
        const configuredDreaming = api.config.plugins?.entries?.['memory-core']?.config?.dreaming as { model?: unknown } | undefined;
        respond(true, { ...dreamingStatus, phase: published ? 'native-published' : dreamingStatus.phase, error: published ? undefined : dreamingStatus.error, configuredModel: configuredDreaming?.model, modelSequence: DREAM_MODELS, model: modelEvidence, native: { shortTermCount: native.shortTermCount, promotedTotal: native.promotedTotal }, published: Boolean(published), warning: 'An admitted candidate, empty sweep or append fallback alone is not structured Dreaming success' });
      } catch (e) { respond(true, { ...dreamingStatus, hostEvidenceError: e instanceof Error ? e.message : 'Native status unavailable', published: false }); }
    }, { scope: 'operator.read', profileAccess: 'required' });
    api.on('before_agent_reply', async (event, ctx) => {
      if (ctx.trigger !== 'cron' || ctx.agentId !== 'main' || !event.cleanedBody.includes(DREAMING_TOKEN)) return;
      if (dreamingActive || stopped) return { handled: true, reason: 'JARVIS Dreaming admission busy/stopped; no duplicate sweep' };
      if (dreamingStatus.phase === 'failed' && !dreamingStatus.error?.startsWith('DREAMING_UNAVAILABLE:')) return { handled: true, reason: dreamingStatus.error ?? 'Previous Dreaming failed; inspect before retry' };
      const config = api.config.plugins?.entries?.['memory-core']?.config?.dreaming as { model?: unknown } | undefined;
      if (config?.model === DREAM_ROUTE && api.config.models?.providers?.['jarvis-dream-google']?.apiKey) {
        modelEvidence = undefined;
        dreamingStatus = { phase: 'native-running', at: new Date().toISOString() };
        return;
      }
      dreamingStatus = { ...dreamingStatus, phase: 'model-blocked', error: completionBlock, at: new Date().toISOString() };
      return { handled: true, reason: completionBlock };
    }, { priority: 10000, eligibleTriggers: ['cron'] });
    // Ephemeral retained host authority only. OpenClaw owns run metadata,
    // transcripts and durable approvals; this is not a second registry/DB.
    const authorities = new Map<string, { scope: Scope; assertCurrent: () => void; release: () => void; signal: AbortSignal }>();
    const localAttempts=new Set<string>();
    const localScopes=new Set<string>();
    const hasTavilyKey = () => /^tvly-\S+$/.test(process.env.TAVILY_API_KEY ?? '');
    const drop = (runId: string) => { const old = authorities.get(runId); authorities.delete(runId); api.runContext.clearRunContext({ runId }); old?.release(); work?.release(runId); guiObservations.release(runId); for(const key of localAttempts)if(key.startsWith(runId+':'))localAttempts.delete(key); };
    const live = (runId?: string) => {
      if (!runId) return undefined;
      const binding = authorities.get(runId);
      if (!binding) return undefined;
      try { binding.assertCurrent(); if (binding.scope.expiresAt <= Date.now() || binding.signal.aborted) throw new Error('Expired');
        const stored = api.runContext.getRunContext({ runId, namespace: 'scope' });
        if (!stored) throw new Error('Run ended'); return binding;
      } catch { drop(runId); return undefined; }
    };
    const workspace = () => api.runtime.agent.resolveAgentWorkspaceDir(api.config, 'main');
    const work = typeof api.runtime?.state?.openKeyedStore === 'function' && typeof api.agent?.events?.registerAgentEventSubscription === 'function' ? installWork(api, live) : undefined;
    if (!work) api.logger?.warn?.('JARVIS stage 06 unavailable: native retained state/events required');
    const indexCommittedNote = async () => {
      try {
        const memory = getMemoryCapabilityRegistration();
        if (memory?.pluginId !== 'memory-core' || !memory.capability.runtime) throw new Error('Builtin Memory Core unavailable');
        const { manager, error } = await memory.capability.runtime.getMemorySearchManager({ cfg: api.config, agentId: 'main' });
        if (!manager?.sync) throw new Error(error ?? 'Native index sync unavailable');
        await manager.sync({ force: true, reason: 'jarvis-immediate-note-commit' });
        return { ready: true };
      } catch (e) { return { ready: false, error: e instanceof Error ? e.message : 'Index unavailable', sourceCommitted: true }; }
    };
    const admitCommittedNote = async (result: { note: { id: string }; dreaming: { eligible: boolean } }, index: { ready: boolean }, assertCurrent: () => void, sessionKey: string, verify = false) => {
      if (!result.dreaming.eligible || !index.ready) return { eligible: result.dreaming.eligible, requested: 0 };
      try { return await admitDreamingNotes(api, assertCurrent, [result.note.id], sessionKey, verify ? () => readNativeDreaming(api) : undefined); }
      catch (error) { return { error: error instanceof Error ? error.message : 'Native admission failed', sourceCommitted: true }; }
    };
    api.registerGatewayMethod('jarvis.memory.dreaming.admit', async options => {
      try {
        const { params, client, sessionAccessAuthority } = options;
        const binding = live(String(params.runId));
        if (!binding || binding.scope.role === 'research' || binding.scope.userId !== (client?.authenticatedUserProfile?.profileId ?? client?.authenticatedUserId) || binding.scope.deviceId !== client?.connect.device?.id || binding.scope.sessionId !== sessionAccessAuthority?.target.sessionId || binding.scope.sessionKey !== sessionAccessAuthority?.target.sessionKey || sessionAccessAuthority?.target.agentId !== 'main' || client?.connect.role !== 'operator' || client?.invalidated || !client?.connect.scopes?.includes('operator.write')) throw new Error('Current admitted operator task required');
        if (Object.keys(params).some(k => !['sessionKey', 'agentId', 'runId', 'ids'].includes(k)) || !Array.isArray(params.ids) || params.ids.length < 1 || params.ids.length > 6 || params.ids.some(id => typeof id !== 'string')) throw new Error('One to six explicit note IDs required');
        if (dreamingActive || stopped) throw new Error('Dreaming busy/stopped; no duplicate admission');
        dreamingActive = true;
        try {
          const current = () => { sessionAccessAuthority!.assertCurrent(); binding.assertCurrent(); if (!live(binding.scope.runId) || stopped) throw new Error('Task ended'); };
          const ids = params.ids as string[];
          for (const id of ids) if (readNote(workspace(), id).origin.userId !== binding.scope.userId) throw new Error('Record belongs to another principal');
          const result = await admitDreamingNotes(api, current, ids, binding.scope.sessionKey, () => readNativeDreaming(api));
          dreamingStatus = { phase: 'native-admitted', admitted: 'admitted' in result ? result.admitted : undefined, evidence: result.evidence, at: new Date().toISOString() };
          options.respond(true, result);
        } finally { dreamingActive = false; }
      } catch (e) { dreamingStatus = { phase: 'failed', error: e instanceof Error ? e.message : 'Admission failed', at: new Date().toISOString() }; options.respond(false, undefined, { code: 'INVALID_REQUEST', message: dreamingStatus.error! }); }
    }, { scope: 'operator.write', profileAccess: 'required', sessionAccess: { mode: 'write' } });
    const toolScope = (ctx: { agentId?: string; sessionId?: string; sessionKey?: string; assertInvocationCurrent: () => void }) => {
      ctx.assertInvocationCurrent();
      const matches = [...authorities.keys()].map(id => live(id)).filter(b => b && b.scope.agentId === ctx.agentId && b.scope.sessionId === ctx.sessionId && b.scope.sessionKey === ctx.sessionKey && b.scope.role !== 'research');
      if (ctx.agentId !== 'main' || matches.length !== 1) throw new Error('Current authorized main task required');
      return matches[0]!;
    };
    api.registerTool({ contextVersion: 2, create(ctx) {
      if (ctx.agentId !== 'main') return null;
      return createQuickTools(() => toolScope(ctx), () => { ctx.assertInvocationCurrent(); ctx.assertInputCommitAllowed?.(); });
    } }, { names: QUICK_TOOLS });
    api.registerTool({ contextVersion: 2, create(ctx) {
      if (ctx.agentId !== 'main' || !work) return null;
      return [{ name: 'jarvis_work_read', label: 'Çalışma kaydı', description: 'Read only the current task revision, host state and concise model contributions. No memory index, hidden reasoning, entire transcript, credentials or tool output.', parameters: { type: 'object' as const, properties: {}, additionalProperties: false }, async execute(_callId: string, args: Record<string, unknown>) {
        if (Object.keys(args).length) throw new Error('No parameters accepted');
        const b = toolScope(ctx), r = await work.ledger.get(b.scope.userId, b.scope.taskId); ctx.assertInvocationCurrent(); b.assertCurrent();
        const details = { taskId: r.taskId, projectId: r.projectId, revision: r.revision, state: r.state, operation: r.operation, result: r.result, blocker: r.blocker, model: r.model, updatedAt: r.updatedAt };
        return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
      } }, { name: 'jarvis_work_note', label: 'Çalışma notu', description: 'Add only a concise proposed plan, finding/source, rationale, pending decision or next step to the current host task revision. Read jarvis_work_read for current revision. This cannot change observed execution state, grant authority, verify effects, accept a plan, or prove a steer applied. progressClaim is explicitly an unverified model statement.', parameters: { type: 'object' as const, properties: { expectedRevision: { type: 'integer', minimum: 1 }, ...Object.fromEntries(['plan', 'finding', 'rationale', 'nextStep', 'pendingDecision', 'progressClaim'].map(k => [k, { type: 'string', maxLength: 1800 }])), inputId: { type: 'string', maxLength: 128 }, sources: { type: 'array', items: { type: 'string', maxLength: 512 }, maxItems: 8 } }, required: ['expectedRevision'], additionalProperties: false }, async execute(callId: string, args: Record<string, unknown>) {
        const b = toolScope(ctx), p = workNoteParams(args);
        const current = () => { ctx.assertInvocationCurrent(); b.assertCurrent(); if (!live(b.scope.runId)) throw new Error('Task ended'); ctx.assertInputCommitAllowed?.(); };
        const result = await work.ledger.change(b.scope.userId, b.scope.taskId, `model-note:${callId}`, 'model-contribution', p, r => {
          if (r.revision !== p.expectedRevision) throw new Error('Task revision changed; read current record');
          r.model = { ...r.model, ...Object.fromEntries(Object.entries(p).filter(([k]) => !['expectedRevision', 'inputId', 'progressClaim'].includes(k))) };
          if (p.inputId !== undefined || p.progressClaim !== undefined) {
            const steer = r.steering[String(p.inputId)]; if (!steer) throw new Error('No matching user steering input');
            if (p.progressClaim !== undefined) steer.modelClaim = String(p.progressClaim);
          }
        }, current);
        const details = { recorded: true, revision: result.record.revision, hostState: result.record.state, modelStatement: true };
        return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
      } }];
    } }, { names: WORK_TOOLS });
    api.registerTool({ contextVersion: 2, create(ctx) {
      if (ctx.agentId !== 'main') return null;
      const schemas: Record<string, Record<string, unknown>> = {
        jarvis_memory_search: { query: { type: 'string', maxLength: 256 } },
        jarvis_memory_get: { path: { type: 'string' }, from: { type: 'integer', minimum: 1 }, lines: { type: 'integer', minimum: 1, maximum: 80 } },
        jarvis_note_read: { id: { type: 'string' } },
        jarvis_note_write: { id: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 0 }, source: { type: 'string', enum: ['task', 'user'] }, category: { type: 'string', enum: ['preference', 'decision', 'correction', 'finding', 'inference'] }, content: { type: 'string', maxLength: 1800 }, sources: { type: 'array', items: { type: 'string' }, maxItems: 8 }, derivedFrom: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, revision: { type: 'integer', minimum: 1 } }, required: ['id', 'revision'], additionalProperties: false }, maxItems: 8 }, artifacts: { type: 'array', items: { type: 'string' }, maxItems: 8 } }
      };
      return MEMORY_TOOLS.map(name => ({ name, label: name, description: name === 'jarvis_note_write' ? 'Save important preferences/decisions/corrections immediately: source=user requires the complete current operator message, whitespace normalized, with no paraphrase. Otherwise source=task stores only findings/inferences as model/web data. CAS revision required; never save every chat turn. Admitted operator jarvis.memory.write also supports human note edits.' : 'Read shared source notes for the authorized JARVIS workspace; current record revisions only. No raw conversation recall.', parameters: { type: 'object' as const, properties: schemas[name], required: name === 'jarvis_note_write' ? ['expectedRevision', 'category', 'content'] : name === 'jarvis_note_read' ? ['id'] : name === 'jarvis_memory_get' ? ['path'] : ['query'], additionalProperties: false }, async execute(_callId: string, args: Record<string, unknown>) {
        const binding = toolScope(ctx); const scope = binding.scope;
        const assertCurrent = () => { ctx.assertInvocationCurrent(); binding.assertCurrent(); if (!live(scope.runId)) throw new Error('Task authority expired'); ctx.assertInputCommitAllowed?.(); };
        const p = memoryParams(name, args);
        let value: unknown;
        if (name === 'jarvis_note_write') {
          const { source, ...input } = p;
          if (source === 'user') {
            if (!scope.userStatement || input.content !== scope.userStatement || !['preference', 'decision', 'correction'].includes(String(input.category))) throw new Error('User source requires exact complete current admitted input; no model paraphrase');
            if (Array.isArray(input.sources) && input.sources.some(url => typeof url !== 'string' || !scope.userStatement!.includes(url))) throw new Error('A user-source URL must occur in the admitted user input');
            value = writeNote(workspace(), input, { ...originFor(scope, 'user'), userInputHash: fingerprint(scope.userStatement) }, assertCurrent, scope.root);
          } else value = writeNote(workspace(), input, originFor(scope, Array.isArray(p.sources) && p.sources.length ? 'web' : 'model'), assertCurrent, scope.root);
          const committed = value as ReturnType<typeof writeNote>;
          const index = await indexCommittedNote();
          value = { ...committed, index, nativeCandidate: await admitCommittedNote(committed, index, assertCurrent, scope.sessionKey) };
        }
        else if (name === 'jarvis_note_read') { value = readNote(workspace(), p.id); assertCurrent(); }
        else {
          const registration = getMemoryCapabilityRegistration();
          if (registration?.pluginId !== 'memory-core' || !registration.capability.runtime) throw new Error('Builtin Memory Core unavailable; no fallback');
          const runtime = registration.capability.runtime;
          const { manager, error } = await runtime.getMemorySearchManager({ cfg: api.config, agentId: 'main' });
          if (!manager) throw new Error(error ?? 'Local memory unavailable; model/runtime setup required, no cloud fallback');
          if (name === 'jarvis_memory_search') {
            const hits = await manager.search(String(p.query), { maxResults: 6, minScore: 0.35, sessionKey: scope.sessionKey, sources: ['memory'] });
            const allowed = runtime.authorizeSearchHits ? await runtime.authorizeSearchHits({ cfg: api.config, agentId: 'main', requesterSessionKey: scope.sessionKey, sandboxed: ctx.sandboxed ?? false, hits }) : [];
            const results = allowed.flatMap(hit => {
              try {
                if (!currentDerivedText(workspace(), hit.snippet)) return [];
                memoryParams('jarvis_memory_get', { path: hit.path });
                const record = /^memory\/records\/([^/]+)\/r(\d{8})\.md$/.exec(hit.path);
                if (!record) return [hit];
                const note = readNote(workspace(), record[1]);
                if (note.revision !== Number(record[2])) return [];
                const originClass: 'owner' | 'untrusted' | 'agent' = note.origin.kind === 'user' ? 'owner' : note.origin.kind === 'web' ? 'untrusted' : 'agent';
                return [{ ...hit, provenance: { ...hit.provenance, originClass, sessionKind: hit.provenance?.sessionKind ?? 'unknown', observedAt: Date.parse(note.recordedAt) }, sourceRecord: { id: note.id, revision: note.revision, recordedAt: note.recordedAt, origin: note.origin, derivedFrom: note.derivedFrom, sources: note.sources } }];
              } catch { return []; }
            });
            const status = manager.status();
            value = { results, provider: status.provider, fallback: status.fallback, vector: status.vector, fts: status.fts, embedding: manager.getCachedEmbeddingAvailability?.(), providerState: status.custom?.providerState, localSetup: api.config.models?.providers?.['llama-cpp']?.localService ? 'configured; use deep status to verify' : 'MISSING: download/setup of EmbeddingGemma and verified Windows runtime required; no cloud fallback', warning: 'Only selected source notes. Superseded revisions are filtered; index freshness may temporarily reduce results. Search results retain their source trust.' };
          } else {
            const record = /^memory\/records\/([^/]+)\/r(\d{8})\.md$/.exec(String(p.path));
            if (record && readNote(workspace(), record[1]).revision !== Number(record[2])) throw new Error('Superseded revision; use jarvis_note_read for current fact');
            const read = await manager.readFile({ relPath: String(p.path), from: Number(p.from), lines: Number(p.lines) });
            if (!currentDerivedText(workspace(), read.text)) throw new Error('Superseded derived view; use jarvis_note_read');
            value = read;
          }
          assertCurrent();
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: value };
      } }));
    } }, { names: MEMORY_TOOLS });
    // Human operator ingress only: identity and source are admitted host fields.
    // Gemini tool bridging is deliberately deferred to stage 12.
    api.registerGatewayMethod('jarvis.memory.write', async options => {
      try {
        const { client, sessionAccessAuthority, params } = options;
        const target = sessionAccessAuthority?.target;
        const userId = client?.authenticatedUserProfile?.profileId ?? client?.authenticatedUserId;
        const deviceId = client?.connect.device?.id;
        if (!userId || !deviceId || client?.invalidated || client?.connect.role !== 'operator' || !client.connect.scopes?.includes('operator.write') || !target || target.agentId !== 'main' || api.config.gateway?.controlUi?.dangerouslyDisableDeviceAuth === true) throw new Error('Verified main operator/session required');
        const binding = live(String(params.runId));
        if (!binding || binding.scope.userId !== userId || binding.scope.deviceId !== deviceId || binding.scope.sessionId !== target.sessionId || binding.scope.sessionKey !== target.sessionKey || binding.scope.role === 'research') throw new Error('Current matching task scope required');
        const { sessionKey: _sessionKey, agentId: _agentId, runId: _runId, ...input } = params;
        const result = writeNote(workspace(), input, originFor(binding.scope, 'user'), () => { sessionAccessAuthority!.assertCurrent(); binding.assertCurrent(); if (!live(binding.scope.runId)) throw new Error('Scope expired'); }, binding.scope.root);
        const index = await indexCommittedNote();
        const current = () => { sessionAccessAuthority!.assertCurrent(); binding.assertCurrent(); if (!live(binding.scope.runId)) throw new Error('Scope expired'); };
        options.respond(true, { ...result, index, nativeCandidate: await admitCommittedNote(result, index, current, binding.scope.sessionKey, true) });
      } catch (e) { options.respond(false, undefined, { code: 'INVALID_REQUEST', message: e instanceof Error ? e.message : 'Note refused' }); }
    }, { scope: 'operator.write', profileAccess: 'required', sessionAccess: { mode: 'write' } });
    api.registerGatewayMethod('jarvis.memory.read', options => {
      try {
        const { client, sessionAccessAuthority, params } = options;
        const userId = client?.authenticatedUserProfile?.profileId ?? client?.authenticatedUserId;
        if (!userId || !client?.connect.device?.id || client.invalidated || client.connect.role !== 'operator' || !client.connect.scopes?.includes('operator.read') || sessionAccessAuthority?.target.agentId !== 'main' || api.config.gateway?.controlUi?.dangerouslyDisableDeviceAuth === true) throw new Error('Verified main operator/session required');
        const { sessionKey: _sessionKey, agentId: _agentId, ...input } = params;
        const p = memoryParams('jarvis_note_read', input);
        sessionAccessAuthority.assertCurrent();
        const note = readNote(workspace(), p.id);
        sessionAccessAuthority.assertCurrent();
        options.respond(true, note);
      } catch (e) { options.respond(false, undefined, { code: 'INVALID_REQUEST', message: e instanceof Error ? e.message : 'Note read refused' }); }
    }, { scope: 'operator.write', profileAccess: 'required', sessionAccess: { mode: 'write' } });
    api.registerGatewayMethod('jarvis.scope.bind', async options => {
      let retained;
      try {
        const { client, sessionAccessAuthority, params, respond } = options;
        const deviceId = client?.connect.device?.id;
        const userId = client?.authenticatedUserProfile?.profileId ?? client?.authenticatedUserId;
        // Identity must come from admission, never params, text, voice or model.
        if (!client || client.invalidated || !userId || !deviceId || api.config.gateway?.controlUi?.dangerouslyDisableDeviceAuth === true || client.connect.role !== 'operator' || !client.connect.scopes?.includes('operator.write') || !sessionAccessAuthority) throw new Error('Verified device, operator profile and session authority required');
        sessionAccessAuthority.assertCurrent();
        const target = sessionAccessAuthority.target;
        const scope = await makeScope(params, { ...target, userId, deviceId });
        // A fresh operator turn releases completed direct local grants in this
        // same incarnation; it does not cancel another native or pending job.
        for(const id of localScopes) {
          const old=live(id)?.scope;
          if(!old || old.userId!==userId || old.deviceId!==deviceId || old.sessionId!==target.sessionId || id===scope.runId)continue;
          const record=await work?.ledger.get(userId,old.taskId).catch(()=>undefined);
          if(record && ['ended','failed','unknown'].includes(record.state)){drop(id);localScopes.delete(id);}
        }
        sessionAccessAuthority.assertCurrent();
        const existing = authorities.get(scope.runId)?.scope;
        if (existing && (existing.userId !== userId || existing.deviceId !== deviceId || existing.sessionId !== scope.sessionId)) throw new Error('Run already bound to another principal/session');
        if (authorities.size >= 100 && !authorities.has(scope.runId)) throw new Error('Too many retained scopes');
        retained = sessionAccessAuthority.retain();
        drop(scope.runId);
        if (!api.runContext.setRunContext({ runId: scope.runId, namespace: 'scope', value: scopeMetadata(scope) })) throw new Error('Host run metadata unavailable');
        const access = retained;
        const timer = setTimeout(() => drop(scope.runId), scope.expiresAt - Date.now()); timer.unref();
        const onAbort = () => drop(scope.runId);
        authorities.set(scope.runId, { scope, assertCurrent: access.assertCurrent, signal: access.signal, release: () => { clearTimeout(timer); access.signal.removeEventListener('abort', onAbort); access.release(); } });
        access.signal.addEventListener('abort', onAbort, { once: true });
        retained = undefined;
        respond(true, { bound: true, runId: scope.runId, sessionId: scope.sessionId, taskId: scope.taskId, expiresAt: scope.expiresAt });
      } catch (error) { retained?.release(); api.logger.warn(`JARVIS scope refused: ${error instanceof Error ? error.message : 'unavailable'}`); options.respond(false, undefined, { code: 'INVALID_REQUEST', message: 'JARVIS scope not bound: verified identity, session or parameters unavailable' }); }
    }, { scope: 'operator.write', profileAccess: 'required', sessionAccess: { mode: 'write' } });
    api.registerGatewayMethod('jarvis.quick.execute', async options => {
      const {params,client,sessionAccessAuthority:access}=options;
      let started=false; let admitted=false; let singleGrant=false; let outcome: unknown; let error: string | undefined;
      const runId=String(params.runId), callId=String(params.callId), name=String(params.tool);
      try {
        if(Object.keys(params).some(k=>!['sessionKey','agentId','runId','callId','tool','params'].includes(k)) || !/^[a-zA-Z0-9-]{1,128}$/.test(callId) || !QUICK_TOOLS.includes(name)) throw new Error('Narrow local call required');
        const b=live(runId);
        if(!b || !work || !access || client?.invalidated || client?.connect.role!=='operator' || !client.connect.scopes?.includes('operator.write') || b.scope.userId!==(client.authenticatedUserProfile?.profileId ?? client.authenticatedUserId) || b.scope.deviceId!==client.connect.device?.id || b.scope.sessionId!==access.target.sessionId || b.scope.sessionKey!==access.target.sessionKey) throw new Error('Exact operator/device/session required');
        const current=()=>{access.assertCurrent();b.assertCurrent();if(!live(runId)||client.invalidated)throw new Error('Local authority expired');}; current();
        const attempt=`${runId}:${callId}`; if(localAttempts.has(attempt))throw new Error('Local call already attempted'); localAttempts.add(attempt);
        await work.prepareLocal(b.scope,callId);
        localScopes.add(runId);singleGrant=b.scope.quick?.length===1;
        admitted=true;
        const args=params.params as Record<string,unknown>;
        const ctx={...access.target,runId};
        const gate=await runBeforeToolCallHook({toolName:name,toolCallId:callId,params:args,ctx,approvalMode:'defer'});
        if(gate.blocked) throw new Error(gate.reason);
        let frozen=structuredClone(args);
        if(gate.deferredApproval) {
          const {approval,overrideParams}=gate.deferredApproval; frozen=structuredClone(overrideParams) as Record<string,unknown>;
          const verdict=await dispatchGatewayMethod('plugin.approval.request',{pluginId:approval.pluginId,title:approval.title,description:approval.description,allowedDecisions:approval.allowedDecisions,severity:approval.severity,toolName:name,toolCallId:callId,agentId:access.target.agentId,sessionKey:access.target.sessionKey,timeoutMs:60000,twoPhase:false},{expectFinal:true,timeoutMs:65000});
          if(!verdict.ok || (verdict.payload as {decision?:string})?.decision!=='allow-once')throw new Error('Exact manual allow-once not received');
        }
        current(); started=true;
        const tool=createQuickTools(()=>b,current).find(t=>t.name===name)!;
        outcome=await tool.execute(callId,frozen);
      } catch(e) {error=e instanceof Error?e.message:'Local operation failed';}
      finally {
        if(access && admitted) await runAgentHarnessAfterToolCallHook({...access.target,runId,toolName:name,toolCallId:callId,startArgs:params.params as Record<string,unknown>,...(outcome!==undefined?{result:outcome}:{}),...(error?{error}: {})});
        if(admitted) {try{const b=live(runId);if(!b||!work)throw new Error('Local authority ended before result publication; effect unknown');await work.assertLocalResult(b.scope,callId);}catch(e){error=e instanceof Error?e.message:'Local result record unavailable';}}
        if(error && started) api.logger.warn('JARVIS local operation failed/unknown; automatic replay unavailable');
        if(admitted && singleGrant){drop(runId);localScopes.delete(runId);}
      }
      if(error)options.respond(false,undefined,{code:'INVALID_REQUEST',message:error});else options.respond(true,outcome);
    }, {scope:'operator.write',profileAccess:'required',sessionAccess:{mode:'write'}});
    api.registerGatewayMethod('jarvis.policy.status', ({ respond }) => respond(true, { version: '2026.10.2', tools: hasTavilyKey() ? ['tavily_search', 'web_fetch'] : ['web_fetch'], quickTools:QUICK_TOOLS, quickMethod:'jarvis.quick.execute', search: { provider: 'tavily', depth: 'advanced', key: hasTavilyKey() ? 'present; account access must be tested' : 'missing', genericWebSearch: 'disabled', fallback: 'disabled' }, rawExec: 'closed', payment: 'manual exact browser action approval only; voice binding remains stage 13', scopes: authorities.size }), { scope: 'operator.read' });
    api.registerGatewayMethod('jarvis.gui.status',async({respond})=>{
      try {
          const activity=await localCall('activity',{});
        const nodeId=api.pluginConfig?.guiNode;
        const described=nodeId?await dispatchGatewayMethod('node.describe',{nodeId}):undefined;
        const rawNode=described?.ok?described.payload as Record<string,unknown>:undefined;
        const node=rawNode?{nodeId:rawNode.nodeId,displayName:rawNode.displayName,platform:rawNode.platform,version:rawNode.version,clientId:rawNode.clientId,clientMode:rawNode.clientMode,deviceFamily:rawNode.deviceFamily,caps:rawNode.caps,commands:rawNode.commands,computerUse:rawNode.computerUse,sessionHost:rawNode.sessionHost,approvalState:rawNode.approvalState,paired:rawNode.paired,connected:rawNode.connected}:null;
          respond(true,{version:'2026.10.2',node,desktop:{interactive:activity.interactive===true,physicalInputDistinguished:activity.physicalInputDistinguished===true},selectedMcp:{package:'windows-mcp',version:'0.8.8',transport:'stdio',offline:true,tools:GUI_MCP_NAMES,sessionLifetime:'native OpenClaw'},input:'CUA background input is limited to the current user task and fresh exact window/element observations; uncertain results require same-window readback and cannot be replayed. Windows-MCP input effects remain closed.',workerBridge:'jarvis-opencode-gui is registered for Space Bunny image and guarded OpenClaw MCP calls; it does not change the default model route',defaultPolicy:GUI_ROLE});
      }catch(e){respond(false,undefined,{code:'UNAVAILABLE',message:e instanceof Error?e.message:'GUI status unavailable'});}
    },{scope:'operator.read'});
    api.on('before_tool_call', async (event, ctx) => {
      const native = admitNativeRecallCall(event, ctx);
      if (native) return native;
      const binding = live(ctx.runId);
      const decision = await evaluate(event, ctx, binding?.scope);
      if (binding && !('block' in decision)) {
        if([...QUICK_TOOLS,'browser'].includes(event.toolName)||isGuiTool(event.toolName)) {
          if(!work)return {block:true,blockReason:'Native work/resource ledger unavailable'};
          await work.ensureLocal(binding.scope);
        }
        if(isGuiTool(event.toolName))try{guiObservations.before(binding.scope.runId,event.toolName,event.params);}catch(e){return {block:true,blockReason:e instanceof Error?e.message:'GUI observation unavailable'};}
        try { await work?.beforeTool({ ...event, params: 'params' in decision ? decision.params ?? event.params : event.params }, ctx); }
        catch (e) { return { block: true, blockReason: e instanceof Error ? e.message : 'Work resource unavailable' }; }
        if (['write', 'edit'].includes(event.toolName) && !('requireApproval' in decision)) {
          try { binding.assertCurrent(); await preserveFile(String(decision.params?.path ?? event.params.path), binding.scope); }
          catch (e) { return { block: true, blockReason: e instanceof Error ? e.message : 'Undo unavailable; write refused' }; }
        }
        if (event.toolName === 'browser' && ['open', 'navigate'].includes(String(event.params.action)) && event.params.url!=='about:blank') {
          try { await resolvePinnedHostnameWithPolicy(new URL(String(event.params.url)).hostname, { policy: { allowPrivateNetwork: false }, signal: ctx.abortSignal }); binding.assertCurrent(); }
          catch { return { block: true, blockReason: 'Browser public destination unavailable/denied' }; }
        }
      }
      if (binding?.scope.role === 'research' && !('block' in decision)) {
        if (event.toolName === 'tavily_search' && !hasTavilyKey()) return { block: true, blockReason: 'TAVILY_API_KEY missing; search unavailable, no fallback' };
        if (event.toolName === 'web_fetch') {
          const url = publicUrl(event.params.url);
          await resolvePinnedHostnameWithPolicy(new URL(url).hostname, { policy: { allowPrivateNetwork: false }, signal: ctx.abortSignal });
          binding.assertCurrent();
          if (!live(ctx.runId)) return { block: true, blockReason: 'Research scope expired' };
        }
      }
      return decision;
    }, { priority: 10000 });
    api.on('before_prompt_build', (_event, ctx) => ctx.agentId === 'research' ? { systemPrompt: READER_PROMPT, toolsAllow: hasTavilyKey() ? ['tavily_search', 'web_fetch'] : ['web_fetch'] } : ctx.agentId==='main'&&api.pluginConfig?.guiNode?{appendSystemContext:GUI_ROLE}:undefined, { priority: 10000 });
    api.on('before_agent_run', (event, ctx) => {
      if (ctx.agentId !== 'research') return;
      const scope = live(ctx.runId)?.scope;
      if (!scope || event.prompt !== scope.publicPrompt || event.systemPrompt !== READER_PROMPT || event.messages.length > 0) return { outcome: 'block' as const, reason: 'Reader requires a fresh isolated public-input turn', message: 'Araştırma özel bağlam veya doğrulanmamış giriş nedeniyle başlatılmadı.' };
      if (scope.query && !hasTavilyKey()) return { outcome: 'block' as const, reason: 'Tavily credential unavailable', message: 'Tavily API anahtarı tanımlanmamış; arama başlatılmadı. Ücretli veya başka sağlayıcıya geçilmedi.' };
    });
    api.on('before_message_write', (event, ctx) => {
      if (ctx.agentId !== 'research' || event.message.role !== 'assistant' || !Array.isArray(event.message.content)) return;
      return { message: { ...event.message, content: event.message.content.map(part => part.type === 'text' ? { ...part, text: JSON.stringify({ kind: 'reader-summary', trust: 'untrusted', authority: 'none', content: part.text }) } : part) } };
    });
    // Both tools are OpenClaw/native official tools. JARVIS only gates and labels
    // them; it does not implement another search transport or expose Extract.
    api.on('after_tool_call', (event, ctx) => {
      if(isGuiTool(event.toolName)&&ctx.runId)guiObservations.after(ctx.runId,event.toolName,event.params,event.result,event.error);
      if(event.toolName==='browser' && ['open','navigate','act','close','focus','start'].includes(String(event.params.action))) {
        const binding=live(ctx.runId);
        if(binding) binding.scope.quick=binding.scope.quick?.filter(g=>g.tool!=='browser' || operationHash(g.params)!==operationHash(event.params));
      }
      if (ctx.agentId !== 'research' || !['tavily_search', 'web_fetch'].includes(event.toolName)) return;
      const binding = live(ctx.runId); if (!binding) return;
      const details = (event.result as { details?: Record<string, unknown> } | undefined)?.details;
      const error = event.error ?? (typeof details?.error === 'string' ? details.error : undefined);
      if (error) {
        binding.scope.searchFailed = true;
        api.runContext.setRunContext({ runId: binding.scope.runId, namespace: 'scope', value: scopeMetadata(binding.scope) });
        const category = /432|429|quota|credit|limit/i.test(error) ? 'quota/rate-limit' : /401|403|api.key|auth/i.test(error) ? 'access' : 'network/response';
        api.agent.events.emitAgentEvent({ runId: binding.scope.runId, stream: 'tool', data: { kind: 'jarvis.research-stopped', taskId: binding.scope.taskId, category, fallback: false } });
        return;
      }
      const candidates = event.toolName === 'tavily_search' && Array.isArray(details?.results) ? details.results.map(r => (r as { url?: unknown })?.url) : [details?.finalUrl ?? details?.url];
      const urls: string[] = [];
      for (const candidate of candidates) {
        try { const url = publicUrl(candidate); if (!isBlockedHostnameOrIp(new URL(url).hostname)) urls.push(url); } catch { /* unusable source grants no URL access */ }
      }
      if (event.toolName === 'tavily_search') binding.scope.urls = [...new Set([...binding.scope.urls, ...urls])].slice(0, 20);
      api.runContext.setRunContext({ runId: binding.scope.runId, namespace: 'scope', value: scopeMetadata(binding.scope) });
      api.agent.events.emitAgentEvent({ runId: binding.scope.runId, stream: 'tool', data: { kind: 'jarvis.external-source', taskId: binding.scope.taskId, tool: event.toolName, provider: event.toolName === 'tavily_search' ? 'tavily' : 'local', depth: event.toolName === 'tavily_search' ? 'advanced' : 'local', urls, recordedAt: new Date().toISOString(), sha256: fingerprint(details ?? {}), trust: 'untrusted', authority: 'none' } });
    });
    api.on('tool_result_persist', (event, ctx) => {
      if (ctx.agentId !== 'research' || !['tavily_search', 'web_fetch'].includes(event.toolName ?? '') || event.message.role !== 'toolResult') return;
      return { message: { ...event.message, content: event.message.content.map(part => part.type === 'text' ? { ...part, text: JSON.stringify({ kind: 'external-data', tool: event.toolName, trust: 'untrusted', authority: 'none', content: part.text }) } : part) } };
    });
    api.on('agent_end', (event, ctx) => { const runId = event.runId ?? ctx.runId; if (runId) drop(runId); });
    api.on('gateway_stop', () => { stopped = true; for (const runId of authorities.keys()) drop(runId); });
  }
});
