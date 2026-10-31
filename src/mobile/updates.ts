export type MobileBuild = { version: string; buildId: string };

export async function readMobileBuild(fetcher: typeof fetch = fetch): Promise<MobileBuild | null> {
  const response = await fetcher("/version.json", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null; // Older desktop packages do not expose a build stamp.
  const value = await response.json();
  return typeof value?.version === "string" && typeof value?.buildId === "string" ? value : null;
}

export function updateBlockReason(voice: boolean, busy: boolean, draft: boolean, dialog: boolean) {
  if (voice) return "Güncellemeden önce sesli konuşmayı kapat.";
  if (busy) return "Devam eden işlemin bitmesini bekle.";
  if (draft) return "Önce yazdığın mesajı gönder veya temizle.";
  if (dialog) return "Önce açık formu kaydet veya kapat.";
  return "";
}

export async function activateMobileUpdate(registration?: ServiceWorkerRegistration, container?: ServiceWorkerContainer, timeoutMs = 8000) {
  const waiting = registration?.waiting;
  if (!waiting || !container || container.controller === waiting || waiting.state === "activated") return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); container.removeEventListener("controllerchange", changed); resolve(); };
    const changed = () => { if (container.controller === waiting || waiting.state === "activated") finish(); };
    const timer = setTimeout(() => { container.removeEventListener("controllerchange", changed); reject(new Error("Güncelleme henüz etkinleşmedi. Biraz sonra tekrar dene.")); }, timeoutMs);
    container.addEventListener("controllerchange", changed);
    waiting.postMessage({ type: "SKIP_WAITING" });
  });
}
