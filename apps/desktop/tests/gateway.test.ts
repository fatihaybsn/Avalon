import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, createPublicKey, verify } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Gateway, RpcError } from '../src/main/gateway.ts';
import type { DeviceVault, Identity } from '../src/main/vault.ts';
import { buildDeviceAuthPayloadV3 } from '../vendor/openclaw/packages/gateway-client/src/device-auth.ts';

async function fixture(onRequest: (ws: any, request: any, identity: Identity) => void) {
  const pair = generateKeyPairSync('ed25519');
  const raw = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const identity: Identity = { deviceId: createHash('sha256').update(raw).digest('hex'), publicKey: raw.toString('base64url'), privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() };
  const vault = { identity, load: async () => identity, acceptToken: async (token: string, scopes: string[]) => { identity.token = token; identity.scopes = scopes; } } as unknown as DeviceVault;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  server.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'server-owned-nonce', ts: 1800000000000 } }));
    ws.on('message', b => onRequest(ws, JSON.parse(b.toString()), identity));
  });
  const address = server.address() as { port: number };
  const states: any[] = [];
  const gateway = new Gateway({ url: `ws://127.0.0.1:${address.port}`, origin: `http://127.0.0.1:${address.port}`, token: 'fake-bootstrap-only', agentId: 'main' }, vault, s => states.push(s), async () => {}, () => {});
  return { gateway, states, identity, close: async () => { gateway.stop(); for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); } };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Fixture timeout'); await new Promise(r => setTimeout(r, 20)); }
}
test('signed v3 handshake binds nonce/timestamp/scopes and pairing failure stays visible without auth retry', async () => {
  let attempts = 0;
  const f = await fixture((ws, frame, i) => {
    assert.equal(frame.method, 'connect'); attempts++;
    const p = frame.params;
    assert.deepEqual(p.scopes, ['operator.read', 'operator.write', 'operator.approvals']); assert.equal(p.device.nonce, 'server-owned-nonce'); assert.equal(p.device.signedAt, 1800000000000);
    const payload = buildDeviceAuthPayloadV3({ deviceId: i.deviceId, clientId: p.client.id, clientMode: p.client.mode, role: p.role, scopes: p.scopes, signedAtMs: p.device.signedAt, token: p.auth.token, nonce: p.device.nonce, platform: p.client.platform, deviceFamily: p.client.deviceFamily });
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: p.device.publicKey }, format: 'jwk' });
    assert.equal(verify(null, Buffer.from(payload), key, Buffer.from(p.device.signature, 'base64url')), true);
    ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: false, error: { code: 'NOT_PAIRED', details: { code: 'PAIRING_REQUIRED', requestId: 'exact-request' } } }));
  });
  try {
    await f.gateway.start(); await until(() => f.states.some(s => s.phase === 'pairing'));
    await new Promise(r => setTimeout(r, 1200)); assert.equal(attempts, 1); assert.equal(f.states.at(-1).phase, 'pairing'); assert.equal(f.states.at(-1).requestId, 'exact-request');
    assert.equal(JSON.stringify(f.states).includes('fake-bootstrap-only'), false);
  } finally { await f.close(); }
});
test('socket loss marks a sent write unknown; reconnect reauthenticates without replaying the write', async () => {
  let connects = 0, writes = 0;
  const f = await fixture((ws, frame) => {
    if (frame.method === 'connect') {
      connects++;
      ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { protocol: 4, server: { version: '2026.10.2' }, auth: { deviceToken: 'fixture-device-token', scopes: ['operator.read', 'operator.write', 'operator.approvals'] } } }));
    } else { writes++; ws.terminate(); }
  });
  try {
    await f.gateway.start(); await until(() => f.gateway.connected);
    await assert.rejects(f.gateway.request('chat.send', { sessionKey: 'agent:main:test', message: 'test', idempotencyKey: 'fixed-run' }, true), e => e instanceof RpcError && e.code === 'WRITE_OUTCOME_UNKNOWN');
    await until(() => connects === 2 && f.gateway.connected);
    assert.equal(writes, 1); assert.equal(f.identity.token, 'fixture-device-token');
  } finally { await f.close(); }
});
