import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { makeScope, evaluate, READER_PROMPT, publicUrl, fingerprint, type Scope } from './policy.ts';
import { isBlockedHostnameOrIp, resolvePinnedHostnameWithPolicy } from 'openclaw/plugin-sdk/ssrf-runtime';

export default definePluginEntry({
  id: 'jarvis', name: 'JARVIS permissions', description: 'Scoped host policy; no model-owned grants or resolver',
  register(api) {
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
    api.on('gateway_stop', () => { for (const runId of authorities.keys()) drop(runId); });
  }
});
