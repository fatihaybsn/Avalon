import { useState } from "react";

export default function LanguageToggle({ config, onSaved }: { config: IrisConfig; onSaved: (config: IrisConfig) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const english = config.conversationLanguage === "en";

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      onSaved(await window.iris.saveConfig({ IRIS_CONVERSATION_LANGUAGE: english ? "tr" : "en" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return <span className="language-control">
    <button type="button" className={`brain-model-chip language-toggle${english ? " active" : ""}`} disabled={busy}
      aria-label="English mode" aria-pressed={english}
      title={english ? "English mode · Switch to Turkish. Applies to new replies and tasks." : "İngilizce modunu aç · Yeni yanıtlar ve görevler için uygulanır."}
      onClick={() => void toggle()}>{busy ? "…" : english ? "EN" : "TR"}</button>
    {error && <span role="alert">{error}</span>}
  </span>;
}
