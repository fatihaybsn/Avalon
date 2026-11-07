import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { ResearchSearch } from "../electron/researchSearch.mjs";

function fixture(t, ready = true) {
  const requests = [];
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), kills: 0,
    kill() { this.kills++; },
  });
  child.stdin.on("data", (data) => requests.push(JSON.parse(data)));
  const search = new ResearchSearch({
    repoRoot: process.cwd(), bridge: { python: "hermes-python", home: () => process.cwd() },
    spawnWorker(python, args, options) {
      assert.equal(python, "hermes-python");
      assert.ok(args.at(-1).endsWith("research_search.py"));
      assert.equal(options.env.HERMES_HOME, process.cwd());
      if (ready) queueMicrotask(() => send({ ready: true }));
      return child;
    },
  });
  const send = (value) => child.stdout.write(JSON.stringify(value) + "\n");
  t.after(() => search.close());
  return { search, child, requests, send };
}

test("Hermes search serializes concurrent queries and keeps response IDs separate", async (t) => {
  const { search, requests, send } = fixture(t);
  const first = search.search("şirket ürünleri", 5);
  const second = search.search("ikinci şirket", 3);
  await setImmediate();
  assert.deepEqual(requests, [{ id: 1, query: "şirket ürünleri", limit: 5 }]);
  send({ id: 1, results: [{ href: "https://example.org/one", body: "one" }] });
  assert.equal((await first)[0].body, "one");
  await setImmediate();
  assert.equal(requests[1].id, 2);
  send({ id: 2, results: [] });
  assert.deepEqual(await second, []);
});

test("Hermes provider failure leaves the helper available for the next query", async (t) => {
  const { search, send } = fixture(t);
  const failed = search.search("first");
  const rejected = assert.rejects(failed, /provider busy/);
  await setImmediate();
  send({ id: 1, error: "provider busy" });
  await rejected;
  const next = search.search("next");
  await setImmediate();
  send({ id: 2, results: [] });
  assert.deepEqual(await next, []);
});

for (const mode of ["cancel", "crash", "mismatched-id", "invalid-json"]) {
  test(`Hermes ${mode} releases pending and queued queries`, async (t) => {
    const { search, child, send } = fixture(t);
    const first = assert.rejects(search.search("first"));
    const queued = assert.rejects(search.search("queued"));
    await setImmediate();
    if (mode === "cancel") search.close();
    else if (mode === "crash") child.emit("close", 1);
    else if (mode === "mismatched-id") send({ id: 99, results: [] });
    else child.stdout.write("invalid-json\n");
    await Promise.all([first, queued]);
    assert.equal(child.kills, 1);
    await assert.rejects(search.search("later"), /kapalı/);
  });
}

test("Hermes startup cancellation rejects immediately", async (t) => {
  const { search } = fixture(t, false);
  const pending = assert.rejects(search.search("first"));
  await setImmediate();
  search.close();
  await pending;
});

test("Hermes stalled search has a bounded wait and kills the helper", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { search, child } = fixture(t);
  const pending = assert.rejects(search.search("first"), /zaman aşımına/);
  await setImmediate();
  t.mock.timers.tick(120_000);
  await pending;
  assert.equal(child.kills, 1);
});
