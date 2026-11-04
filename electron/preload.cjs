const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("iris", {
  startSidecar: (options) => ipcRenderer.invoke("sidecar:start", options),
  stopSidecar: () => ipcRenderer.invoke("sidecar:stop"),
  getSidecarStatus: () => ipcRenderer.invoke("sidecar:status"),
  getAppConfig: () => ipcRenderer.invoke("app:config"),
  getConfig: () => ipcRenderer.invoke("config:get"),
  remoteStatus: () => ipcRenderer.invoke("remote:status"),
  configureRemote: (value) => ipcRenderer.invoke("remote:configure", value),
  remotePairCode: () => ipcRenderer.invoke("remote:pair-code"),
  revokeRemote: () => ipcRenderer.invoke("remote:revoke"),
  setNotifications: (value) => ipcRenderer.invoke("remote:notifications", value),
  testNotification: () => ipcRenderer.invoke("remote:test"),
  claimDesktopVoice: () => ipcRenderer.invoke("remote:desktop-voice"),
  stopTask: (id) => ipcRenderer.invoke("hermes:stop-task", id),
  readTaskResult: (id) => ipcRenderer.invoke("hermes:read-result", id),
  searchMemory: (query, topK) => ipcRenderer.invoke("memory:search", query, topK),
  readMemoryNote: (source) => ipcRenderer.invoke("memory:read", source),
  saveConfig: (updates) => ipcRenderer.invoke("config:save", updates),
  brainCatalog: (payload) => ipcRenderer.invoke("brain:catalog", payload),
  brainStatus: () => ipcRenderer.invoke("brain:status"),
  testBrain: (payload) => ipcRenderer.invoke("brain:test", payload),
  selectBrain: (payload) => ipcRenderer.invoke("brain:select", payload),
  confirmBrain: () => ipcRenderer.invoke("brain:confirm"),
  testGemini: (key) => ipcRenderer.invoke("config:test-gemini", { key }),
  testHermes: (payload) => ipcRenderer.invoke("config:test-hermes", payload),
  previewVoice: (payload) => ipcRenderer.invoke("config:preview-voice", payload),
  getHermesHistory: () => ipcRenderer.invoke("hermes:history"),
  getConversationHistory: () => ipcRenderer.invoke("hermes:conversation"),
  respondTaskProposal: (proposalId, choice) => ipcRenderer.invoke("hermes:proposal-response", { proposal_id: proposalId, choice }),
  listHermesSessions: () => ipcRenderer.invoke("hermes:sessions"),
  createHermesSession: () => ipcRenderer.invoke("hermes:create-session"),
  approveHermesAction: (runId, choice) =>
    ipcRenderer.invoke("hermes:approve", { run_id: runId, choice }),
  respondHermesInteraction: (payload) =>
    ipcRenderer.invoke("hermes:interaction-response", payload),
  loadBrain: () => ipcRenderer.invoke("brain:load"),
  readBrainNote: (relPath) => ipcRenderer.invoke("brain:read", relPath),
  searchBrain: (query, topK) => ipcRenderer.invoke("brain:search", query, topK),
  filterBrain: (query) => ipcRenderer.invoke("brain:filter", query),
  syncBrainIndex: (payload) => ipcRenderer.invoke("brain:sync-index", payload),
  onBrainChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("brain:changed", handler);
    return () => ipcRenderer.removeListener("brain:changed", handler);
  },
  onBrainIndexChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("brain:index-changed", handler);
    return () => ipcRenderer.removeListener("brain:index-changed", handler);
  },
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  toggleHud: () => ipcRenderer.invoke("hud:toggle"),
  getWindowState: () => ipcRenderer.invoke("window:state"),
  researchDefaults: () => ipcRenderer.invoke("research:defaults"),
  listResearch: () => ipcRenderer.invoke("research:list"),
  listAutomations: () => ipcRenderer.invoke("automation:list"),
  installAutomation: () => ipcRenderer.invoke("automation:install"),
  openAutomationEditor: () => ipcRenderer.invoke("automation:editor"),
  saveAutomationSchedule: (id, schedule) => ipcRenderer.invoke("automation:schedule", id, schedule),
  proposeResearch: (input) => ipcRenderer.invoke("research:propose", input),
  listResearchSchedules: () => ipcRenderer.invoke("research:schedules"),
  researchScheduleAction: (id, action) => ipcRenderer.invoke("research:schedule-action", id, action),
  updateResearchSchedule: (id, input) => ipcRenderer.invoke("research:schedule-update", id, input),
  chooseResearchDirectory: () => ipcRenderer.invoke("research:choose-directory"),
  openResearchOutput: (id) => ipcRenderer.invoke("research:open-output", id),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  onWindowState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("window:state", handler);
    return () => ipcRenderer.removeListener("window:state", handler);
  },
  setHudInteractive: (on) => ipcRenderer.send("hud:interactive", Boolean(on)),
  onHudMode: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("hud:mode", handler);
    return () => ipcRenderer.removeListener("hud:mode", handler);
  },
  onWakeRequest: (callback) => {
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on("iris:wake", handler);
    return () => ipcRenderer.removeListener("iris:wake", handler);
  },
  onSleepRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("iris:sleep", handler);
    return () => ipcRenderer.removeListener("iris:sleep", handler);
  },
  onAutoSleep: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("iris:auto-sleep", handler);
    return () => ipcRenderer.removeListener("iris:auto-sleep", handler);
  },
  sendMessage: (input) => ipcRenderer.invoke("conversation:send", input),
  searchSources: (input) => ipcRenderer.invoke("sources:search", input),
  listReminders: () => ipcRenderer.invoke("reminders:list"),
  saveReminder: (input, id, revision) => ipcRenderer.invoke("reminders:put", input, id, revision),
  reminderAction: (input) => ipcRenderer.invoke("reminders:action", input),
  sendCommand: (command) => ipcRenderer.invoke("sidecar:command", command),
  sendUiContext: (context) => ipcRenderer.send("iris:ui-context", context),
  sendAudioChunk: (chunk) => ipcRenderer.send("live:audio", chunk),
  notifyBootDone: () => ipcRenderer.send("iris:boot-done"),
  onUiAction: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("iris:ui-action", handler);
    return () => ipcRenderer.removeListener("iris:ui-action", handler);
  },
  onAudioChunk: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live:audio", handler);
    return () => ipcRenderer.removeListener("live:audio", handler);
  },
  onAudioInterrupt: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live:interrupt", handler);
    return () => ipcRenderer.removeListener("live:interrupt", handler);
  },
  onAudioOutputEnd: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live:output-end", handler);
    return () => ipcRenderer.removeListener("live:output-end", handler);
  },
  onSidecarEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("sidecar:event", handler);
    return () => ipcRenderer.removeListener("sidecar:event", handler);
  },
});
