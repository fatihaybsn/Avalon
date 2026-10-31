import { useEffect, useState } from "react";

export default function PermissionModePanel({ config, onSaved, compact = false }: { config: IrisConfig; onSaved?: (config: IrisConfig) => void; compact?: boolean }) {
  const [mode, setMode] = useState(config.permissionMode || "standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setMode(config.permissionMode || "standard"); }, [config.permissionMode]);

  async function select(next: "standard" | "full") {
    setBusy(true);
    setError("");
    try {
      const updated = await window.iris.saveConfig({ IRIS_PERMISSION_MODE: next });
      setMode(updated.permissionMode);
      onSaved?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (compact) return <span>
    <button className="brain-model-chip" type="button" disabled={busy} aria-label="Tam erişim" aria-pressed={mode === "full"} title={mode === "full" ? "Standart izinlere dön" : "Görevlerde tam erişimi aç"} onClick={() => void select(mode === "full" ? "standard" : "full")}>
      {busy ? "Uygulanıyor…" : mode === "full" ? "Tam erişim" : "Standart izinler"}
    </button>
    {error && <span role="alert">{error}</span>}
  </span>;

  return <section className="setup-section" aria-label="Görev izinleri">
    <h3>Görev izinleri</h3>
    <p>Standart mod gerekli adımlarda onay ister. Tam erişim verdiğiniz görevlerde işlem onaylarını otomatik verir. Parola ve eksik bilgi soruları devam eder.</p>
    <div className="setup-inline" role="group" aria-label="İzin modu">
      {([["standard", "Standart"], ["full", "Tam erişim"]] as const).map(([value, label]) =>
        <button key={value} type="button" className={`setup-btn ${mode === value ? "primary" : "ghost"}`} aria-pressed={mode === value} disabled={busy} onClick={() => void select(value)}>{label}</button>)}
    </div>
    <p role="status">{busy ? "İzin modu uygulanıyor…" : `${mode === "full" ? "Tam erişim" : "Standart"} etkin · Seçim hemen kaydedilir ve yeni görevlerde de geçerlidir.`}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
