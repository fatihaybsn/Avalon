import { useEffect, useState } from "react";
import { CalendarClock, FileText, Play, Workflow } from "lucide-react";
import type { TaskCard } from "../types";

const days = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const statusLabel: Record<string, string> = {
  waiting: "Bekliyor", starting: "Başlıyor", running: "Çalışıyor", completed: "Tamamlandı",
  partial: "Kısmi sonuç", failed: "Başarısız", interrupted: "Kesildi", cancelled: "Durduruldu",
};
const dateLabel = (value: number | string) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const defaultSchedule = (): ResearchSchedule => ({
  kind: "weekly", day: 1, time: "11:30", timezone: "Europe/Istanbul",
  date: new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }),
});

function ScheduleFields({ value, onChange }: { value: ResearchSchedule; onChange: (value: ResearchSchedule) => void }) {
  return <div className="automation-fields">
    <label>Tekrar<select value={value.kind} onChange={(event) => onChange({ ...value, kind: event.target.value as ResearchSchedule["kind"] })}>
      <option value="weekly">Haftalık</option><option value="daily">Her gün</option><option value="once">Tek sefer</option>
    </select></label>
    {value.kind === "weekly" && <label>Gün<select value={value.day} onChange={(event) => onChange({ ...value, day: Number(event.target.value) })}>
      {days.map((day, index) => <option key={day} value={index}>{day}</option>)}
    </select></label>}
    {value.kind === "once" && <label>Tarih<input required type="date" value={value.date || ""} onChange={(event) => onChange({ ...value, date: event.target.value })} /></label>}
    <label>Saat (İstanbul)<input required type="time" value={value.time} onChange={(event) => onChange({ ...value, time: event.target.value })} /></label>
  </div>;
}

