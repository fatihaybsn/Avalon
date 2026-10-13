import { resolvePinnedHostnameWithPolicy, createPinnedDispatcher, closeDispatcher, type LookupFn } from 'openclaw/plugin-sdk/ssrf-runtime';
import { fetchWithRuntimeDispatcher } from 'openclaw/plugin-sdk/runtime-fetch';
import { createHash } from 'node:crypto';
import { publicUrl } from './policy.ts';

export async function readPublic(url: string, assertCurrent: () => void, signal?: AbortSignal, transport: { lookupFn?: LookupFn; fetch?: typeof fetchWithRuntimeDispatcher } = {}) {
  let current = publicUrl(url);
  const visited: string[] = [];
  // Handle every redirect ourselves so URL/query admission precedes each DNS
  // lookup. Public SDK pins DNS and rejects private/loopback/mapped addresses.
  for (let hop = 0; hop <= 4; hop++) {
    assertCurrent(); visited.push(current);
    let dispatcher;
    let response: Response | undefined;
    try {
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
      const pinned = await resolvePinnedHostnameWithPolicy(new URL(current).hostname, { policy: { allowPrivateNetwork: false }, signal: requestSignal, lookupFn: transport.lookupFn });
      dispatcher = createPinnedDispatcher(pinned, { mode: 'direct' }, { allowPrivateNetwork: false }, 10_000);
      assertCurrent();
      const init: RequestInit & { dispatcher: typeof dispatcher } = { dispatcher, method: 'GET', redirect: 'manual', signal: requestSignal, credentials: 'omit', headers: { Accept: 'text/html,text/plain,application/json', 'User-Agent': 'JARVIS-Public-Reader/0.3' } };
      response = await (transport.fetch ?? fetchWithRuntimeDispatcher)(current, init);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === 4) throw new Error('Redirect limit');
        const location = response.headers.get('location');
        if (!location) throw new Error('Missing redirect location');
        current = publicUrl(new URL(location, current).href);
        continue;
      }
      if (!response.ok) throw new Error(`Public reader HTTP ${response.status}`);
      if (!/^(text\/(html|plain)|application\/json)\b/i.test(response.headers.get('content-type') ?? '')) throw new Error('Unsupported public content type');
      if (Number(response.headers.get('content-length')) > 262144) throw new Error('Public content too large');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing public response');
      const chunks: Uint8Array[] = []; let count = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; count += value.length; if (count > 262144) throw new Error('Public content too large'); chunks.push(value); } }
      finally { await reader.cancel(); }
      assertCurrent();
      const content = Buffer.concat(chunks).toString('utf8');
      return { kind: 'external-data', trust: 'untrusted', authority: 'none', readerSummaryTrust: 'untrusted', source: { requestedUrl: url, finalUrl: current, redirects: visited.slice(1), fetchedAt: new Date().toISOString(), sha256: createHash('sha256').update(content).digest('hex') }, content };
    } finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); await closeDispatcher(dispatcher); }
  }
  throw new Error('Public read did not complete');
}
