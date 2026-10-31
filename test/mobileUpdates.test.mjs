import test from "node:test";
import assert from "node:assert/strict";
import { readMobileBuild, activateMobileUpdate, updateBlockReason } from "../src/mobile/updates.ts";

test("mobile checks the served build without relying on the browser cache", async () => {
  const value = await readMobileBuild(async (url, options) => {
    assert.equal(url, "/version.json"); assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => ({ version: "0.4.0", buildId: "new-build" }) };
  });
  assert.equal(value.buildId, "new-build");
  assert.equal(await readMobileBuild(async () => ({ ok: false })), null);
});

test("an update cannot reload an active voice session, pending action, draft or form", () => {
  assert.match(updateBlockReason(true, false, false, false), /sesli/);
  assert.match(updateBlockReason(false, true, false, false), /işlemin/);
  assert.match(updateBlockReason(false, false, true, false), /mesajı/);
  assert.match(updateBlockReason(false, false, false, true), /formu/);
  assert.equal(updateBlockReason(false, false, false, false), "");
});

test("a waiting worker activates explicitly before the page can reload", async () => {
  const container = new EventTarget();
  const waiting = { state: "installed", postMessage(value) {
    assert.deepEqual(value, { type: "SKIP_WAITING" });
    waiting.state = "activated"; container.controller = waiting; container.dispatchEvent(new Event("controllerchange"));
  } };
  await activateMobileUpdate({ waiting }, container, 100);
  await activateMobileUpdate(undefined, undefined);
});

test("failed activation releases the interface rather than reloading the old worker", async () => {
  await assert.rejects(activateMobileUpdate({ waiting: { state: "installed", postMessage() {} } }, new EventTarget(), 5), /etkinleşmedi/);
});
