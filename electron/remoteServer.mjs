import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import { APPLICATION_METHODS, READ_METHODS } from "./applicationMethods.mjs";
import { RESEARCH_PURPOSE_MAX_LENGTH } from "./researchLimits.mjs";

const BODY_MAX_BYTES = 128 * 1024;
const RESEARCH_RPC_METHODS = new Set(["proposeResearch", "updateResearchSchedule"]);
// A JSON-escaped UTF-16 code unit can occupy six bytes. Reserve room for
// the larger purpose only on authenticated research RPCs, not other methods.
const RESEARCH_BODY_MAX_BYTES = BODY_MAX_BYTES + RESEARCH_PURPOSE_MAX_LENGTH * 6;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".mjs": "text/javascript", ".onnx": "application/octet-stream", ".woff2": "font/woff2", ".woff": "font/woff" };
const AUDIO_COMMANDS = new Set(["speech_activity", "audio_stream_end", "playback_ended", "speech_vad_status"]);
export class RemoteServer {
  constructor(options) {
    Object.assign(this, options); this.events = new Set(); this.audio = null; this.error = null;
    const origin = new URL(options.origin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") throw new Error("Uzaktan erişim için geçerli bir HTTPS adresi gerekli.");
    this.origin = origin.origin; this.host = origin.host; this.state.subject = this.origin;
    this.server = http.createServer((req, res) => { void this.handle(req, res).catch(() => this.reply(res, 400, { error: "İstek işlenemedi." })); });
    this.server.requestTimeout = 15000; this.server.headersTimeout = 10000;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
    this.server.on("upgrade", (req, socket, head) => this.upgrade(req, socket, head));
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) { if (ws.alive === false) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    }, 10000); this.heartbeat.unref();
  }
  reply(res, status, data) {
    if (res.writableEnded) return;
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(JSON.stringify(data));
  }
  validRequest(req) {
    return req.headers.host === this.host && (!req.headers.origin || req.headers.origin === this.origin);
  }
  authenticate(req) {
    const token = /(?:^|;\s*)iris_remote=([\w-]+)/.exec(req.headers.cookie || "")?.[1];
    return this.state.authenticate(token);
  }
  async body(req, { researchRpc = false } = {}) {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw new Error("JSON gerekli.");
    let size = 0, parts = [];
    const maxBytes = researchRpc ? RESEARCH_BODY_MAX_BYTES : BODY_MAX_BYTES;
    for await (const part of req) { size += part.length; if (size > maxBytes) throw new Error("İstek fazla büyük."); parts.push(part); }
    const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (size > BODY_MAX_BYTES && !RESEARCH_RPC_METHODS.has(value?.method)) throw new Error("İstek fazla büyük.");
    return value;
  }
  async handle(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${this.origin.replace("https:", "wss:")}; img-src 'self' data:; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`);
    if (!this.validRequest(req)) return this.reply(res, 403, { error: "Adres veya kaynak doğrulanamadı." });
    const url = new URL(req.url, this.origin);
    if (url.pathname === "/api/v1/pair" && req.method === "POST") {
      if (req.headers.origin !== this.origin) return this.reply(res, 403, { error: "Kaynak gerekli." });
      const value = await this.body(req);
      try {
        const token = this.state.pairDevice(value.code, value.name); this.disconnectClients();
        res.setHeader("Set-Cookie", `iris_remote=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`);
        return this.reply(res, 200, { ok: true });
      } catch { return this.reply(res, 403, { error: "Eşleştirme kodu geçersiz veya süresi dolmuş." }); }
    }
    if (url.pathname.startsWith("/api/")) {
      const device = this.authenticate(req);
      if (!device) return this.reply(res, 401, { error: "Telefonu masaüstündeki kodla eşleştir." });
      if (req.method !== "GET" && req.headers.origin !== this.origin) return this.reply(res, 403, { error: "Kaynak gerekli." });
      if (url.pathname === "/api/v1/state" && req.method === "GET") return this.reply(res, 200, await this.snapshot());
      if (url.pathname === "/api/v1/push/key" && req.method === "GET") return this.reply(res, 200, { publicKey: this.state.publicKey() });
      if (url.pathname === "/api/v1/push/subscription" && req.method === "POST") return this.reply(res, 200, this.state.subscribe(await this.body(req)));
      if (url.pathname === "/api/v1/rpc" && req.method === "POST") {
        const { method, args = [], requestId } = await this.body(req, { researchRpc: true });
        const special = ["startSidecar", "stopSidecar", "getSidecarStatus", "sendCommand", "sendUiContext", "remoteStatus", "setNotifications", "testNotification"];
        if ((!Object.hasOwn(APPLICATION_METHODS, method) && !special.includes(method)) || !Array.isArray(args) || args.length > 4) return this.reply(res, 400, { error: "Desteklenmeyen işlem." });
        try {
          const result = await this.state.execute(device, requestId, method, args, () => this.invoke(method, args, device), READ_METHODS.has(method) || method === "getSidecarStatus");
          return this.reply(res, 200, { result: result ?? null });
        } catch (error) { return this.reply(res, 409, { error: String(error.message || "İşlem başarısız.").slice(0, 500) }); }
      }
      return this.reply(res, 404, { error: "İşlem bulunamadı." });
    }
    if (req.method !== "GET") return this.reply(res, 405, { error: "Desteklenmeyen yöntem." });
    const rel = decodeURIComponent(url.pathname) === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1);
    const root = path.resolve(this.root), file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !MIME[path.extname(file)] || !fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) return this.reply(res, 404, { error: "Dosya bulunamadı." });
    res.setHeader("Cache-Control", "no-cache"); res.setHeader("Content-Type", MIME[path.extname(file)]);
    fs.createReadStream(file).pipe(res);
  }
  upgrade(req, socket, head) {
    let pathname;
    try { pathname = new URL(req.url, this.origin).pathname; } catch { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    const device = this.authenticate(req);
    if (!this.validRequest(req) || req.headers.origin !== this.origin || !device || !["/api/v1/events", "/api/v1/audio"].includes(pathname)) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      ws.alive = true; ws.on("pong", () => { ws.alive = true; }); ws.on("error", () => {});
      if (pathname.endsWith("events")) {
        this.events.add(ws); ws.on("close", () => this.events.delete(ws));
        ws.on("message", (data, binary) => {
          if (binary || data.length > 8192) return ws.close(1008);
          try { const value = JSON.parse(data); if (value.type === "viewed" && Array.isArray(value.ids)) this.state.viewed(value.ids.filter((x) => typeof x === "string")); } catch { ws.close(1008); }
        });
      } else {
        const owner = this.voiceOwner();
        if (owner.deviceId !== device) return ws.close(1008);
        const old = this.audio; this.audio = { ws, device, generation: owner.generation }; old?.ws.close();
        const binding = this.audio;
        this.onAudioConnect?.(device);
        ws.on("close", () => { if (this.audio === binding) { this.audio = null; this.onAudioDisconnect(device, binding.generation); } });
        ws.on("message", (data, binary) => {
          const current = this.voiceOwner();
          if (current.deviceId !== device || current.generation !== binding.generation) return ws.close(1008);
          if (binary) { if (data.length > 0 && data.length % 2 === 0) this.onAudio(data, device, binding.generation); }
          else {
            try { const value = JSON.parse(data); if (value.generation === binding.generation && AUDIO_COMMANDS.has(value.type)) this.onControl(value, device, binding.generation); else ws.close(1008); } catch { ws.close(1008); }
          }
        });
      }
    });
  }
  publish(channel, payload) {
    if (["live:audio", "live:interrupt", "live:output-end"].includes(channel)) return;
    if (channel === "sidecar:event" && ["log", "fatal"].includes(payload?.type)) return;
    if (channel === "sidecar:event" && ["hermes_task_update", "hermes_completion"].includes(payload?.type) && typeof payload.output === "string" && payload.output.length > 600) payload = { ...payload, output: payload.output.slice(0, 600), outputTruncated: true };
    const data = JSON.stringify({ channel, payload });
    for (const ws of this.events) { if (ws.readyState === 1 && ws.bufferedAmount < 1024 * 1024) ws.send(data); else ws.terminate(); }
  }
  sendAudio(channel, payload) {
    const binding = this.audio, owner = this.voiceOwner();
    if (!binding || binding.device !== owner.deviceId || binding.generation !== owner.generation || binding.ws.readyState !== 1) return false;
    if (binding.ws.bufferedAmount > 512 * 1024) { binding.ws.terminate(); return false; }
    if (channel === "live:audio") {
      binding.ws.send(JSON.stringify({ type: "audio", utteranceId: payload.utteranceId, mimeType: payload.mimeType, generation: binding.generation }));
      binding.ws.send(Buffer.from(payload.data, "base64"));
    } else binding.ws.send(JSON.stringify({ type: channel, ...payload, generation: binding.generation }));
    return true;
  }
  disconnectClients() { for (const ws of this.wss.clients) ws.terminate(); }
  async start() {
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(this.port, "127.0.0.1", resolve); });
    this.port = this.server.address().port; return this;
  }
  async close() { clearInterval(this.heartbeat); this.disconnectClients(); this.wss.close(); await new Promise((resolve) => this.server.close(resolve)); }
}
