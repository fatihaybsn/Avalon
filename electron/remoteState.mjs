import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import webpush from "web-push";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
export class RemoteState {
  constructor({ file, sendPush = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options), changed = () => {}, isCurrent = () => true }) {
    Object.assign(this, { file, sendPush, changed, isCurrent });
    this.data = { notifications: false, device: null, receipts: {}, seen: [], outbox: [] };
    try { if (fs.existsSync(file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, "utf8")) }; }
    catch { this.data.pushError = "Telefon kaydı okunamadı; cihazı yeniden eşleştir."; }
    this.startedAt = Date.now(); this.pair = null; this.sending = false;
    this.timer = setInterval(() => void this.flush().catch(() => {}), 2000); this.timer.unref();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 }); fs.renameSync(tmp, this.file);
  }
  status() {
    return { notifications: this.data.notifications, paired: Boolean(this.data.device),
      deviceId: this.data.device?.id, deviceName: this.data.device?.name || "", pushReady: Boolean(this.data.device?.subscription),
      pending: this.data.outbox.length, pushError: this.data.pushError || null };
  }
  newCode() {
    const code = crypto.randomInt(100000, 1000000).toString();
    this.pair = { hash: hash(code), until: Date.now() + 300000, attempts: 0 };
    return { code, expiresAt: this.pair.until };
  }
  pairDevice(code, name) {
    const p = this.pair;
    if (!p || p.until < Date.now() || ++p.attempts > 5 || p.hash !== hash(String(code))) throw new Error("Eşleştirme kodu geçersiz veya süresi dolmuş.");
    const token = crypto.randomBytes(32).toString("base64url");
    this.data.device = { id: crypto.randomUUID(), name: String(name || "Android").slice(0, 60), tokenHash: hash(token) };
    this.data.receipts = {}; this.data.outbox = []; this.pair = null;
    this.save(); this.changed(); return token;
  }
  authenticate(token) {
    return token && this.data.device?.tokenHash === hash(token) ? this.data.device.id : null;
  }
  revoke() { this.data.device = null; this.data.outbox = []; this.data.receipts = {}; this.save(); this.changed(); }
  setNotifications(value) {
    if (typeof value !== "boolean") throw new Error("Bildirim ayarı geçersiz.");
    if (value && !this.data.device?.subscription) throw new Error("Önce telefonu eşleştirip bildirim izni ver.");
    this.data.notifications = value;
    if (!value) this.data.outbox = [];
    this.save(); this.changed(); return this.status();
  }
  publicKey() {
    if (!this.data.vapid) { this.data.vapid = webpush.generateVAPIDKeys(); this.save(); }
    return this.data.vapid.publicKey;
  }
  subscribe(value) {
    const url = new URL(value?.endpoint || "");
    // Push endpoints are outbound requests; never accept arbitrary intranet URLs.
    const allowed = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
    if (url.protocol !== "https:" || url.port || url.username || url.password || !allowed.includes(url.hostname) ||
      !/^[\w-]{16,256}$/.test(value?.keys?.p256dh || "") || !/^[\w-]{16,256}$/.test(value?.keys?.auth || "")) throw new Error("Push aboneliği geçersiz.");
    if (!this.data.device) throw new Error("Telefon eşleşmemiş.");
    this.publicKey(); this.data.device.subscription = { endpoint: url.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
    this.data.pushError = null; this.save(); this.changed(); return this.status();
  }
  async execute(device, requestId, method, args, operation, readOnly = false) {
    if (readOnly) return operation();
    if (!/^[\w-]{16,100}$/.test(requestId || "")) throw new Error("İstek kimliği gerekli.");
    const key = hash(`${device}:${requestId}`), digest = hash(JSON.stringify([method, args]));
    const old = this.data.receipts[key];
    if (old) {
      if (old.digest !== digest) throw new Error("İstek kimliği farklı işlem için kullanılamaz.");
      if (old.pending) throw new Error("İşlem alınmış; sonucu güncel durumdan kontrol et. Otomatik yeniden gönderilmedi.");
      if (old.error) throw new Error(old.error);
      return old.result;
    }
    this.data.receipts[key] = { digest, pending: true }; this.save();
    try {
      const result = await operation();
      this.data.receipts[key] = { digest, result: result ?? null };
      return result;
    } catch (error) {
      // Never persist raw provider errors which might contain submitted secrets.
      this.data.receipts[key] = { digest, error: "İşlem tamamlanamadı. Güncel durumu kontrol et." };
      throw error;
    } finally {
      const entries = Object.entries(this.data.receipts).slice(-200);
      this.data.receipts = Object.fromEntries(entries); this.save();
    }
  }
  offer({ id, runId, reminderId, kind, at = Date.now() }, { force = false } = {}) {
    if (this.data.seen.includes(id)) return;
    this.data.seen = [...this.data.seen.slice(-399), id];
    if ((force || this.data.notifications) && this.data.device?.subscription && at >= this.startedAt) {
      this.data.outbox.push({ id, runId, reminderId, kind, tries: 0, next: Date.now() + 1500, expires: Date.now() + 3600000 });
      this.data.outbox = this.data.outbox.slice(-100);
    }
    try { this.save(); } catch { this.data.pushError = "Bildirim kaydı yazılamadı; görev çalışmaya devam ediyor."; }
  }
  viewed(ids) {
    const wanted = new Set(ids.slice(0, 50));
    const kept = this.data.outbox.filter((item) => !wanted.has(item.id));
    if (kept.length !== this.data.outbox.length) { this.data.outbox = kept; this.save(); }
  }
  async flush() {
    if (this.sending || !this.data.device?.subscription) return;
    const item = this.data.outbox.find((x) => x.next <= Date.now());
    if (!item) return;
    this.sending = true;
    const device = this.data.device;
    try {
      if (item.expires <= Date.now() || !this.isCurrent(item)) { item.done = true; return; }
      const body = item.kind === "reminder" ? "Hatırlatmalarını kontrol edebilirsin." : item.kind === "input" ? "Avalon yanıtını bekliyor." : item.kind === "test" ? "Telefon bildirimleri hazır." : "Avalon görevin sonuçlandı.";
      await this.sendPush(this.data.device.subscription, JSON.stringify({ title: "Avalon", body, id: item.id, runId: item.runId, reminderId: item.reminderId, kind: item.kind }), {
        TTL: 3600, urgency: "high", timeout: 10000,
        vapidDetails: { subject: this.subject, ...this.data.vapid },
      });
      item.done = true; this.data.pushError = null;
    } catch (error) {
      item.tries++;
      if ([404, 410].includes(error.statusCode)) { if (this.data.device === device) delete device.subscription; item.done = true; }
      else if (item.tries >= 3) item.done = true;
      else item.next = Date.now() + 5000 * 4 ** (item.tries - 1);
      this.data.pushError = "Bildirim gönderilemedi; görev çalışmaya devam ediyor.";
    } finally {
      this.data.outbox = this.data.outbox.filter((x) => x !== item || (!item.done && item.expires > Date.now()));
      this.sending = false; this.save(); this.changed();
    }
  }
  close() { clearInterval(this.timer); }
}
