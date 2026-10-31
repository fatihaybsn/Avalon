/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

type SidecarMode = "none" | "camera" | "screen";

type IrisWakeRequest = {
  source?: string;
  detail?: string;
  generation?: number;
};

type SidecarEvent = {
  type: string;
  timestamp?: number;
  [key: string]: unknown;
};

type LiveAudioChunk = {
  data: string;
  pcm?: ArrayBuffer;
  mimeType?: string;
  utteranceId?: string;
};

type IrisUiAction = {
  action:
    | "open_latest_hermes_result"
    | "open_current_hermes_result"
    | "open_task"
    | "open_task_by_query"
    | "open_hermes_history"
    | "close_reader"
    | "close_history"
    | "close_all_overlays"
    | "show_task_steps"
    | "hide_task_steps"
    | "open_brain_graph"
    | "close_brain_graph"
    | "focus_brain_node"
    | "filter_brain_graph"
    | "open_brain_note"
    | "close_brain_note"
    | "show_full_brain_graph"
    | "enter_hud_mode"
    | "exit_hud_mode";
  target_id?: string;
  query?: string;
};

type BrainSelection = { provider: "evren" | "opencode"; modelId: string; reasoning?: string };
type ResearchSchedule = { kind: "daily" | "weekly" | "once"; time: string; day: number; date?: string; timezone: string };
type ResearchInput = { topic: string; purpose: string; sites: string[]; minutes: number; mode: "normal" | "deep"; outputDirectory: string; route?: BrainSelection; schedule?: ResearchSchedule | null };
type ResearchScheduledJob = { id: string; name: string; label: string; modelLabel?: string; paused: boolean; spec: ResearchInput; nextRunAt: string | null;
  lastRun: import("./types").TaskCard | null; history: import("./types").TaskCard[]; error: string; lastSkip?: { reason: string; at: number } };
type ResearchScheduleSnapshot = { jobs: ResearchScheduledJob[]; scheduler: { available: boolean; error?: string; timezone?: string } };
type BrainReasoningOption = { value: string; label: string; wire: { thinking?: boolean; reasoning_effort?: string } };
type BrainModelStatus = {
  selected: BrainSelection; effective: BrainSelection | null; pending: boolean; applying: boolean;
  preferences?: Record<string, string>;
  error: string | null; confirmation: { confirm?: string; message: string; warnings: Array<{ title: string; message: string }> } | null;
};
type BrainTestReport = {
  ok: boolean; accessible?: boolean; toolsVerified?: boolean; message?: string; error?: string;
  kind?: string; retryAt?: number; testedAt?: number; reasoning?: string;
};
type BrainCatalog = {
  configured: Record<BrainSelection["provider"], boolean>;
  models: Array<BrainSelection & { label: string; listed: boolean | null; catalogError: string | null; report: BrainTestReport | null; reasoningOptions: BrainReasoningOption[] }>;
};
type IrisConfig = {
  geminiApiKey: string;
  geminiApiKeyConfigured: boolean;
  geminiModel: string;
  geminiVoice: string;
  hermesUrl: string;
  hermesKey: string;
  hermesKeyConfigured: boolean;
  hermesBin: string;
  hermesHome: string;
  hermesSession: string;
  brainModelStatus: BrainModelStatus;
  opencodeKeyConfigured: boolean;
  brainPath: string;
  brainSemantic: boolean;
  brainAutoIndex: boolean;
  userName: string;
  loadTestData: boolean;
  wakeWord: boolean;
  wakeSensitivity: string;
  showWakeDiagnostics: boolean;
  sounds: boolean;
  startupSounds: boolean;
  startupSoundVolume: number;
  speechRate: number;
  conversationLanguage: "tr" | "en";
  permissionMode: "standard" | "full";
  autoSleepSeconds: string;
  autoWakeOnHermes: boolean;
  micDevice: string;
  cameraDevice: string;
  configured: boolean;
  voices: string[];
  models: string[];
  configPath: string;
  voiceDuplexMode: string;
  speakerEchoGuard: string;
};

type IrisTestResult = { ok: boolean; error?: string; health?: Record<string, unknown> };

type HermesHistoryTask = {
  id: string;
  sessionId?: string;
  task: string;
  status: string;
  output?: string;
  updatedAt: number;
  steps?: Array<{
    id: string;
    tool: string;
    preview?: string;
    status: "running" | "done" | "error";
    ts: number;
  }>;
  approval?: {
    command?: string;
    reason?: string;
    choices: Array<"once" | "session" | "always" | "deny">;
    requestedAt: number;
  } | null;
  interaction?: {
    id: string;
    type: "clarify" | "approval" | "sudo" | "secret";
    question: string;
    choices: string[];
    command?: string;
    envVar?: string;
    allowCustom: boolean;
    secret: boolean;
  } | null;
};

