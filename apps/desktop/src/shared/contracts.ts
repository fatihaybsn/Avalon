export type ConnectionPhase = 'connecting' | 'connected' | 'offline' | 'starting' | 'busy' | 'pairing' | 'auth' | 'blocked';
export type Session = { key: string; sessionId: string; title: string; active: boolean; runIds: string[]; queued: boolean; scopeRoot?: string };
export type Message = { id: string; role: string; text: string };
export type Approval = { id: string; kind: string; status: string; title: string; details: string; sessionKey?: string; runId?: string; expiresAtMs?: number };
export type Submission = { id: string; sessionKey: string; status: 'sending' | 'accepted' | 'unknown' | 'rejected'; detail: string };
export type Work = { taskId: string; projectId: string; projectRevision: number; revision: number; recordVersion: number; agentId: string; sessionKey: string; sessionId: string; runId: string; request: string; acceptedPlan?: string; state: string; result: string; blocker?: string; updatedAt: string; model?: { plan?: string; finding?: string; sources?: string[]; rationale?: string; nextStep?: string; pendingDecision?: string }; operation?: { callId: string; tool: string; revision?: number; phase: string; effect: string }; steering: Record<string, { text: string; revision: number; stage: string; modelClaim?: string }> };
export type Snapshot = {
  connection: { phase: ConnectionPhase; detail: string; deviceId?: string; requestId?: string; version?: string };
  sessions: Session[]; selected?: string; messages: Message[];
  streaming: string; approvals: Approval[]; approvalsAvailable: boolean;
  submissions: Submission[]; error?: string; historyReady: boolean;
  work?: Work[]; workAvailable?: boolean; workOutput?: string;
  quickOutput?: string;
  quickWindows?: {id:string;app:string;title:string;pid:number}[];
  resources?: { resource: string; runId: string; callId: string }[];
};
export type Action =
  | { type: 'snapshot' | 'refresh' | 'reconnect' | 'chooseScope' | 'hide' | 'quit' }
  | { type: 'select'; key: string }
  | { type: 'create'; title: string; kind: 'daily' | 'project' }
  | { type: 'send' | 'independent'; key: string; message: string }
  | { type: 'quick'; key:string; command:string; app:string; value:string; windowId:string }
  | { type: 'steer'; taskId: string; message: string }
  | { type: 'cancel' | 'workRead' | 'acceptPlan'; taskId: string };
export type Result = { ok: true; snapshot: Snapshot } | { ok: false; error: string; snapshot: Snapshot };
export interface DesktopBridge { action(action: Action): Promise<Result>; subscribe(listener: (snapshot: Snapshot) => void): () => void }
