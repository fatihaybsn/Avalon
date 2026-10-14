// Versioned, narrow addition to native Talk. All calls re-enter the native
// authenticated router; no synthetic operator, token service or task engine.
export async function routeTalkExtension(request, phase, data, dispatch) {
  if (!['catalog', 'open', 'transcript', 'close', 'execute','startPrepared'].includes(phase)) throw new Error('Unknown Talk extension phase');
  const {client, context} = request;
  const user = client?.authenticatedUserProfile?.profileId ?? client?.authenticatedUserId;
  if (!user || !client?.connect.device?.id || client.invalidated || client.connect.role !== 'operator' || !context.isConnectionActive?.(client.connId)) throw new Error('Current Talk device required');
  request.sessionMutationAuthorization?.assertCurrent();
  const result = await dispatch(`jarvis.live.${phase}`, data, {
    client, context, isWebchatConnect: request.isWebchatConnect ?? (() => false),
    methodRegistry: context.getGatewayMethodRegistry?.(),
    hasCurrentClientAuthority: () => !client.invalidated && context.isConnectionActive?.(client.connId) === true,
    sessionMutationCommitGuard: () => request.sessionMutationAuthorization?.assertCurrent(),
    signal: request.signal, expectFinal: true, timeoutMs: phase === 'execute' ? 65000 : 10000
  });
  if (!result.ok) throw new Error(result.error?.message ?? 'Talk extension refused');
  return result.payload;
}
