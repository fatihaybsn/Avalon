import WebSocket from 'ws';
import { randomUUID, sign } from 'node:crypto';
import { buildDeviceAuthPayloadV3 } from '../../vendor/openclaw/packages/gateway-client/src/device-auth.ts';
import type { DeviceVault } from './vault.ts';
import type { Profile } from './profile.ts';
import type { Snapshot } from '../shared/contracts.ts';

export const GATEWAY_VERSION = '2026.10.2';
export const BUILD_ID = '2026.10.2-release-b8952d477f0c-2026-10-11T22-38-10.004Z';
const SCOPES = ['operator.read', 'operator.write', 'operator.approvals'];
type Pending = { resolve: (payload: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; mutation: boolean };
export class RpcError extends Error {
  constructor(public code: string, public details: Record<string, any> = {}) { super(code); }
}
export interface Rpc { connected: boolean; request(method: string, params: object, mutation?: boolean): Promise<any> }
export class Gateway implements Rpc {
  connected = false;
  private socket?: WebSocket;
  private pending = new Map<string, Pending>();
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private stopped = true;
  private pause = false;
  private attempt = 0;
  private generation = 0;
  private lastTick = 0;
  private seq?: number;
  private liveScopes: string[] = [];
  constructor(
    private profile: Profile, private vault: DeviceVault,
    private state: (s: Snapshot['connection']) => void,
    private hello: () => Promise<void>, private event: (event: string, payload: any) => void
  ) {}
  async start() {
    this.stop(); this.stopped = false; this.pause = false; this.attempt = 0;
    try { await this.vault.load(); } catch { this.pause = true; this.state({ phase: 'blocked', detail: 'Windows kullanıcı sır koruması veya kayıt doğrulanamadı.' }); return; }
    this.connect();
  }
  hasScope(scope: string) { return this.connected && this.liveScopes.includes(scope); }
  private connect() {
    if (this.stopped || this.pause) return;
    const i = this.vault.identity!;
    if (!i.token && !this.profile.token) { this.pause = true; this.state({ phase: 'auth', detail: 'JARVIS_GATEWAY_TOKEN eksik. Yetkili kullanıcı bağlantısını kurup uygulamayı yeniden açın.', deviceId: i.deviceId }); return; }
    const generation = ++this.generation;
    this.seq = undefined;
    this.state({ phase: 'connecting', detail: 'Gateway bağlantısı kuruluyor…', deviceId: i.deviceId });
    const ws = new WebSocket(this.profile.url, { origin: this.profile.origin, maxPayload: 2 * 1024 * 1024, handshakeTimeout: 10000, followRedirects: false });
    this.socket = ws;
    let challenged = false;
    const handshake = setTimeout(() => { if (!this.connected) ws.terminate(); }, 15000);
    ws.on('error', () => {}); // close handles transport failure; never print credentials.
    ws.on('message', async data => {
      if (generation !== this.generation || this.stopped) return;
      let frame: any;
      try { frame = JSON.parse(data.toString()); } catch { ws.close(1002); return; }
      if (frame.type === 'res') {
        const p = this.pending.get(frame.id);
        if (!p) return;
        this.pending.delete(frame.id); clearTimeout(p.timer);
        if (frame.ok) p.resolve(frame.payload);
        else p.reject(new RpcError(frame.error?.code ?? 'RPC_FAILED', frame.error?.details));
        return;
      }
      if (frame.type !== 'event') return;
      this.lastTick = Date.now();
      if (frame.event === 'connect.challenge' && !challenged) {
        challenged = true;
        try {
          const nonce = frame.payload?.nonce, signedAtMs = frame.payload?.ts;
          if (typeof nonce !== 'string' || !Number.isSafeInteger(signedAtMs)) throw new RpcError('INVALID_CHALLENGE');
          const token = i.token ?? this.profile.token;
          // Reuse the token's approved grant, never request admin/pairing authority.
          const scopes = i.token ? i.scopes ?? SCOPES : SCOPES;
          const payload = buildDeviceAuthPayloadV3({ deviceId: i.deviceId, clientId: 'openclaw-control-ui', clientMode: 'ui', role: 'operator', scopes, signedAtMs, token, nonce, platform: 'win32', deviceFamily: 'desktop' });
          const h = await this.request('connect', {
            minProtocol: 4, maxProtocol: 4,
            client: { id: 'openclaw-control-ui', displayName: 'JARVIS Desktop', version: GATEWAY_VERSION, buildId: BUILD_ID, platform: 'win32', deviceFamily: 'desktop', mode: 'ui' },
            role: 'operator', scopes, caps: ['plugin-approvals', 'chat-only-assistant-text'], auth: { token },
            device: { id: i.deviceId, publicKey: i.publicKey, signature: sign(null, Buffer.from(payload), i.privateKey).toString('base64url'), signedAt: signedAtMs, nonce }
          });
          if (generation !== this.generation || ws.readyState !== WebSocket.OPEN) return;
          if (h.server?.version !== GATEWAY_VERSION || h.protocol !== 4) { this.pause = true; throw new RpcError('VERSION_MISMATCH'); }
          if (h.auth?.deviceToken) await this.vault.acceptToken(h.auth.deviceToken, h.auth.scopes ?? []);
          if (generation !== this.generation || ws.readyState !== WebSocket.OPEN) return;
          clearTimeout(handshake); this.connected = true; this.attempt = 0; this.liveScopes = h.auth?.scopes ?? [];
          this.state({ phase: 'connected', detail: 'Yetkili JARVIS Gateway bağlantısı açık.', version: h.server.version, deviceId: i.deviceId });
          this.watchdog = setInterval(() => { if (Date.now() - this.lastTick > Math.max(60000, (h.policy?.tickIntervalMs ?? 30000) * 2.5)) ws.terminate(); }, 10000);
          await this.hello();
        } catch (error) {
          if (generation !== this.generation || this.stopped) return;
          const e = error instanceof RpcError ? error : new RpcError('LOCAL_CONNECTION_ERROR');
          const code = String(e.details.code ?? e.code);
          const pairing = /PAIR|NOT_PAIRED/.test(code);
          const startup = /UNAVAILABLE|BUSY|START/.test(code);
          this.pause = !startup;
          this.state({ phase: pairing ? 'pairing' : startup ? 'starting' : /AUTH|TOKEN|SCOPE|ACCESS/.test(code) ? 'auth' : 'blocked', detail: pairing ? 'Cihaz eşleştirmesi bekleniyor. openclaw --profile jarvis devices list ile bu cihazı inceleyip güncel isteği onaylayın; sonra Yeniden bağlan seçin.' : startup ? 'Gateway başlangıçta veya meşgul; salt okunur bağlantı tekrar denenecek.' : `Bağlantı doğrulanamadı (${code.replace(/[^A-Z0-9_-]/g, '').slice(0, 80)}). Kullanıcı kimliği/sürüm/politika kontrolü gerekli.`, deviceId: i.deviceId, requestId: typeof e.details.requestId === 'string' ? e.details.requestId.slice(0, 128) : undefined });
          ws.close(1008);
        }
      } else if (this.connected) {
        if (typeof frame.seq === 'number') {
          if (this.seq !== undefined && frame.seq !== this.seq + 1) this.event('desktop.gap', {});
          this.seq = frame.seq;
        }
        if (frame.event === 'shutdown') this.state({ phase: 'starting', detail: 'Gateway kapanıyor/yeniden başlıyor; gönderimler tekrar edilmez.', deviceId: i.deviceId });
        this.event(frame.event, frame.payload);
      }
    });
    ws.on('close', () => {
      clearTimeout(handshake);
      if (generation !== this.generation) return;
      this.connected = false; this.liveScopes = [];
      if (this.watchdog) clearInterval(this.watchdog);
      this.failPending();
      this.event('desktop.disconnected', {});
      if (!this.stopped && !this.pause) {
        this.state({ phase: 'offline', detail: 'Gateway erişilemiyor veya yeniden başlıyor. Yazmalar otomatik tekrar gönderilmez.', deviceId: i.deviceId });
        this.retry = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** Math.min(this.attempt++, 4)));
      }
    });
  }
  request(method: string, params: object, mutation = false): Promise<any> {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || (!this.connected && method !== 'connect')) return Promise.reject(new RpcError('OFFLINE'));
    if (this.pending.size >= 100) return Promise.reject(new RpcError('CLIENT_BUSY'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new RpcError(mutation ? 'WRITE_OUTCOME_UNKNOWN' : 'READ_TIMEOUT')); }, method==='jarvis.quick.execute'?95000:20000);
      this.pending.set(id, { resolve, reject, timer, mutation });
      ws.send(JSON.stringify({ type: 'req', id, method, params }), error => {
        if (!error) return;
        const p = this.pending.get(id); if (!p) return;
        clearTimeout(p.timer); this.pending.delete(id); reject(new RpcError(mutation ? 'WRITE_OUTCOME_UNKNOWN' : 'OFFLINE'));
      });
    });
  }
  private failPending() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new RpcError(p.mutation ? 'WRITE_OUTCOME_UNKNOWN' : 'OFFLINE')); }
    this.pending.clear();
  }
  stop() {
    this.stopped = true; this.connected = false; this.liveScopes = []; ++this.generation;
    if (this.retry) clearTimeout(this.retry);
    if (this.watchdog) clearInterval(this.watchdog);
    this.socket?.terminate(); this.socket = undefined; this.failPending();
  }
}
