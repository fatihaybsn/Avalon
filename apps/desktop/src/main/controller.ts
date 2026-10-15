import { randomUUID } from 'node:crypto';
import {bindChatTask} from '../shared/chat-task.ts';
import type { Snapshot, Session, Work } from '../shared/contracts.ts';
import { RpcError, type Rpc } from './gateway.ts';
import { projectMessages, projectSession, projectApproval, record, text, messageText } from './projection.ts';
const EMPTY: Snapshot = { connection: { phase: 'offline', detail: 'Gateway henüz bağlı değil.' }, sessions: [], messages: [], streaming: '', approvals: [], approvalsAvailable: false, submissions: [], historyReady: false };
export class DesktopController {
  snapshot: Snapshot = structuredClone(EMPTY);
  private selectionEpoch = 0;
  private refreshJob?: Promise<void>;
  private refreshAgain = false;
  private roots = new Map<string, { sessionId: string; root: string }>();
  private projectIds = new Map<string, string>();
  private streams = new Map<string, { key: string; text: string; seq: number }>();
  private timer?: ReturnType<typeof setInterval>;
  private sending = new Set<string>();
  private listRevision = 0;
  constructor(private rpc: Rpc, private agentId: string, private publish: (s: Snapshot) => void) {}
  emit() { this.publish(structuredClone(this.snapshot)); }
  connection(s: Snapshot['connection']) {
    this.snapshot.connection = s;
    if (s.phase !== 'connected') { this.snapshot.historyReady = false; this.snapshot.approvalsAvailable = false; this.snapshot.workAvailable = false; }
    this.emit();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
  async connected() {
    this.stop(); this.snapshot.error = undefined;
    this.snapshot.approvalsAvailable = false;
    this.listRevision++;
    await this.rpc.request('sessions.subscribe', {});
    await this.refresh();
    // No automatic session creation or write on reconnect.
    this.timer = setInterval(() => { void this.refresh().catch(e => this.showError(e)); }, 15000);
  }
  showError(e: unknown) {
    const code = e instanceof RpcError ? e.code : 'LOCAL_ERROR';
    this.snapshot.error = code === 'WRITE_OUTCOME_UNKNOWN' ? 'Sonuç belirsiz. İşlem tekrar gönderilmedi. Gateway kayıtlarını yenileyin.' : `İşlem başarısız (${code}).`;
    if (e instanceof RpcError && /UNAVAILABLE|BUSY/.test(e.code)) this.snapshot.connection = { ...this.snapshot.connection, phase: 'busy', detail: 'Gateway meşgul veya hazırlanıyor; yazma tekrar gönderilmedi.' };
    this.emit();
  }
  async refresh() {
    if (this.refreshJob) { this.refreshAgain = true; return this.refreshJob; }
    this.refreshJob = this.refreshLoop();
    try { await this.refreshJob; } finally { this.refreshJob = undefined; }
  }
  private async refreshLoop() {
    do {
      this.refreshAgain = false;
      const revision = this.listRevision;
      const roster = await this.rpc.request('sessions.list', { agentId: this.agentId, limit: 200, excludeSubagents: false, excludeCron: true, excludeSystem: true, includeGlobal: false, includeUnknown: false });
      if (!this.rpc.connected) return;
      // Session events racing a read require a trailing authoritative read.
      if (revision !== this.listRevision) { this.refreshAgain = true; continue; }
      this.snapshot.sessions = (Array.isArray(roster.sessions) ? roster.sessions : []).map(projectSession).filter((s: Session | undefined): s is Session => !!s && s.key.startsWith(`agent:${this.agentId}:`)).map((s: Session) => {
        const root = this.roots.get(s.key);
        if (root && root.sessionId !== s.sessionId) this.roots.delete(s.key);
        return { ...s, scopeRoot: this.roots.get(s.key)?.root };
      });
      if (!this.snapshot.selected || !this.snapshot.sessions.some(s => s.key === this.snapshot.selected)) {
        this.snapshot.selected = this.snapshot.sessions.find(s => s.title.startsWith('Günlük'))?.key ?? this.snapshot.sessions[0]?.key;
        this.selectionEpoch++;
        this.snapshot.messages = []; this.snapshot.streaming = ''; this.snapshot.historyReady = false;
      }
      // Observe pending approvals from the same native registry, not a new store.
      const approvals = await Promise.allSettled(['plugin', 'exec'].map(kind => this.rpc.request(`${kind}.approval.list`, {}).then(r => ({ kind, result: r }))));
      const observed: Snapshot['approvals'] = [];
      this.snapshot.approvalsAvailable = approvals.every(r => r.status === 'fulfilled');
      for (const r of approvals) if (r.status === 'fulfilled') {
        const body = r.value.result;
        // 2026.10.2 list methods return arrays of pending registry references.
        const rows = Array.isArray(body) ? body : [];
        for (const row of rows.slice(0, 100)) {
          try {
            const canonical = await this.rpc.request('approval.get', { id: row.id });
            const a = projectApproval({ ...record(canonical.approval), sessionKey: row.request?.sessionKey, runId: row.request?.runId }, r.value.kind);
            if (a?.status === 'pending') observed.push(a);
          } catch { this.snapshot.approvalsAvailable = false; }
        }
      }
      if (this.snapshot.approvalsAvailable) this.snapshot.approvals = observed;
      if (this.snapshot.selected) await this.history(this.snapshot.selected);
      await this.refreshWork();
      if (this.snapshot.connection.phase === 'busy') this.snapshot.connection = { ...this.snapshot.connection, phase: 'connected', detail: 'Yetkili JARVIS Gateway bağlantısı açık.' };
      this.emit();
    } while (this.refreshAgain && this.rpc.connected);
  }
  private session(key: string) {
    const s = this.snapshot.sessions.find(s => s.key === key);
    if (!s) throw new RpcError('UNKNOWN_SESSION');
    return s;
  }
  async select(key: string) {
    this.session(key); this.selectionEpoch++;
    this.snapshot.selected = key; this.snapshot.messages = []; this.snapshot.streaming = ''; this.snapshot.historyReady = false; this.emit();
    // Subscribe/read only. Switching never aborts, resets, steers or ends a run.
    await this.history(key);
  }
  private async history(key: string) {
    const epoch = this.selectionEpoch;
    await this.rpc.request('sessions.messages.subscribe', { key, agentId: this.agentId });
    const ids = this.snapshot.submissions.filter(s => s.sessionKey === key && s.status === 'unknown').map(s => s.id).slice(-20);
    const result = await this.rpc.request('chat.history', { sessionKey: key, agentId: this.agentId, limit: 100, maxBytes: 250000, ...(ids.length ? { inputRunIds: ids } : {}) });
    if (epoch !== this.selectionEpoch || this.snapshot.selected !== key || !this.rpc.connected) return;
    this.snapshot.messages = projectMessages(result.messages);
    const active = projectSession({ ...record(result.sessionInfo), key });
    if (active) this.snapshot.sessions = this.snapshot.sessions.map(s => s.key === key ? { ...s, active: active.active, runIds: active.runIds, queued: active.queued } : s);
    for (const receipt of result.inputReceipts ?? []) {
      const submission = this.snapshot.submissions.find(s => s.id === receipt.runId && s.sessionKey === key);
      if (submission && ['pending', 'consumed'].includes(receipt.state)) { submission.status = 'accepted'; submission.detail = receipt.state === 'pending' ? 'Gateway giriş kaydını kabul etmiş; kuyrukta.' : 'Gateway giriş kaydını işleme almış.'; }
    }
    const stream = Array.from(this.streams.values()).find(s => s.key === key);
    this.snapshot.streaming = stream?.text ?? '';
    this.snapshot.historyReady = true; this.emit();
  }
  async create(title: string, kind: 'daily' | 'project') {
    const id = randomUUID();
    const key = `agent:${this.agentId}:jarvis:${kind}:${id}`;
    const result = await this.rpc.request('sessions.create', { key, agentId: this.agentId, displayName: `${kind === 'daily' ? 'Günlük' : 'Proje'} · ${title.trim()}`, idempotencyKey: id }, true);
    const returned = result.key ?? result.sessionKey;
    if (returned !== key) throw new RpcError('SESSION_TARGET_MISMATCH');
    await this.refresh(); await this.select(key);
    // No parent, fork, raw history, cwd, model override or title-model call.
  }
  setRoot(key: string, root: string) {
    const session = this.session(key); this.roots.set(key, { sessionId: session.sessionId, root });
    this.snapshot.sessions = this.snapshot.sessions.map(s => s.key === key ? { ...s, scopeRoot: root } : s); this.emit();
  }
  private quickTargets=new Map<string,{key:string;sessionId:string;app:string;at:number;window:Record<string,unknown>}>();
  async quick(action: {key:string;command:string;app:string;value:string;windowId:string}) {
    const s=this.session(action.key); if(action.key!==this.snapshot.selected || s.active || s.queued)throw new RpcError('SESSION_BUSY');
    const params:Record<string,unknown>={action:action.command};
    if(['resolve','open','status','focus','minimize','restore','close'].includes(action.command))params.app=action.app;
    if(['focus','minimize','restore','close'].includes(action.command)) {
      const w=this.quickTargets.get(action.windowId);
      if(!w || w.key!==action.key || w.sessionId!==s.sessionId || w.app!==action.app || Date.now()-w.at>60000)throw new RpcError('WINDOW_OBSERVATION_REQUIRED');
      params.window=w.window;
    }
    if(action.command==='volume') {const n=Number(action.value);if(!Number.isFinite(n)||n<0||n>100)throw new RpcError('VOLUME_RANGE');params.value=n;}
    if(action.command==='mute'){if(!['true','false'].includes(action.value))throw new RpcError('MUTE_BOOLEAN');params.value=action.value==='true';}
    if(action.command==='media'){if(!['play_pause','next','previous','stop'].includes(action.value))throw new RpcError('MEDIA_ACTION');params.value=action.value;}
    if(action.command==='power'){if(!['saver','balanced','performance'].includes(action.value))throw new RpcError('POWER_MODE');params.value=action.value;}
    const id=randomUUID(),root=this.roots.get(action.key)?.root;
    await this.rpc.request('jarvis.scope.bind',{sessionKey:action.key,agentId:this.agentId,runId:id,taskId:id,projectId:this.projectIds.get(action.key) ?? action.key,...(root?{role:'project',root}:{role:'memory'}),quick:[{tool:'jarvis_windows',params}],userInput:`Yerel Windows işlemi: ${action.command}; ${action.app}; ${action.value}`},true);
    const result=await this.rpc.request('jarvis.quick.execute',{sessionKey:action.key,agentId:this.agentId,runId:id,callId:id,tool:'jarvis_windows',params},true);
    this.snapshot.quickOutput=JSON.stringify(result.details,null,2);
    if(Array.isArray(result.details?.windows)) {
      this.quickTargets.clear();this.snapshot.quickWindows=result.details.windows.map((w:Record<string,unknown>)=>{const wid=randomUUID();const {pid,started,exe,hwnd}=w;this.quickTargets.set(wid,{key:action.key,sessionId:s.sessionId,app:action.app,at:Date.now(),window:{pid,started,exe,hwnd}});return {id:wid,app:action.app,title:String(w.title ?? ''),pid:Number(pid)};});
    }
    await this.refreshWork();this.emit();
  }
  async send(key: string, message: string) {
    const session = this.session(key);
    if (key !== this.snapshot.selected || !this.snapshot.historyReady) throw new RpcError('HISTORY_NOT_READY');
    if (this.sending.has(key) || session.active || session.queued) throw new RpcError('SESSION_BUSY');
    if (message.trimStart().startsWith('/')) throw new RpcError('CONTROL_COMMAND_DISABLED');
    const id = randomUUID(), root = this.roots.get(key)?.root;
    this.snapshot.error = undefined;
    const submission: Snapshot['submissions'][number] = { id, sessionKey: key, status: 'sending', detail: 'Gateway yanıtı bekleniyor.' };
    this.snapshot.submissions = [...this.snapshot.submissions.slice(-49), submission]; this.sending.add(key); this.emit();
    let sent = false;
    try {
      const projectId = this.projectIds.get(key) ?? this.snapshot.work?.find(r => r.sessionKey === key && r.sessionId === session.sessionId)?.projectId ?? key;
      await bindChatTask({request:(m,p)=>this.rpc.request(m,p,true)},key,id,message,{projectId,root});
      sent = true;
      await this.rpc.request('jarvis.work.start', { sessionKey: key, agentId: this.agentId, runId: id, message, ...(key.startsWith(`agent:${this.agentId}:subagent:`) ? { independent: true } : {}) }, true);
      submission.status = 'accepted'; submission.detail = 'Gateway iletinin kabulünü doğruladı; çalışma durumu host kayıtlarından okunur.';
    } catch (e) {
      const unknown = e instanceof RpcError && e.code === 'WRITE_OUTCOME_UNKNOWN';
      submission.status = unknown && sent ? 'unknown' : 'rejected';
      submission.detail = unknown && sent ? 'Sonuç belirsiz; otomatik tekrar gönderilmez. Gateway kayıtlarını kontrol edin.' : 'İleti gönderilmedi veya Gateway açıkça reddetti.';
      if (unknown && !sent) submission.detail = 'Kapsam bağlamasının sonucu belirsiz; sohbet iletisi gönderilmedi.';
      throw e;
    } finally { this.sending.delete(key); this.emit(); }
    await this.refresh().catch(e => this.showError(e));
  }
  private async refreshWork() {
    if (!this.snapshot.selected) return;
    try {
      const works: Work[] = [], resources: NonNullable<Snapshot['resources']> = []; let cursor: string | undefined;
      do {
        const result = await this.rpc.request('jarvis.work.status', { sessionKey: this.snapshot.selected, agentId: this.agentId, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(result.records) || result.observationError) throw new RpcError('WORK_RECORDS_UNAVAILABLE');
        works.push(...result.records); cursor = result.cursor;
        if (Array.isArray(result.resources)) resources.push(...result.resources);
      } while (cursor && works.length < 500);
      if (cursor) throw new RpcError('WORK_PAGE_LIMIT');
      this.snapshot.work = works.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); this.snapshot.workAvailable = true;
      this.snapshot.resources = resources;
    } catch { this.snapshot.workAvailable = false; }
  }
  async independent(key: string, message: string) {
    const source = this.session(key), id = randomUUID(), child = `agent:${this.agentId}:subagent:jarvis:${id}`;
    const root = this.roots.get(key)?.root;
    // Native parent-linked creation requires the parent writer to be idle.
    // A fresh subagent key leaves that live writer untouched; stable project
    // metadata relates the two without copying conversation or authority.
    const result = await this.rpc.request('sessions.create', { key: child, agentId: this.agentId, displayName: `Proje · Bağımsız iş ${id.slice(0, 8)}`, idempotencyKey: id }, true);
    if ((result.key ?? result.sessionKey) !== child) throw new RpcError('SESSION_TARGET_MISMATCH');
    this.projectIds.set(child, this.projectIds.get(key) ?? this.snapshot.work?.find(r => r.sessionKey === key && r.sessionId === source.sessionId)?.projectId ?? key);
    await this.refresh(); await this.select(child);
    // Rebind a new host grant to this new incarnation; no grant inheritance.
    if (root) this.setRoot(child, root);
    await this.send(child, message);
  }
  async workAction(kind: 'steer' | 'cancel' | 'workRead' | 'acceptPlan', taskId: string, message?: string) {
    const task = this.snapshot.work?.find(t => t.taskId === taskId);
    if (!task || !this.snapshot.workAvailable) throw new RpcError('WORK_NOT_CURRENT');
    const common = { sessionKey: task.sessionKey, agentId: task.agentId, taskId };
    if (kind === 'workRead') {
      const result = await this.rpc.request('jarvis.work.read', { ...common, ...(task.operation ? { callId: task.operation.callId } : {}) });
      this.snapshot.workOutput = result.output ? messageText(result.output) : 'Bu native run için istenen asıl çıktı henüz mevcut değil; kayıt başarı kanıtı değildir.'; this.emit(); return;
    }
    if (kind === 'acceptPlan' && !task.model?.plan) throw new RpcError('PLAN_UNAVAILABLE');
    const steer = kind === 'steer' || kind === 'acceptPlan';
    await this.rpc.request(`jarvis.work.${steer ? 'steer' : 'cancel'}`, { ...common, expectedRevision: task.revision, ...(steer ? { inputId: randomUUID(), message: kind === 'acceptPlan' ? task.model!.plan : message, ...(kind === 'acceptPlan' ? { acceptPlan: task.model!.plan } : {}) } : {}) }, true);
    await this.refresh();
  }
  event(event: string, payload: any) {
    if (event === 'desktop.disconnected') {
      this.stop(); this.selectionEpoch++; this.snapshot.historyReady = false; this.streams.clear(); this.snapshot.streaming = ''; this.emit(); return;
    }
    if (event === 'cron' || event === 'sessions.changed' || event === 'desktop.gap' || event.endsWith('.approval.requested') || event.endsWith('.approval.resolved')) {
      this.listRevision++;
      if (event === 'desktop.gap') { this.streams.clear(); this.snapshot.streaming = ''; }
      void this.refresh().catch(e => this.showError(e)); return;
    }
    const p = record(payload);
    if (event === 'agent' && ['lifecycle', 'tool', 'error', 'approval'].includes(p.stream)) { void this.refresh().catch(e => this.showError(e)); }
    if (event === 'chat' && typeof p.runId === 'string' && typeof p.sessionKey === 'string') {
      const key = p.sessionKey;
      if (!this.snapshot.sessions.some(s => s.key === key)) return;
      if (p.state === 'delta') {
        const old = this.streams.get(p.runId);
        if (old && typeof p.seq === 'number' && p.seq <= old.seq) return;
        // Authoritative first/replacement snapshot includes this delta already.
        if (!old && p.message === undefined) { void this.refresh().catch(e => this.showError(e)); return; }
        const value = p.message !== undefined ? messageText(p.message) : p.replace === true ? text(p.deltaText, 50000) : (old?.text ?? '') + text(p.deltaText, 50000);
        this.streams.set(p.runId, { key, text: value.slice(-50000), seq: p.seq ?? 0 });
        if (key === this.snapshot.selected) this.snapshot.streaming = value.slice(-50000);
        this.snapshot.sessions = this.snapshot.sessions.map(s => s.key === key ? { ...s, active: true } : s); this.emit();
      } else if (['final', 'error', 'aborted'].includes(p.state)) {
        this.streams.delete(p.runId);
        if (key === this.snapshot.selected) this.snapshot.streaming = '';
        if (p.state === 'error') this.snapshot.error = `Görev hata bildirdi (${text(p.errorKind, 80) || 'unknown'}). Seçili model/işçi bağlantısının aşama durumu geçerlidir.`;
        this.emit(); void this.refresh().catch(e => this.showError(e));
      }
    }
  }
}
