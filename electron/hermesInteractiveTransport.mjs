import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { HermesGatewayRpcError } from "./hermesGatewayClient.mjs";
import { assertConversationTools, conversationInstructions } from "./voiceRelay.mjs";
import { brainExecutionKey, brainProviderSlug } from "./brainReasoning.mjs";
import { conversationLanguage } from "./conversationLanguage.mjs";
import { abortable } from "./hermesLifecycle.mjs";

const TERMINAL = new Set(["completed", "failed", "cancelled", "canceled", "error"]);

function promptForTask(task, instructions) {
  return [
    "<iris_background_task>",
    String(task || "").trim(),
    "</iris_background_task>",
    "",
    "<iris_task_guidance>",
    String(instructions || "").trim(),
    "</iris_task_guidance>",
  ].join("\n");
}

export class HermesInteractiveTransport extends EventEmitter {
  constructor({ client, log = () => {}, defaultCwd = "", conversationOnly = false, permissionMode = null, getRoute, prepareRoute, onRoute = () => {} }) {
    super();
    this.client = client;
    this.log = log;
    this.defaultCwd = defaultCwd;
    this.conversationOnly = conversationOnly;
    this.permissionMode = conversationOnly ? null : permissionMode;
    this.permissionQueue = Promise.resolve();
    Object.assign(this, { getRoute, prepareRoute, onRoute });
    this.sessionPromises = new Map();
    this.sessions = new Map();
    this.liveSessions = new Map();
    this.runs = new Map();
    this.reconnectTimer = null;
    this.lifetime = new AbortController();
    this.taskControllers = new WeakMap();
    this.interactionControllers = new WeakMap();
    client.on("event", (event) => this.#onEvent(event));
    client.on("server-request", (frame) => this.#onServerRequest(frame));
    client.on("disconnected", () => {
      for (const state of this.sessions.values()) if (state.current) this.#clearInteraction(state.current);
      this.#scheduleReconnect();
    });
    client.on("backend-exit", (detail) => this.#onBackendExit(detail));
  }

  async start() {
    if (this.lifetime.signal.aborted) this.lifetime = new AbortController();
    const signal = this.lifetime.signal;
    await this.client.start();
    signal.throwIfAborted();
    return this;
  }

  #scope(signal) {
    return signal ? AbortSignal.any([this.lifetime.signal, signal]) : this.lifetime.signal;
  }

  #assertCurrent(state, item, signal) {
    signal.throwIfAborted();
    if (state.current !== item || item.cancelRequested || TERMINAL.has(item.status)) {
      throw Object.assign(new Error("Hermes görevi artık bu oturumun sahibi değil."), { code: "CANCELLED" });
    }
  }

  #permissionOperation(operation) {
    const pending = this.permissionQueue.then(operation);
    this.permissionQueue = pending.catch(() => {});
    return pending;
  }

