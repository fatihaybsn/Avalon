import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Power } from "lucide-react";

export default function MessageComposer({ sessionId, voice, onVoice, muted, onMute }: { sessionId: string | null; voice: boolean; onVoice: () => void; muted?: boolean; onMute?: () => void }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const retry = useRef<{ id: string; text: string; sessionId: string } | null>(null);
  const lastId = useRef("");
  const [status, setStatus] = useState<MessageStatus | null>(null);
  useEffect(() => window.iris.onSidecarEvent((event) => {
    if (event.type === "message_status" && event.id === lastId.current && event.session_id === sessionId) setStatus(event.state as MessageStatus);
  }), [sessionId]);
  async function send() {
    if (!text.trim() || !sessionId || busy) return;
    const message = retry.current?.text === text && retry.current.sessionId === sessionId ? retry.current : { id: crypto.randomUUID(), text, sessionId };
    retry.current = message; lastId.current = message.id; setStatus("sending"); setBusy(true); setError("");
    try { await window.iris.sendMessage(message); retry.current = null; setText(""); setStatus((current) => current === "sending" ? "waiting" : current); }
    catch (e) { setStatus("failed"); setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="composer hud-hit">
    <div className="composer-voice" role="group" aria-label="Ses kontrolleri">
      {voice && onMute && <button className={`t-btn small ${muted ? "muted" : "primary"}`} type="button" title={muted ? "Mikrofonu aç" : "Mikrofonu sustur"} aria-label={muted ? "Mikrofonu aç" : "Mikrofonu sustur"} aria-pressed={!!muted} onClick={onMute}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</button>}
      <button className={`t-btn small ${voice ? "danger" : "muted"}`} type="button" title={voice ? "Sesli konuşmayı kapat" : "Sesli konuşmayı aç"} aria-label={voice ? "Sesli konuşmayı kapat" : "Sesli konuşmayı aç"} aria-pressed={voice} onClick={onVoice}><Power size={18} /></button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <textarea aria-label="Mesaj" placeholder="Mesajını yaz…" rows={2} value={text} maxLength={20000} disabled={busy} onChange={(event) => { setText(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${Math.min(112, event.target.scrollHeight)}px`; }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} />
      <button disabled={busy || !sessionId || !text.trim()}>{busy ? "Gönderiliyor…" : "Gönder"}</button>
    </form>{status === "waiting" && <p className="workspace-help" role="status">Yanıt hazırlanıyor…</p>}{error && <p role="alert" className="workspace-error">{error}</p>}
  </div>;
}