type HermesHistoryResult = {
  ok: boolean;
  tasks?: HermesHistoryTask[];
  sessions?: string[];
  error?: string;
};

type HermesSessionInfo = {
  id: string;
  source: string;
  title: string;
  preview: string;
  messageCount: number;
  lastActive: number;
};

type HermesSessionsResult = { ok: boolean; sessions: HermesSessionInfo[]; error?: string };

type BrainNode = {
  id: string;
  title: string;
  folder: string;
  degree: number;
};

type BrainLink = { source: string; target: string };

type BrainIndexStatus = {
  phase: "ready" | "indexing" | "stale" | "missing" | "error" | "lexical";
  automatic: boolean;
  updatedAt: string | null;
};

type BrainGraphResult = {
  ok: boolean;
  root?: string;
  nodes?: BrainNode[];
  links?: BrainLink[];
  missingLinks?: Array<{ source: string; target: string }>;
  indexStatus?: BrainIndexStatus;
  error?: string;
};

type BrainNoteResult = {
  ok: boolean;
  meta?: Record<string, string>;
  body?: string;
  error?: string;
};

type BrainIndexSyncResult = {
  ok: boolean;
  changed?: boolean;
  total?: number;
  chunks?: number;
  embedded?: number;
  reused?: number;
  pruned?: number;
  ms?: number;
  model?: string;
  location?: string;
  error?: string;
};

type BrainFilterResult = {
  ok: boolean;
  mode?: "hybrid" | "lexical";
  results?: Array<{ path: string; title: string; folder: string }>;
  error?: string;
};

type BrainSearchResult = {
  ok: boolean;
  mode?: "hybrid" | "lexical";
  results?: Array<{
    path: string;
    title: string;
    folder: string;
    snippet: string;
    sources: string[];
    confident: boolean;
  }>;
  error?: string;
};

