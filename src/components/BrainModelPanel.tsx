import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export function brainLabel(route: BrainSelection | null | undefined): string {
  if (!route) return "Henüz etkin oturum yok";
  const level = route.reasoning === "disabled" ? "kapalı" : route.reasoning === "enabled" ? "açık" : route.reasoning;
  return `${route.provider === "evren" ? "Evren" : "OpenCode Free"} / ${route.modelId}${level ? ` · düşünme: ${level}` : ""}`;
}

export default function BrainModelPanel({ initial }: { initial: BrainModelStatus }) {
  const [status, setStatus] = useState(initial);
  const [selection, setSelection] = useState(initial.selected);
  const [catalog, setCatalog] = useState<BrainCatalog | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<BrainTestReport | null>(null);
  useEffect(() => {
    let disposed = false;
    window.iris.brainCatalog().then((value) => { if (!disposed) setCatalog(value); }).catch((e) => { if (!disposed) setError(String(e.message)); });
    const timer = window.setInterval(() => {
      window.iris.brainStatus().then((value) => { if (!disposed) setStatus(value); }).catch(() => {});
    }, 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  const models = catalog?.models || [];
  const selectedModel = models.find((model) => model.provider === selection.provider && model.modelId === selection.modelId);
  const reasoning = selection.reasoning || "default";
  const options = selectedModel?.reasoningOptions || [];
  const wire = options.find((option) => option.value === reasoning)?.wire;
  const candidateReport = report || selectedModel?.report;
  const lastReport = candidateReport && (candidateReport.reasoning || "default") === reasoning ? candidateReport : null;
  const kindLabels: Record<string, string> = { quota: "Kota", credentials: "Anahtar", access: "Erişim reddedildi", model: "Model bulunamadı", network: "Bağlantı", service: "Sağlayıcı hatası", timeout: "Zaman aşımı", protocol: "Araç/yanıt biçimi", runtime: "Hermes ortamı" };
  async function run(action: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(action); setError("");
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  return (
    <section className="setup-section brain-model-panel">
      <h3>Beyin</h3>
      <p className="setup-note">Seçim tüm Avalon sohbetleri ve yeni görevler için geçerlidir. Çalışan işler başladıkları modelle tamamlanır.</p>
      <label className="setup-field"><span>Sağlayıcı / Model</span>
        <select aria-label="Beyin sağlayıcısı ve modeli" value={`${selection.provider}/${selection.modelId}`} disabled={!catalog || Boolean(busy)} onChange={(event) => {
          const model = models.find((item) => `${item.provider}/${item.modelId}` === event.target.value);
          if (model) {
            const saved = status.preferences?.[`${model.provider}/${model.modelId}`] || "default";
            setSelection({ provider: model.provider, modelId: model.modelId, ...(saved !== "default" ? { reasoning: saved } : {}) }); setReport(null);
          }
        }}>
          {!catalog ? <option value={`${selection.provider}/${selection.modelId}`}>{brainLabel(selection)}</option> : (["evren", "opencode"] as const).map((provider) => (
            <optgroup key={provider} label={provider === "evren" ? "Evren" : "OpenCode Free"}>
              {models.filter((model) => model.provider === provider).map((model) => <option key={`${provider}/${model.modelId}`} value={`${provider}/${model.modelId}`}>{model.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="setup-field"><span>Düşünme seviyesi</span>
        <select aria-label="Beyin düşünme seviyesi" value={reasoning} disabled={!catalog || Boolean(busy) || options.length <= 1} onChange={(event) => {
          setSelection({ ...selection, reasoning: event.target.value }); setReport(null);
        }}>
          {options.length ? options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : <option value={reasoning}>Varsayılan</option>}
        </select>
        <small className="setup-note">{options.length <= 1 ? "Bu model için doğrulanmış bir düşünme kontrolü bulunmuyor; sağlayıcının varsayılanı kullanılır."
          : reasoning === "default" ? "Mevcut davranış korunur; ek düşünme parametresi gönderilmez. Her modelin ayarı ayrı kaydedilir."
          : `Gönderilen ayar: ${wire?.thinking === false ? "düşünme kapalı" : wire?.reasoning_effort ? `seviye ${wire.reasoning_effort}` : "düşünme açık"}. Uygula ile güvenli noktada geçilir.`}</small>
      </label>
      {options.length > 1 ? <small className="setup-note">Yüksek seviyeler yanıtın başlamasını geciktirebilir. Seçenekler sağlayıcının bildirdiği kontrollerle sınırlıdır; gerçek davranışı model belirler.</small> : null}
      <small className="setup-note">API kimliği: <code>{selection.modelId}</code> · {selectedModel?.listed === true ? "Katalogda listeleniyor" : selectedModel?.listed === false ? "Son katalogda görünmüyor; elle denenebilir" : "Katalog henüz yenilenmedi"}</small>
      {selectedModel?.catalogError ? <p className="setup-note">{selectedModel.catalogError}</p> : null}
      {selection.provider === "opencode" ? <label className="setup-field"><span>OpenCode Console API anahtarı</span>
        <input type="password" autoComplete="off" value={apiKey} placeholder={catalog?.configured.opencode ? "Kayıtlı — boş bırakırsan korunur" : "API anahtarını gir"} onChange={(event) => setApiKey(event.target.value)} />
        <small className="setup-note">Anahtar Uygula ile kaydedilir. Bağlantıyı denemek model seçimini değiştirmez.</small>
      </label> : null}
      <div className="setup-actions">
        <button className="setup-btn" disabled={Boolean(busy)} onClick={() => void run("test", async () => { setReport(await window.iris.testBrain({ ...selection, ...(selection.provider === "opencode" ? { apiKey: apiKey.trim() } : {}) })); })}>{busy === "test" ? <Loader2 size={14} className="spin" /> : null}Bağlantıyı dene</button>
        <button className="setup-btn" disabled={Boolean(busy)} onClick={() => void run("refresh", async () => { setCatalog(await window.iris.brainCatalog({ refresh: true, apiKey: apiKey.trim() })); })}>Listeyi yenile</button>
        <button className="setup-btn primary" disabled={Boolean(busy) || status.applying} onClick={() => void run("apply", async () => {
          setStatus(await window.iris.selectBrain({ ...selection, ...(selection.provider === "opencode" ? { apiKey: apiKey.trim() } : {}) }));
          setApiKey(""); setCatalog(await window.iris.brainCatalog());
        })}>Uygula</button>
      </div>
      <p className="setup-note" aria-live="polite">Etkin: {brainLabel(status.effective)}{status.pending ? ` · ${brainLabel(status.selected)} için ${status.applying ? "geçiş yapılıyor" : "güvenli geçiş bekleniyor"}` : ""}</p>
      {lastReport ? <p className={`setup-note ${lastReport.ok ? "" : "brain-model-error"}`} aria-live="polite">{lastReport.ok ? lastReport.message : `${kindLabels[lastReport.kind || ""] || "Hata"}: ${lastReport.error}`}{lastReport.retryAt ? ` · Yeniden deneme: ${new Date(lastReport.retryAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}` : ""}</p> : <p className="setup-note">Bu model için kayıtlı canlı deneme sonucu yok.</p>}
      {error || status.error ? <p className="brain-model-error" role="alert">{error || status.error}</p> : null}
      {status.confirmation ? <div className="brain-model-warning"><p>{status.confirmation.message}</p><button className="setup-btn" disabled={Boolean(busy)} onClick={() => void run("confirm", async () => { setStatus(await window.iris.confirmBrain()); })}>Uyarıyı kabul et ve modeli değiştir</button></div> : null}
    </section>
  );
}
