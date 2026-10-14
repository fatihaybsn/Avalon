import { LitElement, html, nothing } from 'lit';
import { renderPanelEmptyState } from '../../vendor/openclaw/ui/src/components/panel-empty-state.ts';
import { detectTextDirection } from '../../vendor/openclaw/ui/src/lib/text-direction.ts';
import type { Action, DesktopBridge, Snapshot } from '../shared/contracts.ts';
import '../../vendor/openclaw/ui/src/styles/base.css';
import './desktop.css';
declare global { interface Window { jarvis: DesktopBridge } }
class JarvisApp extends LitElement {
  static properties = { data: { state: true }, draft: { state: true }, title: { state: true }, kind: { state: true }, waiting: { state: true }, localError: { state: true }, creating: { state: true }, guidance: { state: true } };
  data?: Snapshot;
  draft = ''; title = ''; kind: 'daily' | 'project' = 'project'; waiting = false; localError = ''; creating = false;
  guidance = '';
  private drafts = new Map<string, string>();
  private unsubscribe?: () => void;
  override createRenderRoot() { return this; }
  override connectedCallback() {
    super.connectedCallback();
    if (!window.jarvis) { this.localError = 'Electron istemcisi bağlantısı yok. Arayüzü npm run desktop:dev ile açın.'; return; }
    this.unsubscribe = window.jarvis.subscribe(data => this.accept(data));
    void this.action({ type: 'snapshot' });
  }
  override disconnectedCallback() { this.unsubscribe?.(); super.disconnectedCallback(); }
  private accept(data: Snapshot) {
    if (this.data?.selected !== data.selected) {
      if (this.data?.selected) this.drafts.set(this.data.selected, this.draft);
      this.draft = data.selected ? this.drafts.get(data.selected) ?? '' : '';
    }
    this.data = data;
  }
  private async action(a: Action) {
    this.localError = '';
    try { const result = await window.jarvis.action(a); this.accept(result.snapshot); if (!result.ok) this.localError = result.error; return result.ok; }
    catch { this.localError = 'İstemci işlemi reddedildi veya bağlantı kesildi.'; return false; }
  }
  private async send() {
    const key = this.data?.selected, message = this.draft.trim();
    if (!key || !message || this.waiting) return;
    this.waiting = true;
    const ok = await this.action({ type: 'send', key, message });
    if (ok) { this.drafts.delete(key); if (this.data?.selected === key) this.draft = ''; }
    this.waiting = false;
  }
  override render() {
    const d = this.data, connected = d?.connection.phase === 'connected';
    const selected = d?.sessions.find(s => s.key === d.selected);
    const phases: Record<string, string> = { connecting: 'Bağlanıyor', connected: 'Bağlı', offline: 'Bağlantı yok', starting: 'Başlangıçta', busy: 'Meşgul', pairing: 'Eşleştirme gerekli', auth: 'Kullanıcı bağlantısı gerekli', blocked: 'Bağlantı engeli' };
    return html`
      <header><strong>JARVIS</strong><span role="status">${phases[d?.connection.phase ?? 'offline']} ${d?.connection.version ?? ''}</span>
        <button @click=${() => this.action({ type: 'reconnect' })}>Yeniden bağlan</button><button @click=${() => this.action({ type: 'hide' })}>Tepsiye gizle</button><button @click=${() => this.action({ type: 'quit' })}>Uygulamadan çık</button></header>
      <div class="connection-detail">${d?.connection.detail ?? 'İstemci hazırlanıyor…'}${d?.connection.requestId ? html`<br>İstek: ${d.connection.requestId}` : nothing}${d?.connection.phase === 'pairing' ? html`<br>Cihaz: ${d.connection.deviceId}` : nothing}</div>
      ${this.localError || d?.error ? html`<p class="error" role="alert">${this.localError || d?.error}</p>` : nothing}
      <div class="desktop-layout"><aside aria-label="Sohbetler"><h2>Sohbetler</h2>
        <button ?disabled=${!connected} @click=${() => { this.creating = !this.creating; }}>Yeni sohbet</button>
        ${this.creating ? html`<div class="create-session"><label>Sohbet türü<select .value=${this.kind} @change=${(e: Event) => this.kind = (e.target as HTMLSelectElement).value as 'daily' | 'project'}><option value="project">Ayrı proje sohbeti</option><option value="daily">Günlük sohbet</option></select></label><label>Başlık<input maxlength="120" .value=${this.title} @input=${(e: Event) => this.title = (e.target as HTMLInputElement).value}></label><button ?disabled=${!connected || !this.title.trim() || this.waiting} @click=${async () => { this.waiting = true; if (await this.action({ type: 'create', title: this.title, kind: this.kind })) { this.title = ''; this.creating = false; } this.waiting = false; }}>Oluştur</button></div>` : nothing}
        <nav>${d?.sessions.map(s => html`<button class="session" aria-current=${s.key === d.selected ? 'page' : 'false'} ?disabled=${!connected} @click=${() => this.action({ type: 'select', key: s.key })}>${s.title}${s.active ? ' · Çalışıyor' : s.queued ? ' · Kuyrukta' : ''}</button>`)}</nav>
        <p class="muted">Günlük ve proje sohbetleri aynı JARVIS workspace’indedir. Yeni sohbet ayrı geçmişle başlar.</p></aside>
      <main><h1>${selected?.title ?? 'Sohbet seçin veya oluşturun'}</h1>
        <div class="transcript" role="log" aria-label="Sohbet geçmişi" aria-live="polite">
        ${!d?.messages.length && !d?.streaming ? renderPanelEmptyState({ icon: html``, heading: selected ? 'Sohbet' : 'JARVIS sohbetleri', description: selected ? d?.historyReady ? 'Bu sohbette henüz görünür ileti yok.' : 'Geçmiş Gateway’den bekleniyor.' : 'Bağlantı kurulduğunda günlük veya proje sohbeti oluşturabilirsiniz.' }) : d?.messages.map(m => html`<article class="message"><strong>${m.role === 'user' ? 'Siz' : 'JARVIS'}</strong><div dir=${detectTextDirection(m.text)}>${m.text}</div></article>`)}
        ${d?.streaming ? html`<article class="message"><strong>JARVIS · Yanıt sürüyor</strong><div dir=${detectTextDirection(d.streaming)}>${d.streaming}</div></article>` : nothing}</div>
        <div class="composer"><label for="draft">İleti</label><textarea id="draft" maxlength="16000" rows="3" .value=${this.draft} @input=${(e: Event) => this.draft = (e.target as HTMLTextAreaElement).value} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void this.send(); } }}></textarea>
        <div class="composer-actions"><button ?disabled=${!connected || !selected || !d?.historyReady || selected.active || selected.queued || this.waiting || !this.draft.trim()} @click=${() => this.send()}>Gönder</button><button ?disabled=${!connected || !selected || this.waiting || !this.draft.trim()} @click=${async () => { if (!selected) return; this.waiting = true; await this.action({ type: 'independent', key: selected.key, message: this.draft.trim() }); this.waiting = false; }}>Bağımsız iş başlat</button><button ?disabled=${!connected || !selected} @click=${() => this.action({ type: 'chooseScope' })}>Görev klasörü seç</button></div>
        <p class="muted">${selected?.scopeRoot ? `Dosya görevlerinin izin kökü: ${selected.scopeRoot}` : 'Görev klasörü seçilmezse dosya araçlarının yetki kapsamı bağlı değildir.'}</p>
        <p class="muted">Enter: gönder · Shift+Enter: yeni satır</p></div></main>
      <aside aria-label="Görevler ve onaylar"><h2>Mevcut görevler</h2><button ?disabled=${!connected} @click=${() => this.action({ type: 'refresh' })}>Kayıtları yenile</button>
        <label>Göreve yönlendirme<textarea rows="2" maxlength="1800" .value=${this.guidance} @input=${(e: Event) => this.guidance = (e.target as HTMLTextAreaElement).value}></textarea></label>
        ${!d?.workAvailable ? html`<p>Güncel çalışma kaydı okunamıyor. Önceki gözlem güncel sayılmaz.</p>` : nothing}
        ${d?.work?.map(t => html`<section class="approval"><strong>${t.request.slice(0, 160)}</strong><p>${t.state} · revizyon ${t.revision}</p><small>Proje: ${t.projectId} · r${t.projectRevision}<br>Görev: ${t.taskId}<br>Session: ${t.sessionId}<br>Run: ${t.runId}<br>${t.updatedAt}</small>
          ${t.acceptedPlan ? html`<details><summary>Kabul edilmiş plan / istek</summary><p>${t.acceptedPlan}</p></details>` : nothing}
          ${t.operation ? html`<p>Gözlenen: ${t.operation.tool} · ${t.operation.phase} · r${t.operation.revision ?? 'bilinmiyor'}<br>Gerçek etki: ${t.operation.effect === 'verified' ? 'Doğrulandı' : 'Doğrulanmadı'}</p>` : nothing}
          <p>Sonuç: ${t.result === 'native-ended' ? 'Native çalışma bitti; hedefin karşılandığı ayrıca değerlendirilir' : t.result}</p>
          ${t.blocker ? html`<p class="error">${t.blocker}</p>` : nothing}
          ${t.model ? html`<details><summary>Modelin açıklaması</summary><p>${t.model.plan}</p><p>${t.model.finding}</p><p>${t.model.rationale}</p><p>Sıradaki adım: ${t.model.nextStep}</p><p>Bekleyen karar: ${t.model.pendingDecision}</p>${t.model.sources?.map(s => html`<small>${s}</small>`)}</details>` : nothing}
          ${Object.values(t.steering).map(s => html`<p>Yönlendirme: ${s.stage}<small>${s.text}${s.modelClaim ? html`<br>Doğrulanmamış model açıklaması: ${s.modelClaim}` : nothing}</small></p>`)}
          <button ?disabled=${!connected || !d.workAvailable} @click=${() => this.action({ type: 'workRead', taskId: t.taskId })}>Güncel çıktı</button>
          <button ?disabled=${!connected || !d.workAvailable || !['running', 'delivered'].includes(t.state) || !this.guidance.trim()} @click=${() => this.action({ type: 'steer', taskId: t.taskId, message: this.guidance.trim() })}>Bu göreve ilet</button>
          ${t.model?.plan ? html`<button ?disabled=${!connected || !d.workAvailable || !['running', 'delivered'].includes(t.state)} @click=${() => this.action({ type: 'acceptPlan', taskId: t.taskId })}>Bu planı kabul et</button>` : nothing}
          <button ?disabled=${!connected || !d.workAvailable || !['running', 'delivered'].includes(t.state)} @click=${() => this.action({ type: 'cancel', taskId: t.taskId })}>Bu görevi iptal et</button>
        </section>`)}
        ${d?.workOutput ? html`<details open><summary>İstenen asıl çıktı</summary><pre>${d.workOutput}</pre></details>` : nothing}
        <h2>Paylaşılan kaynaklar</h2>
        ${d?.workAvailable ? d.resources?.length ? d.resources.map(r => html`<p>${r.resource}<small>Sahip run: ${r.runId}<br>Çağrı: ${r.callId}</small></p>`) : html`<p class="muted">Host gözleminde tutulan kaynak yok.</p>` : html`<p>Kaynak sahipliği için güncel host kaydı gerekli.</p>`}
        <p class="muted">Pause bu native yolda desteklenmiyor. Ayrı sohbet açmak mevcut görevi iptal etmez.</p>
        ${!connected ? html`<p>Son gözlem güncel olmayabilir; Gateway bağlantısı gerekli.</p>` : nothing}
        ${d?.sessions.filter(s => s.active || s.queued).map(s => html`<p>${s.title}: ${s.active ? 'Host çalışıyor bildiriyor' : 'Host kuyruk bildiriyor'}${s.runIds.map(id => html`<small>${id}</small>`)}</p>`)}
        ${connected && !d?.sessions.some(s => s.active || s.queued) ? html`<p class="muted">Host listesinde etkin görev yok.</p>` : nothing}
        ${d?.submissions.slice(-5).reverse().map(s => html`<p class="submission">${s.detail}<small>${s.sessionKey}<br>${s.id}</small></p>`)}
        <h2>Bekleyen onaylar</h2>
        ${!d?.approvalsAvailable ? html`<p>Onay kaydı okunamıyor; yetkili operator.approvals bağlantısı gerekli.</p>` : !d.approvals.length ? html`<p class="muted">Gateway’de bekleyen onay yok.</p>` : d.approvals.map(a => html`<section class="approval"><strong>${a.title}</strong><p>${a.details}</p><small>${a.kind} · ${a.status}<br>${a.id}${a.runId ? html`<br>Görev: ${a.runId}` : nothing}${a.sessionKey ? html`<br>Sohbet: ${a.sessionKey}` : nothing}</small></section>`)}
        <p class="muted">Bu aşamada onaylar görüntülenir. Karar işlemi mevcut OpenClaw yetkili onay istemcisindedir.</p></aside></div>`;
  }
}
customElements.define('jarvis-app', JarvisApp);
