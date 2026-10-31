import { Hand, Maximize2, Minimize2, PictureInPicture2, Radio, Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

function StatusDot({ tone, state, label }: { tone: string; state: string; label: string }) {
  return (
    <span className={`status-dot ${tone} ${state}`}>
      <i />
      {label}
    </span>
  );
}

export default function TopBar({
  geminiDot,
  hermesDot,
  audioDot,
  linked,
  pid,
  handControl,
  onToggleHand,
  onOpenSettings,
  brainStatus,
  permissionControl,
  languageControl,
}: {
  geminiDot: string;
  hermesDot: string;
  audioDot: string;
  linked: boolean;
  pid: number | null;
  handControl: boolean;
  onToggleHand: () => void;
  onOpenSettings: () => void;
  brainStatus?: string;
  permissionControl?: ReactNode;
  languageControl?: ReactNode;
}) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let active = true;
    void window.iris?.getWindowState?.().then((state) => { if (active) setMaximized(Boolean(state.maximized)); }).catch(() => {});
    const off = window.iris?.onWindowState?.((state) => setMaximized(state.maximized));
    return () => { active = false; off?.(); };
  }, []);
  return (
    <header className="deck-top">
      <div className="deck-top-left">
        {/* The real macOS traffic lights render here (titleBarStyle:
            hiddenInset) — padding in .deck-top-left clears their footprint. */}
        <div className="deck-status">
          <StatusDot tone="gemini" state={geminiDot} label="Gemini" />
          <StatusDot tone="hermes" state={hermesDot} label="Hermes" />
          <StatusDot tone="audio" state={audioDot} label="Audio" />
          {brainStatus ? <button className="brain-model-chip" title={brainStatus} onClick={onOpenSettings}>{brainStatus}</button> : null}
          {permissionControl}
        </div>
      </div>
      <div className="deck-brand">
        <span className="brand-mark">A.V.A.L.O.N</span>
      </div>
      <div className="deck-top-right">
        {languageControl}
        <button className="theme-toggle" title={maximized ? "Pencereyi geri getir" : "Pencereyi büyüt"}
          onClick={() => void window.iris.toggleMaximize().then((state) => setMaximized(state.maximized))}>
          {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          className="theme-toggle"
          onClick={() => window.iris?.toggleHud()}
          title="Glass HUD — float Avalon over your screen (⌥H)"
        >
          <PictureInPicture2 size={15} />
        </button>
        <button className="theme-toggle" onClick={onOpenSettings} title="Settings">
          <Settings size={15} />
        </button>
        <button
          className={`theme-toggle ${handControl ? "active" : ""}`}
          onClick={onToggleHand}
          title={handControl ? "Disable hand control" : "Enable hand control (camera)"}
        >
          <Hand size={15} />
        </button>
        <span
          className={`link-indicator ${linked ? "on" : "off"}`}
          title={linked ? `Linked${pid ? ` · ${pid}` : ""}` : "Offline"}
        >
          <Radio size={15} />
        </span>
      </div>
    </header>
  );
}
