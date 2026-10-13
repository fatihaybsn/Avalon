import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { makeScope, evaluate, READER_PROMPT, publicUrl, fingerprint, type Scope } from './policy.ts';
import { isBlockedHostnameOrIp, resolvePinnedHostnameWithPolicy } from 'openclaw/plugin-sdk/ssrf-runtime';
import { getMemoryCapabilityRegistration } from 'openclaw/plugin-sdk/memory-host-core';
import { MEMORY_TOOLS, memoryParams, originFor, readNote, writeNote, currentDerivedText } from './notes.ts';
import { buildMemoryBackend } from './opencode-memory.ts';
import { admitDreamingNotes, DREAMING_TOKEN } from './dreaming.ts';

export default definePluginEntry({
  id: 'jarvis', name: 'JARVIS permissions', description: 'Scoped host policy; no model-owned grants or resolver',
  register(api) {
    api.registerCliBackend(buildMemoryBackend());
    let dreamingActive = false;
    let stopped = false;
    let dreamingStatus: { phase: string; error?: string; admitted?: number; at?: string } = { phase: 'idle' };
    api.registerGatewayMethod('jarvis.memory.dreaming.status', ({ respond }) => respond(true, dreamingStatus), { scope: 'operator.read', profileAccess: 'required' });
    api.on('before_agent_reply', async (event, ctx) => {
      if (ctx.trigger !== 'cron' || ctx.agentId !== 'main' || !event.cleanedBody.includes(DREAMING_TOKEN)) return;
      if (dreamingActive || stopped) return { handled: true, reason: 'JARVIS Dreaming admission busy/stopped; no duplicate sweep' };
      dreamingActive = true;
      dreamingStatus = { phase: 'admission', at: new Date().toISOString() };
      try {
        const result = await admitDreamingNotes(api, () => { if (stopped) throw new Error('Gateway stopped'); });
        dreamingStatus = { phase: 'native-processing', admitted: result.admitted, at: new Date().toISOString() };
        // Native Memory Core's next claim hook owns ranking/consolidation/CAS.
      } catch (error) {
        dreamingStatus = { phase: 'failed', error: error instanceof Error ? error.message : 'Local admission failed', at: new Date().toISOString() };
        api.logger.warn(`JARVIS Dreaming deferred: ${error instanceof Error ? error.message : 'local source unavailable'}`);
        return { handled: true, reason: 'Local Dreaming admission failed; cloud inference withheld' };
      } finally { dreamingActive = false; }
    }, { priority: 10000, eligibleTriggers: ['cron'] });
    // Ephemeral retained host authority only. OpenClaw owns run metadata,
    // transcripts and durable approvals; this is not a second registry/DB.
    const authorities = new Map<string, { scope: Scope; assertCurrent: () => void; release: () => void; signal: AbortSignal }>();
    const hasTavilyKey = () => /^tvly-\S+$/.test(process.env.TAVILY_API_KEY ?? '');
    const drop = (runId: string) => { const old = authorities.get(runId); authorities.delete(runId); api.runContext.clearRunContext({ runId }); old?.release(); };
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
    const toolScope = (ctx: { agentId?: string; sessionId?: string; sessionKey?: string; assertInvocationCurrent: () => void }) => {
      ctx.assertInvocationCurrent();
      const matches = [...authorities.keys()].map(id => live(id)).filter(b => b && b.scope.agentId === ctx.agentId && b.scope.sessionId === ctx.sessionId && b.scope.sessionKey === ctx.sessionKey && b.scope.role !== 'research');
      if (ctx.agentId !== 'main' || matches.length !== 1) throw new Error('Current authorized main task required');
      return matches[0]!;
    };
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
    api.registerGatewayMethod('jarvis.memory.write', options => {
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
        options.respond(true, result);
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
        sessionAccessAuthority.assertCurrent();
        const existing = authorities.get(scope.runId)?.scope;
        if (existing && (existing.userId !== userId || existing.deviceId !== deviceId || existing.sessionId !== scope.sessionId)) throw new Error('Run already bound to another principal/session');
        if (authorities.size >= 100 && !authorities.has(scope.runId)) throw new Error('Too many retained scopes');
        retained = sessionAccessAuthority.retain();
        drop(scope.runId);
        if (!api.runContext.setRunContext({ runId: scope.runId, namespace: 'scope', value: { ...scope } })) throw new Error('Host run metadata unavailable');
        const access = retained;
        const timer = setTimeout(() => drop(scope.runId), scope.expiresAt - Date.now()); timer.unref();
        const onAbort = () => drop(scope.runId);
        authorities.set(scope.runId, { scope, assertCurrent: access.assertCurrent, signal: access.signal, release: () => { clearTimeout(timer); access.signal.removeEventListener('abort', onAbort); access.release(); } });
        access.signal.addEventListener('abort', onAbort, { once: true });
        retained = undefined;
        respond(true, { bound: true, runId: scope.runId, sessionId: scope.sessionId, taskId: scope.taskId, expiresAt: scope.expiresAt });
      } catch (error) { retained?.release(); api.logger.warn(`JARVIS scope refused: ${error instanceof Error ? error.message : 'unavailable'}`); options.respond(false, undefined, { code: 'INVALID_REQUEST', message: 'JARVIS scope not bound: verified identity, session or parameters unavailable' }); }
    }, { scope: 'operator.write', profileAccess: 'required', sessionAccess: { mode: 'write' } });
    api.registerGatewayMethod('jarvis.policy.status', ({ respond }) => respond(true, { version: '2026.10.2', tools: hasTavilyKey() ? ['tavily_search', 'web_fetch'] : ['web_fetch'], search: { provider: 'tavily', depth: 'advanced', key: hasTavilyKey() ? 'present; account access must be tested' : 'missing', genericWebSearch: 'disabled', fallback: 'disabled' }, rawExec: 'closed', payment: 'closed until manual client binding in stage 13', scopes: authorities.size }), { scope: 'operator.read' });
    api.on('before_tool_call', async (event, ctx) => {
      const binding = live(ctx.runId);
      const decision = await evaluate(event, ctx, binding?.scope);
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
    api.on('before_prompt_build', (_event, ctx) => ctx.agentId === 'research' ? { systemPrompt: READER_PROMPT, toolsAllow: hasTavilyKey() ? ['tavily_search', 'web_fetch'] : ['web_fetch'] } : undefined, { priority: 10000 });
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
      if (ctx.agentId !== 'research' || !['tavily_search', 'web_fetch'].includes(event.toolName)) return;
      const binding = live(ctx.runId); if (!binding) return;
      const details = (event.result as { details?: Record<string, unknown> } | undefined)?.details;
      const error = event.error ?? (typeof details?.error === 'string' ? details.error : undefined);
      if (error) {
        binding.scope.searchFailed = true;
        api.runContext.setRunContext({ runId: binding.scope.runId, namespace: 'scope', value: { ...binding.scope } });
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
      api.runContext.setRunContext({ runId: binding.scope.runId, namespace: 'scope', value: { ...binding.scope } });
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
