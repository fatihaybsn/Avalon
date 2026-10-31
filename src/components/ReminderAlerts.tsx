import { useEffect, useState } from "react";

export default function ReminderAlerts({ onOpen }: { onOpen: () => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => window.iris.onSidecarEvent((event) => {
    if (event.type === "reminder_notice") setNotice(event.summary ? `${event.count} kaçırılan hatırlatman var.` : "Hatırlatma zamanı geldi.");
  }), []);
  return notice ? <div className="reminder-alert" role="status"><span>{notice}</span><button onClick={() => { onOpen(); setNotice(null); }}>Planlamayı aç</button><button aria-label="Hatırlatma bildirimini kapat" onClick={() => setNotice(null)}>×</button></div> : null;
}
