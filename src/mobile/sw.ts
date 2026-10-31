/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };
precacheAndRoute(self.__WB_MANIFEST);
// The page explicitly activates an update after the user can safely reload.
// No unsolicited reload may interrupt a microphone session or a message draft.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data: Record<string, string>;
  try { data = event.data?.json() || {}; } catch { return; }
  event.waitUntil(self.registration.showNotification("Avalon", {
    body: data.body || "Avalon'da bir güncelleme var.", tag: data.id || "iris", icon: "/mobile-icon-192.png", data: { runId: data.runId, reminderId: data.reminderId, kind: data.kind },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL("/", self.location.origin);
  if (event.notification.data?.runId) url.searchParams.set("task", String(event.notification.data.runId));
  if (event.notification.data?.kind === "reminder") { url.searchParams.set("planning", "1"); if (event.notification.data.reminderId) url.searchParams.set("reminder", event.notification.data.reminderId); }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === url.origin) as WindowClient | undefined;
    if (existing) { await existing.navigate(url.href); await existing.focus(); }
    else await self.clients.openWindow(url.href);
  })());
});
// Existing pages offer an update button; activation itself never reloads them.
