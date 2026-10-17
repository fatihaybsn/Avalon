// Only the normal JARVIS manager. Full access coding sessions keep their policy.
//
// The third entry grants no capability. OpenCode's free-tier gateway rejects any
// request whose outgoing tool list has lost the local `read` tool
// (anomalyco/opencode#51241), so a deny-everything manager turn failed before
// inference with HTTP 403 FreeTierError. One surviving narrow `read` allow on a
// literal path that does not exist keeps the tool in the request and leaves the
// manager blind: `write`/`edit` stay denied, so the agent cannot create that
// file, and no existing path matches it.
export const MANAGER_READ_PROBE_PATH = 'C:\\jarvis-unreachable-allowlist\\readable.txt';
export const MANAGER_PERMISSIONS = [
  {action:'*',resource:'*',effect:'deny'},
  {action:'openclaw_*',resource:'*',effect:'allow'},
  {action:'read',resource:MANAGER_READ_PROBE_PATH,effect:'allow'},
];
export const MANAGER_AGENT = {description:'OpenClaw-owned task planner and reviewer',mode:'primary',permissions:MANAGER_PERMISSIONS};
export function assertManagerSession(session, expectedId) {
  if(session?.id!==expectedId||session.agent!=='jarvis-manager'||JSON.stringify(session.permissions)!==JSON.stringify(MANAGER_PERMISSIONS))
    throw new Error('Normal JARVIS manager native permissions not proven; inference blocked, no fallback');
}
