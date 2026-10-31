import { useEffect, useRef, useState } from "react";
import { activateMobileUpdate, readMobileBuild, updateBlockReason, type MobileBuild } from "./updates";

export default function MobileUpdateNotice({ voice, busy }: { voice: boolean; busy: boolean }) {
  const [available, setAvailable] = useState(false), [updating, setUpdating] = useState(false), [error, setError] = useState("");
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined), latest = useRef<MobileBuild | null>(null);
  useEffect(() => {
    let active = true, checking = false, lastCheck = 0;
    const workers = "serviceWorker" in navigator ? navigator.serviceWorker : undefined;
    const hadController = !!workers?.controller;
    const changed = () => { if (active && hadController) setAvailable(true); };
    const check = async (force = false) => {
      if (checking || (!force && Date.now() - lastCheck < 60000)) return;
      checking = true; lastCheck = Date.now();
      try {
        const build = await readMobileBuild();
        if (!active) return;
        latest.current = build;
        if (build && build.buildId !== __APP_BUILD__) setAvailable(true);
        if (registration.current) { await registration.current.update(); if (active && registration.current.waiting) setAvailable(true); }
      } catch { /* Being offline must not hide the existing conversation. */ }
      finally { checking = false; }
    };
    const inspect = () => { const worker = registration.current?.installing; worker?.addEventListener("statechange", () => { if (active && worker.state === "installed" && workers?.controller) setAvailable(true); }); };
    void workers?.register("/sw.js", { updateViaCache: "none" }).then((value) => {
      if (!active) return;
      registration.current = value; value.addEventListener("updatefound", inspect); inspect();
      if (value.waiting) setAvailable(true);
      void check(true);
    }).catch(() => {});
    void check(true);
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    const requested = () => void check(true);
    workers?.addEventListener("controllerchange", changed);
    document.addEventListener("visibilitychange", visible); window.addEventListener("avalon:check-update", requested);
    return () => { active = false; registration.current?.removeEventListener("updatefound", inspect); workers?.removeEventListener("controllerchange", changed); document.removeEventListener("visibilitychange", visible); window.removeEventListener("avalon:check-update", requested); };
  }, []);
  async function apply() {
    const draft = !!document.querySelector<HTMLTextAreaElement>('.composer textarea')?.value.trim();
    const reason = updateBlockReason(voice, busy, draft, !!document.querySelector('[role="dialog"]'));
    if (reason) { setError(reason); return; }
    setUpdating(true); setError("");
    try {
      await activateMobileUpdate(registration.current, "serviceWorker" in navigator ? navigator.serviceWorker : undefined);
      const url = new URL(location.href);
      // Also bypass a legacy worker's cached index during the first upgrade.
      url.searchParams.set("_avalon_build", latest.current?.buildId || __APP_BUILD__);
      location.replace(url.href);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setUpdating(false); }
  }
  return available ? <aside className="mobile-update" role="status"><span>Yeni mobil arayüz hazır.</span><button disabled={updating} onClick={() => void apply()}>{updating ? "Güncelleniyor…" : "Arayüzü güncelle"}</button>{error && <p role="alert">{error}</p>}</aside> : null;
}
