import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ResearchEngine } from "../electron/researchEngine.mjs";
import { ResearchStore, normalizeResearch, readJson, writeJson } from "../electron/researchStore.mjs";
import { parseObject, normalizeFinding, evidenceFor, accessKind, DELIVERY_LIMIT } from "../electron/researchArtifacts.mjs";
import { runEntry } from "../electron/researchRunner.mjs";
import { durablePeer, reviewedDelivery } from "./researchPeer.mjs";

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-durable-"));
  const store = new ResearchStore(path.join(root, "state"));
  const spec = normalizeResearch({ topic: "Find documented facts", purpose: "Preserve every mandatory requirement", minutes: 1, outputDirectory: path.join(root, "output"), route: { provider: "evren", modelId: "qwen3.8-flash-next", reasoning: "disabled" } });
  const state = store.create(spec);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, store, spec, state };
}
const finding = { text: "One atomic documented fact.", url: "https://primary.example/page", quote: "This fact is explicitly documented by the primary source." };
function deliver(context, { event = true } = {}) {
  context.emit("web_extract", {}, { url: finding.url, content: `${finding.quote} `.repeat(3) });
  fs.writeFileSync(path.join(context.directory, "findings.json"), JSON.stringify({ findings: [finding], gaps: [], inaccessible: [], resolved: true }));
  if (event) context.emit("write_file", { path: "findings.json" }, { success: true, verified: true });
}

test("the actual prose-before-JSON failure is parsed, while ambiguous or truncated output is rejected", () => {
  const json = JSON.stringify({ findings: [finding] });
  assert.deepEqual(parseObject(json), { findings: [finding] });
  assert.deepEqual(parseObject(`Rapor kaydedildi. Sonuç JSON'u:\n\n\`\`\`json\n${json}\n\`\`\`\nTamam.`), { findings: [finding] });
  assert.equal(parseObject(`\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n{}\n\`\`\``), null);
  assert.equal(parseObject('{"findings":['), null);
  assert.equal(parseObject(JSON.stringify({ text: "x".repeat(DELIVERY_LIMIT) })), null);
  assert.equal(parseObject("[]"), null);
});

test("finding identity deduplicates tracking URLs and whitespace without losing different evidence", () => {
  const options = { runId: "run", workerId: "worker", at: 1, criterionIds: ["c0"] };
  const first = normalizeFinding(finding, options).finding;
  const duplicate = normalizeFinding({ ...finding, text: ` ${finding.text}  `, url: finding.url + "?utm_source=test" }, options).finding;
  assert.equal(first.id, duplicate.id);
  assert.notEqual(first.id, normalizeFinding({ ...finding, quote: finding.quote + " Different context." }, options).finding.id);
  assert.ok(normalizeFinding({ ...finding, text: "x".repeat(4001) }, options).error);
  assert.ok(normalizeFinding({ ...finding, criterionIds: ["invented"] }, options).error);
  assert.equal(first.reviewStatus, "pending");
});

test("a matching fragment cannot validate an invented larger quotation or its semantic claim", () => {
  const sources = [{ url: finding.url, text: finding.quote }];
  assert.equal(evidenceFor([finding], sources)[0].verified, true);
  assert.equal(evidenceFor([{ ...finding, quote: `Invented preface "${finding.quote}" and invented conclusion` }], sources)[0].verified, false);
  assert.equal(evidenceFor([finding], sources)[0].reviewStatus, undefined, "Quote matching cannot invent a semantic assessment for legacy data");
});

for (const [value, expected] of [[{ statusCode: 404 }, "not_found"], [{ statusCode: 403 }, "blocked"], [{ statusCode: 503 }, "unavailable"], [{ statusCode: 429 }, "rate_limit"], [{ url: "https://linkedin.com/login" }, "authentication"], [{ error: "Failed to fetch" }, "connection"], [{ error: "unspecified" }, "unknown"]]) {
  test(`access classification distinguishes ${expected}`, () => assert.equal(accessKind(value), expected));
}

