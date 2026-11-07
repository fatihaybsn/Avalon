type Listener = (value: any) => void;
export type MobileState = { config: IrisConfig; sessionId: string; tasks: import("../types").TaskCard[]; messages: import("../types").TranscriptLine[]; proposal: { id: string; task: string } | null; remote: RemoteStatus; live: { running: boolean } };

export function mobileConnection(onUnauthorized: () => void) {
  const listeners = new Map<string, Set<Listener>>();
  let events: WebSocket | null = null, audio: WebSocket | null = null, retry = 0, closed = false;
  let generation = -1, audioHeader: Record<string, any> | null = null, carry = new Uint8Array(0);
  const emit = (channel: string, value: unknown) => listeners.get(channel)?.forEach((fn) => fn(value));
  const subscribe = (channel: string, fn: Listener) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(fn); return () => { listeners.get(channel)?.delete(fn); };
  };
  const request = async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const value = await response.json();
    if (response.status === 401) onUnauthorized();
    if (!response.ok) throw new Error(value.error || "Bağlantı kurulamadı.");
    return value;
  };
  const rpc = async <T,>(method: string, ...args: unknown[]): Promise<T> => {
    // Mutations are never silently retried. The server records this request ID.
    const value = await request<{ result: T }>("/api/v1/rpc", { method, args, requestId: crypto.randomUUID() });
    return value.result;
  };
  const socket = (route: string) => new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${route}`);
  function connectEvents() {
    closed = false; events = socket("/api/v1/events");
    events.onopen = () => emit("sidecar:event", { type: "remote_connected" });
    events.onmessage = (message) => { try { const frame = JSON.parse(message.data); emit(frame.channel, frame.payload); } catch { /* Invalid frames carry no operations. */ } };
    events.onclose = () => {
      emit("sidecar:event", { type: "remote_disconnected" });
      if (!closed) retry = window.setTimeout(connectEvents, 2000);
    };
  }
  const command = (value: Record<string, unknown>) => {
    if (audio?.readyState !== WebSocket.OPEN) return false;
    audio.send(JSON.stringify({ ...value, generation })); return true;
  };
  const api = {
    transport: "mobile",
    async startSidecar(options?: { mode?: SidecarMode; wakeReason?: "user" | "notification"; wakeGeneration?: number }) {
      await rpc("startSidecar", options);
      const remote = await rpc<RemoteStatus>("remoteStatus"); generation = remote.voice.generation;
      const previous = audio; audio = socket("/api/v1/audio"); previous?.close();
      const current = audio; current.binaryType = "arraybuffer"; carry = new Uint8Array(0);
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => { current.close(); reject(new Error("Ses bağlantısı zaman aşımı.")); }, 10000);
        current.onopen = () => { clearTimeout(timer); resolve(); };
        current.onerror = () => { clearTimeout(timer); reject(new Error("Ses bağlantısı açılamadı.")); };
        current.onclose = () => { clearTimeout(timer); reject(new Error("Ses bağlantısı kapandı.")); if (audio === current) { audio = null; emit("live:interrupt", {}); emit("sidecar:event", { type: "voice_disconnected" }); } };
      });
      current.onmessage = (message) => {
        if (message.data instanceof ArrayBuffer) {
          if (audioHeader?.generation === generation) emit("live:audio", { ...audioHeader, data: "", pcm: message.data });
          audioHeader = null;
        } else {
          try {
            const frame = JSON.parse(message.data);
            if (frame.generation !== generation) return;
            if (frame.type === "audio") audioHeader = frame;
            else emit(frame.type, frame);
          } catch { current.close(); }
        }
      };
      return { running: true, pid: 0 };
    },
    async stopSidecar() {
      const previous = audio; audio = null; carry = new Uint8Array(0);
      // Clear speech on the server before socket closure can release ownership.
      try { return await rpc("stopSidecar", generation); }
      finally { previous?.close(); }
    },
    getSidecarStatus: () => rpc("getSidecarStatus"),
    sendCommand: (value: Record<string, unknown>) => {
      if (value.type === "text") return rpc("sendCommand", value, generation);
      return Promise.resolve({ ok: command(value) });
    },
    sendAudioChunk: (value: ArrayBuffer) => {
      if (audio?.readyState !== WebSocket.OPEN) return;
      if (audio.bufferedAmount > 64 * 1024) { audio.close(); return; }
      const combined = new Uint8Array(carry.length + value.byteLength); combined.set(carry); combined.set(new Uint8Array(value), carry.length);
      let offset = 0;
      while (combined.length - offset >= 640) { audio.send(combined.slice(offset, offset + 640)); offset += 640; }
      carry = combined.slice(offset);
    },
    sendUiContext: (value: unknown) => { void rpc("sendUiContext", value).catch(() => {}); },
    onSidecarEvent: (fn: Listener) => subscribe("sidecar:event", fn),
    onAudioChunk: (fn: Listener) => subscribe("live:audio", fn),
    onAudioInterrupt: (fn: Listener) => subscribe("live:interrupt", fn),
    onAudioOutputEnd: (fn: Listener) => subscribe("live:output-end", fn),
    onWakeRequest: (fn: Listener) => subscribe("iris:wake", fn),
    onSleepRequest: (fn: Listener) => subscribe("iris:sleep", fn),
    onAutoSleep: (fn: Listener) => subscribe("iris:auto-sleep", fn),
    onUiAction: (fn: Listener) => subscribe("iris:ui-action", fn),
    onBrainChanged: (fn: Listener) => subscribe("brain:changed", fn),
    notifyBootDone() {}, setHudInteractive() {},
    openExternal: async (url: string) => { if (/^https?:\/\//.test(url)) window.open(url, "_blank", "noopener,noreferrer"); },
    onHudMode: () => () => {}, toggleHud: async () => ({ mode: "deck" }),
    remoteStatus: () => rpc("remoteStatus"), setNotifications: (value: boolean) => rpc("setNotifications", value), testNotification: () => rpc("testNotification"),
    testGemini: (key?: string) => rpc("testGemini", { key }),
    respondTaskProposal: (id: string, choice: string) => rpc("respondTaskProposal", { proposal_id: id, choice }),
    approveHermesAction: (id: string, choice: string) => rpc("approveHermesAction", { run_id: id, choice }),
  } as unknown as IrisApi;
  const direct = ["sendMessage", "searchSources", "listReminders", "saveReminder", "reminderAction", "listResearch", "researchDefaults", "listResearchSchedules", "listAutomations", "saveAutomationSchedule", "cancelAutomationRun", "respondAutomation", "acknowledgeAutomationReview", "proposeResearch", "updateResearchSchedule", "researchScheduleAction", "getAppConfig", "getConfig", "saveConfig", "brainCatalog", "brainStatus", "testBrain", "selectBrain", "confirmBrain", "testHermes", "previewVoice", "getHermesHistory", "getConversationHistory", "listHermesSessions", "createHermesSession", "respondHermesInteraction", "stopTask", "readTaskResult", "loadBrain", "readBrainNote", "searchBrain", "filterBrain", "syncBrainIndex", "searchMemory", "readMemoryNote"];
  for (const method of direct) (api as any)[method] = (...args: unknown[]) => rpc(method, ...args);
  return { api, request, rpc, snapshot: () => request<MobileState>("/api/v1/state"), connectEvents,
    viewed: (ids: string[]) => { if (document.visibilityState === "visible" && events?.readyState === WebSocket.OPEN) events.send(JSON.stringify({ type: "viewed", ids })); },
    close() { closed = true; clearTimeout(retry); events?.close(); audio?.close(); },
  };
}
