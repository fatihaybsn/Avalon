import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import WebSocketPackage from "ws";
import { abortable } from "./hermesLifecycle.mjs";

const READY_RE = /HERMES_(?:BACKEND|DASHBOARD)_READY port=(\d+)/;

export class HermesGatewayRpcError extends Error {
  constructor(message, { code = 0, data } = {}) {
    super(message);
    this.name = "HermesGatewayRpcError";
    this.code = code;
    this.data = data;
  }
}

export class HermesGatewayClient extends EventEmitter {
  constructor({
    candidates,
    env = process.env,
    WebSocketImpl = globalThis.WebSocket || WebSocketPackage,
    spawnImpl = spawn,
    log = () => {},
    startupTimeoutMs = 45000,
    cwd = os.homedir(),
    terminalCwd = process.env.IRIS_HERMES_CWD || "",
  }) {
    super();
    this.candidates = candidates;
    this.env = env;
    this.WebSocketImpl = WebSocketImpl;
    this.spawnImpl = spawnImpl;
    this.log = log;
    this.startupTimeoutMs = startupTimeoutMs;
    this.cwd = cwd;
    this.terminalCwd = terminalCwd;
    this.process = null;
    this.socket = null;
    this.port = 0;
    this.token = "";
    this.startPromise = null;
    this.connectPromise = null;
    this.ready = false;
    this.closed = false;
    this.lifetime = new AbortController();
    this.sequence = 0;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.seenServerRequests = new Set();
    this.logTail = "";
  }

