import test from "node:test";
import assert from "node:assert/strict";
import { registerPhonePush } from "../src/mobile/push.ts";

function setup() {
  const key = new Uint8Array(65).fill(7), calls = [], progress = [];
  const subscription = { options: { applicationServerKey: key.buffer }, toJSON: () => ({ endpoint: "https://fcm.googleapis.com/example", keys: {} }), unsubscribe: async () => { calls.push("unsubscribe"); return true; } };
  const manager = { getSubscription: async () => subscription, subscribe: async () => { calls.push("subscribe"); return subscription; } };
  const environment = { secure: true, supported: true, notification: { permission: "granted", requestPermission: async () => { calls.push("permission"); return "granted"; } },
    worker: { register: async () => { calls.push("register"); }, ready: Promise.resolve({ pushManager: manager }) } };
  const request = async (url, body) => { calls.push({ url, body }); return url.endsWith("/key") ? { publicKey: Buffer.from(key).toString("base64url") } : { pushReady: true }; };
  return { key, calls, progress, subscription, manager, environment, request, run: (timeout = 100) => registerPhonePush(request, (message) => progress.push(message), environment, timeout) };
}

test("granted permission still restores the existing phone subscription to Iris without asking permission or creating another subscription", async () => {
  const s = setup(); await s.run();
  assert.equal(s.calls.includes("permission"), false); assert.equal(s.calls.includes("subscribe"), false);
  assert.deepEqual(s.calls.find((c) => c.url?.endsWith("/subscription")).body, s.subscription.toJSON());
  assert.match(s.progress.at(-1), /hazır/);
});

test("a permitted phone with no subscription completes registration before reporting ready", async () => {
  const s = setup(); s.manager.getSubscription = async () => null; await s.run();
  assert.ok(s.calls.includes("subscribe")); assert.match(s.progress.at(-1), /hazır/);
});

test("a stuck service worker reports its stage and releases the UI instead of waiting forever", async () => {
  const s = setup(); s.environment.worker.ready = new Promise(() => {});
  await assert.rejects(s.run(10), /altyapısının.*zaman aşımı/);
  assert.equal(s.calls.some((c) => c.url), false);
});

test("push service failure is distinct from browser permission and never reports registration ready", async () => {
  const s = setup(); s.manager.getSubscription = async () => null;
  s.manager.subscribe = async () => { throw new DOMException("provider unavailable", "AbortError"); };
  await assert.rejects(s.run(), /Google.*AbortError/);
  assert.equal(s.calls.some((c) => c.url?.endsWith("/subscription")), false);
  assert.doesNotMatch(s.progress.at(-1), /kaydı hazır/);
});

test("a changed VAPID key replaces only the old push subscription", async () => {
  const s = setup(); s.subscription.options.applicationServerKey = new Uint8Array(65).fill(4).buffer;
  await s.run(); assert.ok(s.calls.indexOf("unsubscribe") < s.calls.indexOf("subscribe"));
});

test("native Chrome registration reasons remain visible without exposing arbitrary endpoint URLs", async () => {
  const s = setup(); s.manager.getSubscription = async () => null;
  for (const reason of ["push service error", "push service not available", "storage error"]) {
    s.manager.subscribe = async () => { throw new DOMException(`Registration failed - ${reason}`, "AbortError"); };
    await assert.rejects(s.run(), new RegExp(`AbortError: Registration failed - ${reason}`));
  }
  s.manager.subscribe = async () => { throw new DOMException("Registration failed - https://private.invalid/endpoint-token", "AbortError"); };
  await assert.rejects(s.run(), (error) => !error.message.includes("endpoint-token"));
  s.manager.subscribe = async () => { throw new DOMException("Subscription failed - no active Service Worker", "AbortError"); };
  await assert.rejects(s.run(), /Subscription failed - no active Service Worker/);
});

test("denied permission and a rejected server registration cannot appear ready", async () => {
  const s = setup(); s.environment.notification.permission = "denied";
  await assert.rejects(s.run(), /site ayarlarından/); assert.equal(s.calls.length, 0);
  s.environment.notification.permission = "granted";
  await assert.rejects(registerPhonePush(async () => ({ pushReady: false, publicKey: Buffer.from(s.key).toString("base64url") }), () => {}, s.environment, 100), /doğrulayamadı/);
});
