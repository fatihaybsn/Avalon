// The 2026.10.2 npm package exports this public module but omits its .d.ts.
// Signature verified in dist/plugin-sdk/runtime-fetch.js and its public runtime.
declare module 'openclaw/plugin-sdk/runtime-fetch' {
  export function fetchWithRuntimeDispatcher(input: string | URL, init?: RequestInit & { dispatcher?: unknown }): Promise<Response>;
}
