import ReminderAlerts from "../components/ReminderAlerts";
import MobileUpdateNotice from "./MobileUpdateNotice";
import { useEffect, useRef, useState } from "react";
import { mobileConnection, type MobileState } from "./api";
import { registerPhonePush } from "./push";
import { useAudioPipeline } from "../hooks/useAudioPipeline";
import MessageComposer from "../components/MessageComposer";
import NotesPanel from "../components/NotesPanel";
import ResearchTools from "../components/ResearchTools";
import SearchableContent from "../components/SearchableContent";
import BrainModelPanel from "../components/BrainModelPanel";
import RemotePanel from "../components/RemotePanel";
import PermissionModePanel from "../components/PermissionModePanel";
import SessionSwitcher from "../components/SessionSwitcher";
import WorkCard from "../components/WorkCard";
import HermesInteractionPrompt from "../components/HermesInteractionPrompt";
import LanguageToggle from "../components/LanguageToggle";
import type { TaskCard } from "../types";

export default function MobileApp() {
  const [paired, setPaired] = useState(false), [state, setState] = useState<MobileState | null>(null);
  const [code, setCode] = useState(""), [error, setError] = useState("");
  const [tab, setTab] = useState((new URLSearchParams(location.search).has("task") || new URLSearchParams(location.search).has("planning")) ? "tasks" : "chat"), [focused, setFocused] = useState<string | null>(new URLSearchParams(location.search).get("task"));
  const [speaking, setSpeaking] = useState(false), [connected, setConnected] = useState(false), [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const connection = useRef<ReturnType<typeof mobileConnection> | null>(null);
  if (!connection.current) { connection.current = mobileConnection(() => setPaired(false)); window.iris = connection.current.api; }
  const client = connection.current;
  const audio = useAudioPipeline(true, (level, message) => { if (level === "warn") setError(message); }, "", state?.config.speechRate ?? 1);
  const focusRef = useRef(focused); focusRef.current = focused;
  const stateRef = useRef(state); stateRef.current = state;
  const notice = useRef<Array<{ id: string; runId: string }>>([]);
  const refreshVersion = useRef(0);
  async function refresh() {
    const version = ++refreshVersion.current;
    const next = await client.snapshot();
    if (version === refreshVersion.current) {
      setState((old) => ({ ...next, tasks: next.tasks.map((task) => {
        const previous = old?.tasks.find((item) => item.id === task.id);
        return { ...task, steps: task.steps?.length ? task.steps : previous?.steps,
          ...(previous?.updatedAt === task.updatedAt && previous?.outputTruncated === false ? { output: previous.output, outputTruncated: false } : {}) };
      }) })); setPaired(true);
    }
  }
  async function run(operation: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await operation(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function connectVoice(capture = true, wakeReason: "user" | "notification" = "user") {
    // Called by a user gesture; unlock speaker playback before network awaits.
    await audio.unlockPlayback();
    await window.iris.startSidecar({ wakeReason });
    try {
      if (capture) { await audio.startCapture(); setCapturing(true); }
      setSpeaking(true);
      window.iris.sendUiContext({ sessionId: stateRef.current?.sessionId, tasks: stateRef.current?.tasks.slice(0, 20).map(({ id, task, status }) => ({ id, task, status })) || [], expandedTaskId: focusRef.current, focusedTaskId: focusRef.current, latestResultTaskId: stateRef.current?.tasks[0]?.id || null });
    }
    catch (e) { await window.iris.stopSidecar(); throw e; }
  }
  async function stopVoice() { await audio.stopCapture(); setCapturing(false); audio.flushPlayback(); await window.iris.stopSidecar(); setSpeaking(false); }
  useEffect(() => {
    void refresh().then(() => client.connectEvents()).catch(() => {});
    let timer = 0;
    const off = window.iris.onSidecarEvent((event) => {
      if (["reminder_draft", "open_planning"].includes(event.type)) setTab("tasks");
      if (event.type === "remote_connected") { setConnected(true); void refresh().catch(() => {}); }
      if (event.type === "remote_disconnected") setConnected(false);
      if (event.type === "voice_disconnected" || (event.type === "voice_owner" && event.deviceId !== stateRef.current?.remote.deviceId)) {
        void audio.stopCapture(); setCapturing(false); audio.flushPlayback(); setSpeaking(false);
      }
      if (event.type === "phone_notice") notice.current.push({ id: String(event.id), runId: String(event.runId) });
      if (event.type === "hermes_task_event" && ["tool.started", "tool.completed"].includes(String(event.event))) {
        setState((old) => old ? { ...old, tasks: old.tasks.map((task) => {
          if (task.id !== event.run_id) return task;
          const steps = [...(task.steps || [])];
          if (event.event === "tool.started") steps.push({ id: crypto.randomUUID(), tool: String(event.tool), preview: String(event.preview || ""), status: "running", ts: Date.now() });
          else for (let i = steps.length - 1; i >= 0; i--) if (steps[i].tool === event.tool && steps[i].status === "running") { steps[i] = { ...steps[i], status: event.is_error ? "error" : "done", duration: typeof event.duration === "number" ? event.duration : undefined }; break; }
          return { ...task, steps: steps.slice(-40) };
        }) } : old);
      }
      if (event.type === "transcript") setState((old) => old && (!event.session_id || event.session_id === old.sessionId) ? { ...old, messages: [...old.messages, { id: crypto.randomUUID(), speaker: String(event.speaker), text: String(event.text), sessionId: String(event.session_id) }].slice(-300) } : old);
      if (["hermes_task_update", "hermes_interaction", "hermes_completion", "brain_proposal", "config_changed", "brain_model_status", "remote_status", "phone_notice", "research_update", "research_schedules", "reminders_changed"].includes(event.type)) {
        clearTimeout(timer); timer = window.setTimeout(() => void refresh().catch(() => {}), 200);
      }
    });
    const offSleep = window.iris.onAutoSleep(() => { void audio.stopCapture(); setCapturing(false); audio.flushPlayback(); setSpeaking(false); });
    const offRequestedSleep = window.iris.onSleepRequest(() => { void stopVoice().catch(() => {}); });
    const offUi = window.iris.onUiAction((action) => {
      if (action.action === "open_task" && action.target_id) { setFocused(action.target_id); setTab("tasks"); }
      else if (["open_latest_hermes_result", "open_current_hermes_result"].includes(action.action)) { setFocused(stateRef.current?.tasks[0]?.id || null); setTab("tasks"); }
      else if (action.action === "close_reader" || action.action === "close_all_overlays") setFocused(null);
    });
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh().catch(() => {}); }, 10000);
    const visibility = () => {
      if (document.visibilityState === "hidden") void stopVoice().catch(() => {});
      else void refresh().catch(() => {});
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { off(); offSleep(); offRequestedSleep(); offUi(); clearTimeout(timer); clearInterval(poll); document.removeEventListener("visibilitychange", visibility); client.close(); };
  }, []);
  useEffect(() => {
    window.iris.sendUiContext({ sessionId: state?.sessionId, tasks: state?.tasks.slice(0, 20).map(({ id, task, status }) => ({ id, task, status })) || [], expandedTaskId: focused, focusedTaskId: focused, latestResultTaskId: state?.tasks[0]?.id || null, showHistory: tab === "tasks" });
    const viewed = notice.current.filter((n) => tab === "tasks" && document.visibilityState === "visible" && n.runId === focused && state?.tasks.some((t) => t.id === n.runId));
    client.viewed(viewed.map((n) => n.id)); notice.current = notice.current.filter((n) => !viewed.includes(n));
  }, [state, focused, tab]);
  async function resolve(task: TaskCard, value: string, choice?: "once" | "session" | "always" | "deny") {
    if (task.interaction) await window.iris.respondHermesInteraction({ run_id: task.id, interaction_id: task.interaction.id, interaction_type: task.interaction.type, value, choice });
    else if (choice) await window.iris.approveHermesAction(task.id, choice);
  }
  const task = state?.tasks.find((item) => item.id === focused);
  useEffect(() => {
    if (!task?.outputTruncated) return;
    let disposed = false;
    window.iris.readTaskResult(task.id).then((value) => {
      if (!disposed && value.ok) setState((old) => old ? { ...old, tasks: old.tasks.map((item) => item.id === task.id ? { ...item, output: value.output, outputTruncated: false } : item) } : old);
    }).catch((e) => setError(String(e.message)));
    return () => { disposed = true; };
  }, [task?.id, task?.updatedAt, task?.outputTruncated]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => { const keyboard = !!viewport && window.innerHeight - viewport.height > 140; document.documentElement.classList.toggle("keyboard-open", keyboard); document.documentElement.style.setProperty("--visual-height", `${viewport?.height || window.innerHeight}px`); };
    viewport?.addEventListener("resize", update); update(); return () => { viewport?.removeEventListener("resize", update); document.documentElement.classList.remove("keyboard-open"); };
  }, []);
  return <main className="mobile-app">
    <header className="mobile-head"><strong>AVALON</strong><span>{paired ? connected ? "Bağlı" : "Yeniden bağlanıyor…" : "Telefon eşleştirme"}</span>{paired && <button onClick={() => { window.dispatchEvent(new Event("avalon:check-update")); void run(refresh); }}>Yenile</button>}</header>
    <MobileUpdateNotice voice={speaking} busy={busy} />
    {paired && <ReminderAlerts onOpen={() => { setTab("tasks"); window.dispatchEvent(new Event("avalon:planning")); }} />}
    {error && <p className="mobile-error" role="alert">{error}</p>}
    {!paired ? <section><h1>Bilgisayarındaki Avalon’a bağlan</h1><p>Masaüstü Ayarlar → Telefon bağlantısı bölümünde kod oluştur.</p><form onSubmit={(e) => { e.preventDefault(); void run(async () => { await client.request("/api/v1/pair", { code, name: "Android telefon" }); setCode(""); await refresh(); client.connectEvents(); }); }}><input aria-label="Eşleştirme kodu" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /><button disabled={busy}>Eşleştir</button></form></section> : <>
      <nav className="mobile-nav" aria-label="Ana gezinme">{[["chat", "Sohbet"], ["memory", "Notlar"], ["tasks", "Görevler"], ["settings", "Ayarlar"]].map(([id, label]) => <button key={id} aria-current={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
      <details className="mobile-session-options"><summary>Oturum seçenekleri</summary>
      {state && <PermissionModePanel compact config={state.config} onSaved={(config) => setState((current) => current ? { ...current, config } : current)} />}
      {state && <LanguageToggle config={state.config} onSaved={(config) => setState((current) => current ? { ...current, config } : current)} />}

      {state && <SessionSwitcher current={state.sessionId} onSwitch={(id) => void run(() => window.iris.saveConfig({ IRIS_HERMES_SESSION: id }))} onNew={() => void run(async () => { const value = await window.iris.createHermesSession(); if (value.id) await window.iris.saveConfig({ IRIS_HERMES_SESSION: value.id }); })} />}
      </details>
      {state?.proposal && <section><h2>Görev onayı</h2><p className="prewrap">{state.proposal.task}</p><button disabled={busy} onClick={() => void run(() => window.iris.respondTaskProposal(state.proposal!.id, "once"))}>Onayla</button><button disabled={busy} onClick={() => void run(() => window.iris.respondTaskProposal(state.proposal!.id, "deny"))}>Reddet</button></section>}
      {tab === "chat" && <div className="mobile-chat-workspace"><div className="mobile-chat">{state?.messages.map((m) => <article key={m.id}><small>{m.speaker === "you" ? "Sen" : "Avalon"}</small><p>{m.text}</p></article>)}</div><MessageComposer sessionId={state?.sessionId || null} voice={speaking} onVoice={() => void run(speaking ? stopVoice : () => connectVoice())} muted={audio.muted} onMute={audio.toggleMute} /></div>}
      <section className="mobile-tasks" hidden={tab !== "tasks"}><ResearchTools initialPlanning={new URLSearchParams(location.search).has("planning")} onOpenTask={(value) => { setState((old) => old ? { ...old, tasks: [value, ...old.tasks.filter((x) => x.id !== value.id)] } : old); setFocused(value.id); }}>{task ? <><button onClick={() => setFocused(null)}>← Görevler</button><h2>{task.task}</h2><p>{task.status}</p>{task.interaction && <HermesInteractionPrompt task={task} onResolve={(v, c) => void run(() => resolve(task, v, c))} />}{task.approval && !task.interaction && task.approval.choices.map((c) => <button key={c} disabled={busy} onClick={() => void run(() => resolve(task, "", c))}>{c}</button>)}<div className="markdown-body"><SearchableContent text={task.error || task.output} /></div>{!["completed", "failed", "cancelled", "canceled", "error", "partial", "interrupted", "needs_access"].includes(task.status) && <button disabled={busy} onClick={() => void run(() => window.iris.stopTask(task.id))}>Görevi durdur</button>}</> : state?.tasks.map((t) => <WorkCard key={t.id} task={t} onFocus={() => {}} onOpen={() => setFocused(t.id)} onApprove={(c) => void run(() => window.iris.approveHermesAction(t.id, c))} />)}</ResearchTools></section>
      {tab === "memory" && <NotesPanel key={state?.sessionId} sessionId={state?.sessionId || null} />}
      {tab === "settings" && state && <><RemotePanel mobile enablePush={(progress) => registerPhonePush(client.request, progress)} /><BrainModelPanel initial={state.config.brainModelStatus} /><section><h3>Ortak ayarlar</h3>{[["IRIS_USER_NAME", "Adın", state.config.userName], ["HERMES_API_URL", "Hermes adresi", state.config.hermesUrl], ["HERMES_BIN", "Hermes çalıştırıcısı", state.config.hermesBin], ["HERMES_HOME", "Hermes klasörü", state.config.hermesHome], ["IRIS_BRAIN_PATH", "Not klasörü", state.config.brainPath], ["GEMINI_API_KEY", "Gemini API anahtarı", ""], ["API_SERVER_KEY", "Hermes API anahtarı", ""]].map(([key, label, value]) => <label key={key}>{label}<input type={key.includes("KEY") ? "password" : "text"} autoComplete="off" placeholder={key.includes("KEY") ? "Boş bırakırsan kayıtlı değer korunur" : ""} value={settings[key] ?? value} onChange={(e) => setSettings({ ...settings, [key]: e.target.value })} /></label>)}<label>Gemini modeli<select value={settings.GEMINI_LIVE_MODEL ?? state.config.geminiModel} onChange={(e) => setSettings({ ...settings, GEMINI_LIVE_MODEL: e.target.value })}>{state.config.models.map((m) => <option key={m}>{m}</option>)}</select></label><label>Konuşma hızı<select aria-label="Konuşma hızı" value={settings.IRIS_SPEECH_RATE ?? String(state.config.speechRate ?? 1)} onChange={(e) => setSettings({ ...settings, IRIS_SPEECH_RATE: e.target.value })}>{[1, 1.15, 1.2, 1.3].map((rate) => <option key={rate} value={rate}>{rate === 1 ? "1.0x" : `${rate}x`}</option>)}</select></label><label>Ses<select value={settings.GEMINI_LIVE_VOICE ?? state.config.geminiVoice} onChange={(e) => setSettings({ ...settings, GEMINI_LIVE_VOICE: e.target.value })}>{state.config.voices.map((v) => <option key={v}>{v}</option>)}</select></label><button disabled={busy} onClick={() => void run(async () => { await window.iris.saveConfig(settings); setSettings({}); })}>Ayarları kaydet</button></section></>}
    </>}
  </main>;
}
