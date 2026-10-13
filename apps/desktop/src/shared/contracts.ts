export type ConnectionPhase = 'connecting' | 'connected' | 'offline' | 'starting' | 'busy' | 'pairing' | 'auth' | 'blocked';
export type Session = { key: string; sessionId: string; title: string; active: boolean; runIds: string[]; queued: boolean; scopeRoot?: string };
export type Message = { id: string; role: string; text: string };
export type Approval = { id: string; kind: string; status: string; title: string; details: string; sessionKey?: string; runId?: string; expiresAtMs?: number };
export type Submission = { id: string; sessionKey: string; status: 'sending' | 'accepted' | 'unknown' | 'rejected'; detail: string };
export type Snapshot = {
  connection: { phase: ConnectionPhase; detail: string; deviceId?: string; requestId?: string; version?: string };
  sessions: Session[]; selected?: string; messages: Message[];
  streaming: string; approvals: Approval[]; approvalsAvailable: boolean;
  submissions: Submission[]; error?: string; historyReady: boolean;
};
export type Action =
  | { type: 'snapshot' | 'refresh' | 'reconnect' | 'chooseScope' | 'hide' | 'quit' }
  | { type: 'select'; key: string }
  | { type: 'create'; title: string; kind: 'daily' | 'project' }
  | { type: 'send'; key: string; message: string };
export type Result = { ok: true; snapshot: Snapshot } | { ok: false; error: string; snapshot: Snapshot };
export interface DesktopBridge { action(action: Action): Promise<Result>; subscribe(listener: (snapshot: Snapshot) => void): () => void }