  async #applyPermissionMode(state, mode, signal = this.lifetime.signal) {
    signal.throwIfAborted();
    if (mode == null) return;
    if (!state.liveId) throw new Error("Hermes görev oturumu bağlı değil.");
    const value = mode === "full" ? "1" : "0";
    const result = await this.client.request("config.set", {
      session_id: state.liveId, key: "yolo", value, scope: "session",
    }, { signal });
    signal.throwIfAborted();
    if (result.key !== "yolo" || result.scope !== "session" || String(result.value) !== value) {
      throw new Error("Hermes izin modunu doğrulamadı; ayar uygulanmadı.");
    }
    state.permissionMode = mode;
  }

  async setPermissionMode(mode) {
    const signal = this.lifetime.signal;
    signal.throwIfAborted();
    if (this.conversationOnly || !["standard", "full"].includes(mode)) throw new Error("Geçersiz görev izin modu.");
    return this.#permissionOperation(async () => {
      signal.throwIfAborted();
      const previous = this.permissionMode || "standard";
      try {
        for (const state of this.sessions.values()) if (state.liveId) await this.#applyPermissionMode(state, mode, signal);
      } catch (error) {
        for (const state of this.sessions.values()) {
          if (!state.liveId) continue;
          await this.#applyPermissionMode(state, previous, signal).catch((rollback) => this.log(`İzin modu geri alınamadı: ${rollback.message}`));
        }
        throw error;
      }
      signal.throwIfAborted();
      this.permissionMode = mode;
      // A gate already waiting for input needs a reply even after native bypass
      // is enabled. Only release ordinary approvals, never secrets or questions.
      if (mode === "full") {
        for (const state of this.sessions.values()) {
          const item = state.current;
          if (item?.interaction?.type === "approval" && item.interaction.choices?.includes("once")) {
            await this.respond(item.runId, { interactionId: item.interaction.id, type: "approval", value: "once" })
              .catch((error) => this.log(`Bekleyen onay çözülemedi: ${error.message}`));
          }
        }
      }
      return mode;
    });
  }

  async createSession({ parentSessionId, hidden = false, route, signal: parentSignal } = {}) {
    const signal = this.#scope(parentSignal);
    signal.throwIfAborted();
    route ||= await abortable(() => this.getRoute?.(), signal);
    if (route) await abortable(() => this.prepareRoute?.(route), signal);
    signal.throwIfAborted();
    const result = await this.client.request(
      "session.create",
      {
        source: "iris",
        close_on_disconnect: false,
        cols: 110,
        ...(route ? { model: route.modelId, provider: brainProviderSlug(route) } : {}),
        ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
        ...(hidden ? { hidden: true } : {}),
        ...(this.defaultCwd ? { cwd: this.defaultCwd } : {}),
      },
      { timeoutMs: 45000, signal },
    );
    signal.throwIfAborted();
    const state = this.#registerSession({
      storedId: result.stored_session_id,
      liveId: result.session_id,
      info: result.info,
    });
    if (route) { state.route = { ...route }; this.onRoute(state.storedId, route); }
    return { id: state.storedId, liveSessionId: state.liveId, info: result.info };
  }

  async switchModel(storedId, route, { preparing = false, confirm, signal: parentSignal } = {}) {
    const signal = this.#scope(parentSignal);
    const state = await abortable(() => this.ensureSession(storedId, { route }), signal);
    signal.throwIfAborted();
    if (state.route && brainExecutionKey(state.route) === brainExecutionKey(route)) return { id: state.storedId, deferred: Boolean(state.deferredRoute) };
    if ((state.current || state.queue.length) && !preparing) throw new Error("Hermes oturumu hâlâ çalışıyor.");
    await abortable(() => this.prepareRoute?.(route), signal);
    signal.throwIfAborted();
    const snapshot = await this.client.request("session.resume", { session_id: state.storedId }, { signal });
    signal.throwIfAborted();
    const canonical = Number.isInteger(snapshot.revision) && Number.isInteger(snapshot.execution_generation);
    // The standalone `hermes serve` desktop protocol exposes session-scoped
    // config.set; the canonical owner exposes revision-fenced session.mutate.
    // Both are Hermes' native /model operation; neither writes global defaults.
    const receipt = canonical ? await this.client.request("session.mutate", {
      session_id: state.storedId, request_id: crypto.randomUUID(),
      expected_revision: snapshot.revision, expected_generation: snapshot.execution_generation,
      operation: "model", payload: { provider: brainProviderSlug(route), model: route.modelId, ...(confirm ? { confirm } : {}) },
    }, { timeoutMs: 45000, signal }) : await this.client.request("config.set", {
      session_id: state.liveId, key: "model", value: `${route.modelId} --provider ${brainProviderSlug(route)} --session`,
      confirm_expensive_model: Boolean(confirm && confirm === state.switchConfirm),
    }, { timeoutMs: 45000, signal });
    signal.throwIfAborted();
    if (receipt.status === "confirmation_required" || receipt.confirm_required) {
      state.switchConfirm = receipt.confirm || crypto.randomUUID();
      throw Object.assign(new Error(receipt.confirm_message || receipt.message || "Hermes model değişimi için onay istiyor."), {
        confirmation: { confirm: state.switchConfirm, message: receipt.confirm_message || receipt.message || "Model değişimi uyarısını onayla.", warnings: receipt.warnings || [] },
      });
    }
    if (receipt.status && !["ok", "applied", "completed"].includes(receipt.status)) throw new Error(`Hermes model değişimi uygulanmadı: ${receipt.status}`);
    state.route = { ...route };
    state.switchConfirm = null;
    if (receipt.deferred) state.deferredRoute = { ...route };
    else { state.deferredRoute = null; this.onRoute(state.storedId, route); }
    return { id: state.storedId, deferred: Boolean(receipt.deferred) };
  }

  async deleteSession(storedId) {
    const state = this.sessions.get(String(storedId || ""));
    if (!state) return { deleted: false };
    if (state.current || state.queue.length) {
      throw new Error("Cannot delete an active Hermes session.");
    }
    await this.client.request("session.close", { session_id: state.liveId }).catch(() => undefined);
    const result = await this.client.request("session.delete", {
      session_id: state.storedId,
    });
    this.liveSessions.delete(state.liveId);
    this.sessions.delete(state.storedId);
    return result;
  }

  async ensureSession(storedId, { route } = {}) {
    this.lifetime.signal.throwIfAborted();
    const key = String(storedId || "");
    if (!this.sessionPromises.has(key)) {
      const promise = this.#ensureSession(storedId, route).finally(() => {
        if (this.sessionPromises.get(key) === promise) this.sessionPromises.delete(key);
      });
      this.sessionPromises.set(key, promise);
    }
    return this.sessionPromises.get(key);
  }

  async #ensureSession(storedId, route) {
    const signal = this.lifetime.signal;
    signal.throwIfAborted();
    const requested = String(storedId || "").trim();
    const existing = requested ? this.sessions.get(requested) : null;
    if (existing?.liveId) return existing;
    if (requested) {
      try {
        const resumed = await this.client.request(
          "session.resume",
          {
            session_id: requested,
            source: "iris",
            close_on_disconnect: false,
            cols: 110,
          },
          { timeoutMs: 45000, signal },
        );
        signal.throwIfAborted();
        const state = this.#registerSession({
          storedId: resumed.resumed || resumed.session_key || requested,
          liveId: resumed.session_id,
          info: resumed.info,
        });
        this.#replayRequests(resumed);
        return state;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof HermesGatewayRpcError) || error.code !== 4007) throw error;
      }
    }
    const created = await this.createSession({ route, signal });
    signal.throwIfAborted();
    return this.sessions.get(created.id);
  }

  #registerSession({ storedId, liveId, liveSessionId, info }) {
    const resolvedLiveId = liveId || liveSessionId;
    const resolvedStoredId = String(storedId || "").trim();
    let state = this.sessions.get(resolvedStoredId);
    if (!state) {
      state = {
        storedId: resolvedStoredId,
        liveId: resolvedLiveId,
        queue: [],
        current: null,
      };
      this.sessions.set(resolvedStoredId, state);
    } else {
      if (state.liveId) this.liveSessions.delete(state.liveId);
      state.liveId = resolvedLiveId;
    }
    if (info) state.observedRuntime = { model: info.model || null, provider: info.provider || null };
    this.liveSessions.set(resolvedLiveId, state);
    return state;
  }

  async submit({ task, sessionId, urgency = "normal", instructions = "", kind = "task", context = "", turnId, ownerSessionId, route, language = conversationLanguage(), signal: parentSignal }) {
    const signal = this.#scope(parentSignal);
    signal.throwIfAborted();
    const conversational = kind === "conversation" || kind === "context";
    if (conversational && !this.conversationOnly) throw new Error("Conversation requires a restricted Hermes backend.");
    if (this.conversationOnly && !conversational) throw new Error("Work cannot run on the conversation backend.");
    const state = await abortable(() => this.ensureSession(sessionId), signal);
    signal.throwIfAborted();
    const runId = `iris_${crypto.randomUUID()}`;
    const item = {
      runId,
      task: String(task || "").trim(),
      urgency,
      instructions,
      conversationInstructions: this.conversationOnly ? conversationInstructions(language) : undefined,
      kind,
      context,
      turnId,
      ownerSessionId: ownerSessionId || state.storedId,
      route,
      storedSessionId: state.storedId,
      liveSessionId: state.liveId,
      status: state.current ? "queued" : "starting",
      output: "",
      interaction: null,
      dispatchStarted: false,
      submittedAt: Date.now(),
    };
    this.runs.set(runId, item);
    const controller = new AbortController();
    const cancel = () => { void this.stop(runId, { start: false }).catch((error) => this.log(`Hermes iptali doğrulanamadı: ${error.message}`)); };
    parentSignal?.addEventListener("abort", cancel, { once: true });
    this.taskControllers.set(item, { controller, release: () => parentSignal?.removeEventListener("abort", cancel) });
    state.queue.push(item);
    this.emit("run-update", { ...item });
    void this.#drain(state);
    return {
      run_id: runId,
      status: item.status,
      session_id: state.storedId,
      live_session_id: state.liveId,
    };
  }

  async #drain(state) {
    if (this.lifetime.signal.aborted || state.current || !state.queue.length) return;
    const item = state.queue.shift();
    state.current = item;
    item.status = "running";
    item.liveSessionId = state.liveId;
    this.emit("run-update", { ...item });
    const signal = this.#scope(this.taskControllers.get(item).controller.signal);
    try {
      this.#assertCurrent(state, item, signal);
      const route = item.route || await abortable(() => this.getRoute?.(), signal);
      this.#assertCurrent(state, item, signal);
      if (route) {
        await this.switchModel(state.storedId, route, { preparing: true, signal });
        this.#assertCurrent(state, item, signal);
        item.brainProvider = route.provider;
        item.brainModel = route.modelId;
        item.brainReasoning = route.reasoning || "default";
        this.emit("run-update", { ...item });
      }
      if (this.conversationOnly) {
        if (!this.client.irisContractVersions?.some((version) => version === 1 || version === 2)) throw new Error("Hermes bağlantısı Avalon konuşma sözleşmesi v1/v2'yi desteklemiyor. Hermes'i yeniden başlat.");
        // Fail closed on old gateways and on ignored environment pins. Never
        // change the user's global tool configuration to make chat safe.
        assertConversationTools(await this.client.request("tools.show", { session_id: state.liveId }, { signal }));
        this.#assertCurrent(state, item, signal);
      }
      await abortable(() => this.#permissionOperation(() => this.#applyPermissionMode(state, this.permissionMode, signal)), signal);
      this.#assertCurrent(state, item, signal);
      await this.client.request(
        "prompt.submit",
        {
          session_id: state.liveId,
          text: this.conversationOnly ? item.task : promptForTask(item.task, item.instructions),
          ...(this.conversationOnly ? { surface: "voice-live", voice_context: item.context,
            iris_contract: {
              version: this.client.irisContractVersions.includes(2) && item.kind === "conversation" ? 2 : 1,
              instructions: item.conversationInstructions,
              ...(this.client.irisContractVersions.includes(2) && item.kind === "conversation"
                ? { final_reply_repair: "plain_text_once" } : {}),
            } } : {}),
          ...(item.kind === "context" ? { display_kind: "hidden" } : {}),
        },
        { timeoutMs: 45000, signal, onDispatch: () => {
          this.#assertCurrent(state, item, signal);
          item.dispatchStarted = true;
        } },
      );
    } catch (error) {
      this.#finish(state, item, {
        status: item.cancelRequested ? "cancelled" : "failed",
        error: error?.message || String(error),
        ...(item.dispatchStarted && !this.conversationOnly ? { dispatchUncertain: true } : {}),
      });
    }
  }

  #onEvent(event) {
    const type = String(event?.type || "");
    const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
    const state = this.liveSessions.get(String(event?.session_id || ""));
    if (!state) return;
    if (type === "session.info") state.observedRuntime = { model: payload.model || null, provider: payload.provider || null };
    if (type === "session.info" && state.deferredRoute && payload.model === state.deferredRoute.modelId &&
      ([brainProviderSlug(state.deferredRoute), `custom:${brainProviderSlug(state.deferredRoute)}`].includes(payload.provider) ||
        (!state.deferredRoute.reasoning && (!payload.provider || payload.provider === "custom")))) {
      this.onRoute(state.storedId, state.deferredRoute);
      state.deferredRoute = null;
    }
    const item = state.current;
    if (type === "request.cancel") {
      if (item?.interaction?.serverRequestId === payload.id) this.#clearInteraction(item);
      return;
    }
    if (type === "terminal.read.request") {
      void this.client.request("terminal.read.respond", {
        request_id: payload.request_id,
        text: JSON.stringify({ lines: [], unavailable: true }),
      }).catch(() => undefined);
      return;
    }
    if (!item) return;
    if (type === "message.start") {
      item.status = "running";
      this.emit("run-update", { ...item });
      return;
    }
    if (type === "message.delta") {
      const delta = String(payload.text || "");
      item.output = `${item.output}${delta}`;
      this.emit("run-event", {
        runId: item.runId,
        task: item.task,
        event: "message.delta",
        delta,
      });
      return;
    }
    if (type === "reasoning.delta" || type === "reasoning.available") {
      this.emit("run-event", {
        runId: item.runId,
        task: item.task,
        event: "reasoning.available",
        text: String(payload.text || ""),
      });
      return;
    }
    if (type === "tool.start") {
      this.emit("run-event", {
        runId: item.runId,
        task: item.task,
        event: "tool.started",
        tool: String(payload.name || "tool"),
        toolId: String(payload.tool_id || ""),
        preview: String(payload.context || payload.args_text || ""),
      });
      return;
    }
    if (type === "tool.complete") {
      this.emit("run-event", {
        runId: item.runId,
        task: item.task,
        event: "tool.completed",
        tool: String(payload.name || "tool"),
        toolId: String(payload.tool_id || ""),
        preview: String(payload.summary || ""),
        duration: Number(payload.duration_s) || undefined,
        isError: Boolean(payload.error),
      });
      return;
    }
    if (type === "clarify.request") {
      this.#requestInteraction(item, {
        id: String(payload.request_id || ""),
        type: "clarify",
        question: String(payload.question || "Hermes needs more information."),
        choices: Array.isArray(payload.choices) ? payload.choices.map(String) : [],
        allowCustom: true,
        secret: false,
      });
      return;
    }
    if (type === "approval.request") {
      this.#requestInteraction(item, {
        id: `approval:${item.runId}`,
        type: "approval",
        question: String(payload.description || "Hermes wants to run a protected command."),
        command: String(payload.command || ""),
        choices: [
          "once",
          "session",
          ...(payload.allow_permanent === false ? [] : ["always"]),
          "deny",
        ],
        allowCustom: false,
        secret: false,
      });
      return;
    }
    if (type === "sudo.request") {
      this.#requestInteraction(item, {
        id: String(payload.request_id || ""),
        type: "sudo",
        question: "Hermes needs your sudo password to continue.",
        choices: [],
        allowCustom: true,
        secret: true,
      });
      return;
    }
    if (type === "secret.request") {
      this.#requestInteraction(item, {
        id: String(payload.request_id || ""),
        type: "secret",
        question: String(payload.prompt || "Hermes needs a secret value."),
        envVar: String(payload.env_var || ""),
        choices: [],
        allowCustom: true,
        secret: true,
      });
      return;
    }
    if (type === "message.complete") {
      const status = String(payload.status || "complete").toLowerCase();
      const failed = status !== "complete" && status !== "completed";
      this.#finish(state, item, {
        status: item.cancelRequested ? "cancelled" : failed ? "failed" : "completed",
        output: String(payload.text || item.output || ""),
        error: failed ? String(payload.warning || status) : "",
      });
      return;
    }
    if (type === "error") {
      this.#finish(state, item, {
        status: "failed",
        error: String(payload.message || "Hermes interactive run failed."),
      });
    }
  }

  #requestInteraction(item, interaction) {
    if (this.lifetime.signal.aborted || item.cancelRequested || TERMINAL.has(item.status)) return;
    item.interaction = interaction;
    this.interactionControllers.set(interaction, new AbortController());
    item.status =
      interaction.type === "approval" ? "waiting_for_approval" : "waiting_for_input";
    this.emit("interaction", {
      runId: item.runId,
      task: item.task,
      interaction: { ...interaction },
    });
    this.emit("run-update", { ...item });
  }

  #replayRequests(snapshot) {
    for (const frame of snapshot.open_requests || []) this.client.receiveServerRequest(frame);
  }

  #clearInteraction(item) {
    const interaction = item.interaction;
    if (!interaction) return;
    this.interactionControllers.get(interaction)?.abort(new Error("Hermes interaction is no longer pending on this connection."));
    item.interaction = null;
    if (!TERMINAL.has(item.status) && !item.cancelRequested) item.status = "running";
    this.emit("interaction-resolved", { runId: item.runId, task: item.task, interactionId: interaction.id, type: interaction.type });
    this.emit("run-update", { ...item });
  }

  #onServerRequest(frame) {
    const payload = frame.params || {};
    const state = this.liveSessions.get(String(payload.session_id || ""));
    const item = state?.current;
    const reject = (code, message) => this.client.respondServerRequest(frame.id, undefined, { code, message });
    if (!["approval", "clarify", "sudo", "secret"].includes(frame.method)) {
      reject(["terminal.read", "window.read", "preview.read", "preview.act", "tour"].includes(frame.method) ? 4404 : -32601,
        "This Avalon client does not provide the requested Hermes Desktop surface.");
      return;
    }
    if (!item || item.cancelRequested) { reject(4404, "No active Avalon run owns this request."); return; }
    if (item.interaction?.serverRequestId === frame.id) return;
    if (item.interaction) { reject(-32600, "Another Avalon interaction is pending."); return; }
    if (frame.method === "clarify") {
      const questions = Array.isArray(payload.questions) ? payload.questions : [];
      if (!questions.length || questions.some((q) => !q.qid || typeof q.question !== "string")) {
        reject(-32602, "Invalid clarification questions."); return;
      }
      const answers = { ...(payload.answers || {}) };
      const next = questions.findIndex((q) => !Object.hasOwn(answers, q.qid));
      if (next < 0) { this.client.respondServerRequest(frame.id, { answers, outcome: "submitted" }); return; }
      this.#showClarify(item, frame.id, questions, answers, next);
      return;
    }
    const type = frame.method;
    const choices = type === "approval" ? (Array.isArray(payload.choices) && payload.choices.length
      ? payload.choices.filter((choice) => ["once", "session", "always", "deny"].includes(choice))
      : ["once", ...(payload.allow_session === false ? [] : ["session"]), ...(payload.allow_permanent === false ? [] : ["always"]), "deny"]) : [];
    this.#requestInteraction(item, {
      id: frame.id, serverRequestId: frame.id, type,
      question: String(type === "approval" ? payload.description || "Hermes işlem için onay istiyor." : type === "sudo" ? "Hermes yönetici parolanızı istiyor." : payload.prompt || "Hermes gizli bir değer istiyor."),
      command: type === "approval" ? String(payload.command || "") : "",
      envVar: type === "secret" ? String(payload.env_var || "") : "",
      choices, allowCustom: type !== "approval", secret: type === "sudo" || type === "secret",
    });
  }

  #showClarify(item, serverRequestId, questions, answers, index) {
    const question = questions[index];
    this.#requestInteraction(item, {
      id: `${serverRequestId}:${question.qid}`, serverRequestId, type: "clarify",
      question: question.question, choices: question.choices || [], allowCustom: true, secret: false,
      questions, answers, questionIndex: index,
    });
  }

  async respond(runId, { interactionId, type, value }, { signal: parentSignal } = {}) {
    this.#scope(parentSignal).throwIfAborted();
    const item = this.runs.get(String(runId));
    if (!item || item.cancelRequested || TERMINAL.has(item.status) || !item.interaction) throw new Error("No pending Hermes interaction for this run.");
    const interaction = item.interaction;
    const signal = this.#scope(AbortSignal.any([this.interactionControllers.get(interaction).signal,
      ...(parentSignal ? [parentSignal] : [])]));
    signal.throwIfAborted();
    if (interaction.id !== interactionId || interaction.type !== type) {
      throw new Error("Hermes interaction no longer matches this response.");
    }
    const state = this.sessions.get(item.storedSessionId);
    if (!state || state.current !== item) throw new Error("Hermes session is unavailable.");
    if (interaction.responding) throw new Error("Hermes interaction is already being answered.");
    if (type === "approval" && !interaction.choices.includes(String(value || "deny"))) throw new Error("Approval choice is not offered by Hermes.");
    if (interaction.serverRequestId) {
      interaction.responding = true;
      try {
        if (type === "clarify") {
          const { questions, questionIndex, serverRequestId } = interaction;
          const answers = { ...interaction.answers, [questions[questionIndex].qid]: String(value ?? "") || null };
          const next = questions.findIndex((q) => !Object.hasOwn(answers, q.qid));
          if (next >= 0) {
            this.#clearInteraction(item);
            this.#showClarify(item, serverRequestId, questions, answers, next);
            return { status: "waiting_for_input", run_id: item.runId, type };
          }
          this.client.respondServerRequest(serverRequestId, { answers, outcome: "submitted" });
        } else {
          this.client.respondServerRequest(interaction.serverRequestId, type === "approval" ? { choice: String(value || "deny") } : { value: String(value ?? "") });
        }
      } catch (error) { interaction.responding = false; throw error; }
    } else if (type === "clarify") {
      await this.client.request("clarify.respond", {
        request_id: interaction.id,
        answer: String(value ?? ""),
      }, { signal });
    } else if (type === "approval") {
      await this.client.request("approval.respond", {
        session_id: state.liveId,
        choice: String(value || "deny"),
      }, { signal });
    } else if (type === "sudo") {
      await this.client.request("sudo.respond", {
        request_id: interaction.id,
        password: String(value ?? ""),
      }, { signal });
    } else if (type === "secret") {
      await this.client.request("secret.respond", {
        request_id: interaction.id,
        value: String(value ?? ""),
      }, { signal });
    } else {
      throw new Error(`Unsupported Hermes interaction: ${type}`);
    }
    signal.throwIfAborted();
    if (item.interaction === interaction) this.#clearInteraction(item);
    return { status: "resolved", run_id: item.runId, type };
  }

  async stop(runId, { signal, start = true } = {}) {
    const item = this.runs.get(String(runId));
    if (!item) throw new Error("Hermes run not found.");
    if (TERMINAL.has(item.status)) return { status: item.status };
    const state = this.sessions.get(item.storedSessionId);
    if (!state) throw new Error("Hermes session is unavailable.");
    if (state.current?.runId !== item.runId) {
      state.queue = state.queue.filter((queued) => queued.runId !== item.runId);
      this.#finish(state, item, { status: "cancelled" });
      return { status: "cancelled" };
    }
    item.cancelRequested = true;
    if (!item.dispatchStarted) {
      this.taskControllers.get(item)?.controller.abort(Object.assign(new Error("Hermes görevi gönderilmeden iptal edildi."), { code: "CANCELLED" }));
      this.#finish(state, item, { status: "cancelled" });
      return { status: "cancelled" };
    }
    item.status = "cancelling";
    this.#clearInteraction(item);
    this.emit("run-update", { ...item });
    await this.client.request("session.interrupt", { session_id: state.liveId }, { signal: this.#scope(signal), start });
    return { status: "stopping" };
  }

  getRun(runId) {
    const item = this.runs.get(String(runId));
    return item ? { ...item, interaction: item.interaction ? { ...item.interaction } : null } : null;
  }

  getObservedRuntime(storedId) {
    return this.sessions.get(String(storedId))?.observedRuntime || null;
  }

  #finish(state, item, updates) {
    if (TERMINAL.has(item.status) && TERMINAL.has(String(updates.status))) return;
    this.taskControllers.get(item)?.release();
    this.taskControllers.get(item)?.controller.abort(new Error("Hermes run ended."));
    if (item.interaction?.serverRequestId) {
      try { this.client.respondServerRequest(item.interaction.serverRequestId, undefined, { code: -32800, message: "Avalon run ended." }); } catch { /* disconnected or withdrawn */ }
    }
    this.#clearInteraction(item);
    Object.assign(item, updates, { interaction: null, finishedAt: Date.now() });
    this.emit("run-update", { ...item });
    this.emit("complete", { ...item });
    if (state.current?.runId === item.runId) state.current = null;
    void this.#drain(state);
  }

  #scheduleReconnect() {
    const signal = this.lifetime.signal;
    if (signal.aborted || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.client.connect();
        signal.throwIfAborted();
        const states = [...this.sessions.values()];
        this.liveSessions.clear();
        for (const state of states) {
          signal.throwIfAborted();
          const resumed = await this.client.request("session.resume", {
            session_id: state.storedId,
            source: "iris",
            close_on_disconnect: false,
            cols: 110,
          }, { signal });
          signal.throwIfAborted();
          state.liveId = resumed.session_id;
          state.observedRuntime = resumed.info ? { model: resumed.info.model || null, provider: resumed.info.provider || null } : null;
          state.route = null;
          this.liveSessions.set(state.liveId, state);
          if (state.current) state.current.liveSessionId = state.liveId;
          await this.#permissionOperation(() => this.#applyPermissionMode(state, this.permissionMode, signal));
          signal.throwIfAborted();
          this.#replayRequests(resumed);
        }
        this.emit("reconnected");
      } catch (error) {
        if (signal.aborted) return;
        this.log(`Hermes interactive reconnect failed: ${error?.message || error}`);
        this.#scheduleReconnect();
      }
    }, 1000);
  }

  #onBackendExit(detail) {
    this.liveSessions.clear();
    for (const state of this.sessions.values()) {
      const queued = state.queue.splice(0);
      if (state.current) {
        this.#finish(state, state.current, {
          status: "failed",
          error: `Hermes interactive backend exited (${detail.signal || detail.code || "unknown"}).`,
          ...(state.current.dispatchStarted && !this.conversationOnly ? { dispatchUncertain: true } : {}),
        });
      }
      for (const item of queued) {
        this.#finish(state, item, {
          status: "failed",
          error: `Hermes interactive backend exited (${detail.signal || detail.code || "unknown"}).`,
        });
      }
      state.liveId = null;
    }
  }

  close({ force = false } = {}) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.lifetime.abort(Object.assign(new Error("Hermes transport closed."), { code: "INTERRUPTED" }));
    this.client.close({ force });
    this.#onBackendExit({ signal: "closed" });
    this.sessionPromises.clear();
  }
}
