// Explicit application operations shared by IPC and the authenticated web adapter.
export const APPLICATION_METHODS = Object.freeze({
  sendMessage: "conversation:send", searchSources: "sources:search",
  listReminders: "reminders:list", saveReminder: "reminders:put", reminderAction: "reminders:action",
  proposeResearch: "research:propose", updateResearchSchedule: "research:schedule-update", researchScheduleAction: "research:schedule-action",
  getAppConfig: "app:config", getConfig: "config:get", saveConfig: "config:save",
  brainCatalog: "brain:catalog", brainStatus: "brain:status", testBrain: "brain:test", selectBrain: "brain:select", confirmBrain: "brain:confirm",
  testGemini: "config:test-gemini", testHermes: "config:test-hermes", previewVoice: "config:preview-voice",
  getHermesHistory: "hermes:history", getConversationHistory: "hermes:conversation", respondTaskProposal: "hermes:proposal-response",
  listHermesSessions: "hermes:sessions", createHermesSession: "hermes:create-session", approveHermesAction: "hermes:approve",
  respondHermesInteraction: "hermes:interaction-response", stopTask: "hermes:stop-task",
  readTaskResult: "hermes:read-result",
  listResearch: "research:list", researchDefaults: "research:defaults", listResearchSchedules: "research:schedules",
  listAutomations: "automation:mobile-list", saveAutomationSchedule: "automation:mobile-schedule",
  cancelAutomationRun: "automation:cancel-run",
  loadBrain: "brain:load", readBrainNote: "brain:read", searchBrain: "brain:search", filterBrain: "brain:filter", syncBrainIndex: "brain:sync-index",
  searchMemory: "memory:search", readMemoryNote: "memory:read",
});
export const READ_METHODS = new Set(["searchSources", "listReminders", "getAppConfig", "getConfig", "brainCatalog", "brainStatus", "getHermesHistory", "getConversationHistory", "listHermesSessions", "loadBrain", "readBrainNote", "searchBrain", "filterBrain", "searchMemory", "readMemoryNote", "readTaskResult", "remoteStatus", "listResearch", "researchDefaults", "listResearchSchedules", "listAutomations"]);