for (const event of [true, false]) {
  test(`a checkpoint survives cancellation ${event ? "with" : "without"} its tool completion event`, async (t) => {
    const { store, state } = setup(t); let engine, saved = false, late;
    const peer = durablePeer((context) => {
      if (!context.params.text.includes("Assigned subquestion") || saved) return false;
      saved = true; late = context;
      deliver(context, { event });
      if (event) {
        assert.equal(readJson(store.file(state.id, "checkpoint.json")).claims.length, 1);
        assert.match(fs.readFileSync(path.join(state.outputPath, "report.md"), "utf8"), /One atomic documented fact/);
      }
      engine.cancelled = true; void engine.stopActive(); return true;
    });
    engine = new ResearchEngine({ store, state, createBackend: peer.factory });
    const result = await engine.run();
    assert.equal(result.status, "cancelled");
    const checkpoint = readJson(store.file(state.id, "checkpoint.json"));
    assert.equal(checkpoint.claims.length, 1, JSON.stringify(checkpoint.issues));
    const evidence = readJson(path.join(state.outputPath, "evidence.json"));
    assert.equal(evidence.length, 1); assert.equal(evidence[0].verified, true); assert.equal(evidence[0].reviewStatus, "pending");
    const before = fs.readFileSync(store.file(state.id, "checkpoint.json"), "utf8");
    late.emit("web_extract", {}, { url: "https://late.example", content: "late ".repeat(40) });
    late.finish({ findings: [{ ...finding, text: "Late invented claim" }] });
    assert.equal(fs.readFileSync(store.file(state.id, "checkpoint.json"), "utf8"), before);
  });
}

