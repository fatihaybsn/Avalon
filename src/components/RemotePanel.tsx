import { useEffect, useState } from "react";

export default function RemotePanel({ mobile = false, enablePush }: { mobile?: boolean; enablePush?: (progress: (message: string) => void) => Promise<void> }) {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [origin, setOrigin] = useState(""); const [port, setPort] = useState(8765);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = () => window.iris.remoteStatus().then((value) => { if (!disposed) setStatus(value); });
    void refresh().catch(() => {});
    window.iris.remoteStatus().then((value) => { if (!disposed) { setOrigin(value.origin); setPort(value.port); } }).catch(() => {});
    const timer = window.setInterval(() => void refresh().catch(() => {}), 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  async function run(operation: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await operation(); setStatus(await window.iris.remoteStatus()); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="setup-section remote-panel">
    <h3>Telefon bağlantısı</h3>
    {!mobile && <>
      <label className="setup-field"><span>Tailscale HTTPS adresi</span><input type="url" value={origin} placeholder="https://bilgisayar.ag.ts.net" onChange={(e) => setOrigin(e.target.value)} /></label>
      <label className="setup-field"><span>Yerel port</span><input type="number" min="1024" max="65535" value={port} onChange={(e) => setPort(Number(e.target.value))} /></label>
      <div className="setup-actions">
        <button className="setup-btn" disabled={busy} onClick={() => void run(() => window.iris.configureRemote({ enabled: true, origin, port }))}>Erişimi aç / uygula</button>
        <button className="setup-btn" disabled={busy} onClick={() => void run(() => window.iris.configureRemote({ enabled: false, origin, port }))}>Erişimi kapat</button>
      </div>
      {status?.running && <p><a href={status.origin} onClick={(e) => { e.preventDefault(); void window.iris.openExternal(status.origin); }}>{status.origin}</a></p>}
      <div className="setup-actions">
        <button className="setup-btn" disabled={busy || !status?.running} onClick={() => void run(async () => { setCode(await window.iris.remotePairCode()); })}>Eşleştirme kodu oluştur</button>
        <button className="setup-btn" disabled={busy || !status?.paired} onClick={() => void run(async () => { await window.iris.revokeRemote(); setCode(null); })}>Telefon erişimini kaldır</button>
        <button className="setup-btn" disabled={busy} onClick={() => void run(() => window.iris.claimDesktopVoice())}>Sesi bilgisayara al</button>
      </div>
      {code && <p role="status">Kod: <strong>{code.code}</strong> · Son kullanım: {new Date(code.expiresAt).toLocaleTimeString()}</p>}
    </>}
    <p className="setup-note">{status?.running ? "Uzaktan erişim hazır" : "Uzaktan erişim kapalı"} · {status?.paired ? status.deviceName : "Telefon eşleşmemiş"} · {status?.pushReady ? "Telefonun bildirim kaydı hazır" : "Telefonun bildirim kaydı tamamlanmamış"}</p>
    {mobile && enablePush && <>
      <p className="setup-note">Tarayıcı izni: {typeof Notification !== "undefined" && Notification.permission === "granted" ? "açık" : "izin gerekli"}. Bildirim almak için telefonun ayrıca Avalon’a kaydedilmesi gerekir.</p>
      <button className="setup-btn" disabled={busy} onClick={() => void run(() => enablePush(setMessage))}>{busy ? "İşlem sürüyor…" : status?.pushReady ? "Bildirim kaydını yenile" : "Bildirimleri etkinleştir"}</button>
    </>}
    <label className="setup-field"><span>Telefona bildirim gönder</span><input aria-label="Telefona bildirim gönder" type="checkbox" checked={status?.notifications || false} disabled={busy || (!status?.pushReady && !status?.notifications)} onChange={(e) => void run(() => window.iris.setNotifications(e.target.checked))} /></label>
    <button className="setup-btn" disabled={busy || !status?.pushReady} onClick={() => void run(async () => { await window.iris.testNotification(); setMessage("Test bildirimi sıraya alındı."); })}>Test bildirimi gönder</button>
    {!status?.pushReady && <p className="setup-note">Test düğmesi, telefondaki bildirim kaydı tamamlandığında açılır.</p>}
    <p className="setup-note">Bildirim modu ses cihazını veya görev izinlerini değiştirmez.</p>
    {message || status?.error || status?.pushError ? <p role="status">{message || status?.error || status?.pushError}</p> : null}
  </section>;
}
