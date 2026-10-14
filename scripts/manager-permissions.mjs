// Only the normal JARVIS manager. Full access coding sessions keep their policy.
export const MANAGER_PERMISSIONS = [
  {action:'*',resource:'*',effect:'deny'},
  {action:'openclaw_*',resource:'*',effect:'allow'},
];
export const MANAGER_AGENT = {description:'OpenClaw-owned task planner and reviewer',mode:'primary',permissions:MANAGER_PERMISSIONS};
export function assertManagerSession(session, expectedId) {
  if(session?.id!==expectedId||session.agent!=='jarvis-manager'||JSON.stringify(session.permissions)!==JSON.stringify(MANAGER_PERMISSIONS))
    throw new Error('Normal JARVIS manager native permissions not proven; inference blocked, no fallback');
}
