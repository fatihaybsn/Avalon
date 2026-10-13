import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync, createHash, createPublicKey } from 'node:crypto';
export type Identity = { deviceId: string; publicKey: string; privateKey: string; token?: string; scopes?: string[] };
export interface Protector { isEncryptionAvailable(): boolean; encryptString(text: string): Buffer; decryptString(data: Buffer): string }
export class DeviceVault {
  identity?: Identity;
  constructor(private file: string, private protector: Protector, private endpoint: string) {}
  async load(): Promise<Identity> {
    if (!this.protector.isEncryptionAvailable()) throw new Error('Windows kullanıcı sır koruması kullanılamıyor.');
    try {
      const record = JSON.parse(this.protector.decryptString(await fs.readFile(this.file)));
      if (record.endpoint !== this.endpoint) throw new Error('Cihaz kaydı başka Gateway adresine ait.');
      const i = record.identity as Identity;
      const raw = createPublicKey(i.privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
      if (raw.toString('base64url') !== i.publicKey || createHash('sha256').update(raw).digest('hex') !== i.deviceId) throw new Error('Cihaz kaydı doğrulanamadı.');
      return this.identity = i;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const pair = generateKeyPairSync('ed25519');
    const raw = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
    this.identity = { deviceId: createHash('sha256').update(raw).digest('hex'), publicKey: raw.toString('base64url'), privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
    await this.save();
    return this.identity;
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, this.protector.encryptString(JSON.stringify({ endpoint: this.endpoint, identity: this.identity })), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }
  async acceptToken(token: string, scopes: string[]) {
    const i = this.identity!;
    if (i.token !== token) { i.token = token; i.scopes = scopes; await this.save(); }
  }
}
