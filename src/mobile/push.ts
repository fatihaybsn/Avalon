type Request = <T>(path: string, body?: unknown) => Promise<T>;
type PushEnvironment = {
  secure: boolean;
  supported: boolean;
  notification: Pick<typeof Notification, "permission" | "requestPermission">;
  worker: Pick<ServiceWorkerContainer, "register" | "ready">;
};

export async function registerPhonePush(request: Request, progress: (message: string) => void,
  environment?: PushEnvironment, timeoutMs = 20000) {
  if (!environment && !("PushManager" in window && "serviceWorker" in navigator && "Notification" in window)) throw new Error("Bildirim kaydı için Avalon’ın HTTPS adresini Android Chrome’da aç.");
  const env = environment || {
    secure: window.isSecureContext,
    supported: "PushManager" in window && "serviceWorker" in navigator && "Notification" in window,
    notification: Notification, worker: navigator.serviceWorker,
  };
  if (!env.secure || !env.supported) throw new Error("Bildirim kaydı için Avalon’ın HTTPS adresini Android Chrome’da aç.");
  if (env.notification.permission === "denied") throw new Error("Chrome site ayarlarından Avalon bildirimlerine izin ver, ardından tekrar dene.");
  if (env.notification.permission !== "granted") {
    progress("Chrome bildirim iznin bekleniyor…");
    if (await env.notification.requestPermission() !== "granted") throw new Error("Bildirim izni verilmedi. İzin verdiğinde tekrar deneyebilirsin.");
  }
  async function step<T>(message: string, operation: () => Promise<T>): Promise<T> {
    progress(message);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Zaman aşımı"), { name: "TimeoutError" })), timeoutMs);
      })]);
    } catch (error) {
      const code = error instanceof Error ? error.name === "TimeoutError" ? "zaman aşımı" : error.name : "hata";
      // Chrome's native reason distinguishes service/network/storage failures.
      // Only its bounded registration message is displayed; no URLs or tokens.
      const nativeMessage = error instanceof DOMException ? error.message.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[adres]").replace(/[a-z0-9_-]{24,}/gi, "[kimlik]").slice(0, 240)
        : error instanceof Error && /^Registration failed - [a-z0-9 ,_.'()-]{1,100}$/i.test(error.message) ? error.message : "";
      const detail = nativeMessage ? `: ${nativeMessage}` : "";
      const help = message.startsWith("Google") ? "Chrome’un Google bildirim kaydı başarısız oldu; bu, tarayıcı izninden ayrı bir adımdır." : "Bilgisayarda Avalon’ın açık olduğunu ve internet/Tailscale bağlantısını kontrol et.";
      throw new Error(`${message.replace(/…$/, "")} aşaması tamamlanamadı (${code}${detail}). ${help}`);
    } finally { clearTimeout(timer); }
  }
  await step("Telefonun bildirim altyapısı hazırlanıyor…", () => env.worker.register("/sw.js", { updateViaCache: "none" }));
  const registration = await step("Bildirim altyapısının açılması bekleniyor…", () => env.worker.ready);
  const { publicKey } = await step("Avalon bildirim bağlantısı alınıyor…", () => request<{ publicKey: string }>("/api/v1/push/key"));
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), (c) => c.charCodeAt(0));
  let subscription = await step("Telefonun mevcut bildirim kaydı kontrol ediliyor…", () => registration.pushManager.getSubscription());
  if (subscription) {
    const old = new Uint8Array(subscription.options.applicationServerKey || new ArrayBuffer(0));
    if (old.length !== bytes.length || old.some((value, index) => value !== bytes[index])) {
      await step("Telefonun eski bildirim kaydı yenileniyor…", () => subscription!.unsubscribe());
      subscription = null;
    }
  }
  subscription ||= await step("Google bildirim servisine kaydolunuyor…", () => registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }));
  const status = await step("Telefonun bildirim kaydı Avalon’a gönderiliyor…", () => request<{ pushReady: boolean }>("/api/v1/push/subscription", subscription!.toJSON()));
  if (!status.pushReady) throw new Error("Avalon telefonun bildirim kaydını doğrulayamadı. Tekrar dene.");
  progress("Bildirim kaydı hazır. Artık test bildirimi gönderebilirsin.");
}