for (const scheduled of [false, true]) {
  test(`native ${scheduled ? "scheduled" : "immediate"} runs preserve facts when synthesis returns invented references`, async (t) => {
    const { root, store, spec, state } = setup(t);
    const peer = durablePeer((context) => {
      if (!context.params.text.includes("Synthesize")) return false;
      context.finish({ report: "INVENTED REPORT", sections: [{ title: "Topic", findingIds: ["invented-id"] }] }); return true;
    });
    const env = { ...process.env };
    t.after(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
    const runtime = { stateRoot: store.root, repoRoot: root, env: { IRIS_TEST_HOOKS: "1", IRIS_TEST_CONFIG_PATH: path.join(root, ".env") } };
    const schedule = { id: "schedule_abcdef1234", spec: { ...spec, runtime, schedule: { kind: "once", date: "2099-01-01", time: "12:00", timezone: "Europe/Istanbul" } } };
    if (scheduled) store.save(schedule); else store.save({ ...state, spec: { ...spec, runtime } });
    const args = scheduled ? ["--schedule", store.file(schedule.id), "--occurrence", "one"] : ["--run", store.file(state.id)];
    const result = await runEntry(args, { createBackend: peer.factory });
    assert.equal(result.status, "completed");
    const checkpoint = readJson(store.file(result.id, "checkpoint.json"));
    const evidence = readJson(path.join(result.outputPath, "evidence.json"));
    assert.ok(evidence.length >= 3); assert.equal(evidence.length, checkpoint.claims.length);
    assert.ok(evidence.every((f) => f.verified && f.reviewStatus === "supported"));
    for (const f of evidence) assert.ok(result.output.includes(f.id));
    assert.doesNotMatch(result.output, /INVENTED REPORT/);
    assert.ok(result.limitations.some((s) => s.includes("temel rapor")));
    if (scheduled) {
      const seen = readJson(store.file(schedule.id, "seen.json")); assert.equal(Object.keys(seen).length, 3);
      assert.equal((await runEntry(args, { createBackend: peer.factory })).reason, "duplicate_occurrence");
    }
  });
}

test("a mixed delivery accepts valid facts, deduplicates event/final/file, and records bad items", async (t) => {
  const { store, state } = setup(t); let delivered = false;
  const peer = durablePeer((context) => {
    if (!context.params.text.includes("Assigned subquestion") || delivered) return false;
    delivered = true; deliver(context);
    const data = { findings: [finding, { ...finding, text: "x".repeat(4001) }], resolved: true, gaps: [], inaccessible: [] };
    fs.writeFileSync(path.join(context.directory, "findings.json"), JSON.stringify(data));
    context.emit("write_file", { path: "findings.json" }, { success: true });
    context.finish(`Rapor kaydedildi.\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``); return true;
  });
  const result = await new ResearchEngine({ store, state, createBackend: peer.factory }).run();
  const claims = readJson(store.file(state.id, "checkpoint.json")).claims;
  assert.equal(claims.filter((f) => f.text === finding.text).length, 1);
  assert.ok(claims.every((f) => f.text.length <= 4000));
  assert.ok(result.limitations.some((s) => s.includes("sınırı aşıyor")));
});

test("contradictory content review cannot complete despite matching quotations and resolved=true", async (t) => {
  const { store, state } = setup(t);
  const peer = durablePeer((context) => {
    if (!context.params.text.includes("Find independent corroboration")) return false;
    const data = reviewedDelivery(context.params.text);
    data.assessments.forEach((a) => { a.contradiction = true; a.reason = "The source is historical, not a current opportunity."; });
    context.finish(data); return true;
  });
  const result = await new ResearchEngine({ store, state, createBackend: peer.factory }).run();
  assert.equal(result.status, "partial");
  assert.ok(readJson(path.join(state.outputPath, "evidence.json")).every((f) => f.verified && f.reviewStatus === "pending"));
});

test("checkpoint write failure cannot accept a new finding or replace the last durable snapshot", (t) => {
  const { store, state } = setup(t), engine = new ResearchEngine({ store, state });
  engine.criteria = [{ id: "c0", text: "Question", resolved: false }];
  const worker = engine.worker("collecting");
  engine.sources.set(finding.url, { url: finding.url, text: finding.quote });
  engine.ingest(JSON.stringify({ findings: [finding] }), worker);
  const before = fs.readFileSync(store.file(state.id, "checkpoint.json"), "utf8");
  engine.sources.get(finding.url).text += " Uncommitted source extension.";
  assert.equal(engine.checkpoint.sources[0].text, finding.quote, "The durable backup must not share mutable source objects");
  const original = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => { if (to === store.file(state.id, "checkpoint.json")) throw new Error("disk unavailable"); return original(from, to); });
  assert.equal(engine.ingest(JSON.stringify({ findings: [{ ...finding, text: "New uncommitted fact" }] }), worker), null);
  assert.equal(engine.claims.length, 1);
  assert.equal(fs.readFileSync(store.file(state.id, "checkpoint.json"), "utf8"), before);
  assert.equal(engine.storageFailed, true);
  engine.leases.close();
});

test("process loss rebuilds outputs from the checkpoint without starting research or touching legacy runs", (t) => {
  const { store, state, spec } = setup(t), engine = new ResearchEngine({ store, state });
  engine.criteria = [{ id: "c0", text: "Question", resolved: false }];
  engine.ingest(JSON.stringify({ findings: [finding] }), engine.worker("collecting"));
  engine.leases.close();
  fs.writeFileSync(path.join(state.outputPath, "evidence.json"), "[]");
  writeJson(store.file(state.id), { ...state, status: "running", pid: 99999999, updatedAt: Date.now() - 60000 });
  const legacy = store.create(spec); writeJson(store.file(legacy.id), { ...legacy, status: "completed", output: "Legacy report", updatedAt: 1 });
  store.reconcile();
  assert.equal(store.get(state.id).status, "interrupted");
  assert.match(store.get(state.id).output, /One atomic documented fact/);
  assert.equal(readJson(path.join(state.outputPath, "evidence.json")).length, 1);
  assert.equal(store.get(legacy.id).output, "Legacy report");
  assert.equal(readJson(path.join(state.outputPath, "summary.json")).status, "interrupted");
});

test("a turn deadline includes session startup and never restarts a closed transport", async (t) => {
  const { store, state } = setup(t); let closed = false, requestsAfterClose = 0;
  const peer = durablePeer();
  const engine = new ResearchEngine({ store, state, createBackend: async (options) => {
    const backend = await peer.factory(options);
    backend.transport.createSession = () => new Promise(() => {});
    backend.transport.close = () => { closed = true; };
    const request = backend.client.request;
    backend.client.request = (...args) => { if (closed) requestsAfterClose++; return request(...args); };
    return backend;
  } });
  state.deadline = Date.now() + 100; engine.workDeadline = state.deadline;
  const start = Date.now();
  await assert.rejects(engine.turn("startup", { planning: true }), /süresi doldu/);
  assert.ok(Date.now() - start < 1000); assert.equal(closed, true); assert.equal(requestsAfterClose, 0);
  assert.equal(engine.clients.size, 0); assert.equal(engine.pending.size, 0);
  engine.leases.close();
});

test("wrong paths, failed writes, oversize files and post-deadline files cannot replace a valid delivery", (t) => {
  const { store, state } = setup(t), engine = new ResearchEngine({ store, state });
  engine.criteria = [{ id: "c0", text: "Question", resolved: false }];
  const worker = engine.worker("collecting"); worker.end = worker.acceptUntil = Date.now() + 1000;
  engine.workers.set("worker", worker);
  engine.ingest(JSON.stringify({ findings: [finding] }), worker);
  const before = readJson(store.file(state.id, "checkpoint.json")).claims;
  fs.writeFileSync(worker.file, JSON.stringify({ findings: [{ ...finding, text: "Must not enter evidence" }] }));
  engine.collect({ name: "write_file", args: { path: "../findings.json" }, result: { success: true } }, "worker");
  engine.collect({ name: "write_file", args: { path: worker.file }, result: { error: "write refused" } }, "worker");
  fs.utimesSync(worker.file, new Date(), new Date(worker.end + 10000)); engine.readDelivery(worker);
  fs.writeFileSync(worker.file, "x".repeat(DELIVERY_LIMIT + 1)); engine.readDelivery(worker);
  assert.deepEqual(readJson(store.file(state.id, "checkpoint.json")).claims, before);
  engine.leases.close();
});

test("a stalled report stops at its phase boundary and preserves a completed source-backed result", async (t) => {
  const { store, state } = setup(t);
  // Accelerate the 30-minute proportions, without waiting minutes in an offline test.
  state.spec.minutes = .05;
  const peer = durablePeer((context) => context.params.text.includes("Synthesize"));
  const start = Date.now();
  const result = await new ResearchEngine({ store, state, createBackend: peer.factory }).run();
  assert.equal(result.status, "completed");
  assert.ok(Date.now() - start < 4000);
  assert.equal(readJson(path.join(state.outputPath, "evidence.json")).length, 3);
  assert.match(result.limitations.join("\n"), /Rapor çağrısı tamamlanamadı/);
  assert.equal(peer.calls.filter((c) => c.method === "prompt.submit" && c.params.text.includes("Synthesize")).length, 1);
});

test("malformed review items are ignored and cannot establish a required criterion", async (t) => {
  const { store, state } = setup(t);
  const peer = durablePeer((context) => {
    if (!context.params.text.includes("Find independent corroboration")) return false;
    context.finish({ findings: [], assessments: [null, "supported", { findingId: "unknown", status: "supported" }], criteria: [null, { id: "c0", resolved: true, findingIds: ["unknown"] }] }); return true;
  });
  const result = await new ResearchEngine({ store, state, createBackend: peer.factory }).run();
  assert.equal(result.status, "partial");
  assert.ok(readJson(path.join(state.outputPath, "evidence.json")).every((f) => f.reviewStatus === "pending"));
});

test("other workers' gaps do not create implicit collection loops", async (t) => {
  const { store, state } = setup(t); let collected = 0;
  const peer = durablePeer((context) => {
    if (!context.params.text.includes("Assigned subquestion") || context.params.text.includes("Find independent corroboration")) return false;
    collected++;
    const url = `https://scope-${collected}.example/page`;
    context.emit("web_extract", {}, { url, content: finding.quote.repeat(3) });
    context.finish({ findings: [{ ...finding, url }], gaps: ["Other workers have not answered their assigned questions yet."], resolved: false }); return true;
  });
  const result = await new ResearchEngine({ store, state, createBackend: peer.factory }).run();
  assert.equal(collected, 3);
  assert.equal(result.status, "completed", "The verifier can resolve the full scope from all three independent deliveries");
});

test("a final checkpoint failure cannot report success or advance the scheduled baseline", async (t) => {
  const { store, state } = setup(t), scheduleId = "schedule_abcdef";
  state.scheduleId = scheduleId;
  writeJson(store.file(scheduleId, "seen.json"), { "https://previous.example": "old" });
  const original = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === store.file(state.id, "checkpoint.json") && state.status === "completed") throw new Error("final checkpoint unavailable");
    return original(from, to);
  });
  const result = await new ResearchEngine({ store, state, createBackend: durablePeer().factory }).run();
  assert.equal(result.status, "partial");
  assert.equal(readJson(path.join(state.outputPath, "evidence.json")).length, 3);
  assert.deepEqual(readJson(store.file(scheduleId, "seen.json")), { "https://previous.example": "old" });
});

