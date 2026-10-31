import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TaskCard } from "../types";
import RemindersPanel, { ReminderForm } from "./RemindersPanel";
import { brainLabel } from "./BrainModelPanel";

const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—";
const isActive = (task: TaskCard) => ["starting", "running", "stopping"].includes(task.status);

function ResearchForm({ scheduled, job, onClose, onSaved }: { scheduled: boolean; job?: ResearchScheduledJob; onClose: () => void; onSaved: () => void }) {
  const [topic, setTopic] = useState(job?.spec.topic || "");
  const [purpose, setPurpose] = useState(job?.spec.purpose || "");
  const [sites, setSites] = useState(job?.spec.sites.join("\n") || "");
  const [minutes, setMinutes] = useState(job?.spec.minutes || 30);
  const [mode, setMode] = useState<"normal" | "deep">(job?.spec.mode || "deep");
  const [directory, setDirectory] = useState(job?.spec.outputDirectory || "");
  const [route, setRoute] = useState<BrainSelection | null>(job?.spec.route || null);
  const [catalog, setCatalog] = useState<BrainCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [defaultsError, setDefaultsError] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const mounted = useRef(true);
  const [schedule, setSchedule] = useState<ResearchSchedule>(job?.spec.schedule || { kind: "daily", time: "09:00", day: 6, timezone: "Europe/Istanbul", date: new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }) });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function loadDefaults() {
    setLoadingDefaults(true); setDefaultsError("");
    try {
      const value = await window.iris.researchDefaults();
      if (!value?.route) throw new Error("Araştırma için etkin model alınamadı.");
      if (mounted.current) {
        setDirectory((current) => current || value.outputDirectory);
        setRoute((current) => current || value.route);
      }
    } catch (error) { if (mounted.current) setDefaultsError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setLoadingDefaults(false); }
  }
  async function loadCatalog() {
    setLoadingCatalog(true); setCatalogError("");
    try {
      const value = await window.iris.brainCatalog();
      if (!Array.isArray(value?.models) || !value.models.length) throw new Error("Model listesi alınamadı.");
      if (mounted.current) setCatalog(value);
    } catch (error) { if (mounted.current) setCatalogError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setLoadingCatalog(false); }
  }
  useEffect(() => {
    mounted.current = true;
    if (!job?.spec.route || !directory) void loadDefaults();
    void loadCatalog();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape); return () => { mounted.current = false; window.removeEventListener("keydown", escape); };
  }, []);
  const models = catalog?.models || [];
  const selectedModel = models.find((model) => model.provider === route?.provider && model.modelId === route.modelId);
  const reasoning = route?.reasoning || "default";
  const reasoningOptions = selectedModel?.reasoningOptions || [];
  async function submit() {
    if (!route || busy || loadingDefaults) return;
    setBusy(true); setError("");
    const input: ResearchInput = { topic, purpose, sites: sites.split(/[\n,]/).map((s) => s.trim()).filter(Boolean), minutes, mode, outputDirectory: directory, route: { ...route }, schedule: scheduled ? schedule : null };
    try {
      if (job) await window.iris.updateResearchSchedule(job.id, input);
      else await window.iris.proposeResearch(input);
      onSaved(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return createPortal(<div className="research-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="research-form" role="dialog" aria-modal="true" aria-label={scheduled ? "Zamanlanmış araştırma" : "Derin araştırma"} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <header><h2>{job ? "Zamanlamayı düzenle" : scheduled ? "Araştırma zamanla" : "Derin araştırma"}</h2><button type="button" onClick={onClose} aria-label="Araştırma formunu kapat">×</button></header>
      <label>Konu<textarea required maxLength={12000} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Neyi araştırmamı istiyorsun?" /></label>
      <label>Amaç / beklenen sonuç<textarea maxLength={4000} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Hangi sorular cevaplanmalı? İlanlar için aradığın koşulları belirt." /></label>
      <details className="research-advanced"><summary>Gelişmiş seçenekler</summary>
      <label>Tercih edilen siteler <small>(isteğe bağlı, her satıra bir kaynak)</small><textarea value={sites} onChange={(event) => setSites(event.target.value)} placeholder="Şirket kariyer sayfaları, ilan siteleri…" /></label>
      <div className="research-fields">
        {scheduled && <label>Araştırma türü<select value={mode} onChange={(event) => setMode(event.target.value as "normal" | "deep")}><option value="deep">Derin araştırma</option><option value="normal">Normal araştırma</option></select></label>}
        <label>Üst süre<select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>{[15, 30, 60, 120].map((value) => <option value={value} key={value}>{value} dakika</option>)}</select></label>
      </div>
      <fieldset><legend>Bu araştırmanın modeli</legend>
        <div className="research-fields">
          <label>Sağlayıcı / Model<select aria-label="Araştırma sağlayıcısı ve modeli" value={route ? `${route.provider}/${route.modelId}` : ""} disabled={busy || loadingCatalog || !catalog || !route} onChange={(event) => {
            const model = models.find((item) => `${item.provider}/${item.modelId}` === event.target.value);
            if (model) setRoute({ provider: model.provider, modelId: model.modelId });
          }}>
            {!selectedModel && <option value={route ? `${route.provider}/${route.modelId}` : ""}>{route ? brainLabel(route) : "Etkin model yükleniyor…"}</option>}
            {(["evren", "opencode"] as const).map((provider) => <optgroup key={provider} label={provider === "evren" ? "Evren" : "OpenCode Free"}>
              {models.filter((model) => model.provider === provider).map((model) => <option key={`${provider}/${model.modelId}`} value={`${provider}/${model.modelId}`}>{model.label}</option>)}
            </optgroup>)}
          </select></label>
          <label>Düşünme seviyesi<select aria-label="Araştırma düşünme seviyesi" value={reasoning} disabled={busy || loadingCatalog || reasoningOptions.length <= 1} onChange={(event) => {
            if (route) setRoute({ provider: route.provider, modelId: route.modelId, ...(event.target.value === "default" ? {} : { reasoning: event.target.value }) });
          }}>
            {!reasoningOptions.some((option) => option.value === reasoning) && <option value={reasoning}>{reasoning === "default" ? "Varsayılan" : `Kayıtlı: ${reasoning}`}</option>}
            {reasoningOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
        </div>
        <p>Seçim bu göreve kaydedilir. Sohbet modelini değiştirmez. {job ? "Değişiklik sonraki çalışmalarda kullanılır; çalışan araştırma kendi seçimini korur." : "Araştırmanın tüm aşamaları bu seçimi kullanır."}</p>
        {selectedModel && reasoningOptions.length <= 1 && <p>Bu model için doğrulanmış bir düşünme kontrolü bulunmuyor; sağlayıcının varsayılanı kullanılır.</p>}
        {route && <p>Seçilen: {brainLabel(route)}{!route.reasoning && " · düşünme: Varsayılan"}</p>}
        {catalogError && <div><p className="research-error" role="alert">{catalogError} Mevcut seçim korunuyor.</p><button type="button" disabled={loadingCatalog || busy} onClick={() => void loadCatalog()}>Model listesini yeniden dene</button></div>}
        {defaultsError && <div><p className="research-error" role="alert">{defaultsError}</p><button type="button" disabled={loadingDefaults || busy} onClick={() => void loadDefaults()}>Etkin modeli yeniden al</button></div>}
      </fieldset>
      <label>Sonuç klasörü<div className="research-directory"><input required readOnly={window.iris.transport === "mobile"} value={directory} onChange={(event) => setDirectory(event.target.value)} />{window.iris.transport !== "mobile" && <button type="button" onClick={() => void window.iris.chooseResearchDirectory().then((value) => { if (value) setDirectory(value); }).catch((error) => setError(String(error)))}>Seç</button>}</div></label>
      </details>
      {scheduled && <fieldset><legend>Zamanlama · Europe/Istanbul</legend><div className="research-fields">
        <label>Tekrar<select aria-label="Tekrar" value={schedule.kind} onChange={(event) => setSchedule({ ...schedule, kind: event.target.value as ResearchSchedule["kind"] })}><option value="daily">Her gün</option><option value="weekly">Haftalık</option><option value="once">Tek sefer</option></select></label>
        <label>Saat<input required type="time" value={schedule.time} onChange={(event) => setSchedule({ ...schedule, time: event.target.value })} /></label>
        {schedule.kind === "weekly" && <label>Gün<select aria-label="Gün" value={schedule.day} onChange={(event) => setSchedule({ ...schedule, day: Number(event.target.value) })}>{["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"].map((day, i) => <option value={i} key={day}>{day}</option>)}</select></label>}
        {schedule.kind === "once" && <label>Tarih<input required type="date" value={schedule.date} onChange={(event) => setSchedule({ ...schedule, date: event.target.value })} /></label>}
      </div><p>Yalnızca yeni/güncellenen bulgu veya hata olduğunda bildirilir. Bilgisayar ve Hermes zamanlayıcısı açık olmalıdır.</p></fieldset>}

      <p className="research-help">Süre üst sınırdır. Önemli eksikler ve erişilemeyen kaynaklar raporda belirtilir. Çalışma başlangıcındaki model görev boyunca korunur.</p>
      {job?.modelLabel && <p className="research-help">Kaydedilmiş model: {job.modelLabel}</p>}
      {error && <p className="research-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Vazgeç</button><button className="primary" disabled={busy || loadingDefaults || !route || !topic.trim() || !directory}>{busy ? "Hazırlanıyor…" : job ? "Değişiklikleri kaydet" : "Öneriyi göster"}</button></footer>
    </form>
  </div>, document.body);
}

export default function ResearchTools({ children, onOpenTask, initialPlanning = false }: { children: ReactNode; onOpenTask: (task: TaskCard) => void; initialPlanning?: boolean }) {
  const [tab, setTab] = useState<"tasks" | "schedules">(initialPlanning ? "schedules" : "tasks");
  const [reminderForm, setReminderForm] = useState<{ item?: ReminderItem; draft?: Partial<ReminderInput> } | null>(null);
  const [filter, setFilter] = useState("all");
  const [focusedId, setFocusedId] = useState<string | undefined>(new URLSearchParams(location.search).get("reminder") || undefined);
  const [form, setForm] = useState<{ scheduled: boolean; job?: ResearchScheduledJob } | null>(null);
  const [snapshot, setSnapshot] = useState<ResearchScheduleSnapshot>({ jobs: [], scheduler: { available: false } });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(""); const [limit, setLimit] = useState(30);
  const [notice, setNotice] = useState("");
  const [removeId, setRemoveId] = useState("");
  async function refresh() {
    try { const next = await window.iris.listResearchSchedules(); if (Array.isArray(next?.jobs)) setSnapshot(next); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  useEffect(() => {
    const planning = () => setTab("schedules"); window.addEventListener("avalon:planning", planning);
    const off = window.iris?.onSidecarEvent((event) => {
      if (event.type === "reminder_draft") { setReminderForm({ draft: event.draft as Partial<ReminderInput> }); setTab("schedules"); }
      if (event.type === "open_planning" || event.type === "reminder_notice") { setTab("schedules"); setFilter("all"); setFocusedId(event.reminderId as string | undefined); if (event.type === "reminder_notice") setNotice(event.summary ? `${event.count} kaçırılan hatırlatman var.` : "Hatırlatma zamanı geldi."); }
      if (event.type === "research_schedules" && Array.isArray(event.jobs)) setSnapshot(event as unknown as ResearchScheduleSnapshot);
      if (event.type === "research_notice") setNotice(String(event.text || ""));
    });
    return () => { off?.(); window.removeEventListener("avalon:planning", planning); };
  }, []);
  useEffect(() => { if (tab !== "schedules") return; void refresh(); const timer = setInterval(() => void refresh(), 30000); return () => clearInterval(timer); }, [tab]);
  async function action(id: string, operation: "pause" | "resume" | "remove" | "run") {
    setBusy(id); setError("");
    try { await window.iris.researchScheduleAction(id, operation); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  }
  return <div className="research-workspace" data-view={tab}>
    <div className="research-tabs" role="tablist" aria-label="Görev görünümü">
      <button role="tab" aria-selected={tab === "tasks"} onClick={() => setTab("tasks")}>Çalışmalar</button>
      <button role="tab" aria-selected={tab === "schedules"} onClick={() => setTab("schedules")}>Planlama</button>
    </div>
    <div className="research-actions">{tab === "tasks" ? <button onClick={() => setForm({ scheduled: false })}>＋ Yeni araştırma</button> : <><select aria-label="Planlama türü" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Tümü</option><option value="reminders">Hatırlatmalar</option><option value="research">Araştırmalar</option></select><details className="new-menu"><summary>＋ Yeni</summary><div><button onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setReminderForm({}); }}>Hatırlatıcı</button><button onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setForm({ scheduled: true }); }}>Zamanlanmış araştırma</button></div></details></>}</div>
    {notice && <div className="research-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Bildirimi kapat">×</button></div>}
    {tab === "tasks" ? children : <div className="research-schedules" role="tabpanel">
      {filter !== "research" && <RemindersPanel onEdit={(item) => setReminderForm({ item })} focusedId={focusedId} />}
      {filter !== "reminders" && <div className="planned-research"><h3>Zamanlanmış araştırmalar</h3>
      <p className={snapshot.scheduler.available ? "research-help" : "research-error"}>{snapshot.scheduler.available ? "Hermes zamanlayıcısı bağlı · Europe/Istanbul" : snapshot.scheduler.error || "Zamanlayıcı kontrol ediliyor…"}</p>
      {error && <p className="research-error" role="alert">{error}</p>}
      {!snapshot.jobs.length && <p className="research-help">Henüz zamanlanmış araştırma yok. “Zamanla” ile oluşturabilirsin.</p>}
      {snapshot.jobs.slice(0, limit).map((job) => <article className="scheduled-card" key={job.id}>
        <header><strong>{job.name}</strong><span>{job.paused ? "Duraklatıldı" : "Etkin"}</span></header>
        <p>{job.label}</p><p>Sonraki: {dateLabel(job.nextRunAt)}</p>
        {job.modelLabel && <p>Model: {job.modelLabel}</p>}
        <p>Son çalışma: {job.lastRun ? `${new Date(job.lastRun.updatedAt).toLocaleString("tr-TR")} · ${job.lastRun.status}` : "Henüz çalışmadı"}</p>
        {job.lastRun && <p>Yeni: {job.lastRun.newCount || 0} · Güncellenen: {job.lastRun.changedCount || 0}</p>}
        {job.lastRun && isActive(job.lastRun) && <p>{job.lastRun.lastActivity} · {job.lastRun.sourceCount || 0} okunmuş kaynak</p>}
        {job.error && <p className="research-error">{job.error}</p>}
        {job.lastSkip && <small>Son başlatma atlandı: {job.lastSkip.reason === "already_running" ? "önceki çalışma sürüyor" : "bu tekrar zaten işlendi"}</small>}
        <div className="scheduled-actions">
          <button disabled={busy === job.id || job.paused || Boolean(job.lastRun && isActive(job.lastRun)) || !snapshot.scheduler.available} onClick={() => void action(job.id, "run")}>Şimdi çalıştır</button>
          <details><summary>Diğer işlemler</summary><div className="scheduled-actions"><button disabled={busy === job.id} onClick={() => setForm({ scheduled: true, job })}>Düzenle</button>
          <button disabled={busy === job.id} onClick={() => void action(job.id, job.paused ? "resume" : "pause")}>{job.paused ? "Devam et" : "Duraklat"}</button>
          <button disabled={busy === job.id} onClick={() => { if (removeId === job.id) { void action(job.id, "remove"); setRemoveId(""); } else setRemoveId(job.id); }}>{removeId === job.id ? "Kaldırmayı onayla" : "Kaldır"}</button>
          {removeId === job.id && <button onClick={() => setRemoveId("")}>Vazgeç</button>}
          </div></details>
          {job.lastRun && isActive(job.lastRun) && <button onClick={() => void window.iris.stopTask(job.lastRun!.id).catch((error) => setError(String(error)))}>Araştırmayı durdur</button>}
          {job.lastRun?.output && <button onClick={() => onOpenTask(job.lastRun!)}>Son sonucu aç</button>}
        </div>
        <details><summary>Çalışma geçmişi ({job.history.length})</summary>{job.history.map((run) => <button className="scheduled-history" disabled={!run.output} key={run.id} onClick={() => onOpenTask(run)}>{new Date(run.updatedAt).toLocaleString("tr-TR")} · {run.status} · Yeni: {run.newCount || 0}</button>)}</details>
      </article>)}
      {snapshot.jobs.length > limit && <button onClick={() => setLimit((value) => value + 30)}>Daha fazla göster</button>}
      </div>}
    </div>}
    {reminderForm && <ReminderForm {...reminderForm} onClose={() => setReminderForm(null)} />}
    {form && <ResearchForm scheduled={form.scheduled} job={form.job} onClose={() => setForm(null)} onSaved={() => { if (form.job) void refresh(); }} />}
  </div>;
}
