export const CODEX_AGENT = 'jarvis-codex';
// Native Codex must not inherit a finite generic tool allowlist. Preserve the
// same effective allow/deny for every existing agent before adding the leaf.
export function separateCodexTools(config, profileDir) {
  const globalAllow = config.tools.allow;
  const globalDeny = config.tools.deny ?? [];
  for (const [id, agent] of Object.entries(config.agents.entries)) {
    if (id === CODEX_AGENT) continue;
    agent.tools ??= {};
    if (globalAllow) agent.tools.allow = agent.tools.allow ? agent.tools.allow.filter(n => globalAllow.includes(n)) : [...globalAllow];
    agent.tools.deny = [...new Set([...globalDeny, ...(agent.tools.deny ?? [])])];
  }
  delete config.tools.allow; delete config.tools.deny;
  config.agents.entries[CODEX_AGENT] = {
    workspace: `${profileDir}/codex-worker`,
    // Default profile narrowing does not disable the native Codex surface.
    // No generic host command runner is added to this leaf.
    tools: { profile: 'minimal' }, model: { fallbacks: [] }, subagents: { allowAgents: [] }, skills: [],
  };
  return config;
}