test("an overflowing verification delivery preserves its valid findings and independent assessments", (t) => {
  const { store, state } = setup(t), engine = new ResearchEngine({ store, state });
  engine.criteria = [{ id: "c0", text: "Question", resolved: false }];
  engine.sources.set(finding.url, { url: finding.url, text: finding.quote });
  const first = engine.worker("collecting");
  engine.ingest(JSON.stringify({ findings: [finding] }), first);
  const original = engine.claims[0].id;
  const worker = engine.worker("verifying");
  const data = { findings: Array.from({ length: 6 }, (_, i) => ({ ...finding, id: `local-${i}`, text: `Additional fact ${i}` })),
    assessments: [{ findingId: original, status: "supported" }, { findingId: "local-0", status: "supported" }],
    criteria: [{ id: "c0", resolved: true, findingIds: [original, "local-0"] }], gaps: [] };
  engine.ingest(JSON.stringify(data), worker);
  assert.equal(engine.claims.length, 6);
  assert.equal(engine.claims.find((f) => f.id === original).reviewStatus, "supported");
  assert.equal(engine.claims.find((f) => f.text === "Additional fact 0").reviewStatus, "supported");
  assert.equal(engine.criteria[0].resolved, true);
  assert.ok(engine.issues.some((i) => i.message.includes("beş yeni bulgu")));
  engine.ingest(JSON.stringify({ findings: [{ ...finding, text: "Seventh new fact" }] }), worker);
  assert.equal(engine.claims.length, 6, "The cap is cumulative across all deliveries in one turn");
  engine.leases.close();
});

test("Windows transient rename locks retry without deleting the destination", { skip: process.platform !== "win32" }, (t) => {
  const { root } = setup(t), file = path.join(root, "atomic.json"); writeJson(file, { revision: 1 });
  const rename = fs.renameSync; let attempts = 0;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === file && ++attempts <= 2) {
      assert.deepEqual(readJson(file), { revision: 1 });
      throw Object.assign(new Error("temporary file lock"), { code: "EPERM" });
    }
    return rename(from, to);
  });
  writeJson(file, { revision: 2 });
  assert.equal(attempts, 3); assert.deepEqual(readJson(file), { revision: 2 });
});