  async start() {
    // Only an explicit start may reopen a closed client. Old requests retain
    // the aborted lifetime, even when a new start is already in progress.
    if (this.closed) {
      this.closed = false;
      this.lifetime = new AbortController();
    }
    if (this.ready && this.socket?.readyState === this.WebSocketImpl.OPEN) return this;
    if (this.startPromise) return this.startPromise;
    const pending = this.#start(this.lifetime.signal).finally(() => {
      if (this.startPromise === pending) this.startPromise = null;
    });
    this.startPromise = pending;
    return this.startPromise;
  }

  async #start(signal) {
    signal.throwIfAborted();
    if (this.process && this.port) {
      await this.connect();
      signal.throwIfAborted();
      return this;
    }
    let lastError = null;
    for (const candidate of this.candidates()) {
      signal.throwIfAborted();
      try {
        await this.#spawn(candidate, signal);
        signal.throwIfAborted();
        await this.connect();
        signal.throwIfAborted();
        return this;
      } catch (error) {
        signal.throwIfAborted();
        lastError = error;
        this.#stopProcess();
      }
    }
    throw lastError || new Error("No usable Hermes runtime could start the interactive gateway.");
  }

  #appendLog(chunk) {
    const text = String(chunk || "");
    this.logTail = `${this.logTail}${text}`.slice(-32000);
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) this.log(line.trim());
    }
  }

  #spawn(candidate, signal) {
    return new Promise((resolve, reject) => {
      const token = crypto.randomBytes(32).toString("base64url");
      const args = [...candidate.args, "serve", "--host", "127.0.0.1", "--port", "0"];
      let child;
      try {
        child = this.spawnImpl(candidate.cmd, args, {
          cwd: this.cwd,
          env: {
            ...this.env,
            HERMES_DASHBOARD_SESSION_TOKEN: token,
            HERMES_DESKTOP: "1",
            ...(this.terminalCwd ? { TERMINAL_CWD: this.terminalCwd } : {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        reject(error);
        return;
      }
      this.process = child;
      this.token = token;
      this.logTail = "";
      let settled = false;
      const finish = (error, port = 0) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        child.off("error", onError);
        child.off("exit", onExitBeforeReady);
        if (error) reject(error);
        else {
          this.port = port;
          resolve();
        }
      };
      const inspect = (chunk) => {
        if (signal.aborted || this.process !== child) return;
        this.#appendLog(chunk);
        const match = READY_RE.exec(this.logTail);
        if (match) finish(null, Number(match[1]));
      };
      const onError = (error) => finish(error);
      const onAbort = () => finish(signal.reason);
      const onExitBeforeReady = (code, signal) =>
        finish(
          new Error(
            `Hermes interactive backend exited before ready (${signal || code}). ${this.logTail.slice(-500)}`,
          ),
        );
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              `Timed out starting Hermes interactive backend. ${this.logTail.slice(-500)}`,
            ),
          ),
        this.startupTimeoutMs,
      );
      child.stdout?.on("data", inspect);
      child.stderr?.on("data", inspect);
      child.once("error", onError);
      child.once("exit", onExitBeforeReady);
      signal.addEventListener("abort", onAbort, { once: true });
      child.on("exit", (code, signal) => {
        if (this.process !== child) return;
        this.process = null;
        this.port = 0;
        this.ready = false;
        this.#rejectPending(
          new Error(`Hermes interactive backend exited (${signal || code}).`),
        );
        this.emit("backend-exit", { code, signal });
      });
    });
  }

  async connect() {
    const signal = this.lifetime.signal;
    signal.throwIfAborted();
    if (this.ready && this.socket?.readyState === this.WebSocketImpl.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    if (!this.port || !this.token) throw new Error("Hermes interactive backend is not started.");
    const pending = new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(
        `ws://127.0.0.1:${this.port}/api/ws?token=${encodeURIComponent(this.token)}`,
      );
      this.socket = socket;
      let sawGatewayReady = false;
      let advertised = false;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error); else resolve();
      };
      const onAbort = () => {
        finish(signal.reason);
        try { socket.close(); } catch { /* already closed */ }
      };
      const timeout = setTimeout(() => {
        finish(new Error("Timed out connecting to Hermes interactive gateway."));
        try { socket.close(); } catch { /* already closed */ }
      }, 10000);
      signal.addEventListener("abort", onAbort, { once: true });
      const finishReady = () => {
        if (settled || signal.aborted || this.socket !== socket || !sawGatewayReady || advertised || socket.readyState !== this.WebSocketImpl.OPEN) return;
        advertised = true;
        // Advertise before any session is attached or work is submitted. JSON-RPC
        // notifications need no reply; wire ordering preserves this handshake.
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "client.capabilities", params: { server_requests: true } }));
        this.ready = true;
        finish();
        this.emit("connected");
      };
      socket.addEventListener("open", finishReady);
      socket.addEventListener("message", (message) => {
        if (signal.aborted || this.socket !== socket) return;
        try {
          for (const line of String(message.data).split("\n").filter(Boolean)) {
            const frame = JSON.parse(line);
            if (
              frame.method === "event" &&
              frame.params?.type === "gateway.ready"
            ) {
              this.irisContractVersions = frame.params.payload?.iris_contract_versions || [];
              sawGatewayReady = true;
              finishReady();
            }
            this.#onFrame(frame);
          }
        } catch (error) {
          this.emit("protocol-error", error);
        }
      });
      socket.addEventListener("error", () => {
        finish(new Error("Could not connect to Hermes interactive gateway."));
      });
      socket.addEventListener("close", (event) => {
        finish(new Error(`Hermes interactive socket closed (${event.code || "unknown"}).`));
        if (signal.aborted || this.socket !== socket) return;
        const wasReady = this.ready;
        this.ready = false;
        if (this.socket === socket) this.socket = null;
        this.#rejectPending(
          new Error(`Hermes interactive socket closed (${event.code || "unknown"}).`),
        );
        if (wasReady && !this.closed) this.emit("disconnected", event);
      });
    }).finally(() => {
      if (this.connectPromise === pending) this.connectPromise = null;
    });
    this.connectPromise = pending;
    return this.connectPromise;
  }

  #onFrame(frame) {
    if (frame?.method && frame.id != null) {
      this.receiveServerRequest(frame);
      return;
    }
    if (frame?.id && this.pending.has(frame.id)) {
      const pending = this.pending.get(frame.id);
      this.pending.delete(frame.id);
      clearTimeout(pending.timer);
      if (frame.error) {
        pending.reject(
          new HermesGatewayRpcError(frame.error.message || "Hermes RPC failed.", {
            code: frame.error.code,
            data: frame.error.data,
          }),
        );
      } else {
        pending.resolve(frame.result);
      }
      return;
    }
    if (frame?.method === "event" && frame.params) {
      if (frame.params.type === "request.cancel") {
        this.serverRequests.delete(frame.params.payload?.id);
      }
      this.emit("event", frame.params);
    }
  }

  receiveServerRequest(frame) {
    if (!frame?.method || frame.id == null || this.seenServerRequests.has(frame.id)) return;
    this.seenServerRequests.add(frame.id);
    this.serverRequests.set(frame.id, { frame, socket: this.socket });
    if (!this.emit("server-request", frame)) {
      this.respondServerRequest(frame.id, undefined, { code: -32601, message: "Unsupported server request" });
    }
  }

  respondServerRequest(id, result, error) {
    const entry = this.serverRequests.get(id);
    if (!entry || entry.socket !== this.socket || this.socket?.readyState !== this.WebSocketImpl.OPEN) {
      throw new Error("Hermes server request is no longer pending on this connection.");
    }
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) }));
    this.serverRequests.delete(id);
  }

  async request(method, params = {}, { timeoutMs = 30000, signal, start = true, onDispatch } = {}) {
    const lifetime = this.lifetime.signal;
    const scope = signal ? AbortSignal.any([lifetime, signal]) : lifetime;
    scope.throwIfAborted();
    if (start) await abortable(() => this.start(), scope);
    scope.throwIfAborted();
    if (!this.ready || this.socket?.readyState !== this.WebSocketImpl.OPEN) throw new Error("Hermes interactive gateway is not connected.");
    const id = `iris-${Date.now()}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        scope.removeEventListener("abort", abort);
        reject(new Error(`Hermes RPC ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      const abort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(scope.reason);
      };
      scope.addEventListener("abort", abort, { once: true });
      const settle = (callback) => (value) => { scope.removeEventListener("abort", abort); callback(value); };
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject), timer });
      try {
        scope.throwIfAborted();
        onDispatch?.();
        this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        scope.removeEventListener("abort", abort);
        reject(error);
      }
    });
  }

  #rejectPending(error) {
    this.serverRequests.clear();
    this.seenServerRequests.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  #stopProcess(force = false) {
    const child = this.process;
    this.process = null;
    this.port = 0;
    if (!child || child.exitCode != null) return;
    try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch { /* already exited */ }
    if (force) return;
    setTimeout(() => {
      if (child.exitCode == null) {
        try { child.kill("SIGKILL"); } catch { /* already exited */ }
      }
    }, 3000).unref?.();
  }

  close({ force = false } = {}) {
    this.closed = true;
    this.ready = false;
    this.lifetime.abort(new Error("Hermes interactive gateway closed."));
    this.startPromise = null;
    this.connectPromise = null;
    this.#rejectPending(new Error("Hermes interactive gateway closed."));
    try { this.socket?.close(); } catch { /* already closed */ }
    this.socket = null;
    this.#stopProcess(force);
  }
}
