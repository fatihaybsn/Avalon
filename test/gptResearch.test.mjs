import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { runEntry } from "../electron/researchRunner.mjs";
import { normalizeResearch, ResearchStore, writeJson } from "../electron/researchStore.mjs";

const route = { provider: "evren", modelId: "qwen3.8-flash-next", reasoning: "disabled" };

for (const scheduled of [false, true]) {
  test(`GPT Researcher saves progress and sources through ${scheduled ? "schedule" : "run"}`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-gptr-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const store = new ResearchStore(path.join(root, "state"));
    const configPath = path.join(root, ".env");
    const env = { IRIS_TEST_HOOKS: "1", IRIS_TEST_CONFIG_PATH: configPath, TAVILY_API_KEY: "old-terminal-key" };
    const priorEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    t.after(() => {
      for (const [key, value] of Object.entries(priorEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    if (!scheduled) fs.writeFileSync(configPath, "TAVILY_API_KEY=new-file-key\n");
    const selected = scheduled ? { provider: "opencode", modelId: "deepseek-v4.1-flash-free", reasoning: "low" } : route;
    const spec = { ...normalizeResearch({ topic: "Test", purpose: "p".repeat(20000), minutes: 60, outputDirectory: root, route: selected }),
      runtime: { repoRoot: process.cwd(), stateRoot: store.root, env } };
    const scheduleId = "schedule_abcd";
    if (scheduled) store.save({ id: scheduleId, spec, createdAt: Date.now() });
    const id = scheduled ? scheduleId : store.create(spec).id;
    const args = [scheduled ? "--schedule" : "--run", store.file(id), ...(scheduled ? ["--occurrence", "one"] : [])];
    const result = await runEntry(args, {
      resolveModel: async () => ({ configured: true, key: "private-test-key", baseUrl: "https://example.com/v1" }),
      spawnWorker() {
        const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() {} });
        child.stdin.once("data", (input) => {
          const job = JSON.parse(input);
          assert.deepEqual(job.route, selected);
          assert.deepEqual(job.reasoning, scheduled ? { reasoning_effort: "low" } : { thinking: false });
          assert.equal(job.purpose.length, 20000);
          assert.equal(job.breadth, 4); assert.equal(job.depth, 2);
          assert.equal(job.minutes, undefined);
          assert.equal(job.tavilyKey, scheduled ? "old-terminal-key" : "new-file-key");
          const emit = (event) => child.stdout.write(JSON.stringify(event) + "\n");
          emit({ kind: "search", provider: "duckduckgo", reason: "quota", counts: { tavily: 1, duckduckgo: 1 } });
          emit({ kind: "source", source: { url: "https://example.com", content: "Captured content" } });
          emit({ kind: "findings", findings: ["A finding"] });
          if (!scheduled) emit({ kind: "report", markdown: "# Report\n\nA plain report." });
          else {
            emit({ kind: "report_chunk", markdown: "Old incomplete attempt" });
            emit({ kind: "report_chunk", markdown: "# Saved partial report", replace: true });
            emit({ kind: "error", message: "Provider unavailable" });
          }
          child.stdout.end();
          queueMicrotask(() => child.emit("close", scheduled ? 1 : 0));
        });
        return child;
      },
    });
    assert.equal(result.status, scheduled ? "partial" : "completed");
    assert.match(result.searchNotice, /Tavily kotası doldu/);
    assert.equal(result.sourceCount, 1);
    const summary = fs.readFileSync(path.join(result.outputPath, "summary.json"), "utf8");
    assert.doesNotMatch(summary, /private-test-key/);
    assert.equal(JSON.parse(summary).searchCounts.duckduckgo, 1);
    const checkpoint = JSON.parse(fs.readFileSync(store.file(result.id, "checkpoint.json"), "utf8"));
    assert.equal(checkpoint.findings[0], "A finding");
    if (scheduled) {
      assert.equal(fs.existsSync(store.file(scheduleId, "seen.json")), false);
      assert.equal(result.reportReady, false);
      assert.equal(fs.readFileSync(path.join(result.outputPath, "report.md"), "utf8"), "# Saved partial report\n");
      assert.equal((await runEntry(args)).reason, "duplicate_occurrence");
      store.save({ id: scheduleId, spec: { ...spec, route: { ...selected, modelId: "removed-model" } }, createdAt: Date.now() });
      await assert.rejects(runEntry([...args.slice(0, -1), "invalid"]), /desteklenen/);
      assert.equal(store.list().find((run) => run.occurrence === "invalid").status, "failed");
      assert.equal(fs.existsSync(store.file(scheduleId, "active.lock")), false);
    }
  });
}

test("GPT Researcher interruption restores the saved report and sources", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-gptr-recover-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ResearchStore(root);
  const state = store.create(normalizeResearch({ topic: "Test", outputDirectory: root, route }));
  writeJson(store.file(state.id), { ...state, status: "running", updatedAt: Date.now() - 30_000 });
  writeJson(store.file(state.id, "checkpoint.json"), {
    engine: "gpt-researcher", runId: state.id, report: "Saved draft", findings: [],
    sources: [{ url: "https://example.com", title: "Source", text: "Captured content" }],
  });
  store.reconcile();
  assert.equal(store.get(state.id).status, "interrupted");
  assert.equal(fs.readFileSync(path.join(state.outputPath, "report.md"), "utf8"), "Saved draft\n");
});

test("legacy checkpoint recovery keeps the existing report and restores missing archives", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-legacy-recover-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ResearchStore(root);
  const state = store.create(normalizeResearch({ topic: "Legacy test", outputDirectory: root, route }));
  const report = path.join(state.outputPath, "report.md");
  fs.writeFileSync(report, "Original legacy report\n");
  writeJson(store.file(state.id), { ...state, status: "running", updatedAt: Date.now() - 30_000 });
  const claims = [{ text: "Saved finding", url: "https://example.com" }];
  writeJson(store.file(state.id, "checkpoint.json"), { version: 3, runId: state.id, sources: [], claims, batches: [] });
  store.reconcile();
  assert.equal(store.get(state.id).status, "interrupted");
  assert.equal(fs.readFileSync(report, "utf8"), "Original legacy report\n");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state.outputPath, "evidence.json"), "utf8")), claims);
});