type IrisApi = {
  researchDefaults: () => Promise<{ outputDirectory: string; minutes: number; route: BrainSelection }>;
  listResearch: () => Promise<import("./types").TaskCard[]>;
  proposeResearch: (input: ResearchInput) => Promise<{ ok: boolean; proposalId: string }>;
  listResearchSchedules: () => Promise<ResearchScheduleSnapshot>;
  researchScheduleAction: (id: string, action: "pause" | "resume" | "remove" | "run") => Promise<unknown>;
  updateResearchSchedule: (id: string, input: ResearchInput) => Promise<unknown>;
  chooseResearchDirectory: () => Promise<string | null>;
  openResearchOutput: (id: string) => Promise<unknown>;
  getWindowState: () => Promise<{ maximized: boolean }>;
  toggleMaximize: () => Promise<{ maximized: boolean }>;
  onWindowState: (callback: (state: { maximized: boolean }) => void) => () => void;
  transport?: "mobile";
  remoteStatus: () => Promise<RemoteStatus>;
  configureRemote: (value: { enabled: boolean; origin: string; port: number }) => Promise<RemoteStatus>;
  remotePairCode: () => Promise<{ code: string; expiresAt: number }>;
  revokeRemote: () => Promise<RemoteStatus>;
  setNotifications: (value: boolean) => Promise<RemoteStatus>;
  testNotification: () => Promise<{ ok: boolean }>;
  claimDesktopVoice: () => Promise<unknown>;
  stopTask: (id: string) => Promise<{ status: string; error?: string }>;
  readTaskResult: (id: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  searchMemory: (query: string, topK?: number) => Promise<unknown>;
  readMemoryNote: (source: string) => Promise<unknown>;
  startSidecar: (options?: { mode?: SidecarMode; wakeReason?: "user" | "notification"; wakeGeneration?: number }) => Promise<{ running: boolean; pid: number | null }>;
  stopSidecar: () => Promise<{ running: boolean; pid: number | null }>;
  getSidecarStatus: () => Promise<{ running: boolean; pid: number | null }>;
  getAppConfig: () => Promise<{
    loadTestData: boolean;
    sounds: boolean;
    userName: string;
    configured: boolean;
  }>;
  getConfig: () => Promise<IrisConfig>;
  saveConfig: (updates: Record<string, string>) => Promise<IrisConfig>;
  brainCatalog: (payload?: { refresh?: boolean; apiKey?: string }) => Promise<BrainCatalog>;
  brainStatus: () => Promise<BrainModelStatus>;
  testBrain: (payload: BrainSelection & { apiKey?: string }) => Promise<BrainTestReport>;
  selectBrain: (payload: BrainSelection & { apiKey?: string }) => Promise<BrainModelStatus>;
  confirmBrain: () => Promise<BrainModelStatus>;
  testGemini: (key?: string) => Promise<IrisTestResult>;
  testHermes: (payload?: { url?: string; key?: string }) => Promise<IrisTestResult>;
  previewVoice: (payload?: { voice?: string; key?: string }) => Promise<IrisTestResult>;
  getHermesHistory: () => Promise<HermesHistoryResult>;
  listHermesSessions: () => Promise<HermesSessionsResult>;
  createHermesSession: () => Promise<{ ok: boolean; id?: string; error?: string }>;
  approveHermesAction: (
    runId: string,
    choice: "once" | "session" | "always" | "deny",
  ) => Promise<{ status: string; error?: string }>;
  respondHermesInteraction: (payload: {
    run_id: string;
    interaction_id: string;
    interaction_type: "clarify" | "approval" | "sudo" | "secret";
    value?: string;
    choice?: "once" | "session" | "always" | "deny";
  }) => Promise<{ status: string; error?: string }>;
  loadBrain: () => Promise<BrainGraphResult>;
  readBrainNote: (relPath: string) => Promise<BrainNoteResult>;
  searchBrain: (query: string, topK?: number) => Promise<BrainSearchResult>;
  filterBrain: (query: string) => Promise<BrainFilterResult>;
  syncBrainIndex: (payload?: { vault?: string; key?: string }) => Promise<BrainIndexSyncResult>;
  onBrainChanged: (callback: () => void) => () => void;
  onBrainIndexChanged: (callback: (status: BrainIndexStatus) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
  toggleHud: () => Promise<{ mode: "deck" | "hud" }>;
  setHudInteractive: (on: boolean) => void;
  onHudMode: (callback: (payload: { mode: "deck" | "hud" }) => void) => () => void;
  onWakeRequest: (callback: (request: IrisWakeRequest) => void) => () => void;
  onSleepRequest: (callback: () => void) => () => void;
  onAutoSleep: (callback: () => void) => () => void;
  sendMessage: (input: { id: string; sessionId: string; text: string }) => Promise<{ ok: boolean; id: string }>;
  searchSources: (input: { query: string; scope: "all" | "notes" | "results"; sessionId: string }) => Promise<{ results: SourceSearchHit[]; warning?: string }>;
  listReminders: () => Promise<ReminderItem[]>;
  saveReminder: (input: ReminderInput, id?: string, revision?: number) => Promise<ReminderItem>;
  reminderAction: (input: { id: string; revision: number; action: string; minutes?: number; occurrenceId?: string }) => Promise<{ ok: boolean }>;
  sendCommand: (
    command: Record<string, unknown>,
  ) => Promise<{ ok: boolean; reason?: string }>;
  sendUiContext: (context: Record<string, unknown>) => void;
  sendAudioChunk: (chunk: ArrayBuffer) => void;
  notifyBootDone: () => void;
  onUiAction: (callback: (action: IrisUiAction) => void) => () => void;
  onAudioChunk: (callback: (chunk: LiveAudioChunk) => void) => () => void;
  onAudioInterrupt: (callback: () => void) => () => void;
  onAudioOutputEnd: (callback: (payload: { utteranceId: string }) => void) => () => void;
  getConversationHistory: () => Promise<{ ok: boolean; sessionId: string; messages: Array<{ id: string; speaker: string; text: string; sessionId?: string }> }>;
  respondTaskProposal: (proposalId: string, choice: "once" | "deny") => Promise<{ status: string; error?: string }>;
  onSidecarEvent: (callback: (event: SidecarEvent) => void) => () => void;
};

type RemoteStatus = {
  enabled: boolean; running: boolean; origin: string; port: number; error: string | null;
  paired: boolean; deviceId?: string; deviceName: string; notifications: boolean; pushReady: boolean; pending: number; pushError: string | null;
  voice: { deviceId: string | null; generation: number };
};

interface Window {
  iris: IrisApi;
}


type SourceSearchHit = { kind: "note" | "result"; path: string; title: string; snippet: string };
type MessageStatus = "sending" | "waiting" | "completed" | "failed";
type ReminderInput = { title: string; description: string; schedule: ResearchSchedule };
type ReminderOccurrence = { id: string; at: number; snoozeAt?: number; completedAt?: number; supersededAt?: number };
type ReminderItem = ReminderInput & { id: string; revision: number; paused: boolean; nextAt: number | null; pending: ReminderOccurrence | null; history: ReminderOccurrence[] };
