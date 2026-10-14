import { LitElement, html, nothing } from 'lit';
import { renderPanelEmptyState } from '../../vendor/openclaw/ui/src/components/panel-empty-state.ts';
import { detectTextDirection } from '../../vendor/openclaw/ui/src/lib/text-direction.ts';
import type { Action, DesktopBridge, Snapshot } from '../shared/contracts.ts';
import type {VoiceCommand} from '../shared/voice.ts';
import '../../vendor/openclaw/ui/src/styles/base.css';
import './desktop.css';
declare global { interface Window { jarvis: DesktopBridge } }
class JarvisApp extends LitElement {
  static properties = { data: { state: true }, draft: { state: true }, title: { state: true }, kind: { state: true }, waiting: { state: true }, localError: { state: true }, creating: { state: true }, guidance: { state: true },quickCommand:{state:true},quickApp:{state:true},quickValue:{state:true},quickWindow:{state:true} };
  data?: Snapshot;
  draft = ''; title = ''; kind: 'daily' | 'project' = 'project'; waiting = false; localError = ''; creating = false;
  guidance = '';
  quickCommand='status';quickApp='notepad';quickValue='50';quickWindow='none';
  private async quick() {
    const key=this.data?.selected;if(!key||this.waiting)return;
    this.waiting=true;
    await this.action({type:'quick',key,command:this.quickCommand,app:this.quickApp,value:this.quickValue,windowId:this.quickWindow});
    this.waiting=false;
  }
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
  private voice(command:VoiceCommand,value=''){return this.action({type:'voice',command,value});}
  override render() {
    const d = this.data, connected = d?.connection.phase === 'connected';
    const selected = d?.sessions.find(s => s.key === d.selected);
    const phases: Record<string, string> = { connecting: 'Bağlanıyor', connected: 'Bağlı', offline: 'Bağlantı yok', starting: 'Başlangıçta', busy: 'Meşgul', pairing: 'Eşleştirme gerekli', auth: 'Kullanıcı bağlantısı gerekli', blocked: 'Bağlantı engeli' };
    return html`
      <header><strong>JARVIS</strong><span role="status">${phases[d?.connection.phase ?? 'offline']} ${d?.connection.version ?? ''}</span>
        <button @click=${() => this.action({ type: 'reconnect' })}>Yeniden bağlan</button><button @click=${() => this.action({ type: 'hide' })}>Tepsiye gizle</button><button @click=${() => this.action({ type: 'quit' })}>Uygulamadan çık</button></header>
      <div class="connection-detail">${d?.connection.detail ?? 'İstemci hazırlanıyor…'}${d?.connection.requestId ? html`<br>İstek: ${d.connection.requestId}` : nothing}${d?.connection.phase === 'pairing' ? html`<br>Cihaz: ${d.connection.deviceId}` : nothing}</div>
      ${this.localError || d?.error ? html`<p class="error" role="alert">${this.localError || d?.error}</p>` : nothing}
      ${d?.voice?html`<section class="voice-controls" aria-label="Sesli görüşme"><strong>Ses · ${d.voice.phase==='idle'?'Kapalı':d.voice.phase==='error'?'Hata':d.voice.muted?'Mikrofon susturuldu':d.voice.phase==='listening'?'Dinleniyor':d.voice.phase==='thinking'?'Yanıt hazırlanıyor':'Bağlanıyor'}</strong>
        <span role="status">${d.voice.detail}</span>
        <button ?disabled=${!connected||!selected||!['idle','error'].includes(d.voice.phase)} @click=${()=>this.voice('start')}>Görüşmeyi aç</button>
        <button ?disabled=${['idle','error'].includes(d.voice.phase)} @click=${()=>this.voice('mute')}>${d.voice.muted?'Mikrofonu aç':'Mikrofonu sustur'}</button>
        <button ?disabled=${!d.voice.turnId} @click=${()=>this.voice('stopOutput')}>Yanıtın sesini durdur</button>
        <button ?disabled=${d.voice.phase==='idle'} @click=${()=>this.voice('end')}>Görüşmeyi bitir</button>
        <details><summary>Cihazlar ve kısayol</summary>
          <button @click=${()=>this.voice('devices')}>Cihazları yenile</button>
          <label>Mikrofon<select .value=${d.voice.inputId} @change=${(e:Event)=>this.voice('input',(e.target as HTMLSelectElement).value)}><option value="">Sistem varsayılanı</option>${d.voice.inputs.filter(i=>i.id).map(i=>html`<option value=${i.id}>${i.label}</option>`)}</select></label>
          <label>Hoparlör<select .value=${d.voice.outputId} @change=${(e:Event)=>this.voice('output',(e.target as HTMLSelectElement).value)}><option value="">Sistem varsayılanı</option>${d.voice.outputs.filter(i=>i.id).map(i=>html`<option value=${i.id}>${i.label}</option>`)}</select></label>
          <label>Görüşme kısayolu<input maxlength="100" .value=${d.voice.shortcut} @change=${(e:Event)=>this.voice('shortcut',(e.target as HTMLInputElement).value)}></label><span>${d.voice.shortcutRegistered?'Kısayol kayıtlı':'Kısayol çalışmıyor: geçersiz veya çakışıyor'}</span>
          <label>Boşta kapanma (dakika; 0 kapalı)<input type="number" min="0" max="240" .value=${String(d.voice.idleMinutes)} @change=${(e:Event)=>this.voice('idle',(e.target as HTMLInputElement).value)}></label>
        </details><p class="muted">Görüşmeyi bitirmek o görüşmeden başlatılan işi iptal edebilir. Yazılı işler mikrofon gerektirmez. Telefon talimatı bu bilgisayarın sesini açmaz.</p>
        ${d.voice.sessionKey?html`<small>Sesin bağlı olduğu sohbet: ${d.voice.sessionKey}</small>`:nothing}
      </section>`:nothing}
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
        <details><summary>Hızlı Windows işlemi</summary>
          <label>Uygulama<select .value=${this.quickApp} @change=${(e:Event)=>{this.quickApp=(e.target as HTMLSelectElement).value;this.quickWindow='none';}}><option value="notepad" .selected=${this.quickApp==='notepad'}>Not Defteri</option><option value="calculator" .selected=${this.quickApp==='calculator'}>Hesap Makinesi</option><option value="paint" .selected=${this.quickApp==='paint'}>Paint</option></select></label>
          <label>İşlem<select .value=${this.quickCommand} @change=${(e:Event)=>{this.quickCommand=(e.target as HTMLSelectElement).value;this.quickValue=({mute:'true',media:'play_pause',power:'balanced'} as Record<string,string>)[this.quickCommand] ?? '50';}}>
          ${Object.entries({resolve:'Kurulumu kontrol et',status:'Pencereleri oku',open:'Uygulamayı aç',focus:'Pencereyi odakla',minimize:'Pencereyi küçült',restore:'Pencereyi geri getir',close:'Normal kapatma iste',audio_status:'Ses durumunu oku',volume:'Ses seviyesini ayarla',mute:'Mute ayarla',media:'Medya kontrolü',power_status:'Güç planını oku',power:'Güç modunu ayarla'}).map(([value,label])=>html`<option value=${value} .selected=${this.quickCommand===value}>${label}</option>`)}</select></label>
          ${['focus','minimize','restore','close'].includes(this.quickCommand)?html`<label>Güncel pencere<select .value=${this.quickWindow} @change=${(e:Event)=>this.quickWindow=(e.target as HTMLSelectElement).value}><option value="none" .selected=${this.quickWindow==='none'}>Önce pencereleri oku, sonra hedefi seç</option>${d?.quickWindows?.filter(w=>w.app===this.quickApp).map(w=>html`<option value=${w.id} .selected=${this.quickWindow===w.id}>${w.title || this.quickApp} · PID ${w.pid}</option>`)}</select></label>`:nothing}
          ${this.quickCommand==='volume'?html`<label>Ses seviyesi (0–100)<input type="number" min="0" max="100" .value=${this.quickValue} @input=${(e:Event)=>this.quickValue=(e.target as HTMLInputElement).value}></label>`:nothing}
          ${['mute','media','power'].includes(this.quickCommand)?html`<label>Değer<select .value=${this.quickValue} @change=${(e:Event)=>this.quickValue=(e.target as HTMLSelectElement).value}>${Object.entries(this.quickCommand==='mute'?{true:'Sessiz',false:'Sesi aç'}:this.quickCommand==='media'?{play_pause:'Oynat / duraklat',next:'Sonraki',previous:'Önceki',stop:'Durdur'}:{saver:'Tasarruf',balanced:'Dengeli',performance:'Performans'}).map(([value,label])=>html`<option value=${value} .selected=${this.quickValue===value}>${label}</option>`)}</select></label>`:nothing}
          <button ?disabled=${!connected||!selected||selected.active||selected.queued||this.waiting} @click=${()=>this.quick()}>Seçilen işlemi uygula</button>
          <p class="muted">Pencere gözlemi 60 saniye geçerlidir. Normal kapatma kaydetme/iptal seçimini cevaplamaz. Kapatma mevcut Gateway onayından geçer.</p>
          ${d?.quickOutput?html`<details open><summary>Yerel sonuç</summary><pre>${d.quickOutput}</pre></details>`:nothing}
        </details>
        <label>Göreve yönlendirme<textarea rows="2" maxlength="1800" .value=${this.guidance} @input=${(e: Event) => this.guidance = (e.target as HTMLTextAreaElement).value}></textarea></label>
        ${!d?.workAvailable ? html`<p>Güncel çalışma kaydı okunamıyor. Önceki gözlem güncel sayılmaz.</p>` : nothing}
        ${d?.work?.map(t => html`<section class="approval"><strong>${t.request.slice(0, 160)}</strong><p>${t.state} · revizyon ${t.revision}</p><small>Proje: ${t.projectId} · r${t.projectRevision}<br>Görev: ${t.taskId}<br>Session: ${t.sessionId}<br>Run: ${t.runId}<br>${t.updatedAt}</small>
          ${t.acceptedPlan ? html`<details><summary>Kabul edilmiş plan / istek</summary><p>${t.acceptedPlan}</p></details>` : nothing}
          ${t.operation ? html`<p>Gözlenen: ${t.operation.tool} · ${t.operation.phase} · r${t.operation.revision ?? 'bilinmiyor'}<br>Gerçek etki: ${t.operation.effect === 'verified' ? 'Doğrulandı' : 'Doğrulanmadı'}</p>` : nothing}
          <p>Sonuç: ${t.result === 'native-ended' ? 'Native çalışma bitti; hedefin karşılandığı ayrıca değerlendirilir' : t.result}</p>
          ${t.blocker ? html`<p class="error">${t.blocker}</p>` : nothing}
          ${t.model ? html`<details><summary>Modelin açıklaması</summary><p>${t.model.plan}</p><p>${t.model.finding}</p><p>${t.model.rationale}</p><p>Sıradaki adım: ${t.model.nextStep}</p><p>Bekleyen karar: ${t.model.pendingDecision}</p>${t.model.sources?.map(s => html`<small>${s}</small>`)}</details>` : nothing}
          ${Object.values(t.steering).map(s => html`<p>Yönlendirme: ${s.stage}<small>${s.text}${s.modelClaim ? html`<br>Doğrulanmamış model açıklaması: ${s.modelClaim}` : nothing}</small></p>`)}
          <button ?disabled=${!connected || !d.workAvailable} @click=${() => this.action({ type: 'workRead', taskId: t.taskId })}>Güncel çıktı ${d.unreadResults?.includes(t.taskId)?'• Okunmamış':''}</button>
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
          <p class="muted">Aktif görüşmede sunulan tek işlem sorusunu sesle yanıtlayabilirsiniz. Satın alma/ödeme ve sesle sunulamayan ayrıntılar için mevcut OpenClaw manuel onay kontrolünü kullanın.</p></aside></div>`;
  }
}
customElements.define('jarvis-app', JarvisApp);