export default function AutomationPanel({ onOpenTask, schedulerAvailable, mobile = false }: {
  onOpenTask: (task: TaskCard) => void; schedulerAvailable: boolean; mobile?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<AutomationSnapshot | null>(null);
  const [draft, setDraft] = useState<{ id: string; schedule: ResearchSchedule } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState("");
  const [confirmCancel, setConfirmCancel] = useState("");
  async function refresh() {
    const value = await window.iris.listAutomations?.();
    if (value) setSnapshot(value);
  }
  function showError(value: unknown) { setError(value instanceof Error ? value.message : String(value)); }
  useEffect(() => {
    void refresh().catch(showError);
    const timer = window.setInterval(() => void refresh().catch(showError), 2500);
    return () => window.clearInterval(timer);
  }, []);
  async function run(label: string, operation: () => Promise<unknown> | undefined) {
    setBusy(label); setError("");
    try { await operation(); await refresh(); }
    catch (error) { showError(error); }
    finally { setBusy(""); }
  }
  return <section className="planned-research automation-panel" aria-label="Otomasyonlar">
    <div className="automation-toolbar">
      <h3>Otomasyonlar</h3>
      {!mobile && snapshot?.installed && <button type="button" className="automation-button" disabled={Boolean(busy)}
        onClick={() => void run("editor", () => window.iris.openAutomationEditor?.())}>
        <Workflow size={15} aria-hidden="true" /> Akışı düzenle
      </button>}
    </div>
    {error && <p className="research-error" role="alert">{error}</p>}
    {!snapshot && <p className="research-help">Otomasyonlar yükleniyor…</p>}
    {!mobile && snapshot && !snapshot.supported && <p className="research-help">Otomasyon kurulumu Windows x64 gerektirir.</p>}
    {!mobile && snapshot?.supported && !snapshot.installed && <>
      <p className="research-help">Node-RED bir kez bu bilgisayara kurulur ve gerektiğinde Avalon tarafından açılır.</p>
      <button type="button" className="automation-button primary" disabled={Boolean(busy)} onClick={() => void run("install", () => window.iris.installAutomation?.())}>{busy === "install" ? "Kuruluyor…" : "Kur"}</button>
    </>}
    {snapshot && (mobile || snapshot.installed) && <>
      {!schedulerAvailable && <p className="research-help">Zamanlama için Hermes zamanlayıcısı çalışmalıdır.</p>}
      {!snapshot.flows.length && <p className="research-help">{mobile ? "Zamanlanmış otomasyon yok. Bilgisayarda zamanladığınız kartlar burada görünür." : "Node-RED’de bir Avalon akışı oluşturup yayımlayın."}</p>}
      {snapshot.flows.map((flow) => {
        const schedule = flow.schedule;
        const last = flow.history[0];
        const editing = draft?.id === flow.id;
        return <article className="scheduled-card automation-card" key={flow.id}>
          <header className="automation-card-header"><strong>{flow.name}</strong>
            <span className="automation-status" data-status={schedule ? schedule.paused ? "partial" : "enabled" : "waiting"}>{schedule ? schedule.paused ? "Duraklatıldı" : "Etkin" : "Zamanlanmadı"}</span>
          </header>
          {flow.error && <p className="research-error">{flow.error}</p>}
          {schedule?.error && <p className="research-error">{schedule.error}</p>}
          {schedule?.lastSkip && <p className="research-help">{schedule.lastSkip.reason === "already_running" ? "Önceki tur hâlâ çalışıyor." : "Bu tetikleme daha önce işlendi."}</p>}
          {schedule && <p>{schedule.spec.kind === "weekly" ? days[schedule.spec.day] : schedule.spec.kind === "daily" ? "Her gün" : schedule.spec.date} · {schedule.spec.time} · Sonraki {schedule.nextRunAt ? dateLabel(schedule.nextRunAt) : "—"}</p>}
          {last && <p>Son tur {dateLabel(last.startedAt)} · {statusLabel[last.status] || last.status}</p>}
          {last?.error && <p className="research-error">{last.error}</p>}
          <ol className="automation-steps">{(last?.steps.length ? last.steps : flow.steps?.map((step) => ({ ...step, status: "waiting", task: undefined })))?.map((step, index) =>
            <li key={step.id}>
              <span className="automation-step-index" aria-hidden="true">{index + 1}</span>
              <span className="automation-step-name">{step.name}</span>
              <span className="automation-status" data-status={step.status}>{statusLabel[step.status] || step.status}</span>
              {(step.task?.output || (!mobile && step.task && step.status === "running")) && <div className="automation-step-actions">
                {step.task?.output && <button type="button" className="automation-button compact" onClick={() => onOpenTask(step.task!)}><FileText size={14} aria-hidden="true" /> Raporu aç</button>}
                {!mobile && step.task && step.status === "running" && <button type="button" className="automation-button compact" disabled={Boolean(busy)} onClick={() => void run("stop", () => window.iris.stopTask(step.task!.id))}>Durdur</button>}
              </div>}
            </li>)}</ol>
          {!editing && <div className="automation-actions">
            {!mobile && schedule && <button type="button" className="automation-button primary" disabled={Boolean(busy || flow.error || schedule.paused || last?.status === "running") || !schedulerAvailable}
              onClick={() => void run("run", () => window.iris.researchScheduleAction(schedule.id, "run"))}><Play size={14} aria-hidden="true" /> Şimdi çalıştır</button>}
            {(!mobile || schedule) && <button type="button" className={`automation-button${schedule ? "" : " primary"}`} disabled={Boolean(busy || flow.error) || !schedulerAvailable} onClick={() => setDraft({ id: flow.id, schedule: { ...defaultSchedule(), ...schedule?.spec } })}><CalendarClock size={15} aria-hidden="true" /> {schedule ? "Zamanlamayı düzenle" : "Zamanla"}</button>}
            {schedule && <>
              <details className="automation-details"><summary>Diğer işlemler</summary>
                <div className="automation-actions">
                  <button type="button" className="automation-button" disabled={Boolean(busy) || !schedulerAvailable} onClick={() => void run("pause", () => window.iris.researchScheduleAction(schedule.id, schedule.paused ? "resume" : "pause"))}>{schedule.paused ? "Devam et" : "Duraklat"}</button>
                  {mobile && last?.status === "running" && (confirmCancel === last.id ? <>
                    <button type="button" className="automation-button danger" disabled={Boolean(busy)} onClick={() => void run("cancel", async () => {
                      await window.iris.cancelAutomationRun?.(flow.id, last.id); setConfirmCancel("");
                    })}>Turu iptal etmeyi onayla</button>
                    <button type="button" className="automation-button" onClick={() => setConfirmCancel("")}>Vazgeç</button>
                  </> : <button type="button" className="automation-button danger" disabled={Boolean(busy)} onClick={() => setConfirmCancel(last.id)}>Bu turu iptal et</button>)}
                  {!mobile && (confirmRemove === flow.id ? <>
                    <button type="button" className="automation-button danger" disabled={Boolean(busy) || !schedulerAvailable} onClick={() => void run("remove", async () => { await window.iris.researchScheduleAction(schedule.id, "remove"); setConfirmRemove(""); })}>Kaldırmayı onayla</button>
                    <button type="button" className="automation-button" onClick={() => setConfirmRemove("")}>Vazgeç</button>
                  </> : <button type="button" className="automation-button" disabled={Boolean(busy) || !schedulerAvailable} onClick={() => setConfirmRemove(flow.id)}>Zamanlamayı kaldır</button>)}
                </div>
              </details>
            </>}
          </div>}
          {editing && <form className="automation-schedule-form" onSubmit={(event) => {
            event.preventDefault();
            void run("save", async () => { await window.iris.saveAutomationSchedule?.(flow.id, draft.schedule); setDraft(null); });
          }}>
            <h4><CalendarClock size={15} aria-hidden="true" /> Zamanlama</h4>
            <ScheduleFields value={draft.schedule} onChange={(value) => setDraft({ id: flow.id, schedule: value })} />
            <div className="automation-actions">
              <button type="submit" className="automation-button primary" disabled={Boolean(busy) || !schedulerAvailable}>{busy === "save" ? "Kaydediliyor…" : "Kaydet"}</button>
              <button type="button" className="automation-button" disabled={busy === "save"} onClick={() => setDraft(null)}>Vazgeç</button>
            </div>
          </form>}
          {flow.history.length > 1 && <details className="automation-details"><summary>Önceki turlar</summary>
            {flow.history.slice(1).map((prior) => <div key={prior.id}>
              <p>{dateLabel(prior.startedAt)} · {statusLabel[prior.status] || prior.status}</p>
              <div className="automation-actions">{prior.steps.filter((step) => step.task?.output).map((step) => <button type="button" className="automation-button compact" key={step.id} onClick={() => onOpenTask(step.task!)}>{step.name}</button>)}</div>
            </div>)}
          </details>}
        </article>;
      })}
    </>}
  </section>;
}
