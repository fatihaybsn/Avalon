import crypto from "node:crypto";
import { readJson, writeJson } from "./researchStore.mjs";

export class MessageReceipts {
  constructor(file) { this.file = file; this.entries = readJson(file, {}); this.pending = new Map(); }
  async send(input, deviceId, operation, preflight = () => {}) {
    if (!input || typeof input.id !== "string" || !/^[\w-]{1,100}$/.test(input.id) || typeof input.text !== "string" || !input.text.trim() || input.text.length > 20000 || typeof input.sessionId !== "string" || !input.sessionId) throw new Error("Geçersiz mesaj.");
    const key = `${deviceId}:${input.id}`, digest = crypto.createHash("sha256").update(JSON.stringify([input.sessionId, input.text])).digest("hex");
    const old = this.entries[key];
    if (old && old.digest !== digest) throw new Error("Mesaj kimliği farklı içerikle kullanılamaz.");
    if (this.pending.has(key)) return this.pending.get(key);
    if (old) { if (old.result) return old.result; throw new Error("Mesaj daha önce alındı. Sohbet geçmişini kontrol et."); }
    preflight();
    this.entries[key] = { digest }; this.persist();
    const task = (async () => { const result = await operation(); this.entries[key] = { digest, result }; this.persist(); return result; })();
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }
  persist() { this.entries = Object.fromEntries(Object.entries(this.entries).slice(-500)); writeJson(this.file, this.entries); }
}
